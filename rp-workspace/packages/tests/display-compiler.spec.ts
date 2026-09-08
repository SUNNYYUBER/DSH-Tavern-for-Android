/**
 * P0-2 / P0-3 前端 display 升级单测：
 * 1. 三段编译（compileDisplaySegments：完整 HTML 文档 → html 段进 iframe /
 *    行首平衡 HTML 块 → inline-html 段 sanitize 内联 / 其余 → markdown 段）
 * 2. 两趟执行（先通用 !markdownOnly&&!promptOnly，再 markdownOnly 专属）
 * 3. 私用区 token 隔离与统一还原 + 防空白守卫 + depth 透传
 * 4. iframe 文档骨架（buildDisplayFrameDocument / clampFrameHeight）
 * 5. SVG 白名单（sanitizeDisplayHtml + 协议层不折叠）
 * 参考：dsh-agent-rp card-display-compiler.ts/frontend-regex.ts、
 * dsh-tavern tavern-regex-display.js/client.js、agent-loop-rp HTML_DISPLAY_TAGS（均 MIT）。
 */
import { describe, expect, it } from 'vitest'
import {
  FRAME_MAX_HEIGHT, buildDisplayFrameDocument, clampFrameHeight,
  compileDisplaySegments, runDisplayScripts,
} from '../src/dsht-rp-ui/src/client/display-compiler.ts'
import {
  PROTO_DEFAULT, applyOutputProtocolSegments, sanitizeDisplayHtml,
} from '../src/dsht-rp-ui/src/client/output-protocol.ts'
import type { RegexScript } from '../src/regex/engine.ts'

function mkScript(over: Partial<RegexScript> = {}): RegexScript {
  return {
    id: 't1', scriptName: '测试', findRegex: '/foo/', replaceString: 'bar',
    trimStrings: [], placement: [2], disabled: false,
    markdownOnly: true, promptOnly: false, runOnEdit: false,
    substituteRegex: 0, minDepth: null, maxDepth: null, ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. 三段编译
// ---------------------------------------------------------------------------

describe('三段编译（compileDisplaySegments）', () => {
  it('```html 围栏完整文档 → html 段；前后散文 → markdown 段，顺序保留', () => {
    const doc = '<!doctype html><html><head><style>.ball{position:fixed}</style></head>'
      + '<body><div class="ball">悬浮球</div></body></html>'
    const segments = compileDisplaySegments(`开场白。\n\`\`\`html\n${doc}\n\`\`\`\n尾声。`)
    expect(segments.map(s => s.kind)).toEqual(['markdown', 'html', 'markdown'])
    expect(segments[0]).toEqual({ kind: 'markdown', text: '开场白。\n' })
    expect((segments[1] as { source: string }).source).toContain('position:fixed')
    expect((segments[1] as { source: string }).source).toContain('悬浮球')
    expect((segments[2] as { text: string }).text).toContain('尾声。')
  })

  it('无 info 围栏但内容是完整文档（doctype+html）→ html 段', () => {
    const segments = compileDisplaySegments('```\n<!doctype html><html><body>x</body></html>\n```')
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('html')
  })

  it('含 head/body 但无 doctype 的围栏内容 → html 段', () => {
    const segments = compileDisplaySegments('```\n<html><body><div>界面</div></body></html>\n```')
    expect(segments[0].kind).toBe('html')
  })

  it('非 html 围栏（```js）不切，留在 markdown 段', () => {
    const value = '前文\n```js\nalert(1)\n```\n后文'
    const segments = compileDisplaySegments(value)
    expect(segments).toEqual([{ kind: 'markdown', text: value }])
  })

  it('行首平衡 <div> 块 + 后随散文 → inline-html + markdown，散文逐字节保留', () => {
    const segments = compileDisplaySegments('<div class="框">内容</div>\n后文散文**加粗**')
    expect(segments.map(s => s.kind)).toEqual(['inline-html', 'markdown'])
    expect((segments[0] as { source: string }).source).toBe('<div class="框">内容</div>')
    expect((segments[1] as { text: string }).text).toBe('\n后文散文**加粗**')
  })

  it('嵌套同名块的平衡切分（div 套 div）', () => {
    const segments = compileDisplaySegments('<div><div>内层</div></div>散文')
    expect(segments.map(s => s.kind)).toEqual(['inline-html', 'markdown'])
    expect((segments[0] as { source: string }).source).toBe('<div><div>内层</div></div>')
  })

  it('纯散文（无 HTML）→ 单个 markdown 段', () => {
    expect(compileDisplaySegments('就是一段普通正文。a < b 比较')).toEqual([
      { kind: 'markdown', text: '就是一段普通正文。a < b 比较' },
    ])
  })

  it('散文中混行内 <b> → 整段 inline-html（渲染层 sanitize 内联）', () => {
    const segments = compileDisplaySegments('前文 <b>粗</b> 后文')
    expect(segments).toEqual([{ kind: 'inline-html', source: '前文 <b>粗</b> 后文' }])
  })

  it('行内代码里的 <div> 不算 display HTML（反引号保护）', () => {
    const value = '代码 `<div>不是标签</div>` 结束'
    expect(compileDisplaySegments(value)).toEqual([{ kind: 'markdown', text: value }])
  })

  it('【裸露修复】散文 + HTML 卡块 + ```js 围栏混排 → 逐块切分（围栏不进 iframe）', () => {
    // 真机裸露形态：HTML 卡块前面有散文、后面跟 ```javascript 围栏——旧行为把
    // 整段吞进 inline-html → sanitize 失败 → 整段进 iframe → 源码裸露
    const value = '她抬头看我。\n\n<div class="tide-card"><div class="head">标题</div></div>\n\n```js\nconsole.log("<div>围栏内不算标签</div>");\n```'
    const segments = compileDisplaySegments(value)
    expect(segments.map(s => s.kind)).toEqual(['markdown', 'inline-html', 'markdown'])
    expect((segments[0] as { text: string }).text).toBe('她抬头看我。\n\n')
    expect((segments[1] as { source: string }).source).toBe('<div class="tide-card"><div class="head">标题</div></div>')
    // 围栏原样保留在 markdown 段（MarkdownText 渲染成代码块，ST 同语义）
    expect((segments[2] as { text: string }).text).toContain('```js')
  })
})

// ---------------------------------------------------------------------------
// 2. 两趟执行 + 私用区 token + 防空白守卫 + depth
// ---------------------------------------------------------------------------

describe('两趟执行（先通用后 markdownOnly）', () => {
  it('通用脚本先于 markdownOnly 跑（数组顺序不改变趟次）', () => {
    const md = mkScript({ id: 'md', findRegex: '/foo/', replaceString: 'M', markdownOnly: true })
    const generic = mkScript({
      id: 'gen', findRegex: '/foo/', replaceString: 'G', markdownOnly: false, promptOnly: false,
    })
    // 数组里 markdownOnly 在前；若按数组顺序单趟跑结果是 M，两趟跑通用先中 → G
    const r = runDisplayScripts([md, generic], 'foo', null)
    expect(r.text).toBe('G')
    expect(r.applied.map(a => a.id)).toEqual(['gen'])
  })

  it('promptOnly 专属脚本在 display 视图不跑', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: 'X', markdownOnly: false, promptOnly: true })
    const r = runDisplayScripts([s], 'foo', null)
    expect(r.text).toBe('foo')
    expect(r.applied).toHaveLength(0)
  })
})

describe('私用区 token 隔离与还原', () => {
  it('后续正则看不到前一个正则产出的 HTML（防二次污染）', () => {
    const producer = mkScript({ id: 'p', findRegex: '/正文/', replaceString: '<div class="框">正文</div>' })
    const polluter = mkScript({ id: 'q', findRegex: '/<div[^>]*>/', replaceString: 'POLLUTED' })
    const r = runDisplayScripts([producer, polluter], '开头正文结尾', null)
    expect(r.text).toBe('开头<div class="框">正文</div>结尾')
    expect(r.text).not.toContain('POLLUTED')
    expect(r.applied.map(a => a.id)).toEqual(['p'])
  })

  it('token 统一还原：产物原文回来，文本无 token 残留', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '<span>替换产物</span>' })
    const r = runDisplayScripts([s], 'a foo b', null)
    expect(r.text).toBe('a <span>替换产物</span> b')
    expect(r.text).not.toContain('DSH_RP_REGEX')
    // 私用区字符（U+E000/U+E001）同样无残留
    expect(/[\uE000\uE001]/u.test(r.text)).toBe(false)
  })

  it('$1 捕获组与 {{match}} 在替换串里求值', () => {
    const s = mkScript({ findRegex: '/(foo)(bar)?/', replaceString: '<b>$1</b>[{{match}}][$2]' })
    const r = runDisplayScripts([s], 'x foobar y', null)
    expect(r.text).toBe('x <b>foo</b>[foobar][bar] y')
  })

  it('防空白守卫：替换后整轮为空 → 回退原文', () => {
    const s = mkScript({ findRegex: '/^[\\s\\S]*$/', replaceString: '' })
    const r = runDisplayScripts([s], '整轮正文', null)
    expect(r.text).toBe('整轮正文')
    expect(r.applied).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('placement 不含 1/2/3 的脚本不跑（世界书等）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: 'X', placement: [5] })
    expect(runDisplayScripts([s], 'foo', null).text).toBe('foo')
  })
})

describe('depth 透传（条目自身 minDepth/maxDepth 生效）', () => {
  it('minDepth：深度不足不跑，达标才跑', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: 'X', minDepth: 5 })
    expect(runDisplayScripts([s], 'foo', 0).text).toBe('foo')
    expect(runDisplayScripts([s], 'foo', 4).text).toBe('foo')
    expect(runDisplayScripts([s], 'foo', 5).text).toBe('X')
  })

  it('maxDepth：超过深度不跑；depth=null 不过滤', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: 'X', maxDepth: 2 })
    expect(runDisplayScripts([s], 'foo', 3).text).toBe('foo')
    expect(runDisplayScripts([s], 'foo', 2).text).toBe('X')
    expect(runDisplayScripts([s], 'foo', null).text).toBe('X')
  })
})

// ---------------------------------------------------------------------------
// 3. iframe 文档骨架
// ---------------------------------------------------------------------------

describe('iframe 文档骨架（buildDisplayFrameDocument / clampFrameHeight）', () => {
  it('HTML 片段 → 包进带 CSP/基础样式/高度上报脚本的文档', () => {
    const doc = buildDisplayFrameDocument('<div class="ball">悬浮球</div>', 'tok-1')
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain('no-referrer')
    expect(doc).toContain('<div class="ball">悬浮球</div>')
    expect(doc).toContain('dsht-rp-frame-height')
    expect(doc).toContain('tok-1')
  })

  it('完整文档 → 高度上报脚本注入 </body> 前，不套第二层 doctype', () => {
    const source = '<!doctype html><html><head><title>卡</title></head><body><div>界面</div></body></html>'
    const doc = buildDisplayFrameDocument(source, 'tok-2')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc.indexOf('<!doctype html>')).toBe(doc.lastIndexOf('<!doctype html>'))
    expect(doc).toContain('dsht-rp-frame-height')
    expect(doc.indexOf('dsht-rp-frame-height')).toBeLessThan(doc.indexOf('</body>'))
  })

  it('clampFrameHeight：[48,12000]', () => {
    expect(clampFrameHeight(10)).toBe(48)
    expect(clampFrameHeight(500)).toBe(500)
    expect(clampFrameHeight(99999)).toBe(FRAME_MAX_HEIGHT)
    expect(clampFrameHeight(Number.NaN)).toBe(48)
  })
})

// ---------------------------------------------------------------------------
// 4. SVG 白名单
// ---------------------------------------------------------------------------

describe('SVG 白名单（sanitizeDisplayHtml）', () => {
  it('svg + viewBox/path/circle 呈现属性保留', () => {
    const clean = sanitizeDisplayHtml(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#fff" stroke="#000" stroke-width="1"/></svg>')
    expect(clean).not.toBeNull()
    expect(clean).toContain('viewBox="0 0 10 10"')
    expect(clean).toContain('cx="5"')
    expect(clean).toContain('fill="#fff"')
    expect(clean).toContain('stroke-width="1"')
  })

  it('line/polygon/text/tspan/g/defs/use 标签通过；白名单外属性丢弃', () => {
    const clean = sanitizeDisplayHtml(
      '<svg><g><line x1="0" y1="0" x2="9" y2="9"/><polygon points="0,0 1,1 2,0"/>'
      + '<text x="1" y="2" onclick="hack()">字<tspan fill="red">幕</tspan></text>'
      + '<defs><path d="M0 0h9"/></defs><use href="#x"/></g></svg>')
    expect(clean).not.toBeNull()
    expect(clean).toContain('points="0,0 1,1 2,0"')
    expect(clean).toContain('d="M0 0h9"')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('href') // href 不在 SVG 属性白名单
  })

  it('svg 内 script 仍整体拒绝（null）；svg 标签不影响其它危险标签判定', () => {
    expect(sanitizeDisplayHtml('<svg><script>alert(1)</script></svg>')).toBeNull()
    expect(sanitizeDisplayHtml('<script>alert(1)</script>')).toBeNull()
  })

  it('协议层不折叠 svg 块（HTML_DISPLAY_TAGS 豁免），自闭合 path 不被清除', () => {
    const segs = applyOutputProtocolSegments(
      '前<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>后', PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'collapsible')).toBe(false)
    const text = segs.map(s => (s as { content: string }).content).join('')
    expect(text).toContain('<svg viewBox="0 0 1 1">')
    expect(text).toContain('<path d="M0 0"/>')
  })

  it('三段编译 + sanitize 集成：svg 块 → inline-html 段且 sanitize 通过', () => {
    const segments = compileDisplaySegments('<svg viewBox="0 0 10 10"><rect x="1" y="1" width="2" height="2"/></svg>')
    expect(segments[0].kind).toBe('inline-html')
    const clean = sanitizeDisplayHtml((segments[0] as { source: string }).source)
    expect(clean).not.toBeNull()
    expect(clean).toContain('<rect')
  })
})
