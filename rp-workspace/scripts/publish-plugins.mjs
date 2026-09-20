/**
 * publish-plugins.mjs —— 自研 DSH 插件 npm 首发编排（NEXT-STEPS P4）
 * ============================================================================
 * 用法：
 *   node scripts/publish-plugins.mjs            # dry-run：staging + 发布前门禁 + npm pack --dry-run
 *   node scripts/publish-plugins.mjs --publish  # 实际发布（需先 npm login；门禁全绿才执行）
 *
 * ## 发布面（2026-09-20 定版）
 *   6 个自研插件包 + dsht-rp-suite 元包（仅 dependencies，「一行装齐」）。
 *   dsht-plugin-undo 有意不 compose（README「关于 DSH」节），不首发；
 *   dsht-preflight 是构建期内部预检，不首发。
 *
 * ## 钉法（对齐 bychv/dsh-preset-enhance）
 *   engines: { node: ">=22.19.0", dsh: ">=0.1.5-rc.1 <0.1.6" }
 *   —— dsh 窗口下沿 = 我们实测面（0.1.5-rc.1 全量验证）；上沿 <0.1.6（0.1.6 契约未稳）。
 *
 * ## 发布前门禁（zhipu-toolkit 案教训，PLUGIN-COMPAT §5.3 ⑨）
 *   ① npm pack --dry-run 产物解开，扫描全部 .js 的 import/export from / import() / require()
 *      —— 相对路径必须解析到包内真实文件（缺文件 = ERR_MODULE_NOT_FOUND crash-loop 重演）；
 *   ② bare import 只允许 cordis / @deepseek-ai/* / node:* 内建（bundle 应零三方依赖）；
 *   ③ package.json 必备字段：license / engines.dsh / files / description / repository；
 *   ④ cordis.patch.yml（若包有）必须在 files 清单内。
 *   任一不过 ⇒ 退出 1，绝不带伤发布（P-3）。
 *
 * ## 退出码
 *   0 = dry-run 全绿（或发布成功）   1 = 门禁失败 / 发布失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const NM = path.join(WS, 'dsh-runtime-android', 'node_modules')
const STAGING = path.join(WS, 'tmp', 'publish-staging')
const VERSION = '0.2.0'
const ENGINES = { node: '>=22.19.0', dsh: '>=0.1.5-rc.1 <0.1.6' }
const REPO = { type: 'git', url: 'git+https://github.com/SUNNYYUBER/DSH-Tavern-for-Android.git' }

// ---------------------------------------------------------------------------
// 发布面（SSOT）：src = dsh-runtime-android/node_modules 下的已构建产物目录；
// fromDir = 已是发布形态的源码目录（跳过 staging 拷贝与 package.json 重写，直接门禁+pack）
// ---------------------------------------------------------------------------
const TOOLS_LINT = path.join(WS, 'tools', 'dsh-plugin-lint')
const PACKAGES = [
  {
    name: 'dsh-plugin-lint', fromDir: TOOLS_LINT,
    description: 'Static linter for DSH plugins (packaging closure / client-face sniffing / Android pre-check)',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'lint'],
  },
  {
    name: 'dsht-rp-plugin',
    description: 'SillyTavern-style roleplay suite for DeepSeek Harness (DSH): character cards, world books/lorebooks, regex scripts, prompt presets, MVU variables, tavern-helper compat layer',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'roleplay', 'sillytavern', 'worldbook', 'lorebook', 'mvu'],
  },
  {
    name: 'dsht-plugin-mvu',
    description: 'MVU (Magical Variable Update) state engine plugin for DSH roleplay sessions',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'mvu', 'roleplay', 'variables'],
  },
  {
    name: 'dsht-plugin-tavern-helper',
    description: 'Tavern Helper (JS-Slash-Runner) compatible script-runtime API for DSH (self-written re-implementation, no upstream source)',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'tavern-helper', 'js-slash-runner', 'roleplay'],
  },
  {
    name: 'dsht-plugin-prompt-template',
    description: 'EJS prompt-template engine plugin for DSH (sandboxed worker evaluation)',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'ejs', 'prompt-template'],
  },
  {
    name: 'dsht-plugin-mobile',
    description: 'Mobile adaptation layer for DSH web UI (drawer nav, touch bridges, data-* host anchors)',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'mobile', 'android'],
  },
  {
    name: 'dsht-plugin-memory',
    description: 'Long-term memory tables plugin for DSH roleplay sessions',
    keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'memory', 'roleplay'],
  },
]

const SUITE = {
  name: 'dsht-rp-suite',
  description: 'Meta package: one-line install of the full DSHTavern roleplay plugin suite for DeepSeek Harness (DSH)',
  keywords: ['dsh', 'deepseek-harness', 'dsh-plugin', 'roleplay', 'sillytavern', 'meta'],
}

// bare import 白名单（cordis 运行时提供 / DSH 官方包 / node 内建 /
// react 系 = DSH client ModuleLoader 的 external——client bundle 的标准形态，
// bychv/dsh-outline 的 client.js 同样 `require("react")`，不经 npm 解析）
const BARE_ALLOW = /^(cordis|@deepseek-ai\/|node:|react$|react\/|react-dom$|react-dom\/)/
const NODE_BUILTINS = new Set(['fs', 'path', 'crypto', 'os', 'util', 'events', 'stream', 'buffer', 'url', 'worker_threads', 'child_process', 'http', 'https', 'net', 'zlib', 'assert', 'module', 'process'])

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function readJson (p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

function* walkJs (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkJs(p)
    else if (/\.(js|mjs|cjs)$/.test(e.name)) yield p
  }
}

/** 扫描一个 .js 文件的全部 import  specifier（静态 + 动态 + require）。 */
function scanSpecifiers (file) {
  const text = fs.readFileSync(file, 'utf8')
  const out = []
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** 相对 specifier → 解析到真实文件（补 .js/.mjs//index.js）。找不到返回 null。 */
function resolveRel (fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const c of [base, base + '.js', base + '.mjs', path.join(base, 'index.js'), path.join(base, 'index.mjs')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

// ---------------------------------------------------------------------------
// ① staging：从已构建产物拷贝 + 重写 package.json
// ---------------------------------------------------------------------------
function stage (spec) {
  // fromDir：已是发布形态（如 tools/dsh-plugin-lint 手写 package.json）——直接用，不重写
  if (spec.fromDir) {
    if (!fs.existsSync(path.join(spec.fromDir, 'package.json'))) throw new Error(`fromDir 无 package.json：${spec.fromDir}`)
    return { dir: spec.fromDir, pkg: readJson(path.join(spec.fromDir, 'package.json')) }
  }
  const src = path.join(NM, spec.name)
  if (!fs.existsSync(src)) throw new Error(`产物目录不存在：${src}（先跑 build-dsht.ps1 构建）`)
  const dst = path.join(STAGING, spec.name)
  fs.rmSync(dst, { recursive: true, force: true })
  fs.cpSync(src, dst, { recursive: true })
  // 收集包内顶层条目 → files 清单（lib/assets 等目录 + cordis.patch.yml；package.json 自动含）
  const entries = fs.readdirSync(dst, { withFileTypes: true })
  const files = entries.filter(e => e.name !== 'package.json').map(e => e.name)
  const srcPkg = readJson(path.join(src, 'package.json'))
  // dsht-plugin-mobile 案（negative-own 负控抓到）：构建期注册靠 NodeService 写 patch 行，
  // 产物自身无 cordis.patch.yml ⇒ 作为独立 npm 包无法 dsh plugin add。staging 补最小清单。
  let dshField = srcPkg.dsh
  if (!fs.existsSync(path.join(dst, 'cordis.patch.yml')) && !fs.existsSync(path.join(dst, 'dsh.plugin.json'))) {
    const id = spec.name.replace(/^dsht-plugin-/, 'dsht-')
    fs.writeFileSync(path.join(dst, 'cordis.patch.yml'),
      `# ${spec.name} bundle patch（staging 生成；等价 dsh plugin add ${spec.name}）\n- insert:\n    - id: ${id}\n      name: '${spec.name}'\n`)
    dshField = { ...(dshField ?? {}), bundle: { patch: './cordis.patch.yml' } }
  }
  const pkg = {
    name: spec.name,
    version: VERSION,
    type: 'module',
    description: spec.description,
    license: 'MIT',
    repository: REPO,
    keywords: spec.keywords,
    main: srcPkg.main ?? './lib/index.js',
    ...(srcPkg.exports ? { exports: srcPkg.exports } : {}),
    ...(dshField ? { dsh: dshField } : {}),
    files: [...files, ...(files.includes('cordis.patch.yml') ? [] : ['cordis.patch.yml'])].filter(f => fs.existsSync(path.join(dst, f))),
    engines: ENGINES,
  }
  fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return { dir: dst, pkg }
}

function stageSuite () {
  const dst = path.join(STAGING, SUITE.name)
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  const pkg = {
    name: SUITE.name,
    version: VERSION,
    type: 'module',
    description: SUITE.description,
    license: 'MIT',
    repository: REPO,
    keywords: SUITE.keywords,
    files: ['package.json'],
    // 套件 = 6 个 RP 插件（dsh-plugin-lint 是开发工具，不属于运行时套件）
    dependencies: Object.fromEntries(PACKAGES.filter(p => !p.fromDir).map(p => [p.name, `^${VERSION}`])),
    engines: ENGINES,
  }
  fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return { dir: dst, pkg }
}

// ---------------------------------------------------------------------------
// ② 发布前门禁
// ---------------------------------------------------------------------------
function gate (name, dir, pkg) {
  const fails = []
  // ③ 必备字段
  for (const f of ['license', 'description', 'repository', 'files']) {
    if (!pkg[f]) fails.push(`package.json 缺字段 ${f}`)
  }
  if (!pkg.engines?.dsh) fails.push('package.json 缺 engines.dsh')
  // ④ cordis.patch.yml 若在包内必须在 files
  if (fs.existsSync(path.join(dir, 'cordis.patch.yml')) && !pkg.files.includes('cordis.patch.yml')) {
    fails.push('cordis.patch.yml 不在 files 清单')
  }
  // files 清单逐条存在
  for (const f of pkg.files ?? []) {
    if (f === 'package.json') continue
    if (!fs.existsSync(path.join(dir, f))) fails.push(`files 清单项不存在：${f}`)
  }
  // ①② import 闭包（只扫**发布面**——files 清单覆盖的文件；test/ 等不入包的内容
  // 不该参与闭包判定，dsh-plugin-lint 自身的合成 fixtures 就是反例）
  const jsSet = []
  for (const f of pkg.files ?? []) {
    if (/[*?[\]]/.test(f)) continue // glob 项跳过（npm pack 兜底）
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) continue // S5 已报
    if (fs.statSync(p).isDirectory()) jsSet.push(...walkJs(p))
    else if (/\.(js|mjs|cjs)$/.test(f)) jsSet.push(p)
  }
  const missing = []
  const bare = new Set()
  for (const js of jsSet) {
    for (const spec of scanSpecifiers(js)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        if (!resolveRel(js, spec)) missing.push(`${path.relative(dir, js)} → ${spec}`)
      } else {
        const head = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        if (!BARE_ALLOW.test(spec) && !NODE_BUILTINS.has(head)) bare.add(spec)
      }
    }
  }
  if (missing.length) fails.push(`相对 import 缺文件 ${missing.length} 处：${missing.slice(0, 5).join('；')}`)
  if (bare.size) fails.push(`非白名单 bare import：${[...bare].join(', ')}`)
  return fails
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
// Windows：npm 是 npm.cmd；Node ≥20 对 .cmd 强制 shell:true（CVE-2024-27980），
// 否则 ENOENT/EINVAL（参数均为脚本内固定串，无注入面）
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const SHELL = process.platform === 'win32'

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const PUBLISH = process.argv.includes('--publish')
  console.log(`[publish] staging → ${STAGING}（版本 ${VERSION}，engines.dsh "${ENGINES.dsh}"）`)
  const staged = PACKAGES.map(stage)
  staged.push(stageSuite())

  let failTotal = 0
  for (const { dir, pkg } of staged) {
    const fails = gate(pkg.name, dir, pkg)
    if (fails.length) {
      failTotal += fails.length
      console.error(`✗ ${pkg.name}：${fails.length} 项`)
      for (const f of fails) console.error('  · ' + f)
    } else {
      console.log(`✓ ${pkg.name}@${VERSION}（门禁 ${pkg.name === SUITE.name ? '元包' : '闭包'}通过）`)
    }
  }
  if (failTotal) {
    console.error(`[publish] ✗ 门禁共 ${failTotal} 项失败 —— 修复后重跑，绝不带伤发布`)
    process.exit(1)
  }

  // npm pack --dry-run（双确认：npm 自己的 files 过滤与我们的一致）
  for (const { dir, pkg } of staged) {
    const out = execFileSync(NPM, ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8', shell: SHELL })
    const info = JSON.parse(out)[0]
    console.log(`  [pack] ${pkg.name}: ${info.entryCount ?? info.files.length} 文件 / ${Math.round((info.size ?? 0) / 1024)} KB`)
  }

  if (!PUBLISH) {
    console.log('[publish] dry-run 全绿。实际发布：npm login 后 node scripts/publish-plugins.mjs --publish')
    process.exit(0)
  }
  for (const { dir, pkg } of staged) {
    console.log(`[publish] npm publish ${pkg.name}@${VERSION} …`)
    execFileSync(NPM, ['publish', '--access', 'public'], { cwd: dir, stdio: 'inherit', shell: SHELL })
  }
  console.log('[publish] ✓ 全部发布完成')
}
