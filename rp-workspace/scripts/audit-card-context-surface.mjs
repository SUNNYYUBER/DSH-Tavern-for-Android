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

/** 真 ST `getContext()` 顶层成员（权威面） */
export function readStSurface(file = ST_REF) {
  const text = fs.readFileSync(file, 'utf8')
  const fn = text.indexOf('export function getContext')
  if (fn < 0) throw new Error(`找不到 getContext: ${file}`)
  const ret = text.indexOf('return {', fn)
  if (ret < 0) throw new Error(`找不到 return { : ${file}`)
  return objectMembers(text, text.indexOf('{', ret)).map(m => m.name)
}

/** 我方宿主面 `buildHostStContext()` 顶层成员 */
export function readOurSurface(file = OUR_CTX) {
  const text = fs.readFileSync(file, 'utf8')
  const fn = text.indexOf('export function buildHostStContext')
  if (fn < 0) throw new Error(`找不到 buildHostStContext: ${file}`)
  const ret = text.indexOf('return {', fn)
  if (ret < 0) throw new Error('找不到 return { （我方宿主面）')
  return objectMembers(text, text.indexOf('{', ret)).map(m => m.name)
}

/** 卡脚本对 getContext() 的成员访问路径（含别名绑定 / 解构 / 内联链 / 可选链） */
export function readScriptAccesses(file) {
  const text = fs.readFileSync(file, 'utf8')
  /** member → 访问点行号列表 */
  const paths = new Map()
  const add = (path, idx) => {
    const line = text.slice(0, idx).split('\n').length
    if (!paths.has(path)) paths.set(path, [])
    paths.get(path).push(line)
  }
  const CHAIN = String.raw`(?:\??\.[A-Za-z_$][\w$]*)`

  // 1) const ctx = SillyTavern.getContext()
  const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*SillyTavern\s*\.\s*getContext\s*\(\s*\)/g
  const aliases = new Set()
  for (let m; (m = aliasRe.exec(text)) !== null;) aliases.add(m[1])

  // 2) const { a, b: c } = SillyTavern.getContext()
  const destrRe = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*SillyTavern\s*\.\s*getContext\s*\(\s*\)/g
  for (let m; (m = destrRe.exec(text)) !== null;) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim().replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name, m.index)
    }
  }

  // 3) SillyTavern.getContext().a.b
  const inlineRe = new RegExp(String.raw`SillyTavern\s*\.\s*getContext\s*\(\s*\)((?:${CHAIN})+)\??`, 'g')
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
    }
  `
  const got = objectMembers(src, src.indexOf('{'))
    .map(m => m.name)
  const want = ['shorthand', 'nested', 'str', 'tpl', 'fn', 'last']
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`[selftest] objectMembers → ${JSON.stringify(got)}`)
  console.log(`[selftest] ${ok ? 'PASS' : 'FAIL — 期望 ' + JSON.stringify(want)}`)
  return ok ? 0 : 1
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) process.exit(selftest())

  const scripts = []
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--script') scripts.push(argv[++i])
    else if (argv[i] === '-v' || argv[i] === '--verbose') verbose = true
  }
  if (scripts.length === 0) {
    console.error('用法：--script <card.js> [-v] | --selftest')
    process.exit(2)
  }

  let stKeys, ourKeys
  try { stKeys = readStSurface(); ourKeys = readOurSurface() } catch (e) {
    console.error(`[surface] FATAL ${e.message}`)
    process.exit(2)
  }
  const st = new Set(stKeys)
  const ours = new Set(ourKeys)
  console.log(`[surface] 真 ST getContext 顶层成员 ${stKeys.length}；我方宿主面顶层成员 ${ourKeys.length}`)

  let gaps = 0
  let inScope = 0
  let outOfScope = 0
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
      const inOurs = ours.has(head)
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
  }
  console.log(`\n[surface] 结论：缺口 ${gaps} 个`)
  process.exit(gaps > 0 ? 1 : 0)
}

main()
