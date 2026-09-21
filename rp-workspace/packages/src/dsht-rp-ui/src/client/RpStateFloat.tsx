/**
 * 悬浮球原生移植（用户定案：原生移植，不让别的功能失效）。
 *
 * 意图来源：示例预设系预设 tavern_helper.scripts（示例卡乙脚本）的 pw-state-float——
 * 「🌌 当前平行世界状态」悬浮窗：可拖拽浮球 → 点开当前 MVU 变量状态面板，可拖、可关。
 * 原实现深度钩 ST 内部组件（PromptManager/topDoc），不可直接执行；这里按意图原生重写：
 * - 挂载：conversation.input.dock 席位（position:fixed 视口定位，不随滚动荡走）；
 *   仅 RP 工作区会话（cwd 含 /rp/<slug>）且已有消息时显示——非 RP 会话/空白会话零影响。
 * - 浮球：pointer 拖拽（< 6px 视为点按），位置 localStorage 持久化（跨会话共用位置偏好）。
 * - 面板：点开拉 /dsht-rp/state {sessionId} 的 MVU 状态树，递归渲染；打开时自动拉取
 *   + 每 4s 轮询（生成中状态变化即见）；「刷新」手动重拉。数据只读（写走聊天/变量面板）。
 */
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { rpApi } from './rpc.ts'
import { slugFromCwd } from './output-protocol.ts'
import { RpStateView } from './RpStateView.tsx'
import { RpSearchPanel } from './RpSearchPanel.tsx'
import { RpTablesView } from './RpTablesView.tsx'
import { RpStatusbarEditor } from './RpStatusbarEditor.tsx'
import { pollWhileVisible } from './visibility.ts'
// 【E2/P-1 W4 收口】官方投影读取一律走单源（见 host-projection.ts 头注）
import { readSessionBlank, readSessionCwd, readSessionId } from './host-projection.ts'

interface DockProps {
  session?: unknown
  input?: unknown
}

/**
 * 【E2 / P-1 2026-09-14】读宿主 SessionSnapshot 的 cwd —— **已迁到单源模块**
 * `host-projection.ts`（W4 系统性收口：官方投影读取全部集中到那一个文件）。
 *
 * 本处保留同名 re-export，**只为不破坏既有 import**（5 个组件与单测都从这里取）。
 * 新增代码请直接从 `'./host-projection.ts'` 引入。
 */
export { readSessionCwd } from './host-projection.ts'

const POS_KEY = 'dsht.rp.statefloat.pos.v1' // 旧版全局键（迁移兜底读一次）
// 【L3 2026-09-14】导出供单测驱动（存储配额清理的判据必须可测——见 tests/visibility 同族用法）
export const POS_KEY_GLOBAL = 'dsht-float-global' // F3：无会话上下文时的落点

/** F3：位置键 = dsht-float-<sessionId|global>（按会话记忆位置；无会话回退 global）
 *  导出供单测：清理判据依赖「哪些键是会话键」这一定义。 */
export function posKeyOf(sessionId: string): string {
  return sessionId !== '' ? `dsht-float-${sessionId}` : POS_KEY_GLOBAL
}

/** 视口界内 clamp（拖出视口/换设备视口变小 → 拉回界内；与拖拽中的 clamp 同口径） */
function clampPos(p: BallPos): BallPos {
  return {
    x: Math.min(0.98, Math.max(0.02, p.x)),
    y: Math.min(0.95, Math.max(0.05, p.y)),
  }
}

/** dock 席位 props 的 session 快照不带 cwd（cwd 在宿主 useSessions().byId）——
 * 按 sessionId 向 host 补取（/rp/session-cwd），会话级缓存。RpGreetingDock 同款门槛复用。 */
const cwdCache = new Map<string, Promise<string | null>>()

function fetchSessionCwd(sessionId: string): Promise<string | null> {
  let p = cwdCache.get(sessionId)
  if (p === undefined) {
    p = rpApi<{ cwd: string | null }>('rp/session-cwd', { sessionId })
      .then(r => r.cwd ?? null)
      .catch(() => null)
    cwdCache.set(sessionId, p)
  }
  return p
}

/** props.cwd 缺失时回退 host 补取的 cwd 解析 hook；resolved = 补取已落定（区分加载中与真非 RP） */
export function useRpSlug(cwdFromProps: string | undefined, sessionId: string): { slug: string | null; resolved: boolean } {
  const [cwd, setCwd] = useState<string | null>(cwdFromProps ?? null)
  const [resolved, setResolved] = useState(cwdFromProps !== undefined && cwdFromProps !== '')
  useEffect(() => {
    if (cwdFromProps) { setCwd(cwdFromProps); setResolved(true); return }
    if (!sessionId) { setCwd(null); setResolved(true); return }
    let alive = true
    setResolved(false)
    void fetchSessionCwd(sessionId).then(c => { if (alive) { setCwd(c); setResolved(true) } })
    return () => { alive = false }
  }, [cwdFromProps, sessionId])
  return { slug: slugFromCwd(cwd ?? undefined), resolved }
}

interface BallPos { x: number; y: number } // 视口比例 0..1

/** F3：读取位置——会话键 → global 键 → 旧版键 → 默认右上；每级读出后 clamp 回界内 */
function loadPos(key: string): BallPos {
  for (const k of [key, POS_KEY_GLOBAL, POS_KEY]) {
    try {
      const raw = localStorage.getItem(k)
      if (raw) {
        const p = JSON.parse(raw) as BallPos
        if (typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
          return clampPos(p)
        }
      }
    } catch { /* 坏数据试下一级 */ }
  }
  return { x: 0.92, y: 0.3 } // 示例卡乙默认 bubbleTop 30vh 右侧
}

/** 会话位置键前缀（`dsht-float-<sessionId>` 与 global 键共用前缀 `dsht-float-`） */
const POS_KEY_PREFIX = 'dsht-float-'
/** 会话位置键保留上限（孤儿清理阈值）。
 *  依据：这是「每个会话一条」的小记录（~40 字节），保留最近 N 个足够用户「回到老会话时
 *  浮球还在原位」；超出后按**插入序**删最早的。取 50：覆盖真实使用（几十个会话）而不
 *  让 localStorage 无界增长（配额通常 5MB，但无界增长最终会写失败，且写失败是静默的）。 */
const POS_KEY_KEEP = 50

/**
 * 【L3 2026-09-14 存储配额修复】清理孤儿会话位置键。
 *
 * 背景（L3 穷举发现）：`dsht-float-<sessionId>` 是**按会话累加且从不清理**的键
 * —— 全仓此前**零 localStorage 清理机制**（无 `localStorage.key()` / 无 TTL /
 * 无条数上限）。长期使用会留下大量孤儿键（已删会话、一次性会话各留一条），
 * 最终写失败；而 `savePos` 的 catch 是空的 ⇒ **静默失效**（浮球位置不再被记住，
 * 用户毫无线索），属 P-3 族。
 *
 * 判据（goal 轨道 A / A3「存储配额」）：长期使用下 localStorage 不得无界增长。
 *
 * 实现要点：只删「本前缀 + 非当前 sessionId」的键，且**保留最近 POS_KEY_KEEP 条**。
 * localStorage 无插入时间戳，故用「遍历顺序」近似（浏览器实现一般按插入序返回；
 * 即便顺序不保证，也只影响「删哪一条」而不影响「有上限」这一判据）。
 */
function prunePosKeys(currentKey: string): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      // 只认本届的会话键（global 键不带 sessionId，前缀相同但**必须保留**）
      if (k !== null && k.startsWith(POS_KEY_PREFIX) && k !== POS_KEY_GLOBAL) keys.push(k)
    }
    if (keys.length <= POS_KEY_KEEP) return
    // 保护当前会话的键（正在用的不能被删）
    const removable = keys.filter(k => k !== currentKey)
    const excess = keys.length - POS_KEY_KEEP
    for (let i = 0; i < excess && i < removable.length; i += 1) {
      const victim = removable[i]
      if (victim !== undefined) localStorage.removeItem(victim)
    }
  } catch { /* 遍历不可达则不清理（不影响正常保存） */ }
}

/** F3：保存位置（会话键 + global 兜底键同写——新会话/无会话上下文都能继承最近位置）
 *  导出供单测（存储配额清理判据）。 */
export function savePos(key: string, pos: BallPos): void {
  try {
    localStorage.setItem(key, JSON.stringify(pos))
    localStorage.setItem(POS_KEY_GLOBAL, JSON.stringify(pos))
    prunePosKeys(key)
  } catch { /* 存储不可达 */ }
}

/** MVU 状态树递归渲染（只读） */
function StateTree({ value, depth }: { value: unknown; depth: number }): JSX.Element {
  if (value === null || typeof value !== 'object') {
    return <span className="sf-leaf">{String(value ?? '')}</span>
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <span className="sf-leaf sf-empty">（空）</span>
  return (
    <div className="sf-level" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="sf-row">
          <span className="sf-key">{k}</span>
          {v !== null && typeof v === 'object'
            ? <StateTree value={v} depth={depth + 1} />
            : <span className="sf-leaf">{String(v)}</span>}
        </div>
      ))}
    </div>
  )
}

export function RpStateFloat(props: DockProps): JSX.Element | null {
  // 【E2/P-1 W4 收口】id / cwd / blank 三个官方投影字段一律走单源。
  // 此前这里写 `s.sessionId ?? s.id ?? ''` 与 `s.blank === true` —— 而
  // `RpTokenMeter` 写 `!== false`、`RpGreetingDock` 写 `!== true`，
  // 三种口径对「字段缺失」的结论不一致（见 host-projection.ts 的 readSessionBlank 头注）。
  const sessionId = readSessionId(props.session)
  const cwd = readSessionCwd(props.session)
  const { slug } = useRpSlug(cwd, sessionId)
  // 【2026-09-06 实证修复】同 RpGreetingDock：chat 字段不存在，msgCount 恒 0 → 浮球从不显示。
  // blank=true 即空会话 → 不显示浮球。
  const blank = readSessionBlank(props.session)

  const [pos, setPos] = useState<BallPos>(() => loadPos(posKeyOf(sessionId)))
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  // PROJECT_PLAN 补全：「查看状态」双视图大面板（RpStateView）由本面板头部按钮拉起
  const [viewOpen, setViewOpen] = useState(false)
  // PROJECT_PLAN §4.15：「消息搜索」面板由本面板头部按钮拉起（与「查看状态」同款式）
  const [searchOpen, setSearchOpen] = useState(false)
  // E6：「剧情表格」只读面板由本面板头部按钮拉起（与「查看状态」同款式）
  const [tablesOpen, setTablesOpen] = useState(false)
  // MVU-2：「状态栏模板」编辑面板由本面板头部按钮拉起（同款式互斥）
  const [statusbarOpen, setStatusbarOpen] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null)
  const clickHandledRef = useRef(false)

  // 面板打开时拉取 + 4s 轮询（生成中变量变化即见）
  useEffect(() => {
    if (!open || !sessionId) return
    let alive = true
    const fetchState = async (): Promise<void> => {
      try {
        const r = await rpApi<{ state: Record<string, unknown> }>('state', { sessionId })
        if (!alive) return
        setState(r.state ?? {})
        setError('')
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void fetchState()
    // 【L3 2026-09-14 切后台修复】4s 轮询改走 pollWhileVisible（不可见时停表）。
    // 同 RpTokenMeter：裸 setInterval 会在切后台后继续每秒级唤醒 JS + 发请求
    // （实测切后台 13.10 次/秒，与前台同量级）⇒ 耗电/发烫。
    const stop = pollWhileVisible(() => { void fetchState() }, 4000)
    return () => { alive = false; stop() }
  }, [open, sessionId])

  // F3：视口变化（转屏/窗口缩放）→ 浮球 clamp 回界内（比例坐标重新校准）
  useEffect(() => {
    const onResize = (): void => { setPos(p => clampPos(p)) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  // 【2026-09-14 用户拍板】原「跨浮窗避让回写通道」已随 script-ui-guard.ts 一并移除：
  // 浮球位置完全由用户拖拽决定，宿主不再主动改位置（避免与卡脚本自复位来回打架）。

  if (!slug || !sessionId || blank) return null // 非 RP / 空白会话不显示

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current
    if (d === null) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 6) return // 点按阈值
    d.moved = true
    // F3：拖出视口 clamp 回界内（指针捕获下事件照收，出界坐标被拉回）
    setPos(clampPos({ x: d.baseX + dx / window.innerWidth, y: d.baseY + dy / window.innerHeight }))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current
    if (d === null) return
    endDrag()
    if (d.moved) {
      // 松手贴边（左/右吸附，与 ST 浮球行为一致）；F3：写 dsht-float-<sessionId|global>
      const snapped = clampPos({ x: pos.x < 0.5 ? 0.06 : 0.92, y: pos.y })
      setPos(snapped)
      savePos(posKeyOf(sessionId), snapped)
    } else {
      clickHandledRef.current = true // 真触摸/鼠标：pointerup 已处理，随后的 click 抑制（防双翻）
      setOpen(o => !o)
    }
    // releasePointerCapture 只在**确实持有**时调用：若捕获已被隐式释放
    // （lostpointercapture 先到），此处再释放会抛 NotFoundError（DOMException），
    // 而 React 事件处理器里抛错会打断后续同批事件处理 ⇒ 必须 guard。
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId) === true) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch { /* 捕获已不在（隐式释放竞态）——无声但无害；状态已在 endDrag 收敛 */ }
  }
  /**
   * 【2026-09-14 L1 穷举修复 / P-8 幂等 + P-1 单源】结束一次拖拽的**唯一入口**。
   *
   * ## 为什么收成一个函数（而不是三个 handler 各写一份）
   * 「结束一次拖拽」有三种互斥触发路径，此前只有两条、且各写各的：
   *   - `pointerup`       —— 正常松手（唯一会**保留**结果的路径）
   *   - `pointercancel`   —— 手势被系统抢占（下拉通知栏 / 返回手势 / 多指介入）
   *   - `lostpointercapture` —— 捕获被**隐式**释放（元素被移除 / 同 pointerId 被他人抢占）
   * 后两条**都只该清状态**，且**都不置 `clickHandledRef`**（按规范捕获丢失后不会再合成
   * click，置位会吞掉下一次真实点击 ⇒「点一次没反应」比「面板意外展开」更糟）。
   * 三条路径共享同一份清理逻辑 ⇒ 将来再加路径（如 `pointerleave` 兜底）时不会漏改其中一处
   * （这正是 P-1「同一语义多处实现」的运行时形态；见 §5.4）。
   */
  const endDrag = (): void => {
    dragRef.current = null
  }
  // pointercancel：Android WebView 在手势被系统抢占时发它而非 pointerup。缺它 ⇒
  // `dragRef` 残留为「拖拽进行中」，位置停在半途且不贴边，直到下一次按下才自愈（状态不收敛）。
  const onPointerCancel = (): void => {
    endDrag()
  }
  // 【A1 穷尽第 8 格「pointer capture 在元素移除时的释放」· 2026-09-14】
  // `lostpointercapture` 是**隐式释放**时的唯一通知：元素在捕获期间被卸载（切卡 / React
  // 重挂载 / 面板关闭），或同一 pointerId 被他人 `setPointerCapture` 抢占。这两种情况
  // **既不发 pointerup 也不发 pointercancel** ⇒ 此前 `dragRef` 会永久残留（同一失效族）。
  // **不置 `clickHandledRef`**（同上：捕获丢失后不再合成 click）。
  const onLostPointerCapture = (): void => {
    endDrag()
  }
  // 【审计 D 类修复 2026-09-08】合成点击/无障碍服务只发 click 不发 pointer 序列——
  // 此前 click 无绑定，浮球被误判「点了没反应」。真触摸的 click 被 pointerup 标记抑制。
  const onClick = (): void => {
    if (clickHandledRef.current) { clickHandledRef.current = false; return }
    setOpen(o => !o)
  }

  return (
    <>
      <button
        type="button"
        className="dsht-rp-statefloat-ball"
        style={{ left: `${pos.x * 100}vw`, top: `${pos.y * 100}vh` }}
        title="当前状态（MVU 变量）"
        /* 【2026-09-13 修复·读屏语义（F-1）】浮球是纯 emoji 按钮，读屏只念「🌌」；
           aria-expanded 让面板开合状态可被播报。 */
        aria-label="当前状态（MVU 变量）"
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onClick={onClick}
      >🌌</button>
      {open && (
        <div className="dsht-rp-statefloat-panel" role="dialog" aria-label="当前状态">
          <div className="sf-head">
            <span>🌌 当前状态</span>
            <span className="sf-head-actions">
              {/* 【2026-09-13 修复·三面板叠加（A-4）】三个大面板此前可同时打开、互相叠压
                  （后开的盖住先开的，✕ 只关浮球面板 ⇒ 下面的大面板成了关不掉的残留）。
                  现改为互斥：开一个即关其它两个。 */}
              <button type="button" className="sf-btn" onClick={() => {
                setViewOpen(true); setSearchOpen(false); setTablesOpen(false); setStatusbarOpen(false)
              }}>查看状态</button>
              <button type="button" className="sf-btn" onClick={() => {
                setSearchOpen(true); setViewOpen(false); setTablesOpen(false); setStatusbarOpen(false)
              }}>🔍 搜索</button>
              <button type="button" className="sf-btn" onClick={() => {
                setStatusbarOpen(true); setViewOpen(false); setSearchOpen(false); setTablesOpen(false)
              }}>状态栏</button>
              <button type="button" className="sf-btn" aria-label="刷新状态" onClick={() => {
                setState(null)
                void rpApi<{ state: Record<string, unknown> }>('state', { sessionId })
                  .then(r => { setState(r.state ?? {}); setError('') })
                  .catch(e => setError((e as Error).message))
              }}>刷新</button>
              {/* 关闭浮球面板时一并收起三个大面板（否则它们留在屏上且无入口关闭） */}
              <button type="button" className="sf-btn" aria-label="关闭状态面板" onClick={() => {
                setOpen(false); setViewOpen(false); setSearchOpen(false); setTablesOpen(false); setStatusbarOpen(false)
              }}>✕</button>
            </span>
          </div>
          <div className="sf-body">
            {error && <div className="sf-error" role="status">状态拉取失败：{error}</div>}
            {state === null && !error && <div className="sf-empty">加载中…</div>}
            {state !== null && Object.keys(state).length === 0 && !error && (
              <div className="sf-empty">（暂无 MVU 状态——这张卡可能不用变量，或还没产生变量更新）</div>
            )}
            {state !== null && Object.keys(state).length > 0 && <StateTree value={state} depth={0} />}
          </div>
        </div>
      )}
      {/* PROJECT_PLAN 补全：双视图状态大面板（表格可折叠 / JSON 只读），z-index 高于悬浮面板 */}
      {open && viewOpen && <RpStateView sessionId={sessionId} onClose={() => { setViewOpen(false) }} />}
      {/* PROJECT_PLAN §4.15：消息搜索面板（同款式 overlay；点击结果项在面板内展开全文，
          不做滚动定位——官方 ChatView 滚动容器不受控，见 RpSearchPanel 头注） */}
      {open && searchOpen && <RpSearchPanel sessionId={sessionId} onClose={() => { setSearchOpen(false) }} />}
      {/* E6：剧情表格只读面板（GET /dsht-memory/tables?sessionId=；每表顶部折叠行） */}
      {open && tablesOpen && <RpTablesView sessionId={sessionId} onClose={() => { setTablesOpen(false) }} />}
      {/* MVU-2：状态栏模板编辑面板（GET/PUT /dsht-mvu/statusbar + 预览不落盘） */}
      {open && statusbarOpen && <RpStatusbarEditor sessionId={sessionId} onClose={() => { setStatusbarOpen(false) }} />}
    </>
  )
}
