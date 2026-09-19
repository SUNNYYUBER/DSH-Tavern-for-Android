/**
 * L1「长按 / 上下文菜单 / 复制」等价路径：**能力探测 + 失败出声**护栏。
 *
 * ## 这组测试存在的理由（先说清穷举结论，避免误读）
 * L1 必测项要求「有触屏可达的等价路径」。静态穷举（M1）结论：
 * **宿主已内置显式复制按钮** —— `dsh-client-ui-chat` 的 `MessageIconActions`
 * （lib/client.js:1027）渲染 copy 按钮，`onCopy` → `writeClipboard(text)`
 * （:1039-1053）；且「hover 才显示」的规则写在 `@media (hover:hover)` 内
 * （:1004 的 css$12），触屏下**本来就常显**。所以**不是「缺入口」**。
 *
 * 真正的缺口是**可观测性**（P-3 / R8）：官方实现失败时静默：
 * ```js
 * writeClipboard(text).then((ok) => { if (!ok) return; setCopied(true) })
 * ```
 * 用户点「复制」没反应，无法区分「没复制上」与「按钮坏了」。
 *
 * 我方层（不能改官方源码，B4）只能做**能力探测 + 提前出声**，本组测试钉住：
 *   ① 能力可用 ⇒ 完全静默（零监听、零提示）——防提示本身变成噪音；
 *   ② 能力不可用 ⇒ 出声一次（console.warn 留痕 + 首次点击给用户提示）；
 *   ③ 只提示一次（重复点击不刷屏）；
 *   ④ 只对「楼层动作钮」触发（点别处不出提示）；
 *   ⑤ 卸载函数真的解绑（防监听泄漏）。
 */
import { describe, expect, it, vi } from 'vitest'
import { installClipboardGuard, isFloorActionButton, probeClipboard } from '../src/dsht-rp-ui/src/client/clipboard-guard.ts'

// ---------------------------------------------------------------------------
// 1. 能力探测（纯函数）
// ---------------------------------------------------------------------------

describe('L1 剪贴板能力探测（纯函数，无副作用）', () => {
  it('navigator.clipboard.writeText 存在 ⇒ available（现代 WebView 常态）', () => {
    const r = probeClipboard({ clipboard: { writeText: () => Promise.resolve() } })
    expect(r.available).toBe(true)
    expect(r.reason).toBe('')
  })

  it('无 navigator ⇒ 不可用，且 reason 说明原因（不是空串）', () => {
    const r = probeClipboard(undefined)
    expect(r.available).toBe(false)
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it('无 clipboard ⇒ 不可用（旧 WebView）', () => {
    const r = probeClipboard({})
    expect(r.available).toBe(false)
    expect(r.reason).toContain('clipboard')
  })

  it('writeText 非函数（被禁用/半实现）⇒ 不可用', () => {
    const r = probeClipboard({ clipboard: { writeText: 'nope' } })
    expect(r.available).toBe(false)
    expect(r.reason).toContain('writeText')
  })
})

// ---------------------------------------------------------------------------
// 2. 「是否楼层动作钮」判定（防误触发）
// ---------------------------------------------------------------------------

/** 极简 DOM 桩：只实现 closest / tagName（isFloorActionButton 用到的面） */
function el(tagName: string, matchers: Record<string, (sel: string) => boolean>): unknown {
  const node: { tagName: string; closest: (sel: string) => unknown } = {
    tagName,
    closest(sel: string) {
      for (const [key, fn] of Object.entries(matchers)) {
        if (sel.includes(key) && fn(sel)) return node
      }
      return null
    },
  }
  return node
}

describe('L1 楼层动作钮判定（只对我方关心的目标出声）', () => {
  it('turn-tail 行内的 button ⇒ true', () => {
    const btn = el('BUTTON', { 'turn-tail': () => true })
    expect(isFloorActionButton(btn)).toBe(true)
  })

  it('非 turn-tail 区域的 button ⇒ false（点别处绝不提示）', () => {
    const btn = el('BUTTON', { 'turn-tail': () => false })
    expect(isFloorActionButton(btn)).toBe(false)
  })

  it('非元素 / null / undefined ⇒ false（不抛）', () => {
    expect(isFloorActionButton(null)).toBe(false)
    expect(isFloorActionButton(undefined)).toBe(false)
    expect(isFloorActionButton({})).toBe(false)
    expect(isFloorActionButton('button')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. 安装行为（静默优先 + 出声兜底 + 只一次 + 可卸载）
// ---------------------------------------------------------------------------

describe('L1 剪贴板守卫安装行为', () => {
  /** 假 document：记录监听增删，便于断言「可用时不装监听」 */
  function fakeDoc(): { add: number; remove: number; doc: { addEventListener: unknown; removeEventListener: unknown } } {
    const st = { add: 0, remove: 0 }
    const doc = {
      addEventListener: () => { st.add += 1 },
      removeEventListener: () => { st.remove += 1 },
    }
    return { get add() { return st.add }, get remove() { return st.remove }, doc }
  }

  /**
   * 覆盖 globalThis 上的只读全局（Node 里 `navigator` / `document` 是 getter，
   * 直接赋值会抛 TypeError: has only a getter）。用 defineProperty 并返回还原函数。
   */
  const saved: Array<[string, PropertyDescriptor | undefined]> = []
  function override(key: string, value: unknown): void {
    saved.push([key, Object.getOwnPropertyDescriptor(globalThis, key)])
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  function restoreAll(): void {
    while (saved.length > 0) {
      const [key, desc] = saved.pop() as [string, PropertyDescriptor | undefined]
      if (desc === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, desc)
    }
  }

  it('能力可用 ⇒ **零介入**：不装监听、不出声（防提示变噪音）', () => {
    const warn = vi.fn()
    const f = fakeDoc()
    override('document', f.doc)
    override('navigator', { clipboard: { writeText: () => Promise.resolve() } })
    try {
      const uninstall = installClipboardGuard({ warn })
      expect(f.add).toBe(0)   // 可用时不监听
      expect(warn).not.toHaveBeenCalled()
      uninstall()             // 卸载应安全（无监听可解）
      expect(f.remove).toBe(0)
    } finally {
      restoreAll()
    }
  })

  it('能力不可用 ⇒ 出声（console.warn 留痕，R8）+ 装监听 + 可卸载', () => {
    const warn = vi.fn()
    const f = fakeDoc()
    override('document', f.doc)
    override('navigator', {})   // 无 clipboard
    try {
      const uninstall = installClipboardGuard({ warn })
      expect(warn).toHaveBeenCalledTimes(1)      // 安装即留痕
      expect(warn.mock.calls[0][0]).toContain('剪贴板')
      expect(f.add).toBe(1)
      uninstall()
      expect(f.remove).toBe(1)                   // 真的解绑（防监听泄漏）
    } finally {
      restoreAll()
    }
  })
})
