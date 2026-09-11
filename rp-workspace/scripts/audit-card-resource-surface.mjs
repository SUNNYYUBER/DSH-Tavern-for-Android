#!/usr/bin/env node
/**
 * audit-card-resource-surface.mjs — 一次性静态穷举「卡脚本依赖宿主提供什么」
 * =====================================================================
 * 动机（LEARNINGS **L43**）：本项目在**外部资源面**上已经逐次踩坑三次 ——
 *   T-42/T-60  卡 `fetch('/version')` → 我方 404 → 版本分叉静默走错
 *   T-63       卡 `importFromModule` 请求 4 个 ST 内部模块 → 我方全 404
 * 每次都是「运行时报一个错 → 修一个」。本工具把这条路一次走完：
 * **机械抽取卡脚本对宿主的所有外部资源依赖，与宿主实际提供面做差集。**
 *
 * 抽取四类（都带出现次数与行号）：
 *   MODULE   `importFromModule('<容器>', [{ items:[…], from:'./x' }])` → 模块路径 + 具名导出
 *   EP        `fetch('<字面量>')` → 端点（相对路径可用 --probe 实测 HTTP 码）
 *   GLOBAL    `globalThis.<X>` / `window.<X>` → 期望的宿主全局（标记是否 `?.` 可选链）
 *   SCRIPT    `<script src>` / `<link href>` 字面量（卡自带资源期望）
 *
 * 用法：
 *   node audit-card-resource-surface.mjs <card.js> [more.js …]
 *        [--probe http://127.0.0.1:3080]   # 对相对端点做 HTTP HEAD/GET 实测
 *        [--json] [--selftest]
 * 退出码：0 正常；1 用法错/自检失败
 *
 * ⚠️ 纪律（L44）：**枚举器自身必须先过正控**。`--selftest` 用合成夹具钉住四类形态 +
 * 一条**负控**（注释掉的调用不得计入），任何一类退化都会让自检失败。
 */
import { readFileSync } from 'node:fs'

// ---------- 注释剥离（负控的依据：注释里的调用不算依赖） ----------
/** 去掉 `//` 行注释与块注释；**保留字符串字面量内容**（端点在字符串里）。
 * 顺序：先块注释再行注释，避免块注释内的 `//` 被误当行注释开头。 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

// ---------- 四类抽取 ----------
const RE_IMPORT_CALL = /importFromModule\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[([\s\S]*?)\]\s*\)/g
const RE_IMPORT_ITEM = /items\s*:\s*\[([^\]]*)\]/g
const RE_IMPORT_FROM = /from\s*:\s*['"]([^'"]+)['"]/g
const RE_FETCH = /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g
const RE_GLOBAL = /\b(?:globalThis|window)\.([A-Za-z_$][\w$]*)/g
const RE_SRC = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 裸标识符引用（无 `globalThis.`/`window.` 前缀、且不在字符串里）。
 *
 * **为什么必须单独抽**：卡对同一容器有两种写法 ——
 *   `globalThis.SPresetImports?.x` → 缺失时静默降级（不报错）
 *   `SPresetImports.x`            → 缺失时 **ReferenceError**
 * 二者的后果完全不同（T-63 的核心分档依据），只抽带前缀的那种会把严重档漏掉。 */
export function findBareRefs(src, name) {
  const re = new RegExp(`(?<![.\\w$'"\`])${escapeRe(name)}\\b`, 'g')
  const lines = []
  for (const m of src.matchAll(re)) lines.push(lineOf(src, m.index))
  return lines
}

/** 从卡源码抽取四类依赖。纯函数（可单测/可自检）。 */
export function extractCardResources(rawSrc) {
  const src = stripComments(rawSrc)
  const out = { modules: [], endpoints: [], globals: [], scripts: [] }

  for (const m of src.matchAll(RE_IMPORT_CALL)) {
    const [, container, body] = m
    const items = []
    for (const it of body.matchAll(RE_IMPORT_ITEM)) {
      items.push(...it[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean))
    }
    const froms = [...body.matchAll(RE_IMPORT_FROM)].map((x) => x[1])
    out.modules.push({ container, froms, items, line: lineOf(src, m.index), bareRefs: findBareRefs(src, container) })
  }

  for (const m of src.matchAll(RE_FETCH)) {
    out.endpoints.push({ url: m[1], line: lineOf(src, m.index) })
  }

  // 去重计数：同一全局读多次只留一条，但记次数与首次行号；`?.` 紧跟即为可选链
  const gmap = new Map()
  for (const m of src.matchAll(RE_GLOBAL)) {
    const name = m[1]
    const after = src.slice(m.index + m[0].length)
    const optional = after.startsWith('?') && after.slice(1).trimStart().startsWith('.')
    const prev = gmap.get(name)
    if (prev) { prev.count++; prev.optional = prev.optional && optional }
    else gmap.set(name, { name, count: 1, optional, line: lineOf(src, m.index) })
  }
  out.globals = [...gmap.values()].sort((a, b) => b.count - a.count)

  for (const m of src.matchAll(RE_SRC)) {
    out.scripts.push({ url: m[1], line: lineOf(src, m.index) })
  }
  return out
}

/** 卡自有的全局命名（我们自己写的簿记变量）≠ 期望宿主提供的。 */
const CARD_OWNED = /^(SPreset|regexBinding|__regexBinding_|SToolBook)/
/** 宿主绝对该提供的（基准面），缺了就是缺陷。 */
const HOST_EXPECTED = /^(SillyTavern|TavernHelper|toastr|showdown|YAML|EjsTemplate|z|\$|_)$/

export function classifyGlobal(name) {
  if (HOST_EXPECTED.test(name)) return 'host-expected'
  if (CARD_OWNED.test(name)) return 'card-owned'
  return 'unknown'
}

// ---------- 自检（正控；L44） ----------
function selftest() {
  const fixture = `
    // importFromModule('SHOULD_NOT_COUNT', [{ items: ['x'], from: './nope' }])
    /* fetch('/also-not') */
    importFromModule('SPresetImports', [
      { items: ['promptManager', 'Message'], from: './scripts/openai' },
      { items: ['streamingProcessor'], from: './script' },
    ]);
    importFromModule('STVersionImports', [ { items: ['displayVersion'], from: './script' } ]);
    await fetch('/version');
    const a = globalThis.SPresetImports?.promptManager;
    const b = SPresetImports.x;
    const c = window.versionNumber + globalThis.toastr.a + window.$;
    void a; void b; void c;
  `
  const r = extractCardResources(fixture)
  const checks = [
    ['MODULE 容器数 == 2', r.modules.length === 2],
    ['负控：注释里的 importFromModule 不计入', !r.modules.some((m) => m.container === 'SHOULD_NOT_COUNT')],
    ['负控：注释里的 fetch 不计入', !r.endpoints.some((e) => e.url === '/also-not')],
    ['MODULE 具名导出齐全（3 个）', JSON.stringify(r.modules.flatMap((m) => m.items).sort()) === JSON.stringify(['Message', 'displayVersion', 'promptManager', 'streamingProcessor'])],
    ['MODULE 路径去 `.js` 原样保留', r.modules[0].froms.includes('./scripts/openai') && r.modules[0].froms.includes('./script')],
    ['EP 抽到 /version', r.endpoints.length === 1 && r.endpoints[0].url === '/version'],
    ['GLOBAL 计数正确（SPresetImports ×1）', r.globals.find((g) => g.name === 'SPresetImports')?.count === 1],
    ['GLOBAL 可选链标记正确', r.globals.find((g) => g.name === 'SPresetImports')?.optional === true],
    ['GLOBAL 非可选链标记正确', r.globals.find((g) => g.name === 'toastr')?.optional === false],
    ['GLOBAL 认得出 window.$', r.globals.some((g) => g.name === '$')],
    ['BARE 抓到裸标识符引用（SPresetImports ×1，排除带前缀与引号内）', r.modules.find((m) => m.container === 'SPresetImports')?.bareRefs.length === 1],
    ['BARE 不把 importFromModule(\'X\') 的字符串算成裸引用', r.modules.find((m) => m.container === 'STVersionImports')?.bareRefs.length === 0],
    ['分类：toastr/SillyTavern → host-expected', classifyGlobal('toastr') === 'host-expected' && classifyGlobal('SillyTavern') === 'host-expected'],
    ['分类：SPreset* → card-owned', classifyGlobal('SPresetTempData') === 'card-owned' && classifyGlobal('regexBinding_onSortableStop') === 'card-owned'],
  ]
  let pass = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
    if (ok) pass++
  }
  console.log(`\n--selftest：${pass}/${checks.length} ${pass === checks.length ? 'PASS' : 'FAIL'}`)
  return pass === checks.length
}

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)

  const jsonOut = argv.includes('--json')
  const pi = argv.indexOf('--probe')
  const probeBase = pi >= 0 ? argv[pi + 1] : null
  const files = argv.filter((a, i) => !a.startsWith('--') && !(pi >= 0 && i === pi + 1))
  if (files.length === 0) {
    console.error('用法: node audit-card-resource-surface.mjs <card.js> [more.js…] [--probe <base>] [--json] [--selftest]')
    process.exit(1)
  }

  const report = []
  for (const f of files) {
    const raw = readFileSync(f, 'utf8')
    const r = extractCardResources(raw)
    // 相对端点实测（只测相对路径；绝对外链不动 —— 那是卡自己的外网资源）
    if (probeBase) {
      for (const e of r.endpoints) {
        if (!e.url.startsWith('/')) { e.probe = 'skip(absolute)'; continue }
        try {
          const res = await fetch(probeBase.replace(/\/$/, '') + e.url, { method: 'GET' })
          e.probe = `HTTP ${res.status}`
        } catch (err) { e.probe = 'ERR ' + String(err.message).slice(0, 40) }
      }
    }
    report.push({ file: f, ...r })
  }

  if (jsonOut) { console.log(JSON.stringify(report, null, 1)); return }

  for (const rep of report) {
    console.log(`\n===== ${rep.file} =====`)
    console.log(`\n[MODULE] 卡期望宿主提供的 ES 模块（缺 → 整个容器脚本不实例化）`)
    if (rep.modules.length === 0) console.log('  （无）')
    for (const m of rep.modules) {
      console.log(`  L${m.line}  容器 ${m.container}  ← ${m.froms.join(' , ') || '(未解析)'}`)
      console.log(`          具名导出: ${m.items.join(', ')}`)
      console.log(`          裸引用   : ${m.bareRefs.length === 0 ? '0（全部走 ?. 守卫 → 缺失即静默降级）' : m.bareRefs.length + ' 处 L' + m.bareRefs.join(',L') + '（缺失即 ReferenceError）'}`)
    }
    console.log(`\n[EP] fetch 端点（相对路径 + --probe 时给 HTTP 码）`)
    if (rep.endpoints.length === 0) console.log('  （无）')
    for (const e of rep.endpoints) console.log(`  L${e.line}  ${e.url}${e.probe ? '   → ' + e.probe : ''}`)
    console.log(`\n[GLOBAL] 期望的宿主全局（?. = 缺失时静默降级；无 ? = 缺失即抛）`)
    if (rep.globals.length === 0) console.log('  （无）')
    for (const g of rep.globals) {
      console.log(`  L${g.line}  ${g.name}  ×${g.count}  ${g.optional ? '?.' : '  '} [${classifyGlobal(g.name)}]`)
    }
    if (rep.scripts.length) {
      console.log(`\n[SCRIPT] 资源字面量`)
      for (const s of rep.scripts) console.log(`  L${s.line}  ${s.url}`)
    }
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/audit-card-resource-surface.mjs')
if (isMain) await main()
