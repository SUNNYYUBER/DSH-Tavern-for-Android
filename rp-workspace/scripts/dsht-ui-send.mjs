#!/usr/bin/env node
/**
 * dsht-ui-send.mjs — 用 CDP **Input 事件**在 DSHT WebView 里真实发送一条聊天消息
 * =====================================================================
 * 为什么不能用 `Runtime.evaluate` + `document.execCommand('insertText')`：
 *   聊天输入框是 **Lexical**（contenteditable + 受控状态机）。
 *   `execCommand` 只改 DOM，**不触发 Lexical 的编辑器状态更新** →
 *   框架仍认为输入为空 → 点「Send message」不提交、会话文件零写入
 *   （实测：点击成功、无报错、无出站请求、`session.jsonl` mtime 不变 —— 典型静默失败）。
 *
 * 正确做法（本脚本）：走 CDP `Input` 域，模拟真实输入通道
 *   · `Input.insertText`     —— 等价 IME 提交，Lexical 会收到正常的 beforeinput/input
 *   · `Input.dispatchKeyEvent` —— 真键盘事件（Enter 提交）
 *
 * 前置（应用重启后 CDP 转发失效，须重取）：
 *   SOCK=$(adb shell "cat /proc/net/unix | grep webview_devtools_remote" | sed 's/.*@//')
 *   adb forward tcp:9333 localabstract:$SOCK
 *
 * 用法：
 *   node dsht-ui-send.mjs "要发送的文本" [--port 9333] [--wait 15000]
 *   node dsht-ui-send.mjs --selfcheck          # 只检查输入框/发送按钮是否就位
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const WAIT = Number(flag('--wait', '15000'))
const text = argv.find(a => !a.startsWith('--') && a !== PORT && a !== String(WAIT))
const selfcheck = argv.includes('--selfcheck')

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target —— 先 adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.value
}

await send('Runtime.enable')

const composer = '.uV2eYG_input'
const before = await evalJs(`(() => {
  const ed = document.querySelector('${composer}');
  return JSON.stringify({ hasComposer: !!ed, draft: ed ? (ed.textContent||'').trim().slice(0,60) : null });
})()`)
console.error('[send] 发送前:', before)

if (selfcheck) { ws.close(); process.exit(0) }
if (!text) { console.error('用法: node dsht-ui-send.mjs "<文本>"'); ws.close(); process.exit(1) }

// 1) 聚焦输入框（真实点击，确保 Lexical 进入编辑态）
const box = await evalJs(`(() => {
  const ed = document.querySelector('${composer}');
  if (!ed) return null;
  const r = ed.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
})()`)
if (!box) { console.error('[send] FATAL 找不到输入框'); ws.close(); process.exit(1) }
const { x, y } = JSON.parse(box)
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}

// 2) 清空草稿（全选 + 删除，避免把旧草稿一起发出去）
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })

// 3) 真实插入文本（IME 通道）
await send('Input.insertText', { text })

const afterType = await evalJs(`(document.querySelector('${composer}')?.textContent||'').trim()`)
console.error('[send] 键入后:', JSON.stringify(afterType))

// 4) 提交：依次尝试「点发送按钮」→「Enter 键」，并在每次之后验证草稿是否被清空。
//    只试一种方式会漏判：实测点按钮成功但框架未提交（草稿仍在），此时 Enter 才生效。
const pressEnter = async () => {
  for (const type of ['keyDown', 'rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: type === 'keyDown' ? '\r' : undefined,
    })
  }
}
const draftOf = () => evalJs(`(document.querySelector('${composer}')?.textContent||'').trim()`)

let submittedBy = 'none'
for (const attempt of ['button', 'enter']) {
  if (attempt === 'button') {
    const clicked = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Send message/i.test(x.getAttribute('aria-label')||''));
      if (b && !b.disabled) { b.click(); return true; } return false;
    })()`)
    if (!clicked) continue
  } else {
    await pressEnter()
  }
  await new Promise(r => setTimeout(r, 2500))
  const d = await draftOf()
  console.error(`[send] 尝试 ${attempt} 后草稿: ${JSON.stringify((d||'').slice(0,40))}`)
  if (d !== afterType) { submittedBy = attempt; break }
}
console.error('[send] 提交方式:', submittedBy)

await new Promise(r => setTimeout(r, WAIT))

const result = await evalJs(`(() => {
  const errs = [...document.querySelectorAll('[class*=error],[class*=Error]')]
    .map(e => (e.textContent||'').trim()).filter(Boolean).slice(0,4);
  return JSON.stringify({ errs, draftNow: (document.querySelector('${composer}')?.textContent||'').trim().slice(0,60) });
})()`)
console.log(result)
ws.close()
