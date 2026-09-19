#!/usr/bin/env node
/**
 * audit-baseline-claims.mjs —— **GOAL §3.1「基线数字」与可核对真值的一致性闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * `GOAL.md` §3.1 是**每轮必改**的基线表（vitest 通过数 / 门禁条数 / sentinel / M4 / P 判据条数 …）。
 * 这些数字必须与**可机器核对的事实**一致 —— 否则读者（含未来的 AI）会**照着一个错数字**去判断
 * 「有没有回归」，而基线表恰恰是「什么算坏」的定义（**P-1 / P-27**）。
 *
 * ## 为什么必须常驻（**P-11 元级** · W45 由 W43/W44 的分诊带出）
 * W43 按 **P-38 三段式**分诊「每轮必改的文档区」时，列出 4 处「无机器守着」，其中两处是：
 *   ① **GOAL §三 基线数字**（本轮 W45 收口）
 *   ② GOAL §3.2 门禁清单的 selftest 分数（**W44 已收口** —— `audit-selftest-claims.mjs`）
 *   ③ GOAL §九 P 判据索引一致性（**W43 已收口** —— `audit-goal-sections.mjs` 判据 ⑦）
 * 本次实测的**同类真缺陷**（W44 抓到）：新增 P-49 后 §3.1 仍写「P-1 ~ P-48」；
 * W42 扩判据后 §3.2 仍写 16/16 —— **数字散落在多份文档，人眼几乎不可能发现**。
 *
 * ## 判据（**只核「可机器取真值」的量** —— 守 P-38 防过宽）
 *   ① **门禁条数**：§3.1 声明的 `N 条 [gate] OK` 必须等于**上次构建日志**里的实际条数
 *      （★ 真值来源 = 构建日志，**不是**再跑一遍构建 —— 那太重且不是本闸门的职责）；
 *   ② **sentinel 版本**：§3.1 声明的 `vN` 必须等于**两条构建日志里实测的 sentinel**；
 *   ③ **P 判据累计条数**：§3.1 声明的「累计 N 条」必须等于 §九 索引的实际行数
 *      （★ 与 `audit-goal-sections.mjs` 判据 ⑦b **同口径** —— P-1：同一语义一处读法）；
 *   ④ **M4 项数**：§3.1 声明的「双包各 N 项 / 缺失 M」必须与**构建日志里 Step 6.6 的实测**一致。
 *      ★★ **W63 修（本条此前是「声明有判据、通路不存在」）**：`compareClaims` 里一直有这条实现，
 *        但**主流程硬编码传 `m4: null`** ⇒ **该判据从不生效**（**P-59 的第二种形态**：
 *        ⑦c 是「实现里一条都没有」，本处是「**实现有、但从不被喂输入**」，两者在报告上同貌）。
 *      ★ **决定性实验**（`tmp/w63-decisive.mjs`）：正控（门禁条数 48→45）**报红**；
 *        实验组（§3.1 的 M4 `169 → 142`）**exit=0 不报红**。
 *      ★ 真值来源与 ①② **同源同法**（P-1）：Step 6.6 的读数行 `=> 核验 N 项，缺失 M 项`
 *        本来就在构建日志里（W62 起 `verify-apk-payload.py` 不在 `| Out-Null` 面上）。
 *
 * ## ★ 诚实边界（R7）—— **哪些不核，以及为什么**
 *   · **vitest / typecheck / M7** 的读数**不在此核**：它们要么依赖设备（M7 需 adb+WebView），
 *     要么**耗时数分钟**（vitest 全量）—— 放进构建期门禁会把「设备没插」或「构建太慢」
 *     变成**门禁失败**（P-40③：判据必须跑在它所判对象状态已确定之后；P-45：扫描面与真目标对齐）。
 *     ⇒ 本闸门对这三项**完全不看**（连「形态断言」也没有 —— 见下）。
 *   · ★★ **W63 修一处「空声明」**：本行原写「对这三项**只做「形态断言」**（数字存在且量级合理）」
 *     —— 而**实现里没有任何一行**在做该断言（`grep 形态断言` = 0 命中）⇒ 又一处
 *     **声明与实现不符**（**P-59 纪律①**：头注里的每一条判据必须在实现里可被指认）。
 *     ⇒ 按 **P-61**（收窄必须留下「收窄了什么」的记录）**如实改写为「完全不看」** ——
 *     这比补一个「数字存在」的空壳断言诚实：那种断言**在「0 失败」这类事实面前毫无判据力**，
 *     只会制造「纳入了核验」的假象（**P-43：无判据力不判**）。
 *   · 因此本闸门**不替代**建基线时的人工复核（§十二 第 2 条仍要求跑基线回归）。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出不一致    2 = 环境问题（读不到日志 / 文档）    3 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-baseline-claims.mjs --selftest
 *   node scripts/audit-baseline-claims.mjs
 *   node scripts/audit-baseline-claims.mjs --verbose
 *   node scripts/audit-baseline-claims.mjs --file <GOAL 副本> --readme <README 副本> --freeze <FREEZE 副本> --tasklist <TASK-LIST 副本>
 *       # 四个输入面：供**负控**在临时副本上注入坏样本（★ W77 补：此前实现已支持但**用法行没写** ⇒ 能力不可发现）
 *   node scripts/audit-baseline-claims.mjs --strict-two-way
 *       # 双向口径：连「声明 > 实测」也报红（默认**单向** —— 构建期不报「本轮新增闸门」，见头注 P-43/P-40③）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const GOAL = path.join(ROOT, 'docs', 'GOAL.md')
const TMP = path.join(WS, 'tmp')

/**
 * 从 §3.1 文本里抽声明（**纯函数**，便于 selftest 用合成样本）。
 * @returns {{ gates:number|null, sentinel:number|null, pCount:number|null, m4:{items:number,missing:number}|null }}
 */
export function extractBaselineClaims (text) {
  const out = { gates: null, sentinel: null, pCount: null, m4: null }
  // ★ 只在 §3.1 区内抽（避免命中 §3.2 的其它数字）
  const a = text.indexOf('### 3.1')
  const b = text.indexOf('### 3.2')
  const region = a >= 0 ? text.slice(a, b > a ? b : undefined) : text

  const g = /(\d+)\s*条\s*`\[gate\]\s*OK`/.exec(region)
  if (g) out.gates = Number(g[1])
  const s = /（当前\s*\*\*v(\d+)\*\*）/.exec(region)
  if (s) out.sentinel = Number(s[1])
  const p = /累计\s*(\d+)\s*条/.exec(region)
  if (p) out.pCount = Number(p[1])
  const m = /双包各\s*\*\*(\d+)\s*项\s*\/\s*缺失\s*(\d+)\*\*/.exec(region)
  if (m) out.m4 = { items: Number(m[1]), missing: Number(m[2]) }
  return out
}

/**
 * 从构建日志抽真值：门禁条数 + sentinel + **M4 项数**（**W63 新增**）。
 *
 * ## ★★ 为什么必须补 M4（**W63 实测的真缺陷 = P-59 的第二种形态**）
 * 头注的**判据 ④** 白纸黑字写着「§3.1 声明的『双包各 N 项 / 缺失 M』必须与**产物核验脚本的实测**一致」
 * —— 而 `compareClaims` 里**确有**这条实现（传 `m4` 且不一致 ⇒ 报红）。
 * ★ 但**主流程传的是 `{ pCount, m4: null }`**（硬编码 `null`）⇒ **该判据从不生效**。
 * ★★ **决定性实验**（`tmp/w63-decisive.mjs`）：① 正控（门禁条数 48→45）⇒ **exit=1 报红**；
 *   ② 实验组（§3.1 的 M4 `169 → 142`）⇒ **exit=0 不报红** ⇒ **该数字没有任何机器守着**。
 * ⇒ 与 W54 的 `audit-goal-sections` ⑦c **同族**（声明有判据、那条通路不存在），
 *   但**形态相反**：⑦c 是「实现里一条都没有」，本处是「**实现有、但从不被喂输入**」
 *   —— 两者在报告上**完全同貌**（**P-30**）。⇒ **P-59 的第二种形态**。
 *
 * ## 真值来源（与 gates/sentinel **同源同法**，守 P-1）
 * Step 6.6 的 M4 读数行 `=> 核验 N 项，缺失 M 项` **本来就在构建日志里**
 * （W62 起 `verify-apk-payload.py` 的输出直接进日志，因为它**不在 `| Out-Null` 面上**）。
 * ⇒ 与 gates 一样**从日志抽**，而不是跑一遍产物核验（那要 APK，且是本闸门职责之外的重量级操作
 * —— 与头注「不重复跑构建」同一纪律）。
 * ★ **反向也成立**：M4 是**两包各一次**，取**最小值**（任一包少了标记都说明有问题）。
 */
export function readBuildLogTruth (logText) {
  const gates = (logText.match(/\[gate\] OK/g) || []).length
  const s = /RUNTIME_SENTINEL:\s*\.installed-v(\d+)/.exec(logText)
  // ★ W63：M4 读数行（`=> 核验 169 项，缺失 0 项`）
  const m4 = []
  for (const m of logText.matchAll(/核验\s*(\d+)\s*项，缺失\s*(\d+)\s*项/g)) {
    m4.push({ items: Number(m[1]), missing: Number(m[2]) })
  }
  return {
    gates: gates || null,
    sentinel: s ? Number(s[1]) : null,
    // ★ 单份日志里可能有多包（本仓一次构建只出一包 ⇒ 通常 1 条）；取**最小值**（保守）
    m4: m4.length ? { items: Math.min(...m4.map(x => x.items)), missing: Math.max(...m4.map(x => x.missing)) } : null
  }
}

/**
 * ★★ **从构建日志抽「关键读数行」的机器可读值**（**W66 新增**）。
 *
 * ## 为什么必须加（W66 实测的真缺陷）
 * W62 把「关键读数行回显进构建日志」这件事收成了**唯一实现点**（`Show-Reading`），
 * 读数行从 **3 条 → 12 条** —— **接线做完**了。但本轮按 **P-11 元级**继续穷举时问出：
 * 「**接进日志之后，有人拿它与文档里写死的那个数字对账吗？**」⇒ ★★ **一个都没有**。
 * ★ **决定性实验**（`tmp/w66-decisive.mjs` / `w66-load.mjs`，逐个注入文档里的数字并跑 5 个闸门）：
 *   把 §3.1 的 `TARGETS **9 项**` 改成 `99 项`、把 §3.2 A14 行的「实读 **7** 条」改成「实读 3 条」、
 *   把「扫描 **5** 份」改成 2 份、把「受检闸门 **38** 个」改成 12 个 ⇒
 *   ★★ **5 个闸门一个都不报红**（`audit-doc-refs` 那次报红经取证是**负控未传 `--as` 的副作用**，
 *   传身份后 exit=0 —— 见 `tmp/w66-why.mjs`）。
 * ⇒ 这正是 **P-62 的「接线做完了 ≠ 消费做完了」形态**：
 *   读数**进了**日志（有观测面），却**没有任何机器读它** ⇒ 它与文档数字**照样可以静默脱钩**（**P-30**）。
 * ★ 与 W57「路由 67 条」的差别：那里是**读数根本没进日志**（零观测面）；
 *   这里是**读数进了日志、但无人消费** —— 比前者更隐蔽（日志里「看起来有」）。
 *
 * ## 抽什么（**只抽「文档里也写死、且能一一对应」的那几条**，守 P-38 不过宽）
 * 本表**显式登记**「日志读数形态 → 文档数字形态」的配对，**不猜**：
 *   · `[A11] …（受检目标 N 个…`  ↔ §3.1 `TARGETS **N 项**`
 *   · `[A14] …实读 N 条「产物 → entry」` ↔ §3.2 A14 行「实读 **N** 条」
 *   · `[文档引用] 扫描 N 份` ↔ §3.2 文档引用行「扫描 **N** 份」
 *   · `[自证分数] 受检闸门 N 个` ↔ §3.2 第十组行「受检闸门 **N** 个」
 * ★ **为什么必须先有 `Show-Reading`**：没有它，日志里读数行数 = 3（W62 前），
 *   本节大多数配对会取不到值 ⇒ 判据会**静默失效**（**P-30**）——
 *   所以本节与 W62 是**配套**的：**W62 负责把读数摆出来，W66 负责读它**。
 *
 * @returns {Record<string, number|null>} 键 = 配对 id，值 = 日志里的实测读数
 */
export const READING_PAIRS = [
  { id: 'targets', label: 'A11 受检目标数', logRe: /\[A11\][^\n]*?受检目标\s*(\d+)\s*个/g },
  { id: 'a14entries', label: 'A14 实读「产物→entry」条数', logRe: /\[A14\][^\n]*?实读\s*(\d+)\s*条/g },
  { id: 'docrefdocs', label: '文档引用扫描份数', logRe: /\[文档引用\]\s*扫描\s*(\d+)\s*份/g },
  { id: 'selftestgates', label: '自证分数受检闸门数', logRe: /\[自证分数\][^\n]*?受检闸门\s*(\d+)\s*个/g }
]

/**
 * @param {string} logText 构建日志全文（**多份日志会合并** —— 取保守值，见主流程）
 * @returns {Record<string, number|null>} 每项取**最小值**（保守：声明 > 实测只出声，与 gates 同纪律）
 */
export function readReadingValues (logText) {
  const out = {}
  for (const p of READING_PAIRS) {
    const vals = []
    for (const m of String(logText ?? '').matchAll(p.logRe)) vals.push(Number(m[1]))
    out[p.id] = vals.length ? Math.min(...vals) : null
  }
  return out
}

/**
 * ★★ **日志读数 vs 文档写死数字的对账**（**W66 新增** —— 守 P-30 / P-62 推论）。
 *
 * ## 口径（守 P-38 / P-43，三条）
 * ① ★★ **只比对「两侧都取到」的项**：日志里没这条读数（某些架构/参数下本就不产生）⇒
 *    **只出声不报红**（否则是假红）；文档里没写这个数字 ⇒ **不比对**（那是「文档没承诺」，
 *    不是缺陷 —— 与 `E-C` 判据「声明条数**若有**」同口径，**P-1**）。
 * ② ★ **只认「当前状态区」的文档数字**（§十一 之前的行）—— 史实区里当然写的是**当时的**读数
 *    （`TARGETS 9 项` 在 §11.1 W62 行也出现，那是**记账**，不该报红）。
 * ③ ★ **方向与 gates 同纪律（单向）**：构建期「文档 > 实测」**只出声**（本轮新增标记是正常事，
 *    报红即假红，W45 的坑）；而「文档 < 实测」⇒ **报红**（文档过期 = 读者读到错数字，**P-27**）。
 *
 * @param {string} text     文档全文（GOAL.md）
 * @param {Record<string,number|null>} readings  日志读数（`readReadingValues` 的产物）
 * @returns {{problems:string[], notes:string[]}}
 */
export function readingVsDocProblems (text, readings = {}) {
  const problems = []
  const notes = []
  // ★ 只取 §十一 之前的「当前状态区」（守 ②）
  const lines = String(text ?? '').split(/\r?\n/)
  const cut = lines.findIndex(l => /^##\s*十一、/.test(l))
  const cur = (cut < 0 ? lines : lines.slice(0, cut)).join('\n')
  // 配对表：文档侧正则 + 说明
  const DOC_PAIRS = [
    { id: 'targets', label: READING_PAIRS[0].label, docRe: /TARGETS\s*\*\*(\d+)\s*项\*\*/, docHint: '§3.1「TARGETS N 项」' },
    { id: 'a14entries', label: READING_PAIRS[1].label, docRe: /实读\s*\*\*(\d+)\*\*\s*条|实读\s*(\d+)\s*条/, docHint: '§3.2 A14 段「实读 N 条」' },
    { id: 'docrefdocs', label: READING_PAIRS[2].label, docRe: /扫描\s*\*\*(\d+)\*\*\s*份|扫描\s*(\d+)\s*份/, docHint: '§3.2 第十二组「扫描 N 份」' },
    { id: 'selftestgates', label: READING_PAIRS[3].label, docRe: /受检闸门\s*\*\*(\d+)\*\*\s*个|受检闸门\s*(\d+)\s*个/, docHint: '§3.2 第十组「受检闸门 N 个」' }
  ]
  for (const p of DOC_PAIRS) {
    const actual = readings[p.id]
    // ★★ **必须遍历**全文找**合格的**声明，不能只取第一个匹配**（**W66 实测的假红，P-41**）：
    //   实测：`/扫描\s*(\d+)\s*份/` 的**首个**匹配落在 §3.2 的一句**引述修前状态**的叙述里
    //   （「仍报 `扫描 4 份…`」）⇒ 只取首个 ⇒ 拿旧值比对 ⇒ **永远报红**。
    //   ⇒ 逐个匹配分诊，**跳过说明语境**，取第一个合格项。
    let declared = null
    const re = new RegExp(p.docRe.source, 'g')
    let mm
    while ((mm = re.exec(cur)) !== null) {
      const v = Number(mm[1] ?? mm[2])
      // ★★ **说明语境排除必须「紧贴该数字」，不得用宽窗口**（**W67 实测的真缺陷，P-38/P-30**）：
      //   前身（W66）用的是 **±30 字窗口** + 词表含 `曾 / 旧 / 当时` 这类**极常见的字** ⇒
      //   ★★ **实测**（本轮的攻击样本）：只要同一行附近出现「曾 / 旧 / 当时 / W57 修」等词，
      //   **当前真缺陷（写 3 项 / 4 份）就被静默放过** —— 判据失效与通过**完全同貌**（**P-30**）。
      //   ★ 识别特征：**豁免词落在被豁免对象之外**（讲的是**别的**数字的历史），却把**这一个**放过了。
      //   ⇒ 口径收窄为**两条**（都要满足才算「说明语境」）：
      //     ⑴ **窗口紧贴该数字**（前 12 字 / 后 6 字）—— 只够容纳「仍报 `扫描 」这种**直接修饰**；
      //     ⑵ **词表只留真正的「引述旧值」措辞**（去掉 `曾 / 旧 / 当时` 这类会误伤日常行文的词）。
      //   ★ 这与 **W60/W51** 的纪律同源（窗口必须紧贴命中片段、且不得跨句读边界；
      //     整行判会把真缺陷一起豁免 —— 本轮是它的**第三次现身**）。
      const head = cur.slice(Math.max(0, mm.index - 12), mm.index)
      const tail = cur.slice(mm.index + mm[0].length, mm.index + mm[0].length + 6)
      if (/仍报|修前|原文写死|原本写|引述|据称/.test(head) || /^的旧值|（旧）/.test(tail)) continue
      declared = v
      break
    }
    if (declared === null) {
      // ★ 文档没写这个数字（或只出现在说明语境里）⇒ 不比对（守 ① 后半）
      continue
    }
    if (actual === null || actual === undefined) {
      // ★ 日志里没这条读数 ⇒ 只出声（某些架构/参数本就不产生；守 ① 前半）
      notes.push(`${p.label}：日志里**取不到**该读数行 ⇒ 本节**未比对**（出声，不当通过 —— P-43）`)
      continue
    }
    if (declared > actual) {
      // ★ 单向：构建期「声明 > 实测」只出声（与 gates 同纪律）
      const d = `**声明 > 实测**：文档 ${p.docHint} 写 **${declared}**，而日志读数 **${actual}**`
      notes.push(`${p.label}：${d}（方向：单向 —— 构建期不报「声明 > 实测」，见头注 P-43/P-40③）`)
      continue
    }
    if (declared < actual) {
      problems.push(`${p.label}：文档 ${p.docHint} 写 **${declared}**，而构建日志读数 **${actual}** ⇒ **文档过期**（**P-27**：读数有观测面却无人消费 ⇒ 照样静默脱钩，**P-30/P-62 推论**）`)
    }
  }
  return { problems, notes }
}

/**
 * ★★ **从 §八（验收 E-A~E-H）抽「可核对声明」**（**W51 新增**）。
 *
 * ## 为什么必须加（W51 实测的真缺陷）
 * W51 用探针实测「GOAL 各章节有没有被任何常驻闸门扫」⇒ 结论：
 * `§一/§二/§四` 是**纯定义**（无量化声明，合理无守），而
 * ★★ **`§八 验收` 完全无闸门提及** —— 可它**是最像「判据」的一节**
 * （「达成时的定义」），其中 **E-C 是唯一含可核对数字的一条**，而它写的
 * 「vitest **≥ 1786**」「**十三项门禁**」**两处都已过期**（实测 1790 / 48 条 `[gate] OK`）。
 *
 * ## 抽什么（**只抽「可机器取真值」的**，守 R7 诚实划界）
 *   · **门禁条数**：`N 条 `[gate] OK`` ⇒ 与 §3.1 **同一真值来源**（构建日志；**P-1**）
 *   · ★ 仅此一项：`vitest ≥ N` 是**代理阈值**（既不随轮次更新、也不表达真正的不变式），
 *     本闸门**不比对**它 —— 改为**断言它不再以「阈值」形态出现**（见下 `eCThresholdProblem`）。
 *
 * @returns {{ gates:number|null }}
 */
export function extractAcceptanceClaims (text) {
  const out = { gates: null }
  const a = text.indexOf('## 八、验收')
  const b = text.indexOf('## 九、')
  const region = a >= 0 ? text.slice(a, b > a ? b : undefined) : text
  const g = /(\d+)\s*条\s*`\[gate\]\s*OK`/.exec(region)
  if (g) out.gates = Number(g[1])
  return out
}

/**
 * ★★ **E-C 不得再用「代理阈值」表达不劣化**（**W51 新增** —— 守 P-41）。
 *
 * 由头：E-C 原文写「vitest **≥ 1786** 通过 0 失败」——
 * 那是个**代理量**：它既不随轮次更新（**P-27**：过期而无人回头改），
 * 也**不表达真正的不变式**（真正的不劣化事实是「**0 失败**」+「实测数见 §3.1」）。
 * ⇒ 本判据锚在**写法形态**上：E-C 若**再出现**「≥ <数字> 通过」这种阈值表达 ⇒ 报红。
 * @param {string} text  GOAL 全文
 * @returns {string|null}  违规描述；合规为 null
 */
export function eCThresholdProblem (text) {
  const a = text.indexOf('## 八、验收')
  const b = text.indexOf('## 九、')
  const region = a >= 0 ? text.slice(a, b > a ? b : undefined) : ''
  const m = /≥\s*(\d[\d,]*)\s*通过/.exec(region)
  if (m) return `§八 E-C 又用**代理阈值**表达不变量（「≥ ${m[1]} 通过」）⇒ 该阈值既不随轮次更新也不表达真正的不变式（P-41/P-27）`
  return null
}

/**
 * ★★ **E-C 的门禁数声明必须与 §3.1 同源**（**W51 新增**）。
 *
 * ★ 为什么单列这条（W51 实测的形态）：E-C 原文写「**十三项门禁** exit 0」——
 *   而「十三项」是**装置分类数**（§3.2 的第一层分组），**不是产出条数**（48 条 `[gate] OK`）。
 *   两者**不是一回事**，而读者会把它们当成同一件事 ⇒ **口径混用**（**P-1**）。
 * ⇒ 纪律：E-C 若要给条数，必须是**`N 条 `[gate] OK``** 这一形态（与 §3.1 同口径）。
 * @param {string} text
 * @param {{gates:number|null}} accept
 * @param {{gates:number|null}} baseline §3.1 的声明
 */
export function eCGatePhraseProblem (text, accept, baseline) {
  const a = text.indexOf('## 八、验收')
  const b = text.indexOf('## 九、')
  const region = a >= 0 ? text.slice(a, b > a ? b : undefined) : ''
  // ① 「N 项门禁」这类**分类数**措辞不得单独出现（必须与「N 条 [gate] OK」并存才能被读懂）
  //   ★★ 口径必须**同时覆盖阿拉伯数字与中文数字**（**W51 实测的口径缺陷**）：
  //     首版只写 `\d+\s*项门禁` ⇒ **漏掉原文的「十三项门禁」**（中文数字）⇒ 负控当场报绿
  //     = **判据失效而与通过同貌**（**P-30** / **P-45**：用写法近似语义）。
  //   ★★ **且必须排除「说明性引用」**（**W51 第二次实测**）：修 E-C 时我在同一行写了
  //     「★ W51 修：原文写死『十三项门禁』= 把**装置分类数**当成了**产出条数**」——
  //     这句**是在讲「不要这样做」**，却被正则命中 ⇒ **假红**（P-38）。
  //     ⇒ 判据按**就近窗口**排除「修 / 原文 / 不得 / 不是一回事」这类**说明语境**（P-52 同源纪律）。
  //   ★★ **且窗口不得跨「句读边界」**（**W51 第三次实测的过宽**）：
  //     首版窗口是 ±80 字，而 E-C **同一行前面还有另一句**「…按 P-41 **改锚**到…」（讲 vitest 阈值那段）
  //     ⇒ 那个「改锚」落进窗口 ⇒ **把真正的违规一起豁免** ⇒ 负控 D **报绿**（**P-30 与通过同貌**）。
  //     ⇒ 窗口**必须在最近的句读边界处截断**（`；` / `。` / `|`）—— 与 W44「不跨表格列边界」同源纪律。
  const M = /(?:\d+|[一二三四五六七八九十百]+)\s*项门禁/.exec(region)
  if (M) {
    const cut = () => {
      // 从命中点向两侧扩，遇到句读边界即停（保证「说明语境」必须是**同一句内**的）
      let left = M.index
      while (left > 0 && !/[；。|]/.test(region[left - 1]) && M.index - left < 120) left -= 1
      let right = M.index + M[0].length
      while (right < region.length && !/[；。|]/.test(region[right]) && right - (M.index + M[0].length) < 120) right += 1
      return region.slice(left, right)
    }
    const near = cut()
    const isExplanatory = /W\d+\s*修|原文|不得|不应|不是一回事|写成|改锚|口径混用/.test(near)
    if (!isExplanatory) {
      return '§八 E-C 用「**N 项门禁**」表述 —— 那是**装置分类数**，与产出条数（`N 条 `[gate] OK``）**不是一回事** ⇒ 读者会混用（P-1）'
    }
  }
  // ② 若 E-C 给了条数，必须与 §3.1 一致（同源，P-1）
  if (accept.gates !== null && baseline.gates !== null && accept.gates !== baseline.gates) {
    return `§八 E-C 声明门禁 **${accept.gates} 条**，而 §3.1 声明 **${baseline.gates} 条** ⇒ 同一事实两处两个值（P-1）`
  }
  return null
}

/**
 * **日志是否「已跑完」**（Step 7 收尾标志 `[完成] DSH …`）。
 *
 * ★★ 为什么必须判这个（**W45 实测的真缺陷，P-45 形态**）：
 *   本闸门在**构建期**跑，而**本次构建的日志正在被写入** —— 它此刻只有前 30 行
 *   `[gate] OK`。首版按**文件名字典序**取「最近两份」，于是取到了
 *     · `w45b-build-x64.log`（**上次失败**，30 条）与
 *     · `w45c-build-x64.log`（**本次正在写**，31 条）
 *   ⇒ 报出「§3.1 声明 41 条，实为 31 条 ⇒ 基线过期」—— 而 41 是**对的**，
 *     错的是**我把「半截日志」当成了「实测真值」**（真值来源与真目标错位）。
 *   ★ 这正是 P-27 的反面用法：「实测」必须是**已完成的实测**。
 */
/**
 * ★★ **会增长的读数不得写成硬常量**（**W57 建 · W58 扩到 README 的 TH API 面**）。
 *
 * ## 由头
 * **W57**：`GOAL.md` §3.2 与 §六 B10 写死「路由 **67 条**」而实测 **68**（**P-27**）。
 * **W58**：`README.md`「能做什么」表写死「**73 个 API（32 本地 + 41 桥接）**」、
 *   Tier 2 写死「**71 项**记名 stub」，而实测 **本地 34 + 桥接 41 = 75**、记名拒绝 **81 项**
 *   ⇒ **两个数都过期**，且它们同样**从未被任何机器核过**
 *   （`audit-th-face-coverage.mjs` 只做「名字是否已实现或已拒绝」的面比对，**不断言条数**）。
 *
 * ## 纪律（按 P-41：锚到「决定结果的事实」+ P-60）
 * ① **写「N 条 / N 个」时必须同时给出读法**（「以源码为准 / 当前实测 / 有机器守」），
 *   说明它是**读数**而不是常量；
 * ② ★ 例外：**确实有机器守**的读数允许写具体数字（如 `tavern_events` **82 项** ——
 *   写死反而是**对的**：它是有意冻结的兼容面，变了必须报红）。⇒ 判据按**是否声明了守它的装置**分流。
 *   ★★ **W64 修（本条此前把「装置名」当成了「装置在跑」）**：本行原写「由 `audit-card-event-surface.mjs`
 *     断言 `=== 82`」—— 而**该脚本在构建期零引用**（`build-dsht.ps1` 里 `grep` = **0 命中**），
 *     真正守 82 的是 **vitest 规格** `packages/tests/th-script-runtime.spec.ts` 的
 *     `expect(Object.keys(TAVERN_EVENTS)).toHaveLength(82)`。
 *     ⇒ 这是 **P-56**（「声明已被机器守着」必须连「它会在**哪条通路**上被跑到」一起声明）的形态：
 *     豁免依据指向一个**永不运行的装置**，于是「写死数字」免于报红是**建立在假前提上的**。
 *     ★ 教训：**豁免所依据的装置，必须点名到「能跑到的通路」上**（构建期闸门 **或** vitest 规格）。
 *
 * ## 扫描面（按语义枚举，不按我写过的那一处 —— P-58）
 *   `GOAL.md` 的「路由 N 条」形态 + `README.md` 的「N 个 API / N 项记名 stub」形态。
 *
 * @param {string} text  文档全文
 * @param {{allowWithGuard?:boolean}} [opt] `allowWithGuard` ⇒ 同行声明了守它的装置即豁免
 * @returns {string[]} 问题列表（空 = 合规）
 */
export function growthReadingHardcodeProblems (text, opt = {}) {
  const allowGuard = opt.allowWithGuard !== false
  const problems = []
  // 允许的写法（**两类，判法不同** —— W64 分开）：
  //   ⑴ **自足读数词**：直接说明「这是读数」⇒ **不需要**点名装置，自身就够。
  //   ⑵ **装置声明词**（`有机器守` / `由 X 断言`）⇒ **必须**点名到「能跑到的通路」（见下）。
  const SELF_SUFFICIENT = /以脚本输出为准|以源码为准|当前实测|见 §3\.2|见 §六 B10|（W5[78] 修）/
  const GUARD_CLAIM = /有机器守|由\s*`[\w.-]+`\s*断言/
  const READ_OK = /以脚本输出为准|以源码为准|当前实测|见 §3\.2|见 §六 B10|（W5[78] 修）|有机器守|由\s*`[\w.-]+`\s*断言/
  // ★★ **W64 加：豁免所依据的装置，必须点名到「能跑到的通路」上**（守 **P-56**）
  //   由头：文档写「`tavern_events` **82 项** ★ 有机器守：**`audit-card-event-surface.mjs` 断言 `=== 82`**」
  //   —— 而该脚本**在构建期零引用**（`build-dsht.ps1` 里 `grep` = **0 命中**），
  //   真正守 82 的是 **vitest 规格**（`th-script-runtime.spec.ts`）。
  //   ⇒ 旧口径只要「点名了某个装置」就豁免 —— **不问那个装置会不会被跑到**（**P-30**：豁免与合规同貌）。
  //   ★ 判据：若豁免依据是「由 `<X>` 断言 / 有机器守」这类**装置声明**，则**必须同时给出通路**：
  //     ① X 是 `scripts/` 下的**构建期闸门**（其名出现在 `build-dsht.ps1` 里），**或**
  //     ② 行内显式点名 **vitest / 规格 / spec / 单测** 这类**会被 `npm run test` 跑到的**通路。
  //   ★ 为什么用「构建期闸门名单**实读**构建脚本」（**P-27**：不硬编码）与 `resolveBare` 同法（**P-41**）。
  const GATE_PATH_RE = /(?:audit|verify)-[\w-]+\.(?:mjs|py)/
  const SPEC_HINT = /vitest|规格|spec\.ts|单测/
  const hasRunnableGuard = (line, gateNames) => {
    // ① 点名了构建期闸门 ⇒ 查它**真的在构建脚本里**（不是「名字像闸门」）
    for (const m of line.matchAll(/`([\w./-]+\.(?:mjs|py))`/g)) {
      if (gateNames.has(m[1].split(/[\\/]/).pop())) return true
    }
    // ② 显式点名 vitest / 规格通路
    if (SPEC_HINT.test(line)) return true
    // ③ 其余读到的一律**不算**（如 `audit-card-event-surface.mjs` 这种「不在构建期跑」的装置）
    return false
  }
  // ★★ **说明性引用必须排除**（**W58 实测的假红**，与 **W51** 同源纪律）：
  //   我在 README 里写「★ W57 修：原文写死『路由 **67 条**』而实测 68」——
  //   这句**是在讲「不要这样做」**，却被正则命中 ⇒ **假红**（**P-38**）。
  //   ⇒ 按**就近窗口**排除「修 / 原文 / 长期写死 / 曾经 / 实测 68」这类**说明语境**（P-52 同源纪律）。
  const isExplanatory = (line) => /原文写死|长期写死|曾经写死|（W5[78] 修）|★ \*\*W5[78]/.test(line)
  text.split(/\r?\n/).forEach((l, i) => {
    const line = l
    if (isExplanatory(line)) return
    // 形态①：「路由 N 条」（GOAL）
    // 形态②：「N 个 API（N 本地 + N 桥接）」「N 项记名 stub」（README）
    const forms = [
      /路由[^。|]{0,20}?\*{0,2}(\d+)\s*条/,
      /(\d+)\s*个\s*API/,
      // ★ W59 扩：`N 项记名 stub` / `约 N 项已记名 stub` / `约 N 项 stub`（三种写法都出现过）
      /(?:约\s*)?\*{0,2}(\d+)\*{0,2}\s*项\s*(?:已记名\s*|记名\s*)?stub/i
    ]
    for (const re of forms) {
      // ★ 同一 form 内**继续找后续匹配**（**W62 实测的口径缺陷**）：
      //   若只 `exec` 一次，遇到「行内第一个匹配是引述、第二个才是真声明」时
      //   （实测形态：「对比 W57 的「路由 67 条」，本行才是真声明：路由 68 条」）
      //   ⇒ 会把整行**误判成合规**（**假绿**，P-30）。
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      let m
      let reported = false
      while ((m = g.exec(line)) !== null) {
        // ★ W64：豁免分两类 —— 自足读数词**直接过**；装置声明词**必须**点名到能跑到的通路。
        const exempt = allowGuard && (
          SELF_SUFFICIENT.test(line)
          || (GUARD_CLAIM.test(line) && hasRunnableGuard(line, opt.gateNames ?? new Set()))
        )
        if (exempt) break
        const seg = m[0]
        const before = line[m.index - 1] ?? ''
        const after = line[m.index + seg.length] ?? ''
        const quoted = /[「『“"']/.test(before) || /[」』”"']/.test(after)
        if (quoted) continue
        problems.push(`第 ${i + 1} 行写死「${seg.trim()}」而未标注它是**读数**`
          + `（需给出「以源码为准 / 当前实测」或点名守它的装置）⇒ **会随能力增长的量不得写成硬常量**`
          + `（**P-60 / P-41**：锚到不变式，条数只作读数）`)
        reported = true
        break
      }
      if (reported) break   // 一行只报一次，避免同一行多种形态重复刷屏
    }
  })
  return problems
}

/**
 * ★★ **契约面读数必须与快照一致**（**W60 新增**）。
 *
 * ## 由头（W60 排查：`B10` 里与「路由 N 条」**并列的另一个读数**）
 * `GOAL.md` §六 **B10** 写「不改变既有对外契约（路由 …、**slots 42 个**、wire 契约、slot id）」。
 * ★ 路由那半已由 W57 守住（`audit-route-contract.mjs` 实测 68 + 读数行进日志），
 *   而 **`slots 42 个` 这一半从未被任何机器核过** —— 逐条取证：
 *   权威来源是 `rp-workspace/contracts/<ver>/slots.json`（`total` 字段 + `slots` 数组），
 *   实测 **`total=42` / 数组 42 项** ⇒ **当前与声明一致**（无缺陷）；
 *   但全仓只有**手工 CLI**（`capture-contracts.mjs` / `diff-contracts.mjs`）读它，
 *   **没有任何常驻闸门核对「声明的数 == 快照里的数」**（**P-11 元级**：声明为契约、实质无人核）。
 *   ⇒ 这正是 **P-60** 说的「**先建的那一处有守、后加的同类无守**」在**同一行内**的形态。
 *
 * ## 纪律（按 P-41/P-60）
 * ① 抽**快照里的权威读数**（先 `total`，缺失则退回数组长度），与**文档声明的数**比对；
 * ② ★ **快照缺失 ⇒ 只出声不报红**（**P-43**：换机/CI 可能没采集过快照）；
 * ③ ★ **快照里的 `total` 与数组长度互相矛盾 ⇒ 报红**（这是快照自身的自洽问题，属真缺陷）。
 *
 * @param {string} text 文档全文
 * @param {string} slotsJsonPath 权威快照路径
 * @returns {{problems:string[], notes:string[], claimed:number|null, actual:number|null}}
 */
export function slotCountProblems (text, slotsJsonPath) {
  const problems = []
  const notes = []
  // 文档声明的 slot 数（当前状态区）
  //
  // ★★ **排除窗口必须「紧贴命中片段」，不得整行判** —— **W60 实测逼出的口径**：
  //   首版按**整行**排除说明语境，而 `GOAL.md` §六 B10 的那一行是**长表格行**，
  //   行内**前半句**讲的是**路由**的历史（`…★ **W57 修**：**原文写死**「路由 67 条」…`）
  //   ⇒ 整行被豁免 ⇒ **`slots 42 个` 的声明根本没被抽到**，闸门当场报
  //   「文档里找不到『slots N 个』的声明 ⇒ 本判据**未生效**」（**P-45**：口径与真目标错位；
  //   与 **W51** 的「窗口跨句读边界」**同源**，是它换了个方向的第二次现身）。
  //   ⇒ 判据只对**命中片段前后各 12 字**的**紧邻窗口**判说明语境：「在讲这个数字的历史」
  //     必然**紧邻**这个数字（`原文写死「slots 41 个」`），而**隔了半句**的说明与它无关。
  //   ★ 且**同一行内要继续找后续匹配**（`…原文写死「slots 41 个」…；现行声明：slots 42 个`）——
  //     被排除的只是**那个**陈述句，不是整行（否则「史实 + 现行声明同现一行」会静默不生效）。
  const EXPLAIN = /原文写死|长期写死|曾经写死|（W\d+ 修）/
  const nearOf = (line, idx, len) => line.slice(Math.max(0, idx - 12), idx + len + 12)
  let claimed = null
  text.split(/\r?\n/).forEach((l) => {
    if (claimed !== null) return
    const re = /slots?\s*\**\s*(\d+)\s*\**\s*个/gi
    let m
    while ((m = re.exec(l)) !== null) {
      if (EXPLAIN.test(nearOf(l, m.index, m[0].length))) continue
      claimed = Number(m[1])
      return
    }
  })
  if (claimed === null) {
    notes.push('文档里找不到「slots N 个」的声明 ⇒ 本判据**未生效**（出声，不当通过）')
    return { problems, notes, claimed, actual: null }
  }
  if (!fs.existsSync(slotsJsonPath)) {
    notes.push(`找不到契约快照 ${slotsJsonPath} ⇒ slot 数无法核对（**只出声不报红**，守 P-43）`)
    return { problems, notes, claimed, actual: null }
  }
  let actual = null
  try {
    const j = JSON.parse(fs.readFileSync(slotsJsonPath, 'utf8'))
    const arrLen = Array.isArray(j.slots) ? j.slots.length : null
    // ③ 快照自洽：total 与数组长度必须一致
    if (typeof j.total === 'number' && arrLen !== null && j.total !== arrLen) {
      problems.push(`契约快照 ${slotsJsonPath} **自相矛盾**：total=${j.total} 而 slots 数组 ${arrLen} 项`
        + ` ⇒ 快照自身不可信（先重采：\`node scripts/capture-contracts.mjs\`）`)
    }
    actual = typeof j.total === 'number' ? j.total : arrLen
  } catch (e) {
    notes.push(`契约快照解析失败（${e.message}）⇒ 只出声不报红（守 P-43）`)
    return { problems, notes, claimed, actual }
  }
  if (actual !== null && claimed !== actual) {
    problems.push(`B10 声明「slots **${claimed}** 个」，而契约快照 \`slots.json\` 实测 **${actual}**`
      + ` ⇒ 过期声明（**P-27**）或契约被改（**B10** 要求「变更须同时更新契约文档与判据」）`)
  }
  return { problems, notes, claimed, actual }
}

/**
 * ★★ **在 `contracts/` 下自动发现权威 slot 快照**（**W60**）。
 *
 * ## 为什么必须自动发现（而不是写死 `contracts/0.1.0-rc.7/slots.json`）
 * 目录名是**官方包版本号**（`capture-contracts.mjs` 用 dsh 主包 `package.json.version` 命名），
 * **会随官方升级而变** —— 写死路径的判据在下一次升级后就会**静默失效**
 * （**P-30**：判据失效与通过同貌），而「官方升级」恰是本项目的常态风险（§一）。
 * ⇒ 按 **P-41** 锚到「**决定这个读数的事实**」=「**最近采集的那份快照**」。
 * ★ 取法：先按 `manifest.json.capturedAt`（采集时间）降序；缺 manifest 则退回目录名字典序降序。
 *
 * @param {string} contractsRoot `rp-workspace/contracts`
 * @returns {string|null} 快照路径；找不到返回 null（调用方按 P-43 只出声不报红）
 */
export function findSlotsSnapshot (contractsRoot) {
  if (!fs.existsSync(contractsRoot)) return null
  const cands = []
  for (const d of fs.readdirSync(contractsRoot)) {
    const p = path.join(contractsRoot, d, 'slots.json')
    if (!fs.existsSync(p)) continue
    let capturedAt = ''
    try {
      const m = JSON.parse(fs.readFileSync(path.join(contractsRoot, d, 'manifest.json'), 'utf8'))
      if (typeof m.capturedAt === 'string') capturedAt = m.capturedAt
    } catch { /* manifest 缺失 ⇒ 退回目录名排序（不得因它让整个判据失效） */ }
    cands.push({ dir: d, path: p, capturedAt })
  }
  if (cands.length === 0) return null
  cands.sort((a, b) => (a.capturedAt === b.capturedAt
    ? a.dir.localeCompare(b.dir)
    : (a.capturedAt < b.capturedAt ? -1 : 1)))
  return cands[cands.length - 1].path
}

export function isFinishedBuildLog (logText) {
  return /\[完成\]\s*DSH\s/.test(logText)
}

/**
 * 从候选日志里挑**真值来源**（**纯函数**，便于 selftest）。
 * @param {Array<{name:string, text:string, mtime:number}>} entries
 * @returns {Array<{name:string,text:string,mtime:number}>} 最近两份**已跑完**的日志（mtime 升序）
 */
export function pickTruthLogs (entries) {
  return entries
    .filter(e => isFinishedBuildLog(e.text))
    .sort((a, b) => a.mtime - b.mtime)
    .slice(-2)
}

/**
 * 逐条比对（**纯函数**）。
 *
 * ## ★★ 方向性（W45 实测的真缺陷 —— `gatesOneWay`）
 * 本闸门在**构建期**跑，而「门禁条数」的真值来自**构建结果**：
 *   · 构建期能看到的「最近一份已跑完的日志」**一定是上一轮的**（本次还在写）；
 *   · 而 §3.1 是**每轮更新**的 ⇒ 本轮若**新增了闸门**（本仓常态：W42/W44/W45 各加 3 条），
 *     声明数就会**大于**上一轮日志 ⇒ 首版据此报「基线过期」= **假红**（实测：报 41 vs 31）。
 * ⇒ 按 **P-43「无判据力不判」**（以及 **P-40③**：判据须跑在它所判对象状态已确定之后），
 *   构建期对「声明 > 实测」这一方向**没有判据力**（无法区分「文档写错」与「本轮新增」），
 *   故**只出声不报红**；而「声明 < 实测」是**确定的缺陷**（文档漏记了已存在的闸门）⇒ **报红**。
 * ★ 诚实边界（R7）：本闸门**不替代**人工在构建完成后复核 §3.1；日志跑完后重跑本脚本，
 *   真值即变成本轮的，那时的比对是**双向**的（`gatesOneWay` 只影响构建期那一跑）。
 *
 * @param {{gates:number|null,sentinel:number|null,pCount:number|null,m4:object|null}} claims
 * @param {{gates:number|null,sentinel:number|null}} logTruth
 * @param {{pCount:number|null, m4:object|null}} repoTruth
 * @param {{ gatesOneWay?: boolean }} [opt]
 */
export function compareClaims (claims, logTruth, repoTruth, opt = {}) {
  const oneWay = opt.gatesOneWay === true
  const problems = []
  const notes = []
  if (claims.gates !== null && logTruth.gates !== null && claims.gates !== logTruth.gates) {
    if (oneWay && claims.gates > logTruth.gates) {
      notes.push(`§3.1 声明门禁 **${claims.gates} 条** > 最近一份**已完成**日志的 **${logTruth.gates} 条**`
        + ` ⇒ 构建期**无判据力**（很可能本轮新增了闸门，而本次构建尚未跑完）⇒ **不报红**（P-43）`
        + `；请在构建完成后重跑本脚本复核`)
    } else {
      problems.push(`§3.1 声明门禁 **${claims.gates} 条 `+'`[gate] OK`'+`**，而构建日志实为 **${logTruth.gates} 条**`
        + ` ⇒ **基线数字过期**（P-27）：读者会按错数字判断回归`)
    }
  }
  if (claims.sentinel !== null && logTruth.sentinel !== null && claims.sentinel !== logTruth.sentinel) {
    if (oneWay && claims.sentinel > logTruth.sentinel) {
      notes.push(`§3.1 声明 sentinel **v${claims.sentinel}** > 已完成日志的 **v${logTruth.sentinel}**`
        + ` ⇒ 构建期无法区分「文档写错」与「本轮刚升版」⇒ **不报红**（P-43）`)
    } else {
      problems.push(`§3.1 声明 sentinel **v${claims.sentinel}**，而构建日志实为 **v${logTruth.sentinel}** ⇒ 基线数字过期（P-27）`)
    }
  }
  if (claims.pCount !== null && repoTruth.pCount !== null && claims.pCount !== repoTruth.pCount) {
    problems.push(`§3.1 声明「累计 **${claims.pCount}** 条」P 判据，而 §九 索引实为 **${repoTruth.pCount}** 条 ⇒ 过期声明（P-1/P-27）`)
  }
  if (claims.m4 && repoTruth.m4 && (claims.m4.items !== repoTruth.m4.items || claims.m4.missing !== repoTruth.m4.missing)) {
    // ★★ **W63：M4 与门禁条数同向**（守 P-43/P-40③，与 `gates` 分支**同一纪律**）
    //   理由完全对称：构建期能看到的「最近一份已完成日志」**一定是上一轮的**，
    //   而本轮的 M4 标记数**只增不减**（新增产物/新判据组都会加标记）
    //   ⇒ 「声明 > 实测」在构建期**没有判据力**（无法区分「文档写错」与「本轮新增」）⇒ 只出声；
    //     而「声明 < 实测」是**确定的缺陷**（文档漏记了已存在的标记）⇒ 报红。
    //   ★ 首版（W63 未改前）是**双向** ⇒ 本轮新增标记时会**假红**（正是 W45 在 gates 上踩过的坑）。
    const m4Up = claims.m4.items > repoTruth.m4.items
      || (claims.m4.items === repoTruth.m4.items && claims.m4.missing < repoTruth.m4.missing)
    if (oneWay && m4Up) {
      notes.push(`§3.1 声明 M4「双包各 **${claims.m4.items} 项 / 缺失 ${claims.m4.missing}**」> 已完成日志的 **${repoTruth.m4.items} / ${repoTruth.m4.missing}**`
        + ` ⇒ 构建期**无判据力**（很可能本轮新增了标记，而本次构建尚未跑完）⇒ **不报红**（P-43）；请在构建完成后重跑本脚本复核`)
    } else {
      problems.push(`§3.1 声明 M4「双包各 **${claims.m4.items} 项 / 缺失 ${claims.m4.missing}**」，实测为 **${repoTruth.m4.items} / ${repoTruth.m4.missing}** ⇒ 过期声明（P-27）`)
    }
  }
  // 缺项 ⇒ 出信息（不当违规：判据边界，见头注 R7）
  if (claims.gates === null) notes.push('§3.1 未抽到「N 条 [gate] OK」声明 ⇒ 该项不核')
  if (claims.sentinel === null) notes.push('§3.1 未抽到「当前 vN」sentinel 声明 ⇒ 该项不核')
  return { problems, notes }
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // ---- 正控：抽声明（真实形态）----
  const doc = [
    '### 3.1 基线数字（2026-09-17 第三十七轮 **W44** 收口实测）',
    '| 门禁（...；**38 条 `[gate] OK`**） |',
    '| 双架构 APK | ... **sentinel 一致**（当前 **v363**）',
    '| 产物核验（M4） | ... 双包各 **169 项 / 缺失 0** |',
    '| 设计哲学判据 | **P-1 ~ P-49**（累计 49 条；',
    '### 3.2 门禁清单（构建期常驻）',
    '| 32 条 `[gate] OK`（这是 §3.2 的，不该被抽） |'
  ].join('\n')
  const c = extractBaselineClaims(doc)
  t('正控：门禁条数抽对', c.gates === 38, `gates=${c.gates}`)
  t('正控：sentinel 抽对', c.sentinel === 363, `sentinel=${c.sentinel}`)
  t('正控：P 判据累计条数抽对', c.pCount === 49, `pCount=${c.pCount}`)
  t('正控：M4 抽对', c.m4 && c.m4.items === 169 && c.m4.missing === 0, JSON.stringify(c.m4))
  t('零控：**不得**抽到 §3.2 里的数字（切面收在 §3.1 内）',
    c.gates === 38, `gates=${c.gates}（若切面过宽会变成 32）`)

  // ---- 正控：日志真值抽取 ----
  const log = [
    '  [gate] OK a.mjs', '  [gate] OK b.mjs', '  [gate] OK c.mjs',
    '  RUNTIME_SENTINEL: .installed-v363 → .installed-v363（覆盖安装将重新解压）'
  ].join('\n')
  const lt = readBuildLogTruth(log)
  t('正控：从日志抽门禁条数 = 3', lt.gates === 3, `gates=${lt.gates}`)
  t('正控：从日志抽 sentinel = 363', lt.sentinel === 363, `sentinel=${lt.sentinel}`)

  // ---- ★★ W63：**M4 真值也必须能从日志抽到**（这是本轮修的缺陷所在）----
  //   由头（**P-59 的第二种形态**）：`compareClaims` 里**一直有** M4 判据，
  //   但**主流程硬编码传 `m4: null`** ⇒ 判据从不生效；真值来源（Step 6.6 的读数行）
  //   **本来就在日志里**，只是没人去读。★ 决定性实验（`tmp/w63-decisive.mjs`）：
  //   正控（门禁条数改坏）报红，实验组（M4 `169→142`）**不报红** ⇒ 该数字无人守。
  const logM4 = [
    '  [步骤 6.6] M4 内容级产物核验（R5/R6；169 项标记）',
    '    => 核验 169 项，缺失 0 项',
    '  [gate] OK verify-apk-payload.py（M4 内容级：x86_64 包标记齐全，缺失 0）'
  ].join('\n')
  const ltM4 = readBuildLogTruth(logM4)
  t('★★正控（W63 · M4 真值抽取）：能从 Step 6.6 读数行抽出 `169/0`',
    ltM4.m4 && ltM4.m4.items === 169 && ltM4.m4.missing === 0, JSON.stringify(ltM4.m4))
  t('★零控（W63 · 无 M4 读数行）：旧日志（Step 6.6 之前）⇒ m4 为 null（**不冒充有**）',
    readBuildLogTruth(log).m4 === null, JSON.stringify(readBuildLogTruth(log).m4))
  // ★ 多包口径：取保守值（items 最小 / missing 最大）
  const ltMulti = readBuildLogTruth('=> 核验 169 项，缺失 0 项\n=> 核验 168 项，缺失 1 项')
  t('★正控（W63 · 多包取保守值）：两包 `169/0` 与 `168/1` ⇒ 取 **168/1**',
    ltMulti.m4 && ltMulti.m4.items === 168 && ltMulti.m4.missing === 1, JSON.stringify(ltMulti.m4))
  // ★★ 负控：声明与实测不符 ⇒ 报红（这条判据此前**从不生效**）
  const rM4 = compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 142, missing: 0 } },
    { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } })
  t('★★负控（W63 · M4 过期）：声明 `142/0` vs 实测 `169/0` ⇒ **必须报红**',
    rM4.problems.length === 1 && /M4/.test(rM4.problems[0]), JSON.stringify(rM4.problems))
  // ★ 正控：M4 一致 ⇒ 不报红
  t('★正控（W63 · M4 一致）：`169/0` vs `169/0` ⇒ 不得报红',
    compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 169, missing: 0 } },
      { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } }).problems.length === 0, '')
  // ★★ 零控（W63 · 单向口径）：M4 与门禁条数**同向** —— 构建期「声明 > 实测」只出声
  //   （本轮新增标记是正常事，报红就是假红 —— W45 在 gates 上踩过的同一个坑）
  const rM4Up = compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 175, missing: 0 } },
    { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } }, { gatesOneWay: true })
  t('★★零控（W63 · M4 单向）：声明 175 > 实测 169（很可能本轮新增标记）⇒ **不报红**（P-43）',
    rM4Up.problems.length === 0 && rM4Up.notes.some(n => /无判据力/.test(n)),
    `problems=${rM4Up.problems.length} notes=${rM4Up.notes.length}`)
  t('★零控（W63 · M4 单向反证）：声明 165 < 实测 169（**文档漏记**）⇒ **仍报红**（确定的缺陷）',
    compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 165, missing: 0 } },
      { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } }, { gatesOneWay: true }).problems.length === 1, '')
  t('★零控（W63 · M4 双向反证）：同一份声明 175 vs 169 ⇒ 双向口径下**报红**（证明单向不是把判据改废）',
    compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 175, missing: 0 } },
      { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } }, { gatesOneWay: false }).problems.length === 1, '')
  // ★★ **承重控（W63）**：上面的 M4 控全在**纯函数层**（直接调 `compareClaims`），
  //   而本轮的真缺陷在**主流程的接线**（`m4: null` 硬编码）⇒ 纯函数控**测不到它**
  //   （**承重实验当场证伪**：短路接线后 selftest 仍 73/73 全绿，只有负控 J 报红）。
  //   ⇒ 必须**断言源码里主流程真的传了 m4 真值**（这是「接线存在性」的控，与负控 J 互补：
  //     负控 J 测「改坏会红」，本控测「接线还在」）。
  {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    t('★★承重控（W63 · 主流程接线）：源码里 `compareClaims` 的第三参**必须传 m4 真值**（不得退回 `m4: null`）',
      /compareClaims\(claims, logTruth, \{ pCount, m4: m4Truth \}/.test(src),
      (/(compareClaims\(claims, logTruth, \{[^}]*\})/.exec(src) ?? ['(未找到)'])[0])
    t('★★承重控（W63 · 真值来源）：`readBuildLogTruth` 必须抽 M4 读数行（否则上面那条永远是 null）',
      /核验\\s\*\(\\d\+\)\\s\*项，缺失/.test(src), '')
  }

  // ---- ★★ W66 新增：日志读数 vs 文档写死数字的对账（守 P-62「接线 ≠ 消费」）----
  //   ★ 为什么必须补（**P-59 纪律③**）：W66 新加的这条判据若不覆盖，就是**永远测不到的死判据**。
  {
    // ① 读数抽取正控（真实日志形态）
    const fakeLog = [
      '         [A11] OK —— 常驻探针登记完整（受检目标 9 个，无未登记的 ef-* 探针）',
      '         [A14] 权威脚本锚点：从 build-dsht.ps1 + rebuild-plugins.ps1 实读 7 条「产物 → entry」（去重后 6 个产物）',
      '         [文档引用] 扫描 5 份（E-H 四份 + SSOT）· 悬空/误导/控制外引用 0 处',
      '         [自证分数] 受检闸门 38 个（接入契约 30 / 未接入 8）· 文档声明 82 条'
    ].join('\n')
    const rv = readReadingValues(fakeLog)
    t('★正控（W66 · 读数抽取）：4 条读数行 ⇒ 全部抽出（9 / 7 / 5 / 38）',
      rv.targets === 9 && rv.a14entries === 7 && rv.docrefdocs === 5 && rv.selftestgates === 38, JSON.stringify(rv))
    // ② 零控：无读数行 ⇒ 全 null（不得瞎猜）
    const rv0 = readReadingValues('[gate] OK audit-x.mjs')
    t('★零控（W66 · 读数抽取）：日志里无读数行 ⇒ 全部 null（不得编造）',
      Object.values(rv0).every(v => v === null), JSON.stringify(rv0))
    // ③ 对账负控：文档 < 实测 ⇒ 必须报红（本轮实测的真缺陷形态）
    const docLow = '## 三、当前基线\n| 门禁 | 见 3.2（**A11** selftest **20/20**、TARGETS **3 项**） |\n## 十一、当前工作面\nTARGETS **9 项**\n'
    const p1 = readingVsDocProblems(docLow, { targets: 9, a14entries: null, docrefdocs: null, selftestgates: null })
    t('★负控（W66 · 文档过期）：文档写 TARGETS 3 项 而日志读数 9 ⇒ **必须报红**',
      p1.problems.length === 1 && /文档过期/.test(p1.problems[0]), JSON.stringify(p1.problems))
    // ④ 正控：文档 9 项 = 读数 9 ⇒ 不报红
    const docOk = '## 三、当前基线\nTARGETS **9 项**\n'
    t('★正控（W66 · 一致）：文档 9 项 = 读数 9 ⇒ 不得报红',
      readingVsDocProblems(docOk, { targets: 9 }).problems.length === 0, '')
    // ⑤ 单向纪律：文档 > 实测 ⇒ **只出声不报红**
    const docHigh = '## 三、当前基线\nTARGETS **99 项**\n'
    const pHigh = readingVsDocProblems(docHigh, { targets: 9 })
    t('★单向（W66）：文档 99 项 > 读数 9 ⇒ **不报红**（只出声，与 gates 同纪律）',
      pHigh.problems.length === 0 && pHigh.notes.some(n => /声明 > 实测/.test(n)), JSON.stringify(pHigh.notes))
    // ⑥ 零控：日志取不到读数 ⇒ 只出声，不报红（P-43）
    const pNoLog = readingVsDocProblems(docOk, { targets: null })
    t('★零控（W66 · 无读数）：日志取不到该读数 ⇒ **只出声不报红**（P-43）',
      pNoLog.problems.length === 0 && pNoLog.notes.some(n => /未比对/.test(n)), JSON.stringify(pNoLog.notes))
    // ⑦ ★★ 零控：**说明语境**里的旧值不得被当成声明（本轮实测的假红）
    const docHist = '## 三、当前基线\n- 说明：代码侧删一份 ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）` 且输出 OK。\n- 当前：扫描 **5** 份。\n'
    t('★★零控（W66 · 说明语境）：正文里「仍报 `扫描 4 份…`」是**引述旧值** ⇒ 必须被跳过、取后面那条',
      readingVsDocProblems(docHist, { docrefdocs: 5 }).problems.length === 0,
      JSON.stringify(readingVsDocProblems(docHist, { docrefdocs: 5 }).problems))
    // ⑧ ★★ 零控：史实区（§十一 之后）的数字不参与比对
    const docHist2 = '## 三、当前基线\n（本区未写该数字）\n## 十一、当前工作面\nTARGETS **9 项**\n'
    t('★★零控（W66 · 史实区）：只出现在 §十一 之后的数字 ⇒ **不比对**（那是记账，不是当前声明）',
      readingVsDocProblems(docHist2, { targets: 9 }).problems.length === 0, '')
    // ⑨ ★★ 承重控：主流程必须真的调 `readingVsDocProblems`（纯函数控测不到「没接线」，P-63 纪律②）
    const src66 = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    t('★★承重控（W66 · 接线存在性）：主流程必须真的调 `readingVsDocProblems(...)` 并把结果并入问题集',
      /readingVsDocProblems\([^)]*\)/.test(src66) && /rv\.problems/.test(src66), '')

    // ---- ★★ ⑩ W67：**豁免窗口不得过宽**（本轮实测的真缺陷）----
    //   由头：W66 的「说明语境排除」窗口是 **±30 字**、词表含 `曾 / 旧 / 当时` 这类**极常见字**
    //   ⇒ **攻击样本实测**：只要同行附近出现这些词，**当前真缺陷就被静默放过**（**P-30**）。
    //   ★ 这 5 条是**成对的**：4 个「同行有豁免词 + 真缺陷 ⇒ **必须报红**」+ 1 个「纯说明语境 ⇒ **必须豁免**」——
    //     **只做一侧就留下半个盲区**（W66 的教训：负控与杠杆要成对；**P-58 的两侧纪律**）。
    const atk = [
      ['曾', '## 三、当前基线\n| 门禁 | 曾按 12 项统计，现为 TARGETS **3 项** |\n'],
      ['旧', '## 三、当前基线\n| 门禁 | 旧版为 12 项，现 TARGETS **3 项** |\n'],
      ['当时', '## 三、当前基线\nTARGETS **3 项**（当时为 12 项）\n'],
      ['W57 修', '## 三、当前基线\nTARGETS **3 项**（★ W57 修：原文写死 12 项）\n']
    ]
    let okAtk = true
    for (const [word, doc] of atk) {
      const pr = readingVsDocProblems(doc, { targets: 9 })
      if (pr.problems.length !== 1) { okAtk = false; console.log(`      ⚠ 攻击样本「${word}」未被报红`) }
    }
    t('★★负控（W67 · 豁免窗口过宽）：同行出现「曾/旧/当时/W57 修」+ **当前真缺陷** ⇒ **必须全部报红**（4/4）',
      okAtk, `被测 ${atk.length} 个样本`)
    t('★★正控（W67 · 说明语境仍豁免）：真正的「引述旧值」句（`仍报 \`扫描 4 份…\``）⇒ **必须被跳过**、取后面的当前值',
      readingVsDocProblems('## 三、当前基线\n- 说明：代码侧删一份 ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）` 且输出 OK。\n- 当前：扫描 **5** 份。\n', { docrefdocs: 5 }).problems.length === 0,
      JSON.stringify(readingVsDocProblems('## 三、当前基线\n- 说明：代码侧删一份 ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）` 且输出 OK。\n- 当前：扫描 **5** 份。\n', { docrefdocs: 5 })))
  }

  // ---- 正控：一致 ⇒ 无问题 ----
  const r1 = compareClaims({ gates: 38, sentinel: 363, pCount: 49, m4: { items: 169, missing: 0 } },
    { gates: 38, sentinel: 363 }, { pCount: 49, m4: { items: 169, missing: 0 } })
  t('正控：全部一致 ⇒ 无问题', r1.problems.length === 0, r1.problems.join(' / '))

  // ---- ★ 负控：门禁条数过期（**W44 实测的真缺陷形态**：扩了判据没同步）----
  const r2 = compareClaims({ gates: 35, sentinel: 363, pCount: 49, m4: null }, { gates: 38, sentinel: 363 }, { pCount: 49, m4: null })
  t('负控：门禁条数 35 vs 实际 38 ⇒ 报红', r2.problems.length === 1 && /基线数字过期/.test(r2.problems[0]), r2.problems[0]?.slice(0, 60) ?? '')
  t('负控：报红**同时**说出声明值与实际值',
    /35/.test(r2.problems[0]) && /38/.test(r2.problems[0]), '')

  // ---- ★ 杠杆（P-20）：只把声明改成实测值 ⇒ 必须转绿 ----
  const r3 = compareClaims({ gates: 38, sentinel: 363, pCount: 49, m4: null }, { gates: 38, sentinel: 363 }, { pCount: 49, m4: null })
  t('杠杆：仅把声明改成实测值 ⇒ 必须转绿', r3.problems.length === 0, r3.problems.join(' / '))

  // ---- 负控：sentinel 过期 ----
  const r4 = compareClaims({ gates: 38, sentinel: 362, pCount: null, m4: null }, { gates: 38, sentinel: 363 }, { pCount: null, m4: null })
  t('负控：sentinel v362 vs 实际 v363 ⇒ 报红', r4.problems.length === 1 && /sentinel/.test(r4.problems[0]), '')

  // ---- ★★ W45 新增：真值来源必须是「**已跑完**的日志」（**实测的真缺陷：半截日志被当真值 ⇒ 假红**）----
  const finished = '[gate] OK a.mjs\n[gate] OK b.mjs\nRUNTIME_SENTINEL: .installed-v363 → .installed-v363\n[完成] DSH 0.1.5-rc.1 → DSH Tavern APK'
  const truncated = '[gate] OK a.mjs\nRUNTIME_SENTINEL: .installed-v363 → .installed-v363\n$ 还在写…'
  t('正控：`[完成] DSH …` 收尾的日志 ⇒ 认定已跑完', isFinishedBuildLog(finished) === true, '')
  t('★负控：**半截/失败**日志（无收尾标志）⇒ 不得认定为真值来源', isFinishedBuildLog(truncated) === false, '')
  const picked = pickTruthLogs([
    { name: 'w45b-build-x64.log', text: truncated, mtime: 300 },   // 上次失败（更早但名字更大）
    { name: 'w45c-build-x64.log', text: truncated, mtime: 400 },   // 本次正在写
    { name: 'w44b-build-arm64.log', text: finished, mtime: 100 },  // 上轮已完成
    { name: 'w44b-build-x64.log', text: finished, mtime: 200 }     // 上轮已完成
  ])
  t('★负控：未跑完的日志**必须被剔除**（只留 2 份已跑完）', picked.length === 2, `picked=${picked.map(p => p.name).join(' ')}`)
  t('★负控：剔除后**按 mtime 取最近两份**（不按文件名字典序 —— 那是 W45 实测的假红根因）',
    picked[0].name === 'w44b-build-arm64.log' && picked[1].name === 'w44b-build-x64.log',
    `${picked.map(p => p.name).join(' ')}`)
  t('★零控：全都被剔除 ⇒ 返回空（调用方须 fail-closed，绝不用半截日志当真值）',
    pickTruthLogs([{ name: 'x.log', text: truncated, mtime: 1 }]).length === 0, '')

  // ---- ★★ W45 新增：**方向性**（构建期「声明 > 实测」无判据力 ⇒ 只出声不报红）----
  //   实测真形态：本轮新增 3 条闸门，§3.1 写 41 而最近**已完成**日志是上一轮的 38
  const rUp = compareClaims({ gates: 41, sentinel: 363, pCount: null, m4: null }, { gates: 38, sentinel: 363 }, { pCount: null, m4: null }, { gatesOneWay: true })
  t('★杠杆（单向口径）：声明 41 > 已完成日志 38 ⇒ **不报红**（本轮新增闸门是正常事，P-43）',
    rUp.problems.length === 0 && rUp.notes.length === 1, `problems=${rUp.problems.length} notes=${rUp.notes.length}`)
  t('★零控（单向口径）：声明 35 < 实测 38 ⇒ **仍报红**（这是确定的缺陷：文档漏记已有闸门）',
    compareClaims({ gates: 35, sentinel: 363, pCount: null, m4: null }, { gates: 38, sentinel: 363 }, { pCount: null, m4: null }, { gatesOneWay: true }).problems.length === 1, '')
  t('★杠杆反证（双向口径）：同一份声明 41 vs 38 ⇒ **报红**（证明单向不是把判据改废，只是收了方向）',
    compareClaims({ gates: 41, sentinel: 363, pCount: null, m4: null }, { gates: 38, sentinel: 363 }, { pCount: null, m4: null }, { gatesOneWay: false }).problems.length === 1, '')

  // ---- 负控：P 判据条数与索引不符 ----
  const r5 = compareClaims({ gates: null, sentinel: null, pCount: 48, m4: null }, { gates: null, sentinel: null }, { pCount: 49, m4: null })
  t('负控：P 判据「累计 48」vs 索引 49 ⇒ 报红', r5.problems.length === 1 && /P-1\/P-27/.test(r5.problems[0]), '')

  // ---- 负控：M4 项数不符 ----
  const r6 = compareClaims({ gates: null, sentinel: null, pCount: null, m4: { items: 142, missing: 0 } },
    { gates: null, sentinel: null }, { pCount: null, m4: { items: 169, missing: 0 } })
  t('负控：M4「142 项」vs 实测 169 ⇒ 报红', r6.problems.length === 1 && /M4/.test(r6.problems[0]), '')

  // ---- 零控：抽不到声明 ⇒ **只出声不报红**（守卫 P-38：不因「文档换了写法」误伤）----
  const r7 = compareClaims({ gates: null, sentinel: null, pCount: null, m4: null }, { gates: 38, sentinel: 363 }, { pCount: 49, m4: null })
  t('零控：抽不到声明 ⇒ 只出声、不报红（防过宽）', r7.problems.length === 0 && r7.notes.length >= 2,
    `problems=${r7.problems.length} notes=${r7.notes.length}`)

  // ---- 真实仓库（动态）----
  if (fs.existsSync(GOAL)) {
    const rc = extractBaselineClaims(fs.readFileSync(GOAL, 'utf8'))
    t('真实仓库：§3.1 抽到门禁条数与 sentinel', rc.gates !== null && rc.sentinel !== null,
      `gates=${rc.gates} sentinel=${rc.sentinel} pCount=${rc.pCount}`)
  } else t('真实仓库：找到 GOAL.md', false, GOAL)

  // ---- ★★ §八 验收（**W51 新增**）：E-C 的三条判据 ----
  //   样本形态取自 **W51 实测的原文**（修前）与修后
  const eCBefore = [
    '## 八、验收（E-A ~ E-H，达成时的定义）',
    '| **E-C** | **基线不劣化**：vitest ≥ 1786 通过 0 失败；typecheck 三段 0 错；**十三项门禁** exit 0；双架构 APK sentinel 一致 |',
    '## 九、已产出的设计哲学资产'
  ].join('\n')
  const eCAfter = [
    '## 八、验收（E-A ~ E-H，达成时的定义）',
    '| **E-C** | **基线不劣化**：vitest **0 失败**（当前 **1790 通过 / 2 skipped**）；typecheck **三段 0 错**；**构建期门禁** exit 0（当前 **48 条 `[gate] OK`**） |',
    '## 九、已产出的设计哲学资产'
  ].join('\n')
  // ① 代理阈值判据
  t('★负控（E-C 代理阈值）：原文「vitest ≥ 1786 通过」⇒ **必须报红**（P-41：锚到事实而非代理量）',
    eCThresholdProblem(eCBefore) !== null, String(eCThresholdProblem(eCBefore)))
  t('★正控（E-C 代理阈值）：修后「vitest 0 失败（当前 1790 通过）」⇒ **不得报红**',
    eCThresholdProblem(eCAfter) === null, String(eCThresholdProblem(eCAfter)))
  t('★杠杆（E-C 代理阈值）：只把阈值改回 ⇒ 结论翻转（证明上一条不是把判据改废）',
    eCThresholdProblem(eCAfter) === null && eCThresholdProblem(eCBefore) !== null, '')
  // ② 「N 项门禁」口径混用判据
  t('★负控（E-C 门禁措辞）：原文「**十三项门禁** exit 0」⇒ **必须报红**（分类数 ≠ 产出条数，P-1）',
    eCGatePhraseProblem(eCBefore, extractAcceptanceClaims(eCBefore), { gates: 48 }) !== null,
    String(eCGatePhraseProblem(eCBefore, extractAcceptanceClaims(eCBefore), { gates: 48 })))
  t('★正控（E-C 门禁措辞）：修后「48 条 `[gate] OK`」⇒ **不得报红**',
    eCGatePhraseProblem(eCAfter, extractAcceptanceClaims(eCAfter), { gates: 48 }) === null,
    String(eCGatePhraseProblem(eCAfter, extractAcceptanceClaims(eCAfter), { gates: 48 })))
  // ★★ 零控（W51 实测的假红形态）：「说明性引用」不得被判违规
  const eCExplanatory = [
    '## 八、验收',
    '| **E-C** | 构建期门禁 exit 0（当前 **48 条 `[gate] OK`**）—— ★ W51 修：原文写死「十三项门禁」= 把**装置分类数**当成了**产出条数**，两者不是一回事 |',
    '## 九、'
  ].join('\n')
  t('★★零控（说明性引用）：行内**讲「原文写死『十三项门禁』」**（在说「不要这样做」）⇒ **不得报红**（防假红，P-38）',
    eCGatePhraseProblem(eCExplanatory, extractAcceptanceClaims(eCExplanatory), { gates: 48 }) === null,
    String(eCGatePhraseProblem(eCExplanatory, extractAcceptanceClaims(eCExplanatory), { gates: 48 })))
  // ③ 同一事实两处两个值（E-C vs §3.1）
  t('★负控（E-C 与 §3.1 同源）：E-C 写 45 条而 §3.1 写 48 条 ⇒ **必须报红**（P-1：同一事实两处两个值）',
    eCGatePhraseProblem(
      '## 八、验收\n| **E-C** | 构建期门禁 exit 0（当前 **45 条 `[gate] OK`**） |\n## 九、',
      extractAcceptanceClaims('## 八、验收\n| **E-C** | 当前 **45 条 `[gate] OK`** |\n## 九、'),
      { gates: 48 }) !== null, '')
  t('★正控（E-C 与 §3.1 同源）：两处同为 48 条 ⇒ 不得报红',
    eCGatePhraseProblem(eCAfter, extractAcceptanceClaims(eCAfter), { gates: 48 }) === null, '')
  // ④ 抽取正控：能从 §八 抽出条数，且**不串到 §九**
  t('★正控（§八 抽取）：能从 §八 抽出「N 条 `[gate] OK`」，且不越界读到 §九',
    extractAcceptanceClaims(eCAfter).gates === 48 && extractAcceptanceClaims(eCBefore).gates === null,
    `after=${extractAcceptanceClaims(eCAfter).gates} before=${extractAcceptanceClaims(eCBefore).gates}`)
  // ⑤ 真实仓库：§八 必须可定位（定位不到 ⇒ 本组判据空转，P-30）
  if (fs.existsSync(GOAL)) {
    const gt = fs.readFileSync(GOAL, 'utf8')
    t('★真实仓库：§八 可定位（定位不到 ⇒ 本组判据**空转**）', gt.includes('## 八、验收') && gt.includes('## 九、'), '')
    t('★真实仓库：当前 §八 E-C **无**代理阈值写法（W51 已修）', eCThresholdProblem(gt) === null, String(eCThresholdProblem(gt)))
    const acc = extractAcceptanceClaims(gt)
    const base = extractBaselineClaims(gt)
    t('★真实仓库：§八 E-C 的门禁条数（若有）与 §3.1 **同源**', eCGatePhraseProblem(gt, acc, base) === null, String(eCGatePhraseProblem(gt, acc, base)))
  }

  // ---- ★★ ⑥ 会增长的读数不得写成硬常量（**W57 建 · W58 扩**）----
  //   由头：§3.2 第 3 项与 §六 B10 写死「路由 **67 条**」（实测 68）；
  //   README「能做什么」写死「**32 本地** / **71 项记名 stub**」（实测 **34** / **81**）⇒ 全部 P-27。
  const rcBefore = '| 3 | `scripts/audit-route-contract.mjs` | 路由契约（**67 条**，0 违约） |'
  const rcAfter = '| 3 | `scripts/audit-route-contract.mjs` | 路由契约（**0 违约**；当前实测 **68 个唯一路由**，以脚本输出为准） |'
  t('★负控（路由条数写死）：写「路由契约（**67 条**）」⇒ **必须报红**（P-27/P-41）',
    growthReadingHardcodeProblems(rcBefore).length === 1, JSON.stringify(growthReadingHardcodeProblems(rcBefore)))
  t('★正控（路由条数写死）：写「当前实测 **68 个唯一路由**，以脚本输出为准」⇒ **不得报红**',
    growthReadingHardcodeProblems(rcAfter).length === 0, JSON.stringify(growthReadingHardcodeProblems(rcAfter)))
  t('★杠杆（路由条数写死）：仅把「67 条」改成带「当前实测」的写法 ⇒ **结论翻转**（证明不是把判据改废）',
    growthReadingHardcodeProblems(rcBefore).length === 1 && growthReadingHardcodeProblems(rcAfter).length === 0, '')
  // ★ 零控：B10 形态（同一事实写在边界表里）也必须被覆盖
  t('★零控（B10 形态）：边界表里写「路由 67 条」⇒ **必须报红**（同一语义的两个区段都要守，P-58）',
    growthReadingHardcodeProblems('| **B10** | **不改变既有对外契约**（路由 67 条、slots 42 个） |').length === 1, '')
  // ---- ★★ W58 新增的三条控：README 的 TH API 面形态 ----
  const thBefore = '| **酒馆助手（JS-Slash-Runner）** | 73 个 API（32 本地 + 41 桥接）、`tavern_events` 82 项全表 |'
  t('★负控（W58 · TH API 面写死）：写「73 个 API（32 本地 + 41 桥接）」⇒ **必须报红**（实测 34+41=75）',
    growthReadingHardcodeProblems(thBefore).length === 1, JSON.stringify(growthReadingHardcodeProblems(thBefore)))
  t('★负控（W58 · 记名 stub 写死）：写「71 项记名 stub」⇒ **必须报红**（实测 81）',
    growthReadingHardcodeProblems('| **Tier 2** | TH 长尾 API（71 项记名 stub 之外的增量） |').length === 1, '')
  // ★★ 零控（W58 建 · ★ W64 修正口径）：**「有机器守的读数允许写死」** —— 但「有守」必须
  //   **点名到能跑到的通路**上。★★ W64 实测：原控把**错误口径**（只要点名某个脚本就豁免）
  //   **固化成了期望值** —— 而 `audit-card-event-surface.mjs` **在构建期零引用**（从不跑）。
  //   ⇒ 与 W31 的 S2「空集合 ⇒ 期望绿」是**同一个坑**（把假绿写成判据的期望）。
  //   ★ 注意样本形态：必须用**真的会命中 `forms` 的写法**（`N 个 API`），
  //     不能用「82 项全表」（`项` 后须跟 `stub` 才命中）—— 否则控会**空转**（P-30）。
  const GATES = new Set(['audit-route-contract.mjs', 'audit-baseline-claims.mjs'])
  t('★★零控（W64 · 通路正确才豁免）：由 **vitest 规格**断言 ⇒ **不得报红**',
    growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 vitest 规格 `th-script-runtime.spec.ts` 断言） |',
      { gateNames: GATES }).length === 0, '')
  t('★★零控（W64 · 通路正确才豁免）：由**构建期闸门**（在名单里）断言 ⇒ **不得报红**',
    growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 `audit-route-contract.mjs` 断言） |',
      { gateNames: GATES }).length === 0, '')
  t('★★负控（W64 · 装置不在跑 ⇒ 不豁免）：`audit-card-event-surface.mjs`**不在构建脚本里** ⇒ **必须报红**',
    growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 `audit-card-event-surface.mjs` 断言） |',
      { gateNames: GATES }).length === 1,
    JSON.stringify(growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 `audit-card-event-surface.mjs` 断言） |', { gateNames: GATES })))
  t('★杠杆（W64 · 只补「通路」二字即转绿）：同一行加「vitest」⇒ **结论翻转**（证明收窄不是把判据改废）',
    growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 `audit-card-event-surface.mjs` 断言） |',
      { gateNames: GATES }).length === 1
    && growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（★ 有机器守：由 vitest 规格断言） |',
      { gateNames: GATES }).length === 0, '')
  // ★★ 正控（W64 · 自足读数词不要求通路）：「当前实测 / 以源码为准」自身就够
  t('★正控（W64 · 自足读数词）：写「当前实测 **75**，以源码为准」⇒ **不得报红**（无需点名装置）',
    growthReadingHardcodeProblems('| **酒馆助手** | 75 个 API（当前实测，以源码为准） |', { gateNames: GATES }).length === 0, '')
  // ★★ 零控（W58 实测的假红形态）：「说明性引用」不得被判违规
  //   我在 README 里写「★ W57 修：原文写死『路由 **67 条**』而实测 68」——
  //   那是**在讲「不要这样做」**，被命中 = **假红**（P-38/P-52 同源纪律）。
  t('★★零控（说明性引用）：行内讲「原文写死『路由 67 条』而实测 68」⇒ **不得报红**（防假红，P-38）',
    growthReadingHardcodeProblems('> ★ W57 修：原文写死「路由 **67 条**」而实测 **68**，该数从未被机器核过').length === 0,
    JSON.stringify(growthReadingHardcodeProblems('> ★ W57 修：原文写死「路由 **67 条**」而实测 **68**')))
  // ★★ 零控（**W62 实测的假红**）：**引号包裹的「引述」**不得被判为当前声明
  //   实测形态：一条 P 判据的定义行里写「…**与 W57「路由 67 条」同形**（P-30）…」
  //   —— 那是**引述史实**（说明「同类缺陷长什么样」）。★ 与上一条不同：这里**行内没有**
  //   「原文写死 / 修」这类说明词，靠的是**引号包裹**这一形式特征。
  //   ★ 判据必须**就近判片段**（`m[0]` 前后各一个字），**不得整行判**（否则会把
  //     「行内别处的真声明」一起豁免 —— W51/W60 踩过两次的坑）。
  t('★★零控（W62 · 引述 vs 声明）：`与 W57「路由 67 条」同形`（**引号包裹的引述**）⇒ **不得报红**',
    growthReadingHardcodeProblems('其后果与 W57 抓到的「路由 67 条」**同形**（P-30：失效与通过同貌）').length === 0,
    JSON.stringify(growthReadingHardcodeProblems('其后果与 W57 抓到的「路由 67 条」**同形**')))
  t('★正控（W62 · 就近判不等于整行豁免）：同一行里**另有未加引号的真声明** ⇒ **必须仍报红**',
    growthReadingHardcodeProblems('对比 W57 的「路由 67 条」，本行才是真声明：路由 68 条').length === 1,
    JSON.stringify(growthReadingHardcodeProblems('对比 W57 的「路由 67 条」，本行才是真声明：路由 68 条')))
  if (fs.existsSync(GOAL)) {
    const gt2 = fs.readFileSync(GOAL, 'utf8')
    t('★真实仓库：当前 GOAL **无**写死的路由条数（W57 已修）',
      growthReadingHardcodeProblems(gt2).length === 0, JSON.stringify(growthReadingHardcodeProblems(gt2)))
  } else {
    t('★真实仓库：找不到 GOAL ⇒ 本组判据**未生效**（出声，不当通过）', false, GOAL)
  }
  // ---- ★★ W59：**同一族的读数写在别处**（P-58 的第三次现身）----
  //   由头：W58 修完 README，W59 换语义不变量后又在 `docs/V0.3-FREEZE.md`（对外承诺的**冻结文档**！）
  //   与 `TASK-LIST.md` 抓到同一族读数 ⇒ 受守面必须**按语义枚举成表**（`READING_DOCS`）。
  t('★负控（W59 · V0.3-FREEZE 形态）：写「71 个 API（28 本地 + 43 桥接）」⇒ **必须报红**（实测 34+41=75）',
    growthReadingHardcodeProblems('- 酒馆助手基本盘：71 个 API（28 本地 + 43 桥接）、tavern_events 82 项全表。').length === 1,
    JSON.stringify(growthReadingHardcodeProblems('- 酒馆助手基本盘：71 个 API（28 本地 + 43 桥接）')))
  t('★负控（W59 · `约 N 项已记名 stub` 形态）：⇒ **必须报红**（实测 81 项）',
    growthReadingHardcodeProblems('- TH 长尾 API（约 50 项已记名 stub 之外的增量）。').length === 1,
    JSON.stringify(growthReadingHardcodeProblems('- TH 长尾 API（约 50 项已记名 stub 之外的增量）')))
  t('★正控（W59 · 读数形态）：写「条数以源码为准 / 以源码为准」⇒ **不得报红**',
    growthReadingHardcodeProblems('- TH 长尾 API（**记名 stub 名单之外**，条数以源码为准）。').length === 0, '')
  // ★ 真实仓库：四份受守文档都要在扫描面内（否则「守住」是假的）
  for (const [p, label] of [[GOAL, 'GOAL.md'], [path.join(WS, '..', 'README.md'), 'README.md'],
    [path.join(WS, '..', 'docs', 'V0.3-FREEZE.md'), 'docs/V0.3-FREEZE.md'],
    [path.join(WS, '..', 'TASK-LIST.md'), 'TASK-LIST.md']]) {
    if (fs.existsSync(p)) {
      t(`★真实仓库（${label}）：读数写死检查 **0 违规**（W57-W59 已修）`,
        growthReadingHardcodeProblems(fs.readFileSync(p, 'utf8')).length === 0,
        JSON.stringify(growthReadingHardcodeProblems(fs.readFileSync(p, 'utf8'))))
    } else {
      t(`★真实仓库（${label}）：找不到该文档 ⇒ 该面**未生效**（出声，不当通过，守 P-43）`, false, p)
    }
  }

  // ---- ★★ W60：**契约面读数 `slots N 个` 必须与快照一致** ----
  //   由头：B10 里与「路由 N 条」**并列**的另一个读数 —— 路由那半 W57 已守，
  //   而 `slots 42 个` **从未被任何机器核过**（全仓只有手工 CLI 读快照）⇒ **P-60 在同一行内的形态**。
  //   ★ 与 W57~W59 的关键差别：**这里的 42 是「正确但无人守」** ⇒ 修法不是改成读数形态，
  //     而是**给它装上机器守**（保留具体数字，一旦不符就报红）。
  const SLOTS_OK = path.join(TMP, 'w60-slots-ok.json')
  const SLOTS_BAD = path.join(TMP, 'w60-slots-selfcontradict.json')
  const SLOTS_MISSING = path.join(TMP, 'w60-slots-does-not-exist.json')
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })
  fs.writeFileSync(SLOTS_OK, JSON.stringify({ total: 42, slots: new Array(42).fill(0) }), 'utf8')
  // ★ 自洽性负控样本：total 与数组长度矛盾（属快照自身的真缺陷）
  fs.writeFileSync(SLOTS_BAD, JSON.stringify({ total: 42, slots: new Array(41).fill(0) }), 'utf8')
  const b10Ok = '| **B10** | **不改变既有对外契约**（路由（当前实测 **68 个唯一路由**）、slots 42 个、wire 契约、slot id） |'
  const b10Stale = '| **B10** | **不改变既有对外契约**（路由（当前实测 **68 个唯一路由**）、slots 41 个、wire 契约、slot id） |'
  t('★正控（W60 · slot 数一致）：声明 `slots 42 个` 而快照实测 42 ⇒ **不得报红**',
    slotCountProblems(b10Ok, SLOTS_OK).problems.length === 0,
    JSON.stringify(slotCountProblems(b10Ok, SLOTS_OK)))
  t('★负控（W60 · slot 数过期）：声明 `slots 41 个` 而快照实测 42 ⇒ **必须报红**（P-27）',
    slotCountProblems(b10Stale, SLOTS_OK).problems.length === 1,
    JSON.stringify(slotCountProblems(b10Stale, SLOTS_OK).problems))
  t('★负控（W60）：报红**同时**说出声明值与实测值',
    /41/.test(slotCountProblems(b10Stale, SLOTS_OK).problems[0] ?? '') &&
    /42/.test(slotCountProblems(b10Stale, SLOTS_OK).problems[0] ?? ''), '')
  t('★杠杆（W60 · P-20）：仅把声明的数改成与快照一致 ⇒ **结论翻转**（证明不是把判据改废）',
    slotCountProblems(b10Stale, SLOTS_OK).problems.length === 1 &&
    slotCountProblems(b10Ok, SLOTS_OK).problems.length === 0, '')
  t('★★零控（W60 · P-43）：快照缺失 ⇒ **只出声不报红**（换机/CI 可能没采集过）',
    slotCountProblems(b10Stale, SLOTS_MISSING).problems.length === 0 &&
    slotCountProblems(b10Stale, SLOTS_MISSING).notes.length === 1,
    JSON.stringify(slotCountProblems(b10Stale, SLOTS_MISSING).notes))
  t('★★零控（W60 · 快照自洽）：快照里 `total=42` 而 `slots` 数组 41 项 ⇒ **必须报红**（快照自身不可信）',
    slotCountProblems(b10Ok, SLOTS_BAD).problems.some(p => /自相矛盾/.test(p)),
    JSON.stringify(slotCountProblems(b10Ok, SLOTS_BAD).problems))
  t('★零控（W60 · 抽不到声明 ⇒ 本判据未生效）：文档里没有「slots N 个」⇒ 只出声（不当通过）',
    slotCountProblems('| **B10** | 不改变既有对外契约 |', SLOTS_OK).problems.length === 0 &&
    slotCountProblems('| **B10** | 不改变既有对外契约 |', SLOTS_OK).notes.some(n => /未生效/.test(n)), '')
  // ★★ 零控（W60 实测逼出的口径）：**长表格行**里前半句讲别的数字的历史 ⇒ 后半句的 slots 声明**必须仍被抽到**
  //   （首版按**整行**排除说明语境 ⇒ 该行被整行豁免 ⇒ `claimed=null` ⇒ 判据静默不生效，P-45 形态）
  const b10LongRow = '| **B10** | **不改变既有对外契约**（路由（当前实测 **68 个唯一路由**，见 §3.2 第 3 项；'
    + '★ **W57 修**：原文写死「路由 67 条」是 **P-27 过期声明**，实测已 68）、slots 41 个、wire 契约、slot id） |'
  t('★★零控（W60 · 排除窗口不得整行判）：行内前半句讲路由的历史 ⇒ 后半句 `slots 41 个` **必须仍被抽到并报红**',
    slotCountProblems(b10LongRow, SLOTS_OK).claimed === 41 &&
    slotCountProblems(b10LongRow, SLOTS_OK).problems.length === 1,
    JSON.stringify(slotCountProblems(b10LongRow, SLOTS_OK)))
  t('★★零控（W60 · 说明语境仍须排除）：`原文写死「slots 41 个」`（**紧邻**说明）⇒ 不得算作声明',
    slotCountProblems('> ★ W60 修：原文写死「slots 41 个」而实测 42；现行声明见 §六 B10：slots 42 个', SLOTS_OK).claimed === 42,
    String(slotCountProblems('> ★ W60 修：原文写死「slots 41 个」而实测 42；现行声明见 §六 B10：slots 42 个', SLOTS_OK).claimed))
  // ★ W60 · 快照自动发现（**不得写死版本目录名** —— 那会在官方升级后静默失效，P-30）
  const snapReal = findSlotsSnapshot(path.join(WS, 'contracts'))
  t('★真实仓库（W60）：能在 `contracts/` 下自动发现权威 slot 快照',
    snapReal !== null && fs.existsSync(snapReal), String(snapReal))
  t('★真实仓库（W60）：**B10 声明的 slot 数 == 快照实测**（否则报红）',
    snapReal !== null && slotCountProblems(fs.readFileSync(GOAL, 'utf8'), snapReal).problems.length === 0,
    JSON.stringify(snapReal ? slotCountProblems(fs.readFileSync(GOAL, 'utf8'), snapReal).problems : 'no-snap'))
  for (const f of [SLOTS_OK, SLOTS_BAD]) { try { fs.unlinkSync(f) } catch { /* 清理失败不影响判定 */ } }

  // ★ 单源输出契约（W44 建立）：分数行**只由** selftest-summary.mjs 产出。
  //   ★★ 为什么本行**必须**用契约（W45 实测的真缺陷）：首版本文件收尾仍是旧形态
  //   `[selftest] PASS（16/16）`（`N/M` 在后、且无契约前缀）⇒ `audit-selftest-claims.mjs`
  //   **读不出分数行** ⇒ 报「声明无法被证伪」。这正是 W44 契约存在的理由：
  //   **新装置自己也会踩这个坑**（P-1：格式串不许各脚本手抄）。
  const okAll = fail === 0
  reportSelftest('baseline-claims', total - fail, total)
  process.exit(okAll ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }

  // ★ `--file <path>`（W45 加）：供**真实仓库负控**在**临时副本**上演练
  //   —— 见 `audit-baseline-claims-negctl.mjs` 头注：负控**全程不碰真实 GOAL**，
  //     从结构上消除「注入残留」这一整类风险（W44 的教训，P-48 的更强形态）。
  const fi = process.argv.indexOf('--file')
  const goalPath = fi >= 0 && process.argv[fi + 1] ? process.argv[fi + 1] : GOAL
  if (!fs.existsSync(goalPath)) { console.error(`✗ 找不到 ${goalPath}`); process.exit(2) }
  // ★ `--readme <path>`（**W58 加**）：供负控在 README 的**临时副本**上演练
  //   —— 与 `--file` 同法（P-48 的最强形态：能不改真实文件就不改）。
  //   ★ 为什么需要它：README 的 TH API 面条数**也**在被守（**P-58**：同一语义写在两份文档 ⇒ 两处都要守），
  //     而负控必须能对**README 副本**注入坏样本，否则 README 那一半**无法被负控**（**P-1**）。
  const ri = process.argv.indexOf('--readme')
  const readmePath = ri >= 0 && process.argv[ri + 1] ? process.argv[ri + 1] : path.join(WS, '..', 'README.md')
  // ★ `--freeze <path>` / `--tasklist <path>`（**W59 加**）：同 `--readme` 之法 ——
  //   W59 把受守面扩到这两份文档（**同一族的读数写在别处**，P-58），
  //   而**负控必须能对它们的副本注入**，否则那两个面**无法被负控**（**P-1**：注入点必须落在判据的扫描面上）。
  const fi2 = process.argv.indexOf('--freeze')
  const freezePath = fi2 >= 0 && process.argv[fi2 + 1] ? process.argv[fi2 + 1] : path.join(WS, '..', 'docs', 'V0.3-FREEZE.md')
  const ti = process.argv.indexOf('--tasklist')
  const tasklistPath = ti >= 0 && process.argv[ti + 1] ? process.argv[ti + 1] : path.join(WS, '..', 'TASK-LIST.md')

  // 真值来源 ①：**最近两份「已跑完」的构建日志**（P-27：用实测，不用推算）
  //   ★★ W45 实测的真缺陷：首版按**文件名字典序**取最近两份 ⇒ 取到了
  //     「上次失败」+「本次正在写入」的日志（只有 30/31 条 gate）⇒ **假红**。
  //     修法两道：⑴ **只认已跑完的日志**（`[完成] DSH …` 收尾标志）；
  //              ⑵ **按 mtime 排序**（不按文件名字典序 —— 名字的排序与时间无关）。
  const allLogs = fs.existsSync(TMP)
    ? fs.readdirSync(TMP).filter(f => /build.*\.log$/i.test(f))
        .map(f => {
          const p = path.join(TMP, f)
          return { name: f, text: fs.readFileSync(p, 'utf8'), mtime: fs.statSync(p).mtimeMs }
        })
    : []
  const picked = pickTruthLogs(allLogs)
  if (picked.length === 0) {
    console.error('✗ 找不到任何「已跑完」的构建日志（tmp/*build*.log 里需含 `[完成] DSH …`）'
      + `\n  ⇒ 无法核对门禁条数与 sentinel ⇒ **fail-closed**（绝不用半截日志当真值 —— 那会报假红，W45 实测）`)
    process.exit(2)
  }
  if (allLogs.length > picked.length) {
    console.log(`  ⓘ 已忽略 ${allLogs.length - picked.length} 份**未跑完/失败**的日志（无 \`[完成] DSH\` 收尾标志）`)
  }
  const truths = picked.map(t => ({ file: t.name, ...readBuildLogTruth(t.text) }))
  console.log(`[基线] 真值来源（构建日志）：${truths.map(t => `${t.file} 门禁=${t.gates} sentinel=v${t.sentinel}`).join(' · ')}`)

  // 真值来源 ②：§九 索引行数（与 audit-goal-sections 判据 ⑦b 同口径）
  //   ★ 索引**始终读真实 GOAL**（它不受注入影响，且副本里若改了它就不是「基线数字」问题了）
  const gtext = fs.readFileSync(GOAL, 'utf8')
  const i9 = gtext.indexOf('## 九、'); const i10 = gtext.indexOf('## 十、')
  let pCount = null
  if (i9 >= 0 && i10 > i9) {
    const seg = gtext.slice(i9, i10)
    pCount = (seg.match(/^\|\s*\*{0,2}P-\d+\*{0,2}\s*\|/gm) || []).length
  }

  const claims = extractBaselineClaims(fs.readFileSync(goalPath, 'utf8'))
  // ★ 用**两份日志的并集**取真值：任一为 null 则不核该项（守 P-43：无判据力不判）
  const logTruth = {
    gates: truths.every(t => t.gates !== null) ? Math.max(...truths.map(t => t.gates)) : null,
    sentinel: truths.every(t => t.sentinel !== null)
      ? (new Set(truths.map(t => t.sentinel)).size === 1 ? truths[0].sentinel : null)
      : null
  }
  if (truths.some(t => t.gates !== null) && new Set(truths.filter(t => t.gates !== null).map(t => t.gates)).size > 1) {
    console.log(`  ⓘ 两份日志的门禁条数不同（${truths.map(t => t.gates).join(' / ')}）⇒ 用最大值；若差异是「新增/删除闸门」，请确认两份都重建过`)
  }

  // ★★ `--strict-two-way`（W45 加）：**构建完成后**的人工复核用双向比对。
  //   默认（构建期）**单向**：只报「声明 < 实测」（确定的缺陷），不报「声明 > 实测」
  //   —— 因为构建期看到的已完成日志**一定是上一轮的**，本轮新增闸门会让声明数变大，
  //   那是**正常**的而非过期（P-43 / P-40③，详见 `compareClaims` 头注）。
  const strictTwoWay = process.argv.includes('--strict-two-way')
  // ★★ **W63：把 M4 真值接进比对**（此前硬编码 `m4: null` ⇒ 判据 ④ 从不生效）。
  //   真值 = **两份已完成日志里的 M4 读数行**的并集：`items` 取**最小值**、`missing` 取**最大值**
  //   （**保守口径**：任一包少了标记 / 多了缺失，都算「不符」）。
  //   ★ 与 gates/sentinel **同一取真值纪律**（P-1：同一语义一处读法）。
  const m4Truth = truths.every(t => t.m4 !== null)
    ? {
        items: Math.min(...truths.map(t => t.m4.items)),
        missing: Math.max(...truths.map(t => t.m4.missing))
      }
    : null
  if (m4Truth === null && truths.some(t => t.m4 !== null)) {
    console.log(`  ⓘ 只有部分日志含 M4 读数行（${truths.map(t => t.m4 ? `${t.m4.items}/${t.m4.missing}` : '—').join(' / ')}）⇒ M4 该项**不核**（P-43：无判据力不判）`)
  }
  const { problems, notes } = compareClaims(claims, logTruth, { pCount, m4: m4Truth }, { gatesOneWay: !strictTwoWay })
  console.log(`[基线] §3.1 声明：门禁=${claims.gates} sentinel=v${claims.sentinel} P判据=${claims.pCount}`
    + ` M4=${claims.m4 ? `${claims.m4.items}/${claims.m4.missing}` : '—'}`
    + ` · 真值：门禁=${logTruth.gates} sentinel=v${logTruth.sentinel} P判据=${pCount}`
    + ` M4=${m4Truth ? `${m4Truth.items}/${m4Truth.missing}` : '—'}`
    + `（方向：${strictTwoWay ? '双向' : '**单向**——构建期不报「声明 > 实测」，见头注 P-43/P-40③'}）`)
  for (const n of notes) console.log(`  ⓘ ${n}`)

  // -------------------------------------------------------------------------
  // ★★ **W66 新增：日志读数 vs 文档写死数字的对账**（P-62 的「接线 ≠ 消费」形态）
  //   由头：W62 把读数行进日志从 3 条扩到 12 条（**接线做完了**），
  //   而本轮问「接进日志之后有人**消费**它吗」⇒ **一个都没有**：
  //   把 §3.1 的 `TARGETS 9 项` / §3.2 的「实读 7 条」等**改坏**，**5 个闸门全部 exit=0**
  //   （见 `tmp/w66-decisive.mjs` / `w66-load.mjs` / `w66-why.mjs`）。
  //   ⇒ 读数有观测面却无人读 ⇒ 与文档数字**照样静默脱钩**（**P-30**）。
  //   ★ 真值来源与上文**同源**（`picked` 里的完整日志文本）—— 守 **P-1**，不另开脚本。
  //   ★ 结果**并入 §八 段的 `acProblems`**（同一层职责：文档数字 vs 机器真值；P-1）——
  //     故本段必须写在 `acProblems` **声明之后**（TDZ 教训，见 W41 的同类坑）。
  // -------------------------------------------------------------------------
  //   ★ 文档文本只读一次（P-1）：本段与 §八 判据**共用同一份**。
  //   ★ 声明提前到本段之前（TDZ 教训 —— W41 同类坑：`acProblems` 先在 §八 段声明，
  //     而本段要用它 ⇒ 写成 `{ … }` 块也救不了 `const` 的 TDZ）。
  const goalTextForAccept = fs.readFileSync(goalPath, 'utf8')
  const acProblems = []
  {
    const readingsTruth = readReadingValues(picked.map(t => t.text).join('\n'))
    const rv = readingVsDocProblems(goalTextForAccept, readingsTruth)
    for (const p of rv.problems) acProblems.push(p)
    for (const n of rv.notes) console.log(`  ⓘ ${n}`)
    console.log(`[基线] 日志读数 vs 文档数字：比对 ${READING_PAIRS.length} 项（`
      + READING_PAIRS.map(p => `${p.id}=${readingsTruth[p.id] ?? '—'}`).join(' · ')
      + `）· 违规 ${rv.problems.length} 处`)
  }

  // -------------------------------------------------------------------------
  // ★★ **§八 验收（W51 新增）**：E-C 是 §八 唯一含可核对数字的一条 ——
  //   而 W51 实测「**§八 从未被任何闸门扫过**」（§一/§二/§四 是纯定义，合理无守）。
  //   ★ 复用**同一真值来源**（构建日志 / §3.1 声明）—— 守 P-1，不另开脚本。
  // -------------------------------------------------------------------------
  const accept = extractAcceptanceClaims(goalTextForAccept)
  const t1 = eCThresholdProblem(goalTextForAccept)
  if (t1) acProblems.push(t1)
  const t2 = eCGatePhraseProblem(goalTextForAccept, accept, claims)
  if (t2) acProblems.push(t2)
  // E-C 若声明了门禁条数 ⇒ 必须与**实测真值**一致（与 §3.1 同口径、同真值，P-1）
  if (accept.gates !== null && logTruth.gates !== null && accept.gates !== logTruth.gates) {
    // ★ 构建期同样**单向**（理由与 §3.1 完全相同：本轮新增闸门会让声明变大，那是正常的）
    if (strictTwoWay || accept.gates < logTruth.gates) {
      acProblems.push(`§八 E-C 声明门禁 **${accept.gates} 条**，而构建日志实为 **${logTruth.gates} 条** ⇒ 过期声明（P-27）`)
    }
  }
  console.log(`[验收] §八 声明门禁条数=${accept.gates} · 真值=${logTruth.gates} · 违规 ${acProblems.length} 处`)

  // -------------------------------------------------------------------------
  // ★★ **契约条数不得写死**（**W57 建 · W58 扩到 README 的 TH API 面**）
  //    纯函数见 `growthReadingHardcodeProblems` 头注（含「有机器守的读数允许写死」的分流纪律）
  // -------------------------------------------------------------------------
  // ★★ **W64：`gateNames` = 实读构建脚本得到的「真会跑的闸门名单」**（P-27：不硬编码）
  //   用途：`growthReadingHardcodeProblems` 判断「豁免所依据的装置**会不会被跑到**」——
  //   只有名字出现在 `build-dsht.ps1` 里的闸门才算（或行内显式点名 vitest 通路）。
  const gateNames = new Set(
    [...fs.readFileSync(path.join(WS, 'scripts', 'build-dsht.ps1'), 'utf8')
      .matchAll(/(?:audit|verify)-[\w-]+\.(?:mjs|py)/g)].map(m => m[0]))
  const routeClaimProblems = growthReadingHardcodeProblems(fs.readFileSync(goalPath, 'utf8'), { gateNames })
  for (const p of routeClaimProblems) acProblems.push(p)
  // ★ W58：**README 也在扫描面内**（按 P-58：同一语义的声明写在两个文档 ⇒ 两处都要守）。
  //   ★ 为什么必须加：缺陷**同时在两份文档里**（GOAL 的「路由 67 条」+ README 的「32 本地 / 71 项 stub」），
  //   只守 GOAL 会让 README 那一半**永远无人守**（W58 实测：README 的 32/71 全部过期而无人察觉）。
  // ★★ **W59：扫描面做成显式文档表**（P-58 纪律②「受守区必须按语义枚举」）——
  //   由头：W58 只扩到 README，而 **W59 换语义不变量后又在 `docs/V0.3-FREEZE.md`（对外承诺的冻结文档！）
  //   与 `TASK-LIST.md` 里抓到同一族的三个读数**（`71 个 API（28 本地 + 43 桥接）` / `约 50 项已记名 stub`）。
  //   ⇒ 与 W53 给 `audit-rule-claims.mjs` 做 `SCAN_SECTIONS` 表**同法**：新增受守文档只需加一行，
  //     而不是再写一段 if。★ 各文档的**豁免口径**也可按文档声明（史实区用行级说明语境排除）。
  const READING_DOCS = [
    { path: goalPath, label: 'GOAL.md' },   // ★ 用 goalPath（支持 `--file` 副本 —— 负控必须能注入）
    { path: readmePath, label: 'README.md' },
    // ★ W59 新增两个受守文档（**同一族的读数写在别处** ⇒ 按 P-58 必须一并守）
    { path: freezePath, label: 'docs/V0.3-FREEZE.md' },
    { path: tasklistPath, label: 'TASK-LIST.md' }
  ]
  let readmeProblems = []
  const docProblems = []
  for (const d of READING_DOCS) {
    if (!fs.existsSync(d.path)) {
      // ★ **fail-closed 的反面：出声但不当通过**（P-43：换机/CI 可能无此文档）
      console.log(`  ⓘ 找不到 ${d.label} ⇒ 该面的读数写死检查**未生效**（出声，不当通过）`)
      continue
    }
    const probs = growthReadingHardcodeProblems(fs.readFileSync(d.path, 'utf8'), { gateNames })
    for (const p of probs) docProblems.push(`${d.label} ${p}`)
    if (d.label === 'README.md') readmeProblems = probs
    console.log(`[契约] ${d.label} 读数写死检查：违规 ${probs.length} 处`)
  }
  for (const p of docProblems) acProblems.push(p)
  console.log(`[契约] 路由条数写死检查：违规 ${routeClaimProblems.length} 处（不变式 = 0 违约；条数是读数不是常量）`)

  // -------------------------------------------------------------------------
  // ★★ **契约面读数 `slots N 个` 必须与快照一致**（**W60 新增**）
  //    由头：B10 里与「路由 N 条」**并列**的另一个读数 —— 路由那半 W57 已守，
  //    `slots 42 个` 这半**从未被任何机器核过**（只有手工 CLI 读快照）⇒ P-60 在同一行内的形态。
  //    ★ 与 W57~W59 的关键差别：这里的 **42 是「正确但无人守」** ⇒ 修法不是改成读数形态，
  //      而是**给它装上机器守**（保留具体数字，一旦不符就报红）。
  // -------------------------------------------------------------------------
  const slotsSnap = findSlotsSnapshot(path.join(WS, 'contracts'))
  const goalTextForSlots = fs.readFileSync(goalPath, 'utf8')
  const sc = slotsSnap
    ? slotCountProblems(goalTextForSlots, slotsSnap)
    : { problems: [], notes: ['找不到任何契约快照（contracts/*/slots.json）⇒ slot 数无法核对（只出声不报红，守 P-43）'], claimed: null, actual: null }
  for (const p of sc.problems) acProblems.push(p)
  for (const n of sc.notes) console.log(`  ⓘ ${n}`)
  console.log(`[契约] slot 数核对：声明=${sc.claimed} 实测=${sc.actual} 快照=${slotsSnap ? path.relative(WS, slotsSnap) : '（无）'} 违规 ${sc.problems.length} 处`)

  if (acProblems.length === 0) {
    console.log('[验收] OK —— §八 E-C 不含「代理阈值」写法，且其门禁条数（若有）与实测一致')
    if (problems.length === 0) process.exit(0)
  } else {
    for (const p of acProblems) console.log(`[验收] ✗ ${p}`)
  }

  if (problems.length === 0 && acProblems.length === 0) {
    console.log('[基线] OK —— §3.1 的可核对数字与实测一致（vitest/typecheck/M7 不在此核，见头注 R7 边界）')
    process.exit(0)
  }
  for (const p of problems) console.log(`[基线] ✗ ${p}`)
  console.log(`\n[基线] 共 ${problems.length + acProblems.length} 处过期（基线表是「什么算坏」的定义，错数字会误导整轮判断）`)
  process.exit(1)
}
