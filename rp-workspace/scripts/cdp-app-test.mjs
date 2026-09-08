// cdp-app-test.mjs — DSHTavern App 内 WebView 端到端测试（CDP 通道）
// 前置：adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
// 用法：node cdp-app-test.mjs <wsUrl>
// 链路：import-center 单卡导入（真实 writeDshFiles 落盘）→ rp-chat 工作区发现 →
//       会话创建 → firstMes 输出协议渲染（action/status/wrap 三组件）
import { setTimeout as sleep } from 'node:timers/promises'

const wsUrl = process.argv[2]
if (!wsUrl) { console.error('usage: node cdp-app-test.mjs <wsUrl>'); process.exit(2) }

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

const CARD = {
  spec: 'chara_card_v2', spec_version: '2.0',
  data: {
    name: 'CDP测试狐娘',
    description: '端到端测试角色',
    first_mes: '<content>风铃作响，她抬起头，目光好奇地看向我。</content><status>时间：傍晚\n地点：咖啡厅\n心情：好奇</status><a>打个招呼</a><selection>安静观察</selection>',
    character_book: { name: '内嵌书', entries: [{ content: '风铃是咖啡厅的门铃，声音清脆。', keys: ['风铃'], enabled: true }] },
  },
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

    // ---------- 阶段 1：import-center 单卡导入 + 真实落盘 ----------
    await send('Page.navigate', { url: 'https://appassets.androidplatform.net/assets/import-center/index.html' })
    await sleep(1800)
    const hasEngine = await ev('typeof DSHT !== "undefined" && typeof DSHT.exportSingleCardFiles === "function"')
    check('import-center 引擎就位（app.js + exportSingleCardFiles）', hasEngine)
    if (!hasEngine) throw new Error('DSHT bundle 未加载')

    const importOk = await ev(`(() => {
      try {
        const card = DSHT.importCharacterJson(${JSON.stringify(JSON.stringify(CARD))}, 'CDP测试狐娘')
        importedCard = card
        renderCard(card, document.getElementById('cardResult'))
        const btn = document.getElementById('cardWriteBtn')
        btn.style.display = 'block'; btn.disabled = false
        return card.name + ' | 内嵌书条目 ' + (card.embeddedBook ? card.embeddedBook.entries.length : 0)
      } catch (e) { return 'ERR:' + e.message }
    })()`)
    check('复合卡解析（含内嵌书）', !importOk.startsWith('ERR:'), importOk)

    const writeOk = await ev(`writeCardToDsh().then(() => document.getElementById('cardWriteResult').innerText).catch(e => 'ERR:' + e.message)`)
    check('写入 DSH（真实 writeDshFiles 落盘）', !writeOk.startsWith('ERR:'), String(writeOk).slice(0, 160))

    // ---------- 阶段 2：rp-chat 工作区发现 + firstMes 协议渲染 ----------
    await send('Page.navigate', { url: 'https://appassets.androidplatform.net/assets/rp-chat/index.html' })
    await sleep(1200)
    await ev('loadWorkspaces()')
    await sleep(300)
    const wsList = await ev(`(() => {
      const w = workspaces.find(x => x.name === 'CDP测试狐娘')
      return w ? JSON.stringify({ slug: w.slug, bookCount: w.bookCount, outputProtocol: w.outputProtocol }) : 'NOT_FOUND:' + workspaces.map(x => x.name).join(',')
    })()`)
    const w = wsList.startsWith('NOT_FOUND') ? null : JSON.parse(wsList)
    check('工作区发现（listRpWorkspaces 扫 rp.json）', !!w, w ? `${w.slug} · 书 ${w.bookCount} 本` : wsList)
    check('输出协议配置下发（statusTags 含 status）', !!w && Array.isArray(w.outputProtocol?.statusTags) && w.outputProtocol.statusTags.includes('status'),
      w ? JSON.stringify(w.outputProtocol) : '')

    // 建会话（rpc session.create → openChat → renderHistory：firstMes 走协议渲染）
    const chatOk = await ev(`(async () => {
      try {
        await pickSession('${w ? w.slug : ''}')
        await new Promise(r => setTimeout(r, 1200))
        return 'OK'
      } catch (e) { return 'ERR:' + e.message }
    })()`)
    check('会话创建/打开（session.create RPC）', chatOk === 'OK', chatOk)

    const dom = await ev(`(() => {
      const bubble = document.querySelector('.msg.ai')
      return JSON.stringify({
        statusBars: document.querySelectorAll('.status-bar').length,
        statusText: (document.querySelector('.status-bar')?.innerText || '').replace(/\\n/g, ' / '),
        actionBtns: document.querySelectorAll('.action-btn').length,
        actionTexts: [...document.querySelectorAll('.action-btn')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()),
        aiBubble: (bubble?.innerText || '').trim(),
        rawTagLeak: document.getElementById('chatFlow').innerHTML.includes('&lt;content&gt;') || document.getElementById('chatFlow').innerHTML.includes('&lt;status&gt;') || document.getElementById('chatFlow').innerHTML.includes('&lt;a&gt;'),
        chatScreen: document.getElementById('chatScreen').style.display,
      })
    })()`)
    const d = JSON.parse(dom)
    check('AI 气泡正文（content 剥壳）', d.aiBubble.includes('风铃作响，她抬起头'), d.aiBubble.slice(0, 60))
    check('状态栏卡片（status 提取 → 组件）', d.statusBars === 1 && d.statusText.includes('咖啡厅'), d.statusText)
    check('行动选项按钮（a + selection 提取）', d.actionBtns === 2 && d.actionTexts.join('|').includes('打个招呼') && d.actionTexts.join('|').includes('安静观察'), d.actionTexts.join(' | '))
    check('无原始标签泄漏', d.rawTagLeak === false, d.rawTagLeak ? '有泄漏' : '干净')
    check('聊天屏已激活', d.chatScreen === 'flex', d.chatScreen)

    const fails = results.filter(r => !r.ok).length
    console.log(`\n[cdp-app-test] ${results.length - fails}/${results.length} 通过`)
    process.exit(fails > 0 ? 1 : 0)
  } catch (e) {
    console.error('FATAL', e.message)
    process.exit(1)
  }
}
