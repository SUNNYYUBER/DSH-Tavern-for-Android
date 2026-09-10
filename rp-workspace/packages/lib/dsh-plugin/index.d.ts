/**
 * DSHTavern RP 插件（Cordis 插件，挂 DSH web profile 全局层）
 *
 * 职责（M2 最小闭环，计划文档 §4.2 被动检索 + §4.14 工作区模型）：
 * - 识别 RP 会话：session cwd 位于 $DSH_HOME/rp/<slug> 且该目录有 rp.json
 * - 每轮 pre-step：从 surface 重建最近历史 → 加载工作区关联世界书 →
 *   M1 触发引擎扫描（constant/关键词/递归/预算）→ 激活条目以 runtime-context
 *   快照消息注入请求批次（官方 RuntimeContextProjection 同款模式：
 *   durable user 消息 + form:'snapshot' + 内容不变不重复注入）
 * - HTTP 数据面（T2.5f 下发链）：ctx.webServer 前缀路由 /dsht-rp/*——
 *   同源、零端口冲突（旧 3081 独立端口方案在端口被占时会以未处理 error
 *   击穿整个 DSH 进程，已废弃）
 *
 * 零 DSH 源码改动：仅消费 agent/pre-step waterfall 事件与 rp.json 数据约定。
 * 打包：esbuild bundle（trigger.ts 内联，@deepseek-ai/* 仅类型导入被擦除）。
 */
import type { LoreEntry } from '../lore/entry.ts';
import { type RegexScript } from '../regex/engine.ts';
import { type MacroContext } from '../macros/engine.ts';
export { findStDataRoot } from './import-preview.ts';
export { truncateSessionJsonl, findLastUserMessage } from '../dsht-plugin-shared/session-surgery.ts';
export declare function loadEjsSettings(dshHomeDir: string): Promise<Record<string, unknown>>;
interface LikeMessage {
    role: string;
    content: Array<{
        type: string;
        text?: string;
    }>;
    source?: {
        kind?: string;
        plugin?: string;
        form?: string;
    };
}
interface LikeEvent {
    type: string;
    seq: number;
    data: unknown;
}
interface LikeSession {
    header: {
        cwd?: string;
        agentPreset?: string;
    };
    surface: {
        nodes: readonly number[];
    };
    events: readonly LikeEvent[];
    append: (type: string, data: unknown, opts?: {
        surfaceOp?: unknown;
        sourceEventSeqs?: number[];
    }) => unknown;
}
interface LikeAgent {
    session: LikeSession;
}
/** 工具执行上下文（对照 dsh-tools ToolExecution 最小面） */
interface LikeToolExec {
    signal: AbortSignal;
    agent?: LikeAgent;
}
/** AgentRegistry 最小面（结论 4/5：agents.get + inject） */
interface LikeAgentFull extends LikeAgent {
    inject: (message: unknown) => unknown;
    /** 内核 driver phase（R49 同步面：idle 时 lastTurn 可安全推进——构造时缓存，
     *  外部直写 turn/start 事件不会刷新它，见 open-chat 物化处） */
    phase?: {
        kind?: string;
        lastTurn?: number;
    } | undefined;
}
interface LikeAgentRegistry {
    get: (id: string) => LikeAgentFull | undefined;
}
interface LikeToolDef {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render: (args: unknown, value: unknown) => Array<{
            type: string;
            text: string;
        }>;
    };
    isConcurrencySafe?: () => boolean;
    execute: (args: Record<string, unknown>, exec: LikeToolExec) => Promise<unknown>;
}
interface LikeContext {
    on: (event: string, listener: (event: unknown, next: () => Promise<unknown>) => Promise<unknown>) => void;
    tools?: {
        register: (tool: LikeToolDef) => unknown;
    };
    systemPrompt?: {
        section: (section: {
            name: string;
            order: number;
            text: string;
        }) => unknown;
    };
    /** llm 最小面（dsh-llm GenerateOptions/StreamChunk；导入管线 AI 语义分类用） */
    llm?: {
        stream: (options: {
            provider: string;
            model: string;
            system?: string;
            messages: Array<{
                role: string;
                content: Array<{
                    type: string;
                    text?: string;
                }>;
            }>;
        }) => AsyncIterable<{
            type: string;
            text?: string;
        }>;
    };
    /** 默认模型选择（dsh-agent-default-model；settings 层实时读；saveSelection 写用户层） */
    agentDefaultModel?: {
        currentSelection: () => {
            provider: string;
            model: string;
        };
        saveSelection?: (sel: {
            provider: string;
            model: string;
        }) => Promise<void>;
    };
    /** webServer 路由注册面（host-webserver；web profile 必备；port = 实际监听端口） */
    webServer?: {
        register: (route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: unknown, res: unknown) => void | Promise<void>;
        }) => () => void;
        host?: '127.0.0.1' | '0.0.0.0';
        port?: number;
    };
    /** settings seam（dsh-settings-file；R4 API 配置导入直写 llm-pi-ai 用户层，live 生效）。get = 读命名空间解析值（R15 模型补齐合并 models 用；可能不可用）。register = 注册命名空间 Schema（§2.3 ③ 聊天偏好；真实服务形态见 dsht-plugin-memory LikeSettingsSvc） */
    settings?: {
        update: (ns: string, patch: Record<string, unknown>) => Promise<unknown>;
        get?: (ns: string) => unknown;
        register?: (ns: string, schema: unknown, options?: {
            base?: unknown;
        }) => unknown;
    };
    /** credentials seam（dsh-credentials-local；写 $DSH_HOME/.credentials.yaml，mode 0600） */
    credentials?: {
        set: (ref: string, value: string) => Promise<unknown>;
    };
    effect?: (fn: () => () => void, label?: string) => unknown;
    /** cordis reflect.get：免 inject 读可选服务（P1#6 读 agentPresets 做能力轴探测；缺席返回 undefined） */
    get?: (name: string, strict?: boolean) => unknown;
}
/** 工作区 rp.json（迁移器生成，见 dsh-export.ts） */
interface RpWorkspace {
    schemaVersion: number;
    characterName: string;
    books: Array<{
        name: string;
        lorePath: string;
    }>;
    trigger: {
        scanDepth?: number;
        matchWholeWords?: boolean;
        budgetPercent?: number;
        budgetCap?: number;
    };
    macros: {
        char: string;
        user: string;
    };
    firstMes?: string;
    /** 正则脚本（T1.2 落盘；组装层三时机消费） */
    regex?: RegexScript[];
    /**
     * 第四轮：卡设定快照文本（取代 .agent-presets/rp-* agent preset）。
     * pre-step 检测 RP 会话时作为快照注入（过宏引擎），agent 预设界面只留真预设。
     */
    promptPersona?: string;
}
export declare const name = "dsht-rp-plugin";
export declare const inject: string[];
/**
 * 从 session surface 重建最近消息文本（旧→新）。
 * 排除快照类消息（我们自己注入的与官方 runtime-context 的）——避免旧快照
 * 内容参与关键词扫描造成自我强化/递归漂移。
 */
export declare function scanSurfaceHistory(session: LikeSession, claimed: LikeMessage[], limit: number, regexScripts?: RegexScript[]): string[];
/** I8-1（移动端鲁棒性）：live session 的立即耐久 barrier——append 后必须 await，
 * 200ms 批窗口内进程被杀（Android LMK SIGKILL）即丢标记（回退成功但重启后消失）。
 * 失败必须上抛（调用方 500），禁止静默假成功。 */
export declare function flushLiveSession(sessions: unknown, session: unknown): Promise<boolean>;
/** 坑 #22 共享适配：读一个 seq 的事件（0.1.2 Session 无公开 events，改 eventAt；
 * agent 内部旧对象回落 .events）。 */
export declare function sessionEventAt(session: unknown, seq: number): {
    type?: string;
    data?: unknown;
    time?: unknown;
} | undefined;
/** 坑 #22 共享适配：全量事件快照（0.1.2 用 snapshotEvents()，旧对象回落 .events）。 */
export declare function sessionEventsSnapshot(session: unknown): Array<{
    type?: string;
    data?: unknown;
    time?: unknown;
    seq?: number;
}>;
/** B18（旧特性兼容）：条目「参与」判定——invertEnabled 时禁用条目视为启用（ST invert_enabled 同语义）。 */
export declare function entryActive(entry: {
    disable?: unknown;
    enabled?: unknown;
    constant?: boolean;
}, invert: boolean): boolean;
export interface LoaderSplit {
    before: LoreEntry[];
    after: LoreEntry[];
}
/** B3：[GENERATE:BEFORE/AFTER] 条目扫描（ST handleGenerateBefore/After 同语义——
 * 不看关键词激活，生成期整体求值注入；BEFORE=主提示词带区前，AFTER=后）。 */
export declare function scanGenerateEntries(entries: LoreEntry[]): LoaderSplit;
/** B6：[RENDER:BEFORE/AFTER] 条目扫描（ST handleMessageRender 的 RENDER 注入——
 * 显示期把条目求值结果包裹在楼层正文前/后；数据面给 /dsht-ejs/render-entries 消费）。 */
export declare function scanRenderEntries(entries: LoreEntry[]): LoaderSplit;
export interface InjectDirective {
    entry: LoreEntry;
    depth: number;
    role: 'system' | 'user' | 'assistant';
    order: number;
}
/** B4：@Inject 指令条目扫描（ST inject-prompt 同语义——首行 `@Inject: depth=4 role=system
 * order=100`，正文为注入内容；不看关键词激活，恒按 depth 定位注入）。 */
export declare function scanInjectEntries(entries: LoreEntry[]): InjectDirective[];
/** D1/B12：世界书变量初始化扫描——`<initvar>` / `[initvar]` / `[InitialVariables]` /
 * `<defineEJSVariable>` 块提取（JSON 优先，YAML-lite `key: value` 缩进树兜底），
 * 返回合并变量树（后条目覆盖同路径叶值）。 */
export declare function parseInitVariables(entries: LoreEntry[]): Record<string, unknown>;
/** I7（性能）：重载荷截断——工具调用/结果块里的大字符串（10MB+ base64 图等）在进
 * prompt 前替换为占位符（0.1.2 spill 只截结果不截参数，参数侧在此补齐）。非变异。 */
export declare function truncateHeavyToolPayloads<T extends object>(messages: T[], maxLen?: number): {
    messages: T[];
    truncated: number;
};
/** B9：楼层模板语句过滤——生成期把 `<% ... %>` 从消息文本剥离（ST filter_chat_message
 * 同语义：楼层模板只渲染显示，不进模型上下文）。非变异。 */
export declare function filterTemplateStatements<T extends object>(messages: T[]): {
    messages: T[];
    filtered: number;
};
export declare function atomicWriteFile(path: string, content: string): Promise<void>;
/** I8-3（移动端鲁棒性）：会话文件手术锁——0.1.2 无 lease，多写者（残留 runtime /
 * 第二进程）是 seq gap 的主因。手术期间持独占 .lock（wx 独占创建 = 进程级互斥），
 * 拿不到锁立即失败（不等待——手术是低频运维操作，排队无意义）。 */
export declare function withSessionLock<T>(file: string, fn: () => Promise<T>): Promise<T>;
/** I4/I5：全局用户档案（{{user}} 宏的值来源；ST「用户设置」等价物）。
 * 存 rp/user-profile.json {name, description}；进程级缓存，PUT 时失效。 */
export interface RpUserProfile {
    name: string;
    description: string;
}
export declare function loadUserProfileCached(dshHome: string): Promise<RpUserProfile>;
/** I4（ST 宏系统）：核心宏展开器（生成期 + 显示期共用语义）。
 * 覆盖 ST MacrosParser 高频基础宏：{{user}}/{{char}}/{{time}}/{{date}}/{{weekday}}/
 * {{random:a,b,c}}/{{pick:a,b,c}}/{{roll:X}}/{{roll:X,N}}；未知宏原样保留（ST 同款）。 */
export declare function expandCoreMacros(text: string, ctx: {
    user?: string;
    char?: string;
}): string;
/** rp.json 快照文本渲染：激活条目 → 注入块（宏替换 {{char}}/{{user}}） */
export declare function renderWorldInfoSnapshot(activated: Array<{
    entry: LoreEntry;
    reason: string;
}>, macros: {
    char: string;
    user: string;
}): string;
/** header cwd 是否需要修复（仅处理 Android symlink 形态；相对路径/其他形态不动） */
export declare function sessionCwdNeedsRepair(cwd: unknown): cwd is string;
/**
 * 改写 session.jsonl 首行 header 的 cwd（只动首行；事件行不碰）。
 * 返回 null = 不是 session header / 无需改。
 */
export declare function rewriteSessionHeaderCwd(line: string, canonicalCwd: string): string | null;
export interface SessionSeqRepair {
    /** 是否发生了修复（false = seq 本就连续，幂等短路） */
    repaired: boolean;
    /** 修复后的完整文件内容（repaired=false 时 = 原文） */
    content: string;
    /** 参与判定的事件行数 */
    events: number;
    /** 无法修复的原因（header 缺失/事件行坏 JSON/seq 非数值） */
    error?: string;
    /** I8-4：回绕截尾时截掉的事件数（0 = 走重编号路径） */
    truncated?: number;
    /** 截尾原因描述（诊断/日志用） */
    note?: string;
}
export declare function repairSessionSeqs(content: string): SessionSeqRepair;
/**
 * 从 agent.cordis.yml 文本抽取 persona text（`text: |-` 块；第四轮存量迁移用：
 * .agent-presets/rp-* 的 persona 正文抽进 rp.json.promptPersona）。解析失败返回 null。
 */
export declare function extractPersonaTextFromAgentYml(yml: string): string | null;
export declare function buildPersonaSnapshotMessage(text: string): LikeMessage;
/** 截断后会话内容的最后事件时间（undo 回放截断点：ts 晚于它的变量写全部回滚） */
export declare function sessionContentMaxTime(content: string): number;
/** 组装 trace（T1.5：前端"这条消息怎么被生成的"数据源，/dsht-rp/trace 暴露） */
export interface AssemblyTraceRuntime {
    sessionId: string;
    turn: number;
    ts: number;
    regexHits: Array<{
        scriptName: string;
        count: number;
    }>;
    activatedEntries: Array<{
        comment: string;
        reason: string;
        position: string;
    }>;
    depthInjections: Array<{
        depth: number;
        chars: number;
    }>;
    snapshotChars: number;
    droppedByBudget: number;
}
/** P0-5 per-turn 闸门判定（dsh-worldbook inject.ts L39-42 同款）：本 step inbox 含 source.kind==='user' 的真实用户消息 */
export declare function hasDirectUserInput(messages: LikeMessage[] | undefined): boolean;
/**
 * 【TT 对照修复 2026-09-10】消息深度计算（对照 TT `script.js:5285`
 * `depth: coreChat.length - index - (isContinue ? 2 : 1)` 的语义简化版）。
 *
 * TT 公式里 `-1` 是为「最新一条是待生成的 assistant 占位」预留的偏移；DSH 的
 * decision.messages 不含占位，故此处直接用「距末尾的距离」：末尾一条 depth=0，
 * 倒数第二条 depth=1……。ST 的 minDepth/maxDepth 语义即建立在这个尺度上
 * （engine.js:368-378：depth < minDepth 跳过、depth > maxDepth 跳过）。
 */
export declare function messageDepth(total: number, index: number): number;
/**
 * 步骤 1：正则 prompt 时机跑本批消息（user→USER_INPUT、assistant→AI_OUTPUT placement）。
 *
 * 【两种模式（2026-09-10 重写，TT 语义对齐）】
 * - `'persist'`：只跑 `markdownOnly === false && promptOnly === false` 的「通用」脚本
 *   （ST engine.js:357 的第三分支）。其结果会随 `decision.messages` 落 `user/message`
 *   耐久事件 —— 对应 ST 里写入 chat 数组的那类脚本，可以改变聊天记录本体。
 * - `'prompt'`：跑 `!markdownOnly` 的全部脚本（含 `promptOnly`）。**结果绝不落盘**，
 *   只在发往 LLM 的最终投影上生效（`llm/stream` 钩子内调用）—— 对应 ST
 *   `script.js:5282-5312` 的 `getRegexedStringBatchAsync(..., { isPrompt: true })`：
 *   TT 把结果写进**局部变量 `coreChat`**，从不回写 `chat`。
 *
 * 修复前：`promptOnly: true` 的脚本（如 Kemini 预设的「aether opus正则一」把用户输入
 * 包成 `<interactive_input>$1</interactive_input>`）在 pre-step 阶段就跑，结果经
 * `{...decision, messages: batch}` 被宿主落成 `user/message` 事件 → **聊天记录被污染**，
 * UI 气泡显示出 `<interactive_input>` 包装、且 `$1` 残留会永久写死。
 */
export declare function applyPromptRegexes(messages: LikeMessage[], scripts: RegexScript[], traceRegexHits: Array<{
    scriptName: string;
    count: number;
}>, mode?: 'persist' | 'prompt'): LikeMessage[];
/** 步骤 2+4：WI 激活条目 → 正则（WORLD_INFO placement）+ 宏求值 + 位置分桶 */
export declare function processActivatedEntries(activated: Array<{
    entry: LoreEntry;
    reason: string;
}>, scripts: RegexScript[], macroCtx: MacroContext, traceRegexHits: Array<{
    scriptName: string;
    count: number;
}>): {
    before: Array<{
        comment: string;
        content: string;
        reason: string;
    }>;
    after: Array<{
        comment: string;
        content: string;
        reason: string;
    }>;
    atDepth: Array<{
        depth: number;
        role: string;
        content: string;
        comment: string;
    }>;
};
/** 步骤 3：深度注入 splice（depth N = 从批末尾往前数第 N 位之前插入；同深度 system→user→assistant 合并）。
 * 多深度必须从深到浅处理——浅的先插会让深度的锚点漂移。
 * 消息契约（DSH Message）：id + source 必填——缺 source 会在 turn 建立时读 source.kind 崩溃。 */
export declare function spliceDepthInjections(messages: LikeMessage[], atDepth: Array<{
    depth: number;
    role: string;
    content: string;
}>): LikeMessage[];
/** 一个 surface 位置上的变体组（历史 swipe 或运行时重 roll 的组） */
export interface VariantGroup {
    /** 组内全部变体事件（按生成序）：成员 i replace 成员 i-1（首个 append） */
    members: Array<{
        seq: number;
        text: string;
    }>;
    /** 当前 active 的 seq */
    activeSeq: number;
}
/**
 * 从 session 事件流重建变体组图：assistant/message 的 replace 链。
 * sourceEventSeqs[0] 即被替换的前驱——链式回溯成组；被替换下 surface 的是旧变体。
 *
 * 原始计数语义（T7b 结论，前端归一化方案的后端不变量）：append-only 日志里
 * 每次变体切换都是一条新 replace 事件并作为新成员入组——members 随滑动增长，
 * 是读模型的如实映射（sourceEventSeqs 始终单元素指向直接前驱，不重复累积）。
 * 前端 ‹n/m› 计数需按文本归一化（normalizeVariantGroups，dsht-rp-ui 侧）。
 */
export declare function collectVariantGroups(events: Array<{
    type: string;
    seq: number;
    data?: unknown;
    surfaceOp?: unknown;
    sourceEventSeqs?: number[];
}>): Map<number, VariantGroup>;
/**
 * 助手楼层改写的落点规划——实现在 dsht-plugin-shared/session-write.ts
 * （三处消费：回退/编辑、TH 编辑、EJS 写回；在此 re-export 保持本模块公开面）。
 */
export { planAssistantRewrite } from '../dsht-plugin-shared/session-write.ts';
/**
 * 变体切换的 assistant 消息载荷（纯函数）。
 *
 * 【阶段3 2026-09-10 重写】原实现让 assistant/message 自己做 replace 节点 + 带
 * sourceEventSeqs 血缘——0.1.2 合法，**0.1.5 被官方双重禁止**（assistant/message
 * 不能带 sourceEventSeqs，且 replace 必须列全被遮蔽节点 → 带也错、不带也错）。
 * 新形态：变体切换 = user/message 标记（把旧变体移出上下文）+ 本 assistant 消息追加。
 */
export declare function buildVariantSwitchEvent(sessionId: string, nextSeq: number, activeSeq: number, targetText: string): {
    type: 'assistant/message';
    seq: number;
    time: number;
    data: {
        turn: number;
        step: number;
        message: {
            id: string;
            role: 'assistant';
            content: Array<{
                type: 'text';
                text: string;
            }>;
            source: {
                kind: 'model';
                provider: string;
                model: string;
            };
        };
    };
    /** 追加到 surface 尾部（不再是 replace） */
    surfaceOp: 'append';
    /** 被移出上下文的旧变体 seq（写入标记用，不再进本事件信封） */
    shadowedActiveSeq: number;
} | null;
/**
 * lore_query 搜索（T1.8 轻 agent 世界书深查）：条目名/关键词/内容全文匹配，
 * 返回前 maxEntries 条（内容截断）。纯函数可单测。
 */
export declare function searchLoreEntries(entries: LoreEntry[], query: string, opts?: {
    maxEntries?: number;
    maxContentChars?: number;
}): string;
/** 从 cwd 提取 RP 工作区段（$DSH_HOME/rp/<slug> → slug；非 RP 返回 null） */
export declare function rpSlugFromCwd(cwd: string | undefined, dshHome: string): string | null;
/** T3.1b 兜底：从 rp.json 可得的字段重建 ST V2 JSON（仅旧工作区无 card.json 时用） */
export declare function buildStV2FromRp(rp: RpWorkspace): string;
/** T3.1b：从 ST 卡 JSON 提取卡名（导出文件名用） */
export declare function rpNameFrom(json: string): string;
/** 批次 id：时间戳 base36 + 文件名短哈希（rp-import/<batchId>/） */
export declare function makeBatchId(name: string, now?: number): string;
/** batchId 合法性（防路径逃逸） */
export declare function isValidBatchId(id: string): boolean;
/**
 * rp 预设 id → DSH agent preset 目录名。
 * DSH discovery 只认 PRESET_ID（/^[a-z0-9][a-z0-9-]*$/）命名的目录；rp 预设 id
 * 允许 CJK/emoji/空格（UI 识别面，如「st-V1.4 [轻量] 狐狐~ 🦊-pqmfsq」）——
 * 不净化直同步的目录 discovery 直接跳过（R5 实测坑：st-* 永不入 agent preset 列表）。
 * fnv 短哈希后缀保证净化后唯一且稳定（幂等覆盖）。
 */
export declare function agentPresetDirId(presetId: string): string;
/**
 * 解压 zip 到目标目录。返回解压文件数。
 * 性能路径（2026-09-04）：Android 上优先 busybox unzip 流式解压（子进程直接读
 * source.zip 文件，node 进程零大内存占用）——JSZip.loadAsync 要整包持有 + 逐
 * entry 在 V8 堆里解，505MB 级数据包在 4GB 手机/模拟器上 swap 抖动卡死（实测
 * 11087/14460 停滞 15 分钟）。PC/无 busybox 环境回退 JSZip（PC 内存充裕）。
 * 安全：busybox unzip 自带 zip-slip 防护（-d 目标约束）；回退路径跳过目录项、
 * 绝对路径与 .. 逃逸段；canonical 越界二次防御。
 */
export declare function unpackZipTo(sourceZip: string, destDir: string): Promise<number>;
/**
 * R0：批次资源快速统计（import-stage 的 manifest；只看目录结构与轻量 JSON 头，不做完整解析——
 * 完整解析是适配 agent 的活）。st-data 批次按 ST 目录约定计数；raw 单文件批次按扩展名+JSON 头判型。
 */
export interface ImportManifest {
    kind: 'st-data' | 'single-card' | 'single-book' | 'unknown';
    cards: number;
    books: number;
    chats: number;
    presets: number;
    /** ST 数据根（相对 unpacked/ 的路径；raw 批次为 null） */
    stRoot: string | null;
    /** raw 批次的单文件相对路径（inbox/<name>） */
    singleFile?: string;
}
export declare function scanImportManifest(unpackedDir: string): Promise<ImportManifest>;
/** ST secrets.json 条目取值：新版是 [{value, active}] 数组（active 优先），旧版是裸字符串 */
export declare function pickSecret(secrets: Record<string, unknown>, key: string): string | null;
/** R4：ST settings.json + secrets.json → DSH provider 配置（不依赖任何运行时，可单测） */
export interface StApiImport {
    /** DSH provider 路由名（llm-pi-ai providers 键） */
    provider: string;
    /** 端点（custom/reverse proxy 时带） */
    baseURL?: string;
    /** 模型 id */
    model: string;
    /** 凭据引用名（POSIX shell 标识符） */
    keyRef: string;
    /** 凭据值（日志一律不打印） */
    keyValue: string | null;
    /** llm-pi-ai provider profile */
    profile: Record<string, unknown>;
    /** 识别到的 ST 来源（chat_completion_source/main_api） */
    source: string;
}
export declare function parseStApiConfig(settings: Record<string, unknown>, secrets: Record<string, unknown>): StApiImport | null;
export declare function apply(ctx: LikeContext & {
    agents?: LikeAgentRegistry;
    sessions?: {
        get: (id: string) => LikeSession | undefined;
    };
}, _config: unknown): void;
