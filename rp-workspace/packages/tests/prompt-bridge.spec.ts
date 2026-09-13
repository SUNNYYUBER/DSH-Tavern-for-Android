/**
 * 写侧 prompt 改写通道（T-63 / D-67-1）单测
 * ============================================================================
 * 被测对象：`dsht-plugin-shared/prompt-bridge.ts`（node 侧）。
 *
 * 为什么要有独立单测：本通道挂在**生成路径**上（`agent/pre-step`），是"最不该出事"的地方。
 * 三条防护（零开销快路径 / 硬超时 / 可听降级）与**形状双向保真**都必须有可复跑的判据，
 * 否则一旦回归，症状是"卡的改写静默丢失"（本项目最忌的失败形态，无报错）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PromptBridge, coerceStPrompts, fromStPrompts, toStPrompts,
  type StPrompt,
} from '../src/dsht-plugin-shared/prompt-bridge.ts'

/** 造一个"我方批"条目（`{role, content: Block[]}`） */
function msg(role: string, text: string): Record<string, unknown> {
  return { role, content: [{ type: 'text', text }] }
}

/** 收集 warn（不打印，避免污染测试输出） */
function mkBridge(): { bridge: PromptBridge; warns: string[] } {
  const warns: string[] = []
  const bridge = new PromptBridge({ warn: (_key, m) => { warns.push(m) } })
  return { bridge, warns }
}

describe('prompt-bridge：形状投影（我方批 ↔ ST prompt）', () => {
  it('toStPrompts：历史轮次给 chatHistory 前缀（卡的 squash 判据 :3053）', () => {
    const st = toStPrompts([msg('system', 'S'), msg('user', 'U'), msg('assistant', 'A')])
    expect(st.map(p => p.role)).toEqual(['system', 'user', 'assistant'])
    expect(st[0]!.identifier).toBe('prompt-0')
    expect(st[1]!.identifier.startsWith('chatHistory')).toBe(true)
    expect(st[2]!.identifier.startsWith('chatHistory')).toBe(true)
    expect(st[1]!.content).toBe('U')
  })

  it('toStPrompts：content 是 Block[] ⇒ 拼成字符串（卡的钩子按 string 读写）', () => {
    const st = toStPrompts([{ role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }])
    expect(st[0]!.content).toBe('a\nb')
  })

  it('fromStPrompts：卡没动的条目**原样保留整条**（非文本 block / source / id 零损失）', () => {
    const orig = [
      { role: 'system', content: [{ type: 'image', url: 'x' }], source: { kind: 'model', provider: 'p', model: 'm' }, id: 'id-1' },
    ]
    const sent = toStPrompts(orig)
    const back = fromStPrompts(orig, sent, sent) as Array<Record<string, unknown>>
    expect(back[0]).toBe(orig[0])  // 同一引用：完全没重建
  })

  it('fromStPrompts：卡改过的条目按文本重建，但保留 source/id', () => {
    const orig = [{ role: 'user', content: [{ type: 'text', text: 'old' }], source: { kind: 'user' }, id: 'keep' }]
    const sent = toStPrompts(orig)
    const edited: StPrompt[] = [{ ...sent[0]!, content: 'new' }]
    const back = fromStPrompts(orig, edited, sent) as Array<Record<string, unknown>>
    expect(back).toHaveLength(1)
    expect(back[0]!.id).toBe('keep')
    expect(back[0]!.source).toEqual({ kind: 'user' })
    expect(back[0]!.content).toEqual([{ type: 'text', text: 'new' }])
  })

  it('fromStPrompts：卡 push 的新条目带**诚实来源标注**（不冒充模型/用户源）', () => {
    const orig = [msg('system', 'S')]
    const sent = toStPrompts(orig)
    const withNew: StPrompt[] = [...sent, { role: 'system', content: 'injected', identifier: 'extra' }]
    const back = fromStPrompts(orig, withNew, sent) as Array<Record<string, unknown>>
    expect(back).toHaveLength(2)
    const added = back[1]!.source as Record<string, unknown>
    expect(added.kind).toBe('plugin')
    expect(added.plugin).toBe('dsht-prompt-bridge')
  })

  it('fromStPrompts：squash 合并（3 条 → 1 条）不串 source', () => {
    const orig = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')]
    const sent = toStPrompts(orig)
    const squashed: StPrompt[] = [{ role: 'user', content: 'a\nb\nc', identifier: 'squashed' }]
    const back = fromStPrompts(orig, squashed, sent) as Array<Record<string, unknown>>
    expect(back).toHaveLength(1)
    expect(back[0]!.content).toEqual([{ type: 'text', text: 'a\nb\nc' }])
  })

  it('coerceStPrompts：畸形输入收窄成安全默认（不抛、不产生 undefined 字段）', () => {
    const got = coerceStPrompts([null, { role: 1, content: 2 }, { role: 'user', content: 'x', identifier: 'k' }])
    expect(got).toHaveLength(2)
    // 索引取**原数组位置**（与 toStPrompts 的 `prompt-${i}` 同口径，便于两侧对账）
    expect(got[0]).toEqual({ role: 'system', content: '', identifier: 'prompt-1' })
    expect(got[1]).toEqual({ role: 'user', content: 'x', identifier: 'k' })
  })
})

describe('prompt-bridge：防护 ① 零开销快路径', () => {
  it('未声明兴趣 ⇒ 立即返回原批，且**不产生等待**（即便有 puller 挂着）', async () => {
    const { bridge } = mkBridge()
    const orig = [msg('system', 'S')]
    // 有 UI 在等活，但该会话没声明兴趣 ⇒ 仍走快路径
    void bridge.pull('s1', 50)
    const out = await bridge.rewrite({ sessionId: 's1', messages: orig })
    expect(out.kind).toBe('no-interest')
    expect(out.messages).toBe(orig)
  })

  it('零开销路径下不向 UI 交付任何活（puller 只等到 hasWork:false）', async () => {
    const { bridge } = mkBridge()
    const pullPromise = bridge.pull('s1', 30)
    await bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] })
    expect(await pullPromise).toEqual({ hasWork: false })
  })

  it('pull 本身**不**声明兴趣（否则每个开着的会话都会白等 1500ms）', async () => {
    const { bridge } = mkBridge()
    void bridge.pull('s1', 20)
    expect(bridge.hasInterest('s1')).toBe(false)
  })
})

describe('prompt-bridge：防护 ④ 窗口期宽容（UI 两次 pull 之间的缝隙）', () => {
  it('最近拉过但当前无挂起 pull ⇒ 排队等活，不误判"UI 不在场"', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, warns } = mkBridge()
      bridge.declareInterest('s1')
      // 模拟：UI 刚结束一次 pull（窗口期缝隙），此刻没有挂起的 puller
      const first = bridge.pull('s1', 10)
      await vi.advanceTimersByTimeAsync(20)
      expect(await first).toEqual({ hasWork: false })
      // 缝隙里的 rewrite：应排队等 UI 的下一条 pull，而不是立即降级
      const rewritePromise = bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] }, 1000)
      const got = await bridge.pull('s1', 1000)
      expect(got.hasWork).toBe(true)
      if (!got.hasWork) throw new Error('unreachable')
      bridge.settle('s1', got.round, got.prompt)
      expect((await rewritePromise).kind).toBe('rewritten')
      expect(warns.join(' ')).not.toMatch(/没有在等活的 UI/)
    } finally { vi.useRealTimers() }
  })

  it('从未拉过 ⇒ 立即降级（不白等，宽容期不掩盖"UI 真不在场"）', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, warns } = mkBridge()
      bridge.declareInterest('s1')
      const started = Date.now()
      const out = await bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] }, 1000)
      expect(out.kind).toBe('degraded')
      expect(Date.now() - started).toBe(0)   // 未等待
      expect(warns.join(' ')).toMatch(/没有在等活的 UI/)
    } finally { vi.useRealTimers() }
  })

  it('超过宽容期没拉过 ⇒ 恢复立即降级', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, warns } = mkBridge()
      bridge.declareInterest('s1')
      const first = bridge.pull('s1', 10)
      await vi.advanceTimersByTimeAsync(20)
      await first
      await vi.advanceTimersByTimeAsync(6000)   // > PROMPT_BRIDGE_PULLER_GRACE_MS
      const out = await bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] }, 1000)
      expect(out.kind).toBe('degraded')
      expect(warns.join(' ')).toMatch(/没有在等活的 UI/)
    } finally { vi.useRealTimers() }
  })
})

describe('prompt-bridge：防护 ② 硬超时（结构上不可能卡死）', () => {
  it('UI 取走活但不回传 ⇒ 到时按未改写返回，且**出声**', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, warns } = mkBridge()
      bridge.declareInterest('s1')
      const pullPromise = bridge.pull('s1', 5000)
      const rewritePromise = bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] }, 1500)
      const got = await pullPromise
      expect(got.hasWork).toBe(true)
      await vi.advanceTimersByTimeAsync(1600)
      const out = await rewritePromise
      expect(out.kind).toBe('degraded')
      if (out.kind !== 'degraded') throw new Error('unreachable')
      expect(out.reason).toBe('timeout')
      expect(warns.join(' ')).toMatch(/超时/)
    } finally { vi.useRealTimers() }
  })
})

describe('prompt-bridge：防护 ③ 可听降级', () => {
  it('声明了兴趣但没有 UI 在等 ⇒ 出声 + degraded(no-puller)，且不等待', async () => {
    const { bridge, warns } = mkBridge()
    bridge.declareInterest('s1')
    const orig = [msg('system', 'S')]
    const out = await bridge.rewrite({ sessionId: 's1', messages: orig })
    expect(out.kind).toBe('degraded')
    if (out.kind !== 'degraded') throw new Error('unreachable')
    expect(out.reason).toBe('no-puller')
    expect(out.messages).toBe(orig)
    expect(warns.join(' ')).toMatch(/没有在等活的 UI/)
  })

  it('回传迟到（等待已超时）⇒ 出声 late-return，且不误用', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, warns } = mkBridge()
      bridge.declareInterest('s1')
      const pullPromise = bridge.pull('s1', 5000)
      const rewritePromise = bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] }, 100)
      const got = await pullPromise
      expect(got.hasWork).toBe(true)
      await vi.advanceTimersByTimeAsync(200)
      await rewritePromise
      const r = bridge.settle('s1', got.hasWork ? got.round : -1, [{ role: 'system', content: 'late', identifier: 'x' }])
      expect(r.ok).toBe(false)
      expect(warns.join(' ')).toMatch(/晚于等待窗口/)
    } finally { vi.useRealTimers() }
  })

  it('降级出声按 sessionId|reason 去重（不刷屏）', async () => {
    const { bridge, warns } = mkBridge()
    bridge.declareInterest('s1')
    await bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] })
    await bridge.rewrite({ sessionId: 's1', messages: [msg('system', 'S')] })
    expect(warns.filter(w => w.includes('没有在等活的 UI'))).toHaveLength(1)
  })
})

describe('prompt-bridge：正向闭环（UI 在场时改写真的生效）', () => {
  it('pull → 卡就地改 → return ⇒ rewritten 且内容是卡的改写结果', async () => {
    const { bridge } = mkBridge()
    bridge.declareInterest('s1')
    const pullPromise = bridge.pull('s1', 1000)
    const orig = [msg('system', 'S'), msg('user', 'U')]
    const rewritePromise = bridge.rewrite({ sessionId: 's1', messages: orig }, 1000)

    const got = await pullPromise
    expect(got.hasWork).toBe(true)
    if (!got.hasWork) throw new Error('unreachable')
    // 模拟卡的 squash：两条合成一条
    const edited: StPrompt[] = [{ role: 'user', content: 'S\nU', identifier: 'chatHistory-0-user' }]
    expect(bridge.settle('s1', got.round, edited)).toEqual({ ok: true })

    const out = await rewritePromise
    expect(out.kind).toBe('rewritten')
    expect(out.messages).toHaveLength(1)
    expect((out.messages[0] as { content: Array<{ text: string }> }).content[0]!.text).toBe('S\nU')
  })

  it('卡把整批清空 ⇒ **不采信**（出声 + 按未改写继续）', async () => {
    const { bridge, warns } = mkBridge()
    bridge.declareInterest('s1')
    const pullPromise = bridge.pull('s1', 1000)
    const orig = [msg('system', 'S')]
    const rewritePromise = bridge.rewrite({ sessionId: 's1', messages: orig }, 1000)
    const got = await pullPromise
    if (!got.hasWork) throw new Error('unreachable')
    bridge.settle('s1', got.round, [])
    const out = await rewritePromise
    expect(out.kind).toBe('degraded')
    expect(out.messages).toBe(orig)
    expect(warns.join(' ')).toMatch(/空批/)
  })

  it('从未有 puller ⇒ rewrite 先到时立即降级（不白等），且**不污染**后续交付', async () => {
    const { bridge, warns } = mkBridge()
    bridge.declareInterest('s1')
    const orig = [msg('system', 'S')]
    // UI 尚未出现过 ⇒ 立即降级（有界、不等待），这是**有意**的：
    // 若在这里白等，则"UI 真不在场"的首次生成会每次都多扛一次超时。
    const first = await bridge.rewrite({ sessionId: 's1', messages: orig }, 1000)
    expect(first.kind).toBe('degraded')
    expect(first.messages).toBe(orig)
    expect(warns.join(' ')).toMatch(/没有在等活的 UI/)

    // 降级不污染状态：UI 随后上线，本轮的活仍能被正常取走并回传
    const pullPromise = bridge.pull('s1', 1000)
    const second = bridge.rewrite({ sessionId: 's1', messages: orig }, 1000)
    const got = await pullPromise
    expect(got.hasWork).toBe(true)
    if (!got.hasWork) throw new Error('unreachable')
    bridge.settle('s1', got.round, got.prompt)
    expect((await second).kind).toBe('rewritten')
  })

  it('clearInterest 后快路径重新生效', async () => {
    const { bridge } = mkBridge()
    bridge.declareInterest('s1')
    expect(bridge.hasInterest('s1')).toBe(true)
    bridge.clearInterest('s1')
    const orig = [msg('system', 'S')]
    const out = await bridge.rewrite({ sessionId: 's1', messages: orig })
    expect(out.kind).toBe('no-interest')
  })
})
