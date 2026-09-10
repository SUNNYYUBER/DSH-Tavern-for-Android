#!/usr/bin/env node
/** dsht-deep.mjs — 深挖 composer：occurrences / toast / notice / promptError */
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
  const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
  let n = btn[fk], ib = null, d = 0;
  while (n && d < 60) { const p = n.memoizedProps; if (p && p.inputActions && p.sessionId !== undefined && p.useInput) { ib = n; break } n = n.return; d++ }
  window.__ib = ib;
  const out = {};
  let h = ib.memoizedState, i = 0;
  while (h && i < 70) {
    const s = h.memoizedState;
    if (i === 2) out.snapshot = { draft: s.draft, phase: s.phase, draftRev: s.draftRev,
      occurrences: (s.occurrences||[]).map(o => ({ source: o.source, ref: o.ref, offset: o.offset, length: o.length })),
      attachmentIds: s.attachmentIds, queue: s.queue };
    if (i === 22) out.promptError = s;
    if (i === 56) out.toast = s;
    h = h.next; i++;
  }
  out.notices = (() => { try { const s = ib.memoizedProps.useNotices(x => x); return s } catch (e) { return 'err:' + e.message } })();
  out.hasInputTriggers = typeof ib.memoizedProps.keyboard;
  return JSON.stringify(out, null, 1);
})()`))
ws.close()
