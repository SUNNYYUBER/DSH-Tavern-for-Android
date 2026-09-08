/**
 * token 上下文进度条（PROJECT_PLAN §7 措施 8「token 计量暴露」前端形态 +
 * §4.15「token 上下文进度条：输入区常驻"当前上下文占比"条」）。
 *
 * 【口径定案（2026-09-03 真实 usage 收口）——优先「provider 真实值」】
 * - 会话快照（dock 席位 props.session.chat）的最后一条 assistant 消息自带
 *   provider usage（inputTokens/cacheReadTokens/cacheWriteTokens）——总请求
 *   prompt = 三者之和（dsh-token-meter ContextPressureProjection.pressureTokens
 *   同口径）。首轮回复落地前无 usage → 回落「字符量估算」（总字数 ÷ 2.5），
 *   标签「估算值」；有 usage 后标签「真实值」。
 * - 预算 = 会话有效预设 sampling.maxContext（thApi regexes/get 解析 presetId →
 *   rpApi preset/list 全量 RPPreset 含 sampling），解析不到用固定 16384 缺省。
 * - 字符估算只计对话文本：世界书注入/预设骨架/状态摘要未计入 → 显示为低估，
 *   UI 明示「估算值」。
 *
 * 挂载：conversation.input.dock 席位 order 51（dock 序列最末 = 紧贴 composer
 * 输入框上方的常驻细条；官方输入区本身无更细的挂载点）。仅 RP 会话且已有消息时
 * 显示（与悬浮球同门槛，非 RP 会话零影响）。30s 轮询（生成中文本增长即见；
 * 失败保持上次值不闪空）。
 * §2.3 ④⑤（2026-09-03）：计量条可点击 → 弹出「上下文与记忆」面板（RpContextPanel）：
 * AI 可见楼层数/近窗字符预算调节 + 折叠区间「展开给 AI（单次）」。
 */
import { type JSX } from 'react';
/** dock 席位 owner props（InputZone 快照；字段按运行时形态防御性读取） */
interface DockProps {
    session?: unknown;
    input?: unknown;
}
export declare function RpTokenMeter(props: DockProps): JSX.Element | null;
export {};
