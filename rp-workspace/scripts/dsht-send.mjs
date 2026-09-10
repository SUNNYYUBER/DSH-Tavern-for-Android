#!/usr/bin/env node
// dsht-send.mjs — 通过 CDP 向 DSHT 前端编辑器注入文本并发送
// 用法: node dsht-send.mjs "消息内容" [cdp端口=9333]
//
// 关键发现（心跳 31）：
//   1. DSH 输入框是 Lexical 类 contenteditable，DOM 事件注入全灭；
//      但 CDP Input.insertText 有效（协议级输入，绕过 DOM 合成）。
//   2. 坐标是 CSS px，CDP dispatchMouseEvent 直接用 CSS px（无需乘 DPR）。
//   3. 发送按钮 aria-label="Send message"；编辑器是 [contenteditable="true"]。
//
// 前置：adb forward tcp:9333 localabstract:webview_devtools_remote_<dsht_pid>

const PORT = process.argv[3] || '9333'
const MSG = process.argv[2]
if (!MSG) { console.error('用法: node dsht-send.mjs "消息" [端口]'); process.exit(1) }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = list.find(t => t.type === 'page')
if (!target) { console.error('无 page target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id
  pend.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method: m, params: p }))
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id)
    pend.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
await new Promise(r => { ws.onopen = r })

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}

// 定位编辑器与发送按钮（取包围盒中心）
const geo = JSON.parse(await evaluate(`(() => {
  const ed = document.querySelector('[contenteditable="true"]');
  const btn = document.querySelector('button[aria-label="Send message"]');
  if (!ed || !btn) return JSON.stringify({ ok:false, hasEd:!!ed, hasBtn:!!btn });
  const eb = ed.getBoundingClientRect(), bb = btn.getBoundingClientRect();
  return JSON.stringify({ ok:true,
    ed:{x:eb.x+eb.width/2, y:eb.y+eb.height/2},
    btn:{x:bb.x+bb.width/2, y:bb.y+bb.height/2} });
})()`))
if (!geo.ok) { console.error('定位失败:', JSON.stringify(geo)); process.exit(1) }
console.error('[dsht-send] 编辑器中心', JSON.stringify(geo.ed), '发送按钮', JSON.stringify(geo.btn))

// 1) 聚焦编辑器
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.ed.x, y: geo.ed.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.ed.x, y: geo.ed.y, button: 'left', clickCount: 1 })
await new Promise(r => setTimeout(r, 250))

// 2) 清空残留 + 插入文本
const cur = await evaluate(`document.querySelector('[contenteditable="true"]').innerText`)
if (cur && cur.trim()) {
  await evaluate(`(() => {
    const ed = document.querySelector('[contenteditable="true"]');
    ed.focus();
    const sel = window.getSelection(); sel.removeAllRanges();
    const rg = document.createRange(); rg.selectNodeContents(ed); sel.addRange(rg);
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 46, key: 'Delete' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 46, key: 'Delete' })
  await new Promise(r => setTimeout(r, 200))
}
await send('Input.insertText', { text: MSG })
await new Promise(r => setTimeout(r, 400))

const back = await evaluate(`document.querySelector('[contenteditable="true"]').innerText`)
if (back.trim() !== MSG.trim()) {
  console.error('[dsht-send] ⚠ 回读不符！期望=' + JSON.stringify(MSG) + ' 实际=' + JSON.stringify(back))
} else {
  console.error('[dsht-send] ✓ 文本注入成功（' + back.length + ' 字）')
}

// 3) 点击发送
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.btn.x, y: geo.btn.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.btn.x, y: geo.btn.y, button: 'left', clickCount: 1 })
await new Promise(r => setTimeout(r, 1200))

const after = await evaluate(`document.querySelector('[contenteditable="true"]').innerText`)
console.error(after.trim() === '' ? '[dsht-send] ✓ 已发送（编辑器已清空）' : '[dsht-send] ⚠ 编辑器未清空，可能未发送: ' + JSON.stringify(after.slice(0, 60)))

ws.close()
process.exit(0)
