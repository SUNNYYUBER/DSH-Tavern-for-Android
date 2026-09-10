/**
 * session.jsonl 手术刀（共享模块）——从 dsh-plugin/index.ts 抽出，供
 * dsht-rp-plugin 与独立通用插件 dsht-plugin-undo 共同消费（esbuild 各自内联，
 * 零运行时依赖）。
 *
 * 契约：
 * - session.jsonl 首行 = session header（type:'session'），后续每行一个事件（seq 递增）。
 * - 回退/重新生成 = 原地截断事件流（绝不开新分支/新 session）：header 保留，
 *   事件只留 seq <= keepThroughSeq；被截事件参与的 replace 链随截断消失
 *   （后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证锚点落在链尾）。
 * - 会话定位：扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header.id。
 */
/**
 * 会话回退（纯函数）：截断 session.jsonl 到 keepThroughSeq（含）——
 * header 保留，事件只留 seq <= keepThroughSeq 的；被截事件参与的 replace 链
 * 随截断消失（后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证
 * keepThroughSeq 落在链尾）。
 */
export declare function truncateSessionJsonl(content: string, keepThroughSeq: number): {
    content: string;
    kept: number;
    dropped: number;
    error?: string;
};
/**
 * 快照消息角色归一化（纯函数）：把 user/message 事件里 role==='system' 的历史快照
 * 改写为 role:'user'。
 *
 * 根因（真机实测，DSH 0.1.0-rc.8 冷启动校验）：assertMessageEventShape 要求
 * user/message 的 data.role === 'user'（'message must have role "user"'）——RP 侧
 * pre-step 快照注入（persona/世界书/预设/状态/记忆，source.form='snapshot'）历史
 * 写的是 role:'system'，写盘时进程内不校验、冷启动全量校验即炸
 * SessionPersistenceCorruptionError，会话整个打不开。注入器已改写 role:'user'（对
 * 模型语义不变：system 提示本就以用户深度注入等效），本函数修复存量日志。
 * 其余事件行原样透传；非 JSON 行原样保留（与 truncate 的严格策略不同——归一化
 * 要尽量少动文件）。
 */
export declare function normalizeSnapshotMessageRoles(content: string): {
    content: string;
    changed: number;
};
/**
 * 会话重新生成定位（纯函数）：最后一条**真用户** user/message 的 seq 与其文本。
 * 找不到返回 null。事件形态：user/message 的 data = {role, content}（LikeMessage 直存）。
 * 【鲁棒轮 2026-09-09】排除 source.kind === 'plugin'（live 回退/重新生成后的 marker
 * 「[已回退] …」原实现会被当锚 → lastUserText = marker 文案 → 前端把系统文案当输入重发；
 * live 路径同口径）。kind 缺失（存量旧数据）视为真用户消息——不破坏旧会话兼容。
 */
export declare function findLastUserMessage(events: Array<{
    type: string;
    seq: number;
    data?: unknown;
}>): {
    seq: number;
    text: string;
} | null;
/**
 * 重复 turn/start 检测与修复（纯函数，R49 存量数据修复）。
 *
 * 根因（实机实证，turn 序列 1,1,2..18）：open-chat 物化直写 turn/start 事件不刷新
 * 内核 agent 构造时缓存的 phase.lastTurn → 内核下一条 prompt 重开同一 turn →
 * session.jsonl 出现两条 data.turn 相同的 turn/start → 前端 ConversationNodeAssembler
 * 全量重放抛「received more than one start Match」→ event feed subscriber 死亡，
 * 折叠行（turn-process 节点）/会话流停摆。
 *
 * 修复策略：第二次出现的 turn/start（其 turn 已闭合过）连同其配对 turn/end 的
 * 整段，把段内所有 data.turn === 旧编号的事件重编号为 maxTurn+1。保留首段
 * （物化开场白 = 楼层 1 语义）；重编号段的时间顺序在楼层分组里按 seq 排，无影响。
 * 事件 seq 与行结构不动；坏行原样保留（与 normalizeSnapshotMessageRoles 同策略）。
 */
export declare function repairDuplicateTurnStarts(content: string): {
    content: string;
    renumberedTurns: number;
    eventsRewritten: number;
};
/** 读文件首行（session.jsonl header；大聊天日志不整读） */
export declare function readFirstLine(path: string): Promise<string | null>;
export interface SessionHeaderHit {
    sessionId: string;
    cwd?: string;
    project: string;
    sdir: string;
    firstLine: string;
}
/** 扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header（只读首行，大日志无压力） */
export declare function scanSessionHeaders(dshHome: string): Promise<SessionHeaderHit[]>;
