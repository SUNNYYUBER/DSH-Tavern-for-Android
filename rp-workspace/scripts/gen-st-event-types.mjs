#!/usr/bin/env node
// gen-st-event-types.mjs — 从真 SillyTavern 基准源机械生成 `st-event-types.gen.ts`
//
// 为什么要有生成器而不是手抄：
//   卡脚本用 `ctx.eventTypes.OAI_PRESET_IMPORT_READY`（实测：卡的外链注入脚本
//   inject.js:493 `const importReadyEvent = ctx.eventTypes.OAI_PRESET_IMPORT_READY || '…'`
//   —— 注意它有 `||` 兜底，但**属性访问本身**在 `ctx.eventTypes === undefined` 时先抛
//   TypeError，兜底根本轮不到；所以必须真的提供这张表）。
//   真 ST 的表在 `public/scripts/events.js` 的 `event_types`，1.16 有 100+ 条且会随版本增删；
//   手抄必然漂移，且漂移是**静默**的（少一条 = 某个事件名恒 undefined）。
//   故：每次 ST 升级后重跑本脚本即可对齐。来源路径与行号写进产物头注释，便于复核。
//
// 用法：
//   node scripts/gen-st-event-types.mjs [SillyTavern-reference 根目录]
//   缺省源：$ST_REF 或 D:/SillyTavern-1.16.0/TauriTavern-Canary/SillyTavern-reference

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ST_REF = process.argv[2] || process.env.ST_REF
  || 'D:/SillyTavern-1.16.0/TauriTavern-Canary/SillyTavern-reference'
const SRC_REL = 'public/scripts/events.js'
const SRC = resolve(ST_REF, SRC_REL)
const OUT = resolve(HERE, '../packages/src/dsht-rp-ui/src/client/st-event-types.gen.ts')

const text = readFileSync(SRC, 'utf8')
const lines = text.split(/\r?\n/)

// 定位 `export const event_types = {`（允许 async/缩进变体）
const startIdx = lines.findIndex((l) => /export\s+const\s+event_types\s*=\s*\{/.test(l))
if (startIdx < 0) {
  console.error(`[gen-st-event-types] 未在 ${SRC} 找到 export const event_types —— ST 结构可能变了，请人工核对`)
  process.exit(1)
}
// 从起始行起找配对的顶层 `}`（列 0）
let endIdx = -1
for (let i = startIdx + 1; i < lines.length; i += 1) {
  if (/^\}/.test(lines[i])) { endIdx = i; break }
}
if (endIdx < 0) {
  console.error(`[gen-st-event-types] event_types 对象未闭合（起始 ${startIdx + 1} 行）`)
  process.exit(1)
}

// 逐条抽 `NAME: 'value',`（只认单引号字符串值，与 ST 写法一致）
const entries = []
for (let i = startIdx + 1; i < endIdx; i += 1) {
  const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'\s*,?\s*$/)
  if (m) entries.push([m[1], m[2]])
}
if (entries.length === 0) {
  console.error('[gen-st-event-types] 抽到 0 条 —— 解析规则需要更新，拒绝产出空表')
  process.exit(1)
}

const body = entries.map(([k, v]) => `  ${k}: '${v}',`).join('\n')
const header = `/**
 * ST 事件名常量表（**生成物，勿手改**）
 * ============================================================================
 * 生成器：rp-workspace/scripts/gen-st-event-types.mjs
 * 来源  ：${SRC_REL}:${startIdx + 1}（真 SillyTavern 基准源）
 * 条目  ：${entries.length}
 *
 * 用途：真 ST 的 getContext() 含 \`eventTypes: event_types\`
 *（SillyTavern-reference/public/scripts/st-context.js:137-138 与 \`eventSource\` 并列），
 * 卡脚本普遍写 \`ctx.eventTypes.<NAME>\`。注意脚本常带 \`|| '字面量兜底'\`，
 * 但 **在 eventTypes 为 undefined 时属性访问先抛 TypeError**，兜底轮不到 —— 所以必须真给表。
 *
 * 重新生成：node rp-workspace/scripts/gen-st-event-types.mjs [ST reference 根目录]
 */

/** ST \`event_types\` 形状：大写名 → 小写事件串 */
export type StEventTypes = Record<string, string>

/** 生成时所用基准源（可观测性：排查时一眼看出同步到哪一版） */
export const ST_EVENT_TYPES_SOURCE = {
  file: '${SRC_REL}',
  line: ${startIdx + 1},
  count: ${entries.length},
} as const

export const ST_EVENT_TYPES: StEventTypes = {
${body}
}
`

writeFileSync(OUT, header, 'utf8')
console.log(`[gen-st-event-types] ${SRC_REL}:${startIdx + 1} → ${entries.length} 条 → ${OUT}`)
