/**
 * E6：剧情表格只读渲染面板（st-memory-enhancement 表格系统移植——前端最小面）。
 *
 * - 数据面：GET /dsht-memory/tables?sessionId= → {sheets: Sheet[]}（dsht-plugin-memory
 *   数据面；服务端已做 ST 1.0 旧键 tableData/tables 的自动迁移，这里只消费 Sheet[]）。
 * - 渲染：每张表一个折叠区块（顶部折叠行，默认展开；只读，不提供编辑——写侧走
 *   tableEdit 指令/step-summary 路由）。
 * - 挂载：RpStateFloat 悬浮球面板头部「表格」按钮拉起（与 RpStateView/RpSearchPanel
 *   同款式 overlay）——本组件不判 slug/会话有效性，由挂载方保证 sessionId 是 RP 会话。
 *   样式复用 sv-* 类（状态查看面板同源），表格本体用内联样式（不新增全局 CSS）。
 */
import { type JSX } from 'react';
export declare function RpTablesView(props: {
    sessionId: string;
    onClose: () => void;
}): JSX.Element;
