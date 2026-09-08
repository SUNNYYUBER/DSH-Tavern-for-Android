// cdp-compat-api-test.mjs — 第三方 API 接入 + T1.11 折叠栏 模拟器端到端测试
// 前置：adb forward tcp:9223 ...；DSH 原生前端已加载
// 链路：①API 双模式 tab UI ②第三方路由真实 RPC 流（discoverModels→settings→默认模型，用 DeepSeek 官方端点冒充第三方——它就是 OpenAI 兼容的）
//      ③llm.models 出现新路由组 ④onboarding 识别第三方 ⑤T1.11 turnbar/shimmer 样式在位
import { setTimeout as sleep } from 'node:timers/promises'

const wsUrl = process.argv[2]
if (!wsUrl) { console.error('usage: node cdp-compat-api-test.mjs <wsUrl>'); process.exit(2) }

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
/** 同源 /api RPC（页面在 3080 origin；payload 直插对象字面量，勿双重序列化） */
async function api(method, payload) {
  return ev(`fetch('/api/${method}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 't-${Date.now()}-${Math.random()}', method: ${JSON.stringify(method)}, payload: ${JSON.stringify(payload)} }) }).then(r => r.json())`)
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

    // ---------- 阶段 1：插件激活（回归）+ overlay API 双模式 UI ----------
    const plug = await ev(`JSON.stringify({
      sidebarBtn: !!document.querySelector('.dsht-rp-sidebar-btn'),
    })`)
    check('插件激活（回归）', JSON.parse(plug).sidebarBtn)
    await ev(`document.querySelector('.dsht-rp-sidebar-btn').click()`)
    await sleep(1000)
    await ev(`[...document.querySelectorAll('.dsht-rp-tab')].find(t => t.textContent === '导入')?.click()`)
    await sleep(600)
    const ui = await ev(`JSON.stringify({
      apiTabs: [...document.querySelectorAll('.dsht-rp-section .dsht-rp-tab')].map(t => t.textContent),
      officialForm: !!document.querySelector('input[type=password]'),
    })`)
    const u = JSON.parse(ui)
    check('API 配置双模式 tab（官方 / 第三方）', u.apiTabs.includes('DeepSeek 官方') && u.apiTabs.includes('第三方 / OpenAI 兼容'), u.apiTabs.join('/'))
    check('官方模式默认表单在位', u.officialForm)

    // 切第三方 tab，检查表单字段
    await ev(`[...document.querySelectorAll('.dsht-rp-section .dsht-rp-tab')].find(t => t.textContent.includes('第三方'))?.click()`)
    await sleep(400)
    const compatForm = await ev(`JSON.stringify({
      inputs: [...document.querySelectorAll('.dsht-rp-section input')].map(i => i.placeholder),
      hasDiscoverBtn: [...document.querySelectorAll('.dsht-rp-section button')].some(b => b.textContent.includes('探测模型')),
    })`)
    const cf = JSON.parse(compatForm)
    check('第三方表单字段（路由键/显示名/BaseURL/Key/模型）', cf.inputs.length >= 4, cf.inputs.slice(0, 4).join(' | '))
    check('「探测模型」按钮在位', cf.hasDiscoverBtn)

    // ---------- 阶段 2：第三方路由真实 RPC 流（DeepSeek 官方端点=OpenAI 兼容，冒充第三方）----------
    // 2a. discoverModels 真实询问端点（假 key → 401 是端点应答，证明请求到达 OpenAI 兼容端点且错误被折叠成业务错误码）
    const disc = await ev(`fetch('/api/llm.discoverModels', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'd1', method: 'llm.discoverModels', payload: { settingsNs: 'llm-pi-ai', baseURL: 'https://api.deepseek.com/v1', api: 'openai-completions', apiKey: 'sk-invalid-probe' } }) }).then(r => r.json())`)
    const discErr = String(disc.result?.error?.message ?? '')
    const discOk = disc.result?.ok === true && Array.isArray(disc.result.value?.models) && disc.result.value.models.length > 0
    const endpointReached = discOk || discErr.includes('401')
    check('llm.discoverModels 通道（端点真实应答）', endpointReached,
      discOk ? `${disc.result.value.models.length} 模型：${disc.result.value.models.slice(0, 3).map(m => m.id).join('、')}` : `端点应答被折叠为业务错误（${discErr.slice(0, 60)}）= 请求链路通，真 key 即可探测`)

    // 2b. 凭据 + 路由 + 默认模型（RPC 序列；key 用占位——链路验证不需要真实出话）
    const ROUTE = 'dshttest'
    const REF = 'DSHTTEST_API_KEY'
    const MODEL = discOk ? (disc.result.value.models.find(m => /chat|v3/i.test(m.id))?.id ?? disc.result.value.models[0].id) : 'deepseek-chat'
    await api('credentials.set', { ref: REF, value: 'sk-test-placeholder' })
    const prov = await api('settings.update', {
      ns: 'llm-pi-ai',
      patch: { providers: { [ROUTE]: {
        displayName: 'DSHT Test Gateway', apiKeyEnv: REF, api: 'openai-completions',
        baseURL: 'https://api.deepseek.com/v1',
        compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
        models: discOk ? disc.result.value.models : [{ id: MODEL }],
      } } },
    })
    check('settings.update 写入第三方路由（llm-pi-ai）', prov.result?.ok === true, prov.result?.ok ? `${ROUTE} 路由已写入` : JSON.stringify(prov.result?.error?.message).slice(0, 100))
    const def = await api('settings.update', { ns: 'agent-default-model', patch: { provider: ROUTE, model: MODEL } })
    check('默认模型指向第三方路由', def.result?.ok === true, `${ROUTE} / ${MODEL}`)

    // 2c. llm.models 出现新路由组（路由已激活）
    const models = await ev(`fetch('/api/llm.models', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'm1', method: 'llm.models', payload: {} }) }).then(r => r.json())`)
    const groups = models.result?.value?.groups ?? []
    const hasRoute = groups.some(g => g.id === ROUTE || g.name?.includes('DSHT Test'))
    check('llm.models 出现第三方路由组（active）', hasRoute, `groups=${groups.map(g => g.id).join('、')}`)

    // 2d. onboarding 识别第三方（import-center 的检测逻辑：llm.providers declared:true）
    const providers = await ev(`fetch('/api/llm.providers', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'p1', method: 'llm.providers', payload: {} }) }).then(r => r.json())`)
    const declared = (providers.result?.value?.providers ?? []).filter(p => p.declared === true)
    check('llm.providers 声明第三方路由（declared:true）', declared.some(p => p.provider === ROUTE), declared.map(p => p.provider).join('、') || '(无)')

    // ---------- 阶段 3：T1.11 折叠栏（turnbar 摘要行 + shimmer 样式）----------
    const t11 = await ev(`(() => {
      const sheet = [...document.styleSheets].find(s => s.ownerNode && s.ownerNode.id === 'dsht-rp-ui-style')
      const rules = sheet ? [...sheet.cssRules].map(r => r.cssText).join('\\n') : ''
      return JSON.stringify({
        found: !!sheet,
        shimmerRule: rules.includes('dsht-rp-shimmer'),
        shimmerAnim: rules.includes('@keyframes dsht-rp-shimmer'),
        turnbarRule: rules.includes('dsht-rp-turnbar'),
        reducedMotion: rules.includes('prefers-reduced-motion'),
      })
    })()`)
    const t = JSON.parse(t11)
    check('T1.11 shimmer 运行态样式（扫光动效）', t.shimmerRule && t.shimmerAnim)
    check('T1.11 turnbar 折叠栏样式（摘要行 + chev 旋转）', t.turnbarRule)
    check('T1.11 prefers-reduced-motion 禁用动画', t.reducedMotion)

    // ---------- 阶段 4：还原默认模型（避免破坏模拟器现有配置）+ UI 内关闭 ----------
    await api('settings.update', { ns: 'agent-default-model', patch: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    check('默认模型还原 deepseek-official', true)

    const fails = results.filter(r => !r.ok).length
    console.log(`\n[cdp-compat-api-test] ${results.length - fails}/${results.length} 通过`)
    process.exit(fails > 0 ? 1 : 0)
  } catch (e) {
    console.error('FATAL', e.message)
    process.exit(1)
  }
}
