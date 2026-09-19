/**
 * touch → mouse 事件翻译桥（DSHT 自研，2026-09-14）。
 *
 * ## 病症
 * jQuery UI 的鼠标基类（`$.ui.mouse`）**只**绑 `mousedown` / `mousemove` / `mouseup`
 * （见 node_modules/jquery-ui/ui/widgets/mouse.js:50-60、131-133）。触摸屏只产生
 * `touchstart` / `touchmove` / `touchend`，**永远不会有 mousedown 系列**。于是卡脚本用
 * `.draggable()` / `.resizable()` / `.sortable()` 做的浮窗——飞讯聊天悬浮球、实时监控窗、
 * 剧情控制台、世界书面板……——在移动端**完全拖不动**（用户实测反馈）。
 * 这是「PC harness → 移动端」迁移中的一类通病，不是单个卡的问题。
 *
 * ## 为什么自研而不是引第三方
 * 业界标配是 jQuery UI Touch Punch。但本项目正在做第三方引用收敛（见
 * `docs/COPYRIGHT-AUDIT-FULL-2026-09-14.md`）：Touch Punch 虽为 MIT，引入即新增一处需要
 * 在致谢/许可清单里叠甲的第三方代码。本桥只覆盖我们确定的场景，自研实现等效功能，
 * 版权完全归本项目。
 *
 * ## 设计（四条硬约束）
 * ① **零侵入 jQuery UI**：不改其源码、不改其事件绑定，只在事件入口做翻译——合成**原生**
 *    MouseEvent 派发到同一 target，让 jQuery UI 原有的 mouse 路径**原封不动**地跑。
 *    后果：jQuery UI 升级/换版本**不需要**同步改本文件（只依赖 `_mouseInit` 这一个钩子名）。
 * ② **只作用于 mouse 系组件元素**：`_mouseInit` 时给元素打 `data-dsht-touch-drag` 标记；
 *    触摸起点不在标记元素内 → 完全不介入（不 listen 后续、不 preventDefault、不合成）。
 *    卡脚本里的普通按钮/滚动/输入框零影响。
 * ③ **点按与拖拽分道**：`touchstart` **不** preventDefault（否则浏览器既不合成 mouse，
 *    也不合成 click ——「浮窗点不动」正是此坑）；只有 touchmove 越过阈值、真正进入拖拽时
 *    才接管手势（preventDefault 阻止页面滚动 + 合成 mousedown/mousemove）。
 *    未越阈值的触摸**全程零干预**，浏览器照常合成 click → 点按行为 100% 保持原生。
 * ④ **尊重 jQuery UI 的 cancel 语义**：`options.cancel`（默认 `input, textarea, button,
 *    select, option`）命中元素不介入——与桌面端 `_mouseDown` 的 `elIsCancel` 判定同源，
 *    保证输入框选中文字、按钮点击不被拖拽抢走。
 *
 * ## 时序（一次成功拖拽）
 *   touchstart           → 记录候选（不翻译、不 preventDefault）
 *   touchmove  < 阈值    → 不动（浏览器按原生流程走）
 *   touchmove >= 阈值    → preventDefault + 合成 mousedown（**用起点坐标**）
 *                          + 合成 mousemove（当前坐标）
 *      └ jQuery UI：_mouseDown 记录起点（distance 未达 → 不启动拖拽）→ 紧接着的 _mouseMove
 *        越过 distance → _mouseStart/_mouseDrag 按桌面端同款流程启动
 *   touchmove  (持续)    → preventDefault + 合成 mousemove
 *   touchend/touchcancel → 合成 mouseup（jQuery UI _mouseStop 收尾，并置
 *                          preventClickEvent 抑制拖拽末尾的误点）
 *
 *   —— 用**起点坐标**合成 mousedown 是关键：jQuery UI 以 `_mouseDownEvent` 为 distance
 *   基准（mouse.js:216-222），若直接给已移动的坐标，"已移动"这件事会被吃掉，起手会抖。
 *
 * ## 挂载面（两处，见 scripts/build-rp-ui.mjs）
 * - iframe vendor（`th-vendor.gen.txt`）：脚本帧内的 jQuery 实例。
 * - 宿主 vendor（`th-host-vendor.gen.txt`）：宿主 window 的 jQuery 实例——**这是主战场**：
 *   真 TH 同态下脚本经 `window.parent.$` 把 UI append 进宿主 body，用的就是宿主这份 jQuery。
 * 两处各自独立（两个 iife 各打包一份 jQuery），靠 prototype 上的标记保证幂等。
 *
 * ## 已知取舍
 * `touchstart` 不 preventDefault ⇒ 若用户「缓慢滑动且位移未越阈值」，页面可能先滚动几像素。
 * 这是刻意选择：越阈值前的触摸必须保持原生，否则点按/滚动/文本选择全会被拖拽逻辑吃掉。
 * 越阈值后立即 preventDefault，Chrome 会在该次 touchmove 起停止滚动。
 *
 * ## 可测性
 * 事件与 DOM 全部取自 `globalThis.document` / `globalThis.window`，单测可用假 DOM 桩驱动
 * 完整时序（见 packages/tests/touch-mouse-bridge.spec.ts）。
 */

/** 打到「已被 mouse 系组件初始化」元素上的标记属性（触摸翻译的唯一入口判据） */
export const DRAG_MARK = 'data-dsht-touch-drag'

/** 与 jQuery UI mouse 默认 options.cancel 同值（组件未给 cancel 时的兜底） */
export const DEFAULT_CANCEL = 'input, textarea, button, select, option'

/**
 * 进入拖拽的位移阈值（px，取 |dx| 与 |dy| 的较大者）。
 * 4px 的经验依据：低于它多为手指抖动/滚动起手，高于它用户意图已明确；
 * jQuery UI 自己的 `distance` 默认是 1（过小，触摸下会把手抖判成拖拽）。
 */
export const MOVE_THRESHOLD_PX = 4

type AnyFn = (this: unknown, ...args: unknown[]) => unknown

interface MouseWidgetLike {
  element?: unknown
  options?: { cancel?: unknown } | undefined
}

interface MousePrototypeLike {
  _mouseInit?: AnyFn
  __dshtTouchBridge?: unknown
  [key: string]: unknown
}

interface JQueryStaticLike {
  ui?: { mouse?: { prototype?: MousePrototypeLike } } | undefined
}

/** Touch 的结构面（用接口而非 DOM 的 Touch 类型，便于单测传桩对象） */
export interface TouchPointLike {
  identifier: number
  target: EventTarget | null
  screenX: number
  screenY: number
  clientX: number
  clientY: number
}

interface TouchEventLike extends Event {
  touches: ArrayLike<TouchPointLike>
  changedTouches: ArrayLike<TouchPointLike>
}

/** nodeType===1 判定（跨 realm 安全；不用 instanceof Element） */
function isElement(x: unknown): x is Element {
  return typeof x === 'object' && x !== null && (x as { nodeType?: unknown }).nodeType === 1
}

/** 从 jQuery 对象取第 0 个 DOM 元素 */
function firstElement(x: unknown): Element | null {
  if (x === null || x === undefined) return null
  const c = (x as Record<string, unknown>)[0]
  return isElement(c) ? c : null
}

/** 向上找最近的「已标记为拖拽宿主」元素 */
function findDragHost(from: Element | null): Element | null {
  let cur = from
  while (cur !== null) {
    if (cur.hasAttribute(DRAG_MARK)) return cur
    cur = cur.parentElement
  }
  return null
}

/** 向上找最近命中选择器的元素（旧内核可能无 closest，用 matches 手写遍历） */
function closestMatch(from: Element | null, selector: string): Element | null {
  if (selector === '') return null
  let cur: Element | null = from
  while (cur !== null) {
    try {
      if (cur.matches(selector)) return cur
    } catch {
      return null // 选择器非法（卡作者给怪串）：放弃 cancel 判定，不抛
    }
    cur = cur.parentElement
  }
  return null
}

/**
 * 在 jQuery 实例上安装 touch→mouse 翻译桥。
 *
 * @param $ 目标 jQuery 实例（须已挂载 jQuery UI mouse 基类，即已 require 过 draggable 等）
 * @returns true = 桥已就绪（本次安装或此前已装）；false = 环境/jquery 不满足，未安装
 */
export function installTouchMouseBridge($: unknown): boolean {
  const g = globalThis as {
    document?: Document | undefined
    window?: (Window & typeof globalThis) | undefined
  }
  const docMaybe = g.document
  const winMaybe = g.window
  if (docMaybe === undefined || winMaybe === undefined) return false
  // 窄化后钉成非空局部常量：下方 makeMouse 是闭包，TS 不会把可选属性的窄化带进闭包
  const doc: Document = docMaybe
  const win: Window & typeof globalThis = winMaybe

  const jq = $ as JQueryStaticLike | null | undefined
  const proto = jq?.ui?.mouse?.prototype
  if (proto === undefined || proto === null) return false
  const originalInit = proto._mouseInit
  if (typeof originalInit !== 'function') return false
  if (proto.__dshtTouchBridge === true) return true // 幂等：同一 jQuery 实例只装一次

  // ---------------------------------------------------------------- 事件合成

  const canConstruct = typeof win.MouseEvent === 'function'

  /**
   * 合成一个原生 MouseEvent。
   * jQuery 3 用 `jQuery.event.addProp` 在 Event.prototype 上装了 getter，直接读
   * `originalEvent.pageX / pageY / which / button / buttons`（jquery.js:5504-5537），
   * 所以必须把这几项都落到合成事件上：
   * - `which` 不是标准 MouseEvent 字段（现代浏览器为 undefined）→ 用 defineProperty 补 1；
   *   jQuery UI 的 `_mouseMove` 见 `!event.which` 会**直接判定为 mouseup**（mouse.js:155-166），
   *   漏了它拖拽会瞬间中断。
   * - `pageX/pageY` 由 clientX/clientY + 滚动量推出；原生 MouseEvent 构造器会自动算，
   *   但我们再显式补一次，兼容不自动换算的内核。
   */
  function makeMouse(type: string, p: TouchPointLike): Event {
    const cx = p.clientX
    const cy = p.clientY
    let ev: Event
    if (canConstruct) {
      ev = new win.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: win as unknown as Window,
        detail: 1,
        screenX: p.screenX,
        screenY: p.screenY,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
      })
    } else {
      // 兜底（极旧内核无 MouseEvent 构造器）：造一个普通 Event 再补字段
      ev = doc.createEvent('Event')
      ev.initEvent(type, true, true)
    }
    const patch: Record<string, number> = {
      which: type === 'mouseup' ? 0 : 1,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      clientX: cx,
      clientY: cy,
      screenX: p.screenX,
      screenY: p.screenY,
    }
    patch.pageX = cx + (win.pageXOffset ?? doc.documentElement?.scrollLeft ?? 0)
    patch.pageY = cy + (win.pageYOffset ?? doc.documentElement?.scrollTop ?? 0)
    for (const k of Object.keys(patch)) {
      try {
        Object.defineProperty(ev, k, { value: patch[k], configurable: true, enumerable: true })
      } catch { /* 个别只读字段（如 buttons）改不动：构造器已按预期设过，忽略 */ }
    }
    try {
      Object.defineProperty(ev, '__dshtSyntheticFromTouch', { value: true, configurable: true })
    } catch { /* 忽略 */ }
    return ev
  }

  // ---------------------------------------------------------------- 手势状态

  /**
   * 元素 → 该元素上 mouse 系组件的 cancel 选择器。
   * 由 `_mouseInit` 钩子直接写入（`this.options.cancel` 就是实例合并后的真实值），
   * 不去反查 `$.data(el, 'draggable')` —— jQuery UI 的实例键是 widgetFullName
   * （`ui.draggable` 经 `$.widget` 剥命名空间后为 `draggable`），逐版本核对键名是脆的；
   * 而钩子里 `this.options` 是现成的。取不到时回退 DEFAULT_CANCEL。
   */
  const cancelByElement = new WeakMap<Element, string>()

  /** 一次在途触摸（同一时刻只跟踪一个 identifier——多指缩放/双指手势不介入） */
  interface Candidate {
    id: number
    startX: number
    startY: number
    /** 起点屏幕坐标（合成 mousedown 时用，保持与原生字段语义一致） */
    startScreenX: number
    startScreenY: number
    target: Element
    host: Element
    /** 是否已越过阈值、正式进入拖拽（进入后本手势全程由本桥接管） */
    dragging: boolean
  }
  let pending: Candidate | null = null

  function onTouchStart(e: Event): void {
    if (pending !== null) return // 已在跟踪（第二指落下）：本桥不介入多指手势
    const te = e as TouchEventLike
    const list = te.changedTouches
    if (list === undefined || list.length === 0) return
    const t = list[0]
    if (t === undefined) return
    const rawTarget = t.target
    if (!isElement(rawTarget)) return
    const host = findDragHost(rawTarget)
    if (host === null) return // 不在 mouse 系组件内 → 零介入
    const cancel = cancelByElement.get(host) ?? DEFAULT_CANCEL
    if (closestMatch(rawTarget, cancel) !== null) return // 命中 cancel（输入框/按钮等）→ 交还原生
    pending = {
      id: t.identifier,
      startX: t.clientX,
      startY: t.clientY,
      startScreenX: t.screenX,
      startScreenY: t.screenY,
      target: rawTarget,
      host,
      dragging: false,
    }
    // 注意：此处**不** preventDefault（见文件头约束 ③）
  }

  /** 从触摸列表里找本次跟踪的 identifier */
  function pick(list: ArrayLike<TouchPointLike> | undefined, id: number): TouchPointLike | null {
    if (list === undefined) return null
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (t !== undefined && t.identifier === id) return t
    }
    return null
  }

  function onTouchMove(e: Event): void {
    const c = pending
    if (c === null) return
    const te = e as TouchEventLike
    // 【2026-09-14 L1 穷举修复·手势冲突面】拖拽途中第二指落下 ⇒ **放弃本次手势**，
    // 交还浏览器做双指缩放。
    //
    // 背景（L1 必测项「两指手势不被误判成拖拽」）：原实现只在 touchstart 时判多指
    // （`pending !== null` 直接 return），但**拖拽进行中**再落下第二指时没有任何处理——
    // 于是 `pick(te.touches, c.id)` 照旧取到第一指、继续 preventDefault 并合成 mousemove
    // ⇒ 用户想双指缩放，实际得到的是「浮窗跟着第一根手指乱跑」，且缩放被永久吞掉。
    //
    // 处置：一旦发现 touches.length > 1，立刻**终止本次拖拽**（补一份 mouseup，
    // 让 jQuery UI 正常收尾，不留悬空状态），并清除跟踪 ⇒ 后续移动全交还浏览器。
    if (te.touches !== undefined && te.touches.length > 1) {
      endTouch(e, true)
      return
    }
    const t = pick(te.touches, c.id)
    if (t === null) return
    if (!c.dragging) {
      const dx = t.clientX - c.startX
      const dy = t.clientY - c.startY
      if (Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD_PX) return // 未越阈值：原生流程照走
      c.dragging = true
      // 越阈值：接管手势——阻止滚动/缩放，并按桌面端时序补一份完整的 mouse 序列起点
      e.preventDefault()
      // 用**起点**坐标合成 mousedown（jQuery UI 以它为 distance 基准，见文件头说明）
      c.target.dispatchEvent(makeMouse('mousedown', {
        identifier: c.id, target: c.target,
        screenX: c.startScreenX, screenY: c.startScreenY,
        clientX: c.startX, clientY: c.startY,
      }))
    } else {
      e.preventDefault()
    }
    c.target.dispatchEvent(makeMouse('mousemove', t))
  }

  function endTouch(e: Event, cancelled: boolean): void {
    const c = pending
    if (c === null) return
    const te = e as TouchEventLike
    const t = pick(te.changedTouches, c.id) ?? pick(te.touches, c.id)
    pending = null
    if (!c.dragging) return // 未进入拖拽：全程零干预，浏览器自行合成 click
    if (t !== null) e.preventDefault()
    const last: TouchPointLike = t ?? {
      identifier: c.id, target: c.target,
      screenX: c.startScreenX, screenY: c.startScreenY,
      clientX: c.startX, clientY: c.startY,
    }
    void cancelled
    // 派发到与 mousedown 相同的 target，jQuery UI 据此置 preventClickEvent
    //（mouse.js:199-201）→ 抑制拖拽收尾时浏览器合成的那次误 click。
    c.target.dispatchEvent(makeMouse('mouseup', last))
  }

  const onTouchEnd = (e: Event): void => { endTouch(e, false) }
  const onTouchCancel = (e: Event): void => { endTouch(e, true) }

  // `touchmove` / `touchend` 必须 non-passive，否则 preventDefault 被忽略
  //（Chrome 对 document 上的这两个事件默认 passive，会静默丢弃 preventDefault）。
  // 四处都用 capture：宿主层已有其它 touch 监听时仍能先拿到事件做翻译；我们派发的合成
  // mouse 事件是在 c.target 上走**冒泡**，正好命中 jQuery UI 绑在元素/document 上的监听。
  const moveOpts = { passive: false, capture: true } as AddEventListenerOptions
  const endOpts = { passive: false, capture: true } as AddEventListenerOptions
  const passthrough = { passive: true, capture: true } as AddEventListenerOptions
  doc.addEventListener('touchstart', onTouchStart, passthrough)
  doc.addEventListener('touchmove', onTouchMove, moveOpts)
  doc.addEventListener('touchend', onTouchEnd, endOpts)
  doc.addEventListener('touchcancel', onTouchCancel, endOpts)

  // ---------------------------------------------------------------- 打标记（钩子）

  /**
   * 包装 `_mouseInit`：组件初始化时在**它自己的 element** 上打标记。
   * 只此一个钩子——不为每个 widget 单独适配。
   */
  proto._mouseInit = function patchedMouseInit(this: unknown, ...args: unknown[]): unknown {
    const inst = this as MouseWidgetLike
    const el = firstElement(inst.element)
    if (el !== null) {
      try { el.setAttribute(DRAG_MARK, '') } catch { /* 只读/异常元素：标记失败则该元素不参与触摸翻译 */ }
      // 记下该实例真实的 cancel 选择器（options.cancel 已被 widget 工厂合并过默认值）
      const c = inst.options?.cancel
      if (typeof c === 'string') cancelByElement.set(el, c)
      else if (c === false) cancelByElement.set(el, '') // 显式关掉 cancel
    }
    return originalInit.apply(this, args)
  }
  proto.__dshtTouchBridge = true
  return true
}
