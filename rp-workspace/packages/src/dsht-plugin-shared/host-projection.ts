/**
 * 官方投影读取的**唯一入口**（E2 防御性读取 / P-1 单源化 · 2026-09-14 W4 收口）。
 *
 * ## 为什么要有这个文件
 *
 * 官方 DSH 仍是 beta，**SessionSnapshot / ChatSnapshot 的形状未定型**：字段既可能
 * 在 `session.header.X`，也可能在顶层 `session.X`（历史两版都出现过）；数组字段可能
 * 缺席、可能是 `null`、也可能是**同名不同类型的合法值**（如 `header` 是数组）。
 *
 * 此前这些读取**散落在 48 处**（客户端 22 + 宿主侧 26），各自写 `?.` / `??` / 裸读，
 * 造成三类真实缺陷（W4 穷举发现）：
 *
 *   ① **同一字段多套口径**：`session.blank` 有 **3 种**判定
 *      （`!== true` / `=== true` / `!== false`），其中两种对「字段缺失」的结论**相反**
 *      ⇒ 官方删字段那天，一批组件集体翻转，且**零报错**（P-3 静默族）。
 *   ② **裸深层读取会抛**：`data.blocks`（渲染热路径）、`agent.session.header.cwd`、
 *      `session.surface.nodes` 等 **13 处**无任何守卫；官方改形状即抛异常，
 *      而外层 try/catch 会把它吞成「整轮 RP 注入静默失效」（P-3 最严重形态）。
 *   ③ **护栏只覆盖一个包**：既有 `projection-shape-defense.spec.ts` 只扫
 *      `dsht-rp-ui/src/client`，而裸读集中在 `dsh-plugin` / `dsht-plugin-memory`。
 *
 * ## 为什么放在 `dsht-plugin-shared/`（而不是 UI 包内）
 *
 * 消费方跨 **5 个包**：`dsht-rp-ui`（客户端）+ `dsh-plugin` / `dsht-plugin-memory` /
 * `dsht-plugin-undo` / `dsht-plugin-prompt-template`（宿主侧）。若放在 UI 包内，
 * 宿主侧就要**反向依赖 UI 包**（依赖方向错误，且会把浏览器侧代码拖进 node 半边）。
 * shared 层已被这 5 个包共同依赖（见 `host-macro-bridge.ts` / `session-write.ts` 等）。
 *
 * ## 口径（E2：存在性 + 类型，缺字段不得崩，且**语义必须显式**）
 *
 * 每个读取器都遵循同一条纪律：
 *   · **先判存在性**（`null` / `undefined` / 非对象 ⇒ 返回兜底值，不抛）；
 *   · **再判类型**（类型不符 ⇒ 当作缺失，不抛也不误取，如数组不当作对象）；
 *   · **兜底值语义显式**（不用 `0`/`''`/`false` 冒充「我不知道」——见 P-3；
 *     需要区分时用 `null` 或显式 flag）；
 *   · **同一字段只有一处读法**（P-1）；口径变时只改这里。
 *
 * ## 不许绕开
 * `projection-shape-defense.spec.ts` 有结构护栏：全仓（含宿主侧四个包）不得再出现
 * 这些字段的裸读或逐点复制。新增读官方字段时，**先在这里加读取器**。
 */
import { isMergeableObject } from './deep-merge.ts'

/** 对象判定（数组**不算**对象——官方把 `header` 发成数组时不得被当成 header） */
// 【W8 2026-09-15 单源收口（P-1）】本行原为**逐字复制** `deep-merge.ts:isMergeableObject` 的
// 独立实现（`v !== null && typeof v === 'object' && !Array.isArray(v)`）。
// 两份同语义判定的漂移后果：官方发来**数组形态**的字段时，一处当缺失、另一处当对象
// ⇒ 同一份投影在「读字段」与「合并字段」两条路径上结论不一致，且零报错。
// 委托方向为单向（本文件 → deep-merge），无循环；`deep-merge.ts` 的「零 import」硬约束不受影响
//（约束是**它不引别人**，不是别人不能引它）。
const isPlainObjectLike = isMergeableObject

/** 非空字符串判定（空串视为缺失：官方占位过空串，语义上等于没给） */
function isUsableString(v: unknown): v is string {
  return typeof v === 'string' && v !== ''
}

// ---------------------------------------------------------------------------
// 一、Session 层（客户端快照 + 宿主侧 Session 对象共用）
// ---------------------------------------------------------------------------

/**
 * 会话 cwd（唯一入口）。
 *
 * 官方两版形态：`header.cwd`（当前）与顶层 `cwd`（历史）。
 * 返回 `''` 表示「未就绪」（调用方去补取），不是「没有 cwd」——见 useRpSlug。
 *
 * 宿主侧同款（`agent.session.header.cwd`）也是这条读法：**同一个官方字段，
 * 客户端与宿主侧不许各写一遍**（此前宿主侧 7 处裸读 `.header.cwd`，
 * 都在 `agent/pre-step` 的 try 内 ⇒ 官方改形状即整轮 RP 注入静默失效）。
 */
export function readSessionCwd(s: unknown): string {
  if (!isPlainObjectLike(s)) return ''
  const h = s.header
  if (isPlainObjectLike(h) && isUsableString(h.cwd)) return h.cwd
  return isUsableString(s.cwd) ? s.cwd : ''
}

/**
 * 会话 id（唯一入口）。
 *
 * 【收口理由】此前 5 处写 `s.sessionId ?? s.id ?? ''` —— **不防类型**：
 * 若官方把 id 发成数字/对象，会原样传给 RPC（序列化后仍能跑，但日志与比对会错）。
 * 这里显式判字符串，类型不符即当缺失（返回 `''`）。
 */
export function readSessionId(s: unknown): string {
  if (!isPlainObjectLike(s)) return ''
  if (isUsableString(s.sessionId)) return s.sessionId
  return isUsableString(s.id) ? s.id : ''
}

/**
 * 宿主侧会话 id（唯一入口）。
 *
 * 【为什么与 `readSessionId` 分开】宿主侧 `Session` 对象**只有 `id`**（无 `sessionId`）；
 * 此前宿主侧 5 处写 `String((agent.session as unknown as { id?: string }).id ?? '')` ——
 * 双重问题：`as` 断言绕过类型检查 + `String(undefined)` 得 `'undefined'` 字符串
 * （真值！会当成 sessionId 写进日志/快照目录名）。
 */
export function readHostSessionId(session: unknown): string {
  if (!isPlainObjectLike(session)) return ''
  return isUsableString(session.id) ? session.id : ''
}

/**
 * 会话是否「空白」（无消息）。
 *
 * ## 为什么必须单源（W4 抓到的**真实不一致**）
 * 收口前有 **3 种**口径，且对「`blank` 字段缺失」的判定**互相矛盾**：
 *   · `RpGreetingDock`：`s.blank !== true`（缺失 ⇒ 视为**非空白** ⇒ 不弹开场白横幅）
 *   · `RpStateFloat` ：`s.blank === true`（缺失 ⇒ 视为**非空白** ⇒ **显示**浮球）
 *   · `RpTokenMeter` ：`s.blank !== false`（缺失 ⇒ 视为**空白** ⇒ **不显示**计量条）
 * ⇒ 官方一旦去掉/改这个字段，浮球会显示、计量条会消失、横幅不弹 —— 三者**同时**出错，
 *   且都是静默的（组件 `return null` 不报错）。这是 P-1「同一语义多处读法」的典型后果。
 *
 * ## 本函数选定的语义（唯一口径）
 * **「只有明确 `true` 才算空白」**——即缺失/类型不符一律视为**非空白**（保守：宁可显示）。
 * 依据：`blank` 的语义是「这个会话还没有消息」，而官方**新增字段的默认值方向**
 * 是「不改变既有行为」；我方历史上真机实证的形态也是 `true`/`false` 明确给出。
 * 保守方向不会把「有消息的会话」误判成空白
 * （那会让浮球/计量条消失、并给非空会话弹开场白横幅 = 用户可见的功能缺失）。
 *
 * 需要「明确为 false 才算有消息」这类更严口径的调用点，请显式判 `=== false`，
 * **不要**再写第三种 `!== false`。
 */
export function readSessionBlank(s: unknown): boolean {
  if (!isPlainObjectLike(s)) return false
  return s.blank === true
}

/**
 * 会话是否正在生成（唯一入口）。
 *
 * 官方可能不给该字段 ⇒ 视为「不在生成」。注意方向：判成「不在生成」只会让
 * 按钮可点（用户点了会拿到后端 409），判成「在生成」会让按钮永久置灰
 * （用户**看不到任何解释**）——后者更糟，故取保守的 `=== true`。
 */
export function readSessionRunning(s: unknown): boolean {
  if (!isPlainObjectLike(s)) return false
  return s.running === true
}

/** 宿主侧 session 的 header（唯一入口；缺失/非对象 ⇒ `null`，调用点须判空再用） */
export function readHeader(session: unknown): Record<string, unknown> | null {
  if (!isPlainObjectLike(session)) return null
  const h = session.header
  return isPlainObjectLike(h) ? h : null
}

/** 宿主侧 agent preset id（唯一入口；缺失/类型不符 ⇒ `''`） */
export function readHeaderAgentPreset(session: unknown): string {
  const h = readHeader(session)
  return h !== null && isUsableString(h.agentPreset) ? h.agentPreset : ''
}

/**
 * 宿主侧 surface 节点序号数组（唯一入口）。
 *
 * 【为什么必须单源】此前 **16 处**跨 4 个包各写一遍，写法有 4 种
 * （裸读 `session.surface.nodes` / `?.` / `as` 断言 / 守卫收窄）。
 * 裸读那几处一旦官方改形状就抛，而它们都在 `agent/pre-step` 的 try 内
 * ⇒ **整轮 RP 注入静默失效**（世界书/预设/状态/记忆全不注入，用户看到的是
 * 「角色卡突然不好用了」，零报错）。
 */
export function readSurfaceNodes(session: unknown): readonly number[] {
  if (!isPlainObjectLike(session)) return []
  const surf = session.surface
  if (!isPlainObjectLike(surf)) return []
  const n = surf.nodes
  if (!Array.isArray(n)) return []
  return n.filter(x => typeof x === 'number') as readonly number[]
}

/**
 * 同 `readSurfaceNodes`，但**区分「缺失」与「空视图」**（返回 `null` = 字段缺席/非数组）。
 *
 * 【为什么要这个变体】多个回退/变体路由的守卫写 `Array.isArray(live.surface?.nodes)`：
 * 「`surface.nodes` 不是数组」= 会话未就绪 ⇒ 应报错，而「空数组」= 就绪但无消息
 * ⇒ 是合法状态（比如「会话全新，锚必然不在视图」应当按业务逻辑处理而非 409）。
 * 若统一用 `readSurfaceNodes`（空数组兜底），这两种情况就分不开了 —— 属 P-2
 * 「集合 vs 阈值」的孪生形态。需要这个区分时用本函数；否则用上面那个。
 */
export function readSurfaceNodesOrNull(session: unknown): readonly number[] | null {
  if (!isPlainObjectLike(session)) return null
  const surf = session.surface
  if (!isPlainObjectLike(surf)) return null
  const n = surf.nodes
  if (!Array.isArray(n)) return null
  return n.filter(x => typeof x === 'number') as readonly number[]
}

// ---------------------------------------------------------------------------
// 二、Chat 层
// ---------------------------------------------------------------------------

/** 官方 chat 投影（`useChat` 选择器的入参）里我们实际消费的面 */
export interface ProjectedChat {
  /** 节点顺序（key 列表） */
  order: readonly string[]
  /** 节点表（提供了 `.values()` 迭代器；官方形态未定型 ⇒ 只承诺「可迭代」） */
  nodes: { values: () => Iterable<unknown> } | null
}

/**
 * 从 chat 快照读 `order` + `nodes`（唯一入口）。
 *
 * 【收口理由】此前 10 处各自写 `chat?.order?.length ?? 0` 或
 * `for (const n of chat?.nodes?.values() ?? [])`。其中 `nodes` 的类型声明
 * 是 `{ values: () => Iterable }` —— 若官方把它改成**数组**（数组也有 `.values()`，
 * 但返回的是**元素**而非节点），这些点会**静默空转**（`?? []` 兜底）而非抛错，
 * 属 P-3 静默族。这里显式要求 `values` 是函数，否则当缺失。
 */
export function readChat(chatSnapshot: unknown): ProjectedChat {
  const c = isPlainObjectLike(chatSnapshot) ? chatSnapshot : {}
  const order = Array.isArray(c.order)
    ? (c.order.filter(x => typeof x === 'string') as readonly string[])
    : []
  const n = c.nodes
  const nodes = isPlainObjectLike(n) && typeof n.values === 'function'
    ? (n as unknown as { values: () => Iterable<unknown> })
    : null
  return { order, nodes }
}

/** 遍历 chat 节点（唯一入口；`nodes` 缺失/形态不符 ⇒ 空迭代，调用点不得裸调 `.values()`） */
export function forEachChatNode(
  chatSnapshot: unknown,
  fn: (node: unknown) => void,
): number {
  const { nodes } = readChat(chatSnapshot)
  if (nodes === null) return 0
  let n = 0
  for (const node of nodes.values()) { fn(node); n += 1 }
  return n
}

/**
 * 从**会话快照**读 chat 投影（唯一入口）。
 *
 * 【为什么单独一个函数】真机 fiber 实证（2026-09-06）：`SessionSnapshot` 与 `ChatSnapshot`
 * 是**两个不同的席位入参** —— `session.chat` 有时缺、有时在；`useChat` 拿到的才是
 * chat 本体（`nodes`/`order` 在顶层）。历史上调用点混用两种形态，
 * 写 `(snapshot as {...}).chat?.nodes?.values()` 这类双形态断言共 5 处。
 * 本函数把「会话快照里的 chat」这条读法收口；需要 chat 本体时直接 `readChat`。
 */
export function readSessionChat(sessionSnapshot: unknown): ProjectedChat {
  if (!isPlainObjectLike(sessionSnapshot)) return { order: [], nodes: null }
  return readChat(sessionSnapshot.chat)
}

/** 节点块的来源 kind（`data.source.kind`；唯一入口。user 消息真伪判定用：仅 'user' 算真人输入）。
 *  官方投影可能不给 `source` ⇒ `''`（视为「非真人输入」，不冒充 user）。 */
export function readSourceKind(data: unknown): string {
  if (!isPlainObjectLike(data)) return ''
  const s = data.source
  if (!isPlainObjectLike(s)) return ''
  return typeof s.kind === 'string' ? s.kind : ''
}

// ---------------------------------------------------------------------------
// 三、Chat 节点层
// ---------------------------------------------------------------------------

/** 节点 key（唯一入口；非字符串视为缺失 ⇒ `''`） */
export function readNodeKey(node: unknown): string {
  if (!isPlainObjectLike(node)) return ''
  return isUsableString(node.key) ? node.key : ''
}

/** 节点 kind（唯一入口；非字符串 ⇒ `''`，即「未知」，不冒充已知类型） */
export function readNodeKind(node: unknown): string {
  if (!isPlainObjectLike(node)) return ''
  return typeof node.kind === 'string' ? node.kind : ''
}

/**
 * 节点的 data（唯一入口；缺失/非对象 ⇒ `{}`，保证调用点永不抛）。
 *
 * 【为什么必须兜底成 `{}` 而不是 `null`】调用点大量写 `data.status` / `data.blocks`，
 * 若返回 `null` 就要求每处判空（48 处里已有一批漏判）。返回 `{}` 后所有字段读取
 * 都走下方各读取器取兜底值 ⇒ **结构性免疫**，而非依赖调用点自觉。
 */
export function readNodeData(node: unknown): Record<string, unknown> {
  if (!isPlainObjectLike(node)) return {}
  const d = node.data
  return isPlainObjectLike(d) ? d : {}
}

/**
 * 消息块列表（唯一入口；缺失/非数组 ⇒ 空数组，调用点不得裸迭代）。
 *
 * 官方两个字段名同义：assistant 节点用 `data.blocks`，user 节点用 `data.content`
 * （`type` 而非 `kind` 区分块类型——差异留在调用点）。此处按序取首个可用者。
 *
 * ## 【2026-09-16 W24b 引用稳定性修复】本函数**必须返回稳定引用**
 *
 * ### 症状（设备实测，可复现；M7 两次都卡在同一处）
 * M7 旅程跑到首卡 J4 之后**页面失去响应**：WebView 渲染进程 CPU 持续 **100%**，
 * CDP 连 `Runtime.evaluate("1+1")` 都超时。抓现场（`Debugger.pause` ×3）：
 * 三次里**两次**精确停在 `runDisplayScripts`，调用链是
 * `RpAssistantNodeView` → React `useMemo` → `runDisplayScripts`；而**静止态 CPU 0%**。
 *
 * ### 真因
 * `RpNativeChat.tsx` 的 `processed` useMemo 依赖数组里含 `blocks`：
 *     }, [blocks, proto, streaming, variantOverride, displayScripts, …])
 * 而 `blocks = readBlocks(data)`。本函数此前用 `v.filter(…)` **每次都新建数组**
 * ⇒ 即使 `data` 逐字段没变，deps 也判定为「变了」⇒ **useMemo 完全失效**
 * ⇒ 每个 assistant 楼层**每次渲染**都重跑 `runDisplayScripts`（该卡 14 条 display
 * 正则，含 `([\s\S]*)\[OS\]([\s\S]*)` / `([\s\S]*)<\/(think_?fox~?)>` 这类
 * **两头贪婪 + `[\s\S]*`** 的回溯敏感形态）× 50 楼层 ⇒ 主线程饱和。
 *
 * 离线决定性实验（`tmp/diag-blocks-identity.mjs`）：
 * ```
 * 同一 data 连续两次 readBlocks ⇒ 引用相同：**false**（期望 true）
 * 20 次「渲染」⇒ **20** 个不同引用 ⇒ useMemo 判定依赖变化 **20** 次（期望 1）
 * ```
 *
 * ### 修法（P-8 幂等 / P-1 单源：改在读取器里，不动任何调用点）
 *   ① 元素**全部合法** ⇒ 直接返回 `data.blocks` **原数组引用**（零拷贝 + 引用稳定）；
 *   ② 需要过滤（含非对象元素，罕见）⇒ 结果按**底层数组**缓存（`WeakMap`）
 *      ⇒ 同一数组多次调用仍是同一引用，且**不掩盖真实变化**（换数组 ⇒ 换引用）；
 *   ③ 缺失/非数组 ⇒ 返回**共享的冻结空数组**（原实现每次新建 `[]`，同样破坏稳定性）。
 * ⇒ 语义逐字不变（仍是「只含 plain object 的序列」），唯一变化是**引用稳定性**。
 */
const EMPTY_BLOCKS: readonly Record<string, unknown>[] = Object.freeze([]) as readonly Record<string, unknown>[]
/** 过滤结果按底层数组缓存（仅用于「含非对象元素」这条罕见分支） */
const filteredBlocksCache = new WeakMap<readonly unknown[], readonly Record<string, unknown>[]>()

function pickBlocks(v: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(v)) return EMPTY_BLOCKS
  // ① 全部元素合法 ⇒ 原引用直接可用（最常见路径，零拷贝）
  let allValid = true
  for (const item of v) {
    if (!isPlainObjectLike(item)) { allValid = false; break }
  }
  if (allValid) return v as readonly Record<string, unknown>[]
  // ② 需过滤 ⇒ 按底层数组缓存（引用稳定且不掩盖变化）
  const hit = filteredBlocksCache.get(v)
  if (hit !== undefined) return hit
  const out = v.filter(isPlainObjectLike) as readonly Record<string, unknown>[]
  filteredBlocksCache.set(v, out)
  return out
}

export function readBlocks(data: unknown): readonly Record<string, unknown>[] {
  if (!isPlainObjectLike(data)) return EMPTY_BLOCKS
  const b = pickBlocks(data.blocks)
  return b.length > 0 ? b : pickBlocks(data.content)
}

/** 节点 status（唯一入口；非字符串 ⇒ `''`，即「未知」，不冒充 settled） */
export function readNodeStatus(data: unknown): string {
  if (!isPlainObjectLike(data)) return ''
  const s = data.status
  return typeof s === 'string' ? s : ''
}

/** 节点 seq（唯一入口；非 number ⇒ `undefined`。user 消息的锚点） */
export function readNodeSeq(data: unknown): number | undefined {
  if (!isPlainObjectLike(data)) return undefined
  return typeof data.seq === 'number' ? data.seq : undefined
}

/**
 * 节点的**投影锚 seq**（`chatNode(context, kind, anchorSeq, …)` 的第 3 参；非 number ⇒ undefined）。
 *
 * 【2026-09-19 回退连带面修复】与 `readNodeSeq`（读 data.seq）不同：本函数读**节点信封**上的
 * `anchorSeq`，它才是 harness 运行过程节点的"归属位置"——
 *   · `system-prompt`（系统提示词）锚在 **turn/start**（真实会话实证：比用户消息还早）
 *   · `context`（上下文注入）锚在注入事件自身的 seq
 *   · `turn-error`（本轮运行失败）锚在失败事件（turn/end 一带）的 seq
 * 这三者都**不是** surface 事件，回退写的 `shadowedSeqs` 里没有它们，
 * 只有按本条 anchorSeq 落进回退区间才隐藏得掉（见 dsht-rp-ui 的 isSeqHidden）。
 */
export function readNodeAnchorSeq(node: unknown): number | undefined {
  const n = node as { anchorSeq?: unknown } | null | undefined
  if (n === null || n === undefined) return undefined
  return typeof n.anchorSeq === 'number' && Number.isFinite(n.anchorSeq) ? n.anchorSeq : undefined
}

/** 节点 turn（唯一入口；非 number ⇒ `undefined`） */
export function readNodeTurn(data: unknown): number | undefined {
  if (!isPlainObjectLike(data)) return undefined
  return typeof data.turn === 'number' ? data.turn : undefined
}

/** 节点 time（唯一入口；epoch ms，非 number ⇒ `undefined`） */
export function readNodeTime(data: unknown): number | undefined {
  if (!isPlainObjectLike(data)) return undefined
  return typeof data.time === 'number' ? data.time : undefined
}

/**
 * 定稿消息的 seq（唯一入口；非 number ⇒ `undefined`）。
 *
 * 这是**被读得最多的官方字段**（此前 11 处），也是回退/变体/耗时全部判据的锚点，
 * 类型错一次会连锁误判 ⇒ 必须单源。
 */
export function readFinalSeq(data: unknown): number | undefined {
  if (!isPlainObjectLike(data)) return undefined
  const f = data.finalNode
  if (!isPlainObjectLike(f)) return undefined
  return typeof f.seq === 'number' ? f.seq : undefined
}

/** 定稿消息的 messageId（唯一入口） */
export function readFinalMessageId(data: unknown): string | undefined {
  if (!isPlainObjectLike(data)) return undefined
  const f = data.finalNode
  if (!isPlainObjectLike(f)) return undefined
  return isUsableString(f.messageId) ? f.messageId : undefined
}

/**
 * 定稿消息的 timing（唯一入口；思考/工具轮耗时来源）。
 * 任一子字段类型不符 ⇒ 该子字段为 `null`（与官方可空语义一致），整体缺失 ⇒ `null`。
 */
export function readFinalTiming(data: unknown): { stepStartTime: number | null; completedTime: number | null } | null {
  if (!isPlainObjectLike(data)) return null
  const f = data.finalNode
  if (!isPlainObjectLike(f)) return null
  const t = f.timing
  if (!isPlainObjectLike(t)) return null
  return {
    stepStartTime: typeof t.stepStartTime === 'number' ? t.stepStartTime : null,
    completedTime: typeof t.completedTime === 'number' ? t.completedTime : null,
  }
}
