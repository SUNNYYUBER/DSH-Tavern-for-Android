/**
 * 数据通道：DSH 原生前端内运行的 RP 组件与宿主通信。
 *
 * - dshRpc：同源 POST /api/<method>（DSH wire 信封；页面本身就在 DSH web
 *   服务上，信任栅栏天然放行——与原生 connection 包同一通道）
 * - rpApi：dsht-rp-plugin 的 webServer 前缀路由 /dsht-rp/*（T2.5f：
 *   同源、零端口冲突、无 CORS——旧 3081 独立端口方案已废弃）
 */

export interface RpWorkspaceInfo {
  slug: string
  name: string
  bookCount: number
  books: Array<{ name: string; lorePath: string }>
  firstMes: string
  /** 备选开场白（PROJECT_PLAN 补全）：/rp/workspaces 读 card.json 的
   * data.alternate_greetings / alternate_greetings 增补；旧插件缺字段按无备选 */
  alternateGreetings?: string[]
  /** rp.json outputProtocol 全字段（旧工作区可能只有前三个——withDefaults 补齐） */
  outputProtocol: {
    actionTags: string[]
    wrapTags: string[]
    statusTags: string[]
    collapsibleTags?: string[]
    stateUpdateTags?: string[]
    reasoningTags?: string[]
    foreshadowingTags?: string[]
  }
}

let rpcSeq = 0

/**
 * DSH RPC 业务错误（`{ok:false, error:{code,message,details}}` 信封的完整还原）。
 *
 * 【心跳 59 · T-57】为什么不能让调用方只拿到 `Error(message)`：
 * gateway 把**业务失败也包进 HTTP 200**，因此 `!resp.ok` 那条分支永不触发；
 * 原实现只取 `error.message` → **`error.code` 被彻底丢弃** →
 * 调用方无法区分「服务暂不可用（**等一下会自愈**）」与「会话不存在（**重试也没用**）」，
 * 只能把两者都当普通失败处理。
 *
 * 实例证据（心跳 57 实测）：
 * `session/list` 在 `sessionController` 服务非 ACTIVE 期间回
 * `{code:'gateway/service-unavailable', message:'typert gateway: session/list: active Service "sessionController" is unavailable'}`。
 * 该服务由 cordis fiber 承载，**依赖重新可用时会自动 `_reload()`**
 *（`cordis/src/fiber.ts:688-695`）→ 属「**可自愈、值得重试**」的一类；
 * 而 `session/not-found` 之类重试无意义。二者必须可区分。
 *
 * `extends Error` ⇒ 既有 `(e as Error).message` 调用点**零改动**仍工作（向后兼容）。
 */
export class DshRpcError extends Error {
  /** gateway 错误码（如 `gateway/service-unavailable`）；信封缺 code 时为 undefined */
  readonly code: string | undefined
  /** 出错的 RPC 方法（斜杠式，如 `session/list`） */
  readonly method: string

  constructor(method: string, code: string | undefined, message: string) {
    super(message)
    this.name = 'DshRpcError'
    this.method = method
    this.code = code
  }
}

/**
 * 该错误是否属于「**宿主服务暂不可用、稍后可自愈**」一类（心跳 59 · T-57）。
 *
 * 判据 = gateway 的 `service-unavailable` 码。这类失败**不是**调用方参数错、
 * 也**不是**目标不存在 —— 是承载该服务的 cordis fiber 暂时离开 ACTIVE
 *（依赖服务重载窗口）。框架在依赖恢复时会自动重新激活，故**值得重试**。
 */
export function isServiceUnavailable(e: unknown): boolean {
  return e instanceof DshRpcError && e.code === 'gateway/service-unavailable'
}

/**
 * 【D5 2026-09-13】把技术性错误翻译成「用户能懂、能行动」的中文。
 * 【F1 2026-09-14】扩展为**通用的「官方内部实现细节隔离」机制**。
 *
 * 背景：全项目只有 `isServiceUnavailable` 一个翻译点（rpc.ts:72），其余错误
 * **原样透传服务端 message** ⇒ 用户可能看到 `HTTP 500` / `unknown endpoint` /
 * `scriptId required` 这类英文技术串，既看不懂也不知道该做什么。
 *
 * 【F1 新增·为什么需要「隔离」而不只是「翻译」】用户实测看到的
 * `pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"`
 * 是**官方包内部字面量**（`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1394` 的
 * `mapStopReason`）——把第三方 SDK 名（`@earendil-works/pi-ai`）拼进了面向用户的
 * 错误文案。我们**不能改官方源码**（合规红线），所以必须在我方 UI 层做隔离：
 *   ① 把内部包名/SDK 名/类名/文件路径 **替换**成用户能懂的表述；
 *   ② 原文**折叠进详情**（不丢信息，排障仍可用）；
 *   ③ 机制做成**模式驱动**（见 INTERNAL_LEAK_RULES），新发现的泄漏形态
 *      往表里加一条即可，不需要逐个字符串打补丁。
 *
 * 口径：**只在能给出更好说法时替换**；无法归类的一律保留原文并加前缀，
 * 绝不吞掉原始信息（否则排障时无从下手）。
 */
export function humanizeError(e: unknown): string {
  if (e === null || e === undefined) return '未知错误'
  const err = e as { message?: string; code?: string; name?: string }
  const raw = err?.message ?? String(e)
  const code = err?.code ?? ''

  // 0. 【F1 / E4】官方错误码表 —— **结构化信号最可靠**，因此排在模式匹配之前。
  //    官方 code 是稳定枚举（`@deepseek-ai/dsh-llm` 的 *_CODE 常量），
  //    而 message 措辞会随版本变（README.zh.md 明示「提供方措辞可能改变」）。
  //    故：能按 code 精确翻译就按 code 翻，不依赖文案形态。
  const byCode = humanizeErrorCode(code, raw)
  if (byCode !== null) return byCode

  // 1. 【F1】官方/内部实现细节泄漏 —— 必须在其它规则**之前**处理：
  //    这些消息往往同时含 HTTP 码或英文技术串，若先走后面的规则会匹配失败或
  //    把内部名字留在文案里（`pi-ai detected context overflow for model "…"`）。
  const leaked = humanizeLeakedInternals(raw, code)
  if (leaked !== null) return leaked

  // 2. 网络层：fetch 抛的 TypeError（离线/DNS/连接被拒）
  if (err?.name === 'TypeError' && /fetch|network|failed to fetch/i.test(raw)) {
    return '无法连接到本地服务（DSH 运行时可能尚未启动或已停止）——请稍候重试，若持续出现请到「设置 → 插件」查看运行时状态'
  }
  // 3.（原「网关/服务重载」分支已并入 OFFICIAL_ERROR_CODES 的 'gateway/service-unavailable'
  //      条目 —— 同一 code 只允许一处翻译，见 P-1）
  // 4. HTTP 状态码
  const httpMatch = raw.match(/HTTP\s+(\d{3})/)
  if (httpMatch) {
    const s = Number(httpMatch[1])
    if (s === 401 || s === 403) return '鉴权失败：请检查 API Key 是否有效（设置 → 模型）'
    if (s === 404) return '该功能在当前版本不可用（接口不存在）——可能是插件版本不匹配'
    if (s === 413) return '内容过大被服务拒绝——请减少单次导入的数据量'
    if (s >= 500) return '本地服务内部错误（HTTP 5xx）——请重试；若持续出现请查看运行时日志'
    if (s >= 400) return `请求被拒绝（HTTP ${s}）——请检查输入后重试`
  }
  // 5. 路由未挂载（旧版插件）
  if (/unknown endpoint|not found/i.test(raw) && /endpoint|route/i.test(raw)) {
    return '该接口在当前插件版本中不存在——请确认已安装最新版插件'
  }
  // 6. 参数缺失（服务端返回的英文技术串）
  const missing = raw.match(/^(\w+)\s+required$/i)
  if (missing) return `缺少必要参数「${missing[1]}」——这是内部错误，请反馈此提示`
  // 7. JSON 解析失败（多为导入文件损坏）
  if (/JSON|Unexpected token/i.test(raw)) {
    return '文件内容不是合法 JSON——可能是文件损坏或不是本功能支持的数据格式'
  }
  // 8. 兜底：保留原文（原文是排障的唯一线索，不可吞）
  return raw
}

/**
 * 【F1 / E4】官方错误码表（**集中单源**）。
 *
 * ## 为什么单列一张表
 * 用户可见的失败文案有两个来源：模式匹配（message 形态）与**结构化错误码**。
 * 后者更可靠（枚举稳定），但官方错误码散落在多个包（`dsh-llm` 的 `*_CODE` 常量、
 * 适配器里的字面量）且**全是英文大写下划线**——直接展示等于什么都没说。
 *
 * 本表把「官方错误码 → 人话 + 可操作建议」集中在一处维护：
 * 新增错误码只改这张表，不改 `humanizeError` 的控制流（P-1 单一事实来源）。
 *
 * 取值来源（2026-09-14 实测 `dsh-runtime-android/node_modules/@deepseek-ai/*`）：
 * `CONTEXT_WINDOW_EXCEEDED` / `QUOTA` / `EMPTY_RESPONSE` / `INVALID_CREDENTIAL` 为
 * `dsh-llm/lib/index.js` 的导出常量；`INVALID_REQUEST` / `MAX_TOKENS` /
 * `LLM_STREAM_IDLE_TIMEOUT` 等为适配器（`dsh-llm-pi-ai` / `dsh-llm-deepseek`）字面量。
 *
 * ⚠️ 官方 README 明示「提供方措辞可能改变」⇒ 本表必须与 `INTERNAL_LEAK_RULES`
 * **互为兜底**：code 变了还有模式匹配兜（反之亦然），两者都不得单独删除。
 */
const OFFICIAL_ERROR_CODES: Readonly<Record<string, string>> = {
  CONTEXT_WINDOW_EXCEEDED:
    '本轮对话超出了模型的上下文容量——上下文已满，模型无法再接收新内容。'
    + '建议：回退若干轮、删除无关长楼层，或在「设置 → 模型」换用上下文更大的模型后重试。',
  EMPTY_RESPONSE:
    '模型返回了空回复（没有内容块）——通常是上游瞬时异常，重新生成一次即可。',
  QUOTA:
    '模型服务额度不足（配额已用尽或触发限流）——请检查账户额度，稍后再试。',
  INVALID_CREDENTIAL:
    '鉴权失败：API Key 无效或已过期——请到「设置 → 模型」重新填写。',
  INVALID_REQUEST:
    '请求被模型服务拒绝（参数或内容不被接受）——若刚换过模型，可能是该模型不支持当前请求；'
    + '也可能是单次内容过大，请减少本轮内容后重试。',
  MAX_TOKENS:
    '本轮输出达到了长度上限被截断——可在「设置 → 模型」调大最大输出长度，或让它分段继续。',
  LLM_STREAM_IDLE_TIMEOUT:
    '模型服务长时间没有返回数据（连接空闲超时）——通常是上游卡住，重新生成一次即可。',
  'gateway/service-unavailable':
    '宿主服务正在重载，稍后会自动恢复——请再点一次。',
  // 【E4 2026-09-14 设备实测补充】以下码由 M7 旅程在真机上捕获到（错误面板原文
  // `provider "ts-custom" model "google/gemini-3.7-flash" does not support reasoning effort "auto"`
  // + 尾码 `UNSUPPORTED_REASONING_EFFORT`），当时表里没有它 ⇒ **整段英文原文直透用户面**，
  // 且把内部 provider id（`ts-custom`）与内部路由形态（`google/…`）一并暴露。
  // 这正是 F1「官方内部实现细节泄漏」的**第二种形态**：不是 SDK 名，而是**错误码未收录**。
  UNSUPPORTED_REASONING_EFFORT:
    '当前模型不支持所选的「思考强度」——请在「设置 → 模型」把该模型的思考强度改为它支持的值'
    + '（例如「自动」或「关闭」），或换用支持该强度的模型后重试。',
  UNSUPPORTED_MODEL:
    '当前所选模型不被该服务提供方支持——请在「设置 → 模型」重新选择一个可用模型。',
  INVALID_MODEL:
    '模型标识无效（可能已被下线或改名）——请在「设置 → 模型」重新选择。',
  RATE_LIMITED:
    '触发了服务方的速率限制——请稍候片刻再重试。',
  NETWORK_ERROR:
    '网络请求失败（无法到达模型服务）——请检查网络连接后重试。',
}

/**
 * 【F1 / E4】按官方错误码翻译；未收录返回 null（交后续规则处理，不吞信息）。
 *
 * @param code 错误码（精确匹配，大小写敏感——官方枚举全大写）
 * @param raw  原始 message（用于**提取对用户有用的上下文**，如模型名）
 */
export function humanizeErrorCode(code: string, raw = ''): string | null {
  if (code === '') return null
  const base = OFFICIAL_ERROR_CODES[code]
  if (base === undefined) return null
  // 从原文提取模型名并保留（对用户有用：知道是哪个模型的问题）；
  // 剥掉 `provider/model` 里的 provider 前缀（那是内部路由细节，用户只需模型名）。
  const m = /model\s+"([^"]+)"/i.exec(raw)
  const name = m?.[1]?.includes('/') === true ? m[1].split('/').pop() : m?.[1]
  if (name === undefined || name === '') return base
  return `（模型 ${name}）${base}`
}

/**
 * 【F1】内部实现细节模式表 —— **模式驱动**，新形态加一条即可，不要写逐串替换。
 *
 * 每条：`match`（在原始 message 上测试）+ `toUser`（用户可懂表述）。
 * 表内模式全部来自「官方包内部字面量会透到用户面」这一类问题，
 * 判断依据是**这个名字对用户毫无意义、且暴露我方技术栈/第三方选型**。
 */
const INTERNAL_LEAK_RULES: ReadonlyArray<{ match: RegExp; toUser: (raw: string) => string }> = [
  // 上下文超限（官方 llm-pi-ai 的 mapStopReason 字面量，含 SDK 名 "pi-ai"）
  {
    match: /context overflow|CONTEXT_WINDOW_EXCEEDED|context window (?:exceeded|is full)/i,
    toUser: (raw) => {
      // 模型名**保留**（对用户有用：知道是哪个模型满了）；只剥掉冗余的 `provider/` 前缀
      const m = /model\s+"([^"]+)"/i.exec(raw)
      const name = m?.[1]?.includes('/') === true ? m[1].split('/').pop() : m?.[1]
      const which = name !== undefined && name !== '' ? `（模型 ${name}）` : ''
      return `本轮对话超出了模型的上下文容量${which}——上下文已满，模型无法再接收新内容。`
        + `建议：回退若干轮、删除无关长楼层，或在「设置 → 模型」换用上下文更大的模型后重试。`
    },
  },
  // 空回复（官方文案：model "x" returned a completed response with no content）
  {
    match: /returned a completed response with no content|EMPTY_RESPONSE/i,
    toUser: (raw) => {
      const m = /model\s+"([^"]+)"/i.exec(raw)
      return `模型${m?.[1] !== undefined ? ` ${m[1]}` : ''}返回了空回复（没有内容块）——通常是上游瞬时异常，重新生成一次即可。`
    },
  },
  // 其余把 SDK/包名拼进文案的形态：只做**名字隔离**，保留其余可读部分
  {
    match: /\bpi-ai\b|\bpi_ai\b|@earendil-works\/[\w.-]+/i,
    toUser: () => '模型服务返回了错误——这是上游适配层的内部错误，与你的操作无关；请重试，若持续出现请查看运行时日志。',
  },
  // 【E4 2026-09-14 设备实测新增】官方把**内部 provider id** 拼进用户可见文案的形态：
  //   provider "ts-custom" model "google/gemini-3.7-flash" does not support reasoning effort "auto"
  // 其中 `ts-custom` 是内部 provider 路由名、`google/…` 是内部 `provider/model` 形态——
  // 对用户**毫无意义**，且暴露我方技术栈。此规则是**通用模式**（非逐串替换）：
  // 只剥 provider 前缀、保留用户真正需要的**模型名**，并要求「把思考强度改掉」这一可操作建议。
  {
    match: /does not support reasoning effort|UNSUPPORTED_REASONING_EFFORT/i,
    toUser: (raw) => {
      const m = /model\s+"([^"]+)"/i.exec(raw)
      const name = m?.[1]?.includes('/') === true ? m[1].split('/').pop() : m?.[1]
      const which = name !== undefined && name !== '' ? `（模型 ${name}）` : ''
      const eff = /reasoning effort\s+"([^"]+)"/i.exec(raw)?.[1]
      const cur = eff !== undefined ? `当前请求的强度是「${eff}」` : '当前思考强度不被支持'
      return `${which}${cur}，该模型不支持它——请在「设置 → 模型」把该模型的思考强度改成它支持的值`
        + `（例如「自动」/「关闭」），或换用支持该强度的模型后重试。`
    },
  },
  // 内部包名/类名/源文件路径外泄（通用兜底形态）
  {
    match: /@deepseek-ai\/[\w.-]+|lib\/index\.js:\d+|node_modules\/[\w@/.-]+/i,
    toUser: () => '本地运行时内部错误——请重试；若持续出现请附带运行时日志反馈（详情中保留了原始信息）。',
  },
]

/**
 * 【F1】把「官方内部实现细节」从用户可见文案里隔离掉。
 * 命中返回用户可懂表述；未命中返回 null（交后续规则处理）。
 */
export function humanizeLeakedInternals(raw: string, code = ''): string | null {
  const hay = `${code} ${raw}`
  for (const rule of INTERNAL_LEAK_RULES) {
    if (rule.match.test(hay)) return rule.toUser(raw)
  }
  return null
}

/** DSH RPC（同源 /api 信封）。返回 value；业务错误抛 DshRpcError（带 code，见该类注释）。
 * 0.1.2 坑 #21：wire 契约变更——method 必须斜杠式（namespace/method，点式被
 * claimsEndpoint 拒绝 → 404 not found），payload 必须包 {args}；响应信封不变。 */
export async function dshRpc<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
  const wire = method.replace(/\./g, '/')
  const resp = await fetch(`/api/${wire}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `dsht-rp-ui-${++rpcSeq}`, method: wire, payload: { args: payload } }),
  })
  if (!resp.ok) throw new DshRpcError(wire, `http/${resp.status}`, `${method}: HTTP ${resp.status}`)
  const envelope = await resp.json() as { result?: { ok: boolean; value?: T; error?: { code?: string; message?: string } } }
  const result = envelope.result
  if (!result || result.ok === false) {
    throw new DshRpcError(wire, result?.error?.code, result?.error?.message ?? `${method} failed`)
  }
  return result.value as T
}

/** llm.discoverModels 探测到的模型视图（llm.ts DiscoveredModelView）。 */
export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

/** dsht-rp-plugin 数据面（webServer 前缀路由 /dsht-rp/*，同源）。 */
export async function rpApi<T = unknown>(path: string, payload: unknown = {}): Promise<T> {
  const resp = await fetch(`/dsht-rp/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await resp.json() as T & { error?: string }
  if ((body as { error?: string }).error) throw new Error(String((body as { error?: string }).error))
  return body
}

/** dsht-tavern-helper 数据面（webServer 前缀路由 /dsht-tavern-helper/*，同源）。
 * 世界书 / 预设 / 正则等酒馆助手 API（RpLorePanel 消费；与 RpScriptHost 内部
 * thApi 同形态，那边不导出、不允许动，这里补公共入口）。 */
export async function thApi<T = unknown>(path: string, payload: unknown = {}): Promise<T> {
  const resp = await fetch(`/dsht-tavern-helper/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await resp.json() as T & { error?: string }
  if ((body as { error?: string }).error) throw new Error(String((body as { error?: string }).error))
  return body
}

/** dsht-plugin-memory 数据面 POST（/dsht-memory/*，同源；settings/expand/summarize） */
export async function memApi<T = unknown>(path: string, payload: unknown = {}): Promise<T> {
  const resp = await fetch(`/dsht-memory/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await resp.json() as T & { error?: string }
  if ((body as { error?: string }).error) throw new Error(String((body as { error?: string }).error))
  return body
}

/** dsht-plugin-memory 数据面 GET（/dsht-memory/*?query；health/status） */
export async function memGet<T = unknown>(path: string, query: string): Promise<T> {
  const resp = await fetch(`/dsht-memory/${path.replace(/^\//, '')}${query ? `?${query}` : ''}`)
  const body = await resp.json() as T & { error?: string }
  if ((body as { error?: string }).error) throw new Error(String((body as { error?: string }).error))
  return body
}
