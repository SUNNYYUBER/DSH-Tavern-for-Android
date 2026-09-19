/**
 * dsht-plugin-mobile 浏览器侧入口：宿主无关的移动端竖屏适配。
 *
 * 独立客户端插件，只做两件事——注入 CSS 五件套 + shell.overlay 席位注册
 * 汉堡按钮/遮罩（点击走宿主 layout 服务 toggleSidebar）。
 *
 * 我方 anchor 约定（与直接硬编码哈希类名的做法相反）：
 * - CSS 不硬编码宿主编译后的哈希类名——anchors.ts 运行时把宿主元素打成
 *   [data-dsht-mobile="<anchor>"]，样式只消费锚点与宿主自带状态钩子
 *   （[data-sidebar-collapsed]/[data-shell-overlay]）。
 * - CSS 注入与锚点安装在模块顶层即执行：即便宿主缺 layout/slots 服务导致 apply
 *   不激活，五件套样式仍然生效——宿主无关底线。
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
import { ensureWebviewApiGuard } from '../../dsht-plugin-shared/webview-api-guard.ts'

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
    const parent = summary.parentElement
    if (parent === null || parent.tagName !== 'DETAILS') return
    e.preventDefault()
    e.stopPropagation()
    // 【心跳 47·T-34】`open` 是 `HTMLDetailsElement` 的成员，而 `parentElement` 的静态类型是
    // `HTMLElement`。上一行已用 tagName 在运行时确认它就是 <details>，此处按事实收窄类型。
    // （原写法直接 `details.open` → TS2339；运行时恰好能跑，属"类型没跟上事实"。）
    const details = parent as HTMLDetailsElement
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

/**
 * 📎 附件上传按钮（conversation.input.left 席位；2026-09-08 用户问题「加号不能上传文件吗」）：
 * DSH 原生加号 = 命令菜单（源码设定），附件面只有拖拽/粘贴（桌面手势，手机没有）——
 * 手机端从此无上传入口。本按钮补齐：<input type=file>（Android WebView 的
 * onShowFileChooser → SAF 文件管理器已实现）→ files 塞进 DataTransfer 合成 document
 * drop 事件 → 原生 ComposerAttachments 的 onDrop → onAddImages 接住（桌面拖拽同管线，
 * 类型/大小校验与被拒 toast 全部原生）。
 */
function MobileAttach(): JSX.Element {
  const onClick = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*' // DSH 0.1.2 附件面 = 视觉图片（onAddImages 校验，非图原生 toast 拒绝）
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) return
      try {
        const dt = new DataTransfer()
        for (const f of files) dt.items.add(f)
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      } catch { /* DataTransfer 构造不可用（老 WebView）：静默 */ }
    }
    input.click()
  }
  return (
    <button type="button" className="dsht-mobile-attach" aria-label="添加图片" onClick={onClick}>
      📎
    </button>
  )
}

export const inject = ['slots', 'layout']

export function apply(ctx: {
  effect: (fn: () => () => void, label?: string) => unknown
  slots: { register: (options: Record<string, unknown>, component: unknown) => () => void; inject: (key: string, factory: () => () => void) => () => void }
  layout?: { toggleSidebar?: () => void } | undefined
}): void {
  // 【2026-09-14 轨道 A / L4】旧 WebView 能力补齐。
  // 为什么这里也要装：本插件是**独立的 client bundle**（dsht-plugin-mobile/lib/client.js），
  // 与 dsht-rp-ui 各自加载、加载顺序不定 ⇒ 不能假设对方先跑过。同名函数**幂等**
  // （已存在的能力不动），两处都装不会重复包装。
  // 注意：本插件的 client bundle 目前未使用那些新 API，但**宿主/其它插件**可能在
  // 同一 window 上跑（同一页面共享 globalThis）——在最早入口补一次是全局收益。
  {
    const report = ensureWebviewApiGuard()
    if (report.polyfilled.length > 0) {
      console.warn(`[dsht-plugin-mobile] 旧 WebView 能力补齐：${report.polyfilled.join(', ')}`)
    }
  }
  boot()
  // 📎 上传按钮（conversation.input.left 席位——原生加号旁；不依赖 layout 服务，
  // 宿主有 slots 即可装。非会话视图不渲染该槽 → 无副作用）
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'dsht-mobile-attach', order: 10 },
    MobileAttach,
  )), 'dsht-plugin-mobile: attach button')
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
