#!/usr/bin/env node
/**
 * ef-keyboard-inset.mjs —— 设备侧探针：软键盘弹出时**底部输入区是否被键盘遮挡**。
 *
 * ## 为什么需要独立口径（P-20 判据必须自带杠杆）
 * 首版判据用 `window.visualViewport` / `window.innerHeight` 判定遮挡 —— 实测**恒不变**
 * （本环境 edge-to-edge + `EDGE_TO_EDGE_ENFORCED` ⇒ window 不随键盘收缩，
 * visualViewport 也不反映键盘）⇒ 该判据**恒判 PASS**，是典型的「测不出来 vs 事实否定」
 * 混淆（P-17）。故此处改用**与页面无关的权威口径**：
 *   `adb shell dumpsys window displays` 里 IME 的 `InsetsSource type=ime frame=[...]`，
 *   再按 `devicePixelRatio` 换算成 CSS px，与页内 composer 的 `getBoundingClientRect()`
 *   求交集 ⇒ 「被盖住多少 px」。
 *
 * ## 判据
 *   K0 杠杆   键盘真的弹出（ime frame visible=true 且高度 > 0）
 *   K1 遮挡   coveredPx = composerBottom - imeTopCss；> 8 ⇒ FAIL
 *   K2 负控   键盘收起后 coveredPx 必须 ≤ 0（判据不得恒真）
 *   K3 能力   页面是否**用**了 visualViewport 做键盘避让（信息项，不作为通过依据）
 *
 * 用法：node scripts/ef-keyboard-inset.mjs
 * 退出码：0 全 PASS / 1 有 FAIL / 2 探针自身失败 / 3 找不到 adb
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

/** 读 IME 的权威几何：{shown, topPx, heightPx}（物理像素）
 *
 * ⚠️ 注意 `visibleFrame=[a,b][c,d]` **有两个方括号**，首版正则 `visibleFrame=\[[^\]]*\] visible=`
 * 会在此处失配 ⇒ 恒判「未弹出」（假 FAIL）。改为**按行锚定** `type=ime frame=` 再分别取
 * frame 与 `visible=`，避免被 `visibleFrame` 的同名前缀误导。
 */
function readImeFrame() {
  let out = ''
  try { out = execFileSync(ADB, ['shell', 'dumpsys', 'window', 'displays'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 }) }
  catch (e) { return { err: String(e.message).slice(0, 200) } }
  const line = out.split('\n').find(l => /InsetsSource id=\d+ type=ime frame=/.test(l))
  if (!line) return { shown: false, topPx: null, heightPx: 0, raw: '未找到 type=ime 的 InsetsSource（视为未弹出）' }
  const m = /frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line)
  if (!m) return { shown: false, topPx: null, heightPx: 0, raw: `type=ime 行无 frame：${line.trim().slice(0, 160)}` }
  const visible = /\svisible=(true|false)\b/.exec(line)
  const shown = visible ? visible[1] === 'true' : false
  if (!shown) return { shown: false, topPx: null, heightPx: 0 }
  return { shown: true, topPx: Number(m[2]), heightPx: Math.max(0, Number(m[4]) - Number(m[2])) }
}

function readInputShown() {
  try {
    const out = execFileSync(ADB, ['shell', 'dumpsys', 'input_method'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
    return [...out.matchAll(/mInputShown=(true|false)/g)].some(m => m[1] === 'true')
  } catch { return null }
}

async function cdp() {
  let targets
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() }
  catch (e) {
    console.error(`[FATAL] CDP ${PORT} 不可达：${e.message}`)
    console.error('  请在设备上启动 App 并转发端口：adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>')
    process.exit(2)
  }
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.error('[FATAL] 无 page target'); process.exit(2) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let n = 0; const pend = new Map()
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++n; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  await send('Runtime.enable')
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 300)); return r.result?.value }
  return { ev, close: () => ws.close() }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const SNAP = `(() => {
  const ed = document.querySelector('.dsht-rp-overlay [contenteditable="true"]') || document.querySelector('[contenteditable="true"]')
  const r = ed ? ed.getBoundingClientRect() : null
  return JSON.stringify({
    dpr: window.devicePixelRatio,
    innerH: Math.round(window.innerHeight),
    docElH: document.documentElement.clientHeight,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    which: ed ? (ed.closest('.dsht-rp-overlay') ? 'rp' : 'host') : null,
    composerBottom: r ? Math.round(r.bottom) : null,
    composerTop: r ? Math.round(r.top) : null,
  })
})()`

const { ev, close } = await cdp()
const snap = JSON.parse(await ev(SNAP))
if (snap.composerBottom === null) { console.error('[FATAL] 找不到 composer，无法判定'); close(); process.exit(2) }

const BASE = await readImeFrame()
console.log('=== 基线（未聚焦）===')
console.log('page =', JSON.stringify(snap))
console.log('ime  =', JSON.stringify(BASE))
const baseShown = BASE.shown === true

// 真实点击 composer（adb input tap 走物理像素）
const FOCUS = `(() => { const ed = document.querySelector('.dsht-rp-overlay [contenteditable="true"]') || document.querySelector('[contenteditable="true"]'); if (!ed) return 'no-ed'; ed.focus(); return 'focused' })()`
const tapX = Math.round((await ev(`(() => { const ed = document.querySelector('.dsht-rp-overlay [contenteditable="true"]') || document.querySelector('[contenteditable="true"]'); const r = ed.getBoundingClientRect(); return r.left + Math.min(40, r.width / 2) })()`)) * snap.dpr)
const tapY = Math.round(((snap.composerTop + snap.composerBottom) / 2) * snap.dpr)

/** 触发聚焦并等键盘：先 CDP focus，再物理 tap；每次尝试后轮询 IME。 */
async function focusAndWaitIme(maxTry = 3) {
  for (let attempt = 1; attempt <= maxTry; attempt += 1) {
    console.log(`[动作 ${attempt}/${maxTry}] DOM focus + adb shell input tap ${tapX} ${tapY}`)
    await ev(FOCUS)
    await sleep(300)
    execFileSync(ADB, ['shell', 'input', 'tap', String(tapX), String(tapY)], { timeout: 20000 })
    for (let i = 0; i < 12; i += 1) {
      await sleep(500)
      const f = await readImeFrame()
      if (f.shown) return f
    }
  }
  return await readImeFrame()
}
const ime = await focusAndWaitIme()
await sleep(800)
const now = JSON.parse(await ev(SNAP))
const inputShown = readInputShown()

console.log('\n=== 键盘弹出后 ===')
console.log('page =', JSON.stringify(now))
console.log('ime  =', JSON.stringify(ime))
console.log('input_method.mInputShown =', inputShown)

const k0 = ime.shown === true
const imeTopCss = k0 ? ime.topPx / snap.dpr : null
const covered = k0 ? Math.round(now.composerBottom - imeTopCss) : null

// 原生侧运行期读回（DSHTShare.keyboardInsetStatus）—— 判据不只看页面几何（P-11 独立来源）
let native = null
try {
  const raw = await ev(`(() => { try { return window.DSHTShare && window.DSHTShare.keyboardInsetStatus ? window.DSHTShare.keyboardInsetStatus() : '__NO_BRIDGE__' } catch (e) { return '__ERR__' + e.message } })()`)
  if (typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('__'))) {
    native = raw.startsWith('{') ? JSON.parse(raw) : { __raw: raw }
  } else native = { __raw: String(raw) }
} catch (e) { native = { __err: String(e.message).slice(0, 160) } }

console.log('\n=== 判据 ===')
console.log(`K0 键盘真的弹出（杠杆）     : ${k0 ? 'PASS' : 'FAIL'}  ${k0 ? `imeTop=${imeTopCss.toFixed(1)}css imeH=${(ime.heightPx / snap.dpr).toFixed(1)}css` : `← 未弹出 ⇒ 后续判定无效（不得据此宣称通过）${baseShown ? '；基线就已弹出' : ''}`}`)
console.log(`K1 输入区被键盘遮挡         : ${k0 ? (covered > 8 ? `FAIL  被盖 ${covered}px（composerBottom=${now.composerBottom} vs imeTop=${imeTopCss.toFixed(0)}）` : `PASS  未被盖（covered=${covered}px）`) : 'N/A（无杠杆）'}`)
console.log(`K2 视口是否随键盘收缩       : ${snap.innerH} → ${now.innerH}（Δ=${snap.innerH - now.innerH}px）${snap.innerH - now.innerH < 40 ? ' ← 未收缩：window 不反映键盘，故只能用 IME frame 判定' : ''}`)
console.log(`K3 docEl.clientHeight       : ${snap.docElH} → ${now.docElH}`)
console.log(`K5 原生 insets 读回         : ${JSON.stringify(native)}`)
// K5 判「监听装了且被调用过」；键盘弹起时必须额外满足 imeBottomPx>0（否则等于没避让）
const k5 = native && native.listenerInstalled === true && (!k0 || native.imeBottomPx > 0)
console.log(`K5 原生真的收到 IME insets  : ${k5 ? `PASS  imeBottomPx=${native.imeBottomPx} applied=${native.appliedBottomPx} channel=${native.channel}` : `FAIL  ${native?.listenerInstalled !== true ? '监听未跑过' : `keyboard开但 imeBottomPx=${native?.imeBottomPx}（未避让）`}`}`)
// K6：修法**形态**必须走 margin（padding 实测不改视口）
const k6 = native && native.channel === 'margin' && native.webViewMarginBottomPx === native.appliedBottomPx
console.log(`K6 避让走 margin 且落到视图 : ${k6 ? `PASS  marginBottom=${native.webViewMarginBottomPx}（viewH=${native.webViewHeightPx}）` : `FAIL  channel=${native?.channel} marginBottom=${native?.webViewMarginBottomPx} 期望=${native?.appliedBottomPx}`}`)
// K7：页面视口**真的收缩**了（最终的语义判据 —— 写了不算，视口变了才算）
const shrink = k0 ? Math.round((snap.docElH - now.docElH)) : null
const k7 = k0 && shrink > 40
console.log(`K7 页面视口真的收缩（终判） : ${k0 ? (k7 ? `PASS  docEl.clientHeight ${snap.docElH} → ${now.docElH}（收缩 ${shrink}px）` : `FAIL  docEl.clientHeight ${snap.docElH} → ${now.docElH}（未收缩 ⇒ 修法未改变页面语义）`) : 'N/A（无杠杆）'}`)

// 负控：收起键盘后不得仍判「被盖」
//
// ⚠️ 必须用 `adb shell ime` / `input keyevent 111`（ESC）收起键盘，**不能用 keyevent 4（BACK）**
// —— BACK 在 WebView 无历史可退时会**退出 Activity**（实测把 app 退到 launcher ⇒ CDP target
// 变空 ⇒ 后续读几何全失败，且用户会话虽不丢但探针当场作废）。
execFileSync(ADB, ['shell', 'input', 'keyevent', '111'], { timeout: 20000 })
await sleep(1500)
let afterIme = await readImeFrame()
if (afterIme.shown === true) {
  // ESC 没收起（部分 IME 不响应）⇒ 再用 `ime hide` 兜底
  try { execFileSync(ADB, ['shell', 'ime', 'hide'], { timeout: 15000 }) } catch { /* 出声在下方断言 */ }
  await sleep(1500)
  afterIme = await readImeFrame()
}
let afterSnap = {}
try {
  afterSnap = JSON.parse(await ev(SNAP))
} catch (e) {
  console.log(`[NEG] 读收回落几何失败（不致命）：${String(e.message).slice(0, 120)}`)
}
const negOk = afterIme.shown !== true
console.log(`\n[NEG] 收起键盘后 ime.shown=${afterIme.shown}，composerBottom=${afterSnap.composerBottom}`)
console.log(`K4 负控（判据不恒真）       : ${negOk ? 'PASS' : 'FAIL'}  ${negOk ? '键盘已收起 ⇒ K1 的 PASS 不是恒真' : '键盘未收起 ⇒ K1 结果不可信'}`)

const fails = []
if (!k0) fails.push('K0')
if (k0 && covered > 8) fails.push('K1')
if (!k5) fails.push('K5')
if (!k6) fails.push('K6')
if (k0 && !k7) fails.push('K7')
if (!negOk) fails.push('K4')
console.log(`\n[ef-keyboard-inset] ${fails.length === 0 ? '全部 PASS' : `FAIL: ${fails.join(', ')}`}`)
close()
process.exit(fails.length === 0 ? 0 : 1)
