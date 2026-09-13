/**
 * T-81：MVU 命名空间事件面（`Mvu.events.*`）单测。
 *
 * 背景（心跳 73 静态穷举发现，判据 = L44「枚举器的覆盖边界就是结论边界」）：
 *   原卡事件面闸门 `audit-card-event-surface.mjs` 只扫 3 张 **ST** 表
 *   （`tavern_events` / `iframe_events` / `event_types`），而 MVU 框架自带**第 4 个命名空间** `Mvu`
 *   （权威契约 = `JS-Slash-Runner/@types/iframe/exported.mvu.d.ts`），卡同样在它上面注册事件：
 *       eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)      // 语料实测 3 个文件
 *   而 shim 的 `Mvu.events` **一个常量都没有** ⇒ `evt === undefined`
 *   ⇒ `String(undefined) === 'undefined'` ⇒ **静默注册到 `'undefined'` 键**：
 *   注册"成功"、零报错、零 warn、回调永不执行（静默失败族最坏形态）。
 *
 * 本文件的承重反控：
 *   · 把 `Mvu.events.VARIABLE_UPDATE_ENDED` 删掉 ⇒ 第 1/2 组转红；
 *   · 把 `evtKey` 换回 `String(evt)` ⇒ 第 3 组（出声）转红。
 */
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildShimSource } from '../src/dsht-rp-ui/src/client/th-shim.ts'

// ---------------------------------------------------------------------------
// vm 沙箱 harness（与 th-script-runtime.spec.ts 同款，等价 sandbox iframe）
// ---------------------------------------------------------------------------

function makeFrame(scriptId: string): vm.Context {
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.parent = { postMessage: () => {} }
  sandbox.name = scriptId
  sandbox.addEventListener = () => {}
  sandbox.document = { body: { childElementCount: 0 } }
  sandbox.setTimeout = () => 0
  sandbox.console = console
  const ctx = vm.createContext(sandbox)
  vm.runInContext(buildShimSource({ scriptId, scriptName: scriptId, secret: 'sec', version: 'test' }), ctx)
  return ctx
}

/**
 * 权威契约（逐字抄自 `@types/iframe/exported.mvu.d.ts:70-118`）。
 * ⚠️ `VARIABLE_INITIALIZED` 的值在本源里是 `'mag_variable_initiailized'` —— **上游拼写错误**，
 * 必须**逐字**照抄；"修正"它 = 与真 MVU 的事件值不一致 ⇒ 回调同样永不触发，且更难查。
 */
const CONTRACT_MVU_EVENTS: Record<string, string> = {
  VARIABLE_INITIALIZED: 'mag_variable_initiailized',
  VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
  COMMAND_PARSED: 'mag_command_parsed',
  VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
  BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
}

afterEach(() => { vi.restoreAllMocks() })

// ⚠️ shim 的 `eventEmit` 是 **Promise 链**投递（`.reduce(p.then(...))`）——回调在微任务里跑。
// 断言前必须冲刷，否则「没触发」会因为**还没来得及跑**而假绿（负控尤其危险）。
const flush = () => new Promise((r) => setImmediate(r))

// ---------------------------------------------------------------------------
// 1. 常量存在且逐字对齐契约
// ---------------------------------------------------------------------------

describe('T-81 / Mvu.events 常量表（权威契约 exported.mvu.d.ts）', () => {
  it('契约声明的 5 个常量全部存在，且取值逐字一致', () => {
    const ctx = makeFrame('s-mvu-1')
    for (const [name, value] of Object.entries(CONTRACT_MVU_EVENTS)) {
      expect(vm.runInContext(`Mvu.events.${name}`, ctx), name).toBe(value)
    }
  })

  it('🔴 反控：VARIABLE_INITIALIZED 保留上游拼写错误（不得"修正"成 initiailized → initialized）', () => {
    const ctx = makeFrame('s-mvu-2')
    const v = vm.runInContext('Mvu.events.VARIABLE_INITIALIZED', ctx)
    expect(v).toBe('mag_variable_initiailized')
    expect(v).not.toBe('mag_variable_initialized') // 写对了 = 与真 MVU 不一致
  })

  it('常量是「事件名」，不是可调用的总线成员（on/emit 仍保留，加法式变更）', () => {
    const ctx = makeFrame('s-mvu-3')
    expect(typeof vm.runInContext('Mvu.events.VARIABLE_UPDATE_ENDED', ctx)).toBe('string')
    expect(vm.runInContext("typeof Mvu.events.on", ctx)).toBe('function')
    expect(vm.runInContext("typeof Mvu.events.emit", ctx)).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 2. 正控：注册到**正确的事件键**，并能被 eventEmit 投递
// ---------------------------------------------------------------------------

describe('T-81 / 注册面：eventOn(Mvu.events.X, cb) 必须落到 mag_* 键', () => {
  it('正控：eventEmit(mag_variable_update_ended, …) 能触发回调（键正确）', async () => {
    const ctx = makeFrame('s-mvu-4')
    vm.runInContext(`
      window.__hits = [];
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function (vars, oldVars) {
        window.__hits.push([vars.n, oldVars.n]);
      });
    `, ctx)
    vm.runInContext(`eventEmit('mag_variable_update_ended', { n: 2 }, { n: 1 })`, ctx)
    await flush()
    expect(vm.runInContext('window.__hits', ctx)).toEqual([[2, 1]])
  })

  it('🔴 承重反控：回调**不会**落在 `undefined` 键上（修复前的形态）', async () => {
    const ctx = makeFrame('s-mvu-5')
    vm.runInContext(`
      window.__hits = [];
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () { window.__hits.push('hit'); });
    `, ctx)
    vm.runInContext(`eventEmit('undefined')`, ctx)
    await flush()   // 必须冲刷后再断言（否则"没触发"可能是"还没跑"）
    expect(vm.runInContext('window.__hits', ctx)).toEqual([])
  })

  it('可选链形态 `Mvu?.events?.X` 同样取到正确值（语料实测写法）', async () => {
    const ctx = makeFrame('s-mvu-6')
    expect(vm.runInContext('typeof Mvu?.events?.VARIABLE_UPDATE_ENDED', ctx)).toBe('string')
    vm.runInContext(`
      window.__hits = [];
      eventOn(typeof Mvu !== 'undefined' && Mvu?.events?.VARIABLE_UPDATE_ENDED, function () { window.__hits.push('ok'); });
    `, ctx)
    vm.runInContext(`eventEmit('mag_variable_update_ended')`, ctx)
    await flush()
    expect(vm.runInContext('window.__hits', ctx)).toEqual(['ok'])
  })
})

// ---------------------------------------------------------------------------
// 3. 出声：非字符串事件名（L42「降级要出声」）
// ---------------------------------------------------------------------------

describe('T-81 / 降级出声：非字符串事件名必须可听', () => {
  it('eventOn(undefined, cb) 打一次 console.warn，并**保持**真 TH 语义（仍注册到 "undefined" 键）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeFrame('s-mvu-7')
    vm.runInContext(`
      window.__hits = [];
      eventOn(undefined, function () { window.__hits.push('bad'); });
      eventOn(undefined, function () { window.__hits.push('bad2'); });   // 第二次不得再刷屏
    `, ctx)
    const msgs = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('非字符串事件名'))
    expect(msgs.length).toBe(1)
    expect(msgs[0]).toContain('"undefined"')
    // 语义不变（L36：与真 TH 一致 —— 仍注册到 'undefined' 键）
    vm.runInContext(`eventEmit('undefined')`, ctx)
    await flush()
    expect(vm.runInContext('window.__hits', ctx)).toEqual(['bad', 'bad2'])
  })

  it('负控：正常事件注册**不**出声（防噪音）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeFrame('s-mvu-8')
    vm.runInContext(`eventOn(tavern_events.GENERATION_ENDED, function () {});`, ctx)
    expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('非字符串事件名'))).toEqual([])
  })

  it('注册我方**结构性不发射**的 mag_* 事件 ⇒ 一次性出声说明原因（明示降级）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeFrame('s-mvu-9')
    vm.runInContext(`
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () {});
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () {});   // 第二个监听器不再重复出声
    `, ctx)
    const msgs = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('不发射'))
    expect(msgs.length).toBe(1)
    expect(msgs[0]).toContain('mag_variable_update_ended')
    // 注册本身必须仍然成功（可 stop，语义与真 TH 一致）
    expect(vm.runInContext(`typeof eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () {}).stop`, ctx)).toBe('function')
  })

  it('负控：已覆盖的 ST 事件注册不出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeFrame('s-mvu-10')
    vm.runInContext(`
      eventOn(tavern_events.MESSAGE_RECEIVED, function () {});
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () {});
    `, ctx)
    const msgs = warn.mock.calls.map(c => String(c[0]))
    expect(msgs.filter(m => m.includes('message_received'))).toEqual([])
  })
})
