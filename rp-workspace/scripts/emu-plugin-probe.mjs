#!/usr/bin/env node
// emu-plugin-probe.mjs — W-C 社区插件激活探针（只读）：DOM 特征 + settings 命名空间 + 路由
import { makeEv } from './cdp-eval.mjs'
const ev = makeEv({ port: 9333 })

const dom = await ev(`(() => {
  const q = (sel) => document.querySelectorAll(sel).length
  return JSON.stringify({
    turnIndexRoot: q('.dsh_ti_root'),
    turnIndexItems: q('.dsh_ti_item'),
    pinButtons: q('[class*="session-pin"], [data-session-pin], [aria-label*="pin" i]'),
    betterStats: q('[class*="better-stats"], [data-better-stats]'),
  })
})()`)
console.log('DOM 特征：', dom)

// settings 命名空间（session-pin host 半注册 'session-pin'；better-stats inject settings 可写）
const probe = async (path) => ev(`fetch('${path}', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' }).then(r => r.status).catch(e => 'ERR ' + e.message)`)
console.log('/session-pin/ 系路由（猜）：', await probe('/session-pin/api'))
console.log('/better-stats/ 系路由（猜）：', await probe('/better-stats/api'))

// 插件设置页可见性（官方设置 → 插件列表应出现三个新插件）
const plugList = await ev(`(() => {
  const text = document.body.innerText
  return JSON.stringify({
    turnIndexMentioned: text.includes('turn-index') || text.includes('轮次索引') || text.includes('对话轮次'),
    sessionPinMentioned: text.includes('session-pin') || text.includes('置顶'),
    betterStatsMentioned: text.includes('better-stats') || text.includes('统计'),
  })
})()`)
console.log('页面文本提及：', plugList)
process.exit(0)
