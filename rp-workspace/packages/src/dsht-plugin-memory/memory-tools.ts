/**
 * memory-tools.ts —— M3 读取层：两阶段核心（自研，纯函数 + 工具注册面）。
 *
 * 【架构】（计划书主轴：用户拍板的"两阶段生成循环"）
 * - 阶段 A（prompt build）：轻量目录注入打底 + 模型按需调 memory_* 工具多轮检索，
 *   产出"本回合记忆简报"。
 * - 阶段 B（文本输出）：简报进 SLOT_ORDERS.memory 槽位（30，位于角色卡20/世界书25之后、
 *   MVU 40/预设 50 之前），与 ST 移植预设机制一起组装最终请求。
 *
 * 【工具面】（注册范式照 dsh-plugin/index.ts:3603 lore_query 同款）
 * - memory_lookup：按关键词/人物查叶子摘要 → 返回命中摘要全文
 * - memory_floor：按楼号回读该楼**原文**（来自 memory-forest sidecar + 会话日志）
 * - memory_ledger：查台账当前态（物品/NPC/场景/悬念/主角档案）
 * - memory_timeline：查时间线索引（楼号+时间+一句话），给模型"有什么可查"的地图
 *
 * 【版权】全部自研；对柏宝书仅借鉴行为思路（其无 LICENSE，零源码/提示词复用）。
 */

import type { Leaf, LedgerState } from './memory-forest.ts'

// ---------------------------------------------------------------------------
// 纯函数：目录注入（阶段 A 打底，几百 token 封顶）
// ---------------------------------------------------------------------------

/** 目录条目：一行一条「#floor 时间 一句话」，模型据此决定是否深查 */
export interface CatalogEntry { floor: number; timeTag: string; brief: string }

/** 摘要一句话（取 text 首个非标题行，截 40 字） */
export function briefOf(leaf: Leaf): string {
  const line = (leaf.text || '').split('\n').map(l => l.trim()).find(l => l !== '' && !l.startsWith('#')) ?? ''
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

/** 时间线索引（最近 N 条；番外楼层排除） */
export function buildCatalog(leaves: readonly Leaf[], recentN = 12): CatalogEntry[] {
  const real = leaves.filter(l => !l.omake && l.text.trim() !== '')
  const recent = real.slice(Math.max(0, real.length - recentN))
  return recent.map(l => ({ floor: l.floor, timeTag: l.timeTag, brief: briefOf(l) }))
}

/** 目录注入文本（阶段 A pre-step 快照的 sections 条目；空记忆返回 '' 不注入） */
export function renderCatalogSection(catalog: readonly CatalogEntry[], ledger: LedgerState | null): string {
  if (catalog.length === 0 && !ledger) return ''
  const lines: string[] = ['【记忆索引】（生成正文前可调 memory_lookup/memory_floor/memory_ledger 查详情）']
  if (ledger) {
    if (ledger.currentTime) lines.push(`故事内时间：${ledger.currentTime}`)
    if (ledger.protagonist.status) lines.push(`主角状态：${ledger.protagonist.status}`)
    const open = ledger.openPlans.slice(0, 5).map(p => p.text)
    if (open.length > 0) lines.push(`未了结悬念：${open.join('；')}`)
  }
  if (catalog.length > 0) {
    lines.push('最近楼层摘要：')
    for (const c of catalog) lines.push(`#${c.floor}${c.timeTag ? `（${c.timeTag}）` : ''} ${c.brief}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 纯函数：工具实现核心（查叶子/回原文/查台账）
// ---------------------------------------------------------------------------

/** memory_lookup：关键词（空格分词）命中叶子摘要；按命中词数与楼层新近排序，取 topK */
export function lookupLeaves(leaves: readonly Leaf[], query: string, topK = 3): Leaf[] {
  const terms = String(query ?? '').split(/\s+/).filter(t => t.length > 0)
  if (terms.length === 0) return []
  const scored = leaves
    .filter(l => !l.omake && l.text.trim() !== '')
    .map(l => {
      let hits = 0
      for (const t of terms) if (l.text.includes(t) || l.timeTag.includes(t)) hits++
      return { l, hits }
    })
    .filter(x => x.hits > 0)
  scored.sort((a, b) => b.hits - a.hits || b.l.floor - a.l.floor)
  return scored.slice(0, Math.max(1, topK)).map(x => x.l)
}

/** memory_floor 的文本装配：给楼号 → 该楼摘要 + 提示（原文需从会话日志读，本函数只拼摘要面）。
 *  原文读取走既有 extractFloorsFromEvents 的楼层口径（同 turn 合并为 1 楼），调用方传入。 */
export function renderFloorDigest(leaf: Leaf | undefined, floorText: string | null, contextFloors = 1): string {
  if (!leaf && floorText === null) return `第 ${'' /* caller 校验 */}楼不存在或未摘要。`.replace('第 楼', '该楼')
  const lines: string[] = []
  if (leaf) {
    lines.push(`【#${leaf.floor} 摘要】${leaf.timeTag ? `（${leaf.timeTag}）` : ''}`)
    lines.push(leaf.text)
  }
  if (floorText !== null) {
    lines.push(`【#${leaf?.floor ?? 0} 原文】${floorText}`)
    if (contextFloors > 1) lines.push(`（已附相邻 ${contextFloors} 楼上下文）`)
  }
  return lines.join('\n')
}

/** memory_ledger 的文本装配：全台账或单本（items/npcs/scenes/plans/protagonist） */
export type LedgerSection = 'items' | 'npcs' | 'scenes' | 'plans' | 'protagonist' | 'all'
export function renderLedgerSection(state: LedgerState, section: LedgerSection = 'all'): string {
  const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)
  switch (section) {
    case 'items':
      return state.items.length === 0 ? '物品台账：（空）' : state.items.map(i => `- ${i.name}：持有=${i.owner} 位置=${i.location} ${cap(i.note, 60)}`).join('\n')
    case 'npcs':
      return state.npcs.length === 0 ? 'NPC 台账：（空）' : state.npcs.map(n => `- ${n.name}（${n.status}）${n.role} ${cap(n.state, 60)}`).join('\n')
    case 'scenes':
      return state.scenes.length === 0 ? '场景台账：（空）' : state.scenes.map(s => `- ${s.parent ? `${s.parent} > ` : ''}${s.name}`).join('\n')
    case 'plans':
      return (state.openPlans.length === 0 && state.resolvedPlans.length === 0)
        ? '悬念簿：（空）'
        : ['未了结：', ...state.openPlans.map(p => `- ${p.text}（第${p.createdFloor}楼立）`),
           '已了结（最近5）：', ...state.resolvedPlans.slice(0, 5).map(p => `- ${p.text} → ${p.resolution ?? ''}（第${p.resolvedFloor}楼）`)].join('\n')
    case 'protagonist':
      return `主角档案：${state.protagonist.status || '（空）'}`
    default: {
      const parts = [
        `故事内时间：${state.currentTime || '（未知）'}`,
        renderLedgerSection(state, 'protagonist'),
        `物品 ${state.items.length} 条 / NPC ${state.npcs.length} 名 / 地点 ${state.scenes.length} 处 / 未了结悬念 ${state.openPlans.length} 条`,
      ]
      return parts.join('\n')
    }
  }
}

// ---------------------------------------------------------------------------
// 工具注册面（声明式描述；由 dsh-plugin/index.ts 同款 tools.register 消费）
// ---------------------------------------------------------------------------

export interface ToolSpec {
  name: 'memory_lookup' | 'memory_floor' | 'memory_ledger' | 'memory_timeline'
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
  /** systemPrompt section 引导文案（order 与 lore_query=112 系列同区隔） */
  systemPromptText: string
}

export const MEMORY_TOOLS: readonly ToolSpec[] = [
  {
    name: 'memory_lookup',
    description: 'Search per-floor plot summaries for keywords (character/item/place/event). Returns matching summaries with floor numbers.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Space-separated keywords, e.g. "青锋剑 遗失"' }, topK: { type: 'integer', description: 'Max results (default 3)' } }, required: ['query'] },
    systemPromptText: 'Use memory_lookup to search past plot summaries by keywords (names, items, places) before writing scenes that reference earlier events.',
  },
  {
    name: 'memory_floor',
    description: 'Get the full summary and original floor text for a floor number found via memory_lookup/memory_timeline.',
    parameters: { type: 'object', properties: { floor: { type: 'integer', description: 'Floor number' }, withText: { type: 'boolean', description: 'Include original floor text (default true)' } }, required: ['floor'] },
    systemPromptText: 'Use memory_floor when a summary mentions something you need verbatim — it returns the original floor text.',
  },
  {
    name: 'memory_ledger',
    description: 'Read current state ledgers: items (ownership/location), npcs (status), scenes (map tree), plans (open/resolved), protagonist.',
    parameters: { type: 'object', properties: { section: { type: 'string', enum: ['items', 'npcs', 'scenes', 'plans', 'protagonist', 'all'], description: 'Which ledger to read (default all)' } }, required: [] },
    systemPromptText: 'Use memory_ledger to check current item ownership, NPC status, or unresolved plot threads before referencing them.',
  },
  {
    name: 'memory_timeline',
    description: 'List recent floor summaries with in-story timestamps (a catalog). Use it to orient before deep lookups.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Max entries (default 12)' } }, required: [] },
    systemPromptText: 'Use memory_timeline first if unsure what happened recently; it lists floor summaries with in-story time.',
  },
]
