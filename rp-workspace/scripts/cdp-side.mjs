#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises'
const PORT = process.argv[2] || '9333'
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const {res,rej} = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await new Promise(r => { ws.onopen = r })
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) return 'ERR:'+JSON.stringify(r.exceptionDetails).slice(0,300); return r.result.value }
// 打开侧边栏
console.log('open=', await ev(`(()=>{const b=document.querySelector('button[aria-label="Open sidebar"]')||document.querySelector('button[aria-label="打开侧边栏"]');if(!b)return 'no';b.click();return 'ok'})()`))
await sleep(1500)
console.log('sidebarText=', (await ev(`(()=>{const s=document.querySelector('[data-slot*="sidebar"],aside,[class*=sidebar]');return s?s.textContent.slice(0,800):'NO SIDEBAR'})()`)||'').slice(0,900))
console.log('clickableTexts=', (await ev(`JSON.stringify([...document.querySelectorAll('button,a,li,[role=treeitem],[role=option]')].map(e=>e.textContent.trim()).filter(t=>t&&t.length<60).slice(0,40))`)||'').slice(0,1200))
ws.close()
