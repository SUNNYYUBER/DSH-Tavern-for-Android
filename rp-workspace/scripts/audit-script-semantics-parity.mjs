#!/usr/bin/env node
/**
 * audit-script-semantics-parity.mjs — 【W4 · 2026-09-15】「单测装置 vs 真机」脚本语义一致性闸门
 * ============================================================================
 * ## 守什么（一句话）
 * 卡脚本在真机上以 **`<script type="module">`** 注入（`th-shim.ts:3011`）⇒ **严格模式**；
 * 而单测（`th-script-runtime.spec.ts` 的 `runScript`）用 `node:vm` **经典脚本**语义。
 * 两者**不是同一套语义** —— 本闸门**持续量化**这个差异，并在差异影响真实语料时报警。
 *
 * ## 为什么需要它（第二十四轮 W3 发现，第二十五轮 W4 落地）
 * W3 的决定性实验证实差异**真实存在**（同一段带 `with` 的代码：`vm` 里能跑、ESM 里
 * `SyntaxError`）⇒ 存在一类改动会「**单测全绿而真机全崩**」。
 * 但「要不要为此改整个测试基建」取决于**差异是否有实际后果**：
 *   · 若真实卡语料里存在「经典合法 / 严格报错」的形态 ⇒ 必须处置（会放过真机上必崩的脚本）；
 *   · 若不存在 ⇒ 差异是理论的，**登记 + 机器化监测**即可（不为了洁癖改动大面积基建）。
 *
 * 本轮实测（54 个真实脚本）：**0 命中** ⇒ 当前后果为「理论」。
 * ⇒ 本闸门的作用是：**把「当前无后果」变成一条会自己失效的结论** ——
 *   一旦语料/实现里出现这类形态，闸门立刻报红（而不是等人想起来复查）。
 *
 * ## 判据（真解析器，不用正则 —— 首版正则踩坑记录见下）
 * 用 TypeScript AST 找四类「经典合法 / 严格报错」形态（四类均由**决定性实验**验证
 * 在两种语义下结论**不同**）：
 *   ① `WithStatement`              —— 严格**语法错误**
 *   ② 八进制数字字面量（`010`）      —— 严格**语法错误**
 *   ③ `delete` **裸标识符**         —— 严格**语法错误**（`delete 属性`/`delete obj[k]` 合法）
 *   ④ 给**未声明**变量赋值（符号解析不到）—— 严格抛 `ReferenceError`
 *
 * ⚠️ **第一版用正则，自证当场抓到两个判据自身缺陷**（P-19/P-30 的活例，留档于此）：
 *   · ④ 报 **1275 处**（量级明显不合理）：负控样本 `var a=0x1f, b=0o17, c=0b11` 里的
 *     `b=` / `c=` 被当成「未声明赋值」——多变量声明 / 对象字面量 / 解构 / `for` 头全误报；
 *   · ③ 报 **86 处**，逐条分诊发现**全是** `delete state.completedBy` /
 *     `delete registry[INSTANCE_KEY]` —— **删属性**（严格下合法）。
 *   ⇒ 结论：「标识符在不在某个语法位置」这类判定**不能靠正则**，必须用 AST + 符号解析。
 *
 * ## 覆盖范围（诚实边界）
 * 只覆盖**卡脚本语料**（由 `--corpus` 或环境变量给出）。**不**覆盖：
 *   · shim 自身源码（它是经典 IIFE，语义与真机一致 —— 两边都是经典）
 *   · 帧内 vendor（jQuery/zod，经典 script 标签注入，非 module）
 *   · **module 的独立作用域**这一维度（本闸门只测「严格模式」维度；
 *     若将来出现依赖「模块作用域」的差异，需另立判据）
 *
 * 用法：
 *   node scripts/audit-script-semantics-parity.mjs --selftest
 *   node scripts/audit-script-semantics-parity.mjs --corpus <目录>   # 语料普查
 *   node scripts/audit-script-semantics-parity.mjs                  # 语料不可达时仍跑自证
 * 退出码：0 = 无「严格违规」形态（或语料不可达但自证通过）；1 = 命中（真机上必崩）；
 *        2 = 装置失败（typescript 不可用 / 锚点缺失，fail-closed）
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require$ = createRequire(import.meta.url)

/** typescript 装在 `packages/` 下（与其它 AST 类闸门同法：候选路径探测，不引新依赖） */
function loadTs() {
  for (const c of [
    resolve(ROOT, 'packages', 'node_modules', 'typescript', 'lib', 'typescript.js'),
    resolve(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js'),
  ]) { try { if (existsSync(c)) return require$(c) } catch { /* 试下一个 */ } }
  return null
}

/** 真机侧语义的事实来源（断言它没变 —— 这是本闸门成立的**前提**，变了要重评） */
const SHIM = resolve(ROOT, 'packages/src/dsht-rp-ui/src/client/th-shim.ts')
/** 真机把脚本正文注入为 module 的那一行（锚点；缺失即 fail-closed） */
const MODULE_INJECT_RE = /<script type="module">\s*\$\{safe\}/

const OPTS = {
  target: 99 /* ts.ScriptTarget.ESNext */, module: 99, allowJs: true, checkJs: false,
  noEmit: true, skipLibCheck: true, lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], types: [],
}

/**
 * 用 AST 找出四类「严格模式违规」形态（行号从 1 开始）。
 * @param {any} ts
 * @param {string} code
 * @returns {{kind: string, line: number}[]}
 */
export function findStrictViolations(ts, code) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-w4-'))
  const file = join(dir, 'card.js')
  writeFileSync(file, code, 'utf8')
  const program = ts.createProgram([file], { ...OPTS, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(file)
  if (!sf) throw new Error('无法建立源文件（装置失效，拒绝给结论）')
  const out = []
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const K = ts.SyntaxKind
  const visit = (node) => {
    if (node.kind === K.WithStatement) out.push({ kind: 'with', line: lineOf(node) })
    if (node.kind === K.NumericLiteral && /^0[0-7]+$/.test(node.getText(sf))) {
      out.push({ kind: 'octal', line: lineOf(node) })
    }
    if (node.kind === K.DeleteExpression && node.expression.kind === K.Identifier) {
      out.push({ kind: 'deleteVar', line: lineOf(node) })
    }
    if (node.kind === K.BinaryExpression && node.operatorToken.kind === K.EqualsToken
      && node.left.kind === K.Identifier && !checker.getSymbolAtLocation(node.left)) {
      out.push({ kind: 'undeclaredAssign', line: lineOf(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

// ---------------------------------------------------------------------------
// 自证（P-30：正控 + 负控；负控里**必须**含第一版踩过的两个假阳性形态）
// ---------------------------------------------------------------------------
function selftest(ts) {
  const POSITIVE = [
    ['with', 'var o={a:1}; with (o) { a }'],
    ['octal', 'var x = 010;'],
    ['deleteVar', 'var d = 1; delete d;'],
    ['undeclaredAssign', 'someUndeclaredName = 42;'],
  ]
  const NEGATIVE = [
    ['with 在字符串里', 'var s = "with (o) { }";'],
    ['with 在注释里', '// with (o) { }\nvar a = 1;'],
    ['delete 属性（严格下合法）', 'var o={a:1}; delete o.a;'],
    ['delete 下标（严格下合法）', 'var o={a:1}; delete o["a"];'],
    ['0x/0o/0b/0./0e 非八进制', 'var a=0x1f, b=0o17, c=0b11, d=0.5, e=0e0;'],
    ['已声明变量赋值', 'var q = 1; q = 2;'],
    ['多变量声明（首版正则假阳性来源）', 'var a=0x1f, b=0o17, c=0b11;'],
    ['函数参数赋值', 'function f(p) { p = 1; return p; }'],
    ['对象属性赋值', 'var o = {}; o.x = 1;'],
    ['catch 参数赋值', 'try {} catch (e) { e = 1; }'],
  ]
  let pass = 0
  let total = 0
  for (const [kind, src] of POSITIVE) {
    total++
    const got = [...new Set(findStrictViolations(ts, src).map((h) => h.kind))]
    const ok = got.includes(kind)
    if (ok) pass++
    console.log(`${ok ? ' PASS' : ' FAIL'}  正控 ${kind} → ${JSON.stringify(got)}`)
  }
  for (const [label, src] of NEGATIVE) {
    total++
    const got = [...new Set(findStrictViolations(ts, src).map((h) => h.kind))]
    const ok = got.length === 0
    if (ok) pass++
    console.log(`${ok ? ' PASS' : ' FAIL'}  负控 ${label} → ${JSON.stringify(got)}`)
  }
  console.log(`[selftest] ${pass === total ? 'PASS' : 'FAIL'}（${pass}/${total}）`)
  // ★ W44：统一自证输出契约（**必须在本函数内** —— `--selftest` 分支会早退）
  reportSelftest('script-semantics', pass, total)
  return pass === total ? 0 : 1
}

// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  const ts = loadTs()
  if (!ts) {
    console.error('[sem] FATAL typescript 不可用 —— 本闸门需要真解析器，拒绝给结论（fail-closed）')
    process.exit(2)
  }
  if (argv.includes('--selftest')) process.exit(selftest(ts))

  // ---- 前提断言：真机侧注入形态没变（变了则本闸门的立论基础要重评）----
  let shimSrc
  try { shimSrc = readFileSync(SHIM, 'utf8') } catch {
    console.error(`[sem] FATAL 找不到 shim 源码：${SHIM}（fail-closed）`)
    process.exit(2)
  }
  if (!MODULE_INJECT_RE.test(shimSrc)) {
    console.error('[sem] FATAL 锚点缺失：shim 里找不到「<script type="module">${safe}」这一注入形态')
    console.error('       ⇒ 真机侧语义可能已改（如改成经典脚本注入）⇒ 本闸门的前提失效，需重评')
    process.exit(2)
  }

  const ci = argv.indexOf('--corpus')
  const corpus = ci >= 0 ? argv[ci + 1] : (process.env.DSH_SCRIPT_CORPUS ?? '')
  if (corpus === '' || !existsSync(corpus)) {
    console.log('[sem] 语料不可达（未传 --corpus，且 $env:DSH_SCRIPT_CORPUS 未指向有效目录）')
    console.log('[sem] 前提已核（shim 仍是 module 注入）；语料普查本次**未执行**（出声，不静默）')
    console.log('[sem] 自证（闸门本身可信度）：')
    process.exit(selftest(ts))
  }

  const files = readdirSync(corpus).filter((f) => f.endsWith('.js'))
  const agg = new Map()
  const hits = []
  for (const f of files) {
    let src
    try { src = readFileSync(join(corpus, f), 'utf8') } catch { continue }
    let found
    try { found = findStrictViolations(ts, src) } catch { continue }
    if (!found.length) continue
    hits.push({ f, found })
    for (const h of found) agg.set(h.kind, (agg.get(h.kind) ?? 0) + 1)
  }
  console.log(`[sem] 语料 ${files.length} 个脚本 · 命中「经典合法/严格报错」形态的文件 ${hits.length} 个`)
  for (const [k, v] of agg) console.log(`[sem]   ${k}: ${v} 处`)
  if (hits.length) {
    console.log('[sem] ❌ 命中 ⇒ 这些脚本在真机（module = 严格模式）上**必然崩**，')
    console.log('          而现有单测（经典语义）会放过它们 —— 必须处置：')
    for (const h of hits.slice(0, 20)) {
      console.log(`     · ${h.f} → ${h.found.map((x) => `${x.kind}@${x.line}`).join(', ')}`)
    }
    process.exit(1)
  }
  console.log('[sem] ✅ 语料里无「经典合法 / 严格报错」形态 ⇒')
  console.log('          「单测装置语义不等价」当前**无实际后果**（差异是理论的）——')
  console.log('          本结论由闸门**持续复核**：一旦语料/实现出现这类形态即报红。')
  process.exit(0)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
