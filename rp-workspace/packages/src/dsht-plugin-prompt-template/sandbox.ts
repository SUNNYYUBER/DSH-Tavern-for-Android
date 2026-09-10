/**
 * EJS 沙箱渲染器（隔离执行完整 EJS，含任意 JS 表达式求值）——P1#9。
 *
 * 方案选型：Android node 不能编译原生模块，隔离域二选一——
 * ① Node 内建 vm（vm.Script + vm.createContext + timeout）：零新依赖、
 *    Android node 原生可用、同步执行可用 timeout 硬性中断（while(true) 必死）；
 * ② quickjs-emscripten（参考实现 dsh-agent-rp/agent-loop-rp 的
 *    @jitl/quickjs-singlefile-mjs-release-sync 变体）：纯 JS/WASM 虽可跑，
 *    但引入 ~1MB base64 WASM 依赖、esbuild 打包体积膨胀，且每次渲染
 *    newRuntime 的 WASM 实例化成本高于 vm context。
 * 结论：采用 ①。vm 不是 V8 级安全边界（官方明示），但模板渲染的威胁模型是
 * 「角色卡/世界书里的不可信文本不得触碰宿主 require/process/fs 与事件循环」，
 * vm 隔离域 + 无宿主全局 + timeout + 输出上限已覆盖；记忆上限以输出上限兜底。
 *
 * 参考（MIT 许可，特此致谢）：
 * - dsh-agent-rp（hewzhew/dsh-agent-rp）src/ejs-template.ts L588-679
 *   EjsTemplateEngine：每渲染全新 runtime/context、资源上限、失败分类
 *   EjsTemplateFailureKind（错误信息不含模板源码）、确定性防护
 *   （Date=undefined / Math.random 抛错）；
 * - agent-loop-rp（2428139739pregnant-web/agent-loop-rp）src/ejs-template.ts
 *   L328-378 segments() 切分（<%_/%%>/-%> 空白裁剪）、L1154-1158 注入桥接。
 *
 * 与 ejs.ts（解释子集）的关系：子集引擎保留为默认（零依赖、行为已冻结）；
 * 本沙箱引擎由 /render 的 engine:'sandbox' 显式启用，路由契约不变。
 */

import { createContext, Script } from 'node:vm'
import { isEjsProcessed, type LikeStMessage } from './ejs.ts'
import { createPromptInjectionStore, type PromptInjectionStore } from './injection-store.ts'

const MAX_TEMPLATE_CHARS = 256 * 1024
const MAX_OUTPUT_CHARS = 256 * 1024
// 默认 1s：vm 冷启动（首次编译+执行）在并行负载（vitest 全量/服务端多请求）下
// 可超 200ms——实测 200ms 默认值会让极小模板也误触 execution-limit。上限仍 5s。
const DEFAULT_TIMEOUT_MS = 1000
const MIN_TIMEOUT_MS = 10
const MAX_TIMEOUT_MS = 5_000

/** 稳定失败分类（对照参考 EjsTemplateFailureKind；错误不含模板源码）。 */
export type SandboxFailureKind =
  | 'source-limit'
  | 'syntax-error'
  | 'runtime-error'
  | 'execution-limit'
  | 'output-limit'

export type SandboxRenderResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: SandboxFailureKind }

export type SandboxMessagesResult =
  | { readonly ok: true; readonly messages: LikeStMessage[]; readonly rendered: number; readonly skipped: number }
  | { readonly ok: false; readonly kind: SandboxFailureKind }

export interface SandboxRenderOptions {
  /** 同步执行硬超时（ms），默认 200，clamp 到 [10, 5000]。 */
  readonly timeoutMs?: number
  /** 外部共享的注入 store；缺省每次渲染独立（per-render）。 */
  readonly injections?: PromptInjectionStore
}

// ---------------------------------------------------------------------------
// 模板切分（移植自参考 segments()，另保留我方 {{ }} 宏 → raw 输出段）
// ---------------------------------------------------------------------------

type Segment = { readonly kind: 'text' | 'code' | 'escaped' | 'raw'; readonly value: string }

function segments(template: string): Segment[] | undefined {
  const result: Segment[] = []
  const literalClosings = (value: string) => value.replaceAll('%%>', '%>')
  let cursor = 0
  let trimLeadingWhitespace = false
  while (cursor < template.length) {
    const ejsAt = template.indexOf('<%', cursor)
    const macroAt = template.indexOf('{{', cursor)
    const isMacro = macroAt >= 0 && (ejsAt < 0 || macroAt < ejsAt)
    const opening = isMacro ? macroAt : ejsAt
    if (opening < 0) {
      const tail = literalClosings(trimLeadingWhitespace ? template.slice(cursor).replace(/^\s+/u, '') : template.slice(cursor))
      if (tail !== '') result.push({ kind: 'text', value: tail })
      return result
    }
    let text = template.slice(cursor, opening)
    if (trimLeadingWhitespace) text = text.replace(/^\s+/u, '')
    trimLeadingWhitespace = false
    if (isMacro) {
      if (text !== '') result.push({ kind: 'text', value: literalClosings(text) })
      const closing = template.indexOf('}}', opening + 2)
      if (closing < 0) return undefined
      result.push({ kind: 'raw', value: template.slice(opening + 2, closing).trim() })
      cursor = closing + 2
      continue
    }
    const marker = template[opening + 2]
    if (marker === '%') {
      if (text !== '') result.push({ kind: 'text', value: literalClosings(text) })
      result.push({ kind: 'text', value: '<%' })
      cursor = opening + 3
      continue
    }
    if (marker === '_') text = text.replace(/\s+$/u, '')
    if (text !== '') result.push({ kind: 'text', value: literalClosings(text) })
    const contentStart = opening + (marker === '=' || marker === '-' || marker === '#' || marker === '_' ? 3 : 2)
    const closing = template.indexOf('%>', contentStart)
    if (closing < 0) return undefined
    const closeMarker = template[closing - 1]
    const contentEnd = closeMarker === '-' || closeMarker === '_' ? closing - 1 : closing
    const value = template.slice(contentStart, contentEnd)
    if (marker !== '#') {
      result.push({
        kind: marker === '=' ? 'escaped' : marker === '-' ? 'raw' : 'code',
        value,
      })
    }
    cursor = closing + 2
    if (closeMarker === '_') {
      trimLeadingWhitespace = true
    } else if (closeMarker === '-') {
      if (template.startsWith('\r\n', cursor)) cursor += 2
      else if (template[cursor] === '\n' || template[cursor] === '\r') cursor += 1
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 编译：段序列 → 同步 IIFE JS 源（沙箱内执行）
// ---------------------------------------------------------------------------

const LOCAL_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u
/** 上下文键提升为局部变量时的保留名（JS 关键字 + 沙箱内部名 + 注入 API）。 */
const RESERVED_LOCALS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'arguments', 'eval',
  'injectPrompt', 'getPromptsInjected', 'hasPromptsInjected', 'print',
  '__ctx', '__output', '__append', '__escape',
  '__hostInject', '__hostGet', '__hostHas',
])

function contextLocalDeclarations(context: Record<string, unknown>): string {
  return Object.keys(context)
    .filter(key => LOCAL_IDENTIFIER.test(key) && !RESERVED_LOCALS.has(key))
    .map(key => `var ${key} = __ctx[${JSON.stringify(key)}];`)
    .join('\n    ')
}

function compileTemplate(template: string, context: Record<string, unknown>): string | undefined {
  const parsed = segments(template)
  if (parsed === undefined) return undefined
  const statements = parsed.map(segment => {
    if (segment.kind === 'text') return `__append(${JSON.stringify(segment.value)});`
    if (segment.kind === 'escaped') return `__append(__escape((${segment.value})));`
    if (segment.kind === 'raw') return `__append((${segment.value}));`
    return segment.value
  }).join('\n    ')
  // 上下文 JSON 双序列化：宿主侧 stringify 成字符串字面量，沙箱内 JSON.parse
  // 重建（跨 realm 只传字符串，宿主对象不进沙箱）。
  const contextJson = JSON.stringify(JSON.stringify(context ?? {}))
  return `(() => {
    'use strict';
    const __ctx = JSON.parse(${contextJson});
    let __output = '';
    const __append = value => {
      if (value === undefined || value === null) return;
      __output += typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (__output.length > ${MAX_OUTPUT_CHARS}) throw new Error('__DSHT_EJS_OUTPUT_LIMIT__');
    };
    const __escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    ${contextLocalDeclarations(context ?? {})}
    const injectPrompt = (key, prompt, order = 100, sticky = 0, uid = '') => {
      __hostInject(String(key), String(prompt ?? ''), Number(order), Number(sticky), String(uid ?? ''));
    };
    // postprocess 经 JSON 字符串过桥，规避 vm realm 数组在宿主侧 Array.isArray 失灵。
    const getPromptsInjected = (key, postprocess = []) => __hostGet(String(key), JSON.stringify(postprocess));
    const hasPromptsInjected = key => Boolean(__hostHas(String(key)));
    const print = (...values) => { for (const value of values) __append(value); };
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('__DSHT_EJS_NONDETERMINISTIC__'); };
    ${statements}
    return __output;
  })()`
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

function clampTimeout(timeoutMs: number | undefined): number {
  const n = Number(timeoutMs)
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(n)))
}

function failureKind(error: unknown): SandboxFailureKind {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out/iu.test(message)) return 'execution-limit'
  if (message.includes('__DSHT_EJS_OUTPUT_LIMIT__')) return 'output-limit'
  return 'runtime-error'
}

function parsePostprocess(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

/**
 * 沙箱渲染入口：template + context → SandboxRenderResult。
 * 每次渲染创建全新 vm 隔离域：无 require/process/module/fetch/计时器，
 * Date 置 undefined、Math.random 抛错（确定性防护）；timeout 硬中断。
 */
export function renderEjsSandbox(
  template: string,
  context: Record<string, unknown>,
  options: SandboxRenderOptions = {},
): SandboxRenderResult {
  if (template.length > MAX_TEMPLATE_CHARS) return { ok: false, kind: 'source-limit' }
  const code = compileTemplate(template, context)
  if (code === undefined) return { ok: false, kind: 'syntax-error' }
  const store = options.injections ?? createPromptInjectionStore()
  const sandboxGlobal = {
    __hostInject: (key: string, prompt: string, order: number, sticky: number, uid: string) => {
      store.inject(key, prompt, order, sticky, uid)
    },
    __hostGet: (key: string, postprocess: string) => store.get(key, parsePostprocess(postprocess)),
    __hostHas: (key: string) => store.has(key),
  }
  let script: Script
  try {
    script = new Script(code, { filename: 'dsht-ejs-template.js' })
  } catch {
    return { ok: false, kind: 'syntax-error' }
  }
  const isolated = createContext(sandboxGlobal, { name: 'dsht-ejs' })
  try {
    const value = script.runInContext(isolated, { timeout: clampTimeout(options.timeoutMs) })
    return typeof value === 'string' ? { ok: true, text: value } : { ok: false, kind: 'runtime-error' }
  } catch (error) {
    return { ok: false, kind: failureKind(error) }
  }
}

/**
 * 批量渲染历史消息（沙箱引擎版 renderMessages）：is_ejs_processed 跳过；
 * 整批共享一份注入 store（= 一次生成 pass），任一消息失败即整体失败。
 */
export function renderMessagesSandbox(
  template: string,
  context: Record<string, unknown>,
  messages: LikeStMessage[],
  options: SandboxRenderOptions = {},
): SandboxMessagesResult {
  const store = options.injections ?? createPromptInjectionStore()
  let rendered = 0
  let skipped = 0
  const out: LikeStMessage[] = []
  for (const msg of messages) {
    if (isEjsProcessed(msg)) { skipped++; out.push(msg); continue }
    const mes = String(msg.mes ?? '')
    const r = renderEjsSandbox(template || mes, { ...context, message: msg }, { ...options, injections: store })
    if (!r.ok) return r
    rendered++
    out.push({ ...msg, mes: r.text, is_ejs_processed: true })
  }
  return { ok: true, messages: out, rendered, skipped }
}

/**
 * 【心跳 47】把 subset 引擎（`ejs.ts:renderMessages`）的返回**归一**为 `SandboxMessagesResult`。
 *
 * 为什么需要它：两个引擎的成功形态**不同** ——
 *   · subset  → `{ messages, rendered, skipped }`（无 `ok`）
 *   · sandbox → `{ ok: true, messages, rendered, skipped }`
 * 调用点若图省事写成 `{ ok: true, messages: renderMessages(...) }`，就把**对象**塞进了
 * `messages` 字段；后续 `r.messages[k]?.mes` 恒 `undefined` → 正文被静默写成空串
 * （`dsh-plugin/index.ts` 的 EJS 生成期管线曾如此，类型闸门以 TS7053 暴露）。
 * 归一动作收在这里，调用点不再有两套形状可写错，并可被单测钉死。
 */
export function asSandboxMessagesResult(
  rr: { messages: LikeStMessage[]; rendered: number; skipped: number },
): SandboxMessagesResult {
  return { ok: true, messages: rr.messages, rendered: rr.rendered, skipped: rr.skipped }
}
