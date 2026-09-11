/**
 * ST 兼容版本声明（`dsht-plugin-shared/st-compat.ts`）测试。
 *
 * 口径：**黄金母版**（L37）—— 钉住基准里**真实存在的**值，而不是「我认为应该是什么」。
 * 基准出处：`TauriTavern/src/compat-version.js:1` → `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`。
 *
 * 阈值 11305 的来历：卡的宿主脚本 `inject.js:2210-2218` 取
 * `data.pkgVersion.split('.')` 后算 `major*10000 + minor*100 + patch`，
 * 再用 `versionNumber >= 11305` 分叉（该脚本内 20+ 处）。故：
 *   - `'1.13.5'` → **11305 = 恰好命中阈值**（决定性边界，卡走新版路径）
 *   - `'1.13.4'` → 11304（差 1，走旧版路径）
 * 这两条是「本模块是否真的能让卡走对分支」的直接判据，不是形式断言。
 */
import { describe, expect, it } from 'vitest'
import {
  SILLYTAVERN_COMPAT_VERSION,
  stVersionNumber,
  stVersionPayload,
} from '../src/dsht-plugin-shared/st-compat.ts'

describe('ST 兼容版本声明（单源）', () => {
  it('版本值与基准 compat-version.js 逐字一致（改动即报警）', () => {
    // 基准：TauriTavern/src/compat-version.js:1
    expect(SILLYTAVERN_COMPAT_VERSION).toBe('1.18.0')
  })

  it('编码式与卡脚本 :2214 同式（major*10000 + minor*100 + patch）', () => {
    expect(stVersionNumber()).toBe(11800)
    expect(stVersionNumber('1.18.0')).toBe(11800)
    expect(stVersionNumber('1.12.0')).toBe(11200)
  })

  it('阈值边界：11305 是卡的分叉点（>= 走新版内置正则绑定路径）', () => {
    expect(stVersionNumber('1.13.5')).toBe(11305) // 恰好命中
    expect(stVersionNumber('1.13.4')).toBe(11304) // 差一
    expect(stVersionNumber('1.13.5') >= 11305).toBe(true)
    expect(stVersionNumber('1.13.4') >= 11305).toBe(false)
    // 我方声明值必须**显著高于**阈值（否则等于没修）
    expect(stVersionNumber() >= 11305).toBe(true)
  })

  it('解析失败回落 10000 —— 与卡 catch 分支的落点同值（诊断时能一眼认出「取不到版本」）', () => {
    expect(stVersionNumber('')).toBe(10000)
    expect(stVersionNumber('1.2')).toBe(10000) // 段数不足
    expect(stVersionNumber('v1.18.0')).toBe(10000) // 非数字段（卡的 split 也不容忍 v 前缀）
    expect(stVersionNumber('abc.def.ghi')).toBe(10000)
  })
})

describe('/version 响应体（形状对照基准 tauri-bridge.js:162-171）', () => {
  it('必备键：pkgVersion 是卡唯一消费的字段', () => {
    const body = stVersionPayload()
    expect(body.pkgVersion).toBe(SILLYTAVERN_COMPAT_VERSION)
    expect(typeof body.pkgVersion).toBe('string')
  })

  it('agent 是 ST 客户端标识串（同形；第三段为 DSHTavern）', () => {
    expect(stVersionPayload().agent).toBe(`SillyTavern:${SILLYTAVERN_COMPAT_VERSION}:DSHTavern`)
  })

  it('基准同形字段齐备且为 null/缺省（不多给语义）', () => {
    const body = stVersionPayload()
    expect(body.gitRevision).toBeNull()
    expect(body.gitBranch).toBeNull()
    expect(body.defaultUpdateChannel).toBe('stable')
    // 未传 extra → 不凭空造 tauriVersion / dshVersion（L36「不能多」）
    expect('tauriVersion' in body).toBe(false)
    expect('dshVersion' in body).toBe(false)
  })

  it('诊断键只在显式提供时出现（只增不改，不影响按字段取值的消费方）', () => {
    const body = stVersionPayload({ dshVersion: '0.1.5-rc.1', appVersion: '0.2.0' })
    expect(body.dshVersion).toBe('0.1.5-rc.1')
    expect(body.tauriVersion).toBe('0.2.0')
    expect(body.pkgVersion).toBe(SILLYTAVERN_COMPAT_VERSION) // pkgVersion 仍不受影响
  })

  it('可 JSON 往返（必须能被 HTTP 序列化 —— 卡的 res.json() 依赖它）', () => {
    const round = JSON.parse(JSON.stringify(stVersionPayload())) as { pkgVersion?: string }
    expect(round.pkgVersion).toBe(SILLYTAVERN_COMPAT_VERSION)
  })
})
