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
 * 前置：adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 * 用法：node ui-accept.mjs [--port 9333]
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'

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

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? '').slice(0, 400) }
  let v = r.result?.value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { /* keep */ } }
  return v
}

const out = await ev(`(() => {
  const res = {};
  res.title = document.title;
  res.totalEls = document.querySelectorAll('*').length;

  // ① 错误文本：找红色/告警样式的长文本
  const all = [...document.querySelectorAll('div,span,p,h1,h2,h3,pre')];
  const errish = all
    .map(e => (e.textContent || '').trim())
    .filter(t => /Failed to load|corrupt|invalid |打不开|错误/.test(t) && t.length < 400);
  res.openError = errish.length ? errish.slice(0, 3) : null;

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

  return JSON.stringify(res);
})()`)

console.log(JSON.stringify(out, null, 2))
const ok = !out.__err && (!out.openError) && out.composer && out.totalEls > 1000
console.log(ok ? '\n[ui-accept] ✅ 会话可打开且正文渲染' : '\n[ui-accept] ❌ 未达验收线')
process.exit(ok ? 0 : 1)
