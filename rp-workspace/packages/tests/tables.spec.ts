import { describe, it, expect } from 'vitest'
import {
  parseTableEdits,
  executeTableEdits,
  expandTableMacros,
  parseA1Address,
  type Sheet,
} from '../src/dsht-plugin-memory/tables.ts'

/** 测试表集：2 张表（第 2 张禁用，验证函数调用式按启用表过滤后下标寻址） */
function fixtureSheets(): Sheet[] {
  return [
    {
      uid: 't1',
      name: '状态',
      headers: ['时间', '地点', '人物'],
      rows: [['上午', '学校', '云梦璃'], ['中午', '食堂', '云梦璃']],
      enabled: true,
    },
    {
      uid: 't2',
      name: '事件',
      headers: ['事件', '结果'],
      rows: [['相遇', '相识']],
      enabled: false,
    },
    {
      uid: 't3',
      name: '社交',
      headers: ['角色', '好感'],
      rows: [['悠悠', '50']],
      enabled: true,
    },
  ]
}

describe('parseTableEdits（旧分号式兼容回退）', () => {
  it('半角/全角分号行仍正常解析（表名寻址）', () => {
    const text = `<tableEdit>
状态； updateRow； 1； 地点=咖啡厅
状态; deleteRow; 2
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(skipped).toBe(0)
    expect(edits).toHaveLength(2)
    expect(edits[0]).toMatchObject({ sheet: '状态', op: 'updateRow', row: 1 })
    expect(edits[1]).toMatchObject({ sheet: '状态', op: 'deleteRow', row: 2 })
  })
})

describe('【实机审计修复 2026-09-05】parseTableEdits（函数调用式，ST st-memory-enhancement 主格式）', () => {
  it('insertRow/updateRow/deleteRow：表索引 0 起、行号 0 起数据行、列键 headers 下标', () => {
    const text = `<tableEdit>
insertRow(0,{"0":"傍晚","1":"操场","2":"悠悠"})
updateRow(0,1,{"1":"图书馆"})
deleteRow(0,0)
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(skipped).toBe(0)
    expect(edits).toHaveLength(3)
    // 表索引按启用表数组下标（sheet: '' + sheetIndex: 0）
    expect(edits[0]).toMatchObject({ sheet: '', sheetIndex: 0, op: 'insertRow' })
    // 列键 = headers 下标（0 起）：{"0":..,"1":..,"2":..} → 顺填三位
    expect(edits[0].values).toEqual(['傍晚', '操场', '悠悠'])
    // 行号 0 起数据行 → 内部 1 起：rowIndex 1 → row 2
    expect(edits[1]).toMatchObject({ sheetIndex: 0, op: 'updateRow', row: 2 })
    expect(edits[1].values).toEqual(['2=图书馆']) // 列键 1 → 内部 1 起列号 2
    expect(edits[2]).toMatchObject({ sheetIndex: 0, op: 'deleteRow', row: 1 }) // rowIndex 0 → row 1
  })

  it('insertRow 一律追加表尾（ST executeAction 忽略行参）', () => {
    const { edits } = parseTableEdits('<tableEdit>insertRow(0, 0, {"0":"追加行"})</tableEdit>')
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ sheetIndex: 0, op: 'insertRow' })
    expect(edits[0].row).toBeUndefined()
  })

  it('insertCol/deleteCol：列号 0 起 → 内部 1 起', () => {
    const text = `<tableEdit>
insertCol(0, 1, "备注")
deleteCol(2, 1)
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(skipped).toBe(0)
    expect(edits[0]).toMatchObject({ sheetIndex: 0, op: 'insertCol', col: 2, values: ['备注'] })
    expect(edits[1]).toMatchObject({ sheetIndex: 2, op: 'deleteCol', col: 2 })
  })

  it('宽松参数：单引号/全角括号/全角逗号/无引号键；非数字键按 ST 丢弃', () => {
    const text = `<tableEdit>
updateRow（0，1，{'1':'自习室'，bad:'x'}）
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(skipped).toBe(0)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ sheetIndex: 0, op: 'updateRow', row: 2 })
    expect(edits[0].values).toEqual(['2=自习室'])
  })

  it('缺表索引/缺数据字典 → skipped 计数不崩', () => {
    const text = `<tableEdit>
updateRow(0,1,{"1":"ok"})
insertRow()
deleteRow(0)
updateRow("状态", 1, {"1":"x"})
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(edits).toHaveLength(1)
    expect(skipped).toBe(3)
  })

  it('同一块内函数式与分号式混用共存', () => {
    const text = `<tableEdit>
insertRow(0,{"0":"傍晚","1":"操场","2":"悠悠"})
状态; updateRow; 1; 地点=咖啡厅
</tableEdit>`
    const { edits, skipped } = parseTableEdits(text)
    expect(skipped).toBe(0)
    expect(edits).toHaveLength(2)
    expect(edits[0]).toMatchObject({ sheetIndex: 0, op: 'insertRow' })
    expect(edits[1]).toMatchObject({ sheet: '状态', op: 'updateRow', row: 1 })
  })

  it('executeTableEdits：sheetIndex 按启用表过滤后下标寻址（禁用表不占位）', () => {
    const sheets = fixtureSheets()
    // sheets[1]（事件表）禁用 → 启用表 = [状态, 社交]；index 1 应命中「社交」
    const { edits } = parseTableEdits('<tableEdit>updateRow(1,0,{"1":"80"})</tableEdit>')
    const r = executeTableEdits(sheets, edits)
    expect(r.applied).toBe(1)
    const social = r.sheets.find(s => s.name === '社交')!
    expect(social.rows[0]).toEqual(['悠悠', '80'])
  })

  it('executeTableEdits：函数式 insertRow/updateRow/deleteRow 全链路落表', () => {
    const sheets = fixtureSheets()
    const text = `<tableEdit>
insertRow(0,{"0":"晚上","2":"悠悠"})
updateRow(0,0,{"1":"宿舍"})
deleteRow(0,1)
</tableEdit>`
    const { edits } = parseTableEdits(text)
    const r = executeTableEdits(sheets, edits)
    expect(r.applied).toBe(3)
    // 逐条即时寻址：insert 追加第 3 行 → update 第 1 数据行（0 起 0）→ delete 0 起 1 = 原第 2 数据行「中午」
    expect(r.sheets[0].rows[0]).toEqual(['上午', '宿舍', '云梦璃'])
    expect(r.sheets[0].rows).toHaveLength(2)
    expect(r.sheets[0].rows[1]).toEqual(['晚上', '', '悠悠'])
  })
})

describe('【实机审计修复 2026-09-05】{{GET::表:A1}} 宏（A1 式单元格地址）', () => {
  const sheets = fixtureSheets()

  it('parseA1Address：字母=列（base26）、数字=行', () => {
    expect(parseA1Address('A1')).toEqual({ row: 1, col: 1 })
    expect(parseA1Address('B2')).toEqual({ row: 2, col: 2 })
    expect(parseA1Address('AA1')).toEqual({ row: 1, col: 27 })
    expect(parseA1Address('b2')).toEqual({ row: 2, col: 2 }) // 小写容忍
    expect(parseA1Address('2B')).toBeNull()
    expect(parseA1Address('B')).toBeNull()
    expect(parseA1Address('B0')).toBeNull()
  })

  it('expandTableMacros：A1 式与三段数字两种形态等价（表名含冒号兼容）', () => {
    // 状态表 rows[0] = ['上午','学校','云梦璃']：A1 ≡ 1:1，B2 ≡ 2:2
    expect(expandTableMacros('{{GET::状态:A1}}', sheets)).toBe('上午')
    expect(expandTableMacros('{{GET::状态:1:1}}', sheets)).toBe('上午')
    expect(expandTableMacros('{{GET::状态:B2}}', sheets)).toBe('食堂')
    expect(expandTableMacros('{{GET::状态:2:2}}', sheets)).toBe('食堂')
    expect(expandTableMacros('{{GET::状态:C1}}', sheets)).toBe('云梦璃')
    // 越界/缺表 → 空串
    expect(expandTableMacros('{{GET::状态:D1}}', sheets)).toBe('')
    expect(expandTableMacros('{{GET::不存在:A1}}', sheets)).toBe('')
    // 三段数字形态仍走原路径（表名含冒号的场景不受 A1 分支影响）
    expect(expandTableMacros('{{GET::状态:1:3}}', sheets)).toBe('云梦璃')
  })
})
