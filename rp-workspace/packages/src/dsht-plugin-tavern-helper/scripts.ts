/**
 * 酒馆助手脚本执行沙箱——纯逻辑（可单测）。
 *
 * 最小可行方案：不 eval 任意 JS（Android WebView/node 里不跑不可信代码）。
 * 脚本以 JSON 描述注册，执行器按白名单 action 类型执行——覆盖酒馆助手
 * 最常见的"按条件改变量 / 插注释"用途。
 *
 * 脚本形状：
 *   { id, enabled?, trigger: {type, variable?, equals?}, actions: ScriptAction[] }
 * 白名单 action：
 *   - set-variable    {scope, path, value}         写变量树（值支持 {{path}} 插值）
 *   - delete-variable {scope, path}                删变量
 *   - insert-note     {text, depth?}               产出注释（由调用方决定注入位置）
 *   - log             {message}                    插件日志
 */

import { deepMergeVars, deleteByPath, getByPath, mergeAllScopes, setByPath } from './variables.ts'

/**
 * 变量作用域（P2#12 六作用域；对照 ST 酒馆助手 global/preset/character/chat/message/script）。
 * 前三层为共享文件层；preset/message/script 为会话持有层（session-store.ts 快照）。
 * action scope='script' 时不需调用方给 scriptId——落脚本自身 id 的私有树。
 */
export type VariableScope = 'global' | 'preset' | 'character' | 'chat' | 'message' | 'script'

export interface ScriptTrigger {
  /** manual：仅手动/HTTP 触发；on-variable-change：变量变化时；on-turn：每轮 */
  type: 'manual' | 'on-variable-change' | 'on-turn'
  /** on-variable-change：监视的变量路径（JSONPointer） */
  variable?: string
  /** on-variable-change：仅当新值等于该值时触发（缺省 = 任何变化） */
  equals?: unknown
}

export type ScriptAction =
  | { type: 'set-variable'; scope: VariableScope; path: string; value: unknown }
  | { type: 'delete-variable'; scope: VariableScope; path: string }
  | { type: 'insert-note'; text: string; depth?: number }
  | { type: 'log'; message: string }

export interface TavernScript {
  id: string
  enabled?: boolean
  trigger: ScriptTrigger
  actions: ScriptAction[]
}

/**
 * 执行时的变量树视图（执行器就地改副本，结果由调用方落盘）。
 * 前三个共享文件层必填（向后兼容）；preset/message/script 会话持有层可选
 * （无 sessionId 时调用方给不出，缺省按空树执行、结果不落盘）。
 * script 层 = 本脚本（script.id）的私有变量树。
 */
export interface ScriptScopeTrees {
  global: Record<string, unknown>
  character: Record<string, unknown>
  chat: Record<string, unknown>
  preset?: Record<string, unknown>
  message?: Record<string, unknown>
  script?: Record<string, unknown>
}

export interface ScriptRunResult {
  ok: boolean
  /** 执行后的变量树（set/delete-variable 已应用；含传入的会话持有层副本） */
  trees: ScriptScopeTrees
  /** insert-note 产出的注释（顺序保留） */
  notes: Array<{ text: string; depth: number }>
  logs: string[]
  error?: string
}

const ACTION_TYPES = new Set(['set-variable', 'delete-variable', 'insert-note', 'log'])
const SCOPES: VariableScope[] = ['global', 'preset', 'character', 'chat', 'message', 'script']

/** 脚本 JSON 校验（注册入口用；返回错误描述，null = 合法） */
export function validateScript(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'script must be object'
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || !s.id.trim()) return 'script.id required'
  const trigger = s.trigger as Record<string, unknown> | undefined
  if (!trigger || typeof trigger !== 'object') return 'script.trigger required'
  if (!['manual', 'on-variable-change', 'on-turn'].includes(String(trigger.type))) return `unknown trigger.type: ${String(trigger.type)}`
  if (trigger.type === 'on-variable-change' && typeof trigger.variable !== 'string') return 'on-variable-change requires trigger.variable'
  if (!Array.isArray(s.actions)) return 'script.actions must be array'
  for (const a of s.actions as Array<Record<string, unknown>>) {
    if (!a || typeof a !== 'object') return 'action must be object'
    if (!ACTION_TYPES.has(String(a.type))) return `unknown action.type: ${String(a.type)}`
    if ((a.type === 'set-variable' || a.type === 'delete-variable')) {
      if (!SCOPES.includes(a.scope as VariableScope)) return `action.scope must be one of ${SCOPES.join('/')}`
      if (typeof a.path !== 'string' || !a.path) return 'action.path required'
    }
    if ((a.type === 'insert-note' || a.type === 'log') && typeof (a.text ?? a.message) !== 'string') {
      return `action.${a.type === 'insert-note' ? 'text' : 'message'} required`
    }
  }
  return null
}

/** 值里的 {{path}} 插值：从三级合并视图取值（set-variable value 为字符串时生效） */
export function interpolateValue(value: unknown, merged: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, p: string) => {
    const v = getByPath(merged, String(p).startsWith('/') ? String(p) : `/${String(p).replaceAll('.', '/')}`)
    return v === undefined ? m : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** 触发判定：变量变化事件（oldValue→newValue）是否命中脚本 trigger */
export function triggerMatches(script: TavernScript, event: { type: 'manual' | 'on-variable-change' | 'on-turn'; variable?: string; newValue?: unknown }): boolean {
  if (script.enabled === false) return false
  const t = script.trigger
  if (t.type !== event.type) return false
  if (t.type === 'on-variable-change') {
    if (t.variable !== event.variable) return false
    if (t.equals !== undefined && t.equals !== event.newValue) return false
  }
  return true
}

/**
 * 执行脚本（白名单 action 顺序执行；单 action 出错即停并回报）。
 * 纯函数：trees 入参不被修改（各层先克隆）。
 */
export function runScript(script: TavernScript, trees: ScriptScopeTrees): ScriptRunResult {
  const next: Required<ScriptScopeTrees> = {
    global: structuredClone(trees.global),
    character: structuredClone(trees.character),
    chat: structuredClone(trees.chat),
    preset: structuredClone(trees.preset ?? {}),
    message: structuredClone(trees.message ?? {}),
    script: structuredClone(trees.script ?? {}),
  }
  const notes: Array<{ text: string; depth: number }> = []
  const logs: string[] = []
  /**
   * 每个 action 求值时的最新合并视图：
   * script > message > chat > character > preset > global（内层私有优先；script 含自身私有树）。
   */
  const mergedView = (): Record<string, unknown> =>
    deepMergeVars(
      mergeAllScopes({
        global: next.global,
        preset: next.preset,
        character: next.character,
        chat: next.chat,
        message: next.message,
      }),
      next.script,
    )
  for (const action of script.actions) {
    switch (action.type) {
      case 'set-variable':
        next[action.scope] = setByPath(next[action.scope], action.path, interpolateValue(action.value, mergedView()))
        break
      case 'delete-variable':
        next[action.scope] = deleteByPath(next[action.scope], action.path)
        break
      case 'insert-note':
        notes.push({ text: String(interpolateValue(action.text, mergedView())), depth: action.depth ?? 1 })
        break
      case 'log':
        logs.push(String(interpolateValue(action.message, mergedView())))
        break
    }
  }
  return { ok: true, trees: next, notes, logs }
}
