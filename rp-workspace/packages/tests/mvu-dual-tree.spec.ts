/**
 * MVU 双树一致性（L5 穷举补齐，2026-09-14）。
 *
 * ## 什么是「双树」
 * `rp/state/<sid>.json` 里有两个变量树，都是 MVU 的落点：
 *   · `variables` —— **initvar**（`<initvar>` 块 / 迁移）的落点
 *   · `state`     —— **运行期 UpdateVariable / JSONPatch** 的落点
 *
 * ## 为什么必须有这组测试（L5 穷举发现的缺口）
 * 两条写入路径 + 两条读取路径，各自取树的方式不同：
 *   · 生成期摘要读 `state ?? variables`（dsh-plugin）
 *   · 状态栏读 `variables ?? state`（dsht-plugin-mvu）
 *   · `/dsht-mvu/variables` 读 **深合并**（`deepMerge(variables, state)`，state 赢）
 * 我为「两树都初始化」加过双写（dsh-plugin 的 initvar 分支），但**没有端到端单测**
 * 钉住它。若将来有人只写一棵树，读侧会**静默**返回半棵树——且不同读路径各自
 * 半棵（一个缺 init 值、一个缺运行期增量），现场表现是「变量有时对有时不对」，
 * 极难归因。本组测试把这条一致性钉成可回归信号（P-1 / P-8）。
 *
 * ## 判据
 * 1. **深合并方向**：state 优先于 variables（同键时 state 赢，浅层与深层都成立）。
 * 2. **不丢 subtree**：variables 独有的键必须在合并结果里（否则 init 值消失）。
 * 3. **运行期增量不被 init 整键覆盖**：`variables.stat_data` 与 `state.stat_data`
 *    必须**深合并**（浅 spread 会让运行期数值回退到迁移初值——这是实测过的缺陷）。
 * 4. **幂等**：同一份输入重复合并结果稳定（P-8）。
 */
import { describe, expect, it } from 'vitest'
import { deepMerge } from '../src/dsht-plugin-mvu/index.ts'
import { deepMergeInitVars } from '../src/state/mvu.ts'

describe('MVU 双树一致性（variables=initvar 落点 / state=运行期落点）', () => {
  it('✅ 判据 1：同键时 state 赢（浅层）——运行期覆盖 init 初值', () => {
    const variables = { 好感度: 0, 地点: '咖啡厅' }
    const state = { 好感度: 3 }
    const merged = deepMerge(variables, state)
    expect(merged['好感度']).toBe(3)
  })

  it('✅ 判据 2：variables 独有的键必须保留（否则 init 值消失）', () => {
    const variables = { 好感度: 0, 地点: '咖啡厅' }
    const state = { 好感度: 3 }
    const merged = deepMerge(variables, state)
    expect(merged['地点']).toBe('咖啡厅')
  })

  it('✅ 判据 3：stat_data 必须**深合并**（浅 spread 会让运行期数值回退到迁移初值）', () => {
    // 这是实测过的缺陷形态：variables.stat_data 整键盖掉 state.stat_data 的运行期增量
    const variables = { stat_data: { 云梦璃: { 好感度: 0, 心情: '平静' } } }
    const state = { stat_data: { 云梦璃: { 好感度: 42 } } }
    const merged = deepMerge(variables, state) as { stat_data: { 云梦璃: Record<string, unknown> } }
    expect(merged.stat_data.云梦璃['好感度']).toBe(42) // state 赢
    expect(merged.stat_data.云梦璃['心情']).toBe('平静') // variables 的兄弟键不丢
  })

  it('负控：反向合并（state 作底、variables 作上）会得出相反结论——证明方向不是「随便合」', () => {
    const variables = { 好感度: 0 }
    const state = { 好感度: 3 }
    const reversed = deepMerge(state, variables)
    expect(reversed['好感度']).toBe(0) // 方向反了 ⇒ init 值盖掉运行期值（错误形态）
  })

  it('✅ 判据 4：幂等（同一输入重复合并结果稳定）', () => {
    const variables = { a: { x: 1, y: 2 } }
    const state = { a: { y: 9 } }
    const once = deepMerge(variables, state)
    const twice = deepMerge(once, state)
    expect(twice).toEqual(once)
  })

  it('边界：某一棵树缺席（undefined / 空对象）时不炸，另一棵原样可用', () => {
    expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 })
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 })
  })

  it('数组必须整体替换（不做逐元素合并）——与 isMergeableObject 判据一致', () => {
    const variables = { 队伍: [1, 2, 3] }
    const state = { 队伍: [9] }
    expect(deepMerge(variables, state)['队伍']).toEqual([9])
  })

  // -------------------------------------------------------------------------
  // 双写点：dsh-plugin 的 initvar 分支对**两棵树都**初始化
  // -------------------------------------------------------------------------
  describe('双写点（initvar 必须同时落 variables 与 state）', () => {
    it('✅ deepMergeInitVars 对空树 → 得到完整 init 树（两树初始同形）', () => {
      const init = { stat_data: { 云梦璃: { 好感度: 0 } } }
      const vTree = deepMergeInitVars({}, init)
      const sTree = deepMergeInitVars({}, init)
      // 双写后两树同形 —— 这是「避免分叉」的直接判据
      expect(vTree).toEqual(sTree)
      expect(vTree).toEqual(init)
    })

    it('✅ 二次 init（幂等）：已有运行期增量的树不被 init 覆盖', () => {
      const init = { 云梦璃: { 好感度: 0, 心情: '平静' } }
      const runtime = { 云梦璃: { 好感度: 42 } }
      const merged = deepMergeInitVars(runtime, init) as { 云梦璃: Record<string, unknown> }
      // families-B 语义（existing 胜）：运行期值不被 init 拉回
      expect(merged.云梦璃['好感度']).toBe(42)
      // init 的兄弟键补进来
      expect(merged.云梦璃['心情']).toBe('平静')
    })

    it('✅ 结构性：initvar 双写点在源码里确实写两棵树（防「只写一棵」静默回归）', async () => {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const src = readFileSync(
        join(import.meta.dirname, '..', 'src', 'dsh-plugin', 'index.ts'), 'utf8')
      // 双写：sti.variables 与 sti.state 都走 deepMergeInitVars
      const hits = src.match(/sti\.(variables|state)\s*=\s*deepMergeInitVars\(/g) ?? []
      expect(hits.length, `initvar 双写点应恰好 2 处（variables + state），实际 ${hits.length}`).toBe(2)
    })
  })
})
