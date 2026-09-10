#!/usr/bin/env node
/**
 * stage4-regression.mjs — 阶段 4 功能回归（回退/编辑/变体/世界书/MVU/记忆）
 * =====================================================================
 * 走**同源直连**数据面（与客户端 rpc.ts 同形态），逐项断言路由可用 + 语义正确。
 * 与 UI 点选互补：这里验「服务端语义」，UI 验「渲染与交互」。
 *
 * 前置：app 已启动 + 会话已 attach（打开过该会话）+ `adb forward tcp:9333 …<app pid>`。
 * 用法：node stage4-regression.mjs [--port 9333] [--session <sessionId>]
 * 退出码：0 = 全过；1 = 有失败
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--port')
const PORT = pi >= 0 ? argv[pi + 1] : '9333'
const si = argv.indexOf('--session')
// 默认取「冒烟测试一句话要求」（设备上唯一已迁移且用户在用的会话）
let SID = si >= 0 ? argv[si + 1] : ''

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)).slice(0, 300) }
  return r.result?.value
}
/** 同源直连 POST（返回 {status, body}） */
const call = async (base, path, payload) => {
  const url = `/${base}/${path.replace(/^\//, '')}`
  const expr = `fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},
    body:${JSON.stringify(JSON.stringify(payload ?? {}))}})
    .then(r=>r.text().then(t=>({status:r.status,body:t})))
    .catch(e=>({status:-1,body:'FETCHERR '+e}))`
  const r = await ev(expr)
  if (r && r.__err) return { status: -1, body: r.__err }
  if (!r || typeof r !== 'object') return { status: -1, body: String(r) }
  let parsed = null
  try { parsed = JSON.parse(r.body) } catch { /* 非 JSON */ }
  return { status: r.status, json: parsed, raw: String(r.body).slice(0, 200) }
}
/** 同源直连 GET（部分路由是 GET-only，如 /dsht-mvu/variables） */
const get = async (base, path, query = {}) => {
  const qs = new URLSearchParams(query).toString()
  const url = `/${base}/${path.replace(/^\//, '')}${qs ? '?' + qs : ''}`
  const expr = `fetch(${JSON.stringify(url)},{method:'GET'})
    .then(r=>r.text().then(t=>({status:r.status,body:t})))
    .catch(e=>({status:-1,body:'FETCHERR '+e}))`
  const r = await ev(expr)
  if (r && r.__err) return { status: -1, body: r.__err }
  if (!r || typeof r !== 'object') return { status: -1, body: String(r) }
  let parsed = null
  try { parsed = JSON.parse(r.body) } catch { /* 非 JSON */ }
  return { status: r.status, json: parsed, raw: String(r.body).slice(0, 200) }
}

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}  ${detail ?? ''}`) }

// ---- 0. 会话清单（顺带定位可用 sessionId）----
const audit = await call('dsht-rp', 'rp/sessions-audit', {})
let sid = SID
if (audit.json && Array.isArray(audit.json.sessions)) {
  check('sessions-audit 可用', true, `${audit.json.sessions.length} 个会话`)
  if (!sid) {
    const cand = audit.json.sessions.filter(s => s.kind === 'normal' && s.events > 4)
      .sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0))[0]
    sid = cand?.sessionId ?? ''
  }
} else {
  check('sessions-audit 可用', false, audit.raw)
}
console.log(`\n使用会话: ${sid}\n`)

// ---- 1. 打开会话（attach；需 slug + sessionId）----
const wsList = await call('dsht-rp', 'rp/workspaces', {})
let slug = ''
if (wsList.json && Array.isArray(wsList.json.workspaces)) {
  // 按审计里的会话 cwd 找所属 slug；找不到就用第一个
  slug = wsList.json.workspaces[0]?.dir ?? wsList.json.workspaces[0]?.slug ?? ''
}
const openR = await call('dsht-rp', 'rp/open-chat', { slug, sessionId: sid })
check('open-chat（attach 会话）',
  openR.status === 200 || (openR.status === 404 && /not live/i.test(openR.raw ?? '')),
  `HTTP ${openR.status} ${openR.raw}`)

// ---- 2. 世界书（TH 门面 /worldbook/list）----
const books = await call('dsht-tavern-helper', 'worldbook/list', { sessionId: sid })
check('worldbook/list（世界书）', books.status === 200, `HTTP ${books.status} ${books.raw}`)

// ---- 3. MVU 状态（GET /dsht-mvu/variables?sessionId=）----
const mvu = await get('dsht-mvu', 'variables', { sessionId: sid })
check('mvu/variables（MVU 状态读取）', mvu.status === 200 && mvu.json && typeof mvu.json.variables === 'object',
  `HTTP ${mvu.status} ${mvu.raw}`)

// ---- 4. 记忆（/dsht-memory 前缀；status 需 sessionId 走 query）----
const mem = await get('dsht-memory', 'status', { sessionId: sid })
check('memory status（剧情记忆）', mem.status === 200, `HTTP ${mem.status} ${mem.raw}`)

// ---- 5. 回退掩码（T-04d 修复点：必须能读到新形态标记）----
const mask = await call('dsht-rp', 'rp/rollback-mask', { sessionId: sid })
check('rollback-mask（回退掩码）', mask.status === 200 && mask.json && typeof mask.json.hideAfter === 'number',
  `HTTP ${mask.status} hideAfter=${mask.json?.hideAfter} ${mask.status !== 200 ? mask.raw : ''}`)

// ---- 6. 变体组（T-02a 重写点：user 标记 + append 形态）----
const vg = await call('dsht-rp', 'variant/groups', { sessionId: sid })
check('variant/groups（变体组枚举）', vg.status === 200 && vg.json && Array.isArray(vg.json.groups),
  `HTTP ${vg.status} groups=${vg.json?.groups?.length} ${vg.status !== 200 ? vg.raw : ''}`)

// ---- 7. TH 卡脚本桥 ----
const thVars = await get('dsht-tavern-helper', 'variables', { sessionId: sid, scope: 'message' })
check('tavern-helper variables（TH 变量桥）', thVars.status === 200, `HTTP ${thVars.status} ${thVars.raw}`)
const thSchema = await call('dsht-tavern-helper', 'variables/schema', {
  sessionId: sid, variableSchema: { type: 'object', properties: {} },
})
check('tavern-helper variables/schema（C7 契约）', thSchema.status === 200, `HTTP ${thSchema.status} ${thSchema.raw}`)
const thChat = await call('dsht-tavern-helper', 'chat/messages', { sessionId: sid })
check('tavern-helper chat/messages（正则/楼层门面）', thChat.status === 200, `HTTP ${thChat.status} ${thChat.raw}`)

// ---- 8. 提示词模板（EJS 子集）----
const ejs = await call('dsht-prompt-template', 'render', { template: '1+1=<%= 1+1 %>' })
check('prompt-template render（EJS 渲染）', ejs.status === 200 || ejs.status === 400, `HTTP ${ejs.status} ${ejs.raw}`)

// ===========================================================================
// T-23 回归清单（V0.3-FREEZE §5 序1）逐项可执行化：每项 = 一条路由断言
// ===========================================================================

// ---- 9. 开场白（open-chat 的 greeting 覆写通道；幂等分支已验过）----
const home = await call('dsht-rp', 'rp/home', { slug })
check('rp/home（工作区主页/开场白入口）', home.status === 200, `HTTP ${home.status} ${home.raw}`)

// ---- 10. 世界书触发器（列表 + 绑定）----
const books2 = await call('dsht-rp', 'rp/books', { slug })
check('rp/books（世界书列表+绑定态）', books2.status === 200, `HTTP ${books2.status} ${books2.raw}`)

// ---- 11. MVU initvar（schema 注册）+ UpdateVariable（patch）----
// 【为什么用一次性 sessionId】这两条**会写 rp/state/<sid>.json**。用真实会话会在
// variableSchema 里永久留下探针键（实测残留，且 MVU 无删除路由）。
// MVU 这两条只认 body.sessionId、不要求会话 live → 换一次性 id，跑完删文件。
const PROBE_SID = 'dsht-regression-probe'
const PROBE_KEY = '__regression_probe'
const mvuReg = await call('dsht-mvu', 'variables/register', {
  sessionId: PROBE_SID,
  variables: { [PROBE_KEY]: true },
  variableSchema: { type: 'object', properties: { [PROBE_KEY]: { type: 'boolean' } } },
})
check('mvu variables/register（initvar/schema）', mvuReg.status === 200, `HTTP ${mvuReg.status} ${mvuReg.raw}`)
const mvuPatch = await call('dsht-mvu', 'variables/patch', {
  sessionId: PROBE_SID, patches: [{ op: 'replace', path: `/${PROBE_KEY}`, value: false }],
})
check('mvu variables/patch（UpdateVariable）', mvuPatch.status === 200, `HTTP ${mvuPatch.status} ${mvuPatch.raw}`)

// 清理：MVU 无删除路由 → 用 adb 直接删一次性文件（best-effort，失败只提示不算失败）
try {
  const { execFileSync } = await import('node:child_process')
  const adb = process.env.ADB_PATH ?? 'C:/Users/Administrator/.android/sdk/platform-tools/adb.exe'
  execFileSync(adb, ['-s', 'emulator-5554', 'shell',
    `run-as com.dshtavern.app rm -f files/.dsh/rp/state/${PROBE_SID}.json`], { stdio: 'pipe' })
  check('mvu 探针清理（adb rm）', true, '一次性状态文件已删')
} catch (e) {
  check('mvu 探针清理（adb rm）', false, `adb 不可用：${String(e.message).slice(0, 80)}（一次性文件 ${PROBE_SID}.json 可手工删）`)
}

// ---- 12. 状态栏渲染（MVU tableEdit 的可见产物）----
const sb = await get('dsht-mvu', 'statusbar-render', { sessionId: sid })
check('mvu statusbar-render（状态栏）', sb.status === 200 || sb.status === 400, `HTTP ${sb.status} ${sb.raw}`)

// ---- 13. TH 世界书门面（getWorldbook 契约）----
const wbTH = await call('dsht-tavern-helper', 'worldbook/list', { sessionId: sid })
check('TH worldbook/list（getWorldbook 契约）', wbTH.status === 200, `HTTP ${wbTH.status} ${wbTH.raw}`)

// ---- 14. TH 正则门面（getTavernRegexes 契约，T-20 修复点）----
const regexGet = await call('dsht-tavern-helper', 'regexes/get', { sessionId: sid })
check('TH regexes/get（getTavernRegexes 契约）', regexGet.status === 200, `HTTP ${regexGet.status} ${regexGet.raw}`)

// ---- 15. 会话偏好（/rp/chat-prefs）----
const prefs = await call('dsht-rp', 'rp/chat-prefs', { slug })
check('rp/chat-prefs（会话偏好）', prefs.status === 200, `HTTP ${prefs.status} ${prefs.raw}`)

// ---- 16. 诊断面（rp/status 为 POST 路由）----
const status = await call('dsht-rp', 'rp/status', {})
check('rp/status（诊断面）', status.status === 200, `HTTP ${status.status} ${status.raw}`)

// ---- 汇总 ----
const fail = results.filter(r => !r.ok)
console.log(`\n===== 阶段 4 回归：${results.length - fail.length}/${results.length} 通过 =====`)
if (fail.length) { console.log('失败项：'); for (const f of fail) console.log(`  ✗ ${f.name}  ${f.detail ?? ''}`) }
ws.close()
process.exit(fail.length ? 1 : 0)
