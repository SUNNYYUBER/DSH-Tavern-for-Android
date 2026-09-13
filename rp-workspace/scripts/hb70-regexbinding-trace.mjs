// hb70-regexbinding-trace.mjs — 定位：`RegexBinding()` 报"执行了"但 :3877 副作用为 false 的真因
//
// 【背景】心跳 69 的四段留痕显示 `RegexBinding` 在 ran 列表里，但它的特征副作用
// `window.regexBinding_onSortableStart`（inject.js:3877 同步赋值）读出来是 false。
// **两种可能必须分清**：
//   (a) 它在 :3877 之前**抛错**了（但被我的 `__hb69Mark` 吞掉/try 包住 → 假"已执行"）
//   (b) 它跑完了，只是我探针读的时机不对（例如卡后有覆盖/清理）
// 本探针在 `RegexBinding` 内**逐里程碑打点**（不改逻辑，只加可观测），一次跑清。
// 零写入。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

let SRC = readFileSync('D:/DSH RolePlay/tmp/t37-inject.js', 'utf8')

// 在 RegexBinding 本体的"开箱里程碑"处打点（只加 window.__hb70.push，不改逻辑）
const MILESTONES = [
  ['3449', 'const RegexBinding = () => {', 'regexbinding:enter'],
  ['3538', 'const extensions = ctx.extensionSettings;', 'regexbinding:got-extensions'],
  ['3539', 'const presetRegexes = getRegexesFromPreset();', 'regexbinding:got-presetRegexes'],
  ['3560', '};', null], // 占位，跳过
  ['3877', 'window.regexBinding_onSortableStart = function () {', 'regexbinding:set-sortableStart'],
  ['3884', "const observerTarget = $('#saved_regex_scripts');", 'regexbinding:got-observerTarget'],
  ['3885', 'observer.observe(observerTarget[0], {', 'regexbinding:observing'],
]
let patched = 0
for (const [ln, line, tag] of MILESTONES) {
  if (!tag) continue
  if (!SRC.includes(line)) { console.log(`[skip] ${ln} 未找到（源码可能变了）: ${line.slice(0, 40)}`); continue }
  SRC = SRC.replace(line, `try { (window.__hb70 = window.__hb70 || []).push('${tag}') } catch (e) {}\n${line}`)
  patched += 1
}
// 四段留痕（用**带 catch 记录**的版本，能看到抛错）
const SEQ = `  RegexBinding();
  loadSettingsToChatSquashForm = ChatSquash();
  loadSettingsToMacroNestForm = MacroNest();
  syncSPresetToolRegistrations();`
if (!SRC.includes(SEQ)) { console.error('[FATAL] bootstrap 序列未找到'); process.exit(3) }
SRC = SRC.replace(SEQ, `  try { RegexBinding(); window.__hb70 = (window.__hb70 || []).concat(['SEG:RegexBinding:ok']) } catch (e) { window.__hb70 = (window.__hb70 || []).concat(['SEG:RegexBinding:THROW:' + e.message]) }
  try { loadSettingsToChatSquashForm = ChatSquash(); window.__hb70 = (window.__hb70 || []).concat(['SEG:ChatSquash:ok']) } catch (e) { window.__hb70 = (window.__hb70 || []).concat(['SEG:ChatSquash:THROW:' + e.message]) }
  try { loadSettingsToMacroNestForm = MacroNest(); window.__hb70 = (window.__hb70 || []).concat(['SEG:MacroNest:ok']) } catch (e) { window.__hb70 = (window.__hb70 || []).concat(['SEG:MacroNest:THROW:' + e.message]) }
  try { syncSPresetToolRegistrations(); window.__hb70 = (window.__hb70 || []).concat(['SEG:sync:ok']) } catch (e) { window.__hb70 = (window.__hb70 || []).concat(['SEG:sync:THROW:' + e.message]) }`)
console.log(`[src] 打点 ${patched} 处 + 四段带 catch（${SRC.length} 字节）`)

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
    exceptions.push(`${String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 170)} @ :${d?.lineNumber}`)
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
  if (await ev(`typeof window.SillyTavern === 'object' && typeof window.SillyTavern.getContext === 'function'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}
await ev(`(() => { delete window.SPresetToolBinding; window.__hb70 = []; return true })()`)

exceptions.length = 0
console.log('[inject]', JSON.stringify(await ev(`(() => {
  const s = document.createElement('script'); s.id = '__hb70__'
  s.textContent = ${JSON.stringify(SRC)}
  document.body.appendChild(s); return { ok: true }
})()`, false)))

for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const t = await ev(`(window.__hb70 || []).filter(x => x.startsWith('SEG:')).length`)
  if (t === 4) break
}
await new Promise(r => setTimeout(r, 2000))

const out = await ev(`(() => ({
  里程碑与四段: window.__hb70 || [],
  sortableStart已挂: typeof window.regexBinding_onSortableStart === 'function',
  sortableStop已挂: typeof window.regexBinding_onSortableStop === 'function',
  mutationObserver目标存在: !!document.getElementById('saved_regex_scripts'),
}))()`)
console.log('\n=== 打点结果 ===')
console.log(JSON.stringify(out, null, 2))
console.log('\n=== 页面异常 ===')
console.log(exceptions.length ? exceptions.slice(0, 8).join('\n') : '(无)')

await ev(`(() => { const s = document.getElementById('__hb70__'); if (s) s.remove(); return true })()`)
console.log('\n[cleanup] 已移除注入 script（注：顶层 let/const 仍在 global lexical scope，需冷启才能重测）')
ws.close()
