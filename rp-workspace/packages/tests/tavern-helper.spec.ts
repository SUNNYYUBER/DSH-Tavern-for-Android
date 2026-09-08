import { describe, expect, it } from 'vitest'
import { deleteByPath, getByPath, mergeScopes, setByPath } from '../src/dsht-plugin-tavern-helper/variables.ts'
import { runScript, triggerMatches, validateScript, type TavernScript } from '../src/dsht-plugin-tavern-helper/scripts.ts'
import { deepMerge, registerVariables } from '../src/dsht-plugin-mvu/index.ts'

describe('酒馆助手：变量路径读写', () => {
  it('setByPath 逐层建对象；getByPath 取值', () => {
    const t = setByPath({}, '/角色/云梦璃/好感度', 5)
    expect(getByPath(t, '/角色/云梦璃/好感度')).toBe(5)
    expect(getByPath(t, '/角色/不存在')).toBeUndefined()
  })

  it('deleteByPath 删除键；JSONPointer 转义', () => {
    const t = setByPath({ a: 1 }, '/a~1b', 2)
    expect(getByPath(t, '/a~1b')).toBe(2)
    expect(deleteByPath(t, '/a~1b')).toEqual({ a: 1 })
  })

  it('根路径 set 仅接受对象', () => {
    expect(setByPath({ a: 1 }, '', { b: 2 })).toEqual({ b: 2 })
    expect(setByPath({ a: 1 }, '', 42)).toEqual({ a: 1 })
  })
})

describe('酒馆助手：三级合并（chat > character > global）', () => {
  it('高优先级覆盖叶值；对象深合并', () => {
    const merged = mergeScopes(
      { theme: 'dark', ui: { lang: 'zh', font: 14 } },
      { ui: { font: 16 }, charVar: 'c' },
      { ui: { font: 18 }, chatVar: true },
    )
    expect(merged).toEqual({
      theme: 'dark',
      ui: { lang: 'zh', font: 18 },
      charVar: 'c',
      chatVar: true,
    })
  })
})

describe('酒馆助手：脚本沙箱', () => {
  it('validateScript 校验白名单', () => {
    expect(validateScript(null)).toMatch(/object/)
    expect(validateScript({ id: 'x' })).toMatch(/trigger/)
    expect(validateScript({ id: 'x', trigger: { type: 'on-turn' }, actions: [{ type: 'eval-js' }] })).toMatch(/unknown action\.type/)
    expect(validateScript({ id: 'x', trigger: { type: 'on-turn' }, actions: [{ type: 'set-variable', scope: 'chat', path: '/a', value: 1 }] })).toBeNull()
  })

  it('triggerMatches：变量变化 + equals 过滤 + disabled', () => {
    const s: TavernScript = { id: 's', trigger: { type: 'on-variable-change', variable: '/好感度', equals: 10 }, actions: [] }
    expect(triggerMatches(s, { type: 'on-variable-change', variable: '/好感度', newValue: 10 })).toBe(true)
    expect(triggerMatches(s, { type: 'on-variable-change', variable: '/好感度', newValue: 9 })).toBe(false)
    expect(triggerMatches(s, { type: 'on-turn' })).toBe(false)
    expect(triggerMatches({ ...s, enabled: false }, { type: 'on-variable-change', variable: '/好感度', newValue: 10 })).toBe(false)
  })

  it('runScript：set/delete-variable 分层落树；{{}} 插值取合并视图', () => {
    const s: TavernScript = {
      id: 's',
      trigger: { type: 'manual' },
      actions: [
        { type: 'set-variable', scope: 'chat', path: '/地点', value: '咖啡厅' },
        { type: 'set-variable', scope: 'chat', path: '/描述', value: '当前在{{地点}}，主题{{theme}}' },
        { type: 'delete-variable', scope: 'global', path: '/old' },
        { type: 'insert-note', text: '注释：{{地点}}', depth: 2 },
        { type: 'log', message: 'done' },
      ],
    }
    const r = runScript(s, { global: { theme: 'dark', old: 1 }, character: {}, chat: {} })
    expect(r.ok).toBe(true)
    expect(r.trees.chat).toEqual({ 地点: '咖啡厅', 描述: '当前在咖啡厅，主题dark' })
    expect(r.trees.global).toEqual({ theme: 'dark' })
    expect(r.notes).toEqual([{ text: '注释：咖啡厅', depth: 2 }])
    expect(r.logs).toEqual(['done'])
  })
})

describe('MVU 插件：变量注册（chat_metadata.variables 落点）', () => {
  it('registerVariables 深合并不动 presetId/state；replace 整组替换', () => {
    const file = { presetId: 'p1', state: { x: 1 }, variables: { a: 1, nested: { k1: 1 } } }
    const next = registerVariables(file, { b: 2, nested: { k2: 2 } }, { schema: 1 }, false)
    expect(next.presetId).toBe('p1')
    expect(next.state).toEqual({ x: 1 })
    expect(next.variables).toEqual({ a: 1, b: 2, nested: { k1: 1, k2: 2 } })
    expect(next.variableSchema).toEqual({ schema: 1 })
    const replaced = registerVariables(file, { c: 3 }, undefined, true)
    expect(replaced.variables).toEqual({ c: 3 })
  })

  it('deepMerge 数组直接替换', () => {
    expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] })
  })
})
