#!/usr/bin/env node
// ---------------------------------------------------------------------------
// version-watch.mjs —— 监视 npm 上 @deepseek-ai/dsh 的新版本，追加写 VERSION-WATCH 日志
//
// 用法：node version-watch.mjs
//   1. `npm view @deepseek-ai/dsh versions --json` 取全量已发布版本
//   2. 对比 contracts/ 已有快照版本目录
//   3. 发现新版本：自动调 capture-contracts.mjs（本地 dsh-runtime 未升级到该版本时
//      采集到的是旧运行时——快照 version 不会变，此时标注「需手动 dsh-runtime 升级后采集」）
//   4. 追加式写 docs/VERSION-WATCH.md 日志
// 零依赖（node: 内建 + node:child_process），Node ESM。
// ---------------------------------------------------------------------------

import { readdirSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_ROOT = resolve(__dirname, '..')
const OUT_ROOT = join(WS_ROOT, 'contracts')
const DOCS_DIR = join(WS_ROOT, 'docs')
const WATCH_FILE = join(DOCS_DIR, 'VERSION-WATCH.md')

/** npm 全量版本列表；失败返回 null */
function npmVersions() {
  try {
    const out = execFileSync('npm', ['view', '@deepseek-ai/dsh', 'versions', '--json'], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const arr = JSON.parse(out)
    return Array.isArray(arr) ? arr.map(String) : null
  } catch {
    return null
  }
}

/** contracts/ 下已有快照版本（有 manifest.json 的目录名） */
function localSnapshots() {
  if (!existsSync(OUT_ROOT)) return []
  return readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(OUT_ROOT, e.name, 'manifest.json')))
    .map((e) => e.name)
}

/** 生成日志段（追加式） */
function renderLine(now, published, snapshots, newVersions, captureNote) {
  const L = []
  L.push(`## ${now}`)
  L.push('')
  L.push(`- npm 已发布版本数：${published === null ? '探测失败（网络/私有源不可达）' : published.length}`)
  if (published) {
    const last = published.slice(-5)
    L.push(`- 最近发布：${last.join('、')}`)
  }
  L.push(`- 本地快照版本：${snapshots.length ? snapshots.join('、') : '无（先跑 capture-contracts.mjs）'}`)
  if (newVersions.length) {
    L.push(`- 🆕 新版本（npm 有、本地无快照）：${newVersions.join('、')}`)
    L.push(`- 采集状态：${captureNote}`)
  } else {
    L.push('- 🆕 新版本：无')
  }
  L.push('')
  return L.join('\n')
}

// 主流程
const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
const published = npmVersions()
const snapshots = localSnapshots()
const newVersions = published ? published.filter((v) => !snapshots.includes(v)) : []

// 新版本自动采集：capture 读的是本地 dsh-runtime，npm 上有新版本 ≠ 本地已升级。
// 这里尝试跑一次采集；若产出快照 version 仍非新版本，说明本地运行时未升级 → 标注需手动。
let captureNote = '—'
if (newVersions.length && published) {
  try {
    const { execFileSync: run } = await import('node:child_process')
    const out = run('node', [join(__dirname, 'capture-contracts.mjs')], {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = String(out).match(/version=([\w.-]+)/)
    const captured = m ? m[1] : 'unknown'
    captureNote = newVersions.includes(captured)
      ? `已自动采集 contracts/${captured}/`
      : `自动采集得到 contracts/${captured}/（本地 dsh-runtime 仍是旧版）——${newVersions.join('、')} 需手动 dsh-runtime 升级后采集`
  } catch (e) {
    captureNote = `自动调 capture-contracts 失败：${e?.message ?? e}——需手动 dsh-runtime 升级后采集`
  }
} else if (!published) {
  captureNote = 'npm 探测失败，未尝试采集'
}

// 追加日志
try {
  mkdirSync(DOCS_DIR, { recursive: true })
  if (!existsSync(WATCH_FILE)) {
    appendFileSync(WATCH_FILE, '# DSH 版本监视日志（version-watch.mjs 追加式）\n\n', 'utf8')
  }
  appendFileSync(WATCH_FILE, renderLine(now, published, snapshots, newVersions, captureNote), 'utf8')
  console.log(`[version-watch] ${now}`)
  console.log(`  npm: ${published === null ? '探测失败' : `${published.length} 个版本`}｜本地快照: ${snapshots.length ? snapshots.join('、') : '无'}`)
  console.log(`  新版本: ${newVersions.length ? newVersions.join('、') : '无'}`)
  console.log(`  日志 → ${relative(WS_ROOT, WATCH_FILE)}`)
} catch (e) {
  console.error(`[version-watch] 日志写出失败: ${e?.message ?? e}`)
  process.exitCode = 1
}
