/**
 * 世界书关键词的安全正则编译（T-78：关键词语义的安全防护，单源）
 *
 * ## 缺陷背景（实机核实，非推测）
 * 原 `trigger.ts` 的 `keyToPattern`（旧 :124-137）把世界书条目的关键词直接编译成 `RegExp`，
 * 随后在 `matchPrimary` / `matchSecondary` 里 `.test(text)`。**唯一的保护是 try/catch**——
 * 它只挡得住非法正则（语法错误），**完全挡不住指数回溯（ReDoS）**：
 * 一条形如 `(a+)+$` 的 `use_regex` 关键词遇到长输入会把事件循环卡死，且**零日志线索**
 * （原 catch 体是空注释，见旧 :144-146 / :157-159）。
 *
 * 世界书条目内容来自**用户导入的卡 / 世界书**，属不可信输入 —— 这是本防护的存在理由。
 *
 * ## 为什么是「同步防护组合」而不是 worker_threads 硬超时
 * 另一种常见实现形态是在 `worker_threads` 里编译+匹配，父线程 250ms 硬超时后
 * `terminate()`。本仓库**不能**采用，理由是调用链契约：
 *   · `packages/src/import/browser-entry.ts:7` 把 `triggerWorldInfo` 导出为
 *     `window.DSHT.triggerWorldInfo`（esbuild --format=iife --global-name=DSHT），
 *     消费点是**同步**的：`packages/verify-bundle.cjs:18` 直接取返回值（非 await）。
 *   · 该 bundle 跑在 **Android WebView** 里，没有 `worker_threads`，引入 `node:*` 会构建/运行双炸。
 *   · dsh-plugin 侧虽是 async 上下文（`index.ts:4245-4248` 在 `Promise.resolve(triggerWorldInfo(...))`
 *     外面包了 waterfall），但把 `triggerWorldInfo` 改成 async 会**反向破坏 browser 侧契约**
 *     （window.DSHT.triggerWorldInfo 返回值从 TriggerResult 变成 Promise，WebView 里的
 *     verify-bundle 与任何宿主调用点全部静默拿到 Promise 而非结果）。
 * ⇒ 结论：**不改签名**，走同步防护组合。`worker_threads` 在本机 node v24 上实测可用
 *   （见 T-78 汇报的探针输出：编译+匹配在 worker 内、父线程 250ms terminate() 生效），
 *   但**仅限 node 侧可用性成立**；Android 侧可用性未做设备实测。
 *
 * ## 本模块提供的四道同步闸门（每一道都出声 + 可定位 + 按原因去重）
 *   1. 单 pattern 长度上限（默认 512）
 *   2. 单次扫描的编译规则数上限（默认 128，命中缓存的重复 pattern 不重复计费）
 *   3. flags 白名单 `/^[imsu]*$/`（从根上排除 `g`/`y` 的跨匹配状态与 `d`/`v` 在旧运行时抛错）
 *   4. 危险模式静态拒绝：嵌套量词 `(x+)+`/`(x*)*`/`(x{2,3})+`，以及首字符可重叠的
 *      交替组 + 无限量词 `(a|aa)+`（保守启发式，判据见 detectStaticRisk）
 *   外加：扫描文本长度上限（默认 32768，超出截断并出声）。
 *
 * ## 已知局限（诚实标注，不粉饰）
 * 静态启发式是**保守子集**，无法穷尽所有 ReDoS 形态（例如 `\d+\d+\d+` 类的多项式回溯、
 * 反向引用构造的爆炸）。真正的兜底是「执行期硬超时」，而同步路径做不到（同步阻塞无法中断），
 * 这正是 worker 方案存在的原因。若将来调用链允许 async / node 侧优先，应把
 * `compile` + `.test` 整体挪进 worker 并加 250ms terminate 兜底。
 *
 * ## 出声（项目铁律 L42：有意降级 ≠ 可以静默）
 * 每次降级都产出 `DegradeEvent`（含 `entryId` + `reason` + `detail`）：
 *   · 进返回值 `TriggerResult.degradations` —— 本轮**完整**记录，调用方可直观呈现；
 *   · 同时经 sink 出声（默认 `console.warn`）—— **按 `entryId|reason` 去重**，
 *     避免每条每轮刷屏；跨轮（同一条目同一原因）只报一次。
 */

/** 防护限额（可整体替换；默认值是下面这些经验值，按需上调即可） */
export interface SafeRegexLimits {
  /** 单条 pattern 字符数上限 */
  maxPatternLength: number
  /** 单次扫描（一次 triggerWorldInfo 调用，含递归轮）新增编译的规则数上限 */
  maxRulesPerScan: number
  /** 扫描文本字符数上限，超出截断（截断必须出声） */
  maxTextLength: number
  /** 已编译 RegExp 的复用缓存容量（命中即复用，不再计费/不再检查） */
  compileCacheSize: number
  /** 出声去重集合容量；超出则清空重来（保证仍会出声，而不是静默） */
  dedupeCapacity: number
}

export const SAFE_REGEX_LIMITS: SafeRegexLimits = {
  maxPatternLength: 512,
  maxRulesPerScan: 128,
  maxTextLength: 32768,
  compileCacheSize: 512,
  dedupeCapacity: 4096,
}

/** flags 白名单：只允许 i/m/s/u。`g`/`y` 带跨匹配状态（lastIndex），`d`/`v` 在旧运行时直接抛错 */
export const ALLOWED_REGEX_FLAGS = /^[imsu]*$/

/** 降级原因（每一项都要能定位、能解释，不允许出现无因降级） */
export type DegradeReason =
  /** flags 不在白名单 */
  | 'flags-not-allowed'
  /** pattern 超长 */
  | 'pattern-too-long'
  /** 本次扫描编译规则数超限 */
  | 'rules-exceeded'
  /** 静态拒绝：量词直接套在含量词的结构上（指数回溯） */
  | 'nested-quantifier'
  /** 静态拒绝：量词套在首字符可重叠的交替组上（指数回溯） */
  | 'alternation-ambiguity'
  /** 无法编译为正则（语法错误；等价于原 try/catch 分支，但改为一等公民降级） */
  | 'syntax-error'
  /** 扫描文本超长被截断 */
  | 'text-truncated'

/** 一次降级事件（出声与返回值共用的载体） */
export interface DegradeEvent {
  /**
   * 触发降级的条目 id（`LoreEntry.id`）。
   * 注意：`text-truncated` 是**扫描文本级**事件，不属于任何单条条目，
   * 其 entryId 形如 `(scan:round=N)` —— 诚实标注定位维度是「轮次」而非「条目」。
   */
  entryId: string
  reason: DegradeReason
  /** 定位细节：关键词原文片段 / pattern 片段 / 实际长度 vs 上限 */
  detail: string
}

/** 单条关键词的编译上下文 */
export interface CompileContext {
  /** 条目 id（降级定位用，必须传） */
  entryId: string
  /** 全局关键词大小写敏感（沿用原 keyToPattern 语义） */
  caseSensitive: boolean
  /** 全词匹配（沿用原 keyToPattern 语义） */
  wholeWords: boolean
}

/** 一次扫描会话（= 一次 triggerWorldInfo 调用，含全部递归轮） */
export interface ScanSession {
  /** 本轮**全部**降级事件（完整记录；出声另走去重） */
  readonly degraded: DegradeEvent[]
  /** 编译关键词；降级时返回 null（已记录并出声），调用方按「不命中」处理 */
  compile(rawKey: string, ctx: CompileContext): RegExp | null
  /** 规范化扫描文本（超长截断并出声） */
  normalizeText(text: string, where: string): string
}

// ---------------------------------------------------------------------------
// 静态风险识别（保守启发式）
// ---------------------------------------------------------------------------

interface RiskHit {
  reason: 'nested-quantifier' | 'alternation-ambiguity'
  detail: string
}

/** 解析量词，返回最大重复次数（Infinity = 无上界）与消费到的下标；非量词返回 null */
function parseQuantifier(p: string, i: number): { max: number; next: number } | null {
  const c = p[i]
  if (c === '*') return { max: Infinity, next: i + 1 }
  if (c === '+') return { max: Infinity, next: i + 1 }
  if (c === '?') return { max: 1, next: i + 1 }
  if (c !== '{') return null
  const m = /^\{(\d+)(?:,(\d*))?\}/.exec(p.slice(i))
  if (!m) return null // `a{` 之类非量词形态 → 当字面量
  const min = Number(m[1])
  const max = m[2] === undefined ? min : (m[2] === '' ? Infinity : Number(m[2]))
  return { max, next: i + m[0].length }
}

/** 跳过字符类 `[...]`（含 `\x` 转义与首字符 `]` 字面量），返回 `]` 之后的下标 */
function skipCharClass(p: string, i: number): number {
  let j = i + 1
  if (p[j] === '^') j++
  if (p[j] === ']') j++ // `[]]`：首个 `]` 是字面量
  while (j < p.length) {
    if (p[j] === '\\') { j += 2; continue }
    if (p[j] === ']') return j + 1
    j++
  }
  return p.length
}

/** 读取组头 `(` 之后到组体起始的下标（区分普通组 / 命名组 / 断言 / 内联 flags） */
function readGroupHead(p: string, i: number): number {
  if (p[i + 1] !== '?') return i + 1
  const k = p[i + 2]
  if (k === '=' || k === '!' || k === ':') return i + 3
  if (k === '<') {
    const k2 = p[i + 3]
    if (k2 === '=' || k2 === '!') return i + 4 // 后顾断言 (?<= / (?<!
    const end = p.indexOf('>', i + 3) // 命名组 (?<name>
    return end < 0 ? i + 3 : end + 1
  }
  return i + 2 // (?i: 之类 JS 不支持的形态，容错跳过
}

/**
 * 首字符键是否相交（交替歧义判据）。
 * 键的取值：字面字符本身 / `*` = `.` 通配 / `C` = 字符类或 Unicode 属性 /
 * `D`/`W`/`S` = `\d`/`\w`/`\s` 类 / `\x` = 转义字面量 / `''` = 零宽（无原子）。
 * 保守规则：`*` 与 `C` 视为与任何非空键相交（宁可误拒，不放过爆炸）。
 */
function keysIntersect(a: string, b: string): boolean {
  if (a === '' || b === '') return false
  if (a === b) return true
  if (a === '*' || b === '*' || a === 'C' || b === 'C') return true
  // `\w` 含 `\d`：`(\w|\d)+` 是可重叠的
  if ((a === 'W' && b === 'D') || (a === 'D' && b === 'W')) return true
  return false
}

/**
 * 静态识别高风险结构（保守启发式：宁可误拒也不要卡死，误拒在 reason 里标明是静态拒绝）。
 *
 * 判据一 · 嵌套量词：外层量词允许重复 ≥2 次，且它作用的原子**内部已含量词**。
 *   例 `(a+)+` `(a*)*` `(a{2,3})+` `(?:\d+)+` `((a+))+` 命中；
 *   `(ab)+` `(a+b)` `a+` 不命中（内层无独立量词或不带外层量词）。
 *   豁免：外层量词上界 ≤1（`?` / `{0,1}` / `{1,1}` / `{1}`）不重复内层，不会指数爆炸
 *   —— 这条豁免是为了不误拒真实世界书里常见的 `/x(y+)?z/`。
 *
 * 判据二 · 交替歧义：量词允许重复 ≥2 次，且它作用的组内有首字符可重叠的顶级备选。
 *   例 `(a|aa)+` `(.|a)+` `([abc]|a)+` 命中；`(a|b)+` `(你|我|他)+` `(?:^|\W)` 不命中。
 *
 * 扫描器跳过转义、字符类，并用组栈把「组」折成一个原子（首原子键 + 内部含量词标志 +
 * 内部是否歧义交替），因此嵌套任意深度的组都能被正确折叠。
 */
function detectStaticRisk(pattern: string): RiskHit | null {
  interface Frame {
    /** 组内出现过量词 */
    quantified: boolean
    /** 本组顶级备选的「首原子键」列表（`|` 切分） */
    altKeys: string[]
    /** 当前备选的首原子键（null = 尚未遇到原子） */
    curKey: string | null
  }
  interface AtomInfo {
    key: string
    quantified: boolean
    ambiguous: boolean
  }

  const stack: Frame[] = [{ quantified: false, altKeys: [], curKey: null }]
  let last: AtomInfo | null = null

  const addAtom = (info: AtomInfo) => {
    const f = stack[stack.length - 1]
    if (f.curKey === null) f.curKey = info.key
    if (info.quantified) f.quantified = true
    last = info
  }

  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]

    if (c === '\\') {
      const n = pattern[i + 1] ?? ''
      if (n === '') { i++; continue } // 结尾孤立反斜杠：交给 new RegExp 抛语法错误
      if (n === 'b' || n === 'B') { last = null; i += 2; continue } // 零宽断言，不产生原子
      if (n === 'p' || n === 'P') { // \p{L} 类
        const end = pattern.indexOf('}', i + 2)
        addAtom({ key: 'C', quantified: false, ambiguous: false })
        i = end < 0 ? i + 2 : end + 1
        continue
      }
      if (n === 'k') { // 命名反向引用 \k<name>，不产生原子
        const end = pattern.indexOf('>', i + 2)
        last = null
        i = end < 0 ? i + 2 : end + 1
        continue
      }
      const classKey = n === 'd' || n === 'D' ? 'D' : n === 'w' || n === 'W' ? 'W' : n === 's' || n === 'S' ? 'S' : `\\${n}`
      addAtom({ key: classKey, quantified: false, ambiguous: false })
      i += 2
      continue
    }

    if (c === '[') {
      i = skipCharClass(pattern, i)
      addAtom({ key: 'C', quantified: false, ambiguous: false })
      continue
    }

    if (c === '(') {
      stack.push({ quantified: false, altKeys: [], curKey: null })
      last = null
      i = readGroupHead(pattern, i)
      continue
    }

    if (c === ')') {
      const f = stack.pop()
      i++
      if (!f) continue // 多余右括号：交给 new RegExp 抛语法错误
      const keys = [...f.altKeys]
      if (f.curKey !== null) keys.push(f.curKey)
      let ambiguous = false
      for (let a = 0; a < keys.length && !ambiguous; a++) {
        for (let b = a + 1; b < keys.length; b++) {
          if (keysIntersect(keys[a], keys[b])) { ambiguous = true; break }
        }
      }
      // 组折成一个原子：键 = 首原子键，内部量词/歧义标志上浮供外层量词判定
      addAtom({ key: f.curKey ?? '', quantified: f.quantified, ambiguous })
      continue
    }

    if (c === '|') {
      const f = stack[stack.length - 1]
      f.altKeys.push(f.curKey ?? '')
      f.curKey = null
      last = null
      i++
      continue
    }

    if (c === '^' || c === '$') { last = null; i++; continue } // 零宽锚点，不产生原子

    const q = parseQuantifier(pattern, i)
    if (q) {
      // 取局部快照：`last` 会被上面的嵌套函数 addAtom 赋值，TS 的控制流分析对
      // 「被闭包赋值的变量」在函数调用后不再保持收窄，直接用 `...last` 会报 TS2698。
      const prev = last as AtomInfo | null
      if (prev && q.max >= 2) {
        const snippet = JSON.stringify(pattern.slice(Math.max(0, i - 24), q.next))
        if (prev.quantified) {
          return { reason: 'nested-quantifier', detail: `量词 ${pattern.slice(i, q.next)} 直接套在含量词的结构上，存在指数回溯风险（模式片段 ${snippet}）` }
        }
        if (prev.ambiguous) {
          return { reason: 'alternation-ambiguity', detail: `量词 ${pattern.slice(i, q.next)} 套在首字符可重叠的交替组上，存在指数回溯风险（模式片段 ${snippet}）` }
        }
      }
      i = q.next
      if (pattern[i] === '?') i++ // 惰性标记（如 `a+?`），不是新量词
      stack[stack.length - 1].quantified = true
      if (prev) last = { key: prev.key, quantified: true, ambiguous: prev.ambiguous }
      continue
    }

    addAtom({ key: c === '.' ? '*' : c, quantified: false, ambiguous: false })
    i++
  }

  return null
}

// ---------------------------------------------------------------------------
// 防护执行器
// ---------------------------------------------------------------------------

/** 默认出声通道：console.warn（WebView 与 node 均可用；不依赖 node API） */
function defaultDegradeSink(e: DegradeEvent): void {
  console.warn(`[dsht-rp] 世界书关键词防护降级（T-78，不静默）：entry=${e.entryId} reason=${e.reason} detail=${e.detail}`)
}

/**
 * 安全正则编译器（跨轮持有去重集合与编译缓存）。
 *
 * 生命周期：调用方持有**单例**（见 `loreRegexGuard`），每轮 `beginScan()` 开一次扫描会话。
 * 去重集合跨会话保留（这是「同一条目同一原因只出声一次」的实现基础）；
 * `resetDedup()` 供测试与排查使用。
 */
export class RegexSafetyGuard {
  readonly limits: SafeRegexLimits
  private readonly sink: (e: DegradeEvent) => void
  /** 已出声过的 `entryId|reason`（跨轮去重，防刷屏） */
  private readonly reported = new Set<string>()
  /** 已编译 RegExp 复用缓存（跨轮；key = flags + NUL + pattern） */
  private readonly cache = new Map<string, RegExp>()

  constructor(opts: { limits?: Partial<SafeRegexLimits>; onDegrade?: (e: DegradeEvent) => void } = {}) {
    this.limits = { ...SAFE_REGEX_LIMITS, ...opts.limits }
    this.sink = opts.onDegrade ?? defaultDegradeSink
  }

  /** 开一次扫描会话（重置本轮规则计数；不清去重集合） */
  beginScan(): ScanSession {
    const degraded: DegradeEvent[] = []
    let ruleCount = 0

    const emit = (event: DegradeEvent, dedupeKey: string): void => {
      degraded.push(event) // 返回值：本轮完整记录（不去重）
      if (this.reported.has(dedupeKey)) return
      if (this.reported.size >= this.limits.dedupeCapacity) this.reported.clear()
      this.reported.add(dedupeKey)
      this.sink(event) // 出声：按原因去重
    }

    const compile = (rawKey: string, ctx: CompileContext): RegExp | null => {
      const entryId = ctx.entryId
      try {
        let pattern: string
        let flags: string
        const regexForm = rawKey.match(/^\/(.+)\/(\w*)$/)
        if (regexForm) {
          const userFlags = regexForm[2]
          if (!ALLOWED_REGEX_FLAGS.test(userFlags)) {
            emit({
              entryId, reason: 'flags-not-allowed',
              detail: `正则关键词 ${JSON.stringify(rawKey.slice(0, 80))} 的 flags "${userFlags}" 不在白名单 [imsu]（g/y 带跨匹配状态，d/v 在旧运行时可能直接抛错）`,
            }, `${entryId}|flags-not-allowed`)
            return null
          }
          pattern = regexForm[1]
          // 沿用原 keyToPattern 语义：用户写 i 或全局不区分大小写 → 加 i
          flags = userFlags.includes('i') || !ctx.caseSensitive ? 'i' : ''
        } else {
          const escaped = rawKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          // 全词匹配：ST 真实语义用 \W 边界（CJK 属 \w，中文词相邻不触发是 ST 已知行为）；
          // 含空格的多词关键词直接 includes 语义（ST 同款分支）
          pattern = ctx.wholeWords && !/\s/.test(rawKey) ? `(?:^|\\W)(${escaped})(?:$|\\W)` : escaped
          flags = ctx.caseSensitive ? '' : 'i'
        }

        if (pattern.length > this.limits.maxPatternLength) {
          emit({
            entryId, reason: 'pattern-too-long',
            detail: `pattern 长度 ${pattern.length} > 上限 ${this.limits.maxPatternLength}（关键词 ${JSON.stringify(rawKey.slice(0, 80))}）`,
          }, `${entryId}|pattern-too-long`)
          return null
        }

        const risk = detectStaticRisk(pattern)
        if (risk) {
          // detail 前缀固定为「静态模式拒绝」：与「语法错误」「运行期超限」区分开，
          // 便于用户在日志/UI 里识别这是**保守启发式的误拒**而非真实错误（宁可误拒不卡死）。
          emit({
            entryId, reason: risk.reason,
            detail: `静态模式拒绝：${risk.detail}（关键词 ${JSON.stringify(rawKey.slice(0, 80))}）`,
          }, `${entryId}|${risk.reason}`)
          return null
        }

        const cacheKey = `${flags}\u0000${pattern}`
        const cached = this.cache.get(cacheKey)
        if (cached) return cached // 已检查过，复用不再计费

        if (ruleCount >= this.limits.maxRulesPerScan) {
          // 本条被拒 → 该条目本轮不触发。返回值里逐条记录（可定位），日志按原因只出声一次。
          emit({
            entryId, reason: 'rules-exceeded',
            detail: `本次扫描编译规则数已达上限 ${this.limits.maxRulesPerScan}，关键词 ${JSON.stringify(rawKey.slice(0, 80))} 未编译（该条目本轮不会触发）`,
          }, 'rules-exceeded')
          return null
        }
        ruleCount++
        const re = new RegExp(pattern, flags)
        if (this.cache.size >= this.limits.compileCacheSize) this.cache.clear()
        this.cache.set(cacheKey, re)
        return re
      } catch (e) {
        // 等价于原 try/catch 分支，但升格为一等公民降级（原来这里是空注释 = 静默）
        emit({
          entryId, reason: 'syntax-error',
          detail: `关键词 ${JSON.stringify(rawKey.slice(0, 80))} 无法编译为正则：${(e as Error)?.message ?? String(e)}`,
        }, `${entryId}|syntax-error`)
        return null
      }
    }

    const normalizeText = (text: string, where: string): string => {
      if (text.length <= this.limits.maxTextLength) return text
      emit({
        entryId: `(scan:${where})`, reason: 'text-truncated',
        detail: `扫描文本 ${text.length} 字符 > 上限 ${this.limits.maxTextLength}，已截断；超出部分的关键词本轮不会命中`,
      }, 'text-truncated')
      return text.slice(0, this.limits.maxTextLength)
    }

    return { degraded, compile, normalizeText }
  }

  /** 清空出声去重记录（测试隔离 / 排查用；清空后同一条目同一原因会重新出声） */
  resetDedup(): void {
    this.reported.clear()
  }
}

/** 世界书触发引擎的进程级单例（跨轮去重与编译缓存的宿主） */
export const loreRegexGuard = new RegexSafetyGuard()

/** 清空单例的出声去重记录（测试与排查用） */
export function resetRegexGuardDedup(): void {
  loreRegexGuard.resetDedup()
}
