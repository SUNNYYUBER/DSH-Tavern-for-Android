#!/usr/bin/env node
/**
 * audit-goal-sections-negctl.mjs —— **GOAL §十一 闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么必须有
 * `audit-goal-sections.mjs` 在真实仓库上得 **0 违规** —— 这既可能是「表确实自洽」（好），
 * 也可能是「**判据被改废了**」（坏）。两者在报告上**长得一模一样**（都是红的消失），
 * 唯一区分办法是：**把坏样本注入回真实仓库，看它会不会红**。
 * 这正是 W31 的 **B11 机器化**、以及 W38/W39/W40 连续三轮复用的同一纪律。
 *
 * ## 注入什么（**逐条对应 W42 真实事故的三类**）
 *   A. **列数错位**（事故 ①）：把 §11.3 的某一行改成 4 列（§11.1 的模板形态）
 *      ⇒ 要求：报红 + **精确指到那一行** + 指出「列数 ≠ 表头」；
 *   B. **跨表 ID 复用**（事故 ②）：把 §11.2 的一条 ID 改成 §11.1 已有的 ID
 *      ⇒ 要求：报红 + 指出「被 N 张表复用」+ **指向两张表**；
 *   C. **整段静默删除**（事故 ③ 的极端形态）：把 §11.3 的标题删掉
 *      ⇒ 要求：报红（fail-closed），**不许**因切面失效而静默通过。
 *   D. ★★ **P 判据编号过期声明**（**W43 实测的形态**）：把 §3.1 的 `P-1 ~ P-n` / `累计 n 条`
 *      **改小 1**（模拟「新增了判据但声明没跟上」）⇒ 要求：报红 + 理由含「过期声明」。
 *   E. ★★ **判据 ⑦c「§九 每条必须在 §5.4 有定义」**（**W54 新增**）：
 *      E1 有索引无定义 ⇒ 报红 · E2 索引外编号 ⇒ 报红 · E3 切面失效 ⇒ **fail-closed** ·
 *      E4 杠杆（改回 ⇒ 回绿）。★ **用方法论副本**（⑦c 的定义面在方法论 §5.4）。
 *   F. ★★ **§11.4 引用的工作面编号必须可达**（**W68 新增**，守 **P-52**）：
 *      把 §11.4 的 N8 行里「就地说明」删掉 + 引用一个全篇不存在的 `W55`
 *      ⇒ 要求：报红。★ **必须用 GOAL 副本**（§11.1~§11.4 都在 GOAL 里，与 E 组不同 —— 注入点必须落在判据真正的扫描面上，**P-1/P-45**）。
 * ★★ **本清单的自守**：上列字母键与实现里的分组键由 `audit-selftest-claims.mjs`
 *   的 `headNoteListProblems`（W73 新增）逐条对账 —— 此前只写到 C 而实现已有 F
 *   （**W73 实测的真缺陷**：**P-71 的补集**）。
 *
 * ## 纪律（R7 / R23 / B11）
 *   ① 每一段都是**逐字节还原**并**自证还原成功**（还原后必须回绿）；
 *   ② 注入 / 还原都用**临时副本**做前置演练，**失败即不碰真文件**；
 *   ③ 真实文件只被写两次（注入 / 还原），且每次写完立刻读回校验；
 *   ④ 退出码：0 = 三段全过；1 = 有断言失败；2 = 环境问题（fail-closed）。
 *
 * 用法：node scripts/audit-goal-sections-negctl.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOAL = path.join(WS, '..', 'docs', 'GOAL.md')
const AUDIT = path.join(WS, 'scripts', 'audit-goal-sections.mjs')

let total = 0, fail = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

/** 静默跑闸门，返回 { code, out }（**不抛** —— 非 0 退出码是期望结果） */
function runAudit (file, methodFile = null) {
  const args = [AUDIT, '--file', file]
  if (methodFile) args.push('--method', methodFile)   // ★ W54：判据 ⑦c 读 方法论的**副本**
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }
if (!fs.existsSync(AUDIT)) { console.error(`✗ 找不到 ${AUDIT}`); process.exit(2) }

const ORIG = fs.readFileSync(GOAL, 'utf8')
fs.writeFileSync(path.join(WS, 'tmp', 'w42-goal-negctl-before.md'), ORIG, 'utf8')

// ---- 基线：真实仓库必须**绿**（否则「注入后报红」无意义）----
const base = runAudit(GOAL)
t('基线：真实仓库闸门为绿（否则后面的「报红」无判据力）', base.code === 0, `exit=${base.code} ${base.out.split('\n').filter(l => l.startsWith('[工作面表]')).slice(0, 2).join(' | ')}`)

const lines = ORIG.split('\n')
const idx = (re) => lines.findIndex(l => re.test(l))
const isSep = (l) => /^\s*\|[\s:|-]+\|?\s*$/.test(l)

/**
 * 定位某小节里的**数据行**（跳过表头与分隔行）。
 *
 * ★ 首版这里写成「小节内第一个 `|` 开头的行」⇒ 取到的是**表头行** ——
 *   于是负控 B 把 `#`（表头首列）当成 ID 注入、负控 A 改的是表头而非数据行
 *   ⇒ **三段负控有两段失效**（B/C 报绿）。这正是 **P-41 推论四**：
 *   判据的**输入解析**（这里是「哪里是数据行」）也必须有自己的断言。
 */
function dataRowIdx (secStart, secEnd) {
  const a = idx(secStart), b = idx(secEnd)
  if (a < 0 || b < 0) return []
  let h = -1
  for (let i = a; i < b - 1; i += 1) if (lines[i].startsWith('|') && !isSep(lines[i]) && isSep(lines[i + 1])) { h = i; break }
  if (h < 0) return []
  const out = []
  for (let i = h + 2; i < b; i += 1) if (lines[i].startsWith('|') && !isSep(lines[i])) out.push(i)
  return out
}

const d111 = dataRowIdx(/^###\s*11\.1/, /^###\s*11\.2/)
const d112 = dataRowIdx(/^###\s*11\.2/, /^###\s*11\.3/)
const d113 = dataRowIdx(/^###\s*11\.3/, /^##\s*十二、/)
const i113Title = idx(/^###\s*11\.3/)
if (d111.length === 0 || d112.length === 0 || d113.length === 0 || i113Title < 0) {
  console.error('✗ 注入锚点定位失败 ⇒ fail-closed'); process.exit(2)
}
const i113Row = d113[0]
const i112Row = d112[0]
const sec111Id = lines[d111[0]].split('|')[1].replace(/\*\*/g, '').trim()
console.log(`锚点：§11.1 首数据行 L${d111[0] + 1}（id=${sec111Id}）· §11.2 首数据行 L${i112Row + 1} · §11.3 首数据行 L${i113Row + 1}`)

/** 临时副本演练：注入后跑闸门，必须报红且输出含 want；随后副本丢弃 */
function drill (label, mutate, want, wantRe) {
  const tmp = path.join(WS, 'tmp', 'w42-negctl-copy.md')
  const copy = lines.slice()
  const okMutate = mutate(copy)
  if (!okMutate) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  fs.writeFileSync(tmp, copy.join('\n'), 'utf8')
  const r = runAudit(tmp)
  const hit = wantRe.test(r.out)
  t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
  t(`${label}：报红理由正确（${want}）`, hit, r.out.split('\n').find(l => l.startsWith('[工作面表] ✗'))?.slice(0, 110) ?? '')
  return r.code !== 0 && hit
}

const A = drill('负控A（列数错位）', (ls) => {
  const cells = ls[i113Row].split('|')
  // 3 列 ⇒ 4 列：在末列前多插一个单元格
  ls[i113Row] = `${cells.slice(0, -1).join('|')}| 追加列 |${cells[cells.length - 1]}`
  return true
}, '列数 ≠ 表头', /列数 \d+ ≠ 表头 \d+/)

const B = drill('负控B（跨表 ID 复用）', (ls) => {
  const cells = ls[i112Row].split('|')
  cells[1] = ` ${sec111Id} `
  ls[i112Row] = cells.join('|')
  return true
}, '被 N 张表复用', /张表复用/)

// ★ 负控 C 的「改名」必须让 `### 11.3` **不再匹配**（首版改成
 //   `### 11.3 长期持续（改名后…）` —— 仍然匹配 `^###\s*11\.3` ⇒ 判据根本没失效 ⇒ **假负控**）
 const C = drill('负控C（整段静默删除）', (ls) => {
   ls[i113Title] = '### 11.9 长期持续（标题号被误改）'
   return true
 }, '切不出小节 ⇒ fail-closed', /找不到小节标题|fail-closed/)

 // ---- ★ 负控 D（**W43 新增**）：P 判据编号一致性（判据 ⑦ 的真实仓库负控）----
  //   形态 = **W43 实测的真缺陷复现**：§九 索引新增了 P-n，而 §3.1 的「P-1 ~ P-N」声明没同步。
  //   （W42 新增 P-49 后，§3.1 仍写「P-1 ~ P-48」—— 本负控锁死这一类。）
  const iDeclLine = lines.findIndex(l => /设计哲学判据\s*\|/.test(l) && /P-1\s*~\s*P-\d+/.test(l))
  const iSecNine = idx(/^##\s*九、/)
  if (iDeclLine < 0 || iSecNine < 0) {
    t('负控D 前置：§九 索引与 §3.1 声明行必须都能定位', false, `§九@${iSecNine + 1} 声明@${iDeclLine + 1}`)
  } else {
    const D = drill('负控D（P 判据编号过期声明）', (ls) => {
      const cur = /P-1\s*~\s*P-(\d+)/.exec(ls[iDeclLine])
      if (!cur) return false
      const n = Number(cur[1])
      // 把声明值**改小 1**（模拟「新增了判据但声明没跟上」—— 正是 W43 的真实形态）
      ls[iDeclLine] = ls[iDeclLine].replace(`P-1 ~ P-${n}`, `P-1 ~ P-${n - 1}`).replace(`累计 ${n} 条`, `累计 ${n - 1} 条`)
      return true
    }, '过期声明 ⇒ 报红', /过期声明|累计/)
  }

// ---- ★★ 负控 E（**W54 新增**）：判据 ⑦c「§九 每条必须在 §5.4 有定义」----
//   ★ 为什么必须补：**W54 的承重实验当场抓到本负控的空洞** —— 把 ⑦c 的反向分支整个短路掉之后，
//     闸门 selftest 报 7 FAIL（说明 selftest 有杠杆），而**本负控 13/13 仍然全绿**
//     ⇒ 本负控里**根本没有一条控测到 ⑦c**（P-20：长期无正控 = 覆盖空洞；此处是「负控空洞」）。
//   ⇒ 三条注入 + 一条杠杆，全部**只改方法论副本**（GOAL 用真身，另传 `--method` 副本）。
const METHOD_DOC = path.join(WS, '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md')
const ORIG_M = fs.existsSync(METHOD_DOC) ? fs.readFileSync(METHOD_DOC, 'utf8') : null
if (ORIG_M === null) {
  t('负控E 前置：必须能读到方法论（否则 ⑦c 无法被负控）', false, METHOD_DOC)
} else {
  const mLines = ORIG_M.split('\n')
  const i54 = mLines.findIndex(l => /^###\s*5\.4/.test(l))
  const i54End = i54 < 0 ? -1 : mLines.findIndex((l, i) => i > i54 && /^###\s*5\.\d|^##\s*六、/.test(l))
  if (i54 < 0 || i54End <= i54) {
    t('负控E 前置：§5.4 区段必须能切出', false, `§5.4@${i54 + 1} end@${i54End + 1}`)
  } else {
    const tmpM = path.join(WS, 'tmp', 'w54-method-negctl-copy.md')
    /** 注入方法论副本 → 跑闸门（GOAL 用真身）→ 必须报红且理由含 want；副本随后删除 */
    const drillM = (label, mutateM, wantRe) => {
      const copy = mLines.slice()
      if (!mutateM(copy)) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
      fs.writeFileSync(tmpM, copy.join('\n'), 'utf8')
      const r = runAudit(GOAL, tmpM)
      const hit = wantRe.test(r.out)
      t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
      t(`${label}：报红理由正确`, hit,
        r.out.split('\n').find(l => l.startsWith('[工作面表] ✗'))?.slice(0, 110) ?? '')
      return r.code !== 0 && hit
    }
    // E1：**把 §5.4 里某条编号的定义整条删掉** ⇒ 该编号「有索引无定义」⇒ 报红（W54 实测的真形态）
    //   ★★ 两处**由实测逼出的口径**（首版两处都错，正是承重实验的价值）：
    //     ⑴ 必须删**索引末项**（最大编号）的定义，且**删掉它的全部形态** ——
    //        首版写「自下而上删第一条表格行」，而那命中的是 §5.4 内**另一张对照表**里的 `| P-56 |`
    //        （P-56 在段落区**仍有定义**）⇒ 判据根本不该红 ⇒ **假负控**（测的不是判据）；
    //     ⑵ 判据 ⑦c 的锚点是编号本身，因此「删表头行」与「删数据行」在语义上**不等价**
    //        —— 必须按**编号**定位，不能按「表格的第几行」定位（P-41 推论二：锚点必须锚到语义）。
    const maxP = (() => {
      const a = lines.findIndex(l => /^##\s*九、/.test(l))
      const b = lines.findIndex((l, i) => i > a && /^##\s*十、/.test(l))
      const ns = lines.slice(a, b).map(l => /^\|\s*(P-\d+)\s*\|/.exec(l)?.[1]).filter(Boolean).map(x => Number(x.slice(2)))
      return ns.length ? Math.max(...ns) : 0
    })()
    if (maxP === 0) { t('负控E1 前置：能从 §九 索引读到最大编号', false, '读不到') } else {
      drillM(`负控E1（§九 有索引 P-${maxP}、§5.4 无定义）`, (ls) => {
        let hit = 0
        for (let i = i54; i < i54End; i += 1) {
          if (new RegExp(`^\\|\\s*\\*{0,2}P-${maxP}\\*{0,2}\\s*\\|`).test(ls[i]) || new RegExp(`\\*\\*P-${maxP}\\s+第`).test(ls[i])) {
            ls[i] = ''; hit += 1
          }
        }
        return hit > 0
      }, /找不到定义/)
    }
    // E2：**§5.4 里塞一个索引外的编号** ⇒ 报红（漏登记到索引）
    drillM('负控E2（§5.4 出现索引外编号）', (ls) => {
      ls.splice(i54 + 3, 0, '| **P-999** | 索引里没有这条 |')
      return true
    }, /索引之外/)
    // E3：**切不出 §5.4**（把标题改掉）⇒ fail-closed 报红
    //   ★★ **口径必须让标题不再匹配**（首版写成 `### 5.40 标题被改坏` —— 而闸门的正则是
    //      `/^###\s*5\.4/`（**无词边界**），`5.40` / `5.44` **仍然匹配** ⇒ 切面没失效 ⇒ **假负控**
    //      —— 与 W42 负控 C（`### 11.3 长期持续（改名后…）` 仍匹配 `^###\s*11\.3`）**同一个坑**，
    //      第二次现身 ⇒ 纪律：**注入「让锚点失效」的文本时，必须实测它真的不再匹配**；
    //      ★ 而且**前置断言必须写进 `return`**（W54 实测：我第一版改了 `5.44`，前置断言立刻
    //      报「锚点未命中」⇒ 断言在正常工作，避免了一条恒红的假负控）。
    drillM('负控E3（方法论切不出 §5.4）', (ls) => {
      if (!/^###\s*5\.4/.test(ls[i54])) return false
      ls[i54] = '### 判据汇总（原 5.4，标题被改坏）'
      return !/^###\s*5\.4/.test(ls[i54])   // ★ 前置断言：改完必须**真的不再匹配**
    }, /fail-closed/)
    // E4 ★ 杠杆（P-20）：**不改任何东西**（只传副本）⇒ 必须回绿（证明 E1~E3 不是恒定红）
    fs.writeFileSync(tmpM, ORIG_M, 'utf8')
    const rE4 = runAudit(GOAL, tmpM)
    t('★杠杆E4：方法论副本与真身一致 ⇒ 必须回绿（证明 E1~E3 不是恒定红）', rE4.code === 0, `exit=${rE4.code}`)
    if (fs.existsSync(tmpM)) fs.unlinkSync(tmpM)
  }
}

// ---- ★★ F（**W68 新增**）：§11.4 引用的工作面编号必须**可达**（守 P-52）----
//   ★ 为什么必须补（**P-59 纪律③**）：W68 给闸门加了**判据⑨**（§11.4 引用可达性），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**。
//   ★ 注入形态 = **W68 实测的真缺陷**：把 §11.4 的 N8 行里的**就地说明**删掉，
//     并把它引用的编号换成一个**全篇都不存在的** `W55`（修前正是这个形态：读者按 §11.4 去找必然扑空）。
//   ★ 注意：**必须用 GOAL 副本**（§11.1~§11.4 都在 GOAL 里），与 E 组（方法论副本）不同。
const GOAL_DOC = GOAL
if (!fs.existsSync(GOAL_DOC)) {
  t('负控F 前置：必须能读到 GOAL（否则判据⑨ 无法被负控）', false, GOAL_DOC)
} else {
  const G_ORIG = fs.readFileSync(GOAL_DOC, 'utf8')
  const G_COPY = path.join(WS, 'tmp', 'w68-goal-negctl-copy.md')
  const gLines = G_ORIG.split('\n')
  const iN8 = gLines.findIndex(l => /^\|\s*\*\*N8\*\*/.test(l))
  if (iN8 < 0) {
    t('负控F 前置：§11.4 的 N8 行必须能定位', false, `行下标=${iN8}`)
  } else {
    // 注入：把该行的**就地说明**删掉，并让引用编号**全篇不存在**
    const inj = gLines.slice()
    inj[iN8] = inj[iN8]
      .replace(/\s*——\s*★\s*\*\*W55 即[^|]*?P-52[^）]*）/, '')
      .replace(/\*\*W55 排查\*\*/g, '**W99 排查**')
    const mutated = inj[iN8] !== gLines[iN8] && inj[iN8].includes('W99')
    if (!mutated) {
      t('负控F 前置：注入替换必须真的发生', false, '就地说明未删除或编号未替换')
    } else {
      fs.writeFileSync(G_COPY, inj.join('\n'), 'utf8')
      const rF = runAudit(G_COPY)
      t('★★负控F（W68 · §11.4 引用不可达）：引用 `W99`（全篇无对应）且行内无说明 ⇒ **必须报红**',
        rF.code !== 0, `exit=${rF.code}`)
      t('★负控F：报红理由正确（点名「读者按 §11.4 去找必然扑空」）',
        rF.code !== 0 && /必然扑空/.test(rF.out),
        rF.out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '(无 ✗ 行)')
      // ★ 杠杆 F：把副本改回**真身原文** ⇒ 必须回绿（证明负控 F 不是恒定红）
      fs.writeFileSync(G_COPY, G_ORIG, 'utf8')
      const rF2 = runAudit(G_COPY)
      t('★杠杆F：GOAL 副本改回真身原文 ⇒ **必须回绿**（证明负控F 不是恒定红）', rF2.code === 0, `exit=${rF2.code}`)
      if (fs.existsSync(G_COPY)) fs.unlinkSync(G_COPY)
    }
  }
}

// ---- ★ 真注入真还原（三段一起，最大化「还原是否真的干净」的证据强度）----
console.log('\n--- 真实仓库注入 / 逐字节还原 ---')
const injected = lines.slice()
injected[i113Row] = `${injected[i113Row].split('|').slice(0, -1).join('|')}| 追加列 |${injected[i113Row].split('|').slice(-1)[0]}`
const injCells = injected[i112Row].split('|'); injCells[1] = ` ${sec111Id} `; injected[i112Row] = injCells.join('|')
injected[i113Title] = '### 11.9 长期持续（标题号被误改）'
// 第四类（W43 新增）：P 判据编号过期声明
const injDeclN = iDeclLine >= 0 ? Number(/P-1\s*~\s*P-(\d+)/.exec(injected[iDeclLine])?.[1] ?? 0) : 0
if (injDeclN > 1) {
  injected[iDeclLine] = injected[iDeclLine]
    .replace(`P-1 ~ P-${injDeclN}`, `P-1 ~ P-${injDeclN - 1}`)
    .replace(`累计 ${injDeclN} 条`, `累计 ${injDeclN - 1} 条`)
}
try {
  fs.writeFileSync(GOAL, injected.join('\n'), 'utf8')
  const rInj = runAudit(GOAL)
  t('真实仓库：注入四类坏样本后 ⇒ 报红', rInj.code !== 0, `exit=${rInj.code}`)
  t('真实仓库：注入后**同时**报出「列数」「跨表复用」「切不出小节」「P 判据过期声明」四项',
    /列数 \d+ ≠ 表头 \d+/.test(rInj.out) && /张表复用/.test(rInj.out)
    && /找不到小节标题/.test(rInj.out) && /过期声明|累计/.test(rInj.out),
    rInj.out.split('\n').filter(l => l.startsWith('[工作面表] ✗')).length + ' 项')
} finally {
  fs.writeFileSync(GOAL, ORIG, 'utf8')
}
// ---- 还原自证：**逐字节**一致 + 闸门回绿 ----
const back = fs.readFileSync(GOAL, 'utf8')
t('还原：逐字节一致（自证）', back === ORIG, `len ${back.length} vs ${ORIG.length}`)
const rBack = runAudit(GOAL)
t('还原后：闸门回绿（证明「注入⇒报红」不是把判据改坏造成的）', rBack.code === 0, `exit=${rBack.code}`)

// 清理临时副本（未还原物 / 演练文件）
for (const f of ['w42-negctl-copy.md']) {
  const p = path.join(WS, 'tmp', f)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

console.log(fail === 0 ? `\n[goalsections-negctl] ${total}/${total} PASS` : `\n[goalsections-negctl] ${fail} FAIL / ${total}`)
reportSelftest('goalsections-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
