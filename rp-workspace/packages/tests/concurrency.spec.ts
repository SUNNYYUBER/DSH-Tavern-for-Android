/**
 * 有界并发映射（T-70 · 心跳 63D）—— `mapBounded`
 *
 * 动因：`/rp/sessions-audit` 原实现逐个会话串行流式读日志（设备实测暖态 6.4 s / 冷态 48 s）。
 * 本文件钉住该并发原语的四条**语义契约**（顺序、上限、错误隔离、边界收敛）。
 *
 * 判据纪律（L37：断言行为不断言形状）：不检查内部实现（worker 个数、队列结构），
 * 只观测**可观测行为** —— 峰值在跑数、结果顺序、错误后其余是否照常。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAP_CONCURRENCY, mapBounded } from '../src/dsht-plugin-shared/concurrency.ts'

/** 造一个「记录并发峰值」的 worker；`gapMs` 让任务真的重叠（否则测不到并发） */
function tracker<T>(gapMs = 1) {
  let inFlight = 0
  let peak = 0
  const seen: number[] = []
  const run = async (item: T, index: number): Promise<string | null> => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    seen.push(index)
    await new Promise(r => setTimeout(r, gapMs))
    inFlight -= 1
    return `${String(item)}#${index}`
  }
  return { run, seen, peak: () => peak }
}

describe('mapBounded：顺序与全量', () => {
  it('结果顺序 == 输入顺序（按下标回填，不按完成先后）', async () => {
    // 故意让靠前的任务更慢 —— 若按完成先后回填，顺序会乱
    const items = [50, 1, 40, 1, 30, 1, 20, 1, 10, 1]
    const out = await mapBounded(items, 4, async (ms, i) => {
      await new Promise(r => setTimeout(r, ms))
      return i
    })
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('每个输入恰被处理一次（不重不漏）', async () => {
    const t = tracker<number>()
    const out = await mapBounded([...Array(23).keys()], 5, t.run)
    expect(t.seen.sort((a, b) => a - b)).toEqual([...Array(23).keys()])
    expect(out).toHaveLength(23)
    expect(out[7]).toBe('7#7')
  })
})

describe('mapBounded：并发上限（这一条是承重的）', () => {
  it('同时在跑的任务数 ≤ limit，且**确实并行**（峰值 > 1）', async () => {
    const t = tracker<number>(2)
    await mapBounded([...Array(20).keys()], 4, t.run)
    expect(t.peak()).toBeLessThanOrEqual(4)
    // 反控的另一半：limit=4 时不该退化成串行（否则这个原语在承重上等于没改）
    expect(t.peak()).toBeGreaterThan(1)
  })

  it('负控：limit=1 时峰值恰为 1（证明上一条的峰值断言真的在观测并发度）', async () => {
    const t = tracker<number>(1)
    await mapBounded([...Array(10).keys()], 1, t.run)
    expect(t.peak()).toBe(1)
  })

  it('limit > 输入条数时不炸，且仍受输入条数约束', async () => {
    const t = tracker<number>(2)
    const out = await mapBounded([1, 2, 3], 99, t.run)
    expect(out).toEqual(['1#0', '2#1', '3#2'])
    expect(t.peak()).toBe(3)
  })
})

describe('mapBounded：错误隔离与边界', () => {
  it('单个任务抛错 → 该槽为 null，其余照常（= 原实现的 catch { continue }）', async () => {
    const errors: Array<{ err: unknown; index: number }> = []
    const out = await mapBounded<number, string>(
      [0, 1, 2, 3, 4],
      3,
      async (x) => { if (x === 2) throw new Error('boom'); return `v${x}` },
      (err, index) => errors.push({ err, index }),
    )
    expect(out).toEqual(['v0', 'v1', null, 'v3', 'v4'])
    // L42：有意跳过 ≠ 可以静默 —— 错误必须能从 onError 观测到
    expect(errors).toHaveLength(1)
    expect(errors[0]?.index).toBe(2)
    expect((errors[0]?.err as Error).message).toBe('boom')
  })

  it('onError 缺省时不炸（调用方可以不关心明细，但结果仍是 null 槽）', async () => {
    const out = await mapBounded<number, string>([1, 2], 2, async () => { throw new Error('x') })
    expect(out).toEqual([null, null])
  })

  it('空输入 → []（不启动任何 worker）', async () => {
    let called = 0
    expect(await mapBounded([], 4, async () => { called += 1; return null })).toEqual([])
    expect(called).toBe(0)
  })

  it('非法 limit（0 / 负数 / NaN / 小数）收敛到 ≥1 且不炸', async () => {
    for (const bad of [0, -3, NaN, 0.4]) {
      const out = await mapBounded([0, 1, 2], bad, async (x) => x * 2)
      expect(out).toEqual([0, 2, 4])
    }
  })

  it('默认并发常量在合理区间（1 < N ≤ 32，防止有人调成 1 或 1000）', () => {
    expect(DEFAULT_MAP_CONCURRENCY).toBeGreaterThan(1)
    expect(DEFAULT_MAP_CONCURRENCY).toBeLessThanOrEqual(32)
  })
})
