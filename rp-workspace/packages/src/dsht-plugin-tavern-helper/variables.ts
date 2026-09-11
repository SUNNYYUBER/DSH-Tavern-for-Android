/**
 * 酒馆助手变量作用域子系统——纯逻辑（可单测）。
 *
 * 三级作用域（ST 酒馆助手 getVariables 语义）：
 * - global：$DSH_HOME/rp/variables/global.json
 * - character：$DSH_HOME/rp/<slug>/variables.json
 * - chat：$DSH_HOME/rp/state/<sessionId>.json 的 variables 键
 *   （与 MVU chat_metadata.variables 同一棵树——ST 端 MVU 本就建在酒馆助手变量系统上）
 * 合并顺序：chat > character > global（深合并，浅层叶值高优先级覆盖）。
 *
 * 路径语法：JSONPointer（/a/b/c，~1→/、~0→~；空路径 = 整棵树）。
 */

import { deepMergeIncoming } from '../dsht-plugin-shared/deep-merge.ts'

/** JSONPointer 段解码 */
function decodeSeg(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~')
}

export function parsePath(path: string): string[] {
  return path.split('/').filter(s => s.length > 0).map(decodeSeg)
}

/** 按 JSONPointer 取值（路径不存在返回 undefined） */
export function getByPath(tree: Record<string, unknown>, path: string): unknown {
  let cur: unknown = tree
  for (const seg of parsePath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 按 JSONPointer 赋值（逐层建对象；返回新树，不改入参） */
export function setByPath(tree: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segs = parsePath(path)
  const next = structuredClone(tree)
  if (segs.length === 0) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : next // 根替换仅接受对象（变量树必须是 object）
  }
  let cur: Record<string, unknown> = next
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const existing = cur[seg]
    if (existing === undefined || existing === null || typeof existing !== 'object') cur[seg] = {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
  return next
}

/** 按 JSONPointer 删除（返回新树；路径不存在则原样） */
export function deleteByPath(tree: Record<string, unknown>, path: string): Record<string, unknown> {
  const segs = parsePath(path)
  if (segs.length === 0) return {}
  const next = structuredClone(tree)
  let cur: Record<string, unknown> = next
  for (let i = 0; i < segs.length - 1; i++) {
    const existing = cur[segs[i]]
    if (existing === null || typeof existing !== 'object') return next
    cur = existing as Record<string, unknown>
  }
  delete cur[segs[segs.length - 1]]
  return next
}

/**
 * 深合并（high 覆盖 low 的叶值；对象递归；数组/标量直接替换）—— **families-A**。
 *
 * 【T-35 收敛 2026-09-11】原为本文件内的一份独立实现，与 `th-shim.ts:deepMergeAssign`、
 * `dsht-plugin-mvu/index.ts:deepMerge` **逐字相同**（三份副本）。现三处统一引
 * `dsht-plugin-shared/deep-merge.ts` 的 `deepMergeIncoming`，此处仅保留对外名。
 */
export const deepMergeVars = deepMergeIncoming

/** 三级合并：global < character < chat */
export function mergeScopes(
  global: Record<string, unknown>,
  character: Record<string, unknown>,
  chat: Record<string, unknown>,
): Record<string, unknown> {
  return deepMergeVars(deepMergeVars(global, character), chat)
}

/**
 * 六层合并视图（P2#12 六作用域；对照 ST 酒馆助手变量优先级，低 → 高）：
 * global < preset < character < chat < message。
 * script 作用域为脚本私有（Host 按 scriptId 隔离持有），不进通用合并视图。
 * 缺省层传 {} 即可——空树合并恒等，无 preset/message 内容时与三级 mergeScopes 结果一致。
 */
export function mergeAllScopes(scopes: {
  global?: Record<string, unknown>
  preset?: Record<string, unknown>
  character?: Record<string, unknown>
  chat?: Record<string, unknown>
  message?: Record<string, unknown>
}): Record<string, unknown> {
  return deepMergeVars(
    deepMergeVars(
      deepMergeVars(deepMergeVars(scopes.global ?? {}, scopes.preset ?? {}), scopes.character ?? {}),
      scopes.chat ?? {},
    ),
    scopes.message ?? {},
  )
}
