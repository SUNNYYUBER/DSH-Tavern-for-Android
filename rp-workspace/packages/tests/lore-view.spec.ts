import { describe, expect, it } from 'vitest'
import {
  entryEnabled, entryKeys, filterLoreEntries, keysToText,
} from '../src/dsht-rp-ui/src/client/lore-view.ts'

const entries = [
  { uid: 0, comment: '祥子', content: '咖啡厅女仆', key: ['祥子', 'hoshino'], keysecondary: [], disabled: false },
  { uid: 1, comment: '门店规则', content: '打烊时间为晚上十点', key: '规则, 打烊', disabled: true },
  { uid: 2, comment: '伏笔A', content: '怀表停在三点', key: ['怀表'], keysecondary: ['齿轮'] },
]

describe('世界书条目过滤（RpLorePanel 搜索框纯逻辑）', () => {
  it('空查询（含纯空白）原样返回全部', () => {
    expect(filterLoreEntries(entries, '')).toHaveLength(3)
    expect(filterLoreEntries(entries, '   ')).toHaveLength(3)
  })

  it('comment / content 命中（大小写不敏感）', () => {
    expect(filterLoreEntries(entries, '祥子').map(e => e.uid)).toEqual([0])
    expect(filterLoreEntries(entries, '打烊').map(e => e.uid)).toEqual([1])
    expect(filterLoreEntries(entries, 'HOSHINO').map(e => e.uid)).toEqual([0])
    expect(filterLoreEntries(entries, '怀表停在').map(e => e.uid)).toEqual([2])
  })

  it('主键 / 次键命中（数组与逗号字符串同权）', () => {
    expect(filterLoreEntries(entries, '怀表').map(e => e.uid)).toEqual([2])
    expect(filterLoreEntries(entries, '齿轮').map(e => e.uid)).toEqual([2]) // 次键
    expect(filterLoreEntries(entries, '规则').map(e => e.uid)).toEqual([1]) // 字符串主键
  })

  it('无命中返回空数组', () => {
    expect(filterLoreEntries(entries, '不存在')).toEqual([])
  })
})

describe('keys 归一与启停语义（entry-put 编辑面）', () => {
  it('entryKeys：数组去空白去空；字符串按中英文逗号切', () => {
    expect(entryKeys([' a ', '', 'b'])).toEqual(['a', 'b'])
    expect(entryKeys('规则, 打烊，深夜')).toEqual(['规则', '打烊', '深夜'])
    expect(entryKeys(undefined)).toEqual([])
    expect(entryKeys(123)).toEqual([])
  })

  it('keysToText：还原可读逗号串', () => {
    expect(keysToText(['a', 'b'])).toBe('a, b')
    expect(keysToText('x，y')).toBe('x, y')
    expect(keysToText(undefined)).toBe('')
  })

  it('entryEnabled：disabled !== true 即启用（ST 语义）', () => {
    expect(entryEnabled({ uid: 0, comment: '', content: '' })).toBe(true)
    expect(entryEnabled({ uid: 0, comment: '', content: '', disabled: false })).toBe(true)
    expect(entryEnabled({ uid: 0, comment: '', content: '', disabled: true })).toBe(false)
  })
})
