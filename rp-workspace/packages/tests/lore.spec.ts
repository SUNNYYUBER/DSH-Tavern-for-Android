import { describe, it, expect } from 'vitest'
import { importLoreBook, WI_POSITION, type LoreEntry } from '../src/lore/entry.ts'
import { triggerWorldInfo, buildScanText, DEFAULT_TRIGGER_CONFIG, visibleMessageCursor } from '../src/lore/trigger.ts'

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: 'e1', comment: '测试条目', content: '这是条目内容，包含 咖啡厅 这个词。',
    keys: [], secondaryKeys: [], selectiveLogic: 0, constant: false, selective: false,
    position: WI_POSITION.BEFORE, depth: 4, role: 'system', scanDepth: null,
    preventRecursion: false, excludeRecursion: false, insertionOrder: 100,
    sticky: 0, cooldown: 0, delay: 0, group: '', groupOverride: false,
    enabled: true, book: 'test', ...over,
  }
}

describe('importLoreBook（ST world JSON 映射）', () => {
  it('对象索引形态（ST 主流形态）', () => {
    const raw = {
      entries: {
        '0': { comment: '地点', content: '咖啡厅', key: ['咖啡厅'], constant: true },
        '1': { comment: '人物', content: '祥子', key: ['祥子'], position: 4, depth: 2 },
      },
    }
    const book = importLoreBook('test', raw)
    expect(book.entries).toHaveLength(2)
    expect(book.entries[0].constant).toBe(true)
    expect(book.entries[1].position).toBe(4)
  })
  it('timed effects / 组 已支持不再警告，仅剩概率弃用警告（P2#11 后 §4.2 导入明示）', () => {
    const raw = {
      entries: [
        { comment: 'a', content: 'x', key: ['k'], delay: 3, sticky: 2, cooldown: 4 },
        { comment: 'b', content: 'x', key: ['k'], probability: 50 },
        { comment: 'c', content: 'x', key: ['k'], group: 'g1' },
      ],
    }
    const book = importLoreBook('test', raw)
    // delay/sticky/cooldown/group 已由 trigger.ts 消费，不再发弃用警告
    expect(book.importWarnings.some(w => w.includes('delay'))).toBe(false)
    expect(book.importWarnings.some(w => w.includes('inclusion group'))).toBe(false)
    // 字段无损保留
    expect(book.entries[0].delay).toBe(3)
    expect(book.entries[0].sticky).toBe(2)
    expect(book.entries[0].cooldown).toBe(4)
    expect(book.entries[2].group).toBe('g1')
    // 概率仍弃用（按 100% 处理）
    expect(book.importWarnings.some(w => w.includes('概率'))).toBe(true)
  })
  it('旧版 key 单数字符串不崩（T2.11 修：pick 命中字符串后 keys.map 崩溃）', () => {
    const raw = {
      entries: [
        { comment: '地点', content: '咖啡厅', key: '咖啡厅' },
        { comment: '人物', content: '祥子', keys: ['祥子'], keysecondary: '备选' },
      ],
    }
    const book = importLoreBook('test', raw)
    expect(book.entries[0].keys).toEqual(['咖啡厅'])
    expect(book.entries[1].keys).toEqual(['祥子'])
    expect(book.entries[1].secondaryKeys).toEqual(['备选'])
  })
})

describe('triggerWorldInfo（触发引擎）', () => {
  it('constant 常驻无条件激活', () => {
    const r = triggerWorldInfo([entry({ constant: true, keys: ['不存在的词'] })], ['无关文本'])
    expect(r.activated).toHaveLength(1)
    expect(r.activated[0].reason).toBe('constant')
  })

  it('关键词触发（含空格关键词=includes 语义，ST 真实分支）', () => {
    const r = triggerWorldInfo([entry({ keys: ['推门 走进 咖啡厅'] })], ['我推门 走进 咖啡厅'])
    expect(r.activated).toHaveLength(1)
  })

  it('非全词模式：中文关键词子串命中', () => {
    const r = triggerWorldInfo(
      [entry({ keys: ['咖啡厅'] })],
      ['我推门走进咖啡厅'],
      { matchWholeWords: false },
    )
    expect(r.activated).toHaveLength(1)
    expect(r.activated[0].reason).toBe('primary')
  })

  it('全词模式英文：单词命中、子串不误触发（ST \\W 边界语义）', () => {
    const r = triggerWorldInfo(
      [entry({ keys: ['king'] })],
      ['the king arrived'],
      { matchWholeWords: true },
    )
    expect(r.activated).toHaveLength(1)
    const r2 = triggerWorldInfo(
      [entry({ keys: ['king'] })],
      ['the kingdom fell'],
      { matchWholeWords: true },
    )
    expect(r2.activated).toHaveLength(0)
  })

  it('scanDepth 窗口外的旧消息不触发', () => {
    const r = triggerWorldInfo(
      [entry({ keys: ['推门 走进'] })],
      ['我推门 走进咖啡厅', '后来的闲聊', '更多闲聊'],
      { scanDepth: 1, matchWholeWords: false },
    )
    expect(r.activated).toHaveLength(0)
  })

  it('正则关键词 /regex/ 形态', () => {
    const r = triggerWorldInfo([entry({ keys: ['/祥子|睦/'] })], ['若叶睦走了过来'])
    expect(r.activated).toHaveLength(1)
  })

  it('递归扫描：条目 A 内容触发条目 B', () => {
    const a = entry({ id: 'a', keys: ['推门 走进'], content: '祥子常在这里出现' })
    const b = entry({ id: 'b', keys: ['祥子'], content: '丰川祥子的资料' })
    const r = triggerWorldInfo([a, b], ['我推门 走进'], { matchWholeWords: false })
    expect(r.activated.map(x => x.entry.id).sort()).toEqual(['a', 'b'])
    expect(r.activated.find(x => x.entry.id === 'b')?.reason).toBe('recursion')
    expect(r.recursionRounds).toBeGreaterThanOrEqual(1)
  })

  it('excludeRecursion 条目不参与递归轮', () => {
    const a = entry({ id: 'a', keys: ['推门 走进'], content: '祥子常在这里' })
    const b = entry({ id: 'b', keys: ['祥子'], content: 'x', excludeRecursion: true })
    const r = triggerWorldInfo([a, b], ['我推门 走进'], { matchWholeWords: false })
    expect(r.activated.map(x => x.entry.id)).toEqual(['a'])
  })

  it('token 预算裁剪（超预算条目进 budgetDropped）', () => {
    const big = entry({ id: 'big', constant: true, content: 'x'.repeat(40000) }) // ~10000 tokens
    const small = entry({ id: 'small', constant: true, content: 'y'.repeat(40) })
    const r = triggerWorldInfo([big, small], [''], {
      budgetPercent: 10, contextTokenLimit: 1000, // 预算 100 tokens
    })
    expect(r.budgetDropped.length).toBeGreaterThanOrEqual(1)
    expect(r.activated.some(a => a.entry.id === 'small')).toBe(true)
  })

  it('disabled 条目永不激活', () => {
    const r = triggerWorldInfo([entry({ keys: ['推门'], enabled: false })], ['推门'], { matchWholeWords: false })
    expect(r.activated).toHaveLength(0)
  })

  it('trace 记录触发链（round/key）', () => {
    const r = triggerWorldInfo([entry({ id: 'a', keys: ['推门'] })], ['我推门了'], { matchWholeWords: false })
    expect(r.trace).toContainEqual({ round: 0, entryId: 'a', key: '推门' })
  })
})

describe('triggerWorldInfo · P2#11 timed effects 与组互斥', () => {
  it('sticky：命中写入 [cursor, cursor+sticky) 区间；期内无关键词也强制激活（reason=sticky）', () => {
    const e = entry({ id: 's', keys: ['咖啡厅'], sticky: 3 })
    // 第 1 轮：关键词命中，写入 sticky 区间 [4, 7)
    const r1 = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false, cursor: 4 })
    expect(r1.activated[0]?.reason).toBe('primary')
    expect(r1.timedEffects).toContainEqual({ entryId: 's', type: 'sticky', start: 4, end: 7 })
    // 第 2 轮：游标 5 在区间内，无关键词也强制激活
    const r2 = triggerWorldInfo([e], ['完全无关的话'], { matchWholeWords: false, cursor: 5, timedEffects: r1.timedEffects })
    expect(r2.activated).toHaveLength(1)
    expect(r2.activated[0].reason).toBe('sticky')
    // sticky 期内不重开区间（仍只有一条 sticky effect）
    expect(r2.timedEffects.filter(t => t.type === 'sticky')).toHaveLength(1)
    // 第 3 轮：游标 7 出区间（[start, end) 右开），不再激活
    const r3 = triggerWorldInfo([e], ['完全无关的话'], { matchWholeWords: false, cursor: 7, timedEffects: r2.timedEffects })
    expect(r3.activated).toHaveLength(0)
  })

  it('cooldown：命中后 N 条内关键词再命中也不触发；过期 effect 被清理', () => {
    const e = entry({ id: 'c', keys: ['咖啡厅'], cooldown: 2 })
    const r1 = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false, cursor: 4 })
    expect(r1.activated).toHaveLength(1)
    expect(r1.timedEffects).toContainEqual({ entryId: 'c', type: 'cooldown', start: 4, end: 6 })
    // 冷却期内：关键词仍在扫描文本里也不触发
    const r2 = triggerWorldInfo([e], ['又提咖啡厅'], { matchWholeWords: false, cursor: 5, timedEffects: r1.timedEffects })
    expect(r2.activated).toHaveLength(0)
    // 冷却结束：恢复触发；过期 effect（end<=cursor）不带回
    const r3 = triggerWorldInfo([e], ['再提咖啡厅'], { matchWholeWords: false, cursor: 6, timedEffects: r2.timedEffects })
    expect(r3.activated).toHaveLength(1)
    expect(r3.timedEffects.filter(t => t.end <= 6)).toHaveLength(0)
    expect(r3.timedEffects).toContainEqual({ entryId: 'c', type: 'cooldown', start: 6, end: 8 })
  })

  it('sticky 优先于 cooldown：两区间同时生效时仍激活', () => {
    const e = entry({ id: 'sc', keys: ['咖啡厅'], sticky: 5, cooldown: 5 })
    const r1 = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false, cursor: 2 })
    expect(r1.timedEffects).toContainEqual({ entryId: 'sc', type: 'sticky', start: 2, end: 7 })
    expect(r1.timedEffects).toContainEqual({ entryId: 'sc', type: 'cooldown', start: 2, end: 7 })
    const r2 = triggerWorldInfo([e], ['无关'], { matchWholeWords: false, cursor: 3, timedEffects: r1.timedEffects })
    expect(r2.activated[0]?.reason).toBe('sticky')
  })

  it('delay：游标 < delay 不触发；游标到位后恢复（含递归轮）', () => {
    const e = entry({ id: 'd', keys: ['咖啡厅'], delay: 3 })
    const r1 = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false, cursor: 2 })
    expect(r1.activated).toHaveLength(0)
    const r2 = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false, cursor: 3 })
    expect(r2.activated).toHaveLength(1)
    // 递归轮同样被 delay 门拦截：a 内容含「祥子」，b 有 delay 未到
    const a = entry({ id: 'a', keys: ['推门'], content: '祥子常在这里' })
    const b = entry({ id: 'b', keys: ['祥子'], content: 'x', delay: 10 })
    const r3 = triggerWorldInfo([a, b], ['我推门了'], { matchWholeWords: false, cursor: 5 })
    expect(r3.activated.map(x => x.entry.id)).toEqual(['a'])
  })

  it('inclusion group 组互斥：同组只留 insertionOrder 最高的一条', () => {
    const low = entry({ id: 'low', keys: ['咖啡厅'], group: '场景', insertionOrder: 10 })
    const high = entry({ id: 'high', keys: ['咖啡厅'], group: '场景', insertionOrder: 90 })
    const other = entry({ id: 'other', keys: ['咖啡厅'], group: '人物', insertionOrder: 50 })
    const r = triggerWorldInfo([low, high, other], ['走进咖啡厅'], { matchWholeWords: false })
    expect(r.activated.map(a => a.entry.id).sort()).toEqual(['high', 'other'])
  })

  it('groupOverride 豁免组互斥；无组条目全部保留；逗号多组按组分别竞争', () => {
    const a = entry({ id: 'a', keys: ['咖啡厅'], group: 'g1', insertionOrder: 10 })
    const o = entry({ id: 'o', keys: ['咖啡厅'], group: 'g1', insertionOrder: 20, groupOverride: true })
    const free = entry({ id: 'free', keys: ['咖啡厅'] })
    const r = triggerWorldInfo([a, o, free], ['走进咖啡厅'], { matchWholeWords: false })
    expect(r.activated.map(x => x.entry.id).sort()).toEqual(['a', 'free', 'o'])
    // 多组：条目同时在 g1,g2 时，在一组败北即整条目被该组挤掉，但若在任一组胜出则保留
    const m1 = entry({ id: 'm1', keys: ['咖啡厅'], group: 'g1,g2', insertionOrder: 30 })
    const m2 = entry({ id: 'm2', keys: ['咖啡厅'], group: 'g2', insertionOrder: 40 })
    const r2 = triggerWorldInfo([m1, m2], ['走进咖啡厅'], { matchWholeWords: false })
    // m2 在 g2 胜出（40>30），m1 在 g1 也胜出（组内唯一）→ 两条都保留（dedupeGroups 语义）
    expect(r2.activated.map(x => x.entry.id).sort()).toEqual(['m1', 'm2'])
  })

  it('timed effects 缺省不传：行为与旧版一致（无 cursor 语义时不凭空生效）', () => {
    const e = entry({ id: 't', keys: ['咖啡厅'], sticky: 3, cooldown: 3 })
    const r = triggerWorldInfo([e], ['走进咖啡厅'], { matchWholeWords: false })
    expect(r.activated).toHaveLength(1)
    // cursor=0 首轮写入 [0,3)，但调用方不回传即不累积
    expect(r.timedEffects).toHaveLength(2)
  })
})

describe('buildScanText', () => {
  it('倒序窗口拼接', () => {
    expect(buildScanText(['a', 'b', 'c'], 2)).toBe('b\nc')
  })
})

describe('visibleMessageCursor（P0-5 时间游标，dsh-worldbook inject.ts 同款语义）', () => {
  it('只累计真实 user/assistant 消息；插件注入与快照不计', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant' } } },
      // 插件注入（kind=plugin）不计
      { type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: 'dsht-rp-plugin', form: 'snapshot' } } },
      // 官方 runtime-context 快照不计
      { type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' } } },
      { type: 'step/end', data: { turn: 1, step: 1 } },
      { type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
      { type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant' } } },
    ]
    expect(visibleMessageCursor(events)).toBe(4) // 2 真实 user + 2 assistant
  })
  it('空事件流 / 无 source 的 user 消息边界', () => {
    expect(visibleMessageCursor([])).toBe(0)
    expect(visibleMessageCursor([{ type: 'user/message', data: {} }])).toBe(0) // 无 source.kind 不计
  })
})
