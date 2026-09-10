/**
 * T2.5 前端原生化收口：输出协议三组件 + 变体条，以渲染器身份融入原生 conversation。
 *
 * - conversation.chat.node（keyed `assistant-step`，priority -1 shadowing 官方渲染器）：
 *   applyOutputProtocol（statusTags→状态栏卡片 / actionTags→行动选项按钮 /
 *   wrapTags→剥壳 + ```statusbar 代码块→组件）移植为 assistant 消息渲染增强；
 *   剥壳后文本经官方同款 MarkdownText 渲染（ui-primitives，模块表直供）。
 *   reasoning 块以极简折叠行补差（T2.5d：原生 ReasoningRow 在 ui-conversation
 *   内部、不可经模块表 import；stats/icon actions 归 turn-tail 节点，shadowing 无损）。
 * - conversation.chat.assistant-actions（list 席位）：变体条 ‹ n/m ›（T2.5c），
 *   切换走 3081 /variant/switch（dsht-rp-plugin，session.append replace SurfaceOp）。
 * - 行动选项按钮点击 = inputActions.setDraft + submit（T2.5b：原生 composer
 *   提交通道，不自绘输入栏）。
 *
 * 可卸载性（P7）：拔掉本插件 = shadowing 消失，官方 AssistantNodeView 复位，
 * DSH 原生功能完整。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import { Fragment, type JSX, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { dshRpc, rpApi, type RpWorkspaceInfo } from './rpc.ts'
import {
  isMessageWindowed, messagePlaceholderHeight, registerMessageWindowing,
  reportWindowCommit, subscribeWindowing, findScrollAncestor,
} from './chat-windowing.ts'
import {
  applyOutputProtocolSegments, parseJsonPatches, parseStatusBarRows, parseVariableJson,
  sanitizeDisplayHtml, slugFromCwd, splitStatusbarBlocks, withDefaults,
  type OutputProtocol, type ProtocolSegment,
} from './output-protocol.ts'
import {
  FRAME_HEIGHT_MESSAGE_TYPE, FRAME_MAX_HEIGHT, buildDisplayFrameDocument, clampFrameHeight,
  compileDisplaySegments, enhancePreBlocks, expandDisplayMacros, invalidateDisplayDataCache, loadDisplayRenderCtx,
  loadEjsDisplaySettings, loadRenderEntries, loadThRenderSettings, reportPermanentRender,
  runDisplayScripts, unwrapForeignTags, type DisplayMacroCtx, type EjsDisplaySettings,
  type RenderEntries, type ThRenderSettings,
} from './display-compiler.ts'
import type { RegexScript } from '../../../regex/engine.ts'
import { attachMessageFrame, fetchFrameVars, getRpContextSnapshot, releaseMessageFrame, reserveMessageFrame, SHIM_VERSION } from './RpScriptHost.tsx'
import { buildMessageFrameDocument, buildShimSource, getVendorBlobUrl } from './th-shim.ts'
import { groupOf, normalizeVariantGroups, type RawVariantGroup, type VariantGroupInfo } from './variant-groups.ts'
import { wrapStQuotes } from './st-quotes.ts'

// ---------------------------------------------------------------------------
// 类型（最小面：runtime 类型仅 type-only import，构建期擦除）
// ---------------------------------------------------------------------------

interface LikeAssistantBlock {
  kind: 'text' | 'reasoning' | 'image' | 'tool-call' | 'other'
  text?: string
  attachment?: unknown
  block?: unknown
}

interface LikeAssistantChatData {
  status: 'running' | 'settled' | 'interrupted'
  blocks: readonly LikeAssistantBlock[]
  finalNode?: { seq?: number; messageId?: string } | undefined
}

interface LikeChatNode {
  key: string
  kind: string
  data: unknown
}

/** conversation.chat.node 席位组件收到的 props（owner + keyed node + 标准件） */
interface NodeViewProps {
  node: { data: LikeAssistantChatData } & LikeChatNode
  /** 会话工作区根（匹配 rp 工作区 → 输出协议配置） */
  cwd?: string | undefined
  /** 历史图片组渲染（官方 attachment 席位，owner props 直供） */
  renderMessageImages: (owner: { images: ReadonlyArray<{ attachment: unknown }>; align: 'start' | 'end' }) => ReactNode
  /** 输入机公共动作面（sessions.provide：每个 session 域席位组件都收到） */
  inputActions?: { setDraft: (text: string) => void; submit: () => void } | undefined
  /** 标准件（session 域席位）：会话快照选择器与 id */
  useSession?: (<T>(selector: (snapshot: unknown) => T) => T) | undefined
  /** Chat 本体快照选择器（owner props 直供——SessionSnapshot 不带 chat 投影，fiber 实证；
   *  楼层号/耗时/楼层头数据源） */
  useChat?: (<T>(selector: (snapshot: unknown) => T) => T) | undefined
  sessionId?: string | undefined
}

/** conversation.chat.assistant-actions 席位组件收到的 props */
interface VariantActionProps {
  /** 本条已定稿 assistant 消息的稳定标识 */
  messageId: string
  useSession: <T>(selector: (snapshot: unknown) => T) => T
  /** Chat 快照选择器（本席位的 useSession 快照不带 chat 投影——实机实证 hasChat=false；
   *  chat 数据必须走 useChat，snapshot 即 Chat 本体：nodes/order 顶层） */
  useChat: <T>(selector: (snapshot: unknown) => T) => T
  sessionId: string
}

// ---------------------------------------------------------------------------
// 工作区输出协议配置（T2.5f 下发链：rp.json → 3081 /rp/workspaces → 此处消费）
// ---------------------------------------------------------------------------

/** 清单缓存（rp.json 运行时会被迁移/绑书改动——overlay 打开与导入完成时经 invalidateWsCache 失效） */
let wsCache: Promise<RpWorkspaceInfo[]> | null = null

/**
 * wsCache 失效。调用点：RP overlay 打开（loadWorkspaces）、导入完成（refreshAfterImport）、
 * 世界书绑定保存——否则绑定新书/新导入的工作区要刷新整个页面才生效（批次 3 遗留）。
 */
export function invalidateWsCache(): void {
  wsCache = null
  rpSessionCache = null
  displayRegexCache.clear()
  invalidateDisplayDataCache()
}

// ---------------------------------------------------------------------------
// 【Kemini 适配 2026-09-08】display epoch——TH 脚本改正则/预设后的显示面失效+重渲染。
// 根因：脚本经 replaceTavernRegexes / updatePresetWith 改了 display 正则状态，
// displayRegexCache 不失效、消息楼层不重渲染 →「切了思维链开关画面没反应」。
// notifyDisplayMutation：清缓存 + bump epoch；楼层组件订阅 epoch 重跑 processed
// （含 displayScripts 重取）。真 TH 的 builtin.reloadAndRenderChatWithoutEvents 走本通道。
// ---------------------------------------------------------------------------
let displayEpoch = 0
const displayEpochListeners = new Set<() => void>()

export function notifyDisplayMutation(): void {
  invalidateWsCache()
  displayEpoch += 1
  for (const l of displayEpochListeners) l()
}

function useDisplayEpoch(): number {
  return useSyncExternalStore(
    cb => { displayEpochListeners.add(cb); return () => displayEpochListeners.delete(cb) },
    () => displayEpoch,
  )
}

function fetchWorkspaces(): Promise<RpWorkspaceInfo[]> {
  if (wsCache === null) {
    wsCache = rpApi<{ workspaces: RpWorkspaceInfo[] }>('rp/workspaces')
      .then(r => r.workspaces ?? [])
      .catch(() => [])
  }
  return wsCache
}

/** 按会话 cwd 匹配工作区协议配置；非 RP 会话返回 null（渲染退化为纯官方行为） */
function useOutputProtocol(cwd: string | undefined): OutputProtocol | null {
  const [proto, setProto] = useState<OutputProtocol | null>(null)
  const slug = slugFromCwd(cwd)
  useEffect(() => {
    let alive = true
    if (slug === null) { setProto(null); return }
    void fetchWorkspaces().then(list => {
      if (!alive) return
      const ws = list.find(w => w.slug === slug)
      setProto(ws ? withDefaults(ws.outputProtocol) : withDefaults(undefined))
    })
    return () => { alive = false }
  }, [slug])
  return proto
}

// ---------------------------------------------------------------------------
// display 时机正则（批次修复 5 → P0-3 升级）：display 视图消费「通用 + 仅显示」
// 脚本（两趟执行，见 display-compiler.ts runDisplayScripts）；promptOnly 专属不跑。
// placement 过滤含 1/2/3——AI_OUTPUT(2) 仅显示脚本也跑（P0 批次修复）。
// ---------------------------------------------------------------------------

/** slug+sessionId → display 脚本清单（regex/list 全局 + 预设（会话有效预设）+ 角色
 * 作用域三源合并——ST 语义：激活预设的 display 正则恒生效；invalidateWsCache 时失效） */
const displayRegexCache = new Map<string, Promise<RegexScript[]>>()

function fetchDisplayRegexes(slug: string, sessionId: string): Promise<RegexScript[]> {
  const key = `${slug}::${sessionId}`
  let p = displayRegexCache.get(key)
  if (p === undefined) {
    p = rpApi<{ global?: RegexScript[]; scoped?: RegexScript[]; preset?: RegexScript[] }>('regex/list', { slug, sessionId })
      .then(r => [...(r.global ?? []), ...(r.preset ?? []), ...(r.scoped ?? [])]
        .filter(s => s.disabled !== true && !(s.promptOnly === true && s.markdownOnly !== true)
          && (s.placement.includes(1) || s.placement.includes(2) || s.placement.includes(3))))
      .catch(() => [] as RegexScript[])
    displayRegexCache.set(key, p)
  }
  return p
}

function useDisplayRegexes(slug: string | null, sessionId: string): RegexScript[] {
  const [scripts, setScripts] = useState<RegexScript[]>([])
  const epoch = useDisplayEpoch() // 【Kemini 适配】正则/预设变更（epoch bump）后重取
  useEffect(() => {
    let alive = true
    if (slug === null || !sessionId) { setScripts([]); return }
    void fetchDisplayRegexes(slug, sessionId).then(s => { if (alive) setScripts(s) })
    return () => { alive = false }
  }, [slug, sessionId, epoch])
  return scripts
}

// ---------------------------------------------------------------------------
// 显示期管线数据（I4/B6/B8/C3）：display-compiler.ts 数据面（5s TTL 缓存）的消费端。
// 每个 assistant 楼层组件都调用本 hook——数据面模块级缓存兜住，只有首楼层真正发请求。
// ---------------------------------------------------------------------------

interface DisplayPipelineData {
  /** 宏上下文（identity+variables；null = 未就绪/失败 → 宏原文透传） */
  ctx: DisplayMacroCtx | null
  /** [RENDER:BEFORE/AFTER] 包裹（空串 = 不包裹） */
  entries: RenderEntries
  /** EJS 设置（null = 数据面不可达 → B6/B8 关） */
  ejs: EjsDisplaySettings | null
  /** TH 渲染组设置（null = 数据面不可达 → 渲染全开/深度不限） */
  th: ThRenderSettings | null
}

const EMPTY_PIPELINE_ENTRIES: RenderEntries = { before: '', after: '' }
const PIPELINE_UNLOADED: DisplayPipelineData = { ctx: null, entries: EMPTY_PIPELINE_ENTRIES, ejs: null, th: null }

function useDisplayPipeline(slug: string | null, sessionId: string): DisplayPipelineData {
  const [data, setData] = useState<DisplayPipelineData>(PIPELINE_UNLOADED)
  // 【鲁棒轮 2026-09-09】订阅 display epoch：Kemini 开关（regexes:replace/preset:put/
  // display:reload → notifyDisplayMutation）后已挂载楼层的宏上下文/[RENDER] 条目必须重取，
  // 否则楼层永远用挂载时刻的 ctx（变量树）展开 {{getvar}}。数据面 5s TTL 缓存兜住成本。
  const epoch = useDisplayEpoch()
  useEffect(() => {
    let alive = true
    void Promise.all([
      slug !== null && sessionId !== '' ? loadDisplayRenderCtx(slug, sessionId) : Promise.resolve(null),
      slug !== null && sessionId !== '' ? loadRenderEntries(slug, sessionId) : Promise.resolve(EMPTY_PIPELINE_ENTRIES),
      loadEjsDisplaySettings(),
      loadThRenderSettings(),
    ]).then(([ctx, entries, ejs, th]) => {
      if (alive) setData({ ctx, entries, ejs, th })
    })
    return () => { alive = false }
  }, [slug, sessionId, epoch])
  return data
}

// ---------------------------------------------------------------------------
// 消息窗口化（T1.14）：每条消息外壳自注册进共享协调器（chat-windowing.ts），
// 视口外的消息渲染等高占位（卸载 display iframe 等内容 DOM——省内存关键），
// 滚回可视带时重新渲染（display 正则/变体组均有会话级缓存，不重复拉取）。
// ≤ 40 条的会话协调器不启用窗口化，行为与未窗口化完全一致。
// ---------------------------------------------------------------------------

/**
 * 消息窗口化 hook：返回外壳 ref 与 windowed 状态。
 * - 注册走 useLayoutEffect（首帧 paint 前完成注册，滚动判定不失帧）；
 * - windowed 用 useSyncExternalStore 订阅协调器（仅翻转条目重渲染）；
 * - 翻转 commit 后回执 reportWindowCommit → 协调器统一做滚动锚定补偿
 *   （占位↔实测高度差的位置还原；用户手动滚动不受干预）。
 */
function useMessageWindowing(sessionKey: string, nodeKey: string, forced: boolean): {
  shellRef: MutableRefObject<HTMLDivElement | null>
  windowed: boolean
  placeholderHeight: number
} {
  const shellRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = shellRef.current
    if (el === null) return
    return registerMessageWindowing({ sessionKey, nodeKey, el, forced })
  }, [sessionKey, nodeKey, forced])
  const windowed = useSyncExternalStore(
    subscribeWindowing,
    () => isMessageWindowed(sessionKey, nodeKey),
  )
  // 翻转回执：仅 windowed 变化的 commit 上报（首次挂载 prev 为 null 不上报）
  const prevWindowed = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    const prev = prevWindowed.current
    prevWindowed.current = windowed
    if (prev !== null && prev !== windowed) reportWindowCommit()
  }, [windowed, sessionKey, nodeKey])
  // 占位渲染时读一次最新缓存（真实渲染期间 RO 持续更新，翻转瞬间定格）
  return { shellRef, windowed, placeholderHeight: messagePlaceholderHeight(sessionKey, nodeKey) }
}

// ---------------------------------------------------------------------------
// 渲染组件
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 楼层号徽章（§2.3 ③）：#N 1 起始（开场白/首条消息 #1，与 ST 观感一致）。
// 楼层口径 = 用户口径（2026-09-04 拍板）：**一轮用户输入 = 1 楼，一轮 AI 回答
// （同 turn 的全部思考/工具 step）= 1 楼**——绝不是每个思考 step 一楼。
// 与 lore/trigger.ts visibleMessageCursor（世界书技术游标，消息条数口径）解耦：
// UI 楼层与剧情记忆锚「记忆#N」同用 turn 口径（dsht-plugin-memory extractFloorsFromEvents）。
// 设置→插件「聊天偏好」楼层号显示可关（/rp/chat-prefs，模块级缓存一次）。
// ---------------------------------------------------------------------------

interface LikeChatSnapshot {
  chat?: {
    order?: readonly string[]
    nodes?: { values: () => Iterable<{ key?: string; kind?: string; data?: { source?: { kind?: unknown }; turn?: unknown; time?: unknown; status?: unknown; seq?: unknown } }> }
  }
}

interface FloorIndex {
  /** assistant-step / user 楼层消息节点 key → 楼层号（1 起始）；非楼层节点不在表内 */
  floors: Map<string, number>
  /** assistant-step key → 该 step 耗时 ms（finalNode.timing 起止差；数据缺失不在表内） */
  stepMs: Map<string, number>
  /** turn 最后一个 assistant-step key → 该轮总耗时 ms（= 末 step completedTime − 首 step 开始） */
  turnMs: Map<string, number>
  /** 逻辑回退掩码：seq 大于此值的真实消息已从上下文移除（UI 同步隐藏）。
   *  来源 = 回退/编辑/重新生成 marker（session-rollback 系列路由写入的
   *  source.rolledBackTo / editedFrom / regeneratedFrom）；0 = 无回退 */
  hideAfter: number
}

/** 从快照找最新的逻辑回退标记（取最大锚：多次回退取最后一次）。
 *  标记是 dsht-rp 插件 append 的 user/message（source.kind='plugin' + rolledBackTo /
 *  editedFrom / regeneratedFrom）——**投影 kind 是 'context'**（插件注入不投影为
 *  user 行），因此不能按 kind==='user' 过滤，须全节点扫 source 字段。
 *  edit 语义 = 锚消息本身也隐藏 → hideAfter = editedFrom − 1；rollback/regenerate
 *  = 锚消息保留 → hideAfter = 锚 seq。统一规则：真实消息 seq > hideAfter 即隐藏。 */
function hideAfterOf(snapshot: LikeChatSnapshot): number {
  let hide = 0
  const chat = snapshot.chat
  if (!chat?.order || !chat.nodes) return 0
  for (const n of chat.nodes.values()) {
    const src = n.data?.source as { kind?: unknown; plugin?: unknown; rolledBackTo?: unknown; editedFrom?: unknown; regeneratedFrom?: unknown } | undefined
    if (!src || src.kind !== 'plugin' || src.plugin !== 'dsht-rp') continue
    if (typeof src.rolledBackTo === 'number') hide = Math.max(hide, src.rolledBackTo)
    if (typeof src.regeneratedFrom === 'number') hide = Math.max(hide, src.regeneratedFrom)
    if (typeof src.editedFrom === 'number') hide = Math.max(hide, src.editedFrom - 1)
  }
  return hide
}

/** 会话快照 → 楼层索引（楼层号 + step/turn 耗时）。
 *  楼层判定：
 *  - user 仅当 data.source.kind === 'user'（steering/context/插件注入不算）；
 *  - assistant-step 按 data.turn 分组：同 turn 的全部 step（思考轮/工具轮）合计 1 楼；
 *    物化开场白是真实 assistant 消息 → 占第 1 楼；
 *  - compaction/manual-compaction/tool/retry/turn-tail 等非消息 kind 不占号。
 *  耗时判定（任务结束后折叠行「思考了 X」的数据源，精确口径）：settled step 用
 *  finalNode.timing（stepStartTime → completedTime = 该 step 真实起止）；timing
 *  缺失退化 data.time → 同 turn 下一 step.data.time；turn 总耗时 = 末 step
 *  completedTime − 首 step 开始；running 的 step 无定稿时间不显示。
 *  WeakMap 按快照代际缓存——useSession 选择器要求引用稳定（每代一份）。 */
const floorIndexCache = new WeakMap<object, FloorIndex>()
/** 掩码按 (snapshot, hideAfter) 组合缓存——同一快照在掩码变化（回退操作后）时重算 */
const floorIndexCacheKey = new WeakMap<object, number>()
/** 【2026-09-06 实证修复】核心按 Chat 本体计算（nodes/order 顶层）——SessionSnapshot
 *  不带 chat 投影（fiber 实证），旧实现把 useSession 快照当有 chat 用 → 楼层号恒缺席
 * （真机 hashFloors=[] 实证）。chat.node 席位组件同时拿得到 useChat（Chat 本体快照）。 */
function floorIndexOfChat(chat: LikeChatSnapshot['chat'], hideAfter: number): Omit<FloorIndex, 'hideAfter'> {
  const floors = new Map<string, number>()
  const stepMs = new Map<string, number>()
  const turnMs = new Map<string, number>()
  if (chat?.order && chat.nodes) {
    const byKey = new Map<string, { kind?: string; data?: { source?: { kind?: unknown }; turn?: unknown; time?: unknown; status?: unknown; seq?: unknown; finalNode?: { seq?: unknown; timing?: { stepStartTime?: number | null; completedTime?: number }; time?: unknown } } }>()
    for (const n of chat.nodes.values()) {
      if (typeof n.key === 'string') byKey.set(n.key, { kind: n.kind, data: n.data })
    }
    // 顺序扫一遍：分楼 + 收集 turn 的 step 起止（供耗时计算）。
    // 逻辑回退掩码：seq > hideAfter 的真实消息已从上下文移除（回退/编辑/重新生成
    // marker），UI 楼层号与耗时表同步跳过（视觉 = 真回退，数据零丢失）。
    let floor = 1
    let lastTurn: number | null = null
    const turnSteps = new Map<number, Array<{ key: string; start: number; end: number | null }>>()
    for (const key of chat.order) {
      const n = byKey.get(key)
      if (n === undefined) continue
      if (n.kind === 'assistant-step') {
        const mySeq = typeof n.data?.finalNode?.seq === 'number' ? n.data.finalNode.seq : undefined
        if (hideAfter > 0 && typeof mySeq === 'number' && mySeq > hideAfter) continue
        const turn = typeof n.data?.turn === 'number' ? n.data.turn : null
        if (turn === null || turn !== lastTurn) {
          floor += 1
          lastTurn = turn
        }
        floors.set(key, floor)
        if (turn !== null && typeof n.data?.time === 'number') {
          const timing = n.data?.finalNode?.timing
          const end = typeof timing?.completedTime === 'number' ? timing.completedTime : null
          const start = typeof timing?.stepStartTime === 'number' ? timing.stepStartTime : (n.data.time as number)
          const list = turnSteps.get(turn)
          if (list !== undefined) list.push({ key, start, end })
          else turnSteps.set(turn, [{ key, start, end }])
        }
      } else if (n.kind === 'user') {
        if (n.data?.source?.kind !== 'user') continue
        if (hideAfter > 0 && typeof n.data?.seq === 'number' && n.data.seq > hideAfter) continue
        floor += 1
        lastTurn = null
        floors.set(key, floor)
      }
    }
    // 耗时汇总（turn 内 step 起止齐备才计；running 的 step 无 completedTime 不显示）
    for (const steps of turnSteps.values()) {
      if (steps.length === 0) continue
      for (const s of steps) {
        if (s.end === null || s.end <= s.start) continue
        stepMs.set(s.key, s.end - s.start)
      }
      const first = steps[0]
      const last = steps[steps.length - 1]
      if (last.end !== null && last.end > first.start) turnMs.set(last.key, last.end - first.start)
    }
  }
  return { floors, stepMs, turnMs }
}

/** SessionSnapshot 包装（旧调用点；快照带 chat 投影时才有效） */
function floorIndexOf(snapshot: unknown, hideAfter = hideAfterOf(snapshot as LikeChatSnapshot)): FloorIndex {
  const snap = snapshot as object
  const cached = floorIndexCache.get(snap)
  const cachedMask = floorIndexCacheKey.get(snap) ?? 0
  if (cached !== undefined && cachedMask === hideAfter) return cached
  const core = floorIndexOfChat((snapshot as LikeChatSnapshot).chat, hideAfter)
  const index: FloorIndex = { ...core, hideAfter: hideAfterOf(snapshot as LikeChatSnapshot) }
  floorIndexCache.set(snap, index)
  // 【鲁棒轮 2026-09-09】漏写 cacheKey → rollbackMask 异步到达后的重算恒 miss
  // （O(N²) 每帧重算 + mask 回退时陈旧命中），与 floorIndexFromChat 对齐。
  floorIndexCacheKey.set(snap, hideAfter)
  return index
}

/** Chat 本体快照 → 楼层索引（useChat 选择器；WeakMap 按代际缓存） */
function floorIndexFromChat(chat: unknown, hideAfter: number): Omit<FloorIndex, 'hideAfter'> {
  const snap = (chat ?? {}) as object
  const cached = floorIndexCache.get(snap)
  const cachedMask = floorIndexCacheKey.get(snap) ?? 0
  if (cached !== undefined && cachedMask === hideAfter) return cached
  const core = floorIndexOfChat(chat as LikeChatSnapshot['chat'], hideAfter)
  const index: FloorIndex = { ...core, hideAfter }
  floorIndexCache.set(snap, index)
  floorIndexCacheKey.set(snap, hideAfter)
  return index
}

/** 兼容旧调用点：楼层表（floorIndexOf().floors） */
function floorMapOf(snapshot: unknown): Map<string, number> {
  return floorIndexOf(snapshot).floors
}

// ---------------------------------------------------------------------------
// 逻辑回退掩码 store（sessionId → hideAfter）：host 从 session.jsonl 解析回退/
// 编辑/重新生成 marker（/rp/rollback-mask）——客户端投影不透传 marker 的 source
// 字段（真机实证），故由前端拉取。useSyncExternalStore 订阅；回退/编辑/重新
// 生成成功后调 refreshRollbackMask 立即刷新（UI 即时隐藏 + 楼层号重排）。
// ---------------------------------------------------------------------------
const maskCache = new Map<string, number>()
const maskListeners = new Map<string, Set<() => void>>()
const maskInflight = new Set<string>()
async function refreshRollbackMask(sessionId: string): Promise<void> {
  if (maskInflight.has(sessionId)) return
  maskInflight.add(sessionId)
  try {
    const r = await rpApi<{ hideAfter?: number }>('rp/rollback-mask', { sessionId })
    const next = typeof r.hideAfter === 'number' && r.hideAfter > 0 ? r.hideAfter : 0
    if (maskCache.get(sessionId) !== next) {
      maskCache.set(sessionId, next)
      maskListeners.get(sessionId)?.forEach(cb => cb())
    }
  } catch { /* 掩码获取失败按 0（不隐藏） */ } finally {
    maskInflight.delete(sessionId)
  }
}
function useRollbackMask(sessionId: string | undefined): number {
  const value = sessionId !== undefined ? (maskCache.get(sessionId) ?? 0) : 0
  const subscribe = useCallback((cb: () => void) => {
    if (sessionId === undefined) return () => undefined
    let set = maskListeners.get(sessionId)
    if (set === undefined) { set = new Set(); maskListeners.set(sessionId, set) }
    set.add(cb)
    void refreshRollbackMask(sessionId)
    return () => { set!.delete(cb) }
  }, [sessionId])
  const getSnapshot = useCallback(() => (sessionId !== undefined ? maskCache.get(sessionId) ?? 0 : 0), [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}
// globalThis 桥：index.tsx 的 regenerate inject（跨模块）成功后刷新掩码
;(globalThis as { __dshtRpRefreshRollbackMask?: (sid: string) => Promise<void> }).__dshtRpRefreshRollbackMask = refreshRollbackMask

/** 聊天偏好（楼层号显示开关；GET /rp/chat-prefs，模块级缓存一次——设置页改后刷新生效） */
let chatPrefsCache: Promise<boolean> | null = null
function fetchFloorBadgePref(): Promise<boolean> {
  if (chatPrefsCache === null) {
    chatPrefsCache = rpApi<{ floorBadge?: boolean }>('rp/chat-prefs')
      .then(r => r.floorBadge !== false)
      .catch(() => true)
  }
  return chatPrefsCache
}
function useFloorBadgePref(): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    let alive = true
    void fetchFloorBadgePref().then(v => { if (alive) setOn(v) })
    return () => { alive = false }
  }, [])
  return on
}

/** 工作区角色名缓存（rp/workspaces 全量缓存按 slug 取 name——楼层头用，避免逐楼请求） */
const wsNameCache = new Map<string, string>()
function workspaceName(slug: string): string {
  const hit = wsNameCache.get(slug)
  if (hit !== undefined) return hit
  void fetchWorkspaces().then(list => {
    const hit = list.find(w => w.slug === slug)
    if (hit !== undefined && !wsNameCache.has(slug)) wsNameCache.set(slug, hit.name)
  }).catch(() => { /* 拉不到 → 楼层头退 slug 显示 */ })
  return slug
}

function formatFloorTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** ST 同款楼层时间（基准 316：September 3, 2026 + 6:38 AM 两行；en-US 固定——与用户 ST 实测一致） */
function formatFloorTimeSt(ms: number): { date: string; time: string } {
  try {
    const d = new Date(ms)
    return {
      date: d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    }
  } catch {
    return { date: '', time: '' }
  }
}

/** ST 同款楼层耗时（基准 316：68.4s 一位小数秒；<0.1s 视为无真实生成窗口不显示） */
function formatFloorDurationSt(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** 节点时间（epoch ms；消息节点 data.time，迁移/实发都在） */
function nodeTimeMs(node: { data?: unknown }): number | undefined {
  const t = (node.data as { time?: unknown } | undefined)?.time
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : undefined
}

/** RP 会话活跃标记（body[data-dsht-rp-active]）：楼层头挂载计数 >0 即 RP 楼层在场，
 * turn-process 隐藏 CSS 的作用域开关（非 RP 会话宿主行为零影响）。 */
let rpActiveFloors = 0
function useRpActiveMarker(): void {
  useEffect(() => {
    rpActiveFloors += 1
    document.body.setAttribute('data-dsht-rp-active', '1')
    return () => {
      rpActiveFloors -= 1
      if (rpActiveFloors <= 0) document.body.removeAttribute('data-dsht-rp-active')
    }
  }, [])
}

/** ST 同款楼层头（2026-09-06 视觉验收，对照基准 316）：
 *  头像（/dsht-rp/rp/avatar?slug=，404 时隐藏）+ 角色名 + `#N · 耗时 · 时间` 元信息行。
 *  user 侧右对齐无头像（ST 用户名 = 玩家名，此处显示「你」）。
 *  楼层号/耗时来自 useChat（Chat 本体快照）——SessionSnapshot 不带 chat（fiber 实证），
 *  旧 RpFloorBadge 用 useSession → 楼层号恒缺席（真机 hashFloors=[] 实证），本组件取代之。 */

// 【2026-09-07 ST 对齐】角色显示名缓存（GET /dsht-rp/rp/charname?slug=）：single-flight +
// 订阅刷新——166 个楼层共享一次请求，name 到达后一次性重渲染。
const charNameCache = new Map<string, string>()
const charNameInflight = new Map<string, Promise<void>>()
let charNameSubs: Set<() => void> | null = null
function useCharName(slug: string | null): string | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (charNameSubs === null) charNameSubs = new Set()
    const fn = () => tick(t => t + 1)
    charNameSubs.add(fn)
    return () => { charNameSubs?.delete(fn) }
  }, [])
  if (slug === null) return null
  const hit = charNameCache.get(slug)
  if (hit !== undefined) return hit
  if (!charNameInflight.has(slug)) {
    charNameInflight.set(slug, fetch(`/dsht-rp/rp/charname?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json() as Promise<{ name?: string }>)
      .then(b => {
        charNameCache.set(slug, typeof b.name === 'string' && b.name ? b.name : slug)
      })
      .catch(() => { charNameCache.set(slug, slug) })
      .finally(() => {
        charNameInflight.delete(slug)
        for (const fn of charNameSubs ?? []) { try { fn() } catch { /* 订阅者异常不扩散 */ } }
      }))
  }
  return null
}

const RpFloorHeader = memo(function RpFloorHeader({ useChat, nodeKey, side, sessionId, slug, timeMs }: {
  useChat?: (<T>(selector: (snapshot: unknown) => T) => T) | undefined
  nodeKey: string
  side: 'user' | 'assistant'
  sessionId?: string | undefined
  slug: string | null
  timeMs?: number
}) {
  const showFloor = useFloorBadgePref()
  const hideAfter = useRollbackMask(sessionId)
  const index = useChat === undefined ? undefined : useChat((snapshot) => floorIndexFromChat(snapshot, hideAfter))
  const floor = index?.floors.get(nodeKey)
  const turnMs = index?.turnMs.get(nodeKey)
  useRpActiveMarker()
  // 【2026-09-07 ST 对齐】assistant 楼层名 = 角色显示名（GET /dsht-rp/rp/charname，基准 316
  // 「ExampleGame ExampleWorld MVU Edition」）——workspace slug 只是加载期的兜底（166 楼层共享一次请求）
  const charName = useCharName(side === 'assistant' ? slug : null)
  const name = side === 'assistant' && slug !== null
    ? charName ?? wsNameCache.get(slug) ?? workspaceName(slug)
    : '你'
  if (floor === undefined) return null
  // 【2026-09-07 楼层头二次对齐】assistant 楼层头横排在楼层顶部（头像+名字+元信息一行），
  // 正文全宽在其下；sticky top 长楼层下滑时钉在视口顶（布局细节见 style.ts .dsht-rp-assistant）
  const meta: string[] = []
  if (side === 'assistant') {
    if (showFloor) meta.push(`#${floor}`)
    if (typeof turnMs === 'number' && turnMs >= 500) meta.push(formatFloorDurationSt(turnMs))
  } else {
    if (showFloor) meta.push(`#${floor}`)
    if (side === 'assistant' && typeof turnMs === 'number' && turnMs >= 500) meta.push(formatDuration(turnMs))
    if (typeof timeMs === 'number' && timeMs > 0) meta.push(formatFloorTime(timeMs))
  }
  const st = side === 'assistant' && typeof timeMs === 'number' && timeMs > 0 ? formatFloorTimeSt(timeMs) : null
  return (
    <div className={`dsht-rp-floor-head dsht-rp-floor-head-${side}`} data-testid="dsht-rp-floor">
      {side === 'assistant' && slug !== null && (
        <img
          className="dsht-rp-avatar" alt=""
          src={`/dsht-rp/rp/avatar?slug=${encodeURIComponent(slug)}`}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="dsht-rp-floor-meta">
        <span className="dsht-rp-floor-name">{name}</span>
        {meta.length > 0 && <span className="dsht-rp-floor-sub">{meta.join(' · ')}</span>}
        {st !== null && st.date !== '' && (
          <>
            <span className="dsht-rp-floor-sub">{st.date}</span>
            <span className="dsht-rp-floor-sub">{st.time}</span>
          </>
        )}
      </div>
    </div>
  )
})

/** 状态栏卡片（§4.6：状态/位置信息渲染为卡片，数据不出本组件） */
export const StatusBarCard = memo(function StatusBarCard({ content }: { content: string }) {
  const rows = useMemo(() => parseStatusBarRows(content), [content])
  return (
    <div className="dsht-rp-statusbar" data-testid="dsht-rp-statusbar">
      <div className="sb-title">◆ STATUS</div>
      {rows.length > 0
        ? rows.map(([k, v], i) => (
          <div className="sb-row" key={i}><span className="sb-k">{k}</span><span className="sb-v">{v}</span></div>
        ))
        : <div className="sb-row">{content.trim().slice(0, 600)}</div>}
    </div>
  )
})

/**
 * MVU 状态栏组件（批次修复 4）：<StatusPlaceHolderImpl/> 占位符的替换渲染（F4）。
 * fetch GET /dsht-mvu/statusbar-render?sessionId=xxx（返回 {html}），白名单 sanitize
 * 后按 HTML 渲染；路由不可达 / 无 html / 含白名单外标签时整块隐藏（不裸文本）。
 * F4：每 session 5s 模块级缓存——同一会话多楼层占位符/窗口化回渲不重复拉取。
 */
const statusbarRenderCache = new Map<string, { at: number; html: Promise<string | null> }>()

function fetchStatusbarRender(sessionId: string): Promise<string | null> {
  const now = Date.now()
  const cached = statusbarRenderCache.get(sessionId)
  if (cached !== undefined && now - cached.at < 5000) return cached.html
  const html = fetch(`/dsht-mvu/statusbar-render?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
    .then(async r => {
      if (!r.ok) return null
      const j = await r.json() as { html?: unknown }
      return typeof j.html === 'string' ? sanitizeDisplayHtml(j.html) : null
    })
    .catch(() => null)
  statusbarRenderCache.set(sessionId, { at: now, html })
  return html
}

const MvuStatusbar = memo(function MvuStatusbar({ sessionId }: { sessionId: string | undefined }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (sessionId === undefined) return
    void fetchStatusbarRender(sessionId).then(h => {
      // sanitize 失败（null）/路由不可达 → 保持整块隐藏（不裸文本）
      if (alive && h !== null) setHtml(h)
    })
    return () => { alive = false }
  }, [sessionId])
  if (html === null) return null
  return <div className="dsht-rp-mvu-statusbar" data-testid="dsht-rp-statusbar" dangerouslySetInnerHTML={{ __html: html }} />
})

/**
 * 完整 HTML 文档段的 iframe 渲染器（P0-2；骨架照抄 dsh-tavern client.js L903-941
 * TavernMessageFrame，MIT）：
 * - sandbox="allow-scripts"（不给 allow-same-origin）+ referrerPolicy="no-referrer"；
 * - srcdoc 由 buildDisplayFrameDocument 组装（CSP + 高度上报脚本）；C3 use_blob_url
 *   开启时改走 blob: URL（TH 同款形态；卸载/文档变更时 revoke）；
 * - 高度由 iframe 内 postMessage 上报（token + event.source 双校验），clamp [48,12000]。
 * 悬浮球这类 position:fixed 部件在 iframe 内能跑（iframe 即它的舞台）。
 */
// ---------------------------------------------------------------------------
// 【审计 E 类修复 2026-09-08】消息帧停车场：iframe 卸载 → 隐藏容器保活，重挂载原样移回
//
// 问题（loop 审计实测）：窗口化翻转/楼层列表重排会卸载 RpMessageFrame → iframe 元素
// 销毁 → 滚回来时同 html 重建 iframe → 文档从头重执行 → 卡脚本状态清零、绑定在
// 旧节点上的委托/监听全灭（「点了没反应」的经典来源）。
//
// 方案：卸载时把 iframe 元素**移入** display:none 的停车场容器（同文档节点移动不
// 触发重载，文档保持活着：脚本状态/变量桥/事件路由全保留）；重挂载时按 frameKey
// （html 内容哈希 + shim 形态）认领原帧移回运行位。LRU 上限防内存失控，驱逐时才
// 真正 release guest + revoke blob + 销毁节点。
// ---------------------------------------------------------------------------

interface ParkedFrame {
  el: HTMLIFrameElement
  token: string
  guest: { sessionId: string; scriptId: string } | null
  shimBlob: string | null
  blobUrl: string | null
  inUse: boolean
  parkedAt: number
}

/** frameKey → 停车条目（含 in-use；同 key 并存实例上限 2，防重复楼层撑爆） */
const framePark = new Map<string, ParkedFrame[]>()
/** 全局停车上限（16 帧：多会话轮换也要保得住状态；驱逐 = 该帧重执行，状态丢失——
 *  审计第二轮实证 8 帧在 4 会话轮换下不够用）。shim blob ~600KB/帧，16 帧 ≈ 10MB 封顶 */
const FRAME_PARK_LIMIT = 16
let frameParkContainer: HTMLDivElement | null = null

function frameHash8(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function frameParkContainerOf(): HTMLDivElement {
  if (frameParkContainer === null) {
    frameParkContainer = document.createElement('div')
    frameParkContainer.id = 'dsht-rp-frame-park'
    frameParkContainer.setAttribute('aria-hidden', 'true')
    frameParkContainer.style.cssText = 'display:none'
    document.body.appendChild(frameParkContainer)
  }
  return frameParkContainer
}

/** LRU 驱逐：只驱逐非 in-use 条目；真正释放 guest + revoke blob + 销毁节点 */
function evictParkedFrames(): void {
  const all: Array<{ e: ParkedFrame; key: string }> = []
  for (const [key, list] of framePark) {
    for (const e of list) if (!e.inUse) all.push({ e, key }) // 保留原引用（filter 身份比对靠它）
  }
  if (all.length <= FRAME_PARK_LIMIT) return
  all.sort((a, b) => a.e.parkedAt - b.e.parkedAt)
  const victims = all.slice(0, all.length - FRAME_PARK_LIMIT)
  for (const { e: victim, key } of victims) {
    const list = framePark.get(key)
    if (list !== undefined) {
      const next = list.filter(e => e !== victim)
      if (next.length === 0) framePark.delete(key)
      else framePark.set(key, next)
    }
    if (victim.guest !== null) releaseMessageFrame(victim.guest.sessionId, victim.guest.scriptId)
    if (victim.shimBlob !== null) URL.revokeObjectURL(victim.shimBlob)
    if (victim.blobUrl !== null) URL.revokeObjectURL(victim.blobUrl)
    victim.el.remove()
  }
}

/** 入场：卸载的 iframe 移入停车场（不释放任何活资源） */
function parkMessageFrame(key: string, entry: ParkedFrame): void {
  entry.inUse = false
  entry.parkedAt = Date.now()
  const list = framePark.get(key) ?? []
  list.push(entry)
  // 同 key 并存上限 2：最旧的非 in-use 条目直接驱逐（防流式楼层 hash 序列膨胀）
  const idle = list.filter(e => !e.inUse)
  if (idle.length > 2) {
    idle.sort((a, b) => a.parkedAt - b.parkedAt)
    const victim = idle[0]
    if (victim !== undefined) {
      framePark.set(key, list.filter(e => e !== victim))
      if (victim.guest !== null) releaseMessageFrame(victim.guest.sessionId, victim.guest.scriptId)
      if (victim.shimBlob !== null) URL.revokeObjectURL(victim.shimBlob)
      if (victim.blobUrl !== null) URL.revokeObjectURL(victim.blobUrl)
      victim.el.remove()
    }
  } else {
    framePark.set(key, list)
  }
  frameParkContainerOf().appendChild(entry.el)
  evictParkedFrames()
}

const RpMessageFrame = memo(function RpMessageFrame({ html, useBlobUrl = false, sessionId, slug, thShim }: {
  html: string
  useBlobUrl?: boolean
  sessionId?: string | undefined
  slug?: string | undefined
  thShim?: boolean
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const tokenRef = useRef('')
  const [height, setHeight] = useState(80)
  const [mounted, setMounted] = useState(false)
  // TH shim guest 注入（真 TH message iframe 同款）：卡内脚本（示例游戏状态栏等）在楼层
  // iframe 直接调 getAllVariables/Mvu——无 shim 时数据恒为占位符「--」（CDP 实测）。
  const guestRef = useRef<{ sessionId: string; scriptId: string } | null>(null)
  const shimBlobRef = useRef<string | null>(null)
  const blobRef = useRef<string | null>(null)
  // 需要注 shim 的帧才注（vendor ~600KB/帧的 srcdoc 体积与解析成本）——卡内脚本
  // 调 TH API（getAllVariables/Mvu/eventOn…）的楼层帧才需要；纯剧情文档直接渲染
  const needsShim = /getAllVariables|getVariables\s*\(|TavernHelper|Mvu\.|eventOn\s*\(|insertOrAssignVariables|replaceVariables|getChatMessages/.test(html)
  const shimOn = thShim === true && sessionId !== undefined && slug !== undefined && needsShim
  // 同步变量面数据源：帧建好前先拉一次合并变量树（模块级 TTL 缓存，多帧共享）
  const [frameVars, setFrameVars] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    if (!shimOn || sessionId === undefined || slug === undefined) return
    let alive = true
    void fetchFrameVars(sessionId, slug).then(v => { if (alive) setFrameVars(v) }).catch(() => { /* 拉不到 = 空缓存，卡片走自身兜底 */ })
    return () => { alive = false }
  }, [shimOn, sessionId, slug])
  // 等 guest shim 的变量树到位（未就绪期不渲染 mount，状态栏首帧即真数据）
  const docReady = !shimOn || frameVars !== null
  // 帧身份：html 内容哈希 + 会话域 + shim 形态 + blob 模式——停车场认领/入库的唯一键。
  // 【审计第二轮修复】sessionId 无条件入键：同卡各会话的开场帧 html 相同，早期版本
  // plain 帧不含 session → 跨会话认领到别的会话的帧（元素身份漂移，审计实证）
  const frameKey = `${frameHash8(html)}|${sessionId !== undefined ? `${sessionId}::${slug ?? ''}` : 'plain'}|${shimOn ? 'th' : 'plain'}|${useBlobUrl ? 'b' : 's'}`
  useEffect(() => {
    if (!docReady) return
    const mount = mountRef.current
    if (mount === null) return
    // 1) 停车场认领：同 key 空闲帧原样移回（文档不重执行，卡状态保留）
    const list = framePark.get(frameKey)
    const entry = list?.find(e => !e.inUse)
    if (entry !== undefined && list !== undefined) {
      framePark.set(frameKey, list.filter(e => e !== entry))
      entry.inUse = true
      frameRef.current = entry.el
      tokenRef.current = entry.token
      guestRef.current = entry.guest
      shimBlobRef.current = entry.shimBlob
      blobRef.current = entry.blobUrl
      const lastH = Number(entry.el.dataset.lastHeight)
      if (Number.isFinite(lastH) && lastH > 0) setHeight(clampFrameHeight(lastH))
      mount.appendChild(entry.el)
      if (entry.guest !== null) attachMessageFrame(entry.guest.sessionId, entry.guest.scriptId, entry.el)
      setMounted(true)
      // cleanup（闭包捕获本轮实体，绝不裸读 ref——下一轮 effect 的 cleanup 先于本轮 body 运行）
      const el = entry.el
      const guest = entry.guest
      return () => {
        parkMessageFrame(frameKey, {
          el, token: entry.token, guest, shimBlob: entry.shimBlob, blobUrl: entry.blobUrl,
          inUse: false, parkedAt: Date.now(),
        })
        if (frameRef.current === el) frameRef.current = null
      }
    }
    // 2) 新建：命令式创建 iframe（React 不管理其生命周期）
    // 【审计第三轮修正】shim 帧**不进停车场**：park 往返的 iframe 重插入会重载文档 →
    // shim 重执行后与宿主的桥接序号/握手失配 → 首个桥调用永无回包（实测：start 按钮
    // 点出 callId 后永挂）。shim 帧卸载走完整释放；切会话重渲染消息 iframe 本就是
    // ST 原生行为（状态重置属预期）。纯 DOM 帧（无 shim）继续 park 保活。
    const parkable = !shimOn
    const el = document.createElement('iframe')
    el.className = 'dsht-rp-message-frame'
    el.title = '人物卡前端界面'
    // allow-same-origin：卡自带 <script> 依赖 parent.$/jQuery/Mvu/eventOn（真 TH/ST 的
    // message iframe 就是同源形态，用户拍板复刻）。【2026-09-07】+ allow-modals 等：
    // sandbox 缺 allow-modals 时 iframe 内 confirm()/alert() 被 Chromium 静默丢弃。
    el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-forms allow-popups')
    el.setAttribute('referrerpolicy', 'no-referrer')
    el.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent'
    const token = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}:${Math.random()}`
    tokenRef.current = token
    let guest: { sessionId: string; scriptId: string } | null = null
    let shimBlob: string | null = null
    // 先建显示骨架（CSP + 高度上报 + 遮挡 lint），再把 vendor/shim 以 blob 外链注进
    // <head>——卡的 style/script 保持原位且晚于 shim 执行（真 TH 顺序语义）
    let doc = buildDisplayFrameDocument(html, token)
    if (shimOn && sessionId !== undefined && slug !== undefined) {
      const g = reserveMessageFrame(sessionId, slug)
      if (g !== null) {
        const shimSrc = buildShimSource({ scriptId: g.scriptId, scriptName: '楼层渲染', secret: g.secret, version: SHIM_VERSION })
        shimBlob = URL.createObjectURL(new Blob([shimSrc], { type: 'text/javascript' }))
        guest = { sessionId: g.sessionId, scriptId: g.scriptId }
        doc = buildMessageFrameDocument(doc, {
          scriptId: g.scriptId, scriptName: '楼层渲染', secret: g.secret, version: SHIM_VERSION,
          initialVars: frameVars ?? undefined,
          initialContext: getRpContextSnapshot(sessionId),
          vendorUrl: getVendorBlobUrl(), shimUrl: shimBlob,
        })
      }
    }
    let blobUrl: string | null = null
    if (useBlobUrl) {
      blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html' }))
      el.src = blobUrl
    } else {
      el.srcdoc = doc
    }
    mount.appendChild(el)
    frameRef.current = el
    guestRef.current = guest
    shimBlobRef.current = shimBlob
    blobRef.current = blobUrl
    if (guest !== null) attachMessageFrame(guest.sessionId, guest.scriptId, el)
    setMounted(true)
    // cleanup：卸载 → shim 帧完整释放（保活会让重载帧桥接死亡，见上）；纯 DOM 帧 → 入停车场保活
    return () => {
      if (!parkable) {
        if (guest !== null) releaseMessageFrame(guest.sessionId, guest.scriptId)
        if (shimBlob !== null) URL.revokeObjectURL(shimBlob)
        if (blobUrl !== null) URL.revokeObjectURL(blobUrl)
        el.remove()
        if (frameRef.current === el) frameRef.current = null
        return
      }
      parkMessageFrame(frameKey, {
        el, token, guest: null, shimBlob: null, blobUrl, inUse: false, parkedAt: Date.now(),
      })
      if (frameRef.current === el) frameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docReady, frameKey])
  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      const frame = frameRef.current
      const data = event.data as { type?: string; token?: string; height?: number } | null
      if (frame === null || event.source !== frame.contentWindow || data === null || data.token !== tokenRef.current) return
      if (data.type === FRAME_HEIGHT_MESSAGE_TYPE) {
        const h = clampFrameHeight(Number(data.height))
        frame.dataset.lastHeight = String(h) // 停车/认领往返后恢复高度（防止回落 80px 抖动）
        setHeight(h)
      }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [])
  // 等 guest shim 的变量树到位（未就绪期不渲染，状态栏首帧即真数据）
  if (!docReady) return null
  return (
    <div
      ref={mountRef}
      className="dsht-rp-message-frame-mount"
      style={{ height: mounted ? `${height}px` : '80px', overflow: height >= FRAME_MAX_HEIGHT ? 'auto' : 'hidden' }}
    />
  )
})

/** 耗时格式化（思考折叠行「思考了 X」）：秒 <60，否则 分+秒 */
function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/** ST 迁移：思考耗时标记（<!--dsht:reasoning-duration:123-->）解析。
 *  toAssistantBlock 只留 kind/text（lib 闭件），耗时随 reasoning 文本首行走；
 *  注释在渲染层天然不可见，这里剥离并把毫秒交给 ReasoningRow「思考了 X」。 */
const REASONING_DURATION_RE = /^<!--dsht:reasoning-duration:(\d+)-->\s*/
function parseReasoningDuration(text: string): { text: string; durationMs?: number } {
  const m = REASONING_DURATION_RE.exec(text)
  if (m === null) return { text }
  const ms = Number(m[1])
  return Number.isFinite(ms) && ms > 0 ? { text: text.slice(m[0].length), durationMs: ms } : { text: text.slice(m[0].length) }
}

/** reasoning 折叠行（T2.5d 差值补齐：原生 ReasoningRow 不可 import，最小等效实现）。
 *  任务结束后折叠为一行并显示耗时（2026-09-04 用户要求）：settled 且有快照
 *  time 数据时显示「思考了 X」；turn 总耗时可得时附「本轮共 X」。
 *  无耗时的兜底文案对齐 ST/TauriTavern 原生「思考了一会」（2026-09-06 视觉验收）。 */
const ReasoningRow = memo(function ReasoningRow({ text, running, durationMs, turnTotalMs }: { text: string; running: boolean; durationMs?: number; turnTotalMs?: number }) {
  const summary = running
    ? '思考中…'
    : durationMs === undefined
      ? (turnTotalMs === undefined ? '思考了一会' : `任务耗时 ${formatDuration(turnTotalMs)}`)
      : (turnTotalMs === undefined ? `思考了 ${formatDuration(durationMs)}` : `思考了 ${formatDuration(durationMs)} · 任务耗时 ${formatDuration(turnTotalMs)}`)
  return (
    <details className="dsht-rp-reasoning" data-running={running || undefined}>
      <summary>{summary}</summary>
      <div className="rp-reasoning-body"><CompiledBody text={text} /></div>
    </details>
  )
})

/** 【ST 对齐 2026-09-07】折叠体内文的三段编译渲染——ST 的 reasoning/折叠体经
 *  messageFormatting（markdown + 浏览器 HTML 解析）渲染：成对已知标签（<font color>）
 *  出样式、未知标签（<interactive_input>）按浏览器语义解包隐藏标签名、游离 </font>
 *  被解析器丢弃。旧实现裸 {text} 让楼层折叠体里裸显「<thinking></font>」源码字样
 *  （真机实证）。markdown 段走 MarkdownText，行内 HTML 走 sanitize 白名单，完整文档
 *  转沙箱 iframe（thShim 关——折叠体内不需要 TH 数据面）。 */
const CompiledBody = memo(function CompiledBody({ text }: { text: string }) {
  const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
  const segs = useMemo(() => compileDisplaySegments(unwrapForeignTags(text)), [text])
  return (
    <>
      {segs.map((dseg, i) => {
        if (dseg.kind === 'markdown') {
          return dseg.text.trim() ? <MarkdownText key={i} text={dseg.text} labels={markdownLabels} /> : null
        }
        if (dseg.kind === 'html') {
          return <RpMessageFrame key={i} html={dseg.source} thShim={false} />
        }
        const clean = sanitizeDisplayHtml(dseg.source)
        return clean !== null
          ? <div key={i} className="dsht-rp-html" dangerouslySetInnerHTML={{ __html: clean }} />
          : <RpMessageFrame key={i} html={dseg.source} thShim={false} />
      })}
    </>
  )
})

/** T2.10 折叠块（collapsibleTags：<details><summary>标题</summary>内容 → 原生折叠组件） */
const CollapsibleBlock = memo(function CollapsibleBlock({ title, content }: { title: string; content: string }) {
  return (
    <details className="dsht-rp-collapsible">
      <summary><span className="cl-title">{title}</span></summary>
      <div className="cl-body"><CompiledBody text={content} /></div>
    </details>
  )
})

/**
 * MVU 裸 JSON 变量块（VariableInsert/VariableUpdate 两代标记）：默认折叠，
 * 标题「变量更新 · N 键」，展开看美化后的 JSON。不再裸文本外露（批次修复 1）。
 */
const VariableUpdateBlock = memo(function VariableUpdateBlock({ raw }: { raw: string }) {
  const parsed = useMemo(() => parseVariableJson(raw), [raw])
  return (
    <details className="dsht-rp-state-update dsht-rp-var-update" data-testid="dsht-rp-var-update">
      <summary>⚙ 变量更新{parsed !== null ? ` · ${parsed.keys} 键` : ''}</summary>
      <div className="su-body">
        <pre className="su-raw">{parsed !== null ? parsed.pretty : raw}</pre>
      </div>
    </details>
  )
})

/** T2.10 状态更新块（stateUpdateTags/MVU：Analysis 思维链 + JSONPatch diff 表） */
const StateUpdateBlock = memo(function StateUpdateBlock({ analysis, patches }: { analysis: string | null; patches: string | null }) {
  const patchRows = useMemo(() => (patches === null ? null : parseJsonPatches(patches)), [patches])
  return (
    <details className="dsht-rp-state-update" data-testid="dsht-rp-state-update">
      <summary>⚙ 状态更新</summary>
      <div className="su-body">
        {analysis !== null && (
          <details className="dsht-rp-reasoning">
            <summary>分析</summary>
            <div className="rp-reasoning-body">{analysis}</div>
          </details>
        )}
        {patchRows !== null && patchRows.length > 0 && (
          <table className="su-patch-table">
            <thead><tr><th>操作</th><th>路径</th><th>值</th></tr></thead>
            <tbody>
              {patchRows.map((p, i) => (
                <tr key={i}><td className="su-op">{p.op}</td><td className="su-path">{p.path}</td><td>{p.value ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {patchRows === null && patches !== null && <pre className="su-raw">{patches}</pre>}
      </div>
    </details>
  )
})

/** T2.10 伏笔登记册面板（foreshadowingTags：内部 details 逐条折叠） */
const ForeshadowingPanel = memo(function ForeshadowingPanel({ content }: { content: string }) {
  const items = useMemo(() => {
    // 内部结构：<details><summary>标题</summary>内容</details> 逐条
    const out: Array<{ title: string; content: string }> = []
    const re = /<details>([\s\S]*?)<\/details>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const sm = String(m[1]).match(/<summary>([\s\S]*?)<\/summary>/i)
      out.push({
        title: sm ? sm[1].trim() : '伏笔',
        content: sm ? String(m[1]).replace(sm[0], '').trim() : String(m[1]).trim(),
      })
    }
    return out
  }, [content])
  return (
    <details className="dsht-rp-foreshadowing" data-testid="dsht-rp-foreshadowing">
      <summary>🧭 伏笔登记册</summary>
      <div className="fs-body">
        {items.length > 0
          ? items.map((it, i) => (
            <details key={i} className="dsht-rp-collapsible"><summary><span className="cl-title">{it.title}</span></summary><div className="cl-body">{it.content}</div></details>
          ))
          : <div className="cl-body">{content}</div>}
      </div>
    </details>
  )
})

/** assistant-step shadowing 渲染器（T2.5a） */
export const RpAssistantNodeView = memo(function RpAssistantNodeView({
  node, cwd, renderMessageImages, inputActions, useSession, useChat, sessionId,
}: NodeViewProps) {
  const proto = useOutputProtocol(cwd)
  const slug = slugFromCwd(cwd)
  // 批次修复 5：display 时机正则（markdownOnly + placement 含 1/3）由渲染层消费
  const displayScripts = useDisplayRegexes(proto !== null ? slug : null, sessionId ?? '')
  // I4/B6/B8/C3：显示期管线数据（identity/variables/render-entries/EJS+TH 设置；
  // display-compiler.ts 模块级 5s TTL 缓存，仅首楼层真正发请求）
  const pipeline = useDisplayPipeline(proto !== null ? slug : null, sessionId ?? '')
  const data = node.data
  const streaming = data.status === 'running'
  const interrupted = data.status === 'interrupted'
  // 【hook 移植 L1a】TH 事件桥：message_received + stream_token_received
  // （streaming 期文本 diff 直投；ST STREAM_TOKEN_RECEIVED 载荷 = 累计文本）
  // message_received 语义 = "回复定稿"：mount 时已定稿的新鲜消息（重连/补页场景）投一次 +
  // running → 非 running 转换瞬间投一次（流式完成）。
  const receivedSeq = typeof data.finalNode?.seq === 'number' ? data.finalNode.seq : undefined
  useEffect(() => {
    if (sessionId === undefined || !isFreshMessage(data) || data.status === 'running') return
    dispatchThEvent(sessionId, 'message_received', { nodeKey: node.key, seq: receivedSeq })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const prevStreaming = useRef(streaming)
  useEffect(() => {
    if (prevStreaming.current && !streaming && sessionId !== undefined) {
      dispatchThEvent(sessionId, 'message_received', { nodeKey: node.key, seq: receivedSeq })
    }
    prevStreaming.current = streaming
  }, [streaming, sessionId, node.key, receivedSeq])
  const streamText = streaming
    ? (data.blocks ?? []).filter(b => b.kind === 'text').map(b => String((b as { text?: unknown }).text ?? '')).join('')
    : ''
  const lastStreamLen = useRef(0)
  useEffect(() => {
    if (!streaming || sessionId === undefined) return
    if (streamText.length <= lastStreamLen.current) return
    lastStreamLen.current = streamText.length
    dispatchThEvent(sessionId, 'stream_token_received', { args: [streamText] })
  })
  useEffect(() => { if (!streaming) lastStreamLen.current = 0 }, [streaming])
  // T1.14 窗口化：外壳自注册进共享协调器；流式中的消息恒渲染（forced，不占位）
  const sessionKey = sessionId ?? cwd ?? 'rp-chat'
  const { shellRef, windowed, placeholderHeight } = useMessageWindowing(sessionKey, node.key, streaming)

  // ---- 变体显示覆盖（T2.5c 配套）：DSH 转录按设计只认 append-origin 事件
  //（replace 是 model-only——compaction 语义），变体切换只改模型面。这里在
  // display 层把 append-origin 文本替换为组内 active 变体文本（§4.15 swipe
  // 的用户可见语义），不写任何事件、不污染 session log。----
  const nodeCount = useSession === undefined ? 0 : useSession((snapshot) => (snapshot as { chat?: { order?: readonly string[] } }).chat?.order?.length ?? 0)
  const groups = useVariantGroups(sessionId ?? '', nodeCount)
  // P0-3 depth 透传：消息深度 = 其后 assistant 消息数（0 = 最新），条目自身
  // minDepth/maxDepth 在 runDisplayScripts 中真实生效（此前写死 null 不过滤）
  const messageDepth = useSession === undefined ? null : useSession((snapshot) => {
    const mySeq = data.finalNode?.seq
    if (typeof mySeq !== 'number') return 0
    const chat = (snapshot as {
      chat?: { nodes?: { values: () => Iterable<LikeChatNode & { data?: { finalNode?: { seq?: number } } }> } }
    }).chat
    let newer = 0
    for (const n of chat?.nodes?.values() ?? []) {
      if (n.kind !== 'assistant-step') continue
      const s = n.data?.finalNode?.seq
      if (typeof s === 'number' && s > mySeq) newer += 1
    }
    return newer
  })
  const variantOverride = useMemo(() => {
    const seq = data.finalNode?.seq
    if (seq === undefined || streaming || groups.length === 0) return undefined
    const g = groupOf(groups, seq)
    if (g === undefined || g.members.length < 2) return undefined
    const active = g.members.find(m => m.seq === g.activeSeq)
    if (active === undefined || active.seq === seq) return undefined
    return active.text
  }, [data.finalNode?.seq, groups, streaming])
  // 思考折叠行耗时（2026-09-04）：本 step 耗时 + 本轮总耗时（任务结束后显示）
  const hideAfter = useRollbackMask(sessionId)
  const stepDurationMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, hideAfter).stepMs.get(node.key))
  const turnTotalMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, hideAfter).turnMs.get(node.key))
  // C3 depth_ignore_hidden：深度计算剔除被回退掩码隐藏的更新楼层（seq > hideAfter）
  const hiddenNewerCount = useSession === undefined ? 0 : useSession((snapshot) => {
    const mySeq = data.finalNode?.seq
    if (typeof mySeq !== 'number' || hideAfter <= 0) return 0
    const chat = (snapshot as {
      chat?: { nodes?: { values: () => Iterable<LikeChatNode & { data?: { finalNode?: { seq?: number } } }> } }
    }).chat
    let hidden = 0
    for (const n of chat?.nodes?.values() ?? []) {
      if (n.kind !== 'assistant-step') continue
      const s = n.data?.finalNode?.seq
      if (typeof s === 'number' && s > mySeq && s > hideAfter) hidden += 1
    }
    return hidden
  })

  // ---- I2 滚动锚定（增量贴底）：仅「新消息插入」（本楼层节点挂载）时触发——
  // 若滚动容器接近底部（阈值 120px），rAF 后 scrollTop = scrollHeight。
  // 不用 scrollIntoView（会破坏 0.1.2 原生 overflow-anchor 锚定）；旧楼层窗口化
  // 重挂载（depth > 0）与用户上滑浏览历史（距底 > 120px）都不抢滚动。----
  const bodyRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (messageDepth !== 0) return // 只处理最新楼层
    const shell = shellRef.current
    if (shell === null) return
    const container = findScrollAncestor(shell)
    if (container === null) return
    if (container.scrollTop + container.clientHeight < container.scrollHeight - 120) return
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight })
    // 流式内容增长由原生锚定接管，本 effect 只在节点挂载（新楼层插入）时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.key])

  const processed = useMemo(() => {
    /** 渲染单元：text（进 MarkdownText）/ html（白名单 sanitize 后直渲）/ frame（完整 HTML 文档进 iframe）/ statusbar / 协议块 / reasoning / image */
    type Unit =
      | { kind: 'text'; text: string }
      | { kind: 'html'; html: string }
      | { kind: 'frame'; html: string }
      | { kind: 'statusbar'; text: string }
      | { kind: 'protocol'; seg: ProtocolSegment }
      | { kind: 'reasoning'; text: string; durationMs?: number }
      | { kind: 'image'; images: unknown[] }
    const units: Unit[] = []
    const actions: Array<{ label: string; color?: string }> = []
    // ---- C3 TH 渲染组门（设置不可达 = 全开/不限，不因数据面降级）----
    const thRenderOn = pipeline.th === null ? true : pipeline.th.enabled
    // 【2026-09-06 裸露修复】三段编译是 ST「markdown html 渲染」的等价物——ST 是
    // 全楼层渲染的，TH 的 render.depth 只该管它自己的强化面。旧实现把三段编译整个
    // 挂在 depth 门下（TH 设置默认 depth=0 仅最新楼层）→ 用户翻历史楼层时 HTML/代码
    // 全部裸露（真机截图实证）。深度门只保留在 <pre> 增强（enhancePreBlocks）。
    // allow_streaming：关 = 流式期间不出 iframe 段（定稿后一次性渲染，TH 同语义）
    const streamingRenderOk = !streaming || (pipeline.th?.allowStreaming === true)
    const enhanced = thRenderOn && streamingRenderOk
    // ---- B8 素材：展开前后全文对比（确有变化才写回）----
    const rawTexts: string[] = []
    const expandedTexts: string[] = []
    let pureTextMessage = true // 含 reasoning/tool 等块的楼层不写回（replace 会丢思考历史）
    for (const block of data.blocks) {
      if (block.kind === 'reasoning') {
        const parsed = parseReasoningDuration(block.text ?? '')
        units.push({ kind: 'reasoning', text: parsed.text, ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}) })
        pureTextMessage = false
      } else if (block.kind === 'image') {
        units.push({ kind: 'image', images: [block.attachment] })
        pureTextMessage = false
      } else if (block.kind === 'text' && typeof block.text === 'string') {
        // 变体覆盖：整条变体文本替换 append-origin 文本（swipe 是整条回复的替代）
        let source = variantOverride !== undefined ? variantOverride : block.text
        if (proto === null) {
          // 非 RP 会话：纯官方行为（不过协议）
          if (source.trim()) units.push({ kind: 'text', text: source })
        } else {
          // P0-3：display 正则两趟执行 + 私用区 token 隔离 + 防空白守卫
          //（display-compiler.ts runDisplayScripts；depth 透传真实消息深度）
          if (displayScripts.length > 0) {
            const run = runDisplayScripts(displayScripts, source, messageDepth)
            for (const w of run.warnings) console.warn('[dsht-rp] display 正则：', w)
            source = run.text
          }
          // I4 显示期宏展开（markdown 编译前；ctx 未就绪/失败 = 原文透传）
          rawTexts.push(source)
          if (pipeline.ctx !== null) source = expandDisplayMacros(source, pipeline.ctx)
          expandedTexts.push(source)
          for (const seg of applyOutputProtocolSegments(source, proto, streaming)) {
            if (seg.kind === 'text') {
              for (const part of splitStatusbarBlocks(seg.content)) {
                if (part.type === 'text' && part.content.trim()) {
                  // C3：渲染关 / 深度超限 / 流式禁渲染 → 退纯文本（不切三段，整段 MarkdownText）
                  if (!enhanced) {
                    units.push({ kind: 'text', text: part.content })
                    continue
                  }
                  // P0-2 三段编译（display-compiler.ts compileDisplaySegments）：
                  // 完整 HTML 文档 → iframe（悬浮球 position:fixed 部件在 iframe 舞台运行）；
                  // 行首平衡 HTML 块 → sanitize 内联（sanitize 失败整块转 iframe，
                  // 替代旧的「sanitize 失败就纯文本」兜底）；其余 prose → MarkdownText。
                  for (const dseg of compileDisplaySegments(part.content)) {
                    if (dseg.kind === 'markdown') {
                      if (dseg.text.trim()) units.push({ kind: 'text', text: dseg.text })
                    } else if (dseg.kind === 'html') {
                      units.push({ kind: 'frame', html: dseg.source })
                    } else {
                      const clean = sanitizeDisplayHtml(dseg.source)
                      if (clean !== null) units.push({ kind: 'html', html: clean })
                      else units.push({ kind: 'frame', html: dseg.source })
                    }
                  }
                } else if (part.type === 'statusbar' && part.content.trim()) {
                  units.push({ kind: 'statusbar', text: part.content })
                }
              }
            } else if (seg.kind === 'action') {
              actions.push(seg.color !== undefined ? { label: seg.text, color: seg.color } : { label: seg.text })
            } else {
              units.push({ kind: 'protocol', seg })
            }
          }
        }
      } else {
        pureTextMessage = false
      }
      // tool-call 块由官方 ChatView 分组成工具行，这里跳过（与官方 AssistantMarkdown 同语义）
    }
    // ---- B6 [RENDER:BEFORE/AFTER] 包裹：编译输出首尾拼 render-entries HTML
    //（ejs renderLoader 启用 + TH 渲染开；sanitize 失败转 iframe，与正则块同兜底）----
    if (proto !== null && pipeline.ejs !== null && pipeline.ejs.enabled
      && pipeline.ejs.renderLoaderEnabled && thRenderOn) {
      if (pipeline.entries.before.trim() !== '') {
        const clean = sanitizeDisplayHtml(pipeline.entries.before)
        units.unshift(clean !== null ? { kind: 'html', html: clean } : { kind: 'frame', html: pipeline.entries.before })
      }
      if (pipeline.entries.after.trim() !== '') {
        const clean = sanitizeDisplayHtml(pipeline.entries.after)
        units.push(clean !== null ? { kind: 'html', html: clean } : { kind: 'frame', html: pipeline.entries.after })
      }
    }
    // ---- B8 客户端写回素材（settled + 纯文本楼 + 展开确有变化；调用在下方 effect）----
    // 【审查修复 2026-09-05】variantOverride 非 undefined = 正在回看历史变体——
    // 素材是变体文本，写回会把原楼层正文替换成另一 variant（数据损坏），必须跳过。
    const rawJoined = rawTexts.join('\n\n')
    const expandedJoined = expandedTexts.join('\n\n')
    const mySeq = data.finalNode?.seq
    const permanent = proto !== null && !streaming && pureTextMessage && sessionId !== undefined
      && variantOverride === undefined
      && pipeline.ejs !== null && pipeline.ejs.enabled && pipeline.ejs.permanentEvaluation
      && pipeline.ctx !== null && typeof mySeq === 'number' && expandedJoined !== rawJoined
      ? { sessionId, seq: mySeq, text: expandedJoined }
      : undefined
    return { actions, units, permanent }
  }, [data.blocks, proto, streaming, variantOverride, displayScripts, messageDepth, hiddenNewerCount, pipeline])

  // ---- B8 永久写回（渲染成功 = processed 无异常落地；reportPermanentRender 幂等去重）----
  useEffect(() => {
    const p = processed.permanent
    if (p !== undefined) reportPermanentRender(p.sessionId, p.seq, p.text)
  }, [processed.permanent])

  // ---- C3 <pre> 增强（collapse_code_block + optimize_hljs）：settled 楼层 DOM 一次过 ----
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null || streaming) return
    const th = pipeline.th
    if (th === null || th.enabled === false) return
    const depthOk = th.depth < 0 || ((messageDepth ?? 0) - hiddenNewerCount) <= th.depth
    if (!depthOk) return
    enhancePreBlocks(el, { collapse: th.collapseCodeBlock !== 'none', hljs: th.optimizeHljs })
    // processed 变化（流式重排/窗口化回渲）时 React 可能重建 pre 节点 → 重跑补齐（幂等）
    // 【鲁棒轮 2026-09-09】windowed 翻转会卸载/重挂 body div（deps 同引用不重跑 → 新 DOM
    // 永不增强），windowed 必须入 deps。
  }, [pipeline.th, streaming, processed, messageDepth, hiddenNewerCount, windowed])

  // ---- ST 台词着色（SillyTavern messageFormatting 的 <q> 包裹等价；settled 楼层 DOM 过一遍）----
  // MarkdownText（宿主 micromark 渲染器）把 raw HTML 当文本渲染 → 源码注入 <q> 会字面露出，
  // 故渲染后 DOM 包裹（st-quotes.ts 头注）。仅 settled（流式重建频繁，落定即上色）。
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null || streaming) return
    wrapStQuotes(el)
    // 【鲁棒轮 2026-09-09】windowed 入 deps：窗口化往返后 body div 重挂，新 DOM 需重新上色
  }, [streaming, processed, windowed])
  // 【2026-09-07 竞态根修】MarkdownText 异步填充（宿主组件内部 effect/懒解析）——
  // layout effect 跑时 body 可能还是空壳，deps 稳定后不再重跑 → 楼层永久无 <q>
  //（长聊天实测：61 对引号 0 包裹，手动复刻包裹则全部命中）。MutationObserver +
  // rAF 去抖兜底：内容落定后必然补裹；wrapStQuotes 幂等（已包裹区跳过），自触发
  // 的 DOM 变更下一轮无变更即自熄。
  useEffect(() => {
    const el = bodyRef.current
    if (el === null || streaming) return
    let scheduled = false
    const run = () => {
      scheduled = false
      const cur = bodyRef.current
      if (cur !== null) wrapStQuotes(cur)
    }
    const mo = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(run)
    })
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    wrapStQuotes(el)
    return () => { mo.disconnect(); if (scheduled) { scheduled = false } }
    // 【鲁棒轮 2026-09-09】windowed 入 deps：翻转重挂 body 后 observer 要挂到新节点
  }, [streaming, windowed])

  /** T2.5b：行动选项点击 → 原生 composer 提交通道（setDraft + submit，不自绘输入栏） */
  const sendAction = useCallback((text: string) => {
    inputActions?.setDraft(text)
    inputActions?.submit()
  }, [inputActions])

  const hasVisible = streaming || interrupted === true || processed.units.length > 0 || data.blocks.some(b => b.kind !== 'tool-call')
  // 逻辑回退掩码：本 step 的定稿消息 seq 已被回退/编辑/重新生成移出上下文 → 不渲染
  const mySeq = typeof data.finalNode?.seq === 'number' ? data.finalNode.seq : undefined
  const hiddenByRollback = hideAfter > 0 && mySeq !== undefined && mySeq > hideAfter
  if (!hasVisible || hiddenByRollback) return null
  // MarkdownText 的真实契约（host bundle ic 组件）：labels={{code:{copyLabel,copiedLabel}, footnotes}}
  // ——旧 codeLabels prop 宿主根本不读，labels=undefined 遇代码块必崩（slot entry crashed）
  const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
  // 耗时只挂最后一个 reasoning 单元（思考在最后一块结束时结束；多个思考块不重复显示）
  let lastReasoningIdx = -1
  for (let i = 0; i < processed.units.length; i++) {
    const k = processed.units[i].kind
    if (k === 'reasoning' || (k === 'protocol' && (processed.units[i] as { seg: { kind: string } }).seg.kind === 'reasoning')) lastReasoningIdx = i
  }

  return (
    <div
      ref={shellRef}
      className="dsht-rp-assistant"
      data-windowed={windowed || undefined}
      style={windowed ? { height: `${placeholderHeight}px` } : undefined}
    >
      {!windowed && (<>
      <RpFloorHeader useChat={useChat} nodeKey={node.key} side="assistant" sessionId={sessionId} slug={slug} timeMs={nodeTimeMs(node)} />
      <div className="dsht-rp-assistant-body" ref={bodyRef}>
        {processed.units.map((u, i) => {
          if (u.kind === 'text') {
            return <MarkdownText key={i} text={u.text} streaming={streaming && i === processed.units.length - 1} labels={markdownLabels} />
          }
          if (u.kind === 'html') {
            // display 正则/B6 包裹产出的白名单 HTML（已 sanitize；sanitize 失败的整块已转 iframe）
            return <div key={i} className="dsht-rp-html" dangerouslySetInnerHTML={{ __html: u.html }} />
          }
          if (u.kind === 'frame') {
            // 完整 HTML 文档段 / sanitize 失败的平衡 HTML 块 → 沙箱 iframe（悬浮球舞台）
            // C3 use_blob_url：TH Blob URL 渲染形态（沙箱不变，blob 加载失败可关回 srcdoc）
            // guest shim：卡内脚本需要 TH API（示例游戏状态栏 getAllVariables 等）时注入
            return <RpMessageFrame key={i} html={u.html} useBlobUrl={pipeline.th?.useBlobUrl === true} sessionId={sessionId} slug={slug} thShim={pipeline.th === null || pipeline.th.enabled === true} />
          }
          if (u.kind === 'statusbar') {
            return <StatusBarCard key={i} content={u.text} />
          }
          if (u.kind === 'reasoning') {
            const last = i === lastReasoningIdx
            // 消息自带思考耗时（ST 迁移）优先；缺失时退回 step 事件计时（live 轮）
            const ms = u.durationMs ?? (last ? stepDurationMs : undefined)
            const total = last ? turnTotalMs : undefined
            return <ReasoningRow key={i} text={u.text} running={streaming} {...(ms !== undefined || total !== undefined ? { durationMs: ms, ...(total !== undefined ? { turnTotalMs: total } : {}) } : {})} />
          }
          if (u.kind === 'protocol') {
            const seg = u.seg
            if (seg.kind === 'status') return <StatusBarCard key={i} content={seg.content} />
            if (seg.kind === 'collapsible') return <CollapsibleBlock key={i} title={seg.title} content={seg.content} />
            if (seg.kind === 'state-update') return <StateUpdateBlock key={i} analysis={seg.analysis} patches={seg.patches} />
            if (seg.kind === 'foreshadowing') return <ForeshadowingPanel key={i} content={seg.content} />
            if (seg.kind === 'reasoning') {
              const last = i === lastReasoningIdx
              return <ReasoningRow key={i} text={seg.content} running={false} {...(last ? { durationMs: stepDurationMs, turnTotalMs } : {})} />
            }
            if (seg.kind === 'statusbar-placeholder') return <MvuStatusbar key={i} sessionId={sessionId} />
            return null
          }
          return (
            <Fragment key={i}>
              {renderMessageImages({ images: (u.images ?? []) as ReadonlyArray<{ attachment: unknown }>, align: 'start' })}
            </Fragment>
          )
        })}
        {interrupted && <span className="dsht-rp-stopped">已停止</span>}
      </div>
      {processed.actions.length > 0 && (
        <div className="dsht-rp-actions" data-testid="dsht-rp-actions">
          {processed.actions.map((a, i) => (
            <button key={i} type="button" className="dsht-rp-action-btn" disabled={streaming}
              onClick={() => { sendAction(a.label) }}>
              <span className="tag">▸</span>
              <span style={a.color !== undefined ? { color: a.color } : undefined}>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      </>)}
    </div>
  )
})

// ---------------------------------------------------------------------------
// 变体组（T2.5c）：共享缓存 + 订阅（变体条与 assistant-step 显示覆盖共用）
// ---------------------------------------------------------------------------

/** sessionId → 变体组清单（/dsht-rp/variant/groups；切换/新消息后刷新）。
 * 缓存归一化后的组（normalizeVariantGroups：按文本去重，计数恒定 1..N）——
 * 后端每次切换都 append 新 replace 事件并入组，不归一则左右滑数字不断叠加。 */
const groupsCache = new Map<string, VariantGroupInfo[]>()
const groupsListeners = new Map<string, Set<() => void>>()

async function fetchVariantGroups(sessionId: string): Promise<VariantGroupInfo[] | null> {
  try {
    const r = await rpApi<{ groups: RawVariantGroup[] }>('variant/groups', { sessionId })
    return normalizeVariantGroups(r.groups ?? [])
  } catch {
    return null // 【鲁棒轮 2026-09-09】失败不写缓存——写 [] 会让 cache-miss 守卫永远跳过重试
  }
}

async function refreshVariantGroups(sessionId: string): Promise<void> {
  const next = await fetchVariantGroups(sessionId)
  if (next !== null) groupsCache.set(sessionId, next)
  for (const fn of groupsListeners.get(sessionId) ?? []) fn()
}

/**
 * 变体组订阅 hook：挂载取缓存（无则拉取）、监听切换事件刷新。
 * nodeCount 由调用方传入（useSession 的选择器读 chat.order 长度——重 roll 入组
 * 会增节点；replace 事件不增节点，靠切换通知刷新）。
 * 【鲁棒轮 2026-09-09】nodeCount 增长时无条件刷新（原 cache-miss 守卫让它成为死代码：
 * 重新生成/新消息入列后新 seq 不在任何组里 → 变体条 ‹n/m› 永不出现，直到手动切换）。
 */
function useVariantGroups(sessionId: string, nodeCount: number): VariantGroupInfo[] {
  const [version, setVersion] = useState(0)
  const prevCountRef = useRef(-1)
  useEffect(() => {
    const bump = (): void => { setVersion(v => v + 1) }
    const listeners = groupsListeners.get(sessionId) ?? new Set()
    listeners.add(bump)
    groupsListeners.set(sessionId, listeners)
    const grew = nodeCount > prevCountRef.current && prevCountRef.current >= 0
    prevCountRef.current = nodeCount
    if (!groupsCache.has(sessionId) || grew) void refreshVariantGroups(sessionId)
    return () => { listeners.delete(bump) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, nodeCount])
  void version
  return groupsCache.get(sessionId) ?? EMPTY_GROUPS
}

const EMPTY_GROUPS: VariantGroupInfo[] = []

// ---------------------------------------------------------------------------
// 变体条（T2.5c）：conversation.chat.assistant-actions 席位
// ---------------------------------------------------------------------------

/** Chat 快照里 assistant 节点的轻量投影：messageId → seq（入参 = useChat 的 Chat 本体快照） */
function seqOfMessage(chat: { nodes?: { values: () => Iterable<{ data?: { finalNode?: { messageId?: string; seq?: number } } }> } } | undefined, messageId: string): number | undefined {
  if (!chat?.nodes) return undefined
  for (const n of chat.nodes.values()) {
    const f = n.data?.finalNode
    if (f?.messageId === messageId && typeof f.seq === 'number') return f.seq
  }
  return undefined
}

/** 变体条 ‹ n/m ›（渲染进原生 IconActions 行，位于 copy 与 branch 之间） */
export function RpVariantActions({ messageId, useChat, sessionId }: VariantActionProps): JSX.Element | null {
  const seq = useChat((snapshot) => seqOfMessage(snapshot as { nodes?: { values: () => Iterable<{ data?: { finalNode?: { messageId?: string; seq?: number } } }> } }, messageId))
  const nodeCount = useChat((snapshot) => (snapshot as { order?: readonly string[] }).order?.length ?? 0)
  const groups = useVariantGroups(sessionId, nodeCount)
  const [switching, setSwitching] = useState(false)

  const group = seq === undefined ? undefined : groupOf(groups, seq)
  const idx = group ? group.members.findIndex(m => m.seq === group.activeSeq) : -1

  const switchTo = useCallback(async (targetSeq: number) => {
    if (switching) return
    setSwitching(true)
    try {
      await rpApi('variant/switch', { sessionId, targetSeq })
      // 【实机审计修复 2026-09-05】message_swiped：变体（swipe）切换成功 → TH 事件桥
      //（RpScriptHost 的 SessionRuntime 监听同源 CustomEvent 后按 messageId 解析楼层投递）
      window.dispatchEvent(new CustomEvent('dsht-rp-ui:th-host-event', {
        detail: { sessionId, eventType: 'message_swiped', messageId },
      }))
      // 刷新共享缓存并通知全部订阅者（变体条计数 + assistant-step 显示覆盖）
      await refreshVariantGroups(sessionId)
    } catch { /* 切换失败保持现状；数据面不可达时条形静默 */ }
    finally { setSwitching(false) }
  }, [sessionId, switching, messageId])

  if (group === undefined || group.members.length < 2 || idx < 0) return null
  const atLeft = idx === 0
  const atRight = idx === group.members.length - 1
  return (
    <span className="dsht-rp-variant-bar" data-testid="dsht-rp-variant-bar" title="历史变体（重 roll / swipe）">
      <button type="button" className="vb-arrow" aria-label="上一个变体" disabled={atLeft || switching}
        onClick={() => { void switchTo(group.members[idx - 1].seq) }}>‹</button>
      <span className="vb-count">{idx + 1}/{group.members.length}</span>
      <button type="button" className="vb-arrow" aria-label="下一个变体" disabled={atRight || switching}
        onClick={() => { void switchTo(group.members[idx + 1].seq) }}>›</button>
    </span>
  )
}

/** TH 事件桥统一入口（message_sent/received/deleted/stream_token_received；
 *  RpScriptHost 的 SessionRuntime 监听同名 CustomEvent 后按 nodeKey 解析楼层投递。
 *  【hook 移植 L1a 2026-09-06】args 存在 = 直投（流式 token 等无楼层锚的事件） */
const dispatchThEvent = (sessionId: string, eventType: string, opts: { nodeKey?: string; messageId?: string; seq?: number; args?: unknown[] } = {}): void => {
  window.dispatchEvent(new CustomEvent('dsht-rp-ui:th-host-event', {
    detail: { sessionId, eventType, nodeKey: opts.nodeKey, messageId: opts.messageId, seq: opts.seq, args: opts.args },
  }))
}

/** 新鲜度门（15s）：开聊重放的历史楼层不投递 message_sent/received（ST 同语义） */
const isFreshMessage = (data: unknown): boolean => {
  const t = (data as { time?: unknown })?.time
  return typeof t !== 'number' || Date.now() - t < 15000
}

// ---------------------------------------------------------------------------
// 批次修复 6：「↻ 重新生成」按钮（conversation.chat.assistant-actions 席位，
// 与变体条共存）。与「↩ 回退到此处」的区别：回退 = 回到某条用户输入（连同其后
// 一切移除）；重新生成 = 只重来最后一轮（截断最后 assistant turn 并重发最后一条
// 用户输入，queue 模式）。仅 RP 工作区会话的最后一条 assistant 消息显示。
// ---------------------------------------------------------------------------

/** sessionId → 是否 RP 工作区会话（session.list 的 cwd 判定；invalidateWsCache 时失效） */
let rpSessionCache: Promise<Map<string, boolean>> | null = null

function fetchRpSessionMap(): Promise<Map<string, boolean>> {
  if (rpSessionCache === null) {
    // rc.7 wire 契约：session/list 的 args 必须带 _request（空对象）——漏了会 gateway/arguments-invalid
    // 静默 catch 成空 Map → isRp 恒 false → 重新生成按钮永不显示（实机抓到）
    rpSessionCache = dshRpc<{ items?: Array<{ sessionId: string; cwd?: string }> }>('session.list', { _request: {} })
      .then(r => new Map((r.items ?? []).map(it => [it.sessionId, slugFromCwd(it.cwd) !== null])))
      .catch(() => new Map<string, boolean>())
  }
  return rpSessionCache
}

/** 重新生成按钮的 inject 面（apply 闭包注入：截断 + 重发的数据通道） */
export interface RegenerateInject {
  /** POST rp/session-regenerate → sessions.refresh → session.prompt 重发 lastUserText（queue） */
  regenerate?: (sessionId: string) => Promise<void>
}

export const RpRegenerateAction = memo(function RpRegenerateAction({
  messageId, useSession, useChat, sessionId, regenerate,
}: VariantActionProps & RegenerateInject) {
  const [busy, setBusy] = useState(false)
  const [isRp, setIsRp] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchRpSessionMap().then(m => { if (alive) setIsRp(m.get(sessionId) === true) })
    return () => { alive = false }
  }, [sessionId])
  // 仅最后一条 assistant 消息显示（重新生成语义 = 只重来最后一轮）
  // useChat：本席位 useSession 快照不带 chat 投影（实机实证），Chat 本体快照 nodes/order 顶层
  const isLastAssistant = useChat((snapshot) => {
    const chat = snapshot as {
      nodes?: { values: () => Iterable<LikeChatNode & { data?: { finalNode?: { messageId?: string; seq?: number } } }> }
    }
    let lastSeq = -1
    let lastId: string | undefined
    for (const n of chat?.nodes?.values() ?? []) {
      if (n.kind !== 'assistant-step') continue
      const f = n.data?.finalNode
      if (typeof f?.seq === 'number' && f.seq > lastSeq) { lastSeq = f.seq; lastId = f.messageId }
    }
    return lastId !== undefined && lastId === messageId
  })
  const running = useSession((snapshot) => (snapshot as { running?: boolean }).running === true)

  const onClick = useCallback(async () => {
    if (busy || regenerate === undefined) return
    if (!window.confirm('重新生成最后一条回复？（当前回复会被移除）')) return
    setBusy(true)
    try {
      await regenerate(sessionId)
      // TH 事件桥：重新生成 = 旧回复移除语义 → message_deleted（ST MESSAGE_DELETED 对应）
      dispatchThEvent(sessionId, 'message_deleted')
    } catch (e) {
      window.alert(`重新生成失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [busy, regenerate, sessionId])

  if (!isRp || !isLastAssistant || running || regenerate === undefined) return null
  return (
    <button type="button" className="dsht-rp-regen-btn" data-testid="dsht-rp-regenerate"
      title="重新生成最后一条回复（只重来最后一轮；「回退到此处」才会连同之后一切移除）"
      disabled={busy} onClick={() => { void onClick() }}>
      {busy ? '生成中…' : '↻ 重新生成'}
    </button>
  )
})

// ---------------------------------------------------------------------------
// 批次修复 4：user 节点 shadowing（keyed 'user'，priority -1）——RP 会话的用户
// 气泡下加「↩ 回退到此处」。ui-conversation 没有 user-actions 槽位（只有
// assistant-actions），故沿用 assistant-step 同款 shadowing 方案；拔插件即复位
// 官方 UserMessageNodeView。非 RP 会话退化为等价的最小纯文本气泡。
// ---------------------------------------------------------------------------

interface LikeUserChatData {
  /** 消息事件的 seq（回退锚点：keepThroughSeq） */
  seq?: number
  content?: readonly unknown[]
}

interface UserNodeViewProps {
  node: { data: LikeUserChatData } & LikeChatNode
  cwd?: string | undefined
  renderMessageImages: (owner: { images: ReadonlyArray<{ attachment: unknown }>; align: 'start' | 'end' }) => ReactNode
  sessionId?: string | undefined
  /** 原生 composer 提交通道（assistant 席位同款；回退后原文回输入框用） */
  inputActions?: { setDraft: (text: string) => void; submit: () => void } | undefined
  /** 标准件（session 域席位）：会话快照选择器 */
  useSession?: (<T>(selector: (snapshot: unknown) => T) => T) | undefined
  /** Chat 本体快照选择器（楼层头数据源；owner props 直供） */
  useChat?: (<T>(selector: (snapshot: unknown) => T) => T) | undefined
}

/** user 气泡的「↩ 回退到此处」+「✎ 编辑」（**所有会话**——适配 agent/普通会话同样
 *  可回退；2026-09-04 真机反馈：原先仅 RP 工作区会话显示，用户在适配会话里找不到）。
 *  回退 = 逻辑回退到这条消息（/rp/session-rollback；【2026-09-08 用户语义】includeAnchor
 *  = 连锚消息一起移出上下文，原文放回 composer 输入框——ST「回退」同语义，用户可改后
 *  重发）；编辑 = 截断到这条消息**之前** 并以新文本重新发送（/rp/session-edit +
 *  session.prompt，「编辑并重发」语义）。 */
export const RpUserNodeView = memo(function RpUserNodeView({
  node, cwd, renderMessageImages, inputActions, sessionId, useSession, useChat,
}: UserNodeViewProps) {
  const data = node.data
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const seq = typeof data.seq === 'number' ? data.seq : undefined
  // 【2026-09-08 鲁棒性】running 守卫（重新生成按钮同款）：turn 运行中回退/编辑会与
  // 生成期 append 互踩（live replace 的 claim/mark 窗口被生成 append 插入——数据面已把
  // undo 回放挪出该窗口，这里再禁掉入口），按钮置灰防误触。
  const running = useSession === undefined ? false : useSession((snapshot) => (snapshot as { running?: boolean }).running === true)
  // 【hook 移植 L1a】TH 事件桥：message_sent（mount 新鲜度门——开聊重放历史不投递）
  useEffect(() => {
    if (sessionId === undefined || sessionId === null || !isFreshMessage(data)) return
    dispatchThEvent(sessionId, 'message_sent', { nodeKey: node.key, seq: typeof data.seq === 'number' ? data.seq : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // T1.14 窗口化：user 消息外壳同样自注册（静态内容，无 forced 场景）
  const sessionKey = sessionId ?? cwd ?? 'rp-chat'
  const { shellRef, windowed, placeholderHeight } = useMessageWindowing(sessionKey, node.key, false)

  const parts = useMemo(() => {
    const texts: string[] = []
    const images: Array<{ attachment: unknown }> = []
    for (const b of data.content ?? []) {
      const block = b as { type?: string; text?: string; attachment?: unknown }
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && block.attachment !== undefined) images.push({ attachment: block.attachment })
    }
    return { text: texts.join(''), images }
  }, [data.content])

  const rollback = useCallback(async () => {
    if (busy || running || seq === undefined || !sessionId) return
    if (!window.confirm('回退到这条消息？该消息与其后的对话将从上下文移除，原文放回输入框（事件仍保留在日志；状态/变量一并回滚）。')) return
    setBusy(true)
    try {
      // POST /dsht-rp/rp/session-rollback：live → 官方 replace 原语逻辑回退（投影
      // 立即生效，无需刷新）；非 live → 文件截断 + .bak（需要整页重载重建投影）
      // 【2026-09-08 用户语义】includeAnchor: true = 锚消息一起移除 + 文本回输入框
      const r = await rpApi<{ logical?: boolean }>('rp/session-rollback', { sessionId, keepThroughSeq: seq, includeAnchor: true })
      // TH 事件桥：回退 = 其后楼层移除语义 → message_deleted（ST MESSAGE_DELETED 对应）
      dispatchThEvent(sessionId, 'message_deleted')
      // 【2026-09-08 用户语义】原文放回 composer 输入框（ST 回退同款；inputActions 缺席
      // 的挂载形态静默跳过——回退本身已完成）
      inputActions?.setDraft(parts.text)
      if (r.logical === true) {
        // 【⑨修复 2026-09-05】live 回退后不整页重载——原生 composer 草稿不持久化，
        // reload 即清空。改为 live 同款逻辑回退（掩码更新 + 会话重开）
        void refreshRollbackMask(sessionId) // 掩码更新 → 隐藏被回退消息 + 楼层号重排
        setBusy(false)
      } else {
        // 非 live：文件截断 + .bak。【①轮核查 2026-09-06】此分支在聊天视图里实际不可达
        // （会话正被查看 = 在宿主 sessions 登记表里 = 必走 live 逻辑回退）；仅防御脚本化
        // API 调用场景。rc.7 web wire 无 session.close/open 方法（只有 ACP 有）——
        // 之前这里的 close/open 调用是被 catch 吞掉的恒失败 no-op，移除，避免误读。
        void refreshRollbackMask(sessionId)
        setBusy(false)
      }
    } catch (e) {
      window.alert(`回退失败：${(e as Error).message}`)
      setBusy(false)
    }
  }, [busy, running, seq, sessionId, inputActions, parts.text])

  const saveEdit = useCallback(async () => {
    if (busy || running || seq === undefined || !sessionId) return
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      // POST /dsht-rp/rp/session-edit：live → replace 该消息起视图 + prompt 重发
      //（新消息经事件流自动进入视图）；非 live → 文件截断后重发 + 重载
      const r = await rpApi<{ logical?: boolean }>('rp/session-edit', { sessionId, seq, text })
      if (r.logical === true) {
        // 【实机审计修复 2026-09-05】message_edited：会话编辑成功（live replace 生效）→ TH
        // 事件桥（RpScriptHost 按 nodeKey 解析楼层投递；非 live 分支整页重载后无需投递）
        window.dispatchEvent(new CustomEvent('dsht-rp-ui:th-host-event', {
          detail: { sessionId, eventType: 'message_edited', nodeKey: node.key },
        }))
        await dshRpc('session.prompt', {
          request: {
            requestId: crypto.randomUUID(),
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        })
        void refreshRollbackMask(sessionId) // 掩码更新 → 隐藏旧消息
        setBusy(false)
        setEditing(false)
      } else {
        // 【⑨修复 2026-09-05】非 live 编辑后不整页重载——原生 composer 草稿不持久化，
        // reload 即清空。改为会话重开（不整页重载，保留 composer 草稿）
        try {
          await dshRpc('session.prompt', {
            request: {
              requestId: crypto.randomUUID(),
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text }],
              clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          })
        } catch { /* 重发失败也重开：用户看得到截断结果再手动重试 */ }
        // 【①轮核查 2026-09-06】同 rollback 分支：rc.7 web wire 无 session.close/open，
        // 原调用恒失败被 catch 吞掉；且本分支在聊天视图里不可达（viewing = live）。移除。
        void refreshRollbackMask(sessionId)
        setBusy(false)
        setEditing(false)
      }
    } catch (e) {
      window.alert(`编辑失败：${(e as Error).message}`)
      setBusy(false)
    }
  }, [busy, running, draft, seq, sessionId, node.key])

  // 逻辑回退掩码：本消息 seq 已被编辑/回退移出上下文 → 不渲染（编辑重发的新消息
  // seq 更大，正常显示）
  const maskHide = useRollbackMask(sessionId)
  const hiddenByRollback = maskHide > 0 && typeof data.seq === 'number' && data.seq > maskHide
  if (hiddenByRollback) return null

  return (
    <div
      ref={shellRef}
      className="dsht-rp-user-row"
      data-windowed={windowed || undefined}
      style={windowed ? { height: `${placeholderHeight}px` } : undefined}
    >
      {!windowed && (<>
      <RpFloorHeader useChat={useChat} nodeKey={node.key} side="user" sessionId={sessionId} slug={null} timeMs={nodeTimeMs(node)} />
      <div className="dsht-rp-user-stack">
        {parts.images.length > 0 && renderMessageImages({ images: parts.images, align: 'end' })}
        {parts.text !== '' && !editing && <div className="dsht-rp-user-bubble">{parts.text}</div>}
        {editing && (
          <div className="dsht-rp-edit-box">
            <textarea
              className="dsht-rp-edit-area"
              value={draft}
              rows={Math.min(12, Math.max(2, draft.split('\n').length))}
              autoFocus
              onChange={(e) => { setDraft(e.target.value) }}
            />
            <div className="dsht-rp-edit-actions">
              <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit-cancel" disabled={busy}
                onClick={() => { setEditing(false) }}>取消</button>
              <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit-save" disabled={busy || !draft.trim()}
                title="就地截断到这条消息之前，并以编辑后的文本重新发送（不开新分支；状态/变量一并回滚）"
                onClick={() => { void saveEdit() }}>{busy ? '处理中…' : '保存并重发'}</button>
            </div>
          </div>
        )}
      </div>
      {seq !== undefined && sessionId !== undefined && !editing && (
        <>
          {busy && <span className="dsht-rp-note">回退完成，正在刷新会话…</span>}
          <div className="dsht-rp-user-actions">
            <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-rollback" disabled={busy || running}
              title={running ? '生成运行中，等待本轮结束再回退' : '回退到这条消息（该消息与其后的对话移出上下文，原文放回输入框供修改重发）'}
              onClick={() => { void rollback() }}>
              {busy ? '回退中…' : '↩ 回退到此处'}
            </button>
            <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit" disabled={busy || running}
              title={running ? '生成运行中，等待本轮结束再编辑' : '编辑这条已发送的消息（就地截断后以新文本重新发送）'}
              onClick={() => { setDraft(parts.text); setEditing(true) }}>
              ✎ 编辑
            </button>
          </div>
        </>
      )}
      </>)}
    </div>
  )
})
