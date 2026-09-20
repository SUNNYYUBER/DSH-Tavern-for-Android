#!/usr/bin/env node
// emu-plugin-smoke.mjs — W-C 社区插件功能冒烟（session-pin 置顶流）
import { setTimeout as sleep } from 'node:timers/promises'
import { makeEv } from './cdp-eval.mjs'
const ev = makeEv({ port: 9333 })
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`)
  if (!ok) fail++
}

// 1. pin 按钮点击前状态
const before = await ev(`(() => {
  const btns = [...document.querySelectorAll('[class*="session-pin"], [data-session-pin], [aria-label*="pin" i]')]
  return JSON.stringify(btns.map(b => ({ tag: b.tagName, cls: String(b.className ?? '').slice(0, 80), label: b.getAttribute('aria-label') })))
})()`)
console.log('pin 按钮形态：', before)

// 2. 点击第一个 pin 按钮
const clicked = await ev(`(() => {
  const b = document.querySelector('[class*="session-pin"], [data-session-pin], [aria-label*="pin" i]')
  if (!b) return 'no-btn'
  b.click()
  return 'clicked'
})()`)
console.log('点击：', clicked)
await sleep(2000)

// 3. 点击后状态（pinned 区域/行样式变化/localStorage）
const after = await ev(`(() => {
  const ls = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/pin/i.test(k)) ls.push(k + '=' + String(localStorage.getItem(k)).slice(0, 120)) }
  return JSON.stringify({
    pinnedRows: document.querySelectorAll('[class*="pinned"], [data-pinned="true"]').length,
    lsKeys: ls,
  })
})()`)
console.log('点击后：', after)
const a = JSON.parse(after)
check('session-pin 置顶流（pinned 区域或 localStorage 留痕）', a.pinnedRows > 0 || a.lsKeys.length > 0, `pinnedRows=${a.pinnedRows} ls=${a.lsKeys.length}`)

process.exit(fail ? 1 : 0)
