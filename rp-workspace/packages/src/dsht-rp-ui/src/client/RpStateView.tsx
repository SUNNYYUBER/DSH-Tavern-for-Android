/**
 * PROJECT_PLAN 补全：状态查看双视图面板（表格 / JSON）。
 *
 * - 数据面：POST /dsht-rp/state {sessionId} → {state}（MVU 状态树，只读；
 *   与 RpStateFloat 同一路由，写侧走聊天/变量面板）。
 * - 表格视图：递归键值树（state-view.ts 的 flattenStateTree 铺平成行），
 *   嵌套容器可点击折叠/展开（折叠集合记忆本次打开的选择，打开时默认全展开）；
 * - JSON 视图：只读格式化文本（JSON.stringify 2 空格缩进）；
 * - 挂载：RpStateFloat 悬浮球面板头部「查看状态」按钮拉起（侵入最小的独立
 *   overlay）——本组件不判 slug/会话有效性，由挂载方保证 sessionId 是 RP 会话。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { rpApi } from './rpc.ts'
import { flattenStateTree, formatStateJson, toggleCollapsed, type StateRow } from './state-view.ts'

export function RpStateView(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const { sessionId, onClose } = props
  const [state, setState] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'table' | 'json'>('table')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // 打开时拉一次 + 「刷新」手动重拉（悬浮球面板已有 4s 轮询，这里一次快照够用）
  const fetchState = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      const r = await rpApi<{ state: Record<string, unknown> }>('state', { sessionId })
      setState(r.state ?? {})
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sessionId])
  useEffect(() => { void fetchState() }, [fetchState])

  // 【2026-09-13 修复·键盘不可达（F-2）】补 Esc 关闭（与 RpSearchPanel 同款）——
  // 弹层只有 ✕ / 点遮罩两种关法，键盘用户无法退出。
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent): void => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const rows: StateRow[] = state === null ? [] : flattenStateTree(state, collapsed)
  const hasState = state !== null && Object.keys(state).length > 0

  return (
    <div className="dsht-rp-stateview-mask" role="dialog" aria-label="状态查看" onClick={onClose}>
      <div className="dsht-rp-stateview" onClick={e => { e.stopPropagation() }}>
        <div className="sv-head">
          <span>📊 状态查看（MVU 变量）</span>
          <span className="sv-head-actions">
            <button type="button" className={`sv-view-btn${view === 'table' ? ' on' : ''}`}
              onClick={() => { setView('table') }}>表格</button>
            <button type="button" className={`sv-view-btn${view === 'json' ? ' on' : ''}`}
              onClick={() => { setView('json') }}>JSON</button>
            <button type="button" className="sf-btn" onClick={() => { void fetchState() }}>刷新</button>
            <button type="button" className="sf-btn" aria-label="关闭" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="sv-body">
          {/* 【2026-09-13 修复·读屏语义 + 重试（F-6）】错误行加 role=status（读屏播报）
              与重试按钮（原只有一句错误文本，用户只能关掉面板重开） */}
          {error && (
            <div className="sv-error" role="status">
              状态拉取失败：{error}
              <button type="button" className="sf-btn" style={{ marginLeft: 8, minHeight: 26 }}
                onClick={() => { void fetchState() }}>重试</button>
            </div>
          )}
          {!error && state === null && <div className="sv-empty">加载中…</div>}
          {!error && !hasState && (
            <div className="sv-empty">（暂无 MVU 状态——这张卡可能不用变量，或还没产生变量更新）</div>
          )}
          {view === 'table' && hasState && (
            <div className="sv-table">
              {rows.map(row => row.leaf ? (
                <div key={row.path === '' ? '(root)' : row.path} className="sv-row" style={{ paddingLeft: row.depth * 14 }}>
                  <span className="sv-key">{row.key}</span>
                  <span className="sv-leaf">{row.valueText}</span>
                </div>
              ) : (
                <button key={row.path} type="button" className="sv-row sv-node" aria-expanded={row.open === true}
                  style={{ paddingLeft: row.depth * 14 }}
                  onClick={() => { setCollapsed(prev => toggleCollapsed(prev, row.path)) }}>
                  <span className="sv-arrow">{row.open ? '▾' : '▸'}</span>
                  <span className="sv-key">{row.key}</span>
                  <span className="sv-count">{row.count} 项</span>
                </button>
              ))}
            </div>
          )}
          {view === 'json' && hasState && (
            <pre className="sv-json">{formatStateJson(state)}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
