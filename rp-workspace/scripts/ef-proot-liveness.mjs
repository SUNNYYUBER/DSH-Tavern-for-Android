#!/usr/bin/env node
/**
 * ef-proot-liveness.mjs —— L4：**proot 真隔离在设备上是否真的生效**（W10 常驻化）
 * ============================================================================
 * ## 这条判据回答什么（与既有判据的边界，P-1）
 * 代码里 `DSHT-ANDROID-PROOT` 的语义是：
 *   探测成功 ⇒ `enforcement: "full"`（真隔离）；探测失败 ⇒ **静默回退** fs 边界 + 一行 warn。
 * 而「回退」与「成功」在**功能上都能用**（消息照发）⇒ 光看「App 能跑」**永远区分不出来**
 * （P-17 的反向形态：**能跑 ≠ 隔离生效**）。
 * ⇒ 本判据直接复算 **JS 层那一行判定**（与源码逐字同构），回答「走的哪一支」。
 *
 * ## 判据（三部分，缺一不可）
 *   ① **装置前提**：`libproot.so` / `libbusybox.so` / `proot-loader` 就位；
 *   ② ★ **判定复算**：在**真实 env**（NodeService 注入的那套）+ **真实 node** 下跑
 *      `spawnSync(BIN, [--kill-on-exit, -r, ROOTFS, ...binds, /bin/true]).status === 0`
 *      —— 这就是 `globalThis.__dshtProotOk` 的值；
 *   ③ **结果面取证**：guest 内**真执行一条命令**并读回输出（防「探针过、实际不能用」）。
 *
 * ## 为什么必须用设备上的 node（而不是 PC 侧推断）
 * 判定涉及的每一项（`process.env.*`、`existsSync`、`spawnSync.status`）都**只在设备运行时**存在；
 * 且 `existsSync` 会**过滤**掉不存在的 bind（实测 `/sdcard`、`/storage/emulated` 被滤掉，
 * 正是 proot 两条 warning 的来源）—— PC 侧推断无法复现这一步。
 *
 * ## 命令构造固定在设备侧脚本里（承 §6.23 装置坑⑤）
 * 经 `adb shell → run-as → sh -c "…"` 转发多层引号时，`for` 循环 / `$(…)` / `export`
 * 会被逐层吞掉（实测：`syntax error: unexpected 'do'`；env 未生效导致
 * `library "libtalloc.so.2" not found` ⇒ **差点误判「proot 在设备上跑不起来」**）。
 * ⇒ 本脚本只负责 **push + 跑** `scripts/ef-proot-liveness-device.sh`，命令在设备侧构造。
 *
 * ## 诚实边界
 * · `enforcement: "full"` 只证明**探针通过 + guest 可执行**；不等于「所有命令都被关住」（沙箱策略面另论）。
 * · 本机 AVD = Android 15 / SDK 35，与**真机** SELinux 策略不完全等价
 *   ⇒ 结论按 R7 标注「模拟器实测」，真机复核项仍留在 GOAL §11.2。
 *
 * 用法：
 *   node scripts/ef-proot-liveness.mjs                 # 设备实测（需 adb + App 已装）
 *   node scripts/ef-proot-liveness.mjs --selftest      # 判据自身正/负控（不依赖设备）
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}\\.android\\sdk\\platform-tools\\adb.exe`
const PKG = 'com.dshtavern.app'
const DEVICE_SH = 'ef-proot-liveness-device.sh'
const DEVICE_TMP = `/data/local/tmp/${DEVICE_SH}`

// ---------------------------------------------------------------------------
// 判据自证（--selftest）—— 不依赖设备，验证「从原始输出到结论」的解析逻辑
// ---------------------------------------------------------------------------
// ## 为什么需要（P-30）
// 设备侧结论最终是一个布尔值，而**判据自己坏掉时**（例如错把「命令能跑」当通过）
// 输出可能**完全相同**。故把解析抽成纯函数并自证。
export function judgeProbe ({ probeStatus, guestOut, hasBin }) {
  if (!hasBin) return { verdict: 'premise-fail', ok: false, reason: '装置前提不成立：libproot.so / libbusybox.so / proot-loader 缺失（**不是** proot 不可用）' }
  if (probeStatus !== 0) {
    return { verdict: 'fallback', ok: false, reason: `probe.status=${probeStatus}（≠0）⇒ JS 层 __dshtProotOk=false ⇒ enforcement="unusable"（静默回退 fs 边界，功能仍可用）` }
  }
  if (!guestOut || !guestOut.includes('PROOT-GUEST-OK')) {
    return { verdict: 'probe-only', ok: false, reason: '探针通过但 **guest 内实执行失败** ⇒ 「探针过、实际不能用」（比探针失败更坏：full 隔离建在空壳上）' }
  }
  return { verdict: 'full', ok: true, reason: 'probe.status=0 且 guest 内实执行成功 ⇒ enforcement="full"（真隔离生效）' }
}

const SELFTEST_CASES = [
  ['正控：探针过 + guest 实执行成功 ⇒ full', { probeStatus: 0, guestOut: 'PROOT-GUEST-OK', hasBin: true }, 'full', true],
  ['负控：探针失败 ⇒ fallback（模拟无 proot 的设备）', { probeStatus: 1, guestOut: '', hasBin: true }, 'fallback', false],
  ['★ 负控：探针过但 guest 实执行失败 ⇒ 必须报红（防「空壳 full」）', { probeStatus: 0, guestOut: 'execve: No such file', hasBin: true }, 'probe-only', false],
  ['负控：二进制缺失 ⇒ 装置前提不成立（不得报 fallback）', { probeStatus: 0, guestOut: 'PROOT-GUEST-OK', hasBin: false }, 'premise-fail', false],
  ['负控：guest 输出为空 ⇒ 不得当成功', { probeStatus: 0, guestOut: '', hasBin: true }, 'probe-only', false],
]

if (process.argv.includes('--selftest')) {
  console.log('=== ef-proot-liveness --selftest（判据自身正/负控；不依赖设备）===')
  let n = 0
  for (const [label, input, wantVerdict, wantOk] of SELFTEST_CASES) {
    const r = judgeProbe(input)
    const ok = r.verdict === wantVerdict && r.ok === wantOk
    if (ok) n++
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label} ⇒ verdict=${r.verdict} ok=${r.ok}（期望 ${wantVerdict}/${wantOk}）`)
    if (!ok) console.log(`         reason=${r.reason}`)
  }
  console.log(`\n[ef-proot-liveness selftest] ${n}/${SELFTEST_CASES.length} PASS`)
  process.exit(n === SELFTEST_CASES.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 设备侧：push 脚本（CRLF→LF）后执行，按 SECTION 切分输出
// ---------------------------------------------------------------------------
console.log('[ef-proot-liveness] L4 proot 生存性（设备实测）\n')

const sh = readFileSync(join(HERE, DEVICE_SH), 'utf8').replace(/\r\n/g, '\n')
const tmpLocal = join(process.env.TEMP ?? '/tmp', DEVICE_SH)
spawnSync(process.platform === 'win32' ? 'powershell' : 'sh',
  process.platform === 'win32'
    ? ['-NoProfile', '-Command', `[IO.File]::WriteAllText('${tmpLocal}', [Console]::In.ReadToEnd())`]
    : ['-c', `cat > ${tmpLocal}`],
  { input: sh })

const push = spawnSync(ADB, ['push', tmpLocal, DEVICE_TMP], { encoding: 'utf8' })
if (push.status !== 0) { console.error('push 失败：', push.stderr || push.stdout); process.exit(2) }

const r = spawnSync(ADB, ['shell', 'run-as', PKG, 'sh', DEVICE_TMP], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const out = (r.stdout ?? '') + (r.stderr ?? '')
if (!out.includes('### SECTION:premise')) {
  console.error('设备侧脚本未正常执行（装置不成立）：\n' + out.slice(0, 400))
  process.exit(2)
}

// 按 SECTION 切分
const sections = {}
let cur = null
for (const line of out.split('\n')) {
  const m = /^### SECTION:(\w+)$/.exec(line.trim())
  if (m) { cur = m[1]; sections[cur] = []; continue }
  if (cur && line.trim() !== '### END') sections[cur].push(line)
}
const premise = (sections.premise ?? []).join('\n')
const probe = (sections.probe ?? []).join('\n').trim()
const guest = (sections.guest ?? []).join('\n').trim()
const logcat = (sections.logcat ?? []).join('\n').trim()

console.log('① 装置前提：')
for (const l of premise.split('\n').filter(Boolean)) console.log(`   ${l}`)
const hasBin = !premise.includes('MISS')
console.log('')

console.log('② 判定复算（真实 env + 真实 node，逐字同构 JS 层）：')
const mStatus = /STATUS=(-?\d+)/.exec(probe)
const probeStatus = mStatus ? Number(mStatus[1]) : NaN
console.log(`   ${probe.split('\n').filter(l => l.includes('BINDS=')).join('') || probe.slice(0, 200)}`)
console.log(`   ⇒ probe.status = ${Number.isNaN(probeStatus) ? '(解析不出 ⇒ 视为失败)' : probeStatus}`)
console.log('')

console.log('③ 结果面（guest 内真执行一条命令）：')
const guestOk = guest.includes('PROOT-GUEST-OK')
console.log(`   ${guestOk ? '✓ 输出含 PROOT-GUEST-OK' : '✗ 未取到预期输出：' + guest.slice(-160)}`)
console.log('')

console.log('④ 交叉证据（JS 层失败告警在 logcat 里的条数）：')
console.log(`   ${logcat || '(读不到 logcat)'}`)
console.log('')

const verdict = judgeProbe({ probeStatus, guestOut: guestOk ? 'PROOT-GUEST-OK' : '', hasBin })
console.log(`[ef-proot-liveness] ${verdict.ok ? 'PASS' : 'FAIL'} —— ${verdict.reason}`)
if (verdict.ok) {
  console.log('  ⇒ L4「proot 生存性」在**本模拟器**（Android 15 / SDK 35）：**探针通过、真隔离生效**')
  console.log('  ⇒ 诚实边界（R7）：模拟器 SELinux 策略与真机不完全等价 ⇒ 真机复核仍留在 GOAL §11.2')
}
process.exit(verdict.ok ? 0 : 1)
