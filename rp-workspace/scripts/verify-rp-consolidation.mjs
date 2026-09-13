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

async function main () {
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
    // 精确交换两行的 label 与 apply（保持语法合法）
    const swapped = orig
      .replace("  { label: 'dsht-plugin-prompt-template', apply: applyPromptTemplate as (ctx: never, config: unknown) => void },\n  { label: 'dsht-plugin-memory', apply: applyMemory as (ctx: never, config: unknown) => void },",
        "  { label: 'dsht-plugin-memory', apply: applyMemory as (ctx: never, config: unknown) => void },\n  { label: 'dsht-plugin-prompt-template', apply: applyPromptTemplate as (ctx: never, config: unknown) => void },")
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
    // 【2026-09-13 心跳 77 修正】T-87 要求「子模块 export const name/inject 降为内部使用」，
    //   故**不能再 import mod.name**（已不再导出）。改为**源码级**断言：
    //   在子模块源文件里必须仍存在该字面量（`plugin: name` / `src.plugin === name` 依赖它），
    //   且**不得**再出现 `export const name`（那说明降级没做到位）。
    const expectNames = {
      'dsh-plugin': 'dsht-rp-plugin',
      'dsht-plugin-mvu': 'dsht-plugin-mvu',
      'dsht-plugin-tavern-helper': 'dsht-plugin-tavern-helper',
      'dsht-plugin-prompt-template': 'dsht-plugin-prompt-template',
      'dsht-plugin-memory': 'dsht-plugin-memory',
    }
    let nameBad = []
    for (const [label, entry] of subEntries) {
      const src = fs.readFileSync(entry, 'utf8')
      const want = expectNames[label]
      // ① 字面量必须仍在（会话数据兼容的前提）
      if (!src.includes(`'${want}'`)) nameBad.push(`${label}: 源码里找不到字面量 '${want}'`)
      // ② 不得再有 `export const name`（要求1：降为内部使用）
      if (/^export const name\b/m.test(src)) nameBad.push(`${label}: 仍为 \`export const name\`（应降为内部常量）`)
      // ③ 不得再有 `export const inject`（同上）
      if (/^export const inject\b/m.test(src)) nameBad.push(`${label}: 仍为 \`export const inject\`（应降为内部常量）`)
    }
    check(nameBad.length === 0,
      '判据8 子模块 name 字面量保持原值、且 name/inject 已降为内部使用（不再 export）',
      nameBad.length ? nameBad.join('; ') : Object.values(expectNames).join(', '))

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
