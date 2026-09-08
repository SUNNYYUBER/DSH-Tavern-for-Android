/**
 * T1.14 消息窗口化纯函数单测（chat-windowing.ts）：
 * - 窗口区间计算：nearBand 可视带判定 + enter/exit overscan 换算（「上下各 10 条」
 *   的像素等价语义 + 滞回防振荡）
 * - 滚动锚定补偿：anchorDelta 文档坐标不变量（含「用户自行滚动 → 差值为 0、
 *   绝不抢滚动」的关键安全用例）
 * - 占位高度估算：estimatePlaceholderHeight 最近实测优先、无数据回退默认值
 *
 * 协调器本体（registry / scroll 监听 / ResizeObserver）是浏览器 DOM 单例，
 * node 测试环境不模拟 DOM，仅覆盖零 DOM 依赖的纯函数层。
 */
import { describe, expect, it } from 'vitest'
import {
  anchorDelta, DEFAULT_PLACEHOLDER_HEIGHT, enterOverscanPx, estimatePlaceholderHeight,
  exitOverscanPx, nearBand, nextWindowedState,
} from '../src/dsht-rp-ui/src/client/chat-windowing.ts'

describe('nearBand 可视带判定（窗口区间计算的原子操作）', () => {
  const vh = 800
  const overscan = 2000

  it('视口内的条目恒在带内（窗口化永不占位可见消息）', () => {
    expect(nearBand({ top: 100, bottom: 300 }, vh, overscan)).toBe(true)
    expect(nearBand({ top: 0, bottom: 800 }, vh, overscan)).toBe(true)
  })

  it('视口下方带内 → 渲染；带外 → 占位', () => {
    // top < vh + overscan(2800) → 进入带
    expect(nearBand({ top: 2799, bottom: 3200 }, vh, overscan)).toBe(true)
    expect(nearBand({ top: 2800, bottom: 3200 }, vh, overscan)).toBe(false)
  })

  it('视口上方带内 → 渲染；带外 → 占位', () => {
    // bottom > -overscan(-2000) → 仍在带内（上滚回看时提前恢复渲染）
    expect(nearBand({ top: -1900, bottom: -1500 }, vh, overscan)).toBe(true)
    expect(nearBand({ top: -2100, bottom: -2000 }, vh, overscan)).toBe(false)
  })

  it('边界为开区间判定：恰好压线不算在带内（避免零距离振荡）', () => {
    expect(nearBand({ top: vh + overscan, bottom: vh + overscan + 10 }, vh, overscan)).toBe(false)
    expect(nearBand({ top: -overscan - 10, bottom: -overscan }, vh, overscan)).toBe(false)
  })
})

describe('overscan 换算（「上下各 ~10 条」的像素等价 + 滞回）', () => {
  it('进入带：1.5 屏与 2000px 下限取大（800px 视口 → 2000px，约合 5~10 条 RP 消息）', () => {
    expect(enterOverscanPx(800)).toBe(2000)   // 1.5×800=1200 < 下限 2000
    expect(enterOverscanPx(2000)).toBe(3000)  // 长屏按 1.5 倍生效
  })

  it('退出带 = 进入带 × 滞回系数：已渲染的更晚占位化，边界条目进出不振荡', () => {
    expect(exitOverscanPx(800)).toBeCloseTo(3200)
    expect(exitOverscanPx(800)).toBeGreaterThan(enterOverscanPx(800))
    // 滞回的几何效果：同一条目在进入带外、退出带内时保持渲染不翻转
    const vh = 800
    const rect = { top: 3000, bottom: 3400 }
    expect(nearBand(rect, vh, enterOverscanPx(vh))).toBe(false)  // 新条目不渲染
    expect(nearBand(rect, vh, exitOverscanPx(vh))).toBe(true)    // 已渲染的保持渲染
  })
})

describe('anchorDelta 滚动锚定补偿（文档坐标不变量）', () => {
  const anchorDocTop = 1000 // 锚点文档坐标 = 翻转前 top(800) + scrollTop(200)

  it('锚点上方内容变高 100px → 补偿 +100，scrollTop 增后锚点视觉位置复原', () => {
    // 上方内容变高把锚点向下推：top 800→900（scrollTop 未变 200）
    const delta = anchorDelta(900, 200, anchorDocTop)
    expect(delta).toBe(100)
    // scrollTop += delta 后：900 - (200+100) = 600 = 原视口位置 800 - 200 ✓
  })

  it('锚点上方内容变矮 50px → 补偿 -50', () => {
    expect(anchorDelta(750, 200, anchorDocTop)).toBe(-50)
  })

  it('无高度变化 → 差值为 0，不产生任何滚动干预', () => {
    expect(anchorDelta(800, 200, anchorDocTop)).toBe(0)
  })

  it('用户自行滚动后测量（top 与 scrollTop 此消彼长）→ 文档坐标守恒、差值为 0：绝不抢滚动', () => {
    // 用户上滚 300px：scrollTop 200→500，锚点 top 800→500（文档坐标仍 1000）
    expect(anchorDelta(500, 500, anchorDocTop)).toBe(0)
    // 用户下滚 100px：scrollTop 200→100，锚点 top 800→900（文档坐标仍 1000）
    expect(anchorDelta(900, 100, anchorDocTop)).toBe(0)
  })
})

describe('nextWindowedState 翻转语义（回归锁：曾在主实现中写反致视口内消息占位）', () => {
  it('在可视带（near=true）→ 真实渲染（false）', () => {
    expect(nextWindowedState(false, false, true)).toBe(false)
    expect(nextWindowedState(true, false, true)).toBe(false)
  })

  it('滚出可视带（near=false）→ 占位（true）', () => {
    expect(nextWindowedState(false, false, false)).toBe(true)
    expect(nextWindowedState(true, false, false)).toBe(true)
  })

  it('forced（流式中）恒渲染，与位置无关', () => {
    expect(nextWindowedState(true, true, false)).toBe(false)
    expect(nextWindowedState(false, true, false)).toBe(false)
  })
})

describe('estimatePlaceholderHeight 占位高度估算（实测优先）', () => {
  it('有最近实测高度 → 直接使用（占位高度≈真实高度，滚动位置不漂移）', () => {
    expect(estimatePlaceholderHeight(342.5)).toBe(342.5)
  })

  it('无实测数据（null/undefined/0/负数/NaN）→ 回退默认估算值', () => {
    expect(estimatePlaceholderHeight(null)).toBe(DEFAULT_PLACEHOLDER_HEIGHT)
    expect(estimatePlaceholderHeight(undefined)).toBe(DEFAULT_PLACEHOLDER_HEIGHT)
    expect(estimatePlaceholderHeight(0)).toBe(DEFAULT_PLACEHOLDER_HEIGHT)
    expect(estimatePlaceholderHeight(-10)).toBe(DEFAULT_PLACEHOLDER_HEIGHT)
    expect(estimatePlaceholderHeight(Number.NaN)).toBe(DEFAULT_PLACEHOLDER_HEIGHT)
  })

  it('支持自定义回退值', () => {
    expect(estimatePlaceholderHeight(null, 88)).toBe(88)
    expect(estimatePlaceholderHeight(120, 88)).toBe(120)
  })
})
