#!/usr/bin/env node
// ---------------------------------------------------------------------------
// diff-contracts.mjs —— 对比两份 DSH 契约快照，产出 diff 报告
//
// 用法：node diff-contracts.mjs <oldVersionDir> <newVersionDir>
//   两个目录均为 contracts/<version>/（绝对或相对 rp-workspace 根均可）。
//   对每个同名 json 求差（顶层键集合 added/removed + 变更键的值摘要），
//   结合 contracts/adaptations.json 列出「受影响适配点」，
//   输出 contracts/diff-<old>-to-<new>.md。
// 零依赖，Node ESM。diffContractDirs() 同时被 upgrade-checklist.mjs 复用。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute, basename, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_ROOT = resolve(__dirname, '..')
const OUT_ROOT = join(WS_ROOT, 'contracts')

/** 解析快照目录（相对路径以 rp-workspace 为基） */
function resolveDir(p) {
  return isAbsolute(p) ? p : resolve(WS_ROOT, p)
}

/** 值摘要：对象→键列表，数组→长度+首元素，其余→截断字符串 */
function preview(v, max = 120) {
  if (v === null || v === undefined) return String(v)
  if (Array.isArray(v)) {
    const head = v.length > 0 ? preview(v[0], 40) : ''
    return `array(${v.length})[${head}]`
  }
  if (typeof v === 'object') return `object{${Object.keys(v).slice(0, 8).join(',')}}`
  const s = String(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 求一个 json 面的顶层差异 */
function diffFacet(oldData, newData) {
  const diff = { added: [], removed: [], changed: [] }
  const oldKeys = oldData && typeof oldData === 'object' && !Array.isArray(oldData) ? Object.keys(oldData) : []
  const newKeys = newData && typeof newData === 'object' && !Array.isArray(newData) ? Object.keys(newData) : []
  const oldIsObj = oldKeys.length > 0 || (oldData && !Array.isArray(oldData) && Object.keys(oldData).length === 0 && oldData.constructor === Object)
  const newIsObj = newKeys.length > 0 || (newData && !Array.isArray(newData) && Object.keys(newData).length === 0 && newData.constructor === Object)
  if (oldIsObj && newIsObj) {
    for (const k of newKeys) if (!(k in oldData)) diff.added.push(`${k} = ${preview(newData[k])}`)
    for (const k of oldKeys) if (!(k in newData)) diff.removed.push(`${k}（旧值 ${preview(oldData[k])}）`)
    for (const k of oldKeys) {
      if (k in newData && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])) {
        diff.changed.push(`${k}: ${preview(oldData[k])} → ${preview(newData[k])}`)
      }
    }
  } else if (JSON.stringify(oldData) !== JSON.stringify(newData)) {
    // 标量/数组整体变化
    diff.changed.push(`整体: ${preview(oldData)} → ${preview(newData)}`)
  }
  return diff
}

/** 契约 id 的首段（session-api.eventAt → session-api）映射到快照 json 文件名 */
function contractFacet(contractId) {
  const head = contractId.split('.')[0]
  const map = {
    'session-api': 'session-api.json',
    'wire-api': 'wire-api.json',
    wire: 'wire-api.json',
    slots: 'slots.json',
    loader: 'loader.json',
    persistence: 'persistence.json',
    settings: 'settings.json',
    presets: 'presets.json',
    // 无对应快照面的契约（webview/web 等前端/壳侧），仍列出但不判定受影响
  }
  return map[head] ?? null
}

/**
 * 对比两份快照，返回结构化结果（供 CLI 输出与 upgrade-checklist 复用）。
 * @returns {{ facets: Record<string, facetDiff>, affected: Array, missing: string[] }}
 */
export function diffContractDirs(oldDir, newDir) {
  const facets = {}
  const names = [...new Set([...readdirSync(oldDir), ...readdirSync(newDir)])]
    .filter((n) => n.endsWith('.json') && n !== 'manifest.json')
    .sort()
  for (const name of names) {
    const load = (dir) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8'))
      } catch {
        return undefined
      }
    }
    const oldData = load(oldDir)
    const newData = load(newDir)
    if (oldData === undefined && newData === undefined) continue
    if (oldData === undefined) {
      facets[name] = { status: 'new', diff: diffFacet({}, newData) }
    } else if (newData === undefined) {
      facets[name] = { status: 'removed', diff: diffFacet(oldData, {}) }
    } else {
      const diff = diffFacet(oldData, newData)
      const dirty = diff.added.length + diff.removed.length + diff.changed.length
      facets[name] = { status: dirty > 0 ? 'changed' : 'same', diff }
    }
  }

  // 受影响适配点：adaptations.json 里 contract 首段命中「有差异的面」
  const affected = []
  let adaptations = []
  const adaptFile = join(OUT_ROOT, 'adaptations.json')
  try {
    adaptations = JSON.parse(readFileSync(adaptFile, 'utf8'))
    if (!Array.isArray(adaptations)) adaptations = []
  } catch {
    adaptations = []
  }
  for (const a of adaptations) {
    const facetName = contractFacet(a.contract)
    const f = facetName ? facets[facetName] : null
    const touched = Boolean(f && f.status !== 'same')
    affected.push({ ...a, facet: facetName, touched })
  }
  return { facets, affected, hasAdaptations: adaptations.length > 0 }
}

/** 渲染 markdown 报告 */
function render(oldName, newName, result) {
  const L = []
  L.push(`# DSH 契约 diff：${oldName} → ${newName}`)
  L.push('')
  L.push(`> 由 diff-contracts.mjs 生成（AUDIT_TASKLIST §0.6）。面状态：changed = 顶层有增删改；same = 无差异。`)
  L.push('')
  L.push('## 一、契约面差异')
  L.push('')
  const entries = Object.entries(result.facets)
  if (!entries.length) {
    L.push('（无同名可比对的 json 面）')
  } else {
    for (const [name, f] of entries) {
      const dirty = f.diff.added.length + f.diff.removed.length + f.diff.changed.length
      L.push(`### ${name} — ${f.status === 'new' ? '新出现' : f.status === 'removed' ? '已消失' : f.status === 'changed' ? `changed（${dirty} 处）` : 'same'}`)
      L.push('')
      if (f.status === 'same') {
        L.push('顶层无差异。')
      } else {
        if (f.diff.added.length) {
          L.push('- 新增键：')
          for (const a of f.diff.added) L.push(`  - ${a}`)
        }
        if (f.diff.removed.length) {
          L.push('- 移除键：')
          for (const r of f.diff.removed) L.push(`  - ${r}`)
        }
        if (f.diff.changed.length) {
          L.push('- 变更键：')
          for (const c of f.diff.changed) L.push(`  - ${c}`)
        }
      }
      L.push('')
    }
  }
  L.push('## 二、受影响适配点（@adapt 标记）')
  L.push('')
  if (!result.hasAdaptations) {
    L.push('（contracts/adaptations.json 不存在或为空——先跑 extract-adaptations.mjs）')
  } else {
    const touched = result.affected.filter((a) => a.touched)
    L.push(`标记总数 ${result.affected.length}，其中受本次差异影响 ${touched.length} 条。`)
    L.push('')
    if (touched.length) {
      L.push('| contract | 文件:行 | 涉及面 |')
      L.push('| --- | --- | --- |')
      for (const t of touched) L.push(`| ${t.contract} | ${t.file}:${t.line} | ${t.facet} |`)
    }
    L.push('')
    L.push('<details><summary>全部 @adapt 标记（含未受影响的）</summary>')
    L.push('')
    for (const a of result.affected) {
      L.push(`- ${a.touched ? '⚠️' : '✓'} \`${a.contract}\` — ${a.file}:${a.line}${a.facet ? `（面 ${a.facet}）` : '（无对应快照面，人工确认）'}`)
    }
    L.push('')
    L.push('</details>')
  }
  L.push('')
  return L.join('\n')
}

// CLI 主流程（被 import 时不执行）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [oldArg, newArg] = process.argv.slice(2)
  if (!oldArg || !newArg || oldArg === '--help' || oldArg === '-h') {
    console.log('用法: node diff-contracts.mjs <oldVersionDir> <newVersionDir>')
    console.log('  例: node diff-contracts.mjs contracts/0.1.0-rc.7 contracts/0.2.0')
    process.exit(0)
  }
  const oldDir = resolveDir(oldArg)
  const newDir = resolveDir(newArg)
  for (const [label, d] of [['old', oldDir], ['new', newDir]]) {
    if (!existsSync(d)) {
      console.error(`[diff-contracts] ${label} 目录不存在: ${d}`)
      process.exit(1)
    }
  }
  const result = diffContractDirs(oldDir, newDir)
  const oldName = basename(oldDir)
  const newName = basename(newDir)
  const outFile = join(OUT_ROOT, `diff-${oldName}-to-${newName}.md`)
  try {
    writeFileSync(outFile, render(oldName, newName, result), 'utf8')
    const dirty = Object.entries(result.facets).filter(([, f]) => f.status !== 'same')
    console.log(`[diff-contracts] ${oldName} → ${newName}`)
    console.log(`  有差异的面: ${dirty.length ? dirty.map(([n, f]) => `${n}(${f.status})`).join('、') : '无'}`)
    console.log(`  受影响适配点: ${result.affected.filter((a) => a.touched).length}/${result.affected.length}`)
    console.log(`  报告 → ${relative(WS_ROOT, outFile)}`)
  } catch (e) {
    console.error(`[diff-contracts] 报告写出失败: ${e?.message ?? e}`)
    process.exitCode = 1
  }
}
