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
  path: string
  message: string
}

/** 递归深度上限（≤5 层；超过放行——防循环 schema 拖死校验） */
export const SCHEMA_MAX_DEPTH = 5

/** 最小子集校验（返回问题清单；空数组 = 通过） */
export function validateSchemaSubset(
  value: unknown,
  schema: unknown,
  path = '$',
  depth = 0,
): SchemaIssue[] {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return []
  if (depth >= SCHEMA_MAX_DEPTH) return []
  const s = schema as Record<string, unknown>
  const type = typeof s.type === 'string' ? s.type : ''
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [{ path, message: '应为对象（object）' }]
    }
    const issues: SchemaIssue[] = []
    const tree = value as Record<string, unknown>
    if (Array.isArray(s.required)) {
      for (const raw of s.required) {
        const key = String(raw)
        if (!(key in tree)) issues.push({ path: `${path}.${key}`, message: '缺少必填键（required）' })
      }
    }
    if (s.properties !== null && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      for (const [key, sub] of Object.entries(s.properties as Record<string, unknown>)) {
        if (tree[key] === undefined) continue // 未写入的键不校验（注册期允许先立 schema 后补值）
        issues.push(...validateSchemaSubset(tree[key], sub, `${path}.${key}`, depth + 1))
      }
    }
    return issues
  }
  if (type === 'string') {
    return typeof value === 'string' ? [] : [{ path, message: '应为字符串（string）' }]
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [{ path, message: '应为数字（number）' }]
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? [] : [{ path, message: '应为布尔（boolean）' }]
  }
  return [] // 未声明/未支持 type：不约束
}
