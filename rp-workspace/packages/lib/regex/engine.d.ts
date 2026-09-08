/**
 * DSHTavern 正则引擎（M1 / T1.2，计划文档 §4.5 st-regex-scripts 知识条目）
 *
 * SillyTavern 正则脚本兼容（三时机 + placement + depth 过滤）：
 * - markdownOnly（仅显示）/ promptOnly（仅提示词）/ 两者皆否（永久改写，编辑保存时执行）
 * - placement：1=用户输入 2=AI输出 3=slash命令 5=世界书 6=推理内容（ST SCRIPT_TYPES）
 * - minDepth/maxDepth：按消息深度过滤
 * - substituteRegex：findRegex 的宏替换模式（0=RAW 不替换 1=ESCAPED 转义后替换）
 * - $1/$<name>/{{match}} 捕获组引用 + trimStrings 裁剪 + replaceString 二次宏求值（由调用方注入）
 */
/** 正则脚本数据（ST 兼容字段名保留，导入器直接映射） */
export interface RegexScript {
    id: string;
    scriptName: string;
    findRegex: string;
    replaceString: string;
    /** 命中后从结果中移除的片段 */
    trimStrings: string[];
    /** 作用位置：1=USER_INPUT 2=AI_OUTPUT 3=SLASH_COMMAND 5=WORLD_INFO 6=REASONING */
    placement: number[];
    disabled: boolean;
    markdownOnly: boolean;
    promptOnly: boolean;
    /** 消息编辑保存时也执行（permanent 时机） */
    runOnEdit: boolean;
    /** findRegex 宏替换：0=RAW 1=ESCAPED 2=NONE */
    substituteRegex: number;
    minDepth: number | null;
    maxDepth: number | null;
}
/** 正则作用位置常量（对齐 ST SCRIPT_TYPES） */
export declare const PLACEMENT: {
    readonly USER_INPUT: 1;
    readonly AI_OUTPUT: 2;
    readonly SLASH_COMMAND: 3;
    readonly WORLD_INFO: 5;
    readonly REASONING: 6;
};
/** 正则执行时机（三时机模型） */
export type RegexTiming = 'display' | 'prompt' | 'permanent';
/** 执行上下文：消息深度与宏替换回调（组装层调用时注入宏引擎） */
export interface RegexContext {
    /** 当前消息深度（0 = 最新）；null = 非消息上下文（如世界书内容） */
    depth: number | null;
    /** findRegex 宏替换回调（substituteRegex 模式用；不传则 RAW） */
    substituteRegex?: (raw: string, escaped: boolean) => string;
    /** replaceString 的宏求值回调（ST：replaceString 支持 {{macros}}） */
    substituteMacros?: (text: string) => string;
}
/** 单脚本命中记录（组装 trace / 正则测试器 UI 消费） */
export interface RegexHit {
    scriptId: string;
    scriptName: string;
    count: number;
}
export interface RegexRunResult {
    text: string;
    hits: RegexHit[];
}
/**
 * 执行一批正则脚本（同 ST：按数组顺序依次应用）。
 *
 * @param scripts 全部脚本（含 disabled——由内部过滤）
 * @param text 输入文本
 * @param timing 三时机
 * @param placement 作用位置（PLACEMENT 常量）
 * @param ctx 深度 + 宏回调
 */
export declare function runRegexScripts(scripts: RegexScript[], text: string, timing: RegexTiming, placement: number, ctx?: RegexContext): RegexRunResult;
/**
 * ST 正则 JSON → RegexScript[] 导入映射（st-regex-scripts 知识条目的规则层核心）。
 * 容错：缺字段给 ST 默认值；id 缺失生成。
 */
export declare function importRegexScripts(raw: unknown): {
    scripts: RegexScript[];
    warnings: string[];
};
