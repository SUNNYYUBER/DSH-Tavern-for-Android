/**
 * dsht-plugin-undo 工作区文件快照（按 turn 锚点）——turn-rewind 快照捕获机制的
 * 移植精简版（vendor: dsh-turn-rewind src/snapshot.ts + src/git.ts），泛化掉
 * ChangeLedger 的 restore-point/plan/approval 体系，只保留：
 *
 * - 捕获：会话 cwd 所在 git 工作树的「受跟踪 + 未忽略」文件清单
 *   （git ls-files --cached --others --exclude-standard），逐文件读内容，
 *   sha256 寻址写入 blob 池（跨 turn/跨会话去重——未变化的文件零增量成本）。
 *   bounded：maxFiles / maxFileBytes / maxSnapshotBytes / excludePrefixes
 *   （与 turn-rewind 配置同名同义；excludePrefixes 在清点层过滤，
 *   被排除路径永不进快照、也永不进恢复删除集——双端一致过滤，安全）。
 * - 存储：$DSH_HOME/undo/file-history/
 *     blobs/<sha256>                     内容寻址 blob 池
 *     snapshots/<sessionId>/<turn>.json  turn 锚点清单（该 turn 第一个模型
 *                                        step 前的整树 before 状态）
 * - 恢复（回退/重新生成截断 session.jsonl 后调用）：把截断点之后 turn 的快照
 *   **逆序整批恢复**（语义同 dsht-plugin-shared/file-snapshots.ts 的
 *   restoreSnapshotsAfter，但作用于会话 cwd 工作区而非 $DSH_HOME 相对路径）：
 *   对每个被截 turn 的清单 diff 当前工作树——
 *     快照有/当前无或内容不同 → 写回 blob 内容；快照无/当前有 → 删除。
 *   恢复成功的清单随即删除（已回放的不再参与后续回退），blob 池按引用回收。
 * - 与 turn-rewind 的关键差异：不开分支、不弹 fork 对话框、无 approval plan；
 *   恢复是 rollback/regenerate 原地截断的配套动作。捕获用单遍
 *   （turn-rewind 的 captureStableTree 双遍在 24k 文件仓库上需 91s×2，已弃）。
 */
export interface WorkspaceSnapshotConfig {
    enabled?: boolean;
    /** 单个快照的最大文件数（默认 100_000，对照目标 profile 既有裁决） */
    maxFiles?: number;
    /** 单文件最大字节（默认 16MB，同 turn-rewind） */
    maxFileBytes?: number;
    /** 单快照聚合最大字节（默认 512MB，同 turn-rewind） */
    maxSnapshotBytes?: number;
    /** 每会话保留的 turn 快照数（默认 30，同 turn-rewind maxTurnCheckpointsPerSession） */
    maxTurnsPerSession?: number;
    /** 清点层排除前缀（仓库相对，目录以 / 结尾，如 '_pipeline/'） */
    excludePrefixes?: string[];
}
export interface ResolvedWorkspaceSnapshotConfig {
    storageDir: string;
    maxFiles: number;
    maxFileBytes: number;
    maxSnapshotBytes: number;
    maxTurnsPerSession: number;
    excludePrefixes: string[];
}
/** 解析配置；enabled === false → null（能力关闭）。storageDir 锚在 dshHome 下。 */
export declare function resolveWorkspaceSnapshotConfig(dshHome: string, config?: WorkspaceSnapshotConfig): ResolvedWorkspaceSnapshotConfig | null;
export type WorkspaceSnapshotEntry = {
    kind: 'file';
    blob: string;
    size: number;
    mode: number;
} | {
    kind: 'symlink';
    target: string;
    mode: number;
};
export interface WorkspaceTurnSnapshot {
    version: 1;
    sessionId: string;
    turn: number;
    createdAt: number;
    /** git 工作树根（realpath 后） */
    root: string;
    fileCount: number;
    totalBytes: number;
    /** 仓库相对路径（posix）→ 条目 */
    entries: Record<string, WorkspaceSnapshotEntry>;
}
/** 回退截断边界（与 dsht-plugin-shared/file-snapshots.ts TruncationBoundary 结构一致） */
export interface SnapshotBoundary {
    fromTurn: number;
    includeBoundary: boolean;
}
/** 该 turn 是否已有快照（已捕获的 turn 不重复捕获：保留最早 before 状态） */
export declare function hasTurnSnapshot(config: ResolvedWorkspaceSnapshotConfig, sessionId: string, turn: number): Promise<boolean>;
/** 会话 cwd 所属 git 工作树根（realpath 规范化；非 git 目录抛错 → 无快照） */
export declare function discoverWorkspaceRoot(cwd: string, signal?: AbortSignal): Promise<string>;
export interface CaptureResult {
    root: string;
    turn: number;
    fileCount: number;
    totalBytes: number;
    /** true = 该 turn 已有快照，本次跳过（保留最早 before 状态） */
    skipped: boolean;
}
/**
 * 按 turn 锚点捕获工作区快照（在该 turn 第一个模型 step 前调用）。
 * 已有同 turn 快照 → 跳过。捕获后按 maxTurnsPerSession 裁剪旧快照并回收无主 blob。
 */
export declare function captureWorkspaceSnapshot(options: {
    sessionId: string;
    turn: number;
    cwd: string;
    config: ResolvedWorkspaceSnapshotConfig;
    signal?: AbortSignal;
}): Promise<CaptureResult>;
export interface WorkspaceRestoreResult {
    /** 已恢复的 turn 锚点（降序） */
    restoredTurns: number[];
    /** 写回 before 内容的文件数（含符号链接重建） */
    filesRestored: number;
    /** 因快照时还不存在而被删除的文件数 */
    filesDeleted: number;
    errors: string[];
}
/**
 * 逆序整批恢复：把 fromTurn 之后（includeBoundary 时含 fromTurn 本身）的 turn
 * 快照从新到旧逐个 diff 当前工作树并恢复差异集，恢复成功的清单随即删除。
 * 净效果 = 工作区回到最早被截 turn 开始前的状态；缺失清单的 turn 跳过（best-effort）。
 */
export declare function restoreWorkspaceSnapshots(options: {
    sessionId: string;
    boundary: SnapshotBoundary;
    config: ResolvedWorkspaceSnapshotConfig;
}): Promise<WorkspaceRestoreResult>;
