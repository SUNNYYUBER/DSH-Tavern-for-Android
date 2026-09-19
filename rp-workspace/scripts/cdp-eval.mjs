/**
 * cdp-eval.mjs —— 设备探针的 **CDP 求值单源**（P-1）
 * =====================================================================
 * 【为什么要有这个文件】
 *   本项目有 17 个设备探针（`ef-*.mjs` / `eg-mobile-actions.mjs` / `perf-audit.mjs` …），
 *   每个都要「连 CDP → Runtime.evaluate → 取回值」。此前这段逻辑被**逐字复制**到多处，
 *   于是**缺陷也一起被复制**：W30 实测 `ef-touch-targets.mjs` 与 `ef-font-scale.mjs`
 *   的 `ev()` 是**逐字同构的两份拷贝**，连「`tries/gap` 只在抛异常时重试」这个缺陷
 *   都一模一样 —— 修一处**不会**传导到另一处（P-1 违例）。
 *
 *   更关键的是：本项目已有的「同一功能多实现」门禁 `audit-impl-duplication.mjs`
 *   **只扫 `packages/src` 的源文件，不扫 `scripts/`** ⇒ 这处重复它**结构性看不见**
 *   （P-11 的**元级**形态：判据的覆盖面本身没有判据）。
 *
 * 【口径（W30/W31 两次实测确定）】
 *   `tries`/`gap` 是**连接级**重试：连不上 CDP / 页面正在重建时重试。
 *   它**不负责**「返回值是否满足业务条件」—— 那是调用方的事，
 *   而且**必须用轮询**（见 `pollUntil`），因为 `Runtime.evaluate` 正常返回
 *   `false`/`null` **不会抛异常**，仅在 catch 里重试等于「只查一次」
 *   （这正是 W30 抓到的「就绪竞态」，R16 的两半只写了一半）。
 *
 * 【用法】
 *   import { makeEv, pollUntil } from './cdp-eval.mjs'
 *   const ev = makeEv({ port: 9333 })
 *   await ev('1+1')                        // 一次性求值（连接级重试）
 *   await pollUntil(ev, expr, ok, 30000)   // 轮询到就绪（业务级）
 */

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 造一个 `ev(expr, tries, gap)`。
 *
 * 【每次求值新建连接】—— 见 R15「测具不得假设目标身份稳定」：
 * 探针运行期间页面可能重载 / 进程可能重启（M7 收尾会 `am force-stop`），
 * 复用旧连接会静默拿到失效 target。
 *
 * @param {{port?: string|number, tries?: number, gap?: number}} opts
 */
export function makeEv (opts = {}) {
  const PORT = String(opts.port ?? process.env.CDP_PORT ?? 9333)
  const DEF_TRIES = opts.tries ?? 12
  const DEF_GAP = opts.gap ?? 1200

  return async function ev (expr, tries = DEF_TRIES, gap = DEF_GAP) {
    let lastErr = null
    for (let i = 0; i < tries; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
        const page = targets.find((t) => t.type === 'page')
        if (!page) { await defaultSleep(gap); continue }
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        let n = 0
        const pend = new Map()
        const send = (m, p = {}) => new Promise((res, rej) => {
          const id = ++n
          pend.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method: m, params: p }))
        })
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data)
          if (m.id && pend.has(m.id)) {
            const q = pend.get(m.id)
            pend.delete(m.id)
            m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result)
          }
        })
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
        await send('Runtime.enable')
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
        ws.close()
        if (r.exceptionDetails) {
          throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 300))
        }
        return r.result?.value
      } catch (e) { lastErr = e; await defaultSleep(gap) }
    }
    throw new Error('CDP 求值失败（已重试 ' + tries + ' 次）：' + String(lastErr?.message ?? lastErr))
  }
}

/**
 * 轮询到就绪（R16）—— **业务级**等待，与 `ev` 的**连接级**重试是两件事。
 *
 * 【为什么必须单独有一个】W30 实测：判据写 `await ev(expect, 2, 900)` 以为「查两次」，
 * 而 `ev` 的 `tries/gap` **只在抛异常时**才重试；`expect` 返回 `false` 时**不抛**、
 * 直接返回 ⇒ **等于只查一次**。对懒挂载 / 慢渲染的 UI 会偶发误报「该状态未生效」。
 *
 * @param {(expr: string, tries?: number, gap?: number) => Promise<any>} ev
 * @param {string} expr
 * @param {(v: any) => boolean} ok  满足即返回
 * @param {number} budgetMs 上限（超时返回**最后一次**读数，由调用方判定）
 */
export async function pollUntil (ev, expr, ok, budgetMs = 30000, gapMs = 600) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < budgetMs) {
    try { last = await ev(expr, 1, 300) } catch { last = null }
    if (last !== null && last !== undefined && ok(last)) return last
    await defaultSleep(gapMs)
  }
  return last
}
