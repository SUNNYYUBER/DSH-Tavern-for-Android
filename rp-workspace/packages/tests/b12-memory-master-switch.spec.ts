/**
 * B12 回归：`dsht-plugin-memory` 的**总开关必须连"注入"一起关**。
 * ============================================================================
 * ## 这条测试守的是什么（心跳 78 修复的真缺陷）
 * memory 有**两条独立路径**：
 *   · **生成侧**（`tick` 里的 `if (!cfg.enabled) return`，index.ts:1316 —— 由 `setInterval(20s)` 驱动，
 *     见 :1386）—— 关掉即不总结；
 *   · **消费侧**（`agent/pre-step` 把记忆快照注入本轮 messages）—— 修复前**完全没看 `cfg.enabled`**。
 * ⇒ 用户关掉「总开关」后的实际行为是：**不再生成新记忆，但旧记忆每轮仍被注入**。
 *    这正是 T-87 文档 B12 说的"无法单独关闭剧情记忆"在实现层的根因。
 *    而且它**完全静默**（没有日志说"我还在注入"），用户只会觉得"关了怎么还占上下文"。
 *
 * ## 判据（4 项）
 * 1. 总开关 **关** ⇒ pre-step **不注入**任何 `source.plugin === name` 的快照消息
 * 2. 总开关 **开** ⇒ pre-step **会注入**（证明判据 1 不是"什么都不做"造成的假绿 —— 反控式正控）
 * 3. 总开关 **关** ⇒ pre-step **仍 await next()**（waterfall 契约：不能吞掉下游）
 * 4. 总开关 **关** ⇒ 待办文件 `memory-expand/<sid>.json` 被**丢弃**而非被**消费**
 *    （「文件被删」本身不具区分性：既有消费路径 index.ts:810 也会删它。
 *     故断言必须落在「没有把它变成 oneshot 注入」——这才是"关闭期间不留存、也不放出"）
 * 5. 总开关 **关** ⇒ 数据面 `/expand`、`/summarize` **显式拒绝**（HTTP 409），而不是
 *    「回 200 收下、随后静默丢弃/不执行」。理由：关闭态下 pre-step 会清掉待办、
 *    `tick` 会立即 return ⇒ 若仍回 `ok:true`，用户看到的是"已排队"却永远等不到结果 ——
 *    正是本项目头号缺陷族（静默失败）。**判据 1 修的是"关不干净"，判据 5 修的是"关得无声"**。
 *
 * ## 为什么用"真 apply + mock ctx"而不是直接调内部函数
 * 缺陷在**接线**上（pre-step 没读 cfg），不在某个纯函数里。只测纯函数会漏掉它。
 * 故这里驱动真实的 `apply()`，用 mock ctx 捕获它注册的 pre-step 处理器，再手工触发。
 *
 * ## 两个必须满足的"探针前提"（否则测的是别的东西 —— L142 同族）
 * a. **cwd 必须含 `rp/` 路径段**：`slugFromCwd`（index.ts:1189）正则
 *    `/(^|[\\/])rp[\\/]([^/]+)$/` —— 形如 `/tmp/rp-slug-on` 的 cwd **不匹配**，
 *    pre-step 会在 :745 直接 return，测到的变成"slug 解析失败"，与总开关无关。
 * b. **记忆本的 comment 必须是 `记忆#N-M` 形态**（`parseMemoryRange`，index.ts:288），
 *    否则 `maxFloor` 恒 0，注入文本里的区间信息失真（断言虽仍能过，但样本已不真实）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/dsht-plugin-memory/index.ts'

const PLUGIN_NAME = 'dsht-plugin-memory'

/** 一份能驱动注入路径的"记忆本"内容：comment 用 `记忆#N-M`（见文件头前提 b） */
const LORE_ENTRY = { comment: '记忆#1-1', content: '这是第 1 楼的剧情摘要', key: [], position: 0, depth: 0 }

/**
 * 造一个能驱动 memory `apply` 的最小宿主。
 * @param settingsValue `ctx.settings.get(CONFIG_NS)` 的返回值（= 用户配置）
 */
function makeHost(settingsValue: Record<string, unknown> | undefined) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  /** 数据面路由：prefix → handler（`registerPrefix` 的两参形态 `(rawReq, rawRes)`） */
  const routes = new Map<string, (req: unknown, res: unknown) => void>()
  const ctx = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler)
      return () => {}
    },
    settings: {
      register: () => {},
      get: () => settingsValue,
      update: async () => settingsValue,
    },
    webServer: {
      // `registerPrefix`（dsht-plugin-shared/http.ts:94）用 `webServer.register({kind:'prefix', path, handler})`
      register: (spec: { kind?: string; path?: string; handler?: unknown }) => {
        if (spec?.kind === 'prefix' && typeof spec.path === 'string' && typeof spec.handler === 'function') {
          routes.set(spec.path, spec.handler as (req: unknown, res: unknown) => void)
        }
        return () => {}
      },
      port: 3080,
      host: '127.0.0.1',
    },
    // llm / agentDefaultModel 故意不给：它们是可选服务，memory 内部按"可能没有"写
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(ctx as any, undefined)
  const preStep = handlers.get('agent/pre-step')
  if (typeof preStep !== 'function') throw new Error('memory 未注册 agent/pre-step（接线变了？）')
  return { preStep, routes }
}

/**
 * 直接调数据面处理器，收集 (status, body)。
 *
 * ⚠️ 两个易踩的契约点（本探针最初两条都踩了，导致报错"reading 'host'"）：
 *   ① `registerPrefix` 存进 webServer 的 handler 签名是 **`(rawReq, rawRes)`**（两参），
 *      sub-path 由它内部用 `subPath(req.url, prefix)` 现切 —— **不要**自己把 sub 当第一参传进去；
 *   ② 该 handler 内部是 `void (async () => {...})()`，**不返回 promise**
 *      ⇒ 必须靠 `res.end` 触发的完成信号来 await，否则断言会跑在处理器之前（假绿/假红）。
 * 且 req 必须带 loopback Host —— 否则会被 isTrusted 栅栏 403 挡掉，测到的就不是我们的守卫。
 */
async function callRoute(
  routes: Map<string, (req: unknown, res: unknown) => void>,
  sub: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const handler = routes.get('/dsht-memory')
  if (!handler) throw new Error('memory 未注册 /dsht-memory 数据面（接线变了？）')
  let status = 0
  let payload: Record<string, unknown> = {}
  let done!: () => void
  const finished = new Promise<void>((r) => { done = r })
  const res = {
    writeHead: (code: number) => { status = code },
    end: (text: string) => {
      try { payload = JSON.parse(text) } catch { payload = {} }
      done()
    },
  }
  // 请求体做成 async iterable（readJsonBody 用 `for await` 消费）
  const raw = JSON.stringify(body ?? {})
  const req = {
    method: 'POST',
    url: `/dsht-memory${sub}`,
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(raw, 'utf8') },
  }
  handler(req, res)
  await finished
  return { status, body: payload }
}

/** 造一个 memory 认得出来的会话对象（cwd 需能解析出 slug，见文件头前提 a） */
function makeSession(sid: string, cwd: string, events: unknown[] = []) {
  return {
    id: sid,
    header: { cwd },
    events,
  }
}

/** 两楼真实事件（供「展开回显」装配楼层文本 —— 没有楼层就产不出 oneshot 快照） */
function twoFloorEvents() {
  return [
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第一楼：用户开场' }] } },
    { type: 'assistant/message', data: { turn: 1, role: 'assistant', content: [{ type: 'text', text: '第一楼：角色回应' }] } },
  ]
}

/** 触发 pre-step，返回 (decision, nextCalled) */
async function runPreStep(
  preStep: (...args: unknown[]) => unknown,
  session: ReturnType<typeof makeSession>,
  decision: { kind: string; messages: unknown[] },
) {
  let nextCalled = false
  const next = async () => { nextCalled = true; return decision }
  const out = await preStep({ agent: { session, phase: { kind: 'enter' } } }, next)
  return { out: out as { kind?: string; messages?: unknown[] }, nextCalled }
}

/** 从 messages 里挑出 memory 自己写的快照消息 */
function memorySnapshots(messages: unknown[]) {
  return messages.filter((m) => {
    const src = (m as { source?: { plugin?: unknown } })?.source
    return src?.plugin === PLUGIN_NAME
  })
}

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'b12-memory-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'rp'), { recursive: true })
})
afterEach(async () => {
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  await rm(home, { recursive: true, force: true })
})

/**
 * 铺一个满足 `slugFromCwd` 全部门槛的工作区：
 *   · `<home>/rp/<slug>/rp.json` 必须存在（否则 slug 解析返回 null）；
 *   · 可选铺一本记忆本（证明"本该有东西可注入"）。
 * @returns cwd —— 形如 `<home>/rp/<slug>`，**必须**带 `rp/` 段（前提 a）
 */
function setupWorkspace(slug: string, opts: { withLore?: boolean } = {}): string {
  const slugDir = join(home, 'rp', slug)
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(slugDir, 'rp.json'), JSON.stringify({ name: '测试角色' }))
  if (opts.withLore) {
    // 路径与 `memoryLorePath`（index.ts:1201）一致：skills/wb-memory-<slug>/references/lore.json
    const wbDir = join(home, 'skills', `wb-memory-${slug}`, 'references')
    mkdirSync(wbDir, { recursive: true })
    writeFileSync(join(wbDir, 'lore.json'), JSON.stringify({
      name: '剧情记忆', entries: [LORE_ENTRY], importWarnings: [],
    }))
  }
  return slugDir
}

describe('B12 dsht-plugin-memory 总开关必须连注入一起关', () => {
  it('总开关关闭 ⇒ 不注入任何记忆快照（修复前会注入）', async () => {
    // 记忆本照铺：确保"本该有东西可注入"，从而证明是总开关挡住了它（而非没东西可注）
    const cwd = setupWorkspace('rp-slug-off', { withLore: true })

    const { preStep } = makeHost({ 总开关: false, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
    const session = makeSession('sess-off', cwd)
    const decision = { kind: 'enter', messages: [{ role: 'user', content: [] }] }
    const { out, nextCalled } = await runPreStep(preStep, session, decision)

    expect(memorySnapshots(out.messages ?? [])).toHaveLength(0)
    // 判据 3：waterfall 契约 —— 仍要 await next()
    expect(nextCalled).toBe(true)
    // 且 decision 本身不被篡改（不能"关掉"变成"清空消息"）
    expect(out.messages).toHaveLength(1)
  })

  it('总开关开启 ⇒ 仍会注入（正控：证明上一条不是"整个 pre-step 都没跑"）', async () => {
    const cwd = setupWorkspace('rp-slug-on', { withLore: true })

    const { preStep } = makeHost({ 总开关: true, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
    const session = makeSession('sess-on', cwd)
    const decision = { kind: 'enter', messages: [{ role: 'user', content: [] }] }
    const { out, nextCalled } = await runPreStep(preStep, session, decision)

    expect(nextCalled).toBe(true)
    // 这条是"正控"：如果它也不注入，说明本测试的样本构造不出注入场景（探针失效，L142），
    // 那时第一条的"绿"毫无意义。
    const snaps = memorySnapshots(out.messages ?? [])
    expect(snaps.length).toBeGreaterThan(0)
    // 注入内容必须是记忆本正文（顺带验"注入的是真东西"，不是某个空壳 marker）
    expect(JSON.stringify(snaps)).toContain(LORE_ENTRY.content)
  })

  it('总开关关闭 ⇒ 待办展开文件被丢弃（不消费成注入），防重开后陈旧快照突袭', async () => {
    const slug = 'rp-slug-pending'
    const cwd = setupWorkspace(slug, { withLore: true })
    const sid = 'sess-pending'
    const pendingDir = join(home, 'rp', 'memory-expand')
    const pendingPath = join(pendingDir, `${sid}.json`)
    const writePending = () => {
      mkdirSync(pendingDir, { recursive: true })
      writeFileSync(pendingPath, JSON.stringify({ requests: [{ from: 1, to: 1 }] }))
    }
    const oneshotSnapshots = (messages: unknown[]) =>
      memorySnapshots(messages).filter(
        (m) => (m as { source?: { oneshot?: unknown } })?.source?.oneshot === true,
      )

    const decision = { kind: 'enter', messages: [{ role: 'user', content: [] }] }

    // ---- 阶段 A：关闭态 —— 文件必须被**丢弃**（删除且不变成注入）----
    writePending()
    expect(existsSync(pendingPath)).toBe(true)
    {
      const { preStep } = makeHost({ 总开关: false, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
      const { out } = await runPreStep(preStep, makeSession(sid, cwd, twoFloorEvents()), decision)
      expect(existsSync(pendingPath)).toBe(false)
      // 区分性判据：不能是"被消费路径删掉并注入了"（那样就是把关闭期攒的请求放出来了）
      expect(oneshotSnapshots(out.messages ?? [])).toHaveLength(0)
    }

    // ---- 阶段 B：正控（开启态）—— 同一份文件**会**被消费成 oneshot 注入 ----
    // 若 B 不成立，则 A 的"无注入"可能只是"这个文件驱动不了注入"（探针失效，L142）。
    writePending()
    {
      const { preStep } = makeHost({ 总开关: true, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
      const { out } = await runPreStep(preStep, makeSession(sid, cwd, twoFloorEvents()), decision)
      expect(existsSync(pendingPath)).toBe(false)
      expect(oneshotSnapshots(out.messages ?? []).length).toBeGreaterThan(0)
    }
  })

  it('总开关关闭 ⇒ 数据面 /expand 与 /summarize 显式拒绝（不静默收下）', async () => {
    const slug = 'rp-slug-api'
    setupWorkspace(slug, { withLore: true })
    const sid = 'sess-api'

    // ---- 关闭态：两个端点都必须 409 + 可行动指引 ----
    {
      const { routes } = makeHost({ 总开关: false, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
      const ex = await callRoute(routes, '/expand', { sessionId: sid, from: 1, to: 1 })
      expect(ex.status).toBe(409)
      expect(String(ex.body.error ?? '')).toContain('总开关已关闭')

      const sm = await callRoute(routes, '/summarize', { sessionId: sid })
      expect(sm.status).toBe(409)
      expect(String(sm.body.error ?? '')).toContain('总开关已关闭')
    }

    // ---- 正控（开启态）：/summarize 必须**不**是 409 ----
    // 若开启态也 409，说明上一条测到的是"端点根本没接线"而非"总开关生效"（探针失效，L142）。
    {
      const { routes } = makeHost({ 总开关: true, 每N楼总结: 11, 保留近M楼原文: 30, 近窗字符预算: 60000, 折叠老楼层: true, 摘要字数上限: 600 })
      const sm = await callRoute(routes, '/summarize', { sessionId: sid })
      expect(sm.status).toBe(200)
      expect(sm.body.ok).toBe(true)
    }
  })
})
