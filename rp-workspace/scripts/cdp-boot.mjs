#!/usr/bin/env node
const PORT = process.argv[2] || '9333'
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const {res,rej} = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await new Promise(r => { ws.onopen = r })
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) return 'ERR:'+JSON.stringify(r.exceptionDetails).slice(0,300); return r.result.value }
console.log('boot=', await ev('JSON.stringify({has:!!window.__DSH_BOOT__, entries:(window.__DSH_BOOT__&&window.__DSH_BOOT__.entries||[]).map(r=>typeof r==="string"?r:r.id)})'))
console.log('rpUI=', await ev('JSON.stringify({btn:!!document.querySelector(".dsht-rp-sidebar-btn"),overlay:!!document.querySelector(".dsht-rp-overlay"),style:!!document.getElementById("dsht-rp-ui-style")})'))
console.log('sidebar=', await ev('JSON.stringify({sessions:[...document.querySelectorAll("[class*=session]")].length, items:[...document.querySelectorAll("a,li,button")].map(e=>(e.textContent||"").trim()).filter(t=>t&&t.length<50).slice(0,25)})'))
ws.close()
