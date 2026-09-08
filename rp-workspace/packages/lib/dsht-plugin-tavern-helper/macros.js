"use strict";
/**
 * 酒馆助手宏引擎的路由侧胶水（/dsht-tavern-helper/macros/expand）。
 * 引擎本体是纯函数（../dsht-plugin-shared/macros.ts，dsh-plugin pre-step 同款内联）；
 * 本模块负责：身份解析（rp.json macros + rp/persona.json active）、三级作用域合并视图、
 * setvar 落盘（含 undo 日志）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadActivePersona = loadActivePersona;
exports.resolveIdentity = resolveIdentity;
exports.runMacroExpand = runMacroExpand;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const macros_ts_1 = require("../dsht-plugin-shared/macros.ts");
const undo_ts_1 = require("../dsht-plugin-shared/undo.ts");
const variables_ts_1 = require("./variables.ts");
/** 读 rp/persona.json 的 active 条目（无文件/无 active → 空） */
async function loadActivePersona(dshHome) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'persona.json'), 'utf8'));
        const list = Array.isArray(parsed.list) ? parsed.list : [];
        const activeName = typeof parsed.active === 'string' ? parsed.active : null;
        const hit = activeName !== null ? list.find(p => p?.name === activeName) : undefined;
        if (!hit)
            return null;
        return {
            name: String(hit.name ?? ''),
            description: typeof hit.description === 'string' ? hit.description : '',
        };
    }
    catch {
        return null;
    }
}
/** 解析宏身份：char 取 rp/<slug>/rp.json 的 macros.char；user 优先 persona.json active，回落 rp.json macros.user */
async function resolveIdentity(dshHome, slug) {
    let char = '';
    let macrosUser = '';
    if (slug) {
        try {
            const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json'), 'utf8'));
            char = typeof rp?.macros?.char === 'string' && rp.macros.char ? rp.macros.char : String(rp?.characterName ?? '');
            macrosUser = typeof rp?.macros?.user === 'string' ? rp.macros.user : '';
        }
        catch { /* 无 rp.json */ }
    }
    const persona = await loadActivePersona(dshHome);
    return {
        user: persona?.name || macrosUser || '用户',
        char: char || '角色',
        persona: persona?.description ?? '',
    };
}
/**
 * /macros/expand 的执行体：{text, slug?, sessionId?} → {result, writes}。
 * setvar 落盘作用域：chat（有 sessionId）> character（有 slug）> global。
 * 写前把旧值追加进 per-session undo 日志（有 sessionId 时；任务 4 回滚联动）。
 */
async function runMacroExpand(deps, input) {
    const slug = input.slug ?? '';
    const sessionId = input.sessionId ?? '';
    const identity = await resolveIdentity(deps.dshHome, slug);
    const globalTree = await deps.loadScope('global', '', '');
    const characterTree = slug ? await deps.loadScope('character', slug, '') : {};
    const chatTree = sessionId ? await deps.loadScope('chat', '', sessionId) : {};
    const merged = (0, variables_ts_1.mergeScopes)(globalTree, characterTree, chatTree);
    const r = (0, macros_ts_1.expandTavernMacros)(input.text, {
        user: identity.user,
        char: identity.char,
        persona: identity.persona,
        getVar: path => (0, macros_ts_1.readVarPath)(merged, path),
        // C2 类宏作用域读取：kind → 各自作用域树（preset 无独立落盘 → global 兜底；
        // chat/message 宏族 → chat 树），unknown 语义不变
        scopeGet: (kind, path) => {
            if (kind === 'character')
                return (0, macros_ts_1.readVarPath)(characterTree, path);
            if (kind === 'preset' || kind === 'global')
                return (0, macros_ts_1.readVarPath)(globalTree, path);
            return (0, macros_ts_1.readVarPath)(chatTree, path);
        },
        stableSeed: sessionId ? `rp-${sessionId}` : slug ? `rp-${slug}` : 'rp-global',
    });
    if (r.writes.length > 0) {
        const scope = sessionId ? 'chat' : slug ? 'character' : 'global';
        let tree = await deps.loadScope(scope, slug, sessionId);
        if (sessionId) {
            // undo 日志：连续写同一路径时旧值应来自逐条演进中的树——逐条应用同时逐条记录
            const seq = [];
            let evolving = tree;
            for (const w of r.writes) {
                seq.push((0, undo_ts_1.makeUndoEntry)(scope, slug, w.path, evolving));
                evolving = (0, variables_ts_1.setByPath)(evolving, w.path, w.value);
            }
            await (0, undo_ts_1.appendUndoEntries)(deps.dshHome, sessionId, seq);
            tree = evolving;
        }
        else {
            for (const w of r.writes)
                tree = (0, variables_ts_1.setByPath)(tree, w.path, w.value);
        }
        await deps.beforeSave?.(scope, slug, sessionId);
        await deps.saveScope(scope, slug, sessionId, tree);
    }
    return { result: r.text, writes: r.writes, unknownMacros: r.unknownMacros };
}
