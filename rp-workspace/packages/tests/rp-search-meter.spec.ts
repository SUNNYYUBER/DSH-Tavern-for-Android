import { describe, expect, it } from 'vitest'
import {
  SEARCH_RESULT_LIMIT,
  SNIPPET_RADIUS,
  extractSnippet,
  firstHitIndex,
  searchMessages,
  splitHighlight,
  type SearchableMessage,
} from '../src/dsht-rp-ui/src/client/search-core.ts'
import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_CONTEXT,
  estimateTokens,
  formatTokens,
  meterLevel,
  meterPercent,
  sumMessageChars,
} from '../src/dsht-rp-ui/src/client/token-meter-core.ts'

// ---------------------------------------------------------------------------
// 消息搜索（RpSearchPanel 数据面纯逻辑）
// ---------------------------------------------------------------------------

describe('消息搜索：firstHitIndex / extractSnippet（大小写不敏感 + 命中片段）', () => {
  it('大小写不敏感命中；空 query 返回 -1', () => {
    expect(firstHitIndex('Hello World', 'world')).toBe(6)
    expect(firstHitIndex('Hello World', 'lo wo')).toBe(3)
    expect(firstHitIndex('Hello World', 'LO WO')).toBe(-1) // 契约：query 须预先 lower
    expect(firstHitIndex('任意文本', '')).toBe(-1)
  })

  it('片段：命中词前后各 ~40 字，headCut/tailCut 标记裁剪', () => {
    const text = 'a'.repeat(60) + '命中' + 'b'.repeat(60)
    const s = extractSnippet(text, 60, 2)
    expect(s.before).toBe('a'.repeat(SNIPPET_RADIUS))
    expect(s.match).toBe('命中')
    expect(s.after).toBe('b'.repeat(SNIPPET_RADIUS))
    expect(s.headCut).toBe(true)
    expect(s.tailCut).toBe(true)
  })

  it('片段：贴边命中不裁剪（headCut/tailCut 为 false）', () => {
    const s = extractSnippet('短文本命中收尾', 3, 2)
    expect(s.headCut).toBe(false)
    expect(s.tailCut).toBe(false)
    expect(s.before).toBe('短文本')
    expect(s.match).toBe('命中')
    expect(s.after).toBe('收尾')
  })

  it('片段：切点码点对齐，不切坏 emoji 代理对', () => {
    // x*40 + 👍(2 码元) + m*39 + y*80：命中 y 区时 rawFrom=41 恰落在 👍 的低代理上，
    // alignLow 应把片段左边界退到高代理前（40）
    const text = 'x'.repeat(40) + '👍' + 'm'.repeat(39) + 'y'.repeat(80)
    const s = extractSnippet(text, 81, 2)
    expect(s.match).toBe('yy')
    expect(s.before).toBe('👍' + 'm'.repeat(39))
    expect(s.headCut).toBe(true)
    expect(s.tailCut).toBe(true)
    // 拼接序列不含孤立代理（高代理后必须跟低代理；低代理前必须有高代理）
    const seq = s.before + s.match + s.after
    expect(seq).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(seq).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/)
  })

  it('searchMessages：过滤 + 楼层序 + 片段组装；空 query 出空', () => {
    const msgs: SearchableMessage[] = [
      { message_id: 0, name: 'User', role: 'user', message: '推门走进咖啡厅' },
      { message_id: 1, name: 'Alice', role: 'assistant', message: '你推开咖啡厅的门，铃铛轻响。' },
      { message_id: 2, name: 'User', role: 'user', message: 'Hello Coffee World' },
      { message_id: 3, name: 'Alice', role: 'assistant', message: '' },
    ]
    const hits = searchMessages(msgs, '咖啡厅')
    expect(hits.map(h => h.messageId)).toEqual([0, 1])
    expect(hits[0]!.name).toBe('User')
    expect(hits[0]!.snippet.match).toBe('咖啡厅')
    expect(hits[1]!.snippet.before).toBe('你推开')
    expect(searchMessages(msgs, '   ')).toEqual([])
    expect(searchMessages(undefined, '咖啡厅')).toEqual([])
    expect(searchMessages(msgs, '不存在的词')).toEqual([])
  })

  it('searchMessages：大小写不敏感（英文）', () => {
    const msgs: SearchableMessage[] = [
      { message_id: 0, name: 'Alice', role: 'assistant', message: 'The Café opens at Eight.' },
    ]
    expect(searchMessages(msgs, 'café')[0]!.snippet.match).toBe('Café')
    expect(searchMessages(msgs, 'EIGHT').length).toBe(1)
  })

  it(`searchMessages：上限 ${SEARCH_RESULT_LIMIT} 条防卡`, () => {
    const msgs: SearchableMessage[] = Array.from({ length: SEARCH_RESULT_LIMIT + 20 }, (_, i) => ({
      message_id: i,
      name: 'A',
      role: 'assistant' as const,
      message: `第 ${i} 条含关键词`,
    }))
    const hits = searchMessages(msgs, '关键词')
    expect(hits.length).toBe(SEARCH_RESULT_LIMIT)
    expect(hits[SEARCH_RESULT_LIMIT - 1]!.messageId).toBe(SEARCH_RESULT_LIMIT - 1)
  })

  it('splitHighlight：全文多命中标出，非命中段还原原文（不产出空段）', () => {
    const segs = splitHighlight('咖啡厅见，回头去咖啡厅。', '咖啡厅')
    expect(segs).toEqual([
      { t: '咖啡厅', hit: true },
      { t: '见，回头去', hit: false },
      { t: '咖啡厅', hit: true },
      { t: '。', hit: false },
    ])
    expect(segs.map(s => s.t).join('')).toBe('咖啡厅见，回头去咖啡厅。')
  })

  it('splitHighlight：大小写不敏感 + 空 query 整段原样', () => {
    expect(splitHighlight('Hello HELLO hello', 'hello')).toEqual([
      { t: 'Hello', hit: true },
      { t: ' ', hit: false },
      { t: 'HELLO', hit: true },
      { t: ' ', hit: false },
      { t: 'hello', hit: true },
    ])
    expect(splitHighlight('原样', '  ')).toEqual([{ t: '原样', hit: false }])
  })
})

// ---------------------------------------------------------------------------
// token 上下文进度条（RpTokenMeter 估算口径纯逻辑）
// ---------------------------------------------------------------------------

describe('token 计量：字符量估算口径（token-meter-core）', () => {
  it('estimateTokens：chars/2.5 四舍五入；非法输入归 0', () => {
    expect(CHARS_PER_TOKEN).toBe(2.5)
    expect(estimateTokens(25)).toBe(10)
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(-5)).toBe(0)
    expect(estimateTokens(Number.NaN)).toBe(0)
  })

  it('sumMessageChars：文本字段求和，非法形状按空串', () => {
    expect(sumMessageChars([
      { message: '三个字' },
      { message: 'ab' },
      { message: 42 },
      {},
      { message: null },
    ])).toBe(5)
    expect(sumMessageChars(undefined)).toBe(0)
  })

  it('meterPercent：clamp 到 100；预算非法为 0（不出 NaN）', () => {
    expect(meterPercent(8000, 16384)).toBeCloseTo(48.83, 1)
    expect(meterPercent(99999, 16384)).toBe(100)
    expect(meterPercent(0, 16384)).toBe(0)
    expect(meterPercent(100, 0)).toBe(0)
  })

  it('meterLevel 三档：<70 ok / 70-90 warn / >90 danger（含边界）', () => {
    const budget = 1000
    expect(meterLevel(699, budget)).toBe('ok')
    expect(meterLevel(700, budget)).toBe('warn')
    expect(meterLevel(900, budget)).toBe('warn')
    expect(meterLevel(901, budget)).toBe('danger')
  })

  it('formatTokens：紧凑显示（个/k/M 一位小数）', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12295)).toBe('12.3k')
    expect(formatTokens(122000)).toBe('122k')
    expect(formatTokens(1234567)).toBe('1.2M')
  })

  it('缺省预算常量：sampling.maxContext 解析不到时的兜底', () => {
    expect(DEFAULT_MAX_CONTEXT).toBe(16384)
  })
})
