/**
 * lint.mjs —— dsh-plugin-lint 核心（纯函数，可单测）
 * ============================================================================
 * 输入：解开的插件包目录（含 package.json）
 * 输出：{ verdict: 'pass'|'risk'|'fail', findings: [{ rule, severity, detail, file? }] }
 *
 * 判据哲学：规则全部来自真实实测案例（见 rules.mjs 头注）；金标准回放 =
 * 人工实测结论即测试集（session-pin/better-stats ✅，turn-index/outline ⚠，zhipu ❌）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { RULES } from './rules.mjs'

const RULE = Object.fromEntries(RULES.map(r => [r.id, r]))

// DSH 运行时提供的 bare 前缀（host 侧 cordis 插件环境）+ client 侧 ModuleLoader external
const BARE_PROVIDED = /^(cordis($|\/)|@deepseek-ai\/|node:|react$|react\/|react-dom$|react-dom\/)/
const NODE_BUILTINS = new Set([
  'fs', 'path', 'crypto', 'os', 'util', 'events', 'stream', 'buffer', 'url', 'worker_threads',
  'child_process', 'http', 'https', 'net', 'zlib', 'assert', 'module', 'process', 'readline',
  'querystring', 'string_decoder', 'timers', 'tls', 'tty', 'dns', 'dgram', 'v8', 'vm',
])
const NATIVE_MODULES = /^(sharp|koffi|node-pty|better-sqlite3|sqlite3|canvas|onnxruntime(-\w+)?|ref-napi|ffi-napi)$/
// P1 能力包内置（DSHTavern）；ffmpeg/docker/python 等不在其列
const ANDROID_TOOL_WHITELIST = /\b(bash|sh|rg|git|zstd)\b/
// ⑧ client face 内部投影形态（turn-index / outline 双案实测模式）
const CLIENT_FACE_PATTERNS = [
  { re: /sessions\.binding\s*\(/, label: 'sessions.binding()' },
  { re: /\.session\.getSnapshot\s*\(/, label: 'session.getSnapshot()' },
  { re: /\bsnap(?:shot)?\.chat\.(order|nodes)/, label: 'snapshot.chat.order/nodes' },
  { re: /\bsnapshot\.nodes\b/, label: 'snapshot.nodes' },
]

function* walkJs (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walkJs(p) }
    else if (/\.(js|mjs|cjs)$/.test(e.name)) yield p
  }
}

export function scanSpecifiers (text) {
  const out = []
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function resolveRel (fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const c of [base, base + '.js', base + '.mjs', base + '.cjs', path.join(base, 'index.js'), path.join(base, 'index.mjs')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** client 面文件判定：exports['./client'] / dsh.client 存在时的 client 入口 */
function clientFiles (dir, pkg) {
  const out = []
  const rel = (p) => p ? path.join(dir, p.replace(/^\.\//, '')) : null
  const cand = []
  if (pkg.exports?.['./client']) cand.push(typeof pkg.exports['./client'] === 'string' ? pkg.exports['./client'] : null)
  if (pkg.client?.main) cand.push(pkg.client.main)
  if (pkg.dsh?.client) cand.push('./lib/client.js', './client.js')
  for (const c of cand) {
    const p = rel(c)
    if (p && fs.existsSync(p)) out.push(p)
  }
  return [...new Set(out)]
}

/** 主入口：lint 一个解开的包目录。 */
export function lintPackage (dir) {
  const findings = []
  const add = (ruleId, detail, file) => {
    const rule = RULE[ruleId]
    findings.push({ rule: ruleId, severity: rule.severity, face: rule.face, typology: rule.typology, detail, file })
  }

  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    add('S6-required-fields', 'package.json 不存在')
    return summarize(findings)
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  // S6 必备字段（main 或 exports['.'] 其一即可——ESM 包可无 main，better-stats 实证）
  const missingFields = ['name', 'version', 'description', 'license'].filter(f => !pkg[f])
  if (!pkg.main && !pkg.exports?.['.']) missingFields.push('main/exports["."]')
  if (missingFields.length) add('S6-required-fields', `缺：${missingFields.join(', ')}`)

  // S3 插件清单
  if (!fs.existsSync(path.join(dir, 'cordis.patch.yml')) && !fs.existsSync(path.join(dir, 'dsh.plugin.json'))) {
    add('S3-plugin-manifest', 'cordis.patch.yml 与 dsh.plugin.json 均不存在')
  }

  // S4 engines.dsh
  if (!pkg.engines?.dsh) add('S4-engines-dsh', 'engines.dsh 未声明')

  // S5 files 清单（glob 项跳过——npm files 支持 glob（outline 的 lib/types/**/*.d.ts 实证），
  // glob 的正确性由 npm pack --dry-run 兜底，静态不做展开）
  for (const f of pkg.files ?? []) {
    if (/[*?[\]]/.test(f)) continue
    if (!fs.existsSync(path.join(dir, f))) add('S5-files-exist', `files 清单项不存在：${f}`)
  }

  // S1/S2：import 闭包 + bare 声明
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])
  const missingRel = []
  const undeclaredBare = new Set()
  for (const js of walkJs(dir)) {
    for (const spec of scanSpecifiers(fs.readFileSync(js, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        if (!resolveRel(js, spec)) missingRel.push(`${path.relative(dir, js)} → ${spec}`)
      } else {
        const head = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        if (!BARE_PROVIDED.test(spec) && !NODE_BUILTINS.has(head) && !declared.has(head)) undeclaredBare.add(spec)
      }
    }
  }
  // 去重到「文件 → specifier」粒度
  for (const m of [...new Set(missingRel)].slice(0, 20)) add('S1-closure', m)
  for (const b of undeclaredBare) add('S2-bare-undeclared', `import "${b}" 未在 dependencies/peerDependencies 声明`)

  // N1：client 面 client face 嗅探
  for (const cf of clientFiles(dir, pkg)) {
    const text = fs.readFileSync(cf, 'utf8')
    for (const { re, label } of CLIENT_FACE_PATTERNS) {
      if (re.test(text)) add('N1-client-face', `${label}（client face 内部投影，非 cordis 契约面）`, path.relative(dir, cf))
    }
  }

  // A1/A2：Android 约束（host 面 = 非 client 文件的 .js）
  const clientSet = new Set(clientFiles(dir, pkg))
  const nativeHits = new Set()
  const toolHits = new Set()
  for (const js of walkJs(dir)) {
    if (clientSet.has(js)) continue
    const text = fs.readFileSync(js, 'utf8')
    for (const spec of scanSpecifiers(text)) {
      const head = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (NATIVE_MODULES.test(head)) nativeHits.add(head)
    }
    for (const m of text.matchAll(/(?:spawn|execFile|exec)\s*\(\s*['"]([^'"]+)['"]/g)) {
      if (!ANDROID_TOOL_WHITELIST.test(m[1])) toolHits.add(m[1])
    }
  }
  for (const n of nativeHits) add('A1-native-module', `host 侧依赖原生模块 "${n}"（Android 不可用）`)
  for (const t of toolHits) add('A2-subprocess-tool', `spawn "${t}"（Android 白名单外工具；白名单 = bash/sh/rg/git/zstd）`)

  return summarize(findings)
}

const FACE_ORDER = ['fail', 'risk', 'pass']
function faceVerdict (findings, face) {
  const fs = findings.filter(f => f.face === face)
  if (fs.some(f => f.severity === 'fail')) return 'fail'
  if (fs.some(f => f.severity === 'risk')) return 'risk'
  return 'pass'
}

function summarize (findings) {
  const faces = {
    host: faceVerdict(findings, 'host'),
    android: faceVerdict(findings, 'android'),
    stability: faceVerdict(findings, 'stability'),
  }
  const verdict = FACE_ORDER.find(v => Object.values(faces).includes(v)) ?? 'pass'
  return { verdict, faces, findings }
}
