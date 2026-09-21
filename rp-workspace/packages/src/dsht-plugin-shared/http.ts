/**
 * DSHT 独立插件共享 HTTP 数据面辅助（esbuild 内联打包，零运行时依赖）。
 * 与 dsh-plugin/index.ts 的 /dsht-rp 数据面同款约定：
 * - ctx.webServer 前缀路由（同源、零端口冲突）
 * - 信任栅栏：loopback Host（防 DNS rebinding）；LAN 模式下浏览器请求必须同源
 * - $DSH_HOME 解析与官方 resolveDshHome 同优先级：$DSH_HOME > ~/.dsh
 */

import { homedir } from 'node:os'
import { resolve, join } from 'node:path'

/** ctx.webServer 最小面（host-webserver；web profile 必备） */
export interface LikeWebServer {
  register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) => () => void
  host?: '127.0.0.1' | '0.0.0.0'
}

export interface LikePluginContext {
  webServer?: LikeWebServer
  effect?: (fn: () => () => void, label?: string) => unknown
}

export interface LikeRequest {
  method?: string
  url?: string
  headers: Record<string, unknown>
}

export interface LikeResponse {
  writeHead: (code: number, headers?: Record<string, string>) => void
  end: (body?: string) => void
}

/** DSH home 解析（Windows 上 os.homedir() 读 USERPROFILE；Android/PC 验证都设 DSH_HOME） */
export function resolveDshHome(): string {
  const envHome = process.env.DSH_HOME?.trim()
  return envHome ? resolve(envHome) : join(homedir(), '.dsh')
}

/** 信任栅栏（对照 connection 包 isTrustedApiRequest 语义，与 dsh-plugin 同款） */
export function isTrusted(req: LikeRequest, webServer: LikeWebServer | undefined): boolean {
  const host = String(req.headers.host ?? '').toLowerCase()
  const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '')
  // 【W-A 2026-09-21】DSHT_LAN_MODE=1（NodeService 在 LAN 开关开启时注入 node env）
  // 等价 lanMode：Android 侧 LAN 的实际形态是原生 TCP 反代（0.0.0.0:port+10 →
  // 127.0.0.1:port），webServer 本体仍绑 loopback——但经代理进来的请求 Host 是
  // LAN 地址，没有这条会被误判成 DNS rebinding 而 403。
  const lanMode = webServer?.host === '0.0.0.0' || process.env.DSHT_LAN_MODE === '1'
  if (!lanMode && !['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== 'null' && !origin.endsWith(host)) {
    try { return new URL(origin).host === host } catch { return false }
  }
  return true
}

export function sendJson(res: LikeResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 读 JSON 请求体（坏 JSON 返回 null） */
export async function readJsonBody(req: LikeRequest & AsyncIterable<Buffer>): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** query 参数解析（url 形如 /prefix/sub?k=v） */
export function queryOf(url: string | undefined): URLSearchParams {
  const q = (url ?? '').split('?')[1] ?? ''
  return new URLSearchParams(q)
}

/** 去掉路由前缀后的子路径（不含 query） */
export function subPath(url: string | undefined, prefix: string): string {
  const p = (url ?? '').split('?')[0]
  return decodeURIComponent(p.replace(new RegExp(`^${prefix}`), '')) || '/'
}

/**
 * 注册前缀路由（含信任栅栏与 effect disposer）。
 * handler 收 (sub, req, res)；返回 false 表示未命中（交给 404）。
 */
export function registerPrefix(
  ctx: LikePluginContext,
  prefix: string,
  logTag: string,
  handler: (sub: string, req: LikeRequest & AsyncIterable<Buffer>, res: LikeResponse) => Promise<void>,
): void {
  if (!ctx.webServer) return
  const webServer = ctx.webServer
  const dispose = webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: (rawReq: unknown, rawRes: unknown) => {
      void (async () => {
        const req = rawReq as LikeRequest & AsyncIterable<Buffer>
        const res = rawRes as LikeResponse
        if (!isTrusted(req, webServer)) return sendJson(res, 403, { error: 'forbidden' })
        try {
          await handler(subPath(req.url, prefix), req, res)
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message })
        }
      })()
    },
  })
  console.log(`[${logTag}] data plane on webServer route ${prefix}/*`)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => { dispose() })
  }
}
