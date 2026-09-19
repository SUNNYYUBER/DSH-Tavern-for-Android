/**
 * T2.3 MVU 状态链路（M2 剩余核心缺口：状态写入/存储/重放此前未做）。
 *
 * 三部分纯函数（可单测）：
 * - parseUpdateVariable：从 assistant 消息提取 `<UpdateVariable>` 块内的更新指令。
 *   【实机审计修复 2026-09-05】真实 MVU 卡（ExampleGame ExampleWorld 运行日志取证）每楼更新是
 *   `<UpdateVariable>` 块，三种来源共存解析，统一返回 StatePatch[]：
 *     1) `<JSONPatch>` 数组（示例预设 V8.8 实证；op 补 move/copy/insert，兼容裸块与 op=delta）
 *     2) `<initvar>` YAML 树（初始化变量；parseYamlLite 轻量解析 → 叶子路径 set 型补丁，
 *        传入 state 时顶层键缺失 → add，否则 replace）
 *     3) `_.set(path,val)` / `_.add(path,num)` / `_.inc` / `_.dec` 指令行（点号路径 → JSONPointer，
 *        容忍全角括号/引号/空格；add/inc/dec → delta 增量）
 * - applyStatePatches：JSONPointer 路径（`/云梦璃/好感度`）逐层建对象/数组应用补丁
 *   （move=摘下再挂、copy=深拷贝复制、insert=数组按 index 插入）
 * - renderStateSummary：状态树扁平化为模型友好摘要（`云梦璃.好感度: 3`），供组装层 stateSummary 槽位注入
 */

import { deepMergeExistingClone } from '../dsht-plugin-shared/deep-merge.ts'
// 【F5 2026-09-14 单源化】JSONPointer 段编解码下沉共享层（见下方 decodeSeg 注释）
import { decodePointerSeg as decodeSeg, encodePointerSeg as encodeSeg } from '../dsht-plugin-shared/json-pointer.ts'
import { stripMatchingQuotes } from '../dsht-plugin-shared/text-normalize.ts'

/** JSONPatch 操作（ST 酒馆助手/MVU 常用子集 + delta 增量 + move/copy/insert） */
export type StatePatchOp = 'add' | 'replace' | 'remove' | 'delta' | 'move' | 'copy' | 'insert'

export interface StatePatch {
  op: StatePatchOp
  /** JSONPointer 路径：/云梦璃/好感度（空段跳转） */
  path: string
  /** move/copy 的来源路径（JSONPointer） */
  from?: string
  value?: unknown
}

/** 合法 op 白名单（StatePatchOp 全集）——【鲁棒轮 2026-09-09】未知 op（如标准 JSON Patch
 *  的 "test"、模型拼错的 "apend"）静默落入 applyStatePatches 兜底赋值分支 = 校验型 op 变
 *  真实写（实测 "test" 把好感度置 null）。白名单外丢弃。 */
const STATE_PATCH_OPS: ReadonlySet<string> = new Set([
  'add', 'replace', 'remove', 'delta', 'move', 'copy', 'insert',
])

/** 从文本提取 JSONPatch 数组（宽松解析：坏 JSON 返回 [] 不崩）。
 *  【鲁棒轮 2026-09-09】matchAll 合并全部块——原实现 match 单次匹配，单块内/块外多个
 *  <JSONPatch> 只解析第一个，其余静默丢失（MVU 变量更新不生效且无日志）。 */
export function parseJsonPatches(text: string): StatePatch[] {
  const blocks: string[] = []
  for (const m of text.matchAll(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/gi)) blocks.push(m[1])
  if (blocks.length === 0) return []
  const out: StatePatch[] = []
  for (const body of blocks) {
    try {
      const arr = JSON.parse(body)
      if (!Array.isArray(arr)) continue
      for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue
        const p = raw as Record<string, unknown>
        const opRaw = p.op === undefined ? 'add' : String(p.op).toLowerCase()
        if (!STATE_PATCH_OPS.has(opRaw)) continue
        const op = opRaw as StatePatchOp
        let path = String(p.path ?? '')
        // 【实机审计修复 2026-09-05】insert=数组按 index 插入：index 字段并入 path（/list + index 1 → /list/1）
        if (op === 'insert' && typeof p.index === 'number' && Number.isInteger(p.index) && !/\/\d+$/.test(path)) {
          path = `${path.replace(/\/+$/, '')}/${p.index}`
        }
        out.push({
          op,
          path,
          ...(p.from !== undefined ? { from: String(p.from) } : {}),
          ...(p.value !== undefined ? { value: p.value } : {}),
        })
      }
    } catch {
      /* 坏 JSON 块跳过（宽松语义不变），继续解析其余块 */
    }
  }
  return out.filter(p => p.path.length > 0)
}

/**
 * 【实机审计修复 2026-09-05】从 assistant 消息全文提取全部 UpdateVariable 补丁
 * （多个块合并；块内三种来源共存解析：initvar YAML 树 / _.set 系指令行 / JSONPatch 子块；
 * 块外裸 JSONPatch 兜底；可选传入当前 state 供 initvar 判定顶层键 add/replace）。
 *
 * ⚠️【T-19 2026-09-11】**本函数有一份必须手工同步的镜像**：脚本 iframe 的 shim
 * （`dsht-rp-ui/src/client/th-shim.ts` 的 `dshtParseUpdateVariable`）。shim 是**构建期
 * 注入的字符串**（`buildShimSource` 模板串），没有 import 能力，无法共享本模块——
 * 两侧各写一份是硬约束。改这里（或改那边）时**必须同步另一侧**，否则 iframe 内卡脚本
 * 看到的解析结果与宿主引擎分叉（曾因此漏掉 initvar/_.set 两类来源）。
 * 差分测试：`tests/th-script-runtime.spec.ts` 的「Mvu.parseMessage 与 state/mvu.ts 差分」。
 */
export function parseUpdateVariable(text: string, state?: Record<string, unknown>): StatePatch[] {
  const out: StatePatch[] = []
  // 单块全来源解析（JSONPatch 正则只命中 <JSONPatch> 子块，互不干扰）
  const parseAll = (src: string): void => {
    out.push(...parseJsonPatches(src))
    out.push(...parseInitVarPatches(src, state))
    out.push(...parseUnderscoreCommands(src))
  }
  const re = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi
  let m: RegExpExecArray | null
  const covered: Array<[number, number]> = []
  while ((m = re.exec(text)) !== null) {
    parseAll(m[1])
    covered.push([m.index, re.lastIndex])
  }
  // 裸 <JSONPatch>（不在 UpdateVariable 内）：在覆盖区间之外的文本上解析，避免与块内重复
  const outside = covered.reduce((acc, [, _e], i) => {
    const start = i === 0 ? 0 : covered[i - 1][1]
    acc += text.slice(start, covered[i][0])
    return acc
  }, '') + (covered.length > 0 ? text.slice(covered[covered.length - 1][1]) : '')
  if (covered.length === 0) {
    parseAll(text)
  } else if (outside.length > 0) {
    out.push(...parseJsonPatches(outside))
  }
  return out
}

/* 【F5 2026-09-14 单源化·补漏】`encodeSeg` 原本是本地函数体（与共享层
 * `encodePointerSeg` 逐字相同）——编解码是一对，只收口 decode 侧不完整
 * （P-1b：复制即必然漂移；转义顺序错会让变量写到错误路径）。
 * 现改为 import 共享层（见文件顶部 import 的 as 别名）。 */

/** 宽松取值解析：JSON.parse 成功即用（数字/bool/null/数组/对象），否则去引号按字符串 */
function parseLooseValue(s: string): unknown {
  const t = stripQuotes(s)
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

/** 去包裹引号（半角单双引号与全角弯引号）
 *  【F5 2026-09-14 单源化·补漏】原为本地函数体 `stripQuotes`，与
 *  `dsht-plugin-memory/tables.ts` 的 `stripArgQuotes` **逐字相同**（审计脚本判据 4
 *  「不同名但函数体逐字相同」抓到）——引号口径属文本解析判据，一处补全角另一处没补
 *  即行为不一致。现委托共享层；本地名 `stripQuotes` 保留（本文件 4 处调用点）。 */
const stripQuotes = stripMatchingQuotes

/** 引号感知的顶层逗号切分（半角/全角逗号；引号内逗号不切） */
function splitTopLevelArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === '“') { q = '”'; cur += ch; continue }
    if (ch === ',' || ch === '，') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur)
  return out
}

/** 点号路径 → JSONPointer（stat_data.好感度 → /stat_data/好感度；已是 / 开头则原样） */
function dotToPointer(dotPath: string): string {
  const p = stripQuotes(dotPath)
  if (!p) return ''
  if (p.startsWith('/')) return p
  const segs = p.split('.').map(s => s.trim()).filter(Boolean).map(encodeSeg)
  return segs.length > 0 ? `/${segs.join('/')}` : ''
}

/**
 * 【实机审计修复 2026-09-05】_.set/_.add/_.inc/_.dec 指令行解析（真实 MVU 卡运行日志实证：
 * 指令直接写在 <UpdateVariable> 内；点号路径；容忍全角括号/引号/空格/行尾分号）。
 * set → replace；add/inc/dec → delta 增量（inc 默认 +1、dec 默认 -1，第二参数可覆盖步长）。
 */
export function parseUnderscoreCommands(text: string): StatePatch[] {
  const out: StatePatch[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*_\s*\.\s*(set|add|inc|dec)\s*[（(](.*)[)）]\s*;?\s*$/.exec(line.trim())
    if (!m) continue
    const kind = m[1].toLowerCase()
    const args = splitTopLevelArgs(m[2]).map(s => s.trim()).filter(s => s !== '')
    if (args.length === 0) continue
    const path = dotToPointer(args[0])
    if (!path) continue
    if (kind === 'set' || kind === 'add') {
      if (args.length < 2) continue
      out.push({ op: kind === 'set' ? 'replace' : 'delta', path, value: parseLooseValue(args.slice(1).join(',')) })
    } else {
      const step = args.length >= 2 ? Number(stripQuotes(args[1])) : 1
      const n = Number.isFinite(step) ? step : 1
      out.push({ op: 'delta', path, value: kind === 'inc' ? n : -n })
    }
  }
  return out
}

/**
 * 【实机审计修复 2026-09-05】<initvar> YAML 树 → set 型补丁序列（每条叶子路径 op:'replace'；
 * 传入 state 且顶层键不存在则 'add'——initvar 的初始化语义）。数组子树整体作为叶
 * （与 flattenState 的数组口径一致）。
 */
function parseInitVarPatches(src: string, state?: Record<string, unknown>): StatePatch[] {
  const out: StatePatch[] = []
  for (const m of src.matchAll(/<initvar[^>]*>([\s\S]*?)<\/initvar>/gi)) {
    const tree = parseYamlLite(m[1])
    if (!tree) continue
    for (const [top, sub] of Object.entries(tree)) {
      const op: StatePatchOp = state && !(top in state) ? 'add' : 'replace'
      const path = `/${encodeSeg(top)}`
      if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) {
        out.push({ op, path, value: sub })
        continue
      }
      const leaves = flattenYamlLeaves(sub as Record<string, unknown>, path, op)
      if (leaves.length === 0) out.push({ op, path, value: {} })
      else out.push(...leaves)
    }
  }
  return out
}

/** initvar 树叶子展开（嵌套对象递归；叶子 = 标量/数组；顶层键的 add/replace 判定向下传递） */
function flattenYamlLeaves(obj: Record<string, unknown>, prefix: string, op: StatePatchOp): StatePatch[] {
  const out: StatePatch[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = `${prefix}/${encodeSeg(k)}`
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenYamlLeaves(v as Record<string, unknown>, path, op))
    } else {
      out.push({ op, path, value: v })
    }
  }
  return out
}

/** initvar 叶值解析：能 JSON.parse 就解析（数字/bool/null/数组），否则去引号/原样字符串 */
function parseYamlValue(raw: string): unknown {
  const v = raw.trim()
  const quoted = stripQuotes(v)
  if (quoted !== v) return quoted
  try {
    return JSON.parse(v)
  } catch {
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    if (v === 'true') return true
    if (v === 'false') return false
    if (v === 'null' || v === '~') return null
    return v
  }
}

/**
 * 【实机审计修复 2026-09-05】轻量 YAML 树解析（initvar 用）：`key: value` 缩进嵌套
 * （容忍全角冒号）；值能 JSON.parse 就解析；数组支持一层 `- item` 行；# 注释行/--- 跳过。
 * 空文本返回 null；空值键无子行 → 空对象占位。
 */
export function parseYamlLite(src: string): Record<string, unknown> | null {
  const lines = src.split(/\r?\n/)
    .map(l => l.replace(/\t/g, '  '))
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('#') && t !== '---'
    })
  if (lines.length === 0) return null
  const root: Record<string, unknown> = {}
  // 容器栈（indent 为该容器对应键的缩进）；pending = 空值键，等下一行决定子对象还是数组
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }]
  let pending: { indent: number; container: Record<string, unknown>; key: string } | null = null
  let curArr: { indent: number; arr: unknown[] } | null = null
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    const t = line.trim()
    if (curArr && indent < curArr.indent) curArr = null
    // 先解决挂起的空值键：更深的行 → 子对象或数组；否则空对象占位
    if (pending) {
      if (indent > pending.indent) {
        if (t.startsWith('- ')) {
          const arr: unknown[] = []
          pending.container[pending.key] = arr
          curArr = { indent, arr }
          const item = t.slice(2).trim()
          if (item) arr.push(parseYamlValue(item))
          pending = null
          continue
        }
        const child: Record<string, unknown> = {}
        pending.container[pending.key] = child
        stack.push({ indent: pending.indent, obj: child })
        pending = null
      } else {
        pending.container[pending.key] = {}
        pending = null
      }
    }
    if (t.startsWith('- ')) {
      if (curArr && indent >= curArr.indent) {
        const item = t.slice(2).trim()
        if (item) curArr.arr.push(parseYamlValue(item))
      }
      continue
    }
    // key: value（首个冒号为分隔，值内冒号保留）
    const ci = t.search(/[:：]/)
    if (ci < 0) continue
    const key = t.slice(0, ci).trim().replace(/^["'“]|["'”]$/g, '')
    const rawVal = t.slice(ci + 1).trim()
    if (!key) continue
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const top = stack[stack.length - 1].obj
    if (rawVal === '') {
      pending = { indent, container: top, key }
      continue
    }
    top[key] = parseYamlValue(rawVal)
  }
  if (pending) pending.container[pending.key] = {}
  return root
}

/** JSONPointer 段解码：`~1`→`/`、`~0`→`~`
 *  【F5 2026-09-14 单源化】下沉到 dsht-plugin-shared/json-pointer.ts
 *  （此前 tavern-helper / 本文件 / macros.ts 三处各一份；转义顺序错了会静默写错位置）。 */

/**
 * 应用补丁（逐层建对象/数组索引）。
 * - delta：数值增量（浮点安全：先转数字，不可数则按 replace 处理）
 * - remove：删除 key（数组 + 数字尾段 = 按下标删除）
 * - add/replace：赋值
 * - 【实机审计修复 2026-09-05】move：摘下 from 子树挂到 path（JSON Patch 语义）；
 *   copy：from 子树深拷贝到 path；insert：数组按 path 尾段 index 插入（越界 = 追加表尾）；
 *   路径中间段为数字且目标缺失时建数组（否则建对象）。
 */
export function applyStatePatches(state: Record<string, unknown>, patches: StatePatch[]): Record<string, unknown> {
  const next = structuredClone(state)
  const segsOf = (path: string) => path.split('/').filter(s => s.length > 0).map(decodeSeg)
  const readAt = (segs: string[]): unknown => {
    let cur: unknown = next
    for (const seg of segs) {
      if (cur === null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
    return cur
  }
  const deleteAt = (segs: string[]): void => {
    const parent = readAt(segs.slice(0, -1))
    if (parent === null || typeof parent !== 'object') return
    const last = segs[segs.length - 1]
    if (Array.isArray(parent) && /^\d+$/.test(last)) {
      const i = Number(last)
      if (i >= 0 && i < parent.length) parent.splice(i, 1)
    } else {
      delete (parent as Record<string, unknown>)[last]
    }
  }
  // 定位目标父容器（create=true 时逐层补建；下一段是数字 → 补建数组，否则对象）
  const parentOf = (segs: string[], create: boolean): { parent: Record<string, unknown> | unknown[] | undefined; last: string } => {
    let cur: Record<string, unknown> | unknown[] = next
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      const wantArr = /^\d+$/.test(segs[i + 1])
      const holder = cur as Record<string, unknown>
      const existing = holder[seg]
      if (create && (existing === undefined || existing === null || typeof existing !== 'object')) {
        holder[seg] = wantArr ? [] : {}
      }
      const child = holder[seg]
      if (child === undefined || child === null || typeof child !== 'object') return { parent: undefined, last: '' }
      cur = child as Record<string, unknown> | unknown[]
    }
    return { parent: cur, last: segs[segs.length - 1] }
  }
  for (const p of patches) {
    const segs = segsOf(p.path)
    if (segs.length === 0) continue
    if (p.op === 'move' || p.op === 'copy') {
      const fromSegs = segsOf(p.from ?? '')
      if (fromSegs.length === 0) continue
      const val = readAt(fromSegs)
      if (val === undefined) continue
      if (p.op === 'move') deleteAt(fromSegs)
      const { parent, last } = parentOf(segs, true)
      if (parent === undefined) continue
      // copy 语义 = 深拷贝（避免后续补丁经共享引用改到源子树）；move 直接挂引用
      ;(parent as Record<string, unknown>)[last] = p.op === 'copy' ? structuredClone(val) : val
      continue
    }
    const { parent, last } = parentOf(segs, true)
    if (parent === undefined) continue
    if (p.op === 'remove') {
      if (Array.isArray(parent) && /^\d+$/.test(last)) {
        const i = Number(last)
        if (i >= 0 && i < parent.length) parent.splice(i, 1)
      } else {
        delete (parent as Record<string, unknown>)[last]
      }
    } else if (p.op === 'delta') {
      const prev = (parent as Record<string, unknown>)[last]
      const prevNum = typeof prev === 'number' ? prev : Number(prev)
      const addNum = Number(p.value)
      ;(parent as Record<string, unknown>)[last] = Number.isFinite(prevNum) && Number.isFinite(addNum) ? prevNum + addNum : p.value
    } else if (p.op === 'insert') {
      if (Array.isArray(parent)) {
        const idx = /^\d+$/.test(last) ? Math.min(Number(last), parent.length) : parent.length
        parent.splice(idx, 0, p.value)
      } else {
        ;(parent as Record<string, unknown>)[last] = p.value // 非数组目标退化为赋值
      }
    } else {
      // 【鲁棒轮 2026-09-09】数组父容器钳制下标——原实现 arr[5]='x' 直写越界产生稀疏
      // 空洞（JSON 落盘变 null 槽位，状态树污染、flattenState 喂 null 给模型）。
      // add/replace 对数组：越界 replace 跳过；越界 add 追加尾部（JSON Patch 语义宽松化）。
      if (Array.isArray(parent) && /^\d+$/.test(last)) {
        const i = Number(last)
        if (i >= parent.length) {
          if (p.op === 'add') parent.push(p.value)
          continue
        }
        parent[i] = p.value
      } else {
        ;(parent as Record<string, unknown>)[last] = p.value
      }
    }
  }
  return next
}

/** 状态树扁平化（递归；叶值字符串化）——模型友好摘要 */
export function flattenState(state: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of Object.entries(state)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenState(v as Record<string, unknown>, key))
    } else if (Array.isArray(v)) {
      out.push([key, JSON.stringify(v)])
    } else {
      out.push([key, String(v)])
    }
  }
  return out
}

/** 渲染状态摘要（供 stateSummary 槽位 / getvar 宏上下文） */
export function renderStateSummary(state: Record<string, unknown>): string {
  const rows = flattenState(state)
  if (rows.length === 0) return ''
  return ['【角色状态（MVU 变量树，最新优先）】', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n')
}

/**
 * 【心跳 47 修复 / T-35 收敛 2026-09-11】深合并「开局变量」
 * （D1 MVU initvar / B12 预载世界书）到既有变量树。
 *
 * **语义：存量优先——只补缺口，绝不覆盖已有叶值。**
 * 这不是可选的风格问题，而是 initvar 幂等账成立的前提：
 * 世界书内容一变 `mvuInitHash` 就不匹配，本函数会被**重放**；若它覆盖存量，
 * 玩家已经跑出来的进度会被世界书声明的初始值打回原形（= 一改世界书就回档）。
 *
 * 规则（= **families-B**：`existing` 恒胜）：
 * - 两边都是普通对象 → 递归合并（只有这样才可能"补"到深层缺口）
 * - 其余（数组 / 标量 / 类型不一致 / 任一侧为 null）→ 保留存量
 * - 存量缺该键 → 取 init 值，且**深拷贝**（init 树被多处复用，共享引用会被下游就地改写污染）
 * - 不修改任何入参（纯函数）
 *
 * 【T-35】原为本项目第 4 份独立 deep-merge 实现。现收敛到
 * `dsht-plugin-shared/deep-merge.ts:deepMergeExistingClone`（单实现源），此处仅保留对外名。
 *
 * ⚠️ **不要**把它与 `th-shim.ts:deepMergeInsert` 合一：两者合并**结果形状**相同，
 * 但引用语义不同（`deepMergeInsert` 共享 `incoming` 子树，本函数深拷贝）。
 * 差异由 `tests/deep-merge.spec.ts` 显式钉住。
 */
export const deepMergeInitVars = deepMergeExistingClone
