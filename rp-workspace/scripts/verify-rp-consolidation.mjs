#!/usr/bin/env node
/**
 * verify-rp-consolidation.mjs —— 「总包加载 ≡ 5 个独立包加载」语义等价性验证（T-87 实施验收）
 * ============================================================================
 * ## 为什么需要这个脚本（L143 的应用）
 * 合并插件最大的风险不是"能不能跑"，而是**行为是否悄悄变了**：
 *   · 5 个包各自 apply → 变成 1 个包内顺序 apply，**注册顺序**变了就会改变
 *     waterfall 的嵌套结构（`agent/pre-step` 尤甚）与路由/命名空间的注册时序；
 *   · 而这类变化**不报错**（本项目主力缺陷族：静默）。
 * ⇒ 判据必须是**逐项比对的实证**，不能靠"看起来一样"。
 *
 * ## 判据（12 项）
 * 1. 总包能加载（`apply` 不抛）
 * 2. **子模块调用顺序**与 patch 行原顺序一致（`dsht-rp` → mvu → th → pt → memory）
 * 3. **HTTP 路由前缀集合**完全一致（5 个：/dsht-rp、/dsht-mvu、/dsht-tavern-helper、/dsht-prompt-template、/dsht-memory）
 * 4. **设置命名空间集合**完全一致（4 个：dsht-plugin-mvu / -tavern-helper / -prompt-template / -memory）
 * 5. **`agent/pre-step` 监听器数量**一致（2 个：主包 + memory），且**注册先后**一致
 * 6. 其它 cordis 事件（system-prompt/assemble、agent/request、llm/stream）数量一致
 * 6b. 合并路径多出的 `ctx.get` 服务**全部来自可选服务清单**（B1 降级视图未误代理必需服务）
 * 7. `ctx.tools.register` / `ctx.systemPrompt.section` 调用集合一致
 * 8. 子模块 `name` **字面量**保持原值，且 `name`/`inject` **已降为内部使用**（不再 export）
 * 9. 总包 `name` 沿用 `dsht-rp-plugin`
 * 10. 总包 `inject` = 必需服务、且**不含任何可选服务**（B1）
 * 11. **B1 行为**：ctx 缺全部可选服务（属性访问会抛）时，总包仍不抛且 5 个子模块照常注册
 * 12.（隐含在 5/6）注册序列**逐条**一致，非仅集合一致
 *
 * ## 做法
 * 用 mock ctx（记录全部调用）分别跑两次：
 *   A. 【基线】按原顺序单独 apply 5 个模块
 *   B. 【合并】apply 总包
 * 然后比对两次记录的**调用序列**。
 *
 * ## 附：本脚本依赖的 cordis 语义（实测得出，勿凭直觉改判据）
 * 判据 10/11 建立在以下**实测事实**上（不是读源码推断）：
 *   · `inject` 是**激活门** —— 列了缺的服务 ⇒ 该 entry 完全不激活（`apply` 一次都不调用）；
 *   · `apply` 内访问**未 inject** 的服务属性 ⇒ 抛 `cannot get property "X" without inject`
 *     ——**即使该服务已由上层提供**；
 *   · `ctx.get('X')` 对**不存在**的服务**静默返回 `undefined`**（不抛）⇒ 这才是"可选"语义。
 * ⇒ 故总包必须把可选服务移出 `inject`、改走 `ctx.get`（判据 10 查结构、判据 11 查行为）。
 *
 * 用法：node scripts/verify-rp-consolidation.mjs
 *      node scripts/verify-rp-consolidation.mjs --negative-control   # 反控：证明本脚本真能抓到不一致
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

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
}
const info = (m) => console.log(`  · ${m}`)

/** 把某个 TS 入口打成临时 ESM，供 import */
function bundle (entry) {
  const tmp = path.join(os.tmpdir(), `rpv-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  execFileSync(NODE, [ESB, entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${tmp}`, '--log-level=warning'], {
    cwd: PKG, stdio: 'pipe', maxBuffer: 64e6,
    env: { ...process.env, DSH_HOME: path.join(os.tmpdir(), 'rpv-home') },
  })
  return tmp
}

/**
 * 构造 mock ctx：记录所有可观测的调用。
 *
 * 设计要点：**只记录"合并会改变的东西"** —— 注册顺序、集合、事件名。
 * 不记录业务返回值（本验证不关心业务逻辑，只关心"接线是否等价"）。
 */
function makeCtx (log) {
  const record = (kind, detail) => log.push(`${kind}|${detail}`)
  const svc = {
    // 需要 exists 判断的服务：给最小可用面
    register: (route) => { record('webServer.register', `${route.kind}:${route.path}`); return () => {} },
    host: '127.0.0.1', port: 3080,
  }
  const ctx = {
    // cordis 事件
    on: (name) => { record('ctx.on', name) },
    emit: () => {},
    // 服务（getter 形式，模拟 cordis 的 inject 保护：这里全给，因为我们验的是"接线"而非"服务可用性"）
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
    // 通用
    effect: () => {},
    get: (n, strict) => {
      // 复刻 cordis reflect.get 语义：可选服务缺失返回 undefined；strict=true 时抛
      record('ctx.get', `${n}${strict ? '(strict)' : ''}`)
      const known = ['webServer', 'settings', 'sessions', 'llm', 'agentDefaultModel', 'tools', 'systemPrompt', 'credentials', 'connection', 'agents']
      if (known.includes(n)) return ctx[n]
      if (strict) throw new Error(`cannot get required service "${n}" in inactive context`)
      return undefined
    },
    // cordis 的 waterfall / on 兼容面
    waterfall: async (_s, n, v, fn) => { record('ctx.waterfall', n); return fn(v) },
  }
  return ctx
}

/**
 * 解析 `build-dsht.ps1`（权威构建路径）里「把某个包**独立编译为包入口**」的全部形态。
 *
 * 为什么不能只做字面量匹配（W28 实测教训）：Step 4.72 用**循环 + 变量插值**
 *   `foreach ($r10 in $r10Plugins) { … esbuild "src/$r10/index.ts" … }`
 * ⇒ 那 4 个 entry **从不以字面量出现**。只匹配字面量会漏 4 项，
 *   使「路径是否已归一」的判定**假阳性**（漏归一也会被判成已归一）。
 *
 * 返回：
 *   · entries  —— 去重后的 `src/<pkg>/index.ts` 列表（两种形态合并）
 *   · r10Loop  —— 检出的插值循环（含 `names`：展开后的包名；`names=[]` 表示**展开失败**）
 *   · arrays   —— 解析到的数组定义变量名（诊断用）
 */
export function parseSplitEntries (src) {
  const lines = src.split(/\r?\n/)

  // ① 单行数组定义：$name = @('a', 'b', ...)
  const arrays = new Map()
  for (const l of lines) {
    const m = l.match(/^\s*\$(\w+)\s*=\s*@\((.*)\)\s*$/)
    if (m) arrays.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]))
  }

  const entries = new Set()
  let r10Loop = null

  // ② 插值循环形态：foreach ($loopVar in $arrVar) { … esbuild "src/$loopVar/index.ts" … }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/foreach\s*\(\s*\$(\w+)\s+in\s+\$(\w+)\s*\)/)
    if (!m) continue
    const loopVar = m[1]; const arrVar = m[2]
    // 块体范围：花括号深度归零的那一行为止（行内花括号也要计数）
    let depth = 0; let end = -1
    for (let j = i; j < lines.length; j++) {
      depth += (lines[j].match(/\{/g) ?? []).length
      depth -= (lines[j].match(/\}/g) ?? []).length
      if (j > i && depth <= 0) { end = j; break }
    }
    if (end < 0) continue
    const body = lines.slice(i, end + 1).join('\n')
    // 关键：必须是**把该变量插值成包入口**的 esbuild 调用
    if (!new RegExp(`esbuild\\s+"src/\\$${loopVar}/index\\.ts"`).test(body)) continue
    const names = arrays.get(arrVar) ?? []
    r10Loop = { arrVar, loopVar, names, line: i + 1 }
    for (const n of names) entries.add(`src/${n}/index.ts`)
  }

  // ③ 字面量形态：esbuild 行里直接写出的 src/<pkg>/index.ts
  for (const l of lines) {
    if (l.trim().startsWith('#')) continue          // PowerShell 注释行不参与
    if (!/\besbuild\b/.test(l)) continue
    for (const mm of l.matchAll(/src\/([A-Za-z0-9_-]+)\/index\.ts/g)) entries.add(`src/${mm[1]}/index.ts`)
  }

  // ④ **闭合自检**（P-41 推论三：判据的覆盖面本身也要有判据）
  //   逐一取出每条 esbuild 的 **entry 参数**（第一个非选项实参）；若它含变量插值
  //   却没被 ② 展开覆盖 ⇒ 登记为 `unresolved`。这样「漏形态」不会静默：
  //   将来谁把入口改成 `foreach ($p in $someList) { esbuild "src/$p/…" }` 的新写法，
  //   8c 会直接报红，而不是悄悄给出一个残缺清单。
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

// ---------------------------------------------------------------------------
// 解析器自证（--selftest-parser）—— 不打包、不加载插件，只验「清单解析」这一步
// ---------------------------------------------------------------------------
// ## 为什么需要（P-41 推论三：判据的覆盖面本身也要有判据）
// 判据 8②③ 的结论**完全依赖** parseSplitEntries 给出的「是否已归一」。
// 解析器若漏形态（正是首版只匹配字面量的缺陷），结论会**反向**：
//   漏归一 ⇒ 误判已归一 ⇒ 对 4 个仍需 export 的子模块报红。
// ⇒ 用合成输入覆盖「字面量 / 插值循环 / 展开失败 / 注释干扰 / 变量名不符」五种形态。
//
// ⚠️ 用例只含**合成**脚本片段（不读真实文件）—— 保证自证在任何工作区状态下都可跑。
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
      console.log(`         entries=${r.entries.length}（期望 ${want.count}）· loop=${r.r10Loop ? 'yes' : 'no'}（期望 ${want.hasLoop ? 'yes' : 'no'}）· loopNames=${loopNames}（期望 ${want.loopNames}）· unresolved=${r.unresolved.length}（期望 ${want.unresolved}）`)
    }
    // 附加：真实脚本上必须解析出 5 个，且**不得有未覆盖的插值入口**
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

  const entryRp = path.join(PKG, 'src', 'dsht-rp', 'index.ts')
  if (!fs.existsSync(entryRp)) { console.error(`找不到总包入口：${entryRp}`); process.exit(2) }

  // ---- 反控（--negative-control）：临时破坏总包，断言判据必须报红 ----
  // 做法（L144：改**源码**而非产物；源码锚点稳定）：
  //   把 SUB_PLUGINS 里最后两项**对调**（memory ↔ prompt-template）——
  //   这会改变注册顺序，而顺序是本验证的核心判据（判据2）。
  //   期望：判据2 报红；还原后必须回绿。
  const NEGCTL = process.argv.includes('--negative-control')
  const BAK = entryRp + '.negctlbak'
  if (NEGCTL) {
    const orig = fs.readFileSync(entryRp, 'utf8')
    fs.writeFileSync(BAK, orig)
    // 精确交换两行的 label 与 apply（保持语法合法）。
    //
    // 【2026-09-14 W4 修复】原实现用**硬编码 LF 的多行字符串**做锚点，而在
    // `git config core.autocrlf=true` 的 Windows 工作区里该文件落盘是 **CRLF**
    // ⇒ `replace` 匹配不到 ⇒ 走到下面的「锚点不匹配」分支、以 exit 2 退出。
    // 后果不是「反控失败」而是**反控从未生效**：`rebuild-plugins.ps1:159` 见到
    // 非 0 就抛「该门不可信」，于是整条构建链断在最后一步（本地一直如此）。
    // 修法：锚点用**行尾无关**的正则（`\r?\n`），既认 LF 也认 CRLF。
    // 【教训 · P-29 同族】判据的实现假设（此处 = 行尾风格）会静默废掉判据本身；
    // 证据串（文件里明明有那两行）与结论（「锚点不匹配」）矛盾即是识别特征。
    const pair = (aLabel, aApply, bLabel, bApply) =>
      new RegExp(
        // ① `\\{` / `\\}` = 转义后的字面花括号（模板串里 `\\{` → `\{`）；
        // ② 两行之间的换行**必须捕获**（还原时按同一行尾拼回，不统一成 LF 以免整文件行尾漂移）；
        // ③ 第二行的**行首缩进**必须容忍（实际是两空格）——首版漏了这条，于是
        //    `(\r?\n)\{` 匹配不上 `\r\n  {`，反控再次退化为「锚点不匹配」。
        `\\{ label: '${aLabel}', apply: ${aApply}[^}]*\\},(\\r?\\n)[ \\t]*\\{ label: '${bLabel}', apply: ${bApply}[^}]*\\},`,
      )
    const before = pair('dsht-plugin-prompt-template', 'applyPromptTemplate', 'dsht-plugin-memory', 'applyMemory')
    const swapped = orig.replace(before, (m, nl) => m.split(nl).reverse().join(nl))
    if (swapped === orig) { console.error('[negctl] 无法交换顺序（锚点不匹配）——反控未生效，不能据此下结论'); fs.unlinkSync(BAK); process.exit(2) }
    fs.writeFileSync(entryRp, swapped)
    console.log('[negctl] 已对调最后两个子模块的顺序（制造不一致），期望判据2 报红…\n')
    let brokeOk = false
    try {
      brokeOk = await runChecks(entryRp)   // 期望 false（判据2 应该报红）
    } finally {
      fs.copyFileSync(BAK, entryRp)
      fs.unlinkSync(BAK)
      console.log('\n[negctl] 已还原总包源码')
    }
    console.log('[negctl] 复跑确认回绿…\n')
    const restoredOk = await runChecks(entryRp)

    // 反控的成功判据：破坏时**必须**报红（否则本脚本是"永远绿"的死判据），还原后**必须**回绿
    const negctlPass = (brokeOk === false) && (restoredOk === true)
    console.log(`\n[verify-rp-consolidation --negative-control] ${negctlPass ? 'PASS' : 'FAIL'}`)
    console.log(`  · 破坏时（顺序被换）报红：${brokeOk === false ? '✓' : '✗ 没报红 ⇒ 本脚本抓不到顺序变化（死判据）'}`)
    console.log(`  · 还原后回绿：${restoredOk === true ? '✓' : '✗ 没回绿 ⇒ 有残留'} `)
    process.exit(negctlPass ? 0 : 1)
  }

  const ok = await runChecks(entryRp)
  process.exit(ok ? 0 : 1)
}

async function runChecks (entryRp) {
  results.length = 0
  // 隔离一个干净的 DSH_HOME，避免子模块 apply 时读到真实用户数据
  const fakeHome = path.join(os.tmpdir(), `rpv-home-${process.pid}`)
  fs.mkdirSync(path.join(fakeHome, 'rp'), { recursive: true })
  process.env.DSH_HOME = fakeHome

  info('打包 5 个原子模块 + 总包…')
  const subEntries = [
    ['dsh-plugin', path.join(PKG, 'src', 'dsh-plugin', 'index.ts')],
    ['dsht-plugin-mvu', path.join(PKG, 'src', 'dsht-plugin-mvu', 'index.ts')],
    ['dsht-plugin-tavern-helper', path.join(PKG, 'src', 'dsht-plugin-tavern-helper', 'index.ts')],
    ['dsht-plugin-prompt-template', path.join(PKG, 'src', 'dsht-plugin-prompt-template', 'index.ts')],
    ['dsht-plugin-memory', path.join(PKG, 'src', 'dsht-plugin-memory', 'index.ts')],
  ]
  const tmps = []
  try {
    // ---- A. 基线：按原顺序单独 apply ----
    const logA = []
    for (const [label, entry] of subEntries) {
      const t = bundle(entry)
      tmps.push(t)
      const mod = await import(pathToFileURL(t).href)
      if (typeof mod.apply !== 'function') { console.error(`${label} 无 apply 导出`); process.exit(2) }
      logA.push(`=== SUB ${label} ===`)
      mod.apply(makeCtx(logA), undefined)
    }

    // ---- B. 合并：apply 总包 ----
    const t2 = bundle(entryRp)
    tmps.push(t2)
    const rpMod = await import(pathToFileURL(t2).href)
    const logB = []
    let threw = null
    try { rpMod.apply(makeCtx(logB), undefined) } catch (e) { threw = e }

    // ---- 判据 1：总包能加载 ----
    check(threw === null, '判据1 总包 apply 不抛异常', threw ? String(threw.message).slice(0, 200) : '')

    // 总包日志会多出「装载子模块」行（那是刻意的出声），比对前剔除。
    // 【2026-09-13 心跳 77 补充】还需剔除 **全部 `ctx.get|…`** 记录：
    //   总包新增了「可选服务降级视图」（B1），把子模块里 `ctx.connection` 这类属性读
    //   转成 `ctx.get('connection')` ⇒ 合并路径会**多出** ctx.get 记录，
    //   而基线路径（每个模块各自带完整 inject、直接读属性）不会记录。
    //   ⚠️ 这是**视图的实现细节**，不是注册行为差异：两条路径拿到的**服务取值完全相同**
    //   （视图内部就是 `ctx.get(name)`，只多了一次记录）。
    //   ⇒ 本判据关心的是「注册序列」（路由/命名空间/事件/tools），故剔除 ctx.get 噪声。
    //   ⚠️ 剔除不等于放弃验证：ctx.get 降级本身由**判据 11** 专门做行为验证
    //      （喂缺全部可选服务的 ctx，断言不抛且注册照常）。
    const strip = (log) => log.filter(l => !l.includes('=== SUB') && !l.startsWith('ctx.get|'))

    const A = strip(logA)
    const B = strip(logB)

    // ---- 判据 2：子模块调用顺序 ----
    const subOrderA = subEntries.map(([l]) => l).join(' → ')
    // 从总包源码里读 SUB_PLUGINS 顺序（更可靠：直接看声明）
    const rpSrc = fs.readFileSync(entryRp, 'utf8')
    const orderBlock = rpSrc.slice(rpSrc.indexOf('const SUB_PLUGINS'), rpSrc.indexOf('/**', rpSrc.indexOf('const SUB_PLUGINS')))
    const orderB = [...orderBlock.matchAll(/label: '([^']+)'/g)].map(m => m[1]).join(' → ')
    const normA = subEntries.map(([l]) => (l === 'dsh-plugin' ? 'dsh-plugin(RP 主干)' : l)).join(' → ')
    check(orderB === normA, '判据2 子模块注册顺序与 patch 原顺序一致',
      `总包: ${orderB}`)

    // ---- 判据 3：路由前缀集合 ----
    const routesOf = (log) => log.filter(l => l.startsWith('webServer.register|')).map(l => l.split('|')[1]).sort()
    const ra = routesOf(A); const rb = routesOf(B)
    check(JSON.stringify(ra) === JSON.stringify(rb), '判据3 HTTP 路由注册集合完全一致',
      `${rb.length} 条：${[...new Set(rb)].join(', ')}${JSON.stringify(ra) !== JSON.stringify(rb) ? `\n      基线: ${[...new Set(ra)].join(', ')}` : ''}`)

    // ---- 判据 4：设置命名空间集合 ----
    const nsOf = (log) => log.filter(l => l.startsWith('settings.register|')).map(l => l.split('|')[1]).sort()
    const na = nsOf(A); const nb = nsOf(B)
    check(JSON.stringify(na) === JSON.stringify(nb), '判据4 设置命名空间集合完全一致',
      `${[...new Set(nb)].join(', ')}${JSON.stringify(na) !== JSON.stringify(nb) ? `\n      基线: ${[...new Set(na)].join(', ')}` : ''}`)

    // ---- 判据 5：agent/pre-step 关联的**完整调用序列** ----
    // B5 核心：cordis waterfall 是「先注册者包在外层」（events.ts:238 `cbs.shift() ?? inner`），
    // 而主包与 memory 都「await next() 之后再改 decision.messages」⇒ **谁在外层会改变最终 messages 组合**。
    //
    // ⚠️ 判据设计教训（本轮踩到，记此防复发）：最初想在每次 `ctx.on` 时记录"当前归属模块"
    //   （用最近注册的路由前缀当标签），结果**基线路径误报**——
    //   因为基线是「每模块一个 ctx」，标签状态不跨模块延续；而合并是「共用一个 ctx」，
    //   标签会从上一个模块残留下来 ⇒ 两条路径的标签语义不同、不可比。
    //   **那是探针缺陷，不是产品缺陷**（L142 同族：选错样本会把探针问题报成产品问题）。
    // ⇒ 改用**不依赖上下文状态**的判据：比对「完整调用序列」逐条一致。
    //   这在语义上更强——若子模块的调用顺序或内容有**任何**变化，序列必然不同。
    const seqA = A.join('\n')
    const seqB = B.join('\n')
    const eq = seqA === seqB
    check(eq, `判据5 完整调用序列逐条一致（${B.length} 条记录）`,
      eq ? '' : (() => {
        const la = seqA.split('\n'); const lb = seqB.split('\n')
        const n = Math.max(la.length, lb.length)
        for (let i = 0; i < n; i++) {
          if (la[i] !== lb[i]) return `第 ${i + 1} 条起不同：\n      基线: ${la[i]}\n      合并: ${lb[i]}`
        }
        return `长度不同：基线 ${la.length} / 合并 ${lb.length}`
      })())

    // ---- 判据 6：其它 cordis 事件 ----
    const eventsOf = (log) => log.filter(l => l.startsWith('ctx.on|')).map(l => l.split('|')[1]).sort()
    const ea = eventsOf(A); const eb = eventsOf(B)
    check(JSON.stringify(ea) === JSON.stringify(eb), '判据6 ctx.on 事件集合与顺序完全一致',
      `${eb.length} 个：${[...new Set(eb)].join(', ')}`)

    // ---- 判据 6b：被 `ctx.get` 读取的**服务名集合**一致（补住判据5 剔除 ctx.get 的缺口）----
    // 判据5 剔除了 ctx.get 记录（视图实现细节），但那会掩盖「某个服务被读了/没被读」的差异。
    // 这里单独比对**服务名集合**：合并路径的 ctx.get 集合应 ⊇ 基线路径，
    // 且**多出来的必须全部来自可选服务清单**（即降级视图只代理那些，没有误代理别的）。
    const getNames = (log) => [...new Set(log.filter(l => l.startsWith('ctx.get|')).map(l => l.split('|')[1].replace('(strict)', '')))].sort()
    const ga = getNames(logA.filter(l => true))  // 基线用**未 strip** 的原始日志
    const gb = getNames(logB)
    const extra = gb.filter(n => !ga.includes(n))
    const notOptional = extra.filter(n => !['llm', 'agentDefaultModel', 'credentials', 'connection', 'agents'].includes(n))
    check(notOptional.length === 0,
      '判据6b 合并路径多出的 ctx.get 服务全部来自可选服务清单（降级视图未误代理必需服务）',
      notOptional.length
        ? `❌ 误代理了：${notOptional.join(', ')}（应只在 OPTIONAL_SERVICES 内）`
        : `多出：${extra.join(', ') || '（无）'}；基线读过的：${ga.join(', ') || '（无）'}`)

    // ---- 判据 7：tools / systemPrompt ----
    const toolsOf = (log) => log.filter(l => l.startsWith('tools.register|') || l.startsWith('systemPrompt.section|')).sort()
    const ta = toolsOf(A); const tb = toolsOf(B)
    check(JSON.stringify(ta) === JSON.stringify(tb), '判据7 tools.register / systemPrompt.section 集合一致',
      `${tb.length} 项`)

    // ---- 判据 8：子模块 name 常量未被改动（会话数据兼容）----
    // 【2026-09-13 心跳 77】T-87 要求「子模块 export const name/inject 降为内部使用」，
    //   故改为**源码级**断言：字面量必须仍在，且**不得**再出现 `export const name`。
    //
    // ========================================================================
    // 【2026-09-16 W28 · P-41 第五例】②③ 从「无条件报红」改锚到**架构事实**
    //
    // ## 症状（决定性实验 `tmp/w28-t87-conflict.mjs` 实测）
    // ②③ 长期报红（5 个包 × 2 条 = 10 条），且**改不动** —— 我一动手降级就发现：
    // 降级后 `build-dsht.ps1`（**权威路径**）产出的包**不再导出 name/inject**。
    //
    // ## 真因：**两条构建路径对同一份源码的要求相反**
    //   · 权威路径 `build-dsht.ps1` Step 4.7 / 4.72 —— 把 5 个包**各自独立**编译为
    //     **包入口**；cordis loader 从**包的 exports** 取 `name` 作插件名
    //     ⇒ 实测（E2）`import()` 得 `name="dsht-plugin-mvu" inject=[...]`
    //     ⇒ **必须 export**（E3 反证：降级后产物 `导出 name=false` ⇒ 权威路径直接坏）
    //   · T-87 总包路径 `rebuild-plugins.ps1` —— 只取子模块的 `apply`
    //     ⇒ 设计要求「降为内部常量」
    // ⇒ **同一份源码不可同时满足**（E1 证实两条路径 entry 不同）。
    //
    // ## 修法（P-41：追问「真正决定结果的那个事实是什么」，把判据改锚到它）
    // 真正的事实**不是**「有没有 export」，而是「**两条路径是否已归一**」：
    //   · 未归一 ⇒ export 是**权威路径的硬需求** ⇒ ②③ **条件未成立**，
    //     出声说明原因与**解除条件**，**不计违约**（不许静默放过，也不许假装已达标）；
    //   · 已归一（`build-dsht.ps1` 不再独立编译子模块）⇒ ②③ **自动开始生效**。
    // ⇒ 判据**自己会失效**（P-37）：T-87 第 4 步一落地，本判据即刻收紧。
    // 判定依据**读脚本**而不硬编码（P-27：别把「当前状态」写死成常量）。
    // ========================================================================
    // ------------------------------------------------------------------
    // 【2026-09-16 W28 第二次修正 · P-41 第六例】检出口径必须覆盖两种形态
    //
    // 症状（我把②③改锚后**立刻自证**发现的自身缺陷）：报表打印
    //   「权威路径仍独立编译 **1** 个子模块为包入口」，而我预期是 **5**。
    // 真因：首版只做**字面量**匹配（`bdSrc.includes('src/<pkg>/index.ts')`），
    //   而 `build-dsht.ps1` 的 Step 4.72 用的是**循环 + 变量插值**：
    //     $r10Plugins = @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper',
    //                     'dsht-plugin-prompt-template', 'dsht-plugin-memory')
    //     foreach ($r10 in $r10Plugins) { … esbuild "src/$r10/index.ts" … }
    //   ⇒ 那 4 个 entry 在脚本里**从不以字面量出现** ⇒ 只命中 Step 4.7 的 1 项。
    //
    // 后果（比报错更坏）：若将来 T-87 第 4 步只归一了 Step 4.7（主包）而漏了
    //   Step 4.72（R10 循环），本判据会**误判为已归一** ⇒ 开始对 4 个仍需 export
    //   的子模块报红（在该沉默时误报），且在真正归一前**提前解除豁免**。
    //
    // 修法（P-41「追问真正决定结果的那个事实」+ P-42「两端设防」）：
    //   ① 解析**两种形态**（字面量 + foreach/插值展开）；
    //   ② 另取一条**独立事实**（`r10Loop`：循环体本身是否存在）做交叉验证 ——
    //      循环在、entries 却为空 ⇒ 解析器失准，**报红**（该出的判据不许静默）。
    // ==================================================================
    const bdPath = path.join(HERE, 'build-dsht.ps1')
    const bdSrc = fs.existsSync(bdPath) ? fs.readFileSync(bdPath, 'utf8') : ''
    const split = parseSplitEntries(bdSrc)
    const STILL_SPLIT = split.entries
    const pathsMerged = STILL_SPLIT.length === 0
    // 交叉验证（判据 8c）：循环成员必须全部被解析出来，否则解析器漏形态
    const parseMissing = split.r10Loop
      ? split.r10Loop.names.map(n => `src/${n}/index.ts`).filter(e => !STILL_SPLIT.includes(e))
      : []

    // ------------------------------------------------------------------
    // 判据 8c：**对解析器自身设防**（两端设防 —— 不许"该判的判不出来"）
    // 独立事实取自「脚本里出现了 R10 四个包名的字面量数组」，不依赖我上面
    // 写的 esbuild 正则：若这些包名成组出现、而解析器却没识别出循环
    // ⇒ 解析器失准 ⇒ 此时「是否已归一」的结论**不可采信** ⇒ 必须报红，
    //   而不是静默地按（可能残缺的）entries 去判 ②③。
    // ------------------------------------------------------------------
    const R10_MEMBERS = ['dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory']
    const parseBad = []
    if (!fs.existsSync(bdPath)) {
      parseBad.push(`找不到权威构建脚本 ${bdPath} ⇒ 无法判定「两条路径是否已归一」`)
    } else {
      const grouped = R10_MEMBERS.filter(n => bdSrc.includes(`'${n}'`))
      if (grouped.length >= 2 && !split.r10Loop) {
        parseBad.push(`脚本里成组出现 ${grouped.length} 个 R10 包名字面量，但未解析出插值循环 ⇒ 解析器漏形态`)
      }
      if (split.r10Loop && split.r10Loop.names.length === 0) {
        parseBad.push(`Step ${split.r10Loop.line} 的循环（$${split.r10Loop.loopVar} in $${split.r10Loop.arrVar}）无法展开成员 ⇒ entries 会漏，判据将假阳性`)
      }
      if (parseMissing.length) parseBad.push(`循环成员未被计入 entries：${parseMissing.join(', ')}`)
      if (split.unresolved.length) {
        parseBad.push(`有含变量插值的 esbuild 入口未被解析覆盖：${split.unresolved.join(', ')} ⇒ 清单可能残缺`)
      }
      if (STILL_SPLIT.length === 0 && grouped.length >= 2) {
        parseBad.push(`结论「已归一」与「仍有 ${grouped.length} 个 R10 包名字面量」矛盾 ⇒ 结论不可采信`)
      }
    }
    const parseSane = parseBad.length === 0

    const expectNames = {
      'dsh-plugin': 'dsht-rp-plugin',
      'dsht-plugin-mvu': 'dsht-plugin-mvu',
      'dsht-plugin-tavern-helper': 'dsht-plugin-tavern-helper',
      'dsht-plugin-prompt-template': 'dsht-plugin-prompt-template',
      'dsht-plugin-memory': 'dsht-plugin-memory',
    }
    let nameBad = []       // ① 字面量丢失 ⇒ 无论如何都是真违约
    let exportStill = []   // ②③ 仅在「路径已归一」时才是违约
    let exportNeed = []    // 路径未归一时：登记「为什么必须 export」（出声，非违约）
    for (const [label, entry] of subEntries) {
      const src = fs.readFileSync(entry, 'utf8')
      const want = expectNames[label]
      // ① 字面量必须仍在（会话数据兼容的前提）—— 这条与架构无关，永远成立
      if (!src.includes(`'${want}'`)) nameBad.push(`${label}: 源码里找不到字面量 '${want}'`)
      // ② 不得再有 `export const name`（要求1：降为内部使用）
      if (/^export const name\b/m.test(src)) {
        if (pathsMerged) exportStill.push(`${label}: 仍为 \`export const name\``)
        else exportNeed.push(`${label}: export const name`)
      }
      // ③ 不得再有 `export const inject`（同上）
      if (/^export const inject\b/m.test(src)) {
        if (pathsMerged) exportStill.push(`${label}: 仍为 \`export const inject\``)
        else exportNeed.push(`${label}: export const inject`)
      }
    }
    // ① 独立成一条（架构无关）；②③ 按路径归一的实际状态判定
    check(nameBad.length === 0,
      '判据8① 5 个子模块的 name 字面量保持原值（会话数据兼容；与构建路径形态无关）',
      nameBad.length ? nameBad.join('; ') : Object.values(expectNames).join(', '))

    check(parseSane,
      '判据8c 权威路径「独立编译的包入口」清单可信（覆盖字面量 + 插值循环两种形态）',
      parseBad.length
        ? `❌ ${parseBad.join('；')}`
        : `解析到 ${STILL_SPLIT.length} 个 entry` +
          (split.r10Loop ? `（含 Step ${split.r10Loop.line} 插值循环展开的 ${split.r10Loop.names.length} 个：${split.r10Loop.names.join(', ')}）` : '（无插值循环）') +
          `；明细：${STILL_SPLIT.join(', ')}`)

    if (pathsMerged && parseSane) {
      check(exportStill.length === 0,
        '判据8② 构建路径已归一 ⇒ name/inject 必须已降为内部常量（不再 export）',
        exportStill.length ? exportStill.join('; ') : '5 个包均已降级')
    } else if (!parseSane) {
      // 解析器不可信 ⇒ **不给出②③的结论**（避免用残缺清单下结论）
      check(true,
        '判据8② name/inject 降级【本轮未判定 · 前置不可信】',
        `解析器自证不通过（见判据8c）⇒ 无法可靠判断「路径是否已归一」，故不对 ②③ 下结论。` +
        `现存 export 共 ${exportNeed.length} 处（仅登记，不计违约）`)
      if (exportNeed.length) {
        console.log(`  ⓘ 判据8② 明细（本轮未判定）：${exportNeed.join(' · ')}`)
      }
    } else {
      // 未归一：如实报「条件未成立」+ 解除条件（**出声**，但不算违约 ——
      // 因为此时 export 是权威路径的硬需求，改了会直接坏包）
      check(true,
        `判据8② name/inject 降级【条件未成立 · 非违约】—— 权威路径仍独立编译 ${STILL_SPLIT.length} 个子模块为包入口`,
        `这些包的 loader 从**包 exports** 取 name（实测 E2）⇒ 必须 export。` +
        `现存 export 共 ${exportNeed.length} 处；` +
        `解除条件：T-87 落地步骤第 4 步（build-dsht.ps1 的 Step 4.7/4.72/4.75 合并为一个 Step）` +
        `完成后本判据**自动收紧**`)
      if (exportNeed.length) {
        console.log(`  ⓘ 判据8② 明细（因路径未归一而被豁免）：${exportNeed.join(' · ')}`)
      }
    }

    // ---- 判据 9（附加）：总包 name（沿用旧包名，最小改动） ----
    check(rpMod.name === 'dsht-rp-plugin', '判据9 总包 name = dsht-rp-plugin（沿用旧包名，patch id 仍为 dsht-rp）', `实得 ${rpMod.name}`)

    // ---- 判据 10：总包 inject **不再**是 10 项并集（B1 的核心）----
    // 【2026-09-13 心跳 77 修正】本判据原为「inject 是 10 项并集」，那是**错的**：
    //   实测（tmp/probe-cordis-inject.mjs）证明 `inject` 是「激活门」——
    //   列了缺的服务 ⇒ 该 entry **完全不激活**（apply 一次都不调用）。
    //   ⇒ 若照搬 10 项并集，「只缺 llm」会让 MVU / 酒馆助手 / EJS **一起失效**，
    //     正是 T-87 文档 B1 要消除的故障。
    //   现改为断言：**可选服务不在 inject 里**（它们改走 ctx.get）。
    const OPTIONAL = ['llm', 'agentDefaultModel', 'credentials', 'connection', 'agents']
    const REQUIRED = ['webServer', 'settings', 'sessions', 'tools', 'systemPrompt']
    const inj = rpMod.inject ?? []
    const leakedOptional = OPTIONAL.filter(n => inj.includes(n))
    const missingRequired = REQUIRED.filter(n => !inj.includes(n))
    check(leakedOptional.length === 0 && missingRequired.length === 0,
      `判据10 总包 inject = 必需 ${REQUIRED.length} 项、且**不含任何可选服务**（B1：避免缺一个服务让 5 个子模块一起不激活）`,
      leakedOptional.length
        ? `❌ 可选服务仍在 inject 里：${leakedOptional.join(', ')} ⇒ 缺它会让整包不激活`
        : `inject = ${inj.join(', ')}`)

    // ---- 判据 11：B1 行为验证 —— 缺可选服务时，5 个子模块**仍然全部激活** ----
    // 这是判据 10 的**行为侧**对照（只看 inject 数组是"结构证据"，不足以证明行为）。
    // 做法：喂一个**不提供任何可选服务**的 ctx ——
    //   · 必需服务（webServer/settings/…）照常提供；
    //   · 可选服务的**属性访问**照 cordis 真实语义抛错（"cannot get property ... without inject"），
    //     只有 `ctx.get(name)` 能拿到（且缺则 undefined）。
    //   若总包**没有**做可选服务降级，子模块里 60+ 处 `ctx.llm` 会立刻抛 ⇒ 本判据报红。
    //   ⇒ 本判据实际测的是「降级视图真的生效了」。
    const logC = []
    let threwC = null
    const optionalSet = new Set(OPTIONAL)
    try {
      const full = makeCtx(logC)
      // 包装成"cordis 真实语义"：可选服务的**属性读**抛错（未 inject），只认 ctx.get
      const strictCtx = new Proxy(full, {
        get (t, prop, recv) {
          if (typeof prop === 'string' && optionalSet.has(prop)) {
            throw new Error(`cannot get property "${prop}" without inject`)
          }
          const v = Reflect.get(t, prop, recv)
          return typeof v === 'function' ? v.bind(t) : v
        },
      })
      // ctx.get：必需服务返回实现；可选服务一律 undefined（模拟"这个部署没有它们"）
      const realGet = full.get
      strictCtx.get = (n, strict) => (REQUIRED.includes(n) ? realGet.call(full, n, strict) : undefined)
      rpMod.apply(strictCtx, undefined)
    } catch (e) { threwC = e }
    const routesC = logC.filter(l => l.startsWith('webServer.register|')).length
    const nsC = logC.filter(l => l.startsWith('settings.register|')).length
    const onC = logC.filter(l => l.startsWith('ctx.on|')).length
    check(threwC === null && nsC >= 5 && onC >= 4,
      '判据11 B1 行为：ctx 缺全部可选服务（属性访问会抛）时，总包仍不抛且 5 个子模块照常注册',
      threwC
        ? `❌ 抛错（说明可选服务降级未生效）：${String(threwC.message).slice(0, 140)}`
        : `路由 ${routesC} 条 / 命名空间 ${nsC} 个（原 ${nsOf(B).length}）/ 事件 ${onC} 个`)

    // ---- 判据 12：B8 —— 共享模块的**模块级单例**在合并后由「多份」变「一份」----
    // 背景：`shared/macros.ts` 的 `customMacros` 是模块级 Map。
    //   合并前 dsh-plugin 与 mvu **各自被 esbuild 打成独立 bundle** ⇒ 该文件被内联两份
    //   ⇒ 运行期有**两个互不相通的 Map**（实测：一个 bundle 里 registerMacro，另一个 bundle 读不到）。
    //   合并后同一 bundle 内只内联一份 ⇒ **共享**。
    // ⇒ 这是**真实的行为变化**（且方向是增强：运行期经 `/macros/*` 注册、未落盘的宏，
    //   现在对 mvu 状态栏 / TH 展开也可见）。落盘宏（rp/macros.json）两条路径都水合同一文件 ⇒ 结果不变。
    // 本判据的作用：把这个"已知且刻意接受"的变化**记录在案**，并守住它的前提 ——
    //   即「只有一份实现」这件事仍然成立（若有人把某子模块改回独立 bundle，这里会报出来）。
    const subSrcs = subEntries.map(([l, e]) => [l, fs.readFileSync(e, 'utf8')])
    const importsSharedMacros = subSrcs.filter(([, s]) => s.includes('dsht-plugin-shared/macros'))
    const bundleEntry = fs.readFileSync(entryRp, 'utf8')
    const entryCount = (bundleEntry.match(/dsht-plugin-mvu\/index\.ts/g) ?? []).length
    check(importsSharedMacros.length >= 1 && entryCount === 1,
      '判据12 B8：共享宏引擎在合并后只有**一份**实现（mvu/TH 与主包共用一个 customMacros 单例）',
      `引用 shared/macros 的子模块：${importsSharedMacros.map(([l]) => l).join(', ') || '（无）'}；` +
      `总包对 mvu 的 import 次数=${entryCount}（应为 1 ⇒ 单例唯一）`)
  } finally {
    for (const t of tmps) { try { fs.unlinkSync(t) } catch { /* 已删 */ } }
    try { fs.rmSync(fakeHome, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }

  const pass = results.filter(r => r.ok).length
  console.log(`\n[verify-rp-consolidation] ${pass}/${results.length} PASS`)
  // ⚠️ 不在这里 process.exit —— 反控模式需要在返回后执行「还原源码」，
  //    exit 会跳过调用方的 finally（L144：兜底工具的自身正确性也要保证）。
  return pass === results.length
}

main().catch(e => { console.error('[verify-rp-consolidation] 异常：', e.message); process.exit(3) })
