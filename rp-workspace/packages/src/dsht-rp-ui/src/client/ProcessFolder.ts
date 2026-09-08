/**
 * 任务 A：主会话「过程折叠」DOM 增强（MutationObserver 驱动，节流）。
 *
 * 用户原话：任务结束后自动折叠 harness 处理过程成一行，只保留最终正文。
 * 实现约束：
 * - 选择器只用结构/语义属性（[data-chat-flow] / [data-chat-flow-kind] /
 *   [data-chat-flow-key] / 直接子级 [role="status"] 运行指示），不碰编译哈希类名；
 * - 不移动 React 管理的节点（insertBefore 外来标题行 + 行 inline display 隐藏，
 *   React 不重写它没设过的 style，安全）；
 * - 折叠只发生在会话空闲时（列内直接子级无 [role="status"]「Deep diving...」指示）；
 * - 用户展开选择在本次页面生命周期内记忆（按 turn-tail key）。
 */
import { planFolds, type FoldGroup, type FoldRow } from './fold-plan.ts'

interface ColumnState {
  /** 用户手动展开过的折叠组（turn-tail key） */
  expanded: Set<string>
  /** 已插入的标题行（groupId → element） */
  headers: Map<string, HTMLButtonElement>
}

const columnStates = new WeakMap<HTMLElement, ColumnState>()

/** turn-tail 行文本里抓「用时 xx / Ran for xx」 */
function scrapeDuration(tailText: string): string | null {
  const m = tailText.match(/(?:用时|Ran for)\s*([^·\n]+)/)
  return m?.[1]?.trim() || null
}

/** expanded 参数（2026-09-04 用户反馈）：标题行变成展开/收起双态切换——
 *  原实现展开即删 header（没有再折叠路径），现在 header 常驻，点击在两态间翻转。 */
function headerLabel(group: FoldGroup, duration: string | null, expanded: boolean): string {
  const parts: string[] = []
  parts.push(duration !== null ? `运行了 ${duration}` : '运行完成')
  if (group.steps > 0) parts.push(`${group.steps} 个步骤`)
  if (group.toolCalls > 0) parts.push(`${group.toolCalls} 次工具调用`)
  return expanded
    ? `▾ ${parts.join(' · ')}（点击收起过程）`
    : `▸ ${parts.join(' · ')}（点击展开过程）`
}

function processColumn(column: HTMLElement): void {
  // 运行中（直接子级有 role=status 的整轮指示）不折叠，等空闲再做
  if (column.querySelector(':scope > [role="status"]') !== null) return
  let state = columnStates.get(column)
  if (!state) {
    state = { expanded: new Set(), headers: new Map() }
    columnStates.set(column, state)
  }
  // 垃圾回收：列重渲染后失联的旧标题行
  for (const [id, header] of state.headers) {
    if (!header.isConnected) state.headers.delete(id)
  }
  const rows: Array<FoldRow & { el: HTMLElement }> = []
  for (const child of Array.from(column.children)) {
    const el = child as HTMLElement
    const kind = el.getAttribute('data-chat-flow-kind')
    const key = el.getAttribute('data-chat-flow-key')
    if (kind !== null && key !== null) rows.push({ el, key, kind })
  }
  const rowByKey = new Map(rows.map(r => [r.key, r]))
  const plans = new Map(planFolds(rows).map(g => [g.id, g]))

  // 计划消失的组（历史截断/换会话复用列）：还原行并撤掉标题
  for (const [id, header] of state.headers) {
    if (plans.has(id)) continue
    header.remove()
    state.headers.delete(id)
    for (const row of rows) {
      if (row.el.dataset.dshtFold === id) {
        row.el.style.display = ''
        delete row.el.dataset.dshtFold
      }
    }
  }

  for (const group of plans.values()) {
    const anchor = rowByKey.get(group.anchorKey)
    if (!anchor) continue
    // 实时行查找（React 重渲染会替换行元素——闭包里的 el 引用会过期）
    const rowNow = (key: string): HTMLElement | null =>
      rowByKey.get(key)?.el?.isConnected === true ? rowByKey.get(key)!.el
        : column.querySelector<HTMLElement>(`[data-chat-flow-key="${CSS.escape(key)}"]`)
    const isExpanded = state.expanded.has(group.id)
    let header = state.headers.get(group.id)
    if (!header) {
      // 展开态但 header 失联（React 重渲染挤掉了外来节点）：退回折叠态重建
      if (isExpanded) state.expanded.delete(group.id)
      header = document.createElement('button')
      header.type = 'button'
      header.className = 'dsht-fold-header'
      const groupId = group.id
      const foldedKeys = group.foldedKeys
      header.addEventListener('click', (e) => {
        const collapsing = state.expanded.has(groupId)
        if (collapsing) state.expanded.delete(groupId)
        else state.expanded.add(groupId)
        for (const key of foldedKeys) {
          const row = column.querySelector<HTMLElement>(`[data-chat-flow-key="${CSS.escape(key)}"]`)
          if (!row) continue
          row.style.display = collapsing ? 'none' : ''
          if (collapsing) row.dataset.dshtFold = groupId
          else delete row.dataset.dshtFold
        }
        const tailNow = column.querySelector<HTMLElement>(`[data-chat-flow-key="${CSS.escape(groupId)}"]`)
        const label = headerLabel(group, tailNow === null ? null : scrapeDuration(tailNow.textContent ?? ''), !collapsing)
        const btn = e.currentTarget as HTMLButtonElement | null
        if (btn !== null) btn.textContent = label
      })
      state.headers.set(group.id, header)
    }
    const expandedNow = state.expanded.has(group.id)
    const tailEl = rowNow(group.id)
    header.textContent = headerLabel(group, tailEl === null ? null : scrapeDuration(tailEl.textContent ?? ''), expandedNow)
    // 折叠态：隐藏过程行；展开态：行保持显示（React 新渲染的行天然可见）。
    // 两种态都重新锚定 header（React 重渲染可能把它挤离锚点）。
    if (header.parentElement !== column || header.nextSibling !== anchor.el) {
      anchor.el.before(header) // 外来节点插入：React 按引用锚定子节点，不受影响
    }
    if (!expandedNow) {
      for (const key of group.foldedKeys) {
        const row = rowNow(key)
        if (!row) continue
        row.style.display = 'none'
        row.dataset.dshtFold = group.id
      }
    }
  }
}

/** 安装全局过程折叠器；返回卸载函数（插件 fiber 随动）。 */
export function installProcessFolder(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => { /* SSR/测试环境 */ }
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = (): void => {
    timer = null
    for (const column of Array.from(document.querySelectorAll<HTMLElement>('[data-chat-flow]'))) {
      try { processColumn(column) } catch (e) { console.warn('[dsht-rp-ui] process folder pass failed', e) }
    }
  }
  const schedule = (): void => {
    if (timer !== null) return
    timer = setTimeout(run, 300) // 节流：流式期间成串 mutation 合并成一次扫描
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule() // 首屏（ reopen 历史会话）也收一次
  return () => {
    observer.disconnect()
    if (timer !== null) clearTimeout(timer)
  }
}
