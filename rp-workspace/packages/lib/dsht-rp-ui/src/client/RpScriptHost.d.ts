/**
 * 酒馆助手（TavernHelper）脚本运行时宿主——conversation.input.dock 席位。
 *
 * 验收意图：ST 酒馆助手核心功能之一是加载执行脚本库；本组件把已落盘的
 * tavern-helper-scripts.json（预设 + 卡两作用域 enabled 脚本）真正跑起来。
 *
 * - 执行形态：每脚本一个 sandbox="allow-scripts" srcdoc iframe（不给 same-origin，
 *   脚本为不可信代码），iframe 铺满会话视口（position:fixed inset:0、pointer-events:none）
 *   ——脚本自渲染的 fixed 部件视觉等效 ST 顶层注入；交互走脚本按钮面板。
 *   会话级单例（sessionId → SessionRuntime，iframe 挂 document.body，跨组件重挂载存活）。
 * - TavernHelper shim：iframe 内注入 window.TavernHelper + 裸全局，postMessage 桥到本宿主，
 *   再调 /dsht-tavern-helper/* 数据面（变量六作用域 / 预设 CRUD / 聊天消息只读 / 正则 /
 *   世界书名单与条目读）/ 本地事件总线。
 * - 上下文快照：start / reloadAll 装载脚本后、以及每次 generation_ended 投递后，拉
 *   /context + /chat/messages 合并成快照，postMessage({th:'context'}) 推给全部 iframe
 *   ——iframe 内 getContext() / SillyTavern.getContext() 同步读（推送失败静默不影响脚本）。
 * - 事件投递：diff 会话快照（chat.order 长度 / 末条 kind / running）→
 *   MESSAGE_SENT / MESSAGE_RECEIVED / GENERATION_STARTED / GENERATION_ENDED；
 *   【实机审计修复 2026-09-05】补投 CHAT_CHANGED（会话打开）与 message_swiped / message_edited
 *   （RpNativeChat 变体切换 / 会话编辑成功回调经 TH_HOST_EVENT CustomEvent 桥入）。
 * - 失败诚实化：单脚本抛错/超时只标记自身；调到 shim 没有的 API 记名，
 *   面板逐脚本显示 状态（运行中/失败原因/缺什么 API）。
 * - C15 最小 Toolbox：面板内「日志」抽屉（iframe console 经 th:console 桥实时汇入，
 *   最多 200 条）与「变量」查看器（GET /dsht-mvu/variables 只读 JSON 树）。
 * - D8 通知：桥上 422（variableSchema 校验失败）console.warn + 开关放行时 DOM toast
 *   （rp/mvu-settings.json 的 mvu_notification_failure/success 类键，缺省静默）。
 */
import { type JSX } from 'react';
import { type ThContextSnapshot } from './th-shim.ts';
declare const SHIM_VERSION = "4.8.5";
export { SHIM_VERSION };
/** 【实机审计修复 2026-09-05】RpNativeChat 成功回调 → TH 事件桥（message_swiped/message_edited）：
 * 变体切换 / 会话编辑成功处 dispatch 的 window CustomEvent 名（detail: {sessionId, eventType, messageId}） */
export declare const TH_HOST_EVENT = "dsht-rp-ui:th-host-event";
/** 预约楼层 guest 桥（无运行时则创建但不 start——脚本装载仍归 dock 管） */
export declare function reserveMessageFrame(sessionId: string, slug: string): {
    sessionId: string;
    scriptId: string;
    secret: string;
} | null;
export declare function attachMessageFrame(sessionId: string, scriptId: string, iframe: HTMLIFrameElement): void;
export declare function releaseMessageFrame(sessionId: string, scriptId: string): void;
/** 【P3a 2026-09-07】楼层帧 context 引导源：取该会话运行时的最新上下文快照。
 * 楼层 iframe 文档构建时内嵌为 window.__dshtInitialContext（卡脚本运行前就位，
 * 消除 postMessage 竞态——卡内 detectEnvironment 首读 getContext 不再落 pending 空壳） */
export declare function getRpContextSnapshot(sessionId: string): ThContextSnapshot | null;
export declare function fetchFrameVars(sessionId: string, slug: string): Promise<Record<string, unknown>>;
interface DockProps {
    session?: unknown;
}
export declare function RpScriptHost(props: DockProps): JSX.Element | null;
/** 【2026-09-07 ST 按钮条对齐（基准 1/316）】脚本按钮常驻悬浮条——ST 里 TH 脚本按钮
 *  以胶囊按钮浮在输入框上方（Kemini / 重试额外模型解析 / 剧情控制台 / ExampleGame 世界书控制…），
 *  不藏进管理面板。dock 席位挂载，读会话运行时的按钮清单，点击回投按钮事件。 */
export declare function RpScriptButtonsBar(props: DockProps): JSX.Element | null;
