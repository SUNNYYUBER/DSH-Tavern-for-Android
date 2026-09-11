/**
 * host-st-surface.ts — 宿主页 ST 门面的「第二批」成员：i18n / 弹窗 / 函数工具注册
 * ============================================================================
 * 【为什么有这一批（方法学，2026-09-11 心跳 50）】
 *   T-37 → T-40 → T-41 → T-42 的推进是一条**串行**证明链：跑采集器 → 卡脚本崩在某行 →
 *   修那一个缺口 → 再跑 → 崩在更深的行（L35「错误往深处移」）。链有效但**极慢**：
 *   卡脚本「首个异常即整段作废」，所以每轮只能暴露一个缺口。
 *
 *   本批成员不是"再撞一次墙"撞出来的，而是
 *   `scripts/audit-card-context-surface.mjs` **一次性静态枚举**的结果 ——
 *   它把卡脚本对 `SillyTavern.getContext()` 的全部访问路径与**真 ST 权威面**
 *   （`SillyTavern-reference/public/scripts/st-context.js` 的 getContext 返回体）对质，
 *   列出「真 ST 有、我方宿主面没有」的全部成员（即**还没撞到的墙**）。
 *
 * 【证据纪律（L36 / L38）】
 *   每个成员的语义都**逐条抄自基准源码**（下方逐处标 `file:line`），不自创：
 *     · i18n         ← `public/scripts/i18n.js`
 *     · 弹窗常量/契约 ← `public/scripts/popup.js`
 *     · 工具注册     ← `public/scripts/tool-calling.js`（能力查询语义）
 *   **不假装成功**：实现不了的一律**显式拒绝并留痕**（见 `CROP` 弹窗与工具注册台账）。
 *
 * @module dsht-rp-ui/client/host-st-surface
 */

// ---------------------------------------------------------------------------
// 1) i18n —— 逐条对齐 `public/scripts/i18n.js`
// ---------------------------------------------------------------------------

/**
 * 真 ST：`getCurrentLocale()` = `String(localStorage['language'] || navigator.language || 'en').toLowerCase()`
 * （`i18n.js:6-15`）。storageKey 就是字符串 `'language'`（`i18n.js:4`）。
 */
export const I18N_LOCALE_LS_KEY = 'language'

export interface HostI18n {
  /** 模板字面量翻译：`t\`Tag ${name} not found.\``（`i18n.js:81-91`） */
  t: (strings: TemplateStringsArray, ...values: unknown[]) => string
  /** `translate(text, key=null)` → `localeData?.[key||text] || text`（`i18n.js:101-113`） */
  translate: (text: string, key?: string | null) => string
  /** 当前 locale（小写）（`i18n.js:15`） */
  getCurrentLocale: () => string
  /** 追加本地化数据（`i18n.js:22-38`）：localeId 不匹配则忽略；**已有键不覆盖** */
  addLocaleData: (localeId: string, data: Record<string, string>) => void
  /** 只测试/诊断用：当前已装载的本地化表 */
  __localeData: () => Record<string, string>
}

/**
 * 构造宿主 i18n 门面。
 *
 * **与真 ST 的两处刻意一致**（不是简化）：
 *  ① 「查不到就返回原文」——`translate` 的兜底是 `|| text`，缺键**不是错误**。
 *     我们不自带 ST 的翻译文件 → `localeData` 为空 → 语义上等价于 ST 的「未命中」。
 *  ② `addLocaleData` 只补**新键**、不覆盖已有键（`i18n.js:33-37`），
 *     且 localeId 与当前 locale 不符时只是忽略（`i18n.js:29-32`）。
 */
export function createHostI18n(): HostI18n {
  const localeData: Record<string, string> = {}
  const localeFile = (() => {
    let override: string | null = null
    try {
      if (typeof localStorage !== 'undefined') override = localStorage.getItem(I18N_LOCALE_LS_KEY)
    } catch { override = null }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    return String(override ?? nav?.language ?? 'en').toLowerCase()
  })()

  const translate = (text: string, key: string | null = null): string => {
    const translationKey = key ?? text
    if (translationKey === null || translationKey === undefined) return ''
    return localeData[translationKey] ?? text
  }

  return {
    // `i18n.js:81-91`：先把模板拼成带 `${i}` 占位符的键，翻译后再回填实参
    t: (strings, ...values) => {
      let str = ''
      for (let i = 0; i < strings.length; i += 1) {
        str += strings[i]
        if (values[i] !== undefined) str += `\${${i}}`
      }
      return translate(str).replace(/\$\{(\d+)\}/g, (m, index: string) => {
        const v = values[Number(index)]
        return v === undefined ? m : String(v)
      })
    },
    translate,
    getCurrentLocale: () => localeFile,
    addLocaleData: (localeId, data) => {
      if (String(localeId).toLowerCase() !== localeFile) return
      for (const [k, v] of Object.entries(data)) {
        if (!Object.hasOwn(localeData, k)) localeData[k] = v
      }
    },
    __localeData: () => localeData,
  }
}

// ---------------------------------------------------------------------------
// 2) 弹窗 —— 常量与返回契约逐条抄自 `public/scripts/popup.js`
// ---------------------------------------------------------------------------

/** `popup.js:9-22` */
export const POPUP_TYPE = {
  TEXT: 1,
  CONFIRM: 2,
  INPUT: 3,
  DISPLAY: 4,
  CROP: 5,
} as const

/** `popup.js:26-37` */
export const POPUP_RESULT = {
  AFFIRMATIVE: 1,
  NEGATIVE: 0,
  CANCELLED: null,
  CUSTOM1: 1001,
  CUSTOM2: 1002,
  CUSTOM3: 1003,
  CUSTOM4: 1004,
  CUSTOM5: 1005,
  CUSTOM6: 1006,
  CUSTOM7: 1007,
  CUSTOM8: 1008,
  CUSTOM9: 1009,
} as const

export interface PopupOptions {
  okButton?: string | boolean | null
  cancelButton?: string | boolean | null
  rows?: number
  placeholder?: string | null
  wide?: boolean
  wider?: boolean
  large?: boolean
  transparent?: boolean
  /** 未实现的长尾选项（tooltip/customInputs/cropAspect…）：**登记但不静默忽略** */
  [key: string]: unknown
}

/** 纯函数：按 ST 的按钮显隐规则算出控件计划（可单测，不依赖 DOM） */
export interface PopupControlPlan {
  showOk: boolean
  okLabel: string
  showCancel: boolean
  cancelLabel: string
  showInput: boolean
  showClose: boolean
  inputRows: number
  inputPlaceholder: string
  /** X 关闭按钮的解析值：ST 模板 `popup-button-close` 写的是 `data-result="0"` → **NEGATIVE** */
  closeResult: number
}

/**
 * 各类型的默认控件（**逐条抄自基准，不是照文档猜的**）：
 *  · `popup.js:454-501` 的 switch 分支决定显隐
 *  · `popup.js:271-274` 先落初值（OK / `popup-button-cancel`），再由类型分支覆盖文案
 *  · `index.html:6456` 的 `popup_template` 给文案值：
 *    `popup-button-save="Save"` / `yes="Yes"` / `no="No"` / `cancel="Cancel"` / `crop="Crop"`
 *    （**没有** `popup-button-ok` 属性 → OK 的初值就是代码里写死的 `'OK'`）
 *
 * ⚠️ 一个反直觉但必须一致的点：`okButton: true` **不会**触发文案覆盖
 * （ST 的条件是 `if (!okButton)`，`true` 是 truthy）→ CONFIRM 传 `true` 时按钮仍是 `'OK'`，
 * 只有传 `undefined/null` 才是 `'Yes'`。首版按"文档直觉"写成一律 'OK'/'Cancel'，
 * 与基准在 INPUT 的 Cancel 显隐、CONFIRM 的 Yes/No 文案两处都不一致 —— 已按源码纠正。
 */
const POPUP_TYPE_DEFAULTS: Record<number, {
  okLabel: string; cancelLabel: string; input: boolean; close: boolean
}> = {
  [POPUP_TYPE.TEXT]: { okLabel: 'OK', cancelLabel: 'Cancel', input: false, close: false },
  [POPUP_TYPE.CONFIRM]: { okLabel: 'Yes', cancelLabel: 'No', input: false, close: false },
  [POPUP_TYPE.INPUT]: { okLabel: 'Save', cancelLabel: 'Cancel', input: true, close: false },
  [POPUP_TYPE.DISPLAY]: { okLabel: 'OK', cancelLabel: 'Cancel', input: false, close: true },
  [POPUP_TYPE.CROP]: { okLabel: 'Crop', cancelLabel: 'Cancel', input: false, close: false },
}

export function planPopupControls(type: number, options: PopupOptions = {}): PopupControlPlan {
  const def = POPUP_TYPE_DEFAULTS[type] ?? POPUP_TYPE_DEFAULTS[POPUP_TYPE.TEXT]
  const isDisplay = type === POPUP_TYPE.DISPLAY

  // 显隐：TEXT 的 Cancel 只在 truthy 时显示（`if (!cancelButton) hide`）；
  // 其余类型是 `cancelButton !== false` 即显示；DISPLAY 主按钮全隐、只留 X。
  const showOk = isDisplay ? false : options.okButton !== false
  const showCancel = isDisplay ? false
    : type === POPUP_TYPE.TEXT ? Boolean(options.cancelButton)
      : options.cancelButton !== false

  // 文案：字符串优先；`true` 走代码初值；`undefined/null` 走类型默认
  const okLabel = typeof options.okButton === 'string' ? options.okButton
    : options.okButton === true ? 'OK' : def.okLabel
  const cancelLabel = typeof options.cancelButton === 'string' ? options.cancelButton
    : options.cancelButton === true ? 'Cancel' : def.cancelLabel

  return {
    showOk,
    okLabel,
    showCancel,
    cancelLabel,
    showInput: def.input,
    showClose: def.close,
    inputRows: typeof options.rows === 'number' && options.rows > 0 ? options.rows : 1,
    inputPlaceholder: typeof options.placeholder === 'string' ? options.placeholder : '',
    closeResult: POPUP_RESULT.NEGATIVE,
  }
}

/** 未实现的长尾选项（登记用；出现即留痕，不静默） */
export const POPUP_UNSUPPORTED_OPTIONS = ['customInputs', 'cropAspect', 'onClosing', 'onOpen', 'allowEscapeClose'] as const

export interface HostPopupLedger {
  unsupportedTypes: string[]
  unsupportedOptions: string[]
}

const popupLedger: HostPopupLedger = { unsupportedTypes: [], unsupportedOptions: [] }

/** 只读：宿主弹窗的「未支持面」台账（诊断/验收用） */
export function getHostPopupLedger(): HostPopupLedger {
  return { unsupportedTypes: [...popupLedger.unsupportedTypes], unsupportedOptions: [...popupLedger.unsupportedOptions] }
}

/** 只测试用：清台账（避免用例间串味） */
export function __resetHostPopupLedger(): void {
  popupLedger.unsupportedTypes.length = 0
  popupLedger.unsupportedOptions.length = 0
}

/**
 * `callGenericPopup(content, type, inputValue, popupOptions)` —— 返回契约见 `popup.js:739-757`：
 *  · `INPUT` → 解析为输入串；否定 → `false`；取消 → `null`
 *  · 其余类型 → 解析为 `POPUP_RESULT` 数值（或自定义数值）
 *  · 关闭被 `onClosing` 拦下 → `undefined`（我们不支持 onClosing，故不会出现该分支）
 *
 * **诚实边界**：
 *  · `CROP` **不实现**（我们不含裁剪器）→ 显式 reject + 记台账，绝不返回假图片。
 *  · 未识别的 long-tail 选项**记台账**，不假装支持。
 */
export function callGenericPopup(
  content: string,
  type: number = POPUP_TYPE.TEXT,
  inputValue: string | null = null,
  popupOptions: PopupOptions = {},
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): Promise<string | number | boolean | null | undefined> {
  for (const opt of POPUP_UNSUPPORTED_OPTIONS) {
    if (popupOptions[opt] !== undefined && !popupLedger.unsupportedOptions.includes(opt)) {
      popupLedger.unsupportedOptions.push(opt)
      console.warn(`[dsht-host] callGenericPopup: 选项 "${opt}" 尚未支持（已登记，行为按缺省处理）`)
    }
  }
  if (type === POPUP_TYPE.CROP) {
    popupLedger.unsupportedTypes.push('CROP')
    return Promise.reject(new Error('[dsht-host] callGenericPopup: POPUP_TYPE.CROP 尚未支持（无裁剪器）——显式失败，不返回假图片'))
  }
  if (doc === undefined || doc.body === null) {
    return Promise.reject(new Error('[dsht-host] callGenericPopup: 宿主无可挂载的 document.body'))
  }
  return new Promise((resolve) => {
    const plan = planPopupControls(type, popupOptions)
    const overlay = doc.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px'
    const box = doc.createElement('div')
    const width = popupOptions.large === true ? '90vw' : popupOptions.wider === true ? 'min(880px,94vw)' : popupOptions.wide === true ? 'min(640px,92vw)' : 'min(460px,92vw)'
    box.style.cssText = `background:${popupOptions.transparent === true ? 'transparent' : 'rgba(28,30,34,.98)'};color:#eee;border-radius:10px;padding:16px;width:${width};max-height:80vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);position:relative;font-size:14px;line-height:1.6`
    box.innerHTML = String(content) // ST 语义：content 是 HTML（`popup.js` 直接写入弹窗体）

    if (plan.showClose) {
      const close = doc.createElement('button')
      close.textContent = '✕'
      close.title = '关闭'
      close.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#bbb;font-size:16px;cursor:pointer'
      // ST 模板 `popup-button-close` 的 `data-result="0"` → X 解析为 NEGATIVE
      close.addEventListener('click', () => finish(plan.closeResult))
      box.append(close)
    }

    let input: HTMLTextAreaElement | null = null
    if (plan.showInput) {
      // ST 的主输入控件**恒为 textarea**（`index.html:6464` `<textarea class="popup-input" rows="1">`），
      // 行数由 `rows` 选项给（默认 1）——不是"单行走 input、多行走 textarea"。
      input = doc.createElement('textarea')
      input.rows = plan.inputRows
      input.value = typeof inputValue === 'string' ? inputValue : ''
      if (plan.inputPlaceholder !== '') input.placeholder = plan.inputPlaceholder
      input.style.cssText = 'width:100%;box-sizing:border-box;margin:10px 0;padding:8px;border-radius:6px;border:1px solid #555;background:#1b1d21;color:#eee;font:inherit;resize:vertical'
      box.append(input)
    }

    const bar = doc.createElement('div')
    bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px'
    const mkBtn = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
      const b = doc.createElement('button')
      b.textContent = label
      b.style.cssText = `padding:7px 14px;border-radius:6px;cursor:pointer;font:inherit;border:1px solid ${primary ? '#6b8afd' : '#555'};background:${primary ? '#3a5bd9' : '#2c2f34'};color:#eee`
      b.addEventListener('click', onClick)
      return b
    }
    // 按钮顺序也与基准一致：`index.html:6473-6475` 的 `.popup-controls` 里
    // `popup-button-ok` 在前、`popup-button-cancel` 在后（首版反了 → 设备实测文案序列是
    // `No|Yes`，基线是 `Yes|No`）。
    if (plan.showOk) {
      bar.append(mkBtn(plan.okLabel, true, () => finish(type === POPUP_TYPE.INPUT ? (input?.value ?? '') : POPUP_RESULT.AFFIRMATIVE)))
    }
    if (plan.showCancel) {
      bar.append(mkBtn(plan.cancelLabel, false, () => finish(type === POPUP_TYPE.INPUT ? false : POPUP_RESULT.NEGATIVE)))
    }
    if (plan.showOk || plan.showCancel) box.append(bar)

    const onKey = (e: KeyboardEvent): void => {
      // ST：ESC 走「取消关闭」通道（结果 = CANCELLED）；Enter 等价于默认结果 AFFIRMATIVE
      // （`popup.js:209` `defaultResult = POPUP_RESULT.AFFIRMATIVE`、`:656` 取 `data-result ?? defaultResult`）。
      if (e.key === 'Escape') finish(POPUP_RESULT.CANCELLED)
      else if (e.key === 'Enter' && !e.shiftKey) {
        finish(type === POPUP_TYPE.INPUT ? (input?.value ?? '') : POPUP_RESULT.AFFIRMATIVE)
      }
    }
    let done = false
    const finish = (value: string | number | boolean | null): void => {
      if (done) return
      done = true
      doc.removeEventListener('keydown', onKey)
      overlay.remove()
      resolve(value)
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(POPUP_RESULT.CANCELLED) })
    doc.addEventListener('keydown', onKey)
    overlay.append(box)
    doc.body.append(overlay)
    if (input !== null && plan.showInput) input.focus()
  })
}

// ---------------------------------------------------------------------------
// 3) 函数工具注册 —— 能力查询说真话 + 注册留痕（不造假成功）
// ---------------------------------------------------------------------------

export interface HostToolLedger {
  /** 卡脚本注册过的工具名（本次进程内） */
  registered: string[]
  /** 已提示过的工具名（避免每次 bootstrap 重复刷屏） */
  warned: string[]
}

const toolLedger: HostToolLedger = { registered: [], warned: [] }

/** 只读：宿主函数工具台账 */
export function getHostToolLedger(): HostToolLedger {
  return { registered: [...toolLedger.registered], warned: [...toolLedger.warned] }
}

/** 只测试用：清台账 */
export function __resetHostToolLedger(): void {
  toolLedger.registered.length = 0
  toolLedger.warned.length = 0
}

export interface HostToolManager {
  registerFunctionTool: (tool: { name?: unknown } | null | undefined, ...rest: unknown[]) => void
  unregisterFunctionTool: (name: string) => void
  isToolCallingSupported: () => boolean
  canPerformToolCalls: () => boolean
  ToolManager: unknown
}

/**
 * 宿主函数工具管理器。
 *
 * 🔴 **能力查询必须说真话**：DSHT 里卡脚本注册的函数工具**不会**进入模型可调用清单
 * （我方 LLM 侧的工具集由宿主决定，不接收宿主页注册）——所以
 * `isToolCallingSupported()` / `canPerformToolCalls()` 返回 **false**。
 * 这正是真 ST 的 `ToolManager.isToolCallingSupported` 的语义（**能力查询**，`tool-calling.js`）：
 * 说 true 而工具到不了模型 = 让卡脚本以为一切就绪 = 标准静默失败。
 *
 * `registerFunctionTool` 仍然**收下**注册（否则 `unregisterFunctionTool` 会抛、
 * 卡脚本的 `syncSPresetToolRegistrations()` 会中断），但**每个名字只提示一次**，
 * 让"注册了但不会生效"这件事**可见**而非静默。
 */
export function createHostToolManager(): HostToolManager {
  const register = (tool: { name?: unknown } | null | undefined): void => {
    const name = typeof tool?.name === 'string' && tool.name !== '' ? tool.name : '(未命名工具)'
    if (!toolLedger.registered.includes(name)) toolLedger.registered.push(name)
    if (!toolLedger.warned.includes(name)) {
      toolLedger.warned.push(name)
      console.warn(`[dsht-host] registerFunctionTool("${name}")：DSHT 暂不把宿主页注册的函数工具并入模型可调用清单 → 该工具不会生效（已登记，见 getHostToolLedger()）`)
    }
  }
  const unregister = (name: string): void => {
    const i = toolLedger.registered.indexOf(String(name))
    if (i >= 0) toolLedger.registered.splice(i, 1)
  }
  const mgr: HostToolManager = {
    registerFunctionTool: register,
    unregisterFunctionTool: unregister,
    isToolCallingSupported: () => false,
    canPerformToolCalls: () => false,
    ToolManager: undefined,
  }
  mgr.ToolManager = {
    registerFunctionTool: register,
    unregisterFunctionTool: unregister,
    isToolCallingSupported: mgr.isToolCallingSupported,
    canPerformToolCalls: mgr.canPerformToolCalls,
  }
  return mgr
}
