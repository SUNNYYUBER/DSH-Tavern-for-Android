#!/usr/bin/env node
/**
 * audit-th-face-coverage.mjs — 【W3 · 2026-09-15】真 TH 裸全局面**覆盖面**闸门
 * ============================================================================
 * ## 守什么（一句话）
 * 真 TH 在脚本 iframe 的 window 上提供的**每一个**名字，在我方 shim 里都必须
 * **要么已挂、要么明确拒绝** —— **不许静默缺席**。
 *
 * ## 为什么需要它（本轮根因，见 docs/L5-BARE-GLOBAL-TH-API-GAP.md W3 补充节）
 * 真 TH 的裸全局机制（`JS-Slash-Runner/src/iframe/predefine.js:11-19`）把**父页
 * TavernHelper 对象的全部键**合并进脚本 iframe 的 window ⇒ 真 TH 的裸全局面
 * = TavernHelper 成员集，是**有限、可枚举**的（有官方 `@types` 为证）。
 * 我方 shim 是**手写静态清单**，两边一旦不同步，就会出现「真 TH 有、我方 undefined」
 * 的名字 —— 而脚本几乎总写 `typeof X !== 'undefined'` 守卫
 * ⇒ **静默走 else 分支、我方零感知**（症状 =「这张卡的功能没反应」，面板里什么都没有）。
 *
 * 本轮实测：真 TH 面 144 项，我方**缺 27 项**（其中 25 项经产物键名证实为真缺口）。
 * 这条闸门就是防它**再次**悄悄变大。
 *
 * ## 判据（落在「结果」，不落在机制 —— P-24）
 * 不在源码里找 `window.X = `（那是机制），而是**真跑 buildShimSource**、
 * 枚举沙箱 window，再与面清单比对（结果）。
 *
 * 三类合法状态（缺一即报红）：
 *   a) `TH_BARE_GLOBAL_FACE` 里的名字已在沙箱 window 上（真实现）
 *   b) 在 `TH_UNSUPPORTED_APIS` 里（函数 stub：记名拒绝）——须验证**确实挂上了且 typeof 为 function**
 *   c) 在 `TH_FACE_VALUE_NAMES` 里（值/同步型：getter 出声、typeof 仍 undefined）
 *     ——须验证**读取不抛 + 返回 undefined + 触发出声**
 *
 * ## 为什么不用「清单比对清单」（一个易犯的错）
 * 只用两个清单做集合运算**不构成产品事实**：清单写了不代表真的挂到 window 上。
 * 本闸门**必须**真跑 shim（P-24）。清单只提供「应该有哪些」。
 *
 * 用法：
 *   node scripts/audit-th-face-coverage.mjs            # 主判据
 *   node scripts/audit-th-face-coverage.mjs --selftest # 自证（正控 + 负控 + 零控）
 * 退出码：0 = 全部覆盖；1 = 有静默缺口；2 = 装置失败（面清单缺失/路径错，fail-closed）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const require$ = createRequire(import.meta.url)

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SUPPORT = resolve(ROOT, 'packages/src/dsht-plugin-shared/th-api-support.ts')

/**
 * esbuild 装在 `packages/` 下（不在 `scripts/` 的解析链上）。
 * 与 `audit-body-dup-ast.mjs` 同法：按候选路径探测 + `createRequire`（不引入新依赖）。
 */
function loadEsbuild() {
  const cands = [
    resolve(ROOT, 'packages', 'node_modules', 'esbuild', 'lib', 'main.js'),
    resolve(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
  ]
  for (const c of cands) {
    try { return require$(c) } catch { /* 试下一个 */ }
  }
  return null
}

/**
 * 面清单的**权威来源**：真 TH 的 `@types/function/*.d.ts`（仓库外副本）。
 * 环境变量 `TH_ROOT` 指向 JS-Slash-Runner 目录；**不在时 fail-closed**
 * （不许静默跳过 —— 否则闸门会随时间悄悄变成「永远绿」）。
 */
const TH_ROOT = process.env.TH_ROOT ?? ''

// ---------------------------------------------------------------------------
// 清单读取（我方源码抽数；与实现同源，判据不另写）
// ---------------------------------------------------------------------------
/** 从 TS 源码里抽 `export const NAME = [ 'a', 'b' ]` 的字符串元素 */
export function arrayLiteralAfter(text, name) {
  const m = new RegExp('\\b' + name + '\\b[^=]*=\\s*\\[').exec(text)
  if (!m) throw new Error(`未找到清单「${name}」（锚点缺失 ⇒ fail-closed，不许静默放行）`)
  const open = m.index + m[0].length - 1
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) return [...text.slice(open + 1, i).matchAll(/'([^']+)'/g)].map((x) => x[1])
    }
  }
  throw new Error(`清单「${name}」括号不配平`)
}

/**
 * 面清单：从**源码常量**读（`th-api-support.ts` 的 TH_FACE_VALUE_NAMES 是唯一权威的
 * 「我方会挂什么」来源之一）+ 从源码导出面读。
 *
 * ⚠️ 这里刻意**不**内置一份「真 TH 面」的副本：那是真 TH 的属性，不是我方的常量。
 * 真 TH 面由 `--face <file>` 提供（生成自 @types），或由 TH_ROOT 现算。
 */
export function allOurNames(src) {
  const unsupported = arrayLiteralAfter(src, 'TH_UNSUPPORTED_APIS')
  const valueNames = arrayLiteralAfter(src, 'TH_FACE_VALUE_NAMES')
  return { unsupported, valueNames }
}

// ---------------------------------------------------------------------------
// 真跑 shim（唯一可信的「实际挂载面」判据 —— P-24）
// ---------------------------------------------------------------------------
/**
 * @param {string} shimSource
 * @returns {{ onWindow: Set<string>, sandbox: Record<string, unknown> }}
 */
export function runShim(shimSource) {
  const sandbox = {
    console: { warn: () => {}, error: () => {}, log: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: { body: { childElementCount: 0 }, head: {}, addEventListener: () => {}, querySelectorAll: () => [] },
    addEventListener: () => {},
    location: { href: 'about:blank', reload: () => {} },
    navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Object,
    Promise,
    JSON,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    Error,
    RegExp,
    Map,
    Set,
    Symbol,
    Function,
    TypeError,
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  sandbox.parent = { postMessage: () => {}, document: { querySelectorAll: () => [] } }
  sandbox.name = 'probe'
  // 用 Function 构造器执行（与 iframe 内经典脚本语义一致；shim 自身是 IIFE 严格模式隔离）
  // ⚠️ 这里刻意**不**用 vm：本项目要跑在 node 上，Function 构造器无额外依赖且行为等价。
  const fn = new Function('window', 'self', 'globalThis', 'parent', 'document', 'console', 'setTimeout',
    'clearTimeout', 'addEventListener', 'location', 'navigator', 'localStorage', 'sessionStorage',
    shimSource)
  fn(sandbox, sandbox, sandbox, sandbox.parent, sandbox.document, sandbox.console, sandbox.setTimeout,
    sandbox.clearTimeout, sandbox.addEventListener, sandbox.location, sandbox.navigator,
    sandbox.localStorage, sandbox.sessionStorage)
  // 【判据自身的坑（P-19，被本闸门**当场自报**抓到）】首版用 `Object.keys(sandbox)` 当
  // 「已挂面」—— 而 `Object.defineProperty(..., { get })` 定义的属性**默认不可枚举**，
  // 于是 13 个值型 getter 全部被误判成「未挂」 ⇒ 报出 13 项**假** badValue。
  // 正确口径：**属性可访问性**（`in` / `getOwnPropertyNames`），不是可枚举性。
  // 这个差别正是「值型走 getter」这一设计的直接后果 —— 判据必须与实现形态对齐。
  return { onWindow: new Set(Object.getOwnPropertyNames(sandbox)), sandbox }
}

// ---------------------------------------------------------------------------
// 主判据
// ---------------------------------------------------------------------------
/**
 * @param {string} shimSource 真跑用的 shim 源码
 * @param {string[]} face 真 TH 裸全局面（应提供的全部名字）
 * @param {{unsupported: string[], valueNames: string[]}} ours 我方两个拒绝清单
 * @returns {{ silent: string[], badStub: string[], badValue: string[], ok: number }}
 */
export function checkCoverage(shimSource, face, ours) {
  const { onWindow, sandbox } = runShim(shimSource)
  const unstub = new Set(ours.unsupported)
  const val = new Set(ours.valueNames)
  const silent = []
  const badStub = []
  const badValue = []
  let ok = 0
  for (const name of face) {
    const mounted = onWindow.has(name)
    if (mounted) {
      // 已挂 ⇒ 必须符合它所属类别（这是防「挂错形态」的那一半判据）
      if (val.has(name)) {
        // 值/同步型走 getter：typeof 必须是 'undefined'，否则脚本守卫会拿到非 undefined
        let t = null
        let threw = false
        try { t = typeof sandbox[name] } catch { threw = true }
        if (threw || t !== 'undefined') badValue.push(`${name}（期望 typeof undefined，实得 ${threw ? '抛错' : t}）`)
        else ok++
      } else {
        ok++
      }
      continue
    }
    if (unstub.has(name) || val.has(name)) {
      // 声明了要拒绝/出声，却没挂上 ⇒ 装置或实现缺陷（不是静默缺口，但也是 bug）
      (unstub.has(name) ? badStub : badValue).push(`${name}（在拒绝清单里但**未挂到 window**）`)
      continue
    }
    silent.push(name)
  }
  return { silent, badStub, badValue, ok, onWindow }
}

// ---------------------------------------------------------------------------
// 自证（P-30：静态/结构判据必须自带合成正控 + 负控）
// ---------------------------------------------------------------------------
function selftest() {
  const MINI = `(function () {
  var unsupported = ['stubApi'];
  for (var i = 0; i < unsupported.length; i++) { window[unsupported[i]] = function () { return Promise.reject(new Error('x')) }; }
  window.realApi = function () { return 1 };
  window.otherApi = 2;
  Object.defineProperty(window, 'valueName', { configurable: true, get: function () { return undefined } });
})()`
  const ours = { unsupported: ['stubApi'], valueNames: ['valueName'] }
  let pass = 0
  let total = 0
  const t = (label, got, want) => {
    total++
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (ok) pass++
    console.log(`${ok ? ' PASS' : ' FAIL'}  ${label}${ok ? '' : `  → 期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`}`)
  }

  // 正控1：面里的名字全部已挂 ⇒ 零缺口
  let r = checkCoverage(MINI, ['realApi', 'otherApi', 'stubApi', 'valueName'], ours)
  t('正控1 全部覆盖 ⇒ 零静默缺口', r.silent, [])

  // 正控2：面里有一个**谁都没管**的名字 ⇒ 必须报出来（这是本闸门存在的理由）
  r = checkCoverage(MINI, ['realApi', 'ghostApi'], ours)
  t('正控2 未挂且未拒绝 ⇒ 报静默缺口', r.silent, ['ghostApi'])

  // 正控3：声明拒绝却没挂上 ⇒ 报装置缺陷（不得当成「已覆盖」）
  r = checkCoverage(MINI, ['notMountedStub'], { unsupported: ['notMountedStub'], valueNames: [] })
  t('正控3 声明拒绝但未挂 ⇒ 报 badStub', r.badStub.length, 1)

  // 正控4：值型名字被误挂成**函数**（最危险形态：守卫会通过）⇒ 必须报
  const MIS_MOUNTED = `(function () { window.valueName = function () { return 1 }; })()`
  r = checkCoverage(MIS_MOUNTED, ['valueName'], { unsupported: [], valueNames: ['valueName'] })
  t('正控4 值型被误挂成函数 ⇒ 报 badValue', r.badValue.length, 1)

  // 负控1：面里全是已挂名字 ⇒ silent 必须为空（防「恒报」）
  r = checkCoverage(MINI, ['realApi'], ours)
  t('负控1 空缺口 ⇒ silent 为空', r.silent, [])

  // 负控2：面为空 ⇒ 什么都别报（零控）
  r = checkCoverage(MINI, [], ours)
  t('负控2 面为空 ⇒ 零报告', [r.silent.length, r.badStub.length, r.badValue.length], [0, 0, 0])

  // 负控3：**函数型** stub 已挂 ⇒ 不得被算成 badValue（分类不串）
  r = checkCoverage(MINI, ['stubApi'], ours)
  t('负控3 函数型 stub 不算 badValue', r.badValue, [])

  // 锚点缺失必须 fail-closed（P-11：闸门不许随代码演进悄悄失效）
  let threw = false
  try { arrayLiteralAfter('export const A = 1', 'A') } catch { threw = true }
  t('边界 锚点缺失 ⇒ 抛错（fail-closed）', threw, true)

  // 断言条数**动态计数**（不写魔法数字 —— 首版写死 9 而实际 8 条 ⇒ 自证自报 FAIL，
  // 又是「判据自身的实现假设」的一次实例，正是 P-29 的形态）。
  console.log(`[selftest] ${pass === total ? 'PASS' : 'FAIL'}（${pass}/${total}）`)
  // ★ W44：统一自证输出契约（**必须在本函数内** —— `--selftest` 分支会早退）
  reportSelftest('th-face', pass, total)
  return pass === total ? 0 : 1
}

// ---------------------------------------------------------------------------
/**
 * 基准面清单的获取（两级，守 GOAL.md B8「仓库外副本不作主仓依赖」）：
 *   ① **默认**：仓库内快照 `scripts/data/th-bare-global-face.json`
 *      （生成自真 TH 官方 @types + 产物键名核实；随仓库走，CI/无副本机器都能跑）
 *   ② `$env:TH_ROOT` 存在时：**以现场为准**，并与快照**对账**（有差异即出声，
 *      提示快照过期 —— 真 TH 升级后新增的名字会立刻在闸门里报红）
 * 两级都拿不到 ⇒ exit 2（fail-closed；不许静默变绿）。
 */
const SNAPSHOT = resolve(HERE, 'data/th-bare-global-face.json')

function loadFace() {
  let snapshot = null
  try {
    const j = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
    if (Array.isArray(j.names) && j.names.length > 50) snapshot = j.names
  } catch { /* 快照缺失在下面出声 */ }

  let live = null
  if (TH_ROOT !== '') {
    try { live = readThFaceFromTypes(TH_ROOT) } catch (e) {
      console.error(`[face] ⚠️ TH_ROOT 现场算面失败（${String(e.message).slice(0, 120)}）—— 改用快照`)
    }
  }

  if (live && snapshot) {
    const a = new Set(live)
    const b = new Set(snapshot)
    const onlyLive = live.filter((n) => !b.has(n))
    const onlySnap = snapshot.filter((n) => !a.has(n))
    if (onlyLive.length || onlySnap.length) {
      console.log(`[face] ⚠️ 现场面与快照**不一致**（现场 ${live.length} / 快照 ${snapshot.length}）——`
        + ' 快照可能过期，建议刷新 `node rp-workspace/scripts/gen-th-face-snapshot.mjs`（需 $env:TH_ROOT）')
      if (onlyLive.length) console.log(`[face]    仅现场有（新 API）：${onlyLive.join(', ')}`)
      if (onlySnap.length) console.log(`[face]    仅快照有（可能已移除）：${onlySnap.join(', ')}`)
    }
    return live // 现场为准
  }
  if (live) return live
  if (snapshot) return snapshot
  console.error(`[face] FATAL 基准面不可得（快照 ${SNAPSHOT} 缺失，且 TH_ROOT 未设或算面失败）`)
  console.error('       **不静默跳过**（P-11：闸门不许悄悄变成永远绿）。属配置问题，exit 2。')
  process.exit(2)
}

// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) process.exit(selftest())

  const src = readFileSync(SUPPORT, 'utf8')
  const ours = allOurNames(src)
  if (ours.unsupported.length < 20 || ours.valueNames.length < 5) {
    console.error(`[face] FATAL 我方清单解析结果异常（stub ${ours.unsupported.length} / 值型 ${ours.valueNames.length}）`
      + ' —— 疑似解析口径失效，拒绝给出结论')
    process.exit(2)
  }

  const face = loadFace()

  // 真跑 shim：把 TS 源码转成可执行 JS（用 esbuild，与构建同一工具链）
  const shimPath = resolve(ROOT, 'packages/src/dsht-rp-ui/src/client/th-shim.ts')
  const esbuild = loadEsbuild()
  if (!esbuild) {
    console.error('[face] FATAL 找不到 esbuild（真跑 shim 需要它）—— 拒绝给出结论（fail-closed）')
    process.exit(2)
  }
  const out = esbuild.buildSync({
    entryPoints: [shimPath], bundle: true, format: 'cjs', write: false,
    platform: 'node', target: 'node20', external: ['react', 'react-dom'],
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require$)
  const shimSource = mod.exports.buildShimSource({ scriptId: 'probe', scriptName: 'probe', secret: 's', version: 'audit' })

  const r = checkCoverage(shimSource, face, ours)
  console.log(`[face] 真 TH 裸全局面 ${face.length} 项 · 我方 window 属性 ${r.onWindow.size} 个`)
  console.log(`[face] 已覆盖 ${r.ok} 项`)
  // ★ W58：**读数行**（守 P-50 单源契约 + P-60）—— 为什么加它：
  //   `README.md` 「能做什么」表原写「**73 个 API（32 本地 + 41 桥接）**」、Tier 2 原写「**71 项**记名 stub」，
  //   而实测 **本地 34 + 桥接 41 = 75**、记名拒绝 **81 项** ⇒ 三个数**全部过期**（**P-27**），
  //   且它们**从未被任何机器核过**（本闸门只做「名字是否已实现或已拒绝」的面比对，**不断言条数**）。
  //   ⇒ 与 W57 同形（**P-60 会增长的读数不得写成硬常量**）：把条数变成**可机器读的读数**。
  {
    // ★★ **锚点必须落在「名单字面量真正所在的那个文件」上**（W58 实测的坑，**P-45**）：
    //   首版对 `shimSource`（= `buildShimSource()` 生成的**运行期源码**）抽 `SHIM_LOCAL_APIS` ⇒
    //   该字面量**不在运行期源码里** ⇒ `arrayLiteralAfter` **fail-closed 抛错**（闸门直接崩）。
    //   ⇒ 名单的权威来源是**源文件** `packages/src/dsht-rp-ui/src/client/th-shim.ts`。
    const SHIM_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..',
      'packages', 'src', 'dsht-rp-ui', 'src', 'client', 'th-shim.ts')
    let localN = null, bridgeN = null
    if (existsSync(SHIM_SRC)) {
      const src = readFileSync(SHIM_SRC, 'utf8')
      localN = arrayLiteralAfter(src, 'SHIM_LOCAL_APIS').length
      bridgeN = arrayLiteralAfter(src, 'SHIM_BRIDGE_APIS').length
    }
    console.log(`[TH 面读数] local=${localN} bridge=${bridgeN} `
      + `total=${localN !== null && bridgeN !== null ? localN + bridgeN : '?'} unsupported=${ours.unsupported.length}`)
  }
  if (r.silent.length) {
    console.log(`[face] ❌ **静默缺口** ${r.silent.length} 项（真 TH 有、我方既没实现也没拒绝）——`
      + ' 脚本的 typeof 守卫会静默走 else：')
    for (const n of r.silent) console.log(`     · ${n}`)
  }
  if (r.badStub.length) {
    console.log(`[face] ❌ 声明拒绝但未挂上 ${r.badStub.length} 项：`)
    for (const n of r.badStub) console.log(`     · ${n}`)
  }
  if (r.badValue.length) {
    console.log(`[face] ❌ 值/同步型形态不符 ${r.badValue.length} 项（挂了但 typeof 不是 undefined ⇒ 会改脚本行为）：`)
    for (const n of r.badValue) console.log(`     · ${n}`)
  }
  const bad = r.silent.length + r.badStub.length + r.badValue.length
  if (bad === 0) console.log('[face] ✅ 真 TH 面上的每个名字：已实现 或 已明确拒绝（无静默缺席）')
  process.exit(bad === 0 ? 0 : 1)
}

/**
 * 从真 TH 的 @types 现算面清单，并逐个到**产物**核实行时键（对象键 / `_bind` 键 /
 * function 形态 / 赋值形态）。
 *
 * ## 为什么必须做产物核实（本轮的一次真实教训）
 * `.d.ts` 是**声明面**，与实现可能漂移。实测：`updatelorebookEntriesWith`（小写 l）与
 * `placeholder_prompt_default_order` 只在声明里出现，产物里**没有任何运行时键** ——
 * 它们不是缺口（真 TH 运行时也不提供），若不加核实就会报出 2 项**永久无法收敛**的假缺口
 * （P-17：区分「事实是否定」与「我们测不出来」）。真缺口的判据必须是
 * 「真 TH **产物**里存在」∧「我方 window 上不存在」。
 */
function readThFaceFromTypes(thRoot) {
  const dir = join(thRoot, '@types', 'function')
  const idx = readFileSync(join(dir, 'index.d.ts'), 'utf8')
  const members = [...idx.matchAll(/^\s*readonly\s+([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1])
  const bare = new Set()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.d.ts'))) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const m of text.matchAll(/^\s*declare\s+(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) bare.add(m[1])
  }
  const union = [...new Set([...members, ...bare])].sort()
  // 产物核实（缺产物 ⇒ 退回声明面并**出声**，不静默换口径）
  const distPath = join(thRoot, 'dist', 'index.js')
  let dist = null
  try { dist = readFileSync(distPath, 'utf8') } catch { /* 出声在下面 */ }
  if (dist === null) {
    console.error(`[face] ⚠️ 产物不可达（${distPath}）—— 本次按**声明面**判定，`
      + '可能含「只在 .d.ts、运行时不存在」的名字（会报假缺口）')
    return union
  }
  const hasRuntimeKey = (n) => {
    const esc = n.replace(/\$/g, '\\$')
    return new RegExp('(?<![\\w$])' + esc + '\\s*:').test(dist)
      || new RegExp('_' + esc + '\\s*:').test(dist)
      || new RegExp('function\\s+' + esc + '\\s*\\(').test(dist)
      || new RegExp('(?<![\\w$.])' + esc + '\\s*=').test(dist)
  }
  const dropped = union.filter((n) => !hasRuntimeKey(n))
  if (dropped.length) {
    console.log(`[face] 声明面剔除 ${dropped.length} 项（产物无运行时键，非真缺口）：${dropped.join(', ')}`)
  }
  return union.filter(hasRuntimeKey)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
