/**
 * DSH RPC 信封的错误保真（心跳 59 · T-57）
 * ============================================================================
 * 背景：gateway 把**业务失败也包进 HTTP 200**，而原 `dshRpc` 只取 `error.message`
 * → **`error.code` 被丢弃** → 调用方无法区分：
 *   · `gateway/service-unavailable`（宿主服务暂离 ACTIVE，依赖恢复后框架自动 `_reload()` → **值得重试**）
 *   · `session/not-found` 等（重试无意义）
 *
 * 本组钉住两件事：① code 必须被保留；② `isServiceUnavailable` 的判别口径。
 * 用 stub 替换 globalThis.fetch（同 `time-zone.spec.ts` 的做法），不依赖真实网关。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { DshRpcError, dshRpc, isServiceUnavailable } from '../src/dsht-rp-ui/src/client/rpc.ts'

/** 造一个 gateway 形态的 200 信封响应 */
function envelope(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('dshRpc：业务错误保真（心跳 59 · T-57）', () => {
  it('ok:false 时不抛裸 Error —— 抛 DshRpcError，且 code/message/method 三件齐', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({
      result: {
        ok: false,
        error: {
          code: 'gateway/service-unavailable',
          message: 'typert gateway: session/list: active Service "sessionController" is unavailable',
        },
      },
    })))
    const err = await dshRpc('session.list', { _request: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DshRpcError)
    const e = err as DshRpcError
    // 承重：原实现只留 message，code 丢失 → 调用方无从判别
    expect(e.code).toBe('gateway/service-unavailable')
    expect(e.method).toBe('session/list')
    expect(e.message).toContain('sessionController')
  })

  it('向后兼容：仍是 Error 实例 → 既有 (e as Error).message 调用点零改动可用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({
      result: { ok: false, error: { code: 'session/not-found', message: 'no such session' } },
    })))
    const err = await dshRpc('session.list', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('no such session')
    expect((err as Error).name).toBe('DshRpcError')
  })

  it('信封缺 code 时不崩（code 为 undefined，message 兜底为「<method> failed」）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ result: { ok: false } })))
    const err = await dshRpc('session.list', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DshRpcError)
    expect((err as DshRpcError).code).toBeUndefined()
    expect((err as Error).message).toBe('session.list failed')
  })

  it('HTTP 非 200 也走 DshRpcError（带 http/<status> 码，不再抛裸 Error）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    const err = await dshRpc('session.list', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DshRpcError)
    expect((err as DshRpcError).code).toBe('http/503')
  })

  it('成功路径不受影响（返回 value）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ result: { ok: true, value: { items: [{ sessionId: 's1' }] } } })))
    await expect(dshRpc('session.list', {})).resolves.toEqual({ items: [{ sessionId: 's1' }] })
  })
})

describe('isServiceUnavailable：可自愈判别（心跳 59 · T-57）', () => {
  it('gateway/service-unavailable → true（= 宿主服务暂离，稍后自愈，值得重试）', () => {
    expect(isServiceUnavailable(new DshRpcError('session/list', 'gateway/service-unavailable', 'x'))).toBe(true)
  })

  it('其它业务码 → false（重试无意义，别把它们也当"等一下就好"）', () => {
    expect(isServiceUnavailable(new DshRpcError('session/list', 'session/not-found', 'x'))).toBe(false)
    expect(isServiceUnavailable(new DshRpcError('session/list', 'gateway/arguments-invalid', 'x'))).toBe(false)
    expect(isServiceUnavailable(new DshRpcError('session/list', undefined, 'x'))).toBe(false)
  })

  it('非 DshRpcError 一律 false（普通 Error / 网络异常 / null 不误判）', () => {
    expect(isServiceUnavailable(new Error('gateway/service-unavailable'))).toBe(false)
    expect(isServiceUnavailable('gateway/service-unavailable')).toBe(false)
    expect(isServiceUnavailable(null)).toBe(false)
    expect(isServiceUnavailable(undefined)).toBe(false)
  })
})
