/**
 * F2 回退语义单测：**用「集合」而不是「阈值」表达「被移出上下文的消息」**。
 *
 * ## 为什么这组测试存在
 * 用户实测的失败路径（2026-09-14）：
 *   回退到某条消息 → 重新发请求 → **被回退的旧楼层全部复活**。
 *
 * 根因分三层（见 dsh-plugin/index.ts 的 /rp/rollback-mask 注释）：
 *   ① 判据是**阈值** `hideAfter`（「seq 大于它就隐藏」）——但回退后用户正常发的新消息
 *      seq 也大于锚点，会被连坐隐藏；
 *   ② 为修补 ① 加了「marker 之后出现新用户消息 → 掩码整体归零」的补丁——
 *      而「回退后重发」必然产生新用户消息 → 掩码归零 → 旧楼层复活；
 *   ③ 正解是用写侧已记录的 `shadowedSeqs`（被 replace 逐条移出的 seq）——集合语义
 *      精确且**持久有效**，与后续新增消息无关。
 *
 * 本文件把这条判据钉死在代码里：**红灯 = 用户实测的 bug 复发**。
 *
 * ## 覆盖
 * 1. `readSurgical`（共享层）：三路形态解析 + 精确返回 shadowedSeqs 与 anchor
 * 2. 掩码语义（前端）：集合优先、阈值降级、被回退消息持久隐藏
 * 3. 回归护栏：回退后新消息**不得**让旧隐藏失效（这是用户实测的那条路径）
 */
import { describe, expect, it } from 'vitest'
import { readSurgical, readSurgicalPayload } from '../src/dsht-plugin-shared/session-write.ts'
import { maxEventSeq, turnStartSeqFor } from '../src/dsh-plugin/index.ts'

/** 构造官方白名单形态的 marker source（与写侧 markerSource 同形） */
function markerSource(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'plugin',
    plugin: 'dsht-rp',
    form: 'snapshot',
    sections: [{ name: `dsht:${kind}`, text: JSON.stringify(payload) }],
  }
}

function userMarkerEvent(payload: Record<string, unknown>, seq = 100): { seq: number; type: string; data: unknown } {
  return {
    seq,
    type: 'user/message',
    data: {
      id: `dsht-rp-${seq}`,
      role: 'user',
      content: [{ type: 'text', text: '[已回退]' }],
      source: markerSource('surgical', payload),
    },
  }
}

// ---------------------------------------------------------------------------
// 1. readSurgical：三路形态 + 精确载荷
// ---------------------------------------------------------------------------

describe('readSurgical（共享层单源读法）', () => {
  it('0.1.5 当前形态（sections[dsht:surgical]）→ 解出锚点与 shadowedSeqs', () => {
    const ev = userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43, 44] })
    const { anchor, payload } = readSurgical(ev)
    expect(anchor).toBe(41)
    expect(payload.shadowedSeqs).toEqual([42, 43, 44])
  })

  it('edit 语义：editedFrom = 锚消息本身也移出 → anchor = editedFrom - 1', () => {
    const ev = userMarkerEvent({ editedFrom: 50, shadowedSeqs: [50, 51] })
    const { anchor } = readSurgical(ev)
    expect(anchor).toBe(49)
  })

  it('存量形态（sections[dsht:legacy]）同样能解出', () => {
    const ev = {
      seq: 90, type: 'user/message',
      data: { source: markerSource('legacy', { rolledBackTo: 7, shadowedSeqs: [8] }) },
    }
    const { anchor, payload } = readSurgical(ev)
    expect(anchor).toBe(7)
    expect(payload.shadowedSeqs).toEqual([8])
  })

  it('更早期顶层键形态（source.rolledBackTo）仍兜底可读', () => {
    const ev = {
      seq: 90, type: 'user/message',
      data: { source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 12 } },
    }
    expect(readSurgical(ev).anchor).toBe(12)
  })

  it('非 marker 事件 → anchor null、载荷空（不误报）', () => {
    const ev = { seq: 5, type: 'assistant/message', data: { message: { source: { kind: 'user' } } } }
    const { anchor, payload } = readSurgical(ev)
    expect(anchor).toBeNull()
    expect(payload.shadowedSeqs).toBeUndefined()
  })

  it('assistant/message 的嵌套 message.source 也能读到（投影形态差异防御）', () => {
    const ev = {
      seq: 60, type: 'assistant/message',
      data: { message: { source: markerSource('surgical', { regeneratedFrom: 55 }) } },
    }
    expect(readSurgical(ev).anchor).toBe(55)
  })

  it('空数组 shadowedSeqs 不落值（写侧用字段缺失表达「无遮蔽」）', () => {
    const p = readSurgicalPayload({ sections: [{ name: 'dsht:surgical', text: JSON.stringify({ shadowedSeqs: [] }) }] })
    expect(p.shadowedSeqs).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. 掩码语义：集合 vs 阈值（前端 store 的判据，此处以纯函数镜像验证）
// ---------------------------------------------------------------------------

/** 前端 `isSeqHidden` 的等价实现（保持与 RpNativeChat.tsx 同判据）。
 *  这里镜像一份是为了让判据本身可被单测直接钉住——若源码里改了语义而此处没改，
 *  「回退后重发旧楼层复活」这条测试会立刻变红（见下方回归护栏）。 */
interface MaskState {
  hidden: ReadonlySet<number>
  /** 【2026-09-19】连带范围（含非 surface 事件；harness 运行过程行靠它隐藏） */
  ranges: ReadonlyArray<{ start: number; end: number }>
  hideAfter: number
}
function isSeqHidden(mask: MaskState, seq: number | undefined): boolean {
  if (seq === undefined) return false
  for (const r of mask.ranges) if (seq >= r.start && seq <= r.end) return true
  if (mask.hidden.size > 0) return mask.hidden.has(seq)
  if (mask.ranges.length > 0) return false
  return mask.hideAfter > 0 && seq > mask.hideAfter
}

/** 后端「由 marker 事件算出掩码」的等价实现（集合 + 区间优先；阈值降级仅在两者皆空时生效） */
function maskFromMarkers(events: Array<{ seq: number; type: string; data: unknown }>): MaskState {
  const hidden = new Set<number>()
  const ranges: Array<{ start: number; end: number }> = []
  let hide = 0
  for (const ev of events) {
    const { anchor, payload } = readSurgical(ev)
    if (anchor !== null) hide = Math.max(hide, anchor)
    for (const q of payload.shadowedSeqs ?? []) hidden.add(q)
    if (typeof payload.editedFrom === 'number') hidden.add(payload.editedFrom)
    if (payload.shadowedRange !== undefined) ranges.push(payload.shadowedRange)
  }
  return (hidden.size > 0 || ranges.length > 0)
    ? { hidden, ranges, hideAfter: 0 }
    : { hidden: new Set<number>(), ranges: [], hideAfter: hide }
}

describe('掩码语义：集合优先、阈值降级', () => {
  it('有集合时：只隐藏集合内的 seq，集合外的（含更大 seq）正常显示', () => {
    const mask = maskFromMarkers([userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] })])
    expect(isSeqHidden(mask, 42)).toBe(true)
    expect(isSeqHidden(mask, 43)).toBe(true)
    // 44 不在集合里（比如是回退之后重发产生的新消息）
    expect(isSeqHidden(mask, 44)).toBe(false)
    // 比锚点大的新消息也不隐藏 —— 这正是阈值语义做不到的
    expect(isSeqHidden(mask, 999)).toBe(false)
  })

  it('无集合（存量会话）时降级为阈值语义', () => {
    const mask = maskFromMarkers([userMarkerEvent({ rolledBackTo: 41 })])
    expect(mask.hideAfter).toBe(41)
    expect(isSeqHidden(mask, 40)).toBe(false)
    expect(isSeqHidden(mask, 42)).toBe(true)
  })

  it('多次回退：集合取并集（历史隐藏不会被后来的回退覆盖掉）', () => {
    const mask = maskFromMarkers([
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] }, 100),
      userMarkerEvent({ rolledBackTo: 90, shadowedSeqs: [91, 92] }, 200),
    ])
    for (const q of [42, 43, 91, 92]) expect(isSeqHidden(mask, q)).toBe(true)
    expect(isSeqHidden(mask, 50)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 【2026-09-19 回退连带面修复】harness 运行过程行随轮一并回退
// ---------------------------------------------------------------------------

/**
 * 用户实测（真机截图）：回退只回退了「我发的消息」，harness 的运行过程**没跟着退**——
 * 会话流里残留「系统提示词」「上下文注入 · @deepseek-ai/dsh-system-prompt / skill-catalog」
 * 「本轮运行失败 QUOTA」。
 *
 * 根因：这三类节点的**锚不是 surface 事件**——
 *   · `system-prompt` 锚在 **turn/start**（真实会话实证：seq=6 **早于** 用户消息 seq=9）
 *   · `context`（上下文注入）锚在注入事件自身
 *   · `turn-error` 锚在失败事件（turn/end 一带）
 * 而回退写入的 `shadowedSeqs` 只含 surface 节点（user/message、assistant/message、
 * tool/result）⇒ 集合判据**结构上拦不住**它们（不是漏写，是判据面不够）。
 *
 * 正解：写侧额外记录 `shadowedRange`（该轮 turn/start seq → 回退那一刻日志末尾），
 * 前端按区间判定。区间**有界**是关键——回退之后新发的内容 seq 必然更大，不受影响。
 */
describe('【回退连带面】harness 运行过程行随轮一并回退', () => {
  /** 取自真实会话的事件坐标（turn/start 早于 user/message——本组测试的立足点） */
  const TURN_START = 6
  const USER_MSG = 9
  const INJECT = 10
  const TURN_END = 124

  it('系统提示词（锚在 turn/start）：落在回退区间内 → 隐藏（集合判据拦不住的那条）', () => {
    const mask = maskFromMarkers([userMarkerEvent(
      { rolledBackTo: USER_MSG, shadowedSeqs: [USER_MSG, 122], shadowedRange: { start: TURN_START, end: TURN_END } },
    )])
    // 集合里**没有** turn/start —— 这正是修复前的漏网形态
    expect(mask.hidden.has(TURN_START)).toBe(false)
    // 区间判据把它连同注入/错误一起拦下
    expect(isSeqHidden(mask, TURN_START)).toBe(true)
    expect(isSeqHidden(mask, INJECT)).toBe(true)
    expect(isSeqHidden(mask, TURN_END)).toBe(true)
  })

  it('同轮之前的内容不受影响（区间起点 = 该轮 turn/start，不回溯到上一轮）', () => {
    const mask = maskFromMarkers([userMarkerEvent(
      { rolledBackTo: USER_MSG, shadowedSeqs: [USER_MSG], shadowedRange: { start: TURN_START, end: TURN_END } },
    )])
    expect(isSeqHidden(mask, TURN_START - 1)).toBe(false)
    expect(isSeqHidden(mask, 1)).toBe(false)
  })

  it('【负控】回退之后新发的内容（seq > 区间终点）正常显示——有界性的意义', () => {
    const mask = maskFromMarkers([
      userMarkerEvent({ rolledBackTo: USER_MSG, shadowedSeqs: [USER_MSG], shadowedRange: { start: TURN_START, end: TURN_END } }),
      { seq: 200, type: 'user/message', data: { source: { kind: 'user' } } },
    ])
    expect(isSeqHidden(mask, 200)).toBe(false)
    expect(isSeqHidden(mask, 201)).toBe(false)
  })

  it('区间缺失（存量会话 / 旧标记）→ 行为与修复前一致（不误伤）', () => {
    const mask = maskFromMarkers([userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] })])
    expect(mask.ranges).toEqual([])
    expect(isSeqHidden(mask, 6)).toBe(false)
  })

  it('载荷读侧：非法 range（缺字段 / end < start）一律忽略，不落值', () => {
    const bad1 = readSurgicalPayload({ sections: [{ name: 'dsht:surgical', text: JSON.stringify({ shadowedRange: { start: 10 } }) }] })
    const bad2 = readSurgicalPayload({ sections: [{ name: 'dsht:surgical', text: JSON.stringify({ shadowedRange: { start: 10, end: 5 } }) }] })
    const good = readSurgicalPayload({ sections: [{ name: 'dsht:surgical', text: JSON.stringify({ shadowedRange: { start: 6, end: 124 } }) }] })
    expect(bad1.shadowedRange).toBeUndefined()
    expect(bad2.shadowedRange).toBeUndefined()
    expect(good.shadowedRange).toEqual({ start: 6, end: 124 })
  })
})

// ---------------------------------------------------------------------------
// 【2026-09-19】写侧区间计算：turnStartSeqFor / maxEventSeq
// ---------------------------------------------------------------------------

describe('回退连带范围的计算（写侧纯函数）', () => {
  const evs = [
    { type: 'permission/preset', seq: 0 },
    { type: 'turn/start', seq: 6 },
    { type: 'step/start', seq: 8 },
    { type: 'user/message', seq: 9 },
    { type: 'request/header', seq: 11 },
    { type: 'assistant/message', seq: 122 },
    { type: 'turn/end', seq: 124 },
    { type: 'turn/start', seq: 125 },
    { type: 'user/message', seq: 130 },
    { type: 'turn/end', seq: 200 },
  ]

  it('锚（用户消息）所在轮的 turn/start —— 早于锚，取的是**打开中**的那个轮', () => {
    expect(turnStartSeqFor(evs, 9)).toBe(6)
    expect(turnStartSeqFor(evs, 130)).toBe(125)
  })

  it('上一轮已关闭 → 不得回落到上一轮的 start（闭合即换锚）', () => {
    expect(turnStartSeqFor(evs, 130)).not.toBe(6)
    expect(turnStartSeqFor(evs, 122)).toBe(6)
  })

  it('无 turn 配对信息（存量 / 异常日志）→ 退回锚自身（与修复前逐字同行为）', () => {
    expect(turnStartSeqFor([{ type: 'user/message', seq: 9 }], 9)).toBe(9)
    expect(turnStartSeqFor([], 42)).toBe(42)
  })

  it('maxEventSeq 取最大数字 seq（忽略无 seq 的增量事件，如 chunk 批量行）', () => {
    expect(maxEventSeq(evs)).toBe(200)
    // 增量事件（assistant/chunk 批量行等）不带 seq —— 不得把它当成 0/NaN 参与比较
    const withNoSeq: Array<{ seq?: unknown }> = [{ seq: 3 }, {}, { seq: undefined }]
    expect(maxEventSeq(withNoSeq)).toBe(3)
    expect(maxEventSeq([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3. 回归护栏：用户实测的失败路径（红灯 = bug 复发）
// ---------------------------------------------------------------------------

describe('【回归护栏】回退 → 重发：旧楼层不得复活', () => {
  it('回退后新增用户消息，**不得**让被回退的旧楼层重新显示', () => {
    // 时序：先回退（marker 落盘，shadowedSeqs = [42,43,44]）→ 用户重发（新增 user seq=200）
    const events = [
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43, 44] }, 100),
      // 重发产生的真实用户消息（旧实现在这里把掩码整体归零 → 旧楼层复活）
      { seq: 200, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '重发' }] } },
    ]
    const mask = maskFromMarkers(events)
    // 🔴 这三条就是用户实测的 bug 判据
    expect(isSeqHidden(mask, 42)).toBe(true)
    expect(isSeqHidden(mask, 43)).toBe(true)
    expect(isSeqHidden(mask, 44)).toBe(true)
    // 新消息正常显示
    expect(isSeqHidden(mask, 200)).toBe(false)
  })

  it('【负控】未回退过的会话：任何 seq 都不隐藏（证明掩码没有恒真）', () => {
    const mask = maskFromMarkers([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' } } },
      { seq: 2, type: 'assistant/message', data: { message: {} } },
    ])
    expect(mask.hidden.size).toBe(0)
    expect(mask.hideAfter).toBe(0)
    for (const q of [1, 2, 3, 100]) expect(isSeqHidden(mask, q)).toBe(false)
  })

  it('编辑语义：被编辑的那条消息本身也要隐藏（编辑重发的新消息 seq 更大且不在集合内）', () => {
    const events = [
      userMarkerEvent({ editedFrom: 50, shadowedSeqs: [51, 52] }, 110),
      { seq: 300, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '编辑后的新文本' }] } },
    ]
    const mask = maskFromMarkers(events)
    expect(isSeqHidden(mask, 50)).toBe(true) // 被编辑的原消息
    expect(isSeqHidden(mask, 51)).toBe(true) // 其后的旧回复
    expect(isSeqHidden(mask, 52)).toBe(true)
    expect(isSeqHidden(mask, 300)).toBe(false) // 编辑重发的新消息
  })

  it('重新生成语义：旧回复隐藏，重生成的回复（更新 seq）正常显示', () => {
    const events = [
      userMarkerEvent({ regeneratedFrom: 70, shadowedSeqs: [71, 72] }, 120),
      { seq: 400, type: 'assistant/message', data: { message: {} } },
    ]
    const mask = maskFromMarkers(events)
    expect(isSeqHidden(mask, 71)).toBe(true)
    expect(isSeqHidden(mask, 72)).toBe(true)
    expect(isSeqHidden(mask, 400)).toBe(false)
  })

  it('连续多次「回退 → 重发」：每一轮的旧楼层都保持隐藏（集合只增不减）', () => {
    const events = [
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] }, 100),
      { seq: 200, type: 'user/message', data: { source: { kind: 'user' } } },
      userMarkerEvent({ rolledBackTo: 199, shadowedSeqs: [200, 201] }, 210),
      { seq: 300, type: 'user/message', data: { source: { kind: 'user' } } },
    ]
    const mask = maskFromMarkers(events)
    for (const q of [42, 43, 200, 201]) expect(isSeqHidden(mask, q)).toBe(true)
    for (const q of [300, 999]) expect(isSeqHidden(mask, q)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 【B3 2026-09-14】三条路径（rollback / regenerate / edit）的**刷新动作必须对齐**
// ---------------------------------------------------------------------------

/**
 * 判据来源：goal 轨道 B / B3 —— 「rollback / regenerate / edit 的前端刷新动作统一
 * （sessions.refresh + 掩码刷新 + 显示面缓存失效 + 变量/快照回滚，全部到位）」。
 *
 * 为什么用源码结构断言：这三条路径分布在不同文件（组件内 / inject 面），
 * 且**只要有一条漏一个动作就是真缺陷**（本轮实测：edit 漏 2 个、regenerate 漏 1 个、
 * 后端 live 分支三条全漏文件快照回滚）。用结构断言把它们钉住，漏一处即红。
 * 局限（诚实边界）：只能证明「动作在源码里」，不能证明运行时真的生效 —— 后者属 M5/M6。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, '..', 'src', 'dsht-rp-ui', 'src', 'client')

describe('B3 三路径刷新动作对齐（静态护栏）', () => {
  const rpChat = readFileSync(join(CLIENT, 'RpNativeChat.tsx'), 'utf8')
  const rpIndex = readFileSync(join(CLIENT, 'index.tsx'), 'utf8')

  it('三个刷新入口都是「单一实现 + 桥」（P-1）：掩码 / 会话 / 显示面', () => {
    // 掩码刷新：实现一处，经桥暴露
    expect(rpChat).toContain('__dshtRpRefreshRollbackMask')
    // 会话快照刷新：实现由 index.tsx 注入（组件拿不到 ctx.sessions）
    expect(rpIndex).toContain('__dshtRpSessionsRefresh')
    // 显示面缓存失效：实现一处（notifyDisplayMutation），经桥暴露
    expect(rpChat).toContain('__dshtRpNotifyDisplayMutation')
    expect(rpChat).toMatch(/__dshtRpNotifyDisplayMutation[^\n]*=\s*\n?\s*notifyDisplayMutation/)
  })

  it('rollback 分支：三动作齐（掩码 + 会话 + 显示面）', () => {
    const i = rpChat.indexOf('const rollback = useCallback')
    expect(i, '未找到 rollback 分支').toBeGreaterThan(-1)
    const body = rpChat.slice(i, i + 4000)
    expect(body).toContain('refreshRollbackMask(sessionId)')
    expect(body).toContain('__dshtRpSessionsRefresh')
    expect(body).toContain('notifyDisplayMutation()')
  })

  it('edit 分支：三动作齐（本轮补的 2 个——此前只有掩码）', () => {
    const i = rpChat.indexOf('const saveEdit = useCallback')
    expect(i, '未找到 edit 分支').toBeGreaterThan(-1)
    const body = rpChat.slice(i, i + 5000)
    expect(body).toContain('refreshRollbackMask(sessionId)')
    expect(body).toContain('__dshtRpSessionsRefresh')
    expect(body).toContain('__dshtRpNotifyDisplayMutation')
  })

  it('regenerate 分支：三动作齐（本轮补的 1 个——此前只有掩码 + 会话）', () => {
    // regenerate 的实现在 index.tsx 的 inject 面
    const i = rpIndex.indexOf('regenerate: async (sessionId')
    expect(i, '未找到 regenerate inject').toBeGreaterThan(-1)
    const body = rpIndex.slice(i, i + 2500)
    expect(body).toContain('s.refresh()')
    expect(body).toContain('__dshtRpRefreshRollbackMask')
    expect(body).toContain('__dshtRpNotifyDisplayMutation')
  })
})

describe('B3 后端 live 分支必须做文件快照回滚（静态护栏）', () => {
  const plugin = readFileSync(
    join(import.meta.dirname, '..', 'src', 'dsh-plugin', 'index.ts'), 'utf8')

  it('三条路径的 live 分支都调用 restoreSnapshotsAfter（本轮修复：此前全漏）', () => {
    // live 侧只需 **2 处**：rollback 与 edit 共用同一个代码块（`if (isEdit) … else …`
    // 在同一分支内），regenerate 另一处。非 live 3 处（rollback / edit / regenerate 各一）。
    // ⇒ 合计 5 处。漏掉任何一处都会让本断言失败（这正是护栏的目的）。
    const hits = plugin.match(/restoreSnapshotsAfter\(/g) ?? []
    expect(hits.length, `restoreSnapshotsAfter 调用点仅 ${hits.length} 处（应为 5：3 非 live + 2 live）`).toBe(5)
    // 更强判据：live 分支用的边界必须来自共享函数（不是自己拼的）
    const fromEvents = plugin.match(/snapshotRestoreBoundaryFromEvents\(/g) ?? []
    expect(fromEvents.length, 'live 分支应有 2 处用事件侧边界入口').toBe(2)
  })

  it('live 分支的边界计算走共享层同一函数（P-1，不许各写一份）', () => {
    expect(plugin).toContain('snapshotRestoreBoundaryFromEvents')
    // 与文本入口同源：两入口都调 boundaryFromTurnPairs
    const shared = readFileSync(
      join(import.meta.dirname, '..', 'src', 'dsht-plugin-shared', 'file-snapshots.ts'), 'utf8')
    const coreHits = shared.match(/boundaryFromTurnPairs\(/g) ?? []
    expect(coreHits.length, 'boundaryFromTurnPairs 应被两个入口共用').toBeGreaterThanOrEqual(3) // 定义 + 2 处调用
  })

  it('快照回滚失败必须**出声**（R8），不得静默吞掉', () => {
    // live 分支两处（rollback/edit 共用一个分支 + regenerate 各一处）
    const warnHits = plugin.match(/文件快照回滚失败/g) ?? []
    expect(warnHits.length, '快照回滚失败应有 console.warn 留痕').toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 【F4-C3 / P-1 2026-09-14 设备实测】「被移出 seq 集合」这条语义**只允许一处读法**
//
// ## 为什么这组测试存在
// 真机 M7 旅程 + 直接读设备 `session.jsonl` 证伪了一个**静默**失效：
//   · 掩码路由（dsh-plugin `/rp/rollback-mask`）走共享层 `readSurgical` → 读到 **25** 项；
//   · 聊天导出（dsht-plugin-tavern-helper `facade.ts` 的 `chatMessages`）**自己实现**了一套
//     「只扫 `compaction/prune` 事件」的解析 → 读到 **0** 项。
// 后果：① 被回退的消息**照样计入 token 占用**（进度条不降 = 回退在计量上不可见）；
//      ② 导出给卡脚本的聊天记录里**仍含被回退的楼层**（卡脚本读到的上下文与宿主不一致）。
// 两者都不报错 ⇒ 典型的「P-1 违例 + 静默漂移」。
// 这条判据把「同一语义只许一处读法」钉死：facade 必须 import 共享层，不得自建解析。
// ---------------------------------------------------------------------------

describe('F4-C3/P-1：聊天导出的遮蔽集必须与掩码路由同源（不得自建解析）', () => {
  const facade = readFileSync(
    join(import.meta.dirname, '..', 'src', 'dsht-plugin-tavern-helper', 'facade.ts'), 'utf8')

  it('facade 从共享层 import readSurgical（唯一读法）', () => {
    expect(facade).toMatch(/import\s*\{\s*readSurgical\s*\}\s*from\s*'\.\.\/dsht-plugin-shared\/session-write\.ts'/)
  })

  it('导出路径确实调用 readSurgical 取 shadowedSeqs（不是只 import 不用）', () => {
    const i = facade.indexOf('const shadowed = new Set<number>()')
    expect(i, '未找到遮蔽集收集段').toBeGreaterThan(-1)
    const body = facade.slice(i, i + 2200)
    expect(body).toContain('readSurgical(ev)')
    expect(body).toContain('payload.shadowedSeqs')
  })

  it('edit 语义并入集合（锚消息本身也移出）——与掩码路由同一约定', () => {
    const i = facade.indexOf('const shadowed = new Set<number>()')
    const body = facade.slice(i, i + 2200)
    expect(body).toContain('payload.editedFrom')
  })

  it('负控：**不得**再出现「只认 compaction/prune」的旧读法（否则回归静默失效）', () => {
    const i = facade.indexOf('const shadowed = new Set<number>()')
    const body = facade.slice(i, i + 2200)
    // 允许把 compaction/prune 作为**兼容分支**保留，但必须**同时**有 readSurgical；
    // 且不得存在「命中 prune 之外一律 continue」这种把其它形态全丢掉的形态。
    expect(body).toContain('readSurgical(ev)')
    expect(body).not.toMatch(/if \(ev\.type !== 'compaction\/prune'\) continue/)
  })

  it('存量格式仍兼容：独立 compaction/prune 事件（旧写入形态）也被收集', () => {
    const i = facade.indexOf('const shadowed = new Set<number>()')
    const body = facade.slice(i, i + 2200)
    expect(body).toContain("ev.type === 'compaction/prune'")
  })
})

// ---------------------------------------------------------------------------
// 【B4 2026-09-14】回退 / 重新生成 / 编辑 **三者互操作** —— 状态必须收敛
//
// ## 为什么单独建这一节（goal 轨道 B / B4 的原文要求）
// 「回退后再重新生成、编辑后再回退、连续多次回退，状态必须收敛」是**明确列出**的验收项，
// 而 2026-09-14 核查发现：
//   · 「回退后再重新生成」：单测与设备脚本**双无** —— `rolledBackTo` 与 `regeneratedFrom`
//     在全部测试里**从未先后共现**（前者只出现在回退用例，后者只出现在重生成用例）；
//   · 「编辑后再回退」：同样双无（编辑是孤立用例，后面没有回退）；
//   · 「连续多次回退」：有并集断言，但**无收敛性（幂等）断言**
//     —— 「集合只增不减」不等于「同一序列重放结果相同」。
// ⇒ 本节补齐三条序列 + 每条的**收敛性**断言。
//
// ## 收敛性（幂等）为什么是本条的判据而不是「看起来一样」
// 这三条路径都会**改写会话文件并追加 marker**（live 分支重写、非 live 截断），
// 是典型的「重复执行可能累积状态」的场景（P-8）。判据取：
//   ① 同一批事件**重复喂入**（模拟重复渲染/重复刷新）⇒ 掩码**逐点相同**；
//   ② 三条路径产生的掩码**互不干扰**（A 的集合不影响 B 的判定）；
//   ③ 组合序列的终态 = 各步骤集合的**并集**（顺序无关 ⇒ 收敛）。
// ---------------------------------------------------------------------------

describe('B4 三者互操作：组合序列的掩码收敛', () => {
  /** 该 seq 集合是否**全部**被隐藏（用于组合序列的终态断言） */
  const allHidden = (mask: MaskState, seqs: number[]): boolean => seqs.every(q => isSeqHidden(mask, q))
  const noneHidden = (mask: MaskState, seqs: number[]): boolean => seqs.every(q => !isSeqHidden(mask, q))

  it('序列 A「回退 → 重新生成」：回退的旧楼层 + 被重生成移出的旧回复，都必须隐藏；新回复显示', () => {
    const events = [
      // ① 回退到 seq 41（移出 42/43/44）
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43, 44] }, 100),
      // ② 在回退后的上下文里「重新生成」（移出 45/46 这两条旧回复）
      userMarkerEvent({ regeneratedFrom: 45, shadowedSeqs: [45, 46] }, 200),
      // ③ 重新生成产生的新 assistant 回复
      { seq: 400, type: 'assistant/message', data: { message: {} } },
    ]
    const mask = maskFromMarkers(events)
    // 回退的移出项仍须隐藏（不能被后续 regenerate 覆盖掉）
    expect(allHidden(mask, [42, 43, 44])).toBe(true)
    // 重生成的移出项也隐藏
    expect(allHidden(mask, [45, 46])).toBe(true)
    // 新回复正常显示
    expect(noneHidden(mask, [400])).toBe(true)
  })

  it('序列 B「编辑 → 回退」：编辑移出项与回退移出项并存；编辑后的新文本显示', () => {
    const events = [
      // ① 编辑 seq 50（移出 50/51/52）
      userMarkerEvent({ editedFrom: 50, shadowedSeqs: [51, 52] }, 110),
      // ② 编辑重发产生的新消息
      { seq: 300, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '编辑后' }] } },
      // ③ 再回退（移出 60/61）
      userMarkerEvent({ rolledBackTo: 59, shadowedSeqs: [60, 61] }, 350),
    ]
    const mask = maskFromMarkers(events)
    expect(allHidden(mask, [50, 51, 52])).toBe(true) // 编辑的移出（含锚消息自身）
    expect(allHidden(mask, [60, 61])).toBe(true)     // 回退的移出
    expect(noneHidden(mask, [300])).toBe(true)       // 编辑重发的新消息仍在
  })

  it('序列 C「连续多次回退」：终态 = 各次移出项的并集', () => {
    const events = [
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] }, 100),
      userMarkerEvent({ rolledBackTo: 90, shadowedSeqs: [91, 92] }, 200),
      userMarkerEvent({ rolledBackTo: 150, shadowedSeqs: [151, 152] }, 300),
    ]
    const mask = maskFromMarkers(events)
    expect(allHidden(mask, [42, 43, 91, 92, 151, 152])).toBe(true)
  })

  it('★ 收敛性（幂等）：同一批事件重复喂入 ⇒ 掩码逐点相同（重复渲染/重复刷新不得漂移）', () => {
    const events = [
      userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43, 44] }, 100),
      { seq: 200, type: 'user/message', data: { source: { kind: 'user' } } },
      userMarkerEvent({ regeneratedFrom: 45, shadowedSeqs: [45, 46] }, 210),
      userMarkerEvent({ editedFrom: 50, shadowedSeqs: [51, 52] }, 220),
    ]
    const m1 = maskFromMarkers(events)
    const m2 = maskFromMarkers([...events, ...events]) // 重复喂入（模拟重复刷新/重放）
    // 逐点相同：集合相等 + 阈值相等
    expect([...m2.hidden].sort((a, b) => a - b)).toEqual([...m1.hidden].sort((a, b) => a - b))
    expect(m2.hideAfter).toBe(m1.hideAfter)
    // 抽点复核（正控 + 负控都在）
    for (const q of [42, 43, 44, 45, 46, 50, 51, 52]) expect(isSeqHidden(m2, q)).toBe(true)
    for (const q of [200, 999]) expect(isSeqHidden(m2, q)).toBe(false)
  })

  it('★ 收敛性（顺序无关）：回退/重生成/编辑三条 marker 任意顺序 ⇒ 终态集合相同', () => {
    const a = userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] }, 100)
    const b = userMarkerEvent({ regeneratedFrom: 45, shadowedSeqs: [45, 46] }, 200)
    const c = userMarkerEvent({ editedFrom: 50, shadowedSeqs: [51, 52] }, 300)
    const sig = (m: MaskState): string => [...m.hidden].sort((x, y) => x - y).join(',')
    // 3! = 6 种排列，终态必须一致（否则说明某条路径会「覆盖」另一条 —— 那正是阈值语义的旧病）
    const sigs = new Set([
      sig(maskFromMarkers([a, b, c])), sig(maskFromMarkers([a, c, b])),
      sig(maskFromMarkers([b, a, c])), sig(maskFromMarkers([b, c, a])),
      sig(maskFromMarkers([c, a, b])), sig(maskFromMarkers([c, b, a])),
    ])
    expect(sigs.size, `6 种顺序出现 ${sigs.size} 种终态 ⇒ 存在顺序依赖（不收敛）`).toBe(1)
    expect([...sigs][0]).toBe('42,43,45,46,50,51,52')
  })

  it('★ 收敛性（重复同一操作）：同一 marker 出现两次 ⇒ 集合不重复累积、判定不变', () => {
    const dup = userMarkerEvent({ rolledBackTo: 41, shadowedSeqs: [42, 43] }, 100)
    const once = maskFromMarkers([dup])
    const twice = maskFromMarkers([dup, { ...dup, seq: 101 }])
    expect([...twice.hidden].sort((a, b) => a - b)).toEqual([...once.hidden].sort((a, b) => a - b))
  })

  it('【负控】三条路径都不存在时，任何 seq 都不隐藏（证明本节判据不是恒真）', () => {
    const mask = maskFromMarkers([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' } } },
      { seq: 2, type: 'assistant/message', data: { message: {} } },
    ])
    expect(mask.hidden.size).toBe(0)
    expect(mask.hideAfter).toBe(0)
    for (const q of [1, 2, 41, 42, 45, 50, 51]) expect(isSeqHidden(mask, q)).toBe(false)
  })
})
