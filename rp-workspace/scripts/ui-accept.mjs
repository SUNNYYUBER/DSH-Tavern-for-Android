#!/usr/bin/env node
/**
 * ui-accept.mjs — 设备侧 UI 验收探针（只读，不改状态）
 * =============================================================================
 * 判据（心跳 49 确立）：
 *   ① openError  —— 历史加载错误文本（红字）。为 null/false 才算"会话能打开"
 *   ② composer   —— 输入框是否在（受控 Lexical 容器）
 *   ③ els        —— DOM 元素总数（**相对量**：报错态 ≈ 668，正常态 ≈ 1668）
 *   ④ scrollers  —— 聊天滚动容器（class 含 scrollBody 者）的 sh/ch/kids，判断正文是否渲染
 *   ⑤ leaves     —— 文本叶子数 + 前若干片段（确认不是空白壳）
 *
 * ## 【W35 · P-47】判据 ① 必须**按归因层级分类**（否则假 FAIL）
 *
 * 原实现：`filter(t => /Failed to load|corrupt|invalid |打不开|错误/.test(t))` ⇒ 只要**任何**
 * 这类文本出现，就把 `openError` 置真 ⇒ `ok=false` ⇒ exit 1。
 * 这与 M7 的 J1 是**同一缺陷的第二处实例**（W34 已在 M7 修，此处漏网 —— P-38 同类排查）：
 *   · **数据层**（`failed to project session` / `is corrupt` / `invalid seed`）
 *       ⇒ 宿主**拒绝这份数据** ⇒ 用户**打不开** ⇒ ★ **该判 FAIL**
 *   · **传输层**（`api gateway` / `Remote stream` / `WebSocket closed`）
 *       ⇒ 与 LLM/网关的**传输载体**断开（`RemoteStreamCarrierError`，见
 *          `dsh-api-gateway/lib/types/client/stream-client.js:221`）⇒ **会自愈**
 *          ⇒ **不该判 FAIL**，只作信息项出声
 *   · **本轮对话错误**（`turn-error` 面板，如模型不支持该思考强度）
 *       ⇒ 属**单轮生成**失败，**不影响「会话能否打开」** ⇒ 也不该判 FAIL
 * 若混合，则**用传输层问题指控数据层**（P-17 错位），且**训练人忽略该 FAIL**（P-38）。
 * ⇒ 修法：把 `openError` 拆成 `errStruct` / `errTransport` / `errTurn`，
 *   **只有 `errStruct` 影响结论**；另两类只进 `notes` 出声。
 *   兜底：命中 `Failed to load` 但三类都没匹配上 ⇒ 按**最严**那类（结构）对待（fail-closed）。
 *
 * ## 【W35 · P-46 推论三】判据也必须**等就绪**（`ev()` 原为单次求值）
 * 原 `ev()` 只查一次 ⇒ 切卡/冷启瞬间采到「报错态骨架」（els≈668 而非 ≈1668）即假 FAIL。
 * ⇒ 改为**轮询到就绪**（连续两次签名一致，上限 30s），并在找不到滚容时**主动滚到底**
 *   促使楼层物化（**让判据创造它要观测的事实**，P-20）。
 *
 * 前置：adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 * 用法：node ui-accept.mjs [--port 9333] [--selftest]
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

/** 分层正则（**导出**供 selftest 做前提断言 —— P-37：前提变了必须重评本判据） */
export const ERR_RE = {
  struct: /failed to project session|is corrupt|invalid seed|invalid committed|required exact replace fields/i,
  transport: /api gateway|Remote stream|WebSocket closed/i,
  turn: /turn-error|思考强度|reasoning effort|上下文容量|context (overflow|window)/i,
  /** 兜底：命中「打不开/损坏」类措辞但三分类都没匹配 ⇒ 按**最严**那类对待（fail-closed） */
  unknownHint: /Failed to load|corrupt|invalid |打不开/i,
}

/**
 * 【纯函数】错误文本**按归因层级分类**（P-47 的机器化形态；`--selftest` 直接测它）。
 * @param texts 页面里抓到的候选错误文本数组
 * @returns {{ struct: string[], transport: string[], turn: string[], unknown: string[] }}
 */
export function classifyErrors (texts) {
  const out = { struct: [], transport: [], turn: [], unknown: [] }
  for (const t of texts) {
    const s = String(t ?? '')
    if (s.trim() === '') continue
    if (ERR_RE.struct.test(s)) out.struct.push(s)
    else if (ERR_RE.transport.test(s)) out.transport.push(s)
    else if (ERR_RE.turn.test(s)) out.turn.push(s)
    else if (ERR_RE.unknownHint.test(s)) out.unknown.push(s)
  }
  return out
}

if (argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // 正控 1：数据层错误 ⇒ 必进 struct（**这是唯一能判 FAIL 的类**）
  const c1 = classifyErrors(['Failed to load history: failed to project session "st-x": token surface: replace at seq 1457 ...'])
  t('正控1：数据层错误 ⇒ struct', c1.struct.length === 1 && c1.transport.length === 0 && c1.unknown.length === 0, `struct=${c1.struct.length}`)

  // 负控 1：传输层错误 ⇒ **不得**进 struct（W34 实测的真实形态）
  const c2 = classifyErrors(['Failed to load history: api gateway: Remote stream WebSocket closed (gateway/internal)'])
  t('负控1：传输层错误 ⇒ 只进 transport（不得进 struct）',
    c2.transport.length === 1 && c2.struct.length === 0 && c2.unknown.length === 0,
    `struct=${c2.struct.length} transport=${c2.transport.length} unknown=${c2.unknown.length}`)

  // 负控 2：本轮对话错误 ⇒ 只进 turn（不影响「会话能否打开」）
  const c3 = classifyErrors(['本轮对话超出了模型的上下文容量（context overflow）'])
  t('负控2：本轮对话错误 ⇒ 只进 turn', c3.turn.length === 1 && c3.struct.length === 0, `turn=${c3.turn.length}`)

  // 负控 3：未知的「打不开」措辞 ⇒ 按**最严**那类（unknown，与 struct 同等对待）fail-closed
  const c4 = classifyErrors(['Failed to load history: 某种我们没见过的损坏描述'])
  t('负控3：未识别的「打不开」措辞 ⇒ 进 unknown（fail-closed，与 struct 同权）',
    c4.unknown.length === 1 && c4.struct.length === 0, `unknown=${c4.unknown.length}`)

  // 杠杆（P-20）：同一句话**只改一个词**（project session → api gateway）⇒ 分类必须翻转。
  // 若判据无杠杆（恒 struct 或恒 transport），这一对不可能一正一负。
  const leverA = classifyErrors(['Failed to load history: failed to project session "x"'])
  const leverB = classifyErrors(['Failed to load history: api gateway: Remote stream WebSocket closed'])
  t('杠杆：仅替换关键词 ⇒ 分类翻转（struct ↔ transport）',
    leverA.struct.length === 1 && leverB.transport.length === 1 && leverB.struct.length === 0)

  // 零控：空输入 / 纯空白 ⇒ 全空（不误报）
  const c5 = classifyErrors(['', '   ', null, undefined])
  t('零控：空/空白输入 ⇒ 四类全空', c5.struct.length + c5.transport.length + c5.turn.length + c5.unknown.length === 0)

  // 前提断言（P-37）：正则里必须仍有分层关键词，否则本判据的前提已变
  t('前提：分层关键词仍在（改动正则须重评本判据）',
    /failed to project session/.test(String(ERR_RE.struct)) && /api gateway/.test(String(ERR_RE.transport)))

  console.log(fail === 0 ? `\n[ui-accept selftest] ${total}/${total} PASS` : `\n[ui-accept selftest] ${fail} FAIL / ${total}`)
  process.exit(fail === 0 ? 0 : 1)
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('[ui-accept] 找不到 page target'); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++seq
  pending.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method: m, params: p }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const q = pending.get(m.id)
    pending.delete(m.id)
    m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')

const ev = async (expr, t = 40000) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: t })
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? '').slice(0, 400) }
  let v = r.result?.value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { /* keep */ } }
  return v
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const SNAP = `(() => {
  const res = {};
  res.title = document.title;
  res.totalEls = document.querySelectorAll('*').length;
  // ① 错误文本：找红色/告警样式的长文本（**原样收集**，分类由 Node 侧做 —— 纯函数可单测）
  const all = [...document.querySelectorAll('div,span,p,h1,h2,h3,pre')];
  res.errTexts = all
    .map(e => (e.textContent || '').trim())
    .filter(t => /Failed to load|corrupt|invalid |打不开|错误/.test(t) && t.length < 400)
    .slice(0, 6);
  // ② 输入框（Lexical 受控 contenteditable 或 textarea）
  res.composer = !!document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
  // ③ 聊天滚动容器
  const scrollers = [...document.querySelectorAll('*')]
    .filter(e => /scrollBody|scroll-body|scrollView|ChatNode/i.test(e.className || ''))
    .map(e => ({ cls: String(e.className).slice(0, 60), sh: e.scrollHeight, ch: e.clientHeight, kids: e.children.length }))
    .filter(s => s.sh > 0);
  res.scrollers = scrollers.slice(0, 6);
  // ④ 文本叶子
  const leaves = [...document.querySelectorAll('div,span,p')]
    .filter(e => e.children.length === 0 && (e.textContent || '').trim().length > 12);
  res.leafCount = leaves.length;
  res.leaves = leaves.slice(0, 5).map(e => (e.textContent || '').trim().slice(0, 90));
  // ⑤ 【P-20】主动物化：把可滚动容器滚到底，促使最近楼层渲染（否则冷启瞬间采到骨架）
  const sc = [...document.querySelectorAll('*')].find(e => {
    const cs = getComputedStyle(e)
    return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 40
  })
  if (sc) sc.scrollTop = sc.scrollHeight
  res.acted = !!sc
  return JSON.stringify(res);
})()`

// 【P-46 推论三】**轮询到就绪**：连续两次签名一致才算稳定（原实现只查一次
// ⇒ 冷启/切卡瞬间采到「报错态骨架」（els≈668 而非 ≈1668）即假 FAIL）。
// 签名只取**不受物化进程改变**的量（els 会随渐进物化增长 ⇒ 不取；取叶子数是否达标 + 分类结果）。
const sigOf = (o) => JSON.stringify([
  (o.errTexts ?? []).length,
  (o.scrollers ?? []).length,
  (o.leafCount ?? 0) > 0,
  o.composer === true,
])
let out = null, ready = false
let last = null
const t0 = Date.now()
while (Date.now() - t0 < 30000) {
  const r = await ev(SNAP)
  if (r.__err) { await sleep(500); continue }
  const sg = sigOf(r)
  if (last !== null && sg === last) { out = r; ready = true; break }
  last = sg
  out = r
  await sleep(600)
}
if (out === null) out = await ev(SNAP)

// 分类（**只有数据层影响结论**；传输层/本轮对话错误只出声）
const cls = out.__err ? { struct: [], transport: [], turn: [], unknown: [] } : classifyErrors(out.errTexts ?? [])
const structFatal = cls.struct.length > 0 || cls.unknown.length > 0   // fail-closed：未知按最严那类
out.errStruct = structFatal ? [...cls.struct, ...cls.unknown] : null
out.errTransport = cls.transport.length ? cls.transport : null       // 信息项（会自愈）
out.errTurn = cls.turn.length ? cls.turn : null                      // 信息项（单轮生成失败）

console.log(JSON.stringify(out, null, 2))
if (!ready) console.log('[ui-accept] ⚠️ 未在 30s 内等到「两次签名一致」——读数可能未就绪（见 P-46 推论三）')
if (out.errTransport) console.log(`[ui-accept] ⓘ 网络层提示（**不计入结论**，会自愈）：${out.errTransport[0]}`)
if (out.errTurn) console.log(`[ui-accept] ⓘ 本轮对话错误（**不计入结论**，不影响会话可打开性）：${out.errTurn[0]}`)
const ok = !out.__err && (!out.errStruct) && out.composer && out.totalEls > 1000
console.log(ok ? '\n[ui-accept] ✅ 会话可打开且正文渲染' : '\n[ui-accept] ❌ 未达验收线')
process.exit(ok ? 0 : 1)
