/**
 * 酒馆助手脚本运行时单测：shim 桥协议、脚本隔离、失败不扩散、host 合并逻辑。
 * shim 源码在 node:vm 里真跑（fake window/parent/document）——等价于沙箱 iframe 内的执行环境。
 */
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  activePresetNameFromSettings, flattenScriptLibrary, lodashPathToPointer, matchPresetByDisplayName,
  mergeSessionScripts, presetIdFromStateFile,
} from '../src/dsht-plugin-tavern-helper/for-session.ts'
import {
  buildIframeDocument, buildShimSource, deepMergeAssign, deepMergeInsert, getButtonEventId,
  handleBridgeCall, parseIncomingMessage, IFRAME_EVENTS, SHIM_BRIDGE_APIS, TAVERN_EVENTS,
  UNSUPPORTED_APIS, UNSUPPORTED_REASONS,
  type ScriptStatus, type ThBridgeDeps,
} from '../src/dsht-rp-ui/src/client/th-shim.ts'

// ---------------------------------------------------------------------------
// vm 沙箱 harness（fake window/parent/document，等价 sandbox iframe）
// ---------------------------------------------------------------------------

interface FakeFrame {
  ctx: vm.Context
  posted: Array<Record<string, unknown>> // iframe → host 消息
  handlers: Record<string, Array<(e: unknown) => void>>
  fireHost: (msg: Record<string, unknown>) => void // host → iframe
}

function makeFrame(scriptId: string, secret = 'sec'): FakeFrame {
  const posted: Array<Record<string, unknown>> = []
  const handlers: Record<string, Array<(e: unknown) => void>> = {}
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.parent = { postMessage: (msg: Record<string, unknown>) => { posted.push(msg) } }
  sandbox.name = scriptId
  sandbox.addEventListener = (type: string, fn: (e: unknown) => void) => {
    ;(handlers[type] ??= []).push(fn)
  }
  sandbox.document = { body: { childElementCount: 0 } }
  sandbox.setTimeout = (fn: () => void) => { /* 不调度：测试手动驱动 */ return 0 }
  sandbox.console = console
  const ctx = vm.createContext(sandbox)
  vm.runInContext(buildShimSource({ scriptId, scriptName: scriptId, secret, version: 'test' }), ctx)
  return {
    ctx,
    posted,
    handlers,
    fireHost: (msg) => {
      for (const fn of handlers.message ?? []) fn({ data: msg })
    },
  }
}

/** 在沙箱里执行脚本正文（等价 iframe 内 module 求值） */
function runScript(frame: FakeFrame, code: string): void {
  vm.runInContext(code, frame.ctx)
}

function callsOf(frame: FakeFrame): Array<{ callId: number; api: string; args: unknown[] }> {
  return frame.posted.filter(m => m.th === 'call') as never
}

// ---------------------------------------------------------------------------
// for-session 纯逻辑（host 侧）
// ---------------------------------------------------------------------------

describe('for-session：脚本库摊平与合并', () => {
  const lib = {
    scripts: [
      { type: 'script', id: 'a', name: 'A', enabled: true, content: 'console.log(1)', button: { enabled: true, buttons: [{ name: 'b1', visible: true }] }, data: { x: 1 } },
      { type: 'script', id: 'b', name: 'B', enabled: false, content: 'x' },
      { type: 'folder', id: 'f', name: 'F', enabled: true, scripts: [
        { type: 'script', id: 'c', name: 'C', enabled: true, content: 'y' },
      ] },
      { type: 'folder', id: 'g', name: 'G', enabled: false, scripts: [
        { type: 'script', id: 'd', name: 'D', enabled: true, content: 'z' },
      ] },
    ],
  }

  it('enabled 过滤 + folder 摊平 + disabled folder 整组跳过', () => {
    const out = flattenScriptLibrary(lib, 'character')
    expect(out.map(s => s.id)).toEqual(['a', 'c'])
    expect(out[0]?.buttons).toEqual([{ name: 'b1', visible: true }])
    expect(out[0]?.data).toEqual({ x: 1 })
    expect(out[0]?.source).toBe('character')
  })

  it('预设 + 卡合并；id 冲突卡覆盖预设', () => {
    const preset = { scripts: [{ type: 'script', id: 'a', name: 'AP', enabled: true, content: 'p' }] }
    const merged = mergeSessionScripts(preset, lib)
    expect(merged.find(s => s.id === 'a')?.content).toBe('console.log(1)')
    expect(merged.find(s => s.id === 'a')?.source).toBe('character')
    expect(merged.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('坏输入容错', () => {
    expect(flattenScriptLibrary(null, 'preset')).toEqual([])
    expect(flattenScriptLibrary({ scripts: 'x' }, 'preset')).toEqual([])
    expect(mergeSessionScripts(null, null)).toEqual([])
  })
})

describe('for-session：预设解析', () => {
  it('state 文件 presetId；历史扁平 MVU 裸树返回 null', () => {
    expect(presetIdFromStateFile({ presetId: 'p1', variables: {} })).toBe('p1')
    expect(presetIdFromStateFile({ 云梦璃: { 好感度: 5 } })).toBeNull() // 扁平裸树
    expect(presetIdFromStateFile({ variables: {} })).toBeNull()
    expect(presetIdFromStateFile(null)).toBeNull()
  })

  it('settings.json 激活预设名 + displayName 匹配', () => {
    expect(activePresetNameFromSettings({ oai_settings: { preset_settings_openai: '示例预设' } })).toBe('示例预设')
    expect(activePresetNameFromSettings({ oai_settings: {} })).toBeNull()
    expect(matchPresetByDisplayName([{ id: 'p2', displayName: '示例预设' }, { id: 'p1', displayName: '其他' }], '示例预设')).toBe('p2')
    expect(matchPresetByDisplayName([{ id: 'p1', displayName: '其他' }], '示例预设')).toBeNull()
    expect(matchPresetByDisplayName([], null)).toBeNull()
  })

  it('lodash 路径 → JSONPointer', () => {
    expect(lodashPathToPointer('a.b[0].c')).toBe('/a/b/0/c')
    expect(lodashPathToPointer('a["b/c"]')).toBe('/a/b~1c')
    expect(lodashPathToPointer('/已是/pointer')).toBe('/已是/pointer')
  })
})

// ---------------------------------------------------------------------------
// shim：桥协议
// ---------------------------------------------------------------------------

describe('shim：iframe 文档与协议解析', () => {
  it('buildIframeDocument 去围栏 + </script> 转义 + shim 先于脚本', () => {
    const doc = buildIframeDocument({
      scriptId: 's1', scriptName: 'S1', secret: 'sec', version: 'test',
      content: '```js\nconsole.log("</script>")\n```',
    })
    expect(doc).toContain('window.TavernHelper')
    expect(doc).not.toContain('```')
    expect(doc).not.toContain('"</script>"') // 脚本内的 </script> 已转义
    expect(doc.indexOf('window.TavernHelper = new Proxy')).toBeLessThan(doc.indexOf('<\\/script>'))
    expect(doc).toContain('__dshtThReady')
  })

  it('parseIncomingMessage 校验 tag/scriptId/形状', () => {
    expect(parseIncomingMessage(null)).toBeNull()
    expect(parseIncomingMessage({ th: 'call' })).toBeNull()
    expect(parseIncomingMessage({ __dsht_th: true, scriptId: 's', secret: 'x', th: 'call', callId: 1, api: 'vars:get', args: [] })).not.toBeNull()
    expect(parseIncomingMessage({ __dsht_th: true, scriptId: 's', secret: 'x', th: 'call', callId: 'bad', api: 'a', args: [] })).toBeNull()
    expect(parseIncomingMessage({ __dsht_th: true, scriptId: 's', secret: 'x', th: 'status', phase: 'running' })).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// shim：vendor 注入（jQuery + zod，th-vendor.gen.txt 构建期内嵌）
// ---------------------------------------------------------------------------

/** vendor 可执行的最小 DOM stub（够 jQuery 顶层 support 检测不炸；不做真实 DOM 语义） */
function makeVendorEl(tag: string): Record<string, unknown> {
  const t = String(tag || 'div')
  return {
    nodeName: t.toUpperCase(), tagName: t.toUpperCase(), nodeType: 1,
    style: {}, attributes: [], childNodes: [], children: [], innerHTML: '', textContent: '',
    setAttribute: () => {}, getAttribute: () => null, removeAttribute: () => {},
    appendChild: (c: unknown) => c, removeChild: (c: unknown) => c, insertBefore: (c: unknown) => c,
    addEventListener: () => {}, removeEventListener: () => {},
    matches: () => false, msMatchesSelector: () => false, // jQuery selector 引擎顶层读 documentElement.matches
    cloneNode: () => makeVendorEl(t), getElementsByTagName: () => [],
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => [], offsetWidth: 0, offsetHeight: 0, options: [], selectedIndex: 0,
    // firstChild/lastChild 给空对象而非 null：checkClone 检测走 cloneNode(true).lastChild.checked
    firstChild: {}, lastChild: {}, contains: () => false,
  }
}

function makeVendorSandbox(): Record<string, unknown> {
  const el = () => makeVendorEl('div')
  const makeDoc = (): Record<string, unknown> => ({
    nodeType: 9, // jQuery 3 setDocument 要求 doc.nodeType === 9，否则早退、内部 document 恒 undefined
    documentElement: makeVendorEl('html'), head: el(), body: el(), hidden: false,
    createElement: (t: string) => makeVendorEl(t),
    createDocumentFragment: () => makeVendorEl('fragment'),
    createTextNode: () => ({ nodeType: 3, textContent: '' }),
    addEventListener: () => {}, removeEventListener: () => {},
    getElementById: () => null, getElementsByTagName: () => [],
    querySelector: () => null, querySelectorAll: () => [],
  })
  const doc = makeDoc() as Record<string, any>
  doc.implementation = { createHTMLDocument: () => makeDoc() } // parseHTML 路径
  for (const child of [doc.documentElement, doc.head, doc.body]) { child.ownerDocument = doc; child.parentNode = doc }
  const sandbox: Record<string, unknown> = { console, document: doc, location: { href: 'about:blank' } }
  sandbox.window = sandbox
  sandbox.setTimeout = () => 0
  sandbox.clearTimeout = () => {}
  sandbox.setInterval = () => 0
  sandbox.clearInterval = () => {}
  sandbox.requestAnimationFrame = () => 0
  // jQuery UI（draggable 链：ie.js/mouse.js/widget.js）顶层依赖
  sandbox.navigator = { userAgent: 'node' }
  sandbox.getComputedStyle = () => ({ position: 'static', top: '', left: '', float: 'none', display: 'block' })
  return sandbox
}

describe('shim：vendor 注入（jQuery + zod）', () => {
  it('srcdoc 含 vendor 标记 + $ / Zod / z 赋值；vendor 在 shim 之前；CDN jQuery 已移除（防双实例）', () => {
    const doc = buildIframeDocument({ scriptId: 's1', scriptName: 'S1', secret: 'sec', version: 'test', content: 'void 0' })
    expect(doc).toContain('dsht-th-vendor/2') // minify 不删的标记字符串字面量（/2 = zod v4 namespace + 同源沙箱配套）
    expect(doc).toContain('data-dsht-th-vendor')
    expect(doc).toContain('window.Zod') // zod 双名字（z / Zod）赋值仍在产物里
    // vendor <script> 必须先于 shim（脚本 module 前就绪）
    expect(doc.indexOf('data-dsht-th-vendor')).toBeLessThan(doc.indexOf('window.TavernHelper'))
    // CDN jQuery 副本会覆盖 vendor 的 window.$ → 双实例（插件挂错实例），已移除
    expect(doc).not.toContain('jquery/dist/jquery.min.js')
  })

  it('vendor 不是坏包：node:vm 跑 srcdoc 提取的 vendor 源码，$ 就绪且 z.object(...).safeParse 可用', () => {
    const doc = buildIframeDocument({ scriptId: 's1', scriptName: 'S1', secret: 'sec', version: 'test', content: 'void 0' })
    const vendor = doc.match(/<script data-dsht-th-vendor>([\s\S]*?)<\/script>/)?.[1]
    expect(vendor).toBeTruthy()
    const sandbox = makeVendorSandbox()
    vm.createContext(sandbox)
    // 转义后的 <\/script 直接执行：JS 里 \/ 与 / 同义，与 iframe 内浏览器语义等价
    expect(() => vm.runInContext(vendor!, sandbox)).not.toThrow()
    expect(vm.runInContext('typeof window.$', sandbox)).toBe('function') // 飞讯 0703 卡的 window.$ 就绪
    expect(vm.runInContext('window.z === window.Zod', sandbox)).toBe(true)
    // 变量结构 0628 卡的用法子集（z.object/string/number/coerce/enum/array/record/any/preprocess）
    const r = vm.runInContext(
      `z.object({
         s: z.string(), n: z.coerce.number(), e: z.enum(['a', 'b']),
         arr: z.array(z.any()), rec: z.record(z.boolean()),
         pre: z.preprocess(function (v) { return String(v); }, z.string()),
       }).safeParse({ s: 'x', n: '5', e: 'a', arr: [1], rec: { k: true }, pre: 9 })`,
      sandbox,
    ) as { success: boolean; data?: Record<string, unknown> }
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ s: 'x', n: 5, e: 'a', arr: [1], rec: { k: true }, pre: '9' })
  })
})

describe('shim：沙箱内执行', () => {
  it('getVariables 桥调用 → host 回包解析', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__testResult = null;
      getVariables({ type: 'chat' }).then(function (v) { window.__testResult = v; });
    `)
    const calls = callsOf(f)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.api).toBe('vars:get')
    expect(calls[0]?.args).toEqual([{ type: 'chat' }])
    // host 回包
    f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'result', callId: calls[0]!.callId, ok: true, value: { 好感度: 5 } })
    await new Promise(r => setImmediate(r))
    expect(vm.runInContext('window.__testResult', f.ctx)).toEqual({ 好感度: 5 })
  })

  it('script 作用域缺省 script_id = 自身', () => {
    const f = makeFrame('s42')
    runScript(f, `getVariables({ type: 'script' });`)
    expect(callsOf(f)[0]?.args).toEqual([{ type: 'script', script_id: 's42' }])
  })

  it('事件总线：eventOn + host 投递；once 只触发一次；监听器异常不扩散', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__hits = [];
      eventOn(tavern_events.GENERATION_ENDED, function (n) { window.__hits.push('a' + n); throw new Error('boom'); });
      eventOnce(tavern_events.GENERATION_ENDED, function (n) { window.__hits.push('b' + n); });
    `)
    const evt = TAVERN_EVENTS.GENERATION_ENDED
    f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'event', eventType: evt, args: [3] })
    f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'event', eventType: evt, args: [4] })
    expect(vm.runInContext('window.__hits', f.ctx)).toEqual(['a3', 'b3', 'a4']) // b once；a 抛错不影响 b
  })

  it('伪造消息（secret 不符）被丢弃', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; getVariables().then(function (v) { window.__r = v; });`)
    f.fireHost({ __dsht_th: true, secret: 'WRONG', scriptId: 's1', th: 'result', callId: 1, ok: true, value: { hacked: 1 } })
    await new Promise(r => setImmediate(r))
    expect(vm.runInContext('window.__r', f.ctx)).toBeNull()
  })

  it('不支持 API：记名 + reject + unhandledrejection 不误报 failed（C9 起 generate 已支持——换 playAudio 验证）', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__err = null;
      playAudio({ url: 'x' }).catch(function (e) { window.__err = e.message; });
      TavernHelper.deleteChatMessages([]).catch(function () {});
    `)
    await new Promise(r => setImmediate(r))
    expect(String(vm.runInContext('window.__err', f.ctx))).toContain('playAudio')
    const missing = f.posted.filter(m => m.th === 'missing').map(m => m.api)
    expect(missing).toContain('playAudio')
    // P3a 起 setChatMessages 走会话写桥（已支持）——删路径仍记名拒绝
    expect(missing).not.toContain('setChatMessages')
    expect(missing).toContain('deleteChatMessages')
    // shim 自己的 reject 带 __thExpected：unhandledrejection 不报 failed
    const err = vm.runInContext('window.__err && Object.getPrototypeOf ? null : null', f.ctx) // 占位不取
    void err
    const rejectedErr = await vm.runInContext(
      `playAudio({}).catch(function (e) { return e; })`, f.ctx,
    ) as Error
    for (const fn of f.handlers.unhandledrejection ?? []) fn({ reason: rejectedErr })
    expect(f.posted.filter(m => m.th === 'status' && m.phase === 'failed')).toHaveLength(0)
  })

  it('TavernHelper Proxy：未知属性记名', () => {
    const f = makeFrame('s1')
    runScript(f, `TavernHelper.someFutureApi(1).catch(function () {});`)
    const missing = f.posted.filter(m => m.th === 'missing').map(m => m.api)
    expect(missing).toContain('TavernHelper.someFutureApi')
  })

  it('脚本顶层抛错 → script-error 上报（不翻转 phase——2026-09-07 根修：启动期 rejection 钉死 failed → 按钮永久无反应）；ready 信标仍可用', () => {
    const f = makeFrame('s1')
    expect(() => runScript(f, `throw new Error('顶层爆炸')`)).toThrow('顶层爆炸')
    for (const fn of f.handlers.error ?? []) fn({ message: '顶层爆炸' })
    // 【2026-09-08 对齐】错误只发 script-error 诊断信标，不再发 status failed
    // （真 TH 语义：脚本抛错不摘除事件面，交互保持可用）
    const errs = f.posted.filter(m => (m as { th?: string }).th === 'script-error')
    expect(errs.length).toBeGreaterThanOrEqual(1)
    expect(f.posted.filter(m => m.th === 'status' && m.phase === 'failed')).toHaveLength(0)
    // ready 信标（trailing module）不受脚本错误影响
    vm.runInContext('window.__dshtThReady()', f.ctx)
    expect(f.posted.some(m => m.th === 'status' && m.phase === 'running')).toBe(true)
  })

  it('两脚本隔离：独立沙箱，事件/失败互不串', async () => {
    const a = makeFrame('sa')
    const b = makeFrame('sb')
    runScript(a, `eventOn('message_received', function () { window.__a = (window.__a || 0) + 1; });`)
    // B 顶层抛错（真实浏览器里该错误只终结 B 的 module，不影响 A 的 iframe）
    expect(() => runScript(b, `
      eventOn('message_received', function () { window.__b = (window.__b || 0) + 1; });
      throw new Error('B 炸了');
    `)).toThrow('B 炸了')
    // host 向两个 iframe 各自投递（真实运行时按 frame 分发）
    a.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 'sa', th: 'event', eventType: 'message_received', args: [1] })
    b.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 'sb', th: 'event', eventType: 'message_received', args: [1] })
    expect(vm.runInContext('window.__a', a.ctx)).toBe(1)
    expect(vm.runInContext('window.__b', b.ctx)).toBe(1) // B 顶层前注册的监听器仍工作
    expect(vm.runInContext('window.__a', b.ctx)).toBeUndefined() // 无全局串扰
    // A 无任何 failed 上报
    expect(a.posted.filter(m => m.th === 'status' && m.phase === 'failed')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// shim：上下文快照 / getContext / SillyTavern 门面（本次迁移的真实现）
// ---------------------------------------------------------------------------

const SNAPSHOT = {
  presetId: 'p1',
  presetName: '示例预设',
  character: { name: '云梦璃' },
  chatCompletionSettings: {
    prompts: [{ identifier: 'main', name: 'Main', marker: false }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  },
  slug: 'ws-1',
  messages: [{ message_id: 0, name: '云梦璃', role: 'assistant', message: '嗨', is_system: false }],
}

function pushContext(f: FakeFrame, context: unknown): void {
  f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'context', context })
}

describe('shim：上下文快照 + getContext + SillyTavern 门面', () => {
  it('快照未推送：getContext 同步返回 __dshtContextPending 空壳（prompts 空）', () => {
    const f = makeFrame('s1')
    const ctx = vm.runInContext('getContext()', f.ctx) as Record<string, unknown>
    expect(ctx['__dshtContextPending']).toBe(true)
    expect((ctx.chatCompletionSettings as { prompts: unknown[] }).prompts).toEqual([])
    expect(ctx.presetName).toBeNull()
    expect(vm.runInContext('getLoadedPresetName()', f.ctx)).toBeNull()
  })

  it('host 推送 {th:context} → getContext 同步返回快照 + 派发 context_refreshed 本地事件', () => {
    const f = makeFrame('s1')
    runScript(f, `window.__refreshed = []; eventOn('context_refreshed', function (c) { window.__refreshed.push(c.presetName); });`)
    pushContext(f, SNAPSHOT)
    expect(vm.runInContext('getContext()', f.ctx)).toEqual(SNAPSHOT)
    expect(vm.runInContext('getLoadedPresetName()', f.ctx)).toBe('示例预设')
    expect(vm.runInContext('window.__refreshed', f.ctx)).toEqual(['示例预设'])
  })

  it('伪造快照推送（secret 不符）被丢弃', () => {
    const f = makeFrame('s1')
    f.fireHost({ __dsht_th: true, secret: 'WRONG', scriptId: 's1', th: 'context', context: SNAPSHOT })
    const ctx = vm.runInContext('getContext()', f.ctx) as Record<string, unknown>
    expect(ctx['__dshtContextPending']).toBe(true)
  })

  it('SillyTavern.getContext 门面：不再抛错、字段直引快照', () => {
    const f = makeFrame('s1')
    // 未推送快照也不抛错（旧行为是 throw）
    expect(() => vm.runInContext('SillyTavern.getContext()', f.ctx)).not.toThrow()
    pushContext(f, SNAPSHOT)
    const ctx = vm.runInContext('SillyTavern.getContext()', f.ctx) as Record<string, unknown>
    expect(ctx.chatCompletionSettings).toBe(SNAPSHOT.chatCompletionSettings) // 直引快照
    const pm = ctx.promptManager as Record<string, unknown>
    expect(pm.activePreset).toBe('示例预设')
    expect((pm.getPromptOrderForCharacter as () => unknown)()).toEqual([{ identifier: 'main', enabled: true }])
    expect((pm.getPromptOrderItems as () => unknown)()).toEqual([{ identifier: 'main', name: 'Main', marker: false }])
    expect(ctx.characterName).toBe('云梦璃')
    expect(ctx.nameOverride).toBe('云梦璃')
    expect(ctx.presetName).toBe('示例预设')
    expect(ctx.chat).toEqual(SNAPSHOT.messages)
    expect(ctx.chatLength).toBe(1)
  })

  it('SillyTavern.getContext 门面：缺数据字段 undefined 保持形状', () => {
    const f = makeFrame('s1')
    pushContext(f, {})
    const ctx = vm.runInContext('SillyTavern.getContext()', f.ctx) as Record<string, unknown>
    expect(ctx.characterName).toBeUndefined()
    expect(ctx.presetName).toBeUndefined()
    expect(ctx.chatLength).toBe(0)
    expect(ctx.chat).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// shim：preset / 聊天消息只读 / 正则 / 世界书（桥）
// ---------------------------------------------------------------------------

function resolveCall(f: FakeFrame, index: number, value: unknown): void {
  const c = callsOf(f)[index]!
  f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'result', callId: c.callId, ok: true, value })
}

async function settled(f: FakeFrame): Promise<void> {
  await new Promise(r => setImmediate(r))
}

describe('shim：preset 系 API（桥）', () => {
  it('getPresetNames → preset:names，解包 {names}', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; getPresetNames().then(function (n) { window.__r = n; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'preset:names', args: [] })
    resolveCall(f, 0, { names: ['示例预设', '默认'], loaded: '示例预设' })
    await settled(f)
    expect(vm.runInContext('window.__r', f.ctx)).toEqual(['示例预设', '默认'])
  })

  it('getPreset → preset:get；found=false 解包为 null；presetExists 解包 found', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__a = 'unset'; window.__b = 'unset'; window.__c = 'unset';
      getPreset('示例预设').then(function (p) { window.__a = p; });
      getPreset('不存在').then(function (p) { window.__b = p; });
      presetExists('示例预设').then(function (y) { window.__c = y; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'preset:get', args: ['示例预设'] })
    resolveCall(f, 0, { found: true, preset: { name: '示例预设', prompts: [], prompt_order: [] } })
    resolveCall(f, 1, { found: false, preset: null })
    resolveCall(f, 2, { found: true, preset: null })
    await settled(f)
    expect(vm.runInContext('window.__a', f.ctx)).toEqual({ name: '示例预设', prompts: [], prompt_order: [] })
    expect(vm.runInContext('window.__b', f.ctx)).toBeNull()
    expect(vm.runInContext('window.__c', f.ctx)).toBe(true)
  })

  it('createOrReplacePreset → preset:put(create:true)；replacePreset 不带 create', () => {
    const f = makeFrame('s1')
    runScript(f, `createOrReplacePreset('P1', { prompts: [{ identifier: 'main' }], prompt_order: [{ character_id: 1, order: [] }] });`)
    runScript(f, `replacePreset('P1', { prompts: [] });`)
    expect(callsOf(f)[0]).toMatchObject({
      api: 'preset:put',
      args: ['P1', [{ identifier: 'main' }], [{ character_id: 1, order: [] }], true],
    })
    expect(callsOf(f)[1]).toMatchObject({ api: 'preset:put', args: ['P1', [], []] })
  })

  it('deletePreset / renamePreset / loadPreset（sessionId 缺省 null，host 回填运行时会话）', () => {
    const f = makeFrame('s1')
    runScript(f, `deletePreset('P1'); renamePreset('P1', 'P2'); loadPreset('P2'); loadPreset('P2', 'sess-9');`)
    const calls = callsOf(f)
    expect(calls[0]).toMatchObject({ api: 'preset:delete', args: ['P1'] })
    expect(calls[1]).toMatchObject({ api: 'preset:rename', args: ['P1', 'P2'] })
    expect(calls[2]).toMatchObject({ api: 'preset:load', args: [null, 'P2'] })
    expect(calls[3]).toMatchObject({ api: 'preset:load', args: ['sess-9', 'P2'] })
  })

  it('updatePresetWith：get → updater → put', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__next = null;
      updatePresetWith('P1', function (p) {
        return { prompts: ((p && p.prompts) || []).concat([{ identifier: 'new' }]) };
      }).then(function (next) { window.__next = next; });
    `)
    expect(callsOf(f)[0]).toMatchObject({ api: 'preset:get', args: ['P1'] })
    resolveCall(f, 0, { found: true, preset: { name: 'P1', prompts: [{ identifier: 'main' }], prompt_order: [] } })
    await settled(f)
    const put = callsOf(f)[1]!
    expect(put.api).toBe('preset:put')
    expect(put.args[0]).toBe('P1')
    expect(put.args[1]).toEqual([{ identifier: 'main' }, { identifier: 'new' }])
    resolveCall(f, 1, null) // put 回包后整链才 resolve
    await settled(f)
    expect(vm.runInContext('window.__next', f.ctx)).toEqual({ prompts: [{ identifier: 'main' }, { identifier: 'new' }] })
  })

  it('isPresetNormal/Placeholder/SystemPrompt：本地纯逻辑，不过桥', () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__preset = { prompts: [
        { identifier: 'main', marker: false },
        { identifier: 'world', marker: true },
        { identifier: 'charCh', system_prompt: true },
        { identifier: 'nsfw' },
      ] };
      window.__r = [
        isPresetNormalPrompt(window.__preset, 'main'),
        isPresetNormalPrompt(window.__preset, 'world'),
        isPresetPlaceholderPrompt(window.__preset, 'world'),
        isPresetPlaceholderPrompt(window.__preset, 'main'),
        isPresetSystemPrompt(window.__preset, 'main'),
        isPresetSystemPrompt(window.__preset, 'nsfw'),
        isPresetSystemPrompt(window.__preset, 'charCh'),
        isPresetSystemPrompt(window.__preset, 'world'),
        isPresetNormalPrompt(window.__preset, 'missing')
      ];
    `)
    expect(vm.runInContext('window.__r', f.ctx)).toEqual([true, false, true, false, true, true, true, false, false])
    expect(callsOf(f)).toHaveLength(0)
  })
})

describe('shim：聊天消息只读（桥）', () => {
  // 【实机审计修复 2026-09-05】getChatMessages 语义对齐真 TH：首参 = 楼层范围，返回数组
  const CHAT = {
    messages: [
      { message_id: 0, name: '你', role: 'user', message: '嗨', is_system: false, memo: '附加键' },
      { message_id: 1, name: '璃', role: 'assistant', message: '哦？', is_system: false },
      { message_id: 2, name: '璃', role: 'assistant', message: '最近如何', is_system: false },
    ],
  }
  // 【2026-09-08 测试对齐】getChatMessages/getChatMessage 已改同步语义（真 TH 同步读
  // window.chat；示例游戏 masterLoop 不 await 直接 [0].message_id）——数据源 = host 推送的
  // 上下文快照（th:context），不再走异步桥。
  it('楼层范围：单楼 / 闭区间 / 负数深度（-1 = 最新楼）/ 解析失败空数组（同步读上下文快照）', () => {
    const f = makeFrame('s1')
    pushContext(f, CHAT)
    const out = vm.runInContext(`({
      single: getChatMessages('1'),
      last: getChatMessages(-1),
      span: getChatMessages('0-2'),
      bad: getChatMessages('x'),
    })`, f.ctx) as Record<string, Array<Record<string, unknown>>>
    expect(out.single?.map(m => m.message_id)).toEqual([1])
    expect(out.last?.map(m => m.message_id)).toEqual([2]) // -1 深度 = 最新楼（ST string_to_range）
    expect(out.span?.map(m => m.message_id)).toEqual([0, 1, 2])
    expect(out.bad).toEqual([])
    expect(callsOf(f)).toHaveLength(0) // 同步面不过桥
  })
  it('返回形状：ChatMessage {message_id,name,role,is_hidden,message,data}（规范字段外的键归入 data）', () => {
    const f = makeFrame('s1')
    pushContext(f, CHAT)
    const m0 = (vm.runInContext(`getChatMessages('0')[0]`, f.ctx)) as Record<string, unknown>
    expect(m0).toMatchObject({ message_id: 0, name: '你', role: 'user', is_hidden: false, message: '嗨' })
    expect(m0['data']).toEqual({ memo: '附加键' }) // 规范字段外的附加键
  })
  it('getChatMessage：命中单条 / 越界 null', () => {
    const f = makeFrame('s1')
    pushContext(f, CHAT)
    expect(vm.runInContext(`getChatMessage(1)`, f.ctx)).toMatchObject({ message_id: 1, message: '哦？' })
    expect(vm.runInContext(`getChatMessage(9)`, f.ctx)).toBeNull()
  })
  it('getChatHistoryBrief = [{message_id, role, content 截断 200}]；getChatHistoryDetail = 全量', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__b = null; window.__d = null;
      getChatHistoryBrief().then(function (x) { window.__b = x; });
      getChatHistoryDetail().then(function (x) { window.__d = x; });`)
    const long = '啊'.repeat(250)
    await settled(f)
    resolveCall(f, 0, { messages: [{ message_id: 0, name: '璃', role: 'assistant', message: long, is_system: false }] })
    resolveCall(f, 1, { messages: [{ message_id: 0, name: '璃', role: 'assistant', message: long, is_system: false }] })
    await settled(f)
    const brief = vm.runInContext('window.__b', f.ctx) as Array<{ message_id: number; role: string; content: string }>
    expect(brief).toHaveLength(1)
    expect(brief[0]!.content).toBe('啊'.repeat(200) + '…')
    const detail = vm.runInContext('window.__d', f.ctx) as Array<{ message: string }>
    expect(detail[0]!.message).toBe(long) // Detail 全量不截断
  })
})

describe('shim：正则（桥）', () => {
  // 【T-20 2026-09-10 契约修订】出口形状 = 真 TH TavernRegex（snake_case + enabled），
  // 准据 tavern_regex.d.ts；旧断言 camelCase 是修复前的错误契约（见 docs/TH-REGEX-SOURCE-DIFF）
  it('getTavernRegexes → regexes:get（scope 过滤 + 出口映射为真 TH snake_case 形状）', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; getTavernRegexes({ type: 'global' }).then(function (r) { window.__r = r; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'regexes:get', args: [null, null] })
    resolveCall(f, 0, { regexes: [{ scriptName: 'x', findRegex: 'a', disabled: false, placement: [1], _dshtScope: 'global' }], presetId: 'p1', slug: 'ws-1' })
    await settled(f)
    expect(vm.runInContext('window.__r', f.ctx)).toEqual([{
      id: undefined,
      script_name: 'x',
      enabled: true,
      find_regex: 'a',
      replace_string: undefined,
      trim_strings: [],
      source: { user_input: true, ai_output: false, slash_command: false, world_info: false },
      destination: { display: true, prompt: true },
      run_on_edit: false,
      min_depth: null,
      max_depth: null,
      scope: 'global',
    }])
  })

  it('replaceTavernRegexes：{type:global|character|preset} 三形态（真 TH TavernRegexOption）；character slug 取自快照', () => {
    const f = makeFrame('s1')
    pushContext(f, { slug: 'ws-1' })
    runScript(f, `replaceTavernRegexes([{ script_name: 'x' }], { type: 'global' });`)
    runScript(f, `replaceTavernRegexes([{ script_name: 'y' }], { type: 'character' });`)
    runScript(f, `replaceTavernRegexes([{ script_name: 'z' }], { type: 'preset' });`)
    const calls = callsOf(f)
    expect(calls[0]).toMatchObject({ api: 'regexes:replace' })
    expect((calls[0]!.args as unknown[])[1]).toBe('global')
    expect((calls[0]!.args as unknown[])[2]).toBe(null)
    expect((calls[1]!.args as unknown[])[1]).toBe('character')
    expect((calls[1]!.args as unknown[])[2]).toBe('ws-1')
    expect((calls[2]!.args as unknown[])[1]).toBe('preset')
    // 契约形状入口 → 内部形状（script_name → scriptName）
    const bucket = (calls[0]!.args as unknown[])[0] as Array<Record<string, unknown>>
    expect(bucket[0]).toMatchObject({ scriptName: 'x', disabled: false })
  })
})

// 【实机审计修复 2026-09-05】P1/P2 长尾 API（C6 事件全表 / setPreset 深合并 / 正则套件 /
// 世界书写面 / substitudeMacros）
describe('shim：P1/P2 长尾 API', () => {
  it('C6：TAVERN_EVENTS 全表 82 项对齐 ST 导出；IFRAME_EVENTS 补 generate/流式 token 四项', () => {
    expect(Object.keys(TAVERN_EVENTS)).toHaveLength(82)
    expect(TAVERN_EVENTS['CHAT_CHANGED']).toBe('chat_id_changed')
    expect(TAVERN_EVENTS['CHARACTER_DELETED']).toBe('characterDeleted')
    expect(TAVERN_EVENTS['CHARACTER_MANAGEMENT_DROPDOWN']).toBe('charManagementDropdown')
    expect(TAVERN_EVENTS['MEDIA_ATTACHMENT_DELETED']).toBe('media_attachment_deleted')
    expect(IFRAME_EVENTS['GENERATION_STARTED']).toBe('js_generation_started')
    expect(IFRAME_EVENTS['GENERATION_ENDED']).toBe('js_generation_ended')
    expect(IFRAME_EVENTS['STREAM_TOKEN_RECEIVED_FULLY']).toBe('js_stream_token_received_fully')
    expect(IFRAME_EVENTS['STREAM_TOKEN_RECEIVED_INCREMENTALLY']).toBe('js_stream_token_received_incrementally')
  })

  it('setPreset 深合并：get 现有 → PartialDeep merge → put（create 缺省 false）', async () => {
    const f = makeFrame('s1')
    runScript(f, `setPreset('P1', { prompts: [{ identifier: 'main', content: '新' }] });`)
    resolveCall(f, 0, {
      found: true,
      preset: {
        name: 'P1',
        prompts: [{ identifier: 'main', content: '旧', role: 'system' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      },
    })
    await settled(f)
    const put = callsOf(f)[1]!
    expect(put.api).toBe('preset:put')
    expect(put.args[0]).toBe('P1')
    // prompts 数组整值覆盖、既有 prompt_order 键保留（对象递归合并）
    expect(put.args[1]).toEqual([{ identifier: 'main', content: '新' }])
    expect(put.args[2]).toEqual([{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }])
    expect(put.args[3]).toBe(false)
  })

  // 【T-20 N3 2026-09-10 契约修订】真 TH 语义：updater 只作用于 option 指定的作用域，
  // 且只写回该作用域（原实现三组齐写 = 静默扩大写入范围）
  it('updateTavernRegexesWith(updater, option)：只取/只写 option 作用域（标记剥除）', async () => {
    const f = makeFrame('s1')
    pushContext(f, { slug: 'ws-1' })
    runScript(f, `
      window.__r = null;
      updateTavernRegexesWith(function (rx) {
        return rx.map(function (s) {
          return s.script_name === 'a' ? Object.assign({}, s, { find_regex: 'z' }) : s;
        }).concat([{ script_name: 'new', find_regex: 'n', enabled: true, source: { user_input: true }, destination: { display: true, prompt: true } }]);
      }, { type: 'global' }).then(function (r) { window.__r = r; });
    `)
    resolveCall(f, 0, {
      regexes: [
        { scriptName: 'a', findRegex: 'a', disabled: false, _dshtScope: 'global' },
        { scriptName: 'b', findRegex: 'b', disabled: false, _dshtScope: 'character' },
      ],
    })
    await settled(f)
    const calls = callsOf(f)
    // 只有一次写回（global），不再三组齐写
    const replaces = calls.filter(c => c.api === 'regexes:replace')
    expect(replaces).toHaveLength(1)
    expect((replaces[0]!.args as unknown[])[1]).toBe('global')
    // 写回内容：契约形状入口 → 内部形状；_dshtScope 已剥除；角色组那条不在 global 桶里
    const bucket = (replaces[0]!.args as unknown[])[0] as Array<Record<string, unknown>>
    expect(bucket.map(x => x.scriptName).sort()).toEqual(['a', 'new'])
    expect(bucket.every(x => x._dshtScope === undefined)).toBe(true)
  })

  it('formatAsTavernRegexedString：同步返回 string（真 TH 契约），用预热缓存过滤', async () => {
    const f = makeFrame('s1')
    // 先用异步 API 预热缓存（模拟真实链路：脚本先 getTavernRegexes 再同步格式化）
    runScript(f, `window.__r0 = null; getTavernRegexes({ type: 'global' }).then(function (r) { window.__r0 = r; });`)
    resolveCall(f, 0, {
      regexes: [
        { scriptName: 'ok', findRegex: 'world', replaceString: '{{match}}!', placement: [2], disabled: false },
        { scriptName: 'promptOnly', findRegex: 'hello', replaceString: 'X', placement: [2], disabled: false, promptOnly: true },
        { scriptName: 'wrongPlacement', findRegex: 'hello', replaceString: 'Y', placement: [1], disabled: false },
        { scriptName: 'disabled', findRegex: 'hello', replaceString: 'Z', placement: [2], disabled: true },
      ],
    })
    await settled(f)
    await settled(f) // 契约链多一跳（call promise → 映射 → 缓存写入）再断言
    // 同步调用（真 TH 契约：直接返回 string）——缓存已由上面的 getTavernRegexes 填充
    const out = vm.runInContext(`formatAsTavernRegexedString('hello world', 'ai_output', 'display')`, f.ctx)
    expect(typeof out).toBe('string')
    // 契约语义：destination.display=false 的脚本（promptOnly /「仅格式提示词」）在 display 跳过；
    // wrongPlacement（source.ai_output=false）与 disabled（enabled=false）同样跳过。
    // 唯一命中：ok（'world' → '{{match}}!' = 'world!'）→ 'hello world!'
    expect(out).toBe('hello world!')
    expect(vm.runInContext('isCharacterTavernRegexesEnabled()', f.ctx)).toBe(true)
  })

  it('世界书写面桥：getWorldbook / replaceLorebookEntries / rebindGlobal / rebindChar / chatGetOrCreate', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__r = {};
      getWorldbook('主世界书').then(function (e) { window.__r.wb = e; });
      replaceLorebookEntries('主世界书', [{ uid: 0, content: 'x' }]).then(function () { window.__r.rep = true; });
      rebindGlobalWorldbooks(['主世界书']).then(function () { window.__r.rg = true; });
      rebindCharWorldbooks('ws-1', ['主世界书']).then(function () { window.__r.rc = true; });
      getOrCreateChatWorldbook().then(function (n) { window.__r.chat = n; });
    `)
    const calls = callsOf(f)
    expect(calls.map(c => c.api)).toEqual([
      'wb:get', 'wb:replaceEntries', 'wb:rebindGlobal', 'wb:rebindChar', 'wb:chatGetOrCreate',
    ])
    expect(calls[1]!.args).toEqual(['主世界书', [{ uid: 0, content: 'x' }]])
    expect(calls[2]!.args).toEqual([['主世界书']])
    expect(calls[3]!.args).toEqual(['ws-1', ['主世界书']])
    resolveCall(f, 0, { book: { name: '主世界书', entries: [{ uid: 0, content: '设定' }] } })
    resolveCall(f, 1, { ok: true })
    resolveCall(f, 2, { ok: true })
    resolveCall(f, 3, { ok: true })
    resolveCall(f, 4, { name: 'chat-s1' })
    await settled(f)
    const r = vm.runInContext('window.__r', f.ctx) as Record<string, unknown>
    // 【2026-09-08 对齐】getWorldbook 条目经 thEnrichEntry 补 TH WorldbookEntry 形状
    // （strategy/position/use_regex——世界书控制卡判定逻辑依赖，缺了触发 wb:entryPut 风暴）
    // 【T-21 2026-09-10 契约修正】原断言是"修复前的错误契约"（secondary_keys/selective_logic/
    // position.type:'before_char'）——真 TH 契约见 JS-Slash-Runner @types/function/worldbook.d.ts：
    // keys_secondary{logic,keys} / scan_depth / position.type 为枚举字符串。
    expect(r['wb']).toEqual([{
      uid: 0, content: '设定',
      strategy: {
        type: 'constant', keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: { type: 'before_character_definition', depth: 4, order: 100, role: 'system' },
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
      probability: 100,
      extra: {},
      use_regex: false,
    }])
    expect(r['rep']).toBe(true)
    expect(r['rg']).toBe(true)
    expect(r['rc']).toBe(true)
    expect(r['chat']).toBe('chat-s1')
  })

  it('substitudeMacros：桥到 macros:expand，解包 result', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; substitudeMacros('{{user}}').then(function (t) { window.__r = t; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'macros:expand', args: ['{{user}}'] })
    resolveCall(f, 0, { result: 'User', writes: [], unknownMacros: [] })
    await settled(f)
    expect(vm.runInContext('window.__r', f.ctx)).toBe('User')
  })

  it('新 API 都在桥实现面 + 裸全局可用', () => {
    const f = makeFrame('s1')
    for (const api of [
      'getChatHistoryBrief', 'getChatHistoryDetail', 'updateTavernRegexesWith', 'formatAsTavernRegexedString',
      'isCharacterTavernRegexesEnabled', 'getWorldbook', 'replaceLorebookEntries', 'rebindGlobalWorldbooks',
      'rebindCharWorldbooks', 'getOrCreateChatWorldbook', 'substitudeMacros',
    ]) {
      expect(SHIM_BRIDGE_APIS as readonly string[]).toContain(api)
      expect(vm.runInContext(`typeof ${api}`, f.ctx)).toBe('function')
      expect(vm.runInContext(`typeof TavernHelper.${api}`, f.ctx)).toBe('function')
    }
  })
})

describe('shim：世界书只读（桥）', () => {
  it('getWorldbooks → wb:list，解包 name 数组', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; getWorldbooks().then(function (n) { window.__r = n; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'wb:list', args: [] })
    resolveCall(f, 0, { books: [{ name: '主世界书', lorePath: 'a' }, { name: '附录' }, { lorePath: '无名' }] })
    await settled(f)
    expect(vm.runInContext('window.__r', f.ctx)).toEqual(['主世界书', '附录'])
  })

  it('getLorebookEntries → wb:get，解包 entries（thEnrichEntry 补 strategy/position）；创建类仍记名拒绝', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__r = null; getLorebookEntries('主世界书').then(function (e) { window.__r = e; });`)
    expect(callsOf(f)[0]).toMatchObject({ api: 'wb:get', args: ['主世界书'] })
    resolveCall(f, 0, { book: { name: '主世界书', entries: [{ uid: 0, content: '设定' }] } })
    await settled(f)
    // 【2026-09-08 对齐】条目带 TH WorldbookEntry 形状（strategy/position 对象）
    // 【T-21 2026-09-10 契约修正】原断言为修复前错误契约，按 worldbook.d.ts 更正。
    expect(vm.runInContext('window.__r', f.ctx)).toEqual([{
      uid: 0, content: '设定',
      strategy: {
        type: 'constant', keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: { type: 'before_character_definition', depth: 4, order: 100, role: 'system' },
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
      probability: 100,
      extra: {},
      use_regex: false,
    }])
    const err = await vm.runInContext(`createLorebookEntry('书', {}).catch(function (e) { return e; })`, f.ctx) as Error
    expect(String(err.message)).toContain('未在 DSH 移植中支持')
    expect(f.posted.filter(m => m.th === 'missing').map(m => m.api)).toContain('createLorebookEntry')
  })
})

describe('shim：updateWorldbookWith 幂等（wb:entryPut 风暴回归）', () => {
  /** 读一条条目 → 原样回传（恒等变换）。修复前：thEnrichEntry 注入的 strategy/use_regex
   *  与 host 落盘形状不等 → 恒等也产生 entryPut → 250ms 队列永不收敛 → 每秒全量重写
   *  2.2MB lore.json（实机 774 次 flush / 6.5min）。修复后：零写入。 */
  it('恒等变换零写入：不产生任何 wb:entryPut', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__r = null;
      updateWorldbookWith('主世界书', function (entries) { return entries; })
        .then(function (n) { window.__r = n; });
    `)
    expect(callsOf(f)[0]).toMatchObject({ api: 'wb:get', args: ['主世界书'] })
    resolveCall(f, 0, { book: { name: '主世界书', entries: [
      { uid: 0, comment: '角色A', content: '设定', key: ['a'], enabled: true, position: 0 },
      { uid: 1, comment: '角色B', content: '设定2', key: ['b'], enabled: true, position: 1 },
    ] } })
    await settled(f)
    const puts = callsOf(f).filter(c => c.api === 'wb:entryPut')
    expect(puts).toEqual([])
    expect(vm.runInContext('window.__r', f.ctx)).toBeTruthy()
  })

  it('先经 getLorebookEntries enrich 再回传：仍零写入（关键回归）', async () => {
    const f = makeFrame('s1')
    const ENTRIES = [
      { uid: 0, comment: '角色A', content: '设定', key: ['a'], enabled: true, position: 0 },
    ]
    runScript(f, `
      window.__r = null;
      getLorebookEntries('主世界书').then(function (es) {
        return updateWorldbookWith('主世界书', function () { return es; });
      }).then(function (n) { window.__r = n; });
    `)
    // 第 1 个 wb:get（getLorebookEntries）
    resolveCall(f, 0, { book: { name: '主世界书', entries: ENTRIES } })
    await settled(f)
    // 第 2 个 wb:get（updateWorldbookWith 内部）——此时才出现
    expect(callsOf(f).filter(c => c.api === 'wb:get').length).toBe(2)
    resolveCall(f, 1, { book: { name: '主世界书', entries: ENTRIES } })
    await settled(f)
    await settled(f)
    expect(callsOf(f).filter(c => c.api === 'wb:entryPut')).toEqual([])
  })

  it('真实变更：只写改动的那一条，且不带 enrich 注入字段', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__r = null;
      updateWorldbookWith('主世界书', function (entries) {
        entries[1].content = '改过了';
        return entries;
      }).then(function (n) { window.__r = n; });
    `)
    resolveCall(f, 0, { book: { name: '主世界书', entries: [
      { uid: 0, comment: '角色A', content: '设定', key: ['a'], enabled: true, position: 0 },
      { uid: 1, comment: '角色B', content: '设定2', key: ['b'], enabled: true, position: 1 },
    ] } })
    await settled(f)
    const puts = callsOf(f).filter(c => c.api === 'wb:entryPut')
    expect(puts.length).toBe(1)
    const entry = puts[0]!.args[1] as Record<string, unknown>
    expect(entry.content).toBe('改过了')
    expect(entry.uid).toBe(1)
    // enrich 注入的展示字段不得回灌磁盘
    expect(entry.strategy).toBeUndefined()
    expect(entry.use_regex).toBeUndefined()
  })

  it('position 对象/数字双形态视为等价（不因形态差异触发写入）', async () => {
    const f = makeFrame('s1')
    const ENTRIES = [
      { uid: 0, comment: '角色A', content: '设定', key: ['a'], enabled: true, position: 0 },
    ]
    runScript(f, `
      window.__r = null;
      getLorebookEntries('主世界书').then(function (es) {
        return updateWorldbookWith('主世界书', function () { return es; });
      }).then(function (n) { window.__r = n; });
    `)
    resolveCall(f, 0, { book: { name: '主世界书', entries: ENTRIES } })
    await settled(f)
    resolveCall(f, 1, { book: { name: '主世界书', entries: ENTRIES } })
    await settled(f)
    await settled(f)
    expect(callsOf(f).filter(c => c.api === 'wb:entryPut')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// host 桥处理器
// ---------------------------------------------------------------------------

function makeDeps(): ThBridgeDeps & {
  store: Map<string, Record<string, unknown>>
  buttons: Map<string, Array<{ name: string; visible: boolean }>>
  presets: Map<string, { name: string; prompts: unknown[]; prompt_order: unknown[] }>
  regexScopes: Map<string, Record<string, unknown>[]>
  wbCalls: Array<unknown[]>
} {
  const store = new Map<string, Record<string, unknown>>()
  const buttons = new Map<string, Array<{ name: string; visible: boolean }>>()
  const presets = new Map<string, { name: string; prompts: unknown[]; prompt_order: unknown[] }>()
  const regexScopes = new Map<string, Record<string, unknown>[]>()
  const wbCalls: Array<unknown[]> = []
  const key = (scope: string, scriptId: string) => `${scope}::${scriptId}`
  return {
    store,
    buttons,
    presets,
    regexScopes,
    varsGet: async (scope, scriptId) => store.get(key(scope, scriptId)) ?? {},
    varsPut: async (scope, tree, scriptId) => { store.set(key(scope, scriptId), tree) },
    varsMerge: async (scope, vars, mode, scriptId) => {
      const cur = store.get(key(scope, scriptId)) ?? {}
      store.set(key(scope, scriptId), mode === 'insert' ? deepMergeInsert(cur, vars) : deepMergeAssign(cur, vars))
    },
    varsDelete: async (scope, path, scriptId) => {
      const tree = store.get(key(scope, scriptId)) ?? {}
      const segs = path.replace(/^\//, '').split('/')
      let cur: Record<string, unknown> = tree
      for (let i = 0; i < segs.length - 1; i++) {
        const n = cur[segs[i]!]
        if (n === null || typeof n !== 'object') return
        cur = n as Record<string, unknown>
      }
      delete cur[segs[segs.length - 1]!]
    },
    varsAll: async (scriptId) => deepMergeAssign(store.get(key('global', '')) ?? {}, store.get(key('chat', '')) ?? {}),
    buttonsGet: (scriptId) => buttons.get(scriptId) ?? [],
    buttonsSet: (scriptId, b) => { buttons.set(scriptId, b) },
    primaryLorebook: async () => '主世界书',
    // ---- 新真实现 deps（内存版数据面）----
    ctxGet: async () => null,
    presetNames: async () => ({ names: [...presets.keys()], loaded: null }),
    presetGet: async (name) => {
      const p = presets.get(name)
      return p ? { found: true, preset: p } : { found: false, preset: null }
    },
    presetPut: async (name, prompts, prompt_order) => { presets.set(name, { name, prompts, prompt_order }) },
    presetDelete: async (name) => { presets.delete(name) },
    presetRename: async (name, newName) => {
      const p = presets.get(name)
      if (!p) return
      presets.delete(name)
      p.name = newName
      presets.set(newName, p)
    },
    presetLoad: async () => {},
    chatMessages: async () => ({
      messages: [{ message_id: 0, name: '云梦璃', role: 'assistant', message: '嗨', is_system: false }],
    }),
    regexesGet: async () => ({ regexes: [] }),
    regexesReplace: async (regexes, scope) => { regexScopes.set(scope, regexes) },
    wbList: async () => ({ books: [{ name: '主世界书', lorePath: null }] }),
    wbGet: async (name) => ({ book: { name, entries: [] } }),
    wbEntryPut: async () => {},
    // 【实机审计修复 2026-09-05】P1/P2 长尾 deps（内存版）
    macrosExpand: async (text) => ({ result: `展开(${text})` }),
    wbReplaceEntries: async (name, entries) => { wbCalls.push(['wb:replaceEntries', name, entries]) },
    wbRebindGlobal: async (names) => { wbCalls.push(['wb:rebindGlobal', names]) },
    wbRebindChar: async (slug, names) => { wbCalls.push(['wb:rebindChar', slug, names]) },
    wbChatGetOrCreate: async () => ({ name: 'chat-s1' }),
    wbCalls,
  }
}

describe('host 桥：handleBridgeCall', () => {
  it('vars:get/put/merge/delete 路由 + script 作用域缺省自身 id', async () => {
    const deps = makeDeps()
    await handleBridgeCall(deps, 's1', 'vars:put', [{ type: 'chat' }, { a: 1, nested: { x: 1 } }])
    expect(deps.store.get('chat::')).toEqual({ a: 1, nested: { x: 1 } })
    // assign：新值覆盖
    await handleBridgeCall(deps, 's1', 'vars:merge', [{ type: 'chat' }, { a: 2, nested: { y: 2 } }, 'assign'])
    expect(deps.store.get('chat::')).toEqual({ a: 2, nested: { x: 1, y: 2 } })
    // insert：只补缺口
    await handleBridgeCall(deps, 's1', 'vars:merge', [{ type: 'chat' }, { a: 99, b: 3 }, 'insert'])
    expect(deps.store.get('chat::')).toEqual({ a: 2, b: 3, nested: { x: 1, y: 2 } })
    // get
    expect(await handleBridgeCall(deps, 's1', 'vars:get', [{ type: 'chat' }])).toEqual({ a: 2, b: 3, nested: { x: 1, y: 2 } })
    // script 作用域缺省 script_id = 调用方
    await handleBridgeCall(deps, 's1', 'vars:put', [{ type: 'script' }, { private: true }])
    expect(deps.store.get('script::s1')).toEqual({ private: true })
    // delete（lodash 路径 → host 已转 JSONPointer，这里直接给 pointer）
    await handleBridgeCall(deps, 's1', 'vars:delete', [{ type: 'chat' }, '/b'])
    expect(deps.store.get('chat::')).toEqual({ a: 2, nested: { x: 1, y: 2 } })
  })

  it('非法树 / 未知 api / message 作用域拒绝', async () => {
    const deps = makeDeps()
    await expect(handleBridgeCall(deps, 's1', 'vars:put', [{ type: 'chat' }, [1, 2]])).rejects.toThrow(/object/)
    await expect(handleBridgeCall(deps, 's1', 'no:such', [])).rejects.toThrow(/unknown bridge api/)
    // 【2026-09-08 对齐】message 作用域已支持（会话持有层，TavernSessionStore）
    await expect(handleBridgeCall(deps, 's1', 'vars:get', [{ type: 'message' }])).resolves.toBeDefined()
  })

  it('buttons get/set + lorebook:primary', async () => {
    const deps = makeDeps()
    expect(await handleBridgeCall(deps, 's1', 'buttons:get', [])).toEqual([])
    await handleBridgeCall(deps, 's1', 'buttons:set', [[{ name: '刷新', visible: true }]])
    expect(deps.buttons.get('s1')).toEqual([{ name: '刷新', visible: true }])
    expect(await handleBridgeCall(deps, 's1', 'lorebook:primary', [])).toBe('主世界书')
  })

  it('新分发：preset:names/get/put/delete/rename/load 路由', async () => {
    const deps = makeDeps()
    await handleBridgeCall(deps, 's1', 'preset:put', ['P1', [{ identifier: 'main' }], [{ character_id: 1, order: [{ identifier: 'main', enabled: true }] }], true])
    expect(deps.presets.get('P1')?.prompts).toEqual([{ identifier: 'main' }])
    expect(await handleBridgeCall(deps, 's1', 'preset:names', [])).toEqual({ names: ['P1'], loaded: null })
    expect(await handleBridgeCall(deps, 's1', 'preset:get', ['P1'])).toMatchObject({ found: true })
    await handleBridgeCall(deps, 's1', 'preset:rename', ['P1', 'P2'])
    expect(deps.presets.has('P1')).toBe(false)
    expect(deps.presets.get('P2')?.name).toBe('P2')
    await handleBridgeCall(deps, 's1', 'preset:delete', ['P2'])
    expect(deps.presets.has('P2')).toBe(false)
    await expect(handleBridgeCall(deps, 's1', 'preset:load', ['sess-1', 'P1'])).resolves.toBeUndefined()
  })

  it('新分发：chat:messages / regexes:get/replace / wb:list/get/entryPut / ctx:get', async () => {
    const deps = makeDeps()
    expect(await handleBridgeCall(deps, 's1', 'chat:messages', [null])).toMatchObject({ messages: [{ message_id: 0 }] })
    expect(await handleBridgeCall(deps, 's1', 'chat:messages', ['sess-2'])).toMatchObject({ messages: [{ message_id: 0 }] })
    await handleBridgeCall(deps, 's1', 'regexes:replace', [[{ scriptName: 'x' }], 'character', 'ws-1', 'sess-1'])
    expect(deps.regexScopes.get('character')).toEqual([{ scriptName: 'x' }])
    // 非法 scope 归一为 global；非对象 entry 兜底为 {}
    await handleBridgeCall(deps, 's1', 'regexes:replace', [[], 'weird', '', ''])
    expect(deps.regexScopes.get('global')).toEqual([])
    await expect(handleBridgeCall(deps, 's1', 'wb:entryPut', ['书', { uid: 1, content: 'x' }])).resolves.toBeUndefined()
    await expect(handleBridgeCall(deps, 's1', 'wb:entryPut', ['书', 'not-object'])).resolves.toBeUndefined()
    await expect(handleBridgeCall(deps, 's1', 'wb:list', [])).resolves.toMatchObject({ books: [{ name: '主世界书' }] })
    await expect(handleBridgeCall(deps, 's1', 'wb:get', ['主世界书'])).resolves.toMatchObject({ book: { name: '主世界书' } })
    expect(await handleBridgeCall(deps, 's1', 'ctx:get', ['sess-1', 'ws-1'])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

describe('按钮事件 id 与清单一致性', () => {
  it('getButtonEventId 确定性（shim 与 host 同算法）', () => {
    expect(getButtonEventId('s1', '重试')).toBe(getButtonEventId('s1', '重试'))
    expect(getButtonEventId('s1', '重试')).not.toBe(getButtonEventId('s2', '重试'))
    expect(getButtonEventId('s1', 'a')).not.toBe(getButtonEventId('s1', 'b'))
  })

  it('不支持清单非空且不含已支持 API', () => {
    expect(UNSUPPORTED_APIS.length).toBeGreaterThan(30)
    expect(UNSUPPORTED_APIS).not.toContain('getVariables')
    expect(UNSUPPORTED_APIS).not.toContain('eventOn')
  })

  it('清单收缩：本次迁移实现的 API 不再记名拒绝，且都在桥实现面 + 裸全局来源里', () => {
    const implemented = [
      'getContext', 'getPresetNames', 'getPreset', 'getLoadedPresetName', 'presetExists', 'createPreset',
      'createOrReplacePreset', 'replacePreset', 'setPreset', 'deletePreset', 'renamePreset', 'loadPreset',
      'updatePresetWith', 'isPresetNormalPrompt', 'isPresetPlaceholderPrompt', 'isPresetSystemPrompt',
      'getChatMessages', 'getChatMessage', 'getTavernRegexes', 'replaceTavernRegexes',
      'getWorldbooks', 'getLorebookEntries',
    ]
    for (const api of implemented) {
      expect(UNSUPPORTED_APIS).not.toContain(api)
      expect(SHIM_BRIDGE_APIS as readonly string[]).toContain(api)
    }
  })

  it('消息写 API：createChatMessages/setChatMessages 已走会话写桥（P3a）；改/删/轮转仍记名拒绝', async () => {
    // P3a 桥接面：append 走 /rp/chat/append（idle 全 turn 物化 / busy 并入 open turn），
    // update 走 compaction/prune + replace 单节点官方原语——不再与宿主记录有损漂移
    expect(UNSUPPORTED_APIS).not.toContain('createChatMessages')
    expect(UNSUPPORTED_APIS).not.toContain('setChatMessages')
    expect(SHIM_BRIDGE_APIS as readonly string[]).toContain('createChatMessages')
    expect(SHIM_BRIDGE_APIS as readonly string[]).toContain('setChatMessages')
    // 其余写路径仍记名拒绝（append-only 有损理由写明）
    const writeApis = ['setChatMessage', 'deleteChatMessages', 'rotateChatMessages']
    for (const api of writeApis) {
      expect(UNSUPPORTED_APIS).toContain(api)
      expect(UNSUPPORTED_REASONS[api]).toContain('有损漂移')
      if (api !== 'rotateChatMessages') expect(UNSUPPORTED_REASONS[api]).toContain('append-only')
    }
    // 沙箱真跑：stub reject + 记名
    const f = makeFrame('s1')
    const err = await vm.runInContext(`setChatMessage(0, { message: '改' }).catch(function (e) { return e; })`, f.ctx) as Error
    expect(err.message).toContain('append-only')
    expect(f.posted.filter(m => m.th === 'missing').map(m => m.api)).toContain('setChatMessage')
  })

  it('新实现 API 挂 TavernHelper 面 + 裸全局；消息读已在裸全局可用', () => {
    const f = makeFrame('s1')
    expect(vm.runInContext('typeof getContext', f.ctx)).toBe('function')
    expect(vm.runInContext('typeof getPreset', f.ctx)).toBe('function')
    expect(vm.runInContext('typeof getChatMessages', f.ctx)).toBe('function')
    expect(vm.runInContext('typeof TavernHelper.getTavernRegexes', f.ctx)).toBe('function')
    expect(vm.runInContext('typeof TavernHelper.replaceTavernRegexes', f.ctx)).toBe('function')
  })
})

// ScriptStatus 类型 smoke（编译期保证）
const _statusSmoke: ScriptStatus = { phase: 'running', missing: [], buttons: [] }
void _statusSmoke

describe('shim：updateWorldbookWith 复刻 ExampleGame 卡真实调用形态', () => {
  /** 卡源码（tavern_helper 内 applyChanges）：
   *    updateWorldbookWith(book, (entries) => entries.map(e =>
   *      uidMap.hasOwnProperty(e.uid) ? { ...e, enabled: uidMap[e.uid] } : e))
   *  1s 心跳反复调用。修复前每轮把 421 条全部重写（实机 774 flush/6.5min）。 */
  it('uidMap 只改 1 条时：恰好 1 个 entryPut，且是 spread 后的新对象', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__r = null;
      var uidMap = { 1: false };
      updateWorldbookWith('内嵌书', function (entries) {
        return entries.map(function (e) {
          return uidMap.hasOwnProperty(e.uid) ? Object.assign({}, e, { enabled: uidMap[e.uid] }) : e;
        });
      }).then(function (n) { window.__r = n; });
    `)
    resolveCall(f, 0, { book: { name: '内嵌书', entries: [
      { uid: 0, comment: 'A', content: 'c0', key: ['a'], enabled: true, position: 0 },
      { uid: 1, comment: 'B', content: 'c1', key: ['b'], enabled: true, position: 1 },
      { uid: 2, comment: 'C', content: 'c2', key: ['c'], enabled: true, position: 2 },
    ] } })
    await settled(f)
    const puts = callsOf(f).filter(c => c.api === 'wb:entryPut')
    expect(puts.length).toBe(1)
    expect((puts[0]!.args[1] as Record<string, unknown>).uid).toBe(1)
    expect((puts[0]!.args[1] as Record<string, unknown>).enabled).toBe(false)
  })

  it('空 uidMap（心跳无变更）：零 entryPut —— 风暴根因回归锁', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__r = null;
      var uidMap = {};
      updateWorldbookWith('内嵌书', function (entries) {
        return entries.map(function (e) {
          return uidMap.hasOwnProperty(e.uid) ? Object.assign({}, e, { enabled: uidMap[e.uid] }) : e;
        });
      }).then(function (n) { window.__r = n; });
    `)
    resolveCall(f, 0, { book: { name: '内嵌书', entries: [
      { uid: 0, comment: 'A', content: 'c0', key: ['a'], enabled: true, position: 0 },
      { uid: 1, comment: 'B', content: 'c1', key: ['b'], enabled: true, position: 1 },
    ] } })
    await settled(f)
    expect(callsOf(f).filter(c => c.api === 'wb:entryPut')).toEqual([])
  })
})
