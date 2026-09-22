#!/usr/bin/env node
/**
 * verify-apk-runtime-version.mjs —— APK 内嵌 runtime 的版本与**数据兼容形态**核验
 * ============================================================================
 * 【为什么需要它】（GOAL §七 R21 / §11.1 W25）
 *
 * `build-dsht.ps1` 的 `-DshVersion` 决定整棵 runtime 的代次，而**源码改了 ≠ 产物里对**
 * （R5）。第二十七轮 W24c 的教训是：命令行的版本、仓库声明的版本、APK 里真正嵌进去的
 * 版本、设备上正在跑的版本 —— **这是四个可能互不相同的东西**，而当时没有任何判据
 * 把它们对齐过。其中「APK 里真正嵌的是什么」这条**只能从产物读**（读源码/读配置都不算）。
 *
 * 本探针读 **APK → assets/dsh-runtime.zip → 里面各包的 package.json**，
 * 并抽出 `dsh-session` 的 `isReplaceOp` 字段名（★ 决定既有会话能否被读出的那个事实）。
 *
 * 【与 `audit-dsh-version.mjs` 的分工】（P-1：各有明确边界，不重叠）
 *   · `audit-dsh-version.mjs`    —— **仓库态**：单源 / 构建目录 / 设备 三者一致（构建期跑）
 *   · `verify-apk-runtime-version.mjs` —— **产物态**：APK 里真正嵌进去的是什么（交付前跑）
 *
 * 用法：
 *   node rp-workspace/scripts/verify-apk-runtime-version.mjs            # 核两个 APK
 *   node rp-workspace/scripts/verify-apk-runtime-version.mjs --arch arm64
 *   node rp-workspace/scripts/verify-apk-runtime-version.mjs --selftest  # 判据自证
 *   node rp-workspace/scripts/verify-apk-runtime-version.mjs --device --expect-str "<本次新增特征串>"
 *        # ↑ R22③：核「**设备上跑的是不是本次产物**」（装完 APK、跑设备探针之前跑）
 * 退出码：0 = 两包一致且与单源声明一致；1 = 不一致；2 = 文件缺失；3 = selftest 失败
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')          // rp-workspace
const ROOT = path.resolve(WS, '..')          // 仓库根（APK 落在这里）
const SSOT = path.join(WS, 'dsh-version.json')

/**
 * 极简 zip 读取器（只读中央目录；够用且零依赖）。支持 store(0) 与 deflate(8)。
 * APK 内嵌的 runtime.zip 是**嵌套 zip** ⇒ 本函数要能被调用两层。
 */
export function readZipEntries (buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('未找到 EOCD（不是 zip？）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    // 本地头的 name/extra 长度可能与中央目录不同 ⇒ 按本地头读数据起点
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    out.set(name, { method, raw: buf.subarray(dataStart, dataStart + compSize) })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 读嵌套 zip 里的一个文本条目；不存在返回 null。 */
export function readNestedText (zipBuf, entryName) {
  const entries = readZipEntries(zipBuf)
  const e = entries.get(entryName)
  if (!e) return null
  const data = e.method === 0 ? e.raw : zlib.inflateRawSync(e.raw)
  return data.toString('utf8')
}

/**
 * 从 dsh-session 的**产物源码**里抽 `isReplaceOp` 要求的字段名集合。
 * 与 `audit-dsh-version.mjs` 的同名逻辑一致（**同一判据的产物侧形态**）——
 * 刻意不抽成共享模块：两支探针各自独立可跑（一个在仓库态、一个在产物态），
 * 共享会引入「谁依赖谁」的问题。**判据口径必须一致**，改动时两处同步。
 */
export function parseReplaceOpFields (src) {
  const m = /function isReplaceOp\s*\([^)]*\)\s*\{([\s\S]{0,2000}?)\n\}/.exec(src)
  if (m === null) return { fields: null, evidence: '未找到 isReplaceOp 函数' }
  const body = m[1]
  const keys = []
  for (const mm of body.matchAll(/(?:hasOwn|hasOwnProperty\s*\.\s*call)\s*\(\s*[^,)]+,\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) keys.push(mm[1])
  for (const mm of body.matchAll(/\[["']([A-Za-z_][A-Za-z0-9_]*)["']\]/g)) keys.push(mm[1])
  const uniq = [...new Set(keys)]
  if (uniq.length === 0 || !uniq.includes('op')) return { fields: null, evidence: `键位置未抽到（实得：${uniq.join(',') || '（无）'}）` }
  const rest = uniq.filter(x => x !== 'op')
  if (rest.length !== 2) return { fields: null, evidence: `应为三键，实得 ${uniq.length} 个：${uniq.join(',')}` }
  return { fields: ['op', ...rest], evidence: `isReplaceOp 要求 ${['op', ...rest].join(' / ')}` }
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let pass = 0
  const fails = []
  const ok = (c, label) => { if (c) { pass += 1; console.log(`[ok] ${label}`) } else { fails.push(label); console.log(`[FAIL] ${label}`) } }
  console.log('=== verify-apk-runtime-version --selftest ===')

  // zip 读写自证：造一个内存 zip（store 方式）再读回
  //
  // 【判据自身的坑（P-19/P-30）· 合成夹具写错，自证当场抓到】
  // 首版把 EOCD 的「中央目录起始偏移」写成 0，而真实值应是 `local + name + data` 的长度
  // ⇒ 读取器从偏移 0 处找不到中央目录签名 ⇒ 返回空 Map ⇒ 正控 1/2 报 FAIL。
  // **这正是 P-30 要的**：合成正控若不自洽，会给出「被测物坏了」的**假象**
  //（实际是夹具坏了）。⇒ 修法：偏移 = 本地头段总长。
  const mkZip = (name, content) => {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12)
    local.writeUInt32LE(0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(0, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38)
    // ★ 关键：本地头在文件中的起始偏移（本 zip 只有一条，故为 0）
    cd.writeUInt32LE(0, 42)
    const cdBuf = Buffer.concat([cd, nameBuf])
    const cdStart = local.length + nameBuf.length + data.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(cdBuf.length, 12)
    eocd.writeUInt32LE(cdStart, 16)   // ★ 中央目录起始偏移（首版错写成 0）
    return Buffer.concat([local, nameBuf, data, cdBuf, eocd])
  }

  const z = mkZip('hello.txt', 'world')
  const entries = readZipEntries(z)
  ok(entries.has('hello.txt'), `正控 zip 读取器能列出条目（实得 ${[...entries.keys()].join(',')}）`)
  ok(readNestedText(z, 'hello.txt') === 'world', '正控 能读回内容')
  ok(readNestedText(z, 'missing.txt') === null, '负控 缺条目 ⇒ null（不抛）')

  // 判据自证（与 audit-dsh-version 同口径）
  const cur = parseReplaceOpFields('function isReplaceOp(v) {\n\treturn Object.hasOwn(v, "op") && Object.hasOwn(v, "startSeq") && Object.hasOwn(v, "endSeq");\n}')
  ok(cur.fields !== null && cur.fields.join(',') === 'op,startSeq,endSeq', `正控 抽出 0.1.5 形态 ${JSON.stringify(cur.fields || cur.evidence)}`)
  const old = parseReplaceOpFields('function isReplaceOp(v) {\n\treturn Object.hasOwn(v, "op") && Object.hasOwn(v, "start") && Object.hasOwn(v, "end");\n}')
  ok(old.fields !== null && old.fields.join(',') === 'op,start,end', `正控 抽出 0.1.2 形态 ${JSON.stringify(old.fields || old.evidence)}`)
  ok(cur.fields !== null && old.fields !== null && cur.fields.join(',') !== old.fields.join(','), '★杠杆 两代形态判为不同（有区分力）')
  ok(parseReplaceOpFields('function isOther(v) { return 1 }').fields === null, '负控 函数改名 ⇒ null（测不出，非通过）')

  console.log(`\n[verify-apk-runtime-version selftest] ${pass}/${pass + fails.length} PASS`)
  // ★ W44：统一自证输出契约（**必须在本函数内** —— `--selftest` 分支会早退）
  reportSelftest('apk-runtime-version', pass, pass + fails.length)
  if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(3) }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const archArg = (() => {
  const i = process.argv.indexOf('--arch')
  return i >= 0 ? process.argv[i + 1] : null
})()

// 【App 版本单源】与 build-dsht.ps1 同款口径：从 `android/app/build.gradle.kts` 的
// `versionName` 实读，**不在本文件里另写一份**。由头：此前这里硬编码 `0.2.2`，与 gradle
// 的 versionName 是两个字面量 ⇒ 发版时会出现「文件名 0.2.2 / 包内 0.2.3」的错配，
// 而构建与核验**全绿**（核验读的是旧名文件，根本核不到新产物 —— P-30 静默族）。
const gradleKts = path.join(ROOT, 'rp-workspace', 'android', 'app', 'build.gradle.kts')
let appVersion = null
try {
  appVersion = /versionName\s*=\s*"([^"]+)"/.exec(fs.readFileSync(gradleKts, 'utf8'))?.[1] ?? null
} catch { /* 缺失时下方以明确错误终止 */ }
if (appVersion === null) {
  console.error(`无法从 ${gradleKts} 读出 versionName（app 版本单源）`)
  process.exit(2)
}

const ALL_APKS = [
  { arch: 'arm64', file: path.join(ROOT, `DSH-Tavern-${appVersion}-arm64-release.apk`) },
  { arch: 'x86_64', file: path.join(ROOT, `DSH-Tavern-${appVersion}-x86_64-debug.apk`) },
]
const targets = archArg === null ? ALL_APKS : ALL_APKS.filter(a => a.arch === archArg)
if (targets.length === 0) { console.error(`--arch 只能是 arm64 / x86_64（实得 ${archArg}）`); process.exit(2) }

// 单源（用于比对；缺失不致命，但会出声）
// ⚠️ 必须**容忍 BOM**（W28）：该文件是「PS 与 node 共读」的跨读者单源 ——
//   PS 5.1 默认编码对**无 BOM** 的中文 JSON 会解析失败（故文件必须带 BOM），
//   而 node 的 `JSON.parse` 对**带 BOM** 的文本会抛 `Unexpected token '\uFEFF'`。
//   两侧要求相反 ⇒ 文件带 BOM + node 侧剥离。与 audit-dsh-version.mjs 同源修法（P-1）。
let ssot = null
if (fs.existsSync(SSOT)) {
  try {
    const raw = fs.readFileSync(SSOT, 'utf8')
    ssot = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
  } catch { /* 忽略 */ }
}

console.log('[verify-apk-runtime-version] APK 内嵌 runtime 版本核验\n')

const results = []
let missing = 0
for (const t of targets) {
  if (!fs.existsSync(t.file)) { console.log(`ⓘ ${t.arch}：APK 不存在（${path.basename(t.file)}）—— 跳过，不冒充通过`); missing += 1; continue }
  const apk = fs.readFileSync(t.file)
  let rzKey = null
  for (const k of readZipEntries(apk).keys()) if (/runtime\.zip$/.test(k)) { rzKey = k; break }
  if (rzKey === null) { console.log(`✗ ${t.arch}：APK 内未找到 assets/dsh-runtime.zip`); results.push({ arch: t.arch, ok: false }); continue }
  const apkEntries = readZipEntries(apk)
  const rz = apkEntries.get(rzKey)
  const rzBuf = rz.method === 0 ? Buffer.from(rz.raw) : zlib.inflateRawSync(rz.raw)

  const dshPkg = readNestedText(rzBuf, 'node_modules/@deepseek-ai/dsh/package.json')
  const sesPkg = readNestedText(rzBuf, 'node_modules/@deepseek-ai/dsh-session/package.json')
  const sesIdx = readNestedText(rzBuf, 'node_modules/@deepseek-ai/dsh-session/lib/index.js')
  let dshVer = null; let sesVer = null
  try { dshVer = dshPkg ? JSON.parse(dshPkg).version : null } catch { /* 忽略 */ }
  try { sesVer = sesPkg ? JSON.parse(sesPkg).version : null } catch { /* 忽略 */ }
  const parsed = sesIdx ? parseReplaceOpFields(sesIdx) : { fields: null, evidence: '未找到 dsh-session/lib/index.js' }

  const lines = [
    `  主包 @deepseek-ai/dsh        = ${dshVer ?? '（读不到）'}`,
    `  子包 @deepseek-ai/dsh-session = ${sesVer ?? '（读不到）'}`,
    `  数据兼容形态（isReplaceOp）   = ${parsed.fields ? parsed.fields.join(' / ') : '**测不出**：' + parsed.evidence}`,
    `  runtime.zip                  = ${(rzBuf.length / 1024 / 1024).toFixed(1)} MB`,
  ]
  let ok = true
  const issues = []
  if (ssot !== null) {
    if (dshVer !== null && dshVer !== ssot.dshVersion) { ok = false; issues.push(`主包版本与单源不一致：APK=${dshVer} 单源=${ssot.dshVersion}`) }
    if (parsed.fields !== null && Array.isArray(ssot.sessionReplaceOpFields)) {
      const a = [...parsed.fields].sort().join(','); const b = [...ssot.sessionReplaceOpFields].sort().join(',')
      if (a !== b) { ok = false; issues.push(`数据兼容形态与单源不一致：APK=[${a}] 单源=[${b}] ⇒ 装出去既有会话可能打不开`) }
    }
    if (parsed.fields === null) { ok = false; issues.push(`数据兼容形态测不出（${parsed.evidence}）—— 不许静默放过`) }
  } else {
    lines.push('  ⓘ 单源 dsh-version.json 不可读 ⇒ 本次只报读数、不做比对')
  }
  console.log(`${ok ? '✓' : '✗'} ${t.arch}（${path.basename(t.file)}）`)
  for (const l of lines) console.log(l)
  for (const i of issues) console.log(`    ⛔ ${i}`)
  console.log('')
  results.push({ arch: t.arch, ok, dshVer, sesVer, fields: parsed.fields })
}

// ---------------------------------------------------------------------------
// R22③ 配套判据：**设备侧 runtime 是否与本次产物一致**（`--device` 才跑）
// ---------------------------------------------------------------------------
//
// ## 为什么必须单独守（第二十八轮 W14 实测踩到）
// 覆盖安装靠 `RUNTIME_SENTINEL` 比对决定**是否重新解压** runtime.zip。
// 本轮改了前端 client（`style.ts`）后**忘了抬 sentinel** ⇒ 装了新 APK，
// 而设备上跑的还是**旧 client** ⇒ 设备实测**测的是上一版代码**，
// 探针如实报告「修复未生效」⇒ 把一次**装置失误**误读成**产品修复失败**。
//
// ### 识别特征（下次能一眼认出）
//   · 本探针（产物层）**全绿**；
//   · 设备上的同一文件**字节数与产物不一致**，且**新增内容的特征串命中 0**；
//   · 设备行为与「修复前」完全相同。
// 三者同时成立 ⇒ 优先怀疑「设备没换 runtime」，而不是「修复无效」。
//
// ## 判据
// 取设备侧 `dsh-runtime/node_modules/dsht-rp-plugin/lib/client.js` 与
// runtime 源目录（`dsh-runtime-android/node_modules/...`）**同路径**比对字节数，
// 并抽查一个「本次新增」的特征串（由 `--expect-str` 给出，可多次传）。
// 字节数一致 **且** 特征串命中 ⇒ 一致；否则报红（fail-closed）。
//
// ## 为什么**不**接进构建脚本（边界说明 —— 设计判断，非遗漏）
// 构建期的设备上装的是**上一个 APK**（新包刚打出来还没装）⇒「设备与产物一致」
// 在那一刻**本来就不成立**，接进去只会得到必然的假红。
// ⇒ 本检查的正确调用时机是「**装完 APK、跑设备探针之前**」：
//     node scripts/verify-apk-runtime-version.mjs --device --expect-str "<本次新增的特征串>"
//   与 Step 0.7（仓库态+设备）· Step 6.5（产物态）互不重叠，各自时机不同（P-1）。
function deviceRuntimeCheck () {
  const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}\\.android\\sdk\\platform-tools\\adb.exe`
  const PKG = 'com.dshtavern.app'
  const REL = 'dsh-runtime/node_modules/dsht-rp-plugin/lib/client.js'
  const LOCAL = path.join(WS, 'dsh-runtime-android', 'node_modules', 'dsht-rp-plugin', 'lib', 'client.js')
  if (!fs.existsSync(LOCAL)) { console.log(`ⓘ --device：本地产物不存在（${LOCAL}），跳过`); return null }
  const local = fs.readFileSync(LOCAL)
  const localSize = local.length

  // 【装置自身的坑（P-30）· 不要用 `sh -c "wc -c < 文件"`】
  // 实测经 `adb shell → run-as → sh -c` 转发后**重定向被吞**，stdout 空 ⇒ 读成「设备未装」
  // （与本轮 W18 的「多层转发改变命令语义」同一族）。
  // ⇒ 改用**已验证可靠**的 `exec-out cat` 把文件取回本地比对（2.6MB，代价可接受）。
  const expectStrs = []
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--expect-str') expectStrs.push(process.argv[i + 1])

  console.log('\n[R22③] 设备侧 runtime 与本次产物一致性：')
  const r = spawnSync(ADB, ['exec-out', 'run-as', PKG, 'cat', `/data/data/${PKG}/files/${REL}`],
    { maxBuffer: 256 * 1024 * 1024 })
  if (r.error) { console.log(`  ⓘ 取回失败：${r.error.message} —— 跳过，不冒充通过`); return null }
  const dev = r.stdout ?? Buffer.alloc(0)
  if (dev.length === 0) { console.log('  ⓘ 读不到设备侧文件（App 未装 / 未解压过）—— 跳过，不冒充通过'); return null }

  console.log(`  本地产物 ${localSize} B · 设备 ${dev.length} B`)
  let ok = localSize === dev.length
  if (!ok) console.log('  ⛔ 字节数不一致 ⇒ 设备上跑的不是本次产物（**先抬 RUNTIME_SENTINEL 再装**，见 GOAL §七 R22③）')

  const t = dev.toString('utf8')
  for (const s of expectStrs) {
    if (!s) continue
    const n = t.split(s).length - 1
    console.log(`  特征串 ${JSON.stringify(s.slice(0, 40))} 命中 ${n} 处`)
    if (n === 0) { ok = false; console.log('  ⛔ 该特征串在设备侧命中 0 ⇒ 本次修复**没进设备**') }
  }
  console.log(`  ${ok ? '✓' : '✗'} 设备 runtime 与产物${ok ? '一致' : '**不一致**'}`)
  return ok
}

// 双包一致性（两架构必须同代次 —— 守 R11「sentinel 两包一致」的同族要求）
if (results.length === 2 && results.every(r => r.ok)) {
  const same = results[0].dshVer === results[1].dshVer && JSON.stringify(results[0].fields) === JSON.stringify(results[1].fields)
  console.log(`${same ? '✓' : '✗'} 双架构一致性：${same ? '两包同代次、同数据形态' : `**不一致**（${results[0].arch}=${results[0].dshVer} vs ${results[1].arch}=${results[1].dshVer}）`}`)
  if (!same) results.push({ arch: 'both', ok: false })
}

// R22③：设备侧一致性（仅在 `--device` 时跑 —— 需要设备可达）
let deviceOk = null
if (process.argv.includes('--device')) {
  deviceOk = deviceRuntimeCheck()
  if (deviceOk === false) results.push({ arch: 'device', ok: false })
}

const bad = results.filter(r => !r.ok)
if (bad.length) {
  console.log(`\n⛔ ${bad.length} 项未通过（fail-closed）：${bad.map(b => b.arch).join(', ')}`)
  process.exit(1)
}
console.log(`\n✅ APK 内嵌 runtime 版本与数据兼容形态核验通过${missing ? `（${missing} 个 APK 不存在，已跳过）` : ''}${deviceOk === true ? ' · 设备侧 runtime 与产物一致' : ''}`)
process.exit(0)
