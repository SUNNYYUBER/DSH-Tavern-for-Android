#!/usr/bin/env node
// cdp-locate.mjs — 用官方深链事件打开指定 DSHT 会话
// 用法: node cdp-locate.mjs [端口] <sessionId>
// 依据：dsht-rp-ui index.tsx L146+ 监听 window 'dsht-rp-ui:locate-session'
import { setTimeout as sleep } from 'node:timers/promises'
const PORT = process.argv[2] || '9333'
const SID = process.argv[3]
if (!SID) { console.error('用法: node cdp-locate.mjs [端口] <sessionId>'); process.exit(1) }
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const {res,rej} = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await new Promise(r => { ws.onopen = r })
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) return 'ERR:'+JSON.stringify(r.exceptionDetails).slice(0,300); return r.result.value }
console.log('listener?', await ev('window.__dshtLocateConsumed === true'))
console.log('dispatch:', await ev(`(()=>{window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session',{detail:{sessionId:${JSON.stringify(SID)}}}));return 'ok'})()`))
await sleep(6000)
console.log('state:', await ev(`JSON.stringify({ed:!!document.querySelector('[contenteditable="true"]'),send:!!document.querySelector('button[aria-label="Send message"]'),title:document.title})`))
ws.close()
