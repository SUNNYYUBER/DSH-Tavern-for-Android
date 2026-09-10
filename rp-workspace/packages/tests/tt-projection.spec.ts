/**
 * TT 对齐投影单测（D-3/D-4）
 * 基准：golden/st/dump-008（TT 侧 25 条 = 22 system / 2 user / 1 assistant）
 */
import { describe, it, expect } from 'vitest'
import {
  classify, textOf, projectToTtShape, PROJ_DEFAULTS,
  planSlotSections, SLOT_ORDERS,
  type ProjMessage, type ProjConfig, type SlotBatch,
} from '../src/dsht-plugin-shared/tt-projection.ts'

const msg = (role: string, text: string): ProjMessage => ({ role, content: text })

// ---- 分类 ----

describe('classify：内容分类（判据全部来自 golden 实测取证）', () => {
  it('识别 DSH 基础设施', () => {
    expect(classify(msg('system', 'You are an AI agent powered by DeepSeek Harness. foo'))).toBe('agent-manual')
    expect(classify(msg('user', '<interactive_input> A skill is a reusable set of tas'))).toBe('skill-list')
    expect(classify(msg('user', '<interactive_input> Current runtime context. This snapshot'))).toBe('runtime-ctx')
    expect(classify(msg('user', 'Current runtime context. This snapshot supersedes'))).toBe('runtime-ctx')
  })

  it('识别真实用户输入（与运行时上下文区分）', () => {
    expect(classify(msg('user', '<interactive_input> （心跳32）这是一条测试消息 </interactive_input>'))).toBe('user-input')
  })

  it('识别系统级 RP 内容（D-3 要纠正的错位项）', () => {
    expect(classify(msg('user', '你正在进行角色扮演。你扮演「ExampleGame」'))).toBe('system-level')
    expect(classify(msg('user', 'Current active worldbook entries for this roleplay scene.'))).toBe('system-level')
    expect(classify(msg('user', '【角色状态（MVU 变量树，最新优先）】 fx_wb_uid:'))).toBe('system-level')
    expect(classify(msg('user', '【剧情记忆（第 1-33 楼摘要；更早原文已折叠进本快照）】'))).toBe('system-level')
    expect(classify(msg('user', '【故事开场（已发生的剧情）】'))).toBe('system-level')
    expect(classify(msg('user', '<World_Lore_Database> foo'))).toBe('system-level')
  })

  it('识别折叠 marker（投影时丢弃）', () => {
    expect(classify(msg('user', '[旧快照副本已折叠]'))).toBe('fold-marker')
    expect(classify(msg('user', '[上下文瘦身] 第 1-33 楼原文已折叠，剧情要点见「剧情记忆」快照；以下为最近原文。'))).toBe('fold-marker')
  })

  it('识别历史楼层', () => {
    expect(classify(msg('assistant', '（mock 回复）收到，这是一条简短应答。'))).toBe('history-ai')
    expect(classify(msg('user', '<interactive_input> 上一轮用户输入 </interactive_input>'))).toBe('user-input')
  })

  it('textOf：兼容 string 与 block 数组', () => {
    expect(textOf('abc')).toBe('abc')
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(textOf(undefined)).toBe('')
    expect(textOf(123)).toBe('')
  })
})

// ---- 投影 ----

/** 构造贴近实机 payload 的样例（取自 golden/dsht/dedup-after.json 的形状） */
function realish(): ProjMessage[] {
  return [
    msg('system', 'You are an AI agent powered by DeepSeek Harness.\nThe checkout is at /x'),
    msg('user', '<interactive_input> （心跳32 影子化验证）这是一条测试消息 </interactive_input>'),
    msg('user', '[旧快照副本已折叠]'),
    msg('user', '<interactive_input> <system-reminder> A skill is a reusable set of tasks </interactive_input>'),
    msg('assistant', '（mock 回复）收到，这是一条简短应答。'),
    msg('user', '<interactive_input> （心跳32验证2）再发一条 </interactive_input>'),
    msg('user', 'Current active worldbook entries for this roleplay scene. This snapshot'),
    msg('user', '【角色状态（MVU 变量树，最新优先）】 fx_wb_uid: fx_mtrfmx2r'),
    msg('user', '你正在进行角色扮演。你扮演「ExampleGame ExampleWorld MVU Edition 0607」，用户扮演'),
    msg('user', '【剧情记忆（第 1-33 楼摘要；更早原文已折叠进本快照）】  <memory_floor 记忆#1-11>'),
    msg('user', '<interactive_input> Current runtime context. This snapshot supersedes </interactive_input>'),
  ]
}

describe('projectToTtShape：TT 形状对齐', () => {
  it('系统级内容并入 systemAppend，不再占 messages 席位', () => {
    const r = projectToTtShape(realish())
    expect(r.systemAppend).toContain('你正在进行角色扮演')
    expect(r.systemAppend).toContain('worldbook entries')
    expect(r.systemAppend).toContain('【角色状态')
    expect(r.systemAppend).toContain('【剧情记忆')
    expect(r.systemAppend).toContain('You are an AI agent powered by DeepSeek Harness')
    // 世界书 + 状态树 + 角色卡 + 剧情记忆 = 4 条系统级（agent 手册另计入 systemAppend 但不算 systemLevel）
    expect(r.stats.systemLevel).toBe(4)
  })

  it('messages 中不再残留系统级内容（role 重映射的关键断言）', () => {
    const r = projectToTtShape(realish())
    const all = r.messages.map((m) => m.content).join('\n')
    expect(all).not.toContain('你正在进行角色扮演')
    expect(all).not.toContain('worldbook entries')
    expect(all).not.toContain('【角色状态')
    expect(all).not.toContain('【剧情记忆')
  })

  it('折叠 marker 被丢弃（对模型永远是噪声）', () => {
    const r = projectToTtShape(realish())
    expect(r.stats.droppedMarkers).toBe(1)
    expect(r.messages.map((m) => m.content).join('')).not.toContain('[旧快照副本已折叠]')
    expect(r.systemAppend).not.toContain('[旧快照副本已折叠]')
  })

  it('D-4：用户输入提前到历史之前', () => {
    const r = projectToTtShape(realish())
    const roleOf = (pred: (c: string) => boolean) => r.messages.find((m) => pred(m.content))?.role
    // 本轮用户输入（最后一条 interactive_input 且非 runtime/skill）应早于历史 AI 回复
    const aiIdx = r.messages.findIndex((m) => m.content.includes('这是一条简短应答'))
    const inputIdx = r.messages.findIndex((m) => m.content.includes('心跳32验证2'))
    expect(inputIdx).toBeGreaterThanOrEqual(0)
    expect(aiIdx).toBeGreaterThanOrEqual(0)
    expect(inputIdx).toBeLessThan(aiIdx)
    expect(roleOf((c) => c.includes('心跳32验证2'))).toBe('user')
  })

  it('尾部追加 assistant 收尾（TT 第 24 位语义）', () => {
    const r = projectToTtShape(realish())
    expect(r.messages[r.messages.length - 1].role).toBe('assistant')
    expect(r.messages[r.messages.length - 1].content).toBe(PROJ_DEFAULTS.trailingText)
  })

  it('保序：系统级内容在 systemAppend 内维持原始相对顺序', () => {
    const r = projectToTtShape(realish())
    const iCard = r.systemAppend.indexOf('你正在进行角色扮演')
    const iBook = r.systemAppend.indexOf('worldbook entries')
    const iState = r.systemAppend.indexOf('【角色状态')
    const iMem = r.systemAppend.indexOf('【剧情记忆')
    // 原始顺序：worldbook → 状态树 → 角色卡 → 记忆
    expect(iBook).toBeLessThan(iState)
    expect(iState).toBeLessThan(iCard)
    expect(iCard).toBeLessThan(iMem)
  })

  it('关开关时原样透传（不丢内容、不重映射）', () => {
    const cfg: ProjConfig = { ...PROJ_DEFAULTS, enabled: false }
    const r = projectToTtShape(realish(), cfg)
    expect(r.systemAppend).toBe('')
    expect(r.messages).toHaveLength(realish().length)
    expect(r.messages[0].role).toBe('user') // agent-manual 在透传下按非 assistant 处理
    expect(r.messages[4].role).toBe('assistant')
  })

  it('systemSlot=false → 降级：不搬槽位但仍丢 marker', () => {
    const cfg: ProjConfig = { ...PROJ_DEFAULTS, systemSlot: false }
    const r = projectToTtShape(realish(), cfg)
    expect(r.systemAppend).toBe('')
    expect(r.messages.map((m) => m.content).join('')).not.toContain('[旧快照副本已折叠]')
    expect(r.messages.map((m) => m.content).join('')).toContain('你正在进行角色扮演')
    expect(r.stats.droppedMarkers).toBe(1)
  })

  it('trailingAssistant=false → 不追加收尾', () => {
    const cfg: ProjConfig = { ...PROJ_DEFAULTS, trailingAssistant: false }
    const r = projectToTtShape(realish(), cfg)
    expect(r.messages[r.messages.length - 1].content).not.toBe(PROJ_DEFAULTS.trailingText)
  })

  it('空输入不崩', () => {
    const r = projectToTtShape([])
    expect(r.messages).toHaveLength(0)
    expect(r.systemAppend).toBe('')
  })

  it('仅系统级内容 → messages 只剩收尾（不会产出非法空数组）', () => {
    const only = [msg('user', '你正在进行角色扮演。你扮演「X」')]
    const cfg: ProjConfig = { ...PROJ_DEFAULTS, trailingAssistant: false }
    const r = projectToTtShape(only, cfg)
    expect(r.messages).toHaveLength(0)
    expect(r.systemAppend).toContain('你正在进行角色扮演')
  })

  it('幂等性：对已投影结果再投影不破坏形状', () => {
    const once = projectToTtShape(realish())
    const again = projectToTtShape(once.messages)
    expect(again.messages.length).toBeGreaterThan(0)
    expect(again.messages.every((m) => ['system', 'user', 'assistant'].includes(m.role))).toBe(true)
  })
})

// ---- D-3：system 槽位路由（planSlotSections）----

describe('planSlotSections：system 槽位编排（D-3 唯一合法通道）', () => {
  const ident = (t: string): string => t
  const sec = (name: string, order: number, text: string) => ({ name, order, text })

  it('按 order 升序排列（同 TT 的语义拼接序）', () => {
    const batch: SlotBatch = {
      sections: [
        sec('c', SLOT_ORDERS.stateTree, '状态树'),
        sec('a', SLOT_ORDERS.characterCard, '角色卡'),
        sec('b', SLOT_ORDERS.worldbook, '世界书'),
      ],
    }
    const out = planSlotSections(batch, ident)
    expect(out.map(s => s.name)).toEqual(['a', 'b', 'c'])
  })

  it('order 相同则保持登记序（稳定排序）', () => {
    const batch: SlotBatch = {
      sections: [
        sec('x1', 50, '第一个'),
        sec('x2', 50, '第二个'),
        sec('x3', 50, '第三个'),
      ],
    }
    expect(planSlotSections(batch, ident).map(s => s.name)).toEqual(['x1', 'x2', 'x3'])
  })

  it('丢弃空文本与纯空白（不产出空 section）', () => {
    const batch: SlotBatch = {
      sections: [
        sec('empty', 20, ''),
        sec('blank', 21, '   \n\t  '),
        sec('real', 22, '有内容'),
      ],
    }
    expect(planSlotSections(batch, ident).map(s => s.name)).toEqual(['real'])
  })

  it('对每条 section 施加中性化（renderPrompt 严格插值遇未知 {{var}} 会 throw）', () => {
    const neutralize = (t: string): string => t.replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝')
    const batch: SlotBatch = { sections: [sec('a', 20, '含 {{user}} 宏')] }
    const out = planSlotSections(batch, neutralize)
    expect(out[0].text).not.toContain('{{')
    expect(out[0].text).toContain('｛｛user｝｝')
  })

  it('中性化后变空 → 仍被丢弃（trim 后再判空）', () => {
    const neutralize = () => '   '
    const batch: SlotBatch = { sections: [sec('a', 20, '内容')] }
    expect(planSlotSections(batch, neutralize)).toHaveLength(0)
  })

  it('空批次不崩', () => {
    expect(planSlotSections({ sections: [] }, ident)).toEqual([])
  })

  it('SLOT_ORDERS 严格递增，保证语义序不被破坏', () => {
    const v = Object.values(SLOT_ORDERS)
    const sorted = [...v].sort((a, b) => a - b)
    expect(v.length).toBeGreaterThan(0)
    // 全部落在 persona(0) 之后、工具指引(100) 之前
    expect(Math.min(...v)).toBeGreaterThan(0)
    expect(Math.max(...v)).toBeLessThan(100)
    // 语义序稳定：排序结果与声明序一致
    expect([...new Set(v)]).toEqual(sorted)
  })

  it('与 TT 基准的 22 条 system 语义序一致（角色卡→世界书→记忆→状态树）', () => {
    expect(SLOT_ORDERS.characterCard).toBeLessThan(SLOT_ORDERS.worldbook)
    expect(SLOT_ORDERS.worldbook).toBeLessThan(SLOT_ORDERS.memory)
    expect(SLOT_ORDERS.memory).toBeLessThan(SLOT_ORDERS.storyMemory)
    expect(SLOT_ORDERS.storyMemory).toBeLessThan(SLOT_ORDERS.stateTree)
    expect(SLOT_ORDERS.stateTree).toBeLessThan(SLOT_ORDERS.preset)
  })
})
