/**
 * dsht-plugin-undo —— 独立通用「回退 / 编辑 / 重新生成」插件（任何 DSH 部署可用，
 * 不依赖 DSHTavern）。
 *
 * 核心契约：回退、编辑与重新生成都在原 session 原地完成，绝不开新分支/新 session。
 *
 * host 数据面（ctx.webServer 前缀路由 /dsht-undo/*，同源、零端口冲突）：
 * - POST /dsht-undo/rollback   {sessionId, keepThroughSeq}
 *     session.jsonl 截断到 keepThroughSeq（含）：header 保留、事件只留
 *     seq <= keepThroughSeq；先备份 <file>.bak。live session 拒绝（409，
 *     内存态权威，截盘会被 flush 覆盖回去——提示先关闭会话）。
 * - POST /dsht-undo/regenerate {sessionId}
 *     找最后一条 user/message 的 seq，截断其后全部事件，返回
 *     {truncatedTo, lastUserText}；客户端拿 lastUserText 调 session.prompt
 *     重发（queue 模式）。本路由本身只做截断 + 取回文本。
 * - POST /dsht-undo/edit {sessionId, seq, text}
 *     找该 seq 的真用户消息，截断到它**之前**（「编辑并重发」语义）；客户端
 *     拿新文本调 session.prompt 重发。本路由本身只做截断。
 *
 * 会话文件定位：扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl
 * 首行 header.id（dsht-plugin-shared/session-surgery.ts，与 dsht-rp-plugin 同款）。
 *
 * 文件改动回退（./workspace-snapshots.ts，turn-rewind 捕获机制移植）：
 * - agent/pre-step 的每轮第一个模型 step 前，对会话 cwd 所在 git 工作树做
 *   按 turn 锚点的整树 before 快照（sha256 blob 池去重；bounded：
 *   maxFiles/maxFileBytes/maxSnapshotBytes/excludePrefixes/maxTurnsPerSession，
 *   经 apply(ctx, config) 传入，enabled:false 整体关闭）。
 * - rollback / regenerate / edit 截断 session.jsonl 后，把截断点之后 turn 的
 *   快照逆序整批恢复（原地写回 before 内容、删掉该 turn 新增文件）——
 *   绝不开分支、不弹 fork 对话框。
 *
 * 浏览器 UI 在 ./client（lib/client.js wire 契约 bundle）：user 气泡
 * 「↩ 回退到此处」+「✎ 编辑」+ 最后一条 assistant 消息「↻ 重新生成」，对所有会话生效。
 */
import { type LikePluginContext } from '../dsht-plugin-shared/http.ts';
import { type ResolvedWorkspaceSnapshotConfig } from './workspace-snapshots.ts';
export declare const name = "dsht-plugin-undo";
export declare const inject: string[];
export interface UndoDeps {
    dshHome: string;
    /** live session 判定（ctx.sessions.get(id) !== undefined 语义） */
    isLive: (sessionId: string) => boolean;
    /** 工作区文件快照配置（undefined = 能力关闭，rollback/regenerate 只截断不恢复文件） */
    snapshots?: ResolvedWorkspaceSnapshotConfig;
}
export interface UndoResult {
    code: number;
    body: Record<string, unknown>;
}
/**
 * 回退：{sessionId, keepThroughSeq} → session.jsonl 截断到 keepThroughSeq（含），
 * 先备份 <file>.bak。原地修改，不开新分支。
 */
export declare function rollbackSession(deps: UndoDeps, payload: Record<string, unknown>): Promise<UndoResult>;
/**
 * 重新生成：{sessionId} → 截到最后一条 user/message（含），返回
 * {truncatedTo, lastUserText}。客户端拿 lastUserText 调 session.prompt 重发
 * （queue 模式）——本函数只做截断 + 取回文本。
 */
export declare function regenerateSession(deps: UndoDeps, payload: Record<string, unknown>): Promise<UndoResult>;
/**
 * 编辑已发送消息：{sessionId, seq, text} → 找到该 seq 的 user/message（真用户消息），
 * 截断到它**之前**（保留前一事件及更早；该消息其后的一切随之移除），返回 ok。
 * 客户端拿新文本调 session.prompt 重发（queue 模式）——「编辑并重发」语义。
 * 本函数只做截断定位 + 落盘；与 rollback/regenerate 同契约：原会话就地截断，
 * 先备份 .bak，live session 拒绝（409）。
 */
export declare function editUserMessage(deps: UndoDeps, payload: Record<string, unknown>): Promise<UndoResult>;
interface LikeUndoContext extends LikePluginContext {
    sessions?: {
        get: (id: string) => unknown;
    };
    on?: (event: string, listener: (payload: unknown, next: () => Promise<unknown>) => unknown, options?: {
        prepend?: boolean;
    }) => unknown;
}
export declare function apply(ctx: LikeUndoContext, rawConfig?: unknown): void;
export {};
