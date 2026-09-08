// cdp-app-test-v2.mjs — App 内端到端测试（第二轮：风格统一 + 新手引导 + AI 分类通道）
// 前置：adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
// 用法：node cdp-app-test-v2.mjs <wsUrl>
import { setTimeout as sleep } from 'node:timers/promises'

const wsUrl = process.argv[2]
if (!wsUrl) { console.error('usage: node cdp-app-test-v2.mjs <wsUrl>'); process.exit(2) }

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

    // ---------- 阶段 1：import-center 风格 + 新手引导 + AI 分类真实调用 ----------
    await send('Page.navigate', { url: 'https://appassets.androidplatform.net/assets/import-center/index.html' })
    await sleep(2000)

    const style = await ev(`(() => {
      const cs = getComputedStyle(document.documentElement)
      return JSON.stringify({
        bg: cs.getPropertyValue('--bg').trim(),
        tokensLoaded: !!document.querySelector('link[href*="dsw-tokens"]'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      })
    })()`)
    const st = JSON.parse(style)
    check('DSH token 生效（--bg 解析非空）', st.bg.length > 0, `--bg=${st.bg}`)
    check('tokens.css 已加载', st.tokensLoaded)

    const onboard = await ev(`(async () => {
      localStorage.removeItem('dsht-onboarded') // 重置引导标记，验证首次完整流程
      await checkOnboarding()
      await new Promise(r => setTimeout(r, 400))
      const w = document.getElementById('welcome')
      return JSON.stringify({
        visible: w.style.display !== 'none',
        step1: document.getElementById('step1').className,
        step2: document.getElementById('step2').className,
        badge: document.getElementById('welcomeBadge').textContent,
        panel: (document.getElementById('stepPanel').innerText || '').slice(0, 80),
      })
    })()`)
    const ob = JSON.parse(onboard)
    check('新手引导渲染（检测已有 API key）', ob.visible && ob.step1.includes('done'), `step1=${ob.step1} badge=${ob.badge}`)
    check('引导面板文案', ob.panel.length > 0, ob.panel.replace(/\n/g, ' '))

    // AI 分类通道：真实 LLM 调用（模拟器已配 key + 默认模型）
    const classifyPrompt = '对下列条目分类，类目：knowledge(知识)、instruction(指令)。严格输出 JSON 数组：[{"id":<id>,"cls":"<类目>"}]' + '\\n' + '条目：[{"id":"lore-t-0","name":"今州城","preview":"今州城是示例游戏世界的都市…"},{"id":"lore-t-1","name":"文风","preview":"写作时使用华丽的长句…"}]'
    const classify = await ev(`(async () => {
      try {
        const resp = JSON.parse(DSHTNative.rpVariant('llm/classify', JSON.stringify({ prompt: ${JSON.stringify(classifyPrompt)} })))
        if (resp.error) return 'ERR:' + resp.error
        return 'OK:' + resp.text.slice(0, 200)
      } catch (e) { return 'ERR:' + e.message }
    })()`)
    check('AI 语义分类通道（真实 LLM 调用）', classify.startsWith('OK:'), classify.slice(0, 160))

    // 主题切换：验证切换前后 --bg 翻转（不假设初始态——模拟器 prefers-color-scheme 可能是 dark）
    const theme = await ev(`(() => {
      const before = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      toggleTheme()
      const after = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      return JSON.stringify({ before, after, flipped: before !== after })
    })()`)
    const th = JSON.parse(theme)
    check('深浅主题切换（token 翻转）', th.flipped, `${th.before} → ${th.after}`)
    await ev('toggleTheme()') // 切回原主题

    // ---------- 阶段 2：rp-chat 风格 ----------
    await send('Page.navigate', { url: 'https://appassets.androidplatform.net/assets/rp-chat/index.html' })
    await sleep(1500)
    await ev('loadWorkspaces()')
    await sleep(400)
    const chatStyle = await ev(`(() => {
      const cs = getComputedStyle(document.documentElement)
      const grid = document.getElementById('wsGrid')
      const card = grid.querySelector('.wsCard')
      return JSON.stringify({
        bg: cs.getPropertyValue('--bg').trim(),
        cards: grid.querySelectorAll('.wsCard').length,
        cardBg: card ? getComputedStyle(card).backgroundColor : 'none',
        cardRadius: card ? getComputedStyle(card).borderRadius : 'none',
      })
    })()`)
    const chs = JSON.parse(chatStyle)
    check('rp-chat token 生效 + 角色卡片渲染', chs.bg.length > 0 && chs.cards > 0, `${chs.cards} 张卡 · bg=${chs.bg} · card=${chs.cardBg} r=${chs.cardRadius}`)

    // 真实会话打开 + 气泡颜色（走真实 pickSession）
    const openOk = await ev(`(async () => {
      try { await pickSession(workspaces[0].slug); await new Promise(r => setTimeout(r, 1500)); return 'OK' }
      catch (e) { return 'ERR:' + e.message }
    })()`)
    check('会话打开（真实 RPC）', openOk === 'OK', openOk)
    const bubbles = await ev(`(() => {
      const ai = document.querySelector('.msg.ai')
      return JSON.stringify({
        aiBg: ai ? getComputedStyle(ai).backgroundColor : 'none',
        actions: document.querySelectorAll('.action-btn').length,
        statusBars: document.querySelectorAll('.status-bar').length,
        fontSerif: ai ? getComputedStyle(ai).fontFamily.includes('Serif') : false,
      })
    })()`)
    const bb = JSON.parse(bubbles)
    check('AI 气泡样式（DSH bubble token + 衬线叙事字体）', bb.aiBg !== 'none' && bb.fontSerif, `bg=${bb.aiBg} serif=${bb.fontSerif}`)
    check('输出协议组件在 App 内渲染', bb.actions > 0 || bb.statusBars > 0, `actions=${bb.actions} statusBars=${bb.statusBars}`)

    const fails = results.filter(r => !r.ok).length
    console.log(`\n[cdp-app-test-v2] ${results.length - fails}/${results.length} 通过`)
    process.exit(fails > 0 ? 1 : 0)
  } catch (e) {
    console.error('FATAL', e.message)
    process.exit(1)
  }
}
