import { describe, expect, it } from 'vitest'
import { renderMessages } from '../src/dsht-plugin-prompt-template/ejs.ts'
import { asSandboxMessagesResult, renderMessagesSandbox } from '../src/dsht-plugin-prompt-template/sandbox.ts'

/**
 * 心跳 47 回归钉：两个 EJS 引擎的**成功返回形态**必须能被同一段消费代码处理。
 *
 * 事故原形（dsh-plugin/index.ts 的生成期管线）：
 *   `{ ok: true, messages: ejsRenderMessages(...) }`
 * subset 引擎的 `renderMessages` 返回的是 `{messages, rendered, skipped}` **对象**，
 * 被当成 `messages` 数组塞进去 → `r.messages[k]?.mes` 恒 undefined → 含 `<% %>` 的
 * 楼层正文被静默替换为空串，并随 decision.messages 落盘（"写得成功、无报错、内容全错"）。
 * 类型闸门以 TS7053 抓到了它；本文件把"两引擎形状一致"钉成可执行断言，防止回退。
 */
describe('EJS 双引擎返回形状一致性', () => {
  const msgs = [
    { mes: '你好 <% const a = 1 %><%= a + 1 %>', role: 'user' },
    { mes: '第二楼', role: 'assistant' },
  ]

  it('subset 引擎原始返回是「对象」而非数组（这正是当初写错的根因）', () => {
    const rr = renderMessages('', { user: 'U', char: 'C' }, msgs as never)
    expect(Array.isArray(rr)).toBe(false)
    expect(Array.isArray(rr.messages)).toBe(true)
    expect(rr.rendered).toBeTypeOf('number')
    expect(rr.skipped).toBeTypeOf('number')
  })

  it('归一后与 sandbox 引擎同形：ok + messages 是数组 + rendered/skipped 是数字', () => {
    const subset = asSandboxMessagesResult(renderMessages('', { user: 'U', char: 'C' }, msgs as never))
    const sandbox = renderMessagesSandbox('', { user: 'U', char: 'C' }, msgs as never)

    for (const r of [subset, sandbox]) {
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      expect(Array.isArray(r.messages)).toBe(true)
      expect(r.messages).toHaveLength(msgs.length)
      expect(r.rendered).toBeTypeOf('number')
      expect(r.skipped).toBeTypeOf('number')
    }
  })

  it('两个引擎对同一批消息给出相同的渲染文本（形状一致之外，语义也一致）', () => {
    const subset = renderMessages('', { user: 'U', char: 'C' }, msgs as never)
    const sandbox = renderMessagesSandbox('', { user: 'U', char: 'C' }, msgs as never)
    expect(subset.ok === undefined || subset.ok).toBeTruthy()
    if (!sandbox.ok) throw new Error('sandbox 渲染失败')
    expect(sandbox.messages.map(m => m.mes)).toEqual(subset.messages.map(m => m.mes))
  })

  it('消费代码 `r.messages[i]?.mes` 在两引擎上都能取到非空正文（事故的直接判据）', () => {
    const subset = asSandboxMessagesResult(renderMessages('', { user: 'U', char: 'C' }, msgs as never))
    const sandbox = renderMessagesSandbox('', { user: 'U', char: 'C' }, msgs as never)
    const decode = (r: { ok: true; messages: Array<{ mes?: string }> }): string[] =>
      r.messages.map((_m, i) => String(r.messages[i]?.mes ?? ''))
    expect(decode(subset as never)).toEqual(['你好 2', '第二楼'])
    expect(decode(sandbox as never)).toEqual(['你好 2', '第二楼'])
  })

  it('坏模板（未闭合）不会让 subset 引擎抛错丢弃整批——失败消息保留原文', () => {
    const dirty = [
      { mes: '正常', role: 'user' },
      { mes: '未闭合 {{ 与 <%', role: 'assistant' },
    ]
    const rr = asSandboxMessagesResult(renderMessages('', { user: 'U', char: 'C' }, dirty as never))
    expect(rr.messages).toHaveLength(2)
    expect(rr.messages[0].mes).toBe('正常')
  })
})
