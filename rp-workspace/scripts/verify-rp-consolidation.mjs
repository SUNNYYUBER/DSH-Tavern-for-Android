#!/usr/bin/env node
/**
 * verify-rp-consolidation.mjs —— RP 插件**拆包完整性**验证（T-88 实施验收）
 * ============================================================================
 * ## 历史
 * T-87 版验证「总包加载 ≡ 5 个独立包加载」（2026-09-13 合并决策）。
 * T-88（2026-09-19 用户拍板「全量拆包」）反转：**主插件不得内联 R10 子模块**，
 * R10 四插件恢复独立构建。关键事实（2026-09-19 实证）：权威构建路径
 * （build-dsht.ps1 Step 4.7/4.72）**一直**是独立包形态，总包只存在于
 * rebuild-plugins.ps1 —— 本脚本守的就是「两条路径统一为独立包形态且拆干净」。
 *
 * ## 拆包后的真实风险（本脚本的判据面）
 *   · 「名义拆包」：总包入口还在 / 主插件仍内联子模块（判据 1/2）
 *   · 「拆丢了」：某 R10 独立包缺失、worker 跟错目录（判据 3/4/5）
 *   · 「顺序漂了」：patch 行顺序改变 ⇒ pre-step waterfall 嵌套变化（判据 6，B5 不变量）
 *   · 「行为变了」：路由前缀 / 设置命名空间 / pre-step 监听器与拆包前不一致（判据 7，动态实证）
 *   · 「PC 装不上」：R10 各包缺 dsh.bundle.patch（判据 8）
 *   · 「两条路径又分叉」：build-dsht.ps1 的 R10 构建形态被改成解析器认不出的样子（判据 8c）
 *
 * 用法：node scripts/verify-rp-consolidation.mjs
 *      node scripts/verify-rp-consolidation.mjs --selftest-parser   # 解析器自证（判据 8c）
 *      node scripts/verify-rp-consolidation.mjs --negative-control  # 反控：证明判据 2 真能抓到「拆不干净」
 */
import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const PKG = path.join(WS, 'packages')
const NODE = process.execPath
const ESB = path.join(PKG, 'node_modules', 'esbuild', 'bin', 'esbuild')
const NM = path.join(WS, 'dsh-runtime-android', 'node_modules')
const NODE_SERVICE = path.join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app', 'NodeService.kt')

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
}
const info = (m) => console.log(`  · ${m}`)

/** R10 四插件（顺序即 patch 语义；memory 必须最后——pre-step waterfall 顺序不变量 B5） */
const R10 = ['dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory']

/** 把某个 TS 入口打成临时 ESM，供动态行为判据 import */
function bundle (entry) {
  const tmp = path.join(os.tmpdir(), `rpv-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  execFileSync(NODE, [ESB, entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${tmp}`, '--log-level=warning'], {
    cwd: PKG, stdio: 'pipe', maxBuffer: 64e6,
    env: { ...process.env, DSH_HOME: path.join(os.tmpdir(), 'rpv-home') },
  })
  return tmp
}

/** mock ctx：只记录「拆包会改变的东西」——注册顺序、集合、事件名（不关心业务逻辑） */
function makeCtx (log) {
  const record = (kind, detail) => log.push(`${kind}|${detail}`)
  const svc = {
    register: (route) => { record('webServer.register', `${route.kind}:${route.path}`); return () => {} },
    host: '127.0.0.1', port: 3080,
  }
  const ctx = {
    on: (name) => { record('ctx.on', name) },
    emit: () => {},
    get webServer () { return svc },
    get settings () { return { register: (ns) => { record('settings.register', ns) }, update: async () => ({}), get: () => ({}) } },
    get sessions () { return { get: () => undefined } },
    get llm () { return { stream: async function * () {} } },
    get agentDefaultModel () { return { currentSelection: () => ({ provider: '', model: '' }) } },
    get tools () { return { register: (t) => { record('tools.register', t?.name ?? '?') } } },
    get systemPrompt () { return { section: (s) => { record('systemPrompt.section', `${s?.name}@${s?.order}`) } } },
    get credentials () { return { set: async () => ({}) } },
    get connection () { return { browserAuth: { launchToken: undefined } } },
    get agents () { return { get: () => undefined, list: () => [] } },
    get agentPresets () { return undefined },
    effect: () => {},
    get: (n, strict) => {
      record('ctx.get', `${n}${strict ? '(strict)' : ''}`)
      const known = ['webServer', 'settings', 'sessions', 'llm', 'agentDefaultModel', 'tools', 'systemPrompt', 'credentials', 'connection', 'agents']
      if (known.includes(n)) return ctx[n]
      if (strict) throw new Error(`cannot get required service "${n}" in inactive context`)
      return undefined
    },
    waterfall: async (_s, n, v, fn) => { record('ctx.waterfall', n); return fn(v) },
  }
  return ctx
}

// ---------------------------------------------------------------------------
// 判据 8c 用：解析 build-dsht.ps1 里「把某个包独立编译为包入口」的全部形态
// （T-87 W28 的解析器，拆包后用途变为「权威路径的 R10 独立构建形态仍可被机器读出」）
// ---------------------------------------------------------------------------
export function parseSplitEntries (src) {
  const lines = src.split(/\r?\n/)
  const arrays = new Map()
  for (const l of lines) {
    const m = l.match(/^\s*\$(\w+)\s*=\s*@\((.*)\)\s*$/)
    if (m) arrays.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]))
  }
  const entries = new Set()
  let r10Loop = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/foreach\s*\(\s*\$(\w+)\s+in\s+\$(\w+)\s*\)/)
    if (!m) continue
    const loopVar = m[1]; const arrVar = m[2]
    let depth = 0; let end = -1
    for (let j = i; j < lines.length; j++) {
      depth += (lines[j].match(/\{/g) ?? []).length
      depth -= (lines[j].match(/\}/g) ?? []).length
      if (j > i && depth <= 0) { end = j; break }
    }
    if (end < 0) continue
    const body = lines.slice(i, end + 1).join('\n')
    if (!new RegExp(`esbuild\\s+"src/\\$${loopVar}/index\\.ts"`).test(body)) continue
    const names = arrays.get(arrVar) ?? []
    r10Loop = { arrVar, loopVar, names, line: i + 1 }
    for (const n of names) entries.add(`src/${n}/index.ts`)
  }
  for (const l of lines) {
    if (l.trim().startsWith('#')) continue
    if (!/\besbuild\b/.test(l)) continue
    for (const mm of l.matchAll(/src\/([A-Za-z0-9_-]+)\/index\.ts/g)) entries.add(`src/${mm[1]}/index.ts`)
  }
  const unresolved = []
  const covered = r10Loop ? new RegExp(`^src/\\$${r10Loop.loopVar}/index\\.ts$`) : null
  for (const l of lines) {
    if (l.trim().startsWith('#')) continue
    const m = l.match(/\besbuild\s+("[^"]*"|\S+)/)
    if (!m) continue
    const entry = m[1].replace(/^["']|["']$/g, '')
    if (!entry.startsWith('src/') || !entry.includes('$')) continue
    if (covered && covered.test(entry)) continue
    unresolved.push(entry)
  }
  return { entries: [...entries].sort(), r10Loop, arrays: [...arrays.keys()], unresolved }
}

const PARSER_CASES = [
  ['正控：字面量 + 插值循环 ⇒ 5 个 entry',
    `& npx esbuild src/dsh-plugin/index.ts --bundle --outfile=a.js
$r10Plugins = @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory')
foreach ($r10 in $r10Plugins) {
    & npx esbuild "src/$r10/index.ts" --bundle --outfile=b.js
}`,
    { count: 5, hasLoop: true, loopNames: 4, unresolved: 0 }],
  ['★ 负控：只有字面量、无循环 ⇒ 必须只认 1 个（首版缺陷的复现形态）',
    `& npx esbuild src/dsh-plugin/index.ts --bundle --outfile=a.js`,
    { count: 1, hasLoop: false, loopNames: 0, unresolved: 0 }],
  ['★ 负控：循环在但数组定义缺失 ⇒ 展开失败（names=[]），须可被 8c 判红',
    `foreach ($r10 in $r10Plugins) {
    & npx esbuild "src/$r10/index.ts" --bundle --outfile=b.js
}`,
    { count: 0, hasLoop: true, loopNames: 0, unresolved: 0 }],
  ['负控：注释行里的 esbuild 不算（不得因文档示例虚增 entry）',
    `# 例：& npx esbuild src/dsht-plugin-fake/index.ts --bundle
& npx esbuild src/dsh-plugin/index.ts --bundle`,
    { count: 1, hasLoop: false, loopNames: 0, unresolved: 0 }],
  ['★ 负控：循环体 esbuild 用了别的变量 ⇒ 不得识别为包入口，且必须登记为「未覆盖入口」',
    `$r10Plugins = @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper')
foreach ($r10 in $r10Plugins) {
    & npx esbuild "src/$other/index.ts" --bundle --outfile=b.js
}`,
    { count: 0, hasLoop: false, loopNames: 0, unresolved: 1 }],
  ['★ 负控：全新形态（插值入口不在任何已识别循环里）⇒ 必须登记为「未覆盖」而不是静默漏掉',
    `& npx esbuild "src/$pkg/index.ts" --bundle --outfile=c.js`,
    { count: 0, hasLoop: false, loopNames: 0, unresolved: 1 }],
  ['正控：循环体多行、含花括号嵌套（块体范围须正确闭合）',
    `$r10Plugins = @('dsht-plugin-mvu')
foreach ($r10 in $r10Plugins) {
    if ($true) { Write-Host "x" }
    & npx esbuild "src/$r10/index.ts" --bundle --outfile=b.js
}`,
    { count: 1, hasLoop: true, loopNames: 1, unresolved: 0 }],
]

/** NodeService.pluginRows 的（id, pkg）有序解析（判据 6 用；Kotlin 字面量列表，形态稳定） */
function parsePluginRows (ktSrc) {
  const m = ktSrc.match(/val pluginRows = listOf\(([\s\S]*?)\)/)
  if (!m) return null
  return [...m[1].matchAll(/"([^"]+)"\s+to\s+"([^"]+)"/g)].map(x => ({ id: x[1], pkg: x[2] }))
}

// ---------------------------------------------------------------------------
// 主验证
// ---------------------------------------------------------------------------
async function main () {
  if (process.argv.includes('--selftest-parser')) {
    console.log('=== verify-rp-consolidation --selftest-parser（解析器自证；不打包、不依赖工作区）===')
    let n = 0
    for (const [label, script, want] of PARSER_CASES) {
      const r = parseSplitEntries(script)
      const loopNames = r.r10Loop ? r.r10Loop.names.length : 0
      const ok = r.entries.length === want.count &&
                 (r.r10Loop !== null) === want.hasLoop &&
                 loopNames === want.loopNames &&
                 r.unresolved.length === want.unresolved
      if (ok) n++
      console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label}`)
    }
    const realBd = path.join(HERE, 'build-dsht.ps1')
    if (fs.existsSync(realBd)) {
      const rr = parseSplitEntries(fs.readFileSync(realBd, 'utf8'))
      const ok = rr.entries.length >= 5 && rr.r10Loop && rr.r10Loop.names.length === 4 && rr.unresolved.length === 0
      if (ok) n++
      console.log(`  ${ok ? '[ok] ' : '[FAIL] '}真实 build-dsht.ps1：entries=${rr.entries.length}（≥5）· 循环成员=${rr.r10Loop ? rr.r10Loop.names.length : 0}（期望 4）· 未覆盖入口=${rr.unresolved.length}（期望 0）`)
    }
    const total = PARSER_CASES.length + (fs.existsSync(path.join(HERE, 'build-dsht.ps1')) ? 1 : 0)
    console.log(`\n[verify-rp-consolidation selftest-parser] ${n}/${total} PASS`)
    process.exit(n === total ? 0 : 3)
  }

  // ---- 反控（--negative-control）：往主插件产物注入「子模块注释」⇒ 判据 2 必须报红 ----
  const NEGCTL = process.argv.includes('--negative-control')
  const rpLib = path.join(NM, 'dsht-rp-plugin', 'lib', 'index.js')
  let negctlBytes = null
  if (NEGCTL) {
    if (!fs.existsSync(rpLib)) { console.error(`反控需要主插件产物在场：${rpLib}（先跑 rebuild-plugins.ps1）`); process.exit(2) }
    negctlBytes = fs.readFileSync(rpLib)
    fs.writeFileSync(rpLib, '// src/dsht-plugin-mvu/index.ts\n' + negctlBytes.toString('utf8'), 'utf8')
    info('反控：已向主插件产物注入「src/dsht-plugin-mvu/」注释（拆不干净的合成形态）')
  }

  try {
    // ---- 判据 1：总包入口退役 ----
    const legacyDir = path.join(PKG, 'src', 'dsht-rp')
    check(!fs.existsSync(legacyDir), '判据1 总包入口退役（packages/src/dsht-rp/ 不存在）',
      fs.existsSync(legacyDir) ? '目录仍在——总包未退役' : 'src/dsht-rp/ 已移除')

    // ---- 判据 2：主插件产物独立（拆不干净检测）----
    // 口径：只禁 R10 各包的**插件入口**（src/<pkg>/index.ts = apply 本体）；主插件对 R10
    // 各包**共享模块**的正当 import（ejs.ts / sandbox.ts / tables.ts / macros.ts，
    // 与 dsht-plugin-shared 同性质）不在禁止面（2026-09-19 首跑误报后收窄）。
    const rpText = fs.existsSync(rpLib) ? fs.readFileSync(rpLib, 'utf8') : null
    const leaked = R10.filter(p => rpText !== null && rpText.includes(`src/${p}/index.ts`))
    check(rpText !== null && leaked.length === 0 && rpText.includes('src/dsh-plugin/'),
      '判据2 主插件产物独立（不含 R10 插件入口 index.ts）',
      rpText === null ? '主插件产物缺失（先跑 rebuild-plugins.ps1）'
        : leaked.length > 0 ? `仍内联入口：${leaked.join(', ')}` : '主插件本体（dsh-plugin）')

    // ---- 判据 3：R10 四包产物在场且独立（不交叉内联**插件入口**）----
    {
      const missing = []
      const cross = []
      for (const p of R10) {
        const f = path.join(NM, p, 'lib', 'index.js')
        if (!fs.existsSync(f)) { missing.push(p); continue }
        const t = fs.readFileSync(f, 'utf8')
        if (!t.includes(`src/${p}/index.ts`)) cross.push(`${p}（缺自己的入口注释）`)
        for (const q of R10) if (q !== p && t.includes(`src/${q}/index.ts`)) cross.push(`${p}（内联了 ${q} 入口）`)
      }
      check(missing.length === 0 && cross.length === 0, '判据3 R10 四包产物在场且互不内联入口',
        missing.length > 0 ? `缺失：${missing.join(', ')}` : cross.length > 0 ? cross.join('；') : '4/4 在场且独立')
    }

    // ---- 判据 4：ejs-worker 随 prompt-template 独立包（workerPath 与加载者同目录）----
    check(fs.existsSync(path.join(NM, 'dsht-plugin-prompt-template', 'lib', 'ejs-worker.js')),
      '判据4 ejs-worker.js 随 dsht-plugin-prompt-template/lib/（worker 静默退化防线）')

    // ---- 判据 5：双面形态（主插件 client + dsh.client 声明）----
    {
      const clientOk = fs.existsSync(path.join(NM, 'dsht-rp-plugin', 'lib', 'client.js'))
      let dshClient = false
      try { dshClient = typeof JSON.parse(fs.readFileSync(path.join(NM, 'dsht-rp-plugin', 'package.json'), 'utf8'))?.dsh?.client === 'object' } catch { /* 读取失败按 false */ }
      check(clientOk && dshClient, '判据5 双面形态（dsht-rp-plugin/lib/client.js + dsh.client 声明）',
        !clientOk ? 'client.js 缺失' : !dshClient ? 'package.json 缺 dsh.client' : 'host + client 一包双面')
    }

    // ---- 判据 6：NodeService.pluginRows 顺序与齐全（B5 顺序不变量）----
    {
      const rows = fs.existsSync(NODE_SERVICE) ? parsePluginRows(fs.readFileSync(NODE_SERVICE, 'utf8')) : null
      const ids = rows?.map(r => r.id) ?? []
      const expect = ['dsht-rp', 'dsht-mvu', 'dsht-tavern-helper', 'dsht-prompt-template', 'dsht-mobile', 'dsht-memory', 'preset-enhance']
      const missingRows = expect.filter(e => !ids.includes(e))
      const orderOk = ids.indexOf('dsht-rp') !== -1 && ids.indexOf('dsht-memory') !== -1 && ids.indexOf('dsht-rp') < ids.indexOf('dsht-memory')
      check(rows !== null && missingRows.length === 0 && orderOk,
        '判据6 pluginRows 齐全（7 行）且 dsht-rp 先于 dsht-memory（pre-step 顺序不变量）',
        rows === null ? 'pluginRows 解析失败（Kotlin 形态变了？）'
          : missingRows.length > 0 ? `缺行：${missingRows.join(', ')}`
            : !orderOk ? `顺序：${ids.join(' → ')}` : ids.join(' → '))
    }

    // ---- 判据 7：动态行为（按 patch 顺序 apply 6 个源码模块，比对可观测注册）----
    {
      const modules = ['dsh-plugin', ...R10.slice(0, 3), 'dsht-plugin-mobile', 'dsht-plugin-memory']
      const log = []
      for (const m of modules) {
        const entry = path.join(PKG, 'src', m, 'index.ts')
        // Windows：ESM import 只认 file:// URL（绝对路径裸传会 ERR_UNSUPPORTED_ESM_URL_SCHEME）
        const mod = await import(pathToFileURL(bundle(entry)).href + `#${Date.now()}-${m}`)
        const ctx = makeCtx(log)
        await mod.apply(ctx, {})
      }
      const routes = [...new Set(log.filter(l => l.startsWith('webServer.register|')).map(l => l.split('|')[1]))]
      const prefixes = [...new Set(routes.map(r => r.split(':')[1]))].sort()
      const wantPrefixes = ['/dsht-memory', '/dsht-mvu', '/dsht-prompt-template', '/dsht-rp', '/dsht-tavern-helper']
      const routesOk = wantPrefixes.every(p => prefixes.some(x => x === p))
      const preSteps = log.filter(l => l === 'ctx.on|agent/pre-step')
      const preStepOk = preSteps.length === 2
      const ns = [...new Set(log.filter(l => l.startsWith('settings.register|')).map(l => l.split('|')[1]))].sort()
      const wantNs = ['dsht-plugin-memory', 'dsht-plugin-mvu', 'dsht-plugin-prompt-template', 'dsht-plugin-tavern-helper']
      const nsOk = wantNs.every(n => ns.includes(n))
      check(routesOk && preStepOk && nsOk,
        '判据7 动态行为（5 条路由前缀 + 2 个 pre-step + 4 个设置命名空间）',
        `routes=${prefixes.join(',')} preStep=${preSteps.length} ns=${ns.join(',')}`)
    }

    // ---- 判据 8：R10 各包 PC 可装性（dsh.bundle.patch 声明 + patch 文件在场）----
    {
      const bad = []
      for (const p of R10) {
        const dir = path.join(NM, p)
        let decl = false
        try { decl = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))?.dsh?.bundle?.patch === './cordis.patch.yml' } catch { /* false */ }
        if (!decl) bad.push(`${p}（package.json 缺 dsh.bundle.patch）`)
        if (!fs.existsSync(path.join(dir, 'cordis.patch.yml'))) bad.push(`${p}（cordis.patch.yml 缺失）`)
      }
      check(bad.length === 0, '判据8 R10 各包 PC 可装性（dsh.bundle.patch + cordis.patch.yml）',
        bad.length > 0 ? bad.join('；') : '4/4 可 dsh plugin add')
    }

    // ---- 判据 8c：权威路径的 R10 独立构建形态仍可被机器读出（解析器自证的实时版）----
    {
      const rr = parseSplitEntries(fs.readFileSync(path.join(HERE, 'build-dsht.ps1'), 'utf8'))
      const ok = rr.entries.length >= 5 && rr.r10Loop !== null && rr.r10Loop.names.length === 4 && rr.unresolved.length === 0
      check(ok, '判据8c build-dsht.ps1 的 R10 独立构建形态可解析（entries≥5 · 循环成员=4 · 未覆盖=0）',
        `entries=${rr.entries.length} loopNames=${rr.r10Loop ? rr.r10Loop.names.length : 0} unresolved=${rr.unresolved.length}`)
    }
  } finally {
    if (negctlBytes !== null) {
      fs.writeFileSync(rpLib, negctlBytes)
      info('反控：主插件产物已还原')
    }
  }

  const pass = results.filter(r => r.ok).length
  console.log(`\n[verify-rp-consolidation] ${pass}/${results.length} PASS`)
  if (NEGCTL) {
    // 反控语义：判据 2 在注入期间必须报红（判据 2 是「拆不干净」防线）
    const c2 = results.find(r => r.label.startsWith('判据2'))
    const leaked = c2 !== undefined && !c2.ok
    console.log(`[negctl] 注入「子模块注释」后判据2 ${leaked ? '已报红（反控成立）' : '未报红（反控失败——判据2 无区分力）'}`)
    process.exit(leaked ? 0 : 1)
  }
  process.exit(pass === results.length ? 0 : 1)
}

await main()
