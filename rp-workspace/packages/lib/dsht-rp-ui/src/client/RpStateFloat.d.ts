/**
 * 悬浮球原生移植（用户定案：原生移植，不让别的功能失效）。
 *
 * 意图来源：示例预设系预设 tavern_helper.scripts（示例卡二脚本）的 pw-state-float——
 * 「🌌 当前平行世界状态」悬浮窗：可拖拽浮球 → 点开当前 MVU 变量状态面板，可拖、可关。
 * 原实现深度钩 ST 内部组件（PromptManager/topDoc），不可直接执行；这里按意图原生重写：
 * - 挂载：conversation.input.dock 席位（position:fixed 视口定位，不随滚动荡走）；
 *   仅 RP 工作区会话（cwd 含 /rp/<slug>）且已有消息时显示——非 RP 会话/空白会话零影响。
 * - 浮球：pointer 拖拽（< 6px 视为点按），位置 localStorage 持久化（跨会话共用位置偏好）。
 * - 面板：点开拉 /dsht-rp/state {sessionId} 的 MVU 状态树，递归渲染；打开时自动拉取
 *   + 每 4s 轮询（生成中状态变化即见）；「刷新」手动重拉。数据只读（写走聊天/变量面板）。
 */
import { type JSX } from 'react';
interface DockProps {
    session?: unknown;
    input?: unknown;
}
/** props.cwd 缺失时回退 host 补取的 cwd 解析 hook；resolved = 补取已落定（区分加载中与真非 RP） */
export declare function useRpSlug(cwdFromProps: string | undefined, sessionId: string): {
    slug: string | null;
    resolved: boolean;
};
export declare function RpStateFloat(props: DockProps): JSX.Element | null;
export {};
