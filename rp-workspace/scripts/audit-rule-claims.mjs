#!/usr/bin/env node
/**
 * audit-rule-claims.mjs —— **§七 纪律表的「机器化落点」声明闸门**
 * =============================================================================
 * ## 守什么（一句话）
 * `GOAL.md` §七 每条纪律（R1~R23）里凡**声明「这件事已被机器守着」**
 * （「已机器化」/「已加静态护栏」/「已接入 Step X」/「由 `<装置>` 常驻守」/「判据报红」…），
 * 该声明必须满足三条：
 *   ① **点名装置**（写清是哪个脚本/规格在守）——
 *      只写「已加静态护栏」而不写装置 = 读者**无法验证**，也无法在改坏时知道该跑什么；
 *   ② **点名的装置真实存在**（P-52 同族：写了 ≠ 找得到）；
 *   ③ ★★ **它的「触发路径」必须可判定** —— 即它要么在**构建期门禁**里（`build-dsht.ps1`），
 *      要么是一条**可被 R1 基线回归跑到**的 vitest 规格（`packages/tests/*.spec.ts`）。
 *      两者都不是 ⇒ **没有任何人会在正常流程里跑到它** ⇒ 「已加护栏」是**空声明**。
 *
 * ## 为什么必须常驻（W50 实测的真缺陷）
 * **R19** 写「**已加静态护栏：DOM 增强模块扫出 `replaceChild` 即报红**」——
 * 而它**没点名装置**。取证后：护栏真身是 `packages/tests/touch-target-audit.spec.ts`
 * 的 **P-31 家族回归锁**，**不在构建期 45 条门禁内**（只走 vitest）。
 * ★ 读者按字面理解会以为**构建期就守着** —— 而构建期**一条都不查它**
 * （`grep vitest build-dsht.ps1` = 0 命中）。
 * ★★ 这正是 **P-55 的同族形态**（「声明指向的东西，在**读者会走的路径**上存不存在」）：
 *   不是「文档里写了某个装置」（P-52），也不是「装置在不在版本控制」（P-53），
 *   而是「**装置会不会被真的跑到**」。
 *
 * ## 判据（三项）
 *   ① **声明有机器守 ⇒ 必须点名装置**（没点名 ⇒ 报红，且报出行号）；
 *   ② **点名的装置必须真实存在**（`scripts/…` / `packages/tests/…` 任一处）；
 *   ③ ★★ **触发路径必须可判定**：装置在 `build-dsht.ps1` 里出现（构建期门禁）
 *      或是一条存在的 `*.spec.ts`（vitest ⇒ 由 R1 基线回归承接）——
 *      两者都不是 ⇒ 报红（**没有任何常规流程会跑到它**）。
 *
 * ## 诚实边界（R7）
 *   ① 本闸门只查「**规范性纪律**的声明」（GOAL §七），不查 §十一 逐轮记录里的叙述
 *      （那是史实，`—— 见 §十一` 的措辞与「当时」绑定）。
 *   ② 「触发路径」只认**两条真实通路**（构建期门禁 / vitest 规格）——
 *      若将来出现第三条通路（如 CI 专用脚本），需在此表**显式登记**，否则报红
 *      （这是刻意的：**新通路必须有人确认过它真的会被跑到**）。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出违规（fail-closed）    2 = 输入缺失（找不到 GOAL）    3 = selftest 失败
 *
 * ★★ **W75 修（本段与实现原本两处都对不上）**：原写 `0 / 1 / 2`，而实现是
 *   `process.exit(okAll ? 0 : **3**)`（selftest 分支）+ `process.exit(**2**)`（输入缺失分支）
 *   ⇒ ⑴ 头注声明的「2 = selftest 失败」**是幽灵声明**（永不发生）；
 *     ⑵ 实现真正返回的 `3` **没有声明** ⇒ 读者/CI 拿到 exit=3 时无从解释
 *     （**P-46**：两种不同的事实必须有两个不同的读数）。
 *   ★ 直接改成如实描述（**不新建码** —— 既有的 `3` 已被负控与构建脚本当「selftest 失败」用）。
 *
 * 用法：
 *   node scripts/audit-rule-claims.mjs --selftest
 *   node scripts/audit-rule-claims.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const GOAL = path.join(ROOT, 'docs', 'GOAL.md')
const BUILD = path.join(WS, 'scripts', 'build-dsht.ps1')

/** 纪律条目行：`| **R13** | ...`（表格）或 `- **R13（说明）**：...`（列表） */
export const RULE_ITEM_RE = /^(?:\|\s*\*\*(R\d+)\*\*\s*\|)|(?:-\s*\*\*(R\d+)(?:（[^）]*）)?\*\*)/
/**
 * ★★ **P 判据索引条目行**（`| P-48 | **标题** | ...`）—— **W53 新增**。
 *
 * ## 为什么必须加（**W53 实测：同类声明在另一个区无人守**）
 * W50 建的 `audit-rule-claims.mjs` **只扫 §七 纪律表**（覆盖 3 条声明）；
 * 而 **§九「已产出的设计哲学资产」的 P 判据索引**里有**同一类声明**
 * （「**W38 已机器化**为 `audit-p48-rollback.mjs` …」/「**W44 已机器化**为 `selftest-summary.mjs` + …」），
 * 实测 **9 条**，**从未被任何闸门扫过** ⇒ 现在恰好都对 = **运气不是判据力**（**W45** 的教科书识别特征）。
 * ★ 按 **P-1**（同一语义只许一处实现）**扩本闸门**，而不是新建第二个脚本 ——
 *   「声明的机器化落点是否真实且会被跑到」**只有一个语义**。
 */
export const PITEM_RE = /^\|\s*(P-\d+)\s*\|/

/**
 * 本闸门扫描的**两个区**（**W53 扩**）。
 * ★ 每区声明「怎么定位条目 / 怎么切块 / 区内怎么抽 P 判据号（可选）」。
 */
export const SCAN_SECTIONS = [
  {
    key: '§七 纪律',
    from: /^##\s*七、/,
    to: /^##\s*八、/,
    itemRe: RULE_ITEM_RE,
    idOf: (m) => m[1] ?? m[2],
    refOf: null
  },
  {
    key: '§九 P 判据索引',
    from: /^##\s*九、/,
    to: /^##\s*十、/,
    itemRe: PITEM_RE,
    idOf: (m) => m[1],
    // ★ §九 的条目行末尾常带「| 见 `docs/…` §5.4 |」这类**落点列** ⇒ 续行/同行的引用都算
    refOf: null
  }
]
/**
 * 「声明已有机器守」的措辞（**语义口径** —— 说的是「已被机器守着」，不是泛泛提到「判据」二字）。
 * ★ 口径纪律（守 P-45）：**按语义写，不按某一句原文写** ——
 *   首版只写「已机器化」⇒ 漏掉 R23 那句「**W38 机器化**」（不带「已」）⇒ 漏守（W50 实测）。
 * ★★ **但也不能宽到 `[^已]机器化`**（**W53 实测的假红**）：那条会匹配
 *   「把**结论机器化**」（**P-37** 定义行）—— 那是**动作/祈使语境**（"去把它机器化"），
 *   **不是「已被机器守着」的状态声明** ⇒ 报出**假红**（**P-38**：过宽 ⇒ 假红 ⇒ 训练人忽略报警）。
 *   ⇒ 按 **P-41**（锚到决定结果的事实）：**状态声明**的判据特征是**「已」或「周次」** ——
 *     「**已**机器化」/「**W38** 机器化」都指向**一个已发生的事实**；
 *     而「结论机器化」是**宾语 + 动作**，指向**待办**。
 */
export const CLAIM_RE = /已机器化|W\d+\s*机器化|已加(?:静态)?护栏|已接入\s*(?:Step|常驻)|由[^。]{0,40}常驻守|闸门[^。]{0,20}守|判据[^。]{0,10}报红/

/**
 * 装置名（反引号内的脚本文件名）。
 * ★★ **必须覆盖闸门/规格两类装置**（**W50 实测的口径缺陷**）：
 *   首版只写 `mjs|py|ps1|sh` ⇒ 把 R19 点名的 `packages/tests/touch-target-audit.spec.ts`
 *   **整个漏掉** ⇒ 于是「已点名装置」被误判成「没点名」= **假红**（P-45：扫描面与真目标错位）。
 *   ⇒ 纳入 `ts`，并允许**带路径前缀**（`packages/tests/x.spec.ts` 的裸名才是 `x.spec.ts`）。
 */
export const SCRIPT_RE = /`(?:[\w./-]*\/)?([\w-]+\.(?:mjs|py|ps1|sh|spec\.ts))`/g

/**
 * 把 §七 切成**纪律块**（条目行 + 后续缩进/引用续行，直到下一条目或顶格非续行）。
 * ★ 为什么必须收续行：R19 的「已加静态护栏」**写在续行（`>` 引用块）里**，
 *   只读条目行 ⇒ **整个声明都看不到**（首版实测：漏掉 R19 = 漏掉本轮的真缺陷）。
 *
 * @param {string[]} lines
 * @param {number} from  起始行下标（含）
 * @param {number} to    结束行下标（不含）
 * @param {RegExp} [itemRe] 条目行正则（默认 `RULE_ITEM_RE`；**W53** 起 §九 传 `PITEM_RE`）
 * @param {(m:RegExpExecArray)=>string} [idOf] 从匹配结果取条目 ID（默认取 `m[1] ?? m[2]`）
 */
export function parseRuleBlocks (lines, from, to, itemRe = RULE_ITEM_RE, idOf = (m) => m[1] ?? m[2]) {
  const blocks = []
  let cur = null
  for (let i = from; i < to; i += 1) {
    const l = lines[i]
    if (itemRe.test(l)) {
      const m = itemRe.exec(l)
      cur = { id: idOf(m), line: i + 1, lines: [l] }
      blocks.push(cur)
      continue
    }
    if (!cur) continue
    // ★★ 续行规则**必须区分「表格行」与「非表格行」**（**W53 实测的坑**）：
    //   §九 的 P 判据索引是**单行长表**（每个条目一行、无续行），
    //   而**表格之后的顶格正文**（如 §九 末尾的「**每轮必须产出至少一条新判据…**」）
    //   若被当成续行，会把**区段外的说明文字并进最后一条判据** ⇒ 判据在**错的文本**上跑（P-45）。
    //   ⇒ 规则：本条目是表格行 ⇒ **只有表格行才算续行**；否则维持原规则（缩进/引用块）。
    const isTableItem = /^\|/.test(cur.lines[0])
    const cont = isTableItem
      ? /^\|/.test(l)                       // 表格条目：只收表格行
      : (/^\s{2,}\S/.test(l) || /^>/.test(l) || l.trim() === '')
    if (cont) cur.lines.push(l)
    else if (l.trim() !== '') cur = null   // 顶格新内容 ⇒ 本块结束
  }
  for (const b of blocks) b.text = b.lines.join('\n')
  return blocks
}

/** 该装置是否真实存在（`scripts/` 或 `packages/tests/` 任一） */
export function deviceExists (name) {
  return [path.join(WS, 'scripts', name), path.join(WS, 'packages', 'tests', name)].some(p => fs.existsSync(p))
}

/**
 * ★★ 触发路径判定（**本闸门最有价值的一条**）。
 * @param {string} name 装置名
 * @param {string} buildText `build-dsht.ps1` 全文
 * @returns {'build'|'vitest'|null}  null ⇒ **没有任何常规流程会跑到它**
 */
export function triggerPathOf (name, buildText) {
  if (buildText.includes(name)) return 'build'
  // vitest 规格：本体是 `*.spec.ts`，或同名的 `.mjs` 被某个 spec 引用
  if (/\.spec\.ts$/.test(name)) return deviceExists(name) ? 'vitest' : null
  const testsDir = path.join(WS, 'packages', 'tests')
  if (!fs.existsSync(testsDir)) return null
  const specs = fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'))
  for (const s of specs) {
    const t = fs.readFileSync(path.join(testsDir, s), 'utf8')
    if (t.includes(name)) return 'vitest'
  }
  return null
}

/**
 * 检查一个纪律块（**纯函数**，便于 selftest 用合成样本）。
 * @returns {{id:string,line:number,violation:string,detail:string}|null}
 */
export function checkRuleBlock (block, buildText) {
  if (!CLAIM_RE.test(block.text)) return null
  const names = [...new Set([...block.text.matchAll(SCRIPT_RE)].map(m => m[1]))]
  if (names.length === 0) {
    return { id: block.id, line: block.line, violation: '声明有机器守但没点名装置', detail: '' }
  }
  const missing = names.filter(n => !deviceExists(n))
  if (missing.length > 0) {
    return { id: block.id, line: block.line, violation: '点名的装置不存在', detail: missing.join(' ') }
  }
  const noTrigger = names.filter(n => triggerPathOf(n, buildText) === null)
  if (noTrigger.length === names.length) {
    return { id: block.id, line: block.line, violation: '点名的装置没有可判定的触发路径', detail: names.join(' ') }
  }
  return null
}

/**
 * 扫 GOAL 的**全部受守区**（**W53：§七 纪律 + §九 P 判据索引**）—— **纯函数**，供主流程与负控共用（P-1）。
 * @param {string} goalText
 * @param {string} buildText
 * @param {{skipLines?:Set<number>}} [opt] `skipLines` = 要跳过的原文行号（1-based；负控用）
 */
export function scanRuleClaims (goalText, buildText, opt = {}) {
  const lines = goalText.split(/\r?\n/)
  const problems = []
  const allBlocks = []
  const sections = []
  for (const sec of SCAN_SECTIONS) {
    const from = lines.findIndex(l => sec.from.test(l))
    const to = lines.findIndex((l, i) => i > from && sec.to.test(l))
    if (from < 0 || to <= from) {
      // ★ fail-closed（P-30）：切不出 ⇒ 该区**完全不被检查**，必须出声而不是静默跳过
      return { ok: false, reason: `切不出 GOAL ${sec.key}（区段标题缺失 / 顺序不对）`, blocks: [], problems: [], sections }
    }
    const blocks = parseRuleBlocks(lines, from, to, sec.itemRe, sec.idOf)
    allBlocks.push(...blocks)
    const claimCount = blocks.filter(b => CLAIM_RE.test(b.text)).length
    for (const b of blocks) {
      if (opt.skipLines && opt.skipLines.has(b.line)) continue
      const v = checkRuleBlock(b, buildText)
      if (v) problems.push({ ...v, section: sec.key })
    }
    sections.push({ key: sec.key, blocks: blocks.length, claiming: claimCount })
  }
  return { ok: true, blocks: allBlocks, problems, sections, claiming: sections.reduce((a, s) => a + s.claiming, 0) }
}

/** 主流程用的 GOAL 路径（供负控复用） */
export const GOAL_PATH = GOAL
/** 主流程用的构建脚本路径（供负控复用） */
export const BUILD_PATH = BUILD

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
// ★★ **`--selftest` 分支同样必须有 `isMain` 守卫**（**W50 实测踩到 —— 比上一条更隐蔽**）：
//   负控要 `import` 本模块的纯函数，而**负控自己也是用 `--selftest` 跑的**
//   ⇒ 顶层 `if (process.argv.includes('--selftest'))` **无条件成立** ⇒
//   import 时直接把**闸门的** selftest 跑了一遍、打印 `rule-claims 14/14`、并 `process.exit(0)`
//   ⇒ 负控的**真分数 `10/10` 被闸门的 `14/14` 顶掉**（`audit-selftest-claims` 读到的就是后者）。
//   ★ 识别特征：**同一个脚本两次跑出不同分数**（直接跑 10/10、被闸门探测时 14/14）= **P-46**。
//   ⇒ 纪律：**可被 import 的模块，其所有「顶层副作用」都必须收进 `isMain` 守卫**（含 selftest）。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain && process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }
  const buildText = fs.existsSync(BUILD) ? fs.readFileSync(BUILD, 'utf8') : ''

  // ---- 正控：合规块（声明 + 点名 + 构建期触发）⇒ 不报红 ----
  const okBlock = { id: 'R99', line: 1, text: '- **R99（示例）**：已机器化为 `audit-open-items.mjs`（常驻守）。' }
  t('正控：声明有机器守 + 点名装置 + 该装置在构建期触发 ⇒ **不报红**',
    checkRuleBlock(okBlock, buildText) === null, JSON.stringify(checkRuleBlock(okBlock, buildText)))

  // ---- ★ 负控 1（W50 的真缺陷形态）：声明有机器守但**没点名装置** ----
  const noName = { id: 'R19', line: 2, text: '> 见 P-31。已加静态护栏：DOM 增强模块扫出 `replaceChild` 即报红。' }
  const r1 = checkRuleBlock(noName, buildText)
  t('★负控1（W50 真实形态）：声明「已加静态护栏」但**没点名装置** ⇒ **必须报红**',
    r1 !== null && r1.violation === '声明有机器守但没点名装置', JSON.stringify(r1))

  // ---- ★ 负控 2：点名了但**装置不存在** ----
  const ghost = { id: 'R98', line: 3, text: '- **R98**：已机器化为 `audit-ghost-guard.mjs`。' }
  const r2 = checkRuleBlock(ghost, buildText)
  t('★负控2：点名一个**不存在**的装置 ⇒ 必须报红（P-52 同族：写了 ≠ 找得到）',
    r2 !== null && r2.violation === '点名的装置不存在', JSON.stringify(r2))

  // ---- ★★ 负控 3（本闸门的新判据）：装置存在，但**没有任何常规流程会跑到它** ----
  //   ★ 样本必须**真实存在**（否则会退化成「装置不存在」，测不到本条判据 —— 首版实测踩到），
  //     且**确定不在构建期、也不被任何 spec 引用**（实测选取 `stage4-regression.mjs`）。
  const ORPHAN = 'stage4-regression.mjs'
  const orphanExists = deviceExists(ORPHAN)
  const orphanTrigger = triggerPathOf(ORPHAN, buildText)
  t('★负控3 前置：所选的「孤儿装置」样本**必须真实存在**（否则测的是负控 2）', orphanExists, ORPHAN)
  t('★负控3 前置：该样本**必须无触发路径**（否则本负控失效）', orphanTrigger === null, `触发=${orphanTrigger}`)
  const orphan = { id: 'R97', line: 4, text: `- **R97**：已机器化为 \`${ORPHAN}\`（常驻守）。` }
  const r3 = checkRuleBlock(orphan, buildText)
  t('★★负控3：装置**真实存在**但既不在构建期、也不被任何 vitest 规格引用 ⇒ 必须报红（「已加护栏」= 空声明）',
    r3 !== null && r3.violation === '点名的装置没有可判定的触发路径', JSON.stringify(r3))

  // ---- ★ 杠杆（P-20）：同一块只改「触发路径」⇒ **必须转绿** ----
  const okTrigger = { id: 'R97', line: 4, text: '- **R97**：已机器化为 `audit-open-items.mjs`（常驻守）。' }
  t('★杠杆：把装置换成「在构建期触发」的那个 ⇒ **必须转绿**（证明负控 3 不是恒定红）',
    checkRuleBlock(okTrigger, buildText) === null, '')

  // ---- 零控：不含「声明有机器守」措辞的块 ⇒ 不报红（纯纪律不该被误伤，守 P-38）----
  const plainRule = { id: 'R2', line: 5, text: '- **R2（发现即归位）**：每个问题必须归入四层 + A~F 轨道。' }
  t('★零控：纯纪律（无「机器守」声明）⇒ **不得**报红（防过宽误伤 —— P-38）',
    checkRuleBlock(plainRule, buildText) === null, '')

  // ---- ★ 口径正控（P-45）：R23 的「**W38 机器化**」（不带「已」）**必须**被认为是在声明 ----
  const noYi = { id: 'R23', line: 6, text: '- **R23**：**W38 机器化**（`audit-p48-rollback.mjs`）。' }
  t('★口径正控（P-45）：「W38 机器化」这种**不带「已」**的写法**必须**被认作声明（首版漏掉 ⇒ 漏守）',
    CLAIM_RE.test(noYi.text), '')

  // ---- ★★ 续行正控：R19 的声明写在**引用块续行**里 ⇒ 必须被块解析收进来 ----
  const sample = [
    '- **R19（宿主 React 子树内禁用 replaceChild）**：凡在宿主渲染产物内做 DOM 增强的模块，',
    '  一律不得替换 React 持有的节点。',
    '  > 见 P-31。已加静态护栏：DOM 增强模块扫出 `replaceChild` 即报红。',
    '- **R20（UI 类判据必须断言「我方容器是否存在」）**：不得只断言「页面上有没有内容」。'
  ]
  const blocks = parseRuleBlocks(sample, 0, sample.length)
  const r19 = blocks.find(b => b.id === 'R19')
  t('★★正控（续行）：声明写在**引用块续行**里 ⇒ 必须被块解析收进来（只读条目行会漏掉整个声明）',
    blocks.length === 2 && r19 !== undefined && CLAIM_RE.test(r19.text), `blocks=${blocks.length} R19命中=${r19 ? CLAIM_RE.test(r19.text) : 'n/a'}`)
  t('★正控（切块）：R20 未被并入 R19（顶格新条目 ⇒ 上一块结束）',
    blocks.length === 2 && blocks[1].id === 'R20' && !/replaceChild/.test(blocks[1].text), '')

  // ---- ★★ W53 新增三组断言（扫描面扩到 §九 + 表格续行规则 + CLAIM_RE 收窄）----
  //   ① CLAIM_RE 收窄（P-41/P-38）：**动作语境**的「机器化」不得被认作状态声明
  t('★零控（CLAIM_RE 收窄）：P-37 的「把**结论机器化**」（**动作/祈使**语境）⇒ **不得**被认作「已被机器守着」',
    !CLAIM_RE.test('盲区必须量化**实际后果**并把结论机器化（否则不是「已收口」）'), String(CLAIM_RE))
  t('★正控（CLAIM_RE 收窄）：「**W38 机器化**」（带周次 = 已发生的事实）⇒ **必须**被认作声明（不得一起收窄掉）',
    CLAIM_RE.test('**W38 机器化**（`audit-p48-rollback.mjs`）'), '')
  t('★杠杆（CLAIM_RE 收窄）：同一句加「已」/加周次 ⇒ 结论翻转（证明收窄是**方向性**的，不是把判据改废）',
    !CLAIM_RE.test('把结论机器化') && CLAIM_RE.test('已机器化') && CLAIM_RE.test('W38 机器化'), '')
  //   ② 表格续行规则（P-45）：**表格条目不得吞掉表格之后的顶格正文**
  const tblSample = [
    '| P-48 | **标题** 已机器化为 `audit-p48-rollback.mjs` |',
    '| P-49 | **另一个** |',
    '',
    '**每轮必须产出至少一条新判据**（这是表格之外的正文，不得被并进 P-49）',
    '| P-50 | 第三行 |'
  ]
  const tblBlocks = parseRuleBlocks(tblSample, 0, tblSample.length, PITEM_RE, (m) => m[1])
  t('★★正控（表格续行）：表格之后的**顶格正文**不得被并进上一条（否则判据在**错的文本**上跑，P-45）',
    tblBlocks.length === 3 && tblBlocks[1].id === 'P-49' && !/每轮必须产出/.test(tblBlocks[1].text),
    `blocks=${tblBlocks.length} P-49含正文=${tblBlocks[1] ? /每轮必须产出/.test(tblBlocks[1].text) : 'n/a'}`)
  t('★正控（表格续行）：P-50 仍是独立条目（表格行之后仍能开新条目）',
    tblBlocks.length === 3 && tblBlocks[2].id === 'P-50', JSON.stringify(tblBlocks.map(b => b.id)))
  //   ③ 扫描面（P-1/P-55）：§九 必须在受守区内，且**真的被扫到**
  t('★正控（扫描面 W53）：`SCAN_SECTIONS` 至少含 §七 与 §九 两区（此前只有 §七 ⇒ §九 同类声明**无人守**）',
    SCAN_SECTIONS.length >= 2 && SCAN_SECTIONS.some(s => s.key.includes('§九')), SCAN_SECTIONS.map(s => s.key).join(' '))
  //   ★★ 注意：**不得**用「自造字符串喂给正则」来断言真实仓库被扫到（那是**空转** = P-30）——
  //      必须**实调 `scanRuleClaims`** 读真文档。
  const realRes = scanRuleClaims(fs.readFileSync(GOAL, 'utf8'), buildText)
  const s9 = realRes.sections.find(s => s.key.includes('§九'))
  t('★★真实仓库（W53）：§九 P 判据索引**切面成立**（blocks ≥ 30 且 claiming ≥ 1 —— 0 条 ⇒ 判据**空转**，P-30）',
    s9 !== undefined && s9.blocks >= 30 && s9.claiming >= 1, JSON.stringify(s9))
  t('★真实仓库（W53）：§九 当前 0 违规（与主流程同源，P-1）',
    realRes.problems.filter(p => p.section.includes('§九')).length === 0,
    JSON.stringify(realRes.problems.map(p => `${p.section}:${p.id}`)))

  // ---- 真实仓库：GOAL §七 必须可解析 + 当前 0 违规 ----
  const lines = fs.readFileSync(GOAL, 'utf8').split(/\r?\n/)
  const i7 = lines.findIndex(l => /^##\s*七、/.test(l))
  const i8 = lines.findIndex(l => /^##\s*八、/.test(l))
  t('★真实仓库：§七 可切出（切不出 ⇒ 本判据的扫描面不成立）', i7 >= 0 && i8 > i7, `§七 L${i7 + 1} · §八 L${i8 + 1}`)
  const realBlocks = parseRuleBlocks(lines, i7, i8)
  t('★真实仓库：§七 解析出 ≥ 20 条纪律（跌破 ⇒ 说明条目形态变了，判据需重评）', realBlocks.length >= 20, `${realBlocks.length} 条`)
  const claiming = realBlocks.filter(b => CLAIM_RE.test(b.text))
  t('★真实仓库：至少有一条纪律声明「有机器守」（0 条 ⇒ 判据空转，P-30）', claiming.length > 0, `${claiming.length} 条`)

  const okAll = fail === 0
  reportSelftest('rule-claims', total - fail, total)
  process.exit(okAll ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
// ★★ **必须有 `isMain` 守卫**（**W50 实测踩到**）：负控要 `import` 本模块的纯函数，
//   若主流程在顶层无条件执行 ⇒ **import 时就把闸门跑一遍**（负控输出里混进闸门输出，
//   而且 `process.exit()` 会**直接把负控进程杀掉**）。
//   本仓同类坑：W45 的「自调用递归」（闸门→负控→闸门→…）。⇒ 顶层只导出，主流程认 `isMain`。
if (isMain) {
  const buildText = fs.existsSync(BUILD) ? fs.readFileSync(BUILD, 'utf8') : ''
  const res = scanRuleClaims(fs.readFileSync(GOAL, 'utf8'), buildText)
  if (!res.ok) {
    console.error(`✗ ${res.reason} ⇒ fail-closed`)
    process.exit(2)
  }
  const problems = res.problems

  const secs = res.sections.map(s => `${s.key} ${s.blocks} 条（声明有机器守 ${s.claiming} 条）`).join(' · ')
  console.log(`[纪律声明] 扫描 ${res.sections.length} 个受守区：${secs} · 违规 ${problems.length} 处`)
  if (problems.length === 0) {
    console.log('[纪律声明] OK —— 凡声明「已机器化/已加护栏/常驻守」的**纪律与 P 判据**，都点名了**真实存在**且**触发路径可判定**的装置')
    process.exit(0)
  }
  for (const p of problems) {
    console.log(`[纪律声明] ✗ [${p.section}] ${p.id}（第 ${p.line} 行）：${p.violation}${p.detail ? ` ⇒ ${p.detail}` : ''}`)
  }
  console.log(`\n[纪律声明] 共 ${problems.length} 处（「已加护栏」若无人会跑到，就是空声明）`)
  process.exit(1)
}
