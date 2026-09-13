// hb70-realload.mjs — 验证**真实加载路径**：TH 脚本帧 → parentElement 爬到宿主 body → 注入外链脚本
//
// 【为什么必须验】此前所有验证都是**手工把 t37-inject.js 注入宿主页**（模拟"它已经在跑了"）。
// 但真实链路是（加载器原文，`SoliUmbra_预设内置正则_v2.js:1-23`）：
//   ① 加载器作为 TH 脚本在 **iframe** 里跑
//   ② `window.frameElement` → `parentElement` 一路向上爬到 **宿主 body**
//   ③ `parent.appendChild(<script src="https://<托管域>/regex_bind/inject.js">)`
// ⇒ 第 ②③ 步依赖「iframe 与宿主**同源**」+「宿主门面 `SillyTavern` 可见」。
// 本探针在**设备上按这条链**重建一次（用同一份加载器源码 + 同一 URL），看它能否走到位。
// 零写入：只加 script 标签，结束移除。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

const LOADER = readFileSync('D:/DSH RolePlay/stage3-device/hb63/corpus/js/rp-presets__st-[主预设] V17.1 示例预设 · 示例角色-1lnwm2__00___SoliUmbra_预设内置正则_v2.js', 'utf8')
console.log(`[loader] ${LOADER.length} 字节（卡的加载器原文）`)

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
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Runtime.exceptionThrown') {
    const d = x.params?.exceptionDetails
    exceptions.push(`${String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 170)} @ ${String(d?.url ?? '').slice(0, 70)}`)
  }
  if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}

// ① 确认同源链可走：宿主页里能不能看到 TH 脚本帧，且帧内能爬到宿主 body
const chain = await ev(`(() => {
  const frames = Array.from(document.querySelectorAll('iframe'))
  const thFrames = frames.filter(f => (f.getAttribute('title') || '').startsWith('TH 脚本'))
  const results = []
  for (const f of thFrames.slice(0, 3)) {
    let canReachBody = false, frameElOk = false, hostVisible = false
    try {
      const w = f.contentWindow
      frameElOk = !!w.frameElement
      // 复刻加载器的爬升：parentElement 一直到 BODY
      let p = w.frameElement ? w.frameElement.parentElement : null
      let guard = 0
      while (p && p.tagName !== 'BODY' && guard++ < 30) p = p.parentElement
      canReachBody = !!p && p.tagName === 'BODY'
      hostVisible = typeof w.parent.SillyTavern === 'object' && typeof w.parent.SillyTavern.getContext === 'function'
    } catch (e) { /* 跨源 */ }
    results.push({ title: (f.getAttribute('title') || '').slice(0, 30), sameOriginReachable: frameElOk, canReachHostBody: canReachBody, hostFacadeVisible: hostVisible })
  }
  return { thFrameCount: thFrames.length, results }
})()`)
console.log('\n=== ① 同源链与宿主门面可见性 ===')
console.log(JSON.stringify(chain, null, 2))

// ② 真按加载器的写法跑一次（在某个 TH 帧内执行加载器源码）
const run = await ev(`(() => {
  const frames = Array.from(document.querySelectorAll('iframe')).filter(f => (f.getAttribute('title') || '').startsWith('TH 脚本'))
  if (!frames.length) return { ok: false, why: '无 TH 脚本帧' }
  const f = frames[0]
  try {
    const w = f.contentWindow
    // 加载器依赖的 getScriptId() 在真 TH 里由 shim 提供；先探测它在不在
    const hasGetScriptId = typeof w.getScriptId === 'function'
    const hasSillyTavernInFrame = typeof w.SillyTavern
    const hasJQueryInFrame = typeof w.$ === 'function'
    // 探针前置：手工保证 getScriptId（加载器唯一外部依赖）
    if (!hasGetScriptId) { try { w.getScriptId = () => 'hb70_realload_probe' } catch (e) {} }
    if (typeof w.$ !== 'function') return { ok: false, why: '帧内无 jQuery（加载器用 $(...)）', hasJQueryInFrame }
    // 执行加载器源码（原始文本）
    w.eval(${JSON.stringify(LOADER)})
    return { ok: true, hasGetScriptId, hasJQueryInFrame, hasSillyTavernInFrame, injected: true }
  } catch (e) { return { ok: false, err: String(e && e.message) } }
})()`, false)
console.log('\n=== ② 按加载器原文执行 ===')
console.log(JSON.stringify(run, null, 2))

await new Promise(r => setTimeout(r, 6000))
// ③ 结果：宿主页是否真出现该外链 script 标签 + 它的加载状态
const after = await ev(`(() => {
  const s = Array.from(document.querySelectorAll('script[src]')).filter(x => /regex_bind|inject\\.js/.test(x.src))
  return {
    外链标签数: s.length,
    标签: s.map(x => ({ id: x.id, src: String(x.src).slice(0, 80) })),
    // 卡脚本的痕迹（若外链真的加载执行了，它会写 versionNumber）
    topVersionNumber: typeof window.versionNumber === 'undefined' ? null : window.versionNumber,
    hasSPresetToolBinding: typeof window.SPresetToolBinding !== 'undefined',
  }
})()`)
console.log('\n=== ③ 结果 ===')
console.log(JSON.stringify(after, null, 2))
console.log('\n=== 页面异常 ===')
console.log(exceptions.length ? exceptions.slice(0, 8).join('\n') : '(无)')

await ev(`(() => { for (const x of document.querySelectorAll('script[src]')) if (/regex_bind|inject\\.js/.test(x.src)) x.remove(); return true })()`)
console.log('\n[cleanup] 已移除探针注入的外链标签')
ws.close()
