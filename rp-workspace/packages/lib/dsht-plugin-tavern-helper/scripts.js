"use strict";
/**
 * 酒馆助手脚本执行沙箱——纯逻辑（可单测）。
 *
 * 最小可行方案：不 eval 任意 JS（Android WebView/node 里不跑不可信代码）。
 * 脚本以 JSON 描述注册，执行器按白名单 action 类型执行——覆盖酒馆助手
 * 最常见的"按条件改变量 / 插注释"用途。
 *
 * 脚本形状：
 *   { id, enabled?, trigger: {type, variable?, equals?}, actions: ScriptAction[] }
 * 白名单 action：
 *   - set-variable    {scope, path, value}         写变量树（值支持 {{path}} 插值）
 *   - delete-variable {scope, path}                删变量
 *   - insert-note     {text, depth?}               产出注释（由调用方决定注入位置）
 *   - log             {message}                    插件日志
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScript = validateScript;
exports.interpolateValue = interpolateValue;
exports.triggerMatches = triggerMatches;
exports.runScript = runScript;
const variables_ts_1 = require("./variables.ts");
const ACTION_TYPES = new Set(['set-variable', 'delete-variable', 'insert-note', 'log']);
const SCOPES = ['global', 'preset', 'character', 'chat', 'message', 'script'];
/** 脚本 JSON 校验（注册入口用；返回错误描述，null = 合法） */
function validateScript(raw) {
    if (!raw || typeof raw !== 'object')
        return 'script must be object';
    const s = raw;
    if (typeof s.id !== 'string' || !s.id.trim())
        return 'script.id required';
    const trigger = s.trigger;
    if (!trigger || typeof trigger !== 'object')
        return 'script.trigger required';
    if (!['manual', 'on-variable-change', 'on-turn'].includes(String(trigger.type)))
        return `unknown trigger.type: ${String(trigger.type)}`;
    if (trigger.type === 'on-variable-change' && typeof trigger.variable !== 'string')
        return 'on-variable-change requires trigger.variable';
    if (!Array.isArray(s.actions))
        return 'script.actions must be array';
    for (const a of s.actions) {
        if (!a || typeof a !== 'object')
            return 'action must be object';
        if (!ACTION_TYPES.has(String(a.type)))
            return `unknown action.type: ${String(a.type)}`;
        if ((a.type === 'set-variable' || a.type === 'delete-variable')) {
            if (!SCOPES.includes(a.scope))
                return `action.scope must be one of ${SCOPES.join('/')}`;
            if (typeof a.path !== 'string' || !a.path)
                return 'action.path required';
        }
        if ((a.type === 'insert-note' || a.type === 'log') && typeof (a.text ?? a.message) !== 'string') {
            return `action.${a.type === 'insert-note' ? 'text' : 'message'} required`;
        }
    }
    return null;
}
/** 值里的 {{path}} 插值：从三级合并视图取值（set-variable value 为字符串时生效） */
function interpolateValue(value, merged) {
    if (typeof value !== 'string')
        return value;
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, p) => {
        const v = (0, variables_ts_1.getByPath)(merged, String(p).startsWith('/') ? String(p) : `/${String(p).replaceAll('.', '/')}`);
        return v === undefined ? m : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
}
/** 触发判定：变量变化事件（oldValue→newValue）是否命中脚本 trigger */
function triggerMatches(script, event) {
    if (script.enabled === false)
        return false;
    const t = script.trigger;
    if (t.type !== event.type)
        return false;
    if (t.type === 'on-variable-change') {
        if (t.variable !== event.variable)
            return false;
        if (t.equals !== undefined && t.equals !== event.newValue)
            return false;
    }
    return true;
}
/**
 * 执行脚本（白名单 action 顺序执行；单 action 出错即停并回报）。
 * 纯函数：trees 入参不被修改（各层先克隆）。
 */
function runScript(script, trees) {
    const next = {
        global: structuredClone(trees.global),
        character: structuredClone(trees.character),
        chat: structuredClone(trees.chat),
        preset: structuredClone(trees.preset ?? {}),
        message: structuredClone(trees.message ?? {}),
        script: structuredClone(trees.script ?? {}),
    };
    const notes = [];
    const logs = [];
    /**
     * 每个 action 求值时的最新合并视图：
     * script > message > chat > character > preset > global（内层私有优先；script 含自身私有树）。
     */
    const mergedView = () => (0, variables_ts_1.deepMergeVars)((0, variables_ts_1.mergeAllScopes)({
        global: next.global,
        preset: next.preset,
        character: next.character,
        chat: next.chat,
        message: next.message,
    }), next.script);
    for (const action of script.actions) {
        switch (action.type) {
            case 'set-variable':
                next[action.scope] = (0, variables_ts_1.setByPath)(next[action.scope], action.path, interpolateValue(action.value, mergedView()));
                break;
            case 'delete-variable':
                next[action.scope] = (0, variables_ts_1.deleteByPath)(next[action.scope], action.path);
                break;
            case 'insert-note':
                notes.push({ text: String(interpolateValue(action.text, mergedView())), depth: action.depth ?? 1 });
                break;
            case 'log':
                logs.push(String(interpolateValue(action.message, mergedView())));
                break;
        }
    }
    return { ok: true, trees: next, notes, logs };
}
