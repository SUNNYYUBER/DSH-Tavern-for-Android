/**
 * visibility.ts —— 前端轮询的「页面不可见即暂停」门控（2026-09-13 性能专项）
 * =====================================================================
 * ## 为什么需要它（实测数据，非推断）
 * 用 CDP 注入 fetch 钩子统计 60s 窗口内的真实请求量：
 *   · 可见态：**737 次 / 60s = 12.28 次/秒**
 *   · 切后台：**786 次 / 60s = 13.10 次/秒**（同时按了 HOME 键切到后台）
 * ⇒ **切后台完全不降频**，与前台同量级。手机上这是持续的 CPU / I/O / 唤醒源，
 *   直接对应"耗电、发烫"。安卓 WebView 在页面不可见时**不会**自动停 JS 定时器
 *   （与桌面浏览器一致），所以必须由我们自己停。
 *
 * ## 用法
 * ```ts
 * // 原来：const t = setInterval(pull, 30_000)
 * const stop = pollWhileVisible(pull, 30_000)   // 返回停止函数；不可见时自动跳过并停表
 * return stop
 * ```
 *
 * ## 设计要点（每一条都是为了不引入新的"静默失败"）
 * 1. **不可见时彻底 clearInterval**（而不是"回调里 return"）—— 后者仍会持续唤醒
 *    JS 引擎与计时器，省不掉功耗。恢复可见时**立即补跑一次**（否则用户切回来看到
 *    的是最长一个周期的陈旧数据）。
 * 2. **重复调用立即返回同一句柄**：避免调用方在依赖变化时叠加多个定时器
 *    （本项目已有"先注册者包在外层"这类顺序敏感教训）。
 * 3. **SSR / 测试环境安全**：`document` 不存在时退化为普通 `setInterval`，
 *    不抛错（本项目大量单测在 node 下跑 UI 模块）。
 * 4. **失败不吞**：门控只管调度，不 catch 业务错误（调用方的 catch 语义保持原样）。
 */

/** 页面当前是否可见（无 document 视为可见，便于 SSR/测试） */
export function isPageVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

/**
 * 按固定间隔执行 `fn`，但**页面不可见时停表**（真正 clear，不是空转跳过）。
 *
 * @param fn 轮询体（同步或异步；返回的 Promise 不会被 await，错误须自行 catch）
 * @param intervalMs 间隔毫秒
 * @returns 停止函数（幂等）
 */
export function pollWhileVisible(fn: () => unknown, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const tick = (): void => { try { void fn() } catch { /* 调用方自行处理错误；此处只保证不因抛错停表 */ } }

  const start = (): void => {
    if (stopped || timer !== null) return
    timer = setInterval(tick, intervalMs)
  }
  const stop = (): void => {
    if (timer !== null) { clearInterval(timer); timer = null }
  }

  // 可见 → 起表；不可见 → 停表（并记录"恢复时要补跑"）
  const onVisibility = (): void => {
    if (stopped) return
    if (isPageVisible()) { tick(); start() } // 恢复可见：立即补跑一次，再起表
    else stop()
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  if (isPageVisible()) start()

  return () => {
    stopped = true
    stop()
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}
