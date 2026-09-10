import { describe, expect, it } from 'vitest'
import {
  agentPresetDirId, applyPromptRegexes, buildPersonaSnapshotMessage, buildVariantSwitchEvent,
  collectVariantGroups, extractPersonaTextFromAgentYml, findLastUserMessage, findStDataRoot,
  hasDirectUserInput,
  processActivatedEntries, renderWorldInfoSnapshot, repairSessionSeqs, rewriteSessionHeaderCwd,
  rpSlugFromCwd, scanSurfaceHistory, searchLoreEntries, sessionContentMaxTime,
  sessionCwdNeedsRepair, spliceDepthInjections, truncateSessionJsonl,
} from '../src/dsh-plugin/index.ts'
import type { LoreEntry } from '../src/lore/entry.ts'
import type { RegexScript } from '../src/regex/engine.ts'

const entry = (over: Partial<LoreEntry>): LoreEntry => ({
  id: 0, comment: '', content: '', keys: [], secondaryKeys: [], constant: false,
  position: 0, depth: 4, order: 0, enabled: true, excludeRecursion: false,
  preventRecursion: false, probability: 100, ...over,
}) as LoreEntry

describe('dsht-rp-plugin: 工作区识别', () => {
  const home = '/data/data/com.dshtavern.app/files/.dsh'
  it('cwd 在 rp/<slug> 下 → slug；其他 → null', () => {
    expect(rpSlugFromCwd(`${home}/rp/rp-seraphina-abc`, home)).toBe('rp-seraphina-abc')
    expect(rpSlugFromCwd(undefined, home)).toBeNull()
    expect(rpSlugFromCwd('/other/path', home)).toBeNull()
    expect(rpSlugFromCwd(`${home}/skills/x`, home)).toBeNull()
    expect(rpSlugFromCwd(`${home}/rp/a/b`, home)).toBeNull() // 嵌套不算
  })
})

describe('dsht-rp-plugin: 历史重建', () => {
  it('surface 事件 → 文本数组；快照消息被排除；claimed 参与扫描', () => {
    const session = {
      header: {},
      surface: { nodes: [0, 1, 2, 3] },
      events: [
        { type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: '我走进咖啡厅' }], source: { kind: 'user' } } },
        // assistant/message 的 data 是 {turn, step, message} 包装（DSH 事件契约）
        { type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '风铃作响' }], source: { kind: 'model' } } } },
        // 我们注入的快照（应排除）
        { type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'snapshot 旧条目' }], source: { kind: 'plugin', plugin: 'dsht-rp-plugin', form: 'snapshot' } } },
        // 官方 runtime-context 快照（也应排除）
        { type: 'user/message', seq: 3, data: { role: 'user', content: [{ type: 'text', text: 'runtime ctx' }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' } } },
      ],
    }
    const claimed = [{ role: 'user', content: [{ type: 'text', text: '丰川祥子抬头' }], source: { kind: 'user' } }]
    const texts = scanSurfaceHistory(session as never, claimed as never[], 2)
    expect(texts).toEqual(['我走进咖啡厅', '风铃作响', '丰川祥子抬头'])
  })

  it('非 message 事件与无 content 消息安全跳过（容错）', () => {
    const session = {
      header: {},
      surface: { nodes: [0, 1] },
      events: [
        { type: 'turn/start', seq: 0, data: { turn: 1 } },
        { type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, message: undefined } },
      ],
    }
    expect(scanSurfaceHistory(session as never, [], 2)).toEqual([])
  })
})

describe('dsht-rp-plugin: 快照渲染', () => {
  it('激活条目 → 注入块（含 supersede 声明 + 宏替换）；空激活 → 空串', () => {
    const activated = [
      { entry: entry({ comment: '今州城', content: '{{char}}所在的城邦', constant: true }), reason: 'constant' },
      { entry: entry({ comment: '守岸人', content: '守岸人是{{user}}的同伴', keys: ['守岸人'] }), reason: 'primary' },
    ]
    const text = renderWorldInfoSnapshot(activated, { char: '今汐', user: '漂泊者' })
    expect(text).toContain('supersedes earlier ones')
    expect(text).toContain('[常驻] 今州城')
    expect(text).toContain('今汐所在的城邦')
    expect(text).toContain('[关键词] 守岸人')
    expect(text).toContain('守岸人是漂泊者的同伴')
    expect(renderWorldInfoSnapshot([], { char: '', user: '' })).toBe('')
  })
})

describe('dsht-rp-plugin: lore_query 搜索（T1.8）', () => {
  const entries = [
    entry({ comment: '樋口圆香', content: '圆香是noctchill的成员，性格冷静', keys: ['圆香', '樋口'] }),
    entry({ comment: '市川雏菜', content: '雏菜性格开朗，喜欢圆香', keys: ['雏菜'] }),
    entry({ comment: '283事务所', content: '偶像们的事务所', keys: ['事务所'] }),
  ]
  it('关键词命中排序（keys > comment > content），格式化输出', () => {
    const out = searchLoreEntries(entries, '圆香')
    expect(out).toContain('2 match(es)')
    expect(out.indexOf('## 樋口圆香')).toBeLessThan(out.indexOf('## 市川雏菜')) // keys 命中排前
    expect(out).toContain('性格冷静')
  })
  it('无命中 → 提示换词', () => {
    expect(searchLoreEntries(entries, '不存在的东西')).toContain('No worldbook entry matches')
  })
  it('空查询与截断', () => {
    expect(searchLoreEntries(entries, '  ')).toBe('Empty query.')
    const long = searchLoreEntries([entry({ comment: 'x', content: 'a'.repeat(3000) })], 'a', { maxContentChars: 100 })
    expect(long).toContain('truncated, 3000 chars total')
  })
})

describe('dsht-rp-plugin: 变体组（T1.13 重roll/切换）', () => {
  const asstEv = (seq: number, text: string, op: unknown, sources?: number[]) => ({
    type: 'assistant/message', seq,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } } },
    ...(op !== undefined ? { surfaceOp: op } : {}),
    ...(sources ? { sourceEventSeqs: sources } : {}),
  })
  const events = [
    { type: 'turn/start', seq: 0, data: { turn: 1 } },
    { type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } },
    asstEv(2, '版本A', 'append'),
    asstEv(3, '版本B', { op: 'replace', start: 2, end: 2 }, [2]),
    asstEv(4, '版本C', { op: 'replace', start: 3, end: 3 }, [3]),
  ]

  it('collectVariantGroups：replace 链归并成组，active 指向最后一个', () => {
    const groups = collectVariantGroups(events as never[])
    expect(groups.size).toBe(3) // seq 2/3/4 都指向同一组
    const g = groups.get(2)!
    expect(g.members.map(m => m.text)).toEqual(['版本A', '版本B', '版本C'])
    expect(g.activeSeq).toBe(4)
    expect(groups.get(4)).toBe(g) // 同一引用
  })

  it('独立消息不成组；空链安全', () => {
    const groups = collectVariantGroups([
      asstEv(2, '单独', 'append'),
      { type: 'turn/end', seq: 3, data: {} },
    ] as never[])
    expect(groups.size).toBe(0)
  })

  it('buildVariantSwitchEvent：replace 当前 active + sourceEventSeqs 血缘', () => {
    const ev = buildVariantSwitchEvent('s1', 5, 4, '版本B')!
    expect(ev.type).toBe('assistant/message')
    expect(ev.surfaceOp).toEqual({ op: 'replace', start: 4, end: 4 })
    expect(ev.sourceEventSeqs).toEqual([4])
    expect(ev.data.message.content[0].text).toBe('版本B')
    expect(ev.data.message.source.provider).toBe('dsht-variant')
    expect(buildVariantSwitchEvent('s1', 5, 4, '  ')).toBeNull() // 空文本拒绝
  })

  it('T7b：replace 链血缘不重复累积——每条 switch 事件的 sourceEventSeqs 恒为单元素直接前驱', () => {
    // 来回滑动后读模型 members 增长是 append-only 语义的如实映射（前端按文本归一化，
    // 见 variant-groups.spec.ts 的不变量钉板）；后端侧要验证的是血缘不劣化
    const ev = buildVariantSwitchEvent('s1', 9, 5, '版本A')!
    expect(ev.sourceEventSeqs).toEqual([5]) // 只含被替换的直接前驱，不累积历史链
    expect(ev.surfaceOp).toEqual({ op: 'replace', start: 5, end: 5 })
  })
})

// ---------------------------------------------------------------------------
// 组装管线运行时接线（§4.1 五步在 pre-step 的纯函数层；T1.2/T1.3/T1.4/T1.5）
// ---------------------------------------------------------------------------

const regex = (over: Partial<RegexScript>): RegexScript => ({
  id: 'r1', scriptName: '测试正则', findRegex: '/旧词/g', replaceString: '新词',
  trimStrings: [], placement: [1, 2, 5], disabled: false,
  markdownOnly: false, promptOnly: true, runOnEdit: false, substituteRegex: 0,
  minDepth: null, maxDepth: null, ...over,
})

describe('dsht-rp-plugin: 组装管线接线', () => {
  it('applyPromptRegexes：prompt 时机改批消息（user/assistant 按位过滤，system 不动）', () => {
    const scripts = [regex({})]
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: '我说了旧词' }] },
      { role: 'assistant', content: [{ type: 'text', text: '她回应旧词' }] },
      { role: 'system', content: [{ type: 'text', text: '系统旧词不该被改' }] },
    ] as never[]
    const hits: Array<{ scriptName: string; count: number }> = []
    const out = applyPromptRegexes(msgs, scripts, hits)
    expect((out[0] as { content: Array<{ text: string }> }).content[0].text).toBe('我说了新词')
    expect((out[1] as { content: Array<{ text: string }> }).content[0].text).toBe('她回应新词')
    expect((out[2] as { content: Array<{ text: string }> }).content[0].text).toBe('系统旧词不该被改')
    expect(hits.length).toBe(2)
  })

  it('applyPromptRegexes：display-only 脚本不动批消息（三时机过滤）', () => {
    const scripts = [regex({ markdownOnly: true, promptOnly: false })]
    const msgs = [{ role: 'user', content: [{ type: 'text', text: '旧词' }] }] as never[]
    const hits: Array<{ scriptName: string; count: number }> = []
    const out = applyPromptRegexes(msgs, scripts, hits)
    expect((out[0] as { content: Array<{ text: string }> }).content[0].text).toBe('旧词')
    expect(hits.length).toBe(0)
  })

  it('processActivatedEntries：WI 内容过正则（WORLD_INFO 位）+ 宏求值 + 位置分桶', () => {
    const scripts = [regex({ findRegex: '/旧词/g', replaceString: '新词', placement: [5] })]
    const activated = [
      { entry: entry({ comment: '顶部条目', content: '{{char}}知道旧词', position: 0 }), reason: 'constant' },
      { entry: entry({ comment: '底部条目', content: '{{user}}所在', position: 1 }), reason: '关键词' },
      { entry: entry({ comment: '深度条目', content: '旧词{{char}}', position: 4, depth: 2 }), reason: '关键词' },
    ]
    const hits: Array<{ scriptName: string; count: number }> = []
    const buckets = processActivatedEntries(activated, scripts, { user: '旅人', char: '祥子', stableSeed: 's1' }, hits)
    expect(buckets.before[0].content).toBe('祥子知道新词')
    expect(buckets.after[0].content).toBe('旅人所在')
    expect(buckets.atDepth[0]).toMatchObject({ depth: 2, content: '新词祥子' })
    expect(buckets.before[0].reason).toBe('constant')
    expect(hits.length).toBe(2)
  })

  it('spliceDepthInjections：depth N 插到倒数第 N 位之前；同深度按 role 序合并', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: '消息1' }] },
      { role: 'assistant', content: [{ type: 'text', text: '消息2' }] },
      { role: 'user', content: [{ type: 'text', text: '消息3' }] },
    ] as never[]
    const out = spliceDepthInjections(msgs, [
      { depth: 0, role: 'system', content: '临门提示' },
      { depth: 2, role: 'system', content: '中层注入A' },
      { depth: 2, role: 'user', content: '中层注入B' },
    ])
    // depth 0 → 最末；depth 2 → 倒数第 2 位前；同深度 system→user 合并为一条
    const texts = out.map(m => (m as { content: Array<{ text: string }> }).content[0].text)
    expect(texts).toEqual(['消息1', '中层注入A\n中层注入B', '消息2', '消息3', '临门提示'])
  })
})

describe('dsht-rp-plugin: 存量 session cwd 修复（R14）', () => {
  it('sessionCwdNeedsRepair：仅 /data/user/0 形态命中', () => {
    expect(sessionCwdNeedsRepair('/data/user/0/com.dshtavern.app/files/.dsh/rp/rp-x')).toBe(true)
    expect(sessionCwdNeedsRepair('/data/data/com.dshtavern.app/files/.dsh/rp/rp-x')).toBe(false)
    expect(sessionCwdNeedsRepair('rp/_start')).toBe(false) // 相对路径不动
    expect(sessionCwdNeedsRepair(undefined)).toBe(false)
    expect(sessionCwdNeedsRepair(42)).toBe(false)
  })

  it('rewriteSessionHeaderCwd：只改 header 行 cwd，其余字段保序保留', () => {
    const line = JSON.stringify({
      type: 'session', version: 0, id: 'st-abc', createdAt: 123,
      cwd: '/data/user/0/com.dshtavern.app/files/.dsh/rp/rp-x', delegationDepth: 0,
    })
    const out = rewriteSessionHeaderCwd(line, '/data/data/com.dshtavern.app/files/.dsh/rp/rp-x')!
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed.cwd).toBe('/data/data/com.dshtavern.app/files/.dsh/rp/rp-x')
    expect(parsed.id).toBe('st-abc')
    expect(parsed.delegationDepth).toBe(0)
  })

  it('rewriteSessionHeaderCwd：非 header / 已是规范形态 / 坏 JSON → null（幂等）', () => {
    expect(rewriteSessionHeaderCwd('{"type":"turn/start","seq":0}', '/data/data/x')).toBeNull()
    expect(rewriteSessionHeaderCwd('{"type":"session","id":"s1"}', '/data/data/x')).toBeNull() // 无 cwd
    expect(rewriteSessionHeaderCwd('{"type":"session","id":"s1","cwd":"/data/data/x"}', '/data/data/x')).toBeNull()
    expect(rewriteSessionHeaderCwd('not json', '/data/data/x')).toBeNull()
  })
})

describe('dsht-rp-plugin: agentPresetDirId（R5 坑：raw id 含 CJK/emoji 时 discovery 永不入列）', () => {
  const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
  it('CJK/emoji/空格/括号 id → PRESET_ID 合法目录名，且稳定', () => {
    for (const raw of ['st-V1.4 [轻量] 狐狐~ 🦊-pqmfsq', 'st-[主预设] V17.1 示例预设 · 示例角色-1lnwm2', 'st-梦鲸思客-Agent-gbn444', 'st-Default-76b532']) {
      const dir = agentPresetDirId(raw)
      expect(dir).toMatch(PRESET_ID)
      expect(agentPresetDirId(raw)).toBe(dir) // 稳定（幂等覆盖）
      expect(dir.startsWith('st-')).toBe(true)
    }
  })
  it('净化碰撞靠 hash 后缀区分；全非标字符有兜底', () => {
    expect(agentPresetDirId('st-狐狐')).not.toBe(agentPresetDirId('st-狐狸'))
    expect(agentPresetDirId('🦊🦊')).toMatch(PRESET_ID)
  })
})

describe('dsht-rp-plugin: session seq 断号修复（R17 真机实测：st-asm3yf header 后 0,1,2,4 被 DSH 拒开）', () => {
  const header = JSON.stringify({ type: 'session', version: 0, id: 'st-asm3yf', createdAt: 1000, cwd: '/data/data/x/.dsh/rp/rp-foo', delegationDepth: 0 })
  const ev = (seq: number, type = 'turn/start', extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type, seq, time: 1000 + seq, data: {}, ...extra })

  it('断号重编号：seq 从 0 连续；replace 链 start/end/sourceEventSeqs 按 old→new 重写', () => {
    // 复刻实测形态：header 后 seq 0,1,2,4（3 被跳），seq 4 是 replace 链事件（引用 2）
    const gapped = [
      header,
      ev(0),
      ev(1, 'user/message', { surfaceOp: 'append' }),
      ev(2, 'assistant/message', { surfaceOp: 'append' }),
      ev(4, 'assistant/message', { surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2] }),
    ].join('\n') + '\n'
    const r = repairSessionSeqs(gapped)
    expect(r.repaired).toBe(true)
    expect(r.events).toBe(4)
    const lines = r.content.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({ type: 'session', id: 'st-asm3yf', cwd: '/data/data/x/.dsh/rp/rp-foo' }) // header 不动
    expect(lines.slice(1).map(e => e.seq)).toEqual([0, 1, 2, 3])
    // replace 链映射：old 2 → new 2（本例 seq<=2 未位移），验证映射机制本身
    expect(lines[4].surfaceOp).toEqual({ op: 'replace', start: 2, end: 2 })
    expect(lines[4].sourceEventSeqs).toEqual([2])
    // 修复后幂等：再跑一次不再修
    expect(repairSessionSeqs(r.content).repaired).toBe(false)
  })

  it('断在中间的重排：old→new 映射改写 replace 引用（3→2、5→3）', () => {
    // seq 0,1,3,5：old 3 的事件 replace old 1；old 5 的事件 replace old 3
    const asst = (seq: number, text: string, op: unknown, sources?: number[]) =>
      JSON.stringify({
        type: 'assistant/message', seq, time: 1000 + seq,
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } } },
        surfaceOp: op, ...(sources ? { sourceEventSeqs: sources } : {}),
      })
    const gapped = [
      header,
      ev(0),
      asst(1, '变体A', 'append'),
      asst(3, '变体B', { op: 'replace', start: 1, end: 1 }, [1]),
      asst(5, '变体C', { op: 'replace', start: 3, end: 3 }, [3]),
    ].join('\n') + '\n'
    const r = repairSessionSeqs(gapped)
    expect(r.repaired).toBe(true)
    const lines = r.content.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(lines.slice(1).map(e => e.seq)).toEqual([0, 1, 2, 3])
    expect(lines[2].surfaceOp).toBe('append') // old 1（变体A）未位移
    expect(lines[3].surfaceOp).toEqual({ op: 'replace', start: 1, end: 1 }) // 引用 old 1 → new 1
    expect(lines[4].surfaceOp).toEqual({ op: 'replace', start: 2, end: 2 }) // 引用 old 3 → new 2
    expect(lines[4].sourceEventSeqs).toEqual([2])
    // 修复后 collectVariantGroups 仍能重建变体链（2 成员组）
    const g = collectVariantGroups(lines.slice(1) as never[]).get(1)!
    expect(g.members.map(m => m.seq)).toEqual([1, 2, 3])
    expect(g.activeSeq).toBe(3)
  })

  it('连续文件短路（幂等）；坏形态如实报错不盲改；无 seq 行原样保留不报错', () => {
    const good = [header, ev(0), ev(1), ev(2)].join('\n') + '\n'
    const r = repairSessionSeqs(good)
    expect(r.repaired).toBe(false)
    expect(r.content).toBe(good)
    expect(repairSessionSeqs('not json\n').error).toBeTruthy()
    expect(repairSessionSeqs('{"type":"turn/start","seq":0}\n').error).toBe('首行不是 session header')
    // DSH 原生可能写无 seq 的边界行（checkpoint 等）——原样保留、不参与判定、不算错误
    const withRaw = [header, ev(0), '{"type":"checkpoint"}', ev(1)].join('\n') + '\n'
    const rr = repairSessionSeqs(withRaw)
    expect(rr.error).toBeUndefined()
    expect(rr.repaired).toBe(false)
    expect(rr.content).toBe(withRaw)
    expect(repairSessionSeqs(`${header}\nBADLINE\n`).error).toContain('不是合法 JSON')
  })
})

describe('dsht-rp-plugin: 会话回退截断（R18：truncateSessionJsonl）', () => {
  const header = JSON.stringify({ type: 'session', version: 0, id: 'st-abc', createdAt: 1000, cwd: '/x', delegationDepth: 0 })
  const file = [
    header,
    JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: {} }),
    JSON.stringify({ type: 'user/message', seq: 1, time: 2, data: {}, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 2, time: 3, data: {}, surfaceOp: 'append' }),
    JSON.stringify({ type: 'assistant/message', seq: 3, time: 4, data: {}, surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2] }),
    JSON.stringify({ type: 'turn/end', seq: 4, time: 5, data: {} }),
  ].join('\n') + '\n'

  it('截到 keepThroughSeq（含）：header 保留，后序事件（含 replace 链尾）消失', () => {
    const r = truncateSessionJsonl(file, 1)
    expect(r.kept).toBe(2) // seq 0,1
    expect(r.dropped).toBe(3) // seq 2,3,4（replace 链随截断消失）
    const lines = r.content.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({ type: 'session', id: 'st-abc' })
    expect(lines).toHaveLength(3)
    expect(lines.map(l => l.seq ?? -1)).toEqual([-1, 0, 1])
  })

  it('边界：keepThroughSeq 超出 → no-op；坏文件报错', () => {
    expect(truncateSessionJsonl(file, 99).dropped).toBe(0)
    expect(truncateSessionJsonl(file, 4).dropped).toBe(0)
    expect(truncateSessionJsonl('not json\n', 1).error).toBeTruthy()
    expect(truncateSessionJsonl(`${header}\nBAD\n`, 1).error).toContain('不是合法 JSON')
  })
})

describe('dsht-rp-plugin: findStDataRoot（R0 实测坑：插件 .vscode/settings.json 抢根）', () => {
  it('深层 .vscode 有 settings.json 时仍选标志齐全的浅根', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const base = await mkdtemp(join(tmpdir(), 'dsht-stroot-'))
    try {
      const root = join(base, 'data', 'default-user')
      for (const d of ['worlds', 'characters', 'chats']) await mkdir(join(root, d), { recursive: true })
      await writeFile(join(root, 'settings.json'), '{}')
      // 陷阱：更深的插件 .vscode 里也有 settings.json（真实数据包 JS-Slash-Runner 即如此）
      const trap = join(root, 'extensions', 'JS-Slash-Runner', '.vscode')
      await mkdir(trap, { recursive: true })
      await writeFile(join(trap, 'settings.json'), '{}')
      expect(await findStDataRoot(base)).toBe(root)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('dsht-rp-plugin: extractPersonaTextFromAgentYml（任务 2 存量迁移）', () => {
  const yml = [
    '# 注释行',
    '- id: persona',
    '  name: \'@deepseek-ai/dsh-persona\'',
    '  config:',
    '    text: |-',
    '      你正在进行角色扮演。',
    '      # 角色设定',
    '      精灵法师',
    '',
    '    complete: true',
    '',
  ].join('\n')
  it('抽出 text: |- 块正文（剥块缩进、块内空行保留、块尾收边）', () => {
    const text = extractPersonaTextFromAgentYml(yml)
    expect(text).toBe('你正在进行角色扮演。\n# 角色设定\n精灵法师')
  })
  it('无 text 块 → null；空块 → null', () => {
    expect(extractPersonaTextFromAgentYml('- id: persona\n  config:\n    complete: true\n')).toBeNull()
    expect(extractPersonaTextFromAgentYml('    text: |-\n  other: 1\n')).toBeNull()
  })
})

describe('dsht-rp-plugin: 卡设定快照注入（任务 2：无 agent preset 的 RP 会话）', () => {
  it('模拟 pre-step 决策对象：promptPersona 作为首条 system 快照注入', () => {
    // rp-* agent preset 已删：会话 header 无 agentPreset，pre-step 只依赖 rp.json.promptPersona
    const decision = {
      kind: 'enter' as const,
      messages: [
        { role: 'user', content: [{ type: 'text', text: '你好' }] },
      ],
    }
    const personaText = '你是精灵法师。\n# 行为准则\n不说现代词汇。'
    // 与 pre-step withPersonaSnapshot 同路径：决策批尾部追加 user 席快照消息
    //（rc.8 冷启动校验要求 user/message 的 role === 'user'，'system' 会让会话打不开）
    const m = buildPersonaSnapshotMessage(personaText)
    const out = { kind: decision.kind, messages: [...decision.messages, m] }
    expect(out.messages).toHaveLength(2)
    const injected = out.messages[1] as Record<string, unknown> & { source: Record<string, unknown> }
    expect(injected.role).toBe('user')
    expect(injected.source).toMatchObject({ kind: 'plugin', plugin: 'dsht-rp-plugin', form: 'snapshot' })
    expect((injected.content as Array<{ text: string }>)[0].text).toBe(personaText)
    // 快照形态与世界书快照同款：历史重建扫描排除（不自我强化）
    expect(injected.source.form).toBe('snapshot')
  })
})

describe('dsht-rp-plugin: 会话重新生成定位（任务 4）', () => {
  const ev = (type: string, seq: number, text?: string) => ({
    type, seq,
    data: text !== undefined ? { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } : {},
  })
  it('findLastUserMessage 取最后一条 user/message 的 seq 与文本', () => {
    const events = [
      ev('turn/start', 0),
      ev('user/message', 1, '第一句'),
      ev('assistant/message', 2),
      ev('user/message', 3, '第二句'),
      ev('assistant/message', 4),
    ]
    expect(findLastUserMessage(events)).toEqual({ seq: 3, text: '第二句' })
    expect(findLastUserMessage([ev('turn/start', 0)])).toBeNull()
  })
  it('【鲁棒轮回归】plugin marker 不作锚（回退/重新生成 marker 文案不被当输入重发）；无 source 的旧数据仍兼容', () => {
    const marker = { type: 'user/message', seq: 7, data: { role: 'user', content: [{ type: 'text', text: '[已回退] 该消息及其后的对话已从上下文移除' }], source: { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: 5 } } }
    const legacy = { type: 'user/message', seq: 3, data: { role: 'user', content: [{ type: 'text', text: '真用户消息（旧数据无 source）' }] } }
    // marker 在后 → 跳过它，锚回更早的真用户消息
    expect(findLastUserMessage([legacy, marker])).toEqual({ seq: 3, text: '真用户消息（旧数据无 source）' })
    // 只有 marker → 无锚
    expect(findLastUserMessage([marker])).toBeNull()
  })
  it('sessionContentMaxTime 取截断内容的最后事件时间（undo 回放截断点）', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 's' }),
      JSON.stringify({ type: 'turn/start', seq: 0, time: 100 }),
      JSON.stringify({ type: 'user/message', seq: 1, time: 250 }),
    ].join('\n') + '\n'
    expect(sessionContentMaxTime(content)).toBe(250)
    expect(sessionContentMaxTime('')).toBe(0)
  })
  it('regenerate 截断语义：锚定最后用户消息 seq，截掉其后 assistant 事件', () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 's' }),
      JSON.stringify({ type: 'user/message', seq: 1, time: 100, data: { role: 'user', content: [{ type: 'text', text: '重来' }] } }),
      JSON.stringify({ type: 'assistant/message', seq: 2, time: 200, data: {} }),
      JSON.stringify({ type: 'turn/end', seq: 3, time: 300 }),
    ]
    const content = lines.join('\n') + '\n'
    const events = lines.slice(1).map(l => JSON.parse(l) as { type: string; seq: number; data?: unknown })
    const anchor = findLastUserMessage(events)!
    const r = truncateSessionJsonl(content, anchor.seq)
    expect(anchor).toEqual({ seq: 1, text: '重来' })
    expect(r.kept).toBe(1)
    expect(r.dropped).toBe(2) // assistant 回复与 turn 包裹全部截掉
    expect(sessionContentMaxTime(r.content)).toBe(100) // 截断点之后（ts>100）的变量写会被回放
  })
})

describe('dsht-rp-plugin: P0-5 per-turn 闸门（hasDirectUserInput）', () => {
  const msg = (kind: string, text = 'x') => ({ role: 'user', content: [{ type: 'text', text }], source: { kind } })
  it('本 step inbox 含真实用户消息 → 注入；工具轮（无 user 消息）→ 跳过', () => {
    expect(hasDirectUserInput([msg('user')])).toBe(true)
    // 工具轮：模型工具结果/插件注入都不算真实用户输入
    expect(hasDirectUserInput([msg('plugin'), msg('model')] as never)).toBe(false)
    expect(hasDirectUserInput([])).toBe(false)
    expect(hasDirectUserInput(undefined)).toBe(false)
  })
})
