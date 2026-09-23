/**
 * fetch-native-libs.mjs —— **原生库获取**（构建前置；双架构）
 * ============================================================================
 * 【为什么有这个脚本】`jniLibs/<abi>/*.so`（14 个、约 100MB）此前**直接入库**。
 * 但它们的**全部**来源都是 Termux 官方源的 deb 包，且其中两个是 **GPLv2**
 * （proot / busybox）：
 *
 *   libnode.so        ← nodejs_{arch}.deb        · MIT
 *   libproot.so       ← proot_5.1.107.92_{arch}.deb   · **GPLv2**
 *   libbusybox.so     ← busybox_1.38.0-1_{arch}.deb   · **GPLv2**
 *   libcares.so       ← c-ares_1.34.8_{arch}.deb · MIT
 *   libc++_shared.so  ← libc++_29_{arch}.deb     · Apache-2.0 WITH LLVM-exception
 *   libffi.so         ← libffi_3.5.2_{arch}.deb  · MIT
 *   libsqlite3.so     ← libsqlite_3.53.4_{arch}.deb   · Public Domain
 *
 * ★ 本脚本把它们改成**构建期从上游获取** ⇒ 本仓库**不再分发**任何第三方二进制
 *   ⇒ 我方**不承担** GPL 的再分发义务 ⇒ 本项目的 MIT 许可**不受影响**。
 *   （法律说明：即便入库，proot/busybox 也是以**独立可执行程序**被 exec 调用、
 *   属「单纯聚合」，同样不构成衍生作品；改为构建期获取是为了**仓库纯净**，
 *   而不是因为入库不合法 —— 见 docs/THIRD_PARTY_LICENSES.md。）
 *
 * ## 用法
 *   node scripts/fetch-native-libs.mjs                 # 补齐双架构缺失项
 *   node scripts/fetch-native-libs.mjs --arch x86_64
 *   node scripts/fetch-native-libs.mjs --check         # 只检查，不下载（CI / 构建前置）
 *   node scripts/fetch-native-libs.mjs --force         # 强制重新提取
 *
 * ## 退出码
 *   0 = 全部就绪（或已存在而跳过）      1 = 有缺失且无法补齐（fail-closed）
 *   2 = selftest 失败
 *
 * ## 行为
 *   ① 目标是「**幂等补齐**」：已存在且大小合理的 .so 一律跳过（本机开发零开销）；
 *   ② deb 来源优先用本机缓存 `downloads/`（含 `downloads/proot/`），缺失才联网；
 *   ③ **每个 deb 都做 SHA256 校验**（表见下）—— 来源链可追溯，防上游被替换；
 *   ④ 校验失败 / 下载失败 ⇒ **报错退出 1**，绝不静默跳过（P-3：静默失败禁止）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const JNI = path.join(WS, 'android', 'app', 'src', 'main', 'jniLibs')
const CACHE = [
  path.join(WS, 'downloads', 'proot'),
  path.join(WS, 'downloads'),
]

// ---------------------------------------------------------------------------
// 目标表：部署文件名 ← deb（**每架构显式声明**，不给默认值 —— 上游命名不统一，
//   隐式回退会静默取错架构的文件，P-45）← deb 内 relative 路径
//   ★ 内部路径用**相对片段**匹配（递归找 basename），不锚死绝对布局 ——
//     上游 deb 布局变化时会**报错而不是静默取错文件**（P-45）。
// 部署面（dest）：
//   'jni'        → jniLibs/<abi>/（默认；APK nativeLibraryDir，lib*.so 伪装名也可 exec）
//   'runtime-lib'→ dsh-runtime-android/lib/（runtime.zip 随包；LD_LIBRARY_PATH 已含）
//   'runtime-bin'→ dsh-runtime-android/bin/（runtime.zip 随包；PATH 已含，NodeService env）
//   'git-core'   → dsh-runtime-android/git-core/（git 的 libexec；GIT_EXEC_PATH 指向）
// ---------------------------------------------------------------------------
const TARGETS = [
  // 【W-F 2026-09-21】libnode 改 asset 直取：Termux nodejs ≥26.4.0-1 起 deb 改静态链接
  // bin/node、**不再含 libnode.so**（控制包 Version: 26.4.0-1 实证）——deb 通道对
  // libnode 已永久失效。asset = 本仓 release `native-cache-v1` 托管的、历版 APK 实际
  // 在用的 libnode.so（MIT；SHA256 钉在下表）。deb 字段保留仅为档案记录。
  { so: 'libnode.so', deb: { x86_64: 'nodejs_x86_64.deb', aarch64: 'nodejs_aarch64.deb' }, inner: 'lib/libnode.so', lic: 'MIT',
    asset: { x86_64: 'libnode-x86_64.so', aarch64: 'libnode-arm64.so' } },
  // 【W-1 2026-09-21】node 头（构建期依赖，不进 APK）：node-pty 交叉编译要 node_api.h，
  // 而它只随 Termux nodejs deb 分发；本仓 downloads/ 被 gitignore ⇒ CI 净环境缺它
  // ⇒ build-node-pty.mjs 报「✗ 找不到 node_api.h」⇒ 构建链断（v0.2.3 的 CI 实测）。
  // 与上面 libnode 用**同一个 deb**（该 deb 已不含 libnode.so，但 include/node 仍在），
  // 走 dir 型：解出 `usr/include/node/` 平铺到部署目录。
  // ★ 头与架构无关 ⇒ 两轮 arch 循环产出同一份（第二次 destReady 命中即跳过，幂等）。
  { dir: true, deb: { x86_64: 'nodejs_x86_64.deb', aarch64: 'nodejs_aarch64.deb' }, inner: 'include/node', dest: 'node-headers', lic: 'MIT' },
  { so: 'libproot.so', deb: { x86_64: 'proot_5.1.107.92_x86_64.deb', aarch64: 'proot_5.1.107.92_aarch64.deb' }, inner: 'bin/proot', lic: 'GPLv2' },
  { so: 'libbusybox.so', deb: { x86_64: 'busybox_1.38.0-1_x86_64.deb', aarch64: 'busybox_1.38.0-1_aarch64.deb' }, inner: 'bin/busybox', lic: 'GPLv2' },
  { so: 'libcares.so', deb: { x86_64: 'c-ares_x86_64.deb', aarch64: 'c-ares_1.34.8_aarch64.deb' }, inner: 'lib/libcares.so', lic: 'MIT' },
  { so: 'libc++_shared.so', deb: { x86_64: 'libc++_29_x86_64.deb', aarch64: 'libc++_29_aarch64.deb' }, inner: 'lib/libc++_shared.so', lic: 'Apache-2.0 WITH LLVM-exception' },
  { so: 'libffi.so', deb: { x86_64: 'libffi_3.8.0_x86_64.deb', aarch64: 'libffi_3.8.0_aarch64.deb' }, inner: 'lib/libffi.so', lic: 'MIT' },
  { so: 'libsqlite3.so', deb: { x86_64: 'libsqlite_x86_64.deb', aarch64: 'libsqlite_3.53.4_aarch64.deb' }, inner: 'lib/libsqlite3.so', lic: 'Public Domain' },

  // ---- P1 能力补齐包（2026-09-20；Termux 官方源，依赖闭包已用 scripts/elf-needed.mjs 核对）----
  // ★ 部署形态（2026-09-20 模拟器实证钉死）：untrusted_app 域对 app_data_file 的 execve
  //   被 SELinux 拒（avc denied entrypoint；run-as 的 runas_app 域是 granted——不能代表
  //   node 进程）。唯一可行路径 = **伪装 lib*.so 进 jniLibs**（nativeLibraryDir，与
  //   busybox/proot 同款），运行时由 NodeService 在 filesDir 建 `bash → libdsht-bash.so`
  //   symlink（execve 跟随 symlink 检查最终目标——busybox applets 同款机制，已实证）。
  //   库文件（runtime-lib）走 dlopen，不需要 execute 权限（runtime/lib 的 libcrypto 等
  //   一直这么工作），保持原部署面。
  // bash（bionic 真 shell，替换 busybox mksh 降级）：本体伪装 .so + 依赖库（SONAME 部署名
  // 与 DT_NEEDED 严格一致——libpcre2-8/libz.so.1/libcrypto.so.3 已在 runtime/lib，不重复打包）
  { so: 'libdsht-bash.so', deb: { x86_64: 'bash_5.3.15_x86_64.deb', aarch64: 'bash_5.3.15_aarch64.deb' }, inner: 'bin/bash', lic: 'GPL-3.0' },
  { so: 'libandroid-support.so', dest: 'runtime-lib', deb: { x86_64: 'libandroid-support_29-1_x86_64.deb', aarch64: 'libandroid-support_29-1_aarch64.deb' }, inner: 'lib/libandroid-support.so', lic: 'Apache-2.0 (NDK)' },
  { so: 'libiconv.so', dest: 'runtime-lib', deb: { x86_64: 'libiconv_1.19_x86_64.deb', aarch64: 'libiconv_1.19_aarch64.deb' }, inner: 'lib/libiconv.so', lic: 'LGPL-2.1' },
  { so: 'libreadline.so.8', dest: 'runtime-lib', deb: { x86_64: 'readline_8.3.3_x86_64.deb', aarch64: 'readline_8.3.3_aarch64.deb' }, inner: 'lib/libreadline.so.8.3', lic: 'GPL-3.0' },
  { so: 'libncursesw.so.6', dest: 'runtime-lib', deb: { x86_64: 'ncurses_6.6.20260307+really6.5.20250830_x86_64.deb', aarch64: 'ncurses_6.6.20260307+really6.5.20250830_aarch64.deb' }, inner: 'lib/libncursesw.so.6.5', lic: 'MIT (X11)' },
  // ripgrep（fs-search 真 rg，替换纯 JS 降级）
  { so: 'libdsht-rg.so', deb: { x86_64: 'ripgrep_15.2.0_x86_64.deb', aarch64: 'ripgrep_15.2.0_aarch64.deb' }, inner: 'bin/rg', lic: 'MIT/Unlicense' },
  // zstd（会话日志压缩恢复）：bin 伪装 .so + libzstd（同包）；liblzma 是它的依赖
  { so: 'libdsht-zstd.so', deb: { x86_64: 'zstd_1.5.7-1_x86_64.deb', aarch64: 'zstd_1.5.7-1_aarch64.deb' }, inner: 'bin/zstd', lic: 'BSD-3-Clause' },
  { so: 'libzstd.so.1', dest: 'runtime-lib', deb: { x86_64: 'zstd_1.5.7-1_x86_64.deb', aarch64: 'zstd_1.5.7-1_aarch64.deb' }, inner: 'lib/libzstd.so.1.5.7', lic: 'BSD-3-Clause' },
  { so: 'liblzma.so.5', dest: 'runtime-lib', deb: { x86_64: 'liblzma_5.8.4_x86_64.deb', aarch64: 'liblzma_5.8.4_aarch64.deb' }, inner: 'lib/liblzma.so.5', lic: 'Public Domain' },
  // git（工作区快照/版本操作）：本体伪装 .so。裁剪面：不带 libexec/git-core——helpers
  // （remote-http 等）须在 app_data_file 下被 exec，SELinux 必拒，带了也是死重；builtin
  // （init/add/commit/diff/log/branch/tag）由主二进制直接运行，不 exec helpers。
  // 远程 clone 会如实报「无法加载 git-remote-https」（R8 出声）。
  { so: 'libdsht-git.so', deb: { x86_64: 'git_2.55.0_x86_64.deb', aarch64: 'git_2.55.0_aarch64.deb' }, inner: 'bin/git', lic: 'GPL-2.0' },
]

// deb 级 SHA256（本机缓存实算；上游换版时**必须**同步本表 —— 校验不通过即报错）
const SHA256 = {
  // ---- P1 能力补齐包（2026-09-20 实算；downloads/ 缓存）----
  'bash_5.3.15_aarch64.deb': '15f8fef866dad70f675c520d5f56d718a1b1c0cffe9f14e20fff8f8249377d46',
  'bash_5.3.15_x86_64.deb': 'cf913f774f9c485a79e935f05f07130249869f71f9464638af250a4499487920',
  'git_2.55.0_aarch64.deb': '21b16fa06837e5bf94ad257da532c40eb049c120d21f6cb60a6411c0bcee7197',
  'git_2.55.0_x86_64.deb': '35cf9a5bd6d3b48fa6cb314f41f90f37eb0a9f584d5b8b5b3c57f3de7e12b92e',
  'libandroid-support_29-1_aarch64.deb': 'f2f145d6135ad4843ac9670153be3e3944dc1e6f1736d46d2306c28f2b86f517',
  'libandroid-support_29-1_x86_64.deb': '665900760c05959ec076082a0941f05bd452f301e5a70bdfa7383fd3404d44d5',
  'libiconv_1.19_aarch64.deb': 'fe9481b1dc101c6c3552943f25435109fd522aecc615ae49594f9fbee863bb37',
  'libiconv_1.19_x86_64.deb': '880e9f423b448316a4951ffca3ffcd626d79538042b60ce2c3a821b9650c594c',
  'liblzma_5.8.4_aarch64.deb': '44e95e6e60dddb3705e60a344a4f009a1085a210797342b721eaff41b44033c0',
  'liblzma_5.8.4_x86_64.deb': '100ea7503a0b9ecffa45e1f168d035651f2eb7aedbebe71dd21fc0da4a84ef16',
  'ncurses_6.6.20260307+really6.5.20250830_aarch64.deb': 'f44bbfdc3d42ec0217bffa978309390e59cea5a48a9a83226d4a496c42ad0b99',
  'ncurses_6.6.20260307+really6.5.20250830_x86_64.deb': '3f30f53c6a41c8450d146d4d42611a44be6ba0a8de1e8bb4dc903109a5fc3ff1',
  'readline_8.3.3_aarch64.deb': 'e50fb67f40753247dbb83efb17c7fbee0ac868ffcb5b5555d44d76ec8d90b4b1',
  'readline_8.3.3_x86_64.deb': 'e69d768ba81246700c244aea31a1fd728f6cc9698ca3031b6f7b7250ea77f8dd',
  'ripgrep_15.2.0_aarch64.deb': '38e28bc297000517b24702568a483eca7dc3323eb6bdccc9033f031776bdcc6c',
  'ripgrep_15.2.0_x86_64.deb': '2eb50ab2e378436767975b072ce7118decf6444d6d6ed178bc89979b5f150f2a',
  'zstd_1.5.7-1_aarch64.deb': 'e1b4a5113648da8de189620ba1fce74c48b2d0833d9043391b9a1c91fb606fd3',
  'zstd_1.5.7-1_x86_64.deb': 'a76ba6c3d8742819bf4fff7780eb2e022269412700fc8f4471f530cc0d81833f',
  // ---- 既有 ----
  'nodejs_aarch64.deb': 'eaf3ed8a6e4b72ebaa8c2cb3bad778c577cdf9ea87ca91761213d8a3940fc090',
  'nodejs_x86_64.deb': 'd3a0e7b8e110ba87969a56f45a8fa63730100e9faec413a6f377ebc76c5b616e',
  'proot_5.1.107.92_aarch64.deb': '1f1c983509701f6826f568482c70673ee453a9ba38c9f5fa445a472d6b7524e9',
  'proot_5.1.107.92_x86_64.deb': '70236632826c30ec0245082b633bbc7ef1e9fa5531bd51bd4f20231bfcdc999b',
  'busybox_1.38.0-1_aarch64.deb': '1bb7f1d4c00cadd0e1117b6dd7110311b8bf749ef00b486e96cfdc11c98f8fd9',
  'busybox_1.38.0-1_x86_64.deb': '519b57623dd076b4d6cf6d389ed976dd222410e3a0b9b9b58c14d8535b6eef48',
  'c-ares_1.34.8_aarch64.deb': '7681fc23e822d7988ba8b2adf3468f93ae68f724dda365cff1385096a9fa87e6',
  'c-ares_x86_64.deb': 'c5d6194d69a04089040ca50dad96ed7df8773bd3c3d7c4be7d1dd5661ceae6b4',
  'libc++_29_aarch64.deb': 'bb9f12113c137aa0e8513bb51cc49fe77a5ce3ca39ab9e92c57d228ecdf00222',
  'libc++_29_x86_64.deb': 'a4325afa2ecde73742499766e2a46202003e5cb3dcd2b7773ae25f386f3fecfa',
  'libffi_3.8.0_aarch64.deb': '4f255badf74cd31f6a2801c17fa1444199c84c834b517b7c843e2fe9ebe91d77',
  'libffi_3.8.0_x86_64.deb': '59121ca4bc5f5735d7bb603bd99548983064e8fde97d236e97122cb87d3452a3',
  'libsqlite_3.53.4_aarch64.deb': '0e909ce0d50fe123305446cd22e0c5edf535d40344b9b065fbdcdee52f53198d',
  'libsqlite_x86_64.deb': 'c2801581e7c656aec11153e5ef42179b9f8db8b9739fb6706899b93fa2655e6e',
  // ---- W-F（2026-09-21）asset 直取项（本仓 release native-cache-v1 托管）----
  'libnode-arm64.so': 'a0d21a1589312919114b24a5cc520c30ab7f26f9985b3f0c643c153172ebd1e6',
  'libnode-x86_64.so': '2aea3793e8c789b09a77e35150b536cef7ceb8ddcbfc276ba07d60eceb514a29',
}

/** asset 直取项的下载基址（本仓 release；libnode 的 deb 通道失效后的替代源） */
const ASSET_BASE = 'https://github.com/SUNNYYUBER/DSH-Tavern-for-Android/releases/download/native-cache-v1'

const MIRRORS = [
  'https://packages.termux.dev/apt/termux-main/pool/main',
  'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/pool/main',
]

// 项目 arch 名 → { Termux 名, jniLibs 目录名, runtime 存放根 }
//   ★ 目录名不是 arch 名本身：arm64 的目录是 `arm64-v8a`（AGP 约定）
//   ★ runtime 部署面（lib/bin/git-core）**按架构分存**（dsh-runtime / dsh-runtime-x64），
//     构建期 Step 5.5 按 -Arch 把对应架构拷进 dsh-runtime-android/ 再打 runtime.zip（单源惯例）
const ARCHES = {
  x86_64: { termux: 'x86_64', dir: 'x86_64', runtimeRoot: path.join(WS, 'dsh-runtime-x64') },
  arm64: { termux: 'aarch64', dir: 'arm64-v8a', runtimeRoot: path.join(WS, 'dsh-runtime') },
}

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

/** 目标在**本架构**下的 deb 文件名（每架构显式声明 ⇒ 无隐式回退）。 */
export function debNameFor (spec, termuxArch) {
  const name = spec[termuxArch]
  if (!name) throw new Error(`该 deb 未声明 ${termuxArch} 架构：${JSON.stringify(spec)}`)
  return name
}

/** ar 归档成员列表 → [{name, data}]（deb 外层格式：`!<arch>\n` + 60 字节头）。 */
export function parseAr (buf) {
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw new Error('不是 ar 归档（deb 外层应为 !<arch>)')
  const out = []
  let off = 8
  while (off + 60 <= buf.length) {
    const name = buf.toString('latin1', off, off + 16).trim().replace(/\/$/, '')
    const size = parseInt(buf.toString('latin1', off + 48, off + 58).trim(), 10)
    if (!Number.isFinite(size) || size < 0) break
    out.push({ name, data: buf.subarray(off + 60, off + 60 + size) })
    off += 60 + size + (size % 2)
  }
  if (out.length === 0) throw new Error('ar 归档里没解析出成员（格式意外）')
  return out
}

/** 从 deb 路径里取出版本无关的「包名」用于目录定位。 */
export function pkgKeyOf (debFile) { return debFile.replace(/\.deb$/, '') }

/** spec.dest + 架构 → 部署目录。'jni'（默认）走 jniLibs/<abi>；runtime 面按架构分存。 */
export function destDirFor (spec, archKey) {
  const a = ARCHES[archKey]
  if (!a) throw new Error(`未知架构：${archKey}`)
  switch (spec.dest ?? 'jni') {
    case 'jni': return path.join(JNI, a.dir)
    case 'runtime-lib': return path.join(a.runtimeRoot, 'lib')
    case 'runtime-bin': return path.join(a.runtimeRoot, 'bin')
    case 'git-core': return path.join(a.runtimeRoot, 'git-core')
    // 【W-1 2026-09-21】node 头（node_api.h 等）——**构建期**依赖，不进 APK。
    // 为什么需要它：node-pty 是 C++ addon，交叉编译要 `node_api.h`；而它**只随
    // Termux nodejs deb 分发**，本仓的 `downloads/` 被 gitignore ⇒ CI 净环境没有
    // ⇒ `build-node-pty.mjs` 报「✗ 找不到 node_api.h」⇒ 整条构建链失败
    // （实测：v0.2.3 的 CI 两次都死在这里，第一次还叠加了 NDK 缺失）。
    // ★ 头文件**与架构无关**（N-API 头是同一份）⇒ 落到共享目录，不按 arch 分。
    // 该路径正是 build-node-pty.mjs 的 NODE_HEADER_CANDIDATES[0]（其判定是
    // `<dir>/node_api.h` 存在）。cpSync 把 `include/node/` 的内容**平铺**到该目录，
    // 故路径末尾必须是 `.../include/node`（不是 `.../include`）。
    case 'node-headers': return path.join(WS, 'downloads', 'node-deb', 'data', 'data', 'com.termux', 'files', 'usr', 'include', 'node')
    default: throw new Error(`未知部署面：${spec.dest}`)
  }
}

/** 部署产物是否已就绪（dir 型 = 目录存在且非空；文件型 = 文件存在且非空）。 */
function destReady (spec, destDir) {
  if (spec.dir) {
    try { return fs.statSync(destDir).isDirectory() && fs.readdirSync(destDir).length > 0 } catch { return false }
  }
  try { return fs.statSync(path.join(destDir, spec.so)).size > 0 } catch { return false }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  await (async () => {
  const argv = process.argv.slice(2)
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const CHECK = argv.includes('--check')
  const FORCE = argv.includes('--force')
  const archArg = flag('--arch', 'all')
  const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg]
  for (const a of arches) {
    if (!ARCHES[a]) { console.error(`✗ 未知架构：${a}（可选 ${Object.keys(ARCHES).join(' / ')} / all）`); process.exitCode = 1; return }
  }

  const missing = []
  let ok = 0, skipped = 0

  for (const arch of arches) {
    const { termux: termuxArch } = ARCHES[arch]
    for (const spec of TARGETS) {
      const destDir = destDirFor(spec, arch)
      fs.mkdirSync(destDir, { recursive: true })
      if (!FORCE && destReady(spec, destDir)) { skipped += 1; continue }
      const debFile = debNameFor(spec.deb, termuxArch)
      const label = `${arch}/${spec.dir ? spec.dest + '/' : spec.so}`
      if (CHECK) { missing.push(`${label} ← ${debFile}`); continue }
      // —— 逻辑上不会走到这里（构建期用 --check + 手工补齐），保留为 fail-closed ——
      missing.push(`${label} ← ${debFile}（需先跑不带 --check 的补齐）`)
    }
  }

  if (CHECK) {
    if (missing.length === 0) {
      console.log(`[native-libs] ✓ 双架构 ${TARGETS.length * arches.length} 项齐备（跳过 ${skipped} 项已存在）`)
      return
    }
    console.error(`[native-libs] ✗ 缺失 ${missing.length} 项：`)
    for (const m of missing) console.error('  · ' + m)
    console.error('  ⇒ 这些是**第三方二进制**（Termux deb 提取），本仓库不再分发。')
    console.error('  ⇒ 补齐：node scripts/fetch-native-libs.mjs（首次需联网，之后走 downloads/ 缓存）')
    process.exitCode = 1
    return
  }

  // —— 补齐模式：定位 deb（缓存优先）→ 校验 → 解包 → 提取 ——
  console.log('[native-libs] 开始补齐原生库…')

  function findDeb (debFile) {
    for (const c of CACHE) {
      const p = path.join(c, debFile)
      if (fs.existsSync(p)) return p
      // 兼容 `libc%2B%2B_29` 这类 URL 编码过的缓存名
      const alt = path.join(c, debFile.replace(/\+/g, '%2B'))
      if (fs.existsSync(alt)) return alt
    }
    return null
  }

  /**
   * 【W-F 2026-09-21】缓存缺失时从镜像下载（兑现头注 ②「缺失才联网」——
   * 此前只报错给 URL 让人手抓，GitHub Actions 首跑实证此路必断）。
   * 落 `downloads/proot/`（与缓存同位，此后幂等）；**下载即过 SHA256 表**
   * （校验不符 = 疑似镜像串版/上游换版，换下一路径，全灭返回 null 由调用方 fail-closed）。
   *
   * URL 解析两级：① 直名（缓存名 = pool 名的多数 deb）；② pool 目录清单里
   * 同包同架构的最新 deb（nodejs 这类缓存名被剥了版本号的——pool 只留最新版，
   * 直名必 404；SHA256 表同时把版本钉死：上游换版 = 校验不符 = 出声失败，不静默降级）。
   */
  async function downloadDeb (debFile) {
    const pkg = debFile.split('_')[0]
    const archSuffix = debFile.match(/_(aarch64|x86_64|arm|i686|all)\.deb$/)?.[0] ?? ''
    const dest = path.join(WS, 'downloads', 'proot', debFile)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const tryOne = async (url) => {
      try {
        const res = await fetch(url, { redirect: 'follow' })
        if (!res.ok) return false
        const buf = Buffer.from(await res.arrayBuffer())
        const want = SHA256[debFile]
        if (want) {
          const got = createHash('sha256').update(buf).digest('hex')
          if (got !== want) {
            console.error(`  ✗ ${debFile} SHA256 不符（${url}）：${got}`)
            return false
          }
        }
        fs.writeFileSync(dest, buf)
        console.log(`  ↓ ${debFile} ← ${url}（${Math.round(buf.length / 1024)} KB）`)
        return true
      } catch { return false }
    }
    for (const m of MIRRORS) {
      // pool 目录前缀（Debian 惯例，Packages 索引实证）：lib* 包用前 4 字符
      // （libc++/libffi/libsqlite → libc/libf/libs），其余用首字符
      const prefix = pkg.startsWith('lib') ? pkg.slice(0, 4) : pkg[0]
      const dir = `${m}/${prefix}/${pkg}`
      if (await tryOne(`${dir}/${debFile}`)) return dest
      // 第二级：目录清单取同包同架构的最新版本文件
      try {
        const idx = await (await fetch(dir + '/', { redirect: 'follow' })).text()
        const names = [...idx.matchAll(/href="([^"]+\.deb)"/g)].map(x => x[1])
          .filter(n => n.startsWith(pkg + '_') && n.endsWith(archSuffix))
          .sort()
        if (names.length > 0 && await tryOne(`${dir}/${names[names.length - 1]}`)) return dest
      } catch { /* 清单不可读 → 下一个镜像 */ }
    }
    return null
  }

  /** asset 直取（本仓 release 托管的单文件；缓存 → 下载 → SHA256 → 落缓存位） */
  async function downloadAsset (assetName) {
    const cached = findDeb(assetName)
    if (cached) return cached
    const dest = path.join(WS, 'downloads', 'proot', assetName)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    try {
      const res = await fetch(`${ASSET_BASE}/${assetName}`, { redirect: 'follow' })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      const want = SHA256[assetName]
      if (want && createHash('sha256').update(buf).digest('hex') !== want) {
        console.error(`  ✗ ${assetName} SHA256 不符（asset 源）`)
        return null
      }
      fs.writeFileSync(dest, buf)
      console.log(`  ↓ ${assetName} ← native-cache-v1（${Math.round(buf.length / 1024)} KB）`)
      return dest
    } catch { return null }
  }

  function sha256 (p) {
    return execFileSync('node', ['-e',
      `const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))`,
      p], { encoding: 'utf8' })
  }

  function extractDeb (debPath, workDir) {
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    const members = parseAr(fs.readFileSync(debPath))
    const data = members.find(m => m.name.startsWith('data.tar'))
    if (!data) throw new Error('deb 里找不到 data.tar.*：' + debPath)
    const dataPath = path.join(workDir, data.name)
    fs.writeFileSync(dataPath, data.data)
    execFileSync('tar', ['-xf', dataPath, '-C', workDir], { stdio: 'pipe' })
    return workDir
  }

  function findInner (root, innerRel) {
    const base = path.basename(innerRel)
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === base) hits.push(p)
      }
    }
    walk(root)
    if (hits.length === 0) throw new Error(`deb 内找不到 ${base}（上游布局可能变了 —— 不要静默取别的文件）`)
    // 多个同名时优先路径含 innerRel 目录段的那个
    const pref = hits.find(h => h.replace(/\\/g, '/').includes('/' + innerRel))
    return pref ?? hits[0]
  }

  /** dir 型：递归找 basename 匹配的**目录**（如 libexec/git-core）。 */
  function findInnerDir (root, innerRel) {
    const base = path.basename(innerRel)
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (!e.isDirectory()) continue
        if (e.name === base) hits.push(p)
        walk(p)
      }
    }
    walk(root)
    if (hits.length === 0) throw new Error(`deb 内找不到目录 ${base}（上游布局可能变了 —— 不要静默取别的目录）`)
    const pref = hits.find(h => h.replace(/\\/g, '/').includes('/' + innerRel))
    return pref ?? hits[0]
  }

  let fetched = 0
  for (const arch of arches) {
    const { termux: termuxArch } = ARCHES[arch]
    for (const spec of TARGETS) {
      const destDir = destDirFor(spec, arch)
      if (!FORCE && destReady(spec, destDir)) continue
      // asset 直取项（libnode：deb 通道已失效，见 TARGETS 注释）——单文件下载 + 校验 + 拷贝
      if (spec.asset) {
        const assetName = spec.asset[termuxArch]
        const p = await downloadAsset(assetName)
        if (!p) {
          console.error(`✗ asset 获取失败：${assetName}（native-cache-v1 与缓存均不可得）`)
          process.exitCode = 1
          return
        }
        const got = sha256(p)
        if (SHA256[assetName] && got !== SHA256[assetName]) {
          console.error(`✗ SHA256 不符：${assetName}\n  期望 ${SHA256[assetName]}\n  实得 ${got}`)
          process.exitCode = 1
          return
        }
        fs.mkdirSync(destDir, { recursive: true })
        fs.copyFileSync(p, path.join(destDir, spec.so))
        const kb = Math.round(fs.statSync(path.join(destDir, spec.so)).size / 1024)
        console.log(`  ✓ ${arch}/${spec.so}（${kb} KB · ${spec.lic}）← asset:${assetName}`)
        fetched += 1
        continue
      }
      const debFile = debNameFor(spec.deb, termuxArch)
      let debPath = findDeb(debFile)
      if (!debPath) debPath = await downloadDeb(debFile) // 缓存缺失 → 镜像下载（W-F）
      if (!debPath) {
        console.error(`✗ 缺 deb 且镜像下载失败：${debFile}`)
        console.error(`  ⇒ 手工来源：`)
        for (const m of MIRRORS) console.error(`     ${m}/<首字母>/${debFile.split('_')[0]}/${debFile}`)
        console.error('  ⇒ 或直接把 deb 放进 rp-workspace/downloads/proot/ 后重跑本脚本')
        process.exitCode = 1
        return
      }
      const want = SHA256[debFile]
      if (want) {
        const got = sha256(debPath)
        if (got !== want) {
          console.error(`✗ SHA256 不符：${debFile}\n  期望 ${want}\n  实得 ${got}`)
          console.error('  ⇒ 上游可能已换版。**先核对来源**再更新脚本里的 SHA256 表（防供应链替换）。')
          process.exitCode = 1
          return
        }
      } else {
        console.warn(`⚠ ${debFile} 无 SHA256 记录 ⇒ 跳过校验（请补进脚本的 SHA256 表）`)
      }
      const work = path.join(WS, 'tmp', 'native-libs-work', pkgKeyOf(debFile))
      extractDeb(debPath, work)
      if (spec.dir) {
        const srcDir = findInnerDir(work, spec.inner)
        fs.rmSync(destDir, { recursive: true, force: true })
        fs.cpSync(srcDir, destDir, { recursive: true })
        const n = fs.readdirSync(destDir).length
        console.log(`  ✓ ${arch}/${spec.dest}/（${n} 项 · ${spec.lic}）← ${debFile}`)
      } else {
        const src = findInner(work, spec.inner)
        fs.mkdirSync(destDir, { recursive: true })
        const dst = path.join(destDir, spec.so)
        fs.copyFileSync(src, dst)
        const kb = Math.round(fs.statSync(dst).size / 1024)
        console.log(`  ✓ ${arch}/${spec.so}（${kb} KB · ${spec.lic}）← ${debFile}`)
      }
      fetched += 1
    }
  }
  console.log(`[native-libs] 完成：新提取 ${fetched} 项，跳过 ${skipped} 项（已存在）`)
  })()
}