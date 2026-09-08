/**
 * JSON-Schema 最小子集校验器（D7 轻量 schema 校验）——零依赖纯函数。
 *
 * 支持面（递归 ≤ SCHEMA_MAX_DEPTH 层）：
 * - type: 'object' | 'string' | 'number' | 'boolean'（其余/未声明 type 不约束 = 放行）
 * - object 下的 properties（逐键递归）与 required（存在性检查）
 *
 * 定位：只为拦明显错形（写错类型/缺必填键），不做完整 JSON Schema——超深、循环、
 * 未支持关键字一律放行（宁可漏拦不误杀；消费方：/dsht-mvu/variables/register|patch、
 * dsht-plugin-tavern-helper facade 的 variables/merge 与 variables/schema）。
 */
export interface SchemaIssue {
    /** 变量树内路径（$ 起头；properties 逐段下钻，如 $.stat_data.好感度） */
    path: string;
    message: string;
}
/** 递归深度上限（≤5 层；超过放行——防循环 schema 拖死校验） */
export declare const SCHEMA_MAX_DEPTH = 5;
/** 最小子集校验（返回问题清单；空数组 = 通过） */
export declare function validateSchemaSubset(value: unknown, schema: unknown, path?: string, depth?: number): SchemaIssue[];
