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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

// ---------------------------------------------------------------------------
// 【L3 2026-09-14】静态护栏：前端不得有裸 setInterval 轮询（必须走门控）
// ---------------------------------------------------------------------------

/**
 * 判据来源：goal 轨道 A / A3「切后台/回前台」—— `visibility.ts` 的存在意义就是
 * 「不可见时停表」，但**漏用等于没做**。本轮穷举实测发现两处漏用
 * （RpTokenMeter 的 token 轮询、RpStateFloat 的 4s 状态轮询）⇒ 切后台仍持续
 * 每秒级唤醒（实测 13.10 次/秒，与前台同量级）。
 *
 * 判据：**客户端 bundle 源码里不得出现裸 `setInterval(`**（定时器一律走
 * `pollWhileVisible` 或其它受可见性控制的路径）。node 侧服务端 / iframe 注入脚本
 * 不受页面可见性影响，不在本判据范围（见下方白名单与说明）。
 */
describe('L3 静态护栏：客户端轮询必须走可见性门控', () => {
  it('front-end（dsht-rp-ui/src/client）零裸 setInterval', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client')
    const files = readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
    const offenders: string[] = []
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf8')
      // visibility.ts 自身是门控实现（内部当然要用 setInterval）——排除
      if (f === 'visibility.ts') continue
      // 逐行找裸调用；注释行（含 // 或 * 前缀）不算
      const lines = s.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        if (!line.includes('setInterval(')) continue
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
        offenders.push(`${f}:${i + 1}`)
      }
    }
    expect(offenders, `以下位置用了裸 setInterval（切后台不停表，耗电）——应改用 pollWhileVisible：\n${offenders.join('\n')}`).toEqual([])
  })

  it('两个曾经的漏用点确实已改走门控（回归锁）', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client')
    for (const f of ['RpTokenMeter.tsx', 'RpStateFloat.tsx']) {
      const s = readFileSync(join(dir, f), 'utf8')
      expect(s, `${f} 应 import pollWhileVisible`).toContain("from './visibility.ts'")
      expect(s, `${f} 应调用 pollWhileVisible`).toContain('pollWhileVisible(')
    }
  })
})
