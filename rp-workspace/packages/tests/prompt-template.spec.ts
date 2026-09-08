import { describe, expect, it } from 'vitest'
import {
  isEjsProcessed, parseExpr, evalExpr, renderEjsSubset, renderMessages,
} from '../src/dsht-plugin-prompt-template/ejs.ts'

describe('EJS 子集：插值', () => {
  it('{{ }} 宏插值（raw）', () => {
    expect(renderEjsSubset('你好，{{user}}！', { user: '示例人设甲' })).toBe('你好，示例人设甲！')
  })

  it('<%= %> HTML 转义；<%- %> raw', () => {
    expect(renderEjsSubset('<%= x %>', { x: '<b>&</b>' })).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(renderEjsSubset('<%- x %>', { x: '<b>&</b>' })).toBe('<b>&</b>')
  })

  it('点路径 / 下标 / .length；缺失路径输出空串', () => {
    expect(renderEjsSubset('{{a.b.c}}|{{list[1]}}|{{list.length}}', { a: { b: { c: 7 } }, list: ['x', 'y'] })).toBe('7|y|2')
    expect(renderEjsSubset('[{{missing.deep}}]', {})).toBe('[]')
  })

  it('对象值 JSON 序列化', () => {
    expect(renderEjsSubset('{{obj}}', { obj: { a: 1 } })).toBe('{"a":1}')
  })
})

describe('EJS 子集：if / else if / else', () => {
  const tpl = '<% if (score >= 90) { %>优<% } else if (score >= 60) { %>良<% } else { %>差<% } %>'
  it('三分支', () => {
    expect(renderEjsSubset(tpl, { score: 95 })).toBe('优')
    expect(renderEjsSubset(tpl, { score: 70 })).toBe('良')
    expect(renderEjsSubset(tpl, { score: 10 })).toBe('差')
  })

  it('逻辑与比较运算、一元 !', () => {
    const t = '<% if (a && !b) { %>Y<% } else { %>N<% } %>'
    expect(renderEjsSubset(t, { a: true, b: false })).toBe('Y')
    expect(renderEjsSubset(t, { a: true, b: true })).toBe('N')
  })

  it('未闭合块报错', () => {
    expect(() => renderEjsSubset('<% if (a) { %>x', { a: 1 })).toThrow(/\[dsht-ejs\]/)
    expect(() => renderEjsSubset('<% } %>', {})).toThrow(/without matching/)
  })
})

describe('EJS 子集：for / 赋值 / 表达式', () => {
  it('for-of 遍历 + 索引变量', () => {
    const tpl = '<% for (const m, i of messages) { %>[{{i}}]{{m.role}}: {{m.mes}}\n<% } %>'
    const out = renderEjsSubset(tpl, { messages: [{ role: 'user', mes: 'hi' }, { role: 'assistant', mes: 'yo' }] })
    expect(out).toBe('[0]user: hi\n[1]assistant: yo\n')
  })

  it('const 赋值 + 三元 + 算术', () => {
    const tpl = '<% const lv = score >= 60 ? "pass" : "fail" %><%= lv %>:<%= score * 2 + 1 %>'
    expect(renderEjsSubset(tpl, { score: 70 })).toBe('pass:141')
  })

  it('非数组 for 迭代 = 空（不崩）', () => {
    expect(renderEjsSubset('<% for (const x of nope) { %>x<% } %>ok', {})).toBe('ok')
  })

  it('不支持的语句抛渲染错误', () => {
    expect(() => renderEjsSubset('<% arr.forEach(function(x){) %>', {})).toThrow(/\[dsht-ejs\]/)
  })
})

describe('EJS 子集：表达式求值边界', () => {
  const ev = (src: string, ctx: Record<string, unknown> = {}) => evalExpr(parseExpr(src), [ctx])
  it('== 宽松 / === 严格', () => {
    expect(ev('1 == "1"')).toBe(true)
    expect(ev('1 === "1"')).toBe(false)
    expect(ev('a !== 2', { a: 1 })).toBe(true)
  })
  it('字符串拼接 +', () => {
    expect(ev('a + "!"', { a: 'hi' })).toBe('hi!')
    expect(ev('1 + 2')).toBe(3)
  })
  it('短路 && / ||', () => {
    expect(ev('missing.deep || "fb"', {})).toBe('fb')
  })
})

describe('is_ejs_processed 标记', () => {
  it('布尔 true 与 [true] 两种形态都识别；extra 嵌套也识别', () => {
    expect(isEjsProcessed({ is_ejs_processed: true })).toBe(true)
    expect(isEjsProcessed({ is_ejs_processed: [true] })).toBe(true)
    expect(isEjsProcessed({ extra: { is_ejs_processed: [true] } })).toBe(true)
    expect(isEjsProcessed({})).toBe(false)
    expect(isEjsProcessed({ is_ejs_processed: false })).toBe(false)
  })

  it('renderMessages：已处理跳过，未处理渲染并打标', () => {
    const r = renderMessages('{{message.mes}}!', {}, [
      { mes: '旧消息', is_ejs_processed: [true] },
      { mes: '新消息' },
    ])
    expect(r.skipped).toBe(1)
    expect(r.rendered).toBe(1)
    expect(r.messages[0].mes).toBe('旧消息')
    expect(r.messages[1].mes).toBe('新消息!')
    expect(r.messages[1].is_ejs_processed).toBe(true)
  })
})
