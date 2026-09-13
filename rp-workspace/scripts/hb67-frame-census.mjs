// hb67-frame-census.mjs — 只读：列出所有 frame + 宿主页 TH 脚本容器，判定"加载器是否在场"
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const PORT = process.env.CDP_PORT ?? '9333'
void ADB

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())
const page = list.find(t => t.type === 'page' && !String(t.url).startsWith('devtools://'))
const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
const events = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  } else if (m.method) events.push(m)
})
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await new Promise(r => setTimeout(r, 1500))

// 帧树
const tree = events.filter(e => e.method === 'Page.frameNavigated').map(e => ({
  url: String(e.params.frame.url).slice(0, 110), parent: e.params.frame.parentId ?? '(top)',
}))
// 一次性列举当前所有帧（用 DOM 侧 iframe 数 + 宿主页容器）
const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const out = {}
    const iframes = Array.from(document.querySelectorAll('iframe'))
    out.iframeCount = iframes.length
    out.iframeTitles = iframes.map(f => f.getAttribute('title') || f.getAttribute('data-dsht-role') || '(no title)')
    out.thContainer = document.querySelectorAll('[data-dsht-th-runtime]').length
    out.hostBodyScripts = Array.from(document.querySelectorAll('script[src]')).map(s => String(s.src).slice(0, 90)).slice(0, 20)
    // 当前会话 / 预设线索
    out.rpSlugHints = Array.from(document.querySelectorAll('[class*=dsht-rp]')).slice(0,3).map(e => e.className).join('|')
    return out
  })()`,
  returnByValue: true,
})
console.log('=== 宿主页帧/容器普查 ===')
console.log(JSON.stringify(r.result.value, null, 2))
console.log('\n=== Page.frameNavigated（本轮 1.5s 内） ===')
console.log(JSON.stringify(tree, null, 2))
ws.close()
