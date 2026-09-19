#!/usr/bin/env node
/**
 * A11 —— shim 模板串「未转义反引号」闸门（L70 第 5 次复现后新增，心跳 65）
 *
 * ## 为什么需要
 * `th-shim.ts` 的 `buildShimSource()` 把**整份 iframe shim 源码**放在一个 TS 模板串里
 * （`return \`(function () { … }\``）。模板串体内**任何未转义的反引号都会提前终止它**
 * ⇒ 其后所有代码被当成 TS 模块级语句解析 ⇒ `tsc` 报一堆与真因无关的错误：
 *   `TS1005: ';' expected` / `TS1443: Module declaration names may only use ' or " quoted strings`
 * ⇒ 定位成本高（已复现 **5 次**：心跳 62 / 62B / 63C / 64 / 65）。
 *
 * ## 判据（为什么不是"数反引号"）
 * 用 **JS 语义**从模板起始反引号向后扫（跟踪 `\` 转义、`${}` 深度、`${}` 内的嵌套模板），
 * 找到**真正的**终止反引号。然后断言终止符之后紧接的是 `buildShimSource` 的函数结尾。
 *  - 若体内有未转义反引号 ⇒ 扫描会在**那里**停下 ⇒ 其后紧接的不是函数结尾 ⇒ **报错**，
 *    且报出的位置**逐字指向肇事反引号**（这正是不数数也能精确定位的原因）。
 *  - 合法的 `${...}` 插值（如 `return ${JSON.stringify(opts.version)};`）被正确跳过，不误报。
 *
 * ## 正控/负控
 * `--selftest` 用**构造语料**跑三例：正控（体内裸反引号 ⇒ 必须报）、
 * 负控（体内转义反引号 + 合法插值 ⇒ 必须过）、零控（真实文件 ⇒ 必须过）。
 * 无 `--selftest` 通过则视为闸门自身不可信 ⇒ 按 A7/A10 惯例 **die**。
 *
 * 用法：node scripts/audit-shim-template-literal.mjs [--selftest] [-v]
 *       node scripts/audit-shim-template-literal.mjs --file <path>
 *         # 单文件模式：在**真实文件的副本**上做正控（新防线的最佳正控是在真实缺陷上跑）
 *         # ★ W77 补：此前实现已支持 `--file` 而**用法行没写** ⇒ 能力不可发现
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')

// ---------------------------------------------------------------------------
// 注入载荷的扫描口径（W40 上移到顶部；原因见文件下方 INJECT_CALLS 处的注记）
// ---------------------------------------------------------------------------
const INJECT_CALLS = ['evalJs', 'evalJson']
const RESIDENT_PROBE_RE = /^ef-.*\.mjs$/

/**
 * 找出「注入载荷模板串」的**所有**形态（返回每处的起始行号，1-based）。
 * 形态 ①：`await <helper>(\`` —— 直接内联
 * 形态 ②：`const <NAME> = \``，且 <NAME> 在本文件里**被当作注入载荷使用**
 *（`evalJs(NAME)` / `source: NAME` / `evaluate(NAME)`）—— W40 新增
 *
 * ★★ 为什么必须有形态 ②（W40 实测）：本仓为「注入随页面重载自动重装」把注入体抽成常量
 *   （`const EFJ_SOURCE = \`…\`` + `await evalJs(EFJ_SOURCE)` + `source: EFJ_SOURCE`），
 *   于是「`await <helper>(\`` 的形态**一个都不匹配** ⇒ 该模板串**整体逃出本闸门守护面**。
 *   我在它体内写了 **6 处裸反引号**，闸门一次都没出声（直到 node 报语法错）——
 *   正是本文件注释里警告过的失败模式，只是换了入口（**P-41 推论四**：判据的输入未受保护）。
 */
export function findInjectionTemplateStarts (src) {
  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    if (INJECT_CALLS.some(h => new RegExp(`await\\s+${h}\\s*\\(\\s*\\x60`).test(l))) { hits.push({ line: i + 1, kind: 'inline' }); continue }
    const m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\x60/.exec(l)
    if (!m) continue
    const name = m[1]
    // 该常量必须**真的被当注入载荷用**（否则普通模板串不受本闸门约束 —— 防过宽，P-38）
    const used = new RegExp(`(?:\\bevalJs\\s*\\(|\\bevalJson\\s*\\(|\\bsource\\s*:|\\bevaluate\\s*\\(|\\bsend\\s*\\([^)]*\\b)\\s*${name}\\b`).test(src)
    if (used) hits.push({ line: i + 1, kind: 'const', name })
  }
  return hits
}

/**
 * 受检的「大模板串」清单（2026-09-14 扩容）。
 *
 * ## 为什么从 1 个扩到 3 个
 * 本闸门原只查 th-shim.ts。但同类结构在本项目**到处都有**：把整份 CSS / 整份 shim 源码
 * 塞进一个 TS 模板串。2026-09-14 修 L1 触控目标时，在**两个 CSS 模板串**里连续踩中
 * 同一个坑（注释里写了反引号 ⇒ 模板串提前终止 ⇒ tsc 报一堆与真因无关的错）——
 * 说明「只查一个文件」的防线有整类盲区（本项目反复出现的母题）。
 *
 * 每项声明：文件 + **模板起始锚点**（用于在正确位置开始扫描）。
 * 锚点缺失 ⇒ fail-closed（不许静默放行）。
 */
const TARGETS = [
  {
    name: 'th-shim 模板串',
    file: 'packages/src/dsht-rp-ui/src/client/th-shim.ts',
    anchor: 'return `(function',
    // shim 模板串的终止符之后应当紧接 buildShimSource 的函数结尾 `}`
    afterOk: /^\s*\}/,
    afterHint: '函数结尾 }',
  },
  {
    name: 'dsht-rp-ui CSS 模板串',
    file: 'packages/src/dsht-rp-ui/src/client/style.ts',
    anchor: 'const css = `',
    // 【第二十轮收紧 · 判据自身的盲区】原为 /^\s*(?:$|\n|\/\/|export)/ ——
    // 那个 `\n` 分支使「终止符后紧跟任意换行」即通过，于是**提前终止**也被放行：
    // 实测（tmp/probe-a11-blindspot2.mjs）在模板串体内注释里写**成对**反引号时，
    // 扫描在第 2 行就被第一个反引号截断（closeLine=2），而 afterOk 因 `/m` + `\n`
    // 分支仍然匹配 ⇒ **漏报**（真实事故：第二十轮我在 mobile 注释里写
    // 「.dsht-rp-card-gear 的 opacity: 1 !important」带反引号，闸门放行，
    // 直到 esbuild 报 `Expected ";" but found "{"` 才暴露）。
    // ⇒ 该模板串终止后**只有换行到文件尾**（实测确认），故判据收紧为
    //    「余下必须是纯空白」（不带 /m，等于整个 tail 都空白）。
    afterOk: /^\s*$/,
    afterHint: '文件末尾空白（该模板串是文件最后一段）',
  },
  {
    name: 'dsht-plugin-mobile CSS 模板串',
    file: 'packages/src/dsht-plugin-mobile/client/style.ts',
    anchor: 'export const MOBILE_CSS = `',
    // 同上：实测终止后只有换行 ⇒ 收紧为「余下纯空白」
    afterOk: /^\s*$/,
    afterHint: '文件末尾空白（该模板串是文件最后一段）',
  },
  {
    // 【2026-09-14 第十五轮补】同一坑在**验证脚本**里又踩了一次（第六次复现）：
    // `ef-journey-all.mjs` 的巨型注入模板串（`await evalJs(\`(() => { … })()\`)`）体内有
    // 大量中文注释，我在一条注释里写了 `data-windowed`（带反引号）⇒ 模板串提前终止
    // ⇒ `node --check` 报 `SyntaxError: missing ) after argument list`（指向模板串起始行，
    // 与真因隔了 40 行）。**这正是本闸门 §「为什么需要」记录的第 5 次复现的同一形态**，
    // 说明「只查产品源码、不查验证脚本」是覆盖盲区（R4：另一个入口会不会复发）。
    name: 'M7 旅程注入模板串',
    file: 'scripts/ef-journey-all.mjs',
    // ★★ 【W40 修正 · P-41 推论二「锚点失效后转向别处」】
    // 原锚点 = `await evalJs(\`(() => {`（内联形态，原在第 329 行）。
    // W40 为「注入随页面重载自动重装」把注入体抽成了常量 `EFJ_SOURCE`
    // ⇒ **该锚点不复存在**，而本闸门随后匹配到了**第 1347 行**的另一个模板串
    //（报「终止于 1359」）—— **EFJ_SOURCE（286~462）从未被检查**
    //（我在它体内写了 6 处裸反引号，闸门一次没出声，直到 node 报语法错）。
    // 识别特征：报出的终止行号与我以为的那个模板串**对不上**（1359 vs 462）。
    // ⇒ 锚点改指**常量定义处**（常量被 evalJs / source: 两处复用 ⇒ 只登记一次）。
    anchor: 'const EFJ_SOURCE = `(() => {',
    afterOk: /^[ \t]*\r?\n/,
    afterHint: '终止反引号独占行尾（常量定义形态）',
  },
  {
    // 【2026-09-14 第二十轮补】本轮在**新建设备探针**里一次性踩了 **4 次**同一坑
    // （`ef-touch-targets.mjs` 的注入模板串内注释写了反引号 ⇒ `node --check` /
    //  esbuild 报语法错，且报错位置与真因隔了若干行）。这说明上一轮把 `ef-journey-all.mjs`
    // 加进 TARGETS 时**只补了那一个文件**，而「探针里的注入模板串」是**一整类**入口
    // （R4：修机制前先问「另一个入口会不会复发」—— 答案显然是「会」）。
    // ⇒ 本条起把**设备探针的注入模板串**纳入同一判据。新探针若含注入模板串，请一并登记。
    name: 'ef-touch-targets 注入模板串',
    file: 'scripts/ef-touch-targets.mjs',
    // 该文件的注入模板串：SNAP / trial / diagnose 三处；登记**锚点最长**的那条
    // （SNAP 是穷举主体，也是注释最密集、最易踩坑的地方）
    // 【W30 同步】SNAP 由同步 IIFE 改为**异步 IIFE**（`(async () => {`）——
    //   为了加**滚动扫描**（`await sleep(...)` 在几次 collectPass 之间）。
    //   ⇒ 锚点随之更新；这条断言正是为了防止「结构变了却静默放行」（A11 的设计意图）。
    anchor: 'const SNAP = `(async () => {',
    // 【第二十轮续三 · 本判据自身又一处盲区（第二次修 afterOk）】
    //   原为 /^\s*$/m —— 带 /m 的 `^` 会匹配**任意一行的开头**，于是
    //   「终止符后同一行还有任意非空内容、下一行是空白行」也能通过 ⇒ **零判据力**。
    //   实证（真实文件上的正控）：我在 SNAP 的注释里插入一行带**单个**裸反引号的
    //   `//   A11 正控实验用的裸反引号：\`label[for]\``，本闸门仍报
    //   「闭合正常（终止于第 134 行）」—— 终止行正是肇事行，却**放行**。
    //   ⇒ 收紧为「终止反引号必须是该行的**最后一个非空白字符**」：
    //     /^[ \t]*\r?\n/ （不带 /m ⇒ `^` 只匹配字符串开头 ⇒ 即「其后只允许行尾空白」）。
    //   这个口径能抓「同行后续有内容」的形态（= 绝大多数实际事故：
    //   注释里 `x` 成对反引号时，第一个反引号后面**必然**还有 `x\``）。
    //   代价：若将来把模板串写成行内形态（终止符后跟 `;`），会 fail-closed 报错并
    //   提示更新判据 —— 那比静默放行好（本项目的判据哲学：宁报错不静默）。
    afterOk: /^[ \t]*\r?\n/,
    afterHint: '终止反引号独占行尾（其后仅本行空白）',
  },
  {
    // 同上：上一轮新建的探针，同理存在未覆盖风险（它的 CDP 注入串含大量中文注释）
    name: 'ef-font-scale 注入模板串',
    file: 'scripts/ef-font-scale.mjs',
    anchor: 'const SNAP = `(() => {',
    // 同上（与 ef-touch-targets 同形态：终止后是换行 + 模块级 function）
    afterOk: /^[ \t]*\r?\n/,
    afterHint: '终止反引号独占行尾（其后仅本行空白）',
  },
  {
    // 【2026-09-15 第二十一轮 W5 勘察 · **本判据第三次扩容**（同一个"只补一个文件"的坑）】
    //
    // 我在新建 `ef-overflow-probe.mjs` 时**又踩了同一个坑**：决定论据基准的注释里写了
    // `/容器宽 > 可用宽/` 的**反引号版**（模板串内部），`node` 直接报
    // `SyntaxError: missing ) after argument list`，且报错行（`const r = await evalJson(`）
    // 距真因（注释里那个反引号）**隔了 20+ 行**。
    //
    // 根因与上一轮一模一样：**「探针里的注入模板串」是一整类入口**，而每次新建探针
    // 都只在"事后"才被 A11 想起来。⇒ 本次除补登记外，还加了**常驻自检**
    // （见 audit 尾部的「未登记探针扫描」）：`scripts/` 下任何含
    // `await evalJs(\`…\`)` / `await evalJson(\`…\`)` 注入模板串的探针都必须登记在此，
    // 否则闸门自身报红 —— 把"事后想起来"变成"不登记就跑不过"。
    name: 'ef-overflow-probe 注入模板串',
    file: 'scripts/ef-overflow-probe.mjs',
    anchor: '  const r = await evalJson(`(() => {',
    // 【口径差异 · 本条与前两条不同，登记时必须实测确认】
    // 本探针的模板串收尾形态是 `})()` —— 终止反引号**紧跟右括号**（模板串作为参数传入），
    // 而前两条（`const SNAP = \`…\`` 赋值形态）终止后只有换行。
    // 首版照抄 `/^[ \t]*\r?\n/` ⇒ 闸门把**正常闭合**报成「提前终止」（fail-closed 的预期代价：
    // 宁报错不静默 —— 见 TARGETS 第二项 afterOk 的注释）。
    // ⇒ 本条按实测形态写：终止反引号后**只允许** `)` 与本行空白。
    afterOk: /^[ \t]*\)[ \t]*\r?\n/,
    afterHint: '终止反引号后紧跟右括号（模板串作参数传入形态）',
  },
  {
    // 【2026-09-15 第二十一轮 · 常驻自检抓到的**存量漏网**】
    // 本闸门新增「未登记探针扫描」后立即报出这两个 `ef-*` 常驻探针从未登记过 ——
    // 它们长期在跑的，却不受本闸门保护（正是 R4「另一入口会不会复发」的存量形态）。
    // 两者收尾形态同 ef-overflow-probe：`})()`)`（模板串作参数传入）。
    name: 'ef-card-sampling 注入模板串',
    file: 'scripts/ef-card-sampling.mjs',
    anchor: '  const r = await evalJs(`(async () => {',
    afterOk: /^[ \t]*\)[ \t]*\r?\n/,
    afterHint: '终止反引号后紧跟右括号（模板串作参数传入形态）',
  },
  {
    name: 'ef-rollback-live 注入模板串',
    file: 'scripts/ef-rollback-live.mjs',
    anchor: 'const out = await evalJs(`(async () => {',
    afterOk: /^[ \t]*\)[ \t]*\r?\n/,
    afterHint: '终止反引号后紧跟右括号（模板串作参数传入形态）',
  },
]

/** 兼容旧参数（--file 指定单文件时按 shim 判据处理） */
const DEFAULT_TARGET = path.join(WS, TARGETS[0].file)

/** 从模板起始反引号扫到**真正的**终止反引号（JS 语义）。返回 { openIdx, closeIdx } 或 null */
export function scanTemplate (src, openIdx) {
  let i = openIdx + 1
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (c === '`') {
      if (depth === 0) return { openIdx, closeIdx: i }
      i += 1; continue
    }
    if (c === '$' && src[i + 1] === '{') { depth += 1; i += 2; continue }
    if (c === '}' && depth > 0) { depth -= 1; i += 1; continue }
    i += 1
  }
  return null
}

function lineOf (src, idx) { return src.slice(0, idx).split('\n').length }

/**
 * 检查一份源码。返回 { ok, reason?, atLine?, detail? }
 * 判据：终止符之后（跳过空白）必须紧接预期形态（默认函数结尾 `}`）。
 * @param src    源码
 * @param anchor 模板起始锚点（含起始反引号）；缺省用 shim 的
 * @param afterOk 终止符之后应当匹配的正则；缺省 `/^\s*\}/`
 * @param afterHint 人类可读的预期描述（用于报错时讲清「本该接什么」）
 */
export function auditSource (src, anchor = TARGETS[0].anchor, afterOk = TARGETS[0].afterOk, afterHint = TARGETS[0].afterHint) {
  const a = src.indexOf(anchor)
  if (a < 0) {
    return { ok: false, reason: 'anchor-missing', detail: `找不到模板锚点 ${JSON.stringify(anchor)}（结构变了 ⇒ 本闸门失效，需同步更新，不许静默放行）` }
  }
  const openIdx = a + anchor.indexOf('`')
  const r = scanTemplate(src, openIdx)
  if (r === null) {
    return { ok: false, reason: 'unterminated', detail: '模板串未闭合（从锚点到文件尾都没找到终止反引号）' }
  }
  const after = src.slice(r.closeIdx + 1)
  if (!afterOk.test(after)) {
    const nxt = after.slice(0, 60).replace(/\n/g, '\\n')
    return {
      ok: false,
      reason: 'early-terminate',
      atLine: lineOf(src, r.closeIdx),
      detail: `模板串在**此处提前终止**（其后紧接的不是${afterHint}）：${JSON.stringify(nxt)}\n`
        + `      ⇒ 该反引号是**未转义的裸反引号**（L70）。模板串体内的注释/字符串里一律用单引号。`,
    }
  }
  return { ok: true, closeLine: lineOf(src, r.closeIdx) }
}

// ---------------------------------------------------------------------------
function selftest () {
  let fail = 0
  let total = 0
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'a11-'))
  const cases = [
    {
      name: '正控：模板体内有裸反引号 ⇒ 必须报错且位置正确',
      src: [
        'export function buildShimSource(opts) {',
        '  return `(function () {',
        '// 注释里写了 `反引号` 就完了',
        'var x = 1;',
        '}`',
        '}',
      ].join('\n'),
      expectOk: false,
      expectLine: 3,
    },
    {
      name: '负控：转义反引号 + 合法 ${} 插值 ⇒ 必须通过',
      src: [
        'export function buildShimSource(opts) {',
        '  return `(function () {',
        'var s = \\`escaped\\` + "x";',
        'function v() { return ${JSON.stringify(opts.version)}; }',
        '}`',
        '}',
      ].join('\n'),
      expectOk: true,
    },
    {
      name: '正控2：${} 内的嵌套模板（合法）不应误判；但体内裸反引号仍要报',
      src: [
        'export function buildShimSource(opts) {',
        '  return `(function () {',
        "var a = ${ '`nested`' };",
        'var b = `oops`;',
        '}`',
        '}',
      ].join('\n'),
      expectOk: false,
    },
    {
      name: '正控3：锚点缺失 ⇒ 必须 fail-closed（不许静默放行）',
      src: 'export function other() { return 1 }',
      expectOk: false,
    },
    {
      // 【第二十轮新增 · 判据自身盲区的回归护栏】
      // 真实事故：我在 CSS 模板串的注释里写了**成对**反引号（`.x { ... }`），
      // 扫描在第 2 行就被第一个反引号截断，但旧的 afterOk（含 `\n` 分支 / `/m`）
      // 仍然匹配 ⇒ **闸门静默放行**，直到 esbuild 报 `Expected ";" but found "{"`。
      // 本用例把「成对反引号」钉成必须报错的形态（配 CSS 模板串的 afterOk 口径）。
      name: '正控4：体内**成对**反引号（含 { } 干扰）⇒ 必须报错（第二十轮盲区）',
      src: [
        'export const MOBILE_CSS = `',
        '/* 注释里写了一对反引号 `在这里` 以及 { 大括号 } */',
        '.x { color: red; }',
        '`',
        '',
        'export function f() {}',
      ].join('\n'),
      expectOk: false,
      // 使用与 CSS 模板串相同的 afterOk 口径（收紧为「余下纯空白」）
      anchor: 'export const MOBILE_CSS = `',
      afterOk: /^\s*$/,
      afterHint: '文件末尾空白',
    },
    {
      // 【第二十轮续三新增 · afterOk 自身盲区（第二次修）】
      // 真实事故的**第 2 形态**：注释里只有**一个**裸反引号（不是成对）。
      // 扫描在它那里停下，tail = 'label[for]`\n  // 后续注释…'。
      //   · 旧口径 /^\s*$/m  ⇒ `/m` 让 `^` 匹配下一行行首 ⇒ **放行**（零判据力）；
      //   · 新口径 /^[ \t]*\r?\n/ ⇒ 第一个字符就是 'l' ⇒ **报错**（正确）。
      // 本用例把这一形态钉死（正控），并用「同形但终止符独占行」做负控，
      // 确保新口径**不误伤**合法写法。
      name: '正控5：体内**单个**裸反引号且同行有后续内容 ⇒ 必须报错（A11 afterOk 盲区2）',
      src: [
        'const SNAP = `(() => {',
        '  // 注释里写了裸反引号：`label[for]`（成对，但同行后续有内容）',
        '  return 1',
        '})()`',
        '',
        'function f() {}',
      ].join('\n'),
      expectOk: false,
      anchor: 'const SNAP = `',
      afterOk: /^[ \t]*\r?\n/,
      afterHint: '终止反引号独占行尾',
    },
    {
      name: '负控2：终止反引号独占行尾（合法）⇒ 必须通过（新口径不误伤）',
      src: [
        'const SNAP = `(() => {',
        "  const CLICKABLE = ['label[for]', 'label:has(input)']",
        '  return 1',
        '})()`',
        '',
        'function f() {}',
      ].join('\n'),
      expectOk: true,
      anchor: 'const SNAP = `',
      afterOk: /^[ \t]*\r?\n/,
      afterHint: '终止反引号独占行尾',
    },
  ]
  for (const c of cases) {
    total += 1
    const p = path.join(tmp, 'case.ts')
    fs.writeFileSync(p, c.src)
    const r = c.anchor
      ? auditSource(fs.readFileSync(p, 'utf8'), c.anchor, c.afterOk, c.afterHint)
      : auditSource(fs.readFileSync(p, 'utf8'))
    let pass = r.ok === c.expectOk
    if (pass && c.expectLine !== undefined) pass = r.atLine === c.expectLine
    if (!pass) fail += 1
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.name}`)
    if (!pass) console.log(`        实际: ok=${r.ok} atLine=${r.atLine ?? '-'} ${r.detail ?? ''}`)
  }

  // -------------------------------------------------------------------------
  // 【W40 新增】注入载荷**形态 ②**（`const X = \`` 且 X 作注入载荷）的自证
  //   为什么必须补：W40 实测 —— 注入体被抽成常量后，本闸门**整体看不见它**
  //   （我在其注释里写了 6 处裸反引号，闸门一次没出声）⇒ 这正是 **P-41 推论四**
  //   （判据的输入/形态漏了 ⇒ 结论反向/沉默）。下面三例锁住新口径的区分力。
  // -------------------------------------------------------------------------
  {
    const t2 = (name, src, wantCount) => {
      total += 1
      const got = findInjectionTemplateStarts(src)
      const pass = got.length === wantCount
      if (!pass) fail += 1
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
      if (!pass) console.log(`        实际: ${JSON.stringify(got)}（期望 ${wantCount} 处）`)
    }
    // 正控 6：形态 ②（常量 + 作注入载荷）⇒ 必须被识别
    t2('正控6：注入载荷抽成常量（const X = … 且用于 evalJs/source:）⇒ 必须被识别',
      'const PROBE = `(() => { return 1 })()`\nawait evalJs(PROBE)\n', 1)
    t2('正控6b：`source: X` 形态（addScriptToEvaluateOnNewDocument）⇒ 必须被识别',
      'const PROBE = `(() => { return 1 })()`\nawait send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE })\n', 1)
    // 负控 3：普通模板串（**不**作注入载荷）⇒ 不得被识别（防过宽假红，P-38）
    t2('负控3：普通模板串（未作注入载荷）⇒ 不得被识别（防过宽）',
      'const SQL = `select 1`\nconsole.log(SQL)\n', 0)
    // 负控 4：形态 ①（内联）仍要能被识别（改动不得破坏既有覆盖面）
    t2('负控4（回归）：内联形态 `await evalJs(\\`` ⇒ 仍必须被识别',
      'const r = await evalJs(`(() => 1)()`)\n', 1)
  }

  // 零控：真实文件（逐个受检目标）
  for (const t of TARGETS) {
    total += 1
    const p = path.join(WS, t.file)
    if (!fs.existsSync(p)) { fail += 1; console.log(`  FAIL  零控：受检文件不存在 ${t.file}`); continue }
    const zero = auditSource(fs.readFileSync(p, 'utf8'), t.anchor, t.afterOk, t.afterHint)
    if (!zero.ok) fail += 1
    console.log(`  ${zero.ok ? 'PASS' : 'FAIL'}  零控：${t.name} 必须通过（终止行 ${zero.closeLine ?? '-'}）`)
    if (!zero.ok) console.log(`        实际: ${zero.detail}`)
  }
  // 计数**动态**输出（不再硬编码）：受检目标数会随防线扩容而变，
  // 硬编码会让「README/文档里写的 N/N」与实际不符 —— 那是 P-1（同一事实两处）。
  console.log(fail === 0 ? `\n[A11 selftest] ${total}/${total} PASS` : `\n[A11 selftest] ${fail} FAIL / ${total}`)
  // ★ W44：统一自证输出契约（**必须在本函数内** —— `--selftest` 分支会早退）
  reportSelftest('a11', total - fail, total)
  return fail === 0 ? 0 : 1
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest())

// 可选：--file <path> 指定目标（用于在**真实文件的副本**上做正控 —— L103：
// 新防线的最佳正控是在真实缺陷上跑，而不是只跑构造样本）。
const fi = args.indexOf('--file')
if (fi >= 0 && args[fi + 1]) {
  const target = path.resolve(args[fi + 1])
  if (!fs.existsSync(target)) {
    console.error(`[A11] 目标文件不存在：${target}`)
    process.exit(1)
  }
  const r = auditSource(fs.readFileSync(target, 'utf8'))
  if (r.ok) {
    console.log(`[A11] OK（--file 单文件模式）—— 模板串闭合正常（终止于第 ${r.closeLine} 行）`)
    process.exit(0)
  }
  console.error(`[A11] 违约：${r.reason}`)
  if (r.atLine !== undefined) console.error(`      肇事位置：${path.basename(target)}:${r.atLine}`)
  console.error(`      ${r.detail}`)
  process.exit(1)
}

// 默认：遍历全部受检目标（2026-09-14 从 1 个扩到 3 个，覆盖同类 CSS 模板串）
let bad = 0
for (const t of TARGETS) {
  const p = path.join(WS, t.file)
  if (!fs.existsSync(p)) {
    console.error(`[A11] 受检文件不存在：${t.file}（fail-closed：不许静默放行）`)
    bad += 1
    continue
  }
  const r = auditSource(fs.readFileSync(p, 'utf8'), t.anchor, t.afterOk, t.afterHint)
  if (r.ok) {
    console.log(`[A11] OK —— ${t.name} 闭合正常（终止于第 ${r.closeLine} 行），体内无未转义反引号`)
    continue
  }
  bad += 1
  console.error(`[A11] 违约：${t.name} / ${r.reason}`)
  if (r.atLine !== undefined) console.error(`      肇事位置：${t.file}:${r.atLine}`)
  console.error(`      ${r.detail}`)
}

// ---------------------------------------------------------------------------
// 【2026-09-15 第二十一轮 · 常驻自检：未登记的**常驻探针**注入模板串】
//
// ## 为什么需要它（同一个坑踩了三次）
// 本闸门守的是「脚本里的注入模板串体内有裸反引号」。而每次**新建常驻探针**时我都会在
// 它的模板串注释里写反引号 —— 三次都是**事后再想起**要把新文件加进 TARGETS：
//   ① `ef-journey-all.mjs`（首建）② `ef-touch-targets.mjs` / `ef-font-scale.mjs`
//   ③ `ef-overflow-probe.mjs`（本轮 W5）
// 即「探针模板串」是**一整类入口**（R4），而登记动作依赖**人的记性** = 必然复发。
//
// ## 扫描范围＝**常驻探针**（`ef-*.mjs`），不是全仓
// 【判据自身的边界（诚实声明）· 这条是实测调整的】
// 首版扫**全部** `scripts/*.mjs`，结果报出 **17 个未登记**，其中绝大多数是
// `dsht-*.mjs`（9-11 的一次性排障脚本，早已不用）与闸门自身。
// 那会让「补登记」变成一次性补 17 个的机械劳动 —— 违反本项目「不做无关改动」的纪律，
// 也把判据的约束力稀释成噪音。⇒ 收窄为 **`ef-*` 前缀的常驻方法论探针**：
//   · 它们是**长期复跑**的（M5/M7 每次都要跑）⇒ 模板串会被反复修改 ⇒ 值得守；
//   · 一次性排障脚本用完即弃 ⇒ 守它没有收益（它甚至不再运行）。
// 若将来某脚本升格为常驻（改名 `ef-*`），自检会自动把它纳入。
//
// ## 只认约定形态 —— ★ W40：**形态不止一种**（P-41 推论四：判据的输入未受保护）
// 注入形态 = `await <helper>(` 紧跟反引号。
//
// 【W40 实测踩到】本仓为「注入随页面重载自动重装」把注入体**抽成了常量**：
//   const EFJ_SOURCE = `(() => { window.__efj = { … } })()`      // ← 模板串在这里
//   await send('Page.addScriptToEvaluateOnNewDocument', { source: EFJ_SOURCE })
//   await evalJs(EFJ_SOURCE)
// ⇒ 上述「紧跟反引号」的形态**一个都不匹配** ⇒ 该模板串**整体逃出 A11 的守护面**
//   （我在本轮往它的注释里写了 **6 处裸反引号**，闸门一次都没出声，
//    直到 node 报 `SyntaxError: Unexpected identifier` 才被发现 —— 正是本判据注释里
//    警告过的那个失败模式，只是换了入口）。
// ⇒ 修法：把**被当作注入载荷使用的模板串常量**也纳入扫描（按「赋给 const 的模板串」+ 名字特征识别）。
//
// 若将来有人用别的 helper 名做注入，本扫描认不出来 —— 那时请把新名字加进 INJECT_CALLS。
// ★★ 注意：`INJECT_CALLS` 与 `findInjectionTemplateStarts` 已**上移到文件顶部**
//    （在 selftest 之前定义）—— 原先它们落在 selftest 之后的模块作用域里，
//    而 selftest 会调用该函数 ⇒ `ReferenceError: Cannot access 'INJECT_CALLS'
//    before initialization`（TDZ：函数声明会提升，`const` 不会）。
//    **判据自己的作用域也是判据的一部分**（P-19 家族）。
{
  const registered = new Set(TARGETS.map(t => t.file))
  const dir = path.join(WS, 'scripts')
  const unregistered = []
  for (const name of fs.readdirSync(dir)) {
    if (!RESIDENT_PROBE_RE.test(name)) continue
    const rel = `scripts/${name}`
    if (registered.has(rel)) continue
    const src = fs.readFileSync(path.join(dir, name), 'utf8')
    // ★ W40：形态 ①（内联 `await ev(\``）与形态 ②（`const X = \`` 且 X 作注入载荷）**都算**
    const hit = findInjectionTemplateStarts(src).length > 0
    if (hit) unregistered.push(rel)
  }
  if (unregistered.length > 0) {
    console.error(`\n[A11] 违约：以下**常驻探针**含注入模板串，但**未登记**在本判据的 TARGETS 中：`)
    for (const f of unregistered) console.error(`      · ${f}`)
    console.error(`      ⇒ 未登记 = 它的模板串**不受本闸门保护**（裸反引号会静默漏过，`)
    console.error(`        直到 node/esbuild 报一个离真因 20+ 行的语法错）。请补进 TARGETS。`)
    bad += unregistered.length
  } else {
    console.log(`[A11] OK —— 常驻探针登记完整（受检目标 ${registered.size} 个，无未登记的 ef-* 探针）`)
  }
}
process.exit(bad === 0 ? 0 : 1)
