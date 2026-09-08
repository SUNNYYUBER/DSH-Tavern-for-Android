/**
 * DSHTavern 变量写撤销日志（第四轮任务 4：变量联动回滚）——纯逻辑 + 薄 IO。
 *
 * 契约：
 * - 日志文件：$DSH_HOME/rp/state/<sessionId>.undo.jsonl（每行一个 UndoEntry，append-only）
 * - 每次变量写路由（dsht-mvu variables/register、variables/patch；dsht-tavern-helper
 *   variables PUT/POST/DELETE、scripts/run、macros/expand 的 setvar 落盘）写前先记录旧值。
 * - /dsht-rp rp/session-rollback 截断聊天后回放：把 ts 晚于截断点的条目按时间倒序
 *   恢复 oldValue 到各自作用域，回放后截断日志（删掉已回放的条目）。
 * - 会话删除/重置（rp/import-reset 清空 rp/ 目录）时日志随 rp/state/ 一并清除。
 *
 * 打包：esbuild 内联（dsht-mvu / dsht-tavern-helper / dsh-plugin 各自 bundle 时编入）。
 */
export type UndoScope = 'global' | 'character' | 'chat';
export interface UndoEntry {
    /** 写入时间戳（回放截断点比较基准） */
    ts: number;
    scope: UndoScope;
    /** character 作用域的工作区 slug（其余作用域为空串） */
    slug: string;
    /** JSONPointer 规范路径 */
    path: string;
    /** 写前旧值（undefined = 写入前不存在；JSON 里序列化为 null 加 had 标记区分） */
    oldValue: unknown;
    /** 写入前路径是否存在（区分"旧值就是 null"与"原本不存在"） */
    had: boolean;
}
/** 撤销日志文件路径 */
export declare function undoLogPath(dshHome: string, sessionId: string): string;
/** 构造一条 undo 条目（读 tree 取旧值） */
export declare function makeUndoEntry(scope: UndoScope, slug: string, path: string, tree: Record<string, unknown>, ts?: number): UndoEntry;
/** 追加 undo 条目（无条目不写文件） */
export declare function appendUndoEntries(dshHome: string, sessionId: string, entries: UndoEntry[]): Promise<void>;
/** 读取 undo 日志（坏行跳过；无文件 = 空） */
export declare function readUndoLog(dshHome: string, sessionId: string): Promise<UndoEntry[]>;
/** 删除 undo 日志（会话删除/重置时调用方清理） */
export declare function clearUndoLog(dshHome: string, sessionId: string): Promise<void>;
/**
 * 两棵变量树的差异 → undo 条目集（整树写入场景用：register/replace/scripts run）。
 * 以 after 的叶为准逐叶记旧值；after 里被删的键也记（oldValue=before 值，回放恢复）。
 */
export declare function diffUndoEntries(scope: UndoScope, slug: string, before: Record<string, unknown>, after: Record<string, unknown>, ts?: number): UndoEntry[];
/**
 * 回放 undo 日志：把 ts > cutoffTs 的写入按时间倒序恢复旧值（同一路径多次写入时，
 * 倒序保证最终回到截断点之前的最早旧值）。回放后截断日志（仅保留* 回放后截断日志（仅保留 ts <= cutoffTs 的条目）。
 * 返回恢复条数。cutoffTs 缺省 -∞（全部条目都回放，日志清空）。
 */
export declare function replayUndoLog(dshHome: string, sessionId: string, cutoffTs?: number): Promise<{
    restored: number;
}>;
