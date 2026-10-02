import { describe, it, expect } from 'vitest'
import {
  buildCatalog, briefOf, renderCatalogSection, lookupLeaves,
  renderFloorDigest, renderLedgerSection, MEMORY_TOOLS,
  type Leaf,
} from '../src/dsht-plugin-memory/memory-tools.ts'

function leaf(floor: number, text: string, timeTag = '', extra: Partial<Leaf> = {}): Leaf {
  return { floor, timeTag, text, delta: {}, ...extra }
}

describe('memory-tools M3：目录注入（阶段 A 打底）', () => {
  it('正控：buildCatalog 取最近 N 条 + 一句话截 40 字 + 番外排除', () => {
    const leaves = Array.from({ length: 20 }, (_, i) => leaf(i + 1, `## 事件\n第${i + 1}楼发生了${'很长'.repeat(30)}的事情`))
    leaves[4].omake = true
    const cat = buildCatalog(leaves, 12)
    expect(cat).toHaveLength(12)
    expect(cat[0].floor).toBe(9) // 1-5 中 5 是番外，最近12条从9起？floor 20..9 含番外5？——5 不在 9..20，正确
    expect(cat.every(c => c.brief.length <= 41)).toBe(true)
  })

  it('正控：空记忆 → renderCatalogSection 返回空串（不注入）', () => {
    expect(renderCatalogSection([], null)).toBe('')
  })

  it('正控：有台账时目录带 时间/主角状态/未了结悬念', () => {
    const sec = renderCatalogSection([{ floor: 3, timeTag: '第3日', brief: 'x' }], {
      items: [], npcs: [], scenes: [], openPlans: [{ text: '寻剑', createdFloor: 3, resolvedFloor: null }],
      resolvedPlans: [], protagonist: { status: '内门弟子', lastFloor: 3 }, currentTime: '第3日', throughFloor: 3,
    })
    expect(sec).toContain('第3日')
    expect(sec).toContain('寻剑')
    expect(sec).toContain('#3')
  })
})

describe('memory-tools M3：lookupLeaves（memory_lookup 核心）', () => {
  const leaves = [
    leaf(1, '林昭获得青锋剑'), leaf(2, '云梦璃下山'), leaf(3, '青锋剑遗失在听雨阁'),
    leaf(4, '番外：青锋剑小剧场', '', { omake: true }),
  ]
  it('正控：多词命中排序（命中数优先，新楼层优先）', () => {
    const hits = lookupLeaves(leaves, '青锋剑', 3)
    expect(hits.map(l => l.floor)).toEqual([3, 1]) // 3楼命中1次但更新；1楼同分；番外4楼排除
  })
  it('负控：空查询/无命中 → 空数组（不臆测）', () => {
    expect(lookupLeaves(leaves, '')).toEqual([])
    expect(lookupLeaves(leaves, '完全不相关的词')).toEqual([])
  })
})

describe('memory-tools M3：renderFloorDigest（memory_floor）', () => {
  it('正控：摘要 + 原文双面装配', () => {
    const out = renderFloorDigest(leaf(7, '林昭习得御剑术', '第7日'), '原文全文……', 2)
    expect(out).toContain('#7 摘要')
    expect(out).toContain('御剑术')
    expect(out).toContain('原文全文')
  })
  it('负控：无摘要且无原文 → 明确说不存在（不编造）', () => {
    expect(renderFloorDigest(undefined, null)).toContain('不存在')
  })
})

describe('memory-tools M3：renderLedgerSection（memory_ledger）', () => {
  const state = {
    items: [{ name: '符纸', owner: '林昭', location: 'carried', note: '剩3张', lastFloor: 5 }],
    npcs: [{ name: '云梦璃', role: '师妹', status: 'away' as const, state: '下山', firstFloor: 1, lastFloor: 7 }],
    scenes: [{ name: '听雨阁', parent: '青云山', firstFloor: 2 }],
    openPlans: [{ text: '寻回符纸', createdFloor: 5, resolvedFloor: null }],
    resolvedPlans: [{ text: '入门试炼', createdFloor: 1, resolvedFloor: 3, resolution: '通过' }],
    protagonist: { status: '内门弟子', lastFloor: 7 },
    currentTime: '第30日', throughFloor: 7,
  }
  it('正控：单本台账渲染', () => {
    expect(renderLedgerSection(state, 'items')).toContain('剩3张')
    expect(renderLedgerSection(state, 'npcs')).toContain('away')
    expect(renderLedgerSection(state, 'scenes')).toContain('青云山 > 听雨阁')
    expect(renderLedgerSection(state, 'plans')).toContain('寻回符纸')
    expect(renderLedgerSection(state, 'protagonist')).toContain('内门弟子')
  })
  it('正控：all 概览含时间与计数', () => {
    const all = renderLedgerSection(state, 'all')
    expect(all).toContain('第30日')
    expect(all).toContain('物品 1 条')
  })
  it('负控：空台账 → 出声「（空）」不编造', () => {
    expect(renderLedgerSection({ ...state, items: [] }, 'items')).toContain('（空）')
  })
})

describe('memory-tools M3：工具注册面声明', () => {
  it('正控：四工具名字唯一 + systemPrompt 引导齐备', () => {
    const names = MEMORY_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(4)
    for (const t of MEMORY_TOOLS) expect(t.systemPromptText.length).toBeGreaterThan(30)
  })
})
