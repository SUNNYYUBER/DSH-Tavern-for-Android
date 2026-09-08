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
export declare function parsePath(path: string): string[];
/** 按 JSONPointer 取值（路径不存在返回 undefined） */
export declare function getByPath(tree: Record<string, unknown>, path: string): unknown;
/** 按 JSONPointer 赋值（逐层建对象；返回新树，不改入参） */
export declare function setByPath(tree: Record<string, unknown>, path: string, value: unknown): Record<string, unknown>;
/** 按 JSONPointer 删除（返回新树；路径不存在则原样） */
export declare function deleteByPath(tree: Record<string, unknown>, path: string): Record<string, unknown>;
/** 深合并（high 覆盖 low 的叶值；对象递归；数组/标量直接替换） */
export declare function deepMergeVars(low: Record<string, unknown>, high: Record<string, unknown>): Record<string, unknown>;
/** 三级合并：global < character < chat */
export declare function mergeScopes(global: Record<string, unknown>, character: Record<string, unknown>, chat: Record<string, unknown>): Record<string, unknown>;
/**
 * 六层合并视图（P2#12 六作用域；对照 ST 酒馆助手变量优先级，低 → 高）：
 * global < preset < character < chat < message。
 * script 作用域为脚本私有（Host 按 scriptId 隔离持有），不进通用合并视图。
 * 缺省层传 {} 即可——空树合并恒等，无 preset/message 内容时与三级 mergeScopes 结果一致。
 */
export declare function mergeAllScopes(scopes: {
    global?: Record<string, unknown>;
    preset?: Record<string, unknown>;
    character?: Record<string, unknown>;
    chat?: Record<string, unknown>;
    message?: Record<string, unknown>;
}): Record<string, unknown>;
