#!/usr/bin/env node
/**
 * verify-session-pipeline.mjs — 阶段 3 权威验证：**运行时真实修复链** 的端到端体检
 * ================================================================================
 * 与 tmp/repair-all.mjs 的区别（为什么需要这个脚本）：
 *   · repair-all.mjs 只调用 `repairSessionForV3` 单个函数 —— 它证明不了**设备上真正跑的
 *     四步链**也能把会话救回来。设备实际执行的是：
 *         repairSessionCwds()                     // ④ cwd 规范化（相对→绝对 + 目录改名）:2036
 *         normalizeSnapshotMessageRoles(content)  // ① 快照角色归一                      :2013
 *       → repairSessionForV3(norm.content)         // ② v0→v3 迁移合法性修复
 *       → repairSessionSeqs(v3.content)            // ③ committed 区 seq 连续性修复
 *     【2026-09-11 补第④步】原脚本只复刻 ①②③，漏了 ④ —— 后果是 `dsht-welcome`（历史引导会话，
 *     header.cwd 是**相对**路径 `rp/_start`）在离线判据里恒判「不可迁移」，报 79/80，
 *     而设备上它是好的（运行时 ④ 会解析成绝对路径并把目录改名为 projectKey(新cwd)）。
 *     **离线链少了哪一步，就会在那一维度上给出与设备相反的结论** —— 这正是本脚本存在的意义。
 *   · 第三步在我方 v3 产物上**可能**不是幂等短路（它会重新展开聚合行、重编号 seq），
 *     若它改动了 repairSessionForV3 刚重映射好的引用，离线结论就与设备行为不符。
 *   · 所以本脚本**逐字复刻**设备四步链，再用官方 0.1.5 迁移链 + foldSurface 判定。
 *     ④ 无法离线执行 `realpath`/`rename`，故按语义等价推演（见 `cwdRepairStep`）。
 *
 * 判据（全部通过才算阶段 3 通过）：
 *   1. 修复后可迁移率 100%
 *   2. 内容零丢失（原始文本集合 ⊄ 修复后文本集合 的差为空）
 *   3. 幂等（二次跑三步链零改动）
 *   4. 无回归（原本可迁移的不能被修坏）
 *   6. 【2026-09-11 新增】**不会每次启动都重写**：二次跑必须 changed=false。
 *   5. 【2026-09-10 新增】**目录身份不变**：修复后 projectKey(header.cwd) 必须仍等于
 *      会话所在目录名（官方 persistence `assertStoredIdentity` 契约）。
 *      加这条的原因 = 实机事故：某次修复把 `dsht-welcome` 的相对 cwd `rp/_start`
 *      补成绝对路径却没搬目录 → 目录名与 cwd 不符 → 会话在核心搬迁中**整份丢失**
 *      （设备 80 → 79）。离线链若能改 cwd，就该在这里被拦下。
 *   7. 【2026-09-11 心跳 49 新增】**过得了运行时加载**：迁移 + foldSurface 之后，
 *      还必须能通过 `new Session(id, events, header)`（= `Session.fromRestore`，
 *      运行时真正加载会话走的那条路）。
 *      加这条的原因 = 又一次「验证读侧 ≠ 运行时读侧」（L30）：我们自己的 TH 写桥
 *      往 v3 会话追加 `assistant/message` 时漏了 `stream`，**本脚本原先判它「可迁移」**，
 *      而设备上该会话 100% 打不开（`invalid settlement fields`）。
 *
 * 用法：
 *   node verify-session-pipeline.mjs <会话树根目录> [--out <证据日志路径>]
 * 退出码：0 = 七项判据全过；1 = 有失败
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/DSH RolePlay'
const WS = `${ROOT}/rp-workspace`
const PKG = `${WS}/packages`
const NODE = process.execPath
const ESB = `${PKG}/node_modules/esbuild/bin/esbuild`
// 产物落在 staging 目录内，`@deepseek-ai/*` 才能沿目录树上溯解析到 0.1.5 包
const RT = `${WS}/dsh-runtime-android`
const BUNDLE = `${RT}/.verify/dsh-plugin.bundle.mjs`
const BUNDLE_SURGERY = `${RT}/.verify/session-surgery.bundle.mjs`
const BUNDLE_REPAIR = `${RT}/.verify/session-repair.bundle.mjs`
const BUNDLE_EXPORT = `${RT}/.verify/dsh-export.bundle.mjs`

const treeRoot = process.argv[2]
if (!treeRoot || !fs.existsSync(treeRoot)) {
  console.error('用法: node verify-session-pipeline.mjs <会话树根目录> [--out <日志>]')
  process.exit(2)
}
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null
const lines = []
const emit = (s = '') => { lines.push(s); console.log(s) }

// ---- 1. 现场编译「运行时同款」修复链 ----
fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })
emit('[build] 编译 dsh-plugin（含 repairSessionSeqs）+ session-surgery（含 normalizeSnapshotMessageRoles）')
execFileSync(NODE, [ESB, `${PKG}/src/dsh-plugin/index.ts`, '--bundle', '--format=esm',
  '--platform=node', `--outfile=${BUNDLE}`, '--external:@deepseek-ai/*', '--log-level=warning'],
{ cwd: PKG, stdio: 'inherit' })
// normalizeSnapshotMessageRoles 由 index.ts 从共享层 import 但**未再导出**，必须单独打一份
execFileSync(NODE, [ESB, `${PKG}/src/dsht-plugin-shared/session-surgery.ts`, '--bundle', '--format=esm',
  '--platform=node', `--outfile=${BUNDLE_SURGERY}`, '--external:@deepseek-ai/*', '--log-level=warning'],
{ cwd: PKG, stdio: 'inherit' })
execFileSync(NODE, [ESB, `${PKG}/src/dsht-plugin-shared/session-repair.ts`, '--bundle', '--format=esm',
  '--platform=node', `--outfile=${BUNDLE_REPAIR}`, '--external:@deepseek-ai/*', '--log-level=warning'],
{ cwd: PKG, stdio: 'inherit' })
const { repairSessionSeqs, sessionHeaderCwd, sessionRepairNeedsWrite, sessionCwdNeedsRepair, rewriteSessionHeaderCwd } = await import(pathToFileURL(BUNDLE).href)
const { normalizeSnapshotMessageRoles } = await import(pathToFileURL(BUNDLE_SURGERY).href)
const { repairSessionForV3 } = await import(pathToFileURL(BUNDLE_REPAIR).href)
// projectKey 必须取**实现本身**（不重写）——目录身份判据的基准
execFileSync(NODE, [ESB, `${PKG}/src/import/dsh-export.ts`, '--bundle', '--format=esm',
  '--platform=node', `--outfile=${BUNDLE_EXPORT}`, '--external:@deepseek-ai/*', '--log-level=warning'],
{ cwd: PKG, stdio: 'inherit' })
const { projectKey } = await import(pathToFileURL(BUNDLE_EXPORT).href)
if (typeof repairSessionSeqs !== 'function' || typeof normalizeSnapshotMessageRoles !== 'function'
  || typeof repairSessionForV3 !== 'function' || typeof projectKey !== 'function') {
  console.error(`[build] FATAL 修复链函数缺失: seq=${typeof repairSessionSeqs} norm=${typeof normalizeSnapshotMessageRoles} v3=${typeof repairSessionForV3} pk=${typeof projectKey}`)
  process.exit(2)
}
emit(`[build] ✓ 四函数就位 repairSessionSeqs / normalizeSnapshotMessageRoles / repairSessionForV3 / projectKey`)
emit(`[build] ✓ cwd 规范化步骤就位 sessionCwdNeedsRepair / rewriteSessionHeaderCwd`)

/**
 * 设备端 dshHome 前缀（**必须硬编码**，无法从离线树推导）。
 *
 * 为什么需要它：运行时的修复链有 **四步**，本脚本原先只复刻了三步，漏掉的第四步
 * `repairSessionCwds`（`dsh-plugin/index.ts:2036`）负责把**相对 cwd 解析成绝对**
 * （历史引导会话写的是 `rp/_start`）**并把会话目录重命名到 projectKey(新cwd)**。
 * 离线链不跑它 → `dsht-welcome` 永远停在「format v0 header cwd must be absolute」→
 * 报 79/80，而设备上它是好的（实测该会话目录已是
 * `--data-data-com.dshtavern.app-files-.dsh-rp-_start--/dsht-welcome`，cwd 为绝对）。
 *
 * 解析基准只能是**设备上的绝对前缀**（离线树的 Windows 路径与设备路径不同源），
 * 故取设备真值。若换设备/换包名，用 `--dsh-home` 覆盖。
 */
const dshHomeIdx = process.argv.indexOf('--dsh-home')
const DSH_HOME = dshHomeIdx > 0 ? process.argv[dshHomeIdx + 1] : '/data/data/com.dshtavern.app/files/.dsh'

/**
 * 第四步：cwd 规范化（纯函数复刻 `repairSessionCwds` 的判定与改写，不碰磁盘）。
 *
 * 设备上它会 `realpath()` + `rename()` 搬目录；离线树无法执行这两件事，
 * 故此处只做**语义等价**的推演：
 *   · 相对 cwd 以 dshHome 为基准解析成绝对
 *   · 返回改写后的首行 + 搬迁后的目录键（= projectKey(新cwd)）
 * 这样判据 1（可迁移）与判据 5（目录身份）才覆盖运行时真正做的事。
 *
 * @param {string} content 会话全文
 * @param {string} dirKey  会话当前所在目录名
 * @returns {{ content: string, dirKey: string, changed: boolean }}
 */
function cwdRepairStep(content, dirKey) {
  const cwd = sessionHeaderCwd(content)
  // 非字符串 / 已是绝对路径 → 运行时直接 continue，不改动
  if (cwd === null || !sessionCwdNeedsRepair(cwd)) return { content, dirKey, changed: false }
  const resolved = path.isAbsolute(cwd) ? cwd : path.resolve(DSH_HOME, cwd)
  const canonical = resolved
  const nl = content.indexOf('\n')
  const firstLine = nl === -1 ? content : content.slice(0, nl)
  const newLine = rewriteSessionHeaderCwd(firstLine, canonical)
  if (newLine === null) return { content, dirKey, changed: false }
  return {
    content: newLine + (nl === -1 ? '' : content.slice(nl)),
    dirKey: projectKey(canonical),
    changed: true,
  }
}

/** 设备四步链（dsh-plugin/index.ts:2036 cwd 规范化 → :2013-2015 三步） */
function runtimePipeline(content) {
  const norm = normalizeSnapshotMessageRoles(content)
  const v3 = repairSessionForV3(norm.content)
  const seq = repairSessionSeqs(v3.content)
  return {
    content: seq.content,
    changed: Boolean(norm.changed) || Boolean(v3.changed) || Boolean(seq.repaired),
    notes: [...(v3.notes ?? []), ...(seq.note ? [seq.note] : [])],
    error: seq.error,
    // 【阶段3 2026-09-10】source 上摘下来的自定义键（thData/thSystem 等）——
    // 调用方负责落 sidecar；验证时并入「内容」集合，载体变了但数据没丢。
    salvaged: v3.salvaged ?? [],
    // 判据 6 需要**原始字段**：要在离线复现运行时那条短路守卫的**字面表达式**，
    // 才能查出「字段类型与守卫比较运算符不匹配」这类恒真/恒假缺陷。
    raw: { normChanged: norm.changed, v3Changed: v3.changed, seqRepaired: seq.repaired },
  }
}

// ---- 2. 官方 0.1.5 迁移链（与运行时同参：recovery=recoverable） ----
const { sessionFormatCatalog } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js`).href)
const { foldSurface } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session/lib/types/surface.js`).href)
// 判据 7 的判定器：**运行时加载路径的那一个**（不是 foldSurface 这个兼容读取器）
const { Session } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session/lib/index.js`).href)
const rtVersion = JSON.parse(fs.readFileSync(
  `${RT}/node_modules/@deepseek-ai/dsh/package.json`, 'utf8')).version
emit(`[env] 官方迁移链版本 = ${rtVersion}`)

/**
 * 官方链路判定：迁移 + surface 折叠 + **运行时加载校验**。返回 null 表示通过。
 *
 * 【判据 7 / 心跳 49 新增】最后一步 `new Session(...)` 是**运行时真正加载会话走的那条路**
 * （`dsh-session-persistence-jsonl` 的 `Session.fromRestore`）。加它的原因是一次实机事故：
 *   我方 TH 写桥往 v3 会话追加 `assistant/message` 时漏了 `stream` 字段 ——
 *   `sessionFormatCatalog` 迁移**通过**、`foldSurface` 折叠**通过**（两者都不是加载期的
 *   校验器），但运行时 `assertSessionEventEnvelope → assertAssistantSettlementShape`
 *   （`dsh-session/lib/types/index.js:204-212`）直接抛
 *   `seed assistant/message at index N has invalid settlement fields` → **会话打不开**。
 *   即：**本脚本原先会把这个坏文件判成「可迁移」** —— 防线在"真读"那一步是空的（L30）。
 *   实测证据：对该坏文件，前两步均通过、第三步必抛（`LOAD-REJECT`）。
 */
function officialFold(text) {
  const rows = text.split('\n').filter((l) => l.trim() !== '')
  if (rows.length === 0) return '空文件'
  let header
  try { header = JSON.parse(rows[0]) } catch (e) { return `header 非 JSON: ${e.message}` }
  let restore
  try {
    restore = sessionFormatCatalog.createRestore(header, { recovery: 'recoverable', validation: 'transformed' })
  } catch (e) { return `HEADER-REJECT: ${e.message}` }
  for (let i = 1; i < rows.length; i++) {
    let row
    try { row = JSON.parse(rows[i]) } catch { continue }
    try { restore.decodeRow(row) } catch (e) { return `MIGRATE-REJECT seq=${row.seq} type=${row.type}: ${e.message}` }
  }
  let art
  try { art = restore.finish() } catch (e) { return `FINISH-REJECT: ${e.message}` }
  try { foldSurface(art.events) } catch (e) { return `FOLD-REJECT: ${e.message}` }
  // ★ 判据 7：运行时加载路径的严格校验器（缺它 = 防线在"真读"那一步是空的）
  try {
    void new Session(header.id, art.events, art.header ?? header)
  } catch (e) {
    return `LOAD-REJECT: ${e.message}`
  }
  return null
}

/**
 * 形状无关的内容抽取：递归收集所有字符串叶子。
 * 只用于「原文 ⊄ 修复后」的集合差 —— 结构演进不算丢失，但任何一段人类可见文本
 * 消失都会被抓住。
 *
 * 刻意排除的三类**非内容**字符串（改名/剥离属结构演进，不是内容丢失）：
 *   · `type`  —— 事件类型名（聚合行 `text-chunks` 就地展开后该 tag 不再出现，
 *                但它承载的 `data.texts[]` 文本仍在，且会被本函数抽出来比对）
 *   · `cwd`   —— header 工作目录（修复器按契约把相对路径补成绝对路径）
 *   · **事件信封顶层的 `source`** —— 官方信封白名单里没有 `source` 键
 *                （实测 `{"source":{"seqRepair":"truncate-wraparound"}}`），修复器必须剥掉。
 *                注意 `data.message.source` 在深层，仍参与比对（其 thData 载荷走 salvage 集合）。
 */
function stringsOf(text) {
  const out = new Set()
  const walk = (v, key, depth) => {
    if (typeof v === 'string') {
      if (v.trim() && key !== 'type' && key !== 'cwd') out.add(v)
      return
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth); return }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (depth === 1 && k === 'source') continue // 事件信封顶层 source（非法键）
        walk(x, k, depth + 1)
      }
    }
  }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    let o
    try { o = JSON.parse(l) } catch { continue }
    walk(o, undefined, 1)
  }
  return out
}

/** 把 salvage 载荷也抽成字符串集合（载体从 source 换成 sidecar，不算丢失） */
function salvageStrings(salvaged) {
  const out = new Set()
  const walk = (v) => {
    if (typeof v === 'string') { if (v.trim()) out.add(v); return }
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (v && typeof v === 'object') { for (const x of Object.values(v)) walk(x) }
  }
  walk(salvaged)
  return out
}

function findSessions(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) findSessions(p, out)
    else if (e.name === 'session.jsonl' || /^session\.v\d+\.jsonl$/.test(e.name)) out.push(p)
  }
  return out
}

// ---- 3. 逐个会话跑全链 ----
const files = findSessions(treeRoot).sort()
emit(`\n[pipeline] 会话树 ${treeRoot} → ${files.length} 个会话\n`)

let beforeFail = 0, afterFail = 0, fixed = 0, regress = 0
let nonIdempotent = 0, lossy = 0, keyDrift = 0, rewriteEveryBoot = 0, totalBytes = 0, salvagedTotal = 0, movedTotal = 0
let cwdFixed = 0
/** 判据 7 的可见面：修复前有多少会话是「迁移/折叠都过、但运行时加载拒绝」——即旧判据完全看不见的那一类 */
let loadRejectBefore = 0, loadRejectAfter = 0
const failures = [], problems = [], noteCounts = new Map()
const t0 = Date.now()

for (const f of files) {
  const rel = path.relative(treeRoot, f)
  const orig = fs.readFileSync(f, 'utf8')
  totalBytes += Buffer.byteLength(orig)
  const origErr = officialFold(orig)
  if (origErr !== null) beforeFail++
  if (origErr !== null && origErr.startsWith('LOAD-REJECT')) loadRejectBefore++

  // 第四步（cwd 规范化）**先跑**，与设备启动顺序一致（repairSessionCwds 早于 repairAllSessionSeqs）。
  // 它可能改 header.cwd 并把目录改名 → 判据 5 的 dirKey 基准随之更新。
  const dirKey0 = rel.replaceAll(path.sep, '/').split('/')[0]
  const cwdStep = cwdRepairStep(orig, dirKey0)
  const dirKey = cwdStep.dirKey
  if (cwdStep.changed) cwdFixed++

  let r
  try { r = runtimePipeline(cwdStep.content) } catch (e) {
    afterFail++; failures.push({ rel, err: `四步链抛错: ${e.message}` }); continue
  }
  if (r.error) { afterFail++; failures.push({ rel, err: `seq 修复失败: ${r.error}` }); continue }
  const afterErr = officialFold(r.content)
  if (afterErr !== null && afterErr.startsWith('LOAD-REJECT')) loadRejectAfter++

  if (afterErr !== null) {
    afterFail++
    failures.push({ rel, err: afterErr })
    // 回归 = 原本能迁移、修复链之后反而不能迁移
    if (origErr === null) regress++
  } else if (origErr !== null) {
    fixed++
  }
  for (const n of r.notes) noteCounts.set(n, (noteCounts.get(n) ?? 0) + 1)

  // 幂等：二次跑必须零改动（含第四步 cwd 规范化 —— 它跑第二遍必须无事可做）
  const cwd2 = cwdRepairStep(r.content, dirKey)
  const r2 = runtimePipeline(cwd2.content)
  if (r2.content !== r.content || cwd2.changed) {
    nonIdempotent++
    problems.push({ rel, kind: '非幂等', detail: (r2.notes.join('；') || '(无说明)').slice(0, 120) })
  }
  // 判据 6：修复链必须**收敛**——跑完一遍后，运行时谓词 `sessionRepairNeedsWrite`
  // 对结果再判时必须返回 false（= 不再落盘）。否则每次启动都重写全部会话。
  // 【为什么必须用运行时那个谓词本身】历史缺陷正是**谓词写错**：
  //   `norm.changed === 0 && v3.changed === 0` 里 `v3.changed` 是 boolean，
  //   `false === 0` 恒 false → 谓词恒真 → 每次启动重写 79 个会话
  //   （~200MB 无效写入 + 79 个 .bak / 136MB 堆积，抬高 torn-write 概率）。
  // 「内容相等」（判据 3）抓不到它；只有用谓词本身对**收敛结果**再判才抓得到。
  {
    const raw = r2.raw ?? {}
    const needsWrite = sessionRepairNeedsWrite(raw.normChanged, raw.v3Changed, raw.seqRepaired)
    if (needsWrite) {
      rewriteEveryBoot++
      problems.push({
        rel, kind: '修复链不收敛（每次启动都会重写）',
        detail: `谓词仍判需落盘：norm.changed=${raw.normChanged}(${typeof raw.normChanged}) `
          + `v3.changed=${raw.v3Changed}(${typeof raw.v3Changed}) `
          + `seq.repaired=${raw.seqRepaired}(${typeof raw.seqRepaired})`,
      })
    }
  }
  // 内容无损：原文所有字符串叶子都应仍在（**会话文本内**，或**salvaged sidecar 载荷里**）
  const after = stringsOf(r.content)
  const salv = salvageStrings(r.salvaged)
  const lost = []
  let moved = 0
  for (const s of stringsOf(orig)) {
    if (after.has(s)) continue
    if (salv.has(s)) { moved++; continue }
    lost.push(s)
  }
  salvagedTotal += r.salvaged.length
  movedTotal += moved
  if (lost.length > 0) {
    lossy++
    problems.push({ rel, kind: '内容丢失', detail: `${lost.length} 段，例：${JSON.stringify(lost[0].slice(0, 60))}` })
  }
  // 判据 5：目录身份不变 —— projectKey(修复后 header.cwd) 必须 == 会话所在目录名。
  // 违反 = 交给 DSH 一个「目录名与 cwd 不符」的会话：官方 assertStoredIdentity 判不合规，
  // 实机后果是 plugin tree 加载失败（crash-loop）+ 会话文件在核心搬迁中丢失。
  // 【注意】dirKey 取自第四步（cwd 规范化）之后 —— 运行时那步会 `rename()` 搬目录，
  // 搬完目录名就该等于 projectKey(新 cwd)；此处正是校验这个不变量。
  const outCwd = typeof sessionHeaderCwd === 'function' ? sessionHeaderCwd(r.content) : null
  if (outCwd !== null && projectKey(outCwd) !== dirKey) {
    keyDrift++
    problems.push({
      rel, kind: '目录身份漂移',
      detail: `修复后 cwd=${JSON.stringify(outCwd)} → projectKey=${projectKey(outCwd)}，目录名=${dirKey}`,
    })
  }
  const tag = afterErr === null ? (origErr === null ? '✓' : '★') : '✗'
  emit(`  ${tag} ${rel}  ${(Buffer.byteLength(orig) / 1048576).toFixed(2)}MiB  ` +
    (afterErr === null ? (origErr === null ? '本就通过' : '修复后通过') : `FAIL: ${afterErr.slice(0, 110)}`))
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
emit(`\n===== 汇总 =====`)
emit(`会话总数            ${files.length}`)
emit(`修复前可迁移        ${files.length - beforeFail} / ${files.length}`)
emit(`修复后可迁移        ${files.length - afterFail} / ${files.length}`)
emit(`本次救回            ${fixed}`)
emit(`被修坏（回归）      ${regress}`)
emit(`内容丢失            ${lossy}`)
emit(`非幂等              ${nonIdempotent}`)
emit(`目录身份漂移        ${keyDrift}`)
emit(`每次启动会重写      ${rewriteEveryBoot}`)
emit(`cwd 规范化          ${cwdFixed} 个会话（相对 cwd → 绝对 + 目录改名）`)
emit(`source 扩展键迁移   ${salvagedTotal} 个楼层 / ${movedTotal} 段文本改载 sidecar（未丢失）`)
emit(`【判据7】运行时拒载   修复前 ${loadRejectBefore} → 修复后 ${loadRejectAfter}`
  + `（迁移/折叠都过、只有「运行时加载」这一步拒收的那一类的可见面）`)
emit(`总数据量            ${(totalBytes / 1048576).toFixed(1)}MB / 耗时 ${secs}s`)
if (failures.length) {
  emit(`\n--- 仍失败 (${failures.length}) ---`)
  for (const x of failures.slice(0, 30)) emit(`  ✗ ${x.rel}\n      ${x.err}`)
}
if (problems.length) {
  emit(`\n--- 质量问题 (${problems.length}) ---`)
  for (const x of problems.slice(0, 30)) emit(`  ! ${x.rel} [${x.kind}] ${x.detail}`)
}
emit(`\n--- 修复动作分布 ---`)
for (const [k, n] of [...noteCounts].sort((a, b) => b[1] - a[1])) emit(`  ${String(n).padStart(4)}  ${k}`)

const pass = afterFail === 0 && regress === 0 && lossy === 0 && nonIdempotent === 0 && keyDrift === 0 && rewriteEveryBoot === 0
emit(`\n[pipeline] ${pass ? '✅ 七项判据全过 —— 阶段 3 通过' : '❌ 存在未通过项 —— 阶段 3 不通过'}`)

// 清理现场（不要把验证产物留在会被打包的 staging 目录）
try { fs.rmSync(path.dirname(BUNDLE), { recursive: true, force: true }) } catch { /* 忽略 */ }

if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
  console.log(`\n[pipeline] 证据已写入 ${OUT}`)
}
process.exit(pass ? 0 : 1)
