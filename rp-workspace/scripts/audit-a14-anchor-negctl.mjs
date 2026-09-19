// W29 A14 anchor negctl: prove A14's entry anchor is READ from the authoritative scripts,
// and that the anchor actually discriminates (i.e. a wrong entry really does change the bytes).
//
// Why this must exist (P-41 / P-30):
//   A14's verdict now depends on `parseArtifactEntries()` reading entry values out of
//   build-dsht.ps1 + rebuild-plugins.ps1. If that parser silently returned nothing,
//   A14 would fall back to its hard-coded PAIRS entry -- the exact defect W29 fixed --
//   and the output would still look normal ("✓ ... 逐字节一致"). So the anchor itself
//   needs a discriminating check against the REAL repo, not against synthetic strings.
//
// Three independent assertions:
//   A. Anchor provenance: the entry A14 will use for the RP total package comes from a
//      script (not from PAIRS) -- i.e. parseArtifactEntries() really returns a value.
//   B. Discrimination (leverage): recompiling with the *wrong* entry produces different
//      bytes than the on-disk artifact. This proves "same entry" is a meaningful condition
//      rather than something that always passes.
//   C. Consistency: recompiling with the *parsed* entry reproduces the artifact byte-for-byte.
//
// A and C together mean the current green result is anchored in a real fact; B means the
// check could fail if the anchor were wrong (P-20 leverage).
//
// Usage: node scripts/audit-a14-anchor-negctl.mjs
// ★ W72：自证分数契约的**唯一产出点**（P-1；**不自己拼分数行**）
import { reportSelftest } from './selftest-summary.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArtifactEntries, normNodeModules, discoverAuthoritativeScripts } from './audit-artifact-freshness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const PKG = path.join(WS, 'packages')
const ESB = path.join(PKG, 'node_modules', 'esbuild', 'bin', 'esbuild')

const RESULTS = []
const rec = (label, ok, extra = '') => RESULTS.push([label, ok, extra])

// ---- 读权威脚本，取 RP 总包的 entry 声明 ----
//   ★★ **W81 修（P-1 / P-46）**：此处原是**手写 2 项清单**，与 `audit-artifact-freshness.mjs`
//     里的那份**完全相同** ⇒ ★ 两处口径必须同源（否则「改了只改一处」⇒ 对同一仓库给出
//     **相反结论**）⇒ 改为调用**单源发现器** `discoverAuthoritativeScripts`（按语义枚举）。
const decls = []
for (const s of discoverAuthoritativeScripts(HERE)) {
  const m = parseArtifactEntries(s.text)
  const e = m.get('dsht-rp-plugin/lib/index.js')
  if (e) decls.push({ from: s.name, entry: e })
}

// A. 锚点来源
rec('A 锚点来自权威脚本（不是 PAIRS 现值）', decls.length >= 1,
  decls.length ? decls.map(d => `${d.entry}（${d.from}）`).join(' · ') : '解析器返回空 ⇒ A14 会退回硬编码 entry（= W29 修的缺陷）')

const art = path.join(WS, 'dsh-runtime-android', 'node_modules', 'dsht-rp-plugin', 'lib', 'index.js')
if (!fs.existsSync(art)) {
  rec('B/C 产物存在（否则本负控无对象）', false, `产物缺失：${art}`)
} else if (decls.length === 0) {
  rec('B/C 产物存在（否则本负控无对象）', false, '无锚点可用 ⇒ 跳过')
} else {
  const artBytes = fs.readFileSync(art)
  const rebuild = (entry) => {
    const tmp = path.join(os.tmpdir(), `a14nc-${process.pid}-${Math.random().toString(36).slice(2)}.js`)
    try {
      execFileSync(process.execPath, [ESB, entry, '--bundle', '--format=esm', '--platform=node',
        `--outfile=${tmp}`, '--log-level=warning'], { cwd: PKG, stdio: 'pipe', maxBuffer: 64e6 })
      return fs.readFileSync(tmp)
    } finally { try { fs.unlinkSync(tmp) } catch { /* 已删 */ } }
  }

  // C. 用「解析出的 entry」重编译 ⇒ 必须与产物逐字节一致
  let cOk = false; let cNote = ''
  for (const d of decls) {
    if (!fs.existsSync(path.join(PKG, d.entry))) { cNote = `entry 不存在：${d.entry}`; continue }
    const out = rebuild(d.entry)
    if (out.length === artBytes.length && out.equals(artBytes)) { cOk = true; cNote = `${d.entry}（${d.from}）⇒ ${out.length} B 一致`; break }
    cNote = `${d.entry} ⇒ ${out.length} B ≠ 产物 ${artBytes.length} B`
  }
  rec('C 用解析出的 entry 重编译 ≡ 磁盘产物（逐字节）', cOk, cNote)

  // B. 杠杆：换一个**不是该产物**的 entry ⇒ 必须产出不同字节
  //    （取 `src/dsh-plugin-undo/index.ts`：同仓真实存在的另一个插件 entry，语法合法但内容不同）
  const wrongEntry = 'src/dsht-plugin-undo/index.ts'
  if (fs.existsSync(path.join(PKG, wrongEntry))) {
    const wrong = rebuild(wrongEntry)
    const differs = !(wrong.length === artBytes.length && wrong.equals(artBytes))
    rec('B 杠杆：换一个错误 entry ⇒ 字节必然不同（证明该判据有区分力）', differs,
      `${wrongEntry} ⇒ ${wrong.length} B vs 产物 ${artBytes.length} B`)
  } else {
    rec('B 杠杆：换一个错误 entry ⇒ 字节必然不同（证明该判据有区分力）', false,
      `杠杆用的 entry 不存在（${wrongEntry}）⇒ 无法证明区分力`)
  }
}

let pass = 0
console.log('=== A14 锚点负控（真实仓库）===')
for (const [label, ok, extra] of RESULTS) {
  if (ok) pass++
  console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label}${extra ? `\n        ${extra}` : ''}`)
}
// ★★ **W72：接入单源自证分数契约**（**P-50**）——
//   此前收尾是自造行 `[a14-anchor negctl] 3/3 PASS`（**形态自造**）⇒ 机器读不出 ⇒
//   文档里的分数声明**无法被证伪**（**P-11 元级**）⇒ 按 **P-1** 复用唯一产出点。
reportSelftest('a14-anchor-negctl', pass, RESULTS.length)
process.exit(pass === RESULTS.length ? 0 : 1)
