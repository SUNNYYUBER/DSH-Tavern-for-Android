#!/usr/bin/env node
/** dsht-panel.mjs — 查/关 浮动面板（剧情控制台 / 世界书控制 等 ui-draggable）
 *  用法: node dsht-panel.mjs list
 *        node dsht-panel.mjs close "剧情控制台"
 *        node dsht-panel.mjs rect  "剧情控制台"
 */
import process from 'node:process'
const argv = process.argv.slice(2)
const [cmd, name] = argv
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EVALERR ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 400); return r.result?.value }
await send('Runtime.enable')

const findPanels = `[...document.querySelectorAll('.ui-draggable')].map(p => { const r = p.getBoundingClientRect(); return { title: (p.innerText || '').split('\\n')[0], x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })`

if (cmd === 'list') {
  console.log(await ev(`JSON.stringify((${findPanels}), null, 1)`))
} else if (cmd === 'rect') {
  console.log(await ev(`(() => ${findPanels}.find(p => p.title.includes(${JSON.stringify(name)})))()`))
} else if (cmd === 'close') {
  const out = await ev(`(() => {
    const p = (${findPanels}).find(p => p.title.includes(${JSON.stringify(name)}))
    if (!p) return 'PANEL_NOT_FOUND'
    const el = document.elementFromPoint(p.x + p.w - 18, p.y + 18)
    if (!el) return 'NO_CLOSE'
    el.click()
    return 'CLICKED ' + el.tagName + ' ' + (el.innerText || '').trim().slice(0, 20)
  })()`)
  console.log(out)
} else {
  console.log('用法: dsht-panel.mjs list|rect|close [名称]')
}
ws.close()
