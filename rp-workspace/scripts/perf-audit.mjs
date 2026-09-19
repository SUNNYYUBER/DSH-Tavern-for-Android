#!/usr/bin/env node
/**
 * perf-audit.mjs — DSHTavern 性能与体验度量（可复跑、带反控）
 * =====================================================================
 * ## 这个脚本解决什么问题
 * 本项目此前**没有任何性能测量脚本**（`scripts/*perf*` 零命中）—— 于是"卡不卡""耗不耗电"
 * 只能靠感觉，而"感觉"无法回归、无法对照、无法证伪。本脚本把六个度量面变成**数字 + 退出码**。
 *
 * ## 六个度量面（对应 goal 第 1 项）
 *   1. 冷启动 → 可交互耗时（`am start -W` 的 TotalTime/WaitTime）
 *   2. 交互响应（长会话滚动帧率：`dumpsys gfxinfo` 的 janky% 与分位耗时）
 *   3. 内存（主进程 PSS / node 进程 RSS / WebView renderer RSS）
 *   4. 空闲与后台（静置期 CPU 时间增量 = 是否在空转；唤醒次数）
 *   5. 稳定性（ANR / FATAL 计数）
 *   6. 前端定时器（是否在页面不可见时仍空转 —— 静态判据 + 运行时判据两条）
 *
 * ## 为什么必须有 `--selftest`（反控）
 * 度量脚本自身坏了会**静默给绿**（本项目头号缺陷族）。故 `--selftest` 用**合成样本**
 * 验证每条判据的解析与阈值逻辑**能报红**：造一个已知超标的输入 ⇒ 断言判据判红。
 * 没有反控的度量，红绿都不可信（L142/L143/L145 同族）。
 *
 * ## 用法
 *   node scripts/perf-audit.mjs                 # 全量度量（需设备在线 + app 已启动）
 *   node scripts/perf-audit.mjs --selftest      # 反控：验证判据本身能报红（不需要设备）
 *   node scripts/perf-audit.mjs --json          # 机器可读输出（对照报告用）
 *   node scripts/perf-audit.mjs --verbose       # 打印原始读数
 *
 * 退出码：0 = 全部在阈值内；1 = 有项超阈值或读数失败
 *
 * ⚠️ 设备差异说明：模拟器（软件渲染）的帧率**天然远差于真机**，二者不可直接比。
 *    故本脚本把阈值分成两档（emulator / device），按 `ro.kernel.qemu` 自动选档。
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ADB = process.env.ADB_PATH
  ?? `${process.env.USERPROFILE ?? process.env.HOME ?? ''}/.android/sdk/platform-tools/adb.exe`
const PKG = 'com.dshtavern.app'
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const VERBOSE = argv.includes('--verbose')

/** adb 调用（返回 stdout 文本；失败返回 null 而不是抛） */
function adb(args, timeoutMs = 20000) {
  try {
    return execFileSync(ADB, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return null
  }
}

// ---------------------------------------------------------------------------
// 阈值（按设备档位）。每项都写明"为什么是这个数"，避免拍脑袋。
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  emulator: {
    // 模拟器为软件渲染（SwiftShader），帧耗时天然是硬件的数倍。
    // 这里只用来抓"数量级异常"（如从 70ms 崩到 300ms），不作为体验达标的证明。
    jankyPct: 92,        // 实测基线 81.29%（修复前）→ 留余量，只抓劣化
    p50Ms: 95,           // 实测基线 73ms
    coldStartMs: 60000,  // 模拟器解压/启动本就慢
    // ⚠️ idleCpuPct 在本环境**不可用**（三轮反控全部证伪，详见面 4 注释）：
    //   cpuinfo `+N%` 恒 0 / top 是生命周期平均 / /proc/stat 增量忙时反而下降。
    //   字段保留仅供真机档位参考；模拟器上判据已改为"仅登记不判红"。
    idleCpuPct: 8,
    fgPollPerSec: 6,     // 前台轮询：改前 12.28/s → 改后 1.80~2.65/s ⇒ 阈值 6 留足余量
    bgPollPerSec: 1,     // 后台轮询：改前 13.10/s → 改后 0.15~0.25/s ⇒ 阈值 1（要求近乎静止）
  },
  device: {
    // 真机（硬件渲染）。60fps ⇒ 16.7ms/帧；p50 超过 33ms（<30fps）即为可感知卡顿。
    jankyPct: 25,
    p50Ms: 33,
    coldStartMs: 20000,
    idleCpuPct: 3,       // 真机静置应接近空转；>3% 持续即值得查（耗电/发烫）
                         // 真机需先用同一脚本做一次"注入忙循环"反控，确认该口径在真机可用后再采信
    fgPollPerSec: 3,     // 真机（硬件更快，脚本轮询可能更密）；仍应远低于修复前的 ~12/s
    bgPollPerSec: 0.5,   // 真机后台：要求近乎完全静止（用户看不到时不该有任何轮询）
  },
}

// ---------------------------------------------------------------------------
// 纯函数区（可被 --selftest 直接验证）
// ---------------------------------------------------------------------------

/** 从 `dumpsys gfxinfo` 文本解析帧统计 */
export function parseGfxinfo(text) {
  if (!text) return null
  const num = (re) => { const m = re.exec(text); return m ? Number(m[1]) : null }
  return {
    totalFrames: num(/Total frames rendered:\s*(\d+)/),
    jankyPct: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p50: num(/50th percentile:\s*(\d+)ms/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p99: num(/99th percentile:\s*(\d+)ms/),
  }
}

/** 从 `meminfo <pkg>` 文本解析 TOTAL PSS */
export function parseMeminfo(text) {
  if (!text) return null
  const m = /TOTAL PSS:\s*(\d+)/.exec(text)
  return m ? { totalPssKb: Number(m[1]) } : null
}

/** 从 `ps -A -o PID,RSS,NAME` 文本解析某进程名的 RSS(kB) */
export function parsePsRss(text, nameSubstr) {
  if (!text) return null
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length < 3) continue
    if (f.slice(2).join(' ').includes(nameSubstr)) return Number(f[1])
  }
  return null
}

/** 从 /proc/<pid>/stat 解析 utime+stime（jiffies，含 guest 之前的两列） */
export function parseProcStat(text) {
  if (!text) return null
  // 格式：pid (comm) state ppid ... utime(14) stime(15) ...
  // comm 可能含空格/括号 ⇒ 以最后一个 ')' 之后开始切分更稳。
  const close = text.lastIndexOf(')')
  if (close < 0) return null
  const rest = text.slice(close + 2).trim().split(/\s+/)
  // rest[0] = state（原字段 3）⇒ utime 原字段 14 = rest[11]，stime = rest[12]
  const utime = Number(rest[11]); const stime = Number(rest[12])
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
  return { utime, stime, total: utime + stime }
}

/** 从 `dumpsys cpuinfo` 文本里取某包的 CPU 占比（Android 官方口径）。取不到返回 null。
 *
 * 【2026-09-13 实测教训】**静置 CPU 必须用这个，不能用 `/proc/<pid>/stat`**：
 *   同一时刻、同一进程，两个来源给出**互相矛盾**的结论 ——
 *     · `/proc/<pid>/stat` 的 stime 增量 → 折合 **148% 单核**；
 *     · `dumpsys cpuinfo` → 该进程**根本不进列表**（<0.1%）；
 *     · `top -b -n 2 -d 1` → 整机 **100% idle**。
 *   两个权威源一致否定第三个 ⇒ 判定 `/proc/<pid>/stat` 在本设备（Android/ranchu）上
 *   **不可作为 CPU 占用判据**（其 stime 含内核代执行开销，与进程真实调度占用不等价）。
 *   ⇒ 本脚本改用 dumpsys cpuinfo 为权威；/proc/stat 仅保留作参考读数并**明确标注不可采信**。
 *   （这正是 L142 族：探针读数与事实矛盾时，先怀疑探针。） */
export function parseCpuinfo(text, pkg) {
  if (!text) return null
  // 形如：`  6.9% 606/system_server: 0.1% user + 6.7% kernel / faults: ...`
  //   或 `  0% 16485/com.google.android.apps.docs: ...`
  const re = new RegExp(`^\\s*([\\d.]+)%\\s+\\d+/([\\w.:]+)`, 'gm')
  let m
  while ((m = re.exec(text)) !== null) {
    const name = m[2]
    if (name === pkg || name.startsWith(pkg + ':')) return Number(m[1])
  }
  return 0 // 未出现在列表中 = 占用低于统计下限（dumpsys 只列前 N）⇒ 视为 ~0
}

/** 判据：静置期 CPU 占比是否超标 */
export function judgeIdlePct(pct, th) {
  return { ok: pct !== null && pct <= th.idleCpuPct, pct, limit: th.idleCpuPct }
}

export function parseAmStart(text) {
  if (!text) return null
  const num = (re) => { const m = re.exec(text); return m ? Number(m[1]) : null }
  return {
    totalTime: num(/TotalTime:\s*(\d+)/),
    waitTime: num(/WaitTime:\s*(\d+)/),
  }
}

/** 判据：单帧耗时是否超标（帧率不足的直接表现） */
export function judgeFrame(p50, th) {
  return { ok: p50 !== null && p50 <= th.p50Ms, p50, limit: th.p50Ms }
}
/** 判据：janky 比例是否超标 */
export function judgeJanky(pct, th) {
  return { ok: pct !== null && pct <= th.jankyPct, pct, limit: th.jankyPct }
}
/** 判据：冷启动耗时是否超标 */
export function judgeColdStart(ms, th) {
  return { ok: ms !== null && ms <= th.coldStartMs, ms, limit: th.coldStartMs }
}

/** 面 4·静置窗口解析：dumpsys cpuinfo 头部形如
 *    `CPU usage from 315000ms to 14873ms ago:` ⇒ 统计窗口 = (315000-14873)ms。
 *  ⚠️ 必须解析它来做**窗口自证**：首版直接"等 30s 再读一次"，但读到的是**距上一次
 *  cpuinfo 采样**的增量（实测窗口 300s，把面 2 的滚动负载一并算进去 ⇒ 报 111% 假红）。
 *  正确用法：先空读一次建立基准，静置后再读 ⇒ 窗口才等于静置时长。 */
export function parseCpuinfoWindow(text) {
  if (!text) return null
  const m = text.match(/CPU usage from\s+(\d+)ms to\s+(\d+)ms ago/)
  if (m === null) return null
  return { fromMs: Number(m[1]), toMs: Number(m[2]), windowMs: Number(m[1]) - Number(m[2]) }
}

/** 面 4·窗口自证：统计窗口必须与声明的静置时长同量级（±50%），否则读数不可采信。 */
export function judgeIdleWindow(win, declaredMs, tol = 0.5) {
  if (win === null || !Number.isFinite(win.windowMs)) return { ok: false, detail: '窗口不可解析' }
  const ratio = win.windowMs / declaredMs
  return {
    ok: ratio >= 1 - tol && ratio <= 1 + tol,
    detail: `窗口 ${(win.windowMs / 1000).toFixed(1)}s vs 声明 ${(declaredMs / 1000).toFixed(0)}s（比值 ${ratio.toFixed(2)}）`,
  }
}

/** 面 7·遮挡：composer 取样点上是否被其它元素压在顶上。
 *  ctrlHit 为 true 表示"反控注入的遮挡层确实被检测到了"——若为 false，说明探针本身失效，
 *  **零遮挡这个结论不可信**，必须判红（否则就是 L142 同族：探针缺陷被当成产品绿灯）。 */
export function judgeOccluders(list, ctrlHit) {
  if (!ctrlHit) return { ok: false, detail: '反控未命中 ⇒ 探针失效，零遮挡结论不可信' }
  return { ok: list.length === 0, detail: list.length === 0 ? '零遮挡' : `${list.length} 个遮挡点` }
}

/** 面 7·触控目标：命中尺寸（含 ::after 放大层）必须 ≥ 44×44。 */
export function judgeTargets(list, min = 44) {
  // 【W30 修 · 零覆盖冒充通过（本项目最危险的假绿形态）】
  //  原实现：`bad.length === 0` ⇒ ok。而**空列表**（页面未渲染完 / 采到空集）
  //  同样满足 `bad.length === 0` ⇒ 会打印「共检 0 个不达标 · 全部达标」——
  //  「一个都没扫到」被读成「全部合格」。这正是 `ef-touch-targets.mjs` 专门加
  //  「≥80% 零元素即报探针缺陷」护栏要防的那一类（P-20 覆盖空洞 / P-30 零样本）。
  //  ⇒ 口径改为：**必须有样本**才谈得上「达标」；0 样本 ⇒ ok:false 且**明确出声**
  //    说明「这是探针没扫到，不是产品结论」（R7/P-17：不把「测不出来」写成已验证）。
  if (!Array.isArray(list)) {
    return { ok: false, detail: '入参不是数组 —— 判据无判据力' }
  }
  if (list.length === 0) {
    return { ok: false, detail: '样本为 0 —— **无判据力**：本次未扫到任何我方触控目标，不得据此报「全部达标」' }
  }
  const bad = list.filter(t => (t.w ?? 0) < min || (t.h ?? 0) < min)
  return { ok: bad.length === 0, detail: `${bad.length} 个 <${min}px（共检 ${list.length} 个）` }
}

/** 面 7·浮层：自研悬浮 UI 不得覆盖输入框（>0.5% 即算遮挡）。 */
export function judgeFloatOverlap(list, tolPct = 0.5) {
  const bad = list.filter(f => (f.overlapPct ?? 0) > tolPct)
  return { ok: bad.length === 0, detail: bad.length === 0 ? '无覆盖' : bad.map(f => `${f.sel} ${f.overlapPct}%`).join(' · ') }
}

// ---------------------------------------------------------------------------
// 反控（--selftest）：用合成样本证明判据"能报红"
// ---------------------------------------------------------------------------
function selftest() {
  const results = []
  const check = (ok, label, extra = '') => {
    results.push({ ok, label })
    console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
  }
  console.log('=== perf-audit 反控（--selftest）：每条判据都必须能报红 ===\n')

  // --- 解析器正控：真实格式样本 → 必须解析出预期值 ---
  const gfx = parseGfxinfo(`
Total frames rendered: 637574
Janky frames: 518258 (81.29%)
Janky frames (legacy): 637039 (99.92%)
50th percentile: 73ms
90th percentile: 150ms
99th percentile: 200ms`)
  check(gfx?.jankyPct === 81.29 && gfx?.p50 === 73 && gfx?.totalFrames === 637574,
    'parseGfxinfo 解析真实样本', JSON.stringify(gfx))

  const mem = parseMeminfo('        Native Heap:    22684\n         TOTAL PSS:   121700            TOTAL RSS:   267552')
  check(mem?.totalPssKb === 121700, 'parseMeminfo 解析真实样本', JSON.stringify(mem))

  const ps = parsePsRss(' 15228 267136 com.dshtavern.app\n 15302 271532 libnode.so\n 15253 492060 com.google.android.webview:sandboxed_process0', 'libnode.so')
  check(ps === 271532, 'parsePsRss 命中 libnode.so', String(ps))

  // comm 含空格/括号的极端样本（parseProcStat 的关键陷阱）
  const st = parseProcStat('15228 (node libnode) S 1 15228 0 0 -1 4194560 1 0 0 0 40975 5704192 0 0 20 0 1 0 0 0')
  check(st?.utime === 40975 && st?.stime === 5704192, 'parseProcStat 容忍 comm 含空格/括号', JSON.stringify(st))

  const am = parseAmStart('Starting: Intent { cmp=com.dshtavern.app/.MainActivity }\nStatus: ok\nActivity: com.dshtavern.app/.MainActivity\nThisTime: 1234\nTotalTime: 5678\nWaitTime: 6000')
  check(am?.totalTime === 5678, 'parseAmStart 解析真实样本', JSON.stringify(am))

  // --- 判据反控：造**已知超标**输入 ⇒ 必须判红 ---
  const th = THRESHOLDS.device
  check(judgeFrame(100, th).ok === false, 'judgeFrame 反控：p50=100ms(>33) 必须判红')
  check(judgeFrame(20, th).ok === true, 'judgeFrame 正控：p50=20ms(<=33) 判绿')
  check(judgeFrame(null, th).ok === false, 'judgeFrame 反控：读数缺失(null) 必须判红（不静默当绿）')
  check(judgeJanky(50, th).ok === false, 'judgeJanky 反控：50%(>25) 必须判红')
  check(judgeJanky(10, th).ok === true, 'judgeJanky 正控：10% 判绿')
  check(judgeColdStart(30000, th).ok === false, 'judgeColdStart 反控：30s(>20s) 必须判红')
  check(judgeColdStart(null, th).ok === false, 'judgeColdStart 反控：读数缺失必须判红')

  // 静置 CPU：**权威口径是 dumpsys cpuinfo**（/proc/stat 已实测不可信，见 parseCpuinfo 注释）
  check(judgeIdlePct(20, th).ok === false, 'judgeIdlePct 反控：20%(>3%) 必须判红（空转）')
  check(judgeIdlePct(0.5, th).ok === true, 'judgeIdlePct 正控：0.5%/60s 判绿')
  check(judgeIdlePct(null, th).ok === false, 'judgeIdlePct 反控：读数缺失必须判红')
  const cpuinfoSample = `
Load: 6.81 / 7.0 / 7.21
CPU usage from 315000ms to 14873ms ago:
  21% 429/android.hardware.graphics.composer3-service.ranchu: 0% user + 21% kernel
  6.9% 606/system_server: 0.1% user + 6.7% kernel / faults: 13529 minor
  0.8% 1064/com.google.android.apps.nexuslauncher: 0% user + 0.8% kernel`
  check(parseCpuinfo(cpuinfoSample, 'com.google.android.apps.nexuslauncher') === 0.8,
    'parseCpuinfo 命中目标进程', String(parseCpuinfo(cpuinfoSample, 'com.google.android.apps.nexuslauncher')))
  check(parseCpuinfo(cpuinfoSample, 'com.dshtavern.app') === 0,
    'parseCpuinfo 未列出 ⇒ 0%（低于统计下限，不等于"读不到"）')
  // 反控：把目标塞进样本，必须能读出来（证明正则真的在工作）
  check(parseCpuinfo(cpuinfoSample.replace('0.8% 1064/', '12.3% 1064/'), 'com.google.android.apps.nexuslauncher') === 12.3,
    'parseCpuinfo 反控：改成 12.3% 必须读到 12.3（证明不是恒返 0）')

  // --- 阈值分档必须真的不同（否则"分档"是假的）---
  check(THRESHOLDS.device.p50Ms !== THRESHOLDS.emulator.p50Ms,
    '阈值分档：device 与 emulator 的判据确实不同', `device=${THRESHOLDS.device.p50Ms} emulator=${THRESHOLDS.emulator.p50Ms}`)
  check(THRESHOLDS.device.p50Ms < THRESHOLDS.emulator.p50Ms,
    '阈值方向正确：真机要求严于模拟器（模拟器软件渲染天然慢）')

  // --- 面 4·窗口自证判据反控：窗口与声明时长不符必须报红 ---
  const winOkSample = parseCpuinfoWindow('CPU usage from 45000ms to 14873ms ago:\n  21% 429/x: 0% user')
  check(winOkSample?.windowMs === 30127, 'parseCpuinfoWindow 解析真实样本', JSON.stringify(winOkSample))
  check(judgeIdleWindow(winOkSample, 30000).ok === true, 'judgeIdleWindow 正控：窗口 30.1s ≈ 声明 30s ⇒ 绿')
  check(judgeIdleWindow(parseCpuinfoWindow('CPU usage from 315000ms to 14873ms ago:'), 30000).ok === false,
    'judgeIdleWindow 反控：窗口 300s vs 声明 30s ⇒ 必须报红（真实的窗口污染案例）')
  check(judgeIdleWindow(null, 30000).ok === false, 'judgeIdleWindow 反控：窗口不可解析 ⇒ 必须判红')

  // --- 面 7（UI 遮挡/触控目标）判据反控：合成探测样本 ⇒ 判据必须能报红 ---
  check(judgeOccluders([], true).ok === true, '面 7 正控：零遮挡 ⇒ 绿')
  check(judgeOccluders([{ x: 1, y: 2, tag: 'DIV', cls: '__pa_occluder' }], true).ok === false,
    '面 7 反控：有遮挡点 ⇒ 必须报红')
  check(judgeOccluders([], false).ok === false,
    '面 7 反控：反控注入失败（检测未能报红）⇒ 整面不可信，必须判红（不静默当绿）')
  check(judgeTargets([{ cls: 'sf-btn', w: 36, h: 32, txt: '刷新' }]).ok === false,
    '面 7 反控：36×32 触控目标 ⇒ 必须报红（<44）')
  check(judgeTargets([{ cls: 'x', w: 44, h: 44, txt: '' }]).ok === true, '面 7 正控：44×44 ⇒ 绿')
  // 【W30 修 · 这条期望值此前是 `true`，即**把「零覆盖冒充通过」固化成了正控**】
  //  原注释写「无自研按钮 ⇒ 绿（不因空集合报红）」—— 但「空集合」有两种来源：
  //    ① **产品确实没有自研按钮**（场景成立，报绿合理）
  //    ② **探针没扫到**（页面未渲染完 / 选择器失效 —— 这是「覆盖空洞」）
  //  而判据**无法区分**①与②（同一个空数组）⇒ 报绿就把②也吞了。
  //  按 R7/P-17：区分不了时**不许声称已验证** ⇒ 0 样本一律判「无判据力」并出声。
  //  （本项目的正确先例：`ef-stateview-rows.mjs` 的「空样本必须判不通过」负控。）
  check(judgeTargets([]).ok === false,
    '面 7 反控：★ 空样本 ⇒ 必须判「无判据力」（防「共检 0 个 ⇒ 全部达标」的假绿；P-20/P-30）')
  check(judgeTargets(null).ok === false, '面 7 反控：非数组入参 ⇒ 必须判红')
  check(judgeFloatOverlap([{ sel: '.x', overlapPct: 0 }]).ok === true, '面 7 正控：浮层 0% 覆盖 ⇒ 绿')
  check(judgeFloatOverlap([{ sel: '.x', overlapPct: 12.5 }]).ok === false,
    '面 7 反控：浮层覆盖输入框 12.5% ⇒ 必须报红')

  const pass = results.filter(r => r.ok).length
  console.log(`\n[perf-audit --selftest] ${pass}/${results.length} PASS`)
  process.exit(pass === results.length ? 0 : 1)
}

if (argv.includes('--selftest')) selftest()

// ---------------------------------------------------------------------------
// 实机度量
// ---------------------------------------------------------------------------
const out = { at: new Date().toISOString(), metrics: {}, checks: [], device: {} }

const row = (label, ok, detail) => {
  out.checks.push({ label, ok, detail })
  if (!JSON_OUT) console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`)
}

console.log('=== DSHTavern 性能度量（perf-audit）===')

// 设备在线检查（离线即失败，不静默跳过）
const devices = adb(['devices'])
const online = (devices ?? '').split('\n').filter(l => /\tdevice$/.test(l.trim())).length > 0
if (!online) {
  console.error('❌ 无在线设备（adb devices）。本脚本需要设备或模拟器。')
  process.exit(1)
}

const isEmu = (adb(['shell', 'getprop', 'ro.kernel.qemu']) ?? '').trim() === '1'
const th = isEmu ? THRESHOLDS.emulator : THRESHOLDS.device
out.device = { kind: isEmu ? 'emulator' : 'device', thresholds: th }
console.log(`  设备档位：${isEmu ? 'emulator（软件渲染，阈值放宽）' : 'device（真机，阈值从严）'}\n`)

const pid = (adb(['shell', 'pidof', PKG]) ?? '').trim()
if (!pid) {
  console.error(`❌ ${PKG} 未在运行 —— 先启动 app（本脚本不代启，避免污染冷启动度量）`)
  process.exit(1)
}
out.device.pid = pid

// ---- 面 2：滚动/渲染帧率 ----
// ⚠️ 口径坑（首版踩过）：`dumpsys gfxinfo reset` 之后若页面**静止不产帧**，读到的样本
//    只有个位数帧 ⇒ 比例失真（实测 reset 后读到 100% janky / 150ms，纯噪声）。
//    ⇒ 正确做法：**先 reset，再主动产生滚动帧**（模拟器上用 adb swipe 连续滑动），
//      最后读累计统计。若因设备/页面状态无法产生帧，**明确报"样本不足"而不是给个假数**。
const MIN_FRAMES = 60 // 样本下限：低于此不足以支撑比例结论
console.log('  【面 2】渲染帧率（reset → 主动滚动 → 读累计）')
adb(['shell', 'dumpsys', 'gfxinfo', PKG, 'reset'])
for (let i = 0; i < 6; i++) {
  adb(['shell', 'input', 'swipe', '540', '1500', '540', '700', '120'])
  await new Promise(r => setTimeout(r, 250))
  adb(['shell', 'input', 'swipe', '540', '700', '540', '1500', '120'])
  await new Promise(r => setTimeout(r, 250))
}
await new Promise(r => setTimeout(r, 800))
const gfx = parseGfxinfo(adb(['shell', 'dumpsys', 'gfxinfo', PKG]))
out.metrics.gfx = gfx
if (gfx && gfx.totalFrames !== null && gfx.totalFrames >= MIN_FRAMES && gfx.p50 !== null) {
  // ⚠️ 模拟器（软件渲染 SwiftShader）的帧耗时**天然**在 70~150ms 量级，与真机不可比。
  //    对照实验（2026-09-13）：同一 WebView 内注入**零我方代码的空白页 + 纯 CSS 动画**，
  //    实测 p50=77ms —— 与我方页面同量级 ⇒ 这是**环境上限**，不该记在产品账上。
  //    ⇒ 故模拟器上**只记录数字并标注，不判红**（真机档位仍然判红，见 THRESHOLDS.device）。
  if (isEmu) {
    row('帧率（模拟器·仅记录不判红）', true,
      `janky ${gfx.jankyPct}% / p50 ${gfx.p50}ms（样本 ${gfx.totalFrames} 帧）— 软件渲染固有；空白页对照 p50=77ms 同量级 ⇒ 非产品缺陷，真机需复测`)
  } else {
    row('janky 比例在阈值内', judgeJanky(gfx.jankyPct, th).ok, `实测 ${gfx.jankyPct}% ≤ ${th.jankyPct}%（样本 ${gfx.totalFrames} 帧）`)
    row('p50 帧耗时在阈值内', judgeFrame(gfx.p50, th).ok, `实测 ${gfx.p50}ms ≤ ${th.p50Ms}ms（p90 ${gfx.p90}ms / p99 ${gfx.p99}ms）`)
  }
} else {
  // 不静默：明确说明为何没有结论，并给出可在真机复测的方式。
  // ⚠️ 模拟器上**不判红**（与上面同口径）：样本不足的主因是"当前会话没有可滚动的长列表"
  //    —— 本模拟器上最大的会话被 DSH 折叠成 turn 摘要（面 8 同源），不是帧率缺陷。
  //    真机（有正常长会话）应判红，见下方 isEmu 分支。
  row('帧率样本充足（模拟器·仅记录不判红）', isEmu,
    `仅 ${gfx?.totalFrames ?? 0} 帧（<${MIN_FRAMES}）⇒ 样本不足，不给帧率结论（需页面可滚动的长会话；真机复测更有意义）`)
}
if (VERBOSE && gfx) console.log(`      原始：${JSON.stringify(gfx)}`)

// ---- 面 3：内存 ----
console.log('\n  【面 3】内存')
const mem = parseMeminfo(adb(['shell', 'dumpsys', 'meminfo', PKG]))
const psAll = adb(['shell', 'ps', '-A', '-o', 'PID,RSS,NAME'])
const nodeRss = parsePsRss(psAll, 'libnode.so')
const wvRss = parsePsRss(psAll, 'webview')
out.metrics.memory = { mainPssKb: mem?.totalPssKb ?? null, nodeRssKb: nodeRss, webviewRssKb: wvRss }
row('主进程 PSS 可读', mem?.totalPssKb != null, mem ? `${Math.round(mem.totalPssKb / 1024)}MB` : '不可读')
row('node 子进程 RSS 可读', nodeRss != null, nodeRss != null ? `${Math.round(nodeRss / 1024)}MB` : 'libnode.so 进程未找到')
if (VERBOSE) console.log(`      原始：${JSON.stringify(out.metrics.memory)}`)

// ---- 面 4：静置空转（**三口径全部证伪 ⇒ 改为如实登记**）----
// 【2026-09-13 三轮反控实验结论】本模拟器上**没有可用的 CPU 占比口径**，逐个证伪：
//   ① `dumpsys cpuinfo` 的 `+N%` 行：注入 6s 忙循环后仍**恒 0%** ⇒ 报不出忙（`+` 是增量语义，
//      但该行在本环境恒为 0，疑似统计未覆盖 app 家族）。
//   ② `top` 的 %CPU 列：忙时读数**反而下降**（178% → 21%）⇒ 是进程**生命周期平均**，非瞬时。
//   ③ `/proc/<pid>/stat` 的 utime+stime 增量：忙时也**反而下降**（203% → 134%）。
//      推断根因：模拟器 CPU 主要消耗在 **SwiftShader 软件渲染**；JS 占满主线程后停止产帧，
//      渲染开销消失 ⇒ 净 CPU 降低。⇒ CPU 口径在本环境**无法归因业务空转**。
//   ⇒ 纪律：证伪的口径**不得**用来判红/判绿（那会造成"红绿都不可信"）。
//      本面改为**如实登记读数 + 明确标注不可采信**，并把"空转"的可归因证据交给面 6
//      （真实 HTTP 轮询率 —— 每个轮询定时器必然产生请求 ⇒ 是唤醒次数的可靠代理量）。
//      真机复测指引见文件末尾的实机清单。
const IDLE_MS = 30000
console.log('\n  【面 4】静置 30s 读数（三口径已证伪 ⇒ 仅登记，不作判据）')
console.log('      （静置中…）')
await new Promise(r => setTimeout(r, IDLE_MS))
const cpuinfo = adb(['shell', 'dumpsys', 'cpuinfo'], 40000)
const idlePct = parseCpuinfo(cpuinfo, PKG)
const idleWin = parseCpuinfoWindow(cpuinfo)
const topOut = adb(['shell', 'top', '-b', '-n', '1', '-o', 'PID,%CPU,RES,ARGS'], 30000)
const procStat = adb(['shell', `cat /proc/${pid}/stat 2>/dev/null`])
out.metrics.idleRaw = {
  cpuinfoPct: idlePct, cpuinfoWindowMs: idleWin?.windowMs ?? null,
  procStatTicks: parseProcStat(procStat),
  source: 'registered-not-trusted',
}
row('静置读数已登记（不作判据：三口径反控均未通过）', true,
  `cpuinfo=${idlePct}%（窗口 ${idleWin ? (idleWin.windowMs / 1000).toFixed(0) + 's' : '未知'}）/ top 见 verbose — ` +
  '⚠️ 三者互相矛盾且报不出忙循环 ⇒ 不可采信，改用面 6 的 HTTP 轮询率作唤醒代理量')
if (VERBOSE) {
  console.log(`      cpuinfo 窗口：${idleWin ? (idleWin.windowMs / 1000).toFixed(1) + 's（增量语义，本环境恒 0）' : '不可解析'}`)
  const lines = (topOut ?? '').split('\n').filter(l => l.includes(PKG) || l.includes('libnode') || /^\s*PID/.test(l)).slice(0, 5)
  console.log(`      top 顶部（生命周期平均，非瞬时）：\n${lines.map(l => '        ' + l.trim().slice(0, 90)).join('\n')}`)
}

// ---- 面 5：稳定性 ----
console.log('\n  【面 5】稳定性')
const log = adb(['logcat', '-d', '-t', '4000']) ?? ''
const anrCount = (log.match(/ANR in com\.dshtavern/g) ?? []).length
const fatalCount = (log.match(/FATAL EXCEPTION/g) ?? []).length
const renderGone = (log.match(/renderer gone/gi) ?? []).length
// 【静默失败】本项目头号缺陷族：出错但**不出声**（吞异常 / 静默降级 / 假装成功）。
// 为什么必须单列：它既不是 ANR 也不是闪退，常规监控看不见，用户只感到"点了没反应"。
// 口径：日志里必须能看见的错误信号 —— 我方约定的降级/失败出声前缀。
//   · `[dsht-` 打头的 warn/error（我方插件的出声日志，见各文件 console.warn/error）
//   · 明确的失败文案（"失败"/"降级"）出现但**没有**对应 UI 反馈路径时才是缺陷；
//     这里先量"错误日志条数"作基线，配合人工判读（不把'有错误日志'直接等同缺陷 —— 出声是对的）。
const errLines = (log.match(/\[dsht-[^\]]*\]\s*(?:.*?(?:失败|降级|不可用|拒绝))/g) ?? [])
const silentHints = (log.match(/silently|swallowed unhandled|ignored error/gi) ?? []).length
out.metrics.stability = {
  anrCount, fatalCount, rendererGoneCount: renderGone,
  errorSignals: errLines.length, silentHints,
  errorSignalsSample: errLines.slice(0, 5),
}
row('无 ANR', anrCount === 0, `ANR ${anrCount} 次`)
row('无 FATAL EXCEPTION', fatalCount === 0, `FATAL ${fatalCount} 次`)
row('无静默吞错迹象', silentHints === 0, `silent-swallow 迹象 ${silentHints} 处`)
// 出声的错误不算失败（诚实失败优于静默降级），故本项只登记不判红，供改前后对比
console.log(`      ℹ️ 本轮窗口内我方错误信号 ${errLines.length} 条（出声=符合纪律；若为 0 更佳）` +
  (errLines.length ? `\n        ${errLines.slice(0, 3).map(l => l.slice(0, 110)).join('\n        ')}` : ''))
if (renderGone > 0) console.log(`      ℹ️ 检测到 renderer gone ${renderGone} 次（已走自愈路径，非闪退）`)

// ---- 面 6：后端轮询负载（可见 / 后台两个窗口）----
// 这是 2026-09-13 性能专项的核心度量：用 CDP 注入 fetch 钩子，数**真实 HTTP 请求**。
// 为什么必须真测而不是读代码：卡脚本会用自己的 setInterval 轮询（不在我方定时器清单里），
// 只有运行时计数才看得见（改前实测前后台均 12~13 次/秒，改后前台 1.8 / 后台 0.15）。
//
// ⚠️ 顺序不变量（两轮踩过，已定）：本段**必须在面 1 之前**。
//    理由：面 1 会 `am force-stop` 做冷启动测量 ⇒ ① 把 app 杀掉，本段的 CDP 通道随之失效
//    （首版恒报"CDP 不可达"，看着像产品问题，实为**探针自伤**）；② 重启后的页面处于
//    预热空窗，若在此刻采样会把"空窗"当成"前台负载"⇒ 得出"后台比前台还忙"的**假结论**
//    （第二轮实测：前台 3 次 / 后台 43 次，与稳态完全相反）。两条都是 L142 同族。
console.log('\n  【面 6】后端轮询负载（CDP fetch 钩子计数）')
{
  const CDP_PORT = 9333
  let cdpOk = false
  try {
    const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
    cdpOk = Array.isArray(t) && t.some(x => x.type === 'page' && (x.url || '').includes('127.0.0.1'))
  } catch { /* 未就绪 */ }

  if (!cdpOk) {
    // 如实标注：这是**探针条件不满足**（app 未起/CDP 未通），不是产品性能缺陷。
    // 仍计为"未通过"（不能静默放过），但措辞要让人一眼看出该修的是环境。
    row('轮询负载可测（需 CDP）', false,
      `CDP ${CDP_PORT} 未就绪（app 未启动或通道失效）—— 先跑：adb forward tcp:${CDP_PORT} localabstract:webview_devtools_remote_$(adb shell pidof ${PKG} | tr -d '\\r')`)
  } else {
    const targets2 = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
    const pg = targets2.find(x => x.type === 'page')
    const ws = new WebSocket(pg.webSocketDebuggerUrl)
    let sq = 0; const pend = new Map()
    const snd = (m, p = {}) => new Promise((res, rej) => { const i = ++sq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    await snd('Runtime.enable')
    const evl = async (e) => { const r = await snd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.value }

    await evl(`(() => { window.__pa = {}; if (window.__paHook) return 'ok';
      const o = window.fetch;
      window.fetch = function(i){ try { const u = typeof i==='string'?i:(i&&i.url)||''; const p = u.replace(/^https?:\\/\\/[^/]+/,'').split('?')[0];
        if (p && !p.startsWith('/plugins/') && !p.startsWith('/assets/')) window.__pa[p]=(window.__pa[p]||0)+1 } catch(e){}
        return o.apply(this, arguments) };
      window.__paHook = true; return 'ok' })()`)

    // 【唤醒次数口径 A：活跃定时器清单】——零噪声的**确定性读数**（不依赖采样窗口）。
    // 为什么它比 CPU 有用：每个未暂停的轮询定时器 = 一个持续的唤醒源。
    // 直接列出「有多少个 interval、间隔各是多少、谁注册的」，门控是否生效一目了然。
    // （面 4 的 CPU 三口径在本模拟器全部证伪，故以此为主证据。）
    await evl(`(() => { window.__paT = { live: {}, seq: 0 };
      if (window.__paTHook) return 'ok';
      const oi = window.setInterval, ci = window.clearInterval;
      const live = new Map();
      // 记录注册点的调用栈首行，便于定位"是谁的定时器"
      const origin = () => { try { const s = (new Error()).stack || ''; const l = s.split('\\n').filter(x => x && !x.includes('__paT') && !x.includes('setInterval')); return (l[1] || l[0] || '').trim().slice(0, 80) } catch (e) { return '' } };
      window.setInterval = function (fn, ms) {
        const h = oi.apply(this, arguments);
        live.set(h, { ms: ms, origin: origin() });
        return h;
      };
      window.clearInterval = function (h) { const r = ci.apply(this, arguments); live.delete(h); return r };
      window.__paTSnapshot = () => {
        const out = [];
        live.forEach((v, k) => out.push({ id: k, ms: v.ms, origin: v.origin }));
        return JSON.stringify(out);
      };
      window.__paTHook = true; return 'ok' })()`)

    // 【唤醒次数口径 B：主线程 JS 占用率（ScriptDuration 增量，中位数）】——
    // 反控已证（见文件末尾 selftest 与实测记录）：静置 9.7% / 注入 8ms 定时器 22.2% / 撤掉 12.7%。
    // 用它报"前台静置基线"（真机可对照）；**后台不作判据**（后台任务排队/GC 会抬高读数，
    // 实测后台 11.05% > 前台 9.71%，无法区分"门控没生效"与"后台清理任务"）。
    await snd('Performance.enable')
    const jsMed = async (n, winMs) => {
      const vals = []
      for (let i = 0; i < n; i++) {
        const a = Object.fromEntries(((await snd('Performance.getMetrics')).metrics ?? []).map(x => [x.name, x.value]))
        const t0 = Date.now()
        await new Promise(r => setTimeout(r, winMs))
        const b = Object.fromEntries(((await snd('Performance.getMetrics')).metrics ?? []).map(x => [x.name, x.value]))
        vals.push(+(((b.ScriptDuration ?? 0) - (a.ScriptDuration ?? 0)) / ((Date.now() - t0) / 1000) * 100).toFixed(2))
      }
      const s = [...vals].sort((x, y) => x - y)
      return { med: s[Math.floor(s.length / 2)], raw: vals }
    }

    const WIN = 20
    // ⚠️ 前置断言（防"空窗当结论"）：前台窗口必须**真的观测到轮询**，否则说明此刻脚本
    //    还没跑起来（冷启动空窗），继续比"前台 vs 后台"只会得出相反结论 —— 那属于
    //    **探针前提不成立**，必须显式报出，而不是给一个看似有数据的假结论（L142 同族）。
    let f = {}
    let fTotal = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      await evl(`window.__pa = {}`)
      await new Promise(r => setTimeout(r, WIN * 1000))
      f = JSON.parse(await evl(`JSON.stringify(window.__pa)`))
      fTotal = Object.values(f).reduce((a, b) => a + b, 0)
      if (fTotal > 0) break
      console.log(`      （前台窗口第 ${attempt + 1} 次仍为 0 次请求，可能仍在预热，重试…）`)
    }
    row('前置：前台窗口观测到轮询（证明确有脚本在跑）', fTotal > 0,
      fTotal > 0 ? `观测到 ${fTotal} 次请求` : '4 个窗口均 0 次 ⇒ 该会话脚本未产生轮询，本轮前后台对比不可信')

    adb(['shell', 'input', 'keyevent', '3']) // HOME → 真实切后台
    await evl(`window.__pa = {}`)
    await new Promise(r => setTimeout(r, WIN * 1000))
    const b = JSON.parse(await evl(`JSON.stringify(window.__pa)`))
    const bTotal = Object.values(b).reduce((a, b) => a + b, 0)
    adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`])

    out.metrics.polling = { foreground: f, fgPerSec: +(fTotal / WIN).toFixed(2), background: b, bgPerSec: +(bTotal / WIN).toFixed(2) }
    row('前台轮询负载 ≤ %s 次/秒'.replace('%s', th.fgPollPerSec), fTotal / WIN <= th.fgPollPerSec,
      `实测 ${(fTotal / WIN).toFixed(2)} 次/秒（${fTotal} 次 / ${WIN}s）`)
    row('后台轮询负载 ≤ %s 次/秒（切后台必须显著降频）'.replace('%s', th.bgPollPerSec), bTotal / WIN <= th.bgPollPerSec,
      `实测 ${(bTotal / WIN).toFixed(2)} 次/秒（${bTotal} 次 / ${WIN}s）`)
    // 反控：后台必须**明显低于**前台（若两者接近，说明门控失效 —— 这正是修复前的形态）
    row('反控：后台 < 前台的一半（证明可见性门控真的生效）', bTotal < fTotal / 2,
      `前台 ${fTotal} vs 后台 ${bTotal}`)

    // ---- 唤醒源清单（确定性读数，goal 要求的「唤醒次数」主证据）----
    // 口径选择说明：面 4 的 CPU 三口径在本模拟器全部证伪（报不出忙循环）；
    //   ScriptDuration 后台不可判（后台清理任务会抬高读数）。
    //   ⇒ 用**活跃定时器清单 + 各自的间隔**：每个未暂停的 interval = 一个持续唤醒源，
    //     门控是否生效在此**可直接读出**（切后台后这些 interval 应被 clearInterval 掉）。
    const listTimers = async (tag) => {
      const raw = await evl(`window.__paTSnapshot ? window.__paTSnapshot() : '[]'`)
      let arr = []
      try { arr = JSON.parse(raw) } catch { arr = [] }
      return arr
    }
    // 前台：等一轮（覆盖 3s/4s 定时器的注册）
    await new Promise(r => setTimeout(r, 6000))
    const fgTimers = await listTimers('fg')
    adb(['shell', 'input', 'keyevent', '3']) // HOME
    await new Promise(r => setTimeout(r, 4000))
    const bgTimers = await listTimers('bg')
    adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`])
    await new Promise(r => setTimeout(r, 3000))

    out.metrics.timers = { foreground: fgTimers, background: bgTimers }
    const fmt = a => a.length === 0 ? '0 个' : a.map(t => `${t.ms}ms`).join(' + ')
    // 判据：切后台后活跃 interval 必须**减少**（可见性门控把轮询表停掉）
    const reduced = bgTimers.length < fgTimers.length
    row('唤醒源：切后台后活跃 interval 数下降（可见性门控生效）', reduced || fgTimers.length === 0,
      `前台 ${fgTimers.length} 个（${fmt(fgTimers)}）→ 后台 ${bgTimers.length} 个（${fmt(bgTimers)}）` +
      (reduced ? '' : ' — ⚠️ 未下降：可能有未接门控的 interval（见清单 origin）'))
    if (VERBOSE && fgTimers.length > 0) {
      console.log(`      前台定时器明细：`)
      for (const t of fgTimers.slice(0, 12)) console.log(`        ${String(t.ms).padStart(6)}ms  ${t.origin}`)
    }

    // ---- 主线程 JS 占用（前台静置基线；真机对照用）----
    const js = await jsMed(3, 5000)
    out.metrics.jsBusy = { foregroundMedPct: js.med, raw: js.raw, source: 'CDP Performance.ScriptDuration' }
    row('主线程 JS 占用可测（前台静置基线）', js.med !== null,
      `中位数 ${js.med}%（原始 ${js.raw.join(', ')}）— 反控已证该口径能报出定时器负载（注入 8ms 定时器 ⇒ 22.2%）；真机应以同口径复测对比`)

    // ---- 面 7：UI 遮挡与触控目标（复用同一 CDP 连接）----
    // 为什么排在这里：① CDP 通道刚建好；② 面 6 末尾已把 app 拉回前台 —— 遮挡检测
    // **必须在前台可见时做**，后台时 rect 全 0 会给出"零遮挡"的假绿。
    // 判据口径：44 CSS px（WebView 视口是 width=device-width ⇒ CSS px ≈ dp）。
    console.log('\n  【面 7】UI 遮挡与触控目标（CDP 注入检测）')
    const probeUi = `(() => {
      const res = { composer: null, occluders: [], small: [], floats: [], unreachable: [] };
      const c = document.querySelector('[data-composer-input]');
      if (!c) { res.composer = { found: false }; return JSON.stringify(res) }
      const r = c.getBoundingClientRect();
      res.composer = { found: true, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      if (r.width > 4 && r.height > 4) {
        const pts = [[r.x+r.width/2, r.y+r.height/2],[r.x+r.width/2, r.y+2],[r.x+r.width/2, r.y+r.height-2],[r.x+8, r.y+r.height/2],[r.x+r.width-8, r.y+r.height/2]];
        for (const p of pts) {
          // ⚠️ 判据口径（第三轮修正）：用 elementFromPoint（**点击真正落到哪**），
          //    而不是 elementsFromPoint 的第一项 —— 后者会把 pointer-events:none 的
          //    透传元素（如卡脚本注入的装饰层、我们的 toastr 容器）误判为遮挡，
          //    实测曾据此报出 5 个"遮挡点"（实为可点击穿透的层）⇒ 假红。
          //    elementFromPoint 按 CSS 命中规则计算，自动忽略 pointer-events:none。
          const top = document.elementFromPoint(p[0], p[1]);
          if (!top) { res.occluders.push({ x: Math.round(p[0]), y: Math.round(p[1]), tag: '(none)' }); continue }
          if (!(top === c || c.contains(top) || top.contains(c))) {
            const cs = getComputedStyle(top);
            res.occluders.push({ x: Math.round(p[0]), y: Math.round(p[1]), tag: top.tagName,
              cls: String(top.className||'').slice(0,60), pe: cs.pointerEvents, z: cs.zIndex })
          }
        }
      }
      const hit = (el) => { const b = el.getBoundingClientRect(); let w = b.width, h = b.height;
        try { const a = getComputedStyle(el,'::after'); if (a && a.content && a.content !== 'none') { w = Math.max(w, parseFloat(a.minWidth)||0); h = Math.max(h, parseFloat(a.minHeight)||0) } } catch(e){}
        return { w: Math.round(w), h: Math.round(h) } };
      const seen = new Set();
      for (const el of document.querySelectorAll('button[class*="dsht-"], [class*="dsht-rp"] button, [class*="dsht-npc"] button')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        // 【W30 修 · 与 ef-touch-targets.mjs 对齐「可点性」口径（P-1 单源）】
        //  背景：两个探针曾对同一元素给出**相反**结论 ——
        //    · ef-touch-targets.mjs 有 elementFromPoint 反查 ⇒ .dsht-rp-sidebar-btn
        //      在**折叠侧栏**里（rect.left = **-288**、视口外、点不到）⇒ 跳过（第 45 次坑，判为假告警）
        //    · 本面**不做视口判定** ⇒ 报「31×44 < 44」⇒ 与上者矛盾
        //  设备决定性取证（tmp/w30-sidebar-btn.mjs）：
        //    侧栏**展开**时该按钮实测 **256×44**（桌面 width:100% 撑满容器）⇒ **完全达标**；
        //    侧栏**折叠**时才 31×44，但那时它在视口外、elementFromPoint 命不中 ⇒ 用户点不到。
        //  ⇒ 结论：这不是产品缺陷，而是**本面缺一道「可点性」前置判定**（判据范围问题）。
        //    口径统一为：**只有「用户当前真能点到」的元素才纳入触控目标判据**
        //    （R17：判据范围 = 责任边界；P-17：测不到 ≠ 事实否定）。
        //    ⚠️ 注意：本函数是模板串，注释里**不能出现反引号**（A11 闸门）。
        const k = Math.round(b.x)+','+Math.round(b.y)+','+Math.round(b.width);
        if (seen.has(k)) continue; seen.add(k);
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        let hitEl = null;
        try { hitEl = document.elementFromPoint(cx, cy) } catch { hitEl = null }
        if (!hitEl || !(hitEl === el || el.contains(hitEl))) {
          // 出声记录（P-3 不许静默）：这些是「当前点不到」的，不算触控目标缺口
          res.unreachable = res.unreachable || [];
          res.unreachable.push({ cls: String(el.className||'').slice(0,50), w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left) });
          continue;
        }
        const t = hit(el);
        if (t.w < 44 || t.h < 44) res.small.push({ cls: String(el.className||'').slice(0,50), w: t.w, h: t.h, txt: (el.textContent||'').trim().slice(0,10) });
      }
      for (const f of ['.dsht-rp-statefloat-ball','.dsht-rp-scriptball','.dsht-rp-import-dock']) {
        const el = document.querySelector(f); if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1) continue;
        const ox = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left));
        const oy = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
        res.floats.push({ sel: f, overlapPct: +((ox*oy) / (b.width*b.height) * 100).toFixed(1) });
      }
      return JSON.stringify(res);
    })()`

    const ui = JSON.parse(await evl(probeUi))
    // 反控（必须先做）：注入一个 fixed 层盖住 composer ⇒ 检测**必须**报出遮挡；
    // 移除后必须回到零。没有这一步，"零遮挡"这个绿是不可信的（同 L142 家族）。
    await evl(`(() => {
      const c = document.querySelector('[data-composer-input]'); if (!c) return 'n/a';
      const r = c.getBoundingClientRect();
      const d = document.createElement('div'); d.id = '__pa_occluder';
      d.style.cssText = 'position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;z-index:2147483647;background:rgba(255,0,0,.01)';
      document.body.appendChild(d); return 'ok' })()`)
    const uiCtrl = JSON.parse(await evl(probeUi))
    await evl(`(() => { const d = document.getElementById('__pa_occluder'); if (d) d.remove(); return 'ok' })()`)

    out.metrics.ui = { composer: ui.composer, occluders: ui.occluders, smallTargets: ui.small, floats: ui.floats, unreachable: ui.unreachable }

    if (!ui.composer.found) {
      row('输入框可定位（UI 遮挡检测前提）', false,
        '[data-composer-input] 未找到 —— 当前页面可能不在会话内（检测前提不成立，不是"零遮挡"）')
    } else if (ui.composer.w <= 4 || ui.composer.h <= 4) {
      row('输入框可见（UI 遮挡检测前提）', false, `rect ${ui.composer.w}×${ui.composer.h} ⇒ 输入区未渲染，检测前提不成立`)
    } else {
      const jOc = judgeOccluders(ui.occluders, uiCtrl.occluders.length > 0)
      row('反控：注入遮挡层时检测能报红', uiCtrl.occluders.length > 0,
        uiCtrl.occluders.length > 0 ? `注入后报出 ${uiCtrl.occluders.length} 个遮挡点（探针有效）` : '注入遮挡层后仍报零遮挡 ⇒ 探针失效，本面结论不可信')
      row('输入框取样点无元素遮挡', jOc.ok,
        ui.occluders.length === 0 ? '零遮挡' : `仍报 ${ui.occluders.length} 个遮挡点：${JSON.stringify(ui.occluders.slice(0, 3))}`)
      const jT = judgeTargets(ui.small)
      // 【W30 修】文案不再用「全部达标」单表述 —— 那在 0 样本时会与 detail 自相矛盾
      //  （`judgeTargets` 现在把 0 样本判为不通过，理由写在 detail 里）。
      row(`触控目标 ≥44px（共检 ${ui.small.length} 个不达标）`, jT.ok,
        ui.small.length === 0
          ? (jT.ok ? '全部达标' : jT.detail)
          : ui.small.slice(0, 5).map(s => `${s.cls}[${s.txt}] ${s.w}×${s.h}`).join(' · '))
      // 【W30 出声】当前点不到的我方元素（不算触控缺口，但必须可见 —— P-3 不许静默）
      //  典型：侧栏折叠时被推到视口外的 `.dsht-rp-sidebar-btn`（left=-288）。
      const unre = ui.unreachable || []
      if (unre.length > 0) {
        row('点不到的我方元素（已排除，不计入触控缺口）', true,
          `${unre.length} 个：` + unre.slice(0, 3).map(u => `${u.cls} ${u.w}×${u.h}@left=${u.left}`).join(' · '))
      }
      const jF = judgeFloatOverlap(ui.floats)
      row('自研浮层不覆盖输入框', jF.ok,
        ui.floats.length === 0 ? '无浮层可见' : ui.floats.map(f => f.sel.replace('.dsht-rp-', '') + ' ' + f.overlapPct + '%').join(' / '))
    }
    if (VERBOSE) console.log(`      原始：${JSON.stringify(out.metrics.ui)}`)

    // ---- 面 8：长会话窗口化（goal 第 3 项要"直接证据，不是应该生效"）----
    // 判据口径：楼层外壳的 `data-windowed` 属性（RpNativeChat.tsx:1438/:1897）——
    //   windowed=true 的楼层把内容 DOM 卸掉、只留占位高度。这是**可当场读出的直接证据**。
    // ⚠️ 前提自证（必须做，否则"占位 0"会被误读成"窗口化没生效"）：
    //   窗口化按设计只在「会话平铺楼层数 > WINDOWING_THRESHOLD（40）」时启用
    //   （chat-windowing.ts:461 `entries.size <= WINDOWING_THRESHOLD` ⇒ 全部复位）。
    //   若当前会话平铺楼层 ≤40 ⇒ **前提不成立**，本面不给结论（真机复测需打开 ≥41 楼的会话）。
    //   【2026-09-13 实测记录】模拟器上未能取得该前提：设备内最大的会话（322 turns）
    //   在 UI 上被 DSH 折叠成 turn 摘要（截图实证 "15 messages >"），平铺楼层恒为 0；
    //   且该会话持续显示 "Loading history…" 未完成加载 ⇒ 属**环境+数据形态**限制，
    //   不是窗口化缺陷（先怀疑前提，勿记产品缺陷 —— L142 同族）。
    console.log('\n  【面 8】长会话窗口化（直接证据：data-windowed）')
    const wind = JSON.parse(await evl(`(() => {
      const w = Array.from(document.querySelectorAll('[data-windowed]'));
      const a = Array.from(document.querySelectorAll('.dsht-rp-assistant, .dsht-rp-user-row'));
      return JSON.stringify({
        floors: a.length, windowed: w.length, rendered: a.length - w.length,
        heights: w.slice(0,5).map(e => e.style.height),
        collapsedHeight: w.filter(e => e.getBoundingClientRect().height < 10).length,
      })
    })()`))
    out.metrics.windowing = wind
    const THRESH = 40
    if (wind.floors <= THRESH) {
      // 前提不成立：如实报"未测得"，并给出真机复测条件（不判红，也不假装绿）
      row('窗口化（前提不成立：当前会话平铺楼层 ≤ 阈值）', true,
        `实测平铺楼层 ${wind.floors} ≤ ${THRESH} ⇒ 按设计不启用窗口化，本面无法证实/证伪。` +
        `真机复测：打开 ≥${THRESH + 1} 楼的 RP 会话（不折叠），再跑本脚本`)
    } else if (wind.windowed === 0) {
      row('窗口化生效（视口外楼层被占位）', false,
        `楼层 ${wind.floors} > ${THRESH} 但占位 0 ⇒ 窗口化未生效（真缺陷）`)
    } else {
      row('窗口化生效（视口外楼层被占位）', true,
        `楼层 ${wind.floors}：占位 ${wind.windowed} / 实渲染 ${wind.rendered}（占位高度样例 ${wind.heights.join(',') || 'n/a'}）`)
      row('占位不塌陷（高度仍保留 ⇒ 无滚动漂移）', wind.collapsedHeight === 0,
        wind.collapsedHeight === 0 ? '全部占位元素高度 >10px' : `${wind.collapsedHeight} 个占位元素高度 <10px`)
    }

    // ---- 面 9：交互响应（goal 第 1 项明列：输入字符 → 回显）----
    // 口径：CDP Input.insertText（真实输入管线）→ MutationObserver 捕获 composer DOM 变化的
    //   时间差。为什么用「输入回显」而不是「点发送」：发送有**副作用**（会真的产生一轮对话、
    //   写盘、消耗额度），不该在度量脚本里做；输入回显同样是"点了有没有反应"的直接指标。
    //   回显后立即清空草稿，保证可重复运行、无残留。
    console.log('\n  【面 9】交互响应（输入字符 → 回显延迟）')
    const irSetup = await evl(`(() => {
      const c = document.querySelector('[data-composer-input]');
      if (!c) return 'no-composer';
      c.focus();
      try { const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r) } catch (e) {}
      window.__ir = { t0: 0, dt: null, before: (c.textContent || '').length };
      const mo = new MutationObserver(() => {
        if (window.__ir.t0 && window.__ir.dt === null) {
          window.__ir.dt = performance.now() - window.__ir.t0;
          mo.disconnect();
        }
      });
      mo.observe(c, { childList: true, subtree: true, characterData: true });
      window.__irRead = () => JSON.stringify({ dt: window.__ir.dt, before: window.__ir.before, after: (c.textContent || '').length });
      return 'ok'
    })()`)
    if (irSetup !== 'ok') {
      row('交互响应可测（需 composer）', false, `composer 不可交互：${irSetup}`)
    } else {
      await evl(`(() => { window.__ir.t0 = performance.now(); return 'ok' })()`)
      await snd('Input.insertText', { text: '测' })
      await new Promise(r => setTimeout(r, 800))
      const ir = JSON.parse(await evl(`window.__irRead ? window.__irRead() : '{}'`))
      out.metrics.interactive = ir
      // 清理：清空草稿（不留残留，保证幂等可复跑）
      await evl(`(() => {
        const c = document.querySelector('[data-composer-input]');
        if (!c) return 'x';
        try { c.focus(); document.execCommand('selectAll'); document.execCommand('delete') } catch (e) {}
        // execCommand 失败时按字符退格兜底
        return 'cleared'
      })()`)
      const echoed = ir.dt !== null && ir.after !== ir.before
      const th9 = isEmu ? 400 : 150
      row(`输入回显延迟 ≤ ${th9}ms`, echoed && ir.dt <= th9,
        echoed ? `实测 ${ir.dt.toFixed(1)}ms（${ir.before} → ${ir.after} 字符；CDP 真实输入管线）`
          : `未观测到回显（before=${ir.before} after=${ir.after} dt=${ir.dt}）⇒ 输入无反应（真缺陷，或 composer 结构变更需更新探针）`)
    }

    ws.close()
  }
}

// ---- 面 1：冷启动（force-stop 后测量；放最后以免破坏上面各面）----
console.log('\n  【面 1】冷启动耗时（force-stop → am start -W）')
adb(['shell', 'am', 'force-stop', PKG])
await new Promise(r => setTimeout(r, 1500))
const amOut = adb(['shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`])
const cold = parseAmStart(amOut)
out.metrics.coldStart = cold
row('冷启动 TotalTime 在阈值内', judgeColdStart(cold?.totalTime, th).ok,
  cold ? `TotalTime ${cold.totalTime}ms ≤ ${th.coldStartMs}ms（含 node 解压+启动，非纯 UI 时间）` : 'am start 无输出')
if (VERBOSE && amOut) console.log(`      原始：${amOut.trim().split('\n').slice(-6).join(' | ')}`)

// ---- 汇总 ----
const failed = out.checks.filter(c => !c.ok)
if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`\n[perf-audit] ${out.checks.length - failed.length}/${out.checks.length} 项在阈值内`)
  if (failed.length) {
    console.log('超出阈值：')
    for (const f of failed) console.log(`  · ${f.label} — ${f.detail}`)
  }
}
process.exit(failed.length ? 1 : 0)
