/**
 * DSHTavern 设备能力插件（Cordis 插件，挂 DSH web profile 全局层）——W-3。
 *
 * 把「设备能力」（截屏 / 输入模拟 / 通知读取 / 系统状态）暴露为 DSH 工具，
 * 供 agent 调用。执行链：本插件 → [本机 HTTP] → native DeviceBridge → Shizuku(uid 2000)。
 *
 * ## 核心纪律（见 docs/W3-DEVICE-TOOLS-DESIGN-2026-09-21.md）
 * **命令构造固定在 native 中层**：本插件只发**枚举 op + 校验过的参数**（JSON），
 * **永不构造 shell 字符串**。依据是本项目的实证教训（W-2 调研 §6.3）：
 * 同一命令经多层转发得 87 条、直接执行得 29 条——「看起来完全正常」的假结论。
 *
 * ## 与 native 的连接
 * native（NodeService）经 env 传两个值：
 *   · `DSHT_DEVICE_PORT`  —— DeviceBridge 监听的 127.0.0.1 端口
 *   · `DSHT_DEVICE_TOKEN` —— 鉴权令牌（每次进程启动重新生成，不落盘）
 * 两者缺失 = 设备能力不可用（**不是错误**，如实降级——多数用户没装 Shizuku）。
 *
 * ## 失败语义（不把异常糊给 agent）
 * native 返回 `{ok:false, error:<枚举>, detail}`；本插件把枚举翻成**可处置的中文提示**
 * （如「需要 Shizuku」给出启动引导），而不是抛异常或返回 stack。
 */

export const name = 'dsht-plugin-device'
export const inject = ['tools', 'systemPrompt']

// ---------------------------------------------------------------------------
// 宿主服务最小面（与其它 dsht-plugin-* 同构，按需声明）
// ---------------------------------------------------------------------------

interface LikeToolRegistry {
  register: (def: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => unknown }
    isConcurrencySafe: () => boolean
    execute: (args: unknown, exec: unknown) => Promise<unknown>
  }) => void
}
interface LikeSystemPrompt {
  section: (def: { name: string; order: number; text: string }) => void
}
interface Ctx {
  tools: LikeToolRegistry
  systemPrompt: LikeSystemPrompt
}

// ---------------------------------------------------------------------------
// native 桥（HTTP 单请求；无 keep-alive）
// ---------------------------------------------------------------------------

/** 桥不可用的可读文案（W-2 验收口径：如实报「需要 Shizuku」而非崩溃）。 */
const BRIDGE_DOWN =
  '设备能力不可用：本机未启用设备桥（或未安装/未启动 Shizuku）。' +
  '请在 App 设置面板 → 设备能力 中查看状态。此功能不影响对话与终端。'

/** native 错误枚举 → 可处置的中文提示。 */
const ERR_TEXT: Record<string, string> = {
  NEED_SHIZUKU: '设备能力不可用：Shizuku 未安装/未启动/未授权。请打开 Shizuku 完成启动后在 App 内授权。',
  NOT_AUTHORIZED: '设备能力未授权：请在 App 设置面板 → 设备能力 中点击授权。',
  DENIED_BY_POLICY:
    '该操作属 danger 档（可操作其它应用），需要你显式批准；当前版本默认拒绝。' +
    '如需使用请等待守门人功能就绪，或改用只读类设备工具。',
  BAD_ARGS: '参数不合法（坐标/文本/枚举值越界），操作未执行。',
  NOT_IMPLEMENTED: '该设备操作尚未接入执行层（native 侧命令模板已就绪，等待 Shizuku 执行层）。',
  EXEC_FAILED: '设备命令执行失败（见 App 诊断面板日志）。',
}

interface DeviceResult {
  ok: boolean
  data?: unknown
  error?: string
  detail?: string
  via?: string
}

/**
 * 向 native 请求一次设备操作。
 *
 * 【为什么用 fetch 而不是子进程】native 侧已把命令构造与档位判定做在
 * DSH 看不穿的层——本插件只做「传参」，不做任何命令拼接。
 */
async function deviceRequest(op: string, args: Record<string, unknown>): Promise<DeviceResult> {
  const port = process.env.DSHT_DEVICE_PORT
  const token = process.env.DSHT_DEVICE_TOKEN
  if (!port || !token) return { ok: false, error: 'BRIDGE_DOWN', detail: BRIDGE_DOWN }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsht-token': token },
      body: JSON.stringify({ op, args }),
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    if (!res.ok && text.length === 0) {
      return { ok: false, error: 'EXEC_FAILED', detail: `设备桥返回 HTTP ${res.status}` }
    }
    return JSON.parse(text) as DeviceResult
  } catch (t) {
    return {
      ok: false,
      error: 'EXEC_FAILED',
      detail: `设备桥请求失败：${t instanceof Error ? t.message : String(t)}`,
    }
  }
}

/** 把 native 结果渲染成给 agent 的可读文本（永不抛）。 */
function renderResult(r: DeviceResult): string {
  if (r.ok) return JSON.stringify(r.data ?? { ok: true })
  const key = String(r.error ?? 'EXEC_FAILED')
  const base = ERR_TEXT[key] ?? `设备操作失败（${key}）`
  return r.detail ? `${base}\n细节：${r.detail}` : base
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------

/** 统一输出形态（文本）。 */
const outputText = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
}

export function apply(ctx: Ctx): void {
  // ---- 提示词段（与 dsh-plugin 的 tool:* 段同构）----
  ctx.systemPrompt.section({
    name: 'tool:device',
    order: 118,
    text:
      'Android 设备能力工具（device_*）：可截屏、读系统状态、读通知，以及在获得用户批准后模拟输入。' +
      '这些能力依赖用户设备上已安装并启动的 Shizuku；不可用时工具会返回可读的原因，不会崩溃。' +
      '操作其它应用（点击/滑动/输入）属危险操作，默认被拒绝。',
  })

  // ---- device_screenshot ----
  ctx.tools.register({
    name: 'device_screenshot',
    description:
      'Take a screenshot of the Android device screen. Returns the saved PNG path (user-visible in a file manager). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        display: { type: 'integer', description: 'Display id (0 = default). Range 0-9.' },
      },
      required: [],
      additionalProperties: false,
    },
    output: outputText,
    isConcurrencySafe: () => false,
    async execute(args) {
      const display = Number((args as { display?: unknown }).display ?? 0)
      const r = await deviceRequest('screencap', { display })
      return renderResult(r)
    },
  })

  // ---- device_status ----
  ctx.tools.register({
    name: 'device_status',
    description:
      'Read Android system status: battery, wifi, display or storage. Read-only, lowest risk.',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['battery', 'wifi', 'display', 'storage', 'all'],
          description: 'Which status to read (default battery).',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: outputText,
    isConcurrencySafe: () => true,
    async execute(args) {
      const what = String((args as { what?: unknown }).what ?? 'battery')
      const r = await deviceRequest('system_status', { what })
      return renderResult(r)
    },
  })

  // ---- device_notifications ----
  ctx.tools.register({
    name: 'device_notifications',
    description:
      'Read recent Android notifications (package, title, text). The system redacts sensitive fields by default. Contains private data — use only when the user asks about notifications.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max notifications to return (1-50, default 20).' },
      },
      required: [],
      additionalProperties: false,
    },
    output: outputText,
    isConcurrencySafe: () => true,
    async execute(args) {
      const limit = Number((args as { limit?: unknown }).limit ?? 20)
      const r = await deviceRequest('notifications', { limit })
      return renderResult(r)
    },
  })

  // ---- device_input ----
  // 【档位】danger-full-access ⇒ native 侧默认拒绝（fail-closed），等守门人就绪。
  // 工具仍然注册（让 agent 知道「有这个能力、但现在不可用」比完全隐藏更诚实——
  // 隐藏会让 agent 反复尝试别的路径，注册 + 明确拒绝让它一次得到准确答复）。
  ctx.tools.register({
    name: 'device_input',
    description:
      'Simulate user input on the Android device: tap, swipe, type text, or press a key. DANGEROUS — can operate other apps. Requires explicit user approval; currently denied by default.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['tap', 'swipe', 'text', 'key'],
          description: 'Input action to perform.',
        },
        x: { type: 'integer', description: 'X coordinate (tap) or start X (swipe).' },
        y: { type: 'integer', description: 'Y coordinate (tap) or start Y (swipe).' },
        x2: { type: 'integer', description: 'End X (swipe only).' },
        y2: { type: 'integer', description: 'End Y (swipe only).' },
        duration: { type: 'integer', description: 'Swipe duration in ms (0-10000).' },
        text: { type: 'string', description: 'Text to type (no control characters).' },
        key: {
          type: 'string',
          description: 'Key to press: one of HOME, BACK, ENTER, DEL, TAB, ESCAPE, DPAD_*, VOLUME_*, POWER, MENU, APP_SWITCH.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: outputText,
    isConcurrencySafe: () => false,
    async execute(args) {
      const a = args as Record<string, unknown>
      const action = String(a.action ?? '')
      switch (action) {
        case 'tap':
          return renderResult(await deviceRequest('input_tap', { x: a.x, y: a.y }))
        case 'swipe':
          return renderResult(
            await deviceRequest('input_swipe', {
              x1: a.x, y1: a.y, x2: a.x2, y2: a.y2, duration: a.duration,
            }),
          )
        case 'text':
          return renderResult(await deviceRequest('input_text', { text: a.text }))
        case 'key':
          return renderResult(await deviceRequest('input_key', { key: a.key }))
        default:
          return `未知 action：${action}（可用：tap / swipe / text / key）`
      }
    },
  })
}
