#!/usr/bin/env node
// ---------------------------------------------------------------------------
// capture-contracts.mjs —— DSH 契约快照采集（AUDIT_TASKLIST §0.6 范式准备）
//
// 用途：对当前 dsh-runtime 的 @deepseek-ai 包做一次自动化契约探测，把 7 个
// 「我们插件依赖、但 DSH 高频破坏性更新会改动」的契约面落到 contracts/<version>/
// 下的 JSON 快照。升级 DSH 后重跑一次 + diff-contracts.mjs 即可定位受影响适配点。
//
// 用法：node capture-contracts.mjs [--root <@deepseek-ai 包目录>]
//   --root 默认自动探测：<脚本目录>/../dsh-runtime/node_modules/@deepseek-ai
//
// 原则：任何一面采集不到就写 { missing: '原因' }，绝不抛异常中断整体；
//       零依赖（只用 node: 内建），Node ESM。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 工作区根（rp-workspace）：脚本固定在 rp-workspace/scripts/ 下
const WS_ROOT = resolve(__dirname, '..')
// 输出目录：rp-workspace/contracts/
const OUT_ROOT = join(WS_ROOT, 'contracts')

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 解析 --root 参数 */
function parseArgs(argv) {
  const args = { root: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--root') args.root = argv[++i] ?? null
  }
  return args
}

/** 自动探测 @deepseek-ai 包根：候选路径逐个试 */
function detectRoot() {
  const candidates = [
    args.root,
    join(WS_ROOT, 'dsh-runtime', 'node_modules', '@deepseek-ai'),
    join(WS_ROOT, 'dsh-runtime-android', 'node_modules', '@deepseek-ai'),
    join(WS_ROOT, 'dsh-runtime-x64', 'node_modules', '@deepseek-ai'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(join(c, 'dsh', 'package.json'))) return c
  }
  return candidates[0] ?? null
}

/** 安全读文本文件（不存在/读不了返回 null） */
function readText(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** 安全读 JSON（不存在/解析失败返回 null） */
function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 列目录（不存在返回 []；filter 可为函数或正则） */
function listDir(p, filter = null) {
  try {
    return readdirSync(p).filter((n) => {
      if (!filter) return true
      if (typeof filter === 'function') return filter(n)
      return filter.test(n)
    })
  } catch {
    return []
  }
}

/** 递归收集文件（相对 root，跳过 node_modules/.map） */
function walkFiles(root, exts, acc = [], base = root) {
  let entries = []
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = join(base, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walkFiles(root, exts, acc, full)
    } else if (exts.some((x) => e.name.endsWith(x))) {
      acc.push(full)
    }
  }
  return acc
}

/** 行剪裁：去首尾空白、截断到 max 字符（快照里存源码行原文用） */
function clip(line, max = 300) {
  const t = String(line).trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 按正则数组在文本里捞行（去重，保留首次出现顺序） */
function grepLines(text, patterns, max = 40) {
  const out = []
  const seen = new Set()
  const lines = text.split(/\r?\n/)
  for (const pat of patterns) {
    const re = typeof pat === 'string' ? new RegExp(pat) : pat
    for (const line of lines) {
      if (out.length >= max) return out
      if (re.test(line) && !seen.has(line)) {
        seen.add(line)
        out.push(clip(line))
      }
    }
  }
  return out
}

/** 单面采集包装：失败 → { missing }，成功 → 数据；并回填摘要 */
function facet(name, fn, summary) {
  try {
    const data = fn()
    summary.push(`  ${name}: OK`)
    return data
  } catch (e) {
    summary.push(`  ${name}: 采集失败 → ${e?.message ?? e}`)
    return { missing: String(e?.message ?? e) }
  }
}

// ---------------------------------------------------------------------------
// 面 1：session-api —— dsh-session/lib/types/index.d.ts 的 Session / SessionStore 方法签名
// ---------------------------------------------------------------------------

function captureSessionApi(root) {
  const file = join(root, 'dsh-session', 'lib', 'types', 'index.d.ts')
  const text = readText(file)
  if (text === null) throw new Error(`找不到 ${relative(root, file)}`)
  const lines = text.split(/\r?\n/)

  // 抽取一个 `export declare class X ... {` 类体的方法签名（读到类体闭合）
  const extractClass = (className, headerPattern) => {
    const start = lines.findIndex((l) => headerPattern.test(l))
    if (start < 0) return null
    const methods = []
    const getters = []
    let depth = 0
    let opened = false
    for (let i = start; i < lines.length && i < start + 800; i++) {
      const l = lines[i]
      for (const ch of l) {
        if (ch === '{') { depth++; opened = true } else if (ch === '}') depth--
      }
      if (opened && depth <= 0 && i > start) break
      const m = l.match(/^\s{4}(?:public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(/)
      if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[3])) {
        methods.push({ name: m[3], static: Boolean(m[1]), signature: clip(l, 200) })
        continue
      }
      const g = l.match(/^\s{4}get\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))?\s*:/)
      if (g) getters.push({ name: g[1], signature: clip(l, 200) })
    }
    return { className, line: start + 1, methods, getters }
  }

  const session = extractClass('Session', /^\s*export declare class Session \{/)
  const store = extractClass('SessionStore', /^\s*export declare class SessionStore extends Service \{/)

  // 兜底：找不到类就收所有 export function/interface 名
  let fallback = null
  if (!session && !store) {
    fallback = {
      exports: grepLines(text, [/^\s*export (declare )?(function|interface|type|class) /], 120).map(clip),
    }
  }

  return {
    source: relative(root, file).replace(/\\/g, '/'),
    classes: [session, store].filter(Boolean),
    ...(fallback ? { fallbackExports: fallback.exports } : {}),
  }
}

// ---------------------------------------------------------------------------
// 面 2：wire-api —— dsh-client-connection 的 RPC method 校验规则 + dsh-api-* method 清单
// ---------------------------------------------------------------------------

function captureWireApi(root) {
  // (a) method 校验规则线索：斜杠/点式、{args} 包裹
  const connFile = join(root, 'dsh-client-connection', 'lib', 'client.js')
  const connText = readText(connFile)
  const rules = connText === null
    ? []
    : grepLines(connText, [
      /CHANNEL_PATTERN\s*=/,
      /ENDPOINT_SEGMENT_PATTERN\s*=/,
      /invalid RPC target/,
      /method:\s*endpoint/,
      /args:\s*array\(unknown\(\)\)/,
      /assertTarget\(/,
      /client-request/,
    ], 30)

  // (b) dsh-api-* 包端点/事件 method 字符串清单（typert.remote-client.js 或类似文件的替代扫描：
  //     本版本无该文件，改为扫 dsh-api-gateway / dsh-api-remotes 的 lib/**/*.js 里
  //     「含斜杠的 method/事件名字符串」）
  const endpoints = []
  for (const pkg of listDir(root, (n) => n.startsWith('dsh-api-'))) {
    const pkgDir = join(root, pkg)
    for (const f of walkFiles(pkgDir, ['.js'])) {
      if (f.endsWith('.map')) continue
      const t = readText(f)
      if (!t) continue
      const strs = t.match(/'([a-zA-Z][\w-]*(?:\/[\w{}$.\[\]-]+)+)'/g) ?? []
      for (const s of strs) {
        const v = s.slice(1, -1)
        if (!endpoints.some((e) => e.method === v)) endpoints.push({ method: v, file: relative(pkgDir, f).replace(/\\/g, '/') })
      }
    }
  }
  endpoints.sort((a, b) => a.method.localeCompare(b.method))

  if (!rules.length && !endpoints.length) throw new Error('wire 规则与端点均未找到')
  return {
    source: connText === null ? null : relative(root, connFile).replace(/\\/g, '/'),
    rules,
    endpointPackages: listDir(root, (n) => n.startsWith('dsh-api-')),
    endpoints,
  }
}

// ---------------------------------------------------------------------------
// 面 3：slots —— dsh-client-ui-*（含 dsh-client-runtime）各 slots.d.ts 的 SlotMap 键名
// ---------------------------------------------------------------------------

function captureSlots(root) {
  const pkgs = listDir(root, (n) => n.startsWith('dsh-client-ui-') || n === 'dsh-client-runtime')
  const slots = []
  const byFile = {}
  for (const pkg of pkgs) {
    const pkgDir = join(root, pkg)
    for (const f of walkFiles(pkgDir, ['slots.d.ts'])) {
      const text = readText(f)
      if (!text) continue
      // 定位 interface SlotMap { ... } 块（含 declare module 增广），抓带引号键名
      const idx = text.indexOf('interface SlotMap')
      if (idx < 0) continue
      const body = text.slice(idx)
      const endMatch = body.match(/^\s*\}\s*$/m)
      const block = endMatch ? body.slice(0, endMatch.index) : body.slice(0, 4000)
      const keys = [...block.matchAll(/['"]([A-Za-z0-9_.-]+)['"]\s*:/g)].map((m) => m[1])
      if (!keys.length) continue
      const rel = relative(root, f).replace(/\\/g, '/')
      byFile[`${pkg}/${rel.split('/').slice(1).join('/')}`] = keys
      for (const k of keys) if (!slots.includes(k)) slots.push(k)
    }
  }
  if (!slots.length) throw new Error('任何 slots.d.ts 都没找到 SlotMap 键')
  slots.sort()
  return { total: slots.length, slots, byFile }
}

// ---------------------------------------------------------------------------
// 面 4：loader —— cordis-plugin-loader 调度特征 + dsh-client-modules 模块图排序签名
// ---------------------------------------------------------------------------

function captureLoader(root) {
  const loaderFile = join(root, 'cordis-plugin-loader', 'lib', 'index.js')
  const loaderText = readText(loaderFile)
  const features = loaderText === null ? [] : grepLines(loaderText, [/allSettled/, /\.map\(\(options\) => this\.create/], 12)

  const modulesFile = join(root, 'dsh-client-modules', 'lib', 'client.js')
  const modulesText = readText(modulesFile)
  const moduleGraph = modulesText === null ? [] : grepLines(modulesText, [/function orderByModuleGraph\(/, /orderByModuleGraph\(/], 6)

  if (!features.length && !moduleGraph.length) throw new Error('loader 与 module-graph 特征行均未找到')
  return {
    loaderSource: loaderText === null ? null : relative(root, loaderFile).replace(/\\/g, '/'),
    features,
    modulesSource: modulesText === null ? null : relative(root, modulesFile).replace(/\\/g, '/'),
    moduleGraph,
  }
}

// ---------------------------------------------------------------------------
// 面 5：persistence —— SESSION_FORMAT_VERSION / header 字段 / packChunks 配置
// ---------------------------------------------------------------------------

function capturePersistence(root) {
  // SESSION_FORMAT_VERSION 在 dsh-session 主包（persistence-jsonl 从那里 import）
  const sessionFile = join(root, 'dsh-session', 'lib', 'index.js')
  const sessionText = readText(sessionFile)
  let formatVersion = null
  let formatLine = null
  if (sessionText !== null) {
    const m = sessionText.match(/const SESSION_FORMAT_VERSION\s*=\s*(\d+)/)
    if (m) { formatVersion = Number(m[1]); formatLine = `const SESSION_FORMAT_VERSION = ${m[1]}` }
  }

  const pjFile = join(root, 'dsh-session-persistence-jsonl', 'lib', 'index.js')
  const pjText = readText(pjFile)
  if (formatVersion === null && pjText === null) throw new Error('dsh-session 与 persistence-jsonl 均不可读')

  // header 字段名：toHeaderLine 函数体里的键（version/id/createdAt/...）
  const headerFields = []
  if (pjText !== null) {
    const start = pjText.indexOf('function toHeaderLine(')
    if (start >= 0) {
      const body = pjText.slice(start, start + 1600)
      for (const m of body.matchAll(/^\s*(?:\.\.\.)?header\.(\w+)/gm)) headerFields.push(m[1])
      for (const m of body.matchAll(/^\s+(\w+):\s*header\./gm)) if (!headerFields.includes(m[1])) headerFields.push(m[1])
    }
  }

  // packChunks 配置行（schema 默认值行 + 打包逻辑行）
  const packChunks = pjText === null ? [] : grepLines(pjText, [/packChunks:\s*z\.boolean/, /function eventLines\(events, packChunks\)/, /packChunkRuns\(events\)/], 8)

  return {
    formatVersion,
    formatLine,
    headerFields: [...new Set(headerFields)],
    packChunks,
  }
}

// ---------------------------------------------------------------------------
// 面 6：settings —— dsh-client-ui-settings 类型文件的 Config/Schema 顶层键
// ---------------------------------------------------------------------------

function captureSettings(root) {
  const dir = join(root, 'dsh-client-ui-settings', 'lib', 'types')
  const files = existsSync(dir) ? walkFiles(dir, ['.d.ts']) : []
  if (!files.length) throw new Error('dsh-client-ui-settings/lib/types 不存在')
  const exported = {}
  const configBlocks = {}
  for (const f of files) {
    const text = readText(f)
    if (!text) continue
    const key = relative(dir, f).replace(/\\/g, '/')
    exported[key] = grepLines(text, [/^\s*export (declare )?(class|interface|type|const|function) /], 40)
    // interface Config { ... } / type Config = { ... } 的顶层键
    for (const head of text.matchAll(/interface (Config|Schema)\b[^{]*\{/g)) {
      const start = head.index + head[0].length
      let depth = 1, i = start
      while (i < text.length && depth > 0) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++ }
      const body = text.slice(start, i - 1)
      const keys = [...body.matchAll(/^\s{4}(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?]?:/gm)].map((m) => m[1])
      if (keys.length) configBlocks[`${key}#${head[1]}`] = keys
    }
  }
  return { exported, configBlocks }
}

// ---------------------------------------------------------------------------
// 面 7：presets —— agent-presets 的 tool-presentation mode 合法值行
// ---------------------------------------------------------------------------

function capturePresets(root) {
  // 预设 yml 在 dsh 主包 config/agent-presets/*/agent.cordis.yml（0.1.x 布局）
  const presetRoots = [
    join(root, 'dsh', 'config', 'agent-presets'),
    join(root, 'dsh-agent-presets', 'presets'),
  ].filter((p) => existsSync(p))
  const presets = []
  for (const pr of presetRoots) {
    for (const name of listDir(pr)) {
      const yml = join(pr, name, 'agent.cordis.yml')
      const text = readText(yml)
      if (text === null) continue
      const modeLines = grepLines(text, [/^\s*-?\s*id:\s*tool-presentation/, /^\s*mode:\s*\S+\s*$/, /^\s*name:\s*'@deepseek-ai\/dsh-agent-tool-presentation'/], 10)
      if (modeLines.length) presets.push({ preset: name, file: relative(root, yml).replace(/\\/g, '/'), lines: modeLines })
    }
  }

  // 合法 mode 值：dsh-agent-tool-presentation 的 z.union([...])
  const tpFile = join(root, 'dsh-agent-tool-presentation', 'lib', 'index.js')
  const tpText = readText(tpFile)
  let legalModes = []
  let configLine = null
  if (tpText !== null) {
    const m = tpText.match(/const Config = z\.object\(\{\s*mode:\s*z\.union\(\[([\s\S]*?)\]\)/)
    if (m) {
      legalModes = [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] ?? x[2])
      configLine = clip(tpText.slice(m.index, m.index + 200).split(/\r?\n/).slice(0, 6).join(' ⏎ '), 300)
    }
  }
  if (!presets.length && !legalModes.length) throw new Error('未找到任何 agent-presets yml 或 tool-presentation 合法值')
  return { presets, legalModes, configLine }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log('用法: node capture-contracts.mjs [--root <@deepseek-ai 包目录>]')
  console.log('  采集 DSH 契约快照到 contracts/<version>/（session-api / wire-api / slots / loader / persistence / settings / presets）')
  process.exit(0)
}

const root = detectRoot()
if (!root || !existsSync(root)) {
  console.error(`[capture-contracts] 找不到 @deepseek-ai 包目录（--root 或自动探测均失败）`)
  process.exit(1) // 仅这一处允许退出：没有输入目录整体无从谈起
}

// version：dsh 主包 package.json（找不到用 unknown）
const pkg = readJson(join(root, 'dsh', 'package.json'))
const version = typeof pkg?.version === 'string' ? pkg.version : 'unknown'
const outDir = join(OUT_ROOT, version)
mkdirSync(outDir, { recursive: true })

const summary = [`[capture-contracts] root=${root}`, `[capture-contracts] version=${version}`]
const files = {}

const facets = {
  'session-api.json': () => captureSessionApi(root),
  'wire-api.json': () => captureWireApi(root),
  'slots.json': () => captureSlots(root),
  'loader.json': () => captureLoader(root),
  'persistence.json': () => capturePersistence(root),
  'settings.json': () => captureSettings(root),
  'presets.json': () => capturePresets(root),
}

for (const [name, fn] of Object.entries(facets)) {
  const data = facet(name, fn, summary)
  try {
    writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
    files[name] = true
  } catch (e) {
    summary.push(`  ${name}: 写盘失败 → ${e?.message ?? e}`)
    files[name] = false
  }
}

// manifest
try {
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({ version, capturedAt: new Date().toISOString(), files: Object.keys(files).filter((k) => files[k]) }, null, 2) + '\n',
    'utf8',
  )
} catch { /* manifest 写失败不影响快照本体 */ }

// stdout 摘要（关键数量指标）
const sa = readJson(join(outDir, 'session-api.json'))
const wa = readJson(join(outDir, 'wire-api.json'))
const sl = readJson(join(outDir, 'slots.json'))
const pv = readJson(join(outDir, 'persistence.json'))
summary.push(
  `  session-api 方法数: ${sa && !sa.missing ? sa.classes.reduce((n, c) => n + c.methods.length, 0) : '—'}`,
  `  wire 规则行数: ${wa && !wa.missing ? wa.rules.length : '—'} / 端点数: ${wa && !wa.missing ? wa.endpoints.length : '—'}`,
  `  slots 数: ${sl && !sl.missing ? sl.total : '—'}`,
  `  SESSION_FORMAT_VERSION: ${pv && !pv.missing ? pv.formatVersion : '—'}`,
)
console.log(summary.join('\n'))
