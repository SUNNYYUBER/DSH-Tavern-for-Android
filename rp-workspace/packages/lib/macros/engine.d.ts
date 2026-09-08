/**
 * DSHTavern 宏引擎（M1 / T1.1，计划文档 §4.1.1）——P0-4 统一后：
 * 本类是 dsht-plugin-shared/macros.ts 的 expandTavernMacros 的**薄包装**（单一引擎、
 * 语义一致），保留 class 形态仅为兼容既有调用面（assembly/pipeline.ts 与 dsh-plugin 的
 * processActivatedEntries）。行为分叉（缺 addvar/incvar/decvar/datetime/weekday/isotime/
 * isodate/noop、getvar 无 setvar 顺序求值）自此消灭——这些宏由 expandTavernMacros 统一提供。
 *
 * 统一方向参考 dsh-agent-rp 的 roleplay-macro.ts（ReplayableRoleplayMacros 单引擎设计；
 * MIT © hewzhew，见 REF_PROJECTS_COMPARISON.md 领域四与致谢表）。
 *
 * 语义要点（全部由 expandTavernMacros 继承）：
 * - random：每次求值真随机重掷；pick：稳定选择（种子 = stableSeed + 原文哈希 + 位置偏移）
 * - roll/dice：骰子公式（纯数字视为 1dN）
 * - getvar/setvar/addvar/incvar/decvar：顺序求值（同文本内后序 getvar 看得到先行 setvar）；
 *   本包装不传 setVar 回调 → writes 只进返回值（TavernMacroResult.writes 由底层累积，
 *   组装期调用方不落盘，setvar 求值后从文本消失而非保留原文）
 * - 未识别宏：保留原文 + 记入 unknownMacros（ST 同语义，不吞不报错）；
 *   插件注册宏（register）对未知宏有接管优先权
 * - 兼容别名：get_message_variable / format_message_variable（MVU 宏形态）已由底层引擎
 *   原生注册（C2 类宏：scopeGet chat 作用域读取；scopeGet 缺省回落 getvar——本包装不传
 *   scopeGet，语义与旧版"别名重写为 getvar"等价，故不再做前置重写）
 */
/** 宏求值上下文：身份与状态来源 */
export interface MacroContext {
    /** 用户名（persona.name） */
    user: string;
    /** 角色名 */
    char: string;
    /** persona 描述（可空） */
    personaDescription?: string;
    /** 会话状态读取器（getvar 源；MVU stat_data 等） */
    getState?: (path: string) => unknown;
    /** 稳定随机种子（session id——pick 宏的稳定性锚点，对应 ST 的 chatIdHash） */
    stableSeed: string;
}
/** 宏求值结果与警告（组装 trace 消费） */
export interface MacroResult {
    text: string;
    /** 未识别宏原文（保留在文本里，同时记录） */
    unknownMacros: string[];
}
/** 插件注册的扩展宏（Engram 式；计划文档 §4.1.1 插件注册扩展点） */
export interface MacroHandler {
    name: string;
    /** 返回 null 表示不处理（交回默认行为 = 保留原文 + 记入 unknownMacros） */
    replace: (args: string, ctx: MacroContext) => string | null;
}
export declare class MacroEngine {
    private handlers;
    /** 插件宏注册（返回注销器） */
    register(handler: MacroHandler): () => void;
    /**
     * 组装期宏求值：展开文本中的全部宏（委托 expandTavernMacros）。
     * 未知宏先交插件注册 handler 接管；无人接管则保留原文并记录（吞内容 = 静默丢数据，违背 P5）。
     */
    evaluate(text: string, ctx: MacroContext): MacroResult;
}
