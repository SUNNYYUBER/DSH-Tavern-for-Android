/**
 * T3.2 会话长期记忆（rp-memory 最小闭环，规则层无 LLM）——纯逻辑 + 薄 IO。
 *
 * 存储形状：$DSH_HOME/rp/memory/<sessionId>.json
 *   { entries: [{ id, text, source: 'agent'|'user', createdAt }] }
 *
 * 契约：
 * - 追加（saveMemory 前由路由先做 snapshotBeforeWrite 写前快照，本模块不管快照）：
 *   - id = `${Date.now().toString(36)}-${随机4}`；
 *   - text 必填非空（trim 后判空）、上限 2000 字（按 Unicode 码点计）；
 *   - 去抖：相同文本（trim 后全等）重复保存不重复入库，幂等命中已存在条目——
 *     防 agent 每轮把同一事实反复固化；
 *   - 上限 200 条，超出丢最旧（数组头部）。
 * - 检索：query 按空白切词，条目命中任一词即算；命中词数降序（同分取较新的），
 *   默认 limit 10。纯同步匹配，不走 LLM。
 * - 删除：按 id 删单条。
 * - 注入渲染：最近 20 条 → `- [YYYY-MM-DD HH:mm] 文本`（无记忆返回空串，不注入）。
 *
 * 拆成本文件的原因：路由 handler 与 registerPrefix 强耦合不好单测，核心逻辑
 * 全部收拢为纯函数（index.ts 只做参数校验与 IO 接线）。
 *
 * 打包：esbuild 内联（dsh-plugin bundle 时编入）。
 */
export type MemorySource = 'agent' | 'user';
export interface MemoryEntry {
    /** `${Date.now().toString(36)}-${随机4}` */
    id: string;
    /** 事实文本（trim 后存储） */
    text: string;
    /** 来源：agent 主动固化 / 用户亲口所述 */
    source: MemorySource;
    /** 入库时间戳（ms） */
    createdAt: number;
}
export interface MemoryFile {
    entries: MemoryEntry[];
}
/** 条目上限：超出丢最旧 */
export declare const MEMORY_MAX_ENTRIES = 200;
/** 单条文本长度上限（字，按 Unicode 码点计） */
export declare const MEMORY_TEXT_MAX = 2000;
/** pre-step 注入条数（最近 N 条） */
export declare const MEMORY_SNAPSHOT_COUNT = 20;
/** 会话记忆文件绝对路径 */
export declare function memoryFilePath(dshHome: string, sessionId: string): string;
/** 会话记忆文件的 $DSH_HOME 相对路径（写前快照 snapshotBeforeWrite 用） */
export declare function memoryRelPath(sessionId: string): string;
/**
 * sessionId 安全校验（路由 payload 直落文件名，防路径越界）：
 * 非空、无路径分隔符、无 ..、无首尾空白、长度 ≤ 120。
 */
export declare function isValidMemorySessionId(sessionId: string): boolean;
/** source 归一：仅 'user' 保留，其余（含缺省）一律按 'agent' */
export declare function normalizeMemorySource(v: unknown): MemorySource;
/** 条目 id：时间戳 36 进制 + 随机 4 位（同毫秒碰撞概率可忽略） */
export declare function makeMemoryId(now?: number): string;
/**
 * 追加结果：ok=false 时 error 指明拒绝原因（empty/too-long）；
 * ok=true 且 duplicate=true 表示去抖命中（entry 指向已存在条目，文件不变）。
 */
export interface AppendMemoryResult {
    ok: boolean;
    error?: 'empty' | 'too-long';
    duplicate?: boolean;
    file: MemoryFile;
    entry?: MemoryEntry;
}
/**
 * 追加一条记忆（纯函数，不改入参）：trim → 校验 → 去抖 → 追加 → 200 条淘汰。
 * 调用方负责持久化（saveMemory）与写前快照（snapshotBeforeWrite）。
 */
export declare function appendMemory(file: MemoryFile, text: string, source: MemorySource, opts?: {
    now?: number;
}): AppendMemoryResult;
/**
 * 读会话记忆（薄 IO）：文件缺失/损坏/形状不对 → 空记忆；逐条归一容错
 * （坏条目跳过、source/createdAt 兜底），保证注入与检索拿到干净形状。
 */
export declare function loadMemory(dshHome: string, sessionId: string): Promise<MemoryFile>;
/** 写会话记忆（薄 IO，建目录）；调用方负责写前快照 */
export declare function saveMemory(dshHome: string, sessionId: string, file: MemoryFile): Promise<void>;
/** 检索命中项（条目 + 命中词数） */
export interface MemoryHit extends MemoryEntry {
    /** 命中的查询词个数 */
    score: number;
}
/**
 * 关键词检索（纯同步）：query 按空白切词（大小写不敏感），条目命中任一词即算；
 * 命中词数降序、同分取较新；默认 limit 10。空查询/无词 → 空数组。
 */
export declare function queryMemory(entries: MemoryEntry[], query: string, limit?: number): MemoryHit[];
/** 删除单条（纯函数）：deleted=false 表示 id 不存在（文件不变） */
export declare function deleteMemoryEntry(file: MemoryFile, id: string): {
    file: MemoryFile;
    deleted: boolean;
};
/** 时间戳 → `YYYY-MM-DD HH:mm`（本地时区） */
export declare function formatMemoryTime(ts: number): string;
/**
 * pre-step 注入渲染（纯函数）：取最近 N 条（默认 20，按追加序陈→新），
 * 每条 `- [YYYY-MM-DD HH:mm] 文本`；无记忆返回空串（调用方不注入）。
 */
export declare function renderMemorySnapshot(entries: MemoryEntry[], opts?: {
    count?: number;
}): string;
