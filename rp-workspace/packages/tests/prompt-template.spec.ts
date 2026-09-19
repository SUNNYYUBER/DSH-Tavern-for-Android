import { describe, expect, it } from 'vitest'
import {
  isEjsProcessed, parseExpr, evalExpr, renderEjsSubset, renderMessages,
  protectPreBlocks, restorePreBlocks,
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

describe('T-29 子集引擎：不支持语法必须「显式抛错」而非静默失败', () => {
  it('函数调用 → 抛错（trailing tokens）', () => {
    expect(() => renderEjsSubset('<%= arr.join(",") %>', { arr: [1, 2] })).toThrow(/trailing tokens/)
  })
  it('箭头函数 → 抛错（unexpected char）', () => {
    expect(() => renderEjsSubset('<%= xs.map(x => x) %>', { xs: [1] })).toThrow(/unexpected char/)
  })
  it('模板字符串 → 抛错（unexpected char）', () => {
    expect(() => renderEjsSubset('<%= `v=${a}` %>', { a: 1 })).toThrow(/unexpected char/)
  })
  it('正则字面量 → 抛错（unexpected token）', () => {
    expect(() => renderEjsSubset('<%= /a/.test("a") %>', {})).toThrow(/unexpected token/)
  })
  it('renderMessages fail-soft：单条失败保留原文 + ejsError 标记，不静默清空', () => {
    const r = renderMessages('', {}, [
      { mes: '<%= /a/.test("a") %>' },
      { mes: '正常消息' },
    ])
    expect(r.messages[0].mes).toBe('<%= /a/.test("a") %>')
    expect(r.messages[0].ejsError).toBe(true)
    expect(r.rendered).toBe(1)
    expect(r.skipped).toBe(1)
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

// ---------------------------------------------------------------------------
// 【第二十三轮 W6 续 · P-34】<pre> 保护占位哨兵不得被正文撞车
// ---------------------------------------------------------------------------
describe('B7 <pre> 代码块保护：占位哨兵形态（P-34）', () => {
  it('✅ 正文里的旧 NUL 形态字面量必须原样保留（不得被消费）', () => {
    // 正控：模板里确有 <pre>（blocks 非空，越界分支可达）+ 正文含旧哨兵形态字面量
    const text = '<pre>AAA</pre>用户写的：\u0000EJS_PRE_0\u0000结束'
    const p = protectPreBlocks(text)
    const out = restorePreBlocks(p.text, p.blocks)
    expect(out, '旧 NUL 形态哨兵被当占位符消费 ⇒ 用户内容被替换成别的 <pre> 内容（篡改）').toBe(text)
  })

  it('✅ 越界下标必须原样保留（不得静默删内容）', () => {
    // 负控：blocks 非空（不走短路），下标越界 ⇒ 首版 `?? ''` 会把这段删掉
    const text = '<pre>BBB</pre>前\u0000EJS_PRE_99\u0000后'
    const p = protectPreBlocks(text)
    const out = restorePreBlocks(p.text, p.blocks)
    expect(out, '越界下标被替换成空串 ⇒ 用户内容静默消失').toContain('\u0000EJS_PRE_99\u0000')
    expect(out).toContain('前')
    expect(out).toContain('后')
  })

  it('✅ 负控·真实形态仍工作：真占位符必须被还原为原 <pre> 内容', () => {
    const text = '<pre>CCC</pre>中间<pre>DDD</pre>尾巴'
    const p = protectPreBlocks(text)
    expect(restorePreBlocks(p.text, p.blocks), '修法把功能改坏了（真占位符未还原）').toBe(text)
  })
})
