/**
 * RP 启动器（shell.overlay 席位）：角色宫格 / 导入 / API 连接。
 *
 * 架构定案（用户裁决）：本插件只做「启动器 + 管理面板」——点击角色卡 =
 * 打开原生 DSH session（conversation 主视图接管一切：原生气泡流/输入栏/
 * 流式/会话树）。迁移的聊天文件早已转换为 session 历史（一卡一工作区 cwd
 * 分组），点卡即续聊；世界书触发与开场白注入在 dsht-rp-plugin 的 pre-step。
 * 禁止在本插件里自建聊天 UI。
 */
import { useCallback, useEffect, useState } from 'react'
import { dshRpc, isServiceUnavailable, rpApi, type RpWorkspaceInfo } from './rpc.ts'
import { RegexPanel } from './RegexPanel.tsx'
import { PresetPanel } from './PresetPanel.tsx'
import { BooksPanel } from './BooksPanel.tsx'
import { MigrationStatusPanel } from './MigrationStatusPanel.tsx'
import { UpdatePanel } from './UpdatePanel.tsx'
import { PersonaPanel } from './PersonaPanel.tsx'
import { SessionsPanel } from './SessionsPanel.tsx'
import { invalidateWsCache } from './RpNativeChat.tsx'

type Tab = 'chars' | 'import' | 'books' | 'regex' | 'preset' | 'persona' | 'sessions'

/** overlay 开关的全局事件（sidebar 按钮与 overlay 组件解耦） */
export const RP_OPEN_EVENT = 'dsht-rp-ui:open'

/** apply(ctx) 注入的原生通道（组件永远拿不到 ctx，只拿回调） */
export interface RpOverlayInjected {
  /** 原生会话打开（ctx.sessions.open）：conversation 主视图接管 */
  openSession: (sessionId: string) => Promise<void>
  /** T2.11 补：导入完成后的侧边栏刷新（workspace.create 注册 + rename + sessions.refresh）。
   * 元素可为绝对路径字符串，或 {path, name}（消费批次 1 ExportResult.workspaces 的卡名） */
  refreshSidebar?: (workspaces: Array<string | { path: string; name?: string }>) => Promise<void>
  /** R21 会话管理：官方 workspaces.archiveSession（进程内直调；归档 = 侧边栏隐藏、数据保留） */
  archiveSession?: (sessionId: string) => Promise<void>
}

interface SessionListItem { sessionId: string; cwd?: string; updatedAt?: number; blank?: boolean }

/** DSH workspace.list 条目（WorkspaceView 最小面：path 末段 = rp slug，title = 卡名） */
interface DshWorkspaceItem { workspaceId: string; path: string; title: string }

/** R6：workspace path → rp slug（路径含 /rp/ 且末段即 slug；非 RP 工作区返回 null） */
function rpSlugOf(path: string): string | null {
  const m = path.replace(/\\/g, '/').match(/\/rp\/([^/]+)\/?$/)
  return m ? (m[1] ?? null) : null
}

/**
 * PROJECT_PLAN 补全：备选开场白区块（角色卡详情）。
 *
 * 数据 = ws.alternateGreetings（/rp/workspaces 读 card.json 的
 * data.alternate_greetings / alternate_greetings 增补）。每条配「以此开场重新开始」：
 * 新建空白 session → /rp/open-chat {slug, sessionId, greeting} 物化选中开场白
 * （复用既有开场白路由，greeting 为本功能新增的可选覆写，宏替换/落盘语义与
 * firstMes 一致）→ 原生打开。不影响现有会话。
 * 卡只有 firstMes 无备选（或旧插件缺字段）时不渲染本区块。
 */
function AlternateGreetingsBlock({ ws, openSession, onClose }: {
  ws: RpWorkspaceInfo
  openSession: (sessionId: string) => Promise<void>
  onClose: () => void
}): JSX.Element | null {
  const greetings = (ws.alternateGreetings ?? []).filter(g => g.trim() !== '')
  const [busyIdx, setBusyIdx] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  if (greetings.length === 0) return null

  const restart = async (greeting: string, idx: number): Promise<void> => {
    if (busyIdx !== null) return
    setBusyIdx(idx)
    setStatus('新建会话中…')
    try {
      const home = await rpApi<{ dshHome: string }>('rp/home')
      // 【实机测试修复 2026-09-05】rc.7 typert 校验 args={request:{cwd}}——裸 {cwd} 被
      // "missing request / unexpected cwd" 拒（与下方主路径同款形状；漏改的备选开场白路径）
      const created = await dshRpc<{ sessionId: string }>('session.create', {
        request: { cwd: `${home.dshHome}/rp/${ws.slug}` },
      })
      await rpApi('rp/open-chat', { slug: ws.slug, sessionId: created.sessionId, greeting })
      await openSession(created.sessionId)
      onClose()
    } catch (e) {
      // 【心跳 59 · T-57】同主路径：服务暂不可用给可操作提示（见 launchChar 的注释）
      setStatus(isServiceUnavailable(e)
        ? '以此开场失败：宿主会话服务暂时不可用（稍等片刻自行恢复）——请重试。'
        : `以此开场失败：${(e as Error).message}`)
      setBusyIdx(null)
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <p className="dsht-rp-note" style={{ marginBottom: 6 }}>
        备选开场白（{greetings.length} 条）——选一条以此开场重新开始（新会话，不影响现有聊天）：
      </p>
      {greetings.map((g, i) => (
        <div key={i} className="dsht-rp-altgreet">
          <div className="ag-text">{g}</div>
          <button type="button" className="dsht-rp-btn" style={{ height: 26, fontSize: 12, alignSelf: 'flex-start' }}
            disabled={busyIdx !== null}
            onClick={() => { void restart(g, i) }}>
            {busyIdx === i ? '开台中…' : '以此开场重新开始'}
          </button>
        </div>
      ))}
      {status && <p className="dsht-rp-note" style={{ marginTop: 6 }}>{status}</p>}
    </div>
  )
}

/** T2.6：角色详情（世界书重绑定）——ST 后期换书的归属位 */
function CardDetailDrawer({ ws, openSession, onClose, onSaved }: {
  ws: RpWorkspaceInfo
  openSession: (sessionId: string) => Promise<void>
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [library, setLibrary] = useState<Array<{ slug: string; name: string; lorePath: string }>>([])
  const [bound, setBound] = useState<Set<string>>(new Set(ws.books.map(b => b.lorePath)))
  const [status, setStatus] = useState('')

  useEffect(() => {
    void rpApi<{ books: Array<{ slug: string; name: string; lorePath: string }> }>('rp/books')
      .then(r => setLibrary(r.books ?? []))
      .catch(e => setStatus(`书库加载失败：${(e as Error).message}`))
  }, [])

  const save = async (): Promise<void> => {
    setStatus('保存中…')
    try {
      const books = library.filter(b => bound.has(b.lorePath)).map(b => ({ name: b.name, lorePath: b.lorePath }))
      await rpApi('rp/bind-books', { slug: ws.slug, books })
      setStatus('✓ 已保存（下一轮对话生效）')
      onSaved()
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="dsht-rp-drawer-mask" role="dialog" aria-label={`${ws.name} 详情`}>
      <div className="dsht-rp-drawer">
        <div className="dsht-rp-drawer-head">
          <div style={{ fontSize: 15, fontWeight: 600 }}>{ws.name} · 世界书绑定</div>
          <button type="button" className="dsht-rp-back" aria-label="关闭" onClick={() => { onClose() }}>✕</button>
        </div>
        <div className="dsht-rp-drawer-body">
          {/* PROJECT_PLAN 补全：备选开场白（无备选自动隐藏） */}
          <AlternateGreetingsBlock ws={ws} openSession={openSession} onClose={onClose} />
          <p className="dsht-rp-note" style={{ marginBottom: 10 }}>勾选该角色对话中激活的世界书（ST「后期换书」语义；关键词自动触发）。</p>
          {library.length === 0 && <p className="dsht-rp-note">书库为空——先在「导入」页导入世界书。</p>}
          {library.map(b => (
            <label key={b.slug} className="rx-check" style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
              <input type="checkbox" checked={bound.has(b.lorePath)} onChange={() => {
                setBound(prev => {
                  const next = new Set(prev)
                  if (next.has(b.lorePath)) next.delete(b.lorePath)
                  else next.add(b.lorePath)
                  return next
                })
              }} />
              <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>{b.name}</span>
            </label>
          ))}
          {status && <p className="dsht-rp-note" style={{ marginTop: 8 }}>{status}</p>}
        </div>
        <div className="dsht-rp-drawer-foot">
          <CardExportBlock ws={ws} />
          <button type="button" className="dsht-rp-btn" onClick={() => { void save() }}>保存绑定</button>
        </div>
      </div>
    </div>
  )
}

/** T3.1b 下载 base64 → 触发浏览器下载（前端双通道：anchor blob + Android 系统分享备选） */
function downloadBase64(filename: string, base64: string): void {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch (e) {
    console.error('[dsht-rp-ui] download failed', e)
  }
}

/** T3.1b 角色详情导出（ST 兼容 PNG 卡 / 原生卡包目录） */
function CardExportBlock({ ws }: { ws: RpWorkspaceInfo }): JSX.Element {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const doExportPng = async (): Promise<void> => {
    setBusy(true); setStatus('打包 ST PNG 卡…')
    try {
      const r = await rpApi<{ filename: string; base64: string; hadAvatar: boolean }>('rp/export-card', { slug: ws.slug })
      downloadBase64(r.filename, r.base64)
      setStatus(`✓ 已导出 ${r.filename}${r.hadAvatar ? '' : '（无立绘，用占位图）'}`)
    } catch (e) {
      setStatus(`导出失败：${(e as Error).message}`)
    } finally { setBusy(false) }
  }

  const doExportBundle = async (): Promise<void> => {
    setBusy(true); setStatus('打包卡包目录…')
    try {
      const r = await rpApi<{ files: Array<{ path: string; content: string; binary?: boolean }>; name: string }>('rp/export-bundle', { slug: ws.slug })
      // 逐文件下载（简单可靠；不进 zip 以免依赖）
      for (const f of r.files) downloadBase64(f.path, f.binary ? f.content : btoa(unescape(encodeURIComponent(f.content))))
      setStatus(`✓ 已导出 ${r.files.length} 个文件（${r.name}）`)
    } catch (e) {
      setStatus(`导出失败：${(e as Error).message}`)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ padding: '10px 0' }}>
      <p className="dsht-rp-note" style={{ marginBottom: 8 }}>导出该角色的卡包（ST 兼容 PNG 卡可导入 SillyTavern；卡包目录=本项目原生格式）。</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="dsht-rp-btn" disabled={busy} onClick={() => { void doExportPng() }}>导出 ST PNG 卡</button>
        <button type="button" className="dsht-rp-btn" disabled={busy} onClick={() => { void doExportBundle() }}>导出卡包目录</button>
      </div>
      {status && <p className="dsht-rp-note" style={{ marginTop: 8, color: 'var(--dsw-alias-label-primary)' }}>{status}</p>}
    </div>
  )
}

export function RpOverlay(props: RpOverlayInjected): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('chars')
  const [workspaces, setWorkspaces] = useState<RpWorkspaceInfo[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<RpWorkspaceInfo | null>(null)

  /**
   * R6 数据源收敛：角色列表主数据源 = DSH 原生 workspace.list（title = 卡名，
   * path 含 /rp/ 的工作区）；私有 /rp/workspaces 仅作 rp.json 配置读取
   * （books/outputProtocol/firstMes），两边按 slug（path 末段）join。
   * 对账（每次打开都跑，幂等）：优先 host 侧一次性路由 rp/register-workspaces
   * （扫 rp/ 全量注册 + 存量 cwd 修复 + 会话归组 + st-* 预设同步）；路由不存在
   * （旧插件）时回退逐工作区 refreshSidebar（workspace.create + rename）。
   */
  const loadWorkspaces = useCallback(async () => {
    try {
      invalidateWsCache() // 渲染层协议配置缓存同步失效（迁移/绑书后不重刷页面）
      const rpList = await rpApi<{ workspaces: RpWorkspaceInfo[]; dshHome: string }>('rp/workspaces')
      const configs = rpList.workspaces ?? []
      const merge = (items: DshWorkspaceItem[]): { merged: RpWorkspaceInfo[]; missing: RpWorkspaceInfo[] } => {
        const bySlug = new Map<string, DshWorkspaceItem>()
        for (const it of items) {
          const slug = rpSlugOf(it.path)
          if (slug !== null) bySlug.set(slug, it)
        }
        const merged: RpWorkspaceInfo[] = []
        const missing: RpWorkspaceInfo[] = []
        for (const cfg of configs) {
          const dsh = bySlug.get(cfg.slug)
          if (dsh) merged.push({ ...cfg, name: dsh.title || cfg.name })
          else missing.push(cfg)
        }
        return { merged, missing }
      }
      // 0.1.2 坑 #21：workspace.list 端点已删除（改 workspace/follow 流）——改走插件
      // 数据面 /dsht-rp/workspace-views（进程内 registry 直取，POST /api 免网关）
      const first = await rpApi<{ items: DshWorkspaceItem[] }>('workspace-views')
      let { merged, missing } = merge(first.items ?? [])
      if (missing.length > 0) {
        // 优先：host 侧一次性注册（R14；扫 rp/ 全量，顺带修存量 cwd + 会话归组 + 预设同步）
        let reconciled = false
        try {
          await rpApi('rp/register-workspaces', {})
          reconciled = true
        } catch { /* 旧插件无此路由 → 回退逐个注册 */ }
        if (!reconciled && props.refreshSidebar) {
          try {
            await props.refreshSidebar(missing.map(m => ({ path: `${rpList.dshHome}/rp/${m.slug}`, name: m.name })))
            reconciled = true
          } catch (e) {
            setError(`RP 工作区注册补齐失败：${(e as Error).message}——角色仍可在此打开，但侧边栏可能不可见`)
          }
        }
        if (reconciled) {
          const second = await rpApi<{ items: DshWorkspaceItem[] }>('workspace-views')
          const remerged = merge(second.items ?? [])
          merged = [...remerged.merged, ...remerged.missing]
          if (remerged.missing.length > 0) {
            setError(`以下角色未能注册到 DSH 侧边栏（仍可在此打开）：${remerged.missing.map(m => m.name).join('、')}`)
          }
        } else {
          merged = [...merged, ...missing]
        }
      }
      setWorkspaces(merged)
    } catch (e) {
      console.error('[dsht-rp-ui] load workspaces failed', e)
      setError(`角色列表加载失败：${(e as Error).message}`)
    }
  }, [props])

  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ tab?: Tab }>).detail
      if (detail?.tab) setTab(detail.tab)
      setOpen(true)
    }
    window.addEventListener(RP_OPEN_EVENT, onOpen)
    return () => { window.removeEventListener(RP_OPEN_EVENT, onOpen) }
  }, [])

  useEffect(() => { if (open) void loadWorkspaces() }, [open, loadWorkspaces])

  /**
   * 点击角色卡：找到/创建该工作区的 session → 物化开场白 → 原生 open → 关闭 overlay。
   * fresh=true（「＋ 新开聊天」）：无视已有会话，新开一个带开场白的 session（ST「开始新聊天」同款）。
   */
  const launchChar = useCallback(async (ws: RpWorkspaceInfo, fresh: boolean): Promise<void> => {
    if (opening) return
    setOpening(ws.slug)
    setError(null)
    try {
      const home = await rpApi<{ dshHome: string }>('rp/home')
      let sessionId: string | undefined
      if (!fresh) {
        // 该工作区已有会话（含迁移的聊天历史）→ 取最近一个续聊。
        // cwd 匹配先归一化（Windows 反斜杠 / Android-PC 形态差异）；
        // 空白会话（DSH 启动自动建/上次未发出消息）排后——迁移历史优先续聊
        const r = await dshRpc<{ items: SessionListItem[] }>('session.list', { _request: {} })
        const mine = (r.items ?? [])
          .filter(it => it.cwd?.replace(/\\/g, '/').endsWith(`/rp/${ws.slug}`))
          .sort((a, b) => (Number(a.blank === true) - Number(b.blank === true)) || ((b.updatedAt ?? 0) - (a.updatedAt ?? 0)))
        const best = mine[0]
        // 空白会话：卡有开场白时不复用（新开一个物化开场白的，避免每次点击都开白板）；
        // 卡无开场白则直接复用空白会话。
        if (best && (!best.blank || !ws.firstMes)) sessionId = best.sessionId
      }
      if (!sessionId) {
        // 没有可续会话 → 建一个，开场白物化为首条 assistant 消息。
        // 批次修复 7：不再传 agentPreset——persona 已由后端 pre-step 注入 rp/<slug>/persona.txt
        const created = await dshRpc<{ sessionId: string }>('session.create', {
          request: { cwd: `${home.dshHome}/rp/${ws.slug}` },
        })
        sessionId = created.sessionId
        await rpApi('rp/open-chat', { slug: ws.slug, sessionId })
      }
      await props.openSession(sessionId) // 内部先 refresh 客户端 session 基线再 open
      setOpen(false) // 露出原生 conversation 主视图
    } catch (e) {
      // 【心跳 59 · T-57】区分「宿主服务暂不可用（等一下会自愈）」与其它失败：
      // 前者给可操作的中文提示（而不是把英文诊断原样糊到用户脸上）；
      // 后者（参数错/会话不存在等）保留原始 message 便于定位。
      setError(isServiceUnavailable(e)
        ? '宿主会话服务暂时不可用（通常稍等片刻自行恢复）——请再点一次角色卡重试；若持续不行，重启应用。'
        : `打开失败：${(e as Error).message}`)
    } finally {
      setOpening(null)
    }
  }, [opening, props])

  /**
   * T2.11 补：导入完成后的侧边栏即时刷新——iframe 导入页写盘成功会 postMessage
   * import-done（携带新增工作区绝对路径）。这里调注入的 refreshSidebar（workspace.create
   * 注册 + sessions.refresh），并刷新角色宫格。不刷则侧边栏保持旧快照（旁路写盘无变更事件）。
   */
  const refreshAfterImport = useCallback(async (workspaces: Array<string | { path: string; name?: string }>): Promise<void> => {
    try {
      if (props.refreshSidebar) await props.refreshSidebar(workspaces)
    } catch { /* 刷新失败不阻塞宫格刷新 */ }
    await loadWorkspaces()
  }, [props, loadWorkspaces])

  /**
   * R0：导入管线 agent 化——iframe 上传+kickoff 完成后 postMessage import-kickoff
   * （携带适配工作区 sessionId）。这里刷新 session 基线并跳转：用户直接看
   * harness 干活（原生 session 事件流）。
   */
  const jumpToAdapter = useCallback(async (sessionId: string): Promise<void> => {
    if (!sessionId) return
    try {
      await props.openSession(sessionId)
      setOpen(false) // 露出原生 conversation 主视图
    } catch (e) {
      setError(`跳转会话失败：${(e as Error).message}`)
    }
  }, [props])

  if (!open) return null

  return (
    <div className="dsht-rp-overlay" role="dialog" aria-label="DSHTavern 角色扮演">
      <div className="dsht-rp-topbar">
        <button type="button" className="dsht-rp-back" aria-label="关闭 RP 启动器" onClick={() => { setOpen(false) }}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 600 }}>🎭 角色扮演</div>
        <div className="dsht-rp-tabs">
          <button type="button" className={`dsht-rp-tab${tab === 'chars' ? ' active' : ''}`} onClick={() => { setTab('chars'); void loadWorkspaces() }}>角色</button>
          <button type="button" className={`dsht-rp-tab${tab === 'persona' ? ' active' : ''}`} onClick={() => { setTab('persona') }}>我的</button>
          <button type="button" className={`dsht-rp-tab${tab === 'import' ? ' active' : ''}`} onClick={() => { setTab('import') }}>导入</button>
          <button type="button" className={`dsht-rp-tab${tab === 'books' ? ' active' : ''}`} onClick={() => { setTab('books'); void loadWorkspaces() }}>世界书</button>
          <button type="button" className={`dsht-rp-tab${tab === 'regex' ? ' active' : ''}`} onClick={() => { setTab('regex'); void loadWorkspaces() }}>正则</button>
          <button type="button" className={`dsht-rp-tab${tab === 'preset' ? ' active' : ''}`} onClick={() => { setTab('preset') }}>预设</button>
          <button type="button" className={`dsht-rp-tab${tab === 'sessions' ? ' active' : ''}`} onClick={() => { setTab('sessions') }}>会话</button>
        </div>
      </div>
      <div className="dsht-rp-main">
        {tab === 'chars'
          ? (
            <div className="dsht-rp-grid">
              {workspaces.length === 0 && (
                <div className="dsht-rp-empty">还没有角色。切到「导入」页导入角色卡，或用 SillyTavern 数据整包迁移。</div>
              )}
              {workspaces.map(ws => (
                <div key={ws.slug} className="dsht-rp-card-wrap">
                  <button type="button" className="dsht-rp-card" disabled={opening !== null}
                    onClick={() => { void launchChar(ws, false) }}>
                    <div className="name">{ws.name}</div>
                    <div className="meta">{opening === ws.slug ? '打开中…' : `世界书 ${ws.bookCount} 本`}</div>
                  </button>
                  <button type="button" className="dsht-rp-card-gear" style={{ right: 40 }} aria-label={`${ws.name} 新开聊天（带开场白）`}
                    title="新开聊天（带开场白）" disabled={opening !== null}
                    onClick={() => { void launchChar(ws, true) }}>＋</button>
                  <button type="button" className="dsht-rp-card-gear" aria-label={`${ws.name} 详情（世界书绑定）`}
                    title="世界书绑定" onClick={() => { setDetail(ws) }}>⚙</button>
                </div>
              ))}
              {error && <div className="dsht-rp-empty">{error}</div>}
            </div>
          )
          : tab === 'books'
            ? <BooksPanel workspaces={workspaces} onChanged={() => { void loadWorkspaces() }} />
            : tab === 'regex'
              ? <RegexPanel workspaces={workspaces} />
              : tab === 'preset'
                ? <PresetPanel />
                : tab === 'persona'
                  ? <PersonaPanel />
                  : tab === 'sessions'
                    ? <SessionsPanel archiveSession={props.archiveSession} />
                    : (
                /* 任务 C1：导入 tab = 顶部迁移验收面板（大白话状态）+ 下面导入中心 iframe */
                <div className="dsht-rp-import-wrap">
                  <MigrationStatusPanel />
                  <UpdatePanel />
                  <ImportFrame onClose={() => { setOpen(false) }} onImported={(ws) => { void refreshAfterImport(ws) }} onKickoff={(sid) => { void jumpToAdapter(sid) }} />
                </div>
              )}
      </div>
      {detail !== null && (
        <CardDetailDrawer ws={detail} openSession={props.openSession} onClose={() => { setDetail(null) }} onSaved={() => { void loadWorkspaces() }} />
      )}
    </div>
  )
}

/**
 * 导入页（R0 agent 化定案）：内嵌「数据迁移」页面（同源 iframe /dsht-rp/import-center）。
 * iframe 只做「上传 + 发起」：选文件 → 分片 import-stage → import-kickoff（后端创建
 * 适配工作区会话并发开工消息）→ postMessage import-kickoff → 这里跳转会话看 harness 干活。
 * import-done 消息（旧前端流水线写盘成功）保留兼容：刷新侧边栏工作区/会话。
 */
function ImportFrame({ onClose, onImported, onKickoff }: {
  onClose: () => void
  onImported: (ws: Array<string | { path: string; name?: string }>) => void
  onKickoff: (sessionId: string) => void
}): JSX.Element {
  useEffect(() => {
    const onMsg = (ev: MessageEvent): void => {
      const t = (ev.data as { type?: string })?.type
      if (t === 'dsht-rp-ui:import-close') onClose()
      else if (t === 'dsht-rp-ui:import-done') onImported((ev.data as { workspaces?: Array<string | { path: string; name?: string }> }).workspaces ?? [])
      else if (t === 'dsht-rp-ui:import-kickoff') onKickoff(String((ev.data as { sessionId?: string }).sessionId ?? ''))
    }
    window.addEventListener('message', onMsg)
    return () => { window.removeEventListener('message', onMsg) }
  }, [onClose, onImported, onKickoff])

  return (
    <iframe
      title="数据迁移"
      src="/dsht-rp/import-center"
      className="dsht-rp-import-frame"
      sandbox="allow-same-origin allow-scripts allow-forms allow-modals"
    />
  )
}
