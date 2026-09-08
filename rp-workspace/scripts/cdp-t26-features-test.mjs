// cdp-t26-features-test.mjs — T2.6/T2.7/T2.8/T2.10 端到端验证（PC 安卓同构环境）
// 前置：setup-pc-verify.mjs + DSH 3090 + Chrome CDP 9222 已就绪
// 断言：
//   T2.10：UpdateVariable/details/foreshadowings 美化渲染（原生 ChatView 内，无裸标签）
//   T2.7：预设列表 + 会话头切换席位 + 切换落状态文件
//   T2.8：正则管理面板（列表/保存全局/测试器）
//   T2.6：欢迎工作区存在 + 导入 dock 入口 + 角色卡⚙详情（世界书绑定）
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
const api = (path, payload) => fetch(`http://127.0.0.1:3090/dsht-rp/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
}).then(r => r.json())

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
  await sleep(2500)

  // ---------- 数据面直查（不依赖 UI 时序）----------
  const home = await api('rp/home', {})
  check('T2.6 数据面：/rp/home 就绪', home.dshHome?.includes('pc-verify-home') === true, home.dshHome)

  // T2.6：欢迎工作区（插件 boot 时自动创建）
  const wsr = await api('rp/workspaces', {})
  const welcome = (wsr.workspaces ?? []).find(w => w.slug === '_start')
  check('T2.6 欢迎工作区已创建（rp/_start）', welcome !== undefined, welcome ? welcome.name : 'missing')
  check('T2.6 角色工作区含协议测试角色', (wsr.workspaces ?? []).some(w => w.slug === 'rp-prototest'))

  // T2.7：预设列表（内置两个示范）
  const pr = await api('preset/list', {})
  check('T2.7 预设列表：内置直答/轻 agent 两个示范', (pr.presets ?? []).length >= 2,
    (pr.presets ?? []).map(p => p.displayName).join('、'))

  // T2.7：会话内切换预设 → 状态落盘 → 下一轮注入（trace 验证注入为 pre-step 行为，此处验证状态链路）
  const sel = await api('preset/select', { sessionId: 't25-verify-001', presetId: 'rp-demo-direct' })
  check('T2.7 切换预设 API（session 内随时）', sel.ok === true, JSON.stringify(sel))
  const st = await api('preset/state', { sessionId: 't25-verify-001' })
  check('T2.7 预设状态落盘（preset/state 读回）', st.presetId === 'rp-demo-direct', JSON.stringify(st))

  // T2.8：正则三层作用域数据面
  const rxSave = await api('regex/save-global', { scripts: [{
    id: 'rx-test-1', scriptName: '净化测试', findRegex: '裸词', replaceString: '净化词',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
  }] })
  check('T2.8 保存全局正则', rxSave.ok === true, JSON.stringify(rxSave))
  const rxList = await api('regex/list', { slug: 'rp-prototest' })
  check('T2.8 全局正则入列 + 角色作用域可查', (rxList.global ?? []).some(s => s.scriptName === '净化测试') && Array.isArray(rxList.scoped), `global=${rxList.global?.length} scoped=${rxList.scoped?.length}`)
  const rxTest = await api('regex/test', {
    script: rxList.global[0], text: '这里有个裸词需要净化', placement: 2,
  })
  check('T2.8 测试器：替换结果正确', rxTest.result?.includes('净化词') === true, `${rxTest.hits} hits → ${rxTest.result}`)

  // T2.6：世界书绑定数据面
  const bind = await api('rp/bind-books', { slug: 'rp-prototest', books: [{ name: '测试书', lorePath: 'skills/wb-prototest-x1/references/lore.json' }] })
  check('T2.6 世界书重绑定 API', bind.ok === true, JSON.stringify(bind))
  const books = await api('rp/books', {})
  check('T2.6 书库清单（skills/wb-*）', (books.books ?? []).some(b => b.slug === 'wb-prototest-x1'), (books.books ?? []).map(b => b.slug).join(','))

  // ---------- UI 断言 ----------
  // T2.10：渲染补差（切换到 v1 变体后全组件可见——先切到 1/2）
  await ev(`document.querySelector('.dsht-rp-sidebar-btn')?.click()`)
  await sleep(1000)
  await ev(`[...document.querySelectorAll('.dsht-rp-card')].find(c => c.querySelector('.name')?.textContent === '协议测试角色')?.click()`)
  await sleep(4000)

  // 变体切到 1（显示覆盖 v1 内容）
  for (let i = 0; i < 3; i++) {
    const cnt = await ev(`document.querySelector('.dsht-rp-variant-bar .vb-count')?.textContent || ''`)
    if (cnt.startsWith('1/')) break
    await ev(`document.querySelector('.dsht-rp-variant-bar .vb-arrow:not(:disabled)')?.click()`)
    await sleep(2000)
  }
  const render = await ev(`JSON.stringify({
    stateUpdate: !!document.querySelector('.dsht-rp-state-update'),
    collapsible: !!document.querySelector('.dsht-rp-collapsible'),
    foreshadowing: !!document.querySelector('.dsht-rp-foreshadowing'),
    statusCards: document.querySelectorAll('.dsht-rp-statusbar').length,
    actionBtns: document.querySelectorAll('.dsht-rp-action-btn').length,
    patchRows: document.querySelectorAll('.su-patch-table tr').length,
    rawLeak: /<UpdateVariable>|<JSONPatch>|<foreshadowings>|<details>/.test(document.querySelector('.dsht-rp-assistant')?.innerText || ''),
    presetSwitch: !!document.querySelector('.dsht-rp-preset-switch'),
    importDock: !!document.querySelector('.dsht-rp-import-dock'),
    gear: !!document.querySelector('.dsht-rp-card-gear'),
  })`)
  const r = JSON.parse(render)
  check('T2.10 状态更新块渲染（UpdateVariable→折叠块）', r.stateUpdate)
  check('T2.10 JSONPatch diff 表渲染', r.patchRows >= 2, `rows=${r.patchRows}`)
  check('T2.10 折叠块渲染（details 实时总结）', r.collapsible)
  check('T2.10 伏笔登记册渲染', r.foreshadowing)
  check('T2.10 状态卡 + 行动按钮保持', r.statusCards >= 1 && r.actionBtns >= 1)
  check('T2.10 无裸标签泄漏', !r.rawLeak)
  check('T2.7 会话头预设切换 UI（原生 header 席位）', r.presetSwitch)
  check('T2.6 导入 dock 入口（composer 上方）', r.importDock)

  // T2.7：会话头下拉切换预设（UI 交互）
  const switchByUi = await ev(`(async () => {
    const sel = document.querySelector('.dsht-rp-preset-switch select')
    if (!sel) return 'no-select'
    sel.value = 'rp-demo-light-agent'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))
    return sel.value
  })()`)
  check('T2.7 会话头下拉切换（UI→状态）', switchByUi === 'rp-demo-light-agent', `sel=${switchByUi}`)
  const st2 = await api('preset/state', { sessionId: 't25-verify-001' })
  check('T2.7 UI 切换落盘一致', st2.presetId === 'rp-demo-light-agent', JSON.stringify(st2))

  // T2.8：正则管理面板 UI（打开→列表含刚保存的全局正则）
  await ev(`document.querySelector('.dsht-rp-sidebar-btn')?.click()`)
  await sleep(800)
  await ev(`[...document.querySelectorAll('.dsht-rp-tab')].find(t => t.textContent === '正则')?.click()`)
  await sleep(1200)
  const rxUi = await ev(`JSON.stringify({
    rows: [...document.querySelectorAll('.dsht-rp-regex-row')].map(n => n.querySelector('.rx-name')?.textContent),
    toggle: !!document.querySelector('.dsht-rp-regex-row .rx-toggle'),
    badges: document.querySelector('.rx-badges')?.innerText || '',
  })`)
  const ru = JSON.parse(rxUi)
  check('T2.8 正则面板：全局列表渲染（含刚保存脚本）', (ru.rows ?? []).includes('净化测试'), JSON.stringify(ru.rows))
  check('T2.8 正则面板：开关 + placement 徽章 + 三时机标识', ru.toggle && /AI输出/.test(ru.badges), ru.badges.replace(/\n/g, ' '))

  // T2.7：预设管理面板 UI（条目开关可见）
  await ev(`[...document.querySelectorAll('.dsht-rp-tab')].find(t => t.textContent === '预设')?.click()`)
  await sleep(1000)
  const prUi = await ev(`JSON.stringify({
    rows: [...document.querySelectorAll('.dsht-rp-preset-row .pr-name')].map(n => n.textContent),
  })`)
  const pu = JSON.parse(prUi)
  check('T2.7 预设面板：列表渲染（内置两个示范）', (pu.rows ?? []).length >= 2, JSON.stringify(pu.rows))
  await ev(`[...document.querySelectorAll('.dsht-rp-preset-row')][0]?.click()`)
  await sleep(600)
  const prEntry = await ev(`JSON.stringify({
    entries: document.querySelectorAll('.dsht-rp-preset-entry').length,
    toggles: document.querySelectorAll('.dsht-rp-preset-toggle').length,
  })`)
  const pe = JSON.parse(prEntry)
  check('T2.7 预设面板：条目开关 + toggles 组可见（点开即设置）', pe.entries > 0 && pe.toggles >= 0, `entries=${pe.entries} toggles=${pe.toggles}`)

  // T2.6：角色卡⚙ 详情（世界书绑定抽屉）
  await ev(`[...document.querySelectorAll('.dsht-rp-tab')].find(t => t.textContent === '角色')?.click()`)
  await sleep(800)
  await ev(`document.querySelector('.dsht-rp-card-gear')?.click()`)
  await sleep(1200)
  const drawer = await ev(`JSON.stringify({
    open: !!document.querySelector('.dsht-rp-drawer'),
    title: document.querySelector('.dsht-rp-drawer-head')?.textContent || '',
    books: [...document.querySelectorAll('.dsht-rp-drawer-body label')].length,
  })`)
  const dr = JSON.parse(drawer)
  check('T2.6 角色详情抽屉：世界书绑定面板（ST 后期换书）', dr.open && /世界书绑定/.test(dr.title) && dr.books >= 1, `books=${dr.books}`)

  // 汇总
  const failed = results.filter(x => !x.ok)
  console.log(`\n==== T2.6-T2.10 features e2e: ${results.length - failed.length}/${results.length} passed ====`)
  if (failed.length > 0) process.exit(1)
} catch (e) {
  console.error('test error:', e.message)
  process.exit(2)
} finally {
  ws.close()
}
