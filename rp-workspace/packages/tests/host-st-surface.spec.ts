/**
 * 宿主面第二批成员（心跳 50）测试。
 *
 * 判据来源分两类（**断言行为，不断言形状假设** —— L37）：
 *  · 语义类：逐条抄自基准源码，断言"基准怎么做我们就怎么做"
 *    （`i18n.js` / `popup.js` / `tool-calling.js`）
 *  · 反静默类：断言"实现不了时**不假装成功**"（CROP 拒绝 + 台账留痕；
 *    工具能力查询返回 false 而非 true）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetHostPopupLedger, __resetHostToolLedger, POPUP_RESULT, POPUP_TYPE,
  callGenericPopup, createHostI18n, createHostToolManager, getHostPopupLedger,
  getHostToolLedger, planPopupControls,
} from '../src/dsht-rp-ui/src/client/host-st-surface.ts'
import {
  __resetHostStCaches, __resetHostSurfaceSingletons, buildHostStContext,
  flushHostExtensionSettings, saveHostExtensionSettings,
} from '../src/dsht-rp-ui/src/client/host-vendor.ts'

beforeEach(() => {
  __resetHostPopupLedger()
  __resetHostToolLedger()
  __resetHostStCaches()
  __resetHostSurfaceSingletons()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('popup 常量（抄自 popup.js:9-37）', () => {
  it('POPUP_TYPE 与基准逐值一致', () => {
    expect(POPUP_TYPE.TEXT).toBe(1)
    expect(POPUP_TYPE.CONFIRM).toBe(2)
    expect(POPUP_TYPE.INPUT).toBe(3)
    expect(POPUP_TYPE.DISPLAY).toBe(4)
    expect(POPUP_TYPE.CROP).toBe(5)
  })

  it('POPUP_RESULT 与基准逐值一致（含 CANCELLED === null）', () => {
    expect(POPUP_RESULT.AFFIRMATIVE).toBe(1)
    expect(POPUP_RESULT.NEGATIVE).toBe(0)
    expect(POPUP_RESULT.CANCELLED).toBeNull()
    expect(POPUP_RESULT.CUSTOM1).toBe(1001)
    expect(POPUP_RESULT.CUSTOM9).toBe(1009)
  })
})

describe('按钮显隐与文案（逐条对齐 popup.js:454-501 + index.html:6456 模板）', () => {
  it('CONFIRM 默认两颗按钮，文案是 Yes / No（模板 popup-button-yes/no）', () => {
    const p = planPopupControls(POPUP_TYPE.CONFIRM)
    expect(p.showOk).toBe(true)
    expect(p.showCancel).toBe(true)
    expect(p.okLabel).toBe('Yes')
    expect(p.cancelLabel).toBe('No')
    expect(p.showInput).toBe(false)
    expect(p.showClose).toBe(false)
  })

  it('INPUT 默认显示输入框 + OK(Save) **且 Cancel 也显示**（基准是 `cancelButton !== false`）', () => {
    const p = planPopupControls(POPUP_TYPE.INPUT)
    expect(p.showInput).toBe(true)
    expect(p.showOk).toBe(true)
    expect(p.okLabel).toBe('Save')
    expect(p.showCancel).toBe(true) // ← 首版在这里与基准不一致（错把 Cancel 默认隐藏了）
    expect(p.cancelLabel).toBe('Cancel')
  })

  it('TEXT：Cancel 只在 truthy 时显示；默认文案 OK', () => {
    expect(planPopupControls(POPUP_TYPE.TEXT).showCancel).toBe(false)
    expect(planPopupControls(POPUP_TYPE.TEXT).okLabel).toBe('OK')
    expect(planPopupControls(POPUP_TYPE.TEXT, { cancelButton: true }).showCancel).toBe(true)
    expect(planPopupControls(POPUP_TYPE.TEXT, { cancelButton: '取消' }).cancelLabel).toBe('取消')
  })

  it('DISPLAY 主按钮全隐、只留 X；X 的解析值是 NEGATIVE(0)（模板 data-result="0"）', () => {
    const p = planPopupControls(POPUP_TYPE.DISPLAY)
    expect(p.showOk).toBe(false)
    expect(p.showCancel).toBe(false)
    expect(p.showClose).toBe(true)
    expect(p.closeResult).toBe(POPUP_RESULT.NEGATIVE)
  })

  it('string 文案 → 自定义且强制显示；false → 强制隐藏', () => {
    const custom = planPopupControls(POPUP_TYPE.DISPLAY, { okButton: '覆盖并改名', cancelButton: '取消' })
    expect(custom.showOk).toBe(false) // DISPLAY 主按钮恒隐（基准 `buttonControls.style.display='none'`）
    expect(custom.okLabel).toBe('覆盖并改名')
    expect(custom.cancelLabel).toBe('取消')

    const confirmCustom = planPopupControls(POPUP_TYPE.CONFIRM, { okButton: '覆盖并改名', cancelButton: '取消' })
    expect(confirmCustom.showOk).toBe(true)
    expect(confirmCustom.okLabel).toBe('覆盖并改名')

    const forcedOff = planPopupControls(POPUP_TYPE.CONFIRM, { cancelButton: false })
    expect(forcedOff.showCancel).toBe(false)
  })

  it('`okButton: true` **不触发**文案覆盖（基准条件是 `if (!okButton)`）→ CONFIRM 仍是 OK', () => {
    const p = planPopupControls(POPUP_TYPE.CONFIRM, { okButton: true })
    expect(p.showOk).toBe(true)
    expect(p.okLabel).toBe('OK')
    // 只有 undefined/null 才落到类型默认 Yes
    expect(planPopupControls(POPUP_TYPE.CONFIRM, { okButton: null }).okLabel).toBe('Yes')
  })

  it('rows / placeholder 透传（主输入恒为 textarea，rows 默认 1）', () => {
    expect(planPopupControls(POPUP_TYPE.INPUT).inputRows).toBe(1)
    const p = planPopupControls(POPUP_TYPE.INPUT, { rows: 4, placeholder: '输入内容' })
    expect(p.inputRows).toBe(4)
    expect(p.inputPlaceholder).toBe('输入内容')
  })
})

describe('callGenericPopup 的诚实边界（不假装成功）', () => {
  it('CROP 显式 reject 并记台账（绝不返回假图片）', async () => {
    await expect(callGenericPopup('<p>x</p>', POPUP_TYPE.CROP)).rejects.toThrow(/CROP 尚未支持/)
    expect(getHostPopupLedger().unsupportedTypes).toContain('CROP')
  })

  it('未支持的长尾选项被登记（不静默忽略）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(callGenericPopup('<p>x</p>', POPUP_TYPE.CROP, null, { onClosing: () => true })).rejects.toThrow()
    expect(getHostPopupLedger().unsupportedOptions).toContain('onClosing')
  })

  it('无 DOM 环境时显式失败（不是静默挂起）', async () => {
    await expect(callGenericPopup('<p>x</p>', POPUP_TYPE.TEXT, null, {}, undefined))
      .rejects.toThrow(/无可挂载的 document.body/)
  })
})

describe('i18n（逐条对齐 i18n.js）', () => {
  it('translate 查不到键 → 返回原文（基准的 || text 兜底，不是错误）', () => {
    const i18n = createHostI18n()
    expect(i18n.translate('Tag not found.')).toBe('Tag not found.')
    expect(i18n.translate('原文', 'missing_key')).toBe('原文')
  })

  it('addLocaleData 只补新键、不覆盖已有键；localeId 不匹配则忽略', () => {
    const i18n = createHostI18n()
    const cur = i18n.getCurrentLocale()
    i18n.addLocaleData(cur, { a: 'A' })
    expect(i18n.translate('', 'a')).toBe('A')
    i18n.addLocaleData(cur, { a: 'A2', b: 'B' })
    expect(i18n.translate('', 'a')).toBe('A') // 已有键不被覆盖（i18n.js:33-37）
    expect(i18n.translate('', 'b')).toBe('B')
    i18n.addLocaleData('xx-xx', { c: 'C' })
    expect(i18n.translate('c', 'c')).toBe('c') // 不匹配 → 忽略
  })

  it('t 模板：${i} 占位符回填实参（i18n.js:81-91）', () => {
    const i18n = createHostI18n()
    const name = '小玉'
    expect(i18n.t`Tag ${name} not found.`).toBe('Tag 小玉 not found.')
    // ⚠️ 实参为 undefined 时基准**不加占位符**，于是 `literal ${undefined}` → `"literal "`
    //   （本用例首版把它写成期望 `literal ${undefined}` —— 拿错前提去套正确实现，
    //    正是 L37 记过的坑。已按基准 `i18n.js:82` 的 reduce 公式实测复核。）
    expect(i18n.t`literal ${undefined}`).toBe('literal ')
  })

  it('getCurrentLocale 返回小写（i18n.js:15）', () => {
    expect(createHostI18n().getCurrentLocale()).toBe(createHostI18n().getCurrentLocale().toLowerCase())
  })
})

describe('函数工具注册（能力查询说真话 + 注册留痕）', () => {
  it('isToolCallingSupported / canPerformToolCalls 返回 false（工具到不了模型就不说 true）', () => {
    const m = createHostToolManager()
    expect(m.isToolCallingSupported()).toBe(false)
    expect(m.canPerformToolCalls()).toBe(false)
  })

  it('注册收下但**可见**：同名只提示一次，台账可查', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = createHostToolManager()
    m.registerFunctionTool({ name: 'chat_squash' })
    m.registerFunctionTool({ name: 'chat_squash' })
    m.registerFunctionTool({ name: 'macro_nest' })
    expect(getHostToolLedger().registered.sort()).toEqual(['chat_squash', 'macro_nest'])
    expect(warn).toHaveBeenCalledTimes(2) // 每个名字只提示一次，不刷屏
    expect(String(warn.mock.calls[0][0])).toContain('不会生效')
  })

  it('unregister 移除登记，不抛（卡脚本的 syncSPresetToolRegistrations 依赖它不炸）', () => {
    const m = createHostToolManager()
    m.registerFunctionTool({ name: 'x' })
    expect(() => m.unregisterFunctionTool('x')).not.toThrow()
    expect(getHostToolLedger().registered).not.toContain('x')
  })

  it('未命名/异常入参不抛（只登记为占位名）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = createHostToolManager()
    expect(() => m.registerFunctionTool(undefined)).not.toThrow()
    expect(() => m.registerFunctionTool(null)).not.toThrow()
    expect(getHostToolLedger().registered).toContain('(未命名工具)')
    warn.mockRestore()
  })
})

describe('宿主门面接线（buildHostStContext）', () => {
  it('新成员全部就位且类型正确', () => {
    const ctx = buildHostStContext()
    expect(typeof ctx.t).toBe('function')
    expect(typeof ctx.translate).toBe('function')
    expect(typeof ctx.getCurrentLocale).toBe('function')
    expect(typeof ctx.addLocaleData).toBe('function')
    expect(ctx.POPUP_TYPE).toBe(POPUP_TYPE)
    expect(ctx.POPUP_RESULT).toBe(POPUP_RESULT)
    expect(typeof ctx.callGenericPopup).toBe('function')
    expect(typeof ctx.registerFunctionTool).toBe('function')
    expect(typeof ctx.unregisterFunctionTool).toBe('function')
    expect((ctx.isToolCallingSupported as () => boolean)()).toBe(false)
    expect((ctx.canPerformToolCalls as () => boolean)()).toBe(false)
    expect(ctx.isMobile).toBe(true)
    expect(typeof ctx.saveSettingsDebounced).toBe('function')
    expect(ctx.event_types).toBe(ctx.eventTypes) // 旧蛇形别名与 eventTypes 同源
  })

  it('单例身份稳定：两次取门面拿到同一枚 t / ToolManager（脚本 off/!== 才成立）', () => {
    const a = buildHostStContext()
    const b = buildHostStContext()
    expect(a.t).toBe(b.t)
    expect(a.ToolManager).toBe(b.ToolManager)
    expect(a.POPUP_TYPE).toBe(b.POPUP_TYPE)
  })

  it('saveSettingsDebounced 防抖后真的落盘，且**保持 extensionSettings 引用稳定**', () => {
    vi.useFakeTimers()
    try {
      const ctx = buildHostStContext()
      const ext = ctx.extensionSettings as Record<string, unknown>
      ext.myKey = 'myValue'
      ;(ctx.saveSettingsDebounced as () => void)()
      flushHostExtensionSettings()
      vi.runAllTimers()
      // 重新取门面：引用必须还是同一枚对象（否则已持有旧引用的脚本会看到改动消失）
      const again = buildHostStContext()
      expect(again.extensionSettings).toBe(ext)
      expect((again.extensionSettings as Record<string, unknown>).myKey).toBe('myValue')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saveHostExtensionSettings 写坏数据不抛（脚本只期望尽力持久化）', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => saveHostExtensionSettings(cyclic)).not.toThrow()
  })
})
