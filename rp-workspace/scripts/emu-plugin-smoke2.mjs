#!/usr/bin/env node
// emu-plugin-smoke2.mjs — better-stats / turn-index 功能冒烟
import { setTimeout as sleep } from 'node:timers/promises'
import { makeEv } from './cdp-eval.mjs'
const ev = makeEv({ port: 9333 })

// 1. better-stats：composer dock 的 stats strip 内容
const stats = await ev(`(() => {
  const els = [...document.querySelectorAll('[class*="better-stats"]')]
  const texts = els.map(e => String(e.innerText ?? '').trim()).filter(t => t.length > 0)
  return JSON.stringify({ count: els.length, texts: texts.slice(0, 6) })
})()`)
console.log('better-stats strip：', stats)

// 2. turn-index：当前 RP 会话（Love Live，多轮）的 items
const ti = await ev(`(() => {
  const root = document.querySelector('.dsh_ti_root')
  const items = document.querySelectorAll('.dsh_ti_item')
  return JSON.stringify({
    rootExists: !!root,
    collapsed: root?.getAttribute('data-collapsed'),
    itemCount: items.length,
    headText: root ? root.innerText.slice(0, 100) : null,
  })
})()`)
console.log('turn-index（RP 会话）：', ti)
process.exit(0)
