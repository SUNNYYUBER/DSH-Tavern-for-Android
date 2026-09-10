#!/usr/bin/env node
/**
 * dsht-ui-type.mjs — 定位「CDP 键入失败」的页面内焦点状态（诊断用）
 * 用法: node dsht-ui-type.mjs "文本"
 */
import process from 'node:process'
const PORT = process.env.CDP_PORT || '9333'
const text = process.argv[2] ?? '回归测试：请回一句话'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
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
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.value
}
await send('Runtime.enable')

const C = '.uV2eYG_input'
console.error('A. 初始:', await evalJs(`JSON.stringify({
  innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
  vis: document.visibilityState, hasFocus: document.hasFocus(),
  active: document.activeElement ? (document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0,40)) : null,
  editables: document.querySelectorAll('[contenteditable=true]').length,
})`))

const box = JSON.parse(await evalJs(`(() => { const e=document.querySelector('${C}'); if(!e) return null; const r=e.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), r:{x:r.x,y:r.y,w:r.width,h:r.height}}) })()`))
console.error('B. 输入框:', JSON.stringify(box))
const { x, y } = box
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}
console.error('C. 点击后:', await evalJs(`JSON.stringify({
  active: document.activeElement ? (document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0,50)) : null,
  isEditor: document.activeElement === document.querySelector('${C}'),
  hasFocus: document.hasFocus(),
})`))

// 直接 focus() 兜底
console.error('D. 强制 focus():', await evalJs(`(() => { const e=document.querySelector('${C}'); if(!e) return 'no-el'; e.focus(); return document.activeElement===e ? 'focused' : 'refused:'+document.activeElement.tagName })()`))

await send('Input.insertText', { text })
console.error('E. insertText 后草稿:', JSON.stringify(await evalJs(`(document.querySelector('${C}')?.textContent||'').trim().slice(0,60)`)))

// 兜底二：直接派发 beforeinput/input（React 合成事件路径）
const fallback = await evalJs(`(() => {
  const e = document.querySelector('${C}');
  if (!e) return 'no-el';
  if ((e.textContent||'').trim()) return 'had-text';
  e.focus();
  const sel = getSelection(); sel.removeAllRanges();
  const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); sel.addRange(r);
  let ok = false;
  try { ok = document.execCommand('insertText', false, ${JSON.stringify(text)}); } catch (err) { return 'exec-err:'+err.message }
  return 'execCommand=' + ok + ' text=' + JSON.stringify((e.textContent||'').trim().slice(0,60));
})()`)
console.error('F. execCommand 兜底:', fallback)
await new Promise(r => setTimeout(r, 800))
console.error('G. 稳定后草稿:', JSON.stringify(await evalJs(`(document.querySelector('${C}')?.textContent||'').trim().slice(0,60)`)))
console.error('H. 发送按钮:', await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/Send message/i.test(x.getAttribute('aria-label')||'')); return b? JSON.stringify({disabled:b.disabled}) : 'no-btn' })()`))
ws.close()
