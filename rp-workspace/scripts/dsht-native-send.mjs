#!/usr/bin/env node
/**
 * dsht-native-send.mjs — 最忠实路径：读完发送按钮的 CSS 矩形 → 换算设备像素 → 用 adb 原生 tap
 * 为什么：CDP Input 域的合成事件在本 WebView 里表现异常（点击到达按钮但 React 提交未生效、
 *        Enter 不产生 document keydown 却清了草稿）；adb input 走的是 Android 输入栈 = 真用户路径。
 *
 * 用法: node dsht-native-send.mjs [--dismiss]   # --dismiss 先按 BACK 收键盘
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const ADB = process.env.DSHT_ADB ?? '<path-to-adb>'
const argv = process.argv.slice(2)
const PORT = '9333'

if (argv.includes('--dismiss')) {
  execFileSync(ADB, ['shell', 'input', 'keyevent', '4'], { stdio: 'inherit' })
  await new Promise(r => setTimeout(r, 1200))
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'fail'); return r.result?.value }
await send('Runtime.enable')

const info = JSON.parse(await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^send message$/i.test(x.getAttribute('aria-label')||''));
  const ed = document.querySelector('.uV2eYG_input');
  const dpr = devicePixelRatio;
  if (!b) return JSON.stringify({ err: 'no-btn' });
  const r = b.getBoundingClientRect();
  return JSON.stringify({ css: { x: r.x, y: r.y, w: r.width, h: r.height }, dpr,
    dev: { x: Math.round((r.x + r.width/2) * dpr), y: Math.round((r.y + r.height/2) * dpr) },
    disabled: b.disabled, draft: ed ? (ed.textContent||'').trim() : null });
})()`))
if (info.err) { console.error('FATAL', info.err); ws.close(); process.exit(1) }
console.error('按钮 CSS:', JSON.stringify(info.css), 'dpr:', info.dpr, '→ 设备坐标:', info.dev.x, info.dev.y)
console.error('disabled:', info.disabled, '草稿:', JSON.stringify(info.draft))
if (info.disabled) { console.error('按钮 disabled，终止'); ws.close(); process.exit(1) }

execFileSync(ADB, ['shell', 'input', 'tap', String(info.dev.x), String(info.dev.y)], { stdio: 'inherit' })
console.error(`已原生 tap (${info.dev.x},${info.dev.y})`)
await new Promise(r => setTimeout(r, 5000))
console.error('点击后草稿:', JSON.stringify(await evalJs(`(document.querySelector('.uV2eYG_input')?.textContent||'').trim().slice(0,60)`)))
ws.close()
