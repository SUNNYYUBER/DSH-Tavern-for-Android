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
// 找 Add workspace 菜单项
console.log('menu=', (await ev(`(()=>{const items=[...document.querySelectorAll('[class*=menu],[class*=Menu],[class*=listbox],[class*=popup]')];return items.map(e=>e.textContent.slice(0,300)).join(' ||| ')})()`)||'').slice(0,1200))
console.log('addBtn=', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Add workspace/.test(x.textContent));if(!b)return 'no';b.click();return 'clicked'})()`))
await sleep(2500)
console.log('after=', (await ev(`(()=>{const d=[...document.querySelectorAll('[class*=portal],[class*=overlay],[class*=root]')].map(e=>e.textContent.slice(0,400)).join(' ||| ');return d})()`)||'').slice(0,1500))
ws.close()
