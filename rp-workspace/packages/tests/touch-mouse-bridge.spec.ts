/**
 * P0-1 触屏拖拽翻译桥单测（touch-mouse-bridge.ts）。
 *
 * 为什么这组测试存在：这是「PC harness → 移动端」迁移中最容易漏的一类适配——
 * jQuery UI 只绑 mouse 事件，触摸屏不产生它们，于是所有 `.draggable()` 浮窗在手机上
 * 拖不动。真机验证成本高（要真卡 + 真手势），所以用假 DOM 桩把**完整时序**跑一遍，
 * 把判据钉死在代码里。
 *
 * 覆盖的四条设计约束（见该文件头注）：
 * ① 零侵入 jQuery UI：只包 `_mouseInit` 一个钩子
 * ② 只作用于 mouse 系组件元素：未打标记 → 全程零介入
 * ③ 点按与拖拽分道：未越阈值不 preventDefault、不合成，保持原生 click
 * ④ 尊重 options.cancel：命中输入框/按钮 → 不介入
 *
 * 另有两条「曾经踩过的坑」作为回归护栏：
 * ⑤ 合成 mousedown 必须带 `which=1`——jQuery UI 的 `_mouseMove` 见 `!event.which` 会
 *    直接判定 mouseup（mouse.js:155-166），拖拽会瞬间中断。
 * ⑥ 合成 mousedown 必须用**起点**坐标——jQuery UI 以 `_mouseDownEvent` 为 distance
 *    基准（mouse.js:216-222），给已移动的坐标会把"已移动"吃掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CANCEL, DRAG_MARK, MOVE_THRESHOLD_PX, installTouchMouseBridge,
} from '../src/dsht-rp-ui/src/client/touch-mouse-bridge.ts'

// ---------------------------------------------------------------------------
// 假 DOM：只实现桥用到的面（setAttribute/hasAttribute/parentElement/matches/
// dispatchEvent/addEventListener/ownerDocument）
// ---------------------------------------------------------------------------

interface FakeEvt {
  type: string
  target: unknown
  which?: number
  clientX?: number
  clientY?: number
  pageX?: number
  pageY?: number
  defaultPrevented: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

/** 派发到元素上的合成 mouse 事件（桥用 dispatchEvent 发出，桩里记进 dispatched） */
interface Dispatched { type: string; which: number; clientX: number; clientY: number; pageX: number }

class FakeEl {
  nodeType = 1
  parentElement: FakeEl | null = null
  private attrs = new Map<string, string>()
  private classes: string
  readonly tagName: string
  /** 本元素上收到/派发的事件记录 */
  readonly dispatched: Dispatched[] = []
  /** 直接绑在本元素上的监听（key = 'type:bubble'） */
  private listeners = new Map<string, Array<(e: FakeEvt) => void>>()
  private doc: FakeDoc | null = null
  private kids: FakeEl[] = []

  constructor(tagName = 'div', cls = '') {
    this.tagName = tagName.toUpperCase()
    this.classes = cls
  }
  get ownerDocument(): FakeDoc | null { return this.doc }
  setOwnerDocument(d: FakeDoc): void { this.doc = d; for (const k of this.kids) k.setOwnerDocument(d) }
  get firstElementChild(): FakeEl | null { return this.kids[0] ?? null }
  append(child: FakeEl): void {
    child.parentElement = this
    child.setOwnerDocument(this.resolvedDoc())
    this.kids.push(child)
  }
  /** 本元素所在 doc（自身未设时向上找父元素） */
  private resolvedDoc(): FakeDoc {
    if (this.doc !== null) return this.doc
    let cur: FakeEl | null = this.parentElement
    while (cur !== null) {
      if (cur.doc !== null) return cur.doc
      cur = cur.parentElement
    }
    throw new Error('FakeEl 未挂到任何 FakeDoc')
  }
  getAttribute(n: string): string | null { return this.attrs.get(n) ?? null }
  setAttribute(n: string, v: string): void { this.attrs.set(n, v) }
  hasAttribute(n: string): boolean { return this.attrs.has(n) }
  matches(sel: string): boolean {
    // 支持逗号分隔的选择器列表（DEFAULT_CANCEL 就是列表）+ 简单标签/类/tag[attr] 形式
    return sel.split(',').some(part => this.matchesOne(part.trim()))
  }
  private matchesOne(s: string): boolean {
    if (s === '') return false
    if (s.startsWith('.')) return this.classes.split(/\s+/).includes(s.slice(1))
    return this.tagName === s.toUpperCase()
  }
  addEventListener(type: string, fn: (e: FakeEvt) => void): void {
    const k = `${type}:bubble`
    const arr = this.listeners.get(k) ?? []
    arr.push(fn)
    this.listeners.set(k, arr)
  }
  /** 触发本元素上的监听（模拟冒泡到达本元素） */
  emit(type: string, ev: FakeEvt): void {
    for (const fn of this.listeners.get(`${type}:bubble`) ?? []) fn(ev)
  }
  /** 桥调用：记录合成事件，并把冒泡传播到自身监听 + 祖先 */
  dispatchEvent(ev: FakeEvt): boolean {
    this.dispatched.push({
      type: ev.type,
      which: Number(ev.which ?? -1),
      clientX: Number(ev.clientX ?? NaN),
      clientY: Number(ev.clientY ?? NaN),
      pageX: Number(ev.pageX ?? NaN),
    })
    let cur: FakeEl | null = this
    while (cur !== null) {
      cur.emit(ev.type, ev)
      cur = cur.parentElement
    }
    return !ev.defaultPrevented
  }
}

class FakeDoc {
  documentElement = { scrollLeft: 0, scrollTop: 0 }
  body = new FakeEl('body')
  private listeners = new Map<string, Array<(e: FakeEvt) => void>>()
  constructor() { this.body.setOwnerDocument(this) }
  createElement(tag: string, cls = ''): FakeEl {
    const el = new FakeEl(tag, cls)
    el.setOwnerDocument(this)
    return el
  }
  createEvent(): { initEvent: (t: string, b: boolean, c: boolean) => void } {
    return { initEvent: () => undefined }
  }
  addEventListener(type: string, fn: (e: FakeEvt) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(fn)
    this.listeners.set(type, arr)
  }
  /** 从 doc 层派发一个 touch 事件（桥监听的入口） */
  emit(type: string, ev: FakeEvt): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev)
  }
  get hasTouchListeners(): boolean { return this.listeners.size > 0 }
}

class FakeWin {
  pageXOffset = 0
  pageYOffset = 0
  MouseEvent = class {
    type: string
    which = 0
    clientX: number
    clientY: number
    screenX: number
    screenY: number
    pageX = 0
    pageY = 0
    defaultPrevented = false
    constructor(type: string, init?: Record<string, number>) {
      this.type = type
      this.clientX = Number(init?.clientX ?? 0)
      this.clientY = Number(init?.clientY ?? 0)
      this.screenX = Number(init?.screenX ?? 0)
      this.screenY = Number(init?.screenY ?? 0)
    }
    preventDefault(): void { this.defaultPrevented = true }
    stopPropagation(): void { /* noop */ }
  }
}

/** 取假 MouseEvent 类（供断言 pageX 计算用） */
function makeTouchEvt(type: string, touches: Array<Record<string, number>>, target: FakeEl): FakeEvt {
  const mk = (t: Record<string, number>): Record<string, unknown> => ({
    identifier: t.identifier ?? 1,
    target,
    screenX: t.screenX ?? t.clientX ?? 0,
    screenY: t.screenY ?? t.clientY ?? 0,
    clientX: t.clientX ?? 0,
    clientY: t.clientY ?? 0,
  })
  const changed = touches.map(mk)
  const ev = {
    type,
    target,
    defaultPrevented: false,
    preventDefault(): void { (ev as { defaultPrevented: boolean }).defaultPrevented = true },
    stopPropagation(): void { /* noop */ },
    // 桥读 te.touches / te.changedTouches（鸭子类型）
    ...(type === 'touchend'
      ? { touches: [] as unknown[], changedTouches: changed }
      : { touches: changed, changedTouches: changed }),
  }
  return ev as unknown as FakeEvt
}

/** 造一个「已装 jQuery UI mouse 基类」的假 jQuery + 假 window/document 环境 */
function setupEnv(): {
  doc: FakeDoc
  win: FakeWin
  jq: Record<string, unknown>
  proto: Record<string, unknown>
  $$: FakeEl
  inner: FakeEl
  input: FakeEl
} {
  const doc = new FakeDoc()
  const win = new FakeWin()
  // 元素树：host（待打标记的元素）→ inner；另起一棵 outside → input 用于 cancel 判定
  const host = doc.createElement('div')
  const inner = doc.createElement('span')
  host.append(inner)
  const outside = doc.createElement('div')
  const input = doc.createElement('input')
  outside.append(input)
  doc.body.append(host)
  doc.body.append(outside)

  // 假 $.ui.mouse.prototype（记录 originalInit 是否被调用）
  const calls: string[] = []
  const proto: Record<string, unknown> = {
    _mouseInit(): void { calls.push('orig') },
  }
  const jq: Record<string, unknown> = { ui: { mouse: { prototype: proto } }, __calls: calls }
  ;(globalThis as Record<string, unknown>).document = doc
  ;(globalThis as Record<string, unknown>).window = win
  return { doc, win, jq, proto, $$: host, inner, input }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document
  delete (globalThis as Record<string, unknown>).window
})

/** 便捷：装桥 + 手动触发 host 的 _mouseInit（模拟 .draggable() 初始化） */
function installAndInit(env: ReturnType<typeof setupEnv>): void {
  installTouchMouseBridge(env.jq)
  const proto = env.proto as {
    _mouseInit: (this: unknown) => void
  }
  // 模拟 jQuery UI widget 工厂调用 _mouseInit，this = 实例（element 为 jQuery 对象）
  proto._mouseInit.call({ element: Object.assign([env.$$], { 0: env.$$ }), options: {} })
}

// ---------------------------------------------------------------------------
// ② 安装与幂等
// ---------------------------------------------------------------------------

describe('安装与幂等', () => {
  it('jQuery 无 $.ui.mouse.prototype → 返回 false，不装（环境不满足不静默假装成功）', () => {
    const doc = new FakeDoc()
    ;(globalThis as Record<string, unknown>).document = doc
    ;(globalThis as Record<string, unknown>).window = new FakeWin()
    expect(installTouchMouseBridge({})).toBe(false)
    expect(installTouchMouseBridge({ ui: {} })).toBe(false)
    expect(installTouchMouseBridge({ ui: { mouse: {} } })).toBe(false)
  })

  it('正常环境 → 返回 true；重复调用幂等（不重复挂监听、不二次包 _mouseInit）', () => {
    const env = setupEnv()
    expect(installTouchMouseBridge(env.jq)).toBe(true)
    const patched = env.proto._mouseInit
    expect(installTouchMouseBridge(env.jq)).toBe(true)
    expect(env.proto._mouseInit).toBe(patched) // 未被二次包装
  })

  it('① 只包 _mouseInit 一个钩子：不新增/改动 $.ui.mouse.prototype 上的其它成员', () => {
    const env = setupEnv()
    const before = new Set(Object.keys(env.proto))
    installTouchMouseBridge(env.jq)
    const added = Object.keys(env.proto).filter(k => !before.has(k))
    // 只允许新增我们自己的标记位
    expect(added).toEqual(['__dshtTouchBridge'])
  })

  it('_mouseInit 包装后仍会调用原实现（不吞掉 jQuery UI 自己的初始化）', () => {
    const env = setupEnv()
    installAndInit(env)
    expect((env.jq.__calls as string[])).toContain('orig')
  })

  it('② 组件初始化时在自己的 element 上打 DRAG_MARK 标记', () => {
    const env = setupEnv()
    expect(env.$$.hasAttribute(DRAG_MARK)).toBe(false)
    installAndInit(env)
    expect(env.$$.hasAttribute(DRAG_MARK)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ② 只作用于被标记的元素
// ---------------------------------------------------------------------------

describe('② 零介入判据（未打标记 → 全程不管）', () => {
  it('触摸起点不在标记元素内 → touchmove 不 preventDefault、不合成任何 mouse 事件', () => {
    const env = setupEnv()
    installTouchMouseBridge(env.jq) // 注意：不调 _mouseInit ⇒ 无标记
    const target = env.doc.createElement('div')
    env.doc.body.append(target)
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 10, clientY: 10 }], target))
    const mv = makeTouchEvt('touchmove', [{ clientX: 60, clientY: 60 }], target)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(false)
    expect(target.dispatched).toEqual([])
  })

  it('标记元素内的触摸 → 越阈值后合成 mouse 序列', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.inner // 摸在标记元素的内层子元素上（真实场景：摸浮窗内容）
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 10, clientY: 10 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 80, clientY: 80 }], target))
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove'])
  })

  // -------------------------------------------------------------------------
  // 【2026-09-14 L1 穷举修复】双指手势不得被误判成拖拽
  // -------------------------------------------------------------------------

  it('✅ 拖拽途中第二指落下 ⇒ 终止本次拖拽（补 mouseup）且不再合成 mousemove', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.inner
    // 第一指落下并越过阈值 → 已进入拖拽
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ identifier: 1, clientX: 10, clientY: 10 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ identifier: 1, clientX: 80, clientY: 80 }], target))
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove'])

    // 第二指落下（双指缩放意图）→ 必须终止拖拽
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [
      { identifier: 1, clientX: 85, clientY: 85 },
      { identifier: 2, clientX: 40, clientY: 40 },
    ], target))
    // 收尾一次 mouseup（不让 jQuery UI 悬在拖拽中），且**没有**新的 mousemove
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove', 'mouseup'])
  })

  it('✅ 双指落下后，第一指继续移动也不再合成任何 mouse 事件（手势已交还浏览器）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.inner
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ identifier: 1, clientX: 10, clientY: 10 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ identifier: 1, clientX: 80, clientY: 80 }], target))
    // 第二指落下 → 终止
    const twoFinger = makeTouchEvt('touchmove', [
      { identifier: 1, clientX: 85, clientY: 85 },
      { identifier: 2, clientX: 40, clientY: 40 },
    ], target)
    env.doc.emit('touchmove', twoFinger)
    const countAfterCancel = target.dispatched.length

    // 第一指继续移动（此时 touches 仍为 2）
    const after = makeTouchEvt('touchmove', [
      { identifier: 1, clientX: 200, clientY: 200 },
      { identifier: 2, clientX: 40, clientY: 40 },
    ], target)
    env.doc.emit('touchmove', after)
    expect(target.dispatched.length).toBe(countAfterCancel)   // 零新增
    // 且不再 preventDefault（缩放手势必须交还浏览器）
    expect(after.defaultPrevented).toBe(false)
  })

  it('负控：单指拖拽全程不受该修复影响（仍照常合成 mousedown/mousemove/mouseup）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.inner
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ identifier: 1, clientX: 10, clientY: 10 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ identifier: 1, clientX: 60, clientY: 60 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ identifier: 1, clientX: 90, clientY: 90 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ identifier: 1, clientX: 90, clientY: 90 }], target))
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove', 'mousemove', 'mouseup'])
  })
})

// ---------------------------------------------------------------------------
// ③ 点按与拖拽分道
// ---------------------------------------------------------------------------

describe('③ 点按与拖拽分道', () => {
  it('未越阈值的小抖动 → 全程零干预（不 preventDefault、不合成）⇒ 原生 click 得以保留', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 100, clientY: 100 }], target))
    const jitter = MOVE_THRESHOLD_PX - 1
    const mv = makeTouchEvt('touchmove', [{ clientX: 100 + jitter, clientY: 100 }], target)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(false)
    const end = makeTouchEvt('touchend', [{ clientX: 100 + jitter, clientY: 100 }], target)
    env.doc.emit('touchend', end)
    expect(end.defaultPrevented).toBe(false)
    expect(target.dispatched).toEqual([]) // 一个 mouse 事件都没合成
  })

  it('恰好达到阈值 → 进入拖拽（边界取 >=）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], target))
    const mv = makeTouchEvt('touchmove', [{ clientX: MOVE_THRESHOLD_PX, clientY: 0 }], target)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(true)
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove'])
  })

  it('越阈值后每次 touchmove 都 preventDefault（阻止页面滚动）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 40, clientY: 0 }], target))
    const mv2 = makeTouchEvt('touchmove', [{ clientX: 90, clientY: 0 }], target)
    env.doc.emit('touchmove', mv2)
    expect(mv2.defaultPrevented).toBe(true)
    // 只合成一次 mousedown（起手），后续只有 mousemove
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove', 'mousemove'])
  })

  it('touchend → 合成 mouseup；未进入拖拽的 touchend 不合成也不 preventDefault', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 50, clientY: 0 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ clientX: 50, clientY: 0 }], target))
    expect(target.dispatched.map(d => d.type)).toEqual(['mousedown', 'mousemove', 'mouseup'])
  })

  it('一次拖拽结束后状态复位：下一次触摸重新从候选开始（不残留 dragging）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    // 第一次：完整拖拽
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 50, clientY: 0 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ clientX: 50, clientY: 0 }], target))
    const n = target.dispatched.length
    // 第二次：只是轻点
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 1, clientY: 0 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ clientX: 1, clientY: 0 }], target))
    expect(target.dispatched.length).toBe(n) // 轻点零合成
  })

  it('多指手势（第二指落下）不介入：pending 已存在时忽略后续 touchstart', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ identifier: 1, clientX: 0, clientY: 0 }], target))
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ identifier: 2, clientX: 30, clientY: 30 }], target))
    // 第二指的事件不该被跟踪：identifier=2 的 move 找不到候选 → 零合成
    const mv = makeTouchEvt('touchmove', [{ identifier: 2, clientX: 90, clientY: 90 }], target)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(false)
    expect(target.dispatched).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ④ cancel 语义
// ---------------------------------------------------------------------------

describe('④ 尊重 jQuery UI 的 options.cancel', () => {
  it('触摸起点命中 input（默认 cancel）→ 不介入', () => {
    const env = setupEnv()
    installAndInit(env)
    // 把 input 放进标记元素内（模拟浮窗里有输入框）
    env.$$.append(env.input)
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], env.input))
    const mv = makeTouchEvt('touchmove', [{ clientX: 60, clientY: 0 }], env.input)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(false)
    expect(env.input.dispatched).toEqual([])
  })

  it('组件自定义 cancel 生效（this.options.cancel 被采纳）', () => {
    const env = setupEnv()
    installTouchMouseBridge(env.jq)
    const proto = env.proto as { _mouseInit: (this: unknown) => void }
    proto._mouseInit.call({ element: Object.assign([env.$$], { 0: env.$$ }), options: { cancel: '.no-drag' } })
    const blocked = env.doc.createElement('div', 'no-drag')
    env.$$.append(blocked)
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], blocked))
    const mv = makeTouchEvt('touchmove', [{ clientX: 60, clientY: 0 }], blocked)
    env.doc.emit('touchmove', mv)
    expect(mv.defaultPrevented).toBe(false)
    // 反向：同一浮窗里未命中 .no-drag 的子元素照常可拖
    const free = env.doc.createElement('span')
    env.$$.append(free)
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 0, clientY: 0 }], free))
    const mv2 = makeTouchEvt('touchmove', [{ clientX: 60, clientY: 0 }], free)
    env.doc.emit('touchmove', mv2)
    expect(mv2.defaultPrevented).toBe(true)
  })

  it('DEFAULT_CANCEL 与 jQuery UI mouse 默认值一致', () => {
    expect(DEFAULT_CANCEL).toBe('input, textarea, button, select, option')
  })
})

// ---------------------------------------------------------------------------
// ⑤⑥ 两个「曾经会踩」的坑（回归护栏）
// ---------------------------------------------------------------------------

describe('⑤⑥ 合成事件的字段正确性', () => {
  it('⑤ 合成 mousedown/mousemove 的 which=1（否则 jQuery UI 立即判 mouseup，拖拽瞬断）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 5, clientY: 5 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 60, clientY: 5 }], target))
    const down = target.dispatched.find(d => d.type === 'mousedown')
    const move = target.dispatched.find(d => d.type === 'mousemove')
    expect(down?.which).toBe(1)
    expect(move?.which).toBe(1)
  })

  it('⑤ 合成 mouseup 的 which=0（jQuery UI 的 mouseup 语义）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 5, clientY: 5 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 60, clientY: 5 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ clientX: 60, clientY: 5 }], target))
    const up = target.dispatched.find(d => d.type === 'mouseup')
    expect(up?.which).toBe(0)
  })

  it('⑥ 合成 mousedown 用**起点**坐标（越过阈值的那次 move 坐标不能当起点）', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 10, clientY: 20 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 200, clientY: 300 }], target))
    const down = target.dispatched.find(d => d.type === 'mousedown')
    expect(down?.clientX).toBe(10)
    expect(down?.clientY).toBe(20)
    // mousemove 则是当前位置
    const move = target.dispatched.find(d => d.type === 'mousemove')
    expect(move?.clientX).toBe(200)
    expect(move?.clientY).toBe(300)
  })

  it('合成事件的 pageX 叠加了页面滚动量（jQuery UI 用 pageX/pageY 算位置）', () => {
    const env = setupEnv()
    installAndInit(env)
    env.win.pageXOffset = 7
    env.win.pageYOffset = 11
    const target = env.$$
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 10, clientY: 20 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 100, clientY: 100 }], target))
    const down = target.dispatched.find(d => d.type === 'mousedown')
    expect(down?.pageX).toBe(17) // 10 + 7
  })
})

// ---------------------------------------------------------------------------
// 合成事件真的能被「只认 mouse 事件」的消费者收到（端到端语义）
// ---------------------------------------------------------------------------

describe('端到端：合成事件走冒泡能被元素上的 mouse 消费者收到', () => {
  it('元素上绑 mousedown/mousemove/mouseup 的消费者收到完整序列且坐标正确', () => {
    const env = setupEnv()
    installAndInit(env)
    const target = env.$$
    const seen: Array<{ type: string; x: number }> = []
    target.addEventListener('mousedown', e => { seen.push({ type: 'mousedown', x: Number(e.clientX) }) })
    target.addEventListener('mousemove', e => { seen.push({ type: 'mousemove', x: Number(e.clientX) }) })
    target.addEventListener('mouseup', e => { seen.push({ type: 'mouseup', x: Number(e.clientX) }) })
    env.doc.emit('touchstart', makeTouchEvt('touchstart', [{ clientX: 3, clientY: 3 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 44, clientY: 3 }], target))
    env.doc.emit('touchmove', makeTouchEvt('touchmove', [{ clientX: 88, clientY: 3 }], target))
    env.doc.emit('touchend', makeTouchEvt('touchend', [{ clientX: 99, clientY: 3 }], target))
    expect(seen).toEqual([
      { type: 'mousedown', x: 3 },
      { type: 'mousemove', x: 44 },
      { type: 'mousemove', x: 88 },
      { type: 'mouseup', x: 99 },
    ])
  })
})

// 未使用导入占位（vi 保留给将来的时序断言）
void vi
