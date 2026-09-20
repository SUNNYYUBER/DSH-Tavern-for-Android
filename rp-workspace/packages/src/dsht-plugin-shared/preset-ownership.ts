/**
 * preset-ownership.ts —— 「预设内容注入所有权」判定（纯函数，可单测）
 *
 * 【管线切换 2026-09-20】RP 会话的预设内容注入（relative + depth 条目）从
 * dsh-plugin 的 pre-step 快照管线切换为 bychv/dsh-preset-enhance 统一承担
 * （其 llm/stream 编译不落会话日志、每轮现算——架构上更干净）。
 * 切换规则（过渡态）：bychv 绑定启用的会话，我方两个注入点跳过；
 * 未绑定/绑定关闭的会话，我方管线照常（向后兼容）。
 *
 * 判据来源 = $DSH_HOME/preset-enhance/state.json 的 bindings[sid].enabled。
 * 本模块只做「state.json 解析 → 启用集合」的纯函数面；文件读取与 mtime
 * 摊销缓存归消费方（dsh-plugin）。
 */

/** bychv state.json 的 bindings 段 → 「绑定启用」会话 id 集合（坏输入一律空集 = 不接管） */
export function enabledPresetBindings(state: unknown): Set<string> {
  const enabled = new Set<string>()
  if (!state || typeof state !== 'object' || Array.isArray(state)) return enabled
  const bindings = (state as { bindings?: unknown }).bindings
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return enabled
  for (const [sid, b] of Object.entries(bindings as Record<string, unknown>)) {
    if (b && typeof b === 'object' && (b as { enabled?: unknown }).enabled === true) enabled.add(sid)
  }
  return enabled
}
