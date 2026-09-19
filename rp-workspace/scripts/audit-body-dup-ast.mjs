#!/usr/bin/env node
/**
 * audit-body-dup-ast.mjs —— 「函数体逐字重复」的 **AST 版**补充扫描（W8 / 第二十三轮续）
 * ============================================================================
 * ## 为什么需要它（既有 D 闸门的两条口径都躲得过）
 * `scripts/audit-impl-duplication.mjs` 的**判据 4** 查「不同名但函数体逐字相同」，
 * 但它有两条口径，**两类真实复制同时躲过两条**：
 *
 * | 口径 | 说明 | 躲过它的形态 |
 * |---|---|---|
 * | ① 只收 `function name(...) { }` **声明形态** | 正则锚在 `function` 关键字 | `useEffect(() => {…})` 里的**箭头函数体** |
 * | ② 只判**跨包**重复 | `pkgs.size < 2` 即跳过 | 同一包内**跨文件**的复制 |
 *
 * 本轮（W8）实测证据：用 AST 扫 131 个文件后，在**盲区里**发现
 *   · `useEscapeClose` 的 ArrowFunction 体：`RpContextPanel` / `RpSearchPanel` /
 *     `RpStateView` / `RpTablesView` **4 份逐字相同**（其中两处注释还写着「与 RpSearchPanel 同款」）；
 *   · `foldRowA11yProps` 的形态：`MigrationStatusPanel` / `UpdatePanel` **2 份逐字相同**；
 *   · 另在**声明形态**里发现**同包跨文件** 2 组（`isMergeableObject` ≡ `isPlainObjectLike`、
 *     `replaceRange` ≡ `replaceRangeOf`）。
 * ⇒ 全部 5 组已按 P-1 收口（共享模块 + 同义别名），并配单测护栏。
 *
 * ## 判据
 * 提取**所有块体函数**（声明 / 箭头 / 函数表达式 —— 靠 AST 而非正则，
 * 避免「字符串里出现 `=>`」之类的假命中），按**归一化函数体**（去注释 + 折叠空白，
 * **不做**标识符重命名）分组，报出：
 *   · **跨包**：不同包的同指纹组合
 *   · **同包跨文件**：同包内**不同文件**的同指纹组合（既有闸门不查这一档）
 * 同一**文件内**的重复不报（可能是刻意的重载/局部复用节奏）。
 *
 * ## 谓词与既有闸门保持一致
 * `normalizeBody` 逐字复制自 `audit-impl-duplication.mjs`（同一**语义**必须有同一实现 ——
 * 若此处另写一套，就又是 P-1 违例）。过短函数体（归一化后 < 40 字符）过滤掉：
 * 如 `if (x) { return null }` 这类跨包必然撞车、无信息量。
 *
 * ## 用法
 *   node scripts/audit-body-dup-ast.mjs            # 扫描（0 = 无未裁决重复）
 *   node scripts/audit-body-dup-ast.mjs --selftest # 判据自证（P-30，5 项正负控）
 *
 * 退出码：0 无未裁决重复；1 有未裁决重复（须收口或加白名单并写明理由）；3 自证失败
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import process from 'node:process'
// ★ W72：自证分数契约的**唯一产出点**（P-1；**不自己拼分数行**）
import { reportSelftest } from './selftest-summary.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'packages', 'src')

/**
 * TypeScript 编译器（探针需要真 AST）。
 *
 * 【判据自身的坑】本仓库路径**含空格**（`D:\DSH RolePlay`）⇒ 一切用
 * `new URL(...).pathname` 取路径的写法都会拿到 `%20` 并 ENOENT（P-29 的已知形态）。
 * 故这里用 `fileURLToPath`，并**按候选路径探测** typescript 的位置。
 */
const require = createRequire(import.meta.url)

function loadTs() {
  const cands = [
    join(ROOT, 'packages', 'node_modules', 'typescript', 'lib', 'typescript.js'),
    join(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js'),
  ]
  for (const c of cands) {
    try { statSync(c); return require(c) } catch { /* 试下一个 */ }
  }
  return null
}

const ts = loadTs()
if (!ts) {
  console.error('[F5b] 找不到 typescript（本探针需要 AST）——运行 `cd rp-workspace/packages && npm i` 后再试')
  process.exit(3)
}

// ---------------------------------------------------------------------------
// 谓词（与 audit-impl-duplication.mjs 逐字一致 —— P-1）
// ---------------------------------------------------------------------------

/** 归一化函数体：去注释 + 折叠空白。**不**做标识符重命名——判据是「逐字复制」而非「近似」。 */
function normalizeBody(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 过短函数体无信息量（跨包必然撞车）→ 噪声过滤，与既有闸门同阈值 */
const MIN_BODY_LEN = 40

/**
 * 提取**所有块体函数**（AST 版，覆盖箭头 / 表达式）。
 *
 * 为什么只取**块体**（`{ … }`）：表达式体（`x => x + 1`）太短，逐字相同无意义。
 */
function extractBodies(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const K = ts.SyntaxKind
  const out = []
  const visit = (node) => {
    if (node.kind === K.FunctionDeclaration || node.kind === K.ArrowFunction || node.kind === K.FunctionExpression) {
      const b = node.body
      if (b && b.kind === K.Block) {
        const body = text.slice(b.getStart(sf) + 1, b.getEnd() - 1)
        out.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          body: normalizeBody(body),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 包名 = 相对 `packages/src` 路径的**第 1 段**。
 *
 * ⚠️ 【判据自身的坑 · 本轮实测踩到】首版写的是 `rel.split('/')[2]` —— 那是在
 * **绝对路径**（`packages/src/<pkg>/…`）语境下的段号。但 `scanIn` 传进来的 `rel`
 * 已经是相对 `packages/src` 的（如 `dsh-plugin/index.ts`）⇒ 取第 3 段恒得文件名，
 * 于是**所有文件被算成不同包**、或越界成 `undefined`，跨包/同包两组判据都会错。
 * 首版据此报出 2 组「同包跨文件」，实际那两组里有一组是**跨包**的。
 */
const pkgOf = (rel) => rel.split('/')[0] ?? '?'

/**
 * 核心扫描（真实仓库）。
 *
 * ⚠️ 实现**只此一份**（`scanIn`）—— 自证与主流程共用同一函数。
 * 首版曾写两份（主流程一份、自证一份），那本身就是 P-1 违例。
 */
function scan(files) {
  return scanIn(SRC, files)
}

// ---------------------------------------------------------------------------
// 判据自证（P-30：静态判据必须自带正负控）
// ---------------------------------------------------------------------------
function selftest() {
  console.log('[F5b] 判据自证（P-30）')
  let fail = 0
  let total = 0   // ★ W72：接入自证分数契约需要 total（P-50 的落地）
  const rec = (name, ok, detail = '') => { total++; if (!ok) fail++; console.log(`  ${ok ? 'PASS' : '**FAIL**'} ${name}${detail ? `　${detail}` : ''}`) }

  const body = `const x = a + 1\n  const y = x * 2\n  return y - 3`

  // 正控 1：跨包箭头函数逐字相同 ⇒ 必须报
  {
    const A = `const f = (a) => {\n  ${body}\n}`
    const B = `const g = (a) => {\n  ${body}\n}`
    rec('正控1·跨包箭头函数逐字相同必须被报出', crossPkgOf(A, 'pkgA', B, 'pkgB') === 1)
  }
  // 正控 2：同包跨文件箭头函数逐字相同 ⇒ 必须报（这是既有闸门**不查**的那一档）
  {
    const A = `const f = (a) => {\n  ${body}\n}`
    const B = `const g = (a) => {\n  ${body}\n}`
    rec('正控2·同包跨文件逐字相同必须被报出', samePkgOf(A, 'pkgA', B, 'pkgA') === 1)
  }
  // 负控 1：跨包但仅局部改名 ⇒ 不报（诚实边界：近似复制不在判据范围）
  {
    const A = `const f = (a) => {\n  const x = a + 1\n  const y = x * 2\n  return y - 3\n}`
    const B = `const g = (a) => {\n  const p = a + 1\n  const q = p * 2\n  return q - 3\n}`
    rec('负控1·跨包但仅局部改名**不**报（近似复制是已知边界）', crossPkgOf(A, 'pkgA', B, 'pkgB') === 0)
  }
  // 负控 2：同一文件内重复 ⇒ 不报（可能是刻意的局部节奏）
  {
    const A = `const f = (a) => {\n  ${body}\n}\nconst g = (a) => {\n  ${body}\n}`
    const tree = makeTree([{ pkg: 'pkgA', name: 'same-file.ts', code: A }])
    const r = scanTree(tree)
    rmSync(tree.root, { recursive: true, force: true })
    rec('负控2·同一文件内重复**不**报', r.crossPkg.length === 0 && r.samePkgCrossFile.length === 0)
  }
  // 负控 3：过短函数体 ⇒ 不报（噪声过滤）
  {
    const A = `const f = () => { return 1 }`
    const B = `const g = () => { return 1 }`
    rec('负控3·过短函数体**不**报', crossPkgOf(A, 'pkgA', B, 'pkgB') === 0)
  }
  console.log(`[F5b] 自证 ${(fail === 0 ? total : total - fail)}/${total}`)
  return { fail, total }
}
/**
 * 造一个临时「src 基目录」，在里面按 `<pkg>/<name>` 落文件。
 * 返回 { root, files } —— **必须共用同一 root**，否则 `relative(root, f)` 无法相对化，
 * 包名解析会失败（本轮踩到两次：两个独立临时根 ⇒ 跨包正控假 FAIL）。
 *
 * 注意 root 是**直接父目录**（对齐 `pkgOf` 的「第 1 段 = 包名」口径）。
 */
function makeTree(specs) {
  const base = mkdtempSync(join(tmpdir(), 'dsht-f5b-'))
  const files = []
  for (const { pkg, name, code } of specs) {
    const dir = join(base, pkg)
    mkdirSync(dir, { recursive: true })
    const p = join(dir, name)
    writeFileSync(p, code)
    files.push(p)
  }
  return { root: base, files }
}

/** 用给定的临时树跑一次扫描（自证专用：SRC 基准换成该临时根） */
function scanTree(tree) {
  return scanIn(tree.root, tree.files)
}

/** 核心扫描（`srcBase` = 包名解析基准） */
function scanIn(srcBase, files) {
  const byBody = new Map()
  for (const f of files) {
    const rel = relative(srcBase, f).split(sep).join('/')
    const text = readFileSync(f, 'utf8')
    for (const { line, body } of extractBodies(text, f)) {
      if (body.length < MIN_BODY_LEN) continue
      const arr = byBody.get(body) ?? []
      arr.push({ pkg: pkgOf(rel), rel, line })
      byBody.set(body, arr)
    }
  }
  const crossPkg = []
  const samePkgCrossFile = []
  for (const [body, places] of byBody) {
    const pkgs = new Set(places.map(p => p.pkg))
    const fset = new Set(places.map(p => p.rel))
    if (pkgs.size > 1) crossPkg.push({ body, places })
    else if (fset.size > 1) samePkgCrossFile.push({ body, places })
  }
  return { crossPkg, samePkgCrossFile, bodyCount: byBody.size }
}

function crossPkgOf(A, pkgA, B, pkgB) {
  const tree = makeTree([{ pkg: pkgA, name: 'a.ts', code: A }, { pkg: pkgB, name: 'b.ts', code: B }])
  const r = scanTree(tree)
  rmSync(tree.root, { recursive: true, force: true })
  return r.crossPkg.length
}

function samePkgOf(A, pkgA, B) {
  const tree = makeTree([{ pkg: pkgA, name: 'a.ts', code: A }, { pkg: pkgA, name: 'b.ts', code: B }])
  const r = scanTree(tree)
  rmSync(tree.root, { recursive: true, force: true })
  return r.samePkgCrossFile.length
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  // ★★ **W72：接入单源自证分数契约**（**P-50**）——
  //   此前收尾只打自造行 `[F5b] 自证 6/6` ⇒ **机器读不出分数** ⇒
  //   文档里「selftest **6/6**」这句声明**无法被证伪**（**P-11 元级**）。
  //   ⇒ 按 **P-1** 复用唯一产出点 `reportSelftest`。
  const { fail, total } = selftest()
  reportSelftest('body-dup-ast', total - fail, total)
  process.exit(fail === 0 ? 0 : 3)
}

const files = walkFiles(SRC)
if (files.length === 0) {
  console.error(`[F5b] 扫描面为空（${SRC}）—— fail-closed 退出（锚点漂移？）`)
  process.exit(3)
}

const { crossPkg, samePkgCrossFile, bodyCount } = scan(files)
console.log(`[F5b] 扫 ${files.length} 个源文件；块体函数指纹 ${bodyCount} 个`)
console.log(`      跨包逐字重复 ${crossPkg.length} 组；同包跨文件逐字重复 ${samePkgCrossFile.length} 组`)

const show = (label, groups) => {
  if (groups.length === 0) return
  console.log(`\n[F5b] ⚠ ${label}：`)
  for (const g of groups) {
    console.log(`  ⚠ ${g.places.map(p => `${p.rel}:${p.line}`).join(' | ')}`)
    console.log(`      ${g.body.slice(0, 130)}`)
  }
}

show('跨包「函数体逐字相同」（判据 4 口径；此处含箭头/表达式形态）', crossPkg)
show('同包跨文件「函数体逐字相同」（**既有闸门不查这一档**）', samePkgCrossFile)

const total = crossPkg.length + samePkgCrossFile.length
if (total > 0) {
  console.log('\n处置：收敛成单源（共享模块 + 同义别名）优先；确属「语义面不同」才加白名单（须附 why）。')
  process.exit(1)
}
console.log('[F5b] PASS —— 无未裁决的「函数体逐字重复」（含箭头/表达式形态 + 同包跨文件）')
