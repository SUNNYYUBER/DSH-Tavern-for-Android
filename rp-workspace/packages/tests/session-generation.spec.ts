/**
 * 0.1.5 会话「世代」与手术标记读法单测
 * ============================================================================
 * 背景（2026-09-11 心跳 44 实机发现，两条静默失败）：
 *
 *  ① **世代**：0.1.5 起核心把会话迁到新世代 `session.vN.jsonl`，v0 的
 *     `session.jsonl` 作为**历史世代保留但冻结**（官方
 *     dsh-session-persistence-jsonl/lib/index.js:753-760）。我方大量路由硬编码
 *     `session.jsonl` → 迁移过的会话从此读到「迁移那一刻的死数据」。
 *     设备实测：80 个会话里有 1 个已迁移——正是用户当下在用的那个。
 *     症状举例：`/rp/rollback-mask` 恒返回 0 → 回退后 UI 不隐藏楼层；
 *     `/rp/session-rollback` 非 live 分支截断的是死文件（还回 200 + 计数）。
 *
 *  ② **标记读法**：0.1.5 的 source 白名单不允许扩展键，写侧已迁到
 *     `form:'snapshot' + sections[{name:'dsht:surgical', text:JSON.stringify(payload)}]`
 *     （0.1.2 存量被迁移器搬进 `name:'dsht:legacy'`）。任何仍读 source 顶层
 *     `rolledBackTo/editedFrom/regeneratedFrom` 的消费方恒拿 undefined。
 *     症状举例：`/rp/rollback-mask` 恒 0（同①）；记忆侧继续摘要已被撤回的楼层。
 *
 * 本文件只做**纯函数 + 临时目录**断言，不依赖 DSH runtime。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSessionHeaders, pickCurrentSessionFilename, currentSessionLogPath } from '../src/dsht-plugin-shared/session-surgery.ts'
import { readSurgicalPayload, readSurgicalAnchor, assistantSettlement, boundAppend } from '../src/dsht-plugin-shared/session-write.ts'
import { extractFloorsFromEvents } from '../src/dsht-plugin-memory/index.ts'

// ---------------------------------------------------------------- ① 世代

describe('pickCurrentSessionFilename（纯函数：目录条目 → 当前世代文件名）', () => {
  it('只有 v0 → session.jsonl', () => {
    expect(pickCurrentSessionFilename(['session.jsonl', 'session.lock'])).toBe('session.jsonl')
  })

  it('有 v3 → session.v3.jsonl（哪怕 v0 也在）', () => {
    expect(pickCurrentSessionFilename(['session.jsonl', 'session.v3.jsonl', 'session.lock']))
      .toBe('session.v3.jsonl')
  })

  it('多世代共存 → 取版本号最高的', () => {
    expect(pickCurrentSessionFilename(['session.jsonl', 'session.v2.jsonl', 'session.v10.jsonl', 'session.v3.jsonl']))
      .toBe('session.v10.jsonl')
  })

  it('空目录 / 无关文件 → 回落到 session.jsonl（调用方再去 open 失败）', () => {
    expect(pickCurrentSessionFilename([])).toBe('session.jsonl')
    expect(pickCurrentSessionFilename(['.bak', 'session.jsonl.bak'])).toBe('session.jsonl')
  })
})

/** 造一个会话目录：project/sdir/ + 给定文件名 → 首行 header */
async function makeSession(root: string, project: string, sdir: string, id: string, files: string[]): Promise<void> {
  const dir = join(root, 'sessions', project, sdir)
  await mkdir(dir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, cwd: '/data/x' })
  for (const f of files) await writeFile(join(dir, f), header + '\n', 'utf8')
}

describe('scanSessionHeaders（扫全树当前世代首行）', () => {
  it('v0-only 与已迁移会话都能被扫到，且 file 指向各自当前世代', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsht-gen-'))
    await makeSession(root, '-pA-', 's1', 'session-a', ['session.jsonl'])
    await makeSession(root, '-pB-', 's2', 'session-b', ['session.jsonl', 'session.v3.jsonl'])

    const hits = await scanSessionHeaders(root)
    const a = hits.find(h => h.sessionId === 'session-a')
    const b = hits.find(h => h.sessionId === 'session-b')

    expect(a?.file.endsWith(join('-pA-', 's1', 'session.jsonl'))).toBe(true)
    // 关键断言：迁移过的会话必须指向 v3，而不是冻结的 v0
    expect(b?.file.endsWith(join('-pB-', 's2', 'session.v3.jsonl'))).toBe(true)
  })

  it('currentSessionLogPath 与扫描结果一致', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsht-gen-'))
    await makeSession(root, '-pB-', 's2', 'session-b', ['session.jsonl', 'session.v3.jsonl'])
    expect(await currentSessionLogPath(root, '-pB-', 's2')).toMatch(/session\.v3\.jsonl$/)
    expect(await currentSessionLogPath(root, '-pX-', 'nope')).toMatch(/session\.jsonl$/) // 目录不存在也不抛
  })

  it('既无 session.jsonl 也无世代文件 → 不进结果集（不产生假会话）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsht-gen-'))
    await mkdir(join(root, 'sessions', '-p-', 's'), { recursive: true })
    await writeFile(join(root, 'sessions', '-p-', 's', 'other.jsonl'), '{}\n', 'utf8')
    expect(await scanSessionHeaders(root)).toEqual([])
  })
})

// ---------------------------------------------------------------- ② 标记读法

const MODERN = (payload: Record<string, unknown>) => ({
  kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot',
  sections: [{ name: 'dsht:surgical', text: JSON.stringify(payload) }],
})
const LEGACY_SECTION = (payload: Record<string, unknown>) => ({
  kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot',
  sections: [{ name: 'dsht:legacy', text: JSON.stringify(payload) }],
})
const TOPLEVEL = (payload: Record<string, unknown>) => ({ kind: 'plugin', plugin: 'dsht-rp', ...payload })

describe('readSurgicalPayload（新形态 / 存量段 / 顶层键 三路合并）', () => {
  it('新形态 sections[dsht:surgical] —— 0.1.5 写侧的当前形态', () => {
    expect(readSurgicalPayload(MODERN({ rolledBackTo: 78, shadowedSeqs: [79, 80, 82] })))
      .toEqual({ rolledBackTo: 78, shadowedSeqs: [79, 80, 82] })
  })

  it('存量段 sections[dsht:legacy] —— 0.1.2 会话被迁移器搬运后的形态', () => {
    expect(readSurgicalPayload(LEGACY_SECTION({ rolledBackTo: 11 })).rolledBackTo).toBe(11)
  })

  it('更早期顶层键 —— 兼容读取仍生效', () => {
    expect(readSurgicalPayload(TOPLEVEL({ editedFrom: 20 })).editedFrom).toBe(20)
  })

  it('三种手术键与变体键都能解出', () => {
    expect(readSurgicalPayload(MODERN({ editedFrom: 5 })).editedFrom).toBe(5)
    expect(readSurgicalPayload(MODERN({ regeneratedFrom: 9 })).regeneratedFrom).toBe(9)
    expect(readSurgicalPayload(MODERN({ variantOf: 3 })).variantOf).toBe(3)
  })

  it('非法/缺失输入不抛，返回空对象', () => {
    expect(readSurgicalPayload(null)).toEqual({})
    expect(readSurgicalPayload(undefined)).toEqual({})
    expect(readSurgicalPayload('x')).toEqual({})
    expect(readSurgicalPayload({ sections: 'nope' })).toEqual({})
    expect(readSurgicalPayload({ sections: [{ name: 'dsht:surgical', text: '{bad json' }] })).toEqual({})
  })

  // ---- 合并语义：先到先得（新形态 > 存量段 > 顶层键）----

  it('新形态的 0 不被存量段的旧值盖掉（先到先得，非后到覆盖）', () => {
    const both = {
      kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot',
      sections: [
        { name: 'dsht:surgical', text: JSON.stringify({ rolledBackTo: 0 }) },
        { name: 'dsht:legacy', text: JSON.stringify({ rolledBackTo: 11 }) },
      ],
      rolledBackTo: 22,
    }
    // 若实现是"后到覆盖"，这里会解出 22 → UI 隐藏一段本应可见的楼层（静默错）
    expect(readSurgicalPayload(both).rolledBackTo).toBe(0)
  })

  it('新形态缺该键时才回落到存量段 / 顶层键', () => {
    const secFallback = {
      kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot',
      sections: [
        { name: 'dsht:surgical', text: JSON.stringify({ editedFrom: 5 }) },
        { name: 'dsht:legacy', text: JSON.stringify({ rolledBackTo: 11 }) },
      ],
    }
    expect(readSurgicalPayload(secFallback)).toEqual({ editedFrom: 5, rolledBackTo: 11 })

    const topFallback = { kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot', sections: [], regeneratedFrom: 9 }
    expect(readSurgicalPayload(topFallback).regeneratedFrom).toBe(9)
  })

  it('空数组不落值（写侧用字段缺失表达"无遮蔽"）', () => {
    const src = {
      kind: 'plugin', plugin: 'dsht-rp', form: 'snapshot',
      sections: [
        { name: 'dsht:surgical', text: JSON.stringify({ rolledBackTo: 78, shadowedSeqs: [79, 80] }) },
        { name: 'dsht:legacy', text: JSON.stringify({ shadowedSeqs: [] }) },
      ],
      shadowedSeqs: [],
    }
    // 空数组若允许落值，会把已经解出的 [79,80] 清成 [] —— 同样静默
    expect(readSurgicalPayload(src).shadowedSeqs).toEqual([79, 80])
  })

  it('数组元素非数字被剔除；全非数字视同缺失', () => {
    expect(readSurgicalPayload(MODERN({ shadowedSeqs: [1, 'x', 2, null] })).shadowedSeqs).toEqual([1, 2])
    expect(readSurgicalPayload(MODERN({ shadowedSeqs: ['x', null] })).shadowedSeqs).toBeUndefined()
    expect(readSurgicalPayload(MODERN({ shadowedSeqs: 'nope' })).shadowedSeqs).toBeUndefined()
  })
})

describe('readSurgicalAnchor（统一锚点语义）', () => {
  const ev = (source: unknown, type = 'user/message') => ({ type, seq: 100, data: { source } })

  it('rollback → anchor = rolledBackTo（锚消息保留）', () => {
    expect(readSurgicalAnchor(ev(MODERN({ rolledBackTo: 78 }))).anchor).toBe(78)
  })
  it('edit → anchor = editedFrom − 1（锚消息本身也隐藏）', () => {
    expect(readSurgicalAnchor(ev(MODERN({ editedFrom: 20 }))).anchor).toBe(19)
  })
  it('regenerate → anchor = regeneratedFrom', () => {
    expect(readSurgicalAnchor(ev(MODERN({ regeneratedFrom: 9 }))).anchor).toBe(9)
  })
  it('assistant/message 走 data.message.source 分支', () => {
    expect(readSurgicalAnchor({ type: 'assistant/message', seq: 5, data: { message: { source: MODERN({ rolledBackTo: 4 }) } } }).anchor).toBe(4)
  })
  it('无标记 → null', () => {
    expect(readSurgicalAnchor(ev({ kind: 'user' })).anchor).toBeNull()
    expect(readSurgicalAnchor({ type: 'turn/end', seq: 1, data: {} }).anchor).toBeNull()
  })
})

// ---------------------------------------------------------------- ③ 记忆侧掩码

describe('extractFloorsFromEvents 的掩码读法（回归：0.1.5 新形态标记必须被识别）', () => {
  const u = (seq: number, text: string, source?: unknown) => ({
    type: 'user/message', seq,
    data: { role: 'user', content: [{ type: 'text', text }], source: source ?? { kind: 'user' } },
  })
  const a = (seq: number, turn: number, text: string) => ({
    type: 'assistant/message', seq,
    data: { turn, step: 1, role: 'assistant', content: [{ type: 'text', text }] },
  })
  /** seq 8 的 marker 回退到 3 → (3, 7] 被整条跳过 */
  const marker = (seq: number, source: unknown) => u(seq, '[已回退]', source)

  it('新形态 sections 标记生效：区间内楼层不计数、不进摘要', () => {
    const ev2 = [
      u(2, '第一句'), a(3, 1, '第一答'),
      u(4, '被回退的用户句'), a(5, 2, '被回退的回答'),
      marker(8, MODERN({ rolledBackTo: 3 })),
      u(9, '回退后新一句'), a(10, 3, '回退后新答'),
    ]
    const { floors } = extractFloorsFromEvents(ev2)
    // 被回退的 seq 4/5 不计；标记自身（plugin source）不计；9/10 计
    expect(floors.map(f => f.text)).toEqual(['第一句', '第一答', '回退后新一句', '回退后新答'])
  })

  it('修复前的问题形态复现：顶层键读法在 sections 形态下拿不到值', () => {
    // 直接读 source 顶层（旧实现）→ undefined；统一读法 → 78
    const src = MODERN({ rolledBackTo: 78 }) as Record<string, unknown>
    expect(src.rolledBackTo).toBeUndefined()
    expect(readSurgicalPayload(src).rolledBackTo).toBe(78)
  })

  it('存量 dsht:legacy 段标记同样生效（老会话不被"复活"摘要）', () => {
    const ev2 = [
      u(2, '第一句'), a(3, 1, '第一答'),
      u(4, '撤回的用户句'), a(5, 2, '撤回的回答'),
      marker(8, LEGACY_SECTION({ rolledBackTo: 3 })),
      u(9, '新一句'), a(10, 3, '新答'),
    ]
    expect(extractFloorsFromEvents(ev2).floors.map(f => f.text))
      .toEqual(['第一句', '第一答', '新一句', '新答'])
  })

  it('无标记 → 全量计楼（对照组）', () => {
    const ev2 = [
      u(2, '第一句'), a(3, 1, '第一答'),
      u(4, '第二句'), a(5, 2, '第二答'),
    ]
    expect(extractFloorsFromEvents(ev2).floors.map(f => f.text))
      .toEqual(['第一句', '第一答', '第二句', '第二答'])
  })
})

/**
 * assistantSettlement：settlement 三件套单源（心跳 49 事故回归）
 * ==========================================================================
 * 事故：6 处手写字面量各自漏了 `stream`，往 v3 会话写出的事件让会话**冷启动打不开**
 * （`seed assistant/message at index N has invalid settlement fields`）。
 * 判据（钉的是什么）：三件套必须齐、`stream` 必须是**数组**（且为空数组而非省略），
 * 且这个函数存在本身就是为了让"手写字面量"不再有第二次机会。
 */
describe('assistantSettlement（官方 settlement 三件套单源）', () => {
  it('返回 turn/step/stream 三件，stream 是空数组（不是 undefined、不是省略）', () => {
    const d = assistantSettlement(3, 2)
    expect(d.turn).toBe(3)
    expect(d.step).toBe(2)
    expect(Array.isArray(d.stream)).toBe(true)
    expect(d.stream).toEqual([])
    expect(Object.keys(d).sort()).toEqual(['step', 'stream', 'turn'])
  })

  it('🔴 负控：返回的对象**不能**只有 turn/step（缺 stream 就复现事故）', () => {
    // 用官方判据的形状（assertAssistantSettlementShape）自证：
    // 缺 stream → 该形状必须被判不合法；这正是设备上 rp-wuwa 会话打不开的原因。
    const isSettlementShaped = (d: Record<string, unknown>) =>
      typeof d.turn === 'number' && Number.isSafeInteger(d.turn) && (d.turn as number) >= 0
      && typeof d.step === 'number' && Number.isSafeInteger(d.step) && (d.step as number) >= 0
      && Array.isArray(d.stream)
    expect(isSettlementShaped({ turn: 1, step: 1 })).toBe(false)
    expect(isSettlementShaped(assistantSettlement(1, 1))).toBe(true)
  })

  it('turn/step 可被调用点覆写（变体切换先铺 1/1 再由 plan 覆写）', () => {
    const d = { ...assistantSettlement(1, 1), turn: 7, step: 3 }
    expect(d.turn).toBe(7)
    expect(d.step).toBe(3)
    expect(d.stream).toEqual([])
  })
})

// ---------------------------------------------------------------- ④ 官方方法绑定
/**
 * 心跳 55 实机缺陷（`/rp/session-regenerate` 恒 500 且零事件写入）：
 * 官方 `Session` 是「实例字段 + this」实现（`this.log`，dsh-session/lib/index.js:457/1075），
 * 因此 `const f = live.append; f(...)` 这种**方法引用提取**会丢接收者 →
 * `TypeError: Cannot read properties of undefined (reading 'log')`。
 *
 * 心跳 47 的「纯类型层收窄」重构引入的两处 detach 正是此形态（注释还写着"运行时语义不变"）。
 * 本组用例把「提取必须绑定」钉成断言：正控（boundAppend 可用）+ 负控（裸提取必炸）。
 */
describe('boundAppend —— 官方会话方法禁止 detach（心跳 55）', () => {
  /** 忠实复刻官方形状：方法内部读 this.log */
  class FakeSession {
    log: unknown[] = []
    append(type: string, data: unknown): unknown {
      // 官方 append 内部即 this.log.push（dsh-session/lib/index.js:1075）
      this.log.push({ type, data })
      return 'ok'
    }
  }

  it('正控：boundAppend 后调用可用，且 this 指向原会话', () => {
    const s = new FakeSession()
    const f = boundAppend(s as unknown as Parameters<typeof boundAppend>[0])
    expect(f('compaction/prune', { n: 1 })).toBe('ok')
    expect(s.log).toHaveLength(1)
  })

  it('🔴 负控：裸提取（= s.append）调用必炸，且错误信息与设备报错逐字一致', () => {
    const s = new FakeSession()
    const detached = s.append // 心跳 47 的写法
    expect(() => detached('compaction/prune', { n: 1 })).toThrowError(
      "Cannot read properties of undefined (reading 'log')",
    )
    expect(s.log).toHaveLength(0) // 关键：零写入 —— 与设备实测一致
  })
})
