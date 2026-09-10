#!/usr/bin/env node
// cdp-probe.mjs — 探查 DSHT 前端 WebView 的加载状态 / 重载
// 用法: node cdp-probe.mjs [端口=9333] [--reload]
// 前置: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//
// 用途（心跳 32 起）：热推插件产物后需重启应用，重启初期 WebView 可能停在
// "Webpage not available"；此脚本先探状态，必要时 Page.reload 再等就绪。

const PORT = process.argv[2] || '9333'
const DO_RELOAD = process.argv.includes('--reload')

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
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id)
    pend.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
await new Promise(r => { ws.onopen = r })
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}

if (DO_RELOAD) {
  await send('Page.enable').catch(() => {})
  await send('Page.reload', { ignoreCache: true })
  console.error('[cdp-probe] 已触发 Page.reload(ignoreCache)')
  await new Promise(r => setTimeout(r, 3000))
}

const ev0 = { target: { id: target.id, url: target.url, title: target.title } }
const out = {
  ...ev0,
  href: await ev('location.href'),
  readyState: await ev('document.readyState'),
  title: await ev('document.title'),
  bodyLen: await ev('document.body ? document.body.innerHTML.length : -1'),
  hasEditor: await ev('!!document.querySelector(\'[contenteditable="true"]\')'),
  hasSendBtn: await ev('!!document.querySelector(\'button[aria-label="Send message"]\')'),
}
console.log(JSON.stringify(out, null, 1))
if (out.bodyLen === -1 || out.bodyLen < 200) {
  console.log('BODY:', await ev('document.body ? document.body.innerHTML.slice(0, 500) : "NO BODY"'))
}
ws.close()
