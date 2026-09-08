import { describe, it, expect } from 'vitest'
import { emptyPreset, compileSlots } from '../src/preset/schema.ts'
import { assemble, type AssemblyMessage, type CharacterFields } from '../src/assembly/pipeline.ts'
import { triggerWorldInfo } from '../src/lore/trigger.ts'
import { WI_POSITION, type LoreEntry } from '../src/lore/entry.ts'

function charFields(over: Partial<CharacterFields> = {}): CharacterFields {
  return {
    name: '丰川祥子',
    description: '丰川祥子的角色描述。',
    personality: '认真，温柔。',
    scenario: '在咖啡厅的偶遇。',
    personaDescription: '旅行者是路过的乐手。',
    ...over,
  }
}

function history(n: number): AssemblyMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `消息 ${i}：${'内容'.repeat(3)}`,
  }))
}

describe('compileSlots', () => {
  it('toggles 选一展开（选中项注入、其余丢弃）', () => {
    const p = emptyPreset('t', 'T')
    p.toggles = [{
      group: 'writingStyle', label: '文风',
      options: [
        { id: 'realistic', label: '真实感', content: '写实风格指令', selected: true },
        { id: 'lightnovel', label: '轻小说', content: '轻小说风格指令' },
      ],
    }]
    const slots = compileSlots(p)
    const toggleSlot = slots.find(s => s.id === 'toggle-writingStyle')
    expect(toggleSlot?.content).toBe('写实风格指令')
    expect(slots.filter(s => s.source.startsWith('toggle:'))).toHaveLength(1)
  })
  it('缺省选中第一个选项（选一兜底）', () => {
    const p = emptyPreset('t', 'T')
    p.toggles = [{
      group: 'pov', label: '人称',
      options: [{ id: 'first', label: '第一', content: '第一人称' }, { id: 'third', label: '第三', content: '第三人称' }],
    }]
    const slots = compileSlots(p)
    expect(slots.find(s => s.id === 'toggle-pov')?.content).toBe('第一人称')
  })
})

describe('assemble（组装管线端到端）', () => {
  it('场景 A 直答走查：预设骨架 + 世界书 + 历史（计划 §3.3）', () => {
    const preset = emptyPreset('demo', '直答演示')
    preset.slots.find(s => s.id === 'main')!.content = '你是角色扮演引擎。'
    const slots = compileSlots(preset)

    const lore: LoreEntry[] = [{
      id: 'loc', comment: '咖啡厅', content: '咖啡厅位于商店街尽头。',
      keys: ['咖啡厅'], secondaryKeys: [], selectiveLogic: 0, constant: false, selective: false,
      position: WI_POSITION.BEFORE, depth: 4, role: 'system', scanDepth: null,
      preventRecursion: false, excludeRecursion: false, insertionOrder: 100,
      enabled: true, book: 'demo',
    }]
    const wi = triggerWorldInfo(lore, ['我推门走进咖啡厅'], { matchWholeWords: false })

    const state = { stat_data: { 当前时间: '傍晚' } }
    const r = assemble(
      slots, charFields(), wi.activated, history(4), state,
      [], // 无正则
      { user: '旅行者', char: '丰川祥子', stableSeed: 's1', getState: p => state },
      { maxContextTokens: 8000, reserveReplyTokens: 1024 },
    )

    // 头部：main → worldBefore（含激活条目）→ charDesc…顺序即槽位序
    const contents = r.messages.map(m => m.content)
    const mainAt = contents.findIndex(c => c.includes('角色扮演引擎'))
    const wiAt = contents.findIndex(c => c.includes('商店街尽头'))
    const descAt = contents.findIndex(c => c.includes('角色描述'))
    expect(mainAt).toBeGreaterThanOrEqual(0)
    expect(wiAt).toBeGreaterThan(mainAt)
    expect(descAt).toBeGreaterThan(wiAt)

    // 历史保留 4 条
    expect(r.messages.filter(m => m.content.startsWith('消息')).length).toBe(4)

    // trace 完整
    expect(r.trace.activatedEntries[0].comment).toBe('咖啡厅')
    expect(r.trace.tokenEstimate.droppedMessages).toBe(0)
  })

  it('深度注入：depth=2 插到倒数第 2 条历史前', () => {
    const preset = emptyPreset('demo', '演示')
    const jb = preset.slots.find(s => s.id === 'jb')!
    jb.content = 'JB深度指令'
    const slots = compileSlots(preset)
    const hist = history(4)

    const r = assemble(
      slots, charFields(), [], hist, {}, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: () => undefined },
      { maxContextTokens: 8000, reserveReplyTokens: 512 },
    )
    const jbIdx = r.messages.findIndex(m => m.content === 'JB深度指令')
    // depth 2 = 从尾部往前 2 → 在 hist[2]（倒数第2条）之前
    expect(jbIdx).toBe(r.messages.length - 3)
  })

  it('预算裁剪：超限从最旧历史开始丢', () => {
    const preset = emptyPreset('demo', '演示')
    const slots = compileSlots(preset)
    // 每条历史 ~250 tokens，40 条 = 10000 tokens
    const hist = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `消息 ${i}：${'长内容'.repeat(200)}`,
    }))

    const r = assemble(
      slots, charFields(), [], hist, {}, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: () => undefined },
      { maxContextTokens: 3000, reserveReplyTokens: 500 }, // 紧预算：只够 ~2500 tokens
    )
    expect(r.trace.tokenEstimate.droppedMessages).toBeGreaterThan(0)
    // 最新的历史必须保留（从旧往新丢）
    const contents = r.messages.map(m => m.content)
    expect(contents.some(c => c.startsWith('消息 39：'))).toBe(true)
    expect(contents.some(c => c.startsWith('消息 0：'))).toBe(false)
  })

  it('系统备注（isSystemNote）不进 prompt（§4.15）', () => {
    const preset = emptyPreset('demo', '演示')
    const slots = compileSlots(preset)
    const hist: AssemblyMessage[] = [
      ...history(2),
      { role: 'system', content: '用户的私人备注', isSystemNote: true },
    ]
    const r = assemble(
      slots, charFields(), [], hist, {}, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: () => undefined },
      { maxContextTokens: 8000, reserveReplyTokens: 512 },
    )
    expect(r.messages.map(m => m.content)).not.toContain('用户的私人备注')
  })

  it('配置摘要注入（§4.3：模型无需自查配置）', () => {
    const preset = emptyPreset('demo', '演示')
    const slots = compileSlots(preset)
    const r = assemble(
      slots, charFields(), [], history(2), {}, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: () => undefined },
      { maxContextTokens: 8000, reserveReplyTokens: 512 },
    )
    const cs = r.messages.find(m => m.content.includes('<RPConfig>'))
    expect(cs).toBeDefined()
    expect(cs!.content).toContain('注入槽位数')
  })

  it('状态摘要：小 state 全量注入、宏可读', () => {
    const preset = emptyPreset('demo', '演示')
    const slots = compileSlots(preset)
    const state = { stat_data: { 当前时间: '傍晚' } }
    const r = assemble(
      slots, charFields(), [], history(1), state, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: p => state },
      { maxContextTokens: 8000, reserveReplyTokens: 512 },
    )
    const st = r.messages.find(m => m.content.includes('<State>'))
    expect(st!.content).toContain('当前时间')
  })
})
