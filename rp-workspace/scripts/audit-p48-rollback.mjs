#!/usr/bin/env node
/**
 * audit-p48-rollback.mjs —— **P-48 的常驻护栏**（判据装置自身的失败路径必须与它保护的副作用对齐）
 * =============================================================================
 * ## 守什么（一句话）
 * 凡**会改变外部状态**的判据装置（改设备全局设置 / 写用户数据），必须**能在任何中止路径上回滚**
 * 它自己造成的副作用。违反 ⇒ 报红。
 *
 * ## 为什么必须常驻（P-11 元级）
 * P-48 是 **W36 续**从一次真实事故里提炼的（M7 的 fail-closed 断言 `throw` **跳过了收尾还原**
 * ⇒ 设备上残留 10 个 `.efjbak`、5 张卡会话停在旅程态）。但 W36/W37 的发现**完全靠人工穷举**：
 *   · W36 只把 P-48 落在 M7（`ef-journey-all.mjs`）一处；
 *   · W37 按 P-38 三段式穷举，抓到第二处 `ef-font-scale.mjs`（**改设备全局字号**）；
 *   · **W38** 再穷举一次，又抓到**第三处 `ef-orientation.mjs`**（**改设备全局自动旋转**）。
 * ⇒ 三次穷举、三次都还在漏 —— 这正是本仓最忌讳的形态：**声明为判据、实质靠人记得**
 *   （P-11；W26 的 A14、W32 的判据 ④ 都栽在这里）。⇒ 必须有机器守着。
 *
 * ## 为什么「设备全局设置」这一类最该先守（P-37② 量后果）
 * 两类副作用的**可恢复性不同**：
 *   · 用户会话数据（M7）：写坏了还有 `.efjbak` 备份可人工还原（且有 M7 自己的负控盯着）；
 *   · 设备全局设置（本闸门覆盖）：**没有任何备份**。探针中止后，用户的系统字号 / 自动旋转
 *     停在探针改过的档位，**用户看得到、却不知道该改回什么值**（原值只存在于那次已结束的进程里）。
 * ⇒ 同一族里，**不可恢复的那一类先守**。
 *
 * ## 判据（静态，扫 `scripts/**` 下所有会写设备设置的 `.mjs`）
 * 四项**能力**必须齐备（缺一报红；含义见 P-48 三条纪律）：
 *   ① **还原函数**存在，且**幂等**（体内有「已改标记 + 已还原标记」的早退 `return`）；
 *   ② **中止路径兜底**：`exit` / `uncaughtException` / `unhandledRejection` / 信号（`SIGINT`|`SIGTERM`）
 *      **四类各自**都注册了处理器，且**每个处理器体内都调用了还原函数**（只注册不接线 = 假兜底）；
 *   ③ **自证**：还原函数体内**读回校验**（`get*()`）**且成功也出声**（`console.log`）
 *      —— 否则「兜底真的跑了」与「压根没改过」输出完全相同（W37 首版负控暴露的缺口）；
 *   ④ **写入口唯一**：不允许在还原函数与包装函数之外出现裸的 `settings put`（P-1：同一语义一处）。
 *
 * ### 为什么判「能力」而不是判「接线」（P-24 的边界说明）
 * 「中止后设备真的回到原值」是**结果**，只能在**真跑**里观测 —— 那由配套的真实仓库负控
 * （`audit-p48-negctl.mjs`，注入异常后读设备）与设备实测负责。本闸门负责**静态**那一半：
 * 「**写型装置有没有那几项能力**」。两者合起来才构成完整判据（同 P-47 闸门 + 其负控的分工）。
 *
 * ## 诚实边界（R7）
 *   ① 本闸门**只覆盖「改设备全局设置」这一类**（识别面：`adb shell settings put|delete`）。
 *      另一类「写用户会话数据」（M7）**尚无常驻闸门** —— 它的失效形态是「残留备份」（**可人工恢复**），
 *      目前由 M7 自己的紧急还原钩子 + 一轮一跑的负控守着。**该缺口已登记**（见 GOAL §11.3），
 *      不在这里用过一个「过宽」的判据去假守（P-38：过宽 ⇒ 假红 ⇒ 训练人忽略报警）。
 *   ② 本闸门是**静态结构**判据，不证明「兜底在真实中止路径上一定跑得到」—— 后者由负控与设备实测负责。
 *
 * ## 退出码
 *   0 = 通过    1 = 检出违规（fail-closed）    2 = selftest 失败
 *
 * 用法：
 *   node scripts/audit-p48-rollback.mjs --selftest
 *   node scripts/audit-p48-rollback.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = path.join(WS, 'scripts')

/**
 * 豁免名单（每项都要写理由）。
 * 负控脚本（`*-negctl.mjs`）**天然**把「修前形态」当**注入载荷**携带，因而必然命中本闸门的受检面，
 * 但它自己**不写设备设置** —— 不豁免会把负控装置报成违规（**假红**，P-38）。
 */
const EXEMPT = new Set([
  'audit-p48-rollback.mjs',   // 本闸门自己：判据定义里当然含全部关键词
  'audit-p48-negctl.mjs',     // 本闸门的真实仓库负控：载荷即「修前形态」
])

/** 受检面：出现 `'settings', 'put'` / `'settings', 'delete'`（= 会改设备全局设置） */
const WRITES_SETTING_RE = /['"]settings['"]\s*,\s*['"](put|delete)['"]/

/**
 * ★ **口径必须收窄到「真的发起了这个 RPC」**（P-38 过宽形态 · 首版当场被真实仓库证伪）。
 * 首版只判「行内含路由名」⇒ 报出 **1 处假红**：`audit-impl-duplication.mjs` 把一个
 * **合成夹具**写进字符串字面量（`mk('dsh-plugin', 'index.ts', \`if (sub === '/rp/session-rollback') …\`)`）
 * —— 那是**构造测试样本**，**不执行**回退。
 * **语义不变量**（P-38 第一条：按语义枚举手法，不是按 API 名）应该是
 * 「**这一行真的向该路由发起了请求**」⇒ 判据 = 含路由名 **且** 含请求发起动词。
 * 真实形态实测（三处，逐个取证过）：M7 的 `await post('dsht-rp', 'rp/session-rollback', …)`、
 * `b2-live-rollback-test.mjs` 的 `await fetch('/dsht-rp/rp/session-rollback', {`、
 * `ef-rollback-live.mjs` 的 `await post('dsht-rp', 'rp/session-rollback', { … })`。
 */
const ROLLBACK_RPC_RE = /rp\/session-(rollback|edit|regenerate)/
const REQUEST_VERB_RE = /\b(fetch|post|postJson|call|request|rpApi)\s*\(/

/** 判定：该脚本是否**真的执行**回退类 RPC（排除注释行与「只把路由名当字符串夹具」的写法） */
export function executesRollbackRpc (src) {
  return src.split('\n').some(l =>
    !/^\s*(\/\/|\*|\/\*)/.test(l) && ROLLBACK_RPC_RE.test(l) && REQUEST_VERB_RE.test(l))
}

/** P-48 第二类要求的证据（三项，缺一报红） */
export function checkP48SessionWrite (src) {
  const missing = []
  /**
   * ★ **两项能力可以「自己实现」或「复用单源」**（P-38 过宽形态 · 首版当场被真实仓库证伪）。
   * 首版要求每个脚本**自己**有 `bakSuffix` + `cp` + `function restoreXxx` ⇒
   * 把**合规的复用写法**（`import { makeSessionGuard } from './session-guard.mjs'`）判成违规
   * （**假红**）。而按 **P-1**，把「备份 → 停应用 → 还原 → 校验」抽成单源**正是正确做法**
   * （两份逐字拷贝反而会被 `audit-impl-duplication.mjs` 判据 7 报红）。
   * ⇒ 判据的**语义不变量**是「**这个装置具备备份与还原能力**」，不是「这些代码写在它自己文件里」。
   */
  const usesGuard = /from\s+['"]\.\/session-guard\.mjs['"]/.test(src)
  // ① 备份：备份后缀 + `cp`（「先备份」这一步真的做了）
  const hasBakSuffix = /(bak[Ss]uffix|\.efjbak|\.bak['"]|BAK_SUFFIX)/.test(src)
  const hasCp = /['"]cp['"]|\bcp\s+\S/.test(src)
  if (!(usesGuard || (hasBakSuffix && hasCp))) {
    missing.push('备份（须有备份后缀常量 + `cp` 调用，或 import 单源 `session-guard.mjs` —— R18：改动设备数据前必须先备份）')
  }
  // ② 还原 + 校验（幂等还原函数，且体内读回/大小校验）
  // ★ **必须同时认两种函数形态**（P-41 推论四：解析器漏形态会让结论**反向**）：
  //   本仓两种真实形态都存在 —— `ef-journey-all.mjs` 是**箭头函数**赋值
  //   （`const restoreSession = (dir, …) => { … }`），`ef-font-scale.mjs` 是**函数声明**
  //   （`function restoreFontScale (reason) { … }`）。首版只认后者 ⇒ 正控 2（真实 M7 形态）
  //   被判「缺还原函数」（**假红**），由 selftest 当场证伪。
  const rm = /\bfunction\s+(\w*[Rr]estore\w*)\s*\(/.exec(src)
    ?? /\b(?:const|let|var)\s+(\w*[Rr]estore\w*)\s*=\s*(?:async\s*)?\(/.exec(src)
  if (!usesGuard && !rm) {
    missing.push('还原函数（`function restoreXxx()`、`const restoreXxx = (…) =>`，或 import 单源 `session-guard.mjs`）—— 备份之后必须有可被调用的还原路径')
  } else if (!usesGuard) {
    const body = fnBodyOf(src, rm[1]) ?? ''
    if (!/(stat|getFontScale|verify|existsSync|wc -c|jsonl)/.test(body)) {
      missing.push('还原后校验（还原函数体内要比对大小/存在性 —— 否则「还原了」与「没写坏」不可分）')
    }
  }
  // ③ 中止路径兜底：`process.on(...)` 注册 **或** 注入式紧急还原钩子（两种真实形态都认）
  const hasHook = /process\.on\s*\(/.test(src) || /\bonFatalRestore\b/.test(src)
    || (usesGuard && /\.install\s*\(/.test(src))
  if (!hasHook) {
    missing.push('中止路径兜底（`process.on(exit|SIGINT|SIGTERM|uncaughtException|unhandledRejection, …)`、'
      + '注入式紧急还原钩子 `onFatalRestore`，或单源守护的 `.install()` —— 异常路径不会走到脚本末尾）')
  }
  return { ok: missing.length === 0, missing, viaGuard: usesGuard }
}

/** P-48 要求的四类中止路径 */
const ABORT_PATHS = [
  { label: 'exit', re: /['"]exit['"]/ },
  { label: 'uncaughtException', re: /['"]uncaughtException['"]/ },
  { label: 'unhandledRejection', re: /['"]unhandledRejection['"]/ },
  // ★【判据自身的坑（P-41 推论四）· 首版当场被 selftest 正控证伪】
  //   信号类最常见的**真实**写法是「遍历数组」：`for (const sig of ['SIGINT','SIGTERM']) process.on(sig, …)`
  //   —— 实参是**变量** `sig`，事件名字面量**不在** `process.on(...)` 的文本里。
  //   首版只做字面量匹配 ⇒ 正控被判「未注册」（假红）。这与 P-41 推论四（Step 4.72 的
  //   `foreach + 变量插值` 让解析器漏 4 项）是**同一个坑**；修法同：把**紧邻上文**纳入判定文本。
  { label: '信号（SIGINT|SIGTERM）', re: /['"]SIG(INT|TERM)['"]/, contextLookback: 240 },
]

/**
 * 从 `openIdx`（指向 `{`）起，按**花括号配平**取出块体（含首尾花括号）。
 * 跳过字符串 / 模板串 / 行注释 / 块注释里的花括号 —— 否则脚本里的中文注释与模板串
 * 会把配平打断（W29 踩过同族的坑：函数体范围用非贪婪正则圈会停在**另一个函数**上）。
 */
export function extractBalanced (src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i += 1
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1 }
      continue
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 1; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return src.slice(openIdx)
}

/** 取 `<name>` 的函数体（含首尾花括号）；找不到返回 null
 *
 * ★ 认**两种真实形态**（P-41 推论四）：`function name (…) { … }` 与
 *   `const name = (…) => { … }`。本仓两者都有（见 checkP48SessionWrite 的注）。
 */
export function fnBodyOf (src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`)
  let m = re.exec(src)
  if (!m) m = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`).exec(src)
  if (!m) return null
  const afterParams = src.indexOf(')', m.index + m[0].length - 1)
  const from = afterParams < 0 ? m.index + m[0].length : afterParams + 1
  const open = src.indexOf('{', from)
  if (open < 0) return null
  return extractBalanced(src, open)
}

/** 取 `process.on(` 注册的**处理器体**（从 `process.on(` 起按圆括号配平） */
function handlerBodyAt (src, idx) {
  const open = src.indexOf('(', idx)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i += 1
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1 }
      continue
    }
    if (c === '(') depth += 1
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}

/**
 * 收集脚本里所有**具名函数声明**及其体（用于判据 ④ 的**调用关系**口径）。
 * 只认 `function name(...) { ... }`（本仓写型装置的实际形态）——
 * 箭头函数赋值形态尚未出现；**若将来出现，本函数会漏收**，故判据 ④ 在「无调用者」时
 * 仍会报红（散落写点），不会静默放过（fail-closed 落在**结果**上，P-24）。
 */
export function collectFunctions (src) {
  const out = []
  const re = /\bfunction\s+(\w+)\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const afterParams = src.indexOf(')', m.index + m[0].length - 1)
    const from = afterParams < 0 ? m.index + m[0].length : afterParams + 1
    const open = src.indexOf('{', from)
    if (open < 0) continue
    out.push({ name: m[1], body: extractBalanced(src, open) })
  }
  return out
}

/**
 * 检查一个脚本是否满足 P-48（四项能力齐全）。
 * @returns {{ ok: boolean, missing: string[], restore: string|null }}
 */
export function checkP48 (src) {
  const missing = []
  // ① 还原函数存在
  const rm = /\bfunction\s+(\w*[Rr]estore\w*)\s*\(/.exec(src)
  if (!rm) {
    return { ok: false, missing: ['还原函数（`function restoreXxx()`）—— 写型装置必须有可被中止路径调用的回滚钩子'], restore: null }
  }
  const restoreName = rm[1]
  const body = fnBodyOf(src, restoreName) ?? ''

  // ①-b 幂等：体内有「已改标记 + 已还原标记」的早退 return
  const idempotent = body.split('\n').some(l => /return/.test(l) && /[Dd]irtied/.test(l) && /[Rr]estored/.test(l))
  if (!idempotent) {
    missing.push('幂等（体内需要「已改标记 + 已还原标记」的早退 return —— 否则多个中止路径会重复还原，P-46 推论二）')
  }

  // ③ 自证：体内读回校验 + 成功也出声
  const hasReadback = /\bget\w*\s*\(/.test(body)
  // ★【判据自身的坑 · 首版当场被负控 3 证伪】首版写成 `console\.(log|error)` ⇒
  //   只保留**失败分支**的 `console.error` 也让判据认为「已出声」，而 P-48 纪律③ 要的恰恰是
  //   **成功也要出声**（「兜底真的跑了」与「压根没改过」的唯一区分手段）⇒ 必须只认 `console.log`。
  const hasLoudSuccess = /console\.log\s*\(/.test(body)
  if (!hasReadback) missing.push('读回校验（还原函数体内要 `get*()` 读回比对原值）')
  if (!hasLoudSuccess) missing.push('成功也出声（还原函数体内要有 console.log —— 否则「兜底跑了」与「没改过」不可分）')

  // ② 中止路径兜底：四类各自注册，且每个处理器体内都调用还原函数
  for (const p of ABORT_PATHS) {
    let found = false
    let idx = src.indexOf('process.on(')
    while (idx >= 0) {
      const hb = handlerBodyAt(src, idx)
      // `contextLookback`：把紧邻上文一并纳入判定文本（覆盖「遍历数组注册信号」的写法 —— 见 ABORT_PATHS 注）
      const look = p.contextLookback ? src.slice(Math.max(0, idx - p.contextLookback), idx) : ''
      if (p.re.test(look + hb) && new RegExp(`\\b${restoreName}\\s*\\(`).test(look + hb)) { found = true; break }
      idx = src.indexOf('process.on(', idx + 1)
    }
    if (!found) missing.push(`中止路径兜底：${p.label}（该路径未注册，或处理器体内**没有**调用 ${restoreName}()）`)
  }

  // ④ 「写盘」与「登记」不得分开（P-48 纪律②/P-1）：中间留窗口就等于留缺陷。
  //
  // 【判据自身的坑（P-38 过宽形态）· 首版当场被 selftest 正控证伪】
  //   首版要求「**每个**裸写点的紧邻上两行有 dirty 登记」⇒ 把**低层写入原语**也报红了：
  //   真实形态是两层 —— 原语 `setFontScale(v)`（只负责写）、包装 `setFontScaleTracked(v)`
  //   （先登记再调原语）。原语体内当然没有登记，但它**唯一的调用路径**经过包装 ⇒ 合规。
  //   ⇒ 收窄为**调用关系**口径（不是文本邻接口径）：见下。
  const fns = collectFunctions(src)
  const nakedWriters = fns.filter(f => WRITES_SETTING_RE.test(f.body)).map(f => f.name)
  const dirtyFn = new Set(fns.filter(f => /[Dd]irtied\s*=\s*true/.test(f.body)).map(f => f.name))
  for (const w of nakedWriters) {
    if (w === restoreName) continue                       // 还原函数体内的写回 = 回滚动作本身，合法
    if (dirtyFn.has(w)) continue                          // 登记与写在同一函数体内 —— 最直接的合规形态
    // 否则：所有调用点必须落在「还原函数体内」或「含 dirty 登记的函数体内」
    const callers = fns.filter(f => f.name !== w && new RegExp(`\\b${w}\\s*\\(`).test(f.body)).map(f => f.name)
    const safe = callers.length > 0 && callers.every(c => c === restoreName || dirtyFn.has(c))
    if (!safe) {
      missing.push(`写入口未登记（\`${w}\` 直接写设备设置，却既没有同体登记 dirty、也没有'先登记再调用'的包装——P-1：中间留窗口就等于留缺陷`
        + `${callers.length ? `；调用者：${callers.join(' / ')}` : '；全脚本无调用者，属散落写点'}）`)
    }
  }

  return { ok: missing.length === 0, missing, restore: restoreName }
}

/** 递归扫 `scripts/`（含子目录），返回受检脚本清单 */
export function scanRepo (root = SCRIPTS) {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'tmp' || e.name === 'node_modules') continue
        walk(p)
      } else if (e.name.endsWith('.mjs')) out.push(p)
    }
  }
  walk(root)
  const violations = []
  let checked = 0
  let checkedSession = 0
  for (const p of out) {
    const f = path.basename(p)
    if (EXEMPT.has(f) || /-negctl\.mjs$/.test(f)) continue
    const src = fs.readFileSync(p, 'utf8')
    const rel = path.relative(root, p).replace(/\\/g, '/')
    // 第一受检面：改**设备全局设置**
    if (WRITES_SETTING_RE.test(src)) {
      checked += 1
      const r = checkP48(src)
      if (!r.ok) violations.push({ file: rel, kind: '设备设置', missing: r.missing })
    }
    // 第二受检面（W39）：执行**回退类 RPC** ⇒ 会不可逆地改用户会话数据
    if (executesRollbackRpc(src)) {
      checkedSession += 1
      const r = checkP48SessionWrite(src)
      if (!r.ok) violations.push({ file: rel, kind: '用户会话数据', missing: r.missing })
    }
  }
  return { checked, checkedSession, violations, scanned: out.length }
}

// ---------------------------------------------------------------------------
// selftest（正控 / 负控 / **杠杆** / 零控）
//   为什么必须有：扫源码的静态闸门**失效时输出与通过完全相同**（P-30 —— 真实仓库「0 命中」是 0 信息量）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let total = 0, fail = 0
  const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

  // ---- 正控 1：四项齐全的写法（取自 `ef-font-scale.mjs` 的真实形态）⇒ 通过 ----
  const good = `
const ORIGINAL = getFontScale()
let fontScaleDirtied = false
let fontScaleRestored = false
function setFontScaleTracked (v) {
  fontScaleDirtied = true
  setFontScale(v)
}
function restoreFontScale (reason) {
  if (!fontScaleDirtied || fontScaleRestored) return { ok: true, skipped: true }
  try {
    setFontScale(ORIGINAL)
    const back = getFontScale()
    fontScaleRestored = true
    const ok = back === ORIGINAL
    if (ok) console.log('[夹具安全] font_scale 已还原 → ' + back + '（触发路径：' + reason + '）')
    else console.error('[夹具安全][FATAL] 还原后读回 ' + back)
    return { ok, skipped: false }
  } catch (e) { console.error('[FATAL] 还原失败'); return { ok: false } }
}
process.on('exit', () => { restoreFontScale('exit') })
for (const sig of ['SIGINT', 'SIGTERM']) { process.on(sig, () => { restoreFontScale(sig); process.exit(130) }) }
process.on('uncaughtException', (e) => { restoreFontScale('uncaughtException'); process.exit(1) })
process.on('unhandledRejection', (e) => { restoreFontScale('unhandledRejection'); process.exit(1) })
function setFontScale (v) { execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'font_scale', String(v)]) }
function getFontScale () { return execFileSync(ADB, ['shell', 'settings', 'get', 'system', 'font_scale']) }
`
  const rGood = checkP48(good)
  t('正控1：四项齐全 ⇒ 通过', rGood.ok, rGood.missing.join(' / '))

  // ---- 负控 1：**修前**的真实形态（有还原函数，但只在末尾调用；无任何 process.on）⇒ 必须报红 ----
  //     这正是 `ef-orientation.mjs` 在 W37 穷举后仍漏网时的样子。
  const legacy = `
const ORIG_ACCEL = getSetting('accelerometer_rotation')
function rotate (rot) {
  execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'])
  execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'user_rotation', String(rot)])
}
function restoreAutoRotate () {
  try { execFileSync(ADB, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1']) } catch { }
}
`
  const r1 = checkP48(legacy)
  t('负控1：修前形态（无中止兜底 + 还原写死常量）⇒ 报红且四类兜底全缺',
    !r1.ok && r1.missing.filter(m => /中止路径兜底/.test(m)).length === 4,
    `missing=${r1.missing.length} 兜底缺=${r1.missing.filter(m => /中止路径/.test(m)).length}`)

  // ---- 负控 2：注册了处理器但**体内没接线**（只打印不还原）⇒ 必须报红（假兜底）----
  //     这一条是本闸门最关键的区分力：`process.on('exit', ...)` 出现 ≠ 兜底成立。
  const fakeHook = good
    .replace("restoreFontScale('exit')", "console.log('bye')")
    .replace("restoreFontScale('uncaughtException')", "console.log('boom')")
  const r2 = checkP48(fakeHook)
  t('负控2：注册了处理器但体内未调用还原函数 ⇒ 报红（假兜底）',
    !r2.ok && /exit/.test(r2.missing.join(' ')), JSON.stringify(r2.missing.slice(0, 3)))

  // ---- 负控 3：去掉「成功也出声」⇒ 必须报红（只缺自证那一项）----
  const quiet = good.replace("if (ok) console.log('[夹具安全] font_scale 已还原 → ' + back + '（触发路径：' + reason + '）')", '')
  const r3 = checkP48(quiet)
  t('负控3：还原成功不出声 ⇒ 报红（缺「成功也出声」）', !r3.ok && /成功也出声/.test(r3.missing.join(' ')), JSON.stringify(r3.missing))

  // ---- ★ 杠杆（P-20）：**只补**回那一句 ⇒ 负控 3 必须**转绿** ----
  // 若闸门恒红/恒绿，这一对不可能一红一绿。
  t('杠杆：仅补回「成功也出声」一句 ⇒ 负控3 转绿', checkP48(good).ok, checkP48(good).missing.join(' / '))

  // ---- 零控：与设备设置无关的脚本 ⇒ 不受检（不误报）----
  t('零控：不写设备设置的脚本 ⇒ 不受检', WRITES_SETTING_RE.test("const x = document.querySelectorAll('div').length") === false)

  // ==========================================================================
  // 第二类（W39）：执行**回退类 RPC** 的装置 —— 改了用户会话数据就必须有备份/还原/兜底
  // ==========================================================================
  // ---- 正控 2：三项齐全（取自 M7 `ef-journey-all.mjs` 的真实形态）⇒ 通过 ----
  const goodSession = `
const bakSuffix = '.efjbak'
const r1 = runAs('cp', \`\${a}/session.jsonl\`, \`\${a}/session.jsonl\${bakSuffix}\`)
if (ok) deferRestore(sid, dir, bakSuffix, backedMain, backedV3)
const restoreSession = (dir, suffix, main, v3) => {
  const src = Number(String(runAs('stat', '-c', '%s', \`\${a}/\${name}\${suffix}\`)).trim())
  const dst = Number(String(runAs('stat', '-c', '%s', \`\${a}/\${name}\`)).trim())
  if (src !== dst) { ok = false }
  return { ok }
}
const bail = (msg) => { if (typeof onFatalRestore === 'function') { onFatalRestore() } throw new Error(msg) }
await post('dsht-rp', 'rp/session-rollback', { sessionId: sid, keepThroughSeq: keep })
`
  const rsGood = checkP48SessionWrite(goodSession)
  t('正控2：备份 + 还原校验 + 紧急还原钩子齐备 ⇒ 通过', rsGood.ok, rsGood.missing.join(' / '))

  // ---- 负控 4：**修前**的真实形态（直接回退、零备份、零兜底）⇒ 必须报红且三项都缺 ----
  //     这正是 `ef-rollback-live.mjs` / `b2-live-rollback-test.mjs` 在本轮被穷举抓到时的样子。
  const legacySession = `
const SID = flag('--sid', '')
const YES = argv.includes('--yes')
const rb = await post('dsht-rp', 'rp/session-rollback', { sessionId: sid, keepThroughSeq: keep })
const out = await evalJs('(async () => { const r = await fetch("/dsht-rp/rp/session-rollback", { method: "POST" })
  return { status: r.status } })()')
`
  const rs4 = checkP48SessionWrite(legacySession)
  t('负控4：修前形态（真回退但零备份/零还原/零兜底）⇒ 报红且三项都缺',
    !rs4.ok && rs4.missing.length === 3, `missing=${rs4.missing.length}`)

  // ---- ★ 杠杆（P-20）：**只补**上备份 + 还原 + 钩子 ⇒ 负控 4 必须**转绿** ----
  // 若判据恒红/恒绿，这一对不可能一红一绿。
  const leverSession = goodSession   // 同一段合规写法
  t('杠杆2：改用齐备写法 ⇒ 必须转绿', checkP48SessionWrite(leverSession).ok, checkP48SessionWrite(leverSession).missing.join(' / '))

  // ---- 零控 2：**注释里引用**路由名 ⇒ 不得受检（P-38 过宽形态的真实样本）----
  //     本仓 `audit-impl-duplication.mjs` / `audit-method-binding.mjs` 的注释里都引用了该路由名。
  t('零控2：仅在注释里引用路由名 ⇒ 不受检（防假红）',
    executesRollbackRpc('// 注释说明：/rp/session-rollback 与 /rp/session-regenerate 的语义差别') === false)

  // ---- 正控 3（**复用单源**形态）：import `session-guard.mjs` + `.install()` ⇒ 通过 ----
  // ★ 这一条是**必须**的：真实仓库修完后正是这个形态（`ef-rollback-live.mjs` /
  //   `b2-live-rollback-test.mjs` 都改为 import 单源）。首版判据**不认**复用 ⇒ 报 2 处假红
  //   （P-38 过宽形态：把「合规的复用」当成「没有这项能力」）。按 P-1，抽单源**正是正确做法**。
  const reused = `
import { makeSessionGuard } from './session-guard.mjs'
const guard = makeSessionGuard({ adb: ADB, pkg: PKG, sid: SID, yes: YES })
guard.install()
if (!guard.backup()) { console.error('拒绝执行'); process.exit(2) }
const rb = await post('dsht-rp', 'rp/session-rollback', { sessionId: sid, keepThroughSeq: keep })
const rr = guard.restore('normal')
`
  const rs3 = checkP48SessionWrite(reused)
  t('正控3：import 单源守护（复用形态）⇒ 通过（防 P-38 过宽假红）', rs3.ok, rs3.missing.join(' / '))

  // ---- 负控 5：**声称 import 单源却从不调用**（只 import 不接线）⇒ 必须报红 ----
  //     与负控 2（假兜底）同族：静态可见「有守护」≠ 它真被用上。
  const fakeReuse = `
import { makeSessionGuard } from './session-guard.mjs'
const rb = await post('dsht-rp', 'rp/session-rollback', { sessionId: sid, keepThroughSeq: keep })
`
  const rs5 = checkP48SessionWrite(fakeReuse)
  t('负控5：import 了单源但从不 `.install()`/`backup()` ⇒ 报红',
    !rs5.ok && /中止路径兜底/.test(rs5.missing.join(' ')), JSON.stringify(rs5.missing))

  // ---- 真实仓库：受检面与违规（**动态**输出，不硬编码）----
  const repo = scanRepo()
  t('真实仓库：受检脚本 ≥2（否则本闸门可能已扫空 = 零信息量）', repo.checked >= 2, `checked=${repo.checked} scanned=${repo.scanned}`)
  t('真实仓库（第二类）：受检 ≥1（回退类 RPC 装置）', repo.checkedSession >= 1, `checkedSession=${repo.checkedSession}`)
  t('真实仓库：0 违规', repo.violations.length === 0,
    repo.violations.length ? repo.violations.map(v => `${v.file}[${v.kind}] 缺: ${v.missing.join('、')}`).join(' ｜ ') : `受检 ${repo.checked} + ${repo.checkedSession} 个脚本`)

  console.log(fail === 0 ? `\n[P48 selftest] ${total}/${total} PASS` : `\n[P48 selftest] ${fail} FAIL / ${total}`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
  reportSelftest('p48-rollback', total - fail, total)
  process.exit(fail === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const r = scanRepo()
console.log(`[P48] 扫 ${r.scanned} 个 scripts/**/*.mjs ⇒ 受检 ${r.checked} 个「改**设备全局设置**」 + ${r.checkedSession} 个「执行**回退类 RPC**（改用户会话数据）」（豁免 ${EXEMPT.size} 个）`)
if (r.violations.length === 0) {
  console.log('[P48] OK —— 受检装置均有可被中止路径调用的回滚兜底 + 读回自证')
  process.exit(0)
}
for (const v of r.violations) {
  console.log(`[P48] ✗ ${v.file}（${v.kind}）`)
  for (const m of v.missing) console.log(`        ↳ 缺：${m}`)
}
console.log(`\n[P48] 共 ${r.violations.length} 个装置违反 P-48（判据装置自身的失败路径必须与它保护的副作用对齐）`)
process.exit(1)
