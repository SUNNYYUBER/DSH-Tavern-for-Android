"use strict";
/**
 * session.jsonl 手术刀（共享模块）——从 dsh-plugin/index.ts 抽出，供
 * dsht-rp-plugin 与独立通用插件 dsht-plugin-undo 共同消费（esbuild 各自内联，
 * 零运行时依赖）。
 *
 * 契约：
 * - session.jsonl 首行 = session header（type:'session'），后续每行一个事件（seq 递增）。
 * - 回退/重新生成 = 原地截断事件流（绝不开新分支/新 session）：header 保留，
 *   事件只留 seq <= keepThroughSeq；被截事件参与的 replace 链随截断消失
 *   （后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证锚点落在链尾）。
 * - 会话定位：扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header.id。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.truncateSessionJsonl = truncateSessionJsonl;
exports.normalizeSnapshotMessageRoles = normalizeSnapshotMessageRoles;
exports.findLastUserMessage = findLastUserMessage;
exports.repairDuplicateTurnStarts = repairDuplicateTurnStarts;
exports.readFirstLine = readFirstLine;
exports.scanSessionHeaders = scanSessionHeaders;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
// @adapt contract:persistence.format
/**
 * 会话回退（纯函数）：截断 session.jsonl 到 keepThroughSeq（含）——
 * header 保留，事件只留 seq <= keepThroughSeq 的；被截事件参与的 replace 链
 * 随截断消失（后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证
 * keepThroughSeq 落在链尾）。
 */
function truncateSessionJsonl(content, keepThroughSeq) {
    const lines = content.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '')
        lines.pop();
    if (lines.length === 0)
        return { content, kept: 0, dropped: 0, error: '空文件' };
    let header;
    try {
        header = JSON.parse(lines[0]);
    }
    catch {
        return { content, kept: 0, dropped: 0, error: 'header 不是合法 JSON' };
    }
    if (header?.type !== 'session')
        return { content, kept: 0, dropped: 0, error: '首行不是 session header' };
    const kept = [];
    let dropped = 0;
    for (let i = 1; i < lines.length; i++) {
        let ev;
        try {
            ev = JSON.parse(lines[i]);
        }
        catch {
            return { content, kept: 0, dropped: 0, error: `第 ${i + 1} 行不是合法 JSON` };
        }
        if (typeof ev?.seq === 'number' && ev.seq <= keepThroughSeq)
            kept.push(lines[i]);
        else
            dropped++;
    }
    return { content: [lines[0], ...kept].join('\n') + '\n', kept: kept.length, dropped };
}
/**
 * 快照消息角色归一化（纯函数）：把 user/message 事件里 role==='system' 的历史快照
 * 改写为 role:'user'。
 *
 * 根因（真机实测，DSH 0.1.0-rc.8 冷启动校验）：assertMessageEventShape 要求
 * user/message 的 data.role === 'user'（'message must have role "user"'）——RP 侧
 * pre-step 快照注入（persona/世界书/预设/状态/记忆，source.form='snapshot'）历史
 * 写的是 role:'system'，写盘时进程内不校验、冷启动全量校验即炸
 * SessionPersistenceCorruptionError，会话整个打不开。注入器已改写 role:'user'（对
 * 模型语义不变：system 提示本就以用户深度注入等效），本函数修复存量日志。
 * 其余事件行原样透传；非 JSON 行原样保留（与 truncate 的严格策略不同——归一化
 * 要尽量少动文件）。
 */
function normalizeSnapshotMessageRoles(content) {
    const lines = content.split('\n');
    let changed = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('"user/message"'))
            continue;
        if (!line.includes('"role":"system"') && !line.includes('"form":"snapshot"'))
            continue;
        try {
            const ev = JSON.parse(line);
            if (ev?.type !== 'user/message')
                continue;
            const isSnapshot = ev.data?.source?.form === 'snapshot';
            let touched = false;
            if (ev.data?.role === 'system') {
                ev.data.role = 'user';
                touched = true;
            }
            // 快照消息里的残留 ASCII 宏（未知宏如 {{trim}}/{{lastUserMessage}} 组装层不展开、
            // 原样透传）→ 全角化：DSH 插值器对 persona 段消息扫 '{{'，未知引用直接抛
            // "malformed prompt variable reference"，turn 炸（真机实测 turn 38）。
            if (isSnapshot && Array.isArray(ev.data?.content)) {
                for (const block of ev.data.content) {
                    if (block?.type === 'text' && typeof block.text === 'string' && block.text.includes('{{')) {
                        block.text = block.text.split('{{').join('｛｛').split('}}').join('｝｝');
                        touched = true;
                    }
                }
            }
            // source.sections[].text 同样中性化（插值器连 sections 一起扫——真机实测 turn 38：
            // content 已净但 sections.text 带原始宏照样炸）
            const secs = ev.data?.source?.sections;
            if (isSnapshot && Array.isArray(secs)) {
                for (const s of secs) {
                    if (s && typeof s.text === 'string' && s.text.includes('{{')) {
                        s.text = s.text.split('{{').join('｛｛').split('}}').join('｝｝');
                        touched = true;
                    }
                }
            }
            if (touched) {
                lines[i] = JSON.stringify(ev);
                changed++;
            }
        }
        catch { /* 坏行原样保留 */ }
    }
    return { content: lines.join('\n'), changed };
}
/**
 * 会话重新生成定位（纯函数）：最后一条**真用户** user/message 的 seq 与其文本。
 * 找不到返回 null。事件形态：user/message 的 data = {role, content}（LikeMessage 直存）。
 * 【鲁棒轮 2026-09-09】排除 source.kind === 'plugin'（live 回退/重新生成后的 marker
 * 「[已回退] …」原实现会被当锚 → lastUserText = marker 文案 → 前端把系统文案当输入重发；
 * live 路径同口径）。kind 缺失（存量旧数据）视为真用户消息——不破坏旧会话兼容。
 */
function findLastUserMessage(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev?.type !== 'user/message')
            continue;
        const d = ev.data;
        if (d?.source?.kind === 'plugin')
            continue;
        const text = (d?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
        return { seq: ev.seq, text };
    }
    return null;
}
/**
 * 重复 turn/start 检测与修复（纯函数，R49 存量数据修复）。
 *
 * 根因（实机实证，turn 序列 1,1,2..18）：open-chat 物化直写 turn/start 事件不刷新
 * 内核 agent 构造时缓存的 phase.lastTurn → 内核下一条 prompt 重开同一 turn →
 * session.jsonl 出现两条 data.turn 相同的 turn/start → 前端 ConversationNodeAssembler
 * 全量重放抛「received more than one start Match」→ event feed subscriber 死亡，
 * 折叠行（turn-process 节点）/会话流停摆。
 *
 * 修复策略：第二次出现的 turn/start（其 turn 已闭合过）连同其配对 turn/end 的
 * 整段，把段内所有 data.turn === 旧编号的事件重编号为 maxTurn+1。保留首段
 * （物化开场白 = 楼层 1 语义）；重编号段的时间顺序在楼层分组里按 seq 排，无影响。
 * 事件 seq 与行结构不动；坏行原样保留（与 normalizeSnapshotMessageRoles 同策略）。
 */
function repairDuplicateTurnStarts(content) {
    const lines = content.split('\n');
    const events = lines.map(l => {
        try {
            const ev = JSON.parse(l);
            if (typeof ev?.type !== 'string')
                return null;
            const turn = typeof ev.data?.turn === 'number' ? ev.data.turn : undefined;
            return { type: ev.type, turn };
        }
        catch {
            return null;
        }
    });
    const closed = new Set();
    let maxTurn = 0;
    let renumberedTurns = 0;
    let eventsRewritten = 0;
    // 先扫一遍确定 maxTurn（重编号目标 = max+1）
    for (const ev of events) {
        if (ev?.type === 'turn/start' && typeof ev.turn === 'number')
            maxTurn = Math.max(maxTurn, ev.turn);
    }
    // 逐事件状态机：closed 里已有的 turn 又开 start → 该段重编号
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev?.type !== 'turn/start' || typeof ev.turn !== 'number')
            continue;
        if (!closed.has(ev.turn)) {
            closed.add(ev.turn);
            continue;
        }
        // 重复段：从本行到配对 turn/end（data.turn 相同）
        const oldTurn = ev.turn;
        const newTurn = ++maxTurn;
        renumberedTurns++;
        for (let j = i; j < events.length; j++) {
            const line = lines[j];
            if (!line.includes('"turn"') || !line.trim())
                continue;
            try {
                const parsed = JSON.parse(line);
                if (parsed?.data?.turn === oldTurn) {
                    parsed.data.turn = newTurn;
                    lines[j] = JSON.stringify(parsed);
                    events[j] = { type: events[j]?.type ?? '', turn: newTurn };
                    eventsRewritten++;
                    if (events[j]?.type === 'turn/end')
                        break;
                }
            }
            catch { /* 坏行不动 */ }
        }
        // 重编号后的 turn 视为闭合（继续扫后续）
        closed.add(newTurn);
    }
    if (eventsRewritten === 0)
        return { content, renumberedTurns: 0, eventsRewritten: 0 };
    return { content: lines.join('\n'), renumberedTurns, eventsRewritten };
}
/** 读文件首行（session.jsonl header；大聊天日志不整读） */
async function readFirstLine(path) {
    let handle = null;
    try {
        handle = await (0, promises_1.open)(path, 'r');
        const buf = Buffer.alloc(8192);
        const { bytesRead } = await handle.read(buf, 0, 8192, 0);
        if (bytesRead === 0)
            return null;
        const chunk = buf.subarray(0, bytesRead).toString('utf8');
        const nl = chunk.indexOf('\n');
        return nl === -1 ? chunk : chunk.slice(0, nl);
    }
    catch {
        return null;
    }
    finally {
        await handle?.close().catch(() => { });
    }
}
/** 扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header（只读首行，大日志无压力） */
async function scanSessionHeaders(dshHome) {
    const root = (0, node_path_1.join)(dshHome, 'sessions');
    const out = [];
    let projects = [];
    try {
        projects = await (0, promises_1.readdir)(root);
    }
    catch {
        return out;
    }
    for (const project of projects) {
        let sdirs = [];
        try {
            sdirs = await (0, promises_1.readdir)((0, node_path_1.join)(root, project));
        }
        catch {
            continue;
        }
        for (const sdir of sdirs) {
            const firstLine = await readFirstLine((0, node_path_1.join)(root, project, sdir, 'session.jsonl'));
            if (firstLine === null)
                continue;
            try {
                const header = JSON.parse(firstLine);
                if (header?.type !== 'session' || typeof header.id !== 'string')
                    continue;
                out.push({
                    sessionId: header.id,
                    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
                    project, sdir, firstLine,
                });
            }
            catch { /* 非 JSON 首行 */ }
        }
    }
    return out;
}
