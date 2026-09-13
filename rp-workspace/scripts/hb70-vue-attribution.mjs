// hb70-vue-attribution.mjs — 判清 `ReferenceError: Vue is not defined` 的**帧归属与归属方**
//
// 【为什么要单独判】goal 的判据写「零 ReferenceError」。实测中该异常出现过，但
// T-37(c) 的既有结论是「**卡自己**从 CDN 拉 Vue，Vue 未就绪时 vue-router 先执行 → 报错；
// 真 ST 首页与 TT 同样如此 ⇒ 不是移植缺口」。两者必须对齐 —— 否则要么漏了真缺陷，
// 要么把卡侧问题记成我方缺陷。
// 本探针做三件（全部只读）：
//   ① 采集异常时**同时记录帧归属**（用 CDP 的 frameId / 执行上下文）
//   ② 列出所有帧及其 URL，指出该异常落在哪个帧、由哪个脚本引发
//   ③ 判定该脚本是不是"卡的宿主注入脚本"（对比卡的注入链路）
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })
const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')

const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const exceptions = []
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })

// 帧表（用于把 frameId 映射成 URL）
const frames = new Map()
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Page.frameNavigated') {
    const f = x.params.frame
    frames.set(f.id, { url: String(f.url).slice(0, 110), parent: f.parentId ?? '(top)', name: f.name ?? '' })
  }
  if (x.method === 'Runtime.exceptionThrown') {
    const d = x.params?.exceptionDetails
    exceptions.push({
      frameId: d?.stackTrace?.callFrames?.[0]?.scriptId ?? null,
      execCtx: d?.executionContextId,
      desc: String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 190),
      url: String(d?.url ?? '').slice(0, 110),
      line: d?.lineNumber,
      stack: (d?.stackTrace?.callFrames ?? []).slice(0, 4).map(c => `${c.functionName || '(anon)'} @${String(c.url).slice(0, 80)}:${c.lineNumber}`),
    })
  }
  if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}
console.log('[wait] 宿主门面就绪；开始采集 12 秒异常…')
exceptions.length = 0
await new Promise(r => setTimeout(r, 12000))

// 帧普查：宿主页 + iframe（含跨源 CDN 页）
const census = await ev(`(() => {
  const out = { host: {}, iframes: [] }
  out.host.url = location.href.slice(0, 90)
  out.host.vueIsDefined = typeof window.Vue
  out.host.scripts = Array.from(document.querySelectorAll('script[src]')).map(s => String(s.src).slice(0, 100))
  const ifr = Array.from(document.querySelectorAll('iframe'))
  out.iframeCount = ifr.length
  out.iframes = ifr.slice(0, 12).map(f => {
    let sameOrigin = false, innerVue = null, srcs = []
    try { sameOrigin = true; innerVue = typeof f.contentWindow.Vue; srcs = Array.from(f.contentDocument?.querySelectorAll('script[src]') ?? []).map(s => String(s.src).slice(0, 100)) } catch (e) { sameOrigin = false }
    return { title: (f.getAttribute('title') || '(no title)').slice(0, 40), sameOrigin, innerVue, srcs }
  })
  return out
})()`)

console.log('\n=== 帧普查 ===')
console.log(JSON.stringify(census, null, 2))
console.log('\n=== 采集到的异常（含帧归属）===')
console.log(exceptions.length ? JSON.stringify(exceptions, null, 2) : '(无)')
console.log('\n=== 帧表（Page.frameNavigated）===')
for (const [id, f] of frames) console.log(`  ${id.slice(0, 12)}  ${f.url}   parent=${String(f.parent).slice(0, 12)}`)
ws.close()
