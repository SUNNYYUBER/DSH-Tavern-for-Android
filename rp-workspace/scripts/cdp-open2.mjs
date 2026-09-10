#!/usr/bin/env node
// cdp-open2.mjs — 先选 workspace，再用深链开会话
import { setTimeout as sleep } from 'node:timers/promises'
const PORT = process.argv[2] || '9333'
const SID = process.argv[3]
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const {res,rej} = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await new Promise(r => { ws.onopen = r })
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) return 'ERR:'+JSON.stringify(r.exceptionDetails).slice(0,300); return r.result.value }
// 当前视图
console.log('view=', await ev('JSON.stringify({chooseWorkspace:!!document.querySelector(\'button[aria-label="Choose workspace"]\'),ed:!!document.querySelector(\'[contenteditable="true"]\')})'))
// 关掉 overlay
console.log('closeOverlay=', await ev(`(()=>{const b=document.querySelector('.dsht-rp-back');if(b){b.click();return 'closed'}return 'none'})()`))
await sleep(800)
// 派发深链
for (let i = 1; i <= 3; i++) {
  await ev(`window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session',{detail:{sessionId:${JSON.stringify(SID)}}}))`)
  await sleep(3000)
  const s = await ev(`JSON.stringify({ed:!!document.querySelector('[contenteditable="true"]'),consumed:window.__dshtLocateConsumed===true})`)
  console.log(`try${i}:`, s)
  if (s.includes('"ed":true')) break
}
ws.close()
