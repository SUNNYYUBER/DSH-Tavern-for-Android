/**
 * frame-theme-follow.spec.ts —— L2「深色 / 浅色主题」跟随性（P-7 能力对等 / P-8 幂等）
 *
 * ## 为什么单独立这条（L2 穷举 2026-09-14 的设备实测发现）
 * 设备实测（`tmp/probe-theme-toggle.mjs`，真机 x86_64 模拟器）：
 * 把宿主的 `body[data-ds-dark-theme]` 去掉（宿主转浅色，body 背景
 * `rgb(21,21,23)` → `rgb(255,255,255)`）之后：
 *   · **我方组件 token 色跟随了**（`rgb(249,250,251)` → `rgb(15,17,21)`）；
 *   · **iframe 帧内 `color-scheme` 仍是 `dark`** ⇒ **不跟随**。
 *
 * 两个独立成因：
 *   ① 宿主主题是**应用内设置**（`body[data-ds-dark-theme]` 属性），与 **OS 偏好**
 *      `prefers-color-scheme` **可分离**（深色 OS + 浅色主题是完全合法的组合）；
 *   ② 帧内 `color-scheme` 是**建帧时一次性求值**的字符串 ⇒ 后续切主题**既有帧不跟随**
 *      （只有新建的帧才拿到新值）。
 *
 * ## 判据（本 spec 钉住的三件事）
 * 1. **建帧即带对**：`buildIframeDocument` / `buildMessageFrameDocument` 产出的 HTML
 *    必须含 `color-scheme`，且**同时**含跟随机制（`__dshtApplyHostScheme` + message 监听）；
 * 2. **跟随机制语义正确**（vm 沙箱实跑）：装钩子 → 收到 `__dshtHostScheme` 消息 → 帧内
 *    `documentElement.style.colorScheme` 真的改变；且**非法值被忽略**（负控）；
 * 3. **宿主侧广播**：`broadcastHostScheme` 对每个 iframe 至少用**一种**通道送达
 *    （同源钩子 或 postMessage），且**不得因单帧异常中断整轮**（负控：坏帧不阻塞好帧）；
 * 4. **与宿主属性同源**（P-1）：判定读的是 `data-ds-dark-theme` 属性，而非只看 OS 偏好。
 */
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildIframeDocument, buildMessageFrameDocument, broadcastHostScheme } from '../src/dsht-rp-ui/src/client/th-shim.ts'

/**
 * 从构建产物 HTML 里抠出「跟随主题」那段内联脚本，放进 vm 沙箱实跑。
 * 抠取的锚点 = `__dshtApplyHostScheme`（跟随机制的唯一入口名）。
 */
function extractSchemeBootScript(html: string): string {
  const idx = html.indexOf('__dshtApplyHostScheme')
  expect(idx, '产出 HTML 里必须含跟随机制（__dshtApplyHostScheme）').toBeGreaterThan(-1)
  // 向前找该 <script> 起点，向后找最近的 </script>
  const open = html.lastIndexOf('<script>', idx)
  const close = html.indexOf('</script>', idx)
  expect(open, '跟随脚本必须是被完整 <script> 包裹的内联脚本').toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return html.slice(open + '<script>'.length, close)
}

/** 造一个最小 window/document 沙箱，只实现跟随脚本用到的那几项能力 */
function makeSandbox(): { win: Record<string, unknown>; listeners: Array<(e: { data?: unknown }) => void> } {
  const listeners: Array<(e: { data?: unknown }) => void> = []
  const docEl: { style: { colorScheme: string } } = { style: { colorScheme: '' } }
  const mql = { matches: true, addEventListener: (): void => {}, removeEventListener: (): void => {}, addListener: (): void => {} }
  const win: Record<string, unknown> = {
    document: { documentElement: docEl },
    addEventListener: (t: string, fn: (e: { data?: unknown }) => void) => { if (t === 'message') listeners.push(fn) },
    removeEventListener: (): void => {},
    matchMedia: () => mql,
    JSON,
  }
  win.window = win
  return { win, listeners }
}

const OPTS = { scriptId: 's1', scriptName: 'S1', secret: 'sec', version: 'test', content: 'console.log(1)' }

describe('L2 主题跟随：帧内 color-scheme 必须能跟随宿主切主题', () => {
  it('buildIframeDocument 产出：既有 color-scheme 声明，也带跟随机制', () => {
    const html = buildIframeDocument(OPTS)
    expect(html).toContain('color-scheme:')
    expect(html).toContain('__dshtApplyHostScheme')
    expect(html).toContain('__dshtHostScheme')
  })

  it('buildMessageFrameDocument 产出：同上（消息帧同族，不得漏）', () => {
    const html = buildMessageFrameDocument('console.log(1)', {
      ...OPTS, initialVars: {}, initialContext: null, vendorUrl: 'blob:v', shimUrl: 'blob:s',
    })
    expect(html).toContain('color-scheme:')
    expect(html).toContain('__dshtApplyHostScheme')
    expect(html).toContain('__dshtHostScheme')
  })

  it('★ 正控：装钩子后收到广播消息 ⇒ 帧内 colorScheme 真的改变（dark → light）', () => {
    const html = buildIframeDocument(OPTS)
    const { win, listeners } = makeSandbox()
    vm.runInNewContext(extractSchemeBootScript(html), win)
    // 建帧初始：跟着构建期的宿主（沙箱里 matchMedia.matches=true ⇒ dark）
    expect(win.document && (win.document as { documentElement: { style: { colorScheme: string } } }).documentElement.style.colorScheme).toBe('dark')
    // 宿主广播「浅色」⇒ 帧必须跟随
    expect(listeners.length, '必须注册了 message 监听').toBeGreaterThan(0)
    for (const l of listeners) l({ data: { __dshtHostScheme: 'light' } })
    expect((win.document as { documentElement: { style: { colorScheme: string } } }).documentElement.style.colorScheme).toBe('light')
  })

  it('★ 幂等（P-8）：同一值重复广播 ⇒ 结果收敛不变', () => {
    const html = buildIframeDocument(OPTS)
    const { win, listeners } = makeSandbox()
    vm.runInNewContext(extractSchemeBootScript(html), win)
    const read = (): string => (win.document as { documentElement: { style: { colorScheme: string } } }).documentElement.style.colorScheme
    for (let i = 0; i < 5; i += 1) for (const l of listeners) l({ data: { __dshtHostScheme: 'light' } })
    expect(read()).toBe('light')
  })

  it('负控：非法值 / 畸形消息 / 无关消息 一律**不得**改动 colorScheme', () => {
    const html = buildIframeDocument(OPTS)
    const { win, listeners } = makeSandbox()
    vm.runInNewContext(extractSchemeBootScript(html), win)
    const read = (): string => (win.document as { documentElement: { style: { colorScheme: string } } }).documentElement.style.colorScheme
    const before = read()
    const bad: unknown[] = [
      { data: { __dshtHostScheme: 'blue' } },       // 非 dark/light
      { data: { __dshtHostScheme: 1 } },            // 错误类型
      { data: { __dshtHostScheme: null } },         // 空
      { data: { other: 'light' } },                 // 无关键
      { data: null },                               // 空载荷
      { data: 'light' },                            // 裸字符串（非对象）
      { },                                          // 无 data
    ]
    for (const e of bad) for (const l of listeners) l(e as { data?: unknown })
    expect(read(), '非法输入不得让配色漂移').toBe(before)
  })

  it('负控：广播钩子对**坏帧**（contentWindow 抛错）必须跳过且不中断整轮', () => {
    const good: Array<{ v: string }> = []
    const iframes = [
      { get contentWindow(): never { throw new Error('cross-origin denied') } },       // 坏帧
      { contentWindow: { __dshtApplyHostScheme: (v: string) => good.push({ v }) } },    // 好帧（同源钩子）
    ]
    const root = { querySelectorAll: () => iframes } as unknown as Document
    const n = broadcastHostScheme(root)
    expect(good.length, '坏帧不得阻塞好帧').toBe(1)
    expect(good[0].v === 'dark' || good[0].v === 'light').toBe(true)
    // 【判据自身口径】坏帧连 `contentWindow` 都取不到 ⇒ 没有任何通道可用 ⇒ **不该**计入送达。
    // 计数语义 = 「真的送达过的帧数」；把取不到窗口的帧也算进去会让调用方的
    // 「广播到 N 帧」读数虚高（P-9：读数必须可信）。
    expect(n, '取不到 contentWindow 的帧不得计入送达').toBe(1)
  })

  it('负控：postMessage 兜底通道也必须真的用上（无同源钩子的帧）', () => {
    const sent: unknown[] = []
    const root = {
      querySelectorAll: () => [{ contentWindow: { postMessage: (m: unknown) => sent.push(m) } }],
    } as unknown as Document
    const n = broadcastHostScheme(root)
    expect(sent.length, '无钩子的帧必须走 postMessage').toBe(1)
    expect((sent[0] as { __dshtHostScheme?: string }).__dshtHostScheme === 'dark'
      || (sent[0] as { __dshtHostScheme?: string }).__dshtHostScheme === 'light').toBe(true)
    expect(n).toBe(1)
  })

  it('负控：无 contentWindow 的帧必须跳过（不得抛）', () => {
    const root = { querySelectorAll: () => [{ contentWindow: null }] } as unknown as Document
    expect(() => broadcastHostScheme(root)).not.toThrow()
  })

  it('结构护栏：判定必须读宿主**属性**（P-1 单源），而非只看 OS 偏好', () => {
    const html = buildIframeDocument(OPTS)
    // 帧内引导脚本自身不得把 OS 偏好当作**唯一**来源（应保留 locked 语义：
    // 宿主明确告知后，OS 层变化不得覆盖）
    expect(html).toContain('locked')
  })
})
