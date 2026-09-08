import { describe, expect, it } from 'vitest'
import {
  flattenStateTree, formatLeaf, formatStateJson, toggleCollapsed,
} from '../src/dsht-rp-ui/src/client/state-view.ts'

describe('状态树折叠（RpStateView 表格视图纯逻辑）', () => {
  const tree = { a: 1, b: { c: 'x', d: [true, null] }, e: {} }

  it('全展开：容器行 + 叶子行按深度铺平', () => {
    const rows = flattenStateTree(tree)
    expect(rows.map(r => `${r.depth}:${r.path}`)).toEqual([
      '0:a', '0:b', '1:b.c', '1:b.d', '2:b.d.0', '2:b.d.1', '0:e',
    ])
    const b = rows.find(r => r.path === 'b')!
    expect(b.leaf).toBe(false)
    expect(b.count).toBe(2)
    expect(b.open).toBe(true)
    const a = rows.find(r => r.path === 'a')!
    expect(a.leaf).toBe(true)
    expect(a.valueText).toBe('1')
  })

  it('折叠中间容器：只出容器行，子树整段不出现', () => {
    const rows = flattenStateTree(tree, new Set(['b']))
    expect(rows.map(r => r.path)).toEqual(['a', 'b', 'e'])
    const b = rows.find(r => r.path === 'b')!
    expect(b.open).toBe(false)
    expect(b.count).toBe(2)
  })

  it('数组路径用点号下标；嵌套折叠后子孙不出现', () => {
    const rows = flattenStateTree(tree, new Set(['b.d']))
    expect(rows.map(r => r.path)).toEqual(['a', 'b', 'b.c', 'b.d', 'e'])
    expect(rows.find(r => r.path === 'b.d')!.open).toBe(false)
    expect(rows.some(r => r.path === 'b.d.0')).toBe(false)
  })

  it('空容器：0 项照常出容器行', () => {
    const rows = flattenStateTree({ empty: {} })
    const e = rows.find(r => r.path === 'empty')!
    expect(e.leaf).toBe(false)
    expect(e.count).toBe(0)
  })

  it('标量根：单叶子行（/state 返回非对象的防御兜底）', () => {
    expect(flattenStateTree(42)).toEqual([{ path: '', key: '', depth: 0, leaf: true, valueText: '42' }])
    expect(flattenStateTree('文本')).toEqual([{ path: '', key: '', depth: 0, leaf: true, valueText: '文本' }])
  })

  it('空对象根：不出行（组件自行显示空态）', () => {
    expect(flattenStateTree({})).toEqual([])
  })

  it('toggleCollapsed 纯翻转：不改原集合', () => {
    const base = new Set(['b'])
    const next = toggleCollapsed(base, 'b.d')
    expect(next.has('b.d')).toBe(true)
    expect(next.has('b')).toBe(true)
    expect(base.has('b.d')).toBe(false)
    const again = toggleCollapsed(next, 'b')
    expect(again.has('b')).toBe(false)
    expect(next.has('b')).toBe(true) // 原集合仍不变
  })

  it('formatLeaf：字符串原样 / null / 对象 JSON 化 / undefined 空串', () => {
    expect(formatLeaf('文本')).toBe('文本')
    expect(formatLeaf(null)).toBe('null')
    expect(formatLeaf(undefined)).toBe('')
    expect(formatLeaf({ k: 1 })).toBe('{"k":1}')
    expect(formatLeaf([1, 2])).toBe('[1,2]')
  })

  it('formatStateJson：2 空格格式化只读文本', () => {
    expect(formatStateJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(formatStateJson(undefined)).toBe('')
  })
})
