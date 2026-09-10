/**
 * 消息搜索面板（PROJECT_PLAN §4.15「消息搜索：虚拟列表配套」前端形态）。
 *
 * - 数据面：POST /dsht-tavern-helper/chat/messages {sessionId} 全量拉一次 →
 *   本地过滤（search-core.ts 纯函数）；输入去抖 300ms；大小写不敏感；上限 50 条。
 * - 结果项：楼层号（message_id，0 起，展示 +1 对齐"第 n 楼"直觉）+ 角色名 +
 *   命中片段上下文（命中词前后各 ~40 字，命中词 <mark> 高亮）。
 * - 点击结果项 = 在面板内展开该消息完整文本（命中词全文高亮）。
 *   【诚实降级，不做滚动定位】官方 ChatView 的滚动容器不受本插件控制
 *   （无 DOM 契约、虚拟列表窗口化），"跳转到原楼层"无法可靠实现——注释与
 *   UI 均只承诺"展开查看"，不承诺定位。
 * - 挂载：悬浮球面板（RpStateFloat）头部「🔍 搜索」按钮拉起（与「查看状态」
 *   同款式，侵入最小的独立 overlay）；本组件不判 slug/会话有效性，由挂载方保证。
 */
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { thApi } from './rpc.ts'
import {
  SEARCH_RESULT_LIMIT,
  searchMessages,
  splitHighlight,
  type SearchableMessage,
} from './search-core.ts'

/** 输入去抖（ms） */
const DEBOUNCE_MS = 300

export function RpSearchPanel(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const { sessionId, onClose } = props
  const [messages, setMessages] = useState<SearchableMessage[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时全量拉一次聊天记录（只读导出面；搜索期间不再拉——快照语义）
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    thApi<{ messages: SearchableMessage[] }>('chat/messages', { sessionId })
      .then(r => { if (alive) { setMessages(r.messages ?? []); setError('') } })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [sessionId])

  // 输入去抖 300ms（防长会话逐键全量扫描）
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(query) }, DEBOUNCE_MS)
    return () => { clearTimeout(t) }
  }, [query])

  // Esc 关闭（面板级快捷键，与原生浮层习惯一致）
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent): void => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  // 挂载即聚焦输入框（搜索优先交互）
  useEffect(() => { inputRef.current?.focus() }, [])

  // 【T-34 2026-09-11】`messages` 的初值是 `null`（未加载完），而 searchMessages 的形参
  // 契约是 `… | undefined`（内部 `messages ?? []` 已含空值语义）。传 null 在运行时无害，
  // 但类型上不匹配 → 统一归一为 undefined（与 64 行的 `messages ?? []` 口径一致）。
  const hits = useMemo(() => searchMessages(messages ?? undefined, debounced), [messages, debounced])
  const expanded = useMemo(
    () => (expandedId === null ? null : (messages ?? []).find(m => m.message_id === expandedId) ?? null),
    [messages, expandedId],
  )

  const onKeyDown = (ev: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === 'Enter') { ev.preventDefault(); setDebounced(query) } // 回车跳过去抖立即出结果
  }

  return (
    <div className="dsht-rp-searchview-mask" role="dialog" aria-label="消息搜索" onClick={onClose}>
      <div className="dsht-rp-searchview" onClick={e => { e.stopPropagation() }}>
        <div className="sv-head">
          <span>🔍 消息搜索</span>
          <span className="sv-head-actions">
            <button type="button" className="sf-btn" aria-label="关闭" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="se-searchbar">
          <input
            ref={inputRef}
            className="dsht-rp-field se-input"
            type="text"
            placeholder="搜索消息文本（大小写不敏感）…"
            value={query}
            onChange={e => { setQuery(e.target.value); setExpandedId(null) }}
            onKeyDown={onKeyDown}
          />
          {debounced !== '' && !error && messages !== null && (
            <span className="se-count">
              {hits.length} 条{hits.length >= SEARCH_RESULT_LIMIT ? '（已达上限）' : ''}
            </span>
          )}
        </div>
        <div className="sv-body se-body">
          {error && <div className="sv-error">聊天记录拉取失败：{error}</div>}
          {!error && messages === null && <div className="sv-empty">加载中…</div>}
          {!error && messages !== null && debounced === '' && (
            <div className="sv-empty">输入关键词搜索本会话的全部消息。</div>
          )}
          {!error && messages !== null && debounced !== '' && hits.length === 0 && (
            <div className="sv-empty">没有匹配「{debounced}」的消息。</div>
          )}
          {hits.map(h => (
            <button
              key={h.messageId}
              type="button"
              className="se-hit"
              aria-expanded={expandedId === h.messageId}
              onClick={() => { setExpandedId(cur => (cur === h.messageId ? null : h.messageId)) }}
            >
              <span className="se-hit-head">
                <span className="se-floor">#{h.messageId + 1}</span>
                <span className="se-name">{h.name}</span>
                <span className="se-role">{h.role === 'user' ? '用户' : '角色'}</span>
              </span>
              <span className="se-snippet">
                {h.snippet.headCut && <span className="se-ellipsis">…</span>}
                <span>{h.snippet.before}</span>
                <mark className="se-mark">{h.snippet.match}</mark>
                <span>{h.snippet.after}</span>
                {h.snippet.tailCut && <span className="se-ellipsis">…</span>}
              </span>
              {/* 点击结果项 = 展开完整文本（不做滚动定位：官方 ChatView 滚动容器不受控） */}
              {expandedId === h.messageId && expanded !== null && (
                <span className="se-full">
                  {splitHighlight(expanded.message, debounced).map((seg, i) =>
                    seg.hit ? <mark key={i} className="se-mark">{seg.t}</mark> : <span key={i}>{seg.t}</span>,
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
