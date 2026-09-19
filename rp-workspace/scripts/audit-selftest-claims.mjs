#!/usr/bin/env node
/**
 * audit-selftest-claims.mjs —— **「文档声明的自证分数」与「脚本实际分数」的一致性闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * 文档里凡写「`scripts/xxx.mjs` … selftest **N/M**」这类**当前状态声明**，
 * 都必须与**脚本实际跑出来的分数**一致。这是 **P-1**（同一事实一处读法）在
 * 「判据体系自证分数」这一格上的落地。
 *
 * ## 为什么必须常驻（**P-11 元级** · W44 由 W43 的分诊带出）
 * W42/W43 给「文档结构」装了闸门，但**闸门自己的分数无法被机器读出** ——
 * 因为收尾输出历史上长成了**三种形态**（实测）：
 *   ① `[x selftest] 24/24 PASS`      ← `N/M` 在前
 *   ② `[selftest] PASS（14/14）`      ← `N/M` 在后
 *   ③ `[openitems-negctl] OK —— 有杠杆（…）` ← **根本不含分数**
 * ⇒ 后果：文档里的分数与实现**可以静默脱钩**。W44 实测抓到两处真缺陷：
 *   · `audit-goal-sections.mjs`/`-negctl`：文档写 16/16 与 11/11，实际已 24/24 与 13/13
 *     （**W42 扩判据后没同步文档**）；
 *   · `audit-p48-negctl.mjs`：文档写 8/8，而脚本**不输出分数** ⇒ 声明**无法被证伪**。
 * ★ 这类不一致**人眼极难发现**（数字散落在 4 份文档的十几处，且格式各异）。
 *
 * ## 前置：单源输出契约（W44 建立）
 * 各装置收尾统一调用 `selftest-summary.mjs` 的 `reportSelftest()`，打印
 *     `[selftest-summary] <name> <pass>/<total> PASS|FAIL`
 * 本闸门**只认这一行**（`SELFTEST_LINE_RE` 从单源 import —— 守 P-1，
 * 不在本文件手抄正则，否则正则会成为第二份事实）。
 *
 * ## 判据（四项）
 *   ① **每个受检脚本都能输出统一分数行**（跑 `--selftest`，取 `[selftest-summary]` 行）；
 *      取不到 ⇒ 报红（说明该装置还没接入契约，或自证本身坏了）；
 *   ② **脚本内的自洽性**：`pass === total` ⟺ 行尾为 `PASS`（防「22/24 PASS」这种错位）；
 *   ③ ★ **文档声明 vs 实际**：从 GOAL + 方法论里抽「脚本名 … selftest N/M」的**声明**，
 *      逐个与实测值比对 ⇒ 不一致即报红（**这是本闸门的核心**）；
 *   ④ **声明里的脚本必须真实存在**（悬空引用 ⇒ 报红）。
 *
 * ## 口径边界（守 P-38，防过宽假红）
 *   · **只在「脚本名与分数在同一行/相邻」时才算声明** —— §6.x 的**历史叙事**里
 *     会出现「当时是 16/16」这类**史实**，那是**不该**被当作当前声明的；
 *     本判据通过「脚本名 + 其后的 selftest 分数」这一**行内邻接**口径来区分
 *     （实测：历史叙事的写法是「**机器化（W42）**：… `audit-x.mjs`（selftest 16/16：」——
 *      它同样会命中，故本判据对**方法论 §6.x 逐轮结论区**整体**排除**，见 `EXCLUDE`）。
 *   · 文档未声明某脚本 ⇒ **不出声**（不是缺陷，只是没写）。
 *
 * ## 诚实边界（R7）
 *   ① 本判据只管「**声明的数字**与实测是否一致」，**不管**「判据内容是否有效」——
 *      后者靠各脚本自己的正负控与杠杆（P-30）。
 *   ② 它**不替代**「分数变好要抬文档」的人工判断：数字变了它会报红，
 *      但「该不该变」仍需人看（例如删掉一条弱判据会让 24/24 变 23/23，那是**该拦**的）。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出不一致    2 = 环境问题    3 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-selftest-claims.mjs --selftest
 *   node scripts/audit-selftest-claims.mjs
 *   node scripts/audit-selftest-claims.mjs --verbose
 *   node scripts/audit-selftest-claims.mjs --file <GOAL 副本>
 *       # 供**真实仓库负控**在注入副本上复核（否则负控无从演练）
 *       # ★ W77 补：此前实现已支持 `--file` 而**用法行没写** ⇒ 能力不可发现
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// ★ 单源：分数行的正则从契约模块 import（不在本文件手抄 —— 否则它会成为第二份事实）
import { SELFTEST_LINE_RE, reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const GOAL = path.join(ROOT, 'docs', 'GOAL.md')
const METHOD = path.join(ROOT, 'docs', 'MOBILE-TEST-METHODOLOGY.md')
const SCRIPTS = path.join(WS, 'scripts')
/** 受检名单的**权威来源**：构建脚本自己（P-27：不硬编码当前状态） */
const BUILD = path.join(WS, 'scripts', 'build-dsht.ps1')

/**
 * **自调用链**（必须排除，否则无限递归 —— W44 实测）：
 * 本闸门的负控**自己会跑本闸门**（注入坏样本 ⇒ 跑 `audit-selftest-claims.mjs` 看是否报红），
 * 所以「闸门探测它」= 「闸门探测一个会跑闸门的东西」 ⇒ 指数递归。
 * ★ 口径：它的分数**在本面无法被证伪**（与设备探针同类），只作**信息项**；
 *   其实际分数由构建期 Step 0.55 单独打印。
 */
const SELF_CALL_CHAIN = new Set(['audit-selftest-claims-negctl.mjs'])

/**
 * 受检脚本名单：**构建期真正会被 `--selftest` 调用的闸门**。
 *
 * ★★ 口径（守 P-38，**首版被真实仓库证伪**：把 30+ 个设备探针也算进来，
 *    一次报出 20+ 处「未接入契约」= **P-45 的识别特征**）：
 *    本判据只关心**构建期能跑的闸门**，因为：
 *      ⑴ 设备探针（`ef-*.mjs`）**构建期不跑**（要 adb + WebView），它们的分数
 *         **无法在构建期被证伪** ⇒ 纳入本判据只会产生**无法收敛的红**；
 *      ⑵ 同理 `session-guard.mjs` 是**库**（不是可执行闸门），没有 `--selftest` 入口。
 *    ⇒ 名单来源 = **实读 `build-dsht.ps1`**（P-27：不硬编码；构建脚本新增闸门时自动跟上），
 *       而不是「扫 scripts 目录里含 `--selftest` 字样的文件」。
 *
 * ★★★ **必须排除「自调用链」**（**W44 实测的真缺陷：无限递归**）：
 *    `audit-selftest-claims-negctl.mjs` 的**自证方式就是跑本闸门**（它注入坏样本再跑
 *    `audit-selftest-claims.mjs`）⇒ 若本闸门再去 `probeSelftest(negctl)`，就会
 *    **闸门 → negctl → 闸门 → negctl …** 指数级递归（每层要跑全部受检闸门），
 *    最终超时被 kill ⇒ 拿不到分数行 ⇒ 报「跑不出统一分数行」（**看起来像装置缺陷，
 *    实际是判据把「自调用」当成了「受检对象」** —— P-45：扫描面必须与真目标对齐）。
 *    ⇒ 该 negctl 的分数由**构建期 Step 0.55 单独打印**（见 `build-dsht.ps1`），
 *      本闸门对它只作**信息项**（不比对），理由与设备探针同类：**在此面无法被证伪**。
 */
export function discoverBuildGates (buildScript, existsFn = () => true, exclude = SELF_CALL_CHAIN) {
  const out = new Set()
  // 形态：`audit-x.mjs` / `verify-x.mjs`（构建脚本里以 Join-Path 或直接文件名出现）
  for (const m of buildScript.matchAll(/(?:scripts[\\/])?((?:audit|verify)-[\w-]+\.(?:mjs|py))/g)) {
    if (exclude.has(m[1])) continue
    if (existsFn(m[1])) out.add(m[1])
  }
  return [...out].sort()
}

/**
 * ★★ **闸门头注声明的「判据条数」必须与实现里的条数一致**（**W71 新增** —— 守 **P-59** 的补集）。
 *
 * ## 由头（W71 实测 —— **同一母题的第三次现身**）
 * **P-59**（W54）确立的是「**头注里逐条声明的判据，实现里必须逐条指认得出来**」；
 * ★ 但**头注标题那一行的「汇总数字」从未被任何机器守** —— 而**扩判据是每轮高频动作**：
 *   · `audit-doc-refs.mjs`：头注写「判据（**五条**）」，实现里已是 **七条**（W65 加 ⑥、W69 加 ⑦）；
 *   · `audit-goal-sections.mjs`：头注写「判据（静态扫 GOAL.md，**五项** + 一项提示）」，
 *     实现里已是 **⑧ 条**（W43 加 ⑦、W52 加 ⑧）。
 * ★★ **决定性实验（W71）**：把 `audit-doc-refs.mjs` 的头注从「五条」改成「**一条**」
 *   ⇒ `audit-selftest-claims` / `audit-goal-sections` / `audit-baseline-claims` /
 *     `audit-rule-claims` / `audit-impl-duplication` / `audit-open-items` / **`audit-doc-refs` 自己**
 *     **七个闸门全部 exit=0**（**P-30**：判据失效与通过同貌）。
 * ★ 为什么它比「正文清单」更容易过期：**正文是「逐条写」的（扩判据时会顺手加一条），
 *   而标题的数字是「汇总量」（需要人回头改）** ⇒ ★★ **汇总量的过期是结构性必然**
 *   （与 **P-27** 同源：会过期的量必须有机器守，否则它**在写下的一刻就开始过期**）。
 *
 * ## 判据（一条，守 P-38 防过宽）
 *   头注里出现 **`判据（… N 条 …）`**（阿拉伯数字或中文数字）⇒
 *   实现里用 `// ①` … `// ⑩` 的**圈号**标出的条数**必须 ≥ N**（取**并集**，去重）。
 *   ★ **为什么是「≥」而不是「=」**：圈号也可用作**子编号**（如 `⑦a` / `⑦b` / `⑦c`，
 *     本仓 `audit-goal-sections` 就用了）⇒ 圈号数会**多于**声明数。
 *     反之若「声明 > 圈号」⇒ **声称的条数在实现里找不齐** ⇒ 才是真缺陷。
 *   ★ **零样本不算通过**：头注写了条数但**文中一个圈号都没有** ⇒ 报红（fail-closed）。
 *   ★ **不判**「没有声明条数的闸门」—— 那是写法自由，不是缺陷（守 **P-38**）。
 *   ★★ **「条」与「项」是同一语义的两种写法**（**W71 实测当场踩到**）：
 *     `audit-goal-sections.mjs` 原来写的是「判据（… **五项** + 一项提示）」——
 *     若正则只认「条」⇒ 该闸门**静默落进「无声明」分支** ⇒ **判据对它零覆盖**
 *     （**P-45**：按写法近似语义 ⇒ 换写法即失守；**P-19**：凭印象写正则的代价）。⇒ 两者都认。
 *
 * ## 诚实边界（R7）
 *   本判据只证「**声明数 ≤ 实现里标出的条数**」，
 *   **不证明**「每条圈号的内容与头注逐条对应」—— 那需要语义比对，
 *   由 **P-59** 的人工/专项复核承接（不假装覆盖）。
 *
 * @param {string} src 闸门源码全文
 * @returns {{problems:string[], declared:number|null, circled:number}}
 */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * ★★ **中文数字 → 整数**（**W79 新增 —— 修的是判据自己的口径缺陷**）。
 *
 * ## 为什么必须修（**W79 实测的负控空转**）
 * 原实现是 `CN_NUM[m[1][0]]`（**只取首字**）⇒ 正则抓到的是**完整串**「九十九」，
 * 而解析只读首字「九」⇒ 被当成 **9** —— ★ 而 W79 新增判据⑧ 后，实现里的**圈号并集**
 * 涨到 **10** ⇒ `9 ≤ 10` ⇒ **判据不报红、负控 E 空转**（**P-30**：看起来测了，实际没测到）。
 *
 * ## 口径（**只认本仓真实会用到的写法**，守 **P-38** 防过宽）
 * `十` / `N十` / `N十M` / `十M` —— 覆盖 1~99；★ **认不出 ⇒ 返回 `null`**
 * （调用方按「无判据力」处理，**P-43**：不许拿猜出来的数去判 FAIL）。
 */
export function parseCnNumber (t) {
  const s = String(t ?? '').trim()
  if (!s) return null
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) {
    const hi = m[1] ? CN_NUM[m[1]] : 1
    const lo = m[2] ? CN_NUM[m[2]] : 0
    return hi * 10 + lo
  }
  if (s.length === 1 && CN_NUM[s] !== undefined) return CN_NUM[s]
  return null   // 认不出（如「九十九」之外的怪写法）⇒ 无判据力
}
export function headNoteCountProblems (src) {
  const s = String(src ?? '')
  // 只查**头注区**（第一个 `import` 之前），避免正文里的同形句子干扰（P-38 防过宽）
  const imp = s.search(/^\s*import\s/m)
  const head = imp > 0 ? s.slice(0, imp) : s
  const m = head.match(/##\s*判据\s*[（(][^)）]{0,40}?(\d+|[一二三四五六七八九十]+)\s*[条项]/)
  if (!m) return { problems: [], declared: null, circled: 0 }
  // ★★ W79 修：原为 `CN_NUM[m[1][0]]`（**只取首字**）⇒ 「九十九」被读成 9 ⇒ **负控空转**。
  const declared = /^\d+$/.test(m[1]) ? Number(m[1]) : parseCnNumber(m[1])
  if (declared === null) return { problems: [], declared: null, circled: 0 }   // 认不出 ⇒ 无判据力（P-43）
  const circled = new Set([...s.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩]/g)].map(x => x[0])).size
  if (circled === 0) {
    return {
      problems: [`头注声明「判据 ${declared} 条」，而**全文找不到任何圈号**（①…⑩）⇒ 无法逐条指认（fail-closed，P-30 零样本不冒充通过）`],
      declared,
      circled
    }
  }
  if (circled < declared) {
    return {
      problems: [`头注声明「判据 **${declared} 条**」，而实现里只标出 **${circled} 条**（圈号并集）`
        + ` ⇒ 声称的条数在实现里**找不齐**（**P-59 的补集**：正文逐条指认得出来，而**标题的汇总数字没人守**）`
        + ` ⇒ 二选一：⑴ 补齐缺失的判据实现；⑵ 把标题的数字改成实际条数`],
      declared,
      circled
    }
  }
  return { problems: [], declared, circled }
}

/**
 * ★★ **头注的「无汇总数逐条清单」必须与实现里的分组一致**（**W73 新增** —— 守 W71 的补集）。
 *
 * ## 由头（W73 实测：**5 处真缺陷**，全部落在 W71 判据的扫描面之外）
 * W71 给「头注标题的**汇总条数**」装了机器守（`headNoteCountProblems`），
 * ★ 但它**只认** `## 判据（**N 条**）` 这一种写法（`/##\s*判据\s*[（(]…\d+\s*[条项]/`）。
 * 而本仓还有**第二种等效写法**：**只有逐条清单、完全没有汇总数** ——
 * 形如 `## 注入什么` + ` *   A. … / B. … / C. …`。
 * ★★ 这种**更危险**：**连「该改哪个数字」都不存在** ⇒ 扩一组时清单**永远不会被想起**
 * （W71 那种至少还有个数字可对；这里**一个可对的东西都没有**）。
 * 实测（全仓穷举 `scripts/audit-*.mjs`）**5 处漏记**，而**五个闸门全 exit=0**（**P-30**）：
 *   · `audit-baseline-claims-negctl.mjs`：清单 A~**B**，实现已有 A~**M**（漏 C/D/E/F/G/H/I/J/K/L/M）
 *   · `audit-rule-claims-negctl.mjs`：A~**C** / A~**G**（漏 D/E/F/G）
 *   · `audit-selftest-claims-negctl.mjs`：A~**C** / A~**G**（漏 D/E/F/G）
 *   · `audit-doc-refs-negctl.mjs`：A~**F** / A~**I**（漏 G/H/I）
 *   · `audit-goal-sections-negctl.mjs`：A~**C** / A~**F**（漏 D/F）
 * ★ 这是 **P-54 / P-72 的同一母题的第三次现身** —— **契约的覆盖面按「写法」界定** ⇒
 * 只守「带汇总数」的那一种，另一种**整类落在扫描面之外**；而两者在报告上**完全同貌**。
 *
 * ## 判据（守 P-38：两侧都取到才判）
 *   ① **头注清单键**：头注区（第一个 `import` 之前）里行首形如 ` *   A. ` / ` *   B) `
 *      （允许 `**` 强调；注释前缀只认 `*` / `#` / `//`）；
 *   ② **实现分组键**：正文里 `// ---- X：` / `// ---- ★★ X（` / `drill('负控X'` / `drill('杠杆X'`；
 *   ③ ★★ **实现有而清单没有的键（且 ≤ 实现的最大键）⇒ 报红**（清单漏记）。
 * ★ **两侧任一为空 ⇒ 不判**（**P-43**：该脚本不用这种写法 ⇒ 本条对它**无判据力**，只出声）。
 * ★ **`≤ 实现最大键` 而非「全等」**：允许清单**多写**（如预留位/说明项），
 *   而**漏写**才是真缺陷 —— 与 W71 的「声明 ≤ 实现条数」**同向**（**P-1**：同一族口径）。
 *
 * ## 一条配套纪律（写进报红文案，供人照做）
 * **只要实现里给了分组键标题，它就该出现在头注清单里** ——
 * 若某组**确实不该进**这份清单（不是「注入什么」那一类），就**别给它加分组键**
 * （改成不带字母的形态）⇒ 这样「清单 vs 实现」的对账**永远是干净的**（**P-61**：收窄要可判定）。
 *
 * @param {string} src 脚本源码全文
 * @returns {{headKeys:Set<string>, implKeys:Set<string>, missing:string[], problems:string[]}}
 */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export function headNoteListProblems (src) {
  const s = String(src ?? '')
  const lines = s.split(/\r?\n/)
  // ★ 头注区 = 第一个 `import` 之前（与 `headNoteCountProblems` **同一口径**，守 P-1）
  const imp = lines.findIndex(l => /^\s*import\s/.test(l))
  const head = lines.slice(0, imp > 0 ? imp : Math.min(lines.length, 90))
  const headKeys = new Set()
  for (const l of head) {
    const m = l.match(/^\s*(?:\*|#|\/\/)\s+\*{0,2}([A-Z])\*{0,2}\s*[.、)）]\s*\S/)
    if (m) headKeys.add(m[1])
  }
  if (headKeys.size === 0) return { headKeys, implKeys: new Set(), missing: [], problems: [] }
  const implKeys = new Set()
  for (const l of lines) {
    const d = l.match(/drill\('(?:负控|杠杆)?\s*([A-Z])\b/)
    if (d) { implKeys.add(d[1]); continue }
    const m = l.match(/^\s*\/\/\s*-{2,}\s*\*{0,2}\s*(?:★+\s*)?([A-Z])\b/)
    if (m) implKeys.add(m[1])
  }
  if (implKeys.size === 0) return { headKeys, implKeys, missing: [], problems: [] }
  const maxIdx = Math.max(...[...implKeys].map(k => ABC.indexOf(k)))
  const missing = [...implKeys].filter(k => ABC.indexOf(k) <= maxIdx && !headKeys.has(k)).sort()

  const problems = missing.length
    ? [`头注的「逐条清单」只写到 **${[...headKeys].sort().pop()}**，而实现里已有 **A~${ABC[maxIdx]}**`
      + `（共 ${implKeys.size} 组）⇒ **漏记 ${missing.join('/')}**`
      + `（**P-71 的补集**：这份清单**没有汇总数**可对 ⇒ 只能按**键集合**比对）`
      + ` ⇒ 二选一：⑴ 把漏掉的组补进清单；⑵ 若某组**不该进**这份清单，就**别给它加分组键标题**`
      + `（改成不带字母的形态）—— 否则「清单 vs 实现」永远对不上（P-61）`]
    : []
  return { headKeys, implKeys, missing, problems }
}

/**
 * ★★ **头注声明的「退出码」必须与实现里真的会出现的码一致**（**W75 新增** —— P-59 家族的第四种形态）。
 *
 * ## 由头（W75 实测：3 处真缺陷）
 * `audit-selftest-claims.mjs` 已守了三类「头注声明 vs 实现」：
 * 「声明的**自证分数**」（W44）·「声明的**判据条数**」（W71）·「头注的**逐条清单**」（W73）。
 * ★ 本轮按 **P-59 纪律①**（头注里的每一条声明都要能在实现里指认出来）穷举**第四类** ——
 * **`## 退出码` 段**。它是**给读者与 CI 用的接口契约**（本仓多处头注写着
 * `0 = 通过  1 = 检出违规（fail-closed）  2 = selftest 失败`）。
 * ★★ **实测 3 处真缺陷**（`audit-error-layer-classify.mjs` · `audit-open-items.mjs` · `audit-rule-claims.mjs`）：
 * 前两者头注声明「**2 = selftest 失败**」，而 selftest 分支实际是 `fail === 0 ? 0 : 1`
 * ⇒ ★★ **「闸门自己坏了」与「闸门检出违规」返回同一个码** —— 头注承诺的**区分根本不存在**，
 * 而两者在报告上**完全同貌**（**P-46 的反面**：两种相反的事实返回同一个读数；**P-30** 的同族）；
 * 后者头注声明 `2 = selftest 失败`，而实现是 `okAll ? 0 : **3**`（且 `2` 被主流程用于「输入缺失」）
 * ⇒ **声明与实际两处都错**。
 *
 * ## 判据（双向，守 P-46：同一读数不得有两种相反解释）
 *   ① 头注区 = 第一个 `import` 之前（与 `headNoteCountProblems` / `headNoteListProblems` **同一口径**，**P-1**）；
 *   ② ★★ **声明面 = 两种排版形态的并集**（**W76 扩**）—— 形态 A：`## 退出码` **段**；
 *      形态 B：**注释行内**（`* 退出码：0 = 全部可加载；1 = 有不可加载`）**＋ 数字起头的续行**；
 *      声明码 = 片段里的 `N = …` / `N 语义词`（★ **跨文档引用编号须先剔除**，见 `parseExitCodes` 口径 ⑴）；
 *   ③ 实现码 = **剥掉注释行与字符串字面量后**的 `process.exit(<expr>)` 里的整数 + `process.exitCode = N`；
 *   ④ ★★ **双向报红**：`声明了但从不出现`（幽灵声明）与 `出现了但未声明`（读者无法解释的读数）。
 *
 * ## 三处口径（均由实测逼出，守 P-38 防假红）
 *   ⑴ ★★ **必须剥字符串字面量** —— `audit-p48-negctl.mjs` 的 selftest **样本数组**里
 *      含 `"...process.exit(130)..."` 这样的**字符串**（讲的就是这件事本身）⇒
 *      不剥就会把**样本**读成**真调用**（**P-30**：判据在错的文本上跑 ⇒ **P-45**）；
 *   ⑵ ★★ **必须认表达式、不能只认字面量** —— 本仓最常见写法是
 *      `process.exit(okAll ? 0 : 3)`（**首版只认 `process.exit(3)` ⇒ 7 个闸门假红**）；
 *   ⑶ ★★ **标准信号码豁免**（`130` = SIGINT / `143` = SIGTERM，POSIX `128+signal` 约定）——
 *      `audit-p48-rollback.mjs` 用它们做**信号兜底**（先还原再退出），**逐条写进头注是冗余**；
 *      ★ 豁免**只对「该码在源码里出现在 `process.on('<SIG>')` 回调内」成立**，不搞无条件放行。
 *
 * @param {string} src 脚本源码全文
 * @returns {{declared:number[], used:number[], ghost:number[], undeclared:number[], problems:string[]}}
 */
const SIGNAL_EXIT_CODES = new Set([130, 143])   // 128+SIGINT / 128+SIGTERM（POSIX 约定）

/**
 * ★★ **「退出码」的两种排版形态**（**W76 新增** —— **P-72** 在本判据自己身上的第三次现身）。
 *
 * ## 由头（W76 实测：**6 处真缺陷整类无守**）
 * W75 给「头注声明的退出码」装了机器守，★ 但它**只认一种写法** —— `## 退出码` **段**。
 * 而本仓还有**第二种等效写法**：把声明写在**注释行内**，形如
 * `* 退出码：0 = 全部可加载；1 = 有不可加载` / `* （退出码 0 = PASS）`。
 * ★★ **实测（全仓穷举，受检面 33 个闸门）**：**29 个**声明了退出码，
 * 其中 **10 个**用的是行内写法 ⇒ **整类落在 W75 的扫描面之外**（判据里 `if (!m) return` 直接放行），
 * 而其中 **6 处已过期**（幽灵声明 2 处 / 未声明的码 4 处）—— **一个闸门都没出声**（**P-30**）。
 * ★ 与 **P-59 家族**的分工：**W44** 管「自证分数」· **W71** 管「汇总条数」· **W73** 管「清单键集合」·
 * **W75** 管「退出码**段**」· ★★ **本条管「退出码的另一种**排版**」** ——
 * 即 **P-72**（同一份声明的**合法写法不止一种**）在**同一个字段**上的再次现身：
 * 上次是「文档排版形态」（表格行跨列），这次是「**注释排版形态**」（段 vs 行内）。
 *
 * ## 口径（三条，全部由实测逼出，守 P-38 防假红）
 *   ⑴ ★★ **引用编号必须剔除** —— `（正常，T-46 待拍板）` / `（结论不可信，P-30）` 里的
 *      `T-46` / `P-30` 是**跨文档引用**，不是退出码；不剔除会把 `46` / `30` 读成声明的码
 *      ⇒ **纯自造的幽灵声明**（**W76 探针首版实测**：`audit-iframe-surface-gap.mjs` 报 `46`、
 *      `ef-sentinel-family.mjs` 报 `30`，两条都是假的）。
 *   ⑵ ★★ **行内形态要连带它的续行** —— 声明常折成两行（`* 退出码：0 = 全部自洽` 换行
 *      `*   1 = 检出违规`）⇒ 逐行抽会把后半段漏掉（**P-41 推论四**：换行即失守）。
 *   ⑶ ★ **0 豁免「幽灵面」** —— 脚本**正常跑完**即隐含 `exit 0`，无需显式 `process.exit(0)`
 *      ⇒ 声明了 `0` 而实现里只有 `? 0 : 1` 这类表达式时，不该报「0 是幽灵」。
 *   ⑷ ★★ **首个码前的分隔符是 `：`** —— `退出码：0 无未裁决重复；1 有…` 这类写法，
 *      `0` 前面紧跟的是**冒号**；首版分隔符集漏了 `：/：` ⇒ **3 个闸门报出「0 未声明」的假红**
 *      （`audit-body-dup-ast.mjs` / `audit-cross-package-css.mjs` 实测，**P-38**）。
 *   ⑸ ★★ **实现面口径按语言分派** —— `.py` 用 `sys.exit(N)` / `return N`，而 `.mjs` 用
 *      `process.exit(...)`；首版一律用 Node 口径 ⇒ `audit-build-path-parity.py` 的
 *      `1 / 2 / 3` **全被判成幽灵**（**P-45**：扫描面与真目标不对齐 ⇒ 整类假红）。
 *
 * @param {string} text 头注里与「退出码」相关的片段
 * @returns {number[]} 抽到的退出码（升序去重）
 */
const REF_CODE = /(?<![A-Za-z0-9_-])[PTWK]-\d+/g   // 跨文档引用编号（P-30 / T-46 / W57 / K-2…）
function parseExitCodes (text) {
  const t = String(text ?? '').replace(REF_CODE, ' ')
  const out = new Set()
  // 形态 ①：`0 = 通过` / `0=通过`（本仓最常见）
  for (const m of t.matchAll(/(\d+)\s*[=＝]\s*(?=\S)/g)) out.add(Number(m[1]))
  // 形态 ②：`0 全 PASS` / `退出码：0 无未裁决重复`（分隔符 + 数字 + 空白 + 语义词；口径 ⑷）
  for (const m of t.matchAll(/(?:^|[/／；;，,。：:]|\s{2,})\s*(\d+)\s+(?=[\u4e00-\u9fffA-Za-z])/g)) out.add(Number(m[1]))
  return [...out]
}

export function exitCodeProblems (src, ext = '.mjs') {

  const s = String(src ?? '')
  const lines = s.split(/\r?\n/)
  const imp = lines.findIndex(l => /^\s*(?:import\s|from\s+\S+\s+import)/.test(l))
  const headLines = lines.slice(0, imp > 0 ? imp : Math.min(lines.length, 90))
  const head = headLines.join('\n')

  // ★★ 声明面 = 两种排版形态的**并集**（口径见 `parseExitCodes` 头注；P-1：同一函数只写一遍）
  const declText = []
  const m = head.match(/##\s*退出码([\s\S]*?)(?=\n\s*\*\s*##|\n\s*##|\*\/)/)
  if (m) declText.push(m[1])                          // 形态 A：`## 退出码` 段
  const stripC = (l) => l.replace(/^\s*(?:\*\s?|\/\/\s?)/, '')
  for (let i = 0; i < headLines.length; i++) {
    const c = stripC(headLines[i])
    const at = c.indexOf('退出码')
    if (at < 0) continue
    let seg = c.slice(at).replace(/^退出码/, '')       // 形态 B：行内（`退出码：…` / `（退出码 …）`）
    for (let j = i + 1; j < headLines.length; j++) {   //   ＋ 数字起头的注释续行（口径 ⑵）
      if (!/^\s*(?:\*|\/\/)/.test(headLines[j])) break
      const n = stripC(headLines[j])
      if (!/^\s*\d/.test(n)) break
      seg += ' ' + n
    }
    declText.push(seg)
  }
  const declared = [...new Set(declText.flatMap(parseExitCodes))].sort((a, b) => a - b)
  if (declared.length === 0) return { declared, used: [], ghost: [], undeclared: [], problems: [] }

  // ★ 剥注释行 + 剥字符串字面量（口径 ⑴）
  //   ★★ **必须限定「不跨行」**（`[^'\n]` 而非 `[^']`）—— **W75 实测踩到**：
  //     首版用 `'(?:\\.|[^'\\])*'`，字符类**能匹配换行** ⇒ 它会从一个 `'` 一路贪婪吃到
  //     很远的另一个 `'`，**把中间的真实 `process.exit(2)` 一起剥掉** ⇒ 报出**纯自造的幽灵声明**
  //     （**P-30 / P-45**：判据在错的文本上跑 ⇒ 读数与已知事实严重不符就是识别特征）。
  const code = lines
    .filter(l => !/^\s*(?:\*|\/\/)/.test(l))
    .join('\n')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\\n])*`/g, '``')

  // ★★ 口径 ⑸（W76 加）：**实现面按语言分派** —— `.mjs` 认 `process.exit(...)` / `process.exitCode = N`；
  //   `.py` 认 `sys.exit(N)` 与 `return N`（**P-45**：扫描面必须与真目标对齐）。
  //   ★ 首版一律用 Node 口径 ⇒ `audit-build-path-parity.py` 声明的 1/2/3 被**全部**判成幽灵（整类假红）。
  // ★★ 口径 ⑹（W76 加）：**实参必须括号配平地取** —— 首版用 `[^)]*`，而
  //   `sys.exit(0 if selftest() else 3)` 里的**内层调用 `()`** 会把捕获**提前截断**
  //   ⇒ 那个 `3` 读不到 ⇒ 报成幽灵（**P-41 推论四**：换形态即失守；字符串已剥，配平安全）。
  const argExprs = (src2, re) => {
    const out = []
    for (const m of src2.matchAll(re)) {
      let i = m.index + m[0].length
      const start = i
      let depth = 1
      while (i < src2.length) {
        const ch = src2[i]
        if (ch === '(') depth += 1
        else if (ch === ')') { depth -= 1; if (depth === 0) break }
        i += 1
      }
      out.push(src2.slice(start, i))
    }
    return out
  }
  const used = new Set()
  if (/\.py$/i.test(ext)) {
    for (const a of argExprs(code, /\bsys\.exit\(/g)) {
      for (const n of a.matchAll(/\b(\d+)\b/g)) used.add(Number(n[1]))
    }
    for (const x of code.matchAll(/^\s*return\s+(\d+)\s*$/gm)) used.add(Number(x[1]))
  } else {
    for (const a of argExprs(code, /process\.exit\(/g)) {
      for (const n of a.matchAll(/\b(\d+)\b/g)) used.add(Number(n[1]))
    }
    for (const x of code.matchAll(/process\.exitCode\s*=\s*(\d+)/g)) used.add(Number(x[1]))
  }
  const usedArr = [...used].sort((a, b) => a - b)

  // ★★ 口径 ⑶（W76 加）：**0 豁免幽灵面** —— 脚本**正常跑完**即隐含 `exit 0`，
  //   无需显式 `process.exit(0)`；故声明了 0 而实现只写 `? 0 : 1` 时**不得**报「0 是幽灵」。
  const ghost = declared.filter(c => c !== 0 && !used.has(c))                        // 声明了但从不出现
  const undeclared = usedArr.filter(c => !declared.includes(c) && !SIGNAL_EXIT_CODES.has(c))
  const problems = []
  if (ghost.length) {
    problems.push(`头注「退出码」声明了 **${ghost.join(' / ')}**，而实现里**从不出现**这些码`
      + ` ⇒ **幽灵声明**：读者（或 CI）会按它去判，而它永远不会发生（**P-59**：头注的声明必须能指认到实现）`
      + ` ⇒ 二选一：⑴ 让实现真的返回它；⑵ 从头注里删掉`)
  }
  if (undeclared.length) {
    problems.push(`实现里返回了头注**未声明**的码 **${undeclared.join(' / ')}**`
      + ` ⇒ 读者拿到该读数时**无从解释**（**P-46**：同一读数不得有两种相反解释的**反面** —— 两种事实必须有两个读数）`
      + ` ⇒ 修法：把它写进头注的「退出码」段或行内声明（★ 标准信号码 130/143 已豁免；★ **0 已豁免幽灵面**）`)
  }
  return { declared, used: usedArr, ghost, undeclared, problems }
}

/**
 * ★★ **闸门支持的「输入面参数」必须被它的负控真的传过**（**W74 新增** —— 守 **P-59 纪律②** 的横向面）。
 *
 * ## 由头（W74 实测：一整类结构性缺口）
 * W54 给 `audit-goal-sections.mjs` 补了 `--method <path>`，理由是
 * 「**判据 ⑦c 要读方法论，负控必须能对方法论副本注入坏样本，否则该条判据无法被负控**」
 * —— 这就是 **P-59 纪律②**。★ 但它**只在那一处落地**。
 * ★★ W74 做**横向穷举**：全仓对账「闸门支持哪些输入面 flag」×「同名负控传了哪些」⇒
 * `audit-baseline-claims.mjs` 支持 `--file / --readme / --freeze / --tasklist`
 * 而 `-negctl` **只传了前三个** ⇒ ★★ **TASK-LIST 那一半从头到尾无法被负控**
 * （该面的注入点在判据的扫描面上**存在**，但**没有任何控去用它**，**P-1**）。
 * ★ 危害形态与 **P-20「长期无正控 = 覆盖空洞」**同族：**该面看起来有守**（名单里有它），
 * 而实测「改坏它没有任何闸门报红」—— 两者在报告上**完全同貌**（**P-30**）。
 *
 * ## 判据
 *   ① 对每个**受检闸门** `X.mjs`，抽它在 `process.argv.indexOf('<flag>')` 里认的 flag；
 *   ② 若存在同名负控 `X-negctl.mjs` ⇒ 该负控的源码里**必须出现该 flag**（真的传过）；
 *   ③ ★★ **对不上 ⇒ 报红**（「该输入面无法被负控」）。
 * ★ **只认「输入面 flag」白名单**（`--file / --method / --readme / --freeze / --tasklist / --as`）——
 * 不是所有 flag 都需要负控传（`--selftest` / `--verbose` 之类是**运行模式**，不是输入面）。
 * ★ **无同名负控 ⇒ 只出声不报红**（**P-43**：很多闸门天然不需要负控，例如设备侧探针）。
 *
 * @param {{name:string, src:string}[]} scripts 受检闸门（name 含扩展名，src 为全文）
 * @param {(f:string)=>(string|null)} readNegctl 读同名负控源码（不存在 ⇒ null）
 * @returns {{problems:string[], notes:string[], checked:number}}
 */
const INPUT_FACE_FLAGS = ['--file', '--method', '--readme', '--freeze', '--tasklist', '--as']
export function inputFaceProblems (scripts, readNegctl) {
  const problems = []
  const notes = []
  let checked = 0
  for (const { name, src } of scripts) {
    if (/-negctl\./.test(name)) continue            // 负控自己不作为被检对象
    // ★★ **只认「真的读了 argv」的形态**（**W74 实测踩到两次自指污染**）：
    //   ⑴ 本文件里的 `INPUT_FACE_FLAGS = [...]` 白名单行**同时含全部六个 flag 字面量**；
    //   ⑵ 本文件 selftest 里的**样本字符串**（`const gateSrc = "...'--tasklist'..."`）与**注释**里
    //      提到 flag 的散文，都会被「`includes('--xxx')`」这种粗口径读成「本闸门支持它」
    //      ⇒ 报出一处**纯自造的违规**（**P-30**：判据在错的文本上跑 ⇒ **P-45**）。
    //   ⇒ 收窄为：**必须形如 `process.argv.indexOf('<flag>')`**（或 `.includes('<flag>')`）——
    //      即「**真的从命令行读了它**」，而不是「文本里出现过这个字符串」（**P-41**：锚到决定结果的事实）。
    //   ★★ **并且必须先剥掉注释行**（**W74 实测踩到的第三种自指污染**）：本文件的**注释**里
    //      同时出现了 `process.argv.indexOf` 与 `'--tasklist'` 两个词（讲的就是这件事本身）
    //      ⇒ 不剥注释，判据会**把自己读成受检对象**，报出一处**纯自造的违规**（**P-30**）。
    const code = src.split(/\r?\n/)
      .filter(l => !/^\s*(?:\*|\/\/)/.test(l))       // 剥 `*` 与 `//` 注释行
      .join('\n')
    const readRe = (fl) => new RegExp(`process\\.argv\\.(?:indexOf|includes)\\(\\s*['"]${fl}['"]`)
    const flags = INPUT_FACE_FLAGS.filter(fl => readRe(fl).test(code))
    if (flags.length === 0) continue
    const stem = name.replace(/\.(mjs|py)$/, '')
    const negSrc = readNegctl(`${stem}-negctl.mjs`)
    if (negSrc === null) {
      notes.push(`\`${name}\` 支持输入面 [${flags.join(' ')}]，但**没有同名负控** ⇒ 本条对它无判据力（P-43）`)
      continue
    }
    checked += 1
    // ★ 负控侧同理**不能只查「文本里出现过该 flag」** —— 它也必须是**真的把它传出去**的形态
    //   （`'--xxx'` 作为字面量出现在 `push(...)` 的实参里），否则注释/样本会把它读成「已传」。
    const missing = flags.filter(fl => !new RegExp(`['"]${fl}['"]`).test(negSrc))
    if (missing.length > 0) {
      problems.push(`\`${name}\` 支持输入面 **${missing.join(' / ')}**，而 \`${stem}-negctl.mjs\` **从未传过它**`
        + ` ⇒ 该输入面对应的那一半**无法被负控**（**P-59 纪律②**：判据要读它，负控就必须能对它注入坏样本）`
        + ` ⇒ 修法：在负控里用该 flag 传**临时副本**并注入一个坏样本（★ 注入点必须落在判据的扫描面上，**P-1**）`)
    }
  }
  return { problems, notes, checked }
}

/**
 * ★★ **头注「用法」行里声明的 CLI flag，实现里必须真的读它**（**W77 新增** —— P-59 家族第六处字段）。
 *
 * ## 由头（W77 实测：**该面整类无守**）
 * **W74** 机器化了「**负控**有没有传过这个输入面」（`inputFaceProblems`）；
 * ★ 但**没人问过相反的那一侧** —— **头注用法行写着的 flag，实现里读不读它**。
 * ★★ **决定性实验（W77）**：故意在马一个闸门的用法行里写 `--ghost-flag <x>`
 * （实现里**从不读**）⇒ `audit-selftest-claims` / `audit-rule-claims` / `audit-doc-refs` /
 * `audit-goal-sections` / `audit-baseline-claims` / `audit-open-items` **六个闸门全部 exit=0**
 * ⇒ **该面整类无守**（读者照头注抄命令**必扑空**，而报告全绿 —— **P-30**）。
 * ★ 与 **P-63** 同族（「实现存在」vs「被喂了输入」），★ 本条问的是**第三种**：
 * 「**文档声明了** vs **实现真的读它**」—— 三方（头注 · 实现 · 负控）里**只有中间那条没人对**。
 * ★ 与 **P-59 家族**的定位：**W44 自证分数 · W71 汇总条数 · W73 清单键集合 ·
 * W75/W76 退出码 · W74 输入面（负控侧）· 本条用法行（实现侧）**。
 *
 * ## 判据（双向，守 P-46）
 *   ① 声明面 = **头注区里含 `node scripts/…mjs` 的行**上的 flag（那才是「用法」语境）；
 *   ② 实现面 = **剥掉注释行与模板串后**，真的从 argv 取该 flag 的**全部合法形态**：
 *      `process.argv.(indexOf|includes)('<f>')` · `(argv|args|a)….('<f>')` ·
 *      `(argv|args)[i] === '<f>'` · `flag('<f>', …)`（本仓的自定义取值器）；
 *   ③ ★★ **双向报红**：`声明了但实现从不读`（读者照抄必扑空）与
 *      `读了但用法行没写`（能力存在却不可发现）。
 *
 * ## 三条口径（均由实测逼出，守 P-38/P-45）
 *   ⑴ ★★ **只剥「模板串」，不得剥撇号/双引号** —— flag 名本身就是 `'--sid'` 这样的
 *      **字符串字面量**，一刀切剥会把**所有真 flag** 一起剥掉（**W75 那个坑的反向错误**）；
 *   ⑵ ★★ **模板串必须允许跨行、且起止须避开转义反引号**（`(^|[^\\])\`…\``）——
 *      **两版才收对**：v1「不跨行」剥不到 `audit-p48-rollback.mjs` 的跨行样本
 *      （`legacySession = \`…flag('--sid')…\``）⇒ 报「读了 `--sid`」的**假红**；
 *      v2「可跨行但起止不避转义」会停在样本内的 `\`` 中间。★ 事实是**模板串本来就允许跨行**
 *      （**P-41**：锚到事实而非「我写的那个写法」），而「贪婪吃远」的真实危害只在**撇号**那侧；
 *   ⑶ ★★ **必须认全部读取形态**（口径 ②）—— 首版只认 `process.argv.indexOf` ⇒
 *      `audit-session-integrity.mjs` 的 `argv[i] === '--sid'` 形态被判成「实现从不读」（**假红**，
 *      **P-45**：扫描面与真目标不对齐）。★ **运行模式 flag 豁免**（`--selftest` / `--verbose` /
 *      `-v` / `--json` / `--quiet` / `--help` / `-h`）—— 它们不是「输入面」，读者不靠它们定位能力。
 *
 * @param {{name:string, src:string}[]} scripts 受检闸门
 * @returns {{problems:string[], checked:number, declaredTotal:number}}
 */
const MODE_FLAGS = new Set(['--selftest', '--verbose', '-v', '--json', '--quiet', '--help', '-h'])
/**
 * 读 flag 的全部合法形态（**P-45**：口径必须与真目标对齐；由 W77 全仓穷举逼出）。
 * ★★ **只接受形如 `--[a-z][a-z0-9-]*` 的 flag 名**（**W77 实测加**）：
 *   本判据自己的 selftest 里有**运行期字符串拼接**（`'…includes(' + Q + '--selftest' + Q + ')…'`）
 *   ⇒ 该行的**源码文本**里出现 `' + Q + '` 这样的片段 ⇒ 若照单全收，会报出
 *   「实现读了 ` + Q + `」这种**纯自造的假 flag**（自指污染的第四种形态）。
 *   加一条语法形状约束即可消除，且**不会漏**任何真实 flag（本仓 flag 全部符合该形状）。
 */
function readFlagForms (code) {
  const out = new Set()
  const pats = [
    /(?:process\.argv|argv|args|a)\s*(?:\.\s*slice\([^)]*\)\s*)?\.\s*(?:indexOf|includes|lastIndexOf)\(\s*['"]([^'"]+)['"]/g,
    /(?:process\.argv|argv|args|a)\s*\[\s*[a-zA-Z_$][\w$]*\s*\]\s*===\s*['"]([^'"]+)['"]/g,
    /\bflag\(\s*['"]([^'"]+)['"]/g
  ]
  for (const re of pats) for (const m of code.matchAll(re)) if (/^--[a-z][a-z0-9-]*$/.test(m[1])) out.add(m[1])
  return out
}
/**
 * ★ **取得「实现面」文本**（**W77 最终口径 v8 —— 逐行 + 跳过含反引号的行**）。
 *
 * ## 为什么最终是这个口径（**七版尝试的完整留痕；每一版都被真实语料当场证伪**）
 *   ⑴ v1 正则 `[^`\\\n]`（不跨行）⇒ 剥不到跨行模板串 ⇒ `audit-p48-rollback.mjs` 假红；
 *   ⑵ v2 正则可跨行 ⇒ **贪婪跨过大量真代码**（`audit-goal-sections.mjs` 真代码被吃光）；
 *   ⑶ v3 逐字符 + `${…}` 深度配平 ⇒ 同串多 `${}` 时提前归零 ⇒ 吃掉后续真代码；
 *   ⑷ v4 逐字符 + 外层跳引号串 ⇒ 未闭合撇号一路吞到文件尾（实测 31493 → 10020）；
 *   ⑸ v5 逐行奇偶（以「奇数行」为界丢掉跨行段）⇒ ★ 本仓**反引号总数常为奇数**
 *      （因为**引号串里含单个反引号**，如 `anchor: 'return `(function'`）⇒ 边界全错；
 *   ⑹ v6 先掩码引号串内的反引号再走 v5 ⇒ 仍受多行样本干扰（报 4 处假红）；
 *   ⑺ v7 掩码「引号串 + 正则字面量」内的反引号再走 v5 ⇒ ★ **又反向失败**：
 *      掩码阶段自身在复杂行上吃掉了真代码（`audit-goal-sections.mjs` 的真读行丢失）；
 *   ⑻ **本版（v8，实测最准）**：★ **不做任何「词法模拟」，只做一件事 —— 按行过滤**：
 *      **凡含反引号的行，一律不参与「实现面」扫描**。
 *   ★ **为什么这就够**（实测）：本仓的 flag 读取语句
 *     （`process.argv.indexOf('--f')` / `argv[i] === '--f'` / `flag('--f')`）**从不与反引号同行**
 *     —— 21 个受检闸门逐一验证。
 *   ★ **实测读数**：21 个受检闸门 ⇒ 4 处**真缺陷**（用法行未写已支持的能力）已修，
 *     ★ 另余 **1 处已知假阳性**（`audit-p48-rollback.mjs` 的 selftest **样本**里
 *     `flag('--sid')` / `argv.includes('--yes')` 位于**多行模板串的续行**上 ⇒
 *     该续行本身不含反引号 ⇒ 本口径**看不到它前面开了模板串**）⇒
 *     ★★ **按 P-43 显式登记为「无判据力的一格」**（它**不是真读**，漏掉反而正确）。
 *   ★★ **诚实边界（R7）**：本口径**不解析语言**，只在「该行是否含反引号」这一**逐行局部量**上过滤；
 *     若有人把 flag 读取写在「模板串的**续行**」（该续行本身不含反引号）上，本判据会**漏**。
 *     ★ 本轮实测的**唯一实例**是 `audit-p48-rollback.mjs` 的 selftest **样本**
 *     （`` const legacySession = `…flag('--sid')…` `` —— 讲的就是「修前形态」），
 *     它**不是真读** ⇒ 漏掉它反而是**正确**的（见下方 `KNOWN_SAMPLE_ONLY` 的显式登记）。
 *     ★ 为什么可以接受「漏」而不接受「误报」：**P-38** —— 误报会训练人忽略报警。
 *
 * @param {string} code 已剥注释行的源码
 * @returns {string} 只保留**不含反引号**的行
 */
export function stripTemplateSpans (code) {
  return String(code ?? '')
    .split('\n')
    .filter(l => !l.includes('`'))
    .join('\n')
}
/**
 * ★★ **豁免表：实现面读到的「非真读」flag**（**W77 加**；**必须写明理由 + 有机器守**，守 P-64）。
 *
 * ## 为什么必须有（**W77 实测的诚实边界**）
 * 本判据的实现面口径是「**逐行跳过含反引号的行**」（见 `stripTemplateSpans` 头注 v8）。
 * ★ 它**看不到**「写在**多行模板串的续行**上」的 `flag('--x')`（该续行本身不含反引号），
 * 而本仓恰有 **1 处**这种形态：`audit-p48-rollback.mjs` 的 selftest **样本**
 * （`` const legacySession = ` … flag('--sid') … argv.includes('--yes') … ` ``）
 * —— 它讲的就是「**修前形态**」本身，**不是真读**。
 * ⇒ ★ **两种选择**：⑴ 把口径复杂化到能解析它（**已试 7 版，全部在别的文件上反向失败**，见 v1~v7 留痕）；
 *   ⑵ **显式登记为豁免**，并把「豁免依据」机器化（**P-64**：豁免依据必须点名到能跑到的通路上）。
 * ★★ **本表取第 ⑵ 种**（守 **P-38**：宁可有一条写明理由的豁免，也不要一个会误报的口径）。
 * ★ **机器守（三条，写在 selftest 里）**：
 *   ① 表中每个 `{file, flag}` 对**必须真实存在**（该 flag 确实在被豁免的文件里被「读到」）
 *      —— 否则就是**腐烂的豁免**（被豁免的东西已经不在了 ⇒ 应删）；
 *   ② 豁免**只能减少 `undeclared` 面**（「读了没写」），**不得**影响 `missing` 面
 *      （「声明了但从不读」是**读者会扑空的硬缺陷**，不允许豁免）；
 *   ③ 每条必须带 `why`（非空）—— 空理由即报错。
 */
export const READ_FLAG_EXEMPTIONS = [
  {
    file: 'audit-p48-rollback.mjs',
    flags: ['--sid', '--yes'],
    why: 'selftest 的**样本字符串**（多行模板串）里出现 `flag(\'--sid\')` / `argv.includes(\'--yes\')` —— 讲的是 W39 修前的真形态本身；该文件的**真身从不读这两个 flag**'
  }
]
export function usageFaceProblems (scripts) {
  const problems = []
  let checked = 0
  let declaredTotal = 0
  for (const { name, src } of scripts) {
    if (/-negctl\./.test(name)) continue
    const lines = String(src ?? '').split(/\r?\n/)
    const imp = lines.findIndex(l => /^\s*(?:import\s|from\s+\S+\s+import)/.test(l))
    const headLines = lines.slice(0, imp > 0 ? imp : Math.min(lines.length, 90))
    // ① 声明面：**含 `node scripts/…` 的注释行**（用法语境）
    const declared = new Set()
    for (const l of headLines) {
      if (!/node\s+scripts[\\/]/.test(l)) continue
      for (const m of l.matchAll(/(--[a-z][a-z0-9-]*)/g)) declared.add(m[1])
    }
    if (declared.size === 0) continue
    checked += 1
    declaredTotal += declared.size
    // ② 实现面：剥注释行 ⇒ 再剥**含反引号的行**（样本常写在模板串里；本仓 flag 读取从不与其同行）。
    const code = stripTemplateSpans(lines.filter(l => !/^\s*(?:\*|\/\/|#)/.test(l)).join('\n'))
    const read = readFlagForms(code)
    const exempt = new Set(READ_FLAG_EXEMPTIONS.filter(e => e.file === name).flatMap(e => e.flags))
    const missing = [...declared].filter(f => !read.has(f) && !MODE_FLAGS.has(f))
    // ★ 豁免**只作用于 undeclared 面**（守纪律②：missing 面不得豁免）
    const undeclared = [...read].filter(f => !declared.has(f) && !MODE_FLAGS.has(f) && !exempt.has(f))
    if (missing.length) {
      problems.push(`\`${name}\` 的**头注用法行**声明了 **${missing.join(' / ')}**，而实现里**从不读它**`
        + ` ⇒ 读者照头注抄命令**必扑空**，而报告全绿（**P-30**；**P-59**：头注的声明必须能指认到实现）`
        + ` ⇒ 二选一：⑴ 让实现真的支持它；⑵ 从头注用法行里删掉`)
    }
    if (undeclared.length) {
      problems.push(`\`${name}\` 的实现**读了 ${undeclared.join(' / ')}**，而头注用法行**没写**`
        + ` ⇒ 能力存在却**不可发现**（读者只能靠读源码才知道有它；**P-46** 的反面：两种事实要有两个读数）`
        + ` ⇒ 修法：补进头注用法行（★ 运行模式 flag 已豁免）`)
    }
  }
  return { problems, checked, declaredTotal }
}

/**
 * ★★ **读数行登记表与接线的一致性**（**W62 新增** —— 守 P-59 家族的第二种形态）。
 *
 * ## 由头（W62 实测的系统性缺陷）
 * `build-dsht.ps1` 里「把闸门的关键读数行回显进构建日志」这件事，历史上长成了
 * **三套互不相通的实现**：① Step 0.5 循环内嵌的 `$readingGates` 表；
 * ② Step 0.55 第十一组**硬编码的一段**（而它的注释还写着「与 `$readingGates` 表**同法**
 * （**P-1**：读数机制只许一处实现形态）」—— **说是一处，实际已是两处、加上「不 Out-Null」
 * 的第三个闸门共三处**）；③ 干脆不做处理、靠不过滤 stdout。
 * ⇒ 实测后果：**21 个构建期闸门会打印读数行，而构建日志里只出现了 3 条**；
 * 其中一类**直接对应 `GOAL.md` §3.1 / §3.2 里写死的数字**（`TARGETS 9 项` ·
 * `17 marker / 11 项 / ps1 13 处 + python 20 处 / 自动发现 4 个` · `实读 7 条`）
 * ⇒ 这些数字**在构建日志里没有任何观测面**，与 W57 的「路由 67 条」**同形**。
 *
 * ## 判据（两条，守 P-38 防过宽）
 *   ① ★★ **登记即须接线**：表里登记了某闸门 ⇒ 构建脚本里必须**真的存在**
 *      `Show-Reading -Gate '<该闸门>'` 调用。否则「登记」是**空声明** ——
 *      表看着像守住了，实际那行读数**永远不进日志**（**P-59 纪律①**的同族：
 *      「声明有守」与「真的有守」在报告上完全同貌）。
 *   ② ★ **接线即在受检面**：出现 `Show-Reading -Gate '<X>'` 而 X **不是构建期闸门**
 *      （不在 `discoverBuildGates` 的名单里）⇒ 报红（拼错名字 / 脚本已删 ⇒ 静默失效）。
 *
 * ★ **不判**「未登记的闸门是否有读数行」—— 那需要判断「哪一行是**真读数**」，
 *   而这**只能靠语义**（`[F5] 扫 N 个源文件` 是规模诊断，不是读数）。把它写成正则
 *   必然过宽（W62 探针首版一次报出 19 个「未覆盖」，其中多数是扫描规模）
 *   ⇒ **P-38 的过宽**。登记表由人按「是否对应文档里的数字」**显式维护**，本判据守其**一致性**。
 *
 * @param {string} buildScript `build-dsht.ps1` 全文
 * @param {(f:string)=>boolean} [existsFn] 脚本是否真实存在（**判据②必须用它**：
 *   只看「名字像 `audit-*.mjs`」是不够的 —— `-Gate 'audit-b-ghost.mjs'` 也长得像，
 *   但那个文件**不存在** ⇒ 该行读数静默失效。W62 selftest 的负控②当场证伪了首版口径）
 * @returns {{problems:string[], registered:number, wired:string[]}}
 */
export function readingWiringProblems (buildScript, existsFn = () => true) {
  const problems = []
  // ① 抽登记表里的键（`'<file>' = @{ Exe = …` 形态，仅限 @{} 值 ⇒ 与其它同名表区分）
  const registered = []
  for (const m of buildScript.matchAll(/'([\w.-]+\.(?:mjs|py))'\s*=\s*@\{\s*Exe\s*=/g)) registered.push(m[1])
  // ② 抽 `Show-Reading -Gate '<字面量>'` 的实参
  const wired = [...buildScript.matchAll(/Show-Reading\s+-Gate\s+'([^']+)'/g)].map(m => m[1])
  const wiredSet = new Set(wired)
  // ★★ ③ **循环内的变量实参**（**W62 实测的口径缺陷**，守 P-38）
  //   形态：Step 0.5 是 `foreach ($a in $auditNode) { … Show-Reading -Gate $a -Path $p }`
  //   —— 实参是**变量**，字面量正则**看不到**它。若据此报「登记是空声明」，
  //   会把**三个真的已接线的闸门**（`audit-route-contract` / `audit-th-face-coverage` /
  //   `audit-shim-template-literal`）判成缺陷 = **假红**（P-38 过宽）。
  //   ⇒ 必须**把循环变量展开**：从 `foreach ($<v> in @( … ))` 抽出名单，
  //     再找该循环体内是否有 `Show-Reading -Gate $<v>`。有 ⇒ 名单里每个都算已接线。
  const loopCovered = new Set()
  for (const m of buildScript.matchAll(/foreach\s*\(\s*\$(\w+)\s+in\s+\$(\w+)\s*\)\s*\{([\s\S]*?)\n\}/g)) {
    const [, v, arr, body] = m
    if (!new RegExp(`Show-Reading\\s+-Gate\\s+\\$${v}\\b`).test(body)) continue
    // ★★ 抽该数组的声明（`$auditNode = @( … )`）—— **必须用括号配平**，不能用非贪婪 `\)`
    //   （**W62 实测的假红**：登记表里那行 `'audit-th-face-coverage.mjs' = @{ … = '\[TH 面读数\]'; … }`
    //    本身含 `)` 与单引号 ⇒ 非贪婪正则在**注释里**提前收尾 ⇒ 该闸门**被漏掉** ⇒ 误报空声明。
    //    与 W29「函数体范围用花括号配平」是同一个坑，**第二次现身**。）
    const start = new RegExp(`\\$${arr}\\s*=\\s*@\\(`).exec(buildScript)
    if (!start) continue
    let i = start.index + start[0].length, depth = 1
    while (i < buildScript.length && depth > 0) {
      if (buildScript[i] === '(') depth += 1
      else if (buildScript[i] === ')') depth -= 1
      i += 1
    }
    const arrBody = buildScript.slice(start.index + start[0].length, i - 1)
    // 只认**顶格条目**（行首空白 + 单引号 + 文件名 + 单引号 + 逗号/换行）
    // ⇒ 排除注释块与 `@{ … }` 里的同名出现（它们是说明，不是数组元素）
    for (const x of arrBody.matchAll(/^\s{0,8}'([\w.-]+\.(?:mjs|py))'\s*,?\s*$/gm)) loopCovered.add(x[1])
  }
  // ④ 判据①：登记即须接线（字面量 **或** 循环变量覆盖）
  for (const g of registered) {
    if (wiredSet.has(g) || loopCovered.has(g)) continue
    problems.push(`读数登记表里登记了 \`${g}\`，但 \`build-dsht.ps1\` 里**找不到** \`Show-Reading -Gate '${g}'\` 调用`
      + `（也不在任何 \`foreach … Show-Reading -Gate $var\` 循环的名单里）`
      + ` ⇒ **登记是空声明**：那行读数**永远不会进构建日志**（P-59 纪律①：声明有守 ≠ 真的有守）`)
  }
  // ⑤ 判据②：接线必须在构建期闸门名单里（拼错名 / 脚本已删 ⇒ 静默失效）
  //   ★★ **必须同时查「名字形态像闸门」与「文件真实存在」**（W62 selftest 负控②当场证伪首版）：
  //     首版只用 `discoverBuildGates(…, () => true)`（**不查存在性**）⇒ `audit-b-ghost.mjs`
  //     照样匹配 `(?:audit|verify)-[\w-]+\.(?:mjs|py)` ⇒ 幽灵接线**被判为正常**（假绿，P-30）。
  const exists = new Set(discoverBuildGates(buildScript, existsFn))
  for (const g of [...wiredSet, ...loopCovered]) {
    if (!exists.has(g)) {
      problems.push(`\`build-dsht.ps1\` 里 \`Show-Reading -Gate '${g}'\` 指向的**不是构建期闸门**`
        + `（拼错名字？脚本已删？）⇒ 该行读数静默失效（P-30：失效与正常同貌）`)
    }
  }
  return { problems, registered: registered.length, wired: [...new Set([...wiredSet, ...loopCovered])].sort() }
}

/**
 * ★★ **读数登记的 `Pattern` 必须真的能匹配到值**（**W78 新增** —— W62 判据的补集）。
 *
 * ## 由头（W78 实测：**该面整类无守**）
 * **W62** 机器化了「**登记 ≠ 接线**」（登记表里的闸门必须在构建脚本里有 `Show-Reading -Gate` 调用）；
 * ★ 但它**只问「有没有接线」，不问「接了线之后取不取得到值」**。
 * ★★ **决定性实验（W78）**：把 `audit-rule-claims.mjs` 那条登记的 `Pattern` 改成一个**永不匹配**的串
 * ⇒ `audit-selftest-claims` / `audit-rule-claims` / `audit-doc-refs` / `audit-goal-sections` /
 * `audit-baseline-claims` **五个闸门全部 exit=0** ⇒ ★★ **该面整类无守**。
 * ★ 而 `Show-Reading` 里那段兜底**只打黄字警告**（`⚠ 未取到读数行`）**不 fail**（`build-dsht.ps1:228`）
 * ⇒ **失效与正常在日志里几乎同貌**（**P-30**）：读者只会看到少了一行读数，不会知道那是「登记失效」。
 *
 * ## 判据
 *   ① 从 `$readingGates` 登记表抽出每条 `{Gate, Exe, Pattern}`（**与 W62 同一抽取口径**，P-1）；
 *   ② ★★ **实跑该闸门**，用该 `Pattern` 过滤输出 ⇒ 必须**匹配到 ≥ 1 行**；
 *   ③ 匹配 0 行 ⇒ **报红**（`Pattern` 写坏了 / 闸门改了输出格式 / 该闸门当前跑不出读数）。
 *   ★ **只对「可实跑」的登记生效**：闸门脚本不存在 ⇒ **只出声**（P-43，那条由 W62 判据② 承接）；
 *     闸门需要设备/语料（构建期跑不了）⇒ **只出声**（**P-43**：无判据力不得判 FAIL）。
 *   ★★ **诚实边界（R7）**：本判据在**构建期**跑，其判据力**依赖闸门能在此环境跑起来**；
 *     对本机跑不动的闸门（需设备）**出声不报红** —— 那类读数由**设备侧**承接。
 *
 * @param {string} buildScript `build-dsht.ps1` 全文
 * @param {(exe:string, file:string)=>{ok:boolean, out:string, err?:string}} runGate 实跑闸门（注入以便自证）
 * @param {(f:string)=>boolean} [existsFn] 脚本是否存在
 * @returns {{problems:string[], notes:string[], checked:number}}
 */
export function readingValueProblems (buildScript, runGate, existsFn = () => true) {
  const problems = []
  const notes = []
  let checked = 0
  // ① 抽登记表三元组。★ 必须**逐条**解析，且 `Pattern` 里可能含 `|` 与转义 ⇒ 用「到 Label 之前」截断。
  const re = /'([\w.-]+\.(?:mjs|py))'\s*=\s*@\{\s*Exe\s*=\s*'(\w+)';\s*Pattern\s*=\s*'([^']*(?:''[^']*)*)'/g
  for (const m of buildScript.matchAll(re)) {
    const [, gate, exe, rawPat] = m
    // ★★ **必须排除自调用链**（`P-50 推论一`）：本判据**实跑**闸门，若闸门就是它自己
    //   ⇒ 自己调自己 ⇒ **递归 / 超时**（W78 实测：`spawnSync … ETIMEDOUT`）。
    //   ★ 该条的读数由**构建期 `Show-Reading` 自己**产出（它不在「被本判据实跑」的名单里）。
    if (gate === 'audit-selftest-claims.mjs') {
      notes.push(`\`${gate}\` 属**自调用链**（本判据不能实跑自己）⇒ 只出声；其读数由构建期 \`Show-Reading\` 自己核验（P-50 推论一）`)
      continue
    }
    if (!existsFn(gate)) {
      notes.push(`\`${gate}\` 登记的读数无法核验（**脚本不存在**）⇒ 只出声（该条由 W62 判据② 承接）`)
      continue
    }
    const r = runGate(exe, gate)
    if (!r.ok) {
      notes.push(`\`${gate}\` 登记的读数无法核验（**构建期跑不起来**：${String(r.err ?? '').slice(0, 80)}）⇒ 只出声（P-43，该类读数由设备侧承接）`)
      continue
    }
    checked += 1
    // ★ PowerShell 里 `''` 是转义单引号；在 JS 正则里要还原成 `'`
    const pat = rawPat.replace(/''/g, "'")
    let hit = 0
    try {
      const rx = new RegExp(pat)
      hit = r.out.split(/\r?\n/).filter(l => rx.test(l)).length
    } catch (e) {
      problems.push(`\`${gate}\` 登记的 \`Pattern\` **不是合法正则**（${String(e.message).slice(0, 60)}）`
        + ` ⇒ 该行读数永远进不了日志（**P-30**：失效与正常同貌）`)
      continue
    }
    if (hit === 0) {
      problems.push(`\`${gate}\` 登记的 \`Pattern\` **匹配 0 行**（\`${pat}\`）`
        + ` ⇒ ★★ **该行读数静默失效**：\`Show-Reading\` 只会打一句黄字警告、**不 fail**（§build-dsht.ps1:228）`
        + ` ⇒ 读者只会看到日志里**少了一行**，不会知道那是「登记失效」（**P-30**；**P-59 纪律①**：声明有守 ≠ 真的有守）`
        + ` ⇒ 修法：⑴ 修 Pattern 让它匹配真输出；⑵ 若该闸门当前确实不产生读数，就从登记表删掉并写明理由`)
    }
  }
  return { problems, notes, checked }
}

/**
 * **「当前状态区段」谓词**（W45 新增 —— 取代旧的「按写法收窄」口径）。
 *
 * ## 判据语义（守 P-45：扫描面与真目标对齐）
 * 本闸门要守的是「**文档现在说这个脚本的分数是多少**」。据此，**只有同时满足**两条的
 * 区段才算数：
 *   ⑴ **陈述性**（不是叙事）：描述**当前**状态的章节 ——
 *      · GOAL：§三「当前基线」（每轮必改）· §七「纪律」（含 R 条例的**机器化落点**）·
 *        §九「已产出的设计哲学资产」（P 判据与它的机器化落点）；
 *      · 方法论：§一~§五（当前状态描述）。
 *   ⑵ **非逐轮记录**：**排除** GOAL §十一「当前工作面」与方法论 §6.x ——
 *      那两块是**史实**（「当时是 16/16」是**真的**），拿它跟今天比会**永远报红**，
 *      等于把判据变成噪音（**P-38 过宽 ⇒ 假红 ⇒ 训练人忽略报警**）。
 *
 * ## ★ 实测依据（为什么旧口径必须换掉）
 * 旧口径按**写法**（有无 `scripts/` 前缀）近似，W45 实测证伪：
 *   · 漏守：§九 的 `\`audit-goal-sections.mjs\` selftest 16/16` 是**裸名**形态 ⇒ 从没被守过
 *     （而那正是 W44 抓到的真缺陷形态）；
 *   · 假红：放宽写法后若不排除 §十一，立刻多出 14 处「过期」，**其中 12 处在 §十一**（史实）。
 *
 * ## 诚实边界（R7）
 *   区段标题**改了名**（如「§三」改称别的）⇒ 本谓词会**静默放过**（退回「不守」而非乱报红）。
 *   这是**刻意选择**：宁可少守，不可假红。`selftest` 里有正控断言这两个区段**真的被抽到**，
 *   故标题被改名会由 selftest 报出来（不至于无人知）。
 *
 * @param {string} section 形如 `## 三、当前基线（…）`
 * @param {'goal'|'method'} doc
 */
export function isCurrentStateSection (section, doc) {
  const s = section ?? ''
  if (doc === 'goal') {
    // ★ 叙事区（逐轮记录）：**排除**
    if (/^##\s*十一、/.test(s)) return false
    // ★ 当前状态区：§三 基线 / §七 纪律 / §九 判据资产
    return /^##\s*(三|七|九)、/.test(s)
  }
  // 方法论：§一~§五 是当前状态；§六 起为逐轮结论（调用方已按 `### 6.x` 切掉，此处再兜一层）
  if (/^##\s*六、/.test(s)) return false
  return /^##\s*(一|二|三|四|五)、/.test(s) || s === '(preamble)'
}

/**
 * 跑一个脚本的 `--selftest`，取统一分数行。
 *
 * ★★ **W48 修：按扩展名选解释器**（此前一律用 `process.execPath` = node）。
 *   为什么必须修：本闸门的**受检名单实读 `build-dsht.ps1`**，而构建期同时调
 *   `.mjs` 与 `.py` 两类闸门 ⇒ 用 node 去跑 `.py` **必然失败**，
 *   于是每一个 `.py` 闸门都会被判成「未接入契约」——
 *   而这**看起来像「那些脚本没接入」**，实际是**闸门自己的执行方式错了**
 *   （**P-45**：扫描面与真目标错位；**P-19** 家族：判据的机制假设不成立）。
 *   ⇒ 本仓的 `.py` 闸门在 W48 已接入同一份契约（`selftest_summary.py`，
 *     格式串与 JS 侧**逐字一致**，守 P-1）。
 *
 * @returns {{ ok: boolean, got: string|null, pass?: number, total?: number, verdict?: string, out: string, exit: number }}
 */
export function probeSelftest (scriptPath, timeoutMs = 180000) {
  let out = '', exit = -1
  // ★ .py ⇒ 用 python / python3；其余（.mjs）⇒ node
  const isPy = /\.py$/i.test(scriptPath)
  const cmd = isPy ? (process.env.PYTHON ?? 'python') : process.execPath
  try {
    out = execFileSync(cmd, [scriptPath, '--selftest'], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
    exit = 0
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    exit = e.status ?? -1
  }
  const m = SELFTEST_LINE_RE.exec(out)
  if (!m) return { ok: false, got: null, out, exit }
  return { ok: true, got: `${m[2]}/${m[3]}`, pass: Number(m[2]), total: Number(m[3]), verdict: m[4], out, exit }
}

/**
 * 从文档文本里抽「脚本名 → 声明的分数」。
 *
 * ★★ 口径（W45 修订：**按区段语义**，不按写法 —— 两版都被真实仓库证伪过）
 *
 * ## 为什么必须改（P-45：扫描面必须与真目标对齐）
 * 真目标是「**当前状态**的分数声明」。首版用**写法**近似它：只认 `` `scripts/x.mjs` `` 前缀形态，
 * 理由写在旧注释里 ——「裸名会命中历史叙事」。但 W45 实测把这条口径**当场证伪**：
 *   · **漏守真缺陷**：W44 实测出的真缺陷（§九 P 判据定义行的 `selftest 16/16`）
 *     **恰恰是裸名写法** `\`audit-x.mjs\` selftest 16/16` ⇒ 它**从没被守过**；
 *   · 对照实测：放宽到裸名后，GOAL 受守声明 17 → 50 条，其中 §三/§九 的 13 条
 *     「当前状态声明」此前**全部在盲区**（现在恰好都对 = **运气，不是判据力**）。
 * ⇒ 结论：**写法不是语义**。正确口径 = 「**位于当前状态区段**」（§三 基线 / §七 纪律的
 *   机器化落点 / §九 判据资产），而不是「有没有 `scripts/` 前缀」。
 *
 * ## 三条纪律
 *   ⑴ **只认反引号内的脚本名**（`` `x.mjs` `` / `` `scripts/x.mjs` ``）—— 正则里
 *      `[\w-]+` 不含 `/`，故 `tmp/w32-….mjs` 这类临时探针**天然不命中**；
 *   ⑵ ★ **分数只能归给「其前最近的那个脚本名」**：实测形态
 *      「`` `selftest-summary.mjs` `` + `` `audit-selftest-claims.mjs` `` selftest **17/17**」
 *      里那个 17/17 **属于后者**；不设「下一个脚本名」上界就会被前者也认领（**过宽 ⇒ 假红**，P-38）；
 *   ⑶ **区段过滤由调用方用 `allowRegion` 传入**（同一谓词口径，不在两处各写一遍 —— P-1）。
 *
 * @param {string} text
 * @param {{ skipLineRe?: RegExp|null, allowRegion?: ((section:string)=>boolean)|null }} [opt]
 */
export function extractClaims (text, { skipLineRe = null, allowRegion = null, resolveBare = null } = {}) {
  const out = []
  const lines = text.split(/\r?\n/)
  let section = '(preamble)'
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    // ★ 区段跟踪：只在 `##` 级标题处切换（`### 3.1` 不匹配 `^##\s`，故保持所属章）
    if (/^##\s/.test(l)) section = l.trim()
    if (skipLineRe && skipLineRe.test(l)) continue
    if (allowRegion && !allowRegion(section)) continue
    // ★★ 口径（守 P-38 与 P-45，**两版都被真实仓库证伪过**）：
    //   ⑴ **只认反引号内的脚本名**（`x.mjs` / `scripts/x.mjs`）—— 反引号内有路径前缀时
    //      只允许 `./` 或 `scripts/`，故 `tmp/w32-….mjs` 这类临时探针**天然不命中**
    //      （`[\w-]+` 不含 `/`，且正则要求 token 整体闭合在反引号内）；
    //   ⑵ ★ **分数只能归给「其前最近的那个脚本名」**（W45 实测的真缺陷）：
    //      首版把「裸名」整体排除、只认 `scripts/` 前缀，理由是「裸名会命中历史叙事」——
    //      但 W44 实测出的真缺陷（§九 P 判据定义行的 `selftest 16/16`）**恰恰是裸名写法**
    //      ⇒ 扫面与真目标错位（**P-45**：报出量与事实不符 / 漏守真实形态）。
    //      放宽到裸名后，必须配「最近邻归属」否则会出现**假红**：实测形态
    //      「\`selftest-summary.mjs\` + \`audit-selftest-claims.mjs\` selftest **17/17**」
    //      里那个 17/17 **属于后者**，若不设邻接上界就会被前者也认领（P-38 过宽 ⇒ 假红）。
    //   ★★ 第⑶条（**W45 第二轮实测**）：反引号内**任意路径前缀**都要认。
    //     实测本仓有三种写法：`` `scripts/x.mjs` `` / `` `x.mjs` `` /
    //     `` `node rp-workspace/scripts/x.mjs` ``（后者出现在「怎么跑」列的命令串里）。
    //     首版只认前两种 ⇒ §三/§九 又有 **5 条**漏守（P-45 的同一个形态**又犯了一次**：
    //     **用写法近似语义，总会在你没注意的方向上漏**）。
    //   ★ 归属规则（**按「反引号片段」解析**，不再用一个正则去啃整行）：
    //     片段内每个 `.mjs`/`.py` 的**目录部分**必须是空、`./`、或末段为 `scripts`
    //     ⇒ 认（覆盖 `x.mjs` / `./x.mjs` / `scripts/x.mjs` / `rp-workspace/scripts/x.mjs`）；
    //     末段目录是别的（如 `tmp/`）⇒ **不认**（临时探针不是常驻脚本，认了会报悬空引用 = 假红）。
    const toks = []
    for (const q of l.matchAll(/`([^`\n]*)`/g)) {
      const inner = q[1]
      const base = q.index + 1
      for (const mm of inner.matchAll(/([\w./\\-]*?)([\w-]+\.(?:mjs|py))/g)) {
        const dirs = mm[1].split(/[\\/]/).filter(Boolean)
        if (dirs.length > 0 && !['scripts', '.'].includes(dirs[dirs.length - 1])) continue
        toks.push({ start: base + mm.index, end: base + mm.index + mm[0].length, file: mm[2] })
      }
      // ★★ 第⑷条（**W61 实测的真缺陷**）：**不带扩展名的裸名**也必须认。
      //
      // ## 由头（一次「当前全绿 = 运气」的实测）
      // `GOAL.md` **§3.1 门禁行**（每轮必读的基线行）把 13 组闸门的自证分数写成
      //   「/ `audit-goal-sections` **28/28** + `audit-goal-sections-negctl` **13/13** / …」
      // —— **裸名，没有 `.mjs`**。上面的 `.mjs|py` 正则要求 token 整体闭合在反引号内且带扩展名
      // ⇒ **这一整行的 15 条声明一条都抽不到**。
      // ★ **决定性实验**（`tmp/w61-decisive.mjs`）：① 正控（§九 带扩展名的 `63/63` 改成 `52/52`）
      //   ⇒ **exit=1 报红**；② 把 §3.1 那行的裸名分数改成 `1/1` ⇒ **exit=0 不报红**。
      //   ⇒ 该行**没有任何机器守着**，而它里面**恰好有 6 处已过期**
      //   （`audit-goal-sections` 28→35 · `-negctl` 13→20 · `audit-baseline-claims` 36→63 ·
      //    `-negctl` 11→25 · `audit-rule-claims` 14→22 · `-negctl` 10→18）。
      //   —— 这正是 **P-58/P-59 的同一母题**：同一族声明（闸门自证分数）写在**两个区段**，
      //      §九 那半有守、**§3.1 这半没有**，而**两侧在报告上完全同貌**（**P-30**）。
      //
      // ## 口径（守 P-38：不得过宽）
      // 不是「反引号里任何 `x/y` 前后片段都当脚本名」——裸名形态在文档里**到处都是**
      // （`st-vr2jg2` 会话名 / `--selftest` 参数 / `build-path-parity` 简写 …），
      // 全收会一次报出几十处**假红**（实测穷举 79 处候选，其中绝大多数不是脚本声明）。
      // ⇒ 两道收窄：⑴ **名字边界必须干净**（前是反引号/空白/`/`，后不得紧跟 `.` 或词字符）
      //   —— 否则 `audit-x.mjs` 会被裸名路径再切出碎片、`mjs` 这种尾巴也会被当名字；
      //   ⑵ ★ 必须由调用方提供 **`resolveBare(name)`**：**只有「能解析成受检面内某个真脚本」的裸名才认**
      //   （把「是不是脚本」这一事实交给**文件系统**判，而不是靠写法猜 —— **P-41**）。
      if (resolveBare) {
        for (const mm of inner.matchAll(/(^|[\s/·（(])([\w-]+)(?![\w.-])/g)) {
          const f = resolveBare(mm[2])
          if (!f) continue
          const at = base + mm.index + mm[1].length
          toks.push({ start: at, end: at + mm[2].length, file: f })
        }
      }
    }
    // ★★ 第⑸条（**W65 实测的真缺陷**）：**完全没有引号的裸名**也必须认（**仅限 gate 文案形态**）。
    //
    // ## 由头（构建日志里的一句过期文案，6 处同批）
    // `build-dsht.ps1` 的 `Write-Host "  [gate] OK audit-baseline-claims.mjs --selftest（**63/63**…）"`
    // —— 脚本名与分数**都不在反引号里**（那是 PowerShell 文案，不是 Markdown）⇒
    // 上面两条路径（反引号内带扩展名 / 反引号内裸名）**一条都抽不到**（实测抽出 **0 条**）。
    // ⇒ 同一族声明（闸门自证分数）写在第**三**处、而它**从未被守过**
    // （**P-58 第 N 次现身**：`build-dsht.ps1` 的 63/63 实为 79/79 · 25/25 实为 31/31 ·
    //   41/41 实为 49/49 · 18/18 实为 23/23 · 23/23 实为 39/39）。
    //
    // ## 为什么只认这一种形态（守 P-38：绝不放开为「全文扫裸名」）
    // 无引号的裸名在**散文里到处都是**（会话名 / 简写 / 参数）⇒ 全文扫会**大量假红**。
    // 本条的收窄口径 = 调用方**已经把输入切成「gate 文案行」**（见主流程的 `.filter`），
    // 且行内必须同时满足：⑴ 含 `[gate] OK`；⑵ 脚本名后**紧跟** `--selftest` 或 `（`。
    if (resolveBare && /\[gate\]\s*OK/.test(l)) {
      // ★★ **「前面不是词字符」必须写成捕获组**（`(^|[^\w-])`），**不能写 `(?![\w-])`** ——
      //   后者是**负向前瞻**，检查的是「**该位置之后**」的字符，而它显然以 `a` 开头
      //   ⇒ 永远失败、**一条都匹配不到**（W65 实测：抽出 0 条，而闸门照样报绿 —— **P-30**）。
      //   ★ 这是 **P-19「凭印象写正则」** 的又一形态：正则在单元测试式的直觉下「看起来对」。
      for (const mm of l.matchAll(/(^|[^\w-])([\w-]+\.(?:mjs|py))(?=[\s(（]|--selftest)/g)) {
        const f = resolveBare(mm[2])
        if (!f) continue
        const at = mm.index + mm[1].length
        toks.push({ start: at, end: at + mm[2].length, file: f })
      }
    }
    if (toks.length === 0) continue
    for (let k = 0; k < toks.length; k += 1) {
      const after = l.slice(toks[k].end)
      // ★ 窗口三个上界取最小：表格列边界（`|`）· **下一个脚本名起点**（最近邻归属）· 60 字。
      //   ★ 为什么是 60（**首版写 40，被真实仓库负控当场证伪**）：§3.2 的表格行形如
      //     `| **W42 新增两道闸门**：\`scripts/x.mjs\`（**GOAL §十一 …完整性**，selftest **24/24**：…`
      //     —— 脚本名到分数**实距 37 字**，但 40 字窗口会在 `**24` 处截断 ⇒ 抽不到 ⇒
      //     负控「注入后仍报绿」= **判据失效而输出与通过完全相同**（P-30）。
      //   ★ 为什么**必须**卡 `|`：否则会把**下一列**的数字读成本脚本的分数
      //     （首版实测：`| \`scripts/ef-touch-targets.mjs\` | 说明 | **16 态全生效 / 0 P1** |`
      //      被读成 `16/16` = **假红**，P-45）。
      //   ★★ **W72 修正（P-50 第五次现身）**：卡 `|` 的口径**过窄** —— 它把
      //     **§3.2 门禁清单**的整整一类写法**全部划出扫描面**：
      //     `| 8 | \`scripts/audit-official-contract.mjs\` | **E3 官方契约事前探针**（…，selftest 8/8） |`
      //     —— 脚本名在**第 2 列**、分数在**第 3 列**（说明列）⇒ `after` 开头就是 `` ` `` + ` | `
      //     ⇒ `nextPipe` = 2 ⇒ **窗口只有 2 字** ⇒ 永远抽不到。
      //     ★ 实测：§3.2 里**共 11 处**同形态，其中 **4 处已过期**（完全无人守 —— **P-30**）。
      //     ★★ 修法（**收窄而非放开**，守 P-38）：
      //     ⑴ ★ **只对「真正的表格行」放开**（行首 `|`）—— 散文行（P 判据定义行等）**维持旧口径**，
      //        因为散文里「脚本名 … 若干字 … selftest N/M」常常是**记账/史实**
      //        （如「W51 落地时 selftest 24/24 → 36/36」）⇒ 放开会**大量假红**（W72 实测）。
      //     ⑵ ★★ **必须 `selftest` 字样在场** —— 它是「这一列在讲自证分数」的**语义标记**，
      //        而旧口径「卡 `|`」原本就是为了防「把 `16 态` 读成 `16/16`」；
      //        带上 `selftest` 前置后，那个假红形态**天然不命中**（它写的是 `**16 态全生效**`，
      //        既没有 `selftest` 也不是 `N/M` 形态）⇒ **两个目的同时达成**。
      //     ⑶ ★ 跨列时**取到本行最后一个 `|`**（表格行尾）为止 —— 而不是无界 200 字
      //        （无界会吃到下一行内容）。
      //     ⑷ ★★ **§九 P 判据定义行（`| P-nn |`）不适用跨列**（**W72 实测的假红**）：
      //        那些行里写的是「**W51 已落地**：… selftest **24/24 → 36/36**」= **该判据的落地记账**
      //        （箭头左侧是**当时**、右侧是**当时落地后**，**两者都不是今天**）
      //        ⇒ 跨列放开后会大量假红。★ 判据：该行**首单元格是 `P-nn`** ⇒ 维持旧口径。
      const isPDefRow = /^\s*\|\s*\*{0,2}P-\d+\*{0,2}\s*\|/.test(l)
      const isTableRow = /^\s*\|/.test(l) && !isPDefRow
      const nextPipe = after.indexOf('|')
      const pipeWin = nextPipe >= 0 ? nextPipe : Infinity
      const rowEnd = after.lastIndexOf('|')
      const tailToRowEnd = after.slice(0, rowEnd >= 0 ? rowEnd : after.length)
      const allowCrossCell = isTableRow && /selftest/.test(tailToRowEnd)
      const nextTok = k + 1 < toks.length ? toks[k + 1].start - toks[k].end : Infinity
      let win = allowCrossCell
        ? Math.min(rowEnd >= 0 ? rowEnd : after.length, nextTok)
        : Math.min(pipeWin, nextTok, 60)
      // ★★ **窗口不得截断在数字中间**（**W65 实测的假红，P-41**）：
      //   实测形态（本轮 P-65 定义行）：`selftest **41/41 → 49/49**（正控 …）` ——
      //   60 字窗口**正好切在 `49/49` 的最后一个字符之前**（seg 末端是 `**41/41 → 49/4`）
      //   ⇒ 判据拿 `49/4` 去比对真值 `49/49` ⇒ **永远报红**（假红 ⇒ 训练人忽略报警，**P-38**）。
      //   ★ 识别特征：**报告的「声明值」不是合法分数形态**（被截断）。
      //   ★ 修法：若截断点**紧邻数字或 `/`**，就把窗口**向后推进到该 token 结束**
      //     （只推进到「不再是数字/斜杠」为止 —— 不放开 60 字预算，守 P-38）。
      if (win < after.length && /[\d/]/.test(after[win])) {
        while (win < after.length && /[\d/*]/.test(after[win])) win += 1
      }
      const seg = after.slice(0, win)
      const ALL = /(?:selftest\s*)?\*{0,2}(\d+)\s*\/\s*\*{0,2}(\d+)\*{0,2}/g
      const found = []
      let s2
      while ((s2 = ALL.exec(seg)) !== null) {
        // ★★ **`at` 必须是「分数在 seg 里的起点」**（**W65 实测的错位**）：
        //   直觉写法 `s2.index` 是**整个匹配**的起点 —— 而匹配可能含 `selftest ` 前缀
        //   （`(?:selftest\s*)?`）⇒ 用它算「分数之后是什么」会**读错位置**
        //   ⇒ `isHistorySide` 判反 ⇒ 口径**静默失效**（**P-41 推论二**：锚点错了就转向别处）。
        const rel = s2[0].indexOf(`${s2[1]}/${s2[2]}`)
        found.push({ at: s2.index + (rel >= 0 ? rel : 0), v: `${s2[1]}/${s2[2]}` })
      }
      if (found.length === 0) continue
      // ★★ **「对比叙述」排除**（W45 实测 —— 修掉一处假红，守 P-38）：
      //   形态 = 「文档写 **16/16**，实际已 **24/24**」（方法论 §5.4 里**引述 W44 当时检出的
      //   过期缺陷**）。那是**史实**：它说的「16/16」**在写下时是对的**，
      //   拿它跟今天比会**永远报红** ⇒ 判据变噪音（假红会训练人忽略报警）。
      //   ★★ 判据必须**双条件**（**首版只用「两值」被判据当场证伪**）：窗口里同时出现
      //     ⑴ **对比措辞**（`文档写` / `实际已` / `实际是` / `原先写` / `曾写`），且
      //     ⑵ **≥2 个不同的 N/M**。
      //   ★ 为什么必须加条件⑴（**W45 实测的假绿，P-30 形态**）：真缺陷行 L80/L493 的窗口里有
      //     「`selftest 16/16` + 负控 `7/7`」—— 那两个值（16/16 与 7/7）**都属于不同脚本**
      //     （7/7 是负控的分数，写法上没有反引号脚本名 ⇒ `nextTok` 截不住它）⇒
      //     只用「两值」判据会把这两行**真过期**误判成「对比叙述」而**静默放过**（判据失效而与通过同貌）。
      const hasContrast = /文档写|实际已|实际是|原先写|曾写/.test(seg)
      if (hasContrast && new Set(found.map(f => f.v)).size >= 2) continue
      // ★★ **「变化叙述」排除**（**W65 实测的假红** —— 与 `hasContrast` 同族但形态不同）：
      //   实测形态（本轮自己写的 P-65 定义行 + 方法论 §6.66）：
      //     「selftest **41/41 → 49/49**（正控 1 / 负控 2 …）」
      //   —— 那是**记账口径**：箭头**左侧是历史值**、**右侧才是当前值**。
      //   拿左侧去比对会**永远报红**（假红 ⇒ 训练人忽略报警，**P-38**）。
      //   ★ 为什么必须**单独**加这条而不能并入 `hasContrast`：那条要求「对比措辞 + ≥2 个不同值」
      //     双条件；而「A → B」形态**天然只有一个箭头**、措辞里也没有「文档写/实际已」，
      //     ⇒ 落进 `hasContrast` 的盲区（**P-45**：扫描面与真目标错位）。
      //   ★ 口径（严格，防过宽）：**分数项之后紧跟 `→`**（允许空格与强调符）⇒ 它是历史值，跳过。
      const isHistorySide = (at, v) => {
        const tail = seg.slice(at + v.length).replace(/[\s*]+/, '')
        return tail.startsWith('→')
      }      // 「前面是量词」⇒ 不是分数（防「16 态」「33 项」）
      const sc = found.find(f => !isHistorySide(f.at, f.v)) ?? null
      if (sc === null) continue
      const before = seg.slice(0, sc.at).trimEnd()
      if (/[态项个条处次类格组]$/.test(before)) continue
      // ★★ **「不是本脚本 selftest 分数」排除**（W45 第二轮实测 —— 修掉一处假红，守 P-38）：
      //   实测形态（方法论 §5.4 **P-45 定义行**）：`` `audit-session-integrity.mjs --selftest`
      //   的「与官方参考实现**对账** 91/91」`` —— 那个 **91/91 是对账项数**（该脚本 selftest
      //   实为 18/18）⇒ 拿它比对会**永远报红**（假红会训练人忽略报警）。
      //   ★★ 口径必须**最小**（首版写成「分数前必须紧邻 selftest 或括号」⇒ **一次抽空全部声明**，
      //     被 selftest 正控当场证伪 —— 因为真声明里有「（**真实仓库负控**，**8/8**）」这种
      //     分数前隔着一段说明的写法）⇒ 改为**只排除「分数前紧邻别的量词」**这一种形态。
      const nearTail = before.replace(/[\s*]+$/, '').slice(-4)
      if (/对账|合计|共$/.test(nearTail)) continue
      out.push({ line: i + 1, file: toks[k].file, claimed: sc.v })
    }
  }
  return out
}

/**
 * 检查（**纯函数**，便于 selftest 用合成样本）。
 * @param {Array<{file:string,line:number,claimed:string,doc?:string}>} claims
 * @param {Map<string,string>} actual  脚本名 → 实测 `n/m`
 * @param {(f:string)=>boolean} existsFn
 * @param {Set<string>|null} scopeFn  受检面（构建期闸门名单）
 * @param {(f:string)=>string} docOf  **行号 → 文档名**（★ W45 实测：报红必须指明是**哪份文档**的哪一行，
 *   否则 GOAL L532 与方法论 L532 无法区分 —— 两文件行号会撞车，读者按行号去翻会翻到**无关内容**，P-47）
 */
export function checkClaims (claims, actual, existsFn, scopeFn = null, docOf = () => 'GOAL.md') {
  const problems = []
  const notes = []
  const checked = new Set()
  const reportedUncontract = new Set()
  for (const c of claims) {
    const where = c.doc ? `${c.doc} 第 ${c.line} 行` : `第 ${c.line} 行`
    if (!existsFn(c.file)) {
      problems.push(`${where} 声明了 \`${c.file}\`，但**该脚本不存在** ⇒ 悬空引用（P-11）`)
      continue
    }
    checked.add(c.file)
    // ★★ 第四道口径（守 P-38，**首版被真实仓库证伪**）：**不在受检面内**的装置
    //   （如设备探针 `ef-*` —— 构建期要 adb 才跑得起来）**不参与比对**，
    //   只作**信息项**出声。理由：它们的分数**无法在构建期被证伪**，
    //   纳入比对只会产生**永远无法收敛的红**（P-45：判据的扫描面必须与真目标对齐）。
    if (scopeFn && !scopeFn.has(c.file)) {
      if (!notes.some(n => n.startsWith(`${c.file} `))) {
        notes.push(`${c.file} 声明为 ${c.claimed}（${where}）—— 该装置**不在构建期受检面**（需设备/属库），本条**不比对**（其分数须在设备侧复核）`)
      }
      continue
    }
    const a = actual.get(c.file)
    if (a === undefined) {
      if (reportedUncontract.has(c.file)) continue
      reportedUncontract.add(c.file)
      problems.push(`${where} 声明 \`${c.file}\` 为 **${c.claimed}**，但**跑不出统一分数行** ⇒ 该装置未接入单源输出契约（W44 建立），声明**无法被证伪**（同一脚本的其它声明行不再重复报）`)
      continue
    }
    if (a !== c.claimed) {
      problems.push(`${where} 声明 \`${c.file}\` 为 **${c.claimed}**，实际是 **${a}** ⇒ **声明过期**（P-27 / P-1）：改了判据却没同步文档，引用者会读到错数字`)
    }
  }
  return { problems, notes, checked: [...checked] }
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // ---- ① 单源正则本身必须能解析真实输出（前提断言）----
  const sample = '\n[selftest-summary] goalsections 24/24 PASS'
  const m = SELFTEST_LINE_RE.exec(sample)
  t('前提：单源正则能解析契约行', !!m && m[1] === 'goalsections' && m[2] === '24' && m[3] === '24' && m[4] === 'PASS', `m=${JSON.stringify(m?.slice(1))}`)
  t('前提：正则**不得**被非契约文本误命中',
    !SELFTEST_LINE_RE.test('[goalsections selftest] 24/24 PASS') && !SELFTEST_LINE_RE.test('PASS（14/14）'), '')

  // ---- ② 声明抽取：正控（真实形态）----
  const docGood = [
    // 形态 A：表格行（**同一单元格内**：脚本名后紧跟分数）
    '| 2 | `scripts/audit-shim-template-literal.mjs`（selftest **20/20**） | 说明 |',
    // 形态 B：行内（非表格）
    '`scripts/audit-p48-negctl.mjs`（**真实仓库负控**，**8/8**：注入…），',
    // 形态 C：§3.2 的长距离形态（脚本名 → `（**长描述**，selftest **24/24**：`）
    '`scripts/audit-goal-sections.mjs`（**GOAL §十一 三张工作面表的结构完整性**，selftest **24/24**：',
    '纯文本行不含脚本名与分数',
    '`scripts/audit-x.mjs` 提到但没有分数',
    // ★ 负控形态（**首版被真实仓库证伪的三类**，都**不得**被当作声明）
    '| `scripts/ef-touch-targets.mjs` | 说明 | **16 态全生效 / 0 P1** |',
    '临时探针 `tmp/w32-all-cards-disk.mjs`（30 个会话）',
    '| `scripts/audit-shim-template-literal.mjs` | 说明 | **33 项** |'
  ].join('\n')
  const cl = extractClaims(docGood)
  t('正控：抽到 3 条声明（且排除三类假阳性）', cl.length === 3, `got=${JSON.stringify(cl.map(x => `${x.file}=${x.claimed}`))}`)
  t('正控：三种形态的脚本名与分数都取对',
    cl[0].file === 'audit-shim-template-literal.mjs' && cl[0].claimed === '20/20'
    && cl[1].file === 'audit-p48-negctl.mjs' && cl[1].claimed === '8/8'
    && cl[2].file === 'audit-goal-sections.mjs' && cl[2].claimed === '24/24', '')
  t('零控：「16 态全生效」不得被读成 16/16（量词形态）',
    !cl.some(x => x.claimed === '16/16'), JSON.stringify(cl))
  t('零控：`tmp/…` 路径的临时探针不得被当成受检脚本',
    !cl.some(x => /w32-all-cards/.test(x.file)), '')
  t('零控：跨列边界（`|` 之后）的 N/M 不得被当成该脚本的声明',
    !cl.some(x => x.claimed === '33/33'), JSON.stringify(cl.map(x => x.claimed)))

  // ---- ③ 零控：无分数 / 无脚本名的行**不得**被当成声明 ----
  t('零控：无分数的行不构成声明', cl.every(x => x.claimed), '')

  // ---- ③b ★★ W45 第二轮：**新增两层口径**的回归守护（每层都是被真实仓库证伪后才补上的）----
  //   层一：**任意路径前缀**（`` `node rp-workspace/scripts/x.mjs`（selftest 7/7）`` 形态）
  const docPrefix = [
    '| 矩阵清零 | 残余审计：`node rp-workspace/scripts/audit-matrix-residuals.mjs`（selftest 7/7） |',
    '| 版本一致 | `node rp-workspace/scripts/audit-dsh-version.mjs`（selftest 9/9） |',
    // 零控：`tmp/` 下的临时探针**仍不得**命中（判据按路径**末段目录**过滤）
    '临时探针 `tmp/w45-probe.mjs`（selftest 3/3）',
    '临时探针 `node rp-workspace/tmp/w45-probe.mjs`（selftest 3/3）'
  ].join('\n')
  const cp = extractClaims(docPrefix)
  t('★正控（层一）：反引号内带 `rp-workspace/scripts/` 前缀 ⇒ 必须抽到（W45 实测的漏守形态）',
    cp.length === 2, `got=${JSON.stringify(cp.map(x => `${x.file}=${x.claimed}`))}`)
  t('★正控（层一）：抽出的仍是 **basename**（`audit-matrix-residuals.mjs` / `audit-dsh-version.mjs`）',
    cp[0].file === 'audit-matrix-residuals.mjs' && cp[1].file === 'audit-dsh-version.mjs', '')
  t('★零控（层一）：`tmp/…` 里的临时探针**仍不得**被当成常驻脚本（否则会报「悬空引用」= 假红）',
    !cp.some(x => /w45-probe/.test(x.file)), JSON.stringify(cp.map(x => x.file)))
  //   层二：**对比叙述**（过去值 vs 现在值并列）⇒ 不得当作「当前声明」
  const docContrast = [
    '· `audit-goal-sections.mjs` / `-negctl`：文档写 **16/16 / 11/11**，实际已 **24/24 / 13/13**',
    // 零控：真声明行里「主脚本分数 + 另一脚本分数」并列 ⇒ **必须仍被抽到**（W45 实测的假绿形态）
    '| W45 | `audit-baseline-claims.mjs` selftest 24/24 + 负控 7/7，接入 Step 0.55 第十一组 |'
  ].join('\n')
  const cc = extractClaims(docContrast)
  t('★负控（层二）：对比叙述（「文档写 16/16，实际已 24/24」）⇒ **不得**当当前声明（那是史实，P-38）',
    !cc.some(x => x.claimed === '16/16'), JSON.stringify(cc.map(x => x.claimed)))
  t('★正控（层二）：真声明行（24/24 + 负控 7/7，**两值属不同脚本**）⇒ **必须**抽到 24/24',
    cc.some(x => x.file === 'audit-baseline-claims.mjs' && x.claimed === '24/24'),
    JSON.stringify(cc.map(x => `${x.file}=${x.claimed}`)))
  //   层三：**别的量词**（「对账 91/91」）⇒ 不得当作该脚本的 selftest 分数
  const docOtherQuant = '`audit-session-integrity.mjs --selftest` 的「与官方参考实现**对账** 91/91」'
  t('★负控（层三）：分数前紧邻「对账」⇒ **不得**当本脚本 selftest 分数（W45 实测的假红）',
    !extractClaims(docOtherQuant).some(x => x.claimed === '91/91'), JSON.stringify(extractClaims(docOtherQuant)))

  // ---- ★★ ③d W65：**「A → B」变化叙述**（左值是历史、右值才是当前）----
  //   由头：本轮自己写 P-65 定义行时用了记账口径「selftest **41/41 → 49/49**」，
  //   判据把**左侧历史值**当成当前声明 ⇒ **假红**（P-38）。
  //   ★ 与 `hasContrast`（「文档写 X，实际已 Y」）**同族但不同形态** —— 后者要求「措辞 + ≥2 值」，
  //     本形态只有一个箭头、无对比措辞 ⇒ 落在它的盲区（P-45）。
  {
    // ★ 必须用**受检面内真实存在的脚本名**（`resolveBare` 只认文件系统里真有的 —— P-41）；
    //   用虚构名会让 token 抽不到 ⇒ 走到另一条分支 ⇒ 控**测的不是这条口径**（空转，P-30）。
    const arrow = '`scripts/audit-doc-refs.mjs`（selftest **41/41 → 49/49**：本轮扩面）'
    const cl = extractClaims(arrow)
    t('★负控（W65 · 变化叙述）：`41/41 → 49/49` ⇒ **只许**把**右值**当声明（左值是历史）',
      cl.length === 1 && cl[0].claimed === '49/49', JSON.stringify(cl))
    const plain = '`scripts/audit-doc-refs.mjs`（selftest **49/49**）'
    const c2 = extractClaims(plain)
    t('★正控（W65 · 变化叙述）：无箭头时**照旧**抽到该值（不得因新口径而漏守）',
      c2.length === 1 && c2[0].claimed === '49/49', JSON.stringify(c2))
  }

  // ---- ★★ ③f W65：**gate 文案形态**（无引号裸名 —— 第三受守面）----
  //   由头：`build-dsht.ps1` 的 `Write-Host "  [gate] OK audit-x.mjs --selftest（63/63…）"`
  //   —— 脚本名与分数**都不在反引号里**（PowerShell 文案）⇒ 旧口径**抽出 0 条**
  //   ⇒ 同一族声明写在第**三**处而**无守**（实测 6 处过期，P-58 第 N 次现身）。
  {
    const gateLine = 'Write-Host "  [gate] OK audit-baseline-claims.mjs --selftest（63/63，含…）"'
    // ★ 必须传 `resolveBare`（第⑸条路径要求它 —— 否则**该分支根本不跑**，控会空转，P-30）
    const rb = (n) => (n === 'audit-baseline-claims.mjs' ? n : null)
    const cl = extractClaims(gateLine, { resolveBare: rb })
    t('★正控（W65 · gate 文案）：无引号裸名 + `--selftest（N/M` ⇒ **必须抽出**',
      cl.length === 1 && cl[0].file === 'audit-baseline-claims.mjs' && cl[0].claimed === '63/63', JSON.stringify(cl))
    // ★ 零控：**非 gate 行**里的裸名**不得**被当成声明（防过宽 —— P-38）
    const prose = 'audit-baseline-claims.mjs --selftest（63/63）是上一轮的读数。'
    t('★零控（W65 · gate 文案）：**不含 `[gate] OK` 的散文行** ⇒ 裸名**不得**被抽取（防过宽）',
      extractClaims(prose, { resolveBare: rb }).length === 0, JSON.stringify(extractClaims(prose, { resolveBare: rb })))
  }

  // ---- ★★ ③e W65：**窗口不得截断在数字中间** ----
  //   由头：本轮 P-65 定义行里「selftest **41/41 → 49/49**（正控 1 / 负控 2 / 零控 4 / 真实仓库 1）…」
  //   —— 60 字窗口**正好切在 `49/49` 的最后一字符之前**（seg 末端是 `49/4`）
  //   ⇒ 判据拿 `49/4` 比对真值 ⇒ **永远报红**（假红，P-38）。
  //   ★ 识别特征：报告的「声明值」不是合法分数形态。
  {
    const longTail = '`scripts/audit-doc-refs.mjs`（selftest **41/41 → 49/49**（正控 1 / 负控 2 / 零控 4 / 真实仓库 1 / 说明很长很长很长）'
    const cl = extractClaims(longTail)
    t('★负控（W65 · 窗口截断）：长尾巴下 `49/49` ⇒ **必须完整抽出，不得被切成 `49/4`**',
      cl.length === 1 && cl[0].claimed === '49/49', JSON.stringify(cl))
  }

  // ---- ③c ★★ W61：**不带扩展名的裸名**（§3.1 门禁行的真实写法）----
  //   由头：`GOAL.md` §3.1（每轮必读的基线行）把 13 组闸门写成 `` `audit-goal-sections` 28/28 ``（**无 `.mjs`**）
  //   ⇒ 旧口径（要求 token 带 `.mjs|py`）**一条都抽不到** ⇒ 该行**没有任何机器守着**，
  //     而它里面**恰好有 6 处已过期**。★ **决定性实验**（`tmp/w61-decisive.mjs`）：
  //     正控（带扩展名的 63/63→52/52）报红，而把该行裸名分数改成 1/1 **不报红** = **判据失效与通过同貌**（P-30）。
  //   ★ 解析必须落在**文件系统事实**上（`resolveBare` 只认精确同名）—— 靠写法猜会报假红（P-45）。
  const bareDoc = [
    '| 门禁 | 见 3.2（`audit-a` **10/10** + `audit-b` **8/8**；`audit-missing` **99/99**） |',
    // 零控：不是脚本的裸名（会话名 / 简写 / 参数）**不得**被当成声明
    '| M7 | 会话 `st-vr2jg2` **309/72** 条 · `build-path-parity` 38/38 · `audit-a.mjs` 10/10 |'
  ].join('\n')
  const bareResolve = (n) => ({ 'audit-a': 'audit-a.mjs', 'audit-b': 'audit-b.mjs' }[n] ?? null)
  const cb = extractClaims(bareDoc, { resolveBare: bareResolve })
  t('★★正控（W61 · 裸名）：`audit-a` **10/10**`（**无 `.mjs`**）⇒ **必须**抽到（W61 实测的漏守形态）',
    cb.some(x => x.file === 'audit-a.mjs' && x.claimed === '10/10'),
    JSON.stringify(cb.map(x => `${x.file}=${x.claimed}`)))
  t('★正控（W61 · 裸名）：同一行两个裸名各自的分数都抽对（`audit-a` 10/10 · `audit-b` 8/8）',
    cb.some(x => x.file === 'audit-a.mjs' && x.claimed === '10/10') &&
    cb.some(x => x.file === 'audit-b.mjs' && x.claimed === '8/8'), JSON.stringify(cb))
  t('★★零控（W61 · 不得过宽）：不是脚本的裸名（`st-vr2jg2` / `build-path-parity`）**不得**被当成脚本声明',
    !cb.some(x => /st-vr2jg2|build-path-parity/.test(x.file)), JSON.stringify(cb.map(x => x.file)))
  t('★★零控（W61 · 解析不出 ⇒ 不当声明）：`audit-missing` 99/99`（脚本不存在）⇒ 不得被抽到（否则报悬空引用 = 假红）',
    !cb.some(x => /audit-missing/.test(x.file)), JSON.stringify(cb.map(x => x.file)))
  t('★杠杆（W61 · 裸名）：**不给 `resolveBare`** ⇒ 裸名不认（证明这一层是**显式开关**，不是全局放宽）',
    extractClaims(bareDoc).every(x => /\.(mjs|py)$/.test(x.file)), JSON.stringify(extractClaims(bareDoc)))

  // ---- ③d ★★ W62：**读数登记表与接线的一致性** ----
  //   由头：`build-dsht.ps1` 的读数回显曾有**三套平行实现**（Step 0.5 循环内表 /
  //   Step 0.55 硬编码一段 / 干脆不过滤），覆盖面只及各自所在的那一段
  //   ⇒ 21 个闸门有读数行而日志里只有 3 条；`TARGETS 9 项` / `17 marker` / `实读 7 条`
  //     等**写死在 §3.1/§3.2 的数字**在日志里**零观测面**（与 W57「路由 67 条」同形）。
  const GOOD_BUILD = [
    "$readingGates = @{",
    "    'audit-a.mjs' = @{ Exe = 'node'; Pattern = '\\[A 读数\\]'; Label = 'A' }",
    "    'audit-b.mjs' = @{ Exe = 'python'; Pattern = '\\[B 读数\\]'; Label = 'B' }",
    '}',
    'function Show-Reading { param($Gate, $Path); if (-not $readingGates.ContainsKey($Gate)) { return } }',
    '$auditNode = @(',
    "    'audit-a.mjs',",
    "    'audit-b.mjs'",
    ')',
    'foreach ($a in $auditNode) {',
    '    & node $p | Out-Null',
    '    Show-Reading -Gate $a -Path $p',
    '}',
    "$c = Join-Path $ws 'scripts\\audit-b.mjs'",
    "Show-Reading -Gate 'audit-b.mjs' -Path $c"
  ].join('\n')
  const rwOk = readingWiringProblems(GOOD_BUILD)
  t('★★正控（W62 · 接线一致）：登记 2 条 + 循环变量覆盖 + 字面量调用 ⇒ **不得报红**',
    rwOk.problems.length === 0, JSON.stringify(rwOk))
  t('★正控（W62 · 计数）：登记 2 条 / 已接线 2 条（循环 + 字面量**去重**）',
    rwOk.registered === 2 && rwOk.wired.length === 2, JSON.stringify(rwOk))
  // 负控①：登记了但**没有任何接线** ⇒ 必须报红（这是 W62 的结构性缺陷形态）
  const rwNoWire = readingWiringProblems(
    "$readingGates = @{\n    'audit-a.mjs' = @{ Exe = 'node'; Pattern = 'x'; Label = 'A' }\n    'audit-c.mjs' = @{ Exe = 'node'; Pattern = 'y'; Label = 'C' }\n}\n"
    + GOOD_BUILD)
  t('★★负控（W62 · 登记 ≠ 接线）：`audit-c.mjs` 登记了却无 `Show-Reading` ⇒ **必须报红**（空声明）',
    rwNoWire.problems.some(p => /audit-c\.mjs/.test(p) && /空声明/.test(p)),
    JSON.stringify(rwNoWire.problems))
  // 负控②：`-Gate` 指向的**不是构建期闸门**（拼错名 / 脚本已删）⇒ 必须报红
  //   ★ 必须传 `existsFn`（**W62 实测：首版不传 ⇒ 幽灵名照样匹配名字正则 ⇒ 假绿**）
  const rwGhost = readingWiringProblems(
    GOOD_BUILD.replace("Show-Reading -Gate 'audit-b.mjs' -Path $c", "Show-Reading -Gate 'audit-b-ghost.mjs' -Path $c"),
    (f) => ['audit-a.mjs', 'audit-b.mjs'].includes(f))
  t('★负控（W62 · 幽灵接线）：`-Gate` 指向不在闸门名单的脚本 ⇒ **必须报红**（静默失效）',
    rwGhost.problems.some(p => /audit-b-ghost/.test(p)), JSON.stringify(rwGhost.problems))
  // ★★ 零控（W62 实测的假红形态）：**登记表行里含 `)` 与单引号**时，数组抽取**不得**被截断
  //   实测形态：`'audit-th-face-coverage.mjs' = @{ Exe = 'node'; Pattern = '\[TH 面读数\]'; Label = '…（§3.1 …）' }`
  //   —— 非贪婪 `\)` 会在**注释里**提前收尾 ⇒ 该闸门被漏掉 ⇒ 误报「空声明」（**假红**）。
  const GOOD_BUILD_PARENS = [
    "$readingGates = @{",
    "    # 说明：本行含 `)` 与单引号（`\\[TH 面读数\\]`），旧口径会在此提前收尾",
    "    'audit-a.mjs' = @{ Exe = 'node'; Pattern = '\\[TH 面读数\\]'; Label = 'TH 三份名单条数（§3.1 TH 覆盖面 / README）' }",
    '}',
    '$auditNode = @(',
    "    'audit-a.mjs',",
    '    # 注释里也出现同一个名字（不得被当成数组条目）',
    "    'audit-b.mjs'",
    ')',
    'foreach ($a in $auditNode) {',
    '    Show-Reading -Gate $a -Path $p',
    '}'
  ].join('\n')
  const rwParen = readingWiringProblems(GOOD_BUILD_PARENS)
  t('★★零控（W62 · 括号配平）：登记表行含 `)` / 单引号 / 注释同名出现 ⇒ **不得**误报空声明（防假红）',
    rwParen.problems.length === 0, JSON.stringify(rwParen))
  t('★★零控（W62 · 循环数组只收顶格条目）：`$auditNode` 的注释行**不得**被当成数组条目',
    rwParen.wired.includes('audit-a.mjs') && rwParen.wired.includes('audit-b.mjs'), JSON.stringify(rwParen.wired))
  // ⑤ 真实仓库：登记表与接线**当前一致**（这是本判据的真对象）
  if (fs.existsSync(BUILD)) {
    const rwReal = readingWiringProblems(fs.readFileSync(BUILD, 'utf8'),
      (f) => fs.existsSync(path.join(SCRIPTS, f)))
    t('★★真实仓库（W62）：读数登记表与接线**一致**（登记即接线 · 无幽灵接线）',
      rwReal.problems.length === 0, JSON.stringify(rwReal.problems))
    t('★★真实仓库（W62）：登记表**非空**（0 条 ⇒ 判据**空转**，P-30）',
      rwReal.registered >= 5, `registered=${rwReal.registered}`)
  }

  // ---- ④ checkClaims：一致 ⇒ 通过 ----
  const exists = (f) => ['audit-a.mjs', 'audit-b.mjs'].includes(f)
  const actual = new Map([['audit-a.mjs', '10/10'], ['audit-b.mjs', '8/8']])
  const r1 = checkClaims([{ line: 1, file: 'audit-a.mjs', claimed: '10/10' }, { line: 2, file: 'audit-b.mjs', claimed: '8/8' }], actual, exists)
  t('正控：声明与实测一致 ⇒ 无问题', r1.problems.length === 0, r1.problems.join(' / '))

  // ---- ⑤ ★ 负控：声明过期（**W44 实测的真缺陷形态**）⇒ 报红且指向行号 ----
  const r2 = checkClaims([{ line: 504, file: 'audit-a.mjs', claimed: '16/16' }], actual, exists)
  t('负控：声明 16/16 而实际 10/10 ⇒ 报红', r2.problems.length === 1 && /声明过期/.test(r2.problems[0]), r2.problems[0]?.slice(0, 70) ?? '')
  t('负控：报红**精确指向行号与两个值**',
    /第 504 行/.test(r2.problems[0]) && /16\/16/.test(r2.problems[0]) && /10\/10/.test(r2.problems[0]), '')

  // ---- ⑥ ★ 杠杆（P-20）：**只把声明改成与实测一致** ⇒ 必须转绿 ----
  const r3 = checkClaims([{ line: 504, file: 'audit-a.mjs', claimed: '10/10' }], actual, exists)
  t('杠杆：仅把声明改成实测值 ⇒ 必须转绿', r3.problems.length === 0, r3.problems.join(' / '))

  // ---- ⑦ 负控：脚本跑不出统一分数行 ⇒ 报红（声明无法被证伪）----
  const r4 = checkClaims([{ line: 9, file: 'audit-b.mjs', claimed: '8/8' }], new Map(), exists)
  t('负控：装置未接入契约（跑不出分数行）⇒ 报红', r4.problems.length === 1 && /无法被证伪/.test(r4.problems[0]), r4.problems[0]?.slice(0, 60) ?? '')

  // ---- ⑧ 负控：悬空引用（脚本不存在）⇒ 报红 ----
  const r5 = checkClaims([{ line: 3, file: 'audit-ghost.mjs', claimed: '1/1' }], actual, exists)
  t('负控：声明了不存在的脚本 ⇒ 报红', r5.problems.length === 1 && /悬空引用/.test(r5.problems[0]), '')

  // ---- ⑨ 真实仓库（动态）：受检闸门数与声明数 ----
  if (fs.existsSync(BUILD)) {
    const gates = discoverBuildGates(fs.readFileSync(BUILD, 'utf8'), (n) => fs.existsSync(path.join(SCRIPTS, n)))
    t('真实仓库：从 build-dsht.ps1 实读到构建期闸门（≥10 个）', gates.length >= 10, `发现 ${gates.length} 个：${gates.slice(0, 6).join(' ')}…`)
    t('零控：设备探针（ef-*）**不得**进受检名单（构建期跑不了它们）',
      !gates.some(g => /^ef-/.test(g)), gates.filter(g => /^ef-/.test(g)).join(' '))
  } else t('真实仓库：找到 build-dsht.ps1', false, BUILD)
  if (fs.existsSync(GOAL)) {
    const claims = extractClaims(fs.readFileSync(GOAL, 'utf8'))
    t('真实仓库：GOAL 里抽到声明（≥8 条）', claims.length >= 8, `抽到 ${claims.length} 条`)
  } else t('真实仓库：找到 GOAL.md', false, GOAL)

  // ★ 单源输出契约（W44 建立）：**守契约的装置自己必须先遵守契约**。
  //   ★★ 为什么这一行是缺陷修复（W45 实测）：本闸门此前**自己不在受检面内的「已接入」名单里**
  //   （收尾仍是旧形态 `[selftest] PASS（17/17）`）⇒ 它一边报别人「未接入契约」，
  //   一边**自己也没接入** ⇒ 文档里它的分数声明**同样无法被证伪**（P-1 在装置自身的违例）。
  // ---- ★★ W71：**头注声明的判据条数 vs 实现条数**（本轮实测的真缺陷）----
  //   由头：两个闸门的头注「判据（N 条）」双双过期（五→七 / 五→八），
  //     而**七个闸门全部 exit=0**（决定性实验）。
  //   ★ 控必须**成对**（P-67 纪律③）：⑴ 声明 > 实现 ⇒ 必须报红；⑵ 声明 ≤ 实现 ⇒ 不得报红
  //     （圈号可作子编号 `⑦a`，故允许多于声明）；⑶ 零圈号 ⇒ fail-closed；⑷ 无声明 ⇒ 不判（P-38）。
  const H = (t) => headNoteCountProblems(t)
  t('★正控（W71 · 一致）：头注「判据（三条）」+ 实现标出 ①②③ ⇒ 不得报红',
    H('/**\n * ## 判据（三条）\n * ① a\n * ② b\n * ③ c\n */\nimport fs\nconst x=1 // ① ② ③\n').problems.length === 0, '')
  t('★★负控（W71 · 声明 > 实现）：头注「判据（五条）」而实现只标出 ①②③ ⇒ **必须报红**',
    H('/**\n * ## 判据（**五条**）\n */\nimport fs\n// ① ② ③\n').problems.length === 1, '')
  t('★★负控（W71 · 阿拉伯数字同样认）：头注「判据（7 条）」而实现 3 条 ⇒ **必须报红**',
    H('/**\n * ## 判据（7 条）\n */\nimport fs\n// ① ② ③\n').problems.length === 1, '')
  // ★★ **「项」与「条」同义**（**W71 实测当场踩到**：`audit-goal-sections` 原写「五项」⇒
  //    只认「条」会让它**静默落进「无声明」分支** = 判据对它零覆盖，P-45/P-19）
  t('★★负控（W71 · 「项」与「条」同义）：头注「判据（… **五项** + 一项提示）」而实现 3 条 ⇒ **必须报红**',
    H('/**\n * ## 判据（静态扫 GOAL.md，**五项** + 一项提示）\n */\nimport fs\n// ① ② ③\n').problems.length === 1, '')
  t('★杠杆（W71）：只把实现补到 5 条 ⇒ **必须转绿**（证明负控不是恒定红）',
    H('/**\n * ## 判据（**五条**）\n */\nimport fs\n// ① ② ③\n').problems.length === 1
    && H('/**\n * ## 判据（**五条**）\n */\nimport fs\n// ① ② ③ ④ ⑤\n').problems.length === 0, '')
  // ★ 零控：圈号可作**子编号**（`⑦a`）⇒ 实现条数**多于**声明 ⇒ 不得报红（防过宽，P-38）
  t('★零控（W71 · 子编号）：实现标出 7 条而头注只声明 5 条（圈号含子编号）⇒ **不得报红**',
    H('/**\n * ## 判据（**五条**）\n */\nimport fs\n// ① ② ③ ④ ⑤ ⑥ ⑦\n').problems.length === 0, '')
  // ★ 零控：零圈号 ⇒ fail-closed（不当 0 违规 —— P-30 最危险形态）
  t('★零控（W71 · 零样本）：头注声明条数而**全文无圈号** ⇒ **必须报红**（fail-closed）',
    H('/**\n * ## 判据（三条）\n */\nimport fs\nconst x=1\n').problems.length === 1, '')
  // ★ 零控：**没有声明条数**的闸门 ⇒ 不得报红（写法自由，不是缺陷）
  t('★零控（W71 · 无声明）：头注没写「判据（N 条）」⇒ **不得报红**（P-38 防过宽）',
    H('/**\n * ## 判据\n * ① a\n */\nimport fs\n// ①\n').problems.length === 0
    && H('/** 无判据区 */\nimport fs\n').problems.length === 0, '')
  // ★★ **W79 补：中文数字必须整串解析**（**修的是判据自己的口径缺陷 —— 负控空转**）
  //   由头：原口径 `CN_NUM[m[1][0]]` **只取首字** ⇒ 「九十九」被读成 9 ⇒
  //     真实实现有 10 个圈号 ⇒ `9 ≤ 10` ⇒ 不报红 ⇒ **负控 E 空转**（**P-30**）。
  t('★★负控（W79 · 中文数字整串解析）：「判据（**九十九条**）」而实现 3 条 ⇒ **必须报红**（原口径只取首字「九」⇒ 空转）',
    H('/**\n * ## 判据（**九十九条**）\n */\nimport fs\n// ① ② ③\n').problems.length === 1,
    JSON.stringify(headNoteCountProblems('/**\n * ## 判据（**九十九条**）\n */\nimport fs\n// ① ② ③\n')))
  t('★正控（W79 · 中文数字解析）：`十` → 10 · `十M` → 1M · `N十` → N0 · `N十M` → NM',
    parseCnNumber('十') === 10 && parseCnNumber('十五') === 15 && parseCnNumber('二十') === 20
    && parseCnNumber('二十三') === 23 && parseCnNumber('七') === 7, '')
  t('★★零控（W79 · 认不出 ⇒ 无判据力）：`CN_NUM` 之外的怪写法 ⇒ `null`（**P-43**，不许拿猜的数判 FAIL）',
    parseCnNumber('廿') === null && parseCnNumber('壹佰') === null && parseCnNumber('') === null, '')
  t('★杠杆（W79）：把「九十九条」改成 `11 条` 且实现只有 3 条 ⇒ **仍报红**（证明上一条不是只认中文的特例）',
    H('/**\n * ## 判据（**11 条**）\n */\nimport fs\n// ① ② ③\n').problems.length === 1, '')
  // ★ 零控：**只查头注区** —— 正文里的同形句子（如注释讲历史）不得被当成声明（P-38）
  t('★零控（W71 · 只查头注）：正文里出现「判据（九条）」而头注没写 ⇒ **不得报红**',
    H('/**\n * ## 判据\n */\nimport fs\n// 历史：当时头注写「判据（九条）」\n// ① ②\n').problems.length === 0, '')
  // ★★ 真实仓库：两个**已知过期**的头注必须已被修好（否则主流程会红）
  for (const [f, want] of [['audit-doc-refs.mjs', 7], ['audit-goal-sections.mjs', 8]]) {
    const p = path.join(SCRIPTS, f)
    if (!fs.existsSync(p)) continue
    const r = H(fs.readFileSync(p, 'utf8'))
    t(`★真实仓库（W71 · ${f}）：头注声明的条数 ≤ 实现条数（不再过期）`,
      r.problems.length === 0 && r.circled >= want, `declared=${r.declared} circled=${r.circled}`)
  }

  // ---- ★★ W72：**表格行内「分数在后续列」必须被抽到**（本轮实测的真缺陷）----
  //   由头：§3.2 门禁清单的 11 处声明**全部抽不到**（窗口卡在表格列边界 `|`）⇒
  //     其中 **4 处已过期**而**完全无人守**（**P-30**）。
  //   ★ 控必须**成对**（P-67 纪律③）：⑴ 跨列（说明列里有 `selftest N/M`）⇒ **必须抽到**；
  //     ⑵ 跨列但**没有 `selftest` 字样** ⇒ **不得抽到**（防 `16 态全生效` 被读成 `16/16`，P-38）；
  //     ⑶ **P 判据定义行**（`| P-nn |`）⇒ **不得跨列**（那里的分数是**落地记账**，不是当前声明）。
  {
    const TB = (l2) => `## 三、当前基线\n| # | 脚本 | 说明 |\n|---|---|---|\n${l2}\n`
    const A_SCRIPTS = ['audit-impl-duplication.mjs', 'audit-route-contract.mjs']
    const res = (l2) => extractClaims(TB(l2), { allowRegion: () => true, resolveBare: (n) => (A_SCRIPTS.includes(n + '.mjs') ? n + '.mjs' : null) })
    // ⑴ ★ 正控：跨列形态（脚本名在第 2 列、分数在说明列）
    const cross = res('| 3 | `scripts/audit-impl-duplication.mjs` | **F5** 重复体（selftest **15/15**） |')
    t('★★正控（W72 · 跨列）：表格行里「脚本名在第 2 列、`selftest N/M` 在说明列」⇒ **必须抽到**',
      cross.length === 1 && cross[0].claimed === '15/15', JSON.stringify(cross.map(c => c.claimed)))
    // ⑵ ★ 零控：跨列但**无 `selftest` 字样** ⇒ 不得抽到（防「16 态全生效」被读成 16/16，P-38）
    const noKw = res('| 5 | `scripts/audit-route-contract.mjs` | 说明 | **16 态全生效 / 0 P1** |')
    t('★零控（W72 · 无 selftest 字样）：说明列里的 `16 态全生效` ⇒ **不得**被读成分数（P-38 防过宽）',
      noKw.length === 0, JSON.stringify(noKw.map(c => c.claimed)))
    // ⑶ ★ 零控：P 判据定义行 ⇒ 不跨列（那里写的是落地记账）
    const pdef = res('| P-57 | **验收标准** | **W51 已落地**：selftest **24/24 → 36/36** |')
    t('★零控（W72 · P 判据定义行）：`| P-nn |` 行里的分数是**落地记账** ⇒ **不得**当当前声明（P-38）',
      pdef.length === 0, JSON.stringify(pdef.map(c => c.claimed)))
    // ⑷ ★ 杠杆：同一行的写法**只去掉** `selftest` 一词 ⇒ **必须转绿**（证明判据真在测那一条口径）
    t('★杠杆（W72）：把 `selftest ` 一词去掉 ⇒ **必须抽不到**（证明「须有 selftest 字样」这条口径在起作用）',
      cross.length === 1 && noKw.length === 0, `cross=${cross.length} noKw=${noKw.length}`)
  }

  // ---- ★★ W73：**头注的「无汇总数逐条清单」vs 实现里的分组键**（本轮实测的真缺陷）----
  //   由头：W71 只守「带汇总数」的写法，而「只有逐条清单、没有汇总数」那一类
  //     **整类落在扫描面之外** ⇒ 实测 **5 处漏记**（`-baseline-claims-negctl` A~B vs A~M 等），
  //     而**五个闸门全 exit=0**（**P-30**）。★ 后者**更危险**：连「该改哪个数字」都不存在。
  //   ★ 控必须**成对**（P-67 纪律③）：⑴ 漏记 ⇒ 必须报红；⑵ 补全 ⇒ 不得报红；
  //     ⑶ 清单**多写**（超过实现最大键）⇒ 不得报红（守 P-38 防过宽）；
  //     ⑷ 两侧任一为空 ⇒ 不判（P-43：该脚本不用这种写法 ⇒ 无判据力）。
  const L_ = (src) => headNoteListProblems(src)
  const HEAD3 = '/**\n * ## 注入什么\n *   A. 第一条\n *   B. 第二条\n *   C. 第三条\n */\nimport fs\n'
  // ⑴ ★★ 正控：清单写全 ⇒ 不得报红
  t('★★正控（W73 · 清单写全）：头注 A/B/C 三条 + 实现 A/B/C 三组 ⇒ **不得报红**',
    L_(HEAD3 + "// ---- A：x ----\ndrill('负控A')\n// ---- B：x ----\ndrill('负控B')\n// ---- C：x ----\ndrill('负控C')\n").problems.length === 0, '')
  // ⑵ ★★ 负控：实现多了 D/E ⇒ **必须报红**（**本轮实测的真缺陷形态**）
  {
    const r = L_(HEAD3 + "// ---- A：x ----\ndrill('负控A')\n// ---- B：x ----\ndrill('负控B')\n// ---- C：x ----\ndrill('负控C')\n// ---- ★★ D（新增）：x ----\ndrill('负控D（x）')\n// ---- ★★ E（新增）：x ----\ndrill('负控E（x）')\n")
    t('★★负控（W73 · 实现有而清单无）：头注只写到 C 而实现已有 A~E ⇒ **必须报红**',
      r.problems.length === 1 && r.missing.join('') === 'DE', `missing=${r.missing.join(',')}`)
  }
  // ⑶ ★ 零控：清单**多写**（D/E 只在清单里、实现没有）⇒ 不得报红（守 P-38 防过宽）
  t('★零控（W73 · 清单多写）：头注 A~E 而实现只到 C ⇒ **不得报红**（多写不是缺陷，P-38）',
    L_('/**\n * ## 注入什么\n *   A. 一\n *   B. 二\n *   C. 三\n *   D. 四\n *   E. 五\n */\nimport fs\n// ---- A：x ----\ndrill(\'负控A\')\n// ---- B：x ----\ndrill(\'负控B\')\n// ---- C：x ----\ndrill(\'负控C\')\n').problems.length === 0, '')
  // ⑷ ★ 零控：两侧任一为空 ⇒ 不判（P-43 无判据力）
  t('★零控（W73 · 无清单）：头注里没有逐条清单 ⇒ **不得报红**（P-43 无判据力）',
    L_('/**\n * ## 注入什么\n *   （散文，无 A./B. 形态）\n */\nimport fs\n// ---- A：x ----\ndrill(\'负控A\')\n').problems.length === 0
    && L_(HEAD3 + 'import fs\nconst x = 1\n').problems.length === 0, '')
  // ⑸ ★ 杠杆：把漏掉的组**补进清单** ⇒ **必须转绿**（证明负控不是恒定红）
  {
    const impl = "// ---- A：x ----\ndrill('负控A')\n// ---- B：x ----\ndrill('负控B')\n// ---- C：x ----\ndrill('负控C')\n// ---- ★★ D（新增）：x ----\ndrill('负控D（x）')\n"
    t('★杠杆（W73）：把缺失的 D 补进清单 ⇒ **必须转绿**（证明负控不是恒定红）',
      L_(HEAD3 + impl).problems.length === 1
      && L_('/**\n * ## 注入什么\n *   A. 一\n *   B. 二\n *   C. 三\n *   D. 四\n */\nimport fs\n' + impl).problems.length === 0, '')
  }
  // ★★ 真实仓库：**已知漏记**必须已被修好（否则主流程会红）
  //   ★ W79 补：把 `audit-selftest-claims-negctl.mjs` **也纳入**（此前只列 4 个 ⇒
  //     该文件**缺 H 组清单项**（W73 遗留）而**无人报**（**P-45**：扫描面与真目标错位）。
  //   ★★ **W80 修：受检面改为「按语义自动发现」**（**P-1 / P-61**）——
  //     ★ 由头：这三处是**手写文件清单**，而全仓有 **14 个 `-negctl`** ⇒ 手写 5 项
  //     **把另外 9 个整片划成了无人区**（与 W61 的「为防假红而收窄」同一形态）。
  //     ★★ **W80 决定性实验**：`audit-a14-anchor-negctl.mjs` 有头注清单（`head=ABC`）
  //     而**不在受检面内** ⇒ 它的清单**永不比对**（**P-30**：没守与守住在报告上同貌）。
  //     ⇒ 改为：**扫 `scripts/` 下所有 `*-negctl.<ext>`**，逐个跑 W73 判据；
  //     ★ 对「无该写法」的（`headKeys` 与 `implKeys` 都为空）**只出声不报红**（**P-43**）。
  {
    const negFiles = (() => {
      try {
        return fs.readdirSync(SCRIPTS).filter((f) => /-negctl\.(mjs|py)$/.test(f)).sort()
      } catch { return [] }
    })()
    let scanned = 0
    const silent = []
    for (const f of negFiles) {
      const p = path.join(SCRIPTS, f)
      const r = L_(fs.readFileSync(p, 'utf8'))
      if (r.headKeys.size === 0 && r.implKeys.size === 0) { silent.push(f); continue }   // 无该写法 ⇒ 无判据力
      scanned += 1
      t(`★真实仓库（W73/W80 · ${f}）：头注清单键 ⊇ 实现分组键（不再漏记）`,
        r.problems.length === 0, `head=${r.headKeys.size} impl=${r.implKeys.size} missing=${r.missing.join(',')}`)
    }
    t('★★真实仓库（W80 · 受检面自动发现）：`*-negctl.*` 全仓枚举，**受检数 ≥ 5**（W80 前为手写 5 项 ⇒ 会把新增的漏在外）',
      scanned >= 5, `scanned=${scanned} / 全仓 ${negFiles.length}`)
    t('★★零控（W80 · 无该写法只出声）：无「逐条清单」写法的 negctl **不计入受检数**（P-43 无判据力）',
      silent.length + scanned === negFiles.length && negFiles.length > 0,
      `silent=${silent.length} scanned=${scanned} total=${negFiles.length}`)
  }

  // ---- ★★ W74：**闸门支持的「输入面参数」必须被负控真的传过**（本轮实测的真缺陷）----
  //   由头：`audit-baseline-claims.mjs` 支持 `--file/--readme/--freeze/--tasklist` 四个输入面，
  //     而 `-negctl` **只传了前三个** ⇒ **TASK-LIST 那一半无法被负控**（**P-1 / P-59 纪律②**）。
  //   ★ 控必须**成对**（P-67 纪律③）：⑴ 缺传 ⇒ 必须报红；⑵ 传全 ⇒ 不得报红；
  //     ⑶ 无同名负控 ⇒ 只出声不报红（P-43）；⑷ 「运行模式 flag」（`--selftest`）不得被误判为输入面（P-38）。
  {
    const R = (scripts, neg) => inputFaceProblems(scripts, (f) => neg[f] ?? null)
    const GATE = 'audit-x.mjs'
    // ★ 合成样本用 `argv.indexOf` 的**真实形态**构造（不是字符串拼接，避免自我污染：
    //   本文件里若出现 `process.argv.indexOf('--tasklist')` 的字面量，**判据会把自己读成受检对象** ——
    //   这正是 **W74 实测踩到的第三种自指污染**，故这里用**转义拼接**构造，让它在本文件里**不成形**。
    const Q = String.fromCharCode(39)   // 单引号
    const gateSrc = `const a = process.argv.indexOf(${Q}--file${Q})\nconst b = process.argv.indexOf(${Q}--tasklist${Q})\n`
    // ⑴ ★★ 负控：负控只传了 --file（漏 --tasklist）⇒ **必须报红**（**本轮实测的真缺陷形态**）
    {
      const r = R([{ name: GATE, src: gateSrc }], { 'audit-x-negctl.mjs': "runAudit('--file')\n" })
      t('★★负控（W74 · 输入面漏传）：闸门支持 --file/--tasklist 而负控只传 --file ⇒ **必须报红**',
        r.problems.length === 1 && /--tasklist/.test(r.problems[0]), `problems=${r.problems.length}`)
    }
    // ⑵ ★ 正控：负控两个都传 ⇒ 不得报红
    t('★正控（W74 · 输入面传全）：负控同时传 --file 与 --tasklist ⇒ **不得报红**',
      R([{ name: GATE, src: gateSrc }], { 'audit-x-negctl.mjs': "runAudit('--file'); x('--tasklist')\n" }).problems.length === 0, '')
    // ⑶ ★ 零控：**无同名负控** ⇒ 只出声不报红（P-43：很多闸门天然不需要负控）
    {
      const r = R([{ name: 'audit-y.mjs', src: gateSrc }], {})
      t('★零控（W74 · 无同名负控）：不得报红，但要**出声**（P-43 无判据力）',
        r.problems.length === 0 && r.notes.length === 1 && r.checked === 0, `notes=${r.notes.length} checked=${r.checked}`)
    }
    // ⑷ ★★ 零控：**只认「输入面 flag」白名单** —— `--selftest` 是**运行模式**，不得被当输入面（P-38 防过宽）
    t('★★零控（W74 · 运行模式不算输入面）：闸门只用 `--selftest`（无输入面 flag）⇒ **不得报红**',
      R([{ name: GATE, src: "if (process.argv.includes('--selftest')) {}\n" }], { 'audit-x-negctl.mjs': 'x\n' }).problems.length === 0, '')
    // ⑸ ★★ 零控：**判据自己的白名单常量行必须被剔除**（**W74 实测踩到的自指污染**）
    t('★★零控（W74 · 自指剔除）：源码里出现 `INPUT_FACE_FLAGS = [...]` 那一行 ⇒ **不得**被读成「本闸门支持这些输入面」',
      R([{ name: GATE, src: "const INPUT_FACE_FLAGS = ['--file', '--method', '--readme', '--freeze', '--tasklist', '--as']\n" }],
        { 'audit-x-negctl.mjs': 'x\n' }).problems.length === 0, '')
    // ⑹ ★ 杠杆：把漏传的那个补上 ⇒ **必须转绿**（证明负控不是恒定红）
    t('★杠杆（W74）：把漏传的 `--tasklist` 补进负控 ⇒ **必须转绿**',
      R([{ name: GATE, src: gateSrc }], { 'audit-x-negctl.mjs': "runAudit('--file')\n" }).problems.length === 1
      && R([{ name: GATE, src: gateSrc }], { 'audit-x-negctl.mjs': "runAudit('--file', null, null, '--tasklist')\n" }).problems.length === 0, '')
    // ★★ 真实仓库：`audit-baseline-claims.mjs` 的四个输入面必须都已被负控覆盖（本轮已修）
    {
      const gp = path.join(SCRIPTS, 'audit-baseline-claims.mjs')
      const np = path.join(SCRIPTS, 'audit-baseline-claims-negctl.mjs')
      if (fs.existsSync(gp) && fs.existsSync(np)) {
        const r = R([{ name: 'audit-baseline-claims.mjs', src: fs.readFileSync(gp, 'utf8') }],
          { 'audit-baseline-claims-negctl.mjs': fs.readFileSync(np, 'utf8') })
        t('★★真实仓库（W74）：`audit-baseline-claims.mjs` 的四个输入面（含 `--tasklist`）**都已接入负控**',
          r.problems.length === 0, r.problems[0]?.slice(0, 100) ?? '')
      }
    }
  }

  // ---- ★★ W75：**头注声明的「退出码」必须与实现一致**（本轮实测的真缺陷）----
  //   由头：本闸门已守「声明的自证分数」（W44）「声明的判据条数」（W71）「头注的逐条清单」（W73）三类；
  //     本轮按 **P-59 纪律①** 穷举**第四类** —— **`## 退出码` 段**（给读者与 CI 用的接口契约）。
  //   ★★ 实测 3 处真缺陷：`audit-error-layer-classify.mjs` / `audit-open-items.mjs` 头注声明
  //     「2 = selftest 失败」而实现是 `fail === 0 ? 0 : 1` ⇒ **「闸门自己坏了」与「闸门检出违规」
  //     返回同一个码**（头注承诺的区分根本不存在）；`audit-rule-claims.mjs` 声明 2 而实现是 3。
  //   ★ 控必须**成对**（P-67 纪律③）：⑴ 幽灵声明 ⇒ 必须报红；⑵ 未声明的码 ⇒ 必须报红；
  //     ⑶ 一致 ⇒ 不得报红；⑷ 无该段 ⇒ 不判（P-43）；⑸ 字符串样本不得被读成真调用（防自造假红）；
  //     ⑹ 表达式形态必须被认（防假红）；⑺ 标准信号码豁免但要**成对**验。
  {
    const H = (codesLine, body) => `/**\n * ## 退出码\n *   ${codesLine}\n */\nimport fs from 'node:fs'\n${body}`
    // ⑴ ★★ 幽灵声明：头注写「2 = selftest 失败」而实现只有 0/1 ⇒ 必须报红（**本轮实测的真缺陷形态**）
    {
      const r = exitCodeProblems(H('0 = 通过    1 = 检出违规    2 = selftest 失败',
        'if (a) { process.exit(fail === 0 ? 0 : 1) }\n'))
      t('★★负控（W75 · 幽灵声明）：头注声明「2 = selftest 失败」而实现只有 0/1 ⇒ **必须报红**',
        r.ghost.join('') === '2' && r.problems.length === 1, `ghost=${r.ghost.join(',')}`)
    }
    // ⑵ ★★ 未声明的码：实现返回 3 而头注只写到 2 ⇒ 必须报红（**本轮实测的第二形态**）
    {
      const r = exitCodeProblems(H('0 = 通过    1 = 检出违规    2 = selftest 失败',
        'if (a) { process.exit(ok ? 0 : 3) } else { process.exit(1) }\nprocess.exit(2)\n'))
      t('★★负控（W75 · 未声明的码）：实现返回 3 而头注只写到 2 ⇒ **必须报红**（且幽灵面为空）',
        r.undeclared.join('') === '3' && r.ghost.length === 0, `undeclared=${r.undeclared.join(',')} ghost=${r.ghost.join(',')}`)
    }
    // ⑶ ★ 正控：声明与实现一致 ⇒ 不得报红
    t('★正控（W75 · 一致）：头注 0/1/2 且实现恰好返回 0/1/2 ⇒ **不得报红**',
      exitCodeProblems(H('0 = 通过    1 = 检出违规    2 = selftest 失败',
        'if (a) { process.exit(fail === 0 ? 0 : 2) }\nprocess.exit(1)\n')).problems.length === 0, '')
    // ⑷ ★ 零控：无 `## 退出码` 段 ⇒ 不判（P-43：该脚本不承诺这套接口）
    t('★零控（W75 · 无该段）：头注里没有「## 退出码」⇒ **不得报红**（P-43 无判据力）',
      exitCodeProblems('/**\n * 只是一段说明\n */\nimport fs\nprocess.exit(1)\n').problems.length === 0, '')
    // ⑸ ★★ 零控：**字符串里的 `process.exit(130)` 不得被读成真调用**（**W75 实测踩到的自造假红**）
    t('★★零控（W75 · 字符串样本）：源码里的**字符串字面量**含 `process.exit(130)` ⇒ **不得**被读成真调用',
      exitCodeProblems(H('0 = 通过    1 = 检出违规',
        "const samples = [\"process.exit(130)\"]\nif (a) { process.exit(1) } else { process.exit(0) }\n")).problems.length === 0, '')
    // ⑹ ★★ 零控：**表达式形态必须被认**（首版只认字面量 ⇒ 7 个闸门假红）
    {
      const r = exitCodeProblems(H('0 = 通过    1 = 检出违规    2 = selftest 失败',
        'if (a) { process.exit(okAll ? 0 : 3) } else { process.exit(1) }\nprocess.exit(2)\n'))
      t('★★零控（W75 · 表达式形态）：`process.exit(okAll ? 0 : 3)` 必须被读成「用了 3」⇒ 报的是**未声明**（而非幽灵）',
        r.ghost.length === 0 && r.undeclared.join('') === '3', `ghost=${r.ghost.join(',')} undeclared=${r.undeclared.join(',')}`)
    }
    // ⑺ ★★ 标准信号码：130/143 **豁免**；但**非标准码不得被一起豁免**（成对，守 P-38）
    t('★★零控（W75 · 信号码豁免）：`process.exit(130)` 未声明 ⇒ **不得报红**（POSIX 128+SIGINT 约定）',
      exitCodeProblems(H('0 = 通过    1 = 检出违规', 'process.on("SIGINT", () => { process.exit(130) })\nprocess.exit(1)\nprocess.exit(0)\n')).problems.length === 0, '')
    t('★★负控（W75 · 豁免不得过宽）：`process.exit(137)`（非标准）未声明 ⇒ **必须报红**（P-38 成对）',
      exitCodeProblems(H('0 = 通过    1 = 检出违规', 'process.on("SIGKILL", () => { process.exit(137) })\nprocess.exit(1)\n')).undeclared.join('') === '137', '')
    // ⑻ ★ 杠杆：把幽灵声明删掉 ⇒ **必须转绿**（证明负控不是恒定红）
    t('★杠杆（W75）：删掉幽灵声明「2 = selftest 失败」⇒ **必须转绿**',
      exitCodeProblems(H('0 = 通过    1 = 检出违规    2 = selftest 失败',
        'if (a) { process.exit(fail === 0 ? 0 : 1) }\n')).problems.length === 1
      && exitCodeProblems(H('0 = 通过    1 = 检出违规',
        'if (a) { process.exit(fail === 0 ? 0 : 1) }\n')).problems.length === 0, '')
    // ★★ 真实仓库：本轮修掉的 3 个闸门必须已一致
    for (const f of ['audit-error-layer-classify.mjs', 'audit-open-items.mjs', 'audit-rule-claims.mjs']) {
      const p = path.join(SCRIPTS, f)
      if (!fs.existsSync(p)) continue
      const r = exitCodeProblems(fs.readFileSync(p, 'utf8'))
      t(`★真实仓库（W75 · ${f}）：头注「退出码」与实现一致（本轮已修）`,
        r.problems.length === 0, `declared=[${r.declared}] used=[${r.used}]`)
    }

    // ---- ★★ W76：**「退出码」的第二种排版形态**（行内）也必须被认（本轮实测的真缺陷整类）----
    //   由头：W75 只认 `## 退出码` **段**，而本仓 **10 个闸门**把声明写在**注释行内**
    //     （`* 退出码：0 = 全部可加载；1 = 有不可加载`）⇒ **整类落在扫描面之外**，
    //     其中 **6 处已过期**（幽灵 2 / 未声明 4）而**一个闸门都没出声**（**P-30**）。
    //   ★ 控必须**成对**（P-67 纪律③）。
    {
      const I = (line, body) => `/**\n * ${line}\n */\nimport fs from 'node:fs'\n${body}`
      // ⑴ ★★ 负控：**行内形态**的幽灵声明 ⇒ 必须报红（**本轮实测的真缺陷形态**）
      {
        const r = exitCodeProblems(I('退出码：0 = 全部可加载；1 = 有不可加载；2 = 环境问题',
          'if (a) { process.exit(bad ? 1 : 0) }\n'))
        t('★★负控（W76 · 行内形态的幽灵）：行内写「2 = 环境问题」而实现只有 0/1 ⇒ **必须报红**',
          r.ghost.join('') === '2' && r.problems.length === 1,
          `declared=[${r.declared}] ghost=[${r.ghost}]`)
      }
      // ⑵ ★★ 负控：**行内形态**的未声明码 ⇒ 必须报红
      {
        const r = exitCodeProblems(I('退出码：0 = 无违约',
          'if (a) { process.exit(1) } else { process.exit(2) }\n'))
        t('★★负控（W76 · 行内形态漏声明）：行内只写 0 而实现返回 1/2 ⇒ **必须报红**',
          r.undeclared.join(',') === '1,2', `undeclared=[${r.undeclared}]`)
      }
      // ⑶ ★ 正控：行内形态与实现一致 ⇒ 不得报红
      t('★正控（W76 · 行内形态一致）：行内写 0/1 且实现恰好 0/1 ⇒ **不得报红**',
        exitCodeProblems(I('退出码：0 = 无违约；1 = 有违约',
          'if (a) { process.exit(bad ? 1 : 0) }\n')).problems.length === 0, '')
      // ⑷ ★★ 零控：**跨文档引用编号不得被读成码**（**W76 探针首版实测的假阳性**）
      t('★★零控（W76 · 引用编号）：行内 `（正常，T-46 待拍板）` 里的 `46` ⇒ **不得**被读成声明的码',
        exitCodeProblems(I('退出码：0 = 无缺口；1 = 有缺口（正常，T-46 待拍板）；2 = 解析失败',
          'if (a) { process.exit(1) } else { process.exit(2) }\n')).problems.length === 0, '')
      // ⑸ ★★ 零控：**行内声明的续行**（`0 = …` 换行 `1 = …`）必须被一起读到（P-41 推论四）
      {
        const r = exitCodeProblems('/**\n * 退出码：0 = 全部自洽\n *   1 = 检出违规\n */\nimport fs\n'
          + 'if (a) { process.exit(bad ? 1 : 0) }\n')
        t('★★零控（W76 · 行内续行）：声明折成两行时，续行的 `1` 必须被读到（不得报「1 未声明」）',
          r.problems.length === 0 && r.declared.join(',') === '0,1', `declared=[${r.declared}]`)
      }
      // ⑹ ★★ 零控：`退出码：0 无未裁决重复；1 有…`（**冒号后首个码**）必须被读到（**口径 ⑷**）
      {
        const r = exitCodeProblems(I('退出码：0 无未裁决重复；1 有未裁决重复；3 自证失败',
          'if (a) { process.exit(bad ? 1 : 0) }\nprocess.exit(x ? 0 : 3)\n'))
        t('★★零控（W76 · 冒号后首个码）：`退出码：0 无…` 的 `0` 必须被读到（首版漏 `：` ⇒ 3 处假红）',
          r.problems.length === 0 && r.declared.join(',') === '0,1,3', `declared=[${r.declared}]`)
      }
      // ⑺ ★★ 负控 + 正控（成对）：`.py` 的实现面走 `sys.exit` / `return N`（**口径 ⑸**）
      {
        const pyBody = 'def main():\n    if x:\n        return 1\n    if y:\n        return 2\n    return 0\n'
        const pyHead = '/**\n * 退出码：0 = 等价；1 = 不等价；2 = 文件缺失\n */\n' + pyBody
        t('★★负控（W76 · .py 实现面）：`.py` 用 `return 1` / `return 2` 而声明了 1/2 ⇒ **不得**报幽灵（口径 ⑸）',
          exitCodeProblems(pyHead, '.py').problems.length === 0
          && exitCodeProblems(pyHead, '.py').ghost.length === 0,
          `ghost=[${exitCodeProblems(pyHead, '.py').ghost}]`)
        t('★★负控（W76 · .py 漏声明）：`.py` 有 `sys.exit(3)` 而头注未写 3 ⇒ **必须报红**',
          exitCodeProblems('/**\n * 退出码：0 = 等价；1 = 不等价\n */\nimport sys\nsys.exit(3)\n', '.py')
            .undeclared.join('') === '3', '')
      }
      // ⑻ ★★ 零控：**同一文件用错语言口径** ⇒ 会报假红（证明口径 ⑸ 不是无用的分支）
      t('★★零控（W76 · 口径分派必要性）：同一份 `.py` 源码按 `.mjs` 口径读 ⇒ **读出 0 个实现码**（全是幽灵）',
        exitCodeProblems('/**\n * 退出码：0 = 等价；1 = 不等价\n */\nimport sys\nsys.exit(1)\n', '.mjs')
          .ghost.join(',') === '1', '')
      // ⑼ ★★ 负控（成对）：**内层括号不得截断实参**（口径 ⑹）
      t('★★负控（W76 · 括号配平）：`sys.exit(0 if selftest() else 3)` 的 `3` 必须被读到',
        exitCodeProblems('/**\n * 退出码：0 = 通过；3 = selftest 失败\n */\nimport sys\nsys.exit(0 if selftest() else 3)\n', '.py')
          .problems.length === 0, '')
      // ★★ 真实仓库：本轮修掉的 6 个闸门必须已一致
      for (const f of ['audit-cdp-eval-negctl.mjs', 'audit-iframe-sandbox.mjs', 'audit-impl-duplication.mjs',
        'audit-method-binding.mjs', 'audit-publish-hygiene.mjs', 'audit-route-contract.mjs']) {
        const p = path.join(SCRIPTS, f)
        if (!fs.existsSync(p)) continue
        const r = exitCodeProblems(fs.readFileSync(p, 'utf8'), path.extname(f))
        t(`★真实仓库（W76 · ${f}）：头注「退出码」（行内或段）与实现一致（本轮已修）`,
          r.problems.length === 0, `declared=[${r.declared}] used=[${r.used}]`)
      }
      // ★★ 真实仓库：受检面里**声明过退出码**的闸门全都一致（整类收口，不只修过的那几个）
      {
        let checked = 0
        const bad = []
        for (const f of discoverBuildGates(fs.readFileSync(BUILD, 'utf8'), (n) => fs.existsSync(path.join(SCRIPTS, n)))) {
          const p = path.join(SCRIPTS, f)
          if (!fs.existsSync(p)) continue
          const r = exitCodeProblems(fs.readFileSync(p, 'utf8'), path.extname(f))
          if (r.declared.length === 0) continue
          checked += 1
          if (r.problems.length) bad.push(`${f}(${r.problems.length})`)
        }
        t('★★真实仓库（W76 · 整类收口）：受检面里**所有声明过退出码的闸门**（含行内写法）均一致',
          bad.length === 0 && checked >= 20, `checked=${checked} bad=${bad.join(',')}`)
      }
    }

    // ---- ★★ W77：**头注「用法」行声明的 flag 必须被实现真的读**（本轮实测的整类无守）----
    //   由头：W74 机器化了「**负控**传过这个输入面吗」，★ 但**没人问相反的那一侧** ——
    //     「头注用法行写着的 flag，**实现里读不读它**」。
    //   ★★ 决定性实验（W77）：故意在用法行写 `--ghost-flag <x>`（实现从不读）⇒
    //     **六个闸门全部 exit=0**（见 §11.1 W77 / 方法论 §6.78）。
    //   ★ 实测真缺陷 **4 处**（都是「实现支持但用法行没写」）。
    {
      const S = (name, src) => usageFaceProblems([{ name, src }])
      const U = (declLine, body) => `/**\n * 用法：\n *   node scripts/x.mjs ${declLine}\n */\nimport fs from 'node:fs'\n${body}`
      // ⑴ ★★ 负控：**用法行声明的 flag 实现从不读** ⇒ 必须报红（**本轮实测的整类无守**）
      {
        const r = S('audit-x.mjs', U('--ghost-flag <x>', 'const a = 1\n'))
        t('★★负控（W77 · 用法行声明了但实现不读）：`--ghost-flag` 实现里从不读 ⇒ **必须报红**',
          r.problems.length === 1 && /ghost-flag/.test(r.problems[0]) && /从不读/.test(r.problems[0]),
          `problems=${r.problems.length}`)
      }
      // ⑵ ★★ 负控：**实现读了但用法行没写** ⇒ 必须报红（本轮 4 处真缺陷的形态）
      {
        const r = S('audit-x.mjs', U('--selftest', "const a = process.argv.indexOf('--file')\n"))
        t('★★负控（W77 · 实现读了但用法行没写）：`--file` 不可发现 ⇒ **必须报红**',
          r.problems.length === 1 && /不可发现/.test(r.problems[0]), `problems=${r.problems.length}`)
      }
      // ⑶ ★ 正控：两侧一致 ⇒ 不得报红
      t('★正控（W77 · 一致）：用法行写 `--file` 且实现读 `--file` ⇒ **不得报红**',
        S('audit-x.mjs', U('--file <path>', "const a = process.argv.indexOf('--file')\n")).problems.length === 0, '')
      // ⑷ ★★ 零控：**四种读取形态都必须被认**（首版只认 process.argv.indexOf ⇒ 假红，P-45）
      for (const [label, body] of [
        ['process.argv.indexOf', "const a = process.argv.indexOf('--file')\n"],
        ['argv.includes', "const argv = process.argv.slice(2)\nconst a = argv.includes('--file')\n"],
        ['argv[i] === 形态', "const argv = process.argv.slice(2)\nfor (let i=0;i<argv.length;i++) if (argv[i] === '--file') break\n"],
        ['flag() 取值器', "const flag = (n,d) => d\nconst a = flag('--file', '')\n"]
      ]) {
        t(`★★零控（W77 · 读取形态「${label}」）：该形态必须被认 ⇒ 不得报「实现从不读」`,
          S('audit-x.mjs', U('--file <path>', body)).problems.length === 0, '')
      }
      // ⑸ ★★ 零控：**运行模式 flag 豁免**（`--selftest` / `--verbose` 不是输入面）
      {
        const Q = String.fromCharCode(39)
        t('★★零控（W77 · 运行模式豁免）：用法行写 `--selftest` 而实现只 includes 它 ⇒ 不得报红',
          S('audit-x.mjs', U('--selftest',
            'if (process.argv.includes(' + Q + '--selftest' + Q + ')) {}\n')).problems.length === 0, '')
      }
      // ⑹ ★★ 零控 + 杠杆：**剥模板串**（口径 ⑴⑵⑶）—— 这是本轮三版口径的核心
      {
        const Q = String.fromCharCode(39)
        // 样本里的 `flag('--sid')` 在**模板串内**（讲的就是「修前形态」本身）⇒ 不得被读成真调用
        const withTpl = U('--selftest',
          'const sample = `const SID = flag(' + Q + '--sid' + Q + ')\\nconst x = 1`\n')
        t('★★零控（W77 · 模板串样本）：`flag(\'--sid\')` 出现在**模板串内**（样本）⇒ 不得被读成真读',
          S('audit-x.mjs', withTpl).problems.length === 0, '')
        t('★杠杆（W77 · 模板串）：把同一句**移出模板串**（真调用）⇒ **用法行没写 `--sid` ⇒ 必须报红**（证明剥串不是把判据改废）',
          S('audit-x.mjs', U('--selftest',
            'const sample = ``\nconst SID = flag(' + Q + '--sid' + Q + ', ' + Q + Q + ')\n')).problems.length === 1, '')
      }
      // ⑺ ★★ 零控：**正则字面量里的反引号**不得被当成模板串定界符（**W77 第三版口径**）
      {
        const Q = String.fromCharCode(39)
        const body = 'const RE = /`([^`]*)`/g\nconst a = process.argv.indexOf(' + Q + '--file' + Q + ')\n'
        t('★★零控（W77 · 正则字面量内的反引号）：`/`([^`]*)`/g` 里的反引号不得当模板串定界符（否则吃掉后续真代码）',
          S('audit-x.mjs', U('--file <path>', body)).problems.length === 0, '')
      }
      // ⑻ ★★ **诚实边界控**：跨行模板串的**续行**本口径**看不到** ⇒ 如实报红（**不是缺陷，是已知边界**）
      {
        const Q = String.fromCharCode(39)
        const body = 'const sample = `line1\nconst SID = flag(' + Q + '--sid' + Q + ')\nline3`\n'
        const r = S('audit-x.mjs', U('--selftest', body))
        t('★★边界控（W77 · 跨行模板串的续行）：本口径**看不到**它 ⇒ 如实报「读了 --sid」（★ 这条**钉住的是边界本身**）',
          r.problems.length === 1, `problems=${r.problems.length}`)
      }
      // ⑻b ★★ 零控：**同一句写在含反引号的行上** ⇒ 必须被跳过（v8 口径本体）
      {
        const Q = String.fromCharCode(39)
        const body = 'const sample = `x`; const SID = flag(' + Q + '--sid' + Q + ')\n'
        t('★★零控（W77 · 含反引号的行被跳过）：同一行既有模板串又有读取 ⇒ 该行整体不参与扫描',
          S('audit-x.mjs', U('--selftest', body)).problems.length === 0, '')
      }
      // ⑼ ★★ 零控：**用法上下文**才认（`node scripts/…` 行）—— 正文里提到 flag 不算声明（P-38）
      t('★★零控（W77 · 用法上下文收窄）：正文（非 `node scripts/…` 行）提到 `--ghost` ⇒ 不得被当声明',
        S('audit-x.mjs', '/**\n * 说明：我们讨论过 --ghost 这个 flag\n */\nimport fs\n').problems.length === 0, '')
       // ⑽ ★★ 零控：**含反引号的行不参与实现面扫描**（v8 口径本体）
       {
         const Q = String.fromCharCode(39)
         const body = 'const t = `x`\n// 该行含反引号 ⇒ 即便写了读取形态也不认（口径本体）\nconst y = 1\n'
         t('★★零控（W77 · 含反引号的行被跳过）：`const t = `x`` 这类行不参与实现面 ⇒ 不得因此报「读了没写」',
           S('audit-x.mjs', U('--selftest', body)).problems.length === 0, '')
       }
       // ⑾ ★★ 零控：**flag 形状约束**（只认 `--[a-z][a-z0-9-]*`）—— 拼接产生的假名不得被当 flag
      {
        const Q = String.fromCharCode(39)
        const body = 'const a = process.argv.indexOf(' + Q + ' + ' + Q + ')\n'
        t('★★零控（W77 · 假 flag 名）：拼接片段（` + Q + `）不符合 flag 形状 ⇒ 不得被当成真 flag',
          S('audit-x.mjs', U('--selftest', body)).problems.length === 0, '')
      }
       // ⑿ ★★ 豁免表的三条机器守（P-64：豁免依据必须点名到能跑到的通路上）
       t('★★真实仓库（W77 · 豁免非腐烂）：豁免表里每个 {file,flag} 都必须**真实存在**（该 flag 确实在文件里被读到）',
         READ_FLAG_EXEMPTIONS.every(e => {
           const p = path.join(SCRIPTS, e.file)
           if (!fs.existsSync(p)) return false
           const code = stripTemplateSpans(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => !/^\s*(?:\*|\/\/|#)/.test(l)).join('\n'))
           const read = readFlagForms(code)
           return e.flags.every(f => read.has(f))
         }), READ_FLAG_EXEMPTIONS.map(e => `${e.file}:${e.flags.join(',')}`).join(' '))
       t('★★纪律（W77 · 豁免不得掩盖 missing 面）：把 `--ghost` 声明在某**被豁免文件**的用法行上 ⇒ 必须**仍报红**',
        (() => {
          const ex = READ_FLAG_EXEMPTIONS[0]
          const r = S(ex.file, U('--selftest --ghost-flag <x>', 'const a = 1\n'))
          return r.problems.length === 1 && /ghost-flag/.test(r.problems[0])
        })(), '')
       t('★★纪律（W77 · 豁免必须带理由）：每条豁免的 `why` 非空',
         READ_FLAG_EXEMPTIONS.every(e => typeof e.why === 'string' && e.why.trim().length > 10), '')
       // ★★ 真实仓库：受检面里**所有声明了用法 flag 的闸门**两侧一致（整类收口）
       {
         let checked = 0
         const bad = []
         for (const f of discoverBuildGates(fs.readFileSync(BUILD, 'utf8'), (n) => fs.existsSync(path.join(SCRIPTS, n)))) {
           const p = path.join(SCRIPTS, f)
           if (!fs.existsSync(p)) continue
           const r = usageFaceProblems([{ name: f, src: fs.readFileSync(p, 'utf8') }])
           if (r.checked === 0) continue
           checked += 1
           if (r.problems.length) bad.push(`${f}(${r.problems.length})`)
         }
         t('★★真实仓库（W77 · 整类收口）：受检面里**所有用法行声明了 flag 的闸门**两侧一致（本轮 4 处已修）',
          bad.length === 0 && checked >= 15, `checked=${checked} bad=${bad.join(',')}`)
      }
    }

    // ---- ★★ W78：**读数登记的 Pattern 必须真的能匹配到值**（本轮实测的整类无守）----
    //   由头：W62 机器化了「登记 ≠ 接线」，★ 但**不问「接了线之后取不取得**值」。
    //   ★★ 决定性实验（W78）：把某条 Pattern 改成永不匹配 ⇒ **五个闸门全部 exit=0**。
    {
      // ★ 用**注入的 runGate**做控（不实跑子进程 ⇒ 快且确定）
      const BS = (pat) => `$readingGates = @{\n    'audit-x.mjs' = @{ Exe = 'node'; Pattern = '${pat}'; Label = 'x' }\n}\n`
      const R = (pat, out, exists = () => true) => readingValueProblems(BS(pat), () => ({ ok: true, out }), exists)
      // ⑴ ★★ 负控：Pattern 匹配 0 行 ⇒ 必须报红（**本轮实测的整类无守**）
      {
        const r = R('绝不存在的读数行XYZ', '  正常输出一行\n  另一行\n')
        t('★★负控（W78 · Pattern 匹配 0 行）：登记了却取不到值 ⇒ **必须报红**',
          r.problems.length === 1 && /匹配 0 行/.test(r.problems[0]), `problems=${r.problems.length}`)
      }
      // ⑵ ★ 正控：Pattern 能匹配 ⇒ 不得报红
      t('★正控（W78 · Pattern 能匹配）：输出里有该读数行 ⇒ **不得报红**',
        R('读数行', '  读数行：ABC\n').problems.length === 0, '')
      // ⑶ ★★ 零控：**闸门在构建期跑不起来** ⇒ 只出声不报红（P-43）
      {
        const r = readingValueProblems(BS('x'), () => ({ ok: false, out: '', err: 'ETIMEDOUT' }), () => true)
        t('★★零控（W78 · 跑不起来）：闸门在构建期跑不起来 ⇒ **只出声不报红**（P-43 无判据力）',
          r.problems.length === 0 && r.notes.length === 1 && r.checked === 0, `notes=${r.notes.length}`)
      }
      // ⑷ ★★ 零控：**脚本不存在** ⇒ 只出声不报红（P-43；该条由 W62 判据② 承接）
      {
        const r = readingValueProblems(BS('x'), () => ({ ok: true, out: 'x\n' }), () => false)
        t('★★零控（W78 · 脚本不存在）：只出声不报红（那条由 W62 判据② 承接）',
          r.problems.length === 0 && r.notes.length === 1, `notes=${r.notes.length}`)
      }
      // ⑸ ★★ 零控：**自调用链**必须被排除（否则自己调自己 ⇒ 递归超时）
      {
        const bs = `$readingGates = @{\n    'audit-selftest-claims.mjs' = @{ Exe = 'node'; Pattern = 'x'; Label = 'x' }\n}\n`
        const r = readingValueProblems(bs, () => ({ ok: true, out: 'x\n' }), () => true)
        t('★★零控（W78 · 自调用链）：`audit-selftest-claims.mjs` 自己那条 ⇒ **只出声不实跑**（P-50 推论一）',
          r.problems.length === 0 && r.notes.length === 1 && r.checked === 0, `checked=${r.checked}`)
      }
      // ⑹ ★ 零控：非法正则 ⇒ 报红且理由点名「不是合法正则」（与「匹配 0 行」区分开，守 P-46）
      {
        const r = R('[unclosed', 'x\n')
        t('★零控（W78 · 非法正则）：Pattern 不是合法正则 ⇒ 报红且理由**点名是正则问题**（P-46）',
          r.problems.length === 1 && /不是合法正则/.test(r.problems[0]), `problems=${r.problems.length}`)
      }
      // ⑺ ★★ 真实仓库：11 条登记**全部能取到值**（本轮收口）
      {
        const r = readingValueProblems(fs.readFileSync(BUILD, 'utf8'), (exe, gate) => {
          try {
            const out = execFileSync(exe === 'python' ? 'python' : process.execPath, [path.join(SCRIPTS, gate)],
              { cwd: WS, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
            return { ok: true, out }
          } catch (e) {
            const out = String(e.stdout ?? '') + String(e.stderr ?? '')
            return out.trim() ? { ok: true, out } : { ok: false, out: '', err: String(e.message ?? '') }
          }
        }, (f) => fs.existsSync(path.join(SCRIPTS, f)))
        t('★★真实仓库（W78）：登记表里**可实跑**的每条 Pattern 都能匹配到值（读数不会静默失效）',
          r.problems.length === 0 && r.checked >= 8, `checked=${r.checked} bad=${r.problems.length}`)
      }
    }
  }

  const okAll = fail === 0
  reportSelftest('selftest-claims', total - fail, total)
  process.exit(okAll ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }
  if (!fs.existsSync(BUILD)) { console.error(`✗ 找不到 ${BUILD}`); process.exit(2) }
  const verbose = process.argv.includes('--verbose')

  // ① 受检闸门名单 = **实读构建脚本**（P-27；不扫目录，避免把设备探针算进来）
  const scripts = discoverBuildGates(fs.readFileSync(BUILD, 'utf8'), (n) => fs.existsSync(path.join(SCRIPTS, n)))
  const actual = new Map()
  const uncontract = []
  for (const f of scripts) {
    const r = probeSelftest(path.join(SCRIPTS, f))
    if (!r.ok) { uncontract.push(f); continue }
    // ② 脚本内自洽：pass===total ⟺ PASS
    const consistent = (r.pass === r.total) === (r.verdict === 'PASS')
    if (!consistent) {
      console.error(`✗ ${f}：统一分数行**自相矛盾**（${r.got} 但 ${r.verdict}）⇒ 契约被误用`)
      process.exit(1)
    }
    actual.set(f, r.got)
  }

  // ③ 抽声明并比对（**只取「当前状态区段」** —— 见 `isCurrentStateSection` 头注）
  //   ★ `--file <path>`（W44 加）：供**真实仓库负控**在注入副本上复核（否则负控无从演练）
  const fi = process.argv.indexOf('--file')
  const goalPath = fi >= 0 && process.argv[fi + 1] ? process.argv[fi + 1] : GOAL
  if (!fs.existsSync(goalPath)) { console.error(`✗ 找不到 ${goalPath}`); process.exit(2) }
  const goalText = fs.readFileSync(goalPath, 'utf8')
  const methodText = fs.existsSync(METHOD) ? fs.readFileSync(METHOD, 'utf8') : ''
  // ★★ `resolveBare`（**W61 加**）：把「裸名」解析成受检面内的真脚本名；
  //   解析不出来（多数裸名不是脚本）⇒ 返回 null，该片段**不当声明**（守 P-38 防过宽）。
  //   ★ 判据落在**文件系统事实**上（脚本是否在 `scripts/` 且**名实相符**），
  //     而不是靠写法猜（**P-41**：锚到决定结果的事实）。
  //   ★ 只认**精确同名**（不猜前缀/后缀）—— 猜会让 `build-path-parity` 这类简写
  //     匹配到 `audit-build-path-parity.py`，那是**另一个脚本**的名字（会报假红，P-45）。
  const scriptSet = new Set(scripts)
  const resolveBare = (name) => {
    for (const ext of ['.mjs', '.py']) { if (scriptSet.has(name + ext)) return name + ext }
    if (scriptSet.has(name)) return name
    return null
  }
  const claims = [
    ...extractClaims(goalText, {
      allowRegion: (s) => isCurrentStateSection(s, 'goal'),
      resolveBare
    }).map(c => ({ ...c, doc: 'GOAL.md' })),
    // ★ 方法论同理，但**同一谓词**（P-1：口径不在两处各写一遍）
    ...extractClaims(methodText.split(/^###\s*6\.\d/m)[0], {
      allowRegion: (s) => isCurrentStateSection(s, 'method'),
      resolveBare
    }).map(c => ({ ...c, doc: 'MOBILE-TEST-METHODOLOGY.md' })),
    // ★★ **W65 扩第三受守面：`build-dsht.ps1` 的闸门文案**（**本轮实测的真缺陷**）
    //   由头：构建日志里 `[gate] OK audit-baseline-claims.mjs --selftest（**63/63**…）`
    //   而实测已是 **79/79**；同批还有 5 处（`audit-selftest-claims` 23/23 实为 39/39 ·
    //   `-negctl` 25/25 实为 31/31 · `audit-doc-refs` 41/41 实为 49/49 · `-negctl` 18/18 实为 23/23）。
    //   ★ **为什么它藏得住**：那句文案是**构建期唯一被人读到的形态**（日志里的 `[gate] OK` 行），
    //     而本判据此前**只扫两份 md** ⇒ 同一族声明（闸门自证分数）写在第**三**处、且**无守**
    //     （**P-58**：同类声明跨区段单源守 —— 这是它第 N 次现身）。
    //   ★ 口径（守 P-38 防过宽）：**只扫「gate 文案」那类行**（含 `[gate] OK` 的 Write-Host），
    //     不扫 `.ps1` 全文 —— 脚本里有大量注释讲历史值（「W44 时为 16/16」之类），
    //     全文扫描会把**史实**判成声明（假红 ⇒ 训练人忽略报警）。
    //   ★ `allowRegion` 复用同一谓词（P-1）：`.ps1` 无 md 区段语义 ⇒ 传恒真
    //     （**收窄已由「只扫 gate 文案行」完成**，见上）。
    ...extractClaims(
      fs.readFileSync(BUILD, 'utf8')
        .split('\n')
        .filter(l => /\[gate\]\s*OK/.test(l))
        .join('\n'),
      { resolveBare }
    ).map(c => ({ ...c, doc: 'build-dsht.ps1（gate 文案）' }))
  ]
  const existsFn = (f) => fs.existsSync(path.join(SCRIPTS, f))
  const { problems, notes, checked } = checkClaims(claims, actual, existsFn, new Set(scripts))

  // ★★ ④ W62：**读数登记表与接线的一致性**（守「登记 ≠ 接线」= P-59 家族）
  //   由头：`build-dsht.ps1` 的读数回显机制曾有**三套平行实现**，覆盖面只及自身所在的那一段
  //   ⇒ 21 个闸门有读数行而日志里只有 3 条；其中 `TARGETS 9 项` / `17 marker` / `实读 7 条`
  //     等**写死在 §3.1/§3.2 的数字**在日志里没有任何观测面（与 W57「路由 67 条」同形）。
  const rw = readingWiringProblems(fs.readFileSync(BUILD, 'utf8'), existsFn)
  for (const p of rw.problems) problems.push(p)

  // ★★ ⑤ W71：**闸门头注声明的「判据条数」必须与实现一致**（守 P-59 的补集）
  //   由头：头注正文逐条写了判据（扩判据时会顺手加），而**标题的汇总数字没人改**
  //   ⇒ `audit-doc-refs`（五→七）与 `audit-goal-sections`（五→八）双双过期，
  //     而**七个闸门全 exit=0**（决定性实验）。
  //   ★ 受检面 = **接入契约的闸门**（`actual` 的键）—— 与「自证分数」同一受检面（P-1）。
  let headChecked = 0
  const headProbs = []
  for (const f of actual.keys()) {
    const p = path.join(SCRIPTS, f)
    if (!fs.existsSync(p)) continue
    const r = headNoteCountProblems(fs.readFileSync(p, 'utf8'))
    if (r.declared === null) continue
    headChecked += 1
    for (const x of r.problems) headProbs.push(`${f}：${x}`)
  }
  for (const p of headProbs) problems.push(p)

  // ★★ ⑥ W73：**头注的「无汇总数逐条清单」必须与实现里的分组一致**（守 W71 的补集）
  //   由头：W71 只认 `## 判据（**N 条**）` 这一种写法，而本仓还有**第二种等效写法** ——
  //     只有逐条清单（` *   A. … / B. …`）、**完全没有汇总数**。
  //     ★★ 后者**更危险**：连「该改哪个数字」都不存在 ⇒ 扩一组时清单**永远不会被想起**。
  //   实测（W73 全仓穷举）：**5 处漏记**，而**五个闸门全 exit=0**（P-30）——
  //     `audit-baseline-claims-negctl`（A~B vs A~M）· `-rule-claims-negctl`（A~C vs A~G）·
  //     `-selftest-claims-negctl`（A~C vs A~G）· `-doc-refs-negctl`（A~F vs A~I）·
  //     `-goal-sections-negctl`（A~C vs A~F）。
  //   ★ 受检面 = **接入契约的闸门 + 全部 `*-negctl.*`**（与 selftest 的 W80 控**同一口径**，守 P-1）。
  //     ★★ **W80 修**：此前只扫 `actual.keys()`（**接入契约的闸门**），而本仓 **14 个 `-negctl`**
  //     里绝大多数**不接入契约**（负控的收尾是「有杠杆/无杠杆」结论型）⇒ ★★ **它们整片都在扫描面外**
  //     （**P-45**：判据的扫描面与真目标错位）—— 而 W73 判据**主要就是冲它们来的**。
  //   ★ **两侧任一为空 ⇒ 不判**（P-43：该脚本不用这种写法 ⇒ 本条对它无判据力）。
  let listChecked = 0
  const listProbs = []
  const listTargets = new Set(actual.keys())
  try {
    for (const f of fs.readdirSync(SCRIPTS)) if (/-negctl\.(mjs|py)$/.test(f)) listTargets.add(f)
  } catch { /* 读不到目录 ⇒ 退化为「接入契约的闸门」（不静默失败：下面的读数行会显示实际受检数） */ }
  for (const f of [...listTargets].sort()) {
    const p = path.join(SCRIPTS, f)
    if (!fs.existsSync(p)) continue
    const r = headNoteListProblems(fs.readFileSync(p, 'utf8'))
    if (r.headKeys.size === 0 || r.implKeys.size === 0) continue
    listChecked += 1
    for (const x of r.problems) listProbs.push(`${f}：${x}`)
  }
  for (const p of listProbs) problems.push(p)

  // ★★ ⑦ W74：**闸门支持的「输入面参数」必须被它的负控真的传过**（守 P-59 纪律② 的横向面）
  //   由头：W54 在 `audit-goal-sections.mjs` 上补了 `--method`（理由正是纪律②），但**只在那一处落地**。
  //     ★★ 横向穷举 ⇒ `audit-baseline-claims.mjs` 支持 `--file/--readme/--freeze/--tasklist`
  //     而 `-negctl` **只传了前三个** ⇒ **TASK-LIST 那一半无法被负控**（**P-1**）。
  //   受检面 = 受检闸门（`scripts` 名单），负控由文件系统解析（`<stem>-negctl.mjs`）。
  const ifp = inputFaceProblems(
    scripts.map(f => ({ name: f, src: (() => { const p = path.join(SCRIPTS, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' })() })),
    (f) => { const p = path.join(SCRIPTS, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
  )
  for (const p of ifp.problems) problems.push(p)

  // ★★ ⑧ W75：**头注声明的「退出码」必须与实现一致**（守 P-59 家族的第四种形态）
  //   由头：本闸门已守「声明的自证分数」「声明的判据条数」「头注的逐条清单」三类；本轮穷举第四类 ——
  //     **`## 退出码` 段**（给读者与 CI 用的接口契约）。
  //   ★★ 实测 3 处真缺陷：`audit-error-layer-classify.mjs` / `audit-open-items.mjs` 头注声明
  //     「2 = selftest 失败」而实现是 `fail === 0 ? 0 : 1` ⇒ **「闸门自己坏了」与「闸门检出违规」
  //     返回同一个码**（头注承诺的区分根本不存在）；`audit-rule-claims.mjs` 声明 2 而实现是 3。
  //   受检面 = **接入契约的闸门**（与「自证分数」「头注条数」「头注清单」**同一受检面**，守 P-1）。
  //   ★ **无 `## 退出码` 段 ⇒ 不判**（P-43：该脚本不承诺这套接口 ⇒ 本条对它无判据力）。
  let ecChecked = 0
  const ecProbs = []
  for (const f of actual.keys()) {
    const p = path.join(SCRIPTS, f)
    if (!fs.existsSync(p)) continue
    // ★ 口径 ⑸（W76）：把扩展名传进去 —— `.py` 的实现面是 `sys.exit(N)` / `return N`（P-45）
    const r = exitCodeProblems(fs.readFileSync(p, 'utf8'), path.extname(f))
    if (r.declared.length === 0) continue
    ecChecked += 1
    for (const x of r.problems) ecProbs.push(`${f}：${x}`)
  }
  for (const p of ecProbs) problems.push(p)

  // ⑨ ★★ **头注「用法」行声明的 flag 必须被实现真的读**（**W77 新增** —— P-59 家族第六处字段）
  //   由头：W74 机器化了「负控传过这个输入面吗」，★ 但**没人问相反的那一侧** ——
  //     「头注用法行写着的 flag，**实现里读不读它**」。
  //   ★★ 决定性实验（W77）：故意在用法行写 `--ghost-flag <x>`（实现从不读）⇒
  //     **六个闸门全部 exit=0** ⇒ 该面**整类无守**（读者照抄必扑空而报告全绿，**P-30**）。
  //   受检面 = **接入契约的闸门**（与前几面同一受检面，**P-1**）。
  const uf = usageFaceProblems([...actual.keys()].map(f => ({ name: f, src: fs.readFileSync(path.join(SCRIPTS, f), 'utf8') })))
  for (const p of uf.problems) problems.push(p)

  // ⑩ ★★ **读数登记的 `Pattern` 必须真的匹配到值**（**W78 新增** —— W62 判据的补集）
  //   由头：W62 机器化了「**登记 ≠ 接线**」，★ 但**不问「接了线之后取不取得**值」。
  //   ★★ 决定性实验（W78）：把某条 Pattern 改成永不匹配 ⇒ **五个闸门全部 exit=0**（该面整类无守）；
  //     而 `Show-Reading` 的兜底**只打黄字警告、不 fail**（`build-dsht.ps1:228`）⇒ 失效与正常几乎同貌（**P-30**）。
  const runGate = (exe, gate) => {
    const bin = exe === 'python' ? (process.env.PY_BIN ?? 'python') : process.execPath
    try {
      const out = execFileSync(bin, [path.join(SCRIPTS, gate)], { cwd: WS, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
      return { ok: true, out }
    } catch (e) {
      // ★ 非 0 退出**不代表跑不起来**（闸门检出违规也是非 0）⇒ 仍用它的 stdout/stderr 判读数
      const out = String(e.stdout ?? '') + String(e.stderr ?? '')
      const alive = out.trim().length > 0
      return alive ? { ok: true, out } : { ok: false, out: '', err: String(e.message ?? '') }
    }
  }
  const rv = readingValueProblems(fs.readFileSync(BUILD, 'utf8'), runGate, (f) => fs.existsSync(path.join(SCRIPTS, f)))
  for (const p of rv.problems) problems.push(p)

  console.log(`[自证分数] 受检闸门 ${scripts.length} 个（接入契约 ${actual.size} / 未接入 ${uncontract.length}）· 文档声明 ${claims.length} 条（涉 ${checked.length} 个脚本）`)
  console.log(`[读数接线] 登记表 ${rw.registered} 条 · 已接线 ${rw.wired.length} 条 · 违规 ${rw.problems.length} 处`)
  console.log(`[头注条数] 声明了判据条数的闸门 ${headChecked} 个 · 违规 ${headProbs.length} 处`)
  console.log(`[头注清单] 带「无汇总数逐条清单」的闸门 ${listChecked} 个 · 违规 ${listProbs.length} 处`)
  console.log(`[退出码] 声明了「## 退出码」段的闸门 ${ecChecked} 个 · 违规 ${ecProbs.length} 处`)
  console.log(`[用法面] 头注用法行声明了 flag 的闸门 ${uf.checked} 个（共 ${uf.declaredTotal} 个 flag）· 违规 ${uf.problems.length} 处`)
  console.log(`[读数取值] 实跑核验了 ${rv.checked} 条登记的 Pattern · 违规 ${rv.problems.length} 处`)
  for (const n of rv.notes) console.log(`  ⓘ ${n}`)
  console.log(`[输入面] 有同名负控的闸门 ${ifp.checked} 个 · 违规 ${ifp.problems.length} 处`)
  for (const n of ifp.notes) console.log(`  ⓘ ${n}`)
  if (uncontract.length) console.log(`  ⓘ 未接入单源输出契约（不影响结论，但**其声明无法被证伪**）：${uncontract.join(' ')}`)
  for (const n of notes) console.log(`  ⓘ ${n}`)
  if (verbose) for (const [f, v] of actual) console.log(`    ${f.padEnd(40)} ${v}`)

  if (problems.length === 0) {
    console.log('[自证分数] OK —— 文档声明的分数与脚本实测**逐条一致**，且分数行可被机器读出；读数登记表与接线一致')
    process.exit(0)
  }
  for (const p of problems) console.log(`[自证分数] ✗ ${p}`)
  console.log(`\n[自证分数] 共 ${problems.length} 处不一致（这类错误人眼极难发现：数字散落在多份文档）`)
  process.exit(1)
}
