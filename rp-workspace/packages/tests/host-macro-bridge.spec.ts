/**
 * host-macro-bridge（T-44，心跳 51）测试
 *
 * 被测契约来自**卡脚本的真实调用形态**（`tmp/t37-inject.js`），不是推测：
 *  - `:3211-3212` `ctx.substituteParams(prefix)` —— **同步**取用返回值建对象
 *  - `:4477` `ctx.substituteParams(trimString, undefined, characterOverride)`
 *    —— ST legacy **位置参数**（第 3 参 = name2Override）
 *  - `:4502` `ctx.substituteParamsExtended(findRegex)`
 *  - `:4504` `ctx.substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)`
 *    —— 第 3 参 postProcessFn，且**只作用于宏结果**（若错作用于整段，正则会被整体转义）
 *
 * 数据面用 `globalThis.fetch` 桩替代（真实路径：hydrate → 同步展开），
 * 不做 test-only setter —— 要验的就是「拉取 → 入同步槽 → 同步求值」这条真链。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetHostMacroEnv, getHostMacroEnv, hostSubstituteParams, hostSubstituteParamsExtended,
  refreshHostMacroEnv,
} from '../src/dsht-rp-ui/src/client/host-macro-bridge.ts'
import { invalidateDisplayDataCache } from '../src/dsht-rp-ui/src/client/display-compiler.ts'
import { unregisterMacro } from '../src/dsht-plugin-shared/macros.ts'

/** 数据面桩：身份 / 变量（MVU 合并树）/ 自定义宏 / 三个作用域树 */
function stubDataPlane(over: { identity?: Record<string, string>; merged?: Record<string, unknown>; scopes?: Record<string, Record<string, unknown>> } = {}): void {
  const identity = over.identity ?? { user: '旅行者', char: '丰川祥子', persona: '浪迹天涯' }
  const merged = over.merged ?? { stat_data: { 好感度: 42 } }
  const scopes = over.scopes ?? { global: {}, character: {}, chat: {} }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (u.includes('/dsht-rp/rp/identity')) return ok(identity)
    if (u.includes('/dsht-mvu/variables')) return ok({ variables: merged })
    if (u.includes('/dsht-rp/macros/list')) return ok({ macros: {} })
    if (u.includes('/dsht-tavern-helper/variables')) {
      const scope = new URL(u, 'http://x').searchParams.get('scope') ?? 'global'
      return ok({ variables: scopes[scope] ?? {} })
    }
    throw new Error(`unstubbed fetch: ${u}`)
  }))
}

/** 等待 refreshHostMacroEnv 的后台任务落地（Promise.all 链 + 微任务） */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  __resetHostMacroEnv()
  invalidateDisplayDataCache()
  vi.restoreAllMocks()
})
afterEach(() => {
  __resetHostMacroEnv()
  invalidateDisplayDataCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('host 同步宏门面：降级语义（宏环境未就绪）', () => {
  it('未预热 → 原文透传（不伪造身份、不抛错）', () => {
    expect(hostSubstituteParams('{{char}} 说')).toBe('{{char}} 说')
    expect(getHostMacroEnv()).toBeNull()
  })

  it('空/假值 content → 空串（基准 `if (!content) return ""`）', () => {
    expect(hostSubstituteParams('')).toBe('')
    expect(hostSubstituteParams(null)).toBe('')
    expect(hostSubstituteParams(undefined)).toBe('')
    expect(hostSubstituteParams(0)).toBe('')
  })

  it('无宏文本走快路径：即使环境未就绪也原样返回', () => {
    expect(hostSubstituteParams('纯文本，无宏')).toBe('纯文本，无宏')
  })

  it('会话关闭（sessionId 为空）→ 清空环境，回到降级', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(getHostMacroEnv()).not.toBeNull()
    refreshHostMacroEnv(null, null)
    expect(getHostMacroEnv()).toBeNull()
  })
})

describe('host 同步宏门面：预热后同步求值', () => {
  it('身份宏同步展开（拉取完成后，取值不再需要 await）', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('{{char}} 对 {{user}} 说')).toBe('丰川祥子 对 旅行者 说')
  })

  it('getvar 读 MVU 合并树；get_character_variable 读 character 作用域树', async () => {
    stubDataPlane({
      merged: { stat_data: { 好感度: 42 } },
      scopes: { global: {}, character: { 好感度: 99 }, chat: {} },
    })
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('{{getvar::stat_data.好感度}}')).toBe('42')
    // 分作用域读取是「按 kind 分树」的直接证据（合并树里没有 99）
    expect(hostSubstituteParams('{{get_character_variable::好感度}}')).toBe('99')
  })

  it('legacy 位置签名：第 3 参是 name2Override（卡 :4477 的真实用法）', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('{{char}}', undefined, '覆盖角色')).toBe('覆盖角色')
  })

  it('options 对象签名：name1Override / name2Override', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('{{user}}/{{char}}', { name1Override: 'A', name2Override: 'B' })).toBe('A/B')
  })

  it('未知宏原样保留（不吞不炸）', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('a{{从未注册的宏}}b')).toBe('a{{从未注册的宏}}b')
  })

  it('自定义宏（rp/macros.json 水合）可解析', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
      if (u.includes('/dsht-rp/rp/identity')) return ok({ user: 'U', char: 'C' })
      if (u.includes('/dsht-mvu/variables')) return ok({ variables: {} })
      if (u.includes('/dsht-rp/macros/list')) return ok({ macros: { t44custom: '自定义值' } })
      if (u.includes('/dsht-tavern-helper/variables')) return ok({ variables: {} })
      throw new Error(`unstubbed fetch: ${u}`)
    }))
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParams('{{t44custom}}')).toBe('自定义值')
    unregisterMacro('t44custom')
  })
})

describe('host 同步宏门面：substituteParamsExtended 的 postProcessFn', () => {
  it('只加工**宏结果**，不加工整段文本（否则正则会被整体转义）', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // findRegex 里既有宏又有正则元字符：只有宏结果该被转义
    const out = hostSubstituteParamsExtended('a.b{{char}}(c)', {}, escape)
    expect(out).toBe('a.b丰川祥子(c)')
  })

  it('postProcessFn 抛错 → 返回未加工结果（不炸）', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    const out = hostSubstituteParamsExtended('{{char}}', {}, () => { throw new Error('boom') })
    expect(out).toBe('丰川祥子')
  })

  it('additionalMacro（dynamicMacros）优先于注册宏，且仅本次调用可见', async () => {
    stubDataPlane()
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(hostSubstituteParamsExtended('{{solo}}', { solo: 'DYN' })).toBe('DYN')
    // 下一次调用没带 → 回到「未知宏原样保留」（未污染全局注册表）
    expect(hostSubstituteParams('{{solo}}')).toBe('{{solo}}')
  })
})

// ---------------------------------------------------------------------------
// 心跳 51 续：作用域取数失败**必须留痕**（L42 —— 有意降级 ≠ 可以静默）
// 空树是正确的降级语义（引擎会走回落链），但「服务端 5xx / 参数不全」与
// 「该作用域确实没有变量」在调用点完全等价 —— 不打日志就再也分不出来。
// ---------------------------------------------------------------------------
describe('host 同步宏门面：作用域取数失败的留痕（L42）', () => {
  it('scope 端点返回 500 → 出声告警一次，且不阻塞整体水合', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
      if (u.includes('/dsht-rp/rp/identity')) return ok({ user: '旅行者', char: '丰川祥子' })
      if (u.includes('/dsht-mvu/variables')) return ok({ variables: {} })
      if (u.includes('/dsht-rp/macros/list')) return ok({ macros: {} })
      if (u.includes('scope=character')) return { ok: false, status: 500, json: async () => ({}) }
      if (u.includes('/dsht-tavern-helper/variables')) return ok({ variables: {} })
      throw new Error('unstubbed ' + u)
    }))
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    // 环境仍然水合（单作用域失败不拖垮整体）
    expect(getHostMacroEnv()).not.toBeNull()
    expect(hostSubstituteParams('{{char}}')).toBe('丰川祥子')
    const joined = warn.mock.calls.flat().join(' ')
    expect(joined).toContain('宏环境作用域 character 取数失败')
    expect(joined).toContain('HTTP 500')
    warn.mockRestore()
  })

  it('同一失败重复触发只告警一次（按 scope:原因 去重，不刷爆 console）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // `isFresh` 用 Date.now()，故用可控时钟推过 TTL 触发第二次真拉取（不用 reset —— 那会清掉去重集合）
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let scopeHits = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
      if (u.includes('/dsht-rp/rp/identity')) return ok({ user: '旅行者', char: '丰川祥子' })
      if (u.includes('/dsht-mvu/variables')) return ok({ variables: {} })
      if (u.includes('/dsht-rp/macros/list')) return ok({ macros: {} })
      if (u.includes('scope=chat')) { scopeHits += 1; return { ok: false, status: 404, json: async () => ({}) } }
      if (u.includes('/dsht-tavern-helper/variables')) return ok({ variables: {} })
      throw new Error('unstubbed ' + u)
    }))
    const warnCount = (): number => warn.mock.calls.filter((c) => String(c[0]).includes('作用域 chat 取数失败')).length

    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(warnCount()).toBe(1)

    clock += 6000 // 越过 ENV_TTL → 允许再拉一次
    refreshHostMacroEnv('rp-x', 'sess-1')
    await settle()
    expect(scopeHits).toBe(2) // 确实又打了一次服务端
    expect(warnCount()).toBe(1) // 但日志只出过一条（去重生效）
    warn.mockRestore()
  })
})
