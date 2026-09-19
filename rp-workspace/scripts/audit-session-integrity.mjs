#!/usr/bin/env node
/**
 * audit-session-integrity.mjs —— 会话文件**结构自洽性**审计（官方 surface 语义）
 * ============================================================================
 * ## 存在的理由（P-21 的常驻护栏）
 *
 * 2026-09-14 发现：`ef-journey-all.mjs` 的 J12 在**应用存活时** `cp` 还原会话文件，
 * 而产品有「live 会话 append 后立即耐久 barrier」（`flushLiveSession` → `/rp/flush-all`）
 * ⇒ 内存日志随后把**按旅程后 seq 计算**的 `surfaceOp.replace` 写进**已被倒退的文件**
 * ⇒ `startSeq` 指向不存在的 surface 成员 ⇒ 官方 loader 判
 *   `invalid seed event at index N: surface replace: start seq M not found in surface`
 * ⇒ **整会话打不开**（UI 渲染 0 楼层）。而报告里 J12 仍显示 PASS —— 假绿掩盖数据损坏。
 *
 * 该缺陷已修（还原改为「停应用后统一执行」+ fail-closed）。但**判据必须留在仓库**：
 * 只要有人（或未来的我）再写出「写 live 会话文件」的夹具，本脚本就会当场照出来。
 * ⇒ 这就是 P-21 的机器化形态。
 *
 * ## 官方语义（判据的权威依据）
 * 官方以 `surface`（可投影面）维护会话；每个事件带 `surfaceOp`：
 *   · `'append'`            ⇒ 该事件**加入** surface
 *   · `{op:'replace', startSeq, endSeq}` ⇒ 该事件加入 surface，且**替换掉** [startSeq,endSeq]
 * 校验规则（`dsh-session/lib/index.js` 的 `surfaceManager.validateNext`）：
 *   `replace` 的 **startSeq 必须是 surface 的现有成员**，否则整会话非法。
 *
 * ## 判据
 * 对每个会话目录的**当前世代**文件（官方 `pickCurrentSessionFilename`：取最高版本号
 * `session.v<N>.jsonl`，无则回落 `session.jsonl`）：
 *   ① 每个 `surfaceOp.replace` 的 `startSeq` 都必须是 surface 成员；
 *   ② seq 不得重复（同一 seq 出现两次 ⇒ 投影会错）；
 *   ③ 每行必须是合法 JSON（坏行 ⇒ 解析侧静默跳过的风险）。
 *   ④【第三十二轮 W32 新增】**影子价格邻接契约**：紧邻 `surfaceOp.replace` 的计量事件
 *      （`compaction/prune` / `compaction/summary`）的 claim `[start,end]` 必须**恰好等于**
 *      该 replace 的 `[startSeq,endSeq]`。
 *      ★「紧邻」的精确含义【第三十六轮 W36 修正】= **中间不得夹任何非计量事件**。
 *      官方 claim 的生命周期是「任何非计量事件都让它过期」（`surface-projection.js:22-27`
 *      注释 + `:49-50` / `:54-55` 两条清除分支）：`!isSurfaceEvent(event)` 清、`op ===
 *      'append'` 清。第一版判据只复刻了 append 那条 ⇒ 遇到 `step/start`、`turn/end`、
 *      `agent/inbox/spliced` 等非 surface 事件时**claim 本该已过期却被当成仍有效**
 *      ⇒ 后续 replace 被误报（W36 实测 st-n0gnfp 假红 1 处，官方 fold 全量跑该文件**不抛错**）。
 *      该假红同时污染了 M7 的 J16（46 PASS / 1 FAIL 里的唯一 FAIL）。
 *
 * ## 为什么必须有判据 ④（实例：W32 抓到的「会话整份打不开」）
 *
 * 官方对 `compaction/prune` 有**两条**契约，须**同时**成立：
 *   · ①（`dsh-compaction/lib/invariant.js:58`）`shadowedRange` == `shadowedSeqs` 首尾
 *   · ④（`dsh-token-meter/lib/types/surface-projection.js:62`）claim == 紧邻 replace 的区间
 * 而**判据 ①②③ 只覆盖「surface 结构」这一面** ⇒ 满足 ① 但违反 ④ 的会话**全部漏过**。
 *
 * 实测后果（设备 23 个会话里 2 个）：宿主投影层**抛错** ⇒ UI 红字
 *   `Failed to load history: failed to project session "…": token surface: replace at seq N
 *    over range A-B has no adjacent shadow price (armed claim covers X-Y)`
 * ⇒ **整份会话打不开**（不是「少一段」，是什么都看不到）。
 *
 * ★ 为什么这条漏了 6 轮都没人发现（**P-46**）：M7 把这种卡的 `floors=0` 记成
 *   「该会话无可见楼层（**可能已被回退到空**）」的 SKIP —— 而 `floors=0` 有**两种相反含义**
 *   （① 确实没内容 = 正常 ② **整份打不开** = 硬缺陷），判据只用了一个读数。
 *   ⇒ 本判据就是给那个读数**补的第二个观测面**（且它在**文件层**，比 UI 层更早、更便宜）。
 *
 * ## 退出码
 *   0 = 全部自洽    1 = 检出违规（fail-closed）    2 = 用法/selftest 失败    3 = 读不到（fail-closed）
 *
 * 用法：
 *   node scripts/audit-session-integrity.mjs --selftest          # 正/负/零控自检（不碰设备）
 *   node scripts/audit-session-integrity.mjs --sid <sid> [...]   # 只查指定会话
 *   node scripts/audit-session-integrity.mjs --all               # 查设备上全部会话
 *   node scripts/audit-session-integrity.mjs --quiet             # 只在有问题时输出
 */
import process from 'node:process'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const QUIET = argv.includes('--quiet')
const SELFTEST = argv.includes('--selftest')
const ALL = argv.includes('--all')
const PKG = 'com.dshtavern.app'
const SIDS = (() => {
  const out = []
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--sid' && argv[i + 1]) out.push(argv[i + 1])
  return out
})()

/**
 * adb 解析（与 ef-journey-all 同款坑：adb 常常不在 PATH，必须显式探测候选路径）。
 * 探不到 ⇒ **fail-closed**（返回 null，调用方报错退出，不静默当作「无问题」）。
 */
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

// ---------------------------------------------------------------------------
// 纯函数部分（可脱离设备单测 —— selftest 只跑这段）
// ---------------------------------------------------------------------------

/**
 * 官方 `dsh-session/lib/types/surface.js` 的 `SURFACE_EVENT_TYPES` 白名单（逐条同源）。
 * 判据 ④ 需要它来复刻官方 `isSurfaceEvent`：「不在白名单 **或** 无 `surfaceOp`」
 * ⇒ 官方里层直接 `return { deltaTokens: 0, claim: undefined }` ⇒ **claim 作废**。
 */
const SURFACE_EVENT_TYPES = new Set([
  'system/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/**
 * 判定一组**事件文本行**的结构自洽性（纯函数，selftest 的判据核心）。
 *
 * 【为什么是**流式**校验（单遍）而不是「先收集 surface 再比对」】
 * 官方是**逐个事件 append 时**校验（`dsh-session/lib/index.js` 的
 * `surfaceManager.validateNext`，在 `Session` 构造循环里对每个 seed 事件调用）
 * ⇒ 语义是「处理第 i 个事件时，startSeq 必须**已经**是 surface 成员」。
 * 两遍扫描会把「前向引用」（replace 指向**后面才出现**的 seq）误判为合法——
 * 那是**另一个 bug 类别**（selftest 的「边界」条正是为照出这个差异而写）。
 *
 * @param lines 事件行（含 header 行；空行会被忽略）
 * @returns {{ violations: string[], stats: { events:number, surface:number, replaces:number, badLines:number, dupSeq:number[] } }}
 */
export function checkSessionLines(lines) {
  const violations = []
  let badLines = 0
  let events = 0
  let replaces = 0
  let claimsChecked = 0
  const surface = new Set()
  const seen = new Map()
  // 判据 ④ 的状态：上一条**计量事件**（compaction/prune / compaction/summary）挂起的 claim。
  // 语义与官方 foldSurfaceProjection 同构：计量事件**武装** claim，其它事件**清除**它，
  // 而 surface `replace` **消费**它 —— 若 claim 存在但与本次 replace 的区间不符 ⇒ 抛错。
  let armed = null
  for (let i = 0; i < lines.length; i += 1) {
    const t = String(lines[i]).trim()
    if (t === '') continue
    let e = null
    try { e = JSON.parse(t) } catch {
      badLines += 1
      violations.push(`第 ${i + 1} 行不是合法 JSON（解析侧可能静默跳过 ⇒ 投影缺事件）`)
      continue
    }
    if (e === null || typeof e !== 'object') continue
    events += 1
    if (typeof e.seq === 'number') seen.set(e.seq, (seen.get(e.seq) ?? 0) + 1)
    // ---- 判据 ④：计量事件武装 claim（在 surface 校验之前判断，因为它不是 surface 事件）----
    if (e.type === 'compaction/prune' || e.type === 'compaction/summary') {
      const r = e.data !== null && typeof e.data === 'object' ? e.data.shadowedRange : undefined
      armed = (r !== undefined && typeof r.start === 'number' && typeof r.end === 'number')
        ? { start: r.start, end: r.end, seq: e.seq }
        : null
      continue
    }
    // ---- 判据 ④：**非 surface 事件同样清除 claim**（官方 surface-projection.js:49-50）----
    // 【第三十六轮 W36 修正】官方 `isSurfaceEvent(e)` = `e.type ∈ SURFACE_EVENT_TYPES`
    // **且** `surfaceOp !== undefined`；不满足 ⇒ 里层 `return { deltaTokens: 0, claim: undefined }`
    // ⇒ **claim 立即作废**，后继 replace 走 `:60-61` 的「无 claim ⇒ 零增量、不抛错」路径。
    // 第一版判据只复刻了 `op === 'append'` 那条清除分支（下文），漏了这条 ⇒
    // `step/start` / `step/end` / `turn/end` / `request/header` / `agent/inbox/spliced`
    // 等事件之后 claim 被当成仍有效 ⇒ 把本该走零增量路径的 replace 误报为违约（P-45 语义漂移）。
    //
    // ★【P-47 归因分层（W36 续 · 同轮自查抓到）】**本分支只负责「清 claim」，不负责元数据合法性**。
    //   官方 `surfaceOpOf`（`dsh-session/lib/types/surface.js:176-203`）另有**两条**抛错分支，
    //   属**元数据层**、**不在判据 ④ 职责内**：
    //     · `!isSurfaceEligibleType(type)` 且 `surfaceOp !== undefined` ⇒ 抛错
    //     · `isSurfaceEligibleType(type)` 且 `surfaceOp === undefined` ⇒ 抛错
    //   （例外：type 不在 KNOWN 清单且 `ignorable === true` ⇒ 放行。）
    //   若在此处直接 `continue` 掉**非白名单**事件，那两条元数据缺陷就会被**静默跳过**
    //   ⇒ 判据 ④ **越界**吞掉了本不属于它的结论（P-47 纪律②）。⇒ 本分支**只清 claim 并继续流式校验**
    //   （不 `continue`），让事件照常走下面的 replace 校验路径。
    //   【P-37 量后果（W36 续）】设备**全部 30 个会话文件 / 15784 个事件**实测两条元数据盲区
    //   **均 0 命中** ⇒ **盲区存在但当前无后果** ⇒ 不扩大本轮范围，只登记（见方法论 §6.38 ⑥）。
    if (!SURFACE_EVENT_TYPES.has(e.type) || e.surfaceOp === undefined) armed = null
    // ---- 流式校验：与官方 validateNext 同语义 ----
    const op = e.surfaceOp
    // 非白名单 type 没有 surfaceOp（或不该有）⇒ 不进入 surface 路径
    if (op === undefined) continue
    if (op === 'append') {
      if (typeof e.seq === 'number') surface.add(e.seq)
      armed = null // 非 replace 事件清除 claim（与官方「任何其它事件都让它过期」一致）
      continue
    }
    if (op !== null && typeof op === 'object' && op.op === 'replace') {
      replaces += 1
      // 【判据自身的坑（P-17/P-18）· 第三十次】字段名**按世代不同**：
      //   · v0 冻结世代（`session.jsonl`）实测形态 = `{op, start, end}`
      //   · 当前世代（`session.vN.jsonl`）= `{op, startSeq, endSeq}`
      // 第一版只认新名 ⇒ `--all` 在 99 个会话上误报 **338 处**「缺少 startSeq」，
      // 而分布特征（**全部落在 `session.jsonl`**、形态高度一致）恰恰是「判据自己不认旧名」
      // 的典型信号 —— 若真是大面积损坏，不可能只坏旧世代且形态完全一致。
      // ⇒ 修法：两种命名都认（取值处也统一）。
      const s = typeof op.startSeq === 'number' ? op.startSeq : (typeof op.start === 'number' ? op.start : undefined)
      const en = typeof op.endSeq === 'number' ? op.endSeq : (typeof op.end === 'number' ? op.end : undefined)
      if (s === undefined) {
        violations.push(`seq ${e.seq} 的 replace 既无 startSeq 也无 start（未知世代命名）`)
      } else if (!surface.has(s)) {
        // 此刻 surface 的成员 = 「在这条事件**之前**已入面」的那些
        violations.push(`seq ${e.seq} 的 replace 指向 start=${s}，但它**此刻不是 surface 成员**（官方 loader 会判 corrupt）`)
      }
      // ---- 判据 ④：claim 与本次 replace 的区间必须一致 ----
      if (armed !== null && en !== undefined) {
        claimsChecked += 1
        if (armed.start !== s || armed.end !== en) {
          violations.push(
            `seq ${e.seq} 的 replace 区间 [${s},${en}] 与其紧邻计量事件（seq ${armed.seq}）武装的 claim `
            + `[${armed.start},${armed.end}] **不一致** ⇒ 官方投影层抛错 `
            + `「has no adjacent shadow price」⇒ **该会话整份打不开**（用户只能看到红字）`
          )
        }
      }
      armed = null
      if (typeof e.seq === 'number') surface.add(e.seq)
    }
  }
  const dupSeq = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  for (const d of dupSeq) violations.push(`seq ${d} 重复出现 ⇒ 投影会取错事件`)
  return { violations, stats: { events, surface: surface.size, replaces, badLines, dupSeq, claimsChecked } }
}

/** 官方 `pickCurrentSessionFilename` 同义：取最高版本号 session.v<N>.jsonl，无则 session.jsonl */
export function pickCurrentSessionFilename(entries) {
  let best = null, bestV = -1
  for (const raw of entries) {
    const n = String(raw).trim()
    const m = /^session\.v(\d+)\.jsonl$/.exec(n)
    if (m === null) continue
    const v = Number(m[1])
    if (v > bestV) { bestV = v; best = n }
  }
  return best ?? 'session.jsonl'
}

// ---------------------------------------------------------------------------
// selftest（正控 / 负控 / 零控）——「判据自己可不可信」比判据结果更重要（P-19）
// ---------------------------------------------------------------------------
if (SELFTEST) {
  const results = []
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '[ok]' : '[FAIL]'} ${name}${detail ? `：${detail}` : ''}`) }

  // 正控 1：完全自洽的会话 ⇒ 0 违规
  const good = [
    JSON.stringify({ type: 'session', seq: 0 }),
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    JSON.stringify({ type: 'turn/end', seq: 3 }),
    JSON.stringify({ type: 'user/message', seq: 4, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
  ]
  const r1 = checkSessionLines(good)
  t('正控1：自洽语料 0 违规', r1.violations.length === 0, `violations=${r1.violations.length} surface=${r1.stats.surface} replaces=${r1.stats.replaces}`)

  // 负控 1：replace 指向非 surface 成员（正是本次真实缺陷的形态）⇒ 必须检出
  const dangling = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'turn/end', seq: 2 }),
    JSON.stringify({ type: 'user/message', seq: 3, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
  ]
  const r2 = checkSessionLines(dangling)
  t('负控1：悬空 replace 必须被检出', r2.violations.length === 1 && /start=2/.test(r2.violations[0]), r2.violations[0] ?? '(未检出)')

  // 负控 2：坏行（半截 JSON —— 「进程被杀在写盘窗口」的真实形态）⇒ 必须检出
  const truncated = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    '{"type":"assistant/message","seq":2,"data":{"content":[{"type":"te',
  ]
  const r3 = checkSessionLines(truncated)
  t('负控2：截断行必须被检出', r3.violations.some(v => /不是合法 JSON/.test(v)) && r3.stats.badLines === 1, `badLines=${r3.stats.badLines}`)

  // 负控 3：重复 seq ⇒ 必须检出
  const dup = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 1, surfaceOp: 'append' }),
  ]
  const r4 = checkSessionLines(dup)
  t('负控3：重复 seq 必须被检出', r4.stats.dupSeq.length === 1, `dupSeq=${JSON.stringify(r4.stats.dupSeq)}`)

  // 零控：空输入 ⇒ 0 违规且不崩（不误报）
  const r5 = checkSessionLines([])
  t('零控：空输入 0 违规不误报', r5.violations.length === 0 && r5.stats.events === 0, '')

  // 边界：replace 指向自身之后的 seq（合法：后来的 replace 可以用更早的成员；
  //        这里验「指向尚未 append 的 seq」也要报 —— 顺序敏感）
  const forward = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: { op: 'replace', startSeq: 5, endSeq: 5 } }),
    JSON.stringify({ type: 'user/message', seq: 5, surfaceOp: 'append' }),
  ]
  const r6 = checkSessionLines(forward)
  t('边界：前向引用（startSeq 尚未入面）必须被检出', r6.violations.length === 1, r6.violations[0] ?? '(未检出)')

  // pickCurrentSessionFilename 的口径（P-18：与产品读侧同规则）
  t('pickCurrentSessionFilename：取最高版本', pickCurrentSessionFilename(['session.jsonl', 'session.v3.jsonl', 'session.v2.jsonl']) === 'session.v3.jsonl', '')
  t('pickCurrentSessionFilename：无版本则回落 v0', pickCurrentSessionFilename(['session.jsonl', 'session.lock']) === 'session.jsonl', '')

  // 【正控 2】v0 冻结世代的**旧字段名**（`{op,start,end}`）必须被识别为合法 —— 防再现「只认新名」误报
  const v0good = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    JSON.stringify({ type: 'user/message', seq: 3, surfaceOp: { op: 'replace', start: 2, end: 2 } }),
  ]
  const r7 = checkSessionLines(v0good)
  t('正控2（v0 旧字段名 {op,start,end}）：必须 0 违规（防「只认新名」误报）', r7.violations.length === 0, r7.violations[0] ?? '')

  // 【负控 4】v0 旧字段名下的**悬空**引用仍必须被检出（不能因为兼容旧名就放过真损坏）
  const v0bad = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'turn/end', seq: 2 }),
    JSON.stringify({ type: 'user/message', seq: 3, surfaceOp: { op: 'replace', start: 2, end: 2 } }),
  ]
  const r8 = checkSessionLines(v0bad)
  t('负控4（v0 旧字段名 + 悬空）必须被检出', r8.violations.length === 1, r8.violations[0] ?? '(未检出)')

  // 【负控 5】两种命名都没有 ⇒ 必须报「未知世代命名」（fail-closed，不静默放过）
  const unknownName = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'user/message', seq: 2, surfaceOp: { op: 'replace', from: 1, to: 1 } }),
  ]
  const r9 = checkSessionLines(unknownName)
  t('负控5（未知世代命名）必须被检出', r9.violations.length === 1 && /既无 startSeq 也无 start/.test(r9.violations[0]), r9.violations[0] ?? '(未检出)')

  // ---- 判据 ④（W32 新增）：影子价格邻接契约 ----

  // 正控 3：claim 与紧邻 replace 区间**一致** ⇒ 0 违规
  const claimOk = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    JSON.stringify({ type: 'compaction/prune', seq: 3, data: { shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], shadowedTokenCount: 9 } }),
    JSON.stringify({ type: 'user/message', seq: 4, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } }),
  ]
  const c1 = checkSessionLines(claimOk)
  t('正控3（claim == 紧邻 replace 区间）必须 0 违规', c1.violations.length === 0 && c1.stats.claimsChecked === 1,
    `violations=${c1.violations.length} claimsChecked=${c1.stats.claimsChecked}`)

  // 负控 6：claim 与 replace 区间**不一致**（W32 设备真实形态）⇒ 必须检出
  const claimBad = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    // claim 写的是「自己的端点」[4,2]（倒序），而紧随的 replace 区间是 [1,2]
    JSON.stringify({ type: 'compaction/prune', seq: 3, data: { shadowedRange: { start: 2, end: 1 }, shadowedSeqs: [2, 1], shadowedTokenCount: 9 } }),
    JSON.stringify({ type: 'user/message', seq: 4, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } }),
  ]
  const c2 = checkSessionLines(claimBad)
  t('负控6（claim ≠ 紧邻 replace 区间）必须被检出',
    c2.violations.length === 1 && /has no adjacent shadow price/.test(c2.violations[0]), c2.violations[0] ?? '(未检出)')

  // 杠杆（P-20）：只在「claim 与区间不一致」时报 —— 把同一份语料的 replace 区间改成与 claim 一致 ⇒ 必须转绿。
  // 若判据无杠杆（恒报红或恒不报），这一对正负控不可能一红一绿。
  const claimBadFixed = claimBad.map((l, i) => (i === 3
    ? JSON.stringify({ type: 'user/message', seq: 4, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 1 } })
    : l))
  const c3 = checkSessionLines(claimBadFixed)
  t('杠杆（只改 replace 区间使其与 claim 一致 ⇒ 必须转绿）',
    c3.violations.filter(v => /has no adjacent shadow price/.test(v)).length === 0, `violations=${c3.violations.length}`)

  // 负控 7：计量事件与 replace **不相邻**（中间夹了一条 append）⇒ claim 已过期，**不该**按 ④ 报红
  // （官方语义：任何其它事件都让 claim 过期；此时 replace 走「无 claim ⇒ 零增量」路径，不抛错）
  const notAdjacent = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'compaction/prune', seq: 2, data: { shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], shadowedTokenCount: 9 } }),
    JSON.stringify({ type: 'assistant/message', seq: 3, surfaceOp: 'append' }),
    JSON.stringify({ type: 'user/message', seq: 4, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 } }),
  ]
  const c4 = checkSessionLines(notAdjacent)
  t('负控7（claim 已过期：中间夹了别的 append）不得按 ④ 报红',
    c4.violations.filter(v => /has no adjacent shadow price/.test(v)).length === 0, `violations=${c4.violations.length}`)

  // 负控 8【第三十六轮 W36 新增】：中间夹的是**非 surface 事件**（`step/start`），
  // claim 同样已过期（官方 surface-projection.js:49-50 的 `!isSurfaceEvent` 分支）⇒ 不得报红。
  // ★ 这是 W36 设备实测（st-n0gnfp seq 7397→7398(step/start)→7399）的**最小复现**：
  //   修前判据只清 append ⇒ 把这条误报为违约，而官方 fold 跑真实文件**不抛错**（P-45 语义漂移）。
  const nonSurfaceBetween = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    JSON.stringify({ type: 'compaction/prune', seq: 3, data: { shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], shadowedTokenCount: 9 } }),
    JSON.stringify({ type: 'step/start', seq: 4 }),
    JSON.stringify({ type: 'system/message', seq: 5, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }),
  ]
  const c5 = checkSessionLines(nonSurfaceBetween)
  t('负控8（中间夹非 surface 事件 step/start ⇒ claim 已过期）不得按 ④ 报红',
    c5.violations.filter(v => /has no adjacent shadow price/.test(v)).length === 0, `violations=${c5.violations.length}`)

  // 杠杆 2（P-20）：把同一份语料里的 step/start **删掉**，prune 就与 replace 紧邻
  // ⇒ 区间不一致（claim [1,2] vs replace [1,1]）必须**报红**。
  // 这对「负控 8 转绿」构成承重证明：绿不是因为判据恒绿，而是因为那条非 surface 事件确实清了 claim。
  const withoutStep = nonSurfaceBetween.filter(l => !l.includes('"step/start"'))
  const c6 = checkSessionLines(withoutStep)
  t('杠杆2（删掉 step/start ⇒ prune 与 replace 紧邻且区间不符 ⇒ 必须报红）',
    c6.violations.filter(v => /has no adjacent shadow price/.test(v)).length === 1, `violations=${c6.violations.filter(v => /has no adjacent shadow price/.test(v)).length}`)

  // 负控 9【第三十六轮 W36 续 · P-47 分层自查】：非白名单 type **携带** surfaceOp（官方元数据层抛错，
  // 但 fold 层静默清 claim）。判据 ④ **不得**因此报「邻接违约」（越界），claim 仍须被清除。
  const nonEligibleWithOp = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, surfaceOp: 'append' }),
    JSON.stringify({ type: 'compaction/prune', seq: 3, data: { shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], shadowedTokenCount: 9 } }),
    JSON.stringify({ type: 'step/start', seq: 4, surfaceOp: 'append' }), // 非白名单 type 却带 surfaceOp
    JSON.stringify({ type: 'system/message', seq: 5, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }),
  ]
  const c7 = checkSessionLines(nonEligibleWithOp)
  t('负控9（非白名单 type 携带 surfaceOp ⇒ 判据 ④ 不得越界报邻接违约）',
    c7.violations.filter(v => /has no adjacent shadow price/.test(v)).length === 0, `violations=${c7.violations.length}`)

  const bad = results.filter(r => !r.ok)
  console.log(`\n[session-integrity selftest] ${results.length - bad.length}/${results.length} PASS`)
  // ★ W44：统一自证输出契约（**必须在本函数内** —— `--selftest` 分支会早退）
  reportSelftest('session-integrity', results.length - bad.length, results.length)
  if (bad.length) process.exit(2)
  await crossCheckWithOfficial() // 判据 ④ 与官方参考实现对账（不一致即 exit 2）
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 判据 ④ 与**官方参考实现**的对账（只在 --selftest 时跑；找不到官方包则 fail-closed 报错）
// ---------------------------------------------------------------------------
/**
 * 为什么需要这一段（第三十六轮 W36 教训）：
 * W32 写判据 ④ 时，我是**手工从官方源码抄语义**的 ⇒ 抄漏了官方 claim 生命周期里的
 * 第二条清除分支（`!isSurfaceEvent`），导致 M7 的 J16 报出 1 处**假红**（官方 fold 跑
 * 同一文件全程不抛错）。手工转写语义**无法自证忠实**，必须让**官方实现本身**当裁判。
 *
 * 本段把判据 ④ 的结论与官方 `foldSurfaceProjection` 在**同一批语料**上逐条对比：
 *   判据 ④ 报红 ⟺ 官方抛**影子价格邻接**错误（同真同假）。
 *
 * 【P-47 归因分层（本段第一版就踩到）】官方 fold 还会因**别的层**抛错（例如语料里
 * `assistant/message` 缺 `data.message.content` ⇒ `deriveEventMessage` 抛 TypeError）。
 * 若把「官方抛任何错」都当作 ④ 的阳性 ⇒ **85/91 假不一致**（正是 P-47 的形态）。
 * ⇒ 只把**错误文本属于本判据职责**（`has no adjacent shadow price`）的抛错计入阳性；
 * 其它层的抛错**排除**（既不计阳性也不计阴性），并单独统计其数量以便发现语料缺陷。
 */
async function crossCheckWithOfficial() {
  const REL = 'dsh-runtime-src/node_modules/@deepseek-ai/dsh-token-meter/lib/types/surface-projection.js'
  const abs = fileURLToPath(new URL(`../${REL}`, import.meta.url))
  if (!existsSync(abs)) {
    console.error(`[session-integrity][FAIL] 对账所需的官方实现不存在：${abs}`)
    console.error('  ⇒ fail-closed：判据 ④ 的正确性无法自证，不当通过（P-19）')
    process.exit(2)
  }
  const { foldSurfaceProjection } = await import(pathToFileURL(abs).href)
  /** 官方 fold：只把**本判据职责内**的抛错当阳性（P-47） */
  const officialFold = (evs) => {
    let claim
    for (const e of evs) {
      try { claim = foldSurfaceProjection(claim, e).claim }
      catch (err) {
        const msg = String(err.message)
        if (/has no adjacent shadow price/.test(msg)) return { verdict: 'shadow', atSeq: e.seq, err: msg }
        return { verdict: 'other-layer', atSeq: e.seq, err: msg }
      }
    }
    return { verdict: 'ok', atSeq: null, err: null }
  }

  // 语料生成器：覆盖「紧邻 / 夹 append / 夹非 surface 事件 / claim 不符 / claim 过期」等组合。
  // 每条语料形如 { 说明, lines }，逐条对比两侧。
  // ★ 事件必须带**合法 data**（否则官方在 deriveEventMessage 处抛另一层的错，污染对账 —— P-47）。
  //   · `user/message`：官方 `deriveEventMessage` 返回 **`event.data` 本身**（即 data 就是 message）
  //   · `assistant|system/message`：官方返回 **`event.data.message`**
  //   第一版对 user 也包了一层 `{message:…}` ⇒ content 为 undefined ⇒ 官方抛
  //   `blocks is not iterable`（另一层错误，91 条全被排除 ⇒ 对账 0/0 不成立）。
  const OTHERS = ['step/start', 'step/end', 'turn/start', 'turn/end', 'request/header', 'assistant/attempt', 'agent/inbox/spliced', 'assistant/chunk']
  const corpus = []
  const TEXT = (s) => [{ type: 'text', text: s }]
  const mk = (seq, type, extra = {}) => JSON.stringify({ type, seq, ...extra })
  const userAt = (seq, op) => mk(seq, 'user/message', { data: { role: 'user', content: TEXT('x') }, surfaceOp: op })
  const asstAt = (seq, op) => mk(seq, 'assistant/message', { data: { message: { role: 'assistant', content: TEXT('y') } }, surfaceOp: op })
  const sysAt = (seq, op) => mk(seq, 'system/message', { data: { message: { role: 'system', content: TEXT('z') } }, surfaceOp: op })
  for (const mid of ['none', 'append', ...OTHERS]) {
    for (const claimRange of [[1, 2], [1, 1], [2, 2]]) {
      for (const replRange of [[1, 2], [1, 1], [2, 2]]) {
        const rows = [
          userAt(1, 'append'),
          asstAt(2, 'append'),
          mk(3, 'compaction/prune', { data: { shadowedRange: { start: claimRange[0], end: claimRange[1] }, shadowedSeqs: [claimRange[0]], shadowedTokenCount: 9 } }),
        ]
        if (mid === 'append') rows.push(userAt(4, 'append'))
        else if (mid !== 'none') rows.push(mk(4, mid, {}))
        rows.push(sysAt(5, { op: 'replace', startSeq: replRange[0], endSeq: replRange[1] }))
        corpus.push({ 说明: `mid=${mid} claim=[${claimRange}] replace=[${replRange}]`, lines: rows })
      }
    }
  }
  // 追加：计量事件连续出现（覆盖式重新武装）
  corpus.push({
    说明: '两个 prune 连排（覆盖式重新武装）',
    lines: [
      userAt(1, 'append'),
      mk(2, 'compaction/prune', { data: { shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], shadowedTokenCount: 9 } }),
      mk(3, 'compaction/summary', { data: { shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], shadowedTokenCount: 9 } }),
      userAt(4, { op: 'replace', startSeq: 1, endSeq: 1 }),
    ],
  })

  let diff = 0, skipped = 0
  for (const { 说明, lines } of corpus) {
    const local = checkSessionLines(lines)
    const localRed = local.violations.some(v => /has no adjacent shadow price/.test(v))
    const evs = []
    for (const l of lines) { try { evs.push(JSON.parse(l)) } catch { /* skip */ } }
    const off = officialFold(evs)
    if (off.verdict === 'other-layer') { // 非本判据职责 ⇒ 排除（P-47）
      skipped += 1
      if (skipped <= 3) console.error(`  [skip·其它层错误·不计入对账] ${说明}：${off.err.slice(0, 120)}`)
      continue
    }
    if (localRed !== (off.verdict === 'shadow')) {
      diff += 1
      if (diff <= 6) {
        console.error(`  [diff] ${说明}：判据 ④ ${localRed ? '报红' : '绿'} · 官方 ${off.verdict === 'shadow' ? `抛邻接错@seq ${off.atSeq}` : '通过'}`)
      }
    }
  }
  const judged = corpus.length - skipped
  console.log(`[session-integrity selftest] 与官方参考实现对账：${judged - diff}/${judged} 一致（另 ${skipped} 条因其它层错误排除）`)
  if (skipped > 0) {
    console.error(`[session-integrity][FAIL] 有 ${skipped} 条对账语料触发**其它层**错误 ⇒ 语料本身不干净，对账不成立（P-47）`)
    process.exit(2)
  }
  if (diff > 0) {
    console.error(`[session-integrity][FAIL] 判据 ④ 与官方 foldSurfaceProjection 存在 ${diff} 处语义漂移（P-45）`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// 设备侧：读取并审计
// ---------------------------------------------------------------------------
const ADB = resolveAdb()
if (ADB === null) {
  console.error('[session-integrity][FATAL] 找不到 adb —— 无法审计设备会话（fail-closed，不当作通过）')
  process.exit(3)
}
const runAs = (...args) => {
  try { return execFileSync(ADB, ['shell', 'run-as', PKG, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 96 * 1024 * 1024 }) }
  catch (e) { return `__ADBERR__ ${String(e.message).slice(0, 200)}` }
}

/** 列出设备上的会话目录（绝对路径 + 相对路径） */
const listSessionDirs = () => {
  const out = String(runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'd', '-name', 'session.*.jsonl', '-o', '-maxdepth', '3', '-type', 'f', '-name', 'session.jsonl'))
  // 上面 -o 组合在某些 find 上不可靠 ⇒ 改用「找所有 session.jsonl / session.vN.jsonl 的父目录」
  const out2 = String(runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'f', '-name', 'session.jsonl'))
  const out3 = String(runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'f', '-name', 'session.v*.jsonl'))
  const dirs = new Set()
  for (const blob of [out, out2, out3]) {
    for (const line of String(blob).split('\n')) {
      const p = line.trim()
      if (!p.startsWith('files/')) continue
      const d = p.slice(0, p.lastIndexOf('/'))
      if (d !== '') dirs.add(d)
    }
  }
  return [...dirs]
}

const dirs = ALL
  ? listSessionDirs()
  : SIDS.map(sid => {
    const o = runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'd', '-name', sid)
    return String(o).trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('files/')).pop() ?? ''
  }).filter(Boolean)

if (dirs.length === 0) {
  console.error('[session-integrity][FATAL] 未定位到任何会话目录（--sid 传对了吗？设备在线吗？）—— fail-closed')
  process.exit(3)
}

let totalViol = 0
let audited = 0
for (const dir of dirs) {
  const abs = `/data/data/${PKG}/${dir}`
  const listing = String(runAs('ls', '-1', abs))
  if (listing.startsWith('__ADBERR__')) { console.error(`[session-integrity] ⚠️ ${dir}：列目录失败（跳过，出声）`); continue }
  const entries = listing.split('\n').map(s => s.trim()).filter(Boolean)
  const logName = pickCurrentSessionFilename(entries)
  if (!entries.includes(logName)) { console.error(`[session-integrity] ⚠️ ${dir}：无 ${logName}（跳过，出声）`); continue }
  const txt = String(runAs('cat', `${abs}/${logName}`))
  if (txt.startsWith('__ADBERR__')) { console.error(`[session-integrity] ⚠️ ${dir}/${logName}：读取失败（跳过，出声）`); continue }
  const { violations, stats } = checkSessionLines(txt.split('\n'))
  const sid = dir.slice(dir.lastIndexOf('/') + 1)
  audited += 1
  totalViol += violations.length
  if (violations.length === 0) {
    if (!QUIET) console.log(`✓ ${sid}（${logName}）：自洽 [事件 ${stats.events} · surface ${stats.surface} · replace ${stats.replaces}]`)
  } else {
    console.log(`✗ ${sid}（${logName}）：**${violations.length} 处违规** [事件 ${stats.events} · surface ${stats.surface} · replace ${stats.replaces}${stats.badLines ? ` · 坏行 ${stats.badLines}` : ''}]`)
    for (const v of violations.slice(0, 8)) console.log(`    ↳ ${v}`)
    if (violations.length > 8) console.log(`    ↳ …另有 ${violations.length - 8} 处`)
  }
}
console.log(`\n[session-integrity] 审计 ${audited} 个会话 · 违规 ${totalViol} 处`)
process.exit(totalViol > 0 ? 1 : 0)
