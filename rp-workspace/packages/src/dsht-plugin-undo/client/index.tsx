/**
 * dsht-plugin-undo 浏览器侧入口（已退役为空壳，见下）。
 *
 * 退役原因（真机实证 2026-09-04）：
 * 1. conversation.chat.node keyed `user` 槽位与 dsht-rp-plugin 的 RpUserNodeView
 *    （同 key 同 priority -1）互斥——双方同时注册会打挂 rp-plugin 整个 loader
 *    entry（RP 界面全失：楼层徽章/思考折叠/协议渲染全部消失）。
 * 2. assistant-actions「↻ 重新生成」与 dsht-rp-plugin 的 dsht-rp-regenerate
 *    （/rp/session-regenerate，含 MVU 变量回滚）功能重复且后者更强。
 *
 * 职责归属（收敛后）：
 * - RP 部署（DSHTavern 实际形态）：回退/编辑/重新生成 UI 全部由 dsht-rp-plugin
 *   提供（RpUserNodeView 回退+编辑、assistant-actions 重新生成；数据面
 *   /rp/session-rollback、/rp/session-edit、/rp/session-regenerate——变量回滚 +
 *   文件快照 + .bak 备份齐全）。
 * - 本插件保留 host 数据面 /dsht-undo/*（rollback/regenerate/edit）：供任何
 *   无 rp 的 DSH 部署直接 HTTP 调用（或自接 UI）。
 *
 * 因此本 client 不再注册任何槽位；保留文件仅为 build-undo.mjs 产物布局稳定。
 */
export const inject: string[] = []

export function apply(): void {
  // 空实现：不再注册 conversation.chat.node（rp 冲突）与 assistant-actions（rp 重复）
}
