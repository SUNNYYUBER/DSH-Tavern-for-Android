/**
 * 宿主锚点解析器：把宿主 shell 的关键元素打成 data-* 锚点，CSS 只消费锚点。
 *
 * 约定：CSS 里绝不硬编码宿主编译后的哈希类名（.pI_x6G_* / .VOzbGW_* /
 * .hHd-Xa_*）——哈希类名只允许出现在本文件的候选选择器里（单点维护，DSH 升级
 * 只改这一个文件）；样式侧一律写 [data-dsht-mobile="<anchor>"]。
 *
 * 结构性解析优先于类名：app-frame 直接取宿主自带 [data-shell-overlay] 的父元素
 * （零类名依赖），sidebar-col 取 app-frame 的首个子元素；只有设置面板/侧栏 rail
 * 这类无宿主 data 钩子的区域才回退到候选类名选择器。
 */

/** 锚点属性名（CSS 唯一消费面） */
export const ANCHOR_ATTR = 'data-dsht-mobile'

export type AnchorStrategy =
  /** [data-shell-overlay] 的父元素（宿主自带钩子，结构性，零类名依赖） */
  | 'overlay-parent'
  /** app-frame 锚点元素的首个子元素（rc 系 AppFrame 首子即 sidebarCol） */
  | 'first-child-of-frame'

export interface AnchorDef {
  anchor: string
  /** 候选类名选择器（哈希类名唯一允许出现的位置；按序尝试，命中即打标） */
  selectors: string[]
  strategy?: AnchorStrategy
}

/**
 * 锚点表（rc.7 基线的 dsh-client-ui-layout / ui-settings-general / ui-sidebar）：
 * 布局 frame 类名 .pI_x6G_*、设置面板 .VOzbGW_*、侧栏 rail .hHd-Xa_* 均为宿主
 * 编译产物里的实际类名（本仓 style.ts 既有 hack 的迁移——全部锚点化）。
 * 宿主升级若改哈希，只需更新本表的候选选择器。
 */
export const ANCHOR_DEFS: AnchorDef[] = [
  { anchor: 'app-frame', strategy: 'overlay-parent', selectors: ['.pI_x6G_frame'] },
  { anchor: 'sidebar-col', strategy: 'first-child-of-frame', selectors: ['.pI_x6G_sidebarCol'] },
  { anchor: 'center-col', selectors: ['.pI_x6G_centerCol'] },
  { anchor: 'details-col', selectors: ['.pI_x6G_detailsCol'] },
  { anchor: 'drag-handle', selectors: ['.pI_x6G_handle'] },
  { anchor: 'settings-overlay', selectors: ['.VOzbGW_overlay'] },
  { anchor: 'settings-panel', selectors: ['.VOzbGW_panel'] },
  { anchor: 'settings-nav', selectors: ['.VOzbGW_nav'] },
  { anchor: 'settings-nav-title', selectors: ['.VOzbGW_navTitle'] },
  { anchor: 'settings-nav-list', selectors: ['.VOzbGW_navList'] },
  { anchor: 'settings-nav-cell', selectors: ['.VOzbGW_navCell'] },
  { anchor: 'settings-nav-label', selectors: ['.VOzbGW_navLabel'] },
  { anchor: 'settings-content', selectors: ['.VOzbGW_content'] },
  { anchor: 'settings-options', selectors: ['.VOzbGW_options'] },
  { anchor: 'sidebar-rail', selectors: ['.hHd-Xa_railIn'] },
  { anchor: 'rail-icon-button', selectors: ['.hHd-Xa_iconButton'] },
  // 会话视图顶栏（2026-09-04 窄屏修复）：真机会话名长 → crumbs 不收缩盖住
  // headerActions（"Session log/子项计数"文字重叠，真机截图实证）；汉堡 fixed
  // 在左上又盖住 crumbs/tabs 左侧 → header 需 padding 让位 + crumbs 需可收缩。
  { anchor: 'chat-header', selectors: ['.wSkVaW_header'] },
  { anchor: 'chat-title-row', selectors: ['.wSkVaW_titleRow'] },
  { anchor: 'chat-title-cluster', selectors: ['.wSkVaW_titleCluster'] },
  { anchor: 'chat-crumbs', selectors: ['.wSkVaW_crumbs'] },
  { anchor: 'chat-header-actions', selectors: ['.wSkVaW_headerActions'] },
  { anchor: 'chat-header-utilities', selectors: ['.wSkVaW_headerUtilities'] },
]

/** 解析器操作的最小元素面（真实 DOM Element 结构性满足；测试可注入假 DOM） */
export interface AnchorElementLike {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  readonly parentElement: AnchorElementLike | null
  readonly firstElementChild: AnchorElementLike | null
}

export interface AnchorRootLike {
  querySelectorAll(selectors: string): ArrayLike<AnchorElementLike>
}

/**
 * 全量扫一遍并把未打标的宿主元素打上锚点（幂等：已带 data-dsht-mobile 的元素跳过）。
 * 返回本轮新打标的元素数。
 */
export function resolveAnchors(root: AnchorRootLike): number {
  let tagged = 0
  const tag = (el: AnchorElementLike | null, anchor: string): void => {
    if (el === null) return
    if (el.getAttribute(ANCHOR_ATTR) !== null) return
    el.setAttribute(ANCHOR_ATTR, anchor)
    tagged += 1
  }
  const all = (selector: string): AnchorElementLike[] => Array.from(root.querySelectorAll(selector))

  let frame: AnchorElementLike | null = null
  for (const def of ANCHOR_DEFS) {
    if (def.strategy === 'overlay-parent') {
      const overlay = all('[data-shell-overlay]')[0]
      tag(overlay?.parentElement ?? null, def.anchor)
      frame = overlay?.parentElement ?? all(`[${ANCHOR_ATTR}="${def.anchor}"]`)[0] ?? null
    } else if (def.strategy === 'first-child-of-frame') {
      const f = frame ?? all(`[${ANCHOR_ATTR}="app-frame"]`)[0] ?? null
      tag(f?.firstElementChild ?? null, def.anchor)
    }
    for (const sel of def.selectors) for (const el of all(sel)) tag(el, def.anchor)
  }
  return tagged
}

/**
 * 安装锚点解析：立即全量扫一次 + MutationObserver 盯后续挂载（设置面板/详情列
 * 等懒挂载区域）。返回 disposer。SSR/无 body 环境退化为单次扫描。
 *
 * 移动端性能（2026-09-04 用户反馈 DSHT 发烫）：observer 回调原本每个 mutation
 * 批次同步跑 resolveAnchors——全文档 17 个候选选择器扫描；流式会话期间每个
 * token 都有 DOM mutation，等于每帧全文档扫 17 遍（麒麟级 SoC 上持续满载）。
 * 改为节流 + 收敛降频：到点即扫；扫到新锚点 → 间隔回到 200ms；连续扫不到
 * （壳层锚点早已打完，DOM 只在流式重排）→ 间隔翻倍至 1s 上限。空闲后新面板
 * 挂载的 mutation 到达时 due 已过期，setTimeout(0) 立即扫描——懒挂载打标
 * 无可感延迟。
 */
export function installAnchors(doc: Document): () => void {
  resolveAnchors(doc)
  const body = doc.body
  if (typeof MutationObserver === 'undefined' || body === null) return () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  let interval = 200
  let lastScan = Date.now()
  const scan = (): void => {
    timer = null
    lastScan = Date.now()
    const tagged = resolveAnchors(doc)
    interval = tagged > 0 ? 200 : Math.min(interval * 2, 1000)
  }
  const schedule = (): void => {
    if (timer !== null) return
    timer = setTimeout(scan, Math.max(0, lastScan + interval - Date.now()))
  }
  const observer = new MutationObserver(schedule)
  observer.observe(body, { childList: true, subtree: true })
  return () => { observer.disconnect(); if (timer !== null) clearTimeout(timer) }
}
