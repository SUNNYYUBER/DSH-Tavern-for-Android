#!/usr/bin/env node
// ---------------------------------------------------------------------------
// extract-adaptations.mjs —— 扫插件源码里的 @adapt 契约标记，产出 adaptations.json
//
// 用法：node extract-adaptations.mjs
//   扫 packages/src/**/*.{ts,tsx}（跳过 node_modules/dist）里的
//   `// @adapt contract:<id>` 标记（行内或上一行），输出
//   contracts/adaptations.json: [{ contract, file, line, snippet }]
//   file 为相对 rp-workspace 根的路径；line 为 1-based 行号。
// 零依赖，Node ESM。升级 DSH 后 diff-contracts.mjs 用它定位受影响适配点。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_ROOT = resolve(__dirname, '..')
const SRC_ROOT = join(WS_ROOT, 'packages', 'src')
const OUT_FILE = join(WS_ROOT, 'contracts', 'adaptations.json')

// 标记正则：`// @adapt contract:<id>`（id 允许字母数字点横线星号，如 slots.conversation.chat.*）
const MARKER_RE = /^\s*\/\/\s*@adapt\s+contract:([A-Za-z0-9_.-]+)\s*$/

/** 递归收集 .ts/.tsx 文件 */
function walkTs(dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue
      walkTs(full, acc)
    } else if (['.ts', '.tsx'].includes(extname(e.name))) {
      acc.push(full)
    }
  }
  return acc
}

const results = []
if (!existsSync(SRC_ROOT)) {
  console.error(`[extract-adaptations] 源码目录不存在: ${SRC_ROOT}`)
} else {
  for (const file of walkTs(SRC_ROOT)) {
    let text = null
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(MARKER_RE)
      if (!m) continue
      results.push({
        contract: m[1],
        file: relative(WS_ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        snippet: lines[i].trim(),
      })
    }
  }
}

results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
try {
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2) + '\n', 'utf8')
  console.log(`[extract-adaptations] ${results.length} 条 @adapt 标记 → ${relative(WS_ROOT, OUT_FILE)}`)
  const byContract = {}
  for (const r of results) byContract[r.contract] = (byContract[r.contract] ?? 0) + 1
  for (const [c, n] of Object.entries(byContract).sort()) console.log(`  ${c}: ${n}`)
} catch (e) {
  console.error(`[extract-adaptations] 写出失败: ${e?.message ?? e}`)
  process.exitCode = 1
}
