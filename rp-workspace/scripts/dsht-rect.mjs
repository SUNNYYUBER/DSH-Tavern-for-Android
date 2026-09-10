#!/usr/bin/env node
/** dsht-rect.mjs — 按可见文本定位元素，输出 CSS/设备像素坐标（供 adb input tap 使用）
 *  用法: node dsht-rect.mjs "<文本>" [--index -1] [--port 9333] [--tag button]
 *  --index -1 表示取最后一个匹配
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const text = argv[0]
const gi = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const PORT = gi('--port', '9333')
const idx = Number(gi('--index', '-1'))
const tag = gi('--tag', '*')

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
  const want = ${JSON.stringify(text)}
  const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})].filter(e => (e.innerText || '').trim() === want)
  // adb input tap 用的是**物理设备像素** → 必须用 devicePixelRatio 换算（不是 screen.width/innerWidth）
  const dpr = window.devicePixelRatio || 1
  const rows = nodes.map((e, i) => { const r = e.getBoundingClientRect(); return { i, css: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }, dev: { x: Math.round((r.x + r.width / 2) * dpr), y: Math.round((r.y + r.height / 2) * dpr) } } })
  let pick = null
  const n = ${idx}
  if (rows.length) pick = rows[n < 0 ? rows.length + n : n] ?? null
  return JSON.stringify({ dpr: Math.round(dpr * 1000) / 1000, count: rows.length, pick, rows }, null, 1)
})()`
console.log(await ev(script))
ws.close()
