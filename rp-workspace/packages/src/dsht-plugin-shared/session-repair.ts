/**
 * session-repair.ts — 把存量 v0 会话重写为「可通过官方 v0→v3 迁移」的合法形态
 * ============================================================================
 * 背景（2026-09-10 阶段 3 实证）：设备备份的 80 个真实会话里，**41 个（51%）**
 * 在 DSH 0.1.5 下打不开——官方迁移器直接拒绝。8 类根因（按出现数）：

 *   ① 21 个：`assistant/message N chunk provenance is not one complete ordered attempt`
 *      导入管线/变体切换把「兄弟变体」写成 assistant/message 的 replace 链 +
 *      sourceEventSeqs 血缘。0.1.2 合法，0.1.5 双重禁止（见 session-write.ts）。
 *   ②  9 个：`user/message N data lacks required member "id"`（快照注入缺 id）
 *   ③  6 个：`user/message N source has unexpected member "regeneratedFrom"/"rolledBackTo"`
 *   ④  2 个：`turn/end has unexpected field source` / `assistant/message ... source has
 *      unexpected member "plugin"`（信封/source 上的自定义键）
 *   ⑤  1 个：`compaction/prune N shadowedRange must match shadowedSeqs endpoints`
 *   ⑥  1 个：`turn/start N does not open expected turn`（seq 修复留下的 turn 回绕）
 *   ⑦  1 个：`format v0 header cwd must be absolute`
 *   ⑧  （附带）`source` 上的 `thData`/`thSystem`/`oneshot`/`windowRange` 等自定义键

 * 本模块是**纯函数**重写器：读入 v0 会话文本 → 输出合法 v0 会话文本（seq 重编号 +
 * 引用重映射）。不碰磁盘；写盘/备份/验证由调用方负责。
 *
 * 与 session-write.ts 的分工：那个模块管「新写入怎么写合法」；本模块管
 * 「已经写坏的历史文件怎么救回来」。
 *
 * @module dsht-plugin-shared/session-repair
 */

// @adapt contract:session.v0-legacy-repair

import { thFloorKeyOf } from './th-floors.ts'

/** 信封允许的键（官方白名单，信封**没有** `source`） */
const ENVELOPE_KEYS = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable'])
/** 聚合行 tag（宿主 text-chunks 打包形态；本修复器不展开，原样透传） */
const CHUNK_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks']

/** plugin source 的合法键（官方 pluginSourceValue 白名单） */
const PLUGIN_SOURCE_KEYS = new Set(['kind', 'plugin', 'form', 'sections', 'summary', 'compactionId', 'sourceCommandId'])
/** model source 的合法键 */
const MODEL_SOURCE_KEYS = new Set(['kind', 'provider', 'model', 'replayState'])
/** user source 的合法键 */
const USER_SOURCE_KEYS = new Set(['kind', 'rpcId', 'clientTimeZone'])
/** tool source 的合法键 */
const TOOL_SOURCE_KEYS = new Set(['kind', 'callId'])

/** 一条待落 sidecar 的楼层数据（key 在重编号后才最终确定） */
interface PendingSalvage {
  ev: RawEvent
  payload: Record<string, unknown>
}

export interface SessionRepairResult {
  /** 重写后的会话文本（含尾换行）；未改动时与入参等值 */
  content: string
  /** 是否有任何改动 */
  changed: boolean
  /** 人类可读的修复清单（每项一类，便于日志与回执） */
  notes: string[]
  /** 事件总数（展开聚合行后） */
  events: number
  /** 无法修复的硬错误（非空时 content 为原样） */
  error?: string
  /**
   * 从 `source` 上摘下的非法自定义键（0.1.5 白名单不允许），按楼层归集。
   * 键 = message id（无 id 时 `seq:<最终 seq>`）；值 = 原始键值对。
   *
   * **调用方必须把它落进 sidecar**（`th-floors.ts` 的 `mergeSalvagedThFloors`）——
   * 本模块是纯函数不碰磁盘；不落盘就等于静默丢数据（阶段 3 曾踩）。
   * model source 没有 sections 位，sidecar 是唯一的合法归宿。
   */
  salvaged: Array<{ key: string; payload: Record<string, unknown> }>
}

interface RawEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: unknown
  sourceEventSeqs?: number[]
  ignorable?: true
}

/**
 * 把一个 v0 会话重写为合法形态。
 *
 * 变换顺序（关键 —— 先修语义再重编号，否则引用会错位）：
 *  1. header：**不进本模块改**（cwd 与所在目录名强耦合，须 fs 搬迁；见 §1 注释）
 *  2. 逐事件：
 *     · 信封剥非法键
 *     · user/message：补 id；source 非法键搬进 sections；去 replace 的 assistant 化
 *     · assistant/message：source 非法键剔除；replace+ses 拆成「标记 replace + 本消息 append」
 *     · compaction/prune：shadowedSeqs 对齐 shadowedRange 端点、去重、保持 surface 序
 *  3. seq 重编号 + 所有引用（surfaceOp / sourceEventSeqs / shadowedSeqs / shadowedRange）重映射
 *  4. turn 编号续接修复（重复 turn/start 重编号）
 */
export function repairSessionForV3(content: string): SessionRepairResult {
  const lines = content.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length === 0) return { content, changed: false, notes: [], events: 0, salvaged: [], error: '空文件' }

  let header: Record<string, unknown>
  try { header = JSON.parse(lines[0]) as Record<string, unknown> } catch {
    return { content, changed: false, notes: [], events: 0, salvaged: [], error: 'header 不是合法 JSON' }
  }
  if (header?.type !== 'session') return { content, changed: false, notes: [], events: 0, salvaged: [], error: '首行不是 session header' }

  const notes: string[] = []
  let changed = false
  /** source 上摘下来的非法自定义键，重编号后解析成最终 sidecar 键 */
  const pendingSalvage: PendingSalvage[] = []

  // ---- 1) header ----
  // 【阶段3 2026-09-10 回归修复】**不在此处改 cwd**。header.cwd 与所在目录名是一对
  // 强不变量（官方 persistence `assertStoredIdentity`：物理路径必须等于
  // logPath(root, cwd, id)，即目录名必须 == projectKey(cwd)）。本模块是纯函数、不碰
  // 磁盘，改了 cwd 却搬不了目录 → DSH 在 `dsh-workspace` 初始化列 header 时就抛
  // `corrupt session log ... header id ... and cwd identify ...`，**整个 plugin tree 加载
  // 失败、node 退出码 1 无限重启**（实机 crash-loop 实证）。
  // cwd 规范化属「改写 + 搬迁」耦合操作，由 dsh-plugin 的 repairSessionCwds（带 fs）负责。
  const headerOut: Record<string, unknown> = { ...header }

  // ---- 2) 解析事件（聚合行就地展开成逐事件，使编号自洽） ----
  // 聚合行（text-chunks / reasoning-chunks / tool-call-chunks）是宿主的打包形态：
  // 一行代表 N 个 assistant/chunk 事件，并带 `seq0` 指明首个展开事件的序号。
  // 但历史文件里出现过「turn/end 写在 seq N，而打包行的 seq0 也是 N」这种自相矛盾
  // （实测 1 个真实会话 → `turn/end N crosses an open step`）。
  // 官方 0.1.5 的 v0→v1 迁移器本就会展开这三种 tag（PACKED_TAGS），故此处**就地展开**
  // 成逐事件后再统一归一 —— 编号随之自洽，语义等价。
  const raw: RawEvent[] = []
  for (let i = 1; i < lines.length; i++) {
    let ev: Record<string, unknown>
    try { ev = JSON.parse(lines[i]) as Record<string, unknown> } catch { continue }
    if (CHUNK_TAGS.includes(ev.type as string)) {
      const expanded = expandPackedRow(ev)
      if (expanded.length > 0) { raw.push(...expanded); changed = true; notes.push('聚合行（text-chunks 等）就地展开为逐事件（编号自洽）') }
      continue
    }
    if (typeof ev.seq !== 'number') continue
    // 信封非法键（如 turn/end 上的 source）必须在解析时丢弃——否则重序列化会带出去
    const envelopeExtra = Object.keys(ev).filter(k => !ENVELOPE_KEYS.has(k))
    if (envelopeExtra.length > 0) {
      notes.push(`信封剥除非白名单键：${envelopeExtra.join(',')}`)
      changed = true
    }
    raw.push({
      type: String(ev.type),
      seq: ev.seq,
      time: typeof ev.time === 'number' ? ev.time : 0,
      data: (typeof ev.data === 'object' && ev.data !== null ? ev.data : {}) as Record<string, unknown>,
      ...(ev.surfaceOp !== undefined ? { surfaceOp: ev.surfaceOp } : {}),
      ...(Array.isArray(ev.sourceEventSeqs) ? { sourceEventSeqs: flattenSeqRefs(ev.sourceEventSeqs as unknown[]) } : {}),
      ...(ev.ignorable === true ? { ignorable: true as const } : {}),
    })
  }

  // ---- 3) 逐事件修语义 ----
  const out: RawEvent[] = []
  /** 旧 seq → 新 seq（修完后统一重映射引用） */
  const idRemap = new Map<number, number>()

  // 3) 逐事件修语义
  for (const item of raw) {
    const ev: RawEvent = { ...item, data: { ...item.data } }

    // 3b) 消息类事件
    if (ev.type === 'user/message') {
      const r = fixUserMessage(ev.data, notes)
      if (r.changed) { changed = true; ev.data = r.data }
      if (r.dropped !== undefined) pendingSalvage.push({ ev, payload: r.dropped })
    } else if (ev.type === 'assistant/message') {
      const r = fixAssistantMessageSource(ev.data, notes)
      if (r.changed) { changed = true; ev.data = r.data }
      if (r.dropped !== undefined) pendingSalvage.push({ ev, payload: r.dropped })
    } else if (ev.type === 'compaction/prune') {
      const r = fixPrune(ev.data, notes)
      if (r.changed) { changed = true; ev.data = r.data }
    }

    // 3c) assistant/message 做 replace 节点 → 拆成「标记 replace + append」
    if (ev.type === 'assistant/message' && isReplaceSurfaceOp(ev.surfaceOp)) {
      const range = replaceRangeOf(ev.surfaceOp)!
      const refs = ev.sourceEventSeqs ?? flattenSeqRefs([range.start, range.end])
      // ① 插入 user 标记（合法 replace，把旧节点移出模型上下文）
      const mark: RawEvent = {
        type: 'user/message',
        seq: -1, // 占位，稍后重编号
        time: ev.time,
        data: {
          id: `dsht-repair-mark-${ev.seq}`,
          role: 'user',
          content: [{ type: 'text', text: '[变体切换] 该楼层的上一版本已从上下文移除。' }],
          source: {
            kind: 'plugin', plugin: 'dsht-repair', form: 'snapshot',
            sections: [{ name: 'dsht:surgical', text: JSON.stringify({ shadowedSeqs: refs }) }],
          },
        },
        surfaceOp: { op: 'replace', start: range.start, end: range.end },
        sourceEventSeqs: refs,
      }
      out.push(mark)
      // ② 本消息改为 append
      ev.surfaceOp = 'append'
      delete ev.sourceEventSeqs
      out.push(ev)
      notes.push('assistant/message 的 replace 链 → user 标记 replace + append（0.1.5 禁止 assistant 做替换节点）')
      changed = true
      continue
    }

    out.push(ev)
  }

  // prune 的 shadowedSeqs 对齐实际 surface 切片（在 normalizeStructure 插入占位事件之前执行，
  // 此时 seq 仍是原始值、可安全做 surface 追踪；重编号阶段会统一重映射引用）
  if (fixPruneSurfaceSpans(out, notes)) changed = true

  // ---- 3.5) 结构性归一：重建 turn/step 状态机 ----
  // 官方不变量（dsh-session/lib/invariant.js）要求：
  //   · turn/start 编号必须是 nextTurn，且不得在已开 turn 内
  //   · step/start 必须在已开 turn 内、无已开 step、编号 == nextStep
  //   · assistant/message、assistant/attempt、system/message、assistant/chunk
  //     必须落在已开 turn+step 内
  //   · turn/end 必须匹配已开 turn，且无已开 step
  // 历史会话因 seq 修复/中断/重复 turn 留下大量违规（实测 21 个真实会话）→ 迁移 FINISH-REJECT。
  // 注意：此步可能**只**需要结构修复（无其他改动），故必须在下面的 changed 早退之前执行。
  if (normalizeStructure(out, notes)) changed = true

  if (!changed) return { content, changed: false, notes: [], events: out.length, salvaged: [] }

  // ---- 4) 重编号 ----
  // 按输出顺序给事件编号（引用稍后统一重映射）
  out.forEach((ev, i) => { idRemap.set(ev.seq, i); ev.seq = i })
  // 已被删除的旧引用（老 replace 目标）按「就近向上」映射，避免悬空
  const mapRef = (q: number): number => {
    if (idRemap.has(q)) return idRemap.get(q)!
    let best = -1
    for (const [old, neu] of idRemap) if (old <= q && old > best) best = old
    return best === -1 ? 0 : idRemap.get(best)!
  }

  // ---- 5) 引用重映射（turn 编号已由 normalizeStructure 归一，此处不再改） ----
  for (let i = 0; i < out.length; i++) {
    const ev = out[i]
    if (ev.sourceEventSeqs) ev.sourceEventSeqs = uniqueSorted(ev.sourceEventSeqs.map(mapRef)).filter(q => q < ev.seq)
    if (isReplaceSurfaceOp(ev.surfaceOp)) {
      const r = replaceRangeOf(ev.surfaceOp)!
      ev.surfaceOp = { op: 'replace', start: mapRef(r.start), end: mapRef(r.end) }
    }
    if (ev.type === 'compaction/prune') {
      const d = ev.data as { shadowedRange?: { start?: number; end?: number }; shadowedSeqs?: number[] }
      if (Array.isArray(d.shadowedSeqs)) d.shadowedSeqs = uniqueSorted(d.shadowedSeqs.map(mapRef)).filter(q => q < ev.seq)
      if (d.shadowedRange !== undefined) {
        const seqs = d.shadowedSeqs ?? []
        d.shadowedRange = { start: seqs[0] ?? 0, end: seqs[seqs.length - 1] ?? 0 }
      }
    }
  }
  // title 引用对齐（必须在重编号之后）
  if (fixTitleMessageSeqs(out, mapRef, notes)) changed = true
  // prune 的 shadowedSeqs 对齐实际 surface 切片（须在 seq 已定、引用已重映射之后）
  if (fixPruneSurfaceSpans(out, notes)) changed = true
  // 补齐事件的 time 继承前一条（0 会让前端时间线错乱）
  let lastTime = 0
  for (const ev of out) {
    if (ev.time > 0) lastTime = ev.time
    else ev.time = lastTime
  }

  // ---- 5.5) 解析待落 sidecar 的楼层键（seq 此时已最终确定） ----
  // 只保留仍在输出流里的事件（结构归一时可能删掉个别事件）——避免写出悬空键。
  const alive = new Set(out)
  const salvaged: Array<{ key: string; payload: Record<string, unknown> }> = []
  for (const { ev, payload } of pendingSalvage) {
    if (!alive.has(ev)) continue
    const key = thFloorKeyOf(ev.data, ev.seq)
    if (key !== null) salvaged.push({ key, payload })
  }

  // ---- 6) 序列化（信封只输出白名单键） ----
  const text = [JSON.stringify(headerOut), ...out.map(ev => JSON.stringify(serialize(ev)))].join('\n') + '\n'
  return { content: text, changed: true, notes: [...new Set(notes)], events: out.length, salvaged }
}

// ---------------------------------------------------------------- 结构归一

/** 必须落在「已开 turn + 已开 step」内的事件类型（官方 invariant.js requireOpenStep 面） */
const STEP_SCOPED = new Set([
  'assistant/message', 'assistant/attempt', 'system/message', 'assistant/chunk',
  'tool/call', 'tool/result',
])
/** 必须落在「已开 turn」内（不要求 step）的事件类型 */
const TURN_SCOPED = new Set(['request/header', 'request/context'])

/**
 * 结构性归一：按官方不变量（dsh-session/lib/invariant.js）重放并修复 turn/step 状态机。
 *
 * 就地修改 `events`（可能插入补齐事件、删除多余闭合、重写 turn 编号）。返回是否有改动。
 *
 * 修复规则：
 *   · turn/start 在已开 turn 内 → 先补一个 turn/end（interrupted）再开新 turn
 *   · turn/start 编号不接续 → 改写为 nextTurn
 *   · turn/end 与已开 turn 不匹配 → 改写为其编号；无已开 turn → 整条删除
 *   · turn/end 时仍有已开 step → 先补 step/end
 *   · step/start 在无 turn 时 → 先补 turn/start
 *   · step/start 在已开 step 内 → 先补 step/end
 *   · step/start 编号不接续 → 改写为 nextStep
 *   · step/end 与已开 step 不匹配 → 改写；无已开 step → 删除
 *   · assistant/attempt·assistant/message·system/message 无已开 step → 补 turn/start + step/start
 */
function normalizeStructure(events: RawEvent[], notes: string[]): boolean {
  const out: RawEvent[] = []
  let openTurn: number | null = null
  let openStep: number | null = null
  let nextTurn = 1
  let nextStep = 1
  let changed = false
  let seqSrc = -1 // 供补齐事件排序（真实 seq 在下一步重编号）

  const closeStep = (turn: number, step: number): void => {
    // 只在「有 step 开着但缺对应 step/end」时调用 → 一定是补齐，标记改动
    out.push({ type: 'step/end', seq: seqSrc, time: 0, data: { turn, step } })
    openStep = null
    nextStep += 1
    changed = true
  }
  const closeTurn = (turn: number, synthesized: boolean): void => {
    if (openStep !== null) closeStep(turn, openStep)
    out.push({ type: 'turn/end', seq: seqSrc, time: 0, data: { turn, reason: { kind: 'interrupted' } } })
    openTurn = null
    nextTurn += 1
    if (synthesized) changed = true
  }
  const openTurnIfNeeded = (): number => {
    if (openTurn === null) {
      out.push({ type: 'turn/start', seq: seqSrc, time: 0, data: { turn: nextTurn } })
      openTurn = nextTurn
      nextStep = 1
      changed = true
    }
    return openTurn
  }

  for (const ev of events) {
    const d = ev.data as { turn?: number; step?: number }
    switch (ev.type) {
      case 'turn/start': {
        if (openTurn !== null) closeTurn(openTurn, true)
        const t = nextTurn
        if (d.turn !== t) { d.turn = t; changed = true }
        out.push(ev)
        openTurn = t
        nextStep = 1
        break
      }
      case 'turn/end': {
        if (openTurn === null) { changed = true; break } // 无对应 open turn → 删除
        if (d.turn !== openTurn) { d.turn = openTurn; changed = true }
        if (openStep !== null) closeStep(openTurn, openStep) // 先补 step/end
        out.push(ev)
        openTurn = null
        nextTurn += 1
        break
      }
      case 'step/start': {
        const t = openTurnIfNeeded()
        if (openStep !== null) { closeStep(t, openStep); changed = true }
        if (d.turn !== t || d.step !== nextStep) {
          d.turn = t; d.step = nextStep
          changed = true
        }
        out.push(ev)
        openStep = nextStep
        break
      }
      case 'step/end': {
        if (openStep === null) { changed = true; break } // 无对应 open step → 删除
        if (d.turn !== openTurn || d.step !== openStep) {
          d.turn = openTurn ?? 0; d.step = openStep
          changed = true
        }
        out.push(ev)
        openStep = null
        nextStep += 1
        break
      }
      default: {
        // tool/result 的 replace 形态不受 step 约束（官方 invariant.js:67 显式豁免：
        // `if (event.surfaceOp !== 'append') { ... break }`），只有 append 形态要求 step。
        const stepScoped = STEP_SCOPED.has(ev.type)
          && !(ev.type === 'tool/result' && ev.surfaceOp !== undefined && ev.surfaceOp !== 'append')
        if (stepScoped) {
          const t = openTurnIfNeeded()
          if (openStep === null) {
            out.push({ type: 'step/start', seq: seqSrc, time: 0, data: { turn: t, step: nextStep } })
            openStep = nextStep
            changed = true
          }
          if (d.turn !== t || d.step !== openStep) {
            d.turn = t; d.step = openStep
            changed = true
          }
        } else if (TURN_SCOPED.has(ev.type)) {
          const t = openTurnIfNeeded()
          if (d.turn !== undefined && d.turn !== t) { d.turn = t; changed = true }
        }
        out.push(ev)
      }
    }
  }
  // 收尾：闭合遗留的 turn/step（尾部未闭合会让迁移器报「turn/end has no matching open turn」之类）
  if (openTurn !== null) closeTurn(openTurn, true)

  if (changed) {
    notes.push('turn/step 状态机归一（补齐/闭合不合官方不变量的边界事件）')
    events.length = 0
    events.push(...out)
  }
  return changed
}

/**
 * session/title 的 messageSeqs 必须引用**更早的真人 user/message**
 * （官方 assertTitleSources：source.kind 必须是 'user'）。
 * 若引用的 seq 已被上一步重编号/删除，按重映射修正；引用的不是真人 user 消息则清空该数组。
 */
function fixTitleMessageSeqs(events: RawEvent[], mapRef: (q: number) => number, notes: string[]): boolean {
  let changed = false
  for (const ev of events) {
    if (ev.type !== 'session/title' && ev.type !== 'session/title-llm-request') continue
    const d = ev.data as { messageSeqs?: unknown }
    if (!Array.isArray(d.messageSeqs)) continue
    const fixed: number[] = []
    for (const q of d.messageSeqs) {
      if (typeof q !== 'number') continue
      const nq = mapRef(q)
      const target = events[nq]
      if (target === undefined || nq >= ev.seq) continue
      if (target.type !== 'user/message') continue
      const kind = (target.data.source as { kind?: unknown } | undefined)?.kind
      if (kind !== 'user') continue
      if (!fixed.includes(nq)) fixed.push(nq)
    }
    if (fixed.length !== d.messageSeqs.length || fixed.some((q, i) => q !== d.messageSeqs![i])) {
      d.messageSeqs = fixed
      changed = true
    }
  }
  if (changed) notes.push('session/title 的 messageSeqs 重新对齐（必须引用更早的真人 user 消息）')
  return changed
}

// ---------------------------------------------------------------- 子修复

/**
 * 检查并修复：`form:'snapshot'` 必须带 `sections` 数组；`form:'notice'` 必须带 `summary`；
 * `sections` 只在 snapshot 形态下合法。缺失/形态不符会让迁移器抛
 * `source sections must be an array`（实测 9 个真实会话）。
 */
function normalizePluginForm(s: Record<string, unknown>, notes: string[]): boolean {
  let changed = false
  const form = s.form
  if (form === 'snapshot' && !Array.isArray(s.sections)) {
    s.sections = []
    changed = true
  }
  if (form !== 'snapshot' && Array.isArray(s.sections) && form !== undefined) {
    // sections 只在 snapshot 合法：抬成 snapshot 保住内容（比丢弃信息更安全）
    if (s.sections.length > 0) { s.form = 'snapshot' }
    else delete s.sections
    changed = true
  }
  if (form === 'notice' && typeof s.summary !== 'string') {
    s.summary = ''
    changed = true
  }
  if (changed) notes.push('plugin source 的 form 与 sections/summary 形态对齐（snapshot 必须有 sections）')
  return changed
}

/**
 * user/message：补 id；把 source 上的自定义键搬进合法的 sections 标记。
 *
 * plugin source 有 `form:'snapshot' + sections` 合法位，优先用它；其余 kind
 * （model/user/tool）没有合法位 → 交给调用方落 sidecar，**不在这里丢弃**。
 */
function fixUserMessage(data: Record<string, unknown>, notes: string[]): { data: Record<string, unknown>; changed: boolean; dropped?: Record<string, unknown> } {
  let changed = false
  let dropped: Record<string, unknown> | undefined
  const d: Record<string, unknown> = { ...data }
  if (typeof d.id !== 'string' || d.id === '') {
    d.id = `dsht-repair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    notes.push('user/message 缺 id → 补生成')
    changed = true
  }
  const src = d.source
  if (src !== null && typeof src === 'object') {
    const s = { ...(src as Record<string, unknown>) }
    const kind = String(s.kind ?? '')
    const allowed = kind === 'plugin' ? PLUGIN_SOURCE_KEYS
      : kind === 'model' ? MODEL_SOURCE_KEYS
        : kind === 'user' ? USER_SOURCE_KEYS
          : kind === 'tool' ? TOOL_SOURCE_KEYS
            : null
    if (allowed !== null) {
      const illegal = Object.keys(s).filter(k => !allowed.has(k))
      if (illegal.length > 0) {
        // thData 等结构化载荷 → plugin source 搬进 sections（合法携带位）
        const payload: Record<string, unknown> = {}
        for (const k of illegal) { payload[k] = s[k]; delete s[k] }
        if (s.kind === 'plugin') {
          const sections = Array.isArray(s.sections) ? (s.sections as Array<Record<string, unknown>>) : []
          sections.push({ name: 'dsht:legacy', text: JSON.stringify(payload) })
          s.form = s.form ?? 'snapshot'
          s.sections = sections
          notes.push('user/message source 自定义键 → 搬进 sections 标记')
        } else {
          // 非 plugin source 无合法携带位 → 交调用方落 sidecar（阶段 3：不再静默丢弃）
          dropped = payload
          notes.push(`user/message source(${kind}) 的自定义键 → 移交 sidecar：${illegal.join(',')}`)
        }
        changed = true
      }
    }
    if (s.kind === 'plugin' && normalizePluginForm(s, notes)) changed = true
    d.source = s
  }
  return { data: d, changed, ...(dropped !== undefined ? { dropped } : {}) }
}

/**
 * assistant/message：剔除 model source 上的非法键。
 * model source 是闭集 `{kind,provider,model,replayState}`，**没有 sections 位** →
 * 摘下来的键返回给调用方落 sidecar（阶段 3：从「丢弃」改为「移交」）。
 */
function fixAssistantMessageSource(data: Record<string, unknown>, notes: string[]): { data: Record<string, unknown>; changed: boolean; dropped?: Record<string, unknown> } {
  const msg = data.message
  if (msg === null || typeof msg !== 'object') return { data, changed: false }
  const m = { ...(msg as Record<string, unknown>) }
  const src = m.source
  if (src === null || typeof src !== 'object') return { data, changed: false }
  const s = { ...(src as Record<string, unknown>) }
  const illegal = Object.keys(s).filter(k => !MODEL_SOURCE_KEYS.has(k))
  if (illegal.length === 0) return { data, changed: false }
  const dropped: Record<string, unknown> = {}
  for (const k of illegal) { dropped[k] = s[k]; delete s[k] }
  m.source = s
  notes.push(`assistant/message source 的自定义键 → 移交 sidecar（model source 无合法携带位）：${illegal.join(',')}`)
  return { data: { ...data, message: m }, changed: true, dropped }
}

/** compaction/prune：shadowedSeqs 去重升序 + 端点对齐 shadowedRange */
function fixPrune(data: Record<string, unknown>, notes: string[]): { data: Record<string, unknown>; changed: boolean } {
  const d = { ...data }
  const seqs = Array.isArray(d.shadowedSeqs) ? (d.shadowedSeqs as unknown[]).filter((q): q is number => typeof q === 'number') : []
  if (seqs.length === 0) return { data, changed: false }
  const fixed = uniqueSorted(seqs)
  const same = fixed.length === seqs.length && fixed.every((q, i) => q === seqs[i])
  if (same) return { data, changed: false }
  d.shadowedSeqs = fixed
  notes.push('compaction/prune 的 shadowedSeqs 重排（去重 + 升序，对齐 shadowedRange 端点）')
  return { data, changed: true }
}

/**
 * 影子化序列校验：`compaction/prune` 的 shadowedSeqs 必须**恰好等于**当前 surface
 * 从 start 到 end 的连续切片（官方 validateShadowedSeqs：surface 序而非数值升序）。
 * 历史会话因多次 replace 交错，shadowedSeqs 常与 surface 切片不符 → 迁移拒绝
 * （实测 1 个真实会话）。
 *
 * 做法：重放 surfaceOp 折叠出 surface，逐个 prune 事件校验；不符时按实际 surface
 * 切片**重写** shadowedSeqs/shadowedRange（保内容、去不一致）。无匹配切片则整条删除该 prune。
 */
function fixPruneSurfaceSpans(events: RawEvent[], notes: string[]): boolean {
  let changed = false
  const surface: number[] = []
  const kept: RawEvent[] = []
  for (const ev of events) {
    // 先按 surfaceOp 更新 surface（用它自己的语义，与官方 foldSurface 同构）
    if (ev.type === 'compaction/prune') {
      const d = ev.data as { shadowedRange?: { start?: number; end?: number }; shadowedSeqs?: number[] }
      const seqs = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs : []
      if (seqs.length === 0) { kept.push(ev); continue }
      const si = surface.indexOf(seqs[0])
      const ei = surface.indexOf(seqs[seqs.length - 1])
      if (si < 0 || ei < si) {
        // 不在当前 surface 上 → 该 prune 已失效，整条删除（后续 replace 仍会正常）
        changed = true
        continue
      }
      const span = surface.slice(si, ei + 1)
      const same = span.length === seqs.length && span.every((q, i) => q === seqs[i])
      if (!same) {
        d.shadowedSeqs = span
        d.shadowedRange = { start: span[0], end: span[span.length - 1] }
        changed = true
      }
      kept.push(ev)
      continue
    }
    kept.push(ev)
    // 更新 surface（replace / append）
    if (ev.type === 'user/message' || ev.type === 'assistant/message' || ev.type === 'system/message' || ev.type === 'tool/result') {
      const op = ev.surfaceOp
      if (op === 'append') { surface.push(ev.seq); continue }
      const r = replaceRangeOf(op)
      if (r === null) continue
      const si = surface.indexOf(r.start)
      const ei = surface.indexOf(r.end)
      if (si < 0 || ei < si) continue
      surface.splice(si, ei - si + 1, ev.seq)
    }
  }
  if (changed) {
    notes.push('compaction/prune 的 shadowedSeqs 对齐实际 surface 切片（失效 prune 已移除）')
    events.length = 0
    events.push(...kept)
  }
  return changed
}

// ---------------------------------------------------------------- 工具

/** 事件序列化：只输出官方信封白名单键（顺序与官方 encode 一致） */
function serialize(ev: RawEvent): Record<string, unknown> {
  const o: Record<string, unknown> = { type: ev.type, seq: ev.seq, time: ev.time, data: ev.data }
  if (ev.surfaceOp !== undefined) o.surfaceOp = ev.surfaceOp
  if (ev.sourceEventSeqs !== undefined) o.sourceEventSeqs = ev.sourceEventSeqs
  if (ev.ignorable === true) o.ignorable = true
  return o
}

/**
 * 展开一行宿主聚合数据（text-chunks / reasoning-chunks / tool-call-chunks）为逐事件。
 * 语义与官方 v0→v1 迁移器的 PACKED_TAGS 展开一致：每个成员一条 assistant/chunk，
 * seq 从 `seq0` 起递增，time 由 `time0` + `dt` 增量推得。
 */
function expandPackedRow(row: Record<string, unknown>): RawEvent[] {
  const tag = String(row.type)
  const data = (typeof row.data === 'object' && row.data !== null ? row.data : {}) as Record<string, unknown>
  const payload = tag === 'tool-call-chunks' ? data.args : data.texts
  const seq0 = row.seq0
  const time0 = row.time0
  if (typeof seq0 !== 'number' || typeof time0 !== 'number' || !Array.isArray(payload)) return []
  const dt = Array.isArray(data.dt) ? data.dt : []
  const out: RawEvent[] = []
  let t = time0
  payload.forEach((member, k) => {
    let chunk: Record<string, unknown>
    if (tag === 'tool-call-chunks') {
      chunk = { type: 'tool-call-delta', index: data.index, id: data.id, name: data.name, argumentsDelta: member }
    } else if (tag === 'reasoning-chunks') {
      chunk = { type: 'reasoning-delta', index: data.index, text: member }
    } else {
      chunk = { type: 'text-delta', index: data.index, text: member }
    }
    out.push({
      type: 'assistant/chunk',
      seq: seq0 + k,
      time: t,
      data: { turn: data.turn, step: data.step, chunk },
    })
    const step = typeof dt[k] === 'number' ? dt[k] : 0
    t += step
  })
  return out
}

function uniqueSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b)
}

/** sourceEventSeqs 可能被宿主编码成 [start,end] 区间形态，先摊平 */
function flattenSeqRefs(raw: unknown[]): number[] {
  const out: number[] = []
  for (const x of raw) {
    if (typeof x === 'number') { out.push(x); continue }
    if (Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] === 'number') {
      for (let q = x[0]; q <= x[1]; q++) out.push(q)
    }
  }
  return out
}

function isReplaceSurfaceOp(op: unknown): boolean {
  return replaceRangeOf(op) !== null
}

function replaceRangeOf(op: unknown): { start: number; end: number } | null {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return null
  const o = op as Record<string, unknown>
  if (o.op !== 'replace') return null
  const start = typeof o.startSeq === 'number' ? o.startSeq : (typeof o.start === 'number' ? o.start : null)
  const end = typeof o.endSeq === 'number' ? o.endSeq : (typeof o.end === 'number' ? o.end : null)
  if (start === null || end === null) return null
  return { start, end }
}

/**
 * turn 编号续接修复：官方不变量要求 turn/start 的编号必须是 nextTurn（上一 turn+1）。
 * 历史会话因 seq 修复/重复 turn/start 出现过「turn 2 之后又开 turn 2」→ 迁移拒绝。
 * 返回「事件下标 → 应写的 turn 编号」（只在需要改时才有条目）。
 */
function planTurnReassign(events: RawEvent[]): Map<number, number> {
  let nextTurn = 1
  let openTurn: number | null = null
  const plan = new Map<number, number>()
  events.forEach((ev, i) => {
    if (ev.type === 'turn/start') {
      const t = typeof ev.data.turn === 'number' ? ev.data.turn : nextTurn
      if (t !== nextTurn) plan.set(i, nextTurn)
      openTurn = nextTurn
      nextTurn += 1
      return
    }
    if (ev.type === 'turn/end') { openTurn = null; return }
    if (ev.type === 'step/start' || ev.type === 'step/end' || ev.type === 'assistant/message') {
      if (openTurn !== null && typeof ev.data.turn === 'number' && ev.data.turn !== openTurn) plan.set(i, openTurn)
    }
  })
  return plan
}
