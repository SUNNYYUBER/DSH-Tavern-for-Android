/**
 * ./scripts/openai.js —— ST 聊天补全模块的**兼容实现**（T-63）
 * ============================================================================
 * 【为什么有这个文件】第三方卡的宿主注入脚本用 ES 静态 import 取四个符号
 * （卡的取用面实测 `tmp/t37-inject.js:2221`）：
 *   `promptManager` / `MessageCollection` / `Message` / `sendOpenAIRequest`
 * 静态 import 是原子的：任一符号取不到，整段 module 脚本不执行。
 *
 * 【卡的用法（逐处实测）】
 *   · `Message` / `MessageCollection` — 做 `instanceof` 判定（`:1843` / `:1847` / `:3038` / `:3044`）
 *   · `promptManager.messages.collection` — 读取消息树（`:3037-3038`）
 *   · `promptManager.preparePrompt` / `.setChatCompletion` — **被 patch 改写**（`:2256` / `:1921`）
 *   · `sendOpenAIRequest` — **只 import，从未调用**
 *
 * 【实现性质】**接口对齐 + 独立实现**。
 *   导出名、类名、方法名与调用契约按互操作需要对齐 ST 的公开 API；
 *   实现文本为本项目自行编写，未复制上游源码。
 *   兼容面的真正内容是**对外可观测行为**（见下），而不是代码形态。
 *
 * 【可观测契约（卡依赖的语义）】
 *   · `Message`：`identifier` / `role` / `content` / `name` / `tool_calls` /
 *     `signature` / `reasoning` / `tokens` 字段；`getTokens()`。
 *   · `MessageCollection`：构造器只接受 `Message` 或 `MessageCollection`（否则抛错，
 *     不静默吞）；`collection` 保序；`getChat()` 归并为 provider 形状的消息数组
 *     （空 content 且无 tool_calls 的条目**被跳过**；`role==='tool'` 补 `tool_call_id`）；
 *     `getCollection()` / `add()` / `getItemByIdentifier()` / `hasItemWithIdentifier()`。
 *   · `promptManager`：`messages` 是可读消息树（由真实预设投影装配）；
 *     `preparePrompt(prompt, original)` 返回加工后的 prompt；
 *     `setChatCompletion(chatCompletion)` 接收最终批。
 *
 * 【写侧通道】`promptManager` 的写侧动作（patch / setChatCompletion）与
 * `GENERATE_AFTER_DATA` 处理器，经**写侧通道**送达 node 侧装配点生效；
 * 通道不可用时出声降级（详见 `prompt-bridge` 与 TASK-LIST D-67-1）。
 */

const DSHT_TAVERN_HELPER = '/dsht-tavern-helper'

/** 已出声过的边界提示（按 key 去重，避免每轮刷屏） */
const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[dsht-st-module] ${message}`)
}

function currentSessionId() {
  try {
    const ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext
      ? globalThis.SillyTavern.getContext()
      : null
    const v = ctx && (ctx.getCurrentChatId ? ctx.getCurrentChatId() : ctx.chatId)
    return typeof v === 'string' ? v : ''
  } catch { return '' }
}

// ---------------------------------------------------------------------------
// Message —— 单条消息的载体（字段面见文件头契约）
// ---------------------------------------------------------------------------

export class Message {
  /**
   * @param {string} role
   * @param {string} content
   * @param {string} identifier
   * 卡需要能 `new`（否则其反射构造与 instanceof 判定失败）。
   */
  constructor(role, content, identifier) {
    this.identifier = identifier
    this.role = role || 'system'
    this.content = content
    this.name = undefined
    this.tool_calls = null
    this.signature = null
    this.reasoning = null
    this.tokens = 0
  }

  /**
   * 带 token 计数的构造。有 ST tokenizer 就用（**不另写一份**）；
   * 没有则用「字符数/4」的显式近似并出声 —— 不假装精确。
   */
  static async createAsync(role, content, identifier) {
    const m = new Message(role, content, identifier)
    if (typeof m.content === 'string' && m.content.length > 0) {
      const th = globalThis.SillyTavern && globalThis.SillyTavern.libs
        ? globalThis.SillyTavern.libs.tokenHandler
        : null
      if (th && typeof th.countAsync === 'function') {
        try { m.tokens = await th.countAsync({ role: m.role, content: m.content }) } catch { m.tokens = 0 }
      } else {
        m.tokens = Math.ceil(m.content.length / 4)
        warnOnce('tokens-approx', 'tokens 使用「字符数/4」近似（宿主页无 ST tokenizer）——仅为量级参考，不代表精确计数')
      }
    }
    return m
  }

  getTokens() { return this.tokens }
}

// ---------------------------------------------------------------------------
// MessageCollection —— 有序消息集合（可嵌套）
// ---------------------------------------------------------------------------

export class MessageCollection {
  constructor(identifier, ...items) {
    this.collection = []
    this.identifier = identifier
    for (const item of items) {
      if (!(item instanceof Message || item instanceof MessageCollection)) {
        // 契约：非法成员必须抛错（不静默吞 —— 否则调用方会拿到静默残缺的集合）
        throw new Error('Only Message and MessageCollection instances can be added to MessageCollection')
      }
    }
    this.collection.push(...items)
  }

  /**
   * 归并为 provider 形状的消息数组。
   * 语义要点（调用方依赖）：
   *   · 空 content 且无 tool_calls 的条目**跳过**（占位/纯结构节点不进请求）
   *   · 只带值的可选字段才出现（不产生 `name: undefined` 这类噪声键）
   *   · tool 席位必须带 `tool_call_id`（否则 provider 拒绝）
   */
  getChat() {
    const out = []
    for (const message of this.collection) {
      const hasBody = Boolean(message.content) || Boolean(message.tool_calls)
      if (!hasBody) continue
      const entry = { role: message.role, content: message.content }
      if (message.name) entry.name = message.name
      if (message.tool_calls) entry.tool_calls = message.tool_calls
      if (message.role === 'tool') entry.tool_call_id = message.identifier
      if (message.signature) entry.signature = message.signature
      if (message.reasoning) entry.reasoning = message.reasoning
      out.push(entry)
    }
    return out
  }

  getCollection() { return this.collection }

  add(item) { this.collection.push(item) }

  getItemByIdentifier(identifier) {
    return this.collection.find(item => item && item.identifier === identifier)
  }

  hasItemWithIdentifier(identifier) {
    return this.collection.some(item => item && item.identifier === identifier)
  }
}

// ---------------------------------------------------------------------------
// promptManager —— 读侧真数据；写侧经通道送到 node 侧装配点
// ---------------------------------------------------------------------------

/** 把 ST 形状的 prompt 数组构造成 Message / MessageCollection 树 */
function buildMessagesFromPrompts(prompts) {
  const list = Array.isArray(prompts) ? prompts : []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p || typeof p !== 'object') continue
    const role = typeof p.role === 'string' ? p.role : 'system'
    const content = typeof p.content === 'string' ? p.content : ''
    const identifier = typeof p.identifier === 'string' && p.identifier ? p.identifier : `prompt-${i}`
    const m = new Message(role, content, identifier)
    if (typeof p.name === 'string') m.name = p.name
    if (Array.isArray(p.tool_calls)) m.tool_calls = p.tool_calls
    items.push(m)
  }
  return new MessageCollection('root', ...items)
}

/**
 * 写侧通道客户端（懒加载；通道不可用时**出声降级**，不静默、不伪造）。
 * 与 `./prompt-bridge.js` 同源，避免多份实现。
 *
 * 注：宿主页也会**无条件装载**同一 URL 的该模块（见 `host-vendor.installCardWriteBridge`），
 * 此时这里直接命中同一模块实例（浏览器按 URL 缓存 ES module），不产生第二份状态。
 */
let bridgeApi = null
async function getBridge() {
  if (bridgeApi !== null) return bridgeApi
  try {
    bridgeApi = await import('./prompt-bridge.js')
  } catch (e) {
    warnOnce('bridge-import', `写侧通道模块加载失败（写侧动作将不出现在最终请求里）：${e && e.message}`)
    bridgeApi = false
  }
  return bridgeApi || null
}

const promptManager = {
  /** 消息树（读侧真数据；`loadMessages()` 后填充） */
  messages: new MessageCollection('root'),
  activePreset: undefined,

  /** 活跃分组角色（本项目一会话一角色 ⇒ 空数组，如实） */
  getActiveGroupCharacters() { return [] },

  /** 用真实预设投影刷新 `messages`（本模块加载时自动调一次；卡也可主动调） */
  async loadMessages() {
    try {
      const res = await fetch(`${DSHT_TAVERN_HELPER}/context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId() }),
      })
      const body = await res.json()
      const prompts = body && body.chatCompletionSettings ? body.chatCompletionSettings.prompts : []
      this.messages = buildMessagesFromPrompts(prompts)
      this.activePreset = body && body.presetName ? body.presetName : undefined
      return this.messages
    } catch (e) {
      warnOnce('loadmessages', `promptManager.loadMessages 失败（messages 保持空集合）：${e && e.message}`)
      return this.messages
    }
  },
}

/**
 * 写侧钩子的**实现槽**。卡会覆盖 `promptManager.preparePrompt` / `.setChatCompletion`
 * （实测 `inject.js:2256` / `:1921`）—— 这两个方法是**访问器属性**，
 * 卡一旦赋值（= patch）就**自动声明写侧兴趣**，通道随之启用（否则零开销）。
 */
let preparePromptImpl = function (prompt, original = null) {
  void original
  return prompt
}
let setChatCompletionImpl = function (chatCompletion) {
  void chatCompletion
  return promptManager
}

/** patch 命中即声明兴趣（零误报：只有卡真的赋值才会走到这里） */
function onWriteSidePatched(name) {
  void getBridge().then(bridge => {
    if (bridge && typeof bridge.declareWriteInterest === 'function') {
      bridge.declareWriteInterest(`patch promptManager.${name}`)
    }
  })
}

Object.defineProperty(promptManager, 'preparePrompt', {
  configurable: true,
  enumerable: true,
  get() { return preparePromptImpl },
  set(fn) {
    if (typeof fn !== 'function') return
    preparePromptImpl = fn
    onWriteSidePatched('preparePrompt')
  },
})

Object.defineProperty(promptManager, 'setChatCompletion', {
  configurable: true,
  enumerable: true,
  get() { return setChatCompletionImpl },
  set(fn) {
    if (typeof fn !== 'function') return
    setChatCompletionImpl = fn
    onWriteSidePatched('setChatCompletion')
  },
})

export { promptManager }

// 模块加载即装配一次读侧真数据（卡随后可随时重新调用）
void promptManager.loadMessages()

// ---------------------------------------------------------------------------
// sendOpenAIRequest —— 导出存在（卡 import 需要）；本项目生成在 node 侧
// ---------------------------------------------------------------------------

/**
 * 本项目不在浏览器侧直连 provider（生成由 node 侧的 agent 循环完成）。
 * 卡的实测取用面是**只 import、未调用**；故此处**明确 reject 并具名**，
 * 不返回假字符串 —— 诚实失败优于静默产出空回复。
 * 若卡确实需要一次性补全，应改用酒馆助手桥提供的 `generateRaw` / `generate`。
 */
export function sendOpenAIRequest(type, messages, signal, options) {
  void messages; void signal; void options
  const err = new Error(
    `sendOpenAIRequest 在本项目不可用（type=${String(type)}）：` +
    '生成在 node 侧完成，浏览器侧无 provider 栈。若需要一次性补全，' +
    '请改用 generateRaw / generate（已由酒馆助手桥提供）。',
  )
  warnOnce('sendopenairequest', err.message)
  return Promise.reject(err)
}

/** 同族常量（卡的取用面未用到；提供以免同族二次缺口） */
export const custom_prompt_post_processing_types = Object.freeze({
  NONE: 0, MERGE: 1, MERGE_TOOLS: 2, SEMI: 3, STRICT: 4, SINGLE: 5,
})

export const reasoning_effort_types = Object.freeze({
  auto: 'auto', low: 'low', medium: 'medium', high: 'high', min: 'min', max: 'max',
})

export const chat_completion_sources = Object.freeze({
  OPENAI: 'openai', CLAUDE: 'claude', WINDOW: 'window',
  OPENROUTER: 'openrouter', DEEPSEEK: 'deepseek', CUSTOM: 'custom',
})
