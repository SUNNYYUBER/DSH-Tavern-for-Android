/**
 * 消息搜索面板（PROJECT_PLAN §4.15「消息搜索：虚拟列表配套」前端形态）。
 *
 * - 数据面：POST /dsht-tavern-helper/chat/messages {sessionId} 全量拉一次 →
 *   本地过滤（search-core.ts 纯函数）；输入去抖 300ms；大小写不敏感；上限 50 条。
 * - 结果项：楼层号（message_id，0 起，展示 +1 对齐"第 n 楼"直觉）+ 角色名 +
 *   命中片段上下文（命中词前后各 ~40 字，命中词 <mark> 高亮）。
 * - 点击结果项 = 在面板内展开该消息完整文本（命中词全文高亮）。
 *   【诚实降级，不做滚动定位】官方 ChatView 的滚动容器不受本插件控制
 *   （无 DOM 契约、虚拟列表窗口化），"跳转到原楼层"无法可靠实现——注释与
 *   UI 均只承诺"展开查看"，不承诺定位。
 * - 挂载：悬浮球面板（RpStateFloat）头部「🔍 搜索」按钮拉起（与「查看状态」
 *   同款式，侵入最小的独立 overlay）；本组件不判 slug/会话有效性，由挂载方保证。
 */
import { type JSX } from 'react';
export declare function RpSearchPanel(props: {
    sessionId: string;
    onClose: () => void;
}): JSX.Element;
