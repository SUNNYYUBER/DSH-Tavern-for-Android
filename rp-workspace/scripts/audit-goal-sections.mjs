#!/usr/bin/env node
/**
 * audit-goal-sections.mjs —— **GOAL.md §十一「当前工作面」三张表的结构完整性闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * `GOAL.md` §十一（§11.1 立刻可做 / §11.2 须真机 / §11.3 长期持续）是「**当前在做哪几件事**」
 * 的 SSOT，且是**每轮必改**的动态区。改动越频繁，**结构被写坏的概率越高** —— 而结构坏掉的
 * 后果是**静默的**：GFM 会照常渲染，只是内容少了一列 / 编号指错了对象。
 *
 * ## 为什么必须常驻（P-11 元级 · 本轮 W42 的真实事故）
 * 本轮（W42）一次编辑后，§十一 同时存在三类结构损坏，**全都没有任何机器守着**：
 *   ① ★ **列数错位（静默丢信息）**：§11.3 的表头是 **3 列**（`| # | 工作面 | 说明 |`），
 *      而表内 **6 行**是按 §11.1 的 **4 列**模板写的（`| # | 工作面 | 轨道 | 状态 |`）。
 *      GFM 对多出的单元格**不报错、不提示**，直接**丢弃** ⇒ 「轨道」「状态」两列**根本不渲染**。
 *      危害不是「不好看」：`✅` 这类收口标记**读者看不到**，会误以为该工作面还没做（P-27）。
 *   ② ★ **跨表编号复用（引用歧义）**：`W10` 在 §11.1 指「A15 闸门盲区排查」、在 §11.2 指
 *      「L4 proot 生存性」—— **两件毫不相干的事共用一个编号**。后果：任何人（含未来的 AI）
 *      引用「W10」时**无法确定指哪一个**（P-1：同一标识只许一处定义）。
 *      根因是一行一列被写成两套编号体系（§11.2 用的是矩阵残余格编号、§11.1/§11.3 用工作面序号）。
 *   ③ **重复登记**：`W36 续` 在 §11.1 与 §11.3 **各记一条**（同一轮同一件事）——
 *      两条都真，但读者要读两遍才能确认是同一件事，且两条会**各自过期**（P-27 双向误导）。
 *
 * ## 判据（静态扫 GOAL.md，**八条** + 一项提示）
 *   ① **三张表都可解析**：表头与数据行都切得出（切不出 / 行数过少 ⇒ **fail-closed**，
 *      不许静默当「0 违规」—— 判据切面失效时输出与通过**完全相同**，这是 P-30 的核心教训）；
 *   ② **三表数据行总数不得低于基线**（防「整段被静默删掉」；**下限不是精确值** ——
 *      新增工作面不违规。这是 **P-46 推论二**「项数变了本身就是判据」的落地）；
 *   ③ ★ **同表内每行的列数必须等于该表表头列数**（本轮事故 ①）——
 *      列数由**实读表头**决定，不硬编码（P-27：别把当前状态写死成常量）。
 *      表头**非 3 列**时**不出声**（本仓无第二形态），避免过宽（P-38）；
 *   ④ **同表内 ID 唯一**（同一张表里不得出现两条同 ID 行）；
 *   ⑤ ★ **跨表 ID 不得复用**（本轮事故 ②）—— 同一 ID 出现在 ≥2 张表 ⇒ 报红。
 *      ⓘ 合法形态：「`W36`」与「`W36 续`」是**不同 ID**（续轮次），不算复用。
 *   ⑥ ⓘ **行首缩进**（提示，**不影响退出码**）：表格行以 `|` 顶格为本仓风格；缩进 ≤3 空格
 *      在 GFM 里仍是表格行（**不丢信息**）⇒ 按 **P-38**（过宽 ⇒ 假红 ⇒ 训练人忽略报警）
 *      只作信息项出声，**不报红**。
 *   ⑦ ★ **P 判据编号一致性**（W43 新增；**W54 补 ⑦c 反向**）—— `§九 索引` / `§3.1 声明` /
 *      `方法论 §5.4 定义` 三处必须一致：⑦a 索引无重复无缺号（编号是主键）；
 *      ⑦b §3.1 的「累计 N 条 + P-1 ~ P-N」必须等于索引实际条数；
 *      ⑦c ★★ **§5.4 与索引双向一致**（缺定义 ⇒ 报红；出现索引外编号 ⇒ 报红；切不出 §5.4 ⇒ fail-closed）。
 *   ⑧ ★★ **§十一 下的每个 `### 11.x` 小节必须在本表登记**（W52 新增），否则它的行会被
 *      上一节的切面**静默吞并**而闸门照样报绿（P-30）。
 *
 * ## ★★ W54：判据 ⑦c 曾是**空声明**（P-56 的教科书形态）
 *   ⑦c 在**本文件头注**与 **GOAL §3.2 的闸门清单**里都写着「§5.4 定义不得超出索引范围」——
 *   而**实现里一条都没有**，本脚本此前**连方法论文件都没打开过**（`grep METHODOLOGY` = 0 命中）。
 *   ⇒ 读者（含未来的 AI）会以为「判据体系三处一致」有机器守着，**而那条通路根本不存在**；
 *   又因为当时的 §5.4 **恰好覆盖全部编号** ⇒ **假绿与真绿在输出上完全同貌**（P-30 / W45 识别特征）。
 *   ★ 这与 **P-56** 同源（「声明已被机器守着」必须连「它会在哪条通路上被跑到」一起声明），
 *   也是 **P-58** 的同族（同一个「机器化落点」的声明，在**两个区段**里被写了两份，只有一份有守）。
 *   ★★ **承重验证（P-20/B11）**：把 ⑦c 的反向分支短路掉 ⇒ selftest 报 7 FAIL **且负控报 6 FAIL**
 *   —— 而**短路之前**负控是 13/13 全绿 ⇒ 那个实验**当场抓到负控自身的空洞**
 *   （它对 ⑦c 零覆盖）。补了四条控（E1 缺定义 / E2 索引外编号 / E3 切面失效 / E4 杠杆）才闭合。
 *   ★ 教训：**「新写的判据有 selftest 有杠杆」不等于「负控也覆盖了它」** —— 负控的覆盖面
 *   必须由「把实现短路掉，看负控会不会红」独立证明。
 *
 * ## 诚实边界（R7）
 *   ① 本闸门管**结构**（列数 / 编号 / 项数），**不管**「工作面描述的内容是否属实」——
 *      后者要逐个真跑（不假装覆盖）。
 *   ② 判据 ② 的下限是**粗护栏**（当前 38 行，下限 30）：它只挡「整段被删」，
 *      **挡不住**「删掉一两行」—— 那需要按编号连续性逐个核对，本判据**没做**（不假装做了）。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出违规（fail-closed）    2 = 读不到文档    3 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-goal-sections.mjs --selftest
 *   node scripts/audit-goal-sections.mjs
 *   node scripts/audit-goal-sections.mjs --file <path>      # 供负控注入后复核
 *   node scripts/audit-goal-sections.mjs --file <GOAL 副本> --method <方法论副本>
 *       # `--method`：判据 ⑦c 要读方法论 §5.4 ⇒ 负控必须能对**方法论副本**注入坏样本（P-59 纪律②）
 *       # ★ W77 补：此前实现已支持 `--method` 而**用法行没写** ⇒ 能力不可发现
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 的头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOC = path.join(WS, '..', 'docs', 'GOAL.md')
// ★ W54：判据 ⑦c 要读方法论 §5.4 ⇒ 常量必须在顶部（曾因定义在 `checkDoc` 之后触发 TDZ：
//   `ReferenceError: Cannot access 'METHOD' before initialization` —— 与 W41 同坑，
//   **判据自己的作用域也是判据的一部分**）
const METHOD = path.join(WS, '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md')

/**
 * 三个小节（收尾锚点 = 下一个小节标题 / 下一个一级标题）。
 * ★ 表头列数**由实读决定**，不写在这里（P-27）。
 */
export const SECTIONS = [
  { key: '11.1', start: /^###\s*11\.1/, end: /^###\s*11\.2/ },
  { key: '11.2', start: /^###\s*11\.2/, end: /^###\s*11\.3/ },
  { key: '11.3', start: /^###\s*11\.3/, end: /^###\s*11\.4/ },
  // ★★ **W52 新增：§11.4「负结论登记」**（**该轮实测：新小节会被上一节的 `end` 吞并**）
  { key: '11.4', start: /^###\s*11\.4/, end: /^###\s*11\.5|^##\s*十二、/ }
]
/**
 * ★★ **§十一 下所有 `### 11.x` 小节**（**W52 新增**）——用于判据⑧。
 *
 * ## 为什么需要（**W52 实测的真缺陷**）
 * 首版 `11.3` 的 `end` 写成 `/^##\s*十二、/` ⇒ 新增 §11.4 后，**它的 5 行被算进 §11.3**
 * ⇒ §11.3 显示「24 行」（19 + 5）而**闸门照样报绿**（两节恰好都是 3 列表）。
 * ★ 危害：⑴ **项数虚增** ⇒ 「总数不跌破下限」这条判据在**整段被删**时会**失灵**；
 *  ⑵ 新增小节若**列数不同**（如 4 列），会被判成「列数错位」的**假红**。
 * ⇒ 修法两道：⑴ 每节的 `end` 锚到**下一个 `### 11.x`**（而不是只锚 `## 十二、`）；
 *  ⑵ ★ **新增判据⑧**：§十一 下的每个 `### 11.x` **必须在本表登记**（否则报红）——
 *    这样下次再插新小节，闸门会**立刻提醒**「它没被检查」而不是**静默吞并**。
 */
export const SHEET_HEAD_RE = /^###\s*(11\.\d+)/

/**
 * 三表数据行总数下限（防「整段被静默删掉」）。
 * ★ **下限 ≠ 精确值**：新增工作面会把它抬高，**不算违规**（守 P-38：过宽 ⇒ 假红）。
 *   实测基线（W42）：§11.1 24 行 + §11.2 6 行 + §11.3 8 行 = **38 行**。
 */
const MIN_TOTAL_ROWS = 30

/**
 * 切一行表格为单元格（**保留原文**，供输出定位）。
 *
 * ★★ **必须先剥反引号片段再切**（P-41 推论四形态 —— W40 的 §六 闸门首版正是栽在这里）：
 *   本仓正文大量出现 `` `a|b` `` 这类**含竖线**的反引号代码（如 `rp/session-(rollback|edit|regenerate)`），
 *   朴素 `split('|')` 会把它们**切断** ⇒ 「列数」当场虚高（判据 ③ 会**假红**）。
 *   ⇒ 做法：把反引号片段按**原长度**替换成哨兵字符（保持索引对齐），按哨兵后的位置切**原文**。
 */
export function splitRowCells (raw) {
  const mask = raw.replace(/`[^`]*`/g, (m) => '\u0001'.repeat(m.length))
  const pos = []
  for (let k = 0; k < mask.length; k += 1) if (mask[k] === '|') pos.push(k)
  if (pos.length < 2) return null
  const out = []
  for (let k = 0; k < pos.length - 1; k += 1) out.push(raw.slice(pos[k] + 1, pos[k + 1]).trim())
  return out
}

/** 表格行 / 分隔行判定 */
const isTableLine = (raw) => /^\s*\|/.test(raw)
const isSeparator = (raw) => /^\s*\|[\s:|-]+\|?\s*$/.test(raw)

/** ID 归一：去粗体、压空白（`W36  续` 与 `W36 续` 视作同一 ID） */
export const normId = (c) => c.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

/**
 * 切出一个小节里的表结构。
 * @returns {null | { headerCols: number|null, headerLine: number|null, rows: Array<{line:number,id:string,cells:string[],indent:boolean}> }}
 *   `null` = 该小节的标题没找到（fail-closed 由调用方判定）
 *
 * ★★ **表头识别必须按 GFM 语法（「表格行 + 紧跟分隔行」配对），不能用「首列是 `#`」的启发式**
 *    —— 这是 **负控 B/C 当场证伪** 的判据自身缺陷（P-41 推论四：判据的**输入解析**也需要判据）：
 *    首版写成 `isHeaderRow(首列 === '#')`，于是**表头被写坏时（首列不再是 `#`）静默退化** ——
 *    `headerCols` 退化成「第一个数据行的列数」，而那一行又被 `continue` **当成表头跳过**
 *    ⇒ 结果**少一行 + 整表判据错位**，而闸门**照样报绿**。
 *    改成语法配对后：表头与分隔行失配 ⇒ 切不出表体 ⇒ **fail-closed 报红**（不再静默）。
 */
export function sectionRows (lines, sec) {
  const start = lines.findIndex(l => sec.start.test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && sec.end.test(l))
  if (end < 0) end = lines.length
  const at = (i) => lines[i].replace(/\r$/, '')

  let headerIdx = -1
  for (let i = start; i < end - 1; i += 1) {
    if (isTableLine(at(i)) && !isSeparator(at(i)) && isSeparator(at(i + 1))) { headerIdx = i; break }
  }
  if (headerIdx < 0) return { headerCols: null, headerLine: null, rows: [] }
  const cells0 = splitRowCells(at(headerIdx))
  const headerCols = cells0 ? cells0.length : null
  if (headerCols === null) return { headerCols: null, headerLine: headerIdx + 1, rows: [] }

  const rows = []
  for (let i = headerIdx + 2; i < end; i += 1) {
    const raw = at(i)
    if (!isTableLine(raw) || isSeparator(raw)) continue
    const cells = splitRowCells(raw)
    if (!cells) continue
    rows.push({ line: i + 1, id: normId(cells[0]), cells, indent: /^\s/.test(raw) })
  }
  return { headerCols, headerLine: headerIdx + 1, rows }
}

/**
 * 检查整份 GOAL.md。
 * @param {string} text  GOAL.md 全文
 * @param {{methodText?:string|null}} [opt]
 *   `methodText` = 方法论全文（**可注入**：`--file` 副本模式与 selftest 合成样本都要自给自足）。
 *   ★ 为什么要可注入（W54 的教训，同 W47）：若只读真实文件，**合成样本就会依赖真实方法论**
 *     —— 那正是「判据有它自己不知道的隐式前提」（P-40 家族）：合成样本的 §九 只有 12 条，
 *     而真实 §5.4 有 58 条 ⇒ 判据 ⑦c 的「正向」分支会报出 46 条「索引外编号」= **假红**。
 *   `undefined` ⇒ 读真实文档；`null` ⇒ 显式声明「没有方法论」（只出声不报红，P-43）。
 * @returns {{ ok:boolean, problems:string[], notes:string[], total:number, stats:Array }}
 */
export function checkDoc (text, opt = {}) {
  const methodText = opt.methodText === undefined
    ? (fs.existsSync(METHOD) ? fs.readFileSync(METHOD, 'utf8') : null)
    : opt.methodText
  const lines = text.split(/\r?\n/)
  const problems = []
  const notes = []
  const parsed = []

  // ⑧ ★★ **§十一 下的每个 `### 11.x` 小节必须在本表登记**（**W52 新增**，见 `SHEET_HEAD_RE` 头注）
  //    ★ 由头：新增 §11.4 后，它的行被上一节的 `end`（`/^## 十二、/`）**吞并**而闸门**报绿**。
  //    ⇒ 本判据让「新小节」**当场出声**，而不是静默吞并（P-46 推论二：清单变短/变长都要问归因）。
  const i11 = lines.findIndex(l => /^##\s*十一、/.test(l))
  const i12 = lines.findIndex(l => /^##\s*十二、/.test(l))
  if (i11 >= 0 && i12 > i11) {
    const registered = new Set(SECTIONS.map(s => s.key))
    const found = new Set()
    for (let i = i11; i < i12; i += 1) {
      const m = SHEET_HEAD_RE.exec(lines[i])
      if (m) found.add(m[1])
    }
    for (const k of found) {
      if (!registered.has(k)) {
        problems.push(`§${k}：**§十一 下存在未登记的小节** ⇒ 它的行会被**上一节的切面吞并**`
          + `（W52 实测：新增 §11.4 后其 5 行被算进 §11.3，而闸门照样报绿）`
          + ` ⇒ 请在 \`SECTIONS\` 里登记（切不出 ⇒ 该节**完全不被检查**，P-30）`)
      }
    }
    for (const k of registered) {
      if (!found.has(k)) {
        problems.push(`§${k}：**在 \`SECTIONS\` 里登记了，但 GOAL 里找不到该小节标题** ⇒ 切面失效（P-30）`)
      }
    }
  } else {
    notes.push('§十一 / §十二 标题未找到 ⇒ 判据⑧（小节登记）不适用')
  }

  // ⑨ ★★ **§11.4（负结论表）里引用的工作面编号必须「可达」**（**W68 新增**）
  //    ★ 由头（W68 实测的真缺陷）：§11.4 的 **N8** 行写着「**W55 排查**」，而 **W55 这一编号
  //      在 §11.1~§11.3 里没有任何对应行、也没有任何提及** ⇒ 读者按 §11.4 去找「W55 是什么」
  //      **必然扑空** —— 与 **P-52**（「文档引用的完整性必须按『读者能否按它找到』判」）**同族**，
  //      只是对象从「脚本/文档路径」换成了「**文档内部的工作面编号**」。
  //    ★ 语义不变量：**凡在某一节里被当编号引用，读者就必须能在别处找到它的定义/记录**。
  //    ★ 判定「可达」的三种形态（**守 P-38 防过宽** —— 三种都算数）：
  //      ⑴ 在 §11.1~§11.3 里有**独立表格行**（行首是 `| Wnn |`）；
  //      ⑵ 在 §11.1~§11.3 里被**任意提及**（说明它被并入别处或作为子项）；
  //      ⑶ ★ **在 §11.4 行内就地说明其身份**（`Wxx ... 即/该轮/就地说明`）——
  //         这一条是为「**只做排查、无工作面**」的轮次准备的（它们**不该**硬造 §11.1 行）。
  //    ★ 切面失效 fail-closed：切不出 §11.4 或 §11.1 的边界 ⇒ 出声，不当 0 违规。
  {
    const i114 = lines.findIndex(l => /^###\s*11\.4/.test(l))
    if (i114 < 0) {
      notes.push('§11.4 标题未找到 ⇒ 判据⑨（负结论表引用可达性）不适用（P-43：无判据力不判）')
    } else if (i11 >= 0 && i114 > i11) {
      const secTop = lines.slice(i11, i114).join('\n')
      const sec114 = lines.slice(i114, i12 > i114 ? i12 : undefined).join('\n')
      const refs = [...new Set([...sec114.matchAll(/\bW(\d{1,3})\b/g)].map(m => `W${m[1]}`))]
      for (const r of refs) {
        const asRow = new RegExp(`^\\|\\s*\\*{0,2}${r}\\*{0,2}\\s*\\|`, 'm').test(secTop)
        const anywhere = new RegExp(`\\b${r}\\b`).test(secTop)
        const inLine = new RegExp(`W${r.slice(1)}[^|]{0,160}(即|该轮|就地说明)`).test(sec114)
        if (!asRow && !anywhere && !inLine) {
          problems.push(`§11.4：引用了 **${r}**，但它在 §11.1~§11.3 里**既无独立行、也未被提及**，`
            + `§11.4 行内也**没有就地说明它的身份** ⇒ 读者按 §11.4 去找**必然扑空**（**P-52**）`
            + ` ⇒ 二选一：⑴ 补进 §11.1~§11.3（若它确是工作面）；⑵ ★ **在 §11.4 该行内就地说明**`
            + `「Wxx 即……（该轮只做排查，无工作面编号行）」（推荐 —— 只做排查的轮次不该硬造工作面行）`)
        }
      }
    }
  }

  for (const sec of SECTIONS) {
    const r = sectionRows(lines, sec)
    if (r === null) {
      problems.push(`§${sec.key}：**找不到小节标题** ⇒ fail-closed（判据切面失效时「0 违规」无意义，P-30）`)
      continue
    }
    if (r.headerCols === null || r.rows.length === 0) {
      problems.push(`§${sec.key}：**切不出表体**（表头 ${r.headerCols === null ? '未找到' : r.headerCols + ' 列'} / 数据行 ${r.rows.length}）⇒ fail-closed`)
      continue
    }
    parsed.push({ sec, ...r })
  }

  // ② 三表数据行总数下限（P-46 推论二：项数变了本身就是判据）
  const total = parsed.reduce((a, p) => a + p.rows.length, 0)
  if (parsed.length === SECTIONS.length && total < MIN_TOTAL_ROWS) {
    problems.push(`§十一 三表数据行总数 **${total}** < 下限 ${MIN_TOTAL_ROWS}`
      + ` ⇒ 疑似**整段被静默删除**（P-46 推论二：项数变了本身就是判据）`)
  }

  // ③ 同表列数一致（本轮事故 ①：GFM 静默丢弃多出的列）
  // ★★ **口径必须是「与实读表头一致」，不能要求某个固定列数**（首版写死「本仓只有 3 列形态」
  //     ⇒ 真实仓库当场证伪：§11.1 与 §11.2 的表头**就是 4 列**、只有 §11.3 是 3 列；
  //     若 §11.1 某行被写成 3 列，本判据会**静默漏检**。这正是 P-27「别把当前状态写死成常量」。
  for (const p of parsed) {
    for (const row of p.rows) {
      if (row.cells.length !== p.headerCols) {
        problems.push(`§${p.sec.key} 第 ${row.line} 行：**列数 ${row.cells.length} ≠ 表头 ${p.headerCols}**`
          + ` ⇒ GFM 会**静默丢弃**多出的列（收口标记/轨道将**不渲染**），读者会误判该工作面未完成（P-27）：`
          + ` \`${row.cells[0].slice(0, 24)}\``)
      }
    }
  }

  // ④ 同表内 ID 唯一
  for (const p of parsed) {
    const seen = new Map()
    for (const row of p.rows) {
      if (!seen.has(row.id)) seen.set(row.id, [])
      seen.get(row.id).push(row.line)
    }
    for (const [id, ls] of seen) {
      if (ls.length > 1) {
        problems.push(`§${p.sec.key}：ID **${id}** 在同一张表里出现 ${ls.length} 次（第 ${ls.join(' / ')} 行）⇒ 引用有歧义（P-1）`)
      }
    }
  }

  // ⑤ 跨表 ID 不得复用（本轮事故 ②）
  const byId = new Map()
  for (const p of parsed) for (const row of p.rows) {
    if (!byId.has(row.id)) byId.set(row.id, [])
    byId.get(row.id).push({ sec: p.sec.key, line: row.line })
  }
  for (const [id, hits] of byId) {
    if (hits.length < 2) continue
    const secs = new Set(hits.map(h => h.sec))
    if (secs.size < 2) continue // 同表重复已由判据 ④ 报出，不重复报
    problems.push(`ID **${id}** 被 **${secs.size} 张表复用**（${hits.map(h => `§${h.sec} 第 ${h.line} 行`).join(' 与 ')}）`
      + ' ⇒ 两处指的可能**是完全不同的事**，引用该编号者无法判断指哪一个（P-1；本轮 W42 的 `W10` 即此形态）')
  }

  // ⑥ 行首缩进 ⇒ 提示（不报红：GFM 允许 ≤3 空格，**不丢信息**）
  const indented = parsed.flatMap(p => p.rows.filter(r => r.indent).map(r => `§${p.sec.key} 第 ${r.line} 行`))
  if (indented.length) {
    notes.push(`表格行行首有缩进（本仓风格为顶格）：${indented.join(' / ')}`
      + ' ⇒ 不影响 GFM 渲染（≤3 空格仍认表格行），**按 P-38 不报红**，仅提示一致性')
  }

  // ⑦ ★ P 判据编号一致性（**W43 新增 · P-38 三段式排查的第二处**）
  //
  // ## 为什么必须守
  // P 判据体系是本仓「设计哲学资产」的**编号主键**：`§九` 是索引、`§5.4` 是定义、
  // `§3.1` 是「累计多少条」的对外声明。三处**必须一致**，否则正是 **P-1** 在
  // 「判据体系自身」上的违例 —— 而**没有任何机器守着**（W42 只守了 §十一 三张表）。
  // ## 本轮（W43）实测的真缺陷
  // 上一轮（W42）新增 **P-49** 后，`§3.1` 的声明仍写「**P-1 ~ P-48**（累计 48 条）」
  // ⇒ **过期标记**（**P-27**：结论会过期而没人回头改）。识别方式 = 读出来的数对不上。
  // ## 判据（三条）
  //   ⑦a `§九` 索引里 P-n **无重复、无缺号**（编号是主键，断了就没法引用）
  //   ⑦b `§3.1` 声明里「累计 N 条 / P-1 ~ P-N」的 **N 必须等于** `§九` 索引的实际条数
  //   ⑦c `§5.4`（单源定义）**与** `§九` 索引必须**双向一致**：
  //      正向 —— §5.4 里出现的 P-n **不得超出** §九 索引（定义文件里冒出索引外的编号 ⇒ 漏登记）；
  //      ★★ 反向 —— §九 索引里**每条** P-n **必须在 §5.4 有定义**（**W54 补实现**）。
  //      ★ 为什么反向最要紧：索引是**对外**的「已发布判据清单」，读者按编号去 §5.4 找定义；
  //        只有索引而无定义 ⇒ 那条判据**只是一句编号**（无人能知道它约束什么）⇒ 正是 P-1。
  //      ★★ **本条曾是「空声明」（W54 实测的真缺陷）**：⑦c 在**头注与 GOAL 里都写着已实现**，
  //        而**实现里完全没有**，脚本**连方法论文件都没读**（`grep METHODOLOGY` = 0 命中）——
  //        即 **P-56 的形态**（「声明已被机器守着」而那条通路根本不存在），
  //        且因为当时的 §5.4 恰好覆盖全部编号 ⇒ **假绿与真绿同貌**（P-30 / W45 识别特征）。
  // ★ 口径（守 P-27 / P-38）：**只读结构、不硬编码当前数字**；`§九` 缺失 ⇒ 只记提示不报红
  //   （本判据的职责是「三处一致」，不是「必须有 §九」—— 后者由人工确认）。
  // ★★ §5.4 的**条目形态不止一种**（实测两种，必须都认，否则**假红**，P-45）：
  //    形态① 表格行：`| **P-1** | ... |`（P-1 ~ P-20 那一族）
  //    形态② 段落行：`**P-58 第四十四轮 W53 新增「…」——**`（P-21 之后的族）
  //    只认形态① ⇒ 会把 20+ 条**真实存在的定义**判成「缺定义」（量级与已知事实严重不符 = P-45 识别特征）。
  const secNine = (() => {
    const a = lines.findIndex(l => /^##\s*九、/.test(l))
    if (a < 0) return null
    const b = lines.findIndex((l, i) => i > a && /^##\s*十、/.test(l))
    const end = b < 0 ? lines.length : b
    const nums = []
    for (let i = a; i < end; i += 1) {
      const m = /^\|\s*\*{0,2}P-(\d+)\*{0,2}\s*\|/.exec(lines[i])
      if (m) nums.push({ n: Number(m[1]), line: i + 1 })
    }
    return { a: a + 1, nums }
  })()

  if (secNine && secNine.nums.length >= 10) {
    const ns = secNine.nums.map(x => x.n)
    // ⑦a 无重复、无缺号
    const dupP = ns.filter((n, i) => ns.indexOf(n) !== i)
    if (dupP.length) problems.push(`§九 索引：P 判据编号**重复**（P-${[...new Set(dupP)].join(' / P-')}）⇒ 编号是主键，重复即引用歧义（P-1）`)
    const missP = []
    for (let n = 1; n <= Math.max(...ns); n += 1) if (!ns.includes(n)) missP.push(`P-${n}`)
    if (missP.length) problems.push(`§九 索引：P 判据编号**缺号**（${missP.join(' / ')}）⇒ 后继者无法判断是「跳号」还是「漏登记」`)
    const maxP = Math.max(...ns)
    // ⑦b §3.1 声明必须与索引一致
    const declLine = lines.findIndex(l => /设计哲学判据\s*\|/.test(l) && /P-1\s*~\s*P-\d+/.test(l))
    if (declLine < 0) {
      notes.push('§3.1 找不到「设计哲学判据 P-1 ~ P-n」的声明行 ⇒ 本判据 ⑦b **未生效**（请人工确认该行是否被改写）')
    } else {
      const dm = /P-1\s*~\s*P-(\d+)/.exec(lines[declLine])
      const declN = Number(dm[1])
      if (declN !== maxP) {
        problems.push(`§3.1 第 ${declLine + 1} 行声明「P-1 ~ **P-${declN}**」，而 §九 索引实际末项是 **P-${maxP}**`
          + `（共 ${ns.length} 条）⇒ **过期声明**（P-27）：判据体系对外报的条数与实际不符，`
          + `引用者会以为 P-${maxP} 不存在；且这正是 **P-1** 在「判据体系自身」上的违例（W43 实测的真缺陷：新增 P-49 后此声明未同步）`)
      }
      const cnt = /累计\s*(\d+)\s*条/.exec(lines[declLine])
      if (cnt && Number(cnt[1]) !== ns.length) {
        problems.push(`§3.1 第 ${declLine + 1} 行声明「累计 **${cnt[1]}** 条」，而 §九 索引实际有 **${ns.length}** 条 ⇒ 同一事实两处口径不一致（P-1）`)
      }
    }
  } else if (!secNine) {
    notes.push('找不到 §九 P 判据索引 ⇒ 本判据 ⑦ **未生效**（不当通过、也不报红：职责是「三处一致」而非「必须有 §九」）')
  }

  // ⑦c ★★ 反向：§九 索引里**每条** P-n 必须在方法论 §5.4 有定义（**W54 补实现**）
  //
  // ## 为什么这条此前是**空声明**（W54 实测的真缺陷）
  // ⑦c 在**本文件头注**与 **GOAL §3.2 的闸门清单**里都写着「§5.4 定义不得超出索引范围」——
  // 而**实现里一条都没有**，本脚本**连方法论文件都没打开过**。即 **P-56 的形态**：
  // 「声明已被机器守着」，可这条通路**根本不存在**；而当时的 §5.4 恰好覆盖全部编号
  // ⇒ **假绿与真绿在输出上完全同貌**（P-30 / W45 的教科书识别特征）。
  // ## 判据口径
  //   §5.4 区段 = `### 5.4` 到下一个 `### 5.x` / `## 六、`。
  //   条目**两种形态都要认**（只认一种 ⇒ 假红，P-45）：
  //     ① 表格行 `| **P-1** | …`
  //     ② 段落行 `**P-58 第四十四轮 W53 新增「…」——`（★ 口径只锚「`**P-n` + 紧跟轮次词『第』」）
  //   ★★ **口径必须允许标题跨行**（W54 实测）：首版写成 `/\*\*(P-\d+)\s+第[^*]{0,40}\*\*/`，
  //      要求「同一行内闭合 `**`」⇒ 把 **P-27**（标题跨两行）与 **P-46**（标题较长、
  //      且中途出现 `**读数语义**` 这对粗体）**双双判成「缺定义」= 假红**。
  //      识别特征仍是 **P-45**：报出的量级（2 处）虽小，但逐条取证后发现**两条定义都真实存在**。
  //      ⇒ 收窄为**前缀锚**（不要求闭合、不要求同行）：只认「`**P-n ` 紧跟『第』（轮次）」。
  if (secNine && secNine.nums.length >= 10 && methodText !== null) {
    const mLines = methodText.split(/\r?\n/)
    const s54 = mLines.findIndex(l => /^###\s*5\.4/.test(l))
    const s54End = s54 < 0 ? -1 : mLines.findIndex((l, i) => i > s54 && /^###\s*5\.\d|^##\s*六、/.test(l))
    if (s54 < 0 || s54End <= s54) {
      // ★ 切面失效 ⇒ **fail-closed**（否则「该区不被检查」与「该区通过」同貌，P-30）
      problems.push('方法论 §5.4 切不出区段（标题缺失 / 顺序不对）⇒ 判据 ⑦c **fail-closed**'
        + ' —— 否则「§5.4 未检查」会与「§5.4 检查通过」在报告上完全同貌（P-30）')
    } else {
      const defined = new Set()
      for (let i = s54; i < s54End; i += 1) {
        const t1 = /^\|\s*\*{0,2}(P-\d+)\*{0,2}\s*\|/.exec(mLines[i])   // 形态① 表格行
        if (t1) defined.add(Number(t1[1].slice(2)))
        const t2 = /\*\*(P-\d+)\s+第/.exec(mLines[i])                     // 形态② 段落行（前缀锚，允许跨行）
        if (t2) defined.add(Number(t2[1].slice(2)))
      }
      const inIdxNotDef = secNine.nums.map(x => x.n).filter(n => !defined.has(n))
      if (inIdxNotDef.length) {
        problems.push(`§九 索引里的 ${inIdxNotDef.map(n => `P-${n}`).join(' / ')} **在方法论 §5.4 找不到定义**`
          + `（索引共 ${secNine.nums.length} 条、§5.4 取到 ${defined.size} 条）⇒ 读者按编号去查会扑空，`
          + `那条判据**只是一句编号**（P-1：同一语义只许一处权威定义，缺了它就没人知道它约束什么）`)
      }
      // 正向：§5.4 里出现的编号不得超出索引（定义文件冒出索引外的编号 ⇒ 漏登记）
      const beyond = [...defined].filter(n => !secNine.nums.map(x => x.n).includes(n))
      if (beyond.length) {
        problems.push(`方法论 §5.4 里出现 §九 索引之外的编号（${beyond.map(n => `P-${n}`).join(' / ')}）`
          + `⇒ 有一处漏登记到索引（反向：索引是「已发布判据清单」的唯一 SSOT）`)
      }
      secNine.defined = defined.size
    }
  } else if (secNine && secNine.nums.length >= 10) {
    notes.push('读不到方法论 ⇒ 判据 ⑦c（§5.4 双向一致）**未生效**（出声，不判 FAIL —— 换机/CI 可能无此文档，P-43）')
  }

  return { ok: problems.length === 0, problems, notes, total, stats: parsed.map(p => ({ key: p.sec.key, headerCols: p.headerCols, rows: p.rows.length })) }
}

// ---------------------------------------------------------------------------
// selftest（正控 / 负控 / **杠杆** / 零控）
//   为什么必须有：扫文档的静态闸门**失效时输出与通过完全相同**（P-30）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // 合成样本：三张表都与真实结构同形（3 列 / 4 列各一，覆盖两种既有形态）
  const H = (title) => `${title}\n\n`
  const rows3 = (n, prefix = 'W', from = 1) => Array.from({ length: n }, (_, i) => `| ${prefix}${from + i} | 说明 ${from + i} | 级别 |`).join('\n') + '\n'
  const T111 = '| # | 工作面 | 说明 |\n|---|---|---|\n'
  const T112 = '| # | 工作面 | 轨道 | 状态 |\n|---|---|---|---|\n'
  const T113 = '| # | 工作面 | 说明 |\n|---|---|---|\n'
  const good = H('## 十一、当前工作面') + H('### 11.1 立刻可做') + T111 + rows3(16, 'A', 1)
    + H('### 11.2 须真机') + T112 + ['| B1 | x | A1 | ✅ |', '| B2 | x | A1 | 🚫 |', '| B3 | x | A1 | ✅ |',
      '| B4 | x | A1 | ✅ |', '| B5 | x | A1 | ✅ |', '| B6 | x | A1 | ✅ |', '| B7 | x | A1 | ✅ |',
      '| B8 | x | A1 | ✅ |', '| B9 | x | A1 | ✅ |', '| B10 | x | A1 | ✅ |', '| B11 | x | A1 | ✅ |',
      '| B12 | x | A1 | ✅ |'].join('\n') + '\n'
    + H('### 11.3 长期持续') + T113 + rows3(8, 'C', 1)
    // ★★ W52 新增：§11.4「负结论登记」也必须出现在样本里（否则判据⑧ 会报「登记了但找不到标题」）
    + H('### 11.4 已排查（负结论登记）') + T113 + rows3(5, 'N', 1)
    + H('## 十二、起步动作')

  const r1 = checkDoc(good)
  t('正控1：合规样本（三表齐备、列数自洽、ID 无复用）⇒ 通过', r1.ok, r1.problems.join(' / '))
  t('正控2：合成样本的列数被正确读出（§11.1=3 列 / §11.2=4 列 / §11.3=3 列 / **§11.4=3 列**）',
    JSON.stringify(r1.stats.map(s => s.headerCols)) === '[3,4,3,3]', JSON.stringify(r1.stats))
  t('★正控2b（W52）：**每节的行数按自己的小节边界切分**（§11.3 = 8 行 / §11.4 = 5 行，**不得吞并**）',
    JSON.stringify(r1.stats.map(s => s.rows)) === '[16,12,8,5]', JSON.stringify(r1.stats.map(s => s.rows)))

  // ---- ★ 负控 1（**本轮真实事故 ① 的复现**）：§11.3 表头 3 列、数据行 4 列 ⇒ 必须报红 ----
  const colMismatch = good.replace('| C1 | 说明 1 | 级别 |', '| C1 | 说明 1 | 轨道 | ✅ |')
  const r2 = checkDoc(colMismatch)
  t('负控1：数据行列数 ≠ 表头 ⇒ 报红（GFM 静默丢列）', !r2.ok && /列数/.test(r2.problems.join(' ')),
    `problems=${JSON.stringify(r2.problems.slice(0, 1))}`)
  t('负控1b：报红**精确指向**出错行号与列数差',
    /第 \d+ 行：\*\*列数 4 ≠ 表头 3\*\*/.test(r2.problems.join(' ')),
    r2.problems.find(p => /列数/.test(p))?.slice(0, 80) ?? '')

  // ---- ★ 杠杆（P-20）：**只把那一行的列数改对** ⇒ 必须**转绿** ----
  // ★ 锚点必须与样本逐字一致（W40 的教训：锚点不命中时测的是「没替换」）
  const leverFrom = '| C1 | 说明 1 | 轨道 | ✅ |'
  const leverTo = '| C1 | 说明 1 | 级别 |'
  if (!colMismatch.includes(leverFrom)) {
    t('杠杆前置：替换锚点必须命中（防「没替换」被当成「已修复」）', false, '锚点未命中')
  } else {
    const lever = colMismatch.replace(leverFrom, leverTo)
    t('杠杆：仅把该行列数改对 ⇒ 必须转绿', checkDoc(lever).ok, checkDoc(lever).problems.slice(0, 1).join(''))
  }

  // ---- ★ 负控 2（**本轮真实事故 ② 的复现**）：跨表 ID 复用 ⇒ 必须报红 ----
  const crossId = good.replace('| B3 | x | A1 | ✅ |', '| A3 | x | A1 | ✅ |') // A3 已存在于 §11.1
  const r3 = checkDoc(crossId)
  t('负控2：跨表 ID 复用 ⇒ 报红（引用歧义，P-1）',
    !r3.ok && /张表复用/.test(r3.problems.join(' ')), `problems=${JSON.stringify(r3.problems.slice(0, 1))}`)
  t('负控2b：报红**精确指向**两处小节与行号',
    /§11\.1 第 \d+ 行 与 §11\.2 第 \d+ 行|§11\.2 第 \d+ 行 与 §11\.1 第 \d+ 行/.test(r3.problems.join(' ')),
    r3.problems.find(p => /复用/.test(p))?.slice(0, 100) ?? '')

  // ---- 负控 3：同表 ID 重复 ⇒ 必须报红（且**不**重复报成「跨表复用」）----
  const dupId = good.replace('| C2 | 说明 2 | 级别 |', '| C1 | 说明 2 | 级别 |')
  const r4 = checkDoc(dupId)
  t('负控3：同表 ID 重复 ⇒ 报红', !r4.ok && /同一张表里出现 2 次/.test(r4.problems.join(' ')), '')
  t('负控3b：同表重复**不得**被重复报成「跨表复用」（只报一次）',
    !/被 \d+ 张表复用/.test(r4.problems.join(' ')), `problems=${JSON.stringify(r4.problems)}`)

  // ---- 负控 4：切不出小节 / 表体过少 ⇒ 必须报红（不许当 0 违规）----
  //   ★ W52：样本必须**含全部已登记小节**（否则「找不到 §11.4」会**替**本条判据报红 ⇒ 假通过）
  const SEC114 = H('### 11.4 已排查（负结论登记）') + T113 + rows3(5, 'N', 1)
  t('负控4：缺 §11.3 标题 ⇒ 报红（fail-closed）',
    !checkDoc(good.replace('### 11.3 长期持续', '### 别的')).ok, '')
  t('负控4b：§11.3 表体为空 ⇒ 报红（切面失效不得当通过）',
    !checkDoc(H('### 11.1 立刻可做') + T111 + rows3(16, 'A', 1) + H('### 11.2 须真机') + T112
      + rows3(12, 'B', 1) + H('### 11.3 长期持续') + T113 + SEC114 + H('## 十二、起步动作')).ok, '')

  // ---- 负控 5：整段被静默删除（总行数跌破下限）⇒ 必须报红（P-46 推论二）----
  t('负控5：总行数跌破下限 ⇒ 报红（项数变了本身就是判据）',
    !checkDoc(H('### 11.1 立刻可做') + T111 + rows3(3, 'A', 1)
      + H('### 11.2 须真机') + T112 + rows3(3, 'B', 1)
      + H('### 11.3 长期持续') + T113 + rows3(3, 'C', 1) + SEC114).ok, '')

  // ---- 判据 ⑦：P 判据编号一致性（W43 新增；**W54 补 ⑦c 反向**）----
  //
  // ★ 合成样本要**与真实结构同形**：§九 索引表 + §3.1 的「设计哲学判据 P-1 ~ P-n」声明行
  //   + ★ **合成方法论**（W54：判据 ⑦c 要读 §5.4 ⇒ 必须显式注入，不能依赖真实文档 —— 见 `checkDoc` 头注）。
  const pRows = (n) => Array.from({ length: n }, (_, i) => `| P-${i + 1} | 定义 ${i + 1} |`).join('\n') + '\n'
  const pJudges = (idxN, declN, declCnt) => good
    + H('## 九、已产出的设计哲学资产')
    + '| # | 定义 |\n|---|---|\n' + pRows(idxN)
    + H('## 十、已收口的第一批问题')
    + `| 设计哲学判据 | **P-1 ~ P-${declN}**（累计 ${declCnt} 条） | 见 §5.4 |\n`
  // 合成方法论：§5.4 覆盖 P-1 ~ P-idxN（形态① 表格行，与真实前 20 条同形）
  const methodFor = (idxN, { drop = [], extra = [] } = {}) => {
    const keep = Array.from({ length: idxN }, (_, i) => i + 1).filter(n => !drop.includes(n))
    return H('### 5.4 设计哲学层判据（P 系列）')
      + '| # | 判据（一句话） |\n|---|---|\n' + keep.map(n => `| **P-${n}** | 定义 ${n} |`).join('\n') + '\n'
      + extra.map(n => `\n**P-${n} 第 N 轮新增「定义 ${n}」——**\n`).join('')
      + H('## 六、开放项')
  }
  const M_OK = methodFor(12)

  // 正控 ⑦：三处一致 ⇒ 通过
  const r7ok = checkDoc(pJudges(12, 12, 12), { methodText: M_OK })
  t('正控7：§九 索引与 §3.1 声明一致 ⇒ 通过', r7ok.ok, r7ok.problems.slice(0, 1).join(''))

  // ★ 负控 ⑦b：**本轮实测的真缺陷复现** —— 索引到 P-13、声明仍写 P-12（新增判据后没同步）
  const r7b = checkDoc(pJudges(13, 12, 12), { methodText: methodFor(13) })
  t('负控7b：§3.1 声明「P-1 ~ P-12」而索引实到 P-13 ⇒ 报红（过期声明，P-27）',
    !r7b.ok && /过期声明/.test(r7b.problems.join(' ')), `problems=${JSON.stringify(r7b.problems.slice(0, 1))}`)
  t('负控7b-②：报红**同时**指出声明值与实际值',
    /P-12/.test(r7b.problems.join(' ')) && /P-13/.test(r7b.problems.join(' ')),
    r7b.problems.find(p => /过期声明/.test(p))?.slice(0, 80) ?? '')

  // ---- ★ 杠杆（P-20）：**只把声明改成与索引一致** ⇒ 必须**转绿** ----
  const lever7From = '| 设计哲学判据 | **P-1 ~ P-12**（累计 12 条） | 见 §5.4 |'
  const lever7To = '| 设计哲学判据 | **P-1 ~ P-13**（累计 13 条） | 见 §5.4 |'
  if (!pJudges(13, 12, 12).includes(lever7From)) {
    t('杠杆7 前置：替换锚点必须命中（防「没替换」被当成「已修复」）', false, '锚点未命中')
  } else {
    const lv7 = pJudges(13, 12, 12).replace(lever7From, lever7To)
    t('杠杆7：仅把声明改成与索引一致 ⇒ 必须转绿',
      checkDoc(lv7, { methodText: methodFor(13) }).ok,
      checkDoc(lv7, { methodText: methodFor(13) }).problems.slice(0, 1).join(''))
  }

  // ---- 负控 ⑦b-③：「累计 N 条」与索引条数不符 ⇒ 报红（同一事实两处口径） ----
  const r7c = checkDoc(pJudges(12, 12, 11), { methodText: M_OK })
  t('负控7b-③：「累计条数」与索引实际条数不符 ⇒ 报红（P-1）',
    !r7c.ok && /累计/.test(r7c.problems.join(' ')), `problems=${JSON.stringify(r7c.problems.slice(0, 1))}`)

  // ---- 负控 ⑦a：编号缺号 ⇒ 报红 ----
  const gap = pJudges(12, 12, 12).replace('| P-5 | 定义 5 |\n', '')
  const r7d = checkDoc(gap, { methodText: M_OK })
  t('负控7a：§九 索引缺号 ⇒ 报红', !r7d.ok && /缺号/.test(r7d.problems.join(' ')), `problems=${JSON.stringify(r7d.problems.slice(0, 1))}`)

  // ---- 负控 ⑦a-②：编号重复 ⇒ 报红 ----
  const dupP = pJudges(12, 12, 12).replace('| P-6 | 定义 6 |', '| P-5 | 定义 6 |')
  const r7e = checkDoc(dupP, { methodText: M_OK })
  t('负控7a-②：§九 索引编号重复 ⇒ 报红（引用歧义）',
    !r7e.ok && /重复/.test(r7e.problems.join(' ')), `problems=${JSON.stringify(r7e.problems.slice(0, 1))}`)

  // ---- ★★ 判据 ⑦c 反向（W54 新增实现）：§九 每条必须在 §5.4 有定义 ----
  //   ① 正控：§九 12 条、§5.4 12 条 ⇒ 不得报「找不到定义」
  t('★正控7c：§九 的每条编号在 §5.4 都有定义 ⇒ 不报红',
    !/找不到定义/.test(checkDoc(pJudges(12, 12, 12), { methodText: M_OK }).problems.join(' ')), '')
  //   ② ★ 负控：索引有 P-12，而 §5.4 缺 P-12 ⇒ **必须报红**（这正是 W54 实测的形态）
  const r7cMiss = checkDoc(pJudges(12, 12, 12), { methodText: methodFor(12, { drop: [12] }) })
  t('★负控7c：§九 有索引而 §5.4 **无定义** ⇒ 必须报红（判据只是「一句编号」，P-1）',
    !r7cMiss.ok && /找不到定义/.test(r7cMiss.problems.join(' ')),
    `problems=${JSON.stringify(r7cMiss.problems.slice(0, 1))}`)
  t('★负控7c-②：报红**点名缺哪条**（P-12）',
    /P-12/.test(r7cMiss.problems.join(' ')), r7cMiss.problems.find(p => /找不到定义/.test(p))?.slice(0, 90) ?? '')
  //   ③ ★ 杠杆（P-20）：**只把 §5.4 补上 P-12** ⇒ 必须转绿
  t('★杠杆7c：仅把 §5.4 补上 P-12 ⇒ 必须转绿（证明负控不是恒定红）',
    checkDoc(pJudges(12, 12, 12), { methodText: methodFor(12) }).ok, '')
  //   ④ ★ 负控：§5.4 里出现索引外的编号（P-99）⇒ 报红（正向：漏登记到索引）
  const r7cBeyond = checkDoc(pJudges(12, 12, 12), { methodText: methodFor(12, { extra: [99] }) })
  t('★负控7c-③：§5.4 出现索引之外的编号（P-99）⇒ 报红（漏登记）',
    !r7cBeyond.ok && /索引之外/.test(r7cBeyond.problems.join(' ')),
    `problems=${JSON.stringify(r7cBeyond.problems.slice(0, 1))}`)
  //   ⑤ ★ 零控：切不出 §5.4 ⇒ **fail-closed 报红**（切面失效不得与通过同貌，P-30）
  t('★零控7c：方法论切不出 §5.4 ⇒ **fail-closed 报红**（否则「未检查」与「通过」同貌，P-30）',
    !checkDoc(pJudges(12, 12, 12), { methodText: H('## 六、开放项') }).ok, '')
  //   ⑥ ★ 零控：显式声明「没有方法论」⇒ 只出声、不报红（P-43）
  const r7cNoM = checkDoc(pJudges(12, 12, 12), { methodText: null })
  t('★零控7c-②：读不到方法论 ⇒ 只出声不报红（P-43：无判据力不得判 FAIL）',
    r7cNoM.ok && r7cNoM.notes.some(n => /方法论/.test(n)), `ok=${r7cNoM.ok} notes=${JSON.stringify(r7cNoM.notes.slice(0, 2))}`)

  // ---- 零控 ⑦：没有 §九 索引 ⇒ **只提示不报红**（P-38：职责是「三处一致」而非「必须有 §九」）----
  const r7f = checkDoc(good, { methodText: M_OK })
  t('零控7：样本无 §九 索引 ⇒ 判据 ⑦ 只出声、不报红（不当通过也不误伤）',
    r7f.ok && r7f.notes.some(n => /§九/.test(n)), `ok=${r7f.ok} notes=${JSON.stringify(r7f.notes.slice(0, 1))}`)

  // ---- 零控：ⓘ 缩进**只提示不报红**（守 P-38：过宽 ⇒ 假红 ⇒ 训练人忽略报警）----
  const indented = good.replace('| C1 | 说明 1 | 级别 |', ' | C1 | 说明 1 | 级别 |')
  const r6 = checkDoc(indented)
  t('零控：行首缩进 ⇒ **只提示、不报红**（GFM ≤3 空格仍认表格行，不丢信息）',
    r6.ok && r6.notes.some(n => /缩进/.test(n)), `ok=${r6.ok} notes=${r6.notes.length}`)

  // ---- 零控 2：反引号里的竖线**不得**让列数虚高（P-41 推论四形态）----
  const pipe = good.replace('| C1 | 说明 1 | 级别 |', '| C1 | `rp/session-(rollback|edit|regenerate)` | 级别 |')
  t('零控2：反引号内含 `|` ⇒ 不得虚高列数（不报红）',
    checkDoc(pipe).ok, checkDoc(pipe).problems.slice(0, 1).join(''))

  // ---- ★★ 判据⑧：§十一 下的 `### 11.x` 小节必须**登记**（W52 新增）----
  //   ① 正控：真实仓库的全部小节都已在 SECTIONS 登记 ⇒ 不报红（见下真实仓库段）
  //   ② ★ 负控：**模拟「新增一个未登记的小节」** ⇒ 必须报红
  const withExtra = good.replace(/^(## 十二、)/m, '### 11.9 新增小节（未登记）\n\n| # | 排查面 | 结论 |\n|---|---|---|\n| Z1 | x | y |\n\n$1')
  t('★负控⑧：新增**未登记**的 `### 11.x` 小节 ⇒ **必须报红**（否则它的行会被上一节吞并而闸门报绿）',
    !checkDoc(withExtra).ok && /未登记的小节/.test(checkDoc(withExtra).problems.join(' ')),
    checkDoc(withExtra).problems.slice(0, 1).join(''))
  t('★杠杆⑧：把该小节**登记**（加入 SECTIONS 语义）后 ⇒ **不得再报该条**（证明负控不是恒定红）',
    !/未登记的小节/.test(checkDoc(good).problems.join(' ')), '')
  //   ③ 负控：登记了但文档里没有该小节 ⇒ 报红（切面失效）
  const regGhost = good // 真实仓库里 §11.4 存在；此处用「删掉 §11.4 标题」的文本模拟
  t('★负控⑧b：登记的小节在文档里**找不到标题** ⇒ **必须报红**（切面失效，P-30）',
    !checkDoc(regGhost.replace(/^###\s*11\.4.*$/m, '')).ok,
    checkDoc(regGhost.replace(/^###\s*11\.4.*$/m, '')).problems.slice(0, 1).join(''))

  // ---- ★★ 判据⑨：§11.4 引用的工作面编号必须**可达**（W68 新增）----
  //   ★ 为什么必须补（**P-59 纪律③**）：W68 新加的这条判据若不覆盖，就是**永远测不到的死判据**。
  //   ★ 控必须**成对**（W67 的教训）：① 不可达 ⇒ 报红；② 三种可达形态**各自**⇒ 不报红。
  //   ★ 合成样本自给自足（P-40 家族：不得依赖真实文档的形状）。
  {
    const mk = (s114) => [
      '## 十一、当前工作面', '',
      '### 11.1 立刻可做', '',
      '| # | 工作面 | 轨道 | 状态 |', '|---|---|---|---|',
      '| W1 | x | A | ✅ |', '',
      '### 11.2 须真机', '',
      '| # | 工作面 | 轨道 | 状态 |', '|---|---|---|---|', '| W2 | y | A | 🚫 |', '',
      '### 11.3 长期持续', '',
      '| # | 工作面 | 说明 |', '|---|---|---|', '| W3 | z | P 系列 |', '',
      '### 11.4 负结论登记', '',
      '| # | 排查面 | 结论 |', '|---|---|---|', s114, '',
      '## 十二、起步动作', ''
    ].join('\n')
    // ① 不可达 ⇒ 必须报红（**W68 实测的真缺陷形态**：引用 `W55` 而全篇无对应）
    const bad1 = mk('| N1 | 某排查 | ★ 不是缺陷（**W55 排查**）：x |')
    t('★★负控⑨：§11.4 引用 `W55` 而 §11.1~§11.3 **全无对应**、行内也无说明 ⇒ **必须报红**',
      !checkDoc(bad1).ok && /必然扑空/.test(checkDoc(bad1).problems.join(' ')),
      checkDoc(bad1).problems.slice(0, 1).join('').slice(0, 110))
    // ② 有独立行 ⇒ 不报红
    t('★正控⑨a：引用的编号在 §11.1 有**独立行** ⇒ 不得报红',
      !/必然扑空/.test(checkDoc(mk('| N1 | 某排查 | ★ 不是缺陷（**W1 排查**）：x |')).problems.join(' ')), '')
    // ③ 被别处提及 ⇒ 不报红
    const ok3 = mk('| N1 | 某排查 | ★ 不是缺陷（**W3 排查**）：x |')
    t('★正控⑨b：引用的编号在 §11.3 有独立行 ⇒ 不得报红',
      !/必然扑空/.test(checkDoc(ok3).problems.join(' ')), '')
    // ④ ★ 行内就地说明 ⇒ 不报红（**推荐形态** —— 只做排查的轮次不该硬造工作面行）
    t('★正控⑨c：行内**就地说明其身份**（`W55 即…该轮只做排查`）⇒ 不得报红',
      !/必然扑空/.test(checkDoc(mk('| N1 | 某排查 | ★ 不是缺陷（**W55 排查** —— ★ W55 即某轮的纯排查工作：该轮未产出工作面编号行，故此处就地说明其身份） |')).problems.join(' ')), '')
    // ⑤ 零控：§11.4 无任何 W 引用 ⇒ 不得报红（无判据力不判，P-43）
    t('★零控⑨：§11.4 里**没有任何 W 引用** ⇒ 不得报红（P-43）',
      !/必然扑空/.test(checkDoc(mk('| N1 | 某排查 | ★ 不是缺陷：x |')).problems.join(' ')), '')
  }

  // ---- 真实仓库（动态输出）----
  const docPath = process.env.DSH_GOAL_DOC || DOC
  if (fs.existsSync(docPath)) {
    const real = checkDoc(fs.readFileSync(docPath, 'utf8'))
    t('真实仓库：全部已登记小节都可解析且行数合理',
      real.stats.length === SECTIONS.length && real.total >= MIN_TOTAL_ROWS,
      `total=${real.total} stats=${JSON.stringify(real.stats)}`)
    t('真实仓库：0 违规', real.ok, real.problems.slice(0, 2).join(' ｜ '))
  } else {
    t('真实仓库：找不到 GOAL.md ⇒ 判据**未生效**（出声，不当通过）', false, docPath)
  }

  console.log(fail === 0 ? `\n[goalsections selftest] ${total}/${total} PASS` : `\n[goalsections selftest] ${fail} FAIL / ${total}`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）—— 让「文档声明 vs 实际」可被机器对照
  reportSelftest('goalsections', total - fail, total)
  process.exit(fail === 0 ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
//
// ★ 只在**直接执行**时跑（`import` 本模块不得有副作用）—— 否则负控 / 探针引它会顺带
//   把主流程跑一遍（读数混在一起且会污染退出码）。与 `audit-open-items.mjs` 同纪律（P-1）。
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const fi = process.argv.indexOf('--file')
  const target = fi >= 0 && process.argv[fi + 1] ? process.argv[fi + 1] : DOC
  // ★ W54：`--method <path>` 供负控注入**方法论副本**（判据 ⑦c 读它）——
  //   否则负控改不了 §5.4，就无法为本条判据做「注入坏样本 ⇒ 报红」的真实仓库负控（P-1）。
  const mi = process.argv.indexOf('--method')
  const methodTarget = mi >= 0 && process.argv[mi + 1] ? process.argv[mi + 1] : null
  if (!fs.existsSync(target)) {
    console.error(`✗ 找不到 GOAL 文档：${target}`)
    process.exit(2)
  }
  if (methodTarget !== null && !fs.existsSync(methodTarget)) {
    console.error(`✗ 找不到方法论文档：${methodTarget}`)
    process.exit(2)
  }
  const r = checkDoc(fs.readFileSync(target, 'utf8'),
    methodTarget === null ? {} : { methodText: fs.readFileSync(methodTarget, 'utf8') })
  console.log(`[工作面表] ${r.stats.map(s => `§${s.key} ${s.headerCols} 列 / ${s.rows} 行`).join(' · ')}（合计 ${r.total} 行）`)
  for (const n of r.notes) console.log(`  ⓘ ${n}`)
  if (r.ok) {
    console.log('[工作面表] OK —— 三表列数自洽、ID 同表唯一、跨表无复用、项数未跌破下限')
    process.exit(0)
  }
  for (const p of r.problems) console.log(`[工作面表] ✗ ${p}`)
  console.log(`\n[工作面表] 共 ${r.problems.length} 处问题（§十一 是「当前在做哪几件事」的 SSOT，结构坏了会误导后人）`)
  process.exit(1)
}
