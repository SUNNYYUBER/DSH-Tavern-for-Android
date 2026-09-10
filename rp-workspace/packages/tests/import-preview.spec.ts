/**
 * §4.16.1 / §4.6 导入 diff 预览 + 断点续跑（checkpoint）测试——
 * 1. 丢弃判定（vectors/backups/.luker-state/.before_clean/chats 隐藏文件；zip 反斜杠归一）；
 * 2. ST 数据根定位（多用户结构最深 settings.json 优先；.vscode 抢根排除——历史实测坑）；
 * 3. 预览扫描（临时目录真实 FS）：卡（PNG tEXt/JSON 头、内嵌正则/世界书/备选开场白）、
 *    书（entries 两种形态、已绑定判定）、聊天（消息数、已存在 session 匹配、孤儿）、
 *    预设（displayName/prompts 数/同名覆盖）、EJS 计数；
 * 4. 同名检测：rp/<slug> 目录名按卡名匹配 + characterName 归一化兜底；
 * 5. checkpoint：parse/merge/summary（坏 JSON、未知 stage 过滤、done 清洗、归并保留其他类目）；
 * 6. §4.16.1 屏5/屏6：进度模型（done 元素三形态解析/逐类目计数/manifest totals/批次汇总）、
 *    预估剩余时间（startedAt 类目速率优先 → 全局速率兜底 → 数据不足 null）、待认领（claim 标记
 *    + 预览孤儿聊天/同名卡版本更新收集）。
 * 全部用临时目录真实文件系统驱动（与 file-snapshots.spec.ts 同口径）。
 */
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHECKPOINT_STAGES, buildBatchProgress, cardJsonName, classifyDropped, claimHint,
  collectPreviewClaims, countChatMessages, countDoneByStage, estimateRemainingMinutes,
  findStDataRoot, findBookBoundBy, findExistingCardSlug, isEjsTemplate, loadExistingState,
  lorebookEntryCount, normalizeCheckpointWrite, normalizeName, parseCheckpointFile,
  parseDoneEntry, progressTotalsFromManifest, scanImportPreview,
  stPresetPromptCount, summarizeCheckpoint, sanitizeDoneList,
} from '../src/dsh-plugin/import-preview.ts'
// 兼容面断言：findStDataRoot 必须仍可从 index.ts 导入（移动后 re-export 保持公开面）
import { findStDataRoot as findStDataRootViaIndex } from '../src/dsh-plugin/index.ts'
import { dshSlug, chatSessionId, encodeSegment, projectKey } from '../src/import/dsh-export.ts'
import { makePlaceholderPng, writeCardTextChunks } from '../src/import/card-export.ts'

let base = ''
let dshHome = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsht-import-preview-'))
  dshHome = join(base, '.dsh')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 造 ST V2 卡 JSON（含可选内嵌正则/世界书/备选开场白/EJS；character_book 在 data 层——V2 spec） */
function cardJson(name: string, opts: {
  regex?: number
  bookEntries?: number
  greetings?: number
  ejs?: boolean
} = {}): string {
  const data: Record<string, unknown> = {
    name,
    description: opts.ejs ? `<% if (mood) { %>心情：<%= mood %><% } %>\n「${name}」的角色设定` : `「${name}」的角色设定`,
    personality: '', scenario: '', first_mes: '你好。', mes_example: '',
    alternate_greetings: Array.from({ length: opts.greetings ?? 0 }, (_, i) => `备选开场白 ${i + 1}`),
    ...(opts.bookEntries ? {
      character_book: {
        entries: Array.from({ length: opts.bookEntries }, (_, i) => ({
          keys: [`关键词${i + 1}`], content: `条目 ${i + 1}`, enabled: true,
        })),
      },
    } : {}),
    extensions: {
      regex_scripts: Array.from({ length: opts.regex ?? 0 }, (_, i) => ({ scriptName: `正则 ${i + 1}` })),
    },
  }
  return JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data })
}

/** 造 ST 聊天 jsonl（首行 header + n 条消息） */
function chatJsonl(messages: number): string {
  const lines = [JSON.stringify({ user_name: 'user', character_name: 'x', chat_metadata: { variables: null } })]
  for (let i = 0; i < messages; i++) {
    lines.push(JSON.stringify({ name: i % 2 ? 'x' : 'user', is_user: i % 2 === 0, mes: `第 ${i + 1} 条`, send_date: '2026-01-01' }))
  }
  return lines.join('\n') + '\n'
}

describe('import-preview: 丢弃判定（纯函数）', () => {
  it('vectors/backups 整目录 + luker/before_clean/chats 隐藏文件 → 带原因', () => {
    expect(classifyDropped('data/default-user/vectors/index.json')).toContain('向量库')
    expect(classifyDropped('vectors/')).toContain('向量库')
    expect(classifyDropped('backups/auto-save.json')).toContain('备份')
    expect(classifyDropped('chats/Seraphina/.luker-state.1700000000.json')).toContain('Luker')
    expect(classifyDropped('chats/Seraphina/.before_clean_1')).toContain('before_clean')
    expect(classifyDropped('chats/Seraphina/.plugin-cache')).toContain('插件')
  })
  it('zip 反斜杠路径归一后判定（前五轮 zip 反斜杠坑的防御）', () => {
    expect(classifyDropped('data\\default-user\\vectors\\x.json')).toContain('向量库')
    expect(classifyDropped('chats\\Seraphina\\.luker-state.1.json')).toContain('Luker')
  })
  it('正常资源不丢弃', () => {
    expect(classifyDropped('characters/Seraphina.png')).toBeNull()
    expect(classifyDropped('worlds/世界书.json')).toBeNull()
    expect(classifyDropped('OpenAI Settings/[主预设] 示例预设.json')).toBeNull()
    expect(classifyDropped('settings.json')).toBeNull()
  })
})

describe('import-preview: ST 数据根定位', () => {
  it('data/default-user 多用户结构：标志打分最深根优先；.vscode 不抢根', async () => {
    const unpacked = join(base, 'unpacked')
    const root = join(unpacked, 'data', 'default-user')
    await mkdir(join(root, 'worlds'), { recursive: true })
    await mkdir(join(root, 'characters'), { recursive: true })
    await mkdir(join(root, 'chats'), { recursive: true })
    await writeFile(join(root, 'settings.json'), '{}')
    // 插件目录也有 settings.json（JS-Slash-Runner/.vscode 抢根历史坑）
    const vscode = join(unpacked, 'plugin', '.vscode')
    await mkdir(vscode, { recursive: true })
    await writeFile(join(vscode, 'settings.json'), '{}')
    expect(await findStDataRoot(unpacked)).toBe(root)
  })
  it('无 settings.json → null', async () => {
    expect(await findStDataRoot(join(base, 'empty-not-exist'))).toBeNull()
  })
})

describe('import-preview: 归属/同名检测（纯函数）', () => {
  const state = {
    workspaces: [
      { dir: dshSlug('rp', 'Seraphina'), characterName: 'Seraphina', books: [{ name: 'Bound Book' }] },
      { dir: 'rp-wuxia-xyz', characterName: '武 侠 女侠', books: [] },
    ],
    presets: [{ id: 'st-fox', displayName: '[主预设] V17.1 示例预设 · 示例角色' }],
    sessions: [],
  }
  it('卡名 → dshSlug 目录命中；characterName 归一化兜底命中', () => {
    expect(findExistingCardSlug('Seraphina', state)).toBe(dshSlug('rp', 'Seraphina'))
    expect(findExistingCardSlug('武侠女侠', state)).toBe('rp-wuxia-xyz')
    expect(findExistingCardSlug('不存在', state)).toBeNull()
  })
  it('书 → 被 rp.json books[].name 归一化绑定的工作区清单', () => {
    expect(findBookBoundBy('bound book', state)).toEqual(['Seraphina'])
    expect(findBookBoundBy('没绑过的书', state)).toEqual([])
  })
  it('loadExistingState：扫 rp/*/rp.json + rp-presets + sessions（容错空目录）', async () => {
    const ws = join(dshHome, 'rp', 'rp-x')
    await mkdir(ws, { recursive: true })
    await writeFile(join(ws, 'rp.json'), JSON.stringify({ characterName: 'X', books: [{ name: 'B' }] }))
    await mkdir(join(dshHome, 'rp', 'not-a-ws'), { recursive: true }) // 无 rp.json → 跳过
    const st = await loadExistingState(dshHome)
    expect(st.workspaces).toEqual([{ dir: 'rp-x', characterName: 'X', books: [{ name: 'B' }] }])
    expect(st.presets).toEqual([])
    expect(st.sessions).toEqual([])
  })
  it('findStDataRoot 兼容面：index.ts re-export 与本模块同一实现', () => {
    expect(findStDataRootViaIndex).toBe(findStDataRoot)
  })
})

describe('import-preview: 预览扫描（临时目录 FS）', () => {
  let unpacked = ''
  let root = ''
  /** 搭一个完整 ST 数据根 + 库内既有状态；返回各类期望值 */
  async function setup(): Promise<{ wsDir: string; seraphinaSlug: string; expectedSid: string }> {
    unpacked = join(base, 'rp-import-b1', 'unpacked')
    root = join(unpacked, 'data', 'default-user')
    await mkdir(join(root, 'characters'), { recursive: true })
    await mkdir(join(root, 'worlds'), { recursive: true })
    await mkdir(join(root, 'chats', 'Seraphina'), { recursive: true })
    await mkdir(join(root, 'chats', '陌路人'), { recursive: true })
    await mkdir(join(root, 'OpenAI Settings'), { recursive: true })
    await mkdir(join(root, 'vectors'), { recursive: true })
    await writeFile(join(root, 'settings.json'), '{}')

    // 卡 1：PNG 卡（真 tEXt chunk），内嵌正则 2 + 内嵌书 3 条 + 备选开场白 2 + EJS
    await writeFile(join(root, 'characters', 'Seraphina.png'),
      writeCardTextChunks(makePlaceholderPng('Seraphina'), cardJson('Seraphina', { regex: 2, bookEntries: 3, greetings: 2, ejs: true })))
    // 卡 2：JSON 卡（无配对 png → avatar=false）
    await writeFile(join(root, 'characters', 'Plain.json'), cardJson('Plain', {}))
    // 书 1：entries 对象映射形态（ST 常见）+ 一条 EJS；书 2：数组形态且已被绑定
    await writeFile(join(root, 'worlds', 'Seraphina World.json'), JSON.stringify({
      entries: {
        '0': { uid: 0, key: ['a'], content: '条目A' },
        '1': { uid: 1, key: ['b'], content: '模板：<%= user %>' },
        '2': { uid: 2, key: ['c'], content: '条目C' },
      },
    }))
    await writeFile(join(root, 'worlds', 'Bound Book.json'), JSON.stringify({ entries: [{ uid: 0 }] }))
    // 聊天：Seraphina 5 条消息；陌路人（对不上卡）2 条
    await writeFile(join(root, 'chats', 'Seraphina', 'chat-1.jsonl'), chatJsonl(5))
    await writeFile(join(root, 'chats', '陌路人', 'chat-2.jsonl'), chatJsonl(2))
    // 预设：displayName + 5 prompts + EJS；.luker-state 文件应被排除
    await writeFile(join(root, 'OpenAI Settings', '[主预设] 示例预设.json'), JSON.stringify({
      name: '[主预设] V17.1 示例预设 · 示例角色',
      prompts: Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, content: i === 0 ? '<% vars %>' : '内容' })),
    }))
    await writeFile(join(root, 'OpenAI Settings', '.luker-state.1.json'), '{}')
    // 丢弃项：vectors + backups
    await writeFile(join(root, 'vectors', 'index.json'), '{}')
    const backups = join(root, 'backups')
    await mkdir(backups, { recursive: true })
    await writeFile(join(backups, 'auto.json'), '{}')

    // 库内既有状态：Seraphina 工作区已存在 + 绑定 Bound Book + 落盘 session
    const seraphinaSlug = dshSlug('rp', 'Seraphina')
    const wsDir = join(dshHome, 'rp', seraphinaSlug)
    await mkdir(wsDir, { recursive: true })
    await writeFile(join(wsDir, 'rp.json'), JSON.stringify({
      characterName: 'Seraphina',
      books: [{ name: 'Bound Book', lorePath: `skills/${dshSlug('wb', 'Bound Book')}/references/lore.json` }],
    }))
    const expectedSid = chatSessionId('Seraphina', 'chat-1.jsonl')
    return { wsDir, seraphinaSlug, expectedSid }
  }

  it('全量扫描：分类计数 / 目标徽章 / 丢弃 / EJS', async () => {
    const { wsDir, seraphinaSlug, expectedSid } = await setup()
    // 已落盘 session：projectKey 用 workspace 目录的 realpath（与运行时一致）
    const { realpath } = await import('node:fs/promises')
    const real = await realpath(wsDir)
    const project = projectKey(real.replaceAll('\\', '/'))
    const sdir = encodeSegment(expectedSid)
    await mkdir(join(dshHome, 'sessions', project, sdir), { recursive: true })
    await writeFile(join(dshHome, 'sessions', project, sdir, 'session.jsonl'),
      JSON.stringify({ type: 'session', version: 0, id: expectedSid, createdAt: 1, cwd: real }) + '\n')

    const p = await scanImportPreview(unpacked, { dshHome })
    expect(p.kind).toBe('st-data')
    expect(p.stRoot).toBe('data/default-user')

    // 卡：PNG 卡同名已存在 → 覆盖徽章 + slug 命中；JSON 卡 → 新工作区 + 无立绘
    expect(p.cards.map(c => c.name).sort()).toEqual(['Plain', 'Seraphina'])
    const seraphina = p.cards.find(c => c.name === 'Seraphina')!
    expect(seraphina.target).toBe('已存在(同名)')
    expect(seraphina.slug).toBe(seraphinaSlug)
    expect(seraphina.avatar).toBe(true)
    expect(seraphina.regexCount).toBe(2)
    expect(seraphina.hasEmbeddedWorldInfo).toBe(true)
    expect(seraphina.alternateGreetings).toBe(2)
    expect(seraphina.ejs).toBe(true)
    const plain = p.cards.find(c => c.name === 'Plain')!
    expect(plain.target).toBe('新工作区')
    expect(plain.avatar).toBe(false)
    expect(plain.slug).toBe(dshSlug('rp', 'Plain'))

    // 书：绑定判定 + EJS 条目计数
    const world = p.books.find(b => b.name === 'Seraphina World')!
    expect(world.target).toBe('新 skill')
    expect(world.entryCount).toBe(3)
    expect(world.ejsEntries).toBe(1)
    const bound = p.books.find(b => b.name === 'Bound Book')!
    expect(bound.target).toBe('已绑定')
    expect(bound.boundBy).toEqual(['Seraphina'])

    // 聊天：消息数（首行 header 不计）、已存在 session 匹配、孤儿标记
    const chat1 = p.chats.find(c => c.name === 'Seraphina/chat-1.jsonl')!
    expect(chat1.messageCount).toBe(5)
    expect(chat1.approx).toBe(false)
    expect(chat1.targetSessionId).toBe(expectedSid)
    expect(chat1.orphan).toBe(false)
    const chat2 = p.chats.find(c => c.name.startsWith('陌路人/'))!
    expect(chat2.messageCount).toBe(2)
    expect(chat2.orphan).toBe(true)
    expect(chat2.targetSessionId).toBeUndefined()

    // 预设：displayName/prompts 数/同名覆盖 + luker 文件被排除
    expect(p.presets).toHaveLength(1)
    expect(p.presets[0].displayName).toBe('[主预设] V17.1 示例预设 · 示例角色')
    expect(p.presets[0].promptCount).toBe(5)
    expect(p.presets[0].ejs).toBe(true)
    expect(p.presets[0].targetPresetId).toBeUndefined()

    // 丢弃：vectors 目录 + backups 目录 + luker 文件（都在清单里、带原因）
    const droppedPaths = p.dropped.map(d => d.path)
    expect(droppedPaths.some(x => x.includes('vectors'))).toBe(true)
    expect(droppedPaths.some(x => x.includes('backups'))).toBe(true)
    expect(droppedPaths.some(x => x.includes('.luker-state'))).toBe(true)
    expect(p.dropped.every(d => d.reason.length > 4)).toBe(true)

    // EJS 计数：预设 1 + 卡 1 + 书条目 1
    expect(p.ejsTemplates).toBe(3)
  })

  it('无 dshHome：全部按「新」处理（同名/绑定/session 匹配关闭）', async () => {
    await setup()
    const p = await scanImportPreview(unpacked)
    expect(p.cards.every(c => c.target === '新工作区')).toBe(true)
    expect(p.books.every(b => b.target === '新 skill')).toBe(true)
    expect(p.chats.every(c => c.targetSessionId === undefined)).toBe(true)
  })

  it('单文件批次（inbox 单卡）：最小预览', async () => {
    const single = join(base, 'rp-import-b2', 'unpacked', 'inbox')
    await mkdir(single, { recursive: true })
    await writeFile(join(single, 'Solo.png'), writeCardTextChunks(makePlaceholderPng('Solo'), cardJson('Solo', { regex: 1 })))
    const p = await scanImportPreview(join(base, 'rp-import-b2', 'unpacked'), { dshHome })
    expect(p.kind).toBe('single-card')
    expect(p.cards).toHaveLength(1)
    expect(p.cards[0].name).toBe('Solo')
    expect(p.cards[0].regexCount).toBe(1)
    expect(p.cards[0].sourceFile).toBe('inbox/Solo.png')
  })
})

describe('import-preview: checkpoint 读写', () => {
  it('sanitizeDoneList：字符串化/去空白/去重/截断', () => {
    expect(sanitizeDoneList([' a ', 'a', 'b', 123, null, ''])).toEqual(['a', 'b', '123'])
    expect(sanitizeDoneList('单个值')).toEqual(['单个值'])
    expect(sanitizeDoneList(undefined)).toEqual([])
    expect(sanitizeDoneList([Array(600).fill('x').map((_, i) => `item-${i}`)])).toHaveLength(1)
    expect(sanitizeDoneList(Array.from({ length: 600 }, (_, i) => `item-${i}`))).toHaveLength(500)
    expect(sanitizeDoneList(['x'.repeat(500)])).toEqual(['x'.repeat(200)])
  })
  it('parseCheckpointFile：合法/坏 JSON/缺字段/未知 stage 过滤', () => {
    const valid = JSON.stringify({
      batchId: 'b1',
      stages: { books: { done: ['书A', '书B'], updatedAt: '2026-01-01T00:00:00Z' }, nonsense: { done: ['x'] } },
      updatedAt: '2026-01-01T00:00:00Z',
    })
    const cp = parseCheckpointFile(valid)!
    expect(cp.batchId).toBe('b1')
    expect(cp.stages.books?.done).toEqual(['书A', '书B'])
    expect((cp.stages as Record<string, unknown>).nonsense).toBeUndefined()
    expect(parseCheckpointFile('{bad json')).toBeNull()
    expect(parseCheckpointFile('{"stages":{}}')).toBeNull() // 缺 batchId
    expect(parseCheckpointFile('{"batchId":"b1"}')).toBeNull() // 缺 stages
    expect(parseCheckpointFile('{"batchId":"b1","stages":{"books":{"done":"不是数组"}}}')!.stages.books).toBeUndefined()
  })
  it('normalizeCheckpointWrite：归并保留其他类目、覆盖本类目、刷新 updatedAt', () => {
    const prev = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: { api: { done: ['import-api-config'], updatedAt: '2026-01-01T00:00:00Z' }, books: { done: ['书A'], updatedAt: '2026-01-01T00:00:01Z' } },
      updatedAt: '2026-01-01T00:00:01Z',
    }))
    const merged = normalizeCheckpointWrite('b1', prev, { stage: 'cards', done: ['rp-seraphina-x'] })
    expect(merged.batchId).toBe('b1')
    expect(merged.stages.api?.done).toEqual(['import-api-config'])
    expect(merged.stages.books?.done).toEqual(['书A'])
    expect(merged.stages.cards?.done).toEqual(['rp-seraphina-x'])
    expect(merged.updatedAt >= '2026-01-01T00:00:01Z').toBe(true)
    // 空既往：全新 checkpoint
    const fresh = normalizeCheckpointWrite('b2', null, { stage: 'chats', done: ['a/x.jsonl'] })
    expect(Object.keys(fresh.stages)).toEqual(['chats'])
  })
  it('summarizeCheckpoint：空/有进度；stage 顺序按契约；hasCheckpoint 语义', () => {
    expect(summarizeCheckpoint(null)).toEqual({ hasCheckpoint: false, stages: [], doneCount: 0, updatedAt: '' })
    const cp = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: {
        misc: { done: ['quick'], updatedAt: 'x' },
        api: { done: ['import-api-config'], updatedAt: 'x' },
        persona: { done: [], updatedAt: 'x' }, // 空 done 不计入
      },
      updatedAt: '2026-01-02T00:00:00Z',
    }))
    const s = summarizeCheckpoint(cp)
    expect(s.hasCheckpoint).toBe(true)
    expect(s.stages).toEqual(['api', 'misc']) // CHECKPOINT_STAGES 顺序
    expect(s.doneCount).toBe(2)
    expect(s.updatedAt).toBe('2026-01-02T00:00:00Z')
    expect(CHECKPOINT_STAGES).toEqual(['api', 'books', 'cards', 'chats', 'presets', 'persona', 'misc'])
  })
})

describe('import-preview: 轻解析工具', () => {
  it('entries 两种形态 / prompts / EJS / 卡名', () => {
    expect(lorebookEntryCount({ entries: { a: {}, b: {} } })).toBe(2)
    expect(lorebookEntryCount({ entries: [{}, {}] })).toBe(2)
    expect(lorebookEntryCount({})).toBe(0)
    expect(stPresetPromptCount({ prompts: [1, 2, 3] })).toBe(3)
    expect(stPresetPromptCount({})).toBe(0)
    expect(isEjsTemplate('a <% x %> b')).toBe(true)
    expect(isEjsTemplate('a < b')).toBe(false)
    expect(isEjsTemplate('<% 未闭合')).toBe(false)
    expect(cardJsonName({ data: { name: ' V2卡 ' } })).toBe('V2卡')
    expect(cardJsonName({ name: 'V1卡' })).toBe('V1卡')
    expect(cardJsonName({})).toBeNull()
    expect(normalizeName('武 侠 女侠')).toBe('武侠女侠')
  })
  it('countChatMessages：首行 header 不计、空行不算', async () => {
    const dir = join(base, 'chat-count')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'c.jsonl')
    await writeFile(file, chatJsonl(4) + '\n') // 末尾多一个空行
    const { count, approx } = await countChatMessages(file)
    expect(count).toBe(4)
    expect(approx).toBe(false)
  })
})

describe('import-preview: §4.16.1 进度模型（done 解析/计数/totals/批次汇总）', () => {
  it('parseDoneEntry：claim 前缀 / 类目前缀 / 裸标识三种形态都认', () => {
    expect(parseDoneEntry('claim:chats:陌路人/chat-2.jsonl')).toEqual({ stage: 'chats', ident: '陌路人/chat-2.jsonl', claim: true })
    expect(parseDoneEntry('claim:不知道是什么')).toEqual({ stage: null, ident: '不知道是什么', claim: true }) // 无类目前缀的 claim → 归属写入桶
    expect(parseDoneEntry('books:书A')).toEqual({ stage: 'books', ident: '书A', claim: false })
    expect(parseDoneEntry('cards')).toEqual({ stage: 'cards', ident: '', claim: false }) // 裸类目名 = 整类目一项
    expect(parseDoneEntry('rp-seraphina-x')).toEqual({ stage: null, ident: 'rp-seraphina-x', claim: false })
  })
  it('countDoneByStage：逐类目计数（跨桶前缀归并）+ claim 收集（claim 也计入 done）', () => {
    const cp = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: {
        books: { done: ['书A', 'books:书B'], updatedAt: '2026-01-01T00:01:00Z' },
        chats: { done: ['claim:chats:陌路人/x.jsonl', 'Seraphina/chat-1.jsonl'], updatedAt: '2026-01-01T00:02:00Z' },
      },
      updatedAt: '2026-01-01T00:02:00Z',
    }))
    const { counts, claims } = countDoneByStage(cp)
    expect(counts).toEqual({ api: 0, books: 2, cards: 0, chats: 2, presets: 0, persona: 0, misc: 0 })
    expect(claims).toEqual([{ kind: 'chat', name: '陌路人/x.jsonl', detail: claimHint('chat', '陌路人/x.jsonl') }])
    expect(countDoneByStage(null).counts.misc).toBe(0)
  })
  it('progressTotalsFromManifest：st-data 三固定类目计 1；单文件只涉及其一类；非法计数按 0', () => {
    expect(progressTotalsFromManifest({ kind: 'st-data', cards: 2, books: 3, chats: 4, presets: 5 }))
      .toEqual({ api: 1, books: 3, cards: 2, chats: 4, presets: 5, persona: 1, misc: 1 })
    expect(progressTotalsFromManifest({ kind: 'single-card' }))
      .toEqual({ api: 0, books: 0, cards: 1, chats: 0, presets: 0, persona: 0, misc: 0 })
    expect(progressTotalsFromManifest({ kind: 'single-book' }).books).toBe(1)
    expect(progressTotalsFromManifest(null).cards).toBe(0)
    expect(progressTotalsFromManifest({ kind: 'st-data', cards: '不是数字' }).cards).toBe(0)
  })
  it('buildBatchProgress：类目/overall/当前 stage/uncertain/claims 去重/eta 外推', () => {
    const T0 = Date.parse('2026-01-01T00:00:00Z')
    const iso = (ms: number): string => new Date(ms).toISOString()
    const meta = {
      stagedAt: iso(T0),
      manifest: { kind: 'st-data', cards: 1, books: 2, chats: 1, presets: 1 },
      kickoff: { sessionId: 's1' },
    }
    const cp = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: {
        // books: 1/2 完成（10 分钟/项的类目速率）；chats: claim 一项（1/1 完成）
        books: { done: ['books:书A'], updatedAt: iso(T0 + 10 * 60_000), startedAt: iso(T0) },
        chats: { done: ['claim:chats:陌路人/x.jsonl'], updatedAt: iso(T0 + 10 * 60_000), startedAt: iso(T0) },
      },
      updatedAt: iso(T0 + 10 * 60_000),
    }))
    const pg = buildBatchProgress(meta, cp, [{ kind: 'chat', name: '陌路人/x.jsonl', detail: '预览来源' }])
    expect(pg.kind).toBe('st-data')
    expect(pg.stage).toBe('api') // 适用类目里第一个未完成的（api total=1 done=0）
    expect(pg.categories.find(c => c.name === 'books')).toEqual({ name: 'books', total: 2, done: 1, ratio: 0.5 })
    // total = api1 + books2 + cards1 + chats1 + presets1 + persona1 + misc1 = 8
    expect(pg.overall).toEqual({ total: 8, done: 2, ratio: 2 / 8 })
    expect(pg.uncertain).toBe(false)
    // eta：剩 api/cards/presets/persona/misc 各 1 项（全局速率 10min/2 项 = 5min/项 → 25min）
    // + books 剩 1 项（类目速率 10min/项）= 35 分钟
    expect(pg.etaMinutes).toBe(35)
    // claims 去重：预览来源与 agent claim 标记撞同一项 → 只留一条（预览来源先到先得）
    expect(pg.claims).toEqual([{ kind: 'chat', name: '陌路人/x.jsonl', detail: '预览来源' }])
  })
  it('buildBatchProgress：无 checkpoint → 已开工 uncertain / 未开工 pending；eta null', () => {
    const meta = {
      stagedAt: '2026-01-01T00:00:00Z',
      manifest: { kind: 'st-data', cards: 0, books: 0, chats: 0, presets: 0 },
      kickoff: { sessionId: 's1' },
    }
    const pg = buildBatchProgress(meta, null)
    expect(pg.uncertain).toBe(true) // 已开工但 agent 没回写过任何 done——诚实标注
    expect(pg.etaMinutes).toBeNull()
    expect(pg.overall.done).toBe(0)
    expect(pg.stage).toBe('api') // manifest 计数在（api/persona/misc 恒 1）
    const pg2 = buildBatchProgress({ stagedAt: '2026-01-01T00:00:00Z', manifest: { kind: 'unknown' } }, null)
    expect(pg2.stage).toBe('pending') // 无适用类目
    expect(pg2.uncertain).toBe(false)
  })
})

describe('import-preview: §4.16.1 预估剩余时间（startedAt 类目速率外推）', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z')
  const iso = (ms: number): string => new Date(ms).toISOString()
  const totals = { api: 0, books: 2, cards: 0, chats: 0, presets: 0, persona: 0, misc: 0 }
  it('normalizeCheckpointWrite：startedAt 首现补、续写保留（外推的类目开工时刻）', () => {
    const first = normalizeCheckpointWrite('b1', null, { stage: 'books', done: ['书A'] })
    expect(typeof first.stages.books?.startedAt).toBe('string')
    // 续写：手动把 startedAt 拨回过去，再次归并应保留原值（而不是刷新成 now）
    const older = JSON.parse(JSON.stringify(first)) as NonNullable<typeof first>
    older.stages.books!.startedAt = iso(T0)
    const merged = normalizeCheckpointWrite('b1', older, { stage: 'books', done: ['书A', '书B'] })
    expect(merged.stages.books?.startedAt).toBe(iso(T0))
    // 旧 checkpoint 无 startedAt → parse 后缺省，写入时补新值
    const legacy = parseCheckpointFile(JSON.stringify({
      batchId: 'b1', stages: { books: { done: ['x'], updatedAt: iso(T0 + 60_000) } }, updatedAt: iso(T0 + 60_000),
    }))
    expect(legacy?.stages.books?.startedAt).toBeUndefined()
    const patched = normalizeCheckpointWrite('b1', legacy, { stage: 'books', done: ['x', 'y'] })
    expect(typeof patched.stages.books?.startedAt).toBe('string')
  })
  it('类目速率（startedAt→updatedAt）优先：books 10min/项 × 剩 1 项 = 10 分钟', () => {
    const cp = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: { books: { done: ['书A'], updatedAt: iso(T0 + 11 * 60_000), startedAt: iso(T0 + 1 * 60_000) } },
      updatedAt: iso(T0 + 11 * 60_000),
    }))
    expect(estimateRemainingMinutes(totals, countDoneByStage(cp).counts, cp, T0)).toBe(10)
  })
  it('旧 checkpoint 无 startedAt：类目起点退 meta.stagedAt（stagedAt→updatedAt = 11min/项）', () => {
    const legacy = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: { books: { done: ['书A'], updatedAt: iso(T0 + 11 * 60_000) } },
      updatedAt: iso(T0 + 11 * 60_000),
    }))
    expect(estimateRemainingMinutes(totals, countDoneByStage(legacy).counts, legacy, T0)).toBe(11)
  })
  it('全部完成 → 0；无 checkpoint / 时间戳无效 / stagedAt 非法 → null（前端显示「—」不编数字）', () => {
    const cp = parseCheckpointFile(JSON.stringify({
      batchId: 'b1',
      stages: { books: { done: ['书A'], updatedAt: iso(T0 + 11 * 60_000), startedAt: iso(T0 + 1 * 60_000) } },
      updatedAt: iso(T0 + 11 * 60_000),
    }))
    expect(estimateRemainingMinutes({ ...totals, books: 1 }, countDoneByStage(cp).counts, cp, T0)).toBe(0)
    expect(estimateRemainingMinutes(totals, countDoneByStage(cp).counts, null, T0)).toBeNull()
    const noTs = parseCheckpointFile(JSON.stringify({
      batchId: 'b1', stages: { books: { done: ['x'], updatedAt: '垃圾' } }, updatedAt: '',
    }))
    expect(estimateRemainingMinutes(totals, countDoneByStage(noTs).counts, noTs, T0)).toBeNull()
    expect(estimateRemainingMinutes(totals, countDoneByStage(cp).counts, cp, NaN)).toBeNull()
  })
})

describe('import-preview: §4.16.1 待认领（claim 文案 + 预览收集）', () => {
  it('claimHint：三类指引各有一句明确的「下一步」', () => {
    expect(claimHint('chat', '陌路人/x.jsonl')).toContain('「角色」tab')
    expect(claimHint('card', 'Seraphina')).toContain('版本')
    expect(claimHint('checkpoint', '杂项')).toContain('migration-report.md')
  })
  it('collectPreviewClaims：孤儿聊天 + 同名卡 zip 版本更新（临时 FS 真实比对）', async () => {
    const unpacked = join(base, 'rp-import-claims', 'unpacked')
    const root = join(unpacked, 'data', 'default-user')
    await mkdir(join(root, 'characters'), { recursive: true })
    await mkdir(join(root, 'chats', '陌路人'), { recursive: true })
    await writeFile(join(root, 'settings.json'), '{}') // stRoot 定位标志（没有它 chats/cards 都不扫）
    await writeFile(join(root, 'chats', '陌路人', 'chat-2.jsonl'), chatJsonl(2))
    await writeFile(join(root, 'characters', 'Seraphina.json'), cardJson('Seraphina', {}))
    await writeFile(join(root, 'characters', 'Plain.json'), cardJson('Plain', {}))
    // 库内同名卡内容不同 → zip 为更新版本 → 待认领；Plain 是新工作区 → 不涉及
    const wsDir = join(dshHome, 'rp', dshSlug('rp', 'Seraphina'))
    await mkdir(wsDir, { recursive: true })
    await writeFile(join(wsDir, 'rp.json'), JSON.stringify({ characterName: 'Seraphina' })) // 同名判定登记
    await writeFile(join(wsDir, 'card.json'), JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Seraphina', description: '库内旧版' } }))
    const preview = await scanImportPreview(unpacked, { dshHome })
    const claims = await collectPreviewClaims(dshHome, unpacked, preview)
    expect(claims.map(c => `${c.kind}/${c.name}`)).toEqual(['chat/陌路人/chat-2.jsonl', 'card/Seraphina'])
    // 库内与 zip 内容完全一致 → 不算版本更新，只剩孤儿聊天一条
    await writeFile(join(wsDir, 'card.json'), await readFile(join(root, 'characters', 'Seraphina.json'), 'utf8'))
    const claims2 = await collectPreviewClaims(dshHome, unpacked, preview)
    expect(claims2.map(c => c.kind)).toEqual(['chat'])
  })
})
