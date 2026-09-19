// 守「矩阵残余标记不得过期」的闸门。
//
// ## 为什么需要（第三十轮 W29 实测：一次改了 3 格过期标记，全靠人工撞见）
// `MOBILE-TEST-METHODOLOGY.md` §二 的 L1~L5 表是「要测什么」的 SSOT，每格有结论 + 残余。
// 但**结论是会过期的**：某格标「部分覆盖 / 须运行时验证」，而后续轮次已经做完并设备复验了，
// 却没有人回头改这一格。W29 一轮内就撞见 **3 格**：
//   · L5 `display 正则链` 的脚本侧残余（N4 早已在 T-20 修复）
//   · L2 `长文本/宽元素`（W5 早已设备复验 6/6，矩阵还写着「部分覆盖 + 须运行时验证」）
//   · L1 `触控目标尺寸`（W1/W2 早已 12 态穷举 0 P1/0 P2，矩阵还写着「待工具复测」）
// ⇒ 后果不是「不好看」，而是**后人据它重复排查**（P-1：同一事实两处口径不一致），
//   且会让「矩阵清零」（E-B）看起来永远做不完。
//
// ## 判据（静态、可机器化、且**不依赖我记住**）
// 对每个**标为「部分覆盖/未覆盖」且留有残余描述**的格子，要求它的残余描述里
// **必须出现一个「可追踪锚点」** —— 即指向「我方待办」的登记处：
//   · 一个已登记的缺口文档（`docs/xxx.md`）
//   · 或一个 §6.x 小节号
//   · 或明确的「属宿主/属卡页面/无我方待办」归属（这类**不阻塞**，因为不是我们的活）
// 反之，若残余里出现**「需/须运行时验证」「待复测」「待判定」**这类**未收敛**措辞，
// **必须同时给出**：(a) 对应探针/脚本名，且该文件**真实存在**；(b) 一个登记处。
// ⇒ 若一句「须运行时验证」既没有探针也没有登记 ⇒ 报红（它是**悬空的待办**）。
//
// ## 诚实边界
// · 本判据管的是「**残余描述的结构完整性**」，**不是**「残余是否真的还在」
//   —— 后者需要逐个真跑（那正是 W29 人工做的部分）。**不假装覆盖了它**。
// · 因此它是**降低复发率的护栏**，不是「以后就不用人工复核」的替代品。
//
// 用法：node scripts/audit-matrix-residuals.mjs [--selftest]
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const DOC = path.join(WS, '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md')

// 「未收敛」措辞：出现即要求给出探针 + 登记处
const UNRESOLVED_WORDS = ['需运行时验证', '须运行时验证', '待运行时验证', '待工具复测', '待判定', '待排查', '待评估']
// 「已归属、非我方待办」措辞：出现即视为已收敛（不需要探针）
const ATTRIBUTED_WORDS = ['属宿主', '属卡页面', '不在我方可改范围', '待上游化']
// 「可追踪锚点」：文档路径 / §6.x 小节号
const ANCHOR_RE = /(docs\/[\w.-]+\.md|§\s*\d+(?:\.\d+)*[a-z]?)/g
// 探针/脚本引用
const PROBE_RE = /(scripts\/[\w.-]+\.(?:mjs|py|sh|ps1)|[\w-]+\.spec\.ts)/g

/** 切出「必测项表」的行（以 `|` 开头、含「|」分隔且不是表头/分隔行） */
export function tableRows (text) {
  return text.split(/\r?\n/).filter(l => l.startsWith('|') && !/^\|[\s:-]+\|/.test(l))
}

/**
 * 检查一行是否需要报红。
 * @returns {{ level: 'ok'|'warn'|'fail', why: string }}
 */
export function checkRow (row, existsFn) {
  const cells = row.split('|').slice(1, -1).map(s => s.trim())
  if (cells.length < 2) return { level: 'ok', why: '' }
  const status = cells[1]
  const body = cells.slice(1).join(' ')
  // 只关心「部分覆盖 / 未覆盖」这类**未完成**状态
  if (!/部分覆盖|未覆盖|未开始/.test(status)) return { level: 'ok', why: '' }

  const unresolved = UNRESOLVED_WORDS.filter(w => body.includes(w))
  if (unresolved.length === 0) return { level: 'ok', why: '（残余已收敛或已归属）' }
  // 已归属 ⇒ 不阻塞（不是我方待办）
  if (ATTRIBUTED_WORDS.some(w => body.includes(w))) {
    return { level: 'ok', why: `残余已归属（含「${ATTRIBUTED_WORDS.find(w => body.includes(w))}」）` }
  }
  // 未收敛 ⇒ 必须同时有「探针（且真实存在）」+「登记处」
  const probes = [...new Set([...body.matchAll(PROBE_RE)].map(m => m[1]))]
  const anchors = [...new Set([...body.matchAll(ANCHOR_RE)].map(m => m[1]))]
  const probeExists = probes.some(p => existsFn(p))
  if (!probeExists) {
    return { level: 'fail', why: `含未收敛措辞「${unresolved.join('/')}」但**没有可用的探针引用**（探针须真实存在）` +
      (probes.length ? `；引用的 ${probes.join(', ')} 都不存在` : '') }
  }
  if (anchors.length === 0) {
    return { level: 'fail', why: `含未收敛措辞「${unresolved.join('/')}」且**没有登记处**（需 docs/… 或 §6.x 指向）` }
  }
  return { level: 'ok', why: `未收敛但有探针 ${probes.join(',')} + 登记处 ${anchors.join(',')}` }
}

// ---------------------------------------------------------------------------

function selftest () {
  console.log('=== audit-matrix-residuals --selftest ===')
  const exists = (p) => ['scripts/ef-touch-targets.mjs', 'docs/X.md'].includes(p)
  const cases = [
    ['正控：已覆盖的格子 ⇒ 不报', '| 视口单位 | **✅ 已修复** | 设备实测 803→548 |', 'ok'],
    ['正控：部分覆盖但残余已归属（属宿主）⇒ 不报',
      '| 某格 | **部分覆盖** | 残余：属宿主 bundle，登记待上游化 |', 'ok'],
    ['正控：部分覆盖 + 未收敛，但探针真实存在 + 有登记处 ⇒ 不报',
      '| 某格 | **部分覆盖** | 残余：须运行时验证（`scripts/ef-touch-targets.mjs`，见 docs/X.md） |', 'ok'],
    ['★ 负控：未收敛但**没有探针** ⇒ 必须报（悬空待办）',
      '| 某格 | **部分覆盖** | 残余：须运行时验证 |', 'fail'],
    ['★ 负控：未收敛 + 探针**不存在** ⇒ 必须报（引用了不存在的探针 = 更坏的假证据）',
      '| 某格 | **部分覆盖** | 残余：须运行时验证（`scripts/ef-not-real.mjs`，见 docs/X.md） |', 'fail'],
    ['★ 负控：未收敛 + 探针存在但**无登记处** ⇒ 必须报',
      '| 某格 | **部分覆盖** | 残余：须运行时验证（`scripts/ef-touch-targets.mjs`） |', 'fail'],
    ['负控：未覆盖（更严重）同样受管 ⇒ 无探针即报',
      '| 某格 | **未覆盖** | 待排查 |', 'fail'],
  ]
  let pass = 0
  for (const [label, row, want] of cases) {
    const got = checkRow(row, exists)
    const ok = got.level === want
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label}  → ${got.level}（期望 ${want}）${got.why ? ' · ' + got.why : ''}`)
    if (ok) pass++
  }
  // ★ 单源输出契约（W44 建立）：W45 第二轮实测发现本闸门**未接入**（收尾是旧形态
  //   `[audit-matrix-residuals selftest] 7/7 PASS`——**N/M 在方括号内、无契约前缀**）
  //   ⇒ 而文档 §三 声明着它的分数 ⇒ **读不出 ⇒ 无法被证伪**（P-50 纪律①）。
  reportSelftest('matrix-residuals', pass, cases.length)
  return pass === cases.length
}

if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 3)
}

if (!fs.existsSync(DOC)) {
  console.error(`✗ 找不到矩阵文档：${DOC}`)
  process.exit(2)
}
const text = fs.readFileSync(DOC, 'utf8')
const rows = tableRows(text)
const existsFn = (p) => {
  const cands = [path.join(WS, p), path.join(WS, 'packages', p), path.join(WS, '..', p)]
  return cands.some(c => fs.existsSync(c))
}

const bad = []
let partial = 0
for (const r of rows) {
  const cells = r.split('|').slice(1, -1).map(s => s.trim())
  if (cells.length < 2) continue
  if (/部分覆盖|未覆盖|未开始/.test(cells[1])) partial++
  const v = checkRow(r, existsFn)
  if (v.level === 'fail') bad.push({ row: cells[0].slice(0, 60), why: v.why })
}

console.log('[audit-matrix-residuals] 矩阵残余标记审计')
console.log(`  扫描表格行 ${rows.length} 行 · 其中「部分覆盖/未覆盖/未开始」${partial} 行`)
if (bad.length === 0) {
  console.log('✓ 所有未完成格的残余：要么已归属（非我方待办），要么带「真实存在的探针 + 登记处」')
  console.log('  ⓘ 诚实边界：本判据只查「残余描述的结构完整性」，**不查残余是否真的还在** —— 后者须逐个真跑')
  process.exit(0)
}
console.log(`✗ ${bad.length} 行**悬空残余**（既无可用探针、又无登记处 ⇒ 后人会重复排查）：`)
for (const b of bad) console.log(`    · ${b.row} —— ${b.why}`)
process.exit(1)
