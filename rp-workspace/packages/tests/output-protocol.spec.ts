import { describe, expect, it } from 'vitest'
import {
  PROTO_DEFAULT, applyOutputProtocol, applyOutputProtocolSegments, parseJsonPatches, parseStateUpdateBlock,
  parseStatusBarRows, parseVariableJson, slugFromCwd, splitStatusbarBlocks, withDefaults,
} from '../src/dsht-rp-ui/src/client/output-protocol.ts'

describe('输出协议三组件纯逻辑（T2.5a：自 rp-chat 迁移，语义不变）', () => {
  it('statusTags → 状态栏卡片内容并从正文剥离', () => {
    const r = applyOutputProtocol('<status>时间：傍晚\n地点：咖啡厅</status>\n\n风铃作响。', PROTO_DEFAULT)
    expect(r.status).toEqual(['时间：傍晚\n地点：咖啡厅'])
    expect(r.display).toBe('风铃作响。')
    expect(r.actions).toEqual([])
  })

  it('actionTags → 行动选项按钮并剥离；多个标签按序保留', () => {
    const text = '<a>问她刚才在想什么</a>正文<selection>点一杯咖啡</selection>'
    const r = applyOutputProtocol(text, PROTO_DEFAULT)
    expect(r.actions).toEqual(['问她刚才在想什么', '点一杯咖啡'])
    expect(r.display).toBe('正文')
  })

  it('wrapTags → 剥壳显示内文（V8.8 <content> 包裹形态）', () => {
    const r = applyOutputProtocol('<content>风铃作响，祥子抬起头。</content>', PROTO_DEFAULT)
    expect(r.display).toBe('风铃作响，祥子抬起头。')
  })

  it('三组件混合：剥壳 + 状态卡 + 行动选项一次过', () => {
    const text = '<content>她抬起头。<status>好感 +1</status></content><a>微笑回应</a>'
    const r = applyOutputProtocol(text, PROTO_DEFAULT)
    expect(r.display).toBe('她抬起头。')
    expect(r.status).toEqual(['好感 +1'])
    expect(r.actions).toEqual(['微笑回应'])
  })

  it('自定义协议配置隔离（V8.8 自定义标签名）', () => {
    const proto = { actionTags: ['selection'], wrapTags: ['content'], statusTags: ['StatusBlock'] }
    const r = applyOutputProtocol('<selection>选项A</selection><StatusBlock>状态</StatusBlock>', proto)
    expect(r.actions).toEqual(['选项A'])
    expect(r.status).toEqual(['状态'])
  })

  it('流式悬空开标签先行剥离（闭合前不闪原始标签）', () => {
    const partial = '正文进行中<content>尚未闭合的部分'
    const r = applyOutputProtocol(partial, PROTO_DEFAULT, true)
    expect(r.display).toBe('正文进行中尚未闭合的部分')
    // 完整闭合后走完整提取
    const done = applyOutputProtocol(`${partial}</content>`, PROTO_DEFAULT, false)
    expect(done.display).toBe('正文进行中尚未闭合的部分')
  })

  it('空内容标签不产出空卡片/空按钮', () => {
    const r = applyOutputProtocol('<status></status><a>  </a>正文', PROTO_DEFAULT)
    expect(r.status).toEqual([])
    expect(r.actions).toEqual([])
    expect(r.display).toBe('正文')
  })
})

describe('statusbar 代码块切分（§4.6：代码块 → 组件渲染）', () => {
  it('statusbar/status 代码块切出，普通代码块保留在文本段', () => {
    const text = '前文\n```statusbar\n时间：傍晚\n```\n中段\n```js\nconsole.log(1)\n```\n尾文'
    const segs = splitStatusbarBlocks(text)
    expect(segs).toEqual([
      { type: 'text', content: '前文\n' },
      { type: 'statusbar', content: '时间：傍晚\n' },
      { type: 'text', content: '\n中段\n```js\nconsole.log(1)\n```\n尾文' },
    ])
  })

  it('无 statusbar 代码块 → 单文本段', () => {
    expect(splitStatusbarBlocks('普通正文')).toEqual([{ type: 'text', content: '普通正文' }])
  })
})

describe('状态栏三档解析', () => {
  it('JSON 对象 → 键值行（嵌套值 JSON 序列化）', () => {
    const rows = parseStatusBarRows('{"时间":"傍晚","地点":"咖啡厅","装备":{"主手":"弓"}}')
    expect(rows).toEqual([['时间', '傍晚'], ['地点', '咖啡厅'], ['装备', '{"主手":"弓"}']])
  })

  it('冒号/全角冒号行 → 键值行', () => {
    const rows = parseStatusBarRows('时间：傍晚\n地点: 咖啡厅\n纯文本行')
    expect(rows).toEqual([['时间', '傍晚'], ['地点', '咖啡厅']])
  })

  it('无结构原文 → 空数组（卡片走原文兜底渲染）', () => {
    expect(parseStatusBarRows('连续的叙述文字')).toEqual([])
  })
})

describe('工作区匹配', () => {
  it('cwd → slug（POSIX / Windows 反斜杠 / 嵌套拒绝）', () => {
    expect(slugFromCwd('/home/u/.dsh/rp/rp-seraphina-abc')).toBe('rp-seraphina-abc')
    expect(slugFromCwd('C:\\Users\\u\\.dsh\\rp\\rp-clara-xyz')).toBe('rp-clara-xyz')
    expect(slugFromCwd('/home/u/.dsh/rp/a/b')).toBeNull()
    expect(slugFromCwd('/home/u/.dsh/skills/x')).toBeNull()
    expect(slugFromCwd(undefined)).toBeNull()
  })

  it('旧 rp.json 协议配置缺字段时默认值补齐', () => {
    expect(withDefaults(undefined)).toEqual(PROTO_DEFAULT)
    // 【ST 对齐 2026-09-07】全标签族并集语义：卡显式配置是「追加」不是「替换」——
    // 替换语义让 ST 生态默认标签（<selection> 选项、<thinking> 思考族）落进未知
    // 标签兜底裸显标签名（真机实证：示例游戏卡只配 ['a','selection']/['Analysis']）
    expect(withDefaults({ actionTags: ['x'] }).actionTags).toEqual([...PROTO_DEFAULT.actionTags, 'x'])
    expect(withDefaults({ actionTags: [] }).actionTags).toEqual(PROTO_DEFAULT.actionTags)
    expect(withDefaults({ actionTags: ['x'] }).wrapTags).toEqual(PROTO_DEFAULT.wrapTags)
    // reasoningTags 并集：卡只写 ['Analysis']（∈默认集）→ 恒等默认集（ST 原生思考族保留）；
    // 卡自定义新标记追加
    expect(withDefaults({ reasoningTags: ['Analysis'] }).reasoningTags).toEqual(PROTO_DEFAULT.reasoningTags)
    expect(withDefaults({ reasoningTags: ['MyThink'] }).reasoningTags)
      .toEqual([...PROTO_DEFAULT.reasoningTags, 'MyThink'])
  })

  it('批次修复 1：stateUpdateTags 取并集——存量显式配置也并入 MVU 两代标记', () => {
    expect(PROTO_DEFAULT.stateUpdateTags).toEqual(['UpdateVariable', 'VariableInsert', 'VariableUpdate'])
    // 旧工作区 rp.json 显式写了 ['UpdateVariable']：VariableInsert/VariableUpdate 仍并入
    expect(withDefaults({ stateUpdateTags: ['UpdateVariable'] }).stateUpdateTags)
      .toEqual(['UpdateVariable', 'VariableInsert', 'VariableUpdate'])
    // 用户自定义标记保留且去重
    expect(withDefaults({ stateUpdateTags: ['MyTag', 'VariableInsert'] }).stateUpdateTags)
      .toEqual(['MyTag', 'VariableInsert', 'UpdateVariable', 'VariableUpdate'])
  })
})

// ---------------------------------------------------------------------------
// 批次修复 1：MVU 两代标记（VariableInsert/VariableUpdate 裸 JSON 块）——
// 真机实测这些块被裸文本显示；现在应提取为 state-update 段落（渲染层折叠块）
// ---------------------------------------------------------------------------

const MVU_SAMPLE = `她合上书本。
<VariableInsert>{"stat_data": {"好感度": 12, "地点": "图书馆"}, "meta": {"turn": 3}}</VariableInsert>`

describe('批次修复 1：VariableInsert/VariableUpdate 折叠块', () => {
  it('VariableInsert 块提取为 state-update 段落，正文无裸 JSON/标签', () => {
    const segs = applyOutputProtocolSegments(MVU_SAMPLE, PROTO_DEFAULT)
    const su = segs.find(s => s.kind === 'state-update') as { raw: string; analysis: string | null; patches: string | null }
    expect(su).toBeDefined()
    expect(su.analysis).toBeNull()
    expect(su.patches).toBeNull()
    const parsed = parseVariableJson(su.raw)
    expect(parsed?.keys).toBe(2) // stat_data + meta → 「变量更新 · 2 键」
    expect(parsed?.pretty).toContain('好感度')
    const text = segs.filter(s => s.kind === 'text').map(s => (s as { content: string }).content).join('')
    expect(text).not.toMatch(/VariableInsert|好感度/)
    expect(text).toContain('她合上书本')
  })

  it('VariableUpdate 同样识别；与 UpdateVariable 共存于默认配置', () => {
    const text = '正文<VariableUpdate>{"a": 1}</VariableUpdate>'
    const segs = applyOutputProtocolSegments(text, PROTO_DEFAULT)
    expect(segs.some(s => s.kind === 'state-update')).toBe(true)
    // 兼容 API：display 不含块
    expect(applyOutputProtocol(text, PROTO_DEFAULT).display).toBe('正文')
  })

  it('存量显式 stateUpdateTags 配置的工作区也识别两代标记（withDefaults 并集）', () => {
    const proto = withDefaults({ stateUpdateTags: ['UpdateVariable'] })
    const segs = applyOutputProtocolSegments('正文<VariableInsert>{"x": {}}</VariableInsert>', proto)
    expect(segs.some(s => s.kind === 'state-update')).toBe(true)
  })

  it('流式悬空 VariableInsert 开标签先行剥离（闭合前不闪原始标签）', () => {
    const partial = '正文<VariableInsert>{"stat_data": 半截'
    const segs = applyOutputProtocolSegments(partial, PROTO_DEFAULT, true)
    expect(JSON.stringify(segs)).not.toMatch(/<VariableInsert>/)
  })

  it('parseVariableJson：非对象 JSON / 坏 JSON 返回 null（渲染层回退原文 pre）', () => {
    expect(parseVariableJson('[1,2]')).toBeNull()
    expect(parseVariableJson('"str"')).toBeNull()
    expect(parseVariableJson('不是 JSON')).toBeNull()
    expect(parseVariableJson(' {"k": 1} ')?.keys).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// T2.10 有序段落模型：用户实测样本（MVU UpdateVariable + Analysis + JSONPatch +
// details 实时总结 + foreshadowings 伏笔登记册）
// ---------------------------------------------------------------------------

const USER_SAMPLE = `<content>她抬起头。</content>
<UpdateVariable> <Analysis> - Time advanced: same morning. - Dramatic updates allowed: yes. </Analysis> <JSONPatch> [ { "op": "delta", "path": "/云梦璃/好感度", "value": 3 } ] </JSONPatch> </UpdateVariable>
<details> <summary>实时总结</summary> - Limi回应云梦璃的告白。 - 两人在晨光中建立新的平衡。 </details>
<foreshadowings> <details> <summary>当前伏笔</summary> - 手铐钥匙的去向。 </details> </foreshadowings>`

describe('T2.10 有序段落模型（applyOutputProtocolSegments）', () => {
  it('用户实测样本五类段落全部结构化提取，正文无裸标签', () => {
    const segs = applyOutputProtocolSegments(USER_SAMPLE, PROTO_DEFAULT)
    const kinds = segs.map(s => s.kind)
    expect(kinds).toContain('text')          // 剥壳后正文「她抬起头。」
    expect(kinds).toContain('state-update')  // UpdateVariable 整块
    expect(kinds).toContain('collapsible')   // details 实时总结
    expect(kinds).toContain('foreshadowing') // foreshadowings 面板
    // 无泄漏断言：兼容 API 的 display（正文）不含任何协议标签
    const r = applyOutputProtocol(USER_SAMPLE, PROTO_DEFAULT)
    expect(r.display).not.toMatch(/<UpdateVariable>|<JSONPatch>|<foreshadowings>|<details>/)
  })

  it('state-update 段落：Analysis 与 JSONPatch 分体解析', () => {
    const segs = applyOutputProtocolSegments(USER_SAMPLE, PROTO_DEFAULT)
    const su = segs.find(s => s.kind === 'state-update') as { analysis: string | null; patches: string | null }
    expect(su.analysis).toContain('Time advanced')
    expect(su.patches).toContain('delta')
    // 兼容 API：display 不含协议块
    const r = applyOutputProtocol(USER_SAMPLE, PROTO_DEFAULT)
    expect(r.display).toBe('她抬起头。')
  })

  it('collapsible 段落：summary 标题与内容分离', () => {
    const segs = applyOutputProtocolSegments(USER_SAMPLE, PROTO_DEFAULT)
    const cl = segs.find(s => s.kind === 'collapsible') as { title: string; content: string }
    expect(cl.title).toBe('实时总结')
    expect(cl.content).toContain('晨光')
  })

  it('foreshadowing 段落：内层 details 保留给面板逐条渲染', () => {
    const segs = applyOutputProtocolSegments(USER_SAMPLE, PROTO_DEFAULT)
    const fs = segs.find(s => s.kind === 'foreshadowing') as { content: string }
    expect(fs.content).toContain('<summary>当前伏笔</summary>')
  })

  it('段落位置保持：details 在正文中段时按原位输出', () => {
    const segs = applyOutputProtocolSegments('前文。<details><summary>注</summary>内容</details>后文。', PROTO_DEFAULT)
    expect(segs.map(s => s.kind)).toEqual(['text', 'collapsible', 'text'])
    expect((segs[0] as { content: string }).content).toContain('前文')
    expect((segs[2] as { content: string }).content).toContain('后文')
  })

  it('行动选项段落统一移到末尾（ST 形态）', () => {
    const segs = applyOutputProtocolSegments('<a>选项A</a>正文<a>选项B</a>', PROTO_DEFAULT)
    expect(segs[segs.length - 1].kind).toBe('action')
    expect(segs.filter(s => s.kind === 'action')).toHaveLength(2)
  })

  it('流式悬空开标签（含 summary）先行剥离', () => {
    const partial = '正文<UpdateVariable> <Analysis> 半截思考'
    const segs = applyOutputProtocolSegments(partial, PROTO_DEFAULT, true)
    expect(JSON.stringify(segs)).not.toMatch(/<UpdateVariable>|<Analysis>/)
    expect((segs.find(s => s.kind === 'text') as { content: string }).content).toContain('半截思考')
  })
})

describe('T2.10 结构解析器', () => {
  it('parseStateUpdateBlock：Analysis/JSONPatch 子块提取（缺失容错）', () => {
    const r = parseStateUpdateBlock('<Analysis>推理</Analysis><JSONPatch>[{"op":"add","path":"/a","value":1}]</JSONPatch>')
    expect(r.analysis).toBe('推理')
    expect(r.patches).toContain('"op"')
    expect(parseStateUpdateBlock('裸内容')).toEqual({ analysis: null, patches: null })
  })

  it('parseJsonPatches：RFC 6902 行解析（delta op / 嵌套 value / 坏 JSON 返回 null）', () => {
    const rows = parseJsonPatches('[{"op":"delta","path":"/云梦璃/好感度","value":3},{"op":"replace","path":"/地点","value":"咖啡厅"}]')
    expect(rows).toEqual([
      { op: 'delta', path: '/云梦璃/好感度', value: '3' },
      { op: 'replace', path: '/地点', value: '咖啡厅' },
    ])
    expect(parseJsonPatches('不是 JSON')).toBeNull()
    expect(parseJsonPatches('{"op":"x"}')).toBeNull() // 非数组
  })
})
