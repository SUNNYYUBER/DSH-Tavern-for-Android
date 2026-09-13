// hb67-bridge-diag.mjs — 诊断 T-42 桥为何在设备上未生效
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
ws.addEventListener('message', e => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) } })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable')

// 页面加载了哪些 dsht 相关资源
const reqs = []
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Network.responseReceived' && /dsht|client\.js|plugin/i.test(x.params?.response?.url ?? '')) {
    reqs.push(`${x.params.response.status} ${String(x.params.response.url).slice(0, 110)}`)
  }
})
await send('Page.reload', { ignoreCache: true })
await new Promise(r => setTimeout(r, 9000))
console.log('=== 页面加载的 dsht 相关资源 ===')
console.log([...new Set(reqs)].join('\n') || '(无)')

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const out = {}
    // 桥的实现是否在页面里（源码级标记）
    out.hasBridgeFn = typeof window.__resetHostRegexBridge !== 'undefined'
    const st = window.SillyTavern
    out.stKeys = st ? Object.keys(st) : null
    // 通过 getContext 能否看到 saveSettingsDebounced
    try {
      const ctx = st.getContext()
      out.ctxKeys = Object.keys(ctx).slice(0, 60)
      out.hasSaveSettings = typeof ctx.saveSettingsDebounced
      out.regexIsArray = Array.isArray(ctx.extensionSettings && ctx.extensionSettings.regex)
      out.regexLen = Array.isArray(ctx.extensionSettings?.regex) ? ctx.extensionSettings.regex.length : -1
    } catch (e) { out.ctxErr = String(e.message) }
    // 模块级符号是否可达（vite/esbuild bundle 里是闭包，故预期 false）
    out.scriptTags = Array.from(document.querySelectorAll('script[src]')).map(s => String(s.src).slice(0, 90))
    return out
  })()`,
  returnByValue: true,
})
console.log('\n=== 宿主页 ===')
console.log(JSON.stringify(r.result.value, null, 2))
ws.close()
