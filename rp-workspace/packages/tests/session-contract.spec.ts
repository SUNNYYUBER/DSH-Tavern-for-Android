/**
 * T-02b 会话写入契约回归测试：我方产出的事件必须能通过**官方**迁移器与 surface 折叠
 * ============================================================================
 * 准据（唯一权威）：DSH 0.1.5-rc.1 官方运行时
 *   rp-workspace/dsh-runtime-android/node_modules/@deepseek-ai/
 *     · dsh-session-format-catalog       —— v0→v3 迁移编排（createRestore / decodeRow）
 *     · dsh-session/lib/types/surface.js —— foldSurface（surface 折叠 + 原语校验）
 *
 * 为什么需要这个文件（2026-09-10 阶段 3 实证）：
 *   用官方迁移链跑设备备份的**全部 80 个真实会话** → **41 个迁移失败（51%）**。
 *   根因全是我方写入的事件不合官方 released-v0 契约。更严重的是 0.1.5 引入了
 *   两处破坏性契约收紧，直接让 live 写路径抛错：
 *
 *   ① surfaceOp 字段名 start/end → startSeq/endSeq（两版都是「恰好 3 键」闭集校验）
 *   ② assistant/message 禁止做 surface 替换节点：
 *        · 带 sourceEventSeqs → "embeds its source stream and cannot carry sourceEventSeqs"
 *        · 不带              → "must include every shadowed surface node; missing N"
 *      官方设计死锁（0.1.2 的 assertProvenance 明确写 "except on assistant/message"）。
 *
 * 实现说明：官方包是磁盘上的外部 ESM，vite 会拦截其动态 import（且路径含空格会被
 * 误当本地模块）。故实际执行委托给 tests/session-contract-probe.mjs（真实 Node ESM
 * 子进程），本文件只负责构造事件流 + 断言退出码/输出。CI 无 runtime 时自动跳过。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertChatFile, buildFirstMesSession } from '../src/import/dsh-export.ts'
import { markerSource, planAssistantRewrite } from '../src/dsht-plugin-shared/session-write.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROBE = join(HERE, 'session-contract-probe.mjs')
const RT = 'D:/DSH RolePlay/rp-workspace/dsh-runtime-android/node_modules/@deepseek-ai'
const HAS_RUNTIME = existsSync(`${RT}/dsh-session-format-catalog/lib/index.js`) && existsSync(PROBE)

const describeMaybe = HAS_RUNTIME ? describe : describe.skip

/** 会话文本 → header + 事件行 */
function parseSession(content: string): { header: Record<string, unknown>; events: Array<Record<string, unknown>> } {
  const lines = content.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
  return { header: lines[0], events: lines.slice(1) }
}

/** 会话文本 → 官方迁移（可选再折叠）；失败返回 stderr/stdout 诊断 */
function runProbe(mode: 'migrate' | 'fold', sessionText: string): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsht-contract-'))
  const f = join(dir, 'session.jsonl')
  writeFileSync(f, sessionText.trimEnd() + '\n', 'utf8')
  try {
    const out = execFileSync(process.execPath, [PROBE, mode, f], { encoding: 'utf8', timeout: 60_000 })
    return { ok: true, out: out.trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describeMaybe('T-02b 会话写入契约：我方事件必须通过官方迁移器 + foldSurface', () => {
  it('convertChatFile 普通会话（无 swipes）→ 迁移 + 折叠全通过', () => {
    const rows = [
      { name: 'User', is_user: true, mes: '你好' },
      { name: 'AI', is_user: false, mes: '回复一' },
      { name: 'User', is_user: true, mes: '第二问' },
      { name: 'AI', is_user: false, mes: '回复二' },
    ]
    const conv = convertChatFile(rows.map(r => JSON.stringify(r)).join('\n'), { sessionId: 's-plain', createdAt: 1 })
    expect(runProbe('migrate', conv.content)).toMatchObject({ ok: true })
    const r = runProbe('fold', conv.content)
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toContain('FOLD-OK')
  })

  it('convertChatFile 带 swipes（变体组）→ 迁移 + 折叠全通过（0.1.5 死锁回归）', () => {
    const rows = [
      { name: 'User', is_user: true, mes: '你好' },
      { name: 'AI', is_user: false, mes: '版本B', swipes: ['版本A', '版本B', '版本C'], swipe_id: 1 },
    ]
    const conv = convertChatFile(rows.map(r => JSON.stringify(r)).join('\n'), { sessionId: 's-swipes', createdAt: 1 })
    const { events } = parseSession(conv.content)
    // 关键断言：assistant/message 绝不做 replace 节点、绝不带 sourceEventSeqs
    for (const ev of events) {
      if (ev.type !== 'assistant/message') continue
      expect(ev.surfaceOp).toBe('append')
      expect(ev).not.toHaveProperty('sourceEventSeqs')
    }
    const r = runProbe('fold', conv.content)
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toContain('FOLD-OK')
  })

  it('buildFirstMesSession 多开场白 → 迁移 + 折叠全通过', () => {
    const card = {
      name: '卡', firstMes: '开场白一', alternateGreetings: ['开场白二', '开场白三'],
    } as unknown as Parameters<typeof buildFirstMesSession>[0]
    const f = buildFirstMesSession(card, { cwd: '/data/x/rp/card' })
    expect(f).not.toBeNull()
    const { events } = parseSession(f!.content)
    for (const ev of events) {
      if (ev.type !== 'assistant/message') continue
      expect(ev.surfaceOp).toBe('append')
      expect(ev).not.toHaveProperty('sourceEventSeqs')
    }
    const r = runProbe('fold', f!.content)
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toContain('FOLD-OK')
  })

  it('合法标记载体（markerSource）→ 迁移保留 sections，折叠通过', () => {
    const src = markerSource('dsht-rp', 'surgical', { rolledBackTo: 3, shadowedSeqs: [3] })
    expect(src.form).toBe('snapshot')
    expect(src.sections[0].name).toBe('dsht:surgical')
    const content = [
      { type: 'session', version: 0, id: 's-mark', createdAt: 1, cwd: '/data/x', delegationDepth: 0 },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 2, time: 3, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 5, time: 6, data: { turn: 2 } },
      { type: 'step/start', seq: 6, time: 7, data: { turn: 2, step: 1 } },
      { type: 'compaction/prune', seq: 7, time: 8, data: { shadowedRange: { start: 2, end: 2 }, shadowedSeqs: [2], shadowedTokenCount: 5 } },
      {
        type: 'user/message', seq: 8, time: 9,
        data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '[已回退]' }], source: src },
        surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2],
      },
      { type: 'step/end', seq: 9, time: 10, data: { turn: 2, step: 1 } },
      { type: 'turn/end', seq: 10, time: 11, data: { turn: 2, reason: { kind: 'completed' } } },
    ].map(o => JSON.stringify(o)).join('\n')
    const r = runProbe('fold', content)
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toContain('FOLD-OK')
    expect(r.out).toContain('nodes=')
  })

  it('反面样本：assistant/message 做 replace 节点必被官方拒绝（锁死 0.1.5 约束）', () => {
    const bad = [
      { type: 'session', version: 0, id: 's-bad', createdAt: 1, cwd: '/data/x', delegationDepth: 0 },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'V1' }], source: { kind: 'model', provider: 'p', model: 'm' } } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 4, time: 5, data: { turn: 1, step: 2 } },
      { type: 'assistant/message', seq: 5, time: 6, data: { turn: 1, step: 2, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'V2' }], source: { kind: 'model', provider: 'p', model: 'm' } } }, surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2] },
      { type: 'step/end', seq: 6, time: 7, data: { turn: 1, step: 2 } },
      { type: 'turn/end', seq: 7, time: 8, data: { turn: 1, reason: { kind: 'completed' } } },
    ].map(o => JSON.stringify(o)).join('\n')
    const r = runProbe('migrate', bad)
    // ★ 断言①（不变）：**必须被拒** —— 这是本用例的立意（assistant/message 不得做 replace 节点）
    expect(r.ok).toBe(false)
    // ★ 断言②（★ 2026-09-23 DSH 升级轮 · 阶段 E 修）：**拒绝理由按代次分家**
    //   0.1.5：在 `decodeRow` 阶段被拒，理由是 `chunk provenance / sourceEventSeqs / invalid replace`。
    //   ★ 0.1.7：**拒绝得更早** —— 在 `sessionFormatCatalog.createRestore(header, …)` 就抛：
    //     `V3 catalog migration requires explicit historical child facts,
    //      including an empty array for a parent without children`
    //     （= 附录 A.2 记录的「迁移硬约束①：需要子级证据，空数组才表示确无子级」）。
    //   ⇒ 「被拒」这个**事实**没变；变的是**被谁在哪一步拒**。
    //   ★ 纪律：断言理由时必须**两种代次的写法都认** —— 否则升级后会把
    //     「拒绝理由变了」误报成「约束失效了」（**P-45**：判据口径必须与真目标对齐）。
    expect(r.out).toMatch(/chunk provenance|chunk references|sourceEventSeqs|invalid replace|explicit historical child facts/)
  })

  it('planAssistantRewrite：idle 开新 turn / busy 续 step（assistant 只能落在打开的 step）', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      { type: 'assistant/message', data: { turn: 1, step: 1 } },
      { type: 'step/end', data: { turn: 1, step: 1 } },
      { type: 'turn/end', data: { turn: 1 } },
    ]
    expect(planAssistantRewrite(events, true)).toEqual({ turn: 2, step: 1, openTurn: true })
    // busy：最后一个 turn 未闭合 + 已有 1 个 step → 续 step 2
    const busy = [...events, { type: 'turn/start', data: { turn: 2 } }, { type: 'step/start', data: { turn: 2, step: 1 } }]
    expect(planAssistantRewrite(busy, false)).toEqual({ turn: 2, step: 2, openTurn: false })
  })
})
