#!/usr/bin/env node
/** dsht-lexical-probe.mjs — 读 Lexical 真实编辑器状态（判定 CDP 键入是否被受控状态机接受） */
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

const probe = `(() => {
  const out = {};
  const roots = document.querySelectorAll('[data-lexical-editor=true], [contenteditable=true]');
  out.roots = roots.length;
  const ed = document.querySelector('.uV2eYG_input');
  out.domText = ed ? (ed.textContent||'') : null;
  // Lexical 把编辑器实例挂在 root element 的 __lexicalEditor 上
  let le = null;
  for (const r of roots) { if (r.__lexicalEditor) { le = r.__lexicalEditor; break } }
  if (!le && ed) {
    let n = ed;
    while (n && !le) { if (n.__lexicalEditor) le = n.__lexicalEditor; n = n.parentElement }
  }
  if (le) {
    try {
      out.lexicalText = le.getEditorState().read(() => le._rootElement && le.getRootElement() ? le.getRootElement().textContent : null);
    } catch (e) { out.errRead = String(e.message) }
    try { out.lexicalText2 = le.getEditorState().read(() => { const s = le.getEditorState(); return null }); } catch {}
    out.lexicalKeys = Object.keys(le).slice(0, 12);
  } else { out.lexicalKeys = null }
  return JSON.stringify(out);
})()`
console.log(await evalJs(probe))
ws.close()
