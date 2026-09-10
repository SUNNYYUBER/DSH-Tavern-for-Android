/**
 * 版本比较（纯函数，零依赖）——T-27「检查更新」的判定内核。
 *
 * 为什么单独成模块：
 * - 服务端（`dsh-plugin` 的 /rp/check-update）与客户端（`dsht-rp-ui` 的更新面板）
 *   都要用同一套判定，两份实现必然漂移 → 抽成**唯一**实现，两侧共同 import。
 * - 必须零依赖：客户端 bundle 会把它打进浏览器产物，不能牵入 schemastery 等 node 侧包。
 *
 * 语义（**宽松 semver**，面向"人类填的版本号"而非严格 spec）：
 * - 容忍前缀 `v` / `V`（`v0.2.0`）与构建元数据（`0.2.0+build.7` → 忽略 `+` 之后）；
 * - 段数不齐时**缺位补 0**（`0.2` == `0.2.0`）——现实中大量 tag 这么写；
 * - 预发布（`-alpha.1`）**小于**同号正式版（`0.2.0-alpha.1` < `0.2.0`），
 *   这正是"当前是预发布、正式版已出"要能识别成"有新版本"的关键；
 * - 核心段必须全是数字，否则判 `invalid` —— **绝不猜**（猜错的后果是提示用户"已是最新"，
 *   属于本项目最忌讳的静默失败）。解析不了就如实说解析不了。
 */

export type VersionRelation = 'newer' | 'same' | 'older' | 'invalid'

export interface ParsedVersion {
  /** 三段核心号；缺位补 0 */
  core: [number, number, number]
  /** 预发布标识符；空数组 = 正式版 */
  pre: Array<string | number>
  /** 规范化后的字符串（回显用） */
  normalized: string
}

const CORE_RE = /^\d+(?:\.\d+)*$/
const IDENT_RE = /^[0-9A-Za-z-]+$/

/**
 * 解析版本字符串。**失败返回 null**（不抛异常）——调用方需显式处理，
 * 不允许"解析失败就当相等"这种静默兜底。
 */
export function parseVersion(raw: unknown): ParsedVersion | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (s === '') return null
  // 前缀 v/V
  if (s[0] === 'v' || s[0] === 'V') s = s.slice(1)
  // 构建元数据 +xxx 一律忽略
  const plus = s.indexOf('+')
  if (plus >= 0) s = s.slice(0, plus)
  // 预发布 -xxx（只按**首个** `-` 切：`1.0.0-alpha-1` 的 pre = `alpha-1`）
  let preRaw = ''
  let hadDash = false
  const dash = s.indexOf('-')
  if (dash >= 0) {
    hadDash = true
    preRaw = s.slice(dash + 1)
    s = s.slice(0, dash)
  }
  if (s === '' || !CORE_RE.test(s)) return null
  // `1.0.0-` 这种悬挂分隔符是畸形输入，不当作合法版本
  if (hadDash && preRaw === '') return null
  const parts = s.split('.').map(n => Number(n))
  // 宽容度上限：允许"多写一段"（1.2.3.4 截为 1.2.3），再长即视为非版本号
  if (parts.length > 4) return null
  if (!parts.every(n => Number.isFinite(n) && n >= 0)) return null
  const core: [number, number, number] = [
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0,
  ]
  const pre: Array<string | number> = []
  if (preRaw !== '') {
    const ids = preRaw.split('.')
    for (const id of ids) {
      if (id === '' || !IDENT_RE.test(id)) return null
      pre.push(/^\d+$/.test(id) ? Number(id) : id)
    }
  }
  const normalized = `${core.join('.')}${pre.length > 0 ? `-${pre.join('.')}` : ''}`
  return { core, pre, normalized }
}

/** semver 预发布优先级比较：<0 / 0 / >0 */
function comparePre(a: Array<string | number>, b: Array<string | number>): number {
  // 无预发布 > 有预发布
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    const xNum = typeof x === 'number'
    const yNum = typeof y === 'number'
    if (xNum && yNum) {
      if (x !== y) return (x as number) < (y as number) ? -1 : 1
    } else if (xNum !== yNum) {
      // 数字标识符优先级低于字母标识符
      return xNum ? -1 : 1
    } else {
      const xs = String(x)
      const ys = String(y)
      if (xs !== ys) return xs < ys ? -1 : 1
    }
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? -1 : 1
}

/**
 * 比较两个版本。返回 `-1 | 0 | 1`；**任一解析失败返回 null**。
 * 注意：`same` 判定用数值比较而非字符串比较（`0.2` == `0.2.0`）。
 */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === null || pb === null) return null
  for (let i = 0; i < 3; i++) {
    const x = pa.core[i]
    const y = pb.core[i]
    if (x !== y) return x < y ? -1 : 1
  }
  const p = comparePre(pa.pre, pb.pre)
  return p < 0 ? -1 : p > 0 ? 1 : 0
}

/** 判定 latest 相对 current 的关系。任一不可解析 → `invalid`（显式，不兜底）。 */
export function relateVersions(current: unknown, latest: unknown): VersionRelation {
  const c = compareVersions(current, latest)
  if (c === null) return 'invalid'
  if (c < 0) return 'newer'
  if (c > 0) return 'older'
  return 'same'
}

/** 是否应当提示"有新版本"（仅当 latest 严格更新）。 */
export function hasUpdate(current: unknown, latest: unknown): boolean {
  return relateVersions(current, latest) === 'newer'
}
