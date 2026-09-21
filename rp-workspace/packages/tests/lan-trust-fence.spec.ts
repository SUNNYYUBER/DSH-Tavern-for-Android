/**
 * W-A（2026-09-21）：`DSHT_LAN_MODE` 环境变量 ↔ 信任栅栏 lanMode 的等价性。
 * ============================================================================
 * ## 这条测试守的是什么
 * Android 的局域网访问形态是**原生 TCP 反代**（0.0.0.0:port+10 → 127.0.0.1:port），
 * webServer 本体仍绑 loopback。经代理进来的请求 Host 是 LAN 地址（如 192.168.x.x:3090），
 * 栅栏若只认「webServer.host === '0.0.0.0'」会把它们全判成 DNS rebinding → 403，
 * LAN 功能在我方全部数据面（/dsht-rp /dsht-mvu /dsht-th /dsht-memory）整体失效。
 * 故栅栏加 env 通道：NodeService 在 LAN 开关开启时给 node 注入 DSHT_LAN_MODE=1。
 *
 * ## 判据（正反控都要有——守「防线没破」与「通道真的通」）
 * 1. env 未设 + webServer 绑 loopback + Host 是 LAN 地址 ⇒ **拒**（DNS rebinding 防线不破）
 * 2. env=1 + Host 是 LAN 地址 ⇒ **放行**（通道真的通）
 * 3. env=1 + Origin 的 authority ≠ Host（跨源浏览器请求）⇒ **拒**（LAN 不放宽跨源）
 * 4. env=1 + Origin 与 Host 同源 ⇒ 放行（LAN 下正常浏览器行为）
 * 5. 旧路径回归：webServer.host='0.0.0.0'（PC 部署形态）即使无 env 也按 lanMode
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isTrusted } from '../src/dsht-plugin-shared/http.ts'

const LAN_REQ = { headers: { host: '192.168.1.8:3090' } }
const LOOPBACK_WS = { register: () => () => {}, host: '127.0.0.1' as const }
const LAN_WS = { register: () => () => {}, host: '0.0.0.0' as const }

afterEach(() => { delete process.env.DSHT_LAN_MODE })

describe('W-A DSHT_LAN_MODE ↔ 信任栅栏 lanMode 等价', () => {
  it('✅ 判据 1：env 未设 + loopback 绑定 + LAN Host ⇒ 拒（防线不破）', () => {
    expect(isTrusted(LAN_REQ, LOOPBACK_WS)).toBe(false)
  })

  it('✅ 判据 2：env=1 + LAN Host ⇒ 放行（反代形态被认出）', () => {
    process.env.DSHT_LAN_MODE = '1'
    expect(isTrusted(LAN_REQ, LOOPBACK_WS)).toBe(true)
  })

  it('✅ 判据 3：env=1 + Origin 跨源（authority ≠ Host）⇒ 拒（LAN 不放宽跨源）', () => {
    process.env.DSHT_LAN_MODE = '1'
    const req = { headers: { host: '192.168.1.8:3090', origin: 'http://evil.example:3090' } }
    expect(isTrusted(req, LOOPBACK_WS)).toBe(false)
  })

  it('✅ 判据 4：env=1 + Origin 同源 ⇒ 放行', () => {
    process.env.DSHT_LAN_MODE = '1'
    const req = { headers: { host: '192.168.1.8:3090', origin: 'http://192.168.1.8:3090' } }
    expect(isTrusted(req, LOOPBACK_WS)).toBe(true)
  })

  it('✅ 判据 5：旧路径回归——webServer 绑 0.0.0.0（无 env）仍按 lanMode', () => {
    expect(isTrusted(LAN_REQ, LAN_WS)).toBe(true)
  })

  it('边界：env 传其他值不生效（只有精确的 "1" 算开）', () => {
    process.env.DSHT_LAN_MODE = 'true'
    expect(isTrusted(LAN_REQ, LOOPBACK_WS)).toBe(false)
  })
})
