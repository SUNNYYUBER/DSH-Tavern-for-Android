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

  it('header.cwd 不在此模块改写（cwd↔目录名强耦合，改 cwd 必须同时搬目录）', () => {
    // 回归护栏：曾经这里把相对 cwd 补成绝对路径，但没搬目录 →
    // 官方 assertStoredIdentity 要求 目录名 == projectKey(cwd)，
    // 实机表现为 node 启动 crash-loop（corrupt session log ... and cwd identify ...）。
    const src = JSON.stringify({ type: 'session', version: 0, id: 's', createdAt: 1, cwd: 'rp/_start', delegationDepth: 0 }) + '\n'
    const r = repairSessionForV3(src)
    const hdr = JSON.parse(r.content.split('\n')[0]) as { cwd: string }
    expect(hdr.cwd).toBe('rp/_start') // 原样保留，交给 repairSessionCwds（带 fs）处理
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

/**
 * 心跳 47 回归：**修复器必须按"被修文件自己声明的代次"写 surfaceOp 字段名**。
 * ============================================================================
 * 事故（2026-09-11 实机）：
 *   `repairSessionForV3` 无条件写 v2 形状 `{op,start,end}`，而调用点
 *   （dsh-plugin `scanSessionHeaders()`）**不看 header.version**，把它施加到全部存量会话。
 *   对一个已经是 v3 的文件再写 v2 形状 → v3 严格校验器
 *   （`dsh-session-format-v2-to-v3/lib/index.js:323`
 *    `requires exact replace fields op/startSeq/endSeq`）拒绝 → **会话打不开**：
 *   UI 红字 `Failed to load history: stored session "…" is corrupt:
 *   invalid committed event at line 22: format v3 system/message at seq 21
 *   requires exact replace fields op/startSeq/endSeq`。
 *
 * 判据（本组测试钉死的是什么）：
 *   · 输出代次由 **输入 header.version** 决定 —— v3 出 `startSeq/endSeq`，v0–v2 出 `start/end`。
 *   · v3 的输出里**一个裸 `start`/`end` 键都不能有**（这正是 v3 校验器拒收的形态）。
 *   · 该形态对**幂等**同样成立（跑第二遍不会把 startSeq 又变回 start）。
 */
const HDR_V3 = JSON.stringify({ type: 'session', version: 3, id: 's1', createdAt: 1, cwd: '/data/x', delegationDepth: 0 })

function sessionV3(events: Array<[string, Record<string, unknown>, Record<string, unknown>?]>): string {
  const lines = [HDR_V3]
  events.forEach(([type, data, extra], i) => {
    lines.push(JSON.stringify({ type, seq: i, time: 1000 + i, data, ...(extra ?? {}) }))
  })
  return lines.join('\n') + '\n'
}

/** 从任意事件里取 surfaceOp 的键集合 */
const opKeys = (ev: Record<string, unknown>): string[] =>
  Object.keys((ev.surfaceOp ?? {}) as Record<string, unknown>).sort()

/** 本地 assistant/message 构造（父作用域的 MODEL_ASSISTANT 定义在别的 describe 里，此处取不到） */
const MA = (turn: number, step: number, id: string, text: string) =>
  ['assistant/message', { turn, step, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } } }, { surfaceOp: 'append' }] as [string, Record<string, unknown>, Record<string, unknown>]

describe('session-repair: surfaceOp 字段名按代次自适应（心跳 47 事故回归）', () => {
  it('v3 文件里的 replace → 输出必须是 startSeq/endSeq（不是 start/end）', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA(1, 1, 'a1', '第一版'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      // 一个带 replace 的 user/message（v3 里必须写成 startSeq/endSeq）
      ['user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '重生成' }], source: { kind: 'user' } },
        { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3] }],
      // ⚠️ 必须有「另一处真缺陷」把 changed 顶成 true：修复器在 changed=false 时**原样早退**，
      // 不重写任何 surfaceOp —— 只放一条已合法的 replace，本测试会因「没走重写」而假通过（负控实证）。
      ['user/message', { role: 'user', content: [{ type: 'text', text: '缺 id，强制触发重写' }], source: { kind: 'user' } },
        { surfaceOp: 'append' }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const evs = parse(r.content)
    const replaced = evs.filter(e => e.surfaceOp !== undefined && e.surfaceOp !== 'append')
    expect(replaced.length).toBeGreaterThan(0)
    for (const ev of replaced) {
      expect(opKeys(ev)).toEqual(['endSeq', 'op', 'startSeq'])
      // 负面断言：v3 输出里绝不能出现裸 start/end（这正是校验器拒收的形态）
      const op = ev.surfaceOp as Record<string, unknown>
      expect(Object.hasOwn(op, 'start')).toBe(false)
      expect(Object.hasOwn(op, 'end')).toBe(false)
    }
  })

  it('v0 文件里的 replace → 保持 start/end（官方 v2→v3 迁移器负责改名）', () => {
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA(1, 1, 'a1', '第一版'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '重生成' }], source: { kind: 'user' } },
        { surfaceOp: { op: 'replace', start: 3, end: 3 }, sourceEventSeqs: [3] }],
    ])
    const r = repairSessionForV3(src)
    const replaced = parse(r.content).filter(e => e.surfaceOp !== undefined && e.surfaceOp !== 'append')
    expect(replaced.length).toBeGreaterThan(0)
    for (const ev of replaced) expect(opKeys(ev)).toEqual(['end', 'op', 'start'])
  })

  it('v3 + assistant 做 replace 节点 → 拆出的 user 标记也用 startSeq/endSeq', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA(1, 1, 'a1', '第一版'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['turn/start', { turn: 2 }],
      ['step/start', { turn: 2, step: 1 }],
      MA(2, 1, 'a2', '第二版'),
      ['step/end', { turn: 2, step: 1 }],
      ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
      // 0.1.5 禁止 assistant/message 做 replace 节点 → 修复器要拆成「user 标记 replace + 本消息 append」
      ['assistant/message', { turn: 2, step: 1, message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: '第三版' }], source: { kind: 'model', provider: 'p', model: 'm' } } },
        { surfaceOp: { op: 'replace', startSeq: 8, endSeq: 8 }, sourceEventSeqs: [8] }],
    ])
    const r = repairSessionForV3(src)
    expect(r.notes.join('|')).toContain('assistant/message 的 replace 链')
    const evs = parse(r.content)
    const mark = evs.find(e => e.type === 'user/message' && String((e.data as { id?: string }).id).startsWith('dsht-repair-mark-'))!
    expect(mark).toBeTruthy()
    expect(opKeys(mark)).toEqual(['endSeq', 'op', 'startSeq'])
  })

  it('v3 文件里只有「v2 形状 replace」这一处问题 → 也必须被判为需修（自愈，不早退）', () => {
    // 事故现场的真实形态：文件是 v3，其余事件都合法，只有 surfaceOp 还是 v2 字段名。
    // 若这条不判 changed，修复器会原样早退 → 已污染会话永远修不好。
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA(1, 1, 'a1', '正文'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '重生成' }], source: { kind: 'user' } },
        { surfaceOp: { op: 'replace', start: 3, end: 3 }, sourceEventSeqs: [3] }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const replaced = parse(r.content).filter(e => e.surfaceOp !== undefined && e.surfaceOp !== 'append')
    expect(replaced.length).toBe(1)
    expect(opKeys(replaced[0])).toEqual(['endSeq', 'op', 'startSeq'])
    expect(r.notes.join('|')).toContain('v2 形状')
  })

  it('v3 修复幂等：第二遍不得把 startSeq/endSeq 退回成 start/end', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA(1, 1, 'a1', '正文'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '重生成' }], source: { kind: 'user' } },
        { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3] }],
      ['user/message', { role: 'user', content: [{ type: 'text', text: '缺 id，强制触发重写' }], source: { kind: 'user' } },
        { surfaceOp: 'append' }],
    ])
    const r1 = repairSessionForV3(src)
    expect(r1.changed).toBe(true)
    const r2 = repairSessionForV3(r1.content)
    for (const ev of parse(r2.content)) {
      if (ev.surfaceOp === undefined || ev.surfaceOp === 'append') continue
      expect(opKeys(ev)).toEqual(['endSeq', 'op', 'startSeq'])
    }
  })
})

/**
 * settlement 三件套（心跳 49 事故回归：会话冷启动打不开）
 * =====================================================================
 * 事故：我方插件的两条 TH 写桥（`th-append` / `th-edit`）往**运行中的 v3 会话**
 * 追加 `assistant/message` 时只写 `turn/step/message`，**漏了 `stream`**。
 * 追加那一刻不报错（`validateSessionEventData` 不看 stream），直到用户**下次冷启动
 * 打开该会话**才抛 `seed assistant/message at index N has invalid settlement fields`
 * → 整个会话打不开（UI 红字 `Failed to load history`）。设备真值：rp-wuwa 会话 10 条。
 *
 * 判据（本组钉死的是什么）：
 *   · v2/v3 文件缺 `stream` → 必须补 `[]`，且必须算 `changed`（否则不自愈、会话永远打不开）。
 *   · **v0 文件不能补** —— v0 的 assistant/message 处置表只有 turn/step/message
 *     （`dsh-session-format-v0-to-v1/lib/index.js:42-45`），`stream` 由 v1→v2 迁移器生成；
 *     在 v0 上补 `stream` 会引入**非法成员**。**代次不同则字段不同**（L30 纪律）。
 *   · 幂等：第二遍零改动。
 */
describe('session-repair: settlement 三件套（stream 缺失 → 补 []，仅 v2+）', () => {
  /** 造一条**故意缺 stream** 的 assistant/message */
  const MA_NO_STREAM = (turn: number, step: number, id: string, text: string) =>
    ['assistant/message', { turn, step, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'th', model: 'th-edit' } } }, { surfaceOp: 'append' }] as [string, Record<string, unknown>, Record<string, unknown>]

  it('v3 文件里 assistant/message 缺 stream → 补空数组 + 计为已修改', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA_NO_STREAM(1, 1, 'a1', '[角色创建与故事开场]'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const ev = parse(r.content).find(e => e.type === 'assistant/message')!
    expect(Array.isArray((ev.data as { stream?: unknown }).stream)).toBe(true)
    expect((ev.data as { stream: unknown[] }).stream).toEqual([])
    expect(r.notes.join('|')).toContain('stream')
  })

  it('v2 文件（header.version=2）同样补 stream（v2+ 都要求该成员）', () => {
    const hdr2 = JSON.stringify({ type: 'session', version: 2, id: 's1', createdAt: 1, cwd: '/data/x', delegationDepth: 0 })
    const lines = [hdr2]
    const evs: Array<[string, Record<string, unknown>, Record<string, unknown>?]> = [
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA_NO_STREAM(1, 1, 'a1', '正文'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]
    evs.forEach(([type, data, extra], i) => lines.push(JSON.stringify({ type, seq: i, time: 1000 + i, data, ...(extra ?? {}) })))
    const r = repairSessionForV3(lines.join('\n') + '\n')
    expect(r.changed).toBe(true)
    const ev = parse(r.content).find(e => e.type === 'assistant/message')!
    expect(Array.isArray((ev.data as { stream?: unknown }).stream)).toBe(true)
  })

  it('🔴 负控：v0 文件**不得**补 stream（带上 stream 反而是 v0 的非法成员）', () => {
    // 这条是"代次纪律"的看门测试：v0 的 payload 处置表 = ["turn","step","message"]
    // （可选 usage/interrupted），没有 stream；v1→v2 迁移器才从 assistant/chunk 生成它。
    // 若将来有人"顺手统一"把 backfill 的版本闸门去掉，这条会立刻红。
    const src = session([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '开场引导' }], source: { kind: 'model', provider: 'p', model: 'welcome' } } }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    const ev = parse(r.content).find(e => e.type === 'assistant/message')!
    expect((ev.data as { stream?: unknown }).stream).toBeUndefined()
    expect(r.notes.join('|')).not.toContain('stream')
  })

  it('已带真实 stream（有 chunk）的事件 → 原样保留，不被覆盖成 []', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['assistant/message', {
        turn: 1, step: 1,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '正文' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [{ type: 'chunk', time: 1, chunk: { type: 'text-delta', index: 0, text: '正' } }],
      }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    const ev = parse(r.content).find(e => e.type === 'assistant/message')!
    const st = (ev.data as { stream: unknown[] }).stream
    expect(Array.isArray(st)).toBe(true)
    expect(st.length).toBe(1)
  })

  it('assistant/attempt 缺 stream（v3）→ 同样补齐', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['assistant/attempt', { turn: 1, step: 1 }, { surfaceOp: 'append' }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r = repairSessionForV3(src)
    expect(r.changed).toBe(true)
    const ev = parse(r.content).find(e => e.type === 'assistant/attempt')!
    expect((ev.data as { stream?: unknown }).stream).toEqual([])
  })

  it('幂等：补过 stream 的 v3 会话第二遍零改动（不得反复重写）', () => {
    const src = sessionV3([
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      MA_NO_STREAM(1, 1, 'a1', '正文'),
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])
    const r1 = repairSessionForV3(src)
    expect(r1.changed).toBe(true)
    const r2 = repairSessionForV3(r1.content)
    expect(r2.changed).toBe(false)
  })
})
