"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_SNAPSHOT_COUNT = exports.MEMORY_TEXT_MAX = exports.MEMORY_MAX_ENTRIES = void 0;
exports.memoryFilePath = memoryFilePath;
exports.memoryRelPath = memoryRelPath;
exports.isValidMemorySessionId = isValidMemorySessionId;
exports.normalizeMemorySource = normalizeMemorySource;
exports.makeMemoryId = makeMemoryId;
exports.appendMemory = appendMemory;
exports.loadMemory = loadMemory;
exports.saveMemory = saveMemory;
exports.queryMemory = queryMemory;
exports.deleteMemoryEntry = deleteMemoryEntry;
exports.formatMemoryTime = formatMemoryTime;
exports.renderMemorySnapshot = renderMemorySnapshot;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/** 条目上限：超出丢最旧 */
exports.MEMORY_MAX_ENTRIES = 200;
/** 单条文本长度上限（字，按 Unicode 码点计） */
exports.MEMORY_TEXT_MAX = 2000;
/** pre-step 注入条数（最近 N 条） */
exports.MEMORY_SNAPSHOT_COUNT = 20;
/** 会话记忆文件绝对路径 */
function memoryFilePath(dshHome, sessionId) {
    return (0, node_path_1.join)(dshHome, 'rp', 'memory', `${sessionId}.json`);
}
/** 会话记忆文件的 $DSH_HOME 相对路径（写前快照 snapshotBeforeWrite 用） */
function memoryRelPath(sessionId) {
    return `rp/memory/${sessionId}.json`;
}
/**
 * sessionId 安全校验（路由 payload 直落文件名，防路径越界）：
 * 非空、无路径分隔符、无 ..、无首尾空白、长度 ≤ 120。
 */
function isValidMemorySessionId(sessionId) {
    return typeof sessionId === 'string'
        && sessionId.length > 0
        && sessionId.length <= 120
        && !sessionId.includes('/')
        && !sessionId.includes('\\')
        && !sessionId.includes('..')
        && sessionId !== '.'
        && sessionId.trim() === sessionId;
}
/** source 归一：仅 'user' 保留，其余（含缺省）一律按 'agent' */
function normalizeMemorySource(v) {
    return v === 'user' ? 'user' : 'agent';
}
/** 条目 id：时间戳 36 进制 + 随机 4 位（同毫秒碰撞概率可忽略） */
function makeMemoryId(now = Date.now()) {
    const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
    return `${now.toString(36)}-${rand}`;
}
/**
 * 追加一条记忆（纯函数，不改入参）：trim → 校验 → 去抖 → 追加 → 200 条淘汰。
 * 调用方负责持久化（saveMemory）与写前快照（snapshotBeforeWrite）。
 */
function appendMemory(file, text, source, opts = {}) {
    const t = text.trim();
    if (!t)
        return { ok: false, error: 'empty', file };
    if ([...t].length > exports.MEMORY_TEXT_MAX)
        return { ok: false, error: 'too-long', file };
    // 去抖：同文本已存在则幂等命中，不重复入库
    const dup = file.entries.find(e => e.text === t);
    if (dup)
        return { ok: true, duplicate: true, file, entry: dup };
    const now = opts.now ?? Date.now();
    const entry = { id: makeMemoryId(now), text: t, source, createdAt: now };
    const all = [...file.entries, entry];
    // 上限淘汰：超出丢最旧（保持追加序，头部为最旧）
    const entries = all.length > exports.MEMORY_MAX_ENTRIES ? all.slice(all.length - exports.MEMORY_MAX_ENTRIES) : all;
    return { ok: true, file: { entries }, entry };
}
/**
 * 读会话记忆（薄 IO）：文件缺失/损坏/形状不对 → 空记忆；逐条归一容错
 * （坏条目跳过、source/createdAt 兜底），保证注入与检索拿到干净形状。
 */
async function loadMemory(dshHome, sessionId) {
    if (!isValidMemorySessionId(sessionId))
        return { entries: [] };
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(memoryFilePath(dshHome, sessionId), 'utf8'));
        if (!Array.isArray(parsed?.entries))
            return { entries: [] };
        const entries = [];
        for (const raw of parsed.entries) {
            const e = raw;
            if (!e || typeof e !== 'object')
                continue;
            if (typeof e.id !== 'string' || !e.id)
                continue;
            if (typeof e.text !== 'string' || !e.text.trim())
                continue;
            entries.push({
                id: e.id,
                text: e.text,
                source: normalizeMemorySource(e.source),
                createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0,
            });
        }
        return { entries };
    }
    catch {
        return { entries: [] };
    }
}
/** 写会话记忆（薄 IO，建目录）；调用方负责写前快照 */
async function saveMemory(dshHome, sessionId, file) {
    if (!isValidMemorySessionId(sessionId))
        throw new Error('invalid sessionId');
    const path = memoryFilePath(dshHome, sessionId);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, JSON.stringify(file), 'utf8');
}
/**
 * 关键词检索（纯同步）：query 按空白切词（大小写不敏感），条目命中任一词即算；
 * 命中词数降序、同分取较新；默认 limit 10。空查询/无词 → 空数组。
 */
function queryMemory(entries, query, limit = 10) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0)
        return [];
    const hits = [];
    for (const e of entries) {
        const text = e.text.toLowerCase();
        const score = tokens.reduce((n, t) => (text.includes(t) ? n + 1 : n), 0);
        if (score > 0)
            hits.push({ ...e, score });
    }
    hits.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    return hits.slice(0, Math.max(0, limit));
}
/** 删除单条（纯函数）：deleted=false 表示 id 不存在（文件不变） */
function deleteMemoryEntry(file, id) {
    const entries = file.entries.filter(e => e.id !== id);
    return { file: { entries }, deleted: entries.length !== file.entries.length };
}
/** 时间戳 → `YYYY-MM-DD HH:mm`（本地时区） */
function formatMemoryTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/**
 * pre-step 注入渲染（纯函数）：取最近 N 条（默认 20，按追加序陈→新），
 * 每条 `- [YYYY-MM-DD HH:mm] 文本`；无记忆返回空串（调用方不注入）。
 */
function renderMemorySnapshot(entries, opts = {}) {
    const count = Math.max(0, opts.count ?? exports.MEMORY_SNAPSHOT_COUNT);
    const recent = entries.slice(Math.max(0, entries.length - count));
    return recent.map(e => `- [${formatMemoryTime(e.createdAt)}] ${e.text}`).join('\n');
}
