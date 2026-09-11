/**
 * 宿主环境 vendor 安装（host-vendor / vendor2）——复刻 TH third_party_object.initThirdPartyObject
 * + ST 自带全局。
 *
 * 背景：真酒馆助手（TH/JS-Slash-Runner）自己往宿主页注入全局——third_party_object.ts 里
 * globalThis.z = import * as z from 'zod'（zod v4 ^4.4.3 namespace）、globalThis.YAML；ST 宿主
 * 本身又自带 window.$（jQuery 3.5.1）/ window._（lodash）/ toastr / showdown。DSH webui 是
 * React 应用，这些全局一个都没有——脚本 iframe 放开 sandbox allow-same-origin 后（复刻真 TH
 * 同源形态，用户拍板），脚本里 window.parent.$ / window.parent.z 的取法（真 TH 脚本常态）
 * 需要宿主先有这些全局。
 *
 * vendor 源码：构建期 iife（scripts/build-rp-ui.mjs → th-host-vendor.gen.txt，lodash + jquery
 * + yaml + zod v4），client 启动时（client/index.tsx apply() 初始化处）经 installHostVendor
 * 求值一次；iife 内部同样用 ??= 缺失才装语义——双重保险，绝不覆盖宿主已有全局。
 */

// vendor2 iife 源码（构建期生成物，?raw 文本导入；raw.d.ts 补的模块形状声明覆盖 *?raw）
import hostVendorSource from './th-host-vendor.gen.txt?raw'
// 仅类型导入（构建期擦除，不产生运行时依赖/环）——宿主 ST 门面的快照形状与 iframe 侧同源
import type { ThContextSnapshot } from './th-shim.ts'
// 宿主 eventSource（T-39）：真 ST 的 getContext() 含 eventSource；卡的外链注入脚本用它挂事件
import { createThEventSource, type ThEventSource } from './th-event-source.ts'
// ST 事件名表（生成物；来源 public/scripts/events.js:3，104 条）
import { ST_EVENT_TYPES } from './st-event-types.gen.ts'
// 宿主面第二批成员（i18n / 弹窗 / 函数工具注册）——批次依据见该文件头（心跳 50 的静态枚举）
import {
  POPUP_RESULT, POPUP_TYPE, callGenericPopup, createHostI18n, createHostToolManager,
  type HostI18n, type HostToolManager,
} from './host-st-surface.ts'

/** 复刻的全局清单（缺失才装；z / Zod 双名字对齐真 TH 宿主形态） */
export const HOST_VENDOR_GLOBALS = ['_', '$', 'jQuery', 'z', 'Zod', 'YAML'] as const

/**
 * 纯函数：宿主缺失哪些全局（「缺失才装」判定，抽出来供单测锚定）。
 * 判据 = 宿主 window 上该键 === undefined；null / 已有值一律视为已存在，绝不覆盖。
 */
export function missingHostGlobals(
  host: Record<string, unknown>,
): Array<(typeof HOST_VENDOR_GLOBALS)[number]> {
  return HOST_VENDOR_GLOBALS.filter(k => host[k] === undefined)
}

// ---------------------------------------------------------------------------
// 宿主 FontAwesome（TH 脚本宿主注入 UI 的图标依赖）
// ---------------------------------------------------------------------------

/** 与脚本 iframe 同源 CDN（buildIframeDocument 的 FA link 同款 URL） */
export const HOST_FONTAWESOME_URL =
  'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css'

const HOST_FA_LINK_ID = 'dsht-host-fa-css'

/**
 * 宿主注入 FontAwesome（幂等）：真 TH 脚本的常态不是在自己 iframe 里画 UI，而是拿
 * window.parent.$ 把 UI append 进宿主 body（「飞讯 0703」的悬浮球/手机面板即此形态，
 * 实机实证：158 个 fx-* 元素全在宿主 document，球内 <i class="fa-solid fa-comment-dots">
 * 因宿主无 FA 样式 → 图标字符渲染成空白 = 用户看到的「悬浮球图标不加载」）。
 * iframe 侧 FA（buildIframeDocument）覆盖不了宿主 document——两份文档两套样式表。
 */
export function installHostFontAwesome(doc: Document = document): void {
  if (typeof doc.getElementById !== 'function') return
  if (doc.getElementById(HOST_FA_LINK_ID) !== null) return
  const head = doc.head
  if (head === null) return
  const link = doc.createElement('link')
  link.id = HOST_FA_LINK_ID
  link.rel = 'stylesheet'
  link.href = HOST_FONTAWESOME_URL
  head.append(link)
}

// ---------------------------------------------------------------------------
// 宿主 toastr（ST 自带 toastr 的等效实现——真 TH predefine.js 把 toastr 从父页合并
// 进脚本全局，脚本 toastr 弹窗必须出现在可见的宿主页面上）
// ---------------------------------------------------------------------------

type ToastrLevel = 'success' | 'error' | 'info' | 'warning'

const TOASTR_COLORS: Record<ToastrLevel, string> = {
  success: '#49a25f',
  error: '#d9534f',
  info: '#5bc0de',
  warning: '#f0ad4e',
}

/** 极简 toastr：ST 同位（顶部居中堆叠）、4s 自动消失、点击即关——覆盖脚本常用面
 * （toastr.success/error/info/warning + options.timeOut）。样式内联免依赖。 */
export function installHostToastr(host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  if (typeof document === 'undefined') return
  if (host.toastr !== undefined) return // 宿主已有（ST 同款）绝不覆盖
  if (document.body === null) {
    // client init 早于 body（DSH 壳挂载点）——DOMContentLoaded 后重试一次
    document.addEventListener('DOMContentLoaded', () => installHostToastr(host), { once: true })
    return
  }
  const container = document.createElement('div')
  container.id = 'dsht-toastr-container'
  container.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;max-width:92vw'
  document.body.append(container)
  const show = (level: ToastrLevel, message: string, title?: string): HTMLElement => {
    const el = document.createElement('div')
    el.style.cssText = `pointer-events:auto;cursor:pointer;background:rgba(28,30,34,.94);color:#eee;border-left:4px solid ${TOASTR_COLORS[level]};border-radius:6px;padding:10px 14px;font-size:13px;line-height:1.5;box-shadow:0 6px 18px rgba(0,0,0,.35);max-width:92vw;word-break:break-word`
    const titleHtml = title ? `<div style="font-weight:600;margin-bottom:2px">${String(title).replace(/[<>&]/g, '')}</div>` : ''
    el.innerHTML = `${titleHtml}<div>${String(message).replace(/[<>&]/g, (s) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s] ?? s))}</div>`
    el.addEventListener('click', () => el.remove())
    container.append(el)
    while (container.children.length > 5) container.firstElementChild?.remove()
    setTimeout(() => el.remove(), 4000)
    return el
  }
  host.toastr = {
    success: (m: string, t?: string) => show('success', m, t),
    error: (m: string, t?: string) => show('error', m, t),
    info: (m: string, t?: string) => show('info', m, t),
    warning: (m: string, t?: string) => show('warning', m, t),
    options: { timeOut: 4000, extendedTimeOut: 2000, positionClass: 'toast-top-center' },
  }
}

// ---------------------------------------------------------------------------
// 宿主 SillyTavern 门面（T-37，2026-09-11）
//
// 缺口证据（不是猜的）：
//  - 真 ST 宿主页有 `globalThis.SillyTavern = { libs, getContext }`
//    （SillyTavern-reference/public/script.js:292「API OBJECT FOR EXTERNAL WIRING」）；
//    TT/ST 上同样有。DSH webui 是 React 应用 → 没有。
//  - 设备实测（CDP Runtime.exceptionThrown，宿主帧 ctx）：
//    `ReferenceError: SillyTavern is not defined`
//    @ https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js:55
//    —— 该卡外链的 220KB 宿主注入脚本里 `SillyTavern.getContext` 出现 **11 次**：
//      :55            `const ctx = SillyTavern.getContext();`
//                     `for (const prompt of ctx.chatCompletionSettings.prompts)` ← 首行就炸
//      :1347          `SillyTavern.getContext()?.streamingProcessor`
//      :1383/:1400    `currentContext.chat?.[...]`（元素取 .mes/.is_user/.is_system/.swipe_id）
//      :2321/:2447    `const { uuidv4 } = SillyTavern.getContext()`
//      :3927/:3930    `getContext().chatCompletionSettings.preset_settings_openai` ← **身份比较**
//  → 本修复只按**实测取用面**补齐，不做无据扩展（LEARNINGS L31 的纪律）。
//
// ⚠️ 身份稳定性要求（否则会自造死循环）：:3927 是
// `let presetLoaded = ctx.chatCompletionSettings.preset_settings_openai; … if (ctx…preset_settings_openai !== presetLoaded)`
//  —— 若 getContext() 每次返回**新对象**，`!==` 恒真 → 每 tick 触发一次重放。
//  因此：同一份快照 → **必须返回同一个 ctx 对象**（下方 cache 按快照引用做记忆化），
//  且 extensionSettings 也要稳定引用（localStorage 原文不变即复用同一对象）。
// ---------------------------------------------------------------------------

/** 宿主侧要补挂的 ST 全局（缺失才装） */
export const HOST_ST_GLOBALS = ['SillyTavern'] as const

/** 宿主 extension_settings 与脚本 iframe 共用的 localStorage 键（th-shim 同键，同源共享一份） */
const EXT_SETTINGS_LS_KEY = '__dsht_extension_settings'

export interface HostStContextSource {
  /** 取当前 RP 会话上下文快照（RP 未打开时返回 null——门面退化为形状完整的空壳，绝不抛错） */
  getSnapshot?: () => ThContextSnapshot | null
  /** 注入 uuid 源（测试用；缺省走 crypto.randomUUID） */
  uuid?: () => string
  /**
   * 当前聊天标识（T-44）。真 ST：`chatId` = `characters[this_chid]?.chat` / 群聊 `chat_id`
   * （`st-context.js:122-125`），`getCurrentChatId()` 返回同一值（`script.js:540-547`）。
   * 我们的会话与聊天一一对应 → 返回**当前 RP 会话 id**；无会话 → `undefined`。
   */
  getChatId?: () => string | undefined
  /**
   * 重载当前聊天（T-44）。真 ST：`reloadCurrentChat` = `reloadChatMutex.update` →
   * 清空 + 重取 + 重印 + `emit(CHAT_CHANGED)`（`script.js:1676-1700`）。
   * 我们的等价物 = 重新拉会话上下文/消息 + 失效显示面缓存并重渲染
   * （`RpNativeChat.notifyDisplayMutation`，注释自述「真 TH 的 builtin.reloadAndRenderChatWithoutEvents 走本通道」）。
   * 返回是否真的触发了重载（false = 当前无 RP 会话）。
   */
  reloadChat?: () => boolean | Promise<boolean>
  /**
   * 同步宏展开（T-44）。`substituteParams` 与 `substituteParamsExtended` 都走这个提供者
   * ——单实现，硬约束「禁止另写一份宏引擎」。实现见 `host-macro-bridge.ts`。
   */
  substituteParams?: (content: unknown, ...rest: unknown[]) => string
  /**
   * `substituteParamsExtended(content, additionalMacro, postProcessFn)`（T-44 续，心跳 51）。
   * **必须与 `substituteParams` 分开注入**：两者的形参位置不同
   *（`script.js:2756` vs `script.js:2922`）。把 Extended 的实参原样转给 `substituteParams`
   * 会让 `additionalMacro` / `postProcessFn` **静默丢失** —— 设备实测：
   * 第 2 参 `{}` 被当成 `options` 对象解析，于是 `dynamicMacros` 与 `postProcessFn` **双双失效且无任何报错**
   *（卡的正则消毒静默不生效）。**该缺陷是被设备探针抓到的，不是被单测抓到的**（见下方单测补强说明）。
   */
  substituteParamsExtended?: (content: unknown, additionalMacro?: unknown, postProcessFn?: unknown) => string
  /**
   * 用户名 / 角色名（T-44 续，心跳 51）= 真 ST 的全局 `name1` / `name2`
   * （`st-context.js:120-121` 直接返回它们）。**每次访问取活值**（宏环境异步水合，
   * 若在门面构建时读一次会拿到空名并一直陈旧）。
   */
  getNames?: () => { name1?: string; name2?: string }
}

/** RFC4122 v4；宿主无 crypto.randomUUID 时用 Math.random 兜底（脚本只要求「能拿到一个 id」） */
export function defaultUuidv4(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * 宿主事件总线（模块级单例——身份稳定，`getContext().eventSource` 每次必须是同一枚，
 * 否则脚本的 `eventSource.off(...)` 摘不掉自己先前挂的监听）。
 * 证据：卡注入脚本 `ctx.eventSource.on('module_imported', …)`（inject.js:2245，全篇 27 处）。
 */
let hostEventSource: ThEventSource | null = null

/** 取宿主事件总线（懒建；同一进程内恒为同一枚） */
export function getHostEventSource(): ThEventSource {
  if (hostEventSource === null) hostEventSource = createThEventSource()
  return hostEventSource
}

/** 只测试用：丢弃单例（避免用例间监听器串味） */
export function __resetHostEventSource(): void {
  hostEventSource = null
}

/**
 * 宿主 i18n / 函数工具管理器：**模块级单例**（身份稳定）。
 * 理由同 eventSource —— `getContext()` 每次返回**同一枚**对象，脚本 `off`/`!==` 才说得通；
 * 且工具台账是"进程内见过什么"的累积量，每次新建会把台账抹掉。
 */
let hostI18n: HostI18n | null = null
let hostToolManager: HostToolManager | null = null

function getHostI18n(): HostI18n {
  if (hostI18n === null) hostI18n = createHostI18n()
  return hostI18n
}

function getHostToolManager(): HostToolManager {
  if (hostToolManager === null) hostToolManager = createHostToolManager()
  return hostToolManager
}

/** 只测试用：丢弃 i18n / 工具管理器单例 */
export function __resetHostSurfaceSingletons(): void {
  hostI18n = null
  hostToolManager = null
}

let extSettingsCache: { key: string | null; value: Record<string, unknown> } | null = null

/** 当前 storage 里实际的内容（`null` = 没有/不可用）。缓存命中与否**只**看它。 */
function readExtSettingsRaw(): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(EXT_SETTINGS_LS_KEY)
  } catch { /* 隐私模式/不可用 */ }
  return null
}

/** 宿主 extension_settings（与脚本 iframe 同一 localStorage 键；原文不变即复用同一引用） */
export function readHostExtensionSettings(): Record<string, unknown> {
  const raw = readExtSettingsRaw()
  if (extSettingsCache !== null && extSettingsCache.key === raw) return extSettingsCache.value
  let value: Record<string, unknown> = {}
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        value = parsed as Record<string, unknown>
      }
    } catch { value = {} }
  }
  extSettingsCache = { key: raw, value }
  return value
}

/** 只测试用：清掉 extension_settings 记忆化（避免用例间串味） */
export function __resetHostStCaches(): void {
  extSettingsCache = null
}

/**
 * 【心跳 58 · T-42 收口】把 ST 的全局正则键种进宿主 `extension_settings`。
 *
 * ## 为什么必须种（实机取证 + 探针复现）
 *
 * 真 ST 的 `extension_settings.regex` 是 `RegexScriptData[]`（camelCase）：
 * `extensions.js:178` 默认 `regex: []`，`extensions/regex/index.js:1713` 的 `init()` 再兜底
 * `if (!Array.isArray(extension_settings.regex)) extension_settings.regex = []`。
 *
 * 我方原先**从未提供该键** → 卡脚本 `inject.js:3538` 取 `const extensions = ctx.extensionSettings;`
 * 后在**无条件调用**的 `updateSTRegexes()`（`:3892`）里读 `extensions.regex.length`（`:3997`）
 * → `undefined.length` **取值先抛** TypeError → `RegexBinding()` 整段中断 → 紧随其后的
 * `ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` **全不执行**
 *（这正是 T-42 登记的影响面）。注意该行**新旧版路径都会走到**——与 `#saved_regex_scripts`
 * 锚点不同（那处只在旧版路径被消费），所以光补 `/version` + 锚点并不够。
 *
 * ## 语义与纪律
 * - **不是数组 → 种**（逐字对齐 ST `init()` 的 `!Array.isArray` 判据）。
 * - **是空数组且有真数据 → 填充**：这一条是必需的 —— 门面常常**先以空壳构建**
 *   （RP 未打开时 `getSnapshot()` 返回 null）而把 `regex` 种成 `[]`；若此后一律"不覆盖"，
 *   真数据就**永远进不来**（本用例第一版即踩此坑，被单测当场抓住）。
 * - **非空数组 → 一律不动**：卡可能已就地改过（`extensions.regex = …filter(…)`），不回滚。
 * - **就地改同一对象**：`ext` 是缓存里的那个引用，就地赋值 → `getContext()` 的引用稳定性要求不被破坏。
 * - **数据来源**：`/context` 的 `extensionSettingsRegex`（= GLOBAL 作用域正则，ST camelCase 形状；
 *   facade 侧由 `toStRegexScript` 白名单转换，与 `extensions.regex_scripts` 的转换同源）。
 * - `regex_presets` 一并种（`extensions.js:181` 同为 `[]` 基线）——同族键给同族形状，避免下一个
 *   `!Array.isArray` 判据再炸一次。
 *
 * @returns 是否**真的改动了**（调用方据此决定要不要落盘——不改就不碰 storage，避免读路径无谓写）
 */
export function seedHostExtensionSettings(
  ext: Record<string, unknown>,
  snap: ThContextSnapshot,
): boolean {
  let changed = false
  const regexes = (snap as { extensionSettingsRegex?: unknown }).extensionSettingsRegex
  const hasReal = Array.isArray(regexes) && regexes.length > 0
  const currentEmpty = !Array.isArray(ext.regex) || (ext.regex as unknown[]).length === 0
  if (hasReal && currentEmpty) {
    ext.regex = regexes
    changed = true
  }
  if (!Array.isArray(ext.regex)) { ext.regex = []; changed = true }
  if (!Array.isArray(ext.regex_presets)) { ext.regex_presets = []; changed = true }
  return changed
}

/**
 * 落盘宿主 extension_settings（`saveSettingsDebounced` 的落地动作）。
 *
 * 语义：脚本拿到 `ctx.extensionSettings` 后**就地改**这个对象，再调 `saveSettingsDebounced()`
 * 期望持久化。真 ST 走 server 端 POST；我们宿主页与脚本 iframe 共用**同一个 localStorage 键**
 * （`__dsht_extension_settings`）→ 这里等价于把它写回去。
 *
 * ⚠️ 写回后必须**同步刷新 `extSettingsCache`**：否则下次 `readHostExtensionSettings()`
 * 见到 raw 变了就会**重新 parse 出一个新对象**，正在持有旧引用的脚本会看到"改动消失"
 * （且 `:3927` 那类 `!==` 身份比较会被误判成"变了"）。
 */
export function saveHostExtensionSettings(settings: Record<string, unknown>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(EXT_SETTINGS_LS_KEY, JSON.stringify(settings))
    }
  } catch { /* 配额/不可用：保持内存态一致，不抛（脚本侧只期望"尽力持久化"） */ }
  // ⚠️ 缓存键必须记「storage **实际**里的内容」，不是"我们想写的内容"：
  // 若 setItem 被静默拒绝/不可用，键却记成新串 → 下次读取 raw(null) ≠ key → 重新 parse
  // → 变成**新对象**，正在持有旧引用的脚本会看到"改动消失"，`!==` 身份比较也被误判。
  // （本用例首版就踩在这里 → 现已由 readExtSettingsRaw() 回读取得真实值。）
  extSettingsCache = { key: readExtSettingsRaw(), value: settings }
}

/**
 * 真 ST 的 `saveSettingsDebounced` 是**防抖**的（脚本常常在一次交互里连改好几个键）。
 * 语义差异已在注释里说清：防抖窗口内进程被杀 → 该次改动丢失，与 ST 同性质。
 * 测试/退出前可用 `flushHostExtensionSettings()` 强制落盘。
 */
let hostExtSaveTimer: ReturnType<typeof setTimeout> | null = null
let hostExtPending: Record<string, unknown> | null = null

export function saveHostExtensionSettingsDebounced(
  settings: Record<string, unknown>,
  delayMs = 500,
): void {
  hostExtPending = settings
  if (hostExtSaveTimer !== null) clearTimeout(hostExtSaveTimer)
  hostExtSaveTimer = setTimeout(() => {
    hostExtSaveTimer = null
    const pending = hostExtPending
    hostExtPending = null
    if (pending !== null) saveHostExtensionSettings(pending)
  }, delayMs)
}

/** 立即落盘（若有挂起的防抖写入） */
export function flushHostExtensionSettings(): void {
  if (hostExtSaveTimer !== null) { clearTimeout(hostExtSaveTimer); hostExtSaveTimer = null }
  const pending = hostExtPending
  hostExtPending = null
  if (pending !== null) saveHostExtensionSettings(pending)
}

/**
 * 纯函数：由会话快照构造宿主 ST 上下文（字段面与 iframe 侧 `buildStContextFacade` 对齐；
 * 缺的数据字段保持 undefined / 空数组形状——**绝不因为缺数据抛错**，脚本首行就是
 * `for (const p of ctx.chatCompletionSettings.prompts)`）。
 */
/** 门面成员降级告警去重（L42：**有意降级也必须出声**，否则排查线索为零） */
const degradedWarned = new Set<string>()
function warnFacadeDegraded(name: string, why: string): void {
  if (degradedWarned.has(name)) return
  degradedWarned.add(name)
  console.warn(`[dsht-rp-ui] 宿主门面 ${name} 降级：${why}`)
}

/** 只测试用：清空降级告警去重表 */
export function __resetFacadeDegradedWarnings(): void {
  degradedWarned.clear()
}

export function buildHostStContext(src: HostStContextSource = {}): Record<string, unknown> {
  let snap: ThContextSnapshot | null = null
  try { snap = src.getSnapshot !== undefined ? src.getSnapshot() : null } catch { snap = null }
  const s: ThContextSnapshot = snap ?? {}
  const rawSettings = (s.chatCompletionSettings !== null && typeof s.chatCompletionSettings === 'object')
    ? (s.chatCompletionSettings as Record<string, unknown>)
    : {}
  const prompts = Array.isArray(rawSettings.prompts) ? rawSettings.prompts : []
  const promptOrder = Array.isArray(rawSettings.prompt_order) ? rawSettings.prompt_order : []
  const messages = Array.isArray(s.messages) ? s.messages : []
  const charName = (s.character !== null && s.character !== undefined && typeof s.character === 'object'
    && s.character.name != null) ? s.character.name : undefined
  const ext = readHostExtensionSettings()
  // 【心跳 58 · T-42】seed ST 全局正则键（详见 seedHostExtensionSettings 头注）。
  // 改动时**落盘**：脚本 iframe 与宿主共用同一 localStorage 键（`__dsht_extension_settings`），
  // 只改内存不落盘会让 iframe 侧看不到（同族数据不一致 = 又一个静默分歧）。
  if (seedHostExtensionSettings(ext, s)) saveHostExtensionSettings(ext)
  const i18n = getHostI18n()
  const tools = getHostToolManager()

  // ---- T-44：四个提供者的取用包装（提供者缺失一律「出声降级」，绝不静默 no-op）----

  /** 当前聊天标识：无会话 → undefined（= 基准两个分支都不命中的返回） */
  const readChatId = (): string | undefined => {
    try {
      const v = src.getChatId !== undefined ? src.getChatId() : undefined
      return (typeof v === 'string' && v.length > 0) ? v : undefined
    } catch { return undefined }
  }
  /** 当前用户名 / 角色名（name1 / name2）。角色名回落快照里的 character.name，用户名无来源即 undefined */
  const readNames = (): { name1?: string; name2?: string } => {
    let n: { name1?: string; name2?: string } = {}
    try { n = src.getNames !== undefined ? (src.getNames() ?? {}) : {} } catch { n = {} }
    const name1 = (typeof n.name1 === 'string' && n.name1.length > 0) ? n.name1 : undefined
    const name2 = (typeof n.name2 === 'string' && n.name2.length > 0)
      ? n.name2
      : (typeof charName === 'string' && charName.length > 0 ? charName : undefined)
    return { name1, name2 }
  }
  /** reloadCurrentChat：异步；无提供者 → 出声降级并 resolve（保持基准「不 reject」形状） */
  const callReloadChat = async (): Promise<void> => {
    const fn = src.reloadChat
    if (fn === undefined) {
      warnFacadeDegraded('reloadCurrentChat', '未接线 reloadChat 提供者（当前无 RP 会话，或宿主未注入）')
      return
    }
    try { await fn() } catch (e) {
      console.warn('[dsht-rp-ui] reloadCurrentChat 失败:', (e as Error).message)
    }
  }
  /** substituteParams / substituteParamsExtended 共用入口（单实现；求值体在 host-macro-bridge） */
  const callSubstituteParams = (content: unknown, rest: readonly unknown[]): string => {
    const asText = (): string => (typeof content === 'string' ? content : (content ? String(content) : ''))
    const fn = src.substituteParams
    if (fn === undefined) {
      warnFacadeDegraded('substituteParams', '未接线 substituteParams 提供者（宏将原样保留）')
      return asText()
    }
    try { return fn(content, ...rest) } catch (e) {
      console.warn('[dsht-rp-ui] substituteParams 求值失败（原文透传）:', (e as Error).message)
      return asText()
    }
  }
  /**
   * `substituteParamsExtended(content, additionalMacro, postProcessFn)`。
   * 基准里它**就是** `substituteParams(content, {dynamicMacros: additionalMacro, postProcessFn})`
   *（`script.js:2756-2757`，已标 deprecated）—— 故：
   *  ① 有专用提供者 → 直接用它（形参位置由提供者自己保证）；
   *  ② 只注入了 `substituteParams` → 按上面的等价关系**显式映射成 options**（**不能原样转发实参**：
   *     第 2 参 `{}` 会被当成 options 对象，`additionalMacro`/`postProcessFn` 双双丢失，
   *     设备实测过这条静默失败）；
   *  ③ 都没有 → 出声降级 + 原文透传。
   */
  const callSubstituteParamsExtended = (content: unknown, additionalMacro?: unknown, postProcessFn?: unknown): string => {
    const asText = (): string => (typeof content === 'string' ? content : (content ? String(content) : ''))
    const ext = src.substituteParamsExtended
    if (ext !== undefined) {
      try { return ext(content, additionalMacro, postProcessFn) } catch (e) {
        console.warn('[dsht-rp-ui] substituteParamsExtended 求值失败（原文透传）:', (e as Error).message)
        return asText()
      }
    }
    if (src.substituteParams !== undefined) {
      return callSubstituteParams(content, [{
        dynamicMacros: (additionalMacro ?? {}) as Record<string, unknown>,
        postProcessFn: typeof postProcessFn === 'function' ? postProcessFn : undefined,
      }])
    }
    warnFacadeDegraded('substituteParamsExtended', '未接线 substituteParams(Extended) 提供者（宏将原样保留）')
    return asText()
  }

  return {
    chatCompletionSettings: {
      ...rawSettings,
      prompts,
      prompt_order: promptOrder,
      // 脚本对它做 `!==` 身份比较（见文件头 ⚠️）——必须始终存在且引用稳定
      preset_settings_openai: rawSettings.preset_settings_openai ?? {},
      // 【心跳 57】`extensions.regex_scripts` 恒存在（真 ST 1.13.5+ 的预设内嵌正则通道）。
      // 缺它时卡脚本 `ctx.chatCompletionSettings.extensions.regex_scripts` 会**属性访问先抛**
      // TypeError，而 `&&` 短路保护轮不到（`inject.js:3567-3569`，与 T-40 `eventTypes` 同型）。
      // 给**空对象**而非省略：空对象的 `regex_scripts` 是 undefined（= 无预设正则的正常状态），
      // 取值不抛；而整个键缺席会让任何直接读 `.extensions.xxx` 的脚本炸在取值上。
      extensions: (rawSettings.extensions !== null && typeof rawSettings.extensions === 'object')
        ? rawSettings.extensions
        : {},
    },
    // 真 ST 的 getContext() 含 extensionSettings（= extension_settings 引用）
    extensionSettings: ext,
    extension_settings: ext,
    promptManager: {
      activePreset: s.presetName != null ? s.presetName : undefined,
      getPromptOrderForCharacter: function (): unknown[] {
        const first = promptOrder[0] as { order?: unknown } | undefined
        return (first !== undefined && Array.isArray(first.order)) ? first.order : []
      },
      getPromptOrderItems: function (): unknown[] { return prompts },
    },
    nameOverride: charName,
    characterName: charName,
    presetName: s.presetName != null ? s.presetName : undefined,
    chat: messages,
    chatLength: messages.length,
    // 真 ST getContext() 含 eventSource（脚本的事件挂载总入口；见文件头 T-39 证据）
    eventSource: getHostEventSource(),
    // 真 ST getContext() 含 eventTypes（st-context.js:137-138 与 eventSource 并列）。
    // 卡脚本写 `ctx.eventTypes.OAI_PRESET_IMPORT_READY || '字面量'` —— 有兜底，
    // 但 `undefined.xxx` 的属性访问**先抛 TypeError**，兜底轮不到（实测 inject.js:493）。
    eventTypes: ST_EVENT_TYPES,
    // 真 ST 同时保留**旧蛇形命名**别名（`st-context.js` 的 `event_types: event_types`
    // 与 `@deprecated Legacy snake-case naming, compatibility with old extensions`）。
    // 卡脚本 `ctx.event_types` 若缺失同样会属性访问即抛 → 必须真给。
    event_types: ST_EVENT_TYPES,
    uuidv4: src.uuid !== undefined ? src.uuid : defaultUuidv4,

    // ---- 心跳 50：`audit-card-context-surface.mjs` 一次性枚举出的缺口里的「可不依赖桥」部分 ----
    // i18n（语义逐条对齐 `public/scripts/i18n.js`；缺键返回原文 = ST 行为）
    t: i18n.t,
    translate: i18n.translate,
    getCurrentLocale: i18n.getCurrentLocale,
    addLocaleData: i18n.addLocaleData,
    // 弹窗（常量与返回契约抄自 `public/scripts/popup.js`）
    POPUP_TYPE,
    POPUP_RESULT,
    callGenericPopup,
    // 函数工具注册：能力查询说真话（false），注册留痕（不造静默假成功）
    registerFunctionTool: tools.registerFunctionTool,
    unregisterFunctionTool: tools.unregisterFunctionTool,
    isToolCallingSupported: tools.isToolCallingSupported,
    canPerformToolCalls: tools.canPerformToolCalls,
    ToolManager: tools.ToolManager,
    // 真 ST 的 isMobile 判定的是"移动端布局"；DSHT 本身就是 Android 单一形态 → true（真话）
    isMobile: true,
    // extension_settings 的持久化入口（localStorage 同键；落盘后保持引用稳定）
    saveSettingsDebounced: (): void => saveHostExtensionSettingsDebounced(ext),

    // ---- 心跳 51（T-44）：缺口 6 → 1 的「四个提供者接线」----
    // 判据纪律：这里只补「真 ST 有、我们无」的成员（L36）；语义逐条对质基准源码，
    // 不实现可实现的就**显式降级并出声**，不做静默假成功（L42）。

    // ST：`chatId`（属性）与 `getCurrentChatId()`（函数）**并存且同值**
    //（`st-context.js:122-125` + `script.js:540-547`）。缺失时返回 undefined——
    // 与真 ST 在没有角色/群聊时的返回一致（`getCurrentChatId` 两个分支都不命中 → undefined）。
    chatId: readChatId(),
    getCurrentChatId: (): string | undefined => readChatId(),

    // ST：`reloadCurrentChat = reloadChatMutex.update`（`script.js:1676`）——异步、串行化。
    // 我们的等价物 = 重取会话上下文 + 失效显示面缓存并重渲染（见 HostStContextSource 注释）。
    // 无提供者时**出声降级**（不静默 no-op）：给一次 console.warn，返回已 resolve 的 Promise
    //（保持基准的「不 reject」形状，避免把卡脚本带进未捕获拒绝）。
    reloadCurrentChat: (): Promise<void> => callReloadChat(),

    // ST：`substituteParams(content, options)`（`script.js:2922`）与
    // `substituteParamsExtended(content, additionalMacro, postProcessFn)`（`script.js:2756`）。
    // 二者共用**同一引擎**，但**形参位置不同 → 必须分开注入**（否则 Extended 的第 2/3 参被
    // 当成 options 对象而静默丢弃；设备实测抓到过，见 HostStContextSource 注释）。
    substituteParams: (content: unknown, ...rest: unknown[]): string => callSubstituteParams(content, rest),
    substituteParamsExtended: (content: unknown, additionalMacro?: unknown, postProcessFn?: unknown): string =>
      callSubstituteParamsExtended(content, additionalMacro, postProcessFn),

    // ST：`export let streamingProcessor = null`（`script.js:455`）——初值就是 null，
    // 生成期间才被赋成流式处理器。我方生成走 DSH 原生通道，**没有**等价对象 →
    // 如实给 `null`（= 基准的初值语义，不是"假装有"）。卡脚本对此已 null-guard
    //（`inject.js:1347` `getContext()?.streamingProcessor || null`），行为一致。
    streamingProcessor: null,

    // ---- 心跳 51 续：`audit-card-context-surface.mjs` 扩域后量出的第二批缺口 ----
    // 来源是 TH **扩展**形态的脚本（实测 `chat-history-backup/index.js` 用 `getContext()` 裸调用，
    // 旧口径一条都提不出来 → 曾是假绿）。以下四项逐条对质基准后落地。

    // ST：`name1` / `name2`（`st-context.js:120-121`）。用**访问器**而非普通属性：
    // 宏环境是异步水合的，构建时读一次会拿到空名并一直陈旧到下一次快照推送。
    get name1(): string | undefined { return readNames().name1 },
    get name2(): string | undefined { return readNames().name2 },

    // ST：`groupId: selected_group`（`st-context.js:121`）。ST 无群聊时该全局为 `null`
    //（`script.js` 的 `selected_group = null`）——DSHT **没有群聊功能**，故如实恒为 `null`。
    // 实测用法（`chat-history-backup/index.js:647/666`）是 `if (context.groupId)` 真值门
    // → 恒走 else 分支，语义正确（不是"补个空壳"）。
    groupId: null,
    // ST：`groups`（群聊列表，`st-context.js` 返回体）。同样如实为空数组
    //（实测用法 `context.groups?.find(g => g.id === context.groupId)` 在 groupId 恒 null 时不可达）。
    groups: [] as unknown[],
  }
}

/**
 * 常驻 ST 正则面板锚点 `#saved_regex_scripts`（幂等；已存在则不动）。
 *
 * ## 为什么必须是「常驻」而不是「面板挂载时才在」（心跳 57 实测驱动的修正）
 *
 * 卡的宿主注入脚本对它建的是**无条件** MutationObserver（`inject.js:3884-3889`）：
 * `const observerTarget = $('#saved_regex_scripts'); observer.observe(observerTarget[0], …)`
 * —— 元素缺席 → `[0]` 是 `undefined` → 抛 TypeError → **中断卡 bootstrap 的后续三行**
 * （`ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` 全不执行）。
 *
 * 卡脚本的执行时机（卡被激活）与我方正则面板的挂载时机（用户切到该 tab）**不同步** ——
 * 若把锚点放在面板组件里，则「用户没打开过正则面板」时仍然抛。
 * 基准侧同要素总是存在：ST 扩展 `init()` 在**页面加载时**就把 `dropdown.html`
 *（`extensions/regex/dropdown.html:96`，TT 对应 `:101`）渲染进扩展设置容器，
 * **不依赖用户打开面板**。
 *
 * ## 为什么这**不是**「只补一个空容器」的半吊子修复
 *
 * 在 `versionNumber >= 11305`（= 基准状态，我方 `/version` 已修）下，卡**主动不往这里渲染**：
 * `inject.js:4196` 的 `if (versionNumber >= 11305) return;`（原文注释
 * 「ST is source of truth, only sync FROM ST」）。故这个版本下它的**正确内容就是空**。
 * 卡的正则数据走 `chatCompletionSettings.extensions.regex_scripts`（`/context` 已提供真数据），
 * 用户可见的正则管理由我方 `RegexPanel` 承担 —— 两条通道都真实存在，
 * 这里只是第三方脚本做 DOM 存在性检查所需的**锚点**。
 *
 * ⚠️ **故意不带 `.regex_settings` 祖先 class**：卡的 `injectBindButtons()` 取法是
 * `$('.regex_settings').find('#saved_regex_scripts')`，缺该祖先即空集 →
 * 它不会往锚点里注入自己的按钮（否则会造出「点了报 Script not found」的假入口 = 新造静默失败）。
 *
 * 返回是否**真的创建了**（false = 已存在或没有 DOM，两种情况都不需要动作）。
 */
export function ensureStRegexAnchor(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): boolean {
  if (doc === undefined || doc.body === null || doc.body === undefined) return false
  if (doc.getElementById('saved_regex_scripts') !== null) return false
  const el = doc.createElement('div')
  el.id = 'saved_regex_scripts'
  el.setAttribute('hidden', '')
  // 自述属性：排查时能一眼看出这个节点是我方为兼容第三方脚本补的锚点，不是某个面板的容器
  el.setAttribute('data-dsht-anchor', 'st-regex-scripts')
  el.setAttribute('data-dsht-note', 'ST 正则扩展面板脚本列表锚点；仅满足第三方脚本的 DOM 存在性检查')
  doc.body.appendChild(el)
  return true
}

/**
 * 宿主页安装 `SillyTavern`（幂等：宿主已有则原样保留，绝不覆盖）。
 * 与 `installHostVendor` 同口径——`??=` 语义，返回是否真的装了。
 */
export function installHostSillyTavern(
  src: HostStContextSource = {},
  host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
  if (host.SillyTavern !== undefined) return false
  // 快照引用 → ctx 对象的记忆化（保证同快照下 `preset_settings_openai` 身份稳定）
  let cache: { snap: unknown; ctx: Record<string, unknown> } | null = null
  host.SillyTavern = {
    // 真 ST 的 libs 是各库 shim 集合；我们宿主侧实际只自备 lodash → 只暴露真有的
    libs: { lodash: host._ },
    getContext: (): Record<string, unknown> => {
      let snap: unknown = null
      try { snap = src.getSnapshot !== undefined ? src.getSnapshot() : null } catch { snap = null }
      if (cache !== null && cache.snap === snap) return cache.ctx
      cache = { snap, ctx: buildHostStContext(src) }
      return cache.ctx
    },
  }
  return true
}

let installAttempted = false

/**
 * client 启动时在宿主 window 补挂缺失全局（幂等）。
 * - 模块级一次性守卫 + iife 内 ??= 语义双保险：绝不覆盖宿主已有全局；
 * - 宿主全局齐全（ST 同款宿主等场景）时零开销跳过，不求值 vendor 源码；
 * - 返回安装前探明的缺失清单（可观测性：调用方 console.info 装了什么）。
 */
export function installHostVendor(
  host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): Array<(typeof HOST_VENDOR_GLOBALS)[number]> {
  const missing = missingHostGlobals(host)
  if (installAttempted || missing.length === 0) return []
  installAttempted = true
  try {
    // Function 构造器求值 vendor iife：与壳加载本插件包同一求值通道
    //（__ModuleLoader__ 的 factory 本就经 Function/eval 执行）；iife 里的 window 即宿主 window。
    new Function(hostVendorSource)()
  } catch (e) {
    installAttempted = false // 求值失败可重试（宿主全局保持原样，不半装）
    console.warn('[dsht-rp-ui] host-vendor 注入失败（宿主全局保持原样）:', (e as Error).message)
  }
  return missing
}
