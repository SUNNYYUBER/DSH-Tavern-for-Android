// hb71-verify-11305path.mjs — 验证 RegexBinding 在 11305+ 路径下**完整走完**它该做的事
//
// 【已定位】RegexBinding 在 11305+ 下于 :3567-3722 走一个**独立分支**，并在 :3721 `return`
// （注释原文：`11305+ has built-in regex binding; ST is source of truth, only sync FROM ST`）。
// ⇒ :3877 的 `regexBinding_onSortableStart` **在新版路径下永不设置** = 设计语义，非缺陷。
//
// 【本探针要证明的】该分支**完整执行到了 :3721**，且它做的事真的发生了：
//   · :3585-3589  stHasRegexScripts 为真 → presetRegexes 同步为 ST 的 regex_scripts
//   · :3596-3602  清理 legacy `preset_` 前缀条目（若长度变化 → ctx.reloadCurrentChat()）
//   · :3605-3617  注入「执行顺序」按钮到 #import_regex 旁
// 判据 = 分支末尾 :3721 被执行 + 上述副作用可见。零写入（不改持久化；reloadCurrentChat 由卡自己决定）。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

let SRC = readFileSync('D:/DSH RolePlay/tmp/t37-inject.js', 'utf8')

// 只在**分支末尾 return 之前**加一个打点（安全位置：`  return;` 前面那行之后）
const ANCHOR = `    return;
  }

  const regexButtons = $('#open_preset_editor');`
if (!SRC.includes(ANCHOR)) { console.error('[FATAL] 未找到 11305 分支末尾锚点'); process.exit(3) }
SRC = SRC.replace(ANCHOR, `    try { window.__hb71b = (window.__hb71b || []).concat(['11305分支:到达return(:3721)']) } catch (e) {}
    return;
  }

  const regexButtons = $('#open_preset_editor');`)

// 在分支开头加一个打点（确认进入了该分支）
const ANCHOR2 = `  if (versionNumber >= 11305) {
    // 11305+ has built-in regex binding`
SRC = SRC.replace(ANCHOR2, `  if (versionNumber >= 11305) {
    try { window.__hb71b = (window.__hb71b || []).concat(['11305分支:进入(:3567)']) } catch (e) {}
    // 11305+ has built-in regex binding`)

// 在清理 legacy 处加打点（:3596 前）
SRC = SRC.replace(`    // Clean up legacy preset_ entries from global regex list
    const originalLength = extensions.regex.length;`,
`    try { window.__hb71b = (window.__hb71b || []).concat(['11305分支:清理legacy前(:3596) regexLen=' + extensions.regex.length]) } catch (e) {}
    // Clean up legacy preset_ entries from global regex list
    const originalLength = extensions.regex.length;`)

// 在 :3605 注入按钮处加打点
SRC = SRC.replace(`    const activationSortButton = $(`,
`    try { window.__hb71b = (window.__hb71b || []).concat(['11305分支:注入执行顺序按钮(:3605)']) } catch (e) {}
    const activationSortButton = $(`)

console.log(`[src] 已加 4 处打点（${SRC.length} 字节）`)

const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')
const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const exceptions = []
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Runtime.exceptionThrown') {
    const d = x.params?.exceptionDetails
    exceptions.push(`${String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 160)}`)
  }
  if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}
await ev(`(() => { window.__hb71b = []; return true })()`)
exceptions.length = 0
console.log('[inject]', JSON.stringify(await ev(`(() => {
  const s = document.createElement('script'); s.id = '__hb71b__'
  s.textContent = ${JSON.stringify(SRC)}
  document.body.appendChild(s); return { ok: true }
})()`, false)))
await new Promise(r => setTimeout(r, 8000))

const out = await ev(`(() => ({
  打点序列: window.__hb71b || [],
  versionNumber: typeof window.versionNumber === 'undefined' ? null : window.versionNumber,
  // 该分支的副作用：「执行顺序」按钮被注入到 #import_regex 旁
  执行顺序按钮: !!document.getElementById('sort_activation_order'),
  卡已执行四段的最终标志: typeof window.SPresetToolBinding !== 'undefined',
}))()`)
console.log('\n=== 11305+ 分支执行证据 ===')
console.log(JSON.stringify(out, null, 2))
console.log('\n=== 页面异常 ===')
console.log(exceptions.length ? exceptions.slice(0, 6).join('\n') : '(无)')
await ev(`(() => { const s = document.getElementById('__hb71b__'); if (s) s.remove(); return true })()`)
ws.close()
