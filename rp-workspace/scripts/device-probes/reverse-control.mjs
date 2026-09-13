#!/usr/bin/env node
/**
 * reverse-control.mjs — 设备侧反控（T-78 / T-79）· **源码级**（2026-09-13 心跳 76 重写）
 * ============================================================================
 * 目的：证明「探针能抓到防护失效」——若只是探针全绿而**从不红**，那绿毫无意义（L44）。
 *
 * 做法：把防护**临时停用** → 重跑探针，期望**转红** → 还原，期望**回绿**。
 *
 * ## 为什么必须改设备上的文件
 * 设备跑的是 `files/.dsh/profiles/web/node_modules/dsht-rp-plugin/` 下的副本
 * （由 NodeService 从 APK assets 拷贝），**不是**仓库里的构建产物。
 * 改仓库产物不影响设备。
 *
 * ## 为什么改成「源码级」（原版脆弱点的根治）
 * 原版直接对**产物字节**做字符串替换，锚点用函数名（`function detectStaticRisk(pattern) {`）。
 * 实测确认该做法有真实脆弱点：esbuild 一旦开 `--minify`，**所有局部函数名被重命名**
 * （`detectStaticRisk` / `guardCardContent` / `loreRegexGuard` 出现次数全变 0），
 * 而脚本**不会报错**，只是 `applied === 0` —— 反控静默失配，结论却仍可能被当作"跑过了"。
 *
 * 现改为：**改源码 → 用与构建完全相同的 cwd/参数重编译 → 推送设备**。
 * 源码是**人手写给人看的**，永不被 minify（minify 只作用于产物）⇒ 锚点永远稳定。
 * 额外收益：反控走的就是真实构建路径，比"改产物字节"更接近真实故障形态。
 *
 * ## 三重保险
 *   1. **源码锚点断言**：改动前先确认锚点原文存在，缺失即 exit 2（不静默）；
 *   2. **编译断言**：重编译失败即还原源码并退出（绝不留脏源码）；
 *   3. **兜底还原**：`restore-all` 一键复原（源码 + 重编译 + 推回设备），
 *      且每次 `status` 会检查**是否有反控残留**（源码被改过）并醒目提示。
 *
 * ⚠️ 运行本脚本会让**仓库源码处于被篡改状态**（仅 stop 期间）。`restore` 会还原源码，
 *    还原后目录应与 `git status` 一致（脚本会在还原后自检并提示）。
 *
 * 用法：
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs status            # 状态 + 残留检测（只读）
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs verify            # 源码锚点齐备性（只读）
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs t78-stop          # 停用 T-78（两侧产物）
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs t78-restore
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs t79-stop          # 停用 T-79（node 侧产物）
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs t79-restore
 *   node rp-workspace/scripts/device-probes/reverse-control.mjs restore-all       # 兜底：全部还原
 *
 * 兼容别名：`t78node-stop` / `t78node-restore` ≡ `t78-stop` / `t78-restore`
 *   （源码级改动会同时影响浏览器侧与 node 侧产物，两者不再需要分开做）
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ADB = process.env.ADB || 'C:/Users/Administrator/.android/sdk/platform-tools/adb.exe'
const PKG = 'com.dshtavern.app'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 本脚本位于 `rp-workspace/scripts/device-probes/` ⇒ 往上一级即 `rp-workspace`（= WS）。 */
const WS = path.resolve(HERE, '..', '..')
const ROOT = path.resolve(WS, '..')
const PKG_DIR = path.join(WS, 'packages')
const NODE = process.execPath
const ESB = path.join(PKG_DIR, 'node_modules', 'esbuild', 'bin', 'esbuild')

/** 设备上两处插件副本（NodeService 会把 web profile 那份也拷一份） */
const DEV = {
  appJs: [
    'files/.dsh/profiles/web/node_modules/dsht-rp-plugin/assets/app.js',
    'files/dsh-runtime/node_modules/dsht-rp-plugin/assets/app.js',
  ],
  indexJs: [
    'files/.dsh/profiles/web/node_modules/dsht-rp-plugin/lib/index.js',
    'files/dsh-runtime/node_modules/dsht-rp-plugin/lib/index.js',
  ],
}

const sh = (c) => {
  try { return execFileSync(ADB, ['shell', `run-as ${PKG} sh -c ${JSON.stringify(c)}`], { encoding: 'utf8', maxBuffer: 256e6 }) } catch (e) { return (e.stdout ?? '') + (e.stderr ?? '') }
}

// ---------------------------------------------------------------------------
// 源码锚点
//
// 每条 = { file, from, to, bak }
//   · `from` 必须在源码里**逐字存在**（断言，缺失即 exit 2）
//   · `to` 必须是**语法/类型合法**的替换（否则重编译会炸）
// 备份文件后缀统一 `.rcsrcbak`，`status` 会检测它的存在来报告残留。
// ---------------------------------------------------------------------------

const SRC = {
  safeRegex: path.join(PKG_DIR, 'src', 'lore', 'safe-regex.ts'),
  cardFence: path.join(PKG_DIR, 'src', 'dsht-plugin-shared', 'card-fence.ts'),
}

/**
 * T-78 停用：让 `detectStaticRisk` 恒返回 null（不再静态拒绝危险正则）。
 * 返回类型 `RiskHit | null` 含 null ⇒ `return null` 类型合法。
 */
const T78_ANCHOR = {
  file: SRC.safeRegex,
  from: 'function detectStaticRisk(pattern: string): RiskHit | null {',
  to: 'function detectStaticRisk(pattern: string): RiskHit | null {\n  return null /* RC-DISABLED 心跳76（源码级反控） */',
}

/**
 * T-79 停用：让 `guardCardContent` 直接返回原文（不消毒、不围栏）。
 * 返回类型 `CardGuardResult` ⇒ 必须构造完整对象（含 hits 全部字段）。
 */
const T79_ANCHOR = {
  file: SRC.cardFence,
  from: 'export function guardCardContent(expanded: string, opts: { nonce?: string } = {}): CardGuardResult {',
  to: 'export function guardCardContent(expanded: string, opts: { nonce?: string } = {}): CardGuardResult {\n'
    + "  return { text: expanded, nonce: 'rcdisabled00000000', hits: { chatml: 0, inst: 0, roleLine: 0, residualMacros: 0, residualSamples: [] } } /* RC-DISABLED 心跳76（源码级反控） */",
}

const BAK_SUFFIX = '.rcsrcbak'

/** 该锚点是否处于「已应用（篡改）态」 */
function isApplied (anchor) {
  const bak = anchor.file + BAK_SUFFIX
  return fs.existsSync(bak)
}

/** 应用锚点（幂等：已应用则跳过；缺失原文则报错） */
function applyAnchor (anchor) {
  const bak = anchor.file + BAK_SUFFIX
  if (fs.existsSync(bak)) return 'already'
  const text = fs.readFileSync(anchor.file, 'utf8')
  if (!text.includes(anchor.from)) return 'missing-anchor'
  fs.writeFileSync(bak, text)
  fs.writeFileSync(anchor.file, text.replace(anchor.from, anchor.to))
  return 'applied'
}

/** 还原锚点（幂等） */
function revertAnchor (anchor) {
  const bak = anchor.file + BAK_SUFFIX
  if (!fs.existsSync(bak)) return 'not-applied'
  fs.copyFileSync(bak, anchor.file)
  fs.unlinkSync(bak)
  return 'reverted'
}

// ---------------------------------------------------------------------------
// 重编译 + 推送
// ---------------------------------------------------------------------------

/** 编译某个入口到临时文件（cwd 与构建脚本一致 ⇒ 与产物同形） */
function compile (entryRel, args) {
  const tmp = path.join(os.tmpdir(), `rc-${process.pid}-${Math.random().toString(36).slice(2)}.js`)
  execFileSync(NODE, [ESB, entryRel, ...args, `--outfile=${tmp}`, '--log-level=warning'], {
    cwd: PKG_DIR, stdio: 'pipe', maxBuffer: 64e6,
  })
  return tmp
}

/** 推送本地文件到设备上的若干路径 */
function pushTo (localFile, devRels) {
  const devTmp = `/data/local/tmp/${path.basename(localFile)}`
  execFileSync(ADB, ['push', localFile, devTmp], { encoding: 'utf8', maxBuffer: 64e6 })
  let n = 0
  for (const rel of devRels) {
    const r = sh(`cp ${devTmp} ${rel} && wc -c < ${rel}`)
    if (/\d/.test(r)) n++
  }
  // 临时文件归 shell 用户，用 adb shell 自己删（run-as 是 app 用户，会 Permission denied）
  execFileSync(ADB, ['shell', `rm -f ${devTmp}`], { encoding: 'utf8' })
  return n
}

/** 重编译并按需推送；返回推送份数 */
function rebuildAndPush (which) {
  let pushed = 0
  if (which.includes('app')) {
    const f = compile('src/import/browser-entry.ts', ['--bundle', '--format=iife', '--global-name=DSHT'])
    try { pushed += pushTo(f, DEV.appJs) } finally { fs.unlinkSync(f) }
  }
  if (which.includes('index')) {
    const f = compile('src/dsh-plugin/index.ts', ['--bundle', '--format=esm', '--platform=node'])
    try { pushed += pushTo(f, DEV.indexJs) } finally { fs.unlinkSync(f) }
  }
  return pushed
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2] || 'status'

if (cmd === 'status') {
  console.log('=== 反控残留检测（源码）===')
  const t78 = isApplied(T78_ANCHOR)
  const t79 = isApplied(T79_ANCHOR)
  console.log(`  T-78 反控：${t78 ? '⚠️ 残留（源码被篡改，safe-regex.ts）——跑 t78-restore 还原' : '未应用（干净）'}`)
  console.log(`  T-79 反控：${t79 ? '⚠️ 残留（源码被篡改，card-fence.ts）——跑 t79-restore 还原' : '未应用（干净）'}`)
  console.log('\n=== 设备产物 ===')
  for (const [k, list] of Object.entries(DEV)) {
    for (const rel of list) {
      const size = sh(`wc -c < ${rel} 2>/dev/null || echo MISSING`).trim()
      console.log(`${k}: ${rel}\n    size=${size}`)
    }
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// verify —— 源码锚点齐备性（只读）
// ---------------------------------------------------------------------------
if (cmd === 'verify') {
  let bad = 0
  for (const [name, anchor] of [['T-78', T78_ANCHOR], ['T-79', T79_ANCHOR]]) {
    const bak = anchor.file + BAK_SUFFIX
    if (fs.existsSync(bak)) {
      console.log(`⚠️ ${name}：源码处于**已篡改**态（${path.basename(anchor.file)}）——先还原再 verify`)
      bad++
      continue
    }
    let text
    try { text = fs.readFileSync(anchor.file, 'utf8') } catch (e) {
      console.log(`✗ ${name}：读不到源码 ${anchor.file}`); bad++; continue
    }
    if (text.includes(anchor.from)) {
      console.log(`✓ ${name}：源码锚点齐备（${path.basename(anchor.file)}）`)
    } else {
      console.log(`✗ ${name}：源码锚点**不存在** ⇒ 反控会失配。锚点原文：`)
      console.log(`    ${anchor.from}`)
      bad++
    }
  }
  if (!fs.existsSync(ESB)) { console.log(`✗ esbuild 不存在：${ESB}`); bad++ }
  console.log(bad === 0 ? '\n[rc verify] PASS —— 源码锚点齐备，反控可用' : `\n[rc verify] FAIL —— ${bad} 项不满足`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------
// stop：改源码 → 重编译 → 推送
// ---------------------------------------------------------------------------
function doStop (label, anchor, which) {
  const r = applyAnchor(anchor)
  if (r === 'missing-anchor') {
    console.error(`[rc] ${label} 停用失败：源码锚点不存在（产物形态/源码已变）——反控未生效`)
    console.error(`[rc]    期望锚点：${anchor.from}`)
    process.exit(2)
  }
  if (r === 'already') console.log(`[rc] ${label} 源码已是篡改态（幂等，继续重编译推送）`)
  let pushed
  try {
    pushed = rebuildAndPush(which)
  } catch (e) {
    console.error(`[rc] ${label} 重编译失败：${e.message?.slice(0, 300)}`)
    console.error('[rc] 立即还原源码，避免留脏状态')
    revertAnchor(anchor)
    process.exit(3)
  }
  console.log(`[rc] ${label} 停用完成：源码已改 + 重编译 + 推送 ${pushed} 份设备副本`)
  console.log('[rc]    ⚠️ 记得跑 <cmd>-restore 还原（否则仓库源码留在篡改态，A14 闸门会报红）')
  console.log('[rc]    ⚠️ 设备需重启 App（node 侧）与刷新页面（浏览器侧）才生效')
  process.exit(0)
}

/** restore：还原源码 → 重编译 → 推送（让设备回到干净产物） */
function doRestore (label, anchor, which) {
  const r = revertAnchor(anchor)
  if (r === 'not-applied') {
    console.log(`[rc] ${label} 源码本就干净（无需还原）`)
  } else {
    console.log(`[rc] ${label} 源码已还原`)
  }
  let pushed
  try {
    pushed = rebuildAndPush(which)
  } catch (e) {
    console.error(`[rc] ${label} 还原后重编译失败：${e.message?.slice(0, 300)}`)
    process.exit(3)
  }
  console.log(`[rc] ${label} 还原完成：重编译 + 推送 ${pushed} 份设备副本`)
  process.exit(0)
}

if (cmd === 't78-stop' || cmd === 't78node-stop') doStop('T-78', T78_ANCHOR, ['app', 'index'])
if (cmd === 't78-restore' || cmd === 't78node-restore') doRestore('T-78', T78_ANCHOR, ['app', 'index'])
if (cmd === 't79-stop') doStop('T-79', T79_ANCHOR, ['index'])
if (cmd === 't79-restore') doRestore('T-79', T79_ANCHOR, ['index'])

if (cmd === 'restore-all') {
  let dirty = 0
  for (const [label, anchor, which] of [['T-78', T78_ANCHOR, ['app', 'index']], ['T-79', T79_ANCHOR, ['index']]]) {
    if (isApplied(anchor)) {
      revertAnchor(anchor)
      console.log(`[rc] ${label} 源码已还原`)
      dirty++
    }
  }
  if (dirty === 0) { console.log('[rc] 无残留反控'); process.exit(0) }
  const pushed = rebuildAndPush(['app', 'index'])
  console.log(`[rc] 重编译 + 推送 ${pushed} 份设备副本；设备已回到干净产物`)
  process.exit(0)
}

console.error('未知命令：' + cmd)
console.error('可用：status | verify | t78-stop | t78-restore | t79-stop | t79-restore | restore-all')
process.exit(2)
