"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJ_DEFAULTS = exports.SLOT_ORDERS = void 0;
exports.textOf = textOf;
exports.classify = classify;
exports.planSlotSections = planSlotSections;
exports.projectToTtShape = projectToTtShape;
/** 内容文本提取（兼容 string 与 block 数组两种形态） */
function textOf(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((b) => {
            const bb = b;
            return bb?.type === 'text' && typeof bb.text === 'string' ? bb.text : '';
        })
            .join('');
    }
    return '';
}
/** 折叠标记的字面量（与 dsht-plugin-memory 的 markerText 保持一致） */
const FOLD_MARKERS = ['[旧快照副本已折叠]', '[上下文瘦身]'];
/**
 * 内容分类。判据以**稳定前缀/署名**为主，不依赖具体角色卡内容。
 * 全部判据都来自 golden 实测取证（DSHT 侧 payload + TT 侧 dump-008）。
 */
function classify(m) {
    const role = typeof m.role === 'string' ? m.role : '';
    const text = textOf(m.content);
    if (text.length === 0)
        return 'unknown';
    if (FOLD_MARKERS.some((k) => text.startsWith(k)))
        return 'fold-marker';
    // DSH 基础设施：agent 说明书必须留在最前（它是 system 语义，TT 无对应物）
    if (text.startsWith('You are an AI agent powered by DeepSeek Harness'))
        return 'agent-manual';
    if (text.includes('A skill is a reusable set of'))
        return 'skill-list';
    if (text.startsWith('<interactive_input>') || text.startsWith('<interactive_input>\n')) {
        // 运行时上下文快照也包在 interactive_input 里，需先区分
        if (text.includes('Current runtime context'))
            return 'runtime-ctx';
        return 'user-input';
    }
    if (text.includes('Current runtime context'))
        return 'runtime-ctx';
    if (role === 'assistant')
        return 'history-ai';
    // 系统级 RP 内容（DSHT 侧一律以 user 承载 —— 正是 D-3 要纠正的错位）
    if (text.includes('你正在进行角色扮演') // 角色卡
        || text.includes('worldbook entries') // 世界书
        || text.includes('【角色状态') // MVU 状态树
        || text.includes('【剧情记忆') // 剧情记忆
        || text.includes('【故事开场') // 故事开场
        || text.includes('【小说正文格式要求】') // 文风
        || text.includes('【小说文风要求】')
        || text.includes('【小说情节')
        || text.includes('【小说人物')
        || text.includes('<World_Lore_Database>')
        || text.includes('过往记忆')
        || text.includes('剧情大纲')
        || text.includes('stage_')
        || text.includes('<User_Prefs>')
        || text.includes('<font_color>'))
        return 'system-level';
    if (role === 'user')
        return 'history-user';
    return 'unknown';
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
exports.SLOT_ORDERS = {
    /** 角色卡（谁在演、演谁）——最先 */
    characterCard: 20,
    /** 世界书（世界观事实）紧随角色卡 */
    worldbook: 25,
    /** 长期记忆（跨轮事实） */
    memory: 30,
    /** 剧情记忆/大纲（故事推进脉络） */
    storyMemory: 35,
    /** MVU 状态树（当前数值状态） */
    stateTree: 40,
    /** 表格（st-memory-enhancement） */
    tables: 45,
    /** 预设 relative 条目（指令层，靠后） */
    preset: 50,
    /**
     * 【2026-09-10】promptOnly 正则投影后的整批消息文本（TT `GENERATE_AFTER_COMBINE_PROMPTS`
     * 对应物）。放最后：语义上是"最终 payload 的镜像"，且只在该批确有 promptOnly 命中时存在。
     */
    projectedPrompt: 60,
};
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
function planSlotSections(batch, neutralize) {
    return batch.sections
        .map((s, i) => ({ ...s, seq: i }))
        .filter(s => typeof s.text === 'string' && s.text.trim().length > 0)
        .sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
        .map(s => {
        const text = neutralize(s.text).trim();
        return text.length === 0 ? null : { name: s.name, text };
    })
        .filter((s) => s !== null);
}
exports.PROJ_DEFAULTS = {
    enabled: true,
    systemSlot: true,
    userInputFirst: true,
    trailingAssistant: true,
    trailingText: '好的，全部阅读完毕后，回顾整合所有要求，并确认用户的最新请求。',
};
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
function projectToTtShape(messages, cfg = exports.PROJ_DEFAULTS) {
    const stats = { in: messages.length, out: messages.length, systemLevel: 0, droppedMarkers: 0, userFirst: 0 };
    /** 原样投影（不做 role 重映射）——仅在关闭或降级时使用，保证「不丢内容」 */
    const passthrough = () => ({
        messages: messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: textOf(m.content),
        })),
        systemAppend: '',
        stats,
    });
    if (!cfg.enabled)
        return passthrough();
    const agentManual = []; // 保持在前
    const sysLevel = []; // → system 槽位
    const userInputs = []; // → user（提前）
    const infra = [];
    const timeline = [];
    for (const m of messages) {
        const kind = classify(m);
        const text = textOf(m.content);
        switch (kind) {
            case 'fold-marker':
                stats.droppedMarkers += 1;
                break;
            case 'agent-manual':
                agentManual.push(text);
                break;
            case 'skill-list':
            case 'runtime-ctx':
                // DSH 基础设施：保留但视为 user 席位（它们描述当前环境，不是角色设定）
                infra.push({ role: 'user', content: text });
                break;
            case 'user-input':
                userInputs.push(text);
                stats.userFirst += 1;
                break;
            case 'history-ai':
                timeline.push({ role: 'assistant', content: text });
                break;
            case 'history-user':
                timeline.push({ role: 'user', content: text });
                break;
            case 'system-level':
                sysLevel.push(text);
                stats.systemLevel += 1;
                break;
            default:
                // 未识别：按原 role 追加到时间线尾（保守，不丢内容）
                timeline.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
                break;
        }
    }
    const out = [];
    // 1) system 槽位内容 = agent 手册（DSH 基础设施，必须在最前）
    //    + 系统级 RP 内容（角色卡/世界书/记忆/状态树/文风…）——对齐 TT 的 22 条 system。
    //    调用方把它并入 GenerateOptions.system（与既有 agent 手册拼接）。
    const systemAppend = cfg.systemSlot
        ? [...sysLevel, ...agentManual].join('\n\n')
        : '';
    // 2) 降级路径：systemSlot=false 时不做槽位搬移；复用上方分类结果重建原位序列
    //    （复用而非二次扫描——二次扫描会把 droppedMarkers 重复计数）
    if (!cfg.systemSlot) {
        const restored = [];
        for (const m of messages) {
            if (classify(m) === 'fold-marker')
                continue;
            restored.push({
                role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
                content: textOf(m.content),
            });
        }
        stats.out = restored.length;
        return { messages: restored, systemAppend: '', stats };
    }
    // 3) D-4：用户输入提到历史之前（TT 第 13 位语义 —— 历史是"已发生的上下文"，
    //    本轮请求紧随其后；DSHT 原实现把用户输入放在倒数第 2 位，与 TT 相反）
    if (cfg.userInputFirst) {
        for (const u of userInputs)
            out.push({ role: 'user', content: u });
    }
    // 4) DSH 基础设施（skill 清单/运行时上下文）紧随其后
    for (const m of infra)
        out.push(m);
    // 5) 历史楼层
    for (const m of timeline)
        out.push(m);
    // 6) 用户输入未提前时，落在末尾（原 DSHT 行为）
    if (!cfg.userInputFirst) {
        for (const u of userInputs)
            out.push({ role: 'user', content: u });
    }
    // 7) 尾部 assistant 收尾（TT 第 24 位：让模型先"确认已读"再产出）
    //    注意与 TT 一致：**无条件追加**（TT 的 [24] 紧跟在 [23] system 之后，
    //    即便时间线最后一条已是 assistant 也照样追加——这是"输出前确认"协议的一部分）
    if (cfg.trailingAssistant && cfg.trailingText.length > 0 && out.length > 0) {
        out.push({ role: 'assistant', content: cfg.trailingText });
    }
    stats.out = out.length + (systemAppend.length > 0 ? 1 : 0);
    return { messages: out, systemAppend, stats };
}
