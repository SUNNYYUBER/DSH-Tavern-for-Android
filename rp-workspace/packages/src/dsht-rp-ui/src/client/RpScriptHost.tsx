/**
 * 酒馆助手（TavernHelper）脚本运行时宿主——conversation.input.dock 席位。
 *
 * 验收意图：ST 酒馆助手核心功能之一是加载执行脚本库；本组件把已落盘的
 * tavern-helper-scripts.json（预设 + 卡两作用域 enabled 脚本）真正跑起来。
 *
 * - 执行形态：每脚本一个 sandbox="allow-scripts" srcdoc iframe（不给 same-origin，
 *   脚本为不可信代码），iframe 铺满会话视口（position:fixed inset:0、pointer-events:none）
 *   ——脚本自渲染的 fixed 部件视觉等效 ST 顶层注入；交互走脚本按钮面板。
 *   会话级单例（sessionId → SessionRuntime，iframe 挂 document.body，跨组件重挂载存活）。
 * - TavernHelper shim：iframe 内注入 window.TavernHelper + 裸全局，postMessage 桥到本宿主，
 *   再调 /dsht-tavern-helper/* 数据面（变量六作用域 / 预设 CRUD / 聊天消息只读 / 正则 /
 *   世界书名单与条目读）/ 本地事件总线。
 * - 上下文快照：start / reloadAll 装载脚本后、以及每次 generation_ended 投递后，拉
 *   /context + /chat/messages 合并成快照，postMessage({th:'context'}) 推给全部 iframe
 *   ——iframe 内 getContext() / SillyTavern.getContext() 同步读（推送失败静默不影响脚本）。
 * - 事件投递：diff 会话快照（chat.order 长度 / 末条 kind / running）→
 *   MESSAGE_SENT / MESSAGE_RECEIVED / GENERATION_STARTED / GENERATION_ENDED；
 *   【实机审计修复 2026-09-05】补投 CHAT_CHANGED（会话打开）与 message_swiped / message_edited
 *   （RpNativeChat 变体切换 / 会话编辑成功回调经 TH_HOST_EVENT CustomEvent 桥入）。
 * - 失败诚实化：单脚本抛错/超时只标记自身；调到 shim 没有的 API 记名，
 *   面板逐脚本显示 状态（运行中/失败原因/缺什么 API）。
 * - C15 最小 Toolbox：面板内「日志」抽屉（iframe console 经 th:console 桥实时汇入，
 *   最多 200 条）与「变量」查看器（GET /dsht-mvu/variables 只读 JSON 树）。
 * - D8 通知：桥上 422（variableSchema 校验失败）console.warn + 开关放行时 DOM toast
 *   （rp/mvu-settings.json 的 mvu_notification_failure/success 类键，缺省静默）。
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { rpApi } from './rpc.ts'
import { useRpSlug } from './RpStateFloat.tsx'
import { notifyDisplayMutation } from './RpNativeChat.tsx'
import {
  buildIframeDocument, deepMergeAssign, deepMergeInsert, getButtonEventId, handleBridgeCall,
  parseIncomingMessage, type ScriptStatus, type SessionScript, type ThBridgeDeps, type ThChatMessage,
  type ThContextSnapshot, type VarScope,
} from './th-shim.ts'

// 【Kemini 适配 2026-09-08】这些桥 API 成功后需要失效 RP 显示面缓存并重渲染
// （display 正则三源 / 预设 prompt_order·regex_scripts 直接影响楼层 display 管线）
const TH_DISPLAY_MUTATION_APIS = new Set([
  'regexes:replace', 'preset:put', 'preset:delete', 'preset:rename', 'preset:load', 'display:reload',
])

// getTavernHelperVersion 必须返回真 TH 语义的 semver：MVU bundle 等脚本会拿它跑
// compare-versions（>= 4.0.14 判定）——非 semver 字符串会让整包 ready 回调炸掉、Mvu 挂不上。
// 构建标记另存 __DSHT_SHIM_BUILD__（不进脚本版本判定）。
const SHIM_VERSION = '4.8.5' // 对齐真 TH 大版本（脚本兼容性判定用）
export { SHIM_VERSION }
const SHIM_BUILD = 'dsht-th-shim/6-toolbox' // /6：C7/C8/C9/C15/C17/C18/D6/D8 扩展面 + console 桥
const READY_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// 数据面（/dsht-tavern-helper/*；与 rpApi 同约定，前缀不同）
// ---------------------------------------------------------------------------

// D8：422（variableSchema 校验失败）通知钩子——thApi 是模块级函数拿不到运行时实例，
// SessionRuntime 构造时注入；开关（rp/mvu-settings.json 的 mvu_notification_failure 类键）
// 由 notifyUser 统一裁决，关 = 只 console.warn。
let schemaFailureNotifier: ((message: string) => void) | null = null

// 【2026-09-07 轮询风暴截流】卡脚本 masterLoop/心跳 高频轮询同一批读端点
// （chat/messages 每次含 1.5MB 全量消息）。后端已有 mtime 缓存，但 HTTP 往返+
// JSON 序列化在模拟器上仍秒级——多个脚本同帧轮询同一端点会重复消耗连接池
// （Chromium 每 host 6 连接，超配额 fetch 直接 "Failed to fetch"）。
// 此处做 ①同 key in-flight 合并（并发调用共享同一 Promise）②读端点 1200ms
// TTL 缓存（一次轮询风暴 N 个脚本只打一发 HTTP）。写端点不缓存且清空读缓存。
const TH_API_READ_TTL_MS = 1200
const thApiReadCache = new Map<string, { at: number; value: unknown }>()
const thApiInFlight = new Map<string, Promise<unknown>>()

function thApiCacheKey(path: string, payload: unknown, method: string): string {
  return `${method} ${path} ${method === 'GET' ? '' : JSON.stringify(payload)}`
}

function thApiInvalidateReads(): void {
  thApiReadCache.clear()
}

async function thApiRaw<T = unknown>(path: string, payload: unknown = {}, method = 'POST'): Promise<T> {
  const resp = await fetch(`/dsht-tavern-helper/${path.replace(/^\//, '')}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
  })
  const body = await resp.json() as T & { error?: string }
  if ((body as { error?: string }).error) {
    if (resp.status === 422) {
      console.warn('[dsht-th] 变量结构校验失败（422）:', path, body)
      schemaFailureNotifier?.(String((body as { error?: string }).error))
    }
    throw new Error(String((body as { error?: string }).error))
  }
  return body
}

async function thApi<T = unknown>(path: string, payload: unknown = {}, method = 'POST'): Promise<T> {
  const key = thApiCacheKey(path, payload, method)
  const now = Date.now()
  const hit = thApiReadCache.get(key)
  if (hit && now - hit.at < TH_API_READ_TTL_MS) return hit.value as T
  const inflight = thApiInFlight.get(key)
  if (inflight) return inflight as Promise<T>
  const p = thApiRaw<T>(path, payload, method)
    .then((value) => {
      // 写端点（POST 变更类）成功后清读缓存；读端点写缓存（generate-raw 是生成非读——raw 归写类，禁缓存）
      if (/(put|insert|update|replace|delete|merge|create|set|rename|raw|generate)/i.test(path)) thApiInvalidateReads()
      else thApiReadCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => { thApiInFlight.delete(key) })
  thApiInFlight.set(key, p)
  return p
}

/** D8：轻量 DOM toast（右下角浮层；4s 自动消失——比 window alert 温和，不阻塞脚本） */
function showDomToast(level: 'error' | 'success', message: string): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.textContent = message
  el.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:14vh', 'z-index:99999', 'max-width:340px',
    'padding:8px 12px', 'border-radius:8px', 'font-size:12px', 'line-height:1.5', 'color:#fff',
    level === 'error' ? 'background:#b3261e' : 'background:#2e7d32',
    'opacity:0.95', 'box-shadow:0 4px 12px rgba(0,0,0,.4)', 'pointer-events:none',
  ].join(';')
  document.body.append(el)
  setTimeout(() => el.remove(), 4000)
}

async function thVarsGet(scope: VarScope, slug: string, sessionId: string, scriptId: string): Promise<Record<string, unknown>> {
  // message 作用域 = MVU 合并视图（state⊕variables）——真 TH「最新楼层变量快照」语义的
  // 通用承载：任何 MVU 卡 getVariables({type:'message', message_id:-1}).stat_data 都成立
  if (scope === 'message') {
    const resp = await fetch(`/dsht-mvu/variables?sessionId=${encodeURIComponent(sessionId)}`)
    const body = await resp.json() as { variables?: Record<string, unknown>; error?: string }
    if (body.error) throw new Error(body.error)
    return body.variables ?? {}
  }
  const q = new URLSearchParams({ scope })
  if (slug) q.set('slug', slug)
  if (sessionId) q.set('sessionId', sessionId)
  if (scriptId) q.set('scriptId', scriptId)
  const resp = await fetch(`/dsht-tavern-helper/variables?${q.toString()}`)
  const body = await resp.json() as { variables?: Record<string, unknown>; error?: string }
  if (body.error) throw new Error(body.error)
  return body.variables ?? {}
}

/** message 作用域写 = MVU 合并视图读改写 → /dsht-mvu/variables/register {replace:true}
 * （MVU 树单一权威落点；脚本 replaceVariables/insertOrAssignVariables 到 message 作用域
 * 不落 tavern chat 树，避免与 MVU 框架写路径互相覆盖） */
async function thMessageVarsRegister(sessionId: string, variables: Record<string, unknown>): Promise<void> {
  const resp = await fetch('/dsht-mvu/variables/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, variables, replace: true }),
  })
  const body = await resp.json() as { error?: string }
  if (body.error) throw new Error(body.error)
}

async function thMessageVarsPut(sessionId: string, mode: 'assign' | 'insert', vars: Record<string, unknown>): Promise<void> {
  const cur = await thVarsGet('message', '', sessionId, '')
  const next = mode === 'insert' ? deepMergeInsert(cur, vars) : deepMergeAssign(cur, vars)
  await thMessageVarsRegister(sessionId, next)
}

/** message 作用域按 lodash 路径删除（读改写全树后回写） */
async function thMessageVarsDelete(sessionId: string, path: string): Promise<void> {
  const cur = await thVarsGet('message', '', sessionId, '')
  const next = structuredClone(cur)
  // lodash 路径分段（a.b[0].c / a['b-c']）——与 for-session.ts lodashPathToPointer 同语义
  const segs = Array.from(path.matchAll(/\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[(\d+)\]|([^.[]+)/g)
    .map(m => m[1] ?? m[2] ?? m[3] ?? m[4])
    .filter(Boolean)) as string[]
  if (segs.length > 0) {
    let node: Record<string, unknown> = next
    for (let i = 0; i < segs.length - 1; i++) {
      const nxt = node[segs[i]]
      if (nxt === null || typeof nxt !== 'object') return
      node = nxt as Record<string, unknown>
    }
    delete node[segs[segs.length - 1]]
  }
  await thMessageVarsRegister(sessionId, next)
}

// ---------------------------------------------------------------------------
// 会话运行时（会话级单例）
// ---------------------------------------------------------------------------

/** 【实机审计修复 2026-09-05】RpNativeChat 成功回调 → TH 事件桥（message_swiped/message_edited）：
 * 变体切换 / 会话编辑成功处 dispatch 的 window CustomEvent 名（detail: {sessionId, eventType, messageId}） */
export const TH_HOST_EVENT = 'dsht-rp-ui:th-host-event'

/** chat.nodes 迭代形状（key/kind 顶层 + data.finalNode.messageId 楼层解析 + data.blocks 流式文本源）
 *  【实机验证修复 2026-09-06】kind 在节点顶层（dsh-client-ui-chat chatNode() :3977-3988），
 *  且 surface.nodes 是 seq 数字数组（client-connection createFoldState :669-674）——
 *  旧代码从 surface.nodes 读 .kind 恒 undefined，message_sent/received 从未真正投递过。 */
interface SessionSnapshotLike {
  chat?: {
    order?: readonly unknown[]
    nodes?: { values: () => Iterable<{ key?: unknown; kind?: unknown; data?: { status?: string; finalNode?: { messageId?: string }; blocks?: ReadonlyArray<{ kind?: string; text?: string }> } }> }
  }
  surface?: { nodes?: readonly unknown[] }
  running?: boolean
}

interface ToastEntry { ts: number; level: string; message: string; scriptId: string }

/** C15：脚本 iframe console 日志条目（th:console 桥；最多保留 200 条） */
interface ConsoleEntry { ts: number; level: string; message: string; scriptId: string }

class SessionRuntime {
  readonly sessionId: string
  readonly slug: string
  readonly secret: string
  scripts: SessionScript[] = []
  readonly statuses = new Map<string, ScriptStatus>()
  readonly toasts: ToastEntry[] = []
  readonly logs: ConsoleEntry[] = []
  private readonly frames = new Map<string, HTMLIFrameElement>()
  private container: HTMLDivElement | null = null
  private started = false
  private readonly uiListeners = new Set<() => void>()
  private prevOrder = -1
  private prevRunning = false
  private destroyed = false
  /** 最近一次 advance 的会话快照（messageId → 楼层号解析用；message_swiped/edited 桥） */
  private lastSnapshot: SessionSnapshotLike | null = null
  /** 流式 token 上一次投递的累计文本长度（running 期逐次 diff） */
  private prevStreamLen = 0
  /** 最近一次成功组装的上下文快照（regexes/replace preset 作用域解析 presetId 用） */
  /** 快照最新值（P3a：getRpContextSnapshot 读它做楼层帧 bootstrap） */
  contextSnapshot: ThContextSnapshot | null = null
  /** C15：console 转发的节流刷新计时器（高日志频脚本不刷爆 React） */
  private consoleNotifyTimer = 0
  /** D8：MVU 通知开关（GET /dsht-mvu/settings 懒加载缓存；null = 未加载） */
  private notifySwitches: { failure: boolean; success: boolean } | null = null

  constructor(sessionId: string, slug: string) {
    this.sessionId = sessionId
    this.slug = slug
    this.secret = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    // D8：thApi 收到 422 时经钩子走通知（开关放行才 toast，默认静默）
    schemaFailureNotifier = (message) => this.notifyUser('failure', `变量结构校验失败：${message}`)
  }

  /** UI 订阅（脚本面板刷新） */
  subscribe(fn: () => void): () => void {
    this.uiListeners.add(fn)
    return () => { this.uiListeners.delete(fn) }
  }
  private notify(): void {
    for (const fn of this.uiListeners) {
      try { fn() } catch { /* UI 订阅者异常不影响运行时 */ }
    }
  }

  get scriptCount(): number { return this.scripts.length }

  /** 拉取并装载脚本（幂等；started 守卫） */
  start(): void {
    if (this.started || this.destroyed) return
    this.started = true
    void thApi<{ scripts?: SessionScript[] }>('scripts/for-session', { sessionId: this.sessionId, slug: this.slug })
      .then(r => {
        if (this.destroyed) return
        this.scripts = Array.isArray(r.scripts) ? r.scripts : []
        for (const s of this.scripts) this.mountScript(s)
        // 装载完成后拉一次上下文快照推给 iframe（getContext 同步面就绪）
        this.loadContextSnapshot()
        // 【实机审计修复 2026-09-05】chat_id_changed（ST CHAT_CHANGED）：会话打开（运行时
        // 创建首次 start、脚本装载完成）时投递一次，参数 = 会话 id（ST 传 chat 文件名的等价位）
        this.emitSessionEvent('chat_id_changed', [this.sessionId])
        this.notify()
      })
      .catch(e => {
        console.warn('[dsht-th] scripts/for-session 拉取失败:', (e as Error).message)
        this.notify()
      })
  }

  /** 重载全部脚本（真 TH reloadAll 同款：销毁 iframe 重建） */
  reloadAll(): void {
    this.mountGen += 1 // 【鲁棒轮】让 await 窗口内的旧 mountScript 续体全部放弃
    for (const f of this.frames.values()) f.remove()
    this.frames.clear()
    for (const s of this.scripts) this.mountScript(s)
    // 重建的 iframe 没有快照记忆：重推一次
    this.loadContextSnapshot()
    this.notify()
  }

  // ---- 消息楼层 guest shim（2026-09-06 视觉验收：真 TH 对 message iframe 注入
  //  predefine.js——卡内脚本（示例游戏状态栏等）在楼层 iframe 直接调 getAllVariables/Mvu）----
  /** guest 桥路由表（React 管理的楼层 iframe；destroy/reloadAll 不 remove 它们） */
  private readonly guestFrames = new Map<string, HTMLIFrameElement | null>()
  private guestSeq = 0

  /** 预约一个 guest 楼层桥（建 statuses 前先给路由占位）；返回桥参数供建文档用 */
  reserveGuestFrame(): { scriptId: string; secret: string } {
    const scriptId = `msgframe-${++this.guestSeq}`
    this.guestFrames.set(scriptId, null)
    return { scriptId, secret: this.secret }
  }

  attachGuestFrame(scriptId: string, iframe: HTMLIFrameElement): void {
    if (this.guestFrames.has(scriptId)) this.guestFrames.set(scriptId, iframe)
    // 【P3a 2026-09-07】楼层帧挂载晚于快照推送时补推
    this.pushContextToGuest(scriptId)
  }

  /** 快照补推（重试梯子 0/400/1200/2800ms）：postMessage 在 srcdoc shim 消息监听器
   * 安装前 posting 会丢（vendor bundle 同步求值窗口），幂等覆盖无副作用 */
  private pushContextToGuest(scriptId: string): void {
    if (!this.contextSnapshot) return
    for (const delay of [0, 400, 1200, 2800]) {
      setTimeout(() => {
        if (this.destroyed) return
        const cur = this.guestFrames.get(scriptId)
        if (!cur || !this.contextSnapshot) return
        cur.contentWindow?.postMessage({
          '__dsht_th': true, secret: this.secret, scriptId,
          th: 'context', context: this.contextSnapshot,
        }, '*')
      }, delay)
    }
  }

  releaseGuestFrame(scriptId: string): void {
    this.guestFrames.delete(scriptId)
  }

  /** 桥消息路由判定（脚本帧 + guest 楼层帧统一入口） */
  hasBridge(scriptId: string): boolean {
    return this.statuses.has(scriptId) || this.guestFrames.has(scriptId)
  }

  destroy(): void {
    this.destroyed = true
    this.mountGen += 1 // 【鲁棒轮】让 await 窗口内的旧 mountScript 续体全部放弃
    if (this.consoleNotifyTimer) { clearTimeout(this.consoleNotifyTimer); this.consoleNotifyTimer = 0 }
    for (const f of this.frames.values()) f.remove()
    this.frames.clear()
    this.guestFrames.clear() // guest 楼层帧由 React 卸载自清理，这里只摘路由
    this.container?.remove()
    this.container = null
    this.uiListeners.clear()
  }

  // ---- D8：MVU 通知（开关裁决 + DOM toast + 面板最近提示） ----

  /** rp/mvu-settings.json 的通知开关（mvu_notification_failure / mvu_notification_success 类键；缺省全关） */
  private async notifySwitchesLoaded(): Promise<{ failure: boolean; success: boolean }> {
    if (this.notifySwitches) return this.notifySwitches
    let sw = { failure: false, success: false }
    try {
      const resp = await fetch('/dsht-mvu/settings')
      const body = await resp.json() as { settings?: Record<string, unknown> }
      const st = body.settings ?? {}
      sw = {
        failure: st['mvu_notification_failure'] === true || st['notification_failure'] === true,
        success: st['mvu_notification_success'] === true || st['notification_success'] === true,
      }
    } catch { /* 设置读取失败 = 全关（默认静默） */ }
    this.notifySwitches = sw
    return sw
  }

  /** D8 通知入口：开关放行才可见（DOM toast + 面板最近提示）；失败/成功提醒共用 */
  notifyUser(level: 'failure' | 'success', message: string): void {
    void this.notifySwitchesLoaded().then(sw => {
      if (level === 'failure' && !sw.failure) return
      if (level === 'success' && !sw.success) return
      const lv = level === 'failure' ? 'error' : 'success'
      this.toasts.push({ ts: Date.now(), level: lv, message, scriptId: 'dsht-mvu' })
      if (this.toasts.length > 50) this.toasts.shift()
      showDomToast(lv, message)
      this.notify()
    })
  }

  // ---- iframe 挂载 ----

  private ensureContainer(): HTMLDivElement {
    if (this.container === null) {
      const el = document.createElement('div')
      el.dataset['dshtThRuntime'] = this.sessionId
      document.body.append(el)
      this.container = el
    }
    return this.container
  }

  /** 【鲁棒轮 2026-09-09】挂载代数：reloadAll/destroy 递增——mountScript 的
   *  await fetchFrameVars 窗口（首载网络请求，秒级）内用户点「重载」时，旧续体
   *  恢复后 statuses 已被新挂载重写，原「statuses.has 守卫」永不命中 → 同脚本
   *  双 iframe 双执行（旧帧不在 frames 里，reload/destroy 永远摘不掉，桥回包
   *  错投新帧脚本挂死）。恢复后 gen 不匹配即放弃。 */
  private mountGen = 0

  private async mountScript(script: SessionScript): Promise<void> {
    const gen = this.mountGen
    const status: ScriptStatus = {
      phase: 'loading',
      missing: [],
      buttons: script.buttons.map(b => ({ ...b })),
    }
    this.statuses.set(script.id, status)
    // 【2026-09-07 真 TH 同步变量面】帧创建即嵌合并变量树（global<preset<character<script
    // <chat<message-MVU合并视图）——脚本同步读 getVariables(...).stat_data 依赖它
    //（fetchFrameVars 模块级 5s TTL 缓存：8 个脚本只 1 发请求）
    let frameVars: Record<string, unknown> | undefined
    try { frameVars = await fetchFrameVars(this.sessionId, this.slug) } catch { /* 拉不到 = 空缓存 */ }
    if (this.destroyed || gen !== this.mountGen || !this.statuses.has(script.id)) return // 等待期运行时销毁/重载
    const iframe = document.createElement('iframe')
    // 同源形态复刻（用户拍板的定案）：真酒馆助手（TH/JS-Slash-Runner）的脚本 iframe 是
    // srcdoc + same-origin（sandbox 无限制），predefine.js 直接 window.parent.$、从 parent
    // 合并 ['EjsTemplate','TavernHelper','YAML','showdown','toastr','z']。此前我们只给
    // allow-scripts（opaque origin），「飞讯 0703」卡的 window.parent.$ 直接被跨域拦截——
    // 不是系统限制，是我们自己的 sandbox 设置。现在放开 allow-same-origin：srcdoc + 这两个
    // token = 与宿主同源，脚本可访问 parent（配合 host-vendor 在宿主 window 上补挂的
    // $/_/z/YAML 全局，等效真 TH 形态）。同源后 localStorage 原生可用（shim 的存储垫
    // 探测成功即自动不遮蔽，无需改动）。
    // 【2026-09-07】+ allow-modals/allow-forms/allow-popups：sandbox 缺 allow-modals 时
    // iframe 内 confirm()/alert() 被 Chromium 静默丢弃（到不了 WebChromeClient 的
    // onJsConfirm）——「飞讯点联系人 openChat 无响应」实证根因（脚本 confirm 分支
    // 从未到达、零报错）。Android 侧对话框三件套已实现（MainActivity.kt 2026-09-07）。
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-forms allow-popups')
    iframe.name = script.id
    iframe.title = `TH 脚本：${script.name}`
    // 默认隐藏（真 TH v-show=false 同款）：实测深色宿主里满视口 iframe 的画布会
    // 以不透明白色打底（内部 html/body 透明也压不住），16 个脚本 iframe 叠层把
    // 整个聊天区刷白。脚本报 hasUi（th:ui）后才显示——有 UI 的脚本画布透明、
    // 只露出自己的浮动部件。铺满视口：position:fixed 部件视觉等效 ST 顶层注入。
    iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;pointer-events:none;z-index:1;background:transparent;visibility:hidden'
    iframe.srcdoc = buildIframeDocument({
      scriptId: script.id,
      scriptName: script.name,
      secret: this.secret,
      version: SHIM_VERSION,
      content: script.content,
      initialVars: frameVars,
    })
    this.frames.set(script.id, iframe)
    this.ensureContainer().append(iframe)
    // 【2026-09-07 根修】就绪 watchdog 改为**非终态**：真机实测宿主页面在物化渲染
    // 大楼层期主线程饱和，iframe 模块求值可延迟 >15s——旧逻辑 15s 超时直接判 failed
    // （终态），随后到达的 running 信标被忽略 → 按钮事件永久排队 → 「点击无任何反应」。
    // 现在超时只记诊断信息，phase 保持 loading，晚到信标照常生效（failed 仅保留给
    // iframe 完全不存在等硬错误，当前无此路径）。
    setTimeout(() => {
      const st = this.statuses.get(script.id)
      if (st && st.phase === 'loading') {
        st.error = `等待就绪超过 ${READY_TIMEOUT_MS / 1000}s（继续等待信标，非终态）`
        this.notify()
      }
    }, READY_TIMEOUT_MS)
  }

  // ---- 桥消息处理 ----

  handleMessage(msg: ReturnType<typeof parseIncomingMessage>): void {
    if (!msg || msg.secret !== this.secret) return
    const st = this.statuses.get(msg.scriptId)
    if (msg.th === 'status') {
      // 【2026-09-07 调试钩子（临时）】信标时序进环形缓冲（任意时刻可读）
      const log = (window as unknown as Record<string, unknown[]>).__dshtBeaconLog
      if (Array.isArray(log)) log.push({ t: Math.round(performance.now() / 1000), th: 'status', sid: msg.scriptId.slice(0, 8), phase: msg.phase, cur: st?.phase ?? 'NO-STATUS' })
      if (!st) {
        // 【P3a 2026-09-07】guest 楼层帧（msgframe-*）不在 statuses——其 running 信标
        // 到达时 shim 监听器必然已就绪，此刻补推快照是零竞态握手点（电梯帧收不到
        // loadContextSnapshot 的早期推送 → 卡内 getContext 永远 pending 空壳）
        if (msg.phase === 'running' && msg.scriptId.startsWith('msgframe-')
          && this.guestFrames.has(msg.scriptId) && this.contextSnapshot) {
          this.pushContextToGuest(msg.scriptId)
        }
        return
      }
      if (msg.phase === 'running') {
        if (st.phase === 'loading') {
          st.phase = 'running'
          this.flushPendingEvents(msg.scriptId) // L1a：补投加载期积压的事件
        }
      } else if (msg.phase === 'failed') {
        // 诚实化：loading 期失败翻转状态；运行期错误只记录（脚本可能部分可用）
        if (st.phase === 'loading') st.phase = 'failed'
        st.error = msg.error ?? '未知错误'
      }
      this.notify()
      return
    }
    if (msg.th === 'missing') {
      if (st && !st.missing.includes(msg.api)) {
        st.missing.push(msg.api)
        this.notify()
      }
      return
    }
    if (msg.th === 'script-error') {
      // 【2026-09-07 根修配套】脚本运行期错误只记录（不翻转 phase）——真 TH 语义：
      // 脚本抛错/异步 rejection 不摘除事件面，按钮等交互保持可用，错误在面板可见。
      if (st) {
        st.error = msg.error ?? '未知错误'
        this.notify()
      }
      return
    }
    if (msg.th === 'toast') {
      console.log(`[dsht-th] toast(${msg.level}) ${msg.scriptId}: ${msg.message}`)
      this.toasts.push({ ts: Date.now(), level: msg.level, message: msg.message, scriptId: msg.scriptId })
      if (this.toasts.length > 50) this.toasts.shift()
      this.notify()
      return
    }
    if (msg.th === 'ui') {
      if (st) {
        st.hasUi = msg.hasUi
        // 【真 TH 语义对齐 2026-09-07】真酒馆助手的脚本 iframe = v-show=false 永久隐藏
        //（Iframe.vue: <iframe v-show="false">），脚本 UI 一律经 parent.$ 注入父文档
        //（predefine.js/parent_jquery.js）。旧 rect 裁剪机制（iframe 按并集矩形显示）与
        // position:fixed 部件存在坐标反馈振荡——面板被钉在屏幕底角 187x150（真机实拍）。
        // 现在 iframe 永不显示：hasUi 仅作面板状态展示，UI 可见性归宿主文档。
        const frame = this.frames.get(msg.scriptId)
        if (frame) {
          frame.style.visibility = 'hidden'
          frame.style.pointerEvents = 'none'
        }
        this.notify()
      }
      return
    }
    if (msg.th === 'console') {
      // C15 日志抽屉：脚本 iframe console 汇入（最多 200 条；节流刷新防高日志频刷爆 React）
      this.logs.push({ ts: Date.now(), level: msg.level, message: msg.message, scriptId: msg.scriptId })
      if (this.logs.length > 200) this.logs.shift()
      // 【实机排障镜像】脚本 console 同步进宿主 console（logcat 可读——脚本挂点诊断不依赖面板）
      try { console.debug(`[dsht-th:script ${msg.scriptId.slice(0, 8)}] ${msg.level}: ${String(msg.message).slice(0, 260)}`) } catch { /* ignore */ }
      if (!this.consoleNotifyTimer) {
        this.consoleNotifyTimer = setTimeout(() => {
          this.consoleNotifyTimer = 0
          this.notify()
        }, 400) as unknown as number
      }
      return
    }
    // call：幂等可追溯
    const call = msg
    console.debug(`[dsht-th] call ${call.scriptId} ${call.api}`, call.args)
    const respond = (ok: boolean, value?: unknown, error?: string): void => {
      const frame = this.frames.get(call.scriptId) ?? this.guestFrames.get(call.scriptId) ?? null
      // 【排障】响应回传可观测（generate:raw 等长回复桥丢失诊断）
      try { console.debug(`[dsht-th] respond ${call.scriptId.slice(0, 8)} ${call.api} ok=${ok}${frame ? '' : ' FRAME-MISSING!'}`) } catch { /* ignore */ }
      frame?.contentWindow?.postMessage({
        '__dsht_th': true, secret: this.secret, scriptId: call.scriptId,
        th: 'result', callId: call.callId, ok, ...(ok ? { value } : { error }),
      }, '*')
    }
    // 【Kemini 适配 2026-09-08】display 相关变更桥成功后自动失效+重渲染——
    // 脚本直接 replaceTavernRegexes / updatePresetWith（Kemini 思维链开关）后，
    // displayRegexCache 不失效会「切了没反应」。
    handleBridgeCall(this.bridgeDeps, call.scriptId, call.api, call.args)
      .then(value => {
        respond(true, value ?? null)
        if (TH_DISPLAY_MUTATION_APIS.has(call.api)) notifyDisplayMutation()
      })
      .catch((e: Error) => respond(false, undefined, e.message))
  }

  private readonly bridgeDeps: ThBridgeDeps = {
    // 【Kemini 适配 2026-09-08】builtin.reloadAndRenderChatWithoutEvents 通道
    displayReload: () => { notifyDisplayMutation(); return Promise.resolve() },
    // 【通用修复 2026-09-09】scope='script' 但 scriptId 为空（楼层渲染 shim 上下文——渲染产出的
    // 脚本不属于任何注册脚本）→ 降级 'chat' 作用域。原样直发 = host 400 "scriptId required"
    // → 脚本变量链路死 → 状态栏等交互元素全部无响应（wuwa 实测抓到）。真 TH 语义：非注册
    // 脚本上下文的 script 作用域无意义，回退 chat 树。
    varsGet: (scope, scriptId) => thVarsGet(scope === 'script' && !scriptId ? 'chat' : scope, this.slug, this.sessionId, scriptId),
    varsPut: async (scope, tree, scriptId) => {
      if (scope === 'script' && !scriptId) scope = 'chat'
      if (scope === 'message') return void await thMessageVarsReplace(this.sessionId, tree)
      await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, variables: tree })
    },
    varsMerge: async (scope, vars, mode, scriptId) => {
      if (scope === 'script' && !scriptId) scope = 'chat'
      if (scope === 'message') return void await thMessageVarsPut(this.sessionId, mode, vars)
      const cur = await thVarsGet(scope, this.slug, this.sessionId, scriptId)
      const next = mode === 'insert' ? deepMergeInsert(cur, vars) : deepMergeAssign(cur, vars)
      await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, variables: next })
    },
    varsDelete: async (scope, path, scriptId) => {
      if (scope === 'script' && !scriptId) scope = 'chat'
      if (scope === 'message') return void await thMessageVarsDelete(this.sessionId, path)
      await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, path }, 'DELETE')
    },
    varsAll: async (scriptId) => {
      const scriptScope = scriptId ? 'script' : 'chat'
      const [global, preset, character, script, chat, message] = await Promise.all([
        thVarsGet('global', '', '', ''),
        thVarsGet('preset', '', this.sessionId, ''),
        thVarsGet('character', this.slug, '', ''),
        thVarsGet(scriptScope, '', this.sessionId, scriptId),
        thVarsGet('chat', '', this.sessionId, ''),
        thVarsGet('message', '', this.sessionId, '').catch(() => ({}) as Record<string, unknown>),
      ])
      // 真 TH _getAllVariables 顺序：global < character < script < chat（preset 位于 global
      // 与 character 之间）；message（MVU 合并视图）最高层——楼层帧同步树 stat_data 保证最新
      return deepMergeAssign(
        deepMergeAssign(deepMergeAssign(deepMergeAssign(deepMergeAssign(global, preset), character), script), chat),
        message,
      )
    },
    buttonsGet: (scriptId) => [...(this.statuses.get(scriptId)?.buttons ?? [])],
    buttonsExists: (scriptId) => this.statuses.has(scriptId),
    buttonsSet: (scriptId, buttons) => {
      const st = this.statuses.get(scriptId)
      if (!st) return
      st.buttons = buttons
        .filter(b => b && typeof b.name === 'string' && b.name)
        .map(b => ({ name: b.name, visible: b.visible !== false }))
      this.notify()
    },
    primaryLorebook: async () => {
      return await this.fetchPrimaryLorebook()
    },
    // ---- 上下文 / 预设 / 聊天消息 / 正则 / 世界书（sessionId/slug 空缺回填运行时会话/工作区）----
    ctxGet: async (sessionId, slug) => {
      try {
        return await thApi<ThContextSnapshot>('context', { sessionId: sessionId || this.sessionId, slug: slug || this.slug })
      } catch (e) {
        console.warn('[dsht-th] ctx:get 失败:', (e as Error).message)
        return null
      }
    },
    presetNames: (sessionId) =>
      thApi<{ names: string[]; loaded?: string | null }>('preset/names', { sessionId: sessionId || this.sessionId }),
    // presetGet/presetPut 带 sessionId：ST 哨兵名 'in_use'（= 当前加载预设）由 facade 按会话解析
    presetGet: (name) => thApi<{ found: boolean; preset?: ThPreset | null }>('preset/get', { name, sessionId: this.sessionId }),
    presetPut: async (name, prompts, prompt_order, create) => {
      await thApi('preset/put', { name, prompts, prompt_order, sessionId: this.sessionId, ...(create ? { create: true } : {}) })
    },
    presetDelete: async (name) => { await thApi('preset/delete', { name }) },
    presetRename: async (name, newName) => { await thApi('preset/rename', { name, newName }) },
    presetLoad: async (sessionId, name) => {
      await thApi('preset/load', { sessionId: sessionId || this.sessionId, name })
    },
    chatMessages: (sessionId) =>
      thApi<{ messages: ThChatMessage[] }>('chat/messages', { sessionId: sessionId || this.sessionId }),
    // ---- 【P3a 2026-09-07】聊天写路径桥（createChatMessages / setChatMessages）----
    // loopback：/dsht-tavern-helper/chat/append|update → dsh-plugin /dsht-rp/chat/append|update
    //（live session 官方 append / compaction+replace 原语在 dsh-plugin 进程侧）
    chatAppend: (messages, options) =>
      thApi<{ ok?: boolean; messageIds?: number[] }>('chat/append', {
        sessionId: this.sessionId, messages,
        insertBefore: options?.insertBefore === undefined || options.insertBefore === 'end'
          ? 'end'
          : Number(options.insertBefore),
      }),
    chatUpdate: (targets) =>
      thApi<{ ok?: boolean; updated?: number }>('chat/update', { sessionId: this.sessionId, targets }),
    regexesGet: (slug, sessionId) =>
      thApi<{ regexes: Record<string, unknown>[]; presetId?: string | null; slug?: string | null }>(
        'regexes/get',
        { slug: slug || this.slug, sessionId: sessionId || this.sessionId },
      ),
    regexesReplace: async (regexes, scope, slug, sessionId) => {
      // 精确按契约组装：global 只需 scope；character 需 slug；preset 需 presetId（快照解析，缺则给 sessionId 兜底）
      const payload: Record<string, unknown> = { regexes, scope }
      if (scope === 'character') payload['slug'] = slug || this.slug
      if (scope === 'preset') {
        const presetId = this.contextSnapshot?.presetId
        if (presetId) payload['presetId'] = presetId
        payload['sessionId'] = sessionId || this.sessionId
      }
      await thApi('regexes/replace', payload)
    },
    wbList: () => thApi<{ books: Array<{ name: string; lorePath?: string | null }> }>('worldbook/list', {}),
    wbGet: (name) =>
      thApi<{ book: { name?: string; entries?: Record<string, unknown>[] } | null }>('worldbook/get', { name }),
    wbEntryPut: async (name, entry) => { await thApi('worldbook/entry-put', { name, entry }) },
    // ---- 【实机审计修复 2026-09-05】P1/P2 长尾 deps ----
    // substitudeMacros：运行期宏展开（{{setvar}} 等写盘语义在 facade 内收口）
    macrosExpand: (text) =>
      thApi<{ result?: string }>('macros/expand', { text, slug: this.slug, sessionId: this.sessionId }),
    // L1b：自定义宏注册（直走 dsh-plugin 路由——注册表在生成期进程侧，facade 只是预览）
    macrosRegister: async (name, value) => {
      const r = await fetch('/dsht-rp/macros/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value }),
      }).then(x => x.json()) as { ok?: boolean; error?: string; macros?: Record<string, string> }
      if (r.error) throw new Error(r.error)
      return r
    },
    macrosUnregister: async (name) => {
      const r = await fetch('/dsht-rp/macros/unregister', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(x => x.json()) as { ok?: boolean; error?: string }
      if (r.error) throw new Error(r.error)
      return r
    },
    // replaceLorebookEntries：世界书条目整表替换
    wbReplaceEntries: async (name, entries) => {
      await thApi('worldbook/replace-entries', { name, entries, sessionId: this.sessionId })
    },
    // rebindGlobalWorldbooks：全局激活书单整组重绑
    wbRebindGlobal: async (names) => {
      await thApi('worldbook/rebind-global', { books: names, sessionId: this.sessionId })
    },
    // rebindCharWorldbooks：角色工作区书单整组重绑
    wbRebindChar: async (slug, names) => {
      await thApi('worldbook/rebind-char', { slug, books: names, sessionId: this.sessionId })
    },
    // getOrCreateChatWorldbook：会话绑定世界书缺则建
    wbChatGetOrCreate: () =>
      thApi<{ name?: string }>('worldbook/chat-get-or-create', { sessionId: this.sessionId, slug: this.slug }),
    // ---- C7/C8/C9/D6 扩展面 ----
    // chat 作用域深合并：facade /variables/merge（服务端 undo/快照/D7 schema 校验收口）
    varsAssignChat: async (vars) => {
      await thApi('variables/merge', { sessionId: this.sessionId, variables: vars })
    },
    // C7 registerVariableSchema 数据面（成功提醒走 D8 开关）
    varsSchemaPut: async (name, schema) => {
      await thApi('variables/schema', { sessionId: this.sessionId, name, variableSchema: schema })
      this.notifyUser('success', `变量结构已注册${name ? `：${name}` : '（整树）'}`)
    },
    // C8 prompt 注入存储（消费接线归 dsh-plugin 主线程排程，宿主只落盘）
    injectsPut: async (injections) => {
      await thApi('inject', { sessionId: this.sessionId, injections })
    },
    injectsRemove: async (keys) => {
      await thApi('uninject', { sessionId: this.sessionId, keys })
    },
    // C9 一次性补全（TH 插件 loopback 转发 /dsht-rp/llm/classify）
    generate: (system, prompt) =>
      thApi<{ ok?: boolean; text?: string }>('generate', { sessionId: this.sessionId, system, prompt }),
    // generateRaw 真语义：完整 payload → /generate-raw（ordered_prompts 装配 + loopback）
    generateRawRaw: (payload) =>
      thApi<{ ok?: boolean; text?: string }>('generate-raw', {
        sessionId: this.sessionId, slug: this.slug,
        ...((payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>),
      }),
    // D6 window.Mvu 数据面（/dsht-mvu/* 直连，不经 thApi 前缀）
    mvuVariables: async () => {
      const resp = await fetch(`/dsht-mvu/variables?sessionId=${encodeURIComponent(this.sessionId)}`)
      const body = await resp.json() as { variables?: Record<string, unknown>; error?: string }
      if (body.error) throw new Error(body.error)
      return body.variables ?? {}
    },
    mvuReplace: async (data) => {
      const resp = await fetch('/dsht-mvu/variables/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, variables: data, replace: true }),
      })
      const body = await resp.json() as { error?: string }
      if (resp.status === 422) {
        // D8：schema 校验失败——console.warn + 开关放行时提醒
        console.warn('[dsht-th] MVU 变量替换校验失败（422）:', body)
        this.notifyUser('failure', String(body.error ?? '变量结构校验失败'))
      }
      if (body.error) throw new Error(body.error)
      this.notifyUser('success', 'MVU 变量数据已替换写入')
    },
  }

  // ---- 上下文快照（getContext 同步面）----

  /** 当前角色 primary 世界书名（rp/workspaces 第一本；快照 characterLorebook 字段供 getCharWorldbookNames 同步读） */
  private async fetchPrimaryLorebook(): Promise<string | null> {
    try {
      const r = await rpApi<{ workspaces?: Array<{ slug: string; books?: Array<{ name: string }> }> }>('rp/workspaces')
      const ws = (r.workspaces ?? []).find(w => w.slug === this.slug)
      return ws?.books?.[0]?.name ?? null
    } catch { return null }
  }

  /**
   * 拉取 /context + /chat/messages 合并成快照，postMessage({th:'context'}) 推给全部 iframe。
   * iframe 内 getContext() / SillyTavern.getContext() 同步读；失败静默（console.warn），不影响脚本运行。
   */
  loadContextSnapshot(): void {
    if (this.destroyed) return
    void Promise.all([
      thApi<ThContextSnapshot>('context', { sessionId: this.sessionId, slug: this.slug }),
      thApi<{ messages?: ThChatMessage[] }>('chat/messages', { sessionId: this.sessionId }),
      this.fetchPrimaryLorebook(),
    ]).then(([ctx, chat, characterLorebook]) => {
      if (this.destroyed) return
      const snapshot: ThContextSnapshot = {
        ...ctx,
        slug: this.slug,
        characterLorebook,
        messages: Array.isArray(chat?.messages) ? chat.messages : [],
      }
      this.contextSnapshot = snapshot
      for (const [scriptId, frame] of this.frames) {
        frame.contentWindow?.postMessage({
          '__dsht_th': true, secret: this.secret, scriptId,
          th: 'context', context: snapshot,
        }, '*')
      }
      // 【P3a 2026-09-07】guest 楼层帧同样要收快照——卡内脚本（示例游戏开场白状态栏等）
      // 在楼层 iframe 直接调 getContext/getCharWorldbookNames；只推脚本帧会让楼层帧
      // 永远停在 __dshtContextPending 空壳 → 「未绑定主世界书」误报（实机实证）。
      // 推送同样受 shim 监听器安装竞态影响 → 走重试梯子。
      for (const scriptId of this.guestFrames.keys()) {
        this.pushContextToGuest(scriptId)
      }
    }).catch((e: Error) => {
      console.warn('[dsht-th] 上下文快照拉取失败:', (e as Error).message)
    })
  }

  // ---- 会话事件流（快照 diff → ST 事件投递）----

  /** L1a 竞态修复：加载中的 iframe 还没装消息监听——事件按 scriptId 入队，running 后补投
   * （实测：chat_id_changed 在 mount 后立刻 emit，iframe shim 未就绪 → 事件丢失）。
   * 队列上限 50（永不就绪的脚本防内存膨胀）；destroy 时随运行时应回收。 */
  private readonly pendingEvents = new Map<string, Array<{ eventType: string; args: unknown[] }>>()

  emitSessionEvent(eventType: string, args: unknown[]): void {
    for (const [scriptId, frame] of this.frames) {
      const st = this.statuses.get(scriptId)
      if (st && st.phase !== 'running') {
        const q = this.pendingEvents.get(scriptId) ?? []
        if (q.length < 50) q.push({ eventType, args })
        this.pendingEvents.set(scriptId, q)
        continue
      }
      frame.contentWindow?.postMessage({
        '__dsht_th': true, secret: this.secret, scriptId,
        th: 'event', eventType, args,
      }, '*')
    }
  }

  /** 脚本就绪（phase → running）后补投积压事件 */
  private flushPendingEvents(scriptId: string): void {
    const q = this.pendingEvents.get(scriptId)
    if (!q || q.length === 0) return
    this.pendingEvents.delete(scriptId)
    const frame = this.frames.get(scriptId)
    for (const ev of q) {
      frame?.contentWindow?.postMessage({
        '__dsht_th': true, secret: this.secret, scriptId,
        th: 'event', eventType: ev.eventType, args: ev.args,
      }, '*')
    }
  }

  /** 快照推进（组件 props 变化驱动；RP 会话才调用）
   *  【hook 移植 L1a 2026-09-06】事件桥补全（ST/Luker events.js 对照）：
   *  - 逐楼层投递（一次 advance 落多条时逐条发，不再只看末条）；
   *  - order 收缩 → message_deleted（载荷 = 收缩后长度，ST 同语义）；
   *  - running 期流式 token：末条 assistant 节点文本增长即投 stream_token_received
   *    （载荷 = 累计文本，ST script.js:6293 同语义）+ iframe 增量变体；
   *  - generation_started/ended 双命名空间同投（tavern_events + iframe js_* 变体）。 */
  advance(snapshot: SessionSnapshotLike): void {
    this.lastSnapshot = snapshot
    const chat = snapshot.chat
    const order = chat?.order?.length ?? 0
    const running = snapshot.running === true
    if (this.prevOrder >= 0 && chat?.order && chat.nodes) {
      if (order > this.prevOrder) {
        // 逐楼层投递：kind 在节点顶层（'user' / 'assistant-step' / 'steering' 等）
        const kindByKey = new Map<string, string>()
        for (const n of chat.nodes.values()) {
          if (typeof n.key === 'string') kindByKey.set(n.key, String(n.kind ?? ''))
        }
        for (let idx = this.prevOrder; idx < order; idx++) {
          const kind = kindByKey.get(String(chat.order[idx])) ?? ''
          if (kind === 'user') this.emitSessionEvent('message_sent', [idx])
          else if (kind === 'assistant-step' || kind === 'assistant') this.emitSessionEvent('message_received', [idx])
        }
      } else if (order < this.prevOrder) {
        this.emitSessionEvent('message_deleted', [order])
      }
    }
    // 流式 token（running 期）：chat.order 末条 assistant 节点的 text 块拼接 diff
    if (running && chat?.order && chat.nodes && chat.order.length > 0) {
      const lastKey = String(chat.order[chat.order.length - 1])
      for (const n of chat.nodes.values()) {
        if (typeof n.key !== 'string' || n.key !== lastKey) continue
        if (n.data?.status !== 'running') continue
        let text = ''
        for (const b of n.data.blocks ?? []) {
          if (b.kind === 'text' && typeof b.text === 'string') text += b.text
        }
        if (text.length > this.prevStreamLen) {
          this.prevStreamLen = text.length
          this.emitSessionEvent('stream_token_received', [text])
          this.emitSessionEvent('js_stream_token_received_incrementally', [text])
        }
      }
    }
    if (!this.prevRunning && running) {
      this.prevStreamLen = 0
      this.emitSessionEvent('generation_started', [])
      this.emitSessionEvent('js_generation_started', [])
    }
    if (this.prevRunning && !running) {
      this.emitSessionEvent('generation_ended', [order])
      this.emitSessionEvent('js_generation_ended', [order])
      this.emitSessionEvent('js_stream_token_received_fully', [])
      // 生成结束后消息面已变：重拉快照推给 iframe（getContext 同步面保持新鲜）
      this.loadContextSnapshot()
    }
    this.prevOrder = order
    this.prevRunning = running
  }

  /**
   * RpNativeChat 成功回调桥（message_swiped / message_edited / message_sent / message_received /
   * message_deleted）：TH_HOST_EVENT CustomEvent 进来后解析楼层号再投递。
   * 【实机验证修复 2026-09-06】dock 席位的 session prop 不带 chat 投影（advance 实机 dump
   * 实证 chat=n）——旧实现从 lastSnapshot.chat 解析楼层恒 undefined 静默跳过，swiped/edited
   * 从未真正投递。改为经数据面 chat/messages（facade 导出现在带事件 seq）按 seq 解析楼层；
   * 解析不到回落最新消息序号（事件语义 = "最新那条被 swipe/edit"）。
   */
  emitNativeChatEvent(sessionId: string, eventType: string, anchor: { messageId?: string; nodeKey?: string; seq?: number }, args?: unknown[]): void {
    if (sessionId !== this.sessionId) return
    // args 存在 = 直投（stream_token_received 等无楼层锚的事件）
    if (args !== undefined) {
      this.emitSessionEvent(eventType, args)
      // 双命名空间补齐：live 路径（dock prop 无 chat 投影，advance 流式分支跑不到）
      // 的 js_* 变体也在这里同投，与 advance() 的 665-666 行对齐
      if (eventType === 'stream_token_received') this.emitSessionEvent('js_stream_token_received_incrementally', args)
      return
    }
    void (async () => {
      let floor = -1
      try {
        const r = await thApi<{ messages?: Array<{ message_id?: number; seq?: number }> }>('chat/messages', { sessionId: this.sessionId })
        const msgs = Array.isArray(r.messages) ? r.messages : []
        if (anchor.seq !== undefined) {
          const hit = msgs.find(m => m.seq === anchor.seq)
          if (hit && typeof hit.message_id === 'number') floor = hit.message_id
        }
        if (floor < 0 && msgs.length > 0) {
          // 回落：锚解析失败（导出滞后于视图等）→ 最新消息
          const last = msgs[msgs.length - 1]
          floor = typeof last.message_id === 'number' ? last.message_id : msgs.length - 1
        }
      } catch { /* 数据面不可达 */ }
      if (floor < 0 && eventType === 'message_deleted') floor = 0
      if (floor >= 0) this.emitSessionEvent(eventType, [floor])
    })()
  }

  clickButton(scriptId: string, buttonName: string): void {
    // 【2026-09-07 调试钩子配套】按钮事件派发路径可观测化（临时）
    const st = this.statuses.get(scriptId)
    console.log(`[dsht-th-beacon] clickButton: script=${scriptId.slice(0, 8)} btn=${buttonName} phase=${st?.phase ?? 'NO-STATUS'} frames=${this.frames.size}`)
    this.emitSessionEvent(getButtonEventId(scriptId, buttonName), [])
  }
}

/** 会话级单例注册表 */
const runtimes = new Map<string, SessionRuntime>()
// 【实机排障钩子】CDP 诊断面：window.__dshtThRt().get(sid) → SessionRuntime（logs/statuses 可读）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__dshtThRt'] = () => runtimes
}

// 【2026-09-07 调试钩子（临时）】暴露各 runtime 的脚本 phase / 队列深度 + 信标环形缓冲
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__dshtBeaconLog = [];
  (window as unknown as Record<string, unknown>).__dshtRtDebug = {
    list(): unknown {
      return [...runtimes.entries()].map(([sid, rt]) => ({
        session: sid,
        scripts: rt.scripts.map(sc => {
          const st = rt.statuses.get(sc.id)
          return { id: sc.id.slice(0, 8), phase: st?.phase, error: st?.error, buttons: st?.buttons.map(b => b.name), queued: (rt.pendingEvents?.get(sc.id) ?? []).length }
        }),
        frames: [...rt.frames.keys()].map(k => k.slice(0, 8)),
      }))
    },
  }
}

// ---- 消息楼层 guest shim 对外 API（RpMessageFrame 注入 TH shim 用）----

/** 预约楼层 guest 桥（无运行时则创建但不 start——脚本装载仍归 dock 管） */
export function reserveMessageFrame(sessionId: string, slug: string): { sessionId: string; scriptId: string; secret: string } | null {
  if (typeof window === 'undefined' || !sessionId) return null
  const rt = runtimeFor(sessionId, slug)
  return { sessionId, ...rt.reserveGuestFrame() }
}

export function attachMessageFrame(sessionId: string, scriptId: string, iframe: HTMLIFrameElement): void {
  runtimes.get(sessionId)?.attachGuestFrame(scriptId, iframe)
}

export function releaseMessageFrame(sessionId: string, scriptId: string): void {
  runtimes.get(sessionId)?.releaseGuestFrame(scriptId)
}

/** 【P3a 2026-09-07】楼层帧 context 引导源：取该会话运行时的最新上下文快照。
 * 楼层 iframe 文档构建时内嵌为 window.__dshtInitialContext（卡脚本运行前就位，
 * 消除 postMessage 竞态——卡内 detectEnvironment 首读 getContext 不再落 pending 空壳） */
export function getRpContextSnapshot(sessionId: string): ThContextSnapshot | null {
  return runtimes.get(sessionId)?.contextSnapshot ?? null
}

/** 楼层帧同步变量面数据源：合并变量树（global<preset<character<script<chat）。
 *  模块级 5s TTL 缓存——楼层帧多、窗口化回渲频繁，不能每帧 5 发请求。
 *  逐域 fail-soft（单域 400/异常 = 该域空树）——script 域空 scriptId 恒 400，不能
 *  让整个 Promise.all 拒绝把楼层帧卡死在「等变量树」白屏态（实测抓到）。 */
let frameVarsCache: { at: number; key: string; value: Promise<Record<string, unknown>> } | null = null
export function fetchFrameVars(sessionId: string, slug: string): Promise<Record<string, unknown>> {
  const key = `${slug}::${sessionId}`
  const now = Date.now()
  if (frameVarsCache !== null && frameVarsCache.key === key && now - frameVarsCache.at < 5000) return frameVarsCache.value
  const soft = async (scope: VarScopeLike, sid: string, scriptId: string): Promise<Record<string, unknown>> => {
    try { return await thVarsGet(scope, scope === 'character' ? slug : '', sid, scriptId) } catch { return {} }
  }
  const value = (async () => {
    const [global, preset, character, script, chat, message] = await Promise.all([
      soft('global', '', ''),
      soft('preset', sessionId, ''),
      soft('character', '', ''),
      soft('script', sessionId, ''),
      soft('chat', sessionId, ''),
      soft('message', sessionId, ''),
    ])
    // message（MVU 合并视图）最高层：楼层帧同步树 stat_data 恒最新（真 TH 每消息快照语义）
    return deepMergeAssign(
      deepMergeAssign(deepMergeAssign(deepMergeAssign(deepMergeAssign(global, preset), character), script), chat),
      message,
    )
  })()
  frameVarsCache = { at: now, key, value }
  return value
}
type VarScopeLike = 'global' | 'preset' | 'character' | 'chat' | 'script' | 'message'

function runtimeFor(sessionId: string, slug: string): SessionRuntime {
  // 单会话活跃：挂载新会话的运行时时，销毁其他会话的残留运行时
  //（实测：iframe 挂 document.body 跨视图存活，离开会话后脚本仍在首页刷白屏）
  for (const [sid, rt] of runtimes) {
    if (sid !== sessionId) { rt.destroy(); runtimes.delete(sid) }
  }
  let rt = runtimes.get(sessionId)
  if (rt === undefined) {
    rt = new SessionRuntime(sessionId, slug)
    runtimes.set(sessionId, rt)
  }
  return rt
}

/** 离开一切 RP 会话（首页/非 RP 会话视图）：销毁全部运行时 */
function destroyAllRuntimes(): void {
  for (const rt of runtimes.values()) rt.destroy()
  runtimes.clear()
}

/** 全局 message 分发（一次注册） */
let messageListenerInstalled = false
function ensureMessageListener(): void {
  if (messageListenerInstalled || typeof window === 'undefined') return
  messageListenerInstalled = true
  window.addEventListener('message', (e) => {
    const msg = parseIncomingMessage(e.data)
    if (!msg) return
    for (const rt of runtimes.values()) {
      if (rt.hasBridge(msg.scriptId)) {
        rt.handleMessage(msg)
        return
      }
    }
  })
  // 【实机审计修复 2026-09-05】message_swiped / message_edited 桥：RpNativeChat 的
  // 变体切换 / 会话编辑成功回调 dispatch（宿主页同源 CustomEvent，零新依赖）
  // 【L1a 2026-09-06】扩到 message_sent/received/deleted/stream_token_received（args 直投）
  window.addEventListener(TH_HOST_EVENT, (ev) => {
    const detail = (ev as CustomEvent<{ sessionId?: string; eventType?: string; messageId?: string; nodeKey?: string; seq?: number; args?: unknown[] }>).detail
    if (!detail?.sessionId || !detail.eventType) return
    runtimes.get(detail.sessionId)?.emitNativeChatEvent(
      detail.sessionId, detail.eventType, { messageId: detail.messageId, nodeKey: detail.nodeKey, seq: detail.seq }, detail.args,
    )
  })
}

// ---------------------------------------------------------------------------
// dock 组件
// ---------------------------------------------------------------------------

interface DockProps { session?: unknown }

// P4（2026-09-07）：ST 扩展菜单形态——下拉面板锚定顶栏右上图标正下方（不再悬浮球 + 居中弹窗）
const PANEL_POS = { right: '10px', top: 'calc(env(safe-area-inset-top, 0px) + 106px)', bottom: 'auto' }

export function RpScriptHost(props: DockProps): JSX.Element | null {
  const s = (props.session ?? {}) as {
    sessionId?: string; id?: string; header?: { cwd?: string }; cwd?: string
    chat?: { order?: readonly unknown[] }
    surface?: { nodes?: ReadonlyArray<{ kind?: string }> }
    running?: boolean
  }
  const sessionId = s.sessionId ?? s.id ?? ''
  const { slug, resolved } = useRpSlug(s.header?.cwd ?? s.cwd, sessionId)
  const [, forceTick] = useState(0)
  const [open, setOpen] = useState(false)
  // C15 Toolbox：日志抽屉 / 变量查看器（互斥 tab；none = 都收起）
  const [tab, setTab] = useState<'none' | 'logs' | 'vars'>('none')
  const [varsText, setVarsText] = useState('')
  const [varsLoading, setVarsLoading] = useState(false)
  const rtRef = useRef<SessionRuntime | null>(null)

  // 运行时启动（slug 解析完成后）；离开一切 RP 会话（首页无 sessionId /
  // 非 RP 会话 slug 落定 null）时销毁全部残留运行时——iframe 挂 document.body，
  // 不主动收就会漏到其他视图（实测首页被残留脚本 iframe 刷白）
  useEffect(() => {
    if (!sessionId) { destroyAllRuntimes(); return }
    if (resolved && !slug) { destroyAllRuntimes(); return }
    if (!slug) return
    ensureMessageListener()
    const rt = runtimeFor(sessionId, slug)
    rtRef.current = rt
    rt.start()
    return rt.subscribe(() => forceTick(t => t + 1))
  }, [sessionId, slug, resolved])

  // 会话快照推进 → 事件投递
  useEffect(() => {
    rtRef.current?.advance(s)
  })

  // C15 变量查看器：切到「变量」tab 时拉一次 MVU 变量树（GET /dsht-mvu/variables，只读）
  useEffect(() => {
    if (tab !== 'vars' || !sessionId) return
    let alive = true
    setVarsLoading(true)
    fetch(`/dsht-mvu/variables?sessionId=${encodeURIComponent(sessionId)}`)
      .then(r => r.json() as Promise<{ variables?: Record<string, unknown>; error?: string }>)
      .then(b => {
        if (!alive) return
        if (b.error) setVarsText(`读取失败：${b.error}`)
        else setVarsText(JSON.stringify(b.variables ?? {}, null, 2))
      })
      .catch((e: Error) => { if (alive) setVarsText(`读取失败：${e.message}`) })
      .finally(() => { if (alive) setVarsLoading(false) })
    return () => { alive = false }
  }, [tab, sessionId])

  if (!slug || !sessionId) return null
  const rt = rtRef.current
  if (rt === null || rt.scriptCount === 0) return null

  const scripts = rt.scripts
  const allButtons = scripts.flatMap(sc =>
    (rt.statuses.get(sc.id)?.buttons ?? [])
      .filter(b => b.visible && (sc.buttonEnabled || rt.statuses.get(sc.id)?.phase === 'running'))
      .map(b => ({ scriptId: sc.id, scriptName: sc.name, name: b.name })),
  )

  return (
    <>
      <button
        type="button"
        className="dsht-rp-scriptball"
        title={`酒馆助手脚本（${scripts.length} 个已装载）`}
        onClick={() => setOpen(o => !o)}
      >🧩</button>
      {open && (
        <div className="dsht-rp-script-panel" role="dialog" aria-label="酒馆助手脚本" style={PANEL_POS}>
          <div className="sf-head">
            <span>🧩 酒馆助手脚本</span>
            <span className="sf-head-actions">
              {/* C15 Toolbox：日志抽屉 / 变量查看器 */}
              <button
                type="button"
                className="sf-btn"
                style={tab === 'logs' ? { opacity: 1, fontWeight: 700 } : undefined}
                onClick={() => setTab(t => (t === 'logs' ? 'none' : 'logs'))}
              >日志</button>
              <button
                type="button"
                className="sf-btn"
                style={tab === 'vars' ? { opacity: 1, fontWeight: 700 } : undefined}
                onClick={() => setTab(t => (t === 'vars' ? 'none' : 'vars'))}
              >变量</button>
              <button type="button" className="sf-btn" onClick={() => { rt.reloadAll() }}>重载</button>
              <button type="button" className="sf-btn" onClick={() => { setOpen(false); setTab('none') }}>✕</button>
            </span>
          </div>
          <div className="sf-body">
            {allButtons.length > 0 && (
              <div className="th-buttons">
                {allButtons.map(b => (
                  <button
                    key={`${b.scriptId}:${b.name}`}
                    type="button"
                    className="sf-btn th-btn"
                    title={`${b.scriptName} · ${b.name}`}
                    onClick={() => { rt.clickButton(b.scriptId, b.name) }}
                  >{b.name}</button>
                ))}
              </div>
            )}
            {scripts.map(sc => {
              const st = rt.statuses.get(sc.id)
              return (
                <div key={sc.id} className="th-row">
                  <span className={`th-badge th-${st?.phase ?? 'loading'}`}>
                    {st?.phase === 'running' ? '运行中' : st?.phase === 'failed' ? '失败' : '加载中'}
                  </span>
                  <span className="sf-key">{sc.name}</span>
                  <span className="th-src">{sc.source === 'preset' ? '预设' : '卡'}</span>
                  {st?.error && <div className="sf-error th-detail">错误：{st.error}</div>}
                  {st !== undefined && st.missing.length > 0 && (
                    <div className="th-detail th-missing">缺 API：{st.missing.join('、')}</div>
                  )}
                  {st?.hasUi === true && <div className="th-detail">（脚本自有 UI 已按内容区域显示，可直接点按）</div>}
                </div>
              )
            })}
            {rt.toasts.length > 0 && (
              <div className="th-detail th-toasts">
                最近提示：{rt.toasts[rt.toasts.length - 1]?.message}
              </div>
            )}
            {/* C15 日志抽屉：脚本 iframe console 实时汇入（最新在上；最多 200 条） */}
            {tab === 'logs' && (
              <div
                className="th-toolbox"
                style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 6 }}
              >
                {rt.logs.length === 0
                  ? <div className="th-detail">（暂无脚本日志；脚本 console 输出实时汇入，最多保留 200 条）</div>
                  : rt.logs.slice().reverse().map((l, i) => (
                    <div key={i} className="th-detail" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      <span style={{ opacity: 0.6 }}>[{new Date(l.ts).toLocaleTimeString()}] {l.scriptId}/{l.level}</span>{' '}
                      {l.message}
                    </div>
                  ))}
              </div>
            )}
            {/* C15 变量查看器：MVU 变量树只读 JSON 视图（GET /dsht-mvu/variables） */}
            {tab === 'vars' && (
              <div
                className="th-toolbox"
                style={{ maxHeight: 300, overflowY: 'auto', marginTop: 6, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 6 }}
              >
                <div className="th-detail">MVU 变量树（/dsht-mvu/variables，只读）</div>
                <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {varsLoading ? '读取中…' : (varsText || '（空）')}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** 【2026-09-07 ST 按钮条对齐（基准 1/316）】脚本按钮常驻悬浮条——ST 里 TH 脚本按钮
 *  以胶囊按钮浮在输入框上方（Kemini / 重试额外模型解析 / 剧情控制台 / ExampleGame 世界书控制…），
 *  不藏进管理面板。dock 席位挂载，读会话运行时的按钮清单，点击回投按钮事件。 */
export function RpScriptButtonsBar(props: DockProps): JSX.Element | null {
  const s = (props.session ?? {}) as {
    sessionId?: string; id?: string; header?: { cwd?: string }; cwd?: string
  }
  const sessionId = s.sessionId ?? s.id ?? ''
  const { slug, resolved } = useRpSlug(s.header?.cwd ?? s.cwd, sessionId)
  const [, forceTick] = useState(0)
  const rtRef = useRef<SessionRuntime | null>(null)
  useEffect(() => {
    if (!sessionId || !slug) { rtRef.current = null; forceTick(t => t + 1); return }
    ensureMessageListener()
    const rt = runtimeFor(sessionId, slug)
    rtRef.current = rt
    return rt.subscribe(() => forceTick(t => t + 1))
  }, [sessionId, slug, resolved])
  const rt = rtRef.current
  if (rt === null || rt.scriptCount === 0) return null
  const allButtons = rt.scripts.flatMap(sc =>
    (rt.statuses.get(sc.id)?.buttons ?? [])
      .filter(b => b.visible && (sc.buttonEnabled || rt.statuses.get(sc.id)?.phase === 'running'))
      .map(b => ({ scriptId: sc.id, scriptName: sc.name, name: b.name })),
  )
  if (allButtons.length === 0) return null
  return (
    <div className="dsht-rp-script-pillbar" role="toolbar" aria-label="酒馆助手脚本按钮">
      {allButtons.map(b => (
        <button
          key={`${b.scriptId}:${b.name}`}
          type="button"
          className="dsht-rp-script-pill"
          title={`${b.scriptName} · ${b.name}`}
          onClick={() => { rt.clickButton(b.scriptId, b.name) }}
        >{b.name}</button>
      ))}
    </div>
  )
}
