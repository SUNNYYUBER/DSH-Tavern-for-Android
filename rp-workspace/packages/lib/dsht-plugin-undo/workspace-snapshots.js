"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWorkspaceSnapshotConfig = resolveWorkspaceSnapshotConfig;
exports.hasTurnSnapshot = hasTurnSnapshot;
exports.discoverWorkspaceRoot = discoverWorkspaceRoot;
exports.captureWorkspaceSnapshot = captureWorkspaceSnapshot;
exports.restoreWorkspaceSnapshots = restoreWorkspaceSnapshots;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function positiveInt(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
/** 解析配置；enabled === false → null（能力关闭）。storageDir 锚在 dshHome 下。 */
function resolveWorkspaceSnapshotConfig(dshHome, config = {}) {
    if (config.enabled === false)
        return null;
    return {
        storageDir: (0, node_path_1.join)(dshHome, 'undo', 'file-history'),
        maxFiles: positiveInt(config.maxFiles, 100_000),
        maxFileBytes: positiveInt(config.maxFileBytes, 16 * 1024 * 1024),
        maxSnapshotBytes: positiveInt(config.maxSnapshotBytes, 512 * 1024 * 1024),
        maxTurnsPerSession: positiveInt(config.maxTurnsPerSession, 30),
        excludePrefixes: (config.excludePrefixes ?? [])
            .filter((p) => typeof p === 'string' && p !== '')
            .map(p => p.replaceAll('\\', '/')),
    };
}
function snapshotsDir(config, sessionId) {
    return (0, node_path_1.join)(config.storageDir, 'snapshots', sessionId);
}
function manifestPath(config, sessionId, turn) {
    return (0, node_path_1.join)(snapshotsDir(config, sessionId), `${turn}.json`);
}
function blobsDir(config) {
    return (0, node_path_1.join)(config.storageDir, 'blobs');
}
/** 该 turn 是否已有快照（已捕获的 turn 不重复捕获：保留最早 before 状态） */
async function hasTurnSnapshot(config, sessionId, turn) {
    try {
        await (0, promises_1.lstat)(manifestPath(config, sessionId, turn));
        return true;
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// git 清点（移植 turn-rewind src/git.ts，精简掉 sparse/submodule/operation 围栏——
// 本插件恢复快照不进 git 对象库，git 仅用于取工作树根与文件清单）
// ---------------------------------------------------------------------------
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
function git(cwd, args, signal) {
    return new Promise((resolvePromise, reject) => {
        (0, node_child_process_1.execFile)('git', ['-c', 'core.quotepath=false', '-C', cwd, ...args], {
            encoding: 'utf8',
            maxBuffer: GIT_MAX_BUFFER,
            windowsHide: true,
            signal,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
        }, (error, stdout, stderr) => {
            if (error !== null) {
                reject(new Error(`git ${args.join(' ')} failed in ${JSON.stringify(cwd)}: ${String(stderr).trim() || error.message}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}
/** 会话 cwd 所属 git 工作树根（realpath 规范化；非 git 目录抛错 → 无快照） */
async function discoverWorkspaceRoot(cwd, signal) {
    const canonical = await (0, promises_1.realpath)(cwd);
    const root = await (0, promises_1.realpath)((await git(canonical, ['rev-parse', '--show-toplevel'], signal)).trim());
    if (!(0, node_path_1.isAbsolute)(root))
        throw new Error(`git 返回非绝对工作树根: ${JSON.stringify(root)}`);
    return root;
}
/** 仓库相对路径校验（posix 形态，拒 .. 越界与绝对路径） */
function validateRelativePath(path) {
    const p = path.replaceAll('\\', '/');
    if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) {
        throw new Error(`非法仓库相对路径: ${JSON.stringify(path)}`);
    }
    return p;
}
function splitNul(value) {
    if (value === '')
        return [];
    const parts = value.split('\0');
    if (parts.at(-1) === '')
        parts.pop();
    return parts;
}
/** 清点受跟踪 + 未忽略文件（excludePrefixes 在清点层过滤，恢复删除集同源——永不越界） */
async function listEligiblePaths(root, config, signal) {
    const output = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], signal);
    // --others 对嵌套仓库（如内嵌 worktree）只报目录本身（尾斜杠）——排除，
    // 它们是独立检出，不属于本工作树文件。
    const all = [...new Set(splitNul(output).filter(p => !p.endsWith('/')).map(validateRelativePath))].sort();
    const prefixes = config.excludePrefixes;
    const paths = prefixes.length === 0
        ? all
        : all.filter(p => !prefixes.some(prefix => p === prefix || p.startsWith(prefix)));
    if (paths.length > config.maxFiles) {
        throw new Error(`[TOO_MANY_FILES] 工作区有 ${paths.length} 个可快照文件，超过配置上限 ${config.maxFiles}`);
    }
    return paths;
}
/** 单文件捕获（读前后 lstat 比对防读到写一半的内容；3 次重试） */
async function captureEntry(root, path, config, store, signal) {
    const target = (0, node_path_1.join)(root, ...path.split('/'));
    for (let attempt = 0; attempt < 3; attempt += 1) {
        signal?.throwIfAborted();
        let before;
        try {
            before = await (0, promises_1.lstat)(target);
        }
        catch {
            return undefined; // 清点后被删 → 不进快照
        }
        const mode = before.mode & 0o777;
        if (before.isSymbolicLink()) {
            const linkTarget = await (0, promises_1.readlink)(target);
            const after = await (0, promises_1.lstat)(target);
            if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
                continue;
            return { entry: { kind: 'symlink', target: linkTarget, mode } };
        }
        if (!before.isFile())
            return undefined; // 目录（gitlink 子模块等）跳过
        if (before.size > config.maxFileBytes) {
            throw new Error(`[FILE_TOO_LARGE] ${JSON.stringify(path)} 有 ${before.size} 字节，超过单文件上限 ${config.maxFileBytes}`);
        }
        const content = await (0, promises_1.readFile)(target);
        signal?.throwIfAborted();
        const after = await (0, promises_1.lstat)(target);
        if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || content.length !== after.size)
            continue;
        const blob = (0, node_crypto_1.createHash)('sha256').update(content).digest('hex');
        if (store) {
            const dir = blobsDir(config);
            await (0, promises_1.mkdir)(dir, { recursive: true });
            try {
                await (0, promises_1.writeFile)((0, node_path_1.join)(dir, blob), content, { flag: 'wx' }); // 内容寻址：已存在即去重命中
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
        }
        return { entry: { kind: 'file', blob, size: content.length, mode }, content };
    }
    throw new Error(`[WORKSPACE_CHANGED_DURING_CAPTURE] ${JSON.stringify(path)} 捕获期间反复变化`);
}
/** 清点 + 逐文件捕获（store=true 时内容写 blob 池） */
async function captureTree(root, config, store, signal) {
    const paths = await listEligiblePaths(root, config, signal);
    const entries = Object.create(null);
    let totalBytes = 0;
    for (const path of paths) {
        signal?.throwIfAborted();
        const captured = await captureEntry(root, path, config, store, signal);
        if (captured === undefined)
            continue;
        if (captured.entry.kind === 'file') {
            totalBytes += captured.entry.size;
            if (totalBytes > config.maxSnapshotBytes) {
                throw new Error(`[SNAPSHOT_TOO_LARGE] 可快照文件聚合超过上限 ${config.maxSnapshotBytes} 字节`);
            }
        }
        entries[path] = captured.entry;
    }
    return { entries, totalBytes };
}
/**
 * 按 turn 锚点捕获工作区快照（在该 turn 第一个模型 step 前调用）。
 * 已有同 turn 快照 → 跳过。捕获后按 maxTurnsPerSession 裁剪旧快照并回收无主 blob。
 */
async function captureWorkspaceSnapshot(options) {
    const { sessionId, turn, config } = options;
    if (await hasTurnSnapshot(config, sessionId, turn)) {
        return { root: '', turn, fileCount: 0, totalBytes: 0, skipped: true };
    }
    const root = await discoverWorkspaceRoot(options.cwd, options.signal);
    const tree = await captureTree(root, config, true, options.signal);
    const snapshot = {
        version: 1,
        sessionId,
        turn,
        createdAt: Date.now(),
        root,
        fileCount: Object.keys(tree.entries).length,
        totalBytes: tree.totalBytes,
        entries: tree.entries,
    };
    const file = manifestPath(config, sessionId, turn);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(file), { recursive: true });
    await (0, promises_1.writeFile)(file, JSON.stringify(snapshot), 'utf8');
    await pruneSessionSnapshots(config, sessionId);
    return { root, turn, fileCount: snapshot.fileCount, totalBytes: tree.totalBytes, skipped: false };
}
/** 每会话快照数裁剪（保留最新 maxTurnsPerSession 个 turn），随后回收无主 blob */
async function pruneSessionSnapshots(config, sessionId) {
    const turns = await listSnapshotTurns(config, sessionId);
    const stale = turns.sort((a, b) => b - a).slice(config.maxTurnsPerSession);
    for (const turn of stale)
        await (0, promises_1.rm)(manifestPath(config, sessionId, turn), { force: true });
    if (stale.length > 0)
        await collectGarbageBlobs(config);
}
async function listSnapshotTurns(config, sessionId) {
    let names = [];
    try {
        names = await (0, promises_1.readdir)(snapshotsDir(config, sessionId));
    }
    catch {
        return [];
    }
    return names
        .map(n => (/^(\d+)\.json$/.exec(n)?.[1]))
        .filter((s) => typeof s === 'string')
        .map(Number);
}
/** blob 池回收：扫全部会话清单收集引用，删除无主 blob */
async function collectGarbageBlobs(config) {
    const referenced = new Set();
    let sessionIds = [];
    try {
        sessionIds = await (0, promises_1.readdir)((0, node_path_1.join)(config.storageDir, 'snapshots'));
    }
    catch {
        return;
    }
    for (const sessionId of sessionIds) {
        for (const turn of await listSnapshotTurns(config, sessionId)) {
            try {
                const manifest = JSON.parse(await (0, promises_1.readFile)(manifestPath(config, sessionId, turn), 'utf8'));
                for (const entry of Object.values(manifest.entries ?? {})) {
                    if (entry.kind === 'file')
                        referenced.add(entry.blob);
                }
            }
            catch { /* 坏清单不阻塞回收 */ }
        }
    }
    let blobs = [];
    try {
        blobs = await (0, promises_1.readdir)(blobsDir(config));
    }
    catch {
        return;
    }
    for (const blob of blobs) {
        if (!referenced.has(blob))
            await (0, promises_1.rm)((0, node_path_1.join)(blobsDir(config), blob), { force: true }).catch(() => { });
    }
}
function entriesDiffer(left, right) {
    if (left.kind !== right.kind)
        return true;
    if (left.kind === 'file' && right.kind === 'file')
        return left.blob !== right.blob || left.size !== right.size;
    if (left.kind === 'symlink' && right.kind === 'symlink')
        return left.target !== right.target;
    return true;
}
/**
 * 逆序整批恢复：把 fromTurn 之后（includeBoundary 时含 fromTurn 本身）的 turn
 * 快照从新到旧逐个 diff 当前工作树并恢复差异集，恢复成功的清单随即删除。
 * 净效果 = 工作区回到最早被截 turn 开始前的状态；缺失清单的 turn 跳过（best-effort）。
 */
async function restoreWorkspaceSnapshots(options) {
    const { sessionId, boundary, config } = options;
    const result = { restoredTurns: [], filesRestored: 0, filesDeleted: 0, errors: [] };
    const turns = (await listSnapshotTurns(config, sessionId))
        .filter(t => t > boundary.fromTurn || (boundary.includeBoundary && t === boundary.fromTurn))
        .sort((a, b) => b - a); // 逆序：最新 turn 先恢复，逐层回到更早的 before 状态
    for (const turn of turns) {
        const file = manifestPath(config, sessionId, turn);
        let snapshot;
        try {
            snapshot = JSON.parse(await (0, promises_1.readFile)(file, 'utf8'));
            if (typeof snapshot.root !== 'string' || typeof snapshot.entries !== 'object' || snapshot.entries === null) {
                throw new Error('清单缺少 root/entries');
            }
        }
        catch (e) {
            result.errors.push(`${turn}.json: 快照损坏（${e.message}），跳过`);
            continue;
        }
        // 当前工作树清点失败（仓库没了/git 不可用）→ 按空树处理：只写回快照内容，不做删除
        let current = Object.create(null);
        try {
            current = (await captureTree(snapshot.root, config, false)).entries;
        }
        catch (e) {
            result.errors.push(`${turn}.json: 当前工作树清点失败（${e.message}），仅恢复既有文件`);
        }
        const paths = [...new Set([...Object.keys(snapshot.entries), ...Object.keys(current)])].sort();
        for (const path of paths) {
            const before = snapshot.entries[path];
            const now = current[path];
            const target = (0, node_path_1.join)(snapshot.root, ...path.split('/'));
            try {
                if (before !== undefined && (now === undefined || entriesDiffer(before, now))) {
                    // 被改/被删 → 写回 before 内容
                    if (before.kind === 'file') {
                        const content = await (0, promises_1.readFile)((0, node_path_1.join)(blobsDir(config), before.blob));
                        await (0, promises_1.rm)(target, { force: true }); // 符号链接/类型变化先清掉
                        await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
                        await (0, promises_1.writeFile)(target, content);
                    }
                    else {
                        const { symlink } = await import('node:fs/promises');
                        await (0, promises_1.rm)(target, { force: true });
                        await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
                        await symlink(before.target, target);
                    }
                    result.filesRestored++;
                }
                else if (before === undefined && now !== undefined) {
                    // 快照时还不存在（该 turn 新增）→ 删除（清点只含文件/符号链接）
                    await (0, promises_1.rm)(target, { force: true });
                    result.filesDeleted++;
                }
            }
            catch (e) {
                result.errors.push(`${path}: ${e.message}`);
            }
        }
        await (0, promises_1.rm)(file, { force: true }); // 已恢复的快照记录删除
        result.restoredTurns.push(turn);
    }
    if (result.restoredTurns.length > 0)
        await collectGarbageBlobs(config);
    return result;
}
