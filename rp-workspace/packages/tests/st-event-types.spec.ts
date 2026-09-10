/**
 * ST 事件名表接入（T-40）测试——来源是设备实测的第三道墙：
 *   卡的外链注入脚本 inject.js:493
 *     `const importReadyEvent = ctx.eventTypes.OAI_PRESET_IMPORT_READY || 'oai_preset_import_ready';`
 *   —— 看似有 `||` 兜底，但 `ctx.eventTypes === undefined` 时**属性访问先抛 TypeError**，
 *   兜底根本轮不到 → 必须真的提供这张表（不是"给了个空对象就行"）。
 * 基准：真 ST `getContext()` 含 `eventTypes: event_types`
 *   （SillyTavern-reference/public/scripts/st-context.js:137-138）。
 */
import { describe, expect, it } from 'vitest'
import { ST_EVENT_TYPES, ST_EVENT_TYPES_SOURCE } from '../src/dsht-rp-ui/src/client/st-event-types.gen.ts'
import { buildHostStContext } from '../src/dsht-rp-ui/src/client/host-vendor.ts'

describe('ST 事件名表：生成物完整性', () => {
  it('条目数 > 100（真 ST 1.16 为 104 条；骤降说明解析规则坏了）', () => {
    expect(Object.keys(ST_EVENT_TYPES).length).toBeGreaterThan(100)
  })

  it('生成来源可观测（文件 + 行号 + 条数）', () => {
    expect(ST_EVENT_TYPES_SOURCE.file).toBe('public/scripts/events.js')
    expect(ST_EVENT_TYPES_SOURCE.line).toBe(3)
    expect(ST_EVENT_TYPES_SOURCE.count).toBe(Object.keys(ST_EVENT_TYPES).length)
  })

  it('卡实际取用的两个键存在且与真 ST 字面量一致（用 `||` 兜底的那两个）', () => {
    expect(ST_EVENT_TYPES.OAI_PRESET_IMPORT_READY).toBe('oai_preset_import_ready')
    expect(ST_EVENT_TYPES.PRESET_CHANGED).toBe('preset_changed')
  })

  // ⚠️ 下面两条**不假设书写约定，只钉真实数据**（L37）：
  // 曾按"值应当全小写""值应当唯一"写断言 → 全红。核验基准源后确认是 ST 自己的实情：
  //   events.js:21  CHAT_LOADED: 'chatLoaded'
  //   events.js:22  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS'（值=键，ST 原文如此）
  //   events.js:68  CHARACTER_DELETED: 'characterDeleted'
  //   events.js:87  CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown'
  //   events.js:72-74  SMOOTH_STREAM_TOKEN_RECEIVED 与 STREAM_TOKEN_RECEIVED 共用 'stream_token_received'
  //                   （ST 显式注释 `@deprecated The event is aliased to STREAM_TOKEN_RECEIVED.`）
  // 忠实于基准优先于"看起来整齐"——把唯一性/小写当约定写死，等于用一个假前提把真数据判成错。

  it('键全大写（这条真的成立；解析串位会立刻暴露）', () => {
    for (const k of Object.keys(ST_EVENT_TYPES)) {
      expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('值均为非空字符串，且非小写值恰为已知的 4 个例外（新增/减少即报警）', () => {
    const nonLower = new Set<string>()
    for (const [k, v] of Object.entries(ST_EVENT_TYPES)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      if (!/^[a-z][a-z0-9_]*$/.test(v)) nonLower.add(`${k}=${v}`)
    }
    expect([...nonLower].sort()).toEqual([
      'CHARACTER_DELETED=characterDeleted',
      'CHARACTER_MANAGEMENT_DROPDOWN=charManagementDropdown',
      'CHAT_LOADED=chatLoaded',
      'GENERATION_AFTER_COMMANDS=GENERATION_AFTER_COMMANDS',
    ])
  })

  it('重复值恰为已知的 1 处（ST 的有意别名；再多一处就是解析串位）', () => {
    const seen = new Map<string, string[]>()
    for (const [k, v] of Object.entries(ST_EVENT_TYPES)) {
      const ks = seen.get(v)
      if (ks === undefined) seen.set(v, [k])
      else ks.push(k)
    }
    const dups = [...seen.entries()]
      .filter(([, ks]) => ks.length > 1)
      .map(([v, ks]) => `${v} <- ${ks.slice().sort().join(' + ')}`)
      .sort()
    expect(dups).toEqual(['stream_token_received <- SMOOTH_STREAM_TOKEN_RECEIVED + STREAM_TOKEN_RECEIVED'])
    // 104 键 / 103 唯一值 —— 差值必须是 1
    expect(Object.keys(ST_EVENT_TYPES).length - seen.size).toBe(1)
  })
})

describe('getContext().eventTypes 接入', () => {
  it('存在，且 `ctx.eventTypes.X` 属性访问不抛（脚本 :493 的确切失败点）', () => {
    const ctx = buildHostStContext()
    const et = ctx.eventTypes as Record<string, string>
    expect(typeof et).toBe('object')
    expect(() => et.OAI_PRESET_IMPORT_READY).not.toThrow()
    expect(et.OAI_PRESET_IMPORT_READY || 'oai_preset_import_ready').toBe('oai_preset_import_ready')
  })

  it('与生成表同一引用（身份稳定，不每次新造对象）', () => {
    expect(buildHostStContext().eventTypes).toBe(ST_EVENT_TYPES)
  })
})
