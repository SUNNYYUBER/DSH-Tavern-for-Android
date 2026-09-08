/**
 * PROJECT_PLAN 补全：世界书条目管理面板（数据面 = dsht-tavern-helper worldbook API）。
 *
 * - /worldbook/list {} → {books:[{name,lorePath}]}：书列表（库内 wb-* skill + 全局书单）；
 * - /worldbook/get {name} → {name,lorePath,entries:[ST World Info 形状]}：条目只读快照；
 * - /worldbook/entry-put {name, entry}：uid（= 数组下标）锚定原位合并回 lore.json。
 *
 * 功能：书列表 → 选书看条目（搜索框按 comment/content/key 过滤、条目级 enabled
 * 开关切换、展开编辑 comment/content/keys 后保存 entry-put）。position/depth 等
 * 高级字段不暴露编辑（ST 触发语义，误改易坏触发）——保存整条回传时原样保留。
 *
 * 挂载点：RpOverlay「世界书」tab（BooksPanel 顶部「条目编辑」按钮拉起，替换总览内容；
 * onBack 返回书总览，onChanged 透传给 BooksPanel 刷新绑定卡条目数）。
 */
import { useEffect, useState, type JSX } from 'react'
import { thApi } from './rpc.ts'
import { loadEjsDisplaySettings } from './display-compiler.ts'
import { CodeTextarea } from './CodeTextarea.tsx'
import { entryEnabled, entryKeys, filterLoreEntries, keysToText, type LoreEntryLike } from './lore-view.ts'

interface WbBook { name: string; lorePath?: string | null }

/** 编辑抽屉的草稿（展开条目时从 ST 条目初始化，保存时合回） */
interface LoreDraft { comment: string; content: string; keys: string; keysSecondary: string }

export function RpLorePanel(props: { onBack?: () => void; onChanged?: () => void }): JSX.Element {
  const { onBack, onChanged } = props
  const [books, setBooks] = useState<WbBook[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [entries, setEntries] = useState<LoreEntryLike[]>([])
  const [query, setQuery] = useState('')
  const [expandedUid, setExpandedUid] = useState<number | null>(null)
  const [draft, setDraft] = useState<LoreDraft | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  // B17：EJS 设置 codeEditor=true 时条目内容换轻量行号编辑器（display-compiler 设置缓存复用）
  const [codeEditor, setCodeEditor] = useState(false)
  useEffect(() => {
    let alive = true
    void loadEjsDisplaySettings().then(s => { if (alive && s !== null) setCodeEditor(s.codeEditor) })
    return () => { alive = false }
  }, [])

  // 书列表（进入面板拉一次）
  useEffect(() => {
    thApi<{ books: WbBook[] }>('worldbook/list', {})
      .then(r => setBooks(r.books ?? []))
      .catch(e => setStatus(`书列表加载失败：${(e as Error).message}`))
  }, [])

  /** 选书/保存后重拉条目（get 永远返回全量，uid = 数组下标稳定） */
  const loadEntries = (name: string): void => {
    thApi<{ entries?: Record<string, unknown>[] }>('worldbook/get', { name })
      .then(r => setEntries((r.entries ?? []) as LoreEntryLike[]))
      .catch(e => setStatus(`条目加载失败：${(e as Error).message}`))
  }

  const openBook = (name: string): void => {
    setSelected(name)
    setEntries([])
    setQuery('')
    setExpandedUid(null)
    setDraft(null)
    setStatus('')
    loadEntries(name)
  }

  /** 保存条目：整条 ST 形状回传（uid 锚定原位），仅覆盖编辑过的字段；成功返回 true */
  const saveEntry = async (entry: LoreEntryLike, patch: Partial<LoreEntryLike>): Promise<boolean> => {
    if (!selected || busy) return false
    setBusy(true)
    setStatus('保存中…')
    try {
      await thApi('worldbook/entry-put', { name: selected, entry: { ...entry, ...patch } })
      setStatus('✓ 已保存（下一轮对话生效）')
      loadEntries(selected)
      onChanged?.()
      return true
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  /** enabled 开关：disabled 取反即存（不动其余字段） */
  const toggleEnabled = (entry: LoreEntryLike): void => {
    void saveEntry(entry, { disabled: !entryEnabled(entry) })
  }

  /** 展开编辑抽屉（草稿从当前条目初始化） */
  const beginEdit = (entry: LoreEntryLike): void => {
    setExpandedUid(entry.uid)
    setDraft({
      comment: String(entry.comment ?? ''),
      content: String(entry.content ?? ''),
      keys: keysToText(entry.key),
      keysSecondary: keysToText(entry.keysecondary),
    })
  }

  const closeEdit = (): void => {
    setExpandedUid(null)
    setDraft(null)
  }

  const visible = filterLoreEntries(entries, query)
  const inBook = selected !== null

  return (
    <div className="dsht-rp-lore">
      {(onBack !== undefined || inBook) && (
        <div className="lore-toolbar">
          <button type="button" className="dsht-rp-btn lore-btn"
            onClick={() => {
              if (inBook) { setSelected(null); setEntries([]); setStatus(''); closeEdit() }
              else onBack?.()
            }}>
            {inBook ? '‹ 书列表' : '‹ 返回书总览'}
          </button>
          {inBook && <strong className="lore-title">{selected}</strong>}
          {inBook && (
            <input
              className="dsht-rp-field lore-search"
              placeholder="搜索 标题/内容/关键词…"
              value={query}
              onChange={e => { setQuery(e.target.value) }}
            />
          )}
        </div>
      )}

      {!inBook && (
        <>
          <p className="dsht-rp-note" style={{ margin: '0 0 12px' }}>
            选择一本世界书编辑它的条目（标题 / 内容 / 关键词、启停开关）。改动直接写回 lore.json，下一轮对话生效。
          </p>
          {books.length === 0 && status === '' && (
            <div className="dsht-rp-empty">书库为空——先在「导入」页导入世界书（或整包迁移 ST 数据）。</div>
          )}
          {books.map(b => (
            <button key={b.lorePath ?? b.name} type="button" className="wb-row" onClick={() => { openBook(b.name) }}>
              <span className="wb-name">{b.name}</span>
              {b.lorePath && <span className="wb-meta">{b.lorePath}</span>}
            </button>
          ))}
        </>
      )}

      {inBook && (
        <>
          {entries.length === 0 && status === '' && <div className="dsht-rp-empty">这本书没有条目。</div>}
          {entries.length > 0 && visible.length === 0 && (
            <div className="dsht-rp-empty">没有匹配「{query}」的条目。</div>
          )}
          {visible.map(entry => {
            const open = expandedUid === entry.uid
            const enabled = entryEnabled(entry)
            const keyText = entryKeys(entry.key).join('、')
            return (
              <div key={entry.uid} className="lore-entry" data-disabled={!enabled || undefined}>
                <div className="lore-entry-head">
                  <label className="rx-toggle" title={enabled ? '点击停用' : '点击启用'}>
                    <input type="checkbox" checked={enabled} disabled={busy}
                      onChange={() => { toggleEnabled(entry) }} />
                    <span />
                  </label>
                  <button type="button" className="lore-name" title="点击展开编辑"
                    onClick={() => { open ? closeEdit() : beginEdit(entry) }}>
                    {String(entry.comment ?? '') !== '' ? String(entry.comment) : `#${entry.uid}（无标题）`}
                  </button>
                  <span className="wb-meta">
                    {keyText !== '' ? `🔑 ${keyText}` : ''}
                    {entry.constant === true ? ' · 常驻' : ''}
                  </span>
                </div>
                {open && draft !== null && (
                  <div className="lore-editor">
                    <label className="pe-field"><span>标题（comment）</span>
                      <input className="dsht-rp-field" value={draft.comment}
                        onChange={e => { setDraft({ ...draft, comment: e.target.value }) }} />
                    </label>
                    <label className="pe-field"><span>主关键词（逗号分隔）</span>
                      <input className="dsht-rp-field" value={draft.keys}
                        onChange={e => { setDraft({ ...draft, keys: e.target.value }) }} />
                    </label>
                    <label className="pe-field"><span>次关键词（可选，逗号分隔）</span>
                      <input className="dsht-rp-field" value={draft.keysSecondary}
                        onChange={e => { setDraft({ ...draft, keysSecondary: e.target.value }) }} />
                    </label>
                    <label className="pe-field"><span>内容（content）</span>
                      {codeEditor
                        // B17：轻量行号编辑器（EJS 标签行提示 + Tab 缩进；10 行起，随内容自适应加高）
                        ? <CodeTextarea
                          value={draft.content}
                          onChange={next => { setDraft({ ...draft, content: next }) }}
                          rows={Math.max(10, Math.min(24, draft.content.split('\n').length + 1))}
                          ariaLabel="世界书条目内容"
                        />
                        : <textarea className="dsht-rp-field lore-content" rows={5} value={draft.content}
                          onChange={e => { setDraft({ ...draft, content: e.target.value }) }} />}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="dsht-rp-btn" style={{ height: 30, fontSize: 13 }} disabled={busy}
                        onClick={() => {
                          void saveEntry(entry, {
                            comment: draft.comment,
                            content: draft.content,
                            key: entryKeys(draft.keys),
                            keysecondary: entryKeys(draft.keysSecondary),
                          }).then(ok => { if (ok) closeEdit() })
                        }}>保存条目</button>
                      <button type="button" className="dsht-rp-btn"
                        style={{ height: 30, fontSize: 13, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)' }}
                        onClick={closeEdit}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {status && <p className="dsht-rp-note" style={{ marginTop: 10 }}>{status}</p>}
    </div>
  )
}
