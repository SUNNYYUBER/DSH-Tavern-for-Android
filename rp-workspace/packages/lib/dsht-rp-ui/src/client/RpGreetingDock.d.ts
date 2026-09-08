/**
 * 批次修复 1b：角色卡工作区空白会话的「开场白选择窗」。
 *
 * 场景（用户定案）：在角色卡工作区用原生「＋」新建的 session 是白板（无开场白）。
 * 本组件挂在 conversation.input.dock 席位：检测当前会话属于 RP 工作区（cwd 含 /rp/<slug>）
 * 且对话为空时，显示两个选项——
 *   「💬 带开场白开始」：调 /rp/open-chat 物化开场白（等同 ST「开始新聊天」）
 *   「留空（自定义用途）」：写卡/测试等，本次不再提示
 * 非角色卡工作区（cwd 不含 /rp/）不显示；选择只对当前 sessionId 记忆（会话级）。
 */
import { type JSX } from 'react';
/** dock 席位 owner props（InputZone 快照；session 形态按运行时实际字段防御性读取） */
interface DockProps {
    session?: unknown;
    input?: unknown;
}
export declare function RpGreetingDock(props: DockProps): JSX.Element | null;
export {};
