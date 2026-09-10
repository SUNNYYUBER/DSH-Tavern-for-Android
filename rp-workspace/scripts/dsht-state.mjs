#!/usr/bin/env node
/** dsht-state.mjs — 打印当前客户端状态：URL / 已渲染会话 id / composer 是否可交互
 *  用法: node dsht-state.mjs [--port 9333]
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EVALERR ' + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)).slice(0, 400); return r.result?.value }
await send('Runtime.enable')

console.log(await ev(`(() => {
  const out = { href: location.href, hash: location.hash, pathname: location.pathname }
  // 已渲染的会话 id：扫 DOM 属性 + 文本
  const ids = new Set()
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes || []) {
      const m = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(a.value)
      if (m) ids.add(m[0])
    }
  }
  out.domSessionIds = [...ids]
  out.bodyText = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)
  out.composerCount = document.querySelectorAll('[contenteditable=true]').length
  out.hasSendBtn = !!document.querySelector('button[aria-label="Send message" i]')
  return JSON.stringify(out, null, 1)
})()`))
ws.close()
