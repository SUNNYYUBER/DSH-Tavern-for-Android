#!/usr/bin/env node
// ui-recon3.mjs — DOM 树轮廓（只读），定位消息列表实际所在
import process from 'node:process'
const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? '').slice(0, 400) }
  let v = r.result?.value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { /* keep */ } }
  return v
}
const out = await ev(`(() => {
  const res = {};
  res.totalEls = document.querySelectorAll('*').length;
  res.iframes = [...document.querySelectorAll('iframe')].map(f => ({ src: (f.src||f.getAttribute('src')||'').slice(0,80), w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height) }));
  // 带 shadowRoot 的宿主
  const sh = [...document.querySelectorAll('*')].filter(e => e.shadowRoot);
  res.shadowHosts = sh.map(e => ({ tag: e.tagName.toLowerCase(), cls: (e.className||'').toString().slice(0,60), kids: e.shadowRoot.children.length }));
  // 顶层 outline：body 子链 + 每个节点的「最大文本块」
  const outline = (el, d) => {
    const r = el.getBoundingClientRect();
    const mine = [...el.children].map(k => (k.textContent||'').length).reduce((a,b)=>Math.max(a,b), 0);
    return { d, tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,55),
      box: Math.round(r.width)+'x'+Math.round(r.height), sh: el.scrollHeight, ch: el.clientHeight,
      nkids: el.children.length, textLen: (el.textContent||'').length, maxKid: mine,
      txt: (el.textContent||'').trim().slice(0,26) };
  };
  res.bodyOutline = [...document.body.children].map(e => outline(e, 1));
  // 全文档中「文本量最大且无子元素承载」的叶子块（= 消息正文候选）
  const leaves = [...document.querySelectorAll('div,p,span')]
    .filter(e => e.children.length === 0 && (e.textContent||'').trim().length > 40)
    .slice(0, 10).map(e => ({ cls: (e.className||'').toString().slice(0,60), len: (e.textContent||'').trim().length, txt: (e.textContent||'').trim().slice(0,60) }));
  res.bigLeaves = leaves;
  return JSON.stringify(res);
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
