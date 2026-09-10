#!/usr/bin/env node
/**
 * golden-tt-sampling.mjs — T-13（D-7）：采集 TT 侧**采样参数**（GENERATE_AFTER_COMBINE_PROMPTS 等）
 * ==============================================================================================
 * 背景：D-7「采样参数差异」一直只有 DSHT 侧的数（temperature/max_tokens/thinking…），
 * TT 侧对照**从未采到**（docs/DSHT-VS-TT-DIFF-2026-09-10.md:404 明记「TT 的采样参数在
 * GENERATE_AFTER_COMBINE_PROMPTS 的另一份 dump 里，需补齐对照」）。
 * 本脚本补上这一半：在 TT WebView 里挂 hook，把**最终发给模型的请求参数**完整落盘。
 *
 * 为什么不能只挂事件名：TT（TauriTavern）是 ST 内核的 Tauri 壳，采样参数不在
 * prompt 事件里，而在底层 fetch/XHR 的请求体。故**双通道取证**：
 *   ① monkey-patch window.fetch + XMLHttpRequest → 抓 chat/completions 请求体（权威）
 *   ② 挂 GENERATE_AFTER_COMBINE_PROMPTS / CHAT_COMPLETION_PROMPT_READY 事件（prompt 文本）
 *
 * 用法：
 *   node golden-tt-sampling.mjs hook            # 只挂 hook（不发送）
 *   node golden-tt-sampling.mjs run [文本]      # 挂 hook + 选卡 + 发送 + 落盘
 *   node golden-tt-sampling.mjs dump            # 只读回已抓到的参数
 *   node golden-tt-sampling.mjs clear           # 清空已抓
 * 环境变量：TT_PORT（默认 9334）
 */
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.env.TT_PORT ?? '9334'
const OUT_DIR = 'D:/DSH RolePlay/golden/tt-sampling'
const CMD = process.argv[2] ?? 'hook'
const TEXT = process.argv[3] ?? '（采样参数对照）请用一句话打个招呼。'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error(`无 page target（TT 是否在跑？端口 ${PORT}）`); process.exit(1) }
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
    const q = pending.get(m.id); pending.delete(m.id)
    m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)).slice(0, 300))
  return r.result?.value
}

// ---- hook 安装（幂等；fetch + XHR 双通道 + 事件通道）----
const HOOK = `(() => {
  if (window.__ttSamplingHooked) return 'already'
  window.__ttSamplingHooked = true
  window.__ttSamples = []
  const LLM_RE = /chat\\/completions|\\/v1\\/messages|generate|completion/i
  const push = (via, url, body) => {
    try {
      let parsed = null
      if (typeof body === 'string') { try { parsed = JSON.parse(body) } catch { /* 非 JSON */ } }
      else if (body && typeof body === 'object') parsed = body
      window.__ttSamples.push({
        via, url: String(url ?? '').slice(0, 200),
        ts: new Date().toISOString(),
        raw: typeof body === 'string' ? body.slice(0, 4000) : null,
        body: parsed,
      })
      if (window.__ttSamples.length > 40) window.__ttSamples.shift()
    } catch (e) { /* 绝不干扰主链路 */ }
  }
  // ① fetch
  const of = window.fetch
  if (typeof of === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        if (LLM_RE.test(url)) push('fetch', url, init && init.body)
      } catch (e) { /* noop */ }
      return of.apply(this, arguments)
    }
  }
  // ② XHR
  const oOpen = XMLHttpRequest.prototype.open
  const oSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__ttUrl = url } catch (e) { /* noop */ }
    return oOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (body) {
    try { if (LLM_RE.test(String(this.__ttUrl || ''))) push('xhr', this.__ttUrl, body) } catch (e) { /* noop */ }
    return oSend.apply(this, arguments)
  }
  // ③ 事件通道（prompt 文本 + 可能的参数对象）
  try {
    const T = window.__TAURITAVERN__
    const bus = T?.api?.eventSource ?? T?.eventSource ?? null
    if (bus && typeof bus.on === 'function') {
      for (const n of ['GENERATE_AFTER_COMBINE_PROMPTS', 'generate_after_combine_prompts',
                       'CHAT_COMPLETION_PROMPT_READY', 'chat_completion_prompt_ready']) {
        try { bus.on(n, (p) => push('event:' + n, n, typeof p === 'string' ? p : p)) } catch (e) { /* noop */ }
      }
    }
  } catch (e) { /* noop */ }
  return 'installed'
})()`

if (CMD === 'clear') {
  console.log('[tt-sampling] 清空:', await ev('(() => { window.__ttSamples = []; return "cleared" })()'))
  ws.close(); process.exit(0)
}

if (CMD === 'hook') {
  console.log('[tt-sampling] hook:', await ev(HOOK))
  ws.close(); process.exit(0)
}

if (CMD === 'dump') {
  const samples = await ev('JSON.stringify(window.__ttSamples ?? [])')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const f = path.join(OUT_DIR, `sampling-${Date.now()}.json`)
  fs.writeFileSync(f, samples)
  const arr = JSON.parse(samples)
  console.log(`[tt-sampling] 抓到 ${arr.length} 条 → ${f}`)
  for (const [i, s] of arr.entries()) {
    const b = s.body ?? {}
    const keys = Object.keys(b).filter(k => k !== 'messages').slice(0, 14)
    console.log(`  [${i}] via=${s.via} keys=${JSON.stringify(keys)} messages=${Array.isArray(b.messages) ? b.messages.length : '-'}`)
  }
  ws.close(); process.exit(0)
}

// ---- run：挂 hook → 选卡 → 发送 ----
console.log('[tt-sampling] ① 挂 hook:', await ev(HOOK))
console.log('[tt-sampling] ② 清空历史样本:', await ev('(() => { window.__ttSamples = []; return "ok" })()'))

const picked = await ev(`(() => {
  const cards = Array.from(document.querySelectorAll('.character_select'))
  if (cards.length === 0) return 'no-card-list（角色抽屉未开）'
  const wuwa = cards.find(e => /wuwa|示例游戏|solaris/i.test(e.textContent || ''))
  const target = wuwa ?? cards[0]
  target.click()
  return 'clicked: ' + (target.querySelector('.ch_name')?.textContent ?? target.textContent ?? '').trim().slice(0, 40)
})()`)
console.log('[tt-sampling] ③ 选卡:', picked)
await new Promise(r => setTimeout(r, 3000))

const sent = await ev(`(() => {
  const ta = document.querySelector('#send_textarea')
  if (!ta) return 'no #send_textarea'
  ta.focus()
  ta.value = ${JSON.stringify(TEXT)}
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const b = document.querySelector('#send_but')
  if (b && !b.classList.contains('displayNone')) { b.click(); return 'via button' }
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'via enter'
})()`)
console.log('[tt-sampling] ④ 发送:', sent)

console.log('[tt-sampling] ⑤ 等 30s（生成 → 抓参数）…')
await new Promise(r => setTimeout(r, 30000))

const samples = JSON.parse(await ev('JSON.stringify(window.__ttSamples ?? [])'))
fs.mkdirSync(OUT_DIR, { recursive: true })
const f = path.join(OUT_DIR, `sampling-${Date.now()}.json`)
fs.writeFileSync(f, JSON.stringify(samples, null, 1))
console.log(`\n[tt-sampling] 抓到 ${samples.length} 条 → ${f}`)
for (const [i, s] of samples.entries()) {
  const b = s.body ?? {}
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const params = {}
    for (const k of ['model', 'stream', 'max_tokens', 'max_new_tokens', 'temperature', 'top_p', 'top_k', 'top_a',
      'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'seed', 'stop', 'thinking',
      'reasoning_effort', 'logit_bias']) {
      if (b[k] !== undefined) params[k] = b[k]
    }
    console.log(`  [${i}] via=${s.via} url=${s.url}`)
    console.log(`       params=${JSON.stringify(params)}`)
    console.log(`       tools=${Array.isArray(b.tools) ? b.tools.length : '无'}  messages=${Array.isArray(b.messages) ? b.messages.length : '-'}`)
  } else {
    console.log(`  [${i}] via=${s.via} （非 JSON 体，原始 ${s.raw ? s.raw.length : 0} 字符）`)
  }
}
ws.close()
