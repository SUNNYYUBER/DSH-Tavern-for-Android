#!/usr/bin/env node
/**
 * audit-doc-refs.mjs —— **E-H「文档一致」的引用完整性闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * `GOAL.md` **§八 E-H** 要求「`README.md` / `THIRD_PARTY_LICENSES.md` /
 * `rp-workspace/docs/ST-COMPAT-PACT.md` / `docs/MOBILE-TEST-METHODOLOGY.md`
 * 四份与代码现状一致，**无失效描述**」。
 * ★ 但 **§八 八条验收项里，只有 E-H 完全没有机器守着**（W45 按 P-11 元级排查实测）：
 *   其余七项各有闸门（E-B→`audit-matrix-residuals` / E-C→`audit-baseline-claims` …），
 *   而「文档里引用的脚本/文档是否还在」**全凭人眼** —— 而**删脚本、改路径是每轮高频动作**
 *   （本仓 W42~W45 四轮内就删/改了多个装置）⇒ **文档悄悄悬空**是必然事件。
 *
 * ## 为什么**只**查「可执行/可核验的引用」（守 P-38，防过宽）
 * ★ 首版若查「所有反引号里的路径片段」，实测**一次报 60+ 处假红**（P-45 识别特征）：
 *   正文里的 `preset/compiler.ts` 是**行文简写**（真身 `packages/src/preset/compiler.ts`），
 *   `tmp/j6-seqs.mjs` 是**已清理的临时探针**（史实），`src/dsh-plugin/index.ts` 是**目录简称**。
 *   ⇒ 真目标**不是**「每个路径片段都能解析」，而是：
 *     ⑴ ★ **读者会照着敲的命令**（`` `node scripts/xxx.mjs` ``）—— 路径错了**直接失败**；
 *     ⑵ ★ **明确的位置声明**（`` `scripts/xxx.mjs` `` / `` `docs/xxx.md` ``）—— 位置错了**找不到**。
 *
 * ## 判据（**八条**）
 *   ① **可执行引用**：`` `node|python|bash|pwsh <path>` `` 里的路径必须存在；
 *   ② **`scripts/…` 位置声明**必须真实存在（且**排除泛化示例名**，见下）；
 *   ③ **`docs/…` 位置声明**必须真实存在（两基点并集：仓库根 / `rp-workspace/`）；
 *   ④ ★★ **同行并列装置的「位置不一致」**（**W46 新增 —— 这条抓的是那轮的真缺陷**）：
 *      同一行若**并列陈述 ≥2 个脚本装置**（读者会**默认它们同处**），
 *      而它们**实际所在目录不同** ⇒ 报红（读者按文档去找会扑空）。
 *   ⑤ ★★ **引用目标必须在版本控制内**（**W49 新增 —— 这条抓的是本轮的真缺陷**）：
 *      ①②③ 只证「**在本机磁盘上存在**」，而 **P-53** 指出还有一层：
 *      **被文档点名要存在的东西，必须在「别人克隆得到」的范围里**。
 *      识别特征（本仓实测）：路径落在 `.gitignore` 命中区（如 `tmp/`，
 *      `.gitignore:34`）⇒ **文件在这台机器上存在，但不在版本控制内**
 *      ⇒ 别人克隆后**照文档做必然扑空**，而**本机永远看不出问题**。
 *   ⑥ ★★ **受守面清单必须与它声称的单源一致**（**W65 新增 —— 这条抓的是本轮的真缺陷**）：
 *      `E_H_DOCS` 的注释白纸黑字写着「**单源：与 GOAL §八 E-H 同名单**」，
 *      而**这句话本身没有任何机器守着** ⇒ 两份清单**可以静默分叉**。
 *      ★ W65 决定性实验（都是 exit=0）：⑴ 把 GOAL §八 E-H 行里的
 *      `docs/MOBILE-TEST-METHODOLOGY.md` 换成另一份**真实存在**的文档 ⇒ **四个闸门全不报红**；
 *      ⑵ 从源码 `E_H_DOCS` 里**删掉一份** ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）`
 *      并输出 `OK` —— ★★ **读数行里的「4 份」与「四份 + SSOT」当场自相矛盾，而闸门报绿**（**P-30**）。
 *      ⇒ 纪律（**P-64 的落地**）：「声称单源」是一个**可判定的断言**，
 *      必须有一条判据问**「它现在真的同源吗」**（否则该声称**在写下的一刻就开始过期**，**P-27**）。
 *      ★ 解析口径：GOAL 侧**按 `\`([^\`]*\.md)\`` 抽**（E-H 行点名的文档名），
 *      代码侧抽 `E_H_DOCS` / `SSOT_DOCS` 的二元组**首元素**；
 *      两侧都做**路径归一化**（去 `docs/` / `rp-workspace/docs/` 前缀）后**逐项比对**。
 *      ★ 诚实边界（R7）：本判据只证「**两份清单的字面名单一致**」，
 *      **不证明**「GOAL 换了一份文档后，那份文档真的被完整扫过」（那取决于该文档是否真存在于磁盘）。
 *   ⑦ ★★ **跨文档章节引用必须可达**（**W69 新增 —— 这条抓的正是本轮的真缺陷**）：
 *      读者按「**<某文档> §x.y**」翻过去，**那里必须有这一节**。
 *      ★ 这是 **P-52**（按「读者能否按它找到」判）与 **P-68**（文档**内部**编号引用可达）
 *      **之间那一格**：**点名了文档、又给了章节号**的跨文档引用 ——
 *      此前**五个闸门全都不报红**（见 `scanXDocSectionProblems` 头注的决定性实验）。
 *      ★ 口径三条（全部由「防假红」逼出）：**紧贴**（别名后紧接 `§x.y`）·
 *      **自指不算跨文档**（本文件里也有该编号）· **目标读不到只出声**（P-43）。
 *      ★★ **引用侧 mask、定义面读全文** —— 两件事的扫描面**本就不同**（**P-45**）：
 *      方法论 §6.x 的逐轮结论小节**全落在它自己的史实区内**，若把定义面也 mask
 *      ⇒ 真实存在的 §6.38/§6.24/§6.26/§6.37 会被判成「没有这一节」⇒ **4 处假红**（W69 实测）。
 *   ⑧ ★★ **行号式引用必须「目标存在」且「行号在范围内」**（**W79 新增 —— 这条抓的是
 *      **P-52 家族的第四格**）：**P-52** 判「文件在不在」· **P-69** 判「跨文档章节在不在」·
 *      **P-68** 判「文件内编号有没有定义」，★ 而**行号**这一粒度**从未被守** ——
 *      它是**最易腐烂**的引用（任何编辑都会移位）。
 *      ★★ **W79 决定性实验（该面整类无守）**：三处独立注入「行号越界」
 *      （`build-dsht.ps1:228` → `:9999` 等）+ 三个子面注入（目标文件不存在 / `:N` 越界）⇒
 *      **六个闸门全部 exit=0**（逐字节还原自证）。
 *      ★ 口径四条（全部由「防假红」逼出，守 **P-38 / P-45 / P-46 / P-43**）：
 *      **只认本仓可解析的目标**（第三方基准实现只出声）· **同名多处 ⇒ 不判** ·
 *      **自指 ⇒ 不判** · **必须要求路径含扩展名**（否则普通冒号 `时间:2026` 会中招）。
 *      ★★ **解析器单源** `makeLineRefResolver`（**P-1**）：主流程与 selftest 共用同一份口径 ——
 *      ★ W79 实测踩到「只改一处 ⇒ 对同一条引用给出**相反结论**」（**P-46**）。
 *
 * ## ★★ 扫描面（**W49 扩**）：E-H 四份 **+ SSOT 自身**
 * ★ 为什么必须加 **`docs/GOAL.md`**：它是**本 goal 的唯一事实来源**，
 *   每轮都被读者（含未来的 AI）**照着执行**；而它此前**不在任何引用完整性闸门的扫描面内**
 *   —— W49 实测：§3.1 的「怎么跑」列有两处直接指向 `tmp/` 里的临时探针（**判据⑤ 当场抓到**）。
 * ★ 但 **GOAL §十一 是史实区**（逐轮工作面记录，每行数千字的"当时做了什么"），
 *   其中的引用**在写下时是真的** ⇒ 对本区做引用判据会**永远报红**
 *   （W49 实测：不 mask 会立刻多出 2 处判据④ 假红）。
 *   ⇒ 按**区段语义**与既有口径对齐（**P-1**：`audit-selftest-claims.mjs` 的
 *     `isCurrentStateSection` 早就把 §十一 划为史实区，两处必须**同一口径**）。
 *
 * ## ★ 为什么需要第④条（本仓实测的真缺陷）
 * 方法论 **§5.4 的 P-4 定义行**（第 286 行）在讲「事前探针此前无实现」时并列写了三个装置：
 * `` `capture-contracts.mjs` `` / `` `diff-contracts.mjs` ``（真身在 `rp-workspace/scripts/`）
 * 与 `` `session-contract-probe.mjs` ``（真身**在 `rp-workspace/packages/tests/`**）
 * —— 读者会**默认三者同在 `scripts/`**，去那里找第三个必然扑空。
 * ★ 判据①②③**都抓不到它**：①它是裸名（无可执行形态）、②③它不带路径前缀 ⇒
 *   **必须新开一条按「同行并列关系」判的判据**（P-30：判据失效时输出与通过完全相同）。
 *
 * ## ★★ 排除口径（**必须**，否则判据会报假红 —— 本仓实测 4 处）
 *   ⑴ **泛化示例名**（`x.mjs` / `xxx.mjs` / `foo.mjs` …）：正文里用它泛指「某个脚本」，
 *      **不是**在声明一个真装置 ⇒ 认了必然假红（W45 记账号里 3 处都是这个形态）；
 *   ⑵ **同行有「否定/反事实」标记**（`不存在` / `已删` / `负控` / `假证据` / `若新建` /
 *      `幻影` …）：那是**刻意举例**或**史实**，不是当前声明。
 *   ★ 这两条是**语义口径**（守 P-45：**别用写法近似语义** —— W45 的教训）。
 *
 * ## 诚实边界（R7）
 *   本闸门只证明「**文档里被点名要存在的东西确实存在**」，
 *   **不证明**「文档描述与代码行为一致」（那需逐条人工/专项判据）——
 *   它挡的是「文档悄悄悬空」这一**最廉价但最高频**的失效形态。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出悬空引用    2 = 环境问题（文档缺失）    3 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-doc-refs.mjs --selftest
 *   node scripts/audit-doc-refs.mjs
 *   node scripts/audit-doc-refs.mjs --file <path>   （供负控在临时副本上演练）
 *   node scripts/audit-doc-refs.mjs --file <path> --as <文档名>
 *       # `--as`：**副本必须仍按它原本的身份判**（否则区段语义失效 —— 史实区不 mask ⇒ 报假红，见 W49）
 *       # ★ W77 补：此前实现已支持 `--as` 而**用法行没写** ⇒ 能力不可发现
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')

/** E-H 点名的四份文档（**单源**：与 GOAL §八 E-H 同名单） */
export const E_H_DOCS = [
  ['README.md', path.join(ROOT, 'README.md')],
  ['THIRD_PARTY_LICENSES.md', path.join(ROOT, 'docs', 'THIRD_PARTY_LICENSES.md')],
  ['ST-COMPAT-PACT.md', path.join(WS, 'docs', 'ST-COMPAT-PACT.md')],
  ['MOBILE-TEST-METHODOLOGY.md', path.join(ROOT, 'docs', 'MOBILE-TEST-METHODOLOGY.md')]
]
/**
 * ★★ **SSOT 自身**（**W49 扩** —— 见头注「扫描面」）。
 *
 * 为什么它必须被扫：`docs/GOAL.md` 是**本 goal 的唯一事实来源**，
 * **每一轮**都有人（或 AI）照着它里面的命令去做；而它此前**不在任何引用完整性闸门的扫描面内**
 * ⇒ 里面的引用**悬空了也没有机器知道**。
 * ★ W49 实测（**判据⑤ 当场抓到**）：§3.1「真实卡抽样/会话可投影性」行的「怎么跑」列
 *   指向 `rp-workspace/tmp/w32-all-projectable.mjs` 与 `w36-v0-migrate-fold.mjs`
 *   —— 两者**都在 `.gitignore:34` 命中区内** ⇒ 本机看着好好的，
 *   **别人克隆后这两个文件根本不存在**（P-53）。
 */
export const SSOT_DOCS = [
  ['GOAL.md', path.join(ROOT, 'docs', 'GOAL.md')]
]
/** 本闸门的**实际扫描面**（E-H 四份 + SSOT） */
export const SCAN_DOCS = [...E_H_DOCS, ...SSOT_DOCS]

/**
 * ★★ **判据⑥：受守面清单必须与它声称的单源一致**（**W65 新增**）。
 *
 * ## 为什么必须有（守 **P-27 / P-30 / P-64**）
 * `E_H_DOCS` 上方的注释写着「**单源：与 GOAL §八 E-H 同名单**」——
 * 而**这句声称本身没有任何机器守着** ⇒ 两份清单**可以静默分叉**：
 * GOAL 那边改了名单（或这边删了一项），**报告上完全同貌**（P-30）。
 * ★ W65 决定性实验（都是 exit=0，即**全都不报红**）：
 *   ⑴ 把 GOAL §八 E-H 行里的 `docs/MOBILE-TEST-METHODOLOGY.md`
 *      换成另一份**真实存在**的文档 ⇒ 四个闸门全不报红；
 *   ⑵ 从源码 `E_H_DOCS` 里**删掉一份** ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）` 且输出 `OK`
 *      —— ★★ **读数行自己当场自相矛盾**（「4 份」vs「四份 + SSOT」）**而闸门报绿**。
 *
 * ## 纪律（**P-64 的落地**）
 * 「声称单源」是一个**可判定的断言**，必须有一条判据问「**它现在真的同源吗**」——
 * 否则该声称**在写下的一刻就开始过期**（**P-27**）。
 * ★ 这就是 **P-62**（「我已把机制收成一处」这句话本身也必须被机器守）
 * 在**清单/名单**上的现身形态。
 *
 * ## 解析口径（P-41：锚到决定结果的事实）
 *   · GOAL 侧：从 **§八 E-H 那一行**按 `` `([^`]*\.md)` `` 抽文档名 ——
 *     不是「扫全文找 .md」（那会把 §附录 的外链算进来 ⇒ 假红，P-38）。
 *   · 代码侧：抽 `E_H_DOCS` / `SSOT_DOCS` 二元组的**首元素**（声明名）。
 *   · 两侧都做**路径归一化**（去 `docs/` / `rp-workspace/docs/` 前缀）后**逐项比对**。
 *   · ★ E-H 只比 `E_H_DOCS`（**不含 SSOT**）—— GOAL §八 E-H 的原文只点名「四份」，
 *     SSOT 是 **W49 主动扩**的，属「比承诺多守一份」（更严），**不得**因此报红。
 *
 * @param {string} goalText  GOAL.md 全文
 * @param {string[]} eHDocIds 代码侧 E_H_DOCS 的声明名（如 `['README.md', …]`）
 * @returns {string[]} 违规描述（空数组 = 一致）
 */
export function scanFaceSotProblems (goalText, eHDocIds = []) {
  const lines = String(goalText ?? '').split(/\r?\n/)
  const eHLine = lines.find(l => /^\|\s*\*\*E-H\*\*/.test(l))
  // ★ 切面失效 ⇒ fail-closed（读不到 E-H 行 = 判据无判据力，不能当 0 违规 —— P-30）
  if (!eHLine) return ['**切不出 §八 E-H 行** ⇒ 本判据**无法判定**（fail-closed：不许当 0 违规，P-30）']
  const norm = (s) => String(s).trim()
    .replace(/^\.\//, '')
    .replace(/^rp-workspace\/docs\//, '')
    .replace(/^docs\//, '')
  const declared = [...eHLine.matchAll(/`([^`]*\.md)`/g)].map(m => norm(m[1]))
  const coded = eHDocIds.map(norm)
  // ★ 零样本冒充通过（P-30 最危险形态）
  if (declared.length === 0 || coded.length === 0) {
    return [`**名单为空**（GOAL 侧 ${declared.length} 项 / 代码侧 ${coded.length} 项）⇒ 本判据**无法判定**（fail-closed）`]
  }
  const problems = []
  const cSet = new Set(coded), dSet = new Set(declared)
  for (const d of declared) {
    if (!cSet.has(d)) problems.push(`GOAL §八 E-H 声明守 \`${d}\`，而代码受守面**没有它** ⇒ **声称的单源不成立**（P-27）`)
  }
  for (const c of coded) {
    if (!dSet.has(c)) problems.push(`代码受守面守着 \`${c}\`，而 GOAL §八 E-H **没点名它** ⇒ 两份清单**已分叉**（P-30；要么补进 GOAL，要么从受守面移除并写明理由）`)
  }
  return problems
}

/**
 * ★★ **跨文档章节引用的「文档别名 → 目标文档名」表**（**判据⑦ 用 · W69 新增**）。
 *
 * ★ 为什么必须**显式列表**（守 **P-45**：判据的扫描面必须与真目标对齐）：
 *   本仓的跨文档引用**不写全名**，而是写惯用简称（「方法论 §6.38」「契约 §附录四」）。
 *   靠**近似匹配**（如「含 `TEST` 就算方法论」）会在措辞变化时**静默失效**
 *   ⇒ 与 W66/W67 的 `READING_PAIRS` 同一条纪律：**配对必须显式登记，不得靠猜**。
 *
 * ★ 为什么**必须紧贴**（守 **P-67 纪律②**）：别名与 `§` 之间只允许极短的连接成分
 *   （空格 / 反引号 / 强调符 / 「的」），因为「别名 ⇒ 章节号」是一个**句法关系**；
 *   若允许任意距离，行内的**其它** `§x.y`（讲别的事）会被错认成它的目标 ⇒ 假红（**P-38**）。
 */
export const XREF_DOC_ALIAS = [
  ['方法论', 'MOBILE-TEST-METHODOLOGY.md'],
  ['MOBILE-TEST-METHODOLOGY.md', 'MOBILE-TEST-METHODOLOGY.md'],
  ['契约', 'ST-COMPAT-PACT.md'],
  ['ST-COMPAT-PACT.md', 'ST-COMPAT-PACT.md'],
  ['V0.3-FREEZE', 'V0.3-FREEZE.md'],
  ['TASK-LIST', 'TASK-LIST.md'],
  ['README', 'README.md'],
  ['GOAL', 'GOAL.md']
]
/** 别名与 `§` 之间允许的连接成分（**紧贴**：≤3 个非标识符字符） */
const XREF_GAP = /^[\s`*]{0,3}[的]?[\s`*]{0,2}§\s*(\d+\.\d+)\b/

/**
 * **章节编号的「定义面」**：标题行里的编号（`### 5.4 …` / `## §4.18 …` / `## 6.65 …`）。
 *
 * ★ 为什么**只认标题**（守 **P-41**：锚到决定结果的事实）：
 *   读者按「方法论 §6.38」去找的是**那一节**——决定「找不找得到」的事实是
 *   **那里有没有这一节**，而不是「这个字符串在文档里出现过没有」。
 * ★ 为什么不把「正文里提到过该编号」也算可达：那会让**同一段文字自己给自己作证**
 *   （提到 ⇒ 可达 ⇒ 不报红），判据立刻失去判据力（**P-30**）。
 */
export function sectionIdsOf (text) {
  const out = new Set()
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = l.match(/^\s{0,3}#{1,6}\s*§?\s*(\d+(?:\.\d+)+)\b/)
    if (m) out.add(m[1])
  }
  return out
}

/**
 * ★★ **判据⑦：跨文档章节引用必须可达**（**W69 新增 —— 这条抓的正是本轮的真缺陷**）。
 *
 * ## 为什么必须有（守 **P-52 / P-68 / P-27**）
 * **P-52** 确立了「引用的完整性必须按**读者能否按它找到**判」，**P-68** 把它推到
 * **文件内部的编号引用**。★ 本条补上中间那一格：**点名了某份文档、又给了章节号**的引用 ——
 * 读者会**跨过去翻那一节**；若那一节不存在，**照样必然扑空**，而此前**五个闸门全都不报红**。
 *
 * ★ **W69 决定性实验（全是 exit=0，即全不报红）**：把 `GOAL.md` §九 那句
 * `docs/MOBILE-TEST-METHODOLOGY.md` §5.4 改成 **§5.99**（方法论里无此节）⇒
 * `audit-doc-refs` / `audit-goal-sections` / `audit-baseline-claims` /
 * `audit-rule-claims` / `audit-selftest-claims` **五个闸门全部 exit=0**。
 * ⇒ 真实仓库当时 61 处跨文档章节引用**恰好全部可达** —— **运气不是判据力**（W45 的识别特征）。
 *
 * ## 口径（三条，全部由「防假红」逼出）
 *   ⑴ ★★ **紧贴**：别名后紧接 `§x.y` 才算它的目标（见 `XREF_GAP`）；
 *   ⑵ ★★ **自指不算跨文档**：本文件里**也有**该编号 ⇒ 视为本文件内引用（判据⑦ 不管）；
 *   ⑶ ★★ **目标文档读不到 ⇒ 只出声不报红**（**P-43**：换机 / CI 可能没有那份文档）。
 *
 * @param {string} text       被检文档全文（**已被 mask**：判据⑦ 只判「当前状态区」的引用）
 * @param {string} docLabel   被检文档名（用于跳过自指）
 * @param {(name:string)=>string|null} readDoc  按文档名读**未 mask 的全文**（读不到返回 null）
 * @param {string[]} [aliases] 仅测试用：覆盖别名表
 * @param {string} [selfFullText] 被检文档的**未 mask 全文**（用于算「本文件有哪些章节」）
 * @returns {{problems:string[], checked:number, unreadable:number, note:string}}
 */
export function scanXDocSectionProblems (text, docLabel, readDoc, aliases = XREF_DOC_ALIAS, selfFullText = text) {
  const lines = String(text ?? '').split(/\r?\n/)
  // ★★ 自指判定必须用**未 mask 的全文**（**W69 实测踩到的判据自身缺陷**）：
  //   若拿 mask 过的正文算 `own`，本文件落在史实区里的章节标题会被抹掉 ⇒
  //   把「本文件内引用」误判成「跨文档引用」⇒ **假红**（同一形态 W54 踩过一次）。
  const own = sectionIdsOf(selfFullText)
  const cache = new Map()
  const problems = []
  let checked = 0
  let unreadable = 0
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    for (const [alias, target] of aliases) {
      if (target === docLabel) continue                    // ⑵ 自指
      let from = 0
      while (true) {
        const at = l.indexOf(alias, from)
        if (at < 0) break
        from = at + alias.length
        const m = l.slice(from).match(XREF_GAP)
        if (!m) continue
        const id = m[1]
        if (own.has(id)) continue                          // ⑵ 本文件内也有 ⇒ 非跨文档
        checked += 1
        if (!cache.has(target)) cache.set(target, readDoc(target))
        const tgt = cache.get(target)
        if (tgt === null || tgt === undefined) { unreadable += 1; continue }  // ⑶ 无判据力
        if (!sectionIdsOf(tgt).has(id)) {
          problems.push(`${docLabel} 第 ${i + 1} 行：点名「${target}」的 §${id}，`
            + `而该文档里**没有这一节** ⇒ 读者翻过去**必然扑空**（**P-52/P-68**）`
            + ` ⇒ 二选一：⑴ 改成真实存在的章节号；⑵ 该节若已改名/并入别处，同步改写引用`)
        }
      }
    }
  }
  // ★ 零样本与不可读都必须出声（否则「未检查」与「通过」同貌 —— P-30）
  if (checked === 0 && unreadable === 0) {
    return { problems, checked, unreadable, note: '本文件**不含**跨文档章节引用 ⇒ 判据⑦ 无对象可判（P-43，不出声即是噪音）' }
  }
  return { problems, checked, unreadable, note: unreadable ? `其中 ${unreadable} 处因**目标文档读不到**而未判定（P-43）` : '' }
}

/**
 * ★★ **判据⑧：行号式引用必须「目标存在」且「行号在范围内」**（**W79 新增**）。
 *
 * ## 为什么必须有（守 **P-52 / P-69 / P-27**）
 * **P-52** 判「文件在不在」· **P-69** 判「跨文档章节在不在」· **P-68** 判「文件内编号有没有定义」，
 * ★ 本条补上**第四格**：**点名了文件、又给了行号**的引用（`build-dsht.ps1:228` / `方法论 … 第 286 行`）。
 * 读者按它去翻**那一行** —— 而**行号是最易腐烂的引用**（任何一次编辑都会移位）。
 *
 * ## ★★ W79 决定性实验（该面**整类无守**）
 * 三处独立注入「行号越界」（`build-dsht.ps1:228` → `:9999` · `build-dsht.ps1:211-230` → `:9998-9999` ·
 * `build-dsht.ps1` 里登记的 `（§3.1 第 74 行）` → `第 9999 行`），以及三个子面注入
 * （**目标文件名不存在** ×2 · **`:N` 形态越界**）⇒
 * `audit-selftest-claims` / `audit-baseline-claims` / `audit-doc-refs` / `audit-goal-sections` /
 * `audit-artifact-freshness` / `audit-rule-claims` **六个闸门全部 exit=0**（W79 实测，逐字节还原自证）。
 * ★ 藏得住的原因：**行号引用的「目标还在」与「行号还对」是两件事** ——
 *   文件在、章节在，读者**不会怀疑行号**；而「越界」与「准确」在报告上**完全同貌**（**P-30**）。
 *
 * ## 口径（四条，全部由「防假红」逼出 —— 守 **P-38 / P-45**）
 *   ⑴ ★★ **只认「本仓可解析」的目标**：本仓**大量**行号引用指向**第三方基准实现**
 *      （`dsh-session/lib/types/surface.js:12-18` / `JS-Slash-Runner/src/function/variables.ts:211-223`）
 *      —— 那些文件**不在本仓**，**无法也不该**验证 ⇒ **只出声**（**P-43**：无判据力不判 FAIL）。
 *   ⑵ ★★ **同 basename 多处 ⇒ 不判**：`script.js` 在本仓有多个同名文件
 *      ⇒ 「越界」的结论**取决于解析到哪一个** ⇒ 解析不唯一时**只出声**
 *      （**P-46**：同一读数不得有两种相反解释）。
 *   ⑶ ★★ **引用的目标就是本文件自己 ⇒ 不判**（自指；本判据判的是「跨文件」的行号引用）。
 *   ⑷ ★★ **区间形态 `a-b` 必须两端都在范围内**，且 `b >= a`（写反了也是缺陷）。
 *
 * ## 诚实边界（R7）
 *   本判据**只证「行号在文件范围内」**，**不证「那一行的内容就是引用所要讲的东西」**
 *   —— 后者是**语义**判断（行号会随编辑**移位到别的行**，而文件长度没变 ⇒ 「范围内」不报红）。
 *   ★ 该边界已在 W79 报告里如实登记（见 §11.4 N22）。
 *
 * @param {string} text      被检文档全文（**已被 mask**：只判当前状态区的引用）
 * @param {string} docLabel  被检文档名（用于跳过自指）
 * @param {(ref:string)=>{target:string|null, ambiguous:boolean, total:number|null}} resolveRef
 *   **引用路径 → 本仓目标**（`target=null` 表示**非本仓 / 不可解析**；`ambiguous` 表示同名多处）
 * @returns {{problems:string[], checked:number, notes:string[], external:number}}
 */
export function scanLineRefProblems (text, docLabel, resolveRef) {
  const problems = []
  const notes = []
  let checked = 0
  let external = 0
  // ★ 形态：`<path-like>:<N>`（可带 `-M` 区间）。★ **必须要求路径含扩展名**，否则会吃掉
  //   正文里的普通冒号（如 `时间:2026`）—— 首版若只认 `\w+:\d+` 会大量假红（P-38）。
  const RE = /([A-Za-z0-9_\-][A-Za-z0-9_\-./]*\.(?:mjs|cjs|js|ts|tsx|py|ps1|sh|kt|md|json|txt|cjs)):(\d+)(?:\s*[-–~]\s*(\d+))?/g
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    for (const m of l.matchAll(RE)) {
      const ref = m[1]
      const a = Number(m[2])
      const b = m[3] ? Number(m[3]) : null
      // ⑶ 自指：引用的就是本文件
      if (ref === docLabel || ref.endsWith('/' + docLabel)) continue
      const r = resolveRef(ref)
      if (!r || r.target === null) { external += 1; continue }   // ⑴ 非本仓 ⇒ 只出声
      if (r.ambiguous) {
        notes.push(`${docLabel} 第 ${i + 1} 行：\`${ref}\` 在本仓有**多个同名文件** ⇒ 解析不唯一，`
          + `越界与否取决于解析到哪一个 ⇒ **不判**（P-46：同一读数不得有两种相反解释）`)
        continue
      }
      if (r.total === null || !Number.isFinite(r.total)) { external += 1; continue }
      checked += 1
      const span = b === null ? `${a}` : `${a}-${b}`
      if (b !== null && b < a) {
        problems.push(`${docLabel} 第 ${i + 1} 行：\`${ref}:${span}\` 的**区间写反了**（起 ${a} > 止 ${b}）`
          + ` ⇒ 读者按它去翻**必然扑空**（**P-52**）`)
        continue
      }
      const over = a > r.total || a < 1 || (b !== null && b > r.total)
      if (over) {
        problems.push(`${docLabel} 第 ${i + 1} 行：\`${ref}:${span}\` **越界** —— `
          + `\`${r.target}\` 实测**只有 ${r.total} 行**，而引用指向第 ${span} 行`
          + ` ⇒ 读者按它去翻**必然扑空**（**P-52/P-69**：行号是最易腐烂的引用）`
          + ` ⇒ 二选一：⑴ 改行号；⑵ 若该内容已移位，改成**可定位的锚点**（如函数名 / 章节号）`)
      }
    }
  }
  return { problems, checked, notes, external }
}

/**
 * ★★ **判据⑧ 的单源解析器**（**W79 新增**）：把引用路径解析为**本仓唯一文件 + 行数**。
 *
 * ## 为什么要抽成单源（**P-1**）
 * 主流程与 selftest 的**真实仓库控**都要用它 —— ★ 若各写一份，就会「**口径改了只改一处**」
 * （W79 实测踩到：主流程修了「带前缀不得回退到裸 basename」，而 selftest 里那份没修
 * ⇒ 两处对同一条引用给出**相反结论**，正是 **P-46** 的形态）。
 *
 * ## 口径（三条，全部由「防假红」逼出 → 见 `scanLineRefProblems` 头注）
 *   ⑴ **完整相对路径 / 后缀** 能唯一命中 ⇒ 用它；
 *   ⑵ ★★ **带目录前缀而后缀匹配失败 ⇒ 判「非本仓」**（**不**回退到裸 basename）——
 *      本仓有**第三方基准实现**的引用（`JS-Slash-Runner/src/function/variables.ts:211-223`），
 *      而本仓**恰好**也有同名 basename ⇒ 回退会把**外部引用**误判成本仓文件 ⇒ **越界假红**（**P-45**）；
 *   ⑶ **裸 basename 多处 ⇒ `ambiguous`**（**不判** —— **P-46**）。
 *
 * @param {string} rootDir 仓库根
 * @returns {(ref:string)=>{target:string|null, ambiguous:boolean, total:number|null}}
 */
export function makeLineRefResolver (rootDir) {
  const bySuffix = new Map()
  const byBase = new Map()
  const SKIP_DIR = /(^|[\\/])(node_modules|\.git|dist|build|__pycache__|\.gradle|stage3-device|logs|tmp)([\\/]|$)/
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!SKIP_DIR.test(p + path.sep)) walk(p); continue }
      if (!/\.(mjs|cjs|js|ts|tsx|py|ps1|sh|kt|md|json|txt)$/.test(e.name)) continue
      const rel = path.relative(rootDir, p).replace(/\\/g, '/')
      if (!bySuffix.has(rel)) bySuffix.set(rel, rel)
      if (!byBase.has(e.name)) byBase.set(e.name, [])
      byBase.get(e.name).push(rel)
    }
  }
  try { walk(rootDir) } catch { /* 索引失败 ⇒ 一律 target=null ⇒ 只出声（P-43） */ }
  const totalLines = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8').split(/\r?\n/).length
  return (ref) => {
    const norm = String(ref ?? '').replace(/\\/g, '/')
    if (bySuffix.has(norm)) return { target: norm, ambiguous: false, total: totalLines(norm) }
    const cands = [...bySuffix.values()].filter(r => r.endsWith('/' + norm))
    if (cands.length === 1) return { target: cands[0], ambiguous: false, total: totalLines(cands[0]) }
    if (cands.length > 1) return { target: cands[0], ambiguous: true, total: null }
    // ⑵ ★★ 带目录前缀而后缀匹配失败 ⇒ **非本仓**（绝不回退到裸 basename）
    if (norm.includes('/')) return { target: null, ambiguous: false, total: null }
    const bs = byBase.get(norm) ?? []
    if (bs.length === 1) return { target: bs[0], ambiguous: false, total: totalLines(bs[0]) }
    if (bs.length > 1) return { target: bs[0], ambiguous: true, total: null }
    return { target: null, ambiguous: false, total: null }   // 非本仓（第三方基准）⇒ 只出声
  }
}

/**
 * ★★ **史实区**（逐轮记录区）—— 必须 mask，否则**永远报红**（P-38）。
 *
 * ★ 判据：按 **`^##` 标题**切换开关（**保留行号**）；每份文档的史实区**由下表单源声明**。
 *   · `GOAL.md` ⇒ `## 十一、`（当前工作面 = 逐轮记录；W45 已由 `isCurrentStateSection` 认定）
 *   · `MOBILE-TEST-METHODOLOGY.md` ⇒ `## 六、`（开放项 + §6.x 逐轮结论）
 *   · `ST-COMPAT-PACT.md` ⇒ `## 附录`（附录四续 N：逐轮 E-H 复核）
 *
 * ★ 为什么必须这么做（**W49 实测**，守 P-38/P-45）：
 *   首版「只 mask GOAL §十一」⇒ 判据⑤ 一次报 **70 处**，其中 **68 处在史实区**
 *   （`证据探针 tmp/probe-xxx.mjs 留仓` 这类**写下时是真的**陈述）——
 *   量级与真缺陷（2 处）严重不符，正是 **P-45 的识别特征**（扫描面与真目标错位）。
 *   ⇒ 与 `audit-selftest-claims.mjs` 的 `isCurrentStateSection` **同一口径**（**P-1**）。
 *
 * ★ 不用「行内有『临时探针』就跳过」这类**写法近似语义** —— 那正是 W45 反复踩的坑。
 */
export const HISTORY_SECTION_RE = {
  'GOAL.md': /^##\s*十一、/,
  'MOBILE-TEST-METHODOLOGY.md': /^##\s*六、/,
  'ST-COMPAT-PACT.md': /^##\s*附录/,
  'README.md': null,
  'THIRD_PARTY_LICENSES.md': null
}

/**
 * @param {string} text
 * @param {string} docLabel  用**文档名**查 `HISTORY_SECTION_RE`（不是「有无 §十一」这一巧合）
 */
export function maskHistorySections (text, docLabel) {
  const re = HISTORY_SECTION_RE[docLabel]
  if (!re) return text
  let inHist = false
  return text.split(/\r?\n/).map((l) => {
    // ★★ 退出条件必须锚到**主章节标题**（`## 十二、` 这种「中文数字 + 、」形态），
    //    而**不是**任意 `^##` —— 因为**史实区内部也有 `##` 级标题**
    //    （方法论 §6.x 逐轮结论就是 `## 6.18 第二十四轮…`）。
    //    ★ W49 实测（本判据自己的 selftest 当场证伪 v1）：用「任意 `^##` 重置开关」⇒
    //      进入 §六 后**下一个 `## 6.x` 立刻把它关掉** ⇒ 整段史实区**根本没被 mask**
    //      （表现：主流程仍报 32 处史实区内的叙述性引用）。
    //    ⇒ 这正是 **P-41 推论二**（锚点失效后转向别处）与 **P-45**（扫描面与真目标错位）。
    if (/^##\s/.test(l)) {
      if (re.test(l)) inHist = true
      else if (MAIN_SECTION_RE.test(l)) inHist = false   // 回到主章节 ⇒ 退出史实区
      // 其它 `##`（如 `## 6.18`）⇒ **保持当前状态**（不重置）
    }
    return inHist ? '' : l
  }).join('\n')
}
/** 「主章节」标题：`## 十二、…` —— 中文数字 + 顿号（史实区内部的 `## 6.x` 不匹配） */
export const MAIN_SECTION_RE = /^##\s*[一二三四五六七八九十]+、/

/**
 * 路径解析（**仓库根相对**，供判据⑤ 查 gitignore）。
 * @returns {string|null}
 */
export function resolveUnder (rel) {
  const r = String(rel).replace(/\\/g, '/')
  for (const c of [r, `rp-workspace/${r}`]) {
    if (fs.existsSync(path.join(ROOT, c))) return c
  }
  return null
}

/**
 * **判据⑤ 的 VCS 检查器**（**W49 新增**）：`git check-ignore` ⇒ 该路径**不在版本控制内**。
 *
 * ★ 为什么锚在 `git check-ignore` 而不是「有没有被 `git ls-files` 收录」：
 *   本仓**大量新增脚本处于 `??`（已添加/未提交）状态** —— 那是**正常开发态**，
 *   若按 `ls-files` 判会在**每次新增装置时误报**（**P-38**：过宽 ⇒ 假红 ⇒ 训练人忽略报警）。
 *   `check-ignore` 只回答真正的问题：「**这个路径会不会被 gitignore 挡住**」
 *   ⇒ 新增未提交 **不命中**，`tmp/` 命中（W49 实测两种形态各验一次）。
 *
 * ★ 非 git 环境（无 `.git` / 无 git 命令）⇒ 返回 `null`，调用方**只出声不报红**
 *   （判据⑤ 无判据力时不得判 FAIL —— **P-43**）。
 */
export function makeVcsChecker () {
  const cache = new Map()
  let usable = null
  return {
    /** @returns {boolean|null} true=被忽略 / false=在版本控制内 / null=无法判定 */
    ignored (rel) {
      const r = String(rel).replace(/\\/g, '/')
      if (cache.has(r)) return cache.get(r)
      if (usable === null) {
        try {
          execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
          usable = true
        } catch { usable = false }
      }
      if (!usable) { cache.set(r, null); return null }
      let v
      try {
        execFileSync('git', ['check-ignore', r], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        v = true   // exit 0 = 命中忽略规则
      } catch (e) {
        v = e.status === 1 ? false : null   // exit 1 = 未命中；其它 ⇒ 无法判定
      }
      cache.set(r, v)
      return v
    }
  }
}

/** 泛化示例名（正文里泛指「某个脚本/文档」，不是真装置声明） */
export const GENERIC_NAMES = new Set(['x.mjs', 'xxx.mjs', 'foo.mjs', 'bar.mjs', 'a.mjs', 'b.mjs', 'example.mjs', 'sample.mjs',
  // ★ W65 补：文档形态的泛化名（判据⑥ 的说明文字里用 `docs/X.md` 泛指「某份文档」——
  //   它与 `x.mjs` 是**同一语义**（正文里泛指），只认脚本形态会让同一类写法**两个待遇**，P-45）
  'x.md', 'xxx.md', 'foo.md', 'bar.md', 'a.md', 'b.md', 'example.md', 'sample.md'])
/**
 * ★ W65：泛化名判定**必须大小写不敏感** ——
 * 「`docs/X.md`」与「`docs/x.md`」在语义上是**同一个泛指**（正文里泛指「某份文档」），
 * 只按原样匹配会让**同一类写法两个待遇**（大写那份被当成真位置声明 ⇒ **假红**，**P-45/P-38**）。
 */
export function isGenericName (name) {
  return GENERIC_NAMES.has(String(name).toLowerCase())
}
/**
 * 同行否定 / 反事实 / 负控标记（语义口径，见头注）。
 *
 * ★★ **必须按「就近窗口」判，不能「整行任意位置命中即排除」**（**W46 实测的真缺陷**）：
 *   实测形态（方法论 P-4 定义行，第 286 行）—— 行**中间**并列陈述了三个装置
 *   （`` `capture-contracts.mjs` `` / `` `diff-contracts.mjs` `` 在 `scripts/`，
 *   而 `` `session-contract-probe.mjs` `` **在 `packages/tests/`**）⇒ 读者会**默认它们同处**；
 *   而该行**行尾**恰有「带 `--selftest` 8 项（正控 / 负控 / 零控…）」——
 *   整行口径把「负控」当成否定标记 ⇒ **把行首的真实位置误导一起豁免** = **判据失效**（P-30）。
 *   ⇒ 改为「**标记必须出现在引用前后 N 字内**」。
 *   ★ 注：本注释首版在括号里写了「正控 + 斜杠 + 负控」这种**加粗强调**，
 *     其中出现的「星号紧跟斜杠」**提前终止了块注释** ⇒ 文件语法错
 *     （**P-41 推论四** 的又一形态：**注释内容本身也能破坏语法**）。
 *     ⇒ 纪律：块注释内不得出现「星号紧跟斜杠」这一二连字符，要强调就用空格隔开。
 */
export const NEG_RE = /不存在|已删|负控|假证据|若新建|幻影/
/**
 * ★★ **判据⑤ 专用的排除词表**（**W49 新增** —— 由负控当场证伪后收窄）。
 *
 * ★ 为什么不能沿用 `NEG_RE`（**P-41：锚到决定结果的事实**）：
 *   判据⑤ 的前提是「**该路径已被证明在磁盘上存在**」（`relExists` 为真才会走到这里）
 *   ⇒ 行内出现「**不存在**」「已删」这类**关于存在性的**否定词时，它指的**必然是别的东西**
 *     （如本行在讲另一个装置、或在讲历史），**不可能**是在给本路径打豁免标记。
 *   ⇒ 拿它做豁免 = **真缺陷被静默放过**（**P-30 判据失效与通过同貌**）。
 *   ★ **W49 实测形态**：§3.1 那行含 W49 自己写的说明「别人克隆后不存在」⇒ 就地注入 tmp/
 *     引用后**闸门仍报绿**（负控当场证伪）。
 *   ⇒ 故本表**只保留「这是在举例/这是负控」这类语义**，"与存在性有关"的词一律去掉。
 *   ★★ **W70 再收窄**：`示例 / 举例 / 如： / 例： / 泛指` **不该留在任何一张词表里**（见下）。
 */
export const NEG_RE_VCS = /负控|假证据|若新建|幻影/
/**
 * ★★ **豁免窗口半径（字符）** —— **W70 由「±40」收窄为「前 12 / 后 6」**。
 *
 * ## 为什么必须收窄（**P-67 纪律②**：豁免窗口必须紧贴「被豁免的那个对象」）
 * 旧口径是**双向 ±40 字**：只要引用**附近 40 字内**出现任一豁免词，该引用就**整条被放过**。
 * ★ 根因与 **W67** 完全同构 —— **但这次落在另一个闸门**：
 *   W67 修的是 `audit-baseline-claims.mjs` 的「说明语境排除」（±30 字 + 高频词表），
 *   而 `audit-doc-refs.mjs` 的 `isNegatedNear` **一直是 ±40 字 + 更宽的词表**（**同一母题，另一处**）。
 * ★★ **W70 决定性实验（6 个攻击样本，4 个被静默放过）**：
 *   ① 纯真缺陷 ⇒ 报红 ✓
 *   ② 豁免词**紧贴**引用（`示例：\`scripts/audit-ghost-b.mjs\``）⇒ 豁免 ✓（**正当**）
 *   ③ 豁免词「示例」修饰**别的东西**、真缺陷在同行 40 字内 ⇒ **放过** ✗（应当报红）
 *   ④ 豁免词在引用**之后** 40 字内 ⇒ 报红 ✓（后窗口的语义本就弱）
 *   ⑤ 「举例」在真缺陷**前 35 字** ⇒ **放过** ✗
 *   ⑥ 豁免词在真缺陷**前 40 字**（窗口边缘）⇒ **放过** ✗
 *   ★ 另有第七处：**「泛化名在前 + 真缺陷在后」** ⇒ 前者的「泛指」把后者一起豁免（**同行串扰**）。
 * ★ 后果：**「豁免成功」与「真缺陷被放过」在报告上完全同貌**（**P-30**）——
 *   而**真缺陷被静默放过比假红更危险**（假红会被人发现）。
 *
 * ## 修法（三条一起改，缺一不可 —— 与 W67 同法）
 *   ⑴ **窗口改为「紧贴被豁免的那个引用」**：前 **12** / 后 **6** 字
 *      —— 只够容纳「示例：」「（负控）」这种**直接修饰**；
 *   ⑵ **词表删掉全部日常高频措辞**（`示例 / 举例 / 如： / 例： / 泛指`）
 *      —— 它们**与判据结论无关**（**P-67 纪律①**），且实测**真实仓库一次都没用到**
 *        （`tmp/w70-evidence.mjs`：153 处受检引用里，靠词表豁免的 10 处**全靠 `负控` 7 / `假红` 1 /
 *        泛化名 2**，那 5 个高频词**零命中**）⇒ **纯风险、零收益**；
 *   ⑶ **「泛化名」与「否定语境」必须分开处理**（见 `extractRefs`）
 *      —— 泛化名的语义是「**这压根不是一个装置声明**」（该引用不参与判据），
 *        而否定词的语义是「**这是一个声明，但它在举例**」（该引用被豁免）——
 *        两者**混在同一个 `continue` 里**会让「泛指」把**同一行的真引用一起吞掉**。
 */
export const NEG_WINDOW = 12
/** 引用**之后**的窗口（更窄 —— 后置修饰比前置少见，见 `NEG_WINDOW` 头注 ④） */
export const NEG_WINDOW_AFTER = 6
/**
 * 就近否定判定（**纯函数**）。
 * @param {string} line
 * @param {number} at  引用在行内的起始位置
 * @param {RegExp} [re] 词表（默认 `NEG_RE`；判据⑤ 传 `NEG_RE_VCS`，见其头注）
 * @param {number} [len] 引用自身的长度（用于算「后窗口」的起点）
 */
export function isNegatedNear (line, at, re = NEG_RE, len = 0) {
  const a = Math.max(0, at - NEG_WINDOW)
  const b = Math.min(line.length, at + len + NEG_WINDOW_AFTER)
  return re.test(line.slice(a, b))
}

/** 可执行引用的解析：三基点并集（命令可从仓库根 / 工作区 / 仓库根+相对 跑） */
export function defaultRelExists (rel) {
  const cands = [path.join(ROOT, rel), path.join(WS, rel), path.join(ROOT, 'rp-workspace', rel)]
  return cands.some(p => fs.existsSync(p))
}
/** `docs/…` 位置声明的解析：两基点并集（E-H 点名的文档分属仓库根与工作区） */
export function defaultFileExists (rel) {
  const cands = [path.join(ROOT, rel), path.join(WS, rel), path.join(ROOT, 'rp-workspace', rel)]
  return cands.some(p => fs.existsSync(p))
}

/**
 * **裸名 → 所在目录**（判据④ 用）。
 *
 * ★ 为什么目录表要**含 `packages/tests`**：本仓有「vitest 的外部执行体」这类装置
 *   （如 `session-contract-probe.mjs`）—— 它们**不在 `scripts/`**，但会在文档里
 *   与 `scripts/` 的装置**并列陈述** ⇒ 判据④ 要能认出「两者不同处」；
 *   若索引只扫 `scripts/`，它们会被算成「找不到」，那样报出的就不是「位置误导」了。
 * ★ 深度限制 3 层（防扫进 `node_modules` 这类巨树 —— 判据自己的性能也是判据的一部分）。
 */
export function buildBareLocator () {
  const DIRS = ['scripts', 'packages/tests', 'tmp', 'docs', 'android']
  const map = new Map()
  for (const d of DIRS) {
    const abs = path.join(WS, d)
    if (!fs.existsSync(abs)) continue
    const walk = (p, depth) => {
      if (depth > 3) return
      let entries
      try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue
          walk(path.join(p, e.name), depth + 1)
        } else if (/\.(mjs|py|ps1|sh|js)$/.test(e.name)) {
          // 同名多处时**保留首个**（判据④ 只判「是否同处」，不判「哪一处才对」——守 P-38）
          if (!map.has(e.name)) map.set(e.name, d)
        }
      }
    }
    walk(abs, 0)
  }
  return (base) => map.get(base) ?? null
}
/** 可执行引用形态：`node <path>` 等 */
const EXEC_RE = /\b(?:node|python|bash|pwsh|powershell)\s+(?:-[^\s]+\s+)*([\w./\\-]+\.(?:mjs|py|ps1|sh|js))/g

/**
 * 从一份文档文本抽「引用声明」（**纯函数**，便于 selftest 用合成样本）。
 *
 * ★ `relExists`（可执行引用）与 `fileExists`（位置声明）**必须是两个注入点**：
 *   前者按「仓库根 / 工作区 / 两者」三基点解析（命令可从任一基点跑），
 *   后者按「scripts 固定落本工作区 / docs 两基点」解析。
 *   ★★ 首版**只用了一个 `existsFn`** ⇒ selftest 的可执行负控传 `() => true` 时
 *   **判据被短路**（永远「存在」）⇒ 负控报绿 = **假负控**（P-20：杠杆必须真的会红）。
 *
 * @param {string} text
 * @param {string} docLabel
 * @param {(rel:string)=>boolean} relExists
 * @param {((rel:string)=>boolean)|null} fileExists
 * @param {((base:string)=>string|null)|null} locateBare  **裸名 → 所在目录**（判据④ 用；返回 null 表示找不到）
 * @param {((rel:string)=>boolean|null)|null} isIgnored  **判据⑤**：路径是否**不在版本控制内**（W49 新增）
 */
export function extractRefs (text, docLabel, relExists = () => true, fileExists = null, locateBare = null, isIgnored = null) {
  const fe = fileExists ?? relExists
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    // ① 可执行引用
    for (const m of l.matchAll(EXEC_RE)) {
      const rel = m[1].replace(/\\/g, '/')
      const relOk = relExists(rel)
      if (!relOk) {
        // ① 的豁免（`NEG_RE`，含「不存在/已删」—— 对**判据①** 是正当的：本机确实没这个文件）
        if (!isNegatedNear(l, m.index, NEG_RE, m[0].length)) out.push({ doc: docLabel, line: i + 1, kind: '可执行引用', ref: rel })
      } else if (isIgnored && isIgnored(rel) === true) {
        // ⑤ ★★ 在版本控制内？（**W49 新增** —— 只对**真实存在**的路径追问，见头注）
        //    ★★ **豁免必须「分家」**（**W49 实测的真缺陷**）：首版把 ① 的豁免写成
        //      「命中 ⇒ `continue`」，而 `continue` 会**连带跳过 ⑤** ⇒
        //      行内只要出现「不存在」（哪怕在讲别的事）⇒ **判据⑤ 永久静默**
        //      = 判据失效而与通过同貌（**P-30**）。
        //      ⇒ 豁免**只作用于它自己那条判据**：① 用 `NEG_RE`、⑤ 用 `NEG_RE_VCS`。
        if (!isNegatedNear(l, m.index, NEG_RE_VCS, m[0].length)) out.push({ doc: docLabel, line: i + 1, kind: '不在版本控制内', ref: rel })
      }
    }
    // ⑤ ★★ **在版本控制内？**（**W49 新增**）
    //    ★ 扫描面 = **与判据① 同一个形态**（`` `node|python|… <path>` ``）—— 理由也同一条：
    //      **读者会照着敲它，路径错了/东西不在 ⇒ 直接失败**（P-1：同一理由 ⇒ 同一口径）。
    //    ★ 为什么**不**把「裸 `tmp/x.mjs`（无 node 前缀）」也算进来（W49 实测口径收敛）：
    //      实测方法论 §5.4 非史实区的 2 处「`tmp/xxx.mjs`」都是**叙述**（「由它在真实设备上验」
    //      / 「把它写成唯一命令」——后者讲的正是**这个错误已被修掉**）⇒ 读者**不会照抄**
    //      ⇒ 认了就是 **P-38 过宽**（假红 ⇒ 训练人忽略报警）。
    //      这类仍**出声**（R8：失败必须留痕），但归 **ⓘ 信息项**、不参与退出码。
    if (isIgnored) {
      for (const q of l.matchAll(/`(tmp\/[\w.-]+\.(?:mjs|py|ps1|sh|js))`/g)) {
        // ★ 此处也改用 NEG_RE_VCS（同样理由）
        //   ★★ **W70**：`示例 / 举例` 已从词表移除（它们是**日常高频措辞**，与结论无关 ——
        //     **P-67 纪律①**）；原本靠它们豁免的叙述句现在靠**紧贴窗口**（前 12 / 后 6）区分。
        if (isNegatedNear(l, q.index, NEG_RE_VCS, q[0].length)) continue
        if (!fe(q[1])) continue          // 不存在 ⇒ 不在本判据职责内（守 P-45）
        if (isIgnored(q[1]) === true) out.push({ doc: docLabel, line: i + 1, kind: 'ⓘ tmp 位置声明', ref: q[1] })
      }
    }
    // ②③ 反引号内的位置声明
    for (const q of l.matchAll(/`([^`\n]*)`/g)) {
      const inner = q[1].replace(/\\/g, '/')
      // ★★ **W70：泛化名与否定语境必须分开处理**（两条语义完全不同 —— 见 `NEG_WINDOW` 头注 ⑶）：
      //   ⑴ 泛化名（`x.mjs` / `xxx.md`）⇒ 该片段**压根不是一个装置声明** ⇒ 它自己**不参与判据**
      //      （`continue` 只跳过「这一个片段」，**不带行级语义**）；
      //   ⑵ 否定语境（`负控` / `不存在`）⇒ 该片段**是**一个声明，只是**在举例/在讲反事实** ⇒ 被豁免。
      //   ★ 混用的后果：旧代码把两者写在同一处 `continue`，**语义上没差**（都是跳过当前片段）——
      //     真正的问题在 `isNegatedNear` 的**宽窗口**（40 字）让「泛指」把**同一行的真引用**一起吞掉
      //     （W70 决策实验第 7 处）。收窄窗口 + 上面这条分工，两件事各归各位。
      if (isGenericName(inner.split('/').pop())) continue
      if (isNegatedNear(l, q.index, NEG_RE, q[0].length)) continue
      let m
      if ((m = /^(?:[\w.@-]+\/)*scripts\/([\w-]+\.(?:mjs|py|ps1|sh|js))$/.exec(inner))) {
        if (!fs.existsSync(path.join(WS, 'scripts', m[1]))) {
          out.push({ doc: docLabel, line: i + 1, kind: 'scripts 位置声明', ref: inner })
        }
      } else if ((m = /^(?:[\w.@-]+\/)*docs\/([\w.-]+\.md)$/.exec(inner))) {
        if (!fe(inner)) out.push({ doc: docLabel, line: i + 1, kind: 'docs 位置声明', ref: inner })
      }
    }
    // ④ ★★ **同行并列装置的「位置误导」**（W46 新增 —— 见头注「为什么需要第④条」）
    if (locateBare) {
      const bares = [...l.matchAll(/`([\w-]+\.(?:mjs|py|ps1|sh|js))`/g)]
        .filter(m => !isGenericName(m[1]))
        .filter(m => !isNegatedNear(l, m.index, NEG_RE, m[0].length))
      if (bares.length >= 2) {
        const dirs = new Map()   // dir → 首个出现的 basename
        for (const b of bares) {
          const d = locateBare(b[1])
          if (d && !dirs.has(d)) dirs.set(d, b[1])
        }
        if (dirs.size >= 2) {
          const desc = [...dirs].map(([d, n]) => `${d}/${n}`).join(' · ')
          out.push({
            doc: docLabel,
            line: i + 1,
            kind: '并列装置位置不一致',
            ref: desc
          })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // ---- 正控：真缺陷形态（引用一个不存在的 scripts 装置）----
  const good = '见 `scripts/audit-selftest-claims.mjs` 与 `node scripts/audit-baseline-claims.mjs`'
  const bad = '见 `scripts/audit-ghost.mjs`'
  const r1 = extractRefs(good, 'T', () => true, () => true)
  t('正控：存在的引用 ⇒ 无报红', r1.length === 0, JSON.stringify(r1))
  const r2 = extractRefs(bad, 'T', () => true, () => true)
  t('★负控：`scripts/audit-ghost.mjs` 不存在 ⇒ 报红', r2.length === 1 && /ghost/.test(r2[0].ref), JSON.stringify(r2))

  // ---- ★★ 零控（**W46 实测的四处假红形态**，必须全部排除）----
  //   ★★ **W70 改写第 3 行**：原样本是 `那是**假证据**（比没有证据更误导）⇒ \`scripts/ef-not-real.mjs\``
  //     —— 「假证据」隔了 **17 字**（超出紧贴窗口 12）⇒ 按 W70 的新口径**应当报红**。
  //     ★ 这不是「判据变严了造成假红」：那句里的「假证据」修饰的是**上文提到的东西**，
  //     不是这个引用 ⇒ **报红正是 W70 要修的形态**（旧口径会静默放过它）。
  //     ⇒ 样本改为**紧贴**形态（否定词**直接修饰该引用**），那才是本条零控要守的语义。
  const generic = [
    '首版只认 `` `scripts/x.mjs` `` 带路径前缀的写法',          // 泛化示例名
    '故 selftest 专设负控：`scripts/ef-not-real.mjs` ⇒ 报红。',   // 负控故意不存在（紧贴）
    '那是**假证据**：`scripts/ef-not-real.mjs`（比没有证据更误导）'  // 假证据（紧贴）
  ].join('\n')
  const rg = extractRefs(generic, 'T', () => true, () => true)
  t('★零控：泛化示例名（`scripts/x.mjs`）**不得**报红（否则必然假红，P-38）',
    !rg.some(x => /scripts\/x\.mjs$/.test(x.ref)), JSON.stringify(rg))
  t('★零控：带「负控/假证据」标记的行**不得**报红（刻意举例 ≠ 当前声明）',
    !rg.some(x => /ef-not-real/.test(x.ref)), JSON.stringify(rg))

  // ---- 正控：可执行引用形态（★ 用**注入的** relExists，否则判据被短路 ⇒ 假负控）----
  const relExistsSample = (rel) => rel === 'rp-workspace/scripts/audit-baseline-claims.mjs'
  const execBad = '跑 `node rp-workspace/scripts/nope.mjs` 即可'
  const re1 = extractRefs(execBad, 'T', relExistsSample, () => true)
  t('★负控：`node <不存在的路径>` ⇒ 报红', re1.length === 1 && /nope/.test(re1[0].ref), JSON.stringify(re1))
  const execGood = '跑 `node rp-workspace/scripts/audit-baseline-claims.mjs` 即可'
  t('正控：`node <存在的路径>` ⇒ 不报红', extractRefs(execGood, 'T', relExistsSample, () => true).length === 0, '')
  // ★ P-20 杠杆：只把路径改成存在的 ⇒ 必须转绿
  t('★杠杆：把不存在的路径换成存在的 ⇒ **必须转绿**（证明负控不是恒定红）',
    extractRefs('跑 `node rp-workspace/scripts/audit-baseline-claims.mjs` 即可', 'T', relExistsSample, () => true).length === 0
    && extractRefs(execBad, 'T', relExistsSample, () => true).length === 1, '')

  // ---- 正控：docs 位置声明（两基点并集）----
  const feSample = (rel) => rel === 'docs/GOAL.md'
  t('正控：`docs/GOAL.md` 存在 ⇒ 不报红', extractRefs('见 `docs/GOAL.md`', 'T', () => true, feSample).length === 0, '')
  t('★负控：`docs/ghost.md` 不存在 ⇒ 报红',
    extractRefs('见 `docs/ghost.md`', 'T', () => true, feSample).length === 1, '')

  // ---- ④ ★★ 判据④（**W46 新增，抓的正是本轮的真缺陷**）：同行并列装置位置不一致 ----
  const locateSample = (b) => ({
    'capture-contracts.mjs': 'scripts',
    'diff-contracts.mjs': 'scripts',
    'session-contract-probe.mjs': 'packages/tests'
  })[b] ?? null
  // ★ 真实仓库形态（方法论 P-4 定义行）：**裸名并列**，两个在 scripts、一个在 packages/tests
  //   ★★ 注意：判据④ 的口径就是「**裸名**并列」—— 若引用自带路径前缀（`scripts/x.mjs`），
  //     读者本就知道它在哪，**不构成误导** ⇒ 不该被纳入（这是判据④ 与判据②③ 的分工边界）。
  const realForm = '`capture-contracts.mjs` 只存快照；`diff-contracts.mjs` 是手工 CLI；`session-contract-probe.mjs` 是外部执行体'
  const r4 = extractRefs(realForm, 'T', () => true, () => true, locateSample)
  t('★★正控（判据④）：同行**裸名**并列装置分属 scripts/ 与 packages/tests/ ⇒ **必须报红**（W46 的真缺陷形态）',
    r4.length === 1 && r4[0].kind === '并列装置位置不一致', JSON.stringify(r4))
  // ★ 零控：全部同处 ⇒ 不得报红
  const sameDir = '`capture-contracts.mjs` 与 `diff-contracts.mjs` 都是脚本'
  t('★零控（判据④）：并列装置**全部同处** ⇒ 不得报红（防过宽 —— P-38）',
    extractRefs(sameDir, 'T', () => true, () => true, locateSample).length === 0, '')
  // ★ 零控：同行有就近否定标记 ⇒ 不得报红
  const negSameLine = '`capture-contracts.mjs` 与 `session-contract-probe.mjs`（**负控**：故意不存在）'
  t('★零控（判据④）：引用附近有否定标记 ⇒ 不得报红（就近窗口口径）',
    extractRefs(negSameLine, 'T', () => true, () => true, locateSample).length === 0, '')
  t('★杠杆（判据④）：该行若去掉否定标记 ⇒ **必须报红**（证明上一条不是把判据改废）',
    extractRefs('`capture-contracts.mjs` 与 `session-contract-probe.mjs`', 'T', () => true, () => true, locateSample).length === 1, '')
  // ★ 零控（分工边界）：带路径前缀的并列引用 ⇒ **不得**被判据④ 报红（读者知道位置，不构成误导）
  t('★零控（判据④）：**带路径前缀**的并列引用不属本判据（判据②③ 已覆盖）⇒ 不得报红',
    extractRefs('`scripts/capture-contracts.mjs` 与 `packages/tests/session-contract-probe.mjs`', 'T', () => true, () => true, locateSample).length === 0, '')

  // ---- 就近窗口的关键回归（**W46 实测的假绿形态**）----
  //   ★ 形态：行中间是**真实引用**、行尾**远处**才有「负控」字样 ⇒ 整行口径会把它豁免
  const farNeg = '`a1.mjs` 与 `b2.mjs` 并列陈述。本装置带 `--selftest` 8 项（正控 / 负控 / 零控）'
  const locateAB = (b) => ({ 'a1.mjs': 'scripts', 'b2.mjs': 'packages/tests' })[b] ?? null
  t('★★杠杆（就近窗口）：行尾**远处**的「负控」**不得**豁免行首的位置不一致（W46 实测的假绿 = P-30）',
    extractRefs(farNeg, 'T', () => true, () => true, locateAB).length === 1, '')

  // ---- 真实仓库（动态）：E-H 四份文档必须都存在 + 当前 0 违规 ----
  const missingDocs = E_H_DOCS.filter(([, f]) => !fs.existsSync(f))
  t('真实仓库：E-H 点名的四份文档**全部存在**（缺任一份 ⇒ 本判据的扫描面不成立）',
    missingDocs.length === 0, missingDocs.map(([n]) => n).join(' '))

  // ---- ★★ 判据⑤（W49 新增）：引用目标必须在**版本控制内** ----
  //   ★ 注入点必须**独立**（与 relExists 分开）—— 否则「存在」与「在版本控制内」两件事
  //     会被同一个 mock 短路（W46 首版踩过的同形坑：单注入点 ⇒ 假负控）。
  const ignoredMap = (rel) => ['tmp/ghost-probe.mjs', 'rp-workspace/tmp/w36-v0-migrate-fold.mjs', 'tmp/old-probe.mjs'].includes(rel)
  const refsExist = () => true   // 路径「本机存在」（判据⑤ 只对存在的路径追问）
  // 正控：路径在版本控制内 ⇒ 不报红
  t('正控（判据⑤）：路径**在版本控制内** ⇒ 不报红',
    extractRefs('跑 `node scripts/audit-doc-refs.mjs` 即可', 'T', refsExist, () => true, null, () => false).length === 0, '')
  // ★ 负控：真实仓库形态（§3.1 的「怎么跑」列）⇒ 必须报红
  const vcsBad = '见 `node rp-workspace/tmp/w36-v0-migrate-fold.mjs`（临时探针）'
  const rv = extractRefs(vcsBad, 'T', refsExist, () => true, null, ignoredMap)
  t('★负控（判据⑤）：可执行引用的目标**不在版本控制内**（tmp/ 被 gitignore）⇒ **必须报红**',
    rv.length === 1 && rv[0].kind === '不在版本控制内', JSON.stringify(rv))
  // ★ 负控：反引号里的 `tmp/…`（**不带 node 前缀**）⇒ 归 **ⓘ 信息项**（叙述性引用，守 P-38）
  const vcsBare = '证据探针 `tmp/ghost-probe.mjs` 留仓'
  const rv2 = extractRefs(vcsBare, 'T', refsExist, () => true, null, ignoredMap)
  t('★负控（判据⑤）：**裸 `tmp/…` 反引号形态** ⇒ 判为 **ⓘ 信息项**（不参与退出码，守 P-38 防过宽）',
    rv2.length === 1 && rv2[0].kind === 'ⓘ tmp 位置声明', JSON.stringify(rv2))
  // ★ 杠杆：该形态若改成 `node <tmp路径>`（读者会照抄）⇒ **必须升级为报红项**
  const rv2b = extractRefs('跑 `node tmp/ghost-probe.mjs` 即可', 'T', refsExist, () => true, null, ignoredMap)
  t('★杠杆（判据⑤/分级）：同一路径加上 `node ` 前缀（读者会照抄）⇒ **必须升级为报红项**',
    rv2b.length === 1 && rv2b[0].kind === '不在版本控制内', JSON.stringify(rv2b))
  // ★ 杠杆（P-20）：只把「不在版本控制内」换成「在版本控制内」⇒ **必须转绿**
  t('★杠杆（判据⑤）：换成版本控制内的路径 ⇒ **必须转绿**（证明负控不是恒定红）',
    extractRefs('跑 `node scripts/audit-doc-refs.mjs` 即可', 'T', refsExist, () => true, null, ignoredMap).length === 0
    && rv.length === 1, '')
  // ★ 零控：路径**本机不存在** ⇒ 归判据①（可执行引用）管，**不得**由判据⑤ 报（守 P-45 职责边界）
  t('★零控（判据⑤）：路径本机**不存在** ⇒ 归判据①，判据⑤ **不得**重复报（职责边界）',
    extractRefs('跑 `node scripts/nope-nope.mjs`', 'T', () => false, () => true, null, ignoredMap)
      .filter(p => p.kind === '不在版本控制内').length === 0, '')
  // ★ 零控（P-43）：**无法判定**（非 git 环境 ⇒ null）⇒ 不得报红
  t('★零控（判据⑤）：VCS 状态**无法判定**（null，非 git 环境）⇒ 不得报红（P-43：无判据力不判 FAIL）',
    extractRefs(vcsBad, 'T', refsExist, () => true, null, () => null).length === 0, '')
  // ★★ 豁免词表**分家**（**W49 负控当场证伪后收窄**，守 P-41/P-30）
  //    ★ 形态：同一行里既有「不存在」（讲别的事）又有 tmp/ 引用 ⇒ 判据① 仍豁免（沿用 NEG_RE），
  //      但**判据⑤ 不得豁免**（该路径已被证明存在 ⇒ 「不存在」不可能是在说它）。
  const mixedNeg = 'W49 修：原「怎么跑」列指向 tmp/ 的探针（tmp/ 在 .gitignore 内 ⇒ 别人克隆后不存在）⇒ 已改为常驻口 `node rp-workspace/tmp/w36-v0-migrate-fold.mjs`'
  t('★★杠杆（豁免分家）：行内「不存在」不得豁免**判据⑤**（否则真缺陷被静默放过 = P-30）',
    extractRefs(mixedNeg, 'T', refsExist, () => true, null, ignoredMap).filter(p => p.kind === '不在版本控制内').length === 1,
    JSON.stringify(extractRefs(mixedNeg, 'T', refsExist, () => true, null, ignoredMap)))
  t('★零控（豁免分家）：`NEG_RE_VCS` **不得**再含「不存在/已删」（那两个词与「存在性」相关，必然不是本判据的豁免标记）',
    !NEG_RE_VCS.test('别人克隆后不存在') && !NEG_RE_VCS.test('该文件已删'), String(NEG_RE_VCS))
  //   ★★ **W70 改写**：原样本用「示例」举证 —— 而「示例」已按 **P-67 纪律①** 移出词表
  //     （它是**日常高频措辞**、与判据结论无关，且真实仓库**零命中**）⇒ 改用它**确实该拦**的词。
  t('★零控（豁免分家）：`NEG_RE_VCS` **仍须**拦「负控/假证据」这类正当叙述（防另一个方向过宽）',
    NEG_RE_VCS.test('负控：`tmp/x.mjs`') && NEG_RE_VCS.test('假证据'), String(NEG_RE_VCS))

  // ---- ★★ 史实区 mask（W49）：逐轮记录区必须被 mask，否则**永远报红** ----
  const goalSample = [
    '## 三、当前基线',
    '跑 `node scripts/audit-doc-refs.mjs` 即可',
    '## 十一、当前工作面',
    '历史记录：`node tmp/old-probe.mjs` 与 `tmp/old2.mjs`',
    '## 十二、起步动作',
    '再跑 `node scripts/audit-doc-refs.mjs`'
  ].join('\n')
  const masked = maskHistorySections(goalSample, 'GOAL.md')
  t('★正控（mask）：GOAL §十一 段落**被置空**（保留行号）',
    masked.split('\n').length === 6 && masked.split('\n')[3] === '', JSON.stringify(masked.split('\n')[3]))
  t('★正控（mask）：§十一 **之外**的行**原样保留**（不得误伤）',
    masked.includes('跑 `node scripts/audit-doc-refs.mjs` 即可') && masked.includes('## 十二、起步动作'), '')
  t('★杠杆（mask）：不 mask 时该样本**会**报红（证明 mask 真的在起作用，不是在掩盖缺陷）',
    extractRefs(goalSample, 'T', refsExist, () => true, null, ignoredMap).length > 0, '')
  t('★零控（mask）：README 无史实区 ⇒ **不得**被 mask（表里为 null ⇒ 原样返回）',
    maskHistorySections('## 十一、x\n`a`', 'README.md') === '## 十一、x\n`a`', '')
  t('★零控（mask）：`maskHistorySections` 对**未知文档**（表里没有）⇒ 原样返回（不误伤）',
    maskHistorySections('## 六、x\n`a`', 'UNKNOWN.md') === '## 六、x\n`a`', '')
  // ★★ 真实仓库实测的 70 处 → 收敛断言（守 P-45/P-38：扫描面必须与真目标对齐）
  //    ★ 关键形态：史实区**内部还有 `## 级`标题**（方法论 §6.x 就是 `## 6.18 …`）
  //      ⇒ 它**不得**重置 mask 开关（这是本判据 selftest 当场证伪 v1 的那个坑）
  const methodMasked = maskHistorySections(
    '## 五、x\n`node tmp/a.mjs`\n## 六、开放项\n`node tmp/b.mjs`\n## 6.18 第二十四轮\n`node tmp/b2.mjs`\n## 七、一句话总结\n`node tmp/c.mjs`',
    'MOBILE-TEST-METHODOLOGY.md')
  t('★正控（mask）：方法论 §六 起被 mask，且**区内的 `## 6.x` 标题不重置开关**（v1 的坑）',
    methodMasked.includes('`node tmp/a.mjs`') && !methodMasked.includes('`node tmp/b.mjs`') && !methodMasked.includes('`node tmp/b2.mjs`'), '')
  t('★杠杆（mask）：走到**下一个主章节**（`## 七、`）⇒ **必须退出 mask**（否则会越界掩盖真缺陷）',
    methodMasked.includes('`node tmp/c.mjs`'), '')
  const pactMasked = maskHistorySections('## 4. 验证回路\n`node tmp/a.mjs`\n## 附录四：x\n`node tmp/b.mjs`', 'ST-COMPAT-PACT.md')
  t('★正控（mask）：契约文档「附录」整段被 mask（附录四续 N 是逐轮复核）',
    pactMasked.includes('`node tmp/a.mjs`') && !pactMasked.includes('`node tmp/b.mjs`'), '')
  t('★口径一致（P-1）：史实区表覆盖**全部** `SCAN_DOCS`（新增文档必须显式声明其史实区，不得默认漏）',
    SCAN_DOCS.every(([n]) => n in HISTORY_SECTION_RE), Object.keys(HISTORY_SECTION_RE).join(' '))

  // ---- ★★ 扫描面（W49）：SSOT 必须在内，且**真的被扫到** ----
  t('★正控（扫描面）：SSOT（`docs/GOAL.md`）在 `SCAN_DOCS` 内（此前它**不在任何引用闸门的扫描面**）',
    SCAN_DOCS.some(([n]) => n === 'GOAL.md'), SCAN_DOCS.map(([n]) => n).join(' '))
  t('★正控（扫描面）：E-H 四份**仍在**（扩面不得挤掉原面）', E_H_DOCS.length === 4 && SCAN_DOCS.length === 5, `E_H=${E_H_DOCS.length} SCAN=${SCAN_DOCS.length}`)
  t('★真实仓库：SSOT 文件存在（否则扩面只是空声明）', fs.existsSync(path.join(ROOT, 'docs', 'GOAL.md')), '')
  t('★真实仓库：判据⑤ 可用（git 可达 ⇒ 判据⑤ 有判据力；不可达时主流程会出声）',
    makeVcsChecker().ignored('README.md') !== null, '')
  t('★真实仓库：`tmp/` 确实被 gitignore 命中（判据⑤ 的负控前提 —— 否则它永远报不出违规）',
    makeVcsChecker().ignored('rp-workspace/tmp') === true, '')
  t('★真实仓库：`scripts/` 下的**新增未提交**脚本**不**被命中（防 P-38 过宽：新增装置不该假红）',
    makeVcsChecker().ignored('rp-workspace/scripts/audit-doc-refs.mjs') === false, '')

  // ---- ★★ 判据⑥（W65）：受守面清单必须与它声称的单源一致 ----
  //   ★ 为什么必须补（**P-59 纪律③**）：W65 新加的这条判据若不覆盖，就是**永远测不到的死判据**。
  //   ★ 控的形态必须**对应真实缺陷的两种方向**（W65 决定性实验的两侧）：
  //     ① GOAL 侧改了名单 ⇒ 报红；② 代码侧删了一份 ⇒ 报红。
  const E_H_LINE_OK = '| **E-H** | **文档一致**：`README.md` / `docs/THIRD_PARTY_LICENSES.md` / `rp-workspace/docs/ST-COMPAT-PACT.md` / `docs/MOBILE-TEST-METHODOLOGY.md` 四份与代码现状一致 |'
  const E_H_TWO = ['README.md', 'THIRD_PARTY_LICENSES.md', 'ST-COMPAT-PACT.md', 'MOBILE-TEST-METHODOLOGY.md']
  t('★正控（判据⑥）：两份清单一致 ⇒ **不得报红**',
    scanFaceSotProblems(E_H_LINE_OK, E_H_TWO).length === 0,
    JSON.stringify(scanFaceSotProblems(E_H_LINE_OK, E_H_TWO)))
  // ★ 负控 ①：GOAL 侧把一份换成**另一份真实存在**的文档（= W65 实验 C 的形态）
  t('★负控（判据⑥ · GOAL 侧改名单）：GOAL 声明守 `V0.3-FREEZE.md` 而代码守方法论 ⇒ **必须报红**',
    scanFaceSotProblems(E_H_LINE_OK.replace('`docs/MOBILE-TEST-METHODOLOGY.md`', '`docs/V0.3-FREEZE.md`'), E_H_TWO).length === 2,
    JSON.stringify(scanFaceSotProblems(E_H_LINE_OK.replace('`docs/MOBILE-TEST-METHODOLOGY.md`', '`docs/V0.3-FREEZE.md`'), E_H_TWO)))
  // ★ 负控 ②：代码侧删一份（= W65 实验 D 的形态，修前 exit=0 静默通过）
  t('★负控（判据⑥ · 代码侧删一份）：受守面少一份 ⇒ **必须报红**',
    scanFaceSotProblems(E_H_LINE_OK, E_H_TWO.filter(x => x !== 'MOBILE-TEST-METHODOLOGY.md')).length === 1,
    JSON.stringify(scanFaceSotProblems(E_H_LINE_OK, E_H_TWO.filter(x => x !== 'MOBILE-TEST-METHODOLOGY.md'))))
  // ★ 零控：切面失效 ⇒ fail-closed（不许当 0 违规 —— P-30 最危险形态）
  t('★零控（判据⑥ · 切面失效）：读不到 §八 E-H 行 ⇒ **必须报红**（fail-closed，不许当 0 违规）',
    scanFaceSotProblems('没有任何 E-H 行的文档', E_H_TWO).length === 1,
    JSON.stringify(scanFaceSotProblems('没有任何 E-H 行的文档', E_H_TWO)))
  // ★ 零控：零样本冒充通过
  t('★零控（判据⑥ · 空名单）：代码侧名单为空 ⇒ **必须报红**（零样本冒充通过）',
    scanFaceSotProblems(E_H_LINE_OK, []).length === 1,
    JSON.stringify(scanFaceSotProblems(E_H_LINE_OK, [])))
  // ★ 零控：路径归一化（不得因 `docs/` 前缀差异而假红 —— P-38 过宽）
  t('★零控（判据⑥ · 路径前缀）：GOAL 写 `docs/X.md` 而代码写 `X.md` ⇒ **不得报红**（归一化）',
    scanFaceSotProblems('| **E-H** | `docs/README.md` 一份 |', ['README.md']).length === 0,
    JSON.stringify(scanFaceSotProblems('| **E-H** | `docs/README.md` 一份 |', ['README.md'])))
  t('★零控（判据⑥ · SSOT 不参与比对）：GOAL 只点名 E-H 四份，`SSOT_DOCS` 是主动多守 ⇒ 不得因此报红',
    scanFaceSotProblems(E_H_LINE_OK, E_H_TWO).length === 0 &&
    !scanFaceSotProblems(E_H_LINE_OK, E_H_TWO).some(x => /GOAL\.md/.test(x)), 'SSOT 未被误算进 E-H 比对')
  // ★ 真实仓库：判据⑥ 在两份**真实清单**上必须为 0 违规（否则主流程会红）
  const realGoal = path.join(ROOT, 'docs', 'GOAL.md')
  if (fs.existsSync(realGoal)) {
    t('★真实仓库（判据⑥）：受守面清单与 GOAL §八 E-H 声明**逐项一致**',
      scanFaceSotProblems(fs.readFileSync(realGoal, 'utf8'), E_H_DOCS.map(([n]) => n)).length === 0,
      JSON.stringify(scanFaceSotProblems(fs.readFileSync(realGoal, 'utf8'), E_H_DOCS.map(([n]) => n))))
  }

  // ---- ★★ 判据⑦（W69）：跨文档章节引用必须**可达** ----
  //   ★ 为什么它必须在这里（而不是新开脚本）：它与判据①~⑥ **同职责**
  //     （都回答「读者按文档能不能找到」）⇒ 守 **P-1**（同一语义只许一处实现）。
  //   ★ 控必须**成对**（W67 的教训）：① 不可达 ⇒ 必须报红；② 可达 ⇒ 不得报红；
  //     ③ 自指 ⇒ 不得报红；④ 目标读不到 ⇒ 只出声不报红（P-43）；⑤ 别名后不紧贴 ⇒ 不得报红。
  const XDOC = '### 6.38 第二十四轮\n### 5.4 设计哲学层判据\n'
  const readX = (n) => (n === 'MOBILE-TEST-METHODOLOGY.md' ? XDOC : null)
  const rd = (txt) => scanXDocSectionProblems(txt, 'GOAL.md', readX)
  t('★★负控（判据⑦）：点名「方法论 §6.99」而方法论**无此节** ⇒ **必须报红**（W69 的真缺陷形态）',
    rd('见 方法论 §6.99 的说法').problems.length === 1
    && /必然扑空/.test(rd('见 方法论 §6.99 的说法').problems[0]),
    JSON.stringify(rd('见 方法论 §6.99 的说法')))
  t('★正控（判据⑦）：点名「方法论 §6.38」而该节**真实存在** ⇒ 不得报红',
    rd('见 方法论 §6.38 的说法').problems.length === 0
    && rd('见 方法论 §6.38 的说法').checked === 1,
    JSON.stringify(rd('见 方法论 §6.38 的说法')))
  t('★杠杆（判据⑦）：只把章节号从 6.99 改成 6.38 ⇒ **必须转绿**（证明负控不是恒定红）',
    rd('见 方法论 §6.99').problems.length === 1 && rd('见 方法论 §6.38').problems.length === 0, '')
  t('★正控（判据⑦）：全名形态（`MOBILE-TEST-METHODOLOGY.md` §5.4）同样认得出',
    rd('完整定义在 `docs/MOBILE-TEST-METHODOLOGY.md` §5.4。').checked === 1
    && rd('完整定义在 `docs/MOBILE-TEST-METHODOLOGY.md` §5.4。').problems.length === 0,
    JSON.stringify(rd('完整定义在 `docs/MOBILE-TEST-METHODOLOGY.md` §5.4。')))
  // ⑵ 自指：本文件里也有该编号 ⇒ 视为本文件内引用（不属本判据）
  t('★零控（判据⑦ · 自指）：本文件里**也有** §6.38 ⇒ 不得当跨文档判（否则假红）',
    scanXDocSectionProblems('见 方法论 §6.38\n### 6.38 本文件也有这一节\n', 'GOAL.md', readX).checked === 0, '')
  // ⑶ 目标读不到 ⇒ 只出声不报红（P-43）
  const rdNull = scanXDocSectionProblems('见 方法论 §6.99', 'GOAL.md', () => null)
  t('★零控（判据⑦ · 无判据力）：目标文档**读不到** ⇒ 只出声、**不报红**（P-43）',
    rdNull.problems.length === 0 && rdNull.unreadable === 1, JSON.stringify(rdNull))
  // ⑤ 不紧贴 ⇒ 不得报红（防 P-38 过宽：行内别处的 §x.y 不是它的目标）
  t('★零控（判据⑦ · 紧贴）：别名后**隔了很远**的 §6.99 ⇒ 不得当成本别名的目标（防过宽，P-38）',
    rd('方法论这一份文档很重要。另见 §6.99 这个编号（讲的是别的事）').problems.length === 0, '')
  // ★ 零控：本文件不含跨文档章节引用 ⇒ 无对象可判，须给出说明（不得静默当 0 违规 = P-30）
  const rdEmpty = scanXDocSectionProblems('这里没有任何跨文档章节引用', 'GOAL.md', readX)
  t('★零控（判据⑦ · 零样本）：不含该形态 ⇒ `checked=0` 且带 `note`（不当 0 违规，P-30）',
    rdEmpty.checked === 0 && typeof rdEmpty.note === 'string' && rdEmpty.note.length > 0, JSON.stringify(rdEmpty))
  // ★★ 真实仓库：判据⑦ 必须在**真 GOAL** 上跑通且 0 违规（否则主流程会红）
  const realGoalFor7 = path.join(ROOT, 'docs', 'GOAL.md')
  if (fs.existsSync(realGoalFor7)) {
    //  ★ 口径与主流程**同源**（P-1）：引用侧 mask、定义面读全文
    const readReal = (n) => {
      const p = SCAN_DOCS.find(([x]) => x === n)
      const f = p ? p[1] : path.join(ROOT, 'docs', n)
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
    }
    const realFull = fs.readFileSync(realGoalFor7, 'utf8')
    const r7 = scanXDocSectionProblems(maskHistorySections(realFull, 'GOAL.md'), 'GOAL.md', readReal, undefined, realFull)
    t('★真实仓库（判据⑦）：GOAL 的跨文档章节引用**全部可达**（0 违规）',
      r7.problems.length === 0, `${JSON.stringify(r7.problems)} | checked=${r7.checked}`)
    t('★真实仓库（判据⑦）：**确有对象被检查**（`checked > 0`）—— 否则「0 违规」是零样本冒充通过（P-30）',
      r7.checked > 0, `checked=${r7.checked}`)
  }

  // ---- ★★ 判据⑧（W79）：行号式引用必须「目标存在」且「行号在范围内」 ----
  //   ★ 控必须**成对**（**P-67 纪律③**）：① 越界 ⇒ 必须报红；② 范围内 ⇒ 不得报红；
  //     ③ 杠杆（只改行号 ⇒ 翻转）；④ 区间写反 ⇒ 必须报红；⑤ 非本仓目标 ⇒ 只出声不报红；
  //     ⑥ 同名多处 ⇒ 不判（P-46）；⑦ 自指 ⇒ 不判；⑧ 零样本 ⇒ 出声（P-30）。
  //   ★★ 本判据**不实跑真仓库**（那需要全仓索引）；**真实仓库控在下面**（用真 `resolveRef` 口径）。
  {
    const R = (ref) => {
      if (ref === 'audit-doc-refs.mjs') return { target: 'rp-workspace/scripts/audit-doc-refs.mjs', ambiguous: false, total: 1125 }
      if (ref === 'build-dsht.ps1') return { target: 'rp-workspace/scripts/build-dsht.ps1', ambiguous: false, total: 1630 }
      if (ref === 'dup.ts') return { target: 'a/dup.ts', ambiguous: true, total: null }
      return { target: null, ambiguous: false, total: null }   // 非本仓（第三方基准）
    }
    const S = (txt, label = 'GOAL.md') => scanLineRefProblems(txt, label, R)
    // ① ★★ 负控：越界（W79 决定性实验的真实形态）
    const rOver = S('见 `build-dsht.ps1:9999` 的登记表')
    t('★★负控（判据⑧）：行号**越界**（`build-dsht.ps1:9999` 而该文件只有 1630 行）⇒ **必须报红**',
      rOver.problems.length === 1 && /越界/.test(rOver.problems[0]) && /1630/.test(rOver.problems[0]),
      JSON.stringify(rOver.problems))
    // ② ★ 正控：范围内 ⇒ 不得报红
    t('★正控（判据⑧）：行号**在范围内**（`build-dsht.ps1:228`）⇒ 不得报红',
      S('见 `build-dsht.ps1:228` 的兜底').problems.length === 0
      && S('见 `build-dsht.ps1:228` 的兜底').checked === 1, '')
    // ③ ★★ 杠杆：只把行号改成越界值 ⇒ **必须翻转**（证明负控不是恒定红）
    t('★杠杆（判据⑧）：只把 `:228` 改成 `:9999` ⇒ **必须转红**（证明②不是把判据改废）',
      S('见 `build-dsht.ps1:228`').problems.length === 0 && S('见 `build-dsht.ps1:9999`').problems.length === 1, '')
    // ④ ★★ 负控：区间形态，两端都要在范围内
    t('★★负控（判据⑧ · 区间）：`build-dsht.ps1:211-9999`（止端越界）⇒ **必须报红**',
      S('见 `build-dsht.ps1:211-9999`').problems.length === 1, JSON.stringify(S('见 `build-dsht.ps1:211-9999`').problems))
    t('★正控（判据⑧ · 区间）：`build-dsht.ps1:211-230`（两端都在范围内）⇒ 不得报红',
      S('见 `build-dsht.ps1:211-230`').problems.length === 0, '')
    // ④b ★★ 负控：区间**写反**（起 > 止）也是缺陷
    t('★★负控（判据⑧ · 区间写反）：`build-dsht.ps1:300-100`（起 > 止）⇒ **必须报红**',
      S('见 `build-dsht.ps1:300-100`').problems.length === 1 && /写反/.test(S('见 `build-dsht.ps1:300-100`').problems[0]), '')
    // ⑤ ★★ 零控：**非本仓目标**（第三方基准实现）⇒ 只出声、**不报红**（P-43）
    const rExt = S('见 `dsh-session/lib/types/surface.js:12-18` 的白名单')
    t('★★零控（判据⑧ · 非本仓）：目标指向**第三方基准实现** ⇒ 只出声、不得报红（P-43：无法验证）',
      rExt.problems.length === 0 && rExt.external === 1 && rExt.checked === 0, JSON.stringify(rExt))
    // ⑥ ★★ 零控：**同名多处** ⇒ 不判（P-46：越界与否取决于解析到哪一个）
    const rAmb = S('见 `dup.ts:99999`')
    t('★★零控（判据⑧ · 同名多处）：解析不唯一 ⇒ **不判**且出声（P-46：同一读数不得有两种相反解释）',
      rAmb.problems.length === 0 && rAmb.notes.length === 1, JSON.stringify(rAmb))
    // ⑦ ★ 零控：**自指** ⇒ 不判
    t('★零控（判据⑧ · 自指）：引用的就是本文件 ⇒ 不判（本判据判跨文件的行号引用）',
      S('见 `audit-doc-refs.mjs:9999`', 'audit-doc-refs.mjs').problems.length === 0
      && S('见 `audit-doc-refs.mjs:9999`', 'audit-doc-refs.mjs').checked === 0, '')
    // ⑧ ★ 零控：**零样本** ⇒ `checked=0`（主流程须出声，不当 0 违规 —— P-30）
    t('★零控（判据⑧ · 零样本）：不含该形态 ⇒ `checked=0`（主流程出声，不当通过）',
      S('这里没有任何行号式引用').checked === 0, '')
    // ⑨ ★ 零控：**普通冒号不得被当成行号引用**（防过宽 —— P-38）
    t('★零控（判据⑧ · 过宽防护）：正文里的 `时间:2026` / `版本:v1.2` ⇒ 不得被当成行号引用',
      S('时间:2026 · 版本:v1.2 · 见 §3.1:2 这一句').checked === 0, '')
    // ⑩ ★★ **真实仓库控**（P-30：判据必须在真仓库上跑通且 0 违规，否则主流程会红）
    //    ★★ **必须用与主流程同一个解析器**（**P-1**：W79 实测踩到 —— 若此处另写一份，
    //      主流程修了「带前缀不得回退到裸 basename」而这里没修 ⇒ 对**同一条引用**
    //      给出**相反结论**（**P-46**）。）
    {
      const realFile = path.join(ROOT, 'docs', 'MOBILE-TEST-METHODOLOGY.md')
      if (fs.existsSync(realFile)) {
        const realResolve = makeLineRefResolver(ROOT)
        const real8 = scanLineRefProblems(maskHistorySections(fs.readFileSync(realFile, 'utf8'), 'MOBILE-TEST-METHODOLOGY.md'), 'MOBILE-TEST-METHODOLOGY.md', realResolve)
        t('★真实仓库（判据⑧）：方法论的**当前状态区**里行号引用全部在范围内（0 违规）',
          real8.problems.length === 0, JSON.stringify(real8.problems))
        t('★真实仓库（判据⑧）：**确有对象被检查**（`checked > 0`）—— 否则「0 违规」是零样本冒充通过（P-30）',
          real8.checked > 0, `checked=${real8.checked} external=${real8.external}`)
      }
    }
    // ⑪ ★★ **单源口径控**（**P-46**）：带目录前缀的外部路径**不得**回退到本仓同名 basename
    {
      const rr = makeLineRefResolver(ROOT)
      const ext = rr('JS-Slash-Runner/src/function/variables.ts')
      t('★★零控（判据⑧ · 外部带前缀不回退）：`JS-Slash-Runner/src/function/variables.ts` ⇒ **判「非本仓」**（本仓有同名 basename，回退会假红 —— W79 实测）',
        ext.target === null, JSON.stringify(ext))
      // ★ 对照：**带前缀且确属本仓**的路径必须能解析（证明上一条的收窄没把判据改废）
      const own = rr('rp-workspace/scripts/build-dsht.ps1')
      t('★★杠杆（判据⑧ · 前缀解析）：`rp-workspace/scripts/build-dsht.ps1` ⇒ **能解析**且行数 > 0（证明上一条不是「前缀一律不认」）',
        own.target !== null && own.total > 0, JSON.stringify(own))
    }
  }

  // ---- ★★ W70：**豁免窗口不得过宽 / 词表不得含日常高频措辞**（本轮实测的真缺陷）----
  //   由头：`isNegatedNear` 一直是 **±40 字 + 宽词表**（含 `示例 / 举例 / 如： / 例： / 泛指`）——
  //     与 **W67** 修的 `audit-baseline-claims.mjs` **同一母题、落在另一个闸门**。
  //   ★★ **决定性实验（6 个攻击样本，4 个被静默放过）** —— 见下成对控。
  //   ★ **控必须成对**（**P-67 纪律③**）：攻击样本（必须报红）⇄ 正当豁免（必须豁免）——
  //     只做一侧会留下半个盲区，而**放宽口径**与**真缺陷被放过**在报告上完全同貌（**P-30**）。
  const feAll = () => true
  const reAll = () => true
  const hit = (txt) => extractRefs(txt, 'T', reAll, feAll).some(x => /ghost/.test(x.ref))
  // ① 基线（无任何豁免词）⇒ 必须报红（否则下面的对比无意义）
  t('★正控（W70 · 基线）：无豁免词的真缺陷 ⇒ **必须报红**', hit('见 `scripts/audit-ghost-a.mjs`'), '')
  // ②~⑤ ★★ 攻击样本：豁免词在场（讲的是别的事）而真缺陷同行 ⇒ **必须报红**
  t('★★负控（W70 · 攻击样本1）：「负控」修饰**别的东西**、真缺陷在同行 ⇒ **必须报红**（宽窗口会放过它）',
    hit('本行讲的是负控装置（另一件事），而 `scripts/audit-ghost-c.mjs` 这个引用必须报红'), '')
  t('★★负控（W70 · 攻击样本2）：豁免词在真缺陷**之前 20 字**（超出紧贴窗口）⇒ **必须报红**',
    hit('下面提到负控这另一件与本行无关的事（占位）`scripts/audit-ghost-e2.mjs`'), '')
  //  ★★ **注意**（W70 实测逼出的口径边界）：若豁免词**紧贴**引用（如 ``…负控`scripts/x` ``），
  //    按 **P-67 纪律②**（紧贴窗口）**本就应当豁免** —— 紧贴的否定词**大概率**就是在修饰它。
  //    这是**紧贴口径的代价**，且是**刻意选择**：真实仓库实测「靠词表豁免的 10 处全靠 `负控`/`假红`」，
  //    都属这种紧贴形态 ⇒ 收紧到「必须紧贴」既保住正当豁免，又把「隔着 20+ 字」的误伤面切掉。
  //    ⇒ 故本组**不再**设「紧贴的负控词 + 真缺陷 ⇒ 必须报红」这条（它与紧贴口径**直接矛盾**）。
  t('★★负控（W70 · 攻击样本3）：**泛化名在前** ⇒ 不得把同行的真引用一起吞掉',
    hit('见 `scripts/x.mjs`（泛指）与 `scripts/audit-ghost-g.mjs`'), '')
  t('★★负控（W70 · 攻击样本4）：「不存在」修饰**别的东西**（隔 20 字）而真缺陷同行 ⇒ **必须报红**',
    hit('该文件不存在这件事与本行无关（占位若干字）`scripts/audit-ghost-g2.mjs`'), '')
  // ⑥ ★ 正当豁免：否定词**紧贴**被豁免的那个引用 ⇒ **必须豁免**（否则判据过宽 ⇒ 假红 ⇒ P-38）
  t('★正控（W70 · 正当豁免）：否定词**紧贴**引用（``…（负控）`scripts/…` ``）⇒ **必须豁免**',
    !hit('负控：`scripts/audit-ghost-i.mjs` 这个装置**故意不存在**'), '')
  // ★ 杠杆（P-20）：只把豁免词**挪到前窗口之外** ⇒ **必须转红**（证明紧贴窗口真的在起作用）
  //   ★ 后置否定词**不计入** —— 后窗口（6 字）的语义是「**紧跟在引用之后的直接修饰**」，
  //     它**本就是正当豁免**（如 `` `scripts/x.mjs`（负控：故意不存在） ``）⇒ 杠杆样本**不得**带后置否定词。
  t('★杠杆（W70 · 紧贴）：把豁免词从紧贴处**挪到前窗口（12 字）之外** ⇒ **必须转红**',
    !hit('负控：`scripts/audit-ghost-j.mjs` 这个装置是刻意举例的')
    && hit('负控装置这一句（占位若干字让前缀超过窗口）`scripts/audit-ghost-k.mjs` 这个装置是刻意举例的'), '')
  // ★ 零控：词表**不得**再含日常高频措辞（它们是**纯风险、零收益** —— W70 真实仓库实测）
  t('★零控（W70 · 词表）：`NEG_RE` / `NEG_RE_VCS` **不得**含「示例/举例/如：/例：/泛指」这类日常高频措辞',
    !['示例', '举例', '如：', '例：', '泛指'].some(w => NEG_RE.test(w) || NEG_RE_VCS.test(w)),
    `NEG_RE=${String(NEG_RE)} NEG_RE_VCS=${String(NEG_RE_VCS)}`)
  t('★零控（W70 · 窗口）：前窗口 = 12、后窗口 = 6（**紧贴**，P-67 纪律②）',
    NEG_WINDOW === 12 && NEG_WINDOW_AFTER === 6, `${NEG_WINDOW}/${NEG_WINDOW_AFTER}`)

  const okAll = fail === 0
  reportSelftest('doc-refs', total - fail, total)
  process.exit(okAll ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  // ★ `--file <path>`：供负控在**临时副本**上演练（W45 的更强形态：能不改就不改）
  const fi = process.argv.indexOf('--file')
  const only = fi >= 0 && process.argv[fi + 1] ? path.resolve(process.argv[fi + 1]) : null
  // ★★ `--as <文档名>`（**W49 新增**）：副本**必须仍按它原本的身份**判（否则区段语义失效）。
  //    ★ 为什么必需（**W49 负控当场证伪**）：副本若被当成 `(临时副本)` ⇒
  //      `HISTORY_SECTION_RE` 查不到 ⇒ **史实区不 mask** ⇒ §十一 里旧引用的判据④ 报 2 处假红
  //      ⇒ 负控的「基线必须绿」当场失败（这正是 **P-45**：判据的扫描面/口径必须与真目标对齐 ——
  //      脱开文档身份就没法按区段语义词判）。
  //    ★ 兜底：不传 `--as` 时按**文件名**猜（`w49-docrefs-goal-copy.md` 含 `goal` ⇒ 认 GOAL.md）。
  const asIdx = process.argv.indexOf('--as')
  const asName = asIdx >= 0 && process.argv[asIdx + 1] ? process.argv[asIdx + 1] : null
  const inferName = (p) => {
    const b = path.basename(p).toLowerCase()
    if (/goal/.test(b)) return 'GOAL.md'
    if (/method|mobile-test/.test(b)) return 'MOBILE-TEST-METHODOLOGY.md'
    if (/pact|compat/.test(b)) return 'ST-COMPAT-PACT.md'
    if (/readme/.test(b)) return 'README.md'
    if (/third-party|licen/.test(b)) return 'THIRD_PARTY_LICENSES.md'
    return null
  }
  const docs = only ? [[asName ?? inferName(only) ?? '(临时副本)', only]] : SCAN_DOCS

  // ★ 判据④ 用：**裸名 → 所在目录**（构建一次，避免逐行扫盘）
  //   目录表 = 本仓可能容纳脚本/探针的位置（含 vitest 外部执行体所在的 `packages/tests`——
  //   **W46 的真缺陷正落在那里**，若不纳入索引，判据④ 会把「找不到」当「不同目录」而误报）
  const locateBare = buildBareLocator()
  // ★ 判据⑤ 用：**版本控制检查器**（W49 新增）
  const vcs = makeVcsChecker()

  const problems = []
  let scanned = 0
  let historyMasked = 0
  for (const [label, file] of docs) {
    if (!fs.existsSync(file)) {
      console.error(`✗ 文档缺失：${label}（${file}）⇒ 本闸门的扫描面不成立 ⇒ fail-closed`)
      process.exit(2)
    }
    scanned += 1
    const raw = fs.readFileSync(file, 'utf8')
    // ★★ W49：**史实区**（逐轮记录）整段 mask（保留行号），否则判据会**永远报红**（P-38）
    const body = maskHistorySections(raw, label)
    if (body !== raw) historyMasked += 1
    problems.push(...extractRefs(body, label, defaultRelExists, defaultFileExists, locateBare, (rel) => vcs.ignored(resolveUnder(rel) ?? rel)))
  }
  if (scanned === 0) {
    console.error('✗ 扫描面为 0（零样本冒充通过 —— P-30 最危险形态）⇒ fail-closed')
    process.exit(2)
  }

  // ---- ★★ 判据⑥（W65）：受守面清单必须与它声称的单源（GOAL §八 E-H）一致 ----
  //   ★ GOAL 文本的来源（P-1：与主循环同源）：
  //     若 `--file` 传的是 **GOAL 副本** ⇒ 用它（这样负控才能对 GOAL 侧注入坏样本）；
  //     否则读**真实 GOAL**（判据要守的是「真实的两份清单」）。
  const goalLabel = docs.find(([l]) => l === 'GOAL.md')
  const goalTextFor6 = goalLabel
    ? fs.readFileSync(goalLabel[1], 'utf8')
    : (() => {
        const p = path.join(ROOT, 'docs', 'GOAL.md')
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
      })()
  if (goalTextFor6 === null) {
    console.log('[文档引用] ⓘ **判据⑥（受守面单源）无判据力**：读不到 `docs/GOAL.md`（出声，不当通过 —— P-43）')
  } else {
    const sotProblems = scanFaceSotProblems(goalTextFor6, E_H_DOCS.map(([n]) => n))
    if (sotProblems.length) {
      console.log(`[文档引用] ✗ 判据⑥（受守面单源）：受守面清单与 GOAL §八 E-H 声明**不一致**（${sotProblems.length} 处）`)
      for (const p of sotProblems) console.log(`[文档引用] ✗   ${p}`)
      console.log(`[文档引用] ⇒ 源码里写着「单源：与 GOAL §八 E-H 同名单」，而两份清单**已分叉**（P-27/P-30：声称在写下的一刻就开始过期）`)
      process.exit(1)
    }
    console.log(`[文档引用] 判据⑥（受守面单源）：代码受守面 ${E_H_DOCS.length} 份 与 GOAL §八 E-H 声明**逐项一致** · 违规 0 处`)
  }
  // ---- ★★ 判据⑦（W69）：跨文档章节引用必须**可达** ----
  //   ★ 与判据⑥ 同法，**文档文本来源与主循环同源**（P-1）：
  //     `--file` 传 GOAL 副本 ⇒ 用它（负控才能对 GOAL 侧注入）；否则读真实文档。
  //   ★★ 受检面 = **被扫的每一份**（不只 GOAL）：任何一份文档里的跨文档引用都算。
  {
    // ★★ **定义面必须读「未 mask 的全文」**（**W69 实测踩到的判据自身缺陷**）：
    //   方法论 §6.x 的**逐轮结论小节**（`## 6.18 …`）**全部落在它自己的史实区（`## 六、`）内**
    //   ⇒ 若把目标文档也 mask，等于**把所有章节定义都抹掉** ⇒ 真实仓库当场报 4 处假红
    //   （把真实存在的 §6.38 / §6.24 / §6.26 / §6.37 全判成「没有这一节」）。
    //   ★ 纪律：**「引用侧」按区段语义 mask（只判当前状态区的引用），「定义面」必须读全文**
    //     —— 两件事的扫描面本就不同（**P-45**：判据的扫描面必须与真目标对齐）。
    const readDocByName = (name) => {
      const hit = SCAN_DOCS.find(([l]) => l === name)
      if (hit && fs.existsSync(hit[1])) return fs.readFileSync(hit[1], 'utf8')
      const p = path.join(ROOT, 'docs', name)
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    }
    const xProbs = []
    let xChecked = 0, xUnread = 0, xDocs = 0
    for (const [label, file] of docs) {
      if (!fs.existsSync(file)) continue
      // ★ 引用侧：**必须用与判据①~⑤ 同一份 mask 结果**（只判当前状态区的引用，P-1）
      const full = fs.readFileSync(file, 'utf8')
      const body = maskHistorySections(full, label)
      const r = scanXDocSectionProblems(body, label, readDocByName, undefined, full)
      xChecked += r.checked; xUnread += r.unreadable
      if (r.checked || r.unreadable) xDocs += 1
      xProbs.push(...r.problems)
    }
    if (xChecked === 0 && xUnread === 0) {
      console.log('[文档引用] ⓘ **判据⑦（跨文档章节引用可达）无判据力**：扫描面内**不含**该形态（出声，不当通过 —— P-30）')
    } else if (xProbs.length) {
      console.log(`[文档引用] ✗ 判据⑦（跨文档章节引用可达）：${xProbs.length} 处不可达`)
      for (const p of xProbs) console.log(`[文档引用] ✗   ${p}`)
      console.log('[文档引用] ⇒ 读者按「<文档> §x.y」翻过去会扑空（P-52/P-68：引用的完整性按「读者能否按它找到」判）')
      process.exit(1)
    } else {
      console.log(`[文档引用] 判据⑦（跨文档章节引用可达）：检查 ${xChecked} 处（涉及 ${xDocs} 份文档）· 违规 0 处`
        + (xUnread ? ` · 另有 ${xUnread} 处因目标文档读不到而未判定（P-43）` : ''))
    }
  }
  // ---- ★★ 判据⑧（W79）：行号式引用必须「目标存在」且「行号在范围内」 ----
  //   ★★ 与判据⑦ 同法：**引用侧 mask、目标面读全文**（P-45：两件事的扫描面本就不同）。
  {
    // ★★ 与判据⑦ 同法：**引用侧 mask、目标面读全文**（P-45：两件事的扫描面本就不同）。
    //   ★ 解析器**单源**（P-1）：`makeLineRefResolver` —— 主流程与 selftest 共用同一份口径。
    const resolveRef = makeLineRefResolver(ROOT)
    const lProbs = []
    const lNotes = []
    let lChecked = 0, lExternal = 0, lDocs = 0
    for (const [label, file] of docs) {
      if (!fs.existsSync(file)) continue
      const full = fs.readFileSync(file, 'utf8')
      const body = maskHistorySections(full, label)
      const r = scanLineRefProblems(body, label, resolveRef)
      lChecked += r.checked; lExternal += r.external
      lNotes.push(...r.notes)
      if (r.checked || r.external) lDocs += 1
      lProbs.push(...r.problems)
    }
    if (lChecked === 0) {
      console.log('[文档引用] ⓘ **判据⑧（行号式引用可达）无判据力**：扫描面内**不含可解析的行号引用**（出声，不当通过 —— P-30）')
    } else if (lProbs.length) {
      console.log(`[文档引用] ✗ 判据⑧（行号式引用可达）：${lProbs.length} 处越界 / 区间写反`)
      for (const p of lProbs) console.log(`[文档引用] ✗   ${p}`)
      console.log('[文档引用] ⇒ 读者按「<文件>:<行号>」翻过去会扑空（P-52/P-69：行号是最易腐烂的引用）')
      process.exit(1)
    } else {
      console.log(`[文档引用] 判据⑧（行号式引用可达）：检查 ${lChecked} 处（涉及 ${lDocs} 份文档）· 违规 0 处`
        + (lExternal ? ` · 另有 ${lExternal} 处指向**第三方基准实现 / 不可解析目标**未判定（P-43）` : ''))
    }
    for (const n of lNotes) console.log(`[文档引用] ⓘ ${n}`)
  }
  // ★ 判据⑤ 的**判据力断言**（守 R7/P-43）：若 git 不可用 ⇒ 判据⑤ 形同不存在，
  //   必须在报告里**说出来**，不能让它静默变成「0 违规」。
  const vcsUsable = vcs.ignored('README.md') !== null
  if (!vcsUsable) {
    console.log('[文档引用] ⓘ **判据⑤（在版本控制内）无判据力**：当前环境读不到 git（非仓库 / 无 git 命令）')
    console.log('[文档引用] ⓘ ⇒ 上面的 ⓘ 只报「本机存在性」，**不证明**别人克隆后拿得到（R7 诚实边界）')
  }
  // ★ 同一处只报一次（判据④ 会因「一行含多组」而重复报同一行）
  const uniq = []
  const seen = new Set()
  for (const p of problems) {
    const k = `${p.doc}|${p.line}|${p.kind}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(p)
  }
  // ★ 分两级（守 P-38 + R8）：**报红项**参与退出码；**ⓘ 信息项**只出声
  const hard = uniq.filter(p => !p.kind.startsWith('ⓘ'))
  const soft = uniq.filter(p => p.kind.startsWith('ⓘ'))

  const maskedNote = historyMasked ? `（史实区已按区段语义 mask：${historyMasked} 份）` : ''
  console.log(`[文档引用] 扫描 ${scanned} 份（E-H 四份 + SSOT）· 悬空/误导/控制外引用 ${hard.length} 处 · ⓘ 信息项 ${soft.length} 处${maskedNote}`)
  if (hard.length === 0) {
    for (const p of soft) console.log(`[文档引用] ⓘ ${p.doc} 第 ${p.line} 行（${p.kind}）：\`${p.ref}\` ⇒ 本机存在但不在版本控制内（**叙述性引用**，读者不会照抄 ⇒ 只出声，不判 FAIL，守 P-38）`)
    console.log('[文档引用] OK —— 文档里点名的脚本/文档**全部真实存在**（可执行引用 + scripts/docs 位置声明 + 并列装置位置一致 + ★ 可执行引用的目标在版本控制内，五面）')
    process.exit(0)
  }
  for (const p of hard) {
    const why = p.kind === '不在版本控制内'
      ? '**不在版本控制内**（本机存在但别人克隆后没有 ⇒ 照文档做必然扑空，P-53）'
      : '**读者按它去找会扑空**（P-11 / E-H）'
    console.log(`[文档引用] ✗ ${p.doc} 第 ${p.line} 行（${p.kind}）：\`${p.ref}\` ⇒ ${why}`)
  }
  for (const p of soft) console.log(`[文档引用] ⓘ ${p.doc} 第 ${p.line} 行（${p.kind}）：\`${p.ref}\`（叙述性引用 ⇒ 只出声）`)
  console.log(`\n[文档引用] 共 ${hard.length} 处（文档与代码现状不一致，违反 §八 E-H）`)
  process.exit(1)
}
