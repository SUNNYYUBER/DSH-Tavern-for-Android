import { describe, it, expect } from 'vitest'
import {
  runRegexScripts, importRegexScripts, sanitizeRegexMacro, PLACEMENT,
  type RegexScript,
} from '../src/regex/engine.ts'

/** ST 真实形态样本（用户实测数据的字段结构） */
const stSample = {
  id: '7da715ac-041e-4e20-8d13-c7effea7db5d',
  scriptName: '[可待]-附加功能保留',
  findRegex: '^(?:[\\s\\S]*?(<scene>[\\s\\S]*?<\\/scene>))?([\\s\\S]*)$',
  replaceString: '$1$2',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: false,
  promptOnly: true,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: 10,
  maxDepth: null,
}

function base(over: Partial<RegexScript> = {}): RegexScript {
  return {
    id: 't1', scriptName: 'test', findRegex: 'foo', replaceString: 'bar',
    trimStrings: [], placement: [PLACEMENT.AI_OUTPUT], disabled: false,
    markdownOnly: false, promptOnly: false, runOnEdit: false,
    substituteRegex: 0, minDepth: null, maxDepth: null, ...over,
  }
}

describe('importRegexScripts（ST JSON 映射）', () => {
  it('真实 ST 形态字段全量导入', () => {
    const { scripts, warnings } = importRegexScripts([stSample])
    expect(scripts).toHaveLength(1)
    expect(scripts[0].promptOnly).toBe(true)
    expect(scripts[0].placement).toEqual([2])
    expect(scripts[0].minDepth).toBe(10)
    expect(warnings).toEqual([])
  })
  it('缺 findRegex 跳过并警告', () => {
    const { scripts, warnings } = importRegexScripts([{ scriptName: '坏数据' }])
    expect(scripts).toHaveLength(0)
    expect(warnings[0]).toContain('缺少 findRegex')
  })
})

describe('三时机过滤', () => {
  const text = 'foo 中间内容 foo'
  it('promptOnly：仅 prompt 时机执行', () => {
    const s = base({ promptOnly: true })
    expect(runRegexScripts([s], text, 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('bar 中间内容 bar')
    expect(runRegexScripts([s], text, 'display', PLACEMENT.AI_OUTPUT).text).toBe(text)
  })
  it('markdownOnly：仅 display 时机执行', () => {
    const s = base({ markdownOnly: true })
    expect(runRegexScripts([s], text, 'display', PLACEMENT.AI_OUTPUT).text).toBe('bar 中间内容 bar')
    expect(runRegexScripts([s], text, 'prompt', PLACEMENT.AI_OUTPUT).text).toBe(text)
  })
  it('两者皆否：permanent 时机（编辑保存场景）', () => {
    const s = base({})
    expect(runRegexScripts([s], text, 'permanent', PLACEMENT.AI_OUTPUT).text).toBe('bar 中间内容 bar')
    // 【2026-09-10 TT 对照修正】通用脚本在 prompt/display 时机**也**执行。
    // 依据 TT extensions/regex/engine.js:354-357 的 isScopeMatch 第三分支：
    // `!markdownOnly && !promptOnly && !isMarkdown && !isPrompt` —— 该分支只在
    // display/prompt **都未置位**时成立，但 promptOnly/markdownOnly 脚本各自还有
    // 独立分支；即「通用脚本」在三个时机都被纳入（prompt 只排除 markdownOnly）。
    expect(runRegexScripts([s], text, 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('bar 中间内容 bar')
    expect(runRegexScripts([s], text, 'display', PLACEMENT.AI_OUTPUT).text).toBe('bar 中间内容 bar')
  })
  it('disabled 永不执行', () => {
    const s = base({ disabled: true })
    expect(runRegexScripts([s], text, 'prompt', PLACEMENT.AI_OUTPUT).text).toBe(text)
  })
})

describe('placement 与 depth 过滤', () => {
  it('placement 不匹配则跳过', () => {
    const s = base({ promptOnly: true, placement: [PLACEMENT.USER_INPUT] })
    expect(runRegexScripts([s], 'foo', 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('foo')
  })
  it('depth 过滤（minDepth=10 → 深度 5 不命中）', () => {
    const s = base({ promptOnly: true, minDepth: 10 })
    expect(runRegexScripts([s], 'foo', 'prompt', PLACEMENT.AI_OUTPUT, { depth: 5 }).text).toBe('foo')
    expect(runRegexScripts([s], 'foo', 'prompt', PLACEMENT.AI_OUTPUT, { depth: 15 }).text).toBe('bar')
  })
})

describe('替换语义', () => {
  it('{{match}} 引用与 trimStrings', () => {
    const s = base({ promptOnly: true, findRegex: '(foo)', replaceString: '[{{match}}]', trimStrings: ['[', ']'] })
    const r = runRegexScripts([s], 'a foo b', 'prompt', PLACEMENT.AI_OUTPUT)
    expect(r.text).toBe('a foo b') // trim 掉括号后等于原值
  })
  it('无效正则跳过并记录 count=-1', () => {
    const s = base({ promptOnly: true, findRegex: '([unclosed' })
    const r = runRegexScripts([s], 'text', 'prompt', PLACEMENT.AI_OUTPUT)
    expect(r.text).toBe('text')
    expect(r.hits[0].count).toBe(-1)
  })
  it('命中计数进 hits（trace 消费）', () => {
    const s = base({ promptOnly: true })
    const r = runRegexScripts([s], 'foo x foo', 'prompt', PLACEMENT.AI_OUTPUT)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].count).toBe(2)
  })
  // 【T-17 2026-09-11】捕获组引用：函数式回调形态下 JS 不解释 $N，必须手动展开。
  it('$1/$2 数字捕获组展开（wuwa 预设真实形态）', () => {
    const s = base({
      promptOnly: true,
      findRegex: '^(.*)$',
      replaceString: '<interactive_input>\n$1\n</interactive_input>',
      placement: [PLACEMENT.USER_INPUT],
    })
    const r = runRegexScripts([s], '玩家输入', 'prompt', PLACEMENT.USER_INPUT)
    expect(r.text).toBe('<interactive_input>\n玩家输入\n</interactive_input>')
    expect(r.text).not.toContain('$1')
  })
  it('$<name> 具名捕获组展开；未命中组给空串', () => {
    const s = base({
      promptOnly: true,
      findRegex: '(?<who>\\w+)-(?<what>[a-z]+)(?<miss>\\d+)?',
      replaceString: '[$<who>|$<what>|$<miss>]',
    })
    expect(runRegexScripts([s], 'a-b', 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('[a|b|]')
    expect(runRegexScripts([s], 'x-y9', 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('[x|y|9]')
  })
  it('无捕获组时 $1 = 整个 match（ST/TT 行为，不是字面残留）', () => {
    const s = base({ promptOnly: true, findRegex: 'foo', replaceString: '<b>$1</b>' })
    expect(runRegexScripts([s], 'a foo b', 'prompt', PLACEMENT.AI_OUTPUT).text).toBe('a <b>foo</b> b')
  })
})

// ---------------------------------------------------------------------------
// T-16 substituteRegex 枚举（基准 substitute_find_regex {NONE:0, RAW:1, ESCAPED:2}）
// 此前枚举是**反的**（1=转义 / 2=不转义），且回调从未被任何调用方注入 = 死代码。
// ---------------------------------------------------------------------------

describe('T-16 substituteRegex 枚举与 ESCAPED 转义', () => {
  /** 记录回调收到的 escaped 标志（断言枚举方向） */
  const spy = () => {
    const calls: Array<{ raw: string; escaped: boolean }> = []
    return {
      calls,
      cb: (raw: string, escaped: boolean): string => {
        calls.push({ raw, escaped })
        return raw.replace('{{char}}', '丰川祥子')
      },
    }
  }

  it('0=NONE 不触发回调（原样进正则）', () => {
    const s = spy()
    runRegexScripts([base({ findRegex: '{{char}}', substituteRegex: 0 })], '{{char}}', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: s.cb })
    expect(s.calls).toEqual([])
  })
  it('1=RAW 触发回调且 escaped=false', () => {
    const s = spy()
    const r = runRegexScripts([base({ findRegex: '{{char}}', replaceString: 'X', substituteRegex: 1 })], '丰川祥子', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: s.cb })
    expect(s.calls).toEqual([{ raw: '{{char}}', escaped: false }])
    expect(r.text).toBe('X')
  })
  it('2=ESCAPED 触发回调且 escaped=true（方向与 1 相反，此前写反）', () => {
    const s = spy()
    runRegexScripts([base({ findRegex: '{{char}}', substituteRegex: 2 })], '{{char}}', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: s.cb })
    expect(s.calls).toEqual([{ raw: '{{char}}', escaped: true }])
  })

  it('sanitizeRegexMacro 转义元字符与控制字符（基准 sanitizeRegexMacro）', () => {
    expect(sanitizeRegexMacro('a.b*c')).toBe('a\\.b\\*c')
    expect(sanitizeRegexMacro('(x)[y]{z}')).toBe('\\(x\\)\\[y\\]\\{z\\}')
    expect(sanitizeRegexMacro('a\nb\tc')).toBe('a\\nb\\tc')
    expect(sanitizeRegexMacro('a\\b/c')).toBe('a\\\\b\\/c')
    // 中文/字母数字不转义
    expect(sanitizeRegexMacro('丰川祥子abc123')).toBe('丰川祥子abc123')
    // 非字符串给空串（基准对非字符串返回原值，我们按 string 出口收窄）
    expect(sanitizeRegexMacro(undefined)).toBe('')
    expect(sanitizeRegexMacro(42)).toBe('')
  })

  it('ESCAPED 的实际意义：宏值里的元字符不得变成正则语法', () => {
    // 变量值含 `.`：不转义时 `a.c` 会命中 "abc"；转义后只命中字面 "a.c"
    const mk = (escaped: boolean) => base({
      findRegex: '{{v}}', replaceString: 'HIT', substituteRegex: escaped ? 2 : 1,
    })
    const cb = (raw: string, escaped: boolean): string => {
      const value = 'a.c'
      return escaped ? sanitizeRegexMacro(value) : value
    }
    expect(runRegexScripts([mk(false)], 'abc', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: cb }).text).toBe('HIT')
    expect(runRegexScripts([mk(true)], 'abc', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: cb }).text).toBe('abc')
    expect(runRegexScripts([mk(true)], 'a.c', 'prompt', PLACEMENT.AI_OUTPUT, { depth: null, substituteRegex: cb }).text).toBe('HIT')
  })
})
