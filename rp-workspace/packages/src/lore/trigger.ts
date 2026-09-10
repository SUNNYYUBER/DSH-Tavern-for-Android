/**
 * DSHTavern 世界书触发引擎（M1 / T1.7，计划文档 §4.2 被动检索）
 *
 * SillyTavern checkWorldInfo 语义核心子集（§4.2 明确保留的部分）：
 * constant 常驻 / 关键词触发（正则关键词、大小写、全词匹配）/ 副关键词逻辑 /
 * 递归扫描（已激活条目内容作为下一轮扫描文本，最多 5 层）/ scanDepth 窗口 / token 预算。
 * P2#11 已落地（对照 dsh-worldbook src/context/worldbook.ts bookCandidates/dedupeGroups，MIT）：
 * timed effects（sticky/cooldown/delay，以可见消息游标计）/ inclusion group 组互斥（dedupeGroups）。
 * delay 语义注意：本引擎按 entry.ts 契约取「游标 < delay 不触发」（ST 聊天长度不足前 N 条不触发）；
 * dsh-worldbook 同名字段是「游标 < delay 强制注入」，两者语义相反，勿混抄。
 * 递归语义已与 dsh-worldbook bookCandidates L94 对齐确认：
 * preventRecursion=命中但内容不进递归 buffer；excludeRecursion=递归轮跳过该条目（既有实现，未改）。
 * @D 深度（position=4）由调用侧 spliceDepthInjections 实现（dsh-plugin/index.ts，
 * 深者先插语义同 dsh-worldbook inject.ts L56-77），不在本引擎。
 * AI 自写守卫（dsh-worldbook tools/index.ts 三层守卫 devGuard/scopeGuard/syncDevTool）：
 * 本仓库无 AI 侧世界书写入工具，无攻击面，不适用；未来若引入写工具需整套照抄三层守卫。
 * 已弃用（不在本引擎）：概率触发。
 *
 * P0-5：visibleMessageCursor 时间游标照抄 dsh-worldbook src/context/inject.ts 的
 * visibleMessageCursor（MIT © aam452，见 REF_PROJECTS_COMPARISON.md 领域六与致谢表）。
 */

import type { LoreEntry } from './entry.ts'

/**
 * 模型可见真实消息游标（dsh-worldbook inject.ts L99-107 同款语义）：只累计事件流里
 * 真实的 user（source.kind==='user'，排除插件注入/快照）与 assistant 消息——对齐
 * ST chat.length 的时间轴语义。decision.messages 是 inbox 取出批（长度不变），
 * 不能作时间游标；正确来源是会话事件流。游标值由 dsh-plugin pre-step 写进
 * rp/state/<sid>.json 的 cursor 键（供未来 sticky/cooldown/delay 等跨轮语义消费）。
 */
/**
 * 【心跳 47】`type` 放宽为可选：消费方 `sessionEventsSnapshot`（dsh-plugin/index.ts:302）
 * 的返回契约里 `type` 本就是可选的（适配器可能拿到不带 type 的坏行）。本函数内部只做
 * `e.type === '...'` 比较，对缺 type 的行天然安全——原来的必填声明反而让**忠实反映上游
 * 契约的调用点**报 TS2345，属于"声明比事实更严"的方向性错误。
 */
export function visibleMessageCursor(events: Array<{ type?: string; data?: unknown }>): number {
  let cursor = 0
  for (const e of events) {
    if (e.type === 'user/message') {
      const source = (e.data as { source?: { kind?: string } | null } | undefined)?.source
      if (source?.kind === 'user') cursor++
    } else if (e.type === 'assistant/message') {
      cursor++
    }
  }
  return cursor
}

/**
 * 跨轮 timed effect 区间（dsh-worldbook data/worldbook.ts TimedEffect 同款，MIT）：
 * 以「模型可见消息数」（visibleMessageCursor）为时间游标，[start, end) 生效。
 * 由调用方持久化（dsh-plugin 存 rp/state/<sid>.json 的 loreTimed 键）。
 */
export interface TimedEffect {
  entryId: string
  type: 'sticky' | 'cooldown'
  start: number
  end: number
}

/** 条目某类 timed effect 在游标处是否生效 */
export function isTimedActive(effects: TimedEffect[], entryId: string, type: TimedEffect['type'], cursor: number): boolean {
  return effects.some(e => e.entryId === entryId && e.type === type && cursor >= e.start && cursor < e.end)
}

/** 触发引擎配置（ST world_info_settings 对应物，导入映射源） */
export interface TriggerConfig {
  /** 扫描最近 N 条消息（全局默认；条目可覆盖） */
  scanDepth: number
  /** 递归最大轮数（ST/dsh-worldbook MAX_RECURSION=5） */
  maxRecursionSteps: number
  /** 关键词大小写敏感 */
  caseSensitive: boolean
  /** 全词匹配 */
  matchWholeWords: boolean
  /** token 预算（百分比 0-100，乘以上下文上限） */
  budgetPercent: number
  /** 预算封顶（token 数；0=不封顶） */
  budgetCap: number
  /** 上下文总 token 上限（预算计算基数） */
  contextTokenLimit: number
  /** 可见消息游标（sticky/cooldown/delay 的时间轴；缺省 0=不计时，timed effects 全部不生效） */
  cursor: number
  /** 调用方持久化的跨轮 timed effects（本轮判定基准；本轮新写入的会合入结果返回） */
  timedEffects: TimedEffect[]
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  scanDepth: 2,
  maxRecursionSteps: 5,
  caseSensitive: false,
  matchWholeWords: true,
  budgetPercent: 25,
  budgetCap: 0,
  contextTokenLimit: 65536,
  cursor: 0,
  timedEffects: [],
}

/** 触发结果条目（含触发原因，trace 消费） */
export interface ActivatedEntry {
  entry: LoreEntry
  /** 激活来源：constant / primary(主关键词) / secondary / recursion / sticky（粘性期内强制） */
  reason: 'constant' | 'primary' | 'secondary' | 'recursion' | 'sticky'
}

export interface TriggerResult {
  activated: ActivatedEntry[]
  /** 扫描轮次记录（递归可视化） */
  recursionRounds: number
  /** 触发 trace：每轮哪些条目被什么关键词击中 */
  trace: Array<{ round: number; entryId: string; key: string }>
  /** 估算 token 用量（字符数/4 近似） */
  estimatedTokens: number
  /** 预算内未能注入的条目（超预算裁剪） */
  budgetDropped: LoreEntry[]
  /** 合并后的跨轮 timed effects（过期已清理 + 本轮新写入；调用方原样持久化，下轮回传） */
  timedEffects: TimedEffect[]
}

/** 单个关键词 → RegExp（含 /regex/ 形式、大小写、全词） */
function keyToPattern(key: string, cfg: TriggerConfig): RegExp {
  const regexMatch = key.match(/^\/(.+)\/(\w*)$/)
  if (regexMatch) {
    const flags = regexMatch[2].includes('i') || !cfg.caseSensitive ? 'i' : ''
    return new RegExp(regexMatch[1], flags)
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 全词匹配：ST 真实语义用 \W 边界（非字母数字=边界；CJK 属 \w，中文词相邻不触发是 ST 已知行为）
  // 含空格的多词关键词直接 includes 语义（ST 同款分支）
  const whole = cfg.matchWholeWords && !/\s/.test(key)
    ? `(?:^|\\W)(${escaped})(?:$|\\W)`
    : escaped
  return new RegExp(whole, cfg.caseSensitive ? '' : 'i')
}

/** 消息文本是否命中条目主关键词 */
function matchPrimary(entry: LoreEntry, text: string, cfg: TriggerConfig): string | null {
  for (const key of entry.keys) {
    try {
      if (keyToPattern(key, cfg).test(text)) return key
    } catch {
      // 无效正则关键词：跳过该关键词
    }
  }
  return null
}

/** 副关键词逻辑（ST world_info_logic） */
function matchSecondary(entry: LoreEntry, text: string, cfg: TriggerConfig): boolean {
  if (entry.secondaryKeys.length === 0) return true
  const hits = entry.secondaryKeys.filter(k => {
    try {
      return keyToPattern(k, cfg).test(text)
    } catch {
      return false
    }
  })
  switch (entry.selectiveLogic) {
    case 0: return hits.length > 0        // AND_ANY：任一命中即可
    case 1: return hits.length === entry.secondaryKeys.length  // NOT_ALL：全部命中才否（此处表示"必须全不命中"→false 语义见下）
    case 2: return hits.length === 0      // NOT_ANY：任一命中即否
    case 3: return hits.length === entry.secondaryKeys.length  // AND_ALL：全部命中
    default: return hits.length > 0
  }
}

/** 组装扫描文本：最近 scanDepth 条消息（倒序拼接，ST 同语义） */
export function buildScanText(messages: string[], scanDepth: number, entryOverride?: number | null): string {
  const depth = entryOverride != null && entryOverride > 0 ? entryOverride : scanDepth
  return messages.slice(-depth).join('\n')
}

/**
 * inclusion group 组互斥（dsh-worldbook worldbook.ts dedupeGroups L341-373 同款语义，MIT）：
 * 无组 / groupOverride 条目全部保留；其余按逗号拆组，每组只留 insertionOrder 最高的一条。
 */
function dedupeGroups(items: ActivatedEntry[]): ActivatedEntry[] {
  const self = new Set<string>() // 无 group 或 groupOverride → 全部保留
  const groups = new Map<string, ActivatedEntry[]>()
  for (const a of items) {
    const g = a.entry.group
    if (!g || a.entry.groupOverride) {
      self.add(a.entry.id)
      continue
    }
    for (const name of String(g).split(',').map(s => s.trim()).filter(Boolean)) {
      const list = groups.get(name) ?? []
      list.push(a)
      groups.set(name, list)
    }
  }
  const out: ActivatedEntry[] = []
  const seen = new Set<string>()
  for (const a of items) {
    if (self.has(a.entry.id) && !seen.has(a.entry.id)) {
      seen.add(a.entry.id)
      out.push(a)
    }
  }
  for (const list of groups.values()) {
    const winner = [...list].sort((x, y) => y.entry.insertionOrder - x.entry.insertionOrder)[0]
    if (winner && !seen.has(winner.entry.id)) {
      seen.add(winner.entry.id)
      out.push(winner)
    }
  }
  return out
}

/**
 * 世界书触发扫描（每轮组装必跑，纯代码零 token）。
 *
 * @param entries 候选条目（scope 收集后的：全局 + 角色 bound + session 书单，§4.14）
 * @param recentMessages 最近消息文本数组（旧→新）
 * @param config 触发配置
 */
export function triggerWorldInfo(
  entries: LoreEntry[],
  recentMessages: string[],
  config: Partial<TriggerConfig> = {},
): TriggerResult {
  const cfg = { ...DEFAULT_TRIGGER_CONFIG, ...config }
  const activated = new Map<string, ActivatedEntry>()
  const trace: TriggerResult['trace'] = []
  const budgetDropped: LoreEntry[] = []

  // ---- timed effects 基准（dsh-worldbook bookCandidates L104-112 同款，MIT）----
  // 过期 effect 清理（pruneTimedEffects 语义：end<=cursor 不再生效也不带回给调用方）
  const cursor = cfg.cursor
  const priorEffects = (cfg.timedEffects ?? []).filter(e => e.end > cursor)
  const newEffects: TimedEffect[] = []
  const stickyActive = (id: string) => isTimedActive(priorEffects, id, 'sticky', cursor)
  const cooldownActive = (id: string) => isTimedActive(priorEffects, id, 'cooldown', cursor)

  const activate = (entry: LoreEntry, reason: ActivatedEntry['reason'], round: number, key: string) => {
    activated.set(entry.id, { entry, reason })
    trace.push({ round, entryId: entry.id, key })
    // 写入跨轮 timed effects（dsh-worldbook L193-199：sticky/cooldown 未生效中的才新开区间）
    if ((entry.sticky ?? 0) > 0 && !stickyActive(entry.id)) {
      newEffects.push({ entryId: entry.id, type: 'sticky', start: cursor, end: cursor + entry.sticky })
    }
    if ((entry.cooldown ?? 0) > 0 && !cooldownActive(entry.id)) {
      newEffects.push({ entryId: entry.id, type: 'cooldown', start: cursor, end: cursor + entry.cooldown })
    }
  }

  // delay 门（本引擎契约：游标 < delay 不触发；dsh-worldbook 同名字段为强制注入，语义相反）
  const delayBlocked = (entry: LoreEntry) => (entry.delay ?? 0) > 0 && cursor < entry.delay

  // ---- 第 0 轮：sticky 强制 / constant 常驻 / 主关键词扫描 ----
  const scanText = buildScanText(recentMessages, cfg.scanDepth)
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (delayBlocked(entry)) continue
    const isSticky = stickyActive(entry.id)
    // cooldown 抑制（sticky 生效优先于 cooldown）
    if (!isSticky && cooldownActive(entry.id)) continue
    // sticky 生效：无条件激活（跳过关键词判定），reason='sticky'
    if (isSticky) {
      activate(entry, 'sticky', 0, '(sticky)')
      continue
    }
    if (entry.constant) {
      activate(entry, 'constant', 0, '(constant)')
      continue
    }
    if (entry.keys.length === 0) continue
    const hitKey = matchPrimary(entry, scanText, cfg)
    if (hitKey !== null && matchSecondary(entry, scanText, cfg)) {
      activate(entry, 'primary', 0, hitKey)
    }
  }

  // ---- 递归轮：已激活条目的内容作为新扫描文本 ----
  let recursionRounds = 0
  for (let round = 1; round <= cfg.maxRecursionSteps; round++) {
    const activatedText = [...activated.values()]
      .filter(a => !a.entry.preventRecursion)
      .map(a => a.entry.content)
      .join('\n')
    if (activatedText === '') break

    let newHits = false
    for (const entry of entries) {
      if (!entry.enabled || activated.has(entry.id)) continue
      if (delayBlocked(entry)) continue
      if (cooldownActive(entry.id)) continue // sticky 生效的第 0 轮已激活，此处只剩 cooldown 抑制
      if (entry.excludeRecursion) continue // 递归轮排除的条目
      const hitKey = matchPrimary(entry, activatedText, cfg)
      if (hitKey !== null && matchSecondary(entry, activatedText, cfg)) {
        activate(entry, 'recursion', round, hitKey)
        newHits = true
      }
    }
    recursionRounds = round
    if (!newHits) break
  }

  // ---- inclusion group 组互斥（预算裁剪前，dsh-worldbook renderWorldbookInjection L323-324 同款顺序）----
  const deduped = dedupeGroups([...activated.values()])

  // ---- token 预算裁剪 ----
  const estimateTokens = (s: string) => Math.ceil(s.length / 4)
  const budgetTokens = Math.floor(
    (cfg.budgetPercent / 100) * cfg.contextTokenLimit,
  )
  const cap = cfg.budgetCap > 0 ? Math.min(budgetTokens, cfg.budgetCap) : budgetTokens

  // 排序：insertionOrder 大者优先（ST 语义），constant 优先保住
  const sorted = deduped.sort((a, b) => {
    if (a.entry.constant !== b.entry.constant) return a.entry.constant ? -1 : 1
    return b.entry.insertionOrder - a.entry.insertionOrder
  })

  let used = 0
  const kept: ActivatedEntry[] = []
  for (const a of sorted) {
    const cost = estimateTokens(a.entry.content)
    if (used + cost > cap) {
      budgetDropped.push(a.entry)
      continue
    }
    kept.push(a)
    used += cost
  }

  return {
    activated: kept,
    recursionRounds,
    trace,
    estimatedTokens: used,
    budgetDropped,
    timedEffects: [...priorEffects, ...newEffects],
  }
}
