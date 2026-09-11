/**
 * deep-merge.ts —— 全项目 deep-merge 的**单实现源**（T-35 收敛落点，2026-09-11）
 * ============================================================================
 * 【为什么收敛】
 *   本函数族曾在本项目存在 **4 份独立实现**（+1 份派生）：
 *     · `tavern-helper/variables.ts:deepMergeVars`          —— families-A（incoming 胜）
 *     · `th-shim.ts:deepMergeAssign`                        —— families-A（逐字相同）
 *     · `dsht-plugin-mvu/index.ts:deepMerge`                —— families-A（逐字相同）
 *     · `state/mvu.ts:deepMergeInitVars`                    —— families-B（existing 胜）
 *     · `th-shim.ts:deepMergeInsert` = Assign(vars, existing) —— families-B 的换参写法
 *   「同一语义存在多份副本」是本项目主力缺陷族（LEARNINGS L61）——
 *   改了一处不等于修好一个功能。T-19 / T-58 都因副本漂移而出过误判。
 *
 * 【收敛口径（L36 / L37：跟基准一致，既不能少也不能多）】
 *   收敛**不是**把 5 份合成 1 个函数 —— 实测（判别性用例，非读注释）证明这里有**两个语义家族**：
 *
 *   | 用例 LOW={x:1,nested:{a:1,b:2},arr:[1,2]} / HIGH={x:99,nested:{b:88,c:3},arr:[9]} | x | nested | arr |
 *   |---|---|---|---|
 *   | **families-A**（incoming 胜）：`deepMergeIncoming(low, high)` | 99 | {a:1,b:88,c:3} | [9] |
 *   | **families-B**（existing 胜）：`deepMergeExistingClone(existing, incoming)` | 1 | {a:1,b:2,c:3} | [1,2] |
 *
 *   强行合一必然改变其中一侧调用方的行为 ⇒ 本模块导出**两个**函数，各自单实现。
 *
 * 【families-B 内部的**真实差异**（本次实证发现的坑，勿再"顺手合一"）】
 *   `state/mvu.ts:deepMergeInitVars` 与 `th-shim.ts:deepMergeInsert` **合并结果的形状相同**，
 *   但对「补进来的那个值」的**引用语义不同**：
 *     · `deepMergeInitVars` → `clonePlainTree`（**深拷贝**）——因为 init 树被多处复用，
 *       共享引用会被下游就地改写污染（`tests/mvu.spec.ts:275` 已钉：`not.toBe(init)`）；
 *     · `deepMergeInsert`   → 结果以 `{...vars}` 起手，**共享** `vars` 的子树引用。
 *   故 families-B 也**不能**按形状合一：本模块只提供**深拷贝**版本，
 *   `deepMergeInsert` 保留为 `deepMergeIncoming(vars, existing)` 的换参写法（语义即"existing 胜"）。
 *   该差异由 `tests/deep-merge.spec.ts` 显式钉住。
 *
 * 【硬约束】本文件**零 import、零依赖**——UI 层（`dsht-rp-ui`）与插件层都要引它，
 *   且需能被构建期脚本单独内联（同 `macros.ts` 的纪律）。
 */

/** 可合并对象：非 null、是对象、**非数组**（数组一律整体替换，不做逐元素合并） */
export function isMergeableObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 深拷贝纯 JSON 树（来源为 YAML/JSON 解析结果，无函数/循环引用；不共享引用） */
export function clonePlainTree<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => clonePlainTree(x)) as unknown as T
  const src = v as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(src)) out[k] = clonePlainTree(x)
  return out as unknown as T
}

/**
 * **families-A**：深合并，**incoming（high）获胜**；对象递归，其余（数组/标量/类型不一致/任一侧为 null）整体以 high 覆盖。
 *
 * 原实现（3 份逐字相同）：`tavern-helper/variables.ts:deepMergeVars`、
 * `th-shim.ts:deepMergeAssign`、`dsht-plugin-mvu/index.ts:deepMerge`。
 */
export function deepMergeIncoming(
  low: Record<string, unknown>,
  high: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...low }
  for (const [k, v] of Object.entries(high)) {
    const prev = out[k]
    if (isMergeableObject(prev) && isMergeableObject(v)) {
      out[k] = deepMergeIncoming(prev, v)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * **families-B**：深合并，**existing 获胜——只补缺口，绝不覆盖已有叶值**；补进来的值**深拷贝**。
 *
 * 这不是风格问题，而是 initvar 幂等账成立的前提（见 `state/mvu.ts` 的长注释）。
 * 原实现：`state/mvu.ts:deepMergeInitVars`。
 *
 * 与 `th-shim.ts:deepMergeInsert` 形状相同但**引用语义不同**（后者共享 `incoming` 子树）——
 * 见本文件头部【families-B 内部的真实差异】，勿依赖本函数替代它。
 */
export function deepMergeExistingClone(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing }
  for (const [k, v] of Object.entries(incoming)) {
    const cur = out[k]
    if (cur === undefined) {
      out[k] = clonePlainTree(v)
    } else if (isMergeableObject(cur) && isMergeableObject(v)) {
      out[k] = deepMergeExistingClone(cur, v)
    }
    // 其余情况一律保留存量：本函数只会「补」，不会「改」
  }
  return out
}
