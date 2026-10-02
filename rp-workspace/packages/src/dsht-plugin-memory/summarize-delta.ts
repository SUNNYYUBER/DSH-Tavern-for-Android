/**
 * summarize-delta.ts —— M2 写入层：摘要 LLM 的 delta 协议（自研，纯函数）。
 *
 * 【版权声明】输出协议由本文件独立设计（markdown 摘要正文 + JSON delta 双产出）。
 * 仅行为思路参考柏宝书公开 README（无 LICENSE ⇒ 零源码/零提示词复用），全部文案自研。
 *
 * 【管线位置】M2 摘要调用沿用既有 summarizeSession 的 llm 通道（agentDefaultModel /
 * ctx.llm.stream），在 buildSummarizePrompt 协议上**扩展**：模型在一次回复里输出
 *   1) markdown 摘要正文（进 leaf.text）
 *   2) ```json delta 代码块（进 leaf.delta，M1 memory-forest 的 applyDelta 消费）
 * 解析失败（JSON 坏/缺）时**降级**：仅落 markdown 摘要 + 空 delta（台账不受损，
 * 下轮自动补摘不受影响）——不因 delta 解析失败丢弃整楼摘要（fail-open 但出声）。
 */

import type { LeafDelta } from './memory-forest.ts'

/** 摘要正文的默认目标区间（详细档 600 / 精简档 300，用户可在设置改） */
export const SUMMARY_TEXT_MAX = 600
export const SUMMARY_TEXT_MIN = 120

/** delta JSON 代码块的围栏标签（解析用；模型提示词中明示） */
export const DELTA_FENCE = '```json'

/** 自研 delta 协议提示词（system 段追加在既有 buildSummarizePrompt system 之后） */
export function buildDeltaProtocolSection(): string {
  return [
    '',
    '## 数据台账更新（delta 协议，必须遵守）',
    '在 markdown 摘要之后，另起一行输出一个 ```json 代码块，记录本段剧情引起的台账变化：',
    '```json',
    '  "timeTag": "故事内时间推进（如：第3日黄昏；无变化则空串）",',
    '  "items":  [{ "name": "物品名", "owner": "持有者角色名|scene|lost", "location": "carried|地点名", "note": "≤60字变化" }],',
    '  "npcs":   [{ "name": "NPC名", "status": "present|away|dead", "state": "≤60字现状", "role": "身份（首次登场才填）" }],',
    '  "scenes": [{ "name": "地点名", "parent": "上级地点（首次出现才填）" }],',
    '  "plans":  [{ "text": "悬念/约定原文", "resolution": "了结方式（仅了结时填）" }],',
    '  "protagonist": { "status": "主角当前客观状态 ≤120字（有变化才填）" }',
    '```',
    '规则：只记**本段原文实际发生**的变化；无变化的数组留空 []；',
    '数字（时间/数量）原样保留；不臆测、不补写原文之外的内容。',
  ].join('\n')
}

/** 从模型回复中剥离 delta JSON 块（返回纯 markdown 正文 + 解析后的 delta）。
 *  解析失败/无 delta 块 ⇒ delta 返回空对象（fail-open：正文照常落盘，出声）。 */
export function splitSummaryAndDelta(raw: string): { text: string; delta: LeafDelta; deltaOk: boolean } {
  const raw1 = String(raw ?? '')
  const start = raw1.indexOf(DELTA_FENCE)
  if (start < 0) return { text: raw1.trim(), delta: {}, deltaOk: false }
  const text = raw1.slice(0, start).trim()
  const rest = raw1.slice(start + DELTA_FENCE.length)
  const nl = rest.indexOf('\n')
  const end = rest.indexOf('```', nl < 0 ? 0 : nl)
  if (end < 0) return { text: raw1.trim(), delta: {}, deltaOk: false }
  const body = rest.slice((nl < 0 ? 0 : nl + 1), end).trim()
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { text, delta: {}, deltaOk: false }
    }
    return { text, delta: parsed as LeafDelta, deltaOk: true }
  } catch {
    return { text, delta: {}, deltaOk: false }
  }
}

/** delta 出声日志（降级路径必须可见，P-30 家族：静默失败禁） */
export function deltaFallbackNote(sid: string, floor: number): string {
  return `[dsht-memory] ${sid} #${floor} delta JSON 解析失败 → 空 delta 降级（台账靠下轮摘要补齐）`
}
