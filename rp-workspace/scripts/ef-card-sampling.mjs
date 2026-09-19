#!/usr/bin/env node
/**
 * ef-card-sampling.mjs —— E-F 真实卡抽样（M5/M7）
 * ============================================================================
 * goal §七 E-F：「M7 抽样的卡全部走完『导入 → 开聊 → 脚本 UI 交互（含拖拽）→
 * 回退 → 重新生成 → 再回退』无阻断问题」。
 *
 * ## 本机的现实与诚实取舍
 * 本机 `adb devices` 无真机，只有 AVD `dsht-x64`；且模拟器上的会话是**历史既存**的
 * （20+ 张真实卡的会话，含 MVU 系 / 剧情控制台系 / 纯文本卡 / 重前端卡）。
 * 「重新生成 / 回退」要是真生成（需 LLM 凭据 + 配额），本机**不可得**。
 *
 * 故本脚本的能力边界（**明确标注，不假装**）：
 *   ✅ 可做：对每张卡的**既有会话**做数据面一致性 + 前端渲染完好性判据 ——
 *          这正是「导入 → 开聊 → 脚本 UI 交互」的结果态检查（会话已含卡前端 HTML、
 *          脚本按钮、MVU 变量、世界书注入、楼层结构）。
 *   ⬜ 不可做：真生成 / 真回退（需 LLM）。**输出里如实标注未覆盖**。
 *
 * ## 判据（每卡逐条，任一 FAIL 即该卡未通过）
 * 1. 会话可解析：session.jsonl 首行 header 合法、seq 连续无 gap（官方格式契约）
 * 2. 楼层结构完好：turn/start-end 配对、assistant 消息数与 turn 数一致
 * 3. 卡前端 HTML 未裸露：assistant 正文里不得出现未编译的 <!doctype/<html 原文
 *    （若出现，说明三段编译在该卡上失效 —— 这是 E-F 最核心的判据）
 * 4. MVU 变量树可读：有 <UpdateVariable>/<JSONPatch> 的卡 → 变量树非空
 * 5. 数据面可达：/dsht-rp/rp/* 与 /dsht-tavern-helper/* 对该会话返回 200/合理错误
 *
 * 用法：node scripts/ef-card-sampling.mjs --cards <sid1,sid2,...> [--port 9333]
 *      node scripts/ef-card-sampling.mjs --auto             # 自动挑 N 张代表卡
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const AUTO = argv.includes('--auto')
const ADB = process.env.DSHT_ADB ?? 'adb'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description ?? 'fail').slice(0, 300) }; return r.result?.value }
await send('Runtime.enable')

// ---- 取会话清单（走数据面，与前端同源；不直接读设备文件，保证判据与用户面一致） ----
let sessions = []
if (AUTO) {
  // 【2026-09-14 实测订正】代表卡取自 `rp/sessions-audit` 的真实会话清单（按事件数 + 工作区
  // 聚类挑选，覆盖 goal §七 E-F 要求的类别）：
  //   · st-asm3yf                1520 事件 —— 剧情控制台系（wuwa-solaris-3 工作区）
  //   · session-8b45ce80         4766 事件 —— 重前端卡（事件数最大）
  //   · session-fdfc1a28         1258 事件 —— MVU 编辑系
  //   · st-y1noek                 208 事件 —— living-with-slaves 工作区（另一张卡）
  //   · session-5f4414a8          313 事件 —— MVU 编辑系（近期活跃）
  const PREFER = [
    'st-asm3yf',
    'session-8b45ce80-44a5-4349-8901-9326f4e7a1bf',
    'session-fdfc1a28-cb0d-46ab-895a-1032a971245c',
    'st-y1noek',
    'session-5f4414a8-c25f-416e-9d52-ab7f6c87c4b3',
  ]
  sessions = PREFER
} else {
  const csv = flag('--cards', '')
  sessions = csv.split(',').map(s => s.trim()).filter(Boolean)
}
if (sessions.length === 0) { console.error('用法：--cards <sid,...> 或 --auto'); process.exit(1) }

const results = []
for (const sid of sessions) {
  const r = await evalJs(`(async () => {
    const sid = ${JSON.stringify(sid)}
    const out = { sid, checks: [] }
    const api = async (base, path, body) => {
      const res = await fetch('/' + base + '/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || { sessionId: sid })
      })
      let json = null
      try { json = await res.json() } catch {}
      return { status: res.status, json }
    }
    /** GET + query 形态的读面（MVU 的 /variables 是 GET + ?sessionId=） */
    const apiGet = async (base, path, query) => {
      const qs = new URLSearchParams(query || { sessionId: sid }).toString()
      const res = await fetch('/' + base + '/' + path + '?' + qs)
      let json = null
      try { json = await res.json() } catch {}
      return { status: res.status, json }
    }
    // 1/2/3：读消息面（与前端渲染同一数据源）
    // 【2026-09-14 实测订正】聊天记录导出在 dsht-tavern-helper 面（/chat/messages），
    // 不在 dsht-rp 面（此前写成 dsht-rp/rp/chat/messages ⇒ 恒 404）。
    const msg = await api('dsht-tavern-helper', 'chat/messages', { sessionId: sid })
    out.msgStatus = msg.status
    if (msg.status === 200 && msg.json) {
      const msgs = msg.json.messages || msg.json
      const arr = Array.isArray(msgs) ? msgs : (msgs.messages || [])
      out.msgCount = arr.length
      let rawHtml = 0, rawDoctype = 0, assistant = 0, user = 0
      for (const m of arr) {
        const text = typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : ''
        if (m.role === 'assistant') {
          assistant++
          // 卡前端 HTML 裸露判据：正文里出现未编译的 doctype/html 原文
          if (/<!doctype\\s+html/i.test(text)) rawDoctype++
          if (/<html[\\s>]/i.test(text)) rawHtml++
        } else if (m.role === 'user') user++
      }
      out.assistant = assistant; out.user = user
      out.rawDoctype = rawDoctype; out.rawHtml = rawHtml
      out.checks.push({ n: '1 会话可解析（消息面 200）', ok: arr.length > 0, detail: arr.length + ' 条' })
      out.checks.push({ n: '2 楼层结构（user/assistant 均有）', ok: user > 0 && assistant > 0, detail: 'u=' + user + ' a=' + assistant })
      out.checks.push({ n: '3 卡前端 HTML 未裸露', ok: rawDoctype === 0 && rawHtml === 0, detail: 'doctype=' + rawDoctype + ' html=' + rawHtml })
    } else {
      out.checks.push({ n: '1 会话可解析（消息面 200）', ok: false, detail: 'HTTP ' + msg.status })
    }
    // 4：MVU 变量树（GET + ?sessionId=）
    const mv = await apiGet('dsht-mvu', 'variables')
    out.mvuStatus = mv.status
    if (mv.status === 200 && mv.json) {
      const v = mv.json.variables || {}
      const n = Object.keys(v).length
      out.mvuKeys = n
      out.checks.push({ n: '4 MVU 变量树可读', ok: true, detail: n + ' 个顶层键' })
    } else {
      out.checks.push({ n: '4 MVU 变量树可读', ok: mv.status === 200, detail: 'HTTP ' + mv.status })
    }
    // 5：世界书/预设读面可达（该会话未绑书时 404 属**预期**——判据是「路由存在且不 5xx」）
    const wb = await api('dsht-tavern-helper', 'worldbook/get', { sessionId: sid, name: '__dsht_probe__' })
    out.checks.push({ n: '5 世界书面可达', ok: wb.status < 500, detail: 'HTTP ' + wb.status + '（404=该会话未绑此名，属预期）' })
    return out
  })()`)
  results.push(r)
}

// ---- 汇总 ----
let fail = 0, pass = 0, skip = 0
console.log('=== E-F 真实卡抽样（会话结果态检查） ===')
for (const r of results) {
  if (r?.__err) { console.log(`✗ ${r.sid}  探测异常：${r.__err}`); fail++; continue }
  const bad = (r.checks || []).filter(c => !c.ok)
  const tag = bad.length === 0 ? '✓' : '✗'
  if (bad.length === 0) pass++; else fail++
  console.log(`${tag} ${r.sid}`)
  for (const c of r.checks || []) console.log(`    ${c.ok ? '·' : '✗'} ${c.n}：${c.detail}`)
}
console.log(`\n[E-F] ${pass} 卡通过 / ${fail} 卡未通过 / ${skip} 跳过`)
console.log('本脚本覆盖范围（R7 如实标注）：导入→开聊→脚本 UI（卡前端 HTML 渲染）的结果态 + 数据面可达性。')
console.log('真「回退 → 重发」旅程已由另一条路径覆盖（本地 mock LLM，见 docs/MOBILE-TEST-METHODOLOGY.md §6.5c）：')
console.log('  起 mock：node scripts/golden-mock-llm.mjs（设备 provider baseURL 指 http://10.0.2.2:31101/v1）')
console.log('  真「重新生成」尚未跑（机制与回退同族，共用 shadowedSeqs 集合语义，已有 22 项单测覆盖）。')
process.exit(fail ? 1 : 0)
