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
export declare const CHARS_PER_TOKEN = 2.5;
/** 预算缺省值（sampling.maxContext 解析不到时的兜底） */
export declare const DEFAULT_MAX_CONTEXT = 16384;
/** 占用分级阈值：≥70% 黄（告警）、≥90% 红（危险） */
export declare const WARN_RATIO = 0.7;
export declare const DANGER_RATIO = 0.9;
/** 字符量 → token 粗估（四舍五入；负数按 0） */
export declare function estimateTokens(chars: number): number;
/** 消息文本总字符数（/chat/messages 的 message 字段求和；非法形状按空串） */
export declare function sumMessageChars(messages: ReadonlyArray<{
    message?: unknown;
}> | undefined): number;
/** 占用百分比（0-100，预算非法/为 0 时返回 0——进度条空转而非 NaN） */
export declare function meterPercent(tokens: number, budget: number): number;
/** 颜色分级：<70% ok / 70-90% warn / >90% danger（PROJECT_PLAN 措施 8 的可视化分级） */
export declare function meterLevel(tokens: number, budget: number): 'ok' | 'warn' | 'danger';
/** 紧凑 token 显示：517 / 12.3k / 1.2M（千以下整数、千~百万一位小数） */
export declare function formatTokens(n: number): string;
