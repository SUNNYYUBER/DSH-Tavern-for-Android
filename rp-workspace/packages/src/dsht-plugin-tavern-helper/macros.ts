/**
 * 酒馆助手宏引擎的路由侧胶水（/dsht-tavern-helper/macros/expand）。
 * 引擎本体是纯函数（../dsht-plugin-shared/macros.ts，dsh-plugin pre-step 同款内联）；
 * 本模块负责：身份解析（rp.json macros + rp/persona.json active）、三级作用域合并视图、
 * setvar 落盘（含 undo 日志）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  expandTavernMacros, readVarPath, hydrateCustomMacros,
  type TavernMacroResult,
} from '../dsht-plugin-shared/macros.ts'
import { appendUndoEntries, makeUndoEntry } from '../dsht-plugin-shared/undo.ts'
import { mergeScopes, setByPath } from './variables.ts'

export type MacroScope = 'global' | 'character' | 'chat'

/** 身份来源：rp.json macros（char/user）+ rp/persona.json active 条目（user 名与描述） */
export interface MacroIdentity {
  user: string
  char: string
  persona: string
}

/** 读 rp/persona.json 的 active 条目（无文件/无 active → 空） */
export async function loadActivePersona(dshHome: string): Promise<{ name: string; description: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, 'rp', 'persona.json'), 'utf8')) as {
      active?: unknown
      list?: Array<{ name?: unknown; description?: unknown }>
    }
    const list = Array.isArray(parsed.list) ? parsed.list : []
    const activeName = typeof parsed.active === 'string' ? parsed.active : null
    const hit = activeName !== null ? list.find(p => p?.name === activeName) : undefined
    if (!hit) return null
    return {
      name: String(hit.name ?? ''),
      description: typeof hit.description === 'string' ? hit.description : '',
    }
  } catch {
    return null
  }
}

/** 解析宏身份：char 取 rp/<slug>/rp.json 的 macros.char；user 优先 persona.json active，回落 rp.json macros.user */
export async function resolveIdentity(dshHome: string, slug: string): Promise<MacroIdentity> {
  let char = ''
  let macrosUser = ''
  if (slug) {
    try {
      const rp = JSON.parse(await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')) as {
        characterName?: unknown
        macros?: { char?: unknown; user?: unknown }
      }
      char = typeof rp?.macros?.char === 'string' && rp.macros.char ? rp.macros.char : String(rp?.characterName ?? '')
      macrosUser = typeof rp?.macros?.user === 'string' ? rp.macros.user : ''
    } catch { /* 无 rp.json */ }
  }
  const persona = await loadActivePersona(dshHome)
  return {
    user: persona?.name || macrosUser || '用户',
    char: char || '角色',
    persona: persona?.description ?? '',
  }
}

export interface ExpandRouteDeps {
  dshHome: string
  /** 三级作用域读取（index.ts 的 loadScope） */
  loadScope: (scope: MacroScope, slug: string, sessionId: string) => Promise<Record<string, unknown>>
  /** 三级作用域写入（index.ts 的 saveScope） */
  saveScope: (scope: MacroScope, slug: string, sessionId: string, tree: Record<string, unknown>) => Promise<void>
  /** 写前钩子（任务 1：文件快照；index.ts 注入，可空） */
  beforeSave?: (scope: MacroScope, slug: string, sessionId: string) => Promise<void>
}

/**
 * /macros/expand 的执行体：{text, slug?, sessionId?} → {result, writes}。
 * setvar 落盘作用域：chat（有 sessionId）> character（有 slug）> global。
 * 写前把旧值追加进 per-session undo 日志（有 sessionId 时；任务 4 回滚联动）。
 */
export async function runMacroExpand(
  deps: ExpandRouteDeps,
  input: { text: string; slug?: string; sessionId?: string },
): Promise<{ result: string; writes: Array<{ path: string; value: string }>; unknownMacros: string[] }> {
  const slug = input.slug ?? ''
  const sessionId = input.sessionId ?? ''
  // L1b：自定义宏水合（本插件 bundle 内联了独立引擎副本，注册表与 dsh-plugin 不同实例——
  // 展开前从 rp/macros.json 同步，保证 substitudeMacros 预览与生成期求值一致）
  try {
    const disk = JSON.parse(await readFile(join(deps.dshHome, 'rp', 'macros.json'), 'utf8')) as Record<string, string>
    hydrateCustomMacros(disk)
  } catch { /* 无自定义宏文件 = 正常 */ }
  const identity = await resolveIdentity(deps.dshHome, slug)
  const globalTree = await deps.loadScope('global', '', '')
  const characterTree = slug ? await deps.loadScope('character', slug, '') : {}
  const chatTree = sessionId ? await deps.loadScope('chat', '', sessionId) : {}
  const merged = mergeScopes(globalTree, characterTree, chatTree)
  const r: TavernMacroResult = expandTavernMacros(input.text, {
    user: identity.user,
    char: identity.char,
    persona: identity.persona,
    getVar: path => readVarPath(merged, path),
    // C2 类宏作用域读取：kind → 各自作用域树（preset 无独立落盘 → global 兜底；
    // chat/message 宏族 → chat 树），unknown 语义不变
    scopeGet: (kind, path) => {
      if (kind === 'character') return readVarPath(characterTree, path)
      if (kind === 'preset' || kind === 'global') return readVarPath(globalTree, path)
      return readVarPath(chatTree, path)
    },
    stableSeed: sessionId ? `rp-${sessionId}` : slug ? `rp-${slug}` : 'rp-global',
  })
  if (r.writes.length > 0) {
    const scope: MacroScope = sessionId ? 'chat' : slug ? 'character' : 'global'
    let tree = await deps.loadScope(scope, slug, sessionId)
    if (sessionId) {
      // undo 日志：连续写同一路径时旧值应来自逐条演进中的树——逐条应用同时逐条记录
      const seq = []
      let evolving = tree
      for (const w of r.writes) {
        seq.push(makeUndoEntry(scope, slug, w.path, evolving))
        evolving = setByPath(evolving, w.path, w.value)
      }
      await appendUndoEntries(deps.dshHome, sessionId, seq)
      tree = evolving
    } else {
      for (const w of r.writes) tree = setByPath(tree, w.path, w.value)
    }
    await deps.beforeSave?.(scope, slug, sessionId)
    await deps.saveScope(scope, slug, sessionId, tree)
  }
  return { result: r.text, writes: r.writes, unknownMacros: r.unknownMacros }
}
