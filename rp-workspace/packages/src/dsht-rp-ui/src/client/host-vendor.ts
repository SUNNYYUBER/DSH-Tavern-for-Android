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

let extSettingsCache: { key: string | null; value: Record<string, unknown> } | null = null

/** 宿主 extension_settings（与脚本 iframe 同一 localStorage 键；原文不变即复用同一引用） */
export function readHostExtensionSettings(): Record<string, unknown> {
  let raw: string | null = null
  try {
    if (typeof localStorage !== 'undefined') raw = localStorage.getItem(EXT_SETTINGS_LS_KEY)
  } catch { raw = null }
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
 * 纯函数：由会话快照构造宿主 ST 上下文（字段面与 iframe 侧 `buildStContextFacade` 对齐；
 * 缺的数据字段保持 undefined / 空数组形状——**绝不因为缺数据抛错**，脚本首行就是
 * `for (const p of ctx.chatCompletionSettings.prompts)`）。
 */
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
  return {
    chatCompletionSettings: {
      ...rawSettings,
      prompts,
      prompt_order: promptOrder,
      // 脚本对它做 `!==` 身份比较（见文件头 ⚠️）——必须始终存在且引用稳定
      preset_settings_openai: rawSettings.preset_settings_openai ?? {},
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
    uuidv4: src.uuid !== undefined ? src.uuid : defaultUuidv4,
  }
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
