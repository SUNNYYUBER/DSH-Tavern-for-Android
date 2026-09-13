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
import vm from 'node:vm'
import {
  __resetFacadeDegradedWarnings, __resetHostStCaches, buildHostStContext, defaultUuidv4, installHostSillyTavern,
  ensureStRegexAnchor,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'
// 镜像测试用：跑**真构建产物**（iframe shim 源），不 grep 源码文本（心跳 63D）
import { buildShimSource } from '../src/dsht-rp-ui/src/client/th-shim.ts'
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

/**
 * 【心跳 64】在 vm 沙箱里跑**真构建产物**（iframe shim 源），返回该沙箱。
 *
 * `initial` 会作为 `window.__dshtInitialContext` —— 即帧内 `getContext()` 的**同步**数据源
 * （P3a bootstrap，与宿主 `loadContextSnapshot` postMessage 推的是同一形状）。
 * 判据是**行为**而不是源码文本（T-19：镜像两侧必须各自被钉住）。
 */
function makeShimSandbox(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.parent = { postMessage: () => {} }
  sandbox.name = 'sid'
  sandbox.addEventListener = () => {}
  sandbox.document = { body: { childElementCount: 0 } }
  sandbox.setTimeout = () => 0
  sandbox.console = console
  sandbox.__dshtInitialContext = initial
  vm.runInContext(
    buildShimSource({ scriptId: 'sid', scriptName: 'sid', secret: 'sec', version: 'test' }),
    vm.createContext(sandbox),
  )
  return sandbox
}

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

  /**
   * 【心跳 57】`chatCompletionSettings.extensions` 恒存在。
   * 卡脚本取 `ctx.chatCompletionSettings.extensions.regex_scripts` —— `extensions` 缺席时
   * **属性访问先抛 TypeError**，其后的 `&&` 短路轮不到（`inject.js:3567-3569`；
   * 与 T-40 的 `eventTypes` 同型：「看似有兜底的代码，兜底路径不可达」）。
   */
  it('chatCompletionSettings.extensions 恒存在（卡属性访问先抛的防线）', () => {
    const ccs = buildHostStContext().chatCompletionSettings as Record<string, unknown>
    expect(ccs.extensions).toBeDefined()
    expect(typeof ccs.extensions).toBe('object')
    // 决定性：直接按卡的取法读一遍，不得抛
    expect(() => {
      const c = ccs.extensions as { regex_scripts?: unknown }
      void c.regex_scripts
    }).not.toThrow()
  })

  it('快照的 extensions 非对象（null / 字符串）→ 降级为空对象而不是原样透出', () => {
    const bad = buildHostStContext({
      getSnapshot: () => snap({ chatCompletionSettings: { extensions: null } as never }),
    }).chatCompletionSettings as Record<string, unknown>
    expect(bad.extensions).toEqual({})
    const bad2 = buildHostStContext({
      getSnapshot: () => snap({ chatCompletionSettings: { extensions: 'nope' } as never }),
    }).chatCompletionSettings as Record<string, unknown>
    expect(bad2.extensions).toEqual({})
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

  it('chatCompletionSettings.extensions 透传（预设正则原样到卡，不被快照重建抹掉）', () => {
    const ctx = buildHostStContext({
      getSnapshot: () => snap({
        chatCompletionSettings: {
          prompts: [], prompt_order: [],
          extensions: { regex_scripts: [{ id: 'p1', scriptName: '甲' }, { id: 'p2', scriptName: '乙' }] },
        } as never,
      }),
    })
    const ext = (ctx.chatCompletionSettings as Record<string, unknown>).extensions as {
      regex_scripts?: Array<Record<string, unknown>>
    }
    expect(ext.regex_scripts).toHaveLength(2)
    expect(ext.regex_scripts![0].id).toBe('p1')
    expect(ext.regex_scripts![1].scriptName).toBe('乙')
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

// ---------------------------------------------------------------------------
// 心跳 57：常驻 ST 正则面板锚点 `#saved_regex_scripts`
// 卡的宿主脚本对它建**无条件** MutationObserver（`inject.js:3884-3889`），
// 元素缺席即抛 TypeError 并中断 bootstrap 后续三行（ChatSquash / MacroNest / 工具注册）。
// ---------------------------------------------------------------------------

/** 最小假 Document（node 单测环境无 DOM） */
function fakeDoc(anchorExists: boolean): { doc: Document; appended: Array<Record<string, unknown>> } {
  const appended: Array<Record<string, unknown>> = []
  const doc = {
    body: { appendChild: (el: Record<string, unknown>): void => { appended.push(el) } },
    getElementById: (id: string): unknown => (anchorExists && id === 'saved_regex_scripts' ? {} : null),
    createElement: (): Record<string, unknown> => {
      const el: Record<string, unknown> = { id: '', attrs: {} as Record<string, string> }
      el.setAttribute = (k: string, v: string): void => { (el.attrs as Record<string, string>)[k] = v }
      return el
    },
  } as unknown as Document
  return { doc, appended }
}

describe('host ST 门面：常驻 ST 正则面板锚点（心跳 57）', () => {
  it('无 DOM 环境（node）不抛、返回 false', () => {
    expect(ensureStRegexAnchor(undefined)).toBe(false)
  })

  it('已存在则不动（幂等：不重复 append）', () => {
    const { doc, appended } = fakeDoc(true)
    expect(ensureStRegexAnchor(doc)).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('不存在则创建：id 正确 + hidden + 自述属性', () => {
    const { doc, appended } = fakeDoc(false)
    expect(ensureStRegexAnchor(doc)).toBe(true)
    expect(appended).toHaveLength(1)
    const el = appended[0]
    expect(el.id).toBe('saved_regex_scripts')
    const attrs = el.attrs as Record<string, string>
    expect(attrs.hidden).toBe('')
    expect(attrs['data-dsht-anchor']).toBe('st-regex-scripts')
    expect(typeof attrs['data-dsht-note']).toBe('string')
  })

  it('**故意不带 class** —— 否则会触发卡往锚点注入它自己的按钮（假入口）', () => {
    // 卡的 injectBindButtons 取法是 `$('.regex_settings').find('#saved_regex_scripts')`：
    // 一旦有 .regex_settings 祖先，它就会遍历 children 并注入「绑定到预设」按钮，
    // 而锚点里没有它期望的行 → 用户点到「Script not found」。故此断言是**承重的**。
    const { doc, appended } = fakeDoc(false)
    ensureStRegexAnchor(doc)
    expect(appended[0].className).toBeUndefined()
    expect('class' in appended[0]).toBe(false)
  })

  it('body 缺失（早期调用）时安全返回 false', () => {
    const doc = { body: null, getElementById: () => null, createElement: () => ({}) } as unknown as Document
    expect(() => ensureStRegexAnchor(doc)).not.toThrow()
    expect(ensureStRegexAnchor(doc)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 【心跳 58 · T-42 收口】宿主 `extension_settings.regex` 的种子
//
// 卡的宿主脚本 `inject.js:3538` 取 `const extensions = ctx.extensionSettings;`，
// 随后在 **无条件调用** 的 `updateSTRegexes()`（`:3892`）里读 `extensions.regex.length`
// （`:3997`）→ 该键缺席即 `undefined.length` **取值先抛** TypeError → `RegexBinding()`
// 整段中断 → `ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` **全不执行**。
// 基准：`extensions.js:178` 默认 `regex: []`；`extensions/regex/index.js:1713` 的 init() 再兜底。
// ---------------------------------------------------------------------------

/** 最小 localStorage 替身（门面读写 extension_settings 走它） */
function fakeLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => { store.set(k, v) },
    removeItem: (k: string): void => { store.delete(k) },
  }
}

describe('host ST 门面：extension_settings.regex 种子（心跳 58 · T-42）', () => {
  beforeEach(() => { fakeLocalStorage(); __resetHostStCaches() })
  afterEach(() => { __resetHostStCaches(); delete (globalThis as { localStorage?: unknown }).localStorage })

  it('【承重】按卡的逐字取法读 `extensions.regex.length` 不抛（修复前必抛 TypeError）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    const extensions = ctx.extensionSettings as Record<string, unknown>
    expect(() => { void (extensions.regex as unknown[]).length }).not.toThrow()
    expect(Array.isArray(extensions.regex)).toBe(true)
  })

  it('无快照（RP 未打开）时也种空数组 —— 键的存在性与快照无关', () => {
    const extensions = buildHostStContext().extensionSettings as Record<string, unknown>
    expect(Array.isArray(extensions.regex)).toBe(true)
    expect(extensions.regex).toEqual([])
  })

  it('快照带 extensionSettingsRegex → 真数据落到 extensions.regex（不是永远空数组）', () => {
    const script = { id: 'g1', scriptName: '全局甲', findRegex: '/x/', placement: [2] }
    const ctx = buildHostStContext({ getSnapshot: () => snap({ extensionSettingsRegex: [script] }) })
    const extensions = ctx.extensionSettings as Record<string, unknown>
    expect(extensions.regex).toEqual([script])
  })

  it('先空壳后真数据（真实时序：RP 未打开时 getContext 已被调过）→ 真数据仍能进来', () => {
    buildHostStContext()                                        // ① 空壳：种下 []
    const script = { id: 'g2', scriptName: '全局乙' }
    const ctx = buildHostStContext({ getSnapshot: () => snap({ extensionSettingsRegex: [script] }) })
    const extensions = ctx.extensionSettings as Record<string, unknown>
    expect(extensions.regex).toEqual([script])
  })

  it('卡自己改过（已是非空数组）→ 不被数据源回滚', () => {
    const script = { id: 'g3', scriptName: '全局丙' }
    const first = buildHostStContext({ getSnapshot: () => snap({ extensionSettingsRegex: [script] }) })
      .extensionSettings as Record<string, unknown>
    ;(first.regex as unknown[]).push({ id: 'card-added' })      // 模拟卡就地改
    const second = buildHostStContext({ getSnapshot: () => snap({ extensionSettingsRegex: [script] }) })
      .extensionSettings as Record<string, unknown>
    expect(second.regex).toContainEqual({ id: 'card-added' })
  })

  it('regex_presets 一并种（同族键同族形状，避免下一个 !Array.isArray 判据再炸）', () => {
    const extensions = buildHostStContext({ getSnapshot: () => snap() }).extensionSettings as Record<string, unknown>
    expect(Array.isArray(extensions.regex_presets)).toBe(true)
  })

  it('extensionSettings / extension_settings 仍是同一引用（引用稳定性不被破坏）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    expect(ctx.extensionSettings).toBe(ctx.extension_settings)
  })
})

describe('host ST 门面：扩展模板渲染 renderExtensionTemplate(Async)（心跳 62 · T-48）', () => {
  // 唯一消费者 = 卡的**宿主注入脚本**（regex 编辑器 `card.js:4555` 走宿主门面）。
  // 修复前：`TypeError: ctx.renderExtensionTemplateAsync is not a function`（按钮点了毫无反应、零线索）。
  // 修复后：存在、可调、**形状与基准 catch 分支一致**（console.error + toastr + 返回 undefined）。
  it('两个成员**存在**于宿主门面（不再 "is not a function"）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    expect(typeof ctx.renderExtensionTemplateAsync).toBe('function')
    expect(typeof ctx.renderExtensionTemplate).toBe('function')
  })

  it('调用形状与基准一致：async 版 resolve undefined（**不 reject**）、同步版返回 undefined', async () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    const a = ctx.renderExtensionTemplateAsync as (e: unknown, t: unknown) => Promise<unknown>
    const s = ctx.renderExtensionTemplate as (e: unknown, t: unknown) => unknown
    await expect(a('regex', 'editor')).resolves.toBeUndefined()
    expect(s('regex', 'editor')).toBeUndefined()
  })

  it('出声：console.error 带得走排查所需的路径（不静默失败）', () => {
    const errs: string[] = []
    const real = console.error
    console.error = (...a: unknown[]) => { errs.push(a.map(String).join(' ')) }
    try {
      const s = buildHostStContext({ getSnapshot: () => snap() }).renderExtensionTemplate as
        (e: unknown, t: unknown) => unknown
      s('regex', 'editor')
    } finally { console.error = real }
    const joined = errs.join('\n')
    expect(joined).toContain('Error rendering template')
    expect(joined).toContain('scripts/extensions/regex/editor.html')
  })

  it('toastr 缺席/残缺时不抛错（提示能力缺失不许改变返回形状）', () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    const g = globalThis as unknown as { toastr?: unknown }
    const prev = g.toastr
    try {
      g.toastr = undefined
      expect(() => (ctx.renderExtensionTemplateAsync as (e: unknown, t: unknown) => unknown)('a', 'b')).not.toThrow()
      g.toastr = { notAnError: 1 }
      expect(() => (ctx.renderExtensionTemplateAsync as (e: unknown, t: unknown) => unknown)('a', 'b')).not.toThrow()
    } finally { g.toastr = prev }
  })
})

// ---------------------------------------------------------------------------
// 心跳 63D：T-47 A 档（`saveChat` 宿主面镜像）+ 宿主页 `SillyTavern` 顶层形态对齐
// 取证三处齐（L101）：① 权威面绑定行 `st-context.js:154  saveChat: saveChatConditional`
//   （基准运行副本 `src/scripts/st-context.js:161` 同一绑定）
// ② 基准声明 `script.js:10666  export async function saveChatConditional(commitReason = …)`
//   ⇒ 无必填参 · async · 真的落盘  ③ 语料真实用法：`梦鲸思客消息处理 2.4` 调用 1 次。
// DSHT 的会话由核心持续落盘 ⇒ 正确语义 = resolve 且无需额外动作（不是降级、不是假成功）。
// ---------------------------------------------------------------------------
describe('host ST 门面：saveChat（T-47 A 档）+ 宿主页 SillyTavern 顶层形态（心跳 63D）', () => {
  it('saveChat 存在且 resolve undefined（照基准「无必填参 async」的形状，绝不 reject）', async () => {
    const ctx = buildHostStContext({ getSnapshot: () => snap() })
    expect(typeof ctx.saveChat).toBe('function')
    await expect((ctx.saveChat as () => Promise<unknown>)()).resolves.toBeUndefined()
  })

  it('无快照（RP 未打开）时同样可用——持久化语义与会话是否已打开无关', async () => {
    const ctx = buildHostStContext()
    await expect((ctx.saveChat as () => Promise<unknown>)()).resolves.toBeUndefined()
  })

  /**
   * 镜像测试（T-19 硬约束：两侧同语义必须被钉住，任一侧漂移即报警）。
   * 判据不是 grep 源码文本，而是**跑真构建产物**（`buildShimSource`）后取 iframe 侧的
   * `window.SillyTavern.saveChat` 行为 —— 与宿主侧逐字比对（L36：既不能少也不能多）。
   */
  it('镜像：iframe 侧同一成员行为一致（真构建产物，非文本断言）', async () => {
    const sandbox: Record<string, unknown> = {}
    sandbox.window = sandbox
    sandbox.parent = { postMessage: () => {} }
    sandbox.name = 'sid'
    sandbox.addEventListener = () => {}
    sandbox.document = { body: { childElementCount: 0 } }
    sandbox.setTimeout = () => 0
    sandbox.console = console
    vm.runInContext(
      buildShimSource({ scriptId: 'sid', scriptName: 'sid', secret: 'sec', version: 'test' }),
      vm.createContext(sandbox),
    )
    const st = sandbox.SillyTavern as { saveChat?: () => Promise<unknown> }
    expect(typeof st.saveChat).toBe('function')
    await expect(st.saveChat?.()).resolves.toBeUndefined()
  })

  /**
   * 【心跳 64】`name1`（用户名）—— 真 ST **两面都有**，帧内此前**两面都缺**。
   *
   * 设备实测用法（不是推测，来自语料静态穷举 + live 帧读数）：
   *  · 「世界书控制 0708」（**当前活跃卡**，`世界书控制_0708.js:4122/4130/4229`）
   *    `(typeof SillyTavern !== "undefined") ? SillyTavern.name1 : "User"`
   *    —— **只有对象级守卫、没有属性级守卫** ⇒ 守卫通过但取到 undefined ⇒ 渲染出 `"undefined: 内容"`；
   *  · 「飞讯 0703」（**当前活跃卡**，`:36`）
   *    `(typeof SillyTavern !== 'undefined' && SillyTavern.getContext().name1) ? … : '{{user}}'`
   *    ⇒ 落到兜底**字面量** `{{user}}`（未展开的宏）。
   *
   * 基准两面都有：宿主 `getContext()` 的 40 成员含 `name1`/`name2`；iframe 顶层
   * `≡ getContext()` 展开（`iframe/predefine.js:26-35` 的父页投影）。
   * **两面各断一次**（L49：并集口径会掩盖单面缺失 —— 这正是 T-46 被遮住这么久的原因）。
   */
  it('镜像：name1 在【顶层】与【getContext】两面都可取（真构建产物，两面各断）', () => {
    const sandbox = makeShimSandbox({ userName: '示例人设乙', character: { name: '小玉' } })
    const st = sandbox.SillyTavern as {
      name1?: unknown
      name2?: unknown
      getContext?: () => Record<string, unknown>
    }
    expect(st.name1).toBe('示例人设乙')
    expect(st.name2).toBe('小玉')
    const ctx = st.getContext?.() ?? {}
    expect(ctx.name1).toBe('示例人设乙')
    expect(ctx.name2).toBe('小玉')
  })

  /**
   * **负控**：快照里没有 `userName`（宏环境未水合）时，两面都必须**严格 undefined**
   * —— 不能是 `''`（卡会把它当成"用户名是空串"直接拼进去），也不能是占位串。
   * 同时对照 `name2` **仍可用**，证明"缺失"是本字段的诚实缺省，而不是整个面塌掉。
   */
  it('负控：无 userName 时两面均为 undefined（不给空串/不给占位），name2 不受影响', () => {
    const sandbox = makeShimSandbox({ character: { name: '小玉' } })
    const st = sandbox.SillyTavern as { name1?: unknown; name2?: unknown; getContext?: () => Record<string, unknown> }
    expect(st.name1).toBeUndefined()
    expect((st.getContext?.() ?? {}).name1).toBeUndefined()
    expect(st.name2).toBe('小玉')
    expect((st.getContext?.() ?? {}).name2).toBe('小玉')
  })

  /**
   * 【心跳 65 · T-74】`chatId` —— 基准 getContext() 成员（`st-context.js:131-133`），
   * 与 `getCurrentChatId()`（`script.js:869`）**是同一个表达式** ⇒ 同源同值。
   * 我方此前只有后者、前者缺席（语料 8 次 / 6 文件取用，**全部无属性级守卫**）。
   *
   * 为什么必须补（实测用法，不是推测）：
   *  · 示例卡乙预设族（**启用中**）：`const ctx = SillyTavern?.getContext?.(); if (ctx.chatId) return String(ctx.chatId);`
   *    失败后兜底链是 `chat.file_name` → `chatMetadata.file_name` → `chatMetadata.chat_id` → name，
   *    而该链在我方**整条断裂**（`chat` 是消息数组无 file_name；帧内无 `chatMetadata`）⇒ 落到 name。
   *    该值用于**聊天绑定校验**（`String(parsed.boundChatId || '') === scope.chatId`）
   *    ⇒ `undefined` 恒不等 ⇒ **校验恒失败**（静默产错值）。
   *  · 世界书控制 0708（**当前活跃卡**）：`getContext().chatId || getContext().chat_id || ""` ⇒ 降级为 ""。
   *
   * **两面各断一次**（L49：并集口径会掩盖单面缺失）。
   */
  it('镜像：chatId 在两面都可取，且与 getCurrentChatId() 同源同值', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/wuwa-solaris-3', character: { name: '小玉' } })
    const st = sandbox.SillyTavern as {
      chatId?: unknown
      getCurrentChatId?: () => unknown
      getContext?: () => Record<string, unknown>
    }
    expect(st.chatId).toBe('rp/wuwa-solaris-3')
    expect(st.getContext?.().chatId).toBe('rp/wuwa-solaris-3')
    // 同源判据：两面与 getCurrentChatId() 必须**恒等**（基准里就是同一个表达式）
    expect(st.chatId).toBe(st.getCurrentChatId?.())
  })

  /**
   * 边界：快照无 slug 时 `chatId` 与 `getCurrentChatId()` 仍**同源**——
   * 不允许一个返回 `'current'`、另一个返回 `undefined`（那会让卡的绑定校验按"两面"分叉）。
   * 兜底值 `'current'` 是 `getCurrentChatId()` 既有契约，本轮**不改**（改它会动既有行为）。
   */
  it('边界：无 slug 时 chatId 与 getCurrentChatId() 取值一致（同源不分叉）', () => {
    const sandbox = makeShimSandbox({ character: { name: '小玉' } })
    const st = sandbox.SillyTavern as {
      chatId?: unknown
      getCurrentChatId?: () => unknown
      getContext?: () => Record<string, unknown>
    }
    expect(st.chatId).toBe(st.getCurrentChatId?.())
    expect(st.chatId).toBe('current')
    expect(st.getContext?.().chatId).toBe('current')
  })

  /**
   * **反控（L36「不能多」+ 不制造假信息）**：蛇形 `chat_id` **必须不提供**。
   * 基准全树 `chat_metadata.chat_id` **0 命中**（只有 `chat_id_hash`，`macros.js:316/323`）
   * ⇒ 真 ST 读到的也是 `undefined`。补空壳 = 比基准"多"且让卡拿到编造值。
   * （语料里 `getContext().chat_id` 4 次 —— 那些卡在真 ST 上同样是 `undefined`，属卡片自身缺陷。）
   */
  it('反控：蛇形 chat_id 不提供（基准也没有 —— L36 不能多）', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    const st = sandbox.SillyTavern as { chat_id?: unknown; getContext?: () => Record<string, unknown> }
    expect(st.chat_id).toBeUndefined()
    expect(st.getContext?.().chat_id).toBeUndefined()
  })

  /**
   * 【心跳 65 · T-74】`uuidv4` —— 基准 getContext() 成员（`st-context.js:242` ← `utils.js:1972`）。
   * 帧内顶层直取实测 2 次 / 2 文件（梦鲸思客「格式补全 1.2」，**enabled**），无属性级守卫。
   * 实现形态**逐字对齐基准**：`crypto.randomUUID` 优先 + `Math.random` 兜底。
   * 本沙箱**没有** `crypto` ⇒ 走的正是兜底分支（另一条分支由 `crypto` 注入用例覆盖）。
   */
  it('镜像：uuidv4 在两面都是函数，返回 RFC4122 v4 形状且两次不同', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    const st = sandbox.SillyTavern as { uuidv4?: () => unknown; getContext?: () => Record<string, unknown> }
    expect(typeof st.uuidv4).toBe('function')
    expect(typeof st.getContext?.().uuidv4).toBe('function')
    const a = String((st.uuidv4 as () => unknown)())
    const b = String((st.uuidv4 as () => unknown)())
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('uuidv4 主分支：有 crypto.randomUUID 时直接用它（基准同路径）', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    let called = 0
    ;(sandbox as Record<string, unknown>).crypto = {
      randomUUID: () => { called += 1; return '11111111-2222-4333-8444-555555555555' },
    }
    const st = sandbox.SillyTavern as { uuidv4?: () => unknown }
    expect((st.uuidv4 as () => unknown)()).toBe('11111111-2222-4333-8444-555555555555')
    expect(called).toBe(1)
  })

  /**
   * 【心跳 65 · T-75】`mainApi` —— 基准 getContext() 成员（`st-context.js:206: mainApi: main_api`）。
   *
   * 它是**硬闸门**（设备上 enabled 的梦鲸思客「格式补全 1.2」逐字）：
   * ```js
   * 'openai' !== SillyTavern.mainApi
   *   ? Promise.reject(new Error('当前 API 不是聊天补全，无法使用提示词查看器方式提取提示词。'))
   *   : 'no_connection' === SillyTavern.onlineStatus
   *     ? Promise.reject(new Error('未连接到 API，无法提取提示词。'))
   *     : new Promise(/* 真正干活 *\/)
   * ```
   * 我方此前**两面都没有** ⇒ `undefined` ⇒ `'openai' !== undefined` 恒 true ⇒ **直接 reject**
   * ⇒ 整条功能不可用（闸门式 fatal，属静默失败族）。
   *
   * 值与宿主面**同源**（`dsht-plugin-shared/st-compat.ts:DSHT_MAIN_API`，单一常量）。
   */
  it('镜像：mainApi 在【顶层】【getContext】两面都 = openai（真构建产物，两面各断）', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    const st = sandbox.SillyTavern as { mainApi?: unknown; getContext?: () => Record<string, unknown> }
    expect(st.mainApi).toBe('openai')
    expect(st.getContext?.().mainApi).toBe('openai')
  })

  it('宿主面 getContext 也含 mainApi（基准有 ⇒ 不能少；与帧面同值）', () => {
    expect((buildHostStContext() as Record<string, unknown>).mainApi).toBe('openai')
  })

  /**
   * **行为级判据**（比断言形状更强）：把卡那段闸门逐字搬进来跑 ——
   * 必须**进入真正干活的分支**，而不是 reject。
   */
  it('行为级：卡的 mainApi 闸门放行（不再 reject「当前 API 不是聊天补全」）', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    const st = sandbox.SillyTavern as { mainApi?: unknown }
    const gate = () => ('openai' !== st.mainApi
      ? Promise.reject(new Error('当前 API 不是聊天补全，无法使用提示词查看器方式提取提示词。'))
      : Promise.resolve('PROCEED'))
    return expect(gate()).resolves.toBe('PROCEED')
  })

  /**
   * **反控（L36「不能多」+ 不制造假信息）**：`onlineStatus` **必须不提供**。
   *
   * 它不是缺陷：基准默认 `'no_connection'`（`script.js:929`），但卡的闸门写成
   * `'no_connection' === onlineStatus` —— 我方缺省 `undefined` 使该比较为 **false** ⇒ **放行**。
   * 而该字段的真语义是**真实连通状态**，我方没有 ST 式连通性检查 ⇒ 任何常量（含 `'no_connection'`）
   * 都是**编造连通性结论**。⇒ 登记为已知差异，禁止"顺手补一个"。
   */
  it('反控：onlineStatus 不提供（缺省恰好使那道闸门放行，给值反而是在编造连通性）', () => {
    const sandbox = makeShimSandbox({ slug: 'rp/x' })
    const st = sandbox.SillyTavern as { onlineStatus?: unknown; getContext?: () => Record<string, unknown> }
    expect(st.onlineStatus).toBeUndefined()
    expect(st.getContext?.().onlineStatus).toBeUndefined()
    // 卡那道闸门的另一半：缺省值必须**不触发** reject
    expect('no_connection' === st.onlineStatus).toBe(false)
  })

  /**
   * 宿主页 `SillyTavern` **顶层只有基准那 3 个键** —— 基准源逐字：
   * `src/script.js:374-381  globalThis.SillyTavern = { libs, getContext, i18n: { t, translate } };`
   * ⚠️ 顶层**不是** `getContext()` 的展开：那层 spread 只存在于**脚本 iframe**
   *（TH `src/iframe/predefine.js:26-35` 显式 `{ ...getContext(), getContext }`）。
   * 这条用例是**反控**：防止日后有人"顺手把 getContext 展平到宿主顶层"（那是"多"，违反 L36，
   * 并会把 T-46「iframe 面窄于基准」的真问题掩盖成一个假象）。
   */
  it('顶层键恰为 libs/getContext/i18n（不展开 getContext —— L36「不能多」）', () => {
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => snap() }, host)
    expect(Object.keys(host.SillyTavern as Record<string, unknown>).sort()).toEqual(['getContext', 'i18n', 'libs'])
  })

  it('i18n.t / i18n.translate 可用（基准顶层真有这两个；t 为箭头函数，无 this 依赖）', () => {
    const host: Record<string, unknown> = {}
    installHostSillyTavern({ getSnapshot: () => snap() }, host)
    const i18n = (host.SillyTavern as { i18n: { t: (s: TemplateStringsArray, ...v: unknown[]) => string; translate: (s: string) => string } }).i18n
    expect(typeof i18n.t).toBe('function')
    expect(typeof i18n.translate).toBe('function')
    // 未装语言包 ⇒ 原文返回（与门面 `t`/`translate` 同语义）
    expect(i18n.translate('未翻译的原文')).toBe('未翻译的原文')
    expect(i18n.t`未翻译的原文`).toBe('未翻译的原文')
  })
})
