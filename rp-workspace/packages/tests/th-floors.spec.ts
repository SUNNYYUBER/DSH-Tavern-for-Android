/**
 * th-floors 单测 —— TH 楼层元数据 sidecar
 * ============================================================================
 * 背景（阶段 3 2026-09-10）：0.1.5 的事件 `source` 是闭集白名单，
 * `thData`/`thSystem` 这类自定义键会让**整会话迁移被拒**。故迁出官方结构，
 * 存 `$DSH_HOME/rp/th-floors/<sessionId>.json`。
 *
 * 这里只测纯逻辑 + 真实临时目录 IO（不依赖 DSH runtime）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  thFloorsFile, readThFloors, writeThFloors, upsertThFloors, mergeSalvagedThFloors,
  lookupThFloor, thFloorKeyOf,
} from '../src/dsht-plugin-shared/th-floors.ts'
import type { ThFloorTable } from '../src/dsht-plugin-shared/th-floors.ts'

let home = ''
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'dsht-thfloors-')) })
afterEach(() => { try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ } })

describe('th-floors: sidecar 读写', () => {
  it('缺失文件 → 空表（不抛）', () => {
    expect(readThFloors(home, 'sid-x')).toEqual({})
  })

  it('损坏 JSON → 空表（不抛，sidecar 不能阻断聊天）', () => {
    const f = thFloorsFile(home, 'sid-x')
    mkdirSync(join(home, 'rp', 'th-floors'), { recursive: true })
    writeFileSync(f, '{不是 JSON', 'utf8')
    expect(readThFloors(home, 'sid-x')).toEqual({})
  })

  it('写读回环：data / system / legacy 三种载荷', () => {
    writeThFloors(home, 'sid-x', {
      'm1': { data: { fx_records_map: { 秧秧: [1, 2] } } },
      'm2': { system: true },
      'm3': { legacy: { oneshot: true } },
    })
    const t = readThFloors(home, 'sid-x')
    expect(t.m1.data).toEqual({ fx_records_map: { 秧秧: [1, 2] } })
    expect(t.m2.system).toBe(true)
    expect(t.m3.legacy).toEqual({ oneshot: true })
  })

  it('upsert 只覆盖传入的键，未提及的楼层原样保留', () => {
    writeThFloors(home, 'sid-x', { keep: { data: { a: 1 } } })
    upsertThFloors(home, 'sid-x', { add: { system: true } })
    const t = readThFloors(home, 'sid-x')
    expect(Object.keys(t).sort()).toEqual(['add', 'keep'])
    expect(t.keep.data).toEqual({ a: 1 })
  })

  it('legacy 逐键合并（后写不吞先写救回的另一类键）', () => {
    mergeSalvagedThFloors(home, 'sid-x', { m1: { legacy: { rolledBackTo: 3 } } })
    mergeSalvagedThFloors(home, 'sid-x', { m1: { legacy: { oneshot: true } } })
    expect(readThFloors(home, 'sid-x').m1.legacy).toEqual({ rolledBackTo: 3, oneshot: true })
  })

  it('mergeSalvagedThFloors 返回写入条数', () => {
    expect(mergeSalvagedThFloors(home, 'sid-x', {})).toBe(0)
    expect(mergeSalvagedThFloors(home, 'sid-x', { a: { system: true }, b: { system: true } })).toBe(2)
  })
})

describe('th-floors: 键解析', () => {
  const table: ThFloorTable = { 'id-A': { data: { v: 1 } }, 'seq:7': { system: true } }

  it('优先 message id', () => {
    expect(lookupThFloor(table, 'id-A', 7)?.data).toEqual({ v: 1 })
  })

  it('id 查不到 → 退回 seq:<n>', () => {
    expect(lookupThFloor(table, 'id-Z', 7)?.system).toBe(true)
  })

  it('都不命中 → undefined', () => {
    expect(lookupThFloor(table, 'id-Z', 999)).toBeUndefined()
    expect(lookupThFloor(table, null, null)).toBeUndefined()
  })

  it('thFloorKeyOf：assistant 取 data.message.id，user 取 data.id，兜底 seq', () => {
    expect(thFloorKeyOf({ message: { id: 'mid-1' } }, 3)).toBe('mid-1')
    expect(thFloorKeyOf({ id: 'uid-1' }, 3)).toBe('uid-1')
    expect(thFloorKeyOf({ role: 'user' }, 3)).toBe('seq:3')
    expect(thFloorKeyOf({ message: { id: '' } }, -1)).toBeNull()
    expect(thFloorKeyOf(undefined, 0)).toBeNull()
  })

  it('写侧与 salvage 侧用同一套键规则（保证读得回来）', () => {
    const id = thFloorKeyOf({ message: { id: 'same-id' } }, 42)
    upsertThFloors(home, 'sid-y', { [id!]: { data: { hello: 'world' } } })
    const t = readThFloors(home, 'sid-y')
    // 读侧用 (id, seq) 都能定位同一楼层
    expect(lookupThFloor(t, 'same-id', undefined)?.data).toEqual({ hello: 'world' })
  })
})
