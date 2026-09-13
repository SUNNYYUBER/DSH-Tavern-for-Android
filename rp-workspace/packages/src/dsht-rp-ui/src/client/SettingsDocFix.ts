/**
 * 批次修复 9：设置页「打开配置文件」按钮的 Android 修复（DOM 增强）。
 *
 * 原生按钮（ui-settings-general SettingsDocumentAction，settings.action 席位）
 * 走 settings.openDocument RPC——桌面 handler 在 Android 不存在，必失败报错。
 * 这里在 document 捕获阶段拦截该按钮的点击（React 事件挂在 root 容器上，
 * document 捕获监听器先跑；preventDefault + stopPropagation 后原生 handler
 * 收不到事件，报错被静默），替换为自家弹层：配置文件绝对路径 + 复制路径。
 * Android 没有系统文件打开通道，内容查看引导用户找会话里的 harness。
 */
import { rpApi } from './rpc.ts'

/** 原生按钮文案（zh/en locale 两形态） */
const BUTTON_TEXTS = new Set(['打开配置文件', 'Open configuration file'])

let overlay: HTMLElement | null = null

function closeOverlay(): void {
  overlay?.remove()
  overlay = null
}

/** 【2026-09-13 修复·假成功（D-9）】原签名 `copyText(text, done)` 只在成功路径调 done，
 *  但 `document.execCommand('copy')` 返回 false 时**不抛异常**（旧 WebView/非聚焦文档常见）
 *  ⇒ 静默不调 done，用户看到按钮无反应；而调用方也无从区分成败。
 *  改为返回 boolean 由调用方如实反馈（已复制 / 复制失败请长按手动复制）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 旧 WebView 无 async clipboard：回退隐藏 textarea + execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.append(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}

async function showConfigOverlay(): Promise<void> {
  closeOverlay()
  overlay = document.createElement('div')
  overlay.className = 'dsht-cfgdoc-mask'
  overlay.innerHTML = `
    <div class="dsht-cfgdoc" role="dialog" aria-label="配置文件位置">
      <div class="cd-title">配置文件</div>
      <div class="cd-path" data-path>读取路径中…</div>
      <div class="cd-note">手机端无法直接调起系统编辑器——要查看或改动内容，把需求发给任意会话里的 harness，它会自己处理。</div>
      <div class="cd-actions">
        <button type="button" class="cd-btn" data-copy disabled>复制路径</button>
        <button type="button" class="cd-btn" data-close>关闭</button>
      </div>
    </div>`
  document.body.append(overlay)
  const pathEl = overlay.querySelector<HTMLElement>('[data-path]')
  const copyBtn = overlay.querySelector<HTMLButtonElement>('[data-copy]')
  overlay.querySelector('[data-close]')?.addEventListener('click', closeOverlay)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay() })

  let path = ''
  try {
    const r = await rpApi<{ dshHome: string }>('rp/home')
    path = `${r.dshHome}/settings.yaml`
  } catch { /* 数据面不可达：显示占位说明 */ }
  if (!overlay.isConnected) return
  if (pathEl) pathEl.textContent = path || '（配置路径读取失败——请确认 DSHTavern 插件在运行）'
  if (path && copyBtn) {
    copyBtn.disabled = false
    copyBtn.addEventListener('click', () => {
      // 【2026-09-13 修复·假成功（D-9）】如实反馈复制成败（并标注路径文本可长按手选）
      void copyText(path).then(ok => {
        copyBtn.textContent = ok ? '已复制 ✓' : '复制失败，请长按路径手动复制'
      })
    })
  }
}

/** 安装拦截器；返回卸载函数（插件 fiber 随动）。 */
export function installSettingsDocFix(): () => void {
  if (typeof document === 'undefined') return () => { /* SSR/测试环境 */ }
  const onClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest?.('button')
    if (!btn) return
    // 只在设置面板内生效（.VOzbGW_panel = ui-settings-general 根；hash 类名随
    // runtime pinned 版本固定，升级需复核——与 style.ts 竖屏补丁同一约束）
    if (btn.closest('.VOzbGW_panel') === null) return
    if (!BUTTON_TEXTS.has(btn.textContent?.trim() ?? '')) return
    e.preventDefault()
    e.stopPropagation()
    void showConfigOverlay()
  }
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    closeOverlay()
  }
}
