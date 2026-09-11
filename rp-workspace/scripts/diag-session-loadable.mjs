#!/usr/bin/env node
/**
 * diag-session-loadable.mjs — 用**官方 Session 构造器本身**判定会话文件能否被运行时加载
 * =============================================================================
 * 【为什么必须用官方构造器，而不是自己写校验】
 *   L30 的元教训是「验证读侧 ≠ 运行时读侧」：阶段 3 的判据用 `foldSurface`（兼容读取器）
 *   判定"可迁移"，比运行时**加载会话日志时的严格校验器**宽松 —— 于是防线在"真读"那一步是空的，
 *   我们自己的修复器把 v3 会话改成不可读时，判据全绿、设备上打不开。
 *   本脚本直接 `new Session(id, events, header)`（= `dsh-session-persistence-jsonl` 的
 *   `Session.fromRestore` 走的那条路），**同一份代码**判同一个问题。
 *
 * 用法：
 *   node diag-session-loadable.mjs <session.jsonl> [...]
 *   node diag-session-loadable.mjs --selftest <session.jsonl>   # 正/负控自检
 * 退出码：0 = 全部可加载；1 = 有不可加载
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const WS = 'D:/DSH RolePlay/rp-workspace'
const DSH_SESSION = `${WS}/dsh-runtime-src/node_modules/@deepseek-ai/dsh-session/lib/index.js`

const { Session } = await import(pathToFileURL(DSH_SESSION).href)
if (typeof Session !== 'function') {
  console.error('[loadable] FATAL 无法加载官方 Session 构造器')
  process.exit(2)
}

/** 解析会话文件 → { header, events } */
export function parseSession(text) {
  const rows = text.split('\n').filter(s => s.trim())
  const header = JSON.parse(rows[0])
  const events = []
  for (let i = 1; i < rows.length; i++) events.push(JSON.parse(rows[i]))
  return { header, events }
}

/** 用官方构造器判定能否加载（与 `Session.fromRestore` 同路径）。 */
export function tryLoad(text) {
  let parsed
  try { parsed = parseSession(text) } catch (e) { return { ok: false, error: `解析失败: ${e.message}` } }
  const { header, events } = parsed
  try {
    void new Session(header.id, events, header)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 事件类型里需要 settlement 三件套（turn/step/stream）的两种 */
const SETTLEMENT_TYPES = new Set(['assistant/message', 'assistant/attempt'])

/**
 * 修复：给缺失 `stream` 的 assistant/message / assistant/attempt 补 `stream: []`。
 * 依据官方 `assertAssistantSettlementShape`
 * （`dsh-session/lib/types/index.js:204-212`）：turn / step 必须是 ≥0 的安全整数，
 * 且 `data.stream` 必须是数组。非流式消息（我方插件直写，官方无 chunk）的正确形状就是
 * 空数组 —— 官方自身对非流式 assistant 消息也写 `stream: []`（设备实证）。
 * @returns {{text: string, fixed: number, details: string[]}}
 */
export function backfillStream(text) {
  const rows = text.split('\n')
  let fixed = 0
  const details = []
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue
    let ev
    try { ev = JSON.parse(rows[i]) } catch { continue }
    if (!SETTLEMENT_TYPES.has(ev?.type)) continue
    const d = ev.data
    if (d === null || typeof d !== 'object' || Array.isArray(d.stream)) continue
    details.push(`${ev.type}@seq=${ev.seq} (turn=${d.turn}, step=${d.step})`)
    d.stream = []
    rows[i] = JSON.stringify(ev)
    fixed++
  }
  return { text: rows.join('\n'), fixed, details }
}

/** 负控：把指定事件的 stream 改成非数组 */
function makeNegative(text) {
  const rows = text.split('\n')
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue
    let ev
    try { ev = JSON.parse(rows[i]) } catch { continue }
    if (ev?.type !== 'assistant/message') continue
    ev.data.stream = 'not-an-array'
    rows[i] = JSON.stringify(ev)
    return rows.join('\n')
  }
  return null
}

// ---------------- CLI ----------------
const argv = process.argv.slice(2)

if (argv.includes('--selftest')) {
  const sample = argv[argv.indexOf('--selftest') + 1]
  if (!sample) { console.error('用法: --selftest <session.jsonl>'); process.exit(2) }
  const text = fs.readFileSync(sample, 'utf8')
  const before = tryLoad(text)
  const { text: repaired, fixed, details } = backfillStream(text)
  const after = tryLoad(repaired)
  console.log(`[selftest] 样本: ${path.basename(sample)}`)
  console.log(`[selftest] ① 修复前加载: ${before.ok ? 'OK' : 'FAIL — ' + before.error}`)
  console.log(`[selftest] ② 补 stream 的事件数: ${fixed}`)
  for (const d of details.slice(0, 12)) console.log(`             · ${d}`)
  console.log(`[selftest] ③ 修复后加载: ${after.ok ? 'OK' : 'FAIL — ' + after.error}`)
  const neg = makeNegative(repaired)
  const negR = neg === null ? { ok: true, error: '(样本里没有 assistant/message，无法构造负控)' } : tryLoad(neg)
  console.log(`[selftest] ④ 负控（把 stream 改成非数组）→ ${negR.ok ? '❌ 仍然通过 = 工具空转' : '✅ 正确报错: ' + negR.error.slice(0, 90)}`)
  const pass = !before.ok && fixed > 0 && after.ok && !negR.ok
  console.log(`[selftest] ${pass ? '✅ 自检通过（前提为真、修复有效、工具承重）' : '❌ 自检不通过'}`)
  process.exit(pass ? 0 : 1)
}

const files = argv.filter(a => !a.startsWith('--'))
if (files.length === 0) { console.error('用法: node diag-session-loadable.mjs <session.jsonl>...'); process.exit(2) }
let bad = 0
for (const f of files) {
  const r = tryLoad(fs.readFileSync(f, 'utf8'))
  if (r.ok) console.log(`✓ ${f}`)
  else { bad++; console.log(`✗ ${f}\n    ${r.error}`) }
}
console.log(`\n[loadable] ${files.length - bad}/${files.length} 可加载`)
process.exit(bad ? 1 : 0)
