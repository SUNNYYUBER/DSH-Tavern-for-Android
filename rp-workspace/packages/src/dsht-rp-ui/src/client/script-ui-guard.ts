/**
 * 【审计 A 类修复 2026-09-08】脚本注入宿主的悬浮 UI 守卫 + 注册表协商（通用层）。
 *
 * 背景（loop 审计实证）：TH 脚本/扩展经 window.parent.$ 往宿主 document 注入悬浮
 * 部件，两类问题——
 * ① 纯装饰图层（fx 扩展球的 ball-ring 等）pointer-events:auto 覆盖宿主控件 →
 *    「看得到、点不动」→ 自动置触摸穿透（decorative guard）；
 * ② 功能性悬浮窗（wb-float-monitor 等）与宿主核心 chrome（对话标签栏等）重叠 →
 *    不能盲改穿透（功能 UI 要能点）→ **注册表 + 同意式协商**：登记进注册表、
 *    检测到与保护区碰撞时弹一次性 toast，用户点击「自动避让」才做最小位移
 *    （不改 z、不隐藏、可逆；脚本若自行挪回不重复打扰）。
 *
 * 扫描模型（真机排障教训）：全量扫描只做一次（安装时）；此后 MutationObserver
 * **增量扫新增子树（含根自身）**——querySelectorAll 只匹配后代，根自身必须单独
 * processElement，否则注入的悬浮窗本体永远漏登记（v1 实测踩坑）。
 */

const DECOR_RE = /ring|halo|glow|aura/i
const FLOAT_TAGS = 'div,aside,section,nav'
/** 增量扫描的后代候选（容器标签 + 装饰类名任意标签） */
const DECOR_SOURCE_SELECTOR = '[class*="ring"],[class*="halo"],[class*="glow"],[class*="aura"]'

/** 交互语义判定（jQuery 风格 UI 兼容）：原生控件 / onclick 属性 / cursor:pointer 后代 /
 *  draggable 类（jQuery UI 可拖窗）。上限 40 个后代查 computed，防大子树卡顿。 */
function hasInteractiveSemantic(el: HTMLElement): boolean {
  if (el.querySelector('button,a,input,select,textarea,[role="button"],[onclick]') !== null) return true
  if (/draggable|ui-handle/i.test(el.className.toString())) return true
  const descendants = el.querySelectorAll<HTMLElement>('*')
  const cap = Math.min(descendants.length, 40)
  for (let i = 0; i < cap; i++) {
    try { if (getComputedStyle(descendants[i]!).cursor === 'pointer') return true } catch { /* 继续 */ }
  }
  return false
}

// ---- ① 装饰层守卫 ----

function tryDecor(el: HTMLElement): void {
  if (el.dataset.dshtDecor === '1') return
  if (!DECOR_RE.test(el.className.toString())) return
  let cs: CSSStyleDeclaration
  try { cs = getComputedStyle(el) } catch { return }
  if (cs.pointerEvents === 'none') return
  if (cs.position !== 'fixed' && cs.position !== 'absolute') return
  if (hasInteractiveSemantic(el)) return
  el.style.pointerEvents = 'none'
  el.dataset.dshtDecor = '1'
  console.info('[dsht-rp-ui] 脚本装饰层已置 pointer-events:none（触摸穿透）:', el.className)
}

// ---- ② 注册表 + 同意式避让 ----

/** 保护区锚点（每轮碰撞检测时现取 rect——布局会变） */
const PROTECTED_ANCHORS = '[role="tablist"],[data-composer-input]'

interface FloatEntry { offeredNudge: boolean }

/** 已登记的脚本悬浮窗（弱引用随 DOM 回收） */
const floatRegistry = new WeakMap<HTMLElement, FloatEntry>()
/** 存活登记列表（可迭代——已登记未协商的元素需要持续复检：登记时保护区可能还没挂出来） */
const liveFloats = new Set<HTMLElement>()

/** 碰撞面积（交集矩形面积；不相交为 0） */
function overlapArea(a: DOMRect, b: DOMRect): number {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return ix * iy
}

/** 轻量协商 toast（可点击；不依赖 toastr——guard 必须自给自足）。返回是否真的弹了 */
function offerNudgeToast(el: HTMLElement, zoneName: string, nudge: () => void): boolean {
  if (document.getElementById('dsht-float-nudge-toast') !== null) return false // 同时只一条（不消耗额度）
  const bar = document.createElement('div')
  bar.id = 'dsht-float-nudge-toast'
  bar.style.cssText = 'position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);'
    + 'z-index:10060;display:flex;align-items:center;gap:10px;max-width:92vw;box-sizing:border-box;'
    + 'background:rgba(28,28,36,.96);color:#ddd;border:1px solid rgba(255,255,255,.14);border-radius:12px;'
    + 'padding:10px 14px;font-size:13px;line-height:18px;box-shadow:0 4px 16px rgba(0,0,0,.4)'
  const text = document.createElement('span')
  text.textContent = `脚本悬浮窗遮住了${zoneName}`
  const yes = document.createElement('button')
  yes.type = 'button'
  yes.textContent = '自动避让'
  yes.style.cssText = 'flex-shrink:0;border:none;border-radius:8px;padding:6px 12px;background:#3b6ea5;color:#fff;font-size:13px;cursor:pointer'
  const no = document.createElement('button')
  no.type = 'button'
  no.textContent = '忽略'
  no.style.cssText = 'flex-shrink:0;border:none;background:transparent;color:#999;font-size:13px;cursor:pointer'
  const dismiss = (): void => { bar.remove() }
  yes.addEventListener('click', () => { try { nudge() } catch (e) { console.warn('[dsht-rp-ui] nudge failed', e) } dismiss() })
  no.addEventListener('click', dismiss)
  bar.append(text, yes, no)
  document.body.appendChild(bar)
  setTimeout(dismiss, 12000)
  return true
}

/** 最小位移避让：把候选矩形沿总位移最小的方向推出保护区（位置修正，不改 z 不隐藏）。
 *  偏移持久化：脚本切会话会自复位浮窗（审计第二轮实证）——偏移按浮窗身份存
 *  localStorage，同身份元素再登记时静默重放（不重复弹 toast）。 */
function floatIdentity(el: HTMLElement): string {
  return el.id || el.className.toString().slice(0, 80) || 'anon'
}

function saveNudgeOffset(el: HTMLElement, dx: number, dy: number): void {
  try { localStorage.setItem(`dsht-nudge:${floatIdentity(el)}`, JSON.stringify({ dx, dy })) } catch { /* 存储不可用静默 */ }
}

function replayNudgeOffset(el: HTMLElement): boolean {
  try {
    const raw = localStorage.getItem(`dsht-nudge:${floatIdentity(el)}`)
    if (raw === null) return false
    const { dx, dy } = JSON.parse(raw) as { dx: number; dy: number }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return false
    applyNudge(el, dx, dy)
    return true
  } catch { return false }
}

function applyNudge(el: HTMLElement, dx: number, dy: number): void {
  const cs = getComputedStyle(el)
  if (cs.position === 'fixed' || cs.position === 'absolute') {
    if (cs.right !== 'auto') el.style.right = 'auto'
    if (cs.bottom !== 'auto') el.style.bottom = 'auto'
    const r = el.getBoundingClientRect()
    el.style.left = `${r.left + dx}px`
    el.style.top = `${r.top + dy}px`
  } else {
    el.style.transform = `translate(${dx}px, ${dy}px)`
  }
  el.dataset.dshtNudged = '1'
}

function nudgeOutOfZones(el: HTMLElement, zones: DOMRect[]): void {
  const r = el.getBoundingClientRect()
  // 汇合所有相交保护区，算联合推出向量（逐轴最小；重叠小的轴 = 位移小的方向）
  let dx = 0
  let dy = 0
  for (const z of zones) {
    const ix = Math.min(r.right + dx, z.right) - Math.max(r.left + dx, z.left)
    const iy = Math.min(r.bottom + dy, z.bottom) - Math.max(r.top + dy, z.top)
    if (ix <= 0 || iy <= 0) continue
    const pushLeft = (r.right + dx) - z.left   // 向左推的量
    const pushRight = z.right - (r.left + dx)  // 向右推的量
    const pushUp = (r.bottom + dy) - z.top
    const pushDown = z.bottom - (r.top + dy)
    if (ix <= iy) dx += Math.min(pushLeft, pushRight) * (pushLeft < pushRight ? -1 : 1)
    else dy += Math.min(pushUp, pushDown) * (pushUp < pushDown ? -1 : 1)
  }
  if (dx === 0 && dy === 0) return
  applyNudge(el, dx, dy)
  saveNudgeOffset(el, dx, dy)
  console.info('[dsht-rp-ui] 脚本悬浮窗已避让保护区:', el.className, { dx, dy })
}

/** 单元素处理：装饰穿透 / 悬浮窗登记 + 碰撞协商。zones 传 null = 跳过协商（只登记） */
function processElement(el: HTMLElement, zones: Array<{ rect: DOMRect; name: string }> | null): void {
  if (el.className.toString().includes('dsht-rp-')) return // 自家 chrome 不碰
  if (el.closest('#dsht-rp-frame-park') !== null) return
  let cs: CSSStyleDeclaration
  try { cs = getComputedStyle(el) } catch { return }
  if (cs.position !== 'fixed' && cs.position !== 'absolute') return
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return
  const interactive = hasInteractiveSemantic(el)
  if (!interactive) { tryDecor(el); return }
  // 功能 UI → 注册表 + 协商
  if (!floatRegistry.has(el)) {
    floatRegistry.set(el, { offeredNudge: false })
    liveFloats.add(el)
    el.dataset.dshtFloatUi = '1'
    // 同身份历史避让静默重放（脚本复位浮窗后无需用户再点一次）
    if (replayNudgeOffset(el)) {
      const entry0 = floatRegistry.get(el)
      if (entry0 !== undefined) entry0.offeredNudge = true
      console.info('[dsht-rp-ui] 脚本悬浮窗重放历史避让:', el.className)
    }
  }
  negotiateCollision(el, zones)
}

/** 对已登记未协商的元素做保护区碰撞检测；命中弹一次性 toast（同意式避让） */
function negotiateCollision(el: HTMLElement, zones: Array<{ rect: DOMRect; name: string }> | null): void {
  const entry = floatRegistry.get(el)
  if (zones === null || zones.length === 0 || entry === undefined || entry.offeredNudge) return
  const rect = el.getBoundingClientRect()
  if (rect.width < 24 || rect.height < 24) return
  let hit: { rect: DOMRect; name: string } | null = null
  for (const z of zones) {
    const area = overlapArea(rect, z.rect)
    if (area > 200 && area > rect.width * rect.height * 0.12) { hit = z; break }
  }
  if (hit === null) return
  // 提示真的弹了才消耗「仅一次」额度（被其它 toast 占用时下轮再试）
  if (offerNudgeToast(el, hit.name, () => nudgeOutOfZones(el, zones.map(z => z.rect)))) {
    entry.offeredNudge = true
  }
}

/** 每轮扫描。root=null = 全量（仅安装时）；传根 = 增量（根自身 + 后代都要处理） */
function guardScan(root: HTMLElement | Document | null): void {
  // 保护区 rect（无锚点跳过协商；rect 现取——布局会变）
  let zones: Array<{ rect: DOMRect; name: string }> | null = null
  if (root === null || document.querySelector(PROTECTED_ANCHORS) !== null) {
    zones = []
    for (const anchor of document.querySelectorAll<HTMLElement>(PROTECTED_ANCHORS)) {
      const rect = anchor.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      zones.push({ rect, name: anchor.getAttribute('role') === 'tablist' ? '对话标签栏' : '输入区' })
    }
  }
  if (root === null) {
    for (const el of document.querySelectorAll<HTMLElement>('div,aside,section,nav')) processElement(el, zones)
    // 装饰层不限标签（span/i 的 ring 也吃）——DECOR_RE 在 processElement 内兜底判定，
    // 这里补扫非容器标签的装饰候选
    for (const el of document.querySelectorAll<HTMLElement>(`span,i,b,em,label,p`)) {
      if (DECOR_RE.test(el.className.toString())) processElement(el, null)
    }
  } else {
    if (!(root instanceof HTMLElement)) return
    processElement(root, zones)
    for (const el of root.querySelectorAll<HTMLElement>(`${FLOAT_TAGS},${DECOR_SOURCE_SELECTOR}`)) processElement(el, zones)
  }
  // 已登记未协商元素的持续复检（登记时保护区可能还没挂出来/还没滚到）；断链清理
  for (const el of [...liveFloats]) {
    if (!el.isConnected) { liveFloats.delete(el); floatRegistry.delete(el); continue }
    negotiateCollision(el, zones)
  }
}

/** 安装守卫；返回卸载函数（插件 fiber 随动） */
export function installScriptUiGuard(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => { /* SSR/测试环境 */ }
  // 诊断探针（CDP 排障用）：window.__dshtGuard = { installed, scans }
  const dbg = (window as unknown as Record<string, unknown>)
  dbg['__dshtGuard'] = { installed: Date.now(), scans: 0 }
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 待扫根（mutation 增量；安装时先全量一轮） */
  let pendingRoots: HTMLElement[] = []
  let fullDue = true
  const run = (): void => {
    timer = null
    const d = dbg['__dshtGuard'] as { scans: number }
    d.scans += 1
    try {
      if (fullDue) { guardScan(null); fullDue = false }
      else for (const root of pendingRoots.splice(0)) guardScan(root)
    } catch (e) { console.warn('[dsht-rp-ui] script ui guard pass failed', e) }
  }
  const schedule = (): void => {
    if (timer !== null) return
    timer = setTimeout(run, 400)
  }
  run()
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLElement) { pendingRoots.push(n); schedule() }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // 低频复检（3s）：页面静止（无 mutation）时已登记未协商的悬浮窗也要参与碰撞检测
  const recheck = setInterval(() => {
    try {
      if (liveFloats.size === 0) return
      const zones: Array<{ rect: DOMRect; name: string }> = []
      for (const anchor of document.querySelectorAll<HTMLElement>(PROTECTED_ANCHORS)) {
        const rect = anchor.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        zones.push({ rect, name: anchor.getAttribute('role') === 'tablist' ? '对话标签栏' : '输入区' })
      }
      for (const el of [...liveFloats]) {
        if (!el.isConnected) { liveFloats.delete(el); floatRegistry.delete(el); continue }
        negotiateCollision(el, zones)
      }
    } catch { /* 复检失败不影响主流程 */ }
  }, 3000)
  return () => { observer.disconnect(); clearInterval(recheck); if (timer !== null) clearTimeout(timer) }
}
