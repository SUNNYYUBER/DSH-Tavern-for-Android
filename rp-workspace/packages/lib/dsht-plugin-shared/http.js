"use strict";
/**
 * DSHT 独立插件共享 HTTP 数据面辅助（esbuild 内联打包，零运行时依赖）。
 * 与 dsh-plugin/index.ts 的 /dsht-rp 数据面同款约定：
 * - ctx.webServer 前缀路由（同源、零端口冲突）
 * - 信任栅栏：loopback Host（防 DNS rebinding）；LAN 模式下浏览器请求必须同源
 * - $DSH_HOME 解析与官方 resolveDshHome 同优先级：$DSH_HOME > ~/.dsh
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDshHome = resolveDshHome;
exports.isTrusted = isTrusted;
exports.sendJson = sendJson;
exports.readJsonBody = readJsonBody;
exports.queryOf = queryOf;
exports.subPath = subPath;
exports.registerPrefix = registerPrefix;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
/** DSH home 解析（Windows 上 os.homedir() 读 USERPROFILE；Android/PC 验证都设 DSH_HOME） */
function resolveDshHome() {
    const envHome = process.env.DSH_HOME?.trim();
    return envHome ? (0, node_path_1.resolve)(envHome) : (0, node_path_1.join)((0, node_os_1.homedir)(), '.dsh');
}
/** 信任栅栏（对照 connection 包 isTrustedApiRequest 语义，与 dsh-plugin 同款） */
function isTrusted(req, webServer) {
    const host = String(req.headers.host ?? '').toLowerCase();
    const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
    const lanMode = webServer?.host === '0.0.0.0';
    if (!lanMode && !['127.0.0.1', 'localhost', '::1'].includes(hostname))
        return false;
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== 'null' && !origin.endsWith(host)) {
        try {
            return new URL(origin).host === host;
        }
        catch {
            return false;
        }
    }
    return true;
}
function sendJson(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
/** 读 JSON 请求体（坏 JSON 返回 null） */
async function readJsonBody(req) {
    const chunks = [];
    for await (const c of req)
        chunks.push(c);
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
/** query 参数解析（url 形如 /prefix/sub?k=v） */
function queryOf(url) {
    const q = (url ?? '').split('?')[1] ?? '';
    return new URLSearchParams(q);
}
/** 去掉路由前缀后的子路径（不含 query） */
function subPath(url, prefix) {
    const p = (url ?? '').split('?')[0];
    return decodeURIComponent(p.replace(new RegExp(`^${prefix}`), '')) || '/';
}
/**
 * 注册前缀路由（含信任栅栏与 effect disposer）。
 * handler 收 (sub, req, res)；返回 false 表示未命中（交给 404）。
 */
function registerPrefix(ctx, prefix, logTag, handler) {
    if (!ctx.webServer)
        return;
    const webServer = ctx.webServer;
    const dispose = webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: (rawReq, rawRes) => {
            void (async () => {
                const req = rawReq;
                const res = rawRes;
                if (!isTrusted(req, webServer))
                    return sendJson(res, 403, { error: 'forbidden' });
                try {
                    await handler(subPath(req.url, prefix), req, res);
                }
                catch (e) {
                    sendJson(res, 500, { error: e.message });
                }
            })();
        },
    });
    console.log(`[${logTag}] data plane on webServer route ${prefix}/*`);
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => { dispose(); });
    }
}
