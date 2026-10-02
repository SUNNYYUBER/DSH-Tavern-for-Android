import { describe, it, expect } from 'vitest'
import {
  buildDeltaProtocolSection, splitSummaryAndDelta, deltaFallbackNote,
  SUMMARY_TEXT_MAX,
} from '../src/dsht-plugin-memory/summarize-delta.ts'

describe('memory-forest M2：splitSummaryAndDelta（delta 协议解析）', () => {
  it('正控：markdown 正文 + 合法 json delta → 双产出拆分', () => {
    const raw = [
      '## 时间地点', '第3日黄昏，青云山听雨阁。', '',
      '```json',
      '{"timeTag":"第3日黄昏","items":[{"name":"青锋剑","owner":"林昭"}],"npcs":[]}',
      '```',
    ].join('\n')
    const { text, delta, deltaOk } = splitSummaryAndDelta(raw)
    expect(deltaOk).toBe(true)
    expect(text).toContain('听雨阁')
    expect(text).not.toContain('```')
    expect(delta.timeTag).toBe('第3日黄昏')
    expect(delta.items?.[0]?.name).toBe('青锋剑')
  })

  it('正控：无 delta 块的纯正文 → fail-open（text 落盘 + deltaOk=false）', () => {
    const { text, delta, deltaOk } = splitSummaryAndDelta('只有一段正文，没有 json 块。')
    expect(deltaOk).toBe(false)
    expect(text).toContain('只有一段正文')
    expect(delta).toEqual({})
  })

  it('负控：坏 JSON → fail-open 不抛错（deltaOk=false，正文保留）', () => {
    const raw = '正文前段\n```json\n{"broken": tru\n```'
    const { text, delta, deltaOk } = splitSummaryAndDelta(raw)
    expect(deltaOk).toBe(false)
    expect(text).toContain('正文前段')
  })

  it('负控：delta 是数组/字符串/空（非 object）→ 拒收为空 delta', () => {
    for (const bad of ['```json\n[1,2]\n```', '```json\n"str"\n```', '```json\nnull\n```']) {
      const r = splitSummaryAndDelta('正文\n' + bad)
      expect(r.deltaOk).toBe(false)
      expect(r.delta).toEqual({})
    }
  })

  it('负控：delta 块未闭合（缺尾 ```）→ 拒收（不吞掉尾部正文）', () => {
    const raw = '正文\n```json\n{"timeTag":"x"}'
    const { text, delta, deltaOk } = splitSummaryAndDelta(raw)
    expect(deltaOk).toBe(false)
    expect(delta).toEqual({})
  })

  it('协议提示词自证：包含关键 schema 词与围栏标签（P-46 词表自证）', () => {
    const sec = buildDeltaProtocolSection()
    for (const w of ['timeTag', 'items', 'npcs', 'scenes', 'plans', 'protagonist', '```json']) {
      expect(sec).toContain(w)
    }
    expect(SUMMARY_TEXT_MAX).toBeGreaterThan(0)
  })

  it('降级出声：deltaFallbackNote 包含 sid 与楼层（禁静默失败）', () => {
    const note = deltaFallbackNote('sess-abc', 42)
    expect(note).toContain('sess-abc')
    expect(note).toContain('42')
  })
})
