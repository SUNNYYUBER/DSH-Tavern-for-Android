/**
 * B15：EJS 渲染 Worker（worker_threads 入口——ST compile_workers 的服务端等价物）。
 * esbuild 单独 bundle 为 lib/ejs-worker.js（构建脚本 build-dsht.ps1 Step 5.8）；
 * /render 在 compileWorkers 开启时把渲染任务投给本 Worker，6s 超时回退同步渲染。
 * 消息协议：workerData = {kind:'single'|'messages', engine, template, context, messages?, protectPre?}
 * → postMessage({ok, text} | {ok, messages, rendered, skipped} | {ok:false, kind})。
 */
import { parentPort, workerData } from 'node:worker_threads'
import { renderEjsSubset, renderMessages, protectPreBlocks, restorePreBlocks } from './ejs.ts'
import { renderEjsSandbox, renderMessagesSandbox } from './sandbox.ts'

interface Payload {
  kind: 'single' | 'messages'
  engine: 'subset' | 'sandbox'
  template: string
  context: Record<string, unknown>
  messages?: unknown[]
  protectPre?: boolean
}

const p = workerData as Payload

function run(): unknown {
  if (p.kind === 'single') {
    if (p.engine === 'sandbox') return renderEjsSandbox(p.template, p.context)
    const pre = p.protectPre ? protectPreBlocks(p.template) : { text: p.template, blocks: [] as string[] }
    return { ok: true, text: restorePreBlocks(renderEjsSubset(pre.text, p.context), pre.blocks) }
  }
  const messages = (p.messages ?? []) as Array<{ mes?: string; [k: string]: unknown }>
  if (p.engine === 'sandbox') {
    const pre = p.protectPre ? messages.map(m => protectPreBlocks(String(m?.mes ?? ''))) : []
    const r = renderMessagesSandbox(p.template, p.context, pre.length > 0
      ? messages.map((m, i) => ({ ...m, mes: pre[i].text }))
      : messages)
    // 【心跳 47】原为就地改 `r.messages`——`SandboxMessagesResult` 声明为 `readonly`（sandbox.ts:51），
    // 运行时"侥幸能改"（readonly 只是编译期约束），但属类型契约违背（TS2540）。改为不可变重建。
    if (r.ok && pre.length > 0) {
      return {
        ok: true as const,
        messages: r.messages.map((m, i) => ({ ...m, mes: restorePreBlocks(String(m.mes ?? ''), pre[i]?.blocks ?? []) })),
        rendered: r.rendered,
        skipped: r.skipped,
      }
    }
    return r
  }
  return { ok: true as const, ...renderMessages(p.template, p.context, messages, { protectPre: p.protectPre === true }) }
}

try {
  parentPort?.postMessage(run())
} catch (e) {
  parentPort?.postMessage({ ok: false, kind: 'runtime-error', message: (e as Error)?.message })
}
