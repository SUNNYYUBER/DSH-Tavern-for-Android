/**
 * 酒馆助手门面路由（dsht-plugin-tavern-helper/facade.ts）测试——
 * 纯函数族直调（显式传 dshHome 临时目录，真实文件系统驱动，与 file-snapshots.spec.ts 同口径）：
 * 1. StPrompt 视图构建（slots + toggles 两类条目与 prompt_order 全量列出）；
 * 2. preset/put 锚定合并（identifier/toggle/追加三路命中；knowledge/budget/model/sampling/skill 槽不丢）；
 * 3. preset/load 扁平 MVU 裸树兼容（无保留键整树包 variables 再写 presetId）；
 * 4. regexes 三源合并（global + character + preset，_dshtScope 标记）与整组替换写回；
 * 5. worldbook LoreEntry ↔ ST World Info entry 形状往返 + entry-put 锚定合并；
 * 6. chat/messages 基本映射（user/assistant 事件 → StMessage[]）。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildStPromptView, chatMessages, flushEntryPuts, loreEntryToSt, presetLoad, presetNames, presetPut,
  regexesGet, regexesReplace, stEntryToLore, variableSchemaRegister, worldbookEntryPut, worldbookGet, worldbookList,
} from '../src/dsht-plugin-tavern-helper/facade.ts'
import { emptyPreset, type RPPreset } from '../src/preset/schema.ts'
import { validateSchemaSubset } from '../src/dsht-plugin-shared/schema.ts'
import type { LoreBook } from '../src/lore/entry.ts'
import type { RegexScript } from '../src/regex/engine.ts'

let base = ''
let home = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsht-th-facade-'))
  home = join(base, '.dsh')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 造 $DSH_HOME 相对数据文件（posix 相对路径） */
async function seedJson(rel: string, data: unknown): Promise<void> {
  const abs = join(home, ...rel.split('/'))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, JSON.stringify(data, null, 1), 'utf8')
}

async function readJson(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(home, ...rel.split('/')), 'utf8')) as Record<string, unknown>
}

/** 测试预设：emptyPreset 骨架 + skillRef 槽 + 多选开关组（两类条目齐备） */
function testPreset(): RPPreset {
  const p = emptyPreset('p-a', '预设甲')
  p.slots[0].content = '主提示词'
  p.slots.push({ id: 'skillStep', type: 'skillRef', skill: 'step-guide', content: '步骤指引', enabled: true })
  p.toggles = [
    {
      group: '风格', label: '文风', multi: true,
      options: [
        { id: 'poetic', label: '诗意', content: '用诗意文风', selected: true },
        { id: 'plain', label: '平实', content: '用平实文风', selected: false },
      ],
    },
  ]
  return p
}

/** 测试正则脚本（ST RegexScript 形状） */
function script(id: string, name: string): RegexScript {
  return {
    id, scriptName: name, findRegex: `find-${id}`, replaceString: '', trimStrings: [],
    placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
  }
}

/** 造会话（header + 事件流；user/message data = Message 本体，assistant/message data = {turn,step,message}） */
async function makeSession(sid: string, cwd: string | null, extraBadLine = false): Promise<void> {
  const dir = join(home, 'sessions', 'proj', sid)
  await mkdir(dir, { recursive: true })
  const header: Record<string, unknown> = { type: 'session', version: 0, id: sid, createdAt: 1000 }
  if (cwd) header.cwd = cwd
  const lines = [JSON.stringify(header)]
  let seq = 0
  lines.push(JSON.stringify({ type: 'turn/start', seq: seq++, time: 1, data: { turn: 1 } }))
  lines.push(JSON.stringify({ type: 'user/message', seq: seq++, time: 1, data: { role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } }))
  lines.push(JSON.stringify({ type: 'assistant/message', seq: seq++, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '欢迎回来' }] } } }))
  if (extraBadLine) lines.push('{坏 JSON 行') // 坏行跳过不炸
  lines.push(JSON.stringify({ type: 'turn/end', seq: seq++, time: 1, data: { turn: 1 } }))
  await writeFile(join(dir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8')
}

describe('门面：StPrompt 视图构建', () => {
  it('slots → StPrompt（system/skillRef/marker/depth 各形态）+ toggles → toggle-* 条目', () => {
    const view = buildStPromptView(testPreset())
    // emptyPreset 11 槽 + skillRef 1 + toggle 2 = 14 条
    expect(view.prompts).toHaveLength(14)
    const main = view.prompts.find(p => p.identifier === 'main')!
    expect(main).toEqual({
      identifier: 'main', name: 'main', role: 'system', content: '主提示词',
      system_prompt: true, marker: false, injection_position: 0, injection_depth: 100,
    })
    const marker = view.prompts.find(p => p.identifier === 'worldBefore')!
    expect(marker.marker).toBe(true)
    expect(marker.system_prompt).toBe(false)
    expect(marker.content).toBe('')
    const skill = view.prompts.find(p => p.identifier === 'skillStep')!
    expect(skill.system_prompt).toBe(true) // skillRef 归 system_prompt
    expect(skill.marker).toBe(false)
    const jb = view.prompts.find(p => p.identifier === 'jb')!
    expect(jb.injection_position).toBe(1) // depth 有值 = 绝对深度注入
    expect(jb.injection_depth).toBe(2)
    const poetic = view.prompts.find(p => p.identifier === 'toggle-风格-poetic')!
    expect(poetic).toMatchObject({ name: '诗意', role: 'system', content: '用诗意文风', system_prompt: true, marker: false, injection_position: 0 })
  })

  it('prompt_order 单档 character_id 100001，全量列出（未选中项 enabled:false）', () => {
    const view = buildStPromptView(testPreset())
    expect(view.prompt_order).toHaveLength(1)
    expect(view.prompt_order[0].character_id).toBe(100001)
    const order = view.prompt_order[0].order
    expect(order).toHaveLength(14)
    expect(order.find(o => o.identifier === 'main')?.enabled).toBe(true)
    expect(order.find(o => o.identifier === 'toggle-风格-poetic')?.enabled).toBe(true)
    expect(order.find(o => o.identifier === 'toggle-风格-plain')?.enabled).toBe(false) // 非 selected 也列出
  })
})

describe('门面：preset/put 锚定合并', () => {
  it('identifier/toggle 两路命中更新 + 未知条目追加；knowledge/budget/model/sampling/skill 槽不丢', async () => {
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    const r = await presetPut(home, {
      name: '预设甲',
      prompts: [
        { identifier: 'main', name: 'main', role: 'system', content: '改过的主提示词', system_prompt: true, marker: false, injection_position: 0, injection_depth: 100 },
        { identifier: 'jb', name: 'jb', role: 'user', content: '深度注入', system_prompt: true, marker: false, injection_position: 1, injection_depth: 5 },
        { identifier: 'toggle-风格-poetic', name: '诗意', role: 'system', content: '改成白描', system_prompt: true, marker: false, injection_position: 0, injection_depth: 100 },
        { identifier: 'brand-new', name: '新条目', role: 'assistant', content: '追加内容', system_prompt: true, marker: false, injection_position: 0, injection_depth: 100 },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'jb', enabled: true },
          { identifier: 'toggle-风格-poetic', enabled: false }, // 停用诗意
          { identifier: 'brand-new', enabled: true },
        ],
      }],
    })
    expect(r.status).toBe(200)
    const saved = (await readJson('rp-presets/p-a/preset.json')) as unknown as RPPreset
    // 结构键不丢（不整体覆盖）
    expect(saved.knowledge).toEqual({ books: [], scanDepth: 2, budgetPercent: 25 })
    expect(saved.budget.maxToolRounds).toBe(2)
    expect(saved.sampling.temperature).toBe(1)
    expect(saved.model).toEqual({})
    expect(saved.slots.find(s => s.id === 'skillStep')?.type).toBe('skillRef') // skill 槽保住
    // identifier 命中：main 更新内容
    expect(saved.slots.find(s => s.id === 'main')?.content).toBe('改过的主提示词')
    // jb：injection_position=1 → depth=5；role=user
    const jb = saved.slots.find(s => s.id === 'jb')!
    expect(jb.depth).toBe(5)
    expect(jb.role).toBe('user')
    // toggle 命中：option.content 更新 + selected = enabled（false）
    const poetic = saved.toggles[0].options.find(o => o.id === 'poetic')!
    expect(poetic.content).toBe('改成白描')
    expect(poetic.selected).toBe(false)
    expect(saved.toggles[0].options.find(o => o.id === 'plain')?.selected).toBe(false)
    // 追加新 system 槽
    const added = saved.slots.find(s => s.id === '新条目')!
    expect(added.type).toBe('system')
    expect(added.role).toBe('assistant')
    expect(added.content).toBe('追加内容')
  })

  it('name 字段匹配 marker 槽位也认（enabled 生效）', async () => {
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    const r = await presetPut(home, {
      name: '预设甲',
      prompts: [
        { identifier: 'charDescription', name: 'charDesc', role: 'system', content: '', system_prompt: false, marker: true, injection_position: 0, injection_depth: 100 },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'charDescription', enabled: false }] }],
    })
    expect(r.status).toBe(200)
    const saved = (await readJson('rp-presets/p-a/preset.json')) as unknown as RPPreset
    expect(saved.slots.find(s => s.id === 'charDesc')?.enabled).toBe(false)
  })

  it('找不到且 create=true → emptyPreset 骨架新建；找不到且无 create → 404', async () => {
    const r1 = await presetPut(home, { name: '全新预设', prompts: [], prompt_order: [], create: true })
    expect(r1.status).toBe(200)
    const newId = (r1.body as { presetId: string }).presetId
    const saved = (await readJson(`rp-presets/${newId}/preset.json`)) as unknown as RPPreset
    expect(saved.displayName).toBe('全新预设')
    expect(saved.schemaVersion).toBe(1)
    expect(saved.slots.some(s => s.id === 'main')).toBe(true) // emptyPreset 骨架起底
    expect(saved.knowledge).toEqual({ books: [], scanDepth: 2, budgetPercent: 25 })
    const r2 = await presetPut(home, { name: '不存在', prompts: [], prompt_order: [] })
    expect(r2.status).toBe(404)
  })
})

describe('门面：preset/load 扁平裸树兼容', () => {
  it('历史扁平 MVU 裸树（无保留键）→ 包成 {variables: 原树} 再写 presetId', async () => {
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    await seedJson('rp/state/sid-1.json', { 好感度: 10, 章节: 3 })
    const r = await presetLoad(home, { sessionId: 'sid-1', name: '预设甲' })
    expect(r.status).toBe(200)
    expect((r.body as { presetId: string }).presetId).toBe('p-a')
    const file = await readJson('rp/state/sid-1.json')
    expect(file.presetId).toBe('p-a')
    expect(file.variables).toEqual({ 好感度: 10, 章节: 3 })
  })

  it('保留键文件：其他键原样保留，presetId 更新', async () => {
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    await seedJson('rp/state/sid-2.json', { presetId: 'old', state: { x: 1 }, variables: { a: 1 }, tavern: { revision: 1 } })
    const r = await presetLoad(home, { sessionId: 'sid-2', name: '预设甲' })
    expect(r.status).toBe(200)
    const file = await readJson('rp/state/sid-2.json')
    expect(file.presetId).toBe('p-a')
    expect(file.state).toEqual({ x: 1 })
    expect(file.variables).toEqual({ a: 1 }) // 已有保留键 → 不包裹
    expect(file.tavern).toEqual({ revision: 1 })
  })
})

describe('门面：preset/names', () => {
  it('全部 displayName + 会话有效预设（loaded）', async () => {
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    await seedJson('rp/state/sid-1.json', { presetId: 'p-a' })
    const r = await presetNames(home, { sessionId: 'sid-1' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ names: ['预设甲'], loaded: '预设甲' })
  })
})

describe('门面：regexes 三源合并与整组替换', () => {
  it('get：global → character → preset 顺序合并，每条 _dshtScope 标记，回传 presetId/slug', async () => {
    await seedJson('rp/regex/global.json', { scripts: [script('g1', '全局')] })
    await seedJson('rp/ws-1/rp.json', { schemaVersion: 1, characterName: '云梦璃', regex: [script('c1', '角色')] })
    await seedJson('rp-presets/p-a/regex.json', { scripts: [script('p1', '预设')] })
    await seedJson('rp/state/sid-1.json', { presetId: 'p-a' })
    const r = await regexesGet(home, { slug: 'ws-1', sessionId: 'sid-1' })
    expect(r.status).toBe(200)
    const body = r.body as { regexes: Array<{ id: string; _dshtScope: string }>; presetId: string | null; slug: string | null }
    expect(body.regexes.map(x => `${x.id}:${x._dshtScope}`)).toEqual(['g1:global', 'c1:character', 'p1:preset'])
    expect(body.presetId).toBe('p-a')
    expect(body.slug).toBe('ws-1')
  })

  it('replace：global 整组写回 rp/regex/global.json（indent 1）', async () => {
    const r = await regexesReplace(home, { scope: 'global', regexes: [script('g2', '新全局')] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, count: 1 })
    const saved = await readJson('rp/regex/global.json')
    expect((saved.scripts as Array<{ id: string }>)[0].id).toBe('g2')
  })

  it('replace：character 写回 rp.json 的 regex 键（其余键保留）；preset 从 sessionId 解析', async () => {
    await seedJson('rp/ws-1/rp.json', { characterName: '云梦璃', regex: [script('c0', '旧')] })
    await seedJson('rp-presets/p-a/preset.json', testPreset())
    await seedJson('rp/state/sid-1.json', { presetId: 'p-a' })
    const r1 = await regexesReplace(home, { scope: 'character', slug: 'ws-1', regexes: [script('c9', '新角色')] })
    expect(r1.status).toBe(200)
    const rp = await readJson('rp/ws-1/rp.json')
    expect(rp.characterName).toBe('云梦璃')
    expect((rp.regex as Array<{ id: string }>)[0].id).toBe('c9')
    const r2 = await regexesReplace(home, { scope: 'preset', sessionId: 'sid-1', regexes: [script('p9', '新预设')] })
    expect(r2.status).toBe(200)
    const pr = await readJson('rp-presets/p-a/regex.json')
    expect((pr.scripts as Array<{ id: string }>)[0].id).toBe('p9')
  })
})

describe('门面：worldbook ST 形状往返', () => {
  function loreBook(): LoreBook {
    return {
      name: '测试书',
      importWarnings: [],
      entries: [{
        id: 'lore-测试书-0', comment: '地点', content: '咖啡厅', keys: ['咖啡厅'], secondaryKeys: ['店内'],
        selectiveLogic: 0, constant: true, selective: false, position: 0, depth: 4, role: 'system',
        scanDepth: null, preventRecursion: false, excludeRecursion: false, insertionOrder: 100,
        sticky: 0, cooldown: 0, delay: 0, group: '', groupOverride: false, enabled: true, book: '测试书',
      }],
    }
  }

  it('list：skills/wb-*/references/lore.json + global-books.json（lorePath 去重）', async () => {
    await seedJson('skills/wb-test/references/lore.json', loreBook())
    await seedJson('rp/global-books.json', { books: [{ name: '测试书', lorePath: 'skills/wb-test/references/lore.json' }, { name: '外部书', lorePath: 'skills/wb-other/references/lore.json' }] })
    const r = await worldbookList(home, {})
    expect(r.status).toBe(200)
    expect(r.body.books).toEqual([
      { name: '测试书', lorePath: 'skills/wb-test/references/lore.json' },
      { name: '外部书', lorePath: 'skills/wb-other/references/lore.json' },
    ])
  })

  it('get：LoreEntry → ST World Info entry 形状（key/keysecondary/order/disabled/uid）', async () => {
    await seedJson('skills/wb-test/references/lore.json', loreBook())
    const r = await worldbookGet(home, { name: '测试书' })
    expect(r.status).toBe(200)
    const entries = r.body.entries as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      uid: 0, comment: '地点', content: '咖啡厅', key: ['咖啡厅'], keysecondary: ['店内'],
      constant: true, order: 100, disabled: false, role: 'system', scanDepth: null,
    })
  })

  it('entry-put：uid 锚定原位替换 + 新 uid 追加（id 重新编号）', async () => {
    await seedJson('skills/wb-test/references/lore.json', loreBook())
    const gr = await worldbookGet(home, { name: '测试书' })
    const st0 = (gr.body.entries as Array<Record<string, unknown>>)[0]
    // uid=0 锚定：改内容与 order
    const r1 = await worldbookEntryPut(home, { name: '测试书', entry: { ...st0, content: '深夜咖啡厅', order: 200 } })
    expect(r1.status).toBe(200)
    expect(r1.body).toMatchObject({ ok: true, uid: 0, count: 1 })
    // uid=99（越界）→ 新条目追加；disabled=true 反转换 enabled=false
    const r2 = await worldbookEntryPut(home, { name: '测试书', entry: { uid: 99, comment: '人物', content: '祥子', key: ['祥子'], disabled: true } })
    expect(r2.body).toMatchObject({ ok: true, uid: 1, count: 2 })
    // 【2026-09-08 对齐】entry-put 走 250ms 写合并队列——等定时器 flush 后再断言落盘
    await new Promise(resolve => setTimeout(resolve, 350))
    const saved = (await readJson('skills/wb-test/references/lore.json')) as unknown as LoreBook
    expect(saved.entries).toHaveLength(2)
    expect(saved.entries[0]).toMatchObject({ comment: '地点', content: '深夜咖啡厅', insertionOrder: 200 })
    expect(saved.entries[1]).toMatchObject({ comment: '人物', keys: ['祥子'], enabled: false })
    expect(saved.entries[1].id).toBe('lore-测试书-1')
  })

  it('loreEntryToSt ↔ stEntryToLore 字段往返无损', () => {
    const entry = loreBook().entries[0]
    const st = loreEntryToSt(entry, 7)
    expect(st.uid).toBe(7)
    const back = stEntryToLore(st, '测试书', entry.id)
    expect(back).toEqual(entry)
  })

  // 【2026-09-10 极性回归】读面同时给出 enabled 与 disabled（镜像），写面原实现让
  // disabled 无条件压过 enabled → 卡脚本 `Object.assign({}, e, {enabled:true})` 时
  // disabled 仍是旧 true，改动被吞，条目永远停在禁用态（实机翻转→还原失败复现）。
  it('enabled 显式给出时优先于 stale disabled（极性回归）', () => {
    // 条目曾被禁用：读面形状 = { enabled:false, disabled:true }
    const st = { uid: 0, comment: '地点', content: 'x', enabled: false, disabled: true }
    expect(stEntryToLore(st, '书', 'id0').enabled).toBe(false)
    // 卡只改 enabled → true（disabled 旧值仍 true，不应压过）
    const back = stEntryToLore({ ...st, enabled: true }, '书', 'id0')
    expect(back.enabled).toBe(true)
    // 仅给 disabled（无 enabled）时回落：disabled:true → enabled:false
    const noEnabled = stEntryToLore({ uid: 0, comment: 'x', disabled: true }, '书', 'id0')
    expect(noEnabled.enabled).toBe(false)
    const noEnabled2 = stEntryToLore({ uid: 0, comment: 'x', disabled: false }, '书', 'id0')
    expect(noEnabled2.enabled).toBe(true)
  })
})

describe('门面：chat/messages 基本映射', () => {
  it('user/assistant 事件 → StMessage[]（角色名取 header.cwd 指向工作区的 characterName；坏行跳过）', async () => {
    await makeSession('sid-m', join(home, 'rp', 'ws-1'), true)
    await seedJson('rp/ws-1/rp.json', { characterName: '云梦璃' })
    const r = await chatMessages(home, { sessionId: 'sid-m' })
    expect(r.status).toBe(200)
    expect(r.body.messages).toEqual([
      { message_id: 0, name: 'User', role: 'user', message: '你好', is_system: false, seq: 1 },
      { message_id: 1, name: '云梦璃', role: 'assistant', message: '欢迎回来', is_system: false, seq: 2 },
    ])
  })

  it('无 cwd/取不到角色名 → 回落 User/Assistant；快照注入不进导出；定位不到会话 → 404', async () => {
    await makeSession('sid-n', null)
    const r = await chatMessages(home, { sessionId: 'sid-n' })
    expect(r.status).toBe(200)
    expect(r.body.messages).toEqual([
      { message_id: 0, name: 'User', role: 'user', message: '你好', is_system: false, seq: 1 },
      { message_id: 1, name: 'Assistant', role: 'assistant', message: '欢迎回来', is_system: false, seq: 2 },
    ])
    const r404 = await chatMessages(home, { sessionId: 'ghost' })
    expect(r404.status).toBe(404)
  })
})

/**
 * 门面：variables/schema 注册（TH `registerVariableSchema(schema, {type})` 契约）
 * ------------------------------------------------------------------
 * 【实机缺陷 2026-09-11】旧 shim 把 TH 的 `(schema, option)` 读成 `(name, schema)`：
 *   arg0（zod 对象）→ String() = "[object Object]"；arg1（作用域）当成 schema 存。
 * 结果 rp/state/<sid>.json 里长出 `variableSchema.properties["[object Object]"] = {type:'message'}`，
 * 卡脚本读 schema 即 "Data Error"（静默：不抛错、路由 200）。
 *
 * 权威契约：ST 扩展 JS-Slash-Runner `@types/function/variables.d.ts:203-206`
 *   registerVariableSchema(schema: z.ZodType, option: {type:'global'|'preset'|'character'|'chat'|'message'})
 * 修复后端：shim 传 `scope === 'message' ? '' : scope`（message 作用域 = 整树，无需嵌套）；
 *          门面把未知/非白名单 name 一律规整为整树，并清理历史垃圾键。
 */
describe('门面：variables/schema 注册（TH registerVariableSchema 契约）', () => {
  const SID = 'sid-sch'
  /** 读回 rp/state/<sid>.json 的 variableSchema.properties */
  async function propsOf(sid = SID): Promise<Record<string, unknown>> {
    const f = await readJson(`rp/state/${sid}.json`)
    return ((f.variableSchema as { properties?: Record<string, unknown> } | undefined)?.properties) ?? {}
  }

  it('合法作用域 → 收进 properties.<scope>，整树与 variables 不被覆盖', async () => {
    await seedJson(`rp/state/${SID}.json`, {
      variables: { 好感: 12 },
      variableSchema: { type: 'object', properties: { chat: { type: 'object' } } },
    })
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: 'global',
      variableSchema: { type: 'object', properties: { 生命: { type: 'number' } } },
    })
    expect(r.status).toBe(200)
    const props = await propsOf()
    expect(Object.keys(props).sort()).toEqual(['chat', 'global'])
    expect((props.global as { properties: { 生命: unknown } }).properties.生命).toEqual({ type: 'number' })
    const f = await readJson(`rp/state/${SID}.json`)
    expect(f.variables).toEqual({ 好感: 12 })
  })

  it('message 作用域（shim 规整为空串）→ 整树替换', async () => {
    await seedJson(`rp/state/${SID}.json`, {
      variableSchema: { type: 'object', properties: { global: { type: 'object' } } },
    })
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: '',
      variableSchema: { type: 'object', properties: { 场景: { type: 'string' } } },
    })
    expect(r.status).toBe(200)
    const f = await readJson(`rp/state/${SID}.json`)
    expect(f.variableSchema).toEqual({ type: 'object', properties: { 场景: { type: 'string' } } })
  })

  it('字面 "message" 也按整树处理（与空串同义，避免多出一个同名作用域键）', async () => {
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: 'message',
      variableSchema: { type: 'object', properties: { a: { type: 'string' } } },
    })
    expect(r.status).toBe(200)
    const f = await readJson(`rp/state/${SID}.json`)
    expect(f.variableSchema).toEqual({ type: 'object', properties: { a: { type: 'string' } } })
    expect(await propsOf()).toEqual({ a: { type: 'string' } })
  })

  it('历史垃圾键 "[object Object]" 在任意一次注册时被清理（卡脚本 Data Error 的根因）', async () => {
    await seedJson(`rp/state/${SID}.json`, {
      variableSchema: {
        type: 'object',
        properties: { '[object Object]': { type: 'message' }, chat: { type: 'object' } },
      },
    })
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: 'global', variableSchema: { type: 'object' },
    })
    expect(r.status).toBe(200)
    const props = await propsOf()
    expect(Object.prototype.hasOwnProperty.call(props, '[object Object]')).toBe(false)
    expect(Object.keys(props)).toEqual(['chat', 'global'])
  })

  it('非白名单 name（老 shim 参数错位残形）→ 规整为整树，不当作用域键', async () => {
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: '{"type":"object"}',
      variableSchema: { type: 'object', properties: { x: { type: 'string' } } },
    })
    expect(r.status).toBe(200)
    const f = await readJson(`rp/state/${SID}.json`)
    expect(f.variableSchema).toEqual({ type: 'object', properties: { x: { type: 'string' } } })
  })

  it('缺 sessionId / schema 非对象 → 400 且不落盘', async () => {
    const noSid = await variableSchemaRegister(home, { variableSchema: { type: 'object' } })
    expect(noSid.status).toBe(400)
    const badSchema = await variableSchemaRegister(home, { sessionId: SID, variableSchema: 'nope' })
    expect(badSchema.status).toBe(400)
    await expect(readJson(`rp/state/${SID}.json`)).rejects.toThrow()
  })

  /**
   * 【基准对质 2026-09-11 / L36】注册端点语义回归。
   *
   * 真 TH `registerVariableSchema` 是**纯 setter**（JS-Slash-Runner `src/function/variables.ts:10-37`：
   * 只做 `store.<scope> = schema`，**不校验既有值、不抛错、不改 HTTP 状态**）。
   * 我方曾多加一道「校验既有值 → 422 拒收」——比基准**更严**，且实测会**阻断卡脚本初始化链**
   * （卡 `inject.js:2308` 的 bootstrap 在此抛错后，紧随的 `ChatSquash()` / `MacroNest()` /
   * `syncSPresetToolRegistrations()` **不再执行** → 功能面直接缺失）。
   *
   * 判据三条，缺一不可：① **不拒收**（200）② schema **确实落下**（不能"报错就啥也没存"）
   * ③ 不匹配以 `issues` **可见**（不能修成静默失败）。
   */
  it('既有值与 schema 不匹配 → 仍 200 且落下 schema（对齐基准纯 setter；issues 仅提示）', async () => {
    await seedJson(`rp/state/${SID}.json`, { variables: { 好感: '高' } }) // 实际是字符串
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: '',
      variableSchema: { type: 'object', properties: { 好感: { type: 'number' } } }, // 要求数字
    })
    expect(r.status).toBe(200) // ← 不得 422（此处曾是 422，阻断卡初始化）
    expect(((r.body as { issues?: unknown[] }).issues ?? []).length).toBeGreaterThan(0) // ← 不静默
    const f = await readJson(`rp/state/${SID}.json`)
    expect(f.variableSchema).toEqual({ type: 'object', properties: { 好感: { type: 'number' } } }) // ← 确实落下
    expect(f.variables).toEqual({ 好感: '高' }) // ← 既有值不被改动
  })

  it('前提自检：上述数据确实构成不匹配（否则上一条是空转）', () => {
    const issues = validateSchemaSubset(
      { 好感: '高' },
      { type: 'object', properties: { 好感: { type: 'number' } } },
    )
    expect(issues.length).toBeGreaterThan(0)
  })

  it('匹配时不产生噪声：issues 不出现（避免"永远报警"退化成无信息）', async () => {
    await seedJson(`rp/state/${SID}.json`, { variables: { 好感: 12 } })
    const r = await variableSchemaRegister(home, {
      sessionId: SID, name: '',
      variableSchema: { type: 'object', properties: { 好感: { type: 'number' } } },
    })
    expect(r.status).toBe(200)
    expect((r.body as { issues?: unknown[] }).issues).toBeUndefined()
  })
})
