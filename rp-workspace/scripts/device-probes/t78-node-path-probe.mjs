#!/usr/bin/env node
/**
 * t78-node-path-probe.mjs — T-78 世界书关键词正则防护 · **node 侧生产路径**实机验收
 * ============================================================================
 * 与另两个 T-78 探针的分工（三者互补，不可互相替代）：
 *   · `t78-redos-probe.mjs`     —— 浏览器侧（导入中心 `window.DSHT.triggerWorldInfo`），
 *                                  **直接调纯函数**，验证防护本身。
 *   · 本脚本                     —— **node 侧生产路径**：设备上真实跑一轮生成，
 *                                  世界书从 `lore.json` 加载 → pre-step 组装的
 *                                  `dsht-rp/wi-scan` waterfall → `triggerWorldInfo`
 *                                  → 降级记进 `traceRuntime.keywordRegexDegradations`
 *                                  → 由 `/dsht-rp/trace` 端点读出。
 *   · `reverse-control.mjs`     —— 反控（停用防护 ⇒ 期望转红）。
 *
 * 【为什么必须单独验 node 侧】浏览器侧与 node 侧是**两份独立产物**
 *   （`assets/app.js` vs `lib/index.js`），各有各的陈旧风险（T-85 就是浏览器侧那份旧的）。
 *   且 node 侧的接线（`index.ts:4451` 的 waterfall + `:4464` 的 trace 记录）在浏览器侧
 *   根本不存在 —— 浏览器探针全绿**推不出** node 侧也接了线。
 *
 * 【可观测面】node 侧降级**只进内存 trace**（不落盘）⇒ 权威读法是
 *   `POST /dsht-rp/trace {sessionId}` ⇒ `trace.keywordRegexDegradations`。
 *   注意 trace 在 **pre-step 组装时**就写入（早于 LLM 生成），所以读得到 ≠ 生成完成。
 *
 * 【安全性】只碰自建的**一次性**资源：
 *   · 工作区 `rp-hb75t78n` / 世界书 `skills/hb75-t78n-probe/`（`hb75` 前缀 = 探针产物）
 *   · 不读不写任何用户工作区；结束时默认自动清理（`--keep` 可保留）
 *
 * 【判据（8 条）】
 *   1. 前提：探针工作区 + 世界书 + 会话创建成功
 *   2. trace 可读（`/dsht-rp/trace` 不再 404 ⇒ pre-step 真的跑过）
 *   3. **核心**：trace 里出现该恶意条目的降级记录（entryId + reason=nested-quantifier）
 *   4. 恶意条目**未被激活**（被防护拦下 ⇒ 不参与匹配）
 *   5. 同轮合法条目**被激活**（局部降级，不整体瘫痪）
 *   6. 降级记录只针对探针恶意条目（不误伤合法条目）
 *   7. 组装耗时受控（防护生效应在秒级内；真卡死是十秒级，见 T-85 的 26739ms）
 *   8. 负控：合法条目本身没有任何降级记录
 *
 * 用法：
 *   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   node rp-workspace/scripts/device-probes/t78-node-path-probe.mjs [--keep]
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const PORT = process.env.CDP_PORT || '9333'
const KEEP = process.argv.includes('--keep')
// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const ADB = process.env.DSHT_ADB ?? process.env.ADB ?? '<path-to-adb>'
const PKG = 'com.dshtavern.app'
const HOME_REL = 'files/.dsh'

const PROBE_SLUG = 'rp-hb75t78n'
const PROBE_BOOK_DIR = 'hb75-t78n-probe'
/** 世界书路径（相对 $DSH_HOME）—— 与 `loadBook` 的 `join(dshHome, lorePath)` 对齐 */
const LORE_REL = `skills/${PROBE_BOOK_DIR}/references/lore.json`

/** 恶意关键词：指数回溯经典形态（静态识别必须拒它） */
const EVIL_KEY = '/(a+)+$/'
/**
 * 触发文本：`(a+)+$` 在「长 a 串 + 非 a 结尾」上回溯爆炸。
 * 长度 29 ⇒ 2^29 ≈ 5.4 亿步回溯：
 *   · **防护生效**时该条目被静态拒绝、正则根本不编译 ⇒ 耗时 ≈ 1.5s（与长度无关）；
 *   · **防护失效**时真跑回溯 ⇒ 实测二十秒级（T-85 浏览器侧同款形态 26739ms）。
 * 取 29（而非更贴边的 28，≈11s）是为了让判据 7 的 10s 阈值有足够余量、不被抖动吞掉。
 */
const EVIL_TEXT = 'a'.repeat(29) + 'b'
/** 合法关键词：同轮必须仍能命中（证明降级是局部的） */
const GOOD_KEY = 'hb75trigger'
const PROMPT_TEXT = `${GOOD_KEY} ${EVIL_TEXT}`

const EVIL_ID = 'hb75-evil'
const GOOD_ID = 'hb75-good'

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`)
}
const info = (m) => console.log(`  · ${m}`)

const sh = (c) => {
  try { return execFileSync(ADB, ['shell', `run-as ${PKG} sh -c ${JSON.stringify(c)}`], { encoding: 'utf8', maxBuffer: 256e6 }) } catch (e) { return (e.stdout ?? '') + (e.stderr ?? '') }
}
const getJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()

class Cdp {
  constructor (ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  send (method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }))
  }
}

/**
 * 写设备私有目录下的文件（base64 中转，规避 shell 转义）。
 *
 * ⚠️ 清理 `/data/local/tmp` 的临时文件必须用 **adb shell 自己**（shell 用户）删，
 * 不能放进 `run-as` 那条命令里 —— 临时文件归 shell 用户、`run-as` 是 app 用户，
 * `rm` 必然 Permission denied；而 `&&` 串联会因此吞掉后面的 `echo OK`，
 * 把「写入成功」误报成「写入失败」（首轮实测就是这样，属探针缺陷）。
 */
function devWrite (relToHome, text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const tmp = `/data/local/tmp/hb75-${Date.now()}-${Math.random().toString(36).slice(2)}.b64`
  execFileSync(ADB, ['shell', `echo ${b64} > ${tmp}`], { encoding: 'utf8', maxBuffer: 64e6 })
  const r = sh(`base64 -d ${tmp} > ${HOME_REL}/${relToHome} && echo OK`)
  execFileSync(ADB, ['shell', `rm -f ${tmp}`], { encoding: 'utf8' })
  return r.includes('OK')
}

/** 探针世界书（ST 原样形态；`loadBook` 只规范化最小集，其余字段原样透传） */
function probeLore () {
  return JSON.stringify({
    name: 'HB75 T-78 node 探针书',
    entries: [
      {
        id: EVIL_ID,
        comment: EVIL_ID,
        content: 'HB75-EVIL-CONTENT',
        keys: [EVIL_KEY],
        secondaryKeys: [],
        constant: false,
        selective: true,
        position: 0,
        depth: 4,
        insertionOrder: 100,
        scanDepth: null,
        matchWholeWords: null,
        enabled: true,
        excludeRecursion: true,
        preventRecursion: true,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        group: '',
        groupOverride: false,
      },
      {
        id: GOOD_ID,
        comment: GOOD_ID,
        content: 'HB75-GOOD-CONTENT',
        keys: [GOOD_KEY],
        secondaryKeys: [],
        constant: false,
        selective: true,
        position: 0,
        depth: 4,
        insertionOrder: 99,
        scanDepth: null,
        matchWholeWords: null,
        enabled: true,
        excludeRecursion: true,
        preventRecursion: true,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        group: '',
        groupOverride: false,
      },
    ],
  }, null, 1)
}

async function main () {
  // ---------- CDP 连接 ----------
  const targets = await getJson('/json')
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.error('没有 page target（先 adb forward）'); process.exit(2) }
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
  const evalIn = async (expr, awaitPromise = true) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result?.value
  }
  const url = await evalIn('location.href', false)
  console.log(`[t78-node] 页面：${url}`)
  if (!String(url).startsWith('http://127.0.0.1:3080')) {
    console.error('前提不满足：需要 DSH 主 UI 页面（先在设备打开 App）')
    process.exit(2)
  }

  // ---------- 准备自建资源 ----------
  info(`写探针世界书 ${LORE_REL}`)
  sh(`mkdir -p ${HOME_REL}/skills/${PROBE_BOOK_DIR}/references ${HOME_REL}/rp/${PROBE_SLUG}`)
  const loreOk = devWrite(LORE_REL, probeLore())
  const rpJson = JSON.stringify({
    schemaVersion: 1,
    characterName: 'HB75 T-78 node 探针角色',
    books: [{ name: 'HB75 T-78 node 探针书', lorePath: LORE_REL }],
    trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6000 },
    macros: { char: '探针角色', user: '探针用户' },
    firstMes: '',
    promptPersona: '',
    regex: [],
  }, null, 1)
  const rpOk = devWrite(`rp/${PROBE_SLUG}/rp.json`, rpJson)
  info(`世界书写入=${loreOk} rp.json 写入=${rpOk}`)

  const restore = () => {
    if (KEEP) { info(`--keep：保留探针资源（工作区 ${PROBE_SLUG} / 世界书 ${PROBE_BOOK_DIR}）`) ; return }
    sh(`rm -rf ${HOME_REL}/rp/${PROBE_SLUG} ${HOME_REL}/skills/${PROBE_BOOK_DIR}`)
    info('已清理探针资源')
  }

  try {
    // ---------- 判据 1：建会话 ----------
    const created = await evalIn(`(async () => {
      const rpc = async (method, payload) => {
        const wire = method.replace(/\\./g, '/')
        const r = await fetch('/api/' + wire, { method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ type:'client-request', rpcId:'hb75n-'+Date.now()+Math.random().toString(36).slice(2), method: wire, payload:{ args: payload } }) })
        const e = await r.json()
        if (!e.result || e.result.ok === false) throw new Error(method + ': ' + JSON.stringify((e.result && e.result.error) || e).slice(0,220))
        return e.result.value
      }
      const rp = async (path, payload) => {
        const r = await fetch('/dsht-rp/' + path, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) })
        return await r.json()
      }
      const home = await rp('rp/home', {})
      const cwd = home.dshHome + '/rp/${PROBE_SLUG}'
      let lastErr = null
      for (let i = 0; i < 12; i++) {
        try { const v = await rpc('session.create', { request: { cwd } }); return JSON.stringify({ ok:true, sid: v.sessionId, cwd }) }
        catch (e) { lastErr = String(e && e.message || e); await new Promise(r=>setTimeout(r,2500)) }
      }
      return JSON.stringify({ ok:false, err:lastErr, cwd })
    })()`)
    const c = JSON.parse(created)
    check(c.ok === true, '判据1 探针会话创建成功（工作区 + 世界书已就位）', JSON.stringify(c).slice(0, 200))
    if (!c.ok) { restore(); process.exit(2) }
    const sid = c.sid
    info(`sessionId=${sid}`)

    // ---------- 驱动一轮生成 ----------
    const t0 = Date.now()
    const prompted = await evalIn(`(async () => {
      const rpc = async (method, payload) => {
        const wire = method.replace(/\\./g, '/')
        const r = await fetch('/api/' + wire, { method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ type:'client-request', rpcId:'hb75np-'+Date.now()+Math.random().toString(36).slice(2), method: wire, payload:{ args: payload } }) })
        const e = await r.json()
        if (!e.result || e.result.ok === false) throw new Error(method + ': ' + JSON.stringify((e.result && e.result.error) || e).slice(0,220))
        return e.result.value
      }
      const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
      let lastErr = null
      for (let i = 0; i < 6; i++) {
        try { await rpc('session.prompt', { request: { requestId: uuid(), sessionId: ${JSON.stringify(sid)}, mode: 'queue', content: [{ type: 'text', text: ${JSON.stringify(PROMPT_TEXT)} }] } }); return JSON.stringify({ ok:true }) }
        catch (e) { lastErr = String(e && e.message || e); await new Promise(r=>setTimeout(r,2500)) }
      }
      return JSON.stringify({ ok:false, err:lastErr })
    })()`)
    check(JSON.parse(prompted).ok === true, '判据1b prompt 已入队', prompted.slice(0, 160))

    // ---------- 轮询 trace（pre-step 组装时即写入，早于 LLM 生成）----------
    // 耗时在这里度量：若防护失效，worldbook 扫描会真卡 ⇒ 该耗时暴涨（T-85 实测 26739ms）。
    let trace = null
    let assembleMs = -1
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const raw = await evalIn(`(async () => {
        const r = await fetch('/dsht-rp/trace', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: ${JSON.stringify(sid)} }) })
        return await r.text()
      })()`)
      let d = null
      try { d = JSON.parse(raw) } catch { continue }
      if (d && d.trace) { trace = d.trace; assembleMs = Date.now() - t0; break }
    }

    check(trace !== null, '判据2 `/dsht-rp/trace` 可读 ⇒ node 侧 pre-step 真的跑过（世界书扫描已接线）',
      trace !== null ? `组装耗时 ≈ ${assembleMs}ms` : '超时未拿到 trace')
    if (trace === null) { restore(); ws.close(); process.exit(1) }

    const degs = Array.isArray(trace.keywordRegexDegradations) ? trace.keywordRegexDegradations : []
    const acts = Array.isArray(trace.activatedEntries) ? trace.activatedEntries : []
    info(`degradations=${JSON.stringify(degs).slice(0, 300)}`)
    info(`activatedEntries=${JSON.stringify(acts.map(a => a.comment)).slice(0, 200)}`)

    // ---------- 判据 3：核心 —— 恶意条目产生可定位降级 ----------
    const evilDeg = degs.find(d => d.entryId === EVIL_ID)
    check(!!evilDeg, '判据3a 恶意正则条目产生降级记录（node 侧不静默）', JSON.stringify(degs.slice(0, 2)))
    check(!!evilDeg && evilDeg.reason === 'nested-quantifier',
      '判据3b 降级可定位：entryId=hb75-evil + reason=nested-quantifier',
      evilDeg ? `reason=${evilDeg.reason} detail=${String(evilDeg.detail).slice(0, 80)}` : '(无)')

    // ---------- 判据 4/5：恶意被拦、合法仍中 ----------
    check(!acts.some(a => a.comment === EVIL_ID), '判据4 恶意条目未被激活（被防护拦下 ⇒ 未参与匹配）',
      JSON.stringify(acts.map(a => a.comment)))
    check(acts.some(a => a.comment === GOOD_ID), '判据5 同轮合法条目仍被激活（局部降级，不整体瘫痪）',
      JSON.stringify(acts.map(a => a.comment)))

    // ---------- 判据 6/8：不误伤 ----------
    const otherDegs = degs.filter(d => d.entryId !== EVIL_ID && d.entryId !== GOOD_ID)
    check(!degs.some(d => d.entryId === GOOD_ID), '判据8 负控：合法条目零降级（不误报）',
      `合法条目降级数=${degs.filter(d => d.entryId === GOOD_ID).length}`)
    check(otherDegs.length === 0, '判据6 降级不误伤其它条目', `其它条目降级数=${otherDegs.length}`)

    // ---------- 判据 7：耗时受控 ----------
    check(assembleMs >= 0 && assembleMs < 10000,
      `判据7 组装耗时受控（实测 ${assembleMs}ms；防护失效形态是十秒级，见 T-85 的 26739ms）`)
  } finally {
    try { restore() } catch (e) { console.error('[t78-node] 清理异常：', e.message) }
    ws.close()
  }

  const pass = results.filter(r => r.ok).length
  console.log(`\n[t78-node-path] ${pass}/${results.length} PASS`)
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('[t78-node-path] 探针异常：', e.message); process.exit(3) })
