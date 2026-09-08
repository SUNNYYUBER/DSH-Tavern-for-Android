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
