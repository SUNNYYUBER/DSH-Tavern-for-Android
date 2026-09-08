import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { analyzeDataZip, extractPersonas, lastDataImport } from '../src/import/data-zip.ts'
import { exportToDshFiles } from '../src/import/dsh-export.ts'

const v2Card = (name: string): string => JSON.stringify({
  spec: 'chara_card_v2', spec_version: '2.0',
  data: {
    name, description: '', personality: '', scenario: '', first_mes: '（开场白）风铃作响。', mes_example: '',
    creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
    tags: [], creator: '', character_version: '', extensions: {},
  },
})

describe('analyzeDataZip（T2.11：子目录角色卡 + key 兼容修复回归）', () => {
  it('characters/<角色名>/character.json 子目录卡被识别（旧 listDir 漏检→0 卡）', async () => {
    const zip = new JSZip()
    zip.file('data/characters/测试角色/character.json', v2Card('测试角色'))
    zip.file('data/characters/老版直接卡.json', v2Card('老版直接卡'))
    zip.file('data/characters/测试角色/avatar.png', new Uint8Array([1, 2, 3])) // 头像不应当卡
    zip.file('data/worlds/测试书.json', '{"name":"测试书","entries":[]}') // 补足 ST marker（detectRoot 需 ≥2）
    zip.file('data/chats/测试角色/chat.jsonl', '{"name":"测试角色","is_user":false,"mes":"x"}\n')
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const report = await analyzeDataZip(buf)
    expect(report.rootPath).toBe('data')
    expect(report.stats.characters).toBe(2) // 子目录卡 + 直接卡
    expect(report.warnings.some(w => w.includes('avatar'))).toBe(false)
  })

  it('旧版世界书 key 单数字符串不崩，loreEntries 计数正确', async () => {
    const zip = new JSZip()
    zip.file('data/worlds/测试书.json', JSON.stringify({
      name: '测试书',
      entries: [
        { comment: '地点', content: '咖啡厅', key: '咖啡厅' },
        { comment: '人物', content: '祥子', keys: ['祥子'], keysecondary: '备选' },
      ],
    }))
    zip.file('data/settings.json', '{}') // 补足 ST marker
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const report = await analyzeDataZip(buf)
    expect(report.stats.worldBooks).toBe(1)
    expect(report.stats.loreEntries).toBe(2)
  })

  it('chats/<角色>/*.jsonl 归属统计（真实 ST 目录结构）', async () => {
    const zip = new JSZip()
    zip.file('data/characters/测试角色/character.json', v2Card('测试角色'))
    zip.file('data/chats/测试角色/chat-1.jsonl', '{"name":"测试角色","is_user":false,"mes":"开场"}\n')
    zip.file('data/chats/测试角色/chat-2.jsonl', '{"name":"测试者","is_user":true,"mes":"你好"}\n')
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const report = await analyzeDataZip(buf)
    expect(report.stats.chats).toBe(2)
    expect(report.relations.chatOwnerPairs).toHaveLength(1)
    expect(report.relations.chatOwnerPairs[0].chatCount).toBe(2)
  })

  it('Windows 压缩工具反斜杠 zip 条目路径也能识别（T2.11 补：listDir/listCharacterFiles 统一 norm）', async () => {
    const zip = new JSZip()
    // JSZip 的 key 含反斜杠（模拟 PS Compress-Archive 产物）
    zip.file('data\\characters\\测试角色\\character.json', v2Card('测试角色'))
    zip.file('data\\worlds\\测试书.json', '{"name":"测试书","entries":[{"uid":1,"key":"咖啡厅","content":"咖啡厅","comment":"地点","constant":false,"position":0,"depth":4,"selective":false,"exclude_recursion":false,"prevent_recursion":false,"disable":false,"probability":100}]}')
    zip.file('data\\chats\\测试角色\\chat.jsonl', '{"name":"测试角色","is_user":false,"mes":"x"}\n')
    zip.file('data\\settings.json', '{}')
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const report = await analyzeDataZip(buf)
    expect(report.stats.characters).toBe(1) // 反斜杠路径的角色卡被识别
    expect(report.stats.worldBooks).toBe(1)
    expect(report.stats.chats).toBe(1)
  })

  it('T2.11 补：整包迁移顺带导入 ST 预设（OpenAI Settings/*.json → rp-presets/*/preset.json + regex.json）', async () => {
    const zip = new JSZip()
    zip.file('data/characters/测试角色/character.json', v2Card('测试角色'))
    zip.file('data/settings.json', '{}')
    zip.file('data/OpenAI Settings/示例预设.json', JSON.stringify({
      temperature: 1, top_p: 0.88, top_k: 40, openai_max_tokens: 65535,
      prompts: [
        { identifier: 'main', name: '主指令', role: 'system', content: '你是叙事引擎', marker: false, injection_position: 0 },
        { identifier: 'rand', name: '随机头部', role: 'system', content: 'RANDOM', marker: false, injection_position: 0 },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'main', enabled: true },
        { identifier: 'rand', enabled: false },
      ] }],
      extensions: { regex_scripts: [{ scriptName: '隐藏选项助手', findRegex: '<selection>[\\s\\S]*?<\\/selection>', replaceString: '', placement: [2] }] },
    }))
    zip.file('data/OpenAI Settings/示例预设.luker-state.x.json', '{}') // 状态文件应被排除
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    await analyzeDataZip(buf)
    const imp = lastDataImport()
    expect(imp).toBeTruthy()
    const files: Array<{ path: string; content: string }> = []
    await exportToDshFiles(imp!, async batch => { files.push(...batch) },
      { worlds: false, cards: false, chats: false, presets: true })
    const presetFiles = files.filter(f => f.path.startsWith('rp-presets/'))
    expect(presetFiles.some(f => f.path.endsWith('/preset.json'))).toBe(true)
    expect(presetFiles.some(f => f.path.endsWith('/regex.json'))).toBe(true)
    const presetPath = presetFiles.find(f => f.path.endsWith('/preset.json'))!
    const preset = JSON.parse(presetPath.content)
    expect(preset.displayName).toContain('示例预设')
    // enabled 跟随 prompt_order：主指令开、随机头部关
    expect(preset.slots.find((s: { content: string }) => s.content === '你是叙事引擎').enabled).toBe(true)
    expect(preset.slots.find((s: { content: string }) => s.content === 'RANDOM').enabled).toBe(false)
    // 正则 JSON 落盘
    const regexFile = presetFiles.find(f => f.path.endsWith('/regex.json'))!
    const regex = JSON.parse(regexFile.content)
    expect(regex.scripts).toHaveLength(1)
    expect(regex.scripts[0].scriptName).toBe('隐藏选项助手')
  })
})

describe('R8：persona 三处读取（power_user.personas / persona_descriptions / default_persona）', () => {
  it('extractPersonas：avatar→name 映射 + desc 两种形态 + default_persona 为 avatar key', () => {
    const personas = extractPersonas({
      power_user: {
        personas: { 'a.png': '示例人设乙', 'b.png': '示例人设丙', 'user-default.png': '示例人设甲' },
        persona_descriptions: { '示例人设乙': '描述字符串形态', '示例人设丙': { description: '对象形态描述' } },
        default_persona: 'b.png',
      },
    })
    expect(personas).toHaveLength(3)
    const def = personas.find(p => p.isDefault)!
    expect(def.name).toBe('示例人设丙')
    expect(def.description).toBe('对象形态描述')
    expect(def.avatar).toBe('b.png')
    const lingyi = personas.find(p => p.name === '示例人设乙')!
    expect(lingyi.description).toBe('描述字符串形态')
    expect(lingyi.isDefault).toBe(false)
    // 无描述的 persona 描述为空串
    expect(personas.find(p => p.name === '示例人设甲')!.description).toBe('')
  })

  it('default_persona 直接是名字也兼容；缺失时取第一个为默认', () => {
    const byName = extractPersonas({
      power_user: {
        personas: { 'a.png': '示例人设乙', 'u.png': '示例人设甲' },
        persona_descriptions: {},
        default_persona: '示例人设甲',
      },
    })
    expect(byName.find(p => p.isDefault)!.name).toBe('示例人设甲')

    const noDefault = extractPersonas({
      power_user: { personas: { 'a.png': '示例人设乙', 'u.png': '示例人设甲' } },
    })
    expect(noDefault[0].isDefault).toBe(true)
    expect(noDefault[0].name).toBe('示例人设乙')
  })

  it('power_user 缺失时回退旧路径（顶层 persona_descriptions[persona_id]）', () => {
    const personas = extractPersonas({
      persona_id: 'p1',
      persona_descriptions: { p1: { name: '旧档案', description: '旧描述' } },
    })
    expect(personas).toHaveLength(1)
    expect(personas[0]).toMatchObject({ name: '旧档案', description: '旧描述', isDefault: true })
  })

  it('analyzeDataZip 集成：settings.json power_user → report.settings.persona* + personas 列表', async () => {
    const zip = new JSZip()
    zip.file('data/worlds/测试书.json', '{"name":"测试书","entries":[]}') // 补足 ST marker
    zip.file('data/settings.json', JSON.stringify({
      power_user: {
        personas: { 'user-default.png': '示例人设甲', 'a.png': '示例人设乙' },
        persona_descriptions: { '示例人设甲': '一名旅人' },
        default_persona: 'user-default.png',
      },
      world_info_settings: { world_info: { globalSelect: ['测试书'] } },
    }))
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const report = await analyzeDataZip(buf)
    expect(report.settings.personaName).toBe('示例人设甲')
    expect(report.settings.personaDescription).toBe('一名旅人')
    expect(report.settings.personas).toHaveLength(2)
    expect(report.settings.personas.find(p => p.isDefault)!.avatar).toBe('user-default.png')
    // globalSelect 仍进 relations（R9 数据源）
    expect(report.relations.globalSelectedBooks).toEqual(['测试书'])
  })
})
