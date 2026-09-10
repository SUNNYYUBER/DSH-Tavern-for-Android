/**
 * `SillyTavern.getContext().eventSource` 单一实现（T-39，2026-09-11）
 * ============================================================================
 * 为什么需要它（**设备实测**，不是推测）：
 *  - 真 ST 的 `getContext()` 返回体含 `eventSource`（ST 内部事件总线，`eventSource.on(event_types.X, fn)`）。
 *  - 设备 A/B（CDP `Runtime.exceptionThrown`，同一张卡、同一流程）：
 *      · 宿主页补 `SillyTavern` **之前** → 卡的外链注入脚本首行
 *        `const ctx = SillyTavern.getContext()` 直接 `ReferenceError`（inject.js:55），整段脚本作废。
 *      · 补上之后 → 同一脚本**推进 2190 行**，在
 *        `ctx.eventSource.on('module_imported', …)` 处抛
 *        `TypeError: Cannot read properties of undefined (reading 'on')`（inject.js:2245）。
 *        —— 该脚本里 `eventSource` 出现 **27 次**，是它的事件挂载总入口。
 *  - iframe 侧同样缺：`th-shim.ts` 有 `eventOn/eventOnce/eventEmit` 这套**函数式** API，
 *    但从未把它们包成 `eventSource` 对象暴露（实测脚本帧里 `eventSource === undefined`）。
 *
 * 语义对齐（逐条照 `th-shim.ts:593-648` 的真 TH 语义，勿凭印象简化）：
 *  - `on` / `once` 对**同一函数引用幂等**：重复注册不新增（原实现无条件 push 会让
 *    初始化钩子被 CHAT_CHANGED 二次触发时副作用成倍放大——按钮/变量写双发，已在鲁棒轮修过）。
 *  - `makeFirst` / `makeLast` 是**移动**语义（先摘旧位再插首/尾），不是新增。
 *  - `emit` 按注册顺序**串行**调用并 await 返回值；单监听器抛错**不扩散**（console.error 记名），
 *    否则一个坏监听器会掀掉整条事件链。
 *  - 返回 `{ stop }` 句柄（与真 TH `EventOnReturn` 同形），脚本普遍 `const h = eventOn(...); h.stop()`。
 *
 * 单源说明：本模块是**唯一**发射器实现。宿主侧（host-vendor）直接用；iframe 侧的 th-shim
 * 因架构原因（整段 shim 是构建期拼进 iframe 的字符串，无法 import TS 模块）暂仍用其内部
 * 函数式实现 —— 两侧若要合并，需先把 shim 改成「注入式装配」，记为后续项，勿在此处再抄一份。
 */

export type ThEventListener = (...args: unknown[]) => unknown

export interface ThEventStopHandle {
  stop: () => void
}

export interface ThEventSource {
  on: (event: string, listener: ThEventListener) => ThEventStopHandle
  once: (event: string, listener: ThEventListener) => ThEventStopHandle
  makeFirst: (event: string, listener: ThEventListener) => ThEventStopHandle
  makeLast: (event: string, listener: ThEventListener) => ThEventStopHandle
  off: (event: string, listener: ThEventListener) => void
  removeListener: (event: string, listener: ThEventListener) => void
  clearEvent: (event: string) => void
  clearAll: () => void
  clearListener: (listener: ThEventListener) => number
  emit: (event: string, ...args: unknown[]) => Promise<void>
  emitAndWait: (event: string, ...args: unknown[]) => Promise<void>
  listenerCount: (event?: string) => number
}

interface Entry {
  fn: ThEventListener
  once: boolean
  ord: number
}

/** 创建一枚与真 ST/TH `eventSource` 同语义的发射器 */
export function createThEventSource(
  onError: (event: string, error: unknown) => void = (event, error) => {
    console.error(`[dsht-th] eventSource 监听器异常(${event}):`, error)
  },
): ThEventSource {
  const listeners = new Map<string, Entry[]>()
  let seq = 0

  const list = (event: string): Entry[] => {
    const key = String(event)
    const found = listeners.get(key)
    if (found !== undefined) return found
    const created: Entry[] = []
    listeners.set(key, created)
    return created
  }

  const remove = (event: string, fn: ThEventListener): void => {
    const arr = listeners.get(String(event))
    if (arr === undefined) return
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i] !== undefined && arr[i]!.fn === fn) arr.splice(i, 1)
    }
  }

  /** 幂等注册：同一函数引用已在监听 → 原样返回句柄，不新增 */
  const add = (event: string, fn: ThEventListener, once: boolean, first: boolean, last: boolean): ThEventStopHandle => {
    const evt = String(event)
    const arr = list(evt)
    for (const entry of arr) {
      if (entry.fn === fn) return { stop: () => { remove(evt, fn) } }
    }
    const entry: Entry = { fn, once, ord: ++seq }
    if (first) arr.unshift(entry)
    else if (last) arr.push(entry)
    else arr.push(entry)
    return { stop: () => { remove(evt, fn) } }
  }

  const emit = async (event: string, ...args: unknown[]): Promise<void> => {
    const evt = String(event)
    const snapshot = (listeners.get(evt) ?? []).slice()
    for (const entry of snapshot) {
      // 快照后可能已被移除（前一个监听器调了 clearEvent）→ 跳过，不留半执行
      const cur = listeners.get(evt)
      if (cur === undefined || !cur.includes(entry)) continue
      try {
        await entry.fn(...args)
      } catch (e) {
        onError(evt, e) // 单监听器失败不扩散（坏一个不能掀整条链）
      }
      if (entry.once) remove(evt, entry.fn)
    }
  }

  return {
    on: (event, listener) => add(event, listener, false, false, false),
    once: (event, listener) => add(event, listener, true, false, false),
    makeFirst: (event, listener) => { remove(event, listener); return add(event, listener, false, true, false) },
    makeLast: (event, listener) => { remove(event, listener); return add(event, listener, false, false, true) },
    off: (event, listener) => { remove(event, listener) },
    removeListener: (event, listener) => { remove(event, listener) },
    clearEvent: (event) => { listeners.delete(String(event)) },
    clearAll: () => { listeners.clear() },
    clearListener: (listener) => {
      let removed = 0
      for (const arr of listeners.values()) {
        for (let i = arr.length - 1; i >= 0; i -= 1) {
          if (arr[i] !== undefined && arr[i]!.fn === listener) { arr.splice(i, 1); removed += 1 }
        }
      }
      return removed
    },
    emit,
    emitAndWait: emit,
    listenerCount: (event) => {
      if (event === undefined) {
        let n = 0
        for (const arr of listeners.values()) n += arr.length
        return n
      }
      return (listeners.get(String(event)) ?? []).length
    },
  }
}
