#!/usr/bin/env node
/**
 * dsht-react-click.mjs — 绕过输入管道，直接调用 React 组件的 onClick / inputActions.submit()
 * 目的：把「点击没送达」与「应用逻辑自己空转」这两种失败彻底分开。
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

// 1) 找到 React fiber 树上的 InputBar（其 memoizedProps 同时含 inputActions 与 sessionId）
const found = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /^send message$/i.test(b.getAttribute('aria-label')||''));
  if (!btn) return 'no-btn';
  const pk = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
  const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
  const props = pk ? btn[pk] : null;
  let fiber = fk ? btn[fk] : null;
  let inputBar = null, depth = 0;
  let n = fiber;
  while (n && depth < 60) {
    const p = n.memoizedProps;
    if (p && p.inputActions && p.sessionId !== undefined && p.useInput) { inputBar = n; break }
    n = n.return; depth++;
  }
  window.__ib = inputBar;
  window.__btnProps = props;
  return JSON.stringify({
    hasReactProps: !!props, hasFiber: !!fiber,
    btnOnClickType: props ? typeof props.onClick : null,
    foundInputBar: !!inputBar,
    ibDisabled: inputBar ? inputBar.memoizedProps.disabled : null,
    ibSessionId: inputBar ? inputBar.memoizedProps.sessionId : null,
    fiberChain: depth,
  });
})()`)
console.error('探测:', found)

// 2) 读取 machine 快照（通过 useInput 的 store）
const snap = await evalJs(`(() => {
  const ib = window.__ib; if (!ib) return 'no-ib';
  const p = ib.memoizedProps;
  try {
    const s = p.useInput(x => x);
    return JSON.stringify({ draft: s && s.draft, phase: s && s.phase, imageIds: s && s.imageIds, queue: s && s.queue });
  } catch (e) { return 'useInput-throw: ' + e.message }
})()`)
console.error('machine 快照:', snap)

// 3) 直接调用 inputActions.submit()
console.error('--- 直接调用 inputActions.submit() ---')
console.error('结果:', await evalJs(`(() => {
  const ib = window.__ib; if (!ib) return 'no-ib';
  try { ib.memoizedProps.inputActions.submit(); return 'called' } catch (e) { return 'throw: ' + e.message }
})()`))
await new Promise(r => setTimeout(r, 4000))
console.error('submit 后草稿:', JSON.stringify(await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,60)`)))
console.error('submit 后 machine:', await evalJs(`(() => { const p = window.__ib.memoizedProps; try { const s = p.useInput(x=>x); return JSON.stringify({draft:s.draft, phase:s.phase}) } catch(e){ return 'err' } })()`))
console.error('toast/notice:', await evalJs(`JSON.stringify([...document.querySelectorAll('[role=alert],[class*=toast],[class*=Toast]')].map(e=>(e.textContent||'').trim().slice(0,80)).filter(Boolean).slice(0,4))`))
ws.close()
