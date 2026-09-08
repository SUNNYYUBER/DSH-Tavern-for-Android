/**
 * T2.7 补丁：SillyTavern completion 预设导入器（示例预设/可待等 → RP 预设表层）。
 *
 * ST 预设 JSON（OpenAI Settings/*.json）结构：
 * - prompts[]：全部条目（identifier/name/role/content/marker/injection_position/
 *   injection_depth/enabled…；enabled 以 prompt_order 内的为准）
 * - prompt_order[]：[{character_id, order: [{identifier, enabled}]}]——取通用档
 *   （character_id 最小者，ST 的 100001 档）作为生效顺序
 * - 采样参数全量映射（P1#7）：temperature/top_p/top_k/top_a/min_p/penalties/seed/
 *   openai_max_tokens/openai_max_context/stream_openai/custom_stopping_strings/
 *   logit_bias/reasoning_effort；宏变量（setvar 初值 + getvar/裸宏占位）登记进
 *   RPPreset.macros（对照 dsh-plugin-prompt-tool sillytavern.ts，MIT © Czerror）
 * - extensions.regex_scripts[]：预设内嵌正则（思维链美化等）→ 预设作用域正则文件
 *
 * 产物（用户定案「预设 = 行为指令包」的导入路径）：
 * - RPPreset：条目按 prompt_order 顺序平铺为 slots（开关语义 = ST 条目开关）；
 *   marker 槽位映射组装层动态位；injection_position=1 的条目带 depth。
 *   R3：ST 注释条目（〖…〗/【…】/===…=== 等组头）→ RPPreset.toggles 开关组，
 *   组内条目 = option（selected = ST enabled）；识别不到组头时按 enabled 分两组兜底。
 * - RegexScript[]：内嵌正则（写入 rp-presets/<id>/regex.json，mergedRegex 第三源）
 * - T3.3 重 agent 场景适配：path 判定为 agent 的 ST 预设（detectAgentComposition：
 *   名字标注 + 显式/subagent 编排关键词特征，对齐既有 isAgentPreset 契约）做三档归位——
 *   配置自查类条目折叠进 configSummary 槽补充文本（configSummaryExtra）、内心 OS/思维链
 *   类条目转 skillRef 槽 + pendingSkills（调用方落盘 $DSH_HOME/skills/<slug>/SKILL.md）、
 *   subagent 编排类条目登记 subagentHints（仅重 agent 路径消费，编译期忽略）；oneshot 预设零影响
 */

import type { RPPreset, PresetSlot, SlotType, ToggleGroup } from './schema.ts'
import { DEFAULT_BUDGET } from './schema.ts'
import type { RegexScript } from '../regex/engine.ts'

// ---------------------------------------------------------------------------
// ST 侧类型（最小面）
// ---------------------------------------------------------------------------

interface StPromptEntry {
  identifier?: string
  name?: string
  role?: string
  content?: string
  marker?: boolean
  system_prompt?: boolean
  injection_position?: number
  injection_depth?: number
  injection_order?: number
}

interface StPresetJson {
  prompts?: StPromptEntry[]
  prompt_order?: Array<{ character_id?: number; order?: Array<{ identifier?: string; enabled?: boolean }> }>
  temperature?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  openai_max_tokens?: number
  /** P1#7 补全：采样/生成参数全量面（对照 ST OpenAI Settings preset 字段） */
  min_p?: number
  top_a?: number
  repetition_penalty?: number
  seed?: number
  openai_max_context?: number
  stream_openai?: boolean
  /** ST 停止序列：字符串内嵌 JSON 数组（parseArrayString 形态），也兼容直接数组 */
  custom_stopping_strings?: unknown
  logit_bias?: unknown
  reasoning_effort?: string
  extensions?: { regex_scripts?: Array<Record<string, unknown>> }
}

/** ST marker identifier → 组装层 marker 槽（schema emptyPreset 的槽位名） */
const MARKER_MAP: Record<string, string> = {
  chatHistory: 'chatHistory',
  charDescription: 'charDesc',
  charPersonality: 'charPersonality',
  scenario: 'scenario',
  personaDescription: 'persona',
  worldInfoBefore: 'worldBefore',
  worldInfoAfter: 'worldAfter',
}

/** 稳定短哈希（FNV-1a 32bit → base36）——id 去重后缀 */
function hash36(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** 条目名 → 可读 slot id（原名直用——中文条目名是 UI 主识别面；超长截断） */
function nameSlug(name: string): string {
  return name.trim().slice(0, 40)
}

// ---------------------------------------------------------------------------
// R3 开关组重建：ST 用户用"注释条目"做分组（真实主预设实证：〖必读-创作准则〗
// 这类装饰命名、内容为空或是分组说明的条目充当组头，后跟该组条目）。
// ---------------------------------------------------------------------------

/** 组头装饰命名：〖…〗/【…】/〔…〕/「…」/『…』 或 ====… / ----… / ## … */
const HEADER_BRACKET_RE = /^[〖【〔「『〈]/
const HEADER_DECOR_RE = /^(?:={2,}|-{3,}|#{1,3}\s)/

/**
 * 判定 ST 条目是否为分组注释条目（组头）。
 * 命中其一即是：装饰性括号命名（分组说明内容也接受，不限长度）；
 * 分隔线命名且内容不长；内容为空/极短的短名条目。
 */
function isGroupHeader(p: StPromptEntry): boolean {
  if (p.marker === true) return false
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  if (!name) return false
  const content = typeof p.content === 'string' ? p.content.trim() : ''
  if (HEADER_BRACKET_RE.test(name)) return true
  if (HEADER_DECOR_RE.test(name) && content.length <= 200) return true
  return content.length <= 4 && name.length <= 30
}

/** 剥离组头装饰字符得到组显示名（剥不动则保留原名） */
function groupLabel(raw: string): string {
  const cleaned = raw
    .replace(/^[〖【〔「『〈\s=>\-#*～·]+/, '')
    .replace(/[〗】〕」』〉\s=<\-*#～·]+$/, '')
    .trim()
  return cleaned || raw.trim()
}

export interface StPresetImport {
  preset: RPPreset
  regex: RegexScript[]
  /** 跳过的条目数（无对应 marker 槽的 marker 条目等） */
  skipped: number
  /**
   * 任务 3：agent 编排型预设里提取出的独立模块化内容块（标题即能力名、内容是
   * 操作手册形态——通用规则见 extractSkillBlocks 头注）。仅 path='agent' 时非空。
   * dir 相对 $DSH_HOME（skills/preset-<id>/<块名>/）；调用方写 <dir>/SKILL.md。
   */
  skills: PresetSkillBlock[]
}

/** 提取出的预设技能块 */
export interface PresetSkillBlock {
  /** skill 目录（相对 $DSH_HOME）：skills/preset-<dirId>/<blockSlug> */
  dir: string
  /** SKILL.md frontmatter name（= 目录末段） */
  name: string
  /** 块显示名（ST 条目原名） */
  label: string
  /** SKILL.md 正文（操作手册内容，宏包装已拆） */
  content: string
}

// ---------------------------------------------------------------------------
// 任务 3：agent 预设的模块化内容块 → DSH skills
// ---------------------------------------------------------------------------

/** 操作手册形态判定（通用规则，不写死具体预设）：
 * 内容（拆掉 {{//}} 注释与 {{setvar::k::…}} 包装后）命中其一即是：
 * - 引用 skill 式资源路径：<名字>/references/<…>.md（ST agent 预设的"Agent 才读取 xx/references/yy.md"形态）
 * - 含能力声明头：# …SKILL：…（"NSFW_SKILL：NSFW风格=…"这类"标题即能力名"块）
 */
const SKILL_REF_PATH_RE = /[\w一-鿿-]+\/references\/[\w一-鿿./-]+\.md/i
const SKILL_HEADER_RE = /^#\s*\S*SKILL[：:]/m

/** 拆宏包装：{{// …}} 注释剥离；{{setvar::k::body}} → body（手册正文在 setvar 值里） */
export function unwrapMacroWrappers(content: string): string {
  let s = content.replace(/\{\{\/\/[^{}]*\}\}/g, '')
  s = s.replace(/\{\{setvar::([^{}]*)\}\}/g, (_m, inner: string) => {
    const at = inner.indexOf('::')
    return at >= 0 ? inner.slice(at + 2) : ''
  })
  return s.trim()
}

/** 预设/块名 → 目录安全段（[a-z0-9-] + 短哈希；与 agentPresetDirId 同规则的本地副本） */
function dirSafe(raw: string, maxLen: number): string {
  const safe = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen).replace(/^-+|-+$/g, '')
  const base = safe === '' ? 'block' : safe
  const head = /^[a-z0-9]/.test(base) ? base : `b-${base}`
  return `${head}-${hash36(raw).slice(0, 6)}`
}

/**
 * 提取 agent 预设里的独立模块化内容块 → DSH skill 文件集。
 * 范围：全部内容条目（非 marker、非组头注释条目；不看 enabled——开关只控制引用，
 * 手册本体必须在库里，开关打开时模型才读得到）。
 */
export function extractSkillBlocks(presetId: string, prompts: StPromptEntry[]): PresetSkillBlock[] {
  const out: PresetSkillBlock[] = []
  const usedDirs = new Set<string>()
  for (const p of prompts) {
    if (p.marker === true) continue
    if (isGroupHeader(p)) continue
    const raw = typeof p.content === 'string' ? p.content : ''
    if (!raw.trim()) continue
    const body = unwrapMacroWrappers(raw)
    if (!SKILL_REF_PATH_RE.test(body) && !SKILL_HEADER_RE.test(body)) continue
    const label = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : (p.identifier ?? 'block')
    let blockSlug = dirSafe(label, 24)
    let dir = `skills/preset-${dirSafe(presetId, 32)}/${blockSlug}`
    while (usedDirs.has(dir)) {
      blockSlug = `${blockSlug}-${hash36(p.identifier ?? label).slice(0, 4)}`
      dir = `skills/preset-${dirSafe(presetId, 32)}/${blockSlug}`
    }
    usedDirs.add(dir)
    out.push({ dir, name: blockSlug, label, content: body })
  }
  return out
}

/** skill 块 → SKILL.md 文本（frontmatter + 操作手册正文） */
export function renderPresetSkillMd(presetDisplayName: string, block: PresetSkillBlock): string {
  return [
    `---`,
    `name: ${block.name}`,
    `description: ${block.label}（ST agent 预设「${presetDisplayName}」迁移的模块化内容块；操作手册形态，按需读取）`,
    `whenToUse: 当前 RP 会话使用该预设且剧情触及「${block.label}」对应能力时，按本手册执行。`,
    `---`,
    ``,
    `# ${block.label}`,
    ``,
    block.content,
    ``,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// oneshot vs agent 预设区分（R16：「[Agent] V14.7 示例预设（TT agent 模式）」与
// 「[主预设] V17.1 示例预设（ST oneshot）」走不同适配路径）
// ---------------------------------------------------------------------------

/** 预设名标注：[Agent]/[代理]（含全角括号变体） */
const AGENT_NAME_RE = /[\[【]agent[\]】]|[\[【]代理[\]】]/i
/** 条目内容的多 agent 编排特征（subagent 编排 / TT agent 模式指令） */
const AGENT_CONTENT_RE = /subagent|sub-agent|multi-?agent|子代理|多\s*agent\s*编排/i

/**
 * 判定 ST 预设是否为 agent 编排型：名字标注或任一条目内容命中编排特征。
 * agent 型 → RPPreset.path = 'agent'（编排结构保留，供 T3.3 重 agent 适配器消费）；
 * 其余 → 'direct'（oneshot 单轮直出组装）。
 */
export function isAgentPreset(displayName: string, prompts: Array<{ content?: unknown }>): boolean {
  if (AGENT_NAME_RE.test(displayName)) return true
  return prompts.some(p => typeof p.content === 'string' && AGENT_CONTENT_RE.test(p.content))
}

// ---------------------------------------------------------------------------
// T3.3 重 agent 场景预设适配：三档归位（配置自查→configSummary 补充文本 /
// 内心 OS·思维链→skillRef+pendingSkills / subagent 编排→subagentHints 仅重路径）
// 真实样本标定：[Agent] V14.7 示例预设（TT agent 模式，条目引用 <能力>/references/<规则>.md
// 模块化规则文件）vs [主预设] V17.1 示例预设（ST oneshot，满屏内心OS/思维链条目但无
// 模块化引用）——归位只对 path 判定为 agent 的预设生效，oneshot 主预设保持平铺不动。
// ---------------------------------------------------------------------------

/** 三档归位档位（classifyStAgentEntry 产物） */
export type StAgentEntryTier = 'config' | 'innerOs' | 'subagent'

/**
 * 档①配置自查类：名称/identifier 关键词表（"自查/检查格式/输出前确认/rules check"
 * 类语义，含「SPreset配置」这类配置块命名）。
 */
const CONFIG_NAME_RE = /自查|格式自检|检查格式|格式检查|输出前确认|输出前自查|输出前检查|输出规则确认|rules?\s*check|self[-\s]?check|preflight|配置/i
/** 档①内容关键词（内容匹配仅对短条目生效：自查规则是紧凑指令，大块内容是正文/配置 JSON） */
const CONFIG_CONTENT_RE = /自查|格式自检|检查格式|格式检查|输出前确认|输出前自查|输出规则确认|rules?\s*check|self[-\s]?check/i
/** 内容侧判定的拆包后长度上限（真实样本实证：思考强度自查条目 150-450 字，破限长文 2 万字） */
const TIER_CONTENT_MAX = 4000

/**
 * 档②内心 OS/思维链类：名称关键词（内心/思维/think/OS）。ASCII 词带 \b 边界——
 * 防误伤 cost/position/Boss 等普通英文词；CJK 直接子串。
 */
const INNER_OS_NAME_RE = /内心|思维|思考链|\bthink|\bos\b/i
/** 档②内容强特征短语（裸「内心/思维」在正文里太常见——文风/人称条目普遍提及，只认复合词） */
const INNER_OS_CONTENT_RE = /思维链|内心\s*os|思考链/i

/** 档③subagent 编排类：名称关键词（编排分工命名，命中即归位） */
const SUBAGENT_NAME_RE = /\bplanner\b|\bwriter\b|\breviewer\b|\bsubagent\b|\bsub-agent\b|子代理|多代理|剧情分工|角色分工|角色扮演分工/i
/** 档③内容关键词（g 计数用：同一长文需 ≥2 次命中——破限伪代码偶现的单词不算编排） */
const SUBAGENT_CONTENT_RE = /\bplanner\b|\bwriter\b|\breviewer\b|\bsubagent\b|\bsub-agent\b|子代理|剧情分工|角色分工|角色扮演分工/gi
/** 档③内容判定的最小命中次数 */
const SUBAGENT_CONTENT_MIN_HITS = 2

/**
 * 三档归位判定（规则层，可单测）：agent 型 ST 预设的单个内容条目归入哪一档。
 * 返回 null = 常规条目（平铺 slots/toggles，导入行为与 T2.7/R3 一致）。
 * 优先级：配置自查 > subagent 编排 > 内心 OS（自查语义最具体；编排次之；思维链最泛）。
 * 判定基准：名称/identifier 关键词为主、内容关键词为辅——真实样本实证：正文里
 * 「内心」「think」等词大量出现在文风/人称/画图等无关条目中，只有名称是可靠语义标签。
 */
export function classifyStAgentEntry(p: { name?: unknown; identifier?: unknown; content?: unknown }): StAgentEntryTier | null {
  const label = `${typeof p.name === 'string' ? p.name : ''}\n${typeof p.identifier === 'string' ? p.identifier : ''}`
  const body = unwrapMacroWrappers(typeof p.content === 'string' ? p.content : '')
  // 档①配置自查：名称命中，或（短条目）拆宏后内容命中自查语义
  if (CONFIG_NAME_RE.test(label)) return 'config'
  if (body.length <= TIER_CONTENT_MAX && CONFIG_CONTENT_RE.test(body)) return 'config'
  // 档③subagent 编排：名称命中，或同一长文内编排词 ≥2 次
  if (SUBAGENT_NAME_RE.test(label)) return 'subagent'
  if ((body.match(SUBAGENT_CONTENT_RE)?.length ?? 0) >= SUBAGENT_CONTENT_MIN_HITS) return 'subagent'
  // 档②内心 OS/思维链：名称命中，或（短条目）内容命中复合短语
  if (INNER_OS_NAME_RE.test(label)) return 'innerOs'
  if (body.length <= TIER_CONTENT_MAX && INNER_OS_CONTENT_RE.test(body)) return 'innerOs'
  return null
}

/**
 * T3.3：ST 预设 agent 编排型判定（关键词密度/特征 → path 判 agent；导入入口用）。
 * 与既有判定对齐（isAgentPreset：名字标注 + 显式编排内容特征原样保留——既有的
 * 真实裁剪件契约是同一份内容按 [Agent]/[主预设] 名字分走两条路径，内容特征密度
 * 不单独翻 path，防止误伤 ST oneshot 主预设），另加一类特征：
 * - subagent 编排关键词（planner/writer/reviewer/子代理/角色分工）：名称命中即认；
 *   内容命中需同一长文 ≥2 次（真实样本实证：破限伪代码里偶现的 writer 单词不算编排）。
 */
export function detectAgentComposition(displayName: string, prompts: Array<{ name?: unknown; identifier?: unknown; content?: unknown }>): boolean {
  if (isAgentPreset(displayName, prompts)) return true
  for (const p of prompts) {
    const label = `${typeof p.name === 'string' ? p.name : ''}\n${typeof p.identifier === 'string' ? p.identifier : ''}`
    if (SUBAGENT_NAME_RE.test(label)) return true
    const body = unwrapMacroWrappers(typeof p.content === 'string' ? p.content : '')
    if ((body.match(SUBAGENT_CONTENT_RE)?.length ?? 0) >= SUBAGENT_CONTENT_MIN_HITS) return true
  }
  return false
}

/**
 * pendingSkill 名净化（"skill 名 = 槽 id 净化"：去换行、压空白、限长——
 * 名字进 SKILL.md frontmatter 与 skillRef 槽引用，须单行 YAML 安全）。
 */
export function sanitizeSkillName(raw: string): string {
  const s = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  return s || `skill-${hash36(raw).slice(0, 6)}`
}

/** pendingSkill → $DSH_HOME 相对目录（skills/<slug>；dirSafe 产出 ASCII 安全段 + 短哈希） */
export function pendingSkillDir(skillName: string): string {
  return `skills/${dirSafe(skillName, 48)}`
}

/**
 * pendingSkill → SKILL.md 占位落盘文本（frontmatter + 条目正文）。
 * "占位"：正文即原 ST 条目内容（内心 OS/思维链规则本体），DSH skill 机制按需读取；
 * 名字带引号写 frontmatter（中文名/冒号安全，双引号 YAML 标量）。
 */
export function renderPendingSkillMd(presetDisplayName: string, skill: { name: string; content: string }): string {
  return [
    `---`,
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(`ST agent 预设「${presetDisplayName}」三档归位的内心 OS/思维链规则（原条目正文，占位落盘；生成回复触及相应思维环节时按本规则执行）`)}`,
    `whenToUse: 当前 RP 会话使用该预设且需要内心 OS/思维链规则时读取。`,
    `---`,
    ``,
    `# ${skill.name}`,
    ``,
    skill.content,
    ``,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// P1#7：采样/生成参数完整映射 + 宏变量登记
// （对照 dsh-plugin-prompt-tool src/host/sillytavern.ts（MIT © Czerror）：
//   采样参数按字段全量剥离到 params 侧登记；L322 的"未定义宏登记"= 卡内引用但
//   无变量源的 {{key}} 以空值占位入登记册）
// ---------------------------------------------------------------------------

/** ST custom_stopping_strings → string[]（字符串内嵌 JSON 数组 / 直接数组 两种形态） */
function parseStStopSequences(raw: unknown): string[] | undefined {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return undefined
    try { arr = JSON.parse(t) } catch { return [t] } // 非 JSON 的裸字符串按单条停止序列收
  }
  if (!Array.isArray(arr)) return undefined
  const seqs = arr.filter((s): s is string => typeof s === 'string' && s.length > 0)
  return seqs.length > 0 ? seqs : undefined
}

/** ST logit_bias（[{text, value}]）→ 合法条目（text 字符串 + value 数值） */
function parseStLogitBias(raw: unknown): Array<{ text: string; value: number }> | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Array<{ text: string; value: number }> = []
  for (const e of raw) {
    if (e === null || typeof e !== 'object') continue
    const text = (e as Record<string, unknown>).text
    const value = (e as Record<string, unknown>).value
    if (typeof text === 'string' && typeof value === 'number' && Number.isFinite(value)) {
      out.push({ text, value })
    }
  }
  return out.length > 0 ? out : undefined
}

/** 宏名（setvar/getvar/裸宏共用）：字母数字 . _ - 与 CJK（对照参考实现的字符类） */
const MACRO_KEY = 'A-Za-z0-9_.一-鿿-'
const SETVAR_RE = new RegExp(`\\{\\{setvar::([${MACRO_KEY}]+)::([^}]*)\\}\\}`, 'g')
const GETVAR_RE = new RegExp(`\\{\\{getvar::([${MACRO_KEY}]+)(?:::([^}]*))?\\}\\}`, 'g')
const BARE_MACRO_RE = new RegExp(`\\{\\{([${MACRO_KEY}]+)\\}\\}`, 'g')

/** 已识别/运行时宏（不登记）：身份位、DSH 已知插值、ST 运行时指令与引擎运行时宏 */
const KNOWN_MACROS = new Set([
  'user', 'char', 'persona', 'group', 'model', 'cwd',
  'trim', 'noop', 'input',
  'lastusermessage', 'lastcharmessage', 'charifnotgroup',
])

/**
 * 宏变量登记：扫全部条目原文——
 * - {{setvar::k::v}} → k=v（ST 顺序求值，后者覆盖前者）；
 * - {{getvar::k}}/{{getvar::k::default}} → k 无 setvar 初值时登记 default ?? ''；
 * - 裸 {{key}}（非已知/运行时宏）→ 空值占位（未定义自定义宏登记，插值替换为空不留字面）。
 * 返回 null 表示无宏（不带 macros 字段）。
 */
export function registerStMacros(contents: string[]): Record<string, string> | null {
  const macros: Record<string, string> = {}
  const knownLower = new Set<string>()
  const has = (k: string): boolean =>
    knownLower.has(k.toLowerCase()) || Object.prototype.hasOwnProperty.call(macros, k)
  for (const text of contents) {
    SETVAR_RE.lastIndex = 0
    for (const m of text.matchAll(SETVAR_RE)) {
      const key = m[1]
      macros[key] = m[2]
      knownLower.add(key.toLowerCase())
    }
  }
  for (const text of contents) {
    GETVAR_RE.lastIndex = 0
    for (const m of text.matchAll(GETVAR_RE)) {
      const key = m[1]
      if (has(key)) continue
      const fallback = typeof m[2] === 'string' ? m[2] : ''
      macros[key] = fallback
      knownLower.add(key.toLowerCase())
    }
    BARE_MACRO_RE.lastIndex = 0
    for (const m of text.matchAll(BARE_MACRO_RE)) {
      const key = m[1]
      if (KNOWN_MACROS.has(key.toLowerCase()) || has(key)) continue
      macros[key] = ''
      knownLower.add(key.toLowerCase())
    }
  }
  return Object.keys(macros).length > 0 ? macros : null
}

/**
 * 解析一个 ST 预设 JSON → RP 预设表层 + 内嵌正则。
 * @param json ST 预设文件内容
 * @param displayName 预设显示名（默认取文件名）
 */
export function importStPreset(json: string, displayName: string): StPresetImport {
  const o = JSON.parse(json) as StPresetJson
  const prompts = Array.isArray(o.prompts) ? o.prompts : []
  const byId = new Map<string, StPromptEntry>()
  for (const p of prompts) {
    if (typeof p?.identifier === 'string') byId.set(p.identifier, p)
  }

  // 生效顺序：character_id 最小的档（ST 通用档 100001；示例预设实证）
  const orders = (o.prompt_order ?? [])
    .filter(po => Array.isArray(po.order))
    .sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity))
  const order = orders[0]?.order ?? []

  // R16/T3.3：oneshot vs agent 预设区分提前到条目遍历前——agent 编排型预设走三档
  // 归位（配置自查/内心 OS/subagent 编排条目不再平铺），判定规则见 detectAgentComposition
  const agent = detectAgentComposition(displayName, prompts)

  // T3.3 三档归位收集器（仅 agent 型预设填充；direct 预设恒为空、字段不入 preset）
  const configExtraParts: string[] = []
  const pendingSkills: Array<{ name: string; content: string }> = []
  const subagentHints: string[] = []
  const usedSkillNames = new Set<string>()
  let configSummaryPlaced = false

  const slots: PresetSlot[] = []
  const usedIds = new Set<string>()
  let skipped = 0

  // R3：分组状态。识别到组头时按组聚合；识别不到任何组头时退化按 enabled 分组。
  interface PendingGroup { label: string; options: ToggleGroup['options'] }
  const groups: PendingGroup[] = []
  let currentGroup: PendingGroup | null = null
  let sawHeader = false
  /** 全部内容条目（兜底分组用；组头不进） */
  const allOptions: ToggleGroup['options'] = []

  for (const item of order) {
    const p = item?.identifier !== undefined ? byId.get(item.identifier) : undefined
    if (!p) { skipped++; continue }
    const enabled = item.enabled === true
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : (p.identifier ?? 'entry')

    // marker 槽：映射组装层动态位；无对应物（dialogueExamples 等）跳过
    if (p.marker === true) {
      const markerId = p.identifier !== undefined ? MARKER_MAP[p.identifier] : undefined
      if (!markerId) { skipped++; continue }
      if (usedIds.has(markerId)) continue // marker 槽只留首个
      usedIds.add(markerId)
      slots.push({ id: markerId, type: 'marker', enabled })
      continue
    }

    // 内容槽：role 映射 + 深度注入（injection_position 1 = 绝对深度）
    let id = nameSlug(name)
    if (usedIds.has(id)) id = `${id}-${hash36(p.identifier ?? name).slice(0, 4)}`
    usedIds.add(id)
    const role = p.role === 'user' || p.role === 'assistant' ? p.role : 'system'
    const rawContent = typeof p.content === 'string' ? p.content : ''

    // T3.3 三档归位（仅 agent 编排型；组头注释条目不参与——分组结构保持 R3 语义）。
    // 命中档位的条目不再平铺为 system 槽 / toggle option：
    if (agent && !isGroupHeader(p)) {
      const tier = classifyStAgentEntry(p)
      if (tier === 'config') {
        // 档①配置自查 → configSummary 补充文本（§4.3：configSummary 槽是 harness 对
        // ST 思维链自查的架构性替代）。首个归位条目处补插 configSummary 槽承载；
        // 库语义不看 enabled（对照 extractSkillBlocks：本体入库，开关控制引用）。
        if (!configSummaryPlaced && !usedIds.has('configSummary')) {
          configSummaryPlaced = true
          slots.push({ id: 'configSummary', type: 'configSummary', enabled: true })
        }
        const body = unwrapMacroWrappers(rawContent).trim()
        if (body) configExtraParts.push(body)
        continue
      }
      if (tier === 'subagent') {
        // 档③subagent 编排 → 仅登记 hints（仅 T3.3 重 agent 路径消费，编译期忽略）
        subagentHints.push(name)
        continue
      }
      if (tier === 'innerOs') {
        // 档②内心 OS/思维链 → skillRef 槽（只留引用提示）+ pendingSkills
        //（正文入库；SKILL.md 占位落盘由调用方 /preset/import-st 做，那里有 dshHome）
        const body = unwrapMacroWrappers(rawContent).trim()
        if (!body) { skipped++; continue } // 空内容条目（ST 占位开关）无正文可迁移
        let skillName = sanitizeSkillName(id)
        if (usedSkillNames.has(skillName)) {
          skillName = sanitizeSkillName(`${id}-${hash36(p.identifier ?? name).slice(0, 4)}`)
        }
        usedSkillNames.add(skillName)
        pendingSkills.push({ name: skillName, content: body })
        slots.push({
          id,
          type: 'skillRef',
          skill: skillName,
          content: `「${name}」已归位为 skill「${skillName}」（${pendingSkillDir(skillName)}/SKILL.md）：需要该内心 OS/思维链规则时按 skill 机制调用`,
          enabled,
          role,
        })
        continue
      }
    }

    const slot: PresetSlot = {
      id,
      type: 'system' as SlotType,
      content: rawContent,
      enabled,
      role,
    }
    if (p.injection_position === 1 && typeof p.injection_depth === 'number') slot.depth = p.injection_depth
    slots.push(slot)

    // R3 分组聚合：组头开新组（组头自身留在 slots 保持原有平铺语义，不进 options）；
    // 普通条目进当前组（首个组头前的条目归入"未分组"）。
    if (isGroupHeader(p)) {
      sawHeader = true
      currentGroup = { label: groupLabel(name), options: [] }
      groups.push(currentGroup)
    } else {
      const option = { id, label: name, content: slot.content ?? '', selected: enabled }
      allOptions.push(option)
      if (currentGroup === null) {
        currentGroup = { label: '未分组', options: [] }
        groups.push(currentGroup)
      }
      currentGroup.options.push(option)
    }
  }

  // R3：生成 toggles。识别到组头 → 每组一个 ToggleGroup（空组丢弃）；
  // 未识别 → 按 enabled 分两组（全同状态时单组全量）。toggles 不得为空（有条目时）。
  let toggles: ToggleGroup[] = []
  if (sawHeader) {
    toggles = groups
      .filter(g => g.options.length > 0)
      .map((g, i) => ({ group: `g${i + 1}-${hash36(g.label).slice(0, 6)}`, label: g.label, multi: true, options: g.options }))
  }
  if (toggles.length === 0 && allOptions.length > 0) {
    const on = allOptions.filter(o => o.selected)
    const off = allOptions.filter(o => !o.selected)
    toggles = on.length > 0 && off.length > 0
      ? [
          { group: 'st-enabled', label: '已启用条目', multi: true, options: on },
          { group: 'st-disabled', label: '已停用条目', multi: true, options: off },
        ]
      : [{ group: 'st-all', label: '全部条目', multi: true, options: allOptions }]
  }

  // 采样参数映射（缺省保留 schema 默认；P1#7 补全 ST 生成参数全量面）
  const sampling: RPPreset['sampling'] = { temperature: 1, topP: 0.95 }
  if (typeof o.temperature === 'number') sampling.temperature = o.temperature
  if (typeof o.top_p === 'number') sampling.topP = o.top_p
  if (typeof o.top_k === 'number') sampling.topK = o.top_k
  if (typeof o.frequency_penalty === 'number') sampling.frequencyPenalty = o.frequency_penalty
  if (typeof o.presence_penalty === 'number') sampling.presencePenalty = o.presence_penalty
  if (typeof o.openai_max_tokens === 'number') sampling.maxTokens = o.openai_max_tokens
  if (typeof o.min_p === 'number') sampling.minP = o.min_p
  if (typeof o.top_a === 'number') sampling.topA = o.top_a
  if (typeof o.repetition_penalty === 'number') sampling.repetitionPenalty = o.repetition_penalty
  // ST seed = -1 表示随机（哨兵值，不入登记）
  if (typeof o.seed === 'number' && o.seed >= 0) sampling.seed = o.seed
  if (typeof o.openai_max_context === 'number') sampling.maxContext = o.openai_max_context
  if (typeof o.stream_openai === 'boolean') sampling.stream = o.stream_openai
  const stopSequences = parseStStopSequences(o.custom_stopping_strings)
  if (stopSequences !== undefined) sampling.stopSequences = stopSequences
  const logitBias = parseStLogitBias(o.logit_bias)
  if (logitBias !== undefined) sampling.logitBias = logitBias
  if (typeof o.reasoning_effort === 'string' && o.reasoning_effort.trim()) {
    sampling.reasoningEffort = o.reasoning_effort.trim()
  }

  // P1#7 宏变量登记（setvar 初值 + getvar/裸宏占位；运行期宏引擎 getvar 源补默认值）
  const macros = registerStMacros(
    prompts.map(p => (typeof p.content === 'string' ? p.content : '')),
  )

  // 内嵌正则 → 预设作用域脚本（字段对齐 RegexScript；缺省走 ST 官方默认）
  const regex: RegexScript[] = []
  const rs = o.extensions?.regex_scripts
  if (Array.isArray(rs)) {
    for (let i = 0; i < rs.length; i++) {
      const s = rs[i] as Record<string, unknown>
      const find = typeof s.findRegex === 'string' ? s.findRegex : ''
      const scriptName = typeof s.scriptName === 'string' ? s.scriptName : `regex-${i}`
      if (!find.trim()) { skipped++; continue } // 分隔条目（空 findRegex）
      regex.push({
        id: `rs-${i}-${hash36(scriptName).slice(0, 6)}`,
        scriptName,
        findRegex: find,
        replaceString: typeof s.replaceString === 'string' ? s.replaceString : '',
        trimStrings: Array.isArray(s.trimStrings) ? (s.trimStrings as string[]).filter(t => typeof t === 'string') : [],
        placement: Array.isArray(s.placement) ? (s.placement as number[]).filter(n => typeof n === 'number') : [2],
        disabled: s.disabled === true,
        markdownOnly: s.markdownOnly === true,
        promptOnly: s.promptOnly === true,
        runOnEdit: s.runOnEdit !== false,
        substituteRegex: typeof s.substituteRegex === 'number' ? s.substituteRegex : 0,
        minDepth: typeof s.minDepth === 'number' ? s.minDepth : null,
        maxDepth: typeof s.maxDepth === 'number' ? s.maxDepth : null,
      })
    }
  }

  // R16/T3.3：agent 判定已在条目遍历前完成（detectAgentComposition，见上方注释）
  const presetId = `st-${nameSlug(displayName)}-${hash36(displayName).slice(0, 6)}`
  // 任务 3：agent 编排型预设的模块化内容块 → DSH skills（操作手册形态条目；
  // 通用判定规则见 extractSkillBlocks，不写死具体预设）
  const skills = agent ? extractSkillBlocks(presetId, prompts) : []
  // T3.3 三档归位说明（仅 agent 型且有归位产物时追加，保持导入幂等——同输入同描述）
  const tierNote = configExtraParts.length + pendingSkills.length + subagentHints.length > 0
    ? `；三档归位：配置自查 ${configExtraParts.length} 条折叠进 configSummary 补充文本（configSummaryExtra）、内心 OS/思维链 ${pendingSkills.length} 条转 skillRef+待落盘 skill（skills/<slug>/SKILL.md）、subagent 编排 ${subagentHints.length} 条登记 subagentHints（仅重 agent 路径消费，编译期忽略）`
    : ''
  const preset: RPPreset = {
    schemaVersion: 1,
    id: presetId,
    displayName,
    description: agent
      ? `SillyTavern 预设迁移（类型：agent 编排型——适配 TT agent 模式，含 ${skills.length} 个技能块已转 DSH skills（skills/preset-*/<块名>/SKILL.md；P1#6 双轴分离：经同步的 DSH agent 预设 preset-capability 组挂载为模型可调用，与内容编排轴独立选择、组合生效），编排指令保留在预设编译文本；条目开关 = ST 预设开关，按 ST 注释条目重建开关组；内嵌正则已导入预设作用域${tierNote}）`
      : 'SillyTavern 预设迁移（类型：oneshot 单轮直出；条目开关 = ST 预设开关，按 ST 注释条目重建开关组；内嵌正则已导入预设作用域）',
    model: {},
    path: agent ? 'agent' : 'direct',
    toggles,
    slots,
    knowledge: { books: [], scanDepth: 2, budgetPercent: 25 },
    budget: { ...DEFAULT_BUDGET },
    sampling,
    ...(macros !== null ? { macros } : {}),
    // T3.3 三档归位产物（仅 agent 型；无归位时不带字段，direct 预设零影响）
    ...(configExtraParts.length > 0 ? { configSummaryExtra: configExtraParts.join('\n\n') } : {}),
    ...(pendingSkills.length > 0 ? { pendingSkills } : {}),
    ...(subagentHints.length > 0 ? { subagentHints } : {}),
  }
  return { preset, regex, skipped, skills }
}
