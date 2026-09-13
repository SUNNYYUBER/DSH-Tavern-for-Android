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
 *
 * 背景：全项目只有 `isServiceUnavailable` 一个翻译点（rpc.ts:72），其余错误
 * **原样透传服务端 message** ⇒ 用户可能看到 `HTTP 500` / `unknown endpoint` /
 * `scriptId required` 这类英文技术串，既看不懂也不知道该做什么。
 *
 * 口径：**只在能给出更好说法时替换**；无法归类的一律保留原文并加前缀，
 * 绝不吞掉原始信息（否则排障时无从下手）。
 * 覆盖：导入 / 保存 / 迁移三类高频路径（goal D5 要求）。
 */
export function humanizeError(e: unknown): string {
  if (e === null || e === undefined) return '未知错误'
  const err = e as { message?: string; code?: string; name?: string }
  const raw = err?.message ?? String(e)
  const code = err?.code ?? ''

  // 1. 网络层：fetch 抛的 TypeError（离线/DNS/连接被拒）
  if (err?.name === 'TypeError' && /fetch|network|failed to fetch/i.test(raw)) {
    return '无法连接到本地服务（DSH 运行时可能尚未启动或已停止）——请稍候重试，若持续出现请到「设置 → 插件」查看运行时状态'
  }
  // 2. 网关/服务重载窗口
  if (code === 'gateway/service-unavailable' || /service-unavailable/.test(code)) {
    return '宿主服务正在重载，稍后会自动恢复——请再点一次'
  }
  // 3. HTTP 状态码
  const httpMatch = raw.match(/HTTP\s+(\d{3})/)
  if (httpMatch) {
    const s = Number(httpMatch[1])
    if (s === 401 || s === 403) return '鉴权失败：请检查 API Key 是否有效（设置 → 模型）'
    if (s === 404) return '该功能在当前版本不可用（接口不存在）——可能是插件版本不匹配'
    if (s === 413) return '内容过大被服务拒绝——请减少单次导入的数据量'
    if (s >= 500) return '本地服务内部错误（HTTP 5xx）——请重试；若持续出现请查看运行时日志'
    if (s >= 400) return `请求被拒绝（HTTP ${s}）——请检查输入后重试`
  }
  // 4. 路由未挂载（旧版插件）
  if (/unknown endpoint|not found/i.test(raw) && /endpoint|route/i.test(raw)) {
    return '该接口在当前插件版本中不存在——请确认已安装最新版插件'
  }
  // 5. 参数缺失（服务端返回的英文技术串）
  const missing = raw.match(/^(\w+)\s+required$/i)
  if (missing) return `缺少必要参数「${missing[1]}」——这是内部错误，请反馈此提示`
  // 6. JSON 解析失败（多为导入文件损坏）
  if (/JSON|Unexpected token/i.test(raw)) {
    return '文件内容不是合法 JSON——可能是文件损坏或不是本功能支持的数据格式'
  }
  // 7. 兜底：保留原文（原文是排障的唯一线索，不可吞）
  return raw
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
