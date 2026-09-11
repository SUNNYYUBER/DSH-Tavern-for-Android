/**
 * display 三段编译 + 两趟 display 正则 + iframe 文档骨架（P0-2 / P0-3，REF_PROJECTS_COMPARISON.md 领域二）。
 *
 * 出处（均为 MIT 许可参考源码，引用处已对照移植）：
 * - 三段编译：dsh-agent-rp `src/card-display-compiler.ts`（compileCharacterDisplay L264、
 *   sourceLines/isFrontendDocument/splitLeadingHtmlBlock/htmlTagsOutsideCode）；
 *   HTML_DISPLAY_TAGS 含 agent-loop-rp 同文件 L35-49 的 SVG 扩展。
 * - 两趟执行：dsh-agent-rp `src/frontend-regex.ts` runScripts L285（先通用
 *   !markdownOnly&&!promptOnly，再 display→markdownOnly 专属）。
 * - 私用区 token 隔离 + 防空白守卫：dsh-tavern `lib/domain/tavern-regex-display.js`
 *   renderTavernRegexDisplay L96-160（presentationParts[] + DSH_TAVERN_REGEX_i token
 *   + 整轮覆盖回退原文 L136-147）。
 * - iframe 文档骨架：dsh-tavern `lib/client.js` buildTavernFrameDocument/clampTavernFrameHeight/
 *   TavernMessageFrame L883-941（高度上报 postMessage + clamp [48,12000]）。
 *
 * 与参考的有意偏差：markdown 段不做未知标签剥离——未知/自定义标签（tip 等）的折叠
 * 兜底归 output-protocol 层单点负责，避免两处语义分叉。
 *
 * 用户痛点根因：悬浮球/剧情按钮/tip 的 display 产出是完整 HTML 片段或文档，
 * 旧链路的 sanitize 白名单直接整体丢弃。三段编译把「完整文档」切进 iframe 舞台
 * （sandbox="allow-scripts"，position:fixed 部件在 iframe 内正常运行）。
 */

import type { RegexScript } from '../../../regex/engine.ts'
import { expandDisplayMacros, type DisplayMacroCtx } from './macros-display.ts'

// ---------------------------------------------------------------------------
// 三段编译（移植 dsh-agent-rp card-display-compiler.ts，MIT）
// ---------------------------------------------------------------------------

/** display 文本的一个有序段 */
export type DisplaySegment =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'html'; readonly source: string }
  | { readonly kind: 'inline-html'; readonly source: string }

/** 可按 HTML 渲染的标签全集（dsh-agent-rp 清单 + agent-loop-rp L35-49 SVG 扩展） */
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

/** 可与后随 Markdown 散文切分的行首平衡块级标签（参考源码 HTML_BLOCK_TAGS） */
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

/** 代码围栏/行内代码之外的 HTML 标签扫描（参考源码 htmlTagsOutsideCode） */
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
  const fences: string[] = []
  let work = text.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, (m) => {
    fences.push(m)
    return `\x01F${fences.length - 1}\x01`
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
  return work.replace(/\x01F(\d+)\x01/g, (_m, i: string) => fences[Number(i)] ?? '')
}

/** 切出一个行首平衡块级 HTML 块，后续散文逐字节保留（参考源码 splitLeadingHtmlBlock）
 * 【2026-09-06 裸露修复】参考实现要求 HTML 必须在文本开头——真实 ST 卡消息是
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

/** 参考源码 sourceLines */
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

/** 围栏块是否为完整前端文档（参考源码 isFrontendDocument） */
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
 * 把 display 正则替换后的文本切成有序三段（参考源码 compileCharacterDisplay）：
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

/** 编译产物是否需要 iframe 渲染（含完整文档段） */
export function hasFrameSegment(segments: readonly DisplaySegment[]): boolean {
  return segments.some(segment => segment.kind === 'html')
}

// ---------------------------------------------------------------------------
// 两趟 display 正则 + 私用区 token（P0-3）
// 移植 dsh-agent-rp frontend-regex.ts runScripts L285（两趟顺序，MIT）
// 与 dsh-tavern tavern-regex-display.js renderTavernRegexDisplay L96-160（token 隔离，MIT）
// ---------------------------------------------------------------------------

export interface DisplayScriptHit {
  readonly id: string
  readonly name: string
  readonly matches: number
}

export interface DisplayRunResult {
  /** 全部替换完成、token 统一还原后的文本 */
  readonly text: string
  readonly applied: readonly DisplayScriptHit[]
  readonly warnings: readonly string[]
}

/** 私用区 token（dsh-tavern presentationToken 同款形态）：U+E000/U+E001 包裹，替换产物暂存，正文只留 token */
const PRESENTATION_TOKEN_RE = /\uE000DSH_RP_REGEX_(\d+)\uE001/gu

/** 与 regex/engine.ts 同款 ST 字面量剥壳（/pattern/flags；flags 并入，g/m 为基线） */
function compileScriptRegex(findRegex: string): RegExp | null {
  let source = findRegex
  let flags = 'gm'
  const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(source)
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

/** 替换串求值（dsh-tavern replacementFor L39-59）：{{match}} + $1..$99 捕获组 + $<name> + trimStrings */
function buildReplacement(
  script: RegexScript,
  match: string,
  captures: readonly string[],
  named: Record<string, string | undefined> | null,
): string {
  /** 【T-18 R4 2026-09-11】trimStrings 只作用于**捕获组内容**（基准 filterString，
   *  TT engine.js:613-621），不是替换后的整串——后者会把替换串里用户字面写的
   *  标记一并削掉。此前 display 半边与主引擎同款偏差。 */
  const filterTrim = (value: string): string => {
    let out = value
    for (const t of script.trimStrings) {
      if (t === '') continue
      out = out.split(t).join('')
    }
    return out
  }
  let replacement = script.replaceString.replace(/\{\{match\}\}/giu, '$0')
  replacement = replacement.replace(/\$(\d{1,2})/gu, (token, digits: string) => {
    const index = Number(digits)
    if (index === 0) return filterTrim(match)
    if (index >= 1 && index <= captures.length) return filterTrim(captures[index - 1])
    if (digits.length === 2) {
      const fallback = Number(digits[0])
      if (fallback >= 1 && fallback <= captures.length) return filterTrim(captures[fallback - 1]) + digits[1]
    }
    // 【TT 对照修复 2026-09-09】正则无捕获组时 $N = 整个 match（ST/TT 行为）。
    // 原实现返回字面 token：<interactive_input>$1</interactive_input> 类规则会把
    // 用户消息毁成字面 $1 残留（实测发送内容错误）。
    if (captures.length === 0) return filterTrim(match)
    return token
  })
  // 【T-17 补漏 2026-09-11】$<name> 具名捕获组引用。未命中的组按 ST 语义给空串。
  if (named !== null) {
    replacement = replacement.replace(/\$<([A-Za-z_$][\w$]*)>/gu, (_token, name: string) => {
      const v = named[name]
      return v === undefined ? '' : filterTrim(v)
    })
  }
  return replacement
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
 * 每个替换产物存入 presentationParts[]，正文只留 DSH_RP_REGEX_i token，
 * 全部替换完成后统一还原——后续正则不会把前一个正则产出的 HTML 标记当正文二次污染。
 * 防空白守卫：替换后整轮为空则回退原文（dsh-tavern L136-147 思路）。
 */
export function runDisplayScripts(
  scripts: readonly RegexScript[],
  source: string,
  depth: number | null,
): DisplayRunResult {
  const presentationParts: string[] = []
  const applied: DisplayScriptHit[] = []
  const warnings: string[] = []
  const presentationToken = (index: number): string => `\uE000DSH_RP_REGEX_${index}\uE001`
  let text = source

  // 两趟（dsh-agent-rp runScripts L285）：pass 0 = 通用，pass 1 = markdownOnly 专属
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
        const last = args.at(-1)
        const hasGroups = typeof last === 'object' && last !== null
        const tail = hasGroups ? 3 : 2
        const named = hasGroups ? (last as Record<string, string | undefined>) : null
        const captures = args.slice(0, args.length - tail)
          .map(value => (typeof value === 'string' ? value : ''))
        matches += 1
        const replacement = buildReplacement(script, match, captures, named)
        const token = presentationToken(presentationParts.length)
        presentationParts.push(replacement)
        return token
      })
      if (matches === 0) continue
      text = next
      applied.push({ id: script.id, name: label, matches })
    }
  }

  const restoreTokens = (value: string): string =>
    value.replace(PRESENTATION_TOKEN_RE, (_token, digits: string) => presentationParts[Number(digits)] ?? '')
  const restored = restoreTokens(text)

  // 防空白守卫：整轮正文被替换清空 → 回退原文（不报 applied）
  if (applied.length > 0 && source.trim() !== '' && restored.trim() === '') {
    warnings.push('display 正则覆盖了整轮正文，已回退原文')
    return { text: source, applied: [], warnings }
  }
  return { text: restored, applied, warnings }
}

// ---------------------------------------------------------------------------
// iframe 文档骨架（移植 dsh-tavern client.js L883-941，MIT）
// ---------------------------------------------------------------------------

export const FRAME_MAX_HEIGHT = 3000
export const FRAME_MIN_HEIGHT = 48

/** 参考源码 clampTavernFrameHeight。
 *  【2026-09-09 抖动修复】MAX 12000 是桌面参考值——手机视口 ~850px 时 12000 ≈ 14 屏，
 *  且帧内文档若用 vh/百分比布局，高度上报会形成反馈循环（iframe 变高 → vh 值变 →
 *  内容变高 → 再上报）一路爬到 12000 顶格，表现为「画面跳来跳去」。降到 3000（≈3.5
 *  屏）封顶后循环快速收敛到 mount 容器内部滚动（height≥MAX 时 overflow:auto），
 *  正常内容（状态栏 ~500px、思维链折叠 ~200px）不受影响；超长文档帧内部滚动可接受。 */
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

/** iframe 内高度上报脚本（参考源码 reporter：ResizeObserver/load/MutationObserver，fixed 部件不计入高度） */
function heightReporterScript(tokenJson: string): string {
  return '<script data-dsht-rp-frame>(function(){var token=' + tokenJson + ';var last=0;var queued=false;'
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
    + 'function report(){queued=false;var height=measure();if(height===last)return;last=height;'
    + 'parent.postMessage({type:"dsht-rp-frame-height",token:token,height:height},"*");}'
    + 'function schedule(){if(queued)return;queued=true;'
    + 'if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else setTimeout(report,0);}'
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
 * 组装 iframe srcdoc（参考源码 buildTavernFrameDocument）：
 * - 完整文档段（含 doctype/html）：高度上报脚本注入 </body> 前，保留文档自身结构；
 * - HTML 片段：包进带 CSP/基础样式的文档骨架。
 * sandbox="allow-scripts" 由组件侧声明（不给 allow-same-origin）。
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
    + '<style>:root{color-scheme:light dark}html,body{box-sizing:border-box;margin:0;min-height:0;background:transparent;color:CanvasText;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.75}body{padding:0 1px;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,video,svg,canvas{max-width:100%;height:auto}pre{max-width:100%;overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}a{color:LinkText}</style>'
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

function escapePreHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 轻量关键字高亮（textContent → 逃逸 → 分组着色；空块/>50KB/已高亮跳过） */
function highlightPreCode(pre: HTMLElement): void {
  const code = pre.querySelector('code') ?? pre
  if (code.querySelector('span[data-dsht-hl]') !== null) return
  const raw = code.textContent ?? ''
  if (raw.length === 0 || raw.length > 50_000) return
  const html = escapePreHtml(raw).replace(PRE_HL_RE, (m, str: string | undefined, com: string | undefined, num: string | undefined) => {
    const kind = str !== undefined ? 'str' : com !== undefined ? 'com' : num !== undefined ? 'num' : 'kw'
    return `<span data-dsht-hl="${kind}">${m}</span>`
  })
  code.innerHTML = html
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
