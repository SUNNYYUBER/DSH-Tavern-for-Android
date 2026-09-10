"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * B15：EJS 渲染 Worker（worker_threads 入口——ST compile_workers 的服务端等价物）。
 * esbuild 单独 bundle 为 lib/ejs-worker.js（构建脚本 build-dsht.ps1 Step 5.8）；
 * /render 在 compileWorkers 开启时把渲染任务投给本 Worker，6s 超时回退同步渲染。
 * 消息协议：workerData = {kind:'single'|'messages', engine, template, context, messages?, protectPre?}
 * → postMessage({ok, text} | {ok, messages, rendered, skipped} | {ok:false, kind})。
 */
const node_worker_threads_1 = require("node:worker_threads");
const ejs_ts_1 = require("./ejs.ts");
const sandbox_ts_1 = require("./sandbox.ts");
const p = node_worker_threads_1.workerData;
function run() {
    if (p.kind === 'single') {
        if (p.engine === 'sandbox')
            return (0, sandbox_ts_1.renderEjsSandbox)(p.template, p.context);
        const pre = p.protectPre ? (0, ejs_ts_1.protectPreBlocks)(p.template) : { text: p.template, blocks: [] };
        return { ok: true, text: (0, ejs_ts_1.restorePreBlocks)((0, ejs_ts_1.renderEjsSubset)(pre.text, p.context), pre.blocks) };
    }
    const messages = (p.messages ?? []);
    if (p.engine === 'sandbox') {
        const pre = p.protectPre ? messages.map(m => (0, ejs_ts_1.protectPreBlocks)(String(m?.mes ?? ''))) : [];
        const r = (0, sandbox_ts_1.renderMessagesSandbox)(p.template, p.context, pre.length > 0
            ? messages.map((m, i) => ({ ...m, mes: pre[i].text }))
            : messages);
        if (r.ok && pre.length > 0) {
            r.messages = r.messages.map((m, i) => ({ ...m, mes: (0, ejs_ts_1.restorePreBlocks)(String(m.mes ?? ''), pre[i]?.blocks ?? []) }));
        }
        return r;
    }
    return { ok: true, ...(0, ejs_ts_1.renderMessages)(p.template, p.context, messages, { protectPre: p.protectPre === true }) };
}
try {
    node_worker_threads_1.parentPort?.postMessage(run());
}
catch (e) {
    node_worker_threads_1.parentPort?.postMessage({ ok: false, kind: 'runtime-error', message: e?.message });
}
