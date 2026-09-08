/**
 * DSHTavern 正则引擎（M1 / T1.2，计划文档 §4.5 st-regex-scripts 知识条目）
 *
 * SillyTavern 正则脚本兼容（三时机 + placement + depth 过滤）：
 * - markdownOnly（仅显示）/ promptOnly（仅提示词）/ 两者皆否（永久改写，编辑保存时执行）
 * - placement：1=用户输入 2=AI输出 3=slash命令 5=世界书 6=推理内容（ST SCRIPT_TYPES）
 * - minDepth/maxDepth：按消息深度过滤
 * - substituteRegex：findRegex 的宏替换模式（0=RAW 不替换 1=ESCAPED 转义后替换）
 * - $1/$<name>/{{match}} 捕获组引用 + trimStrings 裁剪 + replaceString 二次宏求值（由调用方注入）
 */

/** 正则脚本数据（ST 兼容字段名保留，导入器直接映射） */
export interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  /** 命中后从结果中移除的片段 */
  trimStrings: string[]
  /** 作用位置：1=USER_INPUT 2=AI_OUTPUT 3=SLASH_COMMAND 5=WORLD_INFO 6=REASONING */
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  /** 消息编辑保存时也执行（permanent 时机） */
  runOnEdit: boolean
  /** findRegex 宏替换：0=RAW 1=ESCAPED 2=NONE */
  substituteRegex: number
  minDepth: number | null
  maxDepth: number | null
}

/** 正则作用位置常量（对齐 ST SCRIPT_TYPES） */
export const PLACEMENT = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const

/** 正则执行时机（三时机模型） */
export type RegexTiming = 'display' | 'prompt' | 'permanent'

/** 执行上下文：消息深度与宏替换回调（组装层调用时注入宏引擎） */
export interface RegexContext {
  /** 当前消息深度（0 = 最新）；null = 非消息上下文（如世界书内容） */
  depth: number | null
  /** findRegex 宏替换回调（substituteRegex 模式用；不传则 RAW） */
  substituteRegex?: (raw: string, escaped: boolean) => string
  /** replaceString 的宏求值回调（ST：replaceString 支持 {{macros}}） */
  substituteMacros?: (text: string) => string
}

/** 单脚本命中记录（组装 trace / 正则测试器 UI 消费） */
export interface RegexHit {
  scriptId: string
  scriptName: string
  count: number
}

export interface RegexRunResult {
  text: string
  hits: RegexHit[]
}

/** 按时机过滤脚本（disabled 永不执行） */
function activeScripts(scripts: RegexScript[], timing: RegexTiming): RegexScript[] {
  return scripts.filter(s => {
    if (s.disabled) return false
    if (timing === 'display') return s.markdownOnly
    if (timing === 'prompt') return s.promptOnly
    // permanent：两者皆否的脚本（"永久改写"）
    return !s.markdownOnly && !s.promptOnly
  })
}

/** placement 与 depth 过滤 */
function appliesTo(script: RegexScript, placement: number, depth: number | null): boolean {
  if (!script.placement.includes(placement)) return false
  if (depth === null) return true
  if (script.minDepth != null && depth < script.minDepth) return false
  if (script.maxDepth != null && depth > script.maxDepth) return false
  return true
}

/**
 * 执行一批正则脚本（同 ST：按数组顺序依次应用）。
 *
 * @param scripts 全部脚本（含 disabled——由内部过滤）
 * @param text 输入文本
 * @param timing 三时机
 * @param placement 作用位置（PLACEMENT 常量）
 * @param ctx 深度 + 宏回调
 */
export function runRegexScripts(
  scripts: RegexScript[],
  text: string,
  timing: RegexTiming,
  placement: number,
  ctx: RegexContext = { depth: null },
): RegexRunResult {
  const hits: RegexHit[] = []
  let current = text

  for (const script of activeScripts(scripts, timing)) {
    if (!appliesTo(script, placement, ctx.depth)) continue

    let patternSource = script.findRegex
    // substituteRegex：对 findRegex 做宏替换（1=ESCAPED 表示替换值要转义）
    if (script.substituteRegex === 1 && ctx.substituteRegex) {
      patternSource = ctx.substituteRegex(script.findRegex, true)
    } else if (script.substituteRegex === 2 && ctx.substituteRegex) {
      patternSource = ctx.substituteRegex(script.findRegex, false)
    }

    // ST 字面量形态 /pattern/flags 剥壳（真实数据全是这形态；flags 并入，g/m 为基线）
    let flags = 'gm'
    const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(patternSource)
    if (literal !== null && literal[1].length > 0) {
      patternSource = literal[1]
      const extra = literal[2].replace(/[^gimsuy]/g, '')
      flags = Array.from(new Set('gm' + extra)).join('')
    }

    let regex: RegExp
    try {
      regex = new RegExp(patternSource, flags)
    } catch {
      // 无效正则：跳过并记录（不吞整个文本）
      hits.push({ scriptId: script.id, scriptName: script.scriptName, count: -1 })
      continue
    }

    // 先计数（用干净的正则实例，避免 g-flag lastIndex 污染）
    const countRegex = new RegExp(patternSource, flags)
    const matches = current.match(countRegex)
    if (matches === null || matches.length === 0) continue

    let replaced = current.replace(regex, (...args) => {
      const match = args[0] as string
      let replacement = script.replaceString
      // 捕获组引用：$1..$9（JS 原生 replace 已处理 $N；这里处理 {{match}} 与命名引用 $<name>）
      replacement = replacement.replace(/\{\{match\}\}/g, match)
      // trimStrings：从替换结果中移除指定片段
      for (const t of script.trimStrings) replacement = replacement.split(t).join('')
      return replacement
    })

    // replaceString 的宏求值（ST：substituteParams 在 replace 后执行）
    if (ctx.substituteMacros) replaced = ctx.substituteMacros(replaced)

    if (replaced !== current) {
      hits.push({ scriptId: script.id, scriptName: script.scriptName, count: matches.length })
      current = replaced
    } else {
      // 替换结果与原文相同（如 trim 掉了改动）：仍记录命中（显示层需要知道）
      hits.push({ scriptId: script.id, scriptName: script.scriptName, count: matches.length })
    }
  }

  return { text: current, hits }
}

/**
 * ST 正则 JSON → RegexScript[] 导入映射（st-regex-scripts 知识条目的规则层核心）。
 * 容错：缺字段给 ST 默认值；id 缺失生成。
 */
export function importRegexScripts(raw: unknown): { scripts: RegexScript[]; warnings: string[] } {
  const warnings: string[] = []
  if (!Array.isArray(raw)) return { scripts: [], warnings: ['正则数据不是数组'] }
  const scripts: RegexScript[] = raw.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>
    if (typeof r.findRegex !== 'string' || r.findRegex === '') {
      warnings.push(`#${i}（${String(r.scriptName ?? '未命名')}）缺少 findRegex，已跳过`)
      return null
    }
    return {
      id: typeof r.id === 'string' ? r.id : `regex-${i}-${Date.now()}`,
      scriptName: typeof r.scriptName === 'string' ? r.scriptName : `未命名脚本 ${i}`,
      findRegex: r.findRegex,
      replaceString: typeof r.replaceString === 'string' ? r.replaceString : '',
      trimStrings: Array.isArray(r.trimStrings) ? (r.trimStrings as string[]) : [],
      placement: Array.isArray(r.placement) ? (r.placement as number[]) : [PLACEMENT.AI_OUTPUT],
      disabled: r.disabled === true,
      markdownOnly: r.markdownOnly === true,
      promptOnly: r.promptOnly === true,
      runOnEdit: r.runOnEdit === true,
      substituteRegex: typeof r.substituteRegex === 'number' ? r.substituteRegex : 0,
      minDepth: typeof r.minDepth === 'number' ? r.minDepth : null,
      maxDepth: typeof r.maxDepth === 'number' ? r.maxDepth : null,
    }
  }).filter((s): s is RegexScript => s !== null)
  return { scripts, warnings }
}
