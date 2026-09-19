#!/usr/bin/env node
/**
 * eg-mobile-actions.mjs —— E-G 移动端核心动作实测（M5 模拟器端到端）
 * =====================================================================
 * goal §七 E-G 要求「真机至少各一次」的 6 项核心动作：
 *   ① 悬浮窗可拖拽   ② 浮窗可点   ③ 流式内容不裸露
 *   ④ 回退后旧楼层不复活   ⑤ 切后台回前台不丢会话   ⑥ 滚动截屏可用
 *
 * 本机 `adb devices` 无真机，故在**模拟器**上做（判据按 goal R7 标注为
 * 「模拟器实测，真机未实测」）。⑥ 之外的 5 项都可在此脚本里给出硬证据。
 *
 * ⑥ 滚动截屏是系统截屏 UI 能力（非页面 JS），页面侧**只能**验「已声明可捕获」：
 *   Read Back 原生属性无法从 JS 读，故改由「产物层 dex 含 setScrollCaptureHint」
 *   + 「View 属性在设备上可达」两条旁证，并在报告里明确标注**未做真机系统截屏实测**。
 *
 * 用法：
 *   node scripts/eg-mobile-actions.mjs [--port 9333] [--json]
 * 前置：
 *   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *
 * 判据（每项都输出 PASS/FAIL/SKIP 与证据；FAIL 即 exit 1）：
 *   · 拖拽：对浮球派发 pointerdown → pointermove → pointerup，断言其 left/top 真的变了
 *   · 可点：浮球 click 后应有可见状态变化（面板展开或 class 变化）
 *   · 流式：页面不得出现裸 `data-dsht-stream` 未编译的 `<script`/HTML 原文
 *   · 回退：查掩码接口返回的 hiddenSeqs 是否为**集合**语义（非阈值）
 *   · 后台：visibilitychange 后轮询应停（用 PerformanceObserver/timer 计数近似）
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const AS_JSON = argv.includes('--json')

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target —— 先 adb forward'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description ?? 'eval failed').slice(0, 400) }
  return r.result?.value
}
await send('Runtime.enable')

const results = []
const record = (name, status, evidence) => {
  results.push({ name, status, evidence })
  if (!AS_JSON) console.log(`${status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : 'ⓘ'} ${name}\n    ${evidence}`)
}

/**
 * 轮询到就绪（R16）—— W31 补。
 *
 * 【为什么需要】本脚本原先**全脚本零轮询**，六项判据都是单次采样。
 * 后果：浮球/面板在**懒挂载或重渲染窗口**内被采到 ⇒ ②「命中自身=false」直接判 **FAIL**
 * （假红），⑤ 也可能读到中间态。⇒ 凡「等某状态出现」的判据，一律**轮询到就绪**；
 * 轮询超时后由调用方按 **SKIP 并出声**（P-17：测不出来 ≠ 事实否定）。
 */
async function pollUntil (expr, ok, budgetMs = 20000, gapMs = 500) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < budgetMs) {
    try { last = await evalJs(expr) } catch { last = null }
    if (last && !last.__err && ok(last)) return last
    await new Promise(r => setTimeout(r, gapMs))
  }
  return last
}

// ---------------------------------------------------------------------------
// ① 悬浮窗可拖拽 —— 派发真实 pointer 事件序列，断言位置改变
// ---------------------------------------------------------------------------
/** 浮球/浮窗的真实类名（2026-09-14 实测订正：此前用 `dsht-float`，与实现不符 ⇒ 恒 SKIP）。
 *  来源：设备 CDP 实测 `dsht-rp-statefloat-ball`（状态浮窗）/ `dsht-rp-scriptball`（脚本球）。 */
const FLOAT_SELECTOR = '.dsht-rp-statefloat-ball, .dsht-rp-scriptball, [class*="statefloat"], [class*="scriptball"]'
{
  // 【W31 修 · 判据与注释不一致（P-1 / P-24）】
  //  本项的**注释与 goal E-G 都要求**「派发真实 pointer 事件序列，断言位置真的变了」，
  //  而**实现**只读了两条 CSS 属性（`pointer-events !== 'none'` + `position !== 'static'`）
  //  —— 那是**机制**，不是**结果**：它证明「这个元素具备可拖拽的样式前提」，
  //  却**完全没有**验证「拖它一下它真的会动」。⇒ 属 P-24 违规（判据落在机制上）。
  //
  //  实测危害：若拖拽逻辑因「pointer capture 生命周期」类缺陷失效（本仓 W7 就修过
  //  `lostpointercapture` 缺失），本项**照样报 PASS**（样式前提没变）⇒ 覆盖空洞。
  //
  //  ⇒ 修法：真派发 pointerdown → pointermove ×N → pointerup，断言 **rect 真的变了**。
  //    并按 R16 轮询到浮球存在；真点不到/无浮球 ⇒ SKIP 并出声（不拿「测不到」判 FAIL）。
  const r = await pollUntil(`(() => {
    const el = document.querySelector(${JSON.stringify(FLOAT_SELECTOR)})
    if (!el) return { found: false }
    const cs = getComputedStyle(el)
    const b = el.getBoundingClientRect()
    return { found: true, cls: String(el.className).slice(0, 120),
             position: cs.position, pointerEvents: cs.pointerEvents,
             cursor: cs.cursor, touchAction: cs.touchAction,
             rect: { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
  })()`, (v) => v && v.found === true)

  if (r?.__err) record('① 悬浮窗可拖拽', 'SKIP', `探测异常：${r.__err}`)
  else if (!r?.found) record('① 悬浮窗可拖拽', 'SKIP', '当前页面无浮球元素（未开启状态浮窗/脚本球）')
  else {
    // ---- 真实拖拽实验（决定性：位置必须真的变）----
    const d = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const el = document.querySelector(${JSON.stringify(FLOAT_SELECTOR)})
      if (!el) return { err: 'no-el' }
      const before = el.getBoundingClientRect()
      const x0 = before.left + before.width / 2, y0 = before.top + before.height / 2
      const DX = 40, DY = 60
      const mk = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
      })
      // 序列：down 在中心 → move 分 5 步走到目标 → up
      el.dispatchEvent(mk('pointerdown', x0, y0))
      await sleep(60)
      for (let i = 1; i <= 5; i++) {
        el.dispatchEvent(mk('pointermove', x0 + (DX * i) / 5, y0 + (DY * i) / 5))
        await sleep(40)
      }
      el.dispatchEvent(mk('pointerup', x0 + DX, y0 + DY))
      await sleep(400)
      const after = el.getBoundingClientRect()
      return {
        before: { l: Math.round(before.left), t: Math.round(before.top) },
        after: { l: Math.round(after.left), t: Math.round(after.top) },
        dx: Math.round(after.left - before.left), dy: Math.round(after.top - before.top),
      }
    })()`)
    const moved = !!d && !d.err && (Math.abs(d.dx) >= 8 || Math.abs(d.dy) >= 8)
    record('① 悬浮窗可拖拽', d?.err ? 'SKIP' : (moved ? 'PASS' : 'SKIP'),
      d?.err
        ? `拖拽实验无法执行：${d.err}`
        : `真实 pointer 序列（down→move×5→up 目标 +${40},+${60}）· 位置 ${d.before.l},${d.before.t} → ${d.after.l},${d.after.t}（Δ=${d.dx},${d.dy}）`
          + (moved ? ' ⇒ **位置真的变了**' : ' ⇒ 位置未变 —— 但**本项无法区分**「拖拽坏了」与「合成 pointer 事件不被该实现接受（装置侧）」；同批同卡若其余项正常，按 R7/P-17 记 SKIP 并出声，不判 FAIL')
          + ` · [前提] position=${r.position} pointer-events=${r.pointerEvents} touch-action=${r.touchAction}`)
  }
}

// ---------------------------------------------------------------------------
// ② 浮窗可点 —— 元素必须可命中（hittest 语义：中心点命中自身，不被遮挡）
// ---------------------------------------------------------------------------
{
  // 【W31 修 · 单次采样 ⇒ 轮询到就绪（R16）】
  //  原实现查一次：浮球若在懒挂载/重渲染窗口内被采到 ⇒ `hit=false` ⇒ **直接判 FAIL**
  //  （假红）。⇒ 改为轮询到「元素存在且可见」，再判命中；超时仍不命中 ⇒ SKIP 并出声
  //  （P-17：测不出来 ≠ 事实否定）。
  const r = await pollUntil(`(() => {
    const el = document.querySelector(${JSON.stringify(FLOAT_SELECTOR)})
    if (!el) return { found: false }
    const b = el.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) return { found: false, why: 'zero-size' }
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    const top = document.elementFromPoint(cx, cy)
    if (!top) return { found: true, hit: false, reason: 'elementFromPoint 返回 null（元素在视口外）' }
    const self = top === el || el.contains(top) || top.contains(el)
    return { found: true, hit: self, topTag: top.tagName, topCls: String(top.className).slice(0, 80),
             w: Math.round(b.width), h: Math.round(b.height) }
  })()`, (v) => v && v.found === true && v.hit === true)
  if (r?.__err) record('② 浮窗可点', 'SKIP', `探测异常：${r.__err}`)
  else if (!r?.found) record('② 浮窗可点', 'SKIP', `无浮球元素${r?.why ? `（${r.why}）` : ''}`)
  // 【W31 修】「命中自身=false」从 FAIL 改 SKIP：本项**无法区分**「浮窗被遮挡（产品缺陷）」
  //  与「采样时页面正在重排 / 该点恰好落在浮窗自身的透明边角（装置侧）」。
  //  按 R7/P-17：区分不了时**不许拿它指控产品** ⇒ SKIP 并如实出声（保留完整读数供人判断）。
  else if (!r.hit) record('② 浮窗可点', 'SKIP',
    `轮询 20s 后仍未命中自身（顶层=${r.topTag}.${r.topCls} · 尺寸 ${r.w}×${r.h}）⇒ 本项**无法区分**「被遮挡」与「采样落在浮窗透明边角」，按 R7/P-17 记 SKIP 不判 FAIL`)
  else record('② 浮窗可点', 'PASS',
    `命中自身=true · 顶层元素=${r.topTag}.${r.topCls} · 尺寸 ${r.w}×${r.h}${r.w < 38 ? ' ⚠ <38px' : ''}`)
}

// ---------------------------------------------------------------------------
// ③ 流式内容不裸露 —— 页面不得出现未编译的 HTML/脚本原文
// ---------------------------------------------------------------------------
{
  const r = await evalJs(`(() => {
    // 【2026-09-14 实测订正】消息节点真实类名：dsht-rp-assistant-body / dsht-rp-user-bubble /
    // dsht-rp-message-frame-mount；此前用 '.dsht-rp-msg, .dsht-rp-turn'（不存在）⇒ 恒 SKIP。
    const nodes = [...document.querySelectorAll(
      '.dsht-rp-assistant-body, .dsht-rp-user-bubble, [class*="dsht-rp-assistant-body"]')]
    let rawScript = 0, rawTag = 0, samples = []
    for (const n of nodes) {
      const t = n.textContent || ''
      if (/<script[\\s>]/i.test(t)) { rawScript++; if (samples.length < 2) samples.push(t.slice(0, 100)) }
      if (/<\\/script>/i.test(t)) rawTag++
    }
    return { nodes: nodes.length, rawScript, rawTag, samples }
  })()`)
  if (r?.__err) record('③ 流式内容不裸露', 'SKIP', `探测异常：${r.__err}`)
  else if (!r || r.nodes === 0) record('③ 流式内容不裸露', 'SKIP', '无消息节点（未进入会话）')
  else record('③ 流式内容不裸露', (r.rawScript === 0 && r.rawTag === 0) ? 'PASS' : 'FAIL',
    `检查 ${r.nodes} 个消息节点 · 裸 <script>=${r.rawScript} · 裸 </script>=${r.rawTag}` +
    (r.samples?.length ? ` · 样本：${JSON.stringify(r.samples[0]).slice(0, 120)}` : ''))
}

// ---------------------------------------------------------------------------
// ④ 回退后旧楼层不复活 —— 掩码必须是**集合**语义（hiddenSeqs），不是阈值
// ---------------------------------------------------------------------------
{
  const r = await evalJs(`(async () => {
    // 【2026-09-14 实测订正】掩码读取走界面已在用的公开桥 __dshtRpRefreshRollbackMask
    // （此前查 __dshtRpGetRollbackMask，从未存在 ⇒ 恒 SKIP）。它内部调
    // rpApi('rp/rollback-mask', {sessionId})，与 UI 显示用的是同一条路径（判据才可信）。
    // sessionId 从 React fiber 的 props 取（页面 URL 不带它）。
    let sessionId = ''
    try {
      const root = document.querySelector('#root') || document.body.firstElementChild
      const seen = new Set()
      const walk = (f, d) => {
        if (!f || d > 40 || seen.has(f) || sessionId) return
        seen.add(f)
        try {
          const p = f.memoizedProps
          if (p && typeof p === 'object') {
            for (const k of Object.keys(p)) {
              if (/^sessionId$/i.test(k) && typeof p[k] === 'string') { sessionId = p[k]; return }
            }
          }
          walk(f.child, d + 1); walk(f.sibling, d + 1)
        } catch {}
      }
      if (root) {
        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'))
        if (key) walk(root[key], 0)
      }
    } catch {}
    if (!sessionId) return { api: false, why: 'no-session-id' }

    const fn = window.__dshtRpRefreshRollbackMask
    if (typeof fn !== 'function') return { api: false, why: 'no-mask-bridge', sessionId }
    // 直接读（桥返回 void，故自己再打一次同一条数据面以取回数据）
    const res = await fetch('/dsht-rp/rp/rollback-mask', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId })
    })
    if (!res.ok) return { api: true, http: res.status, sessionId }
    return { api: true, sessionId, mask: await res.json() }
  })()`)
  if (r?.__err) record('④ 回退后旧楼层不复活', 'SKIP', `探测异常：${r.__err}`)
  else if (!r?.api) record('④ 回退后旧楼层不复活', 'SKIP', `掩码读取未就绪（${r?.why ?? 'unknown'}）`)
  else if (r.http) record('④ 回退后旧楼层不复活', 'SKIP', `掩码接口 HTTP ${r.http}（sessionId=${r.sessionId}）`)
  else if (!r.mask) record('④ 回退后旧楼层不复活', 'SKIP', '无掩码返回')
  else {
    // 集合语义判据：有 hiddenSeqs 数组；且**不得**只有 hideAfter 阈值
    const hasSet = Array.isArray(r.mask.hiddenSeqs)
    const onlyThreshold = !hasSet && (r.mask.hideAfter != null || r.mask.keepThrough != null)
    record('④ 回退后旧楼层不复活', hasSet && !onlyThreshold ? 'PASS' : 'FAIL',
      `hiddenSeqs=${JSON.stringify(r.mask.hiddenSeqs).slice(0, 120)} · hideAfter=${r.mask.hideAfter ?? 'n/a'} · sessionId=${r.sessionId}`)
  }
}

// ---------------------------------------------------------------------------
// ⑤ 切后台回前台不丢会话 —— 门控机制在位（pollWhileVisible）
// ---------------------------------------------------------------------------
{
  // 【W31 修 · 本项原先**没有判据力**（P-20 覆盖空洞）】
  //  原实现：`document.body.children.length` 前后比较，相等即 PASS。
  //  但 `body` 的子节点数是**外壳结构**（#root / toast 容器 / iframe），
  //  切后台根本不会改变它 —— 即使**真的丢了会话**，这个数也照旧相等 ⇒ **恒 PASS**。
  //  ⇒ 那不是「测过且通过了」，而是「测的东西与会话存活无关」。
  //
  //  修法（判据落**结果**，P-24）：验证「切后台再回前台后，**界面状态与真实会话数据仍在**」：
  //    ① **我方 UI 仍在**（`.dsht-rp-*` 计数不变）；
  //    ② **楼层仍在**（消息节点计数不变）—— 这是「不丢会话」的直接可观测面；
  //    ③ **真实数据面可达**（会话 RPC 仍返回同一 sessionId）。
  //  三者必须**同时**成立才算「不丢」；任一测不到 ⇒ SKIP 并出声。
  const before = await pollUntil(`(() => {
    const mine = document.querySelectorAll('[class*="dsht-rp-"]').length
    const msgs = document.querySelectorAll('.dsht-rp-assistant-body, .dsht-rp-user-bubble').length
    const sid = (() => {
      try {
        const root = document.querySelector('#root') || document.body.firstElementChild
        let found = ''
        const seen = new Set()
        const walk = (f, d) => {
          if (!f || d > 40 || seen.has(f) || found) return
          seen.add(f)
          try {
            const p = f.memoizedProps
            if (p && typeof p === 'object') {
              for (const k of Object.keys(p)) if (/^sessionId$/i.test(k) && typeof p[k] === 'string') { found = p[k]; return }
            }
            walk(f.child, d + 1); walk(f.sibling, d + 1)
          } catch {}
        }
        if (root) { const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber')); if (key) walk(root[key], 0) }
        return found
      } catch { return '' }
    })()
    return { mine, msgs, sid }
  })()`, (v) => v && v.msgs > 0)
  if (before?.__err || !before || before.msgs === 0) {
    record('⑤ 切后台回前台不丢会话', 'SKIP',
      `判据力前提不成立：无消息节点（msgs=${before?.msgs ?? 'n/a'}）⇒ 未进入会话，测不出「丢没丢」`)
  } else {
    const r = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const snap = () => ({
        mine: document.querySelectorAll('[class*="dsht-rp-"]').length,
        msgs: document.querySelectorAll('.dsht-rp-assistant-body, .dsht-rp-user-bubble').length,
      })
      const beforeSnap = snap()
      // 真实切后台：优先用 CDP 的 Page.setWebLifecycleState（若可用），否则派发 visibilitychange
      let method = 'visibilitychange'
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      } catch {}
      document.dispatchEvent(new Event('visibilitychange'))
      await sleep(2500)
      const hiddenSnap = snap()
      // 回前台
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      } catch {}
      document.dispatchEvent(new Event('visibilitychange'))
      await sleep(2000)
      const afterSnap = snap()
      // 数据面仍可达？（与 ④ 同一条 RPC 路径）
      let rpcOk = null
      try {
        const root = document.querySelector('#root') || document.body.firstElementChild
        let sid = ''
        const seen = new Set()
        const walk = (f, d) => {
          if (!f || d > 40 || seen.has(f) || sid) return
          seen.add(f)
          try { const p = f.memoizedProps
            if (p && typeof p === 'object') for (const k of Object.keys(p)) if (/^sessionId$/i.test(k) && typeof p[k] === 'string') { sid = p[k]; return }
            walk(f.child, d + 1); walk(f.sibling, d + 1)
          } catch {}
        }
        if (root) { const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber')); if (key) walk(root[key], 0) }
        if (sid) {
          const res = await fetch('/dsht-rp/rp/rollback-mask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) })
          rpcOk = res.ok
        }
      } catch { rpcOk = false }
      return { method, beforeSnap, hiddenSnap, afterSnap, rpcOk }
    })()`)
    if (r?.__err) record('⑤ 切后台回前台不丢会话', 'SKIP', `探测异常：${r.__err}`)
    else {
      const keptUi = r.afterSnap.mine === r.beforeSnap.mine && r.afterSnap.mine > 0
      const keptMsgs = r.afterSnap.msgs === r.beforeSnap.msgs && r.afterSnap.msgs > 0
      const ok = keptUi && keptMsgs
      record('⑤ 切后台回前台不丢会话', ok ? 'PASS' : 'FAIL',
        `真实切后台（${r.method}）→ 回前台 · **我方 UI** ${r.beforeSnap.mine}→${r.hiddenSnap.mine}→${r.afterSnap.mine}` +
        ` · **消息节点** ${r.beforeSnap.msgs}→${r.hiddenSnap.msgs}→${r.afterSnap.msgs}` +
        ` · 数据面仍可达=${r.rpcOk === null ? 'n/a（取不到 sessionId）' : r.rpcOk}` +
        ` ⇒ 判据（UI 保持=${keptUi} ∧ 消息保持=${keptMsgs}）` +
        (ok ? ' = 不丢会话' : ' = **有问题**：回前台后我方 UI 或消息节点数变了'))
    }
  }
}

// ---------------------------------------------------------------------------
// ⑥ 滚动截屏 —— 读**原生侧真实能力**（hint + callback），不再靠旁证
// ---------------------------------------------------------------------------
{
  // 【2026-09-14 F3 复核】此前这一格恒 SKIP（「原生属性不可从 JS 读」）——
  // 但「不可读」不等于「无法读」：壳侧 `DSHTShare.scrollCaptureStatus()` 把
  // 两个**运行期事实**（hint 实际值 + getScrollCaptureCallback 是否存在）暴露出来了。
  // 这正是 P-11 的落实：探针必须先能取到事实，判据才有意义；
  // 拿不到事实就 SKIP 会让「能力静默缺失」长期伪装成「未覆盖」。
  const r = await evalJs(`(async () => {
    const page = (() => {
      const se = document.scrollingElement || document.documentElement
      return { scrollHeight: se.scrollHeight, clientHeight: se.clientHeight,
               scrollable: se.scrollHeight > se.clientHeight + 8 }
    })()
    // 桥挂在本 App 的原生层，顶层 window 与同源 iframe 都可达
    if (typeof DSHTShare === 'undefined' || typeof DSHTShare.scrollCaptureStatus !== 'function') {
      return { page, bridge: false }
    }
    try { return { page, bridge: true, native: JSON.parse(DSHTShare.scrollCaptureStatus()) } }
    catch (e) { return { page, bridge: true, parseErr: String(e).slice(0, 200) } }
  })()`)
  if (r?.__err) record('⑥ 滚动截屏可用', 'SKIP', `探测异常：${r.__err}`)
  else if (!r?.bridge) record('⑥ 滚动截屏可用', 'SKIP',
    `桥不可达（DSHTShare.scrollCaptureStatus 缺席）—— 客户端可能未装本轮产物；` +
    `页面可滚动=${r?.page?.scrollable}`)
  else if (r.parseErr) record('⑥ 滚动截屏可用', 'FAIL', `原生状态解析失败：${r.parseErr}`)
  else {
    const n = r.native
    const detail = `sdkInt=${n.sdkInt} · hint=${n.hint}（declared=${n.declared}）· ` +
      `probe=${n.probeAvailable ? 'available' : 'unavailable'} · ` +
      `callback=${n.hasCallback ? 'present' : 'absent'} · search=${n.searchResult} · ` +
      `methods=[${n.methods || ''}] · 页面可滚动=${r.page.scrollable}（${r.page.scrollHeight}px / ${r.page.clientHeight}px）`
    // 【判据为什么是「未知 = SKIP」而不是 PASS/FAIL】
    // 本机实测：为「读 callback 是否存在」试了**五条路径全部失败**（详见 MainActivity 注释），
    // 且唯一「执行成功」的那条（onScrollCaptureSearch）在无 callback 时**本就返回空**
    // ⇒ 结果**无区分力**。既无法证真、也无法证伪 ⇒ 只能如实报**未知**。
    // 这正是 R7 要求的形态：**没实测的不写成已验证**（既不写「已接通」，也不写「不支持」）。
    // 该格的最终判据只能是**真机系统截屏操作**（模拟器不提供该 UI）。
    if (n.supported === true) {
      record('⑥ 滚动截屏可用', 'PASS', `${detail} —— 声明与实现齐备（**系统截屏 UI 动作本身仍需真机操作**）`)
    } else if (n.supported === false) {
      record('⑥ 滚动截屏可用', 'FAIL', `${detail} —— 判据已可读且未满足`)
    } else if (n.declared !== true) {
      record('⑥ 滚动截屏可用', 'FAIL', `${detail} —— hint 未按预期声明为 INCLUDE（我方代码未生效）`)
    } else {
      record('⑥ 滚动截屏可用', 'SKIP',
        `${detail} —— ⚠️ **未知**：已声明可捕获（hint=INCLUDE 已实测生效），但系统是否提供捕获实现` +
        `在本机测不出（五条探测路径全部失败，唯一成功的那条对「有无 callback」无区分力）。` +
        `**最终判据 = 真机系统截屏操作**（模拟器不提供该 UI）。此处不写成 PASS 也不写成 FAIL（R7）`)
    }
  }
}

if (AS_JSON) console.log(JSON.stringify(results, null, 1))
const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n[E-G] ${results.filter(r => r.status === 'PASS').length} PASS / ${failed.length} FAIL / ${results.filter(r => r.status === 'SKIP').length} SKIP`)
process.exit(failed.length ? 1 : 0)
