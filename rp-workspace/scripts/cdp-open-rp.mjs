#!/usr/bin/env node
// cdp-open-rp.mjs — 打开 DSHT 的 RP 界面并进入指定角色会话
// 用法: node cdp-open-rp.mjs [端口=9333] [卡名关键字]
//
// 背景（心跳 32）：重启应用后停在 workspace 选择页，RP 会话未打开，
// [contenteditable=true] 不存在 → dsht-send 定位失败。本脚本负责：
//   ① 点「打开角色扮演（RP）」按钮 → ② 等角色列表 → ③ 点卡片进会话
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = process.argv[2] || '9333'
const KEY = process.argv[3] || 'wuwa'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find(x => x.type === 'page')
if (!t) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id
  pend.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method: m, params: p }))
})
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id)
    pend.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
ws.onerror = e => { console.error('WS error', e.message || e); process.exit(1) }
await new Promise(r => { ws.onopen = r })
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails).slice(0, 300)
  return r.result.value
}

// 已有编辑器就直接返回
const hasEd = await ev('!!document.querySelector(\'[contenteditable="true"]\')')
if (hasEd) { console.log('已存在编辑器，无需打开'); ws.close(); process.exit(0) }

// ① 点 RP 按钮
const clicked = await ev(`(() => {
  const b = document.querySelector('button[aria-label="打开角色扮演（RP）"]')
  if (!b) return 'no-btn'
  b.click(); return 'clicked'
})()`)
console.error('[open-rp] RP 按钮:', clicked)
await sleep(2500)

// ② 看当前 DOM 状态
const state = await ev(`JSON.stringify({
  ed: !!document.querySelector('[contenteditable="true"]'),
  overlay: !!document.querySelector('.dsht-rp-overlay'),
  candidates: [...document.querySelectorAll('[class*=candidate],[class*=card],[class*=char]')].length,
})`)
console.error('[open-rp] 状态:', state)

// ③ 若出现角色卡列表，点关键字匹配项
if (!state.includes('"ed":true')) {
  const pick = await ev(`(() => {
    const key = ${JSON.stringify(KEY)}.toLowerCase()
    const all = [...document.querySelectorAll('div,li,button,a')]
      .filter(e => e.children.length < 8 && /wuwa|solaris|示例游戏/i.test(e.textContent || ''))
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 20 && r.height < 300 })
    if (!all.length) return 'no-match'
    all.sort((a, b) => a.textContent.length - b.textContent.length)
    const el = all[0]
    el.click()
    return 'clicked:' + (el.textContent || '').trim().slice(0, 40)
  })()`)
  console.error('[open-rp] 选卡:', pick)
  await sleep(4000)
}

const final = await ev(`JSON.stringify({
  ed: !!document.querySelector('[contenteditable="true"]'),
  sendBtn: !!document.querySelector('button[aria-label="Send message"]'),
  title: document.title,
})`)
console.log('[open-rp] 最终:', final)
ws.close()
