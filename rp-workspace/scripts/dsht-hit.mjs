#!/usr/bin/env node
/** dsht-hit.mjs — 命中测试：在给定 CSS 坐标上查询 elementFromPoint 及祖先链
 *  用法: node dsht-hit.mjs <cssX> <cssY> [--port 9333]
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const [x, y] = [Number(argv[0]), Number(argv[1])]
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

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
  const el = document.elementFromPoint(${x}, ${y})
  if (!el) return 'NOTHING at ${x},${y}'
  const chain = []
  let n = el, d = 0
  while (n && d < 8) { chain.push(n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 2).join('.') : '') + ' :: ' + (n.innerText || '').trim().slice(0, 40).replace(/\\n/g, '|')); n = n.parentElement; d++ }
  const r = el.getBoundingClientRect()
  return JSON.stringify({ hit: el.tagName, innerText: (el.innerText || '').trim().slice(0, 60), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, chain }, null, 1)
})()`
console.log(await ev(script))
ws.close()
