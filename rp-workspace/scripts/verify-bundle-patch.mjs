#!/usr/bin/env node
/**
 * verify-bundle-patch.mjs —— T-87 **第 2 步**的端到端验收（心跳 77 新增）
 * ============================================================================
 * ## 这个脚本证明的是什么（goal 的显式验收项，逐字）
 *   「第 2 步：在干净 PC 环境执行 `dsh plugin add` 后，插件自动出现在列表且功能可用、
 *     无需手改 `cordis.patch.yml`」
 *
 * 拆成两段（缺一不可）：
 *   **A. 元数据段**：干净隔离 HOME 里跑**官方** `dsh plugin --profile web add <总包>`
 *      ⇒ 断言 ① 命令成功 ② `dsht-rp-plugin` **自动进** profile 的 `dsh.profile.bundles`
 *      ③ 包已装进 `profile/node_modules` ④ **全程未改 `cordis.patch.yml`**（它必须仍是模板 `[]`）。
 *   **B. 运行段**：用同一个 profile 启动 `dsh web` ⇒ 断言 5 个功能域端点**全部 HTTP 200**。
 *      （只有 A 没有 B，就是"元数据对了但功能不通"——正是本项目要防的"看起来成功"。）
 *
 * ## 为什么不能用"直接改 cordis.patch.yml"代替
 * 那恰恰是要证明**不需要**的动作。本脚本全程不碰任何 profile 文件，只跑官方命令。
 *
 * ## 关于 `@deepseek-ai/dsh-win32-process`（T-90，2026-09-13 心跳 78 已修）
 * 本 runtime 是 **Android 产物**：该包由 stub 顶替（`dsh-subprocess-local` 顶层静态 import 它）。
 * 曾因 stub **缺 `package.json`** 导致 PC 上 `Cannot find package` —— 当时本脚本临时补一个绕过去。
 * **T-90 修复后改为硬断言**（判据 A5）：文件必须齐备且 `name` 正确，缺失即中止并指向构建侧修复点。
 * 理由：继续静默自愈会把构建侧回归抹平（产物坏了这扇端到端门照样绿 —— L145 同族）。
 *
 * 用法：
 *   node scripts/verify-bundle-patch.mjs            # A + B 两段
 *   node scripts/verify-bundle-patch.mjs --metadata-only   # 只跑 A 段（不起 dsh，快）
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = resolve(HERE, '..')
const RT = join(WS, 'dsh-runtime-android')
const DSH_BIN = join(RT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const SIM = join(WS, 'scripts', 'android-sim.cjs')
const SRC_PKG = join(RT, 'node_modules', 'dsht-rp-plugin')
const PORT = 3093

const METADATA_ONLY = process.argv.includes('--metadata-only')

// ⚠️ 必须在**无空格路径**下跑（实测结论，非猜测）：
//   官方 `runPlugin` 用 `spawnSync('pnpm', args, { shell: process.platform === 'win32' })`，
//   而 Node 在 `shell: true` 时**不对 args 做引用转义**（只是空格拼接）⇒ 参数含空格
//   （本仓库路径 `D:\DSH Role Play\…`）会被 shell 切碎，pnpm 于是把
//   `RolePlay\rp-workspace\tmp\…` 当包名去 registry 查 → 404。
//   这是**官方 CLI 在 Windows 含空格路径下的既有限制**，与我方总包无关。
const ROOT = 'C:/dsht-bundle-e2e'
const HOME = join(ROOT, 'home')
const PKGSRC = join(ROOT, 'src', 'dsht-rp-plugin')

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
}

// ---------------------------------------------------------------------------
// 准备：干净 HOME + 可被 pnpm 安装的本地包源
// ---------------------------------------------------------------------------
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(HOME, { recursive: true })
mkdirSync(PKGSRC, { recursive: true })
cpSync(SRC_PKG, PKGSRC, { recursive: true })
if (!existsSync(join(PKGSRC, 'cordis.patch.yml'))) {
  console.error('❌ 源包里没有 cordis.patch.yml —— 第 2 步的 bundle 层文件未随包分发')
  process.exit(2)
}
if (!existsSync(join(PKGSRC, 'package.json'))) { console.error('❌ 源包缺 package.json'); process.exit(2) }
const srcManifest = JSON.parse(readFileSync(join(PKGSRC, 'package.json'), 'utf8'))
if (srcManifest.dsh?.bundle?.patch === undefined) {
  console.error('❌ 总包 package.json 未声明 dsh.bundle.patch —— dsh plugin add 不会把它当 profile 层')
  process.exit(2)
}

const env = { ...process.env, HOME, DSH_HOME: join(HOME, '.dsh'), USERPROFILE: HOME }
const runDsh = (args) => spawnSync(process.execPath, [DSH_BIN, ...args], { env, cwd: ROOT, encoding: 'utf8' })

// ---------------------------------------------------------------------------
// A 段：官方 dsh plugin add
// ---------------------------------------------------------------------------
console.log('=== A. 干净环境执行官方 dsh plugin add（全程不碰任何 profile 文件）===')
const add = runDsh(['plugin', '--profile', 'web', 'add', './src/dsht-rp-plugin'])
console.log('  exit =', add.status)
if (add.status !== 0) {
  console.log('  输出尾部：')
  console.log((add.stdout + add.stderr).trim().split('\n').slice(-14).map((l) => `    ${l}`).join('\n'))
}

const profileDir = join(HOME, '.dsh', 'profiles', 'web')
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) {
  console.error('❌ profile package.json 不存在 —— profile 未初始化')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
const inBundles = bundles.includes('dsht-rp-plugin')
const installed = existsSync(join(profileDir, 'node_modules', 'dsht-rp-plugin', 'lib', 'index.js'))
const patchPath = join(profileDir, 'cordis.patch.yml')
const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
// 判据 ④：patch 文件必须**未被本脚本之外的东西**改动 ⇒ 内容应仍是模板（`[]`）
const patchUntouched = /^\s*\[\s*\]\s*$/m.test(patchText.replace(/^#[^\n]*\n/gm, ''))

check(add.status === 0, '判据A1 官方 `dsh plugin --profile web add` 成功', `exit=${add.status}`)
check(inBundles, '判据A2 `dsht-rp-plugin` **自动进** `dsh.profile.bundles`（无需手改 patch）',
  `bundles = ${JSON.stringify(bundles)}`)
check(installed, '判据A3 包已装进 profile/node_modules', installed ? '' : '缺 lib/index.js')
check(patchUntouched, '判据A4 `cordis.patch.yml` 全程未被改动（仍是模板 `[]`）',
  patchUntouched ? '' : `实得：${JSON.stringify(patchText.slice(0, 120))}`)

if (METADATA_ONLY) {
  const pass = results.filter((r) => r.ok).length
  console.log(`\n[verify-bundle-patch --metadata-only] ${pass}/${results.length} PASS`)
  rmSync(ROOT, { recursive: true, force: true })
  process.exit(pass === results.length ? 0 : 1)
}

// ---------------------------------------------------------------------------
// B 段：用同一个 profile 启动 dsh web，验 5 个功能域
// ---------------------------------------------------------------------------
console.log('\n=== B. 启动 dsh web（同一个 profile）验 5 个功能域端点 ===')

// T-90 前置**断言**（2026-09-13 心跳 78 起；原为"缺失就临时补上"的静默自愈）
// ============================================================================
// 为什么改成断言而不是继续自愈：
//   本 runtime 是 Android 产物，`@deepseek-ai/dsh-win32-process` 被换成 stub。T-90 修复前
//   该 stub **缺 package.json** ⇒ PC 上起不来，故当时此处临时补一个来让 B 段能跑。
//   T-90 已在**两条构建路径**（`build-dsht.ps1` Step 3c + `apply-platform-patches.py` STUB_MAP）
//   补齐该文件，并在构建期加了"结构 + 行为"双层自检 —— **此处若还继续静默补**，
//   就等于把构建侧的回归**悄悄抹平**：产物坏了、这道端到端门照样绿（L145 同族教训）。
//   ⇒ 改为硬断言：文件必须在位，且必须是我们那份 stub 的清单（不是随手写个 JSON 糊过去）。
const WIN32_DIR = join(RT, 'node_modules', '@deepseek-ai', 'dsh-win32-process')
const WIN32_IDX = join(WIN32_DIR, 'lib', 'index.js')
const WIN32_PKG = join(WIN32_DIR, 'package.json')
{
  const hasIdx = existsSync(WIN32_IDX)
  const hasPkg = existsSync(WIN32_PKG)
  let pkgName = ''
  if (hasPkg) {
    try { pkgName = String(JSON.parse(readFileSync(WIN32_PKG, 'utf8'))?.name ?? '') } catch { pkgName = '<unparsable>' }
  }
  check(hasIdx && hasPkg && pkgName === '@deepseek-ai/dsh-win32-process',
    '判据A5（T-90）`dsh-win32-process` stub 齐备（lib/index.js + package.json）',
    hasIdx && hasPkg ? `name=${pkgName}` : `缺 ${!hasIdx ? 'lib/index.js ' : ''}${!hasPkg ? 'package.json' : ''} —— T-90 回归，构建侧 stub 分发又断了`)
  if (!hasPkg) {
    // 缺了就无法解析裸说明符，B 段必然起不来 —— 直接给出可行动结论，不做静默修补。
    console.log('  ⇒ 中止 B 段（无法启动 dsh）。先修 T-90：见 build-dsht.ps1 Step 3c / apply-platform-patches.py STUB_MAP')
    rmSync(ROOT, { recursive: true, force: true })
    const p = results.filter((r) => r.ok).length
    console.log(`\n[verify-bundle-patch] ${p}/${results.length} PASS`)
    process.exit(1)
  }
}

const child = spawn(process.execPath, ['--expose-internals', '-r', SIM, DSH_BIN, 'web', '--no-open', `--port=${PORT}`], {
  cwd: RT, env, stdio: ['ignore', 'pipe', 'pipe'],
})
let childOut = ''
child.stdout.on('data', (d) => { childOut += d })
child.stderr.on('data', (d) => { childOut += d })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const probe = async (p) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`)
    return { code: r.status }
  } catch { return { code: -1 } }
}

let ready = false
for (let i = 0; i < 30; i++) {
  await sleep(4000)
  const r = await probe('/dsht-memory/health')
  // 0.1.5 带 token 鉴权：401/403 亦表示"已就绪但拒权"，用 200 最严
  if (r.code === 200) { ready = true; console.log(`  端口就绪（第 ${i + 1} 次探测）`); break }
  if (r.code === 401 || r.code === 403) { ready = true; console.log(`  端口就绪（第 ${i + 1} 次探测，HTTP ${r.code}）`); break }
}
if (!ready) {
  console.log('  端口未就绪，进程输出尾部：')
  console.log(childOut.trim().split('\n').slice(-20).map((l) => `    ${l}`).join('\n'))
}

const DOMAINS = [
  ['/dsht-rp/rp/build-info', 'RP 主干'],
  ['/dsht-mvu/settings', 'MVU'],
  ['/dsht-tavern-helper/settings', '酒馆助手'],
  ['/dsht-prompt-template/settings', '提示词模板'],
  ['/dsht-memory/health', '剧情记忆'],
]
let hit = 0
const misses = []
for (const [p, name] of DOMAINS) {
  const r = await probe(p)
  const ok = r.code === 200
  if (ok) hit++
  else misses.push(`${p}(${name})=${r.code}`)
  console.log(`  ${ok ? '✅' : '❌'} ${p}  ${name}  → HTTP ${r.code}`)
}
check(hit === DOMAINS.length,
  `判据B1 5 个功能域端点**全部可用**（${hit}/${DOMAINS.length}）`,
  misses.length ? `未通过：${misses.join(', ')}` : '')

// ---------------------------------------------------------------------------
// 判据 B2（B12 常驻守护，2026-09-13 心跳 78 新增）：设置命名空间在**真宿主**内注册成功
// ---------------------------------------------------------------------------
// 守的是什么：B12「合并成 1 个包后仍能单独关闭剧情记忆」的前提是 ——
//   **4 个设置命名空间在真宿主里确实注册了**（「可配置」tab 的渲染 = Host
//   `settings.describe()` 的 namespaces ∩ 浏览器侧 `settings.plugin.item` 槽位卡；
//   与 cordis 插件条目列表**无关** ⇒ 合并成一行不会让卡片消失，但前提是命名空间还在）。
// 为什么不能只靠 mock/源码断言（L146）：
//   · `verify-rp-consolidation.mjs` 判据 4 用 mock ctx 记录 register 调用 —— 证明"代码会去注册"，
//     不是"真宿主里注册成功"；
//   · 产物里有 key 只证明 UI 侧有卡，不证明宿主侧有命名空间。
// ⇒ 这里直接读**本脚本已经真启动的那个宿主**的 stdout：
//   `registerSettingsNamespace` 注册成功打印 `[<tag>] settings namespace registered: <ns>`，
//   失败则打 warn。断言用**成对**（成功行出现 + 失败 warn 不出现），避免只测一半。
const NS_EXPECT = [
  { ns: 'dsht-plugin-mvu', tag: 'dsht-mvu' },
  { ns: 'dsht-plugin-tavern-helper', tag: 'dsht-th' },
  { ns: 'dsht-plugin-prompt-template', tag: 'dsht-ejs' },
  { ns: 'dsht-plugin-memory', tag: 'dsht-memory' },
]
const nsMissing = NS_EXPECT.filter(({ ns, tag }) => !childOut.includes(`[${tag}] settings namespace registered: ${ns}`))
const nsFailed = NS_EXPECT.filter(({ ns, tag }) => childOut.includes(`[${tag}] settings namespace ${ns} 注册失败`))
check(childOut.length > 0, '判据B2a（反控）宿主 stdout 非空 ⇒ B2 不是在"什么都没有"上假绿', `${childOut.length} B`)
check(nsFailed.length === 0, '判据B2b（反控）无任何"注册失败"warn',
  nsFailed.length ? JSON.stringify(nsFailed.map((f) => f.ns)) : 'clean')
check(nsMissing.length === 0,
  '判据B2 4 个设置命名空间在**真宿主**内注册成功（= 4 张设置卡会渲染、B12 开关有落点）',
  nsMissing.length ? `未见注册行：${JSON.stringify(nsMissing.map((m) => m.ns))}` : NS_EXPECT.map((e) => e.ns).join(', '))

// ---------------------------------------------------------------------------
// 判据 B3（B12 运行时开关行为，2026-09-13 心跳 78 新增）：关 → 409，开 → 恢复
// ---------------------------------------------------------------------------
// 守的是什么：用户要的「运行时开关」在**真宿主**里的实际行为 ——
//   关闭总开关后，`/dsht-memory/expand` 与 `/summarize` 必须**显式拒绝**（409 + 可行动指引），
//   而不是"回 200 收下、随后静默丢弃/不执行"（本项目头号缺陷族：静默失败）。
//   这是 mock 单测（tests/b12-memory-master-switch.spec.ts）覆盖不到的**跨进程**验证。
// 做法：写入 settings 关掉总开关 ⇒ 断言两处 409 ⇒ 再打开 ⇒ 正控断言 /summarize 恢复 200。
//   ⚠️ 正控不可省：若开启态也 409，说明"端点根本没接线"，那关闭态的 409 毫无意义（L142）。
//   ⚠️ 本段会写 settings，但全程在隔离 HOME（C:/dsht-bundle-e2e）内，不碰用户真实 ~/.dsh。
const postJson = async (p, body) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    let json = {}
    try { json = await r.json() } catch { /* 非 JSON */ }
    return { code: r.status, json }
  } catch (e) { return { code: -1, json: { error: String(e) } } }
}
{
  const off = await postJson('/dsht-memory/settings', { 总开关: false })
  // 独立复核：不信写入接口自己的返回，另从 health 读一次（防单点自证）
  const h = await fetch(`http://127.0.0.1:${PORT}/dsht-memory/health`)
    .then((r) => r.json()).catch(() => null)
  check(off.code === 200 && off.json?.config?.enabled === false && h?.config?.enabled === false,
    '判据B3a 关闭总开关 ⇒ 写入成功且 health 独立复核为 false',
    `settings=${off.code}/enabled=${off.json?.config?.enabled}, health.enabled=${h?.config?.enabled}`)

  const exp = await postJson('/dsht-memory/expand', { sessionId: 'verify-probe', from: 1, to: 1 })
  check(exp.code === 409 && String(exp.json?.error ?? '').includes('总开关已关闭'),
    '判据B3b 关闭态 /expand ⇒ 409 + 可行动指引（非静默收下）',
    `HTTP ${exp.code}`)
  const sm = await postJson('/dsht-memory/summarize', { sessionId: 'verify-probe' })
  check(sm.code === 409 && String(sm.json?.error ?? '').includes('总开关已关闭'),
    '判据B3c 关闭态 /summarize ⇒ 409 + 可行动指引（非静默收下）',
    `HTTP ${sm.code}`)

  const on = await postJson('/dsht-memory/settings', { 总开关: true })
  const sm2 = await postJson('/dsht-memory/summarize', { sessionId: 'verify-probe' })
  check(on.code === 200 && on.json?.config?.enabled === true && sm2.code === 200,
    '判据B3d（正控）重新打开 ⇒ /summarize 恢复 200（关闭态的 409 确由总开关引起）',
    `on=${on.code}, summarize=${sm2.code}`)
}

child.kill('SIGKILL')
await sleep(500)
rmSync(ROOT, { recursive: true, force: true })

const pass = results.filter((r) => r.ok).length
console.log(`\n[verify-bundle-patch] ${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
