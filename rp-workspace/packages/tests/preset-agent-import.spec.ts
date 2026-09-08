/**
 * T3.3 重 agent 场景预设适配：ST agent 预设导入的三档归位（规则层可测 + 真实样本冒烟）
 *
 * 三档归位（仅 path 判定为 agent 的 ST 预设；oneshot 主预设零影响）：
 * - 档①配置自查（输出前自查/检查格式/rules check/SPreset配置 类）→ 不进 slots，
 *   内容折叠进 configSummary 槽的补充文本（RPPreset.configSummaryExtra，
 *   compileSlots 展开 configSummary 槽时拼接，组装层确定性摘要之后追加注入）
 * - 档②内心 OS/思维链（内心/思维/think/OS 类）→ skillRef 槽（只留引用提示）+
 *   RPPreset.pendingSkills（/preset/import-st 落盘 $DSH_HOME/skills/<slug>/SKILL.md）
 * - 档③subagent 编排（planner/writer/reviewer/角色分工 类）→ 不展开常规槽，
 *   登记 RPPreset.subagentHints（仅 T3.3 重 agent 路径消费，编译期忽略）
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { compileSlots } from '../src/preset/schema.ts'
import { assemble, type AssemblyMessage, type CharacterFields } from '../src/assembly/pipeline.ts'
import {
  classifyStAgentEntry,
  detectAgentComposition,
  importStPreset,
  pendingSkillDir,
  renderPendingSkillMd,
  sanitizeSkillName,
} from '../src/preset/st-import.ts'

/** 组装管线最小输入（对照 assembly.spec.ts 同款） */
const charFields = (): CharacterFields => ({
  name: '丰川祥子', description: '角色描述', personality: '认真', scenario: '咖啡厅', personaDescription: '旅人',
})
const history = (n: number): AssemblyMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `消息 ${i}` }))

describe('T3.3 三档归位判定（classifyStAgentEntry 单元：名称为主、内容为辅、优先级 config>subagent>innerOs）', () => {
  it('档①配置自查：名称关键词表（自查/检查格式/输出前确认/rules check/配置块命名）', () => {
    expect(classifyStAgentEntry({ name: '输出前自查', content: '随便什么' })).toBe('config')
    expect(classifyStAgentEntry({ name: '格式自检块', content: '' })).toBe('config')
    expect(classifyStAgentEntry({ name: '输出前确认清单', content: '' })).toBe('config')
    expect(classifyStAgentEntry({ name: 'rules check', content: '' })).toBe('config')
    expect(classifyStAgentEntry({ name: 'SPreset配置', content: '{"squash":true}' })).toBe('config')
    // identifier 命中同样算（关键词表打在 名称+identifier 拼接面上）
    expect(classifyStAgentEntry({ identifier: 'self-check-main', name: '某条目' })).toBe('config')
  })

  it('档①配置自查：内容侧仅对短条目生效（自查规则是紧凑指令；大块内容是正文/配置 JSON）', () => {
    // 真实样本形态：思考强度条目正文 {{setvar::think3::…定稿前必须自查…}}——拆宏后命中
    expect(classifyStAgentEntry({ name: '思考强度', content: '{{setvar::think3::定稿前必须自查：是否覆盖全部必查项}}' })).toBe('config')
    // 裸文本短条目命中
    expect(classifyStAgentEntry({ name: '普通条目', content: '定稿前必须自查格式' })).toBe('config')
    // 超长内容不收（自查关键词淹没在大块正文里，误收会污染配置摘要）
    expect(classifyStAgentEntry({ name: '长文条目', content: `${'x'.repeat(4100)}自查` })).toBeNull()
  })

  it('档②内心 OS/思维链：名称关键词（内心/思维/think/OS，ASCII 词带边界）；裸「内心」内容不收', () => {
    expect(classifyStAgentEntry({ name: '💭👤内心OS(只角色)(选一)', content: '' })).toBe('innerOs')
    expect(classifyStAgentEntry({ name: '🦊思维链（示例预设上班咯……）', content: '' })).toBe('innerOs')
    expect(classifyStAgentEntry({ name: '--直出输出(顶think标签)', content: '' })).toBe('innerOs')
    // ASCII 词边界：Boss/Cost/glossary 里的 os 不命中
    expect(classifyStAgentEntry({ name: 'Boss条目', content: '' })).toBeNull()
    expect(classifyStAgentEntry({ name: 'Cost条目', content: '' })).toBeNull()
    expect(classifyStAgentEntry({ name: 'glossary条目', content: '' })).toBeNull()
    // 真实样本防误伤锚点：文风/人称条目正文普遍提及「内心」，裸词内容不收
    expect(classifyStAgentEntry({ name: '📝文风|真实感', content: '描写人物的内心活动' })).toBeNull()
    // 内容强特征短语（思维链/内心OS 复合词）短条目才收
    expect(classifyStAgentEntry({ name: '导演手册', content: '按思维链顺序推进：先盘局面再落笔' })).toBe('innerOs')
    expect(classifyStAgentEntry({ name: '导演手册', content: `${'x'.repeat(4100)}思维链` })).toBeNull()
  })

  it('档③subagent 编排：名称命中即收；内容需同一长文 ≥2 次（破限伪代码偶现单词不算）', () => {
    expect(classifyStAgentEntry({ name: '剧情分工·planner', content: '' })).toBe('subagent')
    expect(classifyStAgentEntry({ name: '子代理编排', content: '' })).toBe('subagent')
    expect(classifyStAgentEntry({ name: '总纲', content: 'plot-planner 出大纲，writer 写正文，reviewer 审校' })).toBe('subagent')
    expect(classifyStAgentEntry({ name: '破限', content: 'the writer wrote once' })).toBeNull()
  })

  it('优先级：配置自查 > subagent 编排 > 内心 OS（语义越具体越先判）', () => {
    expect(classifyStAgentEntry({ name: '输出前自查', content: 'planner writer reviewer' })).toBe('config')
    expect(classifyStAgentEntry({ name: '内心OS与planner分工', content: '' })).toBe('subagent')
  })

  it('skill 名净化与目录：槽 id 净化保单行；目录稳定且不同名不同目录', () => {
    expect(sanitizeSkillName('💭👤内心OS(只角色)(选一)')).toBe('💭👤内心OS(只角色)(选一)')
    expect(sanitizeSkillName('带\n换行\t和  空格')).toBe('带 换行 和 空格')
    expect(sanitizeSkillName('')).toMatch(/^skill-[a-z0-9]+$/)
    const d1 = pendingSkillDir('💭👤内心OS(只角色)(选一)')
    expect(d1).toMatch(/^skills\/[a-z0-9][a-z0-9-]*$/)
    expect(pendingSkillDir('💭👤内心OS(只角色)(选一)')).toBe(d1)
    expect(pendingSkillDir('🦊思维链（示例预设上班咯……）')).not.toBe(d1)
    const md = renderPendingSkillMd('[Agent] 测试', { name: '💭👤内心OS(只角色)', content: '规则正文' })
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('name: "💭👤内心OS(只角色)"')
    expect(md).toContain('规则正文')
  })
})

describe('T3.3 agent 编排型判定（detectAgentComposition：名字标注/编排特征/模块化引用密度）', () => {
  it('[Agent]/[代理] 名字标注与 subagent 内容特征维持既有判定（isAgentPreset 对齐）', () => {
    expect(detectAgentComposition('[Agent] V14.7 示例预设', [])).toBe(true)
    expect(detectAgentComposition('测试 [代理] 预设', [])).toBe(true)
    expect(detectAgentComposition('无标注预设', [{ name: '编排', content: '调用 subagent 分别生成各角色台词' }])).toBe(true)
  })

  it('内容特征密度不单独翻 path（既有契约：同一份内容按 [Agent]/[主预设] 名字分路）', () => {
    // 真实裁剪件标定：[Agent] V14.7 的模块化规则引用（<能力>/references/<规则>.md）+
    // 满屏内心OS 条目，在 [主预设] 名字下必须维持 direct——引用路径密度只作三档归位素材，
    // 不是 path 判定特征（防误伤 ST oneshot 主预设，tavern-macros.spec 既有断言）
    const agentFlavored = [
      { name: '防文风', content: '读取 example-style-rules/references/文风控制/防文风.md' },
      { name: '要文风', content: '读取 example-style-rules/references/文风控制/要文风.md' },
      { name: '💭👤内心OS(只角色)', content: '内心 OS 规则' },
    ]
    expect(detectAgentComposition('[Agent] V14.7 示例预设', agentFlavored)).toBe(true)
    expect(detectAgentComposition('[主预设] V17.1 示例预设', agentFlavored)).toBe(false)
  })

  it('subagent 编排关键词：名称命中即判；内容 ≥2 次判；单次出现不判', () => {
    expect(detectAgentComposition('无标注预设', [{ name: '剧情分工·planner', content: '' }])).toBe(true)
    expect(detectAgentComposition('无标注预设', [{ name: '总纲', content: 'plot-planner 出大纲，writer 写正文，reviewer 审校' }])).toBe(true)
    expect(detectAgentComposition('无标注预设', [{ name: '破限', content: 'the writer wrote once' }])).toBe(false)
  })

  it('oneshot 主预设形态保护：满屏内心OS/思维链条目 + 配置块，无 agent 特征不判 agent', () => {
    // 真实样本标定：[主预设] V17.1 示例预设（17 个内心OS/思维链名条目 + SPreset配置）→ direct
    const prompts = Array.from({ length: 17 }, (_, i) => ({ name: `💭👤内心OS变体${i}`, content: `内心 OS 规则 ${i}` }))
    prompts.push({ name: 'SPreset配置', content: '{"a":1}' })
    expect(detectAgentComposition('[主预设] V17.1 示例预设', prompts)).toBe(false)
  })
})

describe('T3.3 三档归位导入端到端（[Agent] 构造样本 → slots/toggles/三字段归位）', () => {
  /** 示例预设 [Agent] 形态的最小复刻：常规条目 + 三档条目 + marker + 空内容占位条目 */
  const agentJson = JSON.stringify({
    temperature: 1,
    prompts: [
      { identifier: 'main', name: '主指令', role: 'system', content: '你是编排引擎，负责调度各环节。', marker: false },
      { identifier: 'cfg1', name: '输出前自查', role: 'system', content: '定稿前必须自查：格式、人称、剧情连续性', marker: false },
      { identifier: 'cfg2', name: 'SPreset配置', role: 'system', content: '{"squash":true,"regex":false}', marker: false },
      { identifier: 'os1', name: '💭👤内心OS(只角色)(选一)', role: 'system', content: '{{setvar::extra3:: ## 小九九穿插规则 本轮正文必须输出 NPC 小九九，用 * 包裹。}}', marker: false },
      { identifier: 'os2', name: '🦊思维链（示例预设上班咯……）', role: 'system', content: '在正文之前用思考标签输出一次内心 OS，禁止跳过。', marker: false },
      // 名字 > 30 字（避开 R3 组头判定：内容为空且短名的条目算组头），走 innerOs 空正文分支
      { identifier: 'osEmpty', name: '🧪思维链（小说模式）（这条占位开关条目名足够长，避开组头判定规则）', role: 'system', content: '', marker: false },
      { identifier: 'sa1', name: '剧情分工·planner', role: 'system', content: 'plot-planner 负责大纲与节奏拆分。', marker: false },
      { identifier: 'sty', name: '📝文风|真实感', role: 'system', content: '写实细腻的文风要求。', marker: false },
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'main', enabled: true },
      { identifier: 'cfg1', enabled: true },
      { identifier: 'cfg2', enabled: false },
      { identifier: 'os1', enabled: true },
      { identifier: 'os2', enabled: false },
      { identifier: 'osEmpty', enabled: true },
      { identifier: 'sa1', enabled: true },
      { identifier: 'sty', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ] }],
  })

  it('path 判 agent；档①配置自查不进 slots，折叠进 configSummaryExtra 并补插 configSummary 槽', () => {
    const { preset, skipped } = importStPreset(agentJson, '[Agent] 测试预设')
    expect(preset.path).toBe('agent')
    expect(preset.configSummaryExtra).toBe('定稿前必须自查：格式、人称、剧情连续性\n\n{"squash":true,"regex":false}')
    // 归位条目不进 slots（首个归位条目处补插的 configSummary 槽除外）
    expect(preset.slots.some(s => s.content === '定稿前必须自查：格式、人称、剧情连续性')).toBe(false)
    expect(preset.slots.some(s => s.content === '{"squash":true,"regex":false}')).toBe(false)
    expect(preset.slots.filter(s => s.type === 'configSummary')).toHaveLength(1)
    // 空内容占位条目（无正文可迁移）计入 skipped
    expect(skipped).toBe(1)
  })

  it('档②内心 OS/思维链 → skillRef 槽（引用提示 + skill 名）+ pendingSkills（拆宏正文入库）', () => {
    const { preset } = importStPreset(agentJson, '[Agent] 测试预设')
    const pending = preset.pendingSkills ?? []
    expect(pending).toHaveLength(2)
    expect(pending[0].name).toBe('💭👤内心OS(只角色)(选一)')
    expect(pending[0].content).toBe('## 小九九穿插规则 本轮正文必须输出 NPC 小九九，用 * 包裹。')
    expect(pending[1].name).toBe('🦊思维链（示例预设上班咯……）')
    expect(pending[1].content).toContain('禁止跳过')
    // skillRef 槽只留引用提示，正文不再平铺；skill 名与 pendingSkills 对得上
    const skillNames = new Set(pending.map(p => p.name))
    const refSlots = preset.slots.filter(s => s.type === 'skillRef')
    expect(refSlots).toHaveLength(2)
    for (const s of refSlots) {
      expect(skillNames.has(s.skill ?? '')).toBe(true)
      expect(s.content).toContain('skill')
      expect(s.content).not.toContain('小九九穿插规则')
    }
    // ST enabled → skillRef 槽开关（os2 停用；skill 本体仍在库——开关只控制引用）
    expect(refSlots.find(s => s.skill === '💭👤内心OS(只角色)(选一)')?.enabled).toBe(true)
    expect(refSlots.find(s => s.skill === '🦊思维链（示例预设上班咯……）')?.enabled).toBe(false)
  })

  it('档③subagent 编排 → 不展开常规槽，登记 subagentHints；常规条目/toggles 不受影响', () => {
    const { preset } = importStPreset(agentJson, '[Agent] 测试预设')
    expect(preset.subagentHints).toEqual(['剧情分工·planner'])
    expect(preset.slots.some(s => s.content === 'plot-planner 负责大纲与节奏拆分。')).toBe(false)
    // 常规条目照常平铺 + 进 toggles（无组头 → 「未分组」兜底组）
    expect(preset.slots.some(s => s.content === '写实细腻的文风要求。')).toBe(true)
    const allOptions = preset.toggles.flatMap(g => g.options)
    expect(allOptions.map(o => o.label).sort()).toEqual(['主指令', '📝文风|真实感'])
    // 归位条目不进任何 toggle option
    expect(allOptions.some(o => o.label.includes('内心OS') || o.label.includes('自查') || o.label.includes('planner'))).toBe(false)
  })

  it('消费链：compileSlots 展开 configSummary 槽拼进补充文本；组装层确定性摘要后追加注入', () => {
    const { preset } = importStPreset(agentJson, '[Agent] 测试预设')
    const compiled = compileSlots(preset)
    const cs = compiled.find(c => c.type === 'configSummary')!
    expect(cs.content).toBe(preset.configSummaryExtra)
    const r = assemble(
      compiled, charFields(), [], history(1), {}, [],
      { user: 'u', char: 'c', stableSeed: 's', getState: () => undefined },
      { maxContextTokens: 8000, reserveReplyTokens: 512 },
    )
    const msg = r.messages.find(m => m.content.includes('<RPConfig>'))
    expect(msg).toBeDefined()
    expect(msg!.content).toContain('定稿前必须自查：格式、人称、剧情连续性')
    expect(msg!.content).toContain('{"squash":true,"regex":false}')
    expect(msg!.content.indexOf('<RPConfig>')).toBeLessThan(msg!.content.indexOf('定稿前必须自查'))
  })
})

describe('T3.3 非 agent 预设零影响（oneshot 直出预设不做归位）', () => {
  it('普通预设：无三字段、条目照常平铺', () => {
    const plain = importStPreset(JSON.stringify({
      prompts: [
        { identifier: 'a', name: '条目甲', role: 'system', content: '内容甲', marker: false },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
    }), '普通预设')
    expect(plain.preset.path).toBe('direct')
    expect(plain.preset.configSummaryExtra).toBeUndefined()
    expect(plain.preset.pendingSkills).toBeUndefined()
    expect(plain.preset.subagentHints).toBeUndefined()
    expect(plain.preset.slots.some(s => s.content === '内容甲' && s.type === 'system')).toBe(true)
  })

  it('OS 密集的 [主预设] 形态（无 agent 特征）：满屏内心OS/思维链/配置条目照常平铺、零归位', () => {
    const prompts = [
      { identifier: 'cfg', name: 'SPreset配置', role: 'system', content: '{"a":1}', marker: false },
      { identifier: 'chk', name: '输出前自查', role: 'system', content: '定稿前必须自查格式', marker: false },
      ...Array.from({ length: 17 }, (_, i) => ({
        identifier: `os${i}`, name: `💭👤内心OS(变体${i})`, role: 'system', content: `内心 OS 规则 ${i}`, marker: false,
      })),
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
    ]
    const oneshot = importStPreset(JSON.stringify({
      prompts,
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'cfg', enabled: true }, { identifier: 'chk', enabled: true },
        ...prompts.filter(p => p.identifier.startsWith('os')).map(p => ({ identifier: p.identifier, enabled: true })),
        { identifier: 'chatHistory', enabled: true },
      ] }],
    }), '[主预设] V17.1 示例预设')
    expect(oneshot.preset.path).toBe('direct')
    expect(oneshot.preset.configSummaryExtra).toBeUndefined()
    expect(oneshot.preset.pendingSkills).toBeUndefined()
    expect(oneshot.preset.subagentHints).toBeUndefined()
    expect(oneshot.preset.slots.some(s => s.type === 'skillRef' || s.type === 'configSummary')).toBe(false)
    // 归位类条目原样平铺（直接进 prompt 的 ST 直出语义）
    expect(oneshot.preset.slots.some(s => s.content === '定稿前必须自查格式')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 真实样本冒烟（V8.8 本地不存在，用同族的 [Agent] V14.7 / [主预设] V17.1 标定）：
// 样本可读才跑，读不到 skip（it.skipIf）——样本路径为 ST 安装侧参考目录
// ---------------------------------------------------------------------------
const SAMPLE_DIR = 'D:/SillyTavern-1.16.0/SillyTavern（now using）/SillyTavern-1.16.0/.a Agent RolePlay Project/bridge-agent-workspace/sillytavern0001/_pipeline/imports/_reference/_misc'
const AGENT_SAMPLE = `${SAMPLE_DIR}/[Agent] V14.7 示例预设 · 示例角色.json`
const ONESHOT_SAMPLE = `${SAMPLE_DIR}/[主预设] V17.1 示例预设 · 示例角色.json`
const samplesReadable = existsSync(AGENT_SAMPLE) && existsSync(ONESHOT_SAMPLE)

describe('T3.3 真实样本冒烟（示例预设 V14.7/V17.1，本地可读才跑）', () => {
  it.skipIf(!samplesReadable)('[Agent] V14.7（TT agent 模式）三档归位导入可用', () => {
    const { preset, skipped } = importStPreset(readFileSync(AGENT_SAMPLE, 'utf8'), '[Agent] V14.7 示例预设 · 示例角色')
    expect(preset.path).toBe('agent')
    // 档②：内心 OS/思维链条目成批转 pendingSkills（真实样本 20+ 条），skillRef 引用对得上
    const pending = preset.pendingSkills ?? []
    expect(pending.length).toBeGreaterThanOrEqual(20)
    for (const ps of pending) {
      expect(ps.name.length).toBeGreaterThan(0)
      expect(ps.content.length).toBeGreaterThan(0)
      expect(ps.name).not.toMatch(/[\r\n]/)
    }
    const skillNames = new Set(pending.map(p => p.name))
    for (const s of preset.slots.filter(s => s.type === 'skillRef')) {
      expect(skillNames.has(s.skill ?? '')).toBe(true)
    }
    // 档①：配置自查折叠进 configSummary 补充文本（真实样本：思考强度自查条目）
    expect(typeof preset.configSummaryExtra).toBe('string')
    expect(preset.configSummaryExtra!.length).toBeGreaterThan(0)
    expect(preset.slots.filter(s => s.type === 'configSummary')).toHaveLength(1)
    const compiled = compileSlots(preset)
    expect(compiled.find(c => c.type === 'configSummary')!.content).toBe(preset.configSummaryExtra)
    // 常规条目照常平铺（真实样本 170+ 条常规槽，文风/NSFW 等不被误收）
    expect(preset.slots.length).toBeGreaterThan(150)
    // 档③：V14.7 无编排条目 → 不产 hints（字段缺省）
    expect(preset.subagentHints).toBeUndefined()
    // 空内容占位条目（思维链（小说模式）等）计入 skipped
    expect(skipped).toBeGreaterThanOrEqual(1)
  })

  it.skipIf(!samplesReadable)('[主预设] V17.1（ST oneshot）零归位、平铺不变', () => {
    const { preset } = importStPreset(readFileSync(ONESHOT_SAMPLE, 'utf8'), '[主预设] V17.1 示例预设 · 示例角色')
    expect(preset.path).toBe('direct')
    expect(preset.configSummaryExtra).toBeUndefined()
    expect(preset.pendingSkills).toBeUndefined()
    expect(preset.subagentHints).toBeUndefined()
    expect(preset.slots.some(s => s.type === 'skillRef' || s.type === 'configSummary')).toBe(false)
    expect(preset.toggles.length).toBeGreaterThan(0)
    expect(preset.slots.length).toBeGreaterThan(150)
  })
})
