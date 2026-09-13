// hb69-card-fullrun.mjs — goal 唯一判据：**真正执行完整卡脚本**，确认四段核心功能全部执行
//
// 【为什么必须做这一步】心跳 67 验的是「loader 复刻 + 模块面」（接口面，L131）。
// 而 goal 的判据是「真实卡的宿主注入脚本能在 DSHT 里完整跑完、零 ReferenceError、零 TypeError，
// 且四段核心功能全部执行（RegexBinding / ChatSquash / MacroNest / syncSPresetToolRegistrations）」。
// ⇒ 本探针把 tmp/t37-inject.js（220,854 B）**原样**注入宿主页，并采集：
//   ① 页面异常（Runtime.exceptionThrown）—— 零 ReferenceError / 零 TypeError
//   ② 四段功能的执行证据（各自的特征副作用）
//   ③ 卡后的 bootstrap 是否走完（:2307-2314 序列 + 容器建立）
// 零写入：不调任何写盘路由；仅内存态。结束移除注入的 script 标签。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

const SRC = readFileSync('D:/DSH RolePlay/tmp/t37-inject.js', 'utf8')
console.log(`[src] 卡脚本 ${SRC.length} 字节`)

const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
if (!m) { console.error('未找到 webview socket'); process.exit(2) }
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')

const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const exceptions = []
const consoleErrs = []
const consoleLogs = []
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Runtime.exceptionThrown') {
    const d = x.params?.exceptionDetails
    exceptions.push({
      text: String(d?.text ?? '').slice(0, 200),
      desc: String(d?.exception?.description ?? '').split('\n')[0].slice(0, 220),
      line: d?.lineNumber, col: d?.columnNumber, url: String(d?.url ?? '').slice(0, 80),
    })
  }
  if (x.method === 'Runtime.consoleAPICalled') {
    const line = (x.params?.args ?? []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 220)
    if (x.params?.type === 'error') consoleErrs.push(line)
    else if (x.params?.type === 'log' || x.params?.type === 'info') consoleLogs.push(line)
  }
  if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object' && typeof window.SillyTavern.getContext === 'function'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}
console.log('[wait] 宿主门面就绪')

// 注入前基线：记录宿主页当前状态（用于对质"卡是否真的改了东西"）
const before = await ev(`(() => {
  const ctx = window.SillyTavern.getContext()
  return {
    hasSPresetSettings: typeof window.SPresetSettings !== 'undefined',
    hasSPresetToolBinding: typeof window.SPresetToolBinding !== 'undefined',
    versionNumber: typeof window.versionNumber === 'undefined' ? null : window.versionNumber,
    regexLen: Array.isArray(ctx.extensionSettings?.regex) ? ctx.extensionSettings.regex.length : -1,
    sPresetSettingsDom: document.querySelectorAll('#s_preset_settings').length,
  }
})()`)
console.log('[before]', JSON.stringify(before))

// ---- 原样注入卡脚本（classic script，无 import/export）----
exceptions.length = 0; consoleErrs.length = 0; consoleLogs.length = 0
const injectResult = await ev(`(() => {
  try {
    const s = document.createElement('script')
    s.id = '__hb69_card__'
    s.textContent = ${JSON.stringify(SRC)}
    document.body.appendChild(s)
    return { injected: true }
  } catch (e) { return { injected: false, err: String(e && e.message) } }
})()`, false)
console.log('[inject]', JSON.stringify(injectResult))

// 卡的就绪块是 $(async () => ...) —— 等它跑完（含 4 条 module import + 4 段功能）
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const done = await ev(`typeof window.SPresetToolBinding !== 'undefined' && !!window.SPresetTempData`)
  if (done === true) { console.log(`[wait] bootstrap 到达 :2317（第 ${i + 1} 秒）`); break }
}
await new Promise(r => setTimeout(r, 3000))

// ---- 采集四段功能的执行证据（各自的特征副作用）----
const after = await ev(`(() => {
  const out = {}
  const ctx = window.SillyTavern.getContext()
  // 卡顶层已建立的对象
  out.hasSPresetSettings = typeof window.SPresetSettings !== 'undefined'
  out.hasSPresetToolBinding = typeof window.SPresetToolBinding !== 'undefined'
  out.versionNumber = typeof window.versionNumber === 'undefined' ? null : window.versionNumber
  out.sPresetSettingsDom = document.querySelectorAll('#s_preset_settings').length
  // ① RegexBinding 的证据：它建 MutationObserver 于 #saved_regex_scripts，并渲染预设正则块
  out.savedRegexScriptsExists = !!document.getElementById('saved_regex_scripts')
  out.hasPresetRegexesBlock = !!document.getElementById('preset_regexes_block')
  out.hasSPresetRegexesBlock = !!document.getElementById('saved_spreset_scripts')
  out.regexBindingFnDefined = typeof window.regexBinding_onSortableStart === 'function'
  // ② ChatSquash / ③ MacroNest 的证据：注入后在菜单里建了表单（返回值赋给 loadSettingsToChatSquashForm）
  out.sPresetMenuExists = document.querySelectorAll('#s_preset_settings *').length
  // ④ syncSPresetToolRegistrations 的证据：工具注册面
  out.sPresetToolBindingMethods = window.SPresetToolBinding ? Object.keys(window.SPresetToolBinding) : null
  // 卡的模块容器（importFromModule 产物）
  out.importContainers = Array.from(document.querySelectorAll('script[id$="_imports"]')).map(s => s.id)
  out.SPresetImports = window.SPresetImports ? Object.keys(window.SPresetImports) : null
  out.STVersionImports = window.STVersionImports ? window.STVersionImports.displayVersion : null
  return out
})()`)

console.log('\n=== 注入后 ===')
console.log(JSON.stringify(after, null, 2))

console.log('\n=== 页面异常（Runtime.exceptionThrown）===')
if (exceptions.length === 0) console.log('(无)')
else for (const e of exceptions.slice(0, 15)) console.log(`  ${e.text} | ${e.desc} @ ${e.url}:${e.line}`)

console.log('\n=== console.error ===')
console.log(consoleErrs.length ? consoleErrs.slice(0, 12).join('\n') : '(无)')
console.log('\n=== console.log/info（末 12 条）===')
console.log(consoleLogs.slice(-12).join('\n') || '(无)')

// ---- 分类统计：ReferenceError / TypeError ----
const byType = {}
for (const e of exceptions) {
  const t = /ReferenceError/.test(e.desc) ? 'ReferenceError'
    : /TypeError/.test(e.desc) ? 'TypeError'
      : 'other'
  byType[t] = (byType[t] ?? 0) + 1
}
console.log('\n=== 异常分类 ===')
console.log(JSON.stringify(byType))

// ---- 清理注入的 script 标签（不清理卡建立的内存对象，避免误伤正在用的会话）----
await ev(`(() => { const s = document.getElementById('__hb69_card__'); if (s) s.remove(); return true })()`)
console.log('\n[cleanup] 注入的 script 标签已移除（内存态对象保留，避免误伤）')
ws.close()
