// hb67-t48-e2e.mjs — 设备实测（T-48）：扩展文件路由 + Handlebars/DOMPurify 真渲染
//
// 判据：① /scripts/extensions/<ext>/<id>.html 无文件 → 真 404（不是空壳）
//       ② 放一个真模板 → 200 + 正确 MIME
//       ③ renderExtensionTemplateAsync 真渲染出 HTML（变量替换 + 消毒）
//       ④ sanitize=false 时 <script> 保留（消毒确实在起作用，不是空转）
//       ⑤ 路径穿越被拒
// 零残留：结束时删除探针模板文件与目录。
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const PKG = 'com.dshtavern.app'
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

const EXT_DIR = `files/.dsh/extensions/__hb67_probe__`
const TEMPLATE = `<div class="probe"><b>{{title}}</b><span>{{{rawHtml}}}</span></div>`

// ---- 铺探针模板（真文件，非模拟）----
sh(`run-as ${PKG} mkdir -p ${EXT_DIR}`)
const b64 = Buffer.from(TEMPLATE, 'utf8').toString('base64')
sh(`run-as ${PKG} sh -c 'echo ${b64} | base64 -d > ${EXT_DIR}/settings.html'`)
const exists = sh(`run-as ${PKG} ls ${EXT_DIR}`).trim()
console.log(`[setup] 探针模板已铺：${EXT_DIR}/settings.html（目录内容: ${exists}）`)

// ---- CDP ----
const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')
const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })
ws.addEventListener('message', e => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) } })
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object' && typeof window.SillyTavern.getContext === 'function'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}

const out = await ev(`(async () => {
  const res = {}
  // ① 无文件 → 真 404
  const miss = await fetch('/scripts/extensions/__hb67_nope__/x.html')
  res.missingIs404 = miss.status === 404
  // ② 有文件 → 200 + MIME
  const hit = await fetch('/scripts/extensions/__hb67_probe__/settings.html')
  res.hitStatus = hit.status
  res.hitMime = hit.headers.get('content-type')
  res.hitBodyMatches = (await hit.text()).includes('{{title}}')   // 原样返回模板（含占位符）
  // ③ 真渲染（sanitize=true 默认）
  const ctx = window.SillyTavern.getContext()
  const html = await ctx.renderExtensionTemplateAsync('__hb67_probe__', 'settings', {
    title: '接通了', rawHtml: '<img src=x onerror=alert(1)>',
  })
  res.rendered = typeof html === 'string' ? html : String(html)
  res.renderedHasTitle = typeof html === 'string' && html.includes('接通了')
  res.sanitizedStrippedOnerror = typeof html === 'string' && !html.includes('onerror')
  // ④ sanitize=false → onerror 保留（证明消毒在起作用，不是空转）
  const raw = await ctx.renderExtensionTemplateAsync('__hb67_probe__', 'settings', {
    title: 'T', rawHtml: '<img src=x onerror=alert(1)>',
  }, false, false)
  res.unsanitizedKeepsOnerror = typeof raw === 'string' && raw.includes('onerror')
  // ⑤ 路径穿越被拒
  const trav = await fetch('/scripts/extensions/../../secret.html')
  res.traversalRejected = trav.status !== 200
  res.traversalStatus = trav.status
  return res
})()`)

console.log('\n=== T-48 设备实测 ===')
console.log(JSON.stringify(out, null, 2))

// ---- 清理（必须）----
sh(`run-as ${PKG} rm -rf ${EXT_DIR}`)
const left = sh(`run-as ${PKG} ls files/.dsh/extensions 2>/dev/null || echo '(空)'`).trim()
console.log(`\n[cleanup] 探针目录已删；extensions 目录现为: ${left}`)
ws.close()
