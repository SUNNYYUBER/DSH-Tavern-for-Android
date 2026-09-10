/**
 * 宿主 SillyTavern 门面（T-37）测试——来源是**设备实测的取用面**，不是推测：
 *  - 卡把 220KB 外链脚本注入宿主页，脚本首行即
 *    `const ctx = SillyTavern.getContext(); for (const p of ctx.chatCompletionSettings.prompts)`
 *    → 缺 `SillyTavern` 抛 ReferenceError；缺 `prompts` 数组抛 TypeError。两条都必须不炸。
 *  - `:3927` 对 `chatCompletionSettings.preset_settings_openai` 做 `!==` **身份比较**
 *    → 同一份快照必须返回**同一个 ctx 对象**，否则每 tick 误判「预设变了」→ 自造死循环。
 *  - `const { uuidv4 } = SillyTavern.getContext()` → 必须是函数。
 *  - `getContext()?.streamingProcessor` / `ctx.chat?.[...]` → 可选链，缺字段允许 undefined。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetHostStCaches, buildHostStContext, defaultUuidv4, installHostSillyTavern,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'
import type { ThContextSnapshot } from '../src/dsht-rp-ui/src/client/th-shim.ts'

/** 造一份「有内容」的会话快照（形状取自 ThContextSnapshot） */
function snap(over: Partial<ThContextSnapshot> = {}): ThContextSnapshot {
  return {
    presetId: 'preset-1',
    presetName: '测试预设',
    character: { name: '小玉' },
    characterLorebook: 'world-1',
    slug: 'rp/_start',
    chatCompletionSettings: {
      prompts: [{ name: 'main', role: 'system' } as never],
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] } as never],
    },
    messages: [{ message_id: 0, mes: '你好', is_user: true } as never],
    ...over,
  }
}

beforeEach(() => { __resetHostStCaches() })
afterEach(() => { __resetHostStCaches() })

describe('host ST 门面：空壳形态（RP 未打开 / 快照缺失也必须不炸）', () => {
  it('无快照时 prompts / chat 仍是数组、chatLength 为 0、uuidv4 是函数', () => {
    const ctx = buildHostStContext()
    const ccs = ctx.chatCompletionSettings as Record<string, unknown>
    expect(Array.isArray(ccs.prompts)).toBe(true)
    expect(Array.isArray(ccs.prompt_order)).toBe(true)
    expect(Array.isArray(ctx.chat)).toBe(true)
    expect(ctx.chatLength).toBe(0)
    expect(typeof ctx.uuidv4).toBe('function')
    // 脚本 :55 的 for-of 必须能跑（数组为空即通过）
    expect(() => { for (const _p of ccs.prompts as unknown[]) { void _p } }).not.toThrow()
  })

  it('preset_settings_openai 恒存在（脚本对它做 !== 比较，不能是 undefined）', () => {
    const ccs = buildHostStContext().chatCompletionSettings as Record<string, unknown>
    expect(ccs.preset_settings_openai).toBeDefined()
    expect(typeof ccs.preset_settings_openai).toBe('object')
  })

  it('extensionSettings 与 extension_settings 是同一引用（对齐真 ST getContext 形状）', () => {
    const ctx = buildHostStContext()
    expect(ctx.extensionSettings).toBe(ctx.extension_settings)
  })

  it('getSnapshot 抛错时不外溢（门面仍返回完整空壳）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => { throw new Error('boom') } })
    expect(Array.isArray((ctx.chatCompletionSettings as Record<string, unknown>).prompts)).toBe(true)
    expect(ctx.chatLength).toBe(0)
  })
})

describe('host ST 门面：字段透传（有快照时）', () => {
  it('presetName / characterName / nameOverride / chat / chatLength 均透传', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    expect(ctx.presetName).toBe('测试预设')
    expect(ctx.characterName).toBe('小玉')
    expect(ctx.nameOverride).toBe('小玉')
    expect((ctx.chat as unknown[]).length).toBe(1)
    expect(ctx.chatLength).toBe(1)
  })

  it('promptManager 两法可调：getPromptOrderForCharacter / getPromptOrderItems', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    const pm = ctx.promptManager as {
      activePreset?: string
      getPromptOrderForCharacter: () => unknown[]
      getPromptOrderItems: () => unknown[]
    }
    expect(pm.activePreset).toBe('测试预设')
    expect(pm.getPromptOrderItems()).toHaveLength(1)
    expect(pm.getPromptOrderForCharacter()).toHaveLength(1)
  })

  it('character 缺失时不抛错、nameOverride 为 undefined', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap({ character: null }) })
    expect(ctx.characterName).toBeUndefined()
    expect(ctx.nameOverride).toBeUndefined()
  })

  it('uuid 可注入（测试确定性）', () => {
    const ctx = buildHostStContext({ uuid: () => 'fixed-uuid' })
    expect((ctx.uuidv4 as () => string)()).toBe('fixed-uuid')
  })
})

describe('host ST 门面：安装（幂等 + 不覆盖宿主已有）', () => {
  it('空宿主 → 装上，且 getContext 可直接调用', () => {
    const host: Record<string, unknown> = { _: { VERSION: '4.18.1' } }
    expect(installHostSillyTavern({ getSnapshot: () => snap() }, host)).toBe(true)
    const st = host.SillyTavern as Record<string, unknown>
    expect(typeof st.getContext).toBe('function')
    const ctx = (st.getContext as () => Record<string, unknown>)()
    expect(ctx.presetName).toBe('测试预设')
  })

  it('libs.lodash 镜像宿主 _（真 ST 的 libs 是各库 shim 集合）', () => {
    const lodash = { VERSION: '4.18.1' }
    const host: Record<string, unknown> = { _: lodash }
    installHostSillyTavern({}, host)
    const st = host.SillyTavern as Record<string, unknown>
    expect((st.libs as Record<string, unknown>).lodash).toBe(lodash)
  })

  it('宿主已有 SillyTavern → 返回 false 且原对象一字不改（绝不覆盖）', () => {
    const original = { getContext: () => ({ marker: 'real-st' }) }
    const host: Record<string, unknown> = { SillyTavern: original }
    expect(installHostSillyTavern({ getSnapshot: () => snap() }, host)).toBe(false)
    expect(host.SillyTavern).toBe(original)
  })
})

describe('host ST 门面：身份稳定性（防脚本自造的 !== 重放死循环）', () => {
  it('同一份快照 → 两次 getContext() 返回同一对象', () => {
    const s = snap()
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => s }, host)
    const getContext = (host.SillyTavern as { getContext: () => Record<string, unknown> }).getContext
    const a = getContext()
    const b = getContext()
    expect(a).toBe(b)
  })

  it('同一份快照 → preset_settings_openai 引用稳定（脚本 :3927 的 !== 判据）', () => {
    const s = snap()
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => s }, host)
    const getContext = (host.SillyTavern as { getContext: () => Record<string, unknown> }).getContext
    const first = (getContext().chatCompletionSettings as Record<string, unknown>).preset_settings_openai
    const second = (getContext().chatCompletionSettings as Record<string, unknown>).preset_settings_openai
    expect(second).toBe(first)
  })

  it('快照换新（引用变化）→ 返回新 ctx（不返回陈旧数据）', () => {
    let s = snap()
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => s }, host)
    const getContext = (host.SillyTavern as { getContext: () => Record<string, unknown> }).getContext
    const before = getContext()
    s = snap({ presetName: '换了预设' })
    const after = getContext()
    expect(after).not.toBe(before)
    expect(after.presetName).toBe('换了预设')
  })
})

describe('host ST 门面：defaultUuidv4 形状', () => {
  it('返回 RFC4122 v4 形状字符串', () => {
    const id = defaultUuidv4()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('两次调用不相等（真随机源）', () => {
    expect(defaultUuidv4()).not.toBe(defaultUuidv4())
  })
})
