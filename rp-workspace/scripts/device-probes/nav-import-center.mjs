#!/usr/bin/env node
/**
 * nav-import-center.mjs — 把设备 WebView 导到导入中心页（T-78 探针的前置）
 *
 * 为什么需要：`window.DSHT.triggerWorldInfo` 只由**导入中心页面**加载的
 * `assets/app.js`（browser-entry bundle）暴露；DSH 主 UI 页面没有它。
 * 探针要问的是「设备上那份 app.js 有没有 T-78 防护」，故必须先把页面导过去。
 *
 * 用法：node rp-workspace/scripts/device-probes/nav-import-center.mjs [url]
 *   默认 url = http://127.0.0.1:3080/dsht-rp/import-center
 * 环境变量 CDP_PORT（默认 9333）。若传 `--back` 则回到 DSH 主页面。
 */
import process from 'node:process'

const PORT = process.env.CDP_PORT || '9333'
const TARGET = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : (process.argv.includes('--back') ? 'http://127.0.0.1:3080/' : 'http://127.0.0.1:3080/dsht-rp/import-center')

const getJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()

class Cdp {
  constructor (ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  send (method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }))
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main () {
  const targets = await getJson('/json')
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.error('没有 page target'); process.exit(2) }
  console.log(`[nav] 当前页：${page.url}`)

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
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  console.log(`[nav] 导航 → ${TARGET}`)
  await cdp.send('Page.navigate', { url: TARGET })

  // 等 window.DSHT 就位（bundle 是同步脚本，通常 <2s；给足 12s 容错）
  let ready = false
  for (let i = 0; i < 24; i++) {
    await sleep(500)
    const r = await cdp.send('Runtime.evaluate', {
      expression: `typeof window.DSHT === 'object' && typeof window.DSHT.triggerWorldInfo === 'function'`,
      returnByValue: true,
    }).catch(() => null)
    if (r?.result?.value === true) { ready = true; break }
  }
  const urlNow = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).catch(() => null)
  console.log(`[nav] 现址：${urlNow?.result?.value}`)
  console.log(ready ? '[nav] ✓ window.DSHT.triggerWorldInfo 已就位' : '[nav] ✗ 未等到 window.DSHT（页面可能 404 / 资产缺失）')
  ws.close()
  process.exit(ready ? 0 : 1)
}

main().catch(e => { console.error('[nav] 异常：', e.message); process.exit(3) })
