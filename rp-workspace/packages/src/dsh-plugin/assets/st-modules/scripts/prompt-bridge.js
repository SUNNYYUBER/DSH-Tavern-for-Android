/**
 * prompt-bridge.js —— 卡「写侧 prompt 改写」的双向通道客户端（T-63 / D-67-1）
 * ============================================================================
 * 【解决什么问题】第三方卡会做三件**写侧**动作：
 *   ① patch `promptManager.preparePrompt(prompt, original)`（逐条调用）
 *   ② patch `promptManager.setChatCompletion(chatCompletion)`（接收批对象）
 *   ③ 挂 `ctx.eventSource.makeLast(GENERATE_AFTER_DATA, d => { …改 d.prompt… })`
 * 这些动作都在**浏览器侧**执行，而本项目真正的 prompt 装配在 **node 侧**。
 * 没有通道时它们**静默失效**（卡以为改了、请求里没有）—— 本项目最忌的失败形态。
 *
 * 【通道形态：长轮询 RPC（node 发起、UI 执行、UI 回传）】
 *   ① UI 常驻一条 `POST /dsht-rp/prompt-bridge/pull`（**挂起**直到 node 有活或超时返回空）；
 *   ② node 在 `agent/pre-step`（唯一可变面）需要卡的改写时，把待改写批作为 pull 的响应发出；
 *   ③ UI 在本页把卡的三个处理器跑在该批上，把结果 `POST /dsht-rp/prompt-bridge/return`；
 *   ④ node 侧等待方拿到结果继续装配。
 *
 * 【形状】与 node 侧往返的是 **ST prompt 形状**（`{role, content: string, identifier}`）——
 * 那正是卡的三个钩子读写的东西。我方 `{role, content: Block[]}` 与它的互转在 node 侧
 * 完成（`prompt-bridge.ts` 的 `toStPrompts` / `fromStPrompts`），本文件不关心。
 *
 * 【三条防护（都是"提前做"，不是出事再补）】
 *   a. **零开销**：卡未声明写侧兴趣时，UI **不发任何请求**（无长轮询、无轮询），
 *      node 侧也不等待 ⇒ 绝大多数会话的生成延迟**一点都不变**。
 *   b. **有上界**：node 侧等待带**硬超时**（见 node 侧 `PROMPT_BRIDGE_TIMEOUT_MS`），
 *      超时即按"未改写"继续 ⇒ **不可能让生成卡死**。
 *   c. **可听降级**：UI 不在场 / pull 失败 / return 失败 / 处理抛错 —— 全部出声，
 *      并说明「会话、环节、原因」，不静默。
 *
 * 【兴趣的两条来源（互补，缺一不可）】
 *   · `promptManager` 的访问器 setter：卡 patch 时命中（动作 ①②）
 *   · `watchEventSourceForWriteInterest`：卡注册写侧事件时命中（动作 ③，**不碰 promptManager
 *     的卡只能靠这条**）；做成「回看已注册 + 包装后续注册」双路径，与装载顺序无关。
 *
 * 【为什么不用 WebSocket / SSE】调研结论：WebSocket 需扩展我方插件声明面
 * （`LikeWebServer` 无 `registerUpgrade`）且未取证；SSE 单向、仍需回传通道。
 * 长轮询在**既有请求-响应面**内即可实现，且宿主明文允许挂起响应
 * （`dsh-host-webserver/lib/types/index.d.ts:37` "may hold the response open, e.g. SSE"）。
 * 全程只占**一条**连接（不是每轮新建），对 WebView 每主机连接配额的压力最小。
 */

const BRIDGE = '/dsht-rp/prompt-bridge'

/** 卡的写侧处理器会订阅这些事件（注册它们 = 声明"本会话有卡在做写侧改写"） */
export const WRITE_SIDE_EVENTS = Object.freeze([
  'generate_after_data',
  'generation_after_combine_prompts',
  'chat_completion_settings_ready',
])

/** 是否已声明写侧兴趣（false ⇒ 本模块不发任何请求，零开销） */
let interestDeclared = false

/** 长轮询循环是否在跑（防重复启动） */
let loopRunning = false

/** 会话 id（每次请求带上，node 侧据此把批投给正确的等待方） */
function currentSessionId() {
  try {
    const ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext
      ? globalThis.SillyTavern.getContext()
      : null
    const v = ctx && (ctx.getCurrentChatId ? ctx.getCurrentChatId() : ctx.chatId)
    return typeof v === 'string' ? v : ''
  } catch { return '' }
}

/** 出声（按 key 去重，避免每轮刷屏；但**每种失败都至少响一次**，L42） */
const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[dsht-prompt-bridge] ${message}`)
}

/**
 * 声明"本会话有卡要做写侧改写"，并按需启动长轮询循环。
 * 由宿主事件总线在**卡注册写侧监听**时调用（见 `watchEventSourceForWriteInterest`），
 * 也可由 `promptManager.setChatCompletion` / `preparePrompt` 的访问器直接调用。
 */
export function declareWriteInterest(reason) {
  if (interestDeclared) return
  interestDeclared = true
  console.info(`[dsht-prompt-bridge] 检测到卡的写侧改写需求（${reason}）——启用改写通道`)
  startLoop()
}

/** 是否已声明（node 侧与单测的判据） */
export function hasWriteInterest() {
  return interestDeclared
}

/**
 * 监听宿主 `eventSource`，在**卡注册写侧事件**时自动声明兴趣。
 *
 * 【为什么需要这条路】卡的三个写侧动作里，只有两项走 `promptManager`（那两项由访问器
 * setter 捕获）。**第三项只挂事件、不碰 promptManager**（实测 `inject.js:3109/3129`
 * `makeLast(GENERATE_AFTER_DATA, handleChatCompletionPromptReady)`）—— 若只靠 setter，
 * 这类卡**永远不声明兴趣**，通道对它形同不存在。
 *
 * 【两条覆盖路径（互补，缺一不可）】
 *   ① **回看**：本函数执行时若 `events['generate_after_data']` 已有非我方监听器
 *      ⇒ 卡已注册（它比本模块先到）⇒ 立即声明。
 *   ② **前看**：包装 `on/once/makeFirst/makeLast`，此后卡的注册被捕获 ⇒ 声明。
 *
 * 【顺序无关性】卡自己也包装 `eventSource.on`（`inject.js:2981-2999`）。无论谁的包装在外，
 * 每次注册最终都会经过我方包装（包装链不短路注册），故两种情况都能捕获。
 * 包装**不改变**原语义（透传全部实参与返回值），只是旁听。
 */
export function watchEventSourceForWriteInterest() {
  let es = null
  try {
    const ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext
      ? globalThis.SillyTavern.getContext()
      : null
    es = ctx && ctx.eventSource
  } catch { es = null }
  if (!es || typeof es.on !== 'function' || es.__dshtWriteInterestWatched) return

  // ① 回看：卡已先注册（我方加载晚于卡）
  for (const name of WRITE_SIDE_EVENTS) {
    const list = es.events && es.events[name]
    if (Array.isArray(list) && list.length > 0) {
      declareWriteInterest(`已注册的 ${name} 监听器`)
      break
    }
  }

  // ② 前看：包装注册方法（透传语义，只旁听）
  const watched = new Set(WRITE_SIDE_EVENTS)
  for (const method of ['on', 'once', 'makeFirst', 'makeLast']) {
    const original = es[method]
    if (typeof original !== 'function') continue
    es[method] = function (event, listener) {
      if (watched.has(String(event))) declareWriteInterest(`注册 ${String(event)} 监听器`)
      return original.apply(this, arguments)
    }
  }
  Object.defineProperty(es, '__dshtWriteInterestWatched', { value: true })
}

/**
 * 在指定批上跑卡的写侧处理器。
 *
 * 【形状契约（逐条对卡实测，`tmp/t37-inject.js` 为取证源）】
 *   ① `GENERATE_AFTER_DATA`：载荷 `{ prompt: StPrompt[] }`，卡读 `data.prompt` 并
 *      **就地改**（`:3002` 先 `Array.isArray(data?.prompt)` 守卫；`:3027` `data.prompt.length=0;
 *      push(...)`；`:3032` `squashPrompts(data.prompt)`）。
 *   ② `promptManager.preparePrompt(prompt, original)`：**逐条**调用（`:2256`），
 *      `prompt` 是**单条** `{role, content: string, identifier}`，`original` 是可选字符串；
 *      返回值是加工后的**单条**（卡在内部 `Reflect.construct(PromptClass, [prompt])` 造类实例）。
 *   ③ `promptManager.setChatCompletion(chatCompletion)`：入参是带 `.messages`（MessageCollection）
 *      与 `.getChat()` 的对象（`:1922`）；卡会**包装 `chatCompletion.getChat`**，改写发生在
 *      它被调用时（`:1930-1938`）。
 *
 * 【返回】以 `getChat()` 的结果为准 —— 那是"最终要发给模型的东西"，也正是卡的目标面。
 */
async function applyCardWriteSide(promptArray) {
  const ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext
    ? globalThis.SillyTavern.getContext()
    : null
  let work = promptArray

  // ① GENERATE_AFTER_DATA（卡就地改 data.prompt）
  const es = ctx && ctx.eventSource
  if (es && typeof es.emit === 'function') {
    const payload = { prompt: work }
    await es.emit('generate_after_data', payload)
    if (Array.isArray(payload.prompt)) work = payload.prompt
  }

  const mod = await import('./openai.js')
  const pm = mod && mod.promptManager
  if (!pm) return work

  // ② preparePrompt：**逐条**（卡实现按单条契约读写）
  if (typeof pm.preparePrompt === 'function') {
    const next = []
    for (const one of work) {
      const single = { role: one.role, content: one.content, identifier: one.identifier }
      let after = single
      try {
        const r = await pm.preparePrompt(single, null)
        if (r && typeof r === 'object') after = r
      } catch (e) {
        warnOnce('prepare-prompt', `卡的 preparePrompt 抛错（该条按原样继续）：${e && e.message}`)
      }
      next.push({
        role: typeof after.role === 'string' ? after.role : one.role,
        content: typeof after.content === 'string' ? after.content : one.content,
        identifier: typeof after.identifier === 'string' && after.identifier ? after.identifier : one.identifier,
      })
    }
    work = next
  }

  // ③ setChatCompletion：给卡一个带 getChat() 的 MessageCollection 形状
  if (typeof pm.setChatCompletion === 'function' && typeof mod.MessageCollection === 'function'
      && typeof mod.Message === 'function') {
    const items = work.map((p, i) => {
      const m = new mod.Message(p.role, p.content, p.identifier || `prompt-${i}`)
      if (typeof p.name === 'string') m.name = p.name
      return m
    })
    const collection = new mod.MessageCollection('root', ...items)
    const chatCompletion = {
      messages: collection,
      getChat: function () { return collection.getChat() },
    }
    try {
      await pm.setChatCompletion(chatCompletion)
      // 卡可能包装了 getChat（结构化消息注入就走这条）⇒ 以**调用结果**为准
      if (typeof chatCompletion.getChat === 'function') {
        const chat = await chatCompletion.getChat()
        if (Array.isArray(chat) && chat.length > 0) {
          work = chat.map((c, i) => ({
            role: typeof c.role === 'string' ? c.role : 'system',
            content: typeof c.content === 'string' ? c.content : '',
            identifier: typeof c.identifier === 'string' && c.identifier
              ? c.identifier
              : (work[i] && work[i].identifier) || `prompt-${i}`,
            ...(c.name ? { name: c.name } : {}),
            ...(c.tool_calls ? { tool_calls: c.tool_calls } : {}),
          }))
        }
      }
    } catch (e) {
      warnOnce('set-chat-completion', `卡的 setChatCompletion 抛错（该步改写未生效）：${e && e.message}`)
    }
  }

  return work
}

/** 单轮：pull（可能挂起）→ 本地处理 → return */
async function oneRound() {
  const res = await fetch(`${BRIDGE}/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId() }),
  })
  if (!res.ok) throw new Error(`pull HTTP ${res.status}`)
  const body = await res.json()
  if (!body || body.hasWork !== true) return // 空转（node 侧无活）—— 正常，继续下一轮
  const round = body.round
  const incoming = Array.isArray(body.prompt) ? body.prompt : []
  let outgoing = incoming
  try {
    outgoing = await applyCardWriteSide(incoming)
  } catch (e) {
    warnOnce('apply-fail', `卡的写侧处理器抛错（本轮按未改写处理）：${e && e.message}`)
    outgoing = incoming
  }
  const ret = await fetch(`${BRIDGE}/return`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId(), round, prompt: outgoing }),
  })
  if (!ret.ok) throw new Error(`return HTTP ${ret.status}`)
}

/** 长轮询循环：串行不重叠；失败后退避，不刷屏也不静默 */
function startLoop() {
  if (loopRunning) return
  loopRunning = true
  const tick = async () => {
    if (!interestDeclared) { loopRunning = false; return }
    try {
      await oneRound()
      backoffMs = 0
    } catch (e) {
      // 通道不可用（UI 刚起 / node 重载 / 网络抖动）→ 出声一次 + 退避重试
      warnOnce('loop-fail', `改写通道本轮失败（将退避重试；期间的生成不含卡的改写）：${e && e.message}`)
      backoffMs = Math.min(backoffMs === 0 ? 1000 : backoffMs * 2, 10000)
      await new Promise(r => setTimeout(r, backoffMs))
    }
    if (interestDeclared) void tick()
    else loopRunning = false
  }
  void tick()
}
let backoffMs = 0

/** 单测用：复位内部状态 */
export function __resetPromptBridge() {
  interestDeclared = false
  loopRunning = false
  backoffMs = 0
  warned.clear()
}
