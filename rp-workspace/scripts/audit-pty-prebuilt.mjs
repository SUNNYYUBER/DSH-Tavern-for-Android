// audit-pty-prebuilt.mjs —— node-pty 自编译产物的构建期静态断言（W-1）
//
// 【为什么需要它】交叉编译的 ARM ELF 无法在 Windows 构建机上 dlopen，
// 所以「产物能不能在设备上加载」必须用**静态判据**守。判据的设计依据是
// docs/PTY-RESEARCH-2026-09-21.md 附录 B 的实证结论：
//
//   1. PTY 六个符号（openpty/forkpty/ptsname/posix_openpt/grantpt/unlockpt）
//      必须是 UND 且**由 libc 提供**（bionic 自 API 23 起原生提供）——
//      这同时排除了「误把 glibc/Termux 编译产物塞进来」（那样的 runpath/版本标记会不同）。
//   2. NEEDED 全集 ⊆ {libc.so, libm.so, libdl.so, libc++_shared.so}——
//      多出任何库（尤其 libutil.so）都说明链接配置错了（bionic 无独立 libutil）。
//   3. 架构必须对（ELF e_machine）
//
// 自研 ELF 解析（不依赖 NDK/llvm-readelf 在场——CI 上 NDK 由 workflow 提供，
// 但判据本身应能在任何机器上独立跑）。
//
// 【--expect-compile：为什么需要它】本判据在**两个时刻**被调用：
//   · Step 0.5（门禁前置，经 audit-upgrade-readiness.mjs ③ 段）—— 此刻产物**还没编译**；
//     android-* 产物由 **Step 1.5** 的 build-node-pty.mjs 交叉编译产出。
//   · Step 1.5 之后（build-dsht.ps1 内联调用）—— 此刻产物才是**权威现场**。
//   在 Step 0.5 不带 flag 地跑，会拿「**上一次构建的残留产物**」当判据对象：
//   本机因此长期假绿，而 **CI 净环境无残留** ⇒ v0.2.7 tag 首跑实测报
//   「产物缺失 ⇒ audit-upgrade-readiness ③ 段 BLOCK ⇒ 构建失败」。
//   这是 P-40③ 同族（判据必须跑在它所判对象**状态确定之后**）。
//   ⇒ 传 `--expect-compile` 时：产物**两处都不存在**记 **SKIP 并出声**（P-17：测不出 ≠ 通过），
//     其余判据（架构/符号/NEEDED）在产物在场时**照常执行**。
//     真正的缺失判据由 **Step 1.5 之后**那次不带 flag 的调用负责（fail-closed）。
//
// 退出码：0 = 全部通过（含 SKIP，此时 stdout 有 SKIP 出声）；1 = 有判据失败
//
// 用法：
//   node scripts/audit-pty-prebuilt.mjs                  # 权威现场（Step 1.5 之后）
//   node scripts/audit-pty-prebuilt.mjs --expect-compile # 编译前（Step 0.5 门禁），缺失记 SKIP

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// 产物在 **dsh-runtime-src**（Step 1.5 写那里，随 Step 3 复制进 dsh-runtime-android）。
// 两处都查：构建期在 src，构建后（SkipInstall 等）可能在 android。
const PTY_DIRS = [
  path.join(WS, 'dsh-runtime-src', 'node_modules', 'node-pty', 'prebuilds'),
  path.join(WS, 'dsh-runtime-android', 'node_modules', 'node-pty', 'prebuilds'),
]

const PTY_SYMBOLS = ['openpty', 'forkpty', 'ptsname', 'posix_openpt', 'grantpt', 'unlockpt']
const ALLOWED_NEEDED = new Set(['libc.so', 'libm.so', 'libdl.so', 'libc++_shared.so'])

// ELF e_machine：AArch64 = 183，x86-64 = 62
const ARCH_EXPECT = {
  'android-arm64': { machine: 183, name: 'AArch64' },
  'android-x64': { machine: 62, name: 'x86-64' },
}

// ---- 极简 ELF64 解析（只取本判据需要的段） ----
function parseElf(buf) {
  if (buf.readUInt32LE(0) !== 0x464c457f) throw new Error('not ELF')
  if (buf[4] !== 2) throw new Error('not ELF64')
  const machine = buf.readUInt16LE(0x12)
  const shoff = Number(buf.readBigUInt64LE(0x28))
  const shentsize = buf.readUInt16LE(0x3a)
  const shnum = buf.readUInt16LE(0x3c)
  const shstrndx = buf.readUInt16LE(0x3e)
  const sh = (i) => shoff + i * shentsize
  const shstrOff = Number(buf.readBigUInt64LE(sh(shstrndx) + 0x18))
  // 注意：off 是**相对 base 的偏移**（section name / strtab 索引都这样用），
  // 循环必须从 base+off 起（早期版本漏加 base ⇒ 段名全读不出，判据静默失效）
  const LIMIT = buf.length
  const cstr = (base, off) => {
    let e = base + off
    if (e < 0 || e >= LIMIT) return ''
    while (e < LIMIT && buf[e] !== 0) e++
    return buf.toString('latin1', base + off, e)
  }
  const sectAt = (o) => cstr(shstrOff, buf.readUInt32LE(sh(o)))

  let dynsym = null // { off, size, link }
  let dynstr = null // { off }
  let verneed = null // { off, size }
  let versym = null // { off, size }
  for (let i = 0; i < shnum; i++) {
    const name = sectAt(i)
    const off = Number(buf.readBigUInt64LE(sh(i) + 0x18))
    const size = Number(buf.readBigUInt64LE(sh(i) + 0x20))
    const link = buf.readUInt32LE(sh(i) + 0x28)
    if (name === '.dynsym') dynsym = { off, size, link }
    if (name === '.dynstr') dynstr = { off }
    if (name === '.gnu.version_r') verneed = { off, size, link }
    if (name === '.gnu.version') versym = { off, size, link }
  }
  if (!dynsym || !dynstr) throw new Error('no .dynsym/.dynstr')

  // verneed 链：版本索引 → soname@version 名
  const verMap = new Map()
  if (verneed) {
    let o = verneed.off
    const end = verneed.off + verneed.size
    let guard = 0
    while (o < end && guard++ < 64) {
      const vn_cnt = buf.readUInt16LE(o + 2)
      const vn_file = o + buf.readUInt32LE(o + 4)
      const vn_aux = o + buf.readUInt32LE(o + 8)
      const vn_next = buf.readUInt32LE(o + 12)
      const soname = cstr(dynstr.off, buf.readUInt32LE(vn_file))
      let a = vn_aux
      for (let i = 0; i < vn_cnt; i++) {
        const vna_other = buf.readUInt16LE(a + 6) & 0x7fff
        const vna_name = cstr(dynstr.off, buf.readUInt32LE(a + 8))
        verMap.set(vna_other, `${soname}@${vna_name}`)
        const anext = buf.readUInt32LE(a + 16)
        if (anext === 0) break
        a += anext
      }
      if (vn_next === 0) break
      o += vn_next
    }
  }

  // 符号：找目标符号的 shndx（0=UND）与版本名
  const symInfo = new Map() // name → { und, provider }
  const idxOf = (o) => Math.floor((o - dynsym.off) / 24)
  for (let o = dynsym.off; o < dynsym.off + dynsym.size; o += 24) {
    const nameOff = buf.readUInt32LE(o)
    if (nameOff === 0) continue
    const name = cstr(dynstr.off, nameOff)
    const shndx = buf.readUInt16LE(o + 6)
    const vi = versym ? buf.readUInt16LE(versym.off + idxOf(o) * 2) & 0x7fff : 0
    symInfo.set(name, { und: shndx === 0, provider: verMap.get(vi) ?? (vi ? `verIdx=${vi}` : null) })
  }

  // NEEDED 全集（.dynamic 段）
  const needed = []
  for (let i = 0; i < shnum; i++) {
    if (sectAt(i) !== '.dynamic') continue
    const off = Number(buf.readBigUInt64LE(sh(i) + 0x18))
    const size = Number(buf.readBigUInt64LE(sh(i) + 0x20))
    for (let o = off; o < off + size; o += 16) {
      const tag = Number(buf.readBigUInt64LE(o))
      const val = Number(buf.readBigUInt64LE(o + 8))
      if (tag === 0) break
      if (tag === 1) needed.push(cstr(dynstr.off, val))
    }
  }

  return { machine, symInfo, needed }
}

// ---- 判据 ----
// W77：flag 必须以字面量被「可见地」读（argOf helper 的实参判据认不出）
const EXPECT_COMPILE = process.argv.includes('--expect-compile')
let failed = false
let skipped = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failed = true
}
const skip = (msg) => {
  console.log(`  ⓘ SKIP ${msg}`)
  skipped++
}

console.log('=== node-pty 预编译产物静态断言（W-1）===')

for (const [dir, expect] of Object.entries(ARCH_EXPECT)) {
  // 取第一个**产物存在**的候选目录（优先 src = 构建期权威位置）
  let file = null
  for (const base of PTY_DIRS) {
    const cand = path.join(base, dir, 'pty.node')
    if (fs.existsSync(cand)) { file = cand; break }
  }
  console.log(`\n[${dir}] ${file ?? '(两处均无产物)'}`)
  if (!file) {
    // ★ 编译前调用（Step 0.5 门禁）：此刻产物**本就不该在** ⇒ SKIP 出声，不做缺失判据。
    //   权威缺失判据在 Step 1.5 之后那次调用（不带 flag ⇒ fail-closed）。
    if (EXPECT_COMPILE) {
      skip(`产物尚未编译（Step 1.5 才产出）—— 本段此刻**无判据力**，由 Step 1.5 后的权威调用负责（P-17 测不出 ≠ 通过）`)
      continue
    }
    fail(`产物缺失：${PTY_DIRS.map((b) => path.join(b, dir, 'pty.node')).join(' / ')}`)
    continue
  }

  let elf
  try {
    elf = parseElf(fs.readFileSync(file))
  } catch (e) {
    fail(`ELF 解析失败：${e?.message ?? e}`)
    continue
  }

  // 判据 1：架构
  if (elf.machine !== expect.machine) {
    fail(`架构不符：e_machine=${elf.machine}，期望 ${expect.machine}（${expect.name}）`)
  } else {
    console.log(`  ✓ 判据1 架构 = ${expect.name}`)
  }

  // 判据 2：PTY 六符号为 UND 且由 libc 提供
  const bad = []
  for (const s of PTY_SYMBOLS) {
    const info = elf.symInfo.get(s)
    if (!info) {
      // 未被引用的符号不算失败（源码可能在某架构上不用某个），但记一笔
      continue
    }
    if (!info.und) bad.push(`${s} 不是 UND（shndx≠0）——被静态实现进本模块？`)
    else if (!info.provider || !info.provider.endsWith('@LIBC')) {
      bad.push(`${s} 提供方 = ${info.provider ?? '(无版本标记)'}，期望 *@LIBC`)
    }
  }
  if (bad.length) bad.forEach(fail)
  else console.log(`  ✓ 判据2 PTY 符号全部由 libc 提供（bionic 原生，零 shim）`)

  // 判据 3：NEEDED 全集在允许集内（尤其排除 libutil.so）
  const extra = elf.needed.filter((n) => !ALLOWED_NEEDED.has(n))
  if (extra.length) {
    fail(`NEEDED 含未允许的库：${extra.join(', ')}（允许集：${[...ALLOWED_NEEDED].join(', ')}）`)
  } else {
    console.log(`  ✓ 判据3 NEEDED = ${elf.needed.join(', ')}`)
  }
}

if (failed) {
  console.error('\n✗ node-pty 产物静态断言失败')
  process.exitCode = 1
} else if (skipped > 0) {
  console.log(`\nⓘ node-pty 产物静态断言：**SKIP ${skipped} 项**（产物尚未编译）—— 本段此刻无判据力，非通过`)
} else {
  console.log('\n✓ node-pty 双架构产物静态断言全部通过')
}
