#!/usr/bin/env node
/**
 * ui-recon.mjs — RP 聊天 UI 的 DOM 侦察（只读，不改状态）
 * 目的：为 UI 面回归找出**稳定的选择器**，避免"猜选择器"。
 * 用法：node ui-recon.mjs [--port 9333]
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? '').slice(0, 300) }
  let v = r.result?.value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { /* keep */ } }
  return v
}

const report = await ev(`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
  const brief = (e) => ({
    tag: e.tagName.toLowerCase(),
    cls: (e.className || '').toString().slice(0, 90),
    aria: e.getAttribute('aria-label') || '',
    title: e.getAttribute('title') || '',
    text: (e.textContent || '').trim().slice(0, 30),
    vis: vis(e),
  });
  const out = {};
  out.url = location.href.slice(0, 120);
  out.title = document.title;
  out.composer = !!document.querySelector('[contenteditable="true"]');
  // 所有可点元素（button + role=button + 带 aria-label 的元素）
  out.buttons = [...document.querySelectorAll('button,[role="button"],[aria-label]')]
    .filter(vis).map(brief).filter(b => b.aria || b.title || b.text).slice(0, 70);
  // 楼层节点候选
  out.floorCandidates = [...document.querySelectorAll('[data-seq],[data-message-id],[data-floor],[class*="floor"],[class*="Floor"]')]
    .slice(0, 12).map(e => ({ ...brief(e), attrs: [...e.attributes].map(a => a.name + '=' + a.value.slice(0, 24)).slice(0, 6) }));
  // 顶层结构：body 直接子链（找到 RP overlay 根）
  out.rootChain = (() => {
    const chain = []; let e = document.querySelector('[contenteditable="true"]');
    while (e && e !== document.body && chain.length < 12) { chain.push(brief(e)); e = e.parentElement }
    return chain;
  })();
  return JSON.stringify(out);
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
