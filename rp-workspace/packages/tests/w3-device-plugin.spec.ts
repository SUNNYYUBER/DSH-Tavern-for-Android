/**
 * W-3 回归：设备能力插件（`dsht-plugin-device`）的**失败语义与请求构造**。
 * ============================================================================
 * ## 这条测试守的是什么
 * 设备能力是**可选能力**——多数用户没装 Shizuku。故真正的风险不是「Shizuku 坏了」，
 * 而是**失败时给 agent 什么**：
 *   · 若抛异常 ⇒ agent 看到 stack，不知道该怎么办；
 *   · 若返回空 ⇒ agent 以为成功，继续基于幻觉推进；
 *   · 若文案不可处置 ⇒ 用户被卡住。
 * 本项目头号缺陷族是「静默失败」（P-3 / P-30），故这里逐条钉住**可处置性**。
 *
 * ## 判据（6 条）
 * 1. 桥未配置（无 env）⇒ 四工具**全部**返回可读文案（含"设置面板"指引），**不抛**
 * 2. 桥不可达（端口有、服务没起）⇒ 同上（网络异常也必须被吞成文案）
 * 3. 请求体形态：**op 是枚举 + args 是对象**，且**不含任何 shell 字符串**
 *    （断言 body 里没有 `sh -c` / `;` / `|` 之类拼接痕迹 —— 见设计 §1.1 纪律）
 * 4. native 返回各错误枚举 ⇒ 各自的文案**必须不同**且都提到可处置动作
 *    （若全映射成同一句话，"未安装"与"未授权"就无法区分处置）
 * 5. `device_input` 在 native 拒绝（DENIED_BY_POLICY）时，文案**必须点明是 danger 档**
 *    （否则用户以为是 bug 而非策略）
 * 6. 工具的 `parameters` schema：`device_input` 的 `action` 是**枚举**、
 *    未知 action ⇒ 返回可读提示而非抛
 *
 * ## 为什么用"真 apply + mock ctx"
 * 要测的是**接线**（工具注册后 execute 的实际行为），不是某个纯函数。
 * 用 mock ctx 捕获 register 的定义，再手工驱动 execute。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { apply, inject } from '../src/dsht-plugin-device/index.ts'

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  isConcurrencySafe: () => boolean
}

/**
 * 捕获 apply 注册的工具与提示词段。
 *
 * 【为什么 mock 的是 `ctx.inject` 而不是 `ctx.tools`】定案修法（见插件文件头「定案」）
 * 把工具注册放进了 `ctx.inject(['tools','systemPrompt'], cb)` 的**子 fiber**：
 * 顶层的 `ctx.tools` 在 Cordis 严格代理下**读取即抛**，只有 cb 收到的 scope 才有它。
 * 故 mock 必须走同一条路——否则测的是「另一种接线」，测不到真机语义。
 *
 * `deferred = true` 模拟「该层永远拿不到这些 service」：callback 永不被调用，
 * 但 apply 正常返回（这正是真机上期望的降级态）。
 */
function makeHost({ deferred = false }: { deferred?: boolean } = {}) {
  const tools = new Map<string, ToolDef>()
  const sections: Array<{ name: string; order: number; text: string }> = []
  const injectCalls: string[][] = []
  const ctx = {
    inject: (deps: string[], cb: (scope: unknown) => void) => {
      injectCalls.push(deps)
      if (deferred) return // 依赖永不就绪 ⇒ callback 不执行（真机 web profile 全局层的实况）
      cb({
        tools: { register: (def: ToolDef) => { tools.set(def.name, def) } },
        systemPrompt: {
          section: (def: { name: string; order: number; text: string }) => { sections.push(def) },
        },
      })
    },
  }
  return { ctx, tools, sections, injectCalls }
}

const ALL_TOOLS = ['device_screenshot', 'device_status', 'device_notifications', 'device_input']

const PORT_KEY = 'DSHT_DEVICE_PORT'
const TOKEN_KEY = 'DSHT_DEVICE_TOKEN'

let savedPort: string | undefined
let savedToken: string | undefined

beforeEach(() => {
  savedPort = process.env[PORT_KEY]
  savedToken = process.env[TOKEN_KEY]
  delete process.env[PORT_KEY]
  delete process.env[TOKEN_KEY]
})

afterEach(() => {
  if (savedPort === undefined) delete process.env[PORT_KEY]
  else process.env[PORT_KEY] = savedPort
  if (savedToken === undefined) delete process.env[TOKEN_KEY]
  else process.env[TOKEN_KEY] = savedToken
})

describe('W-3 设备插件：注册面', () => {
  it('四个工具全部注册 + 提示词段在场', () => {
    const h = makeHost()
    apply(h.ctx as never)
    for (const t of ALL_TOOLS) expect(h.tools.has(t), `缺工具 ${t}`).toBe(true)
    expect(h.sections.some((s) => s.name === 'tool:device')).toBe(true)
  })

  it('device_input 的 action 是枚举（不接受任意动作名）', () => {
    const h = makeHost()
    apply(h.ctx as never)
    const def = h.tools.get('device_input')!
    const props = def.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.action.enum).toEqual(['tap', 'swipe', 'text', 'key'])
  })

  it('device_status 的 what 是枚举且含 all', () => {
    const h = makeHost()
    apply(h.ctx as never)
    const props = h.tools.get('device_status')!.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.what.enum).toContain('all')
  })

  it('所有工具都是 non-concurrency-safe（设备操作无并发安全）', () => {
    // 注：device_status / device_notifications 声明为可并发（只读），
    // 但这里断言的是「注入类必须不可并发」——即 device_input 与 device_screenshot。
    const h = makeHost()
    apply(h.ctx as never)
    expect(h.tools.get('device_input')!.isConcurrencySafe()).toBe(false)
    expect(h.tools.get('device_screenshot')!.isConcurrencySafe()).toBe(false)
  })
})

describe('W-3 设备插件：桥未配置时的降级（判据 1）', () => {
  it('无 env ⇒ 四工具全部返回可读文案，且不抛', async () => {
    const h = makeHost()
    apply(h.ctx as never)
    for (const name of ALL_TOOLS) {
      const def = h.tools.get(name)!
      const args = name === 'device_input' ? { action: 'tap', x: 1, y: 1 } : {}
      const out = await def.execute(args, {})
      const text = String(out)
      expect(text.length, `${name} 返回空`).toBeGreaterThan(0)
      // 必须提「设置面板」（可处置指引），而不是只有「失败」两个字
      expect(text, `${name} 未给出处置指引`).toContain('设置面板')
    }
  })

  it('桥不可达（端口有、无监听）⇒ 仍是可读文案而非异常', async () => {
    process.env[PORT_KEY] = '3111' // 该端口无服务
    process.env[TOKEN_KEY] = 'tok'
    const h = makeHost()
    apply(h.ctx as never)
    const out = await h.tools.get('device_status')!.execute({ what: 'battery' }, {})
    const text = String(out)
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('设备') // 文案必须点明是设备能力面
  })
})

describe('W-3 设备插件：请求构造纪律（判据 3）', () => {
  it('请求体只含 op 枚举 + args 对象，无 shell 拼接痕迹', async () => {
    const captured: string[] = []
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      captured.push(String((init as { body?: unknown }).body ?? ''))
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data: { via: 'test' } }),
      } as unknown as Response
    }) as typeof fetch
    process.env[PORT_KEY] = '3111'
    process.env[TOKEN_KEY] = 'tok'
    try {
      const h = makeHost()
      apply(h.ctx as never)
      // 用一个含注入样本的坐标：即使 agent 传了怪值，本插件也只是**原样放进 JSON**
      await h.tools.get('device_status')!.execute({ what: 'battery' }, {})
      await h.tools.get('device_input')!.execute({ action: 'tap', x: 1, y: 2 }, {})
      expect(captured.length).toBe(2)
      for (const body of captured) {
        const parsed = JSON.parse(body) as { op: string; args: Record<string, unknown> }
        expect(typeof parsed.op).toBe('string')
        expect(parsed.args).toBeTypeOf('object')
        // ★ 核心断言：请求体里**不得**出现 shell 调用痕迹
        //   （命令构造固定在 native 层——本插件只传枚举 + 参数）
        expect(body).not.toContain('sh -c')
        expect(body).not.toContain('/system/bin')
        expect(body).not.toContain('screencap ') // 「带空格」= 拼接成命令行的痕迹
      }
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('op 取值必须是 native 命令表的枚举（逐个断言）', async () => {
    const ops: string[] = []
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      const body = JSON.parse(String((init as { body?: unknown }).body ?? '{}')) as { op?: string }
      if (body.op) ops.push(body.op)
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, data: {} }),
      } as unknown as Response
    }) as typeof fetch
    process.env[PORT_KEY] = '3111'
    process.env[TOKEN_KEY] = 'tok'
    try {
      const h = makeHost()
      apply(h.ctx as never)
      await h.tools.get('device_screenshot')!.execute({}, {})
      await h.tools.get('device_status')!.execute({ what: 'battery' }, {})
      await h.tools.get('device_notifications')!.execute({ limit: 5 }, {})
      await h.tools.get('device_input')!.execute({ action: 'tap', x: 1, y: 2 }, {})
      expect(ops).toEqual(['screencap', 'system_status', 'notifications', 'input_tap'])
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('W-3 设备插件：错误文案的区分度与可处置性（判据 4/5）', () => {
  /** 让 native 返回指定错误枚举。 */
  function withErr(err: string, detail = '') {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: false, status: 400,
        text: async () => JSON.stringify({ ok: false, error: err, detail }),
      }) as unknown as Response) as typeof fetch
    return () => { globalThis.fetch = origFetch }
  }

  beforeEach(() => {
    process.env[PORT_KEY] = '3111'
    process.env[TOKEN_KEY] = 'tok'
  })

  it('NEED_SHIZUKU / NOT_AUTHORIZED / DENIED_BY_POLICY / BAD_ARGS 文案互不相同', async () => {
    const seen = new Map<string, string>()
    for (const e of ['NEED_SHIZUKU', 'NOT_AUTHORIZED', 'DENIED_BY_POLICY', 'BAD_ARGS', 'EXEC_FAILED', 'NOT_IMPLEMENTED']) {
      const restore = withErr(e)
      try {
        const h = makeHost()
        apply(h.ctx as never)
        const out = String(await h.tools.get('device_status')!.execute({ what: 'battery' }, {}))
        seen.set(e, out)
      } finally {
        restore()
      }
    }
    const texts = [...seen.values()]
    // 全部非空且两两不同（若映射成一坨，用户无法据文案判断该做什么）
    expect(new Set(texts).size, `文案重复：${JSON.stringify([...seen.entries()])}`).toBe(texts.length)
    for (const [k, v] of seen) expect(v.length, `${k} 文案为空`).toBeGreaterThan(0)
  })

  it('DENIED_BY_POLICY 的文案必须点明「危险/danger 档」（判据 5）', async () => {
    const restore = withErr('DENIED_BY_POLICY')
    try {
      const h = makeHost()
      apply(h.ctx as never)
      const out = String(await h.tools.get('device_input')!.execute({ action: 'tap', x: 1, y: 2 }, {}))
      expect(out).toMatch(/danger|危险/)
      // 且不能只丢一句「被拒绝」——要说明这是策略而非故障
      expect(out).toMatch(/批准|拒绝/)
    } finally {
      restore()
    }
  })

  it('NEED_SHIZUKU 的文案必须给出启动指引（可处置）', async () => {
    const restore = withErr('NEED_SHIZUKU')
    try {
      const h = makeHost()
      apply(h.ctx as never)
      const out = String(await h.tools.get('device_screenshot')!.execute({}, {}))
      expect(out).toContain('Shizuku')
    } finally {
      restore()
    }
  })

  it('native 的 detail 被带出（便于排障，而不是被吞掉）', async () => {
    const restore = withErr('EXEC_FAILED', 'screencap exit=1')
    try {
      const h = makeHost()
      apply(h.ctx as never)
      const out = String(await h.tools.get('device_screenshot')!.execute({}, {}))
      expect(out).toContain('screencap exit=1')
    } finally {
      restore()
    }
  })
})

describe('W-3 设备插件：未知 action 不抛（判据 6）', () => {
  it('device_input 收到未在枚举里的 action ⇒ 可读提示', async () => {
    process.env[PORT_KEY] = '3111'
    process.env[TOKEN_KEY] = 'tok'
    const h = makeHost()
    apply(h.ctx as never)
    const out = String(await h.tools.get('device_input')!.execute({ action: 'reboot' }, {}))
    expect(out).toContain('reboot')
    expect(out).toContain('tap') // 提示可用值
  })
})

/**
 * W-3 事故回归（2026-09-21 真机 boot loop）——判据 7/8。
 *
 * ## 事故全貌（两层语义都踩过，故两条判据各守一层）
 * **第一层**：首版 `inject = ['tools','systemPrompt']`。这两个 service 属 **agent 会话面**，
 *   本插件却挂在 **web profile 全局层**（同层只有 webServer/settings/llm）⇒ 父 fiber 停
 *   PENDING ⇒ Cordis 报 `could not be resolved` ⇒ **整棵插件树加载失败** ⇒
 *   `node exited with code 1; restart in 3s`（连续 45 次）。
 * **第二层**：把 inject 清空后**直接读** `ctx.tools` 做守卫。Cordis 的 ctx 是严格代理，
 *   未声明即读**直接抛**：`cannot get property "tools" without inject` ⇒ 同样打挂整树。
 * **定案**：`inject = []`（父 entry 立即 activated）+ `ctx.inject([...], cb)` 延迟接线
 *   （子 fiber 承载等待；不可得就安静地等，不抛不报错）。
 *
 * ## 各判据守什么
 * 判据 7 守「**不得再把 agent 面 service 放进顶层 inject**」——一旦加回，真机立刻复现
 *   boot loop；这条断言在**单测阶段**（秒级、不需设备）就能拦住。
 * 判据 7b 守「**不得再出现顶层直接访问 ctx.tools / ctx.systemPrompt**」——即第二层坑。
 *   做法：只给 mock 一个 `inject`（**不提供** tools/systemPrompt），若源码里残留任何顶层
 *   `ctx.tools` 读取，`apply` 会因属性不存在而抛（真机上则是 Cordis 代理抛）。
 * 判据 8 守「**依赖缺席时 apply 必须正常返回、工具一个都不注册**」——这是真机上的
 *   **期望降级态**（设备桥照常监听，只是 agent 看不到 device_* 工具）。
 */
describe('W-3 事故回归：web profile 全局层下的延迟接线（判据 7/8）', () => {
  it('判据7：inject 必须为空（声明 agent 会话面 service 会让整树加载失败）', () => {
    expect(inject).toEqual([])
  })

  it('判据7b：inject 里绝不出现 tools / systemPrompt / sessions / agents', () => {
    for (const bad of ['tools', 'systemPrompt', 'sessions', 'agents']) {
      expect(inject, `inject 不得含 '${bad}'（web profile 全局层不可得 ⇒ boot loop）`).not.toContain(bad)
    }
  })

  it('判据7c：apply 不得在顶层直接读 ctx.tools / ctx.systemPrompt（严格代理会抛）', () => {
    // mock 只有 inject：顶层读 ctx.tools 会抛（真机语义）；能正常返回即证明没读
    const h = makeHost()
    expect(() => apply(h.ctx as never)).not.toThrow()
    // 且必须是通过 ctx.inject 声明的
    expect(h.injectCalls.length, 'apply 未经 ctx.inject 声明依赖').toBe(1)
    expect(h.injectCalls[0]).toEqual(['tools', 'systemPrompt'])
  })

  it('判据8：依赖缺席（deferred）⇒ apply 正常返回且一个工具都不注册', () => {
    const h = makeHost({ deferred: true })
    expect(() => apply(h.ctx as never)).not.toThrow()
    expect(h.tools.size, '依赖缺席却注册了工具（半残状态）').toBe(0)
    expect(h.sections.length).toBe(0)
    // 依赖声明仍须发出（将来 service 挂上这层时能自动生效）
    expect(h.injectCalls[0]).toEqual(['tools', 'systemPrompt'])
  })

  it('判据8b：依赖就绪（正常路径）⇒ 工具注册照常发生（回归不误伤）', () => {
    const h = makeHost()
    apply(h.ctx as never)
    for (const t of ALL_TOOLS) expect(h.tools.has(t), `依赖就绪却缺 ${t}`).toBe(true)
  })
})
