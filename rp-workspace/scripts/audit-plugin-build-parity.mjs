#!/usr/bin/env node
/**
 * audit-plugin-build-parity.mjs — 审计「两条插件构建路径的 R10 插件集是否等价」
 * ============================================================================
 * 【为什么需要它（W-3 真机事故，2026-09-21）】
 *   `dsht-plugin-device` 引入后，build-dsht.ps1 的 `$r10Plugins` 加上了它（并真的跑
 *   esbuild 产出 `lib/index.js`），但 rebuild-plugins.ps1 的**构建循环漏加**——只在
 *   下游的 `$r10Ids` 里登记了 id。于是该路径会为该包写出一份 `package.json`
 *   （`"main": "lib/index.js"`）**却不生成 `lib/index.js`** ⇒ 真机 Cordis 加载
 *   `dsht-plugin-device` 失败 ⇒ `Cordis startup failed because these plugin(s)
 *   could not be resolved` ⇒ **整棵插件树起不来，DSH boot loop**（模拟器实录：
 *   `node exited with code 1; restart in 3s`，连续第 45 次）。
 *
 *   与 `audit-build-path-parity.py`（marker / stub 口径）**为什么互补**：
 *   那条判据比的是「DSHT-* 补丁 marker 集合」与「stub 落盘二元组」，本事故二者皆无
 *   ——差异在**插件源码 → 构建产物**这一层（同一个包集，一侧少编译一个），
 *   结构上超出它的判据面。
 *
 * 【判据】
 *   1. 两条路径的构建循环列表（ps1: `$r10Plugins`；rebuild: 第 2 步的 foreach 数组）
 *      必须是**同一集合**。
 *   2. 每个进入构建循环的包，必须在**源码树里真的有** `src/<pkg>/index.ts`。
 *      （漏掉这条会退化成「列表对齐了但指向不存在的源」——同样炸真机。）
 *   3. 每个进入构建循环的包，必须在两侧的 id 表里都有登记（`$r10Ids`）——
 *      没有 id 就写不出 cordis.patch.yml ⇒ 包在包内但**永远不会被 mount**，
 *      即「装了等于没装」的静默失败。
 *   4. 构建循环**必须真的产出** `lib/index.js`（两侧都要有 --outfile 指向 lib/index.js）。
 *      ★ 这一条是本次事故的**直接**判据：只写 package.json 的路径会在这里被抓住。
 *
 * 【为什么不能只判据 1】列表对齐 ≠ 产物对齐：两侧可能都忘了写 outfile，或 outfile
 *   指向别处（如 `lib/index.cjs` 而 main 声明 `lib/index.js`）。判据 4 把
 *   「声明的 main」与「构建实际写出的文件」钉在一起。
 *
 * 用法：node scripts/audit-plugin-build-parity.mjs
 *       node scripts/audit-plugin-build-parity.mjs --selftest   # 判据自身正/负控
 * 退出码：0 = 等价；1 = 漂移；2 = 文件缺失；3 = selftest 失败
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = resolve(HERE, '..')
const PS1 = join(HERE, 'build-dsht.ps1')
const REBUILD = join(HERE, 'rebuild-plugins.ps1')
const SRC = join(WS, 'packages', 'src')

// ---------------------------------------------------------------------------
// 解析：把两侧「构建循环里要编译的包」抽成集合
// ---------------------------------------------------------------------------

/** 从 `@('a','b','c')` 形态的 PowerShell 数组字面量里抽字符串项（保持出现顺序）。 */
function psArrayItems(text) {
  return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** 取 `$name = @(...)` 的数组项（括号配平，允许跨行与嵌套）。 */
function psAssignedArray(text, varName) {
  const re = new RegExp(`\\$${varName}\\s*=\\s*@\\(`)
  const m = re.exec(text)
  if (!m) throw new Error(`未找到 \$${varName} 的数组定义`)
  const start = m.index + m[0].length
  let depth = 1
  let i = start
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
  }
  if (depth !== 0) throw new Error(`\$${varName} 的数组括号未配平`)
  return psArrayItems(text.slice(start, i - 1))
}

/**
 * 取 ps1「构建循环」真正遍历的包名集合。
 *
 * 【为什么必须解析 foreach 语句本身，而不是复用同名变量】
 * 本次事故的形态就是「循环数组与 id 表分开写、只改了后者」。若只解析
 * `$r10Plugins = @(...)` 变量定义，就漏掉另一类同样致命的漂移：
 * 变量定义是对的、但 foreach 里手写了一份**过期的内联数组**。
 * 故优先级为：foreach 的 `in` 后若是内联数组 → 直接用；若是变量 → 回溯该变量定义。
 *
 * 【为什么必须锚定「遍历变量名」】build-dsht.ps1 里有多个 foreach
 * （`foreach ($r in $reading)` / `foreach ($a in $auditNode)` / …）。若只写
 * `foreach\s*\(\s*\$\w+\s+in\s+(.+?)\)` ，非贪婪的 `.+?` 会**跨过 `{`** 去凑一个
 * `)`，从而把别处的 foreach 当成构建循环解析（实测：误取到 `$reading`）。
 * ⇒ 故把「遍历变量名」作为已知锚点传入（两侧同为 `$r10`）。
 */
function parseBuildLoop(text, fileLabel, loopVar = 'r10') {
  const re = new RegExp(`foreach\\s*\\(\\s*\\$${loopVar}\\s+in\\s+([^\\n]+?)\\s*\\)\\s*\\{`)
  const m = text.match(re)
  if (!m) throw new Error(`${fileLabel}: 未找到构建循环 foreach ($${loopVar} in ...) {`)
  const rhs = m[1].trim()
  if (rhs.startsWith('@(')) {
    // 内联数组：foreach ($x in @('a','b')) {
    const inner = rhs.slice(2).replace(/\)$/, '')
    return psArrayItems(inner)
  }
  // 变量：回溯其数组定义
  const varName = rhs.replace(/^\$/, '')
  return psAssignedArray(text, varName)
}

/**
 * 取 ps1 的 `$r10Ids` 哈希表的**键**（= 包名；值是 cordis patch 行的 id）。
 *
 * 【为什么必须只取键】哈希表形如 `@{ 'dsht-plugin-memory' = 'dsht-memory' }`——
 * 键是包名、值是 id。若用「抽所有引号字符串」的口径，值（`dsht-memory`）会被
 * 误当成包名 ⇒ 每条都报「登记了但不在构建循环」（实测 10 处假红）。
 */
function parseR10Ids(text, fileLabel) {
  const m = text.match(/\$r10Ids\s*=\s*@\{([\s\S]*?)\n\}/)
  if (!m) throw new Error(`${fileLabel}: 未找到 $r10Ids 哈希表`)
  // 每一项形态： 'key' = 'value'  ——只保留 `=` 左侧
  return [...m[1].matchAll(/'([^']+)'\s*=/g)].map((x) => x[1])
}

/**
 * 取「esbuild 的 --outfile 目标」列表（相对 runtime node_modules 的包目录形态）。
 * 判据 4 用：构建循环必须真的把产物写到 `lib/index.js`。
 */
function parseOutfiles(text) {
  return [...text.matchAll(/--outfile=["']?([^"'\s]+)["']?/g)].map((m) => m[1])
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export function audit({ ps1Text, rebuildText, srcDir = SRC } = {}) {
  const problems = []
  const notes = []

  const ps1Loop = parseBuildLoop(ps1Text, 'build-dsht.ps1')
  const reLoop = parseBuildLoop(rebuildText, 'rebuild-plugins.ps1')

  // ---- 判据 1：两侧循环列表同集合 ----
  const psSet = new Set(ps1Loop)
  const reSet = new Set(reLoop)
  for (const p of psSet) {
    if (!reSet.has(p)) problems.push(`判据1: rebuild-plugins.ps1 的构建循环缺少 '${p}'（build-dsht.ps1 有）`)
  }
  for (const p of reSet) {
    if (!psSet.has(p)) problems.push(`判据1: build-dsht.ps1 的构建循环缺少 '${p}'（rebuild-plugins.ps1 有）`)
  }
  if (psSet.size !== ps1Loop.length) problems.push('判据1: build-dsht.ps1 构建循环有重复项')
  if (reSet.size !== reLoop.length) problems.push('判据1: rebuild-plugins.ps1 构建循环有重复项')

  // ---- 判据 2：每个包在源码树里真的有 index.ts ----
  for (const p of psSet) {
    const entry = join(srcDir, p, 'index.ts')
    if (!existsSync(entry)) problems.push(`判据2: '${p}' 的源码入口不存在（${entry}）——构建循环会编译失败`)
  }

  // ---- 判据 3：每个包在两侧 id 表里都有登记 ----
  const psIds = new Set(parseR10Ids(ps1Text, 'build-dsht.ps1'))
  const reIds = new Set(parseR10Ids(rebuildText, 'rebuild-plugins.ps1'))
  for (const p of psSet) {
    if (!reIds.has(p)) problems.push(`判据3: rebuild-plugins.ps1 的 $r10Ids 缺少 '${p}'（写不出 cordis.patch.yml ⇒ 包不会被 mount）`)
    if (!psIds.has(p)) problems.push(`判据3: build-dsht.ps1 的 $r10Ids 缺少 '${p}'`)
  }
  // 反向：id 表里有、循环里没有 ⇒ 正是本次事故（写 package.json 不产产物）
  for (const p of reIds) {
    if (!reSet.has(p)) {
      problems.push(
        `判据3+: rebuild-plugins.ps1 的 $r10Ids 登记了 '${p}'，但它**不在构建循环**里` +
          ` —— 该路径会为它写出 package.json(main: lib/index.js) 却不生成 lib/index.js` +
          ` ⇒ 真机 Cordis 加载失败 ⇒ 整棵插件树起不来（W-3 事故原型）`,
      )
    }
  }
  for (const p of psIds) {
    if (!psSet.has(p)) problems.push(`判据3+: build-dsht.ps1 的 $r10Ids 登记了 '${p}'，但它不在构建循环里`)
  }

  // ---- 判据 4：两侧都必须把产物写到 lib/index.js ----
  for (const [label, text] of [['build-dsht.ps1', ps1Text], ['rebuild-plugins.ps1', rebuildText]]) {
    const outs = parseOutfiles(text)
    if (outs.length === 0) problems.push(`判据4: ${label} 找不到任何 --outfile`)
    // 构建循环里至少要有一个产物落在某个 <pkg>/lib/index.js
    const hasMainOut = outs.some((o) => /lib[\\/]index\.js$/.test(o))
    if (!hasMainOut) problems.push(`判据4: ${label} 没有任何 --outfile 指向 lib/index.js（main 字段会指向不存在的文件）`)
  }

  notes.push(`构建循环包集（${psSet.size}）：${[...psSet].join(', ')}`)

  return { problems, notes, psLoop: ps1Loop, reLoop, psIds: [...psIds], reIds: [...reIds] }
}

// ---------------------------------------------------------------------------
// selftest：判据自身正/负控（合成输入，秒级；不依赖真实仓库当前状态）
// ---------------------------------------------------------------------------

function selftest() {
  const results = []
  const ok = (name, cond) => results.push([name, !!cond])

  const base = {
    ps1Text: `$r10Plugins = @('p-a', 'p-b')
$r10Ids = @{
    'p-a' = 'id-a'
    'p-b' = 'id-b'
}
foreach ($r10 in $r10Plugins) { & npx esbuild "src/$r10/index.ts" --outfile="$d\\lib\\index.js" }`,
    rebuildText: `foreach ($r10 in @('p-a', 'p-b')) { & $node $esb "src/$r10/index.ts" --outfile="$dir\\lib\\index.js" }
$r10Ids = @{
    'p-a' = 'id-a'
    'p-b' = 'id-b'
}`,
  }
  // 合成源码树（正控用的包必须存在）
  const fakeSrc = join(HERE, '..', 'tmp', 'selftest-plugin-parity-src')
  mkdirSync(join(fakeSrc, 'p-a'), { recursive: true })
  mkdirSync(join(fakeSrc, 'p-b'), { recursive: true })
  writeFileSync(join(fakeSrc, 'p-a', 'index.ts'), 'export const name = "p-a"\n')
  writeFileSync(join(fakeSrc, 'p-b', 'index.ts'), 'export const name = "p-b"\n')

  // 1) 正控：等价的两侧 ⇒ 无 problem
  {
    const r = audit({ ...base, srcDir: fakeSrc })
    // 源码不存在会触发判据2；这里只关心判据1/3/4 的面
    const only2 = r.problems.filter((p) => !p.startsWith('判据2'))
    ok('正控：等价两侧无判据1/3/4 问题', only2.length === 0)
  }
  // 2) 负控 A：rebuild 循环漏包（本次事故原型）⇒ 判据3+ 必须抓
  {
    const r = audit({
      ...base,
      rebuildText: base.rebuildText.replace("foreach ($r10 in @('p-a', 'p-b'))", "foreach ($r10 in @('p-a'))"),
      srcDir: fakeSrc,
    })
    ok('负控A：rebuild 循环漏包被抓（判据1）', r.problems.some((p) => p.startsWith('判据1')))
    ok('负控A：id 表登记但不在循环被抓（判据3+）', r.problems.some((p) => p.startsWith('判据3+')))
  }
  // 3) 负控 B：两侧都凑齐但 outfile 不指向 lib/index.js（main 悬空）⇒ 判据4 必须抓
  {
    const r = audit({
      ps1Text: base.ps1Text.replace('$d\\lib\\index.js', '$d\\lib\\index.cjs'),
      rebuildText: base.rebuildText.replace('$dir\\lib\\index.js', '$dir\\lib\\index.cjs'),
      srcDir: fakeSrc,
    })
    ok('负控B：outfile 未指向 lib/index.js 被抓（判据4）', r.problems.some((p) => p.startsWith('判据4')))
  }
  // 4) 负控 C：循环里有包但 id 表没有 ⇒ 判据3 必须抓
  {
    const r = audit({
      ...base,
      rebuildText: base.rebuildText.replace("    'p-b' = 'id-b'\n", ''),
      srcDir: fakeSrc,
    })
    ok('负控C：循环有包但 id 表缺失被抓（判据3）', r.problems.some((p) => p.startsWith('判据3:')))
  }
  // 5) 负控 D：foreach 手写旧列表（变量定义对了）⇒ 必须解析 foreach 才抓得到
  {
    const r = audit({
      ...base,
      ps1Text: base.ps1Text.replace(
        "foreach ($r10 in $r10Plugins) {",
        "foreach ($r10 in @('p-a')) {",
      ),
      srcDir: fakeSrc,
    })
    ok('负控D：foreach 手写旧列表被抓（解析 foreach 而非变量）', r.problems.some((p) => p.startsWith('判据1')))
  }

  let pass = 0
  for (const [name, good] of results) {
    console.log(`${good ? '  PASS' : '  FAIL'}  ${name}`)
    if (good) pass++
  }
  console.log(`selftest: ${pass}/${results.length}`)
  // 头注声明「3 = selftest 失败」——必须真的 `process.exit(3)`（而不是 `return 3`）：
  // 本仓的 `audit-selftest-claims.mjs`（W76 判据）只从 `process.exit(N)` 形态读实现码，
  // `return 3` 读不到 ⇒ 会被判成「幽灵声明」（实测踩过）。
  process.exit(pass === results.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) {
  process.exit(selftest())
}

for (const [label, f] of [['build-dsht.ps1', PS1], ['rebuild-plugins.ps1', REBUILD]]) {
  if (!existsSync(f)) {
    console.error(`文件缺失：${label} (${f})`)
    process.exit(2)
  }
}

const r = audit({ ps1Text: readFileSync(PS1, 'utf8'), rebuildText: readFileSync(REBUILD, 'utf8') })
for (const n of r.notes) console.log(`  · ${n}`)

if (r.problems.length === 0) {
  console.log('PASS  插件构建路径等价（4 判据：循环集 / 源码在场 / id 表 / 产物落 lib/index.js）')
  process.exit(0)
}
for (const p of r.problems) console.error(`  ✗ ${p}`)
console.error(`\n插件构建路径漂移：${r.problems.length} 处 —— 勿发货`)
process.exit(1)
