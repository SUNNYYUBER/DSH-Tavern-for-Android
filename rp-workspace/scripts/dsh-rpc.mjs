#!/usr/bin/env node
/**
 * dsh-rpc.mjs — 经 CDP 以「已认证」身份调用 DSHT 运行时 API
 * =====================================================================
 * 背景（2026-09-10 实证）：
 *   · 运行时 HTTP 端口 = 设备 127.0.0.1:3080 → `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
 *   · 直接 curl :3080 得 401；但**在 WebView 页面上下文里 fetch 自带会话凭据** → 免 token
 *   · 契约（实测）：POST /api/<controller>/<method>，body 必须是信封：
 *       { "type":"client-request", "rpcId":"<字符串>", "method":"<斜杠式>", "payload":{...} }
 *     否则 gateway 回 `gateway/bad-request: invalid client-request message`
 *   · 探针入口：`performance.getEntriesByType('resource')` 可列出 UI 真实调用过的端点
 *
 * 用法：
 *   node dsh-rpc.mjs <path> <method> [payloadJson] [--port 9333]
 * 例：
 *   node dsh-rpc.mjs /api/session/list session/list '{}'
 */
import process from "node:process";

const argv = process.argv.slice(2);
const portIdx = argv.indexOf("--port");
const PORT = portIdx >= 0 ? argv[portIdx + 1] : "9333";
const rest = argv.filter((a, i) => i !== portIdx && i !== portIdx + 1);
const [pathname, method, payloadJson = "{}"] = rest;

if (!pathname || !method) {
  console.error(
    "用法: node dsh-rpc.mjs <path> <method> [payloadJson] [--port 9333]",
  );
  process.exit(1);
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((x) => x.type === "page");
if (!page) {
  console.error("无 page target（先 adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>）");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++seq;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
await new Promise((r) => {
  ws.onopen = r;
});

const envelope = {
  type: "client-request",
  rpcId: `dsht-rpc-${Date.now()}`,
  method,
  payload: JSON.parse(payloadJson),
};
const expr = `fetch(${JSON.stringify(pathname)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(
  JSON.stringify(envelope),
)}}).then(r=>r.text()).then(t=>'HTTPOK '+t).catch(e=>'FETCHERR '+e)`;

const r = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});
if (r.exceptionDetails) {
  console.error("EVALERR", JSON.stringify(r.exceptionDetails).slice(0, 500));
  process.exit(1);
}
const out = String(r.result.value ?? "");
if (!out) {
  console.error("EMPTY — 原始返回:", JSON.stringify(r).slice(0, 600));
  process.exit(2);
}
const body = out.startsWith("HTTPOK ") ? out.slice(7) : out;
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}
ws.close();
