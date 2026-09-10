#!/usr/bin/env node
/**
 * dsht-click-diag.mjs — 判定「点击是否到达发送按钮 / Enter 是否触发提交」
 * 步骤：装事件记录 → 触摸点击发送按钮 → dump 事件 → 再 Enter → dump
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

await evalJs(`(() => {
  window.__ev = [];
  const rec = (tag) => (e) => { window.__ev.push(tag + ':' + (e.target.tagName||'?') + '.' + String(e.target.className||'').slice(0,30) + ' trusted=' + e.isTrusted); if (window.__ev.length>40) window.__ev.shift() };
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click','touchstart','touchend','keydown']) {
    document.addEventListener(t, rec(t), true);
  }
  const b = [...document.querySelectorAll('button')].find(x => /^send message$/i.test(x.getAttribute('aria-label')||''));
  window.__sendBtn = b;
  if (b) { b.addEventListener('click', () => window.__ev.push('BUTTON-ONCLICK')); b.addEventListener('pointerdown', () => window.__ev.push('BUTTON-ONPOINTERDOWN')) }
  return 'ok ' + !!b;
})()`)

const r = JSON.parse(await evalJs(`(() => { const b=window.__sendBtn; const q=b.getBoundingClientRect(); return JSON.stringify({cx:Math.round(q.x+q.width/2), cy:Math.round(q.y+q.height/2), dis:b.disabled, type:b.type}) })()`))
console.error('按钮:', JSON.stringify(r))

console.error('--- 触摸点击 ---')
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.cx, y: r.cy, radiusX: 8, radiusY: 8, force: 1 }] })
await new Promise(t => setTimeout(t, 80))
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await new Promise(t => setTimeout(t, 1500))
console.log('触摸后事件:', await evalJs(`JSON.stringify(window.__ev)`))
console.log('触摸后草稿:', await evalJs(`JSON.stringify((document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,40))`))

await evalJs(`window.__ev = []`)
console.error('--- Enter ---')
for (const type of ['keyDown', 'rawKeyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined })
}
await new Promise(t => setTimeout(t, 2500))
console.log('Enter 后事件:', await evalJs(`JSON.stringify(window.__ev)`))
console.log('Enter 后草稿:', await evalJs(`JSON.stringify((document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,40))`))
console.log('发送按钮 disabled:', await evalJs(`window.__sendBtn.disabled`))
ws.close()
