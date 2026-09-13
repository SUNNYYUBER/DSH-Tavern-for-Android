/**
 * T-78：世界书关键词正则的安全防护（单源 src/lore/safe-regex.ts）
 *
 * 覆盖四类：
 *  1. 功能不被改坏 —— 真实形态关键词（中文 / `/pattern/flags` / 大小写不敏感 / 全词）仍正确匹配
 *  2. 恶意正则（`(a+)+$` 配长 `aaaa…b`）**被挡住且不卡死**（断言在合理时间内返回）
 *  3. 降级**可见**（degradations 有 reason、可定位到 entryId + 出声）
 *  4. 各限额各一个用例（单 pattern 长度 / 规则数 / flags 白名单 / 静态拒绝 / 文本截断）+ 出声去重
 *
 * 说明：每个用例注入**独立** RegexSafetyGuard（经 config.regexGuard），避免共享单例的
 * 编译缓存与出声去重集合造成用例间串扰（单例行为另用一个用例单独验证跨轮去重）。
 */
import { describe, it, expect, vi } from 'vitest'
import { WI_POSITION, type LoreEntry } from '../src/lore/entry.ts'
import { triggerWorldInfo, DEFAULT_TRIGGER_CONFIG } from '../src/lore/trigger.ts'
import {
  RegexSafetyGuard, SAFE_REGEX_LIMITS, ALLOWED_REGEX_FLAGS, resetRegexGuardDedup,
  type DegradeEvent,
} from '../src/lore/safe-regex.ts'

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

/** 建独立 guard + 捕获出声（返回 guard 与出声数组） */
function makeGuard(limits?: Partial<typeof SAFE_REGEX_LIMITS>) {
  const spoken: DegradeEvent[] = []
  const guard = new RegexSafetyGuard({
    ...(limits ? { limits } : {}),
    onDegrade: e => spoken.push(e),
  })
  return { guard, spoken }
}

/** 简单关键词（非正则形态）触发辅助 */
const plain = (keys: string[], msg: string, guard: RegexSafetyGuard, cfg: object = {}) =>
  triggerWorldInfo([entry({ keys })], [msg], {
    matchWholeWords: false, regexGuard: guard, ...cfg,
  } as never)

// ---------------------------------------------------------------------------
// 1. 功能不被改坏
// ---------------------------------------------------------------------------
describe('T-78 · 正常关键词仍正确匹配（改防护不能改功能）', () => {
  it('中文关键词（默认全词模式，CJK 属 \\w 的 ST 已知行为不变）', () => {
    const { guard } = makeGuard()
    const r = triggerWorldInfo([entry({ keys: ['咖啡厅'] })], ['我推门走进咖啡厅'], {
      matchWholeWords: false, regexGuard: guard,
    })
    expect(r.activated).toHaveLength(1)
    expect(r.activated[0].reason).toBe('primary')
    expect(r.degradations).toHaveLength(0) // 正常路径零降级
  })

  it('/pattern/flags 形式（含 i 与不敏感默认）仍匹配', () => {
    const { guard } = makeGuard()
    const r = triggerWorldInfo([entry({ keys: ['/祥子|睦/'] })], ['若叶睦走了过来'], { regexGuard: guard })
    expect(r.activated).toHaveLength(1)
    // 显式 i：大小写不敏感
    const r2 = triggerWorldInfo([entry({ keys: ['/king/i'] })], ['the KING arrived'], { regexGuard: guard })
    expect(r2.activated).toHaveLength(1)
    expect(r2.degradations).toHaveLength(0)
  })

  it('大小写敏感开关仍生效（caseSensitive:true 时 King 不命中 king）', () => {
    const { guard } = makeGuard()
    const hit = plain(['king'], 'the King arrived', guard, { caseSensitive: false })
    expect(hit.activated).toHaveLength(1)
    const miss = plain(['king'], 'the King arrived', guard, { caseSensitive: true })
    expect(miss.activated).toHaveLength(0)
  })

  it('全词匹配 \W 边界语义不变（king 命中、kingdom 不命中）', () => {
    const { guard } = makeGuard()
    const hit = plain(['king'], 'the king arrived', guard, { matchWholeWords: true })
    expect(hit.activated).toHaveLength(1)
    const miss = plain(['king'], 'the kingdom fell', guard, { matchWholeWords: true })
    expect(miss.activated).toHaveLength(0)
    expect(miss.degradations).toHaveLength(0)
  })

  it('常见安全正则形态不被误拒（惰性量词 / 锚点 / 交替 / 字符类 / 非捕获组）', () => {
    const { guard, spoken } = makeGuard()
    const safe = [
      '/^\\[(.*?)\\]$/',   // 惰性量词 + 字符类 + 锚点
      '/(?:你|我|他)+/',   // 无首字符重叠的交替
      '/\\d{2,3}/',        // 有限量词
      '/[a-z]+/',          // 字符类 + 量词
    ]
    for (const k of safe) {
      const r = triggerWorldInfo([entry({ keys: [k] })], ['[你好] 123 abc 你我他'], { regexGuard: guard })
      expect(r.degradations, `安全正则被误拒: ${k}`).toHaveLength(0)
    }
    expect(spoken).toHaveLength(0)
  })

  it('既有行为回归：递归扫描 / 副关键词逻辑在防护接入后仍工作', () => {
    const { guard } = makeGuard()
    const a = entry({ id: 'a', keys: ['推门'], content: '祥子常在这里出现' })
    const b = entry({ id: 'b', keys: ['祥子'], content: '丰川祥子的资料' })
    const r = triggerWorldInfo([a, b], ['我推门了'], { matchWholeWords: false, regexGuard: guard })
    expect(r.activated.map(x => x.entry.id).sort()).toEqual(['a', 'b'])
    expect(r.activated.find(x => x.entry.id === 'b')?.reason).toBe('recursion')
  })
})

// ---------------------------------------------------------------------------
// 2. 恶意正则：挡住且不卡死
// ---------------------------------------------------------------------------
describe('T-78 · 恶意正则被挡住且不卡死（ReDoS）', () => {
  it('(a+)+$ 配长 aaaa…b：静态拒绝，微秒级返回（防护失效时该输入需 >1s 指数回溯）', () => {
    const { guard, spoken } = makeGuard()
    const text = 'a'.repeat(26) + 'b'
    const t0 = Date.now()
    const r = triggerWorldInfo([entry({ id: 'evil', keys: ['/(a+)+$/'] })], [text], { regexGuard: guard })
    const elapsed = Date.now() - t0
    expect(r.activated).toHaveLength(0)                       // 未命中（被拒 = 不命中）
    expect(elapsed).toBeLessThan(250)                          // 不卡死
    expect(r.degradations.some(d => d.reason === 'nested-quantifier')).toBe(true)
    expect(spoken.some(e => e.reason === 'nested-quantifier' && e.entryId === 'evil')).toBe(true)
  })

  it('同类嵌套结构全被拦：(a*)* / (a{2,3})+ / (\\d+)+', () => {
    const { guard } = makeGuard()
    for (const k of ['/(a*)*/', '/(a{2,3})+$/', '/(\\d+)+$/']) {
      const r = triggerWorldInfo([entry({ id: 'evil', keys: [k] })], ['a'.repeat(26) + 'b'], { regexGuard: guard })
      expect(r.degradations.some(d => d.reason === 'nested-quantifier'), `未拦下 ${k}`).toBe(true)
    }
  })

  it('交替歧义 (a|aa)+ 与 (.|a)+ 被拦（首字符可重叠 + 无限量词）', () => {
    const { guard } = makeGuard()
    for (const k of ['/(a|aa)+$/', '/(.|a)+$/']) {
      const r = triggerWorldInfo([entry({ id: 'evil', keys: [k] })], ['a'.repeat(26) + 'b'], { regexGuard: guard })
      expect(r.degradations.some(d => d.reason === 'alternation-ambiguity'), `未拦下 ${k}`).toBe(true)
    }
  })

  it('恶意关键词不影响同轮其他合法条目（局部降级，不整体瘫痪）', () => {
    const { guard } = makeGuard()
    const evil = entry({ id: 'evil', keys: ['/(a+)+$/'] })
    const ok = entry({ id: 'ok', keys: ['咖啡厅'] })
    const r = triggerWorldInfo([evil, ok], ['a'.repeat(26) + 'b 咖啡厅'], { matchWholeWords: false, regexGuard: guard })
    expect(r.activated.map(a => a.entry.id)).toEqual(['ok'])
    expect(r.degradations.map(d => d.entryId)).toContain('evil')
  })
})

// ---------------------------------------------------------------------------
// 3. 降级可见（reason + entryId + 出声）
// ---------------------------------------------------------------------------
describe('T-78 · 降级必须可见可定位（不静默，L42）', () => {
  it('非法正则（语法错误）也出声并可定位——原来这里是空 catch', () => {
    const { guard, spoken } = makeGuard()
    const r = triggerWorldInfo([entry({ id: 'bad', keys: ['/(/'] })], ['任意文本'], { regexGuard: guard })
    expect(r.activated).toHaveLength(0)
    const d = r.degradations.find(x => x.reason === 'syntax-error')
    expect(d).toBeDefined()
    expect(d?.entryId).toBe('bad')          // 可定位到具体条目
    expect(d?.detail).toContain('无法编译')
    expect(spoken).toHaveLength(1)          // 出声
  })

  it('默认出声通道 = console.warn，且文案带 entry 与 reason', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const guard = new RegexSafetyGuard() // 用默认 sink
      triggerWorldInfo([entry({ id: 'evil', keys: ['/(a+)+$/'] })], ['aaa'], { regexGuard: guard })
      expect(spy).toHaveBeenCalled()
      const msg = String(spy.mock.calls[0][0])
      expect(msg).toContain('evil')
      expect(msg).toContain('nested-quantifier')
    } finally {
      spy.mockRestore()
    }
  })

  it('出声按 entryId|reason 去重：同一条目同一原因跨轮只出声一次（不刷屏），但 degradations 每轮完整', () => {
    const { guard, spoken } = makeGuard()
    const bad = entry({ id: 'bad', keys: ['/(a+)+$/'] })
    const r1 = triggerWorldInfo([bad], ['文本一'], { regexGuard: guard })
    const r2 = triggerWorldInfo([bad], ['文本二'], { regexGuard: guard })
    expect(r1.degradations).toHaveLength(1)   // 每轮完整记录
    expect(r2.degradations).toHaveLength(1)
    expect(spoken).toHaveLength(1)            // 出声只一次
  })

  it('去重集合可重置（排查用）：resetDedup 后同一原因重新出声', () => {
    const { guard, spoken } = makeGuard()
    const bad = entry({ id: 'bad', keys: ['/(a+)+$/'] })
    triggerWorldInfo([bad], ['文本一'], { regexGuard: guard })
    guard.resetDedup()
    triggerWorldInfo([bad], ['文本二'], { regexGuard: guard })
    expect(spoken).toHaveLength(2)
  })

  it('正常路径零出声零降级（不误报噪声）', () => {
    const { guard, spoken } = makeGuard()
    const r = plain(['咖啡厅', '/祥子|睦/'], '走进咖啡厅，若叶睦也在', guard)
    expect(r.degradations).toHaveLength(0)
    expect(spoken).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. 各限额各一个用例
// ---------------------------------------------------------------------------
describe('T-78 · 四道闸门 + 文本截断，逐条限额用例', () => {
  it('限额①：单 pattern 长度上限（超长 pattern 被拒并出声）', () => {
    const { guard, spoken } = makeGuard()
    const longPattern = '/' + 'a'.repeat(SAFE_REGEX_LIMITS.maxPatternLength + 1) + '/'
    const r = triggerWorldInfo([entry({ id: 'long', keys: [longPattern] })], ['a'.repeat(600)], { regexGuard: guard })
    expect(r.activated).toHaveLength(0)
    const d = r.degradations.find(x => x.reason === 'pattern-too-long')
    expect(d?.entryId).toBe('long')
    expect(d?.detail).toContain(String(SAFE_REGEX_LIMITS.maxPatternLength))
    expect(spoken.some(e => e.reason === 'pattern-too-long')).toBe(true)
  })

  it('限额②：本次扫描编译规则数上限（超出者被拒，逐条可定位；出声按原因去重）', () => {
    const { guard, spoken } = makeGuard()
    // 造 maxRulesPerScan + 2 条各带唯一关键词的条目（唯一 pattern 才会计费）
    const n = SAFE_REGEX_LIMITS.maxRulesPerScan + 2
    const entries = Array.from({ length: n }, (_, i) =>
      entry({ id: `e${i}`, keys: [`kw${i}`], content: 'x' }))
    const r = triggerWorldInfo(entries, ['无命中文本'], { matchWholeWords: false, regexGuard: guard })
    const exceeded = r.degradations.filter(d => d.reason === 'rules-exceeded')
    expect(exceeded).toHaveLength(2)                                   // 超出的 2 条逐条记录
    expect(exceeded.map(d => d.entryId).sort()).toEqual([`e${n - 2}`, `e${n - 1}`])
    // 出声按原因去重：2 条超限只出声 1 次
    expect(spoken.filter(e => e.reason === 'rules-exceeded')).toHaveLength(1)
    expect(r.activated).toHaveLength(0)
  })

  it('限额②补充：规则数配额按「本次扫描会话」计——缓存命中的重复 pattern 不重复计费', () => {
    const { guard } = makeGuard({ maxRulesPerScan: 1 })
    // 两条条目共用同一关键词：第 2 次命中缓存，不应被 rules-exceeded 拒掉
    const a = entry({ id: 'a', keys: ['咖啡厅'] })
    const b = entry({ id: 'b', keys: ['咖啡厅'] })
    const r = triggerWorldInfo([a, b], ['走进咖啡厅'], { matchWholeWords: false, regexGuard: guard })
    expect(r.degradations).toHaveLength(0)
    expect(r.activated.map(x => x.entry.id).sort()).toEqual(['a', 'b'])
  })

  it('限额③：flags 白名单——g/y 被拒（imsu 通过），且 g 不会造成 lastIndex 跨调用状态污染', () => {
    const { guard, spoken } = makeGuard()
    const r = triggerWorldInfo([entry({ id: 'g', keys: ['/咖啡厅/g'] })], ['咖啡厅 咖啡厅'], { regexGuard: guard })
    expect(r.activated).toHaveLength(0)
    const d = r.degradations.find(x => x.reason === 'flags-not-allowed')
    expect(d?.entryId).toBe('g')
    expect(d?.detail).toContain('g')
    expect(spoken.some(e => e.reason === 'flags-not-allowed')).toBe(true)
    // 白名单本身：只放行 i/m/s/u
    expect(ALLOWED_REGEX_FLAGS.test('ims')).toBe(true)
    expect(ALLOWED_REGEX_FLAGS.test('iu')).toBe(true)
    expect(ALLOWED_REGEX_FLAGS.test('u')).toBe(true)
    expect(ALLOWED_REGEX_FLAGS.test('')).toBe(true)
    for (const f of ['g', 'y', 'd', 'v', 'gi', 'sgi']) {
      expect(ALLOWED_REGEX_FLAGS.test(f), `${f} 不应在白名单`).toBe(false)
    }
  })

  it('限额③补充：y/sticky 与 d 也被拒（不被静默当作无 flags 处理）', () => {
    const { guard } = makeGuard()
    for (const k of ['/咖啡厅/y', '/咖啡厅/d', '/咖啡厅/v']) {
      const r = triggerWorldInfo([entry({ id: 'f', keys: [k] })], ['咖啡厅'], { regexGuard: guard })
      expect(r.activated).toHaveLength(0)
      expect(r.degradations.some(d => d.reason === 'flags-not-allowed'), `未拦下 ${k}`).toBe(true)
    }
  })

  it('限额④：危险模式静态拒绝（reason 明确写清是静态拒绝，不是语法错误）', () => {
    const { guard, spoken } = makeGuard()
    const r = triggerWorldInfo([entry({ id: 'evil', keys: ['/(a+)+$/'] })], ['aaa'], { regexGuard: guard })
    const d = r.degradations[0]
    expect(d.reason).toBe('nested-quantifier')
    expect(d.detail).toContain('指数回溯')
    expect(d.detail).toContain('静态')  // 前端/日志可区分「静态拒绝」与「运行期失败」
    expect(spoken[0].detail).toContain('指数回溯')
  })

  it('限额⑤：扫描文本超长 → 截断 + 出声（entryId 诚实标注为 scan 而非条目）', () => {
    const { guard, spoken } = makeGuard()
    const longText = 'x'.repeat(SAFE_REGEX_LIMITS.maxTextLength + 100)
    const r = triggerWorldInfo([entry({ id: 'k', keys: ['无此词'] })], [longText], { regexGuard: guard })
    const d = r.degradations.find(x => x.reason === 'text-truncated')
    expect(d).toBeDefined()
    expect(d?.entryId).toContain('scan:round=0')  // 定位维度是轮次（诚实标注）
    expect(d?.detail).toContain(String(SAFE_REGEX_LIMITS.maxTextLength))
    expect(spoken.some(e => e.reason === 'text-truncated')).toBe(true)
  })

  it('限额⑤补充：截断后窗口内的关键词仍能命中（不是整条禁用）', () => {
    const { guard } = makeGuard()
    const text = '咖啡厅' + 'y'.repeat(SAFE_REGEX_LIMITS.maxTextLength)
    const r = triggerWorldInfo([entry({ id: 'k', keys: ['咖啡厅'] })], [text], { matchWholeWords: false, regexGuard: guard })
    expect(r.activated.map(a => a.entry.id)).toEqual(['k'])
    expect(r.degradations.some(d => d.reason === 'text-truncated')).toBe(true)
  })

  it('防护缺省即生效（不传 regexGuard 时走进程级单例，含去重）', () => {
    resetRegexGuardDedup()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const r = triggerWorldInfo(
        [entry({ id: 'evil-default', keys: ['/(a+)+$/'] })], ['aaa'],
        { ...DEFAULT_TRIGGER_CONFIG, matchWholeWords: false },
      )
      expect(r.degradations.some(d => d.reason === 'nested-quantifier')).toBe(true)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      resetRegexGuardDedup()
    }
  })
})
