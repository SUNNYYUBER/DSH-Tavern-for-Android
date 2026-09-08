/**
 * T3.2 会话长期记忆（rp-memory 最小闭环）测试——纯函数层（packages/src/dsh-plugin/memory.ts）：
 * 1. 存储形状（{entries:[{id,text,source,createdAt}]}，落盘/读回 round-trip）；
 * 2. 追加与去抖（同文本重复保存不重复入库；空/超长拒绝）；
 * 3. 200 条淘汰（超出丢最旧）；
 * 4. query 关键词检索（命中任一词即算、命中词数排序、limit）；
 * 5. 删除单条；
 * 6. 注入渲染（最近 20 条 `- [时间] 文本`、无记忆空串）；
 * 7. 路由接线依赖的薄 IO 约定（sessionId 校验、写前快照路径可被 snapshotBeforeWrite 覆盖）。
 * 文件层用临时目录真实文件系统驱动（与 file-snapshots.spec.ts 同口径）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendMemory, deleteMemoryEntry, formatMemoryTime, isValidMemorySessionId, loadMemory,
  makeMemoryId, memoryFilePath, memoryRelPath, normalizeMemorySource, queryMemory,
  renderMemorySnapshot, saveMemory, MEMORY_MAX_ENTRIES, MEMORY_TEXT_MAX,
  type MemoryEntry, type MemoryFile,
} from '../src/dsh-plugin/memory.ts'
import { snapshotBeforeWrite } from '../src/dsht-plugin-shared/file-snapshots.ts'

let base = ''
let dshHome = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsht-rp-mem-'))
  dshHome = join(base, '.dsh')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('rp-memory: 存储形状', () => {
  it('save/load round-trip：{entries:[{id,text,source,createdAt}]}', async () => {
    const empty: MemoryFile = { entries: [] }
    const r = appendMemory(empty, '用户偏好甜口味', 'user', { now: 1756368000000 })
    expect(r.ok).toBe(true)
    await saveMemory(dshHome, 'sid-1', r.file)
    // 落盘形状：根键只有 entries，条目四字段齐全
    const raw = JSON.parse(await readFile(memoryFilePath(dshHome, 'sid-1'), 'utf8')) as { entries: MemoryEntry[] }
    expect(Object.keys(raw)).toEqual(['entries'])
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0]).toMatchObject({ text: '用户偏好甜口味', source: 'user', createdAt: 1756368000000 })
    expect(typeof raw.entries[0].id).toBe('string')
    // 读回一致
    const back = await loadMemory(dshHome, 'sid-1')
    expect(back.entries).toEqual(raw.entries)
  })

  it('loadMemory：文件缺失/损坏/形状不对 → 空记忆（不抛错）', async () => {
    expect((await loadMemory(dshHome, 'none')).entries).toEqual([])
    await saveMemory(dshHome, 'bad', { entries: [] }) // 先建目录，再写坏内容
    await writeFile(memoryFilePath(dshHome, 'bad'), '{oops', 'utf8')
    expect((await loadMemory(dshHome, 'bad')).entries).toEqual([])
    await writeFile(memoryFilePath(dshHome, 'weird'), JSON.stringify({ entries: ['x', null, { id: 'ok', text: '好条目' }] }), 'utf8')
    const w = await loadMemory(dshHome, 'weird')
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0]).toMatchObject({ id: 'ok', text: '好条目', source: 'agent' })
  })

  it('sessionId 校验：非空、无路径分隔符与 ..（防路由 payload 越界写盘）', () => {
    expect(isValidMemorySessionId('abc-123')).toBe(true)
    expect(isValidMemorySessionId('')).toBe(false)
    expect(isValidMemorySessionId('../escape')).toBe(false)
    expect(isValidMemorySessionId('a/b')).toBe(false)
    expect(isValidMemorySessionId('a\\b')).toBe(false)
    expect(isValidMemorySessionId(' x ')).toBe(false)
  })
})

describe('rp-memory: 追加与去抖', () => {
  it('追加：id 形如 <ts36>-<4位>；默认 source=agent；text trim 后入库；不改入参', () => {
    const file: MemoryFile = { entries: [] }
    const r = appendMemory(file, '  角色承诺归还宝剑  ', 'agent', { now: 1756368000000 })
    expect(r.ok).toBe(true)
    expect(r.entry).toBeDefined()
    expect(r.entry!.text).toBe('角色承诺归还宝剑')
    expect(r.entry!.id).toMatch(/^[a-z0-9]+-[a-z0-9]{4}$/)
    expect(r.entry!.createdAt).toBe(1756368000000)
    // 纯函数：入参文件对象不被改动
    expect(file.entries).toHaveLength(0)
    expect(r.file.entries).toHaveLength(1)
  })

  it('去抖：相同文本（trim 后全等）重复保存只保留一条，幂等命中原条目', () => {
    let file: MemoryFile = { entries: [] }
    const first = appendMemory(file, '用户喜欢甜食', 'user', { now: 1000 })
    file = first.file
    const dup = appendMemory(file, '  用户喜欢甜食  ', 'agent', { now: 2000 })
    expect(dup.ok).toBe(true)
    expect(dup.duplicate).toBe(true)
    expect(dup.entry!.id).toBe(first.entry!.id) // 指向已存在条目
    expect(dup.file).toBe(file) // 文件不变
    expect(file.entries).toHaveLength(1)
    // 不同文本照常追加
    const second = appendMemory(file, '用户讨厌香菜', 'user', { now: 3000 })
    expect(second.ok).toBe(true)
    expect(second.duplicate).toBeUndefined()
    expect(second.file.entries).toHaveLength(2)
  })

  it('拒绝：空文本（empty）与超 2000 字（too-long）', () => {
    const file: MemoryFile = { entries: [] }
    expect(appendMemory(file, '   ', 'agent').ok).toBe(false)
    expect(appendMemory(file, '   ', 'agent').error).toBe('empty')
    expect(appendMemory(file, 'x'.repeat(MEMORY_TEXT_MAX), 'agent').ok).toBe(true) // 恰好 2000 字合法
    const over = appendMemory(file, '甜'.repeat(MEMORY_TEXT_MAX + 1), 'agent')
    expect(over.ok).toBe(false)
    expect(over.error).toBe('too-long')
  })

  it('source 归一：仅 user 保留，其余（含缺省/乱值）一律 agent', () => {
    expect(normalizeMemorySource('user')).toBe('user')
    expect(normalizeMemorySource('agent')).toBe('agent')
    expect(normalizeMemorySource(undefined)).toBe('agent')
    expect(normalizeMemorySource('model')).toBe('agent')
  })

  it('makeMemoryId：时间戳 36 进制 + 随机 4 位（同毫秒两次调用 id 不同）', () => {
    const a = makeMemoryId(1756368000000)
    const b = makeMemoryId(1756368000000)
    expect(a).toMatch(/^[a-z0-9]+-[a-z0-9]{4}$/)
    expect(b).toMatch(/^[a-z0-9]+-[a-z0-9]{4}$/)
    expect(a.split('-')[0]).toBe((1756368000000).toString(36))
    expect(a).not.toBe(b)
  })
})

describe('rp-memory: 200 条淘汰', () => {
  it('上限 200 条：超出丢最旧（头部），最新条目保留', () => {
    let file: MemoryFile = { entries: [] }
    const total = MEMORY_MAX_ENTRIES + 5
    for (let i = 0; i < total; i++) {
      const r = appendMemory(file, `事实-${i}`, 'agent', { now: 1000 + i })
      expect(r.ok).toBe(true)
      file = r.file
    }
    expect(file.entries).toHaveLength(MEMORY_MAX_ENTRIES)
    expect(file.entries[0].text).toBe('事实-5') // 最旧 5 条被丢
    expect(file.entries.at(-1)!.text).toBe(`事实-${total - 1}`)
    expect(file.entries.map(e => e.createdAt)).toEqual([...file.entries.map(e => e.createdAt)].sort((a, b) => a - b)) // 保持追加序
  })
})

describe('rp-memory: query 检索', () => {
  const entries: MemoryEntry[] = [
    { id: 'a', text: '用户喜欢甜食和奶茶', source: 'user', createdAt: 1 },
    { id: 'b', text: '角色承诺下周归还宝剑', source: 'agent', createdAt: 2 },
    { id: 'c', text: '用户讨厌香菜', source: 'user', createdAt: 3 },
    { id: 'd', text: '甜食口味偏好：用户爱奶油蛋糕', source: 'agent', createdAt: 4 },
  ]
  it('命中任一词即算；命中词数降序（同分取较新）', () => {
    const hits = queryMemory(entries, '用户 甜食', 10)
    // d 命中「甜食+用户」2 词（且较新）排最前；a 同 2 词在其后；c 只命中「用户」
    expect(hits.map(h => h.id)).toEqual(['d', 'a', 'c'])
    expect(hits[0].score).toBe(2)
    // 单词精确命中
    expect(queryMemory(entries, '宝剑', 10).map(h => h.id)).toEqual(['b'])
  })
  it('limit 截断与默认值、大小写不敏感、空查询 → 空', () => {
    expect(queryMemory(entries, '用户', 1)).toHaveLength(1)
    expect(queryMemory(entries, '用户', 1)[0].id).toBe('d') // 单词命中同分（1 词）取较新（d 含「用户」且 createdAt 更大）
    expect(queryMemory(entries, 'sweet CAKE', 10)).toEqual([]) // 无英文词命中
    // 大小写不敏感
    const en: MemoryEntry[] = [{ id: 'e1', text: 'Favorite color is BLUE', source: 'agent', createdAt: 1 }]
    expect(queryMemory(en, 'blue', 10).map(h => h.id)).toEqual(['e1'])
    expect(queryMemory(entries, '   ', 10)).toEqual([])
    expect(queryMemory(entries, '不存在的词', 10)).toEqual([])
    // 默认 limit = 10
    const many: MemoryEntry[] = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, text: `偏好${i}`, source: 'agent' as const, createdAt: i }))
    expect(queryMemory(many, '偏好')).toHaveLength(10)
  })
})

describe('rp-memory: 删除单条', () => {
  it('删除命中：条目移除、不改入参；id 不存在 → deleted=false', () => {
    const file: MemoryFile = { entries: [
      { id: 'x1', text: '一', source: 'agent', createdAt: 1 },
      { id: 'x2', text: '二', source: 'user', createdAt: 2 },
    ] }
    const r = deleteMemoryEntry(file, 'x1')
    expect(r.deleted).toBe(true)
    expect(r.file.entries.map(e => e.id)).toEqual(['x2'])
    expect(file.entries).toHaveLength(2) // 入参不变
    const miss = deleteMemoryEntry(file, 'nope')
    expect(miss.deleted).toBe(false)
    expect(miss.file.entries.map(e => e.id)).toEqual(['x1', 'x2'])
  })
})

describe('rp-memory: 注入渲染', () => {
  it('renderMemorySnapshot：取最近 20 条（陈→新），格式 `- [YYYY-MM-DD HH:mm] 文本`；空 → 空串', () => {
    const many: MemoryEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`, text: `事实-${i}`, source: 'agent' as const,
      createdAt: new Date(2026, 0, 1, 8, i % 60).getTime(), // 本地时区构造（渲染同样走本地时区）
    }))
    const text = renderMemorySnapshot(many)
    const lines = text.split('\n')
    expect(lines).toHaveLength(20)
    expect(lines[0]).toMatch(/^- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] 事实-5$/)
    expect(lines[19]).toContain('事实-24')
    expect(renderMemorySnapshot([])).toBe('')
    // count 可调
    expect(renderMemorySnapshot(many, { count: 3 }).split('\n')).toHaveLength(3)
  })
  it('formatMemoryTime：YYYY-MM-DD HH:mm（本地时区）', () => {
    expect(formatMemoryTime(new Date(2026, 7, 28, 14, 5).getTime())).toBe('2026-08-28 14:05')
  })
})

describe('rp-memory: 路由接线的薄 IO 约定', () => {
  it('memoryRelPath 指向 rp/memory/<sid>.json 且可被写前快照覆盖（snapshotBeforeWrite 语义）', async () => {
    const sid = 'sid-9'
    expect(memoryRelPath(sid)).toBe('rp/memory/sid-9.json')
    // 造会话（含 turn 锚点）+ 既有记忆文件 → 写前快照命中
    const dir = join(dshHome, 'sessions', 'proj', sid)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.jsonl'), [
      JSON.stringify({ type: 'session', version: 0, id: sid, createdAt: 1000, cwd: join(dshHome, 'rp', 'ws') }),
      JSON.stringify({ type: 'turn/start', seq: 1, time: 1001, data: { turn: 2 } }),
    ].join('\n') + '\n', 'utf8')
    await saveMemory(dshHome, sid, { entries: [] })
    const r = await snapshotBeforeWrite(dshHome, sid, [memoryRelPath(sid)])
    expect(r.snapshotted).toBe(1)
    expect(r.anchor).toBe(2)
  })
})
