/**
 * token 上下文进度条（PROJECT_PLAN §7 措施 8「token 计量暴露」前端形态 +
 * §4.15「token 上下文进度条：输入区常驻"当前上下文占比"条」）。
 *
 * 【口径定案（2026-09-03 真实 usage 收口）——优先「provider 真实值」】
 * - 会话快照（dock 席位 props.session.chat）的最后一条 assistant 消息自带
 *   provider usage（inputTokens/cacheReadTokens/cacheWriteTokens）——总请求
 *   prompt = 三者之和（dsh-token-meter ContextPressureProjection.pressureTokens
 *   同口径）。首轮回复落地前无 usage → 回落「字符量估算」（总字数 ÷ 2.5）。
 * - 预算优先级（【2026-09-14 F4 修正】）：
 *   ① 模型目录真实上下文能力（provider 声明；也是 CONTEXT_WINDOW_EXCEEDED 的真实判据）
 *   ② 会话有效预设 sampling.maxContext（用户自配）
 *   ③ 占位值 —— 此时 UI **必须**标明「预算未知」，不许装作准确
 *   旧实现只有 ②③，且 ③ 被当作准确值展示 → 出现 `1.1M / 16.4k` 这种自相矛盾的读数。
 * - 【2026-09-14 F4-C3】字符估算**扣除被回退/编辑/重新生成移出上下文的消息**
 *   （掩码集合）——否则回退后占用不降，与用户观感矛盾。
 *
 * 挂载：conversation.input.dock 席位 order 51（dock 序列最末 = 紧贴 composer
 * 输入框上方的常驻细条；官方输入区本身无更细的挂载点）。仅 RP 会话且已有消息时
 * 显示（与悬浮球同门槛，非 RP 会话零影响）。30s 轮询（生成中文本增长即见；
 * 失败保持上次值不闪空）。
 * §2.3 ④⑤（2026-09-03）：计量条可点击 → 弹出「上下文与记忆」面板（RpContextPanel）：
 * AI 可见楼层数/近窗字符预算调节 + 折叠区间「展开给 AI（单次）」。
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { rpApi, thApi } from './rpc.ts'
import { useRpSlug, readSessionCwd } from './RpStateFloat.tsx'
import { readSessionBlank, readSessionId } from './host-projection.ts'
import { RpContextPanel } from './RpContextPanel.tsx'
import { useRollbackMaskState } from './RpNativeChat.tsx'
import { pollWhileVisible } from './visibility.ts'
import {
  DEFAULT_MAX_CONTEXT,
  buildMeterReading,
  estimateTokens,
  formatTokens,
  isTrustworthy,
  meterLevel,
  meterPercent,
  originLabel,
  sumMessageChars,
} from './token-meter-core.ts'

/** dock 席位 owner props（InputZone 快照；字段按运行时形态防御性读取） */
interface DockProps {
  session?: unknown
  input?: unknown
}

/** 真实 usage 口径（§2.2 附带项收口）：会话快照里最后一条 assistant 消息的
 *  provider usage——总请求 prompt = inputTokens（未缓存）+ cacheRead + cacheWrite
 *  （dsh-token-meter ContextPressureProjection.pressureTokens 同口径）。
 *  usage 缺席（尚无回复/旧会话）→ null，回落字符量估算。
 *  【2026-09-06】宿主 SessionSnapshot 无 chat 投影（fiber 实证）→ 快照 usage 面恒 null，
 *  恒走字符量估算（「估算值」标签）；chat/messages RPC 不回 usage，真实口径等宿主补投影。 */
function lastRequestTokens(_session: unknown): number | null {
  return null
}

/** 轮询间隔（ms）：30s 足够"进度条随对话推进"，又不会让大日志常被整扫 */
const POLL_MS = 30_000

/** 会话预算缓存（页面生命周期内每会话解析一次；预算随预设切换的场景极少，可忽略） */
const budgetCache = new Map<string, Promise<BudgetInfo>>()

/** 预算读数：值 + 来源口径（【2026-09-14 F4】来源必须能说清，UI 据此标注可信度） */
interface BudgetInfo {
  value: number
  origin: 'model-catalog' | 'preset' | 'unknown'
}

/**
 * 会话上下文预算。优先级（【2026-09-14 F4 修正】）：
 *   ① 模型目录真实能力（GET /dsht-rp/rp/model-capability；后端从 pi-ai 目录
 *      或 llm-pi-ai 用户层配置读出 provider 声明的 contextWindow）
 *      —— 这是 CONTEXT_WINDOW_EXCEEDED 的真实判据来源，最该用它做分母；
 *   ② 会话有效预设 sampling.maxContext（用户自配）；
 *   ③ 占位 DEFAULT_MAX_CONTEXT（**标注为 unknown**，不许当作准确值）。
 *
 * 为什么不能只留 ②③：旧实现如此，于是拉不到预设时 UI 会显示
 * `≈ 1.1M / 16.4k tokens` —— 分子远大于分母却毫无提示，用户看到的占用率是错的。
 */
function fetchBudget(sessionId: string): Promise<BudgetInfo> {
  let p = budgetCache.get(sessionId)
  if (p === undefined) {
    p = (async (): Promise<BudgetInfo> => {
      // ① 模型真实上下文能力（后端从 pi-ai 目录 / llm-pi-ai 配置读 provider 声明值）
      try {
        const m = await rpApi<{ contextWindow?: unknown }>('rp/model-capability', { sessionId })
        const cw = typeof m.contextWindow === 'number' && m.contextWindow > 0 ? m.contextWindow : undefined
        if (cw !== undefined) return { value: cw, origin: 'model-catalog' }
      } catch { /* 路由不可用 → 降级到预设 */ }
      // ② 预设 maxContext
      try {
        const rg = await thApi<{ presetId?: string | null }>('regexes/get', { sessionId })
        const presetId = rg.presetId ?? ''
        if (presetId !== '') {
          const pl = await rpApi<{ presets?: Array<{ id?: string; preset?: { sampling?: { maxContext?: unknown } } }> }>('preset/list')
          const hit = (pl.presets ?? []).find(x => x.id === presetId)
          const mc = hit?.preset?.sampling?.maxContext
          if (typeof mc === 'number' && Number.isFinite(mc) && mc > 0) return { value: mc, origin: 'preset' }
        }
      } catch { /* 预设不可达 → 占位 */ }
      // ③ 占位（unknown：UI 必须标明）
      return { value: DEFAULT_MAX_CONTEXT, origin: 'unknown' }
    })()
    budgetCache.set(sessionId, p)
  }
  return p
}

export function RpTokenMeter(props: DockProps): JSX.Element | null {
  // 【E2/P-1 W4 收口】id / cwd / blank 三个官方投影字段一律走单源。
  // 此前这里写 `s.blank !== false`（缺失 ⇒ 视为空白 ⇒ 不显示），而
  // `RpStateFloat` 写 `=== true`（缺失 ⇒ 视为非空白 ⇒ 显示）—— 两者**结论相反**，
  // 官方一旦去掉该字段就会出现「浮球在、计量条没了」这种自相矛盾的用户可见症状。
  // 现统一为 readSessionBlank（缺失视为非空白，保守方向，见其头注）。
  const sessionId = readSessionId(props.session)
  const cwd = readSessionCwd(props.session)
  const { slug } = useRpSlug(cwd, sessionId)
  const blank = readSessionBlank(props.session)

  const [chars, setChars] = useState(0)
  const [budgetInfo, setBudgetInfo] = useState<BudgetInfo>({ value: DEFAULT_MAX_CONTEXT, origin: 'unknown' })
  const [panelOpen, setPanelOpen] = useState(false)
  // 【2026-09-14 F4-C3】被回退/编辑/重新生成移出上下文的消息不计入占用
  const mask = useRollbackMaskState(sessionId)
  // ref 供 30s 轮询读取最新掩码（避免把 mask 放进轮询 effect 依赖 → 掩码一变就重建定时器）
  const hiddenRef = useRef<ReadonlySet<number>>(mask.hidden)

  // 会话切换：拉预算（缓存）+ 拉一次文本总量；之后 30s 轮询文本增长。
  // 失败静默保持上次值（估算口径下不闪错；悬浮球面板已承担错误提示职责）。
  useEffect(() => {
    if (!slug || !sessionId || blank) return
    let alive = true
    void fetchBudget(sessionId).then(b => { if (alive) setBudgetInfo(b) })
    const pull = async (): Promise<void> => {
      try {
        const r = await thApi<{ messages?: Array<{ message?: unknown; seq?: unknown }> }>('chat/messages', { sessionId })
        if (alive) setChars(sumMessageChars(r.messages, hiddenRef.current, m => (typeof m.seq === 'number' ? m.seq : undefined)))
      } catch { /* 保持上次值 */ }
    }
    void pull()
    // 【L3 2026-09-14 切后台修复】改走 pollWhileVisible——**页面不可见时真正停表**。
    // 背景（L3 穷举发现）：`visibility.ts` 就是为「切后台不降频」建的（CDP 实测：
    // 可见 12.28 次/秒 vs 切后台 13.10 次/秒，完全不降），但**本处与 RpStateFloat
    // 都漏用了**它（裸 setInterval）⇒ 手机切后台后仍持续轮询，耗电/发烫。
    // pollWhileVisible 语义：不可见 → clearInterval；恢复可见 → 立即补跑一次再起表。
    const stop = pollWhileVisible(() => { void pull() }, POLL_MS)
    return () => { alive = false; stop() }
  }, [slug, sessionId, blank])

  // 掩码变化时立刻重算（不能等 30s 轮询——用户回退后要求「占用立刻下降」是可观测证据）
  useEffect(() => {
    hiddenRef.current = mask.hidden
    if (!slug || !sessionId || blank) return
    let alive = true
    void (async (): Promise<void> => {
      try {
        const r = await thApi<{ messages?: Array<{ message?: unknown; seq?: unknown }> }>('chat/messages', { sessionId })
        if (alive) setChars(sumMessageChars(r.messages, mask.hidden, m => (typeof m.seq === 'number' ? m.seq : undefined)))
      } catch { /* 保持上次值 */ }
    })()
    return () => { alive = false }
  }, [mask, slug, sessionId, blank])

  // 【2026-09-14 F4 真根因 · 设备实测】`useMemo` 原写在下面那行早退**之后** ⇒
  // 「非 RP → RP」（slug 由 null 变有值，靠 /rp/session-cwd 异步补取）时 hook 数
  // 从 4 变 5 ⇒ React error #310「Rendered more hooks than during the previous render」
  // ⇒ 该 slot 条目被宿主 SlotErrorBoundary 捕获，渲染成空 `<div data-slot-error>`。
  // 症状极具欺骗性：**零报错、零白屏**，只是这一条进度条永远不出现
  //（设备实测：同 dock 另外 5 个 RP 组件都在 fiber 树，唯 RpTokenMeter 不在；
  //  `[data-slot-error="conversation.input.dock"]` 命中）。
  // 修法（P-15：hook 调用不得位于任何条件分支/早退之后）：把 hook 全部上移到早退之前，
  // 使 hook 数在每次渲染中恒定。派生值（reading/level/pct…）留在早退后算即可。
  const reading = useMemo(() => buildMeterReading({
    providerTokens: lastRequestTokens(props.session) ?? undefined,
    estimatedTokens: estimateTokens(chars),
    modelContextWindow: budgetInfo.origin === 'model-catalog' ? budgetInfo.value : undefined,
    presetMaxContext: budgetInfo.origin === 'preset' ? budgetInfo.value : undefined,
  }), [chars, props.session, budgetInfo])

  if (!slug || !sessionId || blank) return null // 非 RP / 空白会话不显示

  const level = meterLevel(reading.tokens, reading.budget)
  const pct = meterPercent(reading.tokens, reading.budget)
  const exact = isTrustworthy(reading.tokensOrigin)
  const budgetExact = isTrustworthy(reading.budgetOrigin)
  return (
    // 【F4/P-9 2026-09-14 可观测性】把**精确整数**同时落到 data-* 上：
    // ① 用户/排障者可自证「这个数字从哪来、到底多少」（`formatTokens` 会把它压成
    //    `109k` / `1.5M`，M 级精度只剩 100k ⇒ 回退后的小幅下降在 UI 上**看不见**）；
    // ② M5/M7 设备判据据此判定「回退是否在计量上可见」——此前只能比百分比，
    //    在饱和（1.5M/1M）时恒 100% ⇒ 判据**零分辨率**。
    // 这是纯增量的观测面，不改任何既有契约（B10）。
    <div
      className="dsht-rp-tokenmeter"
      data-level={level}
      data-tokens={Math.round(reading.tokens)}
      data-budget={Math.round(reading.budget)}
      data-chars={Math.round(chars)}
      data-tokens-origin={reading.tokensOrigin}
      data-budget-origin={reading.budgetOrigin}
      data-pct={pct.toFixed(4)}
    >
      <button
        type="button"
        className="tm-hit"
        title={`≈ 上下文占用（占用口径：${originLabel(reading.tokensOrigin)}；预算口径：${originLabel(reading.budgetOrigin)}${budgetExact ? '' : '——预算未知，当前为占位值，实际模型上限可能不同'}；点击调节 AI 可见楼层数 / 展开折叠区间）`}
        onClick={() => setPanelOpen(v => !v)}
      >
        <div className="tm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="tm-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="tm-label">
          <span className="tm-num">≈ {formatTokens(reading.tokens)} / {budgetExact ? formatTokens(reading.budget) : `${formatTokens(reading.budget)}?`} tokens</span>
          <span className="tm-tag">{exact ? '真实值' : '估算值'}{budgetExact ? '' : '·预算未知'}</span>
        </div>
      </button>
      {panelOpen && <RpContextPanel sessionId={sessionId} onClose={() => setPanelOpen(false)} />}
    </div>
  )
}
