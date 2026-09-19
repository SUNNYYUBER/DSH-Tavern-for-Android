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
import { dshRpc, humanizeError, isServiceUnavailable, rpApi, type RpWorkspaceInfo } from './rpc.ts'
import { showDomToast, showDomConfirm } from './toast.ts'
import { clientTimeZoneFields } from './time-zone.ts'
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
  compileDisplaySegments, enhancePreBlocks, expandDisplayMacros, frameFallbackText, invalidateDisplayDataCache,
  loadDisplayRenderCtx,
  loadEjsDisplaySettings, loadRenderEntries, loadThRenderSettings, reportPermanentRender,
  runDisplayScripts, shouldRenderFrame, unwrapForeignTags, type DisplayMacroCtx, type EjsDisplaySettings,
  type RenderEntries, type ThRenderSettings,
} from './display-compiler.ts'
import type { RegexScript } from '../../../regex/engine.ts'
import { attachMessageFrame, fetchFrameVars, getRpContextSnapshot, releaseMessageFrame, reserveMessageFrame, SHIM_VERSION } from './RpScriptHost.tsx'
import { buildMessageFrameDocument, buildShimSource, getVendorBlobUrl } from './th-shim.ts'
import { groupOf, normalizeVariantGroups, type RawVariantGroup, type VariantGroupInfo } from './variant-groups.ts'
import { wrapStQuotes } from './st-quotes.ts'
// 【E2/P-1 W4 收口】官方投影（session/chat/node 三层）读取一律走单源。
// 此前本文件是**裸读最密集**处：`data.blocks`（渲染热路径，官方改形状即抛 ⇒ 被
// SlotErrorBoundary 吞成整片楼层消失）、`data.finalNode.seq`（11 处，回退/变体/耗时
// 全部判据的锚点）、`chat.nodes.values()`（5 处双形态断言）。见 host-projection.ts 头注。
import {
  readBlocks, readChat, readFinalMessageId, readFinalSeq, readFinalTiming, readNodeAnchorSeq, readNodeData,
  readNodeKey, readNodeKind, readNodeSeq, readNodeStatus, readNodeTime, readNodeTurn,
  readSessionChat, readSessionRunning, readSourceKind, forEachChatNode,
} from './host-projection.ts'

// ---------------------------------------------------------------------------
// 类型（最小面：runtime 类型仅 type-only import，构建期擦除）
// ---------------------------------------------------------------------------

/**
 * keyed Chat 节点（**诚实形状**：只声明官方承诺过、且我们已实测的稳定字段）。
 *
 * 【W4 关键改动】此前这里写的是 `data: LikeAssistantChatData`，其中
 * `status`/`blocks`/`finalNode` 都是**非可选**字段 —— 那是把 beta 期官方投影
 * 当成定型契约（P-2）。后果不是编译错，而是**诱导**：类型说 `data.blocks` 一定存在，
 * 后来者就会直接写 `for (const b of node.data.blocks)`（本文件原有 2 处正是这么来的）。
 * 现在 `data` 声明为 `unknown`，**逼**每次读取都走 `host-projection.ts` 的读取器。
 */
interface LikeChatNode {
  key: string
  kind: string
  data: unknown
}

/** conversation.chat.node 席位组件收到的 props（owner + keyed node + 标准件） */
interface NodeViewProps {
  node: LikeChatNode
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
      // 【2026-09-13 修复·失败被永久缓存（D-1）】原 catch 直接 `return []`（且不清 wsCache）
      // ⇒ 一次瞬时失败被缓存成"空清单"，之后**永不重试**：输出协议静默退化为默认值
      // （display 正则/楼层渲染全走兜底），且没有任何提示。改为不写缓存 + 留痕。
      .catch(e => {
        console.warn('[dsht-rp-ui] rp/workspaces 拉取失败（输出协议将退化为默认；下次读取会重试）:', (e as Error)?.message)
        wsCache = null
        return [] as RpWorkspaceInfo[]
      })
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
      // 【2026-09-13 修复·失败被永久缓存（D-6）】同 D-1：原 catch 返回 []，缓存里留下
      // 「零 display 正则」的假结果 ⇒ 直到下一次 invalidateWsCache 才可能恢复（切思维链
      // 开关画面没反应的同族静默失败）。改为删缓存 + 留痕，下次调用重试。
      .catch(e => {
        console.warn('[dsht-rp-ui] regex/list 拉取失败（本轮 display 正则按空处理；下次读取会重试）:', (e as Error)?.message)
        displayRegexCache.delete(key)
        return [] as RegexScript[]
      })
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

// 【W4 删除】原 `LikeChatSnapshot`（会话快照里 chat 的形状断言）与
// `hideAfterOf`（恒 0 的死代码）已移除。理由：官方投影形状**不该由本文件钉死**，
// 读法一律走 `host-projection.ts` 的存在性 + 类型判定；把形状写成 interface
// 再用 `as` 断言读，正是「断言掩盖形状漂移」的形态（P-2）。

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

// 【已废弃 · 勿复活】曾有两个从会话投影读回退掩码的实现（`hideAfterOf` 与
// `LikeChatSnapshot` 形状断言），W4 一并删除。它们必然失效的两个原因：
//   ① 客户端投影**不透传** marker 的 `source` 字段（真机实证）→ 恒 undefined；
//   ② 0.1.5 起写侧已把标记载荷搬进官方白名单形态
//      `form:'snapshot' + sections[{name:'dsht:surgical', text: JSON.stringify(payload)}]`
//      （见 dsh-plugin/index.ts 的 markerSource），顶层扩展键不再存在。
// **权威来源 = host 路由 `/rp/rollback-mask`**（`useRollbackMaskState` 拉取后由调用方
// 显式传给 `floorIndexOf` / `floorIndexFromChat`）。

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
/** 掩码按 (snapshot, mask) 组合缓存——同一快照在掩码变化（回退操作后）时重算 */
const floorIndexCacheKey = new WeakMap<object, MaskState>()
/** 【2026-09-06 实证修复】核心按 Chat 本体计算（nodes/order 顶层）——SessionSnapshot
 *  不带 chat 投影（fiber 实证），旧实现把 useSession 快照当有 chat 用 → 楼层号恒缺席
 * （真机 hashFloors=[] 实证）。chat.node 席位组件同时拿得到 useChat（Chat 本体快照）。 */
function floorIndexOfChat(chatSnapshot: unknown, mask: MaskState): Omit<FloorIndex, 'hideAfter'> {
  const floors = new Map<string, number>()
  const stepMs = new Map<string, number>()
  const turnMs = new Map<string, number>()
  const { order, nodes } = readChat(chatSnapshot)
  if (nodes !== null && order.length > 0) {
    // 【W4】节点一律按**原始节点**存入（读字段走单源读取器），不再逐点复制 `n.data`。
    const byKey = new Map<string, unknown>()
    forEachChatNode(chatSnapshot, (n) => {
      const key = readNodeKey(n)
      if (key !== '') byKey.set(key, n)
    })
    // 顺序扫一遍：分楼 + 收集 turn 的 step 起止（供耗时计算）。
    // 逻辑回退掩码（【2026-09-14】集合语义）：被 replace 移出上下文的 seq 逐条精确隐藏，
    // UI 楼层号与耗时表同步跳过（视觉 = 真回退，数据零丢失）。
    // 集合之外的消息（含回退之后新发的）一律正常显示——这正是旧阈值语义做不到的。
    let floor = 1
    let lastTurn: number | null = null
    const turnSteps = new Map<number, Array<{ key: string; start: number; end: number | null }>>()
    for (const key of order) {
      const n = byKey.get(key)
      if (n === undefined) continue
      const data = readNodeData(n)
      if (readNodeKind(n) === 'assistant-step') {
        const mySeq = readFinalSeq(data)
        if (isSeqHidden(mask, mySeq)) continue
        const turn = readNodeTurn(data) ?? null
        if (turn === null || turn !== lastTurn) {
          floor += 1
          lastTurn = turn
        }
        floors.set(key, floor)
        const at = readNodeTime(data)
        if (turn !== null && at !== undefined) {
          const timing = readFinalTiming(data)
          const end = timing !== null && timing.completedTime !== null ? timing.completedTime : null
          const start = timing !== null && timing.stepStartTime !== null ? timing.stepStartTime : at
          const list = turnSteps.get(turn)
          if (list !== undefined) list.push({ key, start, end })
          else turnSteps.set(turn, [{ key, start, end }])
        }
      } else if (readNodeKind(n) === 'user') {
        if (readSourceKind(data) !== 'user') continue
        if (isSeqHidden(mask, readNodeSeq(data))) continue
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
function floorIndexOf(snapshot: unknown, mask: MaskState = EMPTY_MASK): FloorIndex {
  const snap = snapshot as object
  const cached = floorIndexCache.get(snap)
  const cachedMask = floorIndexCacheKey.get(snap)
  if (cached !== undefined && cachedMask === mask) return cached
  const core = floorIndexOfChat(readSessionChat(snapshot), mask)
  const index: FloorIndex = { ...core, hideAfter: mask.hideAfter }
  floorIndexCache.set(snap, index)
  // 【鲁棒轮 2026-09-09】漏写 cacheKey → rollbackMask 异步到达后的重算恒 miss
  // （O(N²) 每帧重算 + mask 回退时陈旧命中），与 floorIndexFromChat 对齐。
  floorIndexCacheKey.set(snap, mask)
  return index
}

/** Chat 本体快照 → 楼层索引（useChat 选择器；WeakMap 按代际缓存） */
function floorIndexFromChat(chat: unknown, mask: MaskState): Omit<FloorIndex, 'hideAfter'> {
  const snap = (chat ?? {}) as object
  const cached = floorIndexCache.get(snap)
  const cachedMask = floorIndexCacheKey.get(snap)
  if (cached !== undefined && cachedMask === mask) return cached
  const core = floorIndexOfChat(chat, mask)
  const index: FloorIndex = { ...core, hideAfter: mask.hideAfter }
  floorIndexCache.set(snap, index)
  floorIndexCacheKey.set(snap, mask)
  return index
}

/** 兼容旧调用点：楼层表（floorIndexOf().floors） */
function floorMapOf(snapshot: unknown): Map<string, number> {
  return floorIndexOf(snapshot).floors
}

// ---------------------------------------------------------------------------
// 逻辑回退掩码 store（sessionId → 被移出 seq 集合）：host 从 session.jsonl 解析回退/
// 编辑/重新生成 marker（/rp/rollback-mask）——客户端投影不透传 marker 的 source
// 字段（真机实证），故由前端拉取。useSyncExternalStore 订阅；回退/编辑/重新
// 生成成功后调 refreshRollbackMask 立即刷新（UI 即时隐藏 + 楼层号重排）。
//
// 【2026-09-14 F2 架构修复：阈值 → 集合】
// 旧实现用单一阈值 `hideAfter`（「seq > 它就隐藏」）。这与事实不符——回退之后用户
// 正常发的新消息 seq 也大于锚点，会被连坐隐藏；于是后端加了「marker 之后出现新
// 用户消息 → 掩码整体归零」的补丁，代价正是**回退后重发会把被回退的旧楼层全部复活**
// （用户实测截图的直接原因）。
// 根因是**用阈值表达集合**：集合会随新事件增长，阈值不会。
// 现改为权威判据 = `hiddenSeqs` 集合（写侧逐条记录的被 replace 移出 seq），
// 精确且**持久有效**，与后续新增消息无关。`hideAfter` 仅作降级（存量会话无集合）。
// ---------------------------------------------------------------------------

/** 掩码状态：集合优先，阈值为降级 */
export interface MaskState {
  /** 精确的被移出 seq 集合（权威判据；只含 surface 事件） */
  hidden: ReadonlySet<number>
  /**
   * 【2026-09-19 回退连带面修复】被移除的**整轮**事件 seq 区间（含非 surface 事件）。
   *
   * 为什么集合不够：harness 的运行过程节点（`system-prompt` 系统提示词、`context`
   * 上下文注入、`turn-error` 本轮运行失败）的 anchorSeq **不在** `hidden` 里——
   * 系统提示词的锚是 `turn/start` 的 seq（真实会话实证：比用户消息还早），注入/错误的锚
   * 落在 `request/header` / `turn/end` 上，而 `hidden` 只含 surface 事件
   * （user/message、assistant/message、tool/result）。用户实测：回退后这些行仍留在会话流里。
   */
  ranges: ReadonlyArray<{ start: number; end: number }>
  /** 阈值降级（仅当集合与区间都为空且宿主给了非零 hideAfter 时使用；存量会话路径） */
  hideAfter: number
}
const EMPTY_MASK: MaskState = { hidden: new Set<number>(), ranges: [], hideAfter: 0 }

const maskCache = new Map<string, MaskState>()
const maskListeners = new Map<string, Set<() => void>>()
const maskInflight = new Set<string>()
async function refreshRollbackMask(sessionId: string): Promise<void> {
  if (maskInflight.has(sessionId)) return
  maskInflight.add(sessionId)
  try {
    const r = await rpApi<{ hideAfter?: number; hiddenSeqs?: number[]; hiddenRanges?: Array<{ start?: number; end?: number }> }>('rp/rollback-mask', { sessionId })
    const seqs = Array.isArray(r.hiddenSeqs) ? r.hiddenSeqs.filter(n => typeof n === 'number') : []
    const hide = typeof r.hideAfter === 'number' && r.hideAfter > 0 ? r.hideAfter : 0
    // 【2026-09-19】连带范围（含非 surface 事件；服务端每次回退/编辑/重生成写一条）
    const ranges = Array.isArray(r.hiddenRanges)
      ? r.hiddenRanges.filter(x => typeof x?.start === 'number' && typeof x?.end === 'number')
        .map(x => ({ start: x.start as number, end: x.end as number }))
      : []
    // 集合或区间任一非空 ⇒ 精确判据生效（阈值完全不用，避免「阈值连坐新消息」的老毛病复发）
    const next: MaskState = (seqs.length > 0 || ranges.length > 0)
      ? { hidden: new Set(seqs), ranges, hideAfter: 0 }
      : { hidden: new Set<number>(), ranges: [], hideAfter: hide }
    const prev = maskCache.get(sessionId)
    const same = prev !== undefined && prev.hideAfter === next.hideAfter
      && prev.hidden.size === next.hidden.size && prev.ranges.length === next.ranges.length
    if (!same) {
      maskCache.set(sessionId, next)
      maskListeners.get(sessionId)?.forEach(cb => cb())
    }
    // 【2026-09-13 修复·静默失败（D-7）】原 catch 空实现（注释「按 0（不隐藏）」）——
    // 拉取失败时掩码保持上一次值，但**零日志**：出现「被回退的消息还显示着」这类
    // 观感异常时无从判断是后端没返回还是前端没拉到。改为留痕（行为不变：保上次值）。
  } catch (e) {
    console.warn('[dsht-rp-ui] 回退掩码刷新失败（保留上次掩码）:', (e as Error)?.message)
  } finally {
    maskInflight.delete(sessionId)
  }
}
export function useRollbackMaskState(sessionId: string | undefined): MaskState {
  const subscribe = useCallback((cb: () => void) => {
    if (sessionId === undefined) return () => undefined
    let set = maskListeners.get(sessionId)
    if (set === undefined) { set = new Set(); maskListeners.set(sessionId, set) }
    set.add(cb)
    void refreshRollbackMask(sessionId)
    return () => { set!.delete(cb) }
  }, [sessionId])
  const getSnapshot = useCallback(
    () => (sessionId !== undefined ? maskCache.get(sessionId) ?? EMPTY_MASK : EMPTY_MASK),
    [sessionId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MASK)
}

/** 某 seq 是否已被回退/编辑/重新生成移出上下文（区间 + 集合优先，阈值为降级）
 *  【2026-09-19】区间先行：harness 运行过程节点的锚（turn/start、request/header、
 *  turn/end）只被区间覆盖；集合与区间都空时才退回阈值（存量会话）。 */
function isSeqHidden(mask: MaskState, seq: number | undefined): boolean {
  if (seq === undefined) return false
  for (const r of mask.ranges) if (seq >= r.start && seq <= r.end) return true
  if (mask.hidden.size > 0) return mask.hidden.has(seq)
  if (mask.ranges.length > 0) return false
  return mask.hideAfter > 0 && seq > mask.hideAfter
}

/** 兼容旧签名的取值器（返回等价的阈值语义值，仅供仍按阈值判定的调用点使用）。
 *  新代码请用 `useRollbackMaskState` + `isSeqHidden`。 */
function useRollbackMask(sessionId: string | undefined): number {
  return useRollbackMaskState(sessionId).hideAfter
}
// globalThis 桥：index.tsx 的 regenerate inject（跨模块）成功后刷新掩码
;(globalThis as { __dshtRpRefreshRollbackMask?: (sid: string) => Promise<void> }).__dshtRpRefreshRollbackMask = refreshRollbackMask
// 【2026-09-14 F2-B3】会话快照刷新桥：回退/编辑/重新生成后，前端需要 sessions.refresh
// 让后续 prompt 基于最新会话基线（组件拿不到 ctx.sessions，故由 index.tsx 注册）。
// 缺省（未注册）时为 no-op 并留痕——不许静默假装刷新过。
;(globalThis as { __dshtRpSessionsRefresh?: () => Promise<void> }).__dshtRpSessionsRefresh =
  (globalThis as { __dshtRpSessionsRefresh?: () => Promise<void> }).__dshtRpSessionsRefresh ??
  (async (): Promise<void> => {
    console.warn('[dsht-rp-ui] sessions.refresh 桥未注册（回退后未刷新会话快照）——应由 index.tsx 注入')
  })
// 【2026-09-14 B3 三路径对齐】显示面缓存失效桥。
// 三条路径（rollback / regenerate / edit）的后端操作都会改变「影响 display 的上下文」
// （display 正则三源、预设 prompt_order）⇒ 已挂载楼层的 processed 结果必须重算。
// rollback 在组件内直接调 notifyDisplayMutation()；regenerate/edit 的实现分散在
// index.tsx（inject 面）与组件内，故经 globalThis 暴露同一函数，
// 保证三条路径**调用的是同一个**失效入口（P-1：不许各写一份）。
;(globalThis as { __dshtRpNotifyDisplayMutation?: () => void }).__dshtRpNotifyDisplayMutation =
  notifyDisplayMutation

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
  // 【W4】原为 `(node.data as { time?: unknown })?.time` —— `as` 断言 + 裸读；
  // 改走 readNodeTime（已含 number 判定），本函数只保留「正数」这一业务约束。
  const t = readNodeTime(node?.data)
  return t !== undefined && Number.isFinite(t) && t > 0 ? t : undefined
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
  const maskState = useRollbackMaskState(sessionId)
  const index = useChat === undefined ? undefined : useChat((snapshot) => floorIndexFromChat(snapshot, maskState))
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
    // 【T-34 2026-09-11 修复 · 死代码】此处原为
    //   `if (side === 'assistant' && typeof turnMs === 'number' && turnMs >= 500) meta.push(formatDuration(turnMs))`
    // 本分支的前提就是 `side !== 'assistant'`（上方 if 的 else）→ 条件恒假；且 `turnMs` 只按
    // turn 内**最后一个 assistant-step** 的 key 落表（见 floorIndexOfChat :401），user 楼层的
    // nodeKey 永远取不到值 → 无论怎么改条件都不可达。故直接删除，不留误导性的空转判断。
    if (showFloor) meta.push(`#${floor}`)
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

/** conversation.chat.node 席位里「harness 运行过程」行（turn-error / system-prompt /
 *  context）收到的 props：只需 node（含 anchorSeq）与 sessionId（掩码查询用）。
 *  `data` 声明为 unknown（同 LikeChatNode 的理由：beta 期字段不得当既定契约）。 */
interface HarnessNodeViewProps {
  node: LikeChatNode
  sessionId?: string | undefined
}

/**
 * 【F1 2026-09-14】turn-error 节点 shadowing 渲染器。
 *
 * ## 为什么必须 shadowing 而不是只改自己的 toast
 * 用户实测看到的 `pi-ai detected context overflow for model "deepseek/…"` 由
 * **官方会话流**渲染：`dsh-client-ui-chat` 的 `TurnErrorNodeView`
 * （lib/client.js:1186-1211）直接 `failureMessage(node.message, node.code, t)`
 * 透传原文，而 `failureMessage` 除 AUTH 外**原样返回 message**
 * （同文件 :1126-1128）——即官方把上游 SDK 的原始措辞直接摆到用户面前。
 *
 * 我们**不能改官方源码**（合规红线），但 `turn-error` 是 keyed Chat node，
 * 与 `assistant-step` / `user` 一样可经 `conversation.chat.node` 席位 shadowing
 * （官方注册点见同文件 TURN_PROCESS_INDEPENDENT_KINDS 含 "turn-error"）。
 * 于是在我方层做隔离：**人话为主 + 原文折叠为详情**（信息不丢，排障可用）。
 *
 * 可卸载性（P7）：拔掉本插件 = 本 shadowing 消失，官方 TurnErrorNodeView 复位。
 */
const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, sessionId }: HarnessNodeViewProps) {
  // 【2026-09-19 回退连带面修复】掩码判定：被回退的那一轮，本行与 user/assistant 同款消失。
  // 判据走 node.anchorSeq（失败事件的 seq），见 host-projection.readNodeAnchorSeq 头注。
  const mask = useRollbackMaskState(sessionId)
  const data = readNodeData(node)
  const raw = typeof data.message === 'string' ? data.message : String(data.message ?? '')
  const code = typeof data.code === 'string' ? data.code : ''
  if (isSeqHidden(mask, readNodeAnchorSeq(node) ?? readNodeSeq(data))) return null
  const friendly = humanizeError(Object.assign(new Error(raw), { code }))
  // 隔离前后一致 = 这条消息没有内部细节泄漏，无需折叠区（避免给所有错误都加噪音）
  const leaked = friendly !== raw
  return (
    <div className="dsht-rp-turn-error" role="status">
      <span className="te-dot" aria-hidden="true">●</span>
      <div className="te-copy">
        <span className="te-title">本轮运行失败</span>
        <span className="te-message">{friendly}</span>
        {leaked && (
          <details className="te-detail">
            <summary>技术详情</summary>
            <pre className="te-raw">{raw}</pre>
          </details>
        )}
      </div>
      {code !== '' && <code className="te-code">{code}</code>}
    </div>
  )
})

export const RpTurnErrorView = TurnErrorNodeView

/**
 * 【2026-09-19 回退连带面修复】harness 运行过程行的 shadowing 渲染器
 * （keyed `system-prompt` 系统提示词 / keyed `context` 上下文注入）。
 *
 * ## 为什么必须接管
 * 回退（逻辑回退）只把 **surface 节点**（user/message、assistant/message、tool/result）
 * 移出上下文并写进 `shadowedSeqs`；而这两类行的锚**不是** surface 事件——
 * `system-prompt` 锚在 **turn/start**（真实会话实证：seq 6 < 用户消息 seq 9）、
 * `context` 锚在注入事件自身。官方 view 不认识我们的掩码，于是用户实测看到：
 * 回退后「系统提示词 / 上下文注入」仍留在会话流里（截图实证）。
 *
 * ## 为什么是"重绘"而不是改官方
 * 官方 `SystemPromptNodeView` / `ContextMessageNodeView` 在 ui-chat 内部、**不可 import**；
 * 我们**不改官方源码**（合规红线），故按 `conversation.chat.node` 席位 shadowing
 * （与 `assistant-step` / `user` / `turn-error` 同一机制，priority -1 覆盖）。
 * 本层只保证「同样的信息量、更简的形式」：默认折叠一行，展开看正文；
 * 被回退的行返回 null（隐藏）。
 *
 * 可卸载性（P7）：拔掉本插件 = 本 shadowing 消失，官方两行渲染器复位。
 */
const HarnessRow = memo(function HarnessRow({ icon, title, meta, body, testId }: {
  icon: string
  title: string
  meta?: string | undefined
  body: ReactNode
  testId: string
}) {
  return (
    <details className="dsht-rp-harness-row" data-testid={testId}>
      <summary>
        <span className="hr-icon" aria-hidden="true">{icon}</span>
        <span className="hr-title">{title}</span>
        {meta !== undefined && meta !== '' && (
          <>
            <span className="hr-sep" aria-hidden="true" />
            <span className="hr-meta">{meta}</span>
          </>
        )}
      </summary>
      <div className="hr-body">{body}</div>
    </details>
  )
})

/** keyed `system-prompt`：模型请求的完整系统提示词（官方默认折叠；prompt 为空时不渲染——同官方） */
export const RpSystemPromptNodeView = memo(function RpSystemPromptNodeView({ node, sessionId }: HarnessNodeViewProps) {
  const mask = useRollbackMaskState(sessionId)
  const data = readNodeData(node)
  const text = typeof data.text === 'string' ? data.text : ''
  if (isSeqHidden(mask, readNodeAnchorSeq(node))) return null
  if (text === '') return null
  return (
    <HarnessRow
      icon="📄" title="系统提示词" testId="dsht-rp-system-prompt"
      body={<pre className="hr-pre">{text}</pre>}
    />
  )
})

/** keyed `context`：注入进模型历史的非用户上下文（skill 目录 / 插件注入 / 跨会话召回…）。
 *  标题 = 「上下文注入 · <producer>」——producer 名取官方已算好的 `data.provenance.label`
 *  （官方 `contextProvenance(source)` 的产物，本层不重算，避免两套口径）。 */
export const RpContextNodeView = memo(function RpContextNodeView({ node, sessionId }: HarnessNodeViewProps) {
  const mask = useRollbackMaskState(sessionId)
  const data = readNodeData(node)
  // 内容块走单源读取器（readBlocks 兼容 content/blocks 两个官方字段名）——
  // 裸迭代 `data.content` 会被 projection-shape-defense 护栏判红（真实踩过）
  const blocks = readBlocks(data)
  const body = contextBodyText(blocks)
  // 【判据顺序】锚优先用 node.anchorSeq（= 注入事件 seq）；缺失退回 data.seq（同值兜底）
  const anchor = readNodeAnchorSeq(node) ?? readNodeSeq(data)
  if (isSeqHidden(mask, anchor)) return null
  const prov = data.provenance
  const label = prov !== undefined && prov !== null && typeof prov === 'object'
    ? (typeof (prov as { label?: unknown }).label === 'string' ? (prov as { label: string }).label : '')
    : ''
  const title = (prov as { role?: unknown } | undefined)?.role === 'recall' ? '跨会话召回' : '上下文注入'
  return (
    <HarnessRow
      icon="📥" title={title} meta={label === '' ? undefined : label} testId="dsht-rp-context-injection"
      body={body === '' ? <span className="hr-empty">（无文本内容）</span> : <pre className="hr-pre">{body}</pre>}
    />
  )
})

/** 注入内容的文本形态（content blocks → 文本；非文本块标记类型名，不丢信息也不炸） */
function contextBodyText(blocks: readonly Record<string, unknown>[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') out.push(b.text)
    else if (typeof b.type === 'string') out.push(`[${b.type}]`)
  }
  return out.join('\n\n')
}

/**
 * 完整 HTML 文档段的 iframe 渲染器（P0-2）：
 * - sandbox = `allow-scripts allow-same-origin allow-modals allow-forms allow-popups`
 *   （**含 same-origin**：卡自带 `<script>` 依赖 parent.$/jQuery/Mvu/eventOn，真 TH/ST 的
 *   message iframe 就是同源形态，用户拍板复刻）+ referrerPolicy="no-referrer"；
 *   【2026-09-14 L5 穷举】原注释写「不给 allow-same-origin」，与实际 `setAttribute`
 *   矛盾（同一事实两处不一致，P-1）——此处按实现订正。
 * - srcdoc 由 buildDisplayFrameDocument 组装（CSP + 高度上报脚本）；C3 use_blob_url
 *   开启时改走 blob: URL（卸载/文档变更时 revoke）；
 * - 高度由 iframe 内 postMessage 上报（token + event.source 双校验），clamp [48,3000]。
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
  // 【E2/P-1 W4 收口】本组件的官方投影读取**全部**走单源读取器。
  // 此前这里是全仓裸读最密集处（`data.blocks` 裸迭代在渲染热路径、`data.finalNode.seq`
  // 写 8 遍、`data.status` 裸比 4 遍），官方改投影形状即抛 ⇒ 被 SlotErrorBoundary
  // 吞成「整片楼层消失」，零报错。见 host-projection.ts 头注。
  const data = readNodeData(node)
  const nodeKey = readNodeKey(node)
  const status = readNodeStatus(data)
  const streaming = status === 'running'
  const interrupted = status === 'interrupted'
  const blocks = readBlocks(data)
  const mySeq = readFinalSeq(data)
  // 【hook 移植 L1a】TH 事件桥：message_received + stream_token_received
  // （streaming 期文本 diff 直投；ST STREAM_TOKEN_RECEIVED 载荷 = 累计文本）
  // message_received 语义 = "回复定稿"：mount 时已定稿的新鲜消息（重连/补页场景）投一次 +
  // running → 非 running 转换瞬间投一次（流式完成）。
  const receivedSeq = mySeq
  useEffect(() => {
    if (sessionId === undefined || !isFreshMessage(data) || streaming) return
    dispatchThEvent(sessionId, 'message_received', { nodeKey: nodeKey, seq: receivedSeq })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const prevStreaming = useRef(streaming)
  useEffect(() => {
    if (prevStreaming.current && !streaming && sessionId !== undefined) {
      dispatchThEvent(sessionId, 'message_received', { nodeKey: nodeKey, seq: receivedSeq })
    }
    prevStreaming.current = streaming
  }, [streaming, sessionId, nodeKey, receivedSeq])
  const streamText = streaming
    ? blocks.filter(b => b.kind === 'text').map(b => String(b.text ?? '')).join('')
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
  const nodeCount = useSession === undefined ? 0 : useSession((snapshot) => readSessionChat(snapshot).order.length)
  const groups = useVariantGroups(sessionId ?? '', nodeCount)
  // P0-3 depth 透传：消息深度 = 其后 assistant 消息数（0 = 最新），条目自身
  // minDepth/maxDepth 在 runDisplayScripts 中真实生效（此前写死 null 不过滤）
  const messageDepth = useSession === undefined ? null : useSession((snapshot) => {
    if (mySeq === undefined) return 0
    // 【W4】原实现写 `(snapshot as {chat?: {nodes?: {values: ...}}}).chat` 双形态断言 +
    // 裸 `.values()`；改走单源（readSessionChat 已含「nodes 必须有 values 函数」判定）。
    let newer = 0
    forEachChatNode(readSessionChat(snapshot), (n) => {
      if (readNodeKind(n) !== 'assistant-step') return
      const s = readFinalSeq(readNodeData(n))
      if (s !== undefined && s > mySeq) newer += 1
    })
    return newer
  })
  const variantOverride = useMemo(() => {
    const seq = mySeq
    if (seq === undefined || streaming || groups.length === 0) return undefined
    const g = groupOf(groups, seq)
    if (g === undefined || g.members.length < 2) return undefined
    const active = g.members.find(m => m.seq === g.activeSeq)
    if (active === undefined || active.seq === seq) return undefined
    return active.text
  }, [mySeq, groups, streaming])
  // 思考折叠行耗时（2026-09-04）：本 step 耗时 + 本轮总耗时（任务结束后显示）
  const mask = useRollbackMaskState(sessionId)
  const stepDurationMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, mask).stepMs.get(nodeKey))
  const turnTotalMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, mask).turnMs.get(nodeKey))
  // C3 depth_ignore_hidden：深度计算剔除被回退掩码隐藏的更新楼层（集合语义：逐条精确判定）
  const hiddenNewerCount = useSession === undefined ? 0 : useSession((snapshot) => {
    if (mySeq === undefined) return 0
    let hidden = 0
    forEachChatNode(readSessionChat(snapshot), (n) => {
      if (readNodeKind(n) !== 'assistant-step') return
      const s = readFinalSeq(readNodeData(n))
      if (s !== undefined && s > mySeq && isSeqHidden(mask, s)) hidden += 1
    })
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
    //
    // 【2026-09-14 P1 修复】原 `streamingRenderOk` 把**整段**退纯文本（enhanced=false
    // → 走 MarkdownText 裸渲 HTML 源码），这是用户实测的「流式期间 HTML 裸露」根因
    // （真机截图：生成过程中卡片/悬浮球的 HTML 源码满屏）。
    // 现拆成两个门，流式期间**照常走三段编译**：
    //   · thRenderOn      —— 渲染总开关（关 = 全退纯文本，用户显式选择）
    //   · frameRenderOn   —— 仅管**完整 HTML 文档段**是否落 iframe。
    //     流式中该门关时，改把文档段渲染成 ```html 围栏代码块（MarkdownText 出代码块，
    //     **不裸露源码**），定稿后自动换成 iframe。
    //     为什么不干脆流式期间就建 iframe：内容每增长一次 frameKey 就变一次
    //     （见 RpMessageFrame 的帧停车场），会疯狂驱逐/重执行卡脚本 —— TH 默认
    //     allowStreaming=false 正是规避这个；用户显式打开则照建。
    //   · markdown / inline-html 两段在流式期间**始终渲染**（这正是原先裸露的部分）。
    // 【L5 2026-09-14】决策下沉为纯函数 `shouldRenderFrame`（`display-compiler.ts`）：
    // 这条判断是上述修复的核心，内联在组件里无法单测。现调用点只剩一行，判据单源可测。
    const frameRenderOn = shouldRenderFrame(thRenderOn, streaming, pipeline.th?.allowStreaming)
    // ---- B8 素材：展开前后全文对比（确有变化才写回）----
    const rawTexts: string[] = []
    const expandedTexts: string[] = []
    let pureTextMessage = true // 含 reasoning/tool 等块的楼层不写回（replace 会丢思考历史）
    // 【W4】原为 `for (const block of data.blocks)` —— **渲染热路径裸迭代**：
    // 官方一旦把 `blocks` 改成缺失/null/非数组即抛，异常被 SlotErrorBoundary 吞掉
    // ⇒ 整片楼层消失且零报错。`blocks` 已在组件顶部经 `readBlocks` 取（缺失 ⇒ 空数组）。
    for (const block of blocks) {
      const kind = typeof block.kind === 'string' ? block.kind : ''
      if (kind === 'reasoning') {
        const parsed = parseReasoningDuration(typeof block.text === 'string' ? block.text : '')
        units.push({ kind: 'reasoning', text: parsed.text, ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}) })
        pureTextMessage = false
      } else if (kind === 'image') {
        units.push({ kind: 'image', images: [block.attachment] })
        pureTextMessage = false
      } else if (kind === 'text' && typeof block.text === 'string') {
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
                  // C3：渲染总开关关 → 退纯文本（不切三段，整段 MarkdownText）
                  if (!thRenderOn) {
                    units.push({ kind: 'text', text: part.content })
                    continue
                  }
                  // P0-2 三段编译（display-compiler.ts compileDisplaySegments）：
                  // 完整 HTML 文档 → iframe（悬浮球 position:fixed 部件在 iframe 舞台运行）；
                  // 行首平衡 HTML 块 → sanitize 内联（sanitize 失败整块转 iframe，
                  // 替代旧的「sanitize 失败就纯文本」兜底）；其余 prose → MarkdownText。
                  // 【2026-09-14 P1】流式期间同样走本编译；仅「完整文档段」的落点由
                  // frameRenderOn 决定（iframe vs 代码块），见上方 frameRenderOn 注释。
                  for (const dseg of compileDisplaySegments(part.content)) {
                    if (dseg.kind === 'markdown') {
                      if (dseg.text.trim()) units.push({ kind: 'text', text: dseg.text })
                    } else if (dseg.kind === 'html') {
                      units.push(frameRenderOn
                        ? { kind: 'frame', html: dseg.source }
                        : { kind: 'text', text: frameFallbackText(dseg.source) })
                    } else {
                      const clean = sanitizeDisplayHtml(dseg.source)
                      if (clean !== null) units.push({ kind: 'html', html: clean })
                      else units.push(frameRenderOn
                        ? { kind: 'frame', html: dseg.source }
                        : { kind: 'text', text: frameFallbackText(dseg.source) })
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
    // 【W4】原为 `const mySeq = data.finalNode?.seq` 后判 `typeof mySeq === 'number'`，
    // 现直接用顶部经 readFinalSeq 取到的值（类型已是 number | undefined）。
    const permanent = proto !== null && !streaming && pureTextMessage && sessionId !== undefined
      && variantOverride === undefined
      && pipeline.ejs !== null && pipeline.ejs.enabled && pipeline.ejs.permanentEvaluation
      && pipeline.ctx !== null && mySeq !== undefined && expandedJoined !== rawJoined
      ? { sessionId, seq: mySeq, text: expandedJoined }
      : undefined
    return { actions, units, permanent }
  }, [blocks, proto, streaming, variantOverride, displayScripts, messageDepth, hiddenNewerCount, pipeline, mySeq, sessionId])

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

  // 【W4】原为 `data.blocks.some(...)` —— 同一个裸读的第二处（见顶部 readBlocks 注释）。
  const hasVisible = streaming || interrupted || processed.units.length > 0 || blocks.some(b => b.kind !== 'tool-call')
  // 逻辑回退掩码：本 step 的定稿消息 seq 已被回退/编辑/重新生成移出上下文 → 不渲染
  const hiddenByRollback = isSeqHidden(mask, mySeq)
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
            // 【T-34 2026-09-11】`slug ?? undefined`：本组件契约是「undefined = 不注 shim」，
            // 而 `slugFromCwd` 无匹配时返回 **null**（null !== undefined → 会被判成"有 slug"
            // 去 reserveMessageFrame/fetchFrameVars，把 null 当 string 用）。归一化后语义一致。
            return <RpMessageFrame key={i} html={u.html} useBlobUrl={pipeline.th?.useBlobUrl === true} sessionId={sessionId} slug={slug ?? undefined} thShim={pipeline.th === null || pipeline.th.enabled === true} />
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
function seqOfMessage(chatSnapshot: unknown, messageId: string): number | undefined {
  // 【W4】原签名把 chat 形状写成 `{ nodes?: { values: ... } }` 并在调用点 `as` 断言；
  // 现收口到 forEachChatNode（`nodes` 缺 `values` 函数即当缺失，不抛不空转）。
  let found: number | undefined
  forEachChatNode(chatSnapshot, (n) => {
    if (found !== undefined) return
    const d = readNodeData(n)
    if (readFinalMessageId(d) === messageId) found = readFinalSeq(d)
  })
  return found
}

/** 变体条 ‹ n/m ›（渲染进原生 IconActions 行，位于 copy 与 branch 之间） */
export function RpVariantActions({ messageId, useChat, sessionId }: VariantActionProps): JSX.Element | null {
  const seq = useChat((snapshot) => seqOfMessage(snapshot, messageId))
  const nodeCount = useChat((snapshot) => readChat(snapshot).order.length)
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
  // 【W4】原为 `(data as { time?: unknown })?.time` 断言裸读。缺失 time ⇒ 视为新鲜
  // （旧口径：`typeof t !== 'number'` 即通过）——语义随之显式化。
  const t = readNodeTime(data)
  return t === undefined || Date.now() - t < 15000
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
    // 【心跳 59 · T-57】两处静默降级修正（原实现 `.catch(() => new Map())`）：
    //   ① **失败不缓存**：原实现把「失败产生的空 Map」**永久钉在模块级变量上**
    //      （`rpSessionCache` 非 null 不重取）→ 一次瞬时失败 = 该会话周期内
    //      `isRp` 恒 false → 重新生成按钮**永不显示**（用户看不到任何报错）。
    //      改为失败时清回 null，下次挂载可重取。
    //   ② **可自愈错误自动重试一次**：`gateway/service-unavailable` 是宿主服务
    //      （`sessionController` 的 cordis fiber）暂时离开 ACTIVE，
    //      依赖恢复时框架会自动 `_reload()`（`cordis/src/fiber.ts:688-695`）
    //      → 属「等一下就好」，值得一次短延迟重试；其余错误（如 not-found）不重试。
    const once = (): Promise<Map<string, boolean>> =>
      dshRpc<{ items?: Array<{ sessionId: string; cwd?: string }> }>('session.list', { _request: {} })
        .then(r => new Map((r.items ?? []).map(it => [it.sessionId, slugFromCwd(it.cwd) !== null])))
    rpSessionCache = once().catch(async (e: unknown) => {
      if (isServiceUnavailable(e)) {
        await new Promise(resolve => setTimeout(resolve, 1200))
        try { return await once() } catch { /* 落到下方统一处理 */ }
      }
      rpSessionCache = null // 关键：失败不钉住，允许下次重取（原实现在此处永久缓存空 Map）
      console.warn('[dsht-rp-ui] fetchRpSessionMap 失败（重新生成按钮本轮不显示，稍后会自动重试）:', (e as Error).message)
      return new Map<string, boolean>()
    })
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
    // 【W4】原实现把 chat 形状写成 interface 再 `as` 断言 + 裸 `.values()`；改走单源。
    let lastSeq = -1
    let lastId: string | undefined
    forEachChatNode(snapshot, (n) => {
      if (readNodeKind(n) !== 'assistant-step') return
      const d = readNodeData(n)
      const s = readFinalSeq(d)
      if (s !== undefined && s > lastSeq) { lastSeq = s; lastId = readFinalMessageId(d) }
    })
    return lastId !== undefined && lastId === messageId
  })
  const running = useSession((snapshot) => readSessionRunning(snapshot))

  const onClick = useCallback(async () => {
    if (busy || regenerate === undefined) return
    if (!await showDomConfirm('重新生成最后一条回复？（当前回复会被移除）', { okText: '重新生成' })) return
    setBusy(true)
    try {
      await regenerate(sessionId)
      // TH 事件桥：重新生成 = 旧回复移除语义 → message_deleted（ST MESSAGE_DELETED 对应）
      dispatchThEvent(sessionId, 'message_deleted')
    } catch (e) {
      // 【D5 2026-09-13】原为 window.alert（安卓上阻塞渲染）→ 改非阻塞 toast + 人话翻译
      showDomToast('error', `重新生成失败：${humanizeError(e)}`)
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

/** conversation.chat.node 席位（user 变体）收到的 props —— `node.data` 同 RpAssistant 侧
 *  声明为 `unknown`（理由见 LikeChatNode 注释；官方 user 数据的 `seq`/`content` 都是
 *  beta 期字段，不得在类型层当作必然存在）。 */
interface UserNodeViewProps {
  node: LikeChatNode
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
  // 【E2/P-1 W4 收口】本组件同 RpAssistantNodeView：官方投影读取全部走单源。
  const data = readNodeData(node)
  const nodeKey = readNodeKey(node)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const seq = readNodeSeq(data)
  // 块列表（user 节点的官方字段名是 `content`；readBlocks 已兼容两名字）。
  const blocks = readBlocks(data)
  // 【2026-09-08 鲁棒性】running 守卫（重新生成按钮同款）：turn 运行中回退/编辑会与
  // 生成期 append 互踩（live replace 的 claim/mark 窗口被生成 append 插入——数据面已把
  // undo 回放挪出该窗口，这里再禁掉入口），按钮置灰防误触。
  const running = useSession === undefined ? false : useSession((snapshot) => readSessionRunning(snapshot))
  // 【2026-09-14 F2】掩码状态（集合语义）——本气泡是否已被回退/编辑移出上下文
  const mask = useRollbackMaskState(sessionId)
  // 【hook 移植 L1a】TH 事件桥：message_sent（mount 新鲜度门——开聊重放历史不投递）
  useEffect(() => {
    if (sessionId === undefined || sessionId === null || !isFreshMessage(data)) return
    dispatchThEvent(sessionId, 'message_sent', { nodeKey: nodeKey, seq: seq })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // T1.14 窗口化：user 消息外壳同样自注册（静态内容，无 forced 场景）
  const sessionKey = sessionId ?? cwd ?? 'rp-chat'
  const { shellRef, windowed, placeholderHeight } = useMessageWindowing(sessionKey, nodeKey, false)

  const parts = useMemo(() => {
    const texts: string[] = []
    const images: Array<{ attachment: unknown }> = []
    // 【W4】原为 `for (const b of data.content ?? [])` + `b as {...}` 逐块断言；
    // 改走 readBlocks（已保证元素是对象）后按字段类型判定，不再需要断言。
    for (const b of blocks) {
      const type = typeof b.type === 'string' ? b.type : ''
      if (type === 'text' && typeof b.text === 'string') texts.push(b.text)
      else if (type === 'image' && b.attachment !== undefined) images.push({ attachment: b.attachment })
    }
    return { text: texts.join(''), images }
  }, [blocks])

  const rollback = useCallback(async () => {
    if (busy || running || seq === undefined || !sessionId) return
    if (!await showDomConfirm('回退到这条消息？该消息与其后的对话将从上下文移除，原文放回输入框（事件仍保留在日志；状态/变量一并回滚）。', { okText: '回退' })) return
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
      // 【2026-09-14 F2-B3】刷新动作与 regenerate 分支对齐。原实现只刷新掩码，
      // 不刷会话快照/显示面缓存——live 回退后 composer 里再发消息时，
      // sessions 侧的 summaries 与显示面缓存仍可能是旧代，配合后端掩码归零
      // 造成「旧楼层复活」。三条一起做才算完整：
      //   ① 掩码（隐藏集合）
      //   ② sessions.refresh（让后续 prompt 基于最新会话基线）
      //   ③ 显示面缓存失效（display 正则三源 / 预设 prompt_order 直接影响楼层 display）
      await refreshRollbackMask(sessionId)
      try {
        await (globalThis as {
          __dshtRpSessionsRefresh?: () => Promise<void>
        }).__dshtRpSessionsRefresh?.()
      } catch (e) {
        console.warn('[dsht-rp-ui] 回退后会话刷新失败（继续）:', (e as Error)?.message)
      }
      notifyDisplayMutation()
      setBusy(false)
    } catch (e) {
      // 【D5 2026-09-13】window.alert → 非阻塞 toast + 人话翻译
      showDomToast('error', `回退失败：${humanizeError(e)}`)
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
          detail: { sessionId, eventType: 'message_edited', nodeKey: nodeKey },
        }))
        await dshRpc('session.prompt', {
          request: {
            requestId: crypto.randomUUID(),
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text }],
            ...clientTimeZoneFields(),
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
              ...clientTimeZoneFields(),
            },
          })
        } catch { /* 重发失败也重开：用户看得到截断结果再手动重试 */ }
        // 【①轮核查 2026-09-06】同 rollback 分支：rc.7 web wire 无 session.close/open，
        // 原调用恒失败被 catch 吞掉；且本分支在聊天视图里不可达（viewing = live）。移除。
        void refreshRollbackMask(sessionId)
        setBusy(false)
        setEditing(false)
      }
      // 【2026-09-14 B3 三路径对齐】edit 的**两分支共用**收尾：会话快照刷新 + 显示面缓存失效。
      // 判据（goal B3）：rollback / regenerate / edit 的刷新动作必须一致。
      // 此前 edit 只刷新掩码 ⇒ 「编辑后再回退」时 sessions 基线仍是旧代、
      // 显示面缓存仍用旧上下文（实机表现为「编辑后楼层显示不更新，再回退更乱」）。
      // 抽到分支外=一次写、两分支都覆盖（避免「补一个漏一个」——本项目反复出现的形态）。
      try {
        await (globalThis as { __dshtRpSessionsRefresh?: () => Promise<void> }).__dshtRpSessionsRefresh?.()
      } catch (e) {
        console.warn('[dsht-rp-ui] 编辑后会话刷新失败（继续）:', (e as Error)?.message)
      }
      ;(globalThis as { __dshtRpNotifyDisplayMutation?: () => void }).__dshtRpNotifyDisplayMutation?.()
    } catch (e) {
      // 【D5 2026-09-13】window.alert → 非阻塞 toast + 人话翻译
      showDomToast('error', `编辑失败：${humanizeError(e)}`)
      setBusy(false)
    }
  }, [busy, running, draft, seq, sessionId, nodeKey])

  // 逻辑回退掩码：本消息 seq 已被编辑/回退移出上下文 → 不渲染（编辑重发的新消息
  // seq 更大且不在集合内，正常显示）
  // 【W4】原写 `typeof data.seq === 'number' ? data.seq : undefined`，改用顶部 readNodeSeq 结果。
  const hiddenByRollback = isSeqHidden(mask, seq)
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
