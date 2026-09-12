/**
 * T-80 心跳 74：新增的两条「宿主页 → 脚本帧」事件投递面 + 其注册表。
 *
 * 背景（为什么必须经注册表，而不是在宿主 event source 上 emit）：
 *   卡跑在 `about:srcdoc` iframe 里，注册挂在**帧内**那份 `th-shim` 的 eventSource 上；
 *   宿主页 `th-event-source.ts` 是**另一份**实例（该模块头注已明说）⇒ 宿主侧 emit 到不了卡。
 *   唯一通道 = `RpScriptHost.emitSessionEvent()`（逐帧 postMessage + 未就绪入队补投）。
 *
 * 本文件两类断言：
 *   A. 注册表行为（纯函数，可直接单测）；
 *   B. **发射点接线**（源码级断言 —— 与 `mvu-event-namespace.spec.ts` 同款手法，
 *      因为发射点在 React 组件 / 桥里，跑起来需要整页环境；源码断言足以锁住"接线被误删/顺序被改"）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  emitThEventToFrames,
  frameEmitterCount,
  registerFrameEmitter,
  resetFrameEmitters,
  unregisterFrameEmitter,
} from '../src/dsht-rp-ui/src/client/th-host-events.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = resolve(HERE, '../src/dsht-rp-ui/src/client')

const read = (f: string): string => readFileSync(join(CLIENT, f), 'utf8')
/** 统计**代码里**的字面量（单引号形态）出现次数；注释里的反引号提及不计入 */
const codeLiteralCount = (text: string, value: string): number => text.split(`'${value}'`).length - 1

// ---------------------------------------------------------------------------
// A. 注册表行为
// ---------------------------------------------------------------------------

describe('th-host-events 注册表', () => {
  beforeEach(() => { resetFrameEmitters() })

  it('定向投递只到该会话', () => {
    const a: Array<[string, unknown[]]> = []
    const b: Array<[string, unknown[]]> = []
    registerFrameEmitter('s1', (t, args) => a.push([t, args]))
    registerFrameEmitter('s2', (t, args) => b.push([t, args]))

    const n = emitThEventToFrames('preset_changed', [{ apiId: 'openai', name: 'p' }], 's1')

    expect(n).toBe(1)
    expect(a).toEqual([['preset_changed', [{ apiId: 'openai', name: 'p' }]]])
    expect(b).toEqual([])
  })

  it('广播投递到全部在册会话（设置类事件是全局的）', () => {
    const seen: string[] = []
    registerFrameEmitter('s1', () => seen.push('s1'))
    registerFrameEmitter('s2', () => seen.push('s2'))

    const n = emitThEventToFrames('settings_updated', [])

    expect(n).toBe(2)
    expect(seen.sort()).toEqual(['s1', 's2'])
  })

  it('负控：无在册会话时投递是空操作且不抛（≠ 报错）', () => {
    expect(frameEmitterCount()).toBe(0)
    expect(() => emitThEventToFrames('settings_updated', [])).not.toThrow()
    expect(emitThEventToFrames('settings_updated', [])).toBe(0)
    expect(emitThEventToFrames('preset_changed', [], 'nope')).toBe(0)
  })

  it('负控：摘除后不再收到（漏摘 ⇒ 向已死 runtime 投递）', () => {
    let hits = 0
    registerFrameEmitter('s1', () => { hits++ })
    unregisterFrameEmitter('s1')
    expect(emitThEventToFrames('settings_updated', [])).toBe(0)
    expect(hits).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// B. 发射点接线（源码级）
// ---------------------------------------------------------------------------

describe('预设切换：两条事件按基准顺序投递', () => {
  const src = read('RpPresetSwitch.tsx')

  it('在 `preset/select` **成功之后**投递（失败不发）', () => {
    const iSelect = src.indexOf("await rpApi('preset/select'")
    const iAfter = src.indexOf("'oai_preset_changed_after'")
    const iPreset = src.indexOf("'preset_changed'")
    expect(iSelect).toBeGreaterThan(-1)
    expect(iAfter).toBeGreaterThan(iSelect)
    expect(iPreset).toBeGreaterThan(iAfter)
  })

  it('顺序 = 基准 `openai.js:6825-6826` 的 AFTER → PRESET_CHANGED', () => {
    const iAfter = src.indexOf("'oai_preset_changed_after'")
    const iPreset = src.indexOf("'preset_changed'")
    expect(iAfter).toBeLessThan(iPreset)
  })

  it('apiId 取我方真实主 API（DSHT_MAIN_API），不是编造值', () => {
    expect(src).toContain("import { DSHT_MAIN_API }")
    expect(src).toContain('apiId: DSHT_MAIN_API')
  })

  it('负控：每个事件名只投一次（不得顺带多发同义事件，L36「不能多」）', () => {
    expect(codeLiteralCount(src, 'oai_preset_changed_after')).toBe(1)
    expect(codeLiteralCount(src, 'preset_changed')).toBe(1)
  })
})

describe('设置落盘：settings_updated 只在「卡发起」的两条路径上', () => {
  const src = read('host-vendor.ts')

  it('恰两处发射点（防抖计时器回调 + flush）', () => {
    expect(codeLiteralCount(src, 'settings_updated')).toBe(2)
  })

  it('🔴 承重反控：`saveHostExtensionSettings` **本体**不得发射', () => {
    // 本体若发射 ⇒ seedHostExtensionSettings 分支（启动期）也会发 ⇒ 变成"启动即发 settings_updated"，
    // 而基准此时发的是 settings_loaded_after ⇒ 违反 L36「时机也要对」。
    const base = src.indexOf('export function saveHostExtensionSettings(')
    const debounced = src.indexOf('export function saveHostExtensionSettingsDebounced(')
    expect(base).toBeGreaterThan(-1)
    expect(debounced).toBeGreaterThan(base)
    expect(src.slice(base, debounced)).not.toContain("'settings_updated'")
  })

  it('发射点紧跟落盘调用（不是"先发后写"）', () => {
    const m = src.match(/saveHostExtensionSettings\(pending\)\s*\n\s*emitThEventToFrames\('settings_updated', \[\]\)/g)
    expect(m).not.toBeNull()
    expect(m?.length).toBe(2)
  })

  it('广播式（不传 sessionId）：settings 是全局的，不属于某个会话', () => {
    expect(src.match(/emitThEventToFrames\('settings_updated', \[\]\)/g)?.length).toBe(2)
    expect(src).not.toContain("emitThEventToFrames('settings_updated', [], sessionId)")
  })
})

describe('RpScriptHost：注册表随 runtime 建/毁同步', () => {
  const src = read('RpScriptHost.tsx')

  it('建立 runtime 时登记，销毁时摘除（漏摘 = 向已死 runtime 投递）', () => {
    expect(src).toContain('registerFrameEmitter(sessionId,')
    expect(src).toContain('unregisterFrameEmitter(sid)')
    const iReg = src.indexOf('registerFrameEmitter(sessionId,')
    const iRt = src.indexOf('runtimes.set(sessionId, created)')
    expect(iRt).toBeGreaterThan(-1)
    expect(iReg).toBeGreaterThan(iRt) // 先入册再登记（登记闭包引用 created）
  })

  it('负控：换会话销毁旧 runtime 的分支也必须摘除', () => {
    expect(src).toMatch(/if \(sid !== sessionId\) \{ rt\.destroy\(\); runtimes\.delete\(sid\); unregisterFrameEmitter\(sid\) \}/)
  })
})
