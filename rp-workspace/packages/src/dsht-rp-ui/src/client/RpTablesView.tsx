/**
 * E6：剧情表格只读渲染面板（st-memory-enhancement 表格系统移植——前端最小面）。
 *
 * - 数据面：GET /dsht-memory/tables?sessionId= → {sheets: Sheet[]}（dsht-plugin-memory
 *   数据面；服务端已做 ST 1.0 旧键 tableData/tables 的自动迁移，这里只消费 Sheet[]）。
 * - 渲染：每张表一个折叠区块（顶部折叠行，默认展开；只读，不提供编辑——写侧走
 *   tableEdit 指令/step-summary 路由）。
 * - 挂载：RpStateFloat 悬浮球面板头部「表格」按钮拉起（与 RpStateView/RpSearchPanel
 *   同款式 overlay）——本组件不判 slug/会话有效性，由挂载方保证 sessionId 是 RP 会话。
 *   样式复用 sv-* 类（状态查看面板同源），表格本体用内联样式（不新增全局 CSS）。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { memGet } from './rpc.ts'
import { useEscapeClose } from './a11y-props.ts'

/** Sheet 最小面（与 dsht-plugin-memory/tables.ts E1 同形） */
interface Sheet {
  uid: string
  name: string
  headers: string[]
  rows: string[][]
  enabled: boolean
}

const cellStyle = {
  border: '1px solid var(--dsw-alias-border-l1)',
  padding: '4px 8px',
  fontSize: 12,
  textAlign: 'left' as const,
  verticalAlign: 'top' as const,
  color: 'var(--dsw-alias-label-primary)',
  // 【2026-09-13 修复·长单元格撑破面板（E-5 同族）】表格 width:100% 但长内容（长 URL /
  // 无空格长串）会把单元格撑到超出面板宽度 ⇒ 整表溢出、右侧列不可见。允许在任意字符处断行。
  wordBreak: 'break-word' as const,
  overflowWrap: 'anywhere' as const,
}

export function RpTablesView(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const { sessionId, onClose } = props
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [error, setError] = useState('')
  // 顶部折叠行：记录被折叠的表 uid（默认全展开）
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const fetchSheets = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      const r = await memGet<{ sheets: Sheet[] }>('tables', `sessionId=${encodeURIComponent(sessionId)}`)
      setSheets(Array.isArray(r.sheets) ? r.sheets : [])
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sessionId])
  useEffect(() => { void fetchSheets() }, [fetchSheets])

  // 【2026-09-13 修复·键盘不可达（F-2）】补 Esc 关闭。
  // 【W8 2026-09-15】原为就地实现（4 个面板各一份逐字相同）；现收口到单源 hook。
  useEscapeClose(onClose)

  const toggle = (uid: string): void => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const active = (sheets ?? []).filter(s => s.enabled)

  return (
    <div className="dsht-rp-stateview-mask" role="dialog" aria-label="剧情表格" onClick={onClose}>
      <div className="dsht-rp-stateview" onClick={e => { e.stopPropagation() }}>
        <div className="sv-head">
          <span>📋 剧情表格</span>
          <span className="sv-head-actions">
            <button type="button" className="sf-btn" onClick={() => { void fetchSheets() }}>刷新</button>
            <button type="button" className="sf-btn" aria-label="关闭" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="sv-body">
          {/* 【2026-09-13 修复·读屏语义 + 重试（F-6）】错误行加 role=status 与重试按钮 */}
          {error && (
            <div className="sv-error" role="status">
              表格拉取失败：{error}
              <button type="button" className="sf-btn" style={{ marginLeft: 8, minHeight: 26 }}
                onClick={() => { void fetchSheets() }}>重试</button>
            </div>
          )}
          {!error && sheets === null && <div className="sv-empty">加载中…</div>}
          {!error && sheets !== null && active.length === 0 && (
            <div className="sv-empty">（本会话暂无启用表格——表格由剧情/指令逐步生成）</div>
          )}
          {active.map(s => {
            const isCollapsed = collapsed.has(s.uid)
            return (
              <div key={s.uid} style={{ marginBottom: 12 }}>
                {/* 顶部折叠行（点击切换；▾ 展开 / ▸ 折叠） */}
                <button type="button" className="sv-row sv-node" aria-expanded={!isCollapsed}
                  style={{ display: 'flex', width: '100%' }}
                  onClick={() => { toggle(s.uid) }}>
                  <span className="sv-arrow">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="sv-key">{s.name}</span>
                  <span className="sv-count">{s.rows.length} 行 · {s.headers.length} 列</span>
                </button>
                {!isCollapsed && s.headers.length > 0 && (
                  <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 4 }}>
                    <thead>
                      <tr>
                        {s.headers.map((h, i) => <th key={i} style={{ ...cellStyle, fontWeight: 600 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((row, ri) => (
                        <tr key={ri}>
                          {s.headers.map((_, ci) => <td key={ci} style={cellStyle}>{row[ci] ?? ''}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
