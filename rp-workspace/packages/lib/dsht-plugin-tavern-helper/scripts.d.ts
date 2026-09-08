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
/**
 * 变量作用域（P2#12 六作用域；对照 ST 酒馆助手 global/preset/character/chat/message/script）。
 * 前三层为共享文件层；preset/message/script 为会话持有层（session-store.ts 快照）。
 * action scope='script' 时不需调用方给 scriptId——落脚本自身 id 的私有树。
 */
export type VariableScope = 'global' | 'preset' | 'character' | 'chat' | 'message' | 'script';
export interface ScriptTrigger {
    /** manual：仅手动/HTTP 触发；on-variable-change：变量变化时；on-turn：每轮 */
    type: 'manual' | 'on-variable-change' | 'on-turn';
    /** on-variable-change：监视的变量路径（JSONPointer） */
    variable?: string;
    /** on-variable-change：仅当新值等于该值时触发（缺省 = 任何变化） */
    equals?: unknown;
}
export type ScriptAction = {
    type: 'set-variable';
    scope: VariableScope;
    path: string;
    value: unknown;
} | {
    type: 'delete-variable';
    scope: VariableScope;
    path: string;
} | {
    type: 'insert-note';
    text: string;
    depth?: number;
} | {
    type: 'log';
    message: string;
};
export interface TavernScript {
    id: string;
    enabled?: boolean;
    trigger: ScriptTrigger;
    actions: ScriptAction[];
}
/**
 * 执行时的变量树视图（执行器就地改副本，结果由调用方落盘）。
 * 前三个共享文件层必填（向后兼容）；preset/message/script 会话持有层可选
 * （无 sessionId 时调用方给不出，缺省按空树执行、结果不落盘）。
 * script 层 = 本脚本（script.id）的私有变量树。
 */
export interface ScriptScopeTrees {
    global: Record<string, unknown>;
    character: Record<string, unknown>;
    chat: Record<string, unknown>;
    preset?: Record<string, unknown>;
    message?: Record<string, unknown>;
    script?: Record<string, unknown>;
}
export interface ScriptRunResult {
    ok: boolean;
    /** 执行后的变量树（set/delete-variable 已应用；含传入的会话持有层副本） */
    trees: ScriptScopeTrees;
    /** insert-note 产出的注释（顺序保留） */
    notes: Array<{
        text: string;
        depth: number;
    }>;
    logs: string[];
    error?: string;
}
/** 脚本 JSON 校验（注册入口用；返回错误描述，null = 合法） */
export declare function validateScript(raw: unknown): string | null;
/** 值里的 {{path}} 插值：从三级合并视图取值（set-variable value 为字符串时生效） */
export declare function interpolateValue(value: unknown, merged: Record<string, unknown>): unknown;
/** 触发判定：变量变化事件（oldValue→newValue）是否命中脚本 trigger */
export declare function triggerMatches(script: TavernScript, event: {
    type: 'manual' | 'on-variable-change' | 'on-turn';
    variable?: string;
    newValue?: unknown;
}): boolean;
/**
 * 执行脚本（白名单 action 顺序执行；单 action 出错即停并回报）。
 * 纯函数：trees 入参不被修改（各层先克隆）。
 */
export declare function runScript(script: TavernScript, trees: ScriptScopeTrees): ScriptRunResult;
