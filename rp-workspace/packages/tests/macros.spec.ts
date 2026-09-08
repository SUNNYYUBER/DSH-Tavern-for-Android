import { describe, it, expect } from 'vitest'
import { MacroEngine, type MacroContext } from '../src/macros/engine.ts'
import { expandTavernMacros } from '../src/dsht-plugin-shared/macros.ts'

function ctx(over: Partial<MacroContext> = {}): MacroContext {
  return {
    user: '旅行者',
    char: '丰川祥子',
    stableSeed: 'session-1',
    getState: path => (path === 'stat_data.当前时间' ? '傍晚' : path === 'stat_data' ? { 当前时间: '傍晚' } : undefined),
    ...over,
  }
}

describe('MacroEngine 身份宏', () => {
  it('{{user}} / {{char}} 替换', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{user}}推开门，{{char}}抬起头。', ctx())
    expect(r.text).toBe('旅行者推开门，丰川祥子抬起头。')
    expect(r.unknownMacros).toEqual([])
  })
})

describe('MacroEngine 随机/稳定选择', () => {
  it('random：每次求值重掷（值域内）', () => {
    const e = new MacroEngine()
    const list = ['贝尔法斯特', '赫敏', '谢菲尔德']
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const r = e.evaluate('{{random:贝尔法斯特,赫敏,谢菲尔德}}', ctx())
      seen.add(r.text)
    }
    expect(seen.size).toBeGreaterThanOrEqual(2) // 60 次至少掷出 2 种
    for (const v of seen) expect(list).toContain(v)
  })

  it('random：:: 分隔（用户实测形态）', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{random::雷诺::泰克斯::孙悟空}}', ctx())
    expect(['雷诺', '泰克斯', '孙悟空']).toContain(r.text)
  })

  it('pick：同文本同位置稳定（ST 语义核心）', () => {
    const e = new MacroEngine()
    const text = '今天遇到{{pick::A::B::C}}然后{{pick::A::B::C}}'
    const r1 = e.evaluate(text, ctx())
    const r2 = e.evaluate(text, ctx())
    expect(r1.text).toBe(r2.text)
    // 两个 pick 位置不同 → 允许不同值，但各位置独立稳定
    const [first, second] = r1.text.match(/A|B|C/g) ?? []
    expect(['A', 'B', 'C']).toContain(first)
    expect(['A', 'B', 'C']).toContain(second)
  })

  it('pick：换 session 重新掷（稳定性锚点是会话）', () => {
    const e = new MacroEngine()
    const text = '{{pick::A::B::C}}'
    const r1 = e.evaluate(text, ctx({ stableSeed: 'session-1' }))
    const r3 = e.evaluate(text, ctx({ stableSeed: 'session-2' }))
    // 不同种子不保证必然不同，只保证各自稳定；断言不抛错即可
    expect(['A', 'B', 'C']).toContain(r1.text)
    expect(['A', 'B', 'C']).toContain(r3.text)
  })

  it('逗号分隔 trim + 转义逗号（ST 语义）', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{random:a, b\\, c}}', ctx())
    expect(['a', 'b, c']).toContain(r.text)
  })
})

describe('MacroEngine 骰子', () => {
  it('roll：1d20 形态', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{roll:1d20}}', ctx())
    expect(Number(r.text)).toBeGreaterThanOrEqual(1)
    expect(Number(r.text)).toBeLessThanOrEqual(20)
  })
  it('roll：纯数字 = 1dN（ST 语义）', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{roll:6}}', ctx())
    expect(Number(r.text)).toBeGreaterThanOrEqual(1)
    expect(Number(r.text)).toBeLessThanOrEqual(6)
  })
})

describe('MacroEngine 变量宏', () => {
  it('getvar 读嵌套路径', () => {
    const e = new MacroEngine()
    const r = e.evaluate('时间：{{getvar::stat_data.当前时间}}', ctx())
    expect(r.text).toBe('时间：傍晚')
  })
  it('get_message_variable 同源读取（MVU 宏形态）', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{get_message_variable::stat_data.当前时间}}', ctx())
    expect(r.text).toBe('傍晚')
  })
  it('对象 stringify', () => {
    const e = new MacroEngine()
    const r = e.evaluate('{{format_message_variable::stat_data}}', ctx())
    expect(r.text).toContain('当前时间')
  })
})

describe('MacroEngine 注释与未知宏', () => {
  it('{{// ...}} 注释剥离', () => {
    const e = new MacroEngine()
    const r = e.evaluate('A{{// 这是注释}}B', ctx())
    expect(r.text).toBe('AB')
  })
  it('未知宏保留原文 + 警告（不吞内容）', () => {
    const e = new MacroEngine()
    const r = e.evaluate('前置 {{engramEntityStates}} 后置', ctx())
    expect(r.text).toBe('前置 {{engramEntityStates}} 后置')
    expect(r.unknownMacros).toEqual(['{{engramEntityStates}}'])
  })
})

describe('MacroEngine 插件宏注册', () => {
  it('注册后接管（Engram 式扩展点）', () => {
    const e = new MacroEngine()
    const dispose = e.register({
      name: 'engramEntityStates',
      replace: () => '<<实体状态>>',
    })
    const r = e.evaluate('{{engramEntityStates}}', ctx())
    expect(r.text).toBe('<<实体状态>>')
    expect(r.unknownMacros).toEqual([])
    dispose()
    const r2 = e.evaluate('{{engramEntityStates}}', ctx())
    expect(r2.unknownMacros).toEqual(['{{engramEntityStates}}'])
  })
})

// ---------------------------------------------------------------------------
// P0-4：MacroEngine 收敛为 expandTavernMacros 包装——两套引擎同输入同输出
// ---------------------------------------------------------------------------

describe('P0-4 引擎统一：MacroEngine ≡ expandTavernMacros', () => {
  const tavernCtx = (over: Partial<MacroContext> = {}) => {
    const c = ctx(over)
    return {
      user: c.user,
      char: c.char,
      persona: c.personaDescription,
      getVar: c.getState,
      stableSeed: c.stableSeed,
      now: new Date('2026-08-27T10:30:45'),
    }
  }
  const cases = [
    '{{user}}推开门，{{char}}抬起头。',
    '时间：{{getvar::stat_data.当前时间}}',
    '{{pick::A::B::C}}然后{{pick::A::B::C}}', // 稳定选择
    'A{{// 注释}}B{{! 另一种注释}}C',
    '{{noop}}前后',
    '前置 {{engramEntityStates}} 后置', // 未知宏保留
    '{{setvar::x::1}}x={{getvar::x}}', // 顺序求值
    '{{addvar::n::5}}n={{getvar::n}}',
    '{{incvar::i}}{{decvar::i}}i={{getvar::i}}',
  ]
  it('同输入同输出（text + unknownMacros 一致）', () => {
    const e = new MacroEngine()
    for (const text of cases) {
      const a = e.evaluate(text, ctx())
      const b = expandTavernMacros(text, tavernCtx())
      expect(a.text).toBe(b.text)
      expect(a.unknownMacros).toEqual(b.unknownMacros)
    }
  })
  it('MVU 别名（get_message_variable/format_message_variable）= getvar 等价改写', () => {
    const e = new MacroEngine()
    // 别名在包装层改写为 getvar 后进统一引擎（底层引擎本身不认别名）
    expect(e.evaluate('{{get_message_variable::stat_data.当前时间}}', ctx()).text)
      .toBe(expandTavernMacros('{{getvar::stat_data.当前时间}}', tavernCtx()).text)
    expect(e.evaluate('{{format_message_variable::stat_data}}', ctx()).text)
      .toBe(expandTavernMacros('{{getvar::stat_data}}', tavernCtx()).text)
  })
  it('补齐的宏（addvar/incvar/decvar/noop/dice）在 MacroEngine 侧可用', () => {
    const e = new MacroEngine()
    expect(e.evaluate('{{setvar::hp::10}}{{addvar::hp::5}}{{getvar::hp}}', ctx()).text).toBe('15')
    expect(e.evaluate('{{setvar::i::0}}{{incvar::i}}{{incvar::i}}{{decvar::i}}{{getvar::i}}', ctx()).text).toBe('1')
    expect(e.evaluate('X{{noop}}Y', ctx()).text).toBe('XY')
    const dice = Number(e.evaluate('{{dice::2d6}}', ctx()).text)
    expect(dice).toBeGreaterThanOrEqual(2)
    expect(dice).toBeLessThanOrEqual(12)
  })
  it('时间宏（datetime/weekday/isotime/isodate）输出本地化格式', () => {
    const e = new MacroEngine()
    expect(e.evaluate('{{isodate}}', ctx()).text).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(e.evaluate('{{isotime}}', ctx()).text).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(e.evaluate('{{weekday}}', ctx()).text).toMatch(/^星期[日一二三四五六]$/)
    expect(e.evaluate('{{datetime}}', ctx()).text).toContain(':')
  })
})
