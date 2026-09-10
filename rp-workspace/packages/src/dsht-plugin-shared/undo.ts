/**
 * DSHTavern 变量写撤销日志（第四轮任务 4：变量联动回滚）——纯逻辑 + 薄 IO。
 *
 * 契约：
 * - 日志文件：$DSH_HOME/rp/state/<sessionId>.undo.jsonl（每行一个 UndoEntry，append-only）
 * - 每次变量写路由（dsht-mvu variables/register、variables/patch；dsht-tavern-helper
 *   variables PUT/POST/DELETE、scripts/run、macros/expand 的 setvar 落盘）写前先记录旧值。
 * - /dsht-rp rp/session-rollback 截断聊天后回放：把 ts 晚于截断点的条目按时间倒序
 *   恢复 oldValue 到各自作用域，回放后截断日志（删掉已回放的条目）。
 * - 会话删除/重置（rp/import-reset 清空 rp/ 目录）时日志随 rp/state/ 一并清除。
 *
 * 打包：esbuild 内联（dsht-mvu / dsht-tavern-helper / dsh-plugin 各自 bundle 时编入）。
 */

import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readVarPath, writeVarPath, toPointer } from './macros.ts'
import { atomicWriteText } from './atomic-fs.ts'

export type UndoScope = 'global' | 'character' | 'chat'

export interface UndoEntry {
  /** 写入时间戳（回放截断点比较基准） */
  ts: number
  scope: UndoScope
  /** character 作用域的工作区 slug（其余作用域为空串） */
  slug: string
  /** JSONPointer 规范路径 */
  path: string
  /** 写前旧值（undefined = 写入前不存在；JSON 里序列化为 null 加 had 标记区分） */
  oldValue: unknown
  /** 写入前路径是否存在（区分"旧值就是 null"与"原本不存在"） */
  had: boolean
}

/** 撤销日志文件路径 */
export function undoLogPath(dshHome: string, sessionId: string): string {
  return join(dshHome, 'rp', 'state', `${sessionId}.undo.jsonl`)
}

/** 构造一条 undo 条目（读 tree 取旧值） */
export function makeUndoEntry(
  scope: UndoScope,
  slug: string,
  path: string,
  tree: Record<string, unknown>,
  ts: number = Date.now(),
): UndoEntry {
  const pointer = toPointer(path)
  const oldValue = readVarPath(tree, pointer)
  return { ts, scope, slug, path: pointer, oldValue: oldValue === undefined ? null : oldValue, had: oldValue !== undefined }
}

/** 追加 undo 条目（无条目不写文件） */
export async function appendUndoEntries(dshHome: string, sessionId: string, entries: UndoEntry[]): Promise<void> {
  if (!sessionId || entries.length === 0) return
  const file = undoLogPath(dshHome, sessionId)
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

/** 读取 undo 日志（坏行跳过；无文件 = 空） */
export async function readUndoLog(dshHome: string, sessionId: string): Promise<UndoEntry[]> {
  try {
    const text = await readFile(undoLogPath(dshHome, sessionId), 'utf8')
    const out: UndoEntry[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as UndoEntry
        if (typeof e?.ts === 'number' && typeof e?.path === 'string' && typeof e?.scope === 'string') out.push(e)
      } catch { /* 坏行跳过 */ }
    }
    return out
  } catch {
    return []
  }
}

/** 删除 undo 日志（会话删除/重置时调用方清理） */
export async function clearUndoLog(dshHome: string, sessionId: string): Promise<void> {
  await rm(undoLogPath(dshHome, sessionId), { force: true })
}

/** 树 → 叶值清单（JSONPointer + 值；对象递归，数组/标量为叶） */
function flattenLeaves(tree: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  for (const [k, v] of Object.entries(tree)) {
    const key = `${prefix}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenLeaves(v as Record<string, unknown>, key))
    } else {
      out.push([key, v])
    }
  }
  return out
}

/**
 * 两棵变量树的差异 → undo 条目集（整树写入场景用：register/replace/scripts run）。
 * 以 after 的叶为准逐叶记旧值；after 里被删的键也记（oldValue=before 值，回放恢复）。
 */
export function diffUndoEntries(
  scope: UndoScope,
  slug: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ts: number = Date.now(),
): UndoEntry[] {
  const entries: UndoEntry[] = []
  const beforeFlat = new Map(flattenLeaves(before))
  const afterFlat = new Map(flattenLeaves(after))
  for (const [path, value] of afterFlat) {
    const old = beforeFlat.get(path)
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(value)) continue // 未变
    entries.push({ ts, scope, slug, path, oldValue: old === undefined ? null : old, had: old !== undefined })
  }
  for (const [path, old] of beforeFlat) {
    if (!afterFlat.has(path)) entries.push({ ts, scope, slug, path, oldValue: old, had: true })
  }
  return entries
}

// ---------------------------------------------------------------------------
// 作用域树 IO（回放用；与 dsht-plugin-tavern-helper 的三级作用域文件布局同款）
// ---------------------------------------------------------------------------

async function loadScopeTree(dshHome: string, scope: UndoScope, slug: string, sessionId: string): Promise<Record<string, unknown>> {
  const file = scope === 'global'
    ? join(dshHome, 'rp', 'variables', 'global.json')
    : scope === 'character'
      ? join(dshHome, 'rp', slug, 'variables.json')
      : join(dshHome, 'rp', 'state', `${sessionId}.json`)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (scope === 'chat') {
      const vars = (parsed as { variables?: unknown })?.variables
      return vars && typeof vars === 'object' && !Array.isArray(vars) ? vars as Record<string, unknown> : {}
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function saveScopeTree(dshHome: string, scope: UndoScope, slug: string, sessionId: string, tree: Record<string, unknown>): Promise<void> {
  const file = scope === 'global'
    ? join(dshHome, 'rp', 'variables', 'global.json')
    : scope === 'character'
      ? join(dshHome, 'rp', slug, 'variables.json')
      : join(dshHome, 'rp', 'state', `${sessionId}.json`)
  if (scope === 'chat') {
    let whole: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (parsed && typeof parsed === 'object') whole = parsed as Record<string, unknown>
    } catch { /* 新会话状态文件 */ }
    whole.variables = tree
    await mkdir(dirname(file), { recursive: true })
    // 【2026-09-08 鲁棒性】rp/state/<sid>.json 是 MVU 变量树权威落点，undo 回放 ×
    // MVU register × 脚本变量写并发裸写 = 文件撕裂（项目实锤教训）；原子写发布。
    await atomicWriteText(file, JSON.stringify(whole))
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await atomicWriteText(file, JSON.stringify(tree))
}

/**
 * 回放 undo 日志：把 ts > cutoffTs 的写入按时间倒序恢复旧值（同一路径多次写入时，
 * 倒序保证最终回到截断点之前的最早旧值）。回放后截断日志（仅保留* 回放后截断日志（仅保留 ts <= cutoffTs 的条目）。
 * 返回恢复条数。cutoffTs 缺省 -∞（全部条目都回放，日志清空）。
 */
export async function replayUndoLog(
  dshHome: string,
  sessionId: string,
  cutoffTs: number = Number.NEGATIVE_INFINITY,
): Promise<{ restored: number }> {
  const entries = await readUndoLog(dshHome, sessionId)
  const toReplay = entries.filter(e => e.ts > cutoffTs).sort((a, b) => b.ts - a.ts)
  if (toReplay.length === 0) {
    // 无需回放也要把日志里 > cutoff 的残留清掉（无），直接返回
    return { restored: 0 }
  }
  // 按作用域聚合树，逐条回放后一次性落盘
  const trees = new Map<string, { scope: UndoScope; slug: string; tree: Record<string, unknown>; dirty: boolean }>()
  const keyOf = (e: UndoEntry): string => `${e.scope}:${e.slug}`
  for (const e of toReplay) {
    const key = keyOf(e)
    let bucket = trees.get(key)
    if (!bucket) {
      bucket = { scope: e.scope, slug: e.slug, tree: await loadScopeTree(dshHome, e.scope, e.slug, sessionId), dirty: false }
      trees.set(key, bucket)
    }
    // 恢复旧值：原本不存在 → 写回 undefined 语义 = 删除键（writeVarPath 写 undefined
    // 会留 "key": undefined，JSON.stringify 时键消失——等价删除，可接受）
    bucket.tree = writeVarPath(bucket.tree, e.path, e.had ? e.oldValue : undefined)
    bucket.dirty = true
  }
  for (const bucket of trees.values()) {
    if (bucket.dirty) await saveScopeTree(dshHome, bucket.scope, bucket.slug, sessionId, bucket.tree)
  }
  // 截断日志：只留 ts <= cutoffTs 的条目（原子写——截断与并发 appendUndoEntries 竞态
  // 时裸 writeFile 可把日志写成撕裂尾，后续 readUndoLog 坏行跳过会静默丢撤销条目）
  const kept = entries.filter(e => e.ts <= cutoffTs)
  const file = undoLogPath(dshHome, sessionId)
  if (kept.length === 0) await rm(file, { force: true })
  else await atomicWriteText(file, kept.map(e => JSON.stringify(e)).join('\n') + '\n')
  return { restored: toReplay.length }
}
