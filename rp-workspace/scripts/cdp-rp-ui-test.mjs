// cdp-rp-ui-test.mjs — DSH 原生前端内 RP 启动器端到端测试
// 前置：adb forward tcp:9223 ... + tcp:3081 ...；DSH 页面已加载
// 架构定案（用户裁决）：插件只做启动器——点角色卡 = ctx.sessions.open 打开原生
// session，conversation 主视图接管聊天。本测试验证该链路，不验证任何自制聊天 UI。
import { setTimeout as sleep } from 'node:timers/promises'

const wsUrl = process.argv[2]
if (!wsUrl) { console.error('usage: node cdp-rp-ui-test.mjs <wsUrl>'); process.exit(2) }

const ws = new WebSocket(wsUrl)
let seq = 0
const pending = new Map()
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}
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
ws.onerror = e => { console.error('WS error', e.message || e); process.exit(1) }

ws.onopen = async () => {
  try {
    await send('Page.enable')
    await send('Runtime.enable')

    // ---------- 阶段 1：插件激活 + 启动器打开 ----------
    const boot = await ev(`JSON.stringify({
      inBoot: (window.__DSH_BOOT__.entries || []).some(r => (typeof r === 'string' ? r : r.id) === 'dsht-rp-plugin'),
      sidebarBtn: !!document.querySelector('.dsht-rp-sidebar-btn'),
      style: !!document.getElementById('dsht-rp-ui-style'),
    })`)
    const b = JSON.parse(boot)
    check('插件进 boot graph', b.inBoot)
    check('侧栏 footer 按钮渲染', b.sidebarBtn)
    check('样式注入', b.style)

    await ev(`document.querySelector('.dsht-rp-sidebar-btn').click()`)
    await sleep(1200)
    const overlay = await ev(`JSON.stringify({
      open: !!document.querySelector('.dsht-rp-overlay'),
      cards: document.querySelectorAll('.dsht-rp-card').length,
      cardNames: [...document.querySelectorAll('.dsht-rp-card .name')].slice(0, 3).map(e => e.textContent),
      tabs: [...document.querySelectorAll('.dsht-rp-topbar .dsht-rp-tab')].map(e => e.textContent),
    })`)
    const o = JSON.parse(overlay)
    check('启动器打开（角色/导入 两 tab）', o.open, `tabs=${o.tabs.join('/')}`)
    check('角色宫格渲染（3081 rp/workspaces）', o.cards > 0, `${o.cards} 张卡：${o.cardNames.join('、')}`)

    // 自制聊天 UI 必须不存在（架构定案：conversation 主视图接管）
    const noChatUi = await ev(`JSON.stringify({
      overlay: !!document.querySelector('.dsht-rp-overlay'),
      noInputBar: !document.querySelector('.dsht-rp-inputbar'),
      noFlow: !document.querySelector('.dsht-rp-flow'),
      noMsg: !document.querySelector('.dsht-rp-msg'),
    })`)
    const nc = JSON.parse(noChatUi)
    check('无自制聊天 UI（气泡流/输入栏已删）', nc.noInputBar && nc.noFlow && nc.noMsg)

    // ---------- 阶段 2：点角色卡 → 原生 conversation 接管 ----------
    // 示例角色甲卡（rp-crmeek）有迁移的聊天历史——验证"点卡即续聊"路径
    const launch = await ev(`(async () => {
      const card = [...document.querySelectorAll('.dsht-rp-card')].find(c => (c.querySelector('.name')?.textContent || '').includes('示例角色甲'))
        || document.querySelector('.dsht-rp-card')
      card.click()
      await new Promise(r => setTimeout(r, 3000))
      return JSON.stringify({
        overlayClosed: !document.querySelector('.dsht-rp-overlay'),
        nativeComposer: !!document.querySelector('textarea'),
        // 迁移历史在原生 ChatView 渲染：正文含示例角色甲开场白文本
        historyRendered: document.body.innerText.includes('示例角色甲') && document.body.innerText.length > 500,
      })
    })()`)
    const l = JSON.parse(launch)
    check('点卡 → overlay 关闭', l.overlayClosed)
    check('原生 conversation 接管（composer 出现）', l.nativeComposer)
    check('迁移历史在原生 ChatView 渲染（点卡即续聊）', l.historyRendered)

    // ---------- 阶段 3：重新打开启动器 → 导入页 ----------
    await ev(`document.querySelector('.dsht-rp-sidebar-btn').click()`)
    await sleep(800)
    await ev(`[...document.querySelectorAll('.dsht-rp-topbar .dsht-rp-tab')].find(t => t.textContent === '导入')?.click()`)
    await sleep(600)
    const imp = await ev(`JSON.stringify({
      sections: document.querySelectorAll('.dsht-rp-import .dsht-rp-section').length,
      hasFileInput: !!document.querySelector('.dsht-rp-import input[type=file]'),
      hasApiKeyInput: !!document.querySelector('.dsht-rp-import input[type=password]'),
      apiTabs: [...document.querySelectorAll('.dsht-rp-section .dsht-rp-tab')].map(t => t.textContent),
    })`)
    const im = JSON.parse(imp)
    check('导入页（JSON 卡导入 + API 双模式）', im.sections >= 2 && im.hasFileInput && im.hasApiKeyInput, `tabs=${im.apiTabs.join('/')}`)

    // ---------- 阶段 4：单卡导入端点（node 侧）+ 列表刷新 ----------
    const cardJson = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: '启动器测试角色', description: 'launcher 测试', first_mes: '<content>原生会话测试。</content>',
    } })
    const imported = await ev(`fetch('http://127.0.0.1:3081/rp/import-card', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ json: ${JSON.stringify(cardJson)} }) }).then(r => r.json()).then(j => JSON.stringify(j)).catch(e => 'ERR:' + e.message)`)
    check('单卡导入端点', !imported.startsWith('ERR:') && imported.includes('"ok":true'), imported.slice(0, 100))

    await ev(`[...document.querySelectorAll('.dsht-rp-topbar .dsht-rp-tab')].find(t => t.textContent === '角色')?.click()`)
    await sleep(800)
    const grid = await ev(`JSON.stringify({ names: [...document.querySelectorAll('.dsht-rp-card .name')].map(e => e.textContent) })`)
    const g = JSON.parse(grid)
    check('导入后角色列表更新', g.names.includes('启动器测试角色'), `${g.names.length} 张卡`)

    // ---------- 阶段 5：新卡（无历史）→ session.create + 原生打开 ----------
    const launch2 = await ev(`(async () => {
      const card = [...document.querySelectorAll('.dsht-rp-card')].find(c => c.querySelector('.name')?.textContent === '启动器测试角色')
      if (!card) return 'NO_CARD'
      card.click()
      await new Promise(r => setTimeout(r, 3000))
      return JSON.stringify({
        overlayClosed: !document.querySelector('.dsht-rp-overlay'),
        nativeComposer: !!document.querySelector('textarea'),
      })
    })()`)
    if (launch2 === 'NO_CARD') {
      check('新卡 → session.create + 原生打开', false, '卡片未找到')
    } else {
      const l2 = JSON.parse(launch2)
      check('新卡（无历史）→ session.create + 原生打开', l2.overlayClosed && l2.nativeComposer)
    }

    const fails = results.filter(r => !r.ok).length
    console.log(`\n[cdp-rp-ui-test] ${results.length - fails}/${results.length} 通过`)
    process.exit(fails > 0 ? 1 : 0)
  } catch (e) {
    console.error('FATAL', e.message)
    process.exit(1)
  }
}
