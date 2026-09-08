/**
 * dsht-plugin-undo 测试：
 * 1. 共享模块抽取（dsht-plugin-shared/session-surgery.ts）后 dsh-plugin 行为不变；
 * 2. 回退路由核心（rollbackSession）：截断/备份/校验/live 409/404；
 * 3. 重新生成路由核心（regenerateSession）：锚定最后 user/message、返回
 *    {truncatedTo, lastUserText}、原地截断不开新分支。
 * 全部用临时目录真实文件系统驱动（rollback 路由逻辑的 node 冒烟同口径）。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findLastUserMessage, readFirstLine, scanSessionHeaders, truncateSessionJsonl,
} from '../src/dsht-plugin-shared/session-surgery.ts'
import {
  regenerateSession, rollbackSession, name as undoPluginName, inject as undoInject,
  type UndoDeps,
} from '../src/dsht-plugin-undo/index.ts'
import {
  captureWorkspaceSnapshot, hasTurnSnapshot, resolveWorkspaceSnapshotConfig,
  type ResolvedWorkspaceSnapshotConfig,
} from '../src/dsht-plugin-undo/workspace-snapshots.ts'
// dsh-plugin 公开面回归：抽取后仍从原路径导出同一实现
import {
  findLastUserMessage as dshFindLastUserMessage,
  truncateSessionJsonl as dshTruncate,
} from '../src/dsh-plugin/index.ts'

let base = ''
let dshHome = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsht-undo-'))
  dshHome = join(base, '.dsh')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 造一个会话：sessions/<project>/<sid>/session.jsonl（header + 事件行） */
async function makeSession(project: string, sid: string, events: Array<Record<string, unknown>>, cwd?: string): Promise<{ file: string; header: Record<string, unknown> }> {
  const dir = join(dshHome, 'sessions', project, sid)
  await mkdir(dir, { recursive: true })
  const header = { type: 'session', version: 0, id: sid, createdAt: 1000, cwd: cwd ?? `/ws/${project}`, delegationDepth: 0 }
  const lines = [JSON.stringify(header), ...events.map(e => JSON.stringify(e))]
  const file = join(dir, 'session.jsonl')
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return { file, header }
}

const ev = (type: string, seq: number, time: number, data: unknown = {}): Record<string, unknown> => ({ type, seq, time, data })
const userMsg = (seq: number, text: string, time = 100 + seq): Record<string, unknown> =>
  ev('user/message', seq, time, { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })

const deps = (live: string[] = [], snapshots?: ResolvedWorkspaceSnapshotConfig): UndoDeps => ({
  dshHome,
  isLive: (id) => live.includes(id),
  ...(snapshots === undefined ? {} : { snapshots }),
})

describe('undo: 共享模块抽取后 dsh-plugin 行为不变', () => {
  const header = JSON.stringify({ type: 'session', version: 0, id: 's-1', createdAt: 1, cwd: '/x' })
  const file = [
    header,
    JSON.stringify({ type: 'user/message', seq: 0, time: 1, data: {} }),
    JSON.stringify({ type: 'assistant/message', seq: 1, time: 2, data: {} }),
    JSON.stringify({ type: 'turn/end', seq: 2, time: 3 }),
  ].join('\n') + '\n'

  it('dsh-plugin re-export 与共享模块是同一实现（引用相等）', () => {
    expect(dshTruncate).toBe(truncateSessionJsonl)
    expect(dshFindLastUserMessage).toBe(findLastUserMessage)
  })

  it('截断结果与原契约一致（header 保留、seq<=keepThroughSeq 保留）', () => {
    const r = dshTruncate(file, 0)
    expect(r.kept).toBe(1)
    expect(r.dropped).toBe(2)
    expect(r.content).toBe([header, JSON.stringify({ type: 'user/message', seq: 0, time: 1, data: {} })].join('\n') + '\n')
    expect(dshTruncate(file, 99).dropped).toBe(0) // no-op 边界
    expect(dshTruncate('bad\n', 1).error).toBeTruthy()
  })

  it('readFirstLine / scanSessionHeaders：只读首行、按 header.id 定位', async () => {
    const big = 'x'.repeat(100_000)
    const { file } = await makeSession('proj-a', 'sid-1', [ev('turn/start', 0, 1)])
    // 大事件行不影响首行扫描
    await writeFile(file, JSON.stringify({ type: 'session', version: 0, id: 'sid-1', cwd: '/ws/proj-a' }) + '\n' + JSON.stringify({ type: 'x', seq: 0, data: big }) + '\n')
    await makeSession('proj-b', 'sid-2', [ev('turn/start', 0, 1)])
    const first = await readFirstLine(file)
    expect(first).toContain('"id":"sid-1"')
    expect(first!.length).toBeLessThan(8192)
    const headers = await scanSessionHeaders(dshHome)
    expect(headers.map(h => h.sessionId).sort()).toEqual(['sid-1', 'sid-2'])
    const hit = headers.find(h => h.sessionId === 'sid-2')!
    expect(hit.project).toBe('proj-b')
    expect(hit.sdir).toBe('sid-2')
    // 无 sessions 目录 → 空清单（不抛）
    expect(await scanSessionHeaders(join(base, 'nowhere'))).toEqual([])
  })
})

describe('undo: rollback 路由核心（临时目录文件系统）', () => {
  const events = [
    ev('turn/start', 0, 100),
    userMsg(1, '第一句', 101),
    ev('assistant/message', 2, 102),
    ev('turn/end', 3, 103),
    ev('turn/start', 4, 104),
    userMsg(5, '第二句', 105),
    ev('assistant/message', 6, 106),
    ev('turn/end', 7, 107),
  ]

  it('截断到 keepThroughSeq（含）：header 保留、后序事件移除、先备份 .bak', async () => {
    const { file, header } = await makeSession('proj', 'sid-r', events)
    const r = await rollbackSession(deps(), { sessionId: 'sid-r', keepThroughSeq: 5 })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ kept: 6, dropped: 2, truncatedTo: 5 })
    const after = await readFile(file, 'utf8')
    const lines = after.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({ type: 'session', id: 'sid-r', cwd: header.cwd })
    expect(lines.map(l => l.seq ?? -1)).toEqual([-1, 0, 1, 2, 3, 4, 5])
    // .bak = 截断前完整内容
    const bak = JSON.parse((await readFile(`${file}.bak`, 'utf8')).trimEnd().split('\n').pop()!) as { seq: number }
    expect(bak.seq).toBe(7)
    // 原地修改：同一路径，无新 session 目录
    await expect(readdir(join(dshHome, 'sessions', 'proj'))).resolves.toEqual(['sid-r'])
  })

  it('live session 拒绝（409，提示先关闭）；未知会话 404；参数校验 400', async () => {
    await makeSession('proj', 'sid-live', events)
    const live = await rollbackSession(deps(['sid-live']), { sessionId: 'sid-live', keepThroughSeq: 1 })
    expect(live.code).toBe(409)
    expect(String(live.body.error)).toContain('关闭')
    // live 拒绝时文件不动、无 .bak
    const file = join(dshHome, 'sessions', 'proj', 'sid-live', 'session.jsonl')
    await expect(stat(`${file}.bak`)).rejects.toThrow()
    expect((await readFile(file, 'utf8')).trimEnd().split('\n')).toHaveLength(9)

    expect((await rollbackSession(deps(), { sessionId: 'ghost', keepThroughSeq: 1 })).code).toBe(404)
    expect((await rollbackSession(deps(), { keepThroughSeq: 1 })).code).toBe(400)
    expect((await rollbackSession(deps(), { sessionId: 'sid-live', keepThroughSeq: -1 })).code).toBe(400)
    expect((await rollbackSession(deps(), { sessionId: 'sid-live', keepThroughSeq: 1.5 })).code).toBe(400)
  })

  it('no-op（keepThroughSeq 之后没有事件）不写盘不备份', async () => {
    const { file } = await makeSession('proj', 'sid-noop', events)
    const r = await rollbackSession(deps(), { sessionId: 'sid-noop', keepThroughSeq: 99 })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ dropped: 0 })
    await expect(stat(`${file}.bak`)).rejects.toThrow()
  })
})

describe('undo: regenerate 路由核心', () => {
  it('锚定最后 user/message：截掉其后全部事件，返回 {truncatedTo, lastUserText}', async () => {
    const { file } = await makeSession('proj', 'sid-g', [
      ev('turn/start', 0, 100),
      userMsg(1, '第一句', 101),
      ev('assistant/message', 2, 102),
      ev('turn/end', 3, 103),
      ev('turn/start', 4, 104),
      userMsg(5, '重来这句', 105),
      ev('step/start', 6, 106),
      ev('assistant/message', 7, 107),
      ev('step/end', 8, 108),
      ev('turn/end', 9, 109),
    ])
    const r = await regenerateSession(deps(), { sessionId: 'sid-g' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ truncatedTo: 5, truncated: 4, lastUserText: '重来这句' })
    // 文件截到 seq 5（含）；.bak 留存
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n').map(l => JSON.parse(l) as { seq?: number })
    expect(lines.map(l => l.seq ?? -1)).toEqual([-1, 0, 1, 2, 3, 4, 5])
    await expect(stat(`${file}.bak`)).resolves.toBeTruthy()
  })

  it('无用户消息 → 400；live → 409；最后用户消息之后没有事件 → no-op 且仍返回 lastUserText', async () => {
    await makeSession('proj', 'sid-empty', [ev('turn/start', 0, 100)])
    const noAnchor = await regenerateSession(deps(), { sessionId: 'sid-empty' })
    expect(noAnchor.code).toBe(400)
    expect(String(noAnchor.body.error)).toContain('用户消息')

    await makeSession('proj', 'sid-live2', [userMsg(0, 'hi', 100), ev('assistant/message', 1, 101)])
    expect((await regenerateSession(deps(['sid-live2']), { sessionId: 'sid-live2' })).code).toBe(409)

    await makeSession('proj', 'sid-tail', [userMsg(0, '尾巴', 100)])
    const noop = await regenerateSession(deps(), { sessionId: 'sid-tail' })
    expect(noop.code).toBe(200)
    expect(noop.body).toMatchObject({ truncatedTo: 0, truncated: 0, lastUserText: '尾巴' })
  })
})

describe('undo: 工作区文件快照（turn 锚点，真实 git 仓库）', () => {
  const execFileAsync = promisify(execFile)
  const gitIn = async (cwd: string, args: string[]): Promise<void> => {
    await execFileAsync('git', ['-c', 'core.quotepath=false', '-C', cwd, ...args])
  }

  /** 造一个 git 工作区：a.txt / b.txt / _pipeline/p.txt 已提交 */
  async function makeWorkspace(): Promise<string> {
    const ws = join(base, 'ws')
    await mkdir(join(ws, '_pipeline'), { recursive: true })
    await writeFile(join(ws, 'a.txt'), 'a1', 'utf8')
    await writeFile(join(ws, 'b.txt'), 'b1', 'utf8')
    await writeFile(join(ws, '_pipeline', 'p.txt'), 'p1', 'utf8')
    await gitIn(ws, ['init'])
    await gitIn(ws, ['config', 'user.email', 'undo@test.local'])
    await gitIn(ws, ['config', 'user.name', 'undo-test'])
    await gitIn(ws, ['add', '.'])
    await gitIn(ws, ['commit', '-m', 'init'])
    return ws
  }

  /** 两个 turn 的事件流（turn/start 与 turn/end 都带 data.turn，与真实 DSH 事件一致） */
  const turnEvents = [
    ev('turn/start', 0, 100, { turn: 1 }),
    userMsg(1, '第一句', 101),
    ev('assistant/message', 2, 102, { turn: 1 }),
    ev('turn/end', 3, 103, { turn: 1 }),
    ev('turn/start', 4, 104, { turn: 2 }),
    userMsg(5, '第二句', 105),
    ev('assistant/message', 6, 106, { turn: 2 }),
    ev('turn/end', 7, 107, { turn: 2 }),
  ]

  /** 模拟 turn 2 期间 agent 工具对工作区的改动 */
  async function simulateTurn2Work(ws: string): Promise<void> {
    await writeFile(join(ws, 'a.txt'), 'a2', 'utf8') // 改
    await rm(join(ws, 'b.txt')) // 删
    await writeFile(join(ws, 'c.txt'), 'c2', 'utf8') // 新增
    await writeFile(join(ws, '_pipeline', 'p.txt'), 'p2', 'utf8') // 改（排除前缀内）
  }

  const snapConfig = () => resolveWorkspaceSnapshotConfig(dshHome, { excludePrefixes: ['_pipeline/'] })!

  it('快照→改文件→rollback→文件逆序整批恢复（排除前缀不动）', async () => {
    const ws = await makeWorkspace()
    await makeSession('proj', 'sid-fs', turnEvents, ws)
    const config = snapConfig()
    const cap = await captureWorkspaceSnapshot({ sessionId: 'sid-fs', turn: 2, cwd: ws, config })
    expect(cap.skipped).toBe(false)
    expect(cap.fileCount).toBe(2) // _pipeline/ 被 excludePrefixes 清点层排除
    await simulateTurn2Work(ws)

    const r = await rollbackSession(deps([], config), { sessionId: 'sid-fs', keepThroughSeq: 3 })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ kept: 4, dropped: 4, truncatedTo: 3 })
    expect(r.body.fileSnapshots).toMatchObject({ turns: [2], restored: 2, deleted: 1, errors: [] })
    // 工作区回到 turn 2 开始前：a 复原、b 回来、c 消失；_pipeline/ 永不回退
    expect(await readFile(join(ws, 'a.txt'), 'utf8')).toBe('a1')
    expect(await readFile(join(ws, 'b.txt'), 'utf8')).toBe('b1')
    await expect(stat(join(ws, 'c.txt'))).rejects.toThrow()
    expect(await readFile(join(ws, '_pipeline', 'p.txt'), 'utf8')).toBe('p2')
    // 已恢复的快照记录删除（不再参与后续回退）
    expect(await hasTurnSnapshot(config, 'sid-fs', 2)).toBe(false)
  })

  it('同 turn 重复捕获幂等：保留最早 before 状态', async () => {
    const ws = await makeWorkspace()
    const config = snapConfig()
    await captureWorkspaceSnapshot({ sessionId: 'sid-fs', turn: 2, cwd: ws, config })
    await writeFile(join(ws, 'a.txt'), 'a2', 'utf8') // turn 2 第一次改动
    const again = await captureWorkspaceSnapshot({ sessionId: 'sid-fs', turn: 2, cwd: ws, config })
    expect(again.skipped).toBe(true) // 不覆盖最早 before
    await makeSession('proj', 'sid-fs', turnEvents, ws)
    const r = await rollbackSession(deps([], config), { sessionId: 'sid-fs', keepThroughSeq: 3 })
    expect(r.code).toBe(200)
    expect(await readFile(join(ws, 'a.txt'), 'utf8')).toBe('a1')
  })

  it('regenerate 腰斩最后一轮：该 turn 的文件改动一并回退', async () => {
    const ws = await makeWorkspace()
    await makeSession('proj', 'sid-fg', turnEvents, ws)
    const config = snapConfig()
    await captureWorkspaceSnapshot({ sessionId: 'sid-fg', turn: 2, cwd: ws, config })
    await simulateTurn2Work(ws)

    const r = await regenerateSession(deps([], config), { sessionId: 'sid-fg' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ truncatedTo: 5, truncated: 2, lastUserText: '第二句' })
    expect(r.body.fileSnapshots).toMatchObject({ turns: [2], restored: 2, deleted: 1, errors: [] })
    expect(await readFile(join(ws, 'a.txt'), 'utf8')).toBe('a1')
    expect(await readFile(join(ws, 'b.txt'), 'utf8')).toBe('b1')
    await expect(stat(join(ws, 'c.txt'))).rejects.toThrow()
    expect(await readFile(join(ws, '_pipeline', 'p.txt'), 'utf8')).toBe('p2')
    expect(await hasTurnSnapshot(config, 'sid-fg', 2)).toBe(false)
  })

  it('bounded：maxFiles 超限捕获拒绝；enabled:false 能力整体关闭', async () => {
    const ws = await makeWorkspace()
    const tight = resolveWorkspaceSnapshotConfig(dshHome, { maxFiles: 1 })!
    await expect(captureWorkspaceSnapshot({ sessionId: 's', turn: 1, cwd: ws, config: tight }))
      .rejects.toThrow('TOO_MANY_FILES')
    expect(await hasTurnSnapshot(tight, 's', 1)).toBe(false) // 拒绝不落盘
    expect(resolveWorkspaceSnapshotConfig(dshHome, { enabled: false })).toBeNull()
  })

  it('无快照时 rollback 照常截断，fileSnapshots 为空批', async () => {
    const ws = await makeWorkspace()
    await makeSession('proj', 'sid-ns', turnEvents, ws)
    const r = await rollbackSession(deps([], snapConfig()), { sessionId: 'sid-ns', keepThroughSeq: 3 })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ dropped: 4 })
    expect(r.body.fileSnapshots).toMatchObject({ turns: [], restored: 0, deleted: 0, errors: [] })
    expect(await readFile(join(ws, 'a.txt'), 'utf8')).toBe('a1') // 没被动过
  })
})

describe('undo: 插件声明面', () => {
  it('cordis name/inject（host 需要 webServer 数据面 + sessions live 判定）', () => {
    expect(undoPluginName).toBe('dsht-plugin-undo')
    expect(undoInject).toEqual(expect.arrayContaining(['webServer', 'sessions']))
  })
})
