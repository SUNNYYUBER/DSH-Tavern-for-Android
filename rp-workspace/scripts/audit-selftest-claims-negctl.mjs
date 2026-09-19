#!/usr/bin/env node
/**
 * audit-selftest-claims-negctl.mjs —— **「自证分数声明」闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么必须有
 * `audit-selftest-claims.mjs` 在真实仓库上得 **0 违规** —— 既可能是「声明确实都对」（好），
 * 也可能是「**判据被改废了**」（坏）。两者在报告上**长得一样**（都是红的消失）。
 * 唯一区分办法是：**把坏样本注入回真实仓库，看它会不会红**（W31 / W38 / W39 / W40 / W42 同纪律）。
 *
 * ## 注入什么（**逐条对应本仓实测过的真缺陷形态**）
 *   A. **声明过期**：把 GOAL §3.1 里 `audit-goal-sections.mjs` 的声明**改小 1**
 *      （= **W44 实测的真实形态**：W42 扩判据后文档没同步）
 *      ⇒ 要求：报红 + **指向行号** + **同时说出声明值与实际值**；
 *   B. **未接入契约**：把某个**已接入**装置的 `reportSelftest` 调用注释掉
 *      ⇒ 要求：报红，理由是「跑不出统一分数行 ⇒ 声明无法被证伪」；
 *   C. **悬空引用**：把声明里的脚本名改成不存在的
 *      ⇒ 要求：报红，理由是「悬空引用」。
 *   D. ★★ **§3.1 门禁行的裸名形态**（**W61 新增**）：把裸名（无 `.mjs`）的分数**改小** ——
 *      守闸门的 `resolveBare` 层（**P-59 纪律③**：新增扫描层必须同步扩负控）；
 *   E. ★★ **闸门头注声明的判据条数**（**W71 新增**）：把某闸门头注的条数改成**明显大于**实现
 *      （⇒ 报红；★ 注入方向必须是「声明 > 实现」，反向会**空转**，**P-30**）；
 *   F. ★★ **§3.2 表格行内「跨列」的分数声明**（**W72 新增**）：把「脚本名在第 2 列、分数在第 3 列」
 *      那种写法的分数**改坏** ⇒ 必须报红（窗口不得卡在列边界，**P-72**）；
 *   G. ★★ **新接入契约的装置**（**W72 新增**）：把某装置的产出点调用注释掉
 *      ⇒ 必须报红（「跑不出统一分数行 ⇒ 声明无法被证伪」）。
 *   H. ★★ **头注的「无汇总数逐条清单」漏记实现里的分组键**（**W73 新增**）：
 *      把某闸门的头注清单**删掉一行**（清单只写到 X 而实现已有 A~Y）⇒ 必须报红（**P-71 的补集**）。
 * ★ **杠杆**（P-20）：D/E/F/G 各有「改回 ⇒ 必须回绿」的杠杆段。
 * ★★ **本清单的自守**：上列字母键与实现里的分组键由 `audit-selftest-claims.mjs`
 *   的 `headNoteListProblems`（W73 新增）逐条对账 —— 此前只写到 C 而实现已有 G
 *   （**W73 实测的真缺陷**：**P-71 的补集**）。★ 本脚本属**自调用链**（见 P-50 推论一），
 *   故它**不在**上面那条判据的受检面里 —— 这份清单靠**同一条纪律人工跟上**（诚实登记，R7）。
 *
 * ## 纪律（R7 / R23 / B11）
 *   ① 每段**逐字节还原**并**自证还原成功**（还原后必须回绿）；
 *   ② 用**临时副本**做前置演练，失败即不碰真文件；
 *   ③ 退出码：0 = 全过；1 = 有断言失败；2 = 环境问题（fail-closed）。
 *
 * 用法：node scripts/audit-selftest-claims-negctl.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const GOAL = path.join(ROOT, 'docs', 'GOAL.md')
const AUDIT = path.join(WS, 'scripts', 'audit-selftest-claims.mjs')
const TMP_COPY = path.join(WS, 'tmp', 'w44-claims-negctl-copy.md')

let total = 0, fail = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

/** 跑闸门（`--file` 指定文档）；**不抛** —— 非 0 退出码是期望结果 */
function runAudit (docPath) {
  try {
    const out = execFileSync(process.execPath, [AUDIT, '--file', docPath], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }
if (!fs.existsSync(AUDIT)) { console.error(`✗ 找不到 ${AUDIT}`); process.exit(2) }

const ORIG = fs.readFileSync(GOAL, 'utf8')
fs.writeFileSync(path.join(WS, 'tmp', 'w44-claims-negctl-before.md'), ORIG, 'utf8')

// ---- 基线：真实仓库必须**绿**（否则「注入后报红」无判据力）----
const base = runAudit(GOAL)
t('基线：真实仓库闸门为绿（否则后面的「报红」无判据力）', base.code === 0,
  `exit=${base.code} ${base.out.split('\n').find(l => l.includes('OK ——'))?.slice(0, 70) ?? ''}`)

const lines = ORIG.split('\n')

/**
 * ★★★ **W44 实测的真缺陷（R23 级）：被强杀时注入未还原**。
 *
 * ## 事故
 * 本负控会**真写 `docs/GOAL.md`**（注入坏样本 → 跑闸门 → 还原）。首版用
 * `try { 写 } finally { 还原 }` —— 那只覆盖**正常异常**。本轮实测：命令被外部
 * `kill`（超时/人工中止）时，`finally` **不执行** ⇒ GOAL 里残留 `23/24`
 * （注入值）⇒ **下一次闸门报出「声明过期」**，而那**其实是我自己的残留**。
 * ★ 危害：**判据装置把用户的数据留在半途，而报告里没有任何一行说还原没跑**
 * （与 W36 的 `.efjbak` 残留、W37/W38 的设备设置残留**同族** —— **P-48 / R23**）。
 *
 * ## 修法（P-48 三条纪律）
 *   ① 还原做成**幂等函数** `restoreGoal()`（可被任意路径重复调用）；
 *   ② 挂 `SIGINT` / `SIGTERM` / `exit` / `uncaughtException` / `unhandledRejection`
 *      —— **任何中止路径都先还原再退出**；
 *   ③ 还原后**读回校验**且**成功也出声**（否则复核者无法区分「兜底跑了」与「没改过」）。
 * ★ **诚实边界（R7）**：`SIGKILL`（`kill -9`）**无法**被捕获 ⇒ 仍可能残留。
 *   为此额外加两条防线：⑴ 启动时**先检查上次是否留下未还原物**（比对注入特征串）；
 *   ⑵ 备份文件（`w44-claims-negctl-before.md`）**保留**，人工可据此复原。
 */
let goalDirtied = false
const restoreGoal = (reason = 'normal') => {
  if (!goalDirtied) return true
  try {
    fs.writeFileSync(GOAL, ORIG, 'utf8')
    const back = fs.readFileSync(GOAL, 'utf8')
    const ok = back === ORIG
    goalDirtied = !ok
    console.log(`  [夹具安全] GOAL.md 已还原${ok ? '并校验一致' : '但**校验不一致（需人工检查）**'}（触发路径：${reason}）`)
    return ok
  } catch (e) {
    console.error(`  [夹具安全] **还原失败**（${reason}）：${e?.message ?? e} —— 备份仍在 ${'tmp/w44-claims-negctl-before.md'}`)
    return false
  }
}
// ★ 五类中止路径全部兜住（P-48 纪律②）
//   ★★ **W71 扩**：新增一段会**真写 `scripts/audit-doc-refs.mjs`** 的注入（负控E）——
//     故还原必须**同时覆盖源码**，否则被强杀会把**闸门自己**留在坏状态。
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreGoal(sig); restoreSrc(sig); process.exit(1) })
process.on('uncaughtException', (e) => { restoreGoal('uncaughtException'); restoreSrc('uncaughtException'); console.error(e); process.exit(1) })
process.on('unhandledRejection', (e) => { restoreGoal('unhandledRejection'); restoreSrc('unhandledRejection'); console.error(e); process.exit(1) })
process.on('exit', () => { restoreGoal('exit'); restoreSrc('exit') })
/**
 * ★★ **源码注入的还原**（**W71 新增** —— 负控E 会真写 `audit-doc-refs.mjs` 的头注）。
 * ★ 与 `restoreGoal` 同法（P-48 三条纪律）：**幂等** + **成功也出声** + **读回校验**。
 * ★ 诚实边界（R7）：`SIGKILL` 无法捕获 ⇒ 仍可能残留；为此 `TARGET_ORIG` 在内存里持有原文，
 *   且下一次运行会**读回校验**（见下方启动自检）。
 */
let srcDirtied = false
let SRC_TARGET = null
let SRC_ORIG = null
const restoreSrc = (reason = 'normal') => {
  if (!srcDirtied || !SRC_TARGET || !SRC_ORIG) return true
  try {
    fs.writeFileSync(SRC_TARGET, SRC_ORIG, 'utf8')
    const back = fs.readFileSync(SRC_TARGET, 'utf8')
    const ok = back === SRC_ORIG
    console.log(`  [夹具安全] 闸门源码已还原（触发路径：${reason}）· 逐字节一致=${ok}`)
    srcDirtied = false
    return ok
  } catch (e) {
    console.error(`  [夹具安全] ★ 闸门源码还原失败（${reason}）：${e.message}`)
    return false
  }
}

// ★ 启动自检：上次若留下未还原物 ⇒ **当场出声并先还原**（P-48 纪律③）
//   ★★ W52 修：判据改为「**结构性**」——原本写死 `23/24` 这个「注入痕迹」，
//     而该类痕迹会随被守对象演进（分数从 24/24 变成 28/28）⇒ **自检失效**（P-19 的时间维度）。
//     ⇒ 改为：**GOAL 必须与 `ORIG`（本脚本读到的当前内容）一致** —— 我们已经持有原文，无需去猜痕迹长什么样。
{
  const onDisk = fs.readFileSync(GOAL, 'utf8')
  if (onDisk !== ORIG) {
    console.error('  [夹具安全] ★ 检测到 GOAL.md 与读取时**不一致**（疑似上次未还原的注入）—— 先还原再继续')
    fs.writeFileSync(GOAL, ORIG, 'utf8')
  }
}

/**
 * 在文本行里找「audit-goal-sections 的分数声明」，取出**当前**分数（动态）。
 *
 * ★★ 为什么必须动态（**W52 实测的真缺陷**）：首版把分数**写死**成 `24/24`
 *   ⇒ 该闸门扩判据、文档同步为 `28/28` 后，锚点**再也命中不了** ⇒ **负控整套静默失效**
 *   （`exit=0`；而报告只说「注入后未报红」，**看起来像闸门被改坏了**）。
 *   ★ 这是 **P-19**（凭印象写锚点 = 无效证据）的**时间维度**形态：
 *     **锚点当时是对的，但会随被守对象演进而过期**。
 *   ⇒ 纪律：**负控锚点只写「形态」，不写「值」**。
 */
function findScoreLine (ls) {
  const i = ls.findIndex(l => /audit-goal-sections\.mjs/.test(l) && /\d+\/\d+/.test(l))
  if (i < 0) return null
  const m = /(\d+)\/(\d+)/.exec(ls[i])
  return m ? { i, pass: Number(m[1]), total: Number(m[2]) } : null
}

/** 临时副本演练：注入后跑闸门，必须报红且输出含 wantRe */
function drill (label, mutate, wantRe, detail = '') {
  const copy = lines.slice()
  const okMutate = mutate(copy)
  if (!okMutate) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  fs.writeFileSync(TMP_COPY, copy.join('\n'), 'utf8')
  const r = runAudit(TMP_COPY)
  const hit = wantRe.test(r.out)
  t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
  t(`${label}：报红理由正确${detail ? `（${detail}）` : ''}`, hit,
    r.out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '')
  return r.code !== 0 && hit
}

// ---- A：声明过期（把 §3.1 里 audit-goal-sections 的分数改小 1）----
//   ★★ **锚点动态取**（**W52 实测的真缺陷**）：写死分数 ⇒ 该闸门扩判据后锚点**再也命中不了**
//     ⇒ 负控静默失效（`exit=0`），而报告只说「未报红」，**看起来像闸门被改坏了**。
//     ⇒ 纪律：**负控锚点只写「形态」，不写「值」**（**P-19** 的时间维度）。
const dA = drill('负控A（声明过期）', (ls) => {
  const f = findScoreLine(ls)
  if (!f) return false
  ls[f.i] = ls[f.i].replace(`${f.pass}/${f.total}`, `${f.pass - 1}/${f.total}`)
  return true
}, /声明过期/, '把当前分数改小 1（动态取原值）')

// ---- C：悬空引用（把声明里的脚本名改成不存在）----
//   ★★ **锚点必须动态取**（与负控 A 同源纪律，见其头注）。
const dC = drill('负控C（悬空引用）', (ls) => {
  const f = findScoreLine(ls)
  if (!f) return false
  ls[f.i] = ls[f.i].replace('audit-goal-sections.mjs', 'audit-goal-sections-ghost.mjs')
  return true
}, /悬空引用/, '声明的脚本不存在')

// ---- ★★ D（**W61 新增**）：**裸名形态**（§3.1 门禁行）的声明过期 ----
//   ★ 为什么必须补（**P-59 纪律③**）：W61 给闸门加了「不带扩展名的裸名也认」这一层
//     （`resolveBare`），而**负控若不覆盖它**，该层就是**永远测不到的死判据**。
//   ★ 注入形态 = **W61 实测的真缺陷形态**：§3.1 门禁行写 `` `audit-goal-sections` 28/28 ``
//     （裸名，无 `.mjs`），而该闸门实测已是 35/35 ⇒ 旧口径**一条都抽不到** ⇒ 无人守。
//   ★ 锚点**只写形态不写值**（P-19 的时间维度，W52 的教训）—— 动态取当前分数改小 5。
//   ★★ 注入锚点必须**覆盖真实写法**（W61 实测踩到）：文档里是裸的 `` `audit-goal-sections` 35/35 ``
//     （**没有 `**` 强调符**），首版锚点写成 `` `x` **N/M** `` ⇒ **`.replace()` 不匹配**
//     ⇒ 注入没生效 ⇒ 负控 D 报「注入后未报红」，**看起来像闸门坏了**（P-19「凭印象写锚点」）。
const BARE_RE = /`audit-goal-sections`\s*\*{0,2}(\d+)\s*\/\s*(\d+)\*{0,2}/
const dD = drill('负控D（§3.1 裸名形态的声明过期）', (ls) => {
  const i = ls.findIndex(l => BARE_RE.test(l))
  if (i < 0) return false
  const m = BARE_RE.exec(ls[i])
  ls[i] = ls[i].replace(m[0], m[0].replace(`${m[1]}/${m[2]}`, `${Number(m[1]) - 5}/${m[2]}`))
  return BARE_RE.test(ls[i]) && ls[i].includes(`${Number(m[1]) - 5}/${m[2]}`)
}, /声明过期/, '裸名（无 .mjs）的分数改小 5（动态取原值 + 覆盖裸写法）')

// ---- ★★ 杠杆 D（P-20）：把裸名分数改回**与实测一致** ⇒ 必须回绿 ----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => BARE_RE.test(l))
  if (i < 0) {
    t('杠杆D 前置：§3.1 裸名声明行必须能定位', false, `行下标=${i}`)
  } else {
    const m = BARE_RE.exec(copy[i])
    const bad = m[0].replace(`${m[1]}/${m[2]}`, `${Number(m[1]) - 5}/${m[2]}`)
    copy[i] = copy[i].replace(m[0], bad)
    if (!copy[i].includes(bad)) {
      t('杠杆D 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      copy[i] = copy[i].replace(bad, m[0])   // 改回与实测一致
      fs.writeFileSync(TMP_COPY, copy.join('\n'), 'utf8')
      const r = runAudit(TMP_COPY)
      t('★杠杆D：§3.1 裸名分数改回**与实测一致** ⇒ **必须回绿**（证明负控 D 不是恒定红）', r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ E（**W71 新增**）：**闸门头注声明的判据条数**必须与实现一致 ----
//   ★ 为什么必须补（**P-59 纪律③**）：W71 给闸门加了 `headNoteCountProblems` ——
//     **口径变了就必须补「变化点」的负控**，否则这次新增在负控面上**永远测不到**。
//   ★★ **注入形态 = W71 实测的真缺陷形态**：把某个闸门的头注数字**改小**（修前 `audit-doc-refs`
//     写「五条」而实现七条）⇒ **必须报红**。
//   ★ **用源码副本注入，不碰真实源码**（**P-48 最强形态**：「能不改就不改」）——
//     与 G2 组（改 `E_H_DOCS` 清单）同一手法。
//   ★★ **注入方向必须「声明 > 实现」**（**W71 实测当场踩到**）：
//     首版注入「**一条**」（小于实现的 7 条）⇒ 按判据的「**≥**」口径（圈号可作子编号 `⑦a`，
//     故允许实现多于声明）**不报红** ⇒ 负控**空转**（**P-30**：看起来测了，实际没测到）。
//     ⇒ 改成注入一个**明显大于**实现条数的数字（**九十九**）。
//   ★ 这正是 **P-19** 的形态：**注入载荷必须真的能触发判据的那条分支**。
//   ★★ **W79 再修（第二次踩同一个坑 —— 诚实留痕）**：注入值原为 `**九十九条**`，而判据的
//     中文数字解析是 `CN_NUM[m[1][0]]`（**只取首字**）⇒ 「九十九」被读成 **9**；
//     而 W79 给 `audit-doc-refs.mjs` 补了**判据⑧**（叙述里用到 ⑧）⇒ 实现里的**圈号并集**
//     从 7 涨到 **10** ⇒ `9 ≤ 10` ⇒ **判据不报红 ⇒ 负控空转**（**P-30**：看起来测了，实际没测到）。
//     ⇒ 改注入**阿拉伯数字 999**（无歧义，且**必然**大于任何现实的实现条数）。
//     ★ 元教训：**负控的注入载荷不得依赖「判据的某种解析口径」** —— 用**最少解释空间**的写法。
{
  const TARGET = path.join(WS, 'scripts', 'audit-doc-refs.mjs')
  const TARGET_ORIG = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null
  if (TARGET_ORIG === null) {
    t('负控E 前置：目标闸门 audit-doc-refs.mjs 必须存在', false, TARGET)
  } else {
    // ① 注入：把它的头注条数改成**明显大于实现**的数字（动态读原值，不写死）
    const m = TARGET_ORIG.match(/##\s*判据\s*[（(][^)）]{0,40}?(\d+|[一二三四五六七八九十]+)\s*[条项]/)
    const inj = TARGET_ORIG.replace(m[0], '## 判据（**999 条**）')
    const mutated = inj !== TARGET_ORIG
    if (!mutated) {
      t('负控E 前置：头注注入必须真的发生', false, `锚点=${m && m[0]}`)
    } else {
      SRC_TARGET = TARGET
      SRC_ORIG = TARGET_ORIG
      srcDirtied = true   // ★ P-48 纪律②：「写盘」与「登记」**同一处**（无窗口）
      fs.writeFileSync(TARGET, inj, 'utf8')
      let out = '', code = 0
      try {
        out = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
      t('★★负控E（W71 · 头注条数过期 ⇒ 修前**七个闸门全 exit=0**）：**必须报红**', code !== 0, `exit=${code}`)
      const hit = /头注声明|判据 \*\*\d+ 条\*\*/.test(out)
      t('★负控E：报红理由正确（点名「头注声明的条数在实现里找不齐」）', hit,
        out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
      // ② **杠杆 E**：把源码改回原样 ⇒ **必须回绿**
      restoreSrc('normal')
      let out2 = '', code2 = 0
      try {
        out2 = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) { code2 = e.status ?? -1; out2 = `${e.stdout ?? ''}${e.stderr ?? ''}` }
      t('★杠杆E：头注改回原样 ⇒ **必须回绿**（证明负控E 不是判据恒定红）', code2 === 0, `exit=${code2}`)
      // ③ ★ 真实源码**未被触碰**自证（逐字节）
      const back = fs.readFileSync(TARGET, 'utf8')
      t('★负控E：真实闸门源码**逐字节还原**（本段只用「写回原文」的幂等手法）',
        back === TARGET_ORIG, `len ${back.length} vs ${TARGET_ORIG.length}`)
    }
  }
}

// ---- ★★ F（**W72 新增**）：**§3.2 表格行内「跨列」的分数声明**必须被抽到 ----
//   ★ 为什么必须补（**P-59 纪律③**）：W72 给抽取窗口新增了「**表格行跨列**」口径 ——
//     **口径变了就必须补「变化点」的负控**，否则这次新增在负控面上**永远测不到**。
//   ★★ **注入形态 = W72 实测的真缺陷形态**：§3.2 门禁清单的写法是
//     `| 7 | `scripts/audit-build-path-parity.py` | …（selftest **38/38**）` ——
//     脚本名在**第 2 列**、分数在**第 3 列** ⇒ 旧口径下窗口只有 2 字 ⇒ **整类抽不到**。
//     ⇒ 把那一列里的分数**改坏**若**不报红**，说明新口径**没生效**（P-30）。
//   ★ 锚点**只写形态不写值**（**P-19** 的时间维度，W52 的教训）—— 动态取该行 `selftest`
//     之后的第一个 `N/M`，不依赖它的具体数值（数值随判据演进会变）。
const F_TABLE_ROW_RE = /`scripts\/audit-build-path-parity\.py`/
const fFindRow = (ls) => ls.findIndex(l => /^\s*\|/.test(l) && F_TABLE_ROW_RE.test(l) && /selftest/.test(l))
const dF = drill('负控F（§3.2 表格行 · 跨列分数）', (ls) => {
  const i = fFindRow(ls)
  if (i < 0) return false
  const k = ls[i].indexOf('selftest')
  const m = /(\d+)\s*\/\s*(\d+)/.exec(ls[i].slice(k))
  if (!m) return false
  const at = k + m.index
  ls[i] = ls[i].slice(0, at) + '1/1' + ls[i].slice(at + m[0].length)
  return /selftest[\s*]*1\/1/.test(ls[i])
}, /声明过期/, '脚本名在第 2 列、分数在第 3 列（窗口不得卡在列边界 `|`）')

// ---- ★★ 杠杆 F（P-20）：把该行改回**与实测一致** ⇒ 必须回绿 ----
{
  const copy = ORIG.split('\n')
  const i = fFindRow(copy)
  if (i < 0) {
    t('杠杆F 前置：§3.2 表格行必须能定位', false, `行下标=${i}`)
  } else {
    const k = copy[i].indexOf('selftest')
    const m = /(\d+)\s*\/\s*(\d+)/.exec(copy[i].slice(k))
    const at = k + (m ? m.index : 0)
    const orig = m ? m[0] : ''
    const INJ = '1/1'
    copy[i] = copy[i].slice(0, at) + INJ + copy[i].slice(at + orig.length)
    if (!/selftest[\s*]*1\/1/.test(copy[i])) {
      t('杠杆F 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      // ★ 还原：注入串是 INJ（长度可能与被替换的原值不同）⇒ **必须按 INJ.length 回退**
      //   （首版写成 `at + 2` 是**按注入值长度猜的**，实测当场报红 —— 属 **P-19 凭印象写锚点**）
      copy[i] = copy[i].slice(0, at) + orig + copy[i].slice(at + INJ.length)
      fs.writeFileSync(TMP_COPY, copy.join('\n'), 'utf8')
      const r = runAudit(TMP_COPY)
      t('★杠杆F：§3.2 表格行分数改回**与实测一致** ⇒ **必须回绿**（证明负控 F 不是恒定红）', r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ G（**W72 新增**）：**新接入契约的装置**必须真的能被读出分数 ----
//   ★ 为什么必须补（**P-59 纪律③ / P-50**）：W72 把 **7 个装置**接入单源输出契约 ——
//     **接入动作本身**必须有负控，否则「已接入」与「接入后又断了」在报告上同貌（**P-30**）。
//   ★★ **注入形态 = W72 修前的真身**：`audit-official-contract.mjs` 收尾**不调 `reportSelftest`**
//     ⇒ 跑不出统一分数行 ⇒ 文档里「selftest 8/8」这句声明**无法被证伪**。
//   ★ 手法与 W71 的负控E **同法**（源码副本注入 + `restoreSrc` 兜底，**P-48 三条纪律**）——
//     但注入点不同：E 改的是**头注条数**，本组改的是**收尾的产出点调用**。
{
  const TARGET = path.join(WS, 'scripts', 'audit-official-contract.mjs')
  const TARGET_ORIG = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null
  if (TARGET_ORIG === null) {
    t('负控G 前置：目标闸门 audit-official-contract.mjs 必须存在', false, TARGET)
  } else {
    // ① 注入：把**唯一产出点调用**注释掉（不是删掉整行 —— 保留原文形态便于还原比对）
    const callRe = /(\breportSelftest\('official-contract'[^\n]*\))/
    const inj = callRe.test(TARGET_ORIG) ? TARGET_ORIG.replace(callRe, '// $1') : null
    if (inj === null || inj === TARGET_ORIG) {
      t('负控G 前置：收尾产出点调用必须能定位（否则本组空转）', false, `锚点命中=${inj !== null}`)
    } else {
      SRC_TARGET = TARGET
      SRC_ORIG = TARGET_ORIG
      srcDirtied = true   // ★ P-48 纪律②：「写盘」与「登记」**同一处**（无窗口）
      fs.writeFileSync(TARGET, inj, 'utf8')
      let out = '', code = 0
      try {
        out = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
      t('★★负控G（W72 · 装置断开契约 ⇒ 声明无法被证伪）：**必须报红**', code !== 0, `exit=${code}`)
      const hit = /无法被证伪/.test(out)
      t('★负控G：报红理由正确（点名「跑不出统一分数行 ⇒ 声明无法被证伪」）', hit,
        out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
      // ② **杠杆 G**：改回原样 ⇒ **必须回绿**
      restoreSrc('normal')
      let out2 = '', code2 = 0
      try {
        out2 = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) { code2 = e.status ?? -1; out2 = `${e.stdout ?? ''}${e.stderr ?? ''}` }
      t('★杠杆G：产出点调用改回原样 ⇒ **必须回绿**（证明负控G 不是判据恒定红）', code2 === 0, `exit=${code2}`)
      // ③ ★ 真实源码**未被触碰**自证（逐字节）
      const back = fs.readFileSync(TARGET, 'utf8')
      t('★负控G：真实闸门源码**逐字节还原**（本段只用「写回原文」的幂等手法）',
        back === TARGET_ORIG, `len ${back.length} vs ${TARGET_ORIG.length}`)
    }
  }
}

// ---- ★★ H（**W73 新增**）：**头注的「无汇总数逐条清单」漏记实现里的分组键** ----
//   ★ 为什么必须补（**P-59 纪律③**）：W73 给闸门加了 `headNoteListProblems` ——
//     **口径变了就必须补「变化点」的负控**，否则这次新增在负控面上**永远测不到**。
//   ★★ **注入形态 = W73 实测的真缺陷形态**：把某负控闸门头注清单里**最后一条**删掉
//     （修前 `audit-baseline-claims-negctl.mjs` 只写到 B 而实现已有 M）⇒ **必须报红**。
//   ★ 手法与负控E/G **同法**（源码副本注入 + `restoreSrc` 兜底，**P-48 三条纪律**）——
//     但注入点不同：E 改头注**条数**、G 改**收尾产出点**，本组改头注**逐条清单**。
{
  const TARGET = path.join(WS, 'scripts', 'audit-rule-claims-negctl.mjs')
  const TARGET_ORIG = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null
  if (TARGET_ORIG === null) {
    t('负控H 前置：目标闸门 audit-rule-claims-negctl.mjs 必须存在', false, TARGET)
  } else {
    // ① 注入：把头注清单里**最长的那条键**对应行删掉（动态取，不写死 —— 锚点只写形态，P-19）
    const headLines = TARGET_ORIG.split(/\r?\n/)
    const impAt = headLines.findIndex(l => /^\s*import\s/.test(l))
    const headEnd = impAt > 0 ? impAt : 40
    let lastKey = '', lastKeyAt = -1
    for (let i = 0; i < headEnd; i += 1) {
      const m = headLines[i].match(/^\s*\*\s+\*{0,2}([A-Z])\*{0,2}\s*[.、)）]\s*\S/)
      if (m) { lastKey = m[1]; lastKeyAt = i }
    }
    if (lastKeyAt < 0) {
      t('负控H 前置：该闸门头注里必须有字母清单（否则本组空转）', false, `lastKey=${lastKey}`)
    } else {
      const inj = headLines.slice()
      inj.splice(lastKeyAt, 1)   // 删掉最后一条清单项 ⇒ 清单「漏记」了它
      const injText = inj.join('\n')
      const mutated = injText !== TARGET_ORIG && !injText.includes(`${lastKey}. `)
      if (!mutated) {
        t('负控H 前置：头注清单条目必须真的被删掉', false, `键=${lastKey} 行=${lastKeyAt + 1}`)
      } else {
        SRC_TARGET = TARGET
        SRC_ORIG = TARGET_ORIG
        srcDirtied = true   // ★ P-48 纪律②：「写盘」与「登记」**同一处**（无窗口）
        fs.writeFileSync(TARGET, injText, 'utf8')
        let out = '', code = 0
        try {
          out = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
        t(`★★负控H（W73 · 头注清单漏记「${lastKey}」⇒ 修前**无人守**）：**必须报红**`, code !== 0, `exit=${code}`)
        const hit = /漏记/.test(out)
        t('★负控H：报红理由正确（点名「清单只写到 X 而实现已有 A~Y ⇒ 漏记 …」）', hit,
          out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
        // ② **杠杆 H**：把源码改回原样 ⇒ **必须回绿**
        restoreSrc('normal')
        let out2 = '', code2 = 0
        try {
          out2 = execFileSync(process.execPath, [AUDIT], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (e) { code2 = e.status ?? -1; out2 = `${e.stdout ?? ''}${e.stderr ?? ''}` }
        t('★杠杆H：头注清单改回原样 ⇒ **必须回绿**（证明负控H 不是判据恒定红）', code2 === 0, `exit=${code2}`)
        // ③ ★ 真实源码**未被触碰**自证（逐字节）
        const back = fs.readFileSync(TARGET, 'utf8')
        t('★负控H：真实闸门源码**逐字节还原**（本段只用「写回原文」的幂等手法）',
          back === TARGET_ORIG, `len ${back.length} vs ${TARGET_ORIG.length}`)
      }
    }
  }
}

// ---- ★ 真注入真还原（A + C 一起，最大化「还原是否真的干净」的证据强度）----
console.log('\n--- 真实仓库注入 / 逐字节还原 ---')
const injected = lines.slice()
let nInj = 0
{
  const f = findScoreLine(injected)
  if (f) {
    // ★ 把分数**改小 1**（动态：不依赖具体数值）
    injected[f.i] = injected[f.i].replace(`${f.pass}/${f.total}`, `${f.pass - 1}/${f.total}`)
    // ★ 同时把负控 A 的锚点也换掉（悬空引用）—— 与上面同源
    nInj += 1
  }
}
if (nInj === 0) console.error('  [warn] 注入锚点未命中（真实仓库注入段未生效）')
else {
  try {
    fs.writeFileSync(GOAL, injected.join('\n'), 'utf8')
    goalDirtied = true   // ★ P-48 纪律②：「写盘」与「登记」**同一处**（无窗口）
    const rInj = runAudit(GOAL)
    t('真实仓库：注入「声明过期」后 ⇒ 报红', rInj.code !== 0, `exit=${rInj.code}`)
    // ★★ W52 修：断言改为**结构性** —— 不再写死具体数值（会随被守对象演进过期），
    //   只要求报红串**同时出现「声明值」与「实际值」两个分数**（这才是本条要测的能力）。
    const twoVals = /\*\*\d+\/\d+\*\*/.test(rInj.out) && /实际是 \*\*\d+\/\d+\*\*/.test(rInj.out)
    t('真实仓库：报红**同时**说出声明值与实际值（结构性断言，不写死具体数字）',
      twoVals, rInj.out.split('\n').find(l => /✗/.test(l))?.slice(0, 110) ?? '')
  } finally {
    restoreGoal('normal')   // 幂等；信号/异常路径也已挂（见文件头注释）
  }
}

// ---- 还原自证：**逐字节**一致 + 闸门回绿 ----
const back = fs.readFileSync(GOAL, 'utf8')
t('还原：逐字节一致（自证）', back === ORIG, `len ${back.length} vs ${ORIG.length}`)
const rBack = runAudit(GOAL)
t('还原后：闸门回绿（证明「注入⇒报红」不是把判据改坏造成的）', rBack.code === 0, `exit=${rBack.code}`)

// 清理临时副本
for (const f of ['w44-claims-negctl-copy.md']) {
  const p = path.join(WS, 'tmp', f)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

console.log(fail === 0 ? `\n[claims-negctl] OK —— 闸门有杠杆（注入 ⇒ 报红且指向行号；还原 ⇒ 回绿；逐字节自证）` : `\n[claims-negctl] ${fail} 项失败 —— 闸门可能已成「死判据」`)
reportSelftest('selftest-claims-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
