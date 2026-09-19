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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FRAME_MAX_HEIGHT, buildDisplayFrameDocument, clampFrameHeight,
  compileDisplaySegments, frameFallbackText, runDisplayScripts, shouldRenderFrame,
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
// 1b.【2026-09-14 P1】流式期间「文档段不建 iframe」时的回退形态
// 病症：真机截图实证，生成过程中卡里完整 HTML 文档（悬浮球/卡片）整段裸露成源码。
// 根因：RpNativeChat 的 `enhanced` 门把流式期间的**整段**退纯文本（不切三段）。
// 修法：流式期间照常三段编译，只有「完整文档段」的落点由 frameRenderOn 决定——
//       关时降级成 HTML 围栏代码块（不裸露源码），定稿后自动换 iframe。
// ---------------------------------------------------------------------------

describe('【P1】文档段回退形态（frameFallbackText）', () => {
  it('包成 ```html 围栏代码块（MarkdownText 出代码块，不裸露源码）', () => {
    const doc = '<!doctype html><html><body><div class="ball">悬浮球</div></body></html>'
    const out = frameFallbackText(doc)
    expect(out).toBe('```html\n' + doc + '\n```')
  })

  it('源自带 ``` 围栏 → 用更长围栏包裹（否则提前闭合、后半段又裸露）', () => {
    const doc = '<html><body><pre>\n```\ninner\n```\n</pre></body></html>'
    const out = frameFallbackText(doc)
    expect(out.startsWith('````html\n')).toBe(true)
    expect(out.endsWith('\n````')).toBe(true)
    // 内部的三连围栏被四连围栏安全包住
    expect(out).toContain('```\ninner\n```')
  })

  it('末尾空白被裁掉（不产生多余空行）', () => {
    expect(frameFallbackText('<html></html>\n\n  ')).toBe('```html\n<html></html>\n```')
  })

  it('围栏长度按源内最长反引号串 +1 取（多个不同长度取最大）', () => {
    const doc = 'a```b`````c'
    const out = frameFallbackText(doc)
    // 源内最长 = 5 → 围栏 6
    expect(out.startsWith('``````html\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 1c.【2026-09-14 L5 穷举补齐】frameRenderOn 决策（shouldRenderFrame）
//
// 为什么单独为「一行判断」写一组测试：
// 这条判断是 P1「流式期间 HTML 裸露」修复的**核心**，但原先是组件内联表达式
// ⇒ 无法单测（要起 React + 全套 props）⇒ 被它调用的 frameFallbackText 有测试，
// **决策本身零覆盖**。L5 穷举把它下沉为纯函数，此组测试即为该缺口的正/负控。
// ---------------------------------------------------------------------------

describe('【L5】frameRenderOn 决策（shouldRenderFrame）', () => {
  it('正控：非流式（定稿）→ 建帧（定稿后内容不再增长，建帧不会被驱逐）', () => {
    expect(shouldRenderFrame(true, false, undefined)).toBe(true)
    expect(shouldRenderFrame(true, false, false)).toBe(true)
    expect(shouldRenderFrame(true, false, true)).toBe(true)
  })

  it('✅ 正控：流式中 + 卡未允许 → **不建帧**（默认路径；建帧会被反复驱逐/重执行脚本）', () => {
    expect(shouldRenderFrame(true, true, undefined)).toBe(false)
    expect(shouldRenderFrame(true, true, false)).toBe(false)
  })

  it('✅ 正控：流式中 + 卡显式 allowStreaming → 建帧（用户显式选择的代价自担）', () => {
    expect(shouldRenderFrame(true, true, true)).toBe(true)
  })

  it('负控：渲染总开关关（thRenderOn=false）→ 一律不建帧（任何 streaming/allowStreaming 组合）', () => {
    for (const streaming of [true, false]) {
      for (const allow of [true, false, undefined]) {
        expect(shouldRenderFrame(false, streaming, allow)).toBe(false)
      }
    }
  })

  it('边界：allowStreaming 必须**严格 true** 才算允许（传 1/「true」等真值不算）', () => {
    // 为什么严格：字段来自宿主设置 JSON，类型不确定；宽松判定会让「字符串 "false"」
    // 也当成开启 ⇒ 流式期间疯狂建帧。判据必须与设置解析口径一致（=== true）。
    expect(shouldRenderFrame(true, true, 'true' as unknown as boolean)).toBe(false)
    expect(shouldRenderFrame(true, true, 1 as unknown as boolean)).toBe(false)
  })

  it('全组合穷举：3×2×3 = 18 种输入全部有确定结论（无 undefined 泄漏）', () => {
    for (const th of [true, false]) {
      for (const streaming of [true, false]) {
        for (const allow of [true, false, undefined]) {
          const r = shouldRenderFrame(th, streaming, allow)
          expect(typeof r).toBe('boolean')
          // 与判据定义的等价展开一致（独立复算，防实现与文档脱节）
          const expected = th && (!streaming || allow === true)
          expect(r).toBe(expected)
        }
      }
    }
  })

  it('✅ 结构性：调用点必须用该纯函数（不许把判据再内联回组件——那会重现零覆盖）', () => {
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client', 'RpNativeChat.tsx'), 'utf8')
    expect(src).toContain('shouldRenderFrame(thRenderOn, streaming')
    // 反例：旧的裸内联写法不得复活
    expect(src).not.toMatch(/const\s+frameRenderOn\s*=\s*thRenderOn\s*&&/)
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
    expect(r.text).not.toContain('DSH_RP_XFR')
    // 私用区字符（U+E000/U+E001）同样无残留
    expect(/[\uE000\uE001]/u.test(r.text)).toBe(false)
  })

  // 【H1 2026-09-14 自研重写】占位标记换成我们自己的形态后，必须仍满足两条硬性：
  // ① 正文里若**本来就**含旧形态字符串（用户/模型可能写出类似文本），不会被误当占位符；
  // ② 多个替换产物并存时按序还原，不串位。
  it('正文里出现形似占位符的普通文本 → 不被误还原（私用区是唯一识别符）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: 'X' })
    // 正文自带 "DSH_RP_XFR_0" 这类字符串，但不含私用区包裹 → 必须原样保留
    const r = runDisplayScripts([s], 'DSH_RP_XFR_0 foo', null)
    expect(r.text).toBe('DSH_RP_XFR_0 X')
  })

  it('多个替换产物按序还原，不串位', () => {
    const s1 = mkScript({ id: 'a', findRegex: '/foo/', replaceString: 'A1' })
    const s2 = mkScript({ id: 'b', findRegex: '/bar/', replaceString: 'B2' })
    const r = runDisplayScripts([s1, s2], 'foo bar', null)
    expect(r.text).toBe('A1 B2')
  })

  // 【L5 2026-09-14 穷举补齐】占位符隔离的**负控**。
  // 上一条「防二次污染」是正控（后一条看不到前一条产物）；但它**证明不了**
  // 「隔离没有把该看到的正文也藏掉」——若实现把整段正文都换成占位符，
  // 正控仍然会通过（因为 polluter 的 findRegex 命中的是产物，本来就不该命中）。
  // 这条负控用「命中**用户原文**」的脚本来证伪那种过度隔离。
  it('✅ 负控：占位符只隔离「本轮替换产物」，**不隔离原文**——命中原文的正则必须生效', () => {
    // 正文自带 HTML 形态（用户/模型写出的，不是任何正则的产物）
    const original = '开场 <div class="用户原文">原文</div> 结束'
    const cleaner = mkScript({ id: 'c', findRegex: '/<div class="用户原文">([^<]*)<\\/div>/', replaceString: '[$1]' })
    const r = runDisplayScripts([cleaner], original, null)
    // 命中原文 ⇒ 生效
    expect(r.text).toBe('开场 [原文] 结束')
    expect(r.applied.map(a => a.id)).toEqual(['c'])
  })

  it('✅ 负控：前一条只改原文、后一条仍能看到原文中未被替换的部分', () => {
    // 脚本 A 只替换「苹果」；脚本 B 处理「香蕉」——B 必须仍能命中原文里的香蕉
    // （若 A 的替换把整段正文都换成占位符，B 就看不到香蕉 ⇒ 功能静默丢失）
    const a = mkScript({ id: 'a', findRegex: '/苹果/', replaceString: '苹果🍎' })
    const b = mkScript({ id: 'b', findRegex: '/香蕉/', replaceString: '香蕉🍌' })
    const r = runDisplayScripts([a, b], '苹果和香蕉', null)
    expect(r.text).toBe('苹果🍎和香蕉🍌')
    expect(r.applied.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('$1 捕获组与 {{match}} 在替换串里求值', () => {
    const s = mkScript({ findRegex: '/(foo)(bar)?/', replaceString: '<b>$1</b>[{{match}}][$2]' })
    const r = runDisplayScripts([s], 'x foobar y', null)
    expect(r.text).toBe('x <b>foo</b>[foobar][bar] y')
  })

  // 【H1 2026-09-14 自研重写】单趟扫描求值的各类边界。
  it('{{match}} 大小写不敏感（{{MATCH}} / {{Match}} 都算引用）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '[{{MATCH}}][{{Match}}]' })
    expect(runDisplayScripts([s], 'foo', null).text).toBe('[foo][foo]')
  })

  it('$0 = 整个匹配', () => {
    const s = mkScript({ findRegex: '/(f)(oo)/', replaceString: '<$0>' })
    expect(runDisplayScripts([s], 'foo', null).text).toBe('<foo>')
  })

  it('正则无捕获组时 $1 = 整个 match（ST/TT 行为，不是字面残留）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '<x>$1</x>' })
    expect(runDisplayScripts([s], 'a foo b', null).text).toBe('a <x>foo</x> b')
  })

  it('$NN 越界且有前置组 → 拆成 $N + 字面尾数字（$12 → $1 + "2"）', () => {
    const s = mkScript({ findRegex: '/(a)/', replaceString: '[$12]' })
    expect(runDisplayScripts([s], 'a', null).text).toBe('[a2]')
  })

  it('$NN 越界且无任何捕获组 → 整个引用按 match 展开（ST/TT 行为）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '[$12]' })
    // 无捕获组 ⇒ $NN 整体视作 $N = 整个 match（不拆尾数字——没有组可拆）
    expect(runDisplayScripts([s], 'foo', null).text).toBe('[foo]')
  })

  it('非数字引用（$x）原样保留；无组时 $5 按 ST 语义 = 整个 match', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '价格 $5 与 $x 保留' })
    // $5：无捕获组 ⇒ 整个 match（ST/TT 行为）；$x：不是合法引用 ⇒ 字面保留
    expect(runDisplayScripts([s], 'foo', null).text).toBe('价格 foo 与 $x 保留')
  })

  it('有捕获组时越界的 $N 原样保留（不误取 match）', () => {
    const s = mkScript({ findRegex: '/(a)/', replaceString: '[$1][$9]' })
    expect(runDisplayScripts([s], 'a', null).text).toBe('[a][$9]')
  })

  it('trimStrings 只削捕获内容，不削替换串里用户字面写的字符', () => {
    // trimStrings 含 '2'：若错削到替换串字面文本，'$12' 的尾数字会被吃掉
    const s = mkScript({ findRegex: '/(a)/', replaceString: '[$12]', trimStrings: ['2'] })
    expect(runDisplayScripts([s], 'a', null).text).toBe('[a2]')
  })

  // 【T-17 2026-09-11】display 半边同款：$<name> 具名组 + 未命中给空串。
  it('$<name> 具名捕获组在 display 替换串里求值', () => {
    const s = mkScript({ findRegex: '/(?<who>\\w+)-(?<what>[a-z]+)(?<miss>\\d+)?/g', replaceString: '[$<who>|$<what>|$<miss>]' })
    expect(runDisplayScripts([s], 'a-b', null).text).toBe('[a|b|]')
    expect(runDisplayScripts([s], 'x-y9', null).text).toBe('[x|y|9]')
  })

  it('$<name> 在无具名组的正则下 → 按空串（ST 语义，不抛）', () => {
    const s = mkScript({ findRegex: '/foo/', replaceString: '[$<who>]' })
    expect(runDisplayScripts([s], 'foo', null).text).toBe('[]')
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

  // 标题原写 [48,12000]（与常量漂移，断言用常量故未失败）——L2 穷举时一并修正。
  it('clampFrameHeight：[48, FRAME_MAX_HEIGHT]', () => {
    expect(clampFrameHeight(10)).toBe(48)
    expect(clampFrameHeight(500)).toBe(500)
    expect(clampFrameHeight(99999)).toBe(FRAME_MAX_HEIGHT)
    expect(clampFrameHeight(Number.NaN)).toBe(48)
  })

  // -------------------------------------------------------------------------
  // 【L2 2026-09-14】帧高上报的**节流**护栏（防回归成「每帧全量遍历」）
  // -------------------------------------------------------------------------

  it('✅ 上报脚本必须带最小上报间隔（防 MutationObserver 驱动的每帧全量扫描）', () => {
    const doc = buildDisplayFrameDocument('<div>x</div>', 'tok-l2')
    // 节流三要素：间隔常量 + 上次时间戳 + 补报定时器
    expect(doc).toContain('var MIN=')
    expect(doc).toContain('lastAt')
    expect(doc).toContain('clearTimeout(timer)')
    expect(doc).toContain('setTimeout(function(){timer=null;')
  })

  it('✅ 节流**不丢变化**：窗口内触发要排补报定时器（否则高度会停在中间态）', () => {
    const doc = buildDisplayFrameDocument('<div>x</div>', 'tok-l2b')
    expect(doc).toContain('var wait=MIN-(now-lastAt);')
    expect(doc).toMatch(/if\(wait<=0\)/)
    expect(doc).toMatch(/if\(timer===null\)\{timer=setTimeout/)
  })

  it('✅ iframe 骨架抑制 text autosizing（否则 px 布局与放大后的字号不匹配）', () => {
    const doc = buildDisplayFrameDocument('<div>x</div>', 'tok-l2c')
    expect(doc).toContain('-webkit-text-size-adjust:100%')
    expect(doc).toContain('text-size-adjust:100%')
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

// ---------------------------------------------------------------------------
// 【W6 第二十三轮】A5 三段编译的**四条路径一致性**（流式 / 定稿 / 多帧 / 窗口化回渲）
// ---------------------------------------------------------------------------

/**
 * ## 为什么这组护栏存在
 * GOAL §11.1 W6 要求核对「三段编译在四条路径上是否真的同源」。勘察方式：
 * 用**真实卡输出**（5 张抽样卡 16.9MB 会话，2069 条消息）跑四条路径的判据。
 *
 * ## 勘察结论（全部通过，无产品缺陷）
 * | 路径 | 判据 | 结果 |
 * |---|---|---|
 * | ① 流式 vs ② 定稿 | 8 类语义样本的渲染单元序列是否一致 | **同源**（8/8） |
 * | ③ 多帧 | `shouldRenderFrame` 真值表（18 组合穷举 + 独立复算） | **同源**（见上方既有用例） |
 * | ④ 窗口化回渲 | `processed` 是同一 `useMemo`，窗口化不重跑编译 | **同源**（结构断言，见下） |
 * | 折叠体内文 | 与主楼层同一 `CompiledBody` 组件 + 内容零丢失 | **同源**（2973 个真实折叠块丢字 0） |
 *
 * ## 本轮抓到的**判据自身缺陷**（8 次，全部记入方法论 §6.17）
 * 最可复用的一条：**用 `/<[^<>]*>/g` 抽纯文本，会把颜文字之间的真实文字剥掉** ——
 * 真实卡文本里 `/(>д<)/`、`哦><"` 这类组合出现 **327 次**，旧正则会把 `<` 与后续 `>`
 * 之间的正文当标签内容删除 ⇒ 判据报「内容丢失」的**假象**（我据此白查了 6 轮）。
 * ⇒ 正确写法要求标签名**必须以字母开头**；下面第一条用例就是它的回归锁。
 */
describe('【W6】三段编译四条路径一致性（A5）', () => {
  /** 本轮踩坑的正解：只剥「名字以字母开头的真标签」 */
  const stripRealTags = (s: string): string => s.replace(/<\/?[a-zA-Z][\w:~-]*(?:\s[^<>]*)?\/?>/g, '')
  /** 本轮踩坑的错解（保留为负控样本） */
  const stripAnyAngle = (s: string): string => s.replace(/<[^<>]*>/g, '')

  it('✅ 判据自证：抽纯文本必须放过颜文字与非 ASCII 标签名（P-30 —— 该缺陷曾造成 6 轮假象）', () => {
    // 正控：真标签剥掉、内容保留
    expect(stripRealTags('<b>粗体</b>')).toBe('粗体')
    expect(stripRealTags('<analysis>审校</analysis>')).toBe('审校')
    // 正控（关键）：**真实数据里**旧判据确实吃掉的内容（不是猜的，取自 16.9MB 会话）
    //   证据：`<音乐>2622538819.mp3</音乐>`、`<|SYSTEM|>…`、`<剧情大纲编码索引>…`
    for (const s of ['<音乐>', '</音乐>', '<|SYSTEM|>', '<剧情大纲编码索引>']) {
      expect(stripRealTags(s), `非 ASCII / 符号标签名被剥掉：「${s}」`).toBe(s)
    }
    // 负控：错解必须**真的**会剥掉这些（证明用例有杠杆，不是恒真）
    // ⚠️ 本条第一版曾写错：我拿 `/(>д<)/` 当负控样本，而旧正则对它**不生效**
    //    （`<` 后无配对 `>` 形成 `<...>`）⇒ 负控当场报红，抓到样本选错。
    //    ⇒ 负控样本必须取自**真实失效形态**（见上）。
    expect(stripAnyAngle('<音乐>'), '负控失效：错解竟然没吃掉「<音乐>」，说明该用例无判据力').not.toBe('<音乐>')
    expect(stripAnyAngle('<|SYSTEM|>'), '负控失效：错解竟然没吃掉「<|SYSTEM|>」').not.toBe('<|SYSTEM|>')
  })

  it('① 流式 vs ② 定稿：同一输入的渲染单元序列必须一致（否则流式结束瞬间会跳变）', () => {
    const proto = PROTO_DEFAULT
    const cases = [
      '正文\n<interactive_input>半截内容',            // 未闭合未知标签（流式半截形态）
      '前\n<状态>数值</状态>\n后',                     // 协议标签（闭合）
      '前\n<状态>数值',                                // 协议标签（流式半截）
      '<div class="c"><b>x</b></div>',                 // 白名单 HTML
      '```html\n<!doctype html><html><body>d</body></html>\n```', // 完整文档段
      '前<script>alert(1)</script>后',                 // 危险标签
      '```\n<think_fox~>惰性</think_fox~>\n```',        // 围栏内伪标签
    ]
    const seqOf = (text: string, streaming: boolean): string =>
      applyOutputProtocolSegments(text, proto, streaming)
        .flatMap(s => s.kind === 'text'
          ? compileDisplaySegments(s.content).map(d => d.kind)
          : [`P:${s.kind}`])
        .join(',')
    for (const c of cases) {
      expect(seqOf(c, true), `流式与定稿不同源：「${c.slice(0, 30)}」`).toBe(seqOf(c, false))
    }
  })

  it('④ 窗口化回渲：编译产物必须来自同一 useMemo（窗口化不得重跑编译）', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client', 'RpNativeChat.tsx'), 'utf8')
    // processed 是唯一编译入口；windowed 只影响「渲染/占位」，不得进入编译 deps
    const memo = /const processed = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[([^\]]*)\]\)/.exec(src)
    expect(memo, '未找到 processed 的 useMemo（结构变了，需同步本护栏）').not.toBeNull()
    expect(memo?.[1] ?? '', 'windowed 进入了编译 deps ⇒ 窗口化会重跑三段编译（同源前提被破坏）').not.toContain('windowed')
    // 且 windowed 确实被使用（否则该断言恒真、无判据力）
    expect(src, '负控失效：组件里根本没用 windowed，本用例无判据力').toContain('data-windowed')
  })

  it('折叠体内文与主楼层共用同一渲染器（单源：不得出现第二套内文编译实现）', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client', 'RpNativeChat.tsx'), 'utf8')
    // 全仓只允许一处 unwrapForeignTags 调用（折叠体预处理）
    const calls = src.match(/unwrapForeignTags\(/g) ?? []
    expect(calls.length, `unwrapForeignTags 出现 ${calls.length} 次（应为 1 次，多出即为第二套实现）`).toBe(1)
    // 折叠体的三段编译也必须只有一处（CompiledBody 内）
    expect(src).toContain('compileDisplaySegments(unwrapForeignTags(text))')
  })

  // -------------------------------------------------------------------------
  // 【第二十三轮 W6 · 真实缺陷回归锁（设备探针在真实会话上抓到）】
  //
  // ## 缺陷
  // 协议层的**暂存哨兵**原先是**裸控制字符**：围栏 `\x01F<n>\x01`、段落 `\x00<n>\x00`。
  // 而控制字符**可以出现在用户/模型文本里** —— 实测真实会话的 `<skill_content>` 折叠块
  // 正文含字面量 `\x01F0\x01` ⇒ 被围栏还原逻辑消费 ⇒ **用户内容凭空消失 8 个字**
  // （设备探针 `ef-compile-parity.mjs` J2 报 `13867 → 13859`）。
  //
  // ## 修法
  // 哨兵改用**私用区**（U+E000/U+E001）+ 唯一前缀（`DSHT_RP_FENCE_` / `DSHT_RP_SEG_`），
  // 与同文件既有的 `HANDOFF_MARK` 同族 —— 私用区码位正文里天然不会出现。
  //
  // ## 判据（与既有的「形似占位符不被误还原」同族，但覆盖**协议层**）
  // 正文里写入**旧哨兵形态的字面量** ⇒ 必须原样保留，不得被消费。
  // -------------------------------------------------------------------------
  it('✅ 协议层哨兵不得被正文撞车（旧形态 \\x01F0\\x01 字面量必须原样保留）', () => {
    // 正控：旧哨兵形态的字面量出现在正文里
    const text = `开头\x01F0\x01中间\x00\x00结尾`
    const segs = applyOutputProtocolSegments(text, PROTO_DEFAULT, false)
    const out = segs.filter(s => s.kind === 'text').map(s => (s as { content: string }).content).join('')
    expect(out, '旧哨兵形态的字面量被协议层消费掉了（用户内容丢失）').toContain('\x01F0\x01')
    expect(out, '段落哨兵形态的字面量被消费掉了').toContain('\x00\x00')
    // 负控：私用区哨兵形态**不**应出现在用户正文里，但若出现也必须原样保留（无害）
    const pua = '\uE000DSHT_RP_FENCE_0\uE001'
    const out2 = applyOutputProtocolSegments(`前${pua}后`, PROTO_DEFAULT, false)
      .filter(s => s.kind === 'text').map(s => (s as { content: string }).content).join('')
    expect(out2, '私用区哨兵形态的字面量被消费掉了').toContain(pua)
  })

  it('✅ 哨兵单源：output-protocol 必须 import display-compiler 的哨兵（不得自行硬编码）', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client', 'output-protocol.ts'), 'utf8')
    expect(src, '协议层未 import 单源哨兵').toContain("from './display-compiler.ts'")
    expect(src).toContain('fenceMark')
    expect(src).toContain('segMark')
    // 负控：旧的控制字符哨兵不得复活
    expect(/`\\x01F\$\{/.test(src), '围栏哨兵退回了裸控制字符形态（会被正文撞车）').toBe(false)
    expect(/`\\x00\$\{/.test(src), '段落哨兵退回了裸控制字符形态').toBe(false)
  })
})
