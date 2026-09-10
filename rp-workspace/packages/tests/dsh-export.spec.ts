import { describe, expect, it } from 'vitest'
import {
  chatSessionId, convertChatFile, dshSlug, encodeSegment, projectKey,
  cardPromptPersona, exportLoreBookSkill, exportSingleCardFiles, exportToDshFiles, sessionFilePath,
  assertSessionLogEvents,
} from '../src/import/dsh-export.ts'
import { collectVariantGroups } from '../src/dsh-plugin/index.ts'
import type { CharacterCard } from '../src/import/character-card.ts'
import type { LoreBook } from '../src/lore/entry.ts'

const book: LoreBook = {
  name: '示例游戏 世界书',
  entries: [
    { id: 0, comment: '今州城', content: '今州城的设定…', keys: ['今州城'], secondaryKeys: [], constant: false, position: 0, depth: 4, order: 0, enabled: true, excludeRecursion: false, preventRecursion: false, probability: 100 },
    { id: 1, comment: '常驻规则', content: '规则', keys: [], secondaryKeys: [], constant: true, position: 1, depth: 4, order: 1, enabled: true, excludeRecursion: false, preventRecursion: false, probability: 100 },
  ],
  importWarnings: [],
} as unknown as LoreBook

const card: CharacterCard = {
  spec: 'chara_card_v2', name: 'Seraphina', description: '一位精灵法师', personality: '温柔',
  scenario: '魔法学院', firstMes: '你好，旅行者。', alternateGreetings: ['另一个开场'],
  systemPrompt: '', postHistoryInstructions: '', tags: ['fantasy'], creator: 'Luker',
  embeddedBook: null, embeddedRegex: [], depthPrompt: null, externalWorldRef: '示例游戏 世界书',
  importWarnings: [],
} as unknown as CharacterCard

describe('dsh-export: slug 与路径安全', () => {
  it('dshSlug 产出 DSH 要求的 [a-z0-9][a-z0-9-]* 且稳定', () => {
    expect(dshSlug('wb', '示例游戏 世界书')).toMatch(/^wb-[a-z0-9-]+$/)
    expect(dshSlug('wb', '示例游戏 世界书')).toBe(dshSlug('wb', '示例游戏 世界书'))
    expect(dshSlug('rp', 'Seraphina')).toMatch(/^rp-seraphina-/)
  })
  it('encodeSegment 转义非法字符（对照 DSH format.spec 契约）', () => {
    expect(encodeSegment('..')).toBe('~002E~002E')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('plain-ID_1.2')).toBe('plain-ID_1.2')
    expect(encodeSegment('a~b')).toBe('a~007Eb')
  })
  it('projectKey 对照 DSH format.spec 契约（分隔符折叠/点号保留/去前导/--包裹）', () => {
    expect(projectKey('C:\\work\\demo')).toBe('--C-work-demo--')
    // DSH 契约：. 属于安全字符直通，/ 与 \ 折叠为 -
    expect(projectKey('/data/data/com.dshtavern.app/files/.dsh/rp')).toBe('--data-data-com.dshtavern.app-files-.dsh-rp--')
  })
  it('sessionFilePath 按 cwd 分组（带 cwd 走 projectKey，无 cwd 走 _no-cwd）', () => {
    const sid = chatSessionId('Seraphina', 'chat-2024.jsonl')
    expect(sid).toMatch(/^st-[a-z0-9]+$/)
    expect(sessionFilePath(sid, '/data/data/com.dshtavern.app/files/.dsh/rp'))
      .toBe(`sessions/--data-data-com.dshtavern.app-files-.dsh-rp--/${sid}/session.jsonl`)
    expect(sessionFilePath(sid, undefined)).toBe(`sessions/_no-cwd/${sid}/session.jsonl`)
  })
})

describe('dsh-export: 世界书 → skill', () => {
  it('产出 SKILL.md（frontmatter 契约）+ references/lore.json', () => {
    const files = exportLoreBookSkill(book)
    const skill = files.find(f => f.path.endsWith('SKILL.md'))!
    const lore = files.find(f => f.path.endsWith('references/lore.json'))!
    expect(files).toHaveLength(2)
    expect(skill.content).toMatch(/^---\nname: wb-[a-z0-9-]+\ndescription: .+\nwhenToUse: .+\n---/)
    expect(skill.content).toContain('示例游戏 世界书')
    expect(skill.content).toContain('常驻规则')
    expect(() => JSON.parse(lore.content)).not.toThrow()
    expect(JSON.parse(lore.content).entries).toHaveLength(2)
    expect(skill.path).toMatch(/^skills\/wb-[^/]+\/SKILL\.md$/)
  })
})

describe('dsh-export: 角色卡 → promptPersona（第四轮：取代 .agent-presets/rp-*）', () => {
  it('promptPersona 含卡设定各分节与行为准则；宏原样保留（运行期宏引擎负责展开）', () => {
    const text = cardPromptPersona(card)
    expect(text).toContain('你正在进行角色扮演')
    expect(text).toContain('# 角色设定\n一位精灵法师')
    expect(text).toContain('# 性格\n温柔')
    expect(text).toContain('# 场景\n魔法学院')
    expect(text).toContain('# 开场白（对话从这里开始）')
    expect(text).toContain('《示例游戏 世界书》')
    expect(text).toContain('Seraphina')
  })

  it('宏不再中性化：{{setvar::…}} 等原样保留（运行期由 dsht-rp 宏引擎展开，防爆 turn 由快照通道天然规避）', () => {
    const macroCard = {
      ...card,
      description: '精灵法师 {{setvar::think1::}}，见过 {{user}}',
    } as unknown as CharacterCard
    const text = cardPromptPersona(macroCard)
    expect(text).toContain('{{setvar::think1::}}') // 原样保留（运行期真语义）
    expect(text).toContain('{{user}}')
  })
})

describe('dsh-export: 单卡导入路径（T1.15：preset + rp.json + 内嵌书 skill + README）', () => {
  it('内嵌书卡 → 四类产物齐备，rp.json 含输出协议三组件配置', () => {
    const embeddedCard = { ...card, embeddedBook: book } as unknown as CharacterCard
    const files = exportSingleCardFiles(embeddedCard)
    const paths = files.map(f => f.path)

    // 布局：内嵌书 skill + 工作区 rp.json + README（第四轮起不再产出 .agent-presets/rp-*）
    expect(paths.some(p => p.startsWith('.agent-presets/rp-'))).toBe(false)
    expect(paths.some(p => /^skills\/wb-[^/]+\/SKILL\.md$/.test(p))).toBe(true)
    expect(paths.some(p => /^skills\/wb-[^/]+\/references\/lore\.json$/.test(p))).toBe(true)
    const rpJsonFile = files.find(f => f.path.endsWith('/rp.json'))!
    expect(paths.some(p => p.endsWith('/README.md'))).toBe(true)

    // rp.json 契约：角色名 / 内嵌书登记 / firstMes / 输出协议（action/wrap/status 三组件）
    const rp = JSON.parse(rpJsonFile.content)
    expect(rp.schemaVersion).toBe(1)
    expect(rp.characterName).toBe('Seraphina')
    expect(rp.books).toHaveLength(1)
    expect(rp.books[0].name).toBe('Seraphina·内嵌书')
    expect(rp.books[0].lorePath).toMatch(/^skills\/wb-[^/]+\/references\/lore\.json$/)
    expect(rp.firstMes).toBe('你好，旅行者。')
    expect(rp.outputProtocol.actionTags).toEqual(['a', 'selection'])
    expect(rp.outputProtocol.wrapTags).toEqual(['content'])
    expect(rp.outputProtocol.statusTags).toEqual(['status', 'statusbar', 'StatusBlock'])

    // rp.json 承载卡设定（promptPersona）；README 提到内嵌书
    const slug = dshSlug('rp', 'Seraphina')
    expect(typeof rp.promptPersona).toBe('string')
    expect(rp.promptPersona).toContain('一位精灵法师')
    expect(rpJsonFile.path).toBe(`rp/${slug}/rp.json`)
    const readme = files.find(f => f.path.endsWith('/README.md'))!
    expect(readme.content).toContain('Seraphina·内嵌书')
  })

  it('无内嵌书卡 → 无 skill 文件，books 为空数组', () => {
    const files = exportSingleCardFiles(card)
    expect(files.filter(f => f.path.startsWith('skills/'))).toHaveLength(0)
    const rp = JSON.parse(files.find(f => f.path.endsWith('/rp.json'))!.content)
    expect(rp.books).toEqual([])
  })

  // ---- T2.9：角色卡导入必然产出带开场白的 session ----
  it('firstMes 非空卡（无备选开场白）→ 产出开场白 session.jsonl（首条 assistant 消息 = firstMes）', () => {
    const files = exportSingleCardFiles({ ...card, alternateGreetings: [] } as unknown as CharacterCard)
    const ses = files.find(f => f.path.endsWith('/session.jsonl'))!
    expect(ses).toBeDefined()
    const lines = ses.content.trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    // header 契约
    expect(lines[0]).toMatchObject({ type: 'session', version: 0, delegationDepth: 0 })
    expect(String(lines[0].cwd)).toContain(dshSlug('rp', 'Seraphina'))
    // oneTurnLog 事件序列：turn/start → step/start → assistant/message(append) → step/end → turn/end
    expect(lines.slice(1).map(l => l.type)).toEqual([
      'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end',
    ])
    const msg = lines[3].data as { message: { role: string; content: Array<{ type: string; text: string }> } }
    expect(msg.message.role).toBe('assistant')
    expect(msg.message.content[0].text).toBe('你好，旅行者。')
    expect(lines[3].surfaceOp).toBe('append')
    // 路径落在该工作区的 projectKey 分组
    expect(ses.path.startsWith(`sessions/${projectKey(String(lines[0].cwd))}/`)).toBe(true)
  })

  // ---- T7a：alternateGreetings 作为 swipe 变体组写进开场白 session ----
  it('多开场白卡 → 变体组（user 标记移出旧变体 + append 新变体），seq 连续、active=firstMes', () => {
    // 【阶段3 2026-09-10 契约修正】原断言是「修复前的错误契约」：assistant/message 依次
    // 做 replace 节点 + 带 sourceEventSeqs 血缘——0.1.2 合法，0.1.5 被官方双重禁止
    // （带 ses 抛 "embeds its source stream"、不带抛 "missing shadowed node"，官方设计死锁）。
    // 新契约：user/message 标记（合法 replace）移出旧变体 + 新变体做 assistant append。
    const multi = { ...card, alternateGreetings: ['另一个开场', '第三个开场'] } as unknown as CharacterCard
    const files = exportSingleCardFiles(multi)
    const ses = files.find(f => f.path.endsWith('/session.jsonl'))!
    const lines = ses.content.trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    const events = lines.slice(1)
    expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i))
    const msgs = events.filter(e => e.type === 'assistant/message')
    expect(msgs).toHaveLength(4)
    // 变体必须是 append（0.1.5 禁止 assistant 做 replace 节点）
    for (const m of msgs) expect(m.surfaceOp).toBe('append')
    // 旧变体的移出改由紧随其前的 user/message 标记 + compaction/prune 承担
    const markers = events.filter(e => e.type === 'user/message')
    expect(markers.length).toBeGreaterThanOrEqual(2)
    for (const m of markers) {
      expect(m.surfaceOp).toMatchObject({ op: 'replace' })
      expect(m.sourceEventSeqs).toHaveLength(1)
    }
    // compaction/prune 必须紧邻其后的 replace（影子化协议铁律）
    for (let i = 0; i < events.length; i++) {
      if (events[i].type !== 'compaction/prune') continue
      expect(events[i + 1]?.type).toBe('user/message')
      expect(events[i + 1]?.surfaceOp).toMatchObject({ op: 'replace' })
    }
    // 回切：active 换回 firstMes（ST 默认 swipe_id 0）
    const textOf = (e: Record<string, unknown>) =>
      ((e.data as { message: { content: Array<{ text: string }> } }).message.content[0].text)
    expect(textOf(msgs[0])).toBe('你好，旅行者。')
    expect(textOf(msgs[1])).toBe('另一个开场')
    expect(textOf(msgs[2])).toBe('第三个开场')
    expect(textOf(msgs[3])).toBe('你好，旅行者。')
    // 组重建：4 个变体全文入组，active 指向链尾
    const groups = collectVariantGroups(events as never[])
    const g = groups.get(Number(msgs[0].seq))!
    expect(g.members.map(m => m.text)).toEqual(['你好，旅行者。', '另一个开场', '第三个开场', '你好，旅行者。'])
    expect(g.activeSeq).toBe(Number(msgs[3].seq))
    // 空/重复备选不收
    const dup = { ...card, alternateGreetings: ['你好，旅行者。', '  '] } as unknown as CharacterCard
    const ses2 = exportSingleCardFiles(dup).find(f => f.path.endsWith('/session.jsonl'))!
    const msgs2 = ses2.content.trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
      .filter(e => e.type === 'assistant/message')
    expect(msgs2).toHaveLength(1)
  })

  it('firstMes 为空卡 → 无 session 产物（buildFirstMesSession 返回 null）', () => {
    const bare = { ...card, firstMes: '' } as unknown as CharacterCard
    expect(exportSingleCardFiles(bare).some(f => f.path.endsWith('/session.jsonl'))).toBe(false)
  })
})

describe('dsh-export: 聊天 → session.jsonl（oneTurnLog 事件契约）', () => {
  const sid = chatSessionId('Seraphina', 'test.jsonl')
  const mk = (rows: Array<{ is_user: boolean; mes: string; is_system?: boolean; send_date?: string }>) =>
    rows.map(r => JSON.stringify({ name: r.is_user ? 'User' : 'Seraphina', ...r })).join('\n')

  it('标准 user→assistant 一轮 = oneTurnLog 序列', () => {
    const conv = convertChatFile(mk([
      { is_user: true, mes: '你好', send_date: 'August 19, 2025 11:23pm' },
      { is_user: false, mes: '你好，旅行者。' },
    ]), { sessionId: sid, createdAt: 1700000000000, cwd: '/data/data/com.dshtavern.app/files/.dsh/rp' })

    const lines = conv.content.trimEnd().split('\n')
    const header = JSON.parse(lines[0])
    expect(header).toMatchObject({ type: 'session', version: 0, id: sid, delegationDepth: 0, cwd: '/data/data/com.dshtavern.app/files/.dsh/rp' })
    expect(header.createdAt).toBe(1700000000000)

    const events = lines.slice(1).map(l => JSON.parse(l))
    // 【阶段3 2026-09-10 契约修正】user/message 也必须落在打开的 step 内——
    // 0.1.5 v2→v3 迁移器（dsh-session-format-v2-to-v3/lib/index.js:733）对
    // 「首个 step 之前的 surface 事件」直接抛 `cannot acquire a system head
    // without changing chronology`。故 user 楼层也各自包一个 step（复刻真实 DSH 形态）。
    expect(events.map(e => e.type)).toEqual([
      'turn/start',
      'step/start', 'user/message', 'step/end',
      'step/start', 'assistant/message', 'step/end',
      'turn/end',
    ])
    // seq 从 0 连续
    expect(events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // 表面事件必须带 surfaceOp（契约：guard 拒绝缺失）
    expect(events[2].surfaceOp).toBe('append')
    expect(events[5].surfaceOp).toBe('append')
    expect(events[0].surfaceOp).toBeUndefined()
    // user/message data = Message
    expect(events[2].data).toMatchObject({ role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } })
    // assistant/message data = { turn, step, message }（source.model 契约）
    expect(events[5].data.message).toMatchObject({
      role: 'assistant', content: [{ type: 'text', text: '你好，旅行者。' }],
      source: { kind: 'model', provider: 'sillytavern-import' },
    })
    // turn/end completed
    expect(events[7].data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    expect(conv.turns).toBe(1)
    expect(conv.firstUserText).toBe('你好')
  })

  it('assistant 开场白文件：虚拟 turn 包裹；系统行跳过', () => {
    const conv = convertChatFile(mk([
      { is_user: false, mes: '欢迎来到魔法学院。' },
      { is_user: true, mes: '（我推开门）' },
      { is_user: false, mes: '她抬起头。', is_system: false },
    ]), { sessionId: sid, createdAt: 1700000000000 })
    const events = conv.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l))
    // turn1 = 开场白（无 user），turn2 = user + assistant
    expect(events.filter(e => e.type === 'turn/start')).toHaveLength(2)
    expect(conv.turns).toBe(2)
    expect(conv.skipped).toBe(0)
  })

  it('连续 assistant / 连续 user 都能合法闭合', () => {
    const conv = convertChatFile(mk([
      { is_user: true, mes: '第一句' },
      { is_user: false, mes: '回复一' },
      { is_user: false, mes: '补充二' },
      { is_user: true, mes: '第二问' },
      { is_user: true, mes: '再问' },
    ]), { sessionId: sid, createdAt: 1700000000000 })
    const events = conv.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l))
    const seqs = events.map(e => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    // 每个 turn 都有 turn/end（尾部闭合）
    const starts = events.filter(e => e.type === 'turn/start').length
    const ends = events.filter(e => e.type === 'turn/end').length
    expect(starts).toBe(ends)
    expect(conv.turns).toBe(starts)
  })

  it('swipes → 变体组：replace 链互替，surface 只剩 active（§4.15 契约）', () => {
    const rows = [
      { is_user: true, mes: '你好' },
      {
        is_user: false, mes: '版本B', swipes: ['版本A', '版本B', '版本C'], swipe_id: 1,
      },
    ]
    const conv = convertChatFile(
      rows.map(r => JSON.stringify(r)).join('\n'),
      { sessionId: sid, createdAt: 1700000000000 },
    )
    const events = conv.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l))
    const asst = events.filter(e => e.type === 'assistant/message')
    expect(conv.variantGroups).toBe(1)

    // 【阶段3 2026-09-10 契约修正】原断言是「修复前的错误契约」：变体依次用
    // assistant/message 做 replace 节点 + 带 sourceEventSeqs 血缘——0.1.5 被官方
    // 双重禁止（带 ses 抛 "embeds its source stream"、不带抛 "missing shadowed node"）。
    // 新契约：四个变体全部 append；旧变体由紧随其前的 user/message 标记（合法 replace）移出。
    expect(asst).toHaveLength(4)
    for (const a of asst) expect(a.surfaceOp).toBe('append')
    expect(asst[0].data.message.content[0].text).toBe('版本A')
    expect(asst[1].data.message.content[0].text).toBe('版本B')
    expect(asst[3].data.message.content[0].text).toBe('版本B')

    // 每个变体切换前都有一个 user 标记（replace 掉上一变体）+ 紧邻的 compaction/prune
    // （distinct from 原始用户消息——它 surfaceOp='append'）
    const markers = events.filter(e => e.type === 'user/message' && e.surfaceOp !== 'append')
    expect(markers).toHaveLength(3)
    for (const m of markers) {
      expect(m.surfaceOp).toMatchObject({ op: 'replace' })
      expect(m.sourceEventSeqs).toHaveLength(1)
      const secs = (m.data as { source?: { sections?: Array<{ name: string }> } }).source?.sections
      expect(secs?.[0]?.name).toBe('dsht:surgical')
    }
    // compaction/prune 必须紧邻其后的 replace（影子化协议铁律）
    for (let i = 0; i < events.length; i++) {
      if (events[i].type !== 'compaction/prune') continue
      expect(events[i + 1]?.type).toBe('user/message')
      expect(events[i + 1]?.surfaceOp).toMatchObject({ op: 'replace' })
    }

    // surface 投影验证：重放 surfaceOp 后 active 是"版本B"（asst[3]）
    const surface: number[] = []
    for (const e of events) {
      if (e.surfaceOp === undefined) continue
      if (e.surfaceOp === 'append') surface.push(e.seq)
      else {
        const s = surface.indexOf(e.surfaceOp.start), t = surface.indexOf(e.surfaceOp.end)
        surface.splice(s, t - s + 1, e.seq)
      }
    }
    // surface = [user, 标记, active变体]（新形态多一条标记节点）
    expect(surface[0]).toBe(events.find(e => e.type === 'user/message')!.seq)
    expect(surface[surface.length - 1]).toBe(asst[3].seq)
    // 变体组重建：4 个变体全文可切，active 指向链尾
    const groups = collectVariantGroups(events as never[])
    const g = groups.get(Number(asst[0].seq))!
    expect(g.members.map(m => m.text)).toEqual(['版本A', '版本B', '版本C', '版本B'])
    expect(g.activeSeq).toBe(Number(asst[3].seq))
  })

  it('swipes active 在末位：无追加切换事件', () => {
    const rows = [
      { is_user: true, mes: '你好' },
      { is_user: false, mes: '终版', swipes: ['初版', '终版'], swipe_id: 1 },
    ]
    const conv = convertChatFile(
      rows.map(r => JSON.stringify(r)).join('\n'),
      { sessionId: sid, createdAt: 1700000000000 },
    )
    const events = conv.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l))
    const asst = events.filter(e => e.type === 'assistant/message')
    expect(asst).toHaveLength(2)
    expect(asst[1].data.message.content[0].text).toBe('终版')
  })

  it('全系统行/坏行：只剩 header，skipped 计数（显式 skip 严格语义）', () => {
    const conv = convertChatFile(
      '{bad json}\n' + mk([{ is_user: true, mes: '注释', is_system: true }]),
      { sessionId: sid, createdAt: 1700000000000, systemHandling: 'skip' },
    )
    const lines = conv.content.trimEnd().split('\n')
    expect(lines).toHaveLength(1) // 仅 header
    expect(conv.turns).toBe(0)
    expect(conv.skipped).toBe(2)
  })

  it('auto 判据：is_user 与 is_system 同真（tauritavern 实测形态）→ 不信任 is_system、按 is_user 保留', () => {
    const conv = convertChatFile(
      mk([
        { is_user: false, mes: '开场白', is_system: true },
        { is_user: true, mes: '用户输入', is_system: true }, // 用户输入标 system = 标记被重载
        { is_user: false, mes: '角色回复', is_system: true },
      ]),
      { sessionId: sid, createdAt: 1700000000000 },
    )
    expect(conv.turns).toBe(2)
    expect(conv.skipped).toBe(0)
    expect(conv.content).toContain('用户输入')
  })

  // ---- T2.9：会话导入全量保留（用户定案：上千 turn 也全部留下，绝不只留最后几轮）----
  it('1200 turn 长聊天全量转换：事件数与输入严格成比例，零丢弃', () => {
    const rows: Array<{ is_user: boolean; mes: string }> = []
    for (let i = 0; i < 1200; i++) {
      rows.push({ is_user: i % 2 === 0, mes: `消息 ${i}` })
    }
    const conv = convertChatFile(mk(rows), { sessionId: sid, createdAt: 1700000000000 })
    const lines = conv.content.trimEnd().split('\n')
    // 【阶段3 2026-09-10 契约修正】user 楼层也各自包 step（0.1.5 要求 surface 事件
    // 必须落在打开的 step 内）。
    // 1200 行消息 → 1 header + 600 user 表面事件 + 600 user step/start + 600 user step/end
    //              + 600 assistant 表面事件 + 600 assistant step/start + 600 assistant step/end
    //              + 600 turn/start + 600 turn/end
    expect(lines).toHaveLength(1 + 1200 + 1200 + 1200 + 1200)
    expect(conv.turns).toBe(600)
    expect(conv.skipped).toBe(0)
    // 首尾消息都在（无截断）
    expect(conv.content).toContain('消息 0')
    expect(conv.content).toContain('消息 1199')
    // 首条 = header，line[1] = turn/start，line[2] = step/start，line[3] = user/message
    const firstUser = (JSON.parse(lines[3]) as { data: { content: Array<{ text: string }> } }).data.content[0].text
    expect(firstUser).toBe('消息 0')
  })
})

describe('dsh-export: 一卡一工作区布局（§4.14 用户定案）', () => {
  it('对得上卡的聊天挂卡工作区、孤儿挂 _orphan，各工作区有 README', async () => {
    const dshHome = '/data/data/com.dshtavern.app/files/.dsh'
    const seraphinaChat = JSON.stringify({ user_name: 'User', create_date: 'August 19, 2025 10:00pm' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '你好' }) + '\n'
      + JSON.stringify({ name: 'Seraphina', is_user: false, mes: 'v1', swipes: ['v1', 'v2'], swipe_id: 1 })
    const orphanChat = JSON.stringify({ user_name: 'User' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '无主聊天' })
    const imp = {
      zip: {
        files: {
          'data/default-user/chats/Seraphina/a.jsonl': { async: async () => seraphinaChat },
          'data/default-user/chats/某人/b.jsonl': { async: async () => orphanChat },
        } as Record<string, { async(t: 'string'): Promise<string> }>,
      },
      worlds: new Map(),
      characters: [card],
      chatFiles: [
        { path: 'data/default-user/chats/Seraphina/a.jsonl', ownerDir: 'Seraphina' },
        { path: 'data/default-user/chats/某人/b.jsonl', ownerDir: '某人' },
      ],
    }

    const written: Array<{ path: string; content: string }> = []
    const result = await exportToDshFiles(imp, async (files) => {
      written.push(...files)
    }, { worlds: false, cards: false, chats: true }, dshHome)

    expect(result.sessions).toBe(2)

    const cardSlug = dshSlug('rp', 'Seraphina')
    // Seraphina 的 session 落在卡工作区对应的 projectKey 目录
    const seraphinaSession = written.find(f => f.path.includes('session.jsonl') && JSON.parse(f.content.trim().split('\n')[0]).cwd.endsWith(`rp/${cardSlug}`))
    expect(seraphinaSession).toBeTruthy()
    expect(seraphinaSession!.path).toBe(sessionFilePath(
      chatSessionId('Seraphina', 'a.jsonl'), `${dshHome}/rp/${cardSlug}`))

    // 孤儿聊天挂 _orphan 工作区
    const orphanSession = written.find(f => f.path.includes('session.jsonl') && JSON.parse(f.content.trim().split('\n')[0]).cwd.endsWith('rp/_orphan'))
    expect(orphanSession).toBeTruthy()

    // 两个工作区 README（卡工作区含 preset 指引与变体组计数；orphan 说明待认领）
    const cardReadme = written.find(f => f.path === `rp/${cardSlug}/README.md`)
    expect(cardReadme).toBeTruthy()
    expect(cardReadme!.content).toContain('Seraphina')
    expect(cardReadme!.content).toContain('1 个变体组')
    expect(cardReadme!.content).toContain('a.jsonl')
    const orphanReadme = written.find(f => f.path === 'rp/_orphan/README.md')
    expect(orphanReadme).toBeTruthy()
    expect(orphanReadme!.content).toContain('待认领')

    // 【阶段3 2026-09-10 契约修正】swipes 两个变体都 append；旧变体的移出由
    // user/message 标记（合法 replace）承担——0.1.5 禁止 assistant 做 replace 节点。
    const events = seraphinaSession!.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l))
    const asst = events.filter((e: { type: string }) => e.type === 'assistant/message')
    expect(asst).toHaveLength(2)
    for (const a of asst) expect(a.surfaceOp).toBe('append')
    const marks = events.filter((e: { type: string; surfaceOp?: unknown }) => e.type === 'user/message' && e.surfaceOp !== 'append')
    expect(marks).toHaveLength(1)
    expect((marks[0].surfaceOp as { op: string }).op).toBe('replace')
  })
})

describe('导入核心修复（R1 全卡建工作区 / R2 三键匹配 / R7 聊天元数据 / R9 全局书单）', () => {
  const dshHome = '/dsh'
  const card2 = { ...card, name: '无聊天角色', externalWorldRef: null, firstMes: '' } as unknown as CharacterCard

  const mkZip = (files: Record<string, string>) => ({
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { async: async () => v }])),
  }) as { files: Record<string, { async(t: 'string'): Promise<string> }> }

  it('R2 三键匹配：chats 目录名 = 卡来源文件名（≠ 卡内 name）也归属该卡；归一化键兜底', async () => {
    const named = { ...card, name: 'Seraphina', sourceFileName: 'seraphina_v2' } as unknown as CharacterCard
    const chat = JSON.stringify({ user_name: 'User' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '你好' })
    const imp = {
      zip: mkZip({
        'data/default-user/chats/seraphina_v2/a.jsonl': chat, // 命中 sourceFileName
        'data/default-user/chats/seraphina /b.jsonl': chat,  // 命中归一化 name（去空格小写）
      }),
      worlds: new Map(),
      characters: [named],
      chatFiles: [
        { path: 'data/default-user/chats/seraphina_v2/a.jsonl', ownerDir: 'seraphina_v2' },
        { path: 'data/default-user/chats/seraphina /b.jsonl', ownerDir: 'seraphina ' },
      ],
    }
    const written: Array<{ path: string; content: string }> = []
    const result = await exportToDshFiles(imp, async f => { written.push(...f) }, { worlds: false, cards: false, chats: true }, dshHome)
    expect(result.sessions).toBe(2)
    const slug = dshSlug('rp', 'Seraphina')
    // 两个聊天都挂到卡工作区（非 _orphan）
    const sessions = written.filter(f => f.path.includes('session.jsonl'))
    expect(sessions).toHaveLength(2)
    for (const s of sessions) {
      expect(JSON.parse(s.content.trim().split('\n')[0]).cwd).toBe(`${dshHome}/rp/${slug}`)
    }
    // 无孤儿警告
    expect(result.warnings.some(w => w.includes('孤儿聊天目录'))).toBe(false)
  })

  it('R2：对不上卡的聊天目录显式进 ExportResult.warnings', async () => {
    const chat = JSON.stringify({ user_name: 'User' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '无主聊天' })
    const imp = {
      zip: mkZip({ 'data/default-user/chats/某人/b.jsonl': chat }),
      worlds: new Map(),
      characters: [],
      chatFiles: [{ path: 'data/default-user/chats/某人/b.jsonl', ownerDir: '某人' }],
    }
    const result = await exportToDshFiles(imp, async () => {}, { worlds: false, cards: false, chats: true }, dshHome)
    const w = result.warnings.find(x => x.includes('孤儿聊天目录'))
    expect(w).toBeDefined()
    expect(w!).toContain('某人')
    expect(w!).toContain('1 个聊天')
    // 孤儿工作区也登记进 workspaces 列表
    expect(result.workspaces.some(ws => ws.slug === '_orphan')).toBe(true)
  })

  it('R1：无聊天的卡也产出 rp.json + README，且全部工作区登记进 ExportResult.workspaces', async () => {
    const chat = JSON.stringify({ user_name: 'User' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '你好' })
    const imp = {
      zip: mkZip({ 'data/default-user/chats/Seraphina/a.jsonl': chat }),
      worlds: new Map(),
      characters: [card, card2],
      chatFiles: [{ path: 'data/default-user/chats/Seraphina/a.jsonl', ownerDir: 'Seraphina' }],
    }
    const written: Array<{ path: string; content: string }> = []
    const result = await exportToDshFiles(imp, async f => { written.push(...f) }, { worlds: false, cards: false, chats: true }, dshHome)
    const slug2 = dshSlug('rp', '无聊天角色')
    // 无聊天的卡：rp.json + README 都有
    expect(written.some(f => f.path === `rp/${slug2}/rp.json`)).toBe(true)
    const readme2 = written.find(f => f.path === `rp/${slug2}/README.md`)!
    expect(readme2.content).toContain('暂无迁移聊天')
    // workspaces 列表：两卡各一条（slug 目录 + 卡名供 rename）
    expect(result.workspaces).toHaveLength(2)
    expect(result.workspaces.find(w => w.name === 'Seraphina')).toMatchObject({
      slug: dshSlug('rp', 'Seraphina'), dir: `rp/${dshSlug('rp', 'Seraphina')}`,
    })
    expect(result.workspaces.find(w => w.name === '无聊天角色')!.dir).toBe(`rp/${slug2}`)
  })

  it('R7：chat_metadata → variables 落盘 rp/state、绑定书并入 rp.json books、last_user_persona 进 macros.user', async () => {
    const meta = JSON.stringify({
      user_name: 'User',
      create_date: 'August 19, 2025 10:00pm',
      chat_metadata: {
        variables: { stat_data: { 好感度: 3 } },
        world: '示例游戏 世界书',
      },
      last_user_persona: { name: '示例人设甲' },
    })
    const chat = meta + '\n' + JSON.stringify({ name: 'User', is_user: true, mes: '你好' })
    const imp = {
      zip: mkZip({ 'data/default-user/chats/Seraphina/a.jsonl': chat }),
      worlds: new Map([['示例游戏 世界书', book]]),
      characters: [card],
      chatFiles: [{ path: 'data/default-user/chats/Seraphina/a.jsonl', ownerDir: 'Seraphina' }],
    }
    const written: Array<{ path: string; content: string }> = []
    await exportToDshFiles(imp, async f => { written.push(...f) }, { worlds: false, cards: false, chats: true }, dshHome)
    const sessionId = chatSessionId('Seraphina', 'a.jsonl')
    // variables → rp/state/<sessionId>.json
    const state = written.find(f => f.path === `rp/state/${sessionId}.json`)!
    expect(state).toBeDefined()
    expect(JSON.parse(state.content)).toEqual({ stat_data: { 好感度: 3 } })
    // rp.json：绑定书（与 externalWorldRef 同书，去重后只出现一次）+ macros.user
    const rp = JSON.parse(written.find(f => f.path === `rp/${dshSlug('rp', 'Seraphina')}/rp.json`)!.content)
    expect(rp.macros.user).toBe('示例人设甲')
    const lorePaths = rp.books.map((b: { lorePath: string }) => b.lorePath)
    expect(lorePaths.filter((p: string) => p === `skills/${dshSlug('wb', '示例游戏 世界书')}/references/lore.json`)).toHaveLength(1)
  })

  it('R9：全局书单落盘 rp/global-books.json 并并入每个工作区 rp.json 的 books（去重）', async () => {
    const chat = JSON.stringify({ user_name: 'User' }) + '\n'
      + JSON.stringify({ name: 'User', is_user: true, mes: '你好' })
    const imp = {
      zip: mkZip({ 'data/default-user/chats/Seraphina/a.jsonl': chat }),
      worlds: new Map([['示例游戏 世界书', book]]),
      characters: [card, card2],
      chatFiles: [{ path: 'data/default-user/chats/Seraphina/a.jsonl', ownerDir: 'Seraphina' }],
      report: { relations: { globalSelectedBooks: ['示例游戏 世界书', '全局设定集'] } },
    }
    const written: Array<{ path: string; content: string }> = []
    await exportToDshFiles(imp, async f => { written.push(...f) }, { worlds: false, cards: false, chats: true }, dshHome)
    // 全局书单文件
    const gb = written.find(f => f.path === 'rp/global-books.json')!
    expect(gb).toBeDefined()
    const gbBooks = JSON.parse(gb.content).books
    expect(gbBooks.map((b: { name: string }) => b.name)).toEqual(['示例游戏 世界书', '全局设定集'])
    expect(gbBooks[0].lorePath).toBe(`skills/${dshSlug('wb', '示例游戏 世界书')}/references/lore.json`)
    // 每个工作区 rp.json 都含全局书；与卡绑定书重复的只出现一次
    for (const c of [card, card2]) {
      const rp = JSON.parse(written.find(f => f.path === `rp/${dshSlug('rp', c.name)}/rp.json`)!.content)
      const lorePaths = rp.books.map((b: { lorePath: string }) => b.lorePath)
      expect(lorePaths).toContain(`skills/${dshSlug('wb', '全局设定集')}/references/lore.json`)
      expect(lorePaths.filter((p: string) => p === `skills/${dshSlug('wb', '示例游戏 世界书')}/references/lore.json`)).toHaveLength(1)
    }
  })
})

describe('P1#8 构造即验证：assertSessionLogEvents（同构校验器断言 seq 连续 + turn/step 配对）', () => {
  type Ev = { type: string; seq: number; data?: Record<string, unknown> }
  const ev = (type: string, seq: number, data: Record<string, unknown> = {}): Ev => ({ type, seq, data })
  /** 一轮标准 oneTurnLog */
  const oneTurn: Ev[] = [
    ev('turn/start', 0, { turn: 1 }),
    ev('user/message', 1, { role: 'user' }),
    ev('step/start', 2, { turn: 1, step: 1 }),
    ev('assistant/message', 3, { turn: 1, step: 1 }),
    ev('step/end', 4, { turn: 1, step: 1 }),
    ev('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
  ]

  it('合法日志通过（convertChatFile 真实产物直喂校验器）', () => {
    const conv = convertChatFile(
      [JSON.stringify({ name: 'User', is_user: true, mes: '你好' }),
        JSON.stringify({ name: 'C', is_user: false, mes: '回复', swipes: ['v1', 'v2'], swipe_id: 0 })].join('\n'),
      { sessionId: 'st-validate', createdAt: 1700000000000 },
    )
    const events = conv.content.trimEnd().split('\n').slice(1).map(l => JSON.parse(l) as Ev)
    expect(() => assertSessionLogEvents(events)).not.toThrow()
    expect(() => assertSessionLogEvents(oneTurn)).not.toThrow()
    // 空日志（全跳过场景）合法
    expect(() => assertSessionLogEvents([])).not.toThrow()
  })

  it('seq 断号 → throw 带诊断（期望/实际/位置）', () => {
    const broken = oneTurn.map(e => ({ ...e }))
    broken[3].seq = 9
    expect(() => assertSessionLogEvents(broken)).toThrow(/第 3 条.*seq 不连续（期望 3，实际 9）/)
  })

  it('turn/end 无配对 turn/start → throw', () => {
    expect(() => assertSessionLogEvents([ev('turn/end', 0, { turn: 1, reason: { kind: 'completed' } })]))
      .toThrow(/turn\/end 无配对 turn\/start/)
  })

  it('turn/start 嵌套（前 turn 未闭合又开新 turn）→ throw', () => {
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('turn/start', 1, { turn: 2 }),
    ])).toThrow(/turn\/start 嵌套：turn 1 未闭合/)
  })

  it('turn 编号不连续 → throw', () => {
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }),
      ev('turn/start', 2, { turn: 3 }),
    ])).toThrow(/turn 编号不连续（期望 2，实际 3）/)
  })

  it('step/start 出现在 turn 之外 / 缺 step 编号 → throw', () => {
    expect(() => assertSessionLogEvents([ev('step/start', 0, { turn: 1, step: 1 })]))
      .toThrow(/step\/start 出现在 turn 之外/)
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('step/start', 1, { turn: 1 }),
    ])).toThrow(/step\/start 缺 step 编号/)
  })

  it('step/end 与 step/start 不配对（编号不符/无开括弧）→ throw', () => {
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('step/end', 1, { turn: 1, step: 1 }),
    ])).toThrow(/step\/end 无配对 step\/start/)
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('step/start', 1, { turn: 1, step: 1 }),
      ev('step/end', 2, { turn: 1, step: 2 }),
    ])).toThrow(/step\/end（turn=1,step=2）与 step\/start（turn=1,step=1）不配对/)
  })

  it('turn/end reason.kind 非 completed / 结尾未闭合 → throw', () => {
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('turn/end', 1, { turn: 1, reason: { kind: 'aborted' } }),
    ])).toThrow(/reason\.kind 非 'completed'/)
    expect(() => assertSessionLogEvents(oneTurn.slice(0, 5)))
      .toThrow(/日志结尾仍有未闭合的 turn 1/)
    expect(() => assertSessionLogEvents(oneTurn.slice(0, 3)))
      .toThrow(/日志结尾仍有未闭合的 step 1/)
  })

  it('消息出现在 turn 之外 → throw；未知事件类型前向兼容不拦', () => {
    expect(() => assertSessionLogEvents([ev('user/message', 0, { role: 'user' })]))
      .toThrow(/user\/message 出现在 turn 之外/)
    expect(() => assertSessionLogEvents([
      ev('turn/start', 0, { turn: 1 }),
      ev('agent-rp/sillytavern-chat-import', 1, { note: '溯源' }),
      ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ])).not.toThrow()
  })
})
