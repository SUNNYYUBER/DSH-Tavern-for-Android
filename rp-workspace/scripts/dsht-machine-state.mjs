#!/usr/bin/env node
/** dsht-machine-state.mjs — 直接读取 composer 状态机内部快照（inputActions.snapshot / core.state） */
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
  const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
  let n = btn[fk], ib = null, d = 0;
  while (n && d < 60) { const p = n.memoizedProps; if (p && p.inputActions && p.sessionId !== undefined && p.useInput) { ib = n; break } n = n.return; d++ }
  if (!ib) return 'no-ib';
  const ia = ib.memoizedProps.inputActions;
  const out = { iaKeys: Object.keys(ia), iaProto: Object.getOwnPropertyNames(Object.getPrototypeOf(ia)) };
  try { out.snapshot = JSON.parse(JSON.stringify(ia.snapshot)) } catch (e) { out.snapshotErr = e.message }
  try {
    const core = ia.core;
    out.coreKeys = Object.keys(core);
    out.coreState = JSON.parse(JSON.stringify(core.state));
  } catch (e) { out.coreErr = e.message }
  try { out.imageIds = JSON.stringify(ia.imageIds) } catch (e) { out.imageIdsErr = e.message }
  try { out.disposed = ia.disposed } catch (e) {}
  try { out.imageSendInFlight = ia.imageSendInFlight } catch (e) {}
  return JSON.stringify(out, null, 1);
})()`))
ws.close()
