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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetFacadeDegradedWarnings, __resetHostStCaches, buildHostStContext, defaultUuidv4, installHostSillyTavern,
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

// ---------------------------------------------------------------------------
// T-44 / 心跳 51：门面后四个成员（chatId / getCurrentChatId / reloadCurrentChat /
// substituteParams(+Extended) / streamingProcessor）—— 取用形态来自卡脚本实测：
//   :4257/:4668 `if (ctx.getCurrentChatId()) ctx.reloadCurrentChat()`（7 处 reload）
//   :3211/:4477/:4544 `ctx.substituteParams(...)` 同步取用
//   :4502/:4504 `ctx.substituteParamsExtended(...)`
//   :1347 `SillyTavern.getContext()?.streamingProcessor || null`
// ---------------------------------------------------------------------------
describe('host ST 门面：T-44 后四个成员', () => {
  it('chatId 与 getCurrentChatId() 同值（基准 st-context.js:122-125 两者并存）', () => {
    const ctx = buildHostStContext({ getChatId: () => 'session-abc' })
    expect(ctx.chatId).toBe('session-abc')
    expect((ctx.getCurrentChatId as () => unknown)()).toBe('session-abc')
  })

  it('无会话时 chatId / getCurrentChatId() 皆为 undefined（= 基准两个分支都不命中）', () => {
    const ctx = buildHostStContext()
    expect(ctx.chatId).toBeUndefined()
    expect((ctx.getCurrentChatId as () => unknown)()).toBeUndefined()
  })

  it('getChatId 返回空串视同无会话', () => {
    const ctx = buildHostStContext({ getChatId: () => '' })
    expect(ctx.chatId).toBeUndefined()
  })

  it('getChatId 抛错不炸门面（退化为 undefined）', () => {
    const ctx = buildHostStContext({ getChatId: () => { throw new Error('boom') } })
    expect(ctx.chatId).toBeUndefined()
  })

  it('reloadCurrentChat 返回 Promise（基准异步签名）且真的调到提供者', async () => {
    let hit = 0
    const ctx = buildHostStContext({ reloadChat: () => { hit += 1; return true } })
    const p = (ctx.reloadCurrentChat as () => Promise<void>)()
    expect(typeof p.then).toBe('function')
    await p
    expect(hit).toBe(1)
  })

  it('reloadChat 抛错被吞成 resolve（基准不 reject，避免未捕获拒绝带崩卡脚本）', async () => {
    const ctx = buildHostStContext({ reloadChat: () => { throw new Error('boom') } })
    await expect((ctx.reloadCurrentChat as () => Promise<void>)()).resolves.toBeUndefined()
  })

  it('未接线 reloadChat 时**出声降级**（L42：有意降级也必须能被看到）', async () => {
    __resetFacadeDegradedWarnings()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = buildHostStContext()
    await (ctx.reloadCurrentChat as () => Promise<void>)()
    expect(warn.mock.calls.flat().join(' ')).toContain('reloadCurrentChat 降级')
    warn.mockRestore()
  })

  it('substituteParams 原样转发实参（含 legacy 多位置参数）', () => {
    const seen: unknown[][] = []
    const ctx = buildHostStContext({ substituteParams: (...a: unknown[]) => { seen.push(a); return 'OK' } })
    const sp = ctx.substituteParams as (...a: unknown[]) => string
    expect(sp('{{char}}', undefined, '覆盖')).toBe('OK')
    expect(sp('x', { name1Override: 'A' })).toBe('OK')
    expect(seen[0]).toEqual(['{{char}}', undefined, '覆盖'])
    expect(seen[1]).toEqual(['x', { name1Override: 'A' }])
  })

  // 心跳 51 修正：原测例断言「Extended 与 substituteParams 共用同一提供者、实参原样转发」——
  // 该断言**把设备实测到的静默失败写成了期望值**。真相：基准 `substituteParamsExtended`
  // 就是 `substituteParams(content, {dynamicMacros, postProcessFn})`（script.js:2756-2757），
  // 两者的第 2/3 形参位置**不同**；原样转发会让 `{}` 被解析成 options、两个附加能力双双丢失。
  // 设备探针（非单测）抓到后改为「专用提供者优先 / 否则显式映射 / 否则降级」三段式。
  it('有专用提供者 → 直接用专用提供者（实参原样给它，不经过 substituteParams）', () => {
    const ext: unknown[][] = []
    const shared: unknown[][] = []
    const ctx = buildHostStContext({
      substituteParams: (...a: unknown[]) => { shared.push(a); return 'SHARED' },
      substituteParamsExtended: (...a: unknown[]) => { ext.push(a); return 'EXT' },
    })
    const spx = ctx.substituteParamsExtended as (...a: unknown[]) => string
    expect(spx('f', { a: '1' }, () => 'p')).toBe('EXT')
    expect(ext).toHaveLength(1)
    expect(ext[0]).toEqual(['f', { a: '1' }, expect.any(Function)])
    expect(shared).toHaveLength(0)
  })

  it('只注入 substituteParams → Extended **显式映射**成 options（negative control：不得原样转发）', () => {
    const seen: unknown[][] = []
    const ctx = buildHostStContext({ substituteParams: (...a: unknown[]) => { seen.push(a); return 'OK' } })
    const pp = (v: string): string => `[${v}]`
    expect((ctx.substituteParamsExtended as (...a: unknown[]) => string)('f', { dyn: 'D' }, pp)).toBe('OK')
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe('f')
    // 第 2 参必须是包好的 options（不是裸 `{dyn:'D'}`，否则 dynamicMacros 丢失）
    expect(seen[0][1]).toEqual({ dynamicMacros: { dyn: 'D' }, postProcessFn: pp })
  })

  it('Extended 的 additionalMacro 缺省 → 映射为 `dynamicMacros: {}`（与基准 `?? {}` 等价）', () => {
    const seen: unknown[][] = []
    const ctx = buildHostStContext({ substituteParams: (...a: unknown[]) => { seen.push(a); return 'OK' } })
    ;(ctx.substituteParamsExtended as (...a: unknown[]) => string)('f', undefined, undefined)
    expect(seen[0][1]).toEqual({ dynamicMacros: {}, postProcessFn: undefined })
  })

  it('非函数第 3 参不被当成 postProcessFn（避免把字符串抛进引擎）', () => {
    const seen: unknown[][] = []
    const ctx = buildHostStContext({ substituteParams: (...a: unknown[]) => { seen.push(a); return 'OK' } })
    ;(ctx.substituteParamsExtended as (...a: unknown[]) => string)('f', {}, 'not-a-fn' as unknown as () => string)
    expect((seen[0][1] as { postProcessFn?: unknown }).postProcessFn).toBeUndefined()
  })

  it('两者都未接线 → **出声降级** + 原文透传（L42）', () => {
    __resetFacadeDegradedWarnings()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = buildHostStContext()
    expect((ctx.substituteParamsExtended as (...a: unknown[]) => string)('{{char}}')).toBe('{{char}}')
    expect(warn.mock.calls.flat().join(' ')).toContain('substituteParamsExtended 降级')
    warn.mockRestore()
  })

  it('专用提供者抛错 → 原文透传（不把卡脚本带崩）', () => {
    const ctx = buildHostStContext({ substituteParamsExtended: () => { throw new Error('boom') } })
    expect((ctx.substituteParamsExtended as (...a: unknown[]) => string)('{{char}}')).toBe('{{char}}')
  })

  it('求值提供者抛错 → 原文透传（不把卡脚本带崩）', () => {
    const ctx = buildHostStContext({ substituteParams: () => { throw new Error('boom') } })
    expect((ctx.substituteParams as (c: unknown) => string)('{{char}}')).toBe('{{char}}')
  })

  it('streamingProcessor 如实为 null（= 基准初值 script.js:455；卡脚本已 null-guard）', () => {
    expect(buildHostStContext().streamingProcessor).toBeNull()
    expect(buildHostStContext({ getSnapshot: () => snap() }).streamingProcessor).toBeNull()
  })

  it('经 installHostSillyTavern 走出去也是同一份（宿主页 getContext 实测路径）', () => {
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => snap(), getChatId: () => 'sid-9', substituteParams: () => 'X' }, host)
    const getContext = (host.SillyTavern as { getContext: () => Record<string, unknown> }).getContext
    const ctx = getContext()
    expect(ctx.chatId).toBe('sid-9')
    expect((ctx.getCurrentChatId as () => unknown)()).toBe('sid-9')
    expect((ctx.substituteParams as (c: unknown) => string)('{{char}}')).toBe('X')
    expect(ctx.streamingProcessor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 心跳 51 续：name1 / name2 / groupId / groups
// 来源 = 审计工具**扩域后**量出的第二批缺口（TH 扩展形态 `getContext()` 裸调用，
// 实测 chat-history-backup/index.js:647/666/671/1412 的用法）
// ---------------------------------------------------------------------------
describe('host ST 门面：name1 / name2 / groupId / groups', () => {
  it('name1 / name2 取提供者；name2 无值时回落快照角色名', () => {
    const ctx = buildHostStContext({
      getSnapshot: () => snap({ character: { name: '小玉' } }),
      getNames: () => ({ name1: '旅人' }),
    })
    expect(ctx.name1).toBe('旅人')
    expect(ctx.name2).toBe('小玉')
  })

  it('name1 / name2 是**活值**（getter）——环境在其后水合也能取到（陈旧性防线）', () => {
    let names: { name1?: string; name2?: string } = {}
    const ctx = buildHostStContext({ getNames: () => names })
    expect(ctx.name1).toBeUndefined()
    names = { name1: '事后水合的用户名', name2: '事后水合的角色名' }
    expect(ctx.name1).toBe('事后水合的用户名')
    expect(ctx.name2).toBe('事后水合的角色名')
  })

  it('无提供者 / 提供者抛错 → undefined，不炸', () => {
    expect(buildHostStContext().name1).toBeUndefined()
    expect(buildHostStContext().name2).toBeUndefined()
    const ctx = buildHostStContext({ getNames: () => { throw new Error('boom') } })
    expect(ctx.name1).toBeUndefined()
  })

  it('groupId 恒为 null、groups 恒为 []（DSHT 无群聊；= 基准「未选中群聊」的取值）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    expect(ctx.groupId).toBeNull()
    expect(ctx.groups).toEqual([])
    // 卡的用法形态：if (ctx.groupId) → 走 else；groups?.find(...) 返回 undefined
    expect(ctx.groupId ? 'group' : 'character').toBe('character')
    expect((ctx.groups as Array<{ id: string }>).find(g => g.id === 'x')).toBeUndefined()
  })
})
