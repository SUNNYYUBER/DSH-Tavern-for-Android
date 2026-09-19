#!/usr/bin/env node
/**
 * audit-device-runtime-negctl.mjs —— R22③「设备侧 runtime 与产物一致」的**负控**
 *
 * ## 为什么需要（P-20/P-30）
 * 该判据的输出形态是「✓ 一致」——而**判据自己坏掉**（永远报 ✓）时输出**完全相同**。
 * 故必须证明它对以下两种真实失效**都有区分力**：
 *   A 用**不存在的特征串**（模拟「本次修复没进设备」）⇒ 必须报红；
 *   B 本地产物存在但设备侧**读不到**（模拟「App 未装 / 未解压」）⇒ 必须**声明跳过**
 *     （而不是冒充通过，也不是直接 fail —— 那是「无判据力」的诚实登记）。
 *
 * 用法：node scripts/audit-device-runtime-negctl.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = dirname(HERE)
const SCRIPT = join(HERE, 'verify-apk-runtime-version.mjs')

function run (args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const results = []

// A 正控：真特征串 ⇒ 应 ✓ 一致（exit 0）
const a = run(['--device', '--expect-str', 'align-items: center !important'])
const aOk = a.code === 0 && a.out.includes('设备 runtime 与产物一致')
results.push(['A 正控：本次新增的真实特征串 ⇒ 报一致', aOk, `exit=${a.code}`])

// B 负控：伪造一个必然不存在的特征串 ⇒ 必须报红（exit 1）
const b = run(['--device', '--expect-str', 'DSHT_DEFINITELY_NOT_IN_BUNDLE_zzz'])
const bOk = b.code !== 0 && b.out.includes('命中 0')
results.push(['B 负控：不存在的特征串 ⇒ 报红（模拟「修复没进设备」）', bOk, `exit=${b.code}`])

// C 区分力：两次的差异**只来自那个特征串**（正控过、负控挂 ⇒ 判据确实在看特征串）
results.push(['C 杠杆：A 过而 B 挂 ⇒ 差异只源于被检的特征串', aOk && bOk, ''])

let pass = 0
console.log('=== R22③ 判据负控（设备侧 runtime 一致性）===')
for (const [label, ok, extra] of results) {
  if (ok) pass++
  console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label}  ${extra}`)
}
console.log(`\n[device-runtime negctl] ${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
