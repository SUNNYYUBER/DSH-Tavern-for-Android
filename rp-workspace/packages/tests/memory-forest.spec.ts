import { describe, it, expect } from 'vitest'
import {
  emptyLedger, applyDelta, deriveLedger, dropLeavesAfter, needsResummary,
  type Leaf, type LeafDelta,
} from '../src/dsht-plugin-memory/memory-forest.ts'

/** 叶子工厂（最小 delta 形态） */
function leaf(floor: number, delta: LeafDelta = {}, text = `摘要${floor}`, extra: Partial<Leaf> = {}): Leaf {
  return { floor, timeTag: delta.timeTag ?? '', text, delta, ...extra }
}

describe('memory-forest M1：delta 重放（台账 derive）', () => {
  it('正控：物品 delta 新增 → 名字匹配合并 → 位置变动追踪', () => {
    let s = emptyLedger()
    s = applyDelta(s, { items: [{ name: '青锋剑', owner: '林昭', location: 'carried', note: '开局佩剑' }] }, 1)
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ name: '青锋剑', owner: '林昭', lastFloor: 1 })
    s = applyDelta(s, { items: [{ name: '青锋剑', owner: 'lost' }] }, 5)
    expect(s.items[0]).toMatchObject({ owner: 'lost', lastFloor: 5 })
    expect(s.items).toHaveLength(1) // 合并不新增
  })

  it('正控：NPC 登场/离场/死亡状态机 + firstFloor 保留', () => {
    let s = emptyLedger()
    s = applyDelta(s, { npcs: [{ name: '云梦璃', role: '师妹', status: 'present' }] }, 1)
    s = applyDelta(s, { npcs: [{ name: '云梦璃', status: 'away', state: '下山历练' }] }, 7)
    expect(s.npcs[0]).toMatchObject({ role: '师妹', status: 'away', firstFloor: 1, lastFloor: 7 })
    s = applyDelta(s, { npcs: [{ name: '黑袍客', status: 'dead' }] }, 9)
    expect(s.npcs).toHaveLength(2)
  })

  it('正控：场景树幂等注册（重访不重复）', () => {
    let s = emptyLedger()
    s = applyDelta(s, { scenes: [{ name: '青云山', parent: '' }, { name: '听雨阁', parent: '青云山' }] }, 2)
    s = applyDelta(s, { scenes: [{ name: '青云山', parent: '' }] }, 6)
    expect(s.scenes).toHaveLength(2)
  })

  it('正控：悬念核销 → openPlans 移入 resolvedPlans；重复核销幂等', () => {
    let s = emptyLedger()
    s = applyDelta(s, { plans: [{ text: '查明父亲失踪真相' }] }, 3)
    expect(s.openPlans).toHaveLength(1)
    s = applyDelta(s, { plans: [{ text: '查明父亲失踪真相', resolution: '第 12 楼父亲亲述' }] }, 12)
    expect(s.openPlans).toHaveLength(0)
    expect(s.resolvedPlans[0]).toMatchObject({ resolvedFloor: 12 })
    s = applyDelta(s, { plans: [{ text: '查明父亲失踪真相', resolution: '重复核销' }] }, 13)
    expect(s.resolvedPlans).toHaveLength(1) // 幂等
  })

  it('正控：主角档案覆盖型 + 时间推进', () => {
    let s = emptyLedger()
    s = applyDelta(s, { protagonist: { status: '青云山外门弟子' }, timeTag: '第 1 日' }, 1)
    s = applyDelta(s, { protagonist: { status: '内门弟子，身负灵脉' }, timeTag: '第 30 日' }, 20)
    expect(s.protagonist).toMatchObject({ status: '内门弟子，身负灵脉', lastFloor: 20 })
    expect(s.currentTime).toBe('第 30 日')
  })

  it('负控：derive 不可变——源 ledger 对象不被 applyDelta 修改', () => {
    const s0 = emptyLedger()
    const before = JSON.stringify(s0)
    applyDelta(s0, { items: [{ name: '测试物' }] }, 1)
    expect(JSON.stringify(s0)).toBe(before)
  })
})

describe('memory-forest M1：deriveLedger（多叶子重放）', () => {
  it('正控：多叶子按楼层序重放 → 台账终态自愈重建', () => {
    const leaves: Leaf[] = [
      leaf(2, { items: [{ name: '符纸' }], npcs: [{ name: '云梦璃' }], timeTag: '第 1 日' }),
      leaf(1, { protagonist: { status: '外门弟子' } }), // 乱序输入，derive 应按 floor 排序
      leaf(5, { items: [{ name: '符纸', owner: 'lost' }], npcs: [{ name: '云梦璃', status: 'dead' }], plans: [{ text: '寻回符纸' }] }),
    ]
    const s = deriveLedger(leaves)
    expect(s.throughFloor).toBe(5)
    expect(s.items[0]).toMatchObject({ owner: 'lost' })
    expect(s.npcs[0]).toMatchObject({ status: 'dead' })
    expect(s.openPlans).toHaveLength(1)
  })

  it('负控：番外楼层（omake 标记）不进台账——手动标记与 manifest 双通道', () => {
    const leaves: Leaf[] = [
      leaf(1, { items: [{ name: '正经物品' }] }),
      leaf(2, { items: [{ name: '番外物' }] }, '番外摘要', { omake: true }),
      leaf(3, { plans: [{ text: '番外悬念' }] }),
    ]
    const s = deriveLedger(leaves, new Set([3])) // manifest 标记 3 为番外
    expect(byNameSafe(s.items, '正经物品')).toBeDefined()
    expect(byNameSafe(s.items, '番外物')).toBeUndefined()
    expect(s.openPlans).toHaveLength(0)
  })

  function byNameSafe<T extends { name: string }>(list: T[], name: string): T | undefined {
    return list.find(x => x.name === name)
  }
})

describe('memory-forest M1：回退安全（dropLeavesAfter）', () => {
  it('正控：cursor 回退到 N → 裁掉 >N 叶子 + 返回被删楼层清单', () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4), leaf(5)]
    const { kept, dropped } = dropLeavesAfter(leaves, 3)
    expect(kept.map(l => l.floor)).toEqual([1, 2, 3])
    expect(dropped).toEqual([4, 5])
  })

  it('负控：回退点之后的手工编辑叶子也被裁（回退语义优先于编辑保护）', () => {
    const leaves = [leaf(1, {}, '旧摘要', { edited: true }), leaf(2)]
    const { kept } = dropLeavesAfter(leaves, 1)
    expect(kept).toHaveLength(1)
    expect(kept[0].edited).toBe(true) // 编辑叶子在保留区内不受影响
  })

  it('正控：裁叶后 derive 与「从未有过被删楼层」的台账逐字节一致（自愈性）', () => {
    const leaves = [leaf(1, { items: [{ name: '剑' }] }), leaf(2, { items: [{ name: '毒药' }] })]
    const { kept } = dropLeavesAfter(leaves, 1)
    const afterRollback = deriveLedger(kept)
    const neverExisted = deriveLedger([leaf(1, { items: [{ name: '剑' }] })])
    expect(afterRollback).toEqual(neverExisted)
  })
})

describe('memory-forest M1：needsResummary（编辑保护）', () => {
  it('正控：edited 叶子跳过自动重摘要；空文本叶子需要补摘', () => {
    expect(needsResummary(leaf(1, {}, '已有摘要', { edited: true }))).toBe(false)
    expect(needsResummary(leaf(2, {}, ''))).toBe(true)
    expect(needsResummary(undefined)).toBe(true)
  })

  it('负控：edited 且 text 被清空（用户主动删空）不触发自动重摘要', () => {
    expect(needsResummary(leaf(3, {}, '', { edited: true }))).toBe(false)
  })
})
