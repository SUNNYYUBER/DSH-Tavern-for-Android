// hb67-card-bootstrap.mjs — 核心判据：真实卡的宿主注入脚本在 DSHT 里能否完整跑完
//
// 【判据（T-63/§6.5 共同验收口径）】
//   真实卡的宿主注入脚本完整跑完、零 ReferenceError / 零 TypeError，
//   且四段核心功能全部执行（RegexBinding / ChatSquash / MacroNest / syncSPresetToolRegistrations）。
//
// 【做法】把卡的加载器逻辑**逐字复刻**到宿主页执行（它本来就是这么干的）：
//   ① fetch('/version') → window.versionNumber
//   ② importFromModule('SPresetImports', [...])  ← 四条静态 import（这就是之前 404 的地方）
//   ③ importFromModule('STVersionImports', [{displayVersion}])
//   ④ ctx.eventSource.on('module_imported', ...) 收结果
//   ⑤ 检查两侧容器是否都建起来、模块是否都能解析、有无异常
// 零写入：只读 + 页内构造 script 标签；结束移除探针容器。
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })
const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')

const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })
const consoleErrors = []
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Runtime.exceptionThrown') consoleErrors.push(String(x.params?.exceptionDetails?.text ?? '').slice(0, 160))
  if (x.method === 'Runtime.consoleAPICalled' && x.params?.type === 'error') {
    consoleErrors.push('[console.error] ' + (x.params.args ?? []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 200))
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
  if (await ev(`typeof window.SillyTavern === 'object'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}

// 逐字复刻卡的 importFromModule（tmp/t37-inject.js:103-127）
const RESULT = await ev(`(async () => {
  const log = []
  const seen = new Set()
  const ctx = window.SillyTavern.getContext()

  // ① /version
  let vn = 10000
  try {
    const d = await (await fetch('/version')).json()
    const v = String(d.pkgVersion).split('.')
    vn = parseInt(v[0]) * 10000 + parseInt(v[1]) * 100 + parseInt(v[2])
  } catch (e) { log.push('version fetch 失败: ' + e.message) }

  const errors = []
  window.addEventListener('error', e => errors.push(String(e.message).slice(0, 200)))

  // 监听 module_imported（卡在 :2245 做的同一件事）
  const imported = {}
  try {
    ctx.eventSource.on('module_imported', data => { imported[data.id] = Object.keys(data.imports ?? {}) })
  } catch (e) { log.push('eventSource.on 失败: ' + e.message) }

  // ② 卡的 importFromModule 逐字复刻（含生成代码的写法）
  function importFromModule(container, imports) {
    let injectContent = ''
    for (const it of imports) injectContent += 'import { ' + it.items.join(', ') + ' } from "' + it.from + '.js";\\n'
    injectContent += '\\nconst ' + container + ' = {};'
    for (const it of imports) for (const item of it.items) {
      injectContent += '\\nObject.defineProperty(' + container + ", '" + item + "', { enumerable: true, get: () => " + item + ' });'
    }
    injectContent += '\\n'
    injectContent += '\\nwindow.' + container + ' = ' + container + ';\\n'
    injectContent += "\\n  const data = {\\n    'id': '" + container + "',\\n    'imports': " + container + ',\\n  }\\n  '
    // 卡原文此处直接调 ctx.eventSource.emit(...)（它的模块级作用域里有 ctx 变量）。
    // 探针里没有该变量，故显式从 window.SillyTavern 取 —— 仅为探针适配，逻辑逐字等价。
    injectContent += "window.SillyTavern.getContext().eventSource.emit('module_imported', data);\\n"
    const s = document.createElement('script')
    s.id = container + '_imports_hb67'
    s.type = 'module'
    s.textContent = injectContent
    document.body.appendChild(s)
  }

  importFromModule('SPresetImports_hb67', [
    { items: ['promptManager', 'MessageCollection', 'Message', 'sendOpenAIRequest'], from: './scripts/openai' },
    { items: ['streamingProcessor'], from: './script' },
    { items: ['getPresetManager'], from: './scripts/preset-manager' },
    { items: ['equalsIgnoreCaseAndAccents', 'getSanitizedFilename'], from: './scripts/utils' },
  ])
  importFromModule('STVersionImports_hb67', [{ items: ['displayVersion'], from: './script' }])

  await new Promise(r => setTimeout(r, 2500))

  const out = {
    versionNumber: vn,
    importedContainers: Object.keys(imported),
    SPresetImportsKeys: window.SPresetImports_hb67 ? Object.keys(window.SPresetImports_hb67) : null,
    STVersionImportsDisplayVersion: window.STVersionImports_hb67 ? window.STVersionImports_hb67.displayVersion : null,
    streamingProcessorIsNull: window.SPresetImports_hb67 ? window.SPresetImports_hb67.streamingProcessor === null : null,
    pageErrors: errors,
    log,
  }
  // 清理探针容器
  for (const id of ['SPresetImports_hb67_imports_hb67', 'STVersionImports_hb67_imports_hb67']) {
    const el = document.getElementById(id); if (el) el.remove()
  }
  delete window.SPresetImports_hb67
  delete window.STVersionImports_hb67
  return out
})()`)

console.log('=== 真实卡 bootstrap 复刻（宿主页）===')
console.log(JSON.stringify(RESULT, null, 2))
console.log('\n=== 页面级异常/错误（本轮采集）===')
console.log(consoleErrors.length ? consoleErrors.slice(0, 12).join('\n') : '(无)')
ws.close()
