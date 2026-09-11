/**
 * deep-merge 单实现源（T-35 收敛）—— 等价性 + 家族差异 + 引用语义 三重钉桩
 * ============================================================================
 * 【本文件要防的三件事】
 *  ① **再次分叉**：T-35 之前本项目有 4 份独立 deep-merge 实现（+1 份换参写法）。
 *     收敛后若有人再抄一份，本文件的「等价性」断言不会发现——但「引用语义」与
 *     「家族方向」断言会在有人**错误地合一**时立刻转红。
 *  ② **错误合一**：两个语义家族（incoming 胜 / existing 胜）结果**相反**，不可合并。
 *  ③ **按形状合一**：families-B 内部，`deepMergeInitVars`（深拷贝）与
 *     `deepMergeInsert`（共享 incoming 子树引用）**结果形状相同、引用语义不同**——
 *     只看 `toEqual` 的测试**发现不了**这个差异（本项目主力缺陷族）。
 */
import { describe, expect, it } from 'vitest'
import {
  clonePlainTree,
  deepMergeExistingClone,
  deepMergeIncoming,
  isMergeableObject,
} from '../src/dsht-plugin-shared/deep-merge.ts'
import { deepMergeVars } from '../src/dsht-plugin-tavern-helper/variables.ts'
import { deepMerge } from '../src/dsht-plugin-mvu/index.ts'
import { deepMergeAssign, deepMergeInsert } from '../src/dsht-rp-ui/src/client/th-shim.ts'
import { deepMergeInitVars } from '../src/state/mvu.ts'

/** T-35 对照表里的**判别性用例**（叶冲突 / 深合并 / 数组冲突 三类同时出现） */
const LOW = { x: 1, nested: { a: 1, b: 2 }, arr: [1, 2] }
const HIGH = { x: 99, nested: { b: 88, c: 3 }, arr: [9] }
const mkLow = () => ({ x: 1, nested: { a: 1, b: 2 }, arr: [1, 2] })
const mkHigh = () => ({ x: 99, nested: { b: 88, c: 3 }, arr: [9] })

describe('deepMergeIncoming —— families-A：incoming（high）获胜', () => {
  it('判别性用例：叶覆盖 / 深合并 / 数组整体替换', () => {
    expect(deepMergeIncoming(LOW, HIGH)).toEqual({ x: 99, nested: { a: 1, b: 88, c: 3 }, arr: [9] })
  })

  it('不修改任何入参（纯函数）', () => {
    const low = mkLow()
    const high = mkHigh()
    deepMergeIncoming(low, high)
    expect(low).toEqual({ x: 1, nested: { a: 1, b: 2 }, arr: [1, 2] })
    expect(high).toEqual({ x: 99, nested: { b: 88, c: 3 }, arr: [9] })
  })

  it('high 缺的键原样保留 low 的值', () => {
    expect(deepMergeIncoming({ a: 1, b: 2 }, { b: 9 })).toEqual({ a: 1, b: 9 })
  })

  it('任一侧为 null / 类型不一致 → 整体以 high 覆盖（不递归）', () => {
    expect(deepMergeIncoming({ a: null }, { a: { b: 1 } })).toEqual({ a: { b: 1 } })
    expect(deepMergeIncoming({ a: { b: 1 } }, { a: null })).toEqual({ a: null })
    expect(deepMergeIncoming({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } })
    expect(deepMergeIncoming({ a: { b: 2 } }, { a: 1 })).toEqual({ a: 1 })
  })
})

describe('deepMergeExistingClone —— families-B：existing 获胜（只补缺口）', () => {
  it('判别性用例：与 families-A **结论相反**（同一输入）', () => {
    const b = deepMergeExistingClone(LOW, HIGH)
    expect(b).toEqual({ x: 1, nested: { a: 1, b: 2, c: 3 }, arr: [1, 2] })
    // 决定性对照：两个家族在同一输入上必须给出相反结论——这是「不可合一」的机器判据
    const a = deepMergeIncoming(LOW, HIGH)
    const nestedB = b.nested as Record<string, unknown>
    const nestedA = a.nested as Record<string, unknown>
    expect(b.x).not.toBe(a.x)
    expect(b.arr).not.toBe(a.arr)
    expect(nestedB.b).not.toBe(nestedA.b)
  })

  it('只「补」不「改」：已有叶值一律保留', () => {
    expect(deepMergeExistingClone({ hp: 10 }, { hp: 999, mp: 5 })).toEqual({ hp: 10, mp: 5 })
  })

  it('幂等：合并结果再合并一次 = 同一结果（initvar 重放账的前提）', () => {
    const init = { a: { b: 1, c: 2 }, list: [1] }
    const once = deepMergeExistingClone({ a: { b: 0 } }, init)
    expect(deepMergeExistingClone(once, init)).toEqual(once)
  })

  it('不修改任何入参', () => {
    const existing = { a: { b: 0 } }
    const init = { a: { b: 9, c: 1 } }
    deepMergeExistingClone(existing, init)
    expect(existing).toEqual({ a: { b: 0 } })
    expect(init).toEqual({ a: { b: 9, c: 1 } })
  })
})

describe('T-35 收敛等价性 —— 4 个历史名 = 单实现源', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['叶冲突 + 深合并 + 数组冲突', LOW, HIGH],
    ['空 low', {}, HIGH],
    ['空 high', LOW, {}],
    ['嵌套三层', { a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 9 } } }],
    ['null 与对象', { a: null }, { a: { b: 1 } }],
  ]

  it('families-A 三处（deepMergeVars / deepMerge / deepMergeAssign）与 deepMergeIncoming 逐例一致', () => {
    for (const [name, low, high] of cases) {
      const want = deepMergeIncoming(low, high)
      expect(deepMergeVars(low, high), `deepMergeVars @ ${name}`).toEqual(want)
      expect(deepMerge(low, high), `deepMerge @ ${name}`).toEqual(want)
      expect(deepMergeAssign(low, high), `deepMergeAssign @ ${name}`).toEqual(want)
    }
  })

  it('deepMergeInsert 是 deepMergeIncoming 的换参写法（low/high 对调）', () => {
    for (const [name, low, high] of cases) {
      expect(deepMergeInsert(low, high), `deepMergeInsert @ ${name}`).toEqual(deepMergeIncoming(high, low))
    }
  })

  it('deepMergeInitVars 与 deepMergeExistingClone 逐例一致', () => {
    for (const [name, existing, incoming] of cases) {
      expect(deepMergeInitVars(existing, incoming), `deepMergeInitVars @ ${name}`).toEqual(
        deepMergeExistingClone(existing, incoming),
      )
    }
  })

  it('**反控**：若把 families-B 误接成 families-A，判别性用例必转红', () => {
    // 模拟「错误合一」：用 incoming 胜版本冒充 existing 胜版本
    const wrong = deepMergeIncoming(LOW, HIGH)
    const right = deepMergeExistingClone(LOW, HIGH)
    expect(wrong).not.toEqual(right) // 若两者相等，说明家族方向已丢失（本断言失败 = 真出了问题）
  })
})

describe('families-B 内部的**引用语义差异** —— 结果形状相同但不可互相替代', () => {
  it('deepMergeInitVars 深拷贝补入值（不共享 init 子树）', () => {
    const init = { a: { b: 1 } }
    const out = deepMergeInitVars({}, init)
    expect(out).toEqual(init)
    expect(out).not.toBe(init) // 根不同
    expect((out as { a: unknown }).a).not.toBe(init.a) // 子树也不同 = 真深拷贝
  })

  it('deepMergeInsert **共享** vars 的子树引用（与上一例相反）', () => {
    const vars = { a: { b: 1 } }
    const out = deepMergeInsert({}, vars)
    expect(out).toEqual(vars)
    expect(out).not.toBe(vars) // 根是新对象（{...vars}）
    expect((out as { a: unknown }).a).toBe(vars.a) // 子树**同一引用** —— 这就是差异
  })

  it('决定性对照：两者 toEqual 相等、toBe 不同 ⇒ 只用 toEqual 的测试发现不了（防"按形状合一"）', () => {
    const vars = { a: { b: 1 } }
    const init = { a: { b: 1 } }
    const viaInit = deepMergeInitVars({}, init)
    const viaInsert = deepMergeInsert({}, vars)
    expect(viaInit).toEqual(viaInsert) // 形状一致
    expect((viaInit as { a: unknown }).a).not.toBe(init.a) // 但引用语义相反
    expect((viaInsert as { a: unknown }).a).toBe(vars.a)
  })
})

describe('辅助谓词', () => {
  it('isMergeableObject：对象真、数组/标量/null 假', () => {
    expect(isMergeableObject({})).toBe(true)
    expect(isMergeableObject([])).toBe(false)
    expect(isMergeableObject(null)).toBe(false)
    expect(isMergeableObject(1)).toBe(false)
    expect(isMergeableObject('x')).toBe(false)
  })

  it('clonePlainTree：深拷贝、数组逐元素拷贝、标量原样', () => {
    const src = { a: [1, { b: 2 }], c: 3 }
    const out = clonePlainTree(src)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
    expect(out.a).not.toBe(src.a)
    expect(out.a[1]).not.toBe(src.a[1])
    expect(clonePlainTree(5)).toBe(5)
  })
})
