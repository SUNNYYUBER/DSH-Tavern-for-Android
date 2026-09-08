/**
 * 任务 B：世界书管理总览（RpOverlay「世界书」tab）。
 *
 * 用户诉求：一个界面管理「哪张角色卡可以用哪些世界书」。此前只有卡片齿轮抽屉里
 * 的单卡绑书 UI，没有总览。
 *
 * 形态（竖屏优先，单列纵向流，书 → 绑定卡 chips）：
 * - 顶部：全局书单区块（rp/global-books.json，R9 产物，「全局生效」标记，只读；
 *   注意全局书在导出时已并入各卡 rp.json.books，所以下面的绑定 chips 也会体现）；
 * - 下面：库内每本书一行（名称 / 条目数 / 已绑 N 张卡），点行展开：
 *   已绑卡 chips（✕ 解绑）+ 未绑卡 chips（＋ 绑定）；
 * - 数据源：既有 /rp/books（增量 entryCount+global）+ /rp/workspaces（rp.json）+
 *   /rp/bind-books（写）；保存后 invalidateWsCache + onChanged 刷新。
 */
import { useEffect, useState } from 'react'
import { rpApi, type RpWorkspaceInfo } from './rpc.ts'
import { invalidateWsCache } from './RpNativeChat.tsx'
import { RpLorePanel } from './RpLorePanel.tsx'

interface BookItem { slug: string; name: string; lorePath: string; entryCount?: number }
interface GlobalBook { name: string; lorePath: string }

export function BooksPanel({ workspaces, onChanged }: {
  workspaces: RpWorkspaceInfo[]
  onChanged: () => void
}): JSX.Element {
  const [library, setLibrary] = useState<BookItem[]>([])
  const [globalBooks, setGlobalBooks] = useState<GlobalBook[]>([])
  const [loadError, setLoadError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  // PROJECT_PLAN 补全：「条目编辑」拉起 RpLorePanel（世界书条目级管理，替换总览内容）
  const [loreOpen, setLoreOpen] = useState(false)

  useEffect(() => {
    rpApi<{ books: BookItem[]; global?: GlobalBook[] }>('rp/books')
      .then(r => {
        setLibrary(r.books ?? [])
        setGlobalBooks(r.global ?? [])
      })
      .catch(e => setLoadError(`书库加载失败：${(e as Error).message}`))
  }, [])

  /** 绑定关系变更：重算该卡的 books 数组 → /rp/bind-books → 失效缓存 + 刷新 */
  const rebind = async (ws: RpWorkspaceInfo, next: Array<{ name: string; lorePath: string }>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus('保存中…')
    try {
      await rpApi('rp/bind-books', { slug: ws.slug, books: next })
      invalidateWsCache()
      setStatus(`✓ 已保存（${ws.name}，下一轮对话生效）`)
      onChanged()
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const unbind = (ws: RpWorkspaceInfo, lorePath: string): void => {
    void rebind(ws, ws.books.filter(b => b.lorePath !== lorePath))
  }
  const bind = (ws: RpWorkspaceInfo, book: BookItem): void => {
    void rebind(ws, [...ws.books, { name: book.name, lorePath: book.lorePath }])
  }

  const boundCardsOf = (lorePath: string): RpWorkspaceInfo[] =>
    workspaces.filter(ws => ws.books.some(b => b.lorePath === lorePath))
  const unboundCardsOf = (lorePath: string): RpWorkspaceInfo[] =>
    workspaces.filter(ws => !ws.books.some(b => b.lorePath === lorePath))

  // PROJECT_PLAN 补全：条目编辑模式整体替换总览（hooks 已全部走完，早退合法）
  if (loreOpen) {
    return <RpLorePanel onBack={() => { setLoreOpen(false) }} onChanged={onChanged} />
  }

  return (
    <div className="dsht-rp-books">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" className="dsht-rp-btn" style={{ height: 30, fontSize: 13 }}
          onClick={() => { setLoreOpen(true) }}>📖 条目编辑</button>
      </div>
      <p className="dsht-rp-note" style={{ margin: '0 0 12px' }}>
        这里管理「哪张角色卡可以用哪些世界书」。绑定的书会在聊天里按关键词自动触发；改动下一轮对话生效。
      </p>

      {globalBooks.length > 0 && (
        <div className="dsht-rp-section" style={{ marginBottom: 12 }}>
          <h3>全局生效</h3>
          <div className="desc">以下世界书对所有角色卡生效（来自 ST 全局书单；暂为只读展示）。</div>
          <div className="wb-chips">
            {globalBooks.map(b => <span key={b.lorePath} className="wb-chip wb-chip-global">{b.name}</span>)}
          </div>
        </div>
      )}

      {loadError && <p className="dsht-rp-note">{loadError}</p>}
      {!loadError && library.length === 0 && (
        <div className="dsht-rp-empty">书库为空——先在「导入」页导入世界书（或整包迁移 ST 数据）。</div>
      )}

      {library.map(book => {
        const bound = boundCardsOf(book.lorePath)
        const open = expanded === book.lorePath
        return (
          <div key={book.slug} className="dsht-rp-section wb-book" data-open={open || undefined}>
            <button
              type="button"
              className="wb-row"
              aria-expanded={open}
              onClick={() => { setExpanded(open ? null : book.lorePath) }}
            >
              <span className="wb-name">{book.name}</span>
              <span className="wb-meta">
                {typeof book.entryCount === 'number' ? `${book.entryCount} 条目` : ''}
                {bound.length > 0 ? ` · 已绑 ${bound.length} 张卡` : ' · 未绑定'}
              </span>
            </button>
            {open && (
              <div className="wb-detail">
                {workspaces.length === 0 && <p className="dsht-rp-note">还没有角色卡——先到「导入」页导入。</p>}
                {bound.length > 0 && (
                  <>
                    <p className="dsht-rp-note">已绑定（点 ✕ 解绑）：</p>
                    <div className="wb-chips">
                      {bound.map(ws => (
                        <button
                          key={ws.slug} type="button" className="wb-chip wb-chip-bound" disabled={busy}
                          aria-label={`解绑 ${ws.name}`} title="点击解绑"
                          onClick={() => { unbind(ws, book.lorePath) }}
                        >{ws.name} ✕</button>
                      ))}
                    </div>
                  </>
                )}
                {unboundCardsOf(book.lorePath).length > 0 && (
                  <>
                    <p className="dsht-rp-note" style={{ marginTop: 8 }}>可绑定（点 ＋ 绑定到该卡）：</p>
                    <div className="wb-chips">
                      {unboundCardsOf(book.lorePath).map(ws => (
                        <button
                          key={ws.slug} type="button" className="wb-chip" disabled={busy}
                          aria-label={`绑定到 ${ws.name}`} title="点击绑定"
                          onClick={() => { bind(ws, book) }}
                        >{ws.name} ＋</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      {status && <p className="dsht-rp-note" style={{ marginTop: 10 }}>{status}</p>}
    </div>
  )
}
