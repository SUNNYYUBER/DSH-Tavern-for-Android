// audit-exchange-guards.mjs —— W-6：共享交换目录的**安全契约对账**
//
// 【守什么】交换目录是「App 私有区 ↔ 用户可见目录」的桥，它的**唯一安全约束**是
// 「凭据永不参与双向搬运」。这条约束一旦破了，后果是凭据被拷到 /sdcard
// （任何 app / 用户在文件管理器里都能读）——本项目的头号风险类型。
//
// 判据（三条）：
//   ① **凭据清单在场且非空**：ExchangeDir.NEVER_MIRROR 必须包含凭据类文件名；
//   ② **与备份排除清单一致**：ExchangeDir.NEVER_MIRROR ⊇ MainActivity.BACKUP_EXCLUDE 的
//      凭据项 —— 两处都是「凭据不该出去」的实现，**漂移意味着其中一处漏了**
//      （P-41 家族：同一个事实两处实现，各自演化）；
//   ③ **拒绝是双向的**：sync() 的两个方向都要过 isBlocked 判定
//      （只拦一个方向 = 凭据仍会泄漏到另一侧）。
//
// 【为什么用静态断言】这三条都是**源码结构事实**，不需要真机即可判定；
// 行为面（真的搬了/真的没搬）已由模拟器正反控实测覆盖（见交付记录）。
//
// 退出码：0 = 全部一致；1 = 有违反；3 = selftest 失败
//
// 用法：
//   node scripts/audit-exchange-guards.mjs              # 对账
//   node scripts/audit-exchange-guards.mjs --selftest   # 判据自检（有区分力）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app')
const EXCHANGE = path.join(APP, 'ExchangeDir.kt')
// 备份排除清单在 MainActivity（不是 NodeService）——两条「凭据不出去」的实现分居两文件
const MAIN_ACTIVITY = path.join(APP, 'MainActivity.kt')

/** 从 ExchangeDir.kt 解析 NEVER_MIRROR 清单。 */
function parseNeverMirror(kt) {
  const m = kt.match(/NEVER_MIRROR\s*=\s*setOf\(([\s\S]*?)\)/)
  if (!m) return null
  const items = []
  const re = /"([^"]+)"/g
  let x
  while ((x = re.exec(m[1])) !== null) items.push(x[1])
  return items
}

/** 从 NodeService.kt 解析 BACKUP_EXCLUDE。 */
function parseBackupExclude(kt) {
  const m = kt.match(/BACKUP_EXCLUDE\s*=\s*setOf\(([\s\S]*?)\)/)
  if (!m) return null
  const items = []
  const re = /"([^"]+)"/g
  let x
  while ((x = re.exec(m[1])) !== null) items.push(x[1])
  return items
}

/** 核心判据，返回 problems。抽成函数以便 selftest 注入样本。 */
function check(exchangeText, nodeServiceText) {
  const problems = []
  const never = parseNeverMirror(exchangeText)
  if (never === null) {
    problems.push('ExchangeDir.NEVER_MIRROR 解析失败（清单被删或改名）—— 判据已空转')
    return { problems, never: [], backup: [] }
  }
  // ① 非空 + 含凭据项
  if (never.length === 0) problems.push('NEVER_MIRROR 为空 —— 凭据将参与搬运（严重）')
  const credLike = never.filter((n) => /credential|token/i.test(n))
  if (credLike.length === 0) {
    problems.push('NEVER_MIRROR 里没有任何凭据类条目（credential/token）—— 约束形同虚设')
  }

  // ② 与备份排除清单一致（方向：备份排除的凭据项必须也在交换拒绝里）
  const backup = parseBackupExclude(nodeServiceText)
  if (backup === null) {
    problems.push('NodeService.BACKUP_EXCLUDE 解析失败 —— 无法对账（备份是另一条「凭据不出去」路径）')
  } else {
    for (const b of backup) {
      if (!never.includes(b)) {
        problems.push(`备份排除清单里的「${b}」不在交换目录的拒绝清单里 —— 两处「凭据不出去」已漂移`)
      }
    }
  }

  // ③ 拒绝必须双向：sync() 里两个循环都要有 isBlocked 判定
  const syncBody = exchangeText.slice(
    exchangeText.indexOf('fun sync('),
    exchangeText.indexOf('private enum class Decision'),
  )
  if (syncBody.length === 0 || exchangeText.indexOf('private enum class Decision') < 0) {
    problems.push('找不到 sync() 主体 —— 无法验证拒绝是否双向')
  } else {
    const blockedCalls = (syncBody.match(/isBlocked\(/g) ?? []).length
    if (blockedCalls < 2) {
      problems.push(`sync() 里只有 ${blockedCalls} 处 isBlocked 判定 —— 拒绝必须**双向**（进出各一处）`)
    }
  }

  return { problems, never, backup }
}

// ---------------------------------------------------------------------------
// selftest：注入样本证明判据有区分力
// ---------------------------------------------------------------------------
function selftest() {
  const realEx = fs.readFileSync(EXCHANGE, 'utf8')
  const realNs = fs.readFileSync(MAIN_ACTIVITY, 'utf8')
  const cases = []
  const add = (name, expect, e, n) => cases.push({ name, expect, e, n })

  add('真实仓库 ⇒ 无问题', null, realEx, realNs)
  add('拒绝清单被清空 ⇒ 报红', 'NEVER_MIRROR 为空',
    realEx.replace(/NEVER_MIRROR\s*=\s*setOf\([\s\S]*?\)/, 'NEVER_MIRROR = setOf()'), realNs)
  add('凭据项被移除 ⇒ 报红', '没有任何凭据类条目',
    realEx.replace(/NEVER_MIRROR\s*=\s*setOf\([\s\S]*?\)/, 'NEVER_MIRROR = setOf("readme.txt")'), realNs)
  add('与备份清单漂移 ⇒ 报红', '不在交换目录的拒绝清单里',
    realEx.replace(/"dsht-token",?\s*/, ''), realNs)
  add('只拦单向 ⇒ 报红', '拒绝必须**双向**',
    realEx.replace(/if \(isBlocked\(f\.name\)\) \{ blocked \+= f\.name; continue \}\n/g, ''), realNs)

  let pass = 0
  for (const c of cases) {
    const { problems } = check(c.e, c.n)
    const ok = c.expect === null
      ? problems.length === 0
      : problems.some((p) => p.includes(c.expect))
    if (ok) { pass++; console.log(`  PASS  ${c.name}${problems.length ? `（${problems.length} 处）` : ''}`) }
    else console.error(`  FAIL  ${c.name} —— 期望含「${c.expect ?? '无问题'}」，实得：${JSON.stringify(problems)}`)
  }
  console.log(`\n[selftest-summary] exchange-guards ${pass}/${cases.length} ${pass === cases.length ? 'PASS' : 'FAIL'}`)
  return pass === cases.length
}

if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 3)
}

let failed = false
const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }

console.log('=== W-6 交换目录安全契约对账 ===')
if (!fs.existsSync(EXCHANGE)) { fail(`找不到 ExchangeDir.kt：${EXCHANGE}`); process.exit(1) }
if (!fs.existsSync(MAIN_ACTIVITY)) { fail(`找不到 MainActivity.kt：${MAIN_ACTIVITY}`); process.exit(1) }

const { problems, never, backup } = check(
  fs.readFileSync(EXCHANGE, 'utf8'),
  fs.readFileSync(MAIN_ACTIVITY, 'utf8'),
)
console.log(`  交换拒绝清单（${never.length}）：${never.join(', ')}`)
console.log(`  备份排除清单（${backup?.length ?? '?'}）：${(backup ?? []).join(', ')}`)
if (problems.length === 0) {
  console.log('  ✓ 判据①②③ 全部通过（拒绝清单在场 · 与备份一致 · 双向拦）')
} else {
  problems.forEach(fail)
}
if (failed) { console.error('\n✗ 交换目录安全契约对账失败'); process.exitCode = 1 }
else console.log('\n✓ 交换目录安全契约对账通过')
