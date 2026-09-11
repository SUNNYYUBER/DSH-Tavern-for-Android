#!/usr/bin/env node
/**
 * audit-method-binding.mjs —— 「官方方法引用提取必须绑定接收者」静态审计
 * ============================================================================
 * 为什么需要这条闸门（2026-09-11 心跳 55 实机缺陷）：
 *   官方 `Session` 的方法都是「实例字段 + this」实现
 *     `dsh-session/lib/index.js:457   this.log = log`        （构造器）
 *     `dsh-session/lib/index.js:1075  this.log.push(...)`    （append 内）
 *   所以 `const f = live.append; f(...)` 这种**方法引用提取**会把 `this` 变成
 *   `undefined` → `TypeError: Cannot read properties of undefined (reading 'log')`。
 *
 *   心跳 47 的「纯类型层收窄」重构（提交 `801d47d`）为了绕开 TS2722/TS18048，
 *   把两处 `live.append(...)` 改写成 `const liveAppend = live.append` + `liveAppend(...)`，
 *   注释写着「运行时语义不变」——**实际是语义变更**：`/rp/session-rollback` 与
 *   `/rp/session-regenerate` 两条 live 路径整段 500 且零事件写入，直到心跳 55 才被抓出。
 *
 * 判据（保守，只报高危成员名，不试图做类型推断）：
 *   语句形如 `const X = <recv>.<member>`（右侧**没有调用括号**、没有 `.bind(...)`），
 *   且 `<member>` 属于 OFFICIAL_BOUND_MEMBERS（官方/宿主侧 this 依赖方法）。
 *   —— 注意 `const f = obj.m.bind(obj)` 与 `boundAppend(obj)` 都**不会**被报。
 *
 * 用法：
 *   node scripts/audit-method-binding.mjs              # 审计（退出码 0 = 无违约）
 *   node scripts/audit-method-binding.mjs -v           # 列出全部候选提取（含放行的）
 *   node scripts/audit-method-binding.mjs --selftest   # 正控/负控自检（退出码 3 = 自检失败）
 *   node scripts/audit-method-binding.mjs --verify-lib # 顺带核对官方库里这些方法是否仍读 this.
 * ============================================================================
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dirname, '..', '..')            // D:/DSH RolePlay
const WS = join(ROOT, 'rp-workspace')
const SRC = join(WS, 'packages', 'src')
const SESSION_LIB = join(WS, 'dsh-runtime-android', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')

/**
 * this 依赖的官方/宿主方法名 → 证据来源。
 * 只放**有据可查**的（其余一律不报，宁缺勿滥 —— 见 L44：枚举器自己先过正控）。
 */
const OFFICIAL_BOUND_MEMBERS = new Map([
  ['append', 'dsh-session Session.append → this.log.push（lib/index.js:1075）'],
  ['flush', '会话注册表 ctx.sessions.flush(session) —— 也读 this（我方 flushLiveSession 用 .call 绑定）'],
  ['eventAt', 'dsh-session Session.eventAt → this.log（lib/index.js:1097）'],
  ['snapshotEvents', 'dsh-session Session.snapshotEvents → this.log'],
  ['snapshotRange', 'dsh-session Session.snapshotRange → this.log'],
  ['emit', 'EventEmitter 语义 → this._events'],
  ['on', 'EventEmitter 语义 → this._events'],
  ['once', 'EventEmitter 语义 → this._events'],
  ['off', 'EventEmitter 语义 → this._events'],
  ['removeListener', 'EventEmitter 语义 → this._events'],
  ['removeAllListeners', 'EventEmitter 语义 → this._events'],
])

/** 免报清单（每条必须写清为什么）：<相对路径>:<行号> → 原因 */
const ALLOW = new Map([
  // 目前为空。若确需提取，请改用 `.bind(recv)` 或 boundAppend()，而不是往这里加。
])

const EXTRACT_RE = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)\s*$/

/**
 * 【心跳 56 补】承接上面那条正则的**盲区**（已有实证：3 处真实写法被判 NO-MATCH）：
 *   `const append = (session as { append?: … }).append`   ← 带类型断言
 *   `const onEvt  = emitter!.on`                          ← 带非空断言
 *   `const f      = (session).append`                     ← 带括号包裹
 * 三种包装**都不改变 `this` 会丢**这个事实，但上面那条正则要求右侧是纯标识符链，
 * 于是全部照不出来 —— 而它们恰恰是心跳 47 缺陷的同形写法。
 * 做法：先宽松抓 `名字 = <任意右侧>`，再**剥掉包层**看接收者是否为纯标识符链。
 * 剥不干净的（如 `foo().append`、`a[i].append`）一律**不报**（保守，宁缺勿滥；见 L44）。
 */
const LOOSE_DECL_RE = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*$/
const IDENT_CHAIN_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/** 剥掉类型断言 / 非空断言 / 括号包裹，直到露出纯标识符链；剥不干净回 undefined */
function unwrapReceiver(raw) {
  let s = raw.trim()
  for (let i = 0; i < 8; i++) {
    const before = s
    const asWrap = /^\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+as\s+[\s\S]+\)$/.exec(s)
    if (asWrap !== null) s = asWrap[1]
    const paren = /^\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)$/.exec(s)
    if (paren !== null) s = paren[1]
    s = s.replace(/!\s*$/, '')
    if (s === before) break
  }
  return IDENT_CHAIN_RE.test(s) ? s : undefined
}

/** 从一行声明里解析出「方法引用提取」：返回 { localName, recv, member } 或 null */
function parseExtraction(line) {
  const narrow = EXTRACT_RE.exec(line)
  if (narrow !== null) return { localName: narrow[1], recv: narrow[2], member: narrow[3] }
  if (/\.bind\s*\(/.test(line)) return null          // 已显式绑定 → 不算提取
  const loose = LOOSE_DECL_RE.exec(line)
  if (loose === null) return null
  const rightmost = /^(.*)\.([A-Za-z_$][\w$]*)$/.exec(loose[2])
  if (rightmost === null) return null
  const recv = unwrapReceiver(rightmost[1])
  if (recv === undefined) return null
  return { localName: loose[1], recv, member: rightmost[2] }
}

/** 递归收集 .ts（跳过派生目录 lib/ 与 dist/） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'lib' || name === 'dist' || name === 'node_modules') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 审计一批「虚拟文件」（{ path, text }）→ 违约列表 */
export function audit(files) {
  const violations = []
  const all = []
  for (const f of files) {
    const lines = f.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = parseExtraction(lines[i])
      if (m === null) continue
      const { localName, recv, member } = m
      const rec = { file: f.path, line: i + 1, localName, recv, member, code: lines[i].trim() }
      all.push(rec)
      if (!OFFICIAL_BOUND_MEMBERS.has(member)) continue
      if (ALLOW.has(`${f.path}:${i + 1}`)) continue
      violations.push(rec)
    }
  }
  return { violations, all }
}

// ---------------------------------------------------------------- 自检（正控 + 负控）

function selftest() {
  const bad = {
    path: 'SELFTEST/bad.ts',
    text: [
      'function f(live: any) {',
      '  const liveAppend = live.append',      // ← 必须被报
      '  const onEvt = emitter.on',            // ← 必须被报
      '  const content = msg.content',         // ← 属性读，不在名单 → 不报
      '  const bound = live.append.bind(live)',// ← 已绑定 → 不报
      '  const helper = boundAppend(live)',    // ← 不报
      '  return [liveAppend, onEvt, content, bound, helper]',
      '}',
    ].join('\n'),
  }
  const r = audit([bad])
  const flagged = r.violations.map(v => v.localName).sort()
  const want = ['liveAppend', 'onEvt']
  const okBad = JSON.stringify(flagged) === JSON.stringify(want)
  console.log(`${okBad ? '[ok]' : '[FAIL]'} 正控：坏样例被报 ${JSON.stringify(flagged)}（期望 ${JSON.stringify(want)}）`)

  // 负控：把坏样例修好，必须一条都不报（证明不是「见 const 就报」）
  const good = { path: 'SELFTEST/good.ts', text: bad.text.replace('const liveAppend = live.append', 'const liveAppend = live.append.bind(live)').replace('const onEvt = emitter.on', 'const onEvt = emitter.on.bind(emitter)') }
  const okGood = audit([good]).violations.length === 0
  console.log(`${okGood ? '[ok]' : '[FAIL]'} 负控：修好后 0 违约（实际 ${audit([good]).violations.length}）`)

  // 零控：空输入必须 0 报（防「恒报」）
  const okEmpty = audit([{ path: 'SELFTEST/empty.ts', text: '' }]).violations.length === 0
  console.log(`${okEmpty ? '[ok]' : '[FAIL]'} 零控：空文件 0 违约`)

  // 【心跳 56 补】包装形态覆盖：类型断言 / 非空断言 / 括号包裹 —— 都不改变 this 会丢
  const wrapped = {
    path: 'SELFTEST/wrapped.ts',
    text: [
      'function f(session: any, sessions: any, emitter: any) {',
      '  const append = (session as { append?: unknown }).append',   // ← 必须被报
      '  const onEvt = emitter!.on',                                 // ← 必须被报
      '  const flush = (sessions).flush',                            // ← 必须被报
      '  const ok = live.append.bind(live)',                         // ← 已绑定 → 不报
      '  const val = foo().append',                                  // ← 接收者非标识符链 → 保守不报
      '  const idx = arr[0].append',                                 // ← 同上 → 不报
      '  const plain = msg.content',                                 // ← 不在名单 → 不报
      '  return [append, onEvt, flush, ok, val, idx, plain]',
      '}',
    ].join('\n'),
  }
  const wFlagged = audit([wrapped]).violations.map(v => v.localName).sort()
  const wWant = ['append', 'flush', 'onEvt']
  const okWrapped = JSON.stringify(wFlagged) === JSON.stringify(wWant)
  console.log(`${okWrapped ? '[ok]' : '[FAIL]'} 包装控：断言/非空/括号三种包装被报 ${JSON.stringify(wFlagged)}（期望 ${JSON.stringify(wWant)}）`)

  return okBad && okGood && okEmpty && okWrapped
}

// ---------------------------------------------------------------- 官方库核对（可选）

function verifyLib() {
  if (!existsSync(SESSION_LIB)) { console.log('[skip] 官方库不在（未 staging）：', SESSION_LIB); return true }
  const text = readFileSync(SESSION_LIB, 'utf8')
  const lines = text.split('\n')
  let ok = true
  for (const [member, why] of OFFICIAL_BOUND_MEMBERS) {
    // 只在「官方 dsh-session 里真有这个方法」的成员上核对（emit/on 等属 EventEmitter，库内查不到）
    const defIdx = lines.findIndex(l => new RegExp(`^\\s{1,3}${member}\\s*\\(`).test(l))
    if (defIdx === -1) { console.log(`  – ${member}：本库未定义（可能属其它对象）——保留名单`); continue }
    const body = lines.slice(defIdx, defIdx + 60).join('\n')
    const usesThis = /\bthis\s*\./.test(body)
    console.log(`  ${usesThis ? '✓' : '✗'} ${member}：本库有定义且${usesThis ? '读' : '**不读**'} this.  （${why}）`)
    if (!usesThis) ok = false
  }
  return ok
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest() ? 0 : 3)

const files = walk(SRC).map(p => ({ path: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
const { violations, all } = audit(files)

if (args.includes('-v')) {
  console.log(`--- 全部方法引用提取候选（${all.length} 条）---`)
  for (const r of all) console.log(`  ${r.file}:${r.line}  ${r.localName} = ${r.recv}.${r.member}${OFFICIAL_BOUND_MEMBERS.has(r.member) ? '   ⚠ 高危成员' : ''}`)
}

if (args.includes('--verify-lib')) {
  console.log('--- 官方库核对（dsh-session）---')
  verifyLib()
}

if (violations.length === 0) {
  console.log(`[audit-method-binding] PASS　扫 ${files.length} 个 .ts，方法引用提取候选 ${all.length} 条，高危 0 条`)
  process.exit(0)
}
console.log(`[audit-method-binding] FAIL　${violations.length} 处高危 detach：`)
for (const v of violations) {
  console.log(`  ✗ ${v.file}:${v.line}  ${v.localName} = ${v.recv}.${v.member}`)
  console.log(`      代码: ${v.code}`)
  console.log(`      依据: ${OFFICIAL_BOUND_MEMBERS.get(v.member)}`)
  console.log(`      修法: 改用 ${v.recv}.${v.member}.bind(${v.recv}) 或 dsht-plugin-shared 的 boundAppend(${v.recv})`)
}
process.exit(1)
