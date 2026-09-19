#!/usr/bin/env node
/**
 * audit-p47-negctl.mjs —— **P-47 闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么需要它（P-30：真实仓库「0 违规」是 0 信息量）
 * `audit-error-layer-classify.mjs` 在真实仓库上得 **0 违规** —— 既可能是
 * 「确实都分类了」（好），也可能是「**闸门收窄过头、抓不到了**」（坏，等于把判据改废，
 * 正是 **B11** 禁止的放宽判据）。**两者输出完全相同**（都是「0 违规」）。
 * ⇒ 必须用**注入实验**分辨：把 W34 修前的真实形态注入一个受检脚本 ⇒ 闸门**必须报红**；
 *   删除 ⇒ **必须回绿**；并**逐字节**自证还原（本脚本会写仓库，必须证明没留痕）。
 *
 * ## 注入什么（**取真实历史形态**，不是自造）
 * `ui-accept.mjs` 的**修前**写法：把所有 `Failed to load|corrupt|...` 一律当 `openError`，
 * 并用 `!out.openError` 当判定条件。注入方式：在受检脚本**末尾**追加一个
 * 「影子探针」函数片段（含旧形态的判定行），使闸门的静态扫描能看见该形态。
 *
 * ⚠️ 为什么**追加**而不是改写原文件：改写会破坏原文件的语法/语义（且还原风险高）；
 *    追加一段**独立且语法合法**的片段即可让**静态**闸门看到目标形态，
 *    而这正是本闸门所测的（它是**静态结构**判据，不执行被测脚本）。
 *
 * ## 退出码：0 = 负控通过（有杠杆 + 已还原）；1 = 失败
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = path.join(WS, 'scripts', 'audit-error-layer-classify.mjs')
// 选一个**受检**且**已合规**的脚本作为注入靶（它已满足 P-47，注入后应变为违规）
const TARGET = path.join(WS, 'scripts', 'ui-accept.mjs')

/** 跑闸门，返回 { code, out } */
const runGate = () => {
  try {
    const out = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** 注入的「修前形态」片段（真实历史写法；语法合法，独立于主机脚本逻辑） */
const INJECT = `
// ==== [P47 negctl] 临时注入：复现 **W34 修前**的真实形态（负控用，测完即删）====
function __p47NegctlLegacy (all) {
  const errish = all.map(e => (e.textContent || '').trim()).filter(t => /Failed to load|corrupt|invalid |打不开/.test(t))
  const openError = errish.length ? errish.slice(0, 3) : null
  const ok = !openError && all.length > 0
  return ok
}
`

let failed = 0
let total = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

const original = fs.readFileSync(TARGET, 'utf8')
const origBytes = Buffer.from(original, 'utf8')

try {
  // ---- 0) 起点基线：注入前闸门必须绿（否则后面的红不能归因于注入）----
  const base = runGate()
  t('0 起点基线：注入前闸门 exit 0', base.code === 0, `exit=${base.code}`)

  // ---- 1) 注入修前形态 ⇒ 必须报红，且**精确指向**该文件 ----
  fs.writeFileSync(TARGET, original + INJECT, 'utf8')
  const after = runGate()
  t('1 注入修前形态 ⇒ 闸门报红', after.code === 1, `exit=${after.code}`)
  t('1b 报红**精确指向**被注入的文件', /ui-accept\.mjs/.test(after.out), after.out.split('\n').filter(l => /✗/.test(l)).slice(0, 1).join(''))
  t('1c 指出缺的项（不是笼统报错）', /缺：/.test(after.out), after.out.split('\n').filter(l => /↳/.test(l)).slice(0, 2).join(' | '))

  // ---- 2) 删除注入 ⇒ 必须回绿（证明不是恒报红）----
  fs.writeFileSync(TARGET, original, 'utf8')
  const restored = runGate()
  t('2 删除注入 ⇒ 闸门回绿（证明不是恒报红）', restored.code === 0, `exit=${restored.code}`)

  // ---- 3) 清理自证：逐字节与原文件一致（本脚本会写仓库，必须证明没留痕）----
  const nowBytes = fs.readFileSync(TARGET)
  t('3 清理自证：逐字节还原一致', Buffer.compare(origBytes, nowBytes) === 0,
    Buffer.compare(origBytes, nowBytes) === 0 ? `${nowBytes.length} B` : `原 ${origBytes.length} B vs 现 ${nowBytes.length} B`)
} finally {
  // fail-safe：任何异常路径都要把原内容写回（否则会污染仓库）
  try { fs.writeFileSync(TARGET, original, 'utf8') } catch { /* ignore */ }
}

console.log(failed === 0
  ? '\n[p47-negctl] OK —— 闸门有杠杆（注入修前形态 ⇒ 报红；删除 ⇒ 回绿；逐字节还原）'
  : `\n[p47-negctl] ${failed} 项失败 —— 闸门可能已成「死判据」或收窄过头`)
reportSelftest('p47-negctl', total - failed, total)
process.exit(failed === 0 ? 0 : 1)
