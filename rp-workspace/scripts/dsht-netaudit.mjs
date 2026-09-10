#!/usr/bin/env node
/**
 * dsht-netaudit.mjs — 用 Resource Timing 审计「提交时到底有没有发出 HTTP 请求」
 * Resource Timing 捕获文档内全部网络请求，**不依赖**对 window.fetch 打补丁，
 * 因此可以排除「客户端提前绑定了 fetch 引用导致 hook 失明」这一干扰。
 */
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

console.error('清空 resource timing …')
await evalJs(`performance.clearResourceTimings(); 'ok'`)

// 直接走 React 路径提交（最内层，绕过一切输入管道）
const called = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /^send message$/i.test(b.getAttribute('aria-label')||''));
  if (!btn) return 'no-btn';
  const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
  let n = btn[fk], ib = null, d = 0;
  while (n && d < 60) { const p = n.memoizedProps; if (p && p.inputActions && p.sessionId !== undefined && p.useInput) { ib = n; break } n = n.return; d++ }
  if (!ib) return 'no-ib';
  window.__ib = ib;
  try { ib.memoizedProps.inputActions.submit(); return 'submitted' } catch (e) { return 'throw: ' + e.message }
})()`)
console.error('提交调用:', called)
await new Promise(r => setTimeout(r, 6000))

const res = await evalJs(`JSON.stringify(performance.getEntriesByType('resource').map(e => ({
  n: e.name.replace(/^https?:\\/\\/[^/]+/, '').slice(0, 90), init: e.initiatorType, dur: Math.round(e.duration), size: e.transferSize
})).slice(-30), null, 1)`)
console.log('提交后新产生的请求:', res)
console.error('草稿:', JSON.stringify(await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,40)`)))
console.error('会话状态(React):', await evalJs(`(() => { const p = window.__ib && window.__ib.memoizedProps; if (!p) return 'n/a'; return JSON.stringify({ disabled: p.disabled ?? null, blocked: p.blocked ?? null, sessionId: p.sessionId }) })()`))
ws.close()
