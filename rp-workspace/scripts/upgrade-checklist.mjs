#!/usr/bin/env node
// ---------------------------------------------------------------------------
// upgrade-checklist.mjs —— 生成 DSH 升级检查单 docs/UPGRADE-CHECKLIST-<v>.md
//
// 用法：node upgrade-checklist.mjs <targetVersion>
// 组合四路信息：
//   1. 最近两份契约快照的 diff（contracts/ 里最新两个版本目录，复用 diff-contracts.mjs）
//   2. dsh-runtime-android / stubs 现有 stub 清单（目录不存在就标注跳过）
//   3. AUDIT_TASKLIST.md 中 🔴/🟡 行提取（未闭合风险项）
//   4. `npm view @deepseek-ai/dsh@<v> version` 探测（失败标注 npm 未发布）
// 零依赖（node: 内建 + node:child_process），Node ESM。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_ROOT = resolve(__dirname, '..')
const OUT_ROOT = join(WS_ROOT, 'contracts')
const DOCS_DIR = join(WS_ROOT, 'docs')
const AUDIT_FILE = resolve(WS_ROOT, '..', 'AUDIT_TASKLIST.md')

/** npm 探测：返回版本串或 null（网络/未发布/超时一律视为探测失败） */
function npmViewVersion(target) {
  try {
    const out = execFileSync('npm', ['view', `@deepseek-ai/dsh@${target}`, 'version'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/** 从 AUDIT_TASKLIST.md 提取 🔴/🟡 行 */
function auditRiskLines() {
  if (!existsSync(AUDIT_FILE)) return null
  const text = readFileSync(AUDIT_FILE, 'utf8')
  return text
    .split(/\r?\n/)
    .filter((l) => l.includes('🔴') || l.includes('🟡'))
    .map((l) => l.trim())
    .slice(0, 80)
}

/** stub 清单：dsh-runtime-android / stubs 目录（不存在返回 null = 跳过） */
function stubInventory() {
  const sections = []
  const androidDir = join(WS_ROOT, 'dsh-runtime-android')
  if (existsSync(join(androidDir, 'node_modules', '@deepseek-ai'))) {
    sections.push({ name: 'dsh-runtime-android @deepseek-ai 包', items: readdirSync(join(androidDir, 'node_modules', '@deepseek-ai')).sort() })
  } else {
    sections.push({ name: 'dsh-runtime-android @deepseek-ai 包', items: null })
  }
  const stubsDir = join(WS_ROOT, 'stubs')
  if (existsSync(stubsDir)) {
    sections.push({ name: 'stubs/ 本地 stub', items: readdirSync(stubsDir, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name).sort() })
  } else {
    sections.push({ name: 'stubs/ 本地 stub', items: null })
  }
  return sections
}

/** 最近两份快照目录（按 manifest.capturedAt 回退到目录名排序） */
function latestTwoSnapshots() {
  const dirs = readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => existsSync(join(OUT_ROOT, n, 'manifest.json')))
  // 版本目录名排序（semver 粗排：数字段逐位比）
  const key = (v) => v.split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  dirs.sort((a, b) => JSON.stringify(key(b)).localeCompare(JSON.stringify(key(a))))
  return [dirs[1], dirs[0]] // [old, new]
}

// ---------------------------------------------------------------------------
// 主流程（被 import 时不执行）
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const target = process.argv[2]
  if (!target || target === '--help' || target === '-h') {
    console.log('用法: node upgrade-checklist.mjs <targetVersion>')
    console.log('  例: node upgrade-checklist.mjs 0.2.0')
    process.exit(0)
  }

  const L = []
  L.push(`# DSH 升级检查单：→ ${target}`)
  L.push('')
  L.push(`> 由 upgrade-checklist.mjs 生成（AUDIT_TASKLIST §0.6）。生成时间 ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`)
  L.push('')

  // 1. npm 探测
  L.push('## 一、npm 发布探测')
  L.push('')
  const published = npmViewVersion(target)
  L.push(published
    ? `- \`@deepseek-ai/dsh@${target}\` 已发布（npm version = ${published}）。可 \`npm pack\` 或替换 dsh-runtime 后重跑 capture-contracts。`
    : `- ⚠️ \`@deepseek-ai/dsh@${target}\` npm 探测失败（未发布 / 网络不可达 / 私有源未登录）。按未发布处理，勿盲升。`)
  L.push('')

  // 2. 契约 diff（最近两份快照；只有一份或为零则标注跳过）
  L.push('## 二、契约快照 diff（最近两份）')
  L.push('')
  let snapshots = []
  try {
    snapshots = latestTwoSnapshots()
  } catch { /* contracts 目录缺失 */ }
  if (snapshots[0] && snapshots[1]) {
    try {
      // 复用 diff-contracts 的纯函数部分，报告落盘
      const { diffContractDirs } = await import(pathToFileURL(join(__dirname, 'diff-contracts.mjs')).href)
      const result = diffContractDirs(join(OUT_ROOT, snapshots[0]), join(OUT_ROOT, snapshots[1]))
      const touched = result.affected.filter((a) => a.touched)
      L.push(`- 对比 \`${snapshots[0]}\` → \`${snapshots[1]}\`：`)
      for (const [name, f] of Object.entries(result.facets)) {
        if (f.status === 'same') continue
        const n = f.diff.added.length + f.diff.removed.length + f.diff.changed.length
        L.push(`  - ${name}：${f.status}（${n} 处顶层差异）`)
      }
      if (Object.values(result.facets).every((f) => f.status === 'same')) L.push('  - 所有面顶层无差异')
      L.push(`- 受影响适配点：${touched.length}/${result.affected.length}`)
      for (const t of touched) L.push(`  - ⚠️ \`${t.contract}\` — ${t.file}:${t.line}`)
      L.push('- 完整报告见 contracts/ 下 diff-*.md。')
    } catch (e) {
      L.push(`- ⚠️ diff 执行失败：${e?.message ?? e}`)
    }
  } else {
    L.push(`- 跳过：contracts/ 下可用快照不足两份（现有 ${snapshots.filter(Boolean).length} 份）。先跑 capture-contracts.mjs。`)
  }
  L.push('')

  // 3. stub 清单
  L.push('## 三、运行时 stub 清单')
  L.push('')
  for (const s of stubInventory()) {
    if (s.items === null) L.push(`- ${s.name}：目录不存在，跳过`)
    else L.push(`- ${s.name}（${s.items.length} 项）：${s.items.join('、') || '（空）'}`)
  }
  L.push('')

  // 4. AUDIT_TASKLIST 风险行
  L.push('## 四、AUDIT_TASKLIST 🔴/🟡 未闭合风险行')
  L.push('')
  const risks = auditRiskLines()
  if (risks === null) {
    L.push(`- 跳过：找不到 ${relative(WS_ROOT, AUDIT_FILE)}（向上级目录探测失败）`)
  } else if (!risks.length) {
    L.push('- 无 🔴/🟡 行')
  } else {
    for (const r of risks) L.push(`- ${r}`)
  }
  L.push('')

  // 5. 升级动作清单
  L.push('## 五、升级后必做动作')
  L.push('')
  L.push('1. 替换/更新 dsh-runtime（Android 侧同步 dsh-runtime-android）')
  L.push('2. `node scripts/capture-contracts.mjs` 采集新版本快照')
  L.push('3. `node scripts/extract-adaptations.mjs` 刷新 @adapt 标记清单')
  L.push(`4. \`node scripts/diff-contracts.mjs contracts/<旧版本> contracts/${target}\` 出 diff 报告`)
  L.push('5. 按报告「受影响适配点」逐个核对 `// @adapt` 行是否仍成立')
  L.push('6. 真机回归：kickoff / 续跑 / 回退 / 重生成 / 变体条 / token 鉴权 401 路径')
  L.push('')

  const outFile = join(DOCS_DIR, `UPGRADE-CHECKLIST-${target}.md`)
  try {
    mkdirSync(DOCS_DIR, { recursive: true })
    writeFileSync(outFile, L.join('\n'), 'utf8')
    console.log(`[upgrade-checklist] 目标 ${target}｜npm ${published ? `已发布 ${published}` : '未发布/探测失败'}｜检查单 → ${relative(WS_ROOT, outFile)}`)
  } catch (e) {
    console.error(`[upgrade-checklist] 写出失败: ${e?.message ?? e}`)
    process.exitCode = 1
  }
}
