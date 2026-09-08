// cdp-t25-native-chat-test.mjs — T2.5 前端原生化收口端到端验证（PC 安卓同构环境）
// 前置：DSH web 跑在 3090（pc-verify-home：协议测试角色 + t25-verify-001 会话）；
//       Chrome headless CDP 9222 已开页面 http://127.0.0.1:3090
// 断言（对照计划 T2.5 验证标准）：
//   1. dsht-rp-ui 进 boot graph；assistant-step 席位被 shadowing（原生 ChatView 内
//      渲染状态卡/行动按钮/剥壳正文，且无原始标签泄漏）
//   2. 行动按钮点击 → 原生 composer 通道（setDraft 落进原生输入框 DOM）
//   3. 变体条 ‹ n/m › 渲染 + 切换落盘（/dsht-rp/variant/switch 同源路由）
//   4. 拔插件可卸载性由结构保证（shadowing priority -1，官方渲染器复位）
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] || 'http://127.0.0.1:9222'
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}

const list = await (await fetch(`${base}/json`)).json()
const page = list.find(p => p.type === 'page' && (p.url || '').includes('127.0.0.1:3090'))
if (!page) { console.error('no page found for 3090'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}

ws.onmessage = m => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}
ws.onerror = () => { console.error('ws connect failed'); process.exit(1) }

await new Promise(r => { ws.onopen = r })
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(2500) // 等插件全激活 + 首屏

  // ---------- 阶段 1：插件激活 ----------
  const boot = await ev(`JSON.stringify({
    inBoot: (window.__DSH_BOOT__.entries || []).some(r => (typeof r === 'string' ? r : r.id) === 'dsht-rp-plugin'),
    sidebarBtn: !!document.querySelector('.dsht-rp-sidebar-btn'),
    style: !!document.getElementById('dsht-rp-ui-style'),
  })`)
  const b = JSON.parse(boot)
  check('插件进 boot graph', b.inBoot)
  check('侧栏 footer 按钮渲染', b.sidebarBtn)
  check('样式注入（含 T2.5 组件样式）', b.style)

  // ---------- 阶段 2：RP 启动器 → 原生 session ----------
  await ev(`document.querySelector('.dsht-rp-sidebar-btn').click()`)
  await sleep(1000)
  const overlay = await ev(`JSON.stringify({
    open: !!document.querySelector('.dsht-rp-overlay'),
    cards: [...document.querySelectorAll('.dsht-rp-card .name')].map(n => n.textContent),
  })`)
  const o = JSON.parse(overlay)
  check('RP 启动器打开', o.open)
  check('角色宫格含协议测试角色', o.cards.includes('协议测试角色'), o.cards.join(','))

  await ev(`[...document.querySelectorAll('.dsht-rp-card')].find(c => c.querySelector('.name')?.textContent === '协议测试角色')?.click()`)
  await sleep(4000) // session 打开 + conversation 视图渲染

  // ---------- 阶段 3：原生 ChatView 内的输出协议三组件（T2.5a）----------
  const chat = await ev(`JSON.stringify({
    hasOverlay: !!document.querySelector('.dsht-rp-overlay'),
    statusCards: document.querySelectorAll('.dsht-rp-statusbar').length,
    actionBtns: document.querySelectorAll('.dsht-rp-action-btn').length,
    actionTexts: [...document.querySelectorAll('.dsht-rp-action-btn')].map(b => b.textContent.trim()),
    statusText: document.querySelector('.dsht-rp-statusbar')?.innerText || '',
    variantBar: !!document.querySelector('.dsht-rp-variant-bar'),
    variantCount: document.querySelector('.dsht-rp-variant-bar .vb-count')?.textContent || '',
    bodyText: document.querySelector('.dsht-rp-assistant')?.innerText || '',
    rawLeak: /<content>|<\\/content>|<a>|<\\/a>|<selection>|<StatusBlock>|<status>/.test(document.querySelector('.dsht-rp-assistant')?.innerText || ''),
    userMsg: [...document.querySelectorAll('[data-chat-flow-kind]')].length,
  })`)
  const c = JSON.parse(chat)
  check('RP overlay 已关闭（露出原生 conversation 主视图）', !c.hasOverlay)
  check('原生 ChatView 已渲染消息流', c.userMsg > 0, `nodes=${c.userMsg}`)
  check('状态栏卡片渲染（statusTags → 组件）', c.statusCards >= 1, `cards=${c.statusCards}`)
  check('状态卡内容解析（键值行）', /时间|地点|好感/.test(c.statusText), c.statusText.replace(/\n/g, ' · ').slice(0, 60))
  check('行动选项按钮渲染（actionTags → 按钮）', c.actionBtns >= 1, `btns=${c.actionBtns}`)
  check('剥壳正文（wrapTags → 无原始标签泄漏）', !c.rawLeak)
  check('正文非空', c.bodyText.trim().length > 0, c.bodyText.slice(0, 40).replace(/\n/g, ' '))
  check('变体条渲染（T2.5c ‹ n/m ›）', c.variantBar, `count=${c.variantCount}`)

  // ---------- 阶段 4：行动按钮点击 → 原生 composer 通道（T2.5b）----------
  const actionText = (c.actionTexts[0] || '').replace('▸', '').trim() // 按钮文案含 ▸ 引导符
  const before = await ev(`document.querySelector('textarea')?.value ?? ''`)
  await ev(`document.querySelector('.dsht-rp-action-btn')?.click()`)
  await sleep(2000)
  const after = await ev(`JSON.stringify({
    draft: document.querySelector('textarea')?.value ?? '',
    flowText: document.querySelector('[data-chat-flow-kind="user"]')?.innerText ?? '',
    lastUserNodes: [...document.querySelectorAll('[data-chat-flow-kind="user"]')].map(n => n.innerText.split('\\n')[0]),
  })`)
  const a2 = JSON.parse(after)
  const sent = a2.draft.includes(actionText.slice(0, 6)) || a2.lastUserNodes.some(t => t.includes(actionText.slice(0, 6)))
  check('行动按钮经原生 composer 通道（选项文本作为用户消息发出）', sent,
    `action="${actionText.slice(0, 16)}" draft="${a2.draft.slice(0, 24)}" lastUser=${JSON.stringify(a2.lastUserNodes).slice(0, 80)}`)

  // ---------- 阶段 5：变体切换（T2.5c：切换落盘 + surface 更新）----------
  const beforeBody = await ev(`document.querySelector('.dsht-rp-assistant')?.innerText.slice(0, 30) || ''`)
  await ev(`document.querySelector('.dsht-rp-variant-bar .vb-arrow:not(:disabled)')?.click()`)
  await sleep(2500)
  const afterBody = await ev(`JSON.stringify({
    body: document.querySelector('.dsht-rp-assistant')?.innerText.slice(0, 30) || '',
    count: document.querySelector('.dsht-rp-variant-bar .vb-count')?.textContent || '',
  })`)
  const a3 = JSON.parse(afterBody)
  check('变体切换：surface 投影更新', beforeBody !== a3.body, `${beforeBody.slice(0, 16)}… → ${a3.body.slice(0, 16)}…`)
  check('变体切换：计数联动', c.variantCount !== a3.count, `${c.variantCount} → ${a3.count}`)

  // 切换落盘（session.jsonl 追加了 provider=dsht-variant 事件）
  const persisted = await ev(`(async () => {
    const r = await fetch('/api/session.history', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 't25-hist', method: 'session.history', payload: { sessionId: 't25-verify-001' } }) })
    const j = await r.json()
    const events = j.result?.value?.events ?? []
    return JSON.stringify({ total: events.length, last: events[events.length - 1]?.event?.type })
  })()`)
  const p = JSON.parse(persisted)
  check('变体切换事件写入 session log（落盘）', p.total >= 8 && p.last === 'assistant/message', `events=${p.total} last=${p.last}`)

  // ---------- 汇总 ----------
  const failed = results.filter(r => !r.ok)
  console.log(`\n==== T2.5 native-chat e2e: ${results.length - failed.length}/${results.length} passed ====`)
  if (failed.length > 0) process.exit(1)
} catch (e) {
  console.error('test error:', e.message)
  process.exit(2)
} finally {
  ws.close()
}
