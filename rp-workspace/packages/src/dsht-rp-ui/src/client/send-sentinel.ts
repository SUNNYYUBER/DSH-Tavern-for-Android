/**
 * 发送哨兵（体检 2026-09-26 · P0-5）—— 「发消息没反应」的可观察性补丁。
 *
 * ## 背景（HEALTHCHECK-C §4.1）
 * 模拟器实测：composer 点发送 ⇒ 输入框清空（前端认为成功），但服务端
 * **零落盘**（无 user/message、无 turn-error）、logcat 无错误 —— 失败发生在
 * 宿主更早的层，turn-error 节点根本不产生，用户侧完全静默（R8 违例）。
 *
 * ## 判据锚（P-41：锚在我们自己的事实上，不猜宿主内部）
 * 插件后端在 `agent/pre-step`（一次发送真正进入生成管线的最深可观察点）记录
 * 心跳 `lastPulse`，经 `/rp/send-pulse` 暴露。前端在捕获到 composer 提交后
 * 延时查询：
 *   · `lastPulse.at >= 提交时刻` ⇒ 管线已接手 —— 静默退出（成功/失败由楼层与
 *     turn-error 呈现，那是已有通道，不重复报）。
 *   · 否则 ⇒ toast 出声：「消息可能没有发出」+ 指路（API Key / 时区）。
 *
 * ## 提交时刻怎么采样（零官方源修改，同 time-zone.ts 的原型补丁思路）
 * 包装 `window.fetch`：官方 composer 的提交通道最终经同源 `POST /api/…`
 * （DSH wire 信封）。包装层只记录「刚刚发生过一次 /api POST」的时间戳，
 * **不解析、不修改、不拦截**任何请求 —— 对 200/4xx/5xx 一概放行。
 * 幂等可卸载（P7）：拔掉本插件 = 包装消失，官方行为复位。
 *
 * ## 为什么是「软提示」而不是「断言失败」
 * pre-step 无心跳只证明「没进生成管线」，不能区分根因（凭据缺失 / 时区 / 宿主
 * 内部错误）。提示文案因此只陈述事实 + 给自查路径，不冒充诊断（P-17）。
 */

/** 最近一次「前端发出 /api POST」的本地时刻（ms）。 */
let lastApiPostAt = 0

/** 防抖：同一轮只提示一次（用户连续点击发送时避免 toast 刷屏）。 */
let lastNotifiedAt = 0

/** 提交后等待多久查询心跳（ms）。取 8s：C 组实测等待 8 秒仍零落盘可判静默。 */
const PULSE_DELAY_MS = 8000

/** 两次提示的最小间隔（ms）——10 分钟内不重复骚扰。 */
const NOTIFY_GAP_MS = 10 * 60 * 1000

export function installRpSendSentinel(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const w = window as typeof window & { fetch: typeof fetch; __dshtSendSentinelPatched?: boolean }
  if (w.__dshtSendSentinelPatched === true) return
  const original = w.fetch.bind(w)
  const patched: typeof fetch = (input, init) => {
    try {
      const method = String((init as { method?: string } | undefined)?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      // 只记录：同源 /api POST（DSH wire 通道）。不解析 body、不改写任何参数。
      if (method === 'POST' && (url.startsWith('/api/') || new URL(url, location.href).pathname.startsWith('/api/'))) {
        lastApiPostAt = Date.now()
        void schedulePulseCheck(lastApiPostAt)
      }
    } catch { /* 采样失败绝不影响请求本身 */ }
    return original(input, init)
  }
  w.fetch = patched
  w.__dshtSendSentinelPatched = true
}

/** 提交后延时查心跳：管线没接手 ⇒ toast 出声（去重）。 */
async function schedulePulseCheck(submittedAt: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, PULSE_DELAY_MS) })
  // 期间用户又提交了新消息 ⇒ 本查作废（最新一查会覆盖）
  if (lastApiPostAt !== submittedAt) return
  try {
    const { rpApi } = await import('./rpc.ts')
    const r = await rpApi<{ lastPulse: { at: number } | null; now: number }>('send-pulse')
    if (r.lastPulse !== null && r.lastPulse.at >= submittedAt) return // 管线接手，正常路径
    if (Date.now() - lastNotifiedAt < NOTIFY_GAP_MS) return // 静默期
    lastNotifiedAt = Date.now()
    const { showDomToast } = await import('./toast.ts')
    showDomToast(
      'error',
      '消息可能没有发出：生成管线没有收到这次提交。常见原因：① API Key 未配置（RP 面板「API 连接」一行会显示 ❌）；② 设备时区不是标准 IANA 名（需 Asia/Shanghai 这类）。请检查后重试；若反复出现，请反馈日志。',
    )
  } catch { /* 查询失败（插件不在/网络断）保持静默 —— 此时没有可靠事实可呈现（P-17） */ }
}
