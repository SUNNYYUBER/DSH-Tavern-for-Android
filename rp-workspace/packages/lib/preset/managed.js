"use strict";
/**
 * P2#14 受管预设安装（digest + owner manifest 幂等安装）
 *
 * 参考 dsh-agent-rp src/preset.ts L107 installBundledAgentRpPreset（MIT）：
 * 预设目录带 `.dsht-rp-owner.json`（{owner, format:0, digest: sha256}），
 * 重装/升级时先比对当前内容与 manifest digest——
 * - 用户没动过（digest 一致）→ 幂等更新（staging 目录 + rename 原子替换）；
 * - 用户动过（digest 不一致 / owner=user / 无 manifest 的存量预设）→ 保留用户版本，
 *   返回 conflict 由调用方在响应/日志如实报告（force 可显式接管）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESET_OWNER_MANIFEST = void 0;
exports.digestPresetFiles = digestPresetFiles;
exports.readPresetOwnerManifest = readPresetOwnerManifest;
exports.installManagedPreset = installManagedPreset;
exports.markPresetUserOwned = markPresetUserOwned;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/** owner manifest 文件名（隐藏文件，随预设目录同生共死） */
exports.PRESET_OWNER_MANIFEST = '.dsht-rp-owner.json';
/** 内容 digest：文件名与内容配对进 sha256（排序无关） */
function digestPresetFiles(files) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const f of sorted) {
        hash.update(f.name);
        hash.update('\0');
        hash.update(f.content);
        hash.update('\0');
    }
    return hash.digest('hex');
}
/** 读目录内全部内容文件（manifest 除外；子目录记为空内容占位使 digest 变化） */
async function readDirContentFiles(dir) {
    const entries = await (0, promises_1.readdir)(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.name === exports.PRESET_OWNER_MANIFEST)
            continue;
        if (entry.isDirectory()) {
            files.push({ name: `${entry.name}/`, content: '' });
            continue;
        }
        files.push({ name: entry.name, content: await (0, promises_1.readFile)((0, node_path_1.join)(dir, entry.name), 'utf8') });
    }
    return files;
}
/** 读 owner manifest；缺失或非法（owner/format/digest 形状不符）一律 null → 按未知来源保守处理 */
async function readPresetOwnerManifest(dir) {
    let value;
    try {
        value = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, exports.PRESET_OWNER_MANIFEST), 'utf8'));
    }
    catch {
        return null;
    }
    const record = value;
    if ((record?.owner !== 'dsht-rp:import-st' && record?.owner !== 'user')
        || record.format !== 0 || typeof record.digest !== 'string') {
        return null;
    }
    return record;
}
async function inspectManagedPreset(dir) {
    let files;
    try {
        files = await readDirContentFiles(dir);
    }
    catch {
        return { kind: 'absent' }; // 目录不存在
    }
    const manifest = await readPresetOwnerManifest(dir);
    if (!manifest)
        return { kind: 'unknown' };
    if (manifest.owner === 'user')
        return { kind: 'user-owned', manifest };
    return digestPresetFiles(files) === manifest.digest
        ? { kind: 'unmodified', manifest }
        : { kind: 'modified', manifest };
}
/**
 * 幂等安装/升级受管预设。
 * @param dir 目标预设目录（$DSH_HOME/rp-presets/<id>）
 * @param files 受管内容文件（preset.json + 可选 regex.json；不给的文件在升级时被移除）
 * @param owner 安装方标记（import-st 路由固定 'dsht-rp:import-st'）
 * @param force 显式接管：无视 conflict 强制覆盖（并把 owner 重写为安装方）
 */
async function installManagedPreset(dir, files, owner, options = {}) {
    const status = await inspectManagedPreset(dir);
    const sourceDigest = digestPresetFiles(files);
    if (status.kind !== 'absent' && options.force !== true) {
        if (status.kind === 'unknown')
            return { outcome: 'conflict', reason: 'unknown' };
        if (status.kind === 'user-owned')
            return { outcome: 'conflict', reason: 'user-owned' };
        if (status.kind === 'modified')
            return { outcome: 'conflict', reason: 'modified' };
        if (status.manifest.digest === sourceDigest)
            return { outcome: 'unchanged' };
    }
    const manifest = { owner, format: 0, digest: sourceDigest };
    const parent = (0, node_path_1.dirname)(dir);
    const base = (0, node_path_1.basename)(dir);
    await (0, promises_1.mkdir)(parent, { recursive: true });
    // staging 目录写完再 rename——目标目录从不出现半成品状态
    const staging = (0, node_path_1.join)(parent, `.${base}.install-${process.pid}-${(0, node_crypto_1.randomUUID)()}`);
    await (0, promises_1.mkdir)(staging, { recursive: true });
    try {
        for (const f of files) {
            await (0, promises_1.writeFile)((0, node_path_1.join)(staging, f.name), f.content, 'utf8');
        }
        await (0, promises_1.writeFile)((0, node_path_1.join)(staging, exports.PRESET_OWNER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    catch (error) {
        await (0, promises_1.rm)(staging, { recursive: true, force: true });
        throw error;
    }
    if (status.kind === 'absent') {
        try {
            await (0, promises_1.rename)(staging, dir);
            return { outcome: 'created' };
        }
        catch (error) {
            await (0, promises_1.rm)(staging, { recursive: true, force: true });
            throw error;
        }
    }
    // 已存在：先 rename 到 backup 再换入 staging，失败回滚
    const backup = (0, node_path_1.join)(parent, `.${base}.backup-${process.pid}-${(0, node_crypto_1.randomUUID)()}`);
    await (0, promises_1.rename)(dir, backup);
    try {
        await (0, promises_1.rename)(staging, dir);
    }
    catch (error) {
        await (0, promises_1.rename)(backup, dir);
        await (0, promises_1.rm)(staging, { recursive: true, force: true });
        throw error;
    }
    await (0, promises_1.rm)(backup, { recursive: true, force: true });
    return { outcome: 'updated' };
}
/**
 * 用户保存（preset/save）后标记用户接管：manifest owner=user + 当前内容 digest。
 * 之后 import-st 同 id 重装会得到 conflict(user-owned) 而非静默冲掉用户改动。
 */
async function markPresetUserOwned(dir) {
    const files = await readDirContentFiles(dir);
    const manifest = { owner: 'user', format: 0, digest: digestPresetFiles(files) };
    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, exports.PRESET_OWNER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
