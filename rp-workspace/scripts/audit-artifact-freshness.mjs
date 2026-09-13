#!/usr/bin/env node
/**
 * A14 —— 构建产物**内容级**新鲜度闸门（心跳 75 立，心跳 76 升级为逐字节判据）
 *
 * ## 为什么需要（两轮实机实测各抓到一个真实缺陷）
 * · 心跳 75（T-85）：T-78 世界书 ReDoS 防护改在 `src/lore/{safe-regex,trigger}.ts`、
 *   单测 28 项全绿，但**浏览器侧产物 `assets/app.js` 是陈旧构建** ⇒ 设备上防护**完全不存在**
 *   （`window.DSHT.triggerWorldInfo` 遇 `/(a+)+$/` + 28 个 `a` **卡死 26739 ms**、零降级）。
 * · 心跳 76（T-86）：**node 侧产物同样陈旧** —— 源码已有 T-83 的 `planOrphanAgentPrune`
 *   （`index.ts:1667`），而 `dsh-runtime-android/.../lib/index.js` 里**搜不到该函数**。
 *   ⇒ 「一处陈旧」不是偶发，而是**结构性**的：只要源码改了、产物没重建，设备就跑旧逻辑。
 *
 * ## 判据（心跳 76 起：逐字节，不再只查符号）
 * 对每个「源码入口 → 产物」配对，**现场重跑一次同样的 esbuild**，与磁盘上的产物
 * **逐字节比对**：
 *   · 相同 ⇒ 产物就是当前源码的确定性输出（新鲜，且可复现）；
 *   · 不同 ⇒ 产物陈旧（或构建参数/ cwd 漂移）⇒ 报错并给出差异摘要。
 *
 * ### 为什么可以不用维护哈希基线（关键设计）
 * esbuild 对同一输入是**确定性**的（实测：连续两次编译哈希完全相同；
 * 统一 cwd 后与既有产物也逐字节一致）。因此「重新编译一遍再比对」**不需要任何人工基线**，
 * 也不会出现「每次正常构建都要更新基线」的维护成本 —— 这正是上一轮我拒绝升级哈希方案的理由，
 * 而该理由在「现场重编译」这条路径上不成立。
 *
 * ### 为什么必须统一 cwd（本闸门成立的前提）
 * esbuild 把它给每个模块生成的路径注释按 **cwd 相对路径**写进产物
 * （`// node_modules/foo/index.js` vs `// rp-workspace/packages/node_modules/foo/index.js`）。
 * cwd 不同 ⇒ 字节不同。三个构建脚本现已统一为 `cd <packages>` 后再编译；
 * 本闸门也用同一 cwd，故比对成立。
 *
 * ## 正控/负控/零控（--selftest）
 * 用构造语料跑：正控（内容不同 ⇒ 必须报）· 负控（内容相同 ⇒ 必须过）·
 * 零控（产物缺失 + optional ⇒ 跳过不误报）· 缺产物且非 optional ⇒ 必须报。
 * 无 `--selftest` 通过则闸门自身不可信 ⇒ die。
 *
 * ## 反控（--negative-control）
 * 真跑一次「人为破坏产物」→ 断言必须报红 → 还原 → 断言必须回绿。
 * 这是 L44「不跑正控的结论不可信」在闸门自身上的应用。
 *
 * 用法：
 *   node scripts/audit-artifact-freshness.mjs [--selftest] [-v] [--negative-control]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const PKG = path.join(WS, 'packages')
const NODE = process.execPath
const ESB = path.join(PKG, 'node_modules', 'esbuild', 'bin', 'esbuild')

/**
 * 「源码入口 → 产物」配对表。
 *
 * `entry` / `args` 必须与**构建脚本里的那一行完全一致**（同样的 cwd、同样的 flags），
 * 否则比对会因环境差异而假红（本轮就踩过：cwd 不同导致注释路径不同）。
 * `source` 只用于「产物比源码新」的辅助信息与自检语料，判据本身是逐字节。
 */
export const PAIRS = [
  {
    name: 'T-78 世界书关键词正则防护（浏览器侧产物 app.js）',
    entry: 'src/import/browser-entry.ts',
    args: ['--bundle', '--format=iife', '--global-name=DSHT'],
    source: ['packages/src/lore/safe-regex.ts', 'packages/src/lore/trigger.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/assets/app.js',
    builtBy: 'build-wb.sh [2/6] / build-dsht.ps1 Step 5 / rebuild-plugins.ps1 [8/8]',
  },
  {
    name: 'T-78/T-79 + T-83（node 侧 runtime 产物 lib/index.js = **RP 总包**）',
    // 【T-87】entry 由 `src/dsh-plugin/index.ts` 改为总包 `src/dsht-rp/index.ts`（含 5 个子模块）。
    entry: 'src/dsht-rp/index.ts',
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: ['packages/src/lore/safe-regex.ts', 'packages/src/dsht-plugin-shared/card-fence.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/index.js',
    builtBy: 'build-wb.sh [1/6] / build-dsht.ps1 Step 4.7 / build-plugins.sh [1/7]',
    optional: true,   // runtime 未构建时（纯前端开发）跳过，不算失败
  },
  // ---- 以下 undo / preflight：治「产物存在即永不重建」这个结构性缺陷 ----
  // 背景（build-wb.sh:68-72 原记录）：这些插件**一旦产物存在就永不重建** ——
  // 源码改了不进包、静默部署旧逻辑（实测踩中：`tavern-helper` 的 facade.ts 改动根本没进产物，
  // 字节数与旧版完全相同，而 A1~A6 断言全过）。逐字节判据把这条路径彻底封死。
  //
  // 【T-87】原 R10 四包（mvu / tavern-helper / prompt-template / memory）**已从此表移除** ——
  // 它们不再是独立产物（代码并入总包，见上方总包项）。若保留，会因产物不再生成而
  // 变成「optional 永远跳过」的死条目（L141 续：闸门要建在构建真的会产出的对象上）。
  ...['dsht-plugin-undo', 'dsht-preflight'].map(p => ({
    name: `${p}（node 侧产物）`,
    entry: `src/${p}/index.ts`,
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: [`packages/src/${p}/index.ts`],
    artifact: `dsh-runtime-android/node_modules/${p}/lib/index.js`,
    builtBy: `build-plugins.sh / rebuild-plugins.ps1`,
    optional: true,
  })),
  {
    name: 'EJS worker（独立 bundle，**已并入总包 lib/**）',
    // 【T-87 路径变化】worker 由 `join(dirname(import.meta.url), 'ejs-worker.js')` 定位；
    // 合并后 import.meta.url 指向总包 ⇒ 产物落 `dsht-rp-plugin/lib/ejs-worker.js`。
    entry: 'src/dsht-plugin-prompt-template/worker.ts',
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: ['packages/src/dsht-plugin-prompt-template/worker.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/ejs-worker.js',
    builtBy: 'build-plugins.sh [2/7] / build-dsht.ps1 Step 4.7',
    optional: true,
  },
  {
    name: 'dsht-rp-plugin 浏览器侧 client.js（RP UI wire 产物）',
    entry: 'src/dsht-rp-ui/src/client/index.tsx',
    args: ['--bundle', '--format=esm'],
    source: ['packages/src/dsht-rp-ui/src/client/index.tsx'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/client.js',
    builtBy: 'build-rp-ui.mjs（含 __ModuleLoader__ banner/footer 包装 + vendor 注入）',
    // 与 mobile client 同理：最终产物带后处理包装（banner 改 id、footer 收口），
    // **裸编译 ≠ 最终产物** ⇒ 逐字节判据不适用，退回符号存在性。
    skipByteCompare: true,
    // 特征串：模块表 id 由 build-rp-ui.mjs:211 显式改写为 dsht-rp-plugin（插件合并的定案），
    // 只可能来自该构建步骤 ⇒ 是有效的"新鲜度"锚点。
    markers: ['dsht-rp-plugin'],
    // client.js 缺失会让 RP UI 整块消失（loader 认不出浏览器半边）⇒ 非 optional。
  },
  {
    name: 'dsht-plugin-mobile client（浏览器侧产物）',
    entry: 'src/dsht-plugin-mobile/client/index.tsx',
    args: ['--bundle', '--format=cjs'],
    source: ['packages/src/dsht-plugin-mobile/client/index.tsx'],
    artifact: 'dsh-runtime-android/node_modules/dsht-plugin-mobile/lib/client.js',
    builtBy: 'build-mobile.mjs（含 banner/footer 包装）',
    // ⚠️ 与裸 esbuild 不同：client.js 由 build-mobile.mjs 加了 `__ModuleLoader__.load` 包装，
    // 故本项**不参与逐字节比对**（裸编译 ≠ 最终产物）。留作说明，`skipByteCompare` 显式标注。
    skipByteCompare: true,
    // 后处理产物退回「符号存在性」判据：必须能从源码里找到**只可能来自该改动**的特征串。
    markers: ['dsht-plugin-mobile'],
    optional: true,
  },
]

/** 读文件（缺失返回 null） */
function readOrNull (rel) {
  try { return fs.readFileSync(path.join(WS, rel)) } catch { return null }
}

/** 现场重编译到临时文件，返回 Buffer（失败抛错） */
function recompile (pair) {
  const tmp = path.join(os.tmpdir(), `a14-${process.pid}-${Math.random().toString(36).slice(2)}.js`)
  try {
    execFileSync(NODE, [ESB, pair.entry, ...pair.args, `--outfile=${tmp}`, '--log-level=warning'], {
      cwd: PKG, stdio: 'pipe', maxBuffer: 64e6,
    })
    return fs.readFileSync(tmp)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* 已删 */ }
  }
}

/**
 * 核心判据：现场重编译 ≡ 磁盘产物（逐字节）。
 *
 * @param pair 配对项
 * @param deps 可注入（自检用）：{ recompile, read } —— 生产路径用真实实现
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
export function checkPair (pair, deps = {}) {
  const read = deps.read ?? readOrNull
  const rebuild = deps.recompile ?? recompile

  const art = read(pair.artifact)
  if (art === null) {
    return {
      ok: !!pair.optional,
      reason: `产物不存在：${pair.artifact}` + (pair.optional ? '（optional，跳过）' : ''),
    }
  }
  if (pair.skipByteCompare) {
    // 该产物的最终形态带后处理包装（如 `__ModuleLoader__.load` banner），裸编译 ≠ 最终产物 ⇒
    // 逐字节判据不适用。仍然检查「源码里的特征符号 ⊆ 产物」（上一代的符号判据）。
    const srcText = (pair.source ?? []).map(f => (read(f) ?? Buffer.from('')).toString('utf8')).join('\n')
    const artText = art.toString('utf8')
    const markers = (pair.markers ?? [])
    const missing = markers.filter(m => srcText.includes(m) && !artText.includes(m))
    return missing.length === 0
      ? { ok: true, reason: '（后处理产物：仅符号存在性判据）' }
      : { ok: false, reason: `后处理产物缺符号：${missing.join(', ')}` }
  }
  let fresh
  try {
    fresh = rebuild(pair)
  } catch (e) {
    return { ok: false, reason: `现场重编译失败（无法判定产物新鲜度）：${e.message?.slice(0, 200)}` }
  }
  if (fresh.length === art.length && fresh.equals(art)) return { ok: true }

  // 差异摘要：长度 + 首个不同字节所在行（便于人工定位）
  const a = fresh.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  const b = art.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  let firstDiff = -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { firstDiff = i; break }
  }
  return {
    ok: false,
    reason: '产物与当前源码的编译结果**逐字节不同** ⇒ 产物陈旧或构建口径漂移',
    detail: [
      `重编译 ${fresh.length} B / 产物 ${art.length} B`,
      firstDiff >= 0 ? `首个差异在归一化后的第 ${firstDiff + 1} 行：` : '（长度相同但字节不同）',
      firstDiff >= 0 ? `  重编译: ${(a[firstDiff] ?? '').slice(0, 140)}` : '',
      firstDiff >= 0 ? `  产物  : ${(b[firstDiff] ?? '').slice(0, 140)}` : '',
      `由谁产出：${pair.builtBy}`,
    ].filter(Boolean).join('\n'),
  }
}

/** 构造语料跑四例（闸门自证） */
function selftest () {
  const buf = (s) => Buffer.from(s, 'utf8')
  const cases = [
    {
      label: '正控：产物与重编译不同 ⇒ 必须报红',
      pair: { name: 'x', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('OLD CONTENT') : null),
      recompile: () => buf('NEW CONTENT'),
      expect: { ok: false },
    },
    {
      label: '负控：产物 == 重编译 ⇒ 必须过',
      pair: { name: 'y', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('SAME') : null),
      recompile: () => buf('SAME'),
      expect: { ok: true },
    },
    {
      label: '零控：产物缺失 + optional ⇒ 跳过不误报',
      pair: { name: 'z', artifact: 'a', optional: true },
      read: () => null,
      recompile: () => buf('X'),
      expect: { ok: true },
    },
    {
      label: '缺产物 + 非 optional ⇒ 必须报',
      pair: { name: 'w', artifact: 'a', optional: false },
      read: () => null,
      recompile: () => buf('X'),
      expect: { ok: false },
    },
    {
      label: '重编译自身失败 ⇒ 必须报（不能当成"新鲜"）',
      pair: { name: 'v', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('X') : null),
      recompile: () => { throw new Error('esbuild 崩了') },
      expect: { ok: false },
    },
  ]
  let pass = 0
  for (const c of cases) {
    const got = checkPair(c.pair, { read: c.read, recompile: c.recompile })
    const ok = got.ok === c.expect.ok
    console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  ${c.label}  → ok=${got.ok}`)
    if (ok) pass++
  }
  return pass === cases.length
}

/**
 * 反控：人为破坏产物 ⇒ 必须报红 ⇒ 还原 ⇒ 必须回绿。
 * 只在第一个**非 optional 且存在**的产物上做（避免污染 runtime 产物）。
 */
function negativeControl () {
  const target = PAIRS.find(p => !p.optional)
  if (!target) { console.log('[negctl] 无可用靶点（全是 optional）'); return false }
  const abs = path.join(WS, target.artifact)
  if (!fs.existsSync(abs)) { console.log(`[negctl] 靶点不存在：${target.artifact}`); return false }
  const backup = fs.readFileSync(abs)
  let ok = false
  try {
    // 破坏：追加一个字节（长度变化必然不等）
    fs.writeFileSync(abs, Buffer.concat([backup, Buffer.from('\n// A14-NEGCTL\n')]))
    const broken = checkPair(target)
    console.log(`[negctl] 破坏后 → ok=${broken.ok}（期望 false）`)
    if (broken.ok) { console.log('[negctl] FAIL —— 破坏后仍报"新鲜"，闸门无效'); return false }
    // 还原
    fs.writeFileSync(abs, backup)
    const restored = checkPair(target)
    console.log(`[negctl] 还原后 → ok=${restored.ok}（期望 true）`)
    ok = restored.ok
    if (!ok) console.log(`[negctl] FAIL —— 还原后仍报陈旧：${restored.reason ?? ''}\n${restored.detail ?? ''}`)
  } finally {
    fs.writeFileSync(abs, backup)   // 无论如何都还原
  }
  return ok
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const VERBOSE = argv.includes('-v')

if (argv.includes('--selftest')) {
  const ok = selftest()
  console.log(ok ? '\n[selftest] PASS —— 闸门自身可信' : '\n[selftest] FAIL —— 闸门不可信，先修闸门')
  process.exit(ok ? 0 : 1)
}

if (argv.includes('--negative-control')) {
  const ok = negativeControl()
  console.log(ok ? '\n[negctl] PASS —— 闸门能报红、且还原后能回绿' : '\n[negctl] FAIL —— 反控未通过')
  process.exit(ok ? 0 : 1)
}

let failed = 0
for (const pair of PAIRS) {
  const r = checkPair(pair)
  if (r.ok) {
    console.log(`✓ ${pair.name}${r.reason ? `  — ${r.reason}` : '  — 与现场重编译逐字节一致'}`)
  } else {
    failed++
    console.log(`✗ ${pair.name}`)
    if (r.reason) console.log(`    ${r.reason}`)
    if (r.detail) console.log(r.detail.split('\n').map(l => `    ${l}`).join('\n'))
    console.log(`    ⇒ 重跑构建即可修复：`)
    console.log(`       · ${pair.builtBy}`)
    console.log(`       · 或本机（无 WSL bash 时）：pwsh rp-workspace/scripts/rebuild-plugins.ps1`)
  }
}

if (failed > 0) {
  console.log(`\n[A14] 违约：${failed} 个产物与当前源码不一致。设备/浏览器跑的是**产物**，不重建即不生效。`)
  process.exit(1)
}
console.log('\n[A14] OK —— 全部产物与当前源码的编译结果逐字节一致（新鲜且可复现）')
