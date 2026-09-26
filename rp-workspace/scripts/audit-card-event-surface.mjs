#!/usr/bin/env node
/**
 * audit-card-event-surface.mjs — 一次性静态穷举（L43）：卡脚本注册的事件名 × 我方实际发射面
 * ============================================================================
 * 为什么需要它（缺陷族 = **静默失败**）：
 *   卡脚本写 `eventOn(tavern_events.MESSAGE_UPDATED, cb)` 时，我方 `tavern_events` 表**有**这个键
 *   （82 项全表），所以 `eventOn` **注册成功**、零报错、零 warn。
 *   但只要我方**从不 emit 那个事件名**，`cb` 就**永远不执行** —— 功能死了，日志干净。
 *   这与本项目主力缺陷族完全同型（T-41/T-51/T-54/T-65 都是"在册但从不生效"）。
 *
 * 之前的做法是"等卡报错"或"逐个心跳撞墙"——本工具改成**一次性静态穷举**：
 *   注册面 = 扫设备真实卡/预设语料里所有 `tavern_events.X` / `iframe_events.X` / `event_types.X`
 *            / `eventOn('literal')` / `eventSource.on('literal')` 的引用
 *   发射面 = 扫我方源码里出现的**事件值字面量**（剔除三张常量表自身的定义块）
 *   差集   = 「卡注册了、我方从不发」⇒ 候选静默失败项
 *
 * ⚠️ 判据口径（L36：跟基准一致"既不能少也不能多"）：
 *   差集**只是候选**，不等于"必须补"。每一项都要回基准取证「真 ST 到底会不会 emit」：
 *     · 基准有 emit ⇒ **真缺口**（要修）
 *     · 基准也没有 ⇒ 我方与基准一致，**登记为不补**
 *   本工具同时输出基准侧 emit 计数（`--st=<reference 根目录>`）以支撑该判定。
 *
 * 用法：
 *   node scripts/audit-card-event-surface.mjs [--corpus=<语料目录>] [--st=<ST reference 根>] [-v]
 *   node scripts/audit-card-event-surface.mjs --selftest      # 正控（含负控）
 *
 * 退出码：0 = 差集为 0；1 = 有差集（或 selftest 失败）
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_SRC = resolve(HERE, '../packages/src')
const CLIENT_DIR = join(PKG_SRC, 'dsht-rp-ui/src/client')
const DEFAULT_CORPUS = resolve(HERE, '../../stage3-device/hb63/corpus/js')
const DEFAULT_ST = process.env.ST_ROOT ?? ''

const argv = process.argv.slice(2)
const verbose = argv.includes('-v') || argv.includes('--verbose')
const selftest = argv.includes('--selftest')
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const CORPUS = argOf('corpus', DEFAULT_CORPUS)
const ST_REF = argOf('st', DEFAULT_ST)

// ---------------------------------------------------------------------------
// 1. 解析三张常量表（我方）
// ---------------------------------------------------------------------------

/** 从 TS 源码里抽 `export const NAME ... = { A: 'a', ... }` 形式的字符串映射表 */
export function parseStringMap(text, constName) {
  const re = new RegExp(`const\\s+${constName}\\b[^=]*=\\s*\\{`)
  const m = re.exec(text)
  if (m === null) return null
  const bodyStart = m.index + m[0].length
  // 找配对的顶层 `}`（列 0 起始，与仓库既有生成器同一判据）
  const lines = text.slice(bodyStart).split(/\r?\n/)
  const out = {}
  for (const line of lines) {
    if (/^\}/.test(line)) break
    const e = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'\s*,?\s*$/.exec(line)
    if (e !== null) out[e[1]] = e[2]
  }
  return out
}

/**
 * 解析 th-shim.ts 里 `var Mvu = { ... events: { NAME: 'value', ... } }` 的**事件名常量**。
 * 为什么需要第 4 张表（心跳 73 · T-81）：MVU 框架自带独立命名空间 `Mvu`（权威契约 =
 * `JS-Slash-Runner/@types/iframe/exported.mvu.d.ts`），卡同样在它上面注册事件
 * （`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)`）。原枚举器只扫三张 ST 表 ⇒ 整类**看不见**
 * （L44：枚举器的覆盖边界就是结论边界）。
 */
export function parseMvuEvents(text) {
  // ★ 体检 2026-09-26（P1-5②）修：解析器仍锚**旧形态**（常量内联在 `var Mvu = { … events: { … } }`
  //   里），而 th-shim.ts 重构后常量已搬出为**独立常量块** `var MVU_EVENT_CONSTANTS = { … }`
  //   （Mvu.events 里只剩 on/emit 函数）⇒ 实仓解析恒得 0 项，而 selftest 合成语料仍是旧形态
  //   ⇒ 自证与实仓脱钩（P-30 家族：判据死了输出同貌——本例由体检 B 分册撞破）。
  //   改锚**现役形态**（MVU_EVENT_CONSTANTS 常量块；权威语义不变：exported.mvu.d.ts 的 5 项）。
  //   判据只许收紧（B11）：不保留旧形态兼容 —— 旧形态若回来，实仓正控会当场报 0。
  const m = /var\s+MVU_EVENT_CONSTANTS\s*=\s*\{/.exec(text)
  if (m === null) return null
  const body = text.slice(m.index + m[0].length)
  const out = {}
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*\},?\s*$/.test(line)) break // 常量块结束（首个缩进收口到 2/0 的右花括号行）
    const e = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*'([^']*)'\s*,?\s*$/.exec(line)
    if (e !== null) out[e[1]] = e[2]
  }
  return out
}

export function loadTables() {
  const shim = readFileSync(join(CLIENT_DIR, 'th-shim.ts'), 'utf8')
  const gen = readFileSync(join(CLIENT_DIR, 'st-event-types.gen.ts'), 'utf8')
  return {
    tavern: parseStringMap(shim, 'TAVERN_EVENTS') ?? {},
    iframe: parseStringMap(shim, 'IFRAME_EVENTS') ?? {},
    eventTypes: parseStringMap(gen, 'ST_EVENT_TYPES') ?? {},
    // 第 4 张表：MVU 扩展命名空间（非 ST 表；权威源 = exported.mvu.d.ts）
    mvu: parseMvuEvents(shim) ?? {},
  }
}

// ---------------------------------------------------------------------------
// 2. 注册面抽取（语料）
// ---------------------------------------------------------------------------

/** 抽取一段源码里引用的「事件值」——返回 Map<eventValue, Set<常量名或字面量>> */
export function extractRegistrations(text, tables) {
  const found = new Map()
  const add = (value, how) => {
    if (typeof value !== 'string' || value.length === 0) return
    if (!found.has(value)) found.set(value, new Set())
    found.get(value).add(how)
  }
  const resolveConst = (tbl, name, how) => {
    const map = tables[tbl]
    if (Object.prototype.hasOwnProperty.call(map, name)) add(map[name], `${how}.${name}`)
    else add(`<UNKNOWN>${how}.${name}`, `${how}.${name}`)
  }
  for (const m of text.matchAll(/tavern_events\.([A-Za-z_][A-Za-z0-9_]*)/g)) resolveConst('tavern', m[1], 'tavern_events')
  for (const m of text.matchAll(/iframe_events\.([A-Za-z_][A-Za-z0-9_]*)/g)) resolveConst('iframe', m[1], 'iframe_events')
  // 两种真实形态都要支持：`event_types.X`（ST 内部全局）与 `ctx.eventTypes.X`（getContext 面，camelCase）
  for (const m of text.matchAll(/event_?[Tt]ypes\.([A-Za-z_][A-Za-z0-9_]*)/g)) resolveConst('eventTypes', m[1], 'eventTypes')
  // 第 4 命名空间：MVU（`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)`；语料实测的 `Mvu?.events?.X` 也覆盖）
  for (const m of text.matchAll(/Mvu\s*\??\.\s*events\s*\??\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) resolveConst('mvu', m[1], 'Mvu.events')
  // 字面量形态：eventOn('x') / eventOnce('x') / eventSource.on|once|makeFirst|makeLast('x')
  for (const m of text.matchAll(/(?:eventOn|eventOnce|eventSource\.(?:on|once|makeFirst|makeLast))\('([^']+)'/g)) {
    add(m[1], 'literal')
  }

  // ---- 形态 7：**动态别名绑定**（L44 覆盖边界；心跳 74 补） ----
  // 语料实测（示例预设 V17.1 `_示例卡乙_.js:55369`）：
  //     const te = getFn('tavern_events') || tavern_events
  //     const eo = getFn('eventOn')
  //     eo(te.PRESET_CHANGED, () => { ... })
  // 原枚举器只认 `tavern_events.X` 字面形态 ⇒ 这类**整批看不见**。
  // ⚠️ 旧版 `stage3-device/hb73/alias-event-census.mjs` 曾单独复刻过解析逻辑，但复刻版用对象展开
  //    建 `value→name` 映射，两表**同名键**（GENERATION_ENDED）互相覆盖 ⇒ 把"有发射"误报成"零发射"。
  //    本实现直接复用同一份 `tables`，无第二份拷贝。
  const aliasNs = new Map() // 标识符 → Set<表名>
  const NS_TOKENS = { tavern_events: 'tavern', iframe_events: 'iframe', event_types: 'eventTypes', eventTypes: 'eventTypes' }
  // 允许出现在「取表表达式」里的其它标识符。**白名单是必需的**：压缩产物是单行长文本，
  // 若只做「RHS 里出现表名」，`const l = ...200 字符...` 会把整批无关标识符误绑成别名
  // （心跳 74 实测：误产 43 个假"未知名"）。判据 = **RHS 剥掉字符串后，全部标识符都属白名单 ∪ 表名**。
  const ALLOWED_IDS = new Set([
    'getFn', 'ctx', 'window', 'parent', 'top', 'self', 'frames', 'globalThis', 'SillyTavern',
    'getContext', 'getTopWin', 'getSt', 'getScriptId', 'eventSource', 'document', 'true', 'false', 'null', 'undefined',
  ])
  const nsOf = (rhs) => {
    const stripped = rhs.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
    const ids = [...stripped.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0])
    if (ids.length === 0 || ids.length > 8) return new Set()
    const s = new Set()
    for (const id of ids) {
      const ns = NS_TOKENS[id]
      if (ns !== undefined) { s.add(ns); continue }
      if (!ALLOWED_IDS.has(id)) return new Set() // 出现非白名单标识符 ⇒ 不是"取表表达式"，放弃
    }
    return s
  }
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]{1,120})/g)) {
    const ns = nsOf(m[2])
    if (ns.size > 0) aliasNs.set(m[1], ns)
  }
  // 解构形态：`const { tavern_events: te } = ctx` / `const { eventTypes } = x`
  for (const m of text.matchAll(/\{([^{}]{0,160})\}\s*=\s*[^\n;]{0,120}/g)) {
    for (const part of m[1].split(',')) {
      const named = /^\s*(tavern_events|iframe_events|event_types|eventTypes)\s*:\s*([A-Za-z_$][\w$]*)\s*$/.exec(part)
      if (named !== null) { const ns = nsOf(named[1]); if (ns.size > 0) aliasNs.set(named[2], ns); continue }
      const bare = /^\s*(tavern_events|iframe_events|event_types|eventTypes)\s*$/.exec(part)
      if (bare !== null) { const ns = nsOf(bare[1]); if (ns.size > 0) aliasNs.set(bare[1], ns) }
    }
  }
  for (const [id, nsSet] of aliasNs) {
    const re = new RegExp(`\\b${id.replace(/\$/g, '\\$')}\\s*\\??\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, 'g')
    for (const m of text.matchAll(re)) {
      const name = m[1]
      let hit = false
      for (const ns of nsSet) {
        if (Object.prototype.hasOwnProperty.call(tables[ns], name)) { add(tables[ns][name], `${ns}~${id}`); hit = true }
      }
      if (!hit) {
        const ns = [...nsSet][0]
        add(`<UNKNOWN>${ns}~${id}.${name}`, `${ns}~${id}.${name}`)
      }
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// 3. 发射面抽取（我方源码）
// ---------------------------------------------------------------------------

/** 收集我方源码全部 .ts/.tsx 文本（剔除常量表所在文件，避免"表自己也算发射"的假绿） */
export function collectSourceTexts(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'lib') continue
      collectSourceTexts(full, acc)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    // 三张表自身 + 生成物不算发射面
    if (name === 'st-event-types.gen.ts') continue
    acc.push({ path: full, text: readFileSync(full, 'utf8') })
  }
  return acc
}

/** 剔除 th-shim.ts 里的 TAVERN_EVENTS / IFRAME_EVENTS 定义块（表定义 ≠ 发射） */
export function stripTableBlocks(text) {
  return text
    .replace(/export\s+const\s+TAVERN_EVENTS\b[^=]*=\s*\{[\s\S]*?\n\}/, '')
    .replace(/export\s+const\s+IFRAME_EVENTS\b[^=]*=\s*\{[\s\S]*?\n\}/, '')
    // 第 4 表：MVU 常量块（不剔除 ⇒ 常量值被当成"我方发射" = 假绿）。
    // ★ 体检 2026-09-26（P1-5②）：与 parseMvuEvents 同步改锚现役形态
    //   `var MVU_EVENT_CONSTANTS = { … }`（th-shim.ts:2339）—— 旧锚 `var Mvu = { … events: … }`
    //   在常量搬出后结构上再也匹配不到 ⇒ 剔除恒 no-op（幸而实仓该值也无发射路径，
    //   未造成假绿事故，但判据已死）。两处锚点必须同源同态（P-1）。
    .replace(/var\s+MVU_EVENT_CONSTANTS\s*=\s*\{[\s\S]*?\n\},?/, '')
}

/**
 * 剔除 JS/TS 注释（保留字符串与模板串内容）。
 *
 * 为什么必须做（**心跳 74 实测踩到，不是理论担忧**）：
 *   发射面的判据是 `text.includes("'value'")` / `` `value` ``，而**注释里写同样的字面量一样命中**
 *   ⇒ 一句「说明某事件」的注释会把**真缺口判成已覆盖**（**假绿**，正是本项目最忌讳的方向）。
 *   实测：给 `host-vendor.ts` 加一句含反引号 `settings_loaded_after` 的说明注释
 *   ⇒ 该事件的缺口当场从差集里消失（被算作"已发射"）—— 是本轮的自然实验揭出来的。
 *
 * 实现 = 单遍状态机（单/双引号、模板串、行注释、块注释）。
 * ⚠️ 正则字面量不做特殊处理：形如 `/'/` 的正则会让扫描器把后续当成字符串，极端情形可能**多剥一点**；
 *   方向是**多报缺口（保守）**而非漏报 —— 符合闸门的安全方向。模板串内的 `${}` 表达式按字符串原样保留
 *   （其内部注释不会被剥，同样偏保守）。
 */
export function stripComments(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const c2 = text[i + 1]
    if (c === '/' && c2 === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      out += c
      i++
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] ?? ''); i += 2; continue }
        out += text[i]
        if (text[i] === q) { i++; break }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 发射面 = 源码里出现的「事件值字面量」（**注释不算**，见 `stripComments`） */
export function extractEmissions(files, knownValues) {
  const emitted = new Map()
  for (const f of files) {
    const text = stripComments(stripTableBlocks(f.text))
    for (const value of knownValues) {
      // 以带引号的字面量形式出现即算（`'message_received'` / `"x"` / `` `x` ``）
      if (text.includes(`'${value}'`) || text.includes(`"${value}"`) || text.includes('`' + value + '`')) {
        if (!emitted.has(value)) emitted.set(value, new Set())
        emitted.get(value).add(f.path.replace(/\\/g, '/').split('/packages/src/')[1] ?? f.path)
      }
    }
  }
  return emitted
}

// ---------------------------------------------------------------------------
// 4. 基准侧 emit 取证（判「该不该补」的依据）
// ---------------------------------------------------------------------------

/** 在真 ST 基准源里找 `emit(event_types.NAME)` / `emit(event_types['name'])` 的出现次数 */
function stEmitCounts(stRef, names) {
  const dirs = [join(stRef, 'public')]
  const files = []
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const full = join(d, n)
      const st = statSync(full)
      if (st.isDirectory()) { if (n !== 'node_modules' && n !== 'lib') walk(full); continue }
      if (/\.(js|html|mjs)$/.test(n)) files.push(full)
    }
  }
  dirs.forEach(walk)
  const counts = new Map()
  for (const name of names) counts.set(name, 0)
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const [, ev] of text.matchAll(/emit\(\s*event_types\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const table = TABLES_CACHE.eventTypes
      if (Object.prototype.hasOwnProperty.call(table, ev) && counts.has(table[ev])) {
        counts.set(table[ev], counts.get(table[ev]) + 1)
      }
    }
  }
  return counts
}

let TABLES_CACHE = { tavern: {}, iframe: {}, eventTypes: {}, mvu: {} }

// ---------------------------------------------------------------------------
// 5. 正控 / 负控（L44：枚举器自身必须先过正控）
// ---------------------------------------------------------------------------

const FIXTURE_TABLE = {
  tavern: { MESSAGE_RECEIVED: 'message_received', MESSAGE_UPDATED: 'message_updated' },
  iframe: { GENERATION_ENDED: 'js_generation_ended' },
  eventTypes: { CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
  mvu: { VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended' },
}

function selftestRun() {
  const fails = []
  const ok = (cond, label) => { if (!cond) fails.push(label) }

  // ---- 注册面：六类形态都必须能识别 ----
  const regFixture = [
    "eventOn(tavern_events.MESSAGE_RECEIVED, cb)",
    "eventSource.on('message_updated', cb)",
    "eventOn(iframe_events.GENERATION_ENDED, cb)",
    "ctx.eventTypes.CHARACTER_MESSAGE_RENDERED",
    "eventOn('custom_thing', cb)",
    "eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)",
    "eventOn(Mvu?.events?.VARIABLE_UPDATE_ENDED, cb)", // 语料实测的可选链形态
    "eventOn(event, cb)", // 动态 → 不应产出具体事件名
  ].join('\n')
  const regs = extractRegistrations(regFixture, FIXTURE_TABLE)
  ok(regs.has('message_received'), '注册面: tavern_events.X 未识别')
  ok(regs.has('message_updated'), '注册面: eventSource.on 字面量未识别')
  ok(regs.has('js_generation_ended'), '注册面: iframe_events.X 未识别')
  ok(regs.has('character_message_rendered'), '注册面: event_types.X 未识别')
  ok(regs.has('custom_thing'), '注册面: eventOn 字面量未识别')
  ok(regs.has('mag_variable_update_ended'), '注册面: Mvu.events.X（第 4 命名空间）未识别')
  ok(regs.size === 6, `注册面: 动态实参不应产出事件名（实得 ${regs.size} 项：${[...regs.keys()].join(',')}）`)

  // ---- 注册面 · 形态 7：动态别名绑定（心跳 74） ----
  const aliasFixture = [
    "const te = getFn('tavern_events') || tavern_events",
    "const eo = getFn('eventOn')",
    "eo(te.MESSAGE_RECEIVED, cb)",
    "eo(te?.MESSAGE_UPDATED, cb)",
    "const { tavern_events: tv } = ctx",
    "tv.MESSAGE_RECEIVED",
    "const other = window.somethingElse",
    "other.MESSAGE_RECEIVED", // 负控：未绑定事件表 ⇒ 不应登记
  ].join('\n')
  const aregs = extractRegistrations(aliasFixture, FIXTURE_TABLE)
  ok(aregs.has('message_received'), '别名形态: `te.MESSAGE_RECEIVED` 未识别')
  ok(aregs.has('message_updated'), '别名形态: `te?.MESSAGE_UPDATED`（可选链）未识别')
  ok(aregs.size === 2, `别名形态: 未绑定事件表的标识符不应登记（实得 ${[...aregs.keys()].join(',')}）`)

  // ---- 发射面 · 真实源码正控（心跳 74：修掉"同名键互相覆盖 ⇒ 有发射被误报零发射"的假阳性） ----
  const realFiles = collectSourceTexts(PKG_SRC)
  const realKnown = new Set([
    ...Object.values(TABLES_CACHE.tavern), ...Object.values(TABLES_CACHE.iframe),
    ...Object.values(TABLES_CACHE.eventTypes), ...Object.values(TABLES_CACHE.mvu),
  ])
  const realEmit = extractEmissions(realFiles, realKnown)
  ok(realEmit.has('generation_ended'), '真实源码正控: `generation_ended` 应判为有发射（RpScriptHost.tsx:1038）')
  ok(realEmit.has('js_generation_ended'), '真实源码正控: `js_generation_ended` 应判为有发射（tavren/iframe 两表同名键不得互相覆盖）')

  // ---- 表解析：三张表条目数必须与仓库事实一致 ----
  ok(Object.keys(TABLES_CACHE.tavern).length === 82, `表解析: TAVERN_EVENTS 应 82 项，实得 ${Object.keys(TABLES_CACHE.tavern).length}`)
  ok(Object.keys(TABLES_CACHE.iframe).length === 6, `表解析: IFRAME_EVENTS 应 6 项，实得 ${Object.keys(TABLES_CACHE.iframe).length}`)
  ok(Object.keys(TABLES_CACHE.eventTypes).length === 104, `表解析: ST_EVENT_TYPES 应 104 项，实得 ${Object.keys(TABLES_CACHE.eventTypes).length}`)
  ok(Object.keys(TABLES_CACHE.mvu).length === 5, `表解析: Mvu.events 常量应 5 项（权威契约 exported.mvu.d.ts），实得 ${Object.keys(TABLES_CACHE.mvu).length}`)
  ok(TABLES_CACHE.mvu.VARIABLE_UPDATE_ENDED === 'mag_variable_update_ended', '表解析: Mvu.events.VARIABLE_UPDATE_ENDED 值应为 mag_variable_update_ended')

  // ---- 发射面：表定义块必须**不算**发射（否则整表自证 = 假绿） ----
  const tableText = "export const TAVERN_EVENTS: Record<string, string> = {\n  MESSAGE_UPDATED: 'message_updated',\n}\n"
  const stripped = stripTableBlocks(tableText)
  ok(!stripped.includes("'message_updated'"), '发射面: 表定义块未被剔除（会自证为已发射 = 假绿）')

  // ★ 体检 2026-09-26（P1-5②）：合成语料同步为**现役形态**（MVU_EVENT_CONSTANTS 独立常量块，
  //   与 th-shim.ts:2339 一致）—— 旧语料（常量内联 Mvu.events）正是解析器悄悄失效的共谋。
  const mvuTableText = "var MVU_EVENT_CONSTANTS = {\n  VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',\n  on: function () {},\n};\n"
  const strippedMvu = stripTableBlocks(mvuTableText)
  ok(!strippedMvu.includes("'mag_variable_update_ended'"), '发射面: Mvu.events 常量块未被剔除（会自证为已发射 = 假绿）')

  const emitFiles = [{ path: 'x/RpThing.ts', text: "emitSessionEvent('message_received', [1])" }]
  const emitted = extractEmissions(emitFiles, ['message_received', 'message_updated'])
  ok(emitted.has('message_received'), '发射面: 未识别 emitSessionEvent 调用')
  ok(!emitted.has('message_updated'), '发射面: 把未发射的事件判成已发射（负控失败）')

  // ---- 发射面 · **注释不算发射**（心跳 74：假绿来源，自然实验揭出） ----
  const commentOnly = [{ path: 'x/a.ts', text: "// 说明：本文件不发 `message_updated`\n/* 也不发 'message_updated' 与 \"message_updated\" */\n" }]
  const cmtEmit = extractEmissions(commentOnly, ['message_updated'])
  ok(!cmtEmit.has('message_updated'), '发射面: 注释/文档里提及事件值被算成"已发射"（假绿）')
  const withTrailing = [{ path: 'x/b.ts', text: "emitSessionEvent('message_received', [1]) // 对面是 'message_updated'\n" }]
  const trEmit = extractEmissions(withTrailing, ['message_received', 'message_updated'])
  ok(trEmit.has('message_received'), '发射面: 剥离注释时把真发射也剥掉了（过度剥离）')
  ok(!trEmit.has('message_updated'), '发射面: 行尾注释里的字面量被算成发射')
  const blockInline = [{ path: 'x/c.ts', text: "const a = 'message_received'\n/* 'message_updated' */\n" }]
  const blEmit = extractEmissions(blockInline, ['message_received', 'message_updated'])
  ok(blEmit.has('message_received') && !blEmit.has('message_updated'), '发射面: 块注释内联剥离错误')

  // ---- 端到端小场景：差集必须正好是 message_updated ----
  const known = ['message_received', 'message_updated']
  const missing = known.filter((v) => regs.has(v) && !emitted.has(v))
  ok(missing.length === 1 && missing[0] === 'message_updated', `差集口径错误：实得 [${missing.join(',')}]`)

  // ---- 基线白名单口径（正控 + 负控）----
  const base = { known: { message_updated: {} } }
  const r1 = classify(['message_updated'], base)
  ok(r1.newGaps.length === 0 && r1.closed.length === 0, '白名单: 缺集==基线时应无新缺口、无收敛项')

  const r2 = classify(['message_updated', 'brand_new_gap'], base)
  ok(r2.newGaps.length === 1 && r2.newGaps[0] === 'brand_new_gap', '白名单负控: 表外新缺口未被识别为红线')

  const r3 = classify([], base)
  ok(r3.closed.length === 1 && r3.closed[0] === 'message_updated', '白名单: 已修项未被识别为可移除')

  if (fails.length > 0) {
    console.error('✗ --selftest 失败：')
    for (const f of fails) console.error(`   · ${f}`)
    return 1
  }
  console.log('✓ --selftest 通过（注册面 7 形态（含动态别名绑定）/ 表解析 82·6·104·5 / 表定义剔除 / 发射面 注释剔除+负控 / 差集口径 / 基线白名单正负控）')
  return 0
}

/** 差集 × 基线 → 新缺口（红线）/ 已收敛（可从基线移除） */
export function classify(missing, baseline) {
  const knownMap = baseline?.known ?? {}
  const knownKeys = new Set(Object.keys(knownMap))
  const missingSet = new Set(missing)
  return {
    newGaps: missing.filter((v) => !knownKeys.has(v)),
    closed: [...knownKeys].filter((v) => !missingSet.has(v)),
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 直接执行判定（用于让本文件可被其它工具 import 复用解析与发射面 —— 单一权威，避免两份拷贝漂移）。
 * 例：`stage3-device/hb73/alias-event-census.mjs` 复用 `loadTables` / `collectSourceTexts` /
 * `extractEmissions` / `stripTableBlocks`。若不做这层保护，import 会执行主流程并 `process.exit`。
 */
const isMain = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url) } catch { return false }
})()

TABLES_CACHE = loadTables()

// ⚠️ 本块保留原缩进（一次性加壳，避免无关 diff 干扰 review）。
if (isMain) {
if (selftest) process.exit(selftestRun())

console.log('=== 卡事件面审计（一次性静态穷举 / L43）===')
console.log(`我方表：tavern_events ${Object.keys(TABLES_CACHE.tavern).length} · iframe_events ${Object.keys(TABLES_CACHE.iframe).length} · event_types ${Object.keys(TABLES_CACHE.eventTypes).length} · Mvu.events ${Object.keys(TABLES_CACHE.mvu).length}`)

if (!existsSync(CORPUS)) {
  console.error(`\n✗ 语料目录不存在：${CORPUS}`)
  console.error('  语料是「设备上真实卡/预设的脚本」，属 gitignore 产物（stage3-device/）。')
  console.error('  取法：用 stage3-device/hb63/extract-corpus.mjs 从设备导出，或 --corpus=<目录> 指定。')
  process.exit(2)
}

const corpusFiles = []
for (const n of readdirSync(CORPUS)) {
  const full = join(CORPUS, n)
  if (statSync(full).isFile() && n.endsWith('.js')) corpusFiles.push(full)
}

const byValue = new Map() // eventValue -> Set<file>
for (const f of corpusFiles) {
  const regs = extractRegistrations(readFileSync(f, 'utf8'), TABLES_CACHE)
  for (const [value, hows] of regs) {
    if (!byValue.has(value)) byValue.set(value, { files: new Set(), hows: new Set() })
    byValue.get(value).files.add(f.split(/[\\/]/).pop() ?? f)
    for (const h of hows) byValue.get(value).hows.add(h)
  }
}

const sourceFiles = collectSourceTexts(PKG_SRC)
const knownValues = new Set()
for (const v of Object.values(TABLES_CACHE.tavern)) knownValues.add(v)
for (const v of Object.values(TABLES_CACHE.iframe)) knownValues.add(v)
for (const v of Object.values(TABLES_CACHE.eventTypes)) knownValues.add(v)
for (const v of Object.values(TABLES_CACHE.mvu)) knownValues.add(v)
const emitted = extractEmissions(sourceFiles, knownValues)
/** 基准 ST 事件表的值集合（用于区分「基准也无 emit」与「属扩展命名空间」） */
const ST_EVENT_VALUES = new Set(Object.values(TABLES_CACHE.eventTypes))

const registered = [...byValue.keys()].filter((v) => !v.startsWith('<UNKNOWN>'))
const unknownConsts = [...byValue.keys()].filter((v) => v.startsWith('<UNKNOWN>'))
const missing = registered.filter((v) => !emitted.has(v)).sort()

console.log(`语料：${corpusFiles.length} 个脚本文件 · 注册到 ${registered.length} 个事件值（另有 ${unknownConsts.length} 个我方表里没有的常量）`)
console.log(`我方发射面：${emitted.size} 个事件值\n`)

if (unknownConsts.length > 0) {
  console.log(`⚠ 我方事件表**缺这些常量**（卡引用它们 ⇒ 值恒 undefined ⇒ 注册到 undefined 键）：`)
  for (const v of unknownConsts) console.log(`   · ${v.slice(9)}  ← ${[...byValue.get(v).files].slice(0, 3).join(', ')}`)
  console.log('')
}

const BASELINE_PATH = join(HERE, 'card-event-surface-baseline.json')
let baseline = { known: {} }
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch (e) {
    console.error(`✗ 基线文件无法解析：${BASELINE_PATH}\n  ${e.message}`)
    process.exit(2)
  }
}
const { newGaps, closed } = classify(missing, baseline)
const knownMap = baseline.known ?? {}

if (missing.length === 0) {
  console.log('✓ 差集为 0：卡注册的每个事件都有发射点')
  process.exit(0)
}

console.log(`差集 ${missing.length} 项（基线内 ${missing.length - newGaps.length} · **表外新增 ${newGaps.length}**）\n`)
console.log('明细（✗ = 表外新增，红线；· = 基线内已知）：')
let counts = null
if (existsSync(ST_REF)) {
  counts = stEmitCounts(ST_REF, missing)
}
for (const v of missing) {
  const info = byValue.get(v)
  const isNew = newGaps.includes(v)
  const meta = knownMap[v] ?? {}
  const stN = counts === null ? '?' : counts.get(v)
  // ⚠️ `stEmitCounts` 会把**所有**待判名初始化为 0 ⇒ 不能用 `stN === undefined` 判"是否属 ST 事件表"，
  // 必须按**基准事件表成员资格**判；否则会把「扩展命名空间（MVU），需另找权威源」误报成「基准也无 emit ⇒ 与基准一致」。
  const isStEvent = ST_EVENT_VALUES.has(v)
  const verdict = counts === null ? ''
    : !isStEvent ? '属扩展命名空间（不在基准 ST 事件表内；权威源 = JS-Slash-Runner @types）'
      : stN > 0 ? `基准 emit ×${stN}` : '基准也无 emit ⇒ 与基准一致'
  console.log(`   ${isNew ? '✗' : '·'} ${v}${meta.task ? `  [${meta.task}${meta.bucket ? ' / ' + meta.bucket : ''}]` : ''}`)
  console.log(`       语料：${[...info.files].map((f) => f.replace(/\.js$/, '').slice(0, 44)).slice(0, 2).join(' | ')}${info.files.size > 2 ? ` …(+${info.files.size - 2})` : ''}`)
  if (verdict !== '') console.log(`       基准：${verdict}`)
  if (meta.reason) console.log(`       原因：${meta.reason}`)
}
if (closed.length > 0) {
  console.log(`\n✓ 已收敛 ${closed.length} 项（基线里还留着，请从 ${BASELINE_PATH.split(/[\\/]/).pop()} 删除）：`)
  for (const v of closed) console.log(`   · ${v}`)
}
if (verbose) {
  console.log('\n[已覆盖]：' + registered.filter((v) => emitted.has(v)).sort().join(', '))
}

if (newGaps.length > 0) {
  console.log(`\n✗ 出现 ${newGaps.length} 项**基线外新缺口** ⇒ 卡新增了「注册了但永不触发」的事件（静默失败族）。`)
  console.log('   要么补发射点，要么在基线里显式登记原因（不要静默放过）。')
  process.exit(1)
}
console.log('\n✓ 差集全部落在基线内（无新增缺口）')
process.exit(0)
} // end if (isMain)
