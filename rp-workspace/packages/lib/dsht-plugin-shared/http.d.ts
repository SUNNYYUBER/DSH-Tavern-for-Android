/**
 * DSHT 独立插件共享 HTTP 数据面辅助（esbuild 内联打包，零运行时依赖）。
 * 与 dsh-plugin/index.ts 的 /dsht-rp 数据面同款约定：
 * - ctx.webServer 前缀路由（同源、零端口冲突）
 * - 信任栅栏：loopback Host（防 DNS rebinding）；LAN 模式下浏览器请求必须同源
 * - $DSH_HOME 解析与官方 resolveDshHome 同优先级：$DSH_HOME > ~/.dsh
 */
/** ctx.webServer 最小面（host-webserver；web profile 必备） */
export interface LikeWebServer {
    register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: unknown, res: unknown) => void | Promise<void>;
    }) => () => void;
    host?: '127.0.0.1' | '0.0.0.0';
}
export interface LikePluginContext {
    webServer?: LikeWebServer;
    effect?: (fn: () => () => void, label?: string) => unknown;
}
export interface LikeRequest {
    method?: string;
    url?: string;
    headers: Record<string, unknown>;
}
export interface LikeResponse {
    writeHead: (code: number, headers?: Record<string, string>) => void;
    end: (body?: string) => void;
}
/** DSH home 解析（Windows 上 os.homedir() 读 USERPROFILE；Android/PC 验证都设 DSH_HOME） */
export declare function resolveDshHome(): string;
/** 信任栅栏（对照 connection 包 isTrustedApiRequest 语义，与 dsh-plugin 同款） */
export declare function isTrusted(req: LikeRequest, webServer: LikeWebServer | undefined): boolean;
export declare function sendJson(res: LikeResponse, code: number, body: unknown): void;
/** 读 JSON 请求体（坏 JSON 返回 null） */
export declare function readJsonBody(req: LikeRequest & AsyncIterable<Buffer>): Promise<Record<string, unknown> | null>;
/** query 参数解析（url 形如 /prefix/sub?k=v） */
export declare function queryOf(url: string | undefined): URLSearchParams;
/** 去掉路由前缀后的子路径（不含 query） */
export declare function subPath(url: string | undefined, prefix: string): string;
/**
 * 注册前缀路由（含信任栅栏与 effect disposer）。
 * handler 收 (sub, req, res)；返回 false 表示未命中（交给 404）。
 */
export declare function registerPrefix(ctx: LikePluginContext, prefix: string, logTag: string, handler: (sub: string, req: LikeRequest & AsyncIterable<Buffer>, res: LikeResponse) => Promise<void>): void;
