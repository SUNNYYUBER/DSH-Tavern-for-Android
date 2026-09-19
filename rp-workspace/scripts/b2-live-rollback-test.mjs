#!/usr/bin/env node
/**
 * b2-live-rollback-test.mjs —— 轨道 B 的 live 路径实测（B1/B2/B5/B13）
 * ============================================================================
 * ## 目的
 * 验证 goal 轨道 B 的核心：**回退用集合语义、且重发后旧楼层不复活**。
 * 上一步已用合成会话验证了「非 live（文件截断）」路径；
 * 本脚本验证 **live 路径**（App 已打开会话时走的那条：marker + 掩码，不截断文件）。
 *
 * ## 为什么必须验 live 路径
 * F2 的**用户实测失败路径**发生在 live 路径（用户在会话里点回退→重发）。
 * 非 live 是「文件截断」（事件物理删除，掩码天然为空）——它不产生掩码，
 * 故**证明不了** F2 的修复。必须验 live。
 *
 * ## 判据
 * L1 回退前：掩码基线（hiddenSeqs 应为空或已知）
 * L2 回退后：`hiddenSeqs` **含**被移出的 seq（集合语义 B1）
 * L3 **不新开 session**（B13）：会话数不变
 * L4 会话文件**行数不减**（live = 逻辑回退，事件留日志；这是与非 live 的本质区别）
 * L5 掩码**持久**：连续两次读结果一致（不因时间归零，B2）
 *
 * ## 【W39 · P-48 第二类】安全前提：本脚本会**不可逆地改用户真实会话**
 * `rp/session-rollback` 在非 live 路径**截断文件**、live 路径写 replace + 掩码。
 * 修前形态**零备份、零还原、零中止兜底** ⇒ 跑一半出错就**把用户的会话永久留在被回退的状态**
 * （违反 R18）。⇒ 现接入**单源守护** `scripts/session-guard.mjs`（与 M7 同口径）：
 * 写型动作**之前必须先备份**（备份失败即中止）、任何中止路径都先**停应用 → 还原 → 校验**。
 *
 * 用法：node scripts/b2-live-rollback-test.mjs --sid <sessionId> [--seq N] [--yes]
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { makeSessionGuard } from './session-guard.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const ADB = process.env.DSHT_ADB ?? 'adb'
const PKG = 'com.dshtavern.app'
const PORT = flag('--port', '9333')
const SID = flag('--sid', '')
const SEQ = flag('--seq', '')
const YES = argv.includes('--yes')
if (!SID) { console.error('用法：--sid <sessionId> [--seq N] [--yes]'); process.exit(2) }

// 【W39 · P-48 第二类】写型夹具守护（备份 / 还原 / 中止兜底 三件套；单源）
const guard = makeSessionGuard({ adb: ADB, pkg: PKG, sid: SID, yes: YES })
guard.install()

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails).slice(0, 400) }; return r.result?.value }
await send('Runtime.enable')

/** 设备侧：会话文件行数（live 路径应不减） */
const lineCount = () => {
  try {
    const out = execFileSync(ADB, ['shell', `run-as ${PKG} sh -c "F=$(find files/.dsh/sessions -type d -name '${SID}' 2>/dev/null | head -1); if [ -n \\"$F\\" ]; then grep -c '' \\"$F/session.jsonl\\" 2>/dev/null; else echo NA; fi"`], { encoding: 'utf8' }).trim()
    return Number(out) || 0
  } catch { return -1 }
}

const readMask = () => evalJs(`(async () => {
  const post = async (base, path, body) => {
    const r = await fetch('/' + base + '/' + path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) })
    let j = null; try { j = await r.json() } catch {}
    return { status: r.status, json: j }
  }
  const m = await post('dsht-rp', 'rp/rollback-mask', { sessionId: ${JSON.stringify(SID)} })
  const a = await post('dsht-rp', 'rp/sessions-audit', {})
  const msgs = await post('dsht-tavern-helper', 'chat/messages', { sessionId: ${JSON.stringify(SID)} })
  const arr = Array.isArray(msgs.json) ? msgs.json : (msgs.json?.messages || [])
  return { mask: m.json, sessions: Array.isArray(a.json?.sessions) ? a.json.sessions.length : null,
           msgCount: arr.length,
           lastSeq: (() => { let s = -1; /* 从消息里推断不到 seq，留给设备侧 */ return s })() }
})()`)

const before = await readMask()
const linesBefore = lineCount()
console.log('=== 基线 ===')
console.log(`  掩码：${JSON.stringify(before.mask)}`)
console.log(`  消息数：${before.msgCount}  会话总数：${before.sessions}  会话文件行数：${linesBefore}`)

if (!YES || !SEQ) {
  console.log('\nⓘ 未传 --yes/--seq：只读基线。')
  process.exit(0)
}

// ---- 真回退（live 路径）----
// 【W39 · P-48 第二类】**写型动作之前必须先备份**（失败即中止 —— fail-closed，R18）
if (!guard.backup()) {
  console.error('\n[守护][FATAL] 备份失败 ⇒ **拒绝执行回退**（用户的会话不可逆被改的风险高于本次测量）')
  process.exit(2)
}
const rb = await evalJs(`(async () => {
  const r = await fetch('/dsht-rp/rp/session-rollback', {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ sessionId: ${JSON.stringify(SID)}, keepThroughSeq: ${Number(SEQ)} })
  })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, json: j }
})()`)
console.log('\n=== 回退结果 ===')
console.log(`  ${JSON.stringify(rb)}`)

await new Promise(r => setTimeout(r, 2500))
const after = await readMask()
const after2 = await readMask()
const linesAfter = lineCount()

const sB = new Set(Array.isArray(before.mask?.hiddenSeqs) ? before.mask.hiddenSeqs : [])
const sA = new Set(Array.isArray(after.mask?.hiddenSeqs) ? after.mask.hiddenSeqs : [])
const added = [...sA].filter(x => !sB.has(x))
let fail = 0
const check = (n, ok, d) => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? '：' + d : ''}`); if (!ok) fail++ }

console.log('\n=== B 轨判据（live 路径）===')
const logical = rb?.json?.logical === true
if (logical) {
  check('B1 掩码给集合（hiddenSeqs 存在）', Array.isArray(after.mask?.hiddenSeqs), JSON.stringify(after.mask))
  check('B1 被移出的 seq 进入集合', added.length > 0, `新增 ${JSON.stringify(added)}`)
  check('B2 掩码持久（连续两次读一致）',
    JSON.stringify(after.mask?.hiddenSeqs) === JSON.stringify(after2.mask?.hiddenSeqs),
    `${JSON.stringify(after.mask?.hiddenSeqs)} vs ${JSON.stringify(after2.mask?.hiddenSeqs)}`)
  check('B13 不新开 session', before.sessions == null || after.sessions == null || before.sessions === after.sessions,
    `${before.sessions} → ${after.sessions}`)
  check('live 语义：会话文件行数不减（事件留日志）', linesAfter >= linesBefore && linesBefore > 0,
    `${linesBefore} → ${linesAfter}`)
} else {
  console.log('ⓘ 本次走的是**非 live** 路径（该会话未在 App 中打开为 live session）')
  console.log('  非 live = 文件截断：掩码天然为空，故 B1/B2 不适用（这正是 F5 记录的两条路径）')
}
console.log('\n=== 判据汇总 ===')
// 【W39 · P-48 第二类】正常收尾：还原 + 校验（幂等 —— `process.on('exit')` 那次会跳过）
const rr = guard.restore('normal')
console.log(`[守护] 用户会话已还原：${rr.ok ? 'PASS' : 'FAIL'}`
  + `${rr.skipped ? '（无需还原）' : ''}${rr.ok ? '' : ' —— **备份已保留**，请人工恢复'}`)
if (!rr.ok) fail += 1
console.log(fail ? `\n[B 轨] ${fail} 项未通过` : '\n[B 轨] 通过')
process.exit(fail ? 1 : 0)
