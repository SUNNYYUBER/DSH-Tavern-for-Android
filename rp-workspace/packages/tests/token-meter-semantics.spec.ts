/**
 * F4 计量口径单测：**给用户看的数字必须口径诚实**。
 *
 * ## 为什么这组测试存在
 * 用户实测（2026-09-14）进度条显示 `≈ 1.1M / 16.4k tokens` —— 分子远大于分母，
 * 而且分母是把「拉不到预设时的占位值」当成了模型真实能力。三处失真：
 *   ① 预算只有「预设 maxContext → 占位 16384」两档，缺「模型真实能力」这一档；
 *   ② 估算只按字符数 ÷ 2.5，不含系统提示/世界书/工具定义；
 *   ③ 被回退移出上下文的消息**仍被计入**占用。
 *
 * 设计原则（P-6 计量可信度）：**错的口径比没有更糟**。
 * 因此本组测试的判据是：**数字旁边必须能说出它是哪来的**。
 */
import { describe, expect, it } from 'vitest'
import {
  CHARS_PER_TOKEN, DEFAULT_MAX_CONTEXT,
  buildMeterReading, estimateTokens, formatTokens, isTrustworthy, meterLevel,
  meterPercent, originLabel, sumMessageChars,
} from '../src/dsht-rp-ui/src/client/token-meter-core.ts'

// ---------------------------------------------------------------------------
// 1. 预算来源优先级（F4 的核心修正）
// ---------------------------------------------------------------------------

describe('预算来源优先级：模型目录 > 预设 > 占位（unknown）', () => {
  it('有模型目录能力 → 用它，并标注 model-catalog', () => {
    const r = buildMeterReading({ estimatedTokens: 1000, modelContextWindow: 1_000_000, presetMaxContext: 16384 })
    expect(r.budget).toBe(1_000_000)
    expect(r.budgetOrigin).toBe('model-catalog')
    expect(isTrustworthy(r.budgetOrigin)).toBe(true)
  })

  it('无模型目录、有预设 → 用预设，并标注 preset', () => {
    const r = buildMeterReading({ estimatedTokens: 1000, presetMaxContext: 32768 })
    expect(r.budget).toBe(32768)
    expect(r.budgetOrigin).toBe('preset')
    expect(isTrustworthy(r.budgetOrigin)).toBe(true)
  })

  it('两个都没有 → 占位值 + **标注 unknown**（不许装作准确）', () => {
    const r = buildMeterReading({ estimatedTokens: 1000 })
    expect(r.budget).toBe(DEFAULT_MAX_CONTEXT)
    expect(r.budgetOrigin).toBe('unknown')
    expect(isTrustworthy(r.budgetOrigin)).toBe(false)
  })

  it('非法/零/负数预算一律视为缺失（不把 0 当有效能力）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = buildMeterReading({ estimatedTokens: 1, modelContextWindow: bad, presetMaxContext: bad })
      expect(r.budgetOrigin).toBe('unknown')
      expect(r.budget).toBe(DEFAULT_MAX_CONTEXT)
    }
  })

  it('分子：provider 实测优先于字符估算，并标注 provider-usage', () => {
    const r = buildMeterReading({ providerTokens: 12345, estimatedTokens: 999 })
    expect(r.tokens).toBe(12345)
    expect(r.tokensOrigin).toBe('provider-usage')
    expect(isTrustworthy(r.tokensOrigin)).toBe(true)
  })

  it('分子：无 provider 值 → 用估算，标注 unknown（UI 显示「估算值」）', () => {
    const r = buildMeterReading({ estimatedTokens: 999 })
    expect(r.tokens).toBe(999)
    expect(r.tokensOrigin).toBe('unknown')
    expect(isTrustworthy(r.tokensOrigin)).toBe(false)
  })

  it('口径标签文案单源取用（不改口径就不该改文案）', () => {
    expect(originLabel('provider-usage')).toBe('实测')
    expect(originLabel('model-catalog')).toBe('模型目录')
    expect(originLabel('preset')).toBe('预设配置')
    expect(originLabel('unknown')).toBe('估算/未知')
  })
})

// ---------------------------------------------------------------------------
// 2. 扣除被掩码隐藏的消息（F4-C3）
// ---------------------------------------------------------------------------

describe('sumMessageChars：被移出上下文的消息不计入占用', () => {
  const msgs = [
    { message: 'AAAA', seq: 1 },  // 10 字符
    { message: 'BBBBBB', seq: 2 },
    { message: 'CC', seq: 3 },
  ]

  it('无掩码时全量统计（负控：证明扣除没有把统计关掉）', () => {
    expect(sumMessageChars(msgs)).toBe(12)
  })

  it('空掩码集合 = 不扣除（`hidden.size === 0` 走快路径）', () => {
    expect(sumMessageChars(msgs, new Set(), m => m.seq as number)).toBe(12)
  })

  it('命中集合的消息被扣除（回退后占用必须下降）', () => {
    // 隐藏 seq=2（6 字符）→ 只剩 4 + 2 = 6
    expect(sumMessageChars(msgs, new Set([2]), m => m.seq as number)).toBe(6)
  })

  it('全部隐藏 → 0（回退到最前面）', () => {
    expect(sumMessageChars(msgs, new Set([1, 2, 3]), m => m.seq as number)).toBe(0)
  })

  it('未提供 seqOf 取值器时不扣除（保守：宁多算不漏算）', () => {
    expect(sumMessageChars(msgs, new Set([2]))).toBe(12)
  })

  it('非字符串 message 不计入（形状防御）', () => {
    expect(sumMessageChars([{ message: 123 }, { message: { a: 1 } }, { message: 'x' }])).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. 回归护栏：用户实测的那组读数不再出现
// ---------------------------------------------------------------------------

describe('【回归护栏】`1.1M / 16.4k` 这类自相矛盾的读数不得再现', () => {
  it('估算远大于缺省预算时：预算必须标 unknown（用户能看到「这个分母不可信」）', () => {
    // 复刻用户现场：估算 1.1M tokens 量级的会话，而预算来源缺失
    const r = buildMeterReading({ estimatedTokens: 1_100_000 })
    expect(r.budgetOrigin).toBe('unknown')
    expect(isTrustworthy(r.budgetOrigin)).toBe(false)
    // 百分比被 clamp 到 100（进度条不溢出），但标签会提示「预算未知」
    expect(meterPercent(r.tokens, r.budget)).toBe(100)
    expect(meterLevel(r.tokens, r.budget)).toBe('danger')
  })

  it('拿不到真实能力时，任何一处都不该把它当成可信值', () => {
    const r = buildMeterReading({ estimatedTokens: 100 })
    // 分子与分母都需要被标注为不可信（除非 provider 给了实测值）
    expect(isTrustworthy(r.tokensOrigin)).toBe(false)
    expect(isTrustworthy(r.budgetOrigin)).toBe(false)
  })

  it('补上模型能力后，同一组估算值算出合理占用', () => {
    const r = buildMeterReading({ estimatedTokens: 100_000, modelContextWindow: 1_000_000 })
    expect(r.budgetOrigin).toBe('model-catalog')
    expect(meterPercent(r.tokens, r.budget)).toBe(10)
    expect(meterLevel(r.tokens, r.budget)).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// 4. 基础函数（含既有语义回归）
// ---------------------------------------------------------------------------

describe('基础换算与显示', () => {
  it('estimateTokens：chars/2.5 四舍五入；非正数 → 0', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(-5)).toBe(0)
    expect(estimateTokens(Number.NaN)).toBe(0)
    expect(estimateTokens(25)).toBe(10)
    expect(estimateTokens(25.5 * CHARS_PER_TOKEN)).toBe(26)
  })

  it('meterPercent：预算非法 → 0（进度条空转不 NaN）；超 100% 被 clamp', () => {
    expect(meterPercent(100, 0)).toBe(0)
    expect(meterPercent(100, -1)).toBe(0)
    expect(meterPercent(100, Number.NaN)).toBe(0)
    expect(meterPercent(200, 100)).toBe(100)
    expect(meterPercent(50, 100)).toBe(50)
  })

  it('meterLevel 分档：<70 ok / ≥70 warn / >90 danger', () => {
    expect(meterLevel(69, 100)).toBe('ok')
    expect(meterLevel(70, 100)).toBe('warn')
    expect(meterLevel(90, 100)).toBe('warn')
    expect(meterLevel(91, 100)).toBe('danger')
  })

  it('formatTokens 紧凑显示', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_300)).toBe('12.3k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})
