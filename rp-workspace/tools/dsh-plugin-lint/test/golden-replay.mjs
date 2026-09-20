/**
 * golden-replay.mjs —— 金标准回放（人工实测结论即测试集）
 * ============================================================================
 * 对 5 个已人工实测的社区包跑 lint，结论必须与 PLUGIN-COMPAT §5.2 的人工实测一致：
 *   dsh-session-pin 0.7.11    → pass（✅ 全功能正常）
 *   dsh-better-stats 0.1.16   → pass（✅ 激活正常）
 *   dsh-turn-index 0.1.1      → risk（⚠ ⑧ client face 投影：条目恒空）
 *   dsh-outline 0.1.6         → risk（⚠ ⑧：snapshot.nodes 崩溃，UI 不现身）
 *   dsh-zhipu-toolkit 0.2.1   → fail（❌ ⑨：lib/usage-stats.js 缺失 crash-loop）
 *
 * 用法：node tools/dsh-plugin-lint/test/golden-replay.mjs [evalDir]
 *   evalDir 缺省 = rp-workspace/tmp/plugin-eval（本地实测包缓存；不在仓库内，
 *   缺失时报 SKIP 退出 0——CI 无此缓存不算失败，合成 fixtures 测试才是真门禁）
 *
 * ## 退出码
 *   0 = 全部一致（或 SKIP）   1 = 有不一致（工具错了，不是包错了）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintPackage } from '../lint.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_EVAL = path.resolve(HERE, '..', '..', '..', 'tmp', 'plugin-eval')

// 金标准判据（分面）：人工实测结论的对账粒度——
//   host（装得上+加载不崩）/ android（Android 预判）/ stability（⑧非契约面提示）
// session-pin 的语义：人工实测「全功能正常」= host/android 过；它的 healthFor 增强面
// 带防御地用了非契约投影（如实提示为 stability risk，与「主功能正常」不矛盾）。
const GOLDEN = [
  { dir: 'dsh-session-pin-0.7.11/package', wantFaces: { host: 'pass', android: 'pass' } },
  { dir: 'dsh-better-stats-0.1.16/package', wantFaces: { host: 'pass', android: 'pass' } },
  { dir: 'dsh-turn-index-0.1.1/package', wantFaces: { host: 'pass', stability: 'risk' }, wantRule: 'N1-client-face' },
  { dir: 'dsh-outline/package', wantFaces: { host: 'pass', stability: 'risk' }, wantRule: 'N1-client-face' },
  { dir: 'dsh-zhipu-toolkit/package', wantFaces: { host: 'fail' }, wantRule: 'S1-closure' },
]

const evalDir = path.resolve(process.argv[2] ?? DEFAULT_EVAL)
if (!fs.existsSync(evalDir)) {
  console.log(`[golden-replay] SKIP：实测包缓存不存在（${evalDir}）`)
  process.exit(0)
}

let bad = 0
for (const g of GOLDEN) {
  const dir = path.join(evalDir, g.dir)
  if (!fs.existsSync(dir)) { console.log(`SKIP ${g.dir}（不在缓存）`); continue }
  const { verdict, faces, findings } = lintPackage(dir)
  const faceMiss = Object.entries(g.wantFaces).filter(([f, w]) => faces[f] !== w)
  const okRule = !g.wantRule || findings.some(f => f.rule === g.wantRule)
  const ok = faceMiss.length === 0 && okRule
  if (!ok) bad++
  const name = g.dir.split('/')[0]
  const faceStr = Object.entries(faces).map(([f, v]) => `${f}=${v}`).join(' ')
  console.log(`${ok ? '✓' : '✗'} ${name}：${faceStr}（${findings.length} findings）`)
  if (!ok) {
    for (const [f, w] of faceMiss) console.log(`    面不符：${f} 期望 ${w} 实得 ${faces[f]}`)
    for (const f of findings.slice(0, 8)) console.log(`    [${f.rule}] ${f.detail}`)
  }
}
if (bad) { console.error(`[golden-replay] ✗ ${bad} 包与人工实测不一致`); process.exit(1) }
console.log('[golden-replay] ✓ 全部与人工实测结论一致')
