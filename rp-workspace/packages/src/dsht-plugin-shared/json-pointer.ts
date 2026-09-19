/**
 * JSON Pointer（RFC 6901）编解码 —— 单源（P-1b）。
 *
 * ## 为什么必须单源
 * `~1 → /`、`~0 → ~` 这两个转义的**顺序**是有讲究的（必须**先 `~1` 后 `~0`**，
 * 反了会把 `~01` 这类输入解错——正确结果是 `~1`，反序会先变成 `~0`+`1`... 从而得到 `/` 或 `~1` 的错误结果）。
 * 这个算法原本在三个包里各有一份实现：
 *   - `dsht-plugin-tavern-helper/variables.ts`
 *   - `state/mvu.ts`
 *   - `dsht-plugin-shared/macros.ts`（内联在 parseVarPath 里）
 * 复制即漂移——三处对同一路径可能给出不同段数组，而**路径决定写到变量树的哪个位置**，
 * 错了就是「状态写歪了」且不会报错。由 `scripts/audit-impl-duplication.mjs` 发现。
 */

/** JSONPointer 段解码：`~1` → `/`、`~0` → `~`（**顺序不可颠倒**，见文件头注） */
export function decodePointerSeg(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** 段 → JSONPointer 转义（编码；`~` 必须先转，否则会把刚生成的 `~1` 里的 `~` 再转一次） */
export function encodePointerSeg(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * 路径 → 段数组（点号或 JSONPointer 双兼容）。
 * JSONPointer 转义**仅在斜杠形态下**解码（点号形态是 ST 的 setvar 风格，不做转义）。
 */
export function parsePathSegments(path: string): string[] {
  const p = path.trim()
  if (p.startsWith('/')) return p.split('/').filter(s => s.length > 0).map(decodePointerSeg)
  return p.split('.').map(s => s.trim()).filter(s => s.length > 0)
}

/** 段数组 → JSONPointer（路由落盘 / undo 日志的规范形态） */
export function toJsonPointer(segments: readonly string[]): string {
  return '/' + segments.map(encodePointerSeg).join('/')
}
