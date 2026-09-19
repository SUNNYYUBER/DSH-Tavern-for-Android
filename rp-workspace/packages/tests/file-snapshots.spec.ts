/**
 * 任务 1：会话内文件快照（dsht-plugin-shared/file-snapshots.ts）测试——
 * 1. 写操作产生快照（before 状态 base64、existed 标记、同 turn 最早 before 优先）；
 * 2. rollback/regenerate 恢复边界（完整 turn 不动、腰斩 turn 一并恢复、逆序整批）；
 * 3. 恢复 = 写回 before 内容 / existed=false 删除 / 快照记录删除；
 * 4. 共享资产（card.json/avatar.png/skills/）永不快照；
 * 5. 无 session 上下文跳过快照。
 * 全部用临时目录真实文件系统驱动（与 undo.spec.ts 同口径）。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isSnapshotEligible, readLatestTurn, restoreSnapshotsAfter, snapshotBeforeWrite,
  snapshotDir, snapshotRestoreBoundary, snapshotRestoreBoundaryFromEvents, boundaryFromTurnPairs,
  type TurnFileSnapshot,
} from '../src/dsht-plugin-shared/file-snapshots.ts'

let base = ''
let dshHome = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsht-fsnap-'))
  dshHome = join(base, '.dsh')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 造会话（header + turn 结构事件；user/message 不带 data.turn，与真实 DSH 事件契约一致） */
async function makeSession(sid: string, turns: number): Promise<string> {
  const dir = join(dshHome, 'sessions', 'proj', sid)
  await mkdir(dir, { recursive: true })
  const header = { type: 'session', version: 0, id: sid, createdAt: 1000, cwd: join(dshHome, 'rp', 'ws-1') }
  const lines = [JSON.stringify(header)]
  let seq = 0
  for (let t = 1; t <= turns; t++) {
    lines.push(JSON.stringify({ type: 'turn/start', seq: seq++, time: 1000 + seq, data: { turn: t } }))
    lines.push(JSON.stringify({ type: 'user/message', seq: seq++, time: 1000 + seq, data: { role: 'user', content: [{ type: 'text', text: `u${t}` }], source: { kind: 'user' } } }))
    lines.push(JSON.stringify({ type: 'assistant/message', seq: seq++, time: 1000 + seq, data: { turn: t, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: `a${t}` }] } } }))
    lines.push(JSON.stringify({ type: 'turn/end', seq: seq++, time: 1000 + seq, data: { turn: t } }))
  }
  const file = join(dir, 'session.jsonl')
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return file
}

/** 造 rp 数据文件并返回其 $DSH_HOME 相对路径 */
async function makeRpFile(rel: string, content: string): Promise<void> {
  const abs = join(dshHome, ...rel.split('/'))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

describe('file-snapshots: 写前快照', () => {
  it('写操作产生快照：before 内容 base64 + existed 标记 + turn 锚点', async () => {
    await makeSession('sid-1', 3)
    await makeRpFile('rp/ws-1/rp.json', '{"v":1}')
    const r = await snapshotBeforeWrite(dshHome, 'sid-1', ['rp/ws-1/rp.json'])
    expect(r).toMatchObject({ snapshotted: 1, skipped: 0, anchor: 3 })
    const snap = JSON.parse(await readFile(join(snapshotDir(dshHome, 'sid-1'), '3.json'), 'utf8')) as TurnFileSnapshot
    expect(snap.turn).toBe(3)
    expect(snap.files).toHaveLength(1)
    expect(snap.files[0].path).toBe('rp/ws-1/rp.json')
    expect(snap.files[0].existed).toBe(true)
    expect(Buffer.from(snap.files[0].content, 'base64').toString('utf8')).toBe('{"v":1}')
  })

  it('同一 turn 重复写同一文件：只保留最早的 before 状态（恢复点 = turn 开始前）', async () => {
    await makeSession('sid-2', 1)
    await makeRpFile('rp/ws-1/rp.json', '第一版')
    await snapshotBeforeWrite(dshHome, 'sid-2', ['rp/ws-1/rp.json'])
    await makeRpFile('rp/ws-1/rp.json', '第二版')
    const r = await snapshotBeforeWrite(dshHome, 'sid-2', ['rp/ws-1/rp.json'])
    expect(r.snapshotted).toBe(0) // 已有更早 before 状态，不重复记
    const snap = JSON.parse(await readFile(join(snapshotDir(dshHome, 'sid-2'), '1.json'), 'utf8')) as TurnFileSnapshot
    expect(Buffer.from(snap.files[0].content, 'base64').toString('utf8')).toBe('第一版')
  })

  it('不存在的目标文件记 existed=false（恢复时删除）', async () => {
    await makeSession('sid-3', 2)
    const r = await snapshotBeforeWrite(dshHome, 'sid-3', ['rp/state/sid-3.json'])
    expect(r.snapshotted).toBe(1)
    const snap = JSON.parse(await readFile(join(snapshotDir(dshHome, 'sid-3'), '2.json'), 'utf8')) as TurnFileSnapshot
    expect(snap.files[0].existed).toBe(false)
    expect(snap.files[0].content).toBe('')
  })

  it('调用方可显式传 turnAnchor（不读 session.jsonl）', async () => {
    await makeRpFile('rp/ws-1/rp.json', 'x')
    const r = await snapshotBeforeWrite(dshHome, 'ghost-session', ['rp/ws-1/rp.json'], 7)
    expect(r.anchor).toBe(7)
    await stat(join(snapshotDir(dshHome, 'ghost-session'), '7.json'))
  })

  it('无 session 上下文（session.jsonl 不存在/无 turn）→ 跳过快照不写盘', async () => {
    await makeRpFile('rp/ws-1/rp.json', 'x')
    const r = await snapshotBeforeWrite(dshHome, 'no-such-session', ['rp/ws-1/rp.json'])
    expect(r).toMatchObject({ snapshotted: 0, anchor: null })
    await expect(stat(snapshotDir(dshHome, 'no-such-session'))).rejects.toThrow()
  })
})

describe('file-snapshots: 共享资产排除', () => {
  it('card.json / avatar.png / skills/ / 越界路径不快照', () => {
    expect(isSnapshotEligible('rp/ws-1/rp.json')).toBe(true)
    expect(isSnapshotEligible('rp/state/sid.json')).toBe(true)
    expect(isSnapshotEligible('rp/ws-1/card.json')).toBe(false)
    expect(isSnapshotEligible('rp/ws-1/avatar.png')).toBe(false)
    expect(isSnapshotEligible('skills/wb-x/references/lore.json')).toBe(false)
    expect(isSnapshotEligible('../outside.json')).toBe(false)
    expect(isSnapshotEligible('')).toBe(false)
  })

  it('快照写入侧过滤共享资产（skipped 计数）', async () => {
    await makeSession('sid-4', 1)
    await makeRpFile('rp/ws-1/card.json', '{}')
    const r = await snapshotBeforeWrite(dshHome, 'sid-4', ['rp/ws-1/card.json', 'skills/wb-x/lore.json'])
    expect(r).toMatchObject({ snapshotted: 0, skipped: 2 })
    await expect(stat(snapshotDir(dshHome, 'sid-4'))).rejects.toThrow()
  })
})

describe('file-snapshots: 截断边界与恢复', () => {
  it('snapshotRestoreBoundary：完整保留的 turn 不恢复；腰斩 turn 含边界', async () => {
    const file = await makeSession('sid-b', 3) // 每 turn 4 事件：turn/start seq=4(t-1) …
    const content = await readFile(file, 'utf8')
    // 截到 turn 2 的 turn/end（seq 7）：turn 2 完整保留 → fromTurn=2, include=false
    expect(snapshotRestoreBoundary(content, 7)).toEqual({ fromTurn: 2, includeBoundary: false })
    // 截到 turn 2 的 user/message（seq 5）：turn 2 被腰斩 → include=true
    expect(snapshotRestoreBoundary(content, 5)).toEqual({ fromTurn: 2, includeBoundary: true })
    // 截到 0（只留 header + turn/start 1）：fromTurn=1 且 turn 1 腰斩
    expect(snapshotRestoreBoundary(content, 0)).toEqual({ fromTurn: 1, includeBoundary: true })
  })

  // -------------------------------------------------------------------------
  // 【B3 2026-09-14】两入口同源（P-1）：live 分支与文本分支必须得出同一结论
  // -------------------------------------------------------------------------

  it('✅ boundaryFromTurnPairs：与文本入口同源（完整保留 / 腰斩两态）', () => {
    const pairs = [
      { seq: 1, turn: 1 }, { seq: 2, turn: 1 }, { seq: 3, turn: 1 }, { seq: 4, turn: 1 },
      { seq: 5, turn: 2 }, { seq: 6, turn: 2 }, { seq: 7, turn: 2 }, { seq: 8, turn: 2 },
    ]
    // 截到 8（turn 2 的最后一个事件）：turn 2 完整保留、无腰斩
    expect(boundaryFromTurnPairs(pairs, 8)).toEqual({ fromTurn: 2, includeBoundary: false })
    // 截到 7（turn 2 内部）：seq 8 同属 turn 2 被截掉 ⇒ 腰斩
    expect(boundaryFromTurnPairs(pairs, 7)).toEqual({ fromTurn: 2, includeBoundary: true })
    // 截到 5（turn 2 的 user/message）：同样腰斩
    expect(boundaryFromTurnPairs(pairs, 5)).toEqual({ fromTurn: 2, includeBoundary: true })
    // 截到 4（turn 1 末）：fromTurn=1 且 turn 1 无事件被截 ⇒ 不腰斩
    expect(boundaryFromTurnPairs(pairs, 4)).toEqual({ fromTurn: 1, includeBoundary: false })
    // 负控：空输入 → fromTurn 0、不腰斩（不假装恢复到某个 turn）
    expect(boundaryFromTurnPairs([], 5)).toEqual({ fromTurn: 0, includeBoundary: false })
  })

  it('✅ 两入口结论一致：同一会话的「文本」与「事件」必须算出同一边界（防漂移）', async () => {
    const file = await makeSession('sid-b3', 3)
    const content = await readFile(file, 'utf8')
    // 从文本解析出事件（模拟 live 侧 sessionEventsSnapshot 的形态）
    const events = content.split('\n').slice(1).filter(l => l.trim() !== '')
      .map(l => JSON.parse(l) as { seq?: number; data?: unknown })
    // 对每个可能的截断点，两入口结论必须逐字相同
    for (const keep of [0, 1, 3, 5, 7, 9, 11, 999]) {
      expect(
        snapshotRestoreBoundaryFromEvents(events, keep),
        `keepThroughSeq=${keep} 时两入口不一致`,
      ).toEqual(snapshotRestoreBoundary(content, keep))
    }
  })

  it('负控：事件缺 data.turn 时不计入（与文本入口的坏行跳过同语义）', () => {
    const events = [
      { seq: 1, data: { turn: 1 } },
      { seq: 2, data: { role: 'user', content: [] } }, // 无 turn（真实 user/message 形态）
      { seq: 3, data: { turn: 1 } },
      { seq: 4, data: null },
    ]
    expect(snapshotRestoreBoundaryFromEvents(events, 3)).toEqual({ fromTurn: 1, includeBoundary: false })
  })

  it('rollback 恢复文件内容：逆序整批写回 before，快照记录删除', async () => {
    await makeSession('sid-r1', 3)
    await makeRpFile('rp/ws-1/rp.json', 'turn前')
    // turn 2 写一次、turn 3 写一次（模拟两个 turn 各改一次）
    await snapshotBeforeWrite(dshHome, 'sid-r1', ['rp/ws-1/rp.json'], 2)
    await makeRpFile('rp/ws-1/rp.json', 'turn2改后')
    await snapshotBeforeWrite(dshHome, 'sid-r1', ['rp/ws-1/rp.json'], 3)
    await makeRpFile('rp/ws-1/rp.json', 'turn3改后')
    // 回退到 turn 1 末（keepThroughSeq=3）→ 恢复 turn 2/3 快照（逆序）
    const r = await restoreSnapshotsAfter(dshHome, 'sid-r1', { fromTurn: 1, includeBoundary: false })
    expect(r.restoredTurns).toEqual([3, 2])
    expect(r.filesRestored).toBe(2)
    expect(await readFile(join(dshHome, 'rp', 'ws-1', 'rp.json'), 'utf8')).toBe('turn前')
    // 快照记录已删除
    expect(await readdir(snapshotDir(dshHome, 'sid-r1'))).toEqual([])
  })

  it('existed=false 的文件恢复时删除；腰斩 turn 的快照一并恢复', async () => {
    await makeSession('sid-r2', 2)
    // turn 2 创建了状态文件（写入前不存在）
    await snapshotBeforeWrite(dshHome, 'sid-r2', ['rp/state/sid-r2.json'], 2)
    await makeRpFile('rp/state/sid-r2.json', '{"variables":{}}')
    // regenerate 语义：截到 turn 2 的 user/message（seq 5）→ includeBoundary → turn 2 快照也恢复
    const r = await restoreSnapshotsAfter(dshHome, 'sid-r2', { fromTurn: 2, includeBoundary: true })
    expect(r.restoredTurns).toEqual([2])
    expect(r.filesDeleted).toBe(1)
    await expect(stat(join(dshHome, 'rp', 'state', 'sid-r2.json'))).rejects.toThrow()
  })

  it('边界之外的 turn 不动（完整保留的 turn 快照残留待后续回退）', async () => {
    await makeSession('sid-r3', 3)
    await makeRpFile('rp/ws-1/rp.json', 'v0')
    await snapshotBeforeWrite(dshHome, 'sid-r3', ['rp/ws-1/rp.json'], 1)
    await snapshotBeforeWrite(dshHome, 'sid-r3', ['rp/ws-1/rp.json'], 3)
    // 回退到 turn 2 末 → 只恢复 turn 3
    const r = await restoreSnapshotsAfter(dshHome, 'sid-r3', { fromTurn: 2, includeBoundary: false })
    expect(r.restoredTurns).toEqual([3])
    expect(await readdir(snapshotDir(dshHome, 'sid-r3'))).toEqual(['1.json'])
  })

  it('无快照目录 → 零恢复不炸', async () => {
    const r = await restoreSnapshotsAfter(dshHome, 'ghost', { fromTurn: 1, includeBoundary: true })
    expect(r).toMatchObject({ restoredTurns: [], filesRestored: 0, filesDeleted: 0, errors: [] })
  })
})

describe('file-snapshots: turn 锚点读取', () => {
  it('readLatestTurn 从尾行读最大 turn（user/message 无 turn 字段不干扰）', async () => {
    const file = await makeSession('sid-t', 4)
    expect(await readLatestTurn(file)).toBe(4)
    expect(await readLatestTurn(join(base, 'nowhere.jsonl'))).toBeNull()
  })
})
