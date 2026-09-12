/**
 * 宿主页 → 脚本帧 的 ST 事件投递注册表（T-80 心跳 74）
 * ============================================================================
 * 为什么需要它（**架构事实**，不是设计偏好）：
 *   卡脚本跑在 `about:srcdoc` iframe 里，它注册的 `eventSource` / `eventOn` 挂在
 *   **帧内**那份 `th-shim` 实现上；宿主页的 `th-event-source.ts` 是**另一份**实例
 *   （该模块头注已明说："宿主侧（host-vendor）直接用；iframe 侧的 th-shim … 暂仍用其内部实现"）。
 *   ⇒ **在宿主 event source 上 emit 永远到不了卡**。唯一通道 = `RpScriptHost` 的
 *   `emitSessionEvent()`（逐帧 `postMessage`，含"未就绪则入队、running 后补投"）。
 *
 * 为什么做成**叶子模块**而不是直接从 `RpScriptHost.tsx` 导出：
 *   `RpScriptHost.tsx` 依赖 `host-macro-bridge` 等；若 `host-vendor.ts` 反过来 import 它，
 *   会形成 import 环（esbuild 打包 + TDZ 风险）。本模块**零依赖**，两侧都只依赖它。
 *
 * 使用者：
 *   · 注册：`RpScriptHost.tsx`（runtime 建/毁时同步）
 *   · 投递：`RpPresetSwitch.tsx`（预设切换）、`host-vendor.ts`（设置落盘）
 */
export type ThFrameEmitter = (eventType: string, args: unknown[]) => void

const emitters = new Map<string, ThFrameEmitter>()

/** runtime 建立时登记（sessionId 唯一） */
export function registerFrameEmitter(sessionId: string, fn: ThFrameEmitter): void {
  emitters.set(sessionId, fn)
}

/** runtime 销毁时摘除（漏摘 ⇒ 向已死 runtime 投递） */
export function unregisterFrameEmitter(sessionId: string): void {
  emitters.delete(sessionId)
}

/**
 * 向脚本帧投递一个 ST 事件。
 *
 * - 给定 `sessionId` ⇒ 只投该会话（会话内动作，如预设切换）；
 * - `sessionId` 为 `null`/`undefined` ⇒ **广播**到全部在册会话（全局动作，如设置落盘）。
 *
 * 返回实际投递到的 runtime 数（**供探针/单测断言**，不是给业务用的）。
 * 无在册 runtime 时静默返回 0 —— 与"帧还没起来"同义，`RpScriptHost` 侧会入队补投。
 */
export function emitThEventToFrames(
  eventType: string,
  args: unknown[] = [],
  sessionId?: string | null,
): number {
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    const fn = emitters.get(sessionId)
    if (fn === undefined) return 0
    fn(eventType, args)
    return 1
  }
  let n = 0
  for (const fn of emitters.values()) { fn(eventType, args); n++ }
  return n
}

/** 在册会话数（探针/单测用） */
export function frameEmitterCount(): number {
  return emitters.size
}

/** 清空注册表（仅测试/探针用） */
export function resetFrameEmitters(): void {
  emitters.clear()
}
