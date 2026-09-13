// hb67-diag.mjs — 诊断：列出全部 CDP target + 宿主页关键 globals
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })
const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })

const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
console.log('=== 全部 targets ===')
for (const t of list) console.log(`  [${t.type}] ${String(t.url).slice(0, 90)}  title=${String(t.title).slice(0, 40)}`)

const page = list.find(t => t.type === 'page' && String(t.url).includes('3080')) || list.find(t => t.type === 'page')
console.log('\n选定 target:', String(page?.url).slice(0, 90))

const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', e => {
  const m2 = JSON.parse(e.data)
  if (m2.id && pending.has(m2.id)) { const { res } = pending.get(m2.id); pending.delete(m2.id); res(m2.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')

// 列出所有 execution context（关键：SillyTavern 可能装在别的 context 里）
await send('Runtime.evaluate', { expression: '1' })
await new Promise(r => setTimeout(r, 800))

const r = await send('Runtime.evaluate', {
  expression: `(() => ({
    href: location.href.slice(0, 80),
    readyState: document.readyState,
    hasST: typeof window.SillyTavern,
    stKeys: window.SillyTavern ? Object.keys(window.SillyTavern).slice(0, 12) : null,
    hasGetContext: !!(window.SillyTavern && window.SillyTavern.getContext),
    extSettingsType: (() => { try { const c = window.SillyTavern.getContext(); return typeof c.extensionSettings } catch (e) { return 'ERR:' + e.message } })(),
    dshtMarkers: Object.keys(window).filter(k => /dsht|DSHT/i.test(k)).slice(0, 15),
    bodyChildren: document.body ? document.body.children.length : -1,
  }))()`,
  returnByValue: true,
})
console.log('\n=== 宿主页读数 ===')
console.log(JSON.stringify(r.result.value, null, 2))
ws.close()
