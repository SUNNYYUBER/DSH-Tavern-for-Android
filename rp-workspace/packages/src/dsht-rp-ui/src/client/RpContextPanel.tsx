/**
 * RpContextPanel —— 「上下文与记忆」弹出面板（MASTER_TODO §2.3 ④⑤ 前端面，
 * 挂 RpTokenMeter 计量条点击弹出；用户拍板 2026-09-03：token 计量条弹出面板方案）。
 *
 * - ④ AI 可见楼层数即调控件：写 dsht-plugin-memory 设置（保留近M楼原文），
 *   下一轮影子化规划立即生效；「近窗字符预算」同处暴露。
 *   调小 = 下一轮窗口内多余楼层折掉（规划器自动）；调大 = 折叠区间露头部分由
 *   插件 pre-step 窗口核对自动注回（扩张后不主动收回，调小才重整——用户拍板）。
 * - ⑤ 折叠区间「展开给 AI（单次）」：POST /dsht-memory/expand 整段折叠前缀落待办
 *   → 下一轮请求注入区间原文快照，再下一轮自动收回（单次生效）。
 * - 折叠只改模型视图，界面回看零丢失（append-origin 事件流渲染）——面板只管 AI 视野。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { memApi, memGet } from './rpc.ts'

/** GET /dsht-memory/status 返回（dsht-plugin-memory 状态面） */
interface MemStatus {
  sessionId?: string
  cursor?: number
  lastFloor?: number
  foldedUpTo?: number
  enabled?: boolean
  keepNearFloors?: number
  charBudget?: number
  entries?: number
}

/** 步进器范围（步长：楼层数 5、预算 5000） */
const FLOOR_MIN = 0
const FLOOR_MAX = 500
const FLOOR_STEP = 5
const BUDGET_MIN = 5_000
const BUDGET_MAX = 300_000
const BUDGET_STEP = 5_000

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export function RpContextPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }): JSX.Element {
  const [st, setSt] = useState<MemStatus | null>(null)
  const [floors, setFloors] = useState<string>('')
  const [budget, setBudget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await memGet<MemStatus>('status', `sessionId=${encodeURIComponent(sessionId)}`)
      setSt(r)
      setFloors(String(r.keepNearFloors ?? 30))
      setBudget(String(r.charBudget ?? 60_000))
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  // 【2026-09-13 修复·键盘不可达（F-2）】补 Esc 关闭（与 RpSearchPanel 同款）——
  // 面板只有 ✕ / 点背景两种关法，键盘用户无法退出。
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent): void => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  /** 设置写入（部分 patch；中文键与设置界面 Schema 一致） */
  const commit = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const r = await memApi<{ config?: { keepNearFloors?: number; charBudget?: number } }>('settings', patch)
      setSt(prev => ({ ...(prev ?? {}), ...(r.config ?? {}) }))
      setFloors(String(r.config?.keepNearFloors ?? floors))
      setBudget(String(r.config?.charBudget ?? budget))
      setNote('已保存，下一轮生效')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [floors, budget])

  const commitFloors = useCallback((raw: string): void => {
    const n = clamp(Math.floor(Number(raw) || 0), FLOOR_MIN, FLOOR_MAX)
    setFloors(String(n))
    if (st && n !== st.keepNearFloors) void commit({ 保留近M楼原文: n })
  }, [commit, st])

  const commitBudget = useCallback((raw: string): void => {
    const n = clamp(Math.floor(Number(raw) || 0), BUDGET_MIN, BUDGET_MAX)
    setBudget(String(n))
    if (st && n !== st.charBudget) void commit({ 近窗字符预算: n })
  }, [commit, st])

  const expand = useCallback(async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await memApi<{ from?: number; to?: number }>('expand', { sessionId })
      setNote(`已排队：下一轮注入 第 ${r.from}-${r.to} 楼原文（单次生效，再下一轮自动收回）`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [sessionId])

  const cursor = st?.cursor ?? 0
  const folded = st?.foldedUpTo ?? 0
  const visible = Math.max(0, cursor - folded)

  return (
    <>
      <div className="dsht-rp-ctx-backdrop" onClick={onClose} />
      <div className="dsht-rp-ctx-panel" data-testid="dsht-rp-ctx-panel">
        <div className="cp-head">
          <span className="cp-title">上下文与记忆</span>
          <button type="button" className="cp-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="cp-row cp-status">
          游标 第 {cursor} 楼 · 折叠至 第 {folded} 楼 · AI 视野内 {visible} 楼原文
          {folded > 0 ? `（+记忆快照覆盖 第 1-${folded} 楼）` : ''}
        </div>
        <div className="cp-row">
          <span className="cp-label">AI 可见楼层数</span>
          <div className="cp-stepper">
            <button type="button" disabled={busy} onClick={() => commitFloors(String(clamp((Number(floors) || 0) - FLOOR_STEP, FLOOR_MIN, FLOOR_MAX)))}>−</button>
            <input
              value={floors}
              inputMode="numeric"
              disabled={busy}
              onChange={e => setFloors(e.target.value)}
              onBlur={e => commitFloors(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitFloors((e.target as HTMLInputElement).value) }}
            />
            <button type="button" disabled={busy} onClick={() => commitFloors(String(clamp((Number(floors) || 0) + FLOOR_STEP, FLOOR_MIN, FLOOR_MAX)))}>+</button>
          </div>
        </div>
        <div className="cp-row">
          <span className="cp-label">近窗字符预算</span>
          <div className="cp-stepper">
            <button type="button" disabled={busy} onClick={() => commitBudget(String(clamp((Number(budget) || 0) - BUDGET_STEP, BUDGET_MIN, BUDGET_MAX)))}>−</button>
            <input
              value={budget}
              inputMode="numeric"
              disabled={busy}
              onChange={e => setBudget(e.target.value)}
              onBlur={e => commitBudget(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitBudget((e.target as HTMLInputElement).value) }}
            />
            <button type="button" disabled={busy} onClick={() => commitBudget(String(clamp((Number(budget) || 0) + BUDGET_STEP, BUDGET_MIN, BUDGET_MAX)))}>+</button>
          </div>
        </div>
        {folded > 0
          ? (
            <div className="cp-row cp-expand">
              <span className="cp-label">折叠区间 第 1-{folded} 楼</span>
              <button type="button" className="cp-expand-btn" disabled={busy} onClick={() => { void expand() }}>
                展开给 AI（单次）
              </button>
              <div className="cp-hint">下一轮请求注入区间原文；再下一轮自动收回。界面回看不受折叠影响。</div>
            </div>
          )
          : <div className="cp-row cp-hint">该会话暂无折叠区间（上下文较瘦，无需展开）。</div>}
        {/* 【2026-09-13 修复·读屏语义（F-6）】提示行加 role=status，读屏可播报保存/展开结果 */}
        {note !== '' && <div className="cp-row cp-note" role="status">{note}</div>}
        {err !== '' && <div className="cp-row cp-err" role="status">{err}</div>}
      </div>
    </>
  )
}
