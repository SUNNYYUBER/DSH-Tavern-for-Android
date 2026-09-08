/**
 * DSHTavern 前端渲染批次（真机卡渲染修复 1-5、8）：
 * 1. 通用未知标签兜底（tip 折叠 / 自闭合隐藏 / 已知标签不变）
 * 2. draft 草稿折叠
 * 3. 剧情选项按钮拆分 + font 颜色剥壳
 * 4. StatusPlaceHolderImpl 状态栏占位符段落
 * 5. display 正则 HTML 产出的白名单 sanitize
 * 8. 验收面板三插件自检（mock fetch 验证宏展开/状态栏实测链路）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROTO_DEFAULT, applyOutputProtocol, applyOutputProtocolSegments, containsPairedHtml,
  sanitizeDisplayHtml, splitActionOptions, withDefaults,
} from '../src/dsht-rp-ui/src/client/output-protocol.ts'
import { runRegexScripts, type RegexScript } from '../src/regex/engine.ts'
import { PROBES } from '../src/dsht-rp-ui/src/client/probes.ts'

// ---------------------------------------------------------------------------
// 修复 1：通用未知标签兜底
// ---------------------------------------------------------------------------

describe('未知标签兜底（tip 等裸文本根因）', () => {
  it('未知成对标签块 → 带标签名的折叠块，正文无裸标签', () => {
    const segs = applyOutputProtocolSegments('正文。<tip>提示内容</tip>尾。', PROTO_DEFAULT)
    const cl = segs.find(s => s.kind === 'collapsible') as { title: string; content: string } | undefined
    expect(cl).toBeDefined()
    expect(cl!.title).toBe('<tip>')
    expect(cl!.content).toBe('提示内容')
    const text = segs.filter(s => s.kind === 'text').map(s => (s as { content: string }).content).join('')
    expect(text).toContain('正文。')
    expect(text).toContain('尾。')
    expect(text).not.toContain('tip')
  })

  it('多种自定义标签（tip/note/selection_hint）都进折叠块；think 进思考行（2026-09-06 思考族→reasoningTags）', () => {
    for (const tag of ['tip', 'note', 'selection_hint']) {
      const segs = applyOutputProtocolSegments(`前<${tag}>内容</${tag}>后`, PROTO_DEFAULT)
      const cl = segs.find(s => s.kind === 'collapsible') as { title: string } | undefined
      expect(cl?.title).toBe(`<${tag}>`)
    }
    // think 族现在是 reasoningTags（ST 基准：思考胶囊折叠行，不再 <think> 标题折叠块）
    const thinkSegs = applyOutputProtocolSegments('前<think>思考</think>后', PROTO_DEFAULT)
    expect(thinkSegs.some(s => s.kind === 'reasoning' && (s as { content: string }).content === '思考')).toBe(true)
  })

  it('未知自闭合标签（<xxx/>）直接隐藏', () => {
    const segs = applyOutputProtocolSegments('前<tip/>后', PROTO_DEFAULT)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ kind: 'text', content: '前后' })
  })

  it('已知标签行为不变：details/action/status 仍按原类提取', () => {
    const segs = applyOutputProtocolSegments(
      '<details><summary>总结</summary>内容</details><a>选项</a><status>好感+1</status>', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'collapsible' && (s as { title: string }).title === '总结')).toBe(true)
    expect(segs.some(s => s.kind === 'action')).toBe(true)
    expect(segs.some(s => s.kind === 'status')).toBe(true)
    // 已知标签不产生 <tag名> 形态的兜底折叠块
    expect(segs.filter(s => s.kind === 'collapsible')).toHaveLength(1)
  })

  it('HTML 白名单标签不折叠（留给渲染层 sanitize 后按 HTML 渲染）', () => {
    const segs = applyOutputProtocolSegments('前<div class="x">内容</div>后', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'collapsible')).toBe(false)
    const text = segs.map(s => (s as { content: string }).content).join('')
    expect(text).toContain('<div class="x">内容</div>')
  })

  it('危险标签不折叠（留在文本里由渲染层按纯文本 + warn）', () => {
    const segs = applyOutputProtocolSegments('前<script>alert(1)</script>后', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'collapsible')).toBe(false)
  })

  it('流式悬空未知开标签先行剥离（闭合前不闪原始标签）', () => {
    const segs = applyOutputProtocolSegments('正文<tip>半截提示', PROTO_DEFAULT, true)
    expect(JSON.stringify(segs)).not.toContain('<tip>')
    const text = segs.map(s => (s as { content?: string }).content ?? '').join('')
    expect(text).toContain('半截提示')
  })

  it('未知块嵌套已知块：内层先提取，外层折叠内容还原为纯文本', () => {
    const segs = applyOutputProtocolSegments('<tip>看看<status>好感+1</status>这个</tip>', PROTO_DEFAULT)
    const cl = segs.find(s => s.kind === 'collapsible') as { title: string; content: string } | undefined
    expect(cl?.title).toBe('<tip>')
    expect(cl?.content).toContain('好感+1')
    expect(cl?.content).not.toContain('\x00')
  })
})

// ---------------------------------------------------------------------------
// 修复 2：draft 草稿折叠
// ---------------------------------------------------------------------------

describe('draft 草稿折叠', () => {
  it('draft 进 collapsibleTags 默认值；块折叠为「草稿」', () => {
    expect(PROTO_DEFAULT.collapsibleTags).toContain('draft')
    const segs = applyOutputProtocolSegments('正文<draft>自检：前文一致</draft>', PROTO_DEFAULT)
    const cl = segs.find(s => s.kind === 'collapsible') as { title: string; content: string } | undefined
    expect(cl?.title).toBe('草稿')
    expect(cl?.content).toBe('自检：前文一致')
    expect(applyOutputProtocol('正文<draft>自检</draft>', PROTO_DEFAULT).display).toBe('正文')
  })

  it('存量显式 collapsibleTags 配置的工作区也识别 draft（withDefaults 并集）', () => {
    const proto = withDefaults({ collapsibleTags: ['details'] })
    expect(proto.collapsibleTags).toEqual(['details', 'draft'])
    const segs = applyOutputProtocolSegments('<draft>草稿</draft>', proto)
    expect(segs.some(s => s.kind === 'collapsible')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 修复 3：剧情选项按钮拆分 + font 颜色剥壳
// ---------------------------------------------------------------------------

describe('剧情选项拆分 + 颜色', () => {
  it('同块多行【…】开头 → 每行一个独立按钮', () => {
    const opts = splitActionOptions('【抱住她】\n【转身离开】\n【沉默对视】\n【转移话题】')
    expect(opts.map(o => o.label)).toEqual(['【抱住她】', '【转身离开】', '【沉默对视】', '【转移话题】'])
  })

  it('（颜文字）开头的行同样拆分；非标记续行并入上一组', () => {
    const opts = splitActionOptions('(´･ω･`) 卖萌\n补充说明\n【正经回答】')
    expect(opts).toHaveLength(2)
    expect(opts[0].label).toBe('(´･ω･`) 卖萌\n补充说明')
    expect(opts[1].label).toBe('【正经回答】')
  })

  it('段落层集成：一个 <a> 块拆出多个 action 段落', () => {
    const segs = applyOutputProtocolSegments('正文<a>【选项A】\n【选项B】</a>', PROTO_DEFAULT)
    const actions = segs.filter(s => s.kind === 'action') as Array<{ text: string }>
    expect(actions.map(a => a.text)).toEqual(['【选项A】', '【选项B】'])
    expect(applyOutputProtocol('正文<a>【选项A】\n【选项B】</a>', PROTO_DEFAULT).actions)
      .toEqual(['【选项A】', '【选项B】'])
  })

  it('<font color="#hex"> 剥壳：颜色进 color 字段，标签不裸露', () => {
    const opts = splitActionOptions('<font color="#ff6666">【红色的选项】</font>')
    expect(opts).toEqual([{ label: '【红色的选项】', color: '#ff6666' }])
  })

  it('段落层集成：action 段落带 color', () => {
    const segs = applyOutputProtocolSegments('<a><font color="#a1b2c3">【彩色】</font></a>', PROTO_DEFAULT)
    const a = segs.find(s => s.kind === 'action') as { text: string; color?: string }
    expect(a.text).toBe('【彩色】')
    expect(a.color).toBe('#a1b2c3')
  })

  it('单行无标记选项保持单按钮（行为不变）', () => {
    expect(splitActionOptions('问她刚才在想什么')).toEqual([{ label: '问她刚才在想什么' }])
    expect(applyOutputProtocol('<a>问她刚才在想什么</a>', PROTO_DEFAULT).actions).toEqual(['问她刚才在想什么'])
  })
})

// ---------------------------------------------------------------------------
// 修复 4：StatusPlaceHolderImpl 状态栏占位符
// ---------------------------------------------------------------------------

describe('StatusPlaceHolderImpl 占位符', () => {
  it('自闭合形态 → statusbar-placeholder 段落，文本无残留', () => {
    const segs = applyOutputProtocolSegments('前文<StatusPlaceHolderImpl/>后文', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'statusbar-placeholder')).toBe(true)
    const text = segs.filter(s => s.kind === 'text').map(s => (s as { content: string }).content).join('')
    expect(text).not.toContain('StatusPlaceHolderImpl')
    expect(text).toContain('前文')
    expect(text).toContain('后文')
  })

  it('成对形态同样识别', () => {
    const segs = applyOutputProtocolSegments('<StatusPlaceHolderImpl></StatusPlaceHolderImpl>', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'statusbar-placeholder')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 修复 5：display 正则 HTML 产出的白名单 sanitize
// ---------------------------------------------------------------------------

function makeDisplayScript(replaceString: string, placement = [1]): RegexScript {
  return {
    id: 't1', scriptName: '测试', findRegex: '/正文/', replaceString,
    trimStrings: [], placement, disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
  }
}

describe('display 正则 HTML 产出渲染', () => {
  it('白名单标签（div+class）按 HTML 渲染：class 保留', () => {
    const r = runRegexScripts([makeDisplayScript('<div class="剧情框">正文</div>')], '正文', 'display', 1, { depth: null })
    expect(containsPairedHtml(r.text)).toBe(true)
    const clean = sanitizeDisplayHtml(r.text)
    expect(clean).toBe('<div class="剧情框">正文</div>')
  })

  it('style 外观属性保留；font color 属性保留', () => {
    expect(sanitizeDisplayHtml('<span style="color: #fff; font-weight: bold">x</span>'))
      .toBe('<span style="color: #fff; font-weight: bold">x</span>')
    expect(sanitizeDisplayHtml('<font color="#aabbcc">x</font>')).toBe('<font color="#aabbcc">x</font>')
  })

  it('白名单外标签（script/iframe）→ null（调用方按纯文本 + warn）', () => {
    expect(sanitizeDisplayHtml('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeDisplayHtml('<iframe src="https://x"></iframe>')).toBeNull()
    expect(sanitizeDisplayHtml('<div><script>x</script></div>')).toBeNull()
  })

  it('布局属性（position:fixed 悬浮球类）→ null 整体回退', () => {
    expect(sanitizeDisplayHtml('<div style="position: fixed; top: 0">悬浮球</div>')).toBeNull()
  })

  it('事件处理器等属性丢弃；url() 声明丢弃', () => {
    const clean = sanitizeDisplayHtml('<span onclick="hack()" style="color: red; background: url(x)">x</span>')
    expect(clean).not.toBeNull()
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('url(')
    expect(clean).toContain('color: red')
  })

  it('containsPairedHtml：成对白名单标签才进 HTML 分支', () => {
    expect(containsPairedHtml('普通正文')).toBe(false)
    expect(containsPairedHtml('a < b 比较')).toBe(false)
    expect(containsPairedHtml('<b>粗</b>')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 修复 8：验收面板三插件自检（mock fetch）
// ---------------------------------------------------------------------------

/** 按 URL+method 路由的 fetch mock */
function stubFetch(routes: Record<string, { ok: boolean; json: unknown }>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const hit = routes[`${method} ${url}`]
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: hit.ok, status: hit.ok ? 200 : 500, json: async () => hit.json } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('验收面板插件自检（宏展开/状态栏实测）', () => {
  it('MVU：变量写读 + 状态栏返回 html → 自检通过', async () => {
    stubFetch({
      'POST /dsht-mvu/variables/register': { ok: true, json: {} },
      'GET /dsht-mvu/variables?sessionId=__selftest__': { ok: true, json: { variables: { __dsht_selftest__: 1 } } },
      'GET /dsht-mvu/statusbar-render?sessionId=__selftest__': { ok: true, json: { html: '<div>状态栏</div>' } },
    })
    const mvu = PROBES.find(p => p.listName === 'dsht-plugin-mvu')!
    await expect(mvu.selftest()).resolves.toBe(true)
  })

  it('MVU：状态栏路由不可达（404）→ 在线但功能异常（selftest false）', async () => {
    stubFetch({
      'POST /dsht-mvu/variables/register': { ok: true, json: {} },
      'GET /dsht-mvu/variables?sessionId=__selftest__': { ok: true, json: { variables: { __dsht_selftest__: 1 } } },
    })
    const mvu = PROBES.find(p => p.listName === 'dsht-plugin-mvu')!
    await expect(mvu.selftest()).resolves.toBe(false)
  })

  it('酒馆助手：变量写读 + 宏展开返回非原文 → 自检通过', async () => {
    stubFetch({
      'POST /dsht-tavern-helper/variables': { ok: true, json: {} },
      'GET /dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__': { ok: true, json: { value: 1 } },
      'DELETE /dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__': { ok: true, json: {} },
      'POST /dsht-tavern-helper/macros/expand': { ok: true, json: { result: '14:30' } },
    })
    const th = PROBES.find(p => p.listName === 'dsht-plugin-tavern-helper')!
    await expect(th.selftest()).resolves.toBe(true)
  })

  it('酒馆助手：宏展开返回原文 {{time}} → 功能异常（selftest false）', async () => {
    stubFetch({
      'POST /dsht-tavern-helper/variables': { ok: true, json: {} },
      'GET /dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__': { ok: true, json: { value: 1 } },
      'DELETE /dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__': { ok: true, json: {} },
      'POST /dsht-tavern-helper/macros/expand': { ok: true, json: { result: '{{time}}' } },
    })
    const th = PROBES.find(p => p.listName === 'dsht-plugin-tavern-helper')!
    await expect(th.selftest()).resolves.toBe(false)
  })

  it('提示词模板：渲染断言保持（已有链路不回归）', async () => {
    stubFetch({
      'POST /dsht-prompt-template/render': { ok: true, json: { result: '你好，自检！' } },
    })
    const pt = PROBES.find(p => p.listName === 'dsht-plugin-prompt-template')!
    await expect(pt.selftest()).resolves.toBe(true)
  })
})
