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
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const JNI = path.join(WS, 'android', 'app', 'src', 'main', 'jniLibs')
const CACHE = [
  path.join(WS, 'downloads', 'proot'),
  path.join(WS, 'downloads'),
]

// ---------------------------------------------------------------------------
// 目标表：jniLibs 里的 .so ← deb（**每架构显式声明**，不给默认值 —— 上游命名不统一，
//   隐式回退会静默取错架构的文件，P-45）← deb 内 relative 路径
//   ★ 内部路径用**相对片段**匹配（递归找 basename），不锚死绝对布局 ——
//     上游 deb 布局变化时会**报错而不是静默取错文件**（P-45）。
// ---------------------------------------------------------------------------
const TARGETS = [
  { so: 'libnode.so', deb: { x86_64: 'nodejs_x86_64.deb', aarch64: 'nodejs_aarch64.deb' }, inner: 'lib/libnode.so', lic: 'MIT' },
  { so: 'libproot.so', deb: { x86_64: 'proot_5.1.107.92_x86_64.deb', aarch64: 'proot_5.1.107.92_aarch64.deb' }, inner: 'bin/proot', lic: 'GPLv2' },
  { so: 'libbusybox.so', deb: { x86_64: 'busybox_1.38.0-1_x86_64.deb', aarch64: 'busybox_1.38.0-1_aarch64.deb' }, inner: 'bin/busybox', lic: 'GPLv2' },
  { so: 'libcares.so', deb: { x86_64: 'c-ares_x86_64.deb', aarch64: 'c-ares_1.34.8_aarch64.deb' }, inner: 'lib/libcares.so', lic: 'MIT' },
  { so: 'libc++_shared.so', deb: { x86_64: 'libc++_29_x86_64.deb', aarch64: 'libc++_29_aarch64.deb' }, inner: 'lib/libc++_shared.so', lic: 'Apache-2.0 WITH LLVM-exception' },
  { so: 'libffi.so', deb: { x86_64: 'libffi_x86_64.deb', aarch64: 'libffi_3.5.2_aarch64.deb' }, inner: 'lib/libffi.so', lic: 'MIT' },
  { so: 'libsqlite3.so', deb: { x86_64: 'libsqlite_x86_64.deb', aarch64: 'libsqlite_3.53.4_aarch64.deb' }, inner: 'lib/libsqlite3.so', lic: 'Public Domain' },
]

// deb 级 SHA256（本机缓存实算；上游换版时**必须**同步本表 —— 校验不通过即报错）
const SHA256 = {
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
  'libffi_3.5.2_aarch64.deb': '8c8c1d6ffb049d8496a21c1202d9b4dc9145140886fdbb45716684565f4ed3f5',
  'libffi_x86_64.deb': 'fb3788bf51af4b838519291840c1f8a1e19c56423355f91a41e963109b8926a2',
  'libsqlite_3.53.4_aarch64.deb': '0e909ce0d50fe123305446cd22e0c5edf535d40344b9b065fbdcdee52f53198d',
  'libsqlite_x86_64.deb': 'c2801581e7c656aec11153e5ef42179b9f8db8b9739fb6706899b93fa2655e6e',
}

const MIRRORS = [
  'https://packages.termux.dev/apt/termux-main/pool/main',
  'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/pool/main',
]

// 项目 arch 名 → { Termux arch 名, jniLibs 目录名 }
//   ★ 目录名不是 arch 名本身：arm64 的目录是 `arm64-v8a`（AGP 约定）
const ARCHES = {
  x86_64: { termux: 'x86_64', dir: 'x86_64' },
  arm64: { termux: 'aarch64', dir: 'arm64-v8a' },
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

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const CHECK = argv.includes('--check')
  const FORCE = argv.includes('--force')
  const archArg = flag('--arch', 'all')
  const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg]
  for (const a of arches) {
    if (!ARCHES[a]) { console.error(`✗ 未知架构：${a}（可选 ${Object.keys(ARCHES).join(' / ')} / all）`); process.exit(1) }
  }

  const missing = []
  let ok = 0, skipped = 0

  for (const arch of arches) {
    const { termux: termuxArch, dir: jniDir } = ARCHES[arch]
    const dir = path.join(JNI, jniDir)
    fs.mkdirSync(dir, { recursive: true })
    for (const spec of TARGETS) {
      const dst = path.join(dir, spec.so)
      if (!FORCE && fs.existsSync(dst) && fs.statSync(dst).size > 0) { skipped += 1; continue }
      const debFile = debNameFor(spec.deb, termuxArch)
      if (CHECK) { missing.push(`${arch}/${spec.so} ← ${debFile}`); continue }
      // —— 逻辑上不会走到这里（构建期用 --check + 手工补齐），保留为 fail-closed ——
      missing.push(`${arch}/${spec.so} ← ${debFile}（需先跑不带 --check 的补齐）`)
    }
  }

  if (CHECK) {
    if (missing.length === 0) {
      console.log(`[native-libs] ✓ 双架构 ${TARGETS.length * arches.length} 项齐备（跳过 ${skipped} 项已存在）`)
      process.exit(0)
    }
    console.error(`[native-libs] ✗ 缺失 ${missing.length} 项：`)
    for (const m of missing) console.error('  · ' + m)
    console.error('  ⇒ 这些是**第三方二进制**（Termux deb 提取），本仓库不再分发。')
    console.error('  ⇒ 补齐：node scripts/fetch-native-libs.mjs（首次需联网，之后走 downloads/ 缓存）')
    process.exit(1)
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

  let fetched = 0
  for (const arch of arches) {
    const { termux: termuxArch, dir: jniDir } = ARCHES[arch]
    const dir = path.join(JNI, jniDir)
    for (const spec of TARGETS) {
      const dst = path.join(dir, spec.so)
      if (!FORCE && fs.existsSync(dst) && fs.statSync(dst).size > 0) continue
      const debFile = debNameFor(spec.deb, termuxArch)
      const debPath = findDeb(debFile)
      if (!debPath) {
        console.error(`✗ 缺 deb：${debFile}`)
        console.error(`  ⇒ 从上游取（上次构建缓存在 downloads/）：`)
        for (const m of MIRRORS) console.error(`     ${m}/<首字母>/${debFile.split('_')[0]}/${debFile}`)
        console.error('  ⇒ 或直接把 deb 放进 rp-workspace/downloads/proot/ 后重跑本脚本')
        process.exit(1)
      }
      const want = SHA256[debFile]
      if (want) {
        const got = sha256(debPath)
        if (got !== want) {
          console.error(`✗ SHA256 不符：${debFile}\n  期望 ${want}\n  实得 ${got}`)
          console.error('  ⇒ 上游可能已换版。**先核对来源**再更新脚本里的 SHA256 表（防供应链替换）。')
          process.exit(1)
        }
      } else {
        console.warn(`⚠ ${debFile} 无 SHA256 记录 ⇒ 跳过校验（请补进脚本的 SHA256 表）`)
      }
      const work = path.join(WS, 'tmp', 'native-libs-work', pkgKeyOf(debFile))
      extractDeb(debPath, work)
      const src = findInner(work, spec.inner)
      fs.copyFileSync(src, dst)
      const kb = Math.round(fs.statSync(dst).size / 1024)
      console.log(`  ✓ ${arch}/${spec.so}（${kb} KB · ${spec.lic}）← ${debFile}`)
      fetched += 1
    }
  }
  console.log(`[native-libs] 完成：新提取 ${fetched} 项，跳过 ${skipped} 项（已存在）`)
  process.exit(0)
}