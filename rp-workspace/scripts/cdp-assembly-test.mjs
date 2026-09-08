// cdp-assembly-test.mjs — 组装管线运行时接线端到端（D1/D2/D5 落实验证）
// 链路：导入带 [prompt 正则 + AT_DEPTH 条目 + 常驻条目] 的卡 → 原生会话发消息（真实 LLM）
//      → 3081 /trace 断言（regexHits / activatedEntries 含 depth / depthInjections / snapshotChars）
// 前置：adb forward tcp:9223 + tcp:3081；DSH 页面已加载
import { setTimeout as sleep } from 'node:timers/promises'

const wsUrl = process.argv[2]
if (!wsUrl) { console.error('usage: node cdp-assembly-test.mjs <wsUrl>'); process.exit(2) }

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
/** 同源 /api RPC */
async function api(method, payload) {
  return ev(`fetch('/api/${method}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'a-${Date.now()}-${Math.random()}', method: ${JSON.stringify(method)}, payload: ${JSON.stringify(payload)} }) }).then(r => r.json())`)
}
/** 3081 服务 */
async function rp(path, payload = {}) {
  return ev(`fetch('http://127.0.0.1:3081/${path}', { method: 'POST', headers: {'content-type':'application/json'}, body: ${JSON.stringify(JSON.stringify(payload))} }).then(r => r.json()).catch(e => ({ error: String(e) }))`)
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

    // ---------- 阶段 1：导入带正则 + 深度条目 + 常驻条目的卡（D2：regex 落盘）----------
    const cardJson = JSON.stringify({
      spec: 'chara_card_v2', spec_version: '2.0',
      data: {
        name: '组装管线测试', description: '验证 §4.1 五步接线的测试角色',
        first_mes: '<content>测试开场。</content>',
        character_book: { name: '管线书', entries: [
          // 常驻条目（BEFORE → 快照）+ 宏（组装期求值）
          { content: '{{char}}所在的世界有一条黄金法则：深度注入必须正确。', keys: [], enabled: true, constant: true, position: 0 },
          // 关键词触发的 AT_DEPTH 条目（depth 2 → splice 进批）
          { content: '【深度提示】提及"星海"时，以仰望星空的笔调收尾。', keys: ['星海'], enabled: true, position: 4, depth: 2 },
          // 关键词触发的 AFTER 条目
          { content: '【书末】星海章节的世界书补充。', keys: ['星海'], enabled: true, position: 1 },
        ] },
        extensions: { regex_scripts: [
          // prompt-only 正则：改用户消息（placement 1）
          { scriptName: '输入净化', findRegex: '/星海之影/g', replaceString: '星海', trimStrings: [], placement: [1], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
          // WORLD_INFO placement 正则：改 WI 内容
          { scriptName: '书内净化', findRegex: '/必须正确/g', replaceString: '业已验证', trimStrings: [], placement: [5], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
        ] },
      },
    })
    const imp = await rp('rp/import-card', { json: cardJson })
    check('导入带正则+深度条目的卡（D2 落盘）', imp.ok === true && imp.written >= 4, JSON.stringify(imp).slice(0, 100))

    // rp.json 核验：regex 字段持久化
    const wsList = await rp('rp/workspaces')
    const target = (wsList.workspaces || []).find(w => w.name === '组装管线测试')
    check('工作区出现', !!target, target ? target.slug : '(missing)')

    // ---------- 阶段 2：建会话并发消息（真实 LLM turn → pre-step 全管线跑）----------
    const home = await rp('rp/home')
    const created = await api('session.create', { cwd: `${home.dshHome}/rp/${target.slug}`, agentPreset: target.slug })
    const sessionId = created.result?.value?.sessionId
    check('会话创建（cwd 挂工作区）', !!sessionId, sessionId ?? JSON.stringify(created).slice(0, 120))

    // 用户消息含触发词 + 正则目标词（"星海之影"应被 prompt 正则改为"星海"再进 WI 扫描）
    const prompted = await api('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: '我望向星海之影，想起黄金法则。' }] })
    check('消息发送（session.prompt）', prompted.result?.ok === true)

    // 轮询 turn 结束（真实 LLM；60×1.5s 上限）——必须产生 assistant 回复（error-free），
    // 只见 turn/end 而无回复 = turn 失败（此前测试疏漏：注入消息缺 source 字段时
    // turn/end 带 reason.kind=error，旧断言只查事件存在而漏过）
    let done = false
    let assistantText = ''
    for (let i = 0; i < 60; i++) {
      await sleep(1500)
      const h = await api('session.history', { sessionId })
      const events = (h.result?.value?.events ?? []).map(e => e.event)
      const hasAssistant = events.some(e => e.type === 'assistant/message')
      if (events.some(e => e.type === 'turn/end')) {
        if (hasAssistant) {
          const last = [...events].reverse().find(e => e.type === 'assistant/message')
          assistantText = ((last.data?.message?.content) || []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
          done = true
        }
        break // turn/end 已到：有回复即成功，无回复即失败（不再等）
      }
    }
    check('turn 完成（LLM 真实回复落盘）', done && assistantText.length > 0, assistantText.slice(0, 60))

    // ---------- 阶段 3：3081 /trace 断言（D1 接线 + D5 trace 可查）----------
    const tr = await rp('trace', { sessionId })
    const trace = tr.trace
    check('trace 可查（T1.5）', !!trace, tr.error ?? JSON.stringify(tr).slice(0, 100))

    if (trace) {
      // D1 步骤 1：prompt 正则在批消息命中（输入净化 ×1）
      const inputRegex = (trace.regexHits || []).filter(h => h.scriptName === '输入净化')
      check('正则命中批消息（输入净化 prompt 时机）', inputRegex.length > 0 && inputRegex[0].count >= 1, JSON.stringify(trace.regexHits))

      // D1 步骤 2+4：WI 条目过正则（书内净化把"必须正确"→"业已验证"）+ 宏求值（{{char}}）
      const bookRegex = (trace.regexHits || []).filter(h => h.scriptName === '书内净化')
      check('正则命中 WI 内容（WORLD_INFO placement）', bookRegex.length > 0 && bookRegex[0].count >= 1)

      // 激活条目含常驻（快照）与深度（splice）
      const depthEntries = (trace.activatedEntries || []).filter(a => a.position.startsWith('depth-'))
      const beforeEntries = (trace.activatedEntries || []).filter(a => a.position === 'before')
      check('常驻条目激活（→ 快照）', beforeEntries.length >= 1, JSON.stringify(trace.activatedEntries))
      check('深度条目激活（→ splice）', depthEntries.length >= 1)

      // D1 步骤 3：深度注入发生
      check('深度注入进批（depthInjections 记录）', (trace.depthInjections || []).length >= 1, JSON.stringify(trace.depthInjections))
      check('快照注入（snapshotChars > 0）', trace.snapshotChars > 0, String(trace.snapshotChars))
    }

    const fails = results.filter(r => !r.ok).length
    console.log(`\n[cdp-assembly-test] ${results.length - fails}/${results.length} 通过`)
    process.exit(fails > 0 ? 1 : 0)
  } catch (e) {
    console.error('FATAL', e.message)
    process.exit(1)
  }
}
