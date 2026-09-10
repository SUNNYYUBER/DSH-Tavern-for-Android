import { describe, it, expect } from 'vitest'
import {
  extractFloorsFromEvents, nextChunk, parseMemoryRange, buildMemoryEntry,
  rollbackMemoryBook, buildSummarizePrompt, readConfig, planShadowOps,
  neutralizeMacros, desiredWindow, buildExpandSnapshot, parseFoldedFromMarker, rangeCovers,
  type SurfaceNodeInfo,
} from '../src/dsht-plugin-memory/index.ts'

/** 事件工厂（与 session.jsonl 事件行同构：{type, data}） */
function userMsg(text: string, kind: 'user' | 'plugin' | null = 'user') {
  return {
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text }], ...(kind ? { source: { kind, form: kind === 'plugin' ? 'snapshot' : undefined } } : {}) },
  }
}
function assistantMsg(text: string) {
  return { type: 'assistant/message', data: { role: 'assistant', content: [{ type: 'text', text }] } }
}

describe('extractFloorsFromEvents（楼层口径 = turn：一轮用户输入 / 一轮 AI 回答 = 1 楼）', () => {
  it('真实 user/assistant 计楼，快照/插件注入不计', () => {
    const events = [
      userMsg('开场白前注不算楼', 'plugin'), // 快照（source.kind=plugin）不计
      userMsg('用户第一句'),                 // #1
      assistantMsg('角色回复'),              // #2
      userMsg('用户第二句'),                 // #3
    ]
    const { floors, cursor } = extractFloorsFromEvents(events)
    expect(cursor).toBe(3)
    expect(floors.map(f => f.floor)).toEqual([1, 2, 3])
    expect(floors[0].role).toBe('user')
    expect(floors[1].role).toBe('assistant')
    expect(floors[0].text).toBe('用户第一句')
  })

  it('同 turn 的多条 assistant（思考/工具 step）合并 1 楼，文本拼接', () => {
    const events = [
      userMsg('用户输入', 'user'),                                                        // #1
      { type: 'assistant/message', data: { turn: 7, step: 1, role: 'assistant', content: [{ type: 'text', text: '思考后第一段' }] } },
      { type: 'assistant/message', data: { turn: 7, step: 2, role: 'assistant', content: [{ type: 'text', text: '工具轮续写' }] } },
      { type: 'assistant/message', data: { turn: 7, step: 3, role: 'assistant', content: [{ type: 'text', text: '最终回复' }] } },
      userMsg('下一条输入'),                                                              // #2
      { type: 'assistant/message', data: { turn: 8, step: 1, role: 'assistant', content: [{ type: 'text', text: '新一轮回复' }] } }, // #3
    ]
    const { floors, cursor } = extractFloorsFromEvents(events)
    expect(cursor).toBe(4) // 2 次用户输入 + 2 轮 AI 回答（turn7 三条 step 合并成 1 楼）
    expect(floors.map(f => f.floor)).toEqual([1, 2, 3, 4])
    expect(floors[1].role).toBe('assistant')
    expect(floors[1].text).toBe('思考后第一段\n\n工具轮续写\n\n最终回复')
    expect(floors[2].role).toBe('user')
    expect(floors[3].text).toBe('新一轮回复')
  })

  it('迁移格式 turn 嵌在 data.message.turn 也合并；turn 缺失退化每条一楼', () => {
    const merged = { type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'A' }] } } }
    const merged2 = { type: 'assistant/message', data: { turn: 2, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'B' }] } } }
    const r1 = extractFloorsFromEvents([merged, merged2])
    expect(r1.cursor).toBe(1)
    expect(r1.floors[0].text).toBe('A\n\nB')
    // turn 缺失 → 旧口径退化（每条 assistant 一楼）
    const r2 = extractFloorsFromEvents([assistantMsg('x'), assistantMsg('y')])
    expect(r2.cursor).toBe(2)
  })

  it('多 text 块拼接；空事件流安全', () => {
    const multi = { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }
    const r1 = extractFloorsFromEvents([multi])
    expect(r1.floors[0].text).toBe('a\nb')
    expect(r1.cursor).toBe(1)
    expect(extractFloorsFromEvents([])).toEqual({ floors: [], cursor: 0 })
    expect(extractFloorsFromEvents([{ type: 'session' }, { broken: true } as never, null as never]).cursor).toBe(0)
  })

  it('回退掩码感知：marker replace 区间内的真实消息整条跳过（不计数、不进摘要）', () => {
    // seq 1..8 的日志；seq4 的 marker = 回退到 seq2（rolledBackTo=2）→ 区间 (2,4) 即
    // seq3(assistant#2)、seq4 之前的……注意 marker 本身 seq4：区间 = [3,3]。
    const events = [
      { type: 'user/message', seq: 1, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '保留楼' }] } },   // #1
      { type: 'assistant/message', seq: 2, data: { turn: 1, role: 'assistant', content: [{ type: 'text', text: '保留回复' }] } },        // #2
      { type: 'assistant/message', seq: 3, data: { turn: 2, role: 'assistant', content: [{ type: 'text', text: '被回退的回复' }] } },    // 区间内 → 跳过
      { type: 'user/message', seq: 4, data: { role: 'user', content: [{ type: 'text', text: 'marker' }], source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 2 } } },
      { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '回退后新输入' }] } }, // #3
      { type: 'assistant/message', seq: 6, data: { turn: 3, role: 'assistant', content: [{ type: 'text', text: '回退后新回复' }] } },        // #4
    ]
    const { floors, cursor } = extractFloorsFromEvents(events)
    expect(cursor).toBe(4) // 被回退的 seq3 不计楼（旧口径会数出 5）
    expect(floors.map(f => f.text)).toEqual(['保留楼', '保留回复', '回退后新输入', '回退后新回复'])
  })

  it('回退掩码感知：includeAnchor（rolledBackTo = 锚-1）连锚消息一起跳过；editedFrom 区间同语义', () => {
    const events = [
      { type: 'user/message', seq: 1, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '更早的楼' }] } }, // #1
      { type: 'user/message', seq: 2, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '被回退的锚' }] } }, // 区间 [2,3] → 跳过
      { type: 'assistant/message', seq: 3, data: { turn: 2, role: 'assistant', content: [{ type: 'text', text: '锚的回复' }] } },          // 跳过
      { type: 'user/message', seq: 4, data: { role: 'user', content: [{ type: 'text', text: 'marker' }], source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 1 } } },
      { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '重发的输入' }] } }, // #2
    ]
    const { floors, cursor } = extractFloorsFromEvents(events)
    expect(cursor).toBe(2)
    expect(floors.map(f => f.text)).toEqual(['更早的楼', '重发的输入'])
    // editedFrom = seq5 的编辑（hideAfter = 4）：区间 [5,6) → 锚消息自身跳过
    const eventsEdit = [
      ...events.slice(0, 4),
      { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '被编辑的原句' }] } },
      { type: 'user/message', seq: 6, data: { role: 'user', content: [{ type: 'text', text: 'edit marker' }], source: { kind: 'plugin', plugin: 'dsht-rp', editedFrom: 5 } } },
      { type: 'user/message', seq: 7, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '编辑后的新句' }] } },
    ]
    const r2 = extractFloorsFromEvents(eventsEdit)
    expect(r2.cursor).toBe(2)
    expect(r2.floors.map(f => f.text)).toEqual(['更早的楼', '编辑后的新句'])
  })

  it('无 seq 的老数据事件 → 退化为旧口径（掩码逻辑不生效、不误伤）', () => {
    const events = [userMsg('a'), assistantMsg('b'), userMsg('c')]
    const { floors, cursor } = extractFloorsFromEvents(events)
    expect(cursor).toBe(3)
    expect(floors).toHaveLength(3)
  })
})

describe('nextChunk（每 N 楼一块，长跨度分轮消化）', () => {
  it('未跨过 N 楼不触发', () => {
    expect(nextChunk(0, 19, 20)).toBeNull()
    expect(nextChunk(0, 0, 20)).toBeNull()
  })
  it('恰好跨过 N 楼 → [1,20]', () => {
    expect(nextChunk(0, 20, 20)).toEqual({ from: 1, to: 20 })
  })
  it('长跨度切块：21-40（30 楼进度跨到 40 楼）', () => {
    expect(nextChunk(20, 40, 20)).toEqual({ from: 21, to: 40 })
    expect(nextChunk(20, 45, 20)).toEqual({ from: 21, to: 40 }) // 尾块不足 N 留到下轮
  })
  it('回退态（cursor < lastFloor）不触发', () => {
    expect(nextChunk(30, 10, 20)).toBeNull()
  })
  it('非法参数安全', () => {
    expect(nextChunk(Number.NaN, 10, 20)).toBeNull()
    expect(nextChunk(0, 10, 0)).toBeNull()
  })
})

describe('记忆条目与回退裁剪', () => {
  it('buildMemoryEntry：constant 常驻 + comment 幂等锚', () => {
    const e = buildMemoryEntry('剧情记忆', 1, 20, '## 时间地点\n第1年 2月3日')
    expect(e.constant).toBe(true)
    expect(e.comment).toBe('记忆#1-20')
    expect(e.content).toBe('## 时间地点\n第1年 2月3日')
    expect(e.enabled).toBe(true)
    expect(parseMemoryRange(e.comment)).toEqual({ start: 1, end: 20 })
  })

  it('rollbackMemoryBook：覆盖区间触及已消失楼层的条目一并裁（end > cursor）', () => {
    const entries = [
      buildMemoryEntry('剧情记忆', 1, 20, '早'),
      buildMemoryEntry('剧情记忆', 21, 40, '中'),
      buildMemoryEntry('剧情记忆', 41, 60, '晚'),
    ]
    const rb = rollbackMemoryBook(entries, 35)
    // 记忆#21-40 摘要覆盖了 36-40 这些回退后已不存在的楼层 → 一并裁（宁缺毋假）
    expect(rb.entries.map(e => e.comment)).toEqual(['记忆#1-20'])
    expect(rb.lastFloor).toBe(20)
    expect(rb.dropped).toBe(2)
  })

  it('rollbackMemoryBook：非记忆条目保留（不误伤手工条目）', () => {
    const hand = buildMemoryEntry('剧情记忆', 1, 20, '手写')
    hand.comment = '重要设定（手工）' // 非 记忆# 格式
    const rb = rollbackMemoryBook([hand], 0)
    expect(rb.entries).toHaveLength(1)
    expect(rb.lastFloor).toBe(0)
  })

  it('rollbackMemoryBook：全裁 → lastFloor 归零', () => {
    const rb = rollbackMemoryBook([buildMemoryEntry('剧情记忆', 1, 20, 'x')], 5)
    expect(rb.entries).toHaveLength(0)
    expect(rb.lastFloor).toBe(0)
    expect(rb.dropped).toBe(1)
  })
})

describe('buildSummarizePrompt', () => {
  it('协议分节齐全 + 楼层前缀', () => {
    const p = buildSummarizePrompt(1, 2, [
      { floor: 1, role: 'user', text: '你好' },
      { floor: 2, role: 'assistant', text: '（她点头）' },
    ])
    expect(p.system).toContain('## 关键词')
    expect(p.user).toContain('[第1楼·用户]')
    expect(p.user).toContain('[第2楼·角色]')
    expect(p.user).toContain('第 1 到 2 楼')
  })
  it('单楼 2000 字截断 + 总长保尾截断', () => {
    const long = 'x'.repeat(3000)
    const p = buildSummarizePrompt(1, 1, [{ floor: 1, role: 'user', text: long }])
    expect(p.user.includes(long)).toBe(false)
    expect(p.user.length).toBeLessThan(3000 + 200)
  })
  it('摘要字数上限可配置（软指令进 prompt，默认 600）', () => {
    const floors = [{ floor: 1, role: 'user' as const, text: '你好' }]
    expect(buildSummarizePrompt(1, 1, floors).system).toContain('全文不超过 600 字')
    expect(buildSummarizePrompt(1, 1, floors, 1200).system).toContain('全文不超过 1200 字')
    expect(buildSummarizePrompt(1, 1, floors, 50).system).toContain('全文不超过 600 字') // <100 → 默认
  })
})

describe('readConfig（settings 服务缺席/坏值 → 默认）', () => {
  it('undefined → 默认（每N楼总结=11 = vectors-enhanced 原始配置 interval 对齐）', () => {
    expect(readConfig(undefined)).toEqual({ enabled: true, everyN: 11, keepNearFloors: 30, charBudget: 60_000, foldOldFloors: true, summaryMaxChars: 600 })
  })
  it('中文键（Schema 键）合法值透传；非法值钳制', () => {
    expect(readConfig({ 总开关: false, 每N楼总结: 30, 保留近M楼原文: 50, 近窗字符预算: 80_000, 折叠老楼层: false, 摘要字数上限: 800 }))
      .toEqual({ enabled: false, everyN: 30, keepNearFloors: 50, charBudget: 80_000, foldOldFloors: false, summaryMaxChars: 800 })
    expect(readConfig({ 每N楼总结: 3 }).everyN).toBe(11) // <5 → 默认
    expect(readConfig({ 摘要字数上限: 50 }).summaryMaxChars).toBe(600) // <100 → 默认
    expect(readConfig('garbage')).toEqual({ enabled: true, everyN: 11, keepNearFloors: 30, charBudget: 60_000, foldOldFloors: true, summaryMaxChars: 600 })
  })
})

// ---------------------------------------------------------------------------
// planShadowOps（§2.2 上下文瘦身——surface 影子化规划）
// ---------------------------------------------------------------------------

/** surface 节点工厂：seq 递增；文本长度 = text.length（便于字符预算断言） */
function nd(seq: number, kind: 'floor' | 'snapshot', text: string, plugin = 'dsht-rp-plugin', section = 'preset', turn: number | null = null): SurfaceNodeInfo {
  return {
    seq,
    isFloor: kind === 'floor',
    turn,
    isSnapshot: kind === 'snapshot',
    sig: JSON.stringify([plugin, [section]]),
    chars: text.length,
  }
}
/** 连续 seq 的会话形态工厂：每 turn = [5 条快照][user 楼][assistant 楼]，可指定每楼字数。
 *  assistant 节点带 turn 号（turn 1..turns）；同 turn 仅一条（无合并场景），另见合并用例。 */
function surface(turns: number, floorChars: number, snapChars = 200_000 / 5): SurfaceNodeInfo[] {
  const out: SurfaceNodeInfo[] = []
  let seq = 100
  for (let t = 0; t < turns; t++) {
    for (let s = 0; s < 5; s++) out.push(nd(seq++, 'snapshot', 'x'.repeat(snapChars)))
    out.push(nd(seq++, 'floor', 'u'.repeat(Math.floor(floorChars / 2))))
    out.push(nd(seq++, 'floor', 'a'.repeat(Math.floor(floorChars / 2)), 'dsht-rp-plugin', 'preset', t + 1))
  }
  return out
}

describe('planShadowOps：老历史前缀（一个 replace op 覆盖保留窗口之前的全部节点）', () => {
  it('记忆覆盖 105、cursor=114、M=30、预算无限 → 折叠至第 84 楼，保留 85-114 楼', () => {
    const nodes = surface(57, 2_000) // 57 turn = 114 楼
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 105, foldFloors: true, cursor: 114 })
    const prefix = plan.ops.find(o => o.kind === 'history')
    expect(prefix).toBeDefined()
    const kept = nodes.filter(n => n.seq > prefix!.end)
    expect(kept.filter(n => n.isFloor)).toHaveLength(30)
    expect(plan.flooredUpTo).toBe(84)
  })

  it('字符预算钳制：M=30 但预算 6 万字 → 只保留 10 楼（每楼节点 6 千字 × 10 = 6 万）', () => {
    const nodes = surface(57, 12_000) // 每楼节点 6 千字（user+assistant 各半）
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 60_000, memoryMaxFloor: 105, foldFloors: true, cursor: 114 })
    const prefix = plan.ops.find(o => o.kind === 'history')
    expect(prefix).toBeDefined()
    const keptFloors = nodes.filter(n => n.seq > prefix!.end && n.isFloor)
    expect(keptFloors.length).toBe(10)
    expect(keptFloors.reduce((s, n) => s + n.chars, 0)).toBeLessThanOrEqual(60_000)
  })

  it('记忆滞后：记忆只覆盖 50 楼 → 前缀部分覆盖至第 50 楼，51-84 楼留在视图（零信息丢失）', () => {
    const nodes = surface(57, 2_000)
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 50, foldFloors: true, cursor: 114 })
    const prefix = plan.ops.find(o => o.kind === 'history')
    expect(prefix).toBeDefined()
    expect(plan.flooredUpTo).toBe(50)
    // 前缀之外的可见楼层 = 114 - 50 = 64 楼（含未覆盖的 51-84 + 窗口 85-114）
    const keptFloors = nodes.filter(n => n.seq > prefix!.end && n.isFloor)
    expect(keptFloors.length).toBe(64)
  })

  it('记忆为空 → 无前缀 op（零信息丢失）；快照去重仍工作', () => {
    const nodes = surface(57, 2_000)
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 0, foldFloors: true, cursor: 114 })
    expect(plan.ops.every(o => o.kind === 'snapshot')).toBe(true)
    expect(plan.flooredUpTo).toBe(0)
  })

  it('foldFloors=false：不出历史前缀 op（快照去重仍工作）', () => {
    const nodes = surface(57, 2_000)
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 105, foldFloors: false, cursor: 114 })
    expect(plan.ops.every(o => o.kind === 'snapshot')).toBe(true)
    expect(plan.flooredUpTo).toBe(0)
  })
})

describe('planShadowOps：陈旧快照副本去重（每签名保最新一份，其余影子化）', () => {
  it('窗口内 6 turn × 5 快照（同签名）→ 只留最后一份；每 turn 的快照段一个 op（楼层隔断）', () => {
    const nodes = surface(6, 2_000) // 30 楼全在窗口内（M=30、预算无限）
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 105, foldFloors: true, cursor: 12 })
    const snapOps = plan.ops.filter(o => o.kind === 'snapshot')
    expect(snapOps).toHaveLength(6) // 每 turn 的快照块一段（楼层把连续段隔开）
    let shadowedCount = 0
    const lastSnap = [...nodes].reverse().find(n => n.isSnapshot)!
    for (const op of snapOps) {
      const inRange = nodes.filter(n => n.seq >= op.start && n.seq <= op.end)
      expect(inRange.every(n => n.isSnapshot)).toBe(true) // 不夹楼层
      shadowedCount += inRange.length
      expect(op.end).toBeLessThan(lastSnap.seq) // 最新副本绝不被影子化
    }
    expect(shadowedCount).toBe(29) // 30 份 - 保留的最新 1 份
  })

  it('不同签名各自保留最新一份（preset/state/persona 互不挤掉）', () => {
    const nodes: SurfaceNodeInfo[] = []
    let seq = 1
    for (const sig of ['["p",["a"]]', '["p",["b"]]', '["p",["c"]]']) {
      nodes.push({ seq: seq++, isFloor: false, turn: null, isSnapshot: true, sig, chars: 100 })
    }
    // 三个签名各只有一份 → 全部保留，无 op
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 105, foldFloors: true, cursor: 0 })
    expect(plan.ops.filter(o => o.kind === 'snapshot')).toHaveLength(0)
  })

  it('影子化后视图字数 = 保留楼层 + 保留快照 + marker 估算', () => {
    const nodes = surface(6, 2_000)
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 105, foldFloors: true, cursor: 12 })
    expect(plan.charsAfter).toBeLessThan(plan.charsBefore)
    expect(plan.charsAfter).toBeGreaterThan(0)
  })

  it('无楼层节点（全被影子化过的极端会话）→ 只做快照去重，不出历史 op', () => {
    const nodes = [nd(1, 'snapshot', 'x'.repeat(300_000)), nd(2, 'snapshot', 'y'.repeat(300_000))]
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 60_000, memoryMaxFloor: 105, foldFloors: true, cursor: 0 })
    expect(plan.ops.every(o => o.kind === 'snapshot')).toBe(true)
    // 两份同签名 → 留最后一份，影子化第一份
    expect(plan.ops).toHaveLength(1)
    expect(plan.ops[0].start).toBe(1)
    expect(plan.ops[0].end).toBe(1)
  })

  it('est 未超阈值的会话不受影响（阈值判断在钩子层，规划器只管出 op）', () => {
    const nodes = [nd(1, 'floor', '短会话'), nd(2, 'snapshot', 'x'.repeat(500))]
    const plan = planShadowOps(nodes, { keepNearFloors: 30, charBudget: 60_000, memoryMaxFloor: 1, foldFloors: true, cursor: 1 })
    // cursor=1、末楼=第1楼：保留窗口=1 楼；记忆覆盖 1 → 前缀为空；快照去重仍输出
    expect(plan.ops.filter(o => o.kind === 'history')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 展开回显（§2.3 ⑤/④）——纯函数 + planShadowOps 副本管控
// ---------------------------------------------------------------------------

describe('展开回显纯函数', () => {
  it('neutralizeMacros：残留 ASCII 宏全角化；无宏文本原样', () => {
    expect(neutralizeMacros('{{setvar::a::1}}')).toBe('｛｛setvar::a::1｝｝')
    expect(neutralizeMacros('普通文本')).toBe('普通文本')
    expect(neutralizeMacros('嵌套{{a{{b}}c}}尾')).toBe('嵌套｛｛a｛｛b｝｝c｝｝尾')
  })

  it('desiredWindow：窗口触及折叠边界才注回；越界钳位；空窗 null', () => {
    expect(desiredWindow(114, 50, 84)).toEqual({ from: 65, to: 84 })
    expect(desiredWindow(114, 200, 84)).toEqual({ from: 1, to: 84 }) // 头部钳到 1
    expect(desiredWindow(114, 30, 84)).toBeNull()                    // 窗口未触及折叠边界
    expect(desiredWindow(114, 50, 0)).toBeNull()                     // 无折叠
    expect(desiredWindow(0, 50, 84)).toBeNull()                      // 无游标
    expect(desiredWindow(Number.NaN, 50, 84)).toBeNull()
  })

  it('buildExpandSnapshot：尾部优先装配、超预算整楼丢、capped、宏中性化', () => {
    const floors = [
      { floor: 1, role: 'user' as const, text: `甲${'x'.repeat(90)}` },
      { floor: 2, role: 'assistant' as const, text: '{{getvar::状态}}' },
      { floor: 3, role: 'user' as const, text: '丙的剧情' },
    ]
    const r = buildExpandSnapshot('oneshot', 1, 3, floors, 100)
    expect(r).not.toBeNull()
    expect(r!.effectiveTo).toBe(3)
    expect(r!.effectiveFrom).toBe(2) // 第 1 楼 91 字 + 开销超 100 预算 → 整楼丢弃
    expect(r!.capped).toBe(true)
    expect(r!.text).toContain('【展开回显（单次）】第 2-3 楼')
    expect(r!.text).toContain('｛｛getvar::状态｝｝') // 宏已中性化
    expect(r!.text).not.toContain('{{')
    // 预算充足 → 全量、不 capped
    const full = buildExpandSnapshot('window', 1, 3, floors, 10_000)
    expect(full!.effectiveFrom).toBe(1)
    expect(full!.capped).toBe(false)
    expect(full!.text).toContain('【展开回窗】第 1-3 楼')
    // 区间无楼层 → null
    expect(buildExpandSnapshot('oneshot', 9, 9, floors, 1000)).toBeNull()
  })

  it('parseFoldedFromMarker：marker 文本解析边界；非 marker 返回 0', () => {
    expect(parseFoldedFromMarker('[上下文瘦身] 第 1-89 楼原文已折叠，剧情要点见「剧情记忆」快照；以下为最近原文。')).toBe(89)
    expect(parseFoldedFromMarker('[旧快照副本已折叠]')).toBe(0)
    expect(parseFoldedFromMarker('')).toBe(0)
  })

  it('rangeCovers：尾部对齐 + 头部覆盖；capped 副本预算未放大即视为满足', () => {
    const want = { from: 65, to: 84 }
    expect(rangeCovers({ from: 65, to: 84 }, want, 60_000)).toBe(true)
    expect(rangeCovers({ from: 60, to: 84 }, want, 60_000)).toBe(true)  // 覆盖超集
    expect(rangeCovers({ from: 70, to: 84 }, want, 60_000)).toBe(false) // 头部缺失
    expect(rangeCovers({ from: 65, to: 80 }, want, 60_000)).toBe(false) // 尾部缺失
    expect(rangeCovers({ from: 80, to: 84, capped: true, budget: 60_000 }, want, 60_000)).toBe(true)   // capped 满足
    expect(rangeCovers({ from: 80, to: 84, capped: true, budget: 50_000 }, want, 60_000)).toBe(false)  // 预算放大 → 需重注
  })
})

describe('planShadowOps：oneshot / windowCopy 副本管控（§2.3 ⑤/④）', () => {
  const wcopy = (seq: number): SurfaceNodeInfo => ({
    seq, isFloor: false, turn: null, isSnapshot: true,
    sig: JSON.stringify(['dsht-plugin-memory', ['dsht-memory:expand-window']]),
    chars: 100, windowCopy: true,
  })
  const ocopy = (seq: number): SurfaceNodeInfo => ({
    seq, isFloor: false, turn: null, isSnapshot: true,
    sig: JSON.stringify(['dsht-plugin-memory', ['dsht-memory:oneshot']]),
    chars: 100, oneshot: true,
  })
  const plan = (nodes: SurfaceNodeInfo[], windowKeepSeq?: number | null): Array<{ start: number; end: number }> =>
    planShadowOps(nodes, { keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 0, foldFloors: true, cursor: 0, windowKeepSeq })
      .ops.filter(o => o.kind === 'snapshot')
      .map(({ start, end }) => ({ start, end }))

  it('oneshot 副本无条件影子化（即便它是该签名唯一副本）', () => {
    expect(plan([ocopy(1)])).toEqual([{ start: 1, end: 1 }])
  })

  it('windowCopy：windowKeepSeq 缺省 → 普通去重（单副本保留）', () => {
    expect(plan([wcopy(1)])).toHaveLength(0)
    expect(plan([wcopy(1), wcopy(2)])).toEqual([{ start: 1, end: 1 }]) // 同签名留最新
  })

  it('windowCopy：windowKeepSeq=null → 全部影子化（相邻合并一个 op）', () => {
    expect(plan([wcopy(1), wcopy(2)], null)).toEqual([{ start: 1, end: 2 }])
  })

  it('windowCopy：windowKeepSeq 指定 → 指定副本豁免、其余（含最新）影子化', () => {
    expect(plan([wcopy(1), wcopy(2)], 1)).toEqual([{ start: 2, end: 2 }])
    expect(plan([wcopy(1), wcopy(2)], 2)).toEqual([{ start: 1, end: 1 }])
  })
})


// ---------------------------------------------------------------------------
// foldHistory 开关（2026-09-10 心跳 33）：前缀折叠与快照去重解耦
// 背景：80k 触发阈值原按 500k 上下文标定；contextWindow 修为 1M 后，中等会话
// （实测 57.5k est / 185k 字符）整体被短路，13 条快照（占 payload 87%）持续堆叠。
// 现在：前缀折叠（有损）仍受阈值门控；快照去重（无损）任何体积都做。
// ---------------------------------------------------------------------------
describe('planShadowOps：foldHistory 开关（前缀折叠与快照去重解耦）', () => {
  /** 同一 surface 形态：[snapshot][user 楼][assistant 楼] × turns */
  const mixed = (turns: number, snapChars: number): SurfaceNodeInfo[] => {
    const out: SurfaceNodeInfo[] = []
    let seq = 10
    for (let t = 0; t < turns; t++) {
      out.push(nd(seq++, 'snapshot', 'x'.repeat(snapChars)))
      out.push(nd(seq++, 'floor', 'u'.repeat(100)))
      out.push(nd(seq++, 'floor', 'a'.repeat(100), 'dsht-rp-plugin', 'preset', t + 1))
    }
    return out
  }

  it('foldHistory=false → 不产出 history op（前缀原文保留）', () => {
    const nodes = mixed(20, 1_000)
    const plan = planShadowOps(nodes, {
      keepNearFloors: 2, charBudget: 10_000_000, memoryMaxFloor: 40, foldFloors: true, cursor: 40, foldHistory: false,
    })
    expect(plan.ops.some(o => o.kind === 'history')).toBe(false)
    expect(plan.flooredUpTo).toBe(0)
  })

  it('foldHistory=false → 同签名多副本仍被去重（无损收益不受阈值门控）', () => {
    const nodes = mixed(20, 1_000) // 20 组同签名 snapshot
    const plan = planShadowOps(nodes, {
      keepNearFloors: 2, charBudget: 10_000_000, memoryMaxFloor: 40, foldFloors: true, cursor: 40, foldHistory: false,
    })
    expect(plan.ops.some(o => o.kind === 'snapshot')).toBe(true)
    expect(plan.charsAfter).toBeLessThan(plan.charsBefore)
  })

  it('foldHistory=true（缺省）→ 行为与既有语义一致（前缀折叠生效）', () => {
    const nodes = mixed(20, 1_000)
    const withFlag = planShadowOps(nodes, {
      keepNearFloors: 2, charBudget: 10_000_000, memoryMaxFloor: 40, foldFloors: true, cursor: 40, foldHistory: true,
    })
    const defaulted = planShadowOps(nodes, {
      keepNearFloors: 2, charBudget: 10_000_000, memoryMaxFloor: 40, foldFloors: true, cursor: 40,
    })
    expect(withFlag).toEqual(defaulted)
    expect(defaulted.flooredUpTo).toBeGreaterThan(0)
  })

  it('单副本快照 + foldHistory=false → 无任何 op（不白白发 replace）', () => {
    const nodes: SurfaceNodeInfo[] = [
      nd(1, 'snapshot', 'x'.repeat(500), 'dsht-rp-plugin', 'only'),
      nd(2, 'floor', 'u'.repeat(100)),
      nd(3, 'floor', 'a'.repeat(100), 'dsht-rp-plugin', 'preset', 1),
    ]
    const plan = planShadowOps(nodes, {
      keepNearFloors: 30, charBudget: 10_000_000, memoryMaxFloor: 0, foldFloors: true, cursor: 1, foldHistory: false,
    })
    expect(plan.ops).toHaveLength(0)
  })
})
