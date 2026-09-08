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

/** DSH RPC（同源 /api 信封）。返回 value；业务错误抛异常。
 * 0.1.2 坑 #21：wire 契约变更——method 必须斜杠式（namespace/method，点式被
 * claimsEndpoint 拒绝 → 404 not found），payload 必须包 {args}；响应信封不变。 */
export async function dshRpc<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
  const wire = method.replace(/\./g, '/')
  const resp = await fetch(`/api/${wire}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `dsht-rp-ui-${++rpcSeq}`, method: wire, payload: { args: payload } }),
  })
  if (!resp.ok) throw new Error(`${method}: HTTP ${resp.status}`)
  const envelope = await resp.json() as { result?: { ok: boolean; value?: T; error?: { message?: string } } }
  const result = envelope.result
  if (!result || result.ok === false) throw new Error(result?.error?.message ?? `${method} failed`)
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
