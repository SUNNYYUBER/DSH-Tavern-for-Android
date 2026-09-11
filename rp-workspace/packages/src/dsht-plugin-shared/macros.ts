/**
 * DSHTavern 酒馆助手宏引擎（第四轮：真适配，替代"全角化了事"）——纯函数模块。
 *
 * 支持 ST / 酒馆助手常用宏子集：
 * - 身份：{{user}} / {{char}} / {{persona}}（persona = rp/persona.json active 的描述）
 * - 变量：{{getvar::path}}（读三级作用域合并视图）、{{setvar::path::value}}
 *   （写入并输出空串；同文本内后序 getvar 看得到先行的 setvar——顺序求值）、
 *   {{addvar::path::数}}（数值加算）、{{incvar::path}} / {{decvar::path}}（±1；三者均输出空串）
 * - C2 类宏（MVU 作用域宏）：{{get_message_variable::path}} / {{get_chat_variable::path}}
 *   （chat 作用域）、{{get_character_variable::path}}（character）、
 *   {{get_preset_variable::path}}（preset，缺档回落 global）、{{get_global_variable::path}}
 *   （global）——读取走 ctx.scopeGet（缺省回落 getVar，向后兼容）；
 *   format_* 同名五族：值若为数字输出千分位字符串，否则同 get 族的字符串化
 * - 随机：{{random:a,b}} / {{random::a::b}}（每次重掷）；{{pick::a::b}}
 *   （稳定选择：种子 = stableSeed + 原文哈希 + 位置偏移，ST 同款语义）
 * - 骰子：{{roll::1d20}} / {{dice::2d6}}（同式别名；纯数字视为 1dN）
 * - 时间：{{time}} / {{date}} / {{datetime}} / {{weekday}} / {{isotime}} / {{isodate}}
 *   （本地时区；now 可注入便于测试）
 * - 注释：{{// …}} 与 {{! …}}（剥离）；{{noop}}（空串）
 * - 嵌套宏：迭代展开（宏求值产物里的 {{…}} 再展开，上限 10 轮防死循环）
 * - 未知宏：原样保留输出并记入 unknownMacros（不炸、不吞内容）
 *
 * 路径段分隔符 :: 与单 : 都兼容；变量路径点号（a.b）与 JSONPointer（/a/b）都接受。
 *
 * 与 preset/compiler.ts 的 neutralizePromptVariables 职责分工：
 * - neutralize 只用于"文本要写进 DSH persona 插件 config.text"的场景（严格插值器会炸 turn），
 *   是写盘期护栏；本引擎是运行期语义层——pre-step 快照注入与 /macros/expand 路由的
 *   {{…}} 由这里真正求值，不再中性化。
 *
 * 打包：esbuild 内联（dsht-plugin-tavern-helper / dsht-mvu / dsh-plugin 各自 bundle 时编入）。
 */

// ---------------------------------------------------------------------------
// 变量路径（点号 / JSONPointer 双兼容）
// ---------------------------------------------------------------------------

/** 变量路径 → 段数组（点号或斜杠分隔；JSONPointer ~1/~0 转义仅在斜杠形态下解码） */
export function parseVarPath(path: string): string[] {
  const p = path.trim()
  if (p.startsWith('/')) {
    return p.split('/').filter(s => s.length > 0).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  }
  return p.split('.').map(s => s.trim()).filter(s => s.length > 0)
}

/** 段数组 → JSONPointer（路由落盘/undo 日志的规范形态） */
export function toPointer(path: string): string {
  const segs = parseVarPath(path)
  return '/' + segs.map(s => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
}

/** 按变量路径取值（不存在返回 undefined） */
export function readVarPath(tree: Record<string, unknown>, path: string): unknown {
  let cur: unknown = tree
  for (const seg of parseVarPath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 按变量路径写值（逐层建对象；返回新树，不改入参） */
export function writeVarPath(tree: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segs = parseVarPath(path)
  if (segs.length === 0) return tree
  const next: Record<string, unknown> = structuredClone(tree)
  let cur: Record<string, unknown> = next
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const existing = cur[seg]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) cur[seg] = {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
  return next
}

// ---------------------------------------------------------------------------
// 宏上下文与结果
// ---------------------------------------------------------------------------

export interface TavernMacroContext {
  /** 用户名（persona 名；rp.json macros.user / persona.json active） */
  user: string
  /** 角色名（rp.json macros.char） */
  char: string
  /** persona 描述（rp/persona.json active 条目的 description；可空） */
  persona?: string
  /** 变量读取（三级作用域合并视图；路径为点号或 JSONPointer） */
  getVar?: (path: string) => unknown
  /** C2 类宏作用域读取（kind = chat/character/preset/global；缺省或缺命中回落 getVar——向后兼容） */
  scopeGet?: (kind: 'chat' | 'character' | 'preset' | 'global', path: string) => unknown
  /** setvar 写回调（每次写入触发；引擎自身也累积 writes 返回） */
  setVar?: (path: string, value: string) => void
  /** 稳定随机种子（pick 宏的稳定性锚点；缺省用空串） */
  stableSeed?: string
  /** 时间源（测试注入；缺省 new Date()） */
  now?: Date
  /**
   * 每次求值的**动态宏**（ST `substituteParams(content, {dynamicMacros})` 语义；
   * 卡脚本路径：`substituteParamsExtended(content, additionalMacro, postProcessFn)`）。
   *
   * 优先级**高于**已注册宏（含自定义宏表）——对齐基准：
   * `MacroEngine.#resolveMacro` 先查 `env.dynamicMacros[nameLower]`，命中即作 `defOverride`
   * 覆盖注册宏（`MacroEngine.js:178-179 / 217-220`）；键按小写归一（`MacroEnvBuilder.js:161-163`）。
   * 值支持 string（直出）与 function（`(args, ctx) => string`）两种形态（`MacroEngine.js:196-204`）。
   */
  dynamicMacros?: Record<string, string | ((args: string, ctx: TavernMacroContext) => string)>
  /**
   * 每个**已解析**宏结果的加工钩子（ST `postProcessFn` 语义）。
   *
   * 基准证据：`env.functions.postProcess = ctx.postProcessFn`（`MacroEnvBuilder.js:152`），
   * 在 `#resolveMacro` 里对 `executeMacro` 的返回逐宏调用（`MacroEngine.js:223-228`）。
   * **两条刻意的一致**：① 只加工**已解析**的宏 —— 未知宏在基准里于 `executeMacro` **之前**
   * 就 `return raw`（`MacroEngine.js:214-216`），故不经 postProcess；② 钩子抛错时返回
   * **未加工**结果而非报错（`MacroEngine.js:225-228` catch 后 `return result`）。
   */
  postProcess?: (value: string) => string
}

export interface TavernMacroWrite {
  /** 规范 JSONPointer 形态 */
  path: string
  value: string
  /**
   * 【T-22 2026-09-11】目标作用域。缺省 = 由调用方按会话上下文决定（沿用旧行为）；
   * `{{setglobalvar}}` 族显式标 `'global'`——它们语义上**只**写全局变量，与调用方
   * 当前是否有 sessionId/slug 无关（ST：`setGlobalVariable` 直写 extension_settings.global）。
   */
  scope?: 'global' | 'character' | 'chat'
}

export interface TavernMacroResult {
  text: string
  /** setvar 写入清单（顺序保留；调用方负责落盘） */
  writes: TavernMacroWrite[]
  /** 未识别宏原文（已原样保留在 text 里） */
  unknownMacros: string[]
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** FNV-1a 32 位哈希（pick 稳定性锚点） */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 种子 PRNG（确定性种子 → 确定性序列） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 列表分隔：`::` 或逗号（逗号分隔时逐项 trim、支持 `\,` 转义） */
function splitMacroList(listString: string): string[] {
  if (listString.includes('::')) return listString.split('::')
  return listString
    .replace(/\\,/g, '\0COMMA\0')
    .split(',')
    .map(item => item.trim().replace(/\0COMMA\0/g, ','))
}

/** 骰子公式求值：NdM±K；纯数字视为 1dN */
function rollDice(formula: string): number | null {
  const m = formula.replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$|^(\d+)$/)
  if (m?.[4]) return Number(m[4])
  if (!m) return null
  const count = m[1] ? Number(m[1]) : 1
  const sides = Number(m[2])
  const mod = m[3] ? Number(m[3]) : 0
  if (count < 1 || count > 1000 || sides < 2 || sides > 100000) return null
  let total = mod
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides)
  return total
}

function stringifyVar(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const MACRO_PATTERN = /\{\{([^{}]+)\}\}/g
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// ---------------------------------------------------------------------------
// L1b（2026-09-06 hook 移植）：第三方宏注册——ST MacroRegistry.registerMacro 对应物
// （Luker macro-system.js:57 / MacroRegistry.js:198）。
// 自定义宏两种形态：字符串模板（输出该串；内层 {{…}} 由外层迭代展开接着求值）或
// 同进程函数 handler(args, ctx)。注册表模块级单例；宿主侧经 /dsht-rp 路由持久化到
// $DSH_HOME/rp/macros.json 并在启动时水合，客户端显示期拉同一份水合——双端一致。
// 内置宏优先（switch 先命中），注册内置名直接拒绝。
// ---------------------------------------------------------------------------

export type CustomMacroHandler = (args: string, ctx: TavernMacroContext) => string

const customMacros = new Map<string, string | CustomMacroHandler>()
const CUSTOM_MACRO_NAME = /^[a-zA-Z][\w-]{0,63}$/
const BUILTIN_MACRO_NAMES = new Set([
  'user', 'char', 'persona', 'noop', 'getvar', 'setvar', 'addvar', 'incvar', 'decvar',
  'getglobalvar', 'setglobalvar', 'addglobalvar', 'incglobalvar', 'decglobalvar',
  'get_message_variable', 'get_chat_variable', 'get_character_variable', 'get_preset_variable', 'get_global_variable',
  'format_message_variable', 'format_chat_variable', 'format_character_variable', 'format_preset_variable', 'format_global_variable',
  'random', 'pick', 'roll', 'dice', 'time', 'date', 'datetime', 'weekday', 'isotime', 'isodate',
])

/** 注册自定义宏（内置名/非法名抛错；同名覆盖——ST registerMacro 同语义） */
export function registerMacro(name: string, value: string | CustomMacroHandler): void {
  const key = name.trim().toLowerCase()
  if (!CUSTOM_MACRO_NAME.test(key)) throw new Error(`invalid macro name "${name}"`)
  if (BUILTIN_MACRO_NAMES.has(key)) throw new Error(`macro "${key}" is built-in and cannot be overridden`)
  customMacros.set(key, value)
}

/** 注销自定义宏（返回是否存在过） */
export function unregisterMacro(name: string): boolean {
  return customMacros.delete(name.trim().toLowerCase())
}

/** 字符串模板类自定义宏清单（持久化/跨端同步用；函数类不可序列化，不列出） */
export function listCustomMacros(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of customMacros) if (typeof v === 'string') out[k] = v
  return out
}

/** 水合（启动/拉取时合并持久化条目；不影响函数类注册） */
export function hydrateCustomMacros(entries: Record<string, string>): void {
  for (const [k, v] of Object.entries(entries ?? {})) {
    const key = k.trim().toLowerCase()
    if (!CUSTOM_MACRO_NAME.test(key) || BUILTIN_MACRO_NAMES.has(key)) continue
    if (typeof v === 'string') customMacros.set(key, v)
  }
}

/** 嵌套展开上限（宏求值产物再含 {{…}} 时迭代；防 setvar/getvar 自引用死循环） */
export const MACRO_MAX_ROUNDS = 10

/**
 * 展开文本中的全部宏（顺序求值：setvar 写入后，同文本后序 getvar 可读回；
 * 求值产物里的宏迭代展开，上限 MACRO_MAX_ROUNDS 轮）。未知宏保留原文。
 */
export function expandTavernMacros(text: string, ctx: TavernMacroContext): TavernMacroResult {
  const writes: TavernMacroWrite[] = []
  /** setvar/addvar 本地覆盖层：同一次展开内 getvar 先看它，再回落 ctx.getVar */
  const overlay: Record<string, unknown> = {}
  let current = text
  let unknownMacros: string[] = []
  for (let round = 0; round < MACRO_MAX_ROUNDS; round++) {
    const r = expandOnce(current, ctx, overlay, writes)
    unknownMacros = r.unknownMacros
    if (r.text === current || !r.text.includes('{{')) { current = r.text; break }
    current = r.text
  }
  return { text: current, writes, unknownMacros }
}

/** 单轮展开（顺序求值；setvar/addvar 系写入累积进 overlay 与 writes） */
function expandOnce(
  text: string,
  ctx: TavernMacroContext,
  overlay: Record<string, unknown>,
  writes: TavernMacroWrite[],
): { text: string; unknownMacros: string[] } {
  const unknownMacros: string[] = []
  const now = ctx.now ?? new Date()
  const rawHash = fnv1a(text)
  /**
   * 动态宏表（键**统一小写**后查找）。基准在装配阶段就把键归一：
   * `env.dynamicMacros[key.toLowerCase()] = value`（`MacroEnvBuilder.js:161-163`），
   * 随后 `#resolveMacro` 以 `name.toLowerCase()` 命中（`MacroEngine.js:178`）——
   * 即 `{{Dyn}}` / `{{dyn}}` 命中同一个 `dynamicMacros.Dyn`。
   */
  const dynMacros = ((): Record<string, string | ((args: string, c: TavernMacroContext) => string)> | undefined => {
    if (ctx.dynamicMacros === undefined) return undefined
    const m: Record<string, string | ((args: string, c: TavernMacroContext) => string)> = {}
    for (const [k, v] of Object.entries(ctx.dynamicMacros)) m[k.toLowerCase()] = v
    return m
  })()

  const readVar = (path: string): unknown => {
    const local = readVarPath(overlay, path)
    if (local !== undefined) return local
    return ctx.getVar?.(path)
  }
  /**
   * 【T-22 2026-09-11】全局变量的**专用**读取（`{{getglobalvar}}` 族）。
   * 与 `readVar` 的三级合并视图不同：global 族只认全局树（ST `getGlobalVariable` 读
   * `extension_settings.variables.global[name]`，看不到 chat/character 作用域）。
   * 本次展开内刚写过的值优先（顺序求值）；未注入 sync 读取器时回落合并视图，避免
   * 无 scopeGet 的调用方（如组装期）恒读空。
   */
  const readGlobalVar = (path: string): unknown => {
    const local = readVarPath(overlay, path)
    if (local !== undefined) return local
    const scoped = ctx.scopeGet?.('global', path)
    if (scoped !== undefined) return scoped
    return ctx.getVar?.(path)
  }
  /** C2 类宏作用域读取：scopeGet(kind) → preset 缺档回落 global → 兜底 getVar（向后兼容） */
  const readScopeVar = (kind: 'chat' | 'character' | 'preset' | 'global', path: string): unknown => {
    let v = ctx.scopeGet?.(kind, path)
    if (v === undefined && kind === 'preset') v = ctx.scopeGet?.('global', path)
    if (v === undefined) v = readVar(path)
    return v
  }
  /** format_* 族输出：数字 → 千分位字符串，否则与 get 族同款字符串化 */
  const formatVar = (v: unknown): string => {
    if (typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('en-US')
    return stringifyVar(v)
  }
  /** 数值写宏共用：读现值（非数按 0）→ 加 delta → 落 overlay + writes，输出空串 */
  const addNumericVar = (path: string, delta: number, scope?: 'global'): string => {
    if (!path) return ''
    const cur = Number(scope === 'global' ? readGlobalVar(path) : readVar(path))
    const next = (Number.isFinite(cur) ? cur : 0) + delta
    return writeVarMacro(path, String(next), scope)
  }
  const writeInto = (tree: Record<string, unknown>, path: string, value: unknown): void => {
    const next = writeVarPath(tree, path, value)
    for (const k of Object.keys(tree)) delete tree[k]
    Object.assign(tree, next)
  }

  /**
   * 定点写入共用（setvar 与 T-22 的 setglobalvar 族）。
   * `scope === 'global'` 时 writes 带显式作用域——落盘方据此写全局树，不受「当前有无
   * sessionId/slug」影响（ST：`setGlobalVariable` 只写 `extension_settings.variables.global`）。
   */
  const writeVarMacro = (path: string, value: string, scope?: 'global'): string => {
    if (!path) return ''
    const pointer = toPointer(path)
    writeInto(overlay, path, value)
    writes.push(scope === undefined ? { path: pointer, value } : { path: pointer, value, scope })
    ctx.setVar?.(pointer, value)
    return ''
  }
  /** addvar 系的路径/增量拆分（`::` 或 `:` 分隔，与 setvar 同款容错） */
  const splitVarArgs = (args: string): { path: string; rest: string } => {
    const sep = args.indexOf('::') >= 0 ? '::' : ':'
    const at = args.indexOf(sep)
    return { path: (at >= 0 ? args.slice(0, at) : args).trim(), rest: at >= 0 ? args.slice(at + sep.length) : '' }
  }

  const result = text.replace(MACRO_PATTERN, (full, body: string, offset: number) => {
    // 本次回调是否落到「未识别宏」分支（决定 postProcess 是否适用，见下）
    let unknown = false
    const out = ((): string => {
    // 注释宏优先（{{// …}} 与 {{! …}}）
    if (body.startsWith('//') || body.startsWith('!')) return ''
    // 带参宏统一拆分：name::rest 或 name:rest
    const sep = body.indexOf('::') >= 0 ? '::' : ':'
    const sepAt = body.indexOf(sep)
    const name = (sepAt >= 0 ? body.slice(0, sepAt) : body).trim()
    const args = sepAt >= 0 ? body.slice(sepAt + sep.length) : ''

    switch (name) {
      case 'user':
        return ctx.user
      case 'char':
        return ctx.char
      case 'persona':
        return ctx.persona ?? ''
      case 'noop':
        return ''

      case 'getvar':
        return stringifyVar(readVar(args.trim()))
      case 'setvar': {
        // value = 第二个分隔符之后的全部（允许空值——初始化语义 {{setvar::think1::}}）
        const { path, rest } = splitVarArgs(args)
        return writeVarMacro(path, rest.replace(/^\s+|\s+$/g, ''))
      }
      case 'addvar': {
        // {{addvar::path::数}}：现值（非数按 0）加 delta，输出空串
        const { path, rest } = splitVarArgs(args)
        const delta = Number(rest.trim())
        return addNumericVar(path, Number.isFinite(delta) ? delta : 0)
      }
      case 'incvar':
        return addNumericVar(args.trim(), 1)
      case 'decvar':
        return addNumericVar(args.trim(), -1)

      // 【T-22 2026-09-11】全局变量宏族——此前只落了斜杠形态（triggerSlash 里
      // /setglobalvar），宏形态完全缺失：真卡（ExampleGame 等）大量用 {{setglobalvar::…}}，
      // 缺失时整串被当未知宏原样留在提示词里且**变量从不写入**。
      // 语义对齐基准（TT variables.js:250-259 + setGlobalVariable/getGlobalVariable）：
      //   set/add/inc/dec → 写 global 树，输出空串；get → 只读 global 树。
      case 'setglobalvar': {
        const { path, rest } = splitVarArgs(args)
        return writeVarMacro(path, rest.replace(/^\s+|\s+$/g, ''), 'global')
      }
      case 'addglobalvar': {
        const { path, rest } = splitVarArgs(args)
        const delta = Number(rest.trim())
        return addNumericVar(path, Number.isFinite(delta) ? delta : 0, 'global')
      }
      case 'incglobalvar':
        return addNumericVar(args.trim(), 1, 'global')
      case 'decglobalvar':
        return addNumericVar(args.trim(), -1, 'global')
      case 'getglobalvar':
        return stringifyVar(readGlobalVar(args.trim()))

      // C2 类宏（MVU 作用域变量）：get 走 scopeGet（保持 unknown 语义——未命中不吞原文由 stringifyVar 决定）
      case 'get_message_variable':
      case 'get_chat_variable':
        return stringifyVar(readScopeVar('chat', args.trim()))
      case 'get_character_variable':
        return stringifyVar(readScopeVar('character', args.trim()))
      case 'get_preset_variable':
        return stringifyVar(readScopeVar('preset', args.trim()))
      case 'get_global_variable':
        return stringifyVar(readScopeVar('global', args.trim()))
      case 'format_message_variable':
      case 'format_chat_variable':
        return formatVar(readScopeVar('chat', args.trim()))
      case 'format_character_variable':
        return formatVar(readScopeVar('character', args.trim()))
      case 'format_preset_variable':
        return formatVar(readScopeVar('preset', args.trim()))
      case 'format_global_variable':
        return formatVar(readScopeVar('global', args.trim()))

      case 'random': {
        const list = splitMacroList(args)
        if (list.length === 0) return ''
        return list[Math.floor(Math.random() * list.length)]
      }
      case 'pick': {
        const list = splitMacroList(args)
        if (list.length === 0) return ''
        const seed = fnv1a(`${ctx.stableSeed ?? ''}-${rawHash}-${offset}`)
        const rng = mulberry32(seed)
        return list[Math.floor(rng() * list.length)]
      }
      case 'roll':
      case 'dice': {
        const formula = args.trim()
        const norm = /^\d+$/.test(formula) ? `1d${formula}` : formula
        const r = rollDice(norm)
        return r == null ? '' : String(r)
      }

      case 'time':
        return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      case 'date':
        return now.toLocaleDateString('zh-CN')
      case 'datetime':
        return `${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
      case 'weekday':
        return `星期${WEEKDAYS[now.getDay()]}`
      case 'isotime':
        return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      case 'isodate': {
        // 本地时区 YYYY-MM-DD（toISOString 是 UTC，日期会偏）
        const p2 = (n: number): string => String(n).padStart(2, '0')
        return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
      }

      default: {
        // 动态宏**优先于**注册宏（基准：`MacroEngine.js:178-220` 命中 dynamicMacros 即作
        // defOverride 覆盖注册表；键统一小写比较，`MacroEnvBuilder.js:161-163`）
        const dyn = dynMacros?.[name.toLowerCase()]
        if (dyn !== undefined) {
          if (typeof dyn === 'function') {
            try { return dyn(args, ctx) } catch { return full }
          }
          return dyn
        }
        // L1b：自定义宏（注册表；内置名不会走到这里——switch 已命中）
        const custom = customMacros.get(name.toLowerCase())
        if (custom !== undefined) {
          if (typeof custom === 'function') {
            try { return custom(args, ctx) } catch { return full }
          }
          return custom
        }
        unknownMacros.push(full)
        unknown = true
        return full
      }
    }
    })()
    // postProcess 只作用于**已解析**的宏：未知宏在基准里于 executeMacro 之前就 return raw
    //（`MacroEngine.js:214-216`），加工它会把 `{{未知}}` 的字面量也改掉（例如正则转义钩子
    // 会把大括号转义成 `\{\{…\}\}`），属与基准的偏离。
    if (unknown) return out
    const pp = ctx.postProcess
    if (pp === undefined) return out
    // 钩子抛错 → 返回未加工结果（基准 `MacroEngine.js:225-228` catch 后 `return result`）
    try { return pp(out) } catch { return out }
  })
  return { text: result, unknownMacros }
}
