#!/usr/bin/env node
/**
 * dsht-ui-send2.mjs — 真实点击「发送」按钮（CDP Input 真鼠标事件）+ 提交后取证
 * 与 dsht-ui-send.mjs 的区别：不依赖 aria-label 猜按钮，而是枚举候选并对其真实矩形发鼠标事件。
 * 用法: node dsht-ui-send2.mjs [--dry]
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const PORT = '9333'
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'fail'); return r.result?.value }
await send('Runtime.enable')

const info = JSON.parse(await evalJs(`(() => {
  const out = [];
  for (const b of document.querySelectorAll('button,[role=button],a')) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const al = b.getAttribute('aria-label') || '';
    const tx = (b.textContent||'').trim().slice(0,20);
    const cls = String(b.className||'').slice(0,60);
    out.push({ al, tx, cls, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), dis: b.disabled === true });
  }
  const ed = document.querySelector('.uV2eYG_input');
  const er = ed ? ed.getBoundingClientRect() : null;
  return JSON.stringify({ buttons: out, composer: er ? {x:Math.round(er.x),y:Math.round(er.y),w:Math.round(er.width),h:Math.round(er.height)} : null,
    draft: ed ? (ed.textContent||'').trim() : null, innerH: innerHeight, innerW: innerWidth });
})()`))
console.error('composer:', JSON.stringify(info.composer), 'draft:', JSON.stringify(info.draft), 'viewport:', info.innerW + 'x' + info.innerH)
const cands = info.buttons.filter(b => /send/i.test(b.al) || b.y > info.innerH - 180)
for (const c of cands) console.error('  候选:', JSON.stringify(c))
if (dry) { ws.close(); process.exit(0) }

// 优先 aria-label=Send message，否则取最靠近右下角的大圆按钮
let target = info.buttons.find(b => /^send message$/i.test(b.al) && !b.dis)
if (!target) {
  const pool = info.buttons.filter(b => !b.dis && b.y > info.innerH - 200 && b.w >= 28 && b.w <= 90)
  pool.sort((a, b) => (b.x + b.y) - (a.x + a.y))
  target = pool[0]
}
if (!target) { console.error('FATAL 找不到发送按钮'); ws.close(); process.exit(1) }
const cx = Math.round(target.x + target.w / 2), cy = Math.round(target.y + target.h / 2)

const mode = argv.includes('--touch') ? 'touch' : argv.includes('--enter') ? 'enter' : 'mouse'
console.error(`点击目标(${mode}): aria="${target.al}" cls="${target.cls}" @(${cx},${cy}) size=${target.w}x${target.h} disabled=${target.dis}`)

if (mode === 'touch') {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, radiusX: 8, radiusY: 8, force: 1 }] })
  await new Promise(r => setTimeout(r, 90))
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
} else if (mode === 'enter') {
  for (const type of ['keyDown', 'rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined, unmodifiedText: type === 'keyDown' ? '\r' : undefined })
  }
} else {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, buttons: type === 'mousePressed' ? 1 : 0 })
    await new Promise(r => setTimeout(r, 120))
  }
}
await new Promise(r => setTimeout(r, 5000))
console.error('点击后草稿:', JSON.stringify(await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,60)`)))
console.error('页面内错误/横幅:', await evalJs(`JSON.stringify([...document.querySelectorAll('[class*=error],[class*=Error],[role=alert]')].map(e=>(e.textContent||'').trim().slice(0,80)).filter(Boolean).slice(0,5))`))
ws.close()
