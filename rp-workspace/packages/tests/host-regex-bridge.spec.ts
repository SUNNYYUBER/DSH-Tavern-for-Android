/**
 * 【T-42 收口】卡的 `extension_settings.regex` → node 侧正则引擎的写回桥
 * ============================================================================
 * 缺口（真实、非重构）：卡把正则写进宿主 `extension_settings.regex`
 * （`saveRegexesToPreset()` → `ctx.saveSettingsDebounced()`）后，只停在 localStorage，
 * **从未进入** node 侧引擎 —— 引擎读 `$DSH_HOME/rp/regex/global.json`
 * （`dsh-plugin/index.ts:loadGlobalRegex`）。⇒「卡以为绑定了、我方引擎不知道」的静默失败。
 *
 * 本组钉四件事（对应交付要求）：
 *  1. 卡写入 → 触发**既有**路由 `/dsht-rp/regex/save-global`，且载荷字段形状正确（逐字段）
 *  2. **反控**：seed（node → `ext.regex`）引起的落盘**不**触发写回（防回流，最关键）
 *  3. 写回失败 → 出声（console.warn），不静默吞
 *  4. 防抖：连续多次改动只写一次（且落最后一次内容）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetHostRegexBridge, __resetHostStCaches, buildHostStContext, flushHostRegexSync,
  saveHostExtensionSettings, saveHostExtensionSettingsDebounced, flushHostExtensionSettings,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'
import type { ThContextSnapshot } from '../src/dsht-rp-ui/src/client/th-shim.ts'

const LS_KEY = '__dsht_extension_settings'

/** 最小 localStorage 替身 */
function fakeLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => { store.set(k, v) },
    removeItem: (k: string): void => { store.delete(k) },
  }
}

/** 造一份带 GLOBAL 正则的会话快照（seed 的数据源 = `/context` 的 extensionSettingsRegex） */
function snapWithRegex(regexes: Array<Record<string, unknown>>): ThContextSnapshot {
  return { slug: 'rp/_start', extensionSettingsRegex: regexes }
}

/** 卡写进 `extensions.regex` 的**逐字 ST 内部形状**条目（全字段，供逐字段验证） */
const ST_ENTRY = {
  id: 'card-rx-1',
  scriptName: '卡的清洗',
  findRegex: '/<state>[\\s\\S]*?<\\/state>/g',
  replaceString: '',
  trimStrings: ['<s>', '</s>'],
  placement: [1, 2],
  disabled: false,
  markdownOnly: false,
  promptOnly: true,
  runOnEdit: true,
  substituteRegex: 2,
  minDepth: 0,
  maxDepth: 4,
}

/** 记录所有 fetch 调用；`respond` 决定响应（默认成功） */
function stubFetch(respond?: (url: string, init: RequestInit) => unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: unknown, init: unknown) => {
    if (respond !== undefined) return respond(String(url), init as RequestInit) as never
    return { ok: true, status: 200, json: async () => ({ ok: true, count: 1 }) } as never
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取某次 fetch 调用的 JSON 载荷 */
function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string }
  return JSON.parse(init.body ?? '{}') as Record<string, unknown>
}

beforeEach(() => {
  fakeLocalStorage()
  __resetHostStCaches()
  __resetHostRegexBridge()
})

afterEach(() => {
  __resetHostStCaches()
  __resetHostRegexBridge()
  delete (globalThis as { localStorage?: unknown }).localStorage
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('T-42 写回桥：卡写入 → 既有 save-global 路由（字段形状逐条验证）', () => {
  it('卡改 extensions.regex 并落盘 → 打 /dsht-rp/regex/save-global，载荷为转换后的 RegexScript', async () => {
    const fetchMock = stubFetch()
    // 先经历一次 seed（建立"已同步"基准），再模拟卡改动
    const ctx = buildHostStContext({ getSnapshot: () => snapWithRegex([ST_ENTRY]) })
    expect(fetchMock).not.toHaveBeenCalled() // seed 不写回（见下一组）

    const ext = ctx.extensionSettings as Record<string, unknown>
    ;(ext.regex as unknown[]).push({
      id: 'card-rx-2', scriptName: '卡新增', findRegex: '/foo/g', replaceString: 'bar',
      trimStrings: [], placement: [2], disabled: false, markdownOnly: true,
      promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    })
    saveHostExtensionSettings(ext)
    await flushHostRegexSync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }]
    // 承重：必须是**既有**数据面路由（与 RegexPanel.save() 同一条），不是另写的落盘逻辑
    expect(url).toBe('/dsht-rp/regex/save-global')
    expect(init.method).toBe('POST')

    const scripts = bodyOf(fetchMock.mock.calls[0] as unknown[]).scripts as Array<Record<string, unknown>>
    expect(scripts).toHaveLength(2)
    // 逐字段验证：卡的原条目被完整保留（camelCase 字段名两侧一致）
    expect(scripts[0]).toEqual({
      id: 'card-rx-1',
      scriptName: '卡的清洗',
      findRegex: '/<state>[\\s\\S]*?<\\/state>/g',
      replaceString: '',
      trimStrings: ['<s>', '</s>'],
      placement: [1, 2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 2,
      minDepth: 0,
      maxDepth: 4,
    })
    expect(scripts[1]).toMatchObject({ id: 'card-rx-2', findRegex: '/foo/g', markdownOnly: true })
  })

  it('卡条目缺字段 → 补我方 RegexScript 必填默认（不是静默透传 undefined）', async () => {
    const fetchMock = stubFetch()
    buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
    // 只有最小字段的条目（缺 trimStrings/placement/disabled/… 与 id）
    const ext = { regex: [{ scriptName: '裸条目', findRegex: '/x/g' }] }
    saveHostExtensionSettings(ext)
    await flushHostRegexSync()

    const scripts = bodyOf(fetchMock.mock.calls[0] as unknown[]).scripts as Array<Record<string, unknown>>
    expect(scripts).toHaveLength(1)
    // id 缺失 → 确定性生成（`regex-<index>-<ts>`；此处只断言"有 id 且非空"）
    expect(typeof scripts[0].id).toBe('string')
    expect(String(scripts[0].id).length).toBeGreaterThan(0)
    expect(scripts[0].trimStrings).toEqual([])
    expect(scripts[0].placement).toEqual([2])       // 缺 placement → ST 默认 AI_OUTPUT
    expect(scripts[0].disabled).toBe(false)
    expect(scripts[0].markdownOnly).toBe(false)
    expect(scripts[0].promptOnly).toBe(false)
    expect(scripts[0].runOnEdit).toBe(false)
    expect(scripts[0].substituteRegex).toBe(0)
    expect(scripts[0].minDepth).toBeNull()
    expect(scripts[0].maxDepth).toBeNull()
  })
})

describe('T-42 写回桥【反控·防回流】：seed 引起的变更**不**触发写回', () => {
  it('seed 把 node 的 global.json 灌进 ext.regex → 落盘但 fetch 零调用', () => {
    const fetchMock = stubFetch()
    buildHostStContext({ getSnapshot: () => snapWithRegex([ST_ENTRY]) })
    // 数据确实进来了（不是"没数据所以没写回"的假绿）
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { regex?: unknown[] }
    expect(raw.regex).toEqual([ST_ENTRY])
    // 承重：seed 的灌入 + 紧随的落盘**不得**产生写回（否则是「种进去→写回来」自激循环）
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('seed 之后任何一次"内容未变"的落盘仍不写回（循环的第二跳也被断掉）', () => {
    const fetchMock = stubFetch()
    const ctx = buildHostStContext({ getSnapshot: () => snapWithRegex([ST_ENTRY]) })
    const ext = ctx.extensionSettings as Record<string, unknown>
    // 卡只读不写（典型：卡的 updateSTRegexes 过滤后长度没变 → 不 reload、不改内容）
    saveHostExtensionSettings(ext)
    saveHostExtensionSettings(ext)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('反向：卡真的改了内容 → 必须写回（证明上两条不是"永远不写"的假绿）', async () => {
    const fetchMock = stubFetch()
    const ctx = buildHostStContext({ getSnapshot: () => snapWithRegex([ST_ENTRY]) })
    const ext = ctx.extensionSettings as Record<string, unknown>
    ;(ext.regex as Array<Record<string, unknown>>)[0].replaceString = '卡改过的替换串'
    saveHostExtensionSettings(ext)
    await flushHostRegexSync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const scripts = bodyOf(fetchMock.mock.calls[0] as unknown[]).scripts as Array<Record<string, unknown>>
    expect(scripts[0].replaceString).toBe('卡改过的替换串')
  })

  it('无基准时的空集落盘不写回（空集写回会把 node 盘上现存正则清空 = 危险动作）', () => {
    const fetchMock = stubFetch()
    saveHostExtensionSettings({ regex: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('基准未知 + 非空（进程首次见到 localStorage 里已有的卡数据）→ 必须写回一次同步进 node', async () => {
    // 真实场景：上次进程里卡写了正则、node 侧尚未收到就退出；重启后首次落盘要把它们带过去。
    const fetchMock = stubFetch()
    __resetHostStCaches() // 不经过 buildHostStContext（无 seed ⇒ 基准保持 null）
    saveHostExtensionSettings({ regex: [{ id: 'persisted', scriptName: '上次的', findRegex: '/p/g' }] })
    await flushHostRegexSync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const scripts = bodyOf(fetchMock.mock.calls[0] as unknown[]).scripts as Array<Record<string, unknown>>
    expect(scripts[0].id).toBe('persisted')
  })
})

describe('T-42 写回桥：失败必须出声（L42，不静默吞）', () => {
  it('网络异常 → console.warn 且可定位，且不把失败记成已同步（下次可重试）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let call = 0
    stubFetch(() => {
      call += 1
      if (call === 1) throw new Error('network down')
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
    const ext = { regex: [{ id: 'r1', scriptName: '甲', findRegex: '/a/g' }] }
    saveHostExtensionSettings(ext)
    await flushHostRegexSync()

    const hit = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('写回 node 侧失败'))
    expect(hit).toBeDefined()
    expect(hit).toContain('/dsht-rp/regex/save-global')
    expect(hit).toContain('network down')

    // 失败未推进基准 ⇒ 再次落盘应重试（第二次成功）
    saveHostExtensionSettings(ext)
    await flushHostRegexSync()
    expect(call).toBe(2)
  })

  it('HTTP 非 200 / 业务 error → 同样出声', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: 'internal boom' }) }))
    buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
    saveHostExtensionSettings({ regex: [{ id: 'r1', scriptName: '甲', findRegex: '/a/g' }] })
    await flushHostRegexSync()
    const hit = warn.mock.calls.map(c => String(c[0])).join('\n')
    expect(hit).toContain('写回 node 侧失败')
  })

  it('条目全部无法转换（均缺 findRegex）→ 出声且**不**写回空集', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = stubFetch()
    buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
    saveHostExtensionSettings({ regex: [{ scriptName: '坏条目' }] })
    await flushHostRegexSync()
    expect(fetchMock).not.toHaveBeenCalled()
    const hit = warn.mock.calls.map(c => String(c[0])).join('\n')
    expect(hit).toContain('全部无法转换')
  })

  it('条目含我方未知字段 → 出声（转换会丢弃它，不得静默）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubFetch()
    buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
    saveHostExtensionSettings({ regex: [{ id: 'r1', scriptName: '甲', findRegex: '/a/g', _cardPrivate: 1 }] })
    await flushHostRegexSync()
    const hit = warn.mock.calls.map(c => String(c[0])).join('\n')
    expect(hit).toContain('_cardPrivate')
    expect(hit).toContain('会被丢弃')
  })
})

describe('T-42 写回桥：防抖（连续多次改动只写一次）', () => {
  it('同一次交互里的连续改动 → 只发一次，且落最后一次内容', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = stubFetch()
      buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
      const ext = { regex: [{ id: 'r1', scriptName: '甲', findRegex: '/a/g' }] }
      saveHostExtensionSettings(ext)
      saveHostExtensionSettings({ regex: [{ id: 'r2', scriptName: '乙', findRegex: '/b/g' }] })
      saveHostExtensionSettings({ regex: [{ id: 'r3', scriptName: '丙', findRegex: '/c/g' }] })
      expect(fetchMock).not.toHaveBeenCalled() // 防抖窗口内不发
      await vi.advanceTimersByTimeAsync(600)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const scripts = bodyOf(fetchMock.mock.calls[0] as unknown[]).scripts as Array<Record<string, unknown>>
      expect(scripts).toHaveLength(1)
      expect(scripts[0].scriptName).toBe('丙') // 最后一次内容
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushHostExtensionSettings()（立即落盘）会把挂起的正则应允一并发出', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = stubFetch()
      buildHostStContext({ getSnapshot: () => snapWithRegex([]) })
      const ext = { regex: [{ id: 'r1', scriptName: '甲', findRegex: '/a/g' }] }
      saveHostExtensionSettingsDebounced(ext)
      flushHostExtensionSettings()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/dsht-rp/regex/save-global')
    } finally {
      vi.useRealTimers()
    }
  })
})
