/**
 * DSHTavern 剧情记忆插件（Cordis 插件，挂 DSH web profile 全局层）——楼层总结记忆。
 *
 * vector-enhanced 楼层总结机制的独立插件化（用户拍板 2026-09-02，与
 * dsht-plugin-mvu / dsht-plugin-tavern-helper / dsht-plugin-prompt-template 并列，
 * 设置进 DSH 自带 设置→插件「可配置」tab）。与 dsh-plugin 内置的 memory_save/
 * memory_query 工具（模型主动存事实，规则层）互补：本插件**自动、周期性**地
 * 把剧情原文浓缩成 markdown 摘要。
 *
 * 数据流：
 * 1. dsh-plugin 每轮 pre-step 把可见消息计数写进 rp/state/<sid>.json 的 cursor 键
 *    （visibleMessageCursor 口径：真实 user/assistant 消息，快照/插件注入不算）。
 * 2. 本插件轮询（20s）对比进度 rp/memory-progress/<sid>.json 的 lastFloor——
 *    跨过 N 楼触发总结。
 * 3. 总结：读 session.jsonl 提取 (lastFloor, cursor] 楼层原文 → ctx.llm.stream
 *    （agentDefaultModel 当前选择，与 /llm/classify 同通道）→ markdown 摘要。
 * 4. 落盘：$DSH_HOME/skills/wb-memory-<slug>/references/lore.json（角色工作区专属
 *    记忆本，constant 常驻条目，comment = 记忆#<起>-<止> 幂等锚）；并把该书登记进
 *    工作区 rp.json.books（缺失时补）。
 * 5. 注入：自有 pre-step 钩子每轮注入独立快照消息（constant 条目进触发引擎会被
 *    budgetCap 挤掉——独立注入与世界书预算解耦）。注入按核心契约持久化进 surface，
 *    下一轮请求由 surface 重组时自动带上。
 * 6. 上下文瘦身（§2.2）：注入快照按契约每轮持久化 → surface 每轮膨胀 ~20 万字符，
 *    请求从 surface 重组时全量带上（实测 114 楼会话单请求 770k/873k tokens，上游
 *    必炸）。本插件用官方 replace 原语（surfaceOp: {op:'replace'}，compaction 同款）
 *    把「记忆本已覆盖的老历史前缀 + 陈旧快照副本」折叠出模型视图——**日志保留全部
 *    数据**（聊天记录零丢失），只是请求不再投影它们。触发阈值：视图 est > 80k
 *    tokens（est = 字符 × 0.31，DeepSeek 中文口径实测校准）。
 * 7. 回退安全：cursor < lastFloor（会话回退）→ 删除覆盖区间的记忆条目 + lastFloor
 *    回退到幸存区间尾；进度与记忆本永远一致。
 * 8. 展开回显（§2.3 ⑤/④，2026-09-03）：折叠只改模型视图、日志与界面回看零丢失——
 *    把折叠区间的原文「临时还给 AI」：
 *    - 单次（⑤）：UI「展开给 AI」→ POST /dsht-memory/expand 落待办文件 → 下一轮
 *      pre-step 从会话事件流提取区间原文 → 宏中性化 + 按近窗字符预算截尾 → one-shot
 *      快照注入（source.oneshot=true，影子化无条件收回——单次生效）；
 *    - 窗口（④）：AI 可见楼层数调大后，期望窗口 [cursor-M+1, foldedUpTo] 露出的折叠
 *      原文以稳定签名快照注回（source.windowRange 记录实际覆盖；预算所限 capped 时
 *      视为已满足——重注入同一段无意义），常驻到窗口收缩/再扩张事件。
 *
 * 路由前缀 /dsht-memory（health / settings / status / summarize / reset）。
 * 设置：settings 命名空间 dsht-plugin-memory（真实 Schema：总开关 / 每 N 楼 /
 * 保留近 M 楼原文 / 近窗字符预算 / 折叠老楼层）。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { WI_POSITION, type LoreEntry } from '../lore/entry.ts'
import {
  queryOf, readJsonBody, registerPrefix, resolveDshHome, sendJson,
  type LikePluginContext,
} from '../dsht-plugin-shared/http.ts'
import { scanSessionHeaders, type SessionHeaderHit } from '../dsht-plugin-shared/session-surgery.ts'
import { atomicWriteText } from '../dsht-plugin-shared/atomic-fs.ts'
// 【阶段3 2026-09-10】会话写入合法形态：surfaceOp 字段名自适应 + 合法标记载体
// （0.1.5 起 start/end → startSeq/endSeq；source 顶层自定义键会被迁移器拒）
import { markerSource, replaceRange, readMarker, appendReplace, readSurgicalPayload, type AppendableSession } from '../dsht-plugin-shared/session-write.ts'
// E1-E8/E11：表格系统（st-memory-enhancement 机制级移植）——纯逻辑层在本目录 tables.ts，
// 这里只做数据面接线（/tables 读取 + step-summary/rebuild 两个 llm 路由）
import {
  executeTableEdits, isValidTablesSessionId, loadSheets,
  parseTableEdits, pushSheetHistory, renderTableData, renderTablePrompt, saveSheets,
  type TableEdit,
} from './tables.ts'

export const name = 'dsht-plugin-memory'
export const inject = ['webServer', 'settings', 'llm', 'agentDefaultModel']

// ---------------------------------------------------------------------------
// 类型（宿主服务最小面——与 dsh-plugin 的 LikeContext 同构，按需声明）
// ---------------------------------------------------------------------------

interface LikeSettingsSvc {
  register?: (ns: string, schema: unknown, options?: { base?: unknown }) => unknown
  update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown>
  get?: (ns: string) => unknown
}
interface LikeLlm {
  stream: (req: {
    provider: string
    model: string
    system?: string
    messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>
  }) => AsyncIterable<{ type: string; text?: string }>
}
interface LikeAgentDefaultModel {
  currentSelection?: () => { provider?: string; model?: string } | null
}

/** pre-step 事件里的 session 最小面（真实 Session 的运行时形态，按需声明） */
interface SessionRef {
  header?: { cwd?: string }
  id?: unknown
  surface?: { nodes?: number[] }
  events?: Record<string, { type?: unknown; data?: unknown } | undefined>
  append: (type: string, data: unknown, opts?: { surfaceOp?: unknown; sourceEventSeqs?: number[] }) => unknown
}
interface Ctx extends LikePluginContext {
  settings?: LikeSettingsSvc
  llm?: LikeLlm
  agentDefaultModel?: LikeAgentDefaultModel
  on?: (event: string, handler: (raw: unknown, next: () => Promise<unknown>) => Promise<unknown>) => unknown
}

// ---------------------------------------------------------------------------
// 配置（settings 命名空间 dsht-plugin-memory；Schema 驱动「可配置」tab 渲染）
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  enabled: boolean
  everyN: number
  keepNearFloors: number
  charBudget: number
  foldOldFloors: boolean
  summaryMaxChars: number
}

const CONFIG_DEFAULTS: MemoryConfig = { enabled: true, everyN: 11, keepNearFloors: 30, charBudget: 60_000, foldOldFloors: true, summaryMaxChars: 600 }

// Schema 键用中文（设置→插件「可配置」tab 直接以键名为标签——本版 schemastery 无 describe）
// 每N楼总结默认 11 = 用户 vectors-enhanced 原始配置 autoSummarize.interval 的忠实对齐（zip 实证）
const CONFIG_SCHEMA = z.object({
  总开关: z.boolean().default(true),
  每N楼总结: z.number().default(11),
  保留近M楼原文: z.number().default(30),
  近窗字符预算: z.number().default(60_000),
  折叠老楼层: z.boolean().default(true),
  摘要字数上限: z.number().default(600),
})

export const CONFIG_NS = 'dsht-plugin-memory'

/** Schema 值（中文键）→ 内部字段映射 */
export function configFromSchemaValue(v: unknown): MemoryConfig {
  const o = (v ?? {}) as Record<string, unknown>
  const num = (x: unknown, def: number, min: number): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= min ? Math.floor(x) : def
  return {
    enabled: o['总开关'] !== false,
    everyN: num(o['每N楼总结'], 11, 5),
    keepNearFloors: num(o['保留近M楼原文'], 30, 0),
    charBudget: num(o['近窗字符预算'], 60_000, 5_000),
    foldOldFloors: o['折叠老楼层'] !== false,
    summaryMaxChars: num(o['摘要字数上限'], 600, 100),
  }
}

/** 读生效配置（settings 服务缺席/坏值 → 默认值；schema 调用补默认并校验） */
export function readConfig(raw: unknown): MemoryConfig {
  try {
    return configFromSchemaValue(CONFIG_SCHEMA(raw ?? {}))
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

// ---------------------------------------------------------------------------
// 纯逻辑（可单测）
// ---------------------------------------------------------------------------

export interface SessionEventLike { type?: unknown; seq?: unknown; data?: unknown }
export interface FloorText { floor: number; role: 'user' | 'assistant'; text: string }

/** 事件数据里的消息文本（单 text 块取 text，多块拼接）。
 * 两种事件形态都认（迁移会话实测）：
 * - 新格式：data = { role, content: [{type:'text',text}] }（flat）；
 * - 迁移格式：data = { turn, step, message: { role, content: [...] } }（嵌在 data.message）。 */
function eventText(data: unknown): string {
  const d = data as {
    content?: Array<{ type?: unknown; text?: unknown }>
    message?: { content?: Array<{ type?: unknown; text?: unknown }> }
  } | undefined
  const blocks = (d?.content ?? d?.message?.content ?? []) as Array<{ type?: unknown; text?: unknown }>
  return blocks
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
}

/**
 * 从 session.jsonl 事件流提取楼层文本（纯函数）。
 * 楼层口径 = 用户口径（2026-09-04 拍板）：**一轮用户输入 = 1 楼，一轮 AI 回答
 * （同 turn 的全部思考/工具 step）= 1 楼**——与 UI 楼层徽章（RpNativeChat
 * floorIndexOf）同口径；与世界书 visibleMessageCursor（消息条数技术游标）解耦。
 * - user/message 仅当 data.source.kind === 'user'（快照/插件注入不算）计 1 楼；
 * - assistant/message 按 data.turn（迁移格式 data.message.turn）分组：同 turn 的
 *   后续消息并入当前楼（文本 '\n\n' 拼接）；turn 缺失时每条计 1 楼（旧口径退化）。
 * 楼层从 1 起。返回全量楼层文本 + 楼层总数 cursor（turn 口径，作为总结进度游标）。
 *
 * 【2026-09-08 鲁棒性】逻辑回退掩码感知：扫描 dsht-rp 的回退/编辑/重新生成 marker
 * （source.rolledBackTo / editedFrom / regeneratedFrom + 事件自身 seq），真实消息 seq
 * 落在 (hideAfter, markerSeq) replace 区间内的**整条跳过**（不计数、不进摘要）——
 * 旧实现从全量日志数楼层：被回退的内容会被后续 chunk 重新摘要进记忆本（用户明确
 * 撤回的内容「复活」进上下文），且楼层号与 UI（掩码后重排）错位。marker 无 seq 或
 * 事件无 seq（老数据）时退化为旧口径。注意与 UI 掩码失效语义**有意不同**：UI 在
 * marker 之后出现新真用户消息时整体失效（回看全量）；记忆侧区间永久跳过（回退的
 * 上下文永远不该经记忆回流）。
 */
export function extractFloorsFromEvents(events: SessionEventLike[]): { floors: FloorText[]; cursor: number } {
  const floors: FloorText[] = []
  let cursor = 0
  let lastAssistantTurn: number | null = null
  // 回退掩码预扫：marker → 跳过区间 (hideAfter, markerSeq)
  const skipRanges: Array<{ from: number; to: number }> = []
  for (const e of events) {
    if (!e || typeof e.type !== 'string' || e.type !== 'user/message' || typeof e.seq !== 'number') continue
    const s = (e.data as { source?: { plugin?: unknown } | null } | undefined)?.source
    if (!s || s.plugin !== 'dsht-rp') continue
    // 【阶段4 2026-09-11 修复 · 静默失败族】原实现只读 source 顶层的
    // rolledBackTo/editedFrom/regeneratedFrom。0.1.5 起写侧改官方白名单形态
    // （form:'snapshot' + sections[{name:'dsht:surgical', text}]，存量迁进 'dsht:legacy'），
    // 顶层键恒 undefined → 掩码恒空 → 被回退的楼层继续进摘要（撤回的内容「复活」）。
    // 统一走 readSurgicalPayload（新形态 + 存量形态 + 顶层键三路兜底）。
    const payload = readSurgicalPayload(s)
    let hide = -1
    if (typeof payload.rolledBackTo === 'number') hide = payload.rolledBackTo
    if (typeof payload.regeneratedFrom === 'number') hide = Math.max(hide, payload.regeneratedFrom)
    if (typeof payload.editedFrom === 'number') hide = Math.max(hide, payload.editedFrom - 1)
    if (hide >= 0 && hide < e.seq) skipRanges.push({ from: hide + 1, to: e.seq - 1 })
  }
  const inSkipRange = (seq: number): boolean =>
    skipRanges.some(r => seq >= r.from && seq <= r.to)
  for (const e of events) {
    if (!e || typeof e.type !== 'string') continue
    const eSeq = typeof e.seq === 'number' ? e.seq : null
    if (e.type === 'user/message') {
      const source = (e.data as { source?: { kind?: string } | null } | undefined)?.source
      if (source?.kind !== 'user') continue
      if (eSeq !== null && inSkipRange(eSeq)) continue
      cursor++
      lastAssistantTurn = null
      floors.push({ floor: cursor, role: 'user', text: eventText(e.data) })
    } else if (e.type === 'assistant/message') {
      const d = e.data as { turn?: unknown; message?: { turn?: unknown } } | undefined
      const turn = typeof d?.turn === 'number' ? d.turn : (typeof d?.message?.turn === 'number' ? d.message.turn : null)
      // 同 turn 的后续 step（思考/工具轮）并入当前楼，不另计楼层
      if (typeof turn === 'number' && turn === lastAssistantTurn) {
        const cur = floors[floors.length - 1]
        if (cur !== undefined && cur.role === 'assistant') {
          const t = eventText(e.data)
          if (t) cur.text = cur.text ? `${cur.text}\n\n${t}` : t
        }
        continue
      }
      if (eSeq !== null && inSkipRange(eSeq)) { lastAssistantTurn = typeof turn === 'number' ? turn : lastAssistantTurn; continue }
      cursor++
      lastAssistantTurn = typeof turn === 'number' ? turn : null
      floors.push({ floor: cursor, role: 'assistant', text: eventText(e.data) })
    }
  }
  return { floors, cursor }
}

/** 下一个待总结区间：跨过 N 楼才触发；单次只吐一个 N 楼块（长跨度分多轮消化） */
export function nextChunk(lastFloor: number, cursor: number, everyN: number): { from: number; to: number } | null {
  if (!Number.isFinite(lastFloor) || !Number.isFinite(cursor) || everyN < 1) return null
  if (cursor < 0 || cursor <= lastFloor) return null
  const from = lastFloor + 1
  if (cursor - lastFloor < everyN) return null
  return { from, to: Math.min(cursor, from + everyN - 1) }
}

/** comment = 记忆#<起>-<止> → 楼层区间（非记忆条目/格式不符返回 null） */
export function parseMemoryRange(comment: string): { start: number; end: number } | null {
  const m = /^记忆#(\d+)-(\d+)$/.exec(String(comment ?? '').trim())
  return m ? { start: Number(m[1]), end: Number(m[2]) } : null
}

// ---------------------------------------------------------------------------
// 上下文瘦身（§2.2）——surface 影子化（纯函数规划 + 官方 replace 原语执行）
// ---------------------------------------------------------------------------

/** pre-step decision.messages 里只有 claimed 新消息 + 钩子注入（核心契约：
 * agent-loop preStep 的 messages = inbox.claim() 结果，历史在 systemPrompt.assemble
 * 的 assembly 里从 surface 重组）——所以**批次级折叠够不到请求的大头**（turn 44
 * 873k tokens 实证）。真正的瘦身对象是 surface：注入快照按契约每轮持久化进
 * surface（每轮 +20 万字符），请求从 surface 重组时全量带上。
 * 影子化 = session.append('user/message', marker, { surfaceOp: { op: 'replace',
 * start, end } })——官方原语（types.d.ts："any surface-replacing producer may
 * use it"，compaction 同款）：被影子化的事件**留在日志里**（聊天数据零丢失），
 * 只是模型视图不再投影它们。 */

// ---------------------------------------------------------------------------
// @adapt contract:session-api.eventAt / session-api.events-snapshot
// 0.1.2 坑 #22（W32 实机取证）：Session 的 `.events` getter 已从公开面**移除**
// （dsh-session 0.1.2-rc.1 的 lib 里 `get events` 出现 0 次），替代物是
// `snapshotEvents(from, to)` 方法与 `eventAt(seq)`。本插件此前直读 `session.events`
// → undefined → `events?.[seq]` 全 undefined → nodes 恒空 → estTokens 恒 0 →
// shadowSurface 静默 early-return。**症状：上下文瘦身从未生效（零 replace op），
// 每次请求把 6 份快照原样重发（427k 字符 / 120k est tokens）。**
// 下面两个适配器与 dsh-plugin 的 sessionEventAt / sessionEventsSnapshot 同语义，
// 本插件自包含（不引 @deepseek-ai 运行时依赖），故各自持有一份。
// ---------------------------------------------------------------------------

/** 读一个 seq 的事件：0.1.2 用 eventAt(seq)，旧对象回落 .events[seq]。 */
export function sessionEventAt(
  session: unknown,
  seq: number,
): { type?: unknown; data?: unknown; time?: unknown; seq?: unknown } | undefined {
  const s = session as {
    eventAt?: (q: number) => { type?: unknown; data?: unknown; time?: unknown; seq?: unknown } | undefined
    events?: Record<string | number, { type?: unknown; data?: unknown; time?: unknown; seq?: unknown } | undefined>
  }
  if (typeof s.eventAt === 'function') return s.eventAt(seq)
  if (Array.isArray(s.events)) return s.events[seq] as { type?: unknown; data?: unknown } | undefined
  return s.events?.[seq]
}

/** 全量事件快照：0.1.2 用 snapshotEvents()，旧对象回落 .events（数组或字典）。 */
export function sessionEventsSnapshot(
  session: unknown,
): Array<{ type?: unknown; data?: unknown; time?: unknown; seq?: unknown }> {
  const s = session as { snapshotEvents?: () => readonly unknown[]; events?: unknown }
  if (typeof s.snapshotEvents === 'function') {
    return s.snapshotEvents() as Array<{ type?: unknown; data?: unknown; time?: unknown; seq?: unknown }>
  }
  if (Array.isArray(s.events)) return s.events as Array<{ type?: unknown; data?: unknown }>
  if (s.events && typeof s.events === 'object') {
    return Object.values(s.events) as Array<{ type?: unknown; data?: unknown }>
  }
  return []
}

/** surface 节点信息（钩子从 session.surface.nodes + sessionEventAt(session, seq) 派生） */
export interface SurfaceNodeInfo {
  seq: number
  /** 真实楼层消息：assistant 或 source.kind==='user' 的 user（口径 = turn 楼层） */
  isFloor: boolean
  /** assistant 消息的 turn 号（同 turn 连续 assistant 合并为一楼；user/未知 = null） */
  turn: number | null
  /** 插件注入快照：source.form==='snapshot'（每轮重注的持久化副本） */
  isSnapshot: boolean
  /** 快照签名（plugin + sections 名单）——同签名只留最新一份 */
  sig: string
  /** 消息 text 块总字数 */
  chars: number
}

export interface ShadowOp {
  start: number
  end: number
  /** history = 老楼层前缀（大段剧情，已由记忆本承载）；snapshot = 陈旧快照副本（纯冗余） */
  kind: 'history' | 'snapshot'
}

export interface ShadowPlan {
  ops: ShadowOp[]
  /** 影子化前后的模型视图字数（不含本轮新注入） */
  charsBefore: number
  charsAfter: number
  /** 影子化的楼层区间（绝对楼层号，用于日志） */
  flooredUpTo: number
}

/**
 * 影子化规划（纯函数）：
 * 1) 老历史前缀——从末尾数楼层，保留 min(近 M 楼, 字符预算) 的窗口，窗口之前的全部
 *    节点（含夹在其中的旧快照）合成**一个** replace op（marker = 一条说明消息）。
 *    零信息丢失：只折叠记忆本已覆盖的楼层（boundary = min(记忆覆盖, 已保留窗口起点)），
 *    记忆滞后时窗口自动收缩。
 * 2) 陈旧快照去重——每个签名只保留最后一份副本：**本轮新注入的副本视为最新**（签名
 *    命中 freshSigs 的 surface 副本全部影子化——应用重启后 retained 表清空会全量重注，
 *    不豁免 surface 旧副本就会双份进请求），否则保留视图里最后一份（retained 跳过依赖
 *    它承载内容）；其余副本影子化，同 turn 的连续副本合并成一个 op。
 *    前一轮的影子 marker 落在本轮 prefix 区间内时随前缀一并折叠（自清洁）。
 */
export function planShadowOps(
  nodes: SurfaceNodeInfo[],
  opts: { keepNearFloors: number; charBudget: number; memoryMaxFloor: number; foldFloors: boolean; cursor: number; freshSigs?: ReadonlySet<string>; windowKeepSeq?: number | null; foldHistory?: boolean },
): ShadowPlan {
  const { keepNearFloors, charBudget, memoryMaxFloor, foldFloors, cursor, freshSigs, windowKeepSeq } = opts
  // 历史前缀折叠开关（2026-09-10 心跳 33）：有信息损失（原文被摘要顶替），
  // 故仍受体积阈值门控（调用方按 est > 80k 传入）。默认 true 保持既有语义/单测兼容；
  // 快照去重不受此开关影响——那是零信息损失的纯去重，任何体积下都该做。
  const foldHistory = opts.foldHistory !== false
  const charsBefore = nodes.reduce((s, n) => s + n.chars, 0)
  const ops: ShadowOp[] = []
  if (nodes.length === 0) return { ops, charsBefore, charsAfter: charsBefore, flooredUpTo: 0 }

  // 楼层组（turn 口径）：连续同 turn 的 assistant 合并一组（一轮 AI 回答 = 1 楼，
  // 思考/工具 step 绝不拆楼），user 楼层独立一组。组是窗口计数与折叠边界的原子
  // 单位；夹在组内的注入快照随组一并折叠（history op 本就覆盖整个前缀区间）。
  const floorGroups: Array<{ startIdx: number; endIdx: number; chars: number }> = []
  {
    let g: { startIdx: number; endIdx: number; chars: number } | null = null
    let gTurn: number | null = null
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (!n.isFloor) continue // 注入快照等非楼层节点不断组（随所在组折叠）
      if (g !== null && n.turn !== null && gTurn !== null && n.turn === gTurn) {
        g.endIdx = i
        g.chars += n.chars
      } else {
        if (g !== null) floorGroups.push(g)
        g = { startIdx: i, endIdx: i, chars: n.chars }
        gTurn = n.turn
      }
    }
    if (g !== null) floorGroups.push(g)
  }
  const nFloors = floorGroups.length
  // 绝对楼层锚定：surface 视图末楼层 = 会话最新楼层 = cursor（turn 口径楼层总数；
  // 末楼永不影子化）；影子化后视图内楼层数 < cursor，不能用视图内序数当绝对楼层号
  // （turn 43 教训）
  const lastFloorAbs = cursor > 0 ? cursor : nFloors
  const absOf = (j: number): number => lastFloorAbs - (nFloors - 1 - j)

  // ---- 1) 老历史前缀 ----
  // 保留窗口：从末尾数 M 楼、且累计字数不超预算（胖卡大楼层时字符预算先到）
  let keptFromJ = nFloors // 无窗口 → 前缀关闭
  if (foldFloors && nFloors > 0) {
    let count = 0
    let chars = 0
    let j = nFloors - 1
    while (j >= 0) {
      const c = floorGroups[j].chars
      if (count >= keepNearFloors || chars + c > charBudget) break
      chars += c
      count++
      keptFromJ = j
      j--
    }
  }
  // 记忆覆盖边界：视图内最后一个 abs ≤ memoryMaxFloor 的楼层（零信息丢失——
  // 前缀绝不越过记忆覆盖线；记忆滞后时前缀部分覆盖，未覆盖楼层留在视图里）
  let boundaryJ = -1
  for (let j = 0; j < nFloors; j++) {
    if (absOf(j) <= memoryMaxFloor) boundaryJ = j
    else break
  }
  const prefixEndJ = (foldFloors && foldHistory) ? Math.min(boundaryJ, keptFromJ - 1) : -1
  let prefixEndIdx = -1
  if (prefixEndJ >= 0) {
    prefixEndIdx = floorGroups[prefixEndJ].endIdx
  }
  if (prefixEndIdx >= 0) {
    ops.push({ start: nodes[0].seq, end: nodes[prefixEndIdx].seq, kind: 'history' })
  }

  // ---- 2) 保留窗口内的陈旧快照副本（连续段合并）----
  // 豁免规则：本轮新注入（签名命中 freshSigs）的副本视为最新——surface 上同签名副本
  // 全部影子化（重启后 retained 清空全量重注时，不豁免就会双份进请求）；无新注入时
  // 每个签名保留视图里**最后一份**（retained 跳过依赖它承载内容），其余影子化；
  // 连续的可影子节点合并成一个 op（marker 数量有界）。
  const winFrom = prefixEndIdx + 1
  const lastOfSig = new Map<string, number>()
  for (let i = winFrom; i < nodes.length; i++) {
    if (nodes[i].isSnapshot) lastOfSig.set(nodes[i].sig, i)
  }
  const shadowRuns: Array<[number, number]> = []
  let runStart = -1
  for (let i = winFrom; i < nodes.length; i++) {
    const n = nodes[i]
    const supersededByFresh = freshSigs !== undefined && freshSigs.has(n.sig)
    // 单次展开副本（oneshot）：无条件影子化——它们恒来自前几轮（本轮新注入尚未落
    // surface），生命周期 = 一轮请求；窗口副本（windowCopy）：windowKeepSeq 管控——
    // null = 全收（窗口不再需要注回内容），number = 指定 seq 完全豁免（含同签名去重），
    // undefined = 无窗口规则（出错路径，按普通快照去重）
    const exempt = windowKeepSeq !== undefined && n.windowCopy === true && n.seq === windowKeepSeq
    const shadowable = n.isSnapshot && !exempt && (
      supersededByFresh ||
      lastOfSig.get(n.sig) !== i ||
      n.oneshot === true ||
      (n.windowCopy === true && windowKeepSeq !== undefined && n.seq !== windowKeepSeq)
    )
    if (shadowable) {
      if (runStart < 0) runStart = i
      continue
    }
    if (runStart >= 0) { shadowRuns.push([runStart, i - 1]); runStart = -1 }
  }
  if (runStart >= 0) shadowRuns.push([runStart, nodes.length - 1])
  for (const [a, b] of shadowRuns) {
    ops.push({ start: nodes[a].seq, end: nodes[b].seq, kind: 'snapshot' })
  }

  const charsOf = (from: number, to: number) => nodes.slice(from, to + 1).reduce((s, n) => s + n.chars, 0)
  const shadowed = ops.reduce((s, op) => {
    const a = nodes.findIndex(n => n.seq === op.start)
    const b = nodes.findIndex(n => n.seq === op.end)
    return s + charsOf(a, b)
  }, 0)
  const markers = ops.length * 30 // marker 消息字数（说明文字，估算 30 字/条）
  const prefixOp = ops.find(o => o.kind === 'history')
  const flooredUpTo = prefixOp ? absOf(prefixEndJ) : 0
  return { ops, charsBefore, charsAfter: charsBefore - shadowed + markers, flooredUpTo }
}

/** 记忆条目工厂（constant 常驻——注入复用 dsh-plugin pre-step 的触发引擎） */
export function buildMemoryEntry(bookName: string, from: number, to: number, summary: string): LoreEntry {
  return {
    id: `lore-mem-${bookName}-${from}-${to}`,
    comment: `记忆#${from}-${to}`,
    content: String(summary ?? '').trim(),
    keys: [],
    secondaryKeys: [],
    selectiveLogic: 0,
    constant: true,
    selective: false,
    position: WI_POSITION.BEFORE,
    depth: 4,
    role: 'system',
    scanDepth: null,
    preventRecursion: false,
    excludeRecursion: false,
    insertionOrder: 3,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    group: '',
    groupOverride: false,
    enabled: true,
    book: bookName,
  }
}

/**
 * 回退裁剪（纯函数）：楼层回退到 cursor 后，覆盖区间超出 cursor 的记忆条目作废；
 * lastFloor = 幸存条目的最大区间尾（无幸存 → 0）。进度与记忆本由此保持一致。
 */
export function rollbackMemoryBook(entries: LoreEntry[], cursor: number): { entries: LoreEntry[]; lastFloor: number; dropped: number } {
  const kept = entries.filter(e => {
    const r = parseMemoryRange(e.comment)
    return r === null || r.end <= cursor
  })
  const lastFloor = kept.reduce((m, e) => {
    const r = parseMemoryRange(e.comment)
    return r ? Math.max(m, r.end) : m
  }, 0)
  return { entries: kept, lastFloor, dropped: entries.length - kept.length }
}

const FLOOR_TEXT_CAP = 2000 // 单楼原文截断（防止单楼超长把总结上下文撑爆）
const PROMPT_BODY_CAP = 60000 // 楼层拼接总长截断（保尾部——越近的剧情越重要）

/** 总结 prompt（纯函数）：system 定输出协议，user 带楼层原文。
 *  summaryMaxChars = 用户可自定义的摘要字数上限（软指令——写进 prompt 供模型参考，
 *  不做硬截断；DSH 原生压缩同样无字数强制，口径一致）。 */
export function buildSummarizePrompt(from: number, to: number, floors: FloorText[], summaryMaxChars = 600): { system: string; user: string } {
  const cap = Number.isFinite(summaryMaxChars) && summaryMaxChars >= 100 ? Math.floor(summaryMaxChars) : 600
  const system = [
    '你是剧情记忆压缩器。把给定的 RP 剧情原文压缩成一份剧情记忆，供 AI 在后续楼层回看。',
    '输出 markdown（不要任何前后缀评论），分节：',
    '## 时间地点 / ## 人物状态 / ## 关系变化 / ## 事件与伏笔 / ## 关键词',
    '- 只记事实与状态，不写感想；数字（时间/楼层/数量）原样保留；',
    '- 「关键词」一行列 人名/物品/地名（空格分隔），供世界书检索；',
    `- 全文不超过 ${cap} 字；原文未提及的分节写「（无）」。`,
  ].join('\n')
  let body = floors
    .map(f => `[第${f.floor}楼·${f.role === 'user' ? '用户' : '角色'}]\n${f.text.slice(0, FLOOR_TEXT_CAP)}`)
    .join('\n\n')
  if (body.length > PROMPT_BODY_CAP) body = `…（前文过长已截）\n${body.slice(-PROMPT_BODY_CAP)}`
  const user = `以下是第 ${from} 到 ${to} 楼的剧情原文，请按协议输出剧情记忆：\n\n${body}`
  return { system, user }
}

// ---------------------------------------------------------------------------
// 展开回显（§2.3 ⑤/④）——纯函数
// ---------------------------------------------------------------------------

/** 残留 ASCII 宏中性化（dsh-plugin neutralizeResidualMacros 同款）：插值器连
 *  source.sections[].text 一起扫，楼层原文可能含 {{...}}（ST 脚本输出）——不中性化
 *  会炸 turn（"malformed prompt variable reference"）。 */
export function neutralizeMacros(text: string): string {
  return text.includes('{{') ? text.split('{{').join('｛｛').split('}}').join('｝｝') : text
}

/** 期望注回窗口：AI 可见楼层数 M 下，折叠边界 foldedUpTo 之内露出的区间
 *  [max(1, cursor-M+1), foldedUpTo]；无需注回（无折叠 / 窗口未触及折叠边界）→ null */
export function desiredWindow(cursor: number, keepNearFloors: number, foldedUpTo: number): { from: number; to: number } | null {
  if (!Number.isFinite(cursor) || !Number.isFinite(keepNearFloors) || !Number.isFinite(foldedUpTo)) return null
  if (foldedUpTo < 1 || keepNearFloors < 1 || cursor < 1) return null
  const from = Math.max(1, cursor - keepNearFloors + 1)
  if (from > foldedUpTo) return null
  return { from, to: foldedUpTo }
}

/** 展开快照文本（纯函数）：区间楼层从尾部（最近）往回装配，超预算整楼丢弃
 *  （至少保留一楼）；effectiveFrom > from 即预算截尾（capped）。宏中性化。 */
export function buildExpandSnapshot(
  kind: 'oneshot' | 'window',
  from: number,
  to: number,
  floors: readonly FloorText[],
  budget: number,
): { text: string; effectiveFrom: number; effectiveTo: number; capped: boolean } | null {
  const inRange = floors.filter(f => f.floor >= from && f.floor <= to && f.text.trim() !== '')
  if (inRange.length === 0) return null
  const kept: FloorText[] = []
  let chars = 0
  for (let i = inRange.length - 1; i >= 0; i--) {
    const f = inRange[i]
    const cost = f.text.length + 30
    if (kept.length > 0 && chars + cost > budget) break
    kept.unshift(f)
    chars += cost
  }
  const first = kept[0]
  const last = kept[kept.length - 1]
  const capped = first.floor > inRange[0].floor
  const capNote = capped ? '；预算所限仅含最近部分，更早楼层未含' : ''
  const header = kind === 'oneshot'
    ? `【展开回显（单次）】第 ${first.floor}-${last.floor} 楼原文（应请求临时还给模型，下一轮起自动收回${capNote}）`
    : `【展开回窗】第 ${first.floor}-${last.floor} 楼原文（AI 可见窗口扩大后注回，窗口收缩时收回${capNote}）`
  const body = kept.map(f => `[第${f.floor}楼·${f.role === 'user' ? '用户' : '角色'}]\n${neutralizeMacros(f.text)}`).join('\n\n')
  return { text: `${header}\n\n${body}`, effectiveFrom: first.floor, effectiveTo: last.floor, capped }
}

/** 历史折叠 marker 文本 → 折叠边界（旧会话无持久化 fold 态时的回退解析） */
export function parseFoldedFromMarker(text: string): number {
  const m = /第 1-(\d+) 楼原文已折叠/.exec(String(text ?? ''))
  return m ? Number(m[1]) : 0
}

/** 窗口副本覆盖判定：尾部对齐 + 头部覆盖；预算截尾副本（capped）在预算未再放大时
 *  视为已满足——同一段 capped 文本重注入无意义 */
export function rangeCovers(
  copy: { from: number; to: number; capped?: boolean; budget?: number },
  want: { from: number; to: number },
  budget: number,
): boolean {
  if (!Number.isFinite(copy?.from) || !Number.isFinite(copy?.to)) return false
  if (copy.to < want.to) return false
  if (copy.from <= want.from) return true
  return copy.capped === true && (copy.budget ?? 0) >= budget
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

interface ProgressFile { lastFloor?: unknown; updatedAt?: unknown }

export function apply(ctx: Ctx, _config: unknown): void {
  const dshHome = resolveDshHome()
  const memoryBookName = '剧情记忆'

  // ---- 注入 + 上下文瘦身：自有 pre-step 钩子 ----
  // 注入：不走 rp.json.books + 触发引擎（constant 条目进触发预算会被 budgetCap 挤掉，
  // 实测 droppedByBudget=14）——独立快照消息，role:'user'（rc.8 冷启动校验）。
  // retained 跳过（文本不变不重注）+ 影子化豁免每个签名的最新副本 → 请求恒一份记忆快照；
  // 唯一风险（core compaction 摘要掉最新副本）在本插件主动影子化（视图恒瘦、压力远低
  // 于阈值）下不会触发。id 必填：无 id 消息持久化后重启 resume 校验整会话拒载（turn 42→43
  // 实证事故）。
  const retainedPlot = new WeakMap<object, string>()
  ctx.on('agent/pre-step', async (raw: unknown, next: () => Promise<unknown>) => {
    const decision = (await next()) as { kind?: string; messages?: unknown[] }
    if (decision?.kind !== 'enter') return decision
    try {
      const agent = (raw as { agent?: { session?: SessionRef } }).agent
      const session = agent?.session
      if (!session) return decision
      const slug = await slugFromCwd(session.header?.cwd)
      if (!slug) return decision
      const cfg = readEffectiveConfig()
      const sid = String((session as { id?: unknown }).id ?? '')
      const book = await loadMemoryBook(slug)
      const maxFloor = book.entries.reduce((m, e) => {
        const r = parseMemoryRange(e.comment)
        return r ? Math.max(m, r.end) : m
      }, 0)
      const messages = (decision.messages ?? []) as Array<Record<string, unknown>>

      // 0.⑤ 单次展开：消费待办（UI「展开给 AI」→ /expand 落盘 → 本轮注入 one-shot
      // 快照；source.oneshot=true → 下一轮影子化无条件收回 = 单次生效）
      let injected = false
      let expandNote = ''
      const floorsCache: { v: { floors: FloorText[]; cursor: number } | null } = { v: null }
      const floorsOfSession = (): FloorText[] => {
        if (floorsCache.v === null) {
          floorsCache.v = extractFloorsFromEvents(sessionEventsSnapshot(session) as SessionEventLike[])
        }
        return floorsCache.v.floors
      }
      /** 楼层总数（turn 口径：一轮用户输入/一轮 AI 回答 = 1 楼，与 UI 楼层/记忆锚一致） */
      const floorCursorOfSession = (): number => {
        if (floorsCache.v === null) floorsOfSession()
        return floorsCache.v?.cursor ?? 0
      }
      try {
        const pendingPath = join(dshHome, 'rp', 'memory-expand', `${sid}.json`)
        const parsed = JSON.parse(await readFile(pendingPath, 'utf8').catch(() => 'null')) as { requests?: Array<{ from?: unknown; to?: unknown }> } | null
        const reqs = Array.isArray(parsed?.requests) ? parsed.requests : []
        if (reqs.length > 0) {
          const froms = reqs.map(r => Number(r.from)).filter(n => Number.isFinite(n) && n >= 1)
          const tos = reqs.map(r => Number(r.to)).filter(n => Number.isFinite(n) && n >= 1)
          const built = froms.length > 0 && tos.length > 0
            ? buildExpandSnapshot('oneshot', Math.min(...froms), Math.max(...tos), floorsOfSession(), cfg.charBudget)
            : null
          if (built) {
            messages.push({
              id: `dsht-memory-expand-${randomUUID()}`,
              role: 'user',
              content: [{ type: 'text', text: built.text }],
              source: { kind: 'plugin', plugin: name, form: 'snapshot', oneshot: true, sections: [{ name: 'dsht-memory:oneshot', text: built.text }] },
            })
            injected = true
            expandNote = `；单次展开 第${built.effectiveFrom}-${built.effectiveTo} 楼`
          }
          await rm(pendingPath, { force: true })
        }
      } catch (e) {
        console.warn(`[dsht-memory] 单次展开消费失败（不影响本 turn）：${(e as Error).message}`)
      }

      // 0.④ 窗口扩张核对：可见楼层数调大后，期望窗口 [cursor-M+1, foldedUpTo] 露出的
      // 折叠原文以稳定签名快照注回（常驻到收缩/再扩张事件；capped 副本视为已满足）。
      // windowKeepSeq：null=窗口副本全收，number=只留指定 seq，undefined=无规则（出错路径）
      let windowKeepSeq: number | null | undefined
      try {
        const folded = await foldedUpToOf(sid, session)
        const cursorW = floorCursorOfSession()
        const want = desiredWindow(cursorW, cfg.keepNearFloors, folded)
        if (want === null) {
          windowKeepSeq = null
        } else {
          const copies = scanWindowCopies(session)
          const last = copies[copies.length - 1]
          if (last !== undefined && rangeCovers(last.range, want, cfg.charBudget)) {
            windowKeepSeq = last.seq
          } else {
            const built = buildExpandSnapshot('window', want.from, want.to, floorsOfSession(), cfg.charBudget)
            if (built) {
              messages.push({
                id: `dsht-memory-window-${randomUUID()}`,
                role: 'user',
                content: [{ type: 'text', text: built.text }],
                source: {
                  kind: 'plugin', plugin: name, form: 'snapshot',
                  windowRange: { from: built.effectiveFrom, to: built.effectiveTo, capped: built.capped, budget: cfg.charBudget },
                  sections: [{ name: 'dsht-memory:expand-window', text: built.text }],
                },
              })
              injected = true
              expandNote += `${expandNote ? '；' : ''}窗口注回 第${built.effectiveFrom}-${built.effectiveTo} 楼`
            }
            windowKeepSeq = null
          }
        }
      } catch (e) {
        windowKeepSeq = undefined
        console.warn(`[dsht-memory] 窗口核对失败（不影响本 turn）：${(e as Error).message}`)
      }

      // 1) 记忆快照注入（文本不变跳过——视图上的最新副本由影子化豁免保留）
      if (book.entries.length > 0) {
        const text = [
          `【剧情记忆（第 1-${maxFloor} 楼摘要；更早原文已折叠进本快照）】`,
          ...book.entries.map(e => `<memory_floor ${e.comment}>\n${e.content}\n</memory_floor>`),
        ].join('\n\n')
        if (retainedPlot.get(agent as object) !== text) {
          retainedPlot.set(agent as object, text)
          messages.push({
            id: `dsht-memory-plot-${randomUUID()}`,
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-memory:plot', text }] },
          })
          injected = true
        }
      }

      // 2) 上下文瘦身：surface 影子化（est tokens 超阈值才动手；results 下一轮请求生效）。
      //    freshSigs = 本轮 decision.messages 里新注入的快照签名——surface 上同签名副本
      //    全部视为陈旧（重启后 retained 清空全量重注时防双份）。
      let shadowNote = ''
      try {
        const freshSigs = new Set<string>()
        for (const m of messages) {
          const src = (m as { source?: { form?: unknown; plugin?: unknown; sections?: Array<{ name?: unknown }> } }).source
          if (src?.form === 'snapshot') {
            freshSigs.add(JSON.stringify([src.plugin ?? '', (Array.isArray(src.sections) ? src.sections : []).map(x => x?.name ?? '')]))
          }
        }
        shadowNote = await shadowSurface(session, sid, cfg, maxFloor, freshSigs, windowKeepSeq)
      } catch (e) {
        console.warn(`[dsht-memory] surface 影子化失败（不影响本 turn）：${(e as Error).message}`)
      }
      if (injected || shadowNote) {
        console.log(`[dsht-memory] pre-step${injected ? ` 注入剧情记忆 ${book.entries.length} 条（覆盖到第 ${maxFloor} 楼）${expandNote}` : ''}${expandNote && !injected ? expandNote : ''}${shadowNote}`)
      }
      return { ...decision, messages }
    } catch (e) {
      console.warn(`[dsht-memory] pre-step 失败（不影响本 turn）：${(e as Error).message}`)
      return decision
    }
  })

  // ---- 设置：真实 Schema（设置→插件「可配置」tab 渲染；失败不影响本体）----
  try {
    ctx.settings?.register?.(CONFIG_NS, CONFIG_SCHEMA, { base: { ...CONFIG_DEFAULTS } })
    console.log('[dsht-memory] settings namespace registered: dsht-plugin-memory')
  } catch (e) {
    console.warn(`[dsht-memory] settings namespace 注册失败（不影响本体）：${(e as Error).message}`)
  }
  const readEffectiveConfig = (): MemoryConfig => {
    try {
      return readConfig(ctx.settings?.get?.(CONFIG_NS))
    } catch {
      return { ...CONFIG_DEFAULTS }
    }
  }

  // ---- 进度（rp/memory-progress/<sid>.json；注意与 dsh-plugin 的 rp/memory/ 工具记忆互不相干）----
  // 楼层游标已切 turn 口径（事件流自算，见 tick）；rp/state 的 cursor（消息条数）
  // 仅作活动信号，不再作楼层号消费。
  const progressDir = join(dshHome, 'rp', 'memory-progress')

  // ---- surface 影子化执行（§2.2 上下文瘦身；planShadowOps 为纯函数可单测）----
  /** est tokens ≈ 字符 × 0.31（DeepSeek 中文口径粗估；触发判断用，宁早勿晚） */
  const TOKENS_PER_CHAR = 0.31
  /** 触发阈值：模型视图 est > 80k tokens 才做**历史前缀**折叠（上游 ~79k 实测稳、873k 必炸）。
   *  ⚠️ 该阈值**只管前缀折叠**（有信息损失，需摘要兜底，故从严）——
   *  快照去重（零信息损失的纯去重）另走 SHADOW_MIN_SNAPSHOT_DUP 判据，不受此阈值门控。 */
  const SHADOW_TRIGGER_TOKENS = 80_000
  /** 快照去重触发判据（2026-09-10 心跳 33 新增）：不设 tokens 门槛，改为
   *  「视图内存在同签名多副本」即折叠。
   *  理由（实测教训）：80k 阈值原按 500k 上下文模型标定；contextWindow 修正为 1M 后，
   *  中等会话（实测 57.5k est / 185k 字符）远低于阈值 → 影子化整体被短路 →
   *  13 条快照（160k 字符，占 payload 87%）持续堆叠重复副本。
   *  快照去重是纯增量收益（日志保留全部数据、模型视图仅去掉冗余副本），
   *  无需等体积压力，故与此阈值解耦。 */
  const SHADOW_MIN_SNAPSHOT_DUP = 2

  /** 核心估价器精确复刻（dsh-token-meter/estimate：4 字符/token + 块开销 4 + role 开销 4）——
   *  shadowedTokenCount 必须与核心同口径，否则 meter 总量漂移（shadow-price 协议契约）。 */
  const estimateCoreTokens = (content: unknown): number => {
    const blocks = (Array.isArray(content) ? content : []) as Array<Record<string, unknown>>
    let tokens = 0
    for (const block of blocks) {
      if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
        tokens += Math.ceil(block.text.length / 4) + 4
      } else {
        tokens += 4 + Math.ceil(JSON.stringify(block).length / 4)
      }
    }
    return tokens
  }

  /** 诊断探针（W32）：把 shadowSurface 的每个 early-return 点落盘，用于实机定位
   *  「阈值已达但零 op」的静默失败。写 rp/memory-progress/<sid>.probe.json。 */
  const shadowSurface = async (session: SessionRef, sid: string, cfg: MemoryConfig, maxFloor: number, freshSigs: ReadonlySet<string>, windowKeepSeq?: number | null): Promise<string> => {
    const surface = (session as { surface?: { nodes?: number[] } }).surface
    // 0.1.2 坑 #22：`session.events` 已移除——用 snapshotEvents() 快照 + eventAt(seq) 单读。
    // 旧代码直读 `.events` 得 undefined → nodes 恒空 → estTokens=0 → 影子化静默失效
    // （实测 120k tokens > 80k 阈值仍 0 个 replace / 0 个 compaction/prune）。
    const viewSeqs = surface?.nodes ?? []
    if (viewSeqs.length === 0) return ''
    // 只把消息事件建模为节点（tool/result 等不参与楼层/快照判定，但属于 replace 射程）
    const nodes: SurfaceNodeInfo[] = []
    for (const seq of viewSeqs) {
      const ev = sessionEventAt(session, seq)
      if (!ev || (ev.type !== 'user/message' && ev.type !== 'assistant/message')) continue
      const m = (ev.data ?? {}) as {
        role?: unknown
        content?: unknown
        source?: { form?: unknown; kind?: unknown; plugin?: unknown; oneshot?: unknown; windowRange?: unknown; sections?: Array<{ name?: unknown }> } | null
      }
      const blocks = (Array.isArray(m.content) ? m.content : []) as Array<{ type?: unknown; text?: unknown }>
      const chars = blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .reduce((s, b) => s + (b.text as string).length, 0)
      const src = m.source ?? {}
      const dm = (ev.data ?? {}) as { turn?: unknown; message?: { turn?: unknown } }
      const turn = typeof dm.turn === 'number' ? dm.turn : (typeof dm.message?.turn === 'number' ? dm.message.turn : null)
      nodes.push({
        seq,
        isFloor: m.role === 'assistant' || (m.role === 'user' && src.kind === 'user'),
        turn: m.role === 'assistant' ? turn : null,
        // 本插件自己的影子 marker 也归入"可折叠快照"——否则 marker 每轮新增一个、
        // 永远留在视图里（模型实测抱怨"很多重复的上下文折叠标记"）；归入后随连续段
        // 合并折叠，marker 数量有界（每个连续段一个）
        isSnapshot: src.form === 'snapshot' || (src.plugin === name && src.kind === 'plugin'),
        sig: JSON.stringify([src.plugin ?? '', (Array.isArray(src.sections) ? src.sections : []).map(x => x?.name ?? '')]),
        chars,
        oneshot: src.form === 'snapshot' && src.oneshot === true,
        windowCopy: src.form === 'snapshot' && src.windowRange !== undefined,
      })
    }
    const estTokens = Math.round(nodes.reduce((s, n) => s + n.chars, 0) * TOKENS_PER_CHAR)
    // 双判据（2026-09-10 心跳 33）：前缀折叠（有损）按体积阈值门控；
    // 快照去重（无损）只要存在同签名多副本即触发——不再被体积阈值整体短路。
    const overThreshold = estTokens > SHADOW_TRIGGER_TOKENS
    const dupSigs = (() => {
      const seen = new Map<string, number>()
      for (const n of nodes) if (n.isSnapshot) seen.set(n.sig, (seen.get(n.sig) ?? 0) + 1)
      let d = 0
      for (const v of seen.values()) if (v >= SHADOW_MIN_SNAPSHOT_DUP) d += 1
      return d
    })()
    const foldHistory = overThreshold
    if (!overThreshold && dupSigs === 0) return ''
    // 楼层总数（turn 口径：一轮用户输入/一轮 AI 回答 = 1 楼）——与记忆条目「记忆#N-M」
    // 同口径；不再消费 dsh-plugin 的消息条数游标（两套数字会错位）
    const cursor = extractFloorsFromEvents(sessionEventsSnapshot(session) as SessionEventLike[]).cursor
    const plan = planShadowOps(nodes, {
      keepNearFloors: cfg.keepNearFloors, charBudget: cfg.charBudget,
      memoryMaxFloor: maxFloor, foldFloors: cfg.foldOldFloors, cursor, freshSigs, windowKeepSeq,
      foldHistory,
    })
    if (plan.ops.length === 0) return ''
    console.log(`[dsht-memory] surface 影子化判定: est=${(estTokens / 1000).toFixed(1)}k tokens `
      + `(阈值 ${(SHADOW_TRIGGER_TOKENS / 1000).toFixed(0)}k, ${overThreshold ? '超' : '未超'}→前缀${foldHistory ? '折叠' : '保留'})，`
      + `重复快照签名 ${dupSigs} 组 → 去重${dupSigs > 0 ? '启用' : '无需'}`)
    for (const op of plan.ops) {
      // 射程内的**真实 surface seqs**（含 tool/result 等非消息节点——replace 覆盖整个区间）
      const inRange = viewSeqs.filter(seq => seq >= op.start && seq <= op.end)
      if (inRange.length === 0) continue
      // 影子价格：核心估价器逐节点求和（shadow-price 协议——replace 必须携带紧邻 claim，
      // 否则投影/meter 保持旧总量，assembly 看到的还是旧内容：turn 47 实测 514k tokens）
      const shadowedTokens = inRange.reduce((s, seq) => {
        const m = (sessionEventAt(session, seq)?.data ?? {}) as { content?: unknown }
        return s + estimateCoreTokens(m.content) + 4
      }, 0)
      // 1) 紧邻计量事件（武装 claim——toolResultPruner 同款形态）
      session.append('compaction/prune', {
        shadowedRange: { start: op.start, end: op.end },
        shadowedSeqs: inRange,
        shadowedTokenCount: shadowedTokens,
      })
      // 2) replace 原语：marker 消息顶替整个区间（日志保留全部数据，聊天记录零丢失）。
      //    history marker 的 source.folded 携带结构化折叠边界（/status 与窗口核对消费）
      const markerText = op.kind === 'history'
        ? `[上下文瘦身] 第 1-${plan.flooredUpTo} 楼原文已折叠，剧情要点见「剧情记忆」快照；以下为最近原文。`
        : '[旧快照副本已折叠]'
      // 【阶段3 2026-09-10】surfaceOp 字段名走 appendReplace 自适应（0.1.5 = startSeq/endSeq，
      // 旧 start/end 直接抛 invalid replace surfaceOp → 影子化全数失败）；
      // source.folded 顶层自定义键也搬进官方白名单位 sections（否则整会话迁移打不开）。
      appendReplace(session as unknown as AppendableSession, 'user/message', {
        id: `dsht-memory-shadow-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: markerText }],
        source: op.kind === 'history'
          ? markerSource(name, 'memory', { folded: { from: 1, to: plan.flooredUpTo } })
          : { kind: 'plugin', plugin: name },
      }, { start: op.start, end: op.end }, inRange)
    }
    console.log(`[dsht-memory] surface shadow: est=${(estTokens / 1000).toFixed(0)}k tokens, ops=${plan.ops.length}（history=${plan.ops.filter(o => o.kind === 'history').length} snapshot=${plan.ops.filter(o => o.kind === 'snapshot').length}），视图 ${(plan.charsBefore / 10000).toFixed(1)}万→${(plan.charsAfter / 10000).toFixed(1)}万字符，折叠至第 ${plan.flooredUpTo} 楼`)
    // 折叠边界持久化（独立 fold 文件——与 lastFloor 分文件写，避免进度读改写竞态）；
    // 旧会话回退：surface marker 文本解析（foldedUpToOf）
    if (plan.flooredUpTo > 0) await saveFoldState(sid, plan.flooredUpTo)
    return `；surface 影子化 ${plan.ops.length} op（视图 ${(plan.charsBefore / 10000).toFixed(1)}万→${(plan.charsAfter / 10000).toFixed(1)}万字符，折叠至第 ${plan.flooredUpTo} 楼）`
  }

  const loadProgress = async (sid: string): Promise<{ lastFloor: number }> => {
    try {
      const parsed = JSON.parse(await readFile(join(progressDir, `${sid}.json`), 'utf8')) as ProgressFile
      const lastFloor = typeof parsed?.lastFloor === 'number' && parsed.lastFloor >= 0 ? Math.floor(parsed.lastFloor) : 0
      return { lastFloor }
    } catch {
      return { lastFloor: 0 }
    }
  }
  const saveProgress = async (sid: string, lastFloor: number): Promise<void> => {
    await mkdir(progressDir, { recursive: true })
    await writeFile(join(progressDir, `${sid}.json`), JSON.stringify({ lastFloor, updatedAt: new Date().toISOString() }, null, 1), 'utf8')
  }

  // ---- 折叠边界（rp/memory-progress/<sid>.fold.json；与 lastFloor 分文件防读改写竞态）----
  const loadFoldState = async (sid: string): Promise<number> => {
    try {
      const parsed = JSON.parse(await readFile(join(progressDir, `${sid}.fold.json`), 'utf8')) as { flooredUpTo?: unknown }
      return typeof parsed?.flooredUpTo === 'number' && parsed.flooredUpTo >= 0 ? Math.floor(parsed.flooredUpTo) : 0
    } catch {
      return 0
    }
  }
  const saveFoldState = async (sid: string, flooredUpTo: number): Promise<void> => {
    await mkdir(progressDir, { recursive: true })
    await writeFile(join(progressDir, `${sid}.fold.json`), JSON.stringify({ flooredUpTo, updatedAt: new Date().toISOString() }, null, 1), 'utf8')
  }

  /** 折叠边界解析：fold 文件 → 活会话 surface marker → session.jsonl marker（自愈并回写 fold 文件）。
   *  surface 扫描不可靠：history marker 与「旧快照副本已折叠」marker 同签名（[name,[]]），
   *  签名去重后幸存的可能是无楼层区间的那个——故必须有日志扫描兜底。 */
  const foldedUpToOf = async (sid: string, session?: SessionRef): Promise<number> => {
    const persisted = await loadFoldState(sid)
    if (persisted > 0) return persisted
    if (session !== undefined) {
      const surface = (session as { surface?: { nodes?: number[] } }).surface
      let max = 0
      for (const seq of surface?.nodes ?? []) {
        const ev = sessionEventAt(session, seq)
        if (ev?.type !== 'user/message') continue
        const d = ev.data as { source?: { plugin?: unknown; kind?: unknown } | null; content?: Array<{ type?: unknown; text?: unknown }> } | undefined
        if (d?.source?.plugin !== name || d.source.kind !== 'plugin') continue
        for (const b of Array.isArray(d.content) ? d.content : []) {
          if (b?.type === 'text' && typeof b.text === 'string') max = Math.max(max, parseFoldedFromMarker(b.text))
        }
      }
      if (max > 0) {
        void saveFoldState(sid, max).catch(() => { /* 自愈回写失败不阻塞 */ })
        return max
      }
    }
    const fromLog = await scanFoldedFromLog(sid)
    if (fromLog > 0) void saveFoldState(sid, fromLog).catch(() => { /* 自愈回写失败不阻塞 */ })
    return fromLog
  }

  /** 活会话 surface 上的窗口注回副本（[{seq, range}]，seq 升序） */
  const scanWindowCopies = (session: SessionRef): Array<{ seq: number; range: { from: number; to: number; capped?: boolean; budget?: number } }> => {
    const out: Array<{ seq: number; range: { from: number; to: number; capped?: boolean; budget?: number } }> = []
    const surface = (session as { surface?: { nodes?: number[] } }).surface
    for (const seq of surface?.nodes ?? []) {
      const ev = sessionEventAt(session, seq)
      if (ev?.type !== 'user/message') continue
      const src = (ev.data as { source?: { plugin?: unknown; form?: unknown; windowRange?: { from?: unknown; to?: unknown; capped?: unknown; budget?: unknown } } | null } | undefined)?.source
      if (src?.plugin !== name || src.form !== 'snapshot' || src.windowRange === undefined) continue
      const wr = src.windowRange
      if (typeof wr.from !== 'number' || typeof wr.to !== 'number') continue
      out.push({
        seq,
        range: {
          from: wr.from, to: wr.to,
          ...(wr.capped === true ? { capped: true } : {}),
          ...(typeof wr.budget === 'number' ? { budget: wr.budget } : {}),
        },
      })
    }
    return out
  }

  // ---- 会话头扫描缓存（60s；sid → project/sdir/cwd）----
  let headerCache: { at: number; hits: SessionHeaderHit[] } = { at: 0, hits: [] }
  const refreshHeaders = async (): Promise<SessionHeaderHit[]> => {
    if (Date.now() - headerCache.at > 60_000) {
      headerCache = { at: Date.now(), hits: await scanSessionHeaders(dshHome) }
    }
    return headerCache.hits
  }

  /** session.jsonl 内历史折叠 marker 扫描（fold 文件缺席的旧会话自愈来源） */
  const scanFoldedFromLog = async (sid: string): Promise<number> => {
    const header = (await refreshHeaders()).find(h => h.sessionId === sid)
    if (!header) return 0
    try {
      const content = await readFile(header.file, 'utf8')
      let max = 0
      for (const m of content.matchAll(/第 1-(\d+) 楼原文已折叠/g)) max = Math.max(max, Number(m[1]))
      return max
    } catch {
      return 0
    }
  }

  /** 折叠边界（路由侧，无活会话面）：fold 文件 → session.jsonl 内 marker 文本回退 */
  const foldedUpToRoute = async (sid: string): Promise<number> => {
    const persisted = await loadFoldState(sid)
    if (persisted > 0) return persisted
    return scanFoldedFromLog(sid)
  }

  /** cwd → 工作区 slug（rp/<slug> 且 rp.json 存在才认；欢迎工作区 _start 排除） */
  const slugFromCwd = async (cwd: string | undefined): Promise<string | null> => {
    if (!cwd) return null
    const m = /(^|[\\/])rp[\\/]([^\\/]+)$/.exec(cwd.replace(/[\\/]+$/, ''))
    const slug = m?.[2] ?? null
    if (!slug || slug === '_start') return null
    try {
      await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')
      return slug
    } catch {
      return null
    }
  }

  // ---- 记忆本（skills/wb-memory-<slug>/references/lore.json；{name, entries, importWarnings}）----
  const memoryLorePath = (slug: string): string => `skills/wb-memory-${slug}/references/lore.json`
  const loadMemoryBook = async (slug: string): Promise<{ name: string; entries: LoreEntry[]; importWarnings: string[] }> => {
    try {
      const parsed = JSON.parse(await readFile(join(dshHome, memoryLorePath(slug)), 'utf8')) as {
        name?: unknown
        entries?: unknown
        importWarnings?: unknown
      }
      return {
        name: typeof parsed?.name === 'string' && parsed.name ? parsed.name : memoryBookName,
        entries: Array.isArray(parsed?.entries) ? parsed.entries as LoreEntry[] : [],
        importWarnings: Array.isArray(parsed?.importWarnings) ? parsed.importWarnings as string[] : [],
      }
    } catch {
      return { name: memoryBookName, entries: [], importWarnings: [] }
    }
  }
  const saveMemoryBook = async (slug: string, book: { name: string; entries: LoreEntry[]; importWarnings: string[] }): Promise<void> => {
    const abs = join(dshHome, memoryLorePath(slug))
    await mkdir(dirname(abs), { recursive: true })
    // 【2026-09-08 鲁棒性】原子写：记忆本与 dsh-plugin 世界书 entry-put 写合并队列
    // 并发写同一 lore.json 时裸写撕裂（「新文档+旧文档尾部」恒 parse 失败——项目实锤
    // 教训同款； TH 桥 target 本书或 reset 重导并发时同样成立）。
    await atomicWriteText(abs, JSON.stringify({ name: book.name, entries: book.entries, importWarnings: book.importWarnings }, null, 1))
  }

  // 记忆本**不登记**进工作区 rp.json.books：注入走上面的自有 pre-step 快照（与
  // 世界书触发预算解耦）；登记反而会让条目进触发预算被 budgetCap 挤掉/重复注入。
  // 文件本体仍是标准世界书（skills/wb-memory-*/references/lore.json），世界书清单/TH
  // getWorldbooks 可见，用户可手查手改。

  /** 读会话事件流（当前世代日志全量解析；坏行跳过）。header.file 由 scanSessionHeaders 解析当前世代 */
  const readSessionEvents = async (header: SessionHeaderHit): Promise<SessionEventLike[]> => {
    const sessionPath = header.file
    const content = await readFile(sessionPath, 'utf8')
    const events: SessionEventLike[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try { events.push(JSON.parse(line) as SessionEventLike) } catch { /* 坏行跳过 */ }
    }
    return events
  }

  // ---- 楼层缓存（性能，2026-09-04）：大会话（数 MB / 上万事件）每次 cursor 变化
  // 全量 JSON.parse 是手机 CPU 大户（20s 轮询节奏）。turn 楼层计数必须从头分组，
  // 无法增量——但 session.jsonl 是 append-only：size+mtime 未变 ⇒ 楼层不变 ⇒ 直接
  // 用缓存。命中时每次 tick 只花一次 stat（微秒级），变化时才全量解析并刷新。----
  const floorStatCache = new Map<string, { size: number; mtimeMs: number; cursor: number }>()
  const floorCountOf = async (header: SessionHeaderHit, sessionPath: string): Promise<number> => {
    let st: { size: number; mtimeMs: number }
    try { st = await stat(sessionPath).then(s => ({ size: s.size, mtimeMs: s.mtimeMs })) } catch { return 0 }
    const cached = floorStatCache.get(sessionPath)
    if (cached !== undefined && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.cursor
    const cursor = extractFloorsFromEvents(await readSessionEvents(header)).cursor
    floorStatCache.set(sessionPath, { ...st, cursor })
    return cursor
  }

  /** 单会话总结：提取楼层原文 → LLM → 追加记忆条目（返回摘要字数） */
  const summarizeSession = async (sid: string, slug: string, header: SessionHeaderHit, from: number, to: number, isStale?: () => boolean): Promise<number> => {
    const sel = ctx.agentDefaultModel?.currentSelection?.()
    if (!sel?.provider || !sel?.model) throw new Error('no default model configured（先在导入中心/API 设置配置模型）')
    if (!ctx.llm) throw new Error('llm service unavailable')
    const { floors } = extractFloorsFromEvents(await readSessionEvents(header))
    const range = floors.filter(f => f.floor >= from && f.floor <= to)
    if (range.length === 0) return 0
    const prompt = buildSummarizePrompt(from, to, range, readEffectiveConfig().summaryMaxChars)
    let text = ''
    for await (const chunk of ctx.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    }
    if (!text.trim()) throw new Error('empty summary（模型返回空）')
    // 【鲁棒轮 2026-09-09】reset 竞态守卫：LLM 秒级流式窗口内 /reset 清空记忆本后，
    // 本函数的 load→push→save 会把重置前区间的条目复活（tick 再把 lastFloor 覆写为
    // chunk.to）。stale 回调由调用方提供（捕获 reset 代数），save 前两次校验。
    if (isStale?.() === true) {
      console.log(`[dsht-memory] 总结完成但会话已被 reset（${sid} #${from}-${to}），丢弃结果`)
      return -1
    }
    const book = await loadMemoryBook(slug)
    if (isStale?.() === true) {
      console.log(`[dsht-memory] 总结落盘前发现 reset（${sid}），丢弃结果`)
      return -1
    }
    book.entries.push(buildMemoryEntry(memoryBookName, from, to, text))
    await saveMemoryBook(slug, book)
    console.log(`[dsht-memory] summarized ${sid} (#${from}-${to}) → ${text.length}ch（记忆本 ${book.entries.length} 条，工作区 ${slug}）`)
    return text.length
  }

  // ---- 轮询（20s；单飞；每 tick 最多消化 3 个总结块——防导入大批历史后一次跑飞）----
  // 楼层进度游标 = turn 口径楼层总数（extractFloorsFromEvents(events).cursor，与 UI
  // 楼层/记忆锚一致）。rp/state 的 cursor（dsh-plugin 消息条数游标）只作**变化信号**：
  // 未变化 → 跳过（免 20s 全量重读大楼层文件）；变化 → 读事件流重算 turn 楼层。
  // 【鲁棒轮 2026-09-09】per-sid reset 代数——/reset 递增；tick 的总结链路捕获代数，
  // LLM 窗口内被 reset 则丢弃结果（防止旧区间条目复活 + lastFloor 被覆写）。
  const resetGens = new Map<string, number>()

  let busy = false
  const lastSeenCursor = new Map<string, number>()
  // 【鲁棒轮 2026-09-09】per-sid 失败退避：同 chunk 连续失败无上限 = 内容过滤/断网期
  // 每 20s 重烧一次 LLM（每次 60k 字符楼层原文）。退避阶梯 20s→2min→10min 封顶，
  // 成功或游标变化（新 chunk）即复位。
  const failStreak = new Map<string, number>()
  const lastFailAt = new Map<string, number>()
  const FAIL_BACKOFF_MS = [0, 120_000, 600_000, 600_000] as const
  const tick = async (forceSids: string[] | null): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const cfg = readEffectiveConfig()
      if (!cfg.enabled) return
      let states: string[] = []
      try { states = (await readdir(join(dshHome, 'rp', 'state'))).filter(f => f.endsWith('.json') && f !== 'global.json') } catch { return }
      if (states.length === 0) return
      const headers = await refreshHeaders()
      const byId = new Map(headers.map(h => [h.sessionId, h]))
      let budget = 3
      for (const file of states) {
        const sid = file.replace(/\.json$/, '')
        const st = JSON.parse(await readFile(join(dshHome, 'rp', 'state', file), 'utf8').catch(() => '{}')) as { cursor?: unknown }
        const cursor = typeof st.cursor === 'number' && st.cursor >= 0 ? Math.floor(st.cursor) : 0
        if (cursor <= 0) continue
        const header = byId.get(sid)
        if (!header) continue
        const slug = await slugFromCwd(header.cwd)
        if (!slug) continue
        // 活动信号：游标未变 → 楼层无新增（回退也必变游标），跳过重算
        if (!Array.isArray(forceSids) && lastSeenCursor.get(sid) === cursor) continue
        lastSeenCursor.set(sid, cursor)
        const prog = await loadProgress(sid)
        // turn 口径楼层总数（stat 缓存短路：文件未变直接用缓存，变化才全量解析）
        let floorCount = 0
        try { floorCount = await floorCountOf(header, header.file) } catch { continue }
        // 回退：楼层总数落到 lastFloor 之前 → 裁记忆本 + 进度回退（不总结）
        if (floorCount < prog.lastFloor) {
          const book = await loadMemoryBook(slug)
          const rb = rollbackMemoryBook(book.entries, floorCount)
          if (rb.dropped > 0) {
            await saveMemoryBook(slug, { ...book, entries: rb.entries })
            console.log(`[dsht-memory] 回退裁剪：${sid} 丢弃 ${rb.dropped} 条记忆，lastFloor=${rb.lastFloor}`)
          }
          if (rb.lastFloor !== prog.lastFloor) await saveProgress(sid, rb.lastFloor)
          continue
        }
        const force = Array.isArray(forceSids) && forceSids.includes(sid)
        const chunk = force
          ? (floorCount > prog.lastFloor ? { from: prog.lastFloor + 1, to: Math.min(floorCount, prog.lastFloor + cfg.everyN) } : null)
          : nextChunk(prog.lastFloor, floorCount, cfg.everyN)
        if (!chunk) continue
        // 退避门禁：退避窗口内跳过本 tick（不推进游标，窗口过后自动重试）
        const streak = failStreak.get(sid) ?? 0
        const lastFail = lastFailAt.get(sid) ?? 0
        const backoff = FAIL_BACKOFF_MS[Math.min(streak, FAIL_BACKOFF_MS.length - 1)] ?? 0
        if (!force && backoff > 0 && Date.now() - lastFail < backoff) continue
        try {
          // 【鲁棒轮 2026-09-09】reset 代数守卫：LLM 窗口内 /reset → 丢弃结果不 saveProgress
          const genAtStart = resetGens.get(sid) ?? 0
          const chars = await summarizeSession(sid, slug, header, chunk.from, chunk.to, () => (resetGens.get(sid) ?? 0) !== genAtStart)
          if (chars > 0) {
            failStreak.delete(sid)
            lastFailAt.delete(sid)
            if ((resetGens.get(sid) ?? 0) !== genAtStart) continue // reset 竞态：进度不推进
            await saveProgress(sid, chunk.to)
            budget--
          }
        } catch (e) {
          // 失败不推进游标——按退避阶梯延迟重试；不阻塞主 turn（总结在插件侧异步跑）
          failStreak.set(sid, streak + 1)
          lastFailAt.set(sid, Date.now())
          console.warn(`[dsht-memory] 总结失败（${sid} #${chunk.from}-${chunk.to}，连续第 ${streak + 1} 次，退避 ${Math.round(backoff / 1000)}s）：${(e as Error).message}`)
        }
        if (budget <= 0) return
      }
    } catch (e) {
      console.warn(`[dsht-memory] tick 失败（下轮重试）：${(e as Error).message}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void tick(null) }, 20_000)
  try {
    ctx.effect?.(() => () => clearInterval(timer), 'dsht-plugin-memory poll')
  } catch { /* effect 缺席则常驻 interval（进程生命周期一致） */ }

  // ---- 数据面（/dsht-memory/*；health 探活 + 设置 + 状态 + 手动触发/重置）----
  registerPrefix(ctx, '/dsht-memory', 'dsht-memory', async (sub, req, res) => {
    const method = req.method ?? 'GET'
    if (sub === '/health') return sendJson(res, 200, { ok: true, name, config: readEffectiveConfig() })

    if (sub === '/settings') {
      if (method === 'GET') return sendJson(res, 200, { config: readEffectiveConfig() })
      if (method === 'POST') {
        const body = await readJsonBody(req)
        if (!body) return sendJson(res, 400, { error: 'bad json' })
        // 接受中文键（与设置界面的 Schema 键一致）；英文键兼容映射
        const patch: Record<string, unknown> = {}
        const src = body as Record<string, unknown>
        const enabled = typeof src['总开关'] === 'boolean' ? src['总开关'] : (typeof src.enabled === 'boolean' ? src.enabled : undefined)
        const everyN = typeof src['每N楼总结'] === 'number' ? src['每N楼总结'] : (typeof src.everyN === 'number' ? src.everyN : undefined)
        const keep = typeof src['保留近M楼原文'] === 'number' ? src['保留近M楼原文'] : (typeof src.keepNearFloors === 'number' ? src.keepNearFloors : undefined)
        const budget = typeof src['近窗字符预算'] === 'number' ? src['近窗字符预算'] : (typeof src.charBudget === 'number' ? src.charBudget : undefined)
        const fold = typeof src['折叠老楼层'] === 'boolean' ? src['折叠老楼层'] : (typeof src.foldOldFloors === 'boolean' ? src.foldOldFloors : undefined)
        const summaryCap = typeof src['摘要字数上限'] === 'number' ? src['摘要字数上限'] : (typeof src.summaryMaxChars === 'number' ? src.summaryMaxChars : undefined)
        if (typeof enabled === 'boolean') patch['总开关'] = enabled
        if (typeof everyN === 'number' && everyN >= 5) patch['每N楼总结'] = Math.floor(everyN)
        if (typeof keep === 'number' && keep >= 0) patch['保留近M楼原文'] = Math.floor(keep)
        if (typeof budget === 'number' && budget >= 5000) patch['近窗字符预算'] = Math.floor(budget)
        if (typeof fold === 'boolean') patch['折叠老楼层'] = fold
        if (typeof summaryCap === 'number' && summaryCap >= 100) patch['摘要字数上限'] = Math.floor(summaryCap)
        if (Object.keys(patch).length === 0) return sendJson(res, 400, { error: 'no valid fields（总开关/每N楼总结>=5/保留近M楼原文>=0/近窗字符预算>=5000/折叠老楼层/摘要字数上限>=100）' })
        if (!ctx.settings || typeof ctx.settings.update !== 'function') return sendJson(res, 503, { error: 'settings service unavailable' })
        await ctx.settings.update(CONFIG_NS, patch)
        console.log(`[dsht-memory] settings updated: ${JSON.stringify(patch)}`)
        return sendJson(res, 200, { ok: true, config: readEffectiveConfig() })
      }
      return sendJson(res, 405, { error: 'GET/POST only' })
    }

    if (sub === '/status') {
      const sid = String(queryOf(req.url).get('sessionId') ?? '')
      if (!sid) return sendJson(res, 400, { error: 'sessionId required' })
      const cfg = readEffectiveConfig()
      const prog = await loadProgress(sid)
      const header = (await refreshHeaders()).find(h => h.sessionId === sid)
      const slug = header ? await slugFromCwd(header.cwd) : null
      const book = slug ? await loadMemoryBook(slug) : null
      // floors = turn 口径楼层总数（与 UI 楼层/记忆锚一致）；cursor = dsh-plugin
      // 消息条数游标（仅诊断参考，不作楼层消费）
      const st = JSON.parse(await readFile(join(dshHome, 'rp', 'state', `${sid}.json`), 'utf8').catch(() => '{}')) as { cursor?: unknown }
      const cursor = typeof st.cursor === 'number' ? st.cursor : 0
      let floors = 0
      if (header) { try { floors = await floorCountOf(header, header.file) } catch { /* 读失败按 0 */ } }
      return sendJson(res, 200, {
        sessionId: sid,
        floors,
        cursor,
        lastFloor: prog.lastFloor,
        foldedUpTo: await foldedUpToRoute(sid),
        nextAt: prog.lastFloor + cfg.everyN,
        enabled: cfg.enabled,
        everyN: cfg.everyN,
        keepNearFloors: cfg.keepNearFloors,
        charBudget: cfg.charBudget,
        foldOldFloors: cfg.foldOldFloors,
        slug,
        lorePath: slug ? memoryLorePath(slug) : null,
        entries: book ? book.entries.length : 0,
      })
    }

    // ---- §2.3 ⑤：「展开给 AI」——落单次展开待办（下一轮 pre-step 消费注入）----
    if (sub === '/expand') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJsonBody(req).catch(() => ({})) as { sessionId?: unknown; from?: unknown; to?: unknown }
      const sid = String(body?.sessionId ?? '')
      if (!sid) return sendJson(res, 400, { error: 'sessionId required' })
      const folded = await foldedUpToRoute(sid)
      if (folded <= 0) return sendJson(res, 400, { error: 'no folded range（该会话暂无折叠区间）' })
      const clamp = (v: unknown, def: number, min: number, max: number): number => {
        const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def
        return Math.min(max, Math.max(min, n))
      }
      const from = clamp(body.from, 1, 1, folded)
      const to = clamp(body.to, folded, 1, folded)
      if (from > to) return sendJson(res, 400, { error: `bad range（折叠区间 = 1-${folded}）` })
      const dir = join(dshHome, 'rp', 'memory-expand')
      await mkdir(dir, { recursive: true })
      const pendingPath = join(dir, `${sid}.json`)
      const prev = JSON.parse(await readFile(pendingPath, 'utf8').catch(() => 'null')) as { requests?: unknown[] } | null
      const requests = Array.isArray(prev?.requests) ? prev.requests.slice(-9) : []
      requests.push({ from, to, ts: new Date().toISOString() })
      await writeFile(pendingPath, JSON.stringify({ requests }, null, 1), 'utf8')
      console.log(`[dsht-memory] expand pending: ${sid} #${from}-${to}（下一轮注入，单次生效）`)
      return sendJson(res, 200, { ok: true, from, to, note: '下一轮请求注入；再下一轮自动收回' })
    }

    if (sub === '/summarize') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJsonBody(req).catch(() => ({})) as { sessionId?: unknown }
      const force = typeof body?.sessionId === 'string' && body.sessionId ? [body.sessionId] : null
      void tick(force) // 异步跑；总结结果经 console + 记忆本文件观察
      return sendJson(res, 200, { ok: true, note: 'summarize kicked（异步；失败不推进游标）' })
    }

    if (sub === '/reset') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJsonBody(req)
      const sid = String(body?.sessionId ?? '')
      if (!sid) return sendJson(res, 400, { error: 'sessionId required' })
      const header = (await refreshHeaders()).find(h => h.sessionId === sid)
      const slug = header ? await slugFromCwd(header.cwd) : null
      // 【鲁棒轮 2026-09-09】先递增代数再清数据——进行中的总结在 save 前会发现代数
      // 变化而丢弃（LLM 窗口竞态守卫，见 tick / summarizeSession）
      resetGens.set(sid, (resetGens.get(sid) ?? 0) + 1)
      let dropped = 0
      if (slug) {
        const book = await loadMemoryBook(slug)
        dropped = book.entries.length
        await saveMemoryBook(slug, { ...book, entries: [] })
      }
      await saveProgress(sid, 0)
      console.log(`[dsht-memory] reset: ${sid}（清空 ${dropped} 条记忆 + 进度归零）`)
      return sendJson(res, 200, { ok: true, dropped })
    }

    // ---- E6：表格读取（UI RpTablesView 只读渲染）。数据源 = rp/state/<sid>.json 的
    // sheets 键；首次读取发现 ST 1.0 旧键 tableData/tables 时由 loadSheets 一次性迁移写回 ----
    if (sub === '/tables') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
      const sid = String(queryOf(req.url).get('sessionId') ?? '')
      if (!isValidTablesSessionId(sid)) return sendJson(res, 400, { error: 'sessionId required' })
      const { sheets } = await loadSheets(dshHome, sid)
      return sendJson(res, 200, { sheets })
    }

    // ---- E4：分步填表（基础版）——POST {sessionId, reply}。回复已含 <tableEdit> 块时
    // 直接解析执行（零 LLM）；否则用默认模型补产出 tableEdit 块（与 dsh-plugin 的
    // /rp/mvu/extra-analyze 同一 llm 通道语义：agentDefaultModel 当前选择 + ctx.llm.stream）
    // 并执行落盘（历史栈入栈）。路由挂本插件：/dsht-memory 前缀属主是本插件，host
    // webserver 前缀路由 longest-prefix-wins + Map 覆盖，dsh-plugin 重复注册同一前缀会
    // 顶掉本插件全部路由——llm 服务本插件 inject 已含，无需跨插件放路由。 ----
    if (sub === '/tables/step-summary') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJsonBody(req).catch(() => ({})) as { sessionId?: unknown; reply?: unknown }
      const sid = String(body?.sessionId ?? '')
      if (!isValidTablesSessionId(sid)) return sendJson(res, 400, { error: 'sessionId required' })
      const replyText = typeof body?.reply === 'string' ? body.reply : ''
      if (!replyText.trim()) return sendJson(res, 400, { error: 'reply required' })
      const loaded = await loadSheets(dshHome, sid)
      const active = loaded.sheets.filter(s => s.enabled)
      if (active.length === 0) return sendJson(res, 200, { ok: false, applied: 0, skipped: 0, note: 'no sheets（会话尚无表格）' })
      let parsed: { edits: TableEdit[]; skipped: number }
      if (replyText.includes('<tableEdit')) {
        parsed = parseTableEdits(replyText) // 回复自带更新指令：直接执行
      } else {
        // 无更新指令 → llm 通道补产出（prompt 只要求输出 tableEdit 块）
        const sel = ctx.agentDefaultModel?.currentSelection?.()
        if (!sel?.provider || !sel?.model) return sendJson(res, 503, { error: 'no default model configured（先在 API 设置配置模型）' })
        if (!ctx.llm) return sendJson(res, 503, { error: 'llm service unavailable' })
        const system = '你是剧情表格编辑指令生成器。根据角色回复与当前表格，判断是否需要增删改表格条目。只输出一个 <tableEdit> 块，块内每行一条指令，格式：表名; 操作; 参数…（操作：insertRow/updateRow/deleteRow/insertCol/deleteCol/setName，行号列号从 1 开始，表头不算行号）；无需任何更新时输出空块 <tableEdit></tableEdit>；不要输出任何其他文字。'
        const prompt = `【当前表格】\n${renderTableData(active)}\n\n【角色回复】\n${replyText.slice(0, 8000)}\n\n请输出 <tableEdit> 块（无需更新则输出空块）。`
        let text = ''
        for await (const chunk of ctx.llm.stream({
          provider: sel.provider,
          model: sel.model,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        })) {
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        }
        parsed = parseTableEdits(text)
      }
      if (parsed.edits.length === 0) {
        return sendJson(res, 200, { ok: false, applied: 0, skipped: parsed.skipped, note: 'no tableEdit instructions（无更新）' })
      }
      const r = executeTableEdits(loaded.sheets, parsed.edits)
      if (r.applied > 0) {
        loaded.whole.sheetHistory = pushSheetHistory(loaded.history, loaded.sheets) // 写前快照入栈
        loaded.whole.sheets = r.sheets
        await saveSheets(dshHome, sid, loaded.whole)
      }
      console.log(`[dsht-memory] tables step-summary: ${sid} applied=${r.applied} skipped=${parsed.skipped + r.skipped}`)
      return sendJson(res, 200, { ok: true, applied: r.applied, skipped: parsed.skipped + r.skipped })
    }

    // ---- E5：重整理（基础版）——POST {sessionId}：llm 通道把全部表内容重写为紧凑一致
    // 版本（合并重复行/删过时条目/修矛盾），按表名匹配回写（uid/enabled 保留）。
    // llm 失败/返回不可解析 → 抛错由 registerPrefix 兜底 500 如实报告。 ----
    if (sub === '/tables/rebuild') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJsonBody(req).catch(() => ({})) as { sessionId?: unknown }
      const sid = String(body?.sessionId ?? '')
      if (!isValidTablesSessionId(sid)) return sendJson(res, 400, { error: 'sessionId required' })
      const loaded = await loadSheets(dshHome, sid)
      if (loaded.sheets.filter(s => s.enabled).length === 0) return sendJson(res, 200, { ok: false, note: 'no sheets（会话尚无表格）' })
      const sel = ctx.agentDefaultModel?.currentSelection?.()
      if (!sel?.provider || !sel?.model) return sendJson(res, 503, { error: 'no default model configured（先在 API 设置配置模型）' })
      if (!ctx.llm) return sendJson(res, 503, { error: 'llm service unavailable' })
      const system = '你是表格数据整理器。把给出的全部表格重写为紧凑、一致、无冗余的版本：合并重复行、删除过时条目、修正相互矛盾的内容、保留全部仍然有效的事实与列结构。只输出一个 JSON 数组，每个元素形如 {"name":"表名","headers":["列1","列2"],"rows":[["值1","值2"]]}；不要输出任何其他文字或代码围栏。'
      const prompt = `【当前表格】\n${renderTableData(loaded.sheets)}\n\n请输出重整后的 JSON 数组。`
      let text = ''
      for await (const chunk of ctx.llm.stream({
        provider: sel.provider,
        model: sel.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      })) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      }
      // 容错提取 JSON 数组（剥围栏/前后杂讯：取首 [ 到末 ]）
      const start = text.indexOf('[')
      const end = text.lastIndexOf(']')
      if (start < 0 || end <= start) throw new Error(`rebuild: 模型未返回 JSON 数组（前 200 字：${text.slice(0, 200)}）`)
      const arr = JSON.parse(text.slice(start, end + 1)) as unknown
      if (!Array.isArray(arr)) throw new Error('rebuild: 模型返回非数组')
      const byName = new Map<string, Record<string, unknown>>()
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        if (typeof rec.name === 'string' && rec.name.trim()) byName.set(rec.name.trim(), rec)
      }
      let replaced = 0
      const rebuilt = loaded.sheets.map(s => {
        const nx = byName.get(s.name) ?? byName.get(s.name.trim())
        if (!nx) return s // 模型漏掉的表原样保留（重整理不删表）
        const headers = Array.isArray(nx.headers) ? nx.headers.map(h => String(h ?? '')) : s.headers
        const rows = Array.isArray(nx.rows)
          ? nx.rows.filter(row => Array.isArray(row)).map(row => (row as unknown[]).map(c => String(c ?? '')))
          : s.rows
        replaced++
        return { ...s, headers, rows } // uid/enabled 保留
      })
      if (replaced === 0) throw new Error('rebuild: 模型返回的表名均未匹配现有表')
      loaded.whole.sheetHistory = pushSheetHistory(loaded.history, loaded.sheets) // 写前快照入栈
      loaded.whole.sheets = rebuilt
      await saveSheets(dshHome, sid, loaded.whole)
      console.log(`[dsht-memory] tables rebuild: ${sid} replaced=${replaced}/${loaded.sheets.length}（模型 ${sel.model}）`)
      return sendJson(res, 200, { ok: true, replaced, sheets: rebuilt })
    }

    return sendJson(res, 404, { error: 'unknown endpoint' })
  })
}
