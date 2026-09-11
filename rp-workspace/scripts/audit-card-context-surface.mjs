#!/usr/bin/env node
/**
 * audit-card-context-surface.mjs — 卡脚本「宿主全局面」缺口的**一次性**枚举
 * ============================================================================
 * 【为什么需要它（方法学）】
 *   T-37 → T-40 → T-41 → T-42 的推进是一条**串行**证明链：跑采集器 → 脚本崩在某行 →
 *   修那一个缺口 → 再跑 → 崩在更深的行（L35「错误往深处移」）。这条链**有效但极慢**：
 *   每轮只能暴露一个缺口，因为卡脚本是「首个异常即整段作废」。
 *
 *   本工具把这条串行链**一次性展开**：静态解析卡脚本对 `SillyTavern.getContext()`
 *   的全部成员访问路径，与**真 ST 的权威面**（`st-context.js` 的 getContext 返回体）对质，
 *   列出「真 ST 有、我方宿主面没有」的全部成员 —— 即**还没撞到的墙**。
 *
 * 【判据纪律（L36）】
 *   本工具只报「真 ST 有、我方无」——**不报「我方有、真 ST 无」为缺陷**
 *   （那是我们的扩展面，不构成与基准的差异，除非它改变了基准行为）。
 *
 * 用法：
 *   node scripts/audit-card-context-surface.mjs --script <card.js> [--script <card2.js>] [-v]
 *   node scripts/audit-card-context-surface.mjs --selftest        # 解析器正控
 * 退出码：0 = 卡脚本访问的成员我方**全部具备**；1 = 有缺口；2 = 环境/解析失败
 */
import fs from 'node:fs'
import process from 'node:process'

const ST_REF = 'D:/SillyTavern-1.16.0/TauriTavern-Canary/SillyTavern-reference/public/scripts/st-context.js'
const OUR_CTX = 'D:/DSH RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/host-vendor.ts'

/**
 * 我方**全部** `getContext()` 门面（心跳 51 扩域）。
 *
 * 为什么不止一个：宿主页与脚本 iframe 各有一套——
 *   · 宿主页：`host-vendor.ts:buildHostStContext()`（T-37 起；卡的宿主注入脚本吃这一份）
 *   · iframe ：`th-shim.ts:buildStContextFacade()`（脚本帧内的 `SillyTavern.getContext()`）
 * 两套门面**独立维护**过，所以缺口也必须分开量（只量宿主面会给出一条"看着干净"的假结论
 * ——这正是 L44「枚举器自身必须先过正控」要防的失败模式）。
 */
const OUR_SURFACES = [
  { file: OUR_CTX, marker: 'export function buildHostStContext', label: '宿主页门面 host-vendor.ts' },
  {
    file: 'D:/DSH RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/th-shim.ts',
    marker: 'function buildStContextFacade',
    label: 'iframe 门面 th-shim.ts',
  },
]

/** 一个门面至少该有的成员数——低于此值判为"解析出了个空壳"（宁可炸也不要假绿） */
const SURFACE_MIN_MEMBERS = 5

// ------------------------------------------------------------------ 解析器

/**
 * 从 `{ ... }` 平衡块里取**顶层成员名**（含简写属性 `name,`）。
 * 关键：必须处理
 *   · 简写属性（`eventSource,` / `name1,`）—— 无冒号，**只按冒号取键会漏掉它们**
 *     （本工具首版就漏了，把 33 个当成全量，实际 ~170 个 → 差点产出一条虚假防线）
 *   · 字符串/模板串/注释内的花括号与逗号
 *   · 嵌套对象/数组/函数调用内的逗号（不是顶层分隔符）
 * 返回 `[{ name, raw }]`
 */
export function objectMembers(text, openBraceIdx) {
  const members = []
  let i = openBraceIdx
  if (text[i] !== '{') return members
  let depth = 0
  let inStr = null
  let start = i + 1
  const flush = (endIdx) => {
    const raw = text.slice(start, endIdx)
    // 去注释后取首个标识符/字符串键
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim()
    if (stripped === '') return
    // 展开语法 ...rest
    if (stripped.startsWith('...')) return
    // 【心跳 51】访问器形态 `get name() { ... }` / `set name(v) { ... }` —— 无冒号，
    // 只按「标识符 + 冒号/逗号」取键会**整条漏掉**（与本工具首版漏掉简写属性同型）。
    // 宿主门面需要访问器来表达「每次取活值」的成员（name1/name2），故必须识别。
    const acc = /^(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/.exec(stripped)
    if (acc) { members.push({ name: acc[1], raw: stripped }); return }
    const m = /^(["']?)([A-Za-z_$][\w$]*)\1\s*(?::|,|$|\n)/m.exec(stripped)
      ?? /^(["']?)([A-Za-z_$][\w$]*)\1\s*:/.exec(stripped)
    if (m) members.push({ name: m[2], raw: stripped })
  }
  for (; i < text.length; i++) {
    const c = text[i]
    const prev = text[i - 1]
    if (inStr !== null) {
      if (c === inStr && prev !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length - 1 : nl; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i); i = e < 0 ? text.length - 1 : e + 1; continue }
    if (c === '{' || c === '[' || c === '(') { depth++; continue }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      if (depth === 0) { flush(i); break }
      continue
    }
    if (c === ',' && depth === 1) { flush(i); start = i + 1; continue }
  }
  return members
}

/**
 * 找到某个函数体内**顶层**的 `return {`（返回那个 `{` 的下标）。
 *
 * 为什么不能直接 `indexOf('return {')`：函数体里只要有**内层**函数也 `return { ... }`
 *（例如 `const readNames = () => { return { name1, name2 } }`），首个匹配就落在内层上，
 * 于是解析到的是那个小对象 —— 实测表现为「门面只解析出 2 个成员」。
 * 心跳 51 就踩到了这个坑（由 SURFACE_MIN_MEMBERS 兜底报错，没有静默给出假结论）。
 * 故这里按**函数体深度 == 1** 定位真返回体。
 */
export function topLevelReturnBrace(text, fnIdx) {
  // 1) 先定位**函数体**起始 `{`。不能直接取 marker 后的第一个 `{`：
  //    签名里有默认值 `= {}`（`buildHostStContext(src = {})`）与返回类型标注，
  //    首个 `{` 会落在参数表里。→ 跟踪圆括号，归零后的第一个 `{` 才是函数体。
  let paren = 0
  let seenParen = false
  let bodyStart = -1
  for (let i = fnIdx; i < text.length; i++) {
    const c = text[i]
    if (c === '(') { paren++; seenParen = true; continue }
    if (c === ')') { paren--; continue }
    if (c === '{' && seenParen && paren === 0) { bodyStart = i; break }
  }
  if (bodyStart < 0) return -1

  let i = bodyStart
  let depth = 0
  let inStr = null
  for (; i < text.length; i++) {
    const c = text[i]
    const prev = text[i - 1]
    if (inStr !== null) {
      if (c === inStr && prev !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length - 1 : nl; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i); i = e < 0 ? text.length - 1 : e + 1; continue }
    if (c === '{' || c === '[' || c === '(') { depth++; continue }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      if (depth === 0) return -1 // 函数体结束都没找到
      continue
    }
    // 函数体深度 1 且遇到 `return` → 其后第一个 `{` 就是返回体
    if (depth === 1 && c === 'r' && text.startsWith('return', i) && /[\s{]/.test(text[i + 6] ?? '')) {
      const b = text.indexOf('{', i + 6)
      if (b > 0 && /^[^{]*$/.test(text.slice(i + 6, b))) return b
    }
  }
  return -1
}

/** 真 ST `getContext()` 顶层成员（权威面） */
export function readStSurface(file = ST_REF) {
  const text = fs.readFileSync(file, 'utf8')
  const fn = text.indexOf('export function getContext')
  if (fn < 0) throw new Error(`找不到 getContext: ${file}`)
  const brace = topLevelReturnBrace(text, fn)
  if (brace < 0) throw new Error(`找不到顶层 return { : ${file}`)
  return objectMembers(text, brace).map(m => m.name)
}

/** 我方宿主面 `buildHostStContext()` 顶层成员 */
export function readOurSurface(file = OUR_CTX, marker = 'export function buildHostStContext') {
  const text = fs.readFileSync(file, 'utf8')
  const fn = text.indexOf(marker)
  if (fn < 0) throw new Error(`找不到门面函数「${marker}」: ${file}`)
  const brace = topLevelReturnBrace(text, fn)
  if (brace < 0) throw new Error(`找不到顶层 return { （我方门面：${marker}）`)
  const names = objectMembers(text, brace).map(m => m.name)
  // L44：解析出空壳/极少成员 → 直接失败（否则会静默产出一条「零缺口」的假绿结论）
  if (names.length < SURFACE_MIN_MEMBERS) {
    throw new Error(`门面「${marker}」只解析出 ${names.length} 个成员（< ${SURFACE_MIN_MEMBERS}）—— 疑似解析口径失效，拒绝给出结论: ${file}`)
  }
  return names
}

/** 卡脚本对 getContext() 的成员访问路径（含别名绑定 / 解构 / 内联链 / 可选链） */
export function readScriptAccesses(file) {
  return readScriptAccessesFromText(fs.readFileSync(file, 'utf8'))
}

/** 同上，但从**文本**读（供 --selftest 用；两者必须同一实现，否则正控测的是另一份代码） */
export function readScriptAccessesFromText(text) {
  /** member → 访问点行号列表 */
  const paths = new Map()
  const add = (path, idx) => {
    const line = text.slice(0, idx).split('\n').length
    if (!paths.has(path)) paths.set(path, [])
    paths.get(path).push(line)
  }
  const CHAIN = String.raw`(?:\??\.[A-Za-z_$][\w$]*)`

  // 1) const ctx = SillyTavern.getContext()
  //
  // 【心跳 51 扩域】`SillyTavern.getContext()` 只是**卡的注入脚本**的取法。TH **扩展**
  // （ESM 形态，如 chat-history-backup / JS-Slash-Runner）走的是 `import { getContext }`
  // 后的**裸调用** `const context = getContext()` —— 旧口径对这类文件一条访问都提不出来，
  // 于是打出「✅ 全部具备」的**假绿**（实测：chat-history-backup/index.js 有 16 处 getContext，
  // 旧口径报 0 条访问 / 0 缺口）。两种取法都必须收。
  const GT = String.raw`(?:SillyTavern\s*\.\s*)?getContext\s*\(\s*\)`
  const aliasRe = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${GT}`, 'g')
  const aliases = new Set()
  for (let m; (m = aliasRe.exec(text)) !== null;) aliases.add(m[1])

  // 2) const { a, b: c } = SillyTavern.getContext() / = getContext()
  const destrRe = new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*${GT}`, 'g')
  for (let m; (m = destrRe.exec(text)) !== null;) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim().replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name, m.index)
    }
  }

  // 3) SillyTavern.getContext().a.b / getContext().a.b
  const inlineRe = new RegExp(String.raw`${GT}((?:${CHAIN})+)\??`, 'g')
  for (let m; (m = inlineRe.exec(text)) !== null;) {
    const path = m[1].replace(/\?\./g, '.')
    add(path.slice(1), m.index)
  }

  // 4) alias.a.b
  for (const alias of aliases) {
    const re = new RegExp(String.raw`\b${alias}((?:${CHAIN})+)\??`, 'g')
    for (let m; (m = re.exec(text)) !== null;) {
      const path = m[1].replace(/\?\./g, '.')
      add(path.slice(1), m.index)
    }
  }
  return { aliases: [...aliases], paths }
}

// ------------------------------------------------------------------ 主流程

function selftest() {
  const src = `
    const obj = {
      shorthand,
      nested: { a: 1, b: [1, 2, { c: 3 }] },
      /* comment, with { braces } and , commas */
      str: "a, b, {c}",
      tpl: \`x, {y}\`,
      fn: function () { return { z: 1 } },
      // line comment, with comma
      last: 9,
      get liveA() { return this._n },
      set liveB(v) { this._n = v },
      /* 裸 getContext 取法（TH 扩展形态）也要能被访问提取器认出来 */
      method: () => 1,
    }
  `
  const got = objectMembers(src, src.indexOf('{'))
    .map(m => m.name)
  const want = ['shorthand', 'nested', 'str', 'tpl', 'fn', 'last', 'liveA', 'liveB', 'method']
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`[selftest] objectMembers → ${JSON.stringify(got)}`)
  if (!ok) console.log(`[selftest] 期望 → ${JSON.stringify(want)}`)

  // 访问提取器：两种取法（SillyTavern.getContext() 与裸 getContext()）都要提到
  const probe = `
    const ctx = SillyTavern.getContext(); ctx.eventSource.on('x', () => {});
    const c2 = getContext(); c2.chatMetadata = {};
    const { name1, name2: n2 } = getContext();
  `
  const probeWant = 'chatMetadata,eventSource.on,name1,name2'
  const probeGot = [...readScriptAccessesFromText(probe).paths.keys()].sort().join(',')
  const probeOk = probeGot === probeWant
  console.log(`[selftest] readScriptAccesses → ${probeGot}`)
  if (!probeOk) console.log(`[selftest] 期望 → ${probeWant}`)

  console.log(`[selftest] ${ok && probeOk ? 'PASS' : 'FAIL'}`)
  return ok && probeOk ? 0 : 1
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) process.exit(selftest())

  const scripts = []
  let verbose = false
  const surfaces = [...OUR_SURFACES]
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--script') scripts.push(argv[++i])
    else if (argv[i] === '-v' || argv[i] === '--verbose') verbose = true
    else if (argv[i] === '--surface') {
      // <file>::<marker>（可重复；追加到内置门面之外）
      const spec = String(argv[++i] ?? '')
      const at = spec.indexOf('::')
      if (at < 0) { console.error('--surface 需形如 <file>::<function marker>'); process.exit(2) }
      surfaces.push({ file: spec.slice(0, at), marker: spec.slice(at + 2), label: `自定义 ${spec.slice(0, at)}` })
    }
  }
  if (scripts.length === 0) {
    console.error('用法：--script <card.js> [-v] [--surface <file>::<marker>] | --selftest')
    process.exit(2)
  }

  let stKeys
  const ourBySurface = []
  try {
    stKeys = readStSurface()
    for (const s of surfaces) ourBySurface.push({ ...s, keys: readOurSurface(s.file, s.marker) })
  } catch (e) {
    console.error(`[surface] FATAL ${e.message}`)
    process.exit(2)
  }
  const st = new Set(stKeys)
  const union = new Set()
  for (const s of ourBySurface) for (const k of s.keys) union.add(k)
  console.log(`[surface] 真 ST getContext 顶层成员 ${stKeys.length}`)
  for (const s of ourBySurface) console.log(`[surface]   我方 ${s.label}：${s.keys.length} 个成员`)
  console.log(`[surface]   并集 ${union.size} 个成员（缺口判定用并集——脚本在哪个帧取 ctx 由卡的注入形态决定）`)

  let gaps = 0
  let inScope = 0
  let outOfScope = 0
  let judgedFiles = 0
  let uninspected = 0
  for (const file of scripts) {
    // 路径按**当前工作目录**解析：从别处调用容易写成 rp-workspace/tmp/… 而实际在仓库根 tmp/…
    if (!fs.existsSync(file)) {
      console.error(`\n[script] FATAL 找不到脚本文件：${file}`)
      console.error('         —— 路径按「当前工作目录」解析；例如卡脚本在仓库根 tmp/ 下时应写 ../tmp/t37-inject.js')
      process.exit(2)
    }
    const { aliases, paths } = readScriptAccesses(file)
    console.log(`\n=== ${file} ===`)
    console.log(`[script] 绑定别名：${aliases.join(', ') || '(无)'}；访问路径 ${paths.size} 条`)
    // L44 同型防线：**一条访问都没提出来 ≠ 全部具备**。这时本工具对这个文件"不可判定"
    //（该文件可能根本不取 ctx，也可能取法超出本工具口径）——必须显式说出来，
    // 否则「✅」会被读成"已核验通过"，实为"压根没检查"。此类文件不计入 gaps，但计入 uninspected。
    if (paths.size === 0) {
      uninspected++
      console.log('  ⚠️ 不可判定：未识别到任何 `SillyTavern.getContext()` / `getContext()` 成员访问')
      console.log('     —— 可能是该文件不取 ctx，也可能是取法超出本工具口径（勿读成「已具备」）')
      continue
    }
    judgedFiles++
    const top = new Map() // top-level → { subpaths, lines }
    for (const [path, lines] of paths) {
      const [head, ...rest] = path.split('.')
      if (!top.has(head)) top.set(head, { subs: new Set(), lines: [] })
      const rec = top.get(head)
      rec.lines.push(...lines)
      if (rest.length > 0) rec.subs.add(rest.join('.'))
    }
    const missing = []
    for (const [head, rec] of top) {
      const inSt = st.has(head)
      const inOurs = union.has(head)
      if (!inSt) { outOfScope++; if (verbose) console.log(`  [范围外] ${head} —— 真 ST getContext 也没有（不是移植缺口）`) ; continue }
      inScope++
      if (!inOurs) missing.push({ head, ...rec })
      else if (verbose) console.log(`  [ok] ${head}（我方已有）子路径：${[...rec.subs].join(', ') || '—'}`)
    }
    missing.sort((a, b) => b.lines.length - a.lines.length)
    if (missing.length === 0) {
      console.log('  ✅ 卡脚本访问的**全部**真 ST 成员，我方宿主面均已具备')
    } else {
      gaps += missing.length
      console.log(`  ❌ 缺口 ${missing.length} 个（真 ST 有、我方宿主面无）—— 这些是**还没撞到的墙**：`)
      for (const m of missing) {
        console.log(`     · ${m.head}  （访问 ${m.lines.length} 次，行 ${[...new Set(m.lines)].slice(0, 8).join('/')}）`)
        if (m.subs.size > 0) console.log(`         子路径：${[...m.subs].slice(0, 10).join(', ')}`)
      }
    }
    console.log(`  [口径] 真 ST 也无的成员 ${outOfScope} 个（范围外，非缺口）；真 ST 有的成员 ${inScope} 个`)

    // ---- 每面单算（**仅供参考，不参与退出码**）----
    // 并集口径回答的是「这个成员在某个帧里有没有」；但脚本在**哪个**帧取 ctx 由卡的注入形态
    // 决定 —— 只存在于宿主面的成员，对 iframe 内脚本等于不存在。这里把差额如实列出来。
    // 刻意**不影响退出码**：否则 iframe 面（已知比宿主面窄，见 T-46）会让闸门恒红 = 没有门（L14）。
    for (const s of ourBySurface) {
      const set = new Set(s.keys)
      const only = [...top.keys()].filter(h => st.has(h) && !set.has(h))
      if (only.length > 0) {
        console.log(`  [单面] ${s.label} 缺 ${only.length} 个（并集口径已覆盖的记为已知窄面，不阻塞）：${only.join(', ')}`)
      }
    }
  }
  console.log(`\n[surface] 结论：缺口 ${gaps} 个（已核验文件 ${judgedFiles} 个；不可判定 ${uninspected} 个）`)
  if (uninspected > 0) {
    console.log(`[surface] ⚠️ 有 ${uninspected} 个文件「不可判定」——不要把它读成"已具备"（L44）`)
  }
  process.exit(gaps > 0 ? 1 : 0)
}

main()
