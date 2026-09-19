/**
 * 稳定短哈希（FNV-1a 32bit → base36）—— 单源（P-1b）。
 *
 * ## 为什么必须单源
 * 这个函数原本在 `import/dsh-export.ts` 与 `preset/st-import.ts` 里**各有一份完全相同的实现**。
 * 复制即必然漂移，而这里漂移的后果尤其严重：
 *   - 导入侧用它生成角色卡/预设的 id 后缀（去重）
 *   - 导出侧用它生成 DSH 要求的 kebab-case id
 * 若一边改了算法（比如换成 FNV-1a 64bit 或加盐），**同一个角色卡在导入与导出时
 * 会得到不同的 id** —— 表现为「导入的卡导出后变成另一张卡」，且没有任何报错。
 * 这是典型的静默数据一致性问题，必须靠单源消除。
 *
 * 由 `scripts/audit-impl-duplication.mjs` 的跨包同名函数判据发现。
 */

/**
 * FNV-1a 32bit 哈希 → base36 字符串。
 * 用途：给中文/任意名生成 DSH 要求的 kebab-case id（名字本身不能直接做 id）。
 * 性质：确定性（同输入同输出）、短（32bit → 至多 7 个 base36 字符）、分布均匀。
 * 注意：**非加密用途**，不做抗碰撞保证（仅用于 id 去重后缀）。
 */
export function hash36(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
