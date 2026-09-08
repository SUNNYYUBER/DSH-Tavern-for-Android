"use strict";
/**
 * 酒馆助手变量作用域子系统——纯逻辑（可单测）。
 *
 * 三级作用域（ST 酒馆助手 getVariables 语义）：
 * - global：$DSH_HOME/rp/variables/global.json
 * - character：$DSH_HOME/rp/<slug>/variables.json
 * - chat：$DSH_HOME/rp/state/<sessionId>.json 的 variables 键
 *   （与 MVU chat_metadata.variables 同一棵树——ST 端 MVU 本就建在酒馆助手变量系统上）
 * 合并顺序：chat > character > global（深合并，浅层叶值高优先级覆盖）。
 *
 * 路径语法：JSONPointer（/a/b/c，~1→/、~0→~；空路径 = 整棵树）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePath = parsePath;
exports.getByPath = getByPath;
exports.setByPath = setByPath;
exports.deleteByPath = deleteByPath;
exports.deepMergeVars = deepMergeVars;
exports.mergeScopes = mergeScopes;
exports.mergeAllScopes = mergeAllScopes;
/** JSONPointer 段解码 */
function decodeSeg(seg) {
    return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}
function parsePath(path) {
    return path.split('/').filter(s => s.length > 0).map(decodeSeg);
}
/** 按 JSONPointer 取值（路径不存在返回 undefined） */
function getByPath(tree, path) {
    let cur = tree;
    for (const seg of parsePath(path)) {
        if (cur === null || typeof cur !== 'object')
            return undefined;
        cur = cur[seg];
    }
    return cur;
}
/** 按 JSONPointer 赋值（逐层建对象；返回新树，不改入参） */
function setByPath(tree, path, value) {
    const segs = parsePath(path);
    const next = structuredClone(tree);
    if (segs.length === 0) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : next; // 根替换仅接受对象（变量树必须是 object）
    }
    let cur = next;
    for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i];
        const existing = cur[seg];
        if (existing === undefined || existing === null || typeof existing !== 'object')
            cur[seg] = {};
        cur = cur[seg];
    }
    cur[segs[segs.length - 1]] = value;
    return next;
}
/** 按 JSONPointer 删除（返回新树；路径不存在则原样） */
function deleteByPath(tree, path) {
    const segs = parsePath(path);
    if (segs.length === 0)
        return {};
    const next = structuredClone(tree);
    let cur = next;
    for (let i = 0; i < segs.length - 1; i++) {
        const existing = cur[segs[i]];
        if (existing === null || typeof existing !== 'object')
            return next;
        cur = existing;
    }
    delete cur[segs[segs.length - 1]];
    return next;
}
/** 深合并（high 覆盖 low 的叶值；对象递归；数组/标量直接替换） */
function deepMergeVars(low, high) {
    const out = { ...low };
    for (const [k, v] of Object.entries(high)) {
        const prev = out[k];
        if (prev !== null && v !== null && typeof prev === 'object' && typeof v === 'object' && !Array.isArray(prev) && !Array.isArray(v)) {
            out[k] = deepMergeVars(prev, v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
/** 三级合并：global < character < chat */
function mergeScopes(global, character, chat) {
    return deepMergeVars(deepMergeVars(global, character), chat);
}
/**
 * 六层合并视图（P2#12 六作用域；对照 ST 酒馆助手变量优先级，低 → 高）：
 * global < preset < character < chat < message。
 * script 作用域为脚本私有（Host 按 scriptId 隔离持有），不进通用合并视图。
 * 缺省层传 {} 即可——空树合并恒等，无 preset/message 内容时与三级 mergeScopes 结果一致。
 */
function mergeAllScopes(scopes) {
    return deepMergeVars(deepMergeVars(deepMergeVars(deepMergeVars(scopes.global ?? {}, scopes.preset ?? {}), scopes.character ?? {}), scopes.chat ?? {}), scopes.message ?? {});
}
