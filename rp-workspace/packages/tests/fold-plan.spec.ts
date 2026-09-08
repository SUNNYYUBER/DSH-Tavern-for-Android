import { describe, expect, it } from 'vitest'
import { planFolds, type FoldRow } from '../src/dsht-rp-ui/src/client/fold-plan.ts'

/** 造行序列助手 */
function rows(...kinds: string[]): FoldRow[] {
  return kinds.map((kind, i) => ({ key: `${kind}-${i}`, kind }))
}

describe('主会话过程折叠规划（任务 A）', () => {
  it('RP 单步轮（user → assistant → turn-tail）不折叠', () => {
    expect(planFolds(rows('user', 'assistant-step', 'turn-tail'))).toEqual([])
  })

  it('harness 多步轮：折掉中间过程，保留最终正文与 turn-tail', () => {
    const r = rows('user', 'assistant-step', 'tool-call', 'tool-call', 'assistant-step', 'turn-tail')
    const [g] = planFolds(r)
    expect(g).toBeDefined()
    // 最终 assistant-step（index 4）保留可见；折掉 1 个中间步骤 + 2 个工具行
    expect(g?.foldedKeys).toEqual(['assistant-step-1', 'tool-call-2', 'tool-call-3'])
    expect(g?.anchorKey).toBe('assistant-step-1')
    expect(g?.steps).toBe(1)
    expect(g?.toolCalls).toBe(2)
    expect(g?.id).toBe('turn-tail-5')
  })

  it('进行中的轮（无 turn-tail）不折叠', () => {
    const r = rows('user', 'assistant-step', 'tool-call', 'tool-call', 'assistant-step')
    expect(planFolds(r)).toEqual([])
  })

  it('过程行不足两行不出折叠行', () => {
    const r = rows('user', 'tool-call', 'assistant-step', 'turn-tail')
    expect(planFolds(r)).toEqual([])
  })

  it('多轮：已完成轮折叠、最新进行中轮原样；各组以 turn-tail key 为身份', () => {
    const r = rows(
      'user', 'assistant-step', 'tool-call', 'tool-call', 'assistant-step', 'turn-tail',
      'user', 'assistant-step', 'tool-call',
    )
    const groups = planFolds(r)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.id).toBe('turn-tail-5')
  })

  it('model-retry 计入过程行；turn-error / compaction / context 行保持可见不折', () => {
    const r = rows(
      'user', 'model-retry', 'tool-call', 'turn-error', 'assistant-step', 'tool-call', 'assistant-step', 'turn-tail',
    )
    const [g] = planFolds(r)
    expect(g?.foldedKeys).toEqual(['model-retry-1', 'tool-call-2', 'assistant-step-4', 'tool-call-5'])
    expect(g?.foldedKeys).not.toContain('turn-error-3')
  })

  it('无正文轮（失败轮：无 assistant-step）不折叠', () => {
    const r = rows('user', 'tool-call', 'tool-call', 'turn-error', 'turn-tail')
    expect(planFolds(r)).toEqual([])
  })

  it('steering/command 等非过程行不打断折叠组但也不被折掉', () => {
    const r = rows('user', 'tool-call', 'steering', 'tool-call', 'assistant-step', 'turn-tail')
    const [g] = planFolds(r)
    expect(g?.foldedKeys).toEqual(['tool-call-1', 'tool-call-3'])
  })
})
