"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.rollbackSession = rollbackSession;
exports.regenerateSession = regenerateSession;
exports.editUserMessage = editUserMessage;
exports.apply = apply;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const http_ts_1 = require("../dsht-plugin-shared/http.ts");
const session_surgery_ts_1 = require("../dsht-plugin-shared/session-surgery.ts");
const file_snapshots_ts_1 = require("../dsht-plugin-shared/file-snapshots.ts");
const workspace_snapshots_ts_1 = require("./workspace-snapshots.ts");
exports.name = 'dsht-plugin-undo';
// webServer：/dsht-undo/* 数据面；sessions：live 判定（内存态权威，live 拒绝截盘）
// （pre-step 事件钩子是 cordis 核心生命周期面，不算服务，无需 inject 'agents'）
exports.inject = ['webServer', 'sessions'];
/** 按 header.id 定位会话文件（扫 sessions 全树 session.jsonl 首行） */
async function locateSessionFile(dshHome, sessionId) {
    const hit = (await (0, session_surgery_ts_1.scanSessionHeaders)(dshHome)).find(h => h.sessionId === sessionId);
    return hit ? (0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl') : null;
}
/**
 * 截断后的配套文件恢复（best-effort，不让文件恢复失败掀翻已完成的截断）：
 * 截断点之后 turn 的工作区快照逆序整批恢复；能力关闭或无快照 → undefined。
 */
async function restoreFilesAfterTruncation(deps, sessionId, originalContent, keepThroughSeq) {
    if (deps.snapshots === undefined)
        return undefined;
    try {
        return await (0, workspace_snapshots_ts_1.restoreWorkspaceSnapshots)({
            sessionId,
            boundary: (0, file_snapshots_ts_1.snapshotRestoreBoundary)(originalContent, keepThroughSeq),
            config: deps.snapshots,
        });
    }
    catch (e) {
        return { restoredTurns: [], filesRestored: 0, filesDeleted: 0, errors: [`文件快照恢复失败：${e.message}`] };
    }
}
/** fileSnapshots 响应字段（与 dsht-rp-plugin session-rollback 同款形状） */
function fileSnapshotsBody(r) {
    return { turns: r.restoredTurns, restored: r.filesRestored, deleted: r.filesDeleted, errors: r.errors };
}
/**
 * 回退：{sessionId, keepThroughSeq} → session.jsonl 截断到 keepThroughSeq（含），
 * 先备份 <file>.bak。原地修改，不开新分支。
 */
async function rollbackSession(deps, payload) {
    const sessionId = String(payload.sessionId ?? '');
    const keepThroughSeq = Number(payload.keepThroughSeq ?? -1);
    if (!sessionId)
        return { code: 400, body: { error: 'sessionId required' } };
    if (!Number.isInteger(keepThroughSeq) || keepThroughSeq < 0) {
        return { code: 400, body: { error: 'keepThroughSeq 须为 >= 0 的整数' } };
    }
    if (deps.isLive(sessionId)) {
        return { code: 409, body: { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再回退' } };
    }
    const file = await locateSessionFile(deps.dshHome, sessionId);
    if (file === null)
        return { code: 404, body: { error: `session not found: ${sessionId}` } };
    const content = await (0, promises_1.readFile)(file, 'utf8');
    const r = (0, session_surgery_ts_1.truncateSessionJsonl)(content, keepThroughSeq);
    if (r.error)
        return { code: 400, body: { error: r.error } };
    if (r.dropped === 0)
        return { code: 200, body: { kept: r.kept, dropped: 0, truncatedTo: keepThroughSeq, note: 'no-op（没有更靠后的事件）' } };
    await (0, promises_1.writeFile)(`${file}.bak`, content, 'utf8'); // 截断前备份
    await (0, promises_1.writeFile)(file, r.content, 'utf8');
    const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, keepThroughSeq);
    console.log(`[dsht-plugin-undo] rollback: ${sessionId} → kept=${r.kept} dropped=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(',') ?? '(off)'}`);
    return {
        code: 200,
        body: {
            kept: r.kept, dropped: r.dropped, truncatedTo: keepThroughSeq,
            ...(fsnap === undefined ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }),
        },
    };
}
/**
 * 重新生成：{sessionId} → 截到最后一条 user/message（含），返回
 * {truncatedTo, lastUserText}。客户端拿 lastUserText 调 session.prompt 重发
 * （queue 模式）——本函数只做截断 + 取回文本。
 */
async function regenerateSession(deps, payload) {
    const sessionId = String(payload.sessionId ?? '');
    if (!sessionId)
        return { code: 400, body: { error: 'sessionId required' } };
    if (deps.isLive(sessionId)) {
        return { code: 409, body: { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再重新生成' } };
    }
    const file = await locateSessionFile(deps.dshHome, sessionId);
    if (file === null)
        return { code: 404, body: { error: `session not found: ${sessionId}` } };
    const content = await (0, promises_1.readFile)(file, 'utf8');
    const events = [];
    for (const line of content.split('\n').slice(1)) {
        if (!line.trim())
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch { /* 坏行跳过 */ }
    }
    const lastUser = (0, session_surgery_ts_1.findLastUserMessage)(events);
    if (!lastUser)
        return { code: 400, body: { error: '会话里没有用户消息（无可重新生成的锚点）' } };
    const r = (0, session_surgery_ts_1.truncateSessionJsonl)(content, lastUser.seq);
    if (r.error)
        return { code: 400, body: { error: r.error } };
    if (r.dropped === 0) {
        return { code: 200, body: { truncatedTo: lastUser.seq, truncated: 0, lastUserText: lastUser.text, note: 'no-op（最后一条用户消息之后没有事件）' } };
    }
    await (0, promises_1.writeFile)(`${file}.bak`, content, 'utf8'); // 截断前备份
    await (0, promises_1.writeFile)(file, r.content, 'utf8');
    // 截到最后用户消息 = 腰斩该 turn → includeBoundary，该 turn 内的文件改动一并回退
    const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, lastUser.seq);
    console.log(`[dsht-plugin-undo] regenerate: ${sessionId} → anchor=${lastUser.seq} truncated=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(',') ?? '(off)'}`);
    return {
        code: 200,
        body: {
            truncatedTo: lastUser.seq, truncated: r.dropped, lastUserText: lastUser.text,
            ...(fsnap === undefined ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }),
        },
    };
}
/**
 * 编辑已发送消息：{sessionId, seq, text} → 找到该 seq 的 user/message（真用户消息），
 * 截断到它**之前**（保留前一事件及更早；该消息其后的一切随之移除），返回 ok。
 * 客户端拿新文本调 session.prompt 重发（queue 模式）——「编辑并重发」语义。
 * 本函数只做截断定位 + 落盘；与 rollback/regenerate 同契约：原会话就地截断，
 * 先备份 .bak，live session 拒绝（409）。
 */
async function editUserMessage(deps, payload) {
    const sessionId = String(payload.sessionId ?? '');
    const seq = Number(payload.seq ?? -1);
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!sessionId)
        return { code: 400, body: { error: 'sessionId required' } };
    if (!Number.isInteger(seq) || seq < 0)
        return { code: 400, body: { error: 'seq 须为 >= 0 的整数' } };
    if (!text.trim())
        return { code: 400, body: { error: 'text 不能为空' } };
    if (deps.isLive(sessionId)) {
        return { code: 409, body: { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再编辑' } };
    }
    const file = await locateSessionFile(deps.dshHome, sessionId);
    if (file === null)
        return { code: 404, body: { error: `session not found: ${sessionId}` } };
    const content = await (0, promises_1.readFile)(file, 'utf8');
    // 找目标消息 + 它之前最后一个事件（seq 不连续——tool/compaction 等事件穿插）
    const lines = content.split('\n');
    let targetIdx = -1;
    const events = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim())
            continue;
        let ev = null;
        try {
            ev = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (ev === null || typeof ev.seq !== 'number')
            continue;
        if (targetIdx === -1 && ev.type === 'user/message' && ev.seq === seq
            && ev.data?.source?.kind === 'user') {
            targetIdx = events.length; // events 里尚未 push 目标 → 目标将落在 idx
        }
        events.push({ seq: ev.seq });
    }
    if (targetIdx === -1)
        return { code: 404, body: { error: `未找到该消息（seq=${seq} 的真用户消息不存在或已被截断）` } };
    const keepThroughSeq = targetIdx > 0 ? events[targetIdx - 1].seq : -1; // 前一事件；无前置事件 → 只留 header
    const r = (0, session_surgery_ts_1.truncateSessionJsonl)(content, keepThroughSeq);
    if (r.error)
        return { code: 400, body: { error: r.error } };
    if (r.dropped === 0)
        return { code: 200, body: { truncatedTo: keepThroughSeq, truncated: 0, note: 'no-op（该消息之后没有事件）' } };
    await (0, promises_1.writeFile)(`${file}.bak`, content, 'utf8'); // 截断前备份
    await (0, promises_1.writeFile)(file, r.content, 'utf8');
    // 腰斩该 turn → includeBoundary，该 turn 内的文件改动一并回退（重发后重新执行）
    const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, keepThroughSeq);
    console.log(`[dsht-plugin-undo] edit: ${sessionId} seq=${seq} → keep=${keepThroughSeq} truncated=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(',') ?? '(off)'}`);
    return {
        code: 200,
        body: {
            truncatedTo: keepThroughSeq, truncated: r.dropped,
            ...(fsnap === undefined ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }),
        },
    };
}
class TurnSnapshotCoordinator {
    config;
    /** 同一 (sessionId, turn) 的在途捕获去重（完成即清，幂等性由快照文件存在性兜底） */
    captures = new Map();
    /** 同一工作树的捕获串行化（多会话同仓库时避免交错读树） */
    workspaceTails = new Map();
    constructor(config) {
        this.config = config;
    }
    async capture(payload) {
        const sessionId = payload.agent?.id;
        const cwd = payload.agent?.session?.header?.cwd;
        const turn = payload.turn;
        if (typeof sessionId !== 'string' || sessionId === '' || typeof cwd !== 'string' || cwd === '')
            return;
        if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0)
            return;
        const key = `${sessionId}\0${turn}`;
        const existing = this.captures.get(key);
        if (existing !== undefined)
            return existing;
        const signal = payload.signal;
        const task = (async () => {
            try {
                await this.serializeWorkspace(cwd, async () => {
                    const r = await (0, workspace_snapshots_ts_1.captureWorkspaceSnapshot)({
                        sessionId, turn, cwd, config: this.config,
                        ...(signal === undefined ? {} : { signal }),
                    });
                    if (!r.skipped) {
                        console.log(`[dsht-plugin-undo] snapshot: ${sessionId} turn ${turn} → ${r.fileCount} 文件 / ${r.totalBytes} 字节 @ ${r.root}`);
                    }
                });
            }
            catch (e) {
                console.warn(`[dsht-plugin-undo] snapshot failed for ${sessionId} turn ${turn}: ${e.message}`);
            }
            finally {
                this.captures.delete(key);
            }
        })();
        this.captures.set(key, task);
        await task;
    }
    async serializeWorkspace(workspace, task) {
        const previous = this.workspaceTails.get(workspace) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(task);
        this.workspaceTails.set(workspace, current);
        try {
            await current;
        }
        finally {
            if (this.workspaceTails.get(workspace) === current)
                this.workspaceTails.delete(workspace);
        }
    }
}
function apply(ctx, rawConfig) {
    const dshHome = (0, http_ts_1.resolveDshHome)();
    const snapshots = (0, workspace_snapshots_ts_1.resolveWorkspaceSnapshotConfig)(dshHome, (rawConfig ?? {})) ?? undefined;
    const deps = {
        dshHome,
        isLive: (sessionId) => ctx.sessions?.get(sessionId) !== undefined,
        ...(snapshots === undefined ? {} : { snapshots }),
    };
    // 文件改动回退：每轮第一个模型 step 前打工作区快照（prepend 抢在其他
    // pre-step 消费者与模型调用之前；捕获阻塞该 step 以保证 before 语义）
    if (snapshots !== undefined && typeof ctx.on === 'function') {
        const coordinator = new TurnSnapshotCoordinator(snapshots);
        ctx.on('agent/pre-step', async (payload, next) => {
            const p = payload;
            if (p?.step === 1)
                await coordinator.capture(p);
            return next();
        }, { prepend: true });
        console.log(`[dsht-plugin-undo] workspace snapshots on (maxFiles=${snapshots.maxFiles} excludePrefixes=[${snapshots.excludePrefixes.join(', ')}] dir=${snapshots.storageDir})`);
    }
    (0, http_ts_1.registerPrefix)(ctx, '/dsht-undo', exports.name, async (sub, req, res) => {
        const request = req;
        if (request.method !== 'POST')
            return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
        const payload = await (0, http_ts_1.readJsonBody)(request);
        if (payload === null)
            return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json body' });
        if (sub === '/rollback') {
            const r = await rollbackSession(deps, payload);
            return (0, http_ts_1.sendJson)(res, r.code, r.body);
        }
        if (sub === '/regenerate') {
            const r = await regenerateSession(deps, payload);
            return (0, http_ts_1.sendJson)(res, r.code, r.body);
        }
        if (sub === '/edit') {
            const r = await editUserMessage(deps, payload);
            return (0, http_ts_1.sendJson)(res, r.code, r.body);
        }
        return (0, http_ts_1.sendJson)(res, 404, { error: `unknown route: ${sub}` });
    });
}
