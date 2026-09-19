/**
 * 【2026-09-14 轨道 A / L4 穷举】旧 WebView 现代 API 守卫（单一事实来源）。
 *
 * ## 为什么放在 dsht-plugin-shared（而不是某个 client 包里）
 * 两个独立的 client bundle 都需要它：`dsht-rp-ui/lib/client.js` 与
 * `dsht-plugin-mobile/lib/client.js`。它们**各自加载、顺序不定**，不能假设对方先跑过。
 * 若把实现放在任一包里、让另一个包跨包 `../../其它包/...` 相对导入，就会形成
 * 「插件包之间互相耦合」——这正是 F5 收口时踩过的坑（见 `rp-workspace.ts` 头注的
 * 架构倒置教训）。故下沉到共享层，两侧共同 import（P-1b：共享逻辑必须 import 同一模块）。
 *
 * ## 为什么需要这个模块
 * L4 必测项是「旧 WebView API 缺口穷举（含 typeof 陷阱系统扫描）」。穷举结论暴露了
 * 一类**系统性缺陷**：同一个 API 在本仓有守卫、无守卫**混用**——
 *
 * | API | 已有守卫的地方 | 漏守卫的地方 |
 * |---|---|---|
 * | `crypto.randomUUID` | host-vendor.ts / th-shim.ts / RpNativeChat.tsx:1008 | index.tsx:372、RpNativeChat.tsx:1974/1990 |
 * | `Array.prototype.at` | （无） | display-compiler.ts:237/500（**显示渲染主路径**） |
 * | `structuredClone` | th-shim 用 JSON 兜底绕开 | RpScriptHost.tsx:182 |
 * | `Object.hasOwn` | （无） | host-st-surface.ts:92 |
 * | `queueMicrotask` | （无） | chat-windowing.ts:241/425 |
 *
 * 「同一语义有守卫和无守卫两份写法」正是 P-1（单一事实来源）的反例：守卫是**能力契约**，
 * 能力契约散落在各调用点 ⇒ 新增代码时是否加守卫全凭记性，必然漏（本轮实测：漏了 8 处）。
 *
 * ## 处置口径（为什么在安装期统一补，而不是逐点改调用写法）
 * 这些缺口都是**老内核缺全局 API**，不是「不同调用点需要不同语义」。故正确做法是
 * **安装期做一次能力补齐**（polyfill），此后**所有调用点都无需再写守卫**——
 * 这也是最不容易漏的形态（调用点零心智负担）。
 *
 * 与本模块同源的既有实现 `ensureAbortSignalAny()`（原在 `dsht-rp-ui/client/index.tsx`）
 * 已一并收进来，使「WebView 能力补齐」只有一个入口。
 *
 * ## 边界（不做什么）
 * - **不**给卡脚本 iframe 提供 polyfill：那是**卡自己的运行环境**，我方 shim 只负责
 *   API 门面与桥接（见 `th-shim.ts` 头注）；给卡面注 polyfill 会污染卡的行为预期。
 *   卡脚本自身的新 API 需求属「卡作者侧」（goal 边界 B3），不在本模块范围。
 * - **不**改 `es2022` 构建目标（`??` / `?.` 等**语法**缺失 → SyntaxError，无法用
 *   polyfill 救，只能靠最低内核声明 + 启动期提示；已在 MainActivity 有 Toast 提示）。
 *
 * ## 可测性
 * 全部逻辑只依赖 `globalThis` 上的**可注入形状**，单测可传桩对象驱动，
 * 不需真 DOM / 真 WebView（见 `packages/tests/webview-api-guard.spec.ts`）。
 */

/** 由 ensureWebviewApiGuard 返回：本次实际补了哪些 API（用于留痕与测试断言） */
export interface GuardReport {
  /** 补上的 API 名（空数组 = 环境已完备，零改动） */
  polyfilled: string[]
  /** 环境缺什么（诊断用；供可观测性面板展示） */
  missing: string[]
}

/** 最小可注入的全局形状（只声明我们探测/补的面） */
export interface GuardTarget {
  crypto?: { randomUUID?: unknown } | undefined
  structuredClone?: unknown
  queueMicrotask?: unknown
  AbortSignal?: { any?: unknown } | undefined
  Array?: { prototype?: Record<string, unknown> } | undefined
  Object?: { hasOwn?: unknown; prototype?: Record<string, unknown> } | undefined
  [k: string]: unknown
}

/** 极简 v4 UUID（仅在缺 crypto.randomUUID 时兜底；不追求密码学强度，只求格式正确） */
function fallbackUuid(g: GuardTarget): string {
  const c = g.crypto as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined
  const hex: string[] = []
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(16)
    c.getRandomValues(buf)
    for (const b of buf) hex.push(b.toString(16).padStart(2, '0'))
  } else {
    for (let i = 0; i < 32; i++) hex.push(Math.floor(Math.random() * 16).toString(16))
  }
  const s = hex.join('')
  // 版本位与变体位按 RFC 4122 固定（v4）
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`
}

/**
 * 安装期一次性补齐旧 WebView 缺的全局 API。
 *
 * **幂等**：已存在的能力一律不动（不覆盖、不包装），可重复调用。
 *
 * @param g 目标全局（缺省 `globalThis`；单测传桩）
 * @returns 本次补了什么 / 缺什么（**出声依据**：非空即证明环境不完备，调用方应 warn）
 */
export function ensureWebviewApiGuard(g: GuardTarget = globalThis as unknown as GuardTarget): GuardReport {
  const polyfilled: string[] = []
  const missing: string[] = []

  // ---- crypto.randomUUID（Chrome 92+）----
  const c = g.crypto as { randomUUID?: unknown } | undefined
  if (c === undefined) {
    missing.push('crypto')
  } else if (typeof c.randomUUID !== 'function') {
    c.randomUUID = () => fallbackUuid(g)
    polyfilled.push('crypto.randomUUID')
  }

  // ---- structuredClone（Chrome 98+）----
  if (typeof g.structuredClone !== 'function') {
    // 语义近似：JSON 深拷贝。**不覆盖** Map/Set/Date/undefined/循环引用等边缘 —
    // 本项目仅用它拷贝**变量树**（纯 JSON 结构，见 RpScriptHost 的 message 变量删除），
    // 那里语义完全够用；不假装成完整实现（诚实边界，写进注释而非悄悄降级）。
    g.structuredClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
    polyfilled.push('structuredClone')
  }

  // ---- queueMicrotask（Chrome 71+）----
  if (typeof g.queueMicrotask !== 'function') {
    const P = g.Promise as PromiseConstructor | undefined
    if (P === undefined) {
      missing.push('queueMicrotask（且无 Promise 可兜底）')
    } else {
      g.queueMicrotask = (fn: () => void): void => { void P.resolve().then(fn) }
      polyfilled.push('queueMicrotask')
    }
  }

  // ---- Object.hasOwn（Chrome 93+）----
  const O = g.Object as { hasOwn?: unknown; prototype?: Record<string, unknown> } | undefined
  if (O === undefined) {
    missing.push('Object')
  } else if (typeof O.hasOwn !== 'function') {
    O.hasOwn = (obj: unknown, key: PropertyKey): boolean =>
      Object.prototype.hasOwnProperty.call(obj, key)
    polyfilled.push('Object.hasOwn')
  }

  // ---- Array.prototype.at（Chrome 92+）----
  const AP = g.Array?.prototype
  if (AP === undefined) {
    missing.push('Array.prototype')
  } else if (typeof AP.at !== 'function') {
    AP.at = function at<T>(this: readonly T[], index: number): T | undefined {
      const len = this.length >>> 0
      const i = Math.trunc(index) || 0
      const k = i < 0 ? len + i : i
      if (k < 0 || k >= len) return undefined
      return this[k]
    }
    polyfilled.push('Array.prototype.at')
  }

  // ---- AbortSignal.any（Chrome 116+）----
  // 【收口】原先这份实现在 index.tsx 的 ensureAbortSignalAny()（@adapt
  // contract:webview.abort-signal-any）。能力补齐是**同一语义**，故统一到本模块，
  // 避免两处各写一份（P-1）。契约标记保留在本模块，index.tsx 只调用。
  const A = g.AbortSignal as { any?: unknown } | undefined
  if (A === undefined) {
    missing.push('AbortSignal')
  } else if (typeof A.any !== 'function') {
    A.any = (signals: readonly { aborted?: boolean; reason?: unknown; addEventListener?: (t: string, f: () => void) => void }[] | undefined) => {
      const controller = new AbortController()
      const onAbort = (): void => {
        try { controller.abort(controller.signal.reason) } catch { controller.abort() }
      }
      for (const s of signals ?? []) {
        if (s?.aborted === true) {
          try { controller.abort(s.reason) } catch { controller.abort() }
          break
        }
        s?.addEventListener?.('abort', onAbort)
      }
      return controller.signal
    }
    polyfilled.push('AbortSignal.any')
  }

  return { polyfilled, missing }
}
