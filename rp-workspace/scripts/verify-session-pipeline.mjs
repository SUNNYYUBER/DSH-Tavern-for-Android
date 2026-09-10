#!/usr/bin/env node
/**
 * verify-session-pipeline.mjs — 阶段 3 权威验证：**运行时真实修复链** 的端到端体检
 * ================================================================================
 * 与 tmp/repair-all.mjs 的区别（为什么需要这个脚本）：
 *   · repair-all.mjs 只调用 `repairSessionForV3` 单个函数 —— 它证明不了**设备上真正跑的
 *     三步链**也能把会话救回来。设备 `dsh-plugin/index.ts:2013-2015` 实际执行的是：
 *         normalizeSnapshotMessageRoles(content)   // 快照角色归一
 *       → repairSessionForV3(norm.content)         // v0→v3 迁移合法性修复
 *       → repairSessionSeqs(v3.content)            // committed 区 seq 连续性修复
 *     第三步在我方 v3 产物上**可能**不是幂等短路（它会重新展开聚合行、重编号 seq），
 *     若它改动了 repairSessionForV3 刚重映射好的引用，离线结论就与设备行为不符。
 *   · 所以本脚本**逐字复刻**设备三步链，再用官方 0.1.5 迁移链 + foldSurface 判定。
 *
 * 判据（全部通过才算阶段 3 通过）：
 *   1. 修复后可迁移率 100%
 *   2. 内容零丢失（原始文本集合 ⊄ 修复后文本集合 的差为空）
 *   3. 幂等（二次跑三步链零改动）
 *   4. 无回归（原本可迁移的不能被修坏）
 *   5. 【2026-09-10 新增】**目录身份不变**：修复后 projectKey(header.cwd) 必须仍等于
 *      会话所在目录名（官方 persistence `assertStoredIdentity` 契约）。
 *      加这条的原因 = 实机事故：某次修复把 `dsht-welcome` 的相对 cwd `rp/_start`
 *      补成绝对路径却没搬目录 → 目录名与 cwd 不符 → 会话在核心搬迁中**整份丢失**
 *      （设备 80 → 79）。离线链若能改 cwd，就该在这里被拦下。
 *
 * 用法：
 *   node verify-session-pipeline.mjs <会话树根目录> [--out <证据日志路径>]
 * 退出码：0 = 五项判据全过；1 = 有失败
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
const { repairSessionSeqs, sessionHeaderCwd } = await import(pathToFileURL(BUNDLE).href)
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

/** 设备三步链（dsh-plugin/index.ts:2013-2015 逐字复刻） */
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
  }
}

// ---- 2. 官方 0.1.5 迁移链（与运行时同参：recovery=recoverable） ----
const { sessionFormatCatalog } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js`).href)
const { foldSurface } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session/lib/types/surface.js`).href)
const rtVersion = JSON.parse(fs.readFileSync(
  `${RT}/node_modules/@deepseek-ai/dsh/package.json`, 'utf8')).version
emit(`[env] 官方迁移链版本 = ${rtVersion}`)

/** 官方链路判定：迁移 + surface 折叠。返回 null 表示通过，否则返回错误串。 */
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
let nonIdempotent = 0, lossy = 0, keyDrift = 0, totalBytes = 0, salvagedTotal = 0, movedTotal = 0
const failures = [], problems = [], noteCounts = new Map()
const t0 = Date.now()

for (const f of files) {
  const rel = path.relative(treeRoot, f)
  const orig = fs.readFileSync(f, 'utf8')
  totalBytes += Buffer.byteLength(orig)
  const origErr = officialFold(orig)
  if (origErr !== null) beforeFail++

  let r
  try { r = runtimePipeline(orig) } catch (e) {
    afterFail++; failures.push({ rel, err: `三步链抛错: ${e.message}` }); continue
  }
  if (r.error) { afterFail++; failures.push({ rel, err: `seq 修复失败: ${r.error}` }); continue }
  const afterErr = officialFold(r.content)

  if (afterErr !== null) {
    afterFail++
    failures.push({ rel, err: afterErr })
    // 回归 = 原本能迁移、修复链之后反而不能迁移
    if (origErr === null) regress++
  } else if (origErr !== null) {
    fixed++
  }
  for (const n of r.notes) noteCounts.set(n, (noteCounts.get(n) ?? 0) + 1)

  // 幂等：二次跑必须零改动
  const r2 = runtimePipeline(r.content)
  if (r2.content !== r.content) {
    nonIdempotent++
    problems.push({ rel, kind: '非幂等', detail: (r2.notes.join('；') || '(无说明)').slice(0, 120) })
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
  const dirKey = rel.replaceAll(path.sep, '/').split('/')[0]
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
emit(`source 扩展键迁移   ${salvagedTotal} 个楼层 / ${movedTotal} 段文本改载 sidecar（未丢失）`)
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

const pass = afterFail === 0 && regress === 0 && lossy === 0 && nonIdempotent === 0 && keyDrift === 0
emit(`\n[pipeline] ${pass ? '✅ 五项判据全过 —— 阶段 3 通过' : '❌ 存在未通过项 —— 阶段 3 不通过'}`)

// 清理现场（不要把验证产物留在会被打包的 staging 目录）
try { fs.rmSync(path.dirname(BUNDLE), { recursive: true, force: true }) } catch { /* 忽略 */ }

if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
  console.log(`\n[pipeline] 证据已写入 ${OUT}`)
}
process.exit(pass ? 0 : 1)
