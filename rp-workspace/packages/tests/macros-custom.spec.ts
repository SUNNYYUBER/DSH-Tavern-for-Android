/** L1b：自定义宏注册（ST MacroRegistry.registerMacro 对应物） */
import { describe, expect, it } from 'vitest'
import {
  expandTavernMacros, registerMacro, unregisterMacro, listCustomMacros, hydrateCustomMacros,
} from '../src/dsht-plugin-shared/macros.ts'

describe('custom macro registry（L1b hook 移植）', () => {
  it('字符串模板宏：注册后展开，注销后回到 unknown 保留', () => {
    registerMacro('greeting', '你好，{{user}}！')
    const r = expandTavernMacros('开场：{{greeting}}', { user: '阿漂', char: '秧秧' })
    expect(r.text).toBe('开场：你好，阿漂！') // 内层 {{user}} 由迭代展开接着求值
    unregisterMacro('greeting')
    const r2 = expandTavernMacros('{{greeting}}', { user: '阿漂', char: '秧秧' })
    expect(r2.text).toBe('{{greeting}}')
    expect(r2.unknownMacros).toHaveLength(1)
  })

  it('带参形态 {{name::args}}（字符串模板忽略参数直接输出模板）', () => {
    registerMacro('sig', '—— 来自塔台')
    const r = expandTavernMacros('{{sig::x}}', { user: 'u', char: 'c' })
    expect(r.text).toBe('—— 来自塔台')
    unregisterMacro('sig')
  })

  it('函数 handler 宏（同进程注册）：收 args 与 ctx', () => {
    registerMacro('upper', (args, ctx) => `${ctx.user}:${args.toUpperCase()}`)
    const r = expandTavernMacros('{{upper::hello}}', { user: '阿漂', char: 'c' })
    expect(r.text).toBe('阿漂:HELLO')
    unregisterMacro('upper')
  })

  it('内置名拒绝覆盖；非法名拒绝注册', () => {
    expect(() => registerMacro('user', 'x')).toThrow(/built-in/)
    expect(() => registerMacro('9bad', 'x')).toThrow(/invalid/)
    expect(() => registerMacro('has space', 'x')).toThrow(/invalid/)
  })

  it('listCustomMacros 只列字符串类；hydrate 合并且跳过非法/内置名', () => {
    registerMacro('fn1', () => 'f')
    registerMacro('str1', 's1')
    hydrateCustomMacros({ str2: 's2', user: '恶意覆盖', 'bad name': 'x' })
    const list = listCustomMacros()
    expect(list['str1']).toBe('s1')
    expect(list['str2']).toBe('s2')
    expect(list['fn1']).toBeUndefined() // 函数类不可序列化，不列出
    expect(list['user']).toBeUndefined() // 内置名被 hydrate 跳过
    expect(expandTavernMacros('{{user}}', { user: '真用户', char: 'c' }).text).toBe('真用户')
    unregisterMacro('fn1'); unregisterMacro('str1'); unregisterMacro('str2')
  })

  it('大小写不敏感（注册小写，{{MyMacro}} 也命中）', () => {
    registerMacro('MyMacro', '值')
    expect(expandTavernMacros('{{MYMACRO}}', { user: 'u', char: 'c' }).text).toBe('值')
    expect(expandTavernMacros('{{mymacro}}', { user: 'u', char: 'c' }).text).toBe('值')
    unregisterMacro('mymacro')
  })
})
