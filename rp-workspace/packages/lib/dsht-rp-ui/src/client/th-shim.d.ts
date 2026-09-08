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
export declare const TH_MSG_TAG = "__dsht_th";
export interface SessionScript {
    id: string;
    name: string;
    content: string;
    buttonEnabled: boolean;
    buttons: Array<{
        name: string;
        visible: boolean;
    }>;
    data: Record<string, unknown>;
    source: 'preset' | 'character';
}
export type ScriptPhase = 'loading' | 'running' | 'failed';
export interface ScriptStatus {
    phase: ScriptPhase;
    /** phase=failed 的原因 / running 时的最近运行时错误（诚实展示，不翻转状态） */
    error?: string | undefined;
    /** 调了 shim 未覆盖的 API（记名清单，脚本管理面板展示） */
    missing: string[];
    /** 脚本渲染了自有 UI（iframe 内有可见内容） */
    hasUi?: boolean | undefined;
    buttons: Array<{
        name: string;
        visible: boolean;
    }>;
}
export interface BridgeCallMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'call';
    callId: number;
    api: string;
    args: unknown[];
}
export interface BridgeStatusMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'status';
    phase: ScriptPhase;
    error?: string;
}
export interface BridgeMissingMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'missing';
    api: string;
}
export interface BridgeToastMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'toast';
    level: string;
    message: string;
}
export interface BridgeUiMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'ui';
    hasUi: boolean;
    /** 脚本 UI 的并集矩形（iframe 内视口坐标；host 按它 resize iframe——只包住 UI） */
    rect?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}
/** iframe console 转发（C15 日志抽屉：shim 包装 console.*，shim 侧已字符串化） */
export interface BridgeConsoleMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'console';
    level: string;
    message: string;
}
export type BridgeIncoming = BridgeCallMsg | BridgeStatusMsg | BridgeMissingMsg | BridgeToastMsg | BridgeUiMsg | BridgeConsoleMsg;
/** 预设 prompt（ST prompt_manager 形状子集） */
export interface ThPresetPrompt {
    identifier?: string;
    name?: string;
    role?: string;
    content?: string;
    system_prompt?: boolean;
    marker?: boolean;
    injection_position?: unknown;
    injection_depth?: number;
    [key: string]: unknown;
}
/** prompt_order 单条（enabled 开关） */
export interface ThPromptOrderItem {
    identifier: string;
    enabled: boolean;
}
/** prompt_order 分组（ST 按角色 id 分组，DSH 只用第一组） */
export interface ThPromptOrder {
    character_id?: number;
    order: ThPromptOrderItem[];
}
/** 预设（prompts + prompt_order） */
export interface ThPreset {
    name?: string;
    prompts?: ThPresetPrompt[];
    prompt_order?: ThPromptOrder[];
    [key: string]: unknown;
}
/** 聊天消息（/chat/messages 投影；message_id 为楼层号） */
export interface ThChatMessage {
    message_id: number;
    name?: string;
    role?: string;
    message?: string;
    is_system?: boolean;
    [key: string]: unknown;
}
/**
 * 上下文快照（宿主组装：/context 响应 + /chat/messages 响应 + slug），
 * 经 {th:'context'} 推送进 iframe，getContext() / SillyTavern.getContext() 同步读。
 */
export interface ThContextSnapshot {
    presetId?: string | null;
    presetName?: string | null;
    character?: {
        name?: string;
    } | null;
    /** 当前角色绑定的 primary 世界书名（宿主从 rp/workspaces 取；getCharWorldbookNames 同步读） */
    characterLorebook?: string | null;
    chatCompletionSettings?: {
        prompts?: ThPresetPrompt[];
        prompt_order?: ThPromptOrder[];
    };
    /** 当前 RP 工作区 slug（replaceTavernRegexes character 作用域需要） */
    slug?: string | null;
    messages?: ThChatMessage[];
    [key: string]: unknown;
}
/** host → iframe 上下文快照推送 */
export interface BridgeContextPushMsg {
    [TH_MSG_TAG]: true;
    secret: string;
    scriptId: string;
    th: 'context';
    context: ThContextSnapshot;
}
/** 入站消息解析（非法/伪造消息返回 null；secret 校验调用方做） */
export declare function parseIncomingMessage(data: unknown): BridgeIncoming | null;
/** ST public/scripts/utils.js getStringHash 同款（Java string hash） */
export declare function getStringHash(str: string): number;
export declare function getButtonEventId(scriptId: string, buttonName: string): string;
/** 事件常量（【实机审计修复 2026-09-05】C6：对齐真 TH tavern_events 全表 82 项——
 * 名值逐项抄自 ST 扩展 @types/iframe/event.d.ts 的导出（含 CHARACTER_DELETED:'characterDeleted'
 * / CHARACTER_MANAGEMENT_DROPDOWN:'charManagementDropdown' 等不规则值）；常量本身无依赖，全量给出） */
export declare const TAVERN_EVENTS: Record<string, string>;
/** iframe 生命周期事件（【实机审计修复 2026-09-05】C6：补 generate 通道与流式 token 四项，
 * 名值抄自真 TH iframe_events 导出） */
export declare const IFRAME_EVENTS: Record<string, string>;
/** shim 本地实现（不过桥）的 API */
export declare const SHIM_LOCAL_APIS: readonly ["eventOn", "eventOnce", "eventEmit", "eventEmitAndWait", "eventRemoveListener", "eventClearEvent", "eventClearAll", "eventMakeFirst", "eventMakeLast", "eventOnButton", "getButtonEvent", "getVariables", "getAllVariables", "insertVariables", "insertOrAssignVariables", "updateVariablesWith", "replaceVariables", "deleteVariable", "getScriptButtons", "replaceScriptButtons", "updateScriptButtonsWith", "appendInexistentScriptButtons", "getTavernHelperVersion", "getTavernVersion", "getScriptId", "getScriptName", "getCurrentCharPrimaryLorebook", "getCharWorldbookNames", "getLastMessageId", "triggerSlash", "audio"];
/**
 * 经桥实现的 API（iframe 内函数 → call('xxx') 走 host 数据面 /dsht-tavern-helper/*）。
 * 与 SHIM_LOCAL_APIS 一样挂为裸全局（真 TH predefine.js 行为）。
 */
export declare const SHIM_BRIDGE_APIS: readonly ["getContext", "getPresetNames", "getPreset", "getLoadedPresetName", "presetExists", "createPreset", "createOrReplacePreset", "replacePreset", "setPreset", "deletePreset", "renamePreset", "loadPreset", "updatePresetWith", "isPresetNormalPrompt", "isPresetPlaceholderPrompt", "isPresetSystemPrompt", "getChatMessages", "getChatMessage", "getTavernRegexes", "replaceTavernRegexes", "getWorldbooks", "getLorebookEntries", "updateWorldbookWith", "registerVariableSchema", "injectPrompts", "uninjectPrompts", "generate", "generateRaw", "getChatHistoryBrief", "getChatHistoryDetail", "updateTavernRegexesWith", "formatAsTavernRegexedString", "isCharacterTavernRegexesEnabled", "getWorldbook", "replaceLorebookEntries", "rebindGlobalWorldbooks", "rebindCharWorldbooks", "getOrCreateChatWorldbook", "substitudeMacros"];
/**
 * 已知但不支持的 API（挂 stub：console.warn 记名 + Promise.reject）。
 * 都是深度钩 ST 内部组件或与宿主数据模型冲突的面（chat 写路径 / 扩展管理 / 世界书写路径）。
 * 预设 CRUD / 聊天消息读 / 正则 / 世界书名单与条目读 / getContext 已移植为真实现（见 SHIM_BRIDGE_APIS）。
 * 生成控制只移植一次性补全（generate/generateRaw → /dsht-rp/llm/classify；C9）——生成管线
 * 控制（stop/模型清单/代理）仍记名拒绝；prompt 注入为存储面真实现（C8）；斜杠命令走
 * triggerSlash 最小映射（C18）；音频走 audio.bgm/ambient（C17）。
 */
export declare const UNSUPPORTED_APIS: readonly ["stopAllGeneration", "stopGenerationById", "getModelList", "getProxyPresetNames", "setChatMessage", "setChatMessages", "createChatMessages", "deleteChatMessages", "rotateChatMessages", "formatAsDisplayedMessage", "retrieveDisplayedMessage", "refreshOneMessage", "getLorebooks", "getCharLorebooks", "getChatLorebook", "getOrCreateChatLorebook", "setChatLorebook", "createLorebook", "deleteLorebook", "getLorebookSettings", "setLorebookSettings", "setCurrentCharLorebooks", "createLorebookEntry", "createLorebookEntries", "deleteLorebookEntry", "deleteLorebookEntries", "setLorebookEntries", "updateLorebookEntriesWith", "getCharacterNames", "getCharacterIds", "getCharacter", "getCurrentCharacterId", "getCurrentCharacterName", "createCharacter", "createOrReplaceCharacter", "deleteCharacter", "replaceCharacter", "updateCharacterWith", "getPersonaNames", "getPersona", "createPersona", "createOrReplacePersona", "deletePersona", "replacePersona", "registerMacroLike", "unregisterMacroLike", "getAudioList", "appendAudioList", "replaceAudioList", "playAudio", "pauseAudio", "getCurrentAudio", "getAudioSettings", "setAudioSettings", "isAdmin", "installExtension", "uninstallExtension", "updateExtension", "reinstallExtension", "isInstalledExtension", "getExtensionType", "getExtensionInstallationInfo", "importRawCharacter", "importRawChat", "importRawPreset", "importRawTavernRegex", "importRawWorldbook", "getScriptTrees", "replaceScriptTrees", "updateScriptTreesWith", "getAllEnabledScriptButtons", "writeExtensionField", "updateTavernHelper"];
/**
 * 记名拒绝的逐 API 理由（shim stub 的错误消息引用；未列出的 API 用通用理由）。
 * 聊天消息写路径拒绝理由要点：DSH 会话日志是 append-only，写历史与宿主记录有损漂移。
 */
export declare const UNSUPPORTED_REASONS: Record<string, string>;
export interface ShimOptions {
    scriptId: string;
    scriptName: string;
    /** 会话级运行时密钥（防伪消息；每运行时随机） */
    secret: string;
    /** 移植版本标识（getTavernHelperVersion 返回值） */
    version: string;
}
/**
 * shim 源码：装在脚本 module 之前。API 面 = window.TavernHelper（Proxy）+ 同名裸全局
 * （真 TH predefine.js 行为：所有 API 同时是 bare global，脚本写 getVariables(...) 不带前缀）。
 *  shim 内不嵌模板字符串（避免与宿主生成代码的 ${} 冲突）。
 */
export declare function buildShimSource(opts: ShimOptions): string;
export declare function buildIframeDocument(opts: ShimOptions & {
    content: string;
}): string;
export type VarScope = 'global' | 'preset' | 'character' | 'chat' | 'script';
export interface VarOption {
    type?: string;
    script_id?: string;
    message_id?: number | 'latest';
}
export interface ThBridgeDeps {
    /** 读作用域变量树（script 作用域传 scriptId） */
    varsGet: (scope: VarScope, scriptId: string) => Promise<Record<string, unknown>>;
    /** 整树替换 */
    varsPut: (scope: VarScope, tree: Record<string, unknown>, scriptId: string) => Promise<void>;
    /** 深合并（mode: assign = 新值覆盖 / insert = 仅补缺） */
    varsMerge: (scope: VarScope, vars: Record<string, unknown>, mode: 'assign' | 'insert', scriptId: string) => Promise<void>;
    /** 按 lodash 路径删除 */
    varsDelete: (scope: VarScope, path: string, scriptId: string) => Promise<void>;
    /** 五层合并视图（global<preset<character<script<chat；script = 当前脚本私有树） */
    varsAll: (scriptId: string) => Promise<Record<string, unknown>>;
    buttonsGet: (scriptId: string) => Array<{
        name: string;
        visible: boolean;
    }>;
    buttonsSet: (scriptId: string, buttons: Array<{
        name: string;
        visible: boolean;
    }>) => void;
    primaryLorebook: () => Promise<string | null>;
    /** 上下文快照（/context 响应；无 RP 上下文返回 null） */
    ctxGet: (sessionId: string, slug: string) => Promise<ThContextSnapshot | null>;
    /** 预设名清单（/preset/names；loaded = 当前已加载预设名） */
    presetNames: (sessionId?: string) => Promise<{
        names: string[];
        loaded?: string | null;
    }>;
    presetGet: (name: string) => Promise<{
        found: boolean;
        preset?: ThPreset | null;
    }>;
    /** 写预设（create:true = 缺则建） */
    presetPut: (name: string, prompts: ThPresetPrompt[], prompt_order: ThPromptOrder[], create?: boolean) => Promise<void>;
    presetDelete: (name: string) => Promise<void>;
    presetRename: (name: string, newName: string) => Promise<void>;
    presetLoad: (sessionId: string, name: string) => Promise<void>;
    /** 聊天消息（append-only 日志的只读投影） */
    chatMessages: (sessionId: string) => Promise<{
        messages: ThChatMessage[];
    }>;
    regexesGet: (slug: string, sessionId: string) => Promise<{
        regexes: Record<string, unknown>[];
        presetId?: string | null;
        slug?: string | null;
    }>;
    /** 正则整表替换（scope: global / character(slug) / preset(presetId)） */
    regexesReplace: (regexes: Record<string, unknown>[], scope: 'global' | 'character' | 'preset', slug: string, sessionId: string) => Promise<void>;
    wbList: () => Promise<{
        books: Array<{
            name: string;
            lorePath?: string | null;
        }>;
    }>;
    wbGet: (name: string) => Promise<{
        book: {
            name?: string;
            entries?: Record<string, unknown>[];
        } | null;
    }>;
    wbEntryPut: (name: string, entry: Record<string, unknown>) => Promise<void>;
    /** 运行期宏展开（substitudeMacros：/macros/expand → {result, writes, unknownMacros}） */
    macrosExpand: (text: string) => Promise<{
        result?: string;
    }>;
    /** 世界书条目整表替换（replaceLorebookEntries；ST entry 形状数组） */
    wbReplaceEntries: (name: string, entries: Record<string, unknown>[]) => Promise<void>;
    /** 全局激活书单重绑（rebindGlobalWorldbooks；rp/global-books.json 整组替换） */
    wbRebindGlobal: (names: string[]) => Promise<void>;
    /** 角色工作区书单重绑（rebindCharWorldbooks；rp/<slug>/rp.json books 整组替换） */
    wbRebindChar: (slug: string, names: string[]) => Promise<void>;
    /** 会话绑定世界书缺则建（getOrCreateChatWorldbook；rp/chat-worldbooks/<sessionId>.json） */
    wbChatGetOrCreate: () => Promise<{
        name?: string;
    }>;
    /** chat 作用域深合并写入（C7：facade /variables/merge——服务端 undo/快照/schema 校验收口） */
    varsAssignChat: (vars: Record<string, unknown>) => Promise<void>;
    /** 变量 schema 注册（C7：facade /variables/schema → rp/state variableSchema） */
    varsSchemaPut: (name: string, schema: Record<string, unknown>) => Promise<void>;
    /** prompt 注入存储（C8：/inject 同 key 覆盖写入） */
    injectsPut: (injections: Record<string, unknown>[]) => Promise<void>;
    /** prompt 注入移除（C8：/uninject 按 key） */
    injectsRemove: (keys: string[]) => Promise<void>;
    /** 一次性补全（C9：/generate loopback → /dsht-rp/llm/classify） */
    generate: (system: string, prompt: string) => Promise<{
        ok?: boolean;
        text?: string;
    }>;
    /** MVU 变量树（D6：GET /dsht-mvu/variables 的 variables） */
    mvuVariables: () => Promise<Record<string, unknown>>;
    /** MVU 整组替换（D6：/dsht-mvu/variables/register {replace:true}） */
    mvuReplace: (data: Record<string, unknown>) => Promise<void>;
}
/** 深合并（high 覆盖 low 叶值；对象递归）——host 侧 assign 合并用 */
export declare function deepMergeAssign(low: Record<string, unknown>, high: Record<string, unknown>): Record<string, unknown>;
/** insert 语义合并：只补缺口（existing 叶值恒胜） */
export declare function deepMergeInsert(existing: Record<string, unknown>, vars: Record<string, unknown>): Record<string, unknown>;
/** 桥调用分发（幂等可追溯：调用方负责 console 记录；未知 api 抛错） */
export declare function handleBridgeCall(deps: ThBridgeDeps, scriptId: string, api: string, args: unknown[]): Promise<unknown>;
