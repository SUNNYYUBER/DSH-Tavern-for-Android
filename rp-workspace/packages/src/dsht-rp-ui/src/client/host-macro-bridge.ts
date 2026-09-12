/**
 * host-macro-bridge.ts — 宿主页 `SillyTavern.getContext()` 的**同步**宏门面（T-44，心跳 51）
 * ============================================================================
 * 【问题】
 *   卡脚本（`inject.js`）在宿主帧调用 `ctx.substituteParams(...)` / `ctx.substituteParamsExtended(...)`
 *   并**当场取用返回值**（`inject.js:3211-3212` 建 `{prefix, suffix}` 对象、`:4477` `replaceAll`、
 *   `:4544` 直接 return）。即这个 API **必须是同步的**。
 *   而我们的宏求值真值在服务端（`/dsht-tavern-helper/macros/expand`，HTTP 异步）→ 无法直接桥接。
 *
 * 【解法：单源引擎 + 同步环境缓存】
 *   引擎本身**是纯函数、零依赖**（`dsht-plugin-shared/macros.ts`，全文件 0 个 import），
 *   可直接被客户端 bundle 打进宿主页 → 同步求值不再是问题。缺的只是**数据**：
 *   身份（user/char/persona）、变量树、自定义宏。这三样本来就已经有一条客户端拉取链
 *   （`display-compiler.ts:loadDisplayRenderCtx`，5s TTL 缓存，供显示期宏展开用）——
 *   本模块**复用它**，只额外补「按作用域分树」（C2 类宏 `get_character_variable` 等需要），
 *   然后把结果放进一个**同步可读的槽位**。
 *
 * 【硬约束（T-44 补记③）】**禁止另写一份宏引擎**。
 *   本模块只做「取数据 + 调 `expandTavernMacros`」，一行宏语义都不实现
 *   —— 否则就是与基准的又一份漂移实现（参见 T-35 的 4 份 deep-merge 教训）。
 *
 * 【降级语义（有意，且可观测）】
 *   宏环境未就绪（RP 会话未打开 / 数据面拉取失败）时 **返回原文**，不伪造身份
 *   （不是拿 `'角色'` 之类的占位串去替换 —— 那会让正则静默匹配错）。
 *   与 `macros-display.ts:expandDisplayMacros(text, null)` 的既有降级口径一致。
 *   降级会 `console.warn` 一次（按 key 去重），避免变成「L42 有意跳过却不出声」。
 *
 * 【已知不支持（如实登记，不假装）】
 *   ST `options.original`（`{{original}}` 一次性宏）与 `groupOverride`（`{{group}}`）：
 *   本引擎当前没有这两个宏（未知宏原样保留）。卡脚本在 substituteParams 上未使用它们；
 *   若将来出现实测报错，按 T-45 登记再补，不在本模块私自实现。
 *
 * @module dsht-rp-ui/client/host-macro-bridge
 */

import {
  expandTavernMacros,
  hydrateCustomMacros,
  readVarPath,
  type TavernMacroContext,
} from '../../../dsht-plugin-shared/macros.ts'
import { loadDisplayRenderCtx } from './display-compiler.ts'

/** 环境缓存 TTL（与显示期数据面同量级：5s —— 渲染期高频重入，长 TTL 会拖住设置改动生效） */
const ENV_TTL = 5000

/** 同步宏环境（宿主帧 `substituteParams` 的取数来源） */
export interface HostMacroEnv {
  /** 缓存键 `slug::sessionId` */
  readonly key: string
  readonly user: string
  readonly char: string
  readonly persona: string
  /** 三级合并视图（`/dsht-tavern-helper/variables/merged`）→ `{{getvar::}}` / `{{get_chat_variable::}}` 兜底 */
  readonly variables: Record<string, unknown>
  /** 按作用域分树 → C2 类宏 `{{get_character_variable::}}` / `{{get_preset_variable::}}` 等 */
  readonly scopes: {
    readonly global: Record<string, unknown>
    readonly character: Record<string, unknown>
    readonly chat: Record<string, unknown>
  }
  readonly at: number
}

let env: HostMacroEnv | null = null
let inflightKey: string | null = null
/** 已就降级告警过的键（避免高频调用把 console 刷爆） */
const warnedKeys = new Set<string>()

/** 只测试用：丢弃同步环境（避免用例间串味） */
export function __resetHostMacroEnv(): void {
  env = null
  inflightKey = null
  warnedKeys.clear()
}

/** 同步读当前环境（未就绪 → null；不触发任何网络请求） */
export function getHostMacroEnv(): HostMacroEnv | null {
  return env
}

/** 环境是否新鲜（TTL 内） */
function isFresh(e: HostMacroEnv, key: string, now: number): boolean {
  return e.key === key && now - e.at < ENV_TTL
}

/**
 * 取按作用域分树（best-effort：失败 → 空树，由引擎的 `scopeGet` 回落链兜底）。
 * `scopeArgError`（`index.ts:42-49`）：character 需 slug、chat 需 sessionId、global 无需参数。
 *
 * ⚠️ **失败必须留痕**（L42：有意降级 ≠ 可以静默）。空树本身是**正确**的降级语义
 *（引擎会走回落链），但"服务端 500 / 参数不全 / 网络断"与"该作用域确实没有变量"
 *在调用点**完全等价**，若不打日志就再也分不出来 —— 那正是本项目的主力缺陷形态。
 * 这里按 `scope:原因` 去重告警（借用 `warnedKeys`，避免高频渲染把 console 刷爆）。
 */
async function fetchScope(scope: 'global' | 'character' | 'chat', slug: string, sessionId: string): Promise<Record<string, unknown>> {
  const warnOnce = (why: string): void => {
    const k = `scope:${scope}:${why}`
    if (warnedKeys.has(k)) return
    warnedKeys.add(k)
    console.warn(`[dsht-rp-ui] 宏环境作用域 ${scope} 取数失败（该作用域变量将为空）: ${why}`)
  }
  try {
    const q = new URLSearchParams({ scope })
    if (slug) q.set('slug', slug)
    if (sessionId) q.set('sessionId', sessionId)
    const r = await fetch(`/dsht-tavern-helper/variables?${q.toString()}`)
    if (!r.ok) {
      warnOnce(`HTTP ${r.status}`)
      return {}
    }
    const b = await r.json() as { variables?: Record<string, unknown> }
    return (b.variables !== null && typeof b.variables === 'object') ? b.variables : {}
  } catch (e) {
    warnOnce(`请求异常 ${(e as Error).message}`)
    return {}
  }
}

/**
 * 预热/刷新同步宏环境。由会话快照装载时调用（`RpScriptHost.loadContextSnapshot`）。
 *
 * - 同一 `slug::sessionId` 且 TTL 内 → 直接跳过（不重复打服务端）；
 * - 已有在飞的同 key 请求 → 不重复发起（避免快照高频推送造成请求堆积）；
 * - **不抛错**：数据面失败时保留旧环境（若有），门面继续可用；
 * - `sessionId` 为空 = RP 会话已关闭 → **清空**环境（否则会用上一个角色的身份做替换）。
 */
export function refreshHostMacroEnv(
  slug: string | null | undefined,
  sessionId: string | null | undefined,
  /**
   * 【心跳 64】环境就绪回调（可选，向后兼容 —— 返回值仍为 `void`）。
   *
   * 动因：`name1`（用户名）只在宏环境里，而本函数是**异步水合**的；调用方
   * （`RpScriptHost.loadContextSnapshot`）在**同一轮同步**里就要把上下文快照推给帧，
   * 那时 `env` 往往还是旧值/null ⇒ 帧内 `name1` 首帧恒 undefined。
   * 给了这个回调，调用方就能在**真正就绪时重推一次快照**。
   *
   * 语义保证：**只要返回值可用就一定回调**（缓存命中时**同步**回调，避免"明明有值却不通知"）。
   * 正在水合（`inflightKey === key`）时不回调 —— 由**先发起的那一次**的回调负责通知。
   */
  onReady?: (env: HostMacroEnv) => void,
): void {
  const s = typeof slug === 'string' ? slug : ''
  const sid = typeof sessionId === 'string' ? sessionId : ''
  if (!s || !sid) {
    env = null
    inflightKey = null
    return
  }
  const key = `${s}::${sid}`
  const now = Date.now()
  if (env !== null && isFresh(env, key, now)) { onReady?.(env); return }
  if (inflightKey === key) return
  inflightKey = key
  void (async () => {
    try {
      // 身份/变量/自定义宏沿用既有显示期数据面（单源；内部 5s TTL 缓存）
      const [display, g, c, ch] = await Promise.all([
        loadDisplayRenderCtx(s, sid),
        fetchScope('global', '', ''),
        fetchScope('character', s, ''),
        fetchScope('chat', '', sid),
      ])
      if (display === null) return // 数据面不可用 → 保留旧环境（不把好数据换成空的）
      // L1b：自定义宏与显示期同源（注册表水合；服务端 runMacroExpand 同样先 hydrate）
      hydrateCustomMacros(display.customMacros ?? {})
      env = {
        key,
        user: display.user,
        char: display.char,
        persona: display.persona ?? '',
        variables: display.variables ?? {},
        scopes: { global: g, character: c, chat: ch },
        at: Date.now(),
      }
      // 就绪通知（放在赋值之后：回调里读 getHostMacroEnv() 一定拿到新值）
      onReady?.(env)
    } catch {
      /* 保留旧环境；门面按「原文透传」降级 */
    } finally {
      if (inflightKey === key) inflightKey = null
    }
  })()
}

/** 宏环境未就绪时告警一次（按 key 去重；键含「未登录/未打开」语义便于归因） */
function warnDegradedOnce(reason: string): void {
  if (warnedKeys.has(reason)) return
  warnedKeys.add(reason)
  console.warn(`[dsht-rp-ui] substituteParams 降级为原文透传：${reason}`)
}

/** ST `substituteParams(content, options)` 的 options 面（`script.js:2922-2935` 的文档签名） */
export interface SubstituteParamsOptions {
  name1Override?: string
  name2Override?: string
  original?: string
  groupOverride?: string
  replaceCharacterCard?: boolean
  dynamicMacros?: Record<string, string | ((args: string, ctx: TavernMacroContext) => string)>
  postProcessFn?: (x: string) => string
}

/**
 * 宿主帧同步宏展开 —— `ctx.substituteParams` / `ctx.substituteParamsExtended` 的单实现。
 *
 * **双签名**（对齐基准 `script.js:2922-2945`）：
 *  ① `substituteParams(content, options)` —— options 为普通对象时按新签名解析；
 *  ② `substituteParams(content, name1, name2, original, group, replaceCharacterCard, additionalMacro, postProcessFn)`
 *     —— 基准检测到第 2 参**不是**对象时 `substituteParamsLegacy.call(this, ...arguments)`
 *     （`script.js:2940-2942`），故位置参数必须照样支持。
 *     卡脚本实际用法：`ctx.substituteParams(trimString, undefined, characterOverride)`
 *     （`inject.js:4477`）—— 第 3 参是 **name2Override**，不是别的。
 *
 * `content` 为假值 → `''`（基准 `if (!content) return ''`，`script.js:2923`）；
 * 非字符串 → `String()` 强转并告警（基准 `script.js:2925-2928`）。
 */
export function hostSubstituteParams(
  content: unknown,
  arg2?: unknown, arg3?: unknown, arg4?: unknown, arg5?: unknown,
  arg6?: unknown, arg7?: unknown, arg8?: unknown,
): string {
  if (!content) return ''
  let text: string
  if (typeof content === 'string') {
    text = content
  } else {
    console.warn('[dsht-rp-ui] substituteParams: content 将被强转为字符串', content)
    text = String(content)
  }
  if (!text.includes('{{')) return text // 快路径：无宏（绝大多数调用）

  const isOptionsObject = arg2 !== null && arg2 !== undefined && typeof arg2 === 'object' && !Array.isArray(arg2)
  const o: SubstituteParamsOptions = isOptionsObject
    ? (arg2 as SubstituteParamsOptions)
    : {
      // 位置参数（legacy）映射：见上方签名②
      name1Override: arg2 as string | undefined,
      name2Override: arg3 as string | undefined,
      original: arg4 as string | undefined,
      groupOverride: arg5 as string | undefined,
      replaceCharacterCard: arg6 as boolean | undefined,
      dynamicMacros: arg7 as SubstituteParamsOptions['dynamicMacros'],
      postProcessFn: arg8 as SubstituteParamsOptions['postProcessFn'],
    }

  const e = env
  if (e === null) {
    warnDegradedOnce('宏环境未就绪（RP 会话未打开或数据面拉取失败）')
    return text
  }

  const r = expandTavernMacros(text, {
    user: o.name1Override !== undefined ? o.name1Override : e.user,
    char: o.name2Override !== undefined ? o.name2Override : e.char,
    persona: e.persona,
    getVar: (path: string) => readVarPath(e.variables, path),
    scopeGet: (kind, path) => readVarPath(
      kind === 'character' ? e.scopes.character : kind === 'chat' ? e.scopes.chat : e.scopes.global,
      path,
    ),
    stableSeed: `rp-${e.key}`, // 同会话同文本 → pick 稳定（与显示期一致）
    dynamicMacros: o.dynamicMacros,
    postProcess: typeof o.postProcessFn === 'function' ? o.postProcessFn : undefined,
  })
  return r.text
}

/**
 * `substituteParamsExtended(content, additionalMacro, postProcessFn)`
 * = `substituteParams(content, {dynamicMacros, postProcessFn})`（基准 `script.js:2756-2757`，已标注 deprecated）。
 *
 * 形参声明为 `unknown` 而不是收窄类型：本函数是**卡脚本 → 运行时**的边界，
 * 卡传进来的东西不可信。收窄类型只会在编译期骗过自己（设备实测里第 2 参就是裸 `{}`，
 * 第 3 参可能是非法值），所以这里按实收值做运行时归一。
 */
export function hostSubstituteParamsExtended(
  content: unknown,
  additionalMacro?: unknown,
  postProcessFn?: unknown,
): string {
  // additionalMacro 必须是纯对象；数组 / 原始值一律丢弃（基准侧 MacroEnvBuilder 也只吃键值对）
  const isDynObject =
    additionalMacro !== null && additionalMacro !== undefined &&
    typeof additionalMacro === 'object' && !Array.isArray(additionalMacro)
  if (additionalMacro !== null && additionalMacro !== undefined && !isDynObject) {
    console.warn('[dsht-rp-ui] substituteParamsExtended: additionalMacro 非对象，已忽略:', additionalMacro)
  }
  if (postProcessFn !== undefined && typeof postProcessFn !== 'function') {
    console.warn('[dsht-rp-ui] substituteParamsExtended: postProcessFn 非函数，已忽略:', postProcessFn)
  }
  return hostSubstituteParams(content, {
    dynamicMacros: isDynObject ? (additionalMacro as SubstituteParamsOptions['dynamicMacros']) : {},
    postProcessFn: typeof postProcessFn === 'function' ? (postProcessFn as (x: string) => string) : undefined,
  })
}
