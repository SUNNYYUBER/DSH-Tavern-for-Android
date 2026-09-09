#!/usr/bin/env node
// cdp-eval.mjs v2 — 直连 Android WebView page-level CDP，执行 JS 表达式
// 用法: node cdp-eval.mjs [端口=9333] -e "表达式"  |  node cdp-eval.mjs [端口] 表达式文件
import fs from 'node:fs';

const PORT = process.argv[2] || '9333';
let expr = '';
if (process.argv[3] === '-e') expr = process.argv[4];
else if (process.argv[3]) expr = fs.readFileSync(process.argv[3], 'utf8');
else { console.error('用法: node cdp-eval.mjs [端口] -e "expr" | 文件'); process.exit(1); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = list.find(t => t.type === 'page');
if (!target) { console.error('无 page target'); process.exit(1); }
const wsUrl = target.webSocketDebuggerUrl;
console.error('[cdp] 连接:', wsUrl.slice(0, 60));

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise(res => { ws.onopen = res; });

const result = await send('Runtime.evaluate', {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
});
if (result.exceptionDetails) {
  console.log('EXCEPTION:', JSON.stringify(result.exceptionDetails).slice(0, 600));
} else {
  const v = result.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
}
ws.close();
process.exit(0);
