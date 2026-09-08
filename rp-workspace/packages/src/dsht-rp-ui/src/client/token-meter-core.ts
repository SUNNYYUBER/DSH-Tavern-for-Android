/**
 * token 上下文进度条纯逻辑（PROJECT_PLAN §7 措施 8「token 计量暴露」+ §4.15
 * 「token 上下文进度条」的估算口径）。
 *
 * 口径定案（代码只读调查，见 RpTokenMeter.tsx 头注）：真实 provider usage 在
 * 插件前端不可达 → 降级「字符量估算」：文本总字符 ÷ 2.5 ≈ token（中文
 * ~1.5-2 char/token、英文 ~4 char/token 的折中经验值）。预算 = 会话有效预设
 * sampling.maxContext，缺省 16384。本文件只放可单测的纯函数。
 */

/** 字符→token 粗估系数：~2.5 char/token（中文/英文混合对话的折中经验值） */
export const CHARS_PER_TOKEN = 2.5
/** 预算缺省值（sampling.maxContext 解析不到时的兜底） */
export const DEFAULT_MAX_CONTEXT = 16384
/** 占用分级阈值：≥70% 黄（告警）、≥90% 红（危险） */
export const WARN_RATIO = 0.7
export const DANGER_RATIO = 0.9

/** 字符量 → token 粗估（四舍五入；负数按 0） */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.round(chars / CHARS_PER_TOKEN)
}

/** 消息文本总字符数（/chat/messages 的 message 字段求和；非法形状按空串） */
export function sumMessageChars(messages: ReadonlyArray<{ message?: unknown }> | undefined): number {
  let sum = 0
  for (const m of messages ?? []) {
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

/** 颜色分级：<70% ok / 70-90% warn / >90% danger（PROJECT_PLAN 措施 8 的可视化分级） */
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
