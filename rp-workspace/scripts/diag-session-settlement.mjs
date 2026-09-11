#!/usr/bin/env node
/**
 * diag-session-settlement.mjs — 定位 v3 会话里「settlement 字段非法」的 seed 事件
 * 校验规则（官方 dsh-session/lib/types/index.js:204-212）：
 *   seed assistant/message 必须满足 turn(safe int ≥0) / step(safe int ≥0) / stream(Array)
 * 用法：node diag-session-settlement.mjs <session.v3.jsonl>
 */
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8')
const lines = raw.split('\n')
console.log(`文件: ${file}`)
console.log(`总行数: ${lines.length}  字节: ${raw.length}`)

const header = JSON.parse(lines[0])
console.log('header:', JSON.stringify(header).slice(0, 400))

// 逐行解析，找 assistant/message 且缺 settlement 字段的
const problems = []
const msgIdx = []      // 所有 message 类事件的「seed 序号」
const typeCount = {}
let seedN = 0          // 官方 seed 序号（只计 seed 类，含 message/attempt/request/header…）
for (let li = 1; li < lines.length; li++) {
  const s = lines[li]
  if (!s.trim()) continue
  let ev
  try { ev = JSON.parse(s) } catch (e) { problems.push({ line: li + 1, why: 'JSON 解析失败: ' + e.message, head: s.slice(0, 160) }); continue }
  const t = ev.type ?? ev.event?.type
  typeCount[t] = (typeCount[t] ?? 0) + 1

  // 判定 seed 序号：0.1.5 的 v3 文件里，事件可能带 seed/index 元数据；先按出现顺序计
  const kind = ev.kind ?? ev.role ?? ''
  if (t === 'assistant/message') {
    const d = ev.data ?? ev
    const turn = d?.turn, step = d?.step, stream = d?.stream
    const bad = []
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0)) bad.push(`turn=${JSON.stringify(turn)}`)
    if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0 || Object.is(step, -0)) bad.push(`step=${JSON.stringify(step)}`)
    if (!Array.isArray(stream)) bad.push(`stream=${stream === undefined ? 'undefined' : typeof stream}`)
    msgIdx.push({ line: li + 1, seq: ev.seq, turn, step, streamOk: Array.isArray(stream), bad, keys: Object.keys(ev), dataKeys: d && typeof d === 'object' ? Object.keys(d) : null })
    if (bad.length) problems.push({ line: li + 1, seq: ev.seq, why: 'settlement 非法: ' + bad.join(', '), keys: Object.keys(ev), dataKeys: Object.keys(d ?? {}) })
  }
}
console.log('\n事件类型统计:', JSON.stringify(typeCount, null, 1))
console.log(`\nassistant/message 共 ${msgIdx.length} 条`)
console.log('最后 6 条 assistant/message 的 settlement:')
for (const m of msgIdx.slice(-6)) console.log('  ', JSON.stringify(m))

console.log(`\n=== 问题事件 (${problems.length}) ===`)
for (const p of problems.slice(0, 10)) console.log(JSON.stringify(p))
