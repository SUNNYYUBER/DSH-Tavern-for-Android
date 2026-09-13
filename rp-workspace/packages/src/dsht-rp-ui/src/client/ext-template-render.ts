/**
 * ext-template-render.ts — 【T-48 · 心跳 67】ST 扩展模板的**真渲染**核心（宿主侧单实现）。
 * ================================================================================
 * ## 实现性质
 * **接口对齐 + 独立实现**：导出的两个函数名与调用契约（参数顺序、默认值、
 * 返回形状、失败行为）按互操作需要对齐 ST 的公开 API；实现为本项目自行编写，
 * 未复制上游源码文本。
 *
 * ## 可观测契约（这是兼容面的真正内容）
 * `renderTemplateAsync(templateId, templateData, sanitize, localize, fullPath)`：
 *   1. 模板路径 = `fullPath ? templateId : '/scripts/templates/<templateId>.html'`
 *   2. 模板内容按路径**缓存编译结果**（同一路径只取一次文件、只编译一次）
 *   3. 用 `templateData` 执行模板得到字符串
 *   4. `sanitize !== false` ⇒ 做 HTML 消毒（清 script / on* 等）
 *   5. `localize !== false` ⇒ 做本地化替换
 *   6. 任一步失败：`console.error('Error rendering template', …)` +
 *      `toastr.error('Check the DevTools console for more information.', 'Error rendering template')`，
 *      并**返回 `undefined`（不 reject）** ← 调用方按此形状处理，必须保持
 *
 * `renderExtensionTemplateAsync(extensionName, templateId, templateData, sanitize, localize)`：
 *   即 `renderTemplateAsync('scripts/extensions/<extensionName>/<templateId>.html', …, fullPath=true)`
 *
 * 本模块把这条链**原样落地**，只把四个环境依赖（Handlebars / DOMPurify / 取文件 /
 * applyLocale）显式参数化（`RenderEnv`）—— 为的是：
 *   ① node 单测能在 jsdom 下用**真 DOM** 验证 `<script>` / `on*` 的清理面；
 *   ② iframe 侧门面可以把同一份 env 语义转发过来（见下方「两侧同步」）。
 *
 * ## 两侧同步（T-19 硬约束）
 * 宿主面（`host-vendor.ts:buildHostStContext`）**直接调本模块**；
 * iframe 面（`th-shim.ts` 的 `buildStContextFacade`）在模板串里**转发宿主面的同名成员**
 * （真 TH 的形态就是「帧面 = 父页投影」）。⇒ 两处**不存在第二份渲染实现**，不可能漂移；
 * parity 由单测跑真构建产物钉住。
 *
 * ## 依赖来源
 * 渲染依赖 Handlebars 与 DOMPurify（两者均以 npm 依赖引入，见仓库第三方许可清单）。
 * 兼容层需要它们出现在全局（真 ST 也把二者挂成 `window` 全局以便扩展脚本取用），
 * 本模块的 `installTemplateGlobals` 按"不覆盖宿主已有"的语义补齐全局。
 */
import Handlebars from 'handlebars'
import DOMPurify from 'dompurify'

/** Handlebars 编译产物的最小面（只要可调用） */
export type CompiledTemplate = (data: unknown) => string

/** 渲染环境（四个外部依赖 + 两个观测通道） */
export interface RenderEnv {
  /** 编译模板源码（基准 = `Handlebars.compile`） */
  compile: (templateSource: string) => CompiledTemplate
  /** 消毒渲染结果（基准 = `DOMPurify.sanitize(result)`） */
  sanitize: (html: string) => string
  /** 异步取模板文本（基准 = `getUrlAsync` 的 XHR GET） */
  fetchText: (pathToTemplate: string) => Promise<string>
  /** 同步取模板文本（基准 deprecated 同步版的 `getUrlSync`；缺省 = 不支持同步取文件） */
  fetchTextSync?: ((pathToTemplate: string) => string) | undefined
  /** 本地化（基准 = `applyLocale`） */
  applyLocale: (html: string) => string
  /** 用户可见失败提示（基准 = `toastr.error`）；缺省 = 无 UI 能力，静默跳过但不改变返回形状 */
  toastrError?: ((message: string, title: string) => void) | undefined
  /** 降级出声通道（L42：有意降级必须能被看到）；缺省 = console.warn */
  warn?: ((message: string) => void) | undefined
}

/**
 * 模板缓存 —— **按路径缓存编译结果**（基准 `templates.js:8` 的 `TEMPLATE_CACHE` 同语义：
 * key 是**路径**而不是 templateId，故同一模板经 fullPath / 非 fullPath 两种取法各自一份）。
 */
const TEMPLATE_CACHE = new Map<string, CompiledTemplate>()

/** 只测试用：清空模板缓存（避免用例间串味） */
export function __clearTemplateCache(): void {
  TEMPLATE_CACHE.clear()
}

/** 只测试/排障用：当前缓存路径清单 */
export function __templateCacheKeys(): string[] {
  return [...TEMPLATE_CACHE.keys()]
}

/** 基准的失败提示标题与正文（逐字） */
const FAILURE_TITLE = 'Error rendering template'
const FAILURE_MESSAGE = 'Check the DevTools console for more information.'

/**
 * 把模板路径规范成**站点根绝对路径**。
 *
 * 为什么需要（环境差异，不是契约差异）：基准的 `renderExtensionTemplateAsync` 传的是
 * **相对路径**（`scripts/extensions/<ext>/<id>.html`，注意无前导斜杠）—— 基准的文档位于
 * 站点根（`/`），相对解析的结果就是 `/scripts/extensions/…`。DSH webui 是 **SPA**，
 * 深链（如 `/session/<id>`）下 `fetch('scripts/…')` 会解析成
 * `/session/scripts/…` ⇒ 打到 fallback 上（404），渲染永远失败。
 * 我方统一口径 = 与项目其余数据面请求（`/dsht-rp/*`、`/dsht-mvu/*`…）一致：**根绝对路径**。
 * 路由注册在 `/scripts/extensions`、`/scripts/templates`（见 `dsh-plugin/ext-asset.ts`），
 * 与本规范化一一对应。
 */
function toRootPath(pathToTemplate: string): string {
  return pathToTemplate.startsWith('/') ? pathToTemplate : `/${pathToTemplate}`
}

/**
 * 基准的失败路径（逐字）：`console.error('Error rendering template', templateId, templateData, err)`
 * + `toastr.error('Check the DevTools console…', 'Error rendering template')` + **返回 undefined**。
 *
 * ⚠️ 调用方**不得**把这里改成 rethrow：基准**不 reject**，卡的 `await` 链靠这个形状继续走。
 */
function reportFailure(env: RenderEnv, templateId: unknown, templateData: unknown, err: unknown): undefined {
  try {
    console.error('Error rendering template', templateId, templateData, err)
  } catch { /* 日志能力缺失不改变返回形状 */ }
  try {
    env.toastrError?.(FAILURE_MESSAGE, FAILURE_TITLE)
  } catch { /* 同上 */ }
  return undefined
}

/** 取（并缓存）编译好的模板；基准 `fetchTemplateAsync` 同语义 */
async function fetchTemplateAsync(env: RenderEnv, pathToTemplate: string): Promise<CompiledTemplate> {
  const cached = TEMPLATE_CACHE.get(pathToTemplate)
  if (cached !== undefined) return cached
  const templateContent = await env.fetchText(pathToTemplate)
  const template = env.compile(templateContent)
  TEMPLATE_CACHE.set(pathToTemplate, template)
  return template
}

/** 取（并缓存）编译好的模板（同步）；基准 deprecated `fetchTemplateSync` 同语义 */
function fetchTemplateSync(env: RenderEnv, pathToTemplate: string): CompiledTemplate {
  const cached = TEMPLATE_CACHE.get(pathToTemplate)
  if (cached !== undefined) return cached
  if (env.fetchTextSync === undefined) {
    throw new Error(`同步取模板不可用（无 fetchTextSync 能力）: ${pathToTemplate}`)
  }
  const templateContent = env.fetchTextSync(pathToTemplate)
  const template = env.compile(templateContent)
  TEMPLATE_CACHE.set(pathToTemplate, template)
  return template
}

/**
 * 渲染后处理：消毒 + 本地化（基准 `renderTemplateAsync` 尾部两步）。
 * 顺序**必须**照抄：先 sanitize 再 localize（否则本地化写入的属性/文本不受消毒保护）。
 */
function postProcess(env: RenderEnv, html: string, sanitize: boolean, localize: boolean): string {
  let result = html
  if (sanitize) result = env.sanitize(result)
  if (localize) result = env.applyLocale(result)
  return result
}

/**
 * 基准 `renderTemplateAsync`（异步）——签名与默认值逐字对齐。
 *
 * @param env - 环境依赖（见 {@link RenderEnv}）。
 * @param templateId - fullPath=false 时为模板 id，true 时为完整路径。
 * @returns 渲染结果；任何一步失败 → `undefined`（**不 reject**，基准同形）。
 */
export async function renderTemplateAsync(
  env: RenderEnv,
  templateId: string,
  templateData: unknown = {},
  sanitize = true,
  localize = true,
  fullPath = false,
): Promise<string | undefined> {
  try {
    const pathToTemplate = fullPath ? toRootPath(templateId) : `/scripts/templates/${templateId}.html`
    const template = await fetchTemplateAsync(env, pathToTemplate)
    return postProcess(env, template(templateData), sanitize, localize)
  } catch (err) {
    return reportFailure(env, templateId, templateData, err)
  }
}

/**
 * 基准 deprecated `renderTemplate`（同步）。签名同 {@link renderTemplateAsync}，返回值同步。
 * 我方保留它是因为门面里有 `renderExtensionTemplate`（同步版）——「有 API 但失败」优于
 * 「不是函数」；且缓存命中时同步路径确实能渲染出真结果。
 */
export function renderTemplate(
  env: RenderEnv,
  templateId: string,
  templateData: unknown = {},
  sanitize = true,
  localize = true,
  fullPath = false,
): string | undefined {
  try {
    const pathToTemplate = fullPath ? toRootPath(templateId) : `/scripts/templates/${templateId}.html`
    const template = fetchTemplateSync(env, pathToTemplate)
    return postProcess(env, template(templateData), sanitize, localize)
  } catch (err) {
    return reportFailure(env, templateId, templateData, err)
  }
}

/**
 * 基准 `renderExtensionTemplateAsync`（`extensions.js:137`）——逐字：
 * `renderTemplateAsync('scripts/extensions/' + ext + '/' + id + '.html', data, sanitize, localize, true)`。
 *
 * ⚠️ 路径**无前导斜杠**（因走 fullPath 分支），与基准逐字一致。
 */
export function renderExtensionTemplateAsync(
  env: RenderEnv,
  extensionName: unknown,
  templateId: unknown,
  templateData: unknown = {},
  sanitize = true,
  localize = true,
): Promise<string | undefined> {
  return renderTemplateAsync(
    env,
    `scripts/extensions/${String(extensionName ?? '')}/${String(templateId ?? '')}.html`,
    templateData, sanitize, localize, true,
  )
}

/** 基准 deprecated `renderExtensionTemplate`（`extensions.js:125`）——同步版，路径规则同上。 */
export function renderExtensionTemplate(
  env: RenderEnv,
  extensionName: unknown,
  templateId: unknown,
  templateData: unknown = {},
  sanitize = true,
  localize = true,
): string | undefined {
  return renderTemplate(
    env,
    `scripts/extensions/${String(extensionName ?? '')}/${String(templateId ?? '')}.html`,
    templateData, sanitize, localize, true,
  )
}

// ---------------------------------------------------------------------------
// 浏览器环境默认依赖（真 ST `public/lib.js` 同形）
// ---------------------------------------------------------------------------

/**
 * 由宿主全局构造默认渲染环境。
 *
 * 三个来源的取舍（都不是"简化"，是**形态对齐**）：
 *  - `compile` / `sanitize`：优先宿主全局（ST `lib.js:42-56` 把 DOMPurify / Handlebars 挂在
 *    `window` 上 —— ST 同款宿主、或第三方扩展可能替换过它们），否则用本模块静态 import 的那份。
 *  - `fetchText`：浏览器 `fetch`（同源）。基准用 XHR 只是时代原因；两者的失败语义一致
 *    （非 2xx 抛错，消息形状照抄基准 `Error loading <url>: <status> <statusText>`）。
 *  - `fetchTextSync`：`XMLHttpRequest` 同步模式（基准 deprecated `getUrlSync` 同款）。
 *
 * @param applyLocale - 本地化实现（由 host-vendor 传入，走宿主 i18n 单源）。
 * @param host - 取全局的位置（缺省 `globalThis`；参数化以便单测注入）。
 */
export function createDefaultRenderEnv(
  applyLocale: (html: string) => string,
  host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): RenderEnv {
  return {
    // 全局引用一律**调用时**读取（不是创建 env 时读一次）：`installTemplateGlobals` 可能在
    // 本 env 建成之后才跑（client 启动顺序），且宿主全局随时可能被扩展替换。
    // 宿主全局优先（可能被扩展打过补丁，与 ST `lib.js` 的 `window.DOMPurify` 同一枚）；
    // 没有则用本模块静态 import 的那份（浏览器 bundle 里是已绑定 window 的 DOMPurify 实例）。
    compile: (src) => {
      const fn = (host.Handlebars as { compile?: (s: string) => CompiledTemplate } | undefined)?.compile
      return typeof fn === 'function' ? fn(src) : Handlebars.compile(src)
    },
    sanitize: (html) => {
      const fn = (host.DOMPurify as { sanitize?: (h: string) => string } | undefined)?.sanitize
      return typeof fn === 'function' ? fn(html) : DOMPurify.sanitize(html)
    },
    fetchText: async (pathToTemplate) => {
      const resp = await fetch(pathToTemplate)
      if (!resp.ok) {
        throw new Error(`Error loading ${pathToTemplate}: ${resp.status} ${resp.statusText}`)
      }
      return await resp.text()
    },
    fetchTextSync: (pathToTemplate) => {
      const XHR = (globalThis as { XMLHttpRequest?: new () => {
        open: (method: string, url: string, async: boolean) => void
        send: () => void
        status: number
        statusText: string
        responseText: string
      } }).XMLHttpRequest
      if (XHR === undefined) throw new Error(`同步 XHR 不可用: ${pathToTemplate}`)
      const request = new XHR()
      request.open('GET', pathToTemplate, false)
      request.send()
      if (request.status >= 200 && request.status < 300) return request.responseText
      throw new Error(`Error loading ${pathToTemplate}: ${request.status} ${request.statusText}`)
    },
    applyLocale,
    toastrError: (message, title) => {
      const toastr = host.toastr as { error?: (m: string, t: string) => void } | undefined
      if (toastr !== undefined && typeof toastr.error === 'function') toastr.error(message, title)
    },
    warn: (message) => { console.warn(message) },
  }
}
