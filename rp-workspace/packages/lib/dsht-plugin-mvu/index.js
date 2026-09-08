"use strict";
/**
 * DSHTavern MVU 插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 1。
 *
 * SillyTavern MVU 扩展（extension_settings.mvu_settings）的意图级移植：
 * MVU 引擎本体（<UpdateVariable> 提取 / JSONPatch 应用 / 状态摘要渲染）已在
 * packages/src/state/mvu.ts 并由 dsh-plugin 的组装层消费——本插件做"收口"：
 *
 * a) 全局 MVU 设置存取：$DSH_HOME/rp/mvu-settings.json（GET/PUT）。
 *    迁移时 extension_settings.mvu_settings 子树原样存为该文件（raw 保留全部键）；
 *    常用子集字段（更新方式/自动清理变量/通知/额外模型解析配置/兼容性/statusbar）
 *    原样透传，插件不做字段级裁剪——ST 端配置语义不失真。
 *    （rp/state/<sessionId>.json 的读写 dsh-plugin 已有 /dsht-rp/state 路由，不重复造。）
 * b) 状态栏渲染配置存取：mvu-settings.json 内 statusbar 键（GET/PUT /dsht-mvu/statusbar）。
 * c) 变量 schema 注册：迁移 skill 把 chat_metadata.variables 写进 rp/state/<sessionId>.json
 *    的 variables 键（POST /dsht-mvu/variables/register，深合并不覆盖既有键，replace 可整组换）；
 *    POST /dsht-mvu/variables/patch 复用 state/mvu.ts 的 applyStatePatches 做 JSONPatch 增量。
 *
 * 路由前缀 /dsht-mvu（避开 /dsht-rp）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.deepMerge = deepMerge;
exports.registerVariables = registerVariables;
exports.renderStatusbarHtml = renderStatusbarHtml;
exports.renderDefaultStatusbarHtml = renderDefaultStatusbarHtml;
exports.apply = apply;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const mvu_ts_1 = require("../state/mvu.ts");
const macros_ts_1 = require("../dsht-plugin-shared/macros.ts");
const schema_ts_1 = require("../dsht-plugin-shared/schema.ts");
const undo_ts_1 = require("../dsht-plugin-shared/undo.ts");
const file_snapshots_ts_1 = require("../dsht-plugin-shared/file-snapshots.ts");
const http_ts_1 = require("../dsht-plugin-shared/http.ts");
const settings_ns_ts_1 = require("../dsht-plugin-shared/settings-ns.ts");
exports.name = 'dsht-plugin-mvu';
// services 声明：webServer = /dsht-mvu/* 同源数据面；settings = 命名空间锚点（设置→插件「可配置」可见性）
exports.inject = ['webServer', 'settings'];
// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）
// ---------------------------------------------------------------------------
// 纯逻辑（可单测）
// ---------------------------------------------------------------------------
/** 深合并（incoming 覆盖 existing 的叶值；对象递归；数组/标量直接替换） */
function deepMerge(existing, incoming) {
    const out = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
        const prev = out[k];
        if (prev !== null && v !== null && typeof prev === 'object' && typeof v === 'object' && !Array.isArray(prev) && !Array.isArray(v)) {
            out[k] = deepMerge(prev, v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
/**
 * 变量注册（chat_metadata.variables 迁移落点）。
 * replace=false：与现有 variables 深合并（incoming 赢）；replace=true：整组替换。
 * 返回合并后的新文件内容（纯函数，IO 在调用侧）。
 */
function registerVariables(file, variables, schema, replace) {
    const next = { ...file };
    next.variables = replace || !file.variables
        ? structuredClone(variables)
        : deepMerge(file.variables, variables);
    if (schema !== undefined)
        next.variableSchema = schema;
    return next;
}
/**
 * 任务 5：状态栏模板渲染（<StatusPlaceHolderImpl/> 占位符的数据源）。
 * 两阶段：1) 宏引擎求值已知宏（{{getvar::…}}/{{time}} 等）；2) 剩余 {{path}} 视为
 * MVU 变量引用（状态栏模板形态）。输出安全文本段：全部 HTML 转义，换行 → <br>。
 */
function renderStatusbarHtml(template, lookup) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const expanded = (0, macros_ts_1.expandTavernMacros)(template, { user: '', char: '', getVar: lookup }).text;
    const out = expanded.replace(/\{\{([^{}]+)\}\}/g, (m, p) => {
        const v = lookup(p.trim());
        if (v === undefined)
            return m; // 未知引用原样保留（转义后可见，不吞内容）
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    return esc(out).replace(/\r?\n/g, '<br>');
}
/**
 * 任务 5 兜底：statusbar 无配置模板时的默认两栏（时间/地点/好感度——只渲染
 * 变量树里真实存在的键；常见落点 root 与 stat_data 都查）。一个都没有返回空串。
 *
 * 键名兼容（真实卡实测）：时间=时间|当前时间；地点=地点|所在地点|当前地点；
 * 好感度=root/stat_data 直键，否则往「女性角色/<角色>/好感度」这类一层子树里找首个。
 */
function renderDefaultStatusbarHtml(lookup, tree) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const find = (keys) => {
        for (const key of keys) {
            const v = lookup(key) ?? lookup(`stat_data.${key}`);
            if (v !== undefined && v !== null)
                return v;
        }
        return undefined;
    };
    // 好感度常嵌在角色子树（女性角色/<名>/好感度 等）：往一层子对象里找首个以好感度结尾的键
    const findFavor = () => {
        const direct = find(['好感度']);
        if (direct !== undefined)
            return direct;
        if (!tree || typeof tree !== 'object')
            return undefined;
        const scan = (obj, depth) => {
            if (depth > 3)
                return undefined;
            for (const [k, v] of Object.entries(obj)) {
                if (k.endsWith('好感度') && (typeof v === 'number' || typeof v === 'string'))
                    return v;
                if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    const hit = scan(v, depth + 1);
                    if (hit !== undefined)
                        return hit;
                }
            }
            return undefined;
        };
        return scan(tree, 0);
    };
    const cells = [];
    const pairs = [
        ['时间', find(['时间', '当前时间'])],
        ['地点', find(['地点', '所在地点', '当前地点'])],
        ['好感度', findFavor()],
    ];
    for (const [label, v] of pairs) {
        if (v === undefined || v === null)
            continue;
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (!text)
            continue;
        cells.push(`<span class="mvu-sb-cell"><b>${esc(label)}</b> ${esc(text)}</span>`);
    }
    if (cells.length === 0)
        return '';
    return `<div class="mvu-sb" style="display:flex;gap:1em">${cells.join('')}</div>`;
}
// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------
function apply(ctx, _config) {
    const dshHome = (0, http_ts_1.resolveDshHome)();
    // 任务 C2：设置→插件「可配置」可见性锚点（失败不影响本体）
    (0, settings_ns_ts_1.registerSettingsNamespace)(ctx, 'dsht-plugin-mvu', 'dsht-mvu');
    const settingsPath = (0, node_path_1.join)(dshHome, 'rp', 'mvu-settings.json');
    const stateDir = (0, node_path_1.join)(dshHome, 'rp', 'state');
    const loadSettings = async () => {
        try {
            const parsed = JSON.parse(await (0, promises_1.readFile)(settingsPath, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        }
        catch {
            return {}; // 无文件/坏 JSON = 空设置
        }
    };
    const saveSettings = async (settings) => {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(settingsPath), { recursive: true });
        await (0, promises_1.writeFile)(settingsPath, JSON.stringify(settings, null, 1), 'utf8');
    };
    const loadStateFile = async (sessionId) => {
        try {
            const parsed = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(stateDir, `${sessionId}.json`), 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            return {};
        }
    };
    const saveStateFile = async (sessionId, file) => {
        await (0, promises_1.mkdir)(stateDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(stateDir, `${sessionId}.json`), JSON.stringify(file), 'utf8');
    };
    /** 任务 1：写前文件快照（会话级状态文件；锚点解析不到则跳过，失败不阻塞写） */
    const snapshotStateFile = async (sessionId) => {
        try {
            await (0, file_snapshots_ts_1.snapshotBeforeWrite)(dshHome, sessionId, [`rp/state/${sessionId}.json`]);
        }
        catch { /* 快照失败不阻塞写操作 */ }
    };
    (0, http_ts_1.registerPrefix)(ctx, '/dsht-mvu', 'dsht-mvu', async (sub, req, res) => {
        const method = req.method ?? 'GET';
        const writeLike = method === 'PUT' || method === 'POST';
        // ---- 全局 MVU 设置（ST extension_settings.mvu_settings 迁移落点，raw 存取）----
        if (sub === '/settings') {
            if (method === 'GET')
                return (0, http_ts_1.sendJson)(res, 200, { settings: await loadSettings() });
            if (writeLike) {
                const body = await (0, http_ts_1.readJsonBody)(req);
                const settings = body?.settings;
                if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'settings object required' });
                }
                await saveSettings(settings);
                console.log(`[dsht-mvu] settings saved (${Object.keys(settings).length} top keys)`);
                return (0, http_ts_1.sendJson)(res, 200, { ok: true });
            }
            return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/PUT only' });
        }
        // ---- 状态栏渲染配置（settings.statusbar 键）----
        if (sub === '/statusbar') {
            if (method === 'GET') {
                const settings = await loadSettings();
                const config = settings.statusbar;
                return (0, http_ts_1.sendJson)(res, 200, { config: config && typeof config === 'object' ? config : {} });
            }
            if (writeLike) {
                const body = await (0, http_ts_1.readJsonBody)(req);
                const config = body?.config;
                if (!config || typeof config !== 'object' || Array.isArray(config)) {
                    return (0, http_ts_1.sendJson)(res, 400, { error: 'config object required' });
                }
                const settings = await loadSettings();
                settings.statusbar = config;
                await saveSettings(settings);
                console.log('[dsht-mvu] statusbar config saved');
                return (0, http_ts_1.sendJson)(res, 200, { ok: true });
            }
            return (0, http_ts_1.sendJson)(res, 405, { error: 'GET/PUT only' });
        }
        // ---- 任务 5：状态栏渲染（GET /dsht-mvu/statusbar-render?sessionId=）----
        // 卡/预设输出的 <StatusPlaceHolderImpl/> 占位符 → 渲染后状态栏。读
        // rp/state/<sessionId>.json（variables 优先，state 兜底）+ rp/mvu-settings.json
        // statusbar 配置（模板键：template/content/text 取首个字符串）。模板 {{…}} 走宏引擎
        // （getvar/time 等）+ 裸 {{path}} 变量引用兜底；输出安全文本段（HTML 转义 + <br>）。
        if (sub === '/statusbar-render') {
            if (method !== 'GET')
                return (0, http_ts_1.sendJson)(res, 405, { error: 'GET only' });
            const sessionId = String((0, http_ts_1.queryOf)(req.url).get('sessionId') ?? '');
            if (!sessionId)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            const settings = await loadSettings();
            const config = (settings.statusbar && typeof settings.statusbar === 'object' ? settings.statusbar : {});
            const template = ['template', 'content', 'text']
                .map(k => config[k])
                .find((v) => typeof v === 'string' && v.trim().length > 0);
            const file = await loadStateFile(sessionId);
            const root = file;
            const lookup = (path) => (0, macros_ts_1.readVarPath)((file.variables ?? {}), path)
                ?? (0, macros_ts_1.readVarPath)((file.state ?? {}), path)
                ?? (0, macros_ts_1.readVarPath)(root, path);
            if (!template) {
                // 无配置 → 默认两栏（时间/地点/好感度，只渲染变量树里存在的键）
                const tree = ((file.variables ?? file.state ?? file) ?? {});
                const html = renderDefaultStatusbarHtml(lookup, tree);
                return (0, http_ts_1.sendJson)(res, 200, { html, note: html ? 'statusbar 无配置：默认两栏（时间/地点/好感度）' : 'statusbar 无配置且变量树无 时间/地点/好感度' });
            }
            const html = renderStatusbarHtml(template, lookup);
            console.log(`[dsht-mvu] statusbar-render: session=${sessionId} template=${template.length}ch → html=${html.length}ch`);
            return (0, http_ts_1.sendJson)(res, 200, { html });
        }
        // ---- 变量读取（迁移/前端诊断用；写走 register/patch）----
        // 【实机修复 2026-09-05】合并视图：state（运行期 UpdateVariable/D4 落点）叠
        // variables（initvar 落点）——只回 variables 会让 TH shim 的 Mvu.getMvuData 与
        // 诊断面在"回复含更新块"场景下假空（R7 双树一致的读侧收口）。
        if (sub === '/variables') {
            const sessionId = String((0, http_ts_1.queryOf)(req.url).get('sessionId') ?? '');
            if (!sessionId)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            const file = await loadStateFile(sessionId);
            const merged = { ...(file.state ?? {}), ...(file.variables ?? {}) };
            return (0, http_ts_1.sendJson)(res, 200, { variables: merged, state: file.state ?? {}, variableSchema: file.variableSchema ?? null });
        }
        // ---- 变量 schema 注册（迁移 skill 写入 chat_metadata.variables）----
        if (sub === '/variables/register') {
            if (!writeLike)
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const sessionId = String(body.sessionId ?? '');
            const variables = body.variables;
            if (!sessionId)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
                return (0, http_ts_1.sendJson)(res, 400, { error: 'variables object required' });
            }
            const replace = body.replace === true;
            const file = await loadStateFile(sessionId);
            const next = registerVariables(file, variables, body.variableSchema, replace);
            // D7：轻量 schema 校验（body.variableSchema 优先，回落既有 file.variableSchema）——
            // 422 {error, issues} 不落盘不记 undo；通过才写盘
            const schema = body.variableSchema !== undefined ? body.variableSchema : file.variableSchema;
            if (schema != null) {
                const issues = (0, schema_ts_1.validateSchemaSubset)(next.variables, schema);
                if (issues.length > 0) {
                    console.warn(`[dsht-mvu] variables/register schema 校验失败: session=${sessionId} issues=${issues.length}`);
                    return (0, http_ts_1.sendJson)(res, 422, { error: 'variableSchema 校验失败', issues });
                }
            }
            // 任务 4：写前旧值进 undo 日志（会话级回滚的数据源）
            await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, (0, undo_ts_1.diffUndoEntries)('chat', '', file.variables ?? {}, next.variables ?? {}));
            await snapshotStateFile(sessionId); // 任务 1：文件级 before 快照（回退整批恢复用）
            await saveStateFile(sessionId, next);
            console.log(`[dsht-mvu] variables registered: session=${sessionId} keys=${Object.keys(next.variables ?? {}).length} replace=${replace}`);
            return (0, http_ts_1.sendJson)(res, 200, { ok: true, keys: Object.keys(next.variables ?? {}).length });
        }
        // ---- 变量 JSONPatch 增量（复用 state/mvu.ts applyStatePatches 引擎）----
        if (sub === '/variables/patch') {
            if (!writeLike)
                return (0, http_ts_1.sendJson)(res, 405, { error: 'POST only' });
            const body = await (0, http_ts_1.readJsonBody)(req);
            if (!body)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'bad json' });
            const sessionId = String(body.sessionId ?? '');
            if (!sessionId)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'sessionId required' });
            const patches = Array.isArray(body.patches) ? body.patches : [];
            if (patches.length === 0)
                return (0, http_ts_1.sendJson)(res, 400, { error: 'patches required' });
            const file = await loadStateFile(sessionId);
            const before = file.variables ?? {};
            // 先在内存应用补丁，D7 schema 校验通过才记 undo/快照/写盘（422 {error, issues} 不落盘）
            file.variables = (0, mvu_ts_1.applyStatePatches)(before, patches);
            const schema = body.variableSchema !== undefined ? body.variableSchema : file.variableSchema;
            if (schema != null) {
                const issues = (0, schema_ts_1.validateSchemaSubset)(file.variables, schema);
                if (issues.length > 0) {
                    console.warn(`[dsht-mvu] variables/patch schema 校验失败: session=${sessionId} issues=${issues.length}`);
                    return (0, http_ts_1.sendJson)(res, 422, { error: 'variableSchema 校验失败', issues });
                }
            }
            // 任务 4：写前旧值进 undo 日志（逐 patch 记录）
            await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, patches.map(p => (0, undo_ts_1.makeUndoEntry)('chat', '', p.path, before)));
            await snapshotStateFile(sessionId); // 任务 1：文件级 before 快照
            await saveStateFile(sessionId, file);
            console.log(`[dsht-mvu] variables patched: session=${sessionId} patches=${patches.length}`);
            return (0, http_ts_1.sendJson)(res, 200, { ok: true });
        }
        return (0, http_ts_1.sendJson)(res, 404, { error: 'unknown endpoint' });
    });
}
