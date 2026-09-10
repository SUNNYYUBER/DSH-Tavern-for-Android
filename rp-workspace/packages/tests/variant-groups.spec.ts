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

  // 【阶段4 2026-09-11】回退/重生成标记的锚点是 user seq（非 assistant 楼层），
  // 后端曾把它当组员 → 首成员 text 恒 ''、active 也指向它 → 前端 variantOverride
  // 把该层正文渲染成空白（实机 floor #12 空白实证）。以下两条锁死该回归。
  it('空文本成员被剔除；剔到只剩 1 个有效成员 → 整组丢弃（不渲染空白楼层）', () => {
    const raw = [{ members: [{ seq: 78, text: '' }, { seq: 82, text: '真实回复' }], activeSeq: 78 }]
    expect(normalizeVariantGroups(raw)).toEqual([])
  })

  it('空文本成员被剔除，但仍有 ≥2 个有效变体 → 保留且 active 归位到有效代表', () => {
    const raw = [{ members: [{ seq: 78, text: '' }, { seq: 82, text: 'A' }, { seq: 100, text: 'B' }], activeSeq: 78 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.members.map(m => m.seq)).toEqual([82, 100])
    expect(g?.activeSeq).toBe(100) // active 文本缺失 → 归位到最后一个有效成员
  })

  it('空白字符串（含空白字符）同样视为空成员', () => {
    const raw = [{ members: [{ seq: 1, text: '   ' }, { seq: 2, text: 'A' }, { seq: 3, text: 'B' }], activeSeq: 2 }]
    const [g] = normalizeVariantGroups(raw)
    expect(g?.members.map(m => m.seq)).toEqual([2, 3])
    expect(g?.activeSeq).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 后端组构建：回退/重生成标记（形态 2）的成员必须一律是 assistant 楼层
// ---------------------------------------------------------------------------
describe('collectVariantGroups 形态 2（0.1.5：user/message 标记 + append）', () => {
  /** 造 user/message 标记事件（sections 里带手术载荷） */
  function userMarker(seq: number, payload: Record<string, unknown>, start: number, end: number) {
    return {
      type: 'user/message',
      seq,
      data: { source: { kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot', sections: [{ name: 'dsht:surgical', text: JSON.stringify(payload) }] } },
      surfaceOp: { op: 'replace', start, end },
      sourceEventSeqs: [],
    }
  }
  function userPlain(seq: number, text: string) {
    return { type: 'user/message', seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } }, surfaceOp: 'append' }
  }

  it('回退标记：成员只收 assistant 楼层，active = 标记之后的下一条 assistant', () => {
    const events = [
      userPlain(79, '用户输入'),
      msg(82, '被回退的旧回复'),
      userMarker(86, { rolledBackTo: 79, shadowedSeqs: [79, 82] }, 79, 82),
      msg(100, '回退后新生成的回复'),
    ]
    const groups = collectVariantGroups(events as never[])
    const g = groups.get(100) ?? groups.get(82)
    expect(g).toBeDefined()
    expect(g!.members.map(m => m.seq)).toEqual([82, 100])
    expect(g!.members.every(m => m.text.trim() !== '')).toBe(true)
    expect(g!.activeSeq).toBe(100)
    // 用户 seq（79）与标记 seq（86）都不该成为组员
    expect(g!.members.some(m => m.seq === 79 || m.seq === 86)).toBe(false)
    // 且每个成员 seq 都能直接拿组（variant/switch 的 groups.get(targetSeq) 契约）
    expect(groups.get(82)).toBe(g)
  })

  it('回退后尚未重新生成：组只含 1 个有效回复，active 退回它（前端归一化会整组丢弃）', () => {
    const events = [
      userPlain(79, '用户输入'),
      msg(82, '被回退的旧回复'),
      userMarker(86, { rolledBackTo: 79, shadowedSeqs: [79, 82] }, 79, 82),
    ]
    const groups = collectVariantGroups(events as never[])
    const g = groups.get(82)
    expect(g).toBeDefined()
    expect(g!.activeSeq).toBe(82)
    expect(g!.members.map(m => m.seq)).toEqual([82])
    // 关键：绝不能出现 text 为空的成员（旧实现在此产出 {seq:79, text:''}）
    expect(g!.members.every(m => m.text.trim() !== '')).toBe(true)
  })
})
