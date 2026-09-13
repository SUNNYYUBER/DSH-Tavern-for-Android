// hb69-segments.mjs — 四段核心功能的**逐段执行证据**（goal 唯一判据的精确化）
//
// 【为什么要单独做】hb69-card-fullrun 用 `regexBindingFnDefined`（:3877）等**间接**指标推断，
// 但那些指标可能在"执行到一半"时也为真/为假，**不能证明整段跑完**。
// 本探针改为**逐段取证**：在注入前给四段各自装一个"经过即留痕"的探针
// （对卡脚本做**最小同步包装**，不改变其逻辑），跑完读痕。
//
// 卡的四段（bootstrap :2307-2314）：
//   RegexBinding()                  :3449   → 内部 :3877 定义 window.regexBinding_onSortableStart
//   ChatSquash()                    :2733   → 返回表单 loader（赋给 loadSettingsToChatSquashForm）
//   MacroNest()                     :2705   → 返回表单 loader
//   syncSPresetToolRegistrations()   :5422   → 注册工具（写 window.SPresetToolBinding 之外的工具表）
// 零写入：不改任何持久化状态；结束移除注入 script。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

let SRC = readFileSync('D:/DSH RolePlay/tmp/t37-inject.js', 'utf8')

// ---- 最小同步包装：在四段调用点前插入留痕（**不改动卡的任何逻辑**）----
// 原序列（:2311-2314）
const SEQ = `  RegexBinding();
  loadSettingsToChatSquashForm = ChatSquash();
  loadSettingsToMacroNestForm = MacroNest();
  syncSPresetToolRegistrations();`
if (!SRC.includes(SEQ)) { console.error('[FATAL] 未找到 bootstrap 序列，卡源码可能变了'); process.exit(3) }
const TRACED = `  try { window.__hb69 = { ran: [], err: [] } } catch (e) {}
  window.__hb69Mark = (n, f) => { try { const r = f(); window.__hb69.ran.push(n); return r } catch (e) { window.__hb69.err.push(n + ': ' + (e && e.message)); throw e } }
  window.__hb69Mark('RegexBinding', () => RegexBinding());
  loadSettingsToChatSquashForm = window.__hb69Mark('ChatSquash', () => ChatSquash());
  loadSettingsToMacroNestForm = window.__hb69Mark('MacroNest', () => MacroNest());
  window.__hb69Mark('syncSPresetToolRegistrations', () => syncSPresetToolRegistrations());`
SRC = SRC.replace(SEQ, TRACED)
console.log(`[src] 已插入四段留痕（${SRC.length} 字节）`)

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
    exceptions.push(`${String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 180)} @ ${String(d?.url ?? '').slice(0, 70)}:${d?.lineNumber}`)
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
// 清掉上一轮可能残留的卡对象痕迹（避免误判"已存在"）
await ev(`(() => { delete window.SPresetToolBinding; window.__hb69 = undefined; return true })()`)

exceptions.length = 0
console.log('[inject]', JSON.stringify(await ev(`(() => {
  const s = document.createElement('script'); s.id = '__hb69b__'
  s.textContent = ${JSON.stringify(SRC)}
  document.body.appendChild(s); return { ok: true }
})()`, false)))

for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 1000))
  if (await ev(`!!window.__hb69 && window.__hb69.ran.length + window.__hb69.err.length >= 4`) === true) break
}
await new Promise(r => setTimeout(r, 2000))

const out = await ev(`(() => {
  const ctx = window.SillyTavern.getContext()
  const t = window.__hb69 || { ran: [], err: [] }
  return {
    四段已执行: t.ran,
    四段执行中的异常: t.err,
    // 各段的**特征副作用**（证明"不只是被调用，而是真的做了事"）
    RegexBinding_副作用_sortable回调已挂: typeof window.regexBinding_onSortableStart === 'function',
    ChatSquash_副作用_菜单项已建: !!document.querySelector('#s_preset_settings'),
    syncSPresetToolRegistrations_工具API: window.SPresetToolBinding ? Object.keys(window.SPresetToolBinding) : null,
    // 卡的模块面
    SPresetImports: window.SPresetImports ? Object.keys(window.SPresetImports).length : null,
    versionNumber: typeof window.versionNumber === 'undefined' ? null : window.versionNumber,
    eventSource有events: !!(ctx.eventSource && ctx.eventSource.events),
  }
})()`)

console.log('\n=== 四段功能逐段证据 ===')
console.log(JSON.stringify(out, null, 2))
console.log('\n=== 页面异常 ===')
console.log(exceptions.length ? exceptions.slice(0, 10).join('\n') : '(无)')

await ev(`(() => { const s = document.getElementById('__hb69b__'); if (s) s.remove(); return true })()`)
console.log('\n[cleanup] 已移除注入 script')
ws.close()
