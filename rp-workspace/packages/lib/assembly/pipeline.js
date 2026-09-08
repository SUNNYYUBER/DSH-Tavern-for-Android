"use strict";
/**
 * DSHTavern RP 组装器（M1 / T1.3 + T1.4，计划文档 §4.1 管线）
 *
 * 输入：编译后的预设槽位 + 角色卡字段 + 世界书激活结果 + 聊天历史 + 会话状态
 *   ↓ 1. 正则引擎·prompt 时机（改聊天历史与世界书内容）
 *   ↓ 2. 世界书触发（产出激活条目集——由调用方先行执行，结果传入）
 *   ↓ 3. 预设骨架落位（槽位顺序 + 深度注入 splice 进消息数组）
 *   ↓ 4. 宏引擎（统一求值）
 *   ↓ 5. token 预算裁剪（历史从旧到新丢弃）
 * 输出：messages[]（发给 LLM 的最终形态）+ 组装 trace
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assemble = assemble;
const engine_ts_1 = require("../macros/engine.ts");
const engine_ts_2 = require("../regex/engine.ts");
const entry_ts_1 = require("../lore/entry.ts");
/** 默认 token 估算：字符数/4（中文偏保守；精确估算器 M1.5 接 DSH token-meter） */
const defaultEstimate = (s) => Math.ceil(s.length / 4);
/**
 * RP 组装主流程。
 *
 * @param slots 编译期展开的槽位（compileSlots 产物）
 * @param character 角色卡字段（已宏替换前置处理由内部完成）
 * @param wiActivated 世界书激活结果（triggerWorldInfo 产物）
 * @param history 聊天历史（旧→新；prompt 正则已由内部应用）
 * @param state 会话状态树（getvar/状态摘要源）
 * @param regexScripts 正则脚本（GLOBAL/PRESET/SCOPED 三源合并后的全集）
 * @param macroCtx 宏上下文
 * @param config 预算配置
 */
function assemble(slots, character, wiActivated, history, state, regexScripts, macroCtx, config) {
    const estimate = config.estimateTokens ?? defaultEstimate;
    const macros = new engine_ts_1.MacroEngine();
    const trace = {
        finalMessages: [],
        regexHits: [],
        activatedEntries: wiActivated.map(a => ({
            comment: a.entry.comment, reason: a.reason, book: a.entry.book,
        })),
        unknownMacros: [],
        tokenEstimate: { prompt: 0, droppedMessages: 0 },
    };
    // ---- 步骤 1：正则 prompt 时机（聊天历史；WI 扫描看到的应是正则后文本，ST 语义）----
    let processedHistory = history
        .filter(m => !m.isSystemNote) // 系统备注不进 prompt（§4.15）
        .map(m => {
        const placement = m.role === 'user' ? engine_ts_2.PLACEMENT.USER_INPUT : engine_ts_2.PLACEMENT.AI_OUTPUT;
        const r = (0, engine_ts_2.runRegexScripts)(regexScripts, m.content, 'prompt', placement, { depth: null });
        for (const h of r.hits)
            trace.regexHits.push({ scriptName: h.scriptName, count: h.count });
        return { ...m, content: r.text };
    });
    // ---- 步骤 2：世界书内容条目（激活结果分桶：顶部/深度/示例区）----
    const evalCtx = { ...macroCtx };
    const evalText = (t) => {
        const r = macros.evaluate(t, evalCtx);
        trace.unknownMacros.push(...r.unknownMacros);
        return r.text;
    };
    const wiBefore = [];
    const wiAfter = [];
    const wiDepthInjections = [];
    for (const a of wiActivated) {
        // 世界书条目内容过正则（placement=WORLD_INFO，ST 语义）
        const r = (0, engine_ts_2.runRegexScripts)(regexScripts, a.entry.content, 'prompt', engine_ts_2.PLACEMENT.WORLD_INFO, { depth: null });
        for (const h of r.hits)
            trace.regexHits.push({ scriptName: h.scriptName, count: h.count });
        const content = evalText(r.text);
        switch (a.entry.position) {
            case entry_ts_1.WI_POSITION.BEFORE:
                wiBefore.push(content);
                break;
            case entry_ts_1.WI_POSITION.AFTER:
                wiAfter.push(content);
                break;
            case entry_ts_1.WI_POSITION.AT_DEPTH:
                wiDepthInjections.push({ depth: a.entry.depth, role: a.entry.role, content });
                break;
            default:
                // AN/EM/outlet 位置：M1 以 BEFORE 兜底（这些位置依赖完整预设布局，M2 精化）
                wiBefore.push(content);
        }
    }
    // ---- 步骤 3：槽位骨架落位 ----
    const markerContent = (id) => {
        switch (id) {
            case 'worldBefore': return wiBefore.join('\n');
            case 'worldAfter': return wiAfter.join('\n');
            case 'charDesc': return evalText(character.description);
            case 'charPersonality': return evalText(character.personality);
            case 'scenario': return evalText(character.scenario);
            case 'persona': return evalText(character.personaDescription);
            case 'stateSummary': {
                // 状态摘要：变量树小于预算注入全量 JSON；超预算注入顶层键（§4.4.1 token 策略）
                if (state == null)
                    return '';
                const json = JSON.stringify(state, null, 1) ?? '';
                if (estimate(json) < 2000)
                    return `<State>\n${json}\n</State>`;
                const keys = typeof state === 'object' ? Object.keys(state) : [];
                return `<StateKeys>${keys.join(', ')}</StateKeys>`;
            }
            default: return '';
        }
    };
    const headMessages = [];
    for (const slot of slots) {
        let content = '';
        if (slot.type === 'marker' || slot.type === 'state') {
            // marker 与 state 槽位由组装层动态填充
            content = markerContent(slot.id);
        }
        else if (slot.type === 'skillRef') {
            content = slot.content; // skill 文档本体由 DSH skill 机制注入，这里注入引用提示
        }
        else {
            content = evalText(slot.content);
        }
        if (slot.type === 'configSummary') {
            // 配置摘要（§4.3）：确定性生成，替代 ST 思维链自查；T3.3：compileSlots 展开
            // configSummary 槽时拼进槽内容的配置自查补充文本（RPPreset.configSummaryExtra，
            // ST agent 预设三档归位产物①）追加在确定性摘要之后
            const extra = slot.content.trim();
            content = extra ? `${buildConfigSummary(slots, wiActivated.length)}\n\n${extra}` : buildConfigSummary(slots, wiActivated.length);
        }
        if (content.trim() === '')
            continue;
        if (slot.depth != null) {
            wiDepthInjections.push({ depth: slot.depth, role: slot.role, content });
        }
        else {
            headMessages.push({ role: slot.role === 'user' ? 'user' : 'system', content });
        }
    }
    // ---- 步骤 4：深度注入 splice（同深度按 role 顺序 system→user→assistant 合并，ST 语义）----
    const messages = [...headMessages, ...processedHistory];
    const roleRank = { system: 0, user: 1, assistant: 2 };
    const injectionsByDepth = new Map();
    for (const inj of wiDepthInjections) {
        const list = injectionsByDepth.get(inj.depth) ?? [];
        list.push(inj);
        injectionsByDepth.set(inj.depth, list);
    }
    for (const [depth, list] of [...injectionsByDepth.entries()].sort((a, b) => b[0] - a[0])) {
        list.sort((a, b) => roleRank[a.role] - roleRank[b.role]);
        const merged = list.map(l => l.content).join('\n');
        // depth N = 从消息数组尾部往前数第 N 个位置插入（depth 0 = 最末）
        const insertAt = Math.max(0, messages.length - depth);
        messages.splice(insertAt, 0, { role: 'system', content: merged });
    }
    // ---- 步骤 5：token 预算裁剪（历史从旧到新丢弃）----
    const fixedTokens = messages.slice(0, headMessages.length).reduce((s, m) => s + estimate(m.content), 0);
    const budget = config.maxContextTokens - config.reserveReplyTokens - fixedTokens;
    let historyTokens = 0;
    const keptHistory = [];
    // 从新到旧保留，超出预算即停（= 丢弃最旧的）
    for (let i = messages.length - 1; i >= headMessages.length; i--) {
        const cost = estimate(messages[i].content);
        if (historyTokens + cost > budget && keptHistory.length > 0)
            break;
        historyTokens += cost;
        keptHistory.unshift(messages[i]);
    }
    const dropped = messages.length - headMessages.length - keptHistory.length;
    const finalMessages = [...messages.slice(0, headMessages.length), ...keptHistory];
    trace.finalMessages = finalMessages.map(m => ({ role: m.role, content: m.content }));
    trace.tokenEstimate = {
        prompt: fixedTokens + historyTokens,
        droppedMessages: dropped,
    };
    return { messages: finalMessages, trace };
}
/** 配置摘要生成（§4.3：组装层确定性代码，替代模型自查） */
function buildConfigSummary(slots, wiCount) {
    const active = slots.filter(s => s.type !== 'marker');
    const lines = [
        '<RPConfig>',
        `- 世界书激活条目: ${wiCount}`,
        `- 注入槽位数: ${active.length}`,
        `-${active.map(s => s.id).map(id => ` ${id}`).join('\n-')}`,
        '</RPConfig>',
    ];
    return lines.join('\n');
}
