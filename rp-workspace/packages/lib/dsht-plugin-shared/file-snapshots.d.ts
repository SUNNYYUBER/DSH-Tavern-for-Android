/**
 * DSHTavern 会话内文件快照（回退/重新生成的「文件也能回退」数据面）——纯逻辑 + 薄 IO。
 *
 * 思路出处：dsh-tavern 的 nativeCommits（tavern-plugin/lib/index.js 的 rememberCommit /
 * rollbackTurn——按 turn 记录 before 快照，回退时整批恢复；MIT © flizzywine，
 * 见 REF_PROJECTS_COMPARISON.md 领域七与致谢表）。此处把"内存对象快照"落到文件维度：
 *
 * 契约：
 * - 会话内写操作（dsh-plugin 的 /rp/bind-books、/regex/save-*、/rp/persona；
 *   dsht-mvu variables/register|patch；dsht-tavern-helper variables/scripts/macros 落盘）
 *   在**写前**对目标文件打 before 快照。
 * - 快照文件：$DSH_HOME/rp/file-history/<sessionId>/<turnAnchor>.json
 *   { turn, createdAt, files: [{ path（$DSH_HOME 相对，posix 形态）, existed, content(base64) }] }。
 *   turnAnchor = 当前会话最新 turn 号（从 session.jsonl 尾行读 data.turn），或调用方传入。
 *   同一 turn 多次写同一文件：只保留**最早**的 before 状态（恢复点 = 该 turn 开始前）。
 * - 无 session 上下文的操作（全局设置类，拿不到 sessionId/turn 锚点）跳过快照。
 * - 回退：/rp/session-rollback 与 /rp/session-regenerate 截断后，把截断点之后 turn
 *   的快照**逆序整批恢复**（恢复快照 = 写回 before 内容；existed=false 的文件删除），
 *   并删掉已恢复的快照记录。
 * - 共享资产永不快照、永不回退：角色卡卡面数据（card.json / avatar.png）与
 *   skills/ 世界书库被 isSnapshotEligible 显式排除——它们是跨会话共享资料，
 *   快照只覆盖会话期间被改的会话/角色级文件（rp.json / regex / 变量状态文件）。
 * - 会话删除/重置（rp/import-reset 清空 rp/ 目录）时快照随 rp/file-history/ 一并清除。
 *
 * 打包：esbuild 内联（dsh-plugin / dsht-mvu / dsht-tavern-helper 各自 bundle 时编入）。
 */
/** 单个文件的 before 快照条目 */
export interface FileSnapshotEntry {
    /** $DSH_HOME 相对路径（posix 分隔符） */
    path: string;
    /** 写入前文件是否存在（false → 恢复时删除） */
    existed: boolean;
    /** 写入前内容（base64；existed=false 时为空串） */
    content: string;
}
/** 一个 turn 锚点的整批快照 */
export interface TurnFileSnapshot {
    turn: number;
    createdAt: number;
    files: FileSnapshotEntry[];
}
/** 快照目录：$DSH_HOME/rp/file-history/<sessionId>/ */
export declare function snapshotDir(dshHome: string, sessionId: string): string;
/**
 * 路径是否允许快照（共享资产排除规则，见模块头注释）：
 * - 拒绝 .. 越界与绝对路径（快照只覆盖 $DSH_HOME 内的 rp 数据文件）
 * - 拒绝 skills/ 前缀（世界书库 = 跨会话共享资产）
 * - 拒绝 card.json / avatar.png（角色卡卡面 = 共享资产，永不回退）
 */
export declare function isSnapshotEligible(relPath: string): boolean;
/** 从 session.jsonl 尾部读最新 turn 号（只读尾块，大日志不整读；无 turn 信息返回 null） */
export declare function readLatestTurn(sessionJsonlPath: string): Promise<number | null>;
/** 按 sessionId 定位 session.jsonl 并读最新 turn 锚点（定位不到/无 turn → null） */
export declare function resolveSessionTurnAnchor(dshHome: string, sessionId: string): Promise<number | null>;
export interface SnapshotWriteResult {
    /** 实际新进快照的文件数（同 turn 已有更早 before 状态的不重复计） */
    snapshotted: number;
    /** 跳过的文件数（共享资产/越界路径） */
    skipped: number;
    /** 使用的 turn 锚点（解析不到 = null，此时 snapshotted=0 且不写盘） */
    anchor: number | null;
}
/**
 * 写前快照：对 relPaths 记录 before 状态到 <sessionId>/<turn>.json。
 * turnAnchor 缺省时从 session.jsonl 尾行解析；解析不到（无 session 上下文）跳过快照。
 * 同一 turn 内已记录过的 path 保留最早的 before 状态（恢复点 = 该 turn 开始前）。
 */
export declare function snapshotBeforeWrite(dshHome: string, sessionId: string, relPaths: string[], turnAnchor?: number): Promise<SnapshotWriteResult>;
/** 回退截断边界（纯函数）：截断点所在 turn + 该 turn 是否被腰斩 */
export interface TruncationBoundary {
    /** 截断后保留事件里的最大 turn 号（无 turn 信息 = 0） */
    fromTurn: number;
    /** 截断点落在 fromTurn 内部（该 turn 有事件被截掉）→ 该 turn 的快照也要恢复 */
    includeBoundary: boolean;
}
/**
 * 由原始 session.jsonl 内容与 keepThroughSeq 计算快照恢复边界：
 * - 完整保留的 turn（截断点在其 turn/end 之后）不恢复；
 * - 被腰斩的 turn（如 regenerate 截到该 turn 的 user/message）一并恢复。
 */
export declare function snapshotRestoreBoundary(originalContent: string, keepThroughSeq: number): TruncationBoundary;
export interface SnapshotRestoreResult {
    /** 已恢复的 turn 锚点（降序） */
    restoredTurns: number[];
    /** 写回 before 内容的文件数 */
    filesRestored: number;
    /** 因 existed=false 被删除的文件数 */
    filesDeleted: number;
    errors: string[];
}
/**
 * 回退恢复（照抄 dsh-tavern rollbackTurn 的整批恢复语义）：把 fromTurn 之后
 * （includeBoundary 时含 fromTurn 本身）的 turn 快照**逆序整批恢复**——
 * 恢复快照 = 写回 before 内容；快照里 existed=false 的文件删除。
 * 恢复成功的快照记录随即删除（已回放的不再参与后续回退）。
 */
export declare function restoreSnapshotsAfter(dshHome: string, sessionId: string, boundary: TruncationBoundary): Promise<SnapshotRestoreResult>;
