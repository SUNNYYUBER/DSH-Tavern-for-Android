/**
 * prompt-bridge.ts —— 卡「写侧 prompt 改写」通道的 **node 侧**（T-63 / D-67-1）
 * ============================================================================
 * 【它做什么】把浏览器侧卡的写侧改写（`GENERATE_AFTER_DATA` / `preparePrompt` /
 * `setChatCompletion`）拉进 node 侧装配链路，使改写**真的出现在发给 LLM 的请求里**。
 *
 * 【为什么是"长轮询"而不是"轮询"】见 `assets/st-modules/scripts/prompt-bridge.js` 文件头。
 * 要点：只占**一条**连接；宿主明文允许挂起响应
 * （`dsh-host-webserver/lib/types/index.d.ts:37` "may hold the response open, e.g. SSE"）。
 *
 * 【三条防护 —— 都是"提前做"，不靠出事再补】
 *   ① **零开销快路径**：`interest` 里没有该会话时，`rewrite()` **同步返回原批**
 *      （不等待、不往返）⇒ 未用写侧功能的会话，生成路径**一点延迟都不加**。
 *   ② **硬超时**：等待有**上界**（`timeoutMs`），超时按"未改写"继续并**出声**
 *      ⇒ 结构上**不可能让生成卡死**。
 *   ③ **可听降级**：无 puller / 超时 / 回传迟到 / 处理异常 —— 全部出声且可定位
 *      （会话 id + 环节 + 原因），按 `sessionId|reason` 去重（不刷屏）。
 *
 * 【"UI 是否在场"判定】本通道**自带**：有挂起的 pull = UI 在场且通道可用。
 * 这比"另建心跳"更准确 —— 连接在，就一定能收到活；连接不在，就必然降级。
 */

/** 等待上界（硬超时）。超时即按"未改写"继续 —— 生成绝不被卡住 */
export const PROMPT_BRIDGE_TIMEOUT_MS = 1500

/** 单次 pull 的挂起上界（到点返回 `hasWork:false`，让 UI 立刻再拉；同时充当保活） */
export const PROMPT_BRIDGE_PULL_HOLD_MS = 20_000

/**
 * 【防护 ④ · 窗口期宽容】UI 的长轮询不是**无缝**的：每次 `pull` 返回后，UI 要
 * 解析 → 处理 → `return` → 再发下一条 `pull`，这段时间里 node 侧**看不到挂起的 puller**。
 * 若此时恰好有 `rewrite` 到达，就会误判"UI 不在场"而白白降级（本可避免的功能失效）。
 *
 * 处置：记住**最近一次 pull 的时刻**。若在宽容期内（默认 5s）出现过 pull，就认为 UI 在场，
 * 正常排队等活（UI 的下一条 pull 会取走）；只有从未拉过、或超过宽容期没拉过，才立即降级。
 * 这样既不牺牲"UI 真不在场 ⇒ 立即降级"，又防住了窗口期碰撞。
 */
export const PROMPT_BRIDGE_PULLER_GRACE_MS = 5_000

export interface PromptRewriteRequest {
  sessionId: string
  /** 我方 `agent/pre-step` 的整批（`{role, content: Block[]}` 形状） */
  messages: unknown[]
}

export type PromptBridgeOutcome =
  /** 已取到卡的改写结果（已回收成我方批形状） */
  | { kind: 'rewritten'; messages: unknown[] }
  /** 该会话未声明写侧兴趣 ⇒ 快路径（零开销） */
  | { kind: 'no-interest'; messages: unknown[] }
  /** 声明了兴趣但没有 UI 在等 ⇒ 降级（已出声） */
  | { kind: 'degraded'; reason: 'no-puller' | 'timeout' | 'error'; messages: unknown[] }

/**
 * ---- ST prompt 投影（node 侧 ↔ UI 侧的形状适配）----
 *
 * 【为什么需要】卡的三个写侧钩子拿到的是 **ST prompt 形状**（`{role, content: string,
 * identifier}`），而我方 `agent/pre-step` 的批是 `{role, content: Block[]}`。两者必须转换，
 * 且转换要**双向保真**：
 *  · 去程：`messages` → ST prompt[]（供卡的 handler 读写）
 *  · 回程：ST prompt[] → `messages`（让改写**真的出现在请求里**，且不破坏会话写入）
 *
 * 【identifier 的语义（卡依赖，不是装饰）】实测 `tmp/t37-inject.js:3053`
 * `item.identifier.startsWith('chatHistory')` —— 卡据此判定「哪些条目属于聊天历史、需要
 * squash」。故历史轮次（user/assistant）必须给 `chatHistory-*` 前缀；非历史条目（system /
 * 我方注入）给稳定短名，卡按 identifier 查它的 MessageInjections 配置。
 *
 * 【回程为什么按 role 复用原条目】改写后条目数可能变（squash 合并、注入新增）。若逐位硬套，
 * 会把 A 条目的 `source` 安到 B 上（模型源 vs 插件源混用）⇒ 会话写入校验失败或历史被投毒。
 * 故：先按「同 role 且未被占用」匹配复用原条目的其余字段（含 `source`），匹配不到才用
 * 插件快照源兜底（诚实标注来源）。
 */
export interface StPrompt {
  role: string
  content: string
  identifier: string
  name?: string
}

/** 把 block 数组里的文本拼出来（我方 content 是 `Block[]`） */
function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const b of content) {
    if (b !== null && typeof b === 'object' && (b as { type?: string }).type === 'text') {
      const t = (b as { text?: unknown }).text
      if (typeof t === 'string') out += (out ? '\n' : '') + t
    }
  }
  return out
}

/** 去程：我方批 → ST prompt[] */
export function toStPrompts(messages: readonly unknown[]): StPrompt[] {
  const out: StPrompt[] = []
  let historyIndex = 0
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]
    if (m === null || typeof m !== 'object') continue
    const role = typeof (m as { role?: unknown }).role === 'string' ? String((m as { role: string }).role) : 'system'
    const content = blocksToText((m as { content?: unknown }).content)
    // 历史轮次给 chatHistory 前缀（卡的 squash 判据；见本段头注）
    const isHistory = role === 'user' || role === 'assistant'
    const identifier = isHistory ? `chatHistory-${historyIndex}-${role}` : `prompt-${i}`
    if (isHistory) historyIndex += 1
    out.push({ role, content, identifier })
  }
  return out
}

/** 把 UI 回传的任意形状收窄成 StPrompt[]（只在边界做一次；缺失字段给安全默认） */
export function coerceStPrompts(raw: unknown[]): StPrompt[] {
  const out: StPrompt[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const p = raw[i]
    if (p === null || typeof p !== 'object') continue
    const o = p as { role?: unknown; content?: unknown; identifier?: unknown; name?: unknown }
    out.push({
      role: typeof o.role === 'string' && o.role ? o.role : 'system',
      content: typeof o.content === 'string' ? o.content : '',
      identifier: typeof o.identifier === 'string' && o.identifier ? o.identifier : `prompt-${i}`,
      ...(typeof o.name === 'string' ? { name: o.name } : {}),
    })
  }
  return out
}

/** 回收：ST prompt[] → 我方批（保留原条目除 role/content 外的字段） */
export function fromStPrompts(
  original: readonly unknown[],
  prompts: readonly StPrompt[],
  sent?: readonly StPrompt[],
): unknown[] {
  const pools = new Map<string, number[]>()
  for (let i = 0; i < original.length; i += 1) {
    const m = original[i]
    if (m === null || typeof m !== 'object') continue
    const r = String((m as { role?: unknown }).role ?? '')
    const bucket = pools.get(r)
    if (bucket === undefined) pools.set(r, [i])
    else bucket.push(i)
  }
  const restored: unknown[] = []
  for (let k = 0; k < prompts.length; k += 1) {
    const p = prompts[k]
    const role = typeof p.role === 'string' && p.role ? p.role : 'system'
    const text = typeof p.content === 'string' ? p.content : ''
    const bucket = pools.get(role)
    const reuseAt = bucket !== undefined && bucket.length > 0 ? bucket.shift() : undefined
    if (reuseAt !== undefined) {
      const orig = original[reuseAt] as Record<string, unknown>
      // 【保真】若该条目 role/content 与去程逐字相同（卡没动它），**原样保留整条**——
      // 这样非文本 block（图片 / 工具调用等）与 source/id 零损失。
      // 只在卡真的改了它时才重建 content（此时按文本重建是卡自己语义的必然结果）。
      const sentOne = sent !== undefined ? sent[reuseAt] : undefined
      const untouched = sentOne !== undefined
        && sentOne.role === role
        && sentOne.content === text
        && sentOne.identifier === p.identifier
      restored.push(untouched ? orig : { ...orig, role, content: [{ type: 'text', text }] })
    } else {
      // 新增条目（卡 push 的）：诚实标注为我方插件快照源
      restored.push({
        role,
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsht-prompt-bridge',
          form: 'snapshot',
          sections: [{ name: 'dsht-rp:card-write-side', text }],
        },
      })
    }
  }
  return restored
}

interface Pending {
  sessionId: string
  round: number
  /** 去程投影后的 ST prompt[]（UI 侧读写的就是它） */
  prompt: StPrompt[]
  /** 是否已被 pull 取走（取走后等待 `settle` 回传） */
  claimed: boolean
  finish: (prompt: StPrompt[] | null) => void
}

export interface PromptBridgeHooks {
  /** 出声（默认 console.warn；注入以便单测断言） */
  warn?: (key: string, message: string) => void
}

export class PromptBridge {
  private seq = 0
  /** 在飞的改写请求（装配串行 ⇒ 同一时刻至多一条） */
  private pending: Pending | null = null
  /** 挂起中的 pull（等活的一方）。新的 pull 会顶掉旧的（旧的按 hold 超时返回 hasWork:false） */
  private waiter: ((work: { round: number; prompt: StPrompt[] }) => void) | null = null
  /** 已声明写侧兴趣的会话（零开销快路径的判据） */
  private readonly interest = new Set<string>()
  private readonly warned = new Set<string>()
  private readonly warn: (key: string, message: string) => void
  /** 各会话最近一次 `pull` 的时刻（防护 ④：窗口期宽容判据；按会话记，避免跨会话串味） */
  private readonly lastPullAt = new Map<string, number>()

  constructor(hooks: PromptBridgeHooks = {}) {
    this.warn = hooks.warn ?? ((_key, message) => console.warn(`[dsht-prompt-bridge] ${message}`))
  }

  /** UI 是否"最近在场"（宽容期内的拉取也算在场，见 `PROMPT_BRIDGE_PULLER_GRACE_MS`） */
  private pullerRecentlyActive(sessionId: string): boolean {
    const at = this.lastPullAt.get(sessionId)
    return at !== undefined && (Date.now() - at) < PROMPT_BRIDGE_PULLER_GRACE_MS
  }

  /** 记一次"UI 在场"（pull 进入**与**结束都要记：长挂起返回后窗口期从"返回时刻"起算） */
  private markPullerActive(sessionId: string): void {
    this.lastPullAt.set(sessionId, Date.now())
  }

  /** 标记会话有写侧需求（由 UI 的 pull/declare 上报） */
  declareInterest(sessionId: string): void {
    if (sessionId) this.interest.add(sessionId)
  }

  /** 解除兴趣（会话关闭/切换 ⇒ 快路径重新生效） */
  clearInterest(sessionId: string): void {
    this.interest.delete(sessionId)
  }

  hasInterest(sessionId: string): boolean {
    return this.interest.has(sessionId)
  }

  private warnOnce(sessionId: string, reason: string, message: string): void {
    const key = `${sessionId}|${reason}`
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.warn(key, message)
  }

  /**
   * 请求卡的写侧改写。**保证有界返回**：无论 UI 是否在场，都不会超过 `timeoutMs`。
   *
   * 形状契约：入参是**我方批**、出参也是**我方批**；与 UI 之间的往返投影为 ST prompt[]
   * （`toStPrompts` / `fromStPrompts`，见本文件上方头注）。
   */
  async rewrite(request: PromptRewriteRequest, timeoutMs = PROMPT_BRIDGE_TIMEOUT_MS): Promise<PromptBridgeOutcome> {
    const { sessionId, messages } = request
    // ① 零开销快路径：未声明兴趣 ⇒ 不等待、不往返
    if (!this.interest.has(sessionId)) return { kind: 'no-interest', messages }

    if (this.waiter === null && this.pending === null && !this.pullerRecentlyActive(sessionId)) {
      // ③ 可听降级：声明了兴趣却**确实**无人等活（UI 从未拉过 / 已超宽容期没拉）
      this.warnOnce(
        sessionId, 'no-puller',
        `会话 ${sessionId} 声明了写侧改写需求，但没有在等活的 UI —— 本轮按**未改写**继续（卡的功能本轮不生效）。`,
      )
      return { kind: 'degraded', reason: 'no-puller', messages }
    }

    // 去程投影：ST prompt[]（卡的三个钩子都按这个形状读写）
    const sent = toStPrompts(messages)
    const round = ++this.seq
    const out = await new Promise<StPrompt[] | null>(resolve => {
      let settled = false
      const finish = (value: StPrompt[] | null): void => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const work: Pending = { sessionId, round, prompt: sent, claimed: false, finish }
      const timer = setTimeout(() => {
        if (this.pending === work) this.pending = null
        this.warnOnce(
          sessionId, 'timeout',
          `会话 ${sessionId} 的写侧改写等待超时（${timeoutMs}ms）—— 本轮按**未改写**继续。`,
        )
        finish(null)
      }, timeoutMs)
      // finish 包一层：保证超时/回传两条路都清 timer
      work.finish = (value) => { clearTimeout(timer); finish(value) }
      this.pending = work
      const handOff = this.waiter
      if (handOff !== null) {
        this.waiter = null
        work.claimed = true
        handOff({ round, prompt: sent })
      }
    })

    if (out === null) return { kind: 'degraded', reason: 'timeout', messages }
    // 回程回收：ST prompt[] → 我方批（保 source/id，非文本 block 未动则原样保留）
    const back = fromStPrompts(messages, out, sent)
    if (back.length === 0) {
      // 卡把整批清空了 ⇒ 绝不采信（空批会让生成直接失败，且几乎必然是卡写错）
      this.warnOnce(sessionId, 'empty-result', `会话 ${sessionId} 的写侧改写返回了空批 —— 本轮按**未改写**继续（不采信空批）。`)
      return { kind: 'degraded', reason: 'error', messages }
    }
    return { kind: 'rewritten', messages: back }
  }

  /**
   * UI 侧 `POST /prompt-bridge/pull`：**挂起**直到有活或到 `holdMs`。
   * `hasWork:false` 表示"暂时没活"（UI 应立即再拉一次，形成长轮询循环）。
   */
  async pull(sessionId: string, holdMs = PROMPT_BRIDGE_PULL_HOLD_MS): Promise<
    { hasWork: false } | { hasWork: true; round: number; prompt: StPrompt[] }
  > {
    // 【不做 declareInterest】这是**有意**的：`pull` 只表示"我在等活"，不表示"本会话有卡要
    // 改写"。兴趣的唯一来源是 UI 的显式 `/declare`（由卡的真实写侧动作触发）——若在这里
    // 顺手声明，则**每个**开着的会话都会自动进兴趣表 ⇒ 零开销快路径失效（每轮都等 1500ms）。
    this.markPullerActive(sessionId)   // 防护 ④：记"UI 在场"，供窗口期宽容判据
    // 已有排队中的活（rewrite 先到、puller 后到）⇒ 立即交付
    const queued = this.pending
    if (queued !== null && !queued.claimed) {
      queued.claimed = true
      return { hasWork: true, round: queued.round, prompt: queued.prompt }
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.waiter === deliver) this.waiter = null
        // 长挂起到点返回 ⇒ **重记在场时刻**：UI 收到后要处理/回传/再拉，这段窗口期从
        // "返回时刻"起算才准确（否则 20s 挂起一结束就立刻超宽容期 ⇒ 白降级）。
        this.markPullerActive(sessionId)
        resolve({ hasWork: false })
      }, holdMs)
      const deliver = (work: { round: number; prompt: StPrompt[] }): void => {
        clearTimeout(timer)
        this.markPullerActive(sessionId)
        resolve({ hasWork: true, round: work.round, prompt: work.prompt })
      }
      this.waiter = deliver
    })
  }

  /**
   * UI 侧 `POST /prompt-bridge/return`：回传改写结果。
   * 等待方已超时 ⇒ **出声**（不静默丢弃）。
   */
  settle(sessionId: string, round: number, prompt: unknown[]): { ok: boolean; reason?: string } {
    const work = this.pending
    if (work === null || work.round !== round) {
      this.warnOnce(
        sessionId, 'late-return',
        `会话 ${sessionId} 的写侧改写回传晚于等待窗口（round=${round}）—— 该次改写未被采用（生成已按未改写继续）。`,
      )
      return { ok: false, reason: 'no-waiter' }
    }
    this.pending = null
    work.finish(coerceStPrompts(prompt))
    return { ok: true }
  }

  /** 单测用：复位 */
  reset(): void {
    this.pending = null
    this.waiter = null
    this.interest.clear()
    this.lastPullAt.clear()
    this.warned.clear()
    this.seq = 0
  }
}

/** 进程级单例（与其它 dsht-rp 数据面一致：一个插件实例一个） */
export const promptBridge = new PromptBridge()
