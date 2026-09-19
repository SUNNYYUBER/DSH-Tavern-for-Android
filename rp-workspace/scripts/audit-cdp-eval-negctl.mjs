/**
 * audit-cdp-eval-negctl.mjs —— 判据 7（探针 CDP 求值单源）的**真实仓库负控**
 * =====================================================================
 * 【为什么必须常驻（B11：不许为了让报告好看而放宽判据）】
 *   `audit-impl-duplication.mjs` 的**判据 7** 首版口径过宽 —— 「任何同时出现
 *   `webSocketDebuggerUrl` + `Runtime.evaluate` 的文件」—— 一次报出 **80 处**假红，
 *   把 `cdp-boot` / `dsht-*` / `hb*` 这些**各自独立的一次性调试脚本**全算成违规。
 *   按 **P-38**：「过宽 ⇒ 大量假红，而假红会**训练人忽略报警**（比漏报更危险）」
 *   ⇒ 收窄为「**函数体逐字重复**」（同一指纹出现在 ≥2 个文件）。
 *
 *   但收窄后跑真实仓库得 **0 处** —— 而「0 处」有两种含义，**必须用实验分辨**：
 *     ① 重复真的已被收口（好）
 *     ② **判据收窄过头、抓不到了**（坏，等于把判据改废 —— 正是 B11 禁止的「放宽」）
 *   （P-30：对静态判据来说，「真实仓库 0 命中」是 **0 信息量**。）
 *
 * 【本脚本做什么】
 *   ① 起点基线：注入前门禁必须 exit 0（否则后面的「报红」不能归因于注入）；
 *   ② 往 `scripts/` 写两份**真实同形**的 `ev()` ⇒ 门禁**必须报红**，
 *      且**精确指向**那两个文件、**恰好 1 组**（证明没有把 80 处老口径报回来）；
 *   ③ 删除 ⇒ 门禁**必须回绿**（证明不是「恒报红」）；
 *   ④ **清理并逐项校验**（不留残留 —— 本脚本会写仓库，必须自证复原）。
 *
 * 用法：node scripts/audit-cdp-eval-negctl.mjs   （退出码 0 = PASS；1 = 有断言失败）
 *                                              ★ W76 修：原只写「0 = PASS」而实现是
 *                                                `fail === 0 ? 0 : 1` ⇒ 补 1（P-75 双向）
 */
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = join(import.meta.dirname, '..')
const SCRIPTS = join(import.meta.dirname)
const AUDIT = join(SCRIPTS, 'audit-impl-duplication.mjs')

/**
 * 「已知形态」样本：与 W30 实测到的那两份真实拷贝**同形**
 * （取自 `ef-touch-targets.mjs` / `ef-font-scale.mjs` 收口前的实现）。
 * ★ 此处只是**样本**，不代表任何现役文件 —— 现役两份都已改为 `import { makeEv }`。
 */
const REAL_EV_BODY = `
  let lastErr = null
  for (let i = 0; i < tries; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
      const page = targets.find(t => t.type === 'page')
      if (!page) { await sleep(gap); continue }
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      let n = 0; const pend = new Map()
      const send = (m, p = {}) => new Promise((res, rej) => { const id = ++n; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
      ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
      await send('Runtime.enable')
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      ws.close()
      if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 300))
      return r.result?.value
    } catch (e) { lastErr = e; await sleep(gap) }
  }
  throw new Error('CDP 求值失败（已重试 ' + tries + ' 次）：' + String(lastErr?.message ?? lastErr))`

const A = join(SCRIPTS, '__negctl-a.mjs')
const B = join(SCRIPTS, '__negctl-b.mjs')

const runAudit = () => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 90000 }) }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

let fail = 0
let total = 0
const check = (ok, label, extra = '') => {
  total++
  console.log(`${ok ? '[ok] ' : '[FAIL]'} ${label}${extra ? '  — ' + extra : ''}`)
  if (!ok) fail++
}

console.log('=== audit-cdp-eval-negctl：判据 7 的真实仓库负控 ===')
try {
  const before = runAudit()
  check(before.code === 0, '步骤0（起点基线）：注入前门禁 exit 0', `exit=${before.code}`)

  writeFileSync(A, `async function ev (expr, tries) {${REAL_EV_BODY}\n}\n`, 'utf8')
  writeFileSync(B, `async function ev (expr, tries) {${REAL_EV_BODY}\n}\n`, 'utf8')
  const bad = runAudit()
  const mentionsA = bad.out.includes('__negctl-a.mjs')
  const mentionsB = bad.out.includes('__negctl-b.mjs')
  check(bad.code !== 0, '负控1（判别力）：注入两份真实同形 ev() ⇒ 门禁报红', `exit=${bad.code}`)
  check(mentionsA && mentionsB, '负控1b：报出的组**精确指向**那两个文件', `a=${mentionsA} b=${mentionsB}`)
  const grp = /判据7：(\d+) 组/.exec(bad.out)
  check(grp && grp[1] === '1', '负控1c：恰好报 1 组（不是把「80 处」老口径又报回来）', `实得 ${grp ? grp[1] : 'n/a'} 组`)

  unlinkSync(A); unlinkSync(B)
  const after = runAudit()
  check(after.code === 0, '负控2（无残留）：删除后门禁回绿', `exit=${after.code}`)
  check(!after.out.includes('__negctl'), '负控2b：输出中不再出现临时文件名', '')
} finally {
  for (const f of [A, B]) { try { if (existsSync(f)) unlinkSync(f) } catch {} }
  const clean = [A, B].every(f => !existsSync(f))
  check(clean, '清理：临时文件已删除（本脚本会写仓库，必须自证复原）', '')
}

console.log(`\n[cdp-eval negctl] ${fail === 0 ? 'PASS' : 'FAIL'}（${fail} 项失败）`)
// ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
reportSelftest('cdp-eval-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
