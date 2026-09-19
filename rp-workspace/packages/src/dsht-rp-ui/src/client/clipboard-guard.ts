/**
 * 【2026-09-14 L1 穷举 / P-3 静默失败 / P-7 能力对等】剪贴板能力探测与出声。
 *
 * ## 为什么需要这个模块
 * L1 必测项「长按 / 上下文菜单 / 文本选择 / 复制」要求「有触屏可达的等价路径」。
 * 静态穷举结论：**宿主已内置显式复制按钮**（`dsh-client-ui-chat` 的
 * `MessageIconActions.onCopy` → `writeClipboard`），且其 hover 隐藏规则写在
 * `@media (hover:hover)` 内 ⇒ 触屏下本来就常显。所以这一项**不是「缺入口」**。
 *
 * 但宿主的实现有一个可观测性缺口（读官方产物确认，非猜测）：
 *
 * ```js
 * writeClipboard(text).then((ok) => {
 *   if (!ok) return          // ← 失败直接返回：不改按钮状态、不提示、不打日志
 *   setCopied(true)
 * })
 * ```
 *
 * `writeClipboard` 内部先试 `navigator.clipboard.writeText`，失败再退
 * `execCommand('copy')`，两者都失败就 `return false`。整条路径**零可见痕迹** ⇒
 * 用户点「复制」没反应，也无从判断是「没复制上」还是「按钮坏了」。
 * 这属 P-3（静默失败）族；本项目纪律 R8 明令「任何降级/跳过必须留可见痕迹」。
 *
 * ## 我方层能做什么（不能做什么）
 * **不能**改官方源码（goal 边界 B4，合规红线），**不能**替宿主重写复制逻辑
 * （那会变成第 N 份平行实现，违反 P-1）。
 * **能做**：在**能力层面**探测「这台设备/这个 WebView 是否具备可用剪贴板 API」，
 * 不可用时**提前出声**——把「点了没反应的谜题」变成「一句可执行的提示」。
 *
 * ## 判据（为什么探测而不是事后判定）
 * 事后判定（复制后读剪贴板核对）在 Android WebView 上不可靠：读剪贴板需
 * `navigator.clipboard.readText()`，它要求用户手势 + 权限，且部分 WebView 直接不实现。
 * 用不可靠的判据去驱动提示 = 制造假报警。故本模块只做**能力存在性**判断（确定的事实），
 * 不做结果判定。
 *
 * ## 与已有实现的关系（P-1 单一事实来源）
 * 本模块**不复制** `SettingsDocFix.ts` 的 `copyText` 回退逻辑——那是「我方自己发起的
 * 复制」（有明确返回值可如实反馈），本模块是「宿主发起的复制」（只能事前探测）。
 * 两者语义面不同（见 `scripts/audit-impl-duplication.mjs` 的白名单惯例）。
 */

/** 探测结果。`available === false` 时 `reason` 说明原因（用于提示文案与日志）。 */
export interface ClipboardProbe {
  available: boolean
  reason: string
}

/**
 * 探测剪贴板写入能力（纯函数，无副作用，可单测）。
 *
 * @param nav 可注入的 navigator 形状（单测传桩；缺省取全局）
 */
export function probeClipboard(
  nav: { clipboard?: { writeText?: unknown } } | undefined = (globalThis as { navigator?: { clipboard?: { writeText?: unknown } } }).navigator,
): ClipboardProbe {
  if (nav === undefined || nav === null) {
    return { available: false, reason: '无 navigator（非浏览器环境）' }
  }
  const cb = nav.clipboard
  if (cb === undefined || cb === null) {
    return { available: false, reason: '此 WebView 未实现 navigator.clipboard（旧内核）' }
  }
  if (typeof cb.writeText !== 'function') {
    return { available: false, reason: 'navigator.clipboard.writeText 不可调用' }
  }
  return { available: true, reason: '' }
}

/** 判定一个点击目标是否是「宿主的楼层动作钮」（复制/分支等）。
 *
 * 为什么按结构而非哈希类名：宿主类名（如 `xzv4MW_action`）随版本漂移，
 * 而 `[data-chat-flow-kind="turn-tail"]` 是宿主自带的**语义属性**（本项目既有
 * 选择器策略同源，见 `fold-plan.ts` / `ProcessFolder.ts`）。
 */
export function isFloorActionButton(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown; tagName?: string } | null
  if (el === null || el === undefined || typeof el.closest !== 'function') return false
  if (el.tagName !== 'BUTTON' && el.closest('button') === null) return false
  const btn = (el.tagName === 'BUTTON' ? el : el.closest('button')) as { closest?: (sel: string) => unknown } | null
  if (btn === null || btn === undefined || typeof btn.closest !== 'function') return false
  // 必须在 turn-tail 行内（即宿主 MessageIconActions 的容器）
  return btn.closest('[data-chat-flow-kind="turn-tail"]') !== null
}

/** 安装回调面（便于单测与解耦） */
export interface ClipboardGuardHooks {
  /** 出声（缺省 console.warn；UI 提示由调用方注入更合适） */
  warn?: (message: string) => void
  /** 用户可见提示（缺省不展示） */
  notify?: (message: string) => void
}

/**
 * 安装剪贴板能力守卫：**只在探测到不可用时**，于用户首次点击楼层动作钮时提示一次。
 *
 * 设计要点（防噪音是硬要求，否则提示本身会变成新的干扰）：
 * - 能力可用 ⇒ **完全静默**，不监听、不提示（绝大多数设备走这条）；
 * - 不可用 ⇒ 首次点击时提示一次，之后不再提示（`notified` 标志）；
 * - 返回卸载函数（`ctx.effect` 的惯例）。
 *
 * @returns 卸载函数
 */
export function installClipboardGuard(hooks: ClipboardGuardHooks = {}): () => void {
  if (typeof document === 'undefined') return () => { /* 非浏览器环境 */ }
  const probe = probeClipboard()
  if (probe.available) return () => { /* 能力可用：零介入（不装监听，避免无谓开销） */ }

  const warn = hooks.warn ?? ((m: string) => { console.warn(m) })
  warn(`[dsht-rp-ui] 剪贴板能力不可用（${probe.reason}）——宿主「复制」按钮会静默失败；已改为首次点击时提示用户手动选取`)

  let notified = false
  const onClick = (e: Event): void => {
    if (notified) return
    if (!isFloorActionButton(e.target)) return
    notified = true
    const msg = '这台设备的 WebView 不支持自动复制——请长按消息正文，用系统的「全选 / 复制」手动选取内容。'
    if (hooks.notify !== undefined) hooks.notify(msg)
    else warn(`[dsht-rp-ui] ${msg}`)
  }
  // capture：宿主按钮的 handler 在冒泡阶段，本监听只做旁路提示，不干扰其行为
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
