#!/usr/bin/env node
/**
 * dsht-rp-call.mjs — 以「已认证」身份直接调用数据面路由（不经信封 RPC）
 * =====================================================================
 * 与 dsh-rpc.mjs 的区别（重要，别用错）：
 *   · dsh-rpc.mjs 走 `/api/<controller>/<method>` 信封 → **响应体为空**，结果经 WS 异步下发。
 *   · 本脚本走**同源直连** `/dsht-rp/*`（= 客户端 rpc.ts rpApi 的真实形态）→ 直接拿到 JSON。
 *   凡我方数据面（dsht-rp / dsht-tavern-helper / dsht-memory / dsht-mvu / dsht-prompt-template）
 *   的验证一律用本脚本；只有核心 API（session/* 等）才需要信封。
 *
 * 用法：
 *   node dsht-rp-call.mjs <base> <path> [payloadJson] [--port 9333]
 * 例：
 *   node dsht-rp-call.mjs dsht-rp rp/rollback-mask '{"sessionId":"session-xxx"}'
 *   node dsht-rp-call.mjs dsht-mvu mvu/data '{"sessionId":"session-xxx"}'
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'
const rest = argv.filter((a, i) => i !== pi && i !== pi + 1)
const [base, path, payloadJson = '{}'] = rest

if (!base || !path) {
  console.error('用法: node dsht-rp-call.mjs <base> <path> [payloadJson] [--port 9333]')
  process.exit(1)
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(x => x.type === 'page')
if (!page) {
  console.error('无 page target（先 adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>；注意选**应用进程**的 socket）')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
}
await new Promise((r) => { ws.onopen = r })

const url = `/${base}/${path.replace(/^\//, '')}`
const expr = `fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(JSON.parse(payloadJson)))}})
  .then(r=>r.text().then(t=>'HTTP '+r.status+' '+t)).catch(e=>'FETCHERR '+e)`

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (r.exceptionDetails) {
  console.error('EVALERR', JSON.stringify(r.exceptionDetails).slice(0, 600))
  process.exit(1)
}
const out = String(r.result.value ?? '')
console.log(out)
ws.close()
