"use strict";
/**
 * DSH 适配格式导出器（M2 入库前置：ST 解析产物 → DSH 官方数据布局）
 *
 * 三条转换线（全部对齐 DSH 官方文件系统约定，见调研记录）：
 * - 世界书 → $DSH_HOME/skills/<slug>/SKILL.md + references/lore.json（Chokidar 热发现，零注册）
 * - 角色卡 → $DSH_HOME/rp/<slug>/rp.json（promptPersona 字段承载卡设定文本，运行期由
 *   dsht-rp-plugin pre-step 快照注入——第四轮起不再产出 .agent-presets/rp-* agent preset）
 * - 聊天   → $DSH_HOME/sessions/_no-cwd/<encoded-id>/session.jsonl
 *   （事件序列严格对照 dsh-session-persistence-jsonl 官方契约 oneTurnLog：
 *    turn/start → user/message → [step/start → assistant/message → step/end] → turn/end；
 *    行 shape = { type, seq, time, data, surfaceOp? }，seq 从 0 连续递增；
 *    前置条件：composition 配 session-persistence compression:'none'，否则 DSH 只认 .zstd）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RP_WORKSPACE_DIR = void 0;
exports.dshSlug = dshSlug;
exports.exportLoreBookSkill = exportLoreBookSkill;
exports.cardPromptPersona = cardPromptPersona;
exports.chatSessionId = chatSessionId;
exports.encodeSegment = encodeSegment;
exports.projectKey = projectKey;
exports.assertSessionLogEvents = assertSessionLogEvents;
exports.convertChatFile = convertChatFile;
exports.sessionFilePath = sessionFilePath;
exports.buildRpJsonContent = buildRpJsonContent;
exports.buildFirstMesSession = buildFirstMesSession;
exports.exportSingleCardFiles = exportSingleCardFiles;
exports.exportToDshFiles = exportToDshFiles;
const st_import_ts_1 = require("../preset/st-import.ts");
const compiler_ts_1 = require("../preset/compiler.ts");
const card_export_ts_1 = require("./card-export.ts");
// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
/** 稳定哈希（FNV-1a 32bit → base36），给中文/任意名生成 DSH 要求的 kebab-case id */
function hash36(input) {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}
/** DSH skill name / preset id 要求 [a-z0-9][a-z0-9-]*：ASCII 安全段 + 哈希保证唯一 */
function dshSlug(prefix, originalName) {
    const safe = originalName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24)
        .replace(/^-+|-+$/g, '');
    const h = hash36(originalName);
    return safe ? `${prefix}-${safe}-${h}` : `${prefix}-${h}`;
}
/** 解析 ST send_date（"August 19, 2025 11:23pm" 等）；失败返回 null */
function parseStDate(s) {
    if (typeof s !== 'string' || !s.trim())
        return null;
    const t = Date.parse(s);
    return Number.isSafeInteger(t) && t > 0 ? t : null;
}
// ---------------------------------------------------------------------------
// 世界书 → skill
// ---------------------------------------------------------------------------
/**
 * 世界书转 DSH skill 目录（SKILL.md 概览 + references/lore.json 完整结构化数据）。
 * @param book 已解析的世界书
 */
function exportLoreBookSkill(book) {
    const slug = dshSlug('wb', book.name);
    const constant = book.entries.filter(e => e.constant).length;
    const keyed = book.entries.filter(e => !e.constant && e.keys.length > 0).length;
    const sampleKeys = book.entries
        .flatMap(e => (e.constant ? [] : e.keys.slice(0, 2)))
        .slice(0, 24);
    const skillMd = `---
name: ${slug}
description: 世界书《${book.name}》迁移自 SillyTavern（${book.entries.length} 条目：常驻 ${constant}、关键词 ${keyed}）。${sampleKeys.length ? '触发词示例：' + sampleKeys.join('、') : ''}
whenToUse: 角色扮演涉及《${book.name}》世界观设定、地名、人物或规则时，先读 references/lore.json 查相关条目。
---

# 世界书：${book.name}

由 DSHTavern 从 SillyTavern 世界书自动迁移。完整结构化条目（关键词、位置、深度、递归规则）见 \`references/lore.json\`——用文件工具按需检索，不要整本读入。

## 条目速览

${book.entries.slice(0, 60).map(e => {
        const tag = e.constant ? '常驻' : e.keys.length ? `关键词: ${e.keys.slice(0, 4).join(', ')}` : '无条件';
        const pos = e.position === 4 ? `深度${e.depth}` : e.position === 0 ? '顶部' : e.position === 1 ? '底部' : '';
        return `- [${tag}${pos ? `·${pos}` : ''}] ${e.comment || '(未命名)'}${e.enabled === false ? '（已停用）' : ''}`;
    }).join('\n')}
${book.entries.length > 60 ? `\n…共 ${book.entries.length} 条，其余见 references/lore.json` : ''}
`;
    return [
        { path: `skills/${slug}/SKILL.md`, content: skillMd },
        { path: `skills/${slug}/references/lore.json`, content: JSON.stringify(book, null, 1) },
    ];
}
// ---------------------------------------------------------------------------
// 角色卡 → promptPersona（rp.json 字段；第四轮起取代 .agent-presets/rp-* agent preset）
// ---------------------------------------------------------------------------
/**
 * 角色卡 → promptPersona 文本（卡设定快照注入文本）。
 * 宏原样保留（{{user}}/{{char}}/{{setvar::…}} 等）——运行期由 dsht-rp-plugin pre-step 的
 * 宏引擎展开（真语义），不再做写盘期中性化（中性化只用于写进 DSH persona 插件的文本）。
 * @param card 已解析的角色卡
 */
function cardPromptPersona(card) {
    const sections = [];
    sections.push(`你正在进行角色扮演。你扮演「${card.name}」，用户扮演对话中的主角（用户名以聊天中的称谓为准）。`);
    if (card.description.trim())
        sections.push(`# 角色设定\n${card.description.trim()}`);
    if (card.personality.trim())
        sections.push(`# 性格\n${card.personality.trim()}`);
    if (card.scenario.trim())
        sections.push(`# 场景\n${card.scenario.trim()}`);
    if (card.firstMes.trim())
        sections.push(`# 开场白（对话从这里开始）\n${card.firstMes.trim()}`);
    if (card.alternateGreetings.length) {
        sections.push(`# 备选开场白（用户可选择的分支）\n${card.alternateGreetings.map((g, i) => `${i + 1}. ${g.trim()}`).join('\n')}`);
    }
    if (card.depthPrompt)
        sections.push(`# 深度提示（始终注入）\n${card.depthPrompt.prompt}`);
    const worldRef = card.externalWorldRef
        ? `本角色的世界设定书为《${card.externalWorldRef}》（如技能列表中有对应迁移 skill，需要设定时先读它）。`
        : '';
    sections.push(`# 行为准则\n` +
        `- 全程保持角色，以「${card.name}」的身份说话与行动，不要跳出角色。\n` +
        `- 用小说化的叙述推进剧情：动作、神态、对白交织；不要总结式回复。\n` +
        `- 回复长度与用户当前文风保持一致；用户推进剧情时跟随，不要替用户做决定。\n` +
        `${worldRef ? worldRef + '\n' : ''}` +
        `- 需要世界观设定（地名/人物/规则）而上下文没有时，用技能/文件工具查询，不要编造与设定冲突的内容。`);
    return sections.join('\n\n');
}
/** 会话 id：DSH SessionId 是任意 branded string；目录名经 encodeSegment 转义后落盘 */
function chatSessionId(characterName, chatFile) {
    return `st-${hash36(characterName + '/' + chatFile)}`;
}
/**
 * 迁移聊天的统一工作目录（相对 DSH_HOME）。DSH 的 session.list 只服务带 cwd 的
 * 落盘 session（"Logs without a cwd are not served"），_no-cwd 会被列表过滤——
 * 所以迁移聊天统一挂到 rp/ 工作区，DSH 启动时 WorkspaceRegistry 会按该路径自动建组。
 */
exports.RP_WORKSPACE_DIR = 'rp';
/** 目录段转义（对照 dsh-session-persistence-jsonl format.encodeSegment：注入安全，仅 [A-Za-z0-9._-] 直通） */
function encodeSegment(raw) {
    if (raw === '.')
        return '~002E';
    if (raw === '..')
        return '~002E~002E';
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        const ch = String.fromCharCode(code);
        if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch))
            out += ch;
        else
            out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
}
/** 项目目录键（对照 DSH format.projectKey：分隔符折叠为 '-'、去前导、截 251、--包裹） */
function projectKey(cwd) {
    let readable = '';
    let separatorRun = false;
    for (let i = 0; i < cwd.length; i++) {
        const code = cwd.charCodeAt(i);
        const ch = String.fromCharCode(code);
        if (ch === '/' || ch === '\\' || ch === ':') {
            if (!separatorRun)
                readable += '-';
            separatorRun = true;
        }
        else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
            readable += ch;
            separatorRun = false;
        }
        else {
            readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
            separatorRun = false;
        }
    }
    const slug = readable.replace(/^-+/, '') || 'root';
    return `--${slug.slice(0, 251)}--`;
}
/**
 * session 事件日志构造即验证（P1#8：参考 dsh-agent-rp src/import/sillytavern-chat-seed.ts
 * L194 的"构造后立刻 Session.create 校验再冻结返回"，MIT © hewzhew——我方拿不到 host 侧
 * 运行时的 DSH Session 类，按文档允许的替代方案用同构校验器断言）。
 *
 * 断言（不合格直接 throw，诊断含第几条/type/seq/期望与实际值）：
 * - seq 从 0 严格连续（+1）；
 * - turn/start 与 turn/end 配对：不嵌套、不悬空、编号从 1 连续、reason.kind='completed'；
 * - step/start 与 step/end 配对：不嵌套、不悬空、turn/step 编号与开括弧一致；
 * - user/message 与 assistant/message 必在 turn 内；
 * - 结尾无未闭合的 turn/step。
 */
function assertSessionLogEvents(events) {
    const fail = (i, msg) => {
        const ev = events[i];
        throw new Error(`session 事件日志校验失败（第 ${i} 条，type=${String(ev?.type)}，seq=${String(ev?.seq)}）：${msg}`);
    };
    let openTurn = null;
    let openStep = null;
    let prevTurn = 0;
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (typeof ev.seq !== 'number' || ev.seq !== i) {
            fail(i, `seq 不连续（期望 ${i}，实际 ${String(ev.seq)}）`);
        }
        const data = ev.data ?? {};
        switch (ev.type) {
            case 'turn/start': {
                if (openTurn !== null)
                    fail(i, `turn/start 嵌套：turn ${openTurn} 未闭合`);
                const t = data.turn;
                if (t !== prevTurn + 1)
                    fail(i, `turn 编号不连续（期望 ${prevTurn + 1}，实际 ${String(t)}）`);
                openTurn = prevTurn = prevTurn + 1;
                break;
            }
            case 'user/message':
            case 'assistant/message':
                if (openTurn === null)
                    fail(i, `${ev.type} 出现在 turn 之外`);
                break;
            case 'step/start': {
                if (openTurn === null)
                    fail(i, 'step/start 出现在 turn 之外');
                if (openStep !== null)
                    fail(i, `step/start 嵌套：step ${openStep} 未闭合`);
                if (data.turn !== openTurn)
                    fail(i, `step/start 的 turn=${String(data.turn)} 与当前 turn ${openTurn} 不符`);
                if (typeof data.step !== 'number')
                    fail(i, 'step/start 缺 step 编号');
                openStep = data.step;
                break;
            }
            case 'step/end':
                if (openStep === null)
                    fail(i, 'step/end 无配对 step/start');
                if (data.turn !== openTurn || data.step !== openStep) {
                    fail(i, `step/end（turn=${String(data.turn)},step=${String(data.step)}）与 step/start（turn=${openTurn},step=${openStep}）不配对`);
                }
                openStep = null;
                break;
            case 'turn/end': {
                if (openTurn === null)
                    fail(i, 'turn/end 无配对 turn/start');
                if (openStep !== null)
                    fail(i, `turn ${openTurn} 内 step ${openStep} 未闭合`);
                if (data.turn !== openTurn)
                    fail(i, `turn/end 的 turn=${String(data.turn)} 与当前 turn ${openTurn} 不符`);
                const reason = data.reason;
                if (reason === null || typeof reason !== 'object' || reason.kind !== 'completed') {
                    fail(i, "turn/end reason.kind 非 'completed'");
                }
                openTurn = null;
                break;
            }
            default: break; // 未知事件类型不拦（前向兼容）
        }
    }
    if (openStep !== null)
        fail(events.length - 1, `日志结尾仍有未闭合的 step ${openStep}`);
    if (openTurn !== null)
        fail(events.length - 1, `日志结尾仍有未闭合的 turn ${openTurn}`);
}
/**
 * 一个 ST 聊天文件（.jsonl，逐行 {name,is_user,mes,swipes,swipe_id,send_date}）→ DSH session.jsonl 内容。
 *
 * 事件序列契约（oneTurnLog）：user 消息开 turn；assistant 消息作为该 turn 的 step；
 * 表面事件（user/message、assistant/message）必须带 surfaceOp；turn/end reason 用
 * {kind:'completed'}；is_system 行跳过。
 *
 * swipes → 变体组（§4.15）：同 anchor 的兄弟 assistant/message 事件用 replace
 * SurfaceOp 链互替（DSH compaction 同款原生机制，surface.ts 契约：replace 的
 * start/end 是被覆盖节点的 seq，sourceEventSeqs 必须含全部被 shadow 的 seq）。
 * log 全量保真（所有变体事件都在），surface 只剩 active 变体——组装语义与
 * ST"未选中 swipe 不进 prompt"一致。前端扫 replace 链即可重建变体组做左右切换。
 */
function convertChatFile(jsonlText, opts) {
    const lines = [];
    let seq = 0;
    let time = opts.createdAt;
    let turn = 0;
    let step = 0;
    let turns = 0;
    let skipped = 0;
    let variantGroups = 0;
    let firstUserText = null;
    // 真实数据实测（tauritavern 包）：is_system 被 MVU/酒馆助手管线重载——几乎每条消息
    // 都标 is_system:true（含用户输入）。systemHandling='auto'（默认）的判据：
    // 存在 is_user=true 且 is_system=true 的消息行（用户输入不可能是系统注释）→ 标记不可信，
    // 不再跳过（角色判定只看 is_user）。'skip' = 严格 ST 语义（is_system 即系统注释，跳过）。
    let trustSystemFlag = true;
    if (opts.systemHandling !== 'skip') {
        for (const raw of jsonlText.split('\n')) {
            const trimmed = raw.trim();
            if (!trimmed)
                continue;
            try {
                const row = JSON.parse(trimmed);
                if (row.is_user === true && row.is_system === true
                    && typeof row.mes === 'string' && row.mes.trim()) {
                    trustSystemFlag = false;
                    break;
                }
            }
            catch { /* 坏行不算 */ }
        }
    }
    /** surface 投影模拟（对照 DSH surface.ts）：按序记录当前 surface 节点的 seq */
    const surfaceNodes = [];
    const emit = (type, data, surfaceOp, sourceEventSeqs) => {
        const ev = { type, seq, time, data };
        if (surfaceOp !== undefined) {
            ev.surfaceOp = surfaceOp;
            if (sourceEventSeqs !== undefined)
                ev.sourceEventSeqs = sourceEventSeqs;
            if (surfaceOp === 'append') {
                surfaceNodes.push(seq);
            }
            else {
                const startIdx = surfaceNodes.indexOf(surfaceOp.start);
                const endIdx = surfaceNodes.indexOf(surfaceOp.end);
                surfaceNodes.splice(startIdx, endIdx - startIdx + 1, seq);
            }
        }
        lines.push(JSON.stringify(ev));
        seq++;
        time += 1;
    };
    // header 行（对照 toHeaderLine：type 'session' + version 0 + delegationDepth 必填；
    // cwd 必带——DSH session.list 不服务无 cwd 的落盘 session）
    lines.push(JSON.stringify({
        type: 'session',
        version: 0,
        id: opts.sessionId,
        createdAt: opts.createdAt,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        delegationDepth: 0,
    }));
    const closeTurn = () => {
        // step/end 由 assistant 分支自带（每条 assistant 一个 step，紧跟闭合）；
        // 这里只收 turn 边界——纯 user turn（无 assistant）不产生 step 事件
        emit('turn/end', { turn, reason: { kind: 'completed' } });
        turns++;
        step = 0;
    };
    /**
     * 一条 assistant 消息（一个变体或一次改写）：step 包裹；返回本条在 surface 上的 seq。
     *
     * 【阶段3 2026-09-10 契约修正】原实现把「同 anchor 的兄弟变体」用
     * assistant/message + surfaceOp replace + sourceEventSeqs 链互替——0.1.2 合法，
     * **0.1.5 被官方双重禁止**（assistant/message 不能带 sourceEventSeqs：
     * 「embeds its source stream and cannot carry sourceEventSeqs」；且 replace 必须列全
     * 被遮蔽节点 → 带也错、不带也错，官方设计死锁）。
     * 实测：21/80 个真实会话因此在 0.1.5 下整会话打不开。
     * 新形态走官方 compaction 同款：user/message 标记（合法 replace）把旧变体移出，
     * 新变体作为 assistant/message **append**。
     */
    const emitAssistantStep = (text) => {
        step++;
        emit('step/start', { turn, step });
        emit('assistant/message', {
            turn,
            step,
            message: {
                id: `st-${opts.sessionId}-${seq}`,
                role: 'assistant',
                content: [{ type: 'text', text }],
                source: { kind: 'model', provider: 'sillytavern-import', model: 'imported' },
            },
        }, 'append');
        emit('step/end', { turn, step });
        return surfaceNodes[surfaceNodes.length - 1];
    };
    /** 把当前视图里的 assistant 楼层移出上下文（变体互替/切换用；user 标记 replace 合法） */
    const emitVariantMarker = (shadowedSeq, note) => {
        emit('compaction/prune', {
            shadowedRange: { start: shadowedSeq, end: shadowedSeq },
            shadowedSeqs: [shadowedSeq],
            shadowedTokenCount: 0,
        });
        emit('user/message', {
            id: `st-${opts.sessionId}-mark-${seq}`,
            role: 'user',
            content: [{ type: 'text', text: note }],
            source: {
                kind: 'plugin', plugin: 'sillytavern-import', form: 'snapshot',
                sections: [{ name: 'dsht:surgical', text: JSON.stringify({ variantOf: shadowedSeq, shadowedSeqs: [shadowedSeq] }) }],
            },
        }, { op: 'replace', start: shadowedSeq, end: shadowedSeq }, [shadowedSeq]);
    };
    for (const raw of jsonlText.split('\n')) {
        const trimmed = raw.trim();
        if (!trimmed)
            continue;
        let row;
        try {
            row = JSON.parse(trimmed);
        }
        catch {
            skipped++;
            continue;
        }
        const mes = typeof row.mes === 'string' ? row.mes : '';
        if (!mes.trim()) {
            skipped++;
            continue;
        }
        if (trustSystemFlag && row.is_system === true) {
            skipped++;
            continue;
        }
        const t = parseStDate(row.send_date);
        if (t !== null && t >= time)
            time = t;
        else
            time += 1000;
        if (row.is_user === true) {
            if (turn > 0)
                closeTurn();
            turn++;
            emit('turn/start', { turn });
            // 【阶段3 2026-09-10 契约修正】user/message 也必须落在打开的 step 内——
            // 0.1.5 的 v2→v3 迁移器（dsh-session-format-v2-to-v3/lib/index.js:733）要求
            // 「首个 step 之前的 surface 事件无法在不改变时序的前提下取得 system head」，
            // 直接抛 `format v2 surface before first step cannot acquire a system head`。
            // 实测：普通（无 swipes）导入会话在 0.1.5 下 100% 打不开。
            // 复刻真实 DSH 会话形态（每个 user 楼层独立 step）。
            step++;
            emit('step/start', { turn, step });
            emit('user/message', {
                id: `st-${opts.sessionId}-${seq}`,
                role: 'user',
                content: [{ type: 'text', text: mes }],
                source: { kind: 'user' },
            }, 'append');
            emit('step/end', { turn, step });
            if (firstUserText === null)
                firstUserText = mes.slice(0, 120);
        }
        else {
            if (turn === 0) {
                // 文件以 assistant 开场（ST 常见：首行是角色开场白）——包一个虚拟 turn
                turn++;
                emit('turn/start', { turn });
            }
            // ---- swipes → 变体组 ----
            const swipes = Array.isArray(row.swipes)
                ? row.swipes.filter((s) => typeof s === 'string' && s.trim().length > 0)
                : [];
            const variants = swipes.length > 1 ? swipes : [mes];
            const activeIdx = typeof row.swipe_id === 'number' && row.swipe_id >= 0 && row.swipe_id < variants.length
                ? row.swipe_id : variants.length - 1;
            if (variants.length > 1)
                variantGroups++;
            let activeSeq;
            for (let i = 0; i < variants.length; i++) {
                const text = variants[i];
                if (activeSeq === undefined) {
                    activeSeq = emitAssistantStep(text);
                }
                else {
                    // 变体互替：先 user 标记移出旧变体，再 append 新变体（0.1.5 合法形态）
                    emitVariantMarker(activeSeq, `[变体 ${i + 1}/${variants.length}]`);
                    activeSeq = emitAssistantStep(text);
                }
            }
            // active 非末位：追加一次"切换"事件（surface 换回 active；模拟 ST 里左右滑选定的动作）
            if (variants.length > 1 && activeIdx !== variants.length - 1) {
                emitVariantMarker(activeSeq, `[变体 ${activeIdx + 1}/${variants.length}]`);
                activeSeq = emitAssistantStep(variants[activeIdx]);
            }
        }
    }
    if (turn > 0)
        closeTurn();
    // P1#8 构造即验证：产出落盘前自检（seq 连续 + turn/step 配对），不合格直接 throw。
    // 断号/失衡从"运行时 DSH Session.create 才发现"提前到"构造时炸"。
    try {
        assertSessionLogEvents(lines.slice(1).map(l => JSON.parse(l)));
    }
    catch (e) {
        throw new Error(`convertChatFile(${opts.sessionId}) 构造产出未通过自检：${e.message}`);
    }
    return {
        content: lines.join('\n') + '\n',
        turns,
        skipped,
        firstUserText,
        variantGroups,
    };
}
/** session.jsonl 的落盘相对路径（按 cwd 的 projectKey 分组，对照 DSH projectDir） */
function sessionFilePath(sessionId, cwd) {
    const dir = cwd === undefined ? '_no-cwd' : projectKey(cwd);
    return `sessions/${dir}/${encodeSegment(sessionId)}/session.jsonl`;
}
/**
 * rp.json 内容构造（工作区机器可读数据：插件与前端共同消费）。
 * outputProtocol（§4.6 输出协议组件的前端配置）：actionTags 提取为可点按钮并从气泡剥离、
 * wrapTags 剥壳显示内文。默认覆盖用户卡实测格式（<a> 行动选项）与 V8.8（selection/content）。
 */
function buildRpJsonContent(card, books, opts = {}) {
    return JSON.stringify({
        schemaVersion: 1,
        characterName: card.name,
        books,
        trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6000 },
        macros: { char: card.name, user: opts.user ?? '' },
        firstMes: card.firstMes.slice(0, 4000),
        // 第四轮：卡设定文本随 rp.json 走（promptPersona），运行期 pre-step 快照注入并过宏引擎；
        // 不再产出 .agent-presets/rp-*（agent 预设界面只留真预设）
        promptPersona: cardPromptPersona(card),
        // 正则脚本（§4.5 st-regex-scripts / T1.2）：内嵌正则随卡落盘，运行期由
        // dsht-rp-plugin 组装层按三时机消费（prompt 时机改批消息与 WI 内容，
        // display 时机由前端输出协议渲染层消费）
        regex: card.embeddedRegex,
        // T3.1b 导出对称：本工作区是否存了原始卡 JSON 与立绘（导出入口据此显示"
        // 保持无损"或"需补源数据"）。文件在 rp/<slug>/card.json + avatar.png。
        cardSource: { rawJson: !!card.rawJson, hasAvatar: !!card.avatar },
        outputProtocol: {
            actionTags: ['a', 'selection'],
            wrapTags: ['content'],
            statusTags: ['status', 'statusbar', 'StatusBlock'],
            // T2.10 渲染补差：折叠块 / MVU 状态更新 / 思维链 / 伏笔登记册
            collapsibleTags: ['details'],
            stateUpdateTags: ['UpdateVariable'],
            reasoningTags: ['Analysis'],
            foreshadowingTags: ['foreshadowings'],
        },
    }, null, 1);
}
/**
 * 单张角色卡（T1.15：PNG/JSON 单文件导入路径）→ DSH 文件集：
 * 内嵌书 skill + 工作区 rp.json（promptPersona 承载卡设定）+ README + 开场白 session（T2.9）。
 * 外部引用书在单文件路径无法配对（无 data 上下文），导入后可在管理界面补绑。
 */
/**
 * T2.9：开场白 session（角色卡导入必然产出）——firstMes 作为该 session 的
 * 首条 assistant 消息落盘（官方 oneTurnLog 契约：虚拟 turn 包裹开场白）。
 * 点开角色卡即见开场白历史会话；pre-step 快照注入保留给无 session 的旧工作区兼容。
 *
 * 多开场白（T7a）：alternateGreetings 作为 swipe 变体组写进同一条 assistant 消息
 * 位——变体链契约同 convertChatFile 的 swipes 处理（首个 append，其余依次
 * replace 前驱 + sourceEventSeqs 血缘；active = firstMes（ST 默认 swipe_id 0），
 * 追加一次切换事件把 surface 换回 firstMes）。log 全量保真，前端扫 replace 链
 * 重建变体组做开场白左右切换。
 */
function buildFirstMesSession(card, opts = {}) {
    const firstMes = card.firstMes.trim();
    if (!firstMes)
        return null;
    // 变体清单：firstMes + 非空备选（去重——ST 卡里备选与首条相同的复读不收）
    const greetings = [firstMes];
    for (const g of card.alternateGreetings) {
        const t = g.trim();
        if (t && !greetings.includes(t))
            greetings.push(t);
    }
    const sessionId = `st-${hash36(`firstmes/${card.name}`)}`;
    // cwd 必须绝对（DSH WorkspaceRegistry 按 realpath 建组）；dshHome 未给时退相对（纯测试形态）
    const cwd = opts.cwd ?? (opts.dshHome !== undefined
        ? `${opts.dshHome}/${exports.RP_WORKSPACE_DIR}/${dshSlug('rp', card.name)}`
        : `${exports.RP_WORKSPACE_DIR}/${dshSlug('rp', card.name)}`);
    const createdAt = Date.now();
    const lines = [
        JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt, cwd, delegationDepth: 0 }),
    ];
    let seq = 0;
    const event = (type, data, surfaceOp, sourceEventSeqs) => {
        lines.push(JSON.stringify({
            type, seq, time: createdAt + seq, data,
            ...(surfaceOp !== undefined ? { surfaceOp } : {}),
            ...(sourceEventSeqs !== undefined ? { sourceEventSeqs } : {}),
        }));
        seq++;
    };
    /** 一条开场白变体（step 包裹）；返回本条 assistant/message 的 seq */
    const emitGreeting = (text, step) => {
        event('step/start', { turn: 1, step });
        const msgSeq = seq;
        event('assistant/message', {
            turn: 1,
            step,
            message: {
                id: `st-${sessionId}-${step === 1 ? 'first' : `swipe-${step}`}`,
                role: 'assistant',
                content: [{ type: 'text', text }],
                source: { kind: 'model', provider: 'sillytavern-import', model: 'first-mes' },
            },
        }, 'append');
        event('step/end', { turn: 1, step });
        return msgSeq;
    };
    /** 开场白变体互替：user 标记移出旧变体（0.1.5 合法形态，见 convertChatFile 注释） */
    const emitGreetingMarker = (shadowedSeq, step, n, total) => {
        event('step/start', { turn: 1, step });
        event('compaction/prune', {
            shadowedRange: { start: shadowedSeq, end: shadowedSeq },
            shadowedSeqs: [shadowedSeq],
            shadowedTokenCount: 0,
        });
        event('user/message', {
            id: `st-${sessionId}-mark-${seq}`,
            role: 'user',
            content: [{ type: 'text', text: `[开场白变体 ${n}/${total}]` }],
            source: {
                kind: 'plugin', plugin: 'sillytavern-import', form: 'snapshot',
                sections: [{ name: 'dsht:surgical', text: JSON.stringify({ variantOf: shadowedSeq, shadowedSeqs: [shadowedSeq] }) }],
            },
        }, { op: 'replace', start: shadowedSeq, end: shadowedSeq }, [shadowedSeq]);
        event('step/end', { turn: 1, step });
    };
    event('turn/start', { turn: 1 });
    let activeSeq = emitGreeting(greetings[0], 1);
    let curStep = 1;
    for (let i = 1; i < greetings.length; i++) {
        emitGreetingMarker(activeSeq, ++curStep, i + 1, greetings.length);
        activeSeq = emitGreeting(greetings[i], ++curStep);
    }
    if (greetings.length > 1) {
        // active = firstMes（ST 默认 swipe_id 0）：追加切换事件换回首条（同 convertChatFile）
        emitGreetingMarker(activeSeq, ++curStep, 1, greetings.length);
        emitGreeting(greetings[0], ++curStep);
    }
    event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    return { path: `sessions/${projectKey(cwd)}/${encodeSegment(sessionId)}/session.jsonl`, content: lines.join('\n') + '\n' };
}
function exportSingleCardFiles(card, dshHome) {
    const files = [];
    const books = [];
    if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
        const embedName = `${card.name}·内嵌书`;
        files.push(...exportLoreBookSkill({ ...card.embeddedBook, name: embedName }));
        books.push({ name: embedName, lorePath: `skills/${dshSlug('wb', embedName)}/references/lore.json` });
    }
    files.push({ path: `${exports.RP_WORKSPACE_DIR}/${dshSlug('rp', card.name)}/rp.json`, content: buildRpJsonContent(card, books) });
    files.push({
        path: `${exports.RP_WORKSPACE_DIR}/${dshSlug('rp', card.name)}/README.md`,
        content: `# ${card.name}\n\nSillyTavern 单文件导入的角色工作区。\n\n- 卡设定文本：\`rp.json\` 的 \`promptPersona\` 字段（RP 会话每轮快照注入）\n${books.length > 0 ? `- 内嵌世界书：${books.map(b => `《${b.name}》`).join('')}（skill 形式自动触发）\n` : ''}\n在 RP 聊天列表点本角色即可开聊；世界书按关键词自动激活。\n`,
    });
    // T3.1b 导出对称：存原始卡 JSON（无损重打包 tEXt 用）+ 立绘（PNG 卡载体）
    const slug = dshSlug('rp', card.name);
    if (card.rawJson) {
        files.push({ path: `${exports.RP_WORKSPACE_DIR}/${slug}/card.json`, content: card.rawJson });
    }
    if (card.avatar) {
        files.push({ path: `${exports.RP_WORKSPACE_DIR}/${slug}/avatar.png`, content: (0, card_export_ts_1.bytesToBase64)(card.avatar), binary: true });
    }
    // T2.9：开场白 session（firstMes 非空即产出——用户定案：角色卡导入必然有带开场白的 session）
    const firstMesSession = buildFirstMesSession(card, dshHome !== undefined ? { dshHome } : {});
    if (firstMesSession)
        files.push(firstMesSession);
    return files;
}
/**
 * 把最近一次 analyzeDataZip 的会话缓存转换成 DSH 数据布局文件，经 sink 分批写盘。
 *
 * 进度分配：世界书 0-40%、角色卡 40-70%、聊天 70-100%。
 *
 * 工作区布局（§4.14 用户定案）：**一张角色卡 = 一个工作区**——
 * 有聊天且能对上卡的 → cwd = $DSH_HOME/rp/<卡slug>（DSH workspace 侧栏即角色分组）；
 * 对不上卡的孤儿聊天 → cwd = $DSH_HOME/rp/_orphan。每个工作区写 README.md
 * （角色说明 + 聊天清单 + preset/skill 指引），兼作目录占位（WorkspaceRegistry
 * realpath 校验要求目录存在）。
 *
 * @param imp analyzeDataZip 后的会话缓存（lastDataImport()）
 * @param sink 接收批次（每批 ≤ batchSize 个文件），await 后继续——调用方在这里写盘
 * @param dshHome DSH_HOME 绝对路径（聊天 session 的 cwd 基准；无则聊天下降到 _no-cwd，列表不可见）
 */
async function exportToDshFiles(imp, sink, options = { worlds: true, cards: true, chats: true }, dshHome) {
    const result = { skills: 0, presets: 0, sessions: 0, files: [], warnings: [], workspaces: [] };
    const BATCH = 40;
    let batch = [];
    let percentBase = 0;
    let percentSpan = 0;
    const flush = async (p) => {
        if (batch.length === 0)
            return;
        await sink(batch, p);
        result.files.push(...batch);
        batch = [];
    };
    // ---- 用户档案 persona（R8：power_user 三处提取的全部 persona，每个 persona 一个 preset）----
    /** 单个 persona → DSH 用户侧 preset 两个文件（默认 persona 固定 id dsht-user-persona） */
    const personaPresetFiles = (id, label, name, desc, avatar) => {
        // 宏中性化：ST persona 描述同样可能残留 {{…}} 宏（写进 DSH persona 插件的文本必须过此护栏）
        const personaText = (0, compiler_ts_1.neutralizePromptVariables)([
            `# 用户档案（persona）`,
            `用户在角色扮演中扮演的主角。`,
            name ? `- 名字：${name}` : '',
            desc ? `- 人设：${desc}` : '',
            avatar ? `- 头像：${avatar}` : '',
            `- 行为约束：以该身份行动；用户的名字在叙事中以「${name || '用户'}」称谓出现。`,
        ].filter(Boolean).join('\n'));
        return [
            {
                path: `.agent-presets/${id}/agent.cordis.yml`,
                content: [
                    `# DSHTavern 用户档案 preset（源自 SillyTavern settings.json power_user persona 块）`,
                    `- id: persona`,
                    `  name: '@deepseek-ai/dsh-persona'`,
                    `  config:`,
                    `    text: |-`,
                    ...personaText.split('\n').map(l => (l === '' ? '' : '      ' + l)),
                    `    complete: true`,
                    `    includeRuntimeContext: false`,
                    ``,
                ].join('\n'),
            },
            {
                path: `.agent-presets/${id}/preset.yml`,
                content: `name: ${label}\ndescription: ST 迁移的用户人设——按需挂载到任意会话\norder: 50\n\n`,
            },
        ];
    };
    const personas = imp.report?.settings?.personas;
    if (Array.isArray(personas) && personas.length > 0) {
        for (const p of personas) {
            const pName = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
            const pDesc = typeof p.description === 'string' && p.description.trim() ? p.description.trim() : null;
            if (!pName && !pDesc)
                continue;
            const pAvatar = typeof p.avatar === 'string' && p.avatar.trim() ? p.avatar.trim() : null;
            const id = p.isDefault === true
                ? 'dsht-user-persona'
                : `dsht-persona-${dshSlug('rp', pName ?? 'persona').replace(/^rp-/, '')}`;
            batch.push(...personaPresetFiles(id, pName ? `用户档案（${pName}）` : '用户档案（persona）', pName, pDesc, pAvatar));
            result.presets += 1;
        }
    }
    else {
        // 向后兼容：旧形态 report（只有 personaName/personaDescription，无 personas 列表）
        const personaName = imp.report?.settings?.personaName?.trim() || null;
        const personaDesc = imp.report?.settings?.personaDescription?.trim() || null;
        if (personaName || personaDesc) {
            batch.push(...personaPresetFiles('dsht-user-persona', '用户档案（persona）', personaName, personaDesc, null));
            result.presets += 1;
        }
    }
    // ---- 世界书 → skills ----
    if (options.worlds !== false && imp.worlds.size > 0) {
        percentBase = 0;
        percentSpan = 40;
        const entries = [...imp.worlds.values()];
        for (let i = 0; i < entries.length; i++) {
            const files = exportLoreBookSkill(entries[i]);
            batch.push(...files);
            result.skills++;
            if (batch.length >= BATCH) {
                await flush({ percent: percentBase + Math.round(((i + 1) / entries.length) * percentSpan), desc: `世界书 → skill（${i + 1}/${entries.length}）` });
            }
        }
        await flush({ percent: 40, desc: '世界书转换完成' });
    }
    // ---- 角色卡 ----（第四轮起不再产出 agent preset：卡设定进 rp.json.promptPersona，
    // 由下方 emitCardRpJson 统一落盘；此处仅占进度位，无独立产物）
    if (options.cards !== false && imp.characters.length > 0) {
        percentBase = 40;
        percentSpan = 30;
        await flush({ percent: 70, desc: `角色卡处理完成（${imp.characters.length} 张，设定随 rp.json promptPersona 落盘）` });
    }
    // ---- T2.11 补：ST 预设 → 顶层 rp-preset（OpenAI Settings/*.json → preset + 正则）----
    // 史补缺：整包迁移此前只对 OpenAI Settings 计数（report.stats.presets）不转换，
    // 示例预设等 ST 预设及其内嵌正则不会随 data.zip 进入——需手动到预设 tab 再导。现补上。
    if (options.presets !== false) {
        const presetFiles = Object.keys(imp.zip.files)
            .filter(f => /OpenAI Settings\/.+\.json$/i.test(f) && !/\.luker-state\./.test(f));
        if (presetFiles.length > 0) {
            let done = 0;
            for (const pf of presetFiles) {
                try {
                    const text = await imp.zip.files[pf].async('string');
                    const name = decodeURIComponent(pf.split('/').pop().replace(/\.json$/i, ''));
                    const { preset, regex } = (0, st_import_ts_1.importStPreset)(text, name);
                    batch.push({
                        path: `rp-presets/${preset.id}/preset.json`,
                        content: JSON.stringify(preset, null, 1),
                    });
                    if (regex.length > 0) {
                        batch.push({
                            path: `rp-presets/${preset.id}/regex.json`,
                            content: JSON.stringify({ scripts: regex }, null, 1),
                        });
                    }
                    result.presets++;
                }
                catch (e) {
                    result.warnings.push(`ST 预设导入失败：${pf}（${e.message}）`);
                }
                done++;
                if (batch.length >= BATCH) {
                    await flush({ percent: 70 + Math.round((done / presetFiles.length) * 5), desc: `ST 预设 → rp-preset（${done}/${presetFiles.length}）` });
                }
            }
            await flush({ percent: 75, desc: 'ST 预设转换完成' });
        }
    }
    // ---- 聊天 → sessions + 角色工作区（R1：全卡建工作区；R2：三键匹配；逐文件懒读控制内存）----
    const wantChats = options.chats !== false && imp.chatFiles.length > 0;
    const wantCardWorkspaces = (options.chats !== false || options.cards !== false) && imp.characters.length > 0;
    if (wantChats || wantCardWorkspaces) {
        percentBase = 70;
        percentSpan = 30;
        // R2 三键索引：卡内 name / 卡来源文件名（sourceFileName）/ 归一化 name（去空格、小写）。
        // 真实数据包实证：chats/<目录名> = 角色卡 PNG 文件名，不一定等于卡内 JSON 的 name。
        const normNameKey = (s) => s.replace(/\s+/g, '').toLowerCase();
        const cardByKey = new Map();
        for (const c of imp.characters) {
            for (const k of [c.name, c.sourceFileName ?? '', normNameKey(c.name)]) {
                if (k && !cardByKey.has(k))
                    cardByKey.set(k, c);
            }
        }
        const lookupCard = (ownerDir) => cardByKey.get(ownerDir) ?? cardByKey.get(normNameKey(ownerDir)) ?? null;
        const ORPHAN_DIR = '_orphan';
        // R9：全局书单（settings.globalSelect）落盘 rp/global-books.json，并并入每个工作区 rp.json 的 books
        const globalBooks = [];
        for (const raw of imp.report?.relations?.globalSelectedBooks ?? []) {
            const name = String(raw).trim();
            if (!name)
                continue;
            const lorePath = `skills/${dshSlug('wb', name)}/references/lore.json`;
            if (globalBooks.some(b => b.lorePath === lorePath))
                continue;
            globalBooks.push({ name, lorePath });
        }
        if (globalBooks.length > 0) {
            batch.push({
                path: `${exports.RP_WORKSPACE_DIR}/global-books.json`,
                content: JSON.stringify({ books: globalBooks }, null, 1),
            });
        }
        /**
         * 工作区 rp.json：dsht-rp-plugin 运行时消费（识别 RP 会话 + 世界书触发）。
         * - books[].lorePath：$DSH_HOME 相对路径（skills/<slug>/references/lore.json）
         * - 内嵌书也生成 skill（wb-embed-），让角色卡自带的世界设定同样可触发
         * - R9 全局书单与 R7 聊天绑定书并入 books（lorePath 去重）
         */
        const emitCardRpJson = (card, extra) => {
            const books = [];
            const seen = new Set();
            const pushBook = (b) => {
                if (!seen.has(b.lorePath)) {
                    seen.add(b.lorePath);
                    books.push(b);
                }
            };
            // 外部引用书（配对成功才在 imp.worlds 里）
            if (card.externalWorldRef && imp.worlds.has(card.externalWorldRef)) {
                pushBook({
                    name: card.externalWorldRef,
                    lorePath: `skills/${dshSlug('wb', card.externalWorldRef)}/references/lore.json`,
                });
            }
            // 内嵌书 → 独立 skill + 登记
            if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
                const embedName = `${card.name}·内嵌书`;
                batch.push(...exportLoreBookSkill({ ...card.embeddedBook, name: embedName }));
                pushBook({ name: embedName, lorePath: `skills/${dshSlug('wb', embedName)}/references/lore.json` });
            }
            for (const b of globalBooks)
                pushBook(b); // R9 全局书单
            for (const b of extra.books)
                pushBook(b); // R7 聊天绑定书
            // T3.1b：整包迁移同样补存原始卡 JSON + 立绘（导出对称源数据）
            const slug = dshSlug('rp', card.name);
            if (card.rawJson) {
                batch.push({ path: `${exports.RP_WORKSPACE_DIR}/${slug}/card.json`, content: card.rawJson });
            }
            if (card.avatar) {
                batch.push({ path: `${exports.RP_WORKSPACE_DIR}/${slug}/avatar.png`, content: (0, card_export_ts_1.bytesToBase64)(card.avatar), binary: true });
            }
            batch.push({
                path: `${exports.RP_WORKSPACE_DIR}/${slug}/rp.json`,
                content: buildRpJsonContent(card, books, { user: extra.user }),
            });
        };
        const workspaces = new Map();
        const wsFor = (dir, card) => {
            let ws = workspaces.get(dir);
            if (!ws) {
                ws = { dir, card, chats: [], variantGroups: 0, extraBooks: new Map(), userName: '' };
                workspaces.set(dir, ws);
            }
            return ws;
        };
        if (wantChats) {
            const orphanDirs = new Map();
            for (let i = 0; i < imp.chatFiles.length; i++) {
                const cf = imp.chatFiles[i];
                try {
                    const text = await imp.zip.files[cf.path].async('string');
                    // createdAt：优先 ST 首行 create_date，失败用 file_date/兜底当前
                    let createdAt = Date.now();
                    const firstLine = text.split('\n')[0];
                    let meta = null;
                    try {
                        const parsed = JSON.parse(firstLine);
                        if (parsed && typeof parsed === 'object') {
                            meta = parsed;
                            const cd = Date.parse(String(meta.create_date ?? ''));
                            if (Number.isSafeInteger(cd) && cd > 0)
                                createdAt = cd;
                        }
                    }
                    catch { /* 首行不是元数据行：无妨 */ }
                    const fileName = cf.path.split('/').pop() ?? String(i);
                    const sessionId = chatSessionId(cf.ownerDir, fileName);
                    const card = lookupCard(cf.ownerDir);
                    const dir = card ? dshSlug('rp', card.name) : ORPHAN_DIR;
                    const chatCwd = dshHome !== undefined ? `${dshHome}/${exports.RP_WORKSPACE_DIR}/${dir}` : undefined;
                    const conv = convertChatFile(text, { sessionId, createdAt, cwd: chatCwd });
                    const sessionPath = sessionFilePath(sessionId, chatCwd);
                    batch.push({ path: sessionPath, content: conv.content });
                    result.sessions++;
                    if (!card)
                        orphanDirs.set(cf.ownerDir, (orphanDirs.get(cf.ownerDir) ?? 0) + 1);
                    const ws = wsFor(dir, card);
                    ws.chats.push({ file: fileName, sessionPath });
                    ws.variantGroups += conv.variantGroups;
                    // R7：首行 chat_metadata 落盘（variables / 绑定书 / last_user_persona）
                    if (meta) {
                        const cm = (meta.chat_metadata && typeof meta.chat_metadata === 'object'
                            ? meta.chat_metadata : {});
                        // MVU 变量 → rp/state/<sessionId>.json
                        if (cm.variables && typeof cm.variables === 'object' && !Array.isArray(cm.variables)) {
                            batch.push({
                                path: `${exports.RP_WORKSPACE_DIR}/state/${sessionId}.json`,
                                content: JSON.stringify(cm.variables),
                            });
                        }
                        // 绑定书（防御性多字段候选：world / worldName / boundWorld）→ 工作区 books
                        // （只登记 zip 里实际解析到的书，避免指向不存在的 skill）
                        for (const k of ['world', 'worldName', 'boundWorld']) {
                            const v = cm[k] ?? meta[k];
                            if (typeof v === 'string' && v.trim() && imp.worlds.has(v.trim())) {
                                const bookName = v.trim();
                                const lorePath = `skills/${dshSlug('wb', bookName)}/references/lore.json`;
                                ws.extraBooks.set(lorePath, { name: bookName, lorePath });
                            }
                        }
                        // last_user_persona.name → rp.json macros.user（首个非空者）
                        const lup = cm.last_user_persona ?? meta.last_user_persona;
                        const lupName = typeof lup === 'string'
                            ? lup
                            : lup && typeof lup === 'object' ? lup.name : null;
                        if (typeof lupName === 'string' && lupName.trim() && !ws.userName)
                            ws.userName = lupName.trim();
                    }
                    if (conv.skipped > 0 && conv.turns === 0) {
                        result.warnings.push(`聊天「${cf.path}」无可转消息（${conv.skipped} 行跳过）`);
                    }
                }
                catch {
                    result.warnings.push(`聊天转换失败：${cf.path}`);
                }
                if (batch.length >= BATCH) {
                    await flush({ percent: percentBase + Math.round(((i + 1) / imp.chatFiles.length) * percentSpan), desc: `聊天 → session（${i + 1}/${imp.chatFiles.length}）` });
                }
            }
            // R2：孤儿聊天目录显式列出（原来只进 report.relations.chatOrphans，导出结果不可见）
            if (orphanDirs.size > 0) {
                result.warnings.push(`孤儿聊天目录（未匹配到角色卡，已挂 ${exports.RP_WORKSPACE_DIR}/${ORPHAN_DIR} 待认领）：` +
                    [...orphanDirs.entries()].map(([d, c]) => `${d}（${c} 个聊天）`).join('、'));
            }
        }
        // R1：全部角色卡都产出工作区文件（无聊天的卡也建 rp.json + card.json/avatar），
        // 并登记到 result.workspaces 供调用方 workspace.create + rename(卡名)
        for (const card of imp.characters) {
            const slug = dshSlug('rp', card.name);
            const ws = workspaces.get(slug);
            emitCardRpJson(card, {
                books: ws ? [...ws.extraBooks.values()] : [],
                user: ws?.userName ?? '',
            });
            result.workspaces.push({ slug, name: card.name, dir: `${exports.RP_WORKSPACE_DIR}/${slug}` });
        }
        // 工作区 README（一卡一份——无聊天的卡也建；orphan 单独一份）
        for (const card of imp.characters) {
            const slug = dshSlug('rp', card.name);
            const ws = workspaces.get(slug);
            const chats = ws?.chats ?? [];
            const variantGroups = ws?.variantGroups ?? 0;
            const lines = [
                `# ${card.name}`,
                '',
                chats.length > 0
                    ? `SillyTavern 迁移的角色工作区（${chats.length} 个聊天${variantGroups > 0 ? `，含 ${variantGroups} 个变体组（swipe）` : ''}）。`
                    : `SillyTavern 迁移的角色工作区（暂无迁移聊天）。`,
                '',
                `- 卡设定文本：\`rp.json\` 的 \`promptPersona\` 字段（RP 会话每轮快照注入）`,
                card.externalWorldRef ? `- 关联世界书：《${card.externalWorldRef}》（skill 形式，需设定时模型自动查）` : '',
                '',
                ...(chats.length > 0 ? ['## 聊天文件', ...chats.map(c => `- ${c.file}`), ''] : []),
            ].filter(l => l !== '');
            batch.push({
                path: `${exports.RP_WORKSPACE_DIR}/${slug}/README.md`,
                content: lines.join('\n'),
            });
        }
        const orphanWs = workspaces.get(ORPHAN_DIR);
        if (orphanWs) {
            batch.push({
                path: `${exports.RP_WORKSPACE_DIR}/${ORPHAN_DIR}/README.md`,
                content: [
                    `# 待认领聊天`,
                    '',
                    `SillyTavern 中未匹配到角色卡的 ${orphanWs.chats.length} 个聊天（目录名对不上 characters/）。`,
                    '',
                    '## 聊天文件',
                    ...orphanWs.chats.map(c => `- ${c.file}`),
                    '',
                ].join('\n'),
            });
            result.workspaces.push({ slug: ORPHAN_DIR, name: '待认领聊天', dir: `${exports.RP_WORKSPACE_DIR}/${ORPHAN_DIR}` });
        }
        await flush({ percent: 100, desc: '聊天转换完成' });
    }
    // 收尾 flush（persona-only 等没有后续阶段触发 sink 的路径）
    await flush({ percent: 100, desc: '完成' });
    return result;
}
