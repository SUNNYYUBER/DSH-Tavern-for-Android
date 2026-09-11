import { describe, expect, it } from 'vitest'
import { createPromptInjectionStore } from '../src/dsht-plugin-prompt-template/injection-store.ts'
import { renderEjsSandbox, renderMessagesSandbox } from '../src/dsht-plugin-prompt-template/sandbox.ts'

describe('EJS 沙箱：完整 JS 能力（子集做不到的）', () => {
  it('方法调用 / 箭头函数 / map+join', () => {
    const r = renderEjsSandbox('<%= messages.map(m => m.role).join("/") %>', {
      messages: [{ role: 'user' }, { role: 'assistant' }],
    })
    expect(r).toEqual({ ok: true, text: 'user/assistant' })
  })

  it('forEach 代码块 + 局部 let 累加', () => {
    const tpl = '<% let total = 0; list.forEach((n, i) => { total += n; %>[<%= i %>]<%= n %>;<% }) %>sum=<%= total %>'
    const r = renderEjsSandbox(tpl, { list: [1, 2, 3] })
    expect(r).toEqual({ ok: true, text: '[0]1;[1]2;[2]3;sum=6' })
  })

  it('{{ }} 宏保留：raw 输出、对象 JSON 序列化、上下文变量可重赋值', () => {
    expect(renderEjsSandbox('你好，{{user}}！|{{obj}}', { user: '示例人设甲', obj: { a: 1 } }))
      .toEqual({ ok: true, text: '你好，示例人设甲！|{"a":1}' })
    expect(renderEjsSandbox('<% user = user + "!" %>{{user}}', { user: 'A' }))
      .toEqual({ ok: true, text: 'A!' })
  })

  it('<%= %> 转义；<%- %> raw', () => {
    expect(renderEjsSandbox('<%= x %>', { x: '<b>&"' })).toEqual({ ok: true, text: '&lt;b&gt;&amp;&quot;' })
    expect(renderEjsSandbox('<%- x %>', { x: '<b>&"' })).toEqual({ ok: true, text: '<b>&"' })
  })

  it('if/else 与三元、print 多值输出', () => {
    const tpl = '<% if (score >= 60) { print("pass:", score) } else { %>fail<% } %>'
    expect(renderEjsSandbox(tpl, { score: 70 })).toEqual({ ok: true, text: 'pass:70' })
    expect(renderEjsSandbox(tpl, { score: 10 })).toEqual({ ok: true, text: 'fail' })
  })
})

describe('T-29 沙箱引擎：完整 JS 语法实测（子集做不到的）', () => {
  it('模板字符串', () => {
    expect(renderEjsSandbox('<% const v = 1 %><%= `v=${v}` %>', {})).toEqual({ ok: true, text: 'v=1' })
  })

  it('正则字面量', () => {
    expect(renderEjsSandbox('<%= /a/.test("a") %>', {})).toEqual({ ok: true, text: 'true' })
  })

  it('模板内定义函数并调用', () => {
    expect(renderEjsSandbox('<% function f(x) { return x * 2 } %><%= f(6) %>', {}))
      .toEqual({ ok: true, text: '12' })
  })

  it('内建 Math 可用（仅 Math.random 被替换为抛错）', () => {
    expect(renderEjsSandbox('<%= Math.max(1, 2) %>', {})).toEqual({ ok: true, text: '2' })
  })

  it('边界：上下文经 vm 传入的函数不可克隆 → 显式 runtime-error', () => {
    expect(renderEjsSandbox('<%= cb(2) %>', { cb: (x: number) => x }))
      .toEqual({ ok: false, kind: 'runtime-error' })
  })
})

describe('EJS 沙箱：隔离与资源上限', () => {
  it('无 require/process/module/fetch，Date 置 undefined', () => {
    const r = renderEjsSandbox('<%= typeof process %>|<%= typeof require %>|<%= typeof module %>|<%= typeof fetch %>|<%= typeof Date %>', {})
    expect(r).toEqual({ ok: true, text: 'undefined|undefined|undefined|undefined|undefined' })
  })

  it('Math.random 抛错（确定性防护）→ runtime-error', () => {
    expect(renderEjsSandbox('<%= Math.random() %>', {})).toEqual({ ok: false, kind: 'runtime-error' })
  })

  it('while(true) 被 timeout 硬中断 → execution-limit', () => {
    expect(renderEjsSandbox('<% while (true) {} %>', {}, { timeoutMs: 50 }))
      .toEqual({ ok: false, kind: 'execution-limit' })
  })

  it('输出超过 256KB → output-limit', () => {
    const tpl = '<% for (let i = 0; i < 20000; i++) { %>aaaaaaaaaaaaaaaaaaaa<% } %>'
    expect(renderEjsSandbox(tpl, {}, { timeoutMs: 5000 })).toEqual({ ok: false, kind: 'output-limit' })
  })

  it('模板超过 256KB → source-limit', () => {
    expect(renderEjsSandbox('x'.repeat(300 * 1024), {})).toEqual({ ok: false, kind: 'source-limit' })
  })

  it('语法错误 / 未闭合标签 → syntax-error（不含模板源码）', () => {
    expect(renderEjsSandbox('<% if ( %>x', {})).toEqual({ ok: false, kind: 'syntax-error' })
    expect(renderEjsSandbox('<% const a = 1', {})).toEqual({ ok: false, kind: 'syntax-error' })
  })
})

describe('prompt 注入 store（宿主侧单测）', () => {
  it('inject/get/has 基本语义；同 key 按 order 升序、同 order 按注入先后拼接', () => {
    const s = createPromptInjectionStore()
    expect(s.has('k')).toBe(false)
    s.inject('k', 'b', 200)
    s.inject('k', 'a', 50)
    s.inject('k', 'c', 200)
    expect(s.has('k')).toBe(true)
    expect(s.get('k')).toBe('a\nb\nc')
  })

  it('uid 形态更新已有注入；无 uid 保持独立条目', () => {
    const s = createPromptInjectionStore()
    s.inject('k', 'v1', 100, 0, 'u1')
    s.inject('k', 'v2', 100, 0, 'u1')
    s.inject('k', 'v3')
    expect(s.get('k')).toBe('v2\nv3')
  })

  it('postprocess search/replace 顺序应用', () => {
    const s = createPromptInjectionStore()
    s.inject('k', 'foo bar')
    expect(s.get('k', [{ search: 'foo', replace: 'baz' }, { search: 'bar', replace: 'qux' }])).toBe('baz qux')
  })

  it('有界：空 key / 超长 key 忽略；总数上限 512', () => {
    const s = createPromptInjectionStore()
    s.inject('', 'x')
    s.inject('k'.repeat(300), 'x')
    expect(s.has('')).toBe(false)
    for (let i = 0; i < 600; i++) s.inject('bulk', `p${i}`, 100, 0, `u${i}`)
    expect(s.get('bulk').split('\n')).toHaveLength(512)
  })
})

describe('EJS 沙箱：injectPrompt / getPromptsInjected 桥接', () => {
  it('同一次渲染内注入并读取', () => {
    const tpl = '<% injectPrompt("wi", "注入内容", 10) %>[<%= getPromptsInjected("wi") %>]|<%= hasPromptsInjected("wi") %>'
    expect(renderEjsSandbox(tpl, {})).toEqual({ ok: true, text: '[注入内容]|true' })
  })

  it('沙箱内 postprocess 数组经 JSON 桥回宿主（realm 安全）', () => {
    const tpl = '<% injectPrompt("k", "foo") %><%= getPromptsInjected("k", [{ search: "foo", replace: "bar" }]) %>'
    expect(renderEjsSandbox(tpl, {})).toEqual({ ok: true, text: 'bar' })
  })

  it('per-render 隔离：两次独立渲染不共享 store', () => {
    expect(renderEjsSandbox('<% injectPrompt("k", "X") %>ok', {})).toEqual({ ok: true, text: 'ok' })
    expect(renderEjsSandbox('[<%= getPromptsInjected("k") %>]', {})).toEqual({ ok: true, text: '[]' })
  })

  it('renderMessagesSandbox：整批共享 store（一次生成 pass），is_ejs_processed 跳过', () => {
    const r = renderMessagesSandbox('', {}, [
      { mes: '<% injectPrompt("k", "X") %>done1' },
      { mes: '<%= getPromptsInjected("k") %>|done2' },
      { mes: '旧消息', is_ejs_processed: true },
    ])
    if (!r.ok) throw new Error(`unexpected failure: ${r.kind}`)
    expect(r.rendered).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.messages[0].mes).toBe('done1')
    expect(r.messages[1].mes).toBe('X|done2')
    expect(r.messages[1].is_ejs_processed).toBe(true)
    expect(r.messages[2].mes).toBe('旧消息')
  })

  it('renderMessagesSandbox：任一消息失败即整体失败', () => {
    const r = renderMessagesSandbox('', {}, [{ mes: '<% while(true){} %>' }], { timeoutMs: 50 })
    expect(r).toEqual({ ok: false, kind: 'execution-limit' })
  })
})
