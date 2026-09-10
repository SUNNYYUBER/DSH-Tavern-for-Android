import { type JSX } from 'react';
/** conversation.chat.assistant-actions 席位组件收到的 props */
interface VariantActionProps {
    /** 本条已定稿 assistant 消息的稳定标识 */
    messageId: string;
    useSession: <T>(selector: (snapshot: unknown) => T) => T;
    /** Chat 快照选择器（本席位的 useSession 快照不带 chat 投影——实机实证 hasChat=false；
     *  chat 数据必须走 useChat，snapshot 即 Chat 本体：nodes/order 顶层） */
    useChat: <T>(selector: (snapshot: unknown) => T) => T;
    sessionId: string;
}
/**
 * wsCache 失效。调用点：RP overlay 打开（loadWorkspaces）、导入完成（refreshAfterImport）、
 * 世界书绑定保存——否则绑定新书/新导入的工作区要刷新整个页面才生效（批次 3 遗留）。
 */
export declare function invalidateWsCache(): void;
export declare function notifyDisplayMutation(): void;
/** 状态栏卡片（§4.6：状态/位置信息渲染为卡片，数据不出本组件） */
export declare const StatusBarCard: any;
/** assistant-step shadowing 渲染器（T2.5a） */
export declare const RpAssistantNodeView: any;
/** 变体条 ‹ n/m ›（渲染进原生 IconActions 行，位于 copy 与 branch 之间） */
export declare function RpVariantActions({ messageId, useChat, sessionId }: VariantActionProps): JSX.Element | null;
/** 重新生成按钮的 inject 面（apply 闭包注入：截断 + 重发的数据通道） */
export interface RegenerateInject {
    /** POST rp/session-regenerate → sessions.refresh → session.prompt 重发 lastUserText（queue） */
    regenerate?: (sessionId: string) => Promise<void>;
}
export declare const RpRegenerateAction: any;
/** user 气泡的「↩ 回退到此处」+「✎ 编辑」（**所有会话**——适配 agent/普通会话同样
 *  可回退；2026-09-04 真机反馈：原先仅 RP 工作区会话显示，用户在适配会话里找不到）。
 *  回退 = 逻辑回退到这条消息（/rp/session-rollback；【2026-09-08 用户语义】includeAnchor
 *  = 连锚消息一起移出上下文，原文放回 composer 输入框——ST「回退」同语义，用户可改后
 *  重发）；编辑 = 截断到这条消息**之前** 并以新文本重新发送（/rp/session-edit +
 *  session.prompt，「编辑并重发」语义）。 */
export declare const RpUserNodeView: any;
export {};
