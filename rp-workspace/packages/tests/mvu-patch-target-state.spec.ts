/**
 * MVU-3：`/dsht-mvu/variables/patch` 的 `target:'state'`（2026-09-21）。
 * ============================================================================
 * ## 这条测试守的是什么（MVU 三「做」之变量点值编辑的端点语义）
 * MVU 双树读侧是**深合并、state 赢**（见 mvu-dual-tree.spec.ts）。由此推出一个
 * 反直觉但刚性的结论：**手动编辑变量必须写 `state` 树**——写 `variables` 会被
 * `state` 里的同名旧值遮蔽，用户看到的是「编辑了但没生效」（本项目头号缺陷族：
 * 静默失败）。故端点加 `target` 选项：
 *   · 缺省 = `'variables'`（initvar 落点，TH shim 既有语义，不能破）
 *   · `'state'` = LLM UpdateVariable 同落点（RpStateView 的 ✎ 编辑走它）
 *
 * ## 判据
 * 1. `target:'state'` ⇒ 补丁落 `state` 树，`variables` 原样不动。
 * 2. 编辑不被遮蔽：state 已有旧值时，改 state 后 GET /variables 合并视图
 *    立即反映新值（若误写 variables，合并视图仍回旧值——负控式判据）。
 * 3. 缺省 target 回归：不传 target 仍落 `variables`（TH shim 语义不破）。
 * 4. schema 校验走**合并视图**（与读侧同形）：改 state 导致合并视图违例 ⇒ 422，
 *    且不落盘（不落盘 = 磁盘文件与写前 deep equal）。
 *
 * ## 探针形态
 * 与 b12-memory-master-switch.spec.ts 同款：真 apply + mock ctx 捕获前缀路由，
 * 手工构造 req/res 驱动；DSH_HOME 指到临时目录，直接断言磁盘状态文件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/dsht-plugin-mvu/index.ts'

type RouteHandler = (req: unknown, res: unknown) => void

/** 造一个能驱动 dsht-plugin-mvu apply 的最小宿主（webServer 前缀路由 + settings 锚点） */
function makeHost() {
  const routes = new Map<string, RouteHandler>()
  const ctx = {
    settings: { register: () => {} },
    webServer: {
      register: (spec: { kind?: string; path?: string; handler?: unknown }) => {
        if (spec?.kind === 'prefix' && typeof spec.path === 'string' && typeof spec.handler === 'function') {
          routes.set(spec.path, spec.handler as RouteHandler)
        }
        return () => {}
      },
      host: '127.0.0.1' as const,
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(ctx as any, undefined)
  const handler = routes.get('/dsht-mvu')
  if (!handler) throw new Error('dsht-plugin-mvu 未注册 /dsht-mvu 数据面（接线变了？）')
  return handler
}

/**
 * 直接调数据面处理器，收集 (status, body)。
 * 契约点（同 b12 探针注释）：handler 是 `(rawReq, rawRes)` 两参、内部 `void (async …)`，
 * 必须等 res.end 触发完成信号；req 必须带 loopback Host 过信任栅栏。
 */
async function callRoute(
  handler: RouteHandler,
  method: string,
  sub: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
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
  const raw = JSON.stringify(body ?? {})
  const req = {
    method,
    url: `/dsht-mvu${sub}`,
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(raw, 'utf8') },
  }
  handler(req, res)
  await finished
  return { status, body: payload }
}

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'mvu-patch-target-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'rp', 'state'), { recursive: true })
})
afterEach(async () => {
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  await rm(home, { recursive: true, force: true })
})

/** 铺一份会话状态文件（rp/state/<sid>.json） */
function seedState(sid: string, file: Record<string, unknown>): void {
  writeFileSync(join(home, 'rp', 'state', `${sid}.json`), JSON.stringify(file))
}
/** 读回磁盘上的会话状态文件 */
function readState(sid: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, 'rp', 'state', `${sid}.json`), 'utf8'))
}

describe('MVU-3 /dsht-mvu/variables/patch target 选项', () => {
  it("✅ 判据 1：target:'state' ⇒ 补丁落 state 树，variables 原样不动", async () => {
    const sid = 'sess-target-state'
    seedState(sid, { variables: { 好感度: 0, 地点: '咖啡厅' } })
    const handler = makeHost()

    const r = await callRoute(handler, 'POST', '/variables/patch', {
      sessionId: sid,
      target: 'state',
      patches: [{ op: 'replace', path: '/好感度', value: 42 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    const disk = readState(sid)
    expect((disk.state as Record<string, unknown>)['好感度']).toBe(42)
    const vars = disk.variables as Record<string, unknown>
    expect(vars['好感度']).toBe(0) // 不动
    expect(vars['地点']).toBe('咖啡厅') // 兄弟键不丢
  })

  it('✅ 判据 2：编辑不被 state 旧值遮蔽——改 state 后合并视图立即反映新值', async () => {
    const sid = 'sess-shadow'
    // state 已有运行期旧值：这是「写 variables 会被遮蔽」的真实场景
    seedState(sid, { variables: { 好感度: 0 }, state: { 好感度: 3 } })
    const handler = makeHost()

    const r = await callRoute(handler, 'POST', '/variables/patch', {
      sessionId: sid,
      target: 'state',
      patches: [{ op: 'replace', path: '/好感度', value: 42 }],
    })
    expect(r.status).toBe(200)

    const v = await callRoute(handler, 'GET', `/variables?sessionId=${sid}`)
    expect(v.status).toBe(200)
    // 若补丁误落 variables，深合并 state 赢 ⇒ 这里会回 3（旧值遮蔽），本条即红
    expect((v.body.variables as Record<string, unknown>)['好感度']).toBe(42)
  })

  it('✅ 判据 3：缺省 target 回归——不传 target 仍落 variables（TH shim 语义不破）', async () => {
    const sid = 'sess-default-target'
    seedState(sid, { variables: { 好感度: 0 } })
    const handler = makeHost()

    const r = await callRoute(handler, 'POST', '/variables/patch', {
      sessionId: sid,
      patches: [{ op: 'replace', path: '/好感度', value: 9 }],
    })
    expect(r.status).toBe(200)

    const disk = readState(sid)
    expect((disk.variables as Record<string, unknown>)['好感度']).toBe(9)
    expect(disk.state).toBeUndefined() // 不应凭空造出 state 树
  })

  it('✅ 判据 4：schema 校验走合并视图——改 state 导致违例 ⇒ 422 且不落盘', async () => {
    const sid = 'sess-schema-merged'
    const seed = {
      variables: { 好感度: 0 },
      variableSchema: { type: 'object', properties: { 好感度: { type: 'number' } } },
    }
    seedState(sid, seed)
    const handler = makeHost()

    const r = await callRoute(handler, 'POST', '/variables/patch', {
      sessionId: sid,
      target: 'state',
      patches: [{ op: 'replace', path: '/好感度', value: '很高' }],
    })
    expect(r.status).toBe(422)
    expect(Array.isArray(r.body.issues)).toBe(true)

    // 不落盘：磁盘文件与写前 deep equal（包括不应出现 state 树）
    expect(readState(sid)).toEqual(seed)
  })

  it('边界：target 传未知字符串按缺省处理（落 variables），不 500', async () => {
    const sid = 'sess-unknown-target'
    seedState(sid, { variables: { a: 1 } })
    const handler = makeHost()

    const r = await callRoute(handler, 'POST', '/variables/patch', {
      sessionId: sid,
      target: 'bogus',
      patches: [{ op: 'replace', path: '/a', value: 2 }],
    })
    expect(r.status).toBe(200)
    const disk = readState(sid)
    expect((disk.variables as Record<string, unknown>)['a']).toBe(2)
    expect(disk.state).toBeUndefined()
  })
})
