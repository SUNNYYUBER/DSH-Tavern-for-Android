#!/usr/bin/env node
/**
 * audit-p48-negctl.mjs —— **P-48 闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么需要它（P-30：真实仓库「0 违规」是 0 信息量）
 * `audit-p48-rollback.mjs` 在真实仓库上得 **0 违规** —— 既可能是「装置确实都有回滚兜底」（好），
 * 也可能是「**闸门收窄过头、抓不到了**」（坏，等于把判据改废，正是 **B11** 禁止的放宽判据）。
 * **两者输出完全相同**（都是「0 违规」）。⇒ 必须用**注入实验**分辨。
 *
 * ## 注入什么（**取真实历史形态**，不是自造）
 * 靶子 = `ef-orientation.mjs`（W38 实测：它是 P-48 同类里**最后漏网**的那一处）。
 * 两组注入，各测不同判据项的杠杆：
 *   · **A 断线兜底**：把四个 `process.on(...)` 处理器体内的 `restoreOrientation()` 调用
 *     换成 `console.log('bye')` —— 即「**注册了处理器但没接线**」这一**最阴险**的形态：
 *     它看上去有五个 `process.on`（人眼一扫会以为兜底齐备），实际一次都不会还原。
 *     （首版闸门正是被这条负控证明有区分力：只匹配 `process.on('exit'` 字面量是不够的。）
 *   · **B 散落裸写**：追加一个「直接写设备设置、且无任何 dirty 登记包装」的函数
 *     —— 即 P-48 纪律②（写盘与登记必须同一处）的违规形态。
 * 每段之后**必须**：报红 + **精确指向**该文件 + 指出缺的哪一项；恢复后**必须回绿**；
 * 最后**逐字节**自证还原（本脚本会写仓库，必须证明没留痕）。
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
const AUDIT = path.join(WS, 'scripts', 'audit-p48-rollback.mjs')
const TARGET = path.join(WS, 'scripts', 'ef-orientation.mjs')

/** 跑闸门，返回 { code, out } */
const runGate = () => {
  try {
    const out = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * A 段注入：把四个中止处理器的**还原调用**断线（处理器本身保留 —— 这正是「假兜底」）。
 * 逐条精确替换（不用全局替换：全局替换会把**定义处** `function restoreOrientation(` 也改掉，
 * 那样报红形态会退化成「缺还原函数」，测不到「假兜底」这一条）。
 */
const BREAKS = [
  ["process.on('exit', () => { restoreOrientation('exit') })",
    "process.on('exit', () => { console.log('bye') })"],
  ["process.on(sig, () => { restoreOrientation(sig); process.exit(130) })",
    "process.on(sig, () => { console.log('bye'); process.exit(130) })"],
  ["restoreOrientation('uncaughtException')", "console.log('boom')"],
  ["restoreOrientation('unhandledRejection')", "console.log('boom')"],
]

/** B 段注入：散落裸写（无 dirty 登记包装的写设置函数，且无人以合规方式调用它） */
const SCATTERED = `
// ==== [P48 negctl] 临时注入：散落裸写（测完即删）====
function __p48NegctlScatteredWrite (v) {
  execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'user_rotation', String(v)], { timeout: 15000 })
}
`

let failed = 0
let total = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

const original = fs.readFileSync(TARGET, 'utf8')
const origBytes = Buffer.from(original, 'utf8')

/** 逐条替换；任一条锚点找不到即 fail-closed 报错（防「锚点失效后负控静默变假绿」） */
const applyBreaks = (src) => {
  let out = src
  for (const [from, to] of BREAKS) {
    if (!out.includes(from)) throw new Error(`[FATAL] 负控锚点未定位：${from.slice(0, 60)}（被测文件已改形态 ⇒ 负控必须重写，不许静默跳过）`)
    out = out.replace(from, to)
  }
  return out
}

try {
  // ---- 0) 起点基线：注入前闸门必须绿（否则后面的红不能归因于注入）----
  const base = runGate()
  t('0 起点基线：注入前闸门 exit 0', base.code === 0, `exit=${base.code}`)

  // ---- 1) A 段：断线兜底 ⇒ 必须报红，且精确指向 ----
  fs.writeFileSync(TARGET, applyBreaks(original), 'utf8')
  const afterA = runGate()
  t('1A 断线兜底（注册了处理器但体内不还原）⇒ 闸门报红', afterA.code === 1, `exit=${afterA.code}`)
  t('1A-b 报红精确指向被注入的文件', /ef-orientation\.mjs/.test(afterA.out), afterA.out.split('\n').filter(l => /✗/.test(l)).slice(0, 1).join(''))
  t('1A-c 指出缺的是「中止路径兜底 / 假兜底」（不是笼统报错）', /中止路径兜底/.test(afterA.out), afterA.out.split('\n').filter(l => /↳/.test(l)).slice(0, 1).join(''))

  // ---- 2) B 段：散落裸写 ⇒ 必须报红，且指出「写入口未登记」----
  fs.writeFileSync(TARGET, original + SCATTERED, 'utf8')
  const afterB = runGate()
  t('2B 散落裸写（无登记包装）⇒ 闸门报红', afterB.code === 1, `exit=${afterB.code}`)
  t('2B-b 指出「写入口未登记」（P-1 纪律②）', /写入口未登记/.test(afterB.out), afterB.out.split('\n').filter(l => /写入口未登记/.test(l)).slice(0, 1).join('').trim())

  // ---- 3) 删除注入 ⇒ 必须回绿（证明不是恒报红）----
  fs.writeFileSync(TARGET, original, 'utf8')
  const restored = runGate()
  t('3 删除注入 ⇒ 闸门回绿（证明不是恒报红）', restored.code === 0, `exit=${restored.code}`)

  // ---- 4) 清理自证：逐字节与原文件一致（本脚本会写仓库，必须证明没留痕）----
  const nowBytes = fs.readFileSync(TARGET)
  t('4 清理自证：逐字节还原一致', Buffer.compare(origBytes, nowBytes) === 0,
    Buffer.compare(origBytes, nowBytes) === 0 ? `${nowBytes.length} B` : `原 ${origBytes.length} B vs 现 ${nowBytes.length} B`)
} finally {
  // fail-safe：任何异常路径都要把原内容写回（否则会污染仓库）
  try { fs.writeFileSync(TARGET, origBytes) } catch { /* ignore */ }
}

console.log(failed === 0
  ? '\n[p48-negctl] OK —— 闸门有杠杆（断线兜底 ⇒ 报红；散落裸写 ⇒ 报红；删除 ⇒ 回绿；逐字节还原）'
  : `\n[p48-negctl] ${failed} 项失败 —— 闸门可能已成「死判据」或收窄过头`)
reportSelftest('p48-negctl', total - failed, total)
process.exit(failed === 0 ? 0 : 1)
