/**
 * 宿主 eventSource（T-39）测试——语义逐条对齐真 ST/TH（`th-shim.ts:593-648` 的真 TH 语义），
 * 触发来源是设备实测：卡的外链注入脚本 `ctx.eventSource.on('module_imported', …)`
 * 在 inject.js:2245 抛 TypeError（补齐 SillyTavern 之后暴露的第二道墙，全篇 27 处）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createThEventSource } from '../src/dsht-rp-ui/src/client/th-event-source.ts'
import {
  __resetHostEventSource, buildHostStContext, getHostEventSource,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'

let errors: Array<{ event: string; error: unknown }> = []
let es = createThEventSource((event, error) => { errors.push({ event, error }) })

beforeEach(() => {
  errors = []
  es = createThEventSource((event, error) => { errors.push({ event, error }) })
  __resetHostEventSource()
})
afterEach(() => { __resetHostEventSource() })

describe('eventSource：注册与派发', () => {
  it('on 注册后 emit 按注册顺序串行调用，且 await 监听器的 Promise', async () => {
    const order: string[] = []
    es.on('x', async () => { await new Promise((r) => setTimeout(r, 5)); order.push('a') })
    es.on('x', () => { order.push('b') })
    await es.emit('x')
    expect(order).toEqual(['a', 'b']) // 串行：a 的 5ms 等待完成后才轮到 b
  })

  it('emit 传参透传', async () => {
    const seen: unknown[] = []
    es.on('x', (...args: unknown[]) => { seen.push(...args) })
    await es.emit('x', 1, 'two', { k: 3 })
    expect(seen).toEqual([1, 'two', { k: 3 }])
  })

  it('返回的 {stop} 句柄能摘掉监听（真 TH EventOnReturn 同形）', async () => {
    let n = 0
    const h = es.on('x', () => { n += 1 })
    await es.emit('x')
    h.stop()
    await es.emit('x')
    expect(n).toBe(1)
  })

  it('emitAndWait 与 emit 同义（都等待完成）', async () => {
    let done = false
    es.on('x', async () => { await Promise.resolve(); done = true })
    await es.emitAndWait('x')
    expect(done).toBe(true)
  })
})

describe('eventSource：幂等与移动语义（真 TH 的鲁棒轮修复点，禁止回退）', () => {
  it('同一函数引用重复 on 幂等——listenerCount 不增、只调用一次', async () => {
    let n = 0
    const fn = (): void => { n += 1 }
    es.on('x', fn)
    es.on('x', fn)
    es.on('x', fn)
    expect(es.listenerCount('x')).toBe(1)
    await es.emit('x')
    expect(n).toBe(1)
  })

  it('once 对同一函数也幂等，且只触发一次', async () => {
    let n = 0
    const fn = (): void => { n += 1 }
    es.once('x', fn)
    es.once('x', fn)
    expect(es.listenerCount('x')).toBe(1)
    await es.emit('x')
    await es.emit('x')
    expect(n).toBe(1)
    expect(es.listenerCount('x')).toBe(0)
  })

  it('makeFirst 是「移动」不是「新增」——不会双注册（回退成 push 会 2 次调用）', async () => {
    const order: string[] = []
    const a = (): void => { order.push('a') }
    const b = (): void => { order.push('b') }
    es.on('x', a)
    es.on('x', b)
    es.makeFirst('x', b) // b 已在监听 → 应移动而非新增
    expect(es.listenerCount('x')).toBe(2)
    await es.emit('x')
    expect(order).toEqual(['b', 'a'])
  })

  it('makeLast 同样是移动语义', async () => {
    const order: string[] = []
    const a = (): void => { order.push('a') }
    const b = (): void => { order.push('b') }
    es.on('x', a)
    es.on('x', b)
    es.makeLast('x', a)
    expect(es.listenerCount('x')).toBe(2)
    await es.emit('x')
    expect(order).toEqual(['b', 'a'])
  })
})

describe('eventSource：失败不扩散（坏一个监听器不能掀整条链）', () => {
  it('中间监听器抛错 → emit 不 reject，后续监听器照常执行，错误被记名', async () => {
    const order: string[] = []
    es.on('x', () => { order.push('a') })
    es.on('x', () => { throw new Error('boom') })
    es.on('x', () => { order.push('c') })
    await expect(es.emit('x')).resolves.toBeUndefined()
    expect(order).toEqual(['a', 'c'])
    expect(errors).toHaveLength(1)
    expect(errors[0].event).toBe('x')
  })

  it('前一个监听器 clearEvent 后，快照里剩下的监听器不再执行（不留半执行）', async () => {
    const order: string[] = []
    es.on('x', () => { order.push('a'); es.clearEvent('x') })
    es.on('x', () => { order.push('b') })
    await es.emit('x')
    expect(order).toEqual(['a'])
  })
})

describe('eventSource：清理族', () => {
  it('off / removeListener 等价', async () => {
    let n = 0
    const fn = (): void => { n += 1 }
    es.on('x', fn)
    es.off('x', fn)
    es.on('x', fn)
    es.removeListener('x', fn)
    await es.emit('x')
    expect(n).toBe(0)
  })

  it('clearListener 按函数引用跨事件清（返回清除数）', () => {
    const fn = (): void => { /* noop */ }
    es.on('a', fn)
    es.on('b', fn)
    es.on('b', () => { /* other */ })
    expect(es.clearListener(fn)).toBe(2)
    expect(es.listenerCount()).toBe(1)
  })

  it('clearEvent 只清该事件；clearAll 清全部；listenerCount() 汇总', () => {
    es.on('a', () => { /* noop */ })
    es.on('a', () => { /* noop */ })
    es.on('b', () => { /* noop */ })
    es.clearEvent('a')
    expect(es.listenerCount('a')).toBe(0)
    expect(es.listenerCount()).toBe(1)
    es.clearAll()
    expect(es.listenerCount()).toBe(0)
  })
})

describe('eventSource：接入 getContext()（脚本的取用点）', () => {
  it('getContext().eventSource 存在且是可用的发射器（脚本 :2245 的 .on 调用）', async () => {
    const ctx = buildHostStContext()
    const src = ctx.eventSource as { on: (e: string, f: (d: unknown) => void) => unknown }
    expect(typeof src.on).toBe('function')
    let got: unknown = null
    src.on('module_imported', (d: unknown) => { got = d })
    await getHostEventSource().emit('module_imported', { id: 'STVersionImports' })
    expect(got).toEqual({ id: 'STVersionImports' })
  })

  it('是进程级单例：与 getHostEventSource() 同一枚（否则 off 摘不掉自己挂的监听）', () => {
    const a = buildHostStContext().eventSource
    const b = buildHostStContext().eventSource
    expect(a).toBe(getHostEventSource())
    expect(b).toBe(getHostEventSource())
    expect(a).toBe(b)
  })

  it('__resetHostEventSource 后换新（测试隔离用）', () => {
    const a = getHostEventSource()
    __resetHostEventSource()
    expect(getHostEventSource()).not.toBe(a)
  })
})
