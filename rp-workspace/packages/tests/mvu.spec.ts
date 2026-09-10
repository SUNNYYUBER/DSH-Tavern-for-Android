import { describe, it, expect } from 'vitest'
import {
  parseUpdateVariable,
  parseJsonPatches,
  applyStatePatches,
  renderStateSummary,
  flattenState,
  parseYamlLite,
  parseUnderscoreCommands,
  deepMergeInitVars,
} from '../src/state/mvu.ts'

describe('parseUpdateVariable（T2.3：assistant 消息 → JSONPatch 提取）', () => {
  it('示例预设 V8.8 实证结构：UpdateVariable 内 JSONPatch（op=delta 增量）', () => {
    const text = `<content>她抬起头。</content>
<UpdateVariable> <Analysis> - Time advanced: same morning. - Cloud Dream's favorability increases. </Analysis> <JSONPatch> [ { "op": "delta", "path": "/云梦璃/好感度", "value": 3 } ] </JSONPatch> </UpdateVariable>`
    const patches = parseUpdateVariable(text)
    expect(patches).toHaveLength(1)
    expect(patches[0].op).toBe('delta')
    expect(patches[0].path).toBe('/云梦璃/好感度')
    expect(patches[0].value).toBe(3)
  })

  it('多个 UpdateVariable 块 + 裸 JSONPatch 兜底', () => {
    const text = `<UpdateVariable><JSONPatch>[{"op":"add","path":"/location","value":"咖啡厅"}]</JSONPatch></UpdateVariable>
<UpdateVariable><JSONPatch>[{"op":"replace","path":"/flag","value":true}]</JSONPatch></UpdateVariable>
<JSONPatch>[{"op":"remove","path":"/old"}]</JSONPatch>`
    const patches = parseUpdateVariable(text)
    expect(patches).toHaveLength(3)
  })

  it('坏 JSON / 空 path 不崩并过滤', () => {
    const text = `<UpdateVariable><JSONPatch>not-json</JSONPatch></UpdateVariable>`
    expect(parseUpdateVariable(text)).toEqual([])
    const bad = parseUpdateVariable(`<JSONPatch>[{"op":"add","value":1}]</JSONPatch>`) // 无 path
    expect(bad).toHaveLength(0)
  })
})

describe('applyStatePatches（JSONPointer 逐层建对象 + delta/remove）', () => {
  it('delta 数值累加（浮点安全）', () => {
    const s = applyStatePatches({ 云梦璃: { 好感度: 5 } }, [{ op: 'delta', path: '/云梦璃/好感度', value: 3 }])
    expect((s.云梦璃 as Record<string, unknown>).好感度).toBe(8)
  })

  it('多级路径自动建中间对象', () => {
    const s = applyStatePatches({}, [{ op: 'add', path: '/角色/云梦璃/地点', value: '水族馆' }])
    expect(s).toEqual({ 角色: { 云梦璃: { 地点: '水族馆' } } })
  })

  it('remove 删除键；replace 覆盖', () => {
    const s = applyStatePatches({ a: 1, b: 2 }, [
      { op: 'remove', path: '/a' },
      { op: 'replace', path: '/b', value: 9 },
    ])
    expect(s).toEqual({ b: 9 })
  })

  it('JSONPointer 转义 ~1（/）', () => {
    const s = applyStatePatches({}, [{ op: 'add', path: '/a~1b', value: 1 }])
    expect(s).toEqual({ 'a/b': 1 })
  })
})

describe('renderStateSummary（状态树 → 模型友好摘要）', () => {
  it('嵌套扁平化为 点路径 key: value', () => {
    const summary = renderStateSummary({ 云梦璃: { 好感度: 8, 地点: '水族馆' }, flag: true })
    expect(summary).toContain('云梦璃.好感度: 8')
    expect(summary).toContain('云梦璃.地点: 水族馆')
    expect(summary).toContain('flag: true')
  })

  it('空状态返回空串（不注入）', () => {
    expect(renderStateSummary({})).toBe('')
  })

  it('flattenState 数组值 JSON 序列化', () => {
    const rows = flattenState({ list: [1, 2] })
    expect(rows).toEqual([['list', '[1,2]']])
  })
})

describe('【实机审计修复 2026-09-05】真实 MVU 运行期格式（ExampleGame ExampleWorld 取证）', () => {
  it('initvar YAML 树 → 叶子 set 型补丁；传 state 且顶层键缺失 → add', () => {
    const text = `<UpdateVariable><initvar>
stat_data:
  好感度: 0
  设定:
    地点: 学校
</initvar></UpdateVariable>`
    const patches = parseUpdateVariable(text)
    expect(patches).toEqual([
      { op: 'replace', path: '/stat_data/好感度', value: 0 },
      { op: 'replace', path: '/stat_data/设定/地点', value: '学校' },
    ])
    // 顶层键已存在 → replace；不存在 → add（initvar 初始化语义）
    expect(parseUpdateVariable(text, { stat_data: {} })[0].op).toBe('replace')
    expect(parseUpdateVariable(text, { other: 1 })[0].op).toBe('add')
  })

  it('initvar 数组叶（- item 一层）解析并应用', () => {
    const text = `<UpdateVariable><initvar>
角色:
  标签:
    - 温柔
    - 傲娇
  数量: 2
</initvar></UpdateVariable>`
    const patches = parseUpdateVariable(text)
    expect(patches).toContainEqual({ op: 'replace', path: '/角色/标签', value: ['温柔', '傲娇'] })
    expect(patches).toContainEqual({ op: 'replace', path: '/角色/数量', value: 2 })
    const st = applyStatePatches({}, patches)
    expect((st.角色 as Record<string, unknown>).标签).toEqual(['温柔', '傲娇'])
  })

  it('parseYamlLite：值内冒号保留 / 引号 / JSON 值 / 空值键占位', () => {
    expect(parseYamlLite('时间: 12:00\n开关: true')).toEqual({ 时间: '12:00', 开关: true })
    expect(parseYamlLite('名字: "云梦璃"\n空键:')).toEqual({ 名字: '云梦璃', 空键: {} })
    expect(parseYamlLite('# 注释\n---\na: 1')).toEqual({ a: 1 })
    expect(parseYamlLite('\n \n')).toBeNull()
  })

  it('_.set/_.add/_.inc/_.dec 指令行：点路径 → 统一形态，容忍全角括号', () => {
    const text = `<UpdateVariable>
<Analysis>时间推进。</Analysis>
_.set('stat_data.好感度', 3)
_.set（"地点", "水族馆"）
_.add('stat_data.好感度', 2)
_.inc('stat_data.精力')
_.dec('stat_data.体力', 2)
</UpdateVariable>`
    const patches = parseUnderscoreCommands(text)
    expect(patches).toContainEqual({ op: 'replace', path: '/stat_data/好感度', value: 3 })
    expect(patches).toContainEqual({ op: 'replace', path: '/地点', value: '水族馆' })
    expect(patches).toContainEqual({ op: 'delta', path: '/stat_data/好感度', value: 2 })
    expect(patches).toContainEqual({ op: 'delta', path: '/stat_data/精力', value: 1 })
    expect(patches).toContainEqual({ op: 'delta', path: '/stat_data/体力', value: -2 })
    const st = applyStatePatches({ stat_data: { 好感度: 1 } }, patches)
    expect((st.stat_data as Record<string, unknown>).好感度).toBe(5) // set 覆盖为 3，再 add 2
  })

  it('JSONPatch 补 move/copy/insert（数组按 index 插入）', () => {
    const text = `<UpdateVariable><JSONPatch>[
  {"op":"insert","path":"/列表","value":"新条目","index":1},
  {"op":"copy","from":"/a","path":"/b"},
  {"op":"move","from":"/a","path":"/c"}
]</JSONPatch></UpdateVariable>`
    const patches = parseJsonPatches(text)
    expect(patches[0]).toMatchObject({ op: 'insert', path: '/列表/1', value: '新条目' })
    expect(patches[1]).toMatchObject({ op: 'copy', from: '/a', path: '/b' })
    const st = applyStatePatches({ 列表: ['x', 'y'], a: { k: 1 } }, patches)
    expect(st.列表).toEqual(['x', '新条目', 'y'])
    expect(st.a).toBeUndefined() // move 后源位置删除
    expect(st.b).toEqual({ k: 1 }) // copy 深拷贝副本保留
    expect(st.c).toEqual({ k: 1 })
  })

  it('三种来源同块共存解析（initvar + JSONPatch + _.set 行）', () => {
    const text = `<UpdateVariable>
<initvar>
背景: 学院
</initvar>
<Analysis>好感上升。</Analysis>
<JSONPatch>[{"op":"delta","path":"/stat_data/好感度","value":1}]</JSONPatch>
_.set('stat_data.地点', '教室')
</UpdateVariable>`
    const patches = parseUpdateVariable(text)
    expect(patches).toHaveLength(3)
    expect(patches.some(p => p.path === '/背景' && p.value === '学院')).toBe(true)
    expect(patches.some(p => p.path === '/stat_data/好感度' && p.op === 'delta')).toBe(true)
    expect(patches.some(p => p.path === '/stat_data/地点' && p.value === '教室')).toBe(true)
    const st = applyStatePatches({}, patches)
    expect(st).toEqual({ 背景: '学院', stat_data: { 好感度: 1, 地点: '教室' } })
  })
})

describe('【鲁棒轮回归 2026-09-09】多 JSONPatch 块 / op 白名单 / 数组钳制', () => {
  it('单个 UpdateVariable 块内多个 JSONPatch 子块全部解析（原实现只取第一个）', () => {
    const text = `<UpdateVariable>
<JSONPatch>[{"op":"delta","path":"/好感度","value":1}]</JSONPatch>
<JSONPatch>[{"op":"delta","path":"/金币","value":50}]</JSONPatch>
</UpdateVariable>`
    const patches = parseUpdateVariable(text)
    expect(patches).toHaveLength(2)
    expect(patches.map(p => p.path)).toEqual(['/好感度', '/金币'])
  })

  it('未知 op（标准 test / 拼错 apend）被丢弃而非落入兜底赋值', () => {
    const patches = parseJsonPatches('<JSONPatch>[{"op":"test","path":"/好感度","value":null},{"op":"apend","path":"/x","value":1},{"op":"add","path":"/y","value":2}]</JSONPatch>')
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/y')
  })

  it('数组越界 add 追加尾部、replace 跳过（不再产生稀疏 null 槽）', () => {
    const state = { list: ['a', 'b'] }
    const next = applyStatePatches(state, [
      { op: 'add', path: '/list/5', value: 'x' },
      { op: 'replace', path: '/list/9', value: 'z' },
    ])
    expect(JSON.parse(JSON.stringify(next))).toEqual({ list: ['a', 'b', 'x'] })
  })

  it('坏 JSON 的第一个块不影响后续块解析', () => {
    const text = '<JSONPatch>[broken json</JSONPatch> <JSONPatch>[{"op":"add","path":"/ok","value":1}]</JSONPatch>'
    const patches = parseJsonPatches(text)
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/ok')
  })
})

// ---------------------------------------------------------------------------
// deepMergeInitVars（心跳 47 新增：该函数此前**从未存在**，调用点一直抛
// ReferenceError 并被"不阻塞"catch 吞掉 → D1 MVU initvar 开局变量初始化从未生效）
// ---------------------------------------------------------------------------
describe('deepMergeInitVars（开局变量：存量优先，只补缺口）', () => {
  it('顶层缺口按 init 补齐', () => {
    const out = deepMergeInitVars({ hp: 10 }, { hp: 999, mp: 5 })
    expect(out).toEqual({ hp: 10, mp: 5 })
  })

  it('存量叶值恒胜（世界书改了也不回档）', () => {
    const existing = { 云梦璃: { 好感度: 42, 已解锁: true } }
    const init = { 云梦璃: { 好感度: 0, 已解锁: false, 新字段: 1 } }
    expect(deepMergeInitVars(existing, init)).toEqual({
      云梦璃: { 好感度: 42, 已解锁: true, 新字段: 1 },
    })
  })

  it('数组整体保留存量，不做按下标的半合并', () => {
    const out = deepMergeInitVars({ items: [1, 2, 3] }, { items: [9] })
    expect(out.items).toEqual([1, 2, 3])
  })

  it('类型冲突时保留存量（对象 vs 标量 双向）', () => {
    expect(deepMergeInitVars({ a: 1 }, { a: { b: 2 } })).toEqual({ a: 1 })
    expect(deepMergeInitVars({ a: { b: 2 } }, { a: 1 })).toEqual({ a: { b: 2 } })
  })

  it('init 为 null 的对象键不覆盖已有值，但会填进缺失键', () => {
    const out = deepMergeInitVars({ x: 1 } as Record<string, unknown>, { x: { k: 1 }, y: null })
    expect(out).toEqual({ x: 1, y: null })
  })

  it('补进去的值是深拷贝——改结果不影响 init 树（init 树会被多处复用）', () => {
    const init = { cfg: { list: [1, 2], deep: { k: 1 } } }
    const out = deepMergeInitVars({}, init)
    ;(out.cfg as { list: number[] }).list.push(3)
    ;((out.cfg as { deep: { k: number } }).deep).k = 99
    expect(init.cfg.list).toEqual([1, 2])
    expect(init.cfg.deep.k).toBe(1)
  })

  it('不修改任何入参（纯函数）', () => {
    const existing = { a: { b: 1 } }
    const init = { a: { c: 2 }, d: 3 }
    const snapshotExisting = JSON.stringify(existing)
    const snapshotInit = JSON.stringify(init)
    deepMergeInitVars(existing, init)
    expect(JSON.stringify(existing)).toBe(snapshotExisting)
    expect(JSON.stringify(init)).toBe(snapshotInit)
  })

  it('幂等：对同一份 init 反复合并结果不变（mvuInitHash 重放的前提）', () => {
    const init = { a: { b: 1, c: 2 }, d: [1] }
    const once = deepMergeInitVars({ a: { b: 0 } }, init)
    const twice = deepMergeInitVars(once, init)
    expect(twice).toEqual(once)
  })

  it('空 init 不产生任何变化；空 existing 等价于取 init 的深拷贝', () => {
    const existing = { a: 1 }
    expect(deepMergeInitVars(existing, {})).toEqual({ a: 1 })
    const init = { a: { b: 2 } }
    expect(deepMergeInitVars({}, init)).toEqual(init)
    expect(deepMergeInitVars({}, init)).not.toBe(init)
  })
})
