/**
 * EJS 子集渲染器（ST-Prompt-Template 插件意图级移植的核心）——纯函数，可单测。
 *
 * 支持（常用子集，解释执行，不 eval/new Function）：
 * - {{ path.to.var }}              宏插值（raw 输出）
 * - <%= expr %> / <%- expr %>      EJS 输出（escaped / raw）
 * - <% if (expr) { %> <% } else if (expr) { %> <% } else { %> <% } %>
 * - <% for (const item of expr) { %> / <% for (const item, i of expr) { %>
 * - <% const x = expr %>           局部赋值（let/var 同义）
 * - <%# comment %>                 注释（丢弃）
 * 表达式：字面量（数字/字符串/true/false/null/undefined）、点路径、下标、
 * 一元 !/-、二元 + - * / % == != === !== < <= > >= && ||、括号、三元 ?:。
 * 不支持：函数调用、箭头函数、模板字符串、正则字面量——遇到即抛渲染错误。
 */

// ---------------------------------------------------------------------------
// 表达式求值（Pratt parser）
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }

function lexExpr(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const isIdStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isId = (c: string) => /[A-Za-z0-9_$]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v)) throw new Error(`bad number: ${src.slice(i, j)}`)
      toks.push({ t: 'num', v }); i = j; continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          const n = src[j + 1]
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n ?? ''
          j += 2
        } else {
          out += src[j]; j++
        }
      }
      if (j >= src.length) throw new Error('unterminated string literal')
      toks.push({ t: 'str', v: out }); i = j + 1; continue
    }
    if (isIdStart(c)) {
      let j = i
      while (j < src.length && isId(src[j])) j++
      toks.push({ t: 'ident', v: src.slice(i, j) }); i = j; continue
    }
    const three = src.slice(i, i + 3)
    if (three === '===' || three === '!==') { toks.push({ t: 'op', v: three }); i += 3; continue }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*%/!<>?:.,()[]'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    throw new Error(`unexpected char in expression: ${c}`)
  }
  return toks
}

type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'ref'; name: string }
  | { k: 'get'; obj: Expr; key: Expr | string }
  | { k: 'un'; op: string; a: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
}

export function parseExpr(src: string): Expr {
  const toks = lexExpr(src)
  let pos = 0
  const peek = (): Tok | undefined => toks[pos]
  const next = (): Tok => {
    const t = toks[pos++]
    if (!t) throw new Error('unexpected end of expression')
    return t
  }
  const expectOp = (v: string): void => {
    const t = next()
    if (t.t !== 'op' || t.v !== v) throw new Error(`expected '${v}'`)
  }

  function parsePrimary(): Expr {
    const t = next()
    if (t.t === 'num') return { k: 'lit', v: t.v }
    if (t.t === 'str') return { k: 'lit', v: t.v }
    if (t.t === 'ident') {
      if (t.v === 'true') return { k: 'lit', v: true }
      if (t.v === 'false') return { k: 'lit', v: false }
      if (t.v === 'null') return { k: 'lit', v: null }
      if (t.v === 'undefined') return { k: 'lit', v: undefined }
      return { k: 'ref', name: t.v }
    }
    if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      return { k: 'un', op: t.v, a: parsePrimary() }
    }
    if (t.t === 'op' && t.v === '(') {
      const e = parseTernary()
      expectOp(')')
      return e
    }
    throw new Error(`unexpected token: ${t.v}`)
  }

  function parsePostfix(): Expr {
    let e = parsePrimary()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && t.v === '.') {
        next()
        const id = next()
        if (id.t !== 'ident') throw new Error("expected property name after '.'")
        e = { k: 'get', obj: e, key: id.v }
      } else if (t?.t === 'op' && t.v === '[') {
        next()
        const idx = parseTernary()
        expectOp(']')
        e = { k: 'get', obj: e, key: idx }
      } else break
    }
    return e
  }

  function parseBin(minPrec: number): Expr {
    let left = parsePostfix()
    for (;;) {
      const t = peek()
      if (t?.t !== 'op') break
      const prec = BIN_PREC[t.v]
      if (prec === undefined || prec < minPrec) break
      next()
      const right = parseBin(prec + 1)
      left = { k: 'bin', op: t.v, a: left, b: right }
    }
    return left
  }

  function parseTernary(): Expr {
    const c = parseBin(1)
    const t = peek()
    if (t?.t === 'op' && t.v === '?') {
      next()
      const a = parseTernary()
      expectOp(':')
      const b = parseTernary()
      return { k: 'cond', c, a, b }
    }
    return c
  }

  const e = parseTernary()
  if (pos < toks.length) throw new Error(`trailing tokens in expression: ${src}`)
  return e
}

/** 作用域链（context + 局部帧） */
type Scope = Record<string, unknown>

function lookup(scopes: Scope[], name: string): unknown {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(scopes[i], name)) return scopes[i][name]
  }
  return undefined
}

function looseEq(a: unknown, b: unknown): boolean {
  // eslint-disable-next-line eqeqeq
  return a == b
}

export function evalExpr(e: Expr, scopes: Scope[]): unknown {
  switch (e.k) {
    case 'lit': return e.v
    case 'ref': return lookup(scopes, e.name)
    case 'get': {
      const obj = evalExpr(e.obj, scopes)
      if (obj === null || obj === undefined) return undefined
      const key = typeof e.key === 'string' ? e.key : evalExpr(e.key, scopes)
      return (obj as Record<string | number, unknown>)[key as string]
    }
    case 'un': {
      const v = evalExpr(e.a, scopes)
      if (e.op === '!') return !v
      if (e.op === '-') return -Number(v)
      return +Number(v)
    }
    case 'bin': {
      if (e.op === '&&') return evalExpr(e.a, scopes) && evalExpr(e.b, scopes)
      if (e.op === '||') return evalExpr(e.a, scopes) || evalExpr(e.b, scopes)
      const a = evalExpr(e.a, scopes)
      const b = evalExpr(e.b, scopes)
      switch (e.op) {
        case '+': return (typeof a === 'string' || typeof b === 'string') ? String(a ?? '') + String(b ?? '') : Number(a) + Number(b)
        case '-': return Number(a) - Number(b)
        case '*': return Number(a) * Number(b)
        case '/': return Number(a) / Number(b)
        case '%': return Number(a) % Number(b)
        case '==': return looseEq(a, b)
        case '!=': return !looseEq(a, b)
        case '===': return a === b
        case '!==': return a !== b
        case '<': return (a as number) < (b as number)
        case '<=': return (a as number) <= (b as number)
        case '>': return (a as number) > (b as number)
        case '>=': return (a as number) >= (b as number)
        default: throw new Error(`unsupported operator: ${e.op}`)
      }
    }
    case 'cond': return evalExpr(e.c, scopes) ? evalExpr(e.a, scopes) : evalExpr(e.b, scopes)
  }
}

// ---------------------------------------------------------------------------
// 模板解析
// ---------------------------------------------------------------------------

type Seg =
  | { t: 'text'; s: string }
  | { t: 'out'; expr: string; escaped: boolean }
  | { t: 'code'; s: string }

/** 模板 → 段序列（文本 / 输出 / 代码）；<%# %> 注释丢弃，<%% → 字面 <% */
export function lexTemplate(template: string): Seg[] {
  const segs: Seg[] = []
  let i = 0
  let textStart = 0
  const flushText = (end: number) => {
    if (end > textStart) segs.push({ t: 'text', s: template.slice(textStart, end) })
  }
  while (i < template.length) {
    if (template.startsWith('<%%', i)) { i += 3; continue } // 转义：留在文本里由后处理
    const isEjs = template.startsWith('<%', i)
    const isMacro = template.startsWith('{{', i)
    if (!isEjs && !isMacro) { i++; continue }
    flushText(i)
    if (isMacro) {
      const end = template.indexOf('}}', i + 2)
      if (end === -1) throw new Error('unclosed {{')
      segs.push({ t: 'out', expr: template.slice(i + 2, end).trim(), escaped: false })
      i = end + 2; textStart = i; continue
    }
    const end = template.indexOf('%>', i + 2)
    if (end === -1) throw new Error('unclosed <%')
    const inner = template.slice(i + 2, end)
    i = end + 2; textStart = i
    if (inner.startsWith('#')) continue // 注释
    if (inner.startsWith('=')) { segs.push({ t: 'out', expr: inner.slice(1).trim(), escaped: true }); continue }
    if (inner.startsWith('-')) { segs.push({ t: 'out', expr: inner.slice(1).trim(), escaped: false }); continue }
    segs.push({ t: 'code', s: inner.trim() })
  }
  flushText(template.length)
  // <%% 还原为字面 <%
  for (const s of segs) if (s.t === 'text') s.s = s.s.replaceAll('<%%', '<%')
  return segs
}

type Node =
  | { k: 'text'; s: string }
  | { k: 'out'; expr: Expr; escaped: boolean }
  | { k: 'if'; branches: Array<{ cond: Expr | null; body: Node[] }> }
  | { k: 'for'; varName: string; indexVar: string | null; iter: Expr; body: Node[] }
  | { k: 'set'; name: string; expr: Expr }

const RE_IF = /^if\s*\(([\s\S]+)\)\s*\{\s*$/
const RE_ELSE_IF = /^}\s*else\s+if\s*\(([\s\S]+)\)\s*\{\s*$/
const RE_ELSE = /^}\s*else\s*\{\s*$/
const RE_CLOSE = /^}\s*$/
const RE_FOR = /^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s+of\s+([\s\S]+?)\)\s*\{\s*$/
const RE_SET = /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+)$/

export function parseTemplate(template: string): Node[] {
  const segs = lexTemplate(template)
  let pos = 0

  function parseNodes(inBlock: boolean): { nodes: Node[]; term: 'else-if' | 'else' | 'close' | 'eof'; elseIfCond?: Expr } {
    const nodes: Node[] = []
    while (pos < segs.length) {
      const seg = segs[pos]
      if (seg.t === 'text') { nodes.push({ k: 'text', s: seg.s }); pos++; continue }
      if (seg.t === 'out') { nodes.push({ k: 'out', expr: parseExpr(seg.expr || 'undefined'), escaped: seg.escaped }); pos++; continue }
      const code = seg.s
      let m: RegExpMatchArray | null
      if ((m = code.match(RE_ELSE_IF))) {
        if (!inBlock) throw new Error(`'} else if' without matching 'if'`)
        return { nodes, term: 'else-if', elseIfCond: parseExpr(m[1]) }
      }
      if (RE_ELSE.test(code)) {
        if (!inBlock) throw new Error(`'} else' without matching 'if'`)
        return { nodes, term: 'else' }
      }
      if (RE_CLOSE.test(code)) {
        if (!inBlock) throw new Error(`'}' without matching block`)
        return { nodes, term: 'close' }
      }
      if ((m = code.match(RE_IF))) {
        pos++
        const branches: Array<{ cond: Expr | null; body: Node[] }> = []
        let cond: Expr | null = parseExpr(m[1])
        for (;;) {
          const sub = parseNodes(true)
          branches.push({ cond, body: sub.nodes })
          if (sub.term === 'else-if') { pos++; cond = sub.elseIfCond ?? null; continue }
          if (sub.term === 'else') {
            pos++
            const elseBody = parseNodes(true)
            if (elseBody.term !== 'close') throw new Error(`'else' block not closed`)
            branches.push({ cond: null, body: elseBody.nodes })
            break
          }
          if (sub.term !== 'close') throw new Error(`'if' block not closed`)
          break
        }
        pos++ // 吃掉终止代码段
        nodes.push({ k: 'if', branches })
        continue
      }
      if ((m = code.match(RE_FOR))) {
        pos++
        const sub = parseNodes(true)
        if (sub.term !== 'close') throw new Error(`'for' block not closed`)
        pos++
        nodes.push({ k: 'for', varName: m[1], indexVar: m[2] ?? null, iter: parseExpr(m[3]), body: sub.nodes })
        continue
      }
      if ((m = code.match(RE_SET))) {
        pos++
        nodes.push({ k: 'set', name: m[1], expr: parseExpr(m[2]) })
        continue
      }
      throw new Error(`unsupported statement: <% ${code.length > 60 ? code.slice(0, 60) + '…' : code} %>`)
    }
    return { nodes, term: 'eof' }
  }

  const { nodes, term } = parseNodes(false)
  if (term !== 'eof') throw new Error('template parse error: unbalanced block')
  return nodes
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ---------------------------------------------------------------------------
// B19：编译缓存（ST cache_enabled 0/1/2 + cache_size + cache_hasher 同语义）
// ---------------------------------------------------------------------------

/** 模板 AST 缓存（renderNodes 只读树，set 写的是求值期 scope 帧——共享安全） */
const parseCache = new Map<string, Node[]>()
export interface EjsCacheConfig { enabled: 0 | 1 | 2; size: number; hasher: 'h32ToString' | 'h64ToString' }
let cacheConfig: EjsCacheConfig = { enabled: 0, size: 0, hasher: 'h32ToString' }

/** /render 路由加载设置后调用（cacheEnabled 1=启用 2=仅世界书——本渲染器统一按模板缓存） */
export function configureEjsCache(cfg: Partial<EjsCacheConfig>): void {
  cacheConfig = {
    enabled: cfg.enabled === 1 || cfg.enabled === 2 ? cfg.enabled : 0,
    size: typeof cfg.size === 'number' && cfg.size > 0 ? Math.floor(cfg.size) : 0,
    hasher: cfg.hasher === 'h64ToString' ? 'h64ToString' : 'h32ToString',
  }
}

/** FNV-1a 32/64 位（ST cache_hasher 的 h32/h64 两档同名档） */
function cacheHash(template: string): string {
  if (cacheConfig.hasher === 'h64ToString') {
    let h = 0xcbf29ce484222325n
    for (let i = 0; i < template.length; i++) {
      h ^= BigInt(template.charCodeAt(i))
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn
    }
    return h.toString(16)
  }
  let h = 0x811c9dc5
  for (let i = 0; i < template.length; i++) {
    h ^= template.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function cachedParse(template: string): Node[] {
  if (cacheConfig.enabled === 0) return parseTemplate(template)
  const key = `${cacheHash(template)}:${template.length}`
  const hit = parseCache.get(key)
  if (hit) return hit
  const nodes = parseTemplate(template)
  if (cacheConfig.size > 0 && parseCache.size >= cacheConfig.size) {
    const oldest = parseCache.keys().next().value
    if (oldest !== undefined) parseCache.delete(oldest)
  }
  parseCache.set(key, nodes)
  return nodes
}

// ---------------------------------------------------------------------------
// B7：<pre> 代码块保护（ST code_blocks 关 = 代码块不做模板处理，原样保留）
// ---------------------------------------------------------------------------

/** 提取 <pre>…</pre> 段替换为占位符（渲染后 restorePreBlocks 还原）。 */
export function protectPreBlocks(text: string): { text: string; blocks: string[] } {
  if (!text.includes('<pre')) return { text, blocks: [] }
  const blocks: string[] = []
  const replaced = text.replace(/<pre[\s\S]*?<\/pre>/gi, (m) => {
    blocks.push(m)
    return `\u0000EJS_PRE_${blocks.length - 1}\u0000`
  })
  return { text: replaced, blocks }
}

export function restorePreBlocks(text: string, blocks: string[]): string {
  return blocks.length === 0 ? text : text.replace(/\u0000EJS_PRE_(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)] ?? '')
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function renderNodes(nodes: Node[], scopes: Scope[], out: string[]): void {
  for (const n of nodes) {
    switch (n.k) {
      case 'text': out.push(n.s); break
      case 'out': {
        const v = stringify(evalExpr(n.expr, scopes))
        out.push(n.escaped ? escapeHtml(v) : v)
        break
      }
      case 'if': {
        for (const b of n.branches) {
          if (b.cond === null || evalExpr(b.cond, scopes)) {
            renderNodes(b.body, scopes, out)
            break
          }
        }
        break
      }
      case 'for': {
        const iter = evalExpr(n.iter, scopes)
        const arr: unknown[] = Array.isArray(iter) ? iter : []
        arr.forEach((item, idx) => {
          const frame: Scope = { [n.varName]: item }
          if (n.indexVar !== null) frame[n.indexVar] = idx
          renderNodes(n.body, [...scopes, frame], out)
        })
        break
      }
      case 'set': {
        const top = scopes[scopes.length - 1]
        top[n.name] = evalExpr(n.expr, scopes)
        break
      }
    }
  }
}

/** 渲染入口：template + context → string。语法错误/不支持语句抛 Error（带 [dsht-ejs] 前缀）。 */
export function renderEjsSubset(template: string, context: Record<string, unknown>): string {
  try {
    const nodes = cachedParse(template)
    const out: string[] = []
    renderNodes(nodes, [context, {}], out)
    return out.join('')
  } catch (e) {
    throw new Error(`[dsht-ejs] ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// is_ejs_processed 标记（历史消息已处理过的跳过）
// ---------------------------------------------------------------------------

export interface LikeStMessage {
  mes?: string
  is_ejs_processed?: unknown
  extra?: { is_ejs_processed?: unknown }
  [key: string]: unknown
}

/** ST 端标记形态实测有两种：布尔 true 与 [true]（jsonl 迁移产物）。 */
export function isEjsProcessed(msg: LikeStMessage): boolean {
  const mark = msg.is_ejs_processed ?? msg.extra?.is_ejs_processed
  if (mark === true) return true
  return Array.isArray(mark) && mark.includes(true)
}

/** B7 选项：protectPre=true 时消息里的 <pre> 块不做模板求值（ST code_blocks 关同语义） */
export interface RenderMessagesOptions { protectPre?: boolean }

/**
 * 批量渲染历史消息：is_ejs_processed 的跳过（保留原 mes），未处理的按
 * template 渲染（context 叠加 {message} 供模板引用当前消息字段），并打上已处理标记。
 */
export function renderMessages(
  template: string,
  context: Record<string, unknown>,
  messages: LikeStMessage[],
  options: RenderMessagesOptions = {},
): { messages: LikeStMessage[]; rendered: number; skipped: number } {
  let rendered = 0
  let skipped = 0
  const out = messages.map(msg => {
    if (isEjsProcessed(msg)) { skipped++; return msg }
    let mes = String(msg.mes ?? '')
    let preBlocks: string[] = []
    if (options.protectPre === true) {
      const p = protectPreBlocks(mes)
      mes = p.text
      preBlocks = p.blocks
    }
    const next = restorePreBlocks(renderEjsSubset(template || mes, { ...context, message: msg }), preBlocks)
    rendered++
    return { ...msg, mes: next, is_ejs_processed: true }
  })
  return { messages: out, rendered, skipped }
}
