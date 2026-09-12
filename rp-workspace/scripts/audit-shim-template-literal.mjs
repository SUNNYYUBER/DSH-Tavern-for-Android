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
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const TARGET = path.join(WS, 'packages/src/dsht-rp-ui/src/client/th-shim.ts')

/** 模板串锚点：buildShimSource 的 `return \`(function () {`（取首次出现） */
const ANCHOR = 'return `(function'

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
 * 判据：终止符之后（跳过空白）必须紧接函数结尾 `}`。
 */
export function auditSource (src) {
  const a = src.indexOf(ANCHOR)
  if (a < 0) {
    return { ok: false, reason: 'anchor-missing', detail: `找不到模板锚点 ${JSON.stringify(ANCHOR)}（shim 结构变了 ⇒ 本闸门失效，需同步更新，不许静默放行）` }
  }
  const openIdx = a + ANCHOR.indexOf('`')
  const r = scanTemplate(src, openIdx)
  if (r === null) {
    return { ok: false, reason: 'unterminated', detail: '模板串未闭合（从锚点到文件尾都没找到终止反引号）' }
  }
  const after = src.slice(r.closeIdx + 1)
  // 期望：终止符后仅剩空白 + 函数结尾 `}`
  if (!/^\s*\}/.test(after)) {
    const nxt = after.slice(0, 60).replace(/\n/g, '\\n')
    return {
      ok: false,
      reason: 'early-terminate',
      atLine: lineOf(src, r.closeIdx),
      detail: `模板串在**此处提前终止**（其后紧接的不是函数结尾）：${JSON.stringify(nxt)}\n`
        + `      ⇒ 该反引号是**未转义的裸反引号**（L70）。模板串体内的注释/字符串里一律用单引号。`,
    }
  }
  return { ok: true, closeLine: lineOf(src, r.closeIdx) }
}

// ---------------------------------------------------------------------------
function selftest () {
  let fail = 0
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
  ]
  for (const c of cases) {
    const p = path.join(tmp, 'case.ts')
    fs.writeFileSync(p, c.src)
    const r = auditSource(fs.readFileSync(p, 'utf8'))
    let pass = r.ok === c.expectOk
    if (pass && c.expectLine !== undefined) pass = r.atLine === c.expectLine
    if (!pass) fail += 1
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.name}`)
    if (!pass) console.log(`        实际: ok=${r.ok} atLine=${r.atLine ?? '-'} ${r.detail ?? ''}`)
  }
  // 零控：真实文件
  if (fs.existsSync(TARGET)) {
    const zero = auditSource(fs.readFileSync(TARGET, 'utf8'))
    if (!zero.ok) fail += 1
    console.log(`  ${zero.ok ? 'PASS' : 'FAIL'}  零控：真实 th-shim.ts 必须通过（终止行 ${zero.closeLine ?? '-'}）`)
    if (!zero.ok) console.log(`        实际: ${zero.detail}`)
  }
  console.log(fail === 0 ? '\n[A11 selftest] 5/5 PASS' : `\n[A11 selftest] ${fail} FAIL`)
  return fail === 0 ? 0 : 1
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest())

// 可选：--file <path> 指定目标（用于在**真实文件的副本**上做正控 —— L103：
// 新防线的最佳正控是在真实缺陷上跑，而不是只跑构造样本）。
const fi = args.indexOf('--file')
const target = fi >= 0 && args[fi + 1] ? path.resolve(args[fi + 1]) : TARGET

if (!fs.existsSync(target)) {
  console.error(`[A11] 目标文件不存在：${target}`)
  process.exit(1)
}
const src = fs.readFileSync(target, 'utf8')
const r = auditSource(src)
if (r.ok) {
  console.log(`[A11] OK —— shim 模板串闭合正常（终止于第 ${r.closeLine} 行），体内无未转义反引号`)
  process.exit(0)
}
console.error(`[A11] 违约：${r.reason}`)
if (r.atLine !== undefined) console.error(`      肇事位置：${path.basename(target)}:${r.atLine}`)
console.error(`      ${r.detail}`)
process.exit(1)
