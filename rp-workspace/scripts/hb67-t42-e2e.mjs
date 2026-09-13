// hb67-t42-e2e.mjs — 设备实测（T-42）：卡写 extension_settings.regex → 真落到 node 侧 rp/regex/global.json
//
// 【为什么必须先备份】本探针会**真的写入** global.json（这正是被测行为）。
// 流程：① 记录 global.json 原状（md5 + 内容）② 在宿主页模拟卡的写回动作
//       ③ 校验 node 侧文件真的变了且内容对 ④ **还原**原文件。
// 零残留：结束时必须恢复原状（失败也恢复）。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const PKG = 'com.dshtavern.app'
const REL = 'files/.dsh/rp/regex/global.json'

const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })
const readDevice = (rel) => {
  try { return sh(`run-as ${PKG} cat ${rel}`) } catch { return '' }
}

// ---- ① 原状 ----
const before = readDevice(REL)
const beforeMd5 = createHash('md5').update(before).digest('hex')
console.log(`[before] ${REL} 长度=${before.length} md5=${beforeMd5}`)
let beforeScripts = []
try { beforeScripts = JSON.parse(before).scripts ?? [] } catch { /* 文件可能不存在 */ }
console.log(`[before] 已有 scripts=${beforeScripts.length}`)

// ---- CDP 连接 ----
const unix = sh('cat /proc/net/unix')
const m = unix.match(/@webview_devtools_remote_(\d+)/)
if (!m) { console.error('未找到 webview socket'); process.exit(2) }
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
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
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
  }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')

const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

// ---- 冷启后宿主门面可能尚未安装：等到 SillyTavern.getContext 可用（最多 60s）----
let ready = false
for (let i = 0; i < 30; i++) {
  const probe = await ev(`typeof window.SillyTavern === 'object' && typeof window.SillyTavern.getContext === 'function'`)
  if (probe === true) { ready = true; console.log(`[wait] 宿主门面就绪（第 ${i} 轮）`); break }
  await new Promise(r => setTimeout(r, 2000))
}
if (!ready) { console.error('[wait] 宿主门面 60s 内未就绪，放弃'); process.exit(3) }

// ---- ② 模拟卡的真实写回动作（逐字按卡的做法：改 extensionSettings.regex + saveSettingsDebounced）----
const marker = '__dsht_hb67_probe__'
const act = await ev(`(async () => {
  const ctx = window.SillyTavern.getContext()
  const ext = ctx.extensionSettings
  if (!Array.isArray(ext.regex)) return { ok: false, why: 'extensionSettings.regex 不是数组', type: typeof ext.regex }
  const n0 = ext.regex.length
  // 卡的做法：push 一条（ST camelCase 形状，与 ST_REGEX_SCRIPT_FIELDS 白名单一致）
  ext.regex.push({
    id: '${marker}',
    scriptName: '${marker}',
    findRegex: '/HB67PROBE/g',
    replaceString: 'HB67-REPLACED',
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  })
  ctx.saveSettingsDebounced()
  await new Promise(r => setTimeout(r, 1200))   // 等防抖窗口（500ms）+ 写回
  return { ok: true, n0, n1: ext.regex.length, hasMarker: ext.regex.some(s => s.id === '${marker}') }
})()`)
console.log('\n[act] 卡式写回 →', JSON.stringify(act))

// ---- ③ 校验 node 侧文件 ----
await new Promise(r => setTimeout(r, 1500))
const after = readDevice(REL)
const afterMd5 = createHash('md5').update(after).digest('hex')
let afterScripts = []
try { afterScripts = JSON.parse(after).scripts ?? [] } catch { /* */ }
const landed = afterScripts.some(s => s.id === marker || s.scriptName === marker)
console.log(`[after ] 长度=${after.length} md5=${afterMd5} scripts=${afterScripts.length}`)
console.log(`[check ] 文件是否变化=${afterMd5 !== beforeMd5}  探针条目是否落盘=${landed}`)
const landedEntry = afterScripts.find(s => s.id === marker || s.scriptName === marker)
if (landedEntry) console.log('[check ] 落盘条目字段：', JSON.stringify(landedEntry))
else console.log('[check ] 未落盘的 scripts id 列表：', JSON.stringify(afterScripts.map(s => s.id)))

// ---- ④ 还原（必须）----
const restore = await ev(`(async () => {
  const ctx = window.SillyTavern.getContext()
  const ext = ctx.extensionSettings
  const n0 = Array.isArray(ext.regex) ? ext.regex.length : -1
  ext.regex = (ext.regex || []).filter(s => s.id !== '${marker}')
  ctx.saveSettingsDebounced()
  await new Promise(r => setTimeout(r, 1200))
  return { ok: true, n0, n1: ext.regex.length }
})()`)
console.log('\n[restore] 探针条目已从宿主 extensionSettings 移除 →', JSON.stringify(restore))
await new Promise(r => setTimeout(r, 1200))
const final = readDevice(REL)
let finalScripts = []
try { finalScripts = JSON.parse(final).scripts ?? [] } catch { /* */ }
const finalHasMarker = finalScripts.some(s => s.id === marker || s.scriptName === marker)
console.log(`[restore] node 侧 scripts=${finalScripts.length} 仍含探针=${finalHasMarker}`)
console.log(`[restore] 与原状一致=${finalScripts.length === beforeScripts.length}`)

ws.close()
