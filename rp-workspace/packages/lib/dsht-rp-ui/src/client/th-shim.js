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
import thVendorSource from './th-vendor.gen.txt?raw';
// ---------------------------------------------------------------------------
// 协议常量与类型
// ---------------------------------------------------------------------------
export const TH_MSG_TAG = '__dsht_th';
/** 入站消息解析（非法/伪造消息返回 null；secret 校验调用方做） */
export function parseIncomingMessage(data) {
    if (data === null || typeof data !== 'object')
        return null;
    const d = data;
    if (d[TH_MSG_TAG] !== true)
        return null;
    if (typeof d.scriptId !== 'string' || typeof d.secret !== 'string')
        return null;
    if (d.th === 'call') {
        if (typeof d.callId !== 'number' || typeof d.api !== 'string' || !Array.isArray(d.args))
            return null;
        return d;
    }
    if (d.th === 'status') {
        if (d.phase !== 'loading' && d.phase !== 'running' && d.phase !== 'failed')
            return null;
        return d;
    }
    if (d.th === 'missing' && typeof d.api === 'string')
        return d;
    if (d.th === 'toast' && typeof d.message === 'string')
        return d;
    if (d.th === 'ui')
        return d;
    if (d.th === 'console' && typeof d.level === 'string' && typeof d.message === 'string')
        return d;
    return null;
}
// ---------------------------------------------------------------------------
// 按钮事件 id（对照 ST getStringHash + 真 TH getButtonId：${scriptId}_${hash(name)}）
// ---------------------------------------------------------------------------
/** ST public/scripts/utils.js getStringHash 同款（Java string hash） */
export function getStringHash(str) {
    let hash = 0;
    if (!str.length)
        return hash;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
}
export function getButtonEventId(scriptId, buttonName) {
    return `${scriptId}_${getStringHash(buttonName)}`;
}
// ---------------------------------------------------------------------------
// 支持 / 不支持 API 清单（诚实面：不支持的挂 stub，调了记名 + reject）
// ---------------------------------------------------------------------------
/** 事件常量（【实机审计修复 2026-09-05】C6：对齐真 TH tavern_events 全表 82 项——
 * 名值逐项抄自 ST 扩展 @types/iframe/event.d.ts 的导出（含 CHARACTER_DELETED:'characterDeleted'
 * / CHARACTER_MANAGEMENT_DROPDOWN:'charManagementDropdown' 等不规则值）；常量本身无依赖，全量给出） */
export const TAVERN_EVENTS = {
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
};
/** iframe 生命周期事件（【实机审计修复 2026-09-05】C6：补 generate 通道与流式 token 四项，
 * 名值抄自真 TH iframe_events 导出） */
export const IFRAME_EVENTS = {
    MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
    MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    GENERATION_ENDED: 'js_generation_ended',
};
/** shim 本地实现（不过桥）的 API */
export const SHIM_LOCAL_APIS = [
    'eventOn', 'eventOnce', 'eventEmit', 'eventEmitAndWait', 'eventRemoveListener',
    'eventClearEvent', 'eventClearAll', 'eventMakeFirst', 'eventMakeLast',
    'eventOnButton', 'getButtonEvent',
    'getVariables', 'getAllVariables', 'insertVariables', 'insertOrAssignVariables',
    'updateVariablesWith', 'replaceVariables', 'deleteVariable',
    'getScriptButtons', 'replaceScriptButtons', 'updateScriptButtonsWith', 'appendInexistentScriptButtons',
    'getTavernHelperVersion', 'getTavernVersion', 'getScriptId', 'getScriptName',
    'getCurrentCharPrimaryLorebook', 'getCharWorldbookNames',
    // C18 杂项 / C17 音频
    'getLastMessageId', 'triggerSlash', 'audio',
];
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
    // 【实机审计修复 2026-09-05】P1/P2 长尾：楼层范围读 / 正则套件 / 世界书写面 / 历史简报 / 宏
    'getChatHistoryBrief', 'getChatHistoryDetail',
    'updateTavernRegexesWith', 'formatAsTavernRegexedString', 'isCharacterTavernRegexesEnabled',
    'getWorldbook', 'replaceLorebookEntries', 'rebindGlobalWorldbooks', 'rebindCharWorldbooks', 'getOrCreateChatWorldbook',
    'substitudeMacros',
];
/**
 * 已知但不支持的 API（挂 stub：console.warn 记名 + Promise.reject）。
 * 都是深度钩 ST 内部组件或与宿主数据模型冲突的面（chat 写路径 / 扩展管理 / 世界书写路径）。
 * 预设 CRUD / 聊天消息读 / 正则 / 世界书名单与条目读 / getContext 已移植为真实现（见 SHIM_BRIDGE_APIS）。
 * 生成控制只移植一次性补全（generate/generateRaw → /dsht-rp/llm/classify；C9）——生成管线
 * 控制（stop/模型清单/代理）仍记名拒绝；prompt 注入为存储面真实现（C8）；斜杠命令走
 * triggerSlash 最小映射（C18）；音频走 audio.bgm/ambient（C17）。
 */
export const UNSUPPORTED_APIS = [
    // 生成控制（钩 ST 生成管线；一次性补全除外——见 SHIM_BRIDGE_APIS generate/generateRaw）
    'stopAllGeneration', 'stopGenerationById', 'getModelList', 'getProxyPresetNames',
    // 聊天消息写路径（DSH 会话日志 append-only，改/插/删/轮转都会与宿主记录有损漂移——逐 API 理由见 UNSUPPORTED_REASONS）
    'setChatMessage', 'setChatMessages', 'createChatMessages',
    'deleteChatMessages', 'rotateChatMessages',
    'formatAsDisplayedMessage', 'retrieveDisplayedMessage', 'refreshOneMessage',
    // 世界书写 API（【实机审计修复 2026-09-05】replaceLorebookEntries / rebindGlobalWorldbooks /
    // rebindCharWorldbooks / getOrCreateChatWorldbook / getWorldbook 已走世界书写面桥（facade
    // /worldbook/replace-entries 等端点）；其余读路径已支持：getWorldbooks / getLorebookEntries；
    // getCurrentCharPrimaryLorebook 走 lorebook:primary）
    'getLorebooks', 'getCharLorebooks', 'getChatLorebook', 'getOrCreateChatLorebook', 'setChatLorebook',
    'createLorebook', 'deleteLorebook', 'getLorebookSettings', 'setLorebookSettings', 'setCurrentCharLorebooks',
    'createLorebookEntry', 'createLorebookEntries', 'deleteLorebookEntry',
    'deleteLorebookEntries', 'setLorebookEntries', 'updateLorebookEntriesWith',
    // 角色卡 / 人设 CRUD
    'getCharacterNames', 'getCharacterIds', 'getCharacter', 'getCurrentCharacterId', 'getCurrentCharacterName',
    'createCharacter', 'createOrReplaceCharacter', 'deleteCharacter', 'replaceCharacter', 'updateCharacterWith',
    'getPersonaNames', 'getPersona', 'createPersona', 'createOrReplacePersona', 'deletePersona', 'replacePersona',
    // 宏（类宏注册）
    'registerMacroLike', 'unregisterMacroLike',
    // 音频清单/播放器控制面（audio.bgm/ambient 基础播放已实现；这套 ST 播放器 API 不移植）
    'getAudioList', 'appendAudioList', 'replaceAudioList', 'playAudio', 'pauseAudio', 'getCurrentAudio',
    'getAudioSettings', 'setAudioSettings',
    // 扩展管理 / 导入 / 杂项
    'isAdmin', 'installExtension', 'uninstallExtension', 'updateExtension', 'reinstallExtension',
    'isInstalledExtension', 'getExtensionType', 'getExtensionInstallationInfo',
    'importRawCharacter', 'importRawChat', 'importRawPreset', 'importRawTavernRegex', 'importRawWorldbook',
    'getScriptTrees', 'replaceScriptTrees', 'updateScriptTreesWith',
    'getAllEnabledScriptButtons', 'writeExtensionField', 'updateTavernHelper',
];
/**
 * 记名拒绝的逐 API 理由（shim stub 的错误消息引用；未列出的 API 用通用理由）。
 * 聊天消息写路径拒绝理由要点：DSH 会话日志是 append-only，写历史与宿主记录有损漂移。
 */
export const UNSUPPORTED_REASONS = {
    setChatMessage: 'DSH 会话日志 append-only，改写历史消息会与宿主记录有损漂移',
    setChatMessages: 'DSH 会话日志 append-only，批量改写历史消息会与宿主记录有损漂移',
    createChatMessages: 'DSH 会话日志 append-only，插入历史消息会与宿主记录有损漂移',
    deleteChatMessages: 'DSH 会话日志 append-only，删除历史消息会与宿主记录有损漂移',
    rotateChatMessages: 'DSH 会话日志无 swipe 分支树，消息轮转会与宿主记录有损漂移',
};
/**
 * shim 源码：装在脚本 module 之前。API 面 = window.TavernHelper（Proxy）+ 同名裸全局
 * （真 TH predefine.js 行为：所有 API 同时是 bare global，脚本写 getVariables(...) 不带前缀）。
 *  shim 内不嵌模板字符串（避免与宿主生成代码的 ${} 冲突）。
 */
export function buildShimSource(opts) {
    const tavernEventsJs = JSON.stringify(TAVERN_EVENTS);
    const iframeEventsJs = JSON.stringify(IFRAME_EVENTS);
    const unsupportedJs = JSON.stringify(UNSUPPORTED_APIS);
    const unsupportedReasonsJs = JSON.stringify(UNSUPPORTED_REASONS);
    const bareGlobalsJs = JSON.stringify([...SHIM_LOCAL_APIS, ...SHIM_BRIDGE_APIS]);
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
  try { window.parent.postMessage(msg, '*'); } catch (e) { /* 宿主不可达 */ }
}
function reportMissing(api) {
  if (missingSet.has(api)) return;
  missingSet.add(api);
  missing.push(api);
  try { console.warn('[TavernHelper shim] 脚本 ' + SCRIPT_NAME + ' 调了未支持 API: ' + api); } catch (e) {}
  post({ th: 'missing', api: api });
}
function call(api, args) {
  return new Promise(function (resolve, reject) {
    var callId = ++seq;
    pending.set(callId, { resolve: resolve, reject: reject });
    post({ th: 'call', callId: callId, api: api, args: args });
  });
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
function eventOn(evt, fn) {
  listenerList(String(evt)).push({ fn: fn, once: false, ord: ++lseq });
  return { stop: function () { removeListener(String(evt), fn); } };
}
function eventOnce(evt, fn) {
  listenerList(String(evt)).push({ fn: fn, once: true, ord: ++lseq });
  return { stop: function () { removeListener(String(evt), fn); } };
}
function eventMakeLast(evt, fn) { return eventOn(evt, fn); }
function eventMakeFirst(evt, fn) {
  listenerList(String(evt)).unshift({ fn: fn, once: false, ord: ++lseq });
  return { stop: function () { removeListener(String(evt), fn); } };
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

// ---- 变量（桥到 host 数据面；message 作用域不支持——无每消息变量树）----
function normalizeOption(option) {
  var o = option || { type: 'chat' };
  if (typeof o !== 'object') o = { type: 'chat' };
  if (o.type === 'script' && !o.script_id) return { type: 'script', script_id: SCRIPT_ID };
  return o;
}
function guardOption(option, apiName) {
  var o = normalizeOption(option);
  if (o.type === 'message') {
    reportMissing(apiName + ':message-scope');
    var err = new Error('message 作用域变量未在 DSH 移植中支持（无每消息变量树）');
    err.__thExpected = true;
    throw err;
  }
  if (o.type === 'extension') {
    reportMissing(apiName + ':extension-scope');
    var err2 = new Error('extension 作用域变量不支持（无 ST 扩展设置树）');
    err2.__thExpected = true;
    throw err2;
  }
  return o;
}
function getVariables(option) { return call('vars:get', [guardOption(option, 'getVariables')]); }
function getAllVariables() { return call('vars:all', []); }
function replaceVariables(vars, option) { return call('vars:put', [guardOption(option, 'replaceVariables'), vars]); }
function insertOrAssignVariables(vars, option) {
  var o = guardOption(option, 'insertOrAssignVariables');
  // C7 收口：chat 作用域（含缺省）走服务端深合并（/variables/merge——undo/快照/schema 校验收口）；
  // 其余作用域退回客户端读改写（vars:merge assign）
  if (o.type === 'chat') return call('vars:assign', [o, vars]);
  return call('vars:merge', [o, vars, 'assign']);
}
function insertVariables(vars, option) { return call('vars:merge', [guardOption(option, 'insertVariables'), vars, 'insert']); }
function deleteVariable(path, option) { return call('vars:delete', [guardOption(option, 'deleteVariable'), String(path)]); }
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
function getScriptButtons() { return call('buttons:get', []); }
function replaceScriptButtons(buttons, script_id) { return call('buttons:set', [buttons]); }
function updateScriptButtonsWith(updater) {
  return getScriptButtons().then(function (buttons) {
    return Promise.resolve(updater(buttons));
  }).then(function (next) {
    return replaceScriptButtons(next).then(function () { return next; });
  });
}
function appendInexistentScriptButtons(a, b) {
  var newButtons = typeof a === 'string' ? b : a;
  return updateScriptButtonsWith(function (buttons) {
    var add = (newButtons || []).filter(function (nb) {
      return !buttons.some(function (x) { return x.name === nb.name; });
    });
    return buttons.concat(add);
  });
}

// ---- 上下文快照（host 主动推送 {th:'context', context}；getContext 同步读、不过桥）----
var latestContext = null;
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
// data = 数据面记录里规范字段之外的全部附加键（脚本按 ST 惯例在 data 上读写楼层附加数据）
function dshtMessageView(m) {
  if (!m || typeof m !== 'object') return m;
  var data = {};
  for (var k in m) {
    if (k === 'message_id' || k === 'name' || k === 'role' || k === 'message' || k === 'is_system' || k === 'is_hidden' || k === 'data') continue;
    data[k] = m[k];
  }
  return {
    message_id: m.message_id,
    name: m.name,
    role: m.role,
    is_hidden: m.is_hidden === true || m.is_system === true,
    message: m.message,
    data: (m.data && typeof m.data === 'object') ? m.data : data,
  };
}
function getChatMessages(range) {
  var raw = String(range == null ? '' : range);
  var prep = raw.indexOf('{{') >= 0 ? substitudeMacros(raw) : Promise.resolve(raw);
  return prep.then(function (demacroed) {
    return call('chat:messages', [null]).then(function (r) {
      var list = (r && Array.isArray(r.messages)) ? r.messages : (Array.isArray(r) ? r : []);
      var rn = dshtStringToRange(demacroed, 0, list.length - 1);
      if (!rn) return [];
      var out = [];
      for (var i = rn.start; i <= rn.end; i++) {
        var m = list[i];
        if (m && typeof m === 'object') out.push(dshtMessageView(m));
      }
      return out;
    });
  });
}
function getChatMessage(id) {
  // 惯用单数查询（真 TH 无此 API——我方扩展面）：按楼层号精确匹配，未命中 null
  return call('chat:messages', [null]).then(function (r) {
    var list = (r && Array.isArray(r.messages)) ? r.messages : (Array.isArray(r) ? r : []);
    var want = Number(id);
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m && typeof m === 'object' && m.message_id === want) return dshtMessageView(m);
    }
    return null;
  });
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
function getTavernRegexes() {
  return call('regexes:get', [null, null]).then(function (r) {
    return (r && Array.isArray(r.regexes)) ? r.regexes : [];
  });
}
function replaceTavernRegexes(regexes, options) {
  var o = (options && typeof options === 'object') ? options : {};
  var scope = 'global';
  if (o.type === 'scoped' && (o.scope === 'character' || o.scope === 'preset')) scope = o.scope;
  var slug = null;
  if (scope === 'character' && latestContext && typeof latestContext.slug === 'string') slug = latestContext.slug;
  return call('regexes:replace', [Array.isArray(regexes) ? regexes : [], scope, slug, null]);
}
// 【实机审计修复 2026-09-05】P1：updateTavernRegexesWith——按 _dshtScope 分组整组写回。
// regexes:get 返回三源合并视图（每条带 _dshtScope: global/character/preset）；updater 改完
// 后逐作用域 regexes:replace 整组替换（与真 TH「按 option 取→改→写回」等效；去掉内部
// _dshtScope 标记再落盘，防标记污染数据面文件）。
function updateTavernRegexesWith(updater, option) {
  void option;
  return getTavernRegexes().then(function (regexes) {
    return Promise.resolve(updater(JSON.parse(JSON.stringify(regexes)))).then(function (next) {
      var byScope = { global: [], character: [], preset: [] };
      var list = Array.isArray(next) ? next : [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || typeof s !== 'object') continue;
        var scope = (s._dshtScope === 'character' || s._dshtScope === 'preset') ? s._dshtScope : 'global';
        var clean = {};
        for (var k in s) { if (k !== '_dshtScope') clean[k] = s[k]; }
        byScope[scope].push(clean);
      }
      var slug = (latestContext && typeof latestContext.slug === 'string') ? latestContext.slug : null;
      return Promise.all([
        call('regexes:replace', [byScope.global, 'global', null, null]),
        call('regexes:replace', [byScope.character, 'character', slug, null]),
        call('regexes:replace', [byScope.preset, 'preset', null, null]),
      ]).then(function () { return list; });
    });
  });
}
// 【实机审计修复 2026-09-05】P1：formatAsTavernRegexedString——对文本跑正则脚本
// （display 正则/宏管线消费同一批 RegexScript 形状）。placement 数值抄 ST regex_placement
// 枚举（USER_INPUT=1 / AI_OUTPUT=2 / SLASH_COMMAND=3 / WORLD_INFO=5 / REASONING=6）；
// destination 过滤按 ST 语义：display = 非 promptOnly，prompt = 非 markdownOnly；
// {{match}} → $&（正则捕获组 $1 由 JS replace 原生支持）；substituteRegex 宏替换不做（诚实边界）。
var DSHT_REGEX_PLACEMENT = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };
function formatAsTavernRegexedString(text, source, destination) {
  var placement = DSHT_REGEX_PLACEMENT[source];
  if (placement === undefined) return Promise.resolve(String(text == null ? '' : text));
  return getTavernRegexes().then(function (regexes) {
    var result = String(text == null ? '' : text);
    for (var i = 0; i < regexes.length; i++) {
      var s = regexes[i];
      if (!s || typeof s !== 'object' || s.disabled === true) continue;
      if (!Array.isArray(s.placement) || s.placement.indexOf(placement) === -1) continue;
      if (destination === 'display' && s.promptOnly === true) continue;
      if (destination === 'prompt' && s.markdownOnly === true) continue;
      if (typeof s.findRegex !== 'string' || s.findRegex === '') continue;
      try {
        var re = new RegExp(s.findRegex, 'g');
        // '{{match}}' → '$&'（$$& 转义出字面 $&，再由外层 replace 解释为原匹配文本）
        var rep = typeof s.replaceString === 'string' ? s.replaceString.replace('{{match}}', '$$&') : '';
        result = result.replace(re, rep);
      } catch (e) { /* 坏正则跳过（与 ST 引擎容错一致） */ }
    }
    return result;
  });
}
// 【实机审计修复 2026-09-05】P1：isCharacterTavernRegexesEnabled——ST 查
// extension_settings.character_allowed_regex 白名单；DSH 角色作用域正则恒并入生效
// （regexes:get 三源合并即含 character 组），恒 true。
function isCharacterTavernRegexesEnabled() { return true; }

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
function getLorebookEntries(name) {
  return call('wb:get', [String(name)]).then(function (r) {
    var book = wbBookOf(r);
    return (book && Array.isArray(book.entries)) ? book.entries : [];
  });
}
// updateWorldbookWith（真 TH：fn(entries) → 返回改后数组，差量落盘）。世界书控制/飞讯写路径。
// 差量 = 与原数组按位 JSON 比对，变了才逐条 wb:entryPut（host 单条 upsert；条目删除场景
// entryPut 无法表达——诚实限制，注释标明）。
function updateWorldbookWith(name, fn) {
  return call('wb:get', [String(name)]).then(function (r) {
    var book = wbBookOf(r);
    var orig = (book && Array.isArray(book.entries)) ? book.entries : [];
    return Promise.resolve()
      .then(function () { return fn(orig); })
      .then(function (out) {
        var next = Array.isArray(out) ? out : orig;
        var puts = [];
        for (var i = 0; i < next.length; i++) {
          if (JSON.stringify(next[i]) !== JSON.stringify(orig[i])) puts.push(next[i]);
        }
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
    return (book && Array.isArray(book.entries)) ? book.entries : [];
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
    presetName: ctx.presetName != null ? ctx.presetName : undefined,
    chat: messages,
    chatLength: messages.length,
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
function generateRaw(payload) { return generate(payload); }

// ---- 【实机审计修复 2026-09-05】P2 substitudeMacros（桥到 host /macros/expand 运行期宏展开）----
function substitudeMacros(text) {
  return call('macros:expand', [String(text == null ? '' : text)]).then(function (r) {
    return (r && typeof r.result === 'string') ? r.result : String(text == null ? '' : text);
  });
}

// ---- C7 registerVariableSchema（桥到 host /variables/schema → rp/state variableSchema）----
// 真 TH 收 zod schema：iframe vendor 有 zod v4，经 toJSONSchema 转纯对象过桥；
// 已是普通对象（JSON-Schema 形态）则原样传。name 空 = 整树 schema。
function registerVariableSchema(name, schema) {
  var json = schema || null;
  try {
    if (json && typeof json === 'object' && typeof json.safeParse === 'function'
      && window.Zod && typeof window.Zod.toJSONSchema === 'function') {
      json = window.Zod.toJSONSchema(json);
    }
  } catch (e) { /* 转换失败按原样传（host 按 JSON-Schema 最小子集校验） */ }
  return call('vars:schema', [String(name == null ? '' : name), json]).then(function () { return true; });
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
// 无每消息变量树，诚实限制）；replaceMvuData → /dsht-mvu/variables/register {replace:true}；
// parseMessage → state/mvu.ts parseUpdateVariable 同款提取（<UpdateVariable> 内 <JSONPatch> 数组）。
function dshtParseJsonPatches(seg) {
  var m = seg.match(/<JSONPatch>\\s*([\\s\\S]*?)\\s*<\\/JSONPatch>/i);
  if (!m) return [];
  try {
    var arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (!p || typeof p !== 'object') continue;
      var patch = { op: String(p.op || 'add').toLowerCase(), path: String(p.path || '') };
      if (p.value !== undefined) patch.value = p.value;
      if (patch.path.length > 0) out.push(patch);
    }
    return out;
  } catch (e) { return []; }
}
function dshtParseUpdateVariable(text) {
  var out = [], covered = [], m;
  var re = /<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi;
  while ((m = re.exec(text)) !== null) {
    out = out.concat(dshtParseJsonPatches(m[1]));
    covered.push([m.index, re.lastIndex]);
  }
  // 块外裸 <JSONPatch> 兜底（与 state/mvu.ts 同款：只在覆盖区间之外的文本上解析）
  var outside = '', start = 0, i2;
  for (i2 = 0; i2 < covered.length; i2++) { outside += text.slice(start, covered[i2][0]); start = covered[i2][1]; }
  outside += covered.length > 0 ? text.slice(start) : text;
  if (covered.length === 0) out = out.concat(dshtParseJsonPatches(text));
  else if (outside.length > 0) out = out.concat(dshtParseJsonPatches(outside));
  return out;
}
var mvuBusListeners = {};
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
  getTavernRegexes: getTavernRegexes, replaceTavernRegexes: replaceTavernRegexes,
  // 【实机审计修复 2026-09-05】P1/P2 长尾 API
  getChatHistoryBrief: getChatHistoryBrief, getChatHistoryDetail: getChatHistoryDetail,
  updateTavernRegexesWith: updateTavernRegexesWith,
  formatAsTavernRegexedString: formatAsTavernRegexedString, isCharacterTavernRegexesEnabled: isCharacterTavernRegexesEnabled,
  getWorldbook: getWorldbook, replaceLorebookEntries: replaceLorebookEntries,
  rebindGlobalWorldbooks: rebindGlobalWorldbooks, rebindCharWorldbooks: rebindCharWorldbooks,
  getOrCreateChatWorldbook: getOrCreateChatWorldbook,
  substitudeMacros: substitudeMacros,
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
var __dshtExtSettings = new Proxy(__dshtExtBase, {
  set: function (t, k, v) { t[k] = v; try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(t)); } catch (e) { /* 配额满等：内存保留 */ } return true; },
  deleteProperty: function (t, k) { delete t[k]; try { localStorage.setItem('__dsht_extension_settings', JSON.stringify(t)); } catch (e) { } return true; },
});
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
      name2: ctx.characterName,
      getCurrentChatId: function () { return (latestContext && latestContext.slug != null && typeof latestContext.slug === 'string') ? latestContext.slug : 'current'; }, // 字符串 chat id（比较/文件名用）
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

// ---- 桥回包 / 事件投递 ----
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d[TAG] !== true || d.secret !== SECRET) return;
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

// ---- 错误捕获（上报 host；不翻转 running 状态——host 只在 loading 期判 failed）----
window.addEventListener('error', function (e) {
  post({ th: 'status', phase: 'failed', error: String((e && e.message) || 'script error') });
});
window.addEventListener('unhandledrejection', function (e) {
  var reason = e && e.reason;
  if (reason && reason.__thExpected) return; // shim 自己的不支持 API reject 不算失败
  post({ th: 'status', phase: 'failed', error: String((reason && reason.message) || reason || 'unhandled rejection') });
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
})();`;
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
function detectHostColorScheme() {
    try {
        if (typeof document === 'undefined')
            return 'dark';
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg);
        if (!m)
            return 'dark';
        const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
        return lum >= 128 ? 'light' : 'dark';
    }
    catch {
        return 'dark';
    }
}
export function buildIframeDocument(opts) {
    const body = opts.content.match(/^\s*```[^\n]*\n([\s\S]*)\n```\s*$/)?.[1] ?? opts.content;
    const safe = body.replace(/<\/script/gi, '<\\/script');
    // vendor 里的 </script 出现在字符串/正则字面量中时，转义为 <\/script——JS 语义不变，
    // 但 HTML 解析器不再提前终结 script 标签（jQuery 源码里确实存在该序列）。
    const vendor = thVendorSource.replace(/<\/script/gi, '<\\/script');
    // F2：深色主题 CSS（构建期求宿主明暗，注入 color-scheme 与 pre/code 深色块）
    const scheme = detectHostColorScheme();
    const themeCss = `<style>`
        + `html{color-scheme:${scheme};--TH-viewport-height:100%;--TH-viewport-width:100%}`
        + `html,body{margin:0;padding:0;background:transparent}`
        + `pre,code{background:rgb(128 128 128 / .18);color:inherit;border-radius:6px}`
        + `pre{padding:8px 10px;overflow:auto}code{padding:1px 4px}`
        + `</style>`;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<base href="about:blank" />
<script data-dsht-th-vendor>${vendor}</script>
<script>${buildShimSource(opts)}</script>
<script src="https://testingcf.jsdelivr.net/npm/lodash@4/lodash.min.js"></script>
<script src="https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js"></script>
<script src="https://testingcf.jsdelivr.net/npm/vue-router/dist/vue-router.global.prod.min.js"></script>
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
</body>
</html>`;
}
function optionToScope(option, scriptId) {
    const o = (option && typeof option === 'object' ? option : { type: 'chat' });
    const type = o.type ?? 'chat';
    if (type === 'script')
        return { scope: 'script', scriptId: o.script_id ?? scriptId };
    if (type === 'global' || type === 'preset' || type === 'character' || type === 'chat') {
        return { scope: type, scriptId: '' };
    }
    throw new Error(`unsupported variable scope: ${String(type)}`);
}
/** 深合并（high 覆盖 low 叶值；对象递归）——host 侧 assign 合并用 */
export function deepMergeAssign(low, high) {
    const out = { ...low };
    for (const [k, v] of Object.entries(high)) {
        const prev = out[k];
        if (prev !== null && v !== null && typeof prev === 'object' && typeof v === 'object' && !Array.isArray(prev) && !Array.isArray(v)) {
            out[k] = deepMergeAssign(prev, v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
/** insert 语义合并：只补缺口（existing 叶值恒胜） */
export function deepMergeInsert(existing, vars) {
    return deepMergeAssign(vars, existing);
}
/** 桥调用分发（幂等可追溯：调用方负责 console 记录；未知 api 抛错） */
export async function handleBridgeCall(deps, scriptId, api, args) {
    switch (api) {
        case 'vars:get': {
            const { scope, scriptId: sid } = optionToScope(args[0], scriptId);
            return deps.varsGet(scope, sid);
        }
        case 'vars:put': {
            const { scope, scriptId: sid } = optionToScope(args[0], scriptId);
            const tree = args[1];
            if (tree === null || typeof tree !== 'object' || Array.isArray(tree))
                throw new Error('variables must be object');
            await deps.varsPut(scope, tree, sid);
            return null;
        }
        case 'vars:merge': {
            const { scope, scriptId: sid } = optionToScope(args[0], scriptId);
            const vars = args[1];
            if (vars === null || typeof vars !== 'object' || Array.isArray(vars))
                throw new Error('variables must be object');
            const mode = args[2] === 'insert' ? 'insert' : 'assign';
            await deps.varsMerge(scope, vars, mode, sid);
            return null;
        }
        case 'vars:delete': {
            const { scope, scriptId: sid } = optionToScope(args[0], scriptId);
            await deps.varsDelete(scope, String(args[1] ?? ''), sid);
            return null;
        }
        case 'vars:all':
            return deps.varsAll(scriptId);
        // ---- C7：chat 作用域深合并走服务端（/variables/merge 收口 undo/快照/schema 校验）；
        // 其余作用域退回客户端读改写（facade 变量合并仅落 rp/state chat 树）----
        case 'vars:assign': {
            const { scope, scriptId: sid } = optionToScope(args[0], scriptId);
            const vars = args[1];
            if (vars === null || typeof vars !== 'object' || Array.isArray(vars))
                throw new Error('variables must be object');
            if (scope === 'chat' && sid === '') {
                await deps.varsAssignChat(vars);
                return null;
            }
            await deps.varsMerge(scope, vars, 'assign', sid);
            return null;
        }
        // ---- C7：变量 schema 注册（zod → JSON-Schema 已在 shim 侧转换）----
        case 'vars:schema': {
            const name = String(args[0] ?? '');
            const schema = args[1];
            if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
                throw new Error('variableSchema object required');
            await deps.varsSchemaPut(name, schema);
            return null;
        }
        // ---- C8：prompt 注入存储 ----
        case 'injects:put': {
            const list = Array.isArray(args[0])
                ? args[0].filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
                : [];
            await deps.injectsPut(list);
            return null;
        }
        case 'injects:remove': {
            const keys = Array.isArray(args[0]) ? args[0].map(k => String(k)) : [];
            await deps.injectsRemove(keys);
            return null;
        }
        // ---- C9：一次性补全 ----
        case 'generate':
            return deps.generate(String(args[0] ?? ''), String(args[1] ?? ''));
        // ---- D6：window.Mvu 数据面 ----
        case 'mvu:data':
            return deps.mvuVariables();
        case 'mvu:replace': {
            const data = args[0];
            if (data === null || typeof data !== 'object' || Array.isArray(data))
                throw new Error('mvu data must be object');
            await deps.mvuReplace(data);
            return null;
        }
        case 'buttons:get':
            return deps.buttonsGet(scriptId);
        case 'buttons:set': {
            const buttons = Array.isArray(args[0]) ? args[0] : [];
            deps.buttonsSet(scriptId, buttons);
            return null;
        }
        case 'lorebook:primary':
            return deps.primaryLorebook();
        // ---- 上下文 / 预设 / 聊天消息 / 正则 / 世界书（真实现桥分发）----
        case 'ctx:get': {
            const sessionId = typeof args[0] === 'string' ? args[0] : '';
            const slug = typeof args[1] === 'string' ? args[1] : '';
            return deps.ctxGet(sessionId, slug);
        }
        case 'preset:names': {
            const sessionId = typeof args[0] === 'string' && args[0] ? args[0] : undefined;
            return deps.presetNames(sessionId);
        }
        case 'preset:get':
            return deps.presetGet(String(args[0] ?? ''));
        case 'preset:put': {
            const prompts = (Array.isArray(args[1]) ? args[1] : []);
            const promptOrder = (Array.isArray(args[2]) ? args[2] : []);
            return deps.presetPut(String(args[0] ?? ''), prompts, promptOrder, args[3] === true);
        }
        case 'preset:delete':
            return deps.presetDelete(String(args[0] ?? ''));
        case 'preset:rename':
            return deps.presetRename(String(args[0] ?? ''), String(args[1] ?? ''));
        case 'preset:load': {
            const sessionId = typeof args[0] === 'string' ? args[0] : '';
            return deps.presetLoad(sessionId, String(args[1] ?? ''));
        }
        case 'chat:messages': {
            const sessionId = typeof args[0] === 'string' ? args[0] : '';
            return deps.chatMessages(sessionId);
        }
        case 'regexes:get': {
            const slug = typeof args[0] === 'string' ? args[0] : '';
            const sessionId = typeof args[1] === 'string' ? args[1] : '';
            return deps.regexesGet(slug, sessionId);
        }
        case 'regexes:replace': {
            const regexes = (Array.isArray(args[0]) ? args[0] : []);
            const scope = args[1] === 'character' || args[1] === 'preset' ? args[1] : 'global';
            const slug = typeof args[2] === 'string' ? args[2] : '';
            const sessionId = typeof args[3] === 'string' ? args[3] : '';
            return deps.regexesReplace(regexes, scope, slug, sessionId);
        }
        case 'wb:list':
            return deps.wbList();
        case 'wb:get':
            return deps.wbGet(String(args[0] ?? ''));
        case 'wb:entryPut': {
            const entry = (args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])
                ? args[1] : {});
            return deps.wbEntryPut(String(args[0] ?? ''), entry);
        }
        // ---- 【实机审计修复 2026-09-05】P1/P2 长尾分发 ----
        case 'macros:expand':
            return deps.macrosExpand(String(args[0] ?? ''));
        case 'wb:replaceEntries': {
            const entries = (Array.isArray(args[1]) ? args[1] : []);
            return deps.wbReplaceEntries(String(args[0] ?? ''), entries);
        }
        case 'wb:rebindGlobal': {
            const names = Array.isArray(args[0]) ? args[0].map(n => String(n)) : [];
            return deps.wbRebindGlobal(names);
        }
        case 'wb:rebindChar': {
            const names = Array.isArray(args[1]) ? args[1].map(n => String(n)) : [];
            return deps.wbRebindChar(String(args[0] ?? ''), names);
        }
        case 'wb:chatGetOrCreate':
            return deps.wbChatGetOrCreate();
        default:
            throw new Error(`unknown bridge api: ${api}`);
    }
}
