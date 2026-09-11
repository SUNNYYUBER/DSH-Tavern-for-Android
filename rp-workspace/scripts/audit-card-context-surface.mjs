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
import { pathToFileURL } from 'node:url'

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

/**
 * 取 `{` 起**配平**的块内文本（不含最外层花括号）；配平失败返 `null`。
 * 【心跳 63C】用于判断「同文件自定义的 `getContext()` 方法是不是 ST 转发」——
 * 判据必须看**函数体**，不能只看签名（签名里没有信息）。
 */
export function balancedBody(text, braceIdx) {
  if (text[braceIdx] !== '{') return null
  let depth = 0
  let inStr = null
  for (let i = braceIdx; i < text.length; i++) {
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
      if (depth === 0) return text.slice(braceIdx + 1, i)
    }
  }
  return null
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
  /**
   * 【心跳 63C】该文件**是否可能**取 ST 上下文（= 是否出现任何 ST 上下文取法的名字）。
   *
   * 为什么需要它：`paths.size === 0` 此前一律报「不可判定」，但这两件事必须分开 ——
   *   · **全篇没有 `SillyTavern` 也没有无参 `getContext()`** ⇒ 该文件**确定不取 ctx**，
   *     这是**可判定**的结论（任何 ctx 取法都必然要提这两个名字之一），不该说"不可判定"；
   *   · 出现了名字却提不出成员 ⇒ 才是真「不可判定」（成员访问在调用方 = 数据流边界）。
   * 实证（心跳 63C 全语料）：31/36 个"不可判定"其实是**确定不取 ctx**（如
   * `_自动刷新楼层.js` 只用 `typeof SillyTavern !== 'undefined'` 做**宿主存在性探测**）。
   * ⚠️ 判据刻意**不剥注释**：注释里提到的 `SillyTavern` 会让文件落回「不可判定」= **保守方向**
   *（宁可少给结论，不可把真取 ctx 的文件误判成"不取"）。`canvas.getContext('2d')` 带实体参数
   * ⇒ 两条 `getContext` 判据都不命中 ⇒ 正确落"不取 ctx"（实测 `悬浮球.js`）。
   */
  const touchesSt = /\bSillyTavern\b/.test(text)
    || /(?<![\w$.])getContext\s*\(\s*\)/.test(text)
    || /\.\s*getContext\s*\?\s*\.\s*\(\s*\)/.test(text)
  const add = (path, idx) => {
    const line = text.slice(0, idx).split('\n').length
    if (!paths.has(path)) paths.set(path, [])
    paths.get(path).push(line)
  }
  // 【心跳 63C】CHAIN 增加**下标成员**（`?.["extensionPrompts"]` / `["chatMetadata"]`）——
  // 实证 `傻瓜版导入脚本2_0.js:829` 写作 `this.getContext()?.["extensionPrompts"]`，
  // 旧 CHAIN 只认点号 ⇒ 该成员整类不可见。三种写法（`.x` / `?.["x"]` / `["x"]`）统一收。
  const CHAIN = String.raw`(?:\??\.\s*[A-Za-z_$][\w$]*|\??\.\s*\[\s*['"][A-Za-z_$][\w$]*['"]\s*\]|\??\s*\[\s*['"][A-Za-z_$][\w$]*['"]\s*\])`
  /** 成员链规范化：`?.["x"]` / `.x` / `["x"]` → `.x`（调用方再 `slice(1)`） */
  const normPath = (s) =>
    s.replace(/\?\./g, '.').replace(/\?\s*\[/g, '[')
      .replace(/\[\s*['"]/g, '.').replace(/['"]\s*\]/g, '').replace(/\.\./g, '.')

  // 1) const ctx = SillyTavern.getContext()
  //
  // 【心跳 51 扩域】`SillyTavern.getContext()` 只是**卡的注入脚本**的取法。TH **扩展**
  // （ESM 形态，如 chat-history-backup / JS-Slash-Runner）走的是 `import { getContext }`
  // 后的**裸调用** `const context = getContext()` —— 旧口径对这类文件一条访问都提不出来，
  // 于是打出「✅ 全部具备」的**假绿**（实测：chat-history-backup/index.js 有 16 处 getContext，
  // 旧口径报 0 条访问 / 0 缺口）。两种取法都必须收。
  //
  // 【心跳 63 二次扩域（真实语料普查逼出来的）】两个此前**整类漏掉**的取法：
  //   · 间接 `target.SillyTavern.getContext()` —— 旧 GT 只允许 `SillyTavern.` **紧贴**在
  //     `getContext` 前，于是 `对话渲染系统 v7.1:134-135`（`target && target.SillyTavern &&
  //     typeof target.SillyTavern.getContext === 'function'`）**3 处 getContext 一条都没提到**。
  //   · 顶层直取 `SillyTavern.xxx`（不经 getContext）—— 由下方 5) 单独处理。
  // ⚠️ 第二分支加 `(?<![\w$.])` 负向后顾：否则 `canvas.getContext()` 这类**同名无关 API**
  // 也会被当成 ST 取法（`getContext('2d')` 因带实参本已不匹配，但 `foo.getContext()` 会）。
  const GT = String.raw`(?:[\w$]+\s*\.\s*)*SillyTavern\s*\.\s*getContext\s*\(\s*\)|(?<![\w$.])getContext\s*\(\s*\)`
  const aliasRe = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:${GT})`, 'g')
  const aliases = new Set()
  for (let m; (m = aliasRe.exec(text)) !== null;) aliases.add(m[1])

  // 1b) 【心跳 63C】**可选调用** `X?.getContext?.()`
  //
  // 整类此前漏掉：GT 的 `getContext\s*\(\s*\)` 夹不住 `?.`（`getContext?.()`）。
  // 实证 `酒馆思维链清洗.js:14` —— `const context = getST()?.getContext?.();`
  // （该文件 6 处 getContext 在旧口径下**一条访问都提不出来**，整份脚本被判「不可判定」）。
  // ⚠️ 别名绑定必须用**本行前缀回看**，不能让 GT 紧跟 `=`：`=` 与 `getContext` 之间隔着 `getST()?.`。
  const optRe = /\.\s*getContext\s*\?\s*\.\s*\(\s*\)/g
  for (let m; (m = optRe.exec(text)) !== null;) {
    const chain = new RegExp(String.raw`^((?:${CHAIN})+)\??`).exec(text.slice(m.index + m[0].length))
    if (chain) {
      const p = normPath(chain[1])
      if (p.length > 1) add(p.slice(1), m.index)
    }
    const lineStart = text.lastIndexOf('\n', m.index) + 1
    const asg = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^\n;]*$/.exec(text.slice(lineStart, m.index))
    if (asg) aliases.add(asg[1])
  }

  // 1c) 【心跳 63C】**下标形态**的 ST 全局与直取：`globalThis["SillyTavern"]` / `window['SillyTavern'].chat`
  //
  // 旧 GT 要求 `SillyTavern` 是**标识符**，字符串下标整类漏掉。
  // 实证 `傻瓜版导入脚本2_0.js:591` —— `const global = globalThis["SillyTavern"];`
  const subRe = /\[\s*['"]SillyTavern['"]\s*\]/g
  for (let m; (m = subRe.exec(text)) !== null;) {
    const mem = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(text.slice(m.index + m[0].length))
    if (mem && mem[1] !== 'getContext') add(mem[1], m.index)
  }

  // 1d) 【心跳 63C】同文件**自定义的 ST 转发方法** `getContext()`
  //
  // 判据（**自证**，不是推测）：存在名为 `getContext` 的**无参**方法/函数定义，且其**函数体**内出现
  // `SillyTavern` —— canvas 的 `getContext(w, h)` 带实体参数、体内也不可能出现 `SillyTavern`，
  // 故不会误捕（反控见 selftest probe8）。
  // 实证 `傻瓜版导入脚本2_0.js:587-596` 定义 → 同文件 **6 处** `this.getContext()?.xxx`
  // （含 `onlineStatus` / `chat` / `chatCompletionSettings` / `extensionPrompts`）此前全部不可见。
  let customCtxAlias = false
  const defRe = /\bgetContext\s*\(\s*\)\s*\{/g
  for (let m; (m = defRe.exec(text)) !== null;) {
    const body = balancedBody(text, m.index + m[0].length - 1)
    if (body !== null && /SillyTavern/.test(body)) { customCtxAlias = true; break }
  }
  if (customCtxAlias) {
    // 方法体自证是 ST 转发 ⇒ 同文件所有 `getContext()` 调用都算 ST 取法
    const callRe = new RegExp(String.raw`\b(?:(?:this|self)\s*\.\s*)?getContext\s*\(\s*\)((?:${CHAIN})+)\??`, 'g')
    for (let m; (m = callRe.exec(text)) !== null;) {
      const p = normPath(m[1])
      if (p.length > 1) add(p.slice(1), m.index)
    }
    const bindRe = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:this|self)\s*\.\s*)?getContext\s*\(\s*\)`, 'g')
    for (let m; (m = bindRe.exec(text)) !== null;) aliases.add(m[1])
  }

  // 2) const { a, b: c } = SillyTavern.getContext() / = getContext()
  const destrRe = new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:${GT})`, 'g')
  for (let m; (m = destrRe.exec(text)) !== null;) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim().replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name, m.index)
    }
  }

  // 3) SillyTavern.getContext().a.b / getContext().a.b
  const inlineRe = new RegExp(String.raw`(?:${GT})((?:${CHAIN})+)\??`, 'g')
  for (let m; (m = inlineRe.exec(text)) !== null;) {
    const path = normPath(m[1])
    add(path.slice(1), m.index)
  }

  // 4) alias.a.b
  for (const alias of aliases) {
    const re = new RegExp(String.raw`\b${alias}((?:${CHAIN})+)\??`, 'g')
    for (let m; (m = re.exec(text)) !== null;) {
      const path = normPath(m[1])
      add(path.slice(1), m.index)
    }
  }

  // 5) 顶层直取 `SillyTavern.<member>`（**不经 getContext**）
  //
  // 【心跳 63 新增】真 ST 的 `window.SillyTavern` 是 `st-context.js` 导出的那个对象 ——
  // 它**既带 `getContext()` 也带全部直接成员**（= getContext 的展开），所以顶层直取
  // 与 `getContext().x` 指向**同一个成员集合**，用同一份权威面判定即可。
  // 真实语料实证（此前整类漏检 ⇒「缺口 0」是被低估的结论）：
  //   · `格式肘击大师v1_3.js:72-73` → `SillyTavern.characterId` / `SillyTavern.characters`
  //   · `梦鲸思客消息处理 2.4` → `SillyTavern.POPUP_RESULT` / `POPUP_TYPE` / `callGenericPopup` /
  //     `chat` / `saveChat` / `stopGeneration` / `updateMessageBlock`
  // `\b` 允许 `window.` / `target.` 前缀（这两种写法都出现过）；`getContext` 由上面 1)~4) 负责，跳过。
  const topRe = /\bSillyTavern\s*\.\s*([A-Za-z_$][\w$]*)/g
  for (let m; (m = topRe.exec(text)) !== null;) {
    if (m[1] === 'getContext') continue
    add(m[1], m.index)
  }

  /**
   * 【心跳 63C】被**存在性守卫**包裹过的成员名（`typeof ctx?.x === 'function'` / `!== 'undefined'`）。
   *
   * 为什么这一维决定优先级：一个"缺口"会不会**抛异常**，取决于脚本自己有没有守。
   * 实证（心跳 63C，`getTokenCountAsync` 6 文件 / 13 次）：
   *   · `if (typeof context?.getTokenCountAsync !== "function") return void 0;` → **已守卫**，缺了只静默降级
   *   · `typeof SillyTavern.getTokenCountAsync === "function" && lastText`   → **已守卫**
   *   · `await SillyTavern.getTokenCountAsync(...)`（压缩成一行、无守卫）    → **会抛 TypeError**
   * ⇒ 只报"缺口数"会把"会崩的"与"静默降级的"混在一起，让优先级排序失真（L98 的另一面）。
   */
  const guarded = new Set()
  const guardRe = /\btypeof\s+[^\n;{}]*?\.\s*([A-Za-z_$][\w$]*)\s*(?:!==|===|!=|==)/g
  for (let m; (m = guardRe.exec(text)) !== null;) guarded.add(m[1])

  return { aliases: [...aliases], paths, touchesSt, guarded }
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

  // 【心跳 63】两个新形态的正控 + 一个反控（同名无关 API 不得误捕）
  const probe2 = `
    const a = SillyTavern.characterId;
    const b = SillyTavern.characters[0];
    window.SillyTavern.chat.length;
  `
  const probe2Want = 'characterId,characters,chat'
  const probe2Got = [...readScriptAccessesFromText(probe2).paths.keys()].sort().join(',')
  const probe2Ok = probe2Got === probe2Want
  console.log(`[selftest] 顶层直取 SillyTavern.x → ${probe2Got}`)
  if (!probe2Ok) console.log(`[selftest] 期望 → ${probe2Want}`)

  const probe3 = `
    if (t && t.SillyTavern && typeof t.SillyTavern.getContext === 'function') { return t.SillyTavern.getContext() }
    const c = t.SillyTavern.getContext(); c.stopGeneration();
  `
  const probe3Want = 'stopGeneration'
  const probe3Got = [...readScriptAccessesFromText(probe3).paths.keys()].sort().join(',')
  const probe3Ok = probe3Got === probe3Want
  console.log(`[selftest] 间接 X.SillyTavern.getContext() → ${probe3Got}`)
  if (!probe3Ok) console.log(`[selftest] 期望 → ${probe3Want}`)

  // 反控：canvas 的同名 API 不得被当成 ST 取法（否则会造出假缺口/假访问）
  const probe4 = `const g = canvas.getContext('2d'); g.fillRect(1,2,3,4); const h = thing.getContext(); h.clearRect(0,0,1,1);`
  const probe4Want = ''
  const probe4Got = [...readScriptAccessesFromText(probe4).paths.keys()].sort().join(',')
  const probe4Ok = probe4Got === probe4Want
  console.log(`[selftest] 反控 canvas/同名 getContext → 「${probe4Got}」`)
  if (!probe4Ok) console.log(`[selftest] 期望 → 空`)

  // 【心跳 63C】三类新取法的正控 + 一条新反控（全是真实语料逼出来的形态）
  const probe5 = `const context = getST()?.getContext?.(); const c2 = context?.powerUserSettings?.reasoning;`
  const probe5Want = 'powerUserSettings.reasoning'
  const probe5Got = [...readScriptAccessesFromText(probe5).paths.keys()].sort().join(',')
  const probe5Ok = probe5Got === probe5Want
  console.log(`[selftest] 可选调用 getContext?.() → ${probe5Got}`)
  if (!probe5Ok) console.log(`[selftest] 期望 → ${probe5Want}`)

  const probe6 = `const g = globalThis["SillyTavern"]; g.getContext(); const x = globalThis["SillyTavern"].chat;`
  const probe6Want = 'chat'
  const probe6Got = [...readScriptAccessesFromText(probe6).paths.keys()].sort().join(',')
  const probe6Ok = probe6Got === probe6Want
  console.log(`[selftest] 下标 globalThis["SillyTavern"].x → ${probe6Got}`)
  if (!probe6Ok) console.log(`[selftest] 期望 → ${probe6Want}`)

  const probe7 = `
    class C {
      getContext() {
        const g = globalThis["SillyTavern"];
        return typeof g?.getContext === "function" ? g.getContext() : void 0;
      }
      read() {
        const s = this.getContext()?.chatCompletionSettings;
        const st = this.getContext()?.onlineStatus;
        return this.getContext()?.["extensionPrompts"];
      }
    }
  `
  const probe7Want = 'chatCompletionSettings,extensionPrompts,onlineStatus'
  const probe7Got = [...readScriptAccessesFromText(probe7).paths.keys()].sort().join(',')
  const probe7Ok = probe7Got === probe7Want
  console.log(`[selftest] 自定义 ST 转发方法 this.getContext()?.x → ${probe7Got}`)
  if (!probe7Ok) console.log(`[selftest] 期望 → ${probe7Want}`)

  // 反控（心跳 63C）：canvas 包装类的 `getContext()` 体内**不可能**出现 SillyTavern
  // ⇒ 自定义转发方法的自证判据不得把它拉进来（否则会造出假访问）
  const probe8 = `
    class Painter {
      getContext() { return this.el.getContext('2d') }
      draw() { const c = this.getContext(); c.clearRect(0, 0, 1, 1) }
    }
  `
  const probe8Got = [...readScriptAccessesFromText(probe8).paths.keys()].sort().join(',')
  const probe8Ok = probe8Got === ''
  console.log(`[selftest] 反控 canvas 包装类 → 「${probe8Got}」`)
  if (!probe8Ok) console.log(`[selftest] 期望 → 空`)

  // 【心跳 63C】三分法的两条判据：`touchesSt` 决定「不取 ctx（可判定）」还是「不可判定（真边界）」
  const probe9 = `const a = 1; canvas.getContext('2d').fillRect(0,0,1,1); helper.getContext();`
  const probe9Ok = readScriptAccessesFromText(probe9).touchesSt === false
  console.log(`[selftest] 不取 ctx 判定（canvas 带参/无参同名 API）→ touchesSt=${readScriptAccessesFromText(probe9).touchesSt}`)
  if (!probe9Ok) console.log(`[selftest] 期望 → touchesSt=false`)

  const probe10 = `if (typeof SillyTavern !== 'undefined') { init() }`
  const probe10Ok = readScriptAccessesFromText(probe10).touchesSt === true
  console.log(`[selftest] 宿主存在性探测（不取 ctx）→ touchesSt=${readScriptAccessesFromText(probe10).touchesSt}`)
  if (!probe10Ok) console.log(`[selftest] 期望 → touchesSt=true`)

  // 【心跳 63C】存在性守卫提取（决定"会崩"还是"静默降级"）
  const probe11 = `if (typeof ctx?.getTokenCountAsync !== "function") return; if (typeof SillyTavern.chat === 'function') {}`
  const probe11Got = [...readScriptAccessesFromText(probe11).guarded].sort().join(',')
  const probe11Ok = probe11Got === 'chat,getTokenCountAsync'
  console.log(`[selftest] 存在性守卫 typeof → ${probe11Got}`)
  if (!probe11Ok) console.log(`[selftest] 期望 → chat,getTokenCountAsync`)

  const allOk = ok && probeOk && probe2Ok && probe3Ok && probe4Ok
    && probe5Ok && probe6Ok && probe7Ok && probe8Ok && probe9Ok && probe10Ok && probe11Ok
  console.log(`[selftest] ${allOk ? 'PASS' : 'FAIL'}`)
  return allOk ? 0 : 1
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
  let notStFiles = 0
  for (const file of scripts) {
    // 路径按**当前工作目录**解析：从别处调用容易写成 rp-workspace/tmp/… 而实际在仓库根 tmp/…
    if (!fs.existsSync(file)) {
      console.error(`\n[script] FATAL 找不到脚本文件：${file}`)
      console.error('         —— 路径按「当前工作目录」解析；例如卡脚本在仓库根 tmp/ 下时应写 ../tmp/t37-inject.js')
      process.exit(2)
    }
    const { aliases, paths, touchesSt, guarded } = readScriptAccesses(file)
    console.log(`\n=== ${file} ===`)
    console.log(`[script] 绑定别名：${aliases.join(', ') || '(无)'}；访问路径 ${paths.size} 条`)
    // L44 同型防线：**一条访问都没提出来 ≠ 全部具备**。此时按「是否出现 ST 上下文取法的名字」
    // 分成两个**确定**的结论（心跳 63C）——「不取 ctx」是可判定的，「不可判定」才是真边界。
    if (paths.size === 0) {
      if (!touchesSt) {
        notStFiles++
        console.log('  ✅ 已判定：该文件**不取** ST 上下文（全篇无 `SillyTavern`、无无参 `getContext()`）')
        continue
      }
      uninspected++
      console.log('  ⚠️ 不可判定：出现了 ST 上下文取法的名字，但提不出任何成员访问')
      console.log('     —— 成员访问大概发生在**调用方**（脚本把整个 ctx 转发出去）= 数据流边界（勿读成「已具备」）')
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
      console.log(`  ❌ 缺口 ${missing.length} 个（真 ST 有、我方**任意门面都无**）—— 这些是**还没撞到的墙**：`)
      for (const m of missing) {
        const g = guarded.has(m.head) ? '  ⚠️ 本文件有 typeof 守卫（缺它=静默降级，不抛）' : ''
        console.log(`     · ${m.head}  （访问 ${m.lines.length} 次，行 ${[...new Set(m.lines)].slice(0, 8).join('/')}）${g}`)
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
  console.log(`\n[surface] 结论：缺口 ${gaps} 个`)
  console.log(`[surface] 文件分账（共 ${scripts.length}）：已核验 ${judgedFiles} · 已判定不取 ctx ${notStFiles} · 不可判定 ${uninspected}`)
  console.log(`[surface] 覆盖率（已判定 / 全量）= ${judgedFiles + notStFiles} / ${scripts.length}`)
  if (uninspected > 0) {
    console.log(`[surface] ⚠️ 有 ${uninspected} 个文件「不可判定」——不要把它读成"已具备"（L44）`)
  }
  process.exit(gaps > 0 ? 1 : 0)
}

// 【心跳 63】只在**直接执行**时跑 main —— 被 import 时（T-46 分档工具复用本文件的解析器）
// 不得执行/退出。此前无守卫，`import` 会立刻 main() 并 process.exit，复用解析器被迫复制一份实现
// （两份实现必然漂移 → 正控测的不是同一份代码）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
