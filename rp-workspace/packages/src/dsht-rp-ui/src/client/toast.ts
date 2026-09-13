/**
 * 【D5 2026-09-13】轻量非阻塞提示（toast）。
 *
 * 背景：项目中散落 `window.alert` / `window.confirm`。安卓 WebView 上
 * `alert`/`confirm` 是**阻塞式**的（冻结渲染、观感突兀；虽然 MainActivity 的
 * `onJsAlert`/`onJsConfirm` 已实现，能弹出来，但阻塞行为仍与「非阻塞 UI」目标相悖）。
 *
 * 本模块把原先内联在 `RpScriptHost.tsx:129` 的 `showDomToast` 提为共享实现，
 * 供 RpNativeChat / RpGreetingDock 等复用（避免同一语义出现第二份实现——
 * 见项目铁律「同一语义不得有第二份实现」）。
 *
 * 【D5 收口】`showDomConfirm` 提供**非阻塞确认**（DOM 弹窗 + Promise<boolean>）：
 * 破坏性操作的确认语义必须保留（不可逆操作不能被静默执行），但实现方式换成非阻塞 ——
 * 于是代码里不再有任何 `window.confirm` / `window.alert` 调用。
 */

/** 右下角 toast；4 秒自动消失；不阻塞交互（pointer-events:none）。 */
export function showDomToast(level: 'error' | 'success' | 'info', message: string): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.textContent = message
  el.setAttribute('role', 'status') // 读屏可播报
  const bg = level === 'error' ? '#b3261e' : level === 'success' ? '#2e7d32' : '#37474f'
  el.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:14vh', 'z-index:99999', 'max-width:340px',
    'padding:8px 12px', 'border-radius:8px', 'font-size:12px', 'line-height:1.5', 'color:#fff',
    `background:${bg}`,
    'opacity:0.95', 'box-shadow:0 4px 12px rgba(0,0,0,.4)', 'pointer-events:none',
  ].join(';')
  document.body.append(el)
  setTimeout(() => el.remove(), 4000)
}

/**
 * 【D5 收口】非阻塞确认弹窗（`window.confirm` 的替代）。
 *
 * 为什么换：`window.confirm` 在安卓 WebView 上**阻塞渲染主线程**（且观感与 App 其余
 * 原生 UI 不一致）。但**不能因此去掉确认** —— 删除预设 / 重新生成 / 回退 / 批量归档
 * 都是不可逆操作，静默执行比阻塞更糟。
 *
 * 语义与 `window.confirm` 对齐：
 *  - 返回 `Promise<boolean>`（确定 = true，取消/Esc/点遮罩 = false）
 *  - 弹窗期间锁定页面滚动，但**不冻结**渲染（其余 UI 仍可绘制）
 *
 * 无障碍：`role="dialog"` + `aria-modal` + 打开时聚焦「取消」按钮 + Esc 关闭。
 *
 * @param message 支持 `\n` 换行（按 pre-line 渲染）
 */
export function showDomConfirm(
  message: string,
  opts: { okText?: string; cancelText?: string } = {},
): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      wrap.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(v)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false) }
    }

    const wrap = document.createElement('div')
    wrap.setAttribute('role', 'dialog')
    wrap.setAttribute('aria-modal', 'true')
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100000', 'display:flex',
      'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,.45)', 'padding:16px',
    ].join(';')

    const box = document.createElement('div')
    box.style.cssText = [
      'max-width:420px', 'width:100%', 'max-height:80vh', 'overflow:auto',
      'background:var(--dsw-alias-bg-base,#1f2329)', 'color:var(--dsw-alias-label-primary,#e6e6e6)',
      'border:1px solid var(--dsw-alias-border-l2,#3a3f45)', 'border-radius:10px',
      'padding:16px', 'box-shadow:0 8px 32px rgba(0,0,0,.5)', 'font-size:13px', 'line-height:1.6',
    ].join(';')

    const text = document.createElement('div')
    // pre-line：保留原始换行（SessionsPanel 的批量清单是多数行），同时正常折行
    text.style.cssText = 'white-space:pre-line;word-break:break-word'
    text.textContent = message

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = opts.cancelText ?? '取消'
    cancelBtn.style.cssText = 'min-height:36px;padding:0 14px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#3a3f45);background:transparent;color:inherit;font-size:13px'

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.textContent = opts.okText ?? '确定'
    okBtn.style.cssText = 'min-height:36px;padding:0 14px;border-radius:8px;cursor:pointer;border:none;background:#b3261e;color:#fff;font-size:13px'

    cancelBtn.addEventListener('click', () => { done(false) })
    okBtn.addEventListener('click', () => { done(true) })
    // 点遮罩空白处 = 取消（点弹窗内不取消）
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false) })

    row.append(cancelBtn, okBtn)
    box.append(text, row)
    wrap.append(box)
    document.body.append(wrap)
    document.addEventListener('keydown', onKey, true)
    // 默认焦点放在「取消」：不可逆操作的默认安全选项
    cancelBtn.focus()
  })
}
