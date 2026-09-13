#!/usr/bin/env node
/**
 * t78-redos-probe.mjs — T-78 世界书关键词正则防护 · **实机验收**（零副作用）
 * ============================================================================
 * 为什么要在设备上再验一次（单测已经绿了）：
 *   单测跑在 node（PC）上，用的是 vitest 的模块解析。设备上是 **libnode.so + esbuild
 *   打包产物**（`dsht-rp-plugin/lib/index.js`），两处**不是同一条代码路径**：
 *     · 产物可能是**陈旧构建**（本轮就抓到了 —— 见下方「本轮实测发现」）；
 *     · esbuild 的 tree-shaking / 常量折叠可能与源码语义不同。
 *   ⇒ 「单测绿」不能推出「设备上防护生效」。本探针问的是后者。
 *
 * 【零副作用】本探针**只读**调用 `window.DSHT.triggerWorldInfo`（纯函数：给定 entries +
 * 文本返回激活结果），不写会话、不落盘、不发网络。引擎在导入中心 WebView 里经
 * `window.DSHT` 暴露（`import/browser-entry.ts` 的 browser 面产物 = `assets/app.js`）。
 *
 * 【判据（6 条）】
 *   1. 前提：`window.DSHT.triggerWorldInfo` 存在（缺 = 前提不满足，不是缺陷）
 *   2. 正常关键词仍命中（改防护不能改功能）
 *   3. **反控（核心）**：恶意正则 `(a+)+$` + 长输入 ⇒ **必须快速返回**
 *      —— 同时给出「防护停用时的预期耗时」作对照（在探针内用原生 RegExp 实测同一输入）
 *   4. 恶意条目被拒后，`degradations` 里有**可定位**记录（entryId + reason）
 *   5. 同轮其它合法条目**不受牵连**（局部降级，不整体瘫痪）
 *   6. 负控：正常关键词不产生任何 degradation（不误报噪声）
 *
 * 用法：
 *   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   node rp-workspace/scripts/device-probes/t78-redos-probe.mjs
 */
import process from 'node:process'

const PORT = process.env.CDP_PORT || '9333'
const getJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()

class Cdp {
  constructor (ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  send (method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }))
  }
}

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`)
}

/** 恶意输入：指数回溯经典形态。长度调到「防护失效时可观测但不至于挂太久」。 */
const EVIL_KEY = '/(a+)+$/'
const EVIL_TEXT = 'a'.repeat(28) + 'b'   // 2^28 级回溯：原生 RegExp 会明显卡住

/**
 * 在页面里用 `window.DSHT.importLoreBook` 把 ST 原始形状的条目**过一遍导入器**
 * —— 而不是手搓 LoreEntry 对象。
 *
 * 为什么必须这样：`LoreEntry` 有 ~20 个必填字段（`secondaryKeys` / `selectiveLogic` /
 * `insertionOrder` / `sticky` …）。手搓极易漏字段 ⇒ 探针自己抛 `Cannot read properties of
 * undefined`，把**探针的错**误报成**产品的错**（本轮首次跑就是这么失败的）。
 * 走导入器 = 用产品自己的构造路径，字段完整性由它保证，且更贴近真实数据形态。
 */
const MKEVAL = `
  const mk = (raw) => window.DSHT.importLoreBook('probe', { entries: raw }).entries;
`

async function main () {
  const targets = await getJson('/json')
  const pages = targets.filter(t => t.type === 'page')
  if (pages.length === 0) { console.error('没有 page target'); process.exit(2) }

  let host = null
  for (const page of pages) {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const cdp = new Cdp(ws)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const w = cdp.waiting.get(msg.id)
        if (w) { cdp.waiting.delete(msg.id); msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result) }
      }
    }
    await cdp.send('Runtime.enable')
    const r = await cdp.send('Runtime.evaluate', {
      expression: `typeof window.DSHT === 'object' && typeof window.DSHT.triggerWorldInfo === 'function'`,
      returnByValue: true,
    }).catch(() => null)
    if (r?.result?.value === true) { host = { page, cdp }; break }
    ws.close()
  }

  if (!host) {
    console.error('[t78] 前提不满足：没有找到暴露 window.DSHT.triggerWorldInfo 的页面')
    console.error('（需打开导入中心 / RP 相关页面；这是前提缺失，不是缺陷）')
    process.exit(2)
  }
  console.log(`[t78] 已连上宿主页：${host.page.url?.slice(0, 80) ?? '(no url)'}`)

  const evalIn = async (expr, awaitPromise = false) => {
    const r = await host.cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result?.value
  }

  // ---- 判据 1：前提 ----
  const apiOk = await evalIn(`typeof window.DSHT.triggerWorldInfo === 'function'`)
  check(apiOk === true, '判据1 window.DSHT.triggerWorldInfo 可用', String(apiOk))
  if (!apiOk) process.exit(2)

  // ---- 判据 2：正常关键词仍命中（功能未改） ----
  // 注：importLoreBook 产出的 id 是 `lore-probe-<i>`（产品自己的命名），故按 comment 判定。
  const normal = JSON.parse(await evalIn(`(() => {
    ${MKEVAL}
    const entries = mk([
      { comment: 'ok1', key: ['龙族'], content: 'C1' },
    ]);
    const r = window.DSHT.triggerWorldInfo(entries, ['他在谈论龙族的事情'], {});
    return JSON.stringify({ n: r.activated.length,
                            comments: r.activated.map(a => a.entry.comment),
                            deg: (r.degradations || []).length });
  })()`))
  check(normal.n === 1 && normal.comments.includes('ok1'), '判据2 正常关键词仍命中（防护没改功能）', JSON.stringify(normal))
  check(normal.deg === 0, '判据6 负控：正常关键词零 degradation（不误报噪声）', `deg=${normal.deg}`)

  // ---- 判据 3 反控基线：原生 RegExp 跑同一输入有多慢（在页面里测，同一台设备） ----
  // 用较小长度算，避免探针自己把页面卡死过久；只用于**给出量级对照**。
  const baseline = JSON.parse(await evalIn(`(() => {
    const mk = (n) => 'a'.repeat(n) + 'b';
    const out = [];
    for (const n of [18, 22, 26]) {
      const re = new RegExp('(a+)+$');
      const t0 = performance.now();
      try { re.test(mk(n)); } catch (e) {}
      out.push({ n, ms: Math.round(performance.now() - t0) });
    }
    return JSON.stringify(out);
  })()`))
  console.log(`[t78] 原生 RegExp 对照（防护失效时的预期形态）：${JSON.stringify(baseline)}`)

  // ---- 判据 3：恶意正则必须被快速挡下 ----
  const evil = JSON.parse(await evalIn(`(() => {
    ${MKEVAL}
    const entries = mk([
      { comment: 'evil', key: [${JSON.stringify(EVIL_KEY)}], content: 'E' },
    ]);
    const text = ${JSON.stringify(EVIL_TEXT)};
    const t0 = performance.now();
    const r = window.DSHT.triggerWorldInfo(entries, [text], {});
    const ms = performance.now() - t0;
    return JSON.stringify({ ms: Math.round(ms), n: r.activated.length,
                            deg: r.degradations || [] });
  })()`))
  // 阈值：防护生效应 < 500ms（含 JIT 预热）；失效形态是秒级~分钟级
  check(evil.ms < 500, `判据3 恶意正则 (a+)+$ 被快速挡下（实测 ${evil.ms}ms）`,
    `对照：原生同输入在 n=26 时 ${baseline.find(b => b.n === 26)?.ms ?? '?'}ms`)

  // ---- 判据 4：降级可定位 ----
  // 恶意条目是 mk() 的第 0 个 ⇒ id = 'lore-probe-0'（产品自己的命名规则）
  const degs = Array.isArray(evil.deg) ? evil.deg : []
  const hit = degs.find(d => d.entryId === 'lore-probe-0')
  const reasonOk = hit && ['nested-quantifier', 'alternation-ambiguity'].includes(hit.reason)
  check(!!hit, '判据4a 恶意条目产生 degradation（不静默）', JSON.stringify(degs.slice(0, 2)))
  check(reasonOk, '判据4b degradation 可定位：entryId=lore-probe-0 + 原因明确',
    hit ? `reason=${hit.reason}` : '(无)')

  // ---- 判据 5：不牵连同轮其它合法条目 ----
  const mixed = JSON.parse(await evalIn(`(() => {
    ${MKEVAL}
    const entries = mk([
      { comment: 'good', key: ['龙族'], content: 'G' },
      { comment: 'evil', key: [${JSON.stringify(EVIL_KEY)}], content: 'E' },
    ]);
    const t0 = performance.now();
    const r = window.DSHT.triggerWorldInfo(entries, ['龙族' , ${JSON.stringify(EVIL_TEXT)}], {});
    return JSON.stringify({ ms: Math.round(performance.now() - t0),
                            comments: r.activated.map(a => a.entry.comment),
                            degIds: (r.degradations || []).map(d => d.entryId) });
  })()`))
  check(mixed.comments.includes('good'), '判据5a 同轮合法条目仍被激活（局部降级，不整体瘫痪）', JSON.stringify(mixed.comments))
  check(!mixed.comments.includes('evil'), '判据5b 恶意条目本轮未激活（被拒）', JSON.stringify(mixed.comments))
  check(mixed.ms < 500, `判据5c 混合场景总耗时仍受控（${mixed.ms}ms）`)

  const pass = results.filter(r => r.ok).length
  console.log(`\n[t78] ${pass}/${results.length} PASS`)
  host.cdp.ws.close?.()
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('[t78] 探针异常：', e.message); process.exit(3) })
