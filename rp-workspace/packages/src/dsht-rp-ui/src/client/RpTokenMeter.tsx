/**
 * token 上下文进度条（PROJECT_PLAN §7 措施 8「token 计量暴露」前端形态 +
 * §4.15「token 上下文进度条：输入区常驻"当前上下文占比"条」）。
 *
 * 【口径定案（2026-09-03 真实 usage 收口）——优先「provider 真实值」】
 * - 会话快照（dock 席位 props.session.chat）的最后一条 assistant 消息自带
 *   provider usage（inputTokens/cacheReadTokens/cacheWriteTokens）——总请求
 *   prompt = 三者之和（dsh-token-meter ContextPressureProjection.pressureTokens
 *   同口径）。首轮回复落地前无 usage → 回落「字符量估算」（总字数 ÷ 2.5），
 *   标签「估算值」；有 usage 后标签「真实值」。
 * - 预算 = 会话有效预设 sampling.maxContext（thApi regexes/get 解析 presetId →
 *   rpApi preset/list 全量 RPPreset 含 sampling），解析不到用固定 16384 缺省。
 * - 字符估算只计对话文本：世界书注入/预设骨架/状态摘要未计入 → 显示为低估，
 *   UI 明示「估算值」。
 *
 * 挂载：conversation.input.dock 席位 order 51（dock 序列最末 = 紧贴 composer
 * 输入框上方的常驻细条；官方输入区本身无更细的挂载点）。仅 RP 会话且已有消息时
 * 显示（与悬浮球同门槛，非 RP 会话零影响）。30s 轮询（生成中文本增长即见；
 * 失败保持上次值不闪空）。
 * §2.3 ④⑤（2026-09-03）：计量条可点击 → 弹出「上下文与记忆」面板（RpContextPanel）：
 * AI 可见楼层数/近窗字符预算调节 + 折叠区间「展开给 AI（单次）」。
 */
import { useEffect, useState, type JSX } from 'react'
import { rpApi, thApi } from './rpc.ts'
import { useRpSlug } from './RpStateFloat.tsx'
import { RpContextPanel } from './RpContextPanel.tsx'
import {
  DEFAULT_MAX_CONTEXT,
  estimateTokens,
  formatTokens,
  meterLevel,
  meterPercent,
  sumMessageChars,
} from './token-meter-core.ts'

/** dock 席位 owner props（InputZone 快照；字段按运行时形态防御性读取） */
interface DockProps {
  session?: unknown
  input?: unknown
}

interface SessionLike {
  sessionId?: string
  id?: string
  header?: { cwd?: string }
  cwd?: string
  /** 宿主 SessionSnapshot.blank（fiber 实证 2026-09-06）：true=空会话。旧 chat/surface 字段不存在。 */
  blank?: boolean
}

/** 真实 usage 口径（§2.2 附带项收口）：会话快照里最后一条 assistant 消息的
 *  provider usage——总请求 prompt = inputTokens（未缓存）+ cacheRead + cacheWrite
 *  （dsh-token-meter ContextPressureProjection.pressureTokens 同口径）。
 *  usage 缺席（尚无回复/旧会话）→ null，回落字符量估算。
 *  【2026-09-06】宿主 SessionSnapshot 无 chat 投影（fiber 实证）→ 快照 usage 面恒 null，
 *  恒走字符量估算（「估算值」标签）；chat/messages RPC 不回 usage，真实口径等宿主补投影。 */
function lastRequestTokens(_session: SessionLike): number | null {
  return null
}

/** 轮询间隔（ms）：30s 足够"进度条随对话推进"，又不会让大日志常被整扫 */
const POLL_MS = 30_000

/** 会话预算缓存（页面生命周期内每会话解析一次；预算随预设切换的场景极少，可忽略） */
const budgetCache = new Map<string, Promise<number>>()

/**
 * 会话上下文预算：regexes/get {sessionId} → {presetId} → preset/list 里找该预设的
 * sampling.maxContext。任一步失败/字段缺失回落 DEFAULT_MAX_CONTEXT（16384）。
 * 注：/context 的 chatCompletionSettings 只有 prompts/prompt_order，无 sampling。
 */
function fetchBudget(sessionId: string): Promise<number> {
  let p = budgetCache.get(sessionId)
  if (p === undefined) {
    p = (async (): Promise<number> => {
      try {
        const rg = await thApi<{ presetId?: string | null }>('regexes/get', { sessionId })
        const presetId = rg.presetId ?? ''
        if (!presetId) return DEFAULT_MAX_CONTEXT
        const pl = await rpApi<{ presets?: Array<{ id?: string; preset?: { sampling?: { maxContext?: unknown } } }> }>('preset/list')
        const hit = (pl.presets ?? []).find(x => x.id === presetId)
        const mc = hit?.preset?.sampling?.maxContext
        return typeof mc === 'number' && Number.isFinite(mc) && mc > 0 ? mc : DEFAULT_MAX_CONTEXT
      } catch {
        return DEFAULT_MAX_CONTEXT // 任一步失败：固定缺省，进度条照常工作
      }
    })()
    budgetCache.set(sessionId, p)
  }
  return p
}

export function RpTokenMeter(props: DockProps): JSX.Element | null {
  const s = (props.session ?? {}) as SessionLike
  const sessionId = s.sessionId ?? s.id ?? ''
  const cwd = s.header?.cwd ?? s.cwd
  const { slug } = useRpSlug(cwd, sessionId)
  // 【2026-09-06 实证修复】同 RpStateFloat：chat 字段不存在 → blank 判空（false=有消息才显示）
  const blank = s.blank !== false

  const [chars, setChars] = useState(0)
  const [budget, setBudget] = useState<number>(DEFAULT_MAX_CONTEXT)
  const [panelOpen, setPanelOpen] = useState(false)

  // 会话切换：拉预算（缓存）+ 拉一次文本总量；之后 30s 轮询文本增长。
  // 失败静默保持上次值（估算口径下不闪错；悬浮球面板已承担错误提示职责）。
  useEffect(() => {
    if (!slug || !sessionId || blank) return
    let alive = true
    void fetchBudget(sessionId).then(b => { if (alive) setBudget(b) })
    const pull = async (): Promise<void> => {
      try {
        const r = await thApi<{ messages?: Array<{ message?: unknown }> }>('chat/messages', { sessionId })
        if (alive) setChars(sumMessageChars(r.messages))
      } catch { /* 保持上次值 */ }
    }
    void pull()
    const timer = setInterval(() => { void pull() }, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [slug, sessionId, blank])

  if (!slug || !sessionId || blank) return null // 非 RP / 空白会话不显示

  const tokens = estimateTokens(chars)
  const real = lastRequestTokens(s)
  const shown = real ?? tokens
  const level = meterLevel(shown, budget)
  const pct = meterPercent(shown, budget)
  return (
    <div className="dsht-rp-tokenmeter" data-level={level}>
      <button
        type="button"
        className="tm-hit"
        title={real !== null
          ? '≈ 上下文占用（真实 provider usage：最近一次请求的 prompt 实测值；点击调节 AI 可见楼层数 / 展开折叠区间）'
          : '≈ 上下文占用（字符量估算：总字数 ÷ 2.5，首轮回复落地后改显 provider 真实 usage；点击调节 AI 可见楼层数 / 展开折叠区间）'}
        onClick={() => setPanelOpen(v => !v)}
      >
        <div className="tm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="tm-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="tm-label">
          <span className="tm-num">≈ {formatTokens(shown)} / {formatTokens(budget)} tokens</span>
          <span className="tm-tag">{real !== null ? '真实值' : '估算值'}</span>
        </div>
      </button>
      {panelOpen && <RpContextPanel sessionId={sessionId} onClose={() => setPanelOpen(false)} />}
    </div>
  )
}
