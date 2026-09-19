#!/usr/bin/env node
/**
 * audit-open-items-negctl.mjs —— **§六 开放项闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么需要它（P-30：真实仓库「0 违规」是 0 信息量）
 * `audit-open-items.mjs` 在真实仓库上得 **0 违规** —— 既可能是「表确实自洽」（好），
 * 也可能是「**闸门收窄过头、抓不到了**」（坏，等于把判据改废，正是 **B11** 禁止的放宽判据）。
 * **两者输出完全相同**（都是「0 违规」）。⇒ 必须用**注入实验**分辨。
 *
 * ## 注入什么（**取真实历史形态**，不是自造）
 * 靶子 = `docs/MOBILE-TEST-METHODOLOGY.md` 的 §六 表。注入**本轮真实修掉的那一类**：
 * 在 §六 表里**追加一行**，指向一个**已收口**的事实（`T-87 判据 8`，第 510 行是 ✅），
 * 却写「⬜ 未收口」—— 这正是 W40 撞见的那处「同一事实两处结论相反」（P-1）。
 * ★ 为什么用**追加**而不是改写原行：改写会破坏原文件的内容与还原风险；
 *   追加一行**同样构成「同一事实两处相反」**（判据问的是「同指纹是否两处结论相反」，
 *   不关心哪一行先出现）—— 而这正是本闸门所测的（它是**静态结构**判据，不执行业务逻辑）。
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
const AUDIT = path.join(WS, 'scripts', 'audit-open-items.mjs')
const TARGET = path.join(WS, '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md')

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
 * 注入的**真实历史形态**：与第 510 行（`T-87 判据 8`，状态 ✅）构成「同一事实两处相反」。
 * 锚点：§六 表的第一条数据行**之前**（保证注入进去，且不破坏表结构）。
 */
const ANCHOR = '| **两个回退类探针对用户真实卡真跑不可逆回退却零备份（P-48 第二类）**'
const INJECT = '| **T-87 判据 8**（子模块 `export const name` / `inject` 应降为内部常量，实际仍 export） | 判据自身 / 架构 | ⬜ **未收口**（第二十一轮发现）—— 登记 §6.26 |\n'

let failed = 0
let total = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

const original = fs.readFileSync(TARGET, 'utf8')
const origBytes = Buffer.from(original, 'utf8')

try {
  // ---- 0) 起点基线：注入前闸门必须绿（否则后面的红不能归因于注入）----
  const base = runGate()
  t('0 起点基线：注入前闸门 exit 0', base.code === 0, `exit=${base.code}`)

  // ---- 1) 注入「同事实两处相反」⇒ 必须报红，且**精确指向**、**指出是结论相反** ----
  if (!original.includes(ANCHOR)) throw new Error(`[FATAL] 注入锚点未定位：${ANCHOR.slice(0, 50)}（文档已改形态 ⇒ 负控必须重写，不许静默跳过）`)
  fs.writeFileSync(TARGET, original.replace(ANCHOR, INJECT + ANCHOR), 'utf8')
  const after = runGate()
  t('1 注入「同一事实两处结论相反」⇒ 闸门报红', after.code === 1, `exit=${after.code}`)
  t('1b 报红**精确指向**是「结论相反」（不是别的项）', /结论相反/.test(after.out), after.out.split('\n').filter(l => /✗/.test(l)).slice(0, 1).join('').trim())
  t('1c 报红里含**两个行号**（可定位到冲突的两条）', /第 \d+ 行.*第 \d+ 行/.test(after.out), '')

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
  try { fs.writeFileSync(TARGET, origBytes) } catch { /* ignore */ }
}

console.log(failed === 0
  ? '\n[openitems-negctl] OK —— 闸门有杠杆（注入矛盾 ⇒ 报红且指向两行；删除 ⇒ 回绿；逐字节还原）'
  : `\n[openitems-negctl] ${failed} 项失败 —— 闸门可能已成「死判据」或收窄过头`)
reportSelftest('openitems-negctl', total - failed, total)
process.exit(failed === 0 ? 0 : 1)
