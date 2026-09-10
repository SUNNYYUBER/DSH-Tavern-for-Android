#!/usr/bin/env node
/** dsht-tz.mjs — 读取 WebView 的 Intl 时区表示 */
const PORT = '9333'
const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const p = t.find(x => x.type === 'page')
const ws = new WebSocket(p.webSocketDebuggerUrl)
let s = 0; const m = new Map()
const send = (me, pa = {}) => new Promise((r, j) => { const i = ++s; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: me, params: pa })) })
ws.addEventListener('message', e => { const d = JSON.parse(e.data); if (d.id && m.has(d.id)) { const q = m.get(d.id); m.delete(d.id); d.error ? q.j(new Error(JSON.stringify(d.error))) : q.r(d.result) } })
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })
await send('Runtime.enable')
const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    tz: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMin: new Date().getTimezoneOffset(),
    locale: new Intl.DateTimeFormat().resolvedOptions().locale,
    supported: (() => { try { const a = Intl.supportedValuesOf('timeZone'); return a.length + ':' + a.slice(0,3).join(',') } catch (e) { return 'nsv' } })(),
    acceptAsia: (() => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai' }).resolvedOptions().timeZone } catch (e) { return 'reject:' + e.message } })(),
  })`, returnByValue: true,
})
console.log(r.result.value)
ws.close()
