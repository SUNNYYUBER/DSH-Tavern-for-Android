#!/usr/bin/env node
/**
 * audit-error-layer-classify.mjs —— **P-47 的常驻护栏**（判据的读数必须按「归因层级」分类）
 * =============================================================================
 * ## 守什么（一句话）
 * 设备探针若**读 UI 错误文本**并据此判 FAIL/SKIP，必须先把文本**按归因层级分类**，
 * 且**只有属于该判据职责的那一层**能影响结论。违反 ⇒ 报红。
 *
 * ## 为什么必须常驻（P-11 元级 + P-46 的递归形态）
 * W34 实证：同一条判据（M7 的 J1）在**修好「一个读数两种含义」的当天**，
 * 又混了另外两种含义（**数据层** vs **传输层**）：
 *   · `Failed to load history: failed to project session …` = **数据层**（宿主拒绝这份数据）⇒ 该判 FAIL
 *   · `Failed to load history: api gateway: Remote stream WebSocket closed` = **传输层**
 *     （`dsh-api-gateway` 的传输载体断开，**会自愈**）⇒ **不该判 FAIL**
 * 混合的后果：**用传输层问题指控数据层**（P-17 错位）+ **训练人忽略该 FAIL**（P-38）。
 * 而**同类排查立刻抓到第二处**（`ui-accept.mjs` 用 `!out.openError` 当「会话能打开」的必要条件）。
 * ⇒ 结论：**P-46 不是一次性动作，而是每条判据的持续义务**。
 *   本闸门把这条义务**机器化**：将来谁新写一个「读错误文本 ⇒ 判 FAIL」的探针而不分类，
 *   在构建期就会被拦下（否则它只会在某次网络抖动时产生一个假 FAIL，而没人知道为什么）。
 *
 * ## 判据（静态，扫 `scripts/*.mjs`）
 *   对每个脚本：
 *     ① 是否有「**错误文本正则**」的痕迹（`Failed to load` / `is corrupt` / `invalid seed` /
 *        `打不开` / `failed to project session` 等，出现在**正则字面量**里）；
 *     ② 若有，则**必须同时**存在**分层**的机器可判痕迹：
 *        · 一个**分级容器**（同时出现 `struct` 与 `transport` 两个键名，或调用 `classifyErrors`），
 *          且
 *        · **判定处只引用 struct 类**（`errStruct` / `loadError?.struct` / `cls.struct`），
 *          且
 *        · **存在把 transport 明确排除的注释或分支**（`不计入结论` / `不判 FAIL` / `会自愈`）。
 *     ③ 三者缺一 ⇒ 报红，并指出缺哪一项。
 *
 * ## 为什么用「三项齐全」而不是「一个字面量匹配」
 * 本项目多次踩「**判据自身的实现假设**」坑（P-29）：只断言「出现 classifyErrors」会被
 * 「保留了旧字段名但没接线」的写法骗过。⇒ 本闸门**同时**要求「分级容器存在」+「判定只用 struct」
 * +「transport 被显式排除」，并要求 **自证**（正控 + 负控 + 杠杆）证明它有区分力。
 *
 * ## 诚实边界（R7）
 * 本闸门**只做静态结构检查**，不证明「分类的关键词覆盖了全部真实错误形态」——
 * 后者由各探针自己的 `--selftest`（如 `ui-accept.mjs` 的 7/7，含**杠杆**与**前提断言**）负责。
 * 本闸门守的是「**有没有做分类这件事**」，不是「分类得对不对」。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出违规（fail-closed）    2 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-error-layer-classify.mjs --selftest
 *   node scripts/audit-error-layer-classify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 本闸门**豁免**的脚本（每项都要写理由；空豁免是允许的 —— 「0 命中」由 selftest 的杠杆证明不是空转） */
const EXEMPT = new Set([
  // `audit-session-integrity.mjs` 的文档注释里**引用**了这些错误文本（作为「我守什么」的说明），
  // 它自己**不读 UI**（读的是文件字节），故不在本闸门职责内。
  'audit-session-integrity.mjs',
  // 本闸门自己：它的**判据定义**里当然含这些关键词。
  'audit-error-layer-classify.mjs',
])

/**
 * 【P-45 的教训 · 首版范围过宽】负控脚本（`*-negctl.mjs`）**天然**含「修前形态」的源码文本
 * 当作**注入载荷**，因而必然命中本闸门的「读了 UI 错误文本」痕迹 —— 但它**自己不读 UI**，
 * 只是在**字符串里**携带那段代码。若不豁免，闸门会把负控装置报成违规（**假红**），
 * 而假红会训练人忽略报警（P-38）。★ 实测：本闸门的**第一个负控**跑出来就命中了这条（自我暴露）。
 */
const NEGCTL_RE = /-negctl\.mjs$/

/** 出现这些模式的脚本才受检（=「读 UI 错误文本」的痕迹） */
const ERROR_TEXT_RE = /Failed to load|failed to project session|is corrupt|invalid seed|打不开/

/** 判定它是否「读了 UI 的 innerText / textContent 并按错误文本下结论」 */
function readsUiErrorText (src) {
  return ERROR_TEXT_RE.test(src) && /innerText|textContent/.test(src)
}

/**
 * 检查一个脚本是否满足 P-47（三项齐全）。
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkP47 (src) {
  const missing = []
  // ① 分级容器：同时出现 struct 与 transport 两个键名（或调用 classifyErrors）
  const hasContainer = (/classifyErrors/.test(src))
    || (/\bstruct\b/.test(src) && /\btransport\b/.test(src))
  if (!hasContainer) missing.push('分级容器（struct/transport 二键或 classifyErrors）')

  // ② 判定处只引用 struct 类。
  //
  // 【判据自身的坑（P-45/P-29）· 前三版都太宽，全部由负控/selftest 当场抓到】
  //   · v1 只断言「出现 errStruct / cls.struct」⇒ 负控 2 假通过（`!cls.struct && !cls.transport` 命中了字面量）。
  //   · v2 把含判定词的行**拼接**后断言「有 struct 且无 transport」⇒ 又太宽：合规行的 struct 掩盖违规行，
  //     **注入负控当场证伪**（注入旧形态后闸门仍绿）。
  //   · v3 改**逐行**，但「判定词」用了 `return` ⇒ 把**注释行**与**辅助函数行**
  //     （`const cls = (re) => { … return … }`）也当成判定行 ⇒ **真实仓库假红 2 处**。
  // ⇒ v4（本版）：**三重收窄** ——
  //   ① **剔除注释行**（trim 后以 `//` `*` `/*` 开头）；
  //   ② 判定词只认**对判定结果的赋值/使用**（`ok` 作为变量：`ok =` / `!ok` / `ok ?` / `ok &&` / `ok ||`），
  //      **不认** `return`（它会命中辅助函数的 `return`）；
  //   ③ 仍要求同行出现「错误容器引用」且**不含** struct 类。
  const JUDGE_RESULT_RE = /\bok\b\s*(=|&&|\|\||\?|\)|,|;)|\bopenFail\b|\bexitCode\b|\bprocess\.exit\b/
  const STRUCT_REF_RE = /(sn\.loadError\?\.struct|loadError\?\.struct|errStruct|cls\.struct)/
  const TRANSPORT_REF_RE = /(loadError\?\.transport|errTransport|cls\.transport)/
  const CONTAINER_REF_RE = /(openError|errTexts|loadError\b|errAny|errish|cls\b)/
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)
  // 违规行 = 判定行里「引用了错误容器但**没有**落在 struct 类上」**或**「同时引用了 transport 类」。
  // 后者（混层）在 W34 是真实缺陷形态：`const ok = !cls.struct && !cls.transport`——
  // 它**含** struct 却被 transport 一起拉进结论 ⇒ 必须有这一条才抓得住。
  const mixedLine = src.split('\n').find(l => {
    if (isComment(l) || !JUDGE_RESULT_RE.test(l)) return false
    if (TRANSPORT_REF_RE.test(l)) return true
    return CONTAINER_REF_RE.test(l) && !STRUCT_REF_RE.test(l)
  })
  // 同时要求：至少**有一行**判定确实落在 struct 上（否则「一处都没接线」也会被逐行规则放过）
  const hasStructJudge = src.split('\n').some(l =>
    !isComment(l) && JUDGE_RESULT_RE.test(l) && STRUCT_REF_RE.test(l) && !TRANSPORT_REF_RE.test(l))
  const judgesOnStruct = mixedLine === undefined && hasStructJudge
  if (!judgesOnStruct) {
    missing.push(mixedLine !== undefined
      ? `判定行混入非 struct 类或 transport 类（该行：${mixedLine.trim().slice(0, 90)}）`
      : '判定行未落在（且仅落在）struct 类上（hasStructJudge=false）')
  }

  // ③ 存在把 transport 明确排除的痕迹（注释或分支）
  const excludesTransport = /不计入结论|不判 FAIL|会自愈|信息项/.test(src)
  if (!excludesTransport) missing.push('显式排除 transport（注释或分支写明「不计入结论 / 不判 FAIL / 会自愈」）')

  return { ok: missing.length === 0, missing }
}

/** 扫全仓受检脚本（排除 EXEMPT） */
export function scanRepo (dir = path.join(WS, 'scripts')) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()
  const violations = []
  let checked = 0
  for (const f of files) {
    if (EXEMPT.has(f) || NEGCTL_RE.test(f)) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    if (!readsUiErrorText(src)) continue
    checked += 1
    const r = checkP47(src)
    if (!r.ok) violations.push({ file: f, missing: r.missing })
  }
  return { checked, violations, scanned: files.length }
}

// ---------------------------------------------------------------------------
// selftest（正控 / 负控 / **杠杆** / 零控）—— 判据自己坏了的输出与通过**完全相同**（P-19/P-30）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // ---- 正控 1：三项齐全的写法（取自 `ui-accept.mjs` 的真实形态）⇒ 通过 ----
  const good = `
    const cls = classifyErrors(out.errTexts ?? [])
    out.errStruct = cls.struct.length ? cls.struct : null
    out.errTransport = cls.transport.length ? cls.transport : null
    // 信息项：传输层不计入结论（会自愈）
    const ok = !out.errStruct && out.composer
  `
  t('正控1：三项齐全 ⇒ 通过', checkP47(good).ok, checkP47(good).missing.join(' / '))

  // ---- 负控 1：**修前**的真实形态（只有 openError，无分类）⇒ 必须报红，且**三项都缺** ----
  const legacy = `
    const errish = all.map(e => e.textContent).filter(t => /Failed to load|corrupt/.test(t))
    res.openError = errish.length ? errish.slice(0, 3) : null
    const ok = !out.openError && out.composer
  `
  const r1 = checkP47(legacy)
  t('负控1：修前形态（无分类）⇒ 报红且三项都缺', !r1.ok && r1.missing.length === 3, `missing=${r1.missing.length}`)

  // ---- 负控 2：**只在判定处**漏了分类（有容器但判定混用两类）⇒ 必须报红（只缺第②项） ----
  const halfDone = `
    const cls = classifyErrors(t)
    // 判定仍用「有没有任何错误」，没分类 —— 会自愈
    const ok = !cls.struct && !cls.transport
  `
  const r2 = checkP47(halfDone)
  t('负控2：有容器但判定混用两类 ⇒ 报红（只缺第②项）',
    !r2.ok && r2.missing.length === 1 && /混入非 struct 类|未落在 struct/.test(r2.missing[0]),
    `missing=${JSON.stringify(r2.missing)}`)

  // ---- 负控 2b（**第二轮加的**）：合规行与违规行**混在同一文件**时，必须**逐行**判定 ----
  // 这一条是本闸门 v2（拼接所有判定行）**真的漏过**的形态：注入负控当场证伪（闸门仍绿）。
  // 样本含分级容器与排除说明（①③齐备），只在**判定行**上留一个旧形态的违规 ⇒ 应**只缺第②项**。
  const mixedLines = `
    const cls = classifyErrors(t)
    const ok = !out.__err && !out.errStruct
    // 传输层不计入结论（会自愈）
    const ok = !out.openError
  `
  const r2b = checkP47(mixedLines)
  t('负控2b：合规行与违规行混排 ⇒ 逐行判定必须抓出违规行（只缺第②项）',
    !r2b.ok && r2b.missing.length === 1 && /判定行/.test(r2b.missing[0]), JSON.stringify(r2b.missing))

  // ---- 负控 3：**没有排除说明** ⇒ 必须报红（只缺第③项）----
  const noExclusion = `
    const cls = classifyErrors(t)
    out.errStruct = cls.struct.length ? cls.struct : null
    const ok = !out.errStruct
  `
  const r3 = checkP47(noExclusion)
  t('负控3：缺「显式排除 transport」⇒ 报红（只缺第③项）', !r3.ok && r3.missing.length === 1 && /排除/.test(r3.missing[0]), `missing=${JSON.stringify(r3.missing)}`)

  // ---- ★ 杠杆（P-20）：**只加**「显式排除」一句 ⇒ 负控 3 必须**转绿** ----
  // 若闸门无杠杆（恒红/恒绿），这一对不可能一红一绿。
  const lever = noExclusion.replace('const ok = !out.errStruct', '// 传输层不计入结论（会自愈）\n    const ok = !out.errStruct')
  t('杠杆：仅补一句「不计入结论」 ⇒ 负控3 必须转绿', checkP47(lever).ok, checkP47(lever).missing.join(' / '))

  // ---- 零控：与错误文本无关的脚本 ⇒ 不受检（不误报）----
  t('零控：无错误文本痕迹的脚本 ⇒ 不触发本闸门', readsUiErrorText('const x = document.querySelectorAll("div").length') === false)

  // ---- 真实仓库：受检面与违规（**动态**输出，不硬编码 —— 受检面会随防线扩容而变）----
  const repo = scanRepo()
  t('真实仓库：受检脚本 ≥1（否则本闸门可能已扫空 = 零信息量）', repo.checked >= 1, `checked=${repo.checked} scanned=${repo.scanned}`)
  t('真实仓库：0 违规', repo.violations.length === 0,
    repo.violations.length ? repo.violations.map(v => `${v.file} 缺: ${v.missing.join('、')}`).join(' ｜ ') : `受检 ${repo.checked} 个脚本`)

  // ★ 单源输出契约（W44 建立）：分数行的**唯一产出点**（P-1：格式串不手抄）。
  //   ★★ W45 实测的真缺陷：本闸门此前收尾是 `[P47 selftest] 9/9 PASS`（旧形态），
  //   而文档里声明着 `selftest 9/9` ⇒ 机器**读不出** ⇒ 该声明**无法被证伪**（P-50 纪律①）。
  reportSelftest('error-layer-classify', total - fail, total)
  // ★★ W75 修：头注承诺「2 = selftest 失败」，而此处原为 `? 0 : 1`
  //   ⇒ **「闸门自己坏了」与「闸门检出违规」返回同一个码**，头注承诺的区分**根本不存在**
  //   （读者/CI 拿到 exit=1 时无法分辨该重跑还是该修代码）⇒ 兑现承诺，改为 2。
  process.exit(fail === 0 ? 0 : 2)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const r = scanRepo()
console.log(`[P47] 扫 ${r.scanned} 个 scripts/*.mjs ⇒ 读 UI 错误文本的受检脚本 ${r.checked} 个（豁免 ${EXEMPT.size} 个）`)
if (r.violations.length === 0) {
  console.log('[P47] OK —— 受检脚本均已按归因层级分类（只有数据层影响结论）')
  process.exit(0)
}
for (const v of r.violations) {
  console.log(`[P47] ✗ ${v.file}`)
  for (const m of v.missing) console.log(`        ↳ 缺：${m}`)
}
console.log(`\n[P47] 共 ${r.violations.length} 个脚本违反 P-47（判据的读数必须按「归因层级」分类）`)
process.exit(1)
