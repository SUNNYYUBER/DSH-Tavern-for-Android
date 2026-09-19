#!/usr/bin/env node
/**
 * audit-rp-parser-negctl.mjs —— 判据 8c（构建路径解析器自证）的**真实仓库负控**
 *
 * ## 为什么需要（P-41 推论三：判据的覆盖面本身也要有判据）
 * 判据 8②③ 的结论**完全依赖**「权威路径是否已归一」，而那个结论由
 * `verify-rp-consolidation.mjs:parseSplitEntries()` 从 `build-dsht.ps1` 文本里解析。
 * 解析器一旦漏形态，结论会**反向**（漏归一 ⇒ 误判已归一 ⇒ 对仍需 export 的
 * 子模块报红），而输出看起来仍是「✓/✗ 判据8②」的**正常形态** —— 正是本项目
 * 主力缺陷族（静默）。故必须证明 8c 对真实的「漏形态」有**区分力**。
 *
 * ## 做法（L144：改**源码**而非产物；逐字节还原）
 * 对真实 `build-dsht.ps1` 依次制造三种「解析器会失准」的真实形态，每次：
 *   ① 断言 `verify-rp-consolidation.mjs` **报红**（exit ≠ 0 且 8c 行含 ❌）；
 *   ② 逐字节还原（Buffer 级），复跑断言**回绿**。
 * 三种形态（都取自实际可能发生的改法）：
 *   N1 循环在、数组定义被改名 ⇒ 展开失败（names=[]）
 *   N2 循环外新增一个插值入口 ⇒ 未被任何已识别循环覆盖
 *   N3 循环体 esbuild 的 entry 不再写成 `src/$var/index.ts` ⇒ 循环识别不出来
 *
 * ⚠️ 副作用：三种形态都会让 8② 的结论变化（这是**预期**：正是要证明这一点）。
 *    本脚本只关心 8c 是否报红；退出码以 8c 的表现为准。
 *
 * 用法：node scripts/audit-rp-parser-negctl.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BD = join(HERE, 'build-dsht.ps1')
const VERIFY = join(HERE, 'verify-rp-consolidation.mjs')

function runVerify () {
  const r = spawnSync(process.execPath, [VERIFY], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const eightC = out.split('\n').find(l => l.includes('判据8c')) ?? ''
  return { code: r.status, ok8c: /✓\s+判据8c/.test(eightC), bad8c: /✗\s+判据8c/.test(eightC), line: eightC.trim() }
}

const results = []
const record = (label, ok, extra) => results.push([label, ok, extra])

// ---- 基线：未破坏时必须回绿（否则下面的负控没有意义）----
const origBytes = fs.readFileSync(BD)                 // Buffer：逐字节还原的唯一凭据
const origText = origBytes.toString('utf8')
const NL = origText.includes('\r\n') ? '\r\n' : '\n'  // 行尾风格（Windows 工作区是 CRLF）

const base = runVerify()
record('基线：未破坏 ⇒ 8c 通过（否则本负控无意义）', base.code === 0 && base.ok8c, `exit=${base.code}`)

/** 制造一处破坏 → 断言 8c 报红 → 逐字节还原 → 断言回绿 */
function negctl (label, mutate) {
  const mutated = mutate(origText)
  if (mutated === origText) {
    record(`${label}【锚点不匹配 ⇒ 负控未生效，不可据此下结论】`, false, '')
    return
  }
  fs.writeFileSync(BD, mutated, 'utf8')
  let broke
  try {
    broke = runVerify()
  } finally {
    fs.writeFileSync(BD, origBytes)                   // 逐字节还原（不用字符串，避免行尾/BOM 漂移）
  }
  const restored = runVerify()
  const byteIdentical = Buffer.compare(fs.readFileSync(BD), origBytes) === 0
  const ok = broke.code !== 0 && broke.bad8c && restored.code === 0 && restored.ok8c && byteIdentical
  record(label, ok,
    `破坏时 exit=${broke.code} 8c报红=${broke.bad8c ? '✓' : '✗'} · 还原后 exit=${restored.code} 8c通过=${restored.ok8c ? '✓' : '✗'} · 逐字节一致=${byteIdentical ? '✓' : '✗'}`)
  if (!ok) console.log(`      破坏时的 8c 行：${broke.line}`)
}

// N1：循环仍在，但数组定义变量被改名 ⇒ 展开失败（真实场景：有人重构变量名）
negctl('N1 循环在、数组定义改名 ⇒ 8c 必须报红（展开失败）',
  t => t.replace(/\$r10Plugins\s*=\s*@\(/, '$r10PluginsRenamed = @('))

// N2：循环之外新增一个插值入口 ⇒ 未被已识别循环覆盖（真实场景：加了个新包用新变量）
negctl('N2 循环外新增插值入口 ⇒ 8c 必须报红（未被解析覆盖）',
  t => t.replace(/\$r10Plugins\s*=\s*@\(/,
    '& npx esbuild "src/$newPkg/index.ts" --bundle --outfile=c.js' + NL + '$r10Plugins = @('))

// N3：循环体的 esbuild 入口写法变了 ⇒ 循环识别不出来（真实场景：归一化时顺手改了路径）
negctl('N3 循环体入口不再是 src/$var/index.ts ⇒ 8c 必须报红（循环未识别）',
  t => t.replace(/esbuild\s+"src\/\$r10\/index\.ts"/, 'esbuild "src/$r10/plugin.ts"'))

let pass = 0
console.log('=== 判据 8c 真实仓库负控（构建路径解析器）===')
for (const [label, ok, extra] of results) {
  if (ok) pass++
  console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label}${extra ? `\n        ${extra}` : ''}`)
}
console.log(`\n[rp-parser negctl] ${pass}/${results.length} PASS`)
// ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
reportSelftest('rp-parser-negctl', pass, results.length)
process.exit(pass === results.length ? 0 : 1)
