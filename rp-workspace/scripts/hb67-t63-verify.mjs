// hb67-t63-verify.mjs — 设备实测（只读）：四个 ST 标准模块端点 + 真 ES module import
// 判据（T-63）：① 四个 URL 全 200 且 MIME 正确；② 卡的四个静态 import 各自可解析；
//              ③ 内容为合法 ES module（真 import 不抛）。
// 零写入：只发 GET 与页内 import，不改任何状态。
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`

// 重新建立 CDP 转发（app 重启后 PID 变化）
const unix = execFileSync(ADB, ['-s', 'emulator-5554', 'shell', 'cat /proc/net/unix'], { encoding: 'utf8' })
const m = unix.match(/@webview_devtools_remote_(\d+)/)
if (!m) { console.error('未找到 webview devtools socket'); process.exit(2) }
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
console.log('[CDP] 已转发 webview_devtools_remote_' + m[1])

const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page' && !String(t.url).startsWith('devtools://'))
const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
  }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')

const EXPR = `(async () => {
  const out = { endpoints: {}, mime: {}, imports: {}, errors: [] }
  const urls = ['/version','/script.js','/scripts/utils.js','/scripts/preset-manager.js','/scripts/openai.js']

  // ① 端点 HTTP 码 + MIME
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'GET' })
      out.endpoints[u] = r.status
      out.mime[u] = r.headers.get('content-type')
    } catch (e) { out.endpoints[u] = 'ERR:' + e.message }
  }

  // ② 卡的四个静态 import —— 逐字复刻 tmp/t37-inject.js:2219-2243 的生成结果
  const specs = [
    ['openai',       '/scripts/openai.js',        ['promptManager','MessageCollection','Message','sendOpenAIRequest']],
    ['script',       '/script.js',                ['streamingProcessor']],
    ['presetManager','/scripts/preset-manager.js',['getPresetManager']],
    ['utils',        '/scripts/utils.js',         ['equalsIgnoreCaseAndAccents','getSanitizedFilename']],
  ]
  for (const [name, url, items] of specs) {
    try {
      const mod = await import(url)
      const missing = items.filter(k => !(k in mod))
      out.imports[name] = { ok: missing.length === 0, missing, keys: Object.keys(mod) }
    } catch (e) {
      out.imports[name] = { ok: false, error: String(e && e.message) }
      out.errors.push(name + ': ' + (e && e.message))
    }
  }

  // ③ 语义抽验（真调用，不是只看键在不在）
  try {
    const sc = await import('/script.js')
    await (sc.versionReady || Promise.resolve())
    out.displayVersion = sc.displayVersion
    out.streamingProcessorIsNull = sc.streamingProcessor === null
  } catch (e) { out.errors.push('script 语义: ' + e.message) }
  try {
    const u = await import('/scripts/utils.js')
    out.utilsSemantics = {
      equals: u.equalsIgnoreCaseAndAccents('café','cafe'),
      sanitized: await u.getSanitizedFilename('a/b:c*d'),
    }
  } catch (e) { out.errors.push('utils 语义: ' + e.message) }
  try {
    const pm = await import('/scripts/preset-manager.js')
    const mgr = pm.getPresetManager('openai')
    out.presetManager = {
      sameInstance: mgr === pm.getPresetManager('openai'),
      otherApiUndefined: pm.getPresetManager('kobold') === undefined,
      methods: ['getCompletionPresetByName','getAllPresets','getSelectedPresetName','savePreset','deletePreset','updateList'].filter(k => typeof mgr?.[k] !== 'function'),
    }
    const byName = await mgr.getCompletionPresetByName('__dsht_probe_nonexistent__')
    out.presetManager.notFoundIsNull = byName === null
  } catch (e) { out.errors.push('preset-manager 语义: ' + e.message) }
  try {
    const oa = await import('/scripts/openai.js')
    const msgs = await oa.promptManager.loadMessages()
    out.openai = {
      messageCount: msgs.collection.length,
      hasMessageClass: typeof oa.Message === 'function',
      sendRejects: await oa.sendOpenAIRequest('normal', [], undefined, {}).then(() => false, () => true),
    }
  } catch (e) { out.errors.push('openai 语义: ' + e.message) }

  // ④ 宿主页是否已出现卡的 import 容器（当前会话未启用该卡时为 0，属正常）
  out.importScriptCount = document.querySelectorAll('script[id$="_imports"]').length
  return out
})()`

const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true })
console.log('\n=== T-63 设备实测 ===')
console.log(JSON.stringify(r.result.value, null, 2))
if (r.exceptionDetails) console.error('页内异常:', JSON.stringify(r.exceptionDetails).slice(0, 400))
ws.close()
