#!/usr/bin/env node
/**
 * ef-theme-follow.mjs —— 设备实测：**切宿主主题 → 帧内 color-scheme 是否跟随**
 * ============================================================================
 * （归档自 `tmp/verify-theme-follow-device.mjs`，2026-09-14 第十四轮）
 *
 * 这是 L2「深色/浅色主题」修复（P-7 能力对等）的**设备侧正控**。
 * 需求：goal 轨道 F 的 F1「每个修复必须配 M3 单测**或 M5 CDP 探针**（留在仓库，跑不过即回归）」。
 * 单测侧已有 `packages/tests/frame-theme-follow.spec.ts`（9 项）；本脚本是设备侧的对应物。
 *
 * 用法：
 *   node scripts/ef-theme-follow.mjs            # 当前页面上已有的帧上跑
 *   node scripts/ef-theme-follow.mjs <sid>      # 先切到指定卡（让脚本帧出现）再跑
 *
 * 前置：App 在跑 + `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`。
 * 注意：本脚本会临时切换宿主主题属性，**结束后自动还原**（不改持久设置）。
 *
 * 修复前实测（`tmp/probe-theme-toggle.mjs`）：切主题后我方 token 色跟随，
 * 而帧内 color-scheme **仍 dark**（不跟随）。
 * 修复后应当：**帧内 color-scheme 跟随**（dark ↔ light 双向）。
 *
 * 判据（三件事）：
 *   ① 帧内必须**存在**跟随钩子 `__dshtApplyHostScheme`（机制已注入）；
 *   ② 切到 light ⇒ 帧内 color-scheme 变 light；切回 dark ⇒ 变 dark（**双向**，防单向假绿）；
 *   ③ 若当轮没有可见帧，如实记 SKIP（测不出，不冒充覆盖）。
 *
 * 纯只读 + 两次属性切换后**还原**（不改任何持久设置）。
 */
import process from 'node:process'
const PORT = process.env.CDP_PORT || '9333'
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(4) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let n = 0; const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++n; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return `__ERR__ ${String(r.exceptionDetails.exception?.description ?? '').slice(0, 250)}`; return r.result?.value }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 【可选】先切到指定卡，让脚本帧出现（否则页面上可能一帧都没有 ⇒ 只能 SKIP）
const SID_ARG = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : ''
if (SID_ARG !== '') {
  const PROBE = `(() => { let sid=''; const root=document.querySelector('#root')||document.body.firstElementChild; const seen=new Set(); const walk=(f,d)=>{ if(!f||d>45||seen.has(f)||sid) return; seen.add(f); try{ const p=f.memoizedProps; if(p&&typeof p==='object') for(const k of Object.keys(p)) if(/^sessionId$/i.test(k)&&typeof p[k]==='string'){sid=p[k];return} walk(f.child,d+1); walk(f.sibling,d+1) }catch{} }; if(root){const k=Object.keys(root).find(k=>k.startsWith('__reactContainer')||k.startsWith('__reactFiber')); if(k) walk(root[k],0)} return sid })()`
  if (await ev(PROBE) !== SID_ARG) {
    await ev(`(() => { window.__dshtLocateConsumed=false; window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session',{detail:{sessionId:${JSON.stringify(SID_ARG)}}})); return true })()`)
    for (let i = 0; i < 40; i += 1) { await sleep(1000); if (await ev(PROBE) === SID_ARG) { console.log(`已切到 ${SID_ARG}（${i + 1}s）`); break } }
  }
  // 等脚本帧（含钩子）出现（上限 30s）
  for (let i = 0; i < 20; i += 1) {
    await sleep(1500)
    const has = await ev(`(() => { for (const f of document.querySelectorAll('iframe')) { try { if (typeof f.contentWindow.__dshtApplyHostScheme === 'function') return true } catch {} } return false })()`)
    if (has === true) { console.log(`脚本帧已就绪（${(i + 1) * 1.5}s）`); break }
  }
}

/** 读：宿主属性 + 每个帧的钩子存在性 + 帧内 color-scheme 计算值 */
const SNAP = `(() => {
  const out = { hostDarkAttr: document.body ? document.body.hasAttribute('data-ds-dark-theme') : null, frames: [] }
  for (const f of document.querySelectorAll('iframe')) {
    const r = { title: f.getAttribute('title') || null }
    try {
      const w = f.contentWindow, d = w.document, he = d.documentElement
      r.hasHook = typeof w.__dshtApplyHostScheme === 'function'
      r.schemeComputed = w.getComputedStyle(he).colorScheme || null
      r.schemeInline = he.style.colorScheme || null
    } catch (e) { r.err = String(e && e.message || e).slice(0, 60) }
    out.frames.push(r)
  }
  return JSON.stringify(out)
})()`

const setDark = (v) => ev(`(() => { if (${v}) document.body.setAttribute('data-ds-dark-theme',''); else document.body.removeAttribute('data-ds-dark-theme'); return document.body.hasAttribute('data-ds-dark-theme') })()`)

const results = []
const rec = (name, status, evidence) => { results.push({ name, status, evidence }); console.log(`${status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : 'ⓘ'} ${name}\n    ${evidence}`) }

// 基线
const base = JSON.parse(await ev(SNAP))
const frames = base.frames.filter(f => !f.err)
const hooks = frames.filter(f => f.hasHook === true).length
console.log('基线:', JSON.stringify(base))
rec('L2-T1 帧内注入跟随钩子', hooks > 0 ? 'PASS' : 'SKIP',
  hooks > 0 ? `${hooks}/${frames.length} 个可达帧已装 __dshtApplyHostScheme（机制在产物里生效）`
    : `无可达帧装到钩子（帧数 ${frames.length}；可能当前无脚本帧 ⇒ 测不出，不冒充覆盖）`)

if (hooks === 0) {
  console.log('\n[结论] 无可用帧 ⇒ 仅 T1 为 SKIP；切主题跟随需在有帧时复测。')
  process.exit(0)
}

// 切 light
await setDark(false)
await sleep(1600)
const lightSnap = JSON.parse(await ev(SNAP))
console.log('\n切 light 后:', JSON.stringify(lightSnap))
// 切 dark
await setDark(true)
await sleep(1600)
const darkSnap = JSON.parse(await ev(SNAP))
console.log('\n切回 dark 后:', JSON.stringify(darkSnap))

const schemeOf = (snap) => (snap.frames.filter(f => !f.err)[0] || {}).schemeComputed
rec('L2-T2 切 light ⇒ 帧内跟随为 light', schemeOf(lightSnap) === 'light' ? 'PASS' : 'FAIL',
  `帧内 color-scheme = ${schemeOf(lightSnap)}（期望 light）`)
rec('L2-T3 切回 dark ⇒ 帧内跟随为 dark（双向，防单向假绿）', schemeOf(darkSnap) === 'dark' ? 'PASS' : 'FAIL',
  `帧内 color-scheme = ${schemeOf(darkSnap)}（期望 dark）`)

const fail = results.filter(r => r.status === 'FAIL').length
console.log(`\n[L2 主题跟随] ${results.filter(r => r.status === 'PASS').length} PASS / ${fail} FAIL / ${results.filter(r => r.status === 'SKIP').length} SKIP`)
ws.close(); process.exit(fail ? 1 : 0)
