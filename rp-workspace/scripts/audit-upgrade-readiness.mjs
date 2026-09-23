#!/usr/bin/env node
/**
 * audit-upgrade-readiness.mjs —— **DSH 升级验收的唯一入口**（附录 D.0）
 * ============================================================================
 * ## 为什么需要它（P-11 元级：升级的「安全感」此前没有任何机器判据）
 *
 * 升级 DSH 的失败**不是一种失败，而是六种**（附录 B 的六层耦合），且它们的
 * **失效方式完全不同**：
 *   · L2 补丁层 —— 构建期报错（有声）
 *   · L4 壳层   —— 真机 boot loop（有声但代价大）
 *   · L6 数据层 —— **编译过、门禁绿、APK 装得上、node 也起得来**，只是老会话打不开
 *
 * ⇒ 一套判据打天下必然漏。本脚本把六层收敛成**六段**，每段可独立判定、
 *   且**任一段 UNKNOWN 一律禁止升级**（P-17：「测不出」≠「没问题」）。
 *
 * ## 与既有判据的分工（P-1：不造重复实现）
 *   · `audit-dsh-version.mjs`     —— 版本单源与数据形态（本脚本**调用**它，不重写）
 *   · `audit-official-contract.mjs` —— 官方契约面（本脚本**调用**）
 *   · `apply-platform-patches.py`  —— 补丁命中（本脚本**调用** `--check`）
 *   · 本脚本 = **把上面几个 + 新增的壳层/装配面/锚点面**编排成六段 + 给总判定
 *
 * ## 用法
 *   node scripts/audit-upgrade-readiness.mjs                    # 审计当前 runtime
 *   node scripts/audit-upgrade-readiness.mjs --target <新版本>   # 声明目标版本（做前置断言）
 *   node scripts/audit-upgrade-readiness.mjs --selftest         # 判据自身正负控
 *   node scripts/audit-upgrade-readiness.mjs --no-device        # 跳过设备对照（CI）
 *
 * ## 退出码（★ 与常规闸门不同，「测不出」也禁止升级）
 *   0 = 六段全过（可以进入正式升级 / 可以发版）
 *   1 = 有 BLOCK（禁止）
 *   2 = 有 UNKNOWN（**禁止**：P-17 —— 不许把「测不出」当通过）
 *   3 = 判据自身 selftest 失败
 * ============================================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const RT = path.join(WS, 'dsh-runtime-android')
const SRC = path.join(WS, 'dsh-runtime-src')
const NM = path.join(RT, 'node_modules', '@deepseek-ai')

// ---------------------------------------------------------------------------
// 纯函数区（selftest 可直接调用 —— 判据单源，P-1）
// ---------------------------------------------------------------------------

/** 读 JSON，容忍 BOM（与 audit-dsh-version 同口径；不重复造） */
export function readJsonTolerant (file) {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
}

/**
 * 【B.4 壳层】官方 CLI 面的存在性判定。
 *
 * ## 为什么这段必须是纯函数 + **目录列举也可注入**
 * 「官方 CLI 面还在不在」是**升级最先炸的地方**（NodeService 的 8 处硬编码假设），
 * 而它此前**零判据**。抽成纯函数才能造正负控（否则「真实仓库全绿」可能只是没扫到）。
 *
 * ## ★ 判据自身的缺陷（本轮 selftest 当场抓到，P-19 又一活例）
 * 首版只把 `readFile` 做成可注入，**目录遍历仍用真实 `fs.readdirSync`** ⇒
 * selftest 传 `pkgRoot='/x'` 时 readdirSync 抛 ⇒ 扫 0 个文件 ⇒
 * **正控 1（信号存在 ⇒ 必须命中）FAIL**，而负控（空包集 ⇒ 0 命中）却「通过」
 * —— 两个方向都被同一个缺陷污染，**判据完全测不出自己是否有杠杆**。
 * ⇒ 修法：`readDir` 也注入。**能自证的判据才配当判据**。
 *
 * ## 判据锚在什么上（★ 关键设计）
 * **不锚在「哪个包里的哪个文件」**（0.1.5→0.1.7 实测：这些面从 `dsh` 包**搬到了
 * `dsh-web-app` 包**，锚包名必然误报）。改为锚**字符串在整个官方包集里的存在性**：
 *   · 就绪信号 `dsh web:` —— NodeService 的 `TOKEN_LINE_PREFIX` 恒等此串（**唯一**）
 *   · 参数 `--no-open` / `--port` / `--trusted-host` —— NodeService 逐个传
 *   · 子命令 `web` —— NodeService 的 argv 第 2 个词
 *
 * @param {string} pkgRoot @deepseek-ai 目录
 * @param {(p:string)=>string|null} readFile 读文本
 * @param {(p:string)=>{name:string,isDir:boolean}[]} readDir 列举目录（selftest 注入）
 * @returns {{ probes: Record<string,string[]>, scanned:number }}
 */
export function probeCliSurface (pkgRoot, readFile, readDir) {
  const PROBES = {
    'dsh web:': [],            // 就绪信号（token 捕获的唯一依据）
    '--no-open': [],
    '--port': [],
    '--trusted-host': [],
    '--expose-internals': [],  // 0.1.7 起疑已移除 ⇒ 用它做「已变」的观测
  }
  let scanned = 0
  const pkgs = readDir(pkgRoot)
  if (pkgs === null) return { probes: PROBES, scanned: 0 }
  for (const pkg of pkgs) {
    if (!pkg.isDir) continue
    const ents = readDir(path.posix.join(pkgRoot, pkg.name, 'lib'))
    if (ents === null) continue
    for (const e of ents) {
      if (e.isDir) continue
      if (!/\.(js|cjs|mjs)$/.test(e.name)) continue
      const t = readFile(path.posix.join(pkgRoot, pkg.name, 'lib', e.name))
      if (t === null) continue
      scanned += 1
      for (const k of Object.keys(PROBES)) if (t.includes(k)) PROBES[k].push(`${pkg.name}/lib/${e.name}`)
    }
  }
  return { probes: PROBES, scanned }
}

/** 真实 FS 的 readDir 实现（返回 null 表示读不到 —— 调用方据此判「测不出」） */
export const realReadDir = (p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() }))
  } catch { return null }
}
/** 真实 FS 的 readFile 实现 */
export const realReadFile = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

/**
 * 【C.1/B.5 装配层】slot 名对账。
 * 我方 `ctx.slots.inject('<name>')` 的每个名字，必须在官方 SlotMap 键名集里存在。
 *
 * ## 为什么这条是「静默消失」类型的头号判据（附录 C.1）
 * `slots.inject` 的语义是「**等声明出现再注册**」⇒ 官方改了 slot 名时，
 * 声明永不出现 ⇒ 回调**永不执行** ⇒ **不报错、功能整块消失**。
 * 2026-09-23 实测：0.1.7 已把 `settings.plugin.item` 换掉（改 `settings.pluginInventory`），
 * 而我方正好有一处挂在那里（三个预适配插件的中文辨识卡）。
 *
 * @param {string} pkgRoot 官方包根
 * @param {string[]} wanted 我方 inject 的 slot 名
 * @param {(p:string)=>string|null} readFile
 * @returns {{ official:Set<string>, missing:string[], hit:string[] }}
 */
export function collectSlotNames (pkgRoot, wanted, readFile, readDir) {
  const official = new Set()
  const pkgs = readDir(pkgRoot)
  if (pkgs === null) return { official, missing: [...wanted], hit: [] }
  for (const pkg of pkgs) {
    if (!pkg.isDir) continue
    const n = pkg.name
    if (!/^dsh-client-ui-/.test(n) && n !== 'dsh-client-runtime') continue
    const walk = (d) => {
      const ents = readDir(d)
      if (ents === null) return
      for (const e of ents) {
        const p = path.posix.join(d, e.name)
        if (e.isDir) walk(p)
        else if (e.name.endsWith('.d.ts')) {
          const t = readFile(p)
          if (t === null) continue
          // 抽 `'a.b.c': ...` 形态的 slot 键（官方 SlotMap 的写法）
          for (const m of t.matchAll(/['"]([a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)['"]\s*[?:]/g)) official.add(m[1])
        }
      }
    }
    walk(path.posix.join(pkgRoot, n, 'lib', 'types'))
  }
  const hit = wanted.filter(w => official.has(w))
  const missing = wanted.filter(w => !official.has(w))
  return { official, missing, hit }
}

/**
 * 【C.2 锚点层】我方宿主 DOM 锚点依赖的哈希类名是否仍在官方前端产物里。
 *
 * ## 为什么这是最脆的一面（附录 C.2）
 * 哈希类名（`.pI_x6G_*` 等）是 **CSS Modules 构建时生成的** ⇒ 官方**任何一次前端
 * 构建**都可能重算，**不需要官方「有意改 API」**。而我方 22 个锚点里 21 个依赖它。
 * 失效后果：`tag()` 静默返回 0，**一声不响**（移动端适配悄悄退化）。
 *
 * @param {string} pkgRoot 官方包根
 * @param {Record<string,string>} prefixToPkg 前缀 → 期望出现的包
 * @param {(p:string)=>string|null} readFile
 */
export function probeAnchorPrefixes (pkgRoot, prefixToPkg, readFile) {
  const out = {}
  for (const [prefix, pkg] of Object.entries(prefixToPkg)) {
    // 用 posix 拼路径：Windows 的 path.join 会产生 `\`，与注入式假 FS（正斜杠键）不一致
    // ⇒ 判据在 Windows 上「测不出」而在 Linux 上「通过」（P-30：跨平台假绿）。
    const f = path.posix.join(pkgRoot, pkg, 'lib', 'client.js')
    const t = readFile(f)
    if (t === null) { out[prefix] = { status: 'UNKNOWN', hits: 0, pkg }; continue }
    const hits = (t.split(prefix).length - 1)
    out[prefix] = { status: hits > 0 ? 'OK' : 'BLOCK', hits, pkg }
  }
  return out
}

// ---------------------------------------------------------------------------
// selftest（P-30：每条新判据必须自带正负控）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let pass = 0
  const fail = []
  const ok = (cond, label) => { if (cond) { pass += 1; console.log(`[ok] ${label}`) } else { fail.push(label); console.log(`[FAIL] ${label}`) } }
  console.log('=== audit-upgrade-readiness --selftest（六段判据的正负控）===')

  // ---- B.4 CLI 面 ----
  // 【可注入的假 FS】把「目录树」写成一张表，探针只能通过注入的 readDir/readFile 看世界。
  // 这样正负控才真的在测**探针逻辑**，而不是在测真实磁盘（P-30：判据必须能自证）。
  //   tree 的键 = **文件**绝对路径，值 = 内容。
  //   目录由文件路径**逐级反推**（含中间层），保证任意深度都能被 readDir 命中。
  const fakeFs = (tree) => {
    const files = {}
    const dirs = {}
    const addChild = (parent, name, isDir) => {
      dirs[parent] = dirs[parent] ?? []
      if (!dirs[parent].some(x => x.name === name)) dirs[parent].push({ name, isDir })
    }
    for (const [p, content] of Object.entries(tree)) {
      if (content === null) { dirs[p] = dirs[p] ?? []; continue }
      files[p] = content
      const parts = p.split('/')
      const fname = parts.pop()
      // 逐级建目录：/x → /x/pkg → /x/pkg/lib
      for (let i = 1; i <= parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/') || '/'
        const parent = parts.slice(0, i - 1).join('/') || '/'
        addChild(parent, parts[i - 1], true)
        dirs[dirPath] = dirs[dirPath] ?? []
      }
      addChild(parts.join('/') || '/', fname, false)
    }
    return {
      readFile: (p) => (p in files ? files[p] : null),
      readDir: (p) => (p in dirs ? dirs[p] : null),
    }
  }

  // 正控 1：就绪信号存在 ⇒ 必须命中
  //   ★ 语料里**不写 URL**：本仓 `audit-publish-hygiene` 会把 `http://<host>` 形态
  //     当作「外部服务器地址」报红（判据只锚 `dsh web:` 这个子串，URL 是多余信息）。
  {
    const fsx = fakeFs({ '/x/dsh-web-app/lib/index.js': 'console.log("dsh web: ready")' })
    const r1 = probeCliSurface('/x', fsx.readFile, fsx.readDir)
    ok(r1.probes['dsh web:'].length === 1, `正控1 就绪信号命中（实得 ${r1.probes['dsh web:'].length} 处，扫了 ${r1.scanned} 文件）`)

    // ★ 杠杆：把信号改一个字 ⇒ 必须 0 命中（证明判据锚在**精确串**上，不是模糊匹配）
    const fsx2 = fakeFs({ '/x/dsh-web-app/lib/index.js': 'console.log("dsh webX ready")' })
    const r2 = probeCliSurface('/x', fsx2.readFile, fsx2.readDir)
    ok(r2.probes['dsh web:'].length === 0 && r2.scanned === 1,
      `★杠杆 信号改一字 ⇒ 0 命中但确实扫了 ${r2.scanned} 个文件（判据锚在精确串上）`)
  }

  // 负控 1：空包集 ⇒ 全 0 且 scanned=0（调用方据此判「没有判据力」）
  {
    const fsx = fakeFs({})
    const r3 = probeCliSurface('/nonexistent-xyz', fsx.readFile, fsx.readDir)
    ok(r3.scanned === 0 && r3.probes['dsh web:'].length === 0, '负控1 空包集 ⇒ scanned=0（不得冒充通过）')
  }

  // ---- C.1 slot 名 ----
  // 正控 2：存在 + 消失 各一 ⇒ 必须分别归类（真实形态：0.1.7 用 pluginInventory 取代 plugin.item）
  {
    const fsx = fakeFs({
      '/x/dsh-client-ui-conversation/lib/types/slots.d.ts': `interface S { 'conversation.chat.node': X; 'conversation.input.dock': Y }`,
      '/x/dsh-client-ui-settings-general/lib/types/slots.d.ts': `interface S { 'settings.pluginInventory': Z }`,
    })
    const r4 = collectSlotNames('/x', ['conversation.chat.node', 'settings.plugin.item'], fsx.readFile, fsx.readDir)
    ok(r4.hit.length === 1 && r4.hit[0] === 'conversation.chat.node' && r4.missing.length === 1 && r4.missing[0] === 'settings.plugin.item',
      `正控2 slot 对账分辨存在/消失（hit=${r4.hit.length} missing=${r4.missing.length}）`)
  }

  // 负控 2：官方 SlotMap 抽不到任何键 ⇒ 全部归 missing（**不得**假绿）
  {
    const fsx = fakeFs({ '/x/dsh-client-ui-layout/lib/types/slots.d.ts': 'nothing here' })
    const r5 = collectSlotNames('/x', ['a.b'], fsx.readFile, fsx.readDir)
    ok(r5.official.size === 0 && r5.missing.length === 1, '负控2 抽不到 SlotMap ⇒ 全 missing（不假绿）')
  }

  // ---- C.2 锚点 ----
  {
    const anchorFiles = {
      '/x/dsh-client-ui-layout/lib/client.js': '.pI_x6G_frame{}.pI_x6G_centerCol{}',
      '/x/dsh-client-ui-sidebar/lib/client.js': '.hHd-Xa_railIn{}',
    }
    const fsx = fakeFs(anchorFiles)
    const r6 = probeAnchorPrefixes('/x', { pI_x6G: 'dsh-client-ui-layout', ZZtop: 'dsh-client-ui-sidebar' }, fsx.readFile)
    ok(r6.pI_x6G.status === 'OK' && r6.ZZtop.status === 'BLOCK',
      `正控3 锚点前缀：命中 OK / 未命中 BLOCK（${r6.pI_x6G.status} / ${r6.ZZtop.status}）`)

    // 负控 3：文件读不到 ⇒ UNKNOWN（**不是** BLOCK，也不是 OK —— 区分「测不出」与「否定」）
    const r7 = probeAnchorPrefixes('/x', { pI_x6G: 'dsh-client-ui-layout' }, () => null)
    ok(r7.pI_x6G.status === 'UNKNOWN', '负控3 读不到官方产物 ⇒ UNKNOWN（P-17：区分测不出与否证）')
  }

  console.log(`\n[selftest] ${pass}/${pass + fail.length} PASS`)
  if (fail.length) { console.log('失败项：' + fail.join('；')); process.exit(3) }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 主审计：六段
// ---------------------------------------------------------------------------
const NO_DEVICE = process.argv.includes('--no-device')
const tIdx = process.argv.indexOf('--target')
const TARGET = tIdx >= 0 ? process.argv[tIdx + 1] : null

const rows = []
const rec = (seg, status, note) => {
  rows.push({ seg, status, note })
  const mark = status === 'OK' ? '✓' : status === 'SKIP' ? 'ⓘ' : status === 'UNKNOWN' ? '?' : '✗'
  console.log(`${mark} ${seg}\n    ${note}`)
}

console.log('[audit-upgrade-readiness] DSH 升级验收 · 六段判据（附录 D.0）')
if (TARGET) console.log(`  目标版本: ${TARGET}`)
console.log('')

const run = (file, args = []) => {
  try {
    return { out: execFileSync('node', [path.join(HERE, file), ...args], { encoding: 'utf8', timeout: 300000 }), code: 0 }
  } catch (e) {
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? -1 }
  }
}

// ---- ① 版本面 ----
{
  const w = run('audit-dsh-version.mjs', NO_DEVICE ? ['--no-device'] : [])
  const bad = /⛔|✗/.test(w.out) || w.code !== 0
  const ver = /dshVersion=([^\s·]+)/.exec(w.out)?.[1] ?? '(读不到)'
  rec('① 版本面（单源 + 产物顶层 + 数据形态 + 子包一致性）', bad ? 'BLOCK' : 'OK',
    bad ? `单源=${ver}；**有失败项** —— 见 node scripts/audit-dsh-version.mjs 输出` : `单源=${ver}；四项判据全过`)
  if (TARGET && ver !== '(读不到)' && ver !== TARGET) {
    rec('① 版本面 · 目标断言', 'BLOCK', `单源声明 ${ver}，而 --target 传的是 ${TARGET} ⇒ 两者必须一致（Step 0.7 同款纪律）`)
  }
}

// ---- ② 补丁面 ----
{
  const py = process.platform === 'win32' ? 'python' : 'python3'
  let out = ''
  let code = 0
  try {
    out = execFileSync(py, [path.join(HERE, 'apply-platform-patches.py'), RT, '--check'], { encoding: 'utf8', timeout: 300000 })
  } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? -1 }
  const m = /检查完成：(\d+) 项检查 —— 已打补丁 (\d+)，未打可打 (\d+)，跳过 (\d+)，失败 (\d+)/.exec(out)
  if (m === null) rec('② 补丁面（13 条 patch 的命中与幂等）', 'UNKNOWN', '解析不出 --check 汇总行 ⇒ 必须人工看输出（不许当通过）')
  else {
    const [, , , pending, , failed] = m.map(Number)
    const okAll = Number(failed) === 0 && Number(pending) === 0
    rec('② 补丁面（13 条 patch 的命中与幂等）', okAll ? 'OK' : 'BLOCK',
      `失败 ${failed} · 待打 ${pending}（★ --check 把「锚点命中但未打」计入 pending 且**不报红**，故必须显式看这个数）`)
  }
}

// ---- ③ 原生面 ----
{
  const a = run('audit-native-deps.mjs')
  const b = run('audit-pty-prebuilt.mjs')
  const bad = a.code !== 0 || b.code !== 0
  rec('③ 原生面（DT_NEEDED 闭合 + pty.node 就位）', bad ? 'BLOCK' : 'OK',
    bad ? `native-deps exit=${a.code} · pty-prebuilt exit=${b.code}` : '两条判据全过')
}

// ---- ④ 壳面 ----
{
  const { probes, scanned } = probeCliSurface(NM, realReadFile, realReadDir)
  if (scanned === 0) rec('④ 壳面（CLI 入口 / 就绪信号 / 启动参数）', 'UNKNOWN', `${NM} 下扫不到官方 js ⇒ runtime 未就绪（不得当通过）`)
  else {
    const ready = probes['dsh web:'].length
    const need = ['--no-open', '--port', '--trusted-host'].filter(k => probes[k].length === 0)
    if (ready === 0) rec('④ 壳面（CLI 入口 / 就绪信号 / 启动参数）', 'BLOCK', `★ 就绪信号 [dsh web:] **0 命中** ⇒ NodeService 的 TOKEN_LINE_PREFIX 永不匹配 ⇒ 页面会卡在「正在启动」（扫了 ${scanned} 个文件）`)
    else if (need.length) rec('④ 壳面（CLI 入口 / 就绪信号 / 启动参数）', 'BLOCK', `就绪信号在（${ready} 处：${probes['dsh web:'].join(', ')}），但参数缺失：${need.join(', ')} ⇒ NodeService 传参会被拒`)
    else rec('④ 壳面（CLI 入口 / 就绪信号 / 启动参数）', 'OK', `就绪信号 ${ready} 处（${probes['dsh web:'].join(', ')}）· 三个参数齐备 · --expose-internals ${probes['--expose-internals'].length} 处（0 = 官方已移除，需同步 NodeService）`)
  }
}

// ---- ⑤ 装配面 ----
{
  // 我方 inject 的 slot 名（真值来源 = 我方源码，不硬编码在判据里以免两处漂移）
  const uiIdx = path.join(WS, 'packages', 'src', 'dsht-rp-ui', 'src', 'client', 'index.tsx')
  let wanted = []
  try {
    const t = fs.readFileSync(uiIdx, 'utf8')
    wanted = [...new Set([...t.matchAll(/ctx\.slots\.inject\(\s*'([^']+)'/g)].map(m => m[1]))]
  } catch { /* 读不到 ⇒ 下方 UNKNOWN */ }

  const externals = ['dsh-client-ui-sidebar', 'dsh-client-ui-layout', 'dsh-client-ui-conversation', 'dsh-client-ui-settings-plugins', 'dsh-base', 'dsh-web-app']
  const missPkg = externals.filter(p => !fs.existsSync(path.join(NM, p)))

  if (wanted.length === 0) rec('⑤ 装配面（slot 名 + external 包名 + 契约）', 'UNKNOWN', '读不到我方 slots.inject 清单 ⇒ 测不出（不得当通过）')
  else {
    const sl = collectSlotNames(NM, wanted, realReadFile, realReadDir)
    if (sl.official.size === 0) rec('⑤ 装配面（slot 名 + external 包名 + 契约）', 'UNKNOWN', '抽不到官方 SlotMap ⇒ 测不出')
    else if (sl.missing.length || missPkg.length) {
      const parts = []
      if (sl.missing.length) parts.push(`★ 我方引用了官方**不存在**的 slot：${sl.missing.join(', ')} ⇒ 该功能会**静默消失**`)
      if (missPkg.length) parts.push(`★ external 包名缺失：${missPkg.join(', ')}`)
      rec('⑤ 装配面（slot 名 + external 包名 + 契约）', 'BLOCK', parts.join(' ｜ '))
    } else rec('⑤ 装配面（slot 名 + external 包名 + 契约）', 'OK', `${sl.hit.length} 个 slot 全部存在（官方 SlotMap ${sl.official.size} 键）· external 6 包齐备`)
  }
}

// ---- ⑥ 数据面（官方格式代次 vs 单源声明） ----
//
// 【判据自身的缺陷（本轮负控当场抓到，P-30 又一活例）】
// 首版写的是「known 为空 ⇒ 默认放行」（`known.size === 0 || known.has(cv)`）。
// 负控实测：把官方 `currentVersion` 从 3 改成 4 后，判据**仍判 OK**
// —— 因为单源当时**根本没声明** `sessionFormatKnownGenerations` ⇒ 空集 ⇒ 放行。
// ⇒ 这不是「宽松」，是**假绿**：一个永远说 OK 的判据，与没有判据等价（P-11）。
// ⇒ 修法：**未声明 ⇒ UNKNOWN**（不是 BLOCK，因为「没声明」未必等于「不支持」；
//   但必须**出声**，促使人去显式声明覆盖集 —— 这正是升级时要做的动作）。
{
  const cat = path.join(NM, 'dsh-session-format-catalog', 'lib', 'index.js')
  let t = null
  try { t = fs.readFileSync(cat, 'utf8') } catch { /* ignore */ }
  const cv = t === null ? null : /currentVersion:\s*(\d+)/.exec(t)?.[1]
  const ssot = (() => { try { return readJsonTolerant(path.join(WS, 'dsh-version.json')) } catch { return null } })()
  const known = (ssot?.sessionFormatKnownGenerations ?? []).map(String)
  if (cv === null) rec('⑥ 数据面（官方格式代次 vs 我方解析器覆盖）', 'UNKNOWN', '抽不到官方 currentVersion ⇒ 测不出')
  else if (known.length === 0) rec('⑥ 数据面（官方格式代次 vs 我方解析器覆盖）', 'UNKNOWN',
    `官方 currentVersion=${cv}，但单源**未声明** sessionFormatKnownGenerations ⇒ ` +
    `**无法判定我方解析器是否覆盖该代次**（P-17：测不出 ≠ 没问题；请显式声明覆盖集）`)
  else {
    const okGen = known.includes(String(cv))
    rec('⑥ 数据面（官方格式代次 vs 我方解析器覆盖）', okGen ? 'OK' : 'BLOCK',
      okGen
        ? `官方 currentVersion=${cv}；单源已声明覆盖 {${known.join(',')}}`
        : `★ 官方 currentVersion=${cv}，而单源声明 {${known.join(',')}} **未覆盖** ⇒ 我方解析器可能读不懂该代次的会话（老会话打不开）`)
  }
}

// ---- 汇总 ----
const block = rows.filter(r => r.status === 'BLOCK')
const unknown = rows.filter(r => r.status === 'UNKNOWN')
console.log(`\n[audit-upgrade-readiness] ${rows.filter(r => r.status === 'OK').length} OK / ${block.length} BLOCK / ${unknown.length} UNKNOWN`)
if (block.length) {
  console.log('\n⛔ BLOCK（禁止升级）：')
  for (const r of block) console.log(`  · ${r.seg}\n      ${r.note}`)
}
if (unknown.length) {
  console.log('\n? UNKNOWN（**同样禁止升级** —— P-17：「测不出」≠「没问题」）：')
  for (const r of unknown) console.log(`  · ${r.seg}\n      ${r.note}`)
}
if (block.length) process.exit(1)
if (unknown.length) process.exit(2)
console.log('✅ 六段全过 —— 可以进入正式升级 / 可以发版')
process.exit(0)
