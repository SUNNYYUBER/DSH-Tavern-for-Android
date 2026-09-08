/**
 * DSHTavern 酒馆助手宏引擎（第四轮：真适配，替代"全角化了事"）——纯函数模块。
 *
 * 支持 ST / 酒馆助手常用宏子集：
 * - 身份：{{user}} / {{char}} / {{persona}}（persona = rp/persona.json active 的描述）
 * - 变量：{{getvar::path}}（读三级作用域合并视图）、{{setvar::path::value}}
 *   （写入并输出空串；同文本内后序 getvar 看得到先行的 setvar——顺序求值）、
 *   {{addvar::path::数}}（数值加算）、{{incvar::path}} / {{decvar::path}}（±1；三者均输出空串）
 * - C2 类宏（MVU 作用域宏）：{{get_message_variable::path}} / {{get_chat_variable::path}}
 *   （chat 作用域）、{{get_character_variable::path}}（character）、
 *   {{get_preset_variable::path}}（preset，缺档回落 global）、{{get_global_variable::path}}
 *   （global）——读取走 ctx.scopeGet（缺省回落 getVar，向后兼容）；
 *   format_* 同名五族：值若为数字输出千分位字符串，否则同 get 族的字符串化
 * - 随机：{{random:a,b}} / {{random::a::b}}（每次重掷）；{{pick::a::b}}
 *   （稳定选择：种子 = stableSeed + 原文哈希 + 位置偏移，ST 同款语义）
 * - 骰子：{{roll::1d20}} / {{dice::2d6}}（同式别名；纯数字视为 1dN）
 * - 时间：{{time}} / {{date}} / {{datetime}} / {{weekday}} / {{isotime}} / {{isodate}}
 *   （本地时区；now 可注入便于测试）
 * - 注释：{{// …}} 与 {{! …}}（剥离）；{{noop}}（空串）
 * - 嵌套宏：迭代展开（宏求值产物里的 {{…}} 再展开，上限 10 轮防死循环）
 * - 未知宏：原样保留输出并记入 unknownMacros（不炸、不吞内容）
 *
 * 路径段分隔符 :: 与单 : 都兼容；变量路径点号（a.b）与 JSONPointer（/a/b）都接受。
 *
 * 与 preset/compiler.ts 的 neutralizePromptVariables 职责分工：
 * - neutralize 只用于"文本要写进 DSH persona 插件 config.text"的场景（严格插值器会炸 turn），
 *   是写盘期护栏；本引擎是运行期语义层——pre-step 快照注入与 /macros/expand 路由的
 *   {{…}} 由这里真正求值，不再中性化。
 *
 * 打包：esbuild 内联（dsht-plugin-tavern-helper / dsht-mvu / dsh-plugin 各自 bundle 时编入）。
 */
/** 变量路径 → 段数组（点号或斜杠分隔；JSONPointer ~1/~0 转义仅在斜杠形态下解码） */
export declare function parseVarPath(path: string): string[];
/** 段数组 → JSONPointer（路由落盘/undo 日志的规范形态） */
export declare function toPointer(path: string): string;
/** 按变量路径取值（不存在返回 undefined） */
export declare function readVarPath(tree: Record<string, unknown>, path: string): unknown;
/** 按变量路径写值（逐层建对象；返回新树，不改入参） */
export declare function writeVarPath(tree: Record<string, unknown>, path: string, value: unknown): Record<string, unknown>;
export interface TavernMacroContext {
    /** 用户名（persona 名；rp.json macros.user / persona.json active） */
    user: string;
    /** 角色名（rp.json macros.char） */
    char: string;
    /** persona 描述（rp/persona.json active 条目的 description；可空） */
    persona?: string;
    /** 变量读取（三级作用域合并视图；路径为点号或 JSONPointer） */
    getVar?: (path: string) => unknown;
    /** C2 类宏作用域读取（kind = chat/character/preset/global；缺省或缺命中回落 getVar——向后兼容） */
    scopeGet?: (kind: 'chat' | 'character' | 'preset' | 'global', path: string) => unknown;
    /** setvar 写回调（每次写入触发；引擎自身也累积 writes 返回） */
    setVar?: (path: string, value: string) => void;
    /** 稳定随机种子（pick 宏的稳定性锚点；缺省用空串） */
    stableSeed?: string;
    /** 时间源（测试注入；缺省 new Date()） */
    now?: Date;
}
export interface TavernMacroWrite {
    /** 规范 JSONPointer 形态 */
    path: string;
    value: string;
}
export interface TavernMacroResult {
    text: string;
    /** setvar 写入清单（顺序保留；调用方负责落盘） */
    writes: TavernMacroWrite[];
    /** 未识别宏原文（已原样保留在 text 里） */
    unknownMacros: string[];
}
/** 嵌套展开上限（宏求值产物再含 {{…}} 时迭代；防 setvar/getvar 自引用死循环） */
export declare const MACRO_MAX_ROUNDS = 10;
/**
 * 展开文本中的全部宏（顺序求值：setvar 写入后，同文本后序 getvar 可读回；
 * 求值产物里的宏迭代展开，上限 MACRO_MAX_ROUNDS 轮）。未知宏保留原文。
 */
export declare function expandTavernMacros(text: string, ctx: TavernMacroContext): TavernMacroResult;
