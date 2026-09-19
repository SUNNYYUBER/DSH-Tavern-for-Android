/**
 * DSHTavern 世界书条目模型（M1 / T1.6，计划文档 §4.2 + §4.5 st-worldbook-* 知识条目）
 *
 * ST 世界书 JSON → 内部条目库的导入映射（规则层，无 LLM）。
 * 语义保持（§4.2）：constant 常驻 / 关键词触发（正则关键词、大小写、全词匹配）/
 * 递归扫描 / 深度注入 / scanDepth / token 预算。
 * P2#11 补齐：timed effects（sticky/cooldown/delay，消费侧见 trigger.ts）/
 * inclusion group（组互斥）。
 * 明确弃用（导入时记录 warning）：概率触发。
 */

/** 条目注入位置（对齐 ST world_info_position） */
export const WI_POSITION = {
  BEFORE: 0,
  AFTER: 1,
  AN_TOP: 2,
  AN_BOTTOM: 3,
  AT_DEPTH: 4,
  EM_TOP: 5,
  EM_BOTTOM: 6,
  OUTLET: 7,
} as const

/** 深度注入的角色 */
export type WIRole = 'system' | 'user' | 'assistant'

/** 内部世界书条目（ST 字段语义保留，字段名转我们的形态） */
export interface LoreEntry {
  id: string
  /** 条目名（ST comment） */
  comment: string
  content: string
  /** 关键词列表（可为 /regex/ 形式） */
  keys: string[]
  secondaryKeys: string[]
  /** 副关键词逻辑：0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL */
  selectiveLogic: number
  /** 常驻条目（蓝灯）：无条件激活 */
  constant: boolean
  /** 触发时激活（绿灯互斥组） */
  selective: boolean
  /** 注入位置 */
  position: number
  /** 深度注入的 depth */
  depth: number
  /** 深度注入的 role */
  role: WIRole
  /** 条目级扫描深度覆盖 */
  scanDepth: number | null
  /** 递归控制 */
  preventRecursion: boolean
  excludeRecursion: boolean
  /** 插入顺序（同位置内排序，大者优先——ST 语义） */
  insertionOrder: number
  /** 粘性：命中后持续 N 条消息强制注入（以可见消息游标计，0=关闭） */
  sticky: number
  /** 冷却：命中后 N 条消息内不再触发（sticky 生效优先于 cooldown，0=关闭） */
  cooldown: number
  /** 延迟：可见消息游标 < delay 时不触发（ST 语义：聊天长度不足前 N 条不触发，0=关闭） */
  delay: number
  /**  inclusion group：同组（逗号分隔多组）只保留 insertionOrder 最高的一条 */
  group: string
  /** 组内强制覆盖（true=不参与组互斥，命中即注入） */
  groupOverride: boolean
  /** 启用 */
  enabled: boolean
  /** 归属：书名（scope 由库层管理：global / bound:<角色> / session 书单） */
  book: string
}

/** 一本世界书（ST world JSON 导入形态） */
export interface LoreBook {
  name: string
  entries: LoreEntry[]
  /** 导入时发现但弃用的特性（diff 报告用） */
  importWarnings: string[]
}

// ST entry 字段名兼容读取（新旧两代字段名都认）
function pick<T>(entry: Record<string, unknown>, keys: string[], fallback: T): T {
  for (const k of keys) {
    if (entry[k] !== undefined && entry[k] !== null) return entry[k] as T
  }
  return fallback
}

/** ST 世界书 JSON → LoreBook（st-worldbook-knowledge 知识条目规则层） */
export function importLoreBook(name: string, raw: unknown): LoreBook {
  const warnings: string[] = []
  const obj = (raw ?? {}) as Record<string, unknown>
  // ST 两种形态：{ entries: { "0": {...} } }（对象索引）或数组
  const rawEntries: unknown[] = Array.isArray(obj.entries)
    ? obj.entries
    : obj.entries && typeof obj.entries === 'object'
      ? Object.values(obj.entries as Record<string, unknown>)
      : []

  const entries: LoreEntry[] = rawEntries.map((e, i) => {
    const r = (e ?? {}) as Record<string, unknown>
    // 弃用特性检测（§4.2：导入时明示；P2#11 后 timed effects / inclusion group 已支持，仅剩概率弃用）
    if (pick(r, ['probability'], 100) !== 100 && pick(r, ['probability'], 100) > 0) warnings.push(`#${i}「${String(r.comment ?? '')}」概率触发已弃用（按 100% 处理）`)

    const content = pick(r, ['content'], '')
    // key（旧版单数字符串）/ keys（新版数组）都认——pick 按序取第一个，字符串要包成数组
    const rawKeys = pick(r, ['key', 'keys'], [] as unknown)
    const keys = (Array.isArray(rawKeys) ? rawKeys : [rawKeys]).map(String).filter(k => k !== '')
    const rawSecondary = pick(r, ['keysecondary', 'secondaryKeys'], [] as unknown)
    const secondary = (Array.isArray(rawSecondary) ? rawSecondary : [rawSecondary]).map(String).filter(k => k !== '')

    return {
      id: `lore-${name}-${i}`,
      comment: pick(r, ['comment', 'name'], `条目 ${i}`),
      content,
      keys: keys.map(String).filter(k => k !== ''),
      secondaryKeys: secondary.map(String).filter(k => k !== ''),
      selectiveLogic: pick(r, ['selectiveLogic'], 0),
      constant: pick(r, ['constant'], false),
      selective: pick(r, ['selective'], false),
      position: pick(r, ['position', 'world_info_position'], WI_POSITION.BEFORE),
      depth: pick(r, ['depth', 'world_info_depth'], 4),
      role: (pick(r, ['role', 'world_info_role'], 'system') as WIRole),
      scanDepth: r.scanDepth != null ? Number(r.scanDepth) : null,
      preventRecursion: pick(r, ['preventRecursion'], false),
      excludeRecursion: pick(r, ['excludeRecursion'], false),
      insertionOrder: pick(r, ['order', 'insertion_order'], 100),
      sticky: pick(r, ['sticky'], 0),
      cooldown: pick(r, ['cooldown'], 0),
      delay: pick(r, ['delay'], 0),
      group: pick(r, ['group'], ''),
      groupOverride: pick(r, ['groupOverride'], false),
      enabled: pick(r, ['disable', 'disabled'], false) === false,
      book: name,
    }
  })

  return { name, entries, importWarnings: [...new Set(warnings)] }
}
