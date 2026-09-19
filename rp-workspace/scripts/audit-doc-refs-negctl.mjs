#!/usr/bin/env node
/**
 * audit-doc-refs-negctl.mjs —— **「文档引用完整性」闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么必须有
 * `audit-doc-refs.mjs` 在真实仓库上得 **0 违规** —— 既可能是「文档确实一致」（好），
 * 也可能是「**判据被改废了**」（坏）。两者在报告上**长得一样**（都是红的消失）。
 * 唯一区分办法：**把坏样本注入回去，看它会不会红**（W31/W38/W39/W40/W42/W44/W45 同纪律）。
 *
 * ## 注入什么（**逐条对应本仓实测过的真缺陷形态**）
 *   A. **悬空位置声明**：把 `scripts/xxx.mjs` 改成不存在的名字
 *      （= 删脚本后文档没跟着改 —— 本仓 W42~W45 四轮内高频发生）；
 *   B. ★ **并列装置位置不一致**：在**同一行**并列写两个裸名装置，而它们实际分属不同目录
 *      （= **W46 实测的真缺陷形态**：方法论 P-4 定义行把 `packages/tests/` 的探针
 *      与 `scripts/` 的装置并列陈述）；
 *   C. **可执行引用悬空**：把 `` `node <路径>` `` 改成不存在的路径。
 *   D. ★★ **引用目标不在版本控制内**（**W49 新增 —— 该轮的真缺陷形态**）：
 *      把一条可执行引用改成 `node rp-workspace/tmp/xxx.mjs`（`tmp/` 在 `.gitignore:34` 内）
 *      —— **本机磁盘上真实存在**，故判据① 放行；但**别人克隆后没有** ⇒ 读者照做扑空（P-53）。
 *      ★ 这是 ①②③ 判据**结构上抓不到**的一类：它们只问「在不在磁盘上」。
 *   E. ★★ **史实区 mask 的杠杆**（**W49 新增**）：把 GOAL 的史实区**标记**（`## 十一、`）
 *      改名 ⇒ mask 失效 ⇒ 史实区里的旧引用**立刻报红**。
 *      ★ 它证的是「mask **真的在起作用**」而不是「判据被改废」——
 *      与 A~D「注入 ⇒ 报红」方向相反，是一组**互补**的杠杆。
 *   F. ★ **可执行引用指向 tmp/**（**W49 新增**）：把一条 `` `node scripts/xxx.mjs` ``
 *      改成 `` `node rp-workspace/tmp/xxx.mjs` ``（**本机真实存在**的临时探针）——
 *      判据① 会放行（磁盘上有），**只有判据⑤ 能抓到**。
 *   G. ★★ **受守面清单与它声称的单源分叉**（**W65 新增**，守判据⑥）：
 *      **GOAL 侧**把 §八 E-H 行里的 `docs/MOBILE-TEST-METHODOLOGY.md` 换成**另一份真实存在**的文档
 *      （★ 必须「真实存在」，否则会被「悬空位置声明」先接住 ⇒ 测到的是别的判据）；
 *      **代码侧**从源码 `E_H_DOCS` 删一项 —— 修前**静默通过**且读数行仍自称「扫描 4 份」（**P-30**）。
 *   H. ★★ **跨文档章节引用不可达**（**W69 新增**，守判据⑦）：
 *      把 GOAL §九 的 `docs/MOBILE-TEST-METHODOLOGY.md` §5.4 改成 **§5.99**（方法论无此节）。
 *      ★ **H2**：同一缺陷的**简称形态**（「方法论 §x.y」）—— 两种写法**各自**要有控（成对，**P-58**）。
 *   I. ★★ **跨文件路径判据的豁免窗口不得过宽**（**W70 新增**，守 **P-67 纪律②/③**）：
 *      注入一条**不存在的** `scripts/…` 引用，并在**前 20 字**处放一个**讲别的事的**豁免词
 *      ⇒ 修前**静默放过**（**P-67 实测**）⇒ 必须报红；
 *      ★ **I2**：**词表收紧**那一半（`示例/举例` 已移出 ⇒ 不再能豁免任何引用）——
 *      与 I 是**同一处缺陷的两个成因**，只做一侧留下半个盲区。
 *   J. ★★ **行号式引用越界**（**W79 新增**，守判据⑧）：
 *      把方法论 §5.4 段里的 `build-dsht.ps1:211-230` 改成 **`build-dsht.ps1:11111-22222`**
 *      （该文件实测只有 1630 行）—— 修前 **`audit-doc-refs` 等六个闸门全部 exit=0**（**P-30**）；
 *      ★★ **底本必须用「方法论」而非 GOAL**：GOAL 的该形态**全落在史实区**（被 mask）
 *      ⇒ 在 GOAL 副本上注入**测不到判据**（**P-45**：注入点必须落在判据真正的扫描面上）。
 *      ★ **J2**：同一判据的**区间写反**分支（起 > 止）—— 两种分支**各自**要有控（成对，**P-58**）。
 *   ★ 纪律（块注释内不得出现「星号紧跟斜杠」—— **P-41 推论四**：注释内容本身也能破坏语法）。
 * ★★ **本清单的自守**：上列字母键与实现里的分组键由 `audit-selftest-claims.mjs`
 *   的 `headNoteListProblems`（W73 新增）逐条对账 —— 此前只写到 F 而实现已有 I
 *   （**W73 实测的真缺陷**：**P-71 的补集**）。
 *
 * ## 纪律（R7 / R23 / B11）
 *   ① ★★ **全程只用 `--file <临时副本>`，绝不碰真实文档** —— 这是 **P-48 的更强形态：
 *      「能不改就不改」比「改了能还原」更安全**（W45 建立的纪律）；
 *   ② 每段真跑闸门，要求**报红且理由正确**；改回 ⇒ **回绿**（证明不是把判据改坏造成的）；
 *   ③ 退出码：0 = 全过；1 = 有断言失败；2 = 环境问题（fail-closed）。
 *
 * 用法：node scripts/audit-doc-refs-negctl.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const AUDIT = path.join(WS, 'scripts', 'audit-doc-refs.mjs')
/** ★ 用**真实 E-H 文档之一**做注入底本（方法论份量最大、引用最多 ⇒ 最能暴露口径问题） */
const SRC = path.join(ROOT, 'docs', 'MOBILE-TEST-METHODOLOGY.md')
const TMP_DIR = path.join(WS, 'tmp')
const COPY = path.join(TMP_DIR, 'w46-docrefs-negctl-copy.md')

let total = 0, fail = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

/**
 * 跑闸门（`--file` 指定副本）；**不抛** —— 非 0 退出码是期望结果。
 *
 * ★★ **必须同时传 `--as <文档名>`**（**W49 修 —— 本负控自己踩到的坑**）：
 *   `--file` 只给路径，而**区段语义（史实区 mask）依赖文档身份**；
 *   副本文件名里通常带 `copy` 等字样 ⇒ 按文件名兜底推断会**认不出是哪个文档**
 *   ⇒ `HISTORY_SECTION_RE` 查不到 ⇒ **不 mask** ⇒ 史实区里的旧引用报红
 *   ⇒ 本负控的「基线必须绿」**当场失败**（看起来像「闸门坏了」，实际是**负控没传身份**）。
 *   ★ 这正是 **P-45** 的又一形态：**判据口径依赖输入的身份，而调用方没把身份传进去**。
 */
function runAudit (docPath, asName) {
  const args = [AUDIT, '--file', docPath]
  if (asName) args.push('--as', asName)
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

if (!fs.existsSync(AUDIT)) { console.error(`✗ 找不到 ${AUDIT}`); process.exit(2) }
if (!fs.existsSync(SRC)) { console.error(`✗ 找不到底本文档 ${SRC}`); process.exit(2) }
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const ORIG = fs.readFileSync(SRC, 'utf8')
const lines = ORIG.split('\n')
/** 底本的**文档名**（必须随 `--file` 一起传给闸门 —— 见 `runAudit` 头注） */
const SRC_NAME = 'MOBILE-TEST-METHODOLOGY.md'

// ---- 基线：把**未注入的原文档**写成副本 ⇒ 闸门必须**绿**（否则后面的「报红」无判据力）----
fs.writeFileSync(COPY, ORIG, 'utf8')
const base = runAudit(COPY, SRC_NAME)
t('基线：未注入的真文档副本 ⇒ 闸门为绿（否则后面的「报红」无判据力）', base.code === 0,
  `exit=${base.code} ${base.out.split('\n').find(l => l.includes('OK ——'))?.slice(0, 60) ?? ''}`)

/** 在副本上注入 → 跑 → 断言；然后**恢复副本**（供下一段复用） */
function drill (label, mutate, wantKind) {
  const copy = lines.slice()
  if (!mutate(copy)) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
  const r = runAudit(COPY, SRC_NAME)
  const hit = r.code !== 0 && r.out.includes(wantKind)
  t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
  t(`${label}：报红理由正确（${wantKind}）`, hit,
    r.out.split('\n').find(l => /✗/.test(l))?.slice(0, 110) ?? '')
  fs.writeFileSync(COPY, ORIG, 'utf8')   // 恢复（幂等）
  return r.code !== 0 && hit
}

// ---- ★★ GOAL 底本（**W49 新增**）------------------------------------------------
//   ★ 为什么需要**第二份底本**：判据⑤ 的真缺陷（`tmp/` 引用）**只出现在 GOAL §三**，
//     而**可执行引用的负控在方法论上结构上跑不通** —— 实测方法论里
//     「非史实区的可执行引用 = **0 处**」（它的可执行引用全在 §六 及之后 = 史实区，会被 mask）。
//   ★ 记录底本（`SRC_NAME` 随 `--file` 一起传 —— 见 `runAudit` 头注）。
const GOAL_SRC = path.join(ROOT, 'docs', 'GOAL.md')
const GOAL_COPY = path.join(TMP_DIR, 'w49-docrefs-goal-copy.md')
if (!fs.existsSync(GOAL_SRC)) { console.error(`✗ 找不到 ${GOAL_SRC}`); process.exit(2) }
const GOAL_ORIG = fs.readFileSync(GOAL_SRC, 'utf8')
const goalLines = GOAL_ORIG.split('\n')

/** 在 GOAL 副本上跑（同样的 drill 语义，底本换成 GOAL） */
function drillGoal (label, mutate, wantKind) {
  const copy = goalLines.slice()
  if (!mutate(copy)) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  fs.writeFileSync(GOAL_COPY, copy.join('\n'), 'utf8')
  const r = runAudit(GOAL_COPY, 'GOAL.md')
  const hit = r.code !== 0 && r.out.includes(wantKind)
  t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
  t(`${label}：报红理由正确（${wantKind}）`, hit,
    r.out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
  fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
  return r.code !== 0 && hit
}

// 基线：未注入的真实 GOAL 副本 ⇒ **必须绿**（§3.1 已于 W49 修正）
fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
const gBase = runAudit(GOAL_COPY, 'GOAL.md')
t('★基线（GOAL 底本）：未注入的真实 GOAL 副本 ⇒ 闸门为绿（否则后面「报红」无判据力）', gBase.code === 0,
  `exit=${gBase.code} ${gBase.out.split('\n').find(l => l.includes('OK ——'))?.slice(0, 70) ?? gBase.out.split('\n')[0]?.slice(0, 70) ?? ''}`)

// ---- A：悬空位置声明（把一处 `scripts/xxx.mjs` 改成不存在的名字）----
//   ★★ **注入锚点必须落在「非史实区」**（**W49 实测的坑**）：
//     W49 给「方法论 §六（及之后）」加了**区段语义 mask**（那是逐轮记录区，**写下时是真的**）
//     ⇒ 原先的锚点（`audit-baseline-claims.mjs` 出现在 §6.48 以内 = **史实区**）
//     被 mask 掉 ⇒ **注入后闸门报绿**（= **假负控**：测的不是判据，是 mask）。
//     ⇒ 锚点改用 §5.4（**当前状态区**，在 §六 之前）里的引用。
//   ★ 这条与「负控 E 必须用 GOAL 底本」是同一纪律：**注入点必须落在闸门真正的扫描面上**（P-1）。
const dA = drill('负控A（悬空位置声明）', (ls) => {
  const i = ls.findIndex(l => /`scripts\/selftest-summary\.mjs`/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('`scripts/selftest-summary.mjs`', '`scripts/selftest-summary-ghost.mjs`')
  return ls[i].includes('ghost')
}, 'scripts 位置声明')

// ---- B：★ 并列装置位置不一致（**W46 的真实缺陷形态**）----
//   ★ 同样必须落在**非史实区**：锚到 §5.4 的 P-52 定义行之前（`## 六、` 之前）插入
const dB = drill('负控B（并列装置位置不一致）', (ls) => {
  const six = ls.findIndex(l => /^##\s*六、/.test(l))
  const at = six > 10 ? six - 3 : Math.floor(ls.length / 2)
  ls[at] = `${ls[at]}\n测试注入：\`audit-baseline-claims.mjs\` 与 \`session-contract-probe.mjs\` 并列陈述。`
  return true
}, '并列装置位置不一致')

// ---- C：可执行引用悬空 ----
//   ★★ **锚点必须落在「非史实区」**（**W49 实测两次踩到**）：
//     ⑴ `verify-rp-consolidation.mjs` 的引用在方法论 §6.x（**史实区**）⇒ 被 mask ⇒ **假负控**；
//     ⑵ 改用 `audit-session-integrity.mjs --all` 后**仍失败** —— 实测该写法在方法论里
//        **3 处全在 §六 之后**（且**非史实区的可执行引用 = 0 处**）⇒ 方法论底本**结构上无法**测这条。
//     ⇒ 结论：**可执行引用的负控必须跑在 GOAL 底本上**（它的非史实区有 15+ 处可执行引用）。
//   ★ 这正是 **P-45 / P-1**：**注入点必须落在闸门真正会看的区域里**。
const dC = drillGoal('负控C（可执行引用悬空）', (ls) => {
  const i = ls.findIndex(l => l.includes('`node rp-workspace/scripts/verify-apk-payload.py`') || l.includes('`python rp-workspace/scripts/verify-apk-payload.py`'))
  if (i < 0) return false
  ls[i] = ls[i].replace(/(`(?:node|python) )rp-workspace\/scripts\/verify-apk-payload\.py`/, '$1rp-workspace/scripts/verify-apk-payload-nope.py`')
  return ls[i].includes('nope')
}, '可执行引用')

// ---- D：★★ 引用目标**不在版本控制内**（**W49 的真实缺陷形态**）----
//   ★ 关键：注入成 `` `node rp-workspace/tmp/xxx.mjs` `` —— 该文件**本机磁盘上真实存在**
//     （`tmp/` 里有大量历史探针）⇒ 判据① **放行**（这正是 ①②③ 结构性看不见它的原因），
//     只有**判据⑤** 能抓到（读者照抄 ⇒ 别人克隆后扑空，P-53）。
const dD = drillGoal('负控D（引用目标不在版本控制内）', (ls) => {
  const i = ls.findIndex(l => l.includes('`node rp-workspace/scripts/ef-journey-all.mjs --auto --yes`'))
  if (i < 0) return false
  ls[i] = ls[i].replace('`node rp-workspace/scripts/ef-journey-all.mjs --auto --yes`', '`node rp-workspace/tmp/w32-all-projectable.mjs`')
  return ls[i].includes('tmp/w32-all-projectable')
}, '不在版本控制内')

// ---- E/F：★★ 史实区 mask 的杠杆（**W49 新增**；底本与 `drillGoal` 定义见上文 GOAL 块）----
//   ★ 为什么这一段必须用 GOAL 底本：判据⑤ 的真缺陷**只出现在 GOAL §三**（E-H 四份里 0 处）
//     ⇒ 用方法论做底本**测不到**它（P-45：扫描面与真目标对齐）。

// E：在 §3.1 里注入一条**新行**：`node rp-workspace/tmp/...` ⇒ 必须报「不在版本控制内」
//   ★ 两条实测纪律（都由本轮负控当场证伪后固化）：
//     ⑴ **必须追加新行**，不能就地改已有行 —— §3.1 那行含「不存在」字样（讲的是别的装置），
//        就地注入会落进就近否定窗口 ⇒ 报绿（假负控）；
//     ⑵ ★★ **注入文本自身不得含豁免词**（「负控」「示例」「举例」…）—— 判据的豁免窗口是
//        **±40 字**，注入句里写「本行由负控注入」会把**自己的注入**豁免掉（本轮实测第二次踩到）。
//        ⇒ 注入文本一律写成**中性的普通句子**。
const dE = drillGoal('负控E（GOAL §3.1 新增一行引用 tmp/ ⇒ 判据⑤ 报红）', (ls) => {
  const i = ls.findIndex(l => /^### 3\.1/.test(l) || /^## 三、/.test(l))
  if (i < 0) return false
  ls.splice(i + 1, 0, '跑 `node rp-workspace/tmp/w32-all-projectable.mjs` 即可看到读数。')
  return true
}, '不在版本控制内')

// F：★ **mask 的杠杆** —— 把史实区标记（`## 十一、`）改名 ⇒ mask 失效
//   ⇒ 史实区里那些**旧引用**（`node tmp/…` 等）**立刻报红**。
//   ★ 它证的是「mask **真的在起作用**」，与 A~E「注入 ⇒ 报红」方向**互补**。
//   ★ wantKind 用泛化的 `✗`（史实区里旧引用的形态不止一种 —— 判据④/⑤ 都可能报，
//     本条**只问「是否真的红了」**，不问红的理由；理由由 A~E 各自断言）。
const dF = drillGoal('杠杆F（史实区 mask 真的在起作用）', (ls) => {
  const i = ls.findIndex(l => /^##\s*十一、/.test(l))
  if (i < 0) return false
  // 改成**非主章节**标题（不匹配 MAIN_SECTION_RE，也不匹配 GOAL 的史实区规则）⇒ mask 不再开启
  ls[i] = ls[i].replace(/^##\s*十一、/, '## 十一（改名后不再是主章节）')
  return !/^##\s*十一、/.test(ls[i])
}, '✗')

// ---- ★★ 杠杆（P-20）：每段「改回」后必须回绿 ----
fs.writeFileSync(COPY, ORIG, 'utf8')
const back = runAudit(COPY, SRC_NAME)
t('★杠杆：方法论底本三段注入全部改回 ⇒ **必须回绿**（证明「注入⇒报红」不是判据恒定红）', back.code === 0, `exit=${back.code}`)

// ---- ★★ G（**W65 新增**）：受守面清单必须与它声称的单源（GOAL §八 E-H）一致 ----
//   ★ 为什么必须补（**P-59 纪律③**）：W65 给闸门加了**判据⑥**（`scanFaceSotProblems`），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**。
//   ★ 注入形态 = **W65 实测的两种静默分叉**（修前**都是 exit=0** —— 正是本轮真缺陷的形态）：
//     ① **GOAL 侧改名单**：把 §八 E-H 行里的 `docs/MOBILE-TEST-METHODOLOGY.md`
//        换成**另一份真实存在**的文档（`docs/V0.3-FREEZE.md`）——
//        ★ 必须换成**真实存在**的文档，否则会被既有的「悬空位置声明」先接住，
//        那样测到的是**别的判据**（W65 实验 A 当场踩到：报红但理由不对）。
//     ② **代码侧删一份**：从源码 `E_H_DOCS` 里删掉一项 —— 修前**静默通过**
//        且读数行仍自称「扫描 4 份（E-H 四份 + SSOT）」（**读数自己自相矛盾而闸门报绿**，P-30）。
//   ★ 底本用 GOAL（判据⑥ 的 GOAL 侧输入来自 `--file` 传的那份 —— 见主流程注释）。
const dG = drillGoal('负控G（受守面清单与 GOAL §八 E-H 分叉）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*\*\*E-H\*\*/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('`docs/MOBILE-TEST-METHODOLOGY.md`', '`docs/V0.3-FREEZE.md`')
  return ls[i].includes('V0.3-FREEZE.md') && !ls[i].includes('MOBILE-TEST-METHODOLOGY.md')
}, '受守面单源')

// G2：**代码侧删一份** —— 用源码副本跑（不动真实源码，P-48 更强形态）
//   ★ 为什么必须单列一段：它与 G 的**注入方向相反**（一个改文档、一个改代码），
//     只做一侧会留下半个盲区（P-58：同类断言的**两侧**都要守）。
{
  const SRC_AUDIT = fs.readFileSync(AUDIT, 'utf8')
  const PROBE_AUDIT = path.join(WS, 'scripts', 'w65-negctl-probe.mjs')
  const patched = SRC_AUDIT.replace(
    "  ['MOBILE-TEST-METHODOLOGY.md', path.join(ROOT, 'docs', 'MOBILE-TEST-METHODOLOGY.md')]\n", '')
  const mutated = patched.length !== SRC_AUDIT.length
  if (!mutated) {
    t('负控G2 前置：源码副本的清单注入必须真的发生', false, '替换未生效')
  } else {
    fs.writeFileSync(PROBE_AUDIT, patched, 'utf8')
    let out = '', code = 0
    try {
      out = execFileSync(process.execPath, [PROBE_AUDIT], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
    const hit = code !== 0 && /受守面单源|受守面清单与 GOAL/.test(out)
    t('★★负控G2（W65 · 代码侧删一份受守文档 ⇒ 修前**静默 exit=0**）：**必须报红**', code !== 0, `exit=${code}`)
    t('★负控G2：报红理由正确（点名「声称的单源不成立」）', hit,
      out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
    // ★ 杠杆 G2：把源码副本改回 ⇒ 必须回绿
    fs.writeFileSync(PROBE_AUDIT, SRC_AUDIT, 'utf8')
    let out2 = '', code2 = 0
    try {
      out2 = execFileSync(process.execPath, [PROBE_AUDIT], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) { code2 = e.status ?? -1; out2 = `${e.stdout ?? ''}${e.stderr ?? ''}` }
    t('★杠杆G2：源码副本改回原样 ⇒ **必须回绿**（证明负控G2 不是恒定红）', code2 === 0, `exit=${code2}`)
    fs.unlinkSync(PROBE_AUDIT)
  }
}

fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
const gBack = runAudit(GOAL_COPY, 'GOAL.md')
t('★杠杆：GOAL 底本两段注入全部改回 ⇒ **必须回绿**', gBack.code === 0, `exit=${gBack.code}`)

// ---- ★★ H（**W69 新增**）：跨文档章节引用必须**可达**（判据⑦）----
//   ★ 为什么必须补（**P-59 纪律③**）：W69 给闸门加了**判据⑦**（`scanXDocSectionProblems`），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**。
//   ★ 注入形态 = **W69 决定性实验的形态**（修前 `audit-doc-refs` 等**五个闸门全部 exit=0**）：
//     把 GOAL §九 那句 `docs/MOBILE-TEST-METHODOLOGY.md` §5.4 改成 **§5.99**（方法论里无此节）。
//   ★★ **锚点必须落在 `docs/` 反引号内的全名形态**（不是「方法论」简称也算，两种都要有控 ——
//     见 H2）。★ 且**必须落在非史实区**（§九 在 §十一 之前 ⇒ 安全，W49 的坑）。
const dH = drillGoal('负控H（跨文档章节引用不可达 · 全名形态）', (ls) => {
  const i = ls.findIndex(l => l.includes('`docs/MOBILE-TEST-METHODOLOGY.md` §5.4'))
  if (i < 0) return false
  ls[i] = ls[i].replace('`docs/MOBILE-TEST-METHODOLOGY.md` §5.4', '`docs/MOBILE-TEST-METHODOLOGY.md` §5.99')
  return ls[i].includes('§5.99')
}, '跨文档章节引用可达')

// H2：**简称形态**（「方法论 §x.y」）—— 与 H 是**两种写法**，必须各有控（守 P-58 的两侧纪律）
//   ★ 锚点选非史实区里的简称引用（§一~§十 之间）
const dH2 = drillGoal('负控H2（跨文档章节引用不可达 · 简称形态）', (ls) => {
  const lim = ls.findIndex(l => /^##\s*十一、/.test(l))
  const i = ls.findIndex((l, n) => (lim < 0 || n < lim) && /方法论 §6\.\d+/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace(/方法论 §6\.(\d+)/, '方法论 §6.99')
  return ls[i].includes('方法论 §6.99')
}, '跨文档章节引用可达')

// 杠杆 H：未注入的真身 ⇒ **必须回绿**（证明负控H 不是恒定红）
{
  fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
  const r = runAudit(GOAL_COPY, 'GOAL.md')
  t('★杠杆H：未注入的真实 GOAL 副本（章节号都是真实存在的）⇒ **必须回绿**（证明负控H 不是判据恒定红）',
    r.code === 0, `exit=${r.code}`)
}

fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')

// ---- ★★ J（**W79 新增**）：行号式引用必须「目标存在」且「行号在范围内」（判据⑧）----
//   ★ 为什么必须补（**P-59 纪律③**）：W79 给闸门加了**判据⑧**（`scanLineRefProblems`），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**。
//   ★★ **注入形态 = W79 决定性实验的形态**（修前 `audit-doc-refs` 等**六个闸门全部 exit=0**）：
//     把方法论里那句 `build-dsht.ps1:211-230` 改成**越界**行号。
//   ★★ **底本必须用「方法论」而不是 GOAL** —— 判据⑧ 的扫描面里，GOAL 的行号引用
//     恰好**全落在史实区**（被 mask）⇒ 在 GOAL 副本上注入**测不到判据**（**P-45**：
//     注入点必须落在判据真正的扫描面上）。方法论 §5.4 段是**非史实区**且确有该形态。
const dJ = drill('负控J（行号式引用越界）', (ls) => {
  const i = ls.findIndex(l => l.includes('build-dsht.ps1:211-230'))
  if (i < 0) return false
  ls[i] = ls[i].replace('build-dsht.ps1:211-230', 'build-dsht.ps1:11111-22222')
  return ls[i].includes('11111-22222')
}, '行号式引用可达')

// J2：**区间写反**形态（起 > 止）—— 与 J 是**同一判据的两种分支**，必须各有控（P-58 的两侧纪律）
const dJ2 = drill('负控J2（行号式引用区间写反）', (ls) => {
  const i = ls.findIndex(l => l.includes('build-dsht.ps1:211-230'))
  if (i < 0) return false
  ls[i] = ls[i].replace('build-dsht.ps1:211-230', 'build-dsht.ps1:230-211')
  return ls[i].includes('230-211')
}, '行号式引用可达')

// 杠杆 J：把注入**改回原样** ⇒ **必须回绿**（证明负控 J / J2 不是恒定红）
{
  fs.writeFileSync(COPY, ORIG, 'utf8')
  const r = runAudit(COPY, 'MOBILE-TEST-METHODOLOGY.md')
  t('★杠杆J：未注入的真实方法论副本 ⇒ **必须回绿**（证明负控J/J2 不是判据恒定红）',
    r.code === 0, `exit=${r.code}`)
}

fs.writeFileSync(COPY, ORIG, 'utf8')

// ---- ★★ I（**W70 新增**）：跨文件路径判据的**豁免窗口不得过宽**（P-67 纪律②/③）----
//   ★ 为什么必须补（**P-59 纪律③**）：W70 把 `isNegatedNear` 的窗口由 **±40 收窄为「前 12 / 后 6」**、
//     并把 `示例/举例/如：/例：/泛指` 移出词表 —— **口径变了就必须补「变化点」的负控**，
//     否则这次收紧在负控面上是**永远测不到的**。
//   ★★ **注入形态 = W70 决定性实验的形态**（修前**静默放过**）：在 §3.1 追加一行 ——
//     一个**不存在的** `scripts/…` 引用，并在**前 20 字**处放一个**讲别的事的**豁免词
//     （`` 其余段落里提到负控这件事与本行无关 ``）⇒ 读者会照抄那个路径 ⇒ **必须报红**。
//   ★ 底本用 **GOAL**（§3.1 是非史实区，且判据②③ 在 GOAL 上有大量真实位置声明）。
const dI = drillGoal('负控I（W70 · 豁免词在场不得吞掉真缺陷）', (ls) => {
  const i = ls.findIndex(l => /^### 3\.1/.test(l))
  if (i < 0) return false
  ls.splice(i + 1, 0, '其余段落里提到负控这件事与本行的引用无关，见 `scripts/audit-w70-ghost.mjs`。')
  return true
}, '位置声明')

// I2：**词表收紧**的负控（`示例/举例` 已移出 ⇒ 它们**不再能豁免**任何引用）
//   ★ 与 I 的区别：I 测「窗口」，I2 测「词表」。★ 两者是**同一处缺陷的两个成因**（W67 的四条纪律），
//     只做一侧会留下半个盲区（**P-58 的两侧纪律**）。
const dI2 = drillGoal('负控I2（W70 · 「示例」不再豁免）', (ls) => {
  const i = ls.findIndex(l => /^### 3\.1/.test(l))
  if (i < 0) return false
  ls.splice(i + 1, 0, '示例：`scripts/audit-w70-ghost2.mjs` 这个写法是刻意举例的。')
  return true
}, '位置声明')

// 杠杆 I：把注入行**删掉** ⇒ **必须回绿**（证明负控 I / I2 不是恒定红）
{
  fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
  const r = runAudit(GOAL_COPY, 'GOAL.md')
  t('★杠杆I：未注入的真实 GOAL 副本 ⇒ **必须回绿**（证明负控I/I2 不是判据恒定红）',
    r.code === 0, `exit=${r.code}`)
}

fs.writeFileSync(GOAL_COPY, GOAL_ORIG, 'utf8')
const after = fs.readFileSync(SRC, 'utf8')
t('★真实仓库未被触碰（方法论逐字节一致 —— 本负控只用临时副本）', after === ORIG, `len ${after.length} vs ${ORIG.length}`)
const gAfter = fs.readFileSync(GOAL_SRC, 'utf8')
t('★真实仓库未被触碰（**GOAL 逐字节一致** —— 本轮新增的 GOAL 底本也只用副本）', gAfter === GOAL_ORIG, `len ${gAfter.length} vs ${GOAL_ORIG.length}`)

// 清理副本
if (fs.existsSync(COPY)) fs.unlinkSync(COPY)
if (fs.existsSync(GOAL_COPY)) fs.unlinkSync(GOAL_COPY)

console.log(fail === 0
  ? '\n[docrefs-negctl] OK —— 闸门有杠杆（六类注入 ⇒ 报红且理由正确；mask 杠杆 ⇒ 失效即报红；受守面单源的两侧 ⇒ 报红；改回 ⇒ 回绿；真实仓库全程未被触碰）'
  : `\n[docrefs-negctl] ${fail} 项失败 —— 闸门可能已成「死判据」`)
reportSelftest('doc-refs-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
