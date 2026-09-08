/**
 * T3.2 会话长期记忆（rp-memory 最小闭环，规则层无 LLM）——纯逻辑 + 薄 IO。
 *
 * 存储形状：$DSH_HOME/rp/memory/<sessionId>.json
 *   { entries: [{ id, text, source: 'agent'|'user', createdAt }] }
 *
 * 契约：
 * - 追加（saveMemory 前由路由先做 snapshotBeforeWrite 写前快照，本模块不管快照）：
 *   - id = `${Date.now().toString(36)}-${随机4}`；
 *   - text 必填非空（trim 后判空）、上限 2000 字（按 Unicode 码点计）；
 *   - 去抖：相同文本（trim 后全等）重复保存不重复入库，幂等命中已存在条目——
 *     防 agent 每轮把同一事实反复固化；
 *   - 上限 200 条，超出丢最旧（数组头部）。
 * - 检索：query 按空白切词，条目命中任一词即算；命中词数降序（同分取较新的），
 *   默认 limit 10。纯同步匹配，不走 LLM。
 * - 删除：按 id 删单条。
 * - 注入渲染：最近 20 条 → `- [YYYY-MM-DD HH:mm] 文本`（无记忆返回空串，不注入）。
 *
 * 拆成本文件的原因：路由 handler 与 registerPrefix 强耦合不好单测，核心逻辑
 * 全部收拢为纯函数（index.ts 只做参数校验与 IO 接线）。
 *
 * 打包：esbuild 内联（dsh-plugin bundle 时编入）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type MemorySource = 'agent' | 'user'

export interface MemoryEntry {
  /** `${Date.now().toString(36)}-${随机4}` */
  id: string
  /** 事实文本（trim 后存储） */
  text: string
  /** 来源：agent 主动固化 / 用户亲口所述 */
  source: MemorySource
  /** 入库时间戳（ms） */
  createdAt: number
}

export interface MemoryFile {
  entries: MemoryEntry[]
}

/** 条目上限：超出丢最旧 */
export const MEMORY_MAX_ENTRIES = 200
/** 单条文本长度上限（字，按 Unicode 码点计） */
export const MEMORY_TEXT_MAX = 2000
/** pre-step 注入条数（最近 N 条） */
export const MEMORY_SNAPSHOT_COUNT = 20

/** 会话记忆文件绝对路径 */
export function memoryFilePath(dshHome: string, sessionId: string): string {
  return join(dshHome, 'rp', 'memory', `${sessionId}.json`)
}

/** 会话记忆文件的 $DSH_HOME 相对路径（写前快照 snapshotBeforeWrite 用） */
export function memoryRelPath(sessionId: string): string {
  return `rp/memory/${sessionId}.json`
}

/**
 * sessionId 安全校验（路由 payload 直落文件名，防路径越界）：
 * 非空、无路径分隔符、无 ..、无首尾空白、长度 ≤ 120。
 */
export function isValidMemorySessionId(sessionId: string): boolean {
  return typeof sessionId === 'string'
    && sessionId.length > 0
    && sessionId.length <= 120
    && !sessionId.includes('/')
    && !sessionId.includes('\\')
    && !sessionId.includes('..')
    && sessionId !== '.'
    && sessionId.trim() === sessionId
}

/** source 归一：仅 'user' 保留，其余（含缺省）一律按 'agent' */
export function normalizeMemorySource(v: unknown): MemorySource {
  return v === 'user' ? 'user' : 'agent'
}

/** 条目 id：时间戳 36 进制 + 随机 4 位（同毫秒碰撞概率可忽略） */
export function makeMemoryId(now = Date.now()): string {
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')
  return `${now.toString(36)}-${rand}`
}

/**
 * 追加结果：ok=false 时 error 指明拒绝原因（empty/too-long）；
 * ok=true 且 duplicate=true 表示去抖命中（entry 指向已存在条目，文件不变）。
 */
export interface AppendMemoryResult {
  ok: boolean
  error?: 'empty' | 'too-long'
  duplicate?: boolean
  file: MemoryFile
  entry?: MemoryEntry
}

/**
 * 追加一条记忆（纯函数，不改入参）：trim → 校验 → 去抖 → 追加 → 200 条淘汰。
 * 调用方负责持久化（saveMemory）与写前快照（snapshotBeforeWrite）。
 */
export function appendMemory(
  file: MemoryFile,
  text: string,
  source: MemorySource,
  opts: { now?: number } = {},
): AppendMemoryResult {
  const t = text.trim()
  if (!t) return { ok: false, error: 'empty', file }
  if ([...t].length > MEMORY_TEXT_MAX) return { ok: false, error: 'too-long', file }
  // 去抖：同文本已存在则幂等命中，不重复入库
  const dup = file.entries.find(e => e.text === t)
  if (dup) return { ok: true, duplicate: true, file, entry: dup }
  const now = opts.now ?? Date.now()
  const entry: MemoryEntry = { id: makeMemoryId(now), text: t, source, createdAt: now }
  const all = [...file.entries, entry]
  // 上限淘汰：超出丢最旧（保持追加序，头部为最旧）
  const entries = all.length > MEMORY_MAX_ENTRIES ? all.slice(all.length - MEMORY_MAX_ENTRIES) : all
  return { ok: true, file: { entries }, entry }
}

/**
 * 读会话记忆（薄 IO）：文件缺失/损坏/形状不对 → 空记忆；逐条归一容错
 * （坏条目跳过、source/createdAt 兜底），保证注入与检索拿到干净形状。
 */
export async function loadMemory(dshHome: string, sessionId: string): Promise<MemoryFile> {
  if (!isValidMemorySessionId(sessionId)) return { entries: [] }
  try {
    const parsed = JSON.parse(await readFile(memoryFilePath(dshHome, sessionId), 'utf8')) as { entries?: unknown }
    if (!Array.isArray(parsed?.entries)) return { entries: [] }
    const entries: MemoryEntry[] = []
    for (const raw of parsed.entries) {
      const e = raw as Partial<MemoryEntry> | null
      if (!e || typeof e !== 'object') continue
      if (typeof e.id !== 'string' || !e.id) continue
      if (typeof e.text !== 'string' || !e.text.trim()) continue
      entries.push({
        id: e.id,
        text: e.text,
        source: normalizeMemorySource(e.source),
        createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0,
      })
    }
    return { entries }
  } catch {
    return { entries: [] }
  }
}

/** 写会话记忆（薄 IO，建目录）；调用方负责写前快照 */
export async function saveMemory(dshHome: string, sessionId: string, file: MemoryFile): Promise<void> {
  if (!isValidMemorySessionId(sessionId)) throw new Error('invalid sessionId')
  const path = memoryFilePath(dshHome, sessionId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(file), 'utf8')
}

/** 检索命中项（条目 + 命中词数） */
export interface MemoryHit extends MemoryEntry {
  /** 命中的查询词个数 */
  score: number
}

/**
 * 关键词检索（纯同步）：query 按空白切词（大小写不敏感），条目命中任一词即算；
 * 命中词数降序、同分取较新；默认 limit 10。空查询/无词 → 空数组。
 */
export function queryMemory(entries: MemoryEntry[], query: string, limit = 10): MemoryHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const hits: MemoryHit[] = []
  for (const e of entries) {
    const text = e.text.toLowerCase()
    const score = tokens.reduce((n, t) => (text.includes(t) ? n + 1 : n), 0)
    if (score > 0) hits.push({ ...e, score })
  }
  hits.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
  return hits.slice(0, Math.max(0, limit))
}

/** 删除单条（纯函数）：deleted=false 表示 id 不存在（文件不变） */
export function deleteMemoryEntry(file: MemoryFile, id: string): { file: MemoryFile; deleted: boolean } {
  const entries = file.entries.filter(e => e.id !== id)
  return { file: { entries }, deleted: entries.length !== file.entries.length }
}

/** 时间戳 → `YYYY-MM-DD HH:mm`（本地时区） */
export function formatMemoryTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * pre-step 注入渲染（纯函数）：取最近 N 条（默认 20，按追加序陈→新），
 * 每条 `- [YYYY-MM-DD HH:mm] 文本`；无记忆返回空串（调用方不注入）。
 */
export function renderMemorySnapshot(entries: MemoryEntry[], opts: { count?: number } = {}): string {
  const count = Math.max(0, opts.count ?? MEMORY_SNAPSHOT_COUNT)
  const recent = entries.slice(Math.max(0, entries.length - count))
  return recent.map(e => `- [${formatMemoryTime(e.createdAt)}] ${e.text}`).join('\n')
}
