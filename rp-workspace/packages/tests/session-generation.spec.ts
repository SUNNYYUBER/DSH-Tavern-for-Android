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
import { mkdtemp, mkdir, rename, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { scanSessionHeaders, pickCurrentSessionFilename, currentSessionLogPath, relocatedSessionLogPath } from '../src/dsht-plugin-shared/session-surgery.ts'
import { readSurgicalPayload, readSurgicalAnchor, assistantSettlement, boundAppend } from '../src/dsht-plugin-shared/session-write.ts'
import { canSurgicallyTruncate } from '../src/dsht-plugin-shared/session-surgery.ts'
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

// ------------------------------------------------- ①b 目录搬迁后的日志路径（心跳 61）

describe('relocatedSessionLogPath（纯函数：搬迁到另一个 projectKey 后的当前世代日志路径）', () => {
  const ROOT = '/data/user/0/com.dshtavern.app/files/.dsh/sessions'
  const SRC = `${ROOT}/--data-user-0-com.dshtavern.app-files-.dsh-rp-rp-x--`
  const DST = '--data-data-com.dshtavern.app-files-.dsh-rp-rp-x--'

  // 平台无关：本函数关心的是「目标 projectKey + sdir + 当前世代文件名」这三段，
  // 分隔符由 path.join 按平台决定（Windows 上会是 `\`），不构成被测语义。
  const tail3 = (p: string): string => p.split(/[\\/]/).slice(-3).join('/')

  // 正控：核心回归 —— 0.1.5 世代必须保留 v3 文件名，**绝不可重拼 session.jsonl**
  it('v3 世代：搬迁后仍指向 session.v3.jsonl（回归：此前重拼 session.jsonl 导致 ENOENT + 半修复态）', () => {
    expect(tail3(relocatedSessionLogPath(ROOT, DST, 'session-abc', join(SRC, 'session-abc', 'session.v3.jsonl'))))
      .toBe(`${DST}/session-abc/session.v3.jsonl`)
  })

  it('只换 project 目录，sdir 与文件名原样保留（多世代取当前世代）', () => {
    const out = relocatedSessionLogPath(ROOT, DST, 'st-asm3yf', join(SRC, 'st-asm3yf', 'session.v10.jsonl'))
    expect(tail3(out)).toBe(`${DST}/st-asm3yf/session.v10.jsonl`)
    expect(basename(out)).toBe('session.v10.jsonl')
  })

  it('v0 世代（无版本后缀）原样保留 session.jsonl', () => {
    expect(tail3(relocatedSessionLogPath(ROOT, DST, 'dsht-welcome', join(SRC, 'dsht-welcome', 'session.jsonl'))))
      .toBe(`${DST}/dsht-welcome/session.jsonl`)
  })

  it('未搬迁（target === source）时结果等于原路径 —— 保证「不搬迁也要能读」这条分支', () => {
    const proj = '--data-data-com.dshtavern.app-files-.dsh-rp-rp-x--'
    expect(tail3(relocatedSessionLogPath(ROOT, proj, 'session-abc', join(ROOT, proj, 'session-abc', 'session.v3.jsonl'))))
      .toBe(`${proj}/session-abc/session.v3.jsonl`)
  })

  // 端到端（临时目录）：复刻 repairSessionCwds 的真实动作序列
  //   ① 扫描拿到当前世代绝对路径 → ② rename 目录到目标 projectKey → ③ 按搬迁后路径读文件
  // 旧实现第 ③ 步硬编码 'session.jsonl' ⇒ 该文件在 0.1.5 世代下不存在 ⇒ ENOENT
  // ⇒ 目录已搬走、header.cwd 未改 ⇒ 目录名 ≠ projectKey(header.cwd)（会话打不开）。
  it('端到端：搬目录后按搬迁路径能读到 v3 日志；旧实现的 session.jsonl 路径必须不存在', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsht-relocate-'))
    const root = join(home, 'sessions')
    const srcProject = '--data-user-0-pkg-files-.dsh-rp-rp-x--'
    const dstProject = '--data-data-pkg-files-.dsh-rp-rp-x--'
    await makeSession(home, srcProject, 'session-abc', 'session-abc', ['session.v3.jsonl'])

    const hits = await scanSessionHeaders(home)
    expect(hits).toHaveLength(1)
    const h = hits[0]!
    expect(h.project).toBe(srcProject)

    // ② 模拟搬迁
    await mkdir(join(root, dstProject), { recursive: true })
    await rename(join(root, srcProject, h.sdir), join(root, dstProject, h.sdir))

    // ③ 搬迁后路径可读（修复后行为）
    const moved = relocatedSessionLogPath(root, dstProject, h.sdir, h.file)
    expect(await readFile(moved, 'utf8')).toContain('"type":"session"')

    // 负控：旧实现拼出来的路径（硬编码 session.jsonl）现在必须是 ENOENT
    expect(existsSync(join(root, dstProject, h.sdir, 'session.jsonl'))).toBe(false)
    await expect(readFile(join(root, dstProject, h.sdir, 'session.jsonl'), 'utf8')).rejects.toThrow(/ENOENT/)
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

// ---------------------------------------------------------------------------
// 【心跳 58 · T-58】「非 live 才允许文件手术」的单源判据
//
// 背景：该判据原在 **6 处**逐字复制（RP 侧 rollback/edit/regenerate 各一 + undo 插件三处），
// 单测只覆盖 undo 那份 → 心跳 57 审计 T-58 时看到「对未挂载会话能截断」，
// 误判为「缺少门槛」（实际三处 RP 侧都已有 409 守卫，只是没被钉住）。
// 本组把不变量钉在单源纯函数上，两插件同时受保护。
// ---------------------------------------------------------------------------

describe('canSurgicallyTruncate —— 内存态权威（心跳 58 · T-58 单源判据）', () => {
  it('非 live（会话没打开）→ 允许文件手术', () => {
    for (const action of ['rollback', 'edit', 'regenerate'] as const) {
      expect(canSurgicallyTruncate(false, action)).toEqual({ allowed: true })
    }
  })

  it('live（会话正 attach）→ 拒绝，且文案逐字含动作名与指引', () => {
    const cases = [
      ['rollback', '再回退'],
      ['edit', '再编辑'],
      ['regenerate', '再重新生成'],
    ] as const
    for (const [action, tail] of cases) {
      const r = canSurgicallyTruncate(true, action)
      expect(r.allowed).toBe(false)
      if (r.allowed) continue
      expect(r.error).toContain('session live（内存态权威）')
      expect(r.error).toContain('先在 DSH 里关闭该会话')
      expect(r.error.endsWith(tail)).toBe(true)
    }
  })

  it('🔴 承重：三个动作的文案**互不相同**（否则「统一成一个」会丢动作信息）', () => {
    const msgs = (['rollback', 'edit', 'regenerate'] as const)
      .map(a => canSurgicallyTruncate(true, a))
      .map(r => (r.allowed ? '' : r.error))
    expect(new Set(msgs).size).toBe(3)
  })

  it('判据只取决于 isLive（与动作名、会话 id 无关的可判定性）', () => {
    // 同一动作在两种状态下结论必须相反 —— 这是「门槛存在」的最小证明
    for (const action of ['rollback', 'edit', 'regenerate'] as const) {
      expect(canSurgicallyTruncate(false, action).allowed).toBe(true)
      expect(canSurgicallyTruncate(true, action).allowed).toBe(false)
    }
  })
})
