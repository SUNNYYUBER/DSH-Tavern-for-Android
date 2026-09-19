/**
 * 文本 token 归一化（共享模块）——「去成对引号」这类小工具的单源落点。
 *
 * ## 为什么单独建这个模块（F5 / P-1b，2026-09-14）
 * 审计脚本 `scripts/audit-impl-duplication.mjs` 的**判据 4**（不同名但函数体逐字相同）
 * 抓到了两组此前完全不可见的复制：
 *   · `dsht-plugin-memory/tables.ts` 的 `stripArgQuotes`
 *   · `state/mvu.ts` 的 `stripQuotes`
 * 两者函数体**逐字相同**。名字不同 ⇒ 判据 2（同名比对）永远不报 ⇒
 * 「改一处漏一处」完全不可见。这类「工具函数改名复制」最容易发生，因为复制者
 * 往往觉得「这只是个小工具，不值得下沉共享」——但**判据只关心语义是否同一**，
 * 与函数大小无关：一处补了全角引号另一处没补，就是两张卡行为不一致。
 *
 * ## 口径（保持既有行为，逐条沿用）
 * 去成对包裹的 `"` `"`、`'` `'`、`“` `”`；不足两字符 / 不成对 / 混合引号 → 原样返回（只 trim）。
 * 注意**不是**「去掉所有引号」：`"a"b"` 这类不成对的不动，避免误伤内容里的引号。
 */

/** 去成对包裹引号（半角双/单 + 全角双）；不成对返回 trim 后的原值。 */
export function stripMatchingQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2
    && ((t.startsWith('"') && t.endsWith('"'))
      || (t.startsWith("'") && t.endsWith("'"))
      || (t.startsWith('“') && t.endsWith('”')))) return t.slice(1, -1)
  return t
}
