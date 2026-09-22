// build-node-pty.mjs — 用 Android NDK 交叉编译 node-pty 原生模块（W-1）
//
// 实证基础（docs/PTY-RESEARCH-2026-09-21.md 附录 B）：
//   bionic libc 自 API 23 起原生提供 openpty/forkpty/ptsname/posix_openpt/
//   grantpt/unlockpt ⇒ 零 shim、零额外库；-lutil 必须删（bionic 无独立 libutil）。
//
// 输入：dsh-runtime-android/node_modules/node-pty（上游源码，pin 版本）
//       downloads/node-deb 里的 Termux node 头（node_api.h —— 与运行时同源）
// 输出：runtime 的 node-pty/prebuilds/android-<arch>/pty.node
//       （node-pty utils.loadNativeModule 的查找路径之一；
//        Android 上 process.platform==='android' ⇒ 目录名 android-<arch>）
//
// 实证（llvm-readelf）：openpty/forkpty/ptsname 全部 @LIBC；
//   NEEDED = libc++_shared.so + libm.so + libdl.so + libc.so（全是我们已有的库）。
// spawn-helper 不需要：pty.cc 里 helper_path 只在 __APPLE__ 分支使用，linux 走 forkpty。

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PTY_SRC = path.join(WS, 'dsh-runtime-android', 'node_modules', 'node-pty')
const NAPI_SRC = path.join(WS, 'dsh-runtime-android', 'node_modules', 'node-addon-api')
const OUT_DIR = path.join(WS, 'tmp', 'node-pty-build')

// node_api.h 来源：Termux node 头（与运行时同源，避免与宿主机 node 头 ABI 漂移）
const NODE_HEADER_CANDIDATES = [
  path.join(WS, 'downloads', 'node-deb', 'data', 'data', 'com.termux', 'files', 'usr', 'include', 'node'),
  path.join(WS, 'downloads', 'x86_64', 'extract', 'nodejs', 'data', 'data', 'com.termux', 'files', 'usr', 'include', 'node'),
]

// pin NDK 版本（风险缓释：版本漂移 → 构建期即失败）
const NDK_VERSION = '29.0.14033849'
const API_LEVEL = 28 // = app minSdk

// node-pty 的 process.platform 在 Android 上是 'android'（仓库多处已按此判据），
// 故 prebuilds 目录名 = android-<process.arch>
const ARCHES = {
  'android-arm64': { target: 'aarch64-linux-android', abi: 'arm64-v8a' },
  'android-x64': { target: 'x86_64-linux-android', abi: 'x86_64' },
}

function findNdk() {
  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk') ||
    'C:\\Users\\Administrator\\.android\\sdk'
  const ndkPath = path.join(sdkRoot, 'ndk', NDK_VERSION)
  if (!fs.existsSync(ndkPath)) {
    console.error(`✗ NDK ${NDK_VERSION} 不在 ${ndkPath}`)
    console.error(`  安装：sdkmanager "ndk;${NDK_VERSION}"`)
    process.exitCode = 1
    return null
  }
  return ndkPath
}

function findNodeHeaders() {
  for (const c of NODE_HEADER_CANDIDATES) {
    if (fs.existsSync(path.join(c, 'node_api.h'))) return c
  }
  return null
}

function main() {
  const ndk = findNdk()
  if (!ndk) return

  if (!fs.existsSync(PTY_SRC)) {
    console.error(`✗ node-pty 源码不在：${PTY_SRC}`)
    process.exitCode = 1
    return
  }
  if (!fs.existsSync(NAPI_SRC)) {
    console.error(`✗ node-addon-api 不在：${NAPI_SRC}`)
    process.exitCode = 1
    return
  }
  const nodeHeaders = findNodeHeaders()
  if (!nodeHeaders) {
    console.error('✗ 找不到 node_api.h（需要 Termux node 头）')
    console.error('  候选：\n    ' + NODE_HEADER_CANDIDATES.join('\n    '))
    process.exitCode = 1
    return
  }

  const toolchain = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin')
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const source = path.join(PTY_SRC, 'src', 'unix', 'pty.cc')
  if (!fs.existsSync(source)) {
    console.error(`✗ 源文件缺失：${source}`)
    process.exitCode = 1
    return
  }

  console.log(`  node-pty 源码：${PTY_SRC}`)
  console.log(`  node 头：${nodeHeaders}`)

  let failed = false
  for (const [prebuildDir, { target, abi }] of Object.entries(ARCHES)) {
    const clangxx = path.join(toolchain, `${target}${API_LEVEL}-clang++.cmd`)
    if (!fs.existsSync(clangxx)) {
      console.error(`✗ 编译器缺失：${clangxx}`)
      failed = true
      continue
    }
    const outDir = path.join(OUT_DIR, prebuildDir)
    fs.mkdirSync(outDir, { recursive: true })
    const outFile = path.join(outDir, 'pty.node')

    // 注意：不链 -lutil（bionic 无独立 libutil，openpty/forkpty 在 libc 内）
    const args = [
      '-shared',
      '-fPIC',
      '-O2',
      '-std=c++17',
      `-I${NAPI_SRC}`,
      `-I${nodeHeaders}`,
      source,
      '-o',
      outFile,
    ]

    console.log(`\n[${prebuildDir}] 编译 ${target}${API_LEVEL} …`)
    try {
      // Windows：NDK 的 clang 是 .cmd 批处理，且本仓库路径含空格
      // ⇒ 走 execSync + 逐参数引号（execFileSync+shell 会按空格拆路径）
      const q = (s) => `"${s}"`
      const cmd = [q(clangxx), ...args.map(q)].join(' ')
      execSync(cmd, { stdio: 'inherit' })
    } catch (e) {
      console.error(`✗ ${prebuildDir} 编译失败：${e?.message ?? e}`)
      failed = true
      continue
    }

    const size = fs.statSync(outFile).size
    console.log(`  ✓ ${prebuildDir} → ${outFile}（${(size / 1024).toFixed(1)} KB）`)

    // 部署进 runtime 的 prebuilds（node-pty utils.loadNativeModule 查找路径）
    const dstDir = path.join(PTY_SRC, 'prebuilds', prebuildDir)
    fs.mkdirSync(dstDir, { recursive: true })
    fs.copyFileSync(outFile, path.join(dstDir, 'pty.node'))
    console.log(`     部署 → ${path.join(dstDir, 'pty.node')}`)

    // 同步一份到 jniLibs（供 APK 随包分发，构建期回填）
    const jniDir = path.join(WS, 'android', 'app', 'src', 'main', 'jniLibs', abi)
    fs.mkdirSync(jniDir, { recursive: true })
    fs.copyFileSync(outFile, path.join(jniDir, 'libnode-pty.so'))
  }

  if (failed) {
    process.exitCode = 1
    return
  }
  console.log('\n✓ node-pty 双架构编译完成')
}

main()

