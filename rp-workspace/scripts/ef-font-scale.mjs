#!/usr/bin/env node
/**
 * ef-font-scale.mjs —— 设备侧探针：L2「字号与缩放」格（`系统字体放大时不错位`）。
 *
 * ## 这一格此前为何一直挂着「设备实测仍待做」
 * §6.2 记「三处 `text-size-adjust:100%` 已加，**设备实测仍待做**」。
 * 但「待做」不能只是「跑一次看看」—— 先要回答两个**前置问题**（否则判据会落入 P-17 陷阱）：
 *
 *   ① 系统 font_scale **是否真的传导**到 WebView？（若不传导，则「不错位」是**测不出来**，
 *      不是**事实否定** —— 二者必须区分。）
 *   ② `text-size-adjust:100%` 的设计意图是「抑制**按视口宽度自动放大**（font boosting），
 *      但**保留**系统级字体设置」⇒ 那么 font_scale 变化时**字号确实应该变大**，
 *      判据**不能**写成「字号不变」。
 *
 * 本探针先做**杠杆判据**（S0）回答①，再断言「不错位」这一**结果**（P-24）。
 *
 * ## 判据
 *   S0 杠杆   切换 font_scale 后根字号**真的变了**（不传导 ⇒ 后续判据全部无意义，报 SKIP）
 *   S1 溢出   任一档位下无横向溢出（`documentElement.scrollWidth <= clientWidth + 1`）
 *   S2 可达   输入区（composer）矩形完整落在视口内（放大后不被挤出屏幕）
 *   S3 五件套 任一档位下手机五件套仍生效（汉堡可见 + 侧栏 fixed）—— 与 `ef-orientation.mjs`
 *             同判据口径（**单源**：同一「手机适配是否生效」不写第二套断言）
 *   S4 裁切   我方组件里「文字被容器裁掉且滚不到」的元素数 = 0
 *             （`scrollHeight > clientHeight + 2` 且 `overflow-y` 为 hidden/clip ⇒ 用户看不到）
 *   S5 浮球   若有浮球，矩形须在视口内
 *   S6 缩小   0.85 档下关键触控目标仍 ≥38px（**这是放大档看不出的风险方向**）
 *   S7 幂等   还原到 1.0 后快照与基线逐字一致，且系统 font_scale 确已还原
 *
 * ## 判据自身的坑（第 39 次 · 催生纪律）
 * **font_scale 变更会让 WebView 目标重建、CDP 瞬间断开。** 首版探针复用一个长连接 ws，
 * 第 2 档起永久挂住（`Detected unsettled top-level await`）—— 表象是「探针卡住」，
 * 真因是**测具假设了目标身份稳定**。修法：每档求值都**新建连接**（`ev()` 内部重试 +
 * 重取目标列表）。**纪律**：凡会改变**宿主/系统级**状态的操作，测具不得假设连接身份不变。
 *
 * ## 夹具安全（P-21 同类）
 * `font_scale` 是**设备全局**设置（不只影响本 App）。本探针只读页面、不写用户数据；
 * 但**必须**在结束时还原 `font_scale` 并**校验读回值**（不还原 = 污染用户设备）。
 *
 * 用法：node scripts/ef-font-scale.mjs
 * 退出码：0 全 PASS / 1 有 FAIL / 2 探针自身失败 / 3 找不到 adb
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { makeEv } from './cdp-eval.mjs'

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
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * CDP 求值 —— **走单源模块**（P-1）。
 *
 * 【为什么要改成 import】本文件的 `ev()` 此前是 `ef-touch-targets.mjs` 里那段
 * **逐字同构的拷贝**，连「`tries/gap` 只在抛异常时重试」这个缺陷都一模一样
 * ⇒ 修一处**不会**传导到另一处（W30 实测抓到的 P-1 违例）。
 * 而项目的「同一功能多实现」门禁 `audit-impl-duplication.mjs` **只扫 src、不扫 scripts**
 * ⇒ 这处重复它**结构性看不见**（P-11 元级）。
 * ⇒ 收口到 `cdp-eval.mjs`；新探针一律 import 它，不得再自建。
 *
 * 语义不变：`ev(expr, tries, gap)` 仍是**连接级**重试（连不上 CDP / 页面重建时重试）；
 * 「等业务条件成立」必须用 `pollUntil`（见本文件 `waitReady` 内的用法）。
 */
const ev = makeEv({ port: PORT, tries: 14, gap: 1500 })

const SNAP = `(() => {
  const de = document.documentElement
  const rootFs = parseFloat(getComputedStyle(de).fontSize) || 0
  const mq = typeof window.matchMedia === 'function'
  const hamburger = document.querySelector('.dsht-mobile-hamburger')
  const hb = hamburger ? getComputedStyle(hamburger) : null
  const hamVisible = hamburger ? (hb.display !== 'none' && hamburger.getBoundingClientRect().width > 0) : false
  const hamRect = hamburger ? hamburger.getBoundingClientRect() : null
  const sidebar = document.querySelector('[data-dsht-mobile="sidebar-col"]')
  const sbFixed = sidebar ? getComputedStyle(sidebar).position : null

  const ed = document.querySelector('.dsht-rp-overlay [contenteditable="true"]') || document.querySelector('[contenteditable="true"]')
  const er = ed ? ed.getBoundingClientRect() : null

  const ball = document.querySelector('.dsht-rp-scriptball') || document.querySelector('.dsht-rp-statefloat-ball')
  let ballRect = null
  if (ball) { const r = ball.getBoundingClientRect(); ballRect = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } }

  // 文本裁切扫描：**只扫我方**组件，且排除有意滚动容器。
  //
  // 【W36 续 · R17/P-24 违规修复】原实现在**无 overlay 时退化为扫全页（body *）**
  //（当时的理由是「用 '.dsht-rp-*' 这种非法选择器会抛 DOMException」—— 理由本身没错，
  // 但**退化成扫全页**把一个「范围」问题换成了「越界」问题，属 R17 的典型形态）。
  //
  // 设备取证（tmp/w36-s4-clip-forensics.mjs，读数而非推断）：全页有 2 个 visuallyHidden
  // 类元素，**均不在我方容器内**，且是**宿主**的无障碍视觉隐藏类
  //（w=1px h=1px position:absolute overflow:hidden，父链 div.o3BgMG_root → div.ztWv_q_callRow；
  // 同前缀 o3BgMG_ 共 7 个元素全在宿主侧 = 宿主 CSS Modules 命名空间）。
  // 这类元素的**设计意图就是**「保留在无障碍树、视觉隐藏」⇒ 几何上「被裁」**符合预期**。
  // ⇒ 旧实现把它们算成「我方文字被裁掉且滚不到」⇒ **S4 恒 FAIL**（本轮实测 基线=1）。
  // ★ 修法（P-43 + R17）：扫描面**只限我方**（.dsht-rp-overlay / [class*=dsht-rp-] 白名单类）；
  //   **无我方容器时返回 scanned:false** ⇒ 上层记 **SKIP**（无判据力），
  //   **不再**记 FAIL，也不再偷偷扫全页（P-17：测不出来 ≠ 事实否定）。
  const clipped = []
  const overlay = document.querySelector('.dsht-rp-overlay')
  const MY_SEL = '.dsht-rp-overlay, [class*="dsht-rp-"]'
  const mine = overlay ? overlay.querySelectorAll('*') : document.querySelectorAll(MY_SEL)
  const scanned = mine.length > 0
  // 我方容器/元素一个都没渲染出来 ⇒ 本档无判据力（上层记 SKIP）
  for (const el of (scanned ? mine : [])) {
    if (!el.textContent || el.textContent.trim().length === 0) continue
    if (el.children.length > 0) continue            // 只看叶子文本容器
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const oy = cs.overflowY
    if (oy !== 'hidden' && oy !== 'clip') continue   // 能滚就不算看不到
    if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      clipped.push({ cls: (el.className || '').toString().slice(0, 60), sh: el.scrollHeight, ch: el.clientHeight })
      if (clipped.length >= 6) break
    }
  }

  // 触控目标（**缩小档**才暴露的风险方向）：**只取我方组件**。
  // 【第 41 次坑】首版把宿主的 button[aria-label="Send message"]（uV2eYG_primary，
  //   34×34）也算进来 ⇒ S6 恒 FAIL —— 但那是宿主的 composer 按钮，**我方源码零命中**
  //   （属边界 B6「宿主 bundle 内部问题」）。用**选择器归属**判定，不靠名字猜。
  const TARGET_SELS = [
    ['hamburger', '.dsht-mobile-hamburger'],
    ['scriptball', '.dsht-rp-scriptball'],
    ['rollback', '.dsht-rp-rollback-btn'],
    ['script-pill', '.dsht-rp-script-pill'],
    ['import-dock', '.dsht-rp-import-dock'],
    ['ps-select', '.dsht-rp-preset-switch .ps-select'],
  ]
  const targets = {}
  for (const [k, sel] of TARGET_SELS) {
    const e = document.querySelector(sel)
    if (!e) { targets[k] = null; continue }
    const r = e.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) { targets[k] = null; continue }   // 不可见不算
    targets[k] = { w: Math.round(r.width), h: Math.round(r.height) }
  }
  const targetCount = Object.values(targets).filter(Boolean).length

  return JSON.stringify({
    rootFs,
    innerW: window.innerWidth, innerH: Math.round(window.innerHeight),
    scrollW: de.scrollWidth, clientW: de.clientWidth,
    hamVisible, sbFixed, hamRect: hamRect ? { w: Math.round(hamRect.width), h: Math.round(hamRect.height) } : null,
    composer: er ? { t: Math.round(er.top), b: Math.round(er.bottom) } : null,
    ballRect, hasBall: !!ball,
    clipped, targets, targetCount,
    // 【P-43/R17】裁切扫描是否**真的覆盖了我方元素**（false ⇒ S4 无判据力，记 SKIP 而非 FAIL）
    clipScanned: scanned,
    editablePresent: !!ed,
    overlayPresent: !!overlay,
  })
})()`

function setFontScale(v) { execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'font_scale', String(v)], { timeout: 15000 }) }
function getFontScale() { return execFileSync(ADB, ['shell', 'settings', 'get', 'system', 'font_scale'], { encoding: 'utf8', timeout: 15000 }).trim() }

const ORIGINAL = getFontScale()
console.log(`[夹具] 原始 font_scale = ${ORIGINAL}（结束时必须还原并校验）`)

/**
 * 【P-48 纪律① · W36 续】把「还原」做成**任何中止路径都能调用的幂等钩子**。
 *
 * ## 为什么必须有（本脚本此前是 P-48 的**同类第二处**，按 P-38 三段式排查抓到）
 * 本脚本会在循环里**逐档改设备全局设置** `system font_scale`（`setFontScale`），
 * 而还原原先**只在循环之后的脚本末尾**（`setFontScale(ORIGINAL)`）。
 * ⇒ 循环内任一步**抛异常**（最现实的是 `ev()` 的 CDP 连接失败：目标重建期 `fetch` 会 reject），
 *   异常直通 node 顶层 ⇒ **末尾那行永不执行** ⇒ 设备 `font_scale` **永久停在被改的档位**。
 * ★ 这正是 P-48 的识别特征：**测具中止之后，外部状态停在半途**（此处外部状态 = **用户的系统字号**，
 *   比 M7 的会话备份更严重 —— 用户会直接看到全系统字体变小/变大）。
 * ★ 它也与 P-21 同族：**写型夹具的还原必须与「任何退出路径」对齐**，不许依赖正常收尾。
 *
 * 三条落地（对应 P-48 的三条纪律）：
 *   ① **幂等钩子**：`restoreFontScale()` 可被多次调用（已还原即跳过），
 *      并被 `process.on('exit'|'SIGINT'|'SIGTERM')` + `uncaughtException` + `unhandledRejection` 兜住；
 *   ② **「写盘」与「登记」同一处**（P-1）：`setFontScale` 内部**先登记「已被我改动」**再写
 *      ⇒ 不存在「已改但没登记」的窗口；
 *   ③ **自证**：还原后**读回校验**，不一致即出声（R8），并把结论并进退出码。
 */
let fontScaleDirtied = false
let fontScaleRestored = false
function setFontScaleTracked(v) {
  fontScaleDirtied = true      // ② 先登记再写（P-1：不留「已改未登记」窗口）
  setFontScale(v)
}
function restoreFontScale(reason) {
  if (!fontScaleDirtied || fontScaleRestored) return { ok: true, skipped: true, value: null }
  try {
    setFontScale(ORIGINAL)
    const back = getFontScale()
    fontScaleRestored = true
    const ok = back === ORIGINAL
    // 【P-48 纪律③ · 自证】**成功也要出声**：否则复核者无法从日志区分
    // 「兜底真的还原了」与「压根没改动过」（W36 负控实测：兜底生效但输出里无任何痕迹
    // ⇒ 审计链断在这里）。失败路径另外用 FATAL 出声（R8）。
    if (ok) console.log(`[夹具安全] font_scale 已还原 → ${back}（触发路径：${reason}）`)
    else console.error(`[夹具安全][FATAL] font_scale 还原后读回 ${back}（应为 ${ORIGINAL}）——设备已被污染，请手工恢复`)
    return { ok, skipped: false, value: back, reason }
  } catch (e) {
    console.error(`[夹具安全][FATAL] font_scale 还原失败（${String(e.message).slice(0, 160)}）——设备可能停在被改档位，请手工恢复为 ${ORIGINAL}`)
    return { ok: false, skipped: false, value: null, reason }
  }
}
// ① 兜住所有中止路径（正常 exit / Ctrl-C / 未捕获异常 / 未处理的 Promise 拒绝）
process.on('exit', () => { restoreFontScale('exit') })
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { restoreFontScale(sig); process.exit(130) })
}
process.on('uncaughtException', (e) => {
  console.error(`[FATAL] 未捕获异常：${String(e && e.message).slice(0, 300)}`)
  restoreFontScale('uncaughtException')
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(`[FATAL] 未处理的 Promise 拒绝：${String(e && (e.message || e)).slice(0, 300)}`)
  restoreFontScale('unhandledRejection')
  process.exit(1)
})

/**
 * 等「页面就绪」（见下）之后，再定义档位表。
 * 注意：`STEPS` 必须在使用之前定义。
 */
const STEPS = [
  { v: '1.0', label: '基线（默认）' },
  { v: '1.5', label: '放大' },
  { v: '0.85', label: '缩小' },
  { v: '1.0', label: '还原' },
]

/**
 * 等「页面就绪」—— font_scale 变更会触发 WebView 目标重建 + 页面重挂载，
 * 重建空档里整页为空（`editablePresent:false` / `hasBall:false` / `composer:null`）。
 *
 * 【第 39 次坑的第二层】首版只 `sleep(5500)` 就采样，放大档**恰好落在空档**
 * ⇒ S2/S5 报 FAIL，而真相是「这一刻测不出来」（P-17：**测不出来 ≠ 事实否定**）。
 * 纪律：凡会重建目标的夹具，采样前必须**轮询等就绪**（连续两次签名一致）。
 */
async function waitReady(maxMs = 90000) {
  const t0 = Date.now()
  let last = null, lastSig = null, hits = 0
  while (Date.now() - t0 < maxMs) {
    try {
      last = JSON.parse(await ev(SNAP, 2, 800))
      const sig = `${last.editablePresent}|${last.overlayPresent}|${last.hamVisible}|${last.sbFixed}|${last.innerW}`
      if (sig === lastSig) hits++; else hits = 0
      lastSig = sig
      if (hits >= 1 && last.editablePresent === true) return last   // 连续两次一致且输入区在场
    } catch { /* 重建中，继续等 */ }
    await sleep(1200)
  }
  return last
}

const snaps = {}
// 【第 42 次坑】首档采样前必须先等应用完全起来：刚 `adb install` 后 runtime 仍在**首次解压**，
// 此时 `waitReady` 也会拿到「未就绪」快照并当作基线 ⇒ S3/S7 因基线脏而假 FAIL。
// 故：① 循环前先做一次就绪等待；② 每档就绪失败时**出声**（不静默）。
console.log('\n[前置] 等应用完全就绪（首次安装后 runtime 解压可能持续数十秒）…')
const pre = await waitReady(120000)
console.log(`[前置] editablePresent=${pre?.editablePresent} overlay=${pre?.overlayPresent} 汉堡=${pre?.hamVisible} 侧栏=${pre?.sbFixed}`)

for (const s of STEPS) {
  setFontScaleTracked(s.v)   // 【P-48/P-1】走登记式写入（先登记再改，无窗口）
  await sleep(3000)
  const snap = await waitReady()
  const key = (s.v === '1.0' && snaps['1.0']) ? '1.0r' : s.v   // 两个 1.0 档：基线 / 还原
  snaps[key] = snap
  console.log(`\n=== font_scale=${s.v}（${s.label}）===`)
  console.log(JSON.stringify(snap))
  if (!snap || snap.editablePresent !== true) console.log(`  ⚠️ 该档采样未就绪（editablePresent=${snap?.editablePresent}）—— 相关判据记 SKIP，不记 FAIL（P-17）`)
}

// ---- 还原并校验（夹具安全）----
// 【P-48】改走**幂等单源** `restoreFontScale()`（与 exit/异常兜底**同一个函数**）——
// 同一语义只有一处实现（P-1），且它可被重复调用（`process.on('exit')` 那次会跳过）。
const rr = restoreFontScale('normal')
await sleep(2000)
const restored = getFontScale()
const restoreOk = restored === ORIGINAL && rr.ok !== false

const base = snaps['1.0'], big = snaps['1.5'], small = snaps['0.85'], back = snaps['1.0r']

console.log('\n=== 判据 ===')
const s0 = base && big && big.rootFs !== base.rootFs
console.log(`S0 杠杆：字号真的随系统变   : ${s0 ? `PASS  ${base?.rootFs}px → ${big?.rootFs}px` : 'SKIP  系统 font_scale 未传导到 WebView ⇒ 后续判据测不出来（不等于事实否定）'}`)

const noOverflow = (s) => s && (s.scrollW - s.clientW) <= 1
const s1 = s0 ? (noOverflow(base) && noOverflow(big) && noOverflow(small)) : null
console.log(`S1 各档无横向溢出           : ${s1 === null ? 'SKIP（无杠杆）' : (s1 ? 'PASS' : `FAIL  溢出 基线=${base.scrollW - base.clientW} 放大=${big.scrollW - big.clientW} 缩小=${small.scrollW - small.clientW}`)}`)

const ready = (s) => !!s && s.editablePresent === true

// S2：只在**采样就绪**的档位上断言；未就绪的档位不计入断言（P-17：测不出来 ≠ 事实否定）
const composerInView = (s) => (!ready(s) || !s.composer) ? null : (s.composer.t >= -1 && s.composer.b <= s.innerH + 1)
const cB2 = composerInView(base), cL2 = composerInView(big), cS2 = composerInView(small)
const s2 = s0 ? (cB2 === false || cL2 === false || cS2 === false) ? false : ((cB2 === true || cL2 === true || cS2 === true) ? true : null) : null
const cDetail = `基线=${ready(base) ? JSON.stringify(base.composer) : '未就绪'} 放大=${ready(big) ? JSON.stringify(big.composer) : '未就绪'} 缩小=${ready(small) ? JSON.stringify(small.composer) : '未就绪'}（视口高 ${base?.innerH}）`
console.log(`S2 输入区在各档都在视口内   : ${s2 === null ? 'SKIP（无杠杆）' : (s2 ? `PASS  ${cDetail}` : `FAIL  ${cDetail}`)}`)

const suiteOn = (s) => s && s.hamVisible === true && s.sbFixed === 'fixed'
// 只在**就绪**的档位上断言（未就绪 = 整页空 ⇒ 汉堡/侧栏必然读不到，那是测不出来，不是失效）
const suiteReady = [base, big, small].filter(ready)
const s3 = s0 ? (suiteReady.length === 0 ? null : suiteReady.every(suiteOn)) : null
const suiteDetail = [['基线', base], ['放大', big], ['缩小', small]]
  .map(([k, s]) => ready(s) ? `${k}(汉堡=${s.hamVisible} 侧栏=${s.sbFixed})` : `${k}(未就绪)`).join(' ')
console.log(`S3 手机五件套各档仍生效     : ${s3 === null ? 'SKIP（无就绪档位）' : (s3 ? `PASS  ${suiteDetail}` : `FAIL  ${suiteDetail}`)}`)

// 【P-43/R17 · W36 续】裁切计数**只在「真的扫到了我方元素」时才有效**：
// 旧实现无我方容器时退化扫全页 ⇒ 把宿主 `visuallyHidden` 无障碍隐藏元素算成「我方被裁文本」
// ⇒ S4 恒 FAIL（设备取证见快照处的长注释）。现按 `clipScanned` 分流：
//   · 扫到了我方元素 ⇒ 用 clipped 计数（真判据）
//   · 没扫到（我方容器未渲染）⇒ 记 **null** ⇒ S4 走 SKIP（无判据力，P-43）
const clipCount = (s) => (ready(s) && s.clipScanned === true && Array.isArray(s.clipped)) ? s.clipped.length : null
const cB = clipCount(base), cL = clipCount(big), cS = clipCount(small)
const clipReady = [cB, cL, cS].filter(v => v !== null)
const s4 = s0 ? (clipReady.length === 0 ? null : clipReady.every(v => v === 0)) : null
console.log(`S4 无「被裁掉又滚不到」的文本: ${s4 === null ? 'SKIP（本页无我方容器/元素 ⇒ 裁切扫描面为 0，判据力前提不成立，P-43）' : (s4 ? `PASS  基线=${cB} 放大=${cL} 缩小=${cS}` : `FAIL  基线=${cB} 放大=${cL} 缩小=${cS} 例：${JSON.stringify((big?.clipped ?? small?.clipped ?? base?.clipped)?.slice(0, 3))}`)}`)

const ballIn = (s) => (ready(s) && s.hasBall) ? (s.ballRect.l >= -1 && s.ballRect.t >= -1 && s.ballRect.r <= s.innerW + 1 && s.ballRect.b <= s.innerH + 1) : null
const bAll = [ballIn(base), ballIn(big), ballIn(small)].filter(v => v !== null)
const s5 = s0 ? (bAll.length === 0 ? null : bAll.every(v => v === true)) : null
console.log(`S5 浮球在各档都在视口内     : ${s5 === null ? 'N/A（就绪档位里本页无浮球）' : (s5 ? `PASS  放大=${JSON.stringify(big?.ballRect)} 缩小=${JSON.stringify(small?.ballRect)}` : `FAIL  放大=${JSON.stringify(big?.ballRect)} 缩小=${JSON.stringify(small?.ballRect)}`)}`)

// S6：缩小档的**我方**触控目标（放大档不可能暴露这个风险方向）
// 判据力前提：该档必须真的扫到 ≥1 个我方目标，否则「无一过小」会退化成恒真（P-24/P-19）
const TOUCH_MIN = 38
const tooSmall = []
if (ready(small)) {
  for (const [k, v] of Object.entries(small.targets || {})) {
    if (v && (v.w < TOUCH_MIN || v.h < TOUCH_MIN)) tooSmall.push(`${k}=${v.w}×${v.h}`)
  }
}
const s6 = s0 ? ((ready(small) && small.targetCount > 0) ? tooSmall.length === 0 : null) : null
console.log(`S6 缩小档我方目标仍 ≥${TOUCH_MIN}px : ${s6 === null ? 'SKIP（缩小档未就绪或无我方目标，判据力前提不成立）' : (s6 ? `PASS  ${JSON.stringify(small.targets)}` : `FAIL  ${tooSmall.join(' / ')}`)}`)

// S7 由两件**独立**的事组成，必须分辨（P-17/R8）：
//   ① 快照幂等：只在**基线与还原档都就绪**时才能比（基线脏 ⇒ 「不一致」毫无意义）
//   ② 系统设置已还原：这是**夹具安全**，与就绪无关，永远是硬判据
//
// 【W36 续 · P-46 推论三/P-47 修复】原实现用 `JSON.stringify(base) === JSON.stringify(back)`
// **逐字比整个快照** ⇒ 把**会随重挂载抖动的量**也纳入了签名（同 W34 的 `sig` 教训）。
// 设备取证（`tmp/w36-s7-ball-forensics.mjs`）：基线档 `hasBall:true`、还原档 `hasBall:false`，
// 而**在不改任何设置、只等**的前提下，浮球在 **t=6s 自行出现**
// ⇒ 归因是**就绪竞态**（`font_scale` 变更触发 WebView 目标重建 + 页面重挂载，
//   浮球是**异步挂载**的，采样时它还没回来），**不是产品缺陷**（P-47：不许用一层的现象指控另一层）。
// ★ 修法：S7 只比**不受重挂载影响的量**（`rootFs` + 五件套可见性 + 溢出/裁切计数），
//   并**显式排除**随挂载进度变化的量（`ballRect` / `hasBall` / `targets` / `clipped`）。
//   被排除的量仍**照常打印**在快照里（可追溯，不算丢失证据）。
const idemKey = (s) => JSON.stringify({
  rootFs: s.rootFs, innerW: s.innerW, clientW: s.clientW, scrollW: s.scrollW,
  hamVisible: s.hamVisible, sbFixed: s.sbFixed,
  overlayPresent: s.overlayPresent, editablePresent: s.editablePresent,
})
const snapIdem = (ready(base) && ready(back)) ? (idemKey(base) === idemKey(back)) : null
const s7 = s0 ? (restoreOk ? (snapIdem === false ? false : (snapIdem === true ? true : null)) : false) : null
const snapMsg = snapIdem === null ? '快照未比（基线或还原档未就绪）'
  : (snapIdem ? '快照关键量一致（rootFs/五件套/就绪面）'
    : `快照关键量不一致：基线=${idemKey(base)} 还原=${idemKey(back)}`)
console.log(`S7 还原幂等 + 系统设置已还原: ${s7 === null ? `SKIP（无杠杆）· ${snapMsg} · font_scale=${restored}` : (s7 ? `PASS  ${snapMsg} · font_scale=${restored}` : `FAIL  ${snapMsg} · 系统 font_scale 读回=${restored}（应为 ${ORIGINAL}）`)}`)
// 夹具安全是**永不豁免**的判据（即便 s0 无杠杆也要报）
console.log(`S8 夹具安全：font_scale 已还原: ${restoreOk ? `PASS  ${restored}` : `FAIL  读回=${restored}（应为 ${ORIGINAL}）`}`)

if (!restoreOk) {
  console.error(`\n[FATAL] font_scale 未能还原（读回 ${restored}，应为 ${ORIGINAL}）—— 设备已被污染，请手工恢复`)
}

const fails = []
if (s0) {
  if (s1 === false) fails.push('S1')
  if (s2 === false) fails.push('S2')
  if (s3 === false) fails.push('S3')
  if (s4 === false) fails.push('S4')
  if (s5 === false) fails.push('S5')
  if (s6 === false) fails.push('S6')
  if (s7 === false) fails.push('S7')
}
if (!restoreOk) fails.push('S8')
console.log(`\n[ef-font-scale] ${fails.length === 0 ? (s0 ? '全部 PASS' : 'SKIP（无杠杆：系统 font_scale 未传导）') : `FAIL: ${fails.join(', ')}`}`)
process.exit(fails.length === 0 && restoreOk ? 0 : 1)
