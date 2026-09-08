/**
 * DSHTavern 提示词模板插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 3。
 *
 * SillyTavern ST-Prompt-Template（extension_settings.EjsTemplate）的意图级移植：
 * - EJS 子集渲染器（./ejs.ts：纯函数解释执行，不 eval；支持 {{}} 宏、<%=%>/<%-%> 输出、
 *   if/else if/else、for-of、const 赋值与常用表达式语法）——默认引擎；
 * - EJS 沙箱渲染器（./sandbox.ts：Node vm 隔离域执行完整 EJS，timeout 硬中断、
 *   输出上限、确定性防护、失败分类不含模板源码）——engine:'sandbox' 显式启用；
 * - 独立 prompt 注入 store（./injection-store.ts：injectPrompt/getPromptsInjected/
 *   hasPromptsInjected，per-request 生命周期，沙箱经 __host* 桥读写）。
 * - HTTP 数据面 POST /dsht-prompt-template/render {template, context, engine?} → {result}；
 *   带 messages 时按 is_ejs_processed 标记跳过已处理历史消息（ST 同款语义）。
 *
 * 路由前缀 /dsht-prompt-template（避开 /dsht-rp）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { isEjsProcessed, renderEjsSubset, renderMessages, configureEjsCache, protectPreBlocks, restorePreBlocks, type LikeStMessage } from './ejs.ts'
import { renderEjsSandbox, renderMessagesSandbox } from './sandbox.ts'
import type { LoreEntry } from '../lore/entry.ts'
import { readJsonBody, registerPrefix, resolveDshHome, sendJson, type LikePluginContext } from '../dsht-plugin-shared/http.ts'
import { registerSettingsNamespace } from '../dsht-plugin-shared/settings-ns.ts'

export const name = 'dsht-plugin-prompt-template'
// services 声明：webServer = /dsht-prompt-template/* 同源数据面；settings = 命名空间锚点；
// sessions = B8 永久写回（live 会话 replace append + flush，缺省时 409 如实报告）
export const inject = ['webServer', 'settings', 'sessions']

// ---------------------------------------------------------------------------
// B15：Worker 编译（node 侧 worker_threads——ST compile_workers 的服务端等价物）。
// worker.ts 由 esbuild 单独 bundle 到 lib/ejs-worker.js；启用时每请求一个 Worker、
// 6s 超时回退同步渲染（不阻塞主线程的 vm 编译重模板）。
// ---------------------------------------------------------------------------

const workerPath = (() => {
  try { return join(dirname(fileURLToPath(import.meta.url)), 'ejs-worker.js') } catch { return null }
})()

function renderViaWorker<T>(payload: Record<string, unknown>): Promise<T | null> {
  if (!workerPath) return Promise.resolve(null)
  return new Promise<T | null>((resolve) => {
    let settled = false
    let w: Worker | undefined
    const done = (v: T | null): void => {
      if (settled) return
      settled = true
      try { w?.terminate() } catch { /* 已退出 */ }
      resolve(v)
    }
    try {
      w = new Worker(workerPath, { workerData: payload })
      const timer = setTimeout(() => done(null), 6_000)
      timer.unref?.()
      w.on('message', (v: unknown) => { clearTimeout(timer); done(v as T) })
      w.on('error', () => { clearTimeout(timer); done(null) })
      w.on('exit', () => { clearTimeout(timer); done(null) })
    } catch { done(null) }
  })
}

// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）

export function apply(ctx: LikePluginContext, _config: unknown): void {
  const dshHome = resolveDshHome()
  // 任务 C2：设置→插件「可配置」可见性锚点（失败不影响本体）
  registerSettingsNamespace(ctx, 'dsht-plugin-prompt-template', 'dsht-ejs')
  registerPrefix(ctx, '/dsht-prompt-template', 'dsht-ejs', async (sub, req, res) => {
    // ---- /settings GET/PUT：全量设置面（ST-Prompt-Template settings.html 19 项 1:1 对齐）----
    // （须在 POST-only 检查前——GET 也要可达）
    // 语义标注：generateLoader/injectLoader/renderLoader 挂 ST 世界书管线（GENERATE/@INJECT/
    // RENDER 条目注入），当前移植无对应管线——存而标注；其余项全部真实接线（见 /render）。
    if (sub === '/settings') {
      const method = req.method ?? 'GET'
      const p = join(dshHome, 'rp', 'ejs-settings.json')
      // ST 默认值 1:1（settings.html 各 checkbox/option 的初始态）
      const defaults: Record<string, unknown> = {
        enabled: true,               // 扩展总开关（= 旧 renderEnabled，兼容读取）
        generateEnabled: true,       // 生成处理（生成期模板求值）
        generateLoaderEnabled: false,// [GENERATE] 世界书条目注入（ST 默认关）
        injectLoaderEnabled: false,  // @INJECT 世界书条目注入（ST 默认关）
        renderEnabled: true,         // 楼层消息处理
        renderLoaderEnabled: false,  // [RENDER] 世界书条目注入（状态栏渲染，ST 默认关）
        codeBlocks: false,           // 处理 <pre> 代码块
        permanentEvaluation: false,  // 处理原始消息内容
        filterChatMessage: false,    // 生成时忽略楼层模板语句
        chatDepth: -1,               // 楼层处理最大深度（-1 无限制）
        autosaveEnabled: false,      // 自动保存（DSH 自动落盘，项保留标注）
        preloadWorldinfo: false,     // 预载世界书（当前无对应管线）
        withContextDisabled: false,  // 禁用 with 语句块（EJS 编译选项——subset 引擎恒定，sandbox 消费）
        debugEnabled: false,         // 控制台详细日志
        invertEnabled: false,        // 旧特性兼容（无管线——存而标注）
        compileWorkers: false,       // Web Worker 编译（浏览器端编译特性——标注）
        sandbox: false,              // 环境隔离（= 缺省用 vm 沙箱引擎渲染）
        codeEditor: false,           // 世界书代码编辑器（编辑器 UI 特性——标注）
        cacheEnabled: 0,             // 缓存 0 禁用 / 1 启用 / 2 仅世界书
        cacheSize: 0,                // 缓存大小上限（0 不限）
        cacheHasher: 'h32ToString',  // 缓存 hash（h32|h64）
      }
      const loadMerged = async (): Promise<Record<string, unknown>> => {
        const stored = await readFile(p, 'utf8').then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
        const out = { ...defaults }
        for (const k of Object.keys(defaults)) {
          const s = stored[k]
          if (s === undefined) continue
          // 旧安装兼容：只有 renderEnabled 时映射到 enabled
          if (k === 'enabled' && stored.enabled === undefined && stored.renderEnabled !== undefined) {
            out.enabled = stored.renderEnabled !== false
            continue
          }
          out[k] = s
        }
        return out
      }
      if (method === 'GET') return sendJson(res, 200, await loadMerged())
      if (method === 'PUT' || method === 'POST') {
        const body = await readJsonBody(req) as Record<string, unknown> | null
        if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'bad json' })
        const merged = await loadMerged()
        for (const k of Object.keys(defaults)) {
          if (!(k in body)) continue
          const v = (body as Record<string, unknown>)[k]
          const d = defaults[k]
          if (typeof d === 'boolean' && typeof v === 'boolean') merged[k] = v
          else if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) merged[k] = v
          else if (typeof d === 'string' && typeof v === 'string') merged[k] = v
        }
        if (merged.chatDepth !== undefined) {
          const cd = merged.chatDepth as number
          merged.chatDepth = Math.max(-1, Math.min(100, Math.round(cd)))
        }
        if (merged.cacheEnabled !== 0 && merged.cacheEnabled !== 1 && merged.cacheEnabled !== 2) merged.cacheEnabled = 0
        if (merged.cacheHasher !== 'h32ToString' && merged.cacheHasher !== 'h64ToString') merged.cacheHasher = 'h32ToString'
        await mkdir(dirname(p), { recursive: true })
        await writeFile(p, JSON.stringify(merged, null, 1), 'utf8')
        console.log(`[dsht-ejs] settings: enabled=${merged.enabled} generateEnabled=${merged.generateEnabled} renderEnabled=${merged.renderEnabled} chatDepth=${merged.chatDepth}`)
        return sendJson(res, 200, { ok: true, settings: merged })
      }
      return sendJson(res, 405, { error: 'GET/PUT only' })
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })

    // ---- /render {template, context, messages?, engine?} → {result} 或 {messages, rendered, skipped} ----
    if (sub === '/render') {
      const body = await readJsonBody(req)
      if (!body) return sendJson(res, 400, { error: 'bad json' })
      // 全量设置（/settings 同款 defaults-merge 读取）
      const cfg = await readFile(join(dshHome, 'rp', 'ejs-settings.json'), 'utf8')
        .then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
      const flag = (k: string, dflt = true): boolean => cfg[k] === undefined ? dflt : cfg[k] === true
      const depthLimit = typeof cfg.chatDepth === 'number' ? cfg.chatDepth : -1
      // 总开关：关闭 = 全部原样透传（不做任何 EJS 替换）。
      // 【实机测试修复 2026-09-05】原写法 `if (flag('enabled'))` 反了——开启时反而整体
      // 透传（B5/B7 长期"看似接线实为直通"的真因）。取反后才与 ST enabled 语义一致。
      if (!flag('enabled')) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: (body.messages as unknown[]).length })
        return sendJson(res, 200, { result: String(body.template ?? '') })
      }
      // 相位门控：phase==='generate'（生成期）走 generateEnabled；缺省/渲染走 renderEnabled
      const phase = body.phase === 'generate' ? 'generate' : 'render'
      if (phase === 'generate' && !flag('generateEnabled')) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: (body.messages as unknown[]).length })
        return sendJson(res, 200, { result: String(body.template ?? '') })
      }
      if (phase === 'render' && !flag('renderEnabled')) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: (body.messages as unknown[]).length })
        return sendJson(res, 200, { result: String(body.template ?? '') })
      }
      const template = String(body.template ?? '')
      const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
        ? body.context as Record<string, unknown>
        : {}
      // engine 缺省：设置 sandbox=true（ST 环境隔离）时用 vm 沙箱引擎，否则 subset
      const engine = body.engine === 'sandbox' ? 'sandbox' : body.engine === 'subset' ? 'subset' : (cfg.sandbox === true ? 'sandbox' : 'subset')
      // B19：编译缓存接线（cacheEnabled 1/2 + cacheSize + cacheHasher）
      configureEjsCache({
        enabled: (typeof cfg.cacheEnabled === 'number' ? cfg.cacheEnabled : 0) as 0 | 1 | 2,
        size: typeof cfg.cacheSize === 'number' ? cfg.cacheSize : 0,
        hasher: cfg.cacheHasher === 'h64ToString' ? 'h64ToString' : 'h32ToString',
      })
      // B7：code_blocks 关（默认）= <pre> 块不做模板求值（保护）；开 = 一并处理
      const protectPre = cfg.codeBlocks !== true
      // debugEnabled：控制台详细日志（ST debug_enabled 同语义）
      const dbg = flag('debugEnabled', false)
      // B15：compileWorkers 开 = worker_threads 渲染（失败/超时回退同步）
      const wantWorker = cfg.compileWorkers === true && workerPath !== null
      try {
        if (Array.isArray(body.messages)) {
          // chatDepth 楼层深度过滤（ST 同语义：仅处理深度 < 上限的楼层，-1 无限制；
          // 深度 = 距最新楼层的距离，0 = 最新楼）。渲染后按原位置回填——输出楼层数与顺序不变。
          const all = body.messages as LikeStMessage[]
          const eligibleIdx: number[] = []
          all.forEach((m, i) => {
            const depth = all.length - 1 - i
            if (depthLimit < 0 || depth < depthLimit) eligibleIdx.push(i)
          })
          const filtered = eligibleIdx.map(i => all[i])
          if (dbg) console.log(`[dsht-ejs] render messages: depthLimit=${depthLimit} in=${all.length} eligible=${filtered.length}`)
          let r: { ok?: boolean; kind?: string; messages?: LikeStMessage[]; rendered?: number; skipped?: number } | null = null
          if (wantWorker) {
            r = await renderViaWorker<{ ok: boolean; messages: LikeStMessage[]; rendered: number; skipped: number } | { ok: false; kind: string }>({
              kind: 'messages', engine, template, context, messages: filtered, protectPre,
            })
          }
          if (!r) {
            if (engine === 'sandbox') {
              // 沙箱引擎的 B7：先剥 <pre> 再渲染，渲染后按序还原
              const preList = protectPre ? filtered.map(m => protectPreBlocks(String(m.mes ?? ''))) : []
              const rs = renderMessagesSandbox(template, context, preList.length > 0
                ? filtered.map((m, i) => ({ ...m, mes: preList[i].text }))
                : filtered)
              if (rs.ok && preList.length > 0) {
                rs.messages = rs.messages.map((m, i) => ({ ...m, mes: restorePreBlocks(String(m.mes ?? ''), preList[i]?.blocks ?? []) }))
              }
              r = rs
            } else {
              // 【审查修复 2026-09-05】subset 引擎返回值无 ok 字段——不包装则 !r.ok 恒真 → messages 渲染恒 400
              r = { ok: true as const, ...renderMessages(template, context, filtered, { protectPre }) }
            }
          }
          if (!r.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${r.kind}` })
          const outMsgs = [...all]
          eligibleIdx.forEach((origIdx, k) => { outMsgs[origIdx] = (r!.messages as LikeStMessage[])[k] })
          if (dbg) console.log(`[dsht-ejs] render messages (${engine}${wantWorker ? '+worker' : ''}): rendered=${r.rendered} skipped=${r.skipped}`)
          return sendJson(res, 200, { messages: outMsgs, rendered: r.rendered, skipped: r.skipped + (all.length - eligibleIdx.length) })
        }
        if (!template.trim()) return sendJson(res, 400, { error: 'template required' })
        if (wantWorker) {
          const wr = await renderViaWorker<{ ok: true; text: string } | { ok: false; kind: string }>({
            kind: 'single', engine, template, context, protectPre,
          })
          if (wr) {
            if (!wr.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${wr.kind}` })
            if (dbg) console.log(`[dsht-ejs] render (sandbox, worker, ${phase}): ${template.length}ch → ${wr.text.length}ch`)
            return sendJson(res, 200, { result: wr.text })
          }
          // Worker 不可用 → 落同步
        }
        if (engine === 'sandbox') {
          const r = renderEjsSandbox(template, context)
          if (!r.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${r.kind}` })
          if (dbg) console.log(`[dsht-ejs] render (sandbox, ${phase}): ${template.length}ch → ${r.text.length}ch`)
          return sendJson(res, 200, { result: r.text })
        }
        const rendered0 = renderEjsSubset(template, context)
        const result = restorePreBlocks(renderEjsSubset(protectPre ? protectPreBlocks(template).text : template, context), protectPre ? protectPreBlocks(template).blocks : [])
        void rendered0
        if (dbg) console.log(`[dsht-ejs] render (${phase}): ${template.length}ch → ${result.length}ch`)
        return sendJson(res, 200, { result })
      } catch (e) {
        return sendJson(res, 400, { error: (e as Error).message })
      }
    }

    // ---- /check {messages} → 每条消息的 is_ejs_processed 判定（迁移管线诊断用）----
    if (sub === '/check') {
      const body = await readJsonBody(req)
      const messages = Array.isArray(body?.messages) ? body.messages as LikeStMessage[] : []
      return sendJson(res, 200, { processed: messages.map(isEjsProcessed) })
    }

    // ---- B8：/permanent {sessionId, seq, text} → 永久写回（ST permanent_evaluation 同语义：
    // 渲染结果替换原楼层正文 + ejsProcessed 标记；仅 live 会话——surfaceOp replace 原语）----
    if (sub === '/permanent') {
      const body = await readJsonBody(req)
      const sessionId = String(body?.sessionId ?? '')
      const seq = Number(body?.seq ?? -1)
      const text = String(body?.text ?? '')
      if (!sessionId || !Number.isInteger(seq) || seq < 0 || !text.trim()) {
        return sendJson(res, 400, { error: 'sessionId/seq/text required' })
      }
      const sessions = (ctx as { sessions?: { get?: (id: string) => unknown; flush?: (s: unknown) => Promise<boolean> } }).sessions
      const session = sessions?.get?.(sessionId)
      if (!session) return sendJson(res, 409, { error: 'session not live（B8 永久写回仅支持已打开的会话）' })
      const sAt = (session as { eventAt?: (q: number) => { type?: string; data?: unknown } | undefined }).eventAt
      const ev = typeof sAt === 'function' ? sAt.call(session, seq) : undefined
      if (!ev || ev.type !== 'assistant/message') return sendJson(res, 400, { error: `seq=${seq} 不是 assistant/message` })
      const msg = (ev.data as { message?: Record<string, unknown> } | undefined)?.message
      if (!msg) return sendJson(res, 400, { error: '事件缺 message 字段' })
      if ((msg.source as Record<string, unknown> | undefined)?.ejsProcessed === true) {
        return sendJson(res, 200, { ok: true, note: '已处理（幂等跳过）' })
      }
      const append = (session as { append?: (t: string, d: unknown, o?: unknown) => unknown }).append
      if (typeof append !== 'function') return sendJson(res, 500, { error: 'session.append 不可用' })
      append.call(session, 'assistant/message', {
        ...(ev.data as object),
        message: {
          ...msg,
          content: [{ type: 'text', text }],
          // 【2026-09-07 损坏根修】必须保留原 source.kind（加载器强校验 assistant
          // 消息 source.kind ∈ {gateway, internal}——写 'plugin' 会让整个会话
          // "failed validation: message must have model source" 拒载（真机实证，
          // 用户迁移会话差点报废）。只在原 source 上追加插件标记。
          source: { ...(msg.source as object ?? {}), plugin: 'dsht-ejs', ejsProcessed: true },
        },
        // 【2026-09-07 500 根修】surfaceOp replace 的血缘 seqs 必须覆盖全部被 shadow
        // 的 surface 节点——session.append 的 surface 元数据键名是 sourceEventSeqs
        // （dsh-session append: opts[0].sourceEventSeqs → 事件字段）。缺失会被
        // assertProvenance 拒绝（"missing <seq>" 500，真机 B8 写回全数失败）。
      }, { surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq] })
      try {
        if (typeof sessions?.flush === 'function') await sessions.flush.call(sessions, session)
      } catch (e) {
        return sendJson(res, 500, { error: `写回成功但 flush 失败：${(e as Error).message}` })
      }
      console.log(`[dsht-ejs] permanent: session=${sessionId} seq=${seq} → ${text.length}ch 已写回`)
      return sendJson(res, 200, { ok: true })
    }

    // ---- B6：GET /render-entries?slug=&sessionId= → [RENDER:BEFORE/AFTER] 条目求值结果
    // （ST handleMessageRender 的 RENDER 注入——显示期把条目内容包裹楼层正文前/后；
    // 世界书条目不看关键词激活，恒输出；EJS subset/sandbox 求值 + 变量表注入 context）----
    if (sub === '/render-entries') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const slug = String(url.searchParams.get('slug') ?? '')
      const sessionId = String(url.searchParams.get('sessionId') ?? '')
      if (!slug) return sendJson(res, 400, { error: 'slug required' })
      const cfg = await readFile(join(dshHome, 'rp', 'ejs-settings.json'), 'utf8')
        .then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
      if (cfg.enabled === false || cfg.renderLoaderEnabled !== true) {
        return sendJson(res, 200, { before: '', after: '', note: 'renderLoader 未启用' })
      }
      const rp = await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')
        .then(t => JSON.parse(t) as { characterName?: string; macros?: { user?: string; char?: string }; books?: Array<{ lorePath?: string }> })
        .catch(() => null)
      if (!rp) return sendJson(res, 404, { error: `rp.json not found: ${slug}` })
      const entries: LoreEntry[] = []
      for (const b of rp.books ?? []) {
        if (!b?.lorePath) continue
        const book = await readFile(join(dshHome, b.lorePath), 'utf8')
          .then(t => JSON.parse(t) as { entries?: LoreEntry[] })
          .catch(() => null)
        if (book && Array.isArray(book.entries)) entries.push(...book.entries)
      }
      const act = (e: LoreEntry): boolean => {
        if (cfg.invertEnabled === true) return true // B18：旧特性兼容——禁用视为启用
        return (e as { disable?: unknown }).disable !== true
      }
      const targets = entries.filter(e => /\[\s*RENDER/i.test(e.content) && act(e))
      const vars = sessionId
        ? await readFile(join(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8')
          .then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
        : {}
      const context = {
        user: rp.macros?.user || '用户',
        char: rp.macros?.char || rp.characterName || '角色',
        variables: vars.variables ?? {}, state: vars.state ?? {},
      }
      const evalOne = (content: string): string => {
        const stripped = content.replace(/\[\s*RENDER\s*[:：]?[^\]]*\]/gi, '').trim()
        if (cfg.sandbox === true) {
          const r = renderEjsSandbox(stripped, context)
          return r.ok ? r.text : ''
        }
        return renderEjsSubset(stripped, context)
      }
      const parts = { before: [] as string[], after: [] as string[] }
      for (const e of targets) {
        const isAfter = /\[\s*RENDER\s*[:：]\s*AFTER\s*\]/i.test(e.content)
        parts[isAfter ? 'after' : 'before'].push(evalOne(e.content))
      }
      return sendJson(res, 200, { before: parts.before.filter(Boolean).join('\n'), after: parts.after.filter(Boolean).join('\n') })
    }

    return sendJson(res, 404, { error: 'unknown endpoint' })
  })
}
