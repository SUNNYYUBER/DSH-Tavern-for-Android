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
// 取消目录选择器
console.log('cancel=', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Cancel');if(!b)return 'no';b.click();return 'ok'})()`))
await sleep(1500)
// 列出可点的 workspace 项
console.log('wsItems=', (await ev(`(()=>{const els=[...document.querySelectorAll('*')].filter(e=>/Into the Unknown/i.test(e.textContent||'')&&e.children.length<4);return els.map(e=>({tag:e.tagName,cls:String(e.className).slice(0,60),t:e.textContent.trim().slice(0,60)}))})()`)||'').slice(0,1200))
ws.close()
