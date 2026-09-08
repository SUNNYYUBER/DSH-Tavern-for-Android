import { describe, expect, it } from 'vitest'
import { AGENT_COMPACT_PERSONA_MARKER, compilePreset, isDshtRpAgentComposition, neutralizePromptVariables } from '../src/preset/compiler.ts'
import { compileSlots, emptyPreset, type RPPreset } from '../src/preset/schema.ts'
import { demoDirectPreset, demoLightAgentPreset } from '../src/preset/demo.ts'
import { buildRpJsonContent, exportToDshFiles } from '../src/import/dsh-export.ts'
import { importStPreset } from '../src/preset/st-import.ts'
import type { CharacterCard } from '../src/import/character-card.ts'

const card = (over: Partial<CharacterCard> = {}): CharacterCard => ({
  spec: 'chara_card_v2', name: '祥子', description: '大提琴少女', personality: '认真',
  scenario: '水族馆', firstMes: '风铃作响', alternateGreetings: [],
  systemPrompt: '', postHistoryInstructions: '', tags: [], creator: '',
  embeddedBook: null, embeddedRegex: [], depthPrompt: null, externalWorldRef: null,
  importWarnings: [],
  ...over,
} as unknown as CharacterCard)

describe('preset 编译器（T1.9：表层 → DSH preset 目录；§2.3 ② 起 persona 一律紧凑指针）', () => {
  it('§2.3 ② 槽位/toggle 正文不编译进 persona（正本全文经每轮快照注入）；身份宏仍展开', () => {
    const p = emptyPreset('test', '测试预设')
    p.toggles = [{
      group: 'writingStyle', label: '文风', options: [
        { id: 'a', label: 'A', content: '{{char}}的文风A', selected: true },
        { id: 'b', label: 'B', content: '文风B不该出现' },
      ],
    }]
    const files = compilePreset(p, { user: '旅人', char: '祥子' })
    const agent = files.find(f => f.path.endsWith('agent.cordis.yml'))!
    const presetYml = files.find(f => f.path.endsWith('preset.yml'))!
    // 紧凑指针：槽位正文不进 system（旧形态与每轮快照构成两份重复规则）
    expect(agent.content).not.toContain('祥子的文风A')
    expect(agent.content).not.toContain('文风B不该出现')
    expect(agent.content).toContain(AGENT_COMPACT_PERSONA_MARKER)
    expect(agent.content).toContain('每轮对话会以「RP 预设」快照消息注入全文')
    expect(agent.content).toContain("name: '@deepseek-ai/dsh-persona'")
    expect(agent.content).toContain('- id: skill-filesystem')
    expect(presetYml.content).toContain('name: 测试预设')
    expect(files.every(f => f.path.startsWith('.agent-presets/test/'))).toBe(true)
  })

  it('§2.3 ② 紧凑 persona 的指针文本过宏护栏：无半角 {{（真机炸 turn 修复的护栏不回退）', () => {
    const p = emptyPreset('macro-guard', '宏护栏')
    const files = compilePreset(p, { user: '旅人', char: '祥子' })
    const agent = files.find(f => f.path.endsWith('agent.cordis.yml'))!
    // 除 {{model}}/{{cwd}} 外 persona 文本不再有任何半角 {{…}}（插值器炸点护栏）
    const residual = agent.content.match(/\{\{([^{}]*)\}\}/g) ?? []
    expect(residual.every(m => m === '{{model}}' || m === '{{cwd}}')).toBe(true)
  })

  it('neutralizePromptVariables 单元行为：已知变量直通、分段宏/大小写变体全角化、孤立 {{ 不动', () => {
    expect(neutralizePromptVariables('{{model}} {{cwd}}')).toBe('{{model}} {{cwd}}')
    expect(neutralizePromptVariables('{{setvar::x::y}}')).toBe('｛｛setvar::x::y｝｝')
    expect(neutralizePromptVariables('{{Char}}')).toBe('｛｛Char｝｝')
    expect(neutralizePromptVariables('无宏文本')).toBe('无宏文本')
  })

  it('§2.3 ② 任意路径（direct）：槽位正文不进 persona；marker 动态位保持跳过', () => {
    const p = emptyPreset('test2', '测试2')
    const main = p.slots.find(s => s.id === 'main')
    if (main) main.content = '主提示词内容'
    const files = compilePreset(p, { user: 'U', char: 'C' })
    const agent = files.find(f => f.path.endsWith('agent.cordis.yml'))!
    expect(agent.content).not.toContain('主提示词内容')
    expect(agent.content).toContain(AGENT_COMPACT_PERSONA_MARKER)
    // marker（charDesc 等）是组装层动态填充位，编译期不产出静态占位文本
    expect(agent.content).not.toContain('charDesc')
  })
})

describe('P1#6 双轴分离：agent 型预设 skill 走 DSH preset 侧', () => {
  const agentPreset = (): RPPreset => {
    const p = emptyPreset('st-agent-x', '[Agent] 测试')
    p.path = 'agent'
    const main = p.slots.find(s => s.id === 'main')
    if (main) main.content = '编排主指令'
    return p
  }
  const agentYml = (p: RPPreset): string =>
    compilePreset(p, { user: 'U', char: 'C' }).find(f => f.path.endsWith('agent.cordis.yml'))!.content

  it('agent 路径编译产物：能力轴 cordis 组挂 skill-filesystem + tool-skill（skill 可调用性落点）', () => {
    const yml = agentYml(agentPreset())
    expect(yml).toContain('- id: preset-capability')
    expect(yml).toContain('name: cordis:group')
    expect(yml).toContain(`      name: '@deepseek-ai/dsh-skill-filesystem'`) // 组内（4 空格缩进）
    expect(yml).toContain(`      name: '@deepseek-ai/dsh-tool-skill'`)
    expect(yml).toContain(`name: '@deepseek-ai/dsh-agent-instructions'`)
    // 顶层不再平铺 skill-filesystem（移进能力轴组）；显式降权：不挂 shell/fs/subagent
    expect(yml).not.toContain(`\n- id: skill-filesystem`)
    expect(yml).not.toContain('dsh-tool-bash')
    expect(yml).not.toContain('dsh-tool-subagent')
  })

  it('§2.3 ② 两套规则单向生成：agent 型 persona = 紧凑指针（规则正文经每轮快照注入，不编译进 system）', () => {
    const yml = agentYml(agentPreset()) // main 槽位含「编排主指令」
    // 槽位正文不再编译进 system（旧形态与每轮 RP 预设快照构成两份重复规则）
    expect(yml).not.toContain('编排主指令')
    // 指针语义 + 版本标记（ensureRpPresetSync 据此升级存量目录）
    expect(yml).toContain(AGENT_COMPACT_PERSONA_MARKER)
    expect(yml).toContain('每轮对话会以「RP 预设」快照消息注入全文')
    expect(yml).toContain('以快照为准')
    // isDshtRpAgentComposition 结构特征不受影响
    expect(isDshtRpAgentComposition(yml)).toBe(true)
  })

  it('§2.3 ②：direct 路径同样紧凑化（快照管线无 path 过滤，所有 st-* 预设统一指针形态）', () => {
    const p = emptyPreset('st-direct-y', '直出带正文')
    const main = p.slots.find(s => s.id === 'main')
    if (main) main.content = '直出路径的规则正文'
    const yml = agentYml(p)
    expect(yml).not.toContain('直出路径的规则正文')
    expect(yml).toContain(AGENT_COMPACT_PERSONA_MARKER)
  })

  it('direct 路径保持平铺旧形态（顶层 skill-filesystem，无能力轴组/tool-skill）', () => {
    const yml = agentYml(emptyPreset('st-direct-x', '直出'))
    expect(yml).toContain(`\n- id: skill-filesystem`)
    expect(yml).not.toContain('preset-capability')
    expect(yml).not.toContain('dsh-tool-skill')
    expect(isDshtRpAgentComposition(yml)).toBe(false)
  })

  it('isDshtRpAgentComposition：编译产物命中；改名派生（结构保留）命中；coding 预设/旧形态不命中', () => {
    const yml = agentYml(agentPreset())
    expect(isDshtRpAgentComposition(yml)).toBe(true)
    // 派生预设：id/注释可改，结构特征（能力轴组 + tool-skill + persona）保留即认
    const derived = yml
      .replace('- id: preset-capability', '- id: preset-capability # 用户派生')
      .replace('DSHTavern RP 预设（编译产物', '我的改写版（编译产物')
    expect(isDshtRpAgentComposition(derived)).toBe(true)
    // 无关 coding 预设（有 shell/fs、无能力轴组）挡在 RP 能力轴判定外
    expect(isDshtRpAgentComposition([
      `- id: persona`,
      `  name: '@deepseek-ai/dsh-persona'`,
      `- id: tool-bash`,
      `  name: '@deepseek-ai/dsh-tool-bash'`,
      `- id: tool-skill`,
      `  name: '@deepseek-ai/dsh-tool-skill'`,
      ``,
    ].join('\n'))).toBe(false)
    // 旧形态 agent 编译产物（有 agent-instructions、无能力轴组）= 待升级
    expect(isDshtRpAgentComposition([
      `- id: persona`,
      `  name: '@deepseek-ai/dsh-persona'`,
      `- id: agent-instructions`,
      `  name: '@deepseek-ai/dsh-agent-instructions'`,
      `- id: skill-filesystem`,
      `  name: '@deepseek-ai/dsh-skill-filesystem'`,
      ``,
    ].join('\n'))).toBe(false)
    // CRLF 归一化
    expect(isDshtRpAgentComposition(yml.replaceAll('\n', '\r\n'))).toBe(true)
  })
})

describe('两个示范预设（T1.10：直答型 / 轻 agent 型）', () => {
  it('直答型：direct 路径 + toggles 两组（文风/长度）+ main/jb 槽位', () => {
    const p = demoDirectPreset()
    expect(p.path).toBe('direct')
    expect(p.toggles.map(t => t.group)).toEqual(['writingStyle', 'replyLength'])
    const slots = compileSlots(p)
    const toggleSlots = slots.filter(s => s.source.startsWith('toggle:'))
    expect(toggleSlots.length).toBe(2) // 每组恰好选中一项展开
    expect(toggleSlots[0].content).toContain('写实细腻')
  })

  it('轻 agent 型：lightAgent 路径 + 预算收紧（maxToolRounds=2）+ lore_query 指引', () => {
    const p = demoLightAgentPreset()
    expect(p.path).toBe('lightAgent')
    expect(p.budget.maxToolRounds).toBe(2)
    expect(p.budget.delegationMaxPerRun).toBe(0)
    const main = p.slots.find(s => s.id === 'main')!
    expect(main.content).toContain('lore_query')
  })

  it('两个示范预设编译产物挂载可跑（agent.cordis.yml 形态完整）', () => {
    for (const p of [demoDirectPreset(), demoLightAgentPreset()]) {
      const files = compilePreset(p, { user: '旅人', char: '角色' })
      const agent = files.find(f => f.path.endsWith('agent.cordis.yml'))!
      expect(agent.content).toContain('- id: persona')
      expect(agent.content).toContain("name: '@deepseek-ai/dsh-persona'")
      expect(agent.content).toContain('- id: skill-filesystem')
    }
  })
})

describe('rp.json 正则落盘（T1.2：内嵌正则随卡持久化）', () => {
  it('embeddedRegex 写入 rp.json.regex 字段', () => {
    const c = card({
      embeddedRegex: [{
        id: 'r1', scriptName: '状态栏美化', findRegex: '/<status>[\\s\\S]*?<\\/status>/g', replaceString: '',
        trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
        runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
      }],
    })
    const rp = JSON.parse(buildRpJsonContent(c, []))
    expect(rp.regex).toHaveLength(1)
    expect(rp.regex[0].scriptName).toBe('状态栏美化')
  })
})

describe('用户档案 persona 导入（§4.4：settings.json persona 块）', () => {
  it('exportToDshFiles 产出 dsht-user-persona preset 文件', async () => {
    const files: Array<{ path: string; content: string }> = []
    await exportToDshFiles({
      zip: { files: {} },
      worlds: new Map(),
      characters: [],
      chatFiles: [],
      report: { settings: { personaName: '旅人', personaDescription: '一名普通的旅行者' } },
    }, async batch => { files.push(...batch) }, { worlds: false, cards: false, chats: false })
    const agent = files.find(f => f.path === '.agent-presets/dsht-user-persona/agent.cordis.yml')
    const presetYml = files.find(f => f.path === '.agent-presets/dsht-user-persona/preset.yml')
    expect(agent).toBeDefined()
    expect(agent!.content).toContain('- 名字：旅人')
    expect(agent!.content).toContain('- 人设：一名普通的旅行者')
    expect(presetYml!.content).toContain('name: 用户档案（persona）')
  })

  it('无 persona 时不产出文件', async () => {
    const files: Array<{ path: string; content: string }> = []
    await exportToDshFiles({
      zip: { files: {} }, worlds: new Map(), characters: [], chatFiles: [],
      report: { settings: {} },
    }, async batch => { files.push(...batch) }, { worlds: false, cards: false, chats: false })
    expect(files.filter(f => f.path.includes('dsht-user-persona'))).toHaveLength(0)
  })

  it('R8：personas 列表每个 persona 各产出一个 preset（默认 persona 固定 dsht-user-persona）', async () => {
    const files: Array<{ path: string; content: string }> = []
    const result = await exportToDshFiles({
      zip: { files: {} },
      worlds: new Map(),
      characters: [],
      chatFiles: [],
      report: {
        settings: {
          personas: [
            { name: '示例人设甲', description: '默认描述', isDefault: true, avatar: 'user-default.png' },
            { name: '示例人设乙', description: '描述A', isDefault: false, avatar: 'a.png' },
          ],
        },
      },
    }, async batch => { files.push(...batch) }, { worlds: false, cards: false, chats: false })
    expect(result.presets).toBe(2)
    const def = files.find(f => f.path === '.agent-presets/dsht-user-persona/agent.cordis.yml')!
    expect(def).toBeDefined()
    expect(def.content).toContain('- 名字：示例人设甲')
    expect(def.content).toContain('- 人设：默认描述')
    const defYml = files.find(f => f.path === '.agent-presets/dsht-user-persona/preset.yml')!
    expect(defYml.content).toContain('name: 用户档案（示例人设甲）')
    const other = files.find(f => f.path.startsWith('.agent-presets/dsht-persona-') && f.path.endsWith('agent.cordis.yml'))!
    expect(other).toBeDefined()
    expect(other.content).toContain('- 名字：示例人设乙')
    expect(other.content).toContain('- 头像：a.png')
  })
})

describe('ST 预设导入器（T2.7 补丁：示例预设等 completion 预设 → 表层 preset + 预设正则）', () => {
  /** 示例预设结构的极简复刻（字段名与实测一致） */
  const foxJson = JSON.stringify({
    temperature: 1, top_p: 0.88, top_k: 40, frequency_penalty: 0, presence_penalty: 0, openai_max_tokens: 65535,
    prompts: [
      { identifier: 'rand-head', name: '随机头部', role: 'system', content: 'RANDOM', marker: false, injection_position: 0 },
      { identifier: 'main-prompt', name: '主指令', role: 'system', content: '你是叙事引擎', marker: false, injection_position: 0 },
      { identifier: 'jb', name: '深度条目', role: 'system', content: '靠近末尾注入', marker: false, injection_position: 1, injection_depth: 2 },
      { identifier: 'user-note', name: '用户位条目', role: 'user', content: '以用户身份注入', marker: false, injection_position: 0 },
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
      { identifier: 'charDescription', name: 'Char Description', marker: true },
      { identifier: 'dialogueExamples', name: 'Chat Examples', marker: true }, // 无对应槽 → 跳过
    ],
    prompt_order: [
      { character_id: 100001, order: [
        { identifier: 'rand-head', enabled: false },
        { identifier: 'main-prompt', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jb', enabled: true },
        { identifier: 'user-note', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'dialogueExamples', enabled: true },
      ] },
      { character_id: 999999, order: [{ identifier: 'main-prompt', enabled: false }] }, // 角色专属档：不采用
    ],
    extensions: { regex_scripts: [
      { scriptName: '隐藏选项助手', findRegex: '<selection>[\\s\\S]*?<\\/selection>', replaceString: '', trimStrings: [], placement: [2], markdownOnly: true },
      { scriptName: '空条目（分隔）', findRegex: '' },
      { scriptName: '杀破折号', findRegex: '/——/g', replaceString: '', placement: [2] },
    ] },
  })

  it('条目按 prompt_order 通用档平铺：enabled 映射、marker 映射、深度/角色保留', () => {
    const { preset, skipped } = importStPreset(foxJson, '示例预设 · 示例角色')
    expect(preset.displayName).toBe('示例预设 · 示例角色')
    expect(preset.id.startsWith('st-')).toBe(true)
    // 通用档顺序共 6 槽（dialogueExamples 无对应槽跳过）；中文名条目 id 走 hash 兜底
    expect(preset.slots).toHaveLength(6)
    const main = preset.slots.find(s => s.content === '你是叙事引擎')!
    expect(main.enabled).toBe(true)
    expect(main.content).toBe('你是叙事引擎')
    expect(main.type).toBe('system')
    // prompt_order 里的 enabled 覆盖（随机头部关）
    const rand = preset.slots.find(s => s.content === 'RANDOM')
    expect(rand?.enabled).toBe(false)
    // 深度注入与角色
    const jb = preset.slots.find(s => s.content === '靠近末尾注入')!
    expect(jb.depth).toBe(2)
    const userNote = preset.slots.find(s => s.content === '以用户身份注入')!
    expect(userNote.role).toBe('user')
    // marker 槽（identifier 映射组装层槽位名）
    expect(preset.slots.find(s => s.id === 'chatHistory')?.type).toBe('marker')
    expect(preset.slots.find(s => s.id === 'charDesc')?.type).toBe('marker')
    expect(skipped).toBe(2) // dialogueExamples（无对应 marker 槽）+ 空正则分隔条目
    // 采样参数
    expect(preset.sampling.temperature).toBe(1)
    expect(preset.sampling.topP).toBe(0.88)
    expect(preset.sampling.topK).toBe(40)
    expect(preset.sampling.maxTokens).toBe(65535)
  })

  it('内嵌正则 → 预设作用域脚本（空 findRegex 的分隔条目跳过；字段缺省走 ST 默认）', () => {
    const { regex } = importStPreset(foxJson, '示例预设 · 示例角色')
    expect(regex).toHaveLength(2)
    const hide = regex.find(r => r.scriptName === '隐藏选项助手')!
    expect(hide.findRegex).toContain('selection')
    expect(hide.markdownOnly).toBe(true)
    expect(hide.disabled).toBe(false)
    expect(hide.runOnEdit).toBe(true) // ST 默认
    const kill = regex.find(r => r.scriptName === '杀破折号')!
    expect(kill.placement).toEqual([2])
    expect(kill.markdownOnly).toBe(false)
  })

  it('P1#7 采样参数完整映射：stream/openai 系字段、stop sequences、logit bias 全量登记', () => {
    const { preset } = importStPreset(JSON.stringify({
      temperature: 0.7, top_p: 0.9, top_k: 50, top_a: 0.1, min_p: 0.05,
      frequency_penalty: 0.2, presence_penalty: 0.3, repetition_penalty: 1.1,
      openai_max_tokens: 4096, openai_max_context: 8192, seed: 42,
      stream_openai: true, reasoning_effort: 'high',
      custom_stopping_strings: '["\\nUser:", "<|end|>"]',
      logit_bias: [{ text: 'the', value: -1.5 }, { text: 'bad-value', value: 'oops' }, { value: 2 }],
      prompts: [], prompt_order: [],
    }), '采样全量预设')
    expect(preset.sampling).toMatchObject({
      temperature: 0.7, topP: 0.9, topK: 50, topA: 0.1, minP: 0.05,
      frequencyPenalty: 0.2, presencePenalty: 0.3, repetitionPenalty: 1.1,
      maxTokens: 4096, maxContext: 8192, seed: 42,
      stream: true, reasoningEffort: 'high',
      stopSequences: ['\nUser:', '<|end|>'],
      logitBias: [{ text: 'the', value: -1.5 }], // 非法条目导入期丢弃
    })
  })

  it('P1#7 采样边界：seed=-1（ST 随机哨兵）不登记；stop sequences 兼容直接数组；缺省字段不出现', () => {
    const { preset } = importStPreset(JSON.stringify({
      seed: -1, custom_stopping_strings: ['stop甲', 'stop乙'],
      prompts: [], prompt_order: [],
    }), '边界预设')
    expect(preset.sampling.seed).toBeUndefined()
    expect(preset.sampling.stopSequences).toEqual(['stop甲', 'stop乙'])
    expect(preset.sampling.stream).toBeUndefined()
    expect(preset.sampling.logitBias).toBeUndefined()
    expect(preset.sampling.reasoningEffort).toBeUndefined()
  })

  it('P1#7 宏变量登记：setvar 初值、getvar fallback/占位、裸宏登记；身份/指令宏不登记', () => {
    const { preset } = importStPreset(JSON.stringify({
      prompts: [
        { identifier: 'init', name: '初始化块', role: 'system', content: '{{setvar::think1::}}{{setvar::文风::细腻}}{{user}}与{{char}}同框' },
        { identifier: 'body', name: '正文引用块', role: 'system', content: '引用 {{getvar::think1}} 与 {{getvar::文风}}，默认 {{getvar::pov::第一人称}}，裸宏 {{customMacro}}，指令 {{trim}} 保留' },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'init', enabled: true }, { identifier: 'body', enabled: true },
      ] }],
    }), '宏登记预设')
    expect(preset.macros).toMatchObject({
      think1: '', 文风: '细腻', pov: '第一人称', customMacro: '',
    })
    expect(preset.macros).not.toHaveProperty('user')
    expect(preset.macros).not.toHaveProperty('char')
    expect(preset.macros).not.toHaveProperty('trim')
    // 大小写不敏感：登记后大小写变体不重复入册
    expect(Object.keys(preset.macros!)).toHaveLength(4)
  })

  it('P1#7 无宏预设不带 macros 字段', () => {
    const { preset } = importStPreset(JSON.stringify({
      prompts: [{ identifier: 'a', name: '普通条目', role: 'system', content: '没有任何宏的纯文本内容' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }] }],
    }), '无宏预设')
    expect(preset.macros).toBeUndefined()
  })

  it('compileSlots 消费导入产物：未启用条目不进 prompt（编译期展开语义不变）', () => {
    const { preset } = importStPreset(foxJson, '示例预设 · 示例角色')
    const compiled = compileSlots(preset)
    expect(compiled.some(c => c.content === '你是叙事引擎')).toBe(true)
    expect(compiled.some(c => c.content === 'RANDOM')).toBe(false) // 随机头部关闭
  })

  it('R16：oneshot vs agent 预设区分——[Agent]/[主预设] 名字归类 + 编排内容特征', () => {
    // 「[Agent] V14.7 示例预设」（适配 TT agent 模式）→ path='agent'
    const agentPreset = importStPreset(foxJson, '[Agent] V14.7 示例预设')
    expect(agentPreset.preset.path).toBe('agent')
    expect(agentPreset.preset.description).toContain('agent 编排型')
    // 「[主预设] V17.1 示例预设」（ST oneshot）→ path='direct'
    const oneshot = importStPreset(foxJson, '[主预设] V17.1 示例预设')
    expect(oneshot.preset.path).toBe('direct')
    expect(oneshot.preset.description).toContain('oneshot')
    // 条目内容含 subagent 编排特征 → 即使名字无标注也归 agent
    const contentAgent = importStPreset(JSON.stringify({
      prompts: [{ identifier: 'x1', name: '编排', role: 'system', content: '调用 subagent 分别生成各角色台词', marker: false }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'x1', enabled: true }] }],
    }), '无标注预设')
    expect(contentAgent.preset.path).toBe('agent')
    // 中文 [代理] 标注同效
    expect(importStPreset(foxJson, '测试 [代理] 预设').preset.path).toBe('agent')
    // 普通预设不受影响
    expect(importStPreset(foxJson, '示例预设 · 示例角色').preset.path).toBe('direct')
  })
})

describe('R3：ST 预设开关组重建（注释条目分组 → RPPreset.toggles）', () => {
  /** 真实主预设分组风格的最小复刻：〖…〗组头 + 空内容/分组说明 */
  const groupedJson = JSON.stringify({
    prompts: [
      { identifier: 'h1', name: '〖必读-创作准则〗', role: 'system', content: '', marker: false },
      { identifier: 'a1', name: '准则甲', role: 'system', content: '准则甲内容', marker: false },
      { identifier: 'a2', name: '准则乙', role: 'system', content: '准则乙内容', marker: false },
      { identifier: 'h2', name: '【文风控制】', role: 'system', content: '本分组控制输出文风', marker: false },
      { identifier: 'b1', name: '文风子', role: 'system', content: '文风子内容', marker: false },
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'h1', enabled: true },
      { identifier: 'a1', enabled: true },
      { identifier: 'a2', enabled: false },
      { identifier: 'h2', enabled: true },
      { identifier: 'b1', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ] }],
  })

  it('组头识别：〖…〗/【…】注释条目开组（组名剥装饰），条目归组，selected = ST enabled', () => {
    const { preset } = importStPreset(groupedJson, '分组预设')
    expect(preset.toggles).toHaveLength(2)
    expect(preset.toggles[0].label).toBe('必读-创作准则')
    expect(preset.toggles[0].multi).toBe(true)
    expect(preset.toggles[0].options.map(o => o.label)).toEqual(['准则甲', '准则乙'])
    expect(preset.toggles[0].options[0].selected).toBe(true)
    expect(preset.toggles[0].options[1].selected).toBe(false)
    expect(preset.toggles[1].label).toBe('文风控制')
    expect(preset.toggles[1].options).toHaveLength(1)
    // 组头不进 options；slots 平铺语义不破坏（marker 槽仍在）
    expect(preset.toggles.flatMap(g => g.options).some(o => o.label.includes('〖'))).toBe(false)
    expect(preset.slots.find(s => s.id === 'chatHistory')?.type).toBe('marker')
  })

  it('编译等价：multi 组展开全部选中项、停用项不进；全停用组不产出（无选一兜底误注入）', () => {
    const { preset } = importStPreset(groupedJson, '分组预设')
    const compiled = compileSlots(preset)
    expect(compiled.some(c => c.content === '准则甲内容')).toBe(true)
    expect(compiled.some(c => c.content === '准则乙内容')).toBe(false) // 停用
    expect(compiled.some(c => c.content === '文风子内容')).toBe(true)
    // 全部关死后 toggle 源零产出
    for (const g of preset.toggles) for (const o of g.options) o.selected = false
    const off = compileSlots(preset)
    expect(off.filter(c => c.source.startsWith('toggle:'))).toHaveLength(0)
  })

  it('无组头时兜底：按 enabled 分「已启用条目/已停用条目」两组（toggles 不为空）', () => {
    const plainJson = JSON.stringify({
      prompts: [
        { identifier: 'x1', name: '条目一', role: 'system', content: '内容一内容一', marker: false },
        { identifier: 'x2', name: '条目二', role: 'system', content: '内容二内容二', marker: false },
        { identifier: 'x3', name: '条目三', role: 'system', content: '内容三内容三', marker: false },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'x1', enabled: true },
        { identifier: 'x2', enabled: false },
        { identifier: 'x3', enabled: true },
      ] }],
    })
    const { preset } = importStPreset(plainJson, '无分组预设')
    expect(preset.toggles.map(t => t.label)).toEqual(['已启用条目', '已停用条目'])
    expect(preset.toggles[0].options.map(o => o.label)).toEqual(['条目一', '条目三'])
    expect(preset.toggles[1].options.map(o => o.label)).toEqual(['条目二'])
    expect(preset.toggles.every(t => t.multi === true)).toBe(true)
    const compiled = compileSlots(preset)
    expect(compiled.some(c => c.content === '内容一内容一')).toBe(true)
    expect(compiled.some(c => c.content === '内容二内容二')).toBe(false)
  })

  it('首个组头前的条目归入「未分组」', () => {
    const json = JSON.stringify({
      prompts: [
        { identifier: 'p0', name: '前置条目', role: 'system', content: '前置条目内容', marker: false },
        { identifier: 'h', name: '=== 分组 ===', role: 'system', content: '', marker: false },
        { identifier: 'p1', name: '组内条目', role: 'system', content: '组内条目内容', marker: false },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'p0', enabled: true },
        { identifier: 'h', enabled: true },
        { identifier: 'p1', enabled: true },
      ] }],
    })
    const { preset } = importStPreset(json, '前置分组')
    expect(preset.toggles.map(t => t.label)).toEqual(['未分组', '分组'])
    expect(preset.toggles[0].options[0].label).toBe('前置条目')
  })
})
