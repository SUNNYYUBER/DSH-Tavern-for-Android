/**
 * DSHTavern RP 预设表层 schema 与类型（M1 / T1.9，计划文档 §4.3）
 *
 * preset.json = 玩家/UI 编辑格式（表层）；编译到 DSH preset 目录（里层）由编译器负责。
 * 组装器（slots → messages）消费本 schema 的编译期展开产物。
 */

/** 生成路径（§3.2 三条 + agent：ST [Agent] 编排预设迁移标注，供 T3.3 重 agent 适配器消费） */
export type GenerationPath = 'direct' | 'lightAgent' | 'heavyAgent' | 'agent'

/** 槽位类型 */
export type SlotType =
  | 'system'      // 固定 system 内容
  | 'marker'      // 标记槽（worldBefore/charDesc/chatHistory 等组装层填充）
  | 'skillRef'    // 引用 skill 文档
  | 'state'       // 会话状态摘要注入（MVU stat_data 等）
  | 'configSummary' // 配置摘要（§4.3：harness 对 ST 思维链自查的架构性替代）

/** 有序槽位（ST prompt_order 的对应物） */
export interface PresetSlot {
  id: string
  type: SlotType
  /** system/skillRef 的内容或 skill 名 */
  content?: string
  /** skillRef 引用的 skill 名 */
  skill?: string
  enabled: boolean
  /** 绝对深度注入（相对 system 顶部的深度） */
  depth?: number
  /** 条件槽位：state 满足条件才启用（EJS 条件注入的替代，§4.4） */
  condition?: { path: string; equals?: unknown; notEquals?: unknown; exists?: boolean }
  role?: 'system' | 'user' | 'assistant'
}

/** 开关组（ST 豪华预设核心交互，V8.8 实证）
 * 默认"选一"语义：恰好一个 selected（缺省取第一个）；
 * multi=true 为多选组（ST 预设迁移：每个 ST 条目 = 一个 option，
 * selected = ST enabled，编译期展开全部 selected 项）。
 */
export interface ToggleGroup {
  group: string
  label: string
  /** 多选组（缺省 false = 选一） */
  multi?: boolean
  options: Array<{
    id: string
    label: string
    /** 选中后注入的内容（编译期展开进 slots） */
    content: string
    selected?: boolean
  }>
}

/** 预算约束（TT 常量起步，RP 场景收紧，§4.3） */
export interface PresetBudget {
  maxToolRounds: number
  maxCallsPerRun: number
  delegationMaxPerRun: number
  delegationResultBudgetTokens: number
  modelRetry: { maxRetries: number; intervalMs: number }
}

export interface PresetSampling {
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  maxTokens?: number
  /** ST min_p（min-p 采样阈值） */
  minP?: number
  /** ST top_a（top-a 采样阈值） */
  topA?: number
  /** ST repetition_penalty（重复惩罚，text-completion 系） */
  repetitionPenalty?: number
  /** ST seed（-1 = 随机，不入登记；>=0 才映射） */
  seed?: number
  /** ST openai_max_context（上下文窗口上限） */
  maxContext?: number
  /** ST stream_openai（流式输出开关） */
  stream?: boolean
  /** ST custom_stopping_strings（JSON 字符串内嵌数组）→ 停止序列 */
  stopSequences?: string[]
  /** ST logit_bias（[{text, value}]；数值非法的条目在导入期丢弃） */
  logitBias?: Array<{ text: string; value: number }>
  /** ST reasoning_effort（推理强度档位，原样透传字符串） */
  reasoningEffort?: string
}

/** 知识库挂载配置 */
export interface PresetKnowledge {
  books: string[]
  scanDepth: number
  budgetPercent: number
}

/** 预设表层 schema（§4.3 草案的代码化） */
export interface RPPreset {
  schemaVersion: 1
  id: string
  displayName: string
  description?: string
  model: { connectionRef?: string; modelId?: string }
  path: GenerationPath
  toggles: ToggleGroup[]
  slots: PresetSlot[]
  knowledge: PresetKnowledge
  budget: PresetBudget
  sampling: PresetSampling
  /**
   * P1#7 宏变量登记：ST 预设条目里的 {{setvar::k::v}} 初值 + {{getvar::k}}/裸 {{key}}
   * 的空值占位。key = 宏名，value = setvar 初值或 getvar fallback 或 ''。
   * 运行期宏引擎（expandTavernMacros getvar 源）据此补默认值；无宏预设缺省不带本字段。
   */
  macros?: Record<string, string>
  /**
   * T3.3 三档归位产物①：配置自查类条目的折叠补充文本。来源：st-import 对 path 判定
   * 为 agent 的 ST 预设导入（T3.3 重 agent 场景适配）——「输出前自查/检查格式/rules
   * check/SPreset配置」类条目不再平铺为常规槽（§4.3 定案：configSummary 槽是 harness
   * 对 ST 思维链自查的架构性替代），内容按 prompt_order 顺序拼接于此，并在首个归位
   * 条目处补插一个 configSummary 槽承载。消费方：compileSlots 展开 configSummary 槽时
   * 拼进 CompiledSlot.content（组装层确定性摘要之后追加注入）；无归位产物时缺省不带本字段。
   */
  configSummaryExtra?: string
  /**
   * T3.3 三档归位产物②：内心 OS/思维链类条目 → 待落盘 skill。来源：st-import 导入
   * （对应条目转为 skillRef 槽位，slot.skill = name，槽内只留引用提示）。name = 槽 id
   * 净化（sanitizeSkillName），content = 拆宏后的条目正文。消费方：/preset/import-st
   * 落盘 $DSH_HOME/skills/<slug>/SKILL.md（目录由 pendingSkillDir 求出），DSH skill
   * 机制按需注入；编译期不展开正文。库语义对照 extractSkillBlocks（不看 ST enabled——
   * 开关只控制 skillRef 槽引用，手册本体必须在库里）。
   */
  pendingSkills?: Array<{ name: string; content: string }>
  /**
   * T3.3 三档归位产物③：subagent 编排类条目登记（plot-planner/writer/reviewer/
   * 角色分工等编排条目名）。仅 T3.3 重 agent 路径消费（完整 agent loop + 原生
   * subagent 编排：plot-planner/writer/reviewer，DSH 不实现自有 delegation）；
   * 编译期忽略（不进 slots/toggles，不进 prompt）。也作为 agent 编排型预设的
   * 判定特征之一（detectAgentComposition）。
   */
  subagentHints?: string[]
}

export const DEFAULT_BUDGET: PresetBudget = {
  maxToolRounds: 2,
  maxCallsPerRun: 8,
  delegationMaxPerRun: 8,
  delegationResultBudgetTokens: 8000,
  modelRetry: { maxRetries: 3, intervalMs: 3000 },
}

/** 直答型示范预设的骨架（T1.10 的基础） */
export function emptyPreset(id: string, displayName: string): RPPreset {
  return {
    schemaVersion: 1,
    id,
    displayName,
    model: {},
    path: 'direct',
    toggles: [],
    slots: [
      { id: 'main', type: 'system', content: '', enabled: true },
      { id: 'worldBefore', type: 'marker', enabled: true },
      { id: 'charDesc', type: 'marker', enabled: true },
      { id: 'charPersonality', type: 'marker', enabled: true },
      { id: 'scenario', type: 'marker', enabled: true },
      { id: 'persona', type: 'marker', enabled: true },
      { id: 'stateSummary', type: 'state', enabled: true },
      { id: 'configSummary', type: 'configSummary', enabled: true },
      { id: 'chatHistory', type: 'marker', enabled: true },
      { id: 'worldAfter', type: 'marker', enabled: true },
      { id: 'jb', type: 'system', content: '', enabled: true, depth: 2 },
    ],
    knowledge: { books: [], scanDepth: 2, budgetPercent: 25 },
    budget: { ...DEFAULT_BUDGET },
    sampling: { temperature: 1, topP: 0.95 },
  }
}

/**
 * 编译期展开：toggles 选中项 → 注入内容条目（与 slots 合并的中间形态）。
 * - 选一组（缺省）：恰好一个 selected（缺省取第一个）；
 * - 多选组（multi=true，ST 迁移预设）：展开全部 selected 项
 *   （selected = ST enabled，与平铺 slots.enabled 的"启用进 prompt、停用不进"
 *   语义等价；全停用的组不产出，不会误注入停用条目内容）。
 */
export interface CompiledSlot {
  id: string
  type: SlotType
  content: string
  depth?: number
  role: 'system' | 'user' | 'assistant'
  condition?: PresetSlot['condition']
  /** 来源（trace）：slot / toggle:<group>/<option> */
  source: string
}

export function compileSlots(preset: RPPreset): CompiledSlot[] {
  const out: CompiledSlot[] = []
  // 【⑧修复 2026-09-05】slot/toggle 双份注入去重——同一启用条目在 slots 和 toggles
  // 都产出时，toggle 侧跳过（slots 的 depth/role/condition 语义更完整，优先保留）
  const seenContent = new Set<string>()

  for (const slot of preset.slots) {
    if (!slot.enabled) continue
    // T3.3：configSummary 槽展开时拼接配置自查补充文本（configSummaryExtra，
    // ST agent 预设三档归位产物①——组装层 buildConfigSummary 产出确定性摘要后
    // 以槽内容追加注入；无该字段的预设 content 维持空串，行为不变）
    let content = slot.content ?? ''
    if (slot.type === 'configSummary') {
      const extra = preset.configSummaryExtra?.trim()
      if (extra) content = content.trim() ? `${content.trim()}\n\n${extra}` : extra
    }
    // 条件槽位：无条件时收起（运行期组装时再验——这里保留声明）
    const trimmed = content.trim()
    if (trimmed !== '' && seenContent.has(trimmed)) continue
    if (trimmed !== '') seenContent.add(trimmed)
    out.push({
      id: slot.id,
      type: slot.type,
      content,
      depth: slot.depth,
      role: slot.role ?? 'system',
      condition: slot.condition,
      source: `slot:${slot.id}`,
    })
  }

  for (const group of preset.toggles) {
    if (group.multi === true) {
      // 多选组：全部 selected 项展开
      for (const option of group.options) {
        if (!option.selected) continue
        const trimmed = option.content.trim()
        if (trimmed !== '' && seenContent.has(trimmed)) continue
        if (trimmed !== '') seenContent.add(trimmed)
        out.push({
          id: `toggle-${group.group}-${option.id}`,
          type: 'system',
          content: option.content,
          role: 'system',
          source: `toggle:${group.group}/${option.id}`,
        })
      }
      continue
    }
    // 选一组：恰好一个 selected（缺省取第一个）
    const selected = group.options.find(o => o.selected) ?? group.options[0]
    if (!selected) continue
    const trimmed = selected.content.trim()
    if (trimmed !== '' && seenContent.has(trimmed)) continue
    if (trimmed !== '') seenContent.add(trimmed)
    out.push({
      id: `toggle-${group.group}`,
      type: 'system',
      content: selected.content,
      role: 'system',
      source: `toggle:${group.group}/${selected.id}`,
    })
  }

  return out
}
