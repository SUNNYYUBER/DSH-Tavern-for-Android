"use strict";
/**
 * 酒馆助手 API 服务端门面路由——数据面真路由实现（原记名拒绝项的落地）。
 *
 * 纯函数族设计：resolveDshHome 的 $DSH_HOME 环境变量不可按调用注入，故所有
 * 处理函数显式接收 dshHome 首参（index.ts 闭包传入），IO 之外的转换逻辑全可单测。
 *
 * 数据面（$DSH_HOME 布局）：
 * - 预设：rp-presets/<id>/preset.json（RPPreset：slots + toggles + sampling 等；id/displayName）
 * - 正则：global = rp/regex/global.json（{scripts:[]}）；character = rp/<slug>/rp.json 的 regex 键；
 *   preset = rp-presets/<id>/regex.json（{scripts:[]}）——脚本对象即 ST RegexScript 形状
 * - 世界书：skills 下 wb-* 目录的 references/lore.json（LoreBook）+ rp/global-books.json（{books:[{name,lorePath}]}）
 * - 会话状态：rp/state/<sessionId>.json（presetId 键；历史扁平 MVU 裸树兼容）
 * - 会话消息：sessions/<projectKey>/<sid>/session.jsonl（首行 header + {type,seq,data} 事件行）
 *
 * 写文件前统一走 snapshotBeforeWrite 快照（归属会话尽量解析——有 sessionId 才记；
 * 解析不到 turn 锚点/快照失败都不阻塞写）。
 *
 * 诚实边界：扩展管理/importRaw*、persona/character CRUD、聊天消息写路径等不做——
 * index.ts 维持记名拒绝（404），不在本文件实现。generate/generateRaw 不在本文件（C9：
 * index.ts 的 /generate loopback 转发 dsh-plugin /dsht-rp/llm/classify）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStPromptView = buildStPromptView;
exports.listPresets = listPresets;
exports.resolveSessionPresetId = resolveSessionPresetId;
exports.presetIdByName = presetIdByName;
exports.slugifyPresetId = slugifyPresetId;
exports.context = context;
exports.presetNames = presetNames;
exports.presetGet = presetGet;
exports.presetExport = presetExport;
exports.presetPut = presetPut;
exports.presetDelete = presetDelete;
exports.presetRename = presetRename;
exports.presetLoad = presetLoad;
exports.chatMessages = chatMessages;
exports.regexesGet = regexesGet;
exports.regexesReplace = regexesReplace;
exports.worldbookList = worldbookList;
exports.loreEntryToSt = loreEntryToSt;
exports.stEntryToLore = stEntryToLore;
exports.worldbookGet = worldbookGet;
exports.worldbookEntryPut = worldbookEntryPut;
exports.variablesMerge = variablesMerge;
exports.variableSchemaRegister = variableSchemaRegister;
exports.worldbookReplaceEntries = worldbookReplaceEntries;
exports.worldbookRebindGlobal = worldbookRebindGlobal;
exports.worldbookRebindChar = worldbookRebindChar;
exports.worldbookChatGetOrCreate = worldbookChatGetOrCreate;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_readline_1 = require("node:readline");
const schema_ts_1 = require("../preset/schema.ts");
const entry_ts_1 = require("../lore/entry.ts");
const session_surgery_ts_1 = require("../dsht-plugin-shared/session-surgery.ts");
const file_snapshots_ts_1 = require("../dsht-plugin-shared/file-snapshots.ts");
const schema_ts_2 = require("../dsht-plugin-shared/schema.ts");
const undo_ts_1 = require("../dsht-plugin-shared/undo.ts");
const variables_ts_1 = require("./variables.ts");
const for_session_ts_1 = require("./for-session.ts");
function isTree(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
// ---------------------------------------------------------------------------
// StPrompt 视图构建（/context 与 /preset/get 两处共用）
// ---------------------------------------------------------------------------
/**
 * RPPreset → ST 预设视图 { prompts, prompt_order }：
 * - slots → StPrompt（depth 有值 = injection_position 1 绝对深度注入；marker 槽 system_prompt=false）
 * - toggles 每个 option → `toggle-<group>-<option>` 条目（system 注入位）
 * - prompt_order 单档 character_id 100001，按上面顺序全量列出：
 *   enabled = slot.enabled / option.selected（选一组里非 selected 的也列出 enabled:false）
 */
function buildStPromptView(preset) {
    const prompts = [];
    const order = [];
    for (const slot of preset.slots) {
        prompts.push({
            identifier: slot.id,
            name: slot.id,
            role: slot.role ?? 'system',
            content: slot.content ?? '',
            system_prompt: slot.type === 'system' || slot.type === 'skillRef',
            marker: slot.type === 'marker',
            injection_position: slot.depth != null ? 1 : 0,
            injection_depth: slot.depth ?? 100,
        });
        order.push({ identifier: slot.id, enabled: slot.enabled });
    }
    for (const group of preset.toggles) {
        for (const option of group.options) {
            const identifier = `toggle-${group.group}-${option.id}`;
            prompts.push({
                identifier,
                name: option.label,
                role: 'system',
                content: option.content,
                system_prompt: true,
                marker: false,
                injection_position: 0,
                injection_depth: 100,
            });
            order.push({ identifier, enabled: option.selected === true });
        }
    }
    return { prompts, prompt_order: [{ character_id: 100001, order }] };
}
/** rp-presets/<id>/preset.json 清单（坏 preset.json 跳过；按 id 排序稳定输出） */
async function listPresets(dshHome) {
    const out = [];
    let dirs = [];
    try {
        dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'));
    }
    catch {
        return out;
    }
    for (const id of dirs.sort()) {
        try {
            const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', id, 'preset.json'), 'utf8'));
            if (isTree(p))
                out.push({ id, displayName: typeof p.displayName === 'string' && p.displayName ? p.displayName : id, preset: p });
        }
        catch { /* 坏 preset.json 跳过 */ }
    }
    return out;
}
/**
 * 会话有效预设解析（与 index.ts /scripts/for-session 同款语义）：
 * rp/state/<sid>.json 的 presetId 键（presetIdFromStateFile，历史扁平 MVU 裸树 = 无 presetId）
 * → 缺省回落最近 rp-import 批次 settings.json 的 ST 激活预设名，按 displayName 匹配 rp-presets。
 */
async function resolveSessionPresetId(dshHome, sessionId) {
    try {
        const file = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8'));
        const pid = (0, for_session_ts_1.presetIdFromStateFile)(file);
        if (pid)
            return pid;
    }
    catch { /* 无状态文件 */ }
    try {
        const batches = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import')))
            .filter(b => /^[a-z0-9][a-z0-9-]{0,60}$/.test(b)).sort().reverse();
        for (const b of batches) {
            const dir = (0, node_path_1.join)(dshHome, 'rp-import', b);
            let stRoot = 'data/default-user';
            try {
                const meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot)
                    stRoot = meta.manifest.stRoot;
            }
            catch { /* 无 meta 用默认 */ }
            let activeName = null;
            try {
                activeName = (0, for_session_ts_1.activePresetNameFromSettings)(JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'unpacked', stRoot, 'settings.json'), 'utf8')));
            }
            catch {
                continue;
            }
            if (!activeName)
                continue;
            const presets = (await listPresets(dshHome)).map(p => ({ id: p.id, displayName: p.displayName }));
            return (0, for_session_ts_1.matchPresetByDisplayName)(presets, activeName);
        }
    }
    catch { /* 无批次 = 无默认预设 */ }
    return null;
}
/** displayName 精确匹配 → presetId（matchPresetByDisplayName 语义；null = 未匹配） */
async function presetIdByName(dshHome, name) {
    if (!name)
        return null;
    const presets = await listPresets(dshHome);
    return (0, for_session_ts_1.matchPresetByDisplayName)(presets.map(p => ({ id: p.id, displayName: p.displayName })), name);
}
/** 预设名 → 新建 preset id（[a-z0-9][a-z0-9-]*，与既有 preset id / rp-import 批次约定一致） */
function slugifyPresetId(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
    if (!slug)
        return 'preset';
    return /^[a-z0-9]/.test(slug) ? slug : `p-${slug}`;
}
/** rp/<slug>/rp.json 的 characterName（缺省回落 slug） */
async function characterNameOf(dshHome, slug) {
    try {
        const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json'), 'utf8'));
        return typeof rp?.characterName === 'string' && rp.characterName ? rp.characterName : slug;
    }
    catch {
        return slug;
    }
}
/** 写前快照（归属会话尽量解析：有 sessionId 才记；解析不到/失败不阻塞写） */
async function snapshotFor(dshHome, sessionId, relPaths) {
    if (!sessionId)
        return;
    try {
        await (0, file_snapshots_ts_1.snapshotBeforeWrite)(dshHome, sessionId, relPaths);
    }
    catch { /* 快照失败不阻塞写操作 */ }
}
/** $DSH_HOME 相对路径（posix 形态）→ 绝对路径 */
function homePath(dshHome, relPath) {
    return (0, node_path_1.join)(dshHome, ...relPath.split('/'));
}
// ---------------------------------------------------------------------------
// 端点 1：POST /context {sessionId, slug} → 会话有效预设的 ST 上下文视图
// ---------------------------------------------------------------------------
async function context(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    const slug = String(body.slug ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    const presetId = await resolveSessionPresetId(dshHome, sessionId);
    if (!presetId)
        return { status: 404, body: { error: '会话无有效预设' } };
    let preset;
    try {
        preset = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, `rp-presets/${presetId}/preset.json`), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `preset.json not found: ${presetId}` } };
    }
    const view = buildStPromptView(preset);
    const characterName = slug ? await characterNameOf(dshHome, slug) : '';
    return {
        status: 200,
        body: {
            presetId,
            presetName: typeof preset.displayName === 'string' ? preset.displayName : presetId,
            character: { name: characterName },
            chatCompletionSettings: { prompts: view.prompts, prompt_order: view.prompt_order },
        },
    };
}
// ---------------------------------------------------------------------------
// 端点 2-6：预设清单 / 读 / 锚定写 / 删 / 改名 / 加载绑定
// ---------------------------------------------------------------------------
/** POST /preset/names {sessionId?} → { names, loaded } */
async function presetNames(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    const presets = await listPresets(dshHome);
    let loaded = null;
    if (sessionId) {
        const pid = await resolveSessionPresetId(dshHome, sessionId);
        loaded = presets.find(p => p.id === pid)?.displayName ?? null;
    }
    return { status: 200, body: { names: presets.map(p => p.displayName), loaded } };
}
/**
 * 预设名 → presetId（ST 哨兵名 'in_use' = 会话当前加载的预设——ST 预设脚本惯例
 * getPreset('in_use')；resolveSessionPresetId 兜底最近导入批次激活预设）。
 * null = 未匹配（'in_use' 且会话无有效预设也归此列）。
 */
async function resolvePresetIdByName(dshHome, name, sessionId) {
    if (name === 'in_use')
        return resolveSessionPresetId(dshHome, sessionId);
    const presets = await listPresets(dshHome);
    return (0, for_session_ts_1.matchPresetByDisplayName)(presets.map(p => ({ id: p.id, displayName: p.displayName })), name);
}
/** POST /preset/get {name, sessionId?} → { found, preset: { name, prompts, prompt_order } } */
async function presetGet(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const presetId = await resolvePresetIdByName(dshHome, name, String(body.sessionId ?? ''));
    const hit = presetId ? (await listPresets(dshHome)).find(p => p.id === presetId) : undefined;
    if (!hit)
        return { status: 200, body: { found: false, preset: null } };
    const view = buildStPromptView(hit.preset);
    return {
        status: 200,
        body: { found: true, preset: { name: hit.displayName, prompts: view.prompts, prompt_order: view.prompt_order } },
    };
}
/**
 * POST /preset/export {name, sessionId?} → { name, json }（预设分享导出）。
 * json = ST「OpenAI Settings」兼容视图（prompts/prompt_order 走 /context 同款
 * buildStPromptView；预设作用域正则还原为 ST extensions.regex_scripts——字段一一
 * 对应，可直接经「导入 ST 预设」回灌，分享闭环）。
 */
async function presetExport(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const presetId = await resolvePresetIdByName(dshHome, name, String(body.sessionId ?? ''));
    const hit = presetId ? (await listPresets(dshHome)).find(p => p.id === presetId) : undefined;
    if (!hit)
        return { status: 404, body: { error: `preset not found: ${name}` } };
    const view = buildStPromptView(hit.preset);
    const regexScripts = [];
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, `rp-presets/${hit.id}/regex.json`), 'utf8'));
        for (const s of Array.isArray(parsed?.scripts) ? parsed.scripts : []) {
            regexScripts.push({
                scriptName: s.scriptName,
                findRegex: s.findRegex,
                replaceString: s.replaceString,
                trimStrings: s.trimStrings,
                placement: s.placement,
                disabled: s.disabled,
                markdownOnly: s.markdownOnly,
                promptOnly: s.promptOnly,
                runOnEdit: s.runOnEdit,
                substituteRegex: s.substituteRegex,
                minDepth: s.minDepth,
                maxDepth: s.maxDepth,
            });
        }
    }
    catch { /* 无 regex.json = 无内嵌正则 */ }
    return {
        status: 200,
        body: {
            name: hit.displayName,
            json: {
                name: hit.displayName,
                prompts: view.prompts,
                prompt_order: view.prompt_order,
                extensions: { regex_scripts: regexScripts },
            },
        },
    };
}
/**
 * POST /preset/put {name, prompts, prompt_order, create?, sessionId?} → identifier 锚定合并。
 * 不整体覆盖（保住 knowledge/budget/model/sampling/skill 槽），逐 StPrompt 归位：
 * 1. identifier 精确匹配现有 slot.id → 更新 content/enabled/depth/role（marker 槽只动 enabled）；
 * 2. `toggle-<group>-<option>` → 更新 option.content / option.selected(=enabled)；
 * 3. name 字段匹配 marker 槽位也认（ST marker identifier 与我方槽位名不一致时靠 name 对上）；
 * 4. 都没匹配上的非 marker 条目 → 追加新 system 槽（id 去重化）。
 */
async function presetPut(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const rawPrompts = Array.isArray(body.prompts) ? body.prompts : null;
    if (!rawPrompts)
        return { status: 400, body: { error: 'prompts array required' } };
    const sessionId = String(body.sessionId ?? '');
    // displayName 匹配找 id（ST 哨兵 'in_use' = 会话当前预设）；找不到且 create=true → emptyPreset 骨架新建；否则 404
    const presetId = await resolvePresetIdByName(dshHome, name, sessionId);
    let preset;
    let targetId;
    if (presetId) {
        targetId = presetId;
        preset = (await listPresets(dshHome)).find(p => p.id === presetId).preset;
    }
    else if (body.create === true) {
        targetId = slugifyPresetId(name);
        preset = (0, schema_ts_1.emptyPreset)(targetId, name);
    }
    else {
        return { status: 404, body: { error: `preset not found: ${name}` } };
    }
    // prompt_order → identifier → enabled（取 100001 通用档，缺档取首个；不在表内的条目视为启用）
    const orders = Array.isArray(body.prompt_order) ? body.prompt_order.filter(isTree) : [];
    const orderEntry = orders.find(o => o.character_id === 100001 && Array.isArray(o.order))
        ?? orders.find(o => Array.isArray(o.order));
    const enabledById = new Map();
    if (orderEntry) {
        for (const it of orderEntry.order.filter(isTree)) {
            if (typeof it.identifier === 'string')
                enabledById.set(it.identifier, it.enabled !== false);
        }
    }
    const usedIds = new Set(preset.slots.map(s => s.id));
    for (const raw of rawPrompts) {
        if (!isTree(raw))
            continue;
        const identifier = typeof raw.identifier === 'string' ? raw.identifier : '';
        const pName = typeof raw.name === 'string' ? raw.name : '';
        const content = typeof raw.content === 'string' ? raw.content : '';
        const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : 'system';
        const enabled = enabledById.get(identifier) ?? true;
        const depth = raw.injection_position === 1 && typeof raw.injection_depth === 'number' && Number.isFinite(raw.injection_depth)
            ? raw.injection_depth
            : null;
        // 1) identifier 精确匹配现有槽位
        const slot = preset.slots.find(s => s.id === identifier);
        if (slot) {
            slot.enabled = enabled;
            if (slot.type !== 'marker') {
                slot.content = content;
                slot.role = role;
                if (depth != null)
                    slot.depth = depth;
                else
                    delete slot.depth;
            }
            continue;
        }
        // 2) toggle-<group>-<option> 匹配（选一组/多选组统一：selected = ST enabled）
        let toggleHit = false;
        for (const g of preset.toggles) {
            for (const o of g.options) {
                if (identifier === `toggle-${g.group}-${o.id}`) {
                    o.content = content;
                    o.selected = enabled;
                    toggleHit = true;
                }
            }
        }
        if (toggleHit)
            continue;
        // 3) name 字段匹配 marker 槽位也认
        const markerSlot = preset.slots.find(s => s.type === 'marker' && s.id === pName);
        if (markerSlot) {
            markerSlot.enabled = enabled;
            continue;
        }
        // 4) 都没匹配上的非 marker 条目 → 追加新 system 槽（id 去重化；marker 条目无对应槽，跳过）
        if (raw.marker === true)
            continue;
        let base = (pName || identifier || 'prompt').trim().slice(0, 40);
        if (!base)
            base = 'prompt';
        let id = base;
        for (let n = 2; usedIds.has(id); n++)
            id = `${base}-${n}`;
        usedIds.add(id);
        const newSlot = { id, type: 'system', content, enabled, role };
        if (depth != null)
            newSlot.depth = depth;
        preset.slots.push(newSlot);
    }
    const relPath = `rp-presets/${targetId}/preset.json`;
    await snapshotFor(dshHome, sessionId, [relPath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), 'utf8');
    console.log(`[dsht-th] preset/put: ${name} → ${targetId}（slots=${preset.slots.length}）`);
    return { status: 200, body: { ok: true, presetId: targetId } };
}
/** POST /preset/delete {name} → 删 rp-presets/<id> 目录 → {ok} */
async function presetDelete(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const presetId = await presetIdByName(dshHome, name);
    if (!presetId)
        return { status: 404, body: { error: `preset not found: ${name}` } };
    const sessionId = String(body.sessionId ?? '');
    await snapshotFor(dshHome, sessionId, [`rp-presets/${presetId}/preset.json`, `rp-presets/${presetId}/regex.json`]);
    await (0, promises_1.rm)((0, node_path_1.join)(dshHome, 'rp-presets', presetId), { recursive: true, force: true });
    console.log(`[dsht-th] preset/delete: ${name} → ${presetId}`);
    return { status: 200, body: { ok: true } };
}
/** POST /preset/rename {name, newName} → 改 displayName → {ok} */
async function presetRename(dshHome, body) {
    const name = String(body.name ?? '');
    const newName = String(body.newName ?? '');
    if (!name || !newName)
        return { status: 400, body: { error: 'name and newName required' } };
    const presetId = await presetIdByName(dshHome, name);
    if (!presetId)
        return { status: 404, body: { error: `preset not found: ${name}` } };
    const relPath = `rp-presets/${presetId}/preset.json`;
    let preset;
    try {
        preset = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, relPath), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `preset.json not found: ${presetId}` } };
    }
    preset.displayName = newName;
    await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath]);
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), 'utf8');
    console.log(`[dsht-th] preset/rename: ${name} → ${newName}（${presetId}）`);
    return { status: 200, body: { ok: true, presetId } };
}
/**
 * POST /preset/load {sessionId, name} → 解析 id，写 rp/state/<sid>.json 的 presetId（保留其他键）。
 * 历史扁平 MVU 裸树兼容：文件没有任何保留键且非空 = 整树是 variables（MVU 裸树），
 * 包成 { variables: 原树 } 再写 presetId（与 dsh-plugin STATE_RESERVED_KEYS 逻辑对齐）。
 */
async function presetLoad(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    const name = String(body.name ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const presetId = await presetIdByName(dshHome, name);
    if (!presetId)
        return { status: 404, body: { error: `preset not found: ${name}` } };
    const relPath = `rp/state/${sessionId}.json`;
    let file = {};
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, relPath), 'utf8'));
        if (isTree(parsed))
            file = parsed;
    }
    catch { /* 新会话状态文件 */ }
    if (!Object.keys(file).some(k => for_session_ts_1.STATE_RESERVED_KEYS.has(k)) && Object.keys(file).length > 0) {
        file = { variables: file };
    }
    file.presetId = presetId;
    await snapshotFor(dshHome, sessionId, [relPath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(file), 'utf8');
    console.log(`[dsht-th] preset/load: ${name} → ${presetId}（sid=${sessionId}）`);
    return { status: 200, body: { ok: true, presetId } };
}
// ---------------------------------------------------------------------------
// 端点 8：POST /chat/messages {sessionId} → 只读聊天记录导出（StMessage[]）
// ---------------------------------------------------------------------------
/** header.cwd → rp 工作区 slug（cwd 在 <dshHome>/rp/ 下时取首段；否则 null） */
function rpSlugFromCwd(dshHome, cwd) {
    if (!cwd)
        return null;
    const rel = (0, node_path_1.relative)((0, node_path_1.join)(dshHome, 'rp'), (0, node_path_1.resolve)(cwd));
    if (!rel || rel.startsWith('..'))
        return null; // 不在 rp/ 下（或就是 rp/ 本身）
    const slug = rel.split(/[\\/]/)[0];
    return slug || null;
}
/**
 * 会话消息 → StMessage[]（只读）：
 * scanSessionHeaders 定位 session.jsonl → readline 流式逐行（大日志不整读），
 * 只解析 user/message / assistant/message 事件（data 形状见 session-surgery findLastUserMessage：
 * user = Message 本体，assistant = {turn, step, message}）；快照注入与空文本不进导出。
 */
async function chatMessages(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    const hit = (await (0, session_surgery_ts_1.scanSessionHeaders)(dshHome)).find(h => h.sessionId === sessionId);
    if (!hit)
        return { status: 404, body: { error: `session not found: ${sessionId}` } };
    // 角色名：header.cwd 指向 rp 工作区时读 rp.json.characterName；取不到回落 'Assistant'
    let charName = 'Assistant';
    const slug = rpSlugFromCwd(dshHome, hit.cwd);
    if (slug) {
        try {
            const rp = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, `rp/${slug}/rp.json`), 'utf8'));
            if (typeof rp?.characterName === 'string' && rp.characterName)
                charName = rp.characterName;
        }
        catch { /* 无 rp.json 用缺省 */ }
    }
    const messages = [];
    const rl = (0, node_readline_1.createInterface)({
        input: (0, node_fs_1.createReadStream)((0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl'), 'utf8'),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        const t = line.trim();
        if (!t)
            continue;
        let ev;
        try {
            ev = JSON.parse(t);
        }
        catch {
            continue;
        } // 坏行跳过
        let role;
        let msg;
        if (ev.type === 'user/message') {
            role = 'user';
            msg = ev.data;
        }
        else if (ev.type === 'assistant/message') {
            role = 'assistant';
            msg = ev.data?.message;
        }
        else
            continue;
        if (!isTree(msg))
            continue;
        const source = isTree(msg.source) ? msg.source : null;
        if (source?.form === 'snapshot')
            continue; // 快照注入（内部工作过程）不进聊天导出
        const content = msg.content;
        const text = Array.isArray(content)
            ? content.filter(isTree).filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n')
            : typeof content === 'string' ? content : '';
        if (!text)
            continue;
        messages.push({
            message_id: messages.length,
            name: role === 'user' ? 'User' : charName,
            role,
            message: text,
            is_system: false,
        });
    }
    return { status: 200, body: { messages } };
}
/** 读 {scripts:[]} 文件，逐条加 _dshtScope 标记（文件缺失/坏 JSON = 空组） */
async function loadTaggedScripts(dshHome, relPath, scope) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, relPath), 'utf8'));
        if (!Array.isArray(parsed.scripts))
            return [];
        return parsed.scripts.filter(isTree).map(s => ({ ...s, _dshtScope: scope }));
    }
    catch {
        return [];
    }
}
/** 读 rp.json 的 regex 键（角色作用域；与 global/preset 的 {scripts:[]} 包裹形态不同），逐条加标记 */
async function loadCharacterRegex(dshHome, slug) {
    try {
        const rp = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, `rp/${slug}/rp.json`), 'utf8'));
        if (!Array.isArray(rp.regex))
            return [];
        return rp.regex.filter(isTree).map(s => ({ ...s, _dshtScope: 'character' }));
    }
    catch {
        return [];
    }
}
/** POST /regexes/get {slug?, sessionId?} → 三源合并 { regexes, presetId, slug }（global → character → preset） */
async function regexesGet(dshHome, body) {
    const slug = String(body.slug ?? '');
    const sessionId = String(body.sessionId ?? '');
    const regexes = [
        ...(await loadTaggedScripts(dshHome, 'rp/regex/global.json', 'global')),
        ...(slug ? await loadCharacterRegex(dshHome, slug) : []),
    ];
    let presetId = null;
    if (sessionId) {
        presetId = await resolveSessionPresetId(dshHome, sessionId);
        if (presetId)
            regexes.push(...(await loadTaggedScripts(dshHome, `rp-presets/${presetId}/regex.json`, 'preset')));
    }
    return { status: 200, body: { regexes, presetId, slug: slug || null } };
}
/**
 * POST /regexes/replace {regexes, scope, slug?, sessionId?, presetId?} → 整组替换语义。
 * global → rp/regex/global.json；character → rp/<slug>/rp.json 的 regex 键；
 * preset → rp-presets/<presetId>/regex.json（presetId 缺省时从 sessionId 解析会话有效预设）。
 */
async function regexesReplace(dshHome, body) {
    const scope = String(body.scope ?? '');
    const slug = String(body.slug ?? '');
    const sessionId = String(body.sessionId ?? '');
    if (!Array.isArray(body.regexes))
        return { status: 400, body: { error: 'regexes array required' } };
    const scripts = body.regexes.filter(isTree);
    if (scope === 'global') {
        const relPath = 'rp/regex/global.json';
        await snapshotFor(dshHome, sessionId, [relPath]);
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
        await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify({ scripts }, null, 1), 'utf8');
        console.log(`[dsht-th] regexes/replace global: ${scripts.length}`);
        return { status: 200, body: { ok: true, count: scripts.length } };
    }
    if (scope === 'character') {
        if (!slug)
            return { status: 400, body: { error: 'slug required for character scope' } };
        const relPath = `rp/${slug}/rp.json`;
        let rp;
        try {
            rp = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, relPath), 'utf8'));
        }
        catch {
            return { status: 404, body: { error: `rp.json not found: ${slug}` } };
        }
        rp.regex = scripts;
        await snapshotFor(dshHome, sessionId, [relPath]);
        await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), 'utf8');
        console.log(`[dsht-th] regexes/replace character: ${slug} → ${scripts.length}`);
        return { status: 200, body: { ok: true, count: scripts.length } };
    }
    if (scope === 'preset') {
        const presetId = String(body.presetId ?? '') || (sessionId ? await resolveSessionPresetId(dshHome, sessionId) : null);
        if (!presetId)
            return { status: 400, body: { error: 'presetId required（或提供可解析的 sessionId）' } };
        const dir = (0, node_path_1.join)(dshHome, 'rp-presets', presetId);
        try {
            await (0, promises_1.readdir)(dir);
        }
        catch {
            return { status: 404, body: { error: `预设不存在：${presetId}` } };
        }
        const relPath = `rp-presets/${presetId}/regex.json`;
        await snapshotFor(dshHome, sessionId, [relPath]);
        await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'regex.json'), JSON.stringify({ scripts }, null, 1), 'utf8');
        console.log(`[dsht-th] regexes/replace preset: ${presetId} → ${scripts.length}`);
        return { status: 200, body: { ok: true, count: scripts.length } };
    }
    return { status: 400, body: { error: 'scope must be global/character/preset' } };
}
// ---------------------------------------------------------------------------
// 端点 11-13：世界书清单 / 读（ST entry 形状）/ 条目锚定合并
// ---------------------------------------------------------------------------
/** 扫 skills 下 wb-* 目录的 references/lore.json + rp/global-books.json（lorePath 去重） */
async function worldbookList(dshHome, _body) {
    const books = [];
    const seen = new Set();
    try {
        for (const dir of (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'skills'))).sort()) {
            if (!dir.startsWith('wb-'))
                continue;
            const lorePath = `skills/${dir}/references/lore.json`;
            if (seen.has(lorePath))
                continue;
            try {
                const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
                seen.add(lorePath);
                books.push({ name: typeof parsed?.name === 'string' && parsed.name ? parsed.name : dir, lorePath });
            }
            catch { /* 无 lore.json 的目录跳过 */ }
        }
    }
    catch { /* 无 skills 目录 */ }
    try {
        const g = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, 'rp/global-books.json'), 'utf8'));
        if (Array.isArray(g.books)) {
            for (const b of g.books.filter(isTree)) {
                if (typeof b.lorePath !== 'string' || !b.lorePath || seen.has(b.lorePath))
                    continue;
                seen.add(b.lorePath);
                books.push({ name: typeof b.name === 'string' && b.name ? b.name : b.lorePath, lorePath: b.lorePath });
            }
        }
    }
    catch { /* 无全局书单 */ }
    return { status: 200, body: { books } };
}
/** 按书名定位 lore.json（$DSH_HOME 相对路径）：目录名或 lore.json 的 name 字段，global-books 按名兜底 */
async function locateBook(dshHome, name) {
    try {
        for (const dir of (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'skills'))).sort()) {
            if (!dir.startsWith('wb-'))
                continue;
            const lorePath = `skills/${dir}/references/lore.json`;
            if (dir === name)
                return lorePath;
            try {
                const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
                if (parsed?.name === name)
                    return lorePath;
            }
            catch { /* 坏文件跳过 */ }
        }
    }
    catch { /* 无 skills 目录 */ }
    try {
        const g = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, 'rp/global-books.json'), 'utf8'));
        if (Array.isArray(g.books)) {
            for (const b of g.books.filter(isTree)) {
                if (b.name === name && typeof b.lorePath === 'string' && b.lorePath)
                    return b.lorePath;
            }
        }
    }
    catch { /* 无全局书单 */ }
    // 【实机审计修复 2026-09-05】P1：会话绑定世界书（getOrCreateChatWorldbook 落点，
    // getWorldbook/getLorebookEntries/replaceLorebookEntries 因此可按名定位会话书）
    try {
        const dir = (0, node_path_1.join)(dshHome, 'rp', 'chat-worldbooks');
        for (const f of (await (0, promises_1.readdir)(dir)).sort()) {
            if (!f.endsWith('.json'))
                continue;
            const p = `rp/chat-worldbooks/${f}`;
            if (f.replace(/\.json$/, '') === name)
                return p;
            try {
                const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, p), 'utf8'));
                if (parsed?.name === name)
                    return p;
            }
            catch { /* 坏文件跳过 */ }
        }
    }
    catch { /* 无 chat-worldbooks 目录 */ }
    return null;
}
/** LoreEntry → ST World Info entry 形状（uid = 数组下标，entry-put 锚定用） */
function loreEntryToSt(entry, uid) {
    return {
        uid,
        comment: entry.comment,
        content: entry.content,
        key: entry.keys,
        keysecondary: entry.secondaryKeys,
        selectiveLogic: entry.selectiveLogic,
        constant: entry.constant,
        selective: entry.selective,
        position: entry.position,
        depth: entry.depth,
        role: entry.role,
        scanDepth: entry.scanDepth,
        preventRecursion: entry.preventRecursion,
        excludeRecursion: entry.excludeRecursion,
        order: entry.insertionOrder,
        sticky: entry.sticky,
        cooldown: entry.cooldown,
        delay: entry.delay,
        group: entry.group,
        groupOverride: entry.groupOverride,
        disabled: !entry.enabled,
    };
}
/** ST World Info entry → LoreEntry（反转换；字段缺省走 importLoreBook 同款默认） */
function stEntryToLore(st, bookName, id) {
    const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String).filter(k => k !== '');
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
        id,
        comment: typeof st.comment === 'string' ? st.comment : '',
        content: typeof st.content === 'string' ? st.content : '',
        keys: arr(st.key ?? st.keys),
        secondaryKeys: arr(st.keysecondary ?? st.secondaryKeys),
        selectiveLogic: num(st.selectiveLogic, 0),
        constant: st.constant === true,
        selective: st.selective === true,
        position: num(st.position, entry_ts_1.WI_POSITION.BEFORE),
        depth: num(st.depth, 4),
        role: st.role === 'user' || st.role === 'assistant' ? st.role : 'system',
        scanDepth: typeof st.scanDepth === 'number' && Number.isFinite(st.scanDepth) ? st.scanDepth : null,
        preventRecursion: st.preventRecursion === true,
        excludeRecursion: st.excludeRecursion === true,
        insertionOrder: num(st.order ?? st.insertionOrder, 100),
        sticky: num(st.sticky, 0),
        cooldown: num(st.cooldown, 0),
        delay: num(st.delay, 0),
        group: typeof st.group === 'string' ? st.group : '',
        groupOverride: st.groupOverride === true,
        enabled: st.disabled !== true,
        book: bookName,
    };
}
/** POST /worldbook/get {name} → 按 name（目录名或 lore.json 的 name 字段）读 lore.json → ST entry 形状 */
async function worldbookGet(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    const lorePath = await locateBook(dshHome, name);
    if (!lorePath)
        return { status: 404, body: { error: `worldbook not found: ${name}` } };
    let book;
    try {
        book = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } };
    }
    const entries = Array.isArray(book.entries) ? book.entries : [];
    return {
        status: 200,
        body: {
            name: typeof book.name === 'string' && book.name ? book.name : name,
            lorePath,
            entries: entries.map((e, i) => loreEntryToSt(e, i)),
            importWarnings: Array.isArray(book.importWarnings) ? book.importWarnings : [],
        },
    };
}
/**
 * POST /worldbook/entry-put {name, entry, sessionId?} → uid 或 comment 锚定合并回 lore.json。
 * uid（= 数组下标）命中 → 原位替换（保留原 id）；uid 越界/新条目 → comment 兜底；都没中 → 追加
 * （新 id = lore-<书名>-<下标>）。ST 形状反转换 LoreEntry（stEntryToLore）。
 */
async function worldbookEntryPut(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    if (!isTree(body.entry))
        return { status: 400, body: { error: 'entry object required' } };
    const entry = body.entry;
    const lorePath = await locateBook(dshHome, name);
    if (!lorePath)
        return { status: 404, body: { error: `worldbook not found: ${name}` } };
    let book;
    try {
        book = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } };
    }
    const entries = Array.isArray(book.entries) ? book.entries : [];
    const comment = typeof entry.comment === 'string' ? entry.comment : '';
    // 锚定：uid（数组下标）优先，comment 兜底；都没中 = 新条目追加
    const uidNum = Number(entry.uid);
    const uidOk = Number.isInteger(uidNum) && uidNum >= 0 && uidNum < entries.length;
    let idx = uidOk ? uidNum : entries.findIndex(e => comment !== '' && e.comment === comment);
    if (idx >= 0) {
        entries[idx] = stEntryToLore(entry, name, entries[idx].id);
    }
    else {
        entries.push(stEntryToLore(entry, name, `lore-${name}-${entries.length}`));
        idx = entries.length - 1;
    }
    book.name = typeof book.name === 'string' && book.name ? book.name : name;
    book.entries = entries;
    await snapshotFor(dshHome, String(body.sessionId ?? ''), [lorePath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, lorePath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), 'utf8');
    console.log(`[dsht-th] worldbook/entry-put: ${name} #${idx}（共 ${entries.length} 条）`);
    return { status: 200, body: { ok: true, uid: idx, count: entries.length } };
}
// ---------------------------------------------------------------------------
// 端点 14-15：变量深合并写入（insertOrAssignVariables 数据面）+ 变量 schema 注册（C7 收口）
// ---------------------------------------------------------------------------
/** 读 rp/state/<sid>.json（C7 变量收口用；历史扁平 MVU 裸树 = 包成 {variables: 原树}，与 presetLoad 对齐） */
async function loadSessionStateFile(dshHome, sessionId) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, `rp/state/${sessionId}.json`), 'utf8'));
        if (!isTree(parsed))
            return {};
        if (!Object.keys(parsed).some(k => for_session_ts_1.STATE_RESERVED_KEYS.has(k)) && Object.keys(parsed).length > 0) {
            return { variables: parsed };
        }
        return parsed;
    }
    catch {
        return {};
    }
}
/**
 * 端点 14：POST /variables/merge {sessionId, variables} → 变量深合并写入（C7：
 * shim insertOrAssignVariables chat 作用域的服务端语义——incoming 覆盖既有叶值，对象递归）。
 * 整树 variableSchema 存在时先做 D7 最小子集校验（422 {error, issues} 不落盘不记 undo）；
 * 内容变化时写前 undo 日志 + 文件快照（与 /dsht-mvu/variables/register 同款收口）。
 */
async function variablesMerge(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    if (!isTree(body.variables))
        return { status: 400, body: { error: 'variables object required' } };
    const relPath = `rp/state/${sessionId}.json`;
    const file = await loadSessionStateFile(dshHome, sessionId);
    const before = isTree(file.variables) ? file.variables : {};
    const merged = (0, variables_ts_1.deepMergeVars)(before, body.variables);
    if (JSON.stringify(before) === JSON.stringify(merged)) {
        return { status: 200, body: { ok: true, variables: merged, unchanged: true } };
    }
    if (file.variableSchema != null) {
        const issues = (0, schema_ts_2.validateSchemaSubset)(merged, file.variableSchema);
        if (issues.length > 0)
            return { status: 422, body: { error: 'variableSchema 校验失败', issues } };
    }
    await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, (0, undo_ts_1.diffUndoEntries)('chat', '', before, merged));
    await snapshotFor(dshHome, sessionId, [relPath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify({ ...file, variables: merged }), 'utf8');
    console.log(`[dsht-th] variables/merge: sid=${sessionId}（${Object.keys(body.variables).length} 顶层键）`);
    return { status: 200, body: { ok: true, variables: merged } };
}
/**
 * 端点 15：POST /variables/schema {sessionId, name?, variableSchema} → C7 registerVariableSchema
 * 数据面：zod 风格 schema（shim 侧经 zod v4 toJSONSchema 转换后过桥）落 rp/state 的 variableSchema。
 * name 给出 = 逐名子 schema（合成 {type:'object', properties:{[name]:…}} 并入既有整树 schema，
 * 使 D7 对后续写入自然生效）；name 空 = 整树 schema 直接替换。注册即校验既有值（不匹配 422；
 * 该键尚未写入时不拦——允许先立 schema 后补值）。
 */
async function variableSchemaRegister(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    if (!isTree(body.variableSchema))
        return { status: 400, body: { error: 'variableSchema object required' } };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const relPath = `rp/state/${sessionId}.json`;
    const file = await loadSessionStateFile(dshHome, sessionId);
    const vars = isTree(file.variables) ? file.variables : {};
    const target = name ? vars[name] : vars;
    if (target !== undefined) {
        const issues = (0, schema_ts_2.validateSchemaSubset)(target, body.variableSchema, name ? `$${name}` : '$');
        if (issues.length > 0)
            return { status: 422, body: { error: '既有变量与 schema 不匹配', issues } };
    }
    if (name) {
        const base = isTree(file.variableSchema) ? file.variableSchema : {};
        const props = isTree(base.properties) ? { ...base.properties } : {};
        props[name] = body.variableSchema;
        file.variableSchema = { ...base, type: typeof base.type === 'string' ? base.type : 'object', properties: props };
    }
    else {
        file.variableSchema = body.variableSchema;
    }
    await snapshotFor(dshHome, sessionId, [relPath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(file), 'utf8');
    console.log(`[dsht-th] variables/schema: sid=${sessionId} ${name || '(整树)'}`);
    return { status: 200, body: { ok: true } };
}
// ---------------------------------------------------------------------------
// 端点 16-19（【实机审计修复 2026-09-05】P1 世界书写面：replaceLorebookEntries /
// rebindGlobalWorldbooks / rebindCharWorldbooks / getOrCreateChatWorldbook 数据面）
// ---------------------------------------------------------------------------
/**
 * 端点 16：POST /worldbook/replace-entries {name, entries, sessionId?} → 世界书条目整表替换
 * （replaceLorebookEntries 数据面）：ST World Info entry 形状数组逐条 stEntryToLore 反转换
 * 后整体覆盖 lore.json 的 entries（与 entry-put 的锚定合并不同——这是整表替换语义）。
 */
async function worldbookReplaceEntries(dshHome, body) {
    const name = String(body.name ?? '');
    if (!name)
        return { status: 400, body: { error: 'name required' } };
    if (!Array.isArray(body.entries))
        return { status: 400, body: { error: 'entries array required' } };
    const lorePath = await locateBook(dshHome, name);
    if (!lorePath)
        return { status: 404, body: { error: `worldbook not found: ${name}` } };
    let book;
    try {
        book = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } };
    }
    const entries = body.entries
        .filter(isTree)
        .map((st, i) => stEntryToLore(st, name, typeof st.id === 'string' && st.id ? st.id : `lore-${name}-${i}`));
    book.name = typeof book.name === 'string' && book.name ? book.name : name;
    book.entries = entries;
    await snapshotFor(dshHome, String(body.sessionId ?? ''), [lorePath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, lorePath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), 'utf8');
    console.log(`[dsht-th] worldbook/replace-entries: ${name} → ${entries.length} 条`);
    return { status: 200, body: { ok: true, count: entries.length } };
}
/** 书名数组 → 定位为 [{name, lorePath}]（任一未定位 = null，调用方回 404） */
async function resolveBookList(dshHome, names) {
    const out = [];
    for (const name of names) {
        const lorePath = await locateBook(dshHome, name);
        if (!lorePath)
            return null;
        out.push({ name, lorePath });
    }
    return out;
}
/**
 * 端点 17：POST /worldbook/rebind-global {books: name[], sessionId?} → 全局激活书单整组重绑
 * （rebindGlobalWorldbooks 数据面）：书名逐个定位后整组替换 rp/global-books.json 的 books。
 */
async function worldbookRebindGlobal(dshHome, body) {
    if (!Array.isArray(body.books))
        return { status: 400, body: { error: 'books array required' } };
    const names = body.books.map(n => String(n)).filter(n => n !== '');
    const resolved = await resolveBookList(dshHome, names);
    if (resolved === null)
        return { status: 404, body: { error: `worldbook not found in: [${names.join(', ')}]` } };
    const relPath = 'rp/global-books.json';
    await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, relPath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify({ books: resolved }, null, 1), 'utf8');
    console.log(`[dsht-th] worldbook/rebind-global: [${names.join(', ')}]`);
    return { status: 200, body: { ok: true, count: resolved.length } };
}
/**
 * 端点 18：POST /worldbook/rebind-char {slug, books: name[], sessionId?} → 角色工作区书单整组重绑
 * （rebindCharWorldbooks 数据面）：rp/<slug>/rp.json 的 books 数组整组替换（保留其余键）。
 */
async function worldbookRebindChar(dshHome, body) {
    const slug = String(body.slug ?? '');
    if (!slug)
        return { status: 400, body: { error: 'slug required' } };
    if (!Array.isArray(body.books))
        return { status: 400, body: { error: 'books array required' } };
    const names = body.books.map(n => String(n)).filter(n => n !== '');
    const relPath = `rp/${slug}/rp.json`;
    let rp;
    try {
        rp = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, relPath), 'utf8'));
    }
    catch {
        return { status: 404, body: { error: `rp.json not found: ${slug}` } };
    }
    const resolved = await resolveBookList(dshHome, names);
    if (resolved === null)
        return { status: 404, body: { error: `worldbook not found in: [${names.join(', ')}]` } };
    rp.books = resolved;
    await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath]);
    await (0, promises_1.writeFile)(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), 'utf8');
    console.log(`[dsht-th] worldbook/rebind-char: ${slug} → [${names.join(', ')}]`);
    return { status: 200, body: { ok: true, count: resolved.length } };
}
/**
 * 端点 19：POST /worldbook/chat-get-or-create {sessionId} → 会话绑定世界书缺则建
 * （getOrCreateChatWorldbook 数据面）：确定性命名 chat-<sessionId>，文件落在
 * rp/chat-worldbooks/<sessionId>.json（LoreBook；locateBook 已扩展按名定位）——
 * 幂等：已存在直接返回 {name, created:false}。
 */
async function worldbookChatGetOrCreate(dshHome, body) {
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId)
        return { status: 400, body: { error: 'sessionId required' } };
    const name = `chat-${sessionId}`;
    const lorePath = `rp/chat-worldbooks/${sessionId}.json`;
    try {
        const existing = JSON.parse(await (0, promises_1.readFile)(homePath(dshHome, lorePath), 'utf8'));
        if (isTree(existing))
            return { status: 200, body: { name: typeof existing.name === 'string' && existing.name ? existing.name : name, created: false } };
    }
    catch { /* 不存在 → 创建 */ }
    const book = { name, entries: [], importWarnings: [] };
    await snapshotFor(dshHome, sessionId, [lorePath]);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(homePath(dshHome, lorePath)), { recursive: true });
    await (0, promises_1.writeFile)(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), 'utf8');
    console.log(`[dsht-th] worldbook/chat-get-or-create: sid=${sessionId} → ${name}`);
    return { status: 200, body: { name, created: true } };
}
