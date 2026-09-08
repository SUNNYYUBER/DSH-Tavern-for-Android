/**
 * 数据通道：DSH 原生前端内运行的 RP 组件与宿主通信。
 *
 * - dshRpc：同源 POST /api/<method>（DSH wire 信封；页面本身就在 DSH web
 *   服务上，信任栅栏天然放行——与原生 connection 包同一通道）
 * - rpApi：dsht-rp-plugin 的 webServer 前缀路由 /dsht-rp/*（T2.5f：
 *   同源、零端口冲突、无 CORS——旧 3081 独立端口方案已废弃）
 */
let rpcSeq = 0;
/** DSH RPC（同源 /api 信封）。返回 value；业务错误抛异常。
 * 0.1.2 坑 #21：wire 契约变更——method 必须斜杠式（namespace/method，点式被
 * claimsEndpoint 拒绝 → 404 not found），payload 必须包 {args}；响应信封不变。 */
export async function dshRpc(method, payload = {}) {
    const wire = method.replace(/\./g, '/');
    const resp = await fetch(`/api/${wire}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `dsht-rp-ui-${++rpcSeq}`, method: wire, payload: { args: payload } }),
    });
    if (!resp.ok)
        throw new Error(`${method}: HTTP ${resp.status}`);
    const envelope = await resp.json();
    const result = envelope.result;
    if (!result || result.ok === false)
        throw new Error(result?.error?.message ?? `${method} failed`);
    return result.value;
}
/** dsht-rp-plugin 数据面（webServer 前缀路由 /dsht-rp/*，同源）。 */
export async function rpApi(path, payload = {}) {
    const resp = await fetch(`/dsht-rp/${path.replace(/^\//, '')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await resp.json();
    if (body.error)
        throw new Error(String(body.error));
    return body;
}
/** dsht-tavern-helper 数据面（webServer 前缀路由 /dsht-tavern-helper/*，同源）。
 * 世界书 / 预设 / 正则等酒馆助手 API（RpLorePanel 消费；与 RpScriptHost 内部
 * thApi 同形态，那边不导出、不允许动，这里补公共入口）。 */
export async function thApi(path, payload = {}) {
    const resp = await fetch(`/dsht-tavern-helper/${path.replace(/^\//, '')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await resp.json();
    if (body.error)
        throw new Error(String(body.error));
    return body;
}
/** dsht-plugin-memory 数据面 POST（/dsht-memory/*，同源；settings/expand/summarize） */
export async function memApi(path, payload = {}) {
    const resp = await fetch(`/dsht-memory/${path.replace(/^\//, '')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await resp.json();
    if (body.error)
        throw new Error(String(body.error));
    return body;
}
/** dsht-plugin-memory 数据面 GET（/dsht-memory/*?query；health/status） */
export async function memGet(path, query) {
    const resp = await fetch(`/dsht-memory/${path.replace(/^\//, '')}${query ? `?${query}` : ''}`);
    const body = await resp.json();
    if (body.error)
        throw new Error(String(body.error));
    return body;
}
