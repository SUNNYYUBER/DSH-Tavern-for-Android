/**
 * 消息搜索纯逻辑（PROJECT_PLAN §4.15「消息搜索：虚拟列表配套」数据面）。
 *
 * 数据源：POST /dsht-tavern-helper/chat/messages {sessionId} → { messages } 全量拉
 * 一次后本地过滤（facade.ts chatMessages：session.jsonl 流式投影出
 * {message_id, name, role, message}）。本文件不碰网络，只做可单测的纯函数：
 * - 大小写不敏感包含匹配（toLowerCase 折叠；中英文皆可）；
 * - 命中片段：第一个命中位置前后各 ~40 字（码点对齐，不切坏 emoji 代理对）；
 * - 全文高亮分段：展开完整消息时把命中词全部标出；
 * - 结果上限 50 条防长会话卡顿。
 *
 * 说明：toLowerCase 对个别字符（如土耳其 İ）可能改变字符串长度，此时 lower
 * 版本的 indexOf 偏移在原文上近似成立——片段边界可能差一个码元，可接受。
 */

/** 可搜索消息（chat/messages 投影的最小面；与 th-shim ThChatMessage 同形但解耦） */
export interface SearchableMessage {
  message_id: number
  name: string
  role: 'user' | 'assistant'
  message: string
}

/** 命中片段：命中词前的上下文 + 命中词 + 命中词后的上下文（顺序拼接即原文一段） */
export interface SearchSnippet {
  before: string
  match: string
  after: string
  /** 命中前的上下文被裁剪时为 true（UI 显示省略号） */
  headCut: boolean
  /** 命中后的上下文被裁剪时为 true */
  tailCut: boolean
}

/** 一条搜索结果：楼层号（message_id）+ 角色名 + 片段 */
export interface SearchHit {
  messageId: number
  name: string
  role: 'user' | 'assistant'
  snippet: SearchSnippet
}

/** 结果上限（防长会话渲染卡顿，PROJECT_PLAN「上限 50 条」） */
export const SEARCH_RESULT_LIMIT = 50
/** 命中片段：命中词前后各取的字符数（UTF-16 码元，中文字≈汉字数） */
export const SNIPPET_RADIUS = 40

/** i 的切点向左对齐到码点边界（落在低代理上则退到高代理前） */
function alignLow(text: string, i: number): number {
  if (i > 0 && i < text.length && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff) return i - 1
  return i
}

/** i 的切点向右对齐到码点边界（落在高代理后则进到低代理后） */
function alignHigh(text: string, i: number): number {
  if (i > 0 && i < text.length) {
    const prev = text.charCodeAt(i - 1)
    if (prev >= 0xd800 && prev <= 0xdbff) return i + 1
  }
  return i
}

/** 大小写不敏感地找第一个命中位置（码元级）；未命中返回 -1 */
export function firstHitIndex(text: string, lowerQuery: string): number {
  if (lowerQuery === '') return -1
  return text.toLowerCase().indexOf(lowerQuery)
}

/**
 * 命中位置 → 前后各 ~radius 字的片段。
 * hitIndex/matchLen 按 lower 版本计算，切点在原文上做码点对齐。
 */
export function extractSnippet(text: string, hitIndex: number, matchLen: number, radius: number = SNIPPET_RADIUS): SearchSnippet {
  const safeStart = Math.max(0, hitIndex)
  const safeEnd = Math.min(text.length, hitIndex + matchLen)
  const rawFrom = Math.max(0, safeStart - radius)
  const rawTo = Math.min(text.length, safeEnd + radius)
  const from = alignLow(text, rawFrom)
  const to = alignHigh(text, rawTo)
  return {
    before: text.slice(from, safeStart),
    match: text.slice(safeStart, safeEnd),
    after: text.slice(safeEnd, to),
    headCut: from > 0,
    tailCut: to < text.length,
  }
}

/**
 * 全量消息过滤：query 大小写不敏感匹配消息文本，按楼层序产出片段，上限 limit。
 * query 为空（未输入）返回 []——面板空态由组件按「无输入 / 无结果」区分。
 */
export function searchMessages(
  /**
   * 【心跳 47·T-34】放宽为 `| null`：函数体第一件事就是 `for (const m of messages ?? [])`，
   * **早已把 null 当空集处理**；而唯一的调用点（RpSearchPanel.tsx:62）传的正是
   * `SearchableMessage[] | null`（数据尚未拉回时为 null）。声明比实现更严 →
   * 忠实反映实现的调用点反而报 TS2345。按实际行为对齐契约。
   */
  messages: readonly SearchableMessage[] | null | undefined,
  query: string,
  limit: number = SEARCH_RESULT_LIMIT,
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const hits: SearchHit[] = []
  for (const m of messages ?? []) {
    const text = typeof m?.message === 'string' ? m.message : ''
    if (text === '') continue
    const idx = firstHitIndex(text, q)
    if (idx < 0) continue
    hits.push({
      messageId: m.message_id,
      name: m.name,
      role: m.role,
      snippet: extractSnippet(text, idx, q.length),
    })
    if (hits.length >= limit) break
  }
  return hits
}

/** 全文高亮分段（展开完整消息用）：顺序拼接各段的 t 即原文；hit 段套高亮样式 */
export function splitHighlight(text: string, query: string): Array<{ t: string; hit: boolean }> {
  const q = query.trim().toLowerCase()
  if (q === '') return [{ t: text, hit: false }]
  const out: Array<{ t: string; hit: boolean }> = []
  const lower = text.toLowerCase()
  let cursor = 0
  for (;;) {
    const idx = lower.indexOf(q, cursor)
    if (idx < 0) break
    if (idx > cursor) out.push({ t: text.slice(cursor, idx), hit: false })
    out.push({ t: text.slice(idx, idx + q.length), hit: true })
    cursor = idx + q.length
  }
  if (cursor < text.length) out.push({ t: text.slice(cursor), hit: false })
  return out.length > 0 ? out : [{ t: text, hit: false }]
}
