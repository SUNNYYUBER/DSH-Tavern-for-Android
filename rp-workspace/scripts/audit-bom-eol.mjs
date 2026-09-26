#!/usr/bin/env node
/**
 * audit-bom-eol.mjs —— 受控文件 BOM/行尾形态硬闸（体检 2026-09-26 · P1-1）
 * ============================================================================
 * 【为什么需要它（断链①的根因封堵，历史复发 6+ 次）】
 *
 * 本仓长期无 `.gitattributes` + `core.autocrlf=true` ⇒ 每次检出把文本文件
 * 工作区改写成 CRLF；`.ps1` 等文件的 BOM 由编辑器/工具随手增删：
 *   · 双 BOM = PowerShell 解析器 2 处 "The assignment expression is not valid"
 *     （MEMORY.md 断链①；2026-09-26 体检当天工作区又一次复现双 BOM）；
 *   · 体检当天实测 316 个受控文件行尾被静默改写
 *     （docs/HEALTHCHECK-D-ASSET-DRIFT-2026-09-26.md H1：MainActivity.kt
 *     工作区 2521 个 CR vs HEAD 0 个，内容逐字相同）；
 *   · 62 个 audit-* 闸门此前没有一个管 BOM/行尾 —— 本闸补上这一层。
 *
 * 【判据（落在 git 索引与工作区，锚定「合法 BOM 名单」单源）】
 *   ① **BOM 名单单源**：HEAD 中带 BOM 的受控文件 = 合法名单（本闸启动时动态
 *      枚举，不维护第二份清单 —— 防止名单与事实漂移，P-1）。
 *      · 名单内的文件：工作区必须**恰好 1 个 BOM**（0 个 = BOM 丢失（断链①原形态）；
 *        ≥2 个 = 双 BOM（解析失败形态））。
 *      · 名单外的**文本**文件：工作区必须 **0 个 BOM**（新文件不许擅自带 BOM；
 *        要带就先进名单 = 在 HEAD 留痕，让变更可审）。
 *      判据基于 HEAD 名单而非硬编码表，因此「把文件从名单移除」的正常流程 =
 *      提交一次去 BOM 的变更 —— 名单随事实走。
 *   ② **行尾形态**：`.gitattributes` 已定全仓 `eol=lf`（同一次修复加入）。本闸
 *      检查受控**文本**文件工作区不得含 CRLF（二进制按 .gitattributes 豁免，
 *      以 `git check-attr binary` 为准 —— 不自己猜类型，P-1）。
 *      CRLF 命中 ⇒ FAIL（fail-closed）：autocrlf=true 的机器检出即 CRLF，
 *      必须先 `git add --renormalize .` 收敛（本闸首次接入时已做）。
 *   ③ **selftest（P-30）**：合成语料正控/负控 —— 0/2 BOM 必须被抓、1 BOM 放行、
 *      CRLF 被抓、二进制豁免生效。
 *
 * 【为什么放在 Step 0.5 而不是只在 CI】断链①的代价是「构建当场失败」，
 * 在构建最早点拦截最便宜（P-40①：判据跑在代价最小处）。
 *
 * 用法：
 *   node scripts/audit-bom-eol.mjs             # 审计（工作区 + 索引）
 *   node scripts/audit-bom-eol.mjs --selftest  # 判据自身正/负控（P-30）
 * 退出码：0=通过；1=发现违例（fail-closed）；3=selftest 失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')            // rp-workspace
const ROOT = path.resolve(WS, '..')            // 仓库根

/** 读文件前 3 字节，判 BOM（'efbbbf' | null）。 */
export function readBom (absPath) {
  const fd = fs.openSync(absPath, 'r')
  try {
    const b = Buffer.alloc(3)
    const n = fs.readSync(fd, b, 0, 3, 0)
    if (n < 3) return null
    return b.toString('hex') === 'efbbbf' ? 'efbbbf' : null
  } finally { fs.closeSync(fd) }
}

/** 工作区文件是否含 CRLF（读前 64KB 足以定性；全读大文件是体检教训之一）。 */
export function hasCrlf (absPath) {
  const fd = fs.openSync(absPath, 'r')
  try {
    const b = Buffer.alloc(65536)
    const n = fs.readSync(fd, b, 0, b.length, 0)
    return b.subarray(0, n).includes(Buffer.from('\r\n'))
  } finally { fs.closeSync(fd) }
}

/**
 * 判定一个「BOM 名单成员资格 + 实测 BOM 数」组合是否合规。
 * 纯函数（selftest 直调 —— 判据单源，P-1）。
 * @param {boolean} inList 是否在 HEAD 合法 BOM 名单内
 * @param {number} bomCount 实测 BOM 字节数（0/1；按 3 字节组计）
 * @returns {{ ok: boolean, note: string }}
 */
export function checkBomState (inList, bomCount) {
  if (inList && bomCount === 1) return { ok: true, note: '名单内且恰好 1 个 BOM' }
  if (inList && bomCount === 0) return { ok: false, note: '**BOM 丢失**（名单内文件应为恰好 1 个）—— PowerShell 5.1 侧会按 GBK 误读中文（断链①原形态）' }
  if (inList && bomCount >= 2) return { ok: false, note: `**双 BOM**（实测 ${bomCount} 个）—— PowerShell 解析器报 "assignment expression is not valid"（体检当天复现形态）` }
  if (!inList && bomCount === 0) return { ok: true, note: '名单外且无 BOM' }
  return { ok: false, note: `**擅自带 BOM**（${bomCount} 个）—— 名单外文本文件不许带 BOM；确需 BOM 请提交进 HEAD（名单随事实走）` }
}

/**
 * 行尾判据（纯函数）：二进制豁免；文本含 CRLF ⇒ FAIL。
 * @returns {{ ok: boolean, note: string }}
 */
export function checkEolState (isBinary, hasCrlfFlag) {
  if (isBinary) return { ok: true, note: '二进制豁免（.gitattributes）' }
  if (!hasCrlfFlag) return { ok: true, note: 'LF' }
  return { ok: false, note: '**工作区含 CRLF** —— .gitattributes 已定 eol=lf；请 `git add --renormalize .` 收敛后提交（勿与内容改动混提交）' }
}

// ---------------------------------------------------------------------------
// selftest（P-30：合成正负控 ——「真实仓库 0 命中」不是证据）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let pass = 0
  const fail = []
  const ok = (cond, label) => { if (cond) { pass += 1; console.log(`[ok] ${label}`) } else { fail.push(label); console.log(`[FAIL] ${label}`) } }

  console.log('=== audit-bom-eol --selftest（判据自身正/负控）===')

  // 正控 1：名单内 + 1 BOM ⇒ 放行（健康形态）
  ok(checkBomState(true, 1).ok === true, '正控1 名单内+恰好1 BOM ⇒ 放行')
  // 正控 2：名单外 + 0 BOM ⇒ 放行（普通文本）
  ok(checkBomState(false, 0).ok === true, '正控2 名单外+无BOM ⇒ 放行')
  // 负控 1：名单内 + 0 BOM ⇒ 必须抓（BOM 丢失 = 断链①原形态）
  const rL0 = checkBomState(true, 0)
  ok(rL0.ok === false && /BOM 丢失/.test(rL0.note), `负控1 名单内+0 BOM ⇒ FAIL：${rL0.note.slice(0, 40)}`)
  // 负控 2：名单内 + 2 BOM ⇒ 必须抓（双 BOM = 解析失败形态）
  const rL2 = checkBomState(true, 2)
  ok(rL2.ok === false && /双 BOM/.test(rL2.note), `负控2 名单内+2 BOM ⇒ FAIL：${rL2.note.slice(0, 40)}`)
  // 负控 3：名单外 + 1 BOM ⇒ 必须抓（擅自带 BOM）
  ok(checkBomState(false, 1).ok === false, '负控3 名单外+1 BOM ⇒ FAIL')
  // 杠杆：同一文件只改 BOM 数，结论必须翻转（判据有区分力）
  ok(checkBomState(true, 1).ok !== checkBomState(true, 2).ok, '★杠杆 同一名单成员 1↔2 BOM ⇒ 结论翻转')
  // 行尾判据
  ok(checkEolState(true, true).ok === true, '行控1 二进制含 CRLF ⇒ 豁免')
  ok(checkEolState(false, false).ok === true, '行控2 文本 LF ⇒ 放行')
  const rE = checkEolState(false, true)
  ok(rE.ok === false && /CRLF/.test(rE.note), `行控3 文本含 CRLF ⇒ FAIL：${rE.note.slice(0, 40)}`)

  reportSelftest('bom-eol', pass, pass + fail.length)
  if (fail.length) { console.log('失败项：' + fail.join('；')); process.exit(3) }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 主审计
// ---------------------------------------------------------------------------
const violations = []
const note = (level, file, msg) => { violations.push({ file, msg }); console.log(`${level} ${file}\n    ${msg}`) }

// 受控文件清单（git ls-files —— 索引口径，含已暂存新文件；不看未跟踪文件）
let files = []
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean)
} catch (e) {
  console.error(`✗ 读不到 git 索引（必须在仓库内运行）：${e.message}`)
  process.exit(1)
}

// 合法 BOM 名单 = HEAD 中带 BOM 的受控文件（单源动态枚举，不维护第二份清单）
const bomAllow = new Set()
for (const f of files) {
  try {
    const head = execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })
    if (head.length >= 3 && head.subarray(0, 3).toString('hex') === 'efbbbf') bomAllow.add(f)
  } catch { /* HEAD 无此文件（新暂存）⇒ 不在名单 */ }
}
console.log(`[audit-bom-eol] 受控文件 ${files.length} 个 · HEAD 合法 BOM 名单 ${bomAllow.size} 个\n`)

let checkedBinary = 0
for (const f of files) {
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs)) continue // 已暂存删除/改名中，无从判工作区形态
  // 二进制豁免以 .gitattributes 为准（不自己猜类型）
  let attr = ''
  try {
    attr = execFileSync('git', ['check-attr', 'binary', '--', f], { cwd: ROOT, encoding: 'utf8' })
  } catch { /* 判不出按文本处理（保守） */ }
  const isBinary = /binary:\s*set/.test(attr)
  if (isBinary) { checkedBinary += 1; continue }

  // 判据①：BOM（数 3 字节组的个数 —— 双 BOM = 前 6 字节都是 BOM）
  let bomCount = 0
  try {
    const head6 = Buffer.alloc(6)
    const fd = fs.openSync(abs, 'r')
    const n = fs.readSync(fd, head6, 0, 6, 0)
    fs.closeSync(fd)
    let off = 0
    while (off + 3 <= n && head6.subarray(off, off + 3).toString('hex') === 'efbbbf') { bomCount += 1; off += 3 }
  } catch { continue }
  const inList = bomAllow.has(f)
  const rBom = checkBomState(inList, bomCount)
  if (!rBom.ok) note('✗', f, rBom.note)

  // 判据②：行尾（.gitattributes eol=lf；CRLF 命中即 FAIL）
  try {
    const rEol = checkEolState(isBinary, hasCrlf(abs))
    if (!rEol.ok) note('✗', f, rEol.note)
  } catch { /* 读不了跳过（权限类，不冒充通过也不误报） */ }
}

console.log(`\n[audit-bom-eol] 检查 ${files.length} 个受控文件（二进制豁免 ${checkedBinary}）· BOM 名单 ${bomAllow.size}`)
if (violations.length > 0) {
  console.log(`\n⛔ 违例 ${violations.length} 个（fail-closed）：`)
  for (const v of violations) console.log(`  · ${v.file} —— ${v.msg}`)
  process.exit(1)
}
console.log('✅ BOM/行尾形态合规（无违例）')
process.exit(0)
