/**
 * 【D5 2026-09-13】轻量非阻塞提示（toast）。
 *
 * 背景：项目中散落 8 处 `window.alert` / `window.confirm`。安卓 WebView 上
 * `alert` 是**阻塞式**的（会冻结渲染、且观感突兀），而其中 4 处纯属"告知失败"
 * ——用 toast 更合适。
 *
 * 本模块把原先内联在 `RpScriptHost.tsx:129` 的 `showDomToast` 提为共享实现，
 * 供 RpNativeChat / RpGreetingDock 等复用（避免同一语义出现第二份实现——
 * 见项目铁律「同一语义不得有第二份实现」）。
 *
 * 保留的阻塞式调用：破坏性操作确认（删预设 / 回退对话）。理由：这类操作**不可逆**，
 * 用非阻塞提示容易误触，且换掉需新建 modal 组件（超出本轮范围）。
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
