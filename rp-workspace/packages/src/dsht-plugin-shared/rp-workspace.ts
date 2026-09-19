/**
 * RP 工作区路径工具（单源，纯逻辑）。
 *
 * ## 为什么单独抽出来（P-1b 单一事实来源）
 * `cwd → rp 工作区 slug` 这个判定原本有**两份实现**：
 *   - `dsh-plugin/index.ts`：按 `normAndroidPath` 规范化后比前缀，要求 cwd **恰好**是
 *     `$DSH_HOME/rp/<slug>`（多一层即判非 RP 工作区）
 *   - `dsht-plugin-tavern-helper/facade.ts`：用 `path.relative` 反推，**取相对路径首段**
 *     （`$DSH_HOME/rp/ws-1/sub` 也认得 `ws-1`）
 * 两者**宽严不同**、参数顺序还相反（`(cwd, dshHome)` vs `(dshHome, cwd)`）。
 *
 * ### 2026-09-14 修订：为什么不是简单合并（一次真实回归）
 * 初版收口时把两者当同一语义、统一到「严格」版 ⇒ `facade.spec.ts` 立刻失败：
 * 门面场景 cwd 由 `path.join` 产出（Windows 下是反斜杠），严格版的前缀比较不匹配
 * ⇒ 角色名静默回落 `Assistant`。
 * 复查后确认：这不是「复制疏忽」，而是**两处调用点真的需要不同宽严度**——
 *   · dsh-plugin 用它做「会话归属」判定（工作区就是一层，深层应判非 RP）；
 *   · 门面用它做「取角色名」兜底（cwd 可能更靠里，宽容取首段即可）。
 * 故本模块**收口真正共享的部分**（Android 双形态归一 + 分隔符归一 + 前缀判定 + 边界），
 * 把语义差暴露成**显式参数** `mode`，而不是靠两份函数体各写一遍再慢慢漂移。
 *
 * 本模块由 `scripts/audit-impl-duplication.mjs` 的跨包同名函数判据驱动抽出。
 */

/**
 * Android 路径归一：`/data/user/0/<pkg>` 与 `/data/data/<pkg>` 是同一目录的两种形态。
 * 必须归一后再比较/落盘，否则同一个工作区会被判成两个。
 *
 * 背景：Android 上 `$DSH_HOME` 常取 `/data/user/0/<pkg>` 形态（`/data/data` 的 symlink），
 * 而 DSH WorkspaceRegistry 一律 realpath 规范化（`/data/data` 形态）。
 */
export function normalizeAndroidPath(p: string): string {
  return p.replace(/^\/data\/user\/0\//, '/data/data/')
}

/**
 * slug 提取模式。
 * - `exact`：cwd 必须**恰好**是 `$DSH_HOME/rp/<slug>`；更深层 → null。用于「会话归属」判定。
 * - `first-segment`：cwd 在 `$DSH_HOME/rp/` 下即可，取相对路径首段。用于「取角色名」这类宽容场景。
 */
export type RpSlugMode = 'exact' | 'first-segment'

/**
 * 从会话 cwd 提取 RP 工作区段（`$DSH_HOME/rp/<slug>` → `slug`；非 RP 返回 null）。
 *
 * 参数顺序刻意定为 `(cwd, dshHome)`——调用方几乎总是先有 cwd 再拿 dshHome；
 * 历史上有过相反的副本，统一到本签名。
 *
 * 分隔符一律归一到 `/`：Windows 调试环境用反斜杠、Android 用正斜杠，
 * 不归一会让「同一份 cwd」在两种环境下得出不同结论（上述回归的根因）。
 */
export function rpSlugFromCwd(
  cwd: string | undefined,
  dshHome: string,
  mode: RpSlugMode = 'exact',
): string | null {
  if (!cwd) return null
  const toPosix = (p: string): string => normalizeAndroidPath(p).replace(/\\/g, '/')
  const prefix = `${toPosix(dshHome)}/rp/`
  const normalized = toPosix(cwd)
  if (!normalized.startsWith(prefix)) return null
  const rest = normalized.slice(prefix.length)
  if (!rest) return null
  if (mode === 'exact') {
    if (rest.includes('/')) return null
    return rest
  }
  const slug = rest.split('/')[0]
  return slug || null
}
