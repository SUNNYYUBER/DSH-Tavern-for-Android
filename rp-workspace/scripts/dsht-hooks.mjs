#!/usr/bin/env node
/** dsht-hooks.mjs — 遍历 InputBar fiber 的 hook 链，找出 composer 状态机快照 */
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
  const out = [];
  let h = ib.memoizedState, i = 0;
  while (h && i < 60) {
    const s = h.memoizedState;
    let desc;
    if (s && typeof s === 'object') {
      const ks = Object.keys(s).slice(0, 14);
      desc = '{' + ks.join(',') + '}';
      if ('draft' in s || 'phase' in s) desc += ' <== INPUT SNAPSHOT ' + JSON.stringify({ draft: s.draft, phase: s.phase, imageIds: s.imageIds, queueLen: s.queue && s.queue.length });
    } else desc = String(s).slice(0, 60);
    out.push(i + ': ' + desc);
    h = h.next; i++;
  }
  return JSON.stringify({ hooks: out, count: i }, null, 1);
})()`))
ws.close()
