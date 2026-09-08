// cdp-debug.mjs — 对 3090 页面执行调试 JS（文件版，避开 shell 转义）
import { readFileSync } from 'node:fs'
const base = 'http://127.0.0.1:9222'
const list = await (await fetch(`${base}/json`)).json()
const page = list.find(p => p.type === 'page' && (p.url || '').includes('127.0.0.1:3090'))
if (!page) { console.error('no page'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.onmessage = m => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}
ws.onopen = async () => {
  try {
    await send('Runtime.enable')
    const src = readFileSync(process.argv[2] ?? '-', 'utf8')
    const r = await send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) console.error('exception:', r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    else console.log(typeof r.result?.value === 'string' ? r.result.value : JSON.stringify(r.result?.value, null, 1))
  } catch (e) { console.error('cdp error:', e.message) }
  ws.close(); process.exit(0)
}
ws.onerror = () => { console.error('ws fail'); process.exit(1) }
