/**
 * TT 对齐的最终请求投影（D-3/D-4，2026-09-10 心跳 33）
 *
 * ## 为什么需要这一层
 * DSH 的 `Session` 是**耐久事件日志**，其 `user/message` 事件的 role 被核心强制为 `'user'`
 * （`dsh-session/src/index.ts:315` `expectedRole = type === 'assistant/message' ? 'assistant' : 'user'`，
 * 不符即抛 `message must have role "user"`）。因此 **role 映射无法在注入层解决** ——
 * 注入什么 role，日志里就是什么 role，重启校验还会整会话拒载。
 *
 * TauriTavern（TT）的等价层是 `GENERATE_AFTER_COMBINE_PROMPTS` / `CHAT_COMPLETION_PROMPT_READY`：
 * 在**组装完成、发出前**改写最终请求。
 *
 * ## 合法的落地点（2026-09-10 取证，四条证据链）
 * 原设想在 `llm/stream` 改写请求，**已被证伪**：
 *   ① `agent-loop/src/agent.ts:505` `markAgentLoopRequest(deepFreeze({...messages, system, tools}))`
 *      —— loop 构建的请求深度冻结，mutation throws；核心 API catalog 明文
 *      "listeners read it, never rewrite it"。
 *   ② `agent-loop/src/invariant.ts:38` 不变式校验 `options.messages` 必须恒等于
 *      `session.deriveMessages()`（`{ prepend: true }` 注册，先于普通监听器）。
 *   ③ `session/src/index.ts:315` `expectedRole = type === 'assistant/message' ? 'assistant' : 'user'`
 *      —— `user/message` 的 role 被钉死，注入层无法产出 `system` 角色消息。
 *
 * **唯一合法通道 = `system-prompt/assemble` 瀑布返回的 `assembly.sections`**：
 *   `agent.ts:230` `assemble(assembleContextFor(this, signal))`
 *   → `agent.ts:337` `const system = renderPrompt(assembly)`（sections 按 order 升序以 '\n\n' 拼接）
 *   → `agent.ts:339` `buildRequest(..., system, session.deriveMessages(), ...)`
 *   `assembleContextFor`（`agent/src/dispatch.ts:173`）**把 live Agent 放进 context.agent**，
 *   故监听器可现场读取会话态并返回动态 sections。
 *
 * 因此本模块的**消费者是 `system-prompt/assemble` 监听器**：
 * 把系统级 RP 内容（角色卡/世界书/记忆/状态树/预设）编成 section 进 `system` 槽位，
 * 耐久日志零改动（`agent/pre-step` 侧只保留真实对话轮次）。
 *
 * ## TT 基准形状（golden/st/dump-008，25 条）
 * - 22 条 `system`：角色设定/世界书/文风/大纲/记忆/阶段检查 —— 全部系统级指令
 * - 2 条 `user`：★用户实际输入（**前部**，第 13 位）+ 状态变量（第 14 位）
 * - 1 条 `assistant` 收尾（第 24 位，输出前确认）
 * 结构上是一段**有序拼接的提示词**，而非多条独立对话。
 *
 * ## DSHT 侧改造（本模块）
 * 输入 = DSH 投影出的 messages（角色卡/世界书/记忆等均为 user 角色）。
 * 输出 = TT 形状：
 *   1. 系统级内容（角色卡/世界书/记忆/状态树/预设/文风…）→ `system` 槽位，保序拼接
 *   2. 真实用户输入 → `user`（提到历史之前，对齐 TT 第 13 位语义）
 *   3. 历史楼层（assistant/user 对话）→ 保持原序追加
 *   4. 尾部 assistant 收尾（可配）
 * 折叠 marker 直接丢弃（TT 侧无此概念；其存在只为遮蔽旧副本，投影时已无意义）。
 */
/** 投影输入的一条消息（结构宽松：只读 role / content） */
export interface ProjMessage {
    role?: unknown;
    content?: unknown;
}
/** 内容分类 */
export type ProjKind = 'agent-manual' | 'user-input' | 'history-user' | 'history-ai' | 'fold-marker' | 'runtime-ctx' | 'skill-list' | 'system-level' | 'unknown';
/** 内容文本提取（兼容 string 与 block 数组两种形态） */
export declare function textOf(content: unknown): string;
/**
 * 内容分类。判据以**稳定前缀/署名**为主，不依赖具体角色卡内容。
 * 全部判据都来自 golden 实测取证（DSHT 侧 payload + TT 侧 dump-008）。
 */
export declare function classify(m: ProjMessage): ProjKind;
/**
 * 一条待进 `system` 槽位的内容。
 *
 * `order` 决定在 `renderPrompt` 里的拼接位置（`system-prompt/src/index.ts:504`
 * `sort((a,b) => a.order - b.order)`）。约定（同文件 L57-60 官方注释）：
 *   `-100` harness 身份 · `0` persona · `100-199` 工具指引
 * RP 内容语义上属于 persona 之后、工具指引之前 → 取 20-80 带区。
 */
export interface SlotSection {
    /** 唯一名（重复注册抛错；此处由调用方保证前缀唯一） */
    name: string;
    /** 拼接序（升序） */
    order: number;
    /** 正文 */
    text: string;
}
/**
 * RP 内容的 `order` 排布表。
 *
 * 依据 TT 基准 `golden/st/dump-008` 的实际拼接序（22 条 system，索引即语义序）：
 *   1 系统角色宣言 → 2 文风格式 → 3 阶段一基础要求 → 6/7 世界书 →
 *   10 小说原文参考 → 11 过往记忆 → 12 剧情大纲 → 15 颜色规则 →
 *   18 文风 → 19 情节 → 20 人物 → 22 阶段二输出前检查
 * 归纳出的稳定序 = 角色定位 → 世界设定 → 长期记忆 → 剧情推进 → 输出格式。
 * DSHT 侧按同一语义序排布，使模型读到的先后与 TT 一致。
 */
export declare const SLOT_ORDERS: {
    /** 角色卡（谁在演、演谁）——最先 */
    readonly characterCard: 20;
    /** 世界书（世界观事实）紧随角色卡 */
    readonly worldbook: 25;
    /** 长期记忆（跨轮事实） */
    readonly memory: 30;
    /** 剧情记忆/大纲（故事推进脉络） */
    readonly storyMemory: 35;
    /** MVU 状态树（当前数值状态） */
    readonly stateTree: 40;
    /** 表格（st-memory-enhancement） */
    readonly tables: 45;
    /** 预设 relative 条目（指令层，靠后） */
    readonly preset: 50;
};
/** `assemble` 监听器可消费的一批槽位内容（由 pre-step 各注入点登记） */
export interface SlotBatch {
    sections: SlotSection[];
}
/**
 * 把登记的一批槽位内容规整为可直接并入 `assembly.sections` 的数组。
 *
 * 做三件事：
 *   1. 丢弃空文本（`renderPrompt` 本身也会过滤空 section，但提前丢可省拼接）
 *   2. 依据 `SLOT_ORDERS` 稳定排序（同 order 保持登记序 —— Array#sort 在
 *      V8 上是稳定的，但显式加序号更保险）
 *   3. 中性化残余 `{{…}}`（`renderPrompt` 的严格插值遇未知变量直接 throw，
 *      必须由调用方在送入前处理 —— 见 `neutralizeResidualMacros`）
 *
 * @param batch - 登记的内容
 * @param neutralize - 残余宏中性化函数（由调用方注入，避免本模块依赖 macros 模块）
 * @returns 规整后的 section 列表（可为空）
 */
export declare function planSlotSections(batch: SlotBatch, neutralize: (text: string) => string): Array<{
    name: string;
    text: string;
}>;
/** 投影配置 */
export interface ProjConfig {
    /** 是否把系统级内容并入 system 槽位（D-3） */
    systemSlot: boolean;
    /** 是否把真实用户输入提前到历史之前（D-4） */
    userInputFirst: boolean;
    /** 是否追加尾部 assistant 收尾（TT 第 24 位） */
    trailingAssistant: boolean;
    /** 收尾文本 */
    trailingText: string;
}
export declare const PROJ_DEFAULTS: ProjConfig;
/** 投影结果 */
export interface ProjResult {
    /** 新的 messages 数组（role 已重映射） */
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
    /** 追加进 system 槽位的文本（systemSlot=false 时为空串） */
    systemAppend: string;
    /** 统计（供日志/诊断） */
    stats: {
        in: number;
        out: number;
        systemLevel: number;
        droppedMarkers: number;
        userFirst: number;
    };
}
/**
 * 执行投影：把 DSH 的 messages 重排为 TT 形状。
 *
 * 保序原则：同类别内部**严格保持原相对顺序**（TT 的拼接顺序即提示词语义顺序，
 * 乱序会让「阶段一 → 上下文 → 阶段二」的依赖关系断裂）。
 *
 * @param messages - DSH 投影出的消息（原始形状，含标准 message 对象）
 * @param cfg - 投影配置
 * @returns 投影结果；cfg.enabled=false 时原样返回
 */
export declare function projectToTtShape(messages: readonly ProjMessage[], cfg?: ProjConfig): ProjResult;
