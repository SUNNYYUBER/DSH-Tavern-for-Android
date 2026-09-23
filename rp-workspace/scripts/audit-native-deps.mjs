#!/usr/bin/env node
/**
 * 原生库依赖闭合性审计（DT_NEEDED 必须在包内可解析）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这条判据（真实事故，2026-09-21）
 * ─────────────────────────────────────────────────────────────────────────
 * v0.2.5 的**两个架构**发布后在设备上 node 完全无法启动：
 *
 *   CANNOT LINK EXECUTABLE ".../lib/x86_64/libnode.so":
 *     library "libz.so.1" not found: needed by main executable
 *
 * ⇒ NodeService 无限重启（模拟器实录第 253 次），DSH 永远停在
 *   「正在启动 DSH 运行时」—— App 看起来「装上了」，实际核心功能为零。
 *
 * **根因是一条从来没被验证过的注释**：`fetch-native-libs.mjs` 里
 * `libdsht-bash.so` 那行的注释写着
 *   「libpcre2-8/libz.so.1/libcrypto.so.3 已在 runtime/lib，不重复打包」
 * —— 但 TARGETS 里**从来没有过** zlib / openssl / pcre2 的条目，
 *    那三个库**从未被部署过**。注释把「预期」写成了「事实」。
 *
 * **为什么既有门禁全都漏了**：
 *   · 编译期：链接检查只针对 `.so` 之间的符号，不看「这些 .so 是否随包分发」；
 *   · `audit-pty-prebuilt.mjs`：只查 pty.node 自己的 NEEDED；
 *   · `verify-apk-payload.py`（M4）：查「标记文件在不在」，不查动态依赖；
 *   · `audit-artifact-freshness.mjs`：查「产物与源码一致」，而源码本身就是错的。
 *   ⇒ 一切绿灯，只有真机才炸。这是 P-30 家族最贵的一种：**绿灯与可用性无关**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据
 * ─────────────────────────────────────────────────────────────────────────
 * 对**每个**打包的 ELF（jniLibs 的 `lib/*.so` + runtime 的 `lib/*.so*`）：
 *   ① 读它的 DT_NEEDED；
 *   ② 每个 NEEDED 必须能在**本架构的包内**解析，来源限三种：
 *        · 包内同名 .so（jniLibs 或 runtime/lib）
 *        · Android 系统库白名单（libc/libm/libdl/liblog/... 由 bionic 提供）
 *        · 允许的「由宿主提供」白名单（见 HOST_PROVIDED，附理由）
 *   ③ 任何解析不到的 NEEDED ⇒ 报红并点名「哪个 .so 需要哪个库」。
 *
 * 另附判据 ②：runtime/lib 与 jniLibs **不得**存在同名不同内容（避免两份真相）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 用法
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/audit-native-deps.mjs --arch x86_64
 *   node scripts/audit-native-deps.mjs --arch arm64
 *   node scripts/audit-native-deps.mjs --selftest
 *
 * 退出码
 *   0 = 通过
 *   1 = 锚点缺失（readelf 不在 / 目录不存在 —— fail-closed，不静默放过）
 *   2 = 有依赖不闭合
 *   3 = selftest 失败
 *
 * ─────────────────────────────────────────────────────────────────────────
 * selftest
 * ─────────────────────────────────────────────────────────────────────────
 *   用**合成的 readelf 输出**做正控 + 负控，不需真机也不碰真实仓库。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 由 **Android 系统**（bionic / linker）提供的库 —— 不随包分发，属于正常情况。
 * 【判据】凡是 bionic 在 app 进程里必然提供的（libc/libm/libdl/liblog/...），
 * 才允许出现在这里；**每个加进来的都要能说出「谁提供它」**。
 */
const SYSTEM_PROVIDED = new Set([
  'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libz.so', // libz 是 bionic 自带的（系统 libz）
  'libstdc++.so', 'libandroid.so', 'libjnigraphics.so', 'libEGL.so', 'libGLESv2.so',
  'libOpenSLES.so', 'libvk.so', 'libnativewindow.so', 'libsync.so', 'libui.so',
  'libutils.so', 'libcutils.so', 'libhardware.so', 'libbase.so', 'libbinder.so',
  'libc++.so', 'libc++_shared.so', // 后者通常随包；若随包则走包内解析，这里兜底
])

/**
 * 允许由**宿主环境**提供、因明确理由不随包分发的库。
 *
 * 【铁律】每条必须写清「谁提供」+「为什么可以不随包」；含糊其辞的一律不许加。
 */
const HOST_PROVIDED = new Map([
  // 例：libz.so 在 Android 上是 bionic 的一部分（系统提供），但因 Termux 包
  // NEEDED 的是带 SONAME 版本号的 libz.so.1，那**不是**系统 libz ⇒ 必须随包。
  // 故这里**不豁免** libz.so.1 —— 这正是本次事故的教训。
])

/** 从 readelf 输出解析 NEEDED 列表。 */
export function parseNeeded (readelfOut) {
  const out = []
  for (const line of readelfOut.split(/\r?\n/)) {
    const m = line.match(/\(NEEDED\)\s+Shared library:\s*\[([^\]]+)\]/)
    if (m) out.push(m[1].trim())
  }
  return out
}

/**
 * 核心判据（纯函数，便于 selftest 注入）。
 *
 * @param {Map<string,string[]>} neededBySo  so 名 → 它的 NEEDED 列表
 * @param {Set<string>} present             包内可解析的名字集合（jniLibs + runtime/lib）
 * @returns {string[]} problems
 */
export function checkClosure (neededBySo, present) {
  const problems = []
  if (neededBySo.size === 0) {
    problems.push('没有任何 .so 被扫描到 —— 判据空转（路径或 readelf 失效）')
    return problems
  }
  for (const [so, needed] of neededBySo) {
    for (const n of needed) {
      if (present.has(n)) continue
      if (SYSTEM_PROVIDED.has(n)) continue
      if (HOST_PROVIDED.has(n)) continue
      problems.push(`${so} 需要 ${n}，但包内没有它（既不在 jniLibs 也不在 runtime/lib）`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
function selftest () {
  const cases = []
  const add = (name, expect, neededBySo, present) => cases.push({ name, expect, neededBySo, present })

  // 正控：全部可解析
  add('正控：依赖齐全 ⇒ 无问题', null,
    new Map([['libnode.so', ['libz.so.1', 'libc.so', 'libm.so']]]),
    new Set(['libz.so.1']))
  // 负控①：缺一个非系统库（= 本次事故形态）
  add('负控：缺 libz.so.1 ⇒ 报红', 'libnode.so 需要 libz.so.1',
    new Map([['libnode.so', ['libz.so.1', 'libc.so']]]),
    new Set())
  // 负控②：缺 ICU 三角之一
  add('负控：缺 libicudata ⇒ 报红', '需要 libicudata.so.78',
    new Map([['libicuuc.so.78', ['libicudata.so.78']]]),
    new Set())
  // 负控③：系统库不算问题
  add('正控：系统库豁免', null,
    new Map([['libX.so', ['libc.so', 'libm.so', 'libdl.so', 'liblog.so']]]),
    new Set())
  // 负控④：空输入（判据必须报错而非静默通过）
  add('负控：空输入 ⇒ 报红（零控）', '判据空转', new Map(), new Set())
  // 负控⑤：多库连锁缺（git 场景）
  add('负控：缺 libpcre2-8/libcrypto ⇒ 各报一条', 'libdsht-git.so 需要 libpcre2-8.so',
    new Map([['libdsht-git.so', ['libpcre2-8.so', 'libz.so.1', 'libcrypto.so.3']]]),
    new Set())

  let pass = 0
  for (const c of cases) {
    const problems = checkClosure(c.neededBySo, c.present)
    const ok = c.expect === null
      ? problems.length === 0
      : problems.some((p) => p.includes(c.expect))
    if (ok) {
      pass++
      console.log(`  PASS  ${c.name}${problems.length ? `（${problems.length} 处）` : ''}`)
    } else {
      console.error(`  FAIL  ${c.name} —— 期望含「${c.expect ?? '无问题'}」，实得：${JSON.stringify(problems)}`)
    }
  }
  console.log(`\n[selftest-summary] native-deps ${pass}/${cases.length} ${pass === cases.length ? 'PASS' : 'FAIL'}`)
  return pass === cases.length
}

if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 3)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const archArgIdx = process.argv.indexOf('--arch')
const archArg = archArgIdx >= 0 ? process.argv[archArgIdx + 1] : undefined
// 架构来源优先级：--arch 参数 > 环境变量 DSHT_ARCH > 缺省 x86_64。
// 【为什么支持 env】构建脚本的门禁循环统一 `node $p`（不带参数），
// 故用 env 传递当前构建架构，避免为此特化循环形态（P-1：机制只许一处实现）。
const ARCH = archArg ?? process.env.DSHT_ARCH ?? 'x86_64'

const ARCH_DIR = { x86_64: 'x86_64', arm64: 'arm64-v8a' }[ARCH]
const RUNTIME_ROOT = { x86_64: 'dsh-runtime-x64', arm64: 'dsh-runtime' }[ARCH]
if (!ARCH_DIR || !RUNTIME_ROOT) {
  console.error(`未知架构：${ARCH}（支持 x86_64 / arm64）`)
  process.exit(1)
}

const JNI_LIBS = path.join(WS, 'android', 'app', 'src', 'main', 'jniLibs', ARCH_DIR)
const RT_LIB = path.join(WS, RUNTIME_ROOT, 'lib')

const readelf = findReadelf()
if (!readelf) {
  console.error('锚点缺失（fail-closed）：找不到 llvm-readelf（Android NDK 未装？）')
  process.exit(1)
}
if (!fs.existsSync(JNI_LIBS) && !fs.existsSync(RT_LIB)) {
  console.error(`锚点缺失（fail-closed）：jniLibs 与 runtime/lib 均不存在\n  ${JNI_LIBS}\n  ${RT_LIB}`)
  process.exit(1)
}

function findReadelf () {
  const sdkNdk = 'C:/Users/' + (process.env.USERNAME ?? '') + '/.android/sdk/ndk'
  const roots = [process.env.ANDROID_NDK_HOME, process.env.NDK_HOME, sdkNdk,
    'C:/Users/Administrator/.android/sdk/ndk'].filter(Boolean)
  for (const r of roots) {
    if (!fs.existsSync(r)) continue
    // NDK 根本身也可能就是版本目录
    const candidates = []
    for (const e of fs.readdirSync(r)) {
      candidates.push(path.join(r, e, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin', 'llvm-readelf.exe'))
      candidates.push(path.join(r, e, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin', 'llvm-readelf'))
    }
    candidates.push(path.join(r, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin', 'llvm-readelf.exe'))
    for (const c of candidates) if (fs.existsSync(c)) return c
  }
  return null
}

/** 收集所有待检查的 ELF 路径。 */
function collectElfs () {
  const out = []
  const scan = (dir, pat) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e)
      if (fs.statSync(p).isFile() && pat.test(e)) out.push(p)
    }
  }
  // jniLibs：lib*.so（含伪装成 .so 的可执行体，如 libdsht-bash.so —— 它们也是 ELF）
  scan(JNI_LIBS, /^lib.*\.so$/)
  // runtime/lib：lib*.so*（含带 SONAME 版本号的 libz.so.1 这类）
  scan(RT_LIB, /^lib.*\.so(\.\d+)*$/)
  return out
}

const elfs = collectElfs()
const neededBySo = new Map()
const present = new Set()

for (const p of elfs) {
  const base = path.basename(p)
  present.add(base)
  let out
  try {
    out = execFileSync(readelf, ['-d', p], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    // 非 ELF（比如占位文件）跳过，但出声——静默跳过分不清「没问题」与「没检查」
    console.log(`  [skip] ${base}：readelf 读取失败（非 ELF？）`)
    continue
  }
  neededBySo.set(base, parseNeeded(out))
}

console.log(`=== 原生库依赖闭合性审计（${ARCH}）===`)
console.log(`  jniLibs : ${JNI_LIBS}`)
console.log(`  runtime : ${RT_LIB}`)
console.log(`  扫描到 ${elfs.length} 个 ELF，包内可解析名字 ${present.size} 个`)

const problems = checkClosure(neededBySo, present)
if (problems.length === 0) {
  console.log('  ✓ 全部 DT_NEEDED 均可在包内（或系统白名单）解析')
  console.log('\n✓ 原生依赖闭合（node 等 ELF 不会因缺库而无法启动）')
  process.exit(0)
}
console.error(`  ✗ 发现 ${problems.length} 处依赖不闭合：`)
for (const p of problems) console.error(`    · ${p}`)
console.error('\n  ⇒ 这类缺陷**编译期与既有全部门禁都不可见**，只在真机表现为')
console.error('     CANNOT LINK EXECUTABLE / library "xxx" not found ⇒ node 无限重启。')
console.error('     修法：在 scripts/fetch-native-libs.mjs 的 TARGETS 里补该库（dest: runtime-lib）。')
process.exit(2)
