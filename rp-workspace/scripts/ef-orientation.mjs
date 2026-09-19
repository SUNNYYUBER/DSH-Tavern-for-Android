#!/usr/bin/env node
/**
 * ef-orientation.mjs —— 设备侧探针：转屏（竖 ↔ 横）后的适配行为（L2「竖屏 / 横屏」格）。
 *
 * ## 这一格要回答什么
 * §二 L2 的判据是「**转屏后布局不崩；浮窗位置 clamp 回界内**」。
 * 现有实现用 `@media (max-width: 700px)` 作**手机判据**（抽屉 / grid 锁定 / 汉堡 /
 * 触控放大全在该查询内）。但「手机」是**设备属性**，宽度是**视口属性**：
 * 手机横屏时 CSS 宽可达 ~873px > 700 ⇒ 查询**不匹配** ⇒ 五件套整体失效。
 *
 * ## 判据
 *   O0 杠杆    : 转屏**真的发生**（innerWidth 前后不同）
 *   O1 前提    : 竖屏下五件套生效（汉堡可见 + 侧栏 fixed）—— 若前提不成立，后续无从谈起
 *   O2 真缺口  : 横屏下五件套**是否仍生效**（修前：汉堡消失 + 侧栏退回 static）
 *   O3 布局    : 转屏后 `documentElement.scrollWidth <= clientWidth + 1`（无横向溢出）
 *   O4 浮窗    : 浮球（`.dsht-rp-scriptball` / `.dsht-rp-statefloat-ball`）在视口界内
 *   O5 复原    : 转回竖屏后，视口与五件套状态回到基线（幂等）
 *
 * 【判据自身的坑（P-19/P-20）· 第三十八次】首版 O2 断言的是「`(max-width:700px)` 在横屏
 * 下必须匹配」—— 那是**机制**（某一具体媒体查询），不是**结果**（手机适配是否生效）。
 * 修法把媒体查询改成**并集**（宽度 or 触屏）后，横屏时 `narrow` 单独**仍为 false 是正确的**
 * （由 `coarse` 分支满足并集）⇒ 首版判据会**恒 FAIL**，把已修好的东西报成坏。
 * ⇒ 判据必须落在**结果**上：直接断言「五件套的可见效果」（汉堡 display/可见性 + 侧栏
 *   是否 fixed 抽屉），而不是断言它由哪条媒体查询满足。
 *
 * 用法：node scripts/ef-orientation.mjs
 * 退出码：0 全 PASS / 1 有 FAIL / 2 探针自身失败 / 3 找不到 adb / 4 无 page target
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function resolveAdb() {
  const cands = [
    process.env.DSHT_ADB, process.env.ADB_PATH,
    process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`,
    process.env.USERPROFILE && `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`,
    'adb',
  ].filter(Boolean)
  for (const c of cands) { if (c === 'adb') return c; if (existsSync(c)) return c }
  return null
}
const ADB = resolveAdb()
if (!ADB) { console.error('[FATAL] 找不到 adb（DSHT_ADB / ANDROID_HOME / ~/.android/sdk）'); process.exit(3) }

const PORT = process.env.CDP_PORT || '9333'
let targets = null
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
} catch (e) {
  console.error(`[FATAL] CDP ${PORT} 不可达：${String(e?.message ?? e)}`)
  console.error('  本脚本不写用户数据，但需 App 在运行且端口已转发：')
  console.error('    adb shell am start -n com.dshtavern.app/.MainActivity')
  console.error('    adb shell pidof com.dshtavern.app    # 取 pid')
  console.error('    adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>')
  process.exit(2)
}
if (!Array.isArray(targets)) { console.error('[FATAL] CDP /json 返回非数组'); process.exit(2) }
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('[FATAL] 无 page target（WebView 未就绪 / 端口未转发）'); process.exit(4) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let n = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++n; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 300)); return r.result?.value }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const SNAP = `(() => {
  const de = document.documentElement
  const mq = typeof window.matchMedia === 'function'
  const narrow = mq ? window.matchMedia('(max-width: 700px)').matches : null
  const coarse = mq ? window.matchMedia('(pointer: coarse)').matches : null
  const landscapeMq = mq ? window.matchMedia('(orientation: landscape)').matches : null
  const hamburger = document.querySelector('.dsht-mobile-hamburger')
  const hb = hamburger ? getComputedStyle(hamburger) : null
  const hamVisible = hamburger ? (hb.display !== 'none' && hamburger.getBoundingClientRect().width > 0) : false
  const ball = document.querySelector('.dsht-rp-scriptball') || document.querySelector('.dsht-rp-statefloat-ball')
  let ballRect = null
  if (ball) { const r = ball.getBoundingClientRect(); ballRect = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } }
  const sidebar = document.querySelector('[data-dsht-mobile="sidebar-col"]')
  const sbFixed = sidebar ? getComputedStyle(sidebar).position : null
  return JSON.stringify({
    innerW: Math.round(window.innerWidth), innerH: Math.round(window.innerHeight),
    narrow, coarse, landscapeMq,
    hamVisible, sbFixed,
    scrollW: de.scrollWidth, clientW: de.clientWidth, overflowX: de.scrollWidth - de.clientWidth,
    ballRect, hasBall: !!ball,
  })
})()`

/**
 * 【P-48 · W38】本脚本会在运行期**改设备全局设置**（`system.accelerometer_rotation` /
 * `system.user_rotation`）—— 这是**用户直接看得见**的外部状态（自动旋转被关掉）。
 *
 * 修前形态（W37 穷举时仍漏网）：还原只有 `restoreAutoRotate()` 一处，且**只在脚本末尾调用**
 * ⇒ 中途任一步抛异常（最现实的是 CDP 目标重建期 `fetch` reject，或 `settings put` 自身超时）
 * ⇒ 末尾那行**永不执行** ⇒ **用户的系统自动旋转被永久关闭**。
 * 这与 W37 修好的 `ef-font-scale.mjs` 是**同一形态**（P-38 的横向排查第 3 处）。
 *
 * 纪律（P-48 三条）：
 *   ① 还原做成**幂等钩子** `restoreOrientation()`，被 exit / 信号 / 未捕获异常 / 未处理拒绝兜住；
 *   ② 「写盘」与「登记」**同一处**（`setSetting` 先登记再写，无窗口）；
 *   ③ **自证**：还原后读回校验，**成功也要出声**（否则复核者无法区分「兜底跑了」与「压根没改过」）。
 */
function getSetting(key) {
  return String(execFileSync(ADB, ['shell', 'settings', 'get', 'system', key], { encoding: 'utf8', timeout: 15000 })).trim()
}
const ORIG_ACCEL = getSetting('accelerometer_rotation')
const ORIG_ROT = getSetting('user_rotation')
console.log(`[夹具] 原始设置：accelerometer_rotation=${ORIG_ACCEL} · user_rotation=${ORIG_ROT}（结束时必须还原并校验）`)

let orientDirtied = false
let orientRestored = false
/** 写系统设置（**先登记再写** —— P-1：不留「已改未登记」窗口，否则兜底会以为无需还原） */
function setSetting(key, v) {
  orientDirtied = true
  execFileSync(ADB, ['shell', 'settings', 'put', 'system', key, String(v)], { timeout: 15000 })
}
/** 写回原值：原值为 `null`（未设置）时改用 `settings delete`，而不是写入字符串 "null" */
function writeBack(key, orig) {
  if (orig === '' || orig === 'null') execFileSync(ADB, ['shell', 'settings', 'delete', 'system', key], { timeout: 15000 })
  else execFileSync(ADB, ['shell', 'settings', 'put', 'system', key, String(orig)], { timeout: 15000 })
}
/** 幂等还原（可被多个中止路径调用；已还原即跳过） */
function restoreOrientation(reason) {
  if (!orientDirtied || orientRestored) return { ok: true, skipped: true, accel: null, rot: null, reason }
  try {
    writeBack('accelerometer_rotation', ORIG_ACCEL)
    writeBack('user_rotation', ORIG_ROT)
    const accel = getSetting('accelerometer_rotation')
    const rot = getSetting('user_rotation')
    orientRestored = true
    const ok = accel === ORIG_ACCEL && rot === ORIG_ROT
    // 【P-48 纪律③ · 自证】**成功也要出声**：否则「兜底真的跑了」与「压根没改过」输出完全相同
    if (ok) console.log(`[夹具安全] 系统设置已还原（accelerometer_rotation=${accel} · user_rotation=${rot}，触发路径：${reason}）`)
    else console.error(`[夹具安全][FATAL] 系统设置还原后读回 accel=${accel} / rot=${rot}（应为 ${ORIG_ACCEL} / ${ORIG_ROT}）——设备可能仍关着自动旋转，请手工恢复`)
    return { ok, skipped: false, accel, rot, reason }
  } catch (e) {
    console.error(`[夹具安全][FATAL] 系统设置还原失败（${String(e.message).slice(0, 160)}）——设备可能仍关着自动旋转，请手工恢复为 accel=${ORIG_ACCEL} / rot=${ORIG_ROT}`)
    return { ok: false, skipped: false, accel: null, rot: null, reason }
  }
}
// ① 兜住所有中止路径（异常路径**不会**走到脚本末尾的收尾代码 —— 见 P-48）
process.on('exit', () => { restoreOrientation('exit') })
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { restoreOrientation(sig); process.exit(130) })
}
process.on('uncaughtException', (e) => {
  console.error(`[FATAL] 未捕获异常：${String(e && e.message).slice(0, 300)}`)
  restoreOrientation('uncaughtException')
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(`[FATAL] 未处理的 Promise 拒绝：${String(e && (e.message || e)).slice(0, 300)}`)
  restoreOrientation('unhandledRejection')
  process.exit(1)
})

/** 旋转：rot=0 竖屏 / rot=1 横屏（关闭自动旋转以免被传感器覆盖） */
function rotate(rot) {
  setSetting('accelerometer_rotation', '0')
  setSetting('user_rotation', String(rot))
}

async function waitStable(maxMs = 12000) {
  let last = null
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const cur = await ev(SNAP)
    if (last !== null && cur === last) return cur
    last = cur
    await sleep(600)
  }
  return await ev(SNAP)
}

console.log('=== ① 基线（竖屏）===')
rotate(0)
await sleep(2500)
const base = JSON.parse(await waitStable())
console.log(JSON.stringify(base))

console.log('\n=== ② 转横屏 ===')
rotate(1)
await sleep(2500)
const land = JSON.parse(await waitStable())
console.log(JSON.stringify(land))

console.log('\n=== ③ 转回竖屏 ===')
rotate(0)
await sleep(2500)
const back = JSON.parse(await waitStable())
console.log(JSON.stringify(back))

// 【P-48】改走**幂等单源** `restoreOrientation()`（与 exit / 异常兜底**同一个函数**）——
// 同一语义只有一处实现（P-1），且它可被重复调用（`process.on('exit')` 那次会跳过）。
// ★ 修前形态有两处错：① 还原**只在脚本末尾**（异常路径永不执行）；② 它把自动旋转**写死成 1**
//   而不是**恢复原值** —— 若设备本来是关着自动旋转的，探针反而把用户设置**改了**。
const rr = restoreOrientation('normal')
await sleep(1500)
const accelBack = getSetting('accelerometer_rotation')
const rotBack = getSetting('user_rotation')
const restoreOk = accelBack === ORIG_ACCEL && rotBack === ORIG_ROT && rr.ok !== false

console.log('\n=== 判据 ===')
const o0 = base.innerW !== land.innerW
console.log(`O0 转屏真的发生（杠杆）      : ${o0 ? 'PASS' : 'FAIL'}  竖 ${base.innerW}×${base.innerH} → 横 ${land.innerW}×${land.innerH}`)
// 五件套「生效」的**结果**判据（不看是哪条媒体查询满足的 —— 见文件头第三十八次坑）
const suiteOn = (s) => s.hamVisible === true && s.sbFixed === 'fixed'
const o1 = suiteOn(base)
console.log(`O1 竖屏下五件套生效（前提）   : ${o1 ? 'PASS' : `FAIL  汉堡可见=${base.hamVisible} 侧栏=${base.sbFixed}`}`)
const o2 = suiteOn(land)
console.log(`O2 横屏下五件套仍生效         : ${o0 ? (o2 ? `PASS  汉堡可见=${land.hamVisible} 侧栏=${land.sbFixed}（narrow=${land.narrow} coarse=${land.coarse} 并集生效）` : `FAIL  ← 汉堡可见=${land.hamVisible} 侧栏=${land.sbFixed}（手机横屏退化成桌面三栏）`) : 'N/A'}`)
const o3 = land.overflowX <= 1
console.log(`O3 横屏无横向溢出             : ${o3 ? 'PASS' : `FAIL  scrollW=${land.scrollW} clientW=${land.clientW}`}`)
const o4 = land.hasBall ? (land.ballRect.l >= -1 && land.ballRect.t >= -1 && land.ballRect.r <= land.innerW + 1 && land.ballRect.b <= land.innerH + 1) : null
console.log(`O4 浮球转屏后仍在视口内       : ${o4 === null ? 'N/A（本卡无浮球）' : (o4 ? `PASS  ${JSON.stringify(land.ballRect)} 视口 ${land.innerW}×${land.innerH}` : `FAIL  浮球越界 ${JSON.stringify(land.ballRect)} 视口 ${land.innerW}×${land.innerH}`)}`)
const o5 = back.innerW === base.innerW && suiteOn(back) === suiteOn(base)
console.log(`O5 转回竖屏复原（幂等）       : ${o5 ? 'PASS' : 'FAIL'}  ${back.innerW} 汉堡=${back.hamVisible} 侧栏=${back.sbFixed}`)
// 【P-48 纪律③ · 夹具安全自证】还原后**读回校验**，且**成功也出声**（否则「兜底跑了」与「没改过」不可分）
console.log(`O6 夹具安全：系统设置已还原   : ${restoreOk ? `PASS  accel=${accelBack} · rot=${rotBack}` : `FAIL  读回 accel=${accelBack} / rot=${rotBack}（应为 ${ORIG_ACCEL} / ${ORIG_ROT}）`}`)
console.log(`\n[附] 诊断：narrow 竖=${base.narrow}/横=${land.narrow} · coarse 竖=${base.coarse}/横=${land.coarse} · landscapeMq 横=${land.landscapeMq}`)

const fails = []
if (!o0) fails.push('O0')
if (!o1) fails.push('O1')
if (o0 && !o2) fails.push('O2')
if (!o3) fails.push('O3')
if (o4 === false) fails.push('O4')
if (!o5) fails.push('O5')
if (!restoreOk) fails.push('O6')
ws.close()
console.log(`\n[ef-orientation] ${fails.length === 0 ? '全部 PASS' : `FAIL: ${fails.join(', ')}`}`)
process.exit(fails.length === 0 ? 0 : 1)
