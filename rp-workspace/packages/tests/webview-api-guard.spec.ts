/**
 * L4：旧 WebView 现代 API 守卫（`dsht-plugin-shared/webview-api-guard.ts`）单测。
 *
 * ## 为什么这组测试存在
 * L4 必测项「旧 WebView API 缺口穷举（含 typeof 陷阱系统扫描）」的穷举结论暴露了
 * 一个**系统性缺陷**：同一 API 在本仓**有守卫与无守卫混用**（实测漏 8 处，其中
 * `display-compiler.ts` 的 `.at(-1)` 在**显示渲染主路径**上）。根因是「守卫是能力契约，
 * 却散落在各调用点」——新增代码是否加守卫全凭记性（P-1 反例）。
 *
 * 修法是「安装期统一补齐」：此后所有调用点零心智负担。本组测试钉住四条不变量：
 *   ① 缺什么补什么，且**补完真的可用**（正控：调用不再抛）；
 *   ② **幂等**：已有能力一律不动、可重复调用（防重复包装）；
 *   ③ 环境完备时**零改动**（负控：不能把好好的实现换掉）；
 *   ④ **出声依据**：报告如实反映「补了什么 / 缺什么」（R8：不许静默）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureWebviewApiGuard, type GuardTarget } from '../src/dsht-plugin-shared/webview-api-guard.ts'

const here = import.meta.dirname
function src(rel: string): string {
  return readFileSync(join(here, '..', 'src', rel), 'utf8')
}

/** 造一个「什么都没有」的老内核全局桩 */
function oldKernel(): GuardTarget {
  return {
    // 故意不提供 crypto.randomUUID / structuredClone / queueMicrotask / Object.hasOwn /
    // Array.prototype.at / AbortSignal.any
    crypto: {},
    Array: { prototype: {} },
    Object: {},
    Promise,
    AbortSignal: {},
  }
}

describe('L4 能力补齐：缺什么补什么（正控）', () => {
  it('老内核 ⇒ 六个能力全部补上，且报告如实列出', () => {
    const g = oldKernel()
    const r = ensureWebviewApiGuard(g)
    expect(r.polyfilled.sort()).toEqual([
      'AbortSignal.any',
      'Array.prototype.at',
      'Object.hasOwn',
      'crypto.randomUUID',
      'queueMicrotask',
      'structuredClone',
    ].sort())
    expect(r.missing).toEqual([])
  })

  it('✅ 补完后**真的可用**：crypto.randomUUID 返回合法 v4 格式', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const uuid = (g.crypto as { randomUUID: () => string }).randomUUID()
    // RFC 4122 v4：8-4-4-4-12，且第 3 段以 4 开头
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('✅ Array.prototype.at 语义与原生一致（负数索引从尾部取）', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const at = (g.Array?.prototype as { at: (i: number) => unknown }).at
    const arr = ['a', 'b', 'c']
    expect(at.call(arr, -1)).toBe('c')      // 这正是 display-compiler.ts:237 的用法
    expect(at.call(arr, -3)).toBe('a')
    expect(at.call(arr, 0)).toBe('a')
    expect(at.call(arr, 2)).toBe('c')
    expect(at.call(arr, -4)).toBeUndefined() // 越界 → undefined（不抛）
    expect(at.call(arr, 99)).toBeUndefined()
    expect(at.call([], 0)).toBeUndefined()
  })

  it('✅ structuredClone 兜底为 JSON 深拷贝（变量树场景够用，且不共享引用）', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const clone = (g.structuredClone as <T>(v: T) => T)
    const src = { a: 1, b: { c: [1, 2] } }
    const out = clone(src)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
    expect(out.b).not.toBe(src.b)          // 深拷贝（无共享引用）
  })

  it('✅ Object.hasOwn 与静态原型一致（不看原型链）', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const hasOwn = (g.Object as { hasOwn: (o: unknown, k: string) => boolean }).hasOwn
    expect(hasOwn({ a: 1 }, 'a')).toBe(true)
    expect(hasOwn({ a: 1 }, 'toString')).toBe(false)  // 原型链上的不算 own
    expect(hasOwn({}, 'a')).toBe(false)
  })

  it('✅ queueMicrotask 兜底真的异步执行（不吞回调）', async () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const qm = g.queueMicrotask as (fn: () => void) => void
    let ran = false
    qm(() => { ran = true })
    expect(ran).toBe(false)               // 同步阶段不应执行
    await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('✅ AbortSignal.any：任一信号已中止 ⇒ 立即中止；否则跟随首个中止', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const any = (g.AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any
    // 已中止的信号 → 结果立即 aborted
    const pre = new AbortController(); pre.abort()
    expect(any([pre.signal]).aborted).toBe(true)
    // 未中止 → 跟随
    const c1 = new AbortController()
    const merged = any([c1.signal])
    expect(merged.aborted).toBe(false)
    c1.abort()
    expect(merged.aborted).toBe(true)
  })

  it('边界：无 Promise ⇒ queueMicrotask 记入 missing（不假装成功）', () => {
    const g = oldKernel()
    delete (g as Record<string, unknown>).Promise
    const r = ensureWebviewApiGuard(g)
    expect(r.missing.some(m => m.includes('queueMicrotask'))).toBe(true)
    expect(r.polyfilled).not.toContain('queueMicrotask')
  })
})

describe('L4 能力补齐：幂等与环境完备时零改动（负控）', () => {
  it('✅ 幂等：连续调用两次，补的东西不被二次包装（函数引用相同）', () => {
    const g = oldKernel()
    ensureWebviewApiGuard(g)
    const first = (g.crypto as { randomUUID: unknown }).randomUUID
    const firstAt = (g.Array?.prototype as { at: unknown }).at
    const r2 = ensureWebviewApiGuard(g)
    expect(r2.polyfilled).toEqual([])                              // 第二次无事可做
    expect((g.crypto as { randomUUID: unknown }).randomUUID).toBe(first)
    expect((g.Array?.prototype as { at: unknown }).at).toBe(firstAt)
  })

  it('负控：环境已完备 ⇒ 一个都不动（不覆盖、不包装）', () => {
    const native = {
      randomUUID: () => 'native',
      structuredClone: () => 'native',
      queueMicrotask: () => undefined,
      any: () => 'native',
      at: () => 'native',
      hasOwn: () => true,
    }
    const g: GuardTarget = {
      crypto: { randomUUID: native.randomUUID },
      structuredClone: native.structuredClone,
      queueMicrotask: native.queueMicrotask,
      Array: { prototype: { at: native.at } },
      Object: { hasOwn: native.hasOwn },
      AbortSignal: { any: native.any },
      Promise,
    }
    const r = ensureWebviewApiGuard(g)
    expect(r.polyfilled).toEqual([])
    expect(r.missing).toEqual([])
    // 全部保持原引用（未被替换/包装）
    expect((g.crypto as { randomUUID: unknown }).randomUUID).toBe(native.randomUUID)
    expect((g.Array?.prototype as Record<string, unknown>).at).toBe(native.at)
    expect((g as { structuredClone: unknown }).structuredClone).toBe(native.structuredClone)
    expect((g.Object as { hasOwn: unknown }).hasOwn).toBe(native.hasOwn)
    expect((g.AbortSignal as { any: unknown }).any).toBe(native.any)
    expect((g as { queueMicrotask: unknown }).queueMicrotask).toBe(native.queueMicrotask)
  })

  it('负控：无 crypto / 无 Array.prototype ⇒ 记 missing 而非抛错', () => {
    const g: GuardTarget = { Object: {}, Promise }
    const r = ensureWebviewApiGuard(g)
    expect(r.missing).toContain('crypto')
    expect(r.missing).toContain('Array.prototype')
    expect(r.missing).toContain('AbortSignal')
  })
})

// ---------------------------------------------------------------------------
// 静态护栏：安装入口必须存在（防「加了调用点却忘了装守卫」）
//   —— 这是本轮穷举暴露的根因：守卫是能力契约，散落调用点 → 新代码必然漏。
//      唯一治法是「安装期补齐 + 入口存在性有护栏」，调用点零心智负担。
// ---------------------------------------------------------------------------

describe('L4 静态护栏：能力补齐入口必须被两个 client bundle 安装', () => {
  it('dsht-rp-ui 的 apply() 必须调用 ensureWebviewApiGuard', () => {
    const s = src('dsht-rp-ui/src/client/index.tsx')
    expect(s).toContain('ensureWebviewApiGuard()')
  })

  it('dsht-plugin-mobile 的 apply() 必须调用 ensureWebviewApiGuard（独立 bundle，不能假设对方先跑）', () => {
    const s = src('dsht-plugin-mobile/client/index.tsx')
    expect(s).toContain('ensureWebviewApiGuard()')
  })

  it('实现只允许有一处（P-1）：两个 bundle 都 import 共享层，不得各写一份', () => {
    const a = src('dsht-rp-ui/src/client/index.tsx')
    const b = src('dsht-plugin-mobile/client/index.tsx')
    for (const s of [a, b]) {
      expect(s).toContain('dsht-plugin-shared/webview-api-guard')
    }
    // 旧的本地实现（ensureAbortSignalAny）不得复现——它已被收口到共享层
    expect(a).not.toContain('function ensureAbortSignalAny')
  })

  it('补齐必须**出声**（R8）：非空 polyfilled 要 warn，不许静默', () => {
    const s = src('dsht-rp-ui/src/client/index.tsx')
    expect(s).toMatch(/polyfilled\.length\s*>\s*0/)
    expect(s).toContain('console.warn')
  })
})
