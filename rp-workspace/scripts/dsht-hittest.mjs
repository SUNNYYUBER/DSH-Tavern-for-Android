#!/usr/bin/env node
/** dsht-hittest.mjs — 对发送按钮做命中测试，找出真正的顶层接收元素 */
import process from 'node:process'
const PORT = '9333'
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'fail'); return r.result?.value }
await send('Runtime.enable')

console.log(await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /^send message$/i.test(b.getAttribute('aria-label')||''));
  if (!btn) return 'no-btn';
  const r = btn.getBoundingClientRect();
  const cx = Math.round(r.x + r.width/2), cy = Math.round(r.y + r.height/2);
  const chain = document.elementsFromPoint(cx, cy).map(e => e.tagName + '.' + String(e.className||'').slice(0,45) + (e===btn?' <== BUTTON':''));
  const cs = getComputedStyle(btn);
  return JSON.stringify({
    rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
    center: {cx, cy},
    chain,
    btnStyle: { pe: cs.pointerEvents, vis: cs.visibility, disp: cs.display, z: cs.zIndex, op: cs.opacity },
    btnConnected: btn.isConnected,
    btnParent: btn.parentElement ? btn.parentElement.tagName + '.' + String(btn.parentElement.className).slice(0,45) : null,
  }, null, 1);
})()`))
ws.close()
