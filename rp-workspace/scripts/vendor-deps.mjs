// vendor-deps.mjs — 构建期 vendor 依赖的自愈式预检。
//
// 为什么需要它（根因，不是补丁）：
//   真酒馆助手（JS-Slash-Runner）的脚本 iframe 依赖一组宿主全局
//   （$ / jQuery / jQuery.ui / _ / z / Zod / YAML）。DSH 的 webui 是 React 应用，
//   这些全局一个都没有，所以 build-rp-ui.mjs 在构建期把它们打成两个 iife
//   （th-vendor.gen.txt / th-host-vendor.gen.txt）。这 5 个包只服务于该 vendor 构建，
//   不进 APK 的 npm 依赖图，历史上用 `npm install --no-save` 手工装 —— 因此
//   **不在 package.json / 锁文件里**。
//   后果：任何 `npm install` / `pnpm install` 都会把「不在锁文件里的包」修剪掉。
//   实测（2026-09-11 心跳 47）：并发实例跑了一次 pnpm install，5 个包全部消失，
//   build-rp-ui.mjs 报 11 条 `Could not resolve "jquery" / "jquery-ui/ui/*"`，
//   构建中断 —— 而报错指向的 `th-vendor-entry.mjs` 是虚拟 stdin 名，仓库里并不存在，
//   极易被误判成「源码写错了」。这是本项目头部缺陷类「构建/部署断链」的第 ⑨ 类。
//
// 处置：把版本锚定 + 自愈收进一个地方，构建前强制校验。
//   命中缺失/版本漂移 → 用**一条** npm 命令整批重装（历史坑：分多次装，
//   后一次会把前一次不在 package.json 的包剪掉，两包必须一条命令一起装）→ 复核。
//   复核不过就抛错，绝不静默继续（静默失败族是本项目头号敌人）。
//
// 用法：
//   node scripts/vendor-deps.mjs            # 预检 + 自愈
//   node scripts/vendor-deps.mjs --check    # 只预检，不安装（CI / 只想看结论）
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '../packages')
const manifestPath = resolve(here, 'vendor-deps.json')

/** 解析锚定表 → [{ name, version, why }] */
function loadAnchors() {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const anchors = raw.anchors ?? {}
  return Object.entries(anchors).map(([name, v]) => ({
    name,
    version: String(v.version),
    why: String(v.why ?? ''),
  }))
}

function installedVersion(name) {
  const pj = resolve(pkgRoot, 'node_modules', name, 'package.json')
  if (!existsSync(pj)) return null
  try {
    return String(JSON.parse(readFileSync(pj, 'utf8')).version ?? '')
  } catch {
    return null
  }
}

/**
 * 校验（并在允许时自愈）vendor 依赖。
 * @param {{ autoInstall?: boolean, log?: (msg: string) => void }} [opts]
 * @returns {{ ok: boolean, problems: Array<{name:string; want:string; got:string|null; why:string}> }}
 */
export function ensureVendorDeps(opts = {}) {
  const autoInstall = opts.autoInstall !== false
  const log = opts.log ?? ((m) => console.log(m))
  const anchors = loadAnchors()

  const probe = () =>
    anchors
      .map((a) => ({ ...a, got: installedVersion(a.name) }))
      .filter((a) => a.got !== a.version)

  let problems = probe()
  if (problems.length === 0) {
    log(`[vendor-deps] OK — ${anchors.length} 个构建期 vendor 包版本全部锚定命中`)
    return { ok: true, problems: [] }
  }

  log(`[vendor-deps] 缺失/漂移 ${problems.length}/${anchors.length}：`)
  for (const p of problems) log(`  - ${p.name}: 期望 ${p.version}，实际 ${p.got ?? '(未安装)'}`)

  if (!autoInstall) {
    log('[vendor-deps] --check 模式：只报告不安装')
    return { ok: false, problems }
  }

  // 一条命令整批装：分次装会互相修剪（历史坑，见文件头）。
  const specs = anchors.map((a) => `${a.name}@${a.version}`)
  log(`[vendor-deps] 自愈：npm install --no-save --no-package-lock ${specs.join(' ')}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(
    npm,
    ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', ...specs],
    { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (r.error) {
    log(`[vendor-deps][FATAL] 无法执行 npm：${r.error.message}`)
  }

  problems = probe()
  if (problems.length > 0) {
    for (const p of problems) log(`[vendor-deps][FATAL] ${p.name} 仍为 ${p.got ?? '(未安装)'}，期望 ${p.version}`)
    log('[vendor-deps] 自愈失败。手工命令（注意必须一条命令整批装）：')
    log(`  cd rp-workspace/packages && npm install --no-save --no-package-lock ${specs.join(' ')}`)
    return { ok: false, problems }
  }

  log(`[vendor-deps] 自愈成功 — ${anchors.length} 个包已对齐`)
  return { ok: true, problems: [] }
}

// CLI 直跑
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const checkOnly = process.argv.includes('--check')
  const { ok } = ensureVendorDeps({ autoInstall: !checkOnly })
  process.exit(ok ? 0 : 1)
}
