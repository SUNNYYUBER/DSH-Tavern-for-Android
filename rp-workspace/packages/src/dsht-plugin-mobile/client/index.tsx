/**
 * dsht-plugin-mobile 浏览器侧入口：宿主无关的移动端竖屏适配。
 *
 * 参考 dsh-tavern android/dsh-client-ui-mobile-adapt/client.js（MIT）：
 * 独立客户端插件，只做两件事——注入 CSS 五件套 + shell.overlay 席位注册
 * 汉堡按钮/遮罩（点击走宿主 layout 服务 toggleSidebar）。
 *
 * 与参考实现的差异（我方 anchor 约定）：
 * - CSS 不硬编码宿主编译后的哈希类名——anchors.ts 运行时把宿主元素打成
 *   [data-dsht-mobile="<anchor>"]，样式只消费锚点与宿主自带状态钩子
 *   （[data-sidebar-collapsed]/[data-shell-overlay]）。
 * - CSS 注入与锚点安装在模块顶层即执行（对照参考实现的同款形态）：即便宿主
 *   缺 layout/slots 服务导致 apply 不激活，五件套样式仍然生效——宿主无关底线。
 *
 * 不依赖 dsht-rp：RP 组件竖屏规则用组件自有稳定类名（.dsht-rp-*），
 * 无匹配元素即空转；RP UI 桌面样式仍由 dsht-rp-ui/style.ts 自带。
 *
 * wire 契约：lib/client.js 由 esbuild 产 CJS factory（banner/footer 见
 * scripts/build-mobile.mjs），externals 走 shell 模块表（react / ui-slots）。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { JSX } from 'react'
import { installAnchors } from './anchors.ts'
import { ensureMobileStyle } from './style.ts'
import { installFilePreview } from './file-preview.ts'

/** 模块顶层引导：CSS + 锚点 + details 点击代理 + 文件引用预览（幂等；无 document 环境直接跳过） */
let booted = false
function boot(): void {
  if (booted || typeof document === 'undefined') return
  booted = true
  ensureMobileStyle()
  installAnchors(document)
  installDetailsToggleProxy()
  installFilePreview(document)
}

/**
 * details 原生切换代理（2026-09-04）：卓易通/部分 WebView 的 <details> 原生
 * 点击切换**失效**（裸 details 实测 open=false 内容照常渲染——影响原生 harness
 * 过程折叠行"展开后收不回"与一切 details 折叠）。代理：capture 阶段拦 summary
 * 点击，preventDefault 掉原生（失效的）切换，手动翻转 open——正常 WebView 上
 * 行为等价，失效 WebView 上被修复。
 */
function installDetailsToggleProxy(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null
    const summary = target?.closest?.('summary') ?? null
    if (summary === null) return
    const details = summary.parentElement
    if (details === null || details.tagName !== 'DETAILS') return
    e.preventDefault()
    e.stopPropagation()
    details.open = !details.open
  }, true)
}

boot()

interface MobileNavProps {
  /** apply 闭包注入的侧栏开关（宿主 layout 服务） */
  toggle?: (() => void) | undefined
}

/** 汉堡按钮 + 抽屉遮罩（shell.overlay 席位；显隐由 CSS 媒体查询 + 宿主状态钩子驱动） */
function MobileNav({ toggle }: MobileNavProps): JSX.Element {
  return (
    <div className="dsht-mobile-nav">
      <button
        type="button"
        className="dsht-mobile-hamburger"
        aria-label="打开侧边栏"
        onClick={() => toggle?.()}
      >
        ☰
      </button>
      <div className="dsht-mobile-scrim" onClick={() => toggle?.()} />
    </div>
  )
}

export const inject = ['slots', 'layout']

export function apply(ctx: {
  effect: (fn: () => () => void, label?: string) => unknown
  slots: { register: (options: Record<string, unknown>, component: unknown) => () => void; inject: (key: string, factory: () => () => void) => () => void }
  layout?: { toggleSidebar?: () => void } | undefined
}): void {
  boot()
  // 宿主无 layout 服务（非 DSH rc 系）：CSS/锚点已在模块顶层生效，跳过汉堡注入
  if (typeof ctx.layout?.toggleSidebar !== 'function') return
  const toggle = (): void => ctx.layout?.toggleSidebar?.()
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsht-mobile-nav', order: -10, inject: () => ({ toggle }) },
    MobileNav,
  )), 'dsht-plugin-mobile: nav overlay')
  // 实测坑：抽屉开着时点抽屉里的 RP 按钮，RP overlay 开在抽屉**后面**——抽屉不关，
  // 整个 overlay 被盖住（遮罩也在 overlay 层之下，点不到）。宿主无「overlay 打开」事件，
  // RP overlay 的打开信号是它自己发的 window 事件（dsht-rp-ui RP_OPEN_EVENT，
  // 按事件名字符串监听保持宿主/插件无关）：抽屉开着就收掉。
  const closeDrawerOnRpOpen = (): void => {
    const frame = document.querySelector('[data-dsht-mobile="app-frame"]')
    if (frame && !frame.hasAttribute('data-sidebar-collapsed')) toggle()
  }
  window.addEventListener('dsht-rp-ui:open', closeDrawerOnRpOpen)
  ctx.effect(() => () => window.removeEventListener('dsht-rp-ui:open', closeDrawerOnRpOpen), 'dsht-plugin-mobile: rp-open listener')
}
