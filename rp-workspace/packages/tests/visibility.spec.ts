/**
 * visibility.ts 回归：前端轮询的「页面不可见即暂停」门控。
 * ============================================================================
 * ## 这条测试守的是什么（2026-09-13 性能专项的实测缺陷）
 * 用 CDP 注入 fetch 钩子统计 60s 窗口内的真实请求量：
 *   · 可见态 **737 次 / 60s = 12.28 次/秒**
 *   · 切后台 **786 次 / 60s = 13.10 次/秒**（同时按 HOME）
 * ⇒ **切后台完全不降频**。安卓 WebView 不会自动停 JS 定时器，必须我们自己停。
 *
 * ## 判据（4 项，含反控）
 * 1. 可见时按间隔触发
 * 2. **不可见时彻底停表**（不是"回调里 return" —— 那样仍持续唤醒，省不掉功耗）
 * 3. 恢复可见时**立即补跑一次**（否则用户切回来看到的是最长一个周期的陈旧数据）
 * 4. 停止函数幂等，且与 visibilitychange 监听一并清理（不留悬挂监听）
 *
 * ## 探针要点
 * 用**假计时器**（vi.useFakeTimers）驱动，避免真等；并**手动派发 visibilitychange**
 * 来模拟前后台（不依赖真实浏览器行为）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** 最小 document 桩：只需 visibilityState + 事件派发 */
function installFakeDocument(initial: 'visible' | 'hidden') {
  const listeners = new Map<string, Set<() => void>>()
  const doc = {
    visibilityState: initial,
    addEventListener: (ev: string, fn: () => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev)!.add(fn)
    },
    removeEventListener: (ev: string, fn: () => void) => { listeners.get(ev)?.delete(fn) },
  }
  const fire = (state: 'visible' | 'hidden') => {
    ;(doc as { visibilityState: string }).visibilityState = state
    for (const fn of listeners.get('visibilitychange') ?? []) fn()
  }
  ;(globalThis as { document?: unknown }).document = doc
  return { fire, listenerCount: () => listeners.get('visibilitychange')?.size ?? 0 }
}

let restoreDoc: unknown

beforeEach(() => {
  vi.useFakeTimers()
  restoreDoc = (globalThis as { document?: unknown }).document
})
afterEach(() => {
  vi.useRealTimers()
  if (restoreDoc === undefined) delete (globalThis as { document?: unknown }).document
  else (globalThis as { document?: unknown }).document = restoreDoc
})

/** 被测模块为动态 import：确保每次拿到的是**同一实现**（模块级无状态，一次性导入即可） */
const load = async () => await import('../src/dsht-rp-ui/src/client/visibility.ts')

describe('visibility.pollWhileVisible', () => {
  it('可见时按间隔触发（正控：证明门控没有把功能关掉）', async () => {
    installFakeDocument('visible')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1 }, 1000)
    vi.advanceTimersByTime(3000)
    expect(n).toBe(3)
    stop()
  })

  it('【核心判据】不可见时**彻底停表**（不是空转跳过）', async () => {
    const { fire } = installFakeDocument('visible')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1 }, 1000)
    vi.advanceTimersByTime(2000)
    expect(n).toBe(2)

    fire('hidden')            // 切后台
    const afterHide = n
    vi.advanceTimersByTime(10_000) // 后台待 10 个周期
    // 反控要点：若实现只是"回调里 return"，这里 n 会照涨（时间仍被占用）；
    // 真正 clearInterval 后 n 必须**一动不动**。
    expect(n).toBe(afterHide)
    stop()
  })

  it('恢复可见时**立即补跑一次**，随后恢复计时', async () => {
    const { fire } = installFakeDocument('visible')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1 }, 1000)
    vi.advanceTimersByTime(1000)
    expect(n).toBe(1)

    fire('hidden')
    vi.advanceTimersByTime(5000)
    expect(n).toBe(1)          // 后台期间不涨

    fire('visible')            // 切回前台
    expect(n).toBe(2)          // 立即补跑（不等下一个周期）
    vi.advanceTimersByTime(2000)
    expect(n).toBe(4)          // 之后按间隔继续（2 次）
    stop()
  })

  it('初始即为 hidden ⇒ 不起表；转 visible 后才开始', async () => {
    const { fire } = installFakeDocument('hidden')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1 }, 1000)
    vi.advanceTimersByTime(5000)
    expect(n).toBe(0)          // 后台启动不空跑
    fire('visible')
    expect(n).toBe(1)          // 转前台立即补跑
    stop()
  })

  it('停止函数幂等，且清理 visibilitychange 监听（不留悬挂）', async () => {
    const { listenerCount } = installFakeDocument('visible')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1 }, 1000)
    expect(listenerCount()).toBe(1)
    stop()
    stop()                     // 幂等：再调不抛
    expect(listenerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(n).toBe(0)          // 停表后不再触发
  })

  it('回调抛错不会打断计时（保证"一个失败不拖垮整条轮询"）', async () => {
    installFakeDocument('visible')
    const { pollWhileVisible } = await load()
    let n = 0
    const stop = pollWhileVisible(() => { n += 1; if (n === 1) throw new Error('boom') }, 1000)
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow()
    expect(n).toBe(3)          // 第 1 次抛错后仍继续
    stop()
  })

  it('isPageVisible：无 document（SSR/测试）时视为可见，不抛', async () => {
    delete (globalThis as { document?: unknown }).document
    const { isPageVisible } = await load()
    expect(isPageVisible()).toBe(true)
  })
})
