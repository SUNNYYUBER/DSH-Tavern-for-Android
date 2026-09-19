/**
 * token 上下文进度条纯逻辑。
 *
 * ## 这个数字是给用户看的，所以口径必须诚实
 * 用户实测（2026-09-14）看到 `≈ 1.1M / 16.4k tokens` —— 分子分母都不可信：
 *   ① 分母固定 16384（`sampling.maxContext` 拉不到就兜底），而真实模型上下文远超此值；
 *   ② 分子只按「字符数 ÷ 2.5」估，不含系统提示 / 世界书 / 工具定义 / 预设注入；
 *   ③ 被回退移出上下文的消息**仍被计入**（回退不生效在计量上再暴露一次）。
 *
 * 设计原则（F4 / P-6 计量可信度）：
 *   **错的口径比没有更糟** —— 凡是展示给用户的数字，必须能说清「这个数是哪来的、
 *   可信到什么程度」。因此本模块把「口径」做成一等公民：
 *     · `MeterOrigin` 标注数据来源与可信度，UI 必须原样展示；
 *     · 预算缺失时**不假装准确**，显式回落到「未知」并允许 UI 提示。
 *
 * 本文件只放可单测的纯函数。
 */

/** 字符→token 粗估系数：~2.5 char/token（中英混合对话的折中经验值） */
export const CHARS_PER_TOKEN = 2.5
/**
 * 预算兜底值：仅当**任何**真实来源都拿不到时使用。
 * 【2026-09-14 F4】语义变化：以前它是「缺省预算」（当作准确值用），
 * 现在它是「未知预算的占位」——UI 必须据此标明「预算未知」，
 * 不得让它看起来像模型真实能力。
 */
export const DEFAULT_MAX_CONTEXT = 16384
/** 占用分级阈值：≥70% 黄（告警）、≥90% 红（危险） */
export const WARN_RATIO = 0.7
export const DANGER_RATIO = 0.9

/**
 * 计量口径标签（UI 必须展示，用户据此判断这个数字可信到什么程度）。
 * - `provider-usage`：真实 provider 上报的 usage（最可信）
 * - `model-catalog`：模型目录/元数据里的上下文窗口（可信，来自 provider 声明）
 * - `preset`：会话预设里的 sampling.maxContext（可信度中，用户自己配的）
 * - `unknown`：拿不到任何真实来源，用占位值（**必须显式提示**，不许装作准确）
 */
export type MeterOrigin =
  | 'provider-usage'
  | 'model-catalog'
  | 'preset'
  | 'unknown'

/** 数值是否属于「真实来源」（非占位） */
export function isTrustworthy(origin: MeterOrigin): boolean {
  return origin !== 'unknown'
}

/** 采集到的 token 计量（分子 + 分母 + 两端口径） */
export interface MeterReading {
  /** 已占用的 token（估算或实测） */
  tokens: number
  /** 上下文预算（模型能力或预设上限） */
  budget: number
  /** 分子口径 */
  tokensOrigin: MeterOrigin
  /** 分母口径 */
  budgetOrigin: MeterOrigin
}

/** 字符量 → token 粗估（四舍五入；负数按 0） */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.round(chars / CHARS_PER_TOKEN)
}

/**
 * 消息文本总字符数。
 *
 * 【2026-09-14 F4-C3】新增 `hidden` 参数：被回退/编辑/重新生成移出上下文的消息
 * **必须扣除**——否则回退之后进度条不降反升，与用户实际观感矛盾，也让「回退是否生效」
 * 失去可观测证据。
 *
 * @param messages /chat/messages 的元素（`message` 为文本）
 * @param hidden   已被移出上下文的 seq 集合（可选）；命中即跳过
 * @param seqOf    从元素取 seq 的取值器；缺省时不扣除（调用方未提供）
 */
export function sumMessageChars(
  messages: ReadonlyArray<{ message?: unknown; seq?: unknown }> | undefined,
  hidden?: ReadonlySet<number>,
  seqOf?: (m: { message?: unknown; seq?: unknown }) => number | undefined,
): number {
  let sum = 0
  for (const m of messages ?? []) {
    if (hidden !== undefined && hidden.size > 0 && seqOf !== undefined) {
      const q = seqOf(m)
      if (q !== undefined && hidden.has(q)) continue // 已移出上下文 → 不计入占用
    }
    if (typeof m?.message === 'string') sum += m.message.length
  }
  return sum
}

/** 占用百分比（0-100，预算非法/为 0 时返回 0——进度条空转而非 NaN） */
export function meterPercent(tokens: number, budget: number): number {
  if (!Number.isFinite(budget) || budget <= 0) return 0
  if (!Number.isFinite(tokens) || tokens <= 0) return 0
  return Math.min(100, (tokens / budget) * 100)
}

/** 颜色分级：<70% ok / 70-90% warn / >90% danger */
export function meterLevel(tokens: number, budget: number): 'ok' | 'warn' | 'danger' {
  const pct = meterPercent(tokens, budget)
  if (pct > DANGER_RATIO * 100) return 'danger'
  if (pct >= WARN_RATIO * 100) return 'warn'
  return 'ok'
}

/** 紧凑 token 显示：517 / 12.3k / 1.2M（千以下整数、千~百万一位小数） */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  const m = n / 1_000_000
  return `${Math.round(m * 10) / 10}M`
}

/**
 * 组装一次计量读数（把散落的「取哪个值」收敛成单点，避免 UI 各处各写一套）。
 *
 * 优先级（分子）：provider usage > 字符量估算
 * 优先级（分母）：模型目录能力 > 预设 maxContext > 占位（unknown）
 */
export function buildMeterReading(input: {
  /** provider 上报的真实 prompt token（无则 undefined） */
  providerTokens?: number | undefined
  /** 字符量估算值（provider 缺席时用） */
  estimatedTokens: number
  /** 模型目录里的上下文窗口（无则 undefined） */
  modelContextWindow?: number | undefined
  /** 预设 sampling.maxContext（无则 undefined） */
  presetMaxContext?: number | undefined
}): MeterReading {
  const hasProvider = typeof input.providerTokens === 'number' && Number.isFinite(input.providerTokens) && input.providerTokens > 0
  const hasCatalog = typeof input.modelContextWindow === 'number' && Number.isFinite(input.modelContextWindow) && input.modelContextWindow > 0
  const hasPreset = typeof input.presetMaxContext === 'number' && Number.isFinite(input.presetMaxContext) && input.presetMaxContext > 0

  // 分母：模型真实能力优先（它是 CONTEXT_WINDOW_EXCEEDED 的真实判据来源）
  let budget: number
  let budgetOrigin: MeterOrigin
  if (hasCatalog) { budget = input.modelContextWindow as number; budgetOrigin = 'model-catalog' }
  else if (hasPreset) { budget = input.presetMaxContext as number; budgetOrigin = 'preset' }
  else { budget = DEFAULT_MAX_CONTEXT; budgetOrigin = 'unknown' }

  return {
    tokens: hasProvider ? (input.providerTokens as number) : input.estimatedTokens,
    budget,
    tokensOrigin: hasProvider ? 'provider-usage' : 'unknown',
    budgetOrigin,
  }
}

/** 口径标签的中文文案（UI 单源取用，避免各处各写一份） */
export function originLabel(o: MeterOrigin): string {
  switch (o) {
    case 'provider-usage': return '实测'
    case 'model-catalog': return '模型目录'
    case 'preset': return '预设配置'
    case 'unknown': return '估算/未知'
  }
}
