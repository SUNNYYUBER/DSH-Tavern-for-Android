#!/usr/bin/env node
/**
 * ui-recon2.mjs — 深挖 RP 楼层 DOM（只读）
 * 目标：找到「回退 / 编辑 / 重新生成 / 变体(swipe)」的真实选择器，以及楼层容器。
 */
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
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
  const res = {};
  // 1) 关键词命中：回退/编辑/重新生成/变体/swipe
  const KW = ['回退','编辑','重新生成','变体','swipe','翻页','删除','重试','撤销'];
  res.kwHits = [];
  const all = [...document.querySelectorAll('button,[role=button],svg,[class*=Action],[class*=action]')];
  for (const e of all) {
    const t = ((e.getAttribute('aria-label')||'') + ' ' + (e.getAttribute('title')||'') + ' ' + (e.className||'')).toString();
    const hit = KW.find(k => t.includes(k));
    if (hit) res.kwHits.push({ kw: hit, tag: e.tagName.toLowerCase(), cls: (e.className||'').toString().slice(0,70), aria: e.getAttribute('aria-label')||'', title: e.getAttribute('title')||'', text: (e.textContent||'').trim().slice(0,24), vis: vis(e) });
  }
  res.kwHits = res.kwHits.slice(0, 40);
  // 2) class 前缀分布（找出 DSHT 自有类名）
  const prefix = {};
  for (const e of document.querySelectorAll('*')) {
    const c = (e.className||'').toString();
    for (const tok of c.split(/\\s+/)) {
      if (/^(dsht|rp-|Rp)/i.test(tok)) prefix[tok] = (prefix[tok]||0)+1;
    }
  }
  res.dshtClasses = Object.entries(prefix).sort((a,b)=>b[1]-a[1]).slice(0, 60);
  // 3) 主滚动容器 + 其子节点构成
  const scrollers = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
  res.scrollers = scrollers.slice(0,6).map(e => ({ cls:(e.className||'').toString().slice(0,70), kids: e.children.length, sh: e.scrollHeight, ch: e.clientHeight,
    kidBrief: [...e.children].slice(0,10).map(k => (k.className||'').toString().slice(0,50) + '|' + (k.textContent||'').trim().slice(0,18)) }));
  return JSON.stringify(res);
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
