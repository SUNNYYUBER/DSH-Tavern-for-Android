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
// 打印工作区卡片的完整 DOM 及可点子元素
console.log('cardHtml=', (await ev(`(()=>{const c=[...document.querySelectorAll('div')].filter(e=>/^Into the Unknown/.test((e.textContent||'').trim())&&e.getBoundingClientRect().height>30&&e.getBoundingClientRect().height<220);if(!c.length)return 'none';c.sort((a,b)=>a.textContent.length-b.textContent.length);return c[0].outerHTML.slice(0,1800)})()`)||'').slice(0,1800))
ws.close()
