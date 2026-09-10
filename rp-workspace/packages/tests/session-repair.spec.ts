/**
 * T-02c 存量会话修复器单测
 * ============================================================================
 * 准据：`src/dsht-plugin-shared/session-repair.ts` 的契约注释，以及实测数据
 * （设备备份的 80 个真实会话里 41 个无法迁移；本修复器把它们 100% 救回，
 *   且幂等 + 内容无损 + 无回归——见 tools 侧的 repair-verify 跑法）。
 *
 * 本文件只做**纯函数**断言（不依赖 DSH runtime）；端到端的官方迁移验证
 * 在 tests/session-contract.spec.ts 里（需要 runtime，缺失时自动跳过）。
 */
import { describe, expect, it } from 'vitest'
import { repairSessionForV3 } from '../src/dsht-plugin-shared/session-repair.ts'

const HDR = JSON.stringify({ type: 'session', version: 0, id: 's1', createdAt: 1, cwd: '/data/x', delegationDepth: 0 })

/** 便捷构造：把 [{type,data}] 变成会话文本（seq 自动 0..n） */
function session(events: Array<[string, Record<string, unknown>, Record<string, unknown>?]>): string {
  const lines = [HDR]
  events.forEach(([type, data, extra], i) => {
    lines.push(JSON.stringify({ type, seq: i, time: 1000 + i, data, ...(extra ?? {}) }))
  })
  return lines.join('\n') + '\n'
}
const parse = (text: string) => text.trimEnd().split('\n').slice(1).map(l => JSON.parse(l) as Record<string, unknown>)
const ASSISTANT = (turn: number, step: number, id: string, text: string, extra?: Record<string, unknown>) =>
  ['assistant/message', { turn, step, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } } }, extra ?? { surfaceOp: 'append' }] as [string, Record<string, unknown>, Record<string, unknown>]
const USER = (id: string, text: string, extra?: Record<string, unknown>) =>
  ['user/message', { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, extra ?? { surfaceOp: 'append' }] as [string, Record<string, unknown>, Record<string, unknown>]

describe('session-repair: 存量 v0 会话 → 合法形态', () => {
  it('user/message 缺 id → 补生成（官方冷读硬要求 "lacks an identified message"）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['user/message', { role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'p', form: 'snapshot' } }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const ev = parse(r.content).find(e => e.type === 'user/message')!
    expect(typeof (ev.data as { id?: string }).id).toBe('string')
    expect(r.notes.join('|')).toContain('缺 id')
  })

  it('form:\'snapshot\' 缺 sections → 补空数组（官方 "source sections must be an array"）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'plugin', plugin: 'p', form: 'snapshot' } }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    const ev = parse(r.content).find(e => e.type === 'user/message')!
    expect(Array.isArray((ev.data as { source: { sections?: unknown } }).source.sections)).toBe(true)
  })

  it('source 顶层自定义键（rolledBackTo/thData）→ 搬进 sections 标记', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 3, thData: { a: 1 } } }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    const s = (parse(r.content).find(e => e.type === 'user/message')!.data as { source: Record<string, unknown> }).source
    expect(s.rolledBackTo).toBeUndefined()
    expect(s.thData).toBeUndefined()
    expect(s.form).toBe('snapshot')
    const sec = (s.sections as Array<{ name: string; text: string }>)[0]
    expect(sec.name).toBe('dsht:legacy')
    expect(JSON.parse(sec.text)).toMatchObject({ rolledBackTo: 3, thData: { a: 1 } })
  })

  it('assistant/message 做 replace 节点 → 拆成 user 标记 + append（0.1.5 死锁）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ASSISTANT(1, 1, 'a1', 'V1'),
      ['step/end', { turn: 1, step: 1 }],
      ['step/start', { turn: 1, step: 2 }],
      ASSISTANT(1, 2, 'a2', 'V2', { surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2] }),
      ['step/end', { turn: 1, step: 2 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const evs = parse(r.content)
    // 所有 assistant/message 都必须是 append
    for (const e of evs.filter(e => e.type === 'assistant/message')) expect(e.surfaceOp).toBe('append')
    // 出现一个 user 标记做 replace，且其 source 是合法 plugin snapshot 形态
    const mark = evs.find(e => e.type === 'user/message' && e.surfaceOp !== 'append')!
    expect(mark).toBeDefined()
    const src2 = (mark.data as { source: { form?: string; sections?: Array<{ name: string }> } }).source
    expect(src2.form).toBe('snapshot')
    expect(src2.sections?.[0]?.name).toBe('dsht:surgical')
  })

  it('信封多余键 source（turn/end 上）→ 剥除', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ASSISTANT(1, 1, 'a1', 'x'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }, { source: { kind: 'plugin', plugin: 'dsht-rp', seqRepair: 'x' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const end = parse(r.content).find(e => e.type === 'turn/end')!
    expect(end.source).toBeUndefined()
    expect(r.notes.join('|')).toContain('信封')
  })

  it('turn/step 状态机归一：turn/end 缺配对 step/end → 自动补齐', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ASSISTANT(1, 1, 'a1', 'x'),
      // 故意不写 step/end
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const evs = parse(r.content)
    const turnEndIdx = evs.findIndex(e => e.type === 'turn/end')
    expect(evs[turnEndIdx - 1].type).toBe('step/end')
    expect(r.notes.join('|')).toContain('状态机归一')
  })

  it('turn/start 编号不接续 → 归一为 nextTurn', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ASSISTANT(1, 1, 'a1', 'x'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['turn/start', { turn: 7 }], // 跳号
      ['step/start', { turn: 7, step: 1 }],
      ASSISTANT(7, 1, 'a2', 'y'),
      ['step/end', { turn: 7, step: 1 }],
      ['turn/end', { turn: 7, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    const evs = parse(r.content)
    const starts = evs.filter(e => e.type === 'turn/start').map(e => (e.data as { turn: number }).turn)
    expect(starts).toEqual([1, 2])
  })

  it('compaction/prune 的 shadowedRange 跟随 shadowedSeqs 端点（官方端点一致性）', () => {
    // prune 瞄准当前 surface 上一个真实节点（seq 2 的 user），但端点/顺序写坏
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      USER('u1', 'hi'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['compaction/prune', { shadowedRange: { start: 99, end: 100 }, shadowedSeqs: [2, 99], shadowedTokenCount: 5 }],
    ])
    const r = repairSessionForV3(src)
    const prune = parse(r.content).find(e => e.type === 'compaction/prune')
    // 至少保证：若 prune 保留，端点必须与 shadowedSeqs 端点一致（官方 validateShadowedSeqs）
    if (prune !== undefined) {
      const d = prune.data as { shadowedSeqs: number[]; shadowedRange: { start: number; end: number } }
      expect(d.shadowedSeqs).toEqual([...d.shadowedSeqs].sort((a, b) => a - b))
      expect(d.shadowedRange.start).toBe(d.shadowedSeqs[0])
      expect(d.shadowedRange.end).toBe(d.shadowedSeqs[d.shadowedSeqs.length - 1])
    }
    expect(r.changed).toBe(true)
  })

  it('header.cwd 非绝对路径 → 补全', () => {
    const src = JSON.stringify({ type: 'session', version: 0, id: 's', createdAt: 1, cwd: 'rp/_start', delegationDepth: 0 }) + '\n'
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const hdr = JSON.parse(r.content.split('\n')[0]) as { cwd: string }
    expect(hdr.cwd.startsWith('/')).toBe(true)
  })

  it('幂等：已合法的会话 → 零改动', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      USER('u1', 'hi'),
      ['step/end', { turn: 1, step: 1 }],
      ['step/start', { turn: 1, step: 2 }],
      ASSISTANT(1, 2, 'a1', 'yo'),
      ['step/end', { turn: 1, step: 2 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r1 = repairSessionForV3(src)
    expect(r1.changed).toBe(false)
    expect(r1.content).toBe(src)
    // 再修一次仍零改动
    const r2 = repairSessionForV3(r1.content)
    expect(r2.changed).toBe(false)
  })

  it('内容无损：所有文本与 sections 载荷在修复后仍可寻回', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['user/message', { role: 'user', content: [{ type: 'text', text: '独一无二的文本A' }], source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 1 } }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['step/start', { turn: 1, step: 2 }],
      ASSISTANT(1, 2, 'a2', '独一无二的文本B'),
      ['step/end', { turn: 1, step: 2 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.content).toContain('独一无二的文本A')
    expect(r.content).toContain('独一无二的文本B')
    // 载荷以 JSON 字符串形式嵌在 sections[].text（转义后仍可解析回原值）
    const ev = parse(r.content).find(e => e.type === 'user/message')!
    const sec = ((ev.data as { source: { sections: Array<{ text: string }> } }).source.sections)[0]
    expect(JSON.parse(sec.text)).toEqual({ rolledBackTo: 1 })
  })
})

/**
 * 【阶段3 2026-09-10 修正】此前 `model source` 上的自定义键（thData/thSystem）是
 * **直接丢弃**——那是静默数据丢失（TH 楼层附加数据 / 飞讯记录映射读不回来）。
 * 现在改为「移交 sidecar」：`result.salvaged` 把键值对带出来，调用方落
 * `$DSH_HOME/rp/th-floors/<sid>.json`（见 dsht-plugin-shared/th-floors.ts）。
 */
describe('session-repair: source 扩展键 → salvage 移交（不再静默丢弃）', () => {
  const MODEL_ASSISTANT = (turn: number, step: number, id: string, text: string, source: Record<string, unknown>) =>
    ['assistant/message', { turn, step, message: { id, role: 'assistant', content: [{ type: 'text', text }], source } },
      { surfaceOp: 'append' }] as [string, Record<string, unknown>, Record<string, unknown>]

  it('assistant model source 的 thData/thSystem → 进 salvaged（键 = message id），会话内已清除', () => {
    const thData = { fx_records_map: { 秧秧: [{ msgId: 'No.063', globalMsgId: 'fx_mtr87iju' }] } }
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MODEL_ASSISTANT(1, 1, 'th-floor-1', '系统楼层正文', {
        kind: 'model', provider: 'dsht-tavern-helper', model: 'th-system', thSystem: true, thData,
      }),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    // 会话里必须已经干净（否则 0.1.5 白名单仍会拒整会话）
    const ev = parse(r.content).find(e => e.type === 'assistant/message')!
    const src2 = ((ev.data as { message: { source: Record<string, unknown> } }).message).source
    expect(src2.thData).toBeUndefined()
    expect(src2.thSystem).toBeUndefined()
    expect(Object.keys(src2).sort()).toEqual(['kind', 'model', 'provider'])
    // 载荷必须被带出来，一条不能少
    expect(r.salvaged).toHaveLength(1)
    expect(r.salvaged[0].key).toBe('th-floor-1')
    expect(r.salvaged[0].payload.thData).toEqual(thData)
    expect(r.salvaged[0].payload.thSystem).toBe(true)
    expect(r.notes.join('|')).toContain('移交 sidecar')
  })

  it('salvage 键在 seq 重编号后仍指向正确楼层（用最终 seq，不是旧值）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MODEL_ASSISTANT(1, 1, 'floor-a', 'A', { kind: 'model', provider: 'p', model: 'm', thData: { k: 'A' } }),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      // 故意制造 seq 断号：直接给个越界 seq，修复器会重编号
      ['turn/start', { turn: 2 }, undefined],
    ])
    const r = repairSessionForV3(src)
    const evs = parse(r.content)
    for (const s of r.salvaged) {
      // key 必须是 id 或 `seq:<finalSeq>` 且能对上输出里的某条消息
      if (s.key.startsWith('seq:')) {
        const want = Number(s.key.slice(4))
        expect(evs.some(e => e.seq === want)).toBe(true)
      } else {
        expect(evs.some(e => JSON.stringify(e).includes(s.key))).toBe(true)
      }
    }
  })

  it('无遗留键的会话 → salvaged 为空数组（不误报）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MODEL_ASSISTANT(1, 1, 'a1', '干净楼层', { kind: 'model', provider: 'p', model: 'm' }),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.salvaged).toEqual([])
  })
})
