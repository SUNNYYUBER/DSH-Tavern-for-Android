"use strict";
/**
 * DSHTavern 酒馆助手插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 2。
 *
 * SillyTavern 酒馆助手（extension_settings.tavern_helper）的意图级移植：
 * - 变量作用域子系统：global（rp/variables/global.json）/ character（rp/<slug>/variables.json）/
 *   chat（rp/state/<sessionId>.json 的 variables 键）三级 GET/PUT/DELETE + 合并视图（chat>character>global）
 * - 脚本执行沙箱：JSON 描述的脚本注册表 + 白名单 action 执行器（不 eval 任意 JS）
 *
 * 路由前缀 /dsht-tavern-helper（避开 /dsht-rp）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.apply = apply;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const variables_ts_1 = require("./variables.ts");
const scripts_ts_1 = require("./scripts.ts");
const session_store_ts_1 = require("./session-store.ts");
const facade = __importStar(require("./facade.ts"));
const for_session_ts_1 = require("./for-session.ts");
const macros_ts_1 = require("./macros.ts");
const undo_ts_1 = require("../dsht-plugin-shared/undo.ts");
const file_snapshots_ts_1 = require("../dsht-plugin-shared/file-snapshots.ts");
const http_ts_1 = require("../dsht-plugin-shared/http.ts");
const settings_ns_ts_1 = require("../dsht-plugin-shared/settings-ns.ts");
exports.name = 'dsht-plugin-tavern-helper';
// services 声明：webServer = /dsht-tavern-helper/* 同源数据面；settings = 命名空间锚点（设置→插件「可配置」可见性）
exports.inject = ['webServer', 'settings'];
// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）
const SCOPES = [...session_store_ts_1.TAVERN_SCOPES];
/** 会话持有层（preset/message/script 走 TavernSessionStore 快照；global/character/chat 为共享文件层） */
const SESSION_HELD = new Set(['preset', 'message', 'script']);
/** 作用域参数合法性（script 作用域需 scriptId；会话持有层需 sessionId） */
function scopeArgError(scope, slug, sessionId, scriptId) {
    if (!SCOPES.includes(scope))
        return `scope must be one of ${SCOPES.join('/')}`;
    if (scope === 'character' && !slug)
        return 'slug required for character scope';
    if (SESSION_HELD.has(scope) && !sessionId)
        return `sessionId required for ${scope} scope`;
    if (scope === 'chat' && !sessionId)
        return 'sessionId required for chat scope';
    if (scope === 'script' && !scriptId)
        return 'scriptId required for script scope';
    return null;
}
function apply(ctx, _config) {
    const dshHome = (0, http_ts_1.resolveDshHome)();
    // 任务 C2：设置→插件「可配置」可见性锚点（失败不影响本体）
    (0, settings_ns_ts_1.registerSettingsNamespace)(ctx, 'dsht-plugin-tavern-helper', 'dsht-th');
    const scriptsPath = (0, node_path_1.join)(dshHome, 'rp', 'tavern-helper', 'scripts.json');
    /** 会话持有层 store（preset/message/script；内存权威 + 快照落盘 rp/state/<sid>.json 的 tavern 键） */
    const sessionStore = new session_store_ts_1.TavernSessionStore({
        readStateFile: async (sid) => {
            try {
                const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sid}.json`), 'utf8'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            }
            catch {
                return null;
            }
        },
        writeStateFile: async (sid, file) => {
            const p = (0, node_path_1.join)(dshHome, 'rp', 'state', `${sid}.json`);
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
            await (0, promises_1.writeFile)(p, JSON.stringify(file), 'utf8');
        },
    });
    /** 作用域 → 变量树读取（chat 作用域 = 会话状态文件的 variables 键；会话持有层走快照 store） */
    const loadScope = async (scope, slug, sessionId, scriptId = '') => {
        try {
            if (scope === 'global') {
                const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'variables', 'global.json'), 'utf8'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            }
            if (scope === 'character') {
                if (!slug)
                    return {};
                const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'variables.json'), 'utf8'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            }
            if (scope === 'preset' || scope === 'message') {
                const snap = await sessionStore.get(sessionId);
                return structuredClone(snap.scopes[scope]);
            }
            if (scope === 'script') {
                const snap = await sessionStore.get(sessionId);
                return structuredClone(snap.scripts[scriptId] ?? {});
            }
            if (!sessionId)
                return {};
            const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8'));
            const vars = parsed?.variables;
            return vars && typeof vars === 'object' && !Array.isArray(vars) ? vars : {};
        }
        catch {
            return {}; // 无文件/坏 JSON = 空树
        }
    };
    const saveScope = async (scope, slug, sessionId, tree, scriptId = '') => {
        if (scope === 'global') {
            const p = (0, node_path_1.join)(dshHome, 'rp', 'variables', 'global.json');
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
            await (0, promises_1.writeFile)(p, JSON.stringify(tree), 'utf8');
            return;
        }
        if (scope === 'character') {
            const p = (0, node_path_1.join)(dshHome, 'rp', slug, 'variables.json');
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
            await (0, promises_1.writeFile)(p, JSON.stringify(tree), 'utf8');
            return;
        }
        if (scope === 'preset' || scope === 'message') {
            await sessionStore.mutate(sessionId, { scope, tree });
            return;
        }
        if (scope === 'script') {
            await sessionStore.mutate(sessionId, { scope: 'script', scriptId, tree });
            return;
        }
        const p = (0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`);
        let file = {};
        try {
            const parsed = JSON.parse(await (0, promises_1.readFile)(p, 'utf8'));
            if (parsed && typeof parsed === 'object')
                file = parsed;
        }
        catch { /* 新会话状态文件 */ }
        file.variables = tree;
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
        await (0, promises_1.writeFile)(p, JSON.stringify(file), 'utf8');
    };
    const loadScripts = async () => {
        try {
            const parsed = JSON.parse(await (0, promises_1.readFile)(scriptsPath, 'utf8'));
            return Array.isArray(parsed.scripts) ? parsed.scripts : [];
        }
        catch {
            return [];
        }
    };
    const saveScripts = async (scripts) => {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(scriptsPath), { recursive: true });
        await (0, promises_1.writeFile)(scriptsPath, JSON.stringify({ scripts }, null, 1), 'utf8');
    };
    /** 任务 1：写前文件快照（有 sessionId 才记——回滚以会话为单位；失败不阻塞写） */
    const snapshotFiles = async (sessionId, relPaths) => {
        if (!sessionId)
            return;
        try {
            await (0, file_snapshots_ts_1.snapshotBeforeWrite)(dshHome, sessionId, relPaths);
        }
        catch { /* 快照失败不阻塞写操作 */ }
    };
    /** 作用域 → $DSH_HOME 相对文件路径（与 saveScope 落盘点一一对应） */
    const scopeRelPath = (scope, slug, sessionId) => scope === 'global' ? 'rp/variables/global.json'
        : scope === 'character' ? `rp/${slug}/variables.json`
            : `rp/state/${sessionId}.json`;
    (0, http_ts_1.registerPrefix)(ctx, '/dsht-tavern-helper', 'dsht-th', async (sub, req, res) => {
        const method = req.method ?? 'GET';
        const q = (0, http_ts_1.queryOf)(req.url);
        // ---- /settings GET/PUT：全量设置面（设置→插件卡消费；ST 扩展设置面 1:1 对齐）----
        // 结构对齐 ST JS-Slash-Runner GlobalSettings（camelCase 转写）：
        // scriptEnabled=ST script.enabled.global；macro=宏替换；render=前端渲染组；
        // optimize=ST 8 开关（世界书/角色卡优化——当前移植范围无对应管线，存而标注）；
        // listener=ST 外部事件监听（PC 桌面联动特性，移动端标注不适用）。
        if (sub === '/settings') {
            const p = (0, node_path_1.join)(dshHome, 'rp', 'th-settings.json');
            const defaults = {
                scriptEnabled: true,
                macroEnabled: true,
                render: { enabled: true, collapseCodeBlock: 'frontend_only', allowStreaming: false, useBlobUrl: false, optimizeHljs: true, depth: 0, depthIgnoreHidden: false },
                optimize: {
                    disableIncompatibleOption: true, betterMessageToLoad: true, betterCharacterUpdate: true,
                    betterCharacterExport: true, betterCharacterDeletion: true,
                    forceRecommendedWorldbookGlobalSettings: true, savePresetWhenSavingPresetEntries: true,
                    maximizePresetContextLength: true,
                },
                listener: { enabled: false, enableEcho: true, url: 'http://localhost:6621', duration: 1000 },
            };
            const loadMerged = async () => {
                const stored = await (0, promises_1.readFile)(p, 'utf8').then(t => JSON.parse(t)).catch(() => ({}));
                const out = { ...defaults };
                for (const k of Object.keys(defaults)) {
                    const d = defaults[k], s = stored[k];
                    if (k === 'scriptEnabled' || k === 'macroEnabled') {
                        out[k] = typeof s === 'boolean' ? s : d;
                        continue;
                    }
                    if (d && typeof d === 'object' && s && typeof s === 'object')
                        out[k] = { ...d, ...s };
                    else if (s !== undefined)
                        out[k] = s;
                }
                return out;
            };
            if (method === 'GET')
                return (0, http_ts_1.sendJson)(res, 200, await loadMerged());
            if (method === 'PUT' || method === 'POST') {
                const body = await (0, http_ts_1.readJsonBody)(req);
                if (!body || typeof body !== 'object')
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
                const merged = await loadMerged();
                // 按组合并写入（每组只接受已知键，布尔校验；render.collapseCodeBlock 限三枚举）
                for (const k of ['scriptEnabled', 'macroEnabled']) {
                    if (typeof body[k] === 'boolean')
                        merged[k] = body[k];
                }
                for (const g of ['render', 'optimize', 'listener']) {
                    const gv = body[g];
                    if (gv && typeof gv === 'object' && !Array.isArray(gv)) {
                        merged[g] = { ...merged[g], ...gv };
                    }
                }
                const rc = merged.render.collapseCodeBlock;
                if (rc !== 'none' && rc !== 'frontend_only' && rc !== 'all')
                    merged.render.collapseCodeBlock = 'frontend_only';
                await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
                await (0, promises_1.writeFile)(p, JSON.stringify(merged, null, 1), 'utf8');
                console.log(`[dsht-th] settings: scriptEnabled=${merged.scriptEnabled} macroEnabled=${merged.macroEnabled}`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true, settings: merged });
            }
            return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/PUT only' });
        }
        /** scope/slug/sessionId/scriptId/path：GET/DELETE 走 query，PUT/POST 走 body */
        const fromQuery = {
            scope: String(q.get('scope') ?? ''),
            slug: String(q.get('slug') ?? ''),
            sessionId: String(q.get('sessionId') ?? ''),
            scriptId: String(q.get('scriptId') ?? ''),
            path: String(q.get('path') ?? ''),
        };
        // ---- 变量：六作用域 GET/PUT/DELETE（global/character/chat 文件层 + preset/message/script 会话持有层）----
        if (sub === '/variables') {
            if (method === 'GET') {
                const { scope, slug, sessionId, scriptId, path } = fromQuery;
                const argErr = scopeArgError(scope, slug, sessionId, scriptId);
                if (argErr)
                    return (0, http_ts_1.sendJson)(res, 400, { error: argErr });
                const tree = await loadScope(scope, slug, sessionId, scriptId);
                if (!path)
                    return (0, http_ts_1.sendJson)(res, 200, { variables: tree });
                return (0, http_ts_1.sendJson)(res, 200, { value: (0, variables_ts_1.getByPath)(tree, path) });
            }
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const scope = String(body.scope ?? '');
            const slug = String(body.slug ?? fromQuery.slug);
            const sessionId = String(body.sessionId ?? fromQuery.sessionId);
            const scriptId = String(body.scriptId ?? fromQuery.scriptId);
            // 酒馆助手 deleteVariable 用 lodash 路径（a.b[0]）；JSONPointer（/ 开头）原样
            const rawPath = String(body.path ?? fromQuery.path);
            const path = rawPath && !rawPath.startsWith('/') ? (0, for_session_ts_1.lodashPathToPointer)(rawPath) : rawPath;
            const argErr = scopeArgError(scope, slug, sessionId, scriptId);
            if (argErr)
                return (0, http_ts_1.sendJson)(res, 400, { error: argErr });
            const tree = await loadScope(scope, slug, sessionId, scriptId);
            if (method === 'PUT' || method === 'POST') {
                const next = path ? (0, variables_ts_1.setByPath)(tree, path, body.value) : (body.variables && typeof body.variables === 'object' ? body.variables : tree);
                // 性能短路（2026-09-04）：内容未变的写入直接返回——脚本心跳轮询（实测每 2s
                // 整树 PUT 同值）跳过 diff/undo/快照/写盘全链路。树来自刚 load 的文件，序列化
                // 相等即无变化（键序稳定）。
                if (JSON.stringify(next) === JSON.stringify(tree)) {
                    return (0, http_ts_1.sendJson)(res, 200, { ok: true, unchanged: true });
                }
                // 任务 4：写前旧值进 undo 日志（有 sessionId 才记——回滚以会话为单位；仅文件层作用域，
                // 会话持有层由快照 revision 承担溯源）
                if (sessionId && !SESSION_HELD.has(scope)) {
                    const entries = path
                        ? [(0, undo_ts_1.makeUndoEntry)(scope, slug, path, tree)]
                        : (0, undo_ts_1.diffUndoEntries)(scope, slug, tree, next);
                    await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, entries);
                    await snapshotFiles(sessionId, [scopeRelPath(scope, slug, sessionId)]); // 任务 1：文件级 before 快照
                }
                await saveScope(scope, slug, sessionId, next, scriptId);
                console.log(`[dsht-th] set ${scope}${path || ':/'} (${slug || sessionId || '-'}${scriptId ? ` script=${scriptId}` : ''})`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true });
            }
            if (method === 'DELETE') {
                if (!path)
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'path required for DELETE' });
                if (sessionId && !SESSION_HELD.has(scope)) {
                    await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, [(0, undo_ts_1.makeUndoEntry)(scope, slug, path, tree)]);
                    await snapshotFiles(sessionId, [scopeRelPath(scope, slug, sessionId)]); // 任务 1：文件级 before 快照
                }
                await saveScope(scope, slug, sessionId, (0, variables_ts_1.deleteByPath)(tree, path), scriptId);
                console.log(`[dsht-th] delete ${scope}:${path} (${slug || sessionId || '-'})`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true });
            }
            return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/PUT/DELETE only' });
        }
        // ---- 合并视图（chat > character > global；可选 path 取值）----
        if (sub === '/variables/merged') {
            if (method !== 'GET' && method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/POST only' });
            let slug = fromQuery.slug;
            let sessionId = fromQuery.sessionId;
            let path = fromQuery.path;
            if (method === 'POST') {
                const body = await (0, http_ts_1.readJsonBody)(req);
                if (!body)
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
                slug = String(body.slug ?? slug);
                sessionId = String(body.sessionId ?? sessionId);
                path = String(body.path ?? path);
            }
            const merged = (0, variables_ts_1.mergeScopes)(await loadScope('global', '', ''), slug ? await loadScope('character', slug, '') : {}, sessionId ? await loadScope('chat', '', sessionId) : {});
            if (!path)
                return (0, http_ts_1.sendJson)(res, 200, { variables: merged });
            return (0, http_ts_1.sendJson)(res, 200, { value: (0, variables_ts_1.getByPath)(merged, path) });
        }
        // ---- 脚本注册表 ----
        if (sub === '/scripts') {
            if (method === 'GET')
                return (0, http_ts_1.sendJson)(res, 200, { scripts: await loadScripts() });
            if (method === 'PUT' || method === 'POST') {
                const body = await (0, http_ts_1.readJsonBody)(req);
                const scripts = body?.scripts;
                if (!Array.isArray(scripts))
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'scripts array required' });
                for (const s of scripts) {
                    const err = (0, scripts_ts_1.validateScript)(s);
                    if (err)
                        return (0, http_ts_1.sendJson)(res, 400, { error: `invalid script: ${err}` });
                }
                await saveScripts(scripts);
                console.log(`[dsht-th] scripts saved: ${scripts.length}`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true, count: scripts.length });
            }
            return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/PUT only' });
        }
        // ---- 脚本执行（白名单 action；set/delete-variable 落盘三级作用域，insert-note 返回给调用方）----
        if (sub === '/scripts/run') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const id = String(body.id ?? '');
            if (!id)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'id required' });
            const slug = String(body.slug ?? '');
            const sessionId = String(body.sessionId ?? '');
            const scripts = await loadScripts();
            const script = scripts.find(s => s.id === id);
            if (!script)
                return (0, http_ts_1.sendJson)(res, 404, { error: `script not found: ${id}` });
            if (script.enabled === false)
                return (0, http_ts_1.sendJson)(res, 400, { error: `script disabled: ${id}` });
            const trees = {
                global: await loadScope('global', '', ''),
                character: slug ? await loadScope('character', slug, '') : {},
                chat: sessionId ? await loadScope('chat', '', sessionId) : {},
            };
            const result = (0, scripts_ts_1.runScript)(script, trees);
            // 任务 4：写前旧值进 undo 日志（逐作用域 diff；有 sessionId 才记）
            if (sessionId) {
                const entries = [
                    ...(0, undo_ts_1.diffUndoEntries)('global', '', trees.global, result.trees.global),
                    ...(slug ? (0, undo_ts_1.diffUndoEntries)('character', slug, trees.character, result.trees.character) : []),
                    ...(0, undo_ts_1.diffUndoEntries)('chat', '', trees.chat, result.trees.chat),
                ];
                await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, entries);
                // 任务 1：文件级 before 快照（三级作用域落盘文件整批）
                await snapshotFiles(sessionId, [
                    scopeRelPath('global', '', ''),
                    ...(slug ? [scopeRelPath('character', slug, '')] : []),
                    scopeRelPath('chat', '', sessionId),
                ]);
            }
            // 变更落盘（三级全写回——未变的作用域内容相同，幂等）
            await saveScope('global', '', '', result.trees.global);
            if (slug)
                await saveScope('character', slug, '', result.trees.character);
            if (sessionId)
                await saveScope('chat', '', sessionId, result.trees.chat);
            for (const line of result.logs)
                console.log(`[dsht-th] script ${id}: ${line}`);
            console.log(`[dsht-th] script run: ${id} notes=${result.notes.length}`);
            return (0, http_ts_1.sendJson)(res, 200, { ok: result.ok, notes: result.notes, error: result.error ?? null });
        }
        // ---- 宏展开（任务 1：{{setvar::x::y}} 等酒馆助手宏的真运行期语义）----
        // POST {text, slug?, sessionId?} → {result, writes:[{path,value}]}。
        // setvar 落盘到对应作用域（chat > character > global），写前进 undo 日志。
        if (sub === '/macros/expand') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const text = String(body.text ?? '');
            if (!text)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'text required' });
            // 宏开关（ST macro.enabled）：关闭 = 原文透传、零展开零写盘（与 ST 关闭宏语义一致）
            const thCfg = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'th-settings.json'), 'utf8')
                .then(t => JSON.parse(t)).catch(() => ({ macroEnabled: true }));
            if (thCfg.macroEnabled === false) {
                return (0, http_ts_1.sendJson)(res, 200, { result: text, writes: [], unknownMacros: [], macroDisabled: true });
            }
            const out = await (0, macros_ts_1.runMacroExpand)({
                dshHome, loadScope, saveScope,
                // 任务 1：setvar 落盘前的文件级 before 快照
                beforeSave: async (scope, slug2, sid) => { await snapshotFiles(sid, [scopeRelPath(scope, slug2, sid)]); },
            }, { text, slug: String(body.slug ?? ''), sessionId: String(body.sessionId ?? '') });
            console.log(`[dsht-th] macros/expand: ${text.length}ch → writes=${out.writes.length} unknown=${out.unknownMacros.length}`);
            return (0, http_ts_1.sendJson)(res, 200, out);
        }
        // ---- 会话脚本执行清单（TavernHelper 脚本运行时：预设 + 卡两作用域 enabled 脚本合并）----
        // POST {sessionId, slug?} → {scripts: SessionScript[], presetId, slug}
        // 预设解析：rp/state/<sid>.json presetId（历史扁平 MVU 裸树兼容）→ 缺省回落最近批次
        // settings.json 的 ST 激活预设名按 displayName 匹配 rp-presets（resolveActiveStPresetId 同款）。
        if (sub === '/scripts/for-session') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const sessionId = String(body.sessionId ?? '');
            const slug = String(body.slug ?? '');
            if (!sessionId)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            // 1) 会话有效预设
            let presetId = null;
            try {
                const file = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8'));
                presetId = (0, for_session_ts_1.presetIdFromStateFile)(file);
            }
            catch { /* 无状态文件 */ }
            if (!presetId) {
                try {
                    const batches = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import')))
                        .filter(b => /^[a-z0-9][a-z0-9-]{0,60}$/.test(b)).sort().reverse();
                    let activeName = null;
                    for (const b of batches) {
                        const dir = (0, node_path_1.join)(dshHome, 'rp-import', b);
                        let stRoot = 'data/default-user';
                        try {
                            const meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                            if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot)
                                stRoot = meta.manifest.stRoot;
                        }
                        catch { /* 无 meta 用默认 */ }
                        let text = '';
                        try {
                            text = await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'unpacked', stRoot, 'settings.json'), 'utf8');
                        }
                        catch {
                            continue;
                        }
                        activeName = (0, for_session_ts_1.activePresetNameFromSettings)(JSON.parse(text));
                        if (activeName)
                            break;
                    }
                    if (activeName) {
                        const presets = [];
                        try {
                            for (const id of (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'))).sort()) {
                                try {
                                    const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', id, 'preset.json'), 'utf8'));
                                    presets.push({ id, displayName: p.displayName });
                                }
                                catch { /* 坏 preset.json 跳过 */ }
                            }
                        }
                        catch { /* 无 rp-presets */ }
                        presetId = (0, for_session_ts_1.matchPresetByDisplayName)(presets, activeName);
                    }
                }
                catch { /* 无批次 = 无默认预设 */ }
            }
            // 2) 两作用域脚本库读取
            const readLibrary = async (p) => {
                try {
                    return JSON.parse(await (0, promises_1.readFile)(p, 'utf8'));
                }
                catch {
                    return null;
                }
            };
            const presetRaw = presetId ? await readLibrary((0, node_path_1.join)(dshHome, 'rp-presets', presetId, 'tavern-helper-scripts.json')) : null;
            const charRaw = slug ? await readLibrary((0, node_path_1.join)(dshHome, 'rp', slug, 'tavern-helper-scripts.json')) : null;
            const scripts = (0, for_session_ts_1.mergeSessionScripts)(presetRaw, charRaw);
            // 3) script 作用域种子：脚本自带 data 落会话快照（仅当快照尚无该脚本条目；幂等）
            for (const s of scripts) {
                if (Object.keys(s.data).length === 0)
                    continue;
                const snap = await sessionStore.get(sessionId);
                if (snap.scripts[s.id] === undefined) {
                    await sessionStore.mutate(sessionId, { scope: 'script', scriptId: s.id, tree: s.data });
                }
            }
            console.log(`[dsht-th] scripts/for-session: sid=${sessionId} preset=${presetId ?? '-'} slug=${slug || '-'} scripts=${scripts.length}`);
            return (0, http_ts_1.sendJson)(res, 200, { scripts, presetId, slug });
        }
        // ---- 变量深合并写入 / schema 注册（C7 收口：facade 端点 14-15）路由见下方 facade 区（facadePost 声明之后）----
        // ---- prompt 注入存储（C8：$DSH_HOME/rp/th-injections/<sessionId>.json；消费接线归 dsh-plugin 主线程排程）----
        // POST /inject {sessionId, injections:[{key,prompt,order,depth,position,role,should_scan,once}]}
        // （同 key 覆盖）→ {ok,count}；GET /inject?sessionId= → {injections}；POST /uninject {sessionId, keys} → {ok,count}
        if (sub === '/inject' || sub === '/uninject') {
            const injDir = (0, node_path_1.join)(dshHome, 'rp', 'th-injections');
            const injPath = (sid) => (0, node_path_1.join)(injDir, `${sid}.json`);
            const readInjections = async (sid) => {
                try {
                    const parsed = JSON.parse(await (0, promises_1.readFile)(injPath(sid), 'utf8'));
                    return Array.isArray(parsed) ? parsed.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
                }
                catch {
                    return [];
                }
            };
            if (sub === '/inject' && method === 'GET') {
                const sid = String(q.get('sessionId') ?? '');
                if (!sid)
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
                return (0, http_ts_1.sendJson)(res, 200, { injections: await readInjections(sid) });
            }
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: `${sub === '/inject' ? 'GET/POST' : 'POST'} only` });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const sid = String(body.sessionId ?? '');
            if (!sid)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            const existing = await readInjections(sid);
            if (sub === '/inject') {
                const rawList = Array.isArray(body.injections) ? body.injections : [body];
                const incoming = [];
                for (const raw of rawList) {
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                        continue;
                    const rec = raw;
                    // 【2026-09-07 真 TH 形状兼容】真 TH injectPrompts 条目是 {id, content}（剧本逻辑
                    // 等卡脚本实传）；此前只认 {key, prompt} → 全部丢弃 400（1260 次/小时失败桥）。
                    // 双形状都收：key = key ?? id；prompt = prompt ?? content。
                    const key = typeof rec.key === 'string' && rec.key.trim() ? rec.key.trim()
                        : typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : '';
                    if (!key)
                        continue; // key/id 是锚（uninject/同 key 覆盖）；无锚条目丢弃
                    const prompt = typeof rec.prompt === 'string' ? rec.prompt
                        : typeof rec.content === 'string' ? rec.content : '';
                    incoming.push({
                        key,
                        prompt,
                        order: typeof rec.order === 'number' && Number.isFinite(rec.order) ? rec.order : 100,
                        depth: typeof rec.depth === 'number' && Number.isFinite(rec.depth) ? rec.depth : 4,
                        position: typeof rec.position === 'number' && Number.isFinite(rec.position) ? rec.position : 0,
                        role: rec.role === 'user' || rec.role === 'assistant' ? rec.role : 'system',
                        should_scan: rec.should_scan === true,
                        once: rec.once === true,
                    });
                }
                if (incoming.length === 0)
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'injections with key required' });
                const byKey = new Map(existing.map(x => [String(x.key ?? ''), x]));
                for (const inj of incoming)
                    byKey.set(String(inj.key), inj); // 同 key 覆盖（injectPrompts 幂等语义）
                await (0, promises_1.mkdir)(injDir, { recursive: true });
                const list = [...byKey.values()];
                await (0, promises_1.writeFile)(injPath(sid), JSON.stringify(list), 'utf8');
                console.log(`[dsht-th] inject: sid=${sid} keys=[${incoming.map(i => i.key).join(',')}] total=${list.length}`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true, count: list.length });
            }
            // /uninject：POST {sessionId, keys} → 按 key 剔除
            const keys = (Array.isArray(body.keys) ? body.keys : []).map(k => String(k)).filter(k => k !== '');
            if (keys.length === 0)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'keys required' });
            const keySet = new Set(keys);
            const next = existing.filter(x => !keySet.has(String(x.key ?? '')));
            await (0, promises_1.mkdir)(injDir, { recursive: true });
            await (0, promises_1.writeFile)(injPath(sid), JSON.stringify(next), 'utf8');
            console.log(`[dsht-th] uninject: sid=${sid} keys=[${keys.join(',')}] remain=${next.length}`);
            return (0, http_ts_1.sendJson)(res, 200, { ok: true, count: next.length });
        }
        // ---- 生成通道（C9：generate/generateRaw 数据面——本插件无 ctx.llm，loopback 转发同一
        // webServer 前缀空间里 dsh-plugin 的 /dsht-rp/llm/classify（{system,prompt} → {ok,text}）。
        // POST {sessionId?, system?, prompt} → {ok, text}；stream? 接受但不做流式（一次性补全语义）。
        // Host 头回填同源地址：非 LAN 模式浏览器本就只能 loopback 访问（isTrusted），LAN 模式
        // 下 lanMode 直接过——node 侧 fetch 无 Origin 头，信任栅栏按 Host 判定放行。
        if (sub === '/generate') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const system = String(body.system ?? '');
            const prompt = String(body.prompt ?? '');
            if (!prompt.trim())
                return (0, http_ts_1.sendJson)(res, 400, { error: 'prompt required' });
            const host = String(req.headers.host ?? '').trim() || '127.0.0.1';
            try {
                const resp = await fetch(`http://${host}/dsht-rp/llm/classify`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ system, prompt }),
                });
                const data = await resp.json().catch(() => ({ error: `upstream HTTP ${resp.status}` }));
                if (!resp.ok)
                    return (0, http_ts_1.sendJson)(res, resp.status === 503 ? 503 : 502, data);
                console.log(`[dsht-th] generate: ${String(data.text ?? '').length}ch（loopback llm/classify）`);
                return (0, http_ts_1.sendJson)(res, 200, data);
            }
            catch (e) {
                return (0, http_ts_1.sendJson)(res, 502, { error: `llm 通道转发失败：${e.message}` });
            }
        }
        // ---- 【2026-09-07 generateRaw 真语义】ordered_prompts 装配（世界书激活/人设/角色卡/
        // 聊天历史/injects 深度插入）→ loopback llm/classify。旧 shim 只发 {system,prompt} 空
        // 串导致飞讯 safeGenerate 三连败（似其形不明其义根修）。
        if (sub === '/generate-raw') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const assembled = await facade.assembleGenerateRawPrompt(dshHome, body);
            if (!assembled.prompt.trim())
                return (0, http_ts_1.sendJson)(res, 400, { error: 'empty prompt（装配后无内容）', missing: assembled.missing });
            // 【2026-09-07】system 缺省不能落到底层 classify 的"分类器"人设（会把角色扮演回复
            // 变成 JSON 分类产物）——generateRaw 无 system 时给中性扮演指令
            const system = assembled.system.trim() || '你正在进行 SillyTavern 式角色扮演。请完全代入当前场景中的角色，依据上文对话自然地以角色身份回复。直接输出回复内容，不要输出 JSON、分类标签或任何元信息。';
            const host = String(req.headers.host ?? '').trim() || '127.0.0.1';
            try {
                const resp = await fetch(`http://${host}/dsht-rp/llm/classify`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ system, prompt: assembled.prompt }),
                });
                const data = await resp.json().catch(() => ({ error: `upstream HTTP ${resp.status}` }));
                if (!resp.ok)
                    return (0, http_ts_1.sendJson)(res, resp.status === 503 ? 503 : 502, data);
                const replyHead = String(data.text ?? '').replace(/\s+/g, ' ').slice(0, 80);
                console.log(`[dsht-th] generate-raw: ${assembled.prompt.length}ch prompt → ${String(data.text ?? '').length}ch「${replyHead}」（missing=${assembled.missing.length}）`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true, text: String(data.text ?? ''), missing: assembled.missing });
            }
            catch (e) {
                return (0, http_ts_1.sendJson)(res, 502, { error: `llm 通道转发失败：${e.message}` });
            }
        }
        // ---- 【P3a 2026-09-07】聊天写路径桥（createChatMessages / setChatMessages 数据面）——
        // 本插件无 ctx.sessions，loopback 转发 dsh-plugin 的 /dsht-rp/chat/append|update
        //（live session 官方 append / compaction+replace 原语在 dsh-plugin 进程侧）。
        // Host 头信任栅栏放行逻辑与 /generate 同款。
        if (sub === '/chat/append' || sub === '/chat/update') {
            if (method !== 'POST')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const host = String(req.headers.host ?? '').trim() || '127.0.0.1';
            try {
                const target = sub === '/chat/append' ? '/dsht-rp/rp/chat/append' : '/dsht-rp/rp/chat/update';
                const resp = await fetch(`http://${host}${target}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await resp.json().catch(() => ({ error: `upstream HTTP ${resp.status}` }));
                if (!resp.ok)
                    return (0, http_ts_1.sendJson)(res, resp.status === 503 ? 503 : 502, data);
                console.log(`[dsht-th] ${sub === '/chat/append' ? 'chat/append' : 'chat/update'}: ok（loopback ${target}）`);
                return (0, http_ts_1.sendJson)(res, 200, data);
            }
            catch (e) {
                return (0, http_ts_1.sendJson)(res, 502, { error: `会话写桥转发失败：${e.message}` });
            }
        }
        // ---- 门面端点（facade.ts 纯函数族，显式收 dshHome）——ST 酒馆助手 API 的服务端数据面 ----
        // 统一壳：仅 POST + JSON body；处理结果 {status, body} 直接 sendJson。
        // 写操作的数据文件在 facade 内部做写前快照（归属会话尽量解析，解析不到就跳过）。
        const facadePost = async (run) => {
            if (method !== 'POST') {
                (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
                return;
            }
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body) {
                (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
                return;
            }
            const r = await run(dshHome, body);
            (0, http_ts_1.sendJson)(res, r.status, r.body);
        };
        // 会话上下文视图（会话有效预设 → ST chatCompletionSettings + 角色名）
        if (sub === '/context')
            return facadePost(facade.context);
        // C7 收口：/variables/merge = shim insertOrAssignVariables chat 作用域的服务端语义
        // （深合并 + undo/快照 + D7 schema 校验）；/variables/schema = registerVariableSchema
        // 数据面（zod 风格 schema 落 rp/state 的 variableSchema）
        if (sub === '/variables/merge')
            return facadePost(facade.variablesMerge);
        if (sub === '/variables/schema')
            return facadePost(facade.variableSchemaRegister);
        // 预设：清单 / 读 / identifier 锚定写 / 删 / 改名 / 加载绑定（写 rp/state presetId）
        if (sub === '/preset/names')
            return facadePost(facade.presetNames);
        if (sub === '/preset/export')
            return facadePost(facade.presetExport);
        if (sub === '/preset/get')
            return facadePost(facade.presetGet);
        if (sub === '/preset/put')
            return facadePost(facade.presetPut);
        if (sub === '/preset/delete')
            return facadePost(facade.presetDelete);
        if (sub === '/preset/rename')
            return facadePost(facade.presetRename);
        if (sub === '/preset/load')
            return facadePost(facade.presetLoad);
        // 只读聊天记录导出（session.jsonl 事件流 → ST 消息形态）
        if (sub === '/chat/messages')
            return facadePost(facade.chatMessages);
        // 正则：三源合并视图（global/character/preset，_dshtScope 标记）+ 整组替换
        if (sub === '/regexes/get')
            return facadePost(facade.regexesGet);
        if (sub === '/regexes/replace')
            return facadePost(facade.regexesReplace);
        // 世界书：清单 / 读（LoreEntry → ST World Info entry 形状）/ 条目锚定合并
        if (sub === '/worldbook/list')
            return facadePost(facade.worldbookList);
        if (sub === '/worldbook/get')
            return facadePost(facade.worldbookGet);
        if (sub === '/worldbook/entry-put')
            return facadePost(facade.worldbookEntryPut);
        // 【实机审计修复 2026-09-05】P1 世界书写面：整表替换 / 全局·角色书单重绑 / 会话书缺则建
        if (sub === '/worldbook/replace-entries')
            return facadePost(facade.worldbookReplaceEntries);
        if (sub === '/worldbook/rebind-global')
            return facadePost(facade.worldbookRebindGlobal);
        if (sub === '/worldbook/rebind-char')
            return facadePost(facade.worldbookRebindChar);
        if (sub === '/worldbook/chat-get-or-create')
            return facadePost(facade.worldbookChatGetOrCreate);
        return (0, http_ts_1.sendJson)(res, 404, { error: 'unknown endpoint' });
    });
}
