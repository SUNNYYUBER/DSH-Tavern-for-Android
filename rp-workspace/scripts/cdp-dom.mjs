#!/usr/bin/env node
// cdp-dom.mjs — dump 前端 DOM 关键结构（找输入框/按钮）
// 用法: node cdp-dom.mjs [端口=9333]
const PORT = process.argv[2] || '9333'
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
if (!t) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
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
  if (r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails).slice(0, 250)
  return r.result.value
}
console.log('href=', await ev('location.href'))
console.log('contenteditables=', await ev('JSON.stringify([...document.querySelectorAll("[contenteditable]")].map(e=>({tag:e.tagName,ce:e.getAttribute("contenteditable"),cls:String(e.className).slice(0,90),ph:e.getAttribute("data-placeholder")})))'))
console.log('textareas=', await ev('JSON.stringify([...document.querySelectorAll("textarea")].map(e=>({cls:String(e.className).slice(0,90),ph:e.placeholder})))'))
console.log('buttons=', await ev('JSON.stringify([...document.querySelectorAll("button")].slice(0,25).map(e=>({al:e.getAttribute("aria-label"),t:(e.textContent||"").trim().slice(0,24)})))'))
console.log('bodyTail=', (await ev('document.body.innerHTML.slice(-1200)') || '').slice(0, 1200))
ws.close()
