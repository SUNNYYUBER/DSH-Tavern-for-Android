"use strict";
/**
 * 酒馆助手脚本库 → 会话执行清单——纯逻辑（可单测）。
 *
 * 数据形态（ST 酒馆助手预设/角色脚本库导出，backfill-assets 落盘）：
 *   rp/<slug>/tavern-helper-scripts.json          卡（character）作用域
 *   rp-presets/<presetId>/tavern-helper-scripts.json 预设作用域
 *   { scripts: [ Script | ScriptFolder ] }
 *   Script       = { type:'script', id, name, enabled, content, info?, button:{enabled, buttons:[{name,visible}]}, data }
 *   ScriptFolder = { type:'folder', id, name, enabled, scripts: Script[] }
 *
 * 会话有效预设解析（与 dsh-plugin resolveSessionPresetId 同款语义）：
 *   rp/state/<sid>.json 的 presetId 键（历史扁平 MVU 裸树兼容：无保留键 = 无 presetId）
 *   → 缺省回落最近 rp-import 批次 settings.json 的 oai_settings.preset_settings_openai
 *     按 displayName 匹配 rp-presets（ST 激活预设全局生效语义）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_RESERVED_KEYS = void 0;
exports.flattenScriptLibrary = flattenScriptLibrary;
exports.mergeSessionScripts = mergeSessionScripts;
exports.presetIdFromStateFile = presetIdFromStateFile;
exports.activePresetNameFromSettings = activePresetNameFromSettings;
exports.matchPresetByDisplayName = matchPresetByDisplayName;
exports.lodashPathToPointer = lodashPathToPointer;
/** state 文件形状保留键（与 dsh-plugin STATE_RESERVED_KEYS 对齐） */
exports.STATE_RESERVED_KEYS = new Set(['presetId', 'state', 'variables', 'variableSchema', 'cursor', 'loreTimed', 'tavern']);
function isTree(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function normalizeButton(raw) {
    if (!isTree(raw))
        return { enabled: false, buttons: [] };
    const buttons = Array.isArray(raw.buttons)
        ? raw.buttons
            .filter((b) => isTree(b))
            .map(b => ({ name: String(b.name ?? ''), visible: b.visible !== false }))
            .filter(b => b.name.length > 0)
        : [];
    return { enabled: raw.enabled === true, buttons };
}
/**
 * 摊平脚本库（folder 递归一层语义；ST 导出只嵌一层 folder）。
 * 仅收 enabled !== false 的脚本（disabled 不执行）；folder disabled = 整组禁用。
 */
function flattenScriptLibrary(raw, source) {
    if (!isTree(raw) || !Array.isArray(raw.scripts))
        return [];
    const out = [];
    const walk = (entries, folderEnabled) => {
        for (const e of entries) {
            if (!isTree(e))
                continue;
            const entry = e;
            if (Array.isArray(entry.scripts)) {
                // folder：自身 disabled 则整组跳过
                walk(entry.scripts, folderEnabled && entry.enabled !== false);
                continue;
            }
            if (!folderEnabled || entry.enabled === false)
                continue;
            const id = String(entry.id ?? '');
            if (!id)
                continue;
            const button = normalizeButton(entry.button);
            out.push({
                id,
                name: String(entry.name ?? id),
                content: typeof entry.content === 'string' ? entry.content : '',
                buttonEnabled: button.enabled,
                buttons: button.buttons,
                data: isTree(entry.data) ? entry.data : {},
                source,
            });
        }
    };
    walk(raw.scripts, true);
    return out;
}
/**
 * 合并预设 + 卡两作用域（ST 顺序：预设脚本先执行，角色脚本后执行）。
 * id 冲突时后源（character）覆盖前源（preset）——与酒馆助手 id 唯一化语义一致。
 */
function mergeSessionScripts(presetRaw, characterRaw) {
    const byId = new Map();
    for (const s of flattenScriptLibrary(presetRaw, 'preset'))
        byId.set(s.id, s);
    for (const s of flattenScriptLibrary(characterRaw, 'character'))
        byId.set(s.id, s);
    return [...byId.values()];
}
/**
 * 从 rp/state/<sid>.json 文件对象提取 presetId。
 * 历史扁平 MVU 裸树（无保留键）= 无 presetId（整树是 variables，不含会话元信息）。
 */
function presetIdFromStateFile(file) {
    if (!isTree(file))
        return null;
    if (!Object.keys(file).some(k => exports.STATE_RESERVED_KEYS.has(k)))
        return null;
    const pid = file.presetId;
    return typeof pid === 'string' && pid ? pid : null;
}
/**
 * 批次 settings.json → ST 激活预设名（oai_settings.preset_settings_openai）。
 * 返回 null = 该批次无有效激活预设名。
 */
function activePresetNameFromSettings(raw) {
    if (!isTree(raw))
        return null;
    const oai = raw.oai_settings;
    if (!isTree(oai))
        return null;
    const name = oai.preset_settings_openai;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
}
/** rp-presets 清单（{id, displayName}）按 ST 激活预设名匹配 → presetId（null = 未匹配） */
function matchPresetByDisplayName(presets, activeName) {
    if (!activeName)
        return null;
    for (const p of [...presets].sort((a, b) => a.id.localeCompare(b.id))) {
        if (p.displayName === activeName)
            return p.id;
    }
    return null;
}
/** lodash 风格变量路径（a.b[0].c / a["b"]）→ JSONPointer（/a/b/0/c） */
function lodashPathToPointer(path) {
    if (path.startsWith('/'))
        return path; // 已是 JSONPointer
    const segs = [];
    const re = /[^.[\]]+|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g;
    for (const m of path.matchAll(re)) {
        let seg = m[0];
        if (seg.startsWith('[')) {
            seg = seg.slice(1, -1);
            if ((seg.startsWith('"') && seg.endsWith('"')) || (seg.startsWith("'") && seg.endsWith("'"))) {
                seg = seg.slice(1, -1);
            }
        }
        if (seg)
            segs.push(seg.replace(/~/g, '~0').replace(/\//g, '~1'));
    }
    return '/' + segs.join('/');
}
