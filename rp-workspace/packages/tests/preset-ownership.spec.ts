import { describe, it, expect } from 'vitest'
import { enabledPresetBindings } from '../src/dsht-plugin-shared/preset-ownership.ts'

/**
 * 【管线切换 2026-09-20】预设注入所有权判定（bychv 绑定启用 → 我方注入点跳过）。
 * 形态取自模拟器实证（emu-preset-verify 系列）读到的真实 state.json 结构：
 * `{ revision, presets: [...], bindings: { <sid>: { enabled, presetId, characterId, values, markers } } }`。
 */
describe('enabledPresetBindings（bychv state.json → 绑定启用集合）', () => {
  it('enabled===true 的会话进入集合；关闭/缺字段不进入', () => {
    const state = {
      revision: 7,
      presets: [{ id: 'p1', name: '预设' }],
      bindings: {
        'st-87rfra': { enabled: true, presetId: 'p1', characterId: null, values: {}, markers: {} },
        'st-abc123': { enabled: false, presetId: 'p1', characterId: null, values: {}, markers: {} },
        'st-noflag': { presetId: 'p1', characterId: null, values: {}, markers: {} },
      },
    }
    const s = enabledPresetBindings(state)
    expect(s.has('st-87rfra')).toBe(true)
    expect(s.has('st-abc123')).toBe(false)
    expect(s.has('st-noflag')).toBe(false)
    expect(s.size).toBe(1)
  })

  it('坏输入一律空集（= 不接管，我方管线照常）', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { bindings: null }, { bindings: [] }, { bindings: 'x' }]) {
      expect(enabledPresetBindings(bad).size).toBe(0)
    }
  })

  it('bindings 条目非对象/enabled 非布尔 true 不进入', () => {
    const s = enabledPresetBindings({
      bindings: {
        a: null,
        b: 'true',
        c: { enabled: 1 },      // 真值但非严格 true——bychv 写的是布尔，宽松真值不接管
        d: { enabled: true },
      },
    })
    expect([...s]).toEqual(['d'])
  })

  it('真实形态（模拟器验证①②留下的 state.json 摘要）', () => {
    // 模拟器实证结构（2026-09-20，st-87rfra 绑定启用、普通会话解绑后的残留）
    const state = {
      revision: 12,
      presets: [{ id: '7fb972f3-cb15-407a-8629-da6bb6b9d1b9', name: 'EMU 验证预设' }],
      selectedPresetId: '7fb972f3-cb15-407a-8629-da6bb6b9d1b9',
      defaultPresetId: '7fb972f3-cb15-407a-8629-da6bb6b9d1b9',
      bindings: {
        'session-babb019d-a71a-44a9-bdda-657aa2efe6bd': { enabled: false, presetId: '7fb972f3', characterId: null, values: {}, markers: {} },
        'st-87rfra': { enabled: true, presetId: '7fb972f3', characterId: null, values: { user: 'EMU验证用户' }, markers: {} },
      },
      sessions: { 'st-87rfra': { key: 'x', at: '2026-09-20', presetId: '7fb972f3', result: { local: { emuVar: 'hello' } } } },
      global: {},
    }
    const s = enabledPresetBindings(state)
    expect(s.has('st-87rfra')).toBe(true)
    expect(s.has('session-babb019d-a71a-44a9-bdda-657aa2efe6bd')).toBe(false)
  })
})
