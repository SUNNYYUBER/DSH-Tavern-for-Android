import { describe, it, expect } from 'vitest'
import {
  runRegexScripts, importRegexScripts, PLACEMENT,
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
    expect(runRegexScripts([s], text, 'prompt', PLACEMENT.AI_OUTPUT).text).toBe(text)
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
})
