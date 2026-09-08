/**
 * PROJECT_PLAN 补全：状态查看双视图面板（表格 / JSON）。
 *
 * - 数据面：POST /dsht-rp/state {sessionId} → {state}（MVU 状态树，只读；
 *   与 RpStateFloat 同一路由，写侧走聊天/变量面板）。
 * - 表格视图：递归键值树（state-view.ts 的 flattenStateTree 铺平成行），
 *   嵌套容器可点击折叠/展开（折叠集合记忆本次打开的选择，打开时默认全展开）；
 * - JSON 视图：只读格式化文本（JSON.stringify 2 空格缩进）；
 * - 挂载：RpStateFloat 悬浮球面板头部「查看状态」按钮拉起（侵入最小的独立
 *   overlay）——本组件不判 slug/会话有效性，由挂载方保证 sessionId 是 RP 会话。
 */
import { type JSX } from 'react';
export declare function RpStateView(props: {
    sessionId: string;
    onClose: () => void;
}): JSX.Element;
