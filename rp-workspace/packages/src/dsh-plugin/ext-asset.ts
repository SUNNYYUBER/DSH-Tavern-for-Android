/**
 * ext-asset.ts —— 【T-48 · 心跳 67】ST 扩展/模板资产的**路径解析**内核（纯函数，可单测）。
 * ==================================================================================
 * ## 基准对照（`SillyTavern-reference/public/`）
 *  - 扩展模板：`scripts/extensions.js:137` 的
 *    `renderExtensionTemplateAsync(ext, id, …)` → 取 `scripts/extensions/<ext>/<id>.html`
 *    （`<ext>` **允许含 `/`**，如 `third-party/chat-history-backup` —— ST 的扩展目录就是这么分的）。
 *  - 应用模板：`scripts/templates.js:72` 的
 *    `renderTemplateAsync(id, …, fullPath=false)` → 取 `/scripts/templates/<id>.html`。
 *
 * ## 存储位置（我方同构映射）
 *  - 扩展：`$DSH_HOME/extensions/<ext>/…` —— 与 ST 的 `data/<user>/extensions/` 同构
 *    （ST 把**用户装的第三方扩展**放这里；内置扩展走 `public/scripts/extensions/`，
 *    我们的内置扩展就是本插件自身，不经这条路由）。
 *  - 应用模板：`$DSH_HOME/templates/<id>.html`。⚠️ **诚实边界**：ST 的
 *    `public/scripts/templates/*.html`（58 个文件）是 **ST 自身 UI 的模板**（欢迎页、
 *    删除确认框、提示词管理器表头…），我方 UI 是 React、不消费它们，故**不随包分发**
 *    （塞进来就是死资产）；这条路由只服务「用户/第三方往 `$DSH_HOME/templates/` 放的模板」，
 *    找不到 → **真 404**（诚实失败，绝不返回空壳 HTML —— 空壳会让 Handlebars 编译出空串、
 *    让调用方以为「渲染成功但模板是空的」，属静默失败族）。
 *
 * ## 写侧（为什么没有）
 * 本次**不实现**上传/写扩展文件的 API：**没有消费者**（卡的宿主脚本只读模板；
 * ST 的扩展安装走 `/api/extensions/install`，我方装扩展=把文件放进 `$DSH_HOME/extensions/`，
 * 或经 DSH 的文件工具直接写工作区外路径）。⇒ 存储是**只读挂载**。
 * 一旦出现真消费者（例如扩展管理面板），再按当时的取用面补写侧——而不是先造一个没人调的
 * 上传端点（L36：不能多；无消费者的写面只会扩大攻击面）。
 *
 * ## 为什么单独成模块
 * 路径来自**不可信输入**（URL 里的 `<ext>` / `<id>`）：`..` 穿越必须被拒，
 * 而「拒绝逻辑」必须是**纯函数**才能在单测里逐条钉住（含 `%2e%2e` 已解码形态、
 * 双编码形态、反斜杠、NUL、非 `.html` 后缀）。路由处理器只负责 IO。
 */
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** 200 = 命中（`file` 为绝对路径）；否则为拒绝码与**具名原因**（不静默） */
export type ScriptAssetResolution =
  | { status: 200; file: string }
  | { status: 400; message: string }
  | { status: 404; message: string }

/** URL 前缀 → `$DSH_HOME` 下的存储根（与 ST 的目录语义同构，见文件头） */
export const SCRIPT_ASSET_ROOTS = {
  '/scripts/extensions': 'extensions',
  '/scripts/templates': 'templates',
} as const

export type ScriptAssetPrefix = keyof typeof SCRIPT_ASSET_ROOTS

/** 本模块负责的两条路径前缀（`dsh-plugin/index.ts` 的注册面与单测共用此单源） */
export const SCRIPT_ASSET_PREFIXES: readonly ScriptAssetPrefix[] = [
  '/scripts/extensions', '/scripts/templates',
]

/**
 * 解析一条 `/scripts/extensions/**` 或 `/scripts/templates/**` 请求到磁盘路径。
 *
 * 判据顺序（先安全、后存在性）：
 *  ① 路径必须以受管前缀 + `/` 开头 → 否则 404（**不是我们的路径**，诚实交给 404）。
 *  ② 百分号解码（畸形编码 → 400）。解码**在判 `..` 之前**：`%2e%2e%2f` 解出来就是 `../`，
 *     先判后解会让编码形态绕过检查。
 *  ③ 逐段校验：空段 / `.` / `..` / 含 `\\` / 含 NUL → 400。
 *  ④ 必须 `.html` 结尾 → 否则 404（基准的 URL 形态固定是 `…/<id>.html`）。
 *  ⑤ 拼绝对路径后再验一次「仍在存储根之内」（纵深防御：段级校验已挡住穿越，
 *     这一层防的是「段级校验日后被改坏」而没人发现）。
 *
 * @param rawPathname - 请求的 pathname（**可含百分号编码**，调用方不要先解码；query 已被剥离）。
 * @param dshHome - `$DSH_HOME` 绝对路径。
 */
export function resolveScriptAsset(rawPathname: string, dshHome: string): ScriptAssetResolution {
  const prefix = SCRIPT_ASSET_PREFIXES.find(
    (p) => rawPathname === p || rawPathname.startsWith(`${p}/`),
  )
  if (prefix === undefined) {
    return { status: 404, message: `not a scripts asset path: ${rawPathname}` }
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPathname)
  } catch {
    return { status: 400, message: `malformed percent-encoding: ${rawPathname}` }
  }
  // 解码后再取一次前缀（`%73cripts/...` 这类编码前缀在解码后才现形）
  if (!decoded.startsWith(`${prefix}/`)) {
    return { status: 404, message: `not under ${prefix}/: ${rawPathname}` }
  }
  const rest = decoded.slice(prefix.length + 1)
  const segments = rest.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      return { status: 400, message: `path traversal rejected: ${rawPathname}` }
    }
    if (seg.includes('\\') || seg.includes('\u0000')) {
      return { status: 400, message: `illegal path segment rejected: ${rawPathname}` }
    }
  }
  if (!decoded.endsWith('.html')) {
    return { status: 404, message: `only .html templates are served: ${rawPathname}` }
  }
  const root = resolve(dshHome, SCRIPT_ASSET_ROOTS[prefix])
  const file = resolve(root, ...segments)
  // 纵深防御：段级校验通过后仍要求落在存储根之内（`resolve` 已归一化 `..`）。
  // 判据承重（反控实测）：段级校验被改坏时，这一层仍能阻止读到存储根之外的文件。
  if (file !== root && !file.startsWith(root + sep)) {
    return { status: 400, message: `path escapes storage root: ${rawPathname}` }
  }
  return { status: 200, file }
}

/**
 * 路由处理内核（**IO 与判据同处一处** —— `dsh-plugin/index.ts` 的注册只做薄封装，
 * 单测因此能真跑路由层而不是只测纯函数）。
 *
 * 响应契约：
 *  - 非 GET/HEAD → 405（只读挂载；写侧未实现，见文件头）
 *  - 未通过信任栅栏 → 403（`trusted` 由调用方按 webServer 的 bind host 判定）
 *  - 路径非法 → 该解析结果的状态码（400 穿越/畸形编码；404 不属于本前缀/非 .html）
 *  - 文件存在 → 200 + `text/html; charset=utf-8` + `no-store`
 *  - 文件不存在/不可读 → **404**（诚实失败，绝不返回空壳模板）
 *
 * @param request - 已剥离方法/URL/信任判定的请求面。
 * @param response - 出站响应面（与 `ctx.webServer` handler 收到的 res 同形）。
 * @param dshHome - `$DSH_HOME` 绝对路径。
 */
export async function handleScriptAssetRequest(
  request: { method?: string | undefined; url?: string | undefined; trusted: boolean },
  response: {
    writeHead: (code: number, headers?: Record<string, string | number>) => void
    end: (body?: string) => void
  },
  dshHome: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
    return response.end('/* /scripts/** is read-only (GET/HEAD only) */\n')
  }
  if (!request.trusted) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return response.end('forbidden\n')
  }
  const pathname = (request.url ?? '').split('?')[0] ?? ''
  const resolved = resolveScriptAsset(pathname, dshHome)
  if (resolved.status !== 200) {
    response.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8' })
    return response.end(`${resolved.status} ${resolved.message}\n`)
  }
  let body: string
  try {
    body = await readFile(resolved.file, 'utf8')
  } catch {
    // 文件不存在 / 不可读 → 真 404（诚实失败；绝不给空壳模板）
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return response.end(`404 ${pathname} not found under $DSH_HOME\n`)
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // no-store：模板可在运行期被用户/工具改动，不得把旧内容钉在缓存里
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}
