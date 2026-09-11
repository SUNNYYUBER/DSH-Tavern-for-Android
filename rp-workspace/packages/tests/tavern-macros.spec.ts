import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expandTavernMacros, parseVarPath, readVarPath, registerMacro, toPointer, unregisterMacro, writeVarPath,
  type TavernMacroContext,
} from '../src/dsht-plugin-shared/macros.ts'
import {
  appendUndoEntries, clearUndoLog, diffUndoEntries, makeUndoEntry, readUndoLog, replayUndoLog,
} from '../src/dsht-plugin-shared/undo.ts'
import { renderStatusbarHtml, renderDefaultStatusbarHtml } from '../src/dsht-plugin-mvu/index.ts'
import { extractSkillBlocks, renderPresetSkillMd, importStPreset } from '../src/preset/st-import.ts'
import { compilePreset } from '../src/preset/compiler.ts'
import { readFileSync } from 'node:fs'

const ctx = (over: Partial<TavernMacroContext> = {}): TavernMacroContext => ({
  user: '旅行者',
  char: '丰川祥子',
  persona: '一名浪迹天涯的旅人',
  stableSeed: 'session-1',
  now: new Date('2026-08-26T15:30:00'),
  getVar: path => readVarPath({ stat_data: { 好感度: 42 }, location: '咖啡厅' }, path),
  ...over,
})

describe('宏引擎：路径工具', () => {
  it('点号与 JSONPointer 双兼容；toPointer 规范化', () => {
    expect(parseVarPath('a.b.c')).toEqual(['a', 'b', 'c'])
    expect(parseVarPath('/a/b')).toEqual(['a', 'b'])
    expect(parseVarPath('/a~1b')).toEqual(['a/b'])
    expect(toPointer('stat_data.好感度')).toBe('/stat_data/好感度')
  })
  it('readVarPath/writeVarPath 不改入参', () => {
    const t = { a: { b: 1 } }
    expect(readVarPath(t, 'a.b')).toBe(1)
    const n = writeVarPath(t, 'a.c', 2)
    expect(readVarPath(n, 'a.c')).toBe(2)
    expect(readVarPath(t, 'a.c')).toBeUndefined()
  })
})

describe('宏引擎：身份宏', () => {
  it('{{user}}/{{char}}/{{persona}}', () => {
    const r = expandTavernMacros('{{user}}（{{persona}}）遇见了{{char}}', ctx())
    expect(r.text).toBe('旅行者（一名浪迹天涯的旅人）遇见了丰川祥子')
    expect(r.unknownMacros).toEqual([])
  })
})

describe('宏引擎：变量宏（getvar/setvar）', () => {
  it('getvar 读合并视图（点路径与 :: 分隔）', () => {
    expect(expandTavernMacros('好感度={{getvar::stat_data.好感度}}', ctx()).text).toBe('好感度=42')
    expect(expandTavernMacros('地点={{getvar:location}}', ctx()).text).toBe('地点=咖啡厅') // 单 : 兼容
    expect(expandTavernMacros('缺={{getvar::nothing.here}}', ctx()).text).toBe('缺=')
  })
  it('setvar 输出空串并记录 writes；同文本后序 getvar 读回（顺序求值）', () => {
    const r = expandTavernMacros('{{setvar::think1::}}A{{setvar::location::屋顶}}B{{getvar::location}}', ctx())
    expect(r.text).toBe('AB屋顶')
    expect(r.writes).toEqual([
      { path: '/think1', value: '' },
      { path: '/location', value: '屋顶' },
    ])
  })
  it('setvar 值带空格 trim；回调触发', () => {
    const seen: Array<[string, string]> = []
    const r = expandTavernMacros('{{setvar::mvu:: 【状态栏输出模式】 正文完成后检查 }}', ctx({ setVar: (p, v) => seen.push([p, v]) }))
    expect(r.text).toBe('')
    expect(r.writes[0]).toEqual({ path: '/mvu', value: '【状态栏输出模式】 正文完成后检查' })
    expect(seen).toEqual([['/mvu', '【状态栏输出模式】 正文完成后检查']])
  })
})

describe('宏引擎：随机/稳定/骰子', () => {
  it('random 值域内（,: 与 :: 两种分隔）', () => {
    expect(['a', 'b', 'c']).toContain(expandTavernMacros('{{random:a,b,c}}', ctx()).text)
    expect(['x', 'y']).toContain(expandTavernMacros('{{random::x::y}}', ctx()).text)
  })
  // 心跳 51 补：`splitMacroList` 的 `\,` 转义此前**零测试覆盖**（源码里靠一对 NUL 哨兵实现，
  // 而该哨兵曾以**裸 NUL 字节**形式落在源码里 → git 把整个宏引擎文件判为二进制、diff 不可评审。
  // 已改为等价的 `\0` 转义写法；这两条测试既钉住转义语义，也证明改写前后行为一致）。
  it('逗号分隔支持 `\\,` 转义（单元素内含逗号）', () => {
    // 决定性用例：只有一项且项内含逗号 → 若转义失效会退化成 ['a','b']，结果只会是 'a' 或 'b'
    expect(expandTavernMacros('{{random:a\\,b}}', ctx()).text).toBe('a,b')
    // 混合：三项，中间那项自带逗号 → 结果值域必须包含 'b,c'
    expect(['a', 'b,c', 'd']).toContain(expandTavernMacros('{{random:a,b\\,c,d}}', ctx()).text)
  })
  it('`::` 形态优先，不做 `\\,` 还原（与基准 `splitMacroList` 的分支顺序一致）', () => {
    // 含 `::` 时直接按 `::` 切分，逗号与反斜杠都保持原样
    expect(expandTavernMacros('{{random::a\\,b::c}}', ctx()).text).toMatch(/^(a\\,b|c)$/)
  })
  it('pick 同文本同位置稳定；换种子独立', () => {
    const text = '{{pick::A::B::C}}-{{pick::A::B::C}}'
    expect(expandTavernMacros(text, ctx()).text).toBe(expandTavernMacros(text, ctx()).text)
    expect(expandTavernMacros(text, ctx({ stableSeed: 's2' })).text).toMatch(/^[ABC]-[ABC]$/)
  })
  it('roll::1d20 与纯数字 1dN', () => {
    const r = expandTavernMacros('{{roll::1d20}}', ctx())
    expect(Number(r.text)).toBeGreaterThanOrEqual(1)
    expect(Number(r.text)).toBeLessThanOrEqual(20)
    const r2 = expandTavernMacros('{{roll:6}}', ctx())
    expect(Number(r2.text)).toBeLessThanOrEqual(6)
  })
})

describe('宏引擎：时间宏（注入 now）', () => {
  it('time/date/datetime/weekday', () => {
    expect(expandTavernMacros('{{time}}', ctx()).text).toBe('15:30')
    expect(expandTavernMacros('{{date}}', ctx()).text).toBe('2026/8/26')
    expect(expandTavernMacros('{{datetime}}', ctx()).text).toBe('2026/8/26 15:30')
    expect(expandTavernMacros('{{weekday}}', ctx()).text).toBe('星期三') // 2026-08-26 = 周三
  })
})

describe('宏引擎：注释/noop/未知宏', () => {
  it('{{// 注释}}剥离、{{!…}}删除、{{noop}}空串', () => {
    expect(expandTavernMacros('A{{// 致谢}}B{{noop}}C', ctx()).text).toBe('ABC')
    expect(expandTavernMacros('X{{! 整段说明文字}}Y', ctx()).text).toBe('XY')
  })
  it('未知宏原样保留（不炸不吞）', () => {
    const r = expandTavernMacros('前 {{lastUserMessage}} 后', ctx())
    expect(r.text).toBe('前 {{lastUserMessage}} 后')
    expect(r.unknownMacros).toEqual(['{{lastUserMessage}}'])
  })
})

describe('宏引擎：数值写宏（addvar/incvar/decvar）', () => {
  it('addvar 在现值上加算（非数按 0），输出空串并记录 writes', () => {
    const r = expandTavernMacros('{{setvar::n::5}}{{addvar::n::3}}[{{getvar::n}}]', ctx())
    expect(r.text).toBe('[8]')
    expect(r.writes).toEqual([{ path: '/n', value: '5' }, { path: '/n', value: '8' }])
    // 变量不存在：0 起步
    const r2 = expandTavernMacros('{{addvar::fresh::2}}{{getvar::fresh}}', ctx())
    expect(r2.text).toBe('2')
  })
  it('incvar/decvar ±1（读合并视图现值）', () => {
    // ctx.getVar 里 stat_data.好感度 = 42
    const r = expandTavernMacros('{{incvar::stat_data.好感度}}{{getvar::stat_data.好感度}}', ctx())
    expect(r.text).toBe('43')
    expect(r.writes).toEqual([{ path: '/stat_data/好感度', value: '43' }])
    const r2 = expandTavernMacros('{{decvar::stat_data.好感度}}{{getvar::stat_data.好感度}}', ctx())
    expect(r2.text).toBe('41')
  })
})

// ---------------------------------------------------------------------------
// T-22 全局变量宏族（{{setglobalvar}} 等）——真卡大量使用，此前只落了斜杠形态
// ---------------------------------------------------------------------------

describe('宏引擎：全局变量宏族（T-22）', () => {
  const gctx = (over: Partial<TavernMacroContext> = {}): TavernMacroContext => ctx({
    getVar: () => undefined,
    scopeGet: (kind, path) => readVarPath(
      kind === 'global' ? { sleep_var_zishu: '400字', gcount: '5' } : {},
      path,
    ),
    ...over,
  })

  it('setglobalvar 输出空串并标 scope=global（次序求值可读回）', () => {
    const r = expandTavernMacros('{{setglobalvar::sleep_var_wenfeng::文风设定：白描}}A{{getglobalvar::sleep_var_wenfeng}}', gctx())
    expect(r.text).toBe('A文风设定：白描')
    expect(r.writes).toEqual([{ path: '/sleep_var_wenfeng', value: '文风设定：白描', scope: 'global' }])
    expect(r.unknownMacros).toEqual([])
  })

  it('setglobalvar 允许空值（初始化语义 {{setglobalvar::x::}}）', () => {
    const r = expandTavernMacros('{{setglobalvar::init_only::}}', gctx())
    expect(r.text).toBe('')
    expect(r.writes).toEqual([{ path: '/init_only', value: '', scope: 'global' }])
  })

  it('getglobalvar 只读全局树，不落三级合并视图', () => {
    // ctx.getVar 返回 { stat_data: {...}, location: '咖啡厅' }，但 scopeGet(global) 只有 sleep_var_*
    const r = expandTavernMacros('{{getglobalvar::sleep_var_zishu}}|{{getglobalvar::location}}', gctx())
    expect(r.text).toBe('400字|')
  })

  it('addglobalvar / incglobalvar / decglobalvar 在全局现值上加减', () => {
    const add = expandTavernMacros('{{addglobalvar::gcount::3}}{{getglobalvar::gcount}}', gctx())
    expect(add.text).toBe('8')
    expect(add.writes).toEqual([{ path: '/gcount', value: '8', scope: 'global' }])
    const inc = expandTavernMacros('{{incglobalvar::gcount}}{{getglobalvar::gcount}}', gctx())
    expect(inc.text).toBe('6')
    const dec = expandTavernMacros('{{decglobalvar::gcount}}{{getglobalvar::gcount}}', gctx())
    expect(dec.text).toBe('4')
  })

  it('局部族（setvar 系）不带 scope，仍由调用方按会话就近落盘', () => {
    const r = expandTavernMacros('{{setvar::local::1}}{{addvar::local::2}}', gctx())
    expect(r.writes).toEqual([
      { path: '/local', value: '1' },
      { path: '/local', value: '3' },
    ])
  })

  it('已注册为内置名：registerMacro 拒绝覆盖（与 getvar 同档）', () => {
    expect(() => registerMacro('setglobalvar', 'x')).toThrow(/built-in/)
    expect(() => registerMacro('getglobalvar', 'x')).toThrow(/built-in/)
  })
})

describe('宏引擎：dice 别名与 ISO 时间', () => {
  it('{{dice::2d6}} 值域 2..12', () => {
    const r = expandTavernMacros('{{dice::2d6}}', ctx())
    expect(Number(r.text)).toBeGreaterThanOrEqual(2)
    expect(Number(r.text)).toBeLessThanOrEqual(12)
  })
  it('{{isotime}}=HH:MM:SS、{{isodate}}=YYYY-MM-DD（本地时区）', () => {
    expect(expandTavernMacros('{{isotime}}', ctx()).text).toBe('15:30:00')
    expect(expandTavernMacros('{{isodate}}', ctx()).text).toBe('2026-08-26')
  })
})

describe('宏引擎：嵌套宏迭代展开', () => {
  it('变量值里的宏再展开（getvar → {{time}}）', () => {
    const r = expandTavernMacros('{{getvar::tpl}}', ctx({ getVar: () => '现在{{time}}' }))
    expect(r.text).toBe('现在15:30')
  })
  it('多层嵌套逐轮展开；setvar 产物不重复写', () => {
    // l1 → {{getvar::l2}}，l2 → {{char}}：两轮展开到位
    const vars = { l1: '{{getvar::l2}}', l2: '{{char}}' }
    const r = expandTavernMacros('{{getvar::l1}}', ctx({ getVar: p => readVarPath(vars, p) }))
    expect(r.text).toBe('丰川祥子')
    // 内层 {{time}} 先展开，下轮 setvar 才匹配落盘一次（不重复写）
    const r2 = expandTavernMacros('{{setvar::a::{{time}}}}', ctx())
    expect(r2.text).toBe('')
    expect(r2.writes).toEqual([{ path: '/a', value: '15:30' }])
  })
  it('自引用宏 10 轮上限收敛（不死循环）', () => {
    const r = expandTavernMacros('{{getvar::x}}', ctx({ getVar: () => '{{getvar::x}}' }))
    expect(r.text).toBe('{{getvar::x}}') // 每轮产出相同文本 → 首轮即收敛
    // 每轮产物仍含宏且文本在变 → 迭代到上限即停，输出有界
    const r2 = expandTavernMacros('{{getvar::y}}', ctx({ getVar: () => '{{getvar::y}}!' }))
    expect(r2.text.length).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// 任务 4：undo 日志
// ---------------------------------------------------------------------------

describe('undo 日志：条目构造与差异', () => {
  it('makeUndoEntry 记录旧值与存在性', () => {
    const e = makeUndoEntry('chat', '', '/a/b', { a: { b: 1 } }, 1000)
    expect(e).toEqual({ ts: 1000, scope: 'chat', slug: '', path: '/a/b', oldValue: 1, had: true })
    const e2 = makeUndoEntry('global', '', 'x.y', {}, 1000)
    expect(e2.had).toBe(false)
    expect(e2.path).toBe('/x/y')
  })
  it('diffUndoEntries：变更叶记录旧值，删除键也记录，未变不记', () => {
    const entries = diffUndoEntries('chat', '', { a: 1, gone: 'x', same: 1 }, { a: 2, same: 1, b: 3 }, 1000)
    const byPath = new Map(entries.map(e => [e.path, e]))
    expect(byPath.get('/a')).toMatchObject({ oldValue: 1, had: true })
    expect(byPath.get('/b')).toMatchObject({ had: false })
    expect(byPath.get('/gone')).toMatchObject({ oldValue: 'x', had: true })
    expect(byPath.has('/same')).toBe(false)
  })
})

describe('undo 日志：落盘与回放（tmp DSH_HOME）', () => {
  it('append/read/clear + replayUndoLog 恢复 chat 作用域旧值并截断日志', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsht-undo-'))
    try {
      const sid = 's1'
      // 会话状态文件：variables 初始 {好感度: 1}
      await mkdir(join(home, 'rp', 'state'), { recursive: true })
      await writeFile(join(home, 'rp', 'state', `${sid}.json`), JSON.stringify({ variables: { 好感度: 1 } }), 'utf8')
      await appendUndoEntries(home, sid, [
        makeUndoEntry('chat', '', '/好感度', { 好感度: 1 }, 1000), // 第一次写前旧值 1
        makeUndoEntry('chat', '', '/好感度', { 好感度: 5 }, 2000), // 第二次写前旧值 5
        makeUndoEntry('chat', '', '/地点', {}, 2000),
      ])
      expect((await readUndoLog(home, sid)).length).toBe(3)
      // 当前变量树 = 两次写入后：{好感度: 10, 地点: 'x'}
      await writeFile(join(home, 'rp', 'state', `${sid}.json`), JSON.stringify({ variables: { 好感度: 10, 地点: 'x' } }), 'utf8')
      // 回放到 ts=1500：只回放 ts>1500 的两条（倒序）→ 好感度回 5，地点删除
      const r = await replayUndoLog(home, sid, 1500)
      expect(r.restored).toBe(2)
      const vars = JSON.parse(await readFile(join(home, 'rp', 'state', `${sid}.json`), 'utf8')).variables
      expect(vars['好感度']).toBe(5)
      expect('地点' in vars).toBe(false)
      // 日志截断到 ts<=1500
      expect((await readUndoLog(home, sid)).length).toBe(1)
      // 全部回放（缺省 cutoff=∞）→ 好感度回到最初 1，日志清空
      const r2 = await replayUndoLog(home, sid)
      expect(r2.restored).toBe(1)
      expect(JSON.parse(await readFile(join(home, 'rp', 'state', `${sid}.json`), 'utf8')).variables['好感度']).toBe(1)
      expect((await readUndoLog(home, sid)).length).toBe(0)
      await clearUndoLog(home, sid) // 幂等不炸
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('回放同时恢复 global/character 作用域', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsht-undo2-'))
    try {
      const sid = 's2'
      await mkdir(join(home, 'rp', 'variables'), { recursive: true })
      await mkdir(join(home, 'rp', 'demo-slug'), { recursive: true })
      await writeFile(join(home, 'rp', 'variables', 'global.json'), JSON.stringify({ g: 'new' }), 'utf8')
      await writeFile(join(home, 'rp', 'demo-slug', 'variables.json'), JSON.stringify({ c: 'new' }), 'utf8')
      await appendUndoEntries(home, sid, [
        { ts: 100, scope: 'global', slug: '', path: '/g', oldValue: 'old', had: true },
        { ts: 100, scope: 'character', slug: 'demo-slug', path: '/c', oldValue: 'old', had: true },
      ])
      const r = await replayUndoLog(home, sid, 0)
      expect(r.restored).toBe(2)
      expect(JSON.parse(await readFile(join(home, 'rp', 'variables', 'global.json'), 'utf8')).g).toBe('old')
      expect(JSON.parse(await readFile(join(home, 'rp', 'demo-slug', 'variables.json'), 'utf8')).c).toBe('old')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 任务 5：状态栏渲染
// ---------------------------------------------------------------------------

describe('状态栏渲染（StatusPlaceHolderImpl 占位符数据源）', () => {
  const vars = { stat_data: { 好感度: 42, 地点: '咖啡厅' } }
  const lookup = (p: string): unknown => readVarPath(vars, p)
  it('裸 {{path}} 变量引用 + HTML 转义 + 换行 <br>', () => {
    const html = renderStatusbarHtml('好感度：{{stat_data.好感度}}\n地点：{{stat_data.地点}}', lookup)
    expect(html).toBe('好感度：42<br>地点：咖啡厅')
  })
  it('getvar 宏与未知引用', () => {
    const html = renderStatusbarHtml('{{getvar::stat_data.好感度}} / {{不存在}}', lookup)
    expect(html).toBe('42 / {{不存在}}')
  })
  it('模板/值里的 HTML 全部转义（安全文本段）', () => {
    const html = renderStatusbarHtml('<b>{{stat_data.地点}}</b>', () => '<script>x</script>')
    expect(html).toBe('&lt;b&gt;&lt;script&gt;x&lt;/script&gt;&lt;/b&gt;')
  })
  it('无配置默认两栏：只渲染变量树里存在的 时间/地点/好感度（root 与 stat_data 都查）', () => {
    const html = renderDefaultStatusbarHtml(lookup)
    expect(html).toContain('<b>地点</b> 咖啡厅')
    expect(html).toContain('<b>好感度</b> 42')
    expect(html).not.toContain('时间') // 变量树无此键 → 不渲染
    expect(html).toMatch(/^<div class="mvu-sb"/)
    // root 层直挂也认
    expect(renderDefaultStatusbarHtml(p => readVarPath({ 时间: '清晨' }, p))).toContain('<b>时间</b> 清晨')
    // 一个都没有 → 空串
    expect(renderDefaultStatusbarHtml(() => undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 任务 3：agent 预设 skill 提取（真实「[Agent] V14.7 示例预设 · 示例角色」裁剪夹具）
// ---------------------------------------------------------------------------

describe('agent 预设适配：模块化内容块 → DSH skills', () => {
  const fixture = readFileSync(join(__dirname, 'fixtures', 'agent-preset-fox-trimmed.json'), 'utf8')

  it('真实预设裁剪件：skill 块提取（references 路径引用 + SKILL 能力声明头）', () => {
    const { preset, skills } = importStPreset(fixture, '[Agent] V14.7 示例预设 · 示例角色')
    expect(preset.path).toBe('agent') // [Agent] 名字标注
    // 防文风/要文风条目内容引用 example-style-rules/references/….md → 提取为 skill
    expect(skills.length).toBeGreaterThanOrEqual(2)
    const faqing = skills.find(s => s.label.includes('文风'))
    expect(faqing).toBeDefined()
    expect(faqing!.dir).toMatch(/^skills\/preset-[a-z0-9-]+\/[a-z0-9-]+$/)
    expect(faqing!.content).toContain('example-style-rules/references/')
    // SKILL.md 形态：frontmatter + 手册正文（setvar 包装已拆，注释已剥）
    const md = renderPresetSkillMd(preset.displayName, faqing!)
    expect(md).toMatch(/^---\nname: [a-z0-9-]+\ndescription: .+\nwhenToUse: .+\n---/)
    expect(md).not.toContain('{{setvar')
    expect(md).not.toContain('{{//')
    // 组头注释条目（----…————）与普通 setvar 块（选项助手）不被误判为 skill
    expect(skills.some(s => s.label.startsWith('----'))).toBe(false)
    expect(skills.some(s => s.label.includes('选项助手'))).toBe(false)
  })

  it('oneshot 预设不提取 skill', () => {
    const { preset, skills } = importStPreset(fixture, '[主预设] V17.1 示例预设')
    expect(preset.path).toBe('direct')
    expect(skills).toEqual([])
  })

  it('agent 型 preset.yml description 标注技能块数量', () => {
    const { preset, skills } = importStPreset(fixture, '[Agent] V14.7 示例预设 · 示例角色')
    expect(preset.description).toContain('agent 编排型')
    expect(preset.description).toContain(`含 ${skills.length} 个技能块已转 DSH skills`)
    expect(skills.length).toBeGreaterThanOrEqual(2)
    // oneshot 不标注
    const oneshot = importStPreset(fixture, '[主预设] V17.1 示例预设').preset
    expect(oneshot.description).toContain('oneshot 单轮直出')
    expect(oneshot.description).not.toContain('技能块')
  })

  it('agent 形态 agent.cordis.yml：persona 正文 + agent-instructions 行', () => {
    const { preset } = importStPreset(fixture, '[Agent] V14.7 示例预设 · 示例角色')
    const files = compilePreset(preset, { user: '旅人', char: '角色' })
    const yml = files.find(f => f.path.endsWith('agent.cordis.yml'))!.content
    expect(yml).toContain('- id: persona')
    expect(yml).toContain('- id: agent-instructions')
    expect(yml).toContain("'@deepseek-ai/dsh-agent-instructions'")
    expect(yml).toContain('- id: skill-filesystem')
  })

  it('direct 预设不挂 agent-instructions 行', () => {
    const { preset } = importStPreset(fixture, '[主预设] V17.1 示例预设')
    const yml = compilePreset(preset, { user: '旅人', char: '角色' }).find(f => f.path.endsWith('agent.cordis.yml'))!.content
    expect(yml).not.toContain('agent-instructions')
  })

  it('unwrapMacroWrappers 之外的通用提取：手写条目同样适用（不写死示例预设）', () => {
    const blocks = extractSkillBlocks('st-x', [
      { identifier: 'a', name: '普通条目', content: '普通的叙事要求，不含任何手册形态', marker: false },
      { identifier: 'b', name: '画画手册', content: '{{setvar::image:: # IMG_SKILL：画图=启用\n仅当涉及画图时，Agent 才读取：\nfox-image/references/画图.md\n}}', marker: false },
      { identifier: 'h', name: '----分组头————', content: '', marker: false },
      { identifier: 'm', name: 'Chat History', marker: true },
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].label).toBe('画画手册')
    expect(blocks[0].content).toContain('# IMG_SKILL：画图=启用')
  })
})

// ---------------------------------------------------------------------------
// T-44 / 心跳 51：动态宏（dynamicMacros）与 postProcess（substituteParams 语义）
// 基准：`MacroEngine.#resolveMacro`（public/scripts/macros/engine/MacroEngine.js:178-228）
//       `MacroEnvBuilder`（…/MacroEnvBuilder.js:152/161-163）
// ---------------------------------------------------------------------------
describe('宏引擎：dynamicMacros（ST substituteParams 的 additionalMacro）', () => {
  it('字符串形态直出；函数形态收到 args 与 ctx', () => {
    const dyn = { greet: '你好', shout: (args: string) => `!${args}!` }
    expect(expandTavernMacros('{{greet}}|{{shout::嘿}}', ctx({ dynamicMacros: dyn })).text).toBe('你好|!嘿!')
  })

  it('键大小写不敏感（基准在装配阶段就 key.toLowerCase() 归一）', () => {
    expect(expandTavernMacros('{{DYN}}', ctx({ dynamicMacros: { Dyn: 'V' } })).text).toBe('V')
    expect(expandTavernMacros('{{dyn}}', ctx({ dynamicMacros: { DYN: 'V' } })).text).toBe('V')
  })

  it('动态宏**优先于**已注册宏（基准：命中即 defOverride 覆盖注册表）', () => {
    // 负控：不传 dynamicMacros 时应回落到注册表值
    const NAME = 't44RegOverride'
    try {
      registerMacro(NAME, 'REG')
      expect(expandTavernMacros(`{{${NAME}}}`, ctx()).text).toBe('REG')
      expect(expandTavernMacros(`{{${NAME}}}`, ctx({ dynamicMacros: { [NAME]: 'DYN' } })).text).toBe('DYN')
    } finally { unregisterMacro(NAME) }
  })

  it('函数抛错 → 保留原文（不炸整段）', () => {
    const dyn = { boom: () => { throw new Error('x') } }
    expect(expandTavernMacros('a{{boom}}b', ctx({ dynamicMacros: dyn })).text).toBe('a{{boom}}b')
  })

  it('未传 dynamicMacros 时行为不变（向后兼容）', () => {
    expect(expandTavernMacros('{{user}}', ctx()).text).toBe('旅行者')
    expect(expandTavernMacros('{{nope}}', ctx()).text).toBe('{{nope}}')
  })
})

describe('宏引擎：postProcess（ST postProcessFn）', () => {
  it('逐个已解析宏结果加工（不是加工整段文本）', () => {
    const r = expandTavernMacros('{{char}} 与 {{user}}', ctx({ postProcess: v => `[${v}]` }))
    // 若错加工整段会得到 "[丰川祥子 与 旅行者]"；正确为两个独立包裹
    expect(r.text).toBe('[丰川祥子] 与 [旅行者]')
  })

  it('未识别宏**不**经 postProcess（基准：未知宏在 executeMacro 之前就 return raw）', () => {
    const r = expandTavernMacros('{{unknownMacro}}', ctx({ postProcess: v => `ESCAPED(${v})` }))
    expect(r.text).toBe('{{unknownMacro}}')
    expect(r.unknownMacros).toEqual(['{{unknownMacro}}'])
  })

  it('钩子抛错 → 返回未加工结果（基准 catch 后 return result）', () => {
    const r = expandTavernMacros('{{char}}', ctx({ postProcess: () => { throw new Error('boom') } }))
    expect(r.text).toBe('丰川祥子')
  })

  it('注释宏属于**已注册**宏（基准 core-macros.js:282 注册 // ），故会经 postProcess', () => {
    expect(expandTavernMacros('{{// c}}ok', ctx({ postProcess: v => `[${v}]` })).text).toBe('[]ok')
  })

  it('未传 postProcess 时行为不变（向后兼容）', () => {
    expect(expandTavernMacros('{{char}}', ctx()).text).toBe('丰川祥子')
  })
})
