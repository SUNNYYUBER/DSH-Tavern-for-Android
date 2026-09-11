#!/usr/bin/env node
/**
 * audit-dirty-floors.mjs — D-5b「存量脏楼层」**只读**普查报告
 * =============================================================================
 * 背景（D-5b，登记于 MASTER_TODO）：
 *   Kemini 预设的「aether opus正则一」是 `promptOnly: true` 的 ST 卡正则，语义上
 *   **只该变换发往 LLM 的文本、绝不回写 chat 数组**（TT `script.js:5282-5312`）。
 *   修复前它在 `pre-step` 阶段就跑并被宿主落成 `user/message` 耐久事件
 *   → 聊天记录被写成 `<interactive_input>\n…\n</interactive_input>`，UI 气泡显示包装标签。
 *   源侧已修（`dsh-plugin/index.ts:3610-3620`：promptOnly 推迟到 `llm/stream`，不落盘），
 *   但**存量数据已经被污染**。清洗需用户拍板，故先出**只读报告**（本脚本）。
 *
 * 【为什么必须走 foldSurface 而不是直接数事件】
 *   真实会话里有大量 `compaction/prune`（单文件实测 382 条）。原始 `user/message`
 *   事件数（429）远大于用户实际看到的楼层数。若直接数事件，报告会**大幅高估**污染面
 *   → 决策依据失真。故本脚本用**官方 0.1.5 迁移链 + foldSurface** 还原 surface 视图，
 *   与运行时读侧保持一致（吸取 L30：验证读侧必须等于运行时读侧）。
 *
 * 【判据口径（★ 必须复用既有 classify，不得自造第二套）】
 *   `<interactive_input>` 这个包装**有两种合法用途**，不能一律判脏：
 *     (a) 运行时上下文快照（`Current runtime context …` / `【角色状态…】` / `<system-reminder>`）
 *         —— **设计如此**，属基线语义；
 *     (b) 卡的 `promptOnly` 正则把**用户输入**包起来 —— 这才是被误落盘的脏数据。
 *   区分二者的权威口径 = 既有 `tt-projection.ts:89 classify()`（其判据全部来自 golden 实测）。
 *   → 本脚本通过 esbuild 打包该模块并**直接调用** `classify()`，避免"第二套分类器"漂移。
 *
 *   分档：
 *     · `user-input`（classify 判定）且含 `<interactive_input>` → **真脏**
 *     · 同正文出现 ≥2 次墙纸                    → **嵌套脏**（包装被二次写回）
 *     · `user-input` 正文含字面 `$N` / `$<name>` → **替换残留**
 *     · `runtime-ctx` / `system-level` / `skill-list` 等 → **设计用途**，单列不计风险
 *
 * 【首版教训（本脚本自身已踩一次）】：初版只按"含 `<interactive_input>`"计数，
 *   得出 118 条"真脏"，其中绝大多数其实是快照 —— 与 L44 同型（枚举器口径错 → 假结论）。
 *   故本版强制走既有 classify，并在报告里把"设计用途"单列，供人一眼对账。
 *
 * 用法：
 *   node audit-dirty-floors.mjs [会话树根] [--json <输出路径>]
 * 退出码：恒 0（只读报告，不是闸门）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/DSH RolePlay'
const WS = `${ROOT}/rp-workspace`
const PKG = `${WS}/packages`
const ESB = `${PKG}/node_modules/esbuild/bin/esbuild`
const NODE = process.execPath
// 产物落在 staging 目录内，`@deepseek-ai/*` 才能沿目录树上溯解析到 0.1.5 包
const RT = `${WS}/dsh-runtime-android`
const TREE = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : `${ROOT}/stage3-device/hb53/devtree/sessions`
const jsonIdx = process.argv.indexOf('--json')
const JSON_OUT = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null

const lines = []
const emit = (s = '') => { lines.push(s); console.log(s) }

// ---- 官方 0.1.5 迁移链 + foldSurface（与运行时同参） ----
const { sessionFormatCatalog } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js`).href)
const { foldSurface, isAppendSurfaceEvent } = await import(
  pathToFileURL(`${RT}/node_modules/@deepseek-ai/dsh-session/lib/types/surface.js`).href)
const rtVersion = JSON.parse(fs.readFileSync(
  `${RT}/node_modules/@deepseek-ai/dsh/package.json`, 'utf8')).version

// ---- ★ 打包并复用既有 classify（单源；禁止自造第二套分类口径） ----
// 产物放 stage3-device（**不放 staging**，避免被 build-wb.sh 打进 dsh-runtime.zip）。
// tt-projection.ts 无值导入 → 自包含，不需要 staging 的 `@deepseek-ai/*` 解析路径。
const AUDIT_DIR = `${ROOT}/stage3-device/hb54/.audit`
fs.mkdirSync(AUDIT_DIR, { recursive: true })
const BUNDLE_PROJ = `${AUDIT_DIR}/tt-projection.bundle.mjs`
execFileSync(NODE, [
  ESB, `${PKG}/src/dsht-plugin-shared/tt-projection.ts`,
  '--bundle', '--format=esm', '--platform=node',
  `--outfile=${BUNDLE_PROJ}`, '--log-level=warning',
], { cwd: PKG, stdio: 'inherit' })
const { classify } = await import(pathToFileURL(BUNDLE_PROJ).href)

// ---- ★★ 正控自检（L44：枚举器/分类器自身必须先过正控，否则会给出"看着干净"的假结论） ----
{
  const cases = [
    ['<interactive_input>\n$1\n</interactive_input>', 'user', 'user-input'],
    ['<interactive_input>\n（心跳31）你好，请用一句话回应。\n</interactive_input>', 'user', 'user-input'],
    ['<interactive_input>\nCurrent runtime context. This snapshot supersedes earlier…\n</interactive_input>', 'user', 'runtime-ctx'],
    ['【角色状态（MVU 变量树，最新优先）】\nstat_data._storyState: 0', 'user', 'system-level'],
    ['<system-reminder>\nA skill is a reusable set of task-specific instructions.', 'user', 'skill-list'],
    ['（普通用户输入，无包装）', 'user', 'history-user'],
  ]
  let bad = 0
  for (const [txt, role, want] of cases) {
    const got = classify({ role, content: txt })
    if (got !== want) { bad++; console.error(`[selftest] FAIL want=${want} got=${got} :: ${txt.slice(0, 48)}`) }
  }
  if (bad > 0) { console.error(`[selftest] ${bad}/${cases.length} 条不合格 → 口径不可信，中止`); process.exit(3) }
  console.log(`[selftest] ✅ ${cases.length}/${cases.length} 条 classify 口径符合预期（含 3 条"设计用途"负控）`)
}

/** 迁移 + 折叠。返回 { events } 或 { err }。 */
function surfaceOf(text) {
  const rows = text.split('\n').filter((l) => l.trim() !== '')
  if (rows.length === 0) return { err: '空文件' }
  let header
  try { header = JSON.parse(rows[0]) } catch (e) { return { err: `header 非 JSON: ${e.message}` } }
  let restore
  try {
    restore = sessionFormatCatalog.createRestore(header, { recovery: 'recoverable', validation: 'transformed' })
  } catch (e) { return { err: `HEADER-REJECT: ${e.message}` } }
  for (let i = 1; i < rows.length; i++) {
    let row
    try { row = JSON.parse(rows[i]) } catch { continue }
    try { restore.decodeRow(row) } catch (e) { return { err: `MIGRATE-REJECT seq=${row.seq} type=${row.type}: ${e.message}` } }
  }
  let art
  try { art = restore.finish() } catch (e) { return { err: `FINISH-REJECT: ${e.message}` } }
  try { foldSurface(art.events) } catch (e) { return { err: `FOLD-REJECT: ${e.message}` } }
  return { events: art.events, header }
}

/** 抽取一条 message 事件的纯文本。 */
function textOf(ev) {
  const d = ev?.data ?? {}
  if (ev.type === 'user/message') {
    const c = d.content
    if (Array.isArray(c)) return c.filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n')
    return typeof c === 'string' ? c : ''
  }
  const m = d.message ?? {}
  const c = m.content
  if (Array.isArray(c)) return c.filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n')
  return typeof c === 'string' ? c : ''
}

const WRAP = '<interactive_input>'
const countOf = (s, sub) => s.split(sub).length - 1

// ---- 遍历 ----
const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/^session.*\.jsonl$/.test(e.name) && !e.name.includes('.bak')) files.push(p)
  }
}
if (!fs.existsSync(TREE)) { console.error(`树不存在: ${TREE}`); process.exit(2) }
walk(TREE)

emit(`[env] 官方迁移链版本 = ${rtVersion}`)
emit(`[in ] 会话树 = ${TREE}`)
emit(`[in ] 会话文件 = ${files.length}`)
emit('')

const report = {
  tree: TREE, files: files.length, scanned: 0, failed: 0,
  totals: { dirtyWrapped: 0, dirtyNested: 0, dirtyDollar: 0, byDesign: 0, assistantMentions: 0 },
  byDesignKinds: {},
  timeBuckets: { all: 0, maxTime: 0, wrapped: [] },
  affected: [], byFile: [],
}

for (const f of files) {
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { report.failed++; continue }
  const { events, err } = surfaceOf(text)
  if (err) { report.failed++; report.byFile.push({ file: path.basename(path.dirname(f)), err }); continue }
  report.scanned++

  let hit
  const surf = events.filter(isAppendSurfaceEvent)
  hit = { file: path.basename(path.dirname(f)), dirtyWrapped: [], dirtyNested: [], dirtyDollar: [], byDesign: [], assistantMentions: [] }
  for (const ev of surf) {
    if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue
    const t = textOf(ev)
    if (!t) continue
    const n = countOf(t, WRAP)
    // 时间分桶统计（判据 ⑥：修复后新增的 user-input 不应再被包装）
    if (ev.type === 'user/message') {
      report.timeBuckets.all++
      const tt = ev.time ?? 0
      if (tt > report.timeBuckets.maxTime) report.timeBuckets.maxTime = tt
      if (n >= 1) report.timeBuckets.wrapped.push({ time: tt, file: hit.file, seq: ev.seq })
    }
    if (n === 0) continue
    // ★ 用既有 classify 分档（键名按 tt-projection 的 ProjMessage：{role, content}）
    const kind = classify({ role: ev.type === 'user/message' ? 'user' : 'assistant', content: t })
    if (ev.type === 'assistant/message') { hit.assistantMentions.push({ seq: ev.seq, n, kind }); continue }
    if (kind !== 'user-input') {
      // 设计用途（runtime-ctx / system-level / skill-list …）——单列，不计风险
      hit.byDesign.push({ seq: ev.seq, n, kind, head: t.replace(/\n/g, '\\n').slice(0, 72) })
      report.byDesignKinds[kind] = (report.byDesignKinds[kind] ?? 0) + 1
      continue
    }
    const dollars = (t.match(/\$(\d{1,2}|<[a-zA-Z_][\w]*>)/g) ?? [])
    hit.dirtyWrapped.push({ seq: ev.seq, time: ev.time ?? 0, n, head: t.replace(/\n/g, '\\n').slice(0, 96) })
    if (n >= 2) hit.dirtyNested.push({ seq: ev.seq, n, head: t.replace(/\n/g, '\\n').slice(0, 96) })
    if (dollars.length > 0) hit.dirtyDollar.push({ seq: ev.seq, dollars: [...new Set(dollars)].slice(0, 6), head: t.replace(/\n/g, '\\n').slice(0, 96) })
  }

  report.totals.dirtyWrapped += hit.dirtyWrapped.length
  report.totals.dirtyNested += hit.dirtyNested.length
  report.totals.dirtyDollar += hit.dirtyDollar.length
  report.totals.byDesign += hit.byDesign.length
  report.totals.assistantMentions += hit.assistantMentions.length

  if (hit.dirtyWrapped.length || hit.byDesign.length) {
    report.affected.push(hit)
    report.byFile.push({
      file: hit.file, surfaceFloor: surf.length,
      dirtyWrapped: hit.dirtyWrapped.length, dirtyNested: hit.dirtyNested.length,
      dirtyDollar: hit.dirtyDollar.length, byDesign: hit.byDesign.length,
      assistantMentions: hit.assistantMentions.length,
    })
  }
}

// ---- 输出 ----
const t = report.totals
emit('=== 汇总（surface 视图，append-origin 楼层；口径 = 既有 classify()） ===')
emit(`扫描成功 ${report.scanned} / ${files.length}（失败 ${report.failed}）`)
emit(`① user-input 被 <interactive_input> 包装（**真脏**）  ：${t.dirtyWrapped} 条`)
emit(`② 其中嵌套包装（≥2 次，**二次写回痕迹**）          ：${t.dirtyNested} 条`)
emit(`③ 其中含字面 $N / $<name>（**替换残留**）          ：${t.dirtyDollar} 条`)
emit(`④ 设计用途快照包裹（runtime-ctx / system-level 等）：${t.byDesign} 条 → 不计风险`)
emit(`   分档：${JSON.stringify(report.byDesignKinds)}`)
emit(`⑤ assistant 正文提及该标签（模型在"谈论"）         ：${t.assistantMentions} 条 → 不计风险`)
emit('')
if (report.affected.length === 0) {
  emit('✅ 未发现脏楼层 —— 无需清洗。')
} else {
  emit(`=== 受影响会话（${report.affected.length} 个） ===`)
  emit('')
  for (const h of report.affected) {
    if (!h.dirtyWrapped.length) continue
    emit(`▌ ${h.file}`)
    for (const x of h.dirtyWrapped.slice(0, 6)) emit(`   [脏] seq=${x.seq} n=${x.n}  ${x.head}`)
    if (h.dirtyWrapped.length > 6) emit(`   [脏] …还有 ${h.dirtyWrapped.length - 6} 条`)
    for (const x of h.dirtyNested.slice(0, 3)) emit(`   [嵌套] seq=${x.seq} n=${x.n}  ${x.head}`)
    for (const x of h.dirtyDollar.slice(0, 6)) emit(`   [$残留] seq=${x.seq} ${JSON.stringify(x.dollars)}  ${x.head}`)
    emit('')
  }
  emit(`=== 仅含设计用途快照的会话（${report.affected.filter(h => !h.dirtyWrapped.length).length} 个，无风险） ===`)
  for (const h of report.affected.filter(x => !x.dirtyWrapped.length).slice(0, 12)) {
    emit(`   · ${h.file}  byDesign=${h.byDesign.length} kinds=${JSON.stringify([...new Set(h.byDesign.map(b => b.kind))])}`)
  }
}
emit('')
emit(`[判定] 清洗触发条件 = ① ${t.dirtyWrapped} + ③ ${t.dirtyDollar} > 0 → ${t.dirtyWrapped + t.dirtyDollar > 0 ? '**存在**，需用户拍板是否清洗（本脚本只读，零写入）' : '不存在'}`)

// ---- 判据 ⑥：修复是否已生效（时间分桶）----
{
  const W = report.timeBuckets.wrapped.map(x => x.time).filter(Boolean)
  const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
  emit('')
  emit('=== ⑥ 修复生效性（时间分桶，判据：修复后新增的 user-input 不应再被包装） ===')
  emit(`全部 user/message（append-origin）= ${report.timeBuckets.all} 条；其中被包装 = ${report.timeBuckets.wrapped.length} 条`)
  emit(`全量消息最大时间 = ${report.timeBuckets.maxTime ? iso(report.timeBuckets.maxTime) : '(无)'} (UTC)`)
  if (report.timeBuckets.maxTime && W.length > 0) {
    const gapH = ((report.timeBuckets.maxTime - Math.max(...W)) / 3600000).toFixed(1)
    emit(`最后一次污染 → 最新消息 的间隔 = ${gapH} 小时${Number(gapH) >= 12 ? '（≥12h 无新增污染 → 修复已生效）' : '（间隔偏短，需再观察）'}`)
  }
  if (W.length === 0) {
    emit('✅ 无任何包装 → 无从判断"修复前后"，但至少当前态干净')
  } else {
    emit(`被包装消息时间跨度 = ${iso(Math.min(...W))} … ${iso(Math.max(...W))} (UTC)`)
    // 按天分桶
    const day = new Map()
    for (const x of report.timeBuckets.wrapped) {
      const d = new Date(x.time).toISOString().slice(0, 10)
      day.set(d, (day.get(d) ?? 0) + 1)
    }
    emit('按天分布：' + [...day.entries()].sort().map(([d, c]) => `${d}=${c}`).join('  '))
    emit('→ 若全部集中在早期日期、其后日期为 0，则**源侧修复已生效，残留纯属存量**')
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1), 'utf8')
  emit(`[out] JSON 报告 → ${JSON_OUT}`)
}
process.exit(0)
