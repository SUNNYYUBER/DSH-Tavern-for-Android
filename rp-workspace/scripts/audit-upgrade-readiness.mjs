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
 *   node scripts/audit-upgrade-readiness.mjs --expect-reinstall # 本次构建会重装 ⇒ ① 段的产物对比记 SKIP 并出声
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
 * 【C.1 装配层】官方 slot 改名映射 —— 我方 inject 的旧名 ⇒ 官方**语义等价**的新名。
 *
 * ## 为什么需要「映射」而不是「改名就完了」
 * `slots.inject(name, cb)` 的语义是「**等该 slot 的声明出现再注册**」。
 * 官方改槽位名后，旧名的声明**永不出现** ⇒ 回调**永不执行** ⇒
 * **不报错、不抛异常，功能整块消失**（附录 C.1 的静默失效族）。
 * ⇒ 判据必须同时认**两种名**：旧名（我方尚未迁移）与新名（官方当下）。
 *
 * ## 本表的两类条目（★ 用途不同，别混）
 *
 * ### (a) 跨代回退对（cross-generation fallback）—— **本表的当下用途**
 * 我方源码里对**同一功能**同时保留两处 `slots.inject`（old + new），用 `if/else` 二选一：
 *   · 0.1.5：旧名有声明 ⇒ 走旧；新名不存在 ⇒ 那支是死代码；
 *   · 0.1.7：旧名无声明 ⇒ 那支永不执行；新名在 ⇒ 走新。
 * 两处 inject **都会被 ⑤ 段从我方源码收集到**（判据是文本级抽取，看不见 `if/else`）。
 * ⇒ 若旧名在官方新版 SlotMap 里已消失，⑤ 段会把它归 `missing` ⇒ **误报 BLOCK**。
 * ⇒ 正解：把 (旧名 → 新名) 登记进本表 —— `classifySlots` 见旧名不在、
 *   而**新名在** ⇒ 归 `migrated`（**出声但不 BLOCK**），语义正是
 *   「这是我方有意保留的跨代回退，不是漂移」。
 *
 * ### (b) 机械改名（mechanical rename）—— **当前为空，且必须保持为空**
 * 若官方**只改名、语义未变**，则旧名 → 新名即机械映射，登记后照常工作。
 * 但 0.1.7 的 `settings.plugin.item` **不属于此类**（见下）。
 *
 * ## ★★ 诚实登记：`settings.plugin.item → settings.pluginInventory` **不是**合法映射
 *
 * 2026-09-23 两次实测（`probe-slot-diff.mjs` 逐包抽 SlotMap 后做集合差）纠正了一个误判：
 *
 * | 版本 | `settings.plugin.item` | `settings.pluginInventory` | 语义 |
 * |---|---|---|---|
 * | 0.1.5-rc.3 | ✅ **存在** | ✅ 已存在 | 前者 = `settings-plugins` 的**可配置插件卡片**槽位；<br>后者 = **只读清单的本地化命名空间** |
 * | 0.1.7-rc.1 | ❌ **已删除** | ✅ 仍在 | 后者**语义未变**（仍是命名空间，**不是**卡片槽位） |
 *
 * ★ 我先前把映射写成 `settings.plugin.item → settings.pluginInventory` 是**错的**
 *   （把「本地化命名空间」当成了「卡片槽位」）。实测推翻了它。
 * ⇒ 若把 (a) 的跨代回退登记成这个「映射」，就等于**用代理量洗掉真失效**：
 *   0.1.7 下旧支照样是死代码，而 ⑤ 段会因为「migrated」而放行 ⇒ 假绿（P-30）。
 * ⇒ **唯一诚实的处理**：`settings.plugin.item` 在 0.1.7 **既无原名也无等价新名** ⇒
 *   让 ⑤ 段照实报 BLOCK（或用 ⑤ 段的有意豁免机制，见下），**不在本表里假装有映射**。
 *
 * ## 0.1.7 的实际模型（`PluginsSettingsSection.d.ts` 原文）
 * ```
 * /** One tab projected from a `settings.plugins.tab` contribution. *\/
 * export interface PluginsSettingsTabEntry { id: string; order: number; label: string }
 * ```
 * ⇒ Plugins 设置区已重构为「**本地化 tab + feature-owned 整页**」：
 *   `settings.plugins.tab`（`kind:'list'`, `scope:'root'`）每项是**一整页**，
 *   而**「卡片行」这一层被取消了**（`settings.plugin.item` 无等价物）。
 * ⇒ 我方那 4 张「中文辨识卡」（`<li>` 行）在新模型下**没有直接落点**——
 *   要么改成 4 个 tab（UX 变化大），要么把内容并入 RP 自己的设置面板（RP overlay）。
 *   ★ 这是**设计决策**，不是机械改名 ⇒ 记入 E 的 D.2。
 *
 * ## ★★ 已落地的处置（2026-09-23 · D.2 采用**方案 B**）
 * 我方 `dsht-rp-ui` 改为**按官方槽位是否存在自动选路径**（见 `index.tsx`）：
 *   · 有 `settings.plugin.item`（0.1.5）⇒ 4 张独立卡（行为零变化）；
 *   · 无它、有 `settings.plugins.tab`（0.1.7）⇒ 注册**一个 tab 整页**（`id:'dsht'`，方案 B）。
 * ⇒ 本表登记 **(a) 跨代回退对**：`settings.plugin.item → settings.plugins.tab`
 *   （★ 注意：**不是** → `pluginInventory`，那条是错的，见上）。
 *   语义 =「我方有意保留旧支以兼容 0.1.5；0.1.7 由新名承接」——
 *   故旧名不在官方 SlotMap 时归 `migrated`（出声）而**不是** `missing`（BLOCK）。
 *
 * ⚠️ **诚实边界（R7）**：登记 (a) 的前提是「新名**真的**承接了该功能」——
 *   这一点由**代码**保证（`else if (hasSlot(...))` 那条支），也可由负控7 的形态检验
 *   （若新名也不在官方 SlotMap ⇒ 本项目会照实 BLOCK）。
 */
export const SLOT_RENAMES = {
  // (a) 跨代回退对：0.1.5 的卡片槽位 → 0.1.7 的整页 tab（方案 B，功能由新支承接）
  'settings.plugin.item': 'settings.plugins.tab',
}

/**
 * slot 名对账（支持**改名映射**）。
 *
 * @param {Set<string>} official 官方 SlotMap 键集
 * @param {string[]} wanted 我方 inject 的 slot 名
 * @returns {{ hit:string[], migrated:Array<{from:string,to:string}>, missing:string[] }}
 *   hit      = 官方仍有该名（OK）
 *   migrated = 官方已改名，而新名在（待迁移；出声）
 *   missing  = 既无原名、也无映射后的新名（**真失效** ⇒ BLOCK）
 */
export function classifySlots (official, wanted) {
  const hit = []
  const migrated = []
  const missing = []
  for (const w of wanted) {
    if (official.has(w)) { hit.push(w); continue }
    const to = SLOT_RENAMES[w]
    if (to !== undefined && official.has(to)) { migrated.push({ from: w, to }); continue }
    missing.push(w)
  }
  return { hit, migrated, missing }
}

/**
 * 【E.1 装配层】插件 `peerDependencies` 声明检查（0.1.7-rc.1 的「插件版本号机制」）。
 *
 * ## 判据（守什么）
 * 0.1.7-rc.1 的 `dsh-app-boot.evaluatePluginCompatibility()` 会在
 * **`dsh plugin add` / 带 spec 的 `install`**（pnpm 运行**前**）检查插件 manifest 的
 * `peerDependencies`：
 *   · **未声明 ⇒ 直接放行**（我方此前正是这种「恰好通过」）；
 *   · `workspace:*` / `workspace:^` / `workspace:~` ⇒ 替换成当前 runtime 版本 ⇒ **永远满足**；
 *   · 写死的 range 参与 semver 匹配 ⇒ 不满足即 `incompatible-version` **拒绝安装**。
 *
 * ★ **实测（`tmp/probe-peer-effect.mjs` 喂官方真函数）**：
 *   `^0.1.5` ⇒ 放行 · **`^0.1.7` ⇒ 拒绝**（`0.1.7-rc.1` 是预发布，不满足 `^` 正式版语义）·
 *   `^0.2.0` ⇒ 拒绝 ⇒ **任何写死 range 都有坑，`workspace:*` 是唯一稳妥写法**。
 *
 * ## 为什么「未声明」也算 FAIL（而不是放行）
 * 未声明确实不会被拒，但：① 语义缺失（我方插件**确实**强依赖官方 client-ui 包，
 * 官方**帮助不了我们** —— 升级时不会提示不兼容）；② 一旦有人「顺手」补个 `^0.1.7`
 * （最自然的写法）⇒ 插件**在安装期被拒**，表现为「装不上」而非「跑不起来」。
 * ⇒ 判据要求**显式声明**，且**值必须是 `workspace:` 形态**。
 *
 * @param {Array<{name:string, peer:(Record<string,string>|null)}>} plugins
 * @returns {{ ok:string[], badPeerVal:string[], notWorkspace:string[], missingPeer:string[] }}
 */
export function classifyPluginPeers (plugins) {
  const ok = []
  const badPeerVal = []      // 声明了 peer，但含**写死 range** 的官方包（有被拒风险）
  const notWorkspace = []    // 声明了 peer，但**用了非 workspace 形态**
  const missingPeer = []     // 完全未声明 peerDependencies
  const OFFICIAL = (n) => n === '@deepseek-ai/dsh' || n.startsWith('@deepseek-ai/dsh-')
  for (const p of plugins) {
    if (p.peer === null) { missingPeer.push(p.name); continue }
    const officialPeers = Object.entries(p.peer).filter(([k]) => OFFICIAL(k))
    if (officialPeers.length === 0) { missingPeer.push(p.name); continue }
    const hard = officialPeers.filter(([, v]) => !/^workspace:/.test(String(v)))
    if (hard.length > 0) {
      notWorkspace.push(`${p.name}(${hard.map(([k, v]) => `${k}@${v}`).join(', ')})`)
      badPeerVal.push(p.name)
      continue
    }
    ok.push(p.name)
  }
  return { ok, badPeerVal, notWorkspace, missingPeer }
}

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

  // ---- C.1 slot 改名映射（2026-09-23 新增；★ D.2 落地后本表**非空**）----
  //   ★ 本表现有一条**真实**条目（`settings.plugin.item → settings.plugins.tab`，跨代回退对）。
  //     正控仍用**合成映射** —— 它验的是**机制**（「旧名不在而新名在 ⇒ migrated」），
  //     与「当前表里恰好有哪条数据」是两件事（P-45：判据机制 vs 当前数据）。
  {
    // 正控 4：合成映射下，旧名不在、新名在 ⇒ 必须归 migrated
    const saved = SLOT_RENAMES['synthetic.old']
    SLOT_RENAMES['synthetic.old'] = 'synthetic.new'
    try {
      const official = new Set(['synthetic.new', 'conversation.chat.node'])
      const s1 = classifySlots(official, ['synthetic.old', 'conversation.chat.node'])
      ok(s1.migrated.length === 1 && s1.migrated[0].from === 'synthetic.old' && s1.migrated[0].to === 'synthetic.new'
        && s1.hit.length === 1 && s1.missing.length === 0,
        `正控4 合成映射 ⇒ 归 migrated（hit=${s1.hit.length} migrated=${s1.migrated.length} missing=${s1.missing.length}）`)

      // ★ 杠杆：官方**两个名都没有** ⇒ 必须归 missing（否则映射表会把真失效洗成「待迁移」= 假绿）
      const s2 = classifySlots(new Set(['unrelated.slot']), ['synthetic.old'])
      ok(s2.missing.length === 1 && s2.migrated.length === 0,
        '★杠杆 映射表不得把「新名也不在」洗成待迁移（必须 missing ⇒ BLOCK）')
    } finally {
      if (saved === undefined) delete SLOT_RENAMES['synthetic.old']
      else SLOT_RENAMES['synthetic.old'] = saved
    }

    // 负控 4：名字本来就在 ⇒ 归 hit，不得误判
    const s3 = classifySlots(new Set(['a.b']), ['a.b'])
    ok(s3.hit.length === 1 && s3.migrated.length === 0 && s3.missing.length === 0, '负控4 原名在 ⇒ hit（不误判）')

    // ★★ 真实数据控（**D.2 落地后的形态**）：登记了跨代回退对之后，
    //   `settings.plugin.item` 在 0.1.7 的 SlotMap 里「无原名、但新名 `settings.plugins.tab` 在」
    //   ⇒ 必须归 **migrated（出声，不 BLOCK）** —— 这正是「我方有意保留的 0.1.5 兼容支」。
    const s4 = classifySlots(new Set(['settings.pluginInventory', 'settings.plugins.tab']), ['settings.plugin.item'])
    ok(s4.migrated.length === 1 && s4.migrated[0].to === 'settings.plugins.tab' && s4.missing.length === 0,
      `★真实数据控 D.2 落地后：settings.plugin.item ⇒ migrated→settings.plugins.tab（出声不 BLOCK）`)

    // ★★ 负控 7（**必须保留**）：**新名也不在** ⇒ 必须归 missing（BLOCK）。
    //   它守的是「映射表不得把**真失效**洗成待迁移」—— 也就是
    //   「若哪天官方连 settings.plugins.tab 也删了，本项目必须照实报 BLOCK」。
    //   ★ 与上一条是**同一判据的两个方向**（P-58 的两侧纪律）：只做一侧 = 半个盲区。
    const s5 = classifySlots(new Set(['settings.pluginInventory']), ['settings.plugin.item'])
    ok(s5.missing.length === 1 && s5.migrated.length === 0,
      '★负控7 新名也不在 ⇒ missing（映射表不得把真失效洗成待迁移）')

    // ★ 零控：**不得**假装映射到 `settings.pluginInventory`（那是另一个语义，见头注）
    ok(SLOT_RENAMES['settings.plugin.item'] !== 'settings.pluginInventory',
      '★零控 不得把 settings.plugin.item 映射到 pluginInventory（命名空间 ≠ 卡片槽位）')
  }

  // ---- E.1 插件 peer 声明（2026-09-23 新增）----
  {
    const WS = { '@deepseek-ai/dsh': 'workspace:*' }
    // 正控 5：全部用 workspace: ⇒ ok
    const p1 = classifyPluginPeers([
      { name: 'p1', peer: WS },
      { name: 'p2', peer: { '@deepseek-ai/dsh-client-ui-layout': 'workspace:*' } },
    ])
    ok(p1.ok.length === 2 && p1.missingPeer.length === 0 && p1.notWorkspace.length === 0,
      `正控5 workspace: 形态 ⇒ 全 ok（${p1.ok.length}）`)

    // ★ 杠杆（真实坑）：写死 `^0.1.7` ⇒ 必须被点名（实测该范围会被官方拒）
    const p2 = classifyPluginPeers([{ name: 'p3', peer: { '@deepseek-ai/dsh': '^0.1.7' } }])
    ok(p2.notWorkspace.length === 1 && p2.ok.length === 0,
      '★杠杆 写死 ^0.1.7 ⇒ 点名 notWorkspace（实测该 range 会被官方拒）')

    // 负控 5：完全未声明 ⇒ missingPeer
    const p3 = classifyPluginPeers([{ name: 'p4', peer: null }])
    ok(p3.missingPeer.length === 1 && p3.ok.length === 0, '负控5 未声明 peer ⇒ missingPeer')

    // 负控 6：peer 里只有**非官方**包 ⇒ 官方不检 ⇒ 仍算「未声明官方 peer」
    const p4 = classifyPluginPeers([{ name: 'p5', peer: { 'third-party': '^1.0.0' } }])
    ok(p4.missingPeer.length === 1, '负控6 只有非官方 peer ⇒ missingPeer（官方不检非 dsh* 包）')

    // 零控：空清单 ⇒ 四组全空（调用方据此判「没有判据力」）
    const p5 = classifyPluginPeers([])
    ok(p5.ok.length === 0 && p5.missingPeer.length === 0, '零控 空清单 ⇒ 全空（不冒充通过）')
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
// ★ 2026-09-23 阶段 E1：透传给 `audit-dsh-version.mjs`（见 ① 段注释）——
//   「本次构建预期重装，产物还是上一代」是**正常的**，不该 BLOCK 掉构建。
const EXPECT_REINSTALL = process.argv.includes('--expect-reinstall')

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
  // ★★ 2026-09-23 DSH 升级轮 · 阶段 E1：**把 `--expect-reinstall` 透传给 audit-dsh-version**。
  //   【为什么必须有（本轮实测的构建阻断）】本闸门跑在 `build-dsht.ps1` 的 **Step 0.5**，
  //   而 **Step 1 才装 runtime** ⇒ 在「**换版本**构建」场景下产物**必然还是上一代的** ⇒
  //   ① 段报 **BLOCK** ⇒ 构建走不到 Step 1（**P-40③**：判据必须跑在对象状态已确定之后）。
  //   ⇒ 本脚本接受同名 flag 并**逐字透传**（P-1：不在本脚本里重写那条判据的实现）。
  //     Step 0.5 时调用方会传它；重装后由 build 的 **Step 1.4** 用**不带 flag** 的真判据复核。
  const args = []
  if (NO_DEVICE) args.push('--no-device')
  if (EXPECT_REINSTALL) args.push('--expect-reinstall')
  const w = run('audit-dsh-version.mjs', args)
  const bad = /⛔|✗/.test(w.out) || w.code !== 0
  const ver = /dshVersion=([^\s·]+)/.exec(w.out)?.[1] ?? '(读不到)'
  rec('① 版本面（单源 + 产物顶层 + 数据形态 + 子包一致性）', bad ? 'BLOCK' : 'OK',
    bad
      ? `单源=${ver}；**有失败项** —— 见 node scripts/audit-dsh-version.mjs 输出`
      : `单源=${ver}；四项判据全过${EXPECT_REINSTALL ? '（★ 本次带 --expect-reinstall：产物层面的 ②/⑤ 记 SKIP 并出声，由重装后复核点做真判据）' : ''}`)
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
    // ★★ 2026-09-23 阶段 E：**与 ① 段同一因果** —— 本段跑在 Step 0.5，而**补丁在 Step 3.5 才打**
    //   ⇒ 换版本/重装构建时 `pending` **必然 > 0**（本轮实测：重装后待打 10 条）⇒ 不该 BLOCK 掉构建。
    //   ★ 但它**不能静默放过**（那会让「补丁根本没打上」与「还没轮到打」同貌 —— P-30）
    //   ⇒ 传 `--expect-reinstall` 时记 **SKIP 并出声**（点名待打条数）；
    //     真正的判据由**补丁打完之后的**那次审计（构建后期 / 发布前跑本脚本不带 flag）负责。
    const okAll = Number(failed) === 0 && Number(pending) === 0
    const skipByReinstall = !okAll && EXPECT_REINSTALL && Number(failed) === 0
    rec('② 补丁面（13 条 patch 的命中与幂等）', okAll ? 'OK' : (skipByReinstall ? 'SKIP' : 'BLOCK'),
      okAll
        ? '失败 0 · 待打 0'
        : (skipByReinstall
            ? `失败 0 · **待打 ${pending}** —— ★ 本次构建预期重装，补丁在 **Step 3.5** 才打；本段此刻**无判据力**（出声，不当通过 —— P-17），由补丁打完后的审计负责`
            : `失败 ${failed} · 待打 ${pending}（★ --check 把「锚点命中但未打」计入 pending 且**不报红**，故必须显式看这个数）`))
  }
}

// ---- ③ 原生面 ----
{
  const a = run('audit-native-deps.mjs')
  // ★★ 2026-09-23 v0.2.7 发版轮：**把 `--expect-compile` 透传给 audit-pty-prebuilt**。
  //   【为什么必须有（CI 首跑实测的构建阻断）】本闸门跑在 Step 0.5，而 node-pty 的
  //   android-* 产物由 **Step 1.5** 交叉编译产出 ⇒ 此刻产物**本就不该在**。
  //   不带 flag 时，判据会拿「**上一次构建的残留产物**」当对象：本机因此长期假绿；
  //   **CI 净环境无残留** ⇒ v0.2.7 tag 首跑实测 ③ 段 BLOCK ⇒ 构建失败。
  //   ⇒ 与 ①/② 段同款纪律（P-40③）：编译前 SKIP 出声，权威判据在 Step 1.5 之后。
  //   ⚠️ 只在「预期重装」（--expect-reinstall，= 构建会走到 Step 1.5）时透传；
  //     否则（SkipInstall 构建）产物必须已在场，仍 fail-closed。
  const b = run('audit-pty-prebuilt.mjs', EXPECT_REINSTALL ? ['--expect-compile'] : [])
  const bad = a.code !== 0 || b.code !== 0
  const bSkipped = /SKIP \d+ 项/.test(b.out)
  rec('③ 原生面（DT_NEEDED 闭合 + pty.node 就位）', bad ? 'BLOCK' : (bSkipped ? 'SKIP' : 'OK'),
    bad
      ? `native-deps exit=${a.code} · pty-prebuilt exit=${b.code}`
      : (bSkipped
          ? `DT_NEEDED 闭合通过；**pty.node 记 SKIP** —— ★ 本次构建预期编译（Step 1.5 才产出），本段此刻**无判据力**（出声，不当通过 —— P-17），由 Step 1.5 后的内联调用负责`
          : '两条判据全过'))
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
    else rec('④ 壳面（CLI 入口 / 就绪信号 / 启动参数）', 'OK', `就绪信号 ${ready} 处（${probes['dsh web:'].join(', ')}）· 三个参数齐备 · --expose-internals ${probes['--expose-internals'].length} 处`)
    // ★ 关于 --expose-internals 的诚实说明（2026-09-23 实测纠错）：
    //   它**不是** CLI 参数（不在 dsh-web-app 的 argv 里），而是 **node 运行时 flag**，
    //   由 HMR 插件用到（0.1.5 是 cordis-plugin-hmr，0.1.7 是 dsh-hmr）。
    //   ⚠️ 探针只在 dsh/dsh-web-app/dsh-app-boot 三包里搜 ⇒ 这里是 0 或 2 **都不代表**
    //     「官方已移除」—— 我曾据此误判过一次（见 E.2 的 B4 撤销）。
    //   它的**真判据**在 `audit-shell-contract`（待建）：扫**全部**官方包。
  }
}

// ---- ⑤ 装配面 ----
//
// 【2026-09-23 阶段 A 扩面】原 ⑤ 只查「slot 名 ⊆ 官方 SlotMap」+「external 包在不在」。
// 新增两面（都是**静默失效族**，且都由 0.1.7 实测触发）：
//   · **slot 改名映射**：官方把 `settings.plugin.item` 换成 `settings.pluginInventory`，
//     而 `slots.inject` 语义是「等声明出现再注册」⇒ 不报错、功能整块消失；
//   · **插件 peer 声明**：0.1.7-rc.1 的插件版本号机制 ⇒ 见 `classifyPluginPeers` 头注。
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

  // ---- 我方插件的 peerDependencies（从**产物**读；产物不存在 ⇒ 该包不计）----
  const PLUGIN_NAMES = ['dsht-rp-plugin', 'dsht-plugin-mvu', 'dsht-plugin-tavern-helper',
    'dsht-plugin-prompt-template', 'dsht-plugin-memory', 'dsht-plugin-device',
    'dsht-plugin-mobile', 'dsht-preflight', 'dsht-plugin-undo']
  const peerProbe = []
  for (const n of PLUGIN_NAMES) {
    const pj = path.join(RT, 'node_modules', n, 'package.json')
    const txt = realReadFile(pj)
    if (txt === null) continue          // 产物不存在（如 SkipInstall 首次构建）⇒ 不臆断
    let j = null
    try { j = JSON.parse(txt) } catch { continue }
    peerProbe.push({ name: n, peer: Object.hasOwn(j, 'peerDependencies') ? j.peerDependencies : null })
  }
  const peers = classifyPluginPeers(peerProbe)

  if (wanted.length === 0) rec('⑤ 装配面（slot 名 + external + 插件 peer）', 'UNKNOWN', '读不到我方 slots.inject 清单 ⇒ 测不出（不得当通过）')
  else {
    const sl = collectSlotNames(NM, wanted, realReadFile, realReadDir)
    if (sl.official.size === 0) rec('⑤ 装配面（slot 名 + external + 插件 peer）', 'UNKNOWN', '抽不到官方 SlotMap ⇒ 测不出')
    else {
      const cls = classifySlots(sl.official, wanted)
      const parts = []
      let status = 'OK'
      if (cls.missing.length) {
        status = 'BLOCK'
        parts.push(`★ 我方引用了官方**不存在**的 slot（且无改名映射）：${cls.missing.join(', ')} ⇒ 该功能会**静默消失**`)
      }
      if (missPkg.length) { status = 'BLOCK'; parts.push(`★ external 包名缺失：${missPkg.join(', ')}`) }
      // 插件 peer：missingPeer / notWorkspace 都算 BLOCK（理由见 classifyPluginPeers 头注）
      if (peers.missingPeer.length || peers.notWorkspace.length) {
        status = 'BLOCK'
        if (peers.missingPeer.length) parts.push(`★ 插件未声明 peerDependencies：${peers.missingPeer.join(', ')}`)
        if (peers.notWorkspace.length) parts.push(`★ 插件 peer 用了非 workspace 形态（有被 0.1.7 插件版本号机制**拒绝安装**的风险）：${peers.notWorkspace.join(', ')}`)
      }
      if (peerProbe.length === 0) parts.push('（ⓘ 插件产物不存在 ⇒ peer 面**无判据力**，守 P-17 不当通过）')

      if (status === 'OK') {
        const migNote = cls.migrated.length
          ? `　★ 待迁移（官方已改名，我已认新名）：${cls.migrated.map(x => `${x.from}→${x.to}`).join(', ')}`
          : ''
        rec('⑤ 装配面（slot 名 + external + 插件 peer）', 'OK',
          `${cls.hit.length}/${wanted.length} 个 slot 命中（官方 SlotMap ${sl.official.size} 键）· external 6 包齐备 · 插件 peer ${peers.ok.length}/${peerProbe.length} 合规${migNote}`)
      } else {
        rec('⑤ 装配面（slot 名 + external + 插件 peer）', 'BLOCK', parts.join(' ｜ '))
      }
    }
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
