/**
 * R21 会话管理面板（2026-09-04 用户要求）：侧边栏多余会话的定位与自动清理。
 *
 * 数据面（dsh-plugin /rp/sessions-audit|sessions-archive|sessions-autoclean）：
 * - audit：扫全部 session.jsonl header，按 0.1.2 契约分类——
 *   branch-parent（被 branch/fork 过的父会话 = 分叉后弃用的"旧会话"）/ forked
 *   （branch 产物，正在用）/ subagent（不碰）/ empty（0 事件空壳）/ normal
 * - archive：官方 workspace.archive RPC（registry-global archivedSessionIds 集，
 *   grouping surfaces 全部隐藏；数据保留可恢复——归档不是删除）
 * - autoclean：branch-parents / empty 两种模式批量归档（dryRun 预览）
 */
import { type JSX } from 'react';
export declare function SessionsPanel(props: {
    archiveSession?: (sessionId: string) => Promise<void>;
}): JSX.Element;
