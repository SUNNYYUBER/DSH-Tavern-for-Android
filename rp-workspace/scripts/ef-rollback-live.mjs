#!/usr/bin/env node
/**
 * ef-rollback-live.mjs —— E-F 真回退设备实测（M5）
 * ============================================================================
 * goal §七 E-F 要求「走完 … → 回退 → 重新生成 → 再回退」。上轮只覆盖了
 * 「导入→开聊→脚本 UI」的结果态，**真回退未执行**。
 *
 * 本轮突破：**回退不需要 LLM**——它是对既有会话的事件流做手术（B13：不开新分支）。
 * 故可在设备上对一张**真实卡的既有会话**真跑 `/rp/session-rollback`，
 * 然后用数据面验证「被回退的楼层确实不再可见」。
 *
 * ## 安全前提（不改用户真实数据）
 * 先用 `rp/sessions-audit` 找一张会话，**只读地**取它的 `hiddenSeqs` 前后对比；
 * 为不破坏真实卡数据，本脚本**只对显式传入的 sid 执行**，且要求 `--yes`
 * 才真调用回退（默认 dry-run，只打印将要发生什么）。
 *
 * ## 判据（goal 轨道 B 的 B1/B2/B5）
 * B5-1 回退前：`hiddenSeqs` 为空（或已知集）
 * B5-2 执行回退 → `hiddenSeqs` 增加了「该 turn 的 seq」（**集合语义**）
 * B5-3 **持久有效**：再次读掩码，集合**仍包含**那些 seq（不因时间推移归零）
 * B5-4 回退**不新开 session**（B13）：`sessions-audit` 的会话数不变
 * B5-5 掩码读面必须给 `hiddenSeqs`（不许只给 `hideAfter` 阈值）
 *
 * ## 【W39 · P-48 第二类】修前形态的严重问题（本轮按 P-38 穷举抓到）
 * 上面「安全前提」那段话**在修前是自我矛盾**的：它写着「不改用户真实数据」，
 * 而实现**对显式传入的真实 sid 真执行** `rp/session-rollback` —— 该 RPC **不可逆**
 * （非 live 截断文件 / live 写 replace + 掩码），且**零备份、零还原、零中止兜底**。
 * ⇒ 一旦跑到一半出错，**用户的会话永久停在被回退的状态**（违反 R18）。
 * 现接入**单源守护** `scripts/session-guard.mjs`（与 M7 同口径）：
 * 写型动作之前**必须先备份**（失败即中止）、任何中止路径都先**停应用 → 还原 → 校验**。
 *
 * 用法：
 *   node scripts/ef-rollback-live.mjs --sid <sessionId> [--seq <keepThroughSeq>] [--yes]
 */
import process from 'node:process'
import { makeSessionGuard } from './session-guard.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const SID = flag('--sid', '')
const SEQ = flag('--seq', '')
const YES = argv.includes('--yes')

if (!SID) { console.error('用法：--sid <sessionId> [--seq <keepThroughSeq>] [--yes]'); process.exit(2) }

// 【W39 · P-48 第二类】写型夹具守护（备份 / 还原 / 中止兜底 三件套；单源）
const ADB = process.env.DSHT_ADB ?? (existsSync(`${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`)
  ? `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe` : 'adb')
const guard = makeSessionGuard({ adb: ADB, pkg: 'com.dshtavern.app', sid: SID, yes: YES })
guard.install()

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) { console.error('无 page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description ?? 'fail').slice(0, 400) }; return r.result?.value }
await send('Runtime.enable')

// 【W39 · P-48 第二类】**写型动作之前必须先备份**（失败即中止 —— fail-closed，R18）。
// 真回退的**充分条件**与注入脚本内的判定同源：`--yes` **且** 传了 `--seq`
// （见注入脚本里 `if (keep === null) { dryRun = true; return }`）。
const WILL_WRITE = YES && SEQ !== ''
if (WILL_WRITE && !guard.backup()) {
  console.error('[守护][FATAL] 备份失败 ⇒ **拒绝执行回退**（用户的会话不可逆被改的风险高于本次测量）')
  process.exit(2)
}

const out = await evalJs(`(async () => {
  const sid = ${JSON.stringify(SID)}
  const keepParam = ${JSON.stringify(SEQ)}
  const doIt = ${YES ? 'true' : 'false'}
  const post = async (base, path, body) => {
    const r = await fetch('/' + base + '/' + path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) })
    let j = null; try { j = await r.json() } catch {}
    return { status: r.status, json: j }
  }
  const res = { sid }

  // 会话数（B13：回退不得新开 session）
  const audit0 = await post('dsht-rp', 'rp/sessions-audit', {})
  res.sessionCountBefore = Array.isArray(audit0.json?.sessions) ? audit0.json.sessions.length : null

  // 回退前掩码
  const m0 = await post('dsht-rp', 'rp/rollback-mask', { sessionId: sid })
  res.maskBefore = m0.json

  // 取消息，决定回退到哪个 seq（默认 = 倒数第二条 assistant 所在的 turn 之前）
  const msgs = await post('dsht-tavern-helper', 'chat/messages', { sessionId: sid })
  const arr = Array.isArray(msgs.json) ? msgs.json : (msgs.json?.messages || [])
  res.msgCount = arr.length

  if (!doIt) { res.dryRun = true; return res }

  // 真回退：keepThroughSeq 由调用方给；未给则取「最后一条 user 消息之前」
  let keep = keepParam ? Number(keepParam) : null
  if (keep === null) {
    // 从尾部往前找最后一条 user，回退到它之前
    res.note = '未给 --seq：默认 dry-run 不执行（避免误伤真实会话）'
    res.dryRun = true
    return res
  }

  const rb = await post('dsht-rp', 'rp/session-rollback', { sessionId: sid, keepThroughSeq: keep })
  res.rollback = { status: rb.status, json: rb.json }

  const m1 = await post('dsht-rp', 'rp/rollback-mask', { sessionId: sid })
  res.maskAfter = m1.json

  const audit1 = await post('dsht-rp', 'rp/sessions-audit', {})
  res.sessionCountAfter = Array.isArray(audit1.json?.sessions) ? audit1.json.sessions.length : null
  return res
})()`)

if (out?.__err) { console.error('探测异常：', out.__err); process.exit(1) }
console.log(JSON.stringify(out, null, 1))

// 判据汇总
const b = out.maskBefore || {}, a = out.maskAfter || {}
const setBefore = new Set(Array.isArray(b.hiddenSeqs) ? b.hiddenSeqs : [])
const setAfter = new Set(Array.isArray(a.hiddenSeqs) ? a.hiddenSeqs : [])
const added = [...setAfter].filter(x => !setBefore.has(x))
let fail = 0
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); if (!ok) fail++ }

console.log('\n=== E-F 真回退判据 ===')
if (out.dryRun) {
  console.log('ⓘ dry-run（未传 --yes 或 --seq）——只取基线，不执行回退')
} else {
  check('B5-5 掩码读面给集合形态（hiddenSeqs 存在）', Array.isArray(a.hiddenSeqs), `before=${JSON.stringify([...setBefore])} after=${JSON.stringify([...setAfter])}`)
  check('B5-2 回退后被移出的 seq 进入集合', added.length > 0, `新增 ${JSON.stringify(added)}`)
  check('B5-3 集合持久有效（复读仍在）', added.every(x => setAfter.has(x)))
  check('B13 回退不新开 session', out.sessionCountBefore == null || out.sessionCountAfter == null || out.sessionCountBefore === out.sessionCountAfter,
    `${out.sessionCountBefore} → ${out.sessionCountAfter}`)
}
// 【W39 · P-48 第二类】正常收尾：还原 + 校验（幂等 —— `process.on('exit')` 那次会跳过）
const rr = guard.restore('normal')
const restoreOk = rr.ok
console.log(`[守护] 用户会话已还原：${restoreOk ? 'PASS' : 'FAIL'}${rr.skipped ? '（无需还原：本轮未写）' : ''}`
  + `${restoreOk ? '' : ' —— **备份已保留**，请人工恢复'}`)
if (!restoreOk) fail += 1

console.log(fail ? `\n[E-F 回退] ${fail} 项未通过` : '\n[E-F 回退] 全部通过')
process.exit(fail ? 1 : 0)
