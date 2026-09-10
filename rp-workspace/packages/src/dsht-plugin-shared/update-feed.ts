/**
 * 更新源响应归一化 + 下载资产挑选（纯函数，零依赖）——T-27「检查更新」的形状适配层。
 *
 * 为什么单独成模块并单独测：
 * 发布渠道未定时，更新源可能是两种形态 —— GitHub Releases API（`tag_name`/`html_url`/
 * `assets[].browser_download_url`）或自建静态 JSON（`version`/`url`/`notes`）。
 * 「形状适配」是本项目历史上最容易**静默失效**的一类代码（字段名一改，取值变 undefined，
 * 不抛错、不报错，界面上表现为"没有新版本"）。所以这里立两条硬规矩：
 * 1. 解析不出**必须抛**（带人类可读原因），绝不返回 `undefined` 当空值；
 * 2. 归一化与"挑哪个包下载"都做成纯函数，用单测把两种形态的字段名钉死。
 */

export type UpdateFeedKind = 'github' | 'json'

export interface UpdateAsset {
  name: string
  url: string
  size: number | null
}

export interface UpdateFeed {
  version: string
  url: string
  notes: string
  assets: UpdateAsset[]
}

/**
 * 未显式指定 kind 时按 URL 形态识别：
 * `api.github.com/...` 或 `github.com/<o>/<r>/releases...` → github，其余视为静态 JSON。
 */
export function guessUpdateKind(url: string, hint?: string): UpdateFeedKind {
  if (hint === 'github' || hint === 'json') return hint
  return /api\.github\.com|github\.com\/[^/]+\/[^/]+\/releases/i.test(url) ? 'github' : 'json'
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? v as Record<string, unknown> : {}

/** 取第一个"是字符串且非空"的候选字段 */
function firstString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

/**
 * 把两种形态归一成 `UpdateFeed`。**解析不出即抛**（不静默兜底成"没有新版本"）。
 * 允许静态 JSON 包一层 `{ latest: {...} }` —— 自建源的常见写法。
 */
export function normalizeUpdateFeed(raw: unknown, kind: UpdateFeedKind): UpdateFeed {
  const outer = asRecord(raw)
  const node = Object.keys(asRecord(outer.latest)).length > 0 ? asRecord(outer.latest) : outer

  // `tag_name` 优先（GitHub），其次 `version`；两者都无 → 无法判定版本，抛
  const version = firstString(node, ['tag_name', 'version', 'name'])
  if (version === '') {
    throw new Error(kind === 'github' ? '响应里没有 tag_name（GitHub Releases 形态不符）' : '响应里没有 version 字段')
  }
  // 版本号必须是可解析形态，否则上层会比较失败——在这里就拦掉，错误更早更具体
  const url = firstString(node, ['html_url', 'url', 'downloadUrl'])
  const notes = firstString(node, ['body', 'notes', 'changelog'])

  const assetsRaw = Array.isArray(node.assets) ? node.assets : []
  const assets: UpdateAsset[] = []
  for (const a of assetsRaw) {
    const ao = asRecord(a)
    const name = firstString(ao, ['name'])
    const au = firstString(ao, ['browser_download_url', 'url'])
    if (name === '' || au === '') continue
    const size = typeof ao.size === 'number' && Number.isFinite(ao.size) ? ao.size : null
    assets.push({ name, url: au, size })
  }
  return { version, url, notes, assets }
}

/** Android `Build.SUPPORTED_ABIS[0]`（如 `arm64-v8a`）→ APK 文件名里的架构标记（`arm64`） */
export function abiToken(abi: string): string {
  const a = abi.toLowerCase()
  if (a.startsWith('arm64')) return 'arm64'
  if (a.startsWith('x86_64') || a.startsWith('x86-64')) return 'x86_64'
  if (a.startsWith('armeabi') || a.startsWith('arm')) return 'armeabi'
  if (a.startsWith('x86')) return 'x86'
  return a
}

/**
 * 挑选"本机该下哪个包"：
 * ① 优先文件名含本机架构标记的 `.apk`；
 * ② 退而求其次取任意 `.apk`；
 * ③ 都没有 → null（由调用方回退到 release 页面链接，**不要**瞎猜一个资产）。
 */
export function pickDownloadAsset(assets: UpdateAsset[], abi: string): UpdateAsset | null {
  const apks = assets.filter(a => a.name.toLowerCase().endsWith('.apk'))
  if (apks.length === 0) return null
  const token = abi === '' ? '' : abiToken(abi)
  if (token !== '') {
    const hit = apks.find(a => a.name.toLowerCase().includes(token))
    if (hit) return hit
  }
  return apks[0]
}
