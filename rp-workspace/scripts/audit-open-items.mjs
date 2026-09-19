#!/usr/bin/env node
/**
 * audit-open-items.mjs —— **§六「开放项表」的结构一致性闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * `MOBILE-TEST-METHODOLOGY.md` §六 是「当前还有哪些没收口」的 SSOT。它必须满足两条：
 *   ① **同一事实不得在两处结论相反**（P-1）—— 表里出现两条指向同一件事的行，
 *      却一条写「✅ 已收口」、另一条写「⬜ 未收口」时，**读者无法判断真相**；
 *   ② **每一行的状态必须可被解析**（三态穷举：`✅ 已收口` / `⬜ 未收口` / `📋 已登记`），
 *      且「未收口」行必须给出**可追踪锚点**（探针 + 登记处），否则是**悬空待办**。
 *
 * ## 为什么必须常驻（P-11 元级 · 本轮 W40 的真实事故）
 * W40 在推进 goal 时撞见：**同一个事实（T-87 判据 8）在 §六 里有两条记录** ——
 * 第 510 行写「✅ 已按 P-41 改锚收口」（W28 做的），第 559 行仍写「⬜ 未收口（第二十一轮发现）」。
 * 两条**都是真的**（一次是「判据改锚」，一次是「标记没跟着改」），但读者只能看到矛盾。
 * 实测影响：因为这一行，本轮**差点跳过**这块去查别的（P-27「过期结论双向误导」）。
 * ⇒ 本轮处置：把过期的「⬜」改成「✅ + 实测证据」，**并把这件事机器化** ——
 *   否则下一次仍要靠人撞见（这正是 W26 的 A14、W32 的判据 ④ 栽过的同一个坑）。
 *
 * ## 判据（静态扫文档，四项）
 *   ① **表体可解析**：§六 的两段表都能被切出来（切不出 ⇒ fail-closed，不许静默 0 行）；
 *   ② **状态三态**：每个数据行的状态列必须能被归入 `已收口 / 未收口 / 已登记` 之一
 *      （**未归类 ⇒ 报红**：说明有人写了新措辞而判据没跟上 —— P-14 的名单形态）；
 *   ③ **未收口行必须有锚点**：`scripts/…` 或 `docs/…` 或 `§6.x`（悬空待办 ⇒ 报红）；
 *   ④ ★ **同一事实不得两处结论相反**：按「事实指纹」（从**粗体小标题**里抽标识符，
 *      如 `T-87`、`ef-font-scale.mjs`、判据编号、`P-4x`）分组；同组内若同时出现
 *      「已收口」与「未收口」⇒ **报红**（这是本轮修掉的那一类）。
 *
 * ## 诚实边界（R7）
 *   ① 本闸门管的是**表的结构一致性**，**不是**「未收口项是否真的还没做完」——
 *      后者要逐个真跑（本判据**不假装覆盖**）。
 *   ② 「事实指纹」是**启发式**：它只能抓住**小标题里出现同名标识符**的重复。
 *      两条行若用完全不重叠的措辞描述同一件事，本判据**抓不到**（那是 P-45 的口径边界，
 *      已写进脚注，不假装是全覆盖）。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出违规（fail-closed）    2 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-open-items.mjs --selftest
 *   node scripts/audit-open-items.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOC = path.join(WS, '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md')

/**
 * 状态三态（**穷举**；未归类即报红 —— 防「新措辞悄悄溜进来」，P-14）
 *
 * ★ 「⚠️」也是**历史段在用的**真实状态措辞（探针实测 3 处）：它表达的是
 *   「**已知有局限 / 此前结论被推翻**」——既不是「已收口」也不是「悬空待办」。
 *   ⇒ **显式收录**（而不是靠放宽正则静默放过）；它代表「结论已改写过、理由在正文里」，
 *     故**不参与**「同一事实两处相反」的判定（避免把改写历史误判成矛盾）。
 */
const STATE_CLOSED_RE = /✅/
const STATE_OPEN_RE = /⬜/
const STATE_LOGGED_RE = /📋/
const STATE_CAVEAT_RE = /⚠️/
const KNOWN_ATTRIBUTED_RE = /🚫/

/**
 * 「**已归属**（非我方待办）」的措辞 —— 这类行标 ⬜ 也**不算悬空**。
 *
 * ★ 为什么必须认这一类（首版当场被真实仓库证伪）：§六 里有一条
 *   `| 真机 SAS/LMK 长稳 | Ⅲ | ⬜ **待验证**（见 B-DEVICE-VERIFY-CHECKLIST.md；本机 adb devices 无真机…） |`
 *   —— 它是 **🚫 本机不可达**（goal §11.2 已登记为真机项），**不是悬空的待办**。
 *   判据若一律要求 ⬜ 带「探针 + §6.x」，就会把它报红（**假红**，P-38 过宽形态）。
 *   ⇒ 与 `audit-matrix-residuals.mjs` 的 `ATTRIBUTED_WORDS` **同口径**（P-1：同一语义一处读法）。
 */
const ATTRIBUTED_WORDS = ['本机不可达', '无真机', '真机复核', '属宿主', '属卡页面', '待上游化', '不在我方可改范围']

/** 未收口行的可追踪锚点（探针 / 文档 / 小节号） */
const ANCHOR_RE = /(scripts\/[\w./-]+\.(?:mjs|py|sh|ps1|json)|docs\/[\w.-]+\.md|§\s*\d+(?:\.\d+)*[a-z]?|\bW\d+\b)/

/**
 * 切出 §六 的**表体行**。
 *
 * ★★ **切面必须收在「§六 的表」内**（首版过宽，被真实仓库当场证伪 —— P-38 过宽形态）：
 *   §六 之后紧接的是**逐轮结论** `### 6.1`…`### 6.41`（占全文 2000+ 行，内含大量**其它表格**）。
 *   首版只按「下一个 `## ` 标题」收尾 ⇒ 把那些表格**全当成开放项** ⇒ 一次报出 **267 处假红**
 *   （读数与已知事实严重不符 = P-45 的识别特征）。
 *   ⇒ 修法：**收尾锚点 = `### 6.x` 小节标题**（或 §七 / 文件尾）。
 *
 * ★★ **列切分必须先剥代码片段**（P-41 推论四形态）：
 *   本仓正文里大量出现 `` `a|b` `` 这类**含竖线的反引号代码**（如 `rp/session-(rollback|edit|regenerate)`）。
 *   朴素 `split('|')` 会把它们**切断**，于是「状态列」取到的是正文中段 ⇒ 判据报「状态无法归入三态」
 *   （**3 处假红**）。⇒ 修法：切列前把反引号片段替换成占位符（P-45：判据的扫描面必须与真目标对齐）。
 */
export function extractOpenItemRows (text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => /^##\s*六、当前已知的开放项/.test(l))
  if (start < 0) return null
  // 收尾：进入「逐轮结论」小节（### 6.x）或下一个一级标题
  let end = lines.findIndex((l, i) => i > start && (/^###\s*6\.\d/.test(l) || /^##\s/.test(l)))
  if (end < 0) end = lines.length
  const rows = []
  for (let i = start; i < end; i += 1) {
    const raw = lines[i]
    if (!raw.startsWith('|')) continue
    // 剥掉反引号片段（其中可能含 `|`）
    const masked = raw.replace(/`[^`]*`/g, 'CODE')
    if (/^\|[\s:|-]+\|?\s*$/.test(masked)) continue
    const cells = masked.split('|').slice(1, -1).map(s => s.trim())
    if (cells.length < 3) continue
    if (cells[0] === '项' || cells[0] === '#' || cells[0] === '判据') continue
    rows.push({ line: i + 1, key: raw.split('|')[1]?.trim() ?? '', state: cells[cells.length - 1], body: raw })
  }
  return rows
}

/** 归状态三态；无法归类 ⇒ null */
export function classifyState (stateCell) {
  if (STATE_CLOSED_RE.test(stateCell)) return 'closed'
  if (STATE_OPEN_RE.test(stateCell)) return 'open'
  if (STATE_LOGGED_RE.test(stateCell)) return 'logged'
  if (STATE_CAVEAT_RE.test(stateCell)) return 'caveat'
  if (KNOWN_ATTRIBUTED_RE.test(stateCell)) return 'attributed'
  return null
}

/**
 * 从行的「项」列抽**事实指纹**（用于发现「同一事实两处结论相反」）。
 * 只取**粗体小标题里**的标识符 —— 正文里的重复提及不算（会误报，P-38 过宽形态）。
 *
 * ★★ **工单号必须「无引号也认」**（首版当场被负控 1 证伪）：
 *   真实写法是 `**T-87 判据 8 长期报红：…**` 与 `**T-87 判据 8**（…）` ——
 *   工单号 `T-87` **不在反引号里**，只在粗体内。首版只从反引号里抽 ⇒ 两条行**抽不到同一个指纹**
 *   ⇒ 「同一事实两处相反」**测不出来**（负控 1 报绿，`problems=[]`）。
 *   ⇒ 扩成「反引号标识符 **或** 粗体内的裸工单号 / P 判据号」。
 */
export function factFingerprints (keyCell) {
  const out = new Set()
  const bolds = [...keyCell.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1])
  for (const b of bolds) {
    // 反引号标识符：文件 / 路由 / 判据号
    for (const m of b.matchAll(/`([^`]+)`/g)) {
      const t = m[1].trim()
      if (/^[\w./-]+\.(mjs|ts|tsx|py|sh|ps1|json|md)$/.test(t)) out.add(`file:${path.basename(t)}`)
      else if (/^P-\d+$/i.test(t)) out.add(`pjudge:${t.toUpperCase()}`)
      else if (/^[A-Z]+-\d+$/.test(t)) out.add(`ticket:${t}`)
    }
    // 无引号的 P 判据 / 工单号
    // ★ **不得用 `\b`**（首版当场被负控 1 证伪）：粗体片段含中文（`T-87 判据 8 长期报红`），
    //   而 `\b` 是「词边界」——中文与 ASCII 之间**不构成词边界** ⇒ 匹配不到。
    // ★★ **工单号前缀只要求 ≥1 个大写字母**（第二版又被同一负控证伪）：
    //   首版写 `[A-Z]{2,}`（假设工单号形如 `T-87` 至少两字母），而本仓真实工单号就是 **`T-87`**
    //   —— 单个 `T` ⇒ 匹配不到 ⇒ A=[] B=[] ⇒ 负控 1 仍报绿。
    //   ⇒ 改为 `[A-Z]+`，并用「前面不是字母数字」的负向断言（对中文同样成立）。
    for (const m of b.matchAll(/(?<![A-Za-z0-9])P-(\d+)(?![0-9])/g)) out.add(`pjudge:P-${m[1]}`)
    for (const m of b.matchAll(/(?<![A-Za-z0-9])([A-Z]+-\d+)(?![0-9])/g)) out.add(`ticket:${m[1]}`)
  }
  return out
}

/**
 * 检查整份文档。
 * @returns {{ ok: boolean, problems: string[], rows: number, open: number, fingerprints: number }}
 */
export function checkDoc (text) {
  const problems = []
  const rows = extractOpenItemRows(text)
  if (rows === null) {
    return { ok: false, problems: ['切不出 §六 表（标题没找到）⇒ fail-closed，不许当 0 违规'], rows: 0, open: 0, fingerprints: 0 }
  }
  if (rows.length < 10) {
    return { ok: false, problems: [`§六 表只切出 ${rows.length} 行（<10）⇒ 疑似切面失效，不许当 0 违规`], rows: rows.length, open: 0, fingerprints: 0 }
  }
  let openCount = 0
  const byFp = new Map()
  for (const r of rows) {
    const st = classifyState(r.state)
    if (st === null) {
      problems.push(`第 ${r.line} 行：状态列无法归入三态（✅/⬜/📋/🚫）⇒ 判据的措辞名单需要跟上：${r.state.slice(0, 50)}`)
      continue
    }
    if (st === 'open') {
      openCount += 1
      // 已归属（本机不可达 / 属宿主 / 属卡页面）⇒ **不算悬空**（见 ATTRIBUTED_WORDS 注）
      const attributed = ATTRIBUTED_WORDS.some(w => r.body.includes(w))
      if (!attributed && !ANCHOR_RE.test(r.body)) {
        problems.push(`第 ${r.line} 行：标 ⬜ 未收口，但整行既找不到可追踪锚点（scripts/… / docs/… / §6.x / W\\d+）`
          + `、也不含「已归属」措辞（${ATTRIBUTED_WORDS.join(' / ')}）⇒ 悬空待办`)
      }
    }
    for (const fp of factFingerprints(r.key)) {
      if (!byFp.has(fp)) byFp.set(fp, [])
      byFp.get(fp).push({ line: r.line, state: st })
    }
  }
  // ④ 同一事实不得两处结论相反
  for (const [fp, hits] of byFp) {
    if (hits.length < 2) continue
    const hasClosed = hits.some(h => h.state === 'closed' || h.state === 'attributed' || h.state === 'logged')
    const hasOpen = hits.some(h => h.state === 'open')
    if (hasClosed && hasOpen) {
      problems.push(`事实指纹 ${fp} 出现在 ${hits.map(h => `第 ${h.line} 行(${h.state})`).join(' 与 ')}`
        + ` ⇒ **同一事实两处结论相反**（P-1）：读者无法判断真相，且会误导后人重复排查（P-27）`)
    }
  }
  return { ok: problems.length === 0, problems, rows: rows.length, open: openCount, fingerprints: byFp.size }
}

// ---------------------------------------------------------------------------
// selftest（正控 / 负控 / **杠杆** / 零控）
//   为什么必须有：扫文档的静态闸门**失效时输出与通过完全相同**（P-30）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  const H = '## 六、当前已知的开放项（截至 2026-09-17）\n\n| 项 | 类别 | 状态 |\n|---|---|---|\n'

  // ---- 正控 1：合规样本（一条 ✅ + 一条 ⬜ 带锚点 + 一条 📋）⇒ 通过 ----
  const good = H
    + '| **A 项（`foo.mjs`）** | 判据 | ✅ 已收口（W1） |\n'
    + '| **B 项（`bar.mjs`）** | 判据 | ⬜ 未收口 —— 见 `scripts/probe.mjs`，登记 §6.9 |\n'
    + '| **C 项** | 架构 | 📋 已登记（W22 待拍板） |\n'
    + '| D 项 | Ⅰ | ✅ 已修（`x.ts`） |\n'
    + '| E 项 | Ⅰ | ✅ 已修 |\n'
    + '| F 项 | Ⅰ | ✅ 已修 |\n'
    + '| G 项 | Ⅰ | ✅ 已修 |\n'
    + '| H 项 | Ⅰ | ✅ 已修 |\n'
    + '| I 项 | Ⅰ | ✅ 已修 |\n'
    + '| J 项 | Ⅰ | ✅ 已修 |\n'
  const r1 = checkDoc(good)
  t('正控1：合规样本 ⇒ 通过', r1.ok, r1.problems.join(' / '))

  // ---- ★ 负控 1（**本轮真实事故的复现**）：同一事实两处结论相反 ⇒ 必须报红 ----
  // ★ 样本要让「结论相反」成为**唯一**失败原因（⬜ 行**带**锚点）——
  //   否则会同时触发「悬空待办」，测不出指纹分组是否真的生效（P-20 杠杆的写法要求）。
  const contradictory = H
    + '| **T-87 判据 8 长期报红：子模块 export** | 架构 | ✅ 已按 P-41 改锚收口（W28） |\n'
    + '| **T-87 判据 8**（子模块 export 应降为内部常量） | 架构 | ⬜ **未收口**（第二十一轮发现）—— 登记 §6.26 |\n'
    + '| A 项 | Ⅰ | ✅ 已修 |\n| B 项 | Ⅰ | ✅ 已修 |\n| C 项 | Ⅰ | ✅ 已修 |\n'
    + '| D 项 | Ⅰ | ✅ 已修 |\n| E 项 | Ⅰ | ✅ 已修 |\n| F 项 | Ⅰ | ✅ 已修 |\n'
    + '| G 项 | Ⅰ | ✅ 已修 |\n| H 项 | Ⅰ | ✅ 已修 |\n| I 项 | Ⅰ | ✅ 已修 |\n'
  const r2 = checkDoc(contradictory)
  t('负控1：同一事实两处结论相反 ⇒ 报红（P-1）',
    !r2.ok && /结论相反/.test(r2.problems.join(' ')), `problems=${JSON.stringify(r2.problems.slice(0, 2))}`)
  t('负控1b：报红**精确指向**两处行号',
    /第 5 行.*第 6 行|第 6 行.*第 5 行/.test(r2.problems.join(' ')),
    r2.problems.find(p => /结论相反/.test(p))?.slice(0, 90) ?? '')
  t('负控1c：该样本的失败原因**只有**「结论相反」一项（指纹分组真在起作用）',
    r2.problems.length === 1, `problems=${r2.problems.length}`)

  // ---- ★ 杠杆（P-20）：**只把后一条改成 ✅** ⇒ 负控 1 必须**转绿** ----
  // ★ 锚点必须与上面的样本**逐字一致**（首版锚点漏了尾部「—— 登记 §6.26」⇒ replace 静默不生效
  //   ⇒ 杠杆 FAIL。**凡 `replace` 型杠杆都要断言「替换真的发生了」**，否则测的是「没替换」）。
  const leverFrom = '| **T-87 判据 8**（子模块 export 应降为内部常量） | 架构 | ⬜ **未收口**（第二十一轮发现）—— 登记 §6.26 |'
  const leverTo = '| **T-87 判据 8**（子模块 export 应降为内部常量） | 架构 | ✅ 已收口（W40 纠正过期标记） |'
  if (!contradictory.includes(leverFrom)) {
    t('杠杆前置：替换锚点必须命中（防「没替换」被当成「已修复」）', false, '锚点未命中')
  } else {
    const lever = contradictory.replace(leverFrom, leverTo)
    t('杠杆：仅把后一条改为 ✅ ⇒ 必须转绿', checkDoc(lever).ok, checkDoc(lever).problems.slice(0, 1).join(''))
  }

  // ---- 负控 2：⬜ 未收口但无锚点 ⇒ 报红（悬空待办）----
  const dangling = H + '| **X 项（`z.mjs`）** | Ⅰ | ⬜ 未收口（还没做） |\n'
    + '| A | Ⅰ | ✅ |\n| B | Ⅰ | ✅ |\n| C | Ⅰ | ✅ |\n| D | Ⅰ | ✅ |\n| E | Ⅰ | ✅ |\n'
    + '| F | Ⅰ | ✅ |\n| G | Ⅰ | ✅ |\n| H | Ⅰ | ✅ |\n| I | Ⅰ | ✅ |\n| J | Ⅰ | ✅ |\n'
  t('负控2：⬜ 行无锚点 ⇒ 报红（悬空待办）',
    !checkDoc(dangling).ok && /悬空待办/.test(checkDoc(dangling).problems.join(' ')), '')

  // ---- 负控 3：状态列写了无法归类的措辞 ⇒ 报红（P-14：新措辞不能悄悄溜进来）----
  const unknownState = H + '| **Y 项** | Ⅰ | 🔥 火热进行中 |\n'
    + '| A | Ⅰ | ✅ |\n| B | Ⅰ | ✅ |\n| C | Ⅰ | ✅ |\n| D | Ⅰ | ✅ |\n| E | Ⅰ | ✅ |\n'
    + '| F | Ⅰ | ✅ |\n| G | Ⅰ | ✅ |\n| H | Ⅰ | ✅ |\n| I | Ⅰ | ✅ |\n| J | Ⅰ | ✅ |\n'
  t('负控3：状态措辞无法归类 ⇒ 报红',
    !checkDoc(unknownState).ok && /无法归入三态/.test(checkDoc(unknownState).problems.join(' ')), '')

  // ---- 负控 4：切不出表 / 切出过少 ⇒ 必须报红（不许当 0 违规）----
  t('负控4：切不出 §六 标题 ⇒ 报红（fail-closed）', !checkDoc('## 别的东西\n| a | b | c |\n').ok, '')
  t('负控4b：表体过少（<10 行）⇒ 报红（切面失效不得当通过）',
    !checkDoc(H + '| A | Ⅰ | ✅ |\n').ok, '')

  // ---- 零控：指纹只从**粗体小标题**抽（正文里的重复提及不算 —— 防 P-38 过宽假红）----
  t('零控：正文里（非粗体）提到同名文件 ⇒ 不构成指纹',
    factFingerprints('普通行提到 `foo.mjs` 与 P-1 但不加粗').size === 0,
    `fp=${[...factFingerprints('普通行提到 `foo.mjs` 与 P-1 但不加粗')].join(',')}`)

  // ---- 真实仓库（动态输出）----
  const real = checkDoc(fs.readFileSync(DOC, 'utf8'))
  t('真实仓库：§六 表可解析且行数合理', real.rows >= 10, `rows=${real.rows} open=${real.open} fp=${real.fingerprints}`)
  t('真实仓库：0 违规', real.ok, real.problems.slice(0, 3).join(' ｜ '))

  console.log(fail === 0 ? `\n[openitems selftest] ${total}/${total} PASS` : `\n[openitems selftest] ${fail} FAIL / ${total}`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
  reportSelftest('openitems', total - fail, total)
  // ★★ W75 修：头注承诺「2 = selftest 失败」，而此处原为 `? 0 : 1`
  //   ⇒ 「闸门自己坏了」与「闸门检出违规」返回同一个码 ⇒ 兑现承诺，改为 2。
  process.exit(fail === 0 ? 0 : 2)
}

// ---------------------------------------------------------------------------
// 主流程
//
// ★ 只在**直接执行**时跑（`import` 本模块不得有副作用）——否则探针 / selftest 引它会
//   顺带把主流程跑一遍（读数混在一起，且会污染退出码）。这与 `cdp-eval.mjs` 的
//   「单源被 import」纪律同源（P-1）。
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const r = checkDoc(fs.readFileSync(DOC, 'utf8'))
  console.log(`[开放项] §六 表 ${r.rows} 行（其中 ⬜ 未收口 ${r.open} 行）· 事实指纹 ${r.fingerprints} 个`)
  if (r.ok) {
    console.log('[开放项] OK —— 状态三态可解析、未收口项有锚点、无「同一事实两处结论相反」')
    process.exit(0)
  }
  for (const p of r.problems) console.log(`[开放项] ✗ ${p}`)
  console.log(`\n[开放项] 共 ${r.problems.length} 处问题（§六 是「还欠什么」的 SSOT，矛盾与悬空都会误导后人）`)
  process.exit(1)
}
