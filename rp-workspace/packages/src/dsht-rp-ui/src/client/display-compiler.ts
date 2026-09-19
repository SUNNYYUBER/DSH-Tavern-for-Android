/**
 * display 三段编译 + 两趟 display 正则 + iframe 文档骨架（P0-2 / P0-3）。
 *
 * ## 本模块要解决的问题
 * 用户的痛点根因：悬浮球 / 剧情按钮 / tip 这类前端部件，其 display 产出是完整
 * HTML 片段或整份文档；旧的 sanitize 白名单直接整体丢弃（或退化成纯文本把源码露出来）。
 * 三段编译把「完整文档」切进 iframe 舞台（sandbox="allow-scripts"，position:fixed 部件
 * 在 iframe 内正常运行），把「行首平衡 HTML 块」交给白名单 sanitize 内联，其余散文按
 * markdown 渲染——一条文本里三种成分各归其位。
 *
 * ## 设计要点（全部为独立实现）
 * - **围栏扫描**：按行扫描 ``` / ~~~ 围栏配对，围栏内不看标签；判「完整文档」看
 *   doctype/html 配对或围栏 info 语言标记。
 * - **平衡块切分**：在代码围栏之外扫标签序列，找**行首**块级标签，按同名标签深度配对
 *   取平衡块，块外逐字节保留。
 * - **替换产物隔离**：替换结果暂存数组，正文只留下我们自己的私用区占位标记，全部跑完
 *   再统一还原。目的：后续正则不会把前一个正则产出的 HTML 标记当正文二次加工。
 * - **替换串求值**：单趟扫描 `replaceString`，边扫边解析 `{{match}}` / `$N` / `$<name>`
 *   三类引用，遇到 `$` 不是引用则原样保留。
 * - **iframe 文档骨架**：CSP 与基础样式集中在常量里，完整文档走「注入上报脚本」路径，
 *   片段走「包一层骨架」路径。
 *
 * ## 与 ST 的语义对齐
 * markdown 段不做未知标签剥离——未知/自定义标签（tip 等）的折叠兜底归
 * output-protocol 层单点负责，避免两处语义分叉。
 */

import type { RegexScript } from '../../../regex/engine.ts'
import { expandDisplayMacros, type DisplayMacroCtx } from './macros-display.ts'

// ---------------------------------------------------------------------------
// 三段编译
// ---------------------------------------------------------------------------

/** display 文本的一个有序段 */
export type DisplaySegment =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'html'; readonly source: string }
  | { readonly kind: 'inline-html'; readonly source: string }

/** 可按 HTML 渲染的标签全集（含 SVG 子集——卡前端用内联 SVG 画图标/进度环很常见） */
const HTML_DISPLAY_TAGS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em',
  'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input',
  'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta',
  'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture',
  'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search', 'section',
  'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title',
  'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'view', 'text', 'tspan',
])

/** 可与后随 Markdown 散文切分的行首平衡块级标签（块级语义：独占一行的 HTML 结构） */
const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'details', 'dialog', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'header', 'hgroup', 'html', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

interface SourceLine {
  readonly start: number
  readonly end: number
  readonly text: string
}

interface HtmlTagToken {
  readonly start: number
  readonly end: number
  readonly name: string
  readonly closing: boolean
  readonly selfClosing: boolean
}

/** 代码围栏/行内代码之外的 HTML 标签扫描（围栏内的标签是代码文本，不参与结构判定） */
function htmlTagsOutsideCode(value: string): readonly HtmlTagToken[] {
  const tags: HtmlTagToken[] = []
  let cursor = 0
  let codeTicks = 0
  while (cursor < value.length) {
    if (value[cursor] === '`') {
      let end = cursor + 1
      while (value[end] === '`') end += 1
      const ticks = end - cursor
      if (codeTicks === 0) codeTicks = ticks
      else if (ticks === codeTicks) codeTicks = 0
      cursor = end
      continue
    }
    if (codeTicks === 0 && value[cursor] === '<') {
      const tag = value.slice(cursor).match(/^<(\/)?([A-Za-z][A-Za-z0-9:_-]*)(?:\s[^<>]*?)?\s*(\/?)>/u)
      const name = tag?.[2]?.toLowerCase()
      if (tag?.[0] !== undefined && name !== undefined) {
        tags.push({
          start: cursor,
          end: cursor + tag[0].length,
          name,
          closing: tag[1] === '/',
          selfClosing: tag[3] === '/',
        })
        cursor += tag[0].length
        continue
      }
    }
    cursor += 1
  }
  return tags
}

function hasDisplayHtmlOutsideCode(value: string): boolean {
  return htmlTagsOutsideCode(value).some(tag => HTML_DISPLAY_TAGS.has(tag.name))
}

// ---------------------------------------------------------------------------
// 【ST 对齐 2026-09-07】未知标签解包（折叠体内文预处理）
//
// ST 的 messageFormatting = showdown(markdown) → 浏览器 HTML 解析。浏览器语义下：
//   - 成对未知标签（<interactive_input>/<char_guide>/<think_fox~>…）解析为 unknown
//     element——标签名不可见、内容照常显示；
//   - 游离闭合标签（</font> 无配对）被解析器直接丢弃；
//   - 危险标签内容不渲染。
// 本项目的 MarkdownText（宿主 micromark）把 raw HTML 当文本渲染——折叠体若直接进
// markdown，楼层里裸显「<thinking></font>」源码字样（真机实证）。此预处理在
// compileDisplaySegments 之前跑：白名单（HTML_DISPLAY_TAGS）标签原样保留给
// sanitize 管线出样式，其余标签按浏览器语义解包/丢弃。围栏内容惰性（协议解析同款）。
// ---------------------------------------------------------------------------

/** 危险标签：连同内容整体丢弃（浏览器不渲染其内容为可见文本） */
const UNWRAP_DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'title', 'noscript',
])

/** 折叠体内文的未知标签解包（仅渲染前预处理，不改会话原文） */
export function unwrapForeignTags(text: string): string {
  if (!text.includes('<')) return text
  // 代码围栏保护区（协议解析同款）：围栏内容是惰性代码，不参与解包
  // 【第二十三轮】哨兵改私用区（原为裸控制字符 `\x01F<n>\x01`，会被用户正文撞车 ⇒ 吞内容）
  const fences: string[] = []
  let work = text.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, (m) => {
    fences.push(m)
    return fenceMark(fences.length - 1)
  })
  // 危险标签连内容删除
  for (const t of UNWRAP_DROP_WITH_CONTENT) {
    work = work.replace(new RegExp(`<${t}(?:\\s[^<>]*)?>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), '')
    work = work.replace(new RegExp(`<\\/?${t}(?:\\s[^<>]*)?\\/?>`, 'gi'), '')
  }
  // 白名单标签原样保留，其余解包（标签名含 ~ 的伪标签如 <think_fox~> 一并解包）
  work = work.replace(/<\/?([a-zA-Z][\w:~-]*)((?:\s[^<>]*?)?)\s*\/?>/g, (m, name: string) => {
    return HTML_DISPLAY_TAGS.has(name.toLowerCase()) ? m : ''
  })
  return restoreFenceMarks(work, fences)
}

/** 切出一个行首平衡块级 HTML 块，块外散文逐字节保留。
 * 【2026-09-06 裸露修复】早期实现要求 HTML 必须出现在文本**开头**——真实 ST 卡消息是
 * 「散文 + <div>卡片</div> + ```js 代码围栏」混排，开头是散文时整段走不到切分，
 * 旧 appendSegment 把「散文+代码围栏」全部吞进 inline-html/iframe → 源码裸露。
 * 改为扫描全文找**任意行首**（行首 ≤3 空格）的块级 HTML 标签，取其平衡块。 */
function findLineStartHtmlBlock(value: string): HtmlTagToken | undefined {
  const tags = htmlTagsOutsideCode(value)
  for (const tag of tags) {
    if (tag.closing || tag.selfClosing || !HTML_BLOCK_TAGS.has(tag.name)) continue
    const lineStart = value.lastIndexOf('\n', tag.start - 1) + 1
    if (/^ {0,3}$/u.test(value.slice(lineStart, tag.start))) return tag
  }
  return undefined
}

/** 从 tag 起取同标签平衡块结尾（-1 = 不平衡） */
function balancedBlockEnd(value: string, tag: HtmlTagToken): number {
  let depth = 0
  for (const t of htmlTagsOutsideCode(value)) {
    if (t.start < tag.start || t.name !== tag.name) continue
    if (t.closing) depth -= 1
    else if (!t.selfClosing) depth += 1
    if (depth === 0) return t.end
    if (depth < 0) return -1
  }
  return -1
}

/** 按行切分同时保留每行的字节区间（切分位置要能按原始下标回切原文） */
function sourceLines(value: string): SourceLine[] {
  const lines: SourceLine[] = []
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu
  for (const match of value.matchAll(pattern)) {
    const text = match[0]
    const start = match.index
    if (text === '' && start === value.length) break
    lines.push({ start, end: start + text.length, text })
  }
  return lines
}

/** 围栏块是否为「完整前端文档」（要进 iframe 而不是当 prose 渲染）。
 *  判定顺序：① doctype+`</html>` 齐备（最硬的信号）；② 围栏 info 语言标了 `html`；
 *  ③ 无 info 时看是否出现文档级标签（html/head/body）——卡作者常省略 info。 */
function isFrontendDocument(info: string, source: string): boolean {
  const completeDocument = /<!doctype\s+html\b|<html(?:\s|>)/iu.test(source)
    && /<\/html\s*>/iu.test(source)
  if (completeDocument) return true
  const language = info.trim().split(/\s+/u)[0]?.toLowerCase()
  if (language !== undefined && language !== '') return language === 'html'
  return /<!doctype\s+html\b|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)/iu.test(source)
}

function appendSegment(segments: DisplaySegment[], text: string): void {
  if (text === '') return
  // 【2026-09-06 裸露修复】旧行为：文本含任意 HTML 但不在行首 → 整段（含散文与
  // ```js 代码围栏）转 inline-html → sanitize 失败整段进 iframe → 源码裸露。
  // 新行为分两档：
  // - 文本含代码围栏（```）→ 严格逐块：行首平衡块级 HTML 切出 inline-html，
  //   其余（散文/围栏）保留 markdown——代码围栏是「这段是给代码块渲染」的强信号，
  //   整段吞噬会把它炸成源码（真机截图实证）。
  // - 无围栏 → 旧行为保留（display 正则美化产物 = 无围栏的 <div>/<b> 包裹文本，
  //   整段 inline-html sanitize 渲染正是美化通道；行内标签由 sanitize 白名单处理）。
  const hasFence = text.includes('```')
  const tag = hasDisplayHtmlOutsideCode(text) ? findLineStartHtmlBlock(text) : undefined
  if (tag !== undefined) {
    const end = balancedBlockEnd(text, tag)
    if (end > 0) {
      if (tag.start > 0) appendSegment(segments, text.slice(0, tag.start))
      segments.push({ kind: 'inline-html', source: text.slice(tag.start, end) })
      appendSegment(segments, text.slice(end))
      return
    }
  }
  if (hasDisplayHtmlOutsideCode(text) && !hasFence) {
    segments.push({ kind: 'inline-html', source: text })
    return
  }
  const previous = segments.at(-1)
  if (previous?.kind === 'markdown') {
    segments[segments.length - 1] = { kind: 'markdown', text: previous.text + text }
    return
  }
  segments.push({ kind: 'markdown', text })
}

/**
 * 把 display 替换后的文本切成有序三段：
 * - ```html 围栏 / 含 doctype·html·head·body 的完整文档 → {kind:'html'}（进 iframe）；
 * - 行首平衡 HTML 块（<div>…</div> 等）→ {kind:'inline-html'}（sanitize 内联）；
 * - 其余散文 → {kind:'markdown'}（MarkdownText）。
 */
export function compileDisplaySegments(value: string): DisplaySegment[] {
  const lines = sourceLines(value)
  const segments: DisplaySegment[] = []
  let cursor = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const opening = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*?)[ \t]*(?:\r\n|\r|\n|$)$/u)
    if (opening === null) continue
    const marker = opening[1]
    if (marker === undefined) continue
    let closingIndex: number | undefined
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const closing = lines[candidate]?.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r\n|\r|\n|$)$/u)
      const closingMarker = closing?.[1]
      if (closingMarker !== undefined && closingMarker[0] === marker[0] && closingMarker.length >= marker.length) {
        closingIndex = candidate
        break
      }
    }
    if (closingIndex === undefined) break
    const closing = lines[closingIndex]
    if (closing === undefined) break
    const source = value.slice(line.end, closing.start)
    if (isFrontendDocument(opening[2] ?? '', source)) {
      appendSegment(segments, value.slice(cursor, line.start))
      segments.push({ kind: 'html', source })
      cursor = closing.end
    }
    index = closingIndex
  }
  appendSegment(segments, value.slice(cursor))
  return segments
}

/**
 * 【L5 2026-09-14】「完整 HTML 文档段是否落 iframe」的决策判据（**纯函数，单源**）。
 *
 * ## 为什么把它抽出来
 * L5 穷举发现：这条决策原为 `RpNativeChat.tsx` 里的一行内联表达式
 * （`const frameRenderOn = thRenderOn && (!streaming || pipeline.th?.allowStreaming === true)`），
 * 而它是**「流式期间 HTML 裸露」那条用户实测缺陷的修复核心**——却**零单测**
 * （被它调用的 `frameFallbackText` 有测试，决策本身没有）。
 * 决策内联在组件里 ⇒ 无法单测（要起 React + 全套 props）。
 *
 * ## 判据（三个门，逐条说明为什么要这么合）
 * - `thRenderOn` 为 false ⇒ **一律不建帧**。这是用户显式关掉的「渲染总开关」
 *   （关 = 全退纯文本，用户已知代价）。
 * - 非流式（定稿）⇒ **一律建帧**。定稿后内容不再增长，建帧不会被反复驱逐。
 * - 流式中 ⇒ 仅当卡显式允许（`allowStreaming === true`）才建帧。
 *   为什么默认不建：内容每增长一次 frameKey 就变一次，会疯狂驱逐/重执行卡脚本
 *   —— TH 默认 `allowStreaming=false` 正是规避这个。
 *
 * 判据签名用**三个原始值**而非对象，是为了让调用点无法「顺手多传一个字段」而让判据漂移。
 */
export function shouldRenderFrame(
  thRenderOn: boolean,
  streaming: boolean,
  allowStreaming: boolean | undefined,
): boolean {
  if (!thRenderOn) return false
  if (!streaming) return true
  return allowStreaming === true
}

/**
 * 【2026-09-14 P1】完整文档段在「不建 iframe」时的回退渲染形态：包成 HTML 围栏代码块。
 *
 * 用途：流式生成期间（且用户未开 `allowStreaming`）内容每次增长都会换一次 frameKey，
 * 建 iframe 会疯狂驱逐/重执行卡脚本——此时把文档段降级成代码块显示（**不裸露源码**），
 * 定稿后自动换成真 iframe。
 *
 * 围栏长度自适应：文档里若自带 ```（卡作者把整份 HTML 放进代码围栏很常见），用等长或
 * 更长的围栏包裹，否则提前闭合、后半段又裸露一次。
 */
export function frameFallbackText(source: string): string {
  let longest = 0
  for (const m of source.matchAll(/`{3,}/gu)) longest = Math.max(longest, m[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}html\n${source.trimEnd()}\n${fence}`
}

// ---------------------------------------------------------------------------
// 两趟 display 正则 + 替换产物占位隔离（P0-3）
// ---------------------------------------------------------------------------

export interface DisplayScriptHit {
  readonly id: string
  readonly name: string
  readonly matches: number
}

export interface DisplayRunResult {
  /** 全部替换完成、占位标记统一还原后的文本 */
  readonly text: string
  readonly applied: readonly DisplayScriptHit[]
  readonly warnings: readonly string[]
}

/**
 * 替换产物的占位标记：私用区 U+E000…U+E001 夹一段序号。
 *
 * 为什么用私用区：① 正文里天然不会出现（用户与模型都不会打这两个码位），还原时不可能
 * 误伤真实内容；② 若因 bug 漏还原，私用区字符在字体里无字形、外观是空白，不会像
 * 普通字符那样把内部实现泄露成可见乱码。序号用 `\d+` 以便还原时反查数组下标。
 */
const HANDOFF_MARK_RE = /\uE000DSHT_RP_XFR_(\d+)\uE001/gu

/** 生成第 index 个占位标记（必须与 HANDOFF_MARK_RE 同形） */
function handoffMark(index: number): string {
  return `\uE000DSHT_RP_XFR_${index}\uE001`
}

// ---------------------------------------------------------------------------
// 【第二十三轮 W6】暂存哨兵（fence / segment）—— 与上面 HANDOFF_MARK 同一母题：
// 把正文的一段暂存起来、原位留一个「绝不可能撞车」的标记，扫完再还原。
//
// ## 为什么必须单源（本轮真实缺陷的根因）
// `output-protocol.ts` 与 `unwrapForeignTags` 原先各自硬编码**裸控制字符**哨兵：
//   · 围栏：`\x01F${n}\x01`
//   · 段落：`\x00${n}\x00`
// 而控制字符**可以出现在用户/模型文本里**。实测（真实会话，`<skill_content>` 折叠块）：
// 正文里含字面量 `\x01F0\x01` ⇒ 被围栏还原逻辑消费掉 ⇒ **用户内容凭空消失 8 个字**
// （探针 `ef-compile-parity.mjs` J2 在设备上抓到，`13867 → 13859`）。
// ⇒ 修法：改用与 HANDOFF_MARK 同族的**私用区 + 唯一前缀**写法（正文里天然不会出现），
//   并把生成/还原收成这一处（P-1：同一语义只许一处读法）。
// ---------------------------------------------------------------------------

/** 围栏暂存哨兵（`\uE000DSHT_RP_FENCE_<n>\uE001`） */
const FENCE_MARK_RE = /\uE000DSHT_RP_FENCE_(\d+)\uE001/gu
export function fenceMark(index: number): string {
  return `\uE000DSHT_RP_FENCE_${index}\uE001`
}
/**
 * 还原围栏哨兵。
 *
 * 【第二十三轮 W6 · 第二形态】越界（下标不在 `fences` 内）必须**原样保留**，不能替换成空串。
 * 为什么：正文里理论上可能出现与我方同形的私用区串（虽然罕见，但**不是不可能** ——
 * 用户粘贴、模型复述我方输出、或将来前缀改动冲突）。首版写的是 `?? ''`，于是
 * 「正文里恰好长得像哨兵」的那一段被**静默删除**（实测：测试用例当场抓到
 * `'前后'` —— 内容消失）。这与「裸控制字符被撞车」是**同一族**缺陷的第二种触发路径：
 * ① 哨兵字符可出现在正文（已由私用区解决）② **哨兵下标越界时被当成有效哨兵**。
 * ⇒ 判据：越界即视为「这本来就是我方正文」，原样放回（P-3：不许静默吞内容）。
 */
export function restoreFenceMarks(work: string, fences: readonly string[]): string {
  return work.replace(FENCE_MARK_RE, (m, i: string) => {
    const idx = Number(i)
    return idx >= 0 && idx < fences.length ? (fences[idx] ?? m) : m
  })
}

/** 段落暂存哨兵（`\uE000DSHT_RP_SEG_<n>\uE001`） */
const SEG_MARK_RE = /\uE000DSHT_RP_SEG_(\d+)\uE001/gu
export function segMark(index: number): string {
  return `\uE000DSHT_RP_SEG_${index}\uE001`
}
export function matchSegMarks(work: string): RegExpExecArray[] {
  SEG_MARK_RE.lastIndex = 0
  return [...work.matchAll(SEG_MARK_RE)] as RegExpExecArray[]
}
/** 按序号还原段落哨兵（`resolve` 返回该序号对应的替换文本；**返回 null 表示越界 ⇒ 原样保留**） */
export function restoreSegMarks(work: string, resolve: (index: number) => string | null): string {
  return work.replace(SEG_MARK_RE, (m, i: string) => resolve(Number(i)) ?? m)
}


/** ST 字面量剥壳（/pattern/flags；flags 并入，g/m 为基线）—— 与 regex/engine.ts 同款 */
function compileScriptRegex(findRegex: string): RegExp | null {
  const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(findRegex)
  let source = findRegex
  let flags = 'gm'
  if (literal !== null && literal[1].length > 0) {
    source = literal[1]
    const extra = literal[2].replace(/[^gimsuy]/g, '')
    flags = Array.from(new Set('gm' + extra)).join('')
  }
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * 求值一条 `replaceString`（ST/TT 的替换串语法）。
 *
 * 这里用**单趟扫描**而不是「多次 replace 叠加」：叠加式必须严格安排替换顺序（先
 * `{{match}}` 再 `$N`，否则上一步产出的文本会被下一步二次解释），且每步都要重扫整串；
 * 单趟扫描一次定位、一次求值，顺序问题自然消失，也不会把上一步的产出再解释一遍。
 *
 * 支持的引用：`{{match}}`（大小写不敏感）→ 整个匹配；`$0` → 整个匹配；
 * `$1`…`$99` → 捕获组；`$<name>` → 具名捕获组（未命中按 ST 语义给空串）；
 * 其余 `$` 原样保留。
 *
 * `trimStrings` 只作用于**捕获内容**（基准 filterString 的语义），不削替换串里用户
 * 字面写的标记——后者会把用户想保留的字符一并删掉。
 *
 * 【TT 对照 2026-09-09】正则无捕获组时 `$N` = 整个 match（ST/TT 行为）。原实现返回
 * 字面 token：`<interactive_input>$1</interactive_input>` 类规则会把用户消息毁成
 * 字面 `$1` 残留（实测发送内容错误）。
 */
function buildReplacement(
  script: RegexScript,
  match: string,
  captures: readonly string[],
  named: Record<string, string | undefined> | null,
): string {
  const filterTrim = (value: string): string => {
    let out = value
    for (const t of script.trimStrings) {
      if (t === '') continue
      out = out.split(t).join('')
    }
    return out
  }
  /** 取第 n 组：0 = 整个匹配；越界返回 null（调用方决定是回退还是原样保留） */
  const captureAt = (n: number): string | null => {
    if (n === 0) return match
    if (n >= 1 && n <= captures.length) return captures[n - 1] ?? ''
    return null
  }

  const src = script.replaceString
  const MATCH_REF = /^\{\{match\}\}/iu
  const NAMED_REF = /^\$<([A-Za-z_$][\w$]*)>/
  const NUMBER_REF = /^\$(\d{1,2})/
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '$') {
      const rest = src.slice(i)
      const ng = NAMED_REF.exec(rest)
      if (ng !== null) {
        const v = named === null ? undefined : named[ng[1] ?? '']
        out += v === undefined ? '' : filterTrim(v)
        i += ng[0].length
        continue
      }
      const num = NUMBER_REF.exec(rest)
      if (num !== null) {
        const digits = num[1] ?? ''
        const exact = captureAt(Number(digits))
        if (exact !== null) {
          out += filterTrim(exact)
          i += num[0].length
          continue
        }
        if (digits.length === 2) {
          // `$12` 而只有 1 组：按 ST 语义拆成 `$1` + 字面 '2'。
          // 注意**只 trim 捕获内容**，尾部那个字面数字是被拆出来的原字符，不参与 trim
          //（否则 trimStrings 含该数字时会把用户写的东西吃掉）。
          const head = captureAt(Number(digits[0]))
          if (head !== null) {
            out += filterTrim(head) + digits[1]
            i += num[0].length
            continue
          }
        }
        // 无捕获组 ⇒ $N = 整个 match（ST/TT 行为）；有组但越界 ⇒ 原样保留
        out += captures.length === 0 ? filterTrim(match) : num[0]
        i += num[0].length
        continue
      }
      out += ch
      i += 1
      continue
    }
    if (ch === '{') {
      const m = MATCH_REF.exec(src.slice(i))
      if (m !== null) { out += filterTrim(match); i += m[0].length; continue }
    }
    out += ch
    i += 1
  }
  return out
}

/** depth 过滤（现在透传真实消息深度，条目自身 minDepth/maxDepth 生效；null = 不过滤） */
function inDepth(script: RegexScript, depth: number | null): boolean {
  if (depth === null) return true
  if (script.minDepth != null && depth < script.minDepth) return false
  if (script.maxDepth != null && depth > script.maxDepth) return false
  return true
}

/**
 * display 视图的两趟执行（P0-3）：
 * 1. 先跑通用脚本（!markdownOnly && !promptOnly）；
 * 2. 再跑 markdownOnly（仅显示）专属脚本——两趟内脚本各自保持数组顺序。
 *
 * 每个替换产物先存进数组、正文只留占位标记（见 HANDOFF_MARK_RE 注释），两趟全部跑完
 * 再统一还原。这样后续正则面对的是「纯正文 + 不可见占位符」，不会把前一个正则产出的
 * HTML 标记当正文二次加工。
 *
 * 防空白守卫：整轮正文被替换光则回退原文（不报 applied），避免用户看到空白楼层。
 */
export function runDisplayScripts(
  scripts: readonly RegexScript[],
  source: string,
  depth: number | null,
): DisplayRunResult {
  const pending: string[] = []
  const applied: DisplayScriptHit[] = []
  const warnings: string[] = []
  let text = source

  // 两趟：pass 0 = 通用，pass 1 = markdownOnly 专属
  const passes: ReadonlyArray<(script: RegexScript) => boolean> = [
    script => !script.markdownOnly && !script.promptOnly,
    script => script.markdownOnly,
  ]
  for (const inPass of passes) {
    for (const [index, script] of scripts.entries()) {
      if (script.disabled || !inPass(script)) continue
      // display 渲染消费 placement 1/2/3（AI_OUTPUT 仅显示脚本也跑）
      if (!script.placement.some(p => p === 1 || p === 2 || p === 3)) continue
      if (!inDepth(script, depth)) continue
      const regex = compileScriptRegex(script.findRegex)
      const label = script.scriptName || script.id || `正则 ${index + 1}`
      if (regex === null) {
        warnings.push(`${label}：无效正则，已跳过`)
        continue
      }
      let matches = 0
      const next = text.replace(regex, (match: string, ...args: unknown[]) => {
        // 末两项（有具名组时是三项）是 offset/整串 或 groups/offset/整串
        const last = args.at(-1)
        const hasGroups = typeof last === 'object' && last !== null
        const tail = hasGroups ? 3 : 2
        const named = hasGroups ? (last as Record<string, string | undefined>) : null
        const captures = args.slice(0, args.length - tail)
          .map(value => (typeof value === 'string' ? value : ''))
        matches += 1
        const replacement = buildReplacement(script, match, captures, named)
        const mark = handoffMark(pending.length)
        pending.push(replacement)
        return mark
      })
      if (matches === 0) continue
      text = next
      applied.push({ id: script.id, name: label, matches })
    }
  }

  const restored = text.replace(HANDOFF_MARK_RE, (_mark, digits: string) => pending[Number(digits)] ?? '')

  // 防空白守卫：整轮正文被替换清空 → 回退原文（不报 applied）
  if (applied.length > 0 && source.trim() !== '' && restored.trim() === '') {
    warnings.push('display 正则覆盖了整轮正文，已回退原文')
    return { text: source, applied: [], warnings }
  }
  return { text: restored, applied, warnings }
}

// ---------------------------------------------------------------------------
// iframe 文档骨架
// ---------------------------------------------------------------------------

export const FRAME_MAX_HEIGHT = 3000
export const FRAME_MIN_HEIGHT = 48

/** 高度取值收敛到 [MIN, MAX]。
 *  【2026-09-09 抖动修复】MAX 曾是 12000（桌面参考值）——手机视口 ~850px 时 12000 ≈ 14 屏，
 *  且帧内文档若用 vh/百分比布局，高度上报会形成反馈循环（iframe 变高 → vh 值变 →
 *  内容变高 → 再上报）一路爬到顶格，表现为「画面跳来跳去」。降到 3000（≈3.5 屏）封顶后
 *  循环快速收敛到 mount 容器内部滚动（height≥MAX 时 overflow:auto），正常内容（状态栏
 *  ~500px、思维链折叠 ~200px）不受影响；超长文档帧内部滚动可接受。 */
export function clampFrameHeight(value: number): number {
  return Math.max(FRAME_MIN_HEIGHT, Math.min(FRAME_MAX_HEIGHT, Math.ceil(Number(value) || FRAME_MIN_HEIGHT)))
}

/** 【审计 C 类 2026-09-08】帧内遮挡自检 lint（v2 可重跑）：卡自建 HTML 常有静态文本块
 *  盖住控件中心（程序化 click 有效、真实触摸被吞——示例游戏 NPC 性别卡实证，同卡跨会话
 *  复现）。v1 一次性快照会滞留误标（卡内交互/级联展开改变布局后标记不更新——第二轮
 *  审计实证 7/2/4/5 波动）。v2：每次先清全部旧标记再重算（可增可删），MutationObserver
 *  防抖 800ms 增量重跑。只标记不改布局（不破坏卡设计；自动化 probe 可据此统计）。 */
function occlusionLintScript(): string {
  return '<script data-dsht-rp-occlusion-lint>(function(){'
    + 'function lint(){'
    + 'var old=document.querySelectorAll("[data-dsht-occluded],[data-dsht-occluder]");'
    + 'for(var k=0;k<old.length;k++){old[k].removeAttribute("data-dsht-occluded");old[k].removeAttribute("data-dsht-occluder");}'
    + 'var els=document.querySelectorAll("button,input,select,textarea,a[href],[role=button],[onclick]");'
    + 'for(var i=0;i<els.length;i++){var el=els[i];'
    + 'var r=el.getBoundingClientRect();if(r.width<4||r.height<4)continue;'
    + 'var style;try{style=getComputedStyle(el);}catch(e){continue;}'
    + 'if(style.pointerEvents==="none"||style.visibility==="hidden"||style.display==="none")continue;'
    + 'var hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);'
    + 'if(!hit||hit===el||el.contains(hit)||hit.contains(el))continue;'
    + 'try{hit.setAttribute("data-dsht-occluder","1");el.setAttribute("data-dsht-occluded","1");}catch(e){}'
    + 'console.info("[dsht-rp] 交互元素中心被遮挡（触摸可能无响应）: <"+(el.tagName||"元素")+"> <- <"+((hit.className&&String(hit.className).slice(0,40))||hit.tagName)+">");}'
    + '}'
    + 'var lintTimer=null;'
    + 'function scheduleLint(){if(lintTimer)return;lintTimer=setTimeout(function(){lintTimer=null;lint();},800);}'
    + 'if(document.readyState==="complete"){setTimeout(lint,600);}else{addEventListener("load",function(){setTimeout(lint,600);});}'
    + 'new MutationObserver(scheduleLint).observe(document.documentElement,{subtree:true,childList:true});'
    + '})();<\/script>'
}

/** iframe 内高度上报脚本：ResizeObserver / load / 字体就绪 / DOM 变更 四路触发，
 *  量到「正文真实底边」（fixed 部件与零尺寸元素不计入）后 postMessage 给宿主。
 *
 *  为什么这么算底边：卡前端部件里常有 `position:fixed` 的悬浮球/贴边面板——它们的
 *  rect 与文档流无关，计进高度会让 iframe 无意义地长高。故逐节点取 bottom 时先跳过
 *  fixed/隐藏/零尺寸，并在遇到 overflow 非 visible 的祖先时用祖先 rect 夹逼。 */
function heightReporterScript(tokenJson: string): string {
  // 【L2 2026-09-14 逐帧全量遍历修复】原实现只有「rAF 合并 + 同值去重」，**没有时间窗节流**：
  //   · MutationObserver 监听 attributes + characterData（卡内任何样式/文本变化都触发）；
  //   · 每次 report 的 measure() 对 body **全量子树**逐个 getBoundingClientRect +
  //     getComputedStyle + 祖先链遍历（O(节点数 × 祖先深度)，getComputedStyle 会强制样式计算）。
  // 后果：节点数千或卡内有 CSS 动画/定时改 style 时 ⇒ 每帧全量扫描，主线程持续高占用。
  // （L2 穷举实测的结论，非猜测；判据见 docs/MOBILE-TEST-METHODOLOGY.md §二 L2 第 5 项。）
  //
  // 修法：加**最小上报间隔**（MIN_INTERVAL_MS）。rAF 合并保留（同帧多次触发只算一次），
  // 但两次**实际 measure** 之间至少间隔该时长 ⇒ 上限约 1/间隔 次/秒。
  // 间隔取 100ms（10 次/秒）：远高于肉眼可感知的「帧高变化」频率，又比每帧（~60 次/秒）
  // 低一个数量级。**不丢变化**：节流窗口内的触发会排一个定时器补报，
  // 因此「连打一串 DOM 变化」最终仍会落到最后一个真实高度（不会停在中间态）。
  const MIN_INTERVAL_MS = 100
  return '<script data-dsht-rp-frame>(function(){var token=' + tokenJson + ';var last=0;var queued=false;'
    + 'var lastAt=0;var timer=null;var MIN=' + MIN_INTERVAL_MS + ';'
    + 'function nodeBottom(node){if(!node||typeof node.getBoundingClientRect!=="function")return 0;var style;'
    + 'try{style=getComputedStyle(node);}catch(e){return 0;}'
    + 'if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed")return 0;'
    + 'var rect=node.getBoundingClientRect();if(rect.width===0&&rect.height===0)return 0;'
    + 'var top=rect.top,bottom=rect.bottom;var ancestor=node.parentElement;'
    + 'while(ancestor&&ancestor!==document.documentElement){var ancestorStyle;'
    + 'try{ancestorStyle=getComputedStyle(ancestor);}catch(e){ancestorStyle=null;}'
    + 'var overflow=String(ancestorStyle&&(ancestorStyle.overflowY||ancestorStyle.overflow)||"visible");'
    + 'if(overflow!=="visible"){var ancestorRect=ancestor.getBoundingClientRect();'
    + 'top=Math.max(top,ancestorRect.top);bottom=Math.min(bottom,ancestorRect.bottom);if(bottom<=top)return 0;}'
    + 'ancestor=ancestor.parentElement;}return Math.ceil(bottom+(window.scrollY||0));}'
    + 'function measure(){var body=document.body;if(!body)return 48;'
    + 'var bodyRect=body.getBoundingClientRect();'
    + 'var height=Math.max(body.scrollHeight||0,Math.ceil(bodyRect.bottom+(window.scrollY||0)),48);'
    + 'var nodes=[body].concat(Array.prototype.slice.call(body.querySelectorAll("*")));'
    + 'for(var i=0;i<nodes.length;i+=1)height=Math.max(height,nodeBottom(nodes[i]));return height;}'
    + 'function report(){queued=false;if(timer!==null){clearTimeout(timer);timer=null;}'
    + 'lastAt=(typeof performance!=="undefined"&&performance.now)?performance.now():Date.now();'
    + 'var height=measure();if(height===last)return;last=height;'
    + 'parent.postMessage({type:"dsht-rp-frame-height",token:token,height:height},"*");}'
    // 节流：距上次实际上报不足 MIN 时，排一个定时器补报（**不丢最后一次变化**）
    + 'function schedule(){if(queued)return;queued=true;'
    + 'var now=(typeof performance!=="undefined"&&performance.now)?performance.now():Date.now();'
    + 'var wait=MIN-(now-lastAt);'
    + 'if(wait<=0){if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else setTimeout(report,0);return;}'
    + 'if(timer===null){timer=setTimeout(function(){timer=null;'
    + 'if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else report();},wait);}}'
    + 'if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(schedule);'
    + 'observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}'
    + 'addEventListener("load",schedule);'
    + 'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);'
    + 'new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});'
    + 'schedule();})();<\/script>'
}

/** iframe 消息类型常量（宿主侧 message 校验用） */
export const FRAME_HEIGHT_MESSAGE_TYPE = 'dsht-rp-frame-height'

/**
 * 组装 iframe srcdoc：
 * - 完整文档段（含 doctype/html）：只把上报脚本注入 `</body>` 前，保留文档自身结构；
 * - HTML 片段：包进带 CSP 与基础样式的文档骨架。
 * sandbox 允许项由**组件侧**声明（本函数只组装 srcdoc，不设 sandbox）；实际值见
 * `RpNativeChat.tsx` 的 `el.setAttribute('sandbox', …)` —— 含 allow-same-origin。
 * 【2026-09-14 L5 穷举】原注释写「不给 allow-same-origin」，与实现矛盾（卡自带
 * `<script>` 依赖 parent.$/Mvu，必须同源，见 RpScriptHost/RpNativeChat 两处注释）。
 */
export function buildDisplayFrameDocument(source: string, token: string): string {
  const tokenJson = JSON.stringify(String(token)).replace(/</gu, '\\u003c')
  const reporter = heightReporterScript(tokenJson) + occlusionLintScript()
  if (/<!doctype\s+html\b|<html(?:\s|>)/iu.test(source)) {
    return /<\/body\s*>/iu.test(source)
      ? source.replace(/<\/body\s*>/iu, `${reporter}</body>`)
      : source + reporter
  }
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="referrer" content="no-referrer">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src https: data: blob:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; style-src \'unsafe-inline\' https:; script-src \'unsafe-inline\' \'unsafe-eval\' https: data: blob:; connect-src https: wss: data: blob:; frame-src https: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
    + '<style>:root{color-scheme:light dark}html,body{box-sizing:border-box;margin:0;min-height:0;background:transparent;color:CanvasText;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.75;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{padding:0 1px;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,video,svg,canvas{max-width:100%;height:auto}pre{max-width:100%;overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}a{color:LinkText}</style>'
    + `</head><body>${source}${reporter}</body></html>`
}

// ---------------------------------------------------------------------------
// 显示期数据面（I4 宏上下文 / B6 render-entries / B8 永久写回 / C3 TH 渲染组设置）
// 全部模块级 5s TTL 缓存——窗口化滚动回渲/流式重排不重复拉取；失败静默透传
// （宏不展开、包裹不拼、写回不发——数据面不可达只降级，不阻塞渲染）。
// ---------------------------------------------------------------------------

export { expandDisplayMacros }
export type { DisplayMacroCtx }

/** 缓存 TTL（任务定案：5s——渲染期高频重入，长 TTL 会拖住设置改动生效） */
const DISPLAY_DATA_TTL = 5000

/** 【T-34 2026-09-11 修复】原为 `{ at: number; value: Promise<T> }`，但 4 处调用点
 *  全部写成 `TimedCache<Promise<X>>`（缓存的是**待决 Promise 本身**，用于并发去重）→
 *  实际值是 `Promise<Promise<X>>`，与声明不符（TS2322 四处）。把 `value` 的类型参数
 *  去掉一层包装即与全部调用点一致；语义不变（仍是「TTL 内复用同一个 Promise」）。 */
interface TimedCache<T> { at: number; value: T }

/** GET 数据面（/dsht-mvu、/dsht-prompt-template 的查询串路由；失败抛错由调用方兜底） */
async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { method: 'GET' })
  if (!resp.ok) throw new Error(`GET ${url}: HTTP ${resp.status}`)
  return await resp.json() as T
}

/** POST 数据面（/dsht-rp 前缀在 GET 分支后有 POST-only 门——带查询串 POST 同样可路由，
 *  服务端从 req.url 读 query 与方法无关；body 恒 {} 满足 JSON 解析门） */
async function postJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!resp.ok) throw new Error(`POST ${url}: HTTP ${resp.status}`)
  return await resp.json() as T
}

// ---- I4：身份 + 变量（宏展开数据源；每 slug::session 5s TTL）----

/** 【审查修复 2026-09-05】缓存键带 slug::sessionId——单槽无键会 5s 内切会话串数据 */
const renderCtxCacheMap = new Map<string, TimedCache<Promise<DisplayMacroCtx | null>>>()

/** 【鲁棒轮 2026-09-09】display 数据面缓存清除（Kemini 开关链）：脚本 replaceTavernRegexes/
 *  updatePresetWith 后 notifyDisplayMutation 调用——不清的话 epoch 重跑在 5s TTL 窗口内
 *  仍拿旧 ctx/entries，「切了没反应」在窗口期内复发。 */
export function invalidateDisplayDataCache(): void {
  renderCtxCacheMap.clear()
  renderEntriesCache.clear()
}

/** 加载显示期宏上下文（identity + variables 并行；任一失败 → null = 原文透传） */
export function loadDisplayRenderCtx(slug: string, sessionId: string): Promise<DisplayMacroCtx | null> {
  const now = Date.now()
  const key = `${slug}::${sessionId}`
  const cached = renderCtxCacheMap.get(key)
  if (cached !== undefined && now - cached.at < DISPLAY_DATA_TTL) return cached.value
  const value = (async (): Promise<DisplayMacroCtx | null> => {
    try {
      const [identity, vars, macros] = await Promise.all([
        postJson<{ user?: unknown; char?: unknown; persona?: unknown }>(`/dsht-rp/rp/identity?slug=${encodeURIComponent(slug)}`),
        getJson<{ variables?: Record<string, unknown> }>(`/dsht-mvu/variables?sessionId=${encodeURIComponent(sessionId)}`),
        // L1b：自定义宏水合（显示期与服务端注册表同源；失败静默——无自定义宏是常态）
        postJson<{ macros?: Record<string, string> }>(`/dsht-rp/macros/list`).catch(() => ({ macros: {} })),
      ])
      return {
        user: typeof identity.user === 'string' && identity.user ? identity.user : '用户',
        char: typeof identity.char === 'string' && identity.char ? identity.char : '角色',
        persona: typeof identity.persona === 'string' ? identity.persona : '',
        variables: vars.variables ?? {},
        customMacros: macros.macros ?? {},
      }
    } catch {
      return null // 拉取失败静默透传（宏保持原文）
    }
  })()
  renderCtxCacheMap.set(key, { at: now, value })
  return value
}

// ---- B6：[RENDER:BEFORE/AFTER] 条目求值结果（每 slug::session 5s TTL）----

export interface RenderEntries { before: string; after: string }

const EMPTY_ENTRIES: RenderEntries = { before: '', after: '' }
const renderEntriesCache = new Map<string, TimedCache<Promise<RenderEntries>>>()

/** 加载 [RENDER] 包裹（失败透传空 = 不包裹；是否启用由 ejs renderLoaderEnabled 在消费端裁决） */
export function loadRenderEntries(slug: string, sessionId: string): Promise<RenderEntries> {
  const key = `${slug}::${sessionId}`
  const now = Date.now()
  const cached = renderEntriesCache.get(key)
  if (cached !== undefined && now - cached.at < DISPLAY_DATA_TTL) return cached.value
  const value = postJson<{ before?: unknown; after?: unknown }>(
    `/dsht-prompt-template/render-entries?slug=${encodeURIComponent(slug)}&sessionId=${encodeURIComponent(sessionId)}`,
  )
    .then(r => ({
      before: typeof r.before === 'string' ? r.before : '',
      after: typeof r.after === 'string' ? r.after : '',
    }))
    .catch(() => EMPTY_ENTRIES)
  if (renderEntriesCache.size > 4) renderEntriesCache.clear() // 渲染期单会话，双槽即够；防爆涨
  renderEntriesCache.set(key, { at: now, value })
  return value
}

// ---- EJS 设置（B6 renderLoader / B8 permanentEvaluation / B17 codeEditor 消费）----

export interface EjsDisplaySettings {
  /** 扩展总开关（enabled=false 时 B6/B8 都不生效） */
  enabled: boolean
  /** [RENDER] 特性（B6 包裹） */
  renderLoaderEnabled: boolean
  /** 处理原始消息内容（B8 客户端写回） */
  permanentEvaluation: boolean
  /** 世界书代码编辑器（B17 RpLorePanel 轻量编辑器） */
  codeEditor: boolean
}

let ejsSettingsCache: TimedCache<Promise<EjsDisplaySettings | null>> | null = null

/** 加载 EJS 设置（GET /dsht-prompt-template/settings；失败 → null = 调用方按关闭处理） */
export function loadEjsDisplaySettings(): Promise<EjsDisplaySettings | null> {
  const now = Date.now()
  if (ejsSettingsCache !== null && now - ejsSettingsCache.at < DISPLAY_DATA_TTL) return ejsSettingsCache.value
  const value = getJson<Record<string, unknown>>('/dsht-prompt-template/settings')
    .then(raw => ({
      enabled: raw.enabled !== false,
      renderLoaderEnabled: raw.renderLoaderEnabled === true,
      permanentEvaluation: raw.permanentEvaluation === true,
      codeEditor: raw.codeEditor === true,
    }))
    .catch(() => null)
  ejsSettingsCache = { at: now, value }
  return value
}

// ---- C3：TH 渲染组设置（渲染 7 项的消费面）----

export interface ThRenderSettings {
  /** 启用渲染（false = 前端 HTML/B6 包裹退纯文本；正则/宏各自独立不受它管） */
  enabled: boolean
  /** 渲染深度：仅处理楼层深度 ≤ 此值的楼层（0 = 仅最新楼层；数据面不可达按 -1 不降级） */
  depth: number
  /** 深度计算忽略隐藏楼层（回退掩码剔除） */
  depthIgnoreHidden: boolean
  /** 折叠代码块：all/frontend_only 折叠（本管线前端围栏走 iframe，两者 DOM 面一致），none 不折叠 */
  collapseCodeBlock: 'all' | 'frontend_only' | 'none'
  /** 允许流式渲染（false = 流式期间不出 iframe 段，定稿后再渲染） */
  allowStreaming: boolean
  /** Blob URL 渲染（iframe 用 blob: 而非 srcdoc） */
  useBlobUrl: boolean
  /** 优化代码高亮（对 <pre> 做轻量关键字高亮；宿主 MarkdownText 无 hljs，由本管线补） */
  optimizeHljs: boolean
}

let thRenderCache: TimedCache<Promise<ThRenderSettings | null>> | null = null

/** 加载 TH 渲染组设置（GET /dsht-tavern-helper/settings；失败 → null = 调用方按全开/不限处理） */
export function loadThRenderSettings(): Promise<ThRenderSettings | null> {
  const now = Date.now()
  if (thRenderCache !== null && now - thRenderCache.at < DISPLAY_DATA_TTL) return thRenderCache.value
  const value = getJson<{ render?: Record<string, unknown> }>('/dsht-tavern-helper/settings')
    .then(raw => {
      const r = raw.render ?? {}
      const collapse = r.collapseCodeBlock
      return {
        enabled: r.enabled !== false,
        depth: typeof r.depth === 'number' && Number.isFinite(r.depth) ? r.depth : 0,
        depthIgnoreHidden: r.depthIgnoreHidden === true,
        collapseCodeBlock: collapse === 'all' || collapse === 'none' ? collapse : 'frontend_only',
        allowStreaming: r.allowStreaming === true,
        useBlobUrl: r.useBlobUrl === true,
        optimizeHljs: r.optimizeHljs !== false,
      } satisfies ThRenderSettings
    })
    .catch(() => null)
  thRenderCache = { at: now, value }
  return value
}

// ---- B8：客户端永久写回（模块级去重 Set；失败 warn 一次不重试）----

const permanentWritten = new Set<string>()

/**
 * B8 写回：渲染成功且宏展开确有变化的 assistant 楼层，把展开结果写回会话
 * （POST /dsht-prompt-template/permanent {sessionId, seq, text}；服务端 replace
 * 原语 + ejsProcessed 标记）。按 sessionId::seq 幂等去重——重渲染不重发；
 * 失败 console.warn 一次（Set 已占位，不重试不刷屏）。
 */
export function reportPermanentRender(sessionId: string, seq: number, text: string): void {
  const key = `${sessionId}::${seq}`
  if (permanentWritten.has(key)) return
  permanentWritten.add(key)
  if (permanentWritten.size > 512) permanentWritten.clear() // 防泄漏（丢位最多多发一次；幂等由服务端 ejsProcessed 兜底）
  void fetch('/dsht-prompt-template/permanent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, seq, text }),
  }).then(async r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  }).catch(e => {
    console.warn(`[dsht-rp] B8 永久写回失败（seq=${seq}）:`, (e as Error).message)
  })
}

// ---------------------------------------------------------------------------
// C3：<pre> DOM 增强（collapse_code_block 折叠 + optimize_hljs 轻量高亮）
// 宿主 MarkdownText 产物（React 管 DOM）：只加 class/data 标记与一次性 innerHTML，
// 节点被 React 重建时 dataset 丢失 → 消费端 effect 重跑自然补齐（幂等）。
// ---------------------------------------------------------------------------

/** 高亮词表（轻量面：字符串/注释/数字/常用关键字——不做逐语言文法，移动端性能优先） */
const PRE_HL_RE = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(function|return|if|else|for|while|const|let|var|class|new|await|async|import|export|from|of|in|try|catch|finally|throw|switch|case|break|continue|true|false|null|undefined|def|end|do|then|elif|fi|local|nil|echo|fn|pub|use|match)\b/g
// 注：W24 起不再需要 `escapePreHtml` —— 高亮改为**纯 DOM 构建**（createTextNode/createElement），
// 文本永不经过 HTML 字符串 ⇒ 既无「销毁子节点」语义（R19），也不存在注入面。见 highlightPreCode。

/**
 * 轻量关键字高亮（textContent → 分组着色；空块/>50KB/已高亮跳过）
 *
 * ## 【W24 2026-09-15 R19 合规修复】为什么不能再写 `code.innerHTML = html`
 *
 * `code` **是宿主 `MarkdownText`（React）渲染出来的 `<code>` 元素**（见本文件
 * `enhancePreBlocks` 的调用点：`root = .dsht-rp-assistant-body`，即宿主插槽子树内；
 * 文件头注亦自承「宿主 MarkdownText 产物（React 管 DOM）」）。
 * 而 `innerHTML = …` **无条件销毁该元素的全部既有子节点** —— 与 F2 事故的
 * `replaceChild` **在这一点上逐字等价**：
 *   · 等价性已在设备上实测确认（控制变量实验）：两种写法执行后「旧子节点一律不再是
 *     该元素的 child」（`equivalent: true`）⇒ 对 React 而言**引用一样会悬空**
 *   · R19（由 F2 事故固化的纪律）明文要求：在宿主渲染产物内做 DOM 增强**只能新增节点 +
 *     改属性 + 清空文本**，**不得替换/删除 React 持有的节点**
 *
 * ## 诚实边界（为什么它至今没炸，以及为什么仍必须修）
 * 实测（v354 设备，`st-n0gnfp` 等）**未**观测到本条导致的 slot 崩溃
 * （`.dsht-rp-assistant` 存活 50/50，logcat 无 `slot entry crashed`）。
 * 最可能的解释：`<code>` 的 children 是**单个文本节点**，React 对该形态走
 * `setTextContent` 快路径（不像 F2 的 `<p>` 那样持有多子节点引用）。
 * ⇒ 但这只是**当前语料 / 当前宿主渲染器版本下的侥幸**，不是契约：
 *   ① 宿主渲染器换一版、或 `<code>` 内容因行内标记变成多子节点，引用立刻悬空；
 *   ② **判据本身测不出**：本轮实测抽样卡上「含可高亮内容的 `<pre>`」= **0 个**
 *      ⇒ 该路径根本没被触发 —— 「没测到」**不能**读成「安全」（P-17）。
 * ⇒ 按 R19 的字面纪律修掉；修后**行为等价**（见下），零回归面。
 *
 * ## 修法（与 st-quotes 同款：**纯 DOM 构建** + 保住 React 的节点）
 *   ① 用 `createTextNode` / `createElement` 直接构建高亮片段（**完全不经过 HTML 字符串**
 *      ⇒ 既没有「销毁」语义，也不存在注入面，`escapePreHtml` 随之不再需要）
 *   ② `code.insertBefore(frag, 原首子节点)` —— 插到 React 文本节点**之前**
 *   ③ 把原文本节点**清空**（`nodeValue = ''`）而不是删掉它（R19 的关键）
 * ⇒ 视觉等价：span 承载全部文本，原文本节点变空但**仍在**（React 仍能按引用找到并操作它）。
 *   React 若把内容回写到该文本节点，下一轮 `enhancePreBlocks` 的幂等口径
 *   （见 `prev`-style 检查：已存在 `span[data-dsht-hl]` 即整块跳过）保证不会重复包裹。
 *
 * ## 【W24b 2026-09-16】首版丢了幂等 ⇒ 节点单调累积（**本轮引入，设备实测抓到**）
 *
 * 首版的唯一幂等标记是「已存在 `span[data-dsht-hl]` 就整块跳过」。而**当 <pre> 里
 * 没有任何可高亮 token 时**（纯中文说明 / 无关键字的日志），片段里**一个 span 都没有**
 * ⇒ 该守卫**恒不命中** ⇒ 每调用一次就 `insertBefore` 一个多余的纯文本节点（内容与原
 * 文本节点重复）⇒ **节点数单调增长**。
 *
 * ## 症状（设备实测）
 * M7 旅程在首卡 `st-n0gnfp` 的 J4 之后**永久挂起**：`ef-journey-all.mjs:170` 的
 * `send()` **没有超时** ⇒ 一旦挂住就永不返回、永不报错、永不落日志、不退出。
 * 同期取证：iframe 渲染进程（`sandboxed_process0`）CPU 持续 **90~116%**；
 * 而**重启 App 后未做任何交互**时 CDP 能应答（`1+1` 85ms）⇒ 页面不是死锁，
 * 是**主线程被持续占满**（DOM 累积 → 布局变重 → 每次 `enhancePreBlocks` 更慢；
 * 且 `RpNativeChat.tsx` 的 `MutationObserver{childList,subtree,characterData}` 会
 * 被每次插入触发 → rAF 里 `wrapStQuotes` 全树 TreeWalker 重扫 ⇒ 正反馈）。
 *
 * ## 决定性实验（离线，`tmp/diag-hl-idempotent.mjs`，四组对照）
 * ```
 * A. 无 token 的 <pre><code>：1 次调用 childNodes 1→2；10 次后 →11   ✗ 不幂等
 * B. 有 token 的 <pre><code>：1 次后 10；10 次后仍 10                ✓ 幂等（span 守卫命中）
 * C. 同族对照 wrapStQuotes 无引号：1 → 1                            ✓ 零 DOM 变更
 * D. 混合场景：无 token 块同样 1→11                                 ✗ 不幂等
 * ```
 * 对照组 C 是**同一批次上线、M7 上轮无异常**的同族实现 —— 它的形态正是缺的那一步：
 * 无匹配时 `if (!wrapped) continue`（**零 DOM 变更**）。
 *
 * ## 修法（对齐 C 的形态）
 * 循环里记录 `matched`；**无 token ⇒ 直接 return，一个节点都不插**
 * （原实现会插入「等于原文的纯文本节点」——既无视觉收益，又破坏幂等）。
 * 有 token 时行为与首版逐字相同（span 守卫照常生效）。
 */
function highlightPreCode(pre: HTMLElement): void {
  const code = pre.querySelector('code') ?? pre
  if (code.querySelector('span[data-dsht-hl]') !== null) return
  const raw = code.textContent ?? ''
  if (raw.length === 0 || raw.length > 50_000) return
  const frag = document.createDocumentFragment()
  let cursor = 0
  let matched = false
  PRE_HL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PRE_HL_RE.exec(raw)) !== null) {
    matched = true
    if (match.index > cursor) frag.appendChild(document.createTextNode(raw.slice(cursor, match.index)))
    const kind = match[1] !== undefined ? 'str' : match[2] !== undefined ? 'com' : match[3] !== undefined ? 'num' : 'kw'
    const span = document.createElement('span')
    span.setAttribute('data-dsht-hl', kind)
    span.textContent = match[0]
    frag.appendChild(span)
    cursor = match.index + match[0].length
  }
  PRE_HL_RE.lastIndex = 0
  // ★ W24b：无可高亮 token ⇒ **零 DOM 变更**（否则插入的节点无 span 标记 ⇒ 幂等守卫
  //   恒不命中 ⇒ 每次调用都多一批节点）。与同族 wrapStQuotes 的 `if (!wrapped) continue` 同形态。
  if (!matched) return
  if (cursor < raw.length) frag.appendChild(document.createTextNode(raw.slice(cursor)))
  // ---- R19：只新增 + 清空，不销毁 React 的节点 ----
  const textNodes = Array.from(code.childNodes).filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
  const anchor = code.firstChild
  if (anchor !== null) code.insertBefore(frag, anchor)
  else code.appendChild(frag)
  for (const t of textNodes) t.nodeValue = ''
}

/** 折叠 Armed：<pre> 默认收起（>200px 才值得），点击展开（一次性监听）。
 *  双标记防重入：dsht-pre-collapsible = 已武装（不再重复挂监听）；
 *  dsht-pre-expanded = 用户已展开（增强重跑时不再收回——用户意愿优先）。 */
function armPreCollapse(pre: HTMLElement): void {
  if (pre.classList.contains('dsht-pre-collapsible') || pre.classList.contains('dsht-pre-expanded')) return
  if (pre.scrollHeight <= 200) return
  pre.classList.add('dsht-pre-collapsible', 'dsht-pre-collapsed')
  pre.addEventListener('click', () => {
    pre.classList.remove('dsht-pre-collapsed')
    pre.classList.add('dsht-pre-expanded')
  }, { once: true })
}

export interface PreEnhanceOptions { collapse: boolean; hljs: boolean }

/** 对 root 内全部 <pre> 做一次增强（幂等：highlight 查 span 标记 / collapse 查 class，
 *  不落 dataset——React 重写 children 后高亮标记丢失时能自然补齐） */
export function enhancePreBlocks(root: HTMLElement, opts: PreEnhanceOptions): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (!(pre instanceof HTMLElement)) continue
    if (opts.hljs) highlightPreCode(pre)
    if (opts.collapse) armPreCollapse(pre)
  }
}
