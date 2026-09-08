"use strict";
/**
 * 酒馆助手六作用域变量的会话持有层（Session-held snapshot store）——纯逻辑 + 薄 IO（可单测）。
 *
 * 参考 hewzhew/dsh-agent-rp 的 src/tavern-helper.ts（MIT）：
 * 其 TavernHelperState 六作用域（global/preset/character/chat/message/script）全部由
 * Session 事件持有（内存权威、快照落盘、readTavernHelperStateSnapshot 快照优先防双算）。
 * 我们不改 deepseek-harness、拿不到 DSH Session 事件流，故映射为：
 * 以 sessionId 为键的内存 store + 整份快照落盘到 rp/state/<sid>.json 的 tavern 键。
 *
 * 六作用域映射（对照我方文件布局）：
 * - global    → rp/variables/global.json       （跨会话共享资产，文件权威，每请求读写盘，不动）
 * - preset    → 会话快照 scopes.preset          （新增；会话持有，仅存快照一处）
 * - character → rp/<slug>/variables.json        （跨会话共享资产，文件权威，不动）
 * - chat      → rp/state/<sid>.json variables 键（与 MVU 共享同一棵树，唯一权威；不动）
 * - message   → 会话快照 scopes.message         （新增；会话持有，仅存快照一处）
 * - script    → 会话快照 scripts[scriptId]      （新增；脚本私有变量，仅存快照一处）
 *
 * 快照优先防双算（对应 readMvuStateWithSessionOverride / readTavernHelperStateSnapshot 语义）：
 * 1. preset/message/script 三个会话持有层只存快照一处，不存在第二来源可合并——
 *    加载时"有快照用快照、无快照用空快照"，绝不把快照与任何 legacy 来源合并。
 * 2. chat 层不进快照：它与 MVU 共享 variables 键（唯一落盘点），快照若再存一份副本，
 *    读取时两路合并即双算（同一份变量被两处计算）。
 * 3. 同一会话内内存权威：mutate 先改内存再整份快照落盘，后续读取不重复读盘，
 *    不存在"读盘旧值 + 增量再写回"的 read-modify-write 双算窗口。
 * 4. 快照落盘只替换 state 文件的 tavern 键，绝不触碰 variables/state 等 MVU 持有的键。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TavernSessionStore = exports.SNAPSHOT_KEY = exports.SESSION_HELD_SCOPES = exports.TAVERN_SCOPES = void 0;
exports.emptySnapshot = emptySnapshot;
exports.decodeSnapshot = decodeSnapshot;
exports.readSnapshotFromStateFile = readSnapshotFromStateFile;
exports.writeSnapshotIntoStateFile = writeSnapshotIntoStateFile;
exports.applySnapshotMutation = applySnapshotMutation;
exports.TAVERN_SCOPES = ['global', 'preset', 'character', 'chat', 'message', 'script'];
exports.SESSION_HELD_SCOPES = ['preset', 'message', 'script'];
/** state 文件里快照所在的键 */
exports.SNAPSHOT_KEY = 'tavern';
/** 空快照（revision 0 = 尚无快照内容的 legacy 会话） */
function emptySnapshot() {
    return { format: 0, revision: 0, scopes: { preset: {}, message: {} }, scripts: {} };
}
function isTree(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * 快照解码 + 校验（坏快照返回 undefined——与 loadScope"坏 JSON = 空树"的容错风格一致，
 * 调用方回落空快照而不炸路由）。
 */
function decodeSnapshot(raw) {
    if (!isTree(raw))
        return undefined;
    if (raw.format !== 0)
        return undefined;
    const revision = raw.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
        return undefined;
    const scopes = raw.scopes;
    if (!isTree(scopes) || !isTree(scopes.preset) || !isTree(scopes.message))
        return undefined;
    const scripts = raw.scripts;
    if (!isTree(scripts))
        return undefined;
    const parsedScripts = {};
    for (const [id, tree] of Object.entries(scripts)) {
        if (!isTree(tree))
            return undefined;
        parsedScripts[id] = tree;
    }
    let lastMutation;
    if (raw.lastMutation !== undefined) {
        const m = raw.lastMutation;
        if (!isTree(m))
            return undefined;
        if (m.scope !== 'preset' && m.scope !== 'message' && m.scope !== 'script')
            return undefined;
        if (typeof m.ts !== 'number' || !Number.isFinite(m.ts))
            return undefined;
        if (m.scriptId !== undefined && typeof m.scriptId !== 'string')
            return undefined;
        lastMutation = {
            scope: m.scope,
            ...(m.scriptId === undefined ? {} : { scriptId: m.scriptId }),
            ts: m.ts,
        };
    }
    return {
        format: 0,
        revision,
        scopes: {
            preset: structuredClone(scopes.preset),
            message: structuredClone(scopes.message),
        },
        scripts: structuredClone(parsedScripts),
        ...(lastMutation === undefined ? {} : { lastMutation }),
    };
}
/** 从 state 文件对象中取快照（无 tavern 键 / 坏快照 → undefined） */
function readSnapshotFromStateFile(file) {
    if (file === null)
        return undefined;
    return decodeSnapshot(file[exports.SNAPSHOT_KEY]);
}
/** 把快照写进 state 文件对象（只替换 tavern 键，其余键原样保留；不改入参） */
function writeSnapshotIntoStateFile(file, snapshot) {
    return { ...file, [exports.SNAPSHOT_KEY]: snapshot };
}
/** 应用一次整树替换（不可变：返回新快照；revision+1 并记录 lastMutation） */
function applySnapshotMutation(snapshot, mutation) {
    const ts = mutation.ts ?? Date.now();
    const tree = structuredClone(mutation.tree);
    if (mutation.scope === 'script') {
        return {
            ...snapshot,
            revision: snapshot.revision + 1,
            scripts: { ...snapshot.scripts, [mutation.scriptId]: tree },
            lastMutation: { scope: 'script', scriptId: mutation.scriptId, ts },
        };
    }
    return {
        ...snapshot,
        revision: snapshot.revision + 1,
        scopes: { ...snapshot.scopes, [mutation.scope]: tree },
        lastMutation: { scope: mutation.scope, ts },
    };
}
/**
 * 会话持有 store：内存权威 + 快照落盘。
 * - get：内存命中直接返回；miss 时读盘，快照优先（有快照用快照、无快照用空快照），不与其他来源合并。
 * - mutate：应用变更 → 更新内存 → 重读 state 文件（保留 variables 等外部键）→ 仅替换 tavern 键落盘。
 * - 单写者假设：本会话快照仅由本插件写；外部进程改动经 invalidate(sid) 失效缓存。
 */
class TavernSessionStore {
    #io;
    #cache = new Map();
    constructor(io) {
        this.#io = io;
    }
    async get(sessionId) {
        const cached = this.#cache.get(sessionId);
        if (cached !== undefined)
            return cached;
        const file = await this.#io.readStateFile(sessionId);
        const snapshot = readSnapshotFromStateFile(file) ?? emptySnapshot();
        this.#cache.set(sessionId, snapshot);
        return snapshot;
    }
    async mutate(sessionId, mutation) {
        const current = await this.get(sessionId);
        const next = applySnapshotMutation(current, mutation);
        this.#cache.set(sessionId, next);
        const file = (await this.#io.readStateFile(sessionId)) ?? {};
        await this.#io.writeStateFile(sessionId, writeSnapshotIntoStateFile(file, next));
        return next;
    }
    /** 失效内存缓存（外部改动 state 文件后由调用方触发） */
    invalidate(sessionId) {
        this.#cache.delete(sessionId);
    }
}
exports.TavernSessionStore = TavernSessionStore;
