/**
 * session-write.ts — DSH 会话写入的「合法形态」共享层
 * ============================================================
 * 为什么需要这一层（2026-09-10 阶段 3 实证，80 个真实会话跑官方 v0→v3 迁移链）：
 *
 *   41 / 80 会话无法迁移打开。根因**全部**是我方写入的事件不合官方 released-v0 契约。
 *   更深一层：0.1.5 引入了两处**破坏性契约收紧**，正命中我方核心写入路径。
 *
 * ## 收紧 1 —— surfaceOp 字段名 start/end → startSeq/endSeq
 *   0.1.2（dsh-session/lib/types/surface.js:117 `isReplaceOp`）要求 exactly {op,start,end}
 *   0.1.5（同文件:165）要求 exactly {op,startSeq,endSeq}
 *   我方全部 replace 写入用 start/end → 0.1.5 上**每一次回退/编辑/变体切换都会抛**
 *   `carries an invalid replace surfaceOp`。
 *
 * ## 收紧 2 —— assistant/message 禁止做表面替换节点
 *   0.1.5 `assertProvenance`（surface.js:205）：
 *     `assistant/message embeds its source stream and cannot carry sourceEventSeqs`
 *   而同函数同时要求「replace 必须列全被遮蔽节点」，于是 assistant 做 replace 时
 *   **带 ses 报错、不带也报错**（missing N）——官方设计死锁，不是可绕过的校验顺序。
 *   0.1.2 无此限制（0.1.2 surface.js:161 明确写 `except on assistant/message`）。
 *   官方同时要求 assistant/message 必须落在打开的 step 内（invariant.js:56），
 *   所以「改写一条已关闭 turn 里的历史助手回复」在原语层面本就不可表达。
 *
 * ## 官方能力边界（已全库核实）
 *   · 官方**没有**「消息变体 / swipe / 多候选回复」概念
 *   · 官方**没有**「修改历史消息」RPC；唯一近似是 session.fork（新会话）
 *   · 官方合法的 replace 组合只有三种：tool/result（仅 content 单节点）、
 *     system/message（仅 system 节点）、user/message（compaction 摘要带）
 *
 * ## 本模块的合法载体（官方 compaction 同款形态）
 *   变体切换 / 助手楼层改写 / EJS 写回 —— 统一走
 *   「user/message 标记把旧内容移出上下文 + 新内容合法追加到新 step」。
 *
 * ## 元数据放哪
 *   实验证明自定义事件类型（`dsht/rollback` 等）在 v0 阶段就被迁移器拒绝
 *   （`format v0 contains unknown historical event type`，即使 ignorable:true）。
 *   故扩展元数据只能放进**已知事件的合法字段**：
 *   · `source.form` 枚举 instructions/catalog/snapshot/notice/relay/recall
 *   · `source.sections` 仅 form:'snapshot' 合法，元素 exactly {name,text}
 *   · `source.summary` 仅 form:'notice' 合法
 *   · `content` 文本本身
 *   本模块统一用 `snapshot` 形态承载结构化标记（sections[0].name = 标记键，
 *   sections[0].text = JSON 载荷），人类可读文案放 content。
 *
 * @module dsht-plugin-shared/session-write
 */

// @adapt contract:session.surfaceOp-fields
// @adapt contract:session.assistant-replace-forbidden

/** 一次 append 的最小会话接口（结构化，避免依赖官方类型） */
export interface AppendableSession {
  append: (type: string, data: unknown, opts?: { surfaceOp?: unknown; sourceEventSeqs?: number[] }) => unknown
  /**
   * 【心跳 47 放宽】官方 `Session.surface.nodes` 暴露的是 `readonly number[]`，
   * 本层只读它（全文件无写点），原声明写成可变 `number[]` 于是把**忠实反映官方形状**的
   * 调用方（`LikeSession`）挡在门外（TS2345 ×3）。放宽为 readonly。
   */
  readonly surface?: { readonly nodes?: readonly number[] }
  readonly seq?: number
  readonly lastSeq?: number
}

/** replace 目标区间 */
export interface ReplaceRange { start: number; end: number }

/** 从 surfaceOp 里读区间（兼容两代字段名） */
export function replaceRange(op: unknown): ReplaceRange | null {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return null
  const o = op as Record<string, unknown>
  if (o.op !== 'replace') return null
  const start = typeof o.startSeq === 'number' ? o.startSeq : (typeof o.start === 'number' ? o.start : null)
  const end = typeof o.endSeq === 'number' ? o.endSeq : (typeof o.end === 'number' ? o.end : null)
  if (start === null || end === null) return null
  return { start, end }
}

/** 是否为一个 replace surfaceOp（兼容两代字段名） */
export function isReplaceOp(op: unknown): boolean {
  return replaceRange(op) !== null
}

// ---------------------------------------------------------------- 版本自适应 append

/** 当前会话已接受的 surfaceOp 字段名代次（进程级缓存；同进程内运行时版本恒定） */
let opStyle: 'legacy' | 'current' = 'current'

/**
 * 版本自适应的 surface replace 写入。
 *
 * 为什么用 try/catch 而不是探测模块：
 *   esbuild 打包后 `require('@deepseek-ai/dsh-session/surface')` 不可靠（ESM 产物），
 *   而官方 `append` 的校验发生在 **写入日志之前**（dsh-session/lib/index.js:1189-1200：
 *   `validateSurfaceEventData` → `surfaceManager.validateNext` → 才 `log.push`），
 *   所以一次被拒的 append **无副作用**，可以安全地「先试新字段名，被拒再退回旧字段名」。
 *   首次成功即缓存代次，后续零开销。
 */
export function appendReplace(
  session: AppendableSession,
  type: string,
  data: unknown,
  range: ReplaceRange,
  sourceEventSeqs: number[],
): unknown {
  const build = (style: 'legacy' | 'current'): unknown =>
    style === 'current'
      ? { op: 'replace', startSeq: range.start, endSeq: range.end }
      : { op: 'replace', start: range.start, end: range.end }
  if (opStyle === 'current') {
    try {
      return session.append(type, data, { surfaceOp: build('current'), sourceEventSeqs })
    } catch (e) {
      if (!isInvalidSurfaceOp(e)) throw e
      opStyle = 'legacy' // 运行时不认新字段名 → 本进程内全部退回旧字段名
    }
  }
  return session.append(type, data, { surfaceOp: build('legacy'), sourceEventSeqs })
}

/** 是否「surfaceOp 字段名不被本运行时接受」这一特定错误 */
function isInvalidSurfaceOp(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('invalid replace surfaceOp')
}

/** 供测试重置缓存 */
export function __resetSurfaceOpStyleForTest(): void { opStyle = 'current' }

// ---------------------------------------------------------------- settlement 三件套

/**
 * 官方 `assistant/message` / `assistant/attempt` 的 **settlement 三件套**（turn / step / stream）。
 *
 * 【为什么必须有这个单源函数】2026-09-11 心跳 49 实机实证的静默失败：
 *   · 运行时在**冷启动加载**会话日志时走 `assertSessionEventEnvelope`
 *     → `assertCurrentLlmShape` → `assertAssistantSettlementShape`
 *     （`@deepseek-ai/dsh-session/lib/types/index.js:204-212`），要求
 *     `turn`/`step` 为 ≥0 的安全整数**且 `data.stream` 必须是数组**；
 *     缺 `stream` 直接抛 `seed assistant/message at index N has invalid settlement fields`
 *     → **整个会话打不开**（UI 红字 `Failed to load history`）。
 *   · 而**追加时完全不校验**：`validateSessionEventData`
 *     （同文件 :231-249）只检查 `request/header` 与 `tool/result`，不看 stream。
 *     → 我方插件直写缺 `stream` 的消息，**不报错、不打日志、HTTP 200**，
 *       直到用户下次冷启动打开该会话才炸 —— 典型静默失败族。
 *   · 设备实证：`rp-wuwa` 会话 10 条 `assistant/message`（th-edit / th-append 两条写路径）
 *       缺 `stream` → 会话 100% 打不开；补 `stream: []` 后用官方 `Session` 构造器复判即通过。
 *
 * 【为什么是空数组而不是省略】官方自身对「无流式 chunk」的 assistant 消息也写 `stream: []`
 * （设备实证：核心写的 assistant/message 带 `stream: Array(0)`）；且消费侧
 * `expandAssistantStream(stream)` 实现是 `for (const c of stream)`
 * （`dsh-llm/lib/index.js:1206`）—— `undefined` 会抛 `TypeError: not iterable`。
 *
 * 【纪律】任何写 `assistant/message` / `assistant/attempt` 的地方**都必须**用本函数铺开字段，
 * 不要再手写字面量（本次缺陷正是 6 处手写字面量各自漏了 `stream`）。
 */
export function assistantSettlement(turn: number, step: number): { turn: number; step: number; stream: never[] } {
  return { turn, step, stream: [] }
}

// ---------------------------------------------------------------- 落点规划

/**
 * 助手楼层改写的落点规划（纯函数）：决定新 assistant/message 落在哪个 turn/step。
 *
 * 0.1.5 起 assistant/message 只能 append 且必须落在**打开的 step** 内
 * （dsh-session/lib/invariant.js:56 `requireOpenStep`），所以任何「改写助手楼层」
 * 都必须开/续一个 step：
 *   · idle → 开新 turn（turn+1 / step 1）
 *   · busy → 并入当前 open turn 的下一个 step（不越界开新 turn，同 chat/append 语义）
 */
export function planAssistantRewrite(
  events: readonly { type?: unknown; data?: { turn?: unknown } }[],
  idle: boolean,
): { turn: number; step: number; openTurn: boolean } {
  let lastTurn = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'turn/start') { lastTurn = Number(events[i]?.data?.turn ?? 0) || 0; break }
  }
  if (idle) return { turn: lastTurn + 1, step: 1, openTurn: true }
  let openSteps = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'turn/start') break
    if (events[i]?.type === 'step/start') openSteps++
  }
  return { turn: Math.max(lastTurn, 1), step: openSteps + 1, openTurn: false }
}

// ---------------------------------------------------------------- 标记载体

/**
 * 合法 plugin source 的形态（官方 `pluginSourceValue` 白名单）：
 *   { kind:'plugin', plugin:string, form?, sections?, summary? }
 * 其它任何键（rolledBackTo / regeneratedFrom / editedFrom / thData / oneshot…）
 * 都会被 v0→v1 迁移器判 `source has unexpected member "X"`，整会话打不开。
 */
export interface MarkerSource {
  kind: 'plugin'
  plugin: string
  form: 'snapshot'
  sections: Array<{ name: string; text: string }>
}

const MARKER_PREFIX = 'dsht:'

/**
 * 构造承载结构化标记的合法 plugin source。
 *
 * 用 `form:'snapshot'` + `sections`——官方白名单里唯一能携带任意结构化文本的形态，
 * 语义上也贴合（「一段由插件注入的上下文快照段落」）。
 */
export function markerSource(plugin: string, kind: string, payload: Record<string, unknown>): MarkerSource {
  return {
    kind: 'plugin',
    plugin,
    form: 'snapshot',
    sections: [{ name: `${MARKER_PREFIX}${kind}`, text: JSON.stringify(payload) }],
  }
}

/**
 * 从事件 source 里解出结构化标记（读侧）。非法/缺失返回 null。
 */
export function readMarker<T = Record<string, unknown>>(source: unknown, kind: string): T | null {
  if (source === null || typeof source !== 'object') return null
  const sections = (source as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return null
  for (const sec of sections) {
    if (sec === null || typeof sec !== 'object') continue
    const name = (sec as { name?: unknown }).name
    const text = (sec as { text?: unknown }).text
    if (name !== `${MARKER_PREFIX}${kind}` || typeof text !== 'string') continue
    try { return JSON.parse(text) as T } catch { return null }
  }
  return null
}

/**
 * 读存量（0.1.2 时代）写在 source 顶层的标记键。
 * 老会话里 `source.rolledBackTo` / `source.regeneratedFrom` / `source.editedFrom`
 * 就是这些值，迁移/修复前必须先读出来（否则整会话打不开）。
 */
export interface LegacySourceKeys {
  rolledBackTo?: number
  regeneratedFrom?: number
  editedFrom?: number
  thSystem?: true
  thData?: unknown
}

export function readLegacySourceKeys(source: unknown): LegacySourceKeys {
  const out: LegacySourceKeys = {}
  if (source === null || typeof source !== 'object') return out
  const s = source as Record<string, unknown>
  if (typeof s.rolledBackTo === 'number') out.rolledBackTo = s.rolledBackTo
  if (typeof s.regeneratedFrom === 'number') out.regeneratedFrom = s.regeneratedFrom
  if (typeof s.editedFrom === 'number') out.editedFrom = s.editedFrom
  if (s.thSystem === true) out.thSystem = true
  if (s.thData !== undefined) out.thData = s.thData
  return out
}

/**
 * 手术类标记载荷（回退/编辑/重生成/变体）。
 * 读侧统一入口：`readSurgicalPayload` 把 ① 新形态 `sections[name='dsht:surgical']`、
 * ② 0.1.2 存量会话被迁移器搬进的 `sections[name='dsht:legacy']`、
 * ③ 更早期直写 source 顶层的键 —— 三路合并成同一个形状。
 *
 * 【为什么必须有这个统一读法】0.1.5 起 source 只允许官方白名单键，写侧已迁到
 * sections；任何**仍读顶层键**的消费方都会静默拿到 undefined（无报错、无日志），
 * 表现为「回退后 UI 不隐藏」「记忆侧继续摘要已被撤回的内容」。已修的三处：
 * dsh-plugin 的 /rp/rollback-mask、dsht-plugin-memory 的 extractFloorsFromEvents、
 * dsht-rp-ui 的 hideAfterOf（后者已废弃恒 0，权威来源是前者路由）。
 */
export interface SurgicalPayload {
  rolledBackTo?: number
  regeneratedFrom?: number
  editedFrom?: number
  variantOf?: number
  shadowedSeqs?: number[]
}

/**
 * 三路合并读手术标记载荷（缺失/非法一律忽略，不抛）。
 *
 * 【合并语义：先到先得（fill-if-unset），不是后到覆盖】
 *   三个来源物理上互斥（一个 source 只会是其中一种形态），但防御性兼容时可能共存。
 *   优先级 = 调用顺序：**新形态 sections[dsht:surgical] > 存量 sections[dsht:legacy] > 顶层键**。
 *   为什么必须"先到先得"：后到覆盖会让**旧形态**盖掉**新形态**——
 *   例如新形态写 `rolledBackTo: 0`（"无回退"的有效表达），存量段里躺着 `rolledBackTo: 11`，
 *   覆盖语义会解出 11 → UI 隐藏一段本应可见的楼层（静默错）。
 *
 * 【数组只在"非空数字数组"时落值】
 *   空数组 `[]` 不是有效信息（写侧用字段缺失表达"无遮蔽"），若允许它落值，
 *   一次 `merge` 就能把先前解出的 `[79,80,82]` 清成 `[]`，同样静默。
 */
export function readSurgicalPayload(source: unknown): SurgicalPayload {
  const out: SurgicalPayload = {}
  const merge = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return
    const o = v as Record<string, unknown>
    if (out.rolledBackTo === undefined && typeof o.rolledBackTo === 'number') out.rolledBackTo = o.rolledBackTo
    if (out.regeneratedFrom === undefined && typeof o.regeneratedFrom === 'number') out.regeneratedFrom = o.regeneratedFrom
    if (out.editedFrom === undefined && typeof o.editedFrom === 'number') out.editedFrom = o.editedFrom
    if (out.variantOf === undefined && typeof o.variantOf === 'number') out.variantOf = o.variantOf
    if (out.shadowedSeqs === undefined && Array.isArray(o.shadowedSeqs)) {
      const nums = o.shadowedSeqs.filter((n): n is number => typeof n === 'number')
      if (nums.length > 0) out.shadowedSeqs = nums
    }
  }
  merge(readMarker<SurgicalPayload>(source, 'surgical')) // ① 0.1.5 写侧当前形态
  merge(readMarker<SurgicalPayload>(source, 'legacy'))   // ② 0.1.2 存量被迁移器搬运后的形态
  merge(source)                                          // ③ 更早期直写 source 顶层的键
  return out
}

/**
 * 读历史标记锚点（新形态 + 存量形态统一读法）。
 * 返回「需要隐藏到哪一 seq」的锚点与标记自身 seq（UI 掩码用）。
 */
export function readSurgicalAnchor(ev: { seq?: unknown; type?: unknown; data?: unknown }): { anchor: number | null } {
  const src = ev?.type === 'user/message' || ev?.type === 'assistant/message'
    ? ((ev.data as { source?: unknown } | undefined)?.source ?? (ev.data as { message?: { source?: unknown } } | undefined)?.message?.source)
    : undefined
  const p = readSurgicalPayload(src)
  if (typeof p.rolledBackTo === 'number') return { anchor: p.rolledBackTo }
  if (typeof p.regeneratedFrom === 'number') return { anchor: p.regeneratedFrom }
  if (typeof p.editedFrom === 'number') return { anchor: p.editedFrom - 1 }
  return { anchor: null }
}

// ---------------------------------------------------------------- 事件信封

/**
 * 事件信封允许的键（官方白名单，dsh-session/lib/index.js `assertSessionEventEnvelope`）：
 *   type / seq / time / data / surfaceOp / sourceEventSeqs / ignorable
 * **没有 `source`**。0.1.2 时代我方在 turn/end 信封上写过 source（seqRepair 标记），
 * 0.1.5 加载即 `has unexpected field source`。
 */
export const ENVELOPE_KEYS = ['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable'] as const

/** 剥掉信封上的非法键（返回新对象，不改原值） */
export function sanitizeEnvelope<T extends Record<string, unknown>>(event: T): T {
  const out: Record<string, unknown> = {}
  for (const k of ENVELOPE_KEYS) if (event[k] !== undefined) out[k] = event[k]
  return out as T
}

// ---------------------------------------------------------------- 标记文案

/**
 * 手术类标记（回退/编辑/重生成）的载荷形状（写进 sections[0].text 的 JSON）。
 * 字段名与存量兼容，便于读侧统一。
 */
export interface SurgicalMarkerPayload {
  /** 回退：该 seq 及其后的内容已移出模型上下文 */
  rolledBackTo?: number
  /** 重生成：该用户消息的回复已移出，正在重生成 */
  regeneratedFrom?: number
  /** 编辑：该消息本身及其后的内容已移出 */
  editedFrom?: number
  /** 变体切换：目标变体所属楼层的主 seq */
  variantOf?: number
  /** 被本标记移出模型上下文的 surface 节点（供 UI/统计复原） */
  shadowedSeqs?: number[]
}
