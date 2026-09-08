import { describe, expect, it } from 'vitest'
import { groupOf, normalizeVariantGroups } from '../src/dsht-rp-ui/src/client/variant-groups.ts'
import { collectVariantGroups } from '../src/dsh-plugin/index.ts'

/** 造 assistant/message 事件（append / replace 链） */
function msg(seq: number, text: string, replacePrevSeq?: number): {
  type: string; seq: number; data?: unknown; surfaceOp?: unknown; sourceEventSeqs?: number[]
} {
  return {
    type: 'assistant/message',
    seq,
    data: { message: { content: [{ type: 'text', text }] } },
    ...(replacePrevSeq === undefined
      ? { surfaceOp: 'append' }
      : { surfaceOp: { op: 'replace', start: replacePrevSeq, end: replacePrevSeq }, sourceEventSeqs: [replacePrevSeq] }),
  }
}

describe('collectVariantGroups 原始计数语义（后端不变量——说明前端为何要归一化）', () => {
  it('每次切换都 append 新 replace 事件并入组：members 一路增长（数字叠加的根源）', () => {
    // A 原始 → 重 roll 出 B → 切回 A → 再切到 B（真实 swipe 来回操作）
    const events = [msg(1, 'A'), msg(2, 'B', 1), msg(3, 'A', 2), msg(4, 'B', 3)]
    const g = collectVariantGroups(events).get(4)
    expect(g?.members.map(m => m.seq)).toEqual([1, 2, 3, 4])
    expect(g?.activeSeq).toBe(4)
  })

  it('纯重 roll 链（不切换）也逐条入组', () => {
    const events = [msg(1, 'A'), msg(2, 'B', 1), msg(3, 'C', 2)]
    const g = collectVariantGroups(events).get(3)
    expect(g?.members).toHaveLength(3)
  })
})

describe('normalizeVariantGroups（前端归一化：计数恒定 1..N，N=不同文本数）', () => {
  it('来回 swipe 产生的同文本重复成员被去重，计数不再叠加', () => {
    // 上面 collect 出的 4 成员（A/B/A/B）归一化后恒为 2 个变体
    const raw = [{ members: [{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }, { seq: 3, text: 'A' }, { seq: 4, text: 'B' }], activeSeq: 4 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.members).toEqual([{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }])
    expect(g?.activeSeq).toBe(2) // active B → 去重代表 seq 2
    // 显示层 idx = findIndex(activeSeq) = 1 → 永远显示 2/2，不会叠加成 4/4
    expect(g?.members.findIndex(m => m.seq === g?.activeSeq)).toBe(1)
  })

  it('active 映射到同文本的首次出现代表；来回后切到 A 也一样归位', () => {
    const raw = [{ members: [{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }, { seq: 3, text: 'A' }], activeSeq: 3 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.members).toHaveLength(2)
    expect(g?.activeSeq).toBe(1) // A 的代表
  })

  it('memberSeqs 保留全部原始组员 seq（surface 消息的 seq 可能是被去重的成员）', () => {
    const raw = [{ members: [{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }, { seq: 3, text: 'A' }], activeSeq: 3 }]
    const normalized = normalizeVariantGroups(raw)
    expect(normalized[0]?.memberSeqs).toEqual([1, 2, 3])
    // groupOf 用 memberSeqs 判归属：surface 上的最新消息 seq=3 依然命中组
    expect(groupOf(normalized, 3)).toBe(normalized[0])
    expect(groupOf(normalized, 99)).toBeUndefined()
  })

  it('active 文本不在 members（数据残缺防御）→ 归位到最后一个成员', () => {
    const raw = [{ members: [{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }], activeSeq: 7 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.activeSeq).toBe(2)
  })

  it('无重复的组原样通过（重 roll 三个不同文本 → 3 个变体）', () => {
    const raw = [{ members: [{ seq: 1, text: 'A' }, { seq: 2, text: 'B' }, { seq: 3, text: 'C' }], activeSeq: 3 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.members).toHaveLength(3)
    expect(g?.activeSeq).toBe(3)
  })
})
