#!/usr/bin/env node
/**
 * audit-rule-claims-negctl.mjs —— **「§七 纪律声明」闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么必须有
 * `audit-rule-claims.mjs` 在真实仓库上得 **0 违规** —— 既可能是「纪律都点名了装置」（好），
 * 也可能是「**判据被改废了**」（坏）。两者在报告上**长得一样**（都是红的消失）。
 * ⇒ 唯一区分办法：**把已知坏样本注入回去，看它会不会红**（W31/W38~W49 同纪律）。
 *
 * ## 注入什么（**逐条对应本仓实测过的形态**）
 *   A. **声明有机器守但没点名装置**（= **W50 实测的真缺陷形态**：R19 只写「已加静态护栏」）；
 *   B. **点名的装置不存在**（= 删脚本/改名后文档没跟着改，P-52 同族）；
 *   C. ★★ **装置真实存在但无触发路径**（既不在构建期门禁、也不被任何 vitest 规格引用）
 *      —— 这是本闸门**独有**的那条判据（「已加护栏」若无人会跑到，就是空声明）。
 *   D. ★★ **§九 P 判据索引**（**W53 新扩的受守区**）—— 与前三条**同源的注入**
 *      （同一判据换一个受守区 ⇒ 证明「扩面」真的生效，**P-58**）；
 *   E. ★ ★ §九 里点名的装置**不存在**（P-52 同族，换受守区后再验一次）；
 *   F. ★★ **切面失效必须 fail-closed**（**P-30**：零样本冒充通过 —— 读不到受守区 ⇒ 报红）；
 *   G. ★ **假红零控**（**W53 实测的口径缺陷**）—— 「把**结论机器化**」（**动作语境**）
 *      不得被判违规；首版 `[^已]机器化` 造成假红（**P-38**）。
 * ★ **杠杆**（P-20）：全部「改回」后必须回绿（证明以上各段不是恒定红）。
 * ★★ **本清单的自守**：上列字母键与实现里的分组键由 `audit-selftest-claims.mjs`
 *   的 `headNoteListProblems`（W73 新增）逐条对账 —— 此前只写到 C 而实现已有 G
 *   （**W73 实测的真缺陷**：**P-71 的补集**）。
 *
 * ## 纪律（R7 / R23 / B11）
 *   ① ★★ **全程只在内存里改文本 + 用 `scanRuleClaims()` 纯函数判**，
 *      **绝不写任何文件**（比 `--file <临时副本>` 更强：**连副本都不落盘**）；
 *   ② 每段要求**报红且结论正确**；改回 ⇒ **回绿**；
 *   ③ 退出码：0 = 全过；1 = 有断言失败；2 = 环境问题（fail-closed）。
 *
 * 用法：node scripts/audit-rule-claims-negctl.mjs
 */
import fs from 'node:fs'
import process from 'node:process'
import { reportSelftest } from './selftest-summary.mjs'
import { scanRuleClaims, GOAL_PATH, BUILD_PATH, deviceExists, triggerPathOf, checkRuleBlock } from './audit-rule-claims.mjs'

let total = 0, fail = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

if (!fs.existsSync(GOAL_PATH)) { console.error(`✗ 找不到 ${GOAL_PATH}`); process.exit(2) }
if (!fs.existsSync(BUILD_PATH)) { console.error(`✗ 找不到 ${BUILD_PATH}`); process.exit(2) }

const GOAL_ORIG = fs.readFileSync(GOAL_PATH, 'utf8')
const BUILD_TEXT = fs.readFileSync(BUILD_PATH, 'utf8')
const LINES = GOAL_ORIG.split('\n')

/** 基线：未注入的真实 GOAL ⇒ 必须绿（否则后面「报红」无判据力） */
const base = scanRuleClaims(GOAL_ORIG, BUILD_TEXT)
t('基线：未注入的真实 GOAL ⇒ 闸门为绿（否则后面的「报红」无判据力）',
  base.ok && base.problems.length === 0, `ok=${base.ok} 违规=${base.problems?.length}`)

/** ★★ 在内存里做一次注入 → 判 → 断言（**全程不落盘** —— P-48 更强形态） */
function drill (label, mutate, wantViolation) {
  const copy = LINES.slice()
  if (!mutate(copy)) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  const res = scanRuleClaims(copy.join('\n'), BUILD_TEXT)
  const hit = res.problems.some(p => p.violation === wantViolation)
  t(`${label}：注入后必须报红`, res.problems.length > 0, `违规=${res.problems.length}`)
  t(`${label}：报红结论正确（${wantViolation}）`, hit,
    res.problems.map(p => `${p.id}:${p.violation}`).join(' · ') || '(无违规)')
  return res.problems.length > 0 && hit
}

// ---- A：★ 声明有机器守但**没点名装置**（**W50 的真实缺陷形态**）----
//   ★ 把 R19 那条的「点名段」整段删掉，还原成 W50 修前的形态
const dA = drill('负控A（声明有机器守但没点名装置）', (ls) => {
  const i = ls.findIndex(l => /已加静态护栏/.test(l))
  if (i < 0) return false
  // 从「已加静态护栏」那行起，删掉后续点名装置的续行（直到下一条 `- **R` 或表头）
  let j = i
  while (j + 1 < ls.length && !/^-\s*\*\*R\d+/.test(ls[j + 1]) && !/^\|\s*\*\*R\d+/.test(ls[j + 1])) j += 1
  ls.splice(i, j - i + 1, '  > 见 P-31。已加静态护栏：DOM 增强模块扫出 `replaceChild` 即报红。')
  return true
}, '声明有机器守但没点名装置')

// ---- B：点名的装置**不存在** ----
const dB = drill('负控B（点名的装置不存在）', (ls) => {
  const i = ls.findIndex(l => /P-31 家族回归锁/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('touch-target-audit.spec.ts', 'touch-target-audit-ghost.spec.ts')
  return ls[i].includes('ghost')
}, '点名的装置不存在')

// ---- C：★★ 装置**真实存在但无触发路径**（本闸门独有的判据）----
//   ★ 前置必须成立：所选样本**真的存在**且**真的无触发**（否则测的是别的判据 —— 首版踩过）
const ORPHAN = 'stage4-regression.mjs'
const okPre = deviceExists(ORPHAN) && triggerPathOf(ORPHAN, BUILD_TEXT) === null
t('★负控C 前置：所选「孤儿装置」样本必须**真实存在且无触发路径**（否则本负控失效）',
  okPre, `${ORPHAN} 存在=${deviceExists(ORPHAN)} 触发=${triggerPathOf(ORPHAN, BUILD_TEXT)}`)
const dC = drill('负控C（装置存在但无触发路径）', (ls) => {
  const i = ls.findIndex(l => /P-31 家族回归锁/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('touch-target-audit.spec.ts', ORPHAN)
  return ls[i].includes(ORPHAN)
}, '点名的装置没有可判定的触发路径')

// ---- D：★★ **§九 P 判据索引**（**W53 新扩的受守区**）—— 与前三条**同源的注入** ----
//   ★ 为什么必须**在 §九 上重测一遍**：三类注入此前只跑过 §七 ⇒
//     若 §九 的**切面或条目识别**有问题，本闸门在 §九 上会**静默失效**（P-30）。
//   ★ 锚点：P-48 行（「已机器化为 `audit-p48-rollback.mjs`」）—— **实读**（P-19）。
const dD = drill('负控D（§九：声明有机器守但没点名装置）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*P-48\s*\|/.test(l))
  if (i < 0) return false
  // 只删「装置名」，保留「已机器化」这类状态声明 ⇒ 应报「没点名装置」
  ls[i] = ls[i].replace(/`audit-p48-rollback\.mjs`/g, '').replace(/`audit-p48-negctl\.mjs`/g, '')
  return true
}, '声明有机器守但没点名装置')

// ---- E：★ §九 里点名的装置**不存在** ----
const dE = drill('负控E（§九：点名的装置不存在）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*P-52\s*\|/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('`audit-doc-refs.mjs`', '`audit-doc-refs-ghost.mjs`')
  return ls[i].includes('ghost')
}, '点名的装置不存在')

// ---- F：★★ **切面失效必须 fail-closed**（P-30：零样本冒充通过）----
//   ★ 把 §九 的章节标题改掉 ⇒ 切不出该区 ⇒ 必须 **ok=false**（fail-closed），不得静默跳过
const noNine = LINES.slice()
const nineIdx = noNine.findIndex(l => /^##\s*九、/.test(l))
const dF = (() => {
  if (nineIdx < 0) { t('负控F 前置：找到 §九 标题', false, '未命中'); return false }
  noNine[nineIdx] = noNine[nineIdx].replace(/^##\s*九、/, '## 九（改名）')
  const res = scanRuleClaims(noNine.join('\n'), BUILD_TEXT)
  t('★★负控F（切面失效）：§九 标题被改 ⇒ **必须 ok=false**（fail-closed，不得静默跳过该区）',
    res.ok === false, `ok=${res.ok} reason=${res.reason ?? '(无)'}`)
  t('★负控F：报错信息**必须点明是哪个区**（否则读者不知道哪块没被检查）',
    /§九/.test(res.reason ?? ''), String(res.reason))
  return res.ok === false && /§九/.test(res.reason ?? '')
})()

// ---- G：★ **假红零控**（**W53 实测的口径缺陷**）----
//   ★ 「把**结论机器化**」（**动作/祈使**语境，见 P-37 定义行）**不得**被判违规。
//     首版 CLAIM_RE 含 `[^已]机器化` ⇒ 该行被认作状态声明 ⇒ 报「没点名装置」= **假红**（P-38）。
//   ★ 本零控**直接对纯函数断言**（不需要注入文档）—— 它测的是**口径方向**。
const dG = (() => {
  const fake = '| P-37 | **「判据盲区存在」≠「盲区有后果」**——盲区必须量化**实际后果**并把结论机器化（否则不是「已收口」） |'
  const r = checkRuleBlock({ id: 'P-37', line: 1, text: fake }, BUILD_TEXT)
  t('★★零控G（假红口径）：「把**结论机器化**」（**动作语境**）⇒ **不得**被判违规（首版 `[^已]机器化` 造成假红，P-38）',
    r === null, JSON.stringify(r))
  t('★杠杆G：同一句改成「**W38 机器化** …」⇒ **必须**被判为声明（收窄是**方向性**的，不是把判据改废）',
    checkRuleBlock({ id: 'P-37', line: 1, text: '| P-37 | **W38 机器化**（无装置名） |' }, BUILD_TEXT) !== null, '')
  return r === null
})()

// ---- ★ 杠杆（P-20）：全部「改回」（= 用原始文本重判）⇒ **必须回绿** ----
const back = scanRuleClaims(GOAL_ORIG, BUILD_TEXT)
t('★杠杆：三段注入全部改回 ⇒ **必须回绿**（证明「注入⇒报红」不是判据恒定红）',
  back.problems.length === 0, `违规=${back.problems.length}`)

// ---- ★ 真实仓库**未被触碰**自证（本负控全程**只在内存里改** —— 比副本更强）----
const after = fs.readFileSync(GOAL_PATH, 'utf8')
t('★真实仓库未被触碰（逐字节一致 —— 本负控**连副本都不落盘**）', after === GOAL_ORIG,
  `len ${after.length} vs ${GOAL_ORIG.length}`)

console.log(fail === 0
  ? '\n[ruleclaims-negctl] OK —— 闸门有杠杆（三类注入 ⇒ 报红且结论正确；改回 ⇒ 回绿；真实仓库全程未被触碰）'
  : `\n[ruleclaims-negctl] ${fail} 项失败 —— 闸门可能已成「死判据」`)
reportSelftest('rule-claims-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
