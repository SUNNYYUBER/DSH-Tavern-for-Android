/**
 * TavernHelper 脚本运行时 shim + postMessage 桥协议——纯逻辑（可单测，不依赖 react/DOM）。
 *
 * 架构（对照真酒馆助手 JS-Slash-Runner）：
 * - 真 TH：每 enabled 脚本一个隐藏 srcdoc iframe，window.parent 同源注入
 *   window.TavernHelper / _ / $ / SillyTavern.getContext / Mvu。
 * - 本移植：sandbox = allow-scripts + allow-same-origin（复刻真 TH 同源形态，用户拍板
 *   放开——srcdoc + 这两个 token = 与宿主同源，脚本可直接摸 window.parent 全局），
 *   shim 经 postMessage 桥到宿主页面，再调 /dsht-tavern-helper/* 数据面路由（桥协议
 *   不变：postMessage 跨源/同源都可用，同源只是额外放开 parent DOM/全局访问）。
 * - iframe 视口铺满 RP 聊天视图（position:fixed inset:0, pointer-events:none）——
 *   脚本自渲染的 position:fixed 部件视觉落在视口等效位置（ST 顶层注入的等效观感）；
 *   交互走脚本按钮（button.buttons，宿主浮球面板渲染，点击回投按钮事件）。
 *
 * 桥协议（全部消息带 __dsht_th:true + secret + scriptId）：
 *   iframe → host：{th:'call', callId, api, args}       API 调用（幂等、host 侧 console 可追溯）
 *                   {th:'status', phase, error?}        脚本状态（loading→running / failed）
 *                   {th:'missing', api}                 调到 shim 没有的 API（记名）
 *                   {th:'toast', level, message}        toastr 提示
 *                   {th:'ui', hasUi}                    脚本渲染了自有 UI
 *   host → iframe：{th:'result', callId, ok, value?|error?}  调用回包
 *                   {th:'event', eventType, args}       会话事件投递（MESSAGE_* / GENERATION_* / 按钮事件）
 *                   {th:'context', context}             上下文快照推送（getContext / SillyTavern.getContext 同步读）
 */

// vendor（构建期生成，scripts/build-rp-ui.mjs → th-vendor.gen.txt）：jQuery + zod v4 的
// minify iife 源码字符串。真 TH 脚本 iframe 与宿主 same-origin（predefine.js 合并宿主的
// z = zod v4、parent_jquery.js 直接共享宿主 $）。本 iframe 同样内嵌一份 vendor：
// window.$/jQuery/Zod/z 独立就绪，不依赖宿主注入时序（「变量结构 0628」卡的 MVU schema
// 需要 zod v4 的 .prefault，「飞讯 0703」卡要 window.$）。构建期内嵌后作为 iframe
// 第一个 <script> 注入。
// 体积账：minify 后 ~400KB/份，每脚本 iframe 的 srcdoc 各嵌一份——换 window.$/jQuery/Zod/z
// 就绪，可接受。
import thVendorSource from './th-vendor.gen.txt?raw'
import { deepMergeIncoming } from '../../../dsht-plugin-shared/deep-merge.ts'
// 【心跳 65 · T-75】`mainApi` 取值单源（同时被宿主面 host-vendor.ts 使用）。
// 插值进模板串（与 opts.version 同一手法），保证宿主面/帧面**不可能漂移**。
import { DSHT_MAIN_API } from '../../../dsht-plugin-shared/st-compat.ts'

// ---------------------------------------------------------------------------
// 协议常量与类型
// ---------------------------------------------------------------------------

export const TH_MSG_TAG = '__dsht_th'

export interface SessionScript {
  id: string
  name: string
  content: string
  buttonEnabled: boolean
  buttons: Array<{ name: string; visible: boolean }>
  data: Record<string, unknown>
  source: 'preset' | 'character'
}

export type ScriptPhase = 'loading' | 'running' | 'failed'

export interface ScriptStatus {
  phase: ScriptPhase
  /** phase=failed 的原因 / running 时的最近运行时错误（诚实展示，不翻转状态） */
  error?: string | undefined
  /** 调了 shim 未覆盖的 API（记名清单，脚本管理面板展示） */
  missing: string[]
  /** 脚本渲染了自有 UI（iframe 内有可见内容） */
  hasUi?: boolean | undefined
  buttons: Array<{ name: string; visible: boolean }>
}

export interface BridgeCallMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'call'
  callId: number
  api: string
  args: unknown[]
}

export interface BridgeStatusMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'status'
  phase: ScriptPhase
  error?: string
}

export interface BridgeMissingMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'missing'
  api: string
}

export interface BridgeToastMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'toast'
  level: string
  message: string
}

export interface BridgeUiMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'ui'
  hasUi: boolean
  /** 脚本 UI 的并集矩形（iframe 内视口坐标；host 按它 resize iframe——只包住 UI） */
  rect?: { x: number; y: number; w: number; h: number }
}

/** iframe console 转发（C15 日志抽屉：shim 包装 console.*，shim 侧已字符串化） */
export interface BridgeConsoleMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'console'
  level: string
  message: string
}

/** 脚本运行期错误（仅诊断记录，不翻转 phase——2026-09-07 根修） */
export interface BridgeScriptErrorMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'script-error'
  error: string
}

export type BridgeIncoming = BridgeCallMsg | BridgeStatusMsg | BridgeMissingMsg | BridgeToastMsg | BridgeUiMsg | BridgeConsoleMsg | BridgeScriptErrorMsg

// ---------------------------------------------------------------------------
// 上下文 / 预设 / 消息 / 正则 / 世界书 数据形状（/dsht-tavern-helper/* 路由契约的宿主侧投影）
// ---------------------------------------------------------------------------

/** 预设 prompt（ST prompt_manager 形状子集） */
export interface ThPresetPrompt {
  identifier?: string
  name?: string
  role?: string
  content?: string
  system_prompt?: boolean
  marker?: boolean
  injection_position?: unknown
  injection_depth?: number
  [key: string]: unknown
}

/** prompt_order 单条（enabled 开关） */
export interface ThPromptOrderItem {
  identifier: string
  enabled: boolean
}

/** prompt_order 分组（ST 按角色 id 分组，DSH 只用第一组） */
export interface ThPromptOrder {
  character_id?: number
  order: ThPromptOrderItem[]
}

/** 预设（prompts + prompt_order） */
export interface ThPreset {
  name?: string
  prompts?: ThPresetPrompt[]
  prompt_order?: ThPromptOrder[]
  [key: string]: unknown
}

/** 聊天消息（/chat/messages 投影；message_id 为楼层号；seq = 会话日志事件锚——写路径 update 用） */
export interface ThChatMessage {
  message_id: number
  name?: string
  role?: string
  message?: string
  is_system?: boolean
  seq?: number
  [key: string]: unknown
}

/**
 * 上下文快照（宿主组装：/context 响应 + /chat/messages 响应 + slug），
 * 经 {th:'context'} 推送进 iframe，getContext() / SillyTavern.getContext() 同步读。
 */
export interface ThContextSnapshot {
  presetId?: string | null
  presetName?: string | null
  character?: { name?: string } | null
  /** 当前角色绑定的 primary 世界书名（宿主从 rp/workspaces 取；getCharWorldbookNames 同步读） */
  characterLorebook?: string | null
  /**
   * `chatCompletionSettings.extensions.regex_scripts` = ST 1.13.5+ 的**预设内嵌正则**通道。
   * 宿主脚本按 `versionNumber >= 11305` 分叉后只认它（真 ST 原文注释
   * 「11305+ has built-in regex binding; ST is source of truth」），
   * 形状 = ST 内部 RegexScript（camelCase，含必填 `id`）——**不是** TH 公开 API 的
   * `TavernRegex`（snake_case，见 `tavern_regex.d.ts`），两者不可混用。
   */
  chatCompletionSettings?: {
    prompts?: ThPresetPrompt[]
    prompt_order?: ThPromptOrder[]
    extensions?: { regex_scripts?: Array<Record<string, unknown>> }
  }
  /** 当前 RP 工作区 slug（replaceTavernRegexes character 作用域需要） */
  slug?: string | null
  /**
   * 【心跳 58 · T-42】GLOBAL 作用域正则（ST 内部 camelCase 形状，`RegexScriptData[]`）。
   * 宿主 `extension_settings.regex` 的种子来源——与 `chatCompletionSettings.extensions.regex_scripts`
   *（预设内嵌通道）是**两棵独立的树**（基准 `engine.js:108-133` 的 getScriptsByType 三源分明）。
   */
  extensionSettingsRegex?: Array<Record<string, unknown>>
  messages?: ThChatMessage[]
  /**
   * 【心跳 64】用户名 —— 真 ST 全局 `name1` 与 `getContext().name1` 的**同一来源**。
   *
   * 宿主从**同步宏环境**（`getHostMacroEnv().user`，即用户 persona 名）并入本字段；
   * 宏环境是**异步水合**的 ⇒ 首帧可能缺省，水合完成后宿主**重推快照**补齐。
   *
   * 为什么必须补（实测用法，非推断）：
   * - `SillyTavern.name1` 顶层直取 —— `世界书控制 0708`（**当前活跃卡**）
   *   `(typeof SillyTavern !== "undefined") ? SillyTavern.name1 : "User"`
   *   **只有对象级守卫、无属性级守卫** ⇒ 守卫通过但取到 `undefined` ⇒ 渲染出 `"undefined: 内容"`。
   * - `getContext().name1` —— `飞讯 0703`（**当前活跃卡**）
   *   `(typeof SillyTavern !== 'undefined' && SillyTavern.getContext().name1) ? … : '{{user}}'`
   *   ⇒ 落到兜底**字面量** `{{user}}`（未展开的宏）。
   * 基准 `getContext()` 含 `name1`（`st-context.js:120-121`，宿主面 40 成员里两者都在）。
   */
  userName?: string
  [key: string]: unknown
}

/** host → iframe 上下文快照推送 */
export interface BridgeContextPushMsg {
  [TH_MSG_TAG]: true
  secret: string
  scriptId: string
  th: 'context'
  context: ThContextSnapshot
}

/** 入站消息解析（非法/伪造消息返回 null；secret 校验调用方做） */
export function parseIncomingMessage(data: unknown): BridgeIncoming | null {
  if (data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d[TH_MSG_TAG] !== true) return null
  if (typeof d.scriptId !== 'string' || typeof d.secret !== 'string') return null
  if (d.th === 'call') {
    if (typeof d.callId !== 'number' || typeof d.api !== 'string' || !Array.isArray(d.args)) return null
    return d as unknown as BridgeCallMsg
  }
  if (d.th === 'status') {
    if (d.phase !== 'loading' && d.phase !== 'running' && d.phase !== 'failed') return null
    return d as unknown as BridgeStatusMsg
  }
  if (d.th === 'missing' && typeof d.api === 'string') return d as unknown as BridgeMissingMsg
  if (d.th === 'script-error' && typeof d.error === 'string') return d as unknown as BridgeScriptErrorMsg
  if (d.th === 'toast' && typeof d.message === 'string') return d as unknown as BridgeToastMsg
  if (d.th === 'ui') return d as unknown as BridgeUiMsg
  if (d.th === 'console' && typeof d.level === 'string' && typeof d.message === 'string') return d as unknown as BridgeConsoleMsg
  return null
}

// ---------------------------------------------------------------------------
// 按钮事件 id（对照 ST getStringHash + 真 TH getButtonId：${scriptId}_${hash(name)}）
// ---------------------------------------------------------------------------

/** ST public/scripts/utils.js getStringHash 同款（Java string hash） */
export function getStringHash(str: string): number {
  let hash = 0
  if (!str.length) return hash
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

export function getButtonEventId(scriptId: string, buttonName: string): string {
  return `${scriptId}_${getStringHash(buttonName)}`
}

// ---------------------------------------------------------------------------
// 支持 / 不支持 API 清单（诚实面：不支持的挂 stub，调了记名 + reject）
// ---------------------------------------------------------------------------

/** 事件常量（【实机审计修复 2026-09-05】C6：对齐真 TH tavern_events 全表 82 项——
 * 名值逐项抄自 ST 扩展 @types/iframe/event.d.ts 的导出（含 CHARACTER_DELETED:'characterDeleted'
 * / CHARACTER_MANAGEMENT_DROPDOWN:'charManagementDropdown' 等不规则值）；常量本身无依赖，全量给出） */
export const TAVERN_EVENTS: Record<string, string> = {
  APP_READY: 'app_ready',
  EXTRAS_CONNECTED: 'extras_connected',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
  MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
  MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  MORE_MESSAGES_LOADED: 'more_messages_loaded',
  IMPERSONATE_READY: 'impersonate_ready',
  CHAT_CHANGED: 'chat_id_changed',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATION_STARTED: 'generation_started',
  GENERATION_STOPPED: 'generation_stopped',
  GENERATION_ENDED: 'generation_ended',
  SD_PROMPT_PROCESSING: 'sd_prompt_processing',
  EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
  EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
  SETTINGS_LOADED: 'settings_loaded',
  SETTINGS_UPDATED: 'settings_updated',
  MOVABLE_PANELS_RESET: 'movable_panels_reset',
  SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
  SETTINGS_LOADED_AFTER: 'settings_loaded_after',
  CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
  CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
  OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
  OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
  OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
  OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
  WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
  WORLDINFO_UPDATED: 'worldinfo_updated',
  CHARACTER_EDITOR_OPENED: 'character_editor_opened',
  CHARACTER_EDITED: 'character_edited',
  CHARACTER_PAGE_LOADED: 'character_page_loaded',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  FORCE_SET_BACKGROUND: 'force_set_background',
  CHAT_DELETED: 'chat_deleted',
  CHAT_CREATED: 'chat_created',
  GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  GENERATE_AFTER_DATA: 'generate_after_data',
  WORLD_INFO_ACTIVATED: 'world_info_activated',
  TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
  CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
  CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
  CHARACTER_DELETED: 'characterDeleted',
  CHARACTER_DUPLICATED: 'character_duplicated',
  CHARACTER_RENAMED: 'character_renamed',
  CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
  SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
  STREAM_TOKEN_RECEIVED: 'stream_token_received',
  STREAM_REASONING_DONE: 'stream_reasoning_done',
  FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
  WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
  OPEN_CHARACTER_LIBRARY: 'open_character_library',
  ONLINE_STATUS_CHANGED: 'online_status_changed',
  IMAGE_SWIPED: 'image_swiped',
  CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
  CONNECTION_PROFILE_CREATED: 'connection_profile_created',
  CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
  CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
  TOOL_CALLS_PERFORMED: 'tool_calls_performed',
  TOOL_CALLS_RENDERED: 'tool_calls_rendered',
  CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
  SECRET_WRITTEN: 'secret_written',
  SECRET_DELETED: 'secret_deleted',
  SECRET_ROTATED: 'secret_rotated',
  SECRET_EDITED: 'secret_edited',
  PRESET_CHANGED: 'preset_changed',
  PRESET_DELETED: 'preset_deleted',
  PRESET_RENAMED: 'preset_renamed',
  PRESET_RENAMED_BEFORE: 'preset_renamed_before',
  MAIN_API_CHANGED: 'main_api_changed',
  WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
  WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
  MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
}

/** iframe 生命周期事件（【实机审计修复 2026-09-05】C6：补 generate 通道与流式 token 四项，
 * 名值抄自真 TH iframe_events 导出） */
export const IFRAME_EVENTS: Record<string, string> = {
  MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
  MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
  GENERATION_STARTED: 'js_generation_started',
  STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
  GENERATION_ENDED: 'js_generation_ended',
}

/** shim 本地实现（不过桥）的 API */
export const SHIM_LOCAL_APIS = [
  'eventOn', 'eventOnce', 'eventEmit', 'eventEmitAndWait', 'eventRemoveListener',
  'eventClearEvent', 'eventClearAll', 'eventMakeFirst', 'eventMakeLast',
  'eventClearListener',
  'eventOnButton', 'getButtonEvent',
  'getVariables', 'getAllVariables', 'insertVariables', 'insertOrAssignVariables',
  'updateVariablesWith', 'replaceVariables', 'deleteVariable',
  'getScriptButtons', 'replaceScriptButtons', 'updateScriptButtonsWith', 'appendInexistentScriptButtons',
  'getTavernHelperVersion', 'getTavernVersion', 'getScriptId', 'getScriptName',
  'getCurrentCharPrimaryLorebook', 'getCharWorldbookNames',
  // C18 杂项 / C17 音频
  'getLastMessageId', 'triggerSlash', 'audio',
] as const

/**
 * 经桥实现的 API（iframe 内函数 → call('xxx') 走 host 数据面 /dsht-tavern-helper/*）。
 * 与 SHIM_LOCAL_APIS 一样挂为裸全局（真 TH predefine.js 行为）。
 */
export const SHIM_BRIDGE_APIS = [
  'getContext',
  // 预设 CRUD + prompt 判定
  'getPresetNames', 'getPreset', 'getLoadedPresetName', 'presetExists', 'createPreset', 'createOrReplacePreset',
  'replacePreset', 'setPreset', 'deletePreset', 'renamePreset', 'loadPreset', 'updatePresetWith',
  'isPresetNormalPrompt', 'isPresetPlaceholderPrompt', 'isPresetSystemPrompt',
  // 聊天消息只读 / 正则 / 世界书只读
  'getChatMessages', 'getChatMessage',
  'getTavernRegexes', 'replaceTavernRegexes',
  'getWorldbooks', 'getLorebookEntries', 'updateWorldbookWith',
  // C7 schema 注册 / C8 prompt 注入 / C9 生成通道
  'registerVariableSchema', 'injectPrompts', 'uninjectPrompts',
  'generate', 'generateRaw',
  // 【P3a 2026-09-07】聊天写路径桥（飞讯等卡脚本的统合记录落盘）——append 走完整 turn
  // 物化（idle）/ 裸消息（busy）；update 走 compaction/prune + replace 单节点官方原语
  'createChatMessages', 'setChatMessages',
  // 【实机审计修复 2026-09-05】P1/P2 长尾：楼层范围读 / 正则套件 / 世界书写面 / 历史简报 / 宏
  'getChatHistoryBrief', 'getChatHistoryDetail',
  'updateTavernRegexesWith', 'formatAsTavernRegexedString', 'isCharacterTavernRegexesEnabled',
  'getWorldbook', 'replaceLorebookEntries', 'rebindGlobalWorldbooks', 'rebindCharWorldbooks', 'getOrCreateChatWorldbook',
  'substitudeMacros',
] as const

/**
 * 已知但不支持的 API（挂 stub：console.warn 记名 + Promise.reject）。
 * 都是深度钩 ST 内部组件或与宿主数据模型冲突的面（chat 写路径 / 扩展管理 / 世界书写路径）。
 * 预设 CRUD / 聊天消息读 / 正则 / 世界书名单与条目读 / getContext 已移植为真实现（见 SHIM_BRIDGE_APIS）。
 * 生成控制只移植一次性补全（generate/generateRaw → /dsht-rp/llm/classify；C9）——生成管线
 * 控制（stop/模型清单/代理）仍记名拒绝；prompt 注入为存储面真实现（C8）；斜杠命令走
 * triggerSlash 最小映射（C18）；音频走 audio.bgm/ambient（C17）。
 *
 * 【D1 2026-09-13】清单已抽到 shared 层（`dsht-plugin-shared/th-api-support.ts`）——
 * 理由：导入预览（node 侧）需要同一份清单做「能力预检」，两处各写一份必然漂移。
 * 此处改为再导出，保持既有 import 点不变（`th-shim.ts` 仍是客户端消费入口）。
 */
import { TH_UNSUPPORTED_APIS as UNSUPPORTED_APIS } from '../../../dsht-plugin-shared/th-api-support.ts'
export { UNSUPPORTED_APIS }


/**
 * 记名拒绝的逐 API 理由（shim stub 的错误消息引用；未列出的 API 用通用理由）。
 * 聊天消息写路径拒绝理由要点：DSH 会话日志是 append-only，写历史与宿主记录有损漂移。
 */
export const UNSUPPORTED_REASONS: Record<string, string> = {
  setChatMessage: 'DSH 会话日志 append-only，改写历史会与宿主记录有损漂移——单条改写请用 setChatMessages（走 replace 原语）',
  deleteChatMessages: 'DSH 会话日志 append-only，删除历史消息会与宿主记录有损漂移',
  rotateChatMessages: 'DSH 会话日志无 swipe 分支树，消息轮转会与宿主记录有损漂移',
}

// ---------------------------------------------------------------------------
// shim 源码生成（iframe 内执行；桥的另一端是 RpScriptHost）
// ---------------------------------------------------------------------------

export interface ShimOptions {
  scriptId: string
  scriptName: string
  /** 会话级运行时密钥（防伪消息；每运行时随机） */
  secret: string
  /** 移植版本标识（getTavernHelperVersion 返回值） */
  version: string
}

/**
 * shim 源码：装在脚本 module 之前。API 面 = window.TavernHelper（Proxy）+ 同名裸全局
 * （真 TH predefine.js 行为：所有 API 同时是 bare global，脚本写 getVariables(...) 不带前缀）。
 *  shim 内不嵌模板字符串（避免与宿主生成代码的 ${} 冲突）。
 */
export function buildShimSource(opts: ShimOptions): string {
  const tavernEventsJs = JSON.stringify(TAVERN_EVENTS)
  const iframeEventsJs = JSON.stringify(IFRAME_EVENTS)
  const unsupportedJs = JSON.stringify(UNSUPPORTED_APIS)
  const unsupportedReasonsJs = JSON.stringify(UNSUPPORTED_REASONS)
  const bareGlobalsJs = JSON.stringify([...SHIM_LOCAL_APIS, ...SHIM_BRIDGE_APIS])
  return `(function () {
'use strict';
// ---- localStorage/sessionStorage 沙箱垫 ----
// 真 TH 脚本 iframe 与宿主同源，原生 localStorage 直接可用；本 iframe 现也放开
// allow-same-origin（复刻真 TH 同源形态），原生 localStorage 探测成功 → 垫自动不遮蔽
// （dshtGuardStorage 只在访问抛 SecurityError 时才装内存实现——opaque origin 场景的
// 跨形态兜底，同源形态下原生存储读写正常且跨刷新持久化）。
function dshtMakeMemoryStorage() {
  var m = {};
  return {
    getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[String(k)] = String(v); },
    removeItem: function (k) { delete m[String(k)]; },
    clear: function () { m = {}; },
    key: function (i) { var ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; },
    get length() { return Object.keys(m).length; },
  };
}
function dshtGuardStorage(name) {
  try { return window[name].getItem('__dsht_probe__') === undefined; } catch (e) {
    try { Object.defineProperty(window, name, { value: dshtMakeMemoryStorage(), configurable: true }); } catch (e2) {}
  }
  return undefined;
}
dshtGuardStorage('localStorage');
dshtGuardStorage('sessionStorage');
var SCRIPT_ID = ${JSON.stringify(opts.scriptId)};
var SCRIPT_NAME = ${JSON.stringify(opts.scriptName)};
var SECRET = ${JSON.stringify(opts.secret)};
var TAG = ${JSON.stringify(TH_MSG_TAG)};
var seq = 0;
var pending = new Map();
var missing = [];
var missingSet = new Set();
var listeners = new Map();
var lseq = 0;

function post(msg) {
  msg[TAG] = true;
  msg.secret = SECRET;
  msg.scriptId = SCRIPT_ID;
  // 【2026-09-07 调试钩子（临时）】post 自记录（iframe 侧回查信标是否发出）
  try { (window.__dshtPostLog = window.__dshtPostLog || []).push({ th: msg.th, phase: msg.phase, t: Date.now() }); } catch (e) {}
  try { window.parent.postMessage(msg, '*'); } catch (e) {
    // 【2026-09-07 根修】DataCloneError 静默丢包：脚本把 getVariables() 的「同步混合体」
    //（Promise + 自有属性）直接当 vars 传回（飞讯 <time> 提取后的 insertOrAssignVariables
    // 实证）——structuredClone 拒绝 Promise → postMessage 抛异常 → 调用从未发出 →
    // 脚本 await 永久挂起（队列任务冻死在「正在输入」）。JSON 副本保留自有可枚举属性
    //（混合体的变量树就在这些属性上），语义等价于真 TH 对混合体的平化处理。
    try { var clone = JSON.parse(JSON.stringify(msg)); window.parent.postMessage(clone, '*'); } catch (e2) { /* 宿主不可达 */ }
  }
}
function reportMissing(api) {
  if (missingSet.has(api)) return;
  missingSet.add(api);
  missing.push(api);
  try { console.warn('[TavernHelper shim] 脚本 ' + SCRIPT_NAME + ' 调了未支持 API: ' + api); } catch (e) {}
  post({ th: 'missing', api: api });
}
function call(api, args) {
  // 【审计 E 类修复 2026-09-08】超时守卫 + 一次自动重试：宿主不回包（数据面偶发挂死/
  // 帧未接线）时此前 Promise 永久挂起——卡脚本 await 冻死（示例游戏 story-version 卡在
  // 「正在读取全局剧情数据」实证，同卡其余 3 实例正常）。20s 首超时自动重试一次，
  // 再超时则 reject（错误进 script-error 信标可见），卡自身的 catch 路径能走。
  // 【鲁棒轮 2026-09-09】非幂等写 API 超时不重试：重试 = 换 callId 再 post 一条且不撤回
  // 第一条——宿主只是慢（物化渲染期主线程饱和）时 call#1 照常执行完毕，call#2 再执行
  // 一遍 → createChatMessages 重复追加整组消息（飞讯统合记录场景）。幂等读保留重试。
  var NON_IDEMPOTENT = /^(chat:append|injects:put|injects:remove|mvu:replace|buttons:set|wb:entryPut)/;
  function attempt(triesLeft) {
    return new Promise(function (resolve, reject) {
      var callId = ++seq;
      var settled = false;
      var timer = null;
      // 测试 VM/老 WebView 可能缺 clearTimeout——防御性引用
      var clearT = typeof clearTimeout === 'function' ? clearTimeout : function () {};
      pending.set(callId, {
        resolve: function (v) { settled = true; if (timer !== null) { clearT(timer); timer = null; } resolve(v); },
        reject: function (e) { settled = true; if (timer !== null) { clearT(timer); timer = null; } reject(e); },
      });
      timer = setTimeout(function () {
        if (settled) return;
        pending.delete(callId);
        if (triesLeft > 0 && !NON_IDEMPOTENT.test(api)) {
          try { console.warn('[TavernHelper shim] ' + api + ' 桥接超时，自动重试一次'); } catch (e) {}
          attempt(triesLeft - 1).then(resolve, reject);
        } else {
          var why = NON_IDEMPOTENT.test(api) ? '非幂等写调用不重试（防重复执行）' : '已重试 1 次';
          var err = new Error(api + ' 桥接超时（宿主 20s 未回包，' + why + '）');
          try { console.warn('[TavernHelper shim] ' + err.message); post({ th: 'script-error', error: err.message }); } catch (e) {}
          reject(err);
        }
      }, 20000);
      post({ th: 'call', callId: callId, api: api, args: args });
    });
  }
  return attempt(1);
}

// ---- 事件总线（shim 本地；host 投递经 message 进来）----
var tavern_events = ${tavernEventsJs};
var iframe_events = ${iframeEventsJs};
function listenerList(evt) {
  var l = listeners.get(evt);
  if (!l) { l = []; listeners.set(evt, l); }
  return l;
}
function removeListener(evt, fn) {
  var l = listeners.get(evt);
  if (!l) return;
  for (var i = l.length - 1; i >= 0; i--) { if (l[i].fn === fn) l.splice(i, 1); }
}
function dispatch(evt, args) {
  var l = (listeners.get(evt) || []).slice();
  for (var i = 0; i < l.length; i++) {
    var entry = l[i];
    var cur = listeners.get(evt);
    if (!cur || cur.indexOf(entry) === -1) continue; // 已被 removeListener
    try {
      var r = entry.fn.apply(undefined, args);
      if (entry.once) removeListener(evt, entry.fn);
      if (r && typeof r.then === 'function') r.catch(function (e) {
        console.error('[TavernHelper shim] 事件监听器异常(' + evt + '):', e);
      });
    } catch (e) {
      console.error('[TavernHelper shim] 事件监听器异常(' + evt + '):', e);
    }
  }
}
// 【鲁棒轮 2026-09-09】真 TH 语义：eventOn/eventOnce 对已在监听的同一 fn 幂等（重复注册
// 不新增）；eventMakeFirst/Last 是「移动」不是「新增」。shim 原实现无条件 push → 初始化
// 函数被 CHAT_CHANGED 再次调用时监听器执行 N 次副作用成倍放大（按钮/变量写双发）。
/**
 * T-81 注册期出声（两种，均**一次性**去重，防刷屏）：
 *  ① **非字符串事件名**：eventOn(undefined, cb) → String(undefined) === 'undefined'，
 *     注册"成功"但回调永不执行。语义**保持**真 TH（仍注册到 'undefined' 键，L36），只出声提示。
 *  ② **我方结构性不发射的 mag_ 事件**：注册成功但沙箱侧无投递点（MVU 变量更新在 host 主线程），
 *     明示降级（L42），否则用户只看到"监听器不触发"却找不到原因。
 */
var evtWarned = {};
function warnEventDegrade(reason, evt) {
  var k = reason + '|' + String(evt);
  if (evtWarned[k]) return;
  evtWarned[k] = true;
  try {
    console.warn('[TavernHelper shim] 事件注册降级（' + reason + '）：事件名 ' + JSON.stringify(String(evt)) +
      (reason === '非字符串事件名'
        ? ' —— 已按真 TH 语义注册到该键，但它永远不会被投递（调用方多半是 Mvu.events 常量缺失）'
        : ' —— 该 mag_* 事件在本移植中不发射（MVU 变量更新在宿主侧完成，沙箱无投递点），监听器不会触发'));
  } catch (e) {}
}
/** 注册前检查（eventOn/eventOnce/eventMake* 共用） */
function checkEventReg(evt) {
  if (typeof evt !== 'string') warnEventDegrade('非字符串事件名', evt);
  // MVU_UNEMITTED 是 var 声明（定义在下方 Mvu 段），脚本运行期必已就绪；此处仍加存在性守卫，
  // 避免任何未预期的调用序把它读成 undefined 后抛错（shim 顶层声明期绝不调用本函数）。
  if (typeof evt === 'string' && MVU_UNEMITTED && Object.prototype.hasOwnProperty.call(MVU_UNEMITTED, mvuEvtNameOf(evt))) {
    warnEventDegrade('本移植不发射', evt);
  }
}
/** 事件值 → MVU 常量名（反查；非 mag_* 返回空串） */
function mvuEvtNameOf(v) {
  if (!MVU_UNEMITTED) return '';
  for (var k in MVU_UNEMITTED) {
    if (Object.prototype.hasOwnProperty.call(MVU_UNEMITTED, k) && MVU_UNEMITTED[k] === v) return k;
  }
  return '';
}
function eventOn(evt, fn) {
  checkEventReg(evt)
  evt = String(evt)
  var list = listenerList(evt)
  for (var i = 0; i < list.length; i++) { if (list[i].fn === fn) return { stop: function () { removeListener(evt, fn); } } }
  list.push({ fn: fn, once: false, ord: ++lseq });
  return { stop: function () { removeListener(evt, fn); } };
}
function eventOnce(evt, fn) {
  checkEventReg(evt)
  evt = String(evt)
  var list = listenerList(evt)
  for (var i = 0; i < list.length; i++) { if (list[i].fn === fn) return { stop: function () { removeListener(evt, fn); } } }
  list.push({ fn: fn, once: true, ord: ++lseq });
  return { stop: function () { removeListener(evt, fn); } };
}
function eventMakeLast(evt, fn) {
  evt = String(evt)
  removeListener(evt, fn) // 移动语义：先摘旧位再插尾部
  listenerList(evt).push({ fn: fn, once: false, ord: ++lseq });
  return { stop: function () { removeListener(evt, fn); } };
}
function eventMakeFirst(evt, fn) {
  evt = String(evt)
  removeListener(evt, fn)
  listenerList(evt).unshift({ fn: fn, once: false, ord: ++lseq });
  return { stop: function () { removeListener(evt, fn); } };
}
// 【鲁棒轮 2026-09-09】补真 TH 公开 API eventClearListener(listener)：按函数引用跨事件清监听。
function eventClearListener(fn) {
  var removed = 0
  listeners.forEach(function (list) {
    for (var i = list.length - 1; i >= 0; i--) { if (list[i] && list[i].fn === fn) { list.splice(i, 1); removed++ } }
  })
  return removed
}
function eventRemoveListener(evt, fn) { removeListener(String(evt), fn); }
function eventClearEvent(evt) { listeners.delete(String(evt)); }
function eventClearAll() { listeners.clear(); }
function eventEmit(evt) {
  var args = Array.prototype.slice.call(arguments, 1);
  var l = (listeners.get(String(evt)) || []).slice();
  return l.reduce(function (p, entry) {
    return p.then(function () {
      var cur = listeners.get(String(evt));
      if (!cur || cur.indexOf(entry) === -1) return undefined;
      var r = entry.fn.apply(undefined, args);
      if (entry.once) removeListener(String(evt), entry.fn);
      return r;
    }).catch(function (e) { console.error('[TavernHelper shim] eventEmit 监听器异常(' + String(evt) + '):', e); });
  }, Promise.resolve());
}
function eventEmitAndWait(evt) {
  return eventEmit.apply(undefined, arguments);
}

// ---- 变量（桥到 host 数据面；message 作用域 = MVU 合并视图——2026-09-07 通用化）----
function normalizeOption(option) {
  var o = option || { type: 'chat' };
  if (typeof o !== 'object') o = { type: 'chat' };
  if (o.type === 'script' && !o.script_id) return { type: 'script', script_id: SCRIPT_ID };
  // message 作用域保留：真 TH 每消息变量树在 DSHT 由 MVU 合并视图（state⊕variables，
  // /dsht-mvu/variables）承担「最新快照」语义（message_id:-1 主消费路径）——
  // 宿主侧 varsGet('message') 路由到该端点，任何 MVU 卡的 stat_data 读路径都成立
  return o;
}
function guardOption(option, apiName) {
  var o = normalizeOption(option);
  if (o.type === 'extension') {
    reportMissing(apiName + ':extension-scope');
    var err2 = new Error('extension 作用域变量不支持（无 ST 扩展设置树）');
    err2.__thExpected = true;
    throw err2;
  }
  return o;
}
// 同步变量面（TauriTavern 语义：楼层 iframe 里 getAllVariables().stat_data 是同步
// 访问——异步 Promise 上取属性恒 undefined，状态栏会全「--」）。宿主建帧时嵌入
// window.__dshtFrameVars 缓存树；调用返回「同步树属性 + thenable 异步刷新」混合体。
function dshtVarsHybrid(asyncPromise) {
  var cache = window.__dshtFrameVars;
  var tree = cache && typeof cache === 'object' ? cache : {};
  return Object.assign(asyncPromise, tree);
}
function dshtVarsRefresh() {
  return call('vars:all', []).then(function (t) {
    try { window.__dshtFrameVars = t; } catch (e) {}
    return t;
  });
}
function getVariables(option) { return dshtVarsHybrid(call('vars:get', [guardOption(option, 'getVariables')])); }
function getAllVariables() { return dshtVarsHybrid(dshtVarsRefresh()); }
function replaceVariables(vars, option) { return call('vars:put', [guardOption(option, 'replaceVariables'), vars]).then(function (r) { return dshtVarsRefresh().then(function () { return r; }); }); }
function insertOrAssignVariables(vars, option) {
  var o = guardOption(option, 'insertOrAssignVariables');
  // C7 收口：chat 作用域（含缺省）走服务端深合并（/variables/merge——undo/快照/schema 校验收口）；
  // 其余作用域退回客户端读改写（vars:merge assign）
  if (o.type === 'chat') return call('vars:assign', [o, vars]);
  return call('vars:merge', [o, vars, 'assign']);
}
function insertVariables(vars, option) { return call('vars:merge', [guardOption(option, 'insertVariables'), vars, 'insert']); }
// 【T-21 契约修复 2026-09-10】deleteVariable 真 TH 契约（variables.d.ts）返回
// {variables, delete_occurred} 双字段——原实现只回 {variables}，脚本读
// res.delete_occurred 恒 undefined（判定"是否真的删掉了"永远失败）。
// host 侧 vars:delete 返回更新后的 {variables}；此处对比删除前后路径存在性得出 delete_occurred。
//
// 【T-21 续修 2026-09-11】路径切分必须与 host 同口径（lodash 风格）。
// 原实现只按 '.' 切 → "a.list[0]" 被当成单个键名 "list[0]"，恒判"不存在" →
// delete_occurred **永远是 false**（脚本据此判定"没删掉"→ 误重试）。
// 现镜像 host 的 lodashPathToPointer 分词（下标形态 a.b[0].c 与 a["b"] 都支持）。
function dshtPathSegs(path) {
  var p = String(path == null ? '' : path);
  if (p.startsWith('/')) {
    // JSONPointer：~/ 反转义（与 host decodeSeg 对应）
    return p.split('/').filter(function (s) { return s.length > 0; })
      .map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
  }
  var segs = [];
  var re = /[^.[\\]]+|\\[(\\d+|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\]/g;
  var m;
  while ((m = re.exec(p)) !== null) {
    var seg = m[0];
    if (seg.charAt(0) === '[') {
      seg = seg.slice(1, -1);
      if ((seg.charAt(0) === '"' && seg.charAt(seg.length - 1) === '"') ||
          (seg.charAt(0) === "'" && seg.charAt(seg.length - 1) === "'")) seg = seg.slice(1, -1);
    }
    if (seg) segs.push(seg);
  }
  return segs;
}
function dshtPathExists(tree, path) {
  if (!tree || typeof tree !== 'object') return false;
  var segs = dshtPathSegs(path);
  if (segs.length === 0) return false;
  var cur = tree;
  for (var i = 0; i < segs.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(segs[i] in cur)) return false;
    cur = cur[segs[i]];
  }
  return true;
}
function deleteVariable(path, option) {
  var o = guardOption(option, 'deleteVariable');
  var key = String(path);
  // 契约（variables.d.ts）：返回 {variables: 更新后的变量表, delete_occurred: 是否真的删除}。
  // host 桥的 vars:delete 不返回新树 → 删除后重读一次 get（准确且语义等价；删除是低频操作）。
  return call('vars:get', [o]).then(function (before) {
    var existed = dshtPathExists(before, key);
    return call('vars:delete', [o, key]).then(function () {
      return call('vars:get', [o]);
    }).then(function (after) {
      var variables = (after && typeof after === 'object' && !Array.isArray(after)) ? after : {};
      return { variables: variables, delete_occurred: existed && !dshtPathExists(variables, key) };
    });
  });
}
function updateVariablesWith(updater, option) {
  var o = guardOption(option, 'updateVariablesWith');
  return call('vars:get', [o]).then(function (tree) {
    return Promise.resolve(updater(tree));
  }).then(function (next) {
    return call('vars:put', [o, next]).then(function () { return next; });
  });
}

// ---- 脚本按钮（host 面板持有权威清单；点击回投按钮事件）----
function hashString(s) {
  var hash = 0;
  if (!s.length) return hash;
  for (var i = 0; i < s.length; i++) { hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0; }
  return hash;
}
function getButtonEvent(name) { return SCRIPT_ID + '_' + hashString(String(name)); }
function eventOnButton(name, fn) { eventOn(getButtonEvent(name), fn); }
// 【指南版 2026-09-09】按钮四件套全量支持目标脚本（真 TH 跨脚本管理语义）：
// getScriptButtons(script_id?) / replaceScriptButtons(buttons, script_id?) /
// updateScriptButtonsWith(updater, script_id?)（updater 收到**目标**脚本按钮）/
// appendInexistentScriptButtons(script_id?, buttons)。script_id 缺省 = 调用方自身；
// 显式指定时 host 校验目标已装载（不存在显式报错，不再静默改错对象）。
function getScriptButtons(script_id) {
  return call('buttons:get', [script_id == null ? null : String(script_id)]);
}
function replaceScriptButtons(buttons, script_id) {
  return call('buttons:set', [buttons, script_id == null ? null : String(script_id)]);
}
function updateScriptButtonsWith(updater, script_id) {
  var target = script_id == null ? null : String(script_id);
  return getScriptButtons(target).then(function (buttons) {
    return Promise.resolve(updater(buttons));
  }).then(function (next) {
    return replaceScriptButtons(next, target).then(function () { return next; });
  });
}
function appendInexistentScriptButtons(a, b) {
  // 真 TH 双形态：appendInexistentScriptButtons(script_id, buttons) 或 (buttons)（自身）
  var target = typeof a === 'string' ? a : null;
  var newButtons = typeof a === 'string' ? b : a;
  return updateScriptButtonsWith(function (buttons) {
    var add = (newButtons || []).filter(function (nb) {
      return !buttons.some(function (x) { return x.name === nb.name; });
    });
    return buttons.concat(add);
  }, target);
}

// ---- 上下文快照（host 主动推送 {th:'context', context}；getContext 同步读、不过桥）----
var latestContext = null;
// 【P3a 2026-09-07】bootstrap：楼层帧文档构建时宿主内嵌 window.__dshtInitialContext
// （卡脚本运行前就位）——postMessage 推送与卡内 detectEnvironment 首读存在竞态，
// 首读落 pending 空壳后卡把「未绑定世界书」写死不再重试（实机实证）
if (window.__dshtInitialContext && typeof window.__dshtInitialContext === 'object') {
  latestContext = window.__dshtInitialContext;
}
function applyContextSnapshot(ctx) {
  latestContext = (ctx && typeof ctx === 'object') ? ctx : null;
  dispatch('context_refreshed', [latestContext]);
}
function getContext() {
  if (latestContext) return latestContext;
  try { console.warn('[TavernHelper shim] 上下文快照未就绪：返回 __dshtContextPending 空壳（宿主推送后 getContext 即同步可用）'); } catch (e) {}
  return {
    __dshtContextPending: true,
    presetId: null,
    presetName: null,
    character: null,
    slug: null,
    chatCompletionSettings: { prompts: [], prompt_order: [] },
    messages: [],
  };
}
function getLoadedPresetName() {
  var ctx = getContext();
  return (ctx && ctx.presetName != null) ? ctx.presetName : null;
}
// getCharWorldbookNames（真 TH 同步返回 CharWorldbooks = {primary, additional}；
// 世界书控制/飞讯以裸全局同步调用 getCharWorldbookNames('current')）。
// 本移植从上下文快照同步读角色 primary 书名；additional（卡内扩展附加书）未移植，恒为 []。
function getCharWorldbookNames(characterName) {
  var ctx = (latestContext && typeof latestContext === 'object') ? latestContext : null;
  var primary = (ctx && ctx.characterLorebook != null) ? ctx.characterLorebook : null;
  return { primary: primary, additional: [] };
}

// ---- 预设 CRUD（桥到 host /preset/*；create:true = 缺则建）----
function presetPayloadOf(preset) {
  var p = (preset && typeof preset === 'object') ? preset : {};
  return {
    prompts: Array.isArray(p.prompts) ? p.prompts : [],
    prompt_order: Array.isArray(p.prompt_order) ? p.prompt_order : [],
  };
}
function getPresetNames() {
  return call('preset:names', []).then(function (r) {
    if (Array.isArray(r)) return r;
    return (r && Array.isArray(r.names)) ? r.names : [];
  });
}
function getPreset(name) {
  return call('preset:get', [String(name)]).then(function (r) {
    return (r && r.found && r.preset && typeof r.preset === 'object') ? r.preset : null;
  });
}
function presetExists(name) {
  return call('preset:get', [String(name)]).then(function (r) { return !!(r && r.found); });
}
function createPreset(name, preset) {
  var p = presetPayloadOf(preset);
  return call('preset:put', [String(name), p.prompts, p.prompt_order, true]);
}
function createOrReplacePreset(name, preset) { return createPreset(name, preset); }
function replacePreset(name, preset) {
  var p = presetPayloadOf(preset);
  return call('preset:put', [String(name), p.prompts, p.prompt_order]);
}
// 【实机审计修复 2026-09-05】P2：setPreset 改深合并（真 TH 语义 = PartialDeep merge 进
// 现有预设，非整表替换）：get 现有 → 对象递归合并（数组/标量整值覆盖）→ put。预设不存在
// 时按 create 语义直接落 partial。
function dshtDeepMerge(low, high) {
  if (high === null || typeof high !== 'object' || Array.isArray(high)) return high;
  if (low === null || typeof low !== 'object' || Array.isArray(low)) low = {};
  var out = {};
  for (var k in low) out[k] = low[k];
  for (var k2 in high) {
    if (high[k2] !== null && typeof high[k2] === 'object' && !Array.isArray(high[k2])
      && low[k2] !== null && typeof low[k2] === 'object' && !Array.isArray(low[k2])) {
      out[k2] = dshtDeepMerge(low[k2], high[k2]);
    } else {
      out[k2] = high[k2];
    }
  }
  return out;
}
function setPreset(name, preset) {
  var p = (preset && typeof preset === 'object') ? preset : {};
  return getPreset(name).then(function (existing) {
    var merged = dshtDeepMerge(existing, p);
    var v = presetPayloadOf(merged);
    var missing = existing === null;
    return call('preset:put', [String(name), v.prompts, v.prompt_order, missing]);
  });
}
function deletePreset(name) { return call('preset:delete', [String(name)]); }
function renamePreset(name, newName) { return call('preset:rename', [String(name), String(newName)]); }
function loadPreset(name, sessionId) {
  // sessionId 缺省传 null：host 侧回填运行时会话
  var sid = (typeof sessionId === 'string' && sessionId) ? sessionId : null;
  return call('preset:load', [sid, String(name)]).then(function () { return true; });
}
function updatePresetWith(name, updater) {
  return getPreset(name).then(function (preset) {
    return Promise.resolve(updater(preset));
  }).then(function (next) {
    var p = presetPayloadOf(next);
    return call('preset:put', [String(name), p.prompts, p.prompt_order]).then(function () { return next; });
  });
}

// ---- 预设 prompt 判定（本地纯逻辑：marker 占位 / 系统槽 identifier / system_prompt 字段）----
var SYSTEM_PROMPT_IDS = { main: true, nsfw: true, jailbreak: true, enhanceDefinitions: true };
function findPresetPrompt(preset, identifier) {
  var p = (preset && typeof preset === 'object') ? preset : null;
  if (!p || !Array.isArray(p.prompts) || typeof identifier !== 'string') return null;
  for (var i = 0; i < p.prompts.length; i++) {
    var item = p.prompts[i];
    if (item && typeof item === 'object' && item.identifier === identifier) return item;
  }
  return null;
}
function isPresetNormalPrompt(preset, identifier) {
  var item = findPresetPrompt(preset, identifier);
  return !!item && !item.marker;
}
function isPresetPlaceholderPrompt(preset, identifier) {
  var item = findPresetPrompt(preset, identifier);
  return !!item && !!item.marker;
}
function isPresetSystemPrompt(preset, identifier) {
  var item = findPresetPrompt(preset, identifier);
  if (!item) return false;
  return item.system_prompt === true || SYSTEM_PROMPT_IDS[identifier] === true;
}

// ---- 聊天消息（只读；桥到 host /chat/messages；写路径记名拒绝——会话日志 append-only）----
// 【实机审计修复 2026-09-05】P1：getChatMessages 语义对齐真 TH——首参是楼层范围串
// （'0'、'0-9'、'-3' = 倒数第 3 楼），不再当 sessionId 用；sessionId 由 host 桥接层按
// 运行时会话回填（桥参数恒 null）。范围解析逐字移植真 TH string_to_range：单数字
// （负数 = 深度，-1 为最新楼）= 该楼；'a-b' 闭区间（两端 clamp 后排序）；失败 → []。
// '{{macro}}' 先过宏展开桥（ST substituteParamsExtended 等效）。
function dshtStringToRange(input, min, max) {
  var start, end;
  var clamp = function (value) { return Math.min(max, Math.max(min, value < 0 ? max + value + 1 : value)); };
  if (input.match(/^(-?\\d+)$/)) {
    start = end = clamp(Number(input));
  } else {
    var m = input.match(/^(-?\\d+)-(-?\\d+)$/);
    if (!m) return null;
    var a = clamp(Number(m[1]));
    var b = clamp(Number(m[2]));
    start = Math.min(a, b);
    end = Math.max(a, b);
  }
  if (isNaN(start) || isNaN(end)) return null;
  return { start: start, end: end };
}
// 真 TH ChatMessage 形状：{message_id, name, role, is_hidden, message, data}；
// data = 数据面记录里规范字段之外的全部附加键（脚本按 ST 惯例在 data 上读写楼层附加数据）。
// seq = 会话日志事件锚（本移植扩展）：setChatMessages 写回时定位楼层用，不进 data。
// 【鲁棒轮 2026-09-09】补真 TH 兼容字段 extra/swipe_id/swipes（ST 每楼必有 extra；
// 卡脚本读 msg.extra.token_count / msg.swipe_id 直接 TypeError 的预防）+ data 语义注释。
function dshtMessageView(m) {
  if (!m || typeof m !== 'object') return m;
  var data = {};
  for (var k in m) {
    if (k === 'message_id' || k === 'name' || k === 'role' || k === 'message' || k === 'is_system' || k === 'is_hidden' || k === 'data' || k === 'seq' || k === 'extra' || k === 'swipe_id' || k === 'swipes' || k === 'swipes_data' || k === 'swipes_info') continue;
    data[k] = m[k];
  }
  var view = {
    message_id: m.message_id,
    name: m.name,
    role: m.role,
    is_hidden: m.is_hidden === true || m.is_system === true,
    message: m.message,
    data: (m.data && typeof m.data === 'object') ? m.data : data,
    // 兼容面：快照无 swipe 数据 → 恒单页形状（extra 空对象兜底 token_count 类读取不炸）
    extra: (m.extra && typeof m.extra === 'object') ? m.extra : {},
    swipe_id: typeof m.swipe_id === 'number' ? m.swipe_id : 0,
    swipes: Array.isArray(m.swipes) ? m.swipes : [m.message],
    // 【T-21 契约修复 2026-09-10】ChatMessageSwiped（chat_message.d.ts）还要求
    // swipes_data（每页的楼层变量）与 swipes_info（每页元信息）——缺失时按页数给等长空对象数组，
    // 防脚本按索引取 swipes_data[swipe_id] 时直接 TypeError。
    swipes_data: Array.isArray(m.swipes_data) ? m.swipes_data : (Array.isArray(m.swipes) ? m.swipes.map(function () { return {} }) : [{}]),
    swipes_info: Array.isArray(m.swipes_info) ? m.swipes_info : (Array.isArray(m.swipes) ? m.swipes.map(function () { return {} }) : [{}]),
  };
  if (typeof m.seq === 'number') view.seq = m.seq;
  return view;
}
// 【2026-09-07 同步语义对齐（真 TH）】getChatMessages / getChatMessage 在真 TH 是
// **同步函数**（同步读 window.chat）——示例游戏剧情逻辑脚本 const latestMessages =
// getChatMessages(-1) 不 await 直接取 [0].message_id，Promise 返回值下 [0] 恒
// undefined → masterLoop 每轮炸 message_id（真机日志 82 次/分钟）。改从上下文快照
// （host 推送 messages）同步取数；范围解析同款 dshtStringToRange。宏展开是异步桥，
// 同步面做常见宏（{{user}}/{{char}}/{{lastMessageId}}/数字宏）的本地快照展开，
// 展开不出数字的范围串返回 []（真 TH 语义：解析失败 = 空数组）。
function dshtSyncMacroRange(raw) {
  var out = String(raw == null ? '' : raw);
  if (out.indexOf('{{') < 0) return out;
  var ctx = (latestContext && typeof latestContext === 'object') ? latestContext : null;
  var userName = (ctx && ctx.name1) ? String(ctx.name1) : '';
  var charName = (ctx && ctx.character && ctx.character.name) ? String(ctx.character.name) : '';
  var msgs = (ctx && Array.isArray(ctx.messages)) ? ctx.messages : [];
  out = out.split('{{user}}').join(userName).split('{{char}}').join(charName);
  out = out.split('{{lastMessageId}}').join(String(msgs.length > 0 ? msgs[msgs.length - 1].message_id : -1));
  // 其余宏：宏名本身是数字（自定义数值宏）才可同步解析；否则放弃
  out = out.replace(/\\{\\{\\s*(-?\\d+)\\s*\\}\\}/g, '$1');
  if (out.indexOf('{{') >= 0) return null;
  return out;
}
function dshtSyncChatList() {
  var ctx = (latestContext && typeof latestContext === 'object') ? latestContext : null;
  var msgs = (ctx && Array.isArray(ctx.messages)) ? ctx.messages : [];
  var list = [];
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i] && typeof msgs[i] === 'object') list.push(dshtMessageView(msgs[i]));
  }
  return list;
}
// 【鲁棒轮 2026-09-09】补第二参数 option（真 TH 签名 getChatMessages(range, {role, hide_state,
// include_swipes})）——shim 原实现整个丢弃 option，统计/拼接类脚本拿到未过滤数据静默出错。
// role: 'all'|'system'|'assistant'|'user'；hide_state: 'all'|'hidden'|'unhidden'。
// 【T-21 2026-09-10】role 过滤改按契约 role 字段判定（chat_message.d.ts ChatMessage 无 is_system，
// 原实现用 is_system 判 'system' → 恒不命中）；include_swipes 控制是否附 swipes 族字段。
function dshtMessageFilter(m, option) {
  if (!option || typeof option !== 'object') return true
  var role = option.role
  if (role && role !== 'all') {
    if (m.role !== role) return false
  }
  var hs = option.hide_state
  if (hs && hs !== 'all') {
    if (hs === 'hidden' && m.is_hidden !== true) return false
    if (hs === 'unhidden' && m.is_hidden === true) return false
  }
  return true
}
function getChatMessages(range, option) {
  var raw = dshtSyncMacroRange(range == null ? '' : String(range));
  if (raw === null) return [];
  var list = dshtSyncChatList();
  var rn = dshtStringToRange(raw, 0, list.length - 1);
  if (!rn) return [];
  var opt = (option && typeof option === 'object') ? option : {};
  var withSwipes = opt.include_swipes === true;
  var out = [];
  for (var i = rn.start; i <= rn.end; i++) {
    var m = list[i];
    if (!m || typeof m !== 'object' || !dshtMessageFilter(m, opt)) continue;
    if (!withSwipes) {
      // 契约（chat_message.d.ts）：include_swipes 缺省/false → 返回 ChatMessage（无 swipes 族字段）。
      // 注意 extra 在 ChatMessage 里是**必需**字段，保留。
      m = {
        message_id: m.message_id, name: m.name, role: m.role,
        is_hidden: m.is_hidden, message: m.message, data: m.data, extra: m.extra,
      };
    }
    out.push(m);
  }
  return out;
}
function getChatMessage(id) {
  // 惯用单数查询（真 TH 无此 API——我方扩展面）：按楼层号精确匹配，未命中 null
  var list = dshtSyncChatList();
  var want = Number(id);
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m && typeof m === 'object' && m.message_id === want) return m;
  }
  return null;
}
// 【实机审计修复 2026-09-05】P2：历史简报 / 全量——同走 chat:messages 数据面。
// Brief = [{message_id, role, content（截断 200 字，超出补 …）}]；Detail = 数据面全量原样。
function getChatHistoryBrief() {
  return call('chat:messages', [null]).then(function (r) {
    var list = (r && Array.isArray(r.messages)) ? r.messages : (Array.isArray(r) ? r : []);
    return list.map(function (m) {
      var text = (m && typeof m.message === 'string') ? m.message : '';
      return {
        message_id: m ? m.message_id : undefined,
        role: m ? m.role : undefined,
        content: text.length > 200 ? text.slice(0, 200) + '…' : text,
      };
    });
  });
}
function getChatHistoryDetail() {
  return call('chat:messages', [null]).then(function (r) {
    return (r && Array.isArray(r.messages)) ? r.messages : (Array.isArray(r) ? r : []);
  });
}

// ---- 正则（桥到 host /regexes/*；character 作用域的 slug 取自快照）----
// 【T-20 契约适配 2026-09-10】真 TH 公开契约（JS-Slash-Runner @types/function/tavern_regex.d.ts）
// 与我方内部存储形状（engine.ts RegexScript，ST 磁盘格式）有 9 处偏差 + 1 处极性反转。
// 内部存储不动，只在**门面**做双向映射，防「脚本不报错、静默拿 undefined」：
//   script_name↔scriptName / find_regex↔findRegex / replace_string↔replaceString
//   trim_strings↔trimStrings / run_on_edit↔runOnEdit / min_depth↔minDepth / max_depth↔maxDepth
//   enabled↔!disabled（极性反转！）
//   source{user_input,ai_output,slash_command,world_info} ↔ placement:number[]
//   destination{display,prompt} ↔ markdownOnly/promptOnly（display=false→markdownOnly；prompt=false→promptOnly）
var DSHT_PLACEMENT_KEYS = ['user_input', 'ai_output', 'slash_command', 'world_info'];
/** 内部 RegexScript → 真 TH TavernRegex（出口） */
function dshtRegexToTh(s) {
  if (!s || typeof s !== 'object') return s;
  var pl = Array.isArray(s.placement) ? s.placement : [];
  var out = {
    id: s.id,
    script_name: s.scriptName,
    enabled: s.disabled !== true, // 极性反转：内部 disabled ⇄ 契约 enabled
    find_regex: s.findRegex,
    replace_string: s.replaceString,
    trim_strings: Array.isArray(s.trimStrings) ? s.trimStrings : [],
    source: {
      user_input: pl.indexOf(1) !== -1,
      ai_output: pl.indexOf(2) !== -1,
      slash_command: pl.indexOf(3) !== -1,
      world_info: pl.indexOf(5) !== -1,
    },
    // 契约 destination 语义（d.ts：「仅格式显示」=markdownOnly /「仅格式提示词」=promptOnly）：
    //   display = 参与显示渲染 = !promptOnly（promptOnly 脚本不参与显示）
    //   prompt  = 参与提示词   = !markdownOnly（markdownOnly 脚本不参与提示词）
    destination: { display: s.promptOnly !== true, prompt: s.markdownOnly !== true },
    run_on_edit: s.runOnEdit === true,
    min_depth: (typeof s.minDepth === 'number') ? s.minDepth : null,
    max_depth: (typeof s.maxDepth === 'number') ? s.maxDepth : null,
  };
  if (typeof s._dshtScope === 'string') out.scope = s._dshtScope === 'character' ? 'character' : 'global';
  return out;
}
/** 真 TH TavernRegex → 内部 RegexScript（入口；也接受已是内部形状的对象——兼容老脚本） */
function dshtThToRegex(t) {
  if (!t || typeof t !== 'object') return null;
  // 已是内部形状（有 camelCase 字段）→ 原样规范化，避免二次映射把 enabled 又翻回去
  var looksInternal = (t.scriptName !== undefined || t.findRegex !== undefined || t.disabled !== undefined);
  if (looksInternal) {
    return {
      id: String(t.id == null ? '' : t.id),
      scriptName: String(t.scriptName == null ? '' : t.scriptName),
      findRegex: String(t.findRegex == null ? '' : t.findRegex),
      replaceString: String(t.replaceString == null ? '' : t.replaceString),
      trimStrings: Array.isArray(t.trimStrings) ? t.trimStrings : [],
      placement: Array.isArray(t.placement) ? t.placement : [],
      disabled: t.disabled === true,
      markdownOnly: t.markdownOnly === true,
      promptOnly: t.promptOnly === true,
      runOnEdit: t.runOnEdit === true,
      substituteRegex: typeof t.substituteRegex === 'number' ? t.substituteRegex : 0,
      minDepth: (typeof t.minDepth === 'number') ? t.minDepth : null,
      maxDepth: (typeof t.maxDepth === 'number') ? t.maxDepth : null,
      _dshtScope: typeof t._dshtScope === 'string' ? t._dshtScope : 'global',
    };
  }
  var src = (t.source && typeof t.source === 'object') ? t.source : {};
  var dst = (t.destination && typeof t.destination === 'object') ? t.destination : {};
  var placement = [];
  for (var i = 0; i < DSHT_PLACEMENT_KEYS.length; i++) {
    var k = DSHT_PLACEMENT_KEYS[i];
    // 未给 source（老脚本只传 placement）→ 按真 TH 默认全 false，避免误判"全部生效"
    if (src[k] === true) placement.push(DSHT_REGEX_PLACEMENT[k]);
  }
  return {
    id: String(t.id == null ? '' : t.id),
    scriptName: String(t.script_name == null ? '' : t.script_name),
    findRegex: String(t.find_regex == null ? '' : t.find_regex),
    replaceString: String(t.replace_string == null ? '' : t.replace_string),
    trimStrings: Array.isArray(t.trim_strings) ? t.trim_strings : [],
    placement: placement,
    // 极性反转：契约 enabled=false → 内部 disabled=true
    disabled: t.enabled === false,
    // 极性/结构双反算：promptOnly=「不参与显示」(display=false)；markdownOnly=「不参与提示词」(prompt=false)
    markdownOnly: dst.prompt === false,
    promptOnly: dst.display === false,
    runOnEdit: t.run_on_edit === true,
    substituteRegex: typeof t.substitute_regex === 'number' ? t.substitute_regex : 0,
    minDepth: (typeof t.min_depth === 'number') ? t.min_depth : null,
    maxDepth: (typeof t.max_depth === 'number') ? t.max_depth : null,
    _dshtScope: (t.scope === 'character') ? 'character' : 'global',
  };
}
/** 真 TH TavernRegexOption → 内部 {scope, slug}；未知形态**显式抛错**（N2：不再静默降级 global） */
function dshtResolveRegexOption(option) {
  var o = (option && typeof option === 'object') ? option : {};
  var type = o.type;
  // 兼容旧 scope 形态（d.ts「使用旧 scope 参数时」）
  if (type === undefined && typeof o.scope === 'string') type = o.scope;
  var ctxSlug = (latestContext && typeof latestContext.slug === 'string') ? latestContext.slug : null;
  if (type === 'global') return { scope: 'global', slug: null };
  if (type === 'character') return { scope: 'character', slug: ctxSlug };
  if (type === 'preset') return { scope: 'preset', slug: null };
  // 旧形态 'all'（ReplaceTavernRegexesOption）与未识别 → 显式报错
  throw new Error('getTavernRegexes/replaceTavernRegexes: 不支持的 option（真 TH 契约：{type:"global"|"character"|"preset"}，收到 ' + JSON.stringify(option) + '）');
}
function getTavernRegexes(option) {
  var r;
  try { r = dshtResolveRegexOption(option); } catch (e) {
    // 未给 option 是旧调用习惯（真 TH 必填）——降级返回三源合并视图并记名，避免硬崩老脚本
    if (option === undefined || option === null) r = { scope: 'all', slug: null };
    else { reportMissing('getTavernRegexes:bad-option'); throw e; }
  }
  return call('regexes:get', [r.slug, null]).then(function (res) {
    var list = (res && Array.isArray(res.regexes)) ? res.regexes : [];
    // scope 过滤（真 TH 按 option 只返回该组；缺省 all 返回全部——向后兼容）
    if (r.scope !== 'all') list = list.filter(function (s) { return (s._dshtScope || 'global') === r.scope; });
    var out = list.map(dshtRegexToTh);
    // 【T-20】顺带把**全量**映射结果填进同步 API 的预热缓存（供 formatAsTavernRegexedString）
    latestRegexesCache = ((res && Array.isArray(res.regexes)) ? res.regexes : []).map(dshtRegexToTh);
    return out;
  });
}
function replaceTavernRegexes(regexes, option) {
  var r = dshtResolveRegexOption(option); // N2：未知形态显式抛错，不再静默改全局
  var scope = r.scope === 'all' ? 'global' : r.scope;
  var list = (Array.isArray(regexes) ? regexes : []).map(dshtThToRegex).filter(function (x) { return x !== null; });
  return call('regexes:replace', [list, scope, r.slug, null]);
}
// 【实机审计修复 2026-09-05】P1：updateTavernRegexesWith——按作用域分组整组写回。
// 【T-20 N3 修复 2026-09-10】真 TH 签名 (updater, option) 必带 option，且**只作用于该作用域**；
// 原实现忽略 option + 三作用域全部写回 → 脚本只想改全局正则，结果把角色/预设正则一并覆盖。
// 现在：按 option 过滤出目标作用域（updater 收到的就是该组），只写回该作用域。
function updateTavernRegexesWith(updater, option) {
  var r = dshtResolveRegexOption(option); // 未知形态显式抛错（N2 同款）
  return getTavernRegexes(option).then(function (regexes) {
    return Promise.resolve(updater(JSON.parse(JSON.stringify(regexes)))).then(function (next) {
      var list = (Array.isArray(next) ? next : []).map(dshtThToRegex).filter(function (x) { return x !== null; });
      // 只写回 option 指定的作用域（'all' 才三组齐写——旧调用习惯的兼容路径）
      var scopes = r.scope === 'all' ? ['global', 'character', 'preset'] : [r.scope];
      var jobs = [];
      for (var i = 0; i < scopes.length; i++) {
        var sc = scopes[i];
        var bucket = [];
        for (var j = 0; j < list.length; j++) {
          var s = list[j];
          if ((s._dshtScope || 'global') !== sc) continue;
          var clean = {};
          for (var k in s) { if (k !== '_dshtScope') clean[k] = s[k]; }
          bucket.push(clean);
        }
        jobs.push(call('regexes:replace', [bucket, sc, sc === 'character' ? r.slug : null, null]));
      }
      return Promise.all(jobs).then(function () { return regexes; });
    });
  });
}
// 【T-20 修复 2026-09-10】formatAsTavernRegexedString——真 TH 契约：同步返回 string，且
// option.depth 不填则忽略深度限制。原实现返回 Promise → 脚本按同步用会拿到字符串化的
// Promise 字面量；且读内部 camelCase 形状（契约已改 snake_case）。
// 同步实现靠**缓存的正则清单**（regexes:get 结果随上下文快照刷新到 latestRegexesCache）。
var latestRegexesCache = [];
/** 缓存预热（幂等；in-flight 去重）。调用点：① 脚本首次用同步 API 时惰性触发
 *  ② getTavernRegexes/replaceTavernRegexes 异步调用成功后顺带刷新（T-20 2026-09-10）。
 *  注意：**不在 applyContextSnapshot 里触发**——那会破坏「同步面不过桥」不变量
 *  （getChatMessages 等同步 API 的测试断言 callsOf === 0）。 */
var regexCacheInflight = null;
function dshtRefreshRegexCache() {
  if (regexCacheInflight !== null) return regexCacheInflight;
  regexCacheInflight = call('regexes:get', [null, null]).then(function (res) {
    var list = (res && Array.isArray(res.regexes)) ? res.regexes : [];
    latestRegexesCache = list.map(dshtRegexToTh);
    return latestRegexesCache;
  }).catch(function () { return latestRegexesCache; }).then(function (v) {
    regexCacheInflight = null;
    return v;
  });
  return regexCacheInflight;
}
var DSHT_REGEX_PLACEMENT = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };
function formatAsTavernRegexedString(text, source, destination, option) {
  var placement = DSHT_REGEX_PLACEMENT[source];
  var result = String(text == null ? '' : text);
  if (placement === undefined) return result;
  // 缓存未预热 → 惰性触发（本次用现有缓存返回，下次调用即有数据；同步契约不阻塞）
  if (latestRegexesCache.length === 0) { try { void dshtRefreshRegexCache(); } catch (e) { /* noop */ } }
  var opt = (option && typeof option === 'object') ? option : {};
  var depth = (typeof opt.depth === 'number') ? opt.depth : null;
  for (var i = 0; i < latestRegexesCache.length; i++) {
    var s = latestRegexesCache[i];
    if (!s || typeof s !== 'object') continue;
    if (s.enabled === false) continue; // 契约形状：enabled（真值=启用）
    var src = (s.source && typeof s.source === 'object') ? s.source : {};
    var srcKey = (source === 'reasoning') ? 'ai_output' : source; // 契约 source 无 reasoning 位
    if (src[srcKey] !== true) continue;
    var dst = (s.destination && typeof s.destination === 'object') ? s.destination : {};
    // 契约语义：destination 位为 false = 该用途不适用（display=false 即「仅格式提示词」脚本，display 跳过）
    if (destination === 'display' && dst.display === false) continue;
    if (destination === 'prompt' && dst.prompt === false) continue;
    // depth 过滤（t.d.ts：不填则不考虑深度选项）
    if (depth !== null) {
      if (typeof s.min_depth === 'number' && depth < s.min_depth) continue;
      if (typeof s.max_depth === 'number' && depth > s.max_depth) continue;
    }
    if (typeof s.find_regex !== 'string' || s.find_regex === '') continue;
    try {
      var re = new RegExp(s.find_regex, 'g');
      var rep = typeof s.replace_string === 'string' ? s.replace_string.replace(/{{match}}/gi, '$$&') : '';
      result = result.replace(re, rep);
    } catch (e) { /* 坏正则跳过（与 ST 引擎容错一致） */ }
  }
  return result;
}
// 【T-20 N5 修复 2026-09-10】isCharacterTavernRegexesEnabled——我方 regexes:get 三源合并
// 即含 character 组（角色正则恒并入生效），语义上恒 true（诚实：无 _dshtScope 白名单机制）。
function isCharacterTavernRegexesEnabled() { return true; }
// 正则缓存预热：上下文快照刷新时同步（formatAsTavernRegexedString 是同步 API，需预热数据）
if (typeof window !== 'undefined') {
  setTimeout(function () { void dshtRefreshRegexCache(); }, 0);
}

// ---- 世界书（名单与条目读 + 【实机审计修复 2026-09-05】P1 写面：整表替换 / 全局·角色书单重绑 / 会话书）----
function getWorldbooks() {
  return call('wb:list', []).then(function (r) {
    var books = (r && Array.isArray(r.books)) ? r.books : [];
    var names = [];
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (b && typeof b.name === 'string' && b.name) names.push(b.name);
    }
    return names;
  });
}
// wb:get 回包归一化：host /worldbook/get 实际返回扁平 {name,lorePath,entries,...}，
// 旧桥契约假设 {book:{...}}——两种形状都接受（宁可兼容，不做假 404）。
function wbBookOf(r) {
  if (r && typeof r === 'object') {
    if (r.book && typeof r.book === 'object') return r.book;
    if (Array.isArray(r.entries)) return r;
  }
  return null;
}
// 【2026-09-07 TH WorldbookEntry 形态补齐】真 TH getWorldbook/getLorebookEntries 返回的
// 条目带 strategy/position 对象——世界书控制等卡的判定逻辑（checkStoryActivation 的
// entry.strategy.type、strategy.keys）直接依赖；缺失会让"剧情激活/Pro-Lite 切换"判定
// 永远落空并触发心跳反复重写世界书（实机 5000+ 次/小时 wb:entryPut 风暴根因）。
// strategy: {type:'constant'|'selective'|'conditional', keys, secondary_keys, selective_logic}
// position: {type:'before_char'|…, depth, order, role}
// 【T-21 2026-09-10】position.type 映射改真 TH WorldbookEntry 枚举（worldbook.d.ts）：
// ST 数值 position（0..6）→ 契约字符串。0=before_char / 1=after_char / 2=before_authors_note /
// 3=after_authors_note / 4=at_depth / 5=before_example_messages / 6=after_example_messages
var TH_POS_ST_TO_TYPE = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages'];
// 【T-21 契约补齐 2026-09-10】真 TH WorldbookEntry（worldbook.d.ts）字段：
// {uid, name, enabled, strategy{type,keys,keys_secondary{logic,keys},scan_depth},
//  position{type,role,depth,order}, content, probability,
//  recursion{prevent_incoming,prevent_outgoing,delay_until}, effect{sticky,cooldown,delay}, extra?}
// 原实现只补 strategy/position 两对象 → 脚本读 entry.recursion / entry.effect / entry.probability
// 恒 undefined（"禁止递归""黏性/冷却"类判定静默失效）。此处一次补齐（幂等：已有字段不覆盖）。
var TH_RECURSION_LOGIC = { 0: 'and_any', 1: 'and_all', 2: 'not_all', 3: 'not_any' };
// 【T-21 2026-09-11】display_index：**已废弃**的 LorebookEntry 契约
// （@types/function/lorebook_entry.d.ts:4）必填字段，getLorebookEntries 读面提供
// （基准 lorebook_entry.ts:136 display_index: entry.displayIndex）。
// 取值链（基准 util/compatibility.ts:63）：extensions.display_index ?? 数组下标。
// 原实现从未产出该字段 → 卡脚本读 e.display_index 恒 undefined（列表排序/去重类逻辑落空）。
function thDisplayIndex(e, index) {
  var ext = (e && typeof e.extensions === 'object' && e.extensions !== null) ? e.extensions : null;
  if (ext && typeof ext.display_index === 'number') return ext.display_index;
  if (e && typeof e.displayIndex === 'number') return e.displayIndex;
  return index;
}
function thEnrichEntry(e, index) {
  if (!e || typeof e !== 'object') return e;
  if (typeof e.display_index !== 'number') e.display_index = thDisplayIndex(e, typeof index === 'number' ? index : 0);
  if (e.strategy) return e;
  var constant = e.constant === true;
  var selective = e.selective === true;
  var strategy = {
    // 契约（worldbook.d.ts）：'constant' | 'selective' | 'vectorized'
    type: constant ? 'constant' : (selective ? 'selective' : 'constant'),
    keys: Array.isArray(e.key) ? e.key.map(String) : [],
    keys_secondary: {
      logic: TH_RECURSION_LOGIC[typeof e.selectiveLogic === 'number' ? e.selectiveLogic : 0] || 'and_any',
      keys: Array.isArray(e.keysecondary) ? e.keysecondary.map(String) : [],
    },
    scan_depth: typeof e.scanDepth === 'number' ? e.scanDepth : 'same_as_global',
  };
  var posType = TH_POS_ST_TO_TYPE[typeof e.position === 'number' ? e.position : 0] || 'before_character_definition';
  e.strategy = strategy;
  e.position = {
    type: posType,
    role: (e.role === 'user' || e.role === 'assistant') ? e.role : 'system',
    depth: typeof e.depth === 'number' ? e.depth : 4,
    order: typeof e.order === 'number' ? e.order : 100,
  };
  // 【T-21】递归控制 / 时效效果 / 概率 / extra（契约必填项）
  if (e.recursion === undefined) {
    e.recursion = {
      prevent_incoming: e.excludeRecursion === true,
      prevent_outgoing: e.preventRecursion === true,
      delay_until: (typeof e.delayUntilRecursion === 'number') ? e.delayUntilRecursion : null,
    };
  }
  if (e.effect === undefined) {
    e.effect = {
      sticky: (typeof e.sticky === 'number') ? e.sticky : null,
      cooldown: (typeof e.cooldown === 'number') ? e.cooldown : null,
      delay: (typeof e.delay === 'number') ? e.delay : null,
    };
  }
  if (typeof e.probability !== 'number') e.probability = 100;
  if (e.extra === undefined) e.extra = {};
  e.use_regex = false;
  return e;
}
function getLorebookEntries(name) {
  return call('wb:get', [String(name)]).then(function (r) {
    var book = wbBookOf(r);
    var entries = (book && Array.isArray(book.entries)) ? book.entries : [];
    return entries.map(function (e, i) { return thEnrichEntry(e, i); });
  });
}
// updateWorldbookWith（真 TH：fn(entries) → 返回改后数组，差量落盘）。世界书控制/飞讯写路径。
// 差量 = 与原数组按位 JSON 比对，变了才逐条 wb:entryPut（host 单条 upsert；条目删除场景
// entryPut 无法表达——诚实限制，注释标明）。
// 【2026-09-10 幂等修复】差量判定必须只比"host 真正落盘的字段"。
// 原实现直接 JSON.stringify(next[i]) vs JSON.stringify(orig[i]) —— 但 thEnrichEntry 会
// 给条目注入 strategy/use_regex（host 侧 stEntryToLore 明确忽略、不落盘，见 facade.ts:886），
// 且把 position 由数字改写成对象。脚本只要读过一次条目（getLorebookEntries）再回传，
// 两侧形状就永久不等 → 恒等变换也产生 27 条 entryPut（实机实证）→ 250ms 队列永不收敛
// → 每秒 1 次 2.2MB lore.json 全量重写（实测 774 次 flush/6.5min，日志刷屏、事件循环被占）。
// 修复：仅在"可落盘规范形"上比对，命中才写；且写入前去掉注入的展示字段，避免脏字段回灌磁盘。
var WB_PERSIST_KEYS = ['uid', 'comment', 'content', 'key', 'keysecondary', 'selectiveLogic',
  'constant', 'selective', 'position', 'depth', 'role', 'scanDepth', 'preventRecursion',
  'excludeRecursion', 'order', 'sticky', 'cooldown', 'delay', 'group', 'groupOverride'];
function wbCanonical(e, i) {
  var out = {};
  if (!e || typeof e !== 'object') return out;
  for (var k = 0; k < WB_PERSIST_KEYS.length; k++) {
    var key = WB_PERSIST_KEYS[k];
    var v = e[key];
    if (key === 'uid') { v = (typeof v === 'number' && v >= 0) ? v : i; }
    if (key === 'position' && v && typeof v === 'object' && !Array.isArray(v)) v = v.type || 'before_char';
    out[key] = v === undefined ? null : v;
  }
  // 【2026-09-10】enabled/disabled 双字段归一：host 语义是
  //   enabled 显式给出则以它为准，否则回落 disabled（facade.ts:954）
  // 卡脚本惯例只改一个（spread 后只覆盖 enabled，disabled 仍是旧值）。
  // 若把两者当独立字段比对，单改 enabled 的变更会被判为"无差异"而静默丢失（本测试实证）。
  // 归一成一个布尔，优先级与 host 一致。
  var eff;
  if (typeof e.enabled === 'boolean') eff = e.enabled;
  else eff = e.disabled !== true;
  out['__enabled'] = eff;
  out.comment = e.comment != null ? e.comment : (e.name != null ? e.name : '');
  return out;
}
function wbCanonKey(e, i) { return JSON.stringify(wbCanonical(e, i)); }
/** 去掉 enrich 注入的展示字段再回传 host（否则 strategy/use_regex 会随 entry-put 回灌） */
function wbStripPresentation(e) {
  if (!e || typeof e !== 'object') return e;
  var c = {};
  for (var k = 0; k < WB_PERSIST_KEYS.length; k++) {
    var key = WB_PERSIST_KEYS[k];
    if (e[key] !== undefined) c[key] = e[key];
  }
  // key 兜底：脚本可能只改 keys（TH 别名）
  if (c.key === undefined && Array.isArray(e.keys)) c.key = e.keys;
  if (c.keysecondary === undefined && Array.isArray(e.secondaryKeys)) c.keysecondary = e.secondaryKeys;
  // 【2026-09-10】enabled/disabled 双写归一：host 取 (disabled!==true && enabled!==false)。
  // 脚本常只改一个字段，若原样回传另一个旧值，host 会以"两个都要满足"的方式算出意外结果
  // （例：改 enabled=false 但 disabled 旧值为 false → host 仍得 false，看似对；但
  // 改 enabled=true 而 disabled 旧值为 true → host 得 false，脚本意图被吞）。
  // 统一写出一致的两字段，消除这种隐性冲突。
  var eff = wbCanonical(e, 0)['__enabled'];
  c.enabled = eff;
  c.disabled = !eff;
  return c;
}
function updateWorldbookWith(name, fn) {
  return call('wb:get', [String(name)]).then(function (r) {
    var book = wbBookOf(r);
    var raw = (book && Array.isArray(book.entries)) ? book.entries : [];
    // 【2026-09-10 幂等修复 · 关键】必须先对"变更前"形状留快照。
    // 脚本惯例是 entries[i].xxx = v 原地改再返回同一数组引用 —— 若直接用 orig 参与比对，
    // 比的是同一个已被改写的对象，恒等 → 变更被静默吞掉（本修复前实测 0 写入）。
    var before = raw.map(function (e, i) { return wbCanonKey(e, i) });
    var orig = raw.map(function (e) { return e });   // 传给 fn 的仍是原对象（原地改语义保留）
    return Promise.resolve()
      .then(function () { return fn(orig); })
      .then(function (out) {
        var next = Array.isArray(out) ? out : orig;
        var puts = [];
        for (var i = 0; i < next.length; i++) {
          if (wbCanonKey(next[i], i) !== before[i]) puts.push(wbStripPresentation(next[i]));
        }
        if (puts.length === 0) return next;   // 无实质变更：零写入（幂等出口）
        return Promise.all(puts.map(function (e) { return call('wb:entryPut', [String(name), e]); }))
          .then(function () { return next; });
      });
  });
}
// 【实机审计修复 2026-09-05】P1 世界书写面（桥到 facade /worldbook/* 新端点）：
// getWorldbook 返回条目数组（真 TH 返回 WorldbookEntry[]；其 strategy/position 对象形状
// 不转换——诚实边界，条目为 ST World Info entry 形状，与 getLorebookEntries 同源）。
function getWorldbook(name) {
  return call('wb:get', [String(name)]).then(function (r) {
    var book = wbBookOf(r);
    var entries = (book && Array.isArray(book.entries)) ? book.entries : [];
    return entries.map(thEnrichEntry);
  });
}
// replaceLorebookEntries(name, entries)：ST World Info entry 形状数组整表替换（host 侧
// stEntryToLore 反转换后覆盖 lore.json entries）。
function replaceLorebookEntries(name, entries) {
  return call('wb:replaceEntries', [String(name), Array.isArray(entries) ? entries : []]).then(function () { return true; });
}
// rebindGlobalWorldbooks(names)：全局激活书单整组重绑（rp/global-books.json）。
function rebindGlobalWorldbooks(worldbookNames) {
  var names = Array.isArray(worldbookNames) ? worldbookNames.map(String) : [];
  return call('wb:rebindGlobal', [names]).then(function () { return true; });
}
// rebindCharWorldbooks(slug, names)：角色工作区书单整组重绑（rp/<slug>/rp.json 的 books）。
function rebindCharWorldbooks(slug, worldbookNames) {
  var names = Array.isArray(worldbookNames) ? worldbookNames.map(String) : [];
  return call('wb:rebindChar', [String(slug == null ? '' : slug), names]).then(function () { return true; });
}
// getOrCreateChatWorldbook()：会话绑定世界书名（缺则建；host 按运行时会话确定性定位
// rp/chat-worldbooks/<sessionId>.json）。
function getOrCreateChatWorldbook() {
  return call('wb:chatGetOrCreate', []).then(function (r) {
    return (r && typeof r.name === 'string') ? r.name : null;
  });
}

// ---- SillyTavern.getContext 门面（快照驱动、同步；缺的数据字段 undefined 保持形状）----

/**
 * 【T-48】renderExtensionTemplate(Async) 的**帧面转发**（真 TH 形态 = 帧面是父页门面的投影）。
 *
 * 为什么改成转发而不是自持实现：宿主页 host-vendor.ts 已承载**唯一**的真渲染实现
 * （Handlebars 编译 + DOMPurify 消毒 + /scripts/extensions/** 文件路由）；帧面再写一份
 * = 同语义第二副本（本仓铁律禁止），且两副本必然漂移。
 * 真 TH 的 iframe 面本来就是这个形态（iframe/predefine.js 的并入 getContext()）。
 *
 * 降级（父页门面不可达，如跨源/宿主页未装载）：**出声 + 返回 undefined** —— 不抛、不静默，
 * 与宿主侧失败路径同形（基准 catch 也是 console.error + toastr + 返回 undefined）。
 *
 * 【注意】本函数在 buildShimSource 的**模板串内部** —— 源码里**不能写反引号、也不能写
 * 「美元符号 + 花括号」的插值记号**（两者都会提前终止/污染模板串；本注释在 2026-09-12
 * 就因为用了反引号把整个 shim 变成解析错误）。
 *
 * 基准契约（SillyTavern-reference/public/scripts/extensions.js:137）：
 *   renderExtensionTemplateAsync(extName, templateId, data, sanitize, localize)
 *     = renderTemplateAsync('scripts/extensions/' + extName + '/' + templateId + '.html',
 *                           data, sanitize, localize, true)
 * 默认值：sanitize = true、localize = true；失败路径 console.error + toastr.error + 返回 undefined。
 */
function dshtRenderExtensionTemplateForward(api, extensionName, templateId, templateData, sanitize, localize) {
  var isAsync = api === 'renderExtensionTemplateAsync'
  /** 形状守卫：async 版**必须**返回 Promise（基准是 async 函数，调用方会 .then）；同步版返回 undefined */
  var fail = function (reason) {
    // 记名用**精确 API 名**（脚本管理面板按名归类；原因只进日志，不污染 API 名）
    reportMissing(api)
    try {
      console.error('Error rendering template', path, reason === 'parent-facade-unreachable'
        ? '父页门面不可达：parent.SillyTavern.getContext().' + api + ' 不可用（宿主页未装载门面或跨源）'
        : reason)
    } catch (e3) { /* 同上 */ }
    try {
      var t = (typeof window !== 'undefined' && window.toastr) ? window.toastr : null
      if (t && typeof t.error === 'function') t.error('Check the DevTools console for more information.', 'Error rendering template')
    } catch (e4) { /* toastr 不在 iframe 内也不影响返回形状 */ }
    return isAsync ? Promise.resolve(undefined) : undefined
  }
  var args = [
    extensionName, templateId,
    templateData === undefined ? {} : templateData,
    sanitize === undefined ? true : sanitize,
    localize === undefined ? true : localize,
  ]
  var path = 'scripts/extensions/' + String(extensionName || '') + '/' + String(templateId || '') + '.html'
  try {
    var par = (typeof window !== 'undefined' && window.parent) ? window.parent : null
    var st = par ? par.SillyTavern : null
    var c = (st && typeof st.getContext === 'function') ? st.getContext() : null
    var fn = c ? c[api] : null
    // 转发宿主唯一实现（不在帧面再造一条日志 —— parity 测试要求两侧各出一条）
    if (typeof fn === 'function') return fn.apply(c, args)
  } catch (e) {
    return fail('forward-threw:' + String((e && e.message) || e))
  }
  return fail('parent-facade-unreachable')
}

// ---- 【心跳 65 · T-74】当前聊天 id（单源）----
// 基准里 getContext().chatId（st-context.js:131-133）与 getCurrentChatId()（script.js:869）
// **是同一个表达式**：
//   selected_group ? groups.find(x => x.id == selected_group)?.chat_id : (characters[this_chid]?.chat)
// ⇒ 同源同值。我方此前只有后者、前者缺席（语料 8 次 / 6 文件取用，见 facade 内注释）。
// 抽成单实现两处共用（L82 三层收敛：先证**同语义**再合一，不是形状像就合）。
// ⚠️ 本区域在模板串内：注释里**禁用反引号**（会终止模板串 —— L70，已复现 5 次）。
function dshtCurrentChatId() {
  return (latestContext && latestContext.slug != null && typeof latestContext.slug === 'string')
    ? latestContext.slug
    : 'current';
}
// RFC4122 v4。实现形态逐字对齐基准 utils.js:1972（crypto.randomUUID 优先 + Math.random 兜底）。
// 为什么自建而不复用 host-vendor 的 defaultUuidv4：本 shim 跑在**脚本帧内**，
// 宿主面模块在另一侧（跨不过去，不可依赖）。
function dshtUuidv4() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) { }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function buildStContextFacade() {
  var ctx = getContext();
  var settings = (ctx.chatCompletionSettings && typeof ctx.chatCompletionSettings === 'object')
    ? ctx.chatCompletionSettings
    : { prompts: [], prompt_order: [] };
  var promptOrderList = Array.isArray(settings.prompt_order) ? settings.prompt_order : [];
  var prompts = Array.isArray(settings.prompts) ? settings.prompts : [];
  var messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  var charName = (ctx.character && typeof ctx.character === 'object' && ctx.character.name != null)
    ? ctx.character.name
    : undefined;
  return {
    chatCompletionSettings: settings,
    // 【卡自检 2026-09-08】真 ST 的 getContext() 含 extensionSettings（= extension_settings
    // 引用）——缺了它 Sol-3 系卡自检走 SillyTavern.getContext().extensionSettings.EjsTemplate
    // 直接 TypeError →「提示词模板 未检测到」。
    extensionSettings: __dshtExtSettings,
    extension_settings: __dshtExtSettings,
    promptManager: {
      activePreset: ctx.presetName != null ? ctx.presetName : undefined,
      getPromptOrderForCharacter: function () {
        var first = promptOrderList[0];
        return (first && Array.isArray(first.order)) ? first.order : [];
      },
      getPromptOrderItems: function () { return prompts; },
    },
    nameOverride: charName,
    characterName: charName,
    // 【心跳 64】真 ST 的 getContext() **含** name1/name2（st-context.js:120-121；
    // 宿主面 40 成员里两者都在，帧内此前**一个都没有** ⇒ 与基准不符，L36）。
    // 实测用法：getContext().name1（飞讯 0703）落到兜底字面量 {{user}}。
    // 两面（顶层 / getContext）取**同一份快照字段**，保证同源。
    name1: ctx.userName,
    name2: charName,
    // 【心跳 65 · T-74】chatId —— 基准 getContext() 成员（st-context.js:131-133），
    // 与 getCurrentChatId()（script.js:869）**同一个表达式** ⇒ 复用同一实现（单源）。
    // 实测用法（语料 8 次 / 6 文件，**全部无属性级守卫**）：
    //  · 示例卡乙预设族（启用中）: const ctx = SillyTavern?.getContext?.();
    //      if (ctx.chatId) return String(ctx.chatId);
    //    失败后的兜底链是 chat.file_name -> chatMetadata.file_name -> chatMetadata.chat_id -> name。
    //    而该链在我方**整条断裂**：我方 chat 是消息数组（无 file_name）、帧内无 chatMetadata
    //    ⇒ 最终落到 name。该值用于**聊天绑定校验**
    //    （String(parsed.boundChatId || '') === scope.chatId，scope 为该 getContext 的别名）
    //    ⇒ undefined 恒不等 ⇒ 绑定校验**恒失败**（静默产错值，非降级）。
    //  · 世界书控制 0708（当前活跃卡）: getContext().chatId || getContext().chat_id || ''
    //    ⇒ 静默降级为空串。
    // ⚠️ 同时出现的蛇形 chat_id **判「不补」**：基准全树 chat_metadata.chat_id **0 命中**
    //    （只有 chat_id_hash，macros.js:316/323；T-47 已对 chatMetadata.chat_id 同判）
    //    ⇒ 真 ST 也读 undefined，补空壳违反 L36 且是**制造假信息**。
    // ⚠️ 本区域在模板串内：注释里**禁用反引号**（会终止模板串 —— L70，已复现 5 次）。
    chatId: dshtCurrentChatId(),
    // 【心跳 65 · T-74】uuidv4 —— 基准 getContext() 成员（st-context.js:242，来自 utils.js:1972）。
    // 实测用法：帧内顶层直取 2 次 / 2 文件（梦鲸思客「格式补全 1.2」，**enabled**），无属性级守卫
    // （宿主面早有此成员：host-vendor.ts:533；帧面缺 ⇒ 同一门面两面不一致）。
    uuidv4: dshtUuidv4,
    // 【心跳 65 · T-75】mainApi —— 基准 getContext() 成员（st-context.js:206: mainApi: main_api）。
    // 第三方脚本把它当**后端分类标签**且是**硬闸门**（梦鲸思客「格式补全 1.2」，设备上 enabled）：
    //   'openai' !== SillyTavern.mainApi ? Promise.reject(new Error('当前 API 不是聊天补全…')) : 真正干活
    // 我方此前缺它 ⇒ undefined ⇒ 该比较恒 true ⇒ 直接 reject ⇒ 整条功能不可用（闸门式 fatal）。
    // 值取自 dsht-plugin-shared/st-compat.ts 的 DSHT_MAIN_API（**单源**，与宿主面同值）；
    // 为什么不补相邻的 onlineStatus：见该常量注释（我方缺省 undefined 恰好使那道闸门**放行**）。
    mainApi: ${JSON.stringify(DSHT_MAIN_API)},
    presetName: ctx.presetName != null ? ctx.presetName : undefined,
    chat: messages,
    chatLength: messages.length,
    // 【T-48】扩展模板渲染：帧面**转发**父页唯一实现（真 TH = 帧面投影 getContext）。
    // 基准有、我方现已实现（Handlebars + DOMPurify + /scripts/extensions/** 文件路由）。
    //   同步版基准已标 deprecated，语义同：失败同样返回 undefined。
    //   详见 dshtRenderExtensionTemplateForward 头注。
    renderExtensionTemplateAsync: function (extensionName, templateId, templateData, sanitize, localize) {
      return dshtRenderExtensionTemplateForward(
        'renderExtensionTemplateAsync', extensionName, templateId, templateData, sanitize, localize)
    },
    renderExtensionTemplate: function (extensionName, templateId, templateData, sanitize, localize) {
      return dshtRenderExtensionTemplateForward(
        'renderExtensionTemplate', extensionName, templateId, templateData, sanitize, localize)
    },
  };
}

// ---- 元信息 ----
// C18：getTavernVersion 返回 'dsht'+版本常量（移植标识；脚本版本判定应走 getTavernHelperVersion）
var TAVERN_VERSION = 'dsht-0.1.2';
function getTavernHelperVersion() { return ${JSON.stringify(opts.version)}; }
function getTavernVersion() { return TAVERN_VERSION; }
function getScriptId() { return SCRIPT_ID; }
function getScriptName() { return SCRIPT_NAME; }
function getCurrentCharPrimaryLorebook() { return call('lorebook:primary', []); }

// ---- C18 杂项：getLastMessageId（上下文快照同步读；空会话 -1）----
function getLastMessageId() {
  var ctx = (latestContext && typeof latestContext === 'object') ? latestContext : null;
  var msgs = (ctx && Array.isArray(ctx.messages)) ? ctx.messages : [];
  if (msgs.length === 0) return -1;
  var last = msgs[msgs.length - 1];
  return (last && typeof last.message_id === 'number') ? last.message_id : msgs.length - 1;
}

// ---- C18 杂项：triggerSlash——常用 STScript 子集最小映射 ----
// /echo /send /sendas /gen /abort 等 no-op（返回 null）；/getvar /setvar（含 global 变体）
// 走变量数据面；未知命令 console.warn + 记名后返回 null（不炸脚本）。
var SLASH_NOOP = {
  echo: true, send: true, sendas: true, comment: true, comments: true, nop: true, pass: true,
  gen: true, genraw: true, abort: true, abortgeneration: true, sleep: true, delay: true,
  flushvar: true, flushintervalvar: true, popup: true,
};
function triggerSlash(cmd) {
  var raw = String(cmd == null ? '' : cmd);
  var m = raw.match(/^\\s*\\/?([A-Za-z0-9_-]+)\\s*([\\s\\S]*)$/);
  if (!m) return Promise.resolve(null);
  var name = m[1].toLowerCase();
  var rest = m[2].replace(/^\\s+|\\s+$/g, '');
  if (SLASH_NOOP[name]) {
    if (name === 'echo' && rest) toastr.info(rest); // /echo → toastr 桥（host 面板可见）
    return Promise.resolve(null);
  }
  if (name === 'getvar' || name === 'getglobalvar') {
    var gpath = rest.split(/\\s+/)[0] || '';
    return getVariables({ type: name === 'getglobalvar' ? 'global' : 'chat' }).then(function (tree) {
      var cur = tree;
      var segs = gpath ? gpath.split('.') : [];
      for (var i = 0; i < segs.length; i++) {
        cur = (cur && typeof cur === 'object') ? cur[segs[i]] : undefined;
      }
      return (cur === undefined || cur === null) ? '' : String(cur);
    });
  }
  if (name === 'setvar' || name === 'setglobalvar') {
    var sp = rest.match(/^(\\S+)\\s+([\\s\\S]*)$/);
    if (!sp) return Promise.resolve(null);
    var vars = {};
    var node = vars;
    var segs2 = sp[1].split('.');
    for (var j = 0; j < segs2.length - 1; j++) { node[segs2[j]] = {}; node = node[segs2[j]]; }
    node[segs2[segs2.length - 1]] = sp[2];
    return insertOrAssignVariables(vars, { type: name === 'setglobalvar' ? 'global' : 'chat' }).then(function () { return null; });
  }
  try { console.warn('[TavernHelper shim] triggerSlash 未支持的斜杠命令: /' + name); } catch (e) {}
  reportMissing('triggerSlash:/' + name);
  return Promise.resolve(null);
}

// ---- C17 基础音频：bgm / ambient 双通道（HTMLAudioElement 单例；音量走 settings 可省）----
var __dshtAudioChannels = {};
function dshtAudioChannel(kind) {
  if (!__dshtAudioChannels[kind]) {
    var el = new Audio();
    el.loop = kind === 'bgm';
    __dshtAudioChannels[kind] = el;
  }
  return __dshtAudioChannels[kind];
}
var audio = {
  bgm: {
    play: function (url) {
      var el = dshtAudioChannel('bgm');
      el.src = String(url);
      // play() 可能被浏览器自动播放策略拒绝：吞掉 reject（返回 false），不让脚本标 failed
      return el.play().then(function () { return true; }).catch(function () { return false; });
    },
    stop: function () {
      var el = __dshtAudioChannels['bgm'];
      if (el) { el.pause(); el.removeAttribute('src'); }
      return Promise.resolve();
    },
  },
  ambient: {
    play: function (url) {
      var el = dshtAudioChannel('ambient');
      el.src = String(url);
      return el.play().then(function () { return true; }).catch(function () { return false; });
    },
    stop: function () {
      var el = __dshtAudioChannels['ambient'];
      if (el) { el.pause(); el.removeAttribute('src'); }
      return Promise.resolve();
    },
  },
};

// ---- C8 prompt 注入（桥到 host /inject /uninject → rp/th-injections/<sessionId>.json 存储）----
function injectPrompts(injections) {
  var list = Array.isArray(injections) ? injections : (injections ? [injections] : []);
  return call('injects:put', [list]).then(function () { return true; });
}
function uninjectPrompts(keys) {
  var list = Array.isArray(keys) ? keys : (keys ? [keys] : []);
  // ST 形态兼容：key 字符串数组或 Injection 对象数组（取 .key）
  var norm = [];
  for (var i = 0; i < list.length; i++) {
    var k = list[i];
    if (typeof k === 'string' && k) norm.push(k);
    else if (k && typeof k === 'object' && typeof k.key === 'string' && k.key) norm.push(k.key);
  }
  return call('injects:remove', [norm]).then(function () { return true; });
}

// ---- C9 生成通道（桥到 host /dsht-tavern-helper/generate → loopback /dsht-rp/llm/classify）----
// generate/generateRaw 均一次性补全：resolve 为生成文本字符串；失败 reject（桥错误）。
function generate(payload) {
  var p = (payload && typeof payload === 'object') ? payload : {};
  return call('generate', [String(p.system || ''), String(p.prompt || '')]).then(function (r) {
    return (r && typeof r === 'object' && typeof r.text === 'string') ? r.text : '';
  });
}
// 【2026-09-07 根修】generateRaw 真语义：完整 payload（ordered_prompts/user_input/injects/
// max_chat_history）过桥到宿主 /generate-raw 装配端点（世界书激活+人设+角色卡+聊天历史）。
// 旧实现丢弃 ordered_prompts 发空 prompt——飞讯 safeGenerate 三连败（似其形不明其义）。
function generateRaw(payload) { return call('generate:raw', [payload]).then(function (r) { return (r && typeof r === 'object' && typeof r.text === 'string') ? r.text : ''; }); }

// ---- 【P3a 2026-09-07】聊天写路径桥（此前记名拒绝——飞讯等卡脚本靠它写统合记录）----
// createChatMessages(messages, options)：ST 语义——{{宏}} 先过 substitudeMacros 桥；
// data 附加字段原样落楼层（getChatMessages 回读 data）；insert_before 仅支持 'end'
// （DSH 会话日志 append-only，历史插入会漂移——数字位置记名拒绝）。
// 返回新建楼层 message_id 数组（真 TH 同形）。
function createChatMessages(messages, options) {
  var list = Array.isArray(messages) ? messages : (messages ? [messages] : []);
  var o = (options && typeof options === 'object') ? options : {};
  var insertBefore = o.insert_before === undefined ? 'end' : o.insert_before;
  var expand = Promise.all(list.map(function (m) {
    var t = (m && typeof m.message === 'string') ? m.message : '';
    return (t.indexOf('{{') >= 0) ? substitudeMacros(t) : Promise.resolve(t);
  }));
  return expand.then(function (texts) {
    var payload = list.map(function (m, i) {
      return {
        role: (m && typeof m.role === 'string') ? m.role : 'system',
        message: texts[i],
        data: (m && m.data && typeof m.data === 'object') ? m.data : null,
      };
    });
    return call('chat:append', [payload, { insertBefore: insertBefore }]).then(function (r) {
      return (r && Array.isArray(r.messageIds)) ? r.messageIds : [];
    });
  });
}
// setChatMessages(messages, options)：按楼层改写（文本/数据字段可选）——seq 锚随
// getChatMessages 视图透传，host 走 compaction/prune + replace 单节点官方原语
// （模型视图与前端投影立即生效；事件留日志零丢失）。
function setChatMessages(messages, options) {
  void options;
  var list = Array.isArray(messages) ? messages : (messages ? [messages] : []);
  var targets = [];
  var unsupported = '';
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || typeof m !== 'object' || typeof m.message_id !== 'number') continue;
    // 【鲁棒轮 2026-09-09】is_hidden/swipe 字段原被静默丢弃 → 「批量隐藏楼层」（真 TH
    // 官方文档示例）假成功（targets 只剩 message_id，host 空改动返回 ok）。DSH 无楼层
    // 隐藏投影——诚实失败（记名 + __thExpected reject）优于假成功，文本/数据字段照常可用。
    if (unsupported === '') {
      if (m.is_hidden !== undefined) unsupported = 'is_hidden';
      else if (m.swipe_id !== undefined) unsupported = 'swipe_id';
      else if (m.swipes !== undefined) unsupported = 'swipes';
    }
    var t = { message_id: m.message_id };
    if (typeof m.seq === 'number') t.seq = m.seq;
    if (m.message !== undefined) t.message = String(m.message == null ? '' : m.message);
    if (m.data !== undefined) t.data = (m.data && typeof m.data === 'object') ? m.data : null;
    targets.push(t);
  }
  if (unsupported !== '') {
    reportMissing('setChatMessages:' + unsupported);
    var err = new Error('setChatMessages: 字段 ' + unsupported + ' 不受支持（DSH 无楼层隐藏/swipe 投影）——移除该字段后重试；文本与 data 字段照常可写');
    err.__thExpected = true;
    return Promise.reject(err);
  }
  if (targets.length === 0) return Promise.resolve(false);
  return call('chat:update', [targets]).then(function (r) { return !!(r && r.ok); });
}

// ---- 【实机审计修复 2026-09-05】P2 substitudeMacros（桥到 host /macros/expand 运行期宏展开）----
function substitudeMacros(text) {
  return call('macros:expand', [String(text == null ? '' : text)]).then(function (r) {
    return (r && typeof r.result === 'string') ? r.result : String(text == null ? '' : text);
  });
}

// ---- L1b（2026-09-06 hook 移植）：自定义宏注册（ST MacroRegistry.registerMacro / Luker macros.register）----
// 字符串模板形态：{{name}} 展开为 value（内层 {{…}} 由引擎迭代展开接着求值）。
// 注册即持久化（rp/macros.json），生成期（dsh-plugin）/预览（facade）/显示期（client）三端同源。
function registerMacro(name, value) {
  return call('macros:register', [String(name == null ? '' : name), String(value == null ? '' : value)])
    .then(function (r) { return !!(r && r.ok); });
}
function unregisterMacro(name) {
  return call('macros:unregister', [String(name == null ? '' : name)])
    .then(function (r) { return !!(r && r.ok); });
}

// ---- C7 registerVariableSchema（桥到 host /variables/schema → rp/state variableSchema）----
// 权威契约（JS-Slash-Runner @types/function/variables.d.ts:203-206）：
//   registerVariableSchema(schema: z.ZodType<any>, option: {type:'global'|'preset'|'character'|'chat'|'message'}): void
// 真 TH 收 zod schema：iframe vendor 有 zod v4，经 toJSONSchema 转纯对象过桥；
// 已是普通对象（JSON-Schema 形态）则原样传。
//
// 【阶段4 2026-09-11 修复 · 参数与语义双错】旧实现签名是 (name, schema)：卡按文档
// 调用 registerVariableSchema(z.object({...}), {type:'message'}) 时——
//   · arg0（zod 对象）被当 name → String() 得 "[object Object]"；
//   · arg1（scope 选项）被当 schema → 存成 variableSchema 的值。
// 实机产物即为 variableSchema.properties["[object Object]"] = {type:'message'}
// （rp/state/<sid>.json 实证），并被卡脚本读成 "Data Error"。
// 现在按契约取 (schema, option)：scope 仅 message/空 走整树（本 store 的 variables 根
// 就是消息楼层变量），其余作用域按作用域名分键保存。
function registerVariableSchema(schema, option) {
  var json = schema || null;
  try {
    if (json && typeof json === 'object' && typeof json.safeParse === 'function'
      && window.Zod && typeof window.Zod.toJSONSchema === 'function') {
      json = window.Zod.toJSONSchema(json);
    }
  } catch (e) { /* 转换失败按原样传（host 按 JSON-Schema 最小子集校验） */ }
  var scope = option && typeof option === 'object' && typeof option.type === 'string' ? option.type : 'message';
  if (['global', 'preset', 'character', 'chat', 'message'].indexOf(scope) === -1) scope = 'message';
  // message 作用域 = 本实现的唯一变量存储（rp/state/<sid>.json 的 variables 根）→ 传 ''
  // 表示「整树 schema」；其它作用域传作用域名（host 侧按名分键，不再产出 [object Object]）。
  return call('vars:schema', [scope === 'message' ? '' : scope, json]).then(function () { return true; });
}

// ---- toastr（桥到 host：console + 脚本面板日志）----
var toastr = {};
['info', 'success', 'warning', 'error'].forEach(function (level) {
  toastr[level] = function (message, title) {
    post({ th: 'toast', level: level, message: String(message), title: String(title || '') });
  };
});

// ---- C15 日志抽屉：console 转发（包装 console.*，本地照常输出 + post 给 host 汇入日志面板）----
function dshtFormatArg(a) {
  try { return (typeof a === 'string') ? a : JSON.stringify(a); } catch (e) { return String(a); }
}
['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
  var orig = console[level] ? console[level].bind(console) : function () {};
  console[level] = function () {
    var args = Array.prototype.slice.call(arguments);
    try { orig.apply(null, args); } catch (e2) { /* 原输出失败不影响转发 */ }
    try { post({ th: 'console', level: level, message: args.map(dshtFormatArg).join(' ') }); } catch (e) {}
  };
});

// ---- D6 window.Mvu（MVU 框架顶层面；真 TH 由 MVU bundle 挂到 parent）----
// getMvuData → mvu 桥（GET /dsht-mvu/variables 的 variables 树；message 类型同源返回——
// 无每消息变量树，诚实限制）；replaceMvuData → /dsht-mvu/variables/register {replace:true}。
//
// 【T-19 2026-09-11 真修】parseMessage 全量对齐 state/mvu.ts 的 parseUpdateVariable。
// 此前 TASK-LIST 声称「直调 state/mvu.ts（同源，非各写一份）」——**不成立**：本 shim 是
// **构建期注入的字符串**（buildShimSource 的模板串），根本没有 import 能力，实际是自写的
// 一份简化版，只认 <JSONPatch> 子块。写的时候还抄进了 state/mvu.ts 早已修掉的两个缺陷：
//   ① 用 .match() 单次匹配 → 一个 <UpdateVariable> 里多个 <JSONPatch> 只解析第一个，
//      其余静默丢失（2026-09-09 鲁棒轮已在 state/mvu.ts 改成 matchAll）；
//   ② 无 op 白名单 / 无 insert 的 index 并入 / 无 from 字段。
// 现按 state/mvu.ts 四来源逐条镜像：JSONPatch 子块 / <initvar> YAML 树 / _.set 系指令行 /
// 块外裸 JSONPatch。改动任一侧时**必须同步两处**（无法共享模块的硬约束）。
var DSHT_PATCH_OPS = { add: 1, replace: 1, remove: 1, delta: 1, move: 1, copy: 1, insert: 1 };
function dshtEncodeSeg(seg) { return String(seg).replace(/~/g, '~0').replace(/\\//g, '~1'); }
function dshtStripQuotes(s) {
  var t = String(s == null ? '' : s).trim();
  if (t.length >= 2) {
    var a = t.charAt(0), b = t.charAt(t.length - 1);
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '“' && b === '”')) return t.slice(1, -1);
  }
  return t;
}
/** 宽松取值：JSON.parse 成功即用，否则去引号按字符串（state/mvu.ts parseLooseValue） */
function dshtParseLooseValue(s) {
  var t = dshtStripQuotes(s);
  try { return JSON.parse(t); } catch (e) { return t; }
}
/** JSONPatch 子块提取（matchAll 合并全部块；op 白名单；insert 的 index 并入 path；from 透传） */
function dshtParseJsonPatches(text) {
  var blocks = [], m;
  var re = /<JSONPatch>\\s*([\\s\\S]*?)\\s*<\\/JSONPatch>/gi;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  if (blocks.length === 0) return [];
  var out = [];
  for (var i = 0; i < blocks.length; i++) {
    var arr;
    try { arr = JSON.parse(blocks[i]); } catch (e) { continue; }
    if (!Array.isArray(arr)) continue;
    for (var j = 0; j < arr.length; j++) {
      var p = arr[j];
      if (!p || typeof p !== 'object') continue;
      var opRaw = (p.op === undefined ? 'add' : String(p.op)).toLowerCase();
      if (!DSHT_PATCH_OPS[opRaw]) continue; // 白名单外丢弃（"test"/拼错的 "apend" 不得变真实写）
      var path = String(p.path === undefined ? '' : p.path);
      if (opRaw === 'insert' && typeof p.index === 'number' && p.index % 1 === 0 && !/\\/\\d+$/.test(path)) {
        path = path.replace(/\\/+$/, '') + '/' + p.index;
      }
      if (path.length === 0) continue;
      var patch = { op: opRaw, path: path };
      if (p.from !== undefined) patch.from = String(p.from);
      if (p.value !== undefined) patch.value = p.value;
      out.push(patch);
    }
  }
  return out;
}
/** initvar 叶值解析（引号优先；数字/bool/null 识别） */
function dshtParseYamlValue(raw) {
  var v = String(raw == null ? '' : raw).trim();
  var quoted = dshtStripQuotes(v);
  if (quoted !== v) return quoted;
  try { return JSON.parse(v); } catch (e) { /* 非 JSON，继续 */ }
  if (/^-?\\d+(\\.\\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  return v;
}
/** 轻量 YAML 树解析（initvar 用；缩进嵌套 + 一层 "- item" 数组；容忍全角冒号） */
function dshtParseYamlLite(src) {
  var raw = String(src).split(/\\r?\\n/), lines = [];
  for (var i = 0; i < raw.length; i++) {
    var l = raw[i].replace(/\\t/g, '  ');
    var t = l.trim();
    if (t !== '' && t.charAt(0) !== '#' && t !== '---') lines.push(l);
  }
  if (lines.length === 0) return null;
  var root = {}, stack = [{ indent: -1, obj: root }], pending = null, curArr = null;
  for (var k = 0; k < lines.length; k++) {
    var line = lines[k];
    var indent = line.length - line.replace(/^\\s+/, '').length;
    var s = line.trim();
    if (curArr && indent < curArr.indent) curArr = null;
    if (pending) {
      if (indent > pending.indent) {
        if (s.indexOf('- ') === 0) {
          var arr0 = [];
          pending.container[pending.key] = arr0;
          curArr = { indent: indent, arr: arr0 };
          var item0 = s.slice(2).trim();
          if (item0) arr0.push(dshtParseYamlValue(item0));
          pending = null;
          continue;
        }
        var child = {};
        pending.container[pending.key] = child;
        stack.push({ indent: pending.indent, obj: child });
        pending = null;
      } else {
        pending.container[pending.key] = {};
        pending = null;
      }
    }
    if (s.indexOf('- ') === 0) {
      if (curArr && indent >= curArr.indent) {
        var item = s.slice(2).trim();
        if (item) curArr.arr.push(dshtParseYamlValue(item));
      }
      continue;
    }
    var ci = s.search(/[:：]/);
    if (ci < 0) continue;
    var key = s.slice(0, ci).trim().replace(/^["'“]|["'”]$/g, '');
    var rawVal = s.slice(ci + 1).trim();
    if (!key) continue;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    var top = stack[stack.length - 1].obj;
    if (rawVal === '') { pending = { indent: indent, container: top, key: key }; continue; }
    top[key] = dshtParseYamlValue(rawVal);
  }
  if (pending) pending.container[pending.key] = {};
  return root;
}
/** initvar 树叶子展开（嵌套对象递归；叶子 = 标量/数组；顶层键的 add/replace 判定向下传递） */
function dshtFlattenYamlLeaves(obj, prefix, op) {
  var out = [], keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var vv = obj[keys[i]];
    var path = prefix + '/' + dshtEncodeSeg(keys[i]);
    if (vv !== null && typeof vv === 'object' && !Array.isArray(vv)) {
      var sub = dshtFlattenYamlLeaves(vv, path, op);
      for (var j = 0; j < sub.length; j++) out.push(sub[j]);
    } else {
      out.push({ op: op, path: path, value: vv });
    }
  }
  return out;
}
/** <initvar> YAML 树 → set 型补丁序列（顶层键不存在则 add——initvar 的初始化语义） */
function dshtParseInitVarPatches(src, state) {
  var out = [], m;
  var re = /<initvar[^>]*>([\\s\\S]*?)<\\/initvar>/gi;
  while ((m = re.exec(src)) !== null) {
    var tree = dshtParseYamlLite(m[1]);
    if (!tree) continue;
    var keys = Object.keys(tree);
    for (var i = 0; i < keys.length; i++) {
      var sub2 = tree[keys[i]];
      var op = (state && !Object.prototype.hasOwnProperty.call(state, keys[i])) ? 'add' : 'replace';
      var path = '/' + dshtEncodeSeg(keys[i]);
      if (sub2 === null || typeof sub2 !== 'object' || Array.isArray(sub2)) {
        out.push({ op: op, path: path, value: sub2 });
        continue;
      }
      var leaves = dshtFlattenYamlLeaves(sub2, path, op);
      if (leaves.length === 0) out.push({ op: op, path: path, value: {} });
      else for (var j = 0; j < leaves.length; j++) out.push(leaves[j]);
    }
  }
  return out;
}
/** 引号感知的顶层逗号切分（半角/全角逗号；引号内逗号不切） */
function dshtSplitTopLevelArgs(s) {
  var out = [], cur = '', q = null;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '“') { q = '”'; cur += ch; continue; }
    if (ch === ',' || ch === '，') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur);
  return out;
}
/** 点号路径 → JSONPointer（stat_data.好感度 → /stat_data/好感度；已 / 开头原样） */
function dshtDotToPointer(dotPath) {
  var p = dshtStripQuotes(dotPath);
  if (!p) return '';
  if (p.charAt(0) === '/') return p;
  var segs = p.split('.'), kept = [];
  for (var i = 0; i < segs.length; i++) { var t = segs[i].trim(); if (t) kept.push(dshtEncodeSeg(t)); }
  return kept.length > 0 ? '/' + kept.join('/') : '';
}
/** _.set/_.add/_.inc/_.dec 指令行（set→replace；add/inc/dec→delta；容忍全角括号/分号/引号） */
function dshtParseUnderscoreCommands(text) {
  var out = [], lines = String(text).split(/\\r?\\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^\\s*_\\s*\\.\\s*(set|add|inc|dec)\\s*[（(](.*)[)）]\\s*;?\\s*$/.exec(lines[i].trim());
    if (!m) continue;
    var kind = m[1].toLowerCase();
    var parts = dshtSplitTopLevelArgs(m[2]), kept = [];
    for (var j = 0; j < parts.length; j++) { var t = parts[j].trim(); if (t !== '') kept.push(t); }
    if (kept.length === 0) continue;
    var path = dshtDotToPointer(kept[0]);
    if (!path) continue;
    if (kind === 'set' || kind === 'add') {
      if (kept.length < 2) continue;
      out.push({ op: kind === 'set' ? 'replace' : 'delta', path: path, value: dshtParseLooseValue(kept.slice(1).join(',')) });
    } else {
      var step = kept.length >= 2 ? Number(dshtStripQuotes(kept[1])) : 1;
      var n = isFinite(step) ? step : 1;
      out.push({ op: 'delta', path: path, value: kind === 'inc' ? n : -n });
    }
  }
  return out;
}
/** 四来源全量解析（与 state/mvu.ts parseUpdateVariable 逐条等价） */
function dshtParseUpdateVariable(text, state) {
  var out = [], covered = [], m;
  var re = /<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi;
  while ((m = re.exec(text)) !== null) {
    var src = m[1], x;
    var a = dshtParseJsonPatches(src); for (x = 0; x < a.length; x++) out.push(a[x]);
    var b = dshtParseInitVarPatches(src, state); for (x = 0; x < b.length; x++) out.push(b[x]);
    var c = dshtParseUnderscoreCommands(src); for (x = 0; x < c.length; x++) out.push(c[x]);
    covered.push([m.index, re.lastIndex]);
  }
  // 块外裸 <JSONPatch> 兜底（只在覆盖区间之外的文本上解析，避免与块内重复）
  var outside = '', start = 0, i2;
  for (i2 = 0; i2 < covered.length; i2++) { outside += text.slice(start, covered[i2][0]); start = covered[i2][1]; }
  outside += covered.length > 0 ? text.slice(start) : text;
  var y;
  if (covered.length === 0) {
    var a2 = dshtParseJsonPatches(text); for (y = 0; y < a2.length; y++) out.push(a2[y]);
    var b2 = dshtParseInitVarPatches(text, state); for (y = 0; y < b2.length; y++) out.push(b2[y]);
    var c2 = dshtParseUnderscoreCommands(text); for (y = 0; y < c2.length; y++) out.push(c2[y]);
  } else if (outside.length > 0) {
    var a3 = dshtParseJsonPatches(outside); for (y = 0; y < a3.length; y++) out.push(a3[y]);
  }
  return out;
}
var mvuBusListeners = {};
/**
 * MVU 框架自带的**第 4 个事件命名空间**（T-81）。
 *
 * 为什么必须有：卡事件面闸门此前只扫 3 张 ST 表（tavern_events / iframe_events /
 * event_types），而 MVU bundle 自己导出 Mvu.events.*（权威契约 =
 * JS-Slash-Runner/@types/iframe/exported.mvu.d.ts:70-118），卡在它上面注册事件
 * （语料实测 eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb) 3 个文件）。
 * shim 原实现此对象**一个常量都没有** ⇒ evt === undefined ⇒ String(undefined) === 'undefined'
 * ⇒ 静默注册到 'undefined' 键：注册"成功"、零报错、回调永不执行（静默失败族最坏形态）。
 *
 * ⚠️ VARIABLE_INITIALIZED 的值 'mag_variable_initiailized' 是**上游拼写错误**，
 * 必须逐字照抄 —— "修正"它 = 与真 MVU 的事件值不一致 ⇒ 回调同样永不触发，且更难查。
 */
var MVU_EVENT_CONSTANTS = {
  VARIABLE_INITIALIZED: 'mag_variable_initiailized',
  VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
  COMMAND_PARSED: 'mag_command_parsed',
  VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
  BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
};
/**
 * 我方**结构性不发射**的 mag_* 事件（T-81）：MVU 变量更新发生在 host 主线程的
 * state/mvu.ts 管线里，沙箱侧没有 MVU bundle 的投递点。注册成功但回调永不执行 ⇒
 * 必须**明示降级**（L42：有意降级 ≠ 可以静默），否则排查线索为零。
 */
var MVU_UNEMITTED = MVU_EVENT_CONSTANTS;
var mvuUnemittedWarned = {};
var Mvu = {
  getMvuData: function (option) {
    var type = (option && option.type === 'message') ? 'message' : 'chat';
    return call('mvu:data', [type]);
  },
  replaceMvuData: function (data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    return call('mvu:replace', [d]).then(function () { return true; });
  },
  parseMessage: function (text) { return dshtParseUpdateVariable(String(text == null ? '' : text)); },
  isDuringExtraAnalysis: function () { return false; }, // 额外解析在 host 主线程排程，沙箱侧恒 false
  events: {
    on: function (evt, fn) {
      var k = String(evt);
      (mvuBusListeners[k] = mvuBusListeners[k] || []).push(fn);
      return function () {
        var l = mvuBusListeners[k] || [];
        var i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      };
    },
    emit: function (evt) {
      var args = Array.prototype.slice.call(arguments, 1);
      var l = (mvuBusListeners[String(evt)] || []).slice();
      for (var i = 0; i < l.length; i++) {
        try { l[i].apply(null, args); } catch (e) { console.error('[Mvu shim] 事件监听器异常(' + String(evt) + '):', e); }
      }
    },
  },
};
// 常量**加法式**挂上 events（on/emit 保留；见 T-81 头注）
for (var mvuEvtKey in MVU_EVENT_CONSTANTS) {
  if (Object.prototype.hasOwnProperty.call(MVU_EVENT_CONSTANTS, mvuEvtKey)) {
    Mvu.events[mvuEvtKey] = MVU_EVENT_CONSTANTS[mvuEvtKey];
  }
}

// ---- 不支持 API stub（记名 + reject；err.__thExpected 防误报 failed）----
function unsupportedStub(name) {
  var label = String(name).indexOf('TavernHelper.') === 0 ? String(name) : 'TavernHelper.' + name;
  var reason = unsupportedReasons[name] || '钩 ST 内部组件，无法沙箱移植';
  return function () {
    reportMissing(name);
    var err = new Error(label + ' 未在 DSH 移植中支持：' + reason);
    err.__thExpected = true;
    return Promise.reject(err);
  };
}

var TH = {
  eventOn: eventOn, eventOnce: eventOnce, eventEmit: eventEmit, eventEmitAndWait: eventEmitAndWait,
  eventRemoveListener: eventRemoveListener, eventClearEvent: eventClearEvent, eventClearAll: eventClearAll,
  eventMakeFirst: eventMakeFirst, eventMakeLast: eventMakeLast,
  eventClearListener: eventClearListener,
  eventOnButton: eventOnButton, getButtonEvent: getButtonEvent,
  getVariables: getVariables, getAllVariables: getAllVariables, insertVariables: insertVariables,
  insertOrAssignVariables: insertOrAssignVariables, updateVariablesWith: updateVariablesWith,
  replaceVariables: replaceVariables, deleteVariable: deleteVariable,
  getScriptButtons: getScriptButtons, replaceScriptButtons: replaceScriptButtons,
  updateScriptButtonsWith: updateScriptButtonsWith, appendInexistentScriptButtons: appendInexistentScriptButtons,
  getTavernHelperVersion: getTavernHelperVersion, getTavernVersion: getTavernVersion,
  getScriptId: getScriptId, getScriptName: getScriptName,
  getCurrentCharPrimaryLorebook: getCurrentCharPrimaryLorebook,
  getCharWorldbookNames: getCharWorldbookNames,
  // C18 杂项
  getLastMessageId: getLastMessageId, triggerSlash: triggerSlash,
  // C17 基础音频（对象：audio.bgm / audio.ambient）
  audio: audio,
  // C7 / C8 / C9（桥实现）
  registerVariableSchema: registerVariableSchema,
  injectPrompts: injectPrompts, uninjectPrompts: uninjectPrompts,
  generate: generate, generateRaw: generateRaw,
  getContext: getContext,
  getPresetNames: getPresetNames, getPreset: getPreset, getLoadedPresetName: getLoadedPresetName,
  presetExists: presetExists, createPreset: createPreset, createOrReplacePreset: createOrReplacePreset,
  replacePreset: replacePreset, setPreset: setPreset, deletePreset: deletePreset, renamePreset: renamePreset,
  loadPreset: loadPreset, updatePresetWith: updatePresetWith,
  isPresetNormalPrompt: isPresetNormalPrompt, isPresetPlaceholderPrompt: isPresetPlaceholderPrompt,
  isPresetSystemPrompt: isPresetSystemPrompt,
  getChatMessages: getChatMessages, getChatMessage: getChatMessage,
  // 【P3a 2026-09-07】聊天写路径桥（飞讯统合记录等）
  createChatMessages: createChatMessages, setChatMessages: setChatMessages,
  getTavernRegexes: getTavernRegexes, replaceTavernRegexes: replaceTavernRegexes,
  // 【实机审计修复 2026-09-05】P1/P2 长尾 API
  getChatHistoryBrief: getChatHistoryBrief, getChatHistoryDetail: getChatHistoryDetail,
  updateTavernRegexesWith: updateTavernRegexesWith,
  formatAsTavernRegexedString: formatAsTavernRegexedString, isCharacterTavernRegexesEnabled: isCharacterTavernRegexesEnabled,
  getWorldbook: getWorldbook, replaceLorebookEntries: replaceLorebookEntries,
  rebindGlobalWorldbooks: rebindGlobalWorldbooks, rebindCharWorldbooks: rebindCharWorldbooks,
  getOrCreateChatWorldbook: getOrCreateChatWorldbook,
  substitudeMacros: substitudeMacros,
  registerMacro: registerMacro, unregisterMacro: unregisterMacro,
  getWorldbooks: getWorldbooks, getLorebookEntries: getLorebookEntries,
  updateWorldbookWith: updateWorldbookWith,
  tavern_events: tavern_events, iframe_events: iframe_events, toastr: toastr,
};
var unsupported = ${unsupportedJs};
var unsupportedReasons = ${unsupportedReasonsJs};
for (var ui = 0; ui < unsupported.length; ui++) { TH[unsupported[ui]] = unsupportedStub(unsupported[ui]); }

window.TavernHelper = new Proxy(TH, {
  get: function (target, key) {
    if (typeof key === 'string' && !(key in target)) {
      reportMissing('TavernHelper.' + key);
      return unsupportedStub('TavernHelper.' + key);
    }
    return target[key];
  },
});

// 【2026-09-07】waitGlobalInitialized（MVU 生态脚本的全局等待助手，真 TH/MVU 框架
// 环境自带）——轮询 window[name] 出现即 resolve；超时 reject。缺它 → 剧情逻辑脚本
// await waitGlobalInitialized('Mvu') 抛 ReferenceError → 误报「MVU Framework not found」
// 后整段初始化 return（按钮/监听全不装）。
window.waitGlobalInitialized = function (name, timeoutMs) {
  var limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000;
  return new Promise(function (resolve, reject) {
    var t0 = Date.now();
    var tick = function () {
      var g = window[name];
      if (g !== undefined && g !== null) { resolve(g); return; }
      if (Date.now() - t0 > limit) { reject(new Error('waitGlobalInitialized timeout: ' + String(name))); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
};

// ---- 【Kemini 适配 2026-09-08】builtin 门面（JS-Slash-Runner 的 globalThis.builtin 等价物）----
// Kemini Dramatron 等预设脚本在「切换正则/预设后」调
// builtin.reloadAndRenderChatWithoutEvents() 重渲染已上屏消息（缺它 → 切了开关画面没反应，
// 用户以为适配坏了）。实现：桥到宿主 displayReload（invalidateWsCache + display epoch bump，
// 消息楼层重跑 display 正则管线）。reloadIframe 真语义是重载脚本自身 iframe——沙箱内按
// location.reload 等价处理（srcdoc 帧自重载）；waitGlobalInitialized 已有同名全局。
window.builtin = {
  reloadAndRenderChatWithoutEvents: function () {
    return call('display:reload', []).then(function () { return true; }).catch(function () { return false; });
  },
  reloadIframe: function () {
    try { window.location.reload(); } catch (e) { /* srcdoc 帧 reload 受限即 no-op */ }
    return Promise.resolve(true);
  },
};

// 裸全局（真 TH predefine.js 同款行为：脚本写 getVariables(...) 不带 TavernHelper. 前缀）
var bareGlobals = ${bareGlobalsJs};
for (var li = 0; li < bareGlobals.length; li++) {
  var ln = bareGlobals[li];
  if (typeof TH[ln] === 'function') window[ln] = TH[ln];
}
window.tavern_events = tavern_events;
window.iframe_events = iframe_events;
window.toastr = toastr;
window.Mvu = Mvu; // D6：MVU 框架顶层面
for (var gi = 0; gi < unsupported.length; gi++) { window[unsupported[gi]] = TH[unsupported[gi]]; }
window.audio = audio; // C17：对象型 API 不在函数型裸全局循环里，单独挂

// SillyTavern 门面（快照驱动、同步；缺的数据字段 undefined 保持形状——不再抛错记名）。
// extensionSettings：SoliUmbra 等脚本写 SillyTavern.extensionSettings.xxx（ST 全局
// extension_settings 的等价物）。localStorage 持久化 + 同源全部脚本 iframe 共享一份；
// Proxy set/delete 即时落盘（真 ST 由 saveSettingsDebounced 延迟保存，此处从简不丢数据）。
// 其余 ST 面：MVU bundle 顶层会 _.debounce(SillyTavern.saveChat)、读 SillyTavern.chat /
// getCurrentChatId()——缺任一整个 module eval 崩（Mvu 挂不上 parent → 「MVU Framework not
// found」）。这里给出 bundle 实际触碰的 ST 表面（读多写少；写路径归宿主，沙箱内 no-op）。
var __dshtExtBase = {};
try { __dshtExtBase = JSON.parse(localStorage.getItem('__dsht_extension_settings') || '{}') || {}; } catch (e) { __dshtExtBase = {}; }
// 【心跳 58 · T-42 收口 · 同族副本】ST 全局正则键的形状兜底（与宿主 host-vendor 的
// seedHostExtensionSettings 同判据，逐字对齐 ST extensions.js:178 的默认值 +
// extensions/regex/index.js:1713 init() 的 !Array.isArray 兜底）。
// 宿主侧是卡的 inject.js（跑在宿主页）读 ctx.extensionSettings.regex；
// 本侧是 iframe 内脚本读 SillyTavern.extensionSettings.regex —— 两侧是**各自独立的副本**
//（同一 localStorage 键，但各自在启动时读一次），只改一侧 = L61 的"假修"。
// 铁律提醒：本文件整段是构建期模板串，此处不得出现反引号 / 正则字面量。
var __dshtExtSeedChanged = false;
if (!Array.isArray(__dshtExtBase['regex'])) { __dshtExtBase['regex'] = []; __dshtExtSeedChanged = true; }
if (!Array.isArray(__dshtExtBase['regex_presets'])) { __dshtExtBase['regex_presets'] = []; __dshtExtSeedChanged = true; }
if (__dshtExtSeedChanged) {
  try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(__dshtExtBase)) } catch (e) { }
}
var __dshtExtSettings = new Proxy(__dshtExtBase, {
  set: function (t, k, v) { t[k] = v; try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(t)) } catch (e) { /* 配额满等：内存保留 */ } return true },
  deleteProperty: function (t, k) { delete t[k]; try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(t)) } catch (e) { } return true },
})
// 【卡自检 2026-09-08】ST-Prompt-Template（提示词模板扩展）把设置落在
// extension_settings.EjsTemplate（真扩展 ui.ts loadSettings 的键名与 ST 默认值 1:1）。
// 卡自检（Sol-3 系「提示词模板 未检测到」）探测的就是这个键 + globalThis.EjsTemplate
// 全局——两者缺一即「未检测到」。这里用扩展真默认值预种（engine 功能面归宿主
// /dsht-prompt-template/* 数据面，见下方 EjsTemplate 门面）。
if (!__dshtExtBase['EjsTemplate'] || typeof __dshtExtBase['EjsTemplate'] !== 'object') {
  __dshtExtBase['EjsTemplate'] = {
    enabled: true, generate_enabled: true, generate_loader_enabled: true,
    render_enabled: true, render_loader_enabled: true, with_context_disabled: false,
    debug_enabled: false, autosave_enabled: false, preload_worldinfo_enabled: true,
    code_blocks_enabled: false, raw_message_evaluation_enabled: true,
    filter_message_enabled: true, cache_enabled: 0, cache_size: 64,
    cache_hasher: 'h32ToString', inject_loader_enabled: false, invert_enabled: true,
    depth_limit: -1, compile_workers: false, sandbox: false, code_editor: false,
    preload_only: true,
  }
  try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(__dshtExtBase)) } catch (e) { }
}
// ST 原始 chat 消息投影（{mes, swipe_id, swipes, variables}）——MVU 读 message.variables[swipe_id]。
// 注意：投影对象上的变量写入不回写宿主（会话变量持久化走 vars 桥 get/insertVariables）。
function __dshtStChat() {
  var ctx = (latestContext && typeof latestContext === 'object') ? latestContext : null;
  var msgs = (ctx && Array.isArray(ctx.messages)) ? ctx.messages : [];
  return msgs.map(function (m) {
    return {
      mes: (m && m.message != null) ? m.message : '',
      swipe_id: (m && m.swipe_id != null) ? m.swipe_id : 0,
      swipes: (m && Array.isArray(m.swipes)) ? m.swipes : undefined,
      variables: (m && m.variables && typeof m.variables === 'object') ? m.variables : {},
      name: m && m.name, is_user: m && m.is_user, is_system: m && m.is_system,
    };
  });
}
Object.defineProperty(window, 'SillyTavern', {
  get: function () {
    var ctx = buildStContextFacade();
    return {
      getContext: function () { return buildStContextFacade(); },
      extensionSettings: __dshtExtSettings,
      extension_settings: __dshtExtSettings,
      // —— 生成/持久化写路径：宿主自管，沙箱内 no-op ——
      saveChat: function () { return Promise.resolve(); },
      saveSettingsDebounced: function () { },
      // —— MVU 顶层数据面 ——
      chat: __dshtStChat(),
      chatCompletionSettings: ctx.chatCompletionSettings,
      // 【心跳 64】真 ST 的顶层 window.SillyTavern **≡ getContext() 展开**
      //（基准 iframe/predefine.js:26-35 的父页投影逐字就是 { ...getContext(), getContext }）
      // ⇒ 顶层与 getContext 面**两面都含** name1/name2。帧内此前只有 name2，
      // 而「世界书控制 0708」（当前活跃卡）用 SillyTavern.name1 **顶层直取**
      // 且**只有对象级守卫** ⇒ 取到 undefined ⇒ 渲染出 "undefined: 内容"。
      // 值同源于快照字段 userName（与 getContext 面**同一份**，不各写一遍）。
      name1: ctx.name1,
      name2: ctx.characterName,
      // 【心跳 65 · T-74】与 getContext 面**同源**（基准顶层 ≡ {...getContext(), getContext}，
      // iframe/predefine.js:26-35）——两个成员都取自同一份 facade 对象，不各写一遍。
      chatId: ctx.chatId,
      uuidv4: ctx.uuidv4,
      // 【心跳 65 · T-75】与 getContext 面同源（基准顶层 ≡ {...getContext(), getContext}）。
      mainApi: ctx.mainApi,
      // 【心跳 65 · T-74】改走单源 helper（与 getContext 面的 chatId 共用同一实现）。
      getCurrentChatId: function () { return dshtCurrentChatId(); },
      // 【T-48】扩展模板渲染：顶层与 getContext 面**同源**（基准 iframe/predefine.js:26-35 的
      // 顶层 ≡ { ...getContext(), getContext } 投影）⇒ 两面都转发父页唯一实现。
      renderExtensionTemplateAsync: function (extensionName, templateId, templateData, sanitize, localize) {
        return dshtRenderExtensionTemplateForward(
          'renderExtensionTemplateAsync', extensionName, templateId, templateData, sanitize, localize)
      },
      renderExtensionTemplate: function (extensionName, templateId, templateData, sanitize, localize) {
        return dshtRenderExtensionTemplateForward(
          'renderExtensionTemplate', extensionName, templateId, templateData, sanitize, localize)
      },
      // —— 弹窗（沙箱无 UI，TEXT/ALERT 自动确认；CONFIRM 保守取消并 console 记名）——
      POPUP_TYPE: { TEXT: 'text', CONFIRM: 'confirm', INPUT: 'input', DISPLAY: 'display' },
      POPUP_RESULT: { NEGATIVE: 0, AFFIRMATIVE: 1, CANCELLED: 2 },
      callGenericPopup: function (type) {
        try { console.info('[SillyTavern shim] callGenericPopup(' + String(type) + ') 沙箱无 UI：TEXT/DISPLAY 自动确认，CONFIRM 取消'); } catch (e) { }
        return Promise.resolve(type === 'confirm' ? 2 : 1);
      },
      // —— 工具注册 / 宏 / 杂项 ——
      ToolManager: { registerFunctionTool: function () { }, unregisterFunctionTool: function () { }, getFunctionTools: function () { return []; } },
      registerMacro: function () { }, unregisterMacro: function () { },
      getCurrentLocale: function () { return 'zh-cn'; },
      getChatCompletionModel: function () { return undefined; },
      getRequestHeaders: function () { return {}; },
      // loadWorldInfo（ST world_info 原始形状 {entries:{uid:entry}}）：MVU 角色覆写配置
      // （[config_override] 禁用条目）从这读。桥 wb:get 的 entries 数组 → uid 键对象；
      // displayIndex（MVU sortBy 用）缺省取 insertionOrder/下标；disable ← enabled 取反。
      loadWorldInfo: function (name) {
        return call('wb:get', [String(name)]).then(function (r) {
          var book = wbBookOf(r);
          if (!book || !Array.isArray(book.entries) || book.entries.length === 0) return null;
          var obj = {};
          for (var i = 0; i < book.entries.length; i++) {
            var en = book.entries[i] || {};
            if (typeof en.displayIndex !== 'number') en.displayIndex = (typeof en.insertionOrder === 'number') ? en.insertionOrder : i;
            if (typeof en.disable !== 'boolean') en.disable = en.enabled === false;
            obj[en.uid != null ? en.uid : i] = en;
          }
          return { name: (typeof book.name === 'string' && book.name) ? book.name : String(name), entries: obj };
        });
      },
      getCharacterCardFields: function () { return Promise.resolve({}); },
      characters: [], characterId: -1,
    };
  },
  configurable: true,
});
window.extension_settings = __dshtExtSettings;

// ---- EjsTemplate 全局门面（ST-Prompt-Template 扩展的 globalThis.EjsTemplate 等价物）----
// 【卡自检 2026-09-08】Sol-3 系卡自检「提示词模板」探测 globalThis.EjsTemplate /
// extension_settings.EjsTemplate（真扩展 exports.ts init 挂的全局 + ui.ts 的设置键）。
// 功能面：evalTemplate/getFeatures/setFeatures/resetFeatures/compileTemplate 走宿主
// /dsht-prompt-template/* 数据面（iframe 与宿主同源，fetch 可达）；allVariables 走变量桥；
// 其余扩展内部面（prepareContext/refreshWorldInfo/finalization 等）诚实 no-op + console 记名。
var __dshtEjsFetch = function (method, sub, body) {
  // 【鲁棒轮 2026-09-09】加 20s 超时（与 call() 桥对齐）——裸 fetch 无超时，宿主路由挂死
  // （连接池耗尽/渲染 worker 卡死）时 await evalTemplate 永久 pending（示例游戏「读取剧情数据」同病）。
  return fetch('/dsht-prompt-template/' + sub, {
    method: method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined,
  }).then(function (r) { return r.json().catch(function () { return {} }) })
}
var __dshtEjsMissing = function (name) {
  return function () {
    try { console.warn('[EjsTemplate shim] ' + name + ' 沙箱未实现（扩展内部面），返回 null') } catch (e) { }
    return Promise.resolve(null)
  }
}
var EjsTemplateFacade = {
  evalTemplate: function (code, context, options) {
    return __dshtEjsFetch('POST', 'render', { template: String(code == null ? '' : code), context: context ?? {}, options: options ?? {} })
      .then(function (j) {
        if (j && typeof j.result === 'string') return j.result
        throw new Error(String((j && j.error) || 'EjsTemplate.evalTemplate 渲染失败'))
      })
  },
  getSyntaxErrorInfo: function () { return null },
  setFeatures: function (features) {
    if (features && typeof features === 'object') {
      try {
        var cur = __dshtExtBase['EjsTemplate'] || {}
        __dshtExtBase['EjsTemplate'] = Object.assign({}, cur, features)
        try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(__dshtExtBase)) } catch (e) { }
      } catch (e) { }
    }
    return Promise.resolve()
  },
  getFeatures: function () {
    var cur = __dshtExtBase['EjsTemplate']
    return Promise.resolve(cur && typeof cur === 'object' ? Object.assign({}, cur) : {})
  },
  resetFeatures: function () {
    delete __dshtExtBase['EjsTemplate'] // 下个脚本帧启动时按 ST 默认值重种
    try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(__dshtExtBase)) } catch (e) { }
    return Promise.resolve()
  },
  allVariables: function () {
    return getVariables({ type: 'global' }).catch(function () { return {} })
  },
  saveVariables: __dshtEjsMissing('saveVariables'),
  prepareContext: __dshtEjsMissing('prepareContext'),
  refreshWorldInfo: __dshtEjsMissing('refreshWorldInfo'),
  parseJSON: function (text) {
    try { return JSON.parse(String(text)) } catch (e) { return null }
  },
  jsonPatch: __dshtEjsMissing('jsonPatch'),
  compileTemplate: __dshtEjsMissing('compileTemplate'),
  finalization: __dshtEjsMissing('finalization'),
}
Object.defineProperty(window, 'EjsTemplate', {
  get: function () { return EjsTemplateFacade },
  configurable: true,
})

// ---- 桥回包 / 事件投递 ----
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d[TAG] !== true || d.secret !== SECRET) return;
  try { (window.__dshtRecvLog = window.__dshtRecvLog || []).push({ th: d.th, callId: d.callId, ok: d.ok, t: Date.now() }); if (window.__dshtRecvLog.length > 60) window.__dshtRecvLog.shift(); } catch (e2) {}
  if (d.th === 'result') {
    var p = pending.get(d.callId);
    if (!p) return;
    pending.delete(d.callId);
    if (d.ok) p.resolve(d.value);
    else { var err = new Error(String(d.error || 'bridge call failed')); err.__thExpected = true; p.reject(err); }
  } else if (d.th === 'context') {
    // host 主动推送上下文快照：getContext / SillyTavern.getContext 门面同步读
    applyContextSnapshot(d.context);
  } else if (d.th === 'event') {
    dispatch(String(d.eventType), Array.isArray(d.args) ? d.args : []);
  }
});

// ---- 错误捕获（上报 host 诊断；不翻转 running 状态——【2026-09-07 根修】此前
// unhandledrejection 也发 failed，卡脚本启动期的异步 rejection（早于 ready 信标）
// 会把 phase 钉死在 failed → 按钮事件永久排队 → 「按钮点击无任何反应」（真机实证
// 全部 6 脚本 failed）。真 TH 语义：脚本抛错不摘除事件面，交互保持可用，错误仅记录）----
window.addEventListener('error', function (e) {
  post({ th: 'script-error', error: String((e && e.message) || 'script error') });
});
window.addEventListener('unhandledrejection', function (e) {
  var reason = e && e.reason;
  if (reason && reason.__thExpected) return; // shim 自己的不支持 API reject 不算失败
  post({ th: 'script-error', error: String((reason && reason.message) || reason || 'unhandled rejection') });
});

// pagehide 清事件（真 TH predefine.js 同款）
window.addEventListener('pagehide', function () { eventClearAll(); });

// ready 信标 + UI 自适应（trailing module 调）
window.__dshtThReady = function () {
  post({ th: 'status', phase: 'running', missing: missing.slice() });
  // UI 自适应（实测决定的设计）：宿主的脚本 iframe 不再满视口常显——深色宿主里
  // 满视口 iframe 的画布会刷白盖住聊天区。改为：iframe 只包住脚本 UI 的并集矩形
  // （host 按 rect  resize），无 UI 即隐藏（真 TH v-show=false 同款）。
  var lastUiJson = '';
  var checkUi = function () {
    if (!document.body) return;
    var kids = document.body.children;
    if (!kids || typeof kids.length !== 'number') {
      // 极简假 DOM（测试环境无 children）退化为旧判定
      if (document.body.childElementCount > 0) post({ th: 'ui', hasUi: true });
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'LINK') continue;
      if (typeof el.getBoundingClientRect !== 'function') continue;
      var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      found = true;
      if (r.left < minX) minX = r.left;
      if (r.top < minY) minY = r.top;
      if (r.right > maxX) maxX = r.right;
      if (r.bottom > maxY) maxY = r.bottom;
    }
    var ui = found
      ? { hasUi: true, rect: { x: Math.max(0, Math.floor(minX)), y: Math.max(0, Math.floor(minY)), w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY) } }
      : { hasUi: false };
    var json = JSON.stringify(ui);
    if (json !== lastUiJson) { lastUiJson = json; post(Object.assign({ th: 'ui' }, ui)); }
  };
  checkUi();
  setTimeout(checkUi, 2000);
  // UI 变化跟踪（脚本随时建/拆浮动部件）：MutationObserver 节流重测
  if (typeof MutationObserver === 'function' && document.body) {
    var uiTimer = 0;
    new MutationObserver(function () {
      if (uiTimer) return;
      uiTimer = setTimeout(function () { uiTimer = 0; checkUi(); }, 300);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }
};
})();`
}

/**
 * iframe srcdoc 文档（对照真 TH createSrcContent）：
 * - vendor（jQuery+zod）第一个执行——脚本 module 之前 window.$/jQuery/Zod/z 就绪；
 * - shim 先于脚本 module 执行；
 * - 脚本内容去 ``` 围栏（真 TH 同款）；
 * - trailing module 调 __dshtThReady()——module 按序执行，脚本顶层抛错不阻塞信标；
 * - vue / vue-router / lodash 全局构建走 CDN（真 TH 同款，失败非致命）；
 *   jQuery 不再走 CDN：vendor 已内嵌，CDN 副本若加载成功会覆盖 window.$，
 *   造成双实例（插件挂错实例、instanceof 断裂）；
 * - </script 转义防 HTML 解析截断（vendor minify 产物里同样可能有该序列）。
 * - F2 主题注入：--TH-viewport-height:100%（TH 脚本视口变量）、背景透明、
 *   color-scheme 跟随宿主（按宿主 body 背景亮度判定，DSH 深色壳缺省 dark）、
 *   pre/code 深色块（通讯终端类脚本的输出不发灰）。
 */

/** F2：宿主明暗判定（宿主 body 实际背景亮度；取不到按 DSH 深色壳 = dark） */
function detectHostColorScheme(): 'dark' | 'light' {
  try {
    if (typeof document === 'undefined') return 'dark'
    const bg = getComputedStyle(document.body).backgroundColor
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg)
    if (!m) return 'dark'
    const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])
    return lum >= 128 ? 'light' : 'dark'
  } catch { return 'dark' }
}

export function buildIframeDocument(opts: ShimOptions & { content: string; initialVars?: unknown }): string {
  const body = opts.content.match(/^\s*```[^\n]*\n([\s\S]*)\n```\s*$/)?.[1] ?? opts.content
  const safe = body.replace(/<\/script/gi, '<\\/script')
  // vendor 里的 </script 出现在字符串/正则字面量中时，转义为 <\/script——JS 语义不变，
  // 但 HTML 解析器不再提前终结 script 标签（jQuery 源码里确实存在该序列）。
  const vendor = thVendorSource.replace(/<\/script/gi, '<\\/script')
  // 【2026-09-07 真 TH 同步变量面】脚本帧创建即嵌合并变量树——飞讯 getCurrentPlotWeight
  // 等脚本同步读 getVariables({type:'message'}).stat_data（真 TH predefine 在帧创建时
  // 同步注入变量），异步刷新前 sync 缓存为空会导致剧情权重恒 0、联系人全锁
  const varsJson = JSON.stringify(opts.initialVars ?? {}).replace(/</gu, '\\u003c')
  const varsBoot = `<script>window.__dshtFrameVars = ${varsJson};</script>`
  // F2：深色主题 CSS（构建期求宿主明暗，注入 color-scheme 与 pre/code 深色块）
  const scheme = detectHostColorScheme()
  const themeCss = `<style>`
    + `html{color-scheme:${scheme};--TH-viewport-height:100%;--TH-viewport-width:100%}`
    + `html,body{margin:0;padding:0;background:transparent}`
    + `pre,code{background:rgb(128 128 128 / .18);color:inherit;border-radius:6px}`
    + `pre{padding:8px 10px;overflow:auto}code{padding:1px 4px}`
    + `</style>`
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<base href="about:blank" />
<script data-dsht-th-vendor>${vendor}</script>
${varsBoot}
<script>${buildShimSource(opts)}</script>
<script>
/* 【2026-09-07 ready 信标时序根修】shim 就绪即报 running（真 TH 同语义：shim 起 =
 * 事件面就绪）。原先只在 body 末尾的 trailing module 里报——若卡 module 有顶层
 * await / 求值挂起，ready 永不到达 → 15s 超时 failed → 按钮事件永久排队
 * （真机实拍「点击无任何反应」）。此处的经典 inline script 在解析期同步执行，
 * 不依赖任何 module 的求值完成；trailing module 的调用保留（幂等）。 */
window.__dshtThReady && window.__dshtThReady();
</script>
<script>
/* 【真 TH 语义对齐 2026-09-07】parent_jquery.js + predefine.js 同款全局合并——
 * 真酒馆助手的脚本 iframe 是 v-show=false 的**永久隐藏 JS 沙盒**，脚本 UI 一律经
 * parent.$ 注入父文档（悬浮球/手机面板/世界书面板全在 ST 页面上，点击原生可用）。
 * 旧实现给 iframe 自己的 $，脚本 UI 落进不可见 iframe → 只能靠 rect 裁剪 hack 硬凑
 * （面板被钉在屏幕底部 187x150，似其形未明其义）。合并顺序在 shim 之后：shim 的
 * 桥接 toastr（→ 面板日志）被父 toastr（→ 屏幕弹窗）覆盖，同真 TH toastr 来源。 */
(function () {
  var p = window.parent;
  try { if (p && p.$) { window.$ = p.$; window.jQuery = p.jQuery; } } catch (e) {}
  try { if (p && p._) { window._ = p._; } } catch (e) {}
  try { if (p && p.toastr) { window.toastr = p.toastr; } } catch (e) {}
  try { if (p && p.z) { window.z = p.z; window.Zod = p.Zod; } } catch (e) {}
  try { if (p && p.YAML) { window.YAML = p.YAML; } } catch (e) {}
  // 【ST 选择器映射 2026-09-08（审计 F 类收口）】真 TH 下 #send_textarea 存在于 ST 页面；
  // DSH 的输入区是 Lexical contenteditable（[data-composer-input]）。卡脚本高频形态
  // $('#send_textarea').val() 读输入内容（示例游戏 logicScanInput 实证：读不到 → 输入覆盖
  // 特性静默失效）。映射 + contenteditable 的 val() 桥（读 textContent 同步等价；
  // 写走 execCommand insertText best-effort）。只拦映射命中的选择器，其余行为不变。
  try {
    if (p && p.$) {
      var rawQ = p.$;
      var ST_HOST_SEL = { '#send_textarea': '[data-composer-input]' };
      var composerVal = function (el, v) {
        if (v === undefined) return el.isContentEditable ? (el.textContent || '') : undefined;
        // 【审计第三轮修正】写语义 = jQuery .val(v) 的整值替换（v2 只做光标 insertText
        // 是追加、空串 no-op——.val('').val(x) 模式坏）。全选后替换：空串走 delete。
        try {
          el.focus();
          p.document.execCommand('selectAll', false, null);
          if (String(v) !== '') p.document.execCommand('insertText', false, String(v));
          else p.document.execCommand('delete', false, null);
        } catch (e) {}
      };
      var bridgeEditableVal = function ($col) {
        var el = $col && $col[0];
        if (el && el.isContentEditable && typeof $col.val === 'function') {
          $col.val = function (v) {
            if (v === undefined) return composerVal(el, undefined); // 读：textContent 字符串
            composerVal(el, v);
            return $col; // 写：保持 jQuery 链式语义
          };
        }
        return $col;
      };
      var smartQ = function (sel, context) {
        var local = rawQ(sel, context);
        if (typeof sel !== 'string') return local;
        var mapped = ST_HOST_SEL[sel.toLowerCase()];
        if (mapped === undefined) return local;
        var hit = rawQ(mapped);
        if (hit.length === 0) return local; // 输入区未挂 → 维持空集合语义
        return bridgeEditableVal(hit);
      };
      Object.assign(smartQ, rawQ);
      smartQ.fn = rawQ.fn; // 插件原型同一份（后挂插件双方可见）
      window.$ = smartQ;
      window.jQuery = smartQ;
    }
  } catch (e) { /* 映射失败维持父合并原样 */ }
})();
</script>
${themeCss}
</head>
<body>
<!-- 脚本 id 注册表：真 TH 在宿主页 #tavern_helper 下渲染各脚本条目；MVU 等框架的
     th_unique_check 靠它仲裁 should_enable（本移植每 iframe 自含自身 id → 自身即首选实例） -->
<div id="tavern_helper" style="display:none"><div data-script-id="${opts.scriptId}"></div></div>
<script type="module">
${safe}
</script>
<script type="module">
window.__dshtThReady && window.__dshtThReady();
</script>
<script>
/* 【2026-09-07 CDN 阻塞根修】vue/vue-router/FontAwesome 改为解析完成后异步注入——
 * 原 head 里的 <script src> 是解析阻塞点：模拟器 DNS 抖动时 jsdelivr 挂起，
 * body 里的卡脚本 module 和 ready 信标 module 永不执行 → 全部脚本 15s 超时
 * phase=failed → 按钮事件永久排队（真机实拍「点击无任何反应」）。
 * lodash 已由上方 parent 合并提供（宿主 host-vendor 有 _），无需 CDN 副本。 */
(function () {
  var add = function (tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    el.async = true;
    (document.head || document.documentElement).appendChild(el);
  };
  add('script', { src: 'https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js' });
  add('script', { src: 'https://testingcf.jsdelivr.net/npm/vue-router/dist/vue-router.global.prod.min.js' });
  add('link', { rel: 'stylesheet', href: 'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css' });
})();
</script>
</body>
</html>`
}

/**
 * 消息楼层 iframe 的 TH shim 注入（2026-09-06 视觉验收：真 TH 对 message iframe
 * 同样注入 predefine.js——示例游戏「MVU浪潮状态栏」等卡内脚本在楼层 iframe 里直接调
 * getAllVariables/Mvu，无 shim 时数据恒为占位符「--」）。
 * 与 buildIframeDocument 的差异：content 是卡自带的 HTML 文档（非 JS 模块）——
 * vendor+shim+主题 注进 <head>（或包一层文档骨架），卡的 style/script 保持原位。
 */
/** 楼层帧 vendor blob（全帧共享，页面生命周期内复用） */
let cachedVendorBlobUrl: string | null = null
export function getVendorBlobUrl(): string {
  if (cachedVendorBlobUrl === null) {
    cachedVendorBlobUrl = URL.createObjectURL(new Blob([thVendorSource], { type: 'text/javascript' }))
  }
  return cachedVendorBlobUrl
}

export function buildMessageFrameDocument(source: string, opts: ShimOptions & { initialVars?: unknown; initialContext?: unknown; vendorUrl: string; shimUrl: string }): string {
  const scheme = detectHostColorScheme()
  const themeCss = `<style>`
    + `html{color-scheme:${scheme};--TH-viewport-height:100%;--TH-viewport-width:100%}`
    + `</style>`
  // 同步变量面：嵌入当前合并变量树（getAllVariables().stat_data 同步访问的数据源）
  const varsJson = JSON.stringify(opts.initialVars ?? {}).replace(/</gu, '\\u003c')
  const varsBoot = `<script>window.__dshtFrameVars = ${varsJson};</script>`
  // 【P3a 2026-09-07】context bootstrap：卡脚本运行前 latestContext 就绪（消除竞态）
  const ctxJson = JSON.stringify(opts.initialContext ?? null).replace(/</gu, '\\u003c')
  const ctxBoot = `<script>window.__dshtInitialContext = ${ctxJson};</script>`
  // vendor/shim 走 blob URL 外链（v3）：往任意卡文档内联 600KB 脚本文本会被卡自身
  // 的注释/字符串搅乱 HTML 解析状态（<!-- 转义态等），srcdoc 膨胀到 1.8MB 且代码
  // 溢出成正文——外链 script 原子加载，与卡文档互不干扰。
  const inject = `<script src="${opts.vendorUrl}"></script>${varsBoot}${ctxBoot}<script src="${opts.shimUrl}"></script><link rel="stylesheet" href="https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" />${themeCss}<script>window.__dshtThReady && window.__dshtThReady();</script>`
  // 完整文档：注进 </head> 前；无 head 有 <html>：补一个 head
  if (/<\/head\s*>/iu.test(source)) {
    return source.replace(/<\/head\s*>/iu, `${inject}</head>`)
  }
  if (/<html(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<html(?:\s[^>]*)?>/iu, (m) => `${m}<head>${inject}</head>`)
  }
  // 片段：包完整骨架（CSP 同 buildDisplayFrameDocument 形态）
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="referrer" content="no-referrer">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src https: data: blob:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; style-src \'unsafe-inline\' https:; script-src \'unsafe-inline\' \'unsafe-eval\' https: data: blob:; connect-src https: wss: data: blob:; frame-src https: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
    + inject
    + '</head><body>' + source + '</body></html>'
}

// ---------------------------------------------------------------------------
// host 侧桥处理器（纯逻辑：api 名 → deps 路由；fetch/DOM 由 RpScriptHost 注入）
// ---------------------------------------------------------------------------

export type VarScope = 'global' | 'preset' | 'character' | 'chat' | 'script' | 'message'

export interface VarOption {
  type?: string
  script_id?: string
  message_id?: number | 'latest'
}

export interface ThBridgeDeps {
  /** 读作用域变量树（script 作用域传 scriptId） */
  varsGet: (scope: VarScope, scriptId: string) => Promise<Record<string, unknown>>
  /** 整树替换 */
  varsPut: (scope: VarScope, tree: Record<string, unknown>, scriptId: string) => Promise<void>
  /** 深合并（mode: assign = 新值覆盖 / insert = 仅补缺） */
  varsMerge: (scope: VarScope, vars: Record<string, unknown>, mode: 'assign' | 'insert', scriptId: string) => Promise<void>
  /** 按 lodash 路径删除 */
  varsDelete: (scope: VarScope, path: string, scriptId: string) => Promise<void>
  /** 五层合并视图（global<preset<character<script<chat；script = 当前脚本私有树） */
  varsAll: (scriptId: string) => Promise<Record<string, unknown>>
  buttonsGet: (scriptId: string) => Array<{ name: string; visible: boolean }>
  buttonsSet: (scriptId: string, buttons: Array<{ name: string; visible: boolean }>) => void
  /** 【鲁棒轮】buttons:set 跨脚本目标存在性校验（replaceScriptButtons(buttons, script_id)） */
  buttonsExists: (scriptId: string) => boolean
  primaryLorebook: () => Promise<string | null>
  // ---- 以下为本次迁移的真实现 deps（/dsht-tavern-helper/* 新路由；sessionId/slug 空串 = 运行时会话/工作区）----
  /** 上下文快照（/context 响应；无 RP 上下文返回 null） */
  ctxGet: (sessionId: string, slug: string) => Promise<ThContextSnapshot | null>
  /** 预设名清单（/preset/names；loaded = 当前已加载预设名） */
  presetNames: (sessionId?: string) => Promise<{ names: string[]; loaded?: string | null }>
  presetGet: (name: string) => Promise<{ found: boolean; preset?: ThPreset | null }>
  /** 写预设（create:true = 缺则建） */
  presetPut: (name: string, prompts: ThPresetPrompt[], prompt_order: ThPromptOrder[], create?: boolean) => Promise<void>
  presetDelete: (name: string) => Promise<void>
  presetRename: (name: string, newName: string) => Promise<void>
  presetLoad: (sessionId: string, name: string) => Promise<void>
  /** 聊天消息（append-only 日志的只读投影） */
  chatMessages: (sessionId: string) => Promise<{ messages: ThChatMessage[] }>
  /** 聊天写桥（P3a：createChatMessages——messages [{role,message,data?}]；insertBefore 仅 'end'） */
  chatAppend: (messages: Array<{ role: string; message: string; data: Record<string, unknown> | null }>, options: { insertBefore: 'end' | number }) =>
    Promise<{ ok?: boolean; messageIds?: number[] }>
  /** 聊天写桥（P3a：setChatMessages——targets [{message_id,seq?,message?,data?}]，replace 原语） */
  chatUpdate: (targets: Array<{ message_id: number; seq?: number; message?: string; data?: unknown }>) =>
    Promise<{ ok?: boolean; updated?: number }>
  regexesGet: (slug: string, sessionId: string) => Promise<{ regexes: Record<string, unknown>[]; presetId?: string | null; slug?: string | null }>
  /** 正则整表替换（scope: global / character(slug) / preset(presetId)） */
  regexesReplace: (regexes: Record<string, unknown>[], scope: 'global' | 'character' | 'preset', slug: string, sessionId: string) => Promise<void>
  /** 【Kemini 适配 2026-09-08】显示面失效+重渲染（builtin.reloadAndRenderChatWithoutEvents /
   *  正则·预设变更后宿主 RP 聊天重跑 display 管线——displayRegexCache 失效 + epoch bump） */
  displayReload: () => Promise<void>
  wbList: () => Promise<{ books: Array<{ name: string; lorePath?: string | null }> }>
  wbGet: (name: string) => Promise<{ book: { name?: string; entries?: Record<string, unknown>[] } | null }>
  wbEntryPut: (name: string, entry: Record<string, unknown>) => Promise<void>
  // ---- 【实机审计修复 2026-09-05】P1/P2 长尾 deps ----
  /** 运行期宏展开（substitudeMacros：/macros/expand → {result, writes, unknownMacros}） */
  macrosExpand: (text: string) => Promise<{ result?: string }>
  /** L1b：自定义宏注册/注销（ST MacroRegistry.registerMacro 对应物；落 rp/macros.json，生成期/显示期同源） */
  macrosRegister: (name: string, value: string) => Promise<{ ok?: boolean; macros?: Record<string, string> }>
  macrosUnregister: (name: string) => Promise<{ ok?: boolean }>
  /** 世界书条目整表替换（replaceLorebookEntries；ST entry 形状数组） */
  wbReplaceEntries: (name: string, entries: Record<string, unknown>[]) => Promise<void>
  /** 全局激活书单重绑（rebindGlobalWorldbooks；rp/global-books.json 整组替换） */
  wbRebindGlobal: (names: string[]) => Promise<void>
  /** 角色工作区书单重绑（rebindCharWorldbooks；rp/<slug>/rp.json books 整组替换） */
  wbRebindChar: (slug: string, names: string[]) => Promise<void>
  /** 会话绑定世界书缺则建（getOrCreateChatWorldbook；rp/chat-worldbooks/<sessionId>.json） */
  wbChatGetOrCreate: () => Promise<{ name?: string }>
  // ---- 以下为 C7/C8/C9/D6 扩展面 deps（/dsht-tavern-helper/* 新路由 + /dsht-mvu/*）----
  /** chat 作用域深合并写入（C7：facade /variables/merge——服务端 undo/快照/schema 校验收口） */
  varsAssignChat: (vars: Record<string, unknown>) => Promise<void>
  /** 变量 schema 注册（C7：facade /variables/schema → rp/state variableSchema。
   *  首参是 TH 契约里的**作用域** global/preset/character/chat/message；''/message = 整树） */
  varsSchemaPut: (name: string, schema: Record<string, unknown>) => Promise<void>
  /** prompt 注入存储（C8：/inject 同 key 覆盖写入） */
  injectsPut: (injections: Record<string, unknown>[]) => Promise<void>
  /** prompt 注入移除（C8：/uninject 按 key） */
  injectsRemove: (keys: string[]) => Promise<void>
  /** 一次性补全（C9：/generate loopback → /dsht-rp/llm/classify） */
  generate: (system: string, prompt: string) => Promise<{ ok?: boolean; text?: string }>
  /** generateRaw 真语义：完整 payload（ordered_prompts 等）→ 宿主 /generate-raw 装配 */
  generateRawRaw: (payload: unknown) => Promise<{ ok?: boolean; text?: string }>
  /** MVU 变量树（D6：GET /dsht-mvu/variables 的 variables） */
  mvuVariables: () => Promise<Record<string, unknown>>
  /** MVU 整组替换（D6：/dsht-mvu/variables/register {replace:true}） */
  mvuReplace: (data: Record<string, unknown>) => Promise<void>
}

function optionToScope(option: unknown, scriptId: string): { scope: VarScope; scriptId: string } {
  const o = (option && typeof option === 'object' ? option : { type: 'chat' }) as VarOption
  const type = o.type ?? 'chat'
  if (type === 'script') return { scope: 'script', scriptId: o.script_id ?? scriptId }
  if (type === 'global' || type === 'preset' || type === 'character' || type === 'chat' || type === 'message') {
    return { scope: type, scriptId: '' }
  }
  throw new Error(`unsupported variable scope: ${String(type)}`)
}

/**
 * 深合并（high 覆盖 low 叶值；对象递归）—— host 侧 assign 合并用。**families-A**。
 *
 * 【T-35 收敛 2026-09-11】原为本文件内的一份独立实现，与 `tavern-helper/variables.ts:deepMergeVars`、
 * `dsht-plugin-mvu/index.ts:deepMerge` **逐字相同**（三份副本）。现三处统一引
 * `dsht-plugin-shared/deep-merge.ts` 的 `deepMergeIncoming`，此处仅保留对外名。
 */
export const deepMergeAssign = deepMergeIncoming

/**
 * insert 语义合并：只补缺口（existing 叶值恒胜）。
 *
 * 只是 `deepMergeIncoming` 的**换参写法**（低优先 = vars、高优先 = existing）——不是第 5 份实现。
 *
 * ⚠️ 与 `state/mvu.ts:deepMergeInitVars` **结果形状相同、引用语义不同**：
 * 本函数结果以 `{...vars}` 起手，缺键处**共享** `vars` 的子树引用；
 * `deepMergeInitVars` 则对补入值**深拷贝**（init 树会被复用，须防下游就地改写污染）。
 * 因此两者**不能**互相替代——该差异由 `tests/deep-merge.spec.ts` 显式钉住。
 */
export function deepMergeInsert(existing: Record<string, unknown>, vars: Record<string, unknown>): Record<string, unknown> {
  return deepMergeIncoming(vars, existing)
}

/** 桥调用分发（幂等可追溯：调用方负责 console 记录；未知 api 抛错） */
export async function handleBridgeCall(
  deps: ThBridgeDeps,
  scriptId: string,
  api: string,
  args: unknown[],
): Promise<unknown> {
  switch (api) {
    case 'vars:get': {
      const { scope, scriptId: sid } = optionToScope(args[0], scriptId)
      return deps.varsGet(scope, sid)
    }
    case 'vars:put': {
      const { scope, scriptId: sid } = optionToScope(args[0], scriptId)
      const tree = args[1]
      if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) throw new Error('variables must be object')
      await deps.varsPut(scope, tree as Record<string, unknown>, sid)
      return null
    }
    case 'vars:merge': {
      const { scope, scriptId: sid } = optionToScope(args[0], scriptId)
      const vars = args[1]
      if (vars === null || typeof vars !== 'object' || Array.isArray(vars)) throw new Error('variables must be object')
      const mode = args[2] === 'insert' ? 'insert' : 'assign'
      await deps.varsMerge(scope, vars as Record<string, unknown>, mode, sid)
      return null
    }
    case 'vars:delete': {
      const { scope, scriptId: sid } = optionToScope(args[0], scriptId)
      await deps.varsDelete(scope, String(args[1] ?? ''), sid)
      return null
    }
    case 'vars:all':
      return deps.varsAll(scriptId)
    // ---- C7：chat 作用域深合并走服务端（/variables/merge 收口 undo/快照/schema 校验）；
    // 其余作用域退回客户端读改写（facade 变量合并仅落 rp/state chat 树）----
    case 'vars:assign': {
      const { scope, scriptId: sid } = optionToScope(args[0], scriptId)
      const vars = args[1]
      if (vars === null || typeof vars !== 'object' || Array.isArray(vars)) throw new Error('variables must be object')
      if (scope === 'chat' && sid === '') {
        await deps.varsAssignChat(vars as Record<string, unknown>)
        return null
      }
      await deps.varsMerge(scope, vars as Record<string, unknown>, 'assign', sid)
      return null
    }
    // ---- C7：变量 schema 注册（zod → JSON-Schema 已在 shim 侧转换）----
    case 'vars:schema': {
      const name = String(args[0] ?? '')
      const schema = args[1]
      if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('variableSchema object required')
      await deps.varsSchemaPut(name, schema as Record<string, unknown>)
      return null
    }
    // ---- C8：prompt 注入存储 ----
    case 'injects:put': {
      const list = Array.isArray(args[0])
        ? args[0].filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
        : []
      await deps.injectsPut(list)
      return null
    }
    case 'injects:remove': {
      const keys = Array.isArray(args[0]) ? args[0].map(k => String(k)) : []
      await deps.injectsRemove(keys)
      return null
    }
    // ---- C9：一次性补全 ----
    case 'generate':
      return deps.generate(String(args[0] ?? ''), String(args[1] ?? ''))
    // ---- generateRaw 真语义（ordered_prompts 装配在宿主 /generate-raw）----
    case 'generate:raw':
      return deps.generateRawRaw(args[0])
    // ---- D6：window.Mvu 数据面 ----
    case 'mvu:data':
      return deps.mvuVariables()
    case 'mvu:replace': {
      const data = args[0]
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('mvu data must be object')
      await deps.mvuReplace(data as Record<string, unknown>)
      return null
    }
    case 'buttons:get': {
      // 【指南版】args[0] = 目标脚本 id（缺省 = 调用方自身）；跨脚本读同样校验目标存在
      const targetId = typeof args[0] === 'string' && args[0] ? args[0] : scriptId
      if (targetId !== scriptId && !deps.buttonsExists(targetId)) {
        throw new Error(`getScriptButtons: 目标脚本不存在: ${targetId}`)
      }
      return deps.buttonsGet(targetId)
    }
    case 'buttons:set': {
      const buttons = Array.isArray(args[0]) ? args[0] as Array<{ name: string; visible: boolean }> : []
      // 【鲁棒轮 2026-09-09】args[1] = 目标脚本 id（真 TH replaceScriptButtons(buttons, script_id?)——
      // 框架类脚本管理其他脚本按钮的合法用法）。缺省 = 调用方自身；显式指定时校验目标
      // 存在（不存在显式报错，不再静默改错对象）。
      const targetId = typeof args[1] === 'string' && args[1] ? args[1] : scriptId
      if (targetId !== scriptId && !deps.buttonsExists(targetId)) {
        throw new Error(`replaceScriptButtons: 目标脚本不存在: ${targetId}`)
      }
      deps.buttonsSet(targetId, buttons)
      return null
    }
    case 'lorebook:primary':
      return deps.primaryLorebook()
    // ---- 上下文 / 预设 / 聊天消息 / 正则 / 世界书（真实现桥分发）----
    case 'ctx:get': {
      const sessionId = typeof args[0] === 'string' ? args[0] : ''
      const slug = typeof args[1] === 'string' ? args[1] : ''
      return deps.ctxGet(sessionId, slug)
    }
    case 'preset:names': {
      const sessionId = typeof args[0] === 'string' && args[0] ? args[0] : undefined
      return deps.presetNames(sessionId)
    }
    case 'preset:get':
      return deps.presetGet(String(args[0] ?? ''))
    case 'preset:put': {
      const prompts = (Array.isArray(args[1]) ? args[1] : []) as ThPresetPrompt[]
      const promptOrder = (Array.isArray(args[2]) ? args[2] : []) as ThPromptOrder[]
      return deps.presetPut(String(args[0] ?? ''), prompts, promptOrder, args[3] === true)
    }
    case 'preset:delete':
      return deps.presetDelete(String(args[0] ?? ''))
    case 'preset:rename':
      return deps.presetRename(String(args[0] ?? ''), String(args[1] ?? ''))
    case 'preset:load': {
      const sessionId = typeof args[0] === 'string' ? args[0] : ''
      return deps.presetLoad(sessionId, String(args[1] ?? ''))
    }
    case 'chat:messages': {
      const sessionId = typeof args[0] === 'string' ? args[0] : ''
      return deps.chatMessages(sessionId)
    }
    // ---- 【P3a 2026-09-07】聊天写路径桥 ----
    case 'chat:append': {
      const messages = (Array.isArray(args[0]) ? args[0] : []) as Array<{ role: string; message: string; data: Record<string, unknown> | null }>
      const options = (args[1] && typeof args[1] === 'object' ? args[1] : {}) as { insertBefore: 'end' | number }
      return deps.chatAppend(messages, options)
    }
    case 'chat:update': {
      const targets = (Array.isArray(args[0]) ? args[0] : []) as Array<{ message_id: number; seq?: number; message?: string; data?: unknown }>
      return deps.chatUpdate(targets)
    }
    case 'regexes:get': {
      const slug = typeof args[0] === 'string' ? args[0] : ''
      const sessionId = typeof args[1] === 'string' ? args[1] : ''
      return deps.regexesGet(slug, sessionId)
    }
    case 'regexes:replace': {
      const regexes = (Array.isArray(args[0]) ? args[0] : []) as Record<string, unknown>[]
      const scope = args[1] === 'character' || args[1] === 'preset' ? args[1] : 'global'
      const slug = typeof args[2] === 'string' ? args[2] : ''
      const sessionId = typeof args[3] === 'string' ? args[3] : ''
      return deps.regexesReplace(regexes, scope, slug, sessionId)
    }
    case 'wb:list':
      return deps.wbList()
    case 'wb:get':
      return deps.wbGet(String(args[0] ?? ''))
    case 'wb:entryPut': {
      const entry = (args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])
        ? args[1] : {}) as Record<string, unknown>
      return deps.wbEntryPut(String(args[0] ?? ''), entry)
    }
    // ---- 【实机审计修复 2026-09-05】P1/P2 长尾分发 ----
    case 'macros:expand':
      return deps.macrosExpand(String(args[0] ?? ''))
    // ---- L1b：自定义宏注册（hook 移植）----
    case 'macros:register':
      return deps.macrosRegister(String(args[0] ?? ''), String(args[1] ?? ''))
    case 'macros:unregister':
      return deps.macrosUnregister(String(args[0] ?? ''))
    case 'wb:replaceEntries': {
      const entries = (Array.isArray(args[1]) ? args[1] : []) as Record<string, unknown>[]
      return deps.wbReplaceEntries(String(args[0] ?? ''), entries)
    }
    case 'wb:rebindGlobal': {
      const names = Array.isArray(args[0]) ? args[0].map(n => String(n)) : []
      return deps.wbRebindGlobal(names)
    }
    case 'wb:rebindChar': {
      const names = Array.isArray(args[1]) ? args[1].map(n => String(n)) : []
      return deps.wbRebindChar(String(args[0] ?? ''), names)
    }
    case 'wb:chatGetOrCreate':
      return deps.wbChatGetOrCreate()
    // ---- 【Kemini 适配 2026-09-08】显示面失效+重渲染（window.builtin.reloadAndRenderChatWithoutEvents）----
    case 'display:reload':
      await deps.displayReload()
      return null
    default:
      throw new Error(`unknown bridge api: ${api}`)
  }
}
