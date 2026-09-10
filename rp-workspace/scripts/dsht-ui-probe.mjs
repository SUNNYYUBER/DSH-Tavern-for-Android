#!/usr/bin/env node
/**
 * dsht-ui-probe.mjs — 诊断「UI 发消息为什么不派发」
 * =====================================================================
 * 目的：在 WebView 页面上下文里**插桩网络出口**（fetch / XHR / WebSocket.send），
 *       然后真实提交一条消息，把「UI 究竟发没发请求、发到哪、载荷是什么」变成硬证据。
 *
 * 这是对静默失败族的直接取证手段：草稿被清空 ≠ 提交成功。
 *
 * 用法：
 *   node dsht-ui-probe.mjs                # 只 dump 状态 + 已装插桩
 *   node dsht-ui-probe.mjs --submit "文本" # 装插桩 → 输入 → 提交 → dump 网络记录
 *   node dsht-ui-probe.mjs --dump         # 只 dump 已记录的网络调用（不提交）
 *
 * 前置：adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const doSubmit = argv.includes('--submit')
const textIdx = argv.indexOf('--submit')
const text = doSubmit && argv[textIdx + 1] && !argv[textIdx + 1].startsWith('--') ? argv[textIdx + 1] : '回归测试：请回一句话'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target —— 先 adb forward'); process.exit(1) }
console.error('[probe] target:', page.url?.slice(0, 80))

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.value
}
await send('Runtime.enable')

// ---------- 1) 装插桩（幂等） ----------
await evalJs(`(() => {
  if (window.__dshtNet) return 'already';
  window.__dshtNet = { fetch: [], xhr: [], ws: [], errs: [] };
  const cap = (arr, o) => { arr.push(o); if (arr.length > 60) arr.shift() };
  const short = (u) => String(u).replace(/^https?:\\/\\/[^/]+/, '');

  const of = window.fetch;
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : (input && input.url);
    const rec = { t: Date.now(), url: short(u), method: (init && init.method) || (input && input.method) || 'GET' };
    try { rec.body = typeof (init && init.body) === 'string' ? String(init.body).slice(0, 400) : null } catch {}
    cap(window.__dshtNet.fetch, rec);
    return of.apply(this, arguments).then(r => { rec.status = r.status; return r },
      e => { rec.netErr = String(e && e.message || e); cap(window.__dshtNet.errs, { where: 'fetch', url: rec.url, err: rec.netErr }); throw e });
  };

  const OX = XMLHttpRequest.prototype.open, SX = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return OX.apply(this, arguments) };
  XMLHttpRequest.prototype.send = function (b) {
    const rec = { t: Date.now(), method: this.__m, url: short(this.__u), body: typeof b === 'string' ? b.slice(0, 400) : null };
    cap(window.__dshtNet.xhr, rec);
    this.addEventListener('error', () => cap(window.__dshtNet.errs, { where: 'xhr', url: rec.url, err: 'error event' }));
    return SX.apply(this, arguments);
  };

  const SW = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try {
      const s = typeof d === 'string' ? d : (d instanceof ArrayBuffer ? new TextDecoder().decode(d) : String(d));
      cap(window.__dshtNet.ws, { t: Date.now(), url: short(this.url), data: s.slice(0, 500) });
    } catch {}
    return SW.apply(this, arguments);
  };

  const OW = window.WebSocket;
  window.__dshtConns = [];
  window.WebSocket = function (u, p) { window.__dshtConns.push(u); return new OW(u, p) };
  window.WebSocket.prototype = OW.prototype;
  Object.assign(window.WebSocket, OW);

  window.addEventListener('error', e => cap(window.__dshtNet.errs, { where: 'window', err: String(e.message) }));
  window.addEventListener('unhandledrejection', e => cap(window.__dshtNet.errs, { where: 'promise', err: String(e.reason && e.reason.message || e.reason) }));
  return 'installed';
})()`)

// ---------- 2) dump 当前 UI 状态 ----------
const state = await evalJs(`(() => {
  const ed = document.querySelector('.uV2eYG_input');
  const btn = [...document.querySelectorAll('button')].find(x => /Send message/i.test(x.getAttribute('aria-label')||''));
  const composerBox = ed ? (() => { const r = ed.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} })() : null;
  const at = composerBox ? (document.elementFromPoint(composerBox.x + composerBox.w/2, composerBox.y + composerBox.h/2) || {}) : {};
  return JSON.stringify({
    url: location.href.slice(0, 90),
    hasComposer: !!ed, draft: ed ? (ed.textContent||'').trim().slice(0,50) : null,
    hasSendBtn: !!btn, sendDisabled: btn ? btn.disabled : null, sendAria: btn ? btn.getAttribute('aria-label') : null,
    composerBox,
    hitElement: at.className ? String(at.className).slice(0,80) : (at.tagName||null),
    wsConns: (window.__dshtConns||[]).map(u => String(u).slice(0,70)),
  });
})()`)
console.error('[probe] UI 状态:', state)

const before = await evalJs(`JSON.stringify({fetch: window.__dshtNet.fetch.length, xhr: window.__dshtNet.xhr.length, ws: window.__dshtNet.ws.length})`)
console.error('[probe] 提交前计数:', before)

const doClick = argv.includes('--click')

if (doClick) {
  // 直接点「Send message」按钮（草稿须已由 dsht-ui-type.mjs 键入）
  const beforeN = JSON.parse(await evalJs(`JSON.stringify({f:window.__dshtNet.fetch.length,x:window.__dshtNet.xhr.length,w:window.__dshtNet.ws.length})`))
  const clicked = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Send message/i.test(x.getAttribute('aria-label')||''));
    if (!b) return 'no-btn'; if (b.disabled) return 'disabled'; b.click(); return 'clicked';
  })()`)
  console.error('[probe] 点击发送按钮:', clicked)
  await new Promise(r => setTimeout(r, 6000))
  const afterN = JSON.parse(await evalJs(`JSON.stringify({f:window.__dshtNet.fetch.length,x:window.__dshtNet.xhr.length,w:window.__dshtNet.ws.length})`))
  console.error('[probe] 网络计数 before/after:', JSON.stringify(beforeN), '→', JSON.stringify(afterN))
  console.error('[probe] 点击后草稿:', JSON.stringify(await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,50)`)))
  console.error('[probe] 页内错误:', await evalJs(`JSON.stringify((window.__dshtNet.errs||[]).slice(-6))`))
}

if (doSubmit) {
  const { x, y, w, h } = JSON.parse(state).composerBox || {}
  if (!x && !y) { console.error('[probe] FATAL 无输入框'); ws.close(); process.exit(1) }
  const cx = Math.round(x + w / 2), cy = Math.round(y + h / 2)

  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.insertText', { text })
  const typed = await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim()`)
  console.error('[probe] 键入后草稿:', JSON.stringify(typed))
  console.error('[probe] 键入后计数:', await evalJs(`JSON.stringify({fetch: window.__dshtNet.fetch.length, xhr: window.__dshtNet.xhr.length, ws: window.__dshtNet.ws.length})`))

  // 只按 Enter（上次已证 button 无效、Enter 清空草稿）
  for (const type of ['keyDown', 'rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined })
  }
  await new Promise(r => setTimeout(r, 4000))
  const draft = await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim()`)
  console.error('[probe] Enter 后草稿:', JSON.stringify(draft))
}

const dump = await evalJs(`JSON.stringify({
  fetch: window.__dshtNet.fetch.slice(-12),
  xhr: window.__dshtNet.xhr.slice(-12),
  ws: window.__dshtNet.ws.slice(-14),
  errs: window.__dshtNet.errs.slice(-8),
}, null, 1)`)
console.log(dump)
ws.close()
