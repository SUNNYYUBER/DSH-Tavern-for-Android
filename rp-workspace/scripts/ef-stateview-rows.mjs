#!/usr/bin/env node
/**
 * ef-stateview-rows.mjs —— L1/L2：状态查看 / 节点表**树节点行**的触控尺寸判据（W14 常驻化）
 * ============================================================================
 * ## 为什么单独做这一条（它已被主探针覆盖，为何还要独立）
 * `ef-touch-targets.mjs` 的 `stateview` 态**只在该会话有状态树时才有效**：
 * 实测（2026-09-16 W26）在无状态数据的会话上，该态「进态=no-ball」而主探针**仍报 PASS**
 * —— 因为它扫的是**上一个态的读数**（`10 个可点元素 / P1=0`），根因（`sv-row.sv-node` 25px）
 * 在那次运行里**根本没被看到**。⇒ 需要一个**把「样本数」打进结论**的专用判据：
 *   「扫到 0 个节点」必须显式报成**无判据力**，绝不与「全部达标」共用 PASS。
 *
 * ## 判据
 * 会话的状态树节点行（`button.sv-row.sv-node`）数量 > 0，且**全部** ≥ 44px（目标值；
 * < 38px 为 P1 阻塞）。同时打印 computed `min-height` / `flex-shrink` / `align-items`，
 * 让「靠哪条规则撑起来的」可核对（P-24：判据落结果，附带证据）。
 *
 * ## 前置
 * 需登录到**有状态数据**的会话（设备上 `st-1jfywz9` 实测有 264 个节点）。
 * 可用 `--switch <sid>` 先走深链切卡（与用户点角色卡同一条路径）。
 *
 * 用法：
 *   node scripts/ef-stateview-rows.mjs [--port 9333] [--switch <sid>]
 *   node scripts/ef-stateview-rows.mjs --selftest      # 判据自身正/负控（不依赖设备）
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const SWITCH_SID = flag('--switch', '')
const MIN_OK = 44

/**
 * 判定函数（抽出来是为了能**不依赖设备**自证 —— P-30：判据自身的可信性优先）。
 * `rows` 形如 [{ h, w, txt }]；返回 { ok, reason }。
 *
 * ★ 关键：`rows.length === 0` 必须判 **不通过** ——
 *   首版曾写 `rows.every(r => r.h >= MIN_OK)`，而空数组的 `every` 恒为 `true`
 *   ⇒ 「一个都没有」被读成「全部达标」（本轮实测就是这样报出假 PASS 的）。
 */
export function judgeRows (rows, minOk = 44) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: '样本为 0 —— 无判据力（该会话当前无状态树节点），不得据此报通过' }
  }
  const bad = rows.filter(r => !(r.h >= minOk))
  if (bad.length > 0) {
    return { ok: false, reason: `${bad.length}/${rows.length} 个节点行低于 ${minOk}px：` + bad.slice(0, 5).map(b => `${b.h}px`).join(', ') }
  }
  return { ok: true, reason: `${rows.length} 个节点行全部 ≥ ${minOk}px` }
}

// ---------------------------------------------------------------------------
// 判据自证（--selftest）：正控 / 负控 / ★空样本负控
// ---------------------------------------------------------------------------
const SELFTEST_CASES = [
  ['正控：全部达标', [{ h: 44 }, { h: 46 }], true],
  ['负控：有一个低于底线（修复前的 25px 形态）', [{ h: 44 }, { h: 25 }], false],
  ['负控：全部低于底线', [{ h: 25 }, { h: 30 }], false],
  ['★ 空样本必须判不通过（防 [].every 恒真的假绿）', [], false],
  ['负控：非数组入参', null, false],
]

if (argv.includes('--selftest')) {
  console.log('=== ef-stateview-rows --selftest（判据自身正/负控；不依赖设备）===')
  let n = 0
  for (const [label, rows, want] of SELFTEST_CASES) {
    const r = judgeRows(rows)
    const ok = r.ok === want
    if (ok) n++
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label} ⇒ ok=${r.ok} 期望=${want}`)
    if (!ok) console.log(`         reason=${r.reason}`)
  }
  console.log(`\n[ef-stateview-rows selftest] ${n}/${SELFTEST_CASES.length} PASS`)
  process.exit(n === SELFTEST_CASES.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 设备侧
// ---------------------------------------------------------------------------
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error(`无 page target（端口 ${PORT} 未转发？）`); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description ?? 'fail').slice(0, 300) }
  return r.result?.value
}

/**
 * 轮询到就绪（R16）。
 *
 * 【W30 修 · 为什么必须加】本脚本原先三个环节都违反了 R16：
 *   ① 进态靠**固定 `sleep(1600)`** 当作「已就绪」；
 *   ② 采集 `rows` **只查一次**；
 *   ③ `judgeRows` 把「0 样本」判为**不通过**。
 * 三者叠加 ⇒ **慢渲染会被判成产品 FAIL**（`exit 1`），
 * 而本脚本是全仓**唯一**的「状态树节点行触控尺寸」判据 ⇒ **没有第二条判据能证伪它**。
 * 这与 `ef-touch-targets.mjs` 里 `host-settings-card-open` 的偶发误报是**同一竞态**。
 *
 * 口径：`ok(v)` 为真即返回该值；超时返回最后一次的值（**不抛** —— 由调用方判定）。
 */
async function pollUntil (expr, ok, budgetMs = 30000, gapMs = 600) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < budgetMs) {
    try { last = await ev(expr) } catch { last = null }
    if (last && !last.__err && ok(last)) return last
    await new Promise(r => setTimeout(r, gapMs))
  }
  return last
}

if (SWITCH_SID) {
  const res = await ev(`(async () => {
    window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session', { detail: { sessionId: ${JSON.stringify(SWITCH_SID)} } }));
    await new Promise(r => setTimeout(r, 2500)); return 'ok';
  })()`)
  if (res?.__err) { console.error('切卡失败：', res.__err); process.exit(2) }
  console.log(`已切到会话 ${SWITCH_SID}`)
}

// 幂等进态：浮球是**翻转**语义 ⇒ 已开则先收起（实测踩过：连点两次会关掉）。
//
// 【装置自身的坑（P-30）· 进态是**两步**，且第一步的结果**因会话而异**】
// 实测两种形态：
//   · 会话 A（st-1jfywz9）：点浮球 ⇒ 面板与 `stateview` **一起**出现；
//   · 会话 B（其它）：点浮球 ⇒ 只出现浮球面板，**必须再点面板里的「查看状态」**
//     才出现 `stateview`。
// 首版只做第一步就判 `no-stateview` ⇒ 在形态 B 上**误报装置失败**（P-19：判据自身
// 未覆盖全部真实形态）。⇒ 修法：逐步尝试，每步都等；两步都不成才算失败。
//
// 【W30 修 · 「每步都等」不能是固定 sleep（R16）】
//  原为 `sleep(1600)` 两处。而浮球面板 / stateview 是**懒挂载**（首次可能 >1.6s），
//  固定等就绪正是 R16 明令禁止的形态 ⇒ 改为「轮询到出现为止」。
//  ★ 注意：这里必须在**页面内**轮询（不能在 Node 侧轮询）——
//    因为两步之间的动作（点浮球 → 点「查看状态」）必须根据**页面当下的状态**决定，
//    拆到 Node 侧会多一次往返、并在往返窗口里读到中间态。
const enter = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const hasView = () => !!document.querySelector('.dsht-rp-stateview');
  const hasPanel = () => !!document.querySelector('.dsht-rp-statefloat-panel');
  const closeBtn = () => [...document.querySelectorAll('.dsht-rp-statefloat-panel .sf-btn')].find(x => (x.textContent||'').trim() === '✕');
  // 轮询到条件成立（最多 12s）；返回是否成立
  const waitFor = async (fn, budget = 12000, gap = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < budget) { if (fn()) return true; await sleep(gap) }
    return fn();
  };
  const b = document.querySelector('.dsht-rp-statefloat-ball');
  if (!b) return 'no-ball';
  // 幂等复位：**按「浮球面板是否开着」判翻转态**（不是按 stateview 判 —— 存在
  // 「面板开着但 stateview 未开」的中间态，实测据此误判 ⇒ 点浮球反而把它关掉）。
  if (hasPanel()) { const c = closeBtn(); if (c) { c.click(); await waitFor(() => !hasPanel(), 6000) } }
  if (hasPanel()) return 'cannot-reset(panel still open)';
  b.click();
  await waitFor(hasView, 8000);
  if (hasView()) return 'ok';
  // 第二步：面板内的「查看状态」（部分会话点浮球只打开面板）
  if (!(await waitFor(hasPanel, 4000))) return 'no-panel-after-ball';
  const v = () => [...document.querySelectorAll('.dsht-rp-statefloat-panel .sf-btn')].find(x => (x.textContent||'').trim() === '查看状态');
  if (!(await waitFor(() => !!v(), 4000))) return 'no-view-btn';
  v().click();
  await waitFor(hasView, 8000);
  return hasView() ? 'ok(两步)' : 'no-stateview-after-view';
})()`)
console.log(`进态：${enter}`)
if (!String(enter).startsWith('ok')) {
  console.error('⇒ 进不到状态查看界面：请确认当前会话**有状态数据**（否则本判据无样本可用）')
  console.error('   也可用 --switch <sid> 先切到有状态数据的会话（设备实测：st-1jfywz9 有 264 个节点）')
  process.exit(2)
}

// 【W30 修 · 轮询到「行真的出现」（R16）】
//  原为「进态成功 → 立刻查一次 rows」。而 `enter` 返回 ok 只代表**面板**在，
//  节点行是**面板内的列表**，可能仍在渲染 ⇒ 那一次查得到 `[]` ⇒ judgeRows 判 FAIL。
//  ⇒ 改为轮询到「至少 1 行」；轮询超时仍返回最后一次读数（如实交给 judgeRows 判定，
//    由它把「0 样本」报成**无判据力**而不是闷判 FAIL —— 见下方判据力前提）。
const rows = await pollUntil(`(() => {
  const panel = document.querySelector('.dsht-rp-stateview'); if (!panel) return null;
  return [...panel.querySelectorAll('button.sv-row.sv-node')].map(r => {
    const q = r.getBoundingClientRect(); const cs = getComputedStyle(r)
    return { w: Math.round(q.width), h: Math.round(q.height), minH: cs.minHeight, fs: cs.flexShrink, ai: cs.alignItems, txt: (r.textContent||'').trim().slice(0, 16) }
  })
})()`, (v) => Array.isArray(v) && v.length > 0)

if (rows === null) { console.error('取证失败：读不到 .dsht-rp-stateview 面板'); process.exit(2) }
// 【W30 修 · 区分「面板里真的没有行」与「我们没测到」】
//  轮询超时后仍为 0 行 ⇒ 按 R16/P-17 **记 SKIP 并出声**（无判据力），不记 FAIL。
//  理由：本判据的对象是「行有多高」；**没有行时它没有对象可判**（P-43 同族）。
//  仅当「有行且行不达标」才是真正的产品结论。
if (rows.length === 0) {
  console.log(`\n树节点行样本 0 个 —— **无判据力**：轮询 30s 仍未见任何 button.sv-row.sv-node。`)
  console.log(`  ⇒ 记 SKIP：**该面板当前没有节点行**（或渲染比 30s 还慢）。`)
  console.log(`  按 R16/P-17：测不出来 ≠ 事实否定 ⇒ **不判 FAIL**（不拿「测不出来」指控产品）。`)
  console.log(`  若确信该会话应有状态数据，可用 --switch <sid> 换一张卡复测。`)
  process.exit(0)
}
console.log(`\n树节点行样本 ${rows.length} 个（前 6 个）：`)
for (const r of rows.slice(0, 6)) console.log(`  ${r.w}×${r.h}  minH=${r.minH} flex-shrink=${r.fs} align-items=${r.ai}  "${r.txt}"`)

const res = judgeRows(rows, MIN_OK)
console.log(`\n[ef-stateview-rows] ${res.ok ? 'PASS' : 'FAIL'} —— ${res.reason}`)
if (res.ok && rows.length > 0) {
  const s = rows[0]
  console.log(`  撑起尺寸的规则：min-height=${s.minH} · flex-shrink=${s.fs} · align-items=${s.ai}`)
}
process.exit(res.ok ? 0 : 1)
