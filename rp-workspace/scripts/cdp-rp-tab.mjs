#!/usr/bin/env node
// cdp-rp-tab.mjs — 点 RP 启动器里的 tab / 列表项
// 用法: node cdp-rp-tab.mjs [端口] [tab名] [列表项关键字]
import { setTimeout as sleep } from 'node:timers/promises'
const PORT = process.argv[2] || '9333'
const TAB = process.argv[3] || '会话'
const KEY = process.argv[4] || ''
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const {res,rej} = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await new Promise(r => { ws.onopen = r })
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) return 'ERR:'+JSON.stringify(r.exceptionDetails).slice(0,300); return r.result.value }
// 点 tab
console.log('tab:', await ev(`(()=>{const b=[...document.querySelectorAll('.dsht-rp-tab')].find(x=>x.textContent.trim()===${JSON.stringify(TAB)});if(!b)return 'no-tab';b.click();return 'ok'})()`))
await sleep(2000)
console.log('main:', (await ev(`(()=>{const m=document.querySelector('.dsht-rp-main');return m?m.innerHTML.slice(0,2500):'NO MAIN'})()`)||'').slice(0,2500))
if (KEY) {
  console.log('pick:', await ev(`(()=>{const k=${JSON.stringify(KEY)}.toLowerCase();const els=[...document.querySelectorAll('.dsht-rp-main *')].filter(e=>e.children.length===0&&e.textContent.toLowerCase().includes(k));if(!els.length)return 'no-match';let el=els[0];for(let i=0;i<5&&el;i++){const c=el.closest('[data-id],li,button,.dsht-rp-card,.dsht-rp-row');if(c){el=c;break}el=el.parentElement}el.click();return 'clicked:'+el.textContent.trim().slice(0,60)})()`))
  await sleep(5000)
  console.log('final:', await ev(`JSON.stringify({ed:!!document.querySelector('[contenteditable="true"]'),send:!!document.querySelector('button[aria-label="Send message"]')})`))
}
ws.close()
