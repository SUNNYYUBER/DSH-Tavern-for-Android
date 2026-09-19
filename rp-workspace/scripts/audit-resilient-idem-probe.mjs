// audit-resilient-idem-probe.mjs — 决定性实验：patch-resilient-list.mjs 的幂等判据是否为「子串包含」型缺陷
//
// 背景（W26 待办②）：W25 抓到 2 处「补丁幂等判据失效」（Dsht-Patch 形态）。本探针查
// **非 Dsht-Patch 形态**的补丁点是否同族。疑点：patch-resilient-list.mjs 里
//   const MARKER = 'DSHT-RESILIENT-LIST'            // 主体判据用 t.includes(MARKER)
//   const IMPORT_MARK = 'DSHT-RESILIENT-LIST-IMPORT' // 另一个标记（旧名）
// ⇒ MARKER 是该 IMPORT 标记的**真前缀** ⇒ 只要文件里有 IMPORT 标记，
//   `t.includes(MARKER)` 就为真 ⇒ 主体补丁被**静默跳过**（补丁消失且无声 = P-11 族）。
// **缺陷已修**（幂等判据改锚到「主体语义已生效」+ IMPORT 标记改名为 `DSHT-RESILIENT-IMPORT`），
// 本探针因此成为该修复的**常驻回归判据**：B 场景必须不再复现「静默跳过」。
//
// 实验设计（正控 + 负控 + 杠杆）：
//   A 正控：干净夹具（含 ORIG_015 锚点 + 裸 import 行）⇒ 应打上主体（输出 patched:）
//   B 负控：夹具里预置一行**旧名** IMPORT 标记注释，锚点**原样保留** ⇒
//           修复前：输出「补丁已跳過」且锚点仍在 ⇒ 缺陷；修复后：必须**按锚点打上主体**
//   C 杠杆：删掉 B 里那行注释（其余逐字不变）⇒ 必须与 A 行为一致（证差异只来自那行注释）
//
// 用法：node scripts/audit-resilient-idem-probe.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = dirname(HERE)
const SCRIPT = join(WS, 'scripts', 'patch-resilient-list.mjs')
// 夹具与临时探针都放**系统临时区**（不放 scripts/ 或仓库内）：
// ① 不污染仓库（本探针会在夹具里造/改文件）；② 与本项目「判据产物不落仓库」的既有约定一致。
const FIXT = join(os.tmpdir(), 'dsht-audit-resilient-idem-fixture')

const T = '\t'
// 与 patch-resilient-list.mjs 的 ORIG_015 逐字一致（新代次锚点）
const ORIG_015 = [
  `${T}${T}${T}${T}let header;`,
  `${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}header = await this.readGenerationHeader(selected, void 0, signal);`,
  `${T}${T}${T}${T}} catch (error) {`,
  `${T}${T}${T}${T}${T}if (error instanceof SessionFormatUnsupportedError) continue;`,
  `${T}${T}${T}${T}${T}throw error;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}if (header === void 0) continue;`,
  `${T}${T}${T}${T}if (ids.has(header.id)) throw new Error(\`duplicate JSONL session id "\${header.id}" appears in multiple project directories\`);`,
  `${T}${T}${T}${T}ids.add(header.id);`,
  `${T}${T}${T}${T}artifacts.push({`,
  `${T}${T}${T}${T}${T}header,`,
  `${T}${T}${T}${T}${T}path: selected.sourcePath`,
  `${T}${T}${T}${T}});`,
].join('\n')

const IMPORT_LINE = 'import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";'

function fixture (extraLine) {
  const head = [
    '// 合成夹具（W26 实验用，非真实产物）',
    IMPORT_LINE,
    extraLine,          // '' 表示不预置
    'async function listArtifacts () {',
    ORIG_015,
    '}',
  ].filter(l => l !== null).join('\n')
  return head + '\n'
}

function run (label, extraLine) {
  rmSync(FIXT, { recursive: true, force: true })
  const target = join(FIXT, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, fixture(extraLine))
  // 复制脚本并把 FILES 指向夹具（探针必须真跑被测脚本，不能只复述它的逻辑）
  const src = readFileSync(SCRIPT, 'utf8')
  const patched = src.replace(/const FILES = \[[\s\S]*?\]/, `const FILES = [${JSON.stringify(target)}]`)
  if (patched === src) throw new Error('探针自身缺陷：未能改写 FILES（脚本形态变了？）')
  const probe = join(FIXT, 'probe.mjs')
  writeFileSync(probe, patched)
  let out = '', code = 0
  try {
    out = execFileSync(process.execPath, [probe], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '')
    code = e.status ?? 1
  }
  const after = readFileSync(target, 'utf8')
  // 事实判据：主体补丁的**语义**是否生效（区分「打了」与「没打」，不看 marker）
  const bodyApplied = after.includes('effectivePath') && after.includes('skipping session log with mismatched identity')
  const originKept = after.includes(ORIG_015)
  rmSync(probe, { force: true })
  return { label, code, out: out.trim().split('\n').join(' | '), bodyApplied, originKept }
}

const A = run('A 正控：干净夹具', '')
const B = run('B 缺陷：预置一行 IMPORT_MARK（锚点原样保留）',
  `// import 行由别处补过：/* DSHT-RESILIENT-LIST-IMPORT: rename 用于身份自愈 */`)
const C = run('C 杠杆：同 B 但删掉那行 IMPORT_MARK 注释', '')

console.log('=== w26 决定性实验：patch-resilient-list 幂等判据 ===')
for (const r of [A, B, C]) {
  console.log(`[${r.label}]`)
  console.log(`  exit=${r.code}  主体语义已生效=${r.bodyApplied}  原始锚点仍在=${r.originKept}`)
  console.log(`  脚本输出：${r.out}`)
}
console.log('')
const aOk = A.bodyApplied && !A.originKept
const bBug = !B.bodyApplied && B.originKept
const cLever = C.bodyApplied && !C.originKept
console.log(`[正控] A 打上主体 = ${aOk}  ${aOk ? 'PASS' : 'FAIL'}`)
console.log(`[缺陷] B 静默跳过（主体未打且锚点仍在）= ${bBug}  ${bBug ? '★ 缺陷证实' : '未复现'}`)
console.log(`[杠杆] C 与 A 行为一致 = ${cLever}  ${cLever ? 'PASS' : 'FAIL'}（证 B 的差异只来自那行注释）`)
process.exit(aOk && cLever ? 0 : 1)
