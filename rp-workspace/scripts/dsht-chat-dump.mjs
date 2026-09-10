#!/usr/bin/env node
/** dsht-chat-dump.mjs — 导出聊天区可见文本 + 消息动作按钮（回退/编辑/变体等）
 *  用法: node dsht-chat-dump.mjs [--port 9333] [--max 2500]
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'
const mi = argv.indexOf('--max')
const MAX = mi >= 0 ? Number(argv[mi + 1]) : 2500

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EVALERR ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 300); return r.result?.value }
await send('Runtime.enable')

const script = `(() => {
  const main = document.querySelector('main') || document.body
  const txt = (main.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean)
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean)
  const out = { url: location.href, lineCount: txt.length, buttons: [...new Set(btns)].slice(0, 50), text: txt.join('\\n').slice(0, ${MAX}) }
  return JSON.stringify(out, null, 1)
})()`
console.log(await ev(script))
ws.close()
