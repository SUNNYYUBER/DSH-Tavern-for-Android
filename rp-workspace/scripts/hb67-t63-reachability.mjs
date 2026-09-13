// hb67-t63-reachability.mjs — 只读探针：钉死卡注入脚本的「就绪块」是否已执行
// 【为什么必须先做】TASK-LIST 里 T-63「判据 B：当前未可达」的旧读数（7 个 iframe 帧
// 的 window.versionNumber 全 undefined）**口径错位** —— versionNumber 由 inject.js 写在
// **宿主页**（:47 初值 / :2214 就绪块），读 iframe 帧必然 undefined，与"就绪块是否执行"无关。
// 本探针在**宿主页 context** 直读，把"是否会被执行"变成可复跑判据。
// 零写入：只读 globals 与 DOM，不发任何状态变更请求。
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const PORT = process.env.CDP_PORT ?? '9333'

const token = (() => {
  try {
    const out = execFileSync(ADB, ['-s', 'emulator-5554', 'shell',
      'run-as com.dshtavern.app cat files/.dsh/dsht-token'], { encoding: 'utf8' })
    return out.trim()
  } catch { return '' }
})()

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).catch(e => {
  console.error('CDP 不可达：', e.message); process.exit(2)
})
const page = list.find(t => t.type === 'page' && !String(t.url).startsWith('devtools://'))
if (!page) { console.error('未找到宿主页 target', JSON.stringify(list.map(t => [t.type, t.url?.slice(0, 60)]))); process.exit(2) }
console.log('[目标页]', page.url?.slice(0, 100))

const { WebSocket } = globalThis
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
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')

const EXPR = `(() => {
  const out = {}
  // 宿主页 top 的卡脚本痕迹（inject.js 顶层与就绪块都写在宿主页）
  out.topVersionNumber = typeof window.versionNumber === 'undefined' ? 'undefined' : window.versionNumber
  out.topOldST = typeof window.oldST === 'undefined' ? 'undefined' : window.oldST
  out.hasSPresetImports = typeof window.SPresetImports !== 'undefined'
  out.hasSTVersionImports = typeof window.STVersionImports !== 'undefined'
  out.sillyTavern = typeof window.SillyTavern
  out.ctxHasEventSource = !!(window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext()?.eventSource)
  // 卡用 script[id$="_imports"] 注入模块容器
  const imps = Array.from(document.querySelectorAll('script[id$="_imports"]'))
  out.importScriptCount = imps.length
  out.importScriptIds = imps.map(s => s.id)
  out.importScriptSnippets = imps.map(s => String(s.textContent || '').slice(0, 260))
  // 卡的四个模块端点当前 HTTP 码（只读 GET）
  return out
})()`

const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: false })
console.log('\n=== 宿主页只读读数 ===')
console.log(JSON.stringify(r.result.value, null, 2))

// 四个端点实况（在页内 fetch，走宿主 origin）
const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    const urls = ['/version','/script.js','/scripts/utils.js','/scripts/preset-manager.js','/scripts/openai.js']
    const out = {}
    for (const u of urls) {
      try { const res = await fetch(u, { method: 'GET' }); out[u] = res.status } catch (e) { out[u] = 'ERR:' + e.message }
    }
    return out
  })()`,
  returnByValue: true, awaitPromise: true,
})
console.log('\n=== 四个端点 HTTP 码（宿主 origin 内实测）===')
console.log(JSON.stringify(probe.result.value, null, 2))
ws.close()
