// @vitest-environment jsdom
/**
 * 【T-48 · 心跳 67】ST 扩展模板**真渲染** + 扩展文件存储/文件路由 —— 单测。
 * ============================================================================
 * 判据纪律：断言**行为**（渲染出的 HTML、HTTP 状态码、返回值形状），不断言形状假设。
 * 反控锚点（本文件的用例必须钉住真实现的四点，任何一点退回退化实现即转红）：
 *  ① 文件存在 → **真渲染出 HTML**（含 Handlebars 变量替换），不是 undefined；
 *  ② sanitize=true 清掉 `<script>` / `on*`，sanitize=false 保留；
 *  ③ 文件不存在 → 基准同形失败路径（console.error + toastr.error + **返回 undefined 不 reject**）；
 *  ④ 路由层拒绝路径穿越（不可信输入）。
 *
 * 环境：jsdom —— DOMPurify 需要真实 DOM 才能验证清理面（在纯 node 下它没有 sanitize，
 * 见 src/dsht-rp-ui/src/client/ext-template-render.ts 的 sanitize 分支）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import {
  __clearTemplateCache, __templateCacheKeys, renderExtensionTemplate,
  renderExtensionTemplateAsync, renderTemplate, type RenderEnv,
} from '../src/dsht-rp-ui/src/client/ext-template-render.ts'
import {
  __resetFacadeDegradedWarnings, buildHostStContext,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'
import { buildShimSource } from '../src/dsht-rp-ui/src/client/th-shim.ts'
import {
  handleScriptAssetRequest, resolveScriptAsset, SCRIPT_ASSET_PREFIXES,
} from '../src/dsh-plugin/ext-asset.ts'

// ---------------------------------------------------------------------------
// 夹具：把「完整链」起在真 DOM + mock 取文件之上
// ---------------------------------------------------------------------------

/** fetch 应答表：路径片段 → 模板内容（**缺省 = 404**，即文件不存在的真实形态） */
let files: Record<string, string>

function installFetchMock(): void {
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    const hit = Object.entries(files).find(([k]) => u.includes(k))
    if (hit === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
    }
    return { ok: true, status: 200, statusText: 'OK', text: async () => hit[1] }
  })
}

let realFetch: unknown
beforeEach(() => {
  realFetch = (globalThis as { fetch?: unknown }).fetch
  files = {}
  __clearTemplateCache()
  __resetFacadeDegradedWarnings()
  installFetchMock()
})
afterEach(() => {
  ;(globalThis as { fetch: unknown }).fetch = realFetch
  __clearTemplateCache()
  delete (globalThis as { toastr?: unknown }).toastr
  vi.restoreAllMocks()
})

/** 宿主门面（= 真渲染的**单实现**承载者） */
function hostCtx(): Record<string, unknown> {
  return buildHostStContext()
}

/** 记录 console.error 的调用（失败路径的判据） */
function spyConsoleError(): { joined: () => string; first: () => unknown[] } {
  const calls: unknown[][] = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { calls.push(a) })
  return {
    joined: () => calls.map((a) => a.map(String).join(' ')).join('\n'),
    first: () => calls[0] ?? [],
  }
}

const TEMPLATE = '<div class="tpl">{{title}}</div>'

// ---------------------------------------------------------------------------
// 1) 真渲染：文件存在 → 真 HTML（宿主门面 = 唯一实现在承载）
// ---------------------------------------------------------------------------

describe('T-48 真渲染：renderExtensionTemplateAsync 渲染出真 HTML', () => {
  it('【承重】文件存在 → 返回渲染后的 HTML（含变量替换），不再是 undefined', async () => {
    files['scripts/extensions/regex/editor.html'] = TEMPLATE
    const out = await (hostCtx().renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('regex', 'editor', { title: '正则编辑器' })
    expect(out).toBeDefined()
    expect(out).toContain('正则编辑器')
    expect(out).toContain('class="tpl"')
    expect(out).not.toContain('{{title}}')
  })

  it('扩展名允许含 /（ST 的 third-party/<name> 形态）', async () => {
    files['scripts/extensions/third-party/chat-history-backup/panel.html'] = '<p>{{n}}</p>'
    const out = await (hostCtx().renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('third-party/chat-history-backup', 'panel', { n: '备份' })
    expect(out).toBe('<p>备份</p>')
  })

  it('renderTemplateAsync（非 fullPath）取 /scripts/templates/<id>.html', async () => {
    files['/scripts/templates/welcome.html'] = '<h1>{{who}}</h1>'
    const env = hostCtx()
    void env
    // 门面**没有** renderTemplate*（基准 getContext() 也没有 ⇒ L36 不能多）；
    // 该分支由核心模块直接覆盖（同一条链的非 fullPath 取路径规则）。
    const { renderTemplateAsync } = await import('../src/dsht-rp-ui/src/client/ext-template-render.ts')
    const out = await renderTemplateAsync({
      compile: (s) => (d) => `${s}|${JSON.stringify(d)}`,
      sanitize: (h) => h,
      fetchText: async (p) => { const r = await fetch(p); if (!r.ok) throw new Error(`bad ${p}`); return r.text() },
      applyLocale: (h) => h,
    }, 'welcome', { who: '开发者' })
    expect(out).toBe('<h1>{{who}}</h1>|{"who":"开发者"}')
  })

  it('TEMPLATE_CACHE 按**路径**缓存编译结果（同一路径只取一次文件）', async () => {
    files['scripts/extensions/x/a.html'] = '<i>{{v}}</i>'
    const ctx = hostCtx()
    const fn = ctx.renderExtensionTemplateAsync as (e: unknown, t: unknown, d: unknown) => Promise<unknown>
    await fn('x', 'a', { v: 1 })
    await fn('x', 'a', { v: 2 })
    const fetchMock = (globalThis as { fetch: unknown }).fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 缓存 key 是**规范化后的根绝对路径**（见 ext-template-render.ts 的 toRootPath）
    expect(__templateCacheKeys()).toContain('/scripts/extensions/x/a.html')
  })

  it('不同路径各缓存一份（路径是 key，不是 templateId）', async () => {
    files['scripts/extensions/p/q.html'] = '<i>{{v}}</i>'
    files['/scripts/templates/q.html'] = '<b>{{v}}</b>'
    const { renderTemplateAsync } = await import('../src/dsht-rp-ui/src/client/ext-template-render.ts')
    const env: RenderEnv = {
      compile: (s) => (d) => s.replace(/\{\{v\}\}/g, String((d as { v: unknown }).v)),
      sanitize: (h) => h,
      fetchText: async (p) => { const r = await fetch(p); if (!r.ok) throw new Error('404'); return r.text() },
      applyLocale: (h) => h,
    }
    await renderExtensionTemplateAsync(env, 'p', 'q', { v: 'A' })
    await renderTemplateAsync(env, 'q', { v: 'B' })
    expect(__templateCacheKeys().sort())
      .toEqual(['/scripts/extensions/p/q.html', '/scripts/templates/q.html'])
  })
})

// ---------------------------------------------------------------------------
// 2) Handlebars 语义（逐条：转义 / 不转义 / #if / #each）
// ---------------------------------------------------------------------------

describe('T-48 Handlebars 语义（与基准同源引擎，不自造迷你实现）', () => {
  let seq = 0
  /** 每个用例一个新路径（TEMPLATE_CACHE 按路径缓存，复用会读到上一份编译结果） */
  const render = async (tpl: string, data: unknown, sanitize = false): Promise<string | undefined> => {
    const id = `h${++seq}`
    files[`scripts/extensions/hb/${id}.html`] = tpl
    const ctx = hostCtx()
    return (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown, s: unknown,
    ) => Promise<string | undefined>)('hb', id, data, sanitize)
  }

  it('{{var}} **转义** HTML', async () => {
    expect(await render('<p>{{v}}</p>', { v: '<i>x</i>' })).toBe('<p>&lt;i&gt;x&lt;/i&gt;</p>')
  })

  it('{{{var}}} **不转义**（原样输出）', async () => {
    expect(await render('<p>{{{v}}}</p>', { v: '<i>x</i>' })).toBe('<p><i>x</i></p>')
  })

  it('{{#if}} 真/假分支', async () => {
    const tpl = '{{#if flag}}Y{{else}}N{{/if}}'
    expect(await render(tpl, { flag: true })).toBe('Y')
    expect(await render(tpl, { flag: false })).toBe('N')
  })

  it('{{#each}} 迭代（含 @index）', async () => {
    expect(await render('{{#each list}}[{{@index}}:{{this}}]{{/each}}', { list: ['a', 'b'] }))
      .toBe('[0:a][1:b]')
  })
})

// ---------------------------------------------------------------------------
// 3) sanitize 语义（真实 DOMPurify）
// ---------------------------------------------------------------------------

describe('T-48 sanitize：DOMPurify 真实清理面', () => {
  let seq = 0
  /** 每次用一个**新路径**：TEMPLATE_CACHE 按路径缓存，复用路径会拿到上一个用例的编译结果 */
  const render = async (tpl: string, data: unknown, sanitize: boolean): Promise<string | undefined> => {
    const id = `t${++seq}`
    files[`scripts/extensions/san/${id}.html`] = tpl
    const ctx = hostCtx()
    return (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown, s: unknown,
    ) => Promise<string | undefined>)('san', id, data, sanitize)
  }

  it('sanitize=true（默认）→ <script> 被清掉', async () => {
    const tpl = '<div>{{{body}}}</div>'
    const out = await render(tpl, { body: 'hello<script>window.__pwned=1</script>' }, true)
    expect(out).toContain('hello')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('__pwned')
  })

  it('sanitize=true → on* 事件属性被清掉（但元素与安全属性保留）', async () => {
    const out = await render('<img src="a.png" onerror="window.__pwned=1">{{{x}}}', { x: '' }, true)
    expect(out).toContain('<img')
    expect(out).toContain('src="a.png"')
    expect(out).not.toContain('onerror')
  })

  it('sanitize=false → <script> / on* **原样保留**（证明上两条不是"前端本来就没输出"）', async () => {
    const out = await render('<div>{{{body}}}</div>', { body: 'hello<script>bad()</script>' }, false)
    expect(out).toContain('<script>bad()</script>')
    const out2 = await render('<img src="a.png" onerror="boom()">', {}, false)
    expect(out2).toContain('onerror="boom()"')
  })
})

// ---------------------------------------------------------------------------
// 4) 失败路径：文件不存在（基准同形 —— 不 reject）
// ---------------------------------------------------------------------------

describe('T-48 失败路径：模板取不到时照抄基准 catch', () => {
  it('【承重】文件不存在 → console.error + toastr.error + **返回 undefined（不 reject）**', async () => {
    const toastr = { error: vi.fn() }
    ;(globalThis as { toastr?: unknown }).toastr = toastr
    const err = spyConsoleError()
    const ctx = hostCtx()
    const p = (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('nope', 'missing', { a: 1 })
    await expect(p).resolves.toBeUndefined()          // 不 reject（基准形状）
    expect(err.first()[0]).toBe('Error rendering template')
    // 基准的 console.error 第 2 参是**传进来的 templateId**（此处 = 拼接好的完整路径）
    expect(err.joined()).toContain('scripts/extensions/nope/missing.html')
    expect(toastr.error).toHaveBeenCalledWith(
      'Check the DevTools console for more information.', 'Error rendering template',
    )
  })

  it('同步版同样返回 undefined（不抛）', () => {
    const toastr = { error: vi.fn() }
    ;(globalThis as { toastr?: unknown }).toastr = toastr
    const err = spyConsoleError()
    const s = hostCtx().renderExtensionTemplate as (e: unknown, t: unknown) => unknown
    expect(s('nope', 'missing')).toBeUndefined()
    expect(err.first()[0]).toBe('Error rendering template')
    expect(toastr.error).toHaveBeenCalled()
  })

  it('模板语法错误（Handlebars 编译失败）→ 同一条失败路径', async () => {
    files['scripts/extensions/bad/t.html'] = '{{#if}}'
    const err = spyConsoleError()
    const ctx = hostCtx()
    await expect((ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<unknown>)('bad', 't', {})).resolves.toBeUndefined()
    expect(err.first()[0]).toBe('Error rendering template')
  })

  it('toastr 缺席时不抛（提示能力缺失不许改变返回形状）', async () => {
    const err = spyConsoleError()
    const ctx = hostCtx()
    await expect((ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<unknown>)('nope', 'x', {})).resolves.toBeUndefined()
    expect(err.first()[0]).toBe('Error rendering template')
  })
})

// ---------------------------------------------------------------------------
// 5) applyLocale 的诚实边界（不假装做了本地化）
// ---------------------------------------------------------------------------

describe('T-48 applyLocale：无 i18n 表 → 原样返回且**出声**', () => {
  it('i18n 表为空（我方未分发 ST locales/*.json）→ 渲染结果原样返回 + 一条具名降级告警', async () => {
    files['scripts/extensions/loc/t.html'] = '<span data-i18n="hello">Hello</span>'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = hostCtx()
    const out = await (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('loc', 't', {})
    expect(out).toContain('data-i18n="hello"')          // 未替换 = 未假装本地化
    expect(warn.mock.calls.flat().join(' ')).toContain('applyLocale')
    expect(warn.mock.calls.flat().join(' ')).toContain('未做本地化')
  })
})

// ---------------------------------------------------------------------------
// 6) 两侧门面行为一致（T-19：宿主侧 + iframe 侧同断言，跑**真构建产物**）
// ---------------------------------------------------------------------------

/** 在 vm 沙箱里跑 iframe shim 真产物；`parent` 指向宿主门面 → 帧面是父页投影 */
function makeShimSandboxWithHost(host: Record<string, unknown>): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.parent = host
  sandbox.name = 'sid'
  sandbox.addEventListener = () => {}
  sandbox.document = { body: { childElementCount: 0 } }
  sandbox.setTimeout = () => 0
  sandbox.console = console
  vm.runInContext(
    buildShimSource({ scriptId: 'sid', scriptName: 'sid', secret: 'sec', version: 'test' }),
    vm.createContext(sandbox),
  )
  return sandbox
}

describe('T-48 两侧一致：宿主门面 与 iframe 门面（真构建产物）', () => {
  /** 宿主页（含 SillyTavern 门面）作为 iframe 的 parent */
  function hostWithFacade(): Record<string, unknown> {
    const ctx = hostCtx()
    return { SillyTavern: { getContext: () => ctx } }
  }

  it('【承重】同一模板：两侧都渲染出同一份真 HTML', async () => {
    files['scripts/extensions/parity/t.html'] = '<p>{{v}}</p>'
    const host = hostWithFacade()
    const hostOut = await (host.SillyTavern as { getContext: () => Record<string, unknown> })
      .getContext().renderExtensionTemplateAsync as (e: unknown, t: unknown, d: unknown) => Promise<string | undefined>
    const a = await hostOut('parity', 't', { v: '共享' })

    const sandbox = makeShimSandboxWithHost(host)
    const st = sandbox.SillyTavern as {
      getContext: () => Record<string, unknown>
      renderExtensionTemplateAsync?: (e: unknown, t: unknown, d: unknown) => Promise<string | undefined>
    }
    const b = await (st.getContext().renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('parity', 't', { v: '共享' })
    // 顶层与 getContext 两面都转发同一实现（基准 iframe/predefine.js 的 {...getContext()} 形态）
    const c = await (st.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('parity', 't', { v: '共享' })

    expect(a).toBe('<p>共享</p>')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('两侧一致（失败路径）：模板不存在 → 都返回 undefined 且都走基准同形日志', async () => {
    const err = spyConsoleError()
    const host = hostWithFacade()
    const ctx = (host.SillyTavern as { getContext: () => Record<string, unknown> }).getContext()
    const a = await (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<unknown>)('gone', 'x', {})
    const sandbox = makeShimSandboxWithHost(host)
    const st = sandbox.SillyTavern as { getContext: () => Record<string, unknown> }
    const b = await (st.getContext().renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<unknown>)('gone', 'x', {})
    expect(a).toBeUndefined()
    expect(b).toBeUndefined()
    const lines = err.joined().split('\n').filter((l) => l.includes('Error rendering template'))
    // 两次调用各出一条（宿主自身 catch；帧面转发同一实现，不额外再造一条）
    expect(lines.length).toBe(2)
  })

  it('帧面诚实降级：父页门面不可达时 → 出声 + 返回 undefined（不抛、不静默）', async () => {
    const err = spyConsoleError()
    const sandbox = makeShimSandboxWithHost({})            // parent 上没有 SillyTavern
    const st = sandbox.SillyTavern as { getContext: () => Record<string, unknown> }
    const out = await (st.getContext().renderExtensionTemplateAsync as (
      e: unknown, t: unknown,
    ) => Promise<unknown>)('x', 'y')
    expect(out).toBeUndefined()
    expect(err.joined()).toContain('Error rendering template')
    expect(err.joined()).toContain('父页门面不可达')
  })
})

// ---------------------------------------------------------------------------
// 7) 文件路由：存储解析 + 路径穿越拒绝 + 真 404（诚实失败）
// ---------------------------------------------------------------------------

describe('T-48 文件路由：/scripts/extensions/** 与 /scripts/templates/**', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dsht-ext-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /** 最小响应替身（记录状态码与头） */
  function fakeRes(): {
    res: { writeHead: (c: number, h?: Record<string, string | number>) => void; end: (b?: string) => void }
    code: () => number
    headers: () => Record<string, string | number>
    body: () => string
  } {
    let code = 0
    let headers: Record<string, string | number> = {}
    let body = ''
    return {
      res: {
        writeHead: (c, h) => { code = c; headers = h ?? {} },
        end: (b) => { body = b ?? '' },
      },
      code: () => code,
      headers: () => headers,
      body: () => body,
    }
  }

  it('【承重】路径穿越被拒（../ 不能读存储根之外的文件）', () => {
    // 存储根之外放一个「机密」文件，穿越尝试必须读不到
    writeFileSync(join(home, 'secret.html'), 'TOP-SECRET')
    for (const p of [
      '/scripts/extensions/../../secret.html',
      '/scripts/extensions/%2e%2e/%2e%2e/secret.html',
      '/scripts/templates/../../secret.html',
      '/scripts/extensions/third-party/%2E%2E/%2E%2E/secret.html',
    ]) {
      const r = resolveScriptAsset(p, home)
      expect(r.status, `${p} 应被拒`).toBe(400)
      expect(JSON.stringify(r)).not.toContain('TOP-SECRET')
    }
  })

  it('拒绝形态（具名原因，不静默吞）', async () => {
    const cases: Array<[string, number]> = [
      ['/scripts/extensions', 404],                              // 前缀本身，不是文件
      ['/scripts/extensions/a/b.txt', 404],                      // 只有 .html
      ['/scripts/extensions/a/./b.html', 400],                   // `.` 段
      ['/scripts/extensions/a//b.html', 400],                    // 空段
      ['/scripts/extensions/%E0%A4%A/x.html', 400],              // 畸形百分号编码
      ['/scripts/extensions/a/b%5Cc.html', 400],                 // 反斜杠
      ['/scripts/other/x.html', 404],                            // 不属于本模块的前缀
    ]
    for (const [p, want] of cases) {
      expect(resolveScriptAsset(p, home).status, p).toBe(want)
    }
  })

  it('合法路径（含扩展名带 /）解析到 $DSH_HOME 下的存储位置', () => {
    const r = resolveScriptAsset('/scripts/extensions/third-party/x/panel.html', home)
    expect(r.status).toBe(200)
    expect(r.status === 200 && r.file).toBe(join(home, 'extensions', 'third-party', 'x', 'panel.html'))
    const t = resolveScriptAsset('/scripts/templates/welcome.html', home)
    expect(t.status === 200 && t.file).toBe(join(home, 'templates', 'welcome.html'))
  })

  it('文件存在 → 200 + text/html; charset=utf-8（读 $DSH_HOME 真文件）', async () => {
    mkdirSync(join(home, 'extensions', 'demo'), { recursive: true })
    writeFileSync(join(home, 'extensions', 'demo', 't.html'), '<p>{{v}}</p>')
    const f = fakeRes()
    await handleScriptAssetRequest(
      { method: 'GET', url: '/scripts/extensions/demo/t.html', trusted: true }, f.res, home,
    )
    expect(f.code()).toBe(200)
    expect(f.headers()['Content-Type']).toBe('text/html; charset=utf-8')
    expect(f.body()).toBe('<p>{{v}}</p>')
  })

  it('文件不存在 → **真 404**（诚实失败，绝不返回空壳 HTML）', async () => {
    const f = fakeRes()
    await handleScriptAssetRequest(
      { method: 'GET', url: '/scripts/extensions/demo/absent.html', trusted: true }, f.res, home,
    )
    expect(f.code()).toBe(404)
    expect(f.body()).not.toContain('<')
  })

  it('穿越请求经路由层也是 400（不是 200 空壳、不是 500）', async () => {
    writeFileSync(join(home, 'secret.html'), 'TOP-SECRET')
    const f = fakeRes()
    await handleScriptAssetRequest(
      { method: 'GET', url: '/scripts/extensions/../../secret.html', trusted: true }, f.res, home,
    )
    expect(f.code()).toBe(400)
    expect(f.body()).not.toContain('TOP-SECRET')
  })

  it('只读挂载：写方法 → 405（写侧未实现，见 ext-asset.ts 文件头）', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const f = fakeRes()
      await handleScriptAssetRequest(
        { method, url: '/scripts/extensions/demo/t.html', trusted: true }, f.res, home,
      )
      expect(f.code(), method).toBe(405)
    }
  })

  it('不可信请求 → 403（信任栅栏沿用 /dsht-rp 同一口径）', async () => {
    const f = fakeRes()
    await handleScriptAssetRequest(
      { method: 'GET', url: '/scripts/extensions/demo/t.html', trusted: false }, f.res, home,
    )
    expect(f.code()).toBe(403)
  })

  /**
   * 静态接线断言（先例：`tests/st-modules.spec.ts` 的同名一节）——防「内核存在但没人注册」
   * 这类空防线：`handleScriptAssetRequest` 再对，若 `index.ts` 没把它挂到 webserver 上，
   * 真实请求仍然是 404（卡点了毫无反应）。
   */
  it('接线：index.ts 真的把两条前缀注册到 webServer（不是只有内核）', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../src/dsh-plugin/index.ts'), 'utf8',
    )
    expect(src).toContain('SCRIPT_ASSET_PREFIXES')
    expect(src).toContain('handleScriptAssetRequest')
    expect(src).toContain('path: prefix')
    // 前缀单源在 ext-asset.ts；两条都在
    expect(SCRIPT_ASSET_PREFIXES).toEqual(['/scripts/extensions', '/scripts/templates'])
    // 卸载时撤路由（否则热重载后重复注册会抛 duplicate route）
    expect(src).toContain('for (const d of disposeScriptAssets) d()')
  })

  it('接线：前缀与 /scripts/utils.js 等 exact 路由不同 → 互不遮蔽', async () => {
    // 这两条路径**不落在本内核的两条前缀下** → 内核判 404，绝不截胡 st-modules 的 exact 路由
    // （webserver 匹配是「先 exact 表、再最长前缀」，两条前缀也不是任何 exact 的前缀）
    expect(resolveScriptAsset('/scripts/utils.js', home).status).toBe(404)
    expect(resolveScriptAsset('/script.js', home).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 8) 端到端：路由提供文件 → 门面渲染（证明两条链路真的接得上）
// ---------------------------------------------------------------------------

describe('T-48 端到端：文件路由 + 真渲染接通', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'dsht-e2e-')) })
  afterEach(() => { rmSync(home, { recursive: true, force: true }) })

  /**
   * 把 fetch mock 换成「**真走路由内核**」：路径 → `handleScriptAssetRequest` → 磁盘。
   * 相对路径按浏览器语义用 `new URL(url, origin)` 解析（门面传的是无前导斜杠的
   * `scripts/extensions/…`，正是基准的形态）。
   */
  function installRoutingFetch(): void {
    ;(globalThis as { fetch: unknown }).fetch = vi.fn(async (url: unknown) => {
      const pathname = new URL(String(url), 'http://localhost/').pathname
      let code = 0
      let headers: Record<string, string | number> = {}
      let body = ''
      await handleScriptAssetRequest(
        { method: 'GET', url: pathname, trusted: true },
        { writeHead: (c, h) => { code = c; headers = h ?? {} }, end: (b) => { body = b ?? '' } },
        home,
      )
      return { ok: code === 200, status: code, statusText: '', headers: new Headers(), text: async () => body }
    })
  }

  it('磁盘上的模板 → fetch 命中路由内核 → Handlebars 渲染出变量值', async () => {
    mkdirSync(join(home, 'extensions', 'e2e'), { recursive: true })
    writeFileSync(join(home, 'extensions', 'e2e', 'card.html'), '<b>{{name}}</b>')
    installRoutingFetch()
    const ctx = hostCtx()
    const out = await (ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<string | undefined>)('e2e', 'card', { name: '接通' })
    expect(out).toBe('<b>接通</b>')
  })

  it('磁盘上不存在 → 路由真 404 → 门面走基准同形失败路径（undefined，不 reject）', async () => {
    installRoutingFetch()
    const err = spyConsoleError()
    const ctx = hostCtx()
    await expect((ctx.renderExtensionTemplateAsync as (
      e: unknown, t: unknown, d: unknown,
    ) => Promise<unknown>)('e2e', 'absent', {})).resolves.toBeUndefined()
    expect(err.first()[0]).toBe('Error rendering template')
    // 路径规范成站点根绝对路径（DSH webui 是 SPA，相对路径在深链下会解析到 /session/…）
    expect(err.joined()).toContain('Error loading /scripts/extensions/e2e/absent.html: 404')
  })
})
