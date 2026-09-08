// cdp-console-watch.mjs — 重载页面并收集 console 消息（错误定位）
import { setTimeout as sleep } from 'node:timers/promises'
const base = 'http://127.0.0.1:9222'
const list = await (await fetch(`${base}/json`)).json()
const page = list.find(p => p.type === 'page' && (p.url || '').includes('127.0.0.1:3090'))
if (!page) { console.error('no page'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const logs = []
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.onmessage = m => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${msg.params.type}] ${msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description?.slice(0, 400) || msg.params.exceptionDetails.text}`)
  }
}
ws.onopen = async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.reload', { ignoreCache: true })
    await sleep(6000)
    // 打开 RP 启动器 + 点角色卡
    await send('Runtime.evaluate', { expression: `document.querySelector('.dsht-rp-sidebar-btn')?.click()` })
    await sleep(800)
    await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.dsht-rp-card')].find(c => c.querySelector('.name')?.textContent === '协议测试角色')?.click()` })
    await sleep(5000)
    const state = await send('Runtime.evaluate', { expression: `JSON.stringify({
      flowNodes: document.querySelectorAll('[data-chat-flow-kind]').length,
      statusCards: document.querySelectorAll('.dsht-rp-statusbar').length,
      assistant: !!document.querySelector('.dsht-rp-assistant'),
      variantBar: !!document.querySelector('.dsht-rp-variant-bar'),
      bodySnippet: document.body.innerText.replace(/\\n+/g,' | ').slice(0, 200),
    })`, returnByValue: true })
    console.log('state:', state.result?.value)
    console.log(`--- console (${logs.length}) ---`)
    for (const l of logs.slice(0, 40)) console.log(l)
  } catch (e) { console.error('err:', e.message) }
  ws.close(); process.exit(0)
}
ws.onerror = () => { console.error('ws fail'); process.exit(1) }
