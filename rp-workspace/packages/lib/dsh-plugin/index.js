"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = exports.findLastUserMessage = exports.truncateSessionJsonl = exports.findStDataRoot = void 0;
exports.loadEjsSettings = loadEjsSettings;
exports.scanSurfaceHistory = scanSurfaceHistory;
exports.flushLiveSession = flushLiveSession;
exports.sessionEventAt = sessionEventAt;
exports.sessionEventsSnapshot = sessionEventsSnapshot;
exports.entryActive = entryActive;
exports.scanGenerateEntries = scanGenerateEntries;
exports.scanRenderEntries = scanRenderEntries;
exports.scanInjectEntries = scanInjectEntries;
exports.parseInitVariables = parseInitVariables;
exports.truncateHeavyToolPayloads = truncateHeavyToolPayloads;
exports.filterTemplateStatements = filterTemplateStatements;
exports.atomicWriteFile = atomicWriteFile;
exports.withSessionLock = withSessionLock;
exports.loadUserProfileCached = loadUserProfileCached;
exports.expandCoreMacros = expandCoreMacros;
exports.renderWorldInfoSnapshot = renderWorldInfoSnapshot;
exports.sessionCwdNeedsRepair = sessionCwdNeedsRepair;
exports.rewriteSessionHeaderCwd = rewriteSessionHeaderCwd;
exports.repairSessionSeqs = repairSessionSeqs;
exports.extractPersonaTextFromAgentYml = extractPersonaTextFromAgentYml;
exports.buildPersonaSnapshotMessage = buildPersonaSnapshotMessage;
exports.sessionContentMaxTime = sessionContentMaxTime;
exports.hasDirectUserInput = hasDirectUserInput;
exports.applyPromptRegexes = applyPromptRegexes;
exports.processActivatedEntries = processActivatedEntries;
exports.spliceDepthInjections = spliceDepthInjections;
exports.collectVariantGroups = collectVariantGroups;
exports.buildVariantSwitchEvent = buildVariantSwitchEvent;
exports.searchLoreEntries = searchLoreEntries;
exports.rpSlugFromCwd = rpSlugFromCwd;
exports.buildStV2FromRp = buildStV2FromRp;
exports.rpNameFrom = rpNameFrom;
exports.makeBatchId = makeBatchId;
exports.isValidBatchId = isValidBatchId;
exports.agentPresetDirId = agentPresetDirId;
exports.unpackZipTo = unpackZipTo;
exports.scanImportManifest = scanImportManifest;
exports.pickSecret = pickSecret;
exports.parseStApiConfig = parseStApiConfig;
exports.apply = apply;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_fs_2 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_readline_1 = require("node:readline");
const node_crypto_1 = require("node:crypto");
const atomic_fs_ts_1 = require("../dsht-plugin-shared/atomic-fs.ts");
const schemastery_1 = __importDefault(require("@deepseek-ai/schemastery"));
const jszip_1 = __importDefault(require("jszip"));
const trigger_ts_1 = require("../lore/trigger.ts");
const character_card_ts_1 = require("../import/character-card.ts");
const dsh_export_ts_1 = require("../import/dsh-export.ts");
const card_export_ts_1 = require("../import/card-export.ts");
const engine_ts_1 = require("../regex/engine.ts");
const engine_ts_2 = require("../macros/engine.ts");
const schema_ts_1 = require("../preset/schema.ts");
const compiler_ts_1 = require("../preset/compiler.ts");
const demo_ts_1 = require("../preset/demo.ts");
const st_import_ts_1 = require("../preset/st-import.ts");
const managed_ts_1 = require("../preset/managed.ts");
const mvu_ts_1 = require("../state/mvu.ts");
const ejs_ts_1 = require("../dsht-plugin-prompt-template/ejs.ts");
const sandbox_ts_1 = require("../dsht-plugin-prompt-template/sandbox.ts");
const macros_ts_1 = require("../dsht-plugin-shared/macros.ts");
const undo_ts_1 = require("../dsht-plugin-shared/undo.ts");
const file_snapshots_ts_1 = require("../dsht-plugin-shared/file-snapshots.ts");
const session_surgery_ts_1 = require("../dsht-plugin-shared/session-surgery.ts");
// D-3：system 槽位路由（TT 对齐投影；合法通道 = system-prompt/assemble 的 assembly.sections）
const tt_projection_ts_1 = require("../dsht-plugin-shared/tt-projection.ts");
// T3.2：会话长期记忆（rp-memory 最小闭环）——核心逻辑纯函数化便于单测，这里只做接线
const memory_ts_1 = require("./memory.ts");
// §4.16.1/§4.6 导入 diff 预览 + 断点续跑 checkpoint（纯逻辑层；findStDataRoot 移入该文件）
const import_preview_ts_1 = require("./import-preview.ts");
// 兼容既有导入面（测试/外部经 index.ts 取 findStDataRoot）
var import_preview_ts_2 = require("./import-preview.ts");
Object.defineProperty(exports, "findStDataRoot", { enumerable: true, get: function () { return import_preview_ts_2.findStDataRoot; } });
const macros_ts_2 = require("../dsht-plugin-tavern-helper/macros.ts");
// 会话手术刀抽至 dsht-plugin-shared/session-surgery.ts（dsht-plugin-undo 共用）；
// 此处 re-export 保持本模块公开面不变（既有测试/调用方零改动）。
var session_surgery_ts_2 = require("../dsht-plugin-shared/session-surgery.ts");
Object.defineProperty(exports, "truncateSessionJsonl", { enumerable: true, get: function () { return session_surgery_ts_2.truncateSessionJsonl; } });
Object.defineProperty(exports, "findLastUserMessage", { enumerable: true, get: function () { return session_surgery_ts_2.findLastUserMessage; } });
const session_surgery_ts_3 = require("../dsht-plugin-shared/session-surgery.ts");
/** I8-7：当前插件实例的 logLine（stdout 转发器是全局单例，重载后指向新实例的环）。 */
let currentRuntimeLogLine = null;
/** B 系：rp/ejs-settings.json 读取（与 dsht-plugin-prompt-template /settings 同文件同默认值）。
 * 进程级缓存 5s——设置面改后最多 5s 生效，避免每轮 pre-step 读盘。 */
let ejsSettingsCache = null;
async function loadEjsSettings(dshHomeDir) {
    if (ejsSettingsCache && Date.now() - ejsSettingsCache.at < 5_000)
        return ejsSettingsCache.value;
    const defaults = {
        enabled: true, generateEnabled: true, generateLoaderEnabled: false, injectLoaderEnabled: false,
        renderEnabled: true, renderLoaderEnabled: false, codeBlocks: false, permanentEvaluation: false,
        filterChatMessage: false, chatDepth: -1, autosaveEnabled: false, preloadWorldinfo: false,
        withContextDisabled: false, debugEnabled: false, invertEnabled: false, compileWorkers: false,
        sandbox: false, codeEditor: false, cacheEnabled: 0, cacheSize: 0, cacheHasher: 'h32ToString',
    };
    const stored = await (0, promises_1.readFile)((0, node_path_1.join)(dshHomeDir, 'rp', 'ejs-settings.json'), 'utf8')
        .then(t => JSON.parse(t)).catch(() => ({}));
    const out = { ...defaults };
    for (const k of Object.keys(defaults))
        if (stored[k] !== undefined)
            out[k] = stored[k];
    ejsSettingsCache = { at: Date.now(), value: out };
    return out;
}
exports.name = 'dsht-rp-plugin';
/** /rp/rollback-mask 结果缓存（键 = session.jsonl 绝对路径；mtime 失效；逻辑回退/
 *  编辑/重新生成成功后 clear——前端 refreshRollbackMask 立即拿到最新锚） */
const rollbackMaskCache = new Map();
// services 声明（Cordis 访问保护：未 inject 的服务属性读取直接 throw "cannot get property without inject"）
// - tools/systemPrompt：lore_query 注册
// - sessions：变体操作读取 session（events/append）
// - llm/agentDefaultModel：/llm/classify 端点（导入管线 AI 语义分类，走已配置凭据）
// - webServer：/dsht-rp/* 同源数据面（T2.5f；web profile 必备）
// - agents：open-chat 物化后同步内核 agent 的 turn 计数（R49——直写 turn/start 事件
//   不刷新 agent 构造时缓存的 phase.lastTurn，内核下一条 prompt 重开同一 turn →
//   前端 assembler「more than one start Match」崩溃，折叠行/会话流停摆）
// @adapt contract:loader.services
exports.inject = ['tools', 'systemPrompt', 'sessions', 'llm', 'agentDefaultModel', 'webServer', 'settings', 'credentials', 'connection', 'agents'];
// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）
// ---------------------------------------------------------------------------
// 纯逻辑（可单测）
// ---------------------------------------------------------------------------
/** 事件数据里的消息文本（单 text 块取 text，多块拼接） */
function messageText(msg) {
    return msg.content
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
}
/**
 * 从 session surface 重建最近消息文本（旧→新）。
 * 排除快照类消息（我们自己注入的与官方 runtime-context 的）——避免旧快照
 * 内容参与关键词扫描造成自我强化/递归漂移。
 */
function scanSurfaceHistory(session, claimed, limit, regexScripts = []) {
    const texts = [];
    const pushMsg = (msg) => {
        if (!msg || !Array.isArray(msg.content))
            return;
        if (msg.source?.form === 'snapshot')
            return;
        if (msg.source?.plugin === exports.name)
            return;
        let t = messageText(msg).trim();
        if (t && regexScripts.length > 0) {
            // ST 语义：WI 扫描看到的是 prompt 正则后的文本（claimed 批已处理过，surface 旧消息在此补跑）
            const placement = msg.role === 'user' ? engine_ts_1.PLACEMENT.USER_INPUT : engine_ts_1.PLACEMENT.AI_OUTPUT;
            t = (0, engine_ts_1.runRegexScripts)(regexScripts, t, 'prompt', placement, { depth: null }).text.trim();
        }
        if (t)
            texts.push(t);
    };
    for (const seq of session.surface.nodes) {
        // @adapt contract:session-api.eventAt
        // 0.1.2 坑 #22：Session 事件读取 API 变更——.events[seq] 直索引移除，改 eventAt(seq)
        const ev = typeof session.eventAt === 'function'
            ? session.eventAt(seq)
            : session.events?.[seq];
        if (!ev)
            continue;
        // 事件 data 形状：user/message = Message 本体；assistant/message = {turn, step, message}
        if (ev.type === 'user/message')
            pushMsg(ev.data);
        else if (ev.type === 'assistant/message')
            pushMsg(ev.data.message);
    }
    // 本批 claimed（新用户消息）也进扫描文本（已过正则，不再重复）
    for (const m of claimed) {
        if (!m || !Array.isArray(m.content))
            continue;
        if (m.source?.form === 'snapshot' || m.source?.plugin === exports.name)
            continue;
        const t = messageText(m).trim();
        if (t)
            texts.push(t);
    }
    return texts.slice(-Math.max(1, limit * 2));
}
// @adapt contract:session-api.flush
/** I8-1（移动端鲁棒性）：live session 的立即耐久 barrier——append 后必须 await，
 * 200ms 批窗口内进程被杀（Android LMK SIGKILL）即丢标记（回退成功但重启后消失）。
 * 失败必须上抛（调用方 500），禁止静默假成功。 */
async function flushLiveSession(sessions, session) {
    const flush = sessions.flush;
    if (typeof flush !== 'function')
        return false;
    const ok = await flush.call(sessions, session);
    if (ok === false)
        throw new Error('session flush 失败（写盘未耐久）——数据仍在内存，请重试或反馈');
    return true;
}
// @adapt contract:session-api.eventAt
/** 坑 #22 共享适配：读一个 seq 的事件（0.1.2 Session 无公开 events，改 eventAt；
 * agent 内部旧对象回落 .events）。 */
function sessionEventAt(session, seq) {
    const s = session;
    if (typeof s.eventAt === 'function')
        return s.eventAt(seq);
    return s.events?.[seq];
}
// @adapt contract:session-api.events-snapshot
/** 坑 #22 共享适配：全量事件快照（0.1.2 用 snapshotEvents()，旧对象回落 .events）。 */
function sessionEventsSnapshot(session) {
    const s = session;
    if (typeof s.snapshotEvents === 'function')
        return s.snapshotEvents();
    if (Array.isArray(s.events))
        return s.events;
    if (s.events && typeof s.events === 'object')
        return Object.values(s.events);
    return [];
}
// ---------------------------------------------------------------------------
// B 系（提示词模板）/ D 系（MVU）/ I7（性能）纯函数补全（2026-09-05 全量整改轮）
// ---------------------------------------------------------------------------
/** B18（旧特性兼容）：条目「参与」判定——invertEnabled 时禁用条目视为启用（ST invert_enabled 同语义）。 */
function entryActive(entry, invert) {
    const disabled = entry.disable === true || entry.enabled === false;
    return invert ? true : !disabled;
}
/** 剥条目内容里的 loader 标记（[GENERATE:BEFORE] / [RENDER:AFTER] 等），返回正文。 */
function stripLoaderMarker(content) {
    return content.replace(/\[\s*(?:GENERATE|RENDER)\s*[:：]?[^\]]*\]/gi, '').trim();
}
/** B3：[GENERATE:BEFORE/AFTER] 条目扫描（ST handleGenerateBefore/After 同语义——
 * 不看关键词激活，生成期整体求值注入；BEFORE=主提示词带区前，AFTER=后）。 */
function scanGenerateEntries(entries) {
    const split = { before: [], after: [] };
    for (const e of entries) {
        const m = e.content.match(/\[\s*GENERATE\s*[:：]\s*(BEFORE|AFTER)\s*\]/i)
            ?? e.content.match(/\[\s*GENERATE\s*\]/i);
        if (!m)
            continue;
        const kind = (m[1] ?? 'BEFORE').toUpperCase();
        const stripped = { ...e, content: stripLoaderMarker(e.content) };
        if (kind === 'AFTER')
            split.after.push(stripped);
        else
            split.before.push(stripped);
    }
    return split;
}
/** B6：[RENDER:BEFORE/AFTER] 条目扫描（ST handleMessageRender 的 RENDER 注入——
 * 显示期把条目求值结果包裹在楼层正文前/后；数据面给 /dsht-ejs/render-entries 消费）。 */
function scanRenderEntries(entries) {
    const split = { before: [], after: [] };
    for (const e of entries) {
        const m = e.content.match(/\[\s*RENDER\s*[:：]\s*(BEFORE|AFTER)\s*\]/i)
            ?? e.content.match(/\[\s*RENDER\s*\]/i);
        if (!m)
            continue;
        const kind = (m[1] ?? 'BEFORE').toUpperCase();
        const stripped = { ...e, content: stripLoaderMarker(e.content) };
        if (kind === 'AFTER')
            split.after.push(stripped);
        else
            split.before.push(stripped);
    }
    return split;
}
/** B4：@Inject 指令条目扫描（ST inject-prompt 同语义——首行 `@Inject: depth=4 role=system
 * order=100`，正文为注入内容；不看关键词激活，恒按 depth 定位注入）。 */
function scanInjectEntries(entries) {
    const out = [];
    for (const e of entries) {
        const m = e.content.match(/^\s*@\s*Inject\s*:\s*([^\n]*)\n?/i);
        if (!m)
            continue;
        const params = m[1] ?? '';
        const num = (k, dflt) => {
            const mm = params.match(new RegExp(`${k}\\s*=\\s*(-?\\d+)`, 'i'));
            return mm ? Number(mm[1]) : dflt;
        };
        const roleRaw = params.match(/role\s*=\s*(system|user|assistant)/i)?.[1]?.toLowerCase();
        out.push({
            entry: { ...e, content: e.content.replace(/^\s*@\s*Inject\s*:[^\n]*\n?/i, '').trim() },
            depth: num('depth', 4),
            role: (roleRaw === 'user' || roleRaw === 'assistant') ? roleRaw : 'system',
            order: num('order', 100),
        });
    }
    return out;
}
/** D1/B12：世界书变量初始化扫描——`<initvar>` / `[initvar]` / `[InitialVariables]` /
 * `<defineEJSVariable>` 块提取（JSON 优先，YAML-lite `key: value` 缩进树兜底），
 * 返回合并变量树（后条目覆盖同路径叶值）。 */
function parseInitVariables(entries) {
    const blocks = [];
    for (const e of entries) {
        for (const re of [
            /<initvar[^>]*>([\s\S]*?)<\/initvar>/gi,
            /\[\s*initvar\s*\]([\s\S]*?)\[\s*\/\s*initvar\s*\]/gi,
            /\[\s*InitialVariables\s*\]([\s\S]*?)(?:\[\s*\/\s*InitialVariables\s*\]|$)/gi,
            /<defineEJSVariable>([\s\S]*?)<\/defineEJSVariable>/gi,
        ]) {
            for (const m of e.content.matchAll(re))
                blocks.push(m[1] ?? '');
        }
    }
    const merged = {};
    /** YAML-lite：缩进树（`key: value`；value 能 JSON.parse 就解析） */
    const parseYamlLite = (src) => {
        const root = {};
        const stack = [{ indent: -1, obj: root }];
        for (const raw of src.split('\n')) {
            if (!raw.trim() || raw.trim().startsWith('#'))
                continue;
            const indent = raw.match(/^ */)?.[0].length ?? 0;
            const m = raw.trim().match(/^([^:]+):\s*(.*)$/);
            if (!m)
                continue;
            while (stack.length > 1 && indent <= stack[stack.length - 1].indent)
                stack.pop();
            const parent = stack[stack.length - 1].obj;
            const key = m[1].trim().replace(/^["']|["']$/g, '');
            const valRaw = m[2].trim();
            let val = valRaw;
            if (valRaw === '') {
                val = {};
                stack.push({ indent, obj: val });
            }
            else {
                try {
                    val = JSON.parse(valRaw);
                }
                catch { /* 原样字符串 */ }
                parent[key] = val;
            }
        }
        return root;
    };
    const deepMergeInto = (target, src) => {
        for (const [k, v] of Object.entries(src)) {
            if (v !== null && typeof v === 'object' && !Array.isArray(v)
                && target[k] !== null && typeof target[k] === 'object' && !Array.isArray(target[k])) {
                deepMergeInto(target[k], v);
            }
            else
                target[k] = v;
        }
    };
    for (const b of blocks) {
        const trimmed = b.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                deepMergeInto(merged, parsed);
            continue;
        }
        catch { /* 落 YAML-lite */ }
        try {
            deepMergeInto(merged, parseYamlLite(trimmed));
        }
        catch { /* 坏块跳过 */ }
    }
    return merged;
}
/** I7（性能）：重载荷截断——工具调用/结果块里的大字符串（10MB+ base64 图等）在进
 * prompt 前替换为占位符（0.1.2 spill 只截结果不截参数，参数侧在此补齐）。非变异。 */
function truncateHeavyToolPayloads(messages, maxLen = 100_000) {
    const isBase64Like = (s) => /^[A-Za-z0-9+/=\r\n]+$/.test(s.slice(0, 256));
    let truncated = 0;
    const cut = (v) => `[dsht truncated: ${v.length} chars${isBase64Like(v) ? ', base64-like' : ''}]`;
    const messagesOut = messages.map(m => {
        const content = m.content;
        if (!Array.isArray(content))
            return m;
        let changed = false;
        const contentOut = content.map(b => {
            const blk = b;
            if (!blk || typeof blk !== 'object' || !/tool|function/i.test(String(blk.type ?? '')))
                return b;
            const blkOut = { ...blk };
            let blockChanged = false;
            for (const field of ['input', 'arguments', 'content', 'output', 'text']) {
                const v = blkOut[field];
                if (typeof v === 'string' && v.length > maxLen) {
                    blkOut[field] = cut(v);
                    blockChanged = true;
                }
                else if (v && typeof v === 'object' && !Array.isArray(v)) {
                    const obj = v;
                    const objOut = { ...obj };
                    let objChanged = false;
                    for (const [k, sv] of Object.entries(obj)) {
                        if (typeof sv === 'string' && sv.length > maxLen) {
                            objOut[k] = cut(sv);
                            objChanged = true;
                        }
                    }
                    if (objChanged) {
                        blkOut[field] = objOut;
                        blockChanged = true;
                    }
                }
            }
            if (blockChanged) {
                changed = true;
                truncated++;
                return blkOut;
            }
            return b;
        });
        return changed ? { ...m, content: contentOut } : m;
    });
    return { messages: truncated > 0 ? messagesOut : messages, truncated };
}
/** B9：楼层模板语句过滤——生成期把 `<% ... %>` 从消息文本剥离（ST filter_chat_message
 * 同语义：楼层模板只渲染显示，不进模型上下文）。非变异。 */
function filterTemplateStatements(messages) {
    const RE = /<%[\s\S]*?%>/g;
    let filtered = 0;
    const messagesOut = messages.map(m => {
        const content = m.content;
        if (!Array.isArray(content))
            return m;
        let changed = false;
        const contentOut = content.map(b => {
            const blk = b;
            if (!blk || blk.type !== 'text' || typeof blk.text !== 'string' || !blk.text.includes('<%'))
                return b;
            const next = blk.text.replace(RE, '');
            if (next === blk.text)
                return b;
            filtered++;
            changed = true;
            return { ...blk, text: next };
        });
        return changed ? { ...m, content: contentOut } : m;
    });
    return { messages: filtered > 0 ? messagesOut : messages, filtered };
}
/** I8-2（移动端鲁棒性）：原子写文件——temp 独占创建 + fsync + rename 发布 + 父目录 fsync。
 * 0.1.2 的 dsh-atomic-write rename 前不 fsync（官方 TODO），我们自己补齐：
 * 手机端进程被杀在任意时刻都不能留下半写文件（torn tail 可修复，但覆盖型半写=静默丢尾部）。 */
/** 同毫秒并发写同路径的 tmp 名去重（L1b 宏注册爆发实机抓到的 EEXIST 冲突） */
let atomicWriteSeq = 0;
/** /macros/register|unregister 读改写串行链（并发注册防丢更新；catch 兜底保证链永不拒绝） */
let macroWriteChain = Promise.resolve({ status: 200, body: {} });
/** 【鲁棒轮 2026-09-09】live 会话手术（rollback/edit/regenerate）per-session 串行链——
 *  三个路由的 live 路径都要「捕获视图 → await replayUndoLog（文件 IO 让出事件循环）→
 *  append replace」；并发请求 B 在 A 的 await 窗口里捕获同一视图 → B 的 replace 指向已被
 *  A 顶替的旧 seq 区间（错位 marker + meter 双记）。非 live 路径有 withSessionLock +
 *  内容比对，live 路径此前完全裸奔。链兜底 catch 保证永拒绝。 */
const liveSurgeryChains = new Map();
function withLiveSurgery(sessionId, fn) {
    const prev = liveSurgeryChains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(fn, fn); // 前序失败不阻塞后续手术
    liveSurgeryChains.set(sessionId, next.then(() => undefined, () => undefined));
    void liveSurgeryChains.get(sessionId); // 触发 catch 规避 unhandledrejection
    return next;
}
async function atomicWriteFile(path, content) {
    const tmp = `${path}.${Date.now()}.${atomicWriteSeq++}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const handle = await (0, promises_1.open)(tmp, 'wx');
    try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await (0, promises_1.rename)(tmp, path);
    // 父目录 fsync（POSIX rename 耐久性要求；Android ext4/f2fs 私有目录有效）
    try {
        const dirHandle = await (0, promises_1.open)((0, node_path_1.dirname)(path), 'r');
        try {
            await dirHandle.sync();
        }
        finally {
            await dirHandle.close();
        }
    }
    catch { /* 目录 fsync 失败不阻塞（Windows 上目录句柄 fsync 不允许） */ }
}
/** I8-3（移动端鲁棒性）：会话文件手术锁——0.1.2 无 lease，多写者（残留 runtime /
 * 第二进程）是 seq gap 的主因。手术期间持独占 .lock（wx 独占创建 = 进程级互斥），
 * 拿不到锁立即失败（不等待——手术是低频运维操作，排队无意义）。 */
async function withSessionLock(file, fn) {
    const lockPath = `${file}.lock`;
    let handle;
    try {
        handle = await (0, promises_1.open)(lockPath, 'wx');
    }
    catch {
        throw new Error('会话被其他写者持有（.lock 已存在）——确认没有第二个 DSH 实例/残留进程后删除 .lock 重试');
    }
    try {
        await handle.writeFile(String(process.pid), 'utf8');
        await handle.sync();
    }
    catch { /* 锁内容写失败不阻塞（锁的存在性即互斥语义） */ }
    try {
        return await fn();
    }
    finally {
        try {
            await (0, promises_1.rm)(lockPath, { force: true });
        }
        catch { /* 锁清理失败不影响结果 */ }
    }
}
let userProfileCache = null;
/** 【实机测试修复 2026-09-05】pre-step withPresetLayer 每轮刷新的当前档案
 * （声明在并行编辑竞态中丢失 → "globalUserProfile is not defined" pre-step 崩溃降级） */
let globalUserProfile = null;
async function loadUserProfileCached(dshHome) {
    if (userProfileCache !== null)
        return userProfileCache;
    try {
        const raw = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'user-profile.json'), 'utf8'));
        userProfileCache = {
            name: typeof raw?.name === 'string' ? raw.name.trim() : '',
            description: typeof raw?.description === 'string' ? raw.description : '',
        };
    }
    catch {
        userProfileCache = { name: '', description: '' };
    }
    return userProfileCache;
}
/** I4（ST 宏系统）：核心宏展开器（生成期 + 显示期共用语义）。
 * 覆盖 ST MacrosParser 高频基础宏：{{user}}/{{char}}/{{time}}/{{date}}/{{weekday}}/
 * {{random:a,b,c}}/{{pick:a,b,c}}/{{roll:X}}/{{roll:X,N}}；未知宏原样保留（ST 同款）。 */
function expandCoreMacros(text, ctx) {
    if (!text || !text.includes('{{'))
        return text;
    const user = ctx.user || '用户';
    const char = ctx.char || '角色';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const weekdayStr = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    let out = text;
    out = out.replaceAll('{{user}}', user).replaceAll('{{char}}', char);
    out = out.replaceAll('{{time}}', timeStr).replaceAll('{{date}}', dateStr).replaceAll('{{weekday}}', weekdayStr);
    // {{random:a,b,c}} / {{pick:a,b,c}}：每次求值随机取一（pick 在 ST 语义里= random 单次）
    out = out.replace(/\{\{(random|pick):([^}]+)\}\}/g, (_m, _kind, list) => {
        const opts = list.split(',').map(s => s.trim()).filter(s => s !== '');
        if (opts.length === 0)
            return _m;
        return opts[Math.floor(Math.random() * opts.length)] ?? _m;
    });
    // {{roll:X}} / {{roll:X,N}}：X 面骰掷 N 次（N 缺省 1），多次返回总和
    out = out.replace(/\{\{roll:(\d+)(?:\s*,\s*(\d+))?\}\}/g, (_m, d, n) => {
        const sides = Math.max(2, Math.min(1000, Number(d) || 6));
        const times = Math.max(1, Math.min(100, Number(n) || 1));
        let sum = 0;
        for (let i = 0; i < times; i++)
            sum += 1 + Math.floor(Math.random() * sides);
        return String(sum);
    });
    return out;
}
/** rp.json 快照文本渲染：激活条目 → 注入块（宏替换 {{char}}/{{user}}） */
function renderWorldInfoSnapshot(activated, macros) {
    if (activated.length === 0)
        return '';
    const sub = (s) => s
        .replaceAll('{{char}}', macros.char || '角色')
        .replaceAll('{{user}}', macros.user || '用户');
    const lines = activated.map(a => {
        const tag = a.reason === 'constant' ? '常驻' : '关键词';
        const head = a.entry.comment ? `[${tag}] ${sub(a.entry.comment)}` : `[${tag}]`;
        return `${head}\n${sub(a.entry.content)}`;
    });
    return [
        'Current active worldbook entries for this roleplay scene. This snapshot supersedes earlier ones.',
        'Use these as established scene facts; do not repeat them verbatim.',
        ...lines,
    ].join('\n\n');
}
/** Android 路径归一：/data/user/0/<pkg> 与 /data/data/<pkg> 是同一目录的两种形态 */
function normAndroidPath(p) {
    return p.replace(/^\/data\/user\/0\//, '/data/data/');
}
// ---------------------------------------------------------------------------
// 存量 session cwd 修复（纯逻辑，可单测）
// 背景：Android 上 $DSH_HOME 常取 /data/user/0/<pkg> 形态（/data/data 的 symlink），
// 而 DSH WorkspaceRegistry 一律 realpath 规范化（/data/data 形态）。迁移写盘的
// session.jsonl header cwd 若为 symlink 形态：
// - session.create(workspaceId, sessionId) 认领时 ensureSession 用字符串等值比对
//   cwd（inspected.meta.cwd !== workspace.path → session-conflict）；
// - jsonl 持久层 assertStoredIdentity 要求物理路径 == logPath(root, header.cwd, id)，
//   所以修复必须同时改 header 并把会话目录搬到 projectKey(规范 cwd) 下。
// ---------------------------------------------------------------------------
/** header cwd 是否需要修复（仅处理 Android symlink 形态；相对路径/其他形态不动） */
function sessionCwdNeedsRepair(cwd) {
    return typeof cwd === 'string' && cwd.startsWith('/data/user/0/');
}
/**
 * 改写 session.jsonl 首行 header 的 cwd（只动首行；事件行不碰）。
 * 返回 null = 不是 session header / 无需改。
 */
function rewriteSessionHeaderCwd(line, canonicalCwd) {
    let obj;
    try {
        obj = JSON.parse(line);
    }
    catch {
        return null;
    }
    if (obj?.type !== 'session' || typeof obj.cwd !== 'string')
        return null;
    if (obj.cwd === canonicalCwd)
        return null;
    obj.cwd = canonicalCwd;
    return JSON.stringify(obj);
}
/**
 * session.jsonl committed 区 seq 连续性校验 + 修复（纯函数，R18 按 decodeStorageRecord 语义重写）。
 *
 * 宿主网关（dsh-session-persistence-jsonl）的加载语义：每行先 JSON.parse → decodeStorageRecord——
 * 只认 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 三种聚合 tag 展开（子事件
 * `seq = seq0 + k`、type 统一 `assistant/chunk`、data 仅 `{turn, step, chunk}`），其余行原样单事件。
 * 之后严格 `event.seq === 期望序号`，gap 且无 turn/end 截尾、有 turn/end 硬拒。
 *
 * 本函数与网关同语义：逐行 decodeStorageRecord（同款三 tag 展开）→ 全事件流严格校验 →
 * 修复策略（I8-4 不变）：
 * - 回绕型 gap（seq < 期望）→ 截到最后连续前缀 + 合成 interrupted turn/end；
 * - 单调缺号且引用可映射（surfaceOp/sourceEventSeqs 无悬空）→ 全事件流重编号；
 * - 修复产物按宿主打包语义 repack：连续 ≥3 个同 turn/step/index 的 assistant/chunk
 *   delta 聚合成 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 行（seq0=首事件 seq，
 *   dt=相邻 time 差分），其余事件逐行——产物再被网关 decode 时逐字节等价。
 */
const CHUNK_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'];
/** decodeStorageRecord 同款：一行 → 事件数组（聚合行展开，其余原样单事件）。 */
function decodeStorageLine(ev) {
    const tag = ev.type;
    if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks')
        return [ev];
    const row = ev;
    const data = row.data ?? {};
    const payload = (tag === 'tool-call-chunks' ? data.args : data.texts);
    if (typeof row.seq0 !== 'number' || typeof row.time0 !== 'number' || !Array.isArray(payload) || payload.length === 0)
        return [ev];
    const dt = data.dt ?? [];
    const out = [];
    let t = row.time0;
    for (let k = 0; k < payload.length; k++) {
        const chunk = tag === 'tool-call-chunks'
            ? { type: 'tool-call-delta', index: data.index, id: data.id, name: data.name, argumentsDelta: payload[k] }
            : { type: tag === 'reasoning-chunks' ? 'reasoning-delta' : 'text-delta', index: data.index, text: payload[k] };
        out.push({ type: 'assistant/chunk', seq: row.seq0 + k, time: t, data: { turn: data.turn, step: data.step, chunk } });
        if (k < dt.length)
            t += Number(dt[k]) || 0;
    }
    return out;
}
/** 事件流 → 宿主打包布局（连续 ≥3 同 turn/step/index 的 assistant/chunk delta 聚合）。 */
function packEventRows(events) {
    const out = [];
    let run = [];
    let runTag = null;
    const classify = (ev) => {
        if (ev.type !== 'assistant/chunk')
            return null;
        const c = ev.data?.chunk;
        if (c?.type === 'text-delta')
            return 'text-chunks';
        if (c?.type === 'reasoning-delta')
            return 'reasoning-chunks';
        if (c?.type === 'tool-call-delta')
            return 'tool-call-chunks';
        return null;
    };
    const continues = (prev, next) => {
        const pd = prev.data;
        const nd = next.data;
        if (next.seq !== prev.seq + 1)
            return false;
        if (nd.turn !== pd.turn || nd.step !== pd.step)
            return false;
        if (nd.chunk?.index !== pd.chunk?.index)
            return false;
        if (nd.chunk?.id !== pd.chunk?.id || nd.chunk?.name !== pd.chunk?.name)
            return false;
        return true;
    };
    const flush = () => {
        if (runTag !== null && run.length >= 3) {
            const first = run[0];
            const d0 = first.data;
            const payloads = [];
            const dts = [];
            for (let i = 0; i < run.length; i++) {
                const c = run[i].data.chunk ?? {};
                payloads.push(String(runTag === 'tool-call-chunks' ? (c.argumentsDelta ?? '') : (c.text ?? '')));
                if (i > 0)
                    dts.push(Math.max(0, run[i].time - run[i - 1].time));
            }
            const data = { turn: d0.turn, step: d0.step, index: d0.chunk?.index };
            if (runTag === 'tool-call-chunks') {
                data.id = d0.chunk?.id;
                if (d0.chunk?.name !== undefined)
                    data.name = d0.chunk.name;
                data.args = payloads;
            }
            else
                data.texts = payloads;
            data.dt = dts;
            out.push(JSON.stringify({ type: runTag, seq0: first.seq, time0: first.time, data }));
        }
        else {
            for (const ev of run)
                out.push(JSON.stringify(ev));
        }
        run = [];
        runTag = null;
    };
    for (const ev of events) {
        const tag = classify(ev);
        if (tag !== null && runTag !== null && tag === runTag && run.length > 0 && continues(run[run.length - 1], ev)) {
            run.push(ev);
            continue;
        }
        flush();
        if (tag !== null) {
            runTag = tag;
            run = [ev];
        }
        else {
            run = [ev];
        } // 非 chunk 事件也要进 run（单独落行）
    }
    flush();
    return out;
}
function repairSessionSeqs(content) {
    const lines = content.split('\n');
    // 末尾空行（trailing newline）不参与事件流
    while (lines.length > 0 && lines[lines.length - 1].trim() === '')
        lines.pop();
    if (lines.length === 0)
        return { repaired: false, content, events: 0, error: '空文件' };
    let header;
    try {
        header = JSON.parse(lines[0]);
    }
    catch {
        return { repaired: false, content, events: 0, error: 'header 不是合法 JSON' };
    }
    if (header?.type !== 'session')
        return { repaired: false, content, events: 0, error: '首行不是 session header' };
    // ---- R18：逐行 decodeStorageRecord（同款三 tag 展开）→ 全事件流严格校验 ----
    // 聚合行（text-chunks/reasoning-chunks/tool-call-chunks）展开成 assistant/chunk 子事件；
    // 其余行单事件。事件数组下标 = 全局事件序号（与网关 this.events.length 一致）。
    const events = [];
    const layout = [];
    let hasChunkRows = false;
    for (let i = 1; i < lines.length; i++) {
        let ev;
        try {
            ev = JSON.parse(lines[i]);
        }
        catch {
            return { repaired: false, content, events: events.length, error: `第 ${i + 1} 行不是合法 JSON` };
        }
        // 聚合行只有 seq0 无 seq——先判 CHUNK_TAGS（修复 R18 致命 bug：seq 守卫在 tag 判定前
        // 导致聚合行全进 raw 分支，decodeStorageLine/hasChunkRows/packEventRows 成死代码）
        if (CHUNK_TAGS.includes(ev.type)) {
            hasChunkRows = true;
            for (const sub of decodeStorageLine(ev)) {
                layout.push({ kind: 'event', idx: events.length });
                events.push(sub);
            }
            continue;
        }
        // 无 seq/seq 非整数的行（checkpoint/边界等宿主写入的非事件行）原样保留、不参与判定
        if (typeof ev?.seq !== 'number' || !Number.isInteger(ev.seq) || ev.seq < 0) {
            layout.push({ kind: 'raw', line: lines[i] });
            continue;
        }
        for (const sub of decodeStorageLine(ev)) {
            layout.push({ kind: 'event', idx: events.length });
            events.push(sub);
        }
    }
    const contiguous = events.every((ev, i) => ev.seq === i);
    if (contiguous)
        return { repaired: false, content, events: events.length };
    /** 输出按宿主布局：有聚合行时按 packEventRows 重打包，无聚合行时按 layout 原样保留 */
    const emitRows = (evs, limit) => {
        if (hasChunkRows)
            return packEventRows(evs);
        const out = [];
        for (const slot of layout) {
            if (slot.kind === 'raw') {
                out.push(slot.line);
                continue;
            }
            if (limit !== undefined && slot.idx >= limit)
                continue;
            out.push(JSON.stringify(evs[slot.idx]));
        }
        return out;
    };
    // I8-4：回绕检测——第一次出现 ev.seq < i（期望值）的位置 = 重复段起点。
    // 截到最后连续前缀 + 合成 interrupted turn/end（不重编号、不 remap——保留语义）。
    let wrapAt = -1;
    for (let i = 0; i < events.length; i++) {
        if (events[i].seq < i) {
            wrapAt = i;
            break;
        }
    }
    // 【实机复现修复 2026-09-05】重编号可映射性守卫：surfaceOp replace 范围与
    // sourceEventSeqs 引用必须落在当前事件集内（≤ 最大 seq）。悬空引用（如逻辑回退
    // 标记 replace [23,127] 的 end=127 超出重编号后事件集）会让重编号产物被 gateway
    // committed-region 校验以 "expected <悬空值>" 拒载——此时一律改走截断路径。
    const maxSeq = events.length > 0 ? events[events.length - 1].seq : -1;
    const refsRemappable = events.every(ev => {
        const op = ev.surfaceOp;
        if (op !== null && typeof op === 'object' && op.op === 'replace') {
            const o = op;
            if (typeof o.start === 'number' && (o.start < 0 || o.start > maxSeq))
                return false;
            if (typeof o.end === 'number' && (o.end < 0 || o.end > maxSeq))
                return false;
        }
        if (Array.isArray(ev.sourceEventSeqs)) {
            return ev.sourceEventSeqs.every(s => typeof s !== 'number' || (s >= 0 && s <= maxSeq));
        }
        return true;
    });
    // 单调缺号但有悬空引用 = 同样按回绕截断处理（gap 起点改为第一处 seq !== i）
    if (wrapAt < 0 && !refsRemappable) {
        for (let i = 0; i < events.length; i++) {
            if (events[i].seq !== i) {
                wrapAt = i;
                break;
            }
        }
    }
    // 【审查修复 2026-09-05】kept 必须是首个 seq !== i 之前的最长连续前缀
    //（不能是 events.slice(0, wrapAt)——若 wrapAt 前已有缺号，kept 仍不连续）
    let kept = [];
    if (wrapAt > 0) {
        for (let i = 0; i < wrapAt; i++) {
            if (events[i].seq !== i)
                break;
            kept.push(events[i]);
        }
    }
    if (kept.length > 0) {
        const truncated = events.length - kept.length;
        // 合成 interrupted turn/end（0.1.2 torn-tail 修复同款语义：让 loader 认可截尾点）
        const lastKept = kept[kept.length - 1];
        const lastTurn = (() => {
            for (let i = kept.length - 1; i >= 0; i--) {
                const d = kept[i].data;
                if (kept[i].type === 'turn/start' && typeof d?.turn === 'number')
                    return d.turn;
            }
            return undefined;
        })();
        const needsCloser = lastKept?.type !== 'turn/end' && lastTurn !== undefined;
        const out = [JSON.stringify(header), ...emitRows(kept, kept.length)];
        if (needsCloser) {
            out.push(JSON.stringify({
                type: 'turn/end',
                seq: kept.length,
                time: Date.now(),
                data: { turn: lastTurn, reason: { kind: 'interrupted' } },
                source: { kind: 'plugin', plugin: 'dsht-rp', seqRepair: 'truncate-wraparound' },
            }));
        }
        return {
            repaired: true,
            content: out.join('\n') + '\n',
            events: kept.length + (needsCloser ? 1 : 0),
            truncated,
            note: `回绕型 seq gap（重复段）——截到最后连续前缀 ${kept.length} 事件${needsCloser ? ' + 合成 interrupted turn/end' : ''}，丢弃 ${truncated} 个重复/损坏事件`,
        };
    }
    // 单调缺号（ev.seq > i）且引用全部可映射：重编号修复（旧行为；守卫见上）
    // old→new 映射（重号时后出现的覆盖——seq 唯一化以行序为准）
    if (!refsRemappable) {
        return { repaired: false, content, events: events.length, error: '悬空引用且无连续前缀可截（首个事件即异常）——需人工处理' };
    }
    const seqMap = new Map();
    events.forEach((ev, i) => seqMap.set(ev.seq, i));
    const remap = (v) => typeof v === 'number' && seqMap.has(v) ? seqMap.get(v) : v;
    events.forEach((ev, i) => {
        ev.seq = i;
        const op = ev.surfaceOp;
        if (op !== null && typeof op === 'object') {
            const o = op;
            if (typeof o.start === 'number')
                o.start = remap(o.start);
            if (typeof o.end === 'number')
                o.end = remap(o.end);
        }
        if (Array.isArray(ev.sourceEventSeqs)) {
            ev.sourceEventSeqs = ev.sourceEventSeqs.map(remap);
        }
    });
    // R18：按宿主打包语义 repack（聚合行重打包），产物再被网关 decode 时逐字节等价
    const out = [JSON.stringify(header), ...emitRows(events)];
    return { repaired: true, content: out.join('\n') + '\n', events: events.length, note: '单调缺号——重编号修复' };
}
/**
 * 从 agent.cordis.yml 文本抽取 persona text（`text: |-` 块；第四轮存量迁移用：
 * .agent-presets/rp-* 的 persona 正文抽进 rp.json.promptPersona）。解析失败返回 null。
 */
function extractPersonaTextFromAgentYml(yml) {
    const lines = yml.split('\n');
    const start = lines.findIndex(l => /^\s+text:\s*\|-/.test(l));
    if (start < 0)
        return null;
    // 块内容 = 后续比 `text:` 行缩进更深的行（或空行）
    const baseIndent = lines[start].match(/^\s*/)[0].length;
    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === '') {
            out.push('');
            continue;
        }
        const indent = l.match(/^\s*/)[0].length;
        if (indent <= baseIndent)
            break;
        out.push(l.slice(baseIndent + 2)); // 剥块缩进（YAML |- 块内容 = baseIndent+2 起）
    }
    const text = out.join('\n').replace(/\n+$/, '');
    return text.trim() ? text : null;
}
/**
 * 任务 2：卡设定快照消息构造（纯函数，取代 .agent-presets/rp-* 的 persona 插件注入）。
 * pre-step 对 RP 会话把 rp.json.promptPersona（过宏引擎后）作为首条 system 快照注入——
 * 与 agent preset 完全解耦：会话 header 无 agentPreset 时照常工作。
 */
/**
 * 快照残留宏中性化（turn 38 真机实测）：组装层宏引擎只展开已知宏，未知宏
 * （ST 系 {{trim}}/{{lastUserMessage}} 等）原样透传 → ASCII {{…}} 进消息后
 * DSH 插值器扫 persona 段即炸 "malformed prompt variable reference"。
 * 快照是静态上下文，残留宏对模型本就不可展开——全角化让 DSH 插值器不再碰。
 */
function neutralizeResidualMacros(text) {
    return text.includes('{{') ? text.split('{{').join('｛｛').split('}}').join('｝｝') : text;
}
function buildPersonaSnapshotMessage(text) {
    const m = {
        // role 必须 'user'（rc.8 冷启动校验 assertMessageEventShape：user/message 事件
        // 的 data.role === 'user'，'system' 会让会话打不开——真机实测）。对模型语义
        // 不变：快照注入本就是深度注入的 user 席等效形态；source.form='snapshot' 保留
        // （导出/渲染链按此识别快照）。
        role: 'user',
        content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
        source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: 'dsht-rp:persona', text: neutralizeResidualMacros(text) }] },
    };
    m.id = `dsht-rp-persona-${(0, node_crypto_1.randomUUID)()}`;
    return m;
}
/** 截断后会话内容的最后事件时间（undo 回放截断点：ts 晚于它的变量写全部回滚） */
function sessionContentMaxTime(content) {
    let max = 0;
    for (const line of content.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const ev = JSON.parse(line);
            if (typeof ev?.time === 'number' && ev.time > max)
                max = ev.time;
        }
        catch { /* 坏行跳过 */ }
    }
    return max;
}
/** P0-5 per-turn 闸门判定（dsh-worldbook inject.ts L39-42 同款）：本 step inbox 含 source.kind==='user' 的真实用户消息 */
function hasDirectUserInput(messages) {
    return (messages ?? []).some(m => m?.source?.kind === 'user');
}
/** 步骤 1：正则 prompt 时机跑本批消息（user→USER_INPUT、assistant→AI_OUTPUT placement） */
function applyPromptRegexes(messages, scripts, traceRegexHits) {
    if (scripts.length === 0)
        return messages;
    return messages.map(m => {
        if (!Array.isArray(m.content))
            return m;
        const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : null;
        if (role === null)
            return m; // system/其他角色不经正则（ST 语义：正则作用于对话消息）
        const placement = role === 'user' ? engine_ts_1.PLACEMENT.USER_INPUT : engine_ts_1.PLACEMENT.AI_OUTPUT;
        let changed = false;
        const content = m.content.map(block => {
            if (block.type !== 'text' || typeof block.text !== 'string')
                return block;
            const r = (0, engine_ts_1.runRegexScripts)(scripts, block.text, 'prompt', placement, { depth: null });
            if (r.hits.length > 0) {
                changed = true;
                for (const h of r.hits)
                    traceRegexHits.push({ scriptName: h.scriptName, count: h.count });
            }
            return { ...block, text: r.text };
        });
        return changed ? { ...m, content } : m;
    });
}
/** 步骤 2+4：WI 激活条目 → 正则（WORLD_INFO placement）+ 宏求值 + 位置分桶 */
function processActivatedEntries(activated, scripts, macroCtx, traceRegexHits) {
    const macros = new engine_ts_2.MacroEngine();
    const before = [];
    const after = [];
    const atDepth = [];
    for (const a of activated) {
        // 正则（prompt 时机，WORLD_INFO placement——ST：WI 内容也过正则）
        const rr = (0, engine_ts_1.runRegexScripts)(scripts, a.entry.content, 'prompt', engine_ts_1.PLACEMENT.WORLD_INFO, { depth: null });
        for (const h of rr.hits)
            traceRegexHits.push({ scriptName: h.scriptName, count: h.count });
        // 宏（组装期求值，§4.1.1：WI 注入时 substituteParams）
        const mr = macros.evaluate(rr.text, macroCtx);
        const content = mr.text;
        if (a.entry.position === 4) {
            atDepth.push({ depth: a.entry.depth, role: a.entry.role, content, comment: a.entry.comment });
        }
        else if (a.entry.position === 1) {
            after.push({ comment: a.entry.comment, content, reason: a.reason });
        }
        else {
            // position 0（顶部）与其余兜底进 BEFORE
            before.push({ comment: a.entry.comment, content, reason: a.reason });
        }
    }
    return { before, after, atDepth };
}
/** 步骤 3：深度注入 splice（depth N = 从批末尾往前数第 N 位之前插入；同深度 system→user→assistant 合并）。
 * 多深度必须从深到浅处理——浅的先插会让深度的锚点漂移。
 * 消息契约（DSH Message）：id + source 必填——缺 source 会在 turn 建立时读 source.kind 崩溃。 */
function spliceDepthInjections(messages, atDepth) {
    if (atDepth.length === 0)
        return messages;
    const out = [...messages];
    const roleRank = { system: 0, user: 1, assistant: 2 };
    const byDepth = new Map();
    for (const inj of atDepth) {
        const list = byDepth.get(inj.depth) ?? [];
        list.push(inj);
        byDepth.set(inj.depth, list);
    }
    for (const [depth, list] of [...byDepth.entries()].sort((a, b) => b[0] - a[0])) {
        list.sort((a, b) => (roleRank[a.role] ?? 0) - (roleRank[b.role] ?? 0));
        const merged = list.map(l => l.content).join('\n');
        const insertAt = Math.max(0, out.length - depth);
        const clean = neutralizeResidualMacros(merged);
        const injected = {
            role: 'user', // 同快照注入：rc.8 校验 user/message 的 role 必须 'user'
            content: [{ type: 'text', text: clean }],
            // 【⑧审查修复 2026-09-06】form:'snapshot' + 签名节：同签名旧副本被 planShadowOps
            // 影子化（原实现无 form，常驻条目每轮一份副本逐轮堆积在历史里）
            source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: `dsht-rp:wi-depth:${depth}`, text: clean }] },
            id: `dsht-rp-depth-${(0, node_crypto_1.randomUUID)()}`,
        };
        out.splice(insertAt, 0, injected);
    }
    return out;
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
function collectVariantGroups(events) {
    const groups = new Map();
    const eventBySeq = new Map(events.map(e => [e.seq, e]));
    const textOf = (ev) => {
        if (ev.type === 'assistant/message') {
            const d = ev.data;
            return (d?.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
        }
        return '';
    };
    for (const ev of events) {
        if (ev.type !== 'assistant/message')
            continue;
        const op = ev.surfaceOp;
        if (op === undefined || op === 'append')
            continue;
        // replace：找前驱组（被替换者可能本身就是链成员）
        const prevSeq = ev.sourceEventSeqs?.[0] ?? op.start;
        const prevGroup = groups.get(prevSeq);
        if (prevGroup) {
            prevGroup.members.push({ seq: ev.seq, text: textOf(ev) });
            prevGroup.activeSeq = ev.seq;
            groups.set(ev.seq, prevGroup);
        }
        else {
            const g = {
                members: [
                    { seq: prevSeq, text: textOf(eventBySeq.get(prevSeq) ?? { type: '', seq: prevSeq }) },
                    { seq: ev.seq, text: textOf(ev) },
                ],
                activeSeq: ev.seq,
            };
            groups.set(prevSeq, g);
            groups.set(ev.seq, g);
        }
    }
    // 【⑤修复 2026-09-05】regenerate 的逻辑回退标记（user/message replace）遮蔽了旧回复段——
    // collectVariantGroups 扫描时包含被遮蔽的旧回复（surfaceOp replace 的 start/end 范围内的
    // assistant/message），否则 regenerate 后 variant/switch 回旧回复必报 "target not in any variant group"
    for (const ev of events) {
        if (ev.type !== 'user/message')
            continue;
        const op = ev.surfaceOp;
        if (op === undefined || op === 'append' || typeof op !== 'object')
            continue;
        const s = ev.data?.source;
        if (s === undefined)
            continue;
        const anchor = typeof s.regeneratedFrom === 'number' ? s.regeneratedFrom : (typeof s.rolledBackTo === 'number' ? s.rolledBackTo : undefined);
        if (anchor === undefined)
            continue;
        // 被遮蔽段 [start, end] 内的 assistant/message 加入变体组（anchor 为前驱）
        for (let q = op.start ?? 0; q <= (op.end ?? 0); q++) {
            const shadowed = eventBySeq.get(q);
            if (shadowed?.type !== 'assistant/message')
                continue;
            const prevGroup = groups.get(anchor);
            if (prevGroup) {
                prevGroup.members.push({ seq: q, text: textOf(shadowed) });
                groups.set(q, prevGroup);
            }
            else {
                const g = {
                    members: [
                        { seq: anchor, text: textOf(eventBySeq.get(anchor) ?? { type: '', seq: anchor }) },
                        { seq: q, text: textOf(shadowed) },
                    ],
                    activeSeq: anchor,
                };
                groups.set(anchor, g);
                groups.set(q, g);
            }
        }
    }
    return groups;
}
/**
 * 切换变体的写入载荷：append 一条 assistant/message（replace 当前 active，内容=目标变体文本）。
 * 返回 null 表示无需切换（目标即 active）。
 */
function buildVariantSwitchEvent(sessionId, nextSeq, activeSeq, targetText) {
    if (!targetText.trim())
        return null;
    return {
        type: 'assistant/message',
        seq: nextSeq,
        time: Date.now(),
        data: {
            turn: 1,
            step: 1,
            message: {
                id: `dsht-variant-${sessionId}-${nextSeq}`,
                role: 'assistant',
                content: [{ type: 'text', text: targetText }],
                source: { kind: 'model', provider: 'dsht-variant', model: 'user-switch' },
            },
        },
        surfaceOp: { op: 'replace', start: activeSeq, end: activeSeq },
        sourceEventSeqs: [activeSeq],
    };
}
/**
 * lore_query 搜索（T1.8 轻 agent 世界书深查）：条目名/关键词/内容全文匹配，
 * 返回前 maxEntries 条（内容截断）。纯函数可单测。
 */
function searchLoreEntries(entries, query, opts = {}) {
    const max = opts.maxEntries ?? 6;
    const cut = opts.maxContentChars ?? 1200;
    const q = query.trim().toLowerCase();
    if (!q)
        return 'Empty query.';
    const hits = [];
    for (const entry of entries) {
        const comment = (entry.comment ?? '').toLowerCase();
        const keys = entry.keys.map(k => k.toLowerCase()).join(' ');
        const content = entry.content.toLowerCase();
        let score = 0;
        if (comment.includes(q))
            score += 3;
        if (keys.includes(q))
            score += 5;
        if (content.includes(q))
            score += 1;
        if (score > 0)
            hits.push({ entry, score });
    }
    if (hits.length === 0) {
        return `No worldbook entry matches "${query}". The lore may use different wording — try the exact name or term from the story.`;
    }
    hits.sort((a, b) => b.score - a.score);
    const parts = hits.slice(0, max).map(({ entry }) => {
        const head = entry.comment ? `## ${entry.comment}` : `## (unnamed entry)`;
        const keys = entry.keys.length > 0 ? `\nKeys: ${entry.keys.slice(0, 8).join(', ')}` : '';
        const body = entry.content.length > cut
            ? `${entry.content.slice(0, cut)}\n…(truncated, ${entry.content.length} chars total)`
            : entry.content;
        return `${head}${keys}\n\n${body}`;
    });
    return [
        `Worldbook query "${query}" — ${hits.length} match(es), showing ${Math.min(max, hits.length)}:`,
        '',
        ...parts,
    ].join('\n');
}
/** 从 cwd 提取 RP 工作区段（$DSH_HOME/rp/<slug> → slug；非 RP 返回 null） */
function rpSlugFromCwd(cwd, dshHome) {
    if (!cwd)
        return null;
    const prefix = `${normAndroidPath(dshHome)}/rp/`;
    const normalized = normAndroidPath(cwd);
    if (!normalized.startsWith(prefix))
        return null;
    const slug = normalized.slice(prefix.length);
    if (!slug || slug.includes('/'))
        return null;
    return slug;
}
/** T3.1b 兜底：从 rp.json 可得的字段重建 ST V2 JSON（仅旧工作区无 card.json 时用） */
function buildStV2FromRp(rp) {
    const data = {
        name: rp.characterName,
        description: '',
        personality: '',
        scenario: '',
        first_mes: rp.firstMes ?? '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: [],
        creator: '',
        character_version: '',
        extensions: {
            regex_scripts: Array.isArray(rp.regex) ? rp.regex : undefined,
        },
    };
    const root = { spec: 'chara_card_v2', spec_version: '2.0', data };
    return JSON.stringify(root, null, 1);
}
/** T3.1b：从 ST 卡 JSON 提取卡名（导出文件名用） */
function rpNameFrom(json) {
    try {
        const root = JSON.parse(json);
        const name = root.data?.name ?? root.name;
        if (typeof name === 'string' && name.trim())
            return name.trim();
    }
    catch { /* 坏 JSON */ }
    return 'character';
}
// ---------------------------------------------------------------------------
// R0/R4：导入批次暂存 + API 配置导入（纯逻辑，可单测）
// ---------------------------------------------------------------------------
/** FNV-1a → base36 短哈希（批次 id 用；与 dsh-export.hash36 同款算法） */
function fnv36(input) {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}
/** 批次 id：时间戳 base36 + 文件名短哈希（rp-import/<batchId>/） */
function makeBatchId(name, now = Date.now()) {
    return `${now.toString(36)}-${fnv36(name)}`;
}
/** batchId 合法性（防路径逃逸） */
function isValidBatchId(id) {
    return /^[a-z0-9][a-z0-9-]{0,60}$/.test(id);
}
/**
 * rp 预设 id → DSH agent preset 目录名。
 * DSH discovery 只认 PRESET_ID（/^[a-z0-9][a-z0-9-]*$/）命名的目录；rp 预设 id
 * 允许 CJK/emoji/空格（UI 识别面，如「st-V1.4 [轻量] 狐狐~ 🦊-pqmfsq」）——
 * 不净化直同步的目录 discovery 直接跳过（R5 实测坑：st-* 永不入 agent preset 列表）。
 * fnv 短哈希后缀保证净化后唯一且稳定（幂等覆盖）。
 */
function agentPresetDirId(presetId) {
    const safe = presetId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/^-+|-+$/g, '');
    const base = safe === '' ? 'preset' : safe;
    const head = /^[a-z0-9]/.test(base) ? base : `p-${base}`;
    return `${head}-${fnv36(presetId).slice(0, 6)}`;
}
/**
 * 解压 zip 到目标目录。返回解压文件数。
 * 性能路径（2026-09-04）：Android 上优先 busybox unzip 流式解压（子进程直接读
 * source.zip 文件，node 进程零大内存占用）——JSZip.loadAsync 要整包持有 + 逐
 * entry 在 V8 堆里解，505MB 级数据包在 4GB 手机/模拟器上 swap 抖动卡死（实测
 * 11087/14460 停滞 15 分钟）。PC/无 busybox 环境回退 JSZip（PC 内存充裕）。
 * 安全：busybox unzip 自带 zip-slip 防护（-d 目标约束）；回退路径跳过目录项、
 * 绝对路径与 .. 逃逸段；canonical 越界二次防御。
 */
async function unpackZipTo(sourceZip, destDir) {
    const nativeLib = process.env.DSHT_NATIVE_LIB_DIR ?? '';
    if (nativeLib) {
        const busybox = (0, node_path_1.join)(nativeLib, 'libbusybox.so');
        try {
            await (0, promises_1.access)(busybox);
            await (0, promises_1.mkdir)(destDir, { recursive: true });
            await new Promise((resolve, reject) => {
                const child = (0, node_child_process_1.spawn)(busybox, ['unzip', '-o', '-q', sourceZip, '-d', destDir], { stdio: ['ignore', 'ignore', 'pipe'] });
                let errTail = '';
                child.stderr?.on('data', (d) => { errTail = (errTail + d.toString()).slice(-300); });
                child.on('error', reject);
                child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`busybox unzip exit ${code}: ${errTail}`)));
            });
            let count = 0;
            const walk = async (dir) => {
                for (const d of await (0, promises_1.readdir)(dir, { withFileTypes: true })) {
                    const abs = (0, node_path_1.join)(dir, d.name);
                    if (d.isDirectory())
                        await walk(abs);
                    else
                        count++;
                }
            };
            await walk(destDir);
            console.log(`[dsht-rp] unpack: busybox unzip 流式完成（${count} 文件，node 零大内存占用）`);
            return count;
        }
        catch (e) {
            console.warn(`[dsht-rp] busybox unzip 失败，回退 JSZip：${e.message}`);
        }
    }
    const zip = await jszip_1.default.loadAsync(await (0, promises_1.readFile)(sourceZip));
    const destRoot = (0, node_path_1.resolve)(destDir);
    let count = 0;
    for (const [rel, entry] of Object.entries(zip.files)) {
        if (entry.dir)
            continue;
        const segs = rel.split('/').filter(s => s.length > 0);
        if (segs.length === 0 || segs.some(s => s === '.' || s === '..'))
            continue;
        const abs = (0, node_path_1.join)(destDir, ...segs);
        if (!(0, node_path_1.resolve)(abs).startsWith(destRoot + node_path_1.sep))
            continue;
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(abs), { recursive: true });
        await (0, promises_1.writeFile)(abs, await entry.async('nodebuffer'));
        count++;
    }
    return count;
}
const countDirFiles = async (dir, match, depth = 2) => {
    let n = 0;
    const walk = async (d, lv) => {
        if (lv > depth)
            return;
        let entries;
        try {
            entries = await (0, promises_1.readdir)(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (e.isDirectory()) {
                await walk((0, node_path_1.join)(d, e.name), lv + 1);
                continue;
            }
            if (match(e.name))
                n++;
        }
    };
    await walk(dir, 0);
    return n;
};
async function scanImportManifest(unpackedDir) {
    const stRoot = await (0, import_preview_ts_1.findStDataRoot)(unpackedDir);
    if (stRoot) {
        const [cards, books, chats, presets] = await Promise.all([
            // 角色卡只计顶层文件（characters/<角色>/ 子目录是表情差分图，不是卡）
            countDirFiles((0, node_path_1.join)(stRoot, 'characters'), n => /\.(png|json)$/i.test(n), 0),
            countDirFiles((0, node_path_1.join)(stRoot, 'worlds'), n => /\.json$/i.test(n), 0),
            countDirFiles((0, node_path_1.join)(stRoot, 'chats'), n => /\.jsonl$/i.test(n), 2),
            countDirFiles((0, node_path_1.join)(stRoot, 'OpenAI Settings'), n => /\.json$/i.test(n) && !/\.luker-state\./i.test(n), 0),
        ]);
        return { kind: 'st-data', cards, books, chats, presets, stRoot: (0, node_path_1.relative)(unpackedDir, stRoot).replaceAll(node_path_1.sep, '/') || '.' };
    }
    // raw 单文件批次（单卡/单书）：unpacked/inbox/<name>
    const inbox = (0, node_path_1.join)(unpackedDir, 'inbox');
    let names = [];
    try {
        names = await (0, promises_1.readdir)(inbox);
    }
    catch { /* 无 inbox */ }
    const file = names.find(n => /\.(png|json)$/i.test(n));
    if (!file)
        return { kind: 'unknown', cards: 0, books: 0, chats: 0, presets: 0, stRoot: null };
    let kind = 'unknown';
    if (/\.png$/i.test(file)) {
        kind = 'single-card';
    }
    else {
        // JSON 头判型：chara_card spec / data.name → 卡；entries → 世界书
        try {
            const head = (await (0, promises_1.readFile)((0, node_path_1.join)(inbox, file), 'utf8')).slice(0, 4096);
            if (/"spec"\s*:\s*"chara_card|"mes_example"\s*:|"first_mes"\s*:/.test(head))
                kind = 'single-card';
            else if (/"entries"\s*:/.test(head))
                kind = 'single-book';
        }
        catch { /* 读不了按 unknown */ }
    }
    return {
        kind,
        cards: kind === 'single-card' ? 1 : 0,
        books: kind === 'single-book' ? 1 : 0,
        chats: 0, presets: 0, stRoot: null,
        singleFile: `inbox/${file}`,
    };
}
/** ST secrets.json 条目取值：新版是 [{value, active}] 数组（active 优先），旧版是裸字符串 */
function pickSecret(secrets, key) {
    const raw = secrets[key];
    if (typeof raw === 'string')
        return raw.trim() || null;
    if (Array.isArray(raw)) {
        const entries = raw.filter(e => e && typeof e === 'object');
        const active = entries.find(e => e.active === true) ?? entries[0];
        const v = active?.value;
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    return null;
}
function parseStApiConfig(settings, secrets) {
    const oai = (settings.oai_settings && typeof settings.oai_settings === 'object'
        ? settings.oai_settings : {});
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    // 主来源：chat_completion_source；缺失时 main_api=openai → openai chat completions
    const source = str(oai.chat_completion_source)
        || (str(settings.main_api) === 'openai' ? 'openai' : str(settings.main_api))
        || 'custom';
    let provider = 'st-custom';
    let baseURL;
    let model = '';
    let keyName = 'api_key_custom';
    if (source === 'custom') {
        baseURL = str(oai.custom_url) || undefined;
        model = str(oai.custom_model);
        keyName = 'api_key_custom';
    }
    else if (source === 'openai') {
        provider = 'openai';
        baseURL = str(oai.reverse_proxy) || undefined;
        model = str(oai.openai_model);
        keyName = 'api_key_openai';
    }
    else if (source === 'deepseek') {
        provider = 'deepseek';
        model = str(oai.deepseek_model);
        keyName = 'api_key_deepseek';
    }
    else if (source === 'claude') {
        provider = 'anthropic';
        model = str(oai.claude_model);
        keyName = 'api_key_claude';
    }
    else {
        // 未识别来源：有 custom_url 就按 OpenAI 兼容端点处理
        baseURL = str(oai.custom_url) || str(oai.reverse_proxy) || undefined;
        model = str(oai.custom_model) || str(oai.openai_model);
    }
    if (!model)
        return null;
    const keyRef = `ST_${source.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    const keyValue = pickSecret(secrets, keyName);
    // 非目录路由（st-custom）：必须显式声明协议与模型清单（llm-pi-ai 校验"可服务"）
    const profile = provider === 'st-custom'
        ? {
            apiKeyEnv: keyRef,
            displayName: `ST 迁移（${source}）`,
            api: 'openai-completions',
            ...(baseURL ? { baseURL } : {}),
            models: [{ id: model, name: model }],
        }
        : { apiKeyEnv: keyRef, ...(baseURL ? { baseURL } : {}) };
    return { provider, baseURL, model, keyRef, keyValue, profile, source };
}
/** 把快照消息追加到 enter decision 批次（官方 runtime-context 同款位置：claimed 之后） */
function withSnapshot(decision, snapshotText) {
    const snapshotMessage = {
        role: 'user',
        content: [{ type: 'text', text: snapshotText }],
        source: {
            kind: 'plugin',
            plugin: exports.name,
            form: 'snapshot',
            // sections 结构由官方 ContextFormed 契约定义（快照分节署名）
            sections: [{ name: 'dsht-rp:worldinfo', text: neutralizeResidualMacros(snapshotText) }],
        },
    };
    snapshotMessage.id = `dsht-rp-${(0, node_crypto_1.randomUUID)()}`;
    return { kind: decision.kind, messages: [...decision.messages, snapshotMessage] };
}
function apply(ctx, _config) {
    // DSH home 解析与官方 resolveDshHome 同优先级：$DSH_HOME > ~/
    // .dsh（Windows 上 os.homedir() 读 USERPROFILE 不读 HOME——Android 的
    // NodeService 与 PC 验证环境都设 DSH_HOME，两边一致）
    const envHome = process.env.DSH_HOME?.trim();
    const dshHome = envHome ? (0, node_path_1.resolve)(envHome) : (0, node_path_1.join)((0, node_os_1.homedir)(), '.dsh');
    /** 快照去重：上次注入文本相同则跳过（官方 RuntimeContextProjection 同语义） */
    const retained = new WeakMap();
    /** 组装 trace（T1.5）：sessionId → 最近一轮 trace，/dsht-rp/trace 暴露 */
    const lastTrace = new Map();
    /** lore.json 缓存（路径 → 条目集；迁移数据不变，进程内缓存足够） */
    const bookCache = new Map();
    /** T2.8：全局正则缓存（$DSH_HOME/rp/regex/global.json；管理面板保存时失效） */
    let globalRegexCache = null;
    /** 嵌入版导入中心静态资产（插件安装目录 assets/；index.js 在 lib/ 下 → ../assets/） */
    const readAsset = (name) => {
        try {
            return (0, node_fs_2.readFileSync)(new URL(`../assets/${name}`, import.meta.url), 'utf8');
        }
        catch {
            return null;
        }
    };
    /** 最近插件日志尾部（诊断面板用；环形缓存避免无限增长） */
    const pluginLogTail = [];
    const logLine = (line) => {
        pluginLogTail.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`);
        if (pluginLogTail.length > 200)
            pluginLogTail.splice(0, pluginLogTail.length - 200);
    };
    // ---- I8-6（移动端鲁棒性）：live 会话登记 + 主动耐久通道。
    // Android onPause/onTrimMemory 无法直调 node 内部 → 壳侧写 $DSH_HOME/flush-request
    // 触发文件，本侧 1s 轮询消费后全量 flush；另加 5s 周期 flush 兜底（把 200ms 批写
    // 窗口的崩溃丢失风险收敛到 5s）。registerLiveSession 在 pre-step 登记活跃 session。
    const liveSessionRegistry = new Map();
    const registerLiveSession = (sid, session) => {
        if (sid)
            liveSessionRegistry.set(sid, session);
    };
    /** 【审查修复 2026-09-05】会话关闭/会话不可达时清理 registry（防止只增不减） */
    const pruneLiveSessionRegistry = () => {
        for (const [sid, session] of liveSessionRegistry) {
            const live = ctx.sessions?.get?.(sid);
            if (live === undefined || live !== session)
                liveSessionRegistry.delete(sid);
        }
    };
    const flushAllLiveSessions = async (reason) => {
        pruneLiveSessionRegistry();
        let ok = 0;
        for (const [sid, session] of liveSessionRegistry) {
            try {
                if (await flushLiveSession(ctx.sessions, session))
                    ok++;
            }
            catch (e) {
                logLine(`flush-all(${reason}): ${sid} 失败：${e.message}`);
            }
        }
        return ok;
    };
    const flushTimer = setInterval(() => { void flushAllLiveSessions('periodic'); }, 5_000);
    flushTimer.unref?.();
    process.once('SIGTERM', () => { void flushAllLiveSessions('sigterm'); });
    process.once('SIGINT', () => { void flushAllLiveSessions('sigint'); });
    const flushRequestPath = (0, node_path_1.join)(dshHome, 'flush-request');
    let flushRequestBusy = false;
    const flushRequestPoller = setInterval(() => {
        if (flushRequestBusy)
            return;
        flushRequestBusy = true;
        void (0, promises_1.stat)(flushRequestPath).then(async () => {
            const n = await flushAllLiveSessions('android');
            try {
                await (0, promises_1.rm)(flushRequestPath, { force: true });
            }
            catch { /* 清理失败下次再删 */ }
            logLine(`flush-all(android): ${n} 个 live 会话已耐久`);
        }).catch(() => { }).finally(() => { flushRequestBusy = false; });
    }, 1_000);
    flushRequestPoller.unref?.();
    // ---- I8-7（观测）：coordinator 告警转发——持久化层的「background write ... failed
    // (buffered events retained)」/ seq gap 告警只进 stdout（Android 上仅 logcat 可见，
    // 插件日志页盲区）。同进程 = 拦 process.stdout/stderr 写入，命中告警样式即镜像进
    // logLine 环（诊断面板可见）。全局只装一次（插件重载不重复挂）。
    currentRuntimeLogLine = logLine;
    const gStd = globalThis;
    if (!gStd.__dshtStdoutPatched) {
        gStd.__dshtStdoutPatched = true;
        const COORD_RE = /background write .*failed|buffered events retained|seq gap|SessionPersistence|corrupt session log/i;
        for (const streamName of ['stdout', 'stderr']) {
            const stream = process[streamName];
            const orig = typeof stream?.write === 'function' ? stream.write.bind(stream) : null;
            if (!orig || !stream)
                continue;
            stream.write = (...args) => {
                try {
                    const s = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
                    if (COORD_RE.test(s))
                        currentRuntimeLogLine?.(`[runtime ${streamName}] ${s.trim().slice(0, 300)}`);
                }
                catch { /* 观测失败不影响原通道 */ }
                return orig(...args);
            };
        }
    }
    /** T2.11：数据面诊断（替代 Android getDiag 桥——node 侧直接汇总） */
    const diagSnapshot = async () => {
        let workspaces = 0, skills = 0, sessions = 0;
        try {
            const rpDir = (0, node_path_1.join)(dshHome, 'rp');
            const dirs = await (0, promises_1.readdir)(rpDir).catch(() => []);
            for (const d of dirs) {
                try {
                    if (JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpDir, d, 'rp.json'), 'utf8')))
                        workspaces++;
                }
                catch { /* 非工作区目录 */ }
            }
        }
        catch { /* 无 rp 目录 */ }
        try {
            skills = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'skills')).catch(() => [])).length;
        }
        catch { /* 无 */ }
        try {
            sessions = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'sessions')).catch(() => [])).length;
        }
        catch { /* 无 */ }
        return {
            state: 'RUNNING',
            portOpen: true,
            port: ctx.webServer?.host === '0.0.0.0' ? 'LAN' : 3080,
            dshHome,
            workspaces,
            skills,
            sessions,
            lastError: null,
            output: pluginLogTail.slice(-15),
        };
    };
    /** host 进程内 loopback /api 信封调用（import-kickoff 与 register-workspaces 回退路径共用） */
    // @adapt contract:wire.auth-cookie
    // 0.1.2 token 鉴权（dsh-client-connection fence）：/api RPC 全部要求 30 天签名
    // cookie（仅 index 的 ?token= 交换会种 cookie）——node 进程内 loopback 调用没有
    // 浏览器 cookie，不处理则 kickoff/续跑/编辑重发全 401（真机 v114 实证）。
    // 解法：inject 'connection' 拿 launchToken → 自走一次 token 交换（GET /?token=，
    // redirect manual）收 set-cookie 缓存 → hostRpc 全部带 Cookie 头；401 时清缓存
    // 重交换一次再试。旧版 DSH 无 fence：裸调照常（ensureAuthCookie 返回 null）。
    let authCookie = null;
    const ensureAuthCookie = async () => {
        if (authCookie !== null)
            return authCookie;
        const conn = ctx.connection;
        const token = conn?.browserAuth?.launchToken;
        console.log(`[dsht-rp] auth-cookie: launchToken=${token === undefined || token === null ? 'absent' : 'present'}(${String(token ?? '').length})`);
        if (!token)
            return null;
        const port = ctx.webServer?.port ?? 3080;
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
            const sc = resp.headers.get('set-cookie') ?? '';
            const seg = sc.split(';')[0]?.trim() ?? '';
            console.log(`[dsht-rp] auth-cookie: exchange status=${resp.status} set-cookie=${sc === '' ? 'EMPTY' : `${sc.length}ch`}`);
            authCookie = seg.includes('=') ? seg : null;
        }
        catch (e) {
            console.log(`[dsht-rp] auth-cookie: exchange failed: ${e.message}`);
            authCookie = null;
        }
        return authCookie;
    };
    const hostRpc = async (method, p) => {
        const port = ctx.webServer?.port ?? 3080;
        // @adapt contract:wire-api.method-slash
        // 0.1.2 坑 #21：wire 契约变更——method 斜杠式 + payload 包 {args}（与客户端 dshRpc 同步修）
        const wire = method.replace(/\./g, '/');
        const doFetch = async (cookie) => fetch(`http://127.0.0.1:${port}/api/${wire}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(cookie !== null ? { cookie } : {}) },
            // @adapt contract:wire-api.payload-args
            body: JSON.stringify({ type: 'client-request', rpcId: `dsht-hostrpc-${Date.now()}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, method: wire, payload: { args: p } }),
        });
        let cookie = await ensureAuthCookie();
        let resp = await doFetch(cookie);
        if (resp.status === 401 && cookie !== null) {
            authCookie = null; // cookie 失效（进程重启换 token/过期）→ 重交换一次
            cookie = await ensureAuthCookie();
            resp = await doFetch(cookie);
        }
        const text = await resp.text();
        let body = {};
        try {
            body = JSON.parse(text);
        }
        catch {
            throw new Error(`${method}: HTTP ${resp.status} ${text.slice(0, 80)}`);
        }
        if (!body.result || body.result.ok === false) {
            const e = new Error(body.result?.error?.message ?? `${method} failed`);
            e.code = body.result?.error?.code;
            throw e;
        }
        return body.result.value ?? {};
    };
    /** WorkspaceRegistry 进程内直取（cordis 全局服务存储；web profile 与 host 同进程）。不可用返回 null → 回退 hostRpc */
    const getWorkspaceRegistry = () => {
        try {
            const get = ctx.get;
            const reg = typeof get === 'function' ? get.call(ctx, 'workspaceRegistry') : undefined;
            if (reg !== null && typeof reg === 'object'
                && typeof reg.create === 'function'
                && typeof reg.resolveByPath === 'function'
                && typeof reg.list === 'function') {
                return reg;
            }
        }
        catch { /* 服务未挂载（PC 验证环境/非 web profile） */ }
        return null;
    };
    /** 扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header（实现抽至共享模块 session-surgery.ts） */
    const scanSessionHeaders = () => (0, session_surgery_ts_1.scanSessionHeaders)(dshHome);
    // ---- 任务 1：会话内文件快照（dsh-tavern nativeCommits 思路；共享模块 file-snapshots.ts）----
    /** 写前快照：无 session 上下文（全局设置类拿不到锚点）跳过快照；快照失败不阻塞写操作 */
    const snapshotRpFiles = async (sessionId, relPaths) => {
        if (!sessionId || relPaths.length === 0)
            return;
        try {
            const r = await (0, file_snapshots_ts_1.snapshotBeforeWrite)(dshHome, sessionId, relPaths);
            if (r.snapshotted > 0)
                console.log(`[dsht-rp] file snapshot: ${sessionId} turn=${r.anchor} +${r.snapshotted} files`);
        }
        catch { /* 快照失败不阻塞写操作 */ }
    };
    /** 会话归属解析：slug 工作区名下的会话（多个取 session.jsonl mtime 最新者）；无 → '' */
    const sessionIdForSlug = async (slug) => {
        let best = '';
        let bestMtime = -1;
        for (const h of await scanSessionHeaders()) {
            if (rpSlugFromCwd(h.cwd, dshHome) !== slug)
                continue;
            try {
                const m = (await (0, promises_1.stat)((0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir, 'session.jsonl'))).mtimeMs;
                if (m > bestMtime) {
                    best = h.sessionId;
                    bestMtime = m;
                }
            }
            catch { /* 无 session.jsonl */ }
        }
        return best;
    };
    /** 最近活跃的 RP 会话（全局设置类写操作的归属锚点；无 → ''） */
    const latestRpSessionId = async () => {
        let best = '';
        let bestMtime = -1;
        for (const h of await scanSessionHeaders()) {
            const slug = rpSlugFromCwd(h.cwd, dshHome);
            if (slug === null || slug === '_start')
                continue;
            try {
                const m = (await (0, promises_1.stat)((0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir, 'session.jsonl'))).mtimeMs;
                if (m > bestMtime) {
                    best = h.sessionId;
                    bestMtime = m;
                }
            }
            catch { /* 无 session.jsonl */ }
        }
        return best;
    };
    /** 最近活跃的迁移适配会话（cwd 以 rp-import/_adapter 结尾；checkpoint 写前快照的归属锚点；无 → ''） */
    const latestAdapterSessionId = async () => {
        let best = '';
        let bestMtime = -1;
        for (const h of await scanSessionHeaders()) {
            // cwd 可能是 /data/user/0 symlink 形态——只比后缀，不比对绝对形态
            const cwd = (h.cwd ?? '').replaceAll(node_path_1.sep, '/');
            if (!cwd.endsWith('rp-import/_adapter'))
                continue;
            try {
                const m = (await (0, promises_1.stat)((0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir, 'session.jsonl'))).mtimeMs;
                if (m > bestMtime) {
                    best = h.sessionId;
                    bestMtime = m;
                }
            }
            catch { /* 无 session.jsonl */ }
        }
        return best;
    };
    /**
     * 存量 session cwd 修复（/data/user/0 symlink 形态 → realpath 规范形态）。
     * 幂等：只处理 sessionCwdNeedsRepair 命中的 header；live session 跳过（目录搬迁会
     * 拔掉它的落盘句柄）；projectKey 变化时先搬目录再改首行（assertStoredIdentity 契约）。
     */
    const repairSessionCwds = async () => {
        const repaired = [];
        const skipped = [];
        const errors = [];
        const headers = await scanSessionHeaders();
        for (const h of headers) {
            if (!sessionCwdNeedsRepair(h.cwd))
                continue;
            if (ctx.sessions?.get(h.sessionId) !== undefined) {
                skipped.push({ sessionId: h.sessionId, reason: 'live（下次未挂载时重跑）' });
                continue;
            }
            try {
                const canonical = await (0, promises_1.realpath)(h.cwd);
                if (canonical === h.cwd)
                    continue;
                const newLine = rewriteSessionHeaderCwd(h.firstLine, canonical);
                if (newLine === null)
                    continue;
                const root = (0, node_path_1.join)(dshHome, 'sessions');
                const targetProject = (0, dsh_export_ts_1.projectKey)(canonical);
                let moved = false;
                if (targetProject !== h.project) {
                    const targetDir = (0, node_path_1.join)(root, targetProject, h.sdir);
                    let exists = true;
                    try {
                        await (0, promises_1.stat)(targetDir);
                    }
                    catch {
                        exists = false;
                    }
                    if (exists) {
                        errors.push(`${h.sessionId}: 目标目录已存在（${targetProject}/${h.sdir}），未动`);
                        continue;
                    }
                    await (0, promises_1.mkdir)((0, node_path_1.join)(root, targetProject), { recursive: true });
                    await (0, promises_1.rename)((0, node_path_1.join)(root, h.project, h.sdir), targetDir);
                    moved = true;
                }
                // 整读单文件只发生在命中的少数待修复会话上；首行替换，事件行原样保留。
                // 【鲁棒轮收尾】原子发布 + .bak 备份（repairAllSessionSeqs 同款规范）——原裸
                // writeFile 中途被杀 = torn session.jsonl 会话打不开。
                const sessionPath = (0, node_path_1.join)(root, targetProject, h.sdir, 'session.jsonl');
                const full = await (0, promises_1.readFile)(sessionPath, 'utf8');
                const nl = full.indexOf('\n');
                await atomicWriteFile(`${sessionPath}.bak`, full);
                await atomicWriteFile(sessionPath, newLine + (nl === -1 ? '' : full.slice(nl)));
                repaired.push({ sessionId: h.sessionId, from: h.cwd, to: canonical, moved });
            }
            catch (e) {
                errors.push(`${h.sessionId}: ${e.message}`);
            }
        }
        if (repaired.length > 0 || errors.length > 0) {
            logLine(`repair-session-cwd: 修复 ${repaired.length}，跳过 ${skipped.length}，失败 ${errors.length}`);
            console.log(`[dsht-rp] repair-session-cwd: repaired=${repaired.length} skipped=${skipped.length} errors=${errors.length}`);
        }
        return { scanned: headers.length, repaired, skipped, errors };
    };
    /**
     * 存量 session seq 断号修复（/rp/repair-sessions；register-workspaces 顺带调用）。
     * 扫 sessions/<project>/<sid>/session.jsonl 校验 committed 区 seq 连续性；断号的重编号
     * （repairSessionSeqs），修复前备份 .bak。幂等：连续的直接短路。
     * live session 跳过（内存态权威，落盘文件可能被 flush 覆盖回断号态）。
     */
    // 实测：rp-import 工作区的 agent 迁移会话能长到 254MB——整读+split+逐行 parse+重建
    // 需要 3-4 倍内存，Android node 堆直接 OOM（启动即修循环崩）。超大文件跳过自动修复
    //（聊天会话远达不到此量级；import 工作区会话 seq 断号不影响聊天打开）。
    const REPAIR_MAX_FILE_BYTES = 8 * 1024 * 1024;
    const repairAllSessionSeqs = async () => {
        const repaired = [];
        const skipped = [];
        const errors = [];
        const headers = await scanSessionHeaders();
        for (const h of headers) {
            if (ctx.sessions?.get(h.sessionId) !== undefined) {
                skipped.push({ sessionId: h.sessionId, reason: 'live（关闭会话后重跑）' });
                continue;
            }
            const file = (0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir, 'session.jsonl');
            try {
                const st = await (0, promises_1.stat)(file);
                if (st.size > REPAIR_MAX_FILE_BYTES) {
                    skipped.push({ sessionId: h.sessionId, reason: `文件 ${(st.size / 1048576).toFixed(1)}MiB 超 ${REPAIR_MAX_FILE_BYTES / 1048576}MiB 上限，跳过自动修复` });
                    continue;
                }
                const content = await (0, promises_1.readFile)(file, 'utf8');
                // 双重修复：① seq 断号修复（I8-4：回绕截尾/单调重编号）；② 快照消息角色归一化（rc.8 冷启动校验要求
                // user/message 的 role === 'user'——历史快照写的是 system，会话打不开）
                const norm = (0, session_surgery_ts_1.normalizeSnapshotMessageRoles)(content);
                const r = repairSessionSeqs(norm.content);
                if (r.error) {
                    errors.push(`${h.sessionId}: ${r.error}`);
                    continue;
                }
                if (!r.repaired && norm.changed === 0)
                    continue;
                // I8-2：原子写 + I8-3：.bak 先耐久再发布正文件
                await atomicWriteFile(`${file}.bak`, content);
                await atomicWriteFile(file, r.content);
                repaired.push({ sessionId: h.sessionId, events: r.events + norm.changed });
                if (r.note)
                    console.log(`[dsht-rp] repair-sessions: ${h.sessionId} ${r.note}${r.truncated ? `（truncated=${r.truncated}）` : ''}`);
            }
            catch (e) {
                errors.push(`${h.sessionId}: ${e.message}`);
            }
        }
        if (repaired.length > 0 || errors.length > 0) {
            logLine(`repair-sessions: 修复 ${repaired.length}，跳过 ${skipped.length}，失败 ${errors.length}`);
            console.log(`[dsht-rp] repair-sessions: repaired=${repaired.length} skipped=${skipped.length} errors=${errors.length}`);
        }
        return { scanned: headers.length, repaired, skipped, errors };
    };
    /**
     * 任务 2 存量迁移（幂等；register-workspaces 顺带调用）：
     * 扫 .agent-presets/rp-*（角色卡 preset 旧形态），对每个目录：
     * 1. 对应工作区 rp/<目录名>/rp.json 缺 promptPersona 时，从 agent.cordis.yml 抽出
     *    persona 正文写进 rp.json.promptPersona（preset 目录名 = 工作区 slug，同一 dshSlug 产物）；
     * 2. 删除该 preset 目录——**除非有会话在用**：DSH 冷恢复会按 session log 解析出的
     *    preset id 重新挂载（api-proxy agentFor → composeAgent(resolveSessionPreset) →
     *    presets.resolve 抛 UnknownPresetError = agent-preset-not-found，会话打不开），
     *    被引用的目录保留并在返回里如实列出。
     * 在用判定：session.jsonl 首行 header 的 agentPreset 字段（agent-preset/selected 事件
     * 在日志体里，首行扫不到——RP 会话从不切 agent preset，header 即全部，够用）。
     */
    const migrateCardAgentPresets = async () => {
        const migrated = [];
        const removed = [];
        const keptInUse = [];
        const errors = [];
        const inUse = new Set();
        for (const h of await scanSessionHeaders()) {
            try {
                const header = JSON.parse(h.firstLine);
                if (typeof header.agentPreset === 'string')
                    inUse.add(header.agentPreset);
            }
            catch { /* 非 JSON 首行 */ }
        }
        let dirs = [];
        try {
            dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, '.agent-presets'));
        }
        catch {
            return { migrated, removed, keptInUse, errors };
        }
        for (const d of dirs.sort()) {
            if (!d.startsWith('rp-'))
                continue;
            try {
                const rpPath = (0, node_path_1.join)(dshHome, 'rp', d, 'rp.json');
                let rp = null;
                try {
                    rp = JSON.parse(await (0, promises_1.readFile)(rpPath, 'utf8'));
                }
                catch { /* 无对应工作区 */ }
                if (rp !== null && rp.schemaVersion === 1 && typeof rp.promptPersona !== 'string') {
                    let persona = null;
                    try {
                        persona = extractPersonaTextFromAgentYml(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, '.agent-presets', d, 'agent.cordis.yml'), 'utf8'));
                    }
                    catch { /* 无 agent.cordis.yml */ }
                    if (persona) {
                        rp.promptPersona = persona;
                        await (0, promises_1.writeFile)(rpPath, JSON.stringify(rp, null, 1), 'utf8');
                        migrated.push(d);
                    }
                }
                if (inUse.has(d)) {
                    keptInUse.push(d); // 会话引用未断：保留（删了重挂会炸 agent-preset-not-found）
                    continue;
                }
                await (0, promises_1.rm)((0, node_path_1.join)(dshHome, '.agent-presets', d), { recursive: true, force: true });
                removed.push(d);
            }
            catch (e) {
                errors.push(`${d}: ${e.message}`);
            }
        }
        if (migrated.length + removed.length + keptInUse.length > 0 || errors.length > 0) {
            logLine(`卡 preset 迁移: promptPersona 回填 ${migrated.length}，删除 ${removed.length}，在用保留 ${keptInUse.length}，失败 ${errors.length}`);
            console.log(`[dsht-rp] card preset migration: migrated=${migrated.length} removed=${removed.length} keptInUse=${keptInUse.length} errors=${errors.length}`);
        }
        return { migrated, removed, keptInUse, errors };
    };
    /** T2.8：全局作用域正则（ST global_scripts 对应物）。无文件 = 空集。 */
    const loadGlobalRegex = (signal) => {
        if (globalRegexCache !== null)
            return globalRegexCache;
        try {
            signal.throwIfAborted();
            // 同步读（首启一次）：小文件；失败静默空集
            const text = (0, node_fs_2.readFileSync)((0, node_path_1.join)(dshHome, 'rp', 'regex', 'global.json'), 'utf8');
            const parsed = JSON.parse(text);
            globalRegexCache = Array.isArray(parsed.scripts) ? parsed.scripts : [];
        }
        catch {
            globalRegexCache = [];
        }
        return globalRegexCache;
    };
    /** T2.3：已提取状态的 assistant 消息 id（避免多 step turn 对同一消息重复提取/重复应用 delta） */
    const stateSeen = new Set();
    /** T2.8：三源正则合并（ST getRegexScripts 语义）——全局 + 角色（rp.json.regex）+
     * 预设（rp-presets/<id>/regex.json；会话当前 presetId，无选中则空）。disabled 项排除。 */
    const presetRegexCache = new Map();
    const loadPresetRegex = async (presetId, signal) => {
        const cached = presetRegexCache.get(presetId);
        if (cached)
            return cached;
        const out = [];
        try {
            signal.throwIfAborted();
            const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', presetId, 'regex.json'), 'utf8');
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed.scripts))
                out.push(...parsed.scripts);
        }
        catch { /* 无文件或坏文件 = 空集 */ }
        presetRegexCache.set(presetId, out);
        return out;
    };
    // ---- ST 激活预设默认绑定（预设 display/prompt 正则生效的前提）----
    // ST 语义：「当前激活预设」全局生效，不按聊天绑定。导入的会话从未显式绑预设
    //（presetId 空）→ 预设正则/预设注入全哑火（悬浮球/思维链美化全在预设 display
    // 正则里）。默认源 = 最近导入批次 settings.json 的 oai_settings.preset_settings_openai
    //（导出时 ST 的激活预设名），按 displayName 匹配 rp-presets。会话显式选择恒优先。
    let activeStPresetCache;
    const resolveActiveStPresetId = async () => {
        if (activeStPresetCache !== undefined)
            return activeStPresetCache;
        activeStPresetCache = null;
        try {
            const batches = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import'))).filter(isValidBatchId).sort().reverse();
            let activeName = '';
            for (const b of batches) {
                const dir = (0, node_path_1.join)(dshHome, 'rp-import', b);
                let stRoot = 'data/default-user';
                try {
                    const meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                    if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot)
                        stRoot = meta.manifest.stRoot;
                }
                catch { /* 无 meta 用默认 */ }
                let text = '';
                try {
                    text = await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'unpacked', stRoot, 'settings.json'), 'utf8');
                }
                catch {
                    continue;
                }
                const name = JSON.parse(text)
                    .oai_settings?.preset_settings_openai;
                if (typeof name === 'string' && name.trim()) {
                    activeName = name.trim();
                    break;
                }
            }
            if (activeName) {
                const dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'));
                for (const id of dirs.sort()) {
                    try {
                        const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', id, 'preset.json'), 'utf8'));
                        if (p.displayName === activeName) {
                            activeStPresetCache = id;
                            break;
                        }
                    }
                    catch { /* 坏 preset.json 跳过 */ }
                }
                if (activeStPresetCache)
                    console.log(`[dsht-rp] ST 激活预设默认绑定：${activeName} → ${activeStPresetCache}`);
            }
        }
        catch { /* rp-import/rp-presets 不存在 = 无默认 */ }
        return activeStPresetCache;
    };
    /** 会话有效预设 = 显式选择 ?? ST 激活预设默认（prompt 组装、正则合并、/preset/state 共用） */
    const resolveSessionPresetId = async (sessionId) => {
        const st = await loadSessionState(sessionId);
        if (typeof st.presetId === 'string' && st.presetId)
            return st.presetId;
        return resolveActiveStPresetId();
    };
    const mergedRegex = async (rp, signal, sessionId) => {
        const global = loadGlobalRegex(signal);
        const scoped = rp.regex ?? [];
        const presetId = await resolveSessionPresetId(sessionId);
        const preset = presetId ? await loadPresetRegex(presetId, signal) : [];
        return [...global, ...preset, ...scoped].filter(s => !s.disabled);
    };
    // ---- T2.7：RP 预设体系（组装层关注点——session 内随时切换）----
    // 内置示范（demo.ts 编译内联）+ 用户预设（$DSH_HOME/rp-presets/<id>/preset.json）
    const builtinPresets = [(0, demo_ts_1.demoDirectPreset)(), (0, demo_ts_1.demoLightAgentPreset)()];
    const presetCache = new Map();
    /** 全部预设（内置 + 用户文件；presetId 唯一化：内置前缀 builtin/） */
    const listPresets = async (signal) => {
        const out = [...builtinPresets];
        try {
            signal.throwIfAborted();
            const dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'));
            for (const id of dirs.sort()) {
                try {
                    const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', id, 'preset.json'), 'utf8');
                    const p = JSON.parse(text);
                    if (p?.schemaVersion === 1 && p.id)
                        out.push(p);
                }
                catch { /* 坏 preset.json 跳过 */ }
            }
        }
        catch { /* 无目录 */ }
        return out;
    };
    const resolvePreset = async (presetId, signal) => {
        const cached = presetCache.get(presetId);
        if (cached)
            return cached;
        const all = await listPresets(signal);
        const hit = all.find(p => p.id === presetId) ?? null;
        if (hit)
            presetCache.set(presetId, hit);
        return hit;
    };
    // 形状保留键（与 dsht-plugin-mvu 的分权契约一致）；一个都没有 = 历史扁平 MVU 树。
    // E1/E11 补：sheets/sheetHistory/tablesMigrated（表格系统新键）与 tables/tableData
    // （ST 1.0 旧键，loadSheets 迁移源）都不是 MVU 变量——入保留集防被误判成扁平变量树
    const STATE_RESERVED_KEYS = new Set(['presetId', 'state', 'variables', 'variableSchema', 'cursor', 'loreTimed', 'sheets', 'sheetHistory', 'tablesMigrated', 'tables', 'tableData']);
    const loadSessionState = async (sessionId) => {
        try {
            const s = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8'));
            if (s.state !== undefined && (s.state === null || typeof s.state !== 'object'))
                s.state = undefined;
            // 兼容历史扁平文件（rebuild-chats 曾把 chat_metadata.variables 裸树直写文件根）：
            // 整树视作 variables（MVU 变量），/state 路由与状态摘要经 variables 兜底消费
            if (s && typeof s === 'object' && !Object.keys(s).some(k => STATE_RESERVED_KEYS.has(k))) {
                return { variables: s };
            }
            return s;
        }
        catch {
            return {};
        }
    };
    const saveSessionState = async (sessionId, state) => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, 'rp', 'state'), { recursive: true });
        // 【鲁棒轮 2026-09-09】字段级 merge 写——rp/state/<sid>.json 多写方共享（本插件 cursor/
        // presetId/loreTimed、dsht-plugin-memory sheets、MVU variables/state）。原实现整文件
        // 覆写：pre-step 在 t0 读入 → 用户 t1 切预设（写 presetId）→ pre-step t2 用 t0 旧树
        // 整文件写回 → presetId 静默丢失（下一轮回落默认预设）。改为保存前重读最新盘面合并
        // （本次写入的键优先），其余键保留最新值；原子写防撕裂。
        const path = (0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`);
        let merged = state;
        try {
            const latest = JSON.parse(await (0, promises_1.readFile)(path, 'utf8'));
            if (latest && typeof latest === 'object' && !Array.isArray(latest)) {
                merged = { ...latest, ...state };
            }
        }
        catch { /* 首写/读失败 → 整树写 */ }
        await (0, atomic_fs_ts_1.atomicWriteText)(path, JSON.stringify(merged));
    };
    /**
     * ⑧（2026-09-06 预设机制完整移植）：预设内容不再拍平成尾部 user 快照 blob。
     * - relative 条目（depth==null 的 system/configSummary/skillRef，prompt_order 保序）
     *   → system-prompt/assemble 瀑布进 request.system 顶部（ST relative 位置语义；
     *   UI「系统提示词」气泡直接可见——预设生效的用户可验证证据）；
     * - depth 条目（jailbreak 类）→ pre-step 真深度 splice（ST in-chat 注入语义）；
     * - marker/state 槽（卡文本/状态摘要）→ 下方 withStateSnapshot/withPersonaSnapshot
     *   尾部快照带承担（每轮动态内容，进 system 会让 request/header 每轮重写 + 缓存全废）。
     * 宿主硬约束：decision.messages 全部落 user/message 事件，restore 校验 role 必须 'user'
     * （assertMessageEventShape）——per-entry role 分配无法经消息通道移植，system 字段是唯一
     * 顶部通道；采样参数经 agent/request 瀑布落地（temperature/maxTokens/stop/reasoningEffort，
     * 宿主适配器仅透传此四键）。
     */
    // ---- P1#6 双轴分离：能力轴运行时权威判定（对照 dsh-agent-rp agent-capability-preset.ts
    // agentHasAgentRpRuntime L48 的双重判定——session header 的 agentPreset id + 组合源码
    // 特征；serviceFor 探测对我们不适用：能力轴挂的是宿主层按 scope 分层的 skill 注册表，
    // 组内无预设私有服务可探，见 compiler.ts isDshtRpAgentComposition 头注）----
    // 内容轴（上方快照注入）不依赖本探测结果；探测只做一次性可观测性提示，失败静默。
    const capabilityAxisSeen = new WeakMap();
    const probeCapabilityAxis = async (agent, preset) => {
        const agentPreset = agent.session.header.agentPreset;
        const key = `${preset.id}@${agentPreset ?? ''}`;
        if (capabilityAxisSeen.get(agent) === key)
            return;
        capabilityAxisSeen.set(agent, key);
        try {
            const presets = ctx.get?.('agentPresets');
            const source = agentPreset && typeof presets?.read === 'function'
                ? await presets.read(agentPreset)
                : undefined;
            if (source !== undefined && (0, compiler_ts_1.isDshtRpAgentComposition)(source)) {
                console.log(`[dsht-rp] P1#6 双轴：内容轴「${preset.displayName}」× 能力轴 agent preset「${agentPreset}」组合生效（preset-* 技能块可调用）`);
                return;
            }
            console.log(`[dsht-rp] P1#6 双轴：agent 型预设「${preset.displayName}」仅内容轴生效；技能块（skills/preset-*）需 DSH agent 预设选择「${agentPresetDirId(preset.id)}」（或保留 preset-capability 组的派生预设）才可被模型调用`);
        }
        catch { /* 探测失败不影响内容轴注入 */ }
    };
    /** T2.3：状态摘要快照消息（stateSummary 槽位的组装层填充） */
    const withStateSnapshot = (decision, summary) => {
        const m = {
            role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同 persona 快照注释）
            content: [{ type: 'text', text: neutralizeResidualMacros(summary) }],
            source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: 'dsht-rp:state', text: neutralizeResidualMacros(summary) }] },
        };
        m.id = `dsht-rp-state-${(0, node_crypto_1.randomUUID)()}`;
        return { kind: decision.kind, messages: [...decision.messages, m] };
    };
    /** 状态摘要快照去重（影子化豁免最新副本后跳过安全） */
    const retainedState = new WeakMap();
    /** 任务 2：卡设定快照消息（取代 .agent-presets/rp-* 的 persona 插件注入） */
    const withPersonaSnapshot = (decision, text) => ({ kind: decision.kind, messages: [...decision.messages, buildPersonaSnapshotMessage(text)] });
    /** 卡设定快照去重（影子化豁免最新副本后跳过安全） */
    const retainedPersona = new WeakMap();
    /** 长期记忆快照消息（user 席快照，sections 署名 dsht-rp:memory） */
    const withMemorySnapshot = (decision, text) => {
        const m = {
            role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同 persona 快照注释）
            content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
            source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: 'dsht-rp:memory', text: neutralizeResidualMacros(text) }] },
        };
        m.id = `dsht-rp-memory-${(0, node_crypto_1.randomUUID)()}`;
        return { kind: decision.kind, messages: [...decision.messages, m] };
    };
    /** 长期记忆快照去重（影子化豁免最新副本后跳过安全） */
    const retainedMemory = new WeakMap();
    /** E3：表格快照消息（user 席快照，sections 署名 dsht-memory:tables；st-memory-enhancement 表格注入同位） */
    const withTablesSnapshot = (decision, text) => {
        const m = {
            role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同记忆快照注释）
            content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
            source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: 'dsht-memory:tables', text: neutralizeResidualMacros(text) }] },
        };
        m.id = `dsht-memory-tables-${(0, node_crypto_1.randomUUID)()}`;
        return { kind: decision.kind, messages: [...decision.messages, m] };
    };
    /** E3：表格快照去重（同 retainedMemory 样例） */
    const retainedTables = new WeakMap();
    // ---- D-3：system 槽位发布器（pre-step 写、assemble 读）----
    // 为什么需要跨 hook 传递：`agent.ts:230` assemble 先于 `agent.ts:233` pre-step 执行，
    // 而角色卡/世界书/记忆/状态树的内容都在 pre-step 里算（那里能拿到会话态与快照去重）。
    // 因此 pre-step 把"本轮该进 system 的正文"发布到本表，assemble 下一 step 读走。
    // 时序无害：内容在 turn 内是常量快照（同 retainedState 系列的去重语义），
    // 首个 step 用上一轮的同内容副本，等价；turn 内任何 step 的 system 都一致。
    const slotPublished = new WeakMap();
    /**
     * D-3 开关：把系统级 RP 内容从 `user` 席位迁到 `system` 槽位。
     * 默认开（对齐 TT）；`$DSH_HOME/rp/slot-routing-OFF` 存在时关闭（回滚通道，
     * 用于 A/B 对照与线上排障——不依赖改代码即可回到旧行为）。
     */
    const SLOT_ROUTING = !(0, node_fs_2.existsSync)((0, node_path_1.join)(dshHome, 'rp', 'slot-routing-OFF'));
    /** 发布本轮 system 槽位内容（pre-step 调用） */
    const publishSlots = (agent, sections) => {
        if (!SLOT_ROUTING)
            return;
        slotPublished.set(agent, { sections });
    };
    // ---- 任务 1：快照宏展开（真运行期语义，替代"全角化了事"）----
    // 与 preset/compiler.ts neutralizePromptVariables 的职责分工见 dsht-plugin-shared/macros.ts 头注：
    // 中性化只管"写进 DSH persona 插件的文本"（防爆 turn）；这里的 {{…}} 由宏引擎真求值。
    const loadVarScopeTree = async (scope, slug, sid) => {
        try {
            if (scope === 'global') {
                const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'variables', 'global.json'), 'utf8'));
                return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
            }
            if (scope === 'character') {
                const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'variables.json'), 'utf8'));
                return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
            }
            const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', `${sid}.json`), 'utf8'));
            const v = p?.variables;
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        }
        catch {
            return {}; // 无文件/坏 JSON = 空树
        }
    };
    /**
     * 快照文本宏展开：getvar 按 chat > character > global 读；setvar 写回 chat 作用域
     *（rp/state/<sid>.json 的 variables 键）并进 undo 日志（任务 4 回滚联动）。
     */
    const expandSnapshotMacros = async (text, rp, slug, sid) => {
        if (!text.includes('{{'))
            return text;
        try {
            const identity = await (0, macros_ts_2.resolveIdentity)(dshHome, slug);
            const globalVars = await loadVarScopeTree('global', '', '');
            const charVars = slug ? await loadVarScopeTree('character', slug, '') : {};
            const chatVars = sid ? await loadVarScopeTree('chat', '', sid) : {};
            const r = (0, macros_ts_1.expandTavernMacros)(text, {
                user: identity.user || rp.macros.user || '用户',
                char: identity.char || rp.macros.char,
                persona: identity.persona,
                getVar: path => (0, macros_ts_1.readVarPath)(chatVars, path) ?? (0, macros_ts_1.readVarPath)(charVars, path) ?? (0, macros_ts_1.readVarPath)(globalVars, path),
                stableSeed: sid ? `rp-${sid}` : `rp-${slug}`,
            });
            if (r.writes.length > 0 && sid) {
                const stateFile = (0, node_path_1.join)(dshHome, 'rp', 'state', `${sid}.json`);
                let whole = {};
                try {
                    const parsed = JSON.parse(await (0, promises_1.readFile)(stateFile, 'utf8'));
                    if (parsed && typeof parsed === 'object')
                        whole = parsed;
                }
                catch { /* 新会话状态文件 */ }
                let vars = (whole.variables && typeof whole.variables === 'object' && !Array.isArray(whole.variables)
                    ? whole.variables : {});
                const undoSeq = [];
                for (const w of r.writes) {
                    undoSeq.push((0, undo_ts_1.makeUndoEntry)('chat', '', w.path, vars));
                    vars = (0, macros_ts_1.writeVarPath)(vars, w.path, w.value);
                }
                await (0, undo_ts_1.appendUndoEntries)(dshHome, sid, undoSeq);
                whole.variables = vars;
                await (0, promises_1.mkdir)((0, node_path_1.dirname)(stateFile), { recursive: true });
                await (0, promises_1.writeFile)(stateFile, JSON.stringify(whole), 'utf8');
            }
            let out = r.text;
            // E8：表格宏（{{tableData}}/{{tablePrompt}}/{{GET::表名:行:列}}）——st-memory-enhancement
            // 表格宏语义，用当前会话 sheets 渲染替换；只在快照求值链路做（不改全局宏引擎），
            // 文本含宏才读 sheets（避免每轮多一次状态文件 IO）
            if (/\{\{\s*(?:tableData|tablePrompt|GET::)/i.test(out)) {
                const { sheets } = await loadSheets(dshHome, sid);
                out = expandTableMacros(out, sheets);
            }
            if (r.unknownMacros.length > 0) {
                console.log(`[dsht-rp] macro expand: writes=${r.writes.length} unknown=${r.unknownMacros.length}（原样保留）`);
            }
            return out;
        }
        catch (e) {
            console.log(`[dsht-rp] macro expand skipped: ${e.message}`);
            return text; // 展开失败不阻塞：原文注入
        }
    };
    const loadRpJson = async (slug, signal) => {
        try {
            signal.throwIfAborted();
            const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json'), 'utf8');
            const parsed = JSON.parse(text);
            if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.books)) {
                console.log(`[dsht-rp] rp.json invalid: ${slug}`);
                return null;
            }
            return parsed;
        }
        catch (e) {
            console.log(`[dsht-rp] rp.json load failed (${slug}): ${e.message}`);
            return null;
        }
    };
    /** ⑧ 条件槽运行期求值（§4.4 声明的落地）：state/variables 树按 path 取值比较 */
    const evalSlotCondition = (cond, stateTree) => {
        if (!cond)
            return true;
        const val = cond.path.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), stateTree);
        if (cond.exists === true && val === undefined)
            return false;
        if (cond.exists === false && val !== undefined)
            return false;
        if (cond.equals !== undefined && val !== cond.equals)
            return false;
        if (cond.notEquals !== undefined && val === cond.notEquals)
            return false;
        return true;
    };
    /** ⑧ 预设机制移植的共享解析：agent → RP 工作区 + 有效预设（assemble/request 瀑布与 pre-step 共用） */
    const resolveAgentPreset = async (agent) => {
        try {
            const slug = rpSlugFromCwd(agent.session.header.cwd, dshHome);
            if (!slug)
                return null;
            const rp = await loadRpJson(slug, new AbortController().signal);
            if (!rp)
                return null;
            const sessionId = String(agent.session.id ?? '');
            const presetId = sessionId ? await resolveSessionPresetId(sessionId) : await resolveActiveStPresetId();
            if (!presetId)
                return null;
            const preset = await resolvePreset(presetId, new AbortController().signal);
            if (!preset)
                return null;
            return { slug, rp, preset, sessionId };
        }
        catch {
            return null;
        }
    };
    /** 读世界书 lore.json（$DSH_HOME 相对路径）。此前两处调用但函数缺失（ReferenceError 被吞），补齐。 */
    const loadBook = async (lorePath, signal) => {
        try {
            signal.throwIfAborted();
            const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, lorePath), 'utf8');
            const parsed = JSON.parse(text);
            // 规范化最小集（实机抓到：手写/ST 原样落盘的书用 disable 字段且无 enabled，
            // triggerWorldInfo 的 `!entry.enabled → continue` 把整本书静默跳过——关键词
            // 触发对非导入管线产出的书整体失效）。导入管线产出的书已带 enabled，不受影响。
            const entries = (Array.isArray(parsed?.entries) ? parsed.entries : []).map((e) => ({
                ...e,
                enabled: typeof e.enabled === 'boolean' ? e.enabled : !(e.disable === true || e.disabled === true),
                keys: Array.isArray(e.keys) ? e.keys : (typeof e.key === 'string' && e.key !== '' ? [e.key] : []),
                secondaryKeys: Array.isArray(e.secondaryKeys) ? e.secondaryKeys : (Array.isArray(e.keysecondary) ? e.keysecondary : []),
                // 预算排序键：raw 书缺 insertionOrder → NaN 排最末必被预算裁掉（实机 droppedByBudget=357 抓到）
                insertionOrder: typeof e.insertionOrder === 'number' ? e.insertionOrder : (typeof e.order === 'number' ? e.order : 100),
                constant: e.constant === true,
            }));
            return { entries: entries };
        }
        catch {
            return null;
        }
    };
    // ---- T2.6：欢迎工作区（新手引导 = 默认工作区里的第一条消息，用户定案）----
    const WELCOME_SLUG = '_start';
    const ensureWelcomeWorkspace = async () => {
        try {
            const startDir = (0, node_path_1.join)(dshHome, 'rp', WELCOME_SLUG);
            const rpJsonPath = (0, node_path_1.join)(startDir, 'rp.json');
            try {
                await (0, promises_1.readFile)(rpJsonPath, 'utf8');
                return; // 已存在（幂等）
            }
            catch { /* 不存在 → 首启引导 */ }
            await (0, promises_1.mkdir)(startDir, { recursive: true });
            await (0, promises_1.writeFile)(rpJsonPath, JSON.stringify({
                schemaVersion: 1,
                characterName: 'DSHTavern 向导',
                books: [],
                trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6000 },
                macros: { char: '向导', user: '' },
                firstMes: '',
            }, null, 1), 'utf8');
            await (0, promises_1.writeFile)((0, node_path_1.join)(startDir, 'README.md'), '# DSHTavern 向导\n\n新手引导工作区：本会话首条消息是上手指引；导入摘要也会出现在这里。\n', 'utf8');
            // 引导 session：首条 assistant 消息 = 上手指引（oneTurnLog 契约）
            const sessionId = 'dsht-welcome';
            const createdAt = Date.now();
            const ev = (type, seq, data, surfaceOp) => JSON.stringify({ type, seq, time: createdAt + seq, data, ...(surfaceOp !== undefined ? { surfaceOp } : {}) });
            const guide = [
                '欢迎使用 DSHTavern！开始角色扮演前的两步准备：',
                '',
                '**第一步：配置 API（导入管线的 AI 语义分类和对话都依赖它）**',
                '去 DSH **设置 → 模型** 配置：填入 DeepSeek 官方 API Key，或任意 OpenAI 兼容端点（硅基流动 / OpenRouter / vLLM 等，DSH 原生支持）。配置完再回来导入。',
                '',
                '**第二步：导入你的 SillyTavern 数据**',
                '点侧栏底部「🎭 角色扮演」→「导入」页（数据迁移）：',
                '- 📦 完整数据包（data 文件夹 zip）——角色卡/世界书/聊天记录/预设一次迁移',
                '- 🎴 角色卡（PNG/JSON）——会生成一个工作区 + 带开场白的会话',
                '- 📚 世界书（world JSON）——成为角色工作区里的知识库；附触发测试器',
                '',
                '导入完成后回到「角色」页点开角色卡即可开聊（聊天记录会作为会话历史延续）。',
                '会话顶部有 🎛 下拉可随时切换 RP 预设；「正则」页管理全局/角色正则。',
                '',
                '有什么想调整的，直接在这个会话里留言即可——祝玩得开心！',
            ].join('\n');
            const lines = [
                JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt, cwd: `rp/${WELCOME_SLUG}`, delegationDepth: 0 }),
                ev('turn/start', 0, { turn: 1 }),
                ev('step/start', 1, { turn: 1, step: 1 }),
                ev('assistant/message', 2, {
                    turn: 1, step: 1,
                    message: {
                        id: 'dsht-welcome-guide',
                        role: 'assistant',
                        content: [{ type: 'text', text: guide }],
                        source: { kind: 'model', provider: 'dshtavern', model: 'welcome' },
                    },
                }, 'append'),
                ev('step/end', 3, { turn: 1, step: 1 }),
                ev('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
            ];
            const sessionDir = (0, node_path_1.join)(dshHome, 'sessions', (0, dsh_export_ts_1.projectKey)(`rp/${WELCOME_SLUG}`), sessionId);
            await (0, promises_1.mkdir)(sessionDir, { recursive: true });
            // 【鲁棒轮收尾】原子发布（欢迎会话首建；半写文件会被幂等跳过——原子写消除该窗口）
            await atomicWriteFile((0, node_path_1.join)(sessionDir, 'session.jsonl'), lines.join('\n') + '\n');
            console.log('[dsht-rp] welcome workspace created (rp/_start + guide session)');
        }
        catch (e) {
            console.log(`[dsht-rp] welcome workspace skipped: ${e.message}`);
        }
    };
    void ensureWelcomeWorkspace();
    // ---- R0/R4/R13：迁移资产首启同步（skill + 适配工作区 preset）----
    // 分发链路与 import-center.html 同款：构建期打进插件 assets/（build-dsht.ps1
    // Step 4.7；NodeService copyPackageDir / setup-pc-verify 拷贝到 profile），
    // 运行时从这里写到 $DSH_HOME/skills/st-migration 与 .agent-presets/dsht-adapter
    // （skill-filesystem / agent-presets 的 user root 热发现）。幂等：内容相同跳过。
    const syncAssetTree = async (assetRel, dstDir) => {
        let written = 0;
        const srcRoot = new URL(`../assets/${assetRel}/`, import.meta.url);
        const walk = async (srcUrl, rel) => {
            let entries;
            try {
                entries = await (0, promises_1.readdir)(srcUrl, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const childRel = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) {
                    await walk(new URL(`${e.name}/`, srcUrl), childRel);
                    continue;
                }
                try {
                    const content = (0, node_fs_2.readFileSync)(new URL(e.name, srcUrl), 'utf8');
                    const abs = (0, node_path_1.join)(dstDir, ...childRel.split('/'));
                    let same = false;
                    try {
                        same = (await (0, promises_1.readFile)(abs, 'utf8')) === content;
                    }
                    catch { /* 不存在 */ }
                    if (same)
                        continue;
                    await (0, promises_1.mkdir)((0, node_path_1.dirname)(abs), { recursive: true });
                    await (0, promises_1.writeFile)(abs, content, 'utf8');
                    written++;
                }
                catch { /* 单文件失败不阻塞 */ }
            }
        };
        await walk(srcRoot, '');
        return written;
    };
    const ensureMigrationAssets = async () => {
        try {
            const skillN = await syncAssetTree('skills/st-migration', (0, node_path_1.join)(dshHome, 'skills', 'st-migration'));
            const presetN = await syncAssetTree('agent-presets/dsht-adapter', (0, node_path_1.join)(dshHome, '.agent-presets', 'dsht-adapter'));
            if (skillN + presetN > 0)
                console.log(`[dsht-rp] migration assets synced: st-migration=${skillN} dsht-adapter=${presetN}`);
        }
        catch (e) {
            console.log(`[dsht-rp] migration assets sync skipped: ${e.message}`);
        }
    };
    void ensureMigrationAssets();
    // ---- R5：预设体系统一（rp-presets/<id>/preset.json = 唯一编辑源；写盘时编译
    // 同步产出 DSH agent preset .agent-presets/<id>/，agent 预设界面可见 ST 迁移预设。
    // 只管理 st- 前缀（ST 预设迁移来源）——角色卡 preset（rp-<slug>）不同步覆盖/删除）----
    const AGENT_SYNC_PREFIX = 'st-';
    const syncRpPresetToAgent = async (preset) => {
        if (!preset.id.startsWith(AGENT_SYNC_PREFIX))
            return;
        // 目录名必须过 PRESET_ID（discovery 硬过滤）——raw id 含 CJK/emoji 时净化
        const dirId = agentPresetDirId(preset.id);
        // compilePreset 产出形态 = exportCardPreset 同款（persona text = 编译后 system prompt）
        const files = (0, compiler_ts_1.compilePreset)(preset, { user: '用户', char: '角色' });
        for (const f of files) {
            // preset.yml：name = displayName；description 标注同步来源（编译器默认描述无来源标注）。
            // YAML 标量必须引号化（JSON 串是合法 YAML 双引号标量）——裸写遇 [ 开头
            // （如「[Agent] V14.7 示例预设」）会被 js-yaml 当 flow collection 解析失败，
            // metadata 整体降级为空（选择器里丢显示名）。
            const content = f.path.endsWith('/preset.yml')
                ? [
                    `name: ${JSON.stringify(preset.displayName)}`,
                    `description: ${JSON.stringify(`由 RP 预设「${preset.displayName}」同步（编辑源：rp-presets/${preset.id}/preset.json —— 勿手改，表层保存后自动重新同步）`)}`,
                    `order: 100`,
                    ``,
                ].join('\n')
                : f.content;
            const abs = (0, node_path_1.join)(dshHome, f.path.replace(`.agent-presets/${preset.id}/`, `.agent-presets/${dirId}/`));
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(abs), { recursive: true });
            await (0, promises_1.writeFile)(abs, content, 'utf8');
        }
        // 旧版直用 raw id 写的目录（discovery 永不入列）清掉，避免占 id/误导
        if (dirId !== preset.id) {
            await (0, promises_1.rm)((0, node_path_1.join)(dshHome, '.agent-presets', preset.id), { recursive: true, force: true });
        }
        console.log(`[dsht-rp] R5 preset synced → .agent-presets/${dirId}（${preset.displayName}）`);
    };
    const removeRpPresetAgent = async (id) => {
        if (!id.startsWith(AGENT_SYNC_PREFIX))
            return;
        await (0, promises_1.rm)((0, node_path_1.join)(dshHome, '.agent-presets', agentPresetDirId(id)), { recursive: true, force: true });
        await (0, promises_1.rm)((0, node_path_1.join)(dshHome, '.agent-presets', id), { recursive: true, force: true }); // 旧 raw 目录一并清
    };
    // 存量迁移（幂等）：启动时扫 rp-presets/*/preset.json，缺对应 .agent-presets/<dirId>/ 的补编译；
    // P1#6：已同步但缺能力轴组（双轴分离前的旧编译形态）的 agent 型预设重编译升级。
    const ensureRpPresetSync = async () => {
        try {
            let dirs = [];
            try {
                dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'));
            }
            catch {
                return;
            }
            let synced = 0;
            for (const id of dirs.sort()) {
                if (!id.startsWith(AGENT_SYNC_PREFIX))
                    continue;
                try {
                    const preset = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', id, 'preset.json'), 'utf8'));
                    if (preset?.schemaVersion !== 1 || preset.id !== id)
                        continue;
                    const dirId = agentPresetDirId(id);
                    try {
                        const yml = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, '.agent-presets', dirId, 'agent.cordis.yml'), 'utf8');
                        // agent 型预设的旧形态（无 preset-capability 组）→ 落到补编译分支升级
                        if (preset.path === 'agent' && !(0, compiler_ts_1.isDshtRpAgentComposition)(yml)) {
                            throw new Error('stale capability axis');
                        }
                        // §2.3 ②：缺紧凑 persona 标记 = 两套规则重复的旧形态（所有路径）→ 升级
                        if (!yml.includes(compiler_ts_1.AGENT_COMPACT_PERSONA_MARKER)) {
                            throw new Error('stale full-text persona');
                        }
                        continue; // 已同步且形态当前（存在即跳过）
                    }
                    catch { /* 缺失/旧形态 → 补编译 */ }
                    await syncRpPresetToAgent(preset);
                    synced++;
                }
                catch { /* 坏 preset.json 跳过 */ }
            }
            if (synced > 0)
                console.log(`[dsht-rp] R5 preset sync backfill: ${synced} agent presets`);
        }
        catch (e) {
            console.log(`[dsht-rp] R5 preset sync backfill skipped: ${e.message}`);
        }
    };
    void ensureRpPresetSync();
    // 任务 2：启动时执行卡 preset 存量迁移（幂等）——.agent-presets/rp-* 的 persona 正文
    // 回填 rp.json.promptPersona 后删除目录（有会话引用的保留），agent 预设界面只留真预设
    void migrateCardAgentPresets();
    // ---- L1b：自定义宏启动水合（rp/macros.json → 引擎注册表；注册路由见 /macros/*）----
    void (async () => {
        try {
            const disk = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'macros.json'), 'utf8'));
            (0, macros_ts_1.hydrateCustomMacros)(disk);
            const n = Object.keys(disk).length;
            if (n > 0)
                console.log(`[dsht-rp] custom macros hydrated: ${n} 个（${Object.keys(disk).join(', ')}）`);
        }
        catch { /* 无自定义宏文件 = 正常 */ }
    })();
    // ---- P0 顺手项：repairAllSessionSeqs「启动即修窗口」----
    // host 刚起、尚无 live 会话：此刻全量 seq 修复不会因 live 跳过留下窗口
    //（/rp/repair-sessions 与 register-workspaces 对 live 会话跳过——断号会话若一直
    // live 就永远修不到）。幂等短路（seq 连续直接 continue）；超大文件有 8MiB 上限护栏。
    void repairAllSessionSeqs().then(r => {
        const n = r.repaired.length;
        if (n > 0)
            logLine(`启动即修：seq 断号修复 ${n} 个会话`);
    }).catch(e => console.log(`[dsht-rp] startup repair skipped: ${e.message}`));
    // ---- R49：重复 turn/start「启动即修」----
    // 物化 turn 计数失同步（已修源头，phase 同步）留下的存量日志：重复 turn/start 让
    // 前端 ConversationNodeAssembler 全量重放崩溃（折叠行/会话流停摆）。此处磁盘手术
    // 重编号重复段（正在 live 的会话下次重开生效——启动窗口 live 集为空，与本窗口同理）。
    void (async () => {
        let fixed = 0;
        for (const h of await scanSessionHeaders()) {
            const file = (0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir, 'session.jsonl');
            try {
                const stat0 = await (0, promises_1.stat)(file);
                if (stat0.size > 64 * 1024 * 1024)
                    continue; // 护栏与 repairAllSessionSeqs 同级
                const content = await (0, promises_1.readFile)(file, 'utf8');
                const r = (0, session_surgery_ts_1.repairDuplicateTurnStarts)(content);
                if (r.renumberedTurns === 0)
                    continue;
                await atomicWriteFile(`${file}.bak`, content);
                await atomicWriteFile(file, r.content.endsWith('\n') ? r.content : r.content + '\n');
                fixed++;
                logLine(`启动即修：重复 turn/start 重编号 ${r.renumberedTurns} 段（${r.eventsRewritten} 事件）→ ${h.sessionId}`);
            }
            catch { /* 单会话失败不阻塞其余 */ }
        }
        if (fixed > 0)
            console.log(`[dsht-rp] duplicate turn/start repaired: ${fixed} sessions`);
    })().catch(e => console.log(`[dsht-rp] turn repair skipped: ${e.message}`));
    // ---- R15：deepseek 目录模型补齐（启动时幂等）----
    // pi-ai 内建 deepseek 目录只有 deepseek-v4-flash / deepseek-v4-pro
    // （@earendil-works/pi-ai providers/data/deepseek.json），缺 vision 实验模型。
    // llm-pi-ai 契约：profile 配置 models 会整体替换内建目录（resolveRouteModels），
    // 且 settings.update 是递归 merge（数组整体覆盖、不 concat）——所以必须先读
    // 现有 models 再写回完整清单（只写 id 的条目自动继承内建目录字段）。
    const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
    const ensureDeepseekModels = async () => {
        try {
            const get = ctx.settings?.get;
            if (!ctx.settings || typeof get !== 'function') {
                // 降级：settings 服务不可读（参考 import-api-config 的 ctx.settings 判空路径）——
                // 无法安全合并 models（盲写会整体替换目录），跳过并如实记录
                logLine('deepseek 模型补齐跳过：settings 服务不可读（无法安全合并 models，保持现状）');
                return;
            }
            const section = get.call(ctx.settings, 'llm-pi-ai');
            const ds = section?.providers?.deepseek;
            if (!ds)
                return; // deepseek 路由未配置（目录路由未声明），不动
            if (ds.modelOverrides && Object.keys(ds.modelOverrides).length > 0) {
                logLine('deepseek 模型补齐跳过：路由用了 modelOverrides（与 models 互斥，不盲合）');
                return;
            }
            const configured = Array.isArray(ds.models) ? ds.models : null;
            if (configured?.some(m => m?.id === DEEPSEEK_VISION_MODEL))
                return; // 已有（幂等）
            const base = configured ?? [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }]; // 未配置 = 内建目录，显式保留
            const models = [...base, { id: DEEPSEEK_VISION_MODEL, name: 'DeepSeek V4 Flash Vision（实验）', input: ['text', 'image'] }];
            await ctx.settings.update('llm-pi-ai', { providers: { deepseek: { models } } });
            logLine(`deepseek 模型补齐：+${DEEPSEEK_VISION_MODEL}（路由共 ${models.length} 个模型，live 生效）`);
            console.log(`[dsht-rp] deepseek model top-up: +${DEEPSEEK_VISION_MODEL} (total ${models.length})`);
        }
        catch (e) {
            console.log(`[dsht-rp] deepseek model top-up skipped: ${e.message}`);
        }
    };
    void ensureDeepseekModels();
    // ---- §2.3 ③：聊天界面偏好（楼层号显示）——settings 真实 Schema + /rp/chat-prefs 读路由。
    // 设置→插件「可配置」tab 渲染（中文键 = 标签）；前端 RpFloorBadge 每会话视图取一次。
    const CHAT_PREFS_NS = 'dsht-rp-chat';
    try {
        // 【实机测试修复 2026-09-05】settings.register 对 schema 是鸭子类型调用
        // （schema(value)+toJSON()，见 dsht-plugin-shared/settings-ns.ts）——裸对象报
        // "schema is not a function"。改 schemastery z.object（runtime 同版本已打包）。
        ctx.settings?.register?.(CHAT_PREFS_NS, schemastery_1.default.object({ 楼层号显示: schemastery_1.default.boolean().default(true) }), { base: { 楼层号显示: true } });
    }
    catch (e) {
        logLine(`聊天偏好设置注册失败（不影响本体）：${e.message}`);
    }
    const readChatPrefs = () => {
        try {
            const v = ctx.settings?.get?.(CHAT_PREFS_NS);
            return { floorBadge: v?.['楼层号显示'] !== false };
        }
        catch {
            return { floorBadge: true };
        }
    };
    // ---- lore_query 工具（T1.8：轻 agent 路径世界书深查，按会话工作区）----
    if (ctx.tools && ctx.systemPrompt) {
        ctx.systemPrompt.section({
            name: 'tool:lore_query',
            order: 112,
            text: 'Use the lore_query tool to look up roleplay worldbook lore (characters, places, rules, history) that is not in the active worldbook snapshot. Pass a search term (a name or keyword from the story). Prefer it over inventing setting details.',
        });
        ctx.tools.register({
            name: 'lore_query',
            description: 'Search the roleplay worldbook for lore entries (characters, places, rules). Use when a scene references setting details not already in context.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search term: character name, place, or keyword' },
                },
                required: ['query'],
                additionalProperties: false,
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            isConcurrencySafe: () => true,
            async execute(args, exec) {
                const query = String(args.query ?? '');
                const slug = exec.agent ? rpSlugFromCwd(exec.agent.session.header.cwd, dshHome) : null;
                if (slug === null)
                    return 'No roleplay workspace in this session.';
                const rp = await loadRpJson(slug, exec.signal);
                if (!rp || rp.books.length === 0)
                    return 'This roleplay workspace has no worldbooks.';
                const entries = [];
                for (const b of rp.books) {
                    const book = await loadBook(b.lorePath, exec.signal);
                    if (book)
                        entries.push(...book.entries);
                }
                console.log(`[dsht-rp] lore_query: "${query}" over ${entries.length} entries`);
                return searchLoreEntries(entries, query);
            },
        });
        // ---- T2.3：state_update 工具（MVU 状态维护）----
        // 模型主动写状态：默认 session 作用域（变量树随会话持久化），scope=global 写全局
        ctx.systemPrompt.section({
            name: 'tool:state_update',
            order: 113,
            text: 'Use the state_update tool to persist roleplay variables (favorability, location, flags, story state) across turns. Prefer updating only what changed. If the card already emits <UpdateVariable> blocks, those are captured automatically — use this tool only when you need to record state explicitly.',
        });
        ctx.tools.register({
            name: 'state_update',
            description: 'Persist a roleplay variable (MVU variable tree) for the current session. Path uses JSONPointer like /character/favorability or /location. scope=session persists per-chat; scope=global persists across chats.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'JSONPointer path, e.g. /云梦璃/好感度 or /location' },
                    value: { description: 'Value to set (number, string, boolean, object)' },
                    scope: { type: 'string', enum: ['session', 'global'], description: 'session (default) or global persistence' },
                },
                required: ['path', 'value'],
                additionalProperties: false,
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            isConcurrencySafe: () => true,
            async execute(args, exec) {
                const path = String(args.path ?? '');
                const value = args.value;
                const scope = String(args.scope ?? 'session');
                if (!path.trim())
                    return 'path required';
                const session = exec.agent?.session;
                const sid = session ? String(session.id ?? '') : '';
                if (scope === 'global') {
                    const g = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'state', 'global.json'), 'utf8').catch(() => '{}'));
                    const next = (0, mvu_ts_1.applyStatePatches)(g, [{ op: 'replace', path, value }]);
                    await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, 'rp', 'state'), { recursive: true });
                    await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, 'rp', 'state', 'global.json'), JSON.stringify(next), 'utf8');
                    console.log(`[dsht-rp] state_update(global): ${path}`);
                    return `global state updated: ${path}`;
                }
                if (!sid)
                    return 'no session';
                const st = await loadSessionState(sid);
                const next = (0, mvu_ts_1.applyStatePatches)(st.state ?? {}, [{ op: 'replace', path, value }]);
                st.state = next;
                await saveSessionState(sid, st);
                console.log(`[dsht-rp] state_update(session): ${path} (${sid})`);
                return `session state updated: ${path}`;
            },
        });
        // ---- R0：dsht_bridge 工具（迁移 agent 的 HTTP 路由通道）----
        // 迁移/适配工作区的 agent 需要调 /dsht-* 数据面（write-files、import-api-config、
        // MVU/酒馆助手/模板插件路由），但 Android 运行时无 curl/node CLI 可用——
        // 注册一个进程内 loopback 转发工具（fetch 127.0.0.1:<webServer.port>，同源信任栅栏放行）。
        ctx.systemPrompt.section({
            name: 'tool:dsht_bridge',
            order: 114,
            text: 'Use the dsht_bridge tool to call DSHTavern data-plane HTTP routes (/dsht-rp/*, /dsht-mvu/*, /dsht-tavern-helper/*, /dsht-prompt-template/*) — file writes into DSH_HOME, MVU variable registration, API config import, etc. Prefer it over raw filesystem writes outside the workspace (those trigger approval prompts).',
        });
        ctx.tools.register({
            name: 'dsht_bridge',
            description: 'Call a DSHTavern data-plane route (dsht-rp / dsht-mvu / dsht-tavern-helper / dsht-prompt-template). Example: {base:"dsht-rp", path:"rp/import-api-config", payload:{batchId:"..."}}. GET routes (e.g. dsht-rp rp/import-batches) use method:"GET".',
            parameters: {
                type: 'object',
                properties: {
                    base: { type: 'string', enum: ['dsht-rp', 'dsht-mvu', 'dsht-tavern-helper', 'dsht-prompt-template'], description: 'Route prefix (without slash)' },
                    path: { type: 'string', description: 'Sub path under the prefix, e.g. write-files or rp/import-stage' },
                    method: { type: 'string', enum: ['POST', 'GET'], description: 'default POST' },
                    payload: { type: 'object', description: 'JSON body (POST)' },
                },
                required: ['base', 'path'],
                additionalProperties: false,
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            isConcurrencySafe: () => true,
            async execute(args) {
                const base = String(args.base ?? '');
                const path = String(args.path ?? '').replace(/^\/+/, '');
                const method = String(args.method ?? 'POST');
                if (!/^dsht-[a-z-]+$/.test(base) || !path || path.includes('..'))
                    return 'bad base/path';
                const port = ctx.webServer?.port ?? 3080;
                const url = `http://127.0.0.1:${port}/${base}/${path}`;
                try {
                    const resp = await fetch(url, {
                        method,
                        headers: { 'content-type': 'application/json' },
                        ...(method === 'POST' ? { body: JSON.stringify(args.payload ?? {}) } : {}),
                    });
                    const text = await resp.text();
                    return `HTTP ${resp.status}\n${text}`;
                }
                catch (e) {
                    return `dsht_bridge failed: ${e.message}`;
                }
            },
        });
        // ---- T3.2：memory_save / memory_query 工具（会话长期记忆最小闭环，规则层无 LLM）----
        // 存储在 $DSH_HOME/rp/memory/<sessionId>.json（核心逻辑在 ./memory.ts，纯函数可单测）；
        // 组装层每轮 pre-step 自动注入最近 20 条记忆（无记忆不注入），这里是模型主动写/查通道。
        ctx.systemPrompt.section({
            name: 'tool:memory_save',
            order: 115,
            text: 'Use the memory_save tool to store facts that must persist across turns (user preferences, important setting changes, promises made in the story). Recent memories are injected into context automatically each turn; before generating a reply you may first call memory_query to recall relevant facts and avoid duplicates.',
        });
        ctx.tools.register({
            name: 'memory_save',
            description: '把需要跨轮长期记住的事实（用户偏好、重要设定变动、承诺）存入会话记忆。生成回复前可先 memory_query 检索已有记忆，避免重复保存。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '要固化的事实（一句话，≤2000 字）' },
                    source: { type: 'string', enum: ['agent', 'user'], description: '默认 agent；用户亲口说的偏好可用 user' },
                },
                required: ['text'],
                additionalProperties: false,
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            isConcurrencySafe: () => true,
            async execute(args, exec) {
                const text = String(args.text ?? '');
                if (!text.trim())
                    return 'text required';
                const source = (0, memory_ts_1.normalizeMemorySource)(args.source);
                const session = exec.agent?.session;
                const sid = session ? String(session.id ?? '') : '';
                if (!sid)
                    return 'no session';
                const file = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                const r = (0, memory_ts_1.appendMemory)(file, text, source);
                if (!r.ok)
                    return r.error === 'too-long' ? `text 超过 ${memory_ts_1.MEMORY_TEXT_MAX} 字上限` : 'text required';
                await (0, memory_ts_1.saveMemory)(dshHome, sid, r.file);
                console.log(`[dsht-rp] memory_save: ${sid} ${r.entry?.id}${r.duplicate ? '（去抖命中）' : ''}，共 ${r.file.entries.length} 条`);
                return r.duplicate === true ? `memory already saved: ${r.entry?.id}` : `memory saved: ${r.entry?.id} (${r.file.entries.length} entries)`;
            },
        });
        ctx.systemPrompt.section({
            name: 'tool:memory_query',
            order: 116,
            text: 'Use the memory_query tool to retrieve the session long-term memory (previously stored user preferences / setting changes / promises). Call it before generating a reply when continuity with earlier facts matters; an empty result means no relevant memory has been stored yet.',
        });
        ctx.tools.register({
            name: 'memory_query',
            description: '检索本会话的长期记忆（此前固化的用户偏好/设定/承诺）。生成回复前可先查询相关记忆；空结果说明尚无相关记忆。query 用空格分隔多个关键词，命中任一即返回。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '关键词（空格分隔多个词）' },
                    limit: { type: 'number', description: '返回条数上限，默认 10' },
                },
                required: ['query'],
                additionalProperties: false,
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            isConcurrencySafe: () => true,
            async execute(args, exec) {
                const query = String(args.query ?? '');
                const rawLimit = args.limit;
                const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10;
                const session = exec.agent?.session;
                const sid = session ? String(session.id ?? '') : '';
                if (!sid)
                    return 'no session';
                const { entries } = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                const hits = (0, memory_ts_1.queryMemory)(entries, query, limit);
                console.log(`[dsht-rp] memory_query: "${query}" → ${hits.length}/${entries.length} hits (${sid})`);
                if (hits.length === 0)
                    return `No memory matches "${query}"（本会话尚无相关长期记忆）`;
                return ['memory hits:', ...hits.map(h => `- [${(0, memory_ts_1.formatMemoryTime)(h.createdAt)}] ${h.text}`)].join('\n');
            },
        });
    }
    // ---- ⑧ ST 预设机制移植①：relative 条目（prompt_order 保序）→ request.system 顶部 ----
    // ST 对应物：PromptManager 里 position=relative 的条目按 prompt_order 排在 prompt 顶部。
    // DSH 宿主语义：request.system 是唯一顶部通道（decision.messages 全落 user/message 且
    // restore 校验 role 必须 user）。每 step assemble 时现算——会话内切预设下一 step 即生效；
    // 预设不变则 system 文本不变，不触发 request/header 重写。
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        let assembly = (await next());
        try {
            const agent = context.agent
                ?? context.scope;
            if (!agent || !assembly || !Array.isArray(assembly.sections))
                return assembly;
            // ---- D-3：把 pre-step 发布的系统级 RP 内容并入 system 槽位 ----
            // 唯一合法通道取证：`agent.ts:337` `const system = renderPrompt(assembly)` →
            // `agent.ts:339` `buildRequest(..., system, session.deriveMessages(), ...)`。
            // `assembleContextFor`（`agent/src/dispatch.ts:173`）把 live Agent 放进 context.agent。
            // 内容保序由 SLOT_ORDERS 统一裁定（同 TT dump-008 的语义拼接序）。
            const published = slotPublished.get(agent);
            if (published && published.sections.length > 0) {
                const extra = (0, tt_projection_ts_1.planSlotSections)(published, neutralizeResidualMacros);
                if (extra.length > 0) {
                    assembly = {
                        ...assembly,
                        sections: [...assembly.sections, ...extra],
                    };
                    console.log(`[dsht-rp] D-3 system 槽位注入：${extra.length} 段 / ${extra.reduce((n, s) => n + s.text.length, 0)}ch（${extra.map(s => s.name).join(', ')}）`);
                }
            }
            const resolved = await resolveAgentPreset(agent);
            if (!resolved)
                return assembly;
            const { slug, rp, preset, sessionId } = resolved;
            const st = sessionId ? await loadSessionState(sessionId) : {};
            const stateTree = (st.state ?? st.variables ?? {});
            const parts = [];
            for (const slot of (0, schema_ts_1.compileSlots)(preset)) {
                if (slot.depth != null)
                    continue; // depth 条目归 pre-step 真 splice
                if (slot.type === 'marker' || slot.type === 'state')
                    continue; // 动态位归尾部快照带
                if (!evalSlotCondition(slot.condition, stateTree))
                    continue;
                const text = slot.content.trim();
                if (text)
                    parts.push(text);
            }
            if (parts.length === 0)
                return assembly;
            const expanded = await expandSnapshotMacros(parts.join('\n\n'), rp, slug, sessionId);
            // renderPrompt 对 section 文本做严格 {{variable}} 插值（未知变量即 throw）——
            // 宏求值后的残余 {{…}} 必须中性化，否则整个 assemble 崩溃
            const text = neutralizeResidualMacros(expanded).trim();
            if (!text)
                return assembly;
            return {
                ...assembly,
                sections: [...assembly.sections, {
                        name: `dsht-rp:preset:${preset.id}`,
                        text: `【RP 预设：${preset.displayName}】以下为当前预设的生效指令（用户可在会话中随时切换预设）：\n\n${text}`,
                    }],
            };
        }
        catch (e) {
            console.log(`[dsht-rp] preset system-section 注入失败（不阻塞）：${e.message}`);
            return assembly;
        }
    });
    // ---- ⑧ ST 预设机制移植②：采样参数落地（agent/request 瀑布）----
    // ST 预设的 temperature/max_tokens/stop/reasoning_effort 随预设走。宿主适配器
    // （dsh-llm-deepseek）仅透传 temperature/max_tokens/stop 三键 + 配置管线 reasoningEffort；
    // topP/topK/minP/topA/penalties/seed/logitBias 宿主不支持（AUDIT_TASKLIST 标注为宿主限制）。
    // ---- Golden Master 对照（DSHT 侧 dump#3，2026-09-09）：provider 层 fetch 拦截 ----
    // pre-step 的 messages 只是本轮增量；"发给 LLM 的最终完整 payload"在 provider 出站请求里。
    // ENABLED 开关存在时 patch globalThis.fetch（只读透传不改请求），把 LLM chat 请求体落盘
    // golden/dsht/llm-NNN.json，与 TT 侧 chat_completion_prompt_ready（25 条完整组装）配对 diff。
    try {
        if ((0, node_fs_2.existsSync)((0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht-ENABLED')) && !globalThis.__dshtGoldenFetchPatched) {
            ;
            globalThis.__dshtGoldenFetchPatched = true;
            const gdir0 = (0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht');
            (0, node_fs_2.mkdirSync)(gdir0, { recursive: true });
            const seqFile0 = (0, node_path_1.join)(gdir0, 'llm-seq.txt');
            const gFetch = globalThis.fetch.bind(globalThis);
            globalThis.fetch = (async (input, init) => {
                try {
                    const url = typeof input === 'string' ? input : input?.url ?? String(input);
                    const body = typeof init === 'object' && init !== null ? init.body : undefined;
                    if (typeof body === 'string' && body.length > 200 && /chat\/completions|\/v1\/messages|provider\/v1/i.test(url)) {
                        let seq = 0;
                        try {
                            seq = parseInt(((0, node_fs_2.readFileSync)(seqFile0, 'utf8')).trim() || '0', 10) || 0;
                        }
                        catch { /* 首次 */ }
                        seq += 1;
                        (0, node_fs_2.writeFileSync)((0, node_path_1.join)(gdir0, `llm-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
                            tag: 'provider_llm_request', seq, env: 'dshtavern', ts: new Date().toISOString(),
                            url: url.slice(0, 200),
                            data: { body: JSON.parse(body) },
                        }, null, 1));
                        (0, node_fs_2.writeFileSync)(seqFile0, String(seq));
                    }
                }
                catch { /* golden dump 失败不影响请求 */ }
                return gFetch(input, init);
            });
            console.log('[dsht-rp] golden: provider fetch 拦截已启用（llm dump → rp/golden/dsht/）');
        }
    }
    catch { /* patch 失败不阻塞插件 */ }
    ctx.on('agent/request', async (payload, next) => {
        const config = (await next());
        try {
            const agent = payload.agent;
            if (!agent)
                return config;
            const resolved = await resolveAgentPreset(agent);
            if (!resolved)
                return config;
            const s = resolved.preset.sampling;
            const out = { ...config };
            if (typeof s.temperature === 'number')
                out.temperature = s.temperature;
            if (typeof s.maxTokens === 'number')
                out.maxTokens = s.maxTokens;
            if (Array.isArray(s.stopSequences) && s.stopSequences.length > 0)
                out.stop = s.stopSequences;
            // 【TT 对照修复 2026-09-09】reasoning_effort 值域映射：ST/TT 预设的 'auto' 等"由 provider
            // 自行决定"语义，在 DSH provider 侧不被支持（实测报 does not support reasoning effort "auto"，
            // 发送直接失败）。TT 的行为 = 不支持的值不发该字段。此处仅透传 DSH 支持的档位。
            const REASONING_EFFORT_SUPPORTED = new Set(['minimal', 'low', 'medium', 'high']);
            if (typeof s.reasoningEffort === 'string' && REASONING_EFFORT_SUPPORTED.has(s.reasoningEffort)) {
                out.reasoningEffort = s.reasoningEffort;
            }
            else {
                // 'auto' / 未知值：TT 语义 = 不发该字段（provider 自行决定）。显式删除，
                // 避免 DSH config 默认残留 'auto' 触发 provider 校验拒绝（实测报错）。
                delete out.reasoningEffort;
            }
            // ---- Golden Master 对照（DSHT 侧 dump，2026-09-09）：rp/golden/dsht-ENABLED 存在时落盘最终请求配置 ----
            // 与 ST/TauriTavern 侧 golden-master 采集器（CHAT_COMPLETION_PROMPT_READY 挂点）配对，
            // 同卡同输入产出两侧 dump 后逐项 diff。失败绝不影响主链路。
            try {
                if ((0, node_fs_2.existsSync)((0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht-ENABLED'))) {
                    const gdir = (0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht');
                    await (0, promises_1.mkdir)(gdir, { recursive: true });
                    const seqFile = (0, node_path_1.join)(gdir, 'seq.txt');
                    let seq = 0;
                    try {
                        seq = parseInt((await (0, promises_1.readFile)(seqFile, 'utf8')).trim() || '0', 10) || 0;
                    }
                    catch { /* 首次 */ }
                    seq += 1;
                    await (0, promises_1.writeFile)((0, node_path_1.join)(gdir, `dump-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
                        tag: 'agent_request_config', seq, env: 'dshtavern', ts: new Date().toISOString(),
                        cwd: agent.session?.header?.cwd ?? null,
                        data: { config: out },
                    }, null, 1));
                    await (0, promises_1.writeFile)(seqFile, String(seq));
                }
            }
            catch { /* golden dump 失败不影响请求 */ }
            return out;
        }
        catch {
            return config;
        }
    });
    // ---- D-3/D-4 投影层探针（2026-09-10 心跳 33）：llm/stream 是官方唯一的"最终请求"
    //      投影点（TT 侧的 GENERATE_AFTER_COMBINE_PROMPTS 等价物）。此处只观测不改写，
    //      用于确认 ① 钩子可达 ② messages/system 的最终形状 ③ 与 deriveMessages 的关系。
    //      排序依据：agent-loop 的不变式用 { prepend: true } 注册（invariant.ts:56），
    //      本监听器不带 prepend → 在其 next() 之后执行，安全。
    ctx.on('llm/stream', (options, next) => {
        try {
            const o = options;
            const msgs = Array.isArray(o.messages) ? o.messages : [];
            const head = msgs.slice(0, 3).map((m) => {
                const mm = m;
                const c = typeof mm.content === 'string' ? mm.content : JSON.stringify(mm.content ?? '');
                return `${String(mm.role ?? '?')}:${c.length}ch`;
            });
            console.log(`[dsht-rp] llm/stream 观测: provider=${String(o.provider ?? '')} model=${String(o.model ?? '')} `
                + `messages=${msgs.length} system=${typeof o.system === 'string' ? o.system.length + 'ch' : '(none)'} `
                + `tools=${Array.isArray(o.tools) ? o.tools.length : 0} maxTokens=${String(o.maxTokens ?? '')} `
                + `temp=${String(o.temperature ?? '')} purpose=${String(o.purpose ?? '')} sessionId=${String(o.sessionId ?? '')} `
                + `| 首3条: ${head.join(' ')}`);
        }
        catch (e) {
            console.log(`[dsht-rp] llm/stream 观测失败: ${e.message}`);
        }
        return next();
    });
    ctx.on('agent/pre-step', async (raw, next) => {
        const decision = (await next());
        if (decision.kind !== 'enter')
            return decision;
        const { agent, messages, signal } = raw;
        const slug = rpSlugFromCwd(agent.session.header.cwd, dshHome);
        console.log(`[dsht-rp] pre-step: cwd=${agent.session.header.cwd ?? '(none)'} slug=${slug ?? '(not-rp)'} turn=${raw.turn}`);
        // ---- Golden Master 对照（DSHT 侧 dump#2，2026-09-09）：messages 全文落盘 ----
        // agent/request 瀑布只有采样参数；真正发给 LLM 的消息序列在此（pre-step）。
        // rp/golden/dsht-ENABLED 存在时落盘，与 TT/ST 侧 chat_completion_prompt_ready 配对 diff。
        try {
            if ((0, node_fs_2.existsSync)((0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht-ENABLED'))) {
                const gdir = (0, node_path_1.join)(dshHome, 'rp', 'golden', 'dsht');
                await (0, promises_1.mkdir)(gdir, { recursive: true });
                const seqFile = (0, node_path_1.join)(gdir, 'msg-seq.txt');
                let seq = 0;
                try {
                    seq = parseInt((await (0, promises_1.readFile)(seqFile, 'utf8')).trim() || '0', 10) || 0;
                }
                catch { /* 首次 */ }
                seq += 1;
                await (0, promises_1.writeFile)((0, node_path_1.join)(gdir, `msg-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
                    tag: 'agent_prestep_messages', seq, env: 'dshtavern', ts: new Date().toISOString(),
                    cwd: agent.session.header.cwd ?? null,
                    turn: raw.turn ?? null,
                    data: { messages },
                }, null, 1));
                await (0, promises_1.writeFile)(seqFile, String(seq));
            }
        }
        catch { /* golden dump 失败不影响主链路 */ }
        if (slug === null)
            return decision;
        try {
            signal.throwIfAborted();
            const rp = await loadRpJson(slug, signal);
            if (!rp)
                return decision;
            const turnNo = raw.turn ?? 0;
            const traceKey = String(agent.session.id ?? slug);
            // I8-6：登记 live 会话（flush-all 通道的 flush 对象清单）
            registerLiveSession(traceKey, agent.session);
            // I4/I5 + R26 + R33：userName 单一事实源（persona active 优先）——EJS 生成期 ctx、
            // WI 宏上下文 macroCtx、withPresetLayer finalize 三处共用（此前各算各的：EJS 用
            // rp.macros.user 不含 persona、macroCtx 引用悬空——R33 实机炸过全注入链）
            globalUserProfile = await loadUserProfileCached(dshHome);
            const persona = await (0, macros_ts_2.loadActivePersona)(dshHome);
            const userName = persona?.name || globalUserProfile?.name || rp.macros.user || '用户';
            /**
             * T2.7：预设快照包装——本 handler 全部返回路径统一过这里（session 内随时
             * 切换预设：状态文件变了，下一轮即注入新预设内容，历史零搁浅）。
             * T2.3 扩展：同一次读取里顺带注入 MVU 状态摘要（stateSummary 槽位填充，
             * 变量树变化才注入，与预设/WI 快照并列去重）。
             */
            const withPresetLayer = async (d) => {
                // userName/persona/globalUserProfile 已在上方统一计算（persona active 优先）
                const userDesc = persona?.description || globalUserProfile?.description || '';
                void userDesc; // persona 描述暂不进 prompt（persona 槽位由 withPersonaSnapshot 承担）
                // I4（ST 宏系统）：最终消息统一过核心宏（{{user}}/{{char}}/{{time}} 等——
                // 用户输入与世界书内容里的宏在生成期求值，ST 同语义）
                const finalize = (dd) => {
                    try {
                        // I7（性能）：重载荷截断先行（工具参数 base64 等 10MB+ 大字符串占位化）
                        const heavy = truncateHeavyToolPayloads(dd.messages);
                        if (heavy.truncated > 0)
                            console.log(`[dsht-rp] heavy-payload truncate: ${heavy.truncated} 个工具块参数占位化`);
                        const macroCtx = {
                            user: userName,
                            char: rp.macros.char || rp.characterName,
                        };
                        const messages = heavy.messages.map(m => {
                            if (!m || !Array.isArray(m.content))
                                return m;
                            let changed = false;
                            const content = m.content.map(b => {
                                if (b && b.type === 'text' && typeof b.text === 'string' && b.text.includes('{{')) {
                                    const next = expandCoreMacros(b.text, macroCtx);
                                    if (next !== b.text) {
                                        changed = true;
                                        return { ...b, text: next };
                                    }
                                }
                                return b;
                            });
                            return changed ? { ...m, content } : m;
                        });
                        return { ...dd, messages };
                    }
                    catch {
                        return dd;
                    }
                };
                try {
                    signal.throwIfAborted();
                    const sid = String(agent.session.id ?? '');
                    if (!sid)
                        return finalize(d);
                    const st = await loadSessionState(sid);
                    // D-3：本轮系统级内容收集区（`SLOT_ROUTING` 开启时走 system 槽位而非 user 席位）。
                    // 每条内容在**原位**同时决定去重与去向，避免两套逻辑分叉。
                    const slotSections = [];
                    // ---- T2.3 状态摘要注入（先于预设；文本不变跳过）。§2.2 修正：影子化豁免每个
                    // 签名的最新副本（planShadowOps），所以 retained 跳过安全——请求恒为一份副本，
                    // 不会像 turn 43 那样双份（always-inject 会让请求多扛一份上轮副本 ~17 万 token）----
                    const summary = (0, mvu_ts_1.renderStateSummary)(st.state ?? st.variables ?? {});
                    if (summary && retainedState.get(agent) !== summary) {
                        retainedState.set(agent, summary);
                        if (SLOT_ROUTING) {
                            slotSections.push({ name: 'dsht-rp:slot:state', order: tt_projection_ts_1.SLOT_ORDERS.stateTree, text: summary });
                        }
                        else {
                            d = withStateSnapshot(d, summary);
                        }
                    }
                    // ---- 任务 2：promptPersona 卡设定快照（retained 跳过——影子化豁免最新副本）----
                    const personaRaw = (rp.promptPersona ?? '').trim();
                    if (personaRaw) {
                        // 任务 1：卡文本里的 {{…}} 宏过宏引擎（真运行期语义；setvar 落 chat 作用域）
                        const personaText = await expandSnapshotMacros(personaRaw, rp, slug, sid);
                        if (personaText && retainedPersona.get(agent) !== personaText) {
                            retainedPersona.set(agent, personaText);
                            if (SLOT_ROUTING) {
                                // 角色卡 → system（TT dump-008 的 [3] stage_1_base_requirements 同位置语义）
                                slotSections.push({ name: 'dsht-rp:slot:character', order: tt_projection_ts_1.SLOT_ORDERS.characterCard, text: personaText });
                            }
                            else {
                                d = withPersonaSnapshot(d, personaText);
                            }
                        }
                    }
                    // ---- T3.2：长期记忆注入（世界书快照同一带区）：最近 20 条 `- [时间] 文本`；
                    // 无记忆不注入；retained 跳过（影子化豁免最新副本）----
                    const memoryText = (0, memory_ts_1.renderMemorySnapshot)((await (0, memory_ts_1.loadMemory)(dshHome, sid)).entries);
                    if (memoryText) {
                        const memorySnapshot = `【长期记忆】（此前固化的用户偏好/设定变动/承诺；生成回复前可先 memory_query 检索更多）\n${memoryText}`;
                        if (retainedMemory.get(agent) !== memorySnapshot) {
                            retainedMemory.set(agent, memorySnapshot);
                            if (SLOT_ROUTING) {
                                // 长期记忆 → system（TT [11] 过往记忆 同位置语义）
                                slotSections.push({ name: 'dsht-rp:slot:memory', order: tt_projection_ts_1.SLOT_ORDERS.memory, text: memorySnapshot });
                            }
                            else {
                                d = withMemorySnapshot(d, memorySnapshot);
                            }
                        }
                    }
                    // ---- E3：表格快照注入（st-memory-enhancement 表格系统）：会话有启用表且本 step
                    // 来自用户轮才注入（工具轮零影响）；无表/渲染空不注入；retained 跳过（同上）----
                    if (hasDirectUserInput(messages)) {
                        try {
                            const { sheets } = await loadSheets(dshHome, sid);
                            const active = sheets.filter(s => s.enabled);
                            if (active.length > 0) {
                                const tablesText = renderTablePrompt(active);
                                if (tablesText && retainedTables.get(agent) !== tablesText) {
                                    retainedTables.set(agent, tablesText);
                                    if (SLOT_ROUTING) {
                                        slotSections.push({ name: 'dsht-memory:slot:tables', order: tt_projection_ts_1.SLOT_ORDERS.tables, text: tablesText });
                                    }
                                    else {
                                        d = withTablesSnapshot(d, tablesText);
                                    }
                                }
                            }
                        }
                        catch { /* 表格加载失败不阻塞主流程 */ }
                    }
                    // D-3：发布本轮 slot 内容（assemble 下一 step 读走；见 slotPublished 注释）
                    // 有内容才覆盖——无内容时保留上一轮发布，避免 turn 内后续 step（如工具轮）
                    // 把 system 槽位清空导致角色设定"闪断"（实机易见的一致性风险）。
                    if (slotSections.length > 0)
                        publishSlots(agent, slotSections);
                    // ---- T2.7/⑧ 预设注入（有效预设 = 显式选择 ?? ST 激活预设默认）----
                    // relative 条目由 system-prompt/assemble 瀑布注入 request.system（顶部、prompt_order
                    // 保序）；这里只承担 depth 条目（jailbreak 类）——真深度 splice（ST in-chat 注入语义），
                    // 签名快照形态（planShadowOps 同签名只留最新副本，防逐轮堆积）。
                    const effectivePresetId = typeof st.presetId === 'string' && st.presetId
                        ? st.presetId
                        : await resolveActiveStPresetId();
                    if (!effectivePresetId) {
                        return finalize(d);
                    }
                    const preset = await resolvePreset(effectivePresetId, signal);
                    if (!preset)
                        return finalize(d);
                    // P1#6：agent 型预设的能力轴探测独立于内容去重（agent preset 切换时 prompt 可能未变）
                    if (preset.path === 'agent')
                        void probeCapabilityAxis(agent, preset);
                    const depthSlots = (0, schema_ts_1.compileSlots)(preset).filter(s => s.depth != null && s.content.trim() !== '' &&
                        evalSlotCondition(s.condition, (st.state ?? st.variables ?? {})));
                    if (depthSlots.length === 0)
                        return finalize(d);
                    const depthTexts = [];
                    for (const slot of depthSlots) {
                        const text = (await expandSnapshotMacros(slot.content.trim(), rp, slug, sid)).trim();
                        if (text)
                            depthTexts.push({ depth: slot.depth ?? 0, role: slot.role, content: text });
                    }
                    if (depthTexts.length === 0)
                        return finalize(d);
                    const byDepth = new Map();
                    for (const t of depthTexts) {
                        const l = byDepth.get(t.depth) ?? [];
                        l.push(t.content);
                        byDepth.set(t.depth, l);
                    }
                    let msgs = d.messages;
                    for (const [depth, list] of [...byDepth.entries()].sort((a, b) => b[0] - a[0])) {
                        const text = neutralizeResidualMacros(list.join('\n'));
                        const m = {
                            role: 'user', // restore 校验：user/message 的 role 必须 'user'（同 spliceDepthInjections）
                            content: [{ type: 'text', text }],
                            source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: 'dsht-rp:preset-depth', text }] },
                            id: `dsht-rp-preset-depth-${(0, node_crypto_1.randomUUID)()}`,
                        };
                        const at = Math.max(0, msgs.length - depth);
                        msgs = [...msgs.slice(0, at), m, ...msgs.slice(at)];
                    }
                    console.log(`[dsht-rp] preset depth inject: ${preset.displayName} ${depthTexts.length} 条目（depth=${[...byDepth.keys()].join(',')}）`);
                    return finalize({ kind: d.kind, messages: msgs });
                }
                catch {
                    return finalize(d);
                }
            };
            // 【hook 移植 L3】assemble 挂点（ST GENERATE_AFTER_COMBINE_PROMPTS / GENERATE_AFTER_DATA
            // 对应物）：本 handler 全部正常返回路径统一过这里——第三方插件 ctx.on('dsht-rp/assemble',
            // (p, next) => ...) 可在最终决定发给模型前改写 decision.messages（p.decision 读回语义）。
            // 异常路径（catch 降级为普通会话）不过挂点——钩子失败不该连坐已有容错。
            const viaAssembleHook = async (dp) => {
                const dd = await dp;
                return await ctx.waterfall(null, 'dsht-rp/assemble', { agent, sessionId: traceKey, slug, turn: turnNo, decision: dd }, (p) => Promise.resolve(p.decision));
            };
            // ---- 组装管线（§4.1）步骤 1：正则 prompt 时机跑完整批（enter decision.messages）----
            // 注意不能只跑 payload.messages（claimed 新消息）：多 step turn 里后续 step 的批由
            // DSH 从 surface 原文重建，claimed 已空——只跑 claimed 会让正则在 step 2+ 失效。
            // ST 语义 = 每轮对整个 prompt 过正则 → 对 decision.messages 全批跑。
            // T2.8：三源合并（全局 + 预设 + 角色）
            const sessionIdForRegex = String(agent.session.id ?? '');
            const regexScripts = await mergedRegex(rp, signal, sessionIdForRegex);
            const regexHits = [];
            // 【hook 移植 L3 2026-09-06】RP 域自定义 cordis 事件链（ST/Luker generate() 分段开放
            // 挂点的同构建面）。设计决策：内置逻辑作 waterfall 的 fallback（最内层 next），第三方
            // 插件 ctx.on('dsht-rp/regex', (p, next) => ...) 包裹/改写/否决——cordis 官方惯用法
            // （与 agent/pre-step 的默认 enter 决策同款）。注意首参 null：cordis dispatch 会把
            // 首个 object 参数误当 scope thisArg（cordis/lib/index.js:259），必须显式占住。
            // 事件链：dsht-rp/turn(emit) → dsht-rp/regex(waterfall) → dsht-rp/wi-scan(waterfall)
            //        → dsht-rp/wi-activated(emit) → dsht-rp/wi-finalize(waterfall) → dsht-rp/assemble(waterfall)
            ctx.emit(null, 'dsht-rp/turn', { sessionId: sessionIdForRegex, slug, turn: turnNo });
            let batch = await ctx.waterfall(null, 'dsht-rp/regex', { agent, sessionId: sessionIdForRegex, slug, turn: turnNo, messages: decision.messages, hits: regexHits }, (p) => applyPromptRegexes(p.messages, regexScripts, regexHits));
            // ---- B9 + B2（提示词模板生成期管线；rp/ejs-settings.json 驱动）----
            // B9 filter_chat_message：楼层里的 <% %> 模板语句剥除（不进模型上下文）；
            // B2 generate_enabled：含 <% %> 的楼层在生成期自求值（template='' → 消息文本即模板，
            // chatDepth 深度门控同款）。二者互斥（过滤优先——ST 同序）。
            try {
                const ejs = await loadEjsSettings(dshHome);
                // ①轮收口：EJS ctx 的 user 也走 persona 优先的 userName（原来用 rp.macros.user，
                // persona 切换后 EJS 楼层自求值的 {{user}} 与其他通道不一致）
                const ejsCtx = { user: userName, char: rp.macros.char || rp.characterName };
                if (ejs.enabled !== false && ejs.filterChatMessage === true) {
                    const fr = filterTemplateStatements(batch);
                    if (fr.filtered > 0) {
                        batch = fr.messages;
                        regexHits.push({ scriptName: 'ejs:filter-chat-message', count: fr.filtered });
                        console.log(`[dsht-rp] ejs filter-chat: ${fr.filtered} 条消息剥除 <% %> 模板语句`);
                    }
                }
                else if (ejs.enabled !== false && ejs.generateEnabled === true) {
                    const depthLimit = typeof ejs.chatDepth === 'number' ? ejs.chatDepth : -1;
                    const idxs = [];
                    batch.forEach((m, i) => {
                        const depth = batch.length - 1 - i;
                        if (depthLimit >= 0 && depth >= depthLimit)
                            return;
                        const content = m.content;
                        if (!Array.isArray(content))
                            return;
                        const textBlocks = content.filter(b => b?.type === 'text');
                        if (textBlocks.length !== 1 || content.length !== textBlocks.length)
                            return; // 多块/推理块消息跳过（防结构破坏）
                        if (messageText(m).includes('<%'))
                            idxs.push(i);
                    });
                    if (idxs.length > 0) {
                        const stMsgs = idxs.map(i => ({ mes: messageText(batch[i]), role: batch[i].role }));
                        const r = ejs.sandbox === true
                            ? (0, sandbox_ts_1.renderMessagesSandbox)('', ejsCtx, stMsgs)
                            : { ok: true, messages: (0, ejs_ts_1.renderMessages)('', ejsCtx, stMsgs) };
                        if (r.ok) {
                            batch = [...batch];
                            idxs.forEach((origIdx, k) => {
                                const mes = String(r.messages[k]?.mes ?? '');
                                batch[origIdx] = { ...batch[origIdx], content: [{ type: 'text', text: mes }] };
                            });
                            console.log(`[dsht-rp] ejs generate: ${idxs.length} 条楼层自求值（engine=${ejs.sandbox === true ? 'sandbox' : 'subset'}）`);
                        }
                        else {
                            console.log(`[dsht-rp] ejs generate 失败（kind=${r.kind}）——原文透传`);
                        }
                    }
                }
            }
            catch (e) {
                console.log(`[dsht-rp] ejs generate/filter 管线异常（原文透传）：${e.message}`);
            }
            // ---- T2.3：MVU 状态提取（本批新 assistant 消息的 <UpdateVariable> → 合并落盘）----
            // 幂等：按消息 id 去重（多 step turn 后续 step 的批从 surface 重建，防 delta 重复累加）
            const stateSid = String(agent.session.id ?? '');
            if (stateSid) {
                const st0 = await loadSessionState(stateSid);
                let sessionState = st0.state ?? {};
                let dirty = false;
                for (const msg of batch) {
                    if (msg.role !== 'assistant' || msg.source?.form === 'snapshot')
                        continue;
                    const mid = msg.id;
                    if (!mid || stateSeen.has(mid))
                        continue;
                    // D2/D3：UpdateVariable 块优先，裸 <JSONPatch> 兜底（新一代卡直接输出 JSONPatch）
                    const patches0 = (0, mvu_ts_1.parseUpdateVariable)(messageText(msg));
                    const patches = patches0.length > 0 ? patches0 : (0, mvu_ts_1.parseJsonPatches)(messageText(msg));
                    if (patches.length > 0) {
                        sessionState = (0, mvu_ts_1.applyStatePatches)(sessionState, patches);
                        stateSeen.add(mid);
                        dirty = true;
                    }
                }
                if (dirty) {
                    const st1 = await loadSessionState(stateSid);
                    st1.state = sessionState;
                    await saveSessionState(stateSid, st1);
                    console.log(`[dsht-rp] MVU state updated: ${Object.keys(sessionState).length} top keys (${stateSid})`);
                }
            }
            // ---- P0-5：per-turn 闸门 + 时间游标（照抄 dsh-worldbook src/context/inject.ts
            // L39-42 与 L99-107；MIT © aam452，见 REF_PROJECTS_COMPARISON.md 领域六）----
            // 闸门：本 step 的 inbox 消息里没有 source.kind==='user' 的真实用户消息 =
            // 工具/思考轮 → 跳过世界书注入（不重复注入；prompt 正则与 MVU 提取不受影响）。
            // 游标：事件流里真实 user/assistant 消息累计数（排除插件注入/快照），写进
            // rp/state/<sid>.json 的 cursor 键（变化才写盘）。
            const cursor = (0, trigger_ts_1.visibleMessageCursor)(sessionEventsSnapshot(agent.session));
            if (stateSid) {
                const stc = await loadSessionState(stateSid);
                if (stc.cursor !== cursor) {
                    stc.cursor = cursor;
                    await saveSessionState(stateSid, stc);
                }
            }
            const hasUserInput = hasDirectUserInput(raw.messages);
            if (!hasUserInput) {
                console.log(`[dsht-rp] pre-step: 工具轮（无真实用户消息），跳过世界书注入（cursor=${cursor}）`);
                return await viaAssembleHook(withPresetLayer({ ...decision, messages: batch }));
            }
            // 触发扫描（M1 引擎）：历史 + 本批消息（扫描文本也过 prompt 正则——ST 语义：WI 看到的是正则后文本）
            const history = scanSurfaceHistory(agent.session, batch, rp.trigger.scanDepth ?? 2, regexScripts);
            const entries = [];
            for (const b of rp.books) {
                const book = await loadBook(b.lorePath, signal);
                if (book)
                    entries.push(...book.entries);
            }
            // ---- D1（MVU initvar）+ B12（预载世界书）：开局变量初始化——
            // <initvar>/[initvar]/[InitialVariables]/<defineEJSVariable> 块解析合并进
            // rp/state/<sid>.json 的 variables（幂等：内容 hash 记账，世界书变了才重放）。
            if (stateSid && entries.length > 0) {
                try {
                    const initTree = parseInitVariables(entries);
                    const initHash = JSON.stringify(initTree);
                    if (Object.keys(initTree).length > 0) {
                        const sti = await loadSessionState(stateSid);
                        if (sti.mvuInitHash !== initHash) {
                            const before = (sti.variables ?? {});
                            sti.variables = deepMergeInitVars(before, initTree);
                            // 【审查修复 2026-09-05】双写 state 树——生成期摘要读 state ?? variables、
                            // 状态栏读 variables ?? state：两树都初始化避免分叉（运行期 UpdateVariable 只写 state）
                            sti.state = deepMergeInitVars((sti.state ?? {}), initTree);
                            sti.mvuInitHash = initHash;
                            await saveSessionState(stateSid, sti);
                            logLine(`MVU initvar：世界书变量初始化 ${Object.keys(initTree).length} 个顶层键（${stateSid}）`);
                            console.log(`[dsht-rp] mvu initvar: +${Object.keys(initTree).length} top keys (${stateSid})`);
                        }
                    }
                }
                catch (e) {
                    console.log(`[dsht-rp] mvu initvar 失败（不阻塞）：${e.message}`);
                }
            }
            // 新会话首步：开场白注入（surface 无任何消息时，firstMes 作为剧情起点进快照）
            const isNewChat = agent.session.surface.nodes.every(seq => {
                const ev = sessionEventAt(agent.session, seq);
                return ev === undefined || (ev.type !== 'user/message' && ev.type !== 'assistant/message');
            });
            const opening = isNewChat && rp.firstMes ? `【故事开场（已发生的剧情）】\n${rp.firstMes}\n\n【开场结束。自此用户介入剧情。】\n\n` : '';
            // 宏上下文（§4.1.1：WI 内容组装期求值；stableSeed 锚定 pick 宏）
            // userName 用上方统一计算的（persona active 优先，R33 悬空引用事故的收口）
            const macroCtx = {
                user: userName,
                char: rp.macros.char,
                stableSeed: `rp-${slug}`,
            };
            const traceRuntime = {
                sessionId: String(agent.session.id ?? slug),
                turn: turnNo,
                ts: Date.now(),
                regexHits: [],
                activatedEntries: [],
                depthInjections: [],
                snapshotChars: 0,
                droppedByBudget: 0,
            };
            /** turn 内聚合（存 trace 时调用）：step 1 净化过的消息在 step 2 的批里保持净化（不重复命中），
             * 各 step 的命中按 scriptName 累加；turn 变化则重开新 trace */
            const mergeTraceHits = () => {
                const prev = lastTrace.get(traceKey);
                const merged = new Map((prev && prev.turn === turnNo ? prev.regexHits : []).map(h => [h.scriptName, h.count]));
                for (const h of regexHits)
                    merged.set(h.scriptName, (merged.get(h.scriptName) ?? 0) + h.count);
                traceRuntime.regexHits = [...merged].map(([scriptName, count]) => ({ scriptName, count }));
            };
            if (entries.length === 0) {
                console.log(`[dsht-rp] no book entries loaded (books=${rp.books.length}, dshHome=${dshHome})`);
                mergeTraceHits();
                lastTrace.set(traceKey, traceRuntime);
                if (opening) {
                    // 无书但新会话：开场白单独成快照（任务 1：过宏引擎——开场白可含 {{setvar}} 等）
                    const openingOnly = await expandSnapshotMacros(`${opening}Current active worldbook entries: none.`, rp, slug, sessionIdForRegex);
                    if (retained.get(agent) !== openingOnly) {
                        retained.set(agent, openingOnly);
                        traceRuntime.snapshotChars = openingOnly.length;
                        return await viaAssembleHook(withPresetLayer(withSnapshot({ ...decision, messages: batch }, openingOnly)));
                    }
                }
                return await viaAssembleHook(withPresetLayer({ ...decision, messages: batch }));
            }
            // P2#11：跨轮 timed effects（sticky/cooldown）从 rp/state/<sid>.json 的 loreTimed 键读回，
            // 时间轴 = 上方已算好的 visibleMessageCursor；本轮新写入的 effect 由引擎合入结果返回后写回。
            let priorTimed = [];
            if (stateSid) {
                const stt = await loadSessionState(stateSid);
                if (Array.isArray(stt.loreTimed))
                    priorTimed = stt.loreTimed;
            }
            // 【hook 移植 L3】wi-scan 挂点（ST GENERATION_BEFORE/AFTER_WORLD_INFO_SCAN 对应物）：
            // 第三方可改写扫描输入（history/entries/options）或完全接管（不调 next 自产 result）
            const wiScanOptions = {
                scanDepth: rp.trigger.scanDepth ?? 2,
                matchWholeWords: rp.trigger.matchWholeWords ?? false,
                budgetPercent: rp.trigger.budgetPercent ?? 25,
                budgetCap: rp.trigger.budgetCap ?? 6000,
                cursor,
                timedEffects: priorTimed,
            };
            const result = await ctx.waterfall(null, 'dsht-rp/wi-scan', { agent, sessionId: stateSid, slug, turn: turnNo, history, entries, options: wiScanOptions }, (p) => Promise.resolve((0, trigger_ts_1.triggerWorldInfo)(p.entries, p.history, p.options)));
            if (stateSid) {
                const stw = await loadSessionState(stateSid);
                if (JSON.stringify(stw.loreTimed ?? []) !== JSON.stringify(result.timedEffects)) {
                    stw.loreTimed = result.timedEffects;
                    await saveSessionState(stateSid, stw);
                }
            }
            traceRuntime.droppedByBudget = result.budgetDropped.length;
            // ---- 步骤 2+4：激活条目 → 正则（WORLD_INFO）+ 宏求值 + 位置分桶 ----
            // 【hook 移植 L3】wi-activated 通知（ST WORLD_INFO_ACTIVATED）+ wi-finalize 挂点
            // （ST GENERATION_WORLD_INFO_FINALIZED 对应物：分桶产物可改写）
            ctx.emit(null, 'dsht-rp/wi-activated', {
                sessionId: stateSid, slug, turn: turnNo,
                entries: result.activated.map(a => ({ comment: a.entry.comment, reason: a.reason })),
            });
            const buckets = await ctx.waterfall(null, 'dsht-rp/wi-finalize', { agent, sessionId: stateSid, slug, turn: turnNo, result, buckets: processActivatedEntries(result.activated, regexScripts, macroCtx, regexHits) }, (p) => p.buckets);
            traceRuntime.activatedEntries = result.activated.map(a => ({
                comment: a.entry.comment,
                reason: a.reason,
                position: a.entry.position === 4 ? `depth-${a.entry.depth}` : a.entry.position === 1 ? 'after' : 'before',
            }));
            traceRuntime.depthInjections = buckets.atDepth.map(d => ({ depth: d.depth, chars: d.content.length }));
            // ---- 步骤 3：深度注入条目 splice 进本批（BEFORE/AFTER 走快照）----
            batch = spliceDepthInjections(batch, buckets.atDepth);
            // ---- B4：@Inject 指令条目（ST inject_loader）——不看关键词激活，按 depth 定位注入
            // （depth = 距批尾的消息数；order 大者优先；内容过 EJS 求值 + 宏引擎双通道）----
            try {
                const ejsInj = await loadEjsSettings(dshHome);
                if (ejsInj.enabled !== false && ejsInj.injectLoaderEnabled === true) {
                    const inj = scanInjectEntries(entries.filter(e => entryActive(e, ejsInj.invertEnabled === true)))
                        .sort((a, b) => b.order - a.order);
                    for (const d of inj) {
                        const text = await expandSnapshotMacros((0, ejs_ts_1.renderEjsSubset)(d.entry.content, { user: macroCtx.user, char: macroCtx.char }), rp, slug, sessionIdForRegex);
                        const pos = Math.max(0, Math.min(d.depth, batch.length));
                        // 【⑧审查修复 2026-09-06】role 强制 user + 补 id/source 契约——原实现透传
                        // d.role（system/assistant）且无 id：decision.messages 全落 user/message 事件，
                        // 冷启动 restore 校验（assertMessageEventShape：role 必须 user + id 必填）
                        // 必拒 → 含 @Inject 注入的会话重启即 corrupt。role 语义以签名节名承载。
                        const clean = neutralizeResidualMacros(text);
                        batch = [...batch.slice(0, batch.length - pos), {
                                role: 'user',
                                content: [{ type: 'text', text: clean }],
                                source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: `dsht-rp:ejs-inject:${d.role}`, text: clean }] },
                                id: `dsht-rp-ejs-inject-${(0, node_crypto_1.randomUUID)()}`,
                            }, ...batch.slice(batch.length - pos)];
                        traceRuntime.snapshotChars += text.length;
                    }
                    if (inj.length > 0)
                        console.log(`[dsht-rp] ejs inject: ${inj.length} 条 @Inject 指令注入`);
                }
                // ---- C8 消费端：酒馆助手 injectPrompts（rp/th-injections/<sid>.json）——
                // 脚本经 TH 插件 /inject 写入，本侧按 depth/role 注入；once 条目注入后删除 ----
                if (stateSid) {
                    const injFile = (0, node_path_1.join)(dshHome, 'rp', 'th-injections', `${stateSid}.json`);
                    const injList = await (0, promises_1.readFile)(injFile, 'utf8')
                        .then(t => JSON.parse(t))
                        .catch(() => []);
                    if (Array.isArray(injList) && injList.length > 0) {
                        const onceKeys = [];
                        const sorted = [...injList].sort((a, b) => Number(b.order ?? 100) - Number(a.order ?? 100));
                        for (const inj of sorted) {
                            const text = String(inj.prompt ?? '');
                            if (!text.trim())
                                continue;
                            const depth = Math.max(0, Math.min(Number(inj.depth ?? 4), batch.length));
                            const roleRaw = String(inj.role ?? 'system');
                            const pos = batch.length - depth;
                            // 【⑧审查修复 2026-09-06】同 @Inject 修复：role 强制 user + 补 id（restore
                            // 校验硬约束），role 语义以签名节名承载；form:'snapshot' 让旧副本被影子化
                            const clean = neutralizeResidualMacros(text);
                            batch = [...batch.slice(0, pos), {
                                    role: 'user',
                                    content: [{ type: 'text', text: clean }],
                                    source: { kind: 'plugin', plugin: exports.name, form: 'snapshot', sections: [{ name: `dsht-rp:th-inject:${roleRaw}`, text: clean }] },
                                    id: `dsht-rp-th-inject-${(0, node_crypto_1.randomUUID)()}`,
                                }, ...batch.slice(pos)];
                            if (inj.once === true && typeof inj.key === 'string')
                                onceKeys.push(inj.key);
                            traceRuntime.snapshotChars += text.length;
                        }
                        if (onceKeys.length > 0) {
                            const rest = injList.filter(e => !(e.once === true && typeof e.key === 'string' && onceKeys.includes(e.key)));
                            await (0, promises_1.mkdir)((0, node_path_1.dirname)(injFile), { recursive: true });
                            // 【审查修复 2026-09-05】once 消费写回原子化（I8-2 同款规范，防 TH /inject 并发时丢更新）
                            await atomicWriteFile(injFile, JSON.stringify(rest));
                        }
                        console.log(`[dsht-rp] th injects: ${sorted.length} 条酒馆助手注入（once 消费 ${onceKeys.length}）`);
                    }
                }
            }
            catch (e) {
                console.log(`[dsht-rp] ejs inject 失败（跳过）：${e.message}`);
            }
            // ---- B3：[GENERATE:BEFORE/AFTER] 条目（ST generate_loader）——不看激活，生成期恒注入
            // （BEFORE → WI 快照带区前；AFTER → 后；内容过 EJS 求值 + 宏引擎）----
            let genPrefix = '';
            let genSuffix = '';
            try {
                const ejsGen = await loadEjsSettings(dshHome);
                if (ejsGen.enabled !== false && ejsGen.generateLoaderEnabled === true) {
                    const ge = scanGenerateEntries(entries.filter(e => entryActive(e, ejsGen.invertEnabled === true)));
                    const evalEntry = async (e) => expandSnapshotMacros((0, ejs_ts_1.renderEjsSubset)(e.content, { user: macroCtx.user, char: macroCtx.char }), rp, slug, sessionIdForRegex);
                    const bef = await Promise.all(ge.before.map(evalEntry));
                    const aft = await Promise.all(ge.after.map(evalEntry));
                    genPrefix = bef.filter(Boolean).join('\n');
                    genSuffix = aft.filter(Boolean).join('\n');
                    if (genPrefix || genSuffix)
                        console.log(`[dsht-rp] ejs generate-loader: BEFORE=${ge.before.length} AFTER=${ge.after.length}`);
                }
            }
            catch (e) {
                console.log(`[dsht-rp] ejs generate-loader 失败（跳过）：${e.message}`);
            }
            // 常驻/关键词条目（BEFORE/AFTER）→ 快照（官方 runtime-context 语义）
            const snapshotEntries = [
                ...buckets.before.map(b => ({ entry: { comment: b.comment, content: b.content }, reason: b.reason })),
                ...buckets.after.map(b => ({ entry: { comment: b.comment, content: b.content }, reason: b.reason })),
            ];
            const baseDecision = { ...decision, messages: batch };
            if (snapshotEntries.length === 0 && buckets.atDepth.length === 0 && !genPrefix && !genSuffix) {
                // 无激活：清空 retained，下轮内容变化才再注入（正则/深度注入已应用）
                console.log(`[dsht-rp] no activation (entries=${entries.length}, history=${history.length})`);
                retained.set(agent, '');
                mergeTraceHits();
                lastTrace.set(traceKey, traceRuntime);
                return await viaAssembleHook(withPresetLayer(baseDecision));
            }
            // 任务 1：快照文本过宏引擎（WI 条目内容已在 processActivatedEntries 过旧引擎求值；
            // 这里补全 getvar/setvar/time 等酒馆助手宏的真语义，未知宏原样保留）
            const snapshotText = await expandSnapshotMacros(opening + genPrefix + renderWorldInfoSnapshot(snapshotEntries, rp.macros) + genSuffix, rp, slug, sessionIdForRegex);
            traceRuntime.snapshotChars = snapshotText.length;
            mergeTraceHits();
            lastTrace.set(traceKey, traceRuntime);
            console.log(`[dsht-rp] scan: entries=${entries.length} activated=${result.activated.length} dropped=${result.budgetDropped.length} snapshot=${snapshotText.length}ch depthInj=${buckets.atDepth.length} regexHits=${regexHits.length}${opening ? ' (+opening)' : ''}`);
            // retained 跳过（影子化豁免最新副本—— WI 快照恒一份）
            if (retained.get(agent) === snapshotText)
                return await viaAssembleHook(withPresetLayer(baseDecision));
            retained.set(agent, snapshotText);
            // ---- D-3：世界书 → system 槽位（TT dump-008 的 [6]/[7] World_Lore_Database 同位置语义）----
            // 与 withPresetLayer 内部的 slot 发布共用同一张表：世界书在 pre-step 的两个分支里
            // 计算（有激活/无激活），本处覆盖"有激活"的主路径。合并而非覆盖，避免把
            // withPresetLayer 已发布的状态树/记忆丢掉。
            if (SLOT_ROUTING) {
                const prev = slotPublished.get(agent)?.sections ?? [];
                publishSlots(agent, [
                    ...prev.filter(s => s.name !== 'dsht-rp:slot:worldbook'),
                    { name: 'dsht-rp:slot:worldbook', order: tt_projection_ts_1.SLOT_ORDERS.worldbook, text: snapshotText },
                ]);
                return await viaAssembleHook(withPresetLayer(baseDecision));
            }
            return await viaAssembleHook(withPresetLayer(withSnapshot(baseDecision, snapshotText)));
        }
        catch (error) {
            if (error?.name === 'AbortError')
                throw error;
            // RP 注入失败不阻塞对话（降级为普通会话）
            console.log(`[dsht-rp] pre-step error: ${error?.message}`);
            return decision;
        }
    });
    // ---- 变体操作 + RP 数据 HTTP 数据面：ctx.webServer 前缀路由 /dsht-rp/*（T2.5f）----
    // 同源（DSH web UI 页面直接 fetch('/dsht-rp/...')）、零端口冲突、无 CORS。
    // 旧 3081 独立端口方案废弃：端口被占时 server.listen 的未处理 error 会击穿
    // 整个 DSH 进程（实测），且 Android WebView appassets 页面跨源需 JS Bridge 特判。
    // POST /dsht-rp/variant/switch {sessionId, targetSeq} —— 切回历史变体（含重roll后的旧版本回看）
    // POST /dsht-rp/variant/groups {sessionId} —— 变体组清单（前端渲染左右切换箭头）
    // POST /dsht-rp/rp/home {} / /dsht-rp/rp/workspaces {} / /dsht-rp/rp/import-card { json } / /dsht-rp/llm/classify
    if (ctx.webServer) {
        /** 信任栅栏（对照 connection 包 isTrustedApiRequest 语义）：
         *  - webServer 绑 127.0.0.1（默认）：Host 必须是 loopback（防 DNS rebinding）
         *  - webServer 绑 0.0.0.0（用户显式开放 LAN）：Host 任意，但浏览器请求（带 Origin）必须同源 */
        const isTrusted = (req) => {
            const host = String(req.headers.host ?? '').toLowerCase();
            const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
            const lanMode = ctx.webServer?.host === '0.0.0.0';
            if (!lanMode && !['127.0.0.1', 'localhost', '::1'].includes(hostname))
                return false;
            const origin = req.headers.origin;
            if (typeof origin === 'string' && origin !== 'null' && !origin.endsWith(host)) {
                // Origin 的 authority 与 Host 不一致（跨源浏览器请求）→ 拒绝
                try {
                    return new URL(origin).host === host;
                }
                catch {
                    return false;
                }
            }
            return true;
        };
        // §4.16.1 import-progress 轮询用的预览缓存（60s TTL）：claims 的预览扫描里聊天计数
        // 是重活（逐文件读 8MiB），前端 30s 轮询 + 多批次徽章刷新不能每次都扫盘。
        // 作用域挂本次 webServer 注册（插件生命周期）；key = unpacked 目录绝对路径。
        const previewCache = new Map();
        const PREVIEW_CACHE_TTL = 60_000;
        const getCachedPreview = (unpackedDir) => {
            const hit = previewCache.get(unpackedDir);
            if (!hit)
                return null;
            if (Date.now() - hit.at > PREVIEW_CACHE_TTL) {
                previewCache.delete(unpackedDir);
                return null;
            }
            return hit.preview;
        };
        const cachePreview = (unpackedDir, preview) => {
            previewCache.set(unpackedDir, { at: Date.now(), preview });
            if (previewCache.size > 16) { // 护栏：只留最近用过的批次，防长驻进程涨内存
                let oldestKey = '';
                let oldestAt = Infinity;
                for (const [k, v] of previewCache) {
                    if (v.at < oldestAt) {
                        oldestAt = v.at;
                        oldestKey = k;
                    }
                }
                if (oldestKey && oldestKey !== unpackedDir)
                    previewCache.delete(oldestKey);
            }
        };
        const dispose = ctx.webServer.register({
            kind: 'prefix',
            path: '/dsht-rp',
            handler: (rawReq, rawRes) => {
                void (async () => {
                    const req = rawReq;
                    const res = rawRes;
                    const send = (code, body) => {
                        res.writeHead(code, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(body));
                    };
                    if (!isTrusted(req))
                        return send(403, { error: 'forbidden' });
                    const sub = decodeURIComponent((req.url ?? '').replace(/^\/dsht-rp/, '')) || '/';
                    // query 拆分（§4.16.1 断点续跑 GET /rp/import-checkpoint?batchId= 的读参形态；
                    // 路由匹配一律用 subPath——老路由无 query，行为不变）
                    const qIdx = sub.indexOf('?');
                    const subPath = qIdx === -1 ? sub : sub.slice(0, qIdx);
                    const subQuery = qIdx === -1 ? '' : sub.slice(qIdx + 1);
                    // T2.11：嵌入版导入中心静态服务（GET；同源 iframe 页面 + 引擎 bundle）
                    if (req.method === 'GET' || req.method === 'HEAD') {
                        const sendText = (code, body, type) => {
                            res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
                            res.end(body);
                        };
                        if (subPath === '/import-center') {
                            const html = readAsset('import-center.html');
                            if (html === null)
                                return sendText(404, 'import-center.html not found (build assets)', 'text/plain');
                            return sendText(200, html, 'text/html; charset=utf-8');
                        }
                        if (subPath === '/import-center/app.js') {
                            const js = readAsset('app.js');
                            if (js === null)
                                return sendText(404, 'app.js not found (build assets)', 'text/plain');
                            return sendText(200, js, 'application/javascript; charset=utf-8');
                        }
                        // R0：批次清单（$DSH_HOME/rp-import/*/meta.json + 报告存在性 + checkpoint 状态）
                        if (subPath === '/rp/import-batches') {
                            const batches = [];
                            try {
                                const dirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import'));
                                for (const d of dirs.sort().reverse()) {
                                    if (!isValidBatchId(d))
                                        continue;
                                    const dir = (0, node_path_1.join)(dshHome, 'rp-import', d);
                                    let meta = {};
                                    try {
                                        meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                                    }
                                    catch { /* 无 meta */ }
                                    let hasReport = false;
                                    for (const rf of ['migration-report.md', 'REPORT.md']) {
                                        try {
                                            await (0, promises_1.readFile)((0, node_path_1.join)(dir, rf), 'utf8');
                                            hasReport = true;
                                            break;
                                        }
                                        catch { /* 无报告 */ }
                                    }
                                    // §4.16.1 断点续跑：checkpoint 状态（agent 逐类目写入；前端标「中断可续跑」）
                                    let checkpoint = null;
                                    try {
                                        checkpoint = (0, import_preview_ts_1.parseCheckpointFile)(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'checkpoint.json'), 'utf8'));
                                    }
                                    catch { /* 无 checkpoint */ }
                                    const summary = (0, import_preview_ts_1.summarizeCheckpoint)(checkpoint);
                                    batches.push({
                                        batchId: d, dir, hasReport, ...meta,
                                        checkpoint: summary.hasCheckpoint ? { stages: summary.stages, doneCount: summary.doneCount, updatedAt: summary.updatedAt } : null,
                                    });
                                }
                            }
                            catch { /* 无 rp-import 目录 */ }
                            return send(200, { batches, dshHome });
                        }
                        // §4.16.1 断点续跑：读迁移 checkpoint（agent 开工先查；前端判断「中断可续跑」）
                        if (subPath === '/rp/import-checkpoint') {
                            const batchId = new URLSearchParams(subQuery).get('batchId') ?? '';
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required（?batchId=）' });
                            let checkpoint = null;
                            try {
                                checkpoint = (0, import_preview_ts_1.parseCheckpointFile)(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-import', batchId, 'checkpoint.json'), 'utf8'));
                            }
                            catch { /* 无 checkpoint */ }
                            return send(200, { batchId, checkpoint, summary: (0, import_preview_ts_1.summarizeCheckpoint)(checkpoint) });
                        }
                        // §4.16.1 六屏迁移向导（屏5 执行/屏6 报告）：GET /rp/import-progress?batchId=
                        // 进度模型（meta.json manifest 计数 total × checkpoint 逐类目 done）+
                        // 预估剩余时间（类目速率外推）+ 待认领清单（孤儿聊天/同名卡版本更新/agent claim 标记）。
                        // 纯逻辑在 import-preview.ts（buildBatchProgress/collectPreviewClaims），这里只做 FS 接线。
                        if (subPath === '/rp/import-progress') {
                            const batchId = new URLSearchParams(subQuery).get('batchId') ?? '';
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required（?batchId=）' });
                            const dir = (0, node_path_1.join)(dshHome, 'rp-import', batchId);
                            let meta = {};
                            try {
                                meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                            }
                            catch {
                                return send(404, { error: `批次不存在：${batchId}（先 import-stage）` });
                            }
                            let checkpoint = null;
                            try {
                                checkpoint = (0, import_preview_ts_1.parseCheckpointFile)(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'checkpoint.json'), 'utf8'));
                            }
                            catch { /* 无 checkpoint */ }
                            // claims 需要预览扫描（聊天计数是重活）：60s 内存缓存——前端 30s 轮询不重复扫盘
                            const unpacked = (0, node_path_1.join)(dir, 'unpacked');
                            let preview = getCachedPreview(unpacked);
                            if (!preview) {
                                try {
                                    preview = await (0, import_preview_ts_1.scanImportPreview)(unpacked, { dshHome });
                                    cachePreview(unpacked, preview);
                                }
                                catch {
                                    preview = null;
                                } // unpacked 缺失等：claims 只剩 checkpoint 标记来源
                            }
                            const previewClaims = preview ? await (0, import_preview_ts_1.collectPreviewClaims)(dshHome, unpacked, preview) : [];
                            return send(200, { batchId, progress: (0, import_preview_ts_1.buildBatchProgress)(meta, checkpoint, previewClaims) });
                        }
                        // 【2026-09-06 视觉验收】GET /rp/avatar?slug=… → 工作区头像（ST 楼层头像同源物）。
                        // 卡导入/迁移时把 ST 角色 PNG 缩制落盘 <rp>/<slug>/avatar.png；缺文件 → 404
                        //（前端 onError 隐藏 img，占位圆）。同源缓存 1h。
                        if (subPath === '/rp/avatar') {
                            const slug = new URLSearchParams(subQuery).get('slug') ?? '';
                            if (!/^[\w.-]{1,80}$/.test(slug))
                                return send(400, { error: 'slug required' });
                            try {
                                const buf = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'avatar.png'));
                                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length), 'Cache-Control': 'max-age=3600' });
                                return res.end(buf);
                            }
                            catch {
                                return sendText(404, 'no avatar', 'text/plain');
                            }
                        }
                        // 【2026-09-07 ST 对齐】GET /rp/charname?slug=… → 角色显示名（ST 楼层名同源物，
                        // rp.json 的 characterName；基准 316 楼层名「ExampleGame ExampleWorld MVU Edition」）。
                        // 旧实现楼层名直接用 workspace slug → 头像列被长 slug 名撑爆（真机回归实证）。
                        if (subPath === '/rp/charname') {
                            const slug = new URLSearchParams(subQuery).get('slug') ?? '';
                            if (!/^[\w.-]{1,80}$/.test(slug))
                                return send(400, { error: 'slug required' });
                            let name = slug;
                            try {
                                const raw = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json'), 'utf8'));
                                if (typeof raw.characterName === 'string' && raw.characterName.trim())
                                    name = raw.characterName.trim();
                            }
                            catch { /* rp.json 缺失 → slug 兜底 */ }
                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=3600' });
                            return res.end(JSON.stringify({ name }));
                        }
                        // ---- /rp/build-info：构建版本可见性（2026-09-08 用户痛点「我装的到底是不是最新包」）----
                        // 读 filesDir/dsh-runtime/.installed-v* 哨兵（APK 内 NodeService.RUNTIME_SENTINEL
                        // 写入的解压标记）+ node 运行时真实版本——手机上一眼对出安装包新旧。
                        // dsh-runtime 缺席（PC 纯前端验证）→ sentinel: null。
                        // 【2026-09-08 死代码修复】本分支原被并行编辑错位到 POST-only 区（GET 块 L3650
                        // 兜底 return 之后）——GET 恒 404 text/plain、POST 恒 400 bad json，实机实证。
                        // 迁回 GET 块兜底之前，恢复 GET 语义。
                        if (sub === '/rp/build-info') {
                            let sentinel = null;
                            try {
                                const runtimeDir = (0, node_path_1.join)(dshHome, '..', 'dsh-runtime');
                                const entries = await (0, promises_1.readdir)(runtimeDir);
                                // 【2026-09-08 鲁棒性】历史哨兵不清理（NodeService 每次升级写新文件不删旧，
                                // 实机 28 个残留）——find() 目录序会取到最旧的，版本显示恒滞后。改为解析
                                // vNNN 数值取最大（= 最近一次成功解压的标记）。
                                let maxV = -1;
                                for (const e of entries) {
                                    if (!e.startsWith('.installed-v'))
                                        continue;
                                    const n = Number(e.slice('.installed-v'.length));
                                    if (Number.isFinite(n) && n > maxV) {
                                        maxV = n;
                                        sentinel = e;
                                    }
                                }
                                if (maxV < 0)
                                    sentinel = null;
                            }
                            catch { /* PC 验证环境无 runtime 目录 */ }
                            let dshVersion = null;
                            try {
                                const pkg = JSON.parse((0, node_fs_2.readFileSync)((0, node_path_1.join)(dshHome, '..', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
                                dshVersion = pkg.version ?? null;
                            }
                            catch { /* PC 无 node_modules 布局 */ }
                            return send(200, { sentinel, dshVersion, fixTag: 'wb-fix-0908' });
                        }
                        return sendText(404, 'not found', 'text/plain');
                    }
                    // §4.16.1 断点续跑：DELETE 语义清 checkpoint（= POST {reset:true} 的等价形式；
                    // dsht_bridge 只有 GET/POST，SKILL 契约约定用 POST reset:true）
                    if (req.method === 'DELETE' && subPath === '/rp/import-checkpoint') {
                        const batchId = new URLSearchParams(subQuery).get('batchId') ?? '';
                        if (!isValidBatchId(batchId))
                            return send(400, { error: 'batchId required（?batchId=）' });
                        await (0, promises_1.rm)((0, node_path_1.join)(dshHome, 'rp-import', batchId, 'checkpoint.json'), { force: true });
                        logLine(`import-checkpoint: ${batchId} checkpoint 已清除（DELETE）`);
                        return send(200, { ok: true, batchId, cleared: true });
                    }
                    if (req.method !== 'POST')
                        return send(405, { error: 'POST only' });
                    const chunks = [];
                    for await (const c of req)
                        chunks.push(c);
                    let payload;
                    try {
                        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    }
                    catch {
                        return send(400, { error: 'bad json' });
                    }
                    // 【鲁棒轮 2026-09-09】body 为 JSON null/数组时 payload.xxx 抛 TypeError → 统一 500；
                    // 显式 400 让调用方看到真实错误（合法 JSON 但形状不对）。
                    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
                        return send(400, { error: 'bad json: body must be an object' });
                    try {
                        // T2.11：数据面诊断（嵌入导入中心「运行时诊断」面板消费）
                        if (sub === '/diag') {
                            return send(200, await diagSnapshot());
                        }
                        // ---- R0：/rp/import-stage —— 上传落盘暂存（导入管线 agent 化的第一步）----
                        // 单块：{name, dataBase64, format?}；分块：{name, batchId?, chunk, index, done, format?}
                        // （index 0 无 batchId → 服务端建批次并返回，后续块带 batchId 追加写）。
                        // format:'zip'（默认）→ source.zip + done 时解压 unpacked/；
                        // format:'file'（单卡/单书）→ 原样写 unpacked/inbox/<name>，不解压。
                        // done（或单块）时写 meta.json（含 manifest 快速统计）。
                        // 返回 {batchId, dir, fileCount, manifest}。无显式大小上限（本机 loopback + 手动读流）。
                        if (sub === '/rp/import-stage') {
                            const nameRaw = String(payload.name ?? 'st-data.zip');
                            const name = nameRaw.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'st-data.zip';
                            const rawFile = payload.format === 'file';
                            const stageBatch = async (batchId, dir) => {
                                const unpacked = (0, node_path_1.join)(dir, 'unpacked');
                                let fileCount = 1;
                                if (!rawFile) {
                                    fileCount = await unpackZipTo((0, node_path_1.join)(dir, 'source.zip'), unpacked);
                                }
                                const manifest = await scanImportManifest(unpacked);
                                await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'meta.json'), JSON.stringify({
                                    batchId, name, format: rawFile ? 'file' : 'zip',
                                    stagedAt: new Date().toISOString(), fileCount, manifest,
                                }, null, 1), 'utf8');
                                logLine(`import-stage: ${batchId}（${name}）${rawFile ? '单文件' : `解压 ${fileCount} 文件`} kind=${manifest.kind}`);
                                console.log(`[dsht-rp] import-stage: ${batchId} (${name}) → ${rawFile ? 'raw file' : `${fileCount} files`} kind=${manifest.kind}`);
                                return { batchId, dir, fileCount, manifest };
                            };
                            // 单块模式
                            if (typeof payload.dataBase64 === 'string' && payload.dataBase64) {
                                const batchId = makeBatchId(name);
                                const dir = (0, node_path_1.join)(dshHome, 'rp-import', batchId);
                                if (rawFile) {
                                    await (0, promises_1.mkdir)((0, node_path_1.join)(dir, 'unpacked', 'inbox'), { recursive: true });
                                    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'unpacked', 'inbox', name), Buffer.from(payload.dataBase64, 'base64'));
                                }
                                else {
                                    await (0, promises_1.mkdir)(dir, { recursive: true });
                                    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'source.zip'), Buffer.from(payload.dataBase64, 'base64'));
                                }
                                return send(200, await stageBatch(batchId, dir));
                            }
                            // 分块模式
                            const chunk = typeof payload.chunk === 'string' ? payload.chunk : '';
                            const index = Number(payload.index ?? -1);
                            if (!chunk || index < 0)
                                return send(400, { error: '需要 dataBase64（单块）或 chunk+index（分块）' });
                            let batchId = typeof payload.batchId === 'string' ? payload.batchId : '';
                            if (index === 0 && !batchId)
                                batchId = makeBatchId(name);
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId 非法（index 0 时不传则由服务端分配）' });
                            const dir = (0, node_path_1.join)(dshHome, 'rp-import', batchId);
                            const target = rawFile ? (0, node_path_1.join)(dir, 'unpacked', 'inbox', name) : (0, node_path_1.join)(dir, 'source.zip');
                            await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
                            await (0, promises_1.writeFile)(target, Buffer.from(chunk, 'base64'), { flag: index === 0 ? 'w' : 'a' });
                            if (payload.done !== true)
                                return send(200, { batchId, index, staged: false });
                            return send(200, await stageBatch(batchId, dir));
                        }
                        // ---- §4.6 diff 预览：POST /rp/import-preview {batchId} —— 分类预览（只读不改）----
                        // 扫 rp-import/<batchId>/unpacked 产出 {cards, books, chats, presets, dropped, ejsTemplates}：
                        // 前端「预览」步骤消费（徽章：新/覆盖/丢弃），用户确认后才可 kickoff——
                        // 纯逻辑在 import-preview.ts（scanImportPreview），这里只做批次定位与接线。
                        if (subPath === '/rp/import-preview') {
                            const batchId = String(payload.batchId ?? '');
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required' });
                            const unpacked = (0, node_path_1.join)(dshHome, 'rp-import', batchId, 'unpacked');
                            try {
                                await (0, promises_1.readdir)(unpacked);
                            }
                            catch {
                                return send(404, { error: `批次不存在或未解压：${batchId}（先 import-stage）` });
                            }
                            const preview = await (0, import_preview_ts_1.scanImportPreview)(unpacked, { dshHome });
                            logLine(`import-preview: ${batchId} 卡 ${preview.cards.length} · 书 ${preview.books.length} · 聊 ${preview.chats.length} · 预设 ${preview.presets.length} · 丢弃 ${preview.dropped.length}`);
                            console.log(`[dsht-rp] import-preview: ${batchId} cards=${preview.cards.length} books=${preview.books.length} chats=${preview.chats.length} presets=${preview.presets.length} dropped=${preview.dropped.length} ejs=${preview.ejsTemplates}`);
                            return send(200, { batchId, preview });
                        }
                        // ---- §4.16.1 断点续跑：POST /rp/import-checkpoint —— 迁移进度落盘 ----
                        // {batchId, stage, done:[...]} → 归并写 rp-import/<batchId>/checkpoint.json
                        //（agent 逐类目完成后调；消费契约见 SKILL.md「断点续跑（必做）」）。
                        // {batchId, reset:true} → 清 checkpoint（迁移完结；下次 kickoff 不再误判续跑）。
                        // 写前快照：归属迁移适配会话（payload.sessionId 优先，缺省取最近活跃的
                        // rp-import/_adapter 会话）；拿不到会话上下文就跳过快照，不阻塞写。
                        if (subPath === '/rp/import-checkpoint') {
                            const batchId = String(payload.batchId ?? '');
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required' });
                            const cpPath = (0, node_path_1.join)(dshHome, 'rp-import', batchId, 'checkpoint.json');
                            if (payload.reset === true) {
                                await (0, promises_1.rm)(cpPath, { force: true });
                                logLine(`import-checkpoint: ${batchId} checkpoint 已清除`);
                                console.log(`[dsht-rp] import-checkpoint: ${batchId} cleared`);
                                return send(200, { ok: true, batchId, cleared: true });
                            }
                            const stage = typeof payload.stage === 'string' ? payload.stage : '';
                            if (!import_preview_ts_1.CHECKPOINT_STAGES.includes(stage)) {
                                return send(400, { error: `stage 非法（合法值：${import_preview_ts_1.CHECKPOINT_STAGES.join('/')}）` });
                            }
                            let existing = null;
                            try {
                                existing = (0, import_preview_ts_1.parseCheckpointFile)(await (0, promises_1.readFile)(cpPath, 'utf8'));
                            }
                            catch { /* 首次写 */ }
                            const merged = (0, import_preview_ts_1.normalizeCheckpointWrite)(batchId, existing, { stage, done: payload.done });
                            await snapshotRpFiles(String(payload.sessionId ?? '') || await latestAdapterSessionId(), [`rp-import/${batchId}/checkpoint.json`]);
                            await (0, promises_1.mkdir)((0, node_path_1.dirname)(cpPath), { recursive: true });
                            await (0, promises_1.writeFile)(cpPath, JSON.stringify(merged, null, 1), 'utf8');
                            const summary = (0, import_preview_ts_1.summarizeCheckpoint)(merged);
                            logLine(`import-checkpoint: ${batchId} stage=${stage} done=${merged.stages[stage]?.done.length ?? 0}`);
                            console.log(`[dsht-rp] import-checkpoint: ${batchId} stage=${stage} doneCount=${summary.doneCount}`);
                            return send(200, { ok: true, batchId, checkpoint: merged, summary });
                        }
                        // ---- 批次修复 10：/rp/persona —— 「我的设定」读写 + macros.user 联动 ----
                        // GET（空 body）→ {active, list}；POST {active, list} → 写 rp/persona.json
                        // 并把默认 persona 名同步进所有 rp/*/rp.json 的 macros.user（{{user}} 展开源）。
                        if (sub === '/rp/persona') {
                            const personaPath = (0, node_path_1.join)(dshHome, 'rp', 'persona.json');
                            const isWrite = typeof payload.active !== 'undefined' || Array.isArray(payload.list);
                            if (!isWrite) {
                                try {
                                    const f = JSON.parse(await (0, promises_1.readFile)(personaPath, 'utf8'));
                                    return send(200, { active: f.active ?? null, list: Array.isArray(f.list) ? f.list : [] });
                                }
                                catch {
                                    return send(200, { active: null, list: [] });
                                }
                            }
                            const list = (Array.isArray(payload.list) ? payload.list : []);
                            const clean = list
                                .filter(p => typeof p?.name === 'string' && p.name.trim())
                                .map(p => ({ name: String(p.name).trim(), description: typeof p.description === 'string' ? p.description : '' }));
                            const active = typeof payload.active === 'string' && clean.some(p => p.name === payload.active) ? payload.active : null;
                            const file = { schemaVersion: 1, active, list: clean };
                            await (0, promises_1.mkdir)((0, node_path_1.dirname)(personaPath), { recursive: true });
                            // 任务 1：写前文件快照（persona.json + 将被联动改写的全部 rp/*/rp.json；
                            // 归属最近活跃的 RP 会话；无会话上下文跳过）
                            {
                                const snapPaths = ['rp/persona.json'];
                                for (const dir of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp')).catch(() => [])) {
                                    try {
                                        await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', dir, 'rp.json'), 'utf8');
                                        snapPaths.push(`rp/${dir}/rp.json`);
                                    }
                                    catch { /* 无 rp.json 的工作区不会被联动写 */ }
                                }
                                await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), snapPaths);
                            }
                            await (0, promises_1.writeFile)(personaPath, JSON.stringify(file, null, 1), 'utf8');
                            // macros.user 联动：所有 RP 工作区（下一论对话生效）
                            let touched = 0;
                            if (active !== null) {
                                for (const dir of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp')).catch(() => [])) {
                                    const rpPath = (0, node_path_1.join)(dshHome, 'rp', dir, 'rp.json');
                                    try {
                                        const rp = JSON.parse(await (0, promises_1.readFile)(rpPath, 'utf8'));
                                        rp.macros = { ...(rp.macros ?? {}), user: active };
                                        await (0, promises_1.writeFile)(rpPath, JSON.stringify(rp, null, 1), 'utf8');
                                        touched++;
                                    }
                                    catch { /* 无 rp.json 跳过 */ }
                                }
                            }
                            console.log(`[dsht-rp] persona saved: active=${active ?? '(none)'} list=${clean.length} → ${touched} 工作区 macros.user 同步`);
                            return send(200, { ok: true, active, count: clean.length, workspacesTouched: touched });
                        }
                        // Android 宿主无 bash sandbox / ripgrep：agent 的 bash/glob 工具不可用，
                        // 枚举 unpacked 目录树必须走本路由（否则 agent 会去申请 danger-full-access 卡审批）。
                        if (sub === '/rp/import-ls') {
                            const batchId = String(payload.batchId ?? '');
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required' });
                            const base = (0, node_path_1.join)(dshHome, 'rp-import', batchId, 'unpacked');
                            const rel = String(payload.rel ?? '').replace(/^\/+|\/+$/g, '');
                            if (rel.includes('..'))
                                return send(400, { error: 'rel 不允许 ..' });
                            const depth = Math.min(6, Math.max(1, Number(payload.depth ?? 2)));
                            const root = (0, node_path_1.join)(base, rel);
                            const out = [];
                            const walk = async (d, lv) => {
                                if (out.length > 4000)
                                    return;
                                let names;
                                try {
                                    names = await (0, promises_1.readdir)(d);
                                }
                                catch {
                                    return;
                                }
                                for (const n of names.sort()) {
                                    if (out.length > 4000)
                                        return;
                                    const p = (0, node_path_1.join)(d, n);
                                    const r = (0, node_path_1.relative)(base, p).replaceAll(node_path_1.sep, '/');
                                    let isDir = false;
                                    try {
                                        isDir = (await (0, promises_1.readdir)(p)) !== undefined;
                                    }
                                    catch { /* 文件 */ }
                                    out.push(isDir ? r + '/' : r);
                                    if (isDir && lv < depth)
                                        await walk(p, lv + 1);
                                }
                            };
                            await walk(root, 1);
                            return send(200, { batchId, rel, count: out.length, entries: out });
                        }
                        // ---- R0/R20：/rp/import-kickoff {batchId} —— 为批次创建/唤醒适配工作区会话 ----
                        // 插件在 host 进程内：经 loopback /api 信封直调 workspace.create/rename +
                        // session.create(agentPreset=dsht-adapter) + session.prompt（开工消息）。
                        // R20：适配工作区固定为 rp-import/_adapter（title「ST 数据适配」，全批次共用；
                        // 新批次在同一工作区开新会话，cwd 与批次数据目录 rp-import/<batchId>/ 分离）。
                        // 幂等：meta.json.kickoff 已记录 sessionId 时直接复返（同批次复用会话，唤醒语义 = 前端再跳过去）。
                        if (sub === '/rp/import-kickoff') {
                            const batchId = String(payload.batchId ?? '');
                            if (!isValidBatchId(batchId))
                                return send(400, { error: 'batchId required' });
                            const dir = (0, node_path_1.join)(dshHome, 'rp-import', batchId);
                            const metaPath = (0, node_path_1.join)(dir, 'meta.json');
                            let meta;
                            try {
                                meta = JSON.parse(await (0, promises_1.readFile)(metaPath, 'utf8'));
                            }
                            catch {
                                return send(404, { error: `批次不存在：${batchId}（先 import-stage）` });
                            }
                            const prior = meta.kickoff;
                            // §4.16.1 断点续跑：resumeFrom=true 时读 checkpoint——有已完成类目就把
                            // 「跳过 done 类目、只补缺失」的续跑事实注入开工消息（执行者是迁移 agent，
                            // 消费契约在 SKILL.md「断点续跑（必做）」；这里只做事实注入）。
                            const readCheckpoint = async () => {
                                try {
                                    return (0, import_preview_ts_1.parseCheckpointFile)(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'checkpoint.json'), 'utf8'));
                                }
                                catch {
                                    return null;
                                }
                            };
                            const resumeNote = async () => {
                                if (payload.resumeFrom !== true)
                                    return '';
                                const cp = await readCheckpoint();
                                const summary = (0, import_preview_ts_1.summarizeCheckpoint)(cp);
                                if (!summary.hasCheckpoint)
                                    return '';
                                return [
                                    ``,
                                    `【断点续跑】本批次此前迁移中断过（checkpoint 更新于 ${summary.updatedAt}）：`,
                                    `已完成类目：${summary.stages.join('、')}（明细 GET dsht-rp rp/import-checkpoint?batchId=${batchId} 核对）。`,
                                    `已 done 类目直接跳过（可抽查校验数量），只补缺失类目；`,
                                    `全部完成交报告后照常 POST {batchId, reset:true} 清 checkpoint。`,
                                ].join('\n');
                            };
                            if (prior?.sessionId) {
                                // 批次已开工过：默认幂等复返；resumeFrom=true 且有 checkpoint → 向既有会话
                                // 发续跑指令（agent 中断后「续跑」按钮的主路径，不新开会话）
                                if (payload.resumeFrom === true) {
                                    const cp = await readCheckpoint();
                                    const summary = (0, import_preview_ts_1.summarizeCheckpoint)(cp);
                                    if (summary.hasCheckpoint) {
                                        const resumeText = [
                                            `【ST 数据迁移续跑】批次 ${batchId}`,
                                            ``,
                                            `本批次此前迁移中断，现在从断点继续（不是重做）：`,
                                            `已完成类目：${summary.stages.join('、')}（checkpoint 更新于 ${summary.updatedAt}）。`,
                                            `请先 GET dsht-rp rp/import-checkpoint?batchId=${batchId} 核对 done 明细，`,
                                            `已 done 类目直接跳过，只补缺失类目（契约见 st-migration skill「断点续跑（必做）」）。`,
                                        ].join('\n');
                                        try {
                                            await hostRpc('session.prompt', {
                                                request: {
                                                    requestId: (0, node_crypto_1.randomUUID)(),
                                                    sessionId: prior.sessionId,
                                                    mode: 'queue',
                                                    content: [{ type: 'text', text: resumeText }],
                                                },
                                            });
                                        }
                                        catch (e) {
                                            // 既有会话已不可达（被删/宿主异常）：不阻塞——回退幂等复返语义，日志如实记录
                                            logLine(`import-kickoff: ${batchId} 续跑指令投递失败（${e.message}），回退复返`);
                                            console.log(`[dsht-rp] import-kickoff: ${batchId} resume prompt failed: ${e.message}`);
                                            return send(200, { batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null, reused: true });
                                        }
                                        logLine(`import-kickoff: ${batchId} 续跑指令 → 既有会话 ${prior.sessionId}（done 类目 ${summary.stages.join('/')}）`);
                                        console.log(`[dsht-rp] import-kickoff: ${batchId} resume → existing session=${prior.sessionId} stages=${summary.stages.join('/')}`);
                                        return send(200, {
                                            batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null,
                                            reused: true, resumed: true, checkpoint: { stages: summary.stages, doneCount: summary.doneCount, updatedAt: summary.updatedAt },
                                        });
                                    }
                                }
                                return send(200, { batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null, reused: true });
                            }
                            const rpc = hostRpc;
                            // 1. 适配工作区（R20 单一工作区定案）：全部批次共用固定工作区
                            //    $DSH_HOME/rp-import/_adapter（title 固定「ST 数据适配」）——
                            //    真机实测一批次一工作区会出现多个「ST 数据适配」刷屏侧栏。
                            //    cwd（会话工作目录）与批次数据目录分离：cwd = _adapter（固定），
                            //    批次数据仍在 rp-import/<batchId>/（开工消息里给出绝对路径）。
                            // realpath 规范化：Android 上 dshHome 可能是 /data/user/0 symlink 形态，
                            // 而 WorkspaceRegistry/session header 一律存规范形态（/data/data）——
                            // 混用会让后续 session.create(workspaceId) 认领与侧边栏分组比对不上。
                            const adapterDir = (0, node_path_1.join)(dshHome, 'rp-import', '_adapter');
                            await (0, promises_1.mkdir)(adapterDir, { recursive: true });
                            const wsDir = await (0, promises_1.realpath)(adapterDir).catch(() => adapterDir);
                            // 0.1.2 wire 信封（R21 同族修复，2026-09-09）：kickoff 的 4 处 loopback 调用
                            // 此前为裸形状（R21 适配时只改了 register-workspaces 路径，kickoff 漏网）——
                            // workspace.create 报 missing "request"。统一包 { request: {...} } 信封，
                            // session.prompt 补 0.1.2 必填 requestId。
                            const ws = await rpc('workspace.create', { request: { path: wsDir } });
                            const workspace = ws.workspace;
                            const workspaceId = workspace?.workspaceId;
                            // 2. 命名「ST 数据适配」（固定标题；rename 失败不阻塞）
                            if (workspaceId) {
                                try {
                                    await rpc('workspace.rename', { request: { workspaceId, title: 'ST 数据适配' } });
                                }
                                catch (e) {
                                    console.log(`[dsht-rp] kickoff rename failed: ${e.message}`);
                                }
                            }
                            // 3. 会话：dsht-adapter preset（PTC 基底）；preset 缺失时退默认 preset
                            let sessionId = '';
                            let presetUsed = 'dsht-adapter';
                            try {
                                const created = await rpc('session.create', {
                                    request: {
                                        ...(workspaceId ? { workspaceId } : { cwd: wsDir }),
                                        agentPreset: 'dsht-adapter',
                                    },
                                });
                                sessionId = String(created.sessionId ?? '');
                            }
                            catch (e) {
                                const code = e.code ?? '';
                                if (!code.startsWith('agent-preset'))
                                    throw e;
                                presetUsed = null;
                                const created = await rpc('session.create', { request: workspaceId ? { workspaceId } : { cwd: wsDir } });
                                sessionId = String(created.sessionId ?? '');
                                console.log(`[dsht-rp] kickoff: dsht-adapter preset 不可用（${e.message}），退默认 preset`);
                            }
                            if (!sessionId)
                                return send(500, { error: 'session.create 未返回 sessionId' });
                            // 4. 开工消息：批次路径 + 资源清单 + skill 名 + 验收项
                            const m = (meta.manifest ?? {});
                            const inventory = m.kind === 'st-data'
                                ? `角色卡 ${m.cards ?? 0} 张 · 世界书 ${m.books ?? 0} 本 · 聊天 ${m.chats ?? 0} 个 · ST 预设 ${m.presets ?? 0} 个（ST 数据根：unpacked/${m.stRoot ?? '.'}）`
                                : m.kind === 'single-card' ? `单张角色卡（unpacked/${m.singleFile ?? 'inbox/'}）`
                                    : m.kind === 'single-book' ? `单本世界书（unpacked/${m.singleFile ?? 'inbox/'}）`
                                        : '内容待识别';
                            const kickoffText = [
                                `【ST 数据迁移任务】批次 ${batchId}`,
                                ``,
                                `适配工作区（本会话 cwd，全部批次共用的固定工作区）：${wsDir}`,
                                `批次数据目录（本批次资源在这里处理）：${dir}`,
                                `原始数据：${m.kind === 'st-data' ? 'source.zip 已解压到 unpacked/（只读对待）' : `unpacked/${m.singleFile ?? 'inbox/'}`}`,
                                `资源清单：${inventory}`,
                                ``,
                                `请立即加载 st-migration skill（use_skill / 技能目录），严格按其中的目标形态契约逐类资源处理：`,
                                `每类完成后做校验回执（工作区已注册/重命名？session.list 可见？数量对得上？），`,
                                `终态产出 migration-report.md（本批次目录下）并在会话里给出中文总结；失败项显式列出，不静默。`,
                                // §4.16.1 断点续跑：resumeFrom=true 且 checkpoint 非空时追加续跑指示（否则空串）
                                await resumeNote(),
                            ].join('\n');
                            await rpc('session.prompt', { request: { requestId: (0, node_crypto_1.randomUUID)(), sessionId, mode: 'queue', content: [{ type: 'text', text: kickoffText }] } });
                            // 5. 幂等记录
                            meta.kickoff = { sessionId, workspaceId: workspaceId ?? null, preset: presetUsed, at: new Date().toISOString() };
                            await (0, promises_1.writeFile)(metaPath, JSON.stringify(meta, null, 1), 'utf8');
                            logLine(`import-kickoff: ${batchId} → session ${sessionId}（preset=${presetUsed ?? '默认'}）`);
                            console.log(`[dsht-rp] import-kickoff: ${batchId} → session=${sessionId} preset=${presetUsed ?? 'default'}`);
                            return send(200, { batchId, dir, sessionId, workspaceId: workspaceId ?? null, preset: presetUsed, reused: false });
                        }
                        // ---- R14：/rp/repair-session-cwd —— 存量 session header cwd 规范化 ----
                        // 扫 $DSH_HOME/sessions/**/session.jsonl，把 /data/user/0 symlink 形态的
                        // header cwd 改写为 realpath 规范形态（含 projectKey 目录搬迁）。幂等。
                        if (sub === '/rp/repair-session-cwd') {
                            return send(200, await repairSessionCwds());
                        }
                        // ---- R17：/rp/repair-sessions —— 存量 session seq 断号修复 ----
                        // 真机实测：agent 手写 session.jsonl 时 seq 断号（header 后 0,1,2,4），
                        // DSH 拒绝打开（"corrupt session log: seq gap in committed region"）。
                        // 重编号修复（含 replace 链 start/end/sourceEventSeqs old→new 重写），
                        // 修复前备份 .bak，幂等。返回 {scanned, repaired, skipped, errors}。
                        if (sub === '/rp/repair-sessions') {
                            return send(200, await repairAllSessionSeqs());
                        }
                        // ---- R21：/rp/sessions-audit —— 侧边栏会话审计（2026-09-04 用户要求）----
                        // 扫 sessions/<projectKey>/<sessionId>/session.jsonl 全量 header+行数：
                        // kind 分类——branch-parent（被 branch/fork 过的父会话 = "回退/分叉后被弃用的
                        // 旧会话"，用户要清理的主角）/ forked（branch 产物，用户在用）/ subagent
                        // （origin=subagent，不碰）/ empty（0 事件空壳）/ normal。
                        // 依据：0.1.2 header 契约 parentSession?/isSeeded/origin?/createdAt/cwd。
                        const collectSessionsAudit = async () => {
                            const sessionsRoot = (0, node_path_1.join)(dshHome, 'sessions');
                            const nameByKey = new Map();
                            const rpDir = (0, node_path_1.join)(dshHome, 'rp');
                            for (const dir of await (0, promises_1.readdir)(rpDir).catch(() => [])) {
                                try {
                                    const abs = await (0, promises_1.realpath)((0, node_path_1.join)(rpDir, dir)).catch(() => (0, node_path_1.join)(rpDir, dir));
                                    nameByKey.set((0, dsh_export_ts_1.projectKey)(abs), dir);
                                }
                                catch { /* 无 rp.json */ }
                            }
                            const out = [];
                            for (const pk of await (0, promises_1.readdir)(sessionsRoot).catch(() => [])) {
                                const pkDir = (0, node_path_1.join)(sessionsRoot, pk);
                                for (const sid of await (0, promises_1.readdir)(pkDir).catch(() => [])) {
                                    const f = (0, node_path_1.join)(pkDir, sid, 'session.jsonl');
                                    let header = {};
                                    let lines = 0;
                                    let lastTime = null;
                                    try {
                                        // 【鲁棒轮 2026-09-09】流式逐行（内存恒定）——原实现整文件读入 + split：
                                        // rp-import 适配会话可到 254MB（代码下方 repairAllSessionSeqs 自己设了
                                        // 8MiB 上限），手机端审计/自动清理一扫即 OOM 崩整个 node 进程。
                                        // 只需 header（首非空行）+ 行数 + 最后一行 time。
                                        let count = 0;
                                        let firstRow = '';
                                        let lastRow = '';
                                        const rl = (0, node_readline_1.createInterface)({ input: (0, node_fs_1.createReadStream)(f, { encoding: 'utf8' }), crlfDelay: Infinity });
                                        for await (const row of rl) {
                                            if (row.trim() === '')
                                                continue;
                                            if (count === 0)
                                                firstRow = row;
                                            lastRow = row;
                                            count++;
                                        }
                                        lines = Math.max(0, count - 1);
                                        try {
                                            header = JSON.parse(firstRow);
                                        }
                                        catch { /* 坏行忽略 */ }
                                        try {
                                            lastTime = Number(JSON.parse(lastRow).time ?? 0) || null;
                                        }
                                        catch { /* 无 time */ }
                                    }
                                    catch {
                                        continue;
                                    }
                                    const parent = typeof header.parentSession === 'string' ? header.parentSession : null;
                                    const seeded = header.isSeeded === true;
                                    const origin = typeof header.origin === 'string' ? header.origin : null;
                                    const createdAt = Number(header.createdAt ?? 0) || null;
                                    out.push({
                                        projectKey: pk, workspace: nameByKey.get(pk) ?? null, sessionId: sid,
                                        parentSession: parent, isSeeded: seeded, origin, events: lines, lastTime, createdAt,
                                        kind: origin === 'subagent' ? 'subagent' : seeded || parent !== null ? 'forked' : lines <= 0 ? 'empty' : 'normal',
                                    });
                                }
                            }
                            const parents = new Set(out.filter(s => s.parentSession !== null).map(s => s.parentSession));
                            for (const s of out)
                                if (parents.has(s.sessionId))
                                    s.kind = 'branch-parent';
                            return out;
                        };
                        if (sub === '/rp/sessions-audit') {
                            return send(200, { sessions: await collectSessionsAudit() });
                        }
                        // ---- R21b：/rp/sessions-archive —— 归档（侧边栏隐藏、数据保留、可恢复）----
                        // POST {sessionIds: [...]}。归档实现 = **workspaceRegistry.archiveSession 进程内
                        // 直调**（api-workspace-controller 同款 API；0.1.2 的 /api 有 cookie fence 且
                        // workspace.archiveSession 不在平坦 method 空间——HTTP 路径实测 404 不可行）。
                        // registry-global archivedSessionIds 集 → grouping surfaces 全部隐藏。
                        const archiveOne = async (sid) => {
                            const reg = getWorkspaceRegistry();
                            const fn = reg?.archiveSession;
                            if (typeof fn === 'function') {
                                fn.call(reg, sid);
                                return;
                            }
                            throw new Error('workspaceRegistry.archiveSession 不可用（进程内直取失败）');
                        };
                        if (sub === '/rp/sessions-archive') {
                            const ids = Array.isArray(payload.sessionIds) ? payload.sessionIds.map(String) : [];
                            if (ids.length === 0)
                                return send(400, { error: 'sessionIds required' });
                            const archived = [];
                            const failed = [];
                            for (const sid of ids) {
                                try {
                                    await archiveOne(sid);
                                    archived.push(sid);
                                }
                                catch (e) {
                                    failed.push({ sessionId: sid, error: e.message });
                                }
                            }
                            return send(200, { archived, failed });
                        }
                        // ---- R21c：/rp/sessions-autoclean —— 自动清理（dryRun 预览 → 执行）----
                        // POST {mode:'branch-parents'|'empty', dryRun?:boolean}：
                        // - branch-parents：归档全部"被 branch/fork 过的父会话"（= 回退/分叉后弃用的旧会话）
                        // - empty：归档全部 0 事件空壳会话
                        // origin=subagent 与 forked（branch 产物，用户在用）永不触碰。
                        if (sub === '/rp/sessions-autoclean') {
                            const mode = String(payload.mode ?? '');
                            const dryRun = payload.dryRun === true;
                            const all = await collectSessionsAudit();
                            const targets = all.filter(s => s.kind === (mode === 'empty' ? 'empty' : 'branch-parent'));
                            if (dryRun)
                                return send(200, { mode, dryRun: true, targets: targets.map(t => ({ sessionId: t.sessionId, workspace: t.workspace, events: t.events })) });
                            const archived = [];
                            const failed = [];
                            for (const t of targets) {
                                try {
                                    await archiveOne(t.sessionId);
                                    archived.push(t.sessionId);
                                }
                                catch (e) {
                                    failed.push({ sessionId: t.sessionId, error: e.message });
                                }
                            }
                            console.log(`[dsht-rp] sessions-autoclean(${mode}): archived=${archived.length} failed=${failed.length}`);
                            return send(200, { mode, archived, failed });
                        }
                        // ---- R17：/rp/convert-chat —— 确定性聊天转换（禁止 agent 手写 session 事件）----
                        // 两种模式（2026-09-04 瘦身：12.9MB jsonl 全量进 HTTP body = ANR/内存峰值，
                        // 手机 agent 自检实证——大 payload 一律走文件，不再过 HTTP）：
                        // - 文件模式（推荐，真机/长会话必用）：{filePath, sessionId, cwd, createdAt?}
                        //   → 从 dshHome 相对路径直读 → convertChatFile → **直接落盘**
                        //   sessions/<projectKey(cwd)>/<sessionId>/session.jsonl（已存在先备份 .bak2）
                        //   → 响应只回统计（零大 payload 往返）。
                        // - 旧文本模式（兼容 PC/小会话）：{jsonlText, sessionId, cwd?, createdAt?}
                        //   → 原样返回 {content,...}，agent 自行 write-files。
                        if (sub === '/rp/convert-chat') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(sessionId)) {
                                return send(400, { error: 'sessionId 非法（[a-z0-9-]，如 st-<hash>；见 slug-rules）' });
                            }
                            const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined;
                            const createdAt = Number.isSafeInteger(payload.createdAt) && payload.createdAt > 0
                                ? payload.createdAt
                                : Date.now();
                            const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
                            if (filePath !== '') {
                                const segs = filePath.split('/').filter(s => s.length > 0);
                                const safePath = filePath.length > 0 && !filePath.startsWith('/')
                                    && segs.every(s => s !== '.' && s !== '..')
                                    && segs.join('/').startsWith('rp-import/');
                                if (!safePath)
                                    return send(400, { error: 'filePath 必须是 dshHome 内 rp-import/ 下的相对路径' });
                                const srcAbs = (0, node_path_1.join)(dshHome, filePath);
                                if (!(0, node_path_1.resolve)(srcAbs).startsWith((0, node_path_1.resolve)(dshHome) + node_path_1.sep))
                                    return send(400, { error: 'filePath 越界' });
                                const text = await (0, promises_1.readFile)(srcAbs, 'utf8').catch(() => null);
                                if (text === null)
                                    return send(404, { error: `filePath 不存在：${filePath}` });
                                const conv = (0, dsh_export_ts_1.convertChatFile)(text, { sessionId, createdAt, cwd });
                                if (cwd === undefined)
                                    return send(400, { error: '文件模式必须带 cwd（直接落盘需要工作区路径）' });
                                const wsAbs = await (0, promises_1.realpath)(cwd).catch(() => cwd);
                                const target = (0, node_path_1.join)(dshHome, 'sessions', (0, dsh_export_ts_1.projectKey)(wsAbs), (0, dsh_export_ts_1.encodeSegment)(sessionId), 'session.jsonl');
                                const existed = await (0, promises_1.readFile)(target, 'utf8').then(() => true, () => false);
                                if (existed)
                                    await atomicWriteFile(`${target}.bak2`, await (0, promises_1.readFile)(target, 'utf8'));
                                await (0, promises_1.mkdir)((0, node_path_1.join)(target, '..'), { recursive: true });
                                // 【鲁棒轮收尾】原子发布——裸 writeFile 中途被杀 = torn session 会话打不开
                                await atomicWriteFile(target, conv.content);
                                console.log(`[dsht-rp] convert-chat(file): ${sessionId} ← ${filePath} → ${conv.turns} turns, ${conv.variantGroups} variant groups, ${conv.skipped} skipped`);
                                return send(200, {
                                    written: true, path: (0, node_path_1.relative)((0, node_path_1.join)(dshHome, 'sessions'), target).split(node_path_1.sep).join('/'),
                                    turns: conv.turns, skipped: conv.skipped, variantGroups: conv.variantGroups,
                                    firstUserText: conv.firstUserText, overwritten: existed,
                                });
                            }
                            const jsonlText = String(payload.jsonlText ?? '');
                            if (!jsonlText.trim())
                                return send(400, { error: 'jsonlText 或 filePath 必传其一' });
                            const conv = (0, dsh_export_ts_1.convertChatFile)(jsonlText, { sessionId, createdAt, cwd });
                            console.log(`[dsht-rp] convert-chat: ${sessionId} → ${conv.turns} turns, ${conv.variantGroups} variant groups, ${conv.skipped} skipped`);
                            return send(200, {
                                content: conv.content, turns: conv.turns, skipped: conv.skipped,
                                variantGroups: conv.variantGroups, firstUserText: conv.firstUserText,
                            });
                        }
                        // ---- R17b：/rp/rebuild-chats —— 批次聊天整包确定性重建 ----
                        // 真机实测教训：agent 手写 session 事件会把 turn 边界/变体链写烂（71 turn/start
                        // 对 1 turn/end，surface 被 replace 链折叠到只剩 1 条可见）。本路由用
                        // convertChatFile 对批次里全部聊天原地重建（覆盖同 sessionId 的损坏文件）。
                        // {batchId?}（缺省取最新 st-data 批次）→ {converted, overwritten, orphans, errors}。
                        if (sub === '/rp/rebuild-chats') {
                            const batchId = String(payload.batchId ?? '');
                            const importRoot = (0, node_path_1.join)(dshHome, 'rp-import');
                            let batchDir = '';
                            if (batchId) {
                                batchDir = (0, node_path_1.join)(importRoot, batchId);
                            }
                            else {
                                const batches = (await (0, promises_1.readdir)(importRoot).catch(() => []))
                                    .filter(d => d !== '_adapter').sort().reverse();
                                for (const b of batches) {
                                    if (await (0, import_preview_ts_1.findStDataRoot)((0, node_path_1.join)(importRoot, b, 'unpacked'))) {
                                        batchDir = (0, node_path_1.join)(importRoot, b);
                                        break;
                                    }
                                }
                            }
                            const stRoot = batchDir ? await (0, import_preview_ts_1.findStDataRoot)((0, node_path_1.join)(batchDir, 'unpacked')) : null;
                            if (!stRoot)
                                return send(404, { error: '找不到带 ST 数据的批次（先 import-stage）' });
                            // 卡名 → 工作区 slug（rp.json characterName 为准；对不上进 _orphan）
                            const slugByName = new Map();
                            const rpDir = (0, node_path_1.join)(dshHome, 'rp');
                            for (const dir of await (0, promises_1.readdir)(rpDir).catch(() => [])) {
                                try {
                                    const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpDir, dir, 'rp.json'), 'utf8'));
                                    if (rp.characterName)
                                        slugByName.set(rp.characterName, dir);
                                }
                                catch { /* 无 rp.json */ }
                            }
                            const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
                            const normMap = new Map();
                            for (const [n, s] of slugByName)
                                normMap.set(norm(n), s);
                            const chatsDir = (0, node_path_1.join)(stRoot, 'chats');
                            const owners = await (0, promises_1.readdir)(chatsDir).catch(() => []);
                            let converted = 0, overwritten = 0;
                            const orphans = [];
                            const errors = [];
                            for (const owner of owners) {
                                const ownerDir = (0, node_path_1.join)(chatsDir, owner);
                                const files = (await (0, promises_1.readdir)(ownerDir).catch(() => [])).filter(f => f.endsWith('.jsonl'));
                                if (files.length === 0)
                                    continue;
                                let slug = slugByName.get(owner) ?? normMap.get(norm(owner));
                                if (!slug) {
                                    // 三键兜底：卡内 name 与目录名只有标点差异的场景再试一次去标点匹配
                                    const stripped = norm(owner).replace(/[\p{P}\p{S}]/gu, '');
                                    for (const [n, s] of slugByName) {
                                        if (norm(n).replace(/[\p{P}\p{S}]/gu, '') === stripped) {
                                            slug = s;
                                            break;
                                        }
                                    }
                                }
                                if (!slug) {
                                    orphans.push(owner);
                                    continue;
                                }
                                const wsAbs = await (0, promises_1.realpath)((0, node_path_1.join)(rpDir, slug)).catch(() => (0, node_path_1.join)(rpDir, slug));
                                for (const f of files) {
                                    try {
                                        const text = await (0, promises_1.readFile)((0, node_path_1.join)(ownerDir, f), 'utf8');
                                        const sessionId = (0, dsh_export_ts_1.chatSessionId)(owner, f);
                                        let createdAt = Date.now();
                                        try {
                                            const meta = JSON.parse(text.split('\n')[0]);
                                            const cd = Date.parse(String(meta?.create_date ?? ''));
                                            if (Number.isSafeInteger(cd) && cd > 0)
                                                createdAt = cd;
                                        }
                                        catch { /* 无元数据行 */ }
                                        const conv = (0, dsh_export_ts_1.convertChatFile)(text, { sessionId, createdAt, cwd: wsAbs });
                                        const target = (0, node_path_1.join)(dshHome, 'sessions', (0, dsh_export_ts_1.projectKey)(wsAbs), (0, dsh_export_ts_1.encodeSegment)(sessionId), 'session.jsonl');
                                        const existed = await (0, promises_1.readFile)(target, 'utf8').then(() => true, () => false);
                                        if (existed)
                                            await atomicWriteFile(`${target}.bak2`, await (0, promises_1.readFile)(target, 'utf8'));
                                        await (0, promises_1.mkdir)((0, node_path_1.join)(target, '..'), { recursive: true });
                                        // 【鲁棒轮收尾】原子发布（同 convert-chat 文件模式）
                                        await atomicWriteFile(target, conv.content);
                                        // MVU 变量：chat_metadata.variables → rp/state/<sessionId>.json（裸对象形态）
                                        try {
                                            const meta = JSON.parse(text.split('\n')[0]);
                                            const vars = meta?.chat_metadata?.variables;
                                            if (vars && typeof vars === 'object' && Object.keys(vars).length > 0) {
                                                const statePath = (0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`);
                                                await (0, promises_1.mkdir)((0, node_path_1.dirname)(statePath), { recursive: true });
                                                await (0, atomic_fs_ts_1.atomicWriteText)(statePath, JSON.stringify(vars));
                                            }
                                        }
                                        catch { /* 变量缺失不阻塞 */ }
                                        converted++;
                                        if (existed)
                                            overwritten++;
                                    }
                                    catch (e) {
                                        errors.push(`${owner}/${f}: ${e.message}`);
                                    }
                                }
                            }
                            logLine(`rebuild-chats: ${converted} 聊天重建（覆盖 ${overwritten}），孤儿 ${orphans.length}`);
                            console.log(`[dsht-rp] rebuild-chats: converted=${converted} overwritten=${overwritten} orphans=${orphans.length} errors=${errors.length}`);
                            return send(200, { converted, overwritten, orphans, errors });
                        }
                        // ---- R18：/rp/session-rollback —— 会话回退（截断到 keepThroughSeq 含）----
                        // {sessionId, keepThroughSeq} → 双路径（2026-09-04）：
                        // - **live**（前端打开中，常态）：官方 append 原语**逻辑回退**——compaction/prune
                        //   计量 + user/message marker 带 surfaceOp replace 把 [目标消息之后, 视图末]
                        //   顶替掉。事件留在日志（聊天数据零丢失），模型视图与 UI 投影立即生效，
                        //   无需关闭会话/重启（409 文件手术路径对 RP 常态不可用，真机实证）。
                        // - 非 live：session.jsonl 文件截断（原路径：header 保留、事件只留
                        //   seq<=keepThroughSeq；先备份 .bak）。
                        // 两路径都做变量回滚（undo 日志回放）+ 文件快照回滚（非 live）。
                        if (sub === '/rp/session-rollback' || sub === '/rp/session-edit') {
                            const sessionId = String(payload.sessionId ?? '');
                            const keepThroughSeq = Number(payload.keepThroughSeq ?? -1);
                            const isEdit = sub === '/rp/session-edit';
                            const editSeq = isEdit ? Number(payload.seq ?? -1) : keepThroughSeq;
                            const editText = isEdit ? String(payload.text ?? '') : '';
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            if (isEdit) {
                                if (!Number.isInteger(editSeq) || editSeq < 0)
                                    return send(400, { error: 'seq 须为 >= 0 的整数' });
                                if (!editText.trim())
                                    return send(400, { error: 'text 不能为空' });
                            }
                            else {
                                if (!Number.isInteger(keepThroughSeq) || keepThroughSeq < 0)
                                    return send(400, { error: 'keepThroughSeq 须为 >= 0 的整数' });
                            }
                            const live = ctx.sessions?.get(sessionId);
                            // 【2026-09-08 用户语义】回退到此处 = 「内容回输入框」：includeAnchor=true 时
                            // 锚消息本身连同其后一切一起移出上下文（文本由前端放回 composer 供修改重发，
                            // ST「回退」同语义）。掩码 rolledBackTo = anchor-1 → UI 连锚一起隐藏。
                            const includeAnchor = payload.includeAnchor === true;
                            if (live !== undefined && typeof live.append === 'function' && Array.isArray(live.surface?.nodes)) {
                                // ---- live：逻辑回退（官方原语）——【鲁棒轮】per-session 串行（withLiveSurgery），
                                // 防 await replayUndoLog 窗口内并发请求捕获过期视图 → 错位 replace ----
                                return await withLiveSurgery(sessionId, async () => {
                                    const view = live.surface.nodes;
                                    const anchor = isEdit ? editSeq : keepThroughSeq; // edit 锚点消息本身也移出视图
                                    // 【2026-09-08 大会话修复】锚不在当前视图不再硬报错：视图窗口化/此前压缩
                                    // 后旧 seq 不在 surface.nodes（实机 155 轮会话 seq=1362 实证）。取视图中
                                    // 第一个 > 锚 的 seq 作为 replace 起点——「锚之后的一切移出上下文」语义
                                    // 不变（视图早于锚的节点本就应保留）。视图全部 ≤ 锚 → no-op。
                                    let start;
                                    const idx = view.indexOf(anchor);
                                    if (idx !== -1) {
                                        start = includeAnchor ? anchor : (idx + 1 < view.length ? view[idx + 1] : -1);
                                    }
                                    else {
                                        start = view.find(q => q > anchor) ?? -1;
                                    }
                                    if (start === -1 || start > view[view.length - 1])
                                        return send(200, { logical: true, replaced: 0, note: 'no-op（目标之后没有可回退的视图内容）' });
                                    const end = view[view.length - 1];
                                    const seqs = view.filter(q => q >= start);
                                    // 计量（core 估价器同款——replace 必须带紧邻 claim，否则投影/meter 不更新）
                                    let shadowed = 0;
                                    for (const q of seqs) {
                                        // 坑 #22：sessionEventAt 替代 live.events?.[q]（0.1.2 无公开 events）
                                        const raw = (sessionEventAt(live, q)?.data ?? {});
                                        // 【鲁棒轮 2026-09-09】assistant/message 的 payload 是 {turn,step,message:{...}}
                                        // ——原实现直接读 data.content 恒 undefined → 每条 assistant 消息只计 4
                                        // token（meter 严重少记；chat/update 路由 5710 行早已同口径解包，此处补齐）
                                        const d = (raw.message && typeof raw.message === 'object' ? raw.message : raw);
                                        const blocks = Array.isArray(d.content) ? d.content : [];
                                        shadowed += blocks.reduce((t, b) => t + (b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string' ? Math.ceil(b.text.length / 4) + 4 : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4;
                                    }
                                    // 【2026-09-08 鲁棒性】undo 回放挪到 claim 之前：compaction/prune claim 必须
                                    // **紧邻** marker replace（影子化协议铁律）——旧顺序 claim → await replayUndoLog
                                    // → marker，await 窗口里运行中 turn 的 append 会插进两者之间，投影/meter 漂移。
                                    const anchorTime = typeof sessionEventAt(live, anchor)?.time === 'number' ? sessionEventAt(live, anchor)?.time : Date.now();
                                    const undo = await (0, undo_ts_1.replayUndoLog)(dshHome, sessionId, anchorTime);
                                    live.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: shadowed });
                                    const markerText = isEdit
                                        ? `[消息已编辑] 该消息原文及其后的回复已从上下文移除，编辑后的新消息随后发出。`
                                        : includeAnchor
                                            ? `[已回退] 该消息及其后的对话已从上下文移除（原文已放回输入框；事件仍保留在日志，可经 /expand 查看）。`
                                            : `[已回退] 该消息之后的对话已从上下文移除（事件仍保留在日志，可经 /expand 查看）。`;
                                    live.append('user/message', {
                                        id: `dsht-rp-${isEdit ? 'edit' : 'rollback'}-${(0, node_crypto_1.randomUUID)()}`,
                                        role: 'user',
                                        content: [{ type: 'text', text: markerText }],
                                        source: isEdit
                                            ? { kind: 'plugin', plugin: 'dsht-rp', editedFrom: anchor }
                                            : { kind: 'plugin', plugin: 'dsht-rp', rolledBackTo: includeAnchor ? anchor - 1 : keepThroughSeq },
                                    }, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: seqs });
                                    logLine(`${isEdit ? 'session-edit' : 'session-rollback'}(live): ${sessionId} 锚 seq ${anchor} → replace [${start},${end}] ${seqs.length} 事件；变量回滚 ${undo.restored} 条`);
                                    console.log(`[dsht-rp] ${isEdit ? 'session-edit' : 'session-rollback'}: ${sessionId} (live) replace[${start},${end}] n=${seqs.length} undoRestored=${undo.restored}`);
                                    // I8-1：立即耐久 barrier——手机端进程被杀在 200ms 窗口内 = 回退标记丢失
                                    try {
                                        await flushLiveSession(ctx.sessions, live);
                                    }
                                    catch (e) {
                                        return send(500, { error: `${isEdit ? '编辑' : '回退'}已应用但落盘失败：${e.message}` });
                                    }
                                    rollbackMaskCache.clear();
                                    return send(200, { logical: true, replaced: seqs.length, variablesRestored: undo.restored, ...(isEdit ? { editedSeq: anchor } : { truncatedTo: keepThroughSeq }) });
                                }); // end withLiveSurgery
                            }
                            // ---- 非 live：文件截断（原路径）----
                            if (!isEdit) {
                                if (ctx.sessions?.get(sessionId) !== undefined) {
                                    return send(409, { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再回退' });
                                }
                                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId);
                                if (!hit)
                                    return send(404, { error: `session not found: ${sessionId}` });
                                const file = (0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl');
                                const content = await (0, promises_1.readFile)(file, 'utf8');
                                const r = (0, session_surgery_ts_3.truncateSessionJsonl)(content, keepThroughSeq);
                                if (r.error)
                                    return send(400, { error: r.error });
                                if (r.dropped === 0)
                                    return send(200, { kept: r.kept, dropped: 0, note: 'no-op（没有更靠后的事件）' });
                                // I8-3：手术锁（0.1.2 无 lease，防残留 runtime 并发写制造 seq gap）
                                try {
                                    await withSessionLock(file, async () => {
                                        const cur = await (0, promises_1.readFile)(file, 'utf8');
                                        if (cur !== content)
                                            throw new Error('会话文件在手术期间被并发修改——放弃本次手术');
                                        // I8-2：原子写（.bak 先 fsync 耐久，再原子发布正文件）
                                        await atomicWriteFile(`${file}.bak`, content);
                                        await atomicWriteFile(file, r.content);
                                    });
                                }
                                catch (e) {
                                    return send(409, { error: `会话手术锁失败：${e.message}` });
                                }
                                // 任务 1：文件快照整批回滚（dsh-tavern nativeCommits 思路）——截断点之后
                                // turn 的会话内文件写操作逆序恢复 before 状态（共享资产不在快照范围，
                                // 见 dsht-plugin-shared/file-snapshots.ts 头注），恢复后删除快照记录
                                const fsnap = await (0, file_snapshots_ts_1.restoreSnapshotsAfter)(dshHome, sessionId, (0, file_snapshots_ts_1.snapshotRestoreBoundary)(content, keepThroughSeq));
                                // 任务 4：变量联动回滚——undo 日志回放，把 ts 晚于截断点（截后日志最后
                                // 事件时间）的变量写按时间倒序恢复旧值（chat/character/global 三作用域），
                                // 回放后截断 undo 日志。
                                const cutoff = sessionContentMaxTime(r.content);
                                const undo = await (0, undo_ts_1.replayUndoLog)(dshHome, sessionId, cutoff);
                                rollbackMaskCache.clear(); // 掩码缓存按 mtime 失效已覆盖；显式 clear 与 edit/regenerate 分支一致（mtime 粒度内重复回退防串值）
                                logLine(`session-rollback: ${sessionId} 截到 seq ${keepThroughSeq}（留 ${r.kept} 事件，截 ${r.dropped}；变量回滚 ${undo.restored} 条；文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件）`);
                                console.log(`[dsht-rp] session-rollback: ${sessionId} → kept=${r.kept} dropped=${r.dropped} undoRestored=${undo.restored} snapshotTurns=${fsnap.restoredTurns.join(',')}`);
                                return send(200, { kept: r.kept, dropped: r.dropped, variablesRestored: undo.restored, fileSnapshots: { turns: fsnap.restoredTurns, restored: fsnap.filesRestored, deleted: fsnap.filesDeleted, errors: fsnap.errors } });
                            }
                            // edit 非 live：文件截断到目标消息之前（原 R20 语义）
                            {
                                // 【鲁棒轮 2026-09-09】live 会话 409 守卫（rollback/regenerate 非 live 分支
                                // 同款）——edit 漏了：会话已 attach 但 surface 异常降级时会直接做文件手术，
                                // 随后 live flush 把内存旧事件写回 → 内容复活/seq gap。
                                if (ctx.sessions?.get(sessionId) !== undefined) {
                                    return send(409, { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再编辑' });
                                }
                                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId);
                                if (!hit)
                                    return send(404, { error: `session not found: ${sessionId}` });
                                const file = (0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl');
                                const content = await (0, promises_1.readFile)(file, 'utf8');
                                const lines = content.split('\n');
                                let keep = -1;
                                let found = false;
                                let prevSeq = -1;
                                for (let i = 1; i < lines.length; i++) {
                                    const line = lines[i];
                                    if (!line.trim())
                                        continue;
                                    let ev = null;
                                    try {
                                        ev = JSON.parse(line);
                                    }
                                    catch {
                                        continue;
                                    }
                                    if (ev === null || typeof ev.seq !== 'number')
                                        continue;
                                    if (!found && ev.type === 'user/message' && ev.seq === editSeq
                                        && ev.data?.source?.kind === 'user') {
                                        keep = prevSeq;
                                        found = true;
                                        break;
                                    }
                                    prevSeq = ev.seq;
                                }
                                if (!found)
                                    return send(404, { error: `未找到该消息（seq=${editSeq} 的真用户消息不存在）` });
                                const r = (0, session_surgery_ts_3.truncateSessionJsonl)(content, keep);
                                if (r.error)
                                    return send(400, { error: r.error });
                                if (r.dropped === 0)
                                    return send(200, { truncatedTo: keep, truncated: 0, note: 'no-op（该消息之后没有事件）' });
                                // I8-3 + I8-2：手术锁 + 原子写（同 rollback）
                                try {
                                    await withSessionLock(file, async () => {
                                        const cur = await (0, promises_1.readFile)(file, 'utf8');
                                        if (cur !== content)
                                            throw new Error('会话文件在手术期间被并发修改——放弃本次手术');
                                        await atomicWriteFile(`${file}.bak`, content);
                                        await atomicWriteFile(file, r.content);
                                    });
                                }
                                catch (e) {
                                    return send(409, { error: `会话手术锁失败：${e.message}` });
                                }
                                const fsnap = await (0, file_snapshots_ts_1.restoreSnapshotsAfter)(dshHome, sessionId, (0, file_snapshots_ts_1.snapshotRestoreBoundary)(content, keep));
                                const undo = await (0, undo_ts_1.replayUndoLog)(dshHome, sessionId, sessionContentMaxTime(r.content));
                                logLine(`session-edit: ${sessionId} seq ${editSeq} 截到 keepThroughSeq ${keep}（截 ${r.dropped} 事件；变量回滚 ${undo.restored} 条）`);
                                console.log(`[dsht-rp] session-edit: ${sessionId} → seq=${editSeq} keep=${keep} truncated=${r.dropped} undoRestored=${undo.restored}`);
                                rollbackMaskCache.clear();
                                return send(200, { truncatedTo: keep, truncated: r.dropped, variablesRestored: undo.restored });
                            }
                        }
                        // ---- 任务 4：/rp/session-regenerate —— 重发最后一轮（前端拿 lastUserText 重发）----
                        // {sessionId} → 锚 = 最后一条真 user 消息。双路径（同 R18）：
                        // - live：逻辑回退——replace [锚消息之后, 视图末]，保留锚消息；返回 lastUserText
                        //   供前端 session.prompt 重发。事件留在日志，立即生效。
                        // - 非 live：文件截断 + 变量回滚 + 文件快照回滚（原路径）。
                        if (sub === '/rp/session-regenerate') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const live = ctx.sessions?.get(sessionId);
                            if (live !== undefined && typeof live.append === 'function' && Array.isArray(live.surface?.nodes)) {
                                // live：找事件流里最后一条真 user 消息——【鲁棒轮】per-session 串行（同 rollback）
                                return await withLiveSurgery(sessionId, async () => {
                                    const evList = [];
                                    let n = 0;
                                    for (const ev of sessionEventsSnapshot(live)) {
                                        const seq = typeof ev.seq === 'number' ? ev.seq : n++;
                                        if (!ev || ev.type !== 'user/message')
                                            continue;
                                        if (ev.data?.source?.kind !== 'user')
                                            continue;
                                        const blocks = Array.isArray(ev.data?.content) ? ev.data.content : [];
                                        const text = blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
                                        evList.push({ seq, time: typeof ev.time === 'number' ? ev.time : undefined, text });
                                    }
                                    evList.sort((a, b) => a.seq - b.seq);
                                    const anchorEv = evList[evList.length - 1];
                                    if (anchorEv === undefined)
                                        return send(400, { error: '会话里没有用户消息（无可重新生成的锚点）' });
                                    const view = live.surface.nodes;
                                    const idx = view.indexOf(anchorEv.seq);
                                    // 【2026-09-08 大会话修复】锚不在视图不再硬报错（回退路由同款降级）——
                                    // 取视图中第一个 > 锚 的 seq 作为 replace 起点；视图全部 ≤ 锚 → no-op。
                                    const start = idx !== -1
                                        ? (idx + 1 < view.length ? view[idx + 1] : -1)
                                        : (view.find(q => q > anchorEv.seq) ?? -1);
                                    if (start === -1 || start > view[view.length - 1])
                                        return send(200, { logical: true, replaced: 0, lastUserText: anchorEv.text, note: 'no-op（锚消息之后没有可重生成的视图内容）' });
                                    const end = view[view.length - 1];
                                    const seqs = view.filter(q => q >= start);
                                    let shadowed = 0;
                                    for (const q of seqs) {
                                        // 【鲁棒轮 2026-09-09】assistant/message 解包 data.message（同 rollback 补齐——
                                        // 原实现每条 assistant 消息只计 4 token，meter 少记）
                                        const raw = ((sessionEventAt(live, q)?.data) ?? {});
                                        const d = (raw.message && typeof raw.message === 'object' ? raw.message : raw);
                                        const blocks = Array.isArray(d.content) ? d.content : [];
                                        shadowed += blocks.reduce((t, b) => t + (b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string' ? Math.ceil(b.text.length / 4) + 4 : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4;
                                    }
                                    // 【2026-09-08 鲁棒性】undo 回放挪到 claim 之前（紧邻铁律，同 session-rollback）
                                    const anchorTime = typeof anchorEv.time === 'number' ? anchorEv.time : Date.now();
                                    const undo = await (0, undo_ts_1.replayUndoLog)(dshHome, sessionId, anchorTime);
                                    live.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: shadowed });
                                    const markerText = `[重新生成中] 该消息此前的回复已从上下文移除，正在以原消息重新生成。`;
                                    live.append('user/message', {
                                        id: `dsht-rp-regenerate-${(0, node_crypto_1.randomUUID)()}`,
                                        role: 'user',
                                        content: [{ type: 'text', text: markerText }],
                                        source: { kind: 'plugin', plugin: 'dsht-rp', regeneratedFrom: anchorEv.seq },
                                    }, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: seqs });
                                    logLine(`session-regenerate(live): ${sessionId} 锚 seq ${anchorEv.seq} → replace [${start},${end}] ${seqs.length} 事件；变量回滚 ${undo.restored} 条`);
                                    console.log(`[dsht-rp] session-regenerate: ${sessionId} (live) anchor=${anchorEv.seq} replace[${start},${end}] n=${seqs.length} undoRestored=${undo.restored}`);
                                    // I8-1：立即耐久 barrier（同 rollback）
                                    try {
                                        await flushLiveSession(ctx.sessions, live);
                                    }
                                    catch (e) {
                                        return send(500, { error: `重生成标记已应用但落盘失败：${e.message}` });
                                    }
                                    rollbackMaskCache.clear();
                                    return send(200, { logical: true, replaced: seqs.length, lastUserText: anchorEv.text, variablesRestored: undo.restored });
                                }); // end withLiveSurgery
                            }
                            // 非 live：文件截断（原路径）
                            {
                                if (ctx.sessions?.get(sessionId) !== undefined) {
                                    return send(409, { error: 'session live（内存态权威）：先在 DSH 里关闭该会话再重新生成' });
                                }
                                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId);
                                if (!hit)
                                    return send(404, { error: `session not found: ${sessionId}` });
                                const file = (0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl');
                                const content = await (0, promises_1.readFile)(file, 'utf8');
                                const events = [];
                                for (const line of content.split('\n').slice(1)) {
                                    if (!line.trim())
                                        continue;
                                    try {
                                        events.push(JSON.parse(line));
                                    }
                                    catch { /* 坏行跳过 */ }
                                }
                                const lastUser = (0, session_surgery_ts_3.findLastUserMessage)(events);
                                if (!lastUser)
                                    return send(400, { error: '会话里没有用户消息（无可重新生成的锚点）' });
                                const r = (0, session_surgery_ts_3.truncateSessionJsonl)(content, lastUser.seq);
                                if (r.error)
                                    return send(400, { error: r.error });
                                if (r.dropped === 0)
                                    return send(200, { truncated: 0, lastUserText: lastUser.text, variablesRestored: 0, note: 'no-op（最后一条用户消息之后没有事件）' });
                                // I8-3 + I8-2：手术锁 + 原子写（同 rollback）
                                try {
                                    await withSessionLock(file, async () => {
                                        const cur = await (0, promises_1.readFile)(file, 'utf8');
                                        if (cur !== content)
                                            throw new Error('会话文件在手术期间被并发修改——放弃本次手术');
                                        await atomicWriteFile(`${file}.bak`, content);
                                        await atomicWriteFile(file, r.content);
                                    });
                                }
                                catch (e) {
                                    return send(409, { error: `会话手术锁失败：${e.message}` });
                                }
                                // 任务 1：文件快照整批回滚（同 session-rollback；截到最后用户消息 = 腰斩
                                // 该 turn → includeBoundary，该 turn 内的文件写一并回退）
                                const fsnap = await (0, file_snapshots_ts_1.restoreSnapshotsAfter)(dshHome, sessionId, (0, file_snapshots_ts_1.snapshotRestoreBoundary)(content, lastUser.seq));
                                const undo = await (0, undo_ts_1.replayUndoLog)(dshHome, sessionId, sessionContentMaxTime(r.content));
                                logLine(`session-regenerate: ${sessionId} 截到最后用户消息 seq ${lastUser.seq}（截 ${r.dropped} 事件；变量回滚 ${undo.restored} 条；文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件）`);
                                console.log(`[dsht-rp] session-regenerate: ${sessionId} → anchor=${lastUser.seq} truncated=${r.dropped} undoRestored=${undo.restored} snapshotTurns=${fsnap.restoredTurns.join(',')}`);
                                return send(200, { truncated: r.dropped, lastUserText: lastUser.text, variablesRestored: undo.restored, fileSnapshots: { turns: fsnap.restoredTurns, restored: fsnap.filesRestored, deleted: fsnap.filesDeleted, errors: fsnap.errors } });
                            }
                        }
                        // ---- R18b：/rp/rollback-mask —— 逻辑回退掩码查询（前端 UI 隐藏被回退消息）----
                        // {sessionId} → {hideAfter}：从 session.jsonl 扫 dsht-rp 的回退/编辑/重新生成
                        // marker（source.rolledBackTo / editedFrom / regeneratedFrom），取最大锚。
                        // 客户端投影不透传 marker 的 source 字段（真机实证），故由 host 从日志解析、
                        // 前端 store 拉取——UI 隐藏 seq > hideAfter 的真实消息（楼层号同步重排）。
                        if (sub === '/rp/rollback-mask') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            // 缓存（性能，2026-09-04）：前端每个消息行组件挂载都触发本路由——全量扫
                            // session.jsonl 在大会话上是可观的重复 I/O。按文件 mtime 失效：变了才重扫。
                            // （逻辑回退/编辑/重新生成的 live 分支成功后会 clear 本缓存——见下）
                            let hide = 0;
                            const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId);
                            if (hit) {
                                const file = (0, node_path_1.join)(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl');
                                const fm = await (0, promises_1.stat)(file).then(s => ({ size: s.size, mtimeMs: s.mtimeMs })).catch(() => null);
                                const cached = rollbackMaskCache.get(file);
                                if (fm !== null && cached !== undefined && cached.size === fm.size && cached.mtimeMs === fm.mtimeMs) {
                                    return send(200, { hideAfter: cached.hide });
                                }
                                const content = await (0, promises_1.readFile)(file, 'utf8');
                                // 【⑨修复 2026-09-05】掩码只隐被 replace 的那段，不隐 marker 之后的新消息：
                                // 扫描时若 marker 之后已存在 source.kind === 'user' 的新消息，掩码失效
                                let markerSeq = -1;
                                for (const line of content.split('\n')) {
                                    if (!line.includes('rolledBackTo') && !line.includes('editedFrom') && !line.includes('regeneratedFrom'))
                                        continue;
                                    try {
                                        const ev = JSON.parse(line);
                                        const s = ev.data?.source;
                                        if (!s)
                                            continue;
                                        if (typeof s.rolledBackTo === 'number') {
                                            hide = Math.max(hide, s.rolledBackTo);
                                            markerSeq = Math.max(markerSeq, ev.seq ?? -1);
                                        }
                                        if (typeof s.regeneratedFrom === 'number') {
                                            hide = Math.max(hide, s.regeneratedFrom);
                                            markerSeq = Math.max(markerSeq, ev.seq ?? -1);
                                        }
                                        if (typeof s.editedFrom === 'number') {
                                            hide = Math.max(hide, s.editedFrom - 1);
                                            markerSeq = Math.max(markerSeq, ev.seq ?? -1);
                                        }
                                    }
                                    catch { /* 坏行跳过 */ }
                                }
                                // marker 之后的新用户消息 → 掩码失效（新消息 seq > markerSeq 且 source.kind === 'user'）
                                if (markerSeq >= 0) {
                                    for (const line of content.split('\n')) {
                                        try {
                                            const ev = JSON.parse(line);
                                            if (typeof ev.seq === 'number' && ev.seq > markerSeq && ev.type === 'user/message' && ev.data?.source?.kind === 'user') {
                                                hide = 0; // 掩码失效：新消息已覆盖回退段
                                                break;
                                            }
                                        }
                                        catch { /* 坏行跳过 */ }
                                    }
                                }
                                if (fm !== null)
                                    rollbackMaskCache.set(file, { ...fm, hide });
                            }
                            return send(200, { hideAfter: hide });
                        }
                        // ---- R19：/rp/import-reset —— 清空 RP 相关数据（zip 重导重置；前端弹窗确认后调）----
                        // （/rp/session-edit 已并入 R18 双路径：live 逻辑回退 + 非 live 文件截断）
                        // 删：rp/ 下除 _start 外全部（含 rp/state/、rp/global-books.json、rp/regex/）、
                        // skills/wb-*、rp-presets/*、.agent-presets/rp-* 与 st-*、
                        // sessions/ 下 cwd 属于 rp/<slug>（slug≠_start）的会话目录。rp-import/ 批次保留。
                        if (sub === '/rp/import-reset') {
                            const removed = { workspaces: 0, skills: 0, rpPresets: 0, agentPresets: 0, sessions: 0 };
                            const errors = [];
                            const rmEntry = async (abs, bucket) => {
                                try {
                                    await (0, promises_1.rm)(abs, { recursive: true, force: true });
                                    removed[bucket]++;
                                }
                                catch (e) {
                                    errors.push(`${abs}: ${e.message}`);
                                }
                            };
                            // rp/ 下除 _start 外全部（state/、global-books.json、regex/ 随目录项一起清）
                            try {
                                for (const d of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp'))) {
                                    if (d === '_start')
                                        continue;
                                    await rmEntry((0, node_path_1.join)(dshHome, 'rp', d), 'workspaces');
                                }
                            }
                            catch { /* 无 rp 目录 */ }
                            try {
                                for (const d of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'skills'))) {
                                    if (d.startsWith('wb-'))
                                        await rmEntry((0, node_path_1.join)(dshHome, 'skills', d), 'skills');
                                }
                            }
                            catch { /* 无 skills 目录 */ }
                            try {
                                for (const d of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'))) {
                                    await rmEntry((0, node_path_1.join)(dshHome, 'rp-presets', d), 'rpPresets');
                                }
                            }
                            catch { /* 无 rp-presets 目录 */ }
                            try {
                                for (const d of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, '.agent-presets'))) {
                                    if (d.startsWith('rp-') || d.startsWith('st-'))
                                        await rmEntry((0, node_path_1.join)(dshHome, '.agent-presets', d), 'agentPresets');
                                }
                            }
                            catch { /* 无 .agent-presets 目录 */ }
                            // 会话：cwd 属于 rp/<slug>（slug≠_start；相对/绝对/symlink/Windows 反斜杠形态都认）的目录删
                            const rpCwdSlug = (cwd) => {
                                if (!cwd)
                                    return null;
                                const n = normAndroidPath(cwd).replaceAll('\\', '/');
                                const m = n.match(/(?:^|\/)rp\/([^/]+)$/);
                                return m ? m[1] : null;
                            };
                            for (const h of await scanSessionHeaders()) {
                                const slug = rpCwdSlug(h.cwd);
                                if (slug === null || slug === '_start')
                                    continue;
                                await rmEntry((0, node_path_1.join)(dshHome, 'sessions', h.project, h.sdir), 'sessions');
                                // 空 project 目录顺手清掉（读目录确认空了才删，防误删同项目其他会话）
                                const leftovers = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'sessions', h.project)).catch(() => null);
                                if (leftovers !== null && leftovers.length === 0) {
                                    await (0, promises_1.rm)((0, node_path_1.join)(dshHome, 'sessions', h.project), { recursive: true, force: true });
                                }
                            }
                            // 缓存失效（下轮重读空态）
                            globalRegexCache = null;
                            presetCache.clear();
                            presetRegexCache.clear();
                            bookCache.clear();
                            activeStPresetCache = undefined; // rp-presets 清空 → ST 激活预设默认重解析
                            logLine(`import-reset: 工作区 ${removed.workspaces}、书 ${removed.skills}、RP 预设 ${removed.rpPresets}、agent 预设 ${removed.agentPresets}、会话 ${removed.sessions}；失败 ${errors.length}`);
                            console.log(`[dsht-rp] import-reset: ${JSON.stringify(removed)} errors=${errors.length}`);
                            return send(200, { removed, errors, note: 'rp-import/ 批次目录与 rp/_start 欢迎工作区保留；live 会话的内存态不受影响（重开会话生效）' });
                        }
                        // ---- R14：/rp/register-workspaces —— 迁移收尾一次性可见性注册 ----
                        // 扫 $DSH_HOME/rp/*/（rp.json 拿 characterName），对每个工作区：
                        // workspace.create（幂等）+ rename(卡名) + 迁移会话归组（attachSession）。
                        // 优先 host 进程内直调 WorkspaceRegistry（attach 不需要 resume agent，
                        // 比 session.create 认领轻得多）；服务不可达时回退 loopback /api（无归组）。
                        // 顺带：先跑存量 cwd 修复 + st-* 预设 agent preset 回填（热发现，无需重启）。
                        // 客户端刷新：workspace.* 变更经 host 帧即时推送到侧边栏；会话清单由
                        // RP overlay 调完后触发 ctx.sessions.refresh()。
                        // 0.1.2 坑 #21：workspace.list 端点已删除（改 workspace/follow 流，浏览器端
                        // 直连要过 mux websocket）——这里进程内直取 registry 一次性回视图，供 RP
                        // overlay 角色列表与对账使用（免网关/免 cookie）。
                        if (sub === '/workspace-views') {
                            const reg = getWorkspaceRegistry();
                            if (reg === null)
                                return send(503, { error: 'workspaceRegistry 不可用（宿主服务未就绪）' });
                            const items = reg.list().map(w => ({
                                workspaceId: w.id,
                                path: w.path ?? '',
                                title: w.title,
                            }));
                            return send(200, { items });
                        }
                        if (sub === '/rp/register-workspaces') { // R17：先修 seq 断号再归组（断号会话 DSH 拒绝打开，attach 进去也是坏的）
                            const seqRepair = await repairAllSessionSeqs();
                            const repair = await repairSessionCwds();
                            // 会话按 cwd 的 realpath 规范形态归桶（attach 校验走同一规范）
                            const byCanonicalCwd = new Map();
                            for (const h of await scanSessionHeaders()) {
                                if (h.cwd === undefined)
                                    continue;
                                try {
                                    const canonical = await (0, promises_1.realpath)(h.cwd);
                                    const list = byCanonicalCwd.get(canonical) ?? [];
                                    list.push(h.sessionId);
                                    byCanonicalCwd.set(canonical, list);
                                }
                                catch { /* cwd 不可解（相对路径/已删目录）跳过 */ }
                            }
                            const rpRoot = (0, node_path_1.join)(dshHome, 'rp');
                            let slugs = [];
                            try {
                                slugs = await (0, promises_1.readdir)(rpRoot);
                            }
                            catch { /* 无 rp 目录 */ }
                            const registered = [];
                            const registry = getWorkspaceRegistry();
                            if (registry !== null) {
                                for (const slug of slugs.sort()) {
                                    let characterName = slug;
                                    try {
                                        const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpRoot, slug, 'rp.json'), 'utf8'));
                                        if (typeof rp.characterName === 'string' && rp.characterName.trim())
                                            characterName = rp.characterName.trim();
                                    }
                                    catch {
                                        continue;
                                    } // 无 rp.json 的目录不是 RP 工作区
                                    const entry = { slug, name: characterName };
                                    try {
                                        const dir = (0, node_path_1.join)(rpRoot, slug);
                                        const canonical = await (0, promises_1.realpath)(dir).catch(() => dir);
                                        let entity = await registry.resolveByPath(canonical);
                                        let created = false;
                                        if (entity === undefined) {
                                            entity = await registry.create(canonical);
                                            created = true;
                                        }
                                        entry.workspaceId = entity.id;
                                        entry.created = created;
                                        // 命名：默认名（basename）或与卡名不同则改；重名冲突加 slug 后缀
                                        if (entity.title !== characterName) {
                                            const conflict = registry.list().some(w => w.id !== entity.id && w.title === characterName);
                                            const title = conflict ? `${characterName} · ${slug.slice(-6)}` : characterName;
                                            await entity.setTitle(title);
                                            entry.renamed = title;
                                        }
                                        // 会话归组：cwd 规范形态命中的迁移会话 attach 进工作区账户
                                        const adopted = [];
                                        const adoptFailed = [];
                                        for (const sid of byCanonicalCwd.get(canonical) ?? []) {
                                            try {
                                                await entity.attachSession(sid);
                                                adopted.push(sid);
                                            }
                                            catch (e) {
                                                adoptFailed.push({ sessionId: sid, error: e.message });
                                            }
                                        }
                                        entry.adopted = adopted;
                                        if (adoptFailed.length > 0)
                                            entry.adoptFailed = adoptFailed;
                                    }
                                    catch (e) {
                                        entry.error = e.message;
                                    }
                                    registered.push(entry);
                                }
                            }
                            else {
                                // 回退：loopback /api（workspace.create + rename；会话归组不可用，如实标注）
                                // 0.1.2 坑 #21 续：workspace.list 端点已删除（改 workspace/follow 流）——
                                // registry 再试一次拿存量集合；仍不可用则空集合盲建（重复风险如实进 note）
                                const regRetry = getWorkspaceRegistry();
                                const existingPaths = new Set();
                                if (regRetry !== null) {
                                    try {
                                        for (const w of regRetry.list())
                                            existingPaths.add(String(w.path ?? ''));
                                    }
                                    catch { /* list 失败不阻塞——盲建 */ }
                                }
                                for (const slug of slugs.sort()) {
                                    let characterName = slug;
                                    try {
                                        const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpRoot, slug, 'rp.json'), 'utf8'));
                                        if (typeof rp.characterName === 'string' && rp.characterName.trim())
                                            characterName = rp.characterName.trim();
                                    }
                                    catch {
                                        continue;
                                    }
                                    const entry = { slug, name: characterName };
                                    try {
                                        const dir = (0, node_path_1.join)(rpRoot, slug);
                                        const canonical = await (0, promises_1.realpath)(dir).catch(() => dir);
                                        if (existingPaths.has(canonical)) {
                                            entry.created = false;
                                        }
                                        else {
                                            const ws = await hostRpc('workspace.create', { request: { path: canonical } });
                                            const workspace = ws.workspace;
                                            entry.workspaceId = workspace?.workspaceId ?? null;
                                            entry.created = true;
                                            if (workspace?.workspaceId) {
                                                try {
                                                    await hostRpc('workspace.rename', { request: { workspaceId: workspace.workspaceId, title: characterName } });
                                                    entry.renamed = characterName;
                                                }
                                                catch {
                                                    try {
                                                        await hostRpc('workspace.rename', { request: { workspaceId: workspace.workspaceId, title: `${characterName} · ${slug.slice(-6)}` } });
                                                        entry.renamed = `${characterName} · ${slug.slice(-6)}`;
                                                    }
                                                    catch { /* rename 失败不阻塞 */ }
                                                }
                                            }
                                        }
                                        entry.note = 'registry 服务不可达（loopback 回退）：会话归组未执行';
                                    }
                                    catch (e) {
                                        entry.error = e.message;
                                    }
                                    registered.push(entry);
                                }
                            }
                            // R5 回填：st-* RP 预设 → .agent-presets/（agent preset 发现是逐次扫盘，写完即可见）
                            await ensureRpPresetSync();
                            // 任务 2 存量迁移：.agent-presets/rp-* → rp.json.promptPersona 后删除（在用会话的保留）
                            const cardPresetMigration = await migrateCardAgentPresets();
                            const createdCount = registered.filter(r => r.created === true).length;
                            const adoptedCount = registered.reduce((n, r) => n + (Array.isArray(r.adopted) ? r.adopted.length : 0), 0);
                            const errorCount = registered.filter(r => typeof r.error === 'string').length;
                            logLine(`register-workspaces: ${registered.length} 个工作区（新建 ${createdCount}），归组会话 ${adoptedCount}，失败 ${errorCount}`);
                            console.log(`[dsht-rp] register-workspaces: workspaces=${registered.length} created=${createdCount} adopted=${adoptedCount} errors=${errorCount} mode=${registry !== null ? 'registry' : 'loopback'}`);
                            return send(200, {
                                mode: registry !== null ? 'registry' : 'loopback',
                                workspaces: registered,
                                repair,
                                seqRepair,
                                cardPresetMigration,
                                refresh: 'workspace.* 变更帧已推送；会话清单请客户端调 sessions.refresh（session.list 为逐次扫盘，host 侧无缓存）',
                            });
                        }
                        // ---- 第五轮：/rp/backfill-assets —— 卡内嵌正则 + 酒馆助手脚本库确定性补齐 ----
                        // 背景（用户实测抓到）：迁移 agent 漏写卡 extensions.regex_scripts（SKILL.md 有
                        // 契约但没执行——ExampleGame 卡 17 条 249KB 全丢）；卡/预设的 extensions.tavern_helper
                        // .scripts（悬浮球等前端脚本库）整体未搬运。此路由幂等补齐：
                        // - 卡：rp.json.regex 为空 ← card.json embeddedRegex（parseCharacterCard 归一）；
                        //   tavern_helper.scripts 原样落 rp/<slug>/tavern-helper-scripts.json（数据保全）。
                        // - 预设：按 displayName 匹配最近批次 unpacked OpenAI Settings/*.json，
                        //   tavern_helper.scripts 落 rp-presets/<id>/tavern-helper-scripts.json。
                        if (sub === '/rp/backfill-assets') {
                            const cards = [];
                            const presets = [];
                            const errors = [];
                            // ---- 卡 ----
                            let slugs = [];
                            try {
                                slugs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp'));
                            }
                            catch { /* 无 rp 目录 */ }
                            for (const slug of slugs) {
                                if (slug === '_start')
                                    continue;
                                try {
                                    const dir = (0, node_path_1.join)(dshHome, 'rp', slug);
                                    const st = await (0, promises_1.stat)(dir);
                                    if (!st.isDirectory())
                                        continue; // rp/ 下的散文件（persona.json 等）跳过
                                    let rawCard = '';
                                    try {
                                        rawCard = await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'card.json'), 'utf8');
                                    }
                                    catch {
                                        continue;
                                    } // 无卡目录（regex/state 等）跳过
                                    const rpPath = (0, node_path_1.join)(dir, 'rp.json');
                                    const rp = JSON.parse(await (0, promises_1.readFile)(rpPath, 'utf8'));
                                    const card = (0, character_card_ts_1.importCharacterJson)(rawCard, slug);
                                    let filled = false;
                                    if (card && card.embeddedRegex.length > 0 && (!Array.isArray(rp.regex) || rp.regex.length === 0)) {
                                        await snapshotRpFiles(await sessionIdForSlug(slug), [`rp/${slug}/rp.json`]);
                                        rp.regex = card.embeddedRegex;
                                        await (0, promises_1.writeFile)(rpPath, JSON.stringify(rp, null, 1), 'utf8');
                                        filled = true;
                                    }
                                    // 酒馆助手脚本库（卡作用域，原样搬运）
                                    const rawJ = JSON.parse(rawCard);
                                    const cdata = (rawJ.data && typeof rawJ.data === 'object' ? rawJ.data : rawJ);
                                    const cext = (cdata.extensions && typeof cdata.extensions === 'object' ? cdata.extensions : {});
                                    const th = (cext.tavern_helper && typeof cext.tavern_helper === 'object'
                                        ? cext.tavern_helper.scripts : undefined);
                                    let thCount = 0;
                                    if (Array.isArray(th) && th.length > 0) {
                                        await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'tavern-helper-scripts.json'), JSON.stringify({ scripts: th }, null, 1), 'utf8');
                                        thCount = th.length;
                                    }
                                    cards.push({ slug, embeddedRegex: card?.embeddedRegex.length ?? 0, filled, tavernHelperScripts: thCount });
                                }
                                catch (e) {
                                    errors.push(`card ${slug}: ${e.message}`);
                                }
                            }
                            // ---- 预设（最近批次 OpenAI Settings 原文按 displayName 匹配）----
                            try {
                                const batches = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import'))).filter(isValidBatchId).sort().reverse();
                                for (const b of batches) {
                                    const dir = (0, node_path_1.join)(dshHome, 'rp-import', b);
                                    let stRoot = 'data/default-user';
                                    try {
                                        const meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                                        if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot)
                                            stRoot = meta.manifest.stRoot;
                                    }
                                    catch { /* 无 meta 用默认 */ }
                                    const oaiDir = (0, node_path_1.join)(dir, 'unpacked', stRoot, 'OpenAI Settings');
                                    let files = [];
                                    try {
                                        files = (await (0, promises_1.readdir)(oaiDir)).filter(f => f.endsWith('.json'));
                                    }
                                    catch {
                                        continue;
                                    }
                                    if (files.length === 0)
                                        continue;
                                    let presetDirs = [];
                                    try {
                                        presetDirs = await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-presets'));
                                    }
                                    catch {
                                        break;
                                    }
                                    for (const pid of presetDirs.sort()) {
                                        try {
                                            const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', pid, 'preset.json'), 'utf8'));
                                            if (typeof p.displayName !== 'string')
                                                continue;
                                            const file = files.find(f => f.replace(/\.json$/i, '') === p.displayName);
                                            if (!file)
                                                continue;
                                            const st = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(oaiDir, file), 'utf8'));
                                            const scripts = st.extensions?.tavern_helper?.scripts;
                                            if (!Array.isArray(scripts) || scripts.length === 0)
                                                continue;
                                            await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, 'rp-presets', pid, 'tavern-helper-scripts.json'), JSON.stringify({ scripts }, null, 1), 'utf8');
                                            presets.push({ presetId: pid, displayName: p.displayName, tavernHelperScripts: scripts.length });
                                        }
                                        catch (e) {
                                            errors.push(`preset ${pid}: ${e.message}`);
                                        }
                                    }
                                    break; // 只用最近一个有效批次
                                }
                            }
                            catch { /* 无批次 */ }
                            // ---- 会话状态文件形状规范化（历史扁平 MVU 裸树 → {variables: tree}）----
                            let stateFixed = 0;
                            try {
                                for (const f of await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp', 'state'))) {
                                    if (!f.endsWith('.json') || f.endsWith('.undo.jsonl'))
                                        continue;
                                    try {
                                        const fp = (0, node_path_1.join)(dshHome, 'rp', 'state', f);
                                        const parsed = JSON.parse(await (0, promises_1.readFile)(fp, 'utf8'));
                                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                                            continue;
                                        if (Object.keys(parsed).some(k => STATE_RESERVED_KEYS.has(k)))
                                            continue; // 已包裹
                                        const sid = f.replace(/\.json$/, '');
                                        await snapshotRpFiles(sid, [`rp/state/${f}`]);
                                        await (0, promises_1.writeFile)(fp, JSON.stringify({ variables: parsed }), 'utf8');
                                        stateFixed++;
                                    }
                                    catch (e) {
                                        errors.push(`state ${f}: ${e.message}`);
                                    }
                                }
                            }
                            catch { /* 无 state 目录 */ }
                            const filledCards = cards.filter(c => c.filled === true).length;
                            logLine(`backfill-assets: 卡正则补齐 ${filledCards}/${cards.length}，酒馆助手脚本库 卡 ${cards.filter(c => c.tavernHelperScripts > 0).length} 份 + 预设 ${presets.length} 份，状态文件规范化 ${stateFixed} 个`);
                            console.log(`[dsht-rp] backfill-assets: cards=${cards.length} filled=${filledCards} presets=${presets.length} stateFixed=${stateFixed} errors=${errors.length}`);
                            return send(200, { cards, presets, errors });
                        }
                        // ---- R4：/rp/import-api-config —— ST API 配置导入 DSH ----
                        // 两种入参：{batchId}（从批次 unpacked/ 找 settings.json+secrets.json）
                        // 或 {settingsJson, secretsJson?} 直传（原文 JSON 字符串）。
                        // 优先 host 内直调 settings/credentials 服务（llm-pi-ai 路由 live 注册，
                        // 无需重启）；服务不可用时退化为写 settings.yaml/.credentials.yaml（需重启）。
                        // 安全：凭据值绝不进日志与响应（响应只回 keyRef 名）。
                        if (sub === '/rp/import-api-config') {
                            let settings = {};
                            let secrets = {};
                            let root = null;
                            if (typeof payload.settingsJson === 'string' && payload.settingsJson.trim()) {
                                // 直传模式（无批次上下文）
                                try {
                                    settings = JSON.parse(payload.settingsJson);
                                }
                                catch {
                                    return send(400, { error: 'settingsJson 不是合法 JSON' });
                                }
                                if (typeof payload.secretsJson === 'string' && payload.secretsJson.trim()) {
                                    try {
                                        secrets = JSON.parse(payload.secretsJson);
                                    }
                                    catch { /* 无凭据 */ }
                                }
                            }
                            else {
                                const batchId = String(payload.batchId ?? '');
                                if (!isValidBatchId(batchId))
                                    return send(400, { error: 'batchId 或 settingsJson 必给其一' });
                                const batchDir = (0, node_path_1.join)(dshHome, 'rp-import', batchId);
                                root = await (0, import_preview_ts_1.findStDataRoot)((0, node_path_1.join)(batchDir, 'unpacked'));
                                if (!root)
                                    return send(404, { error: '批次内找不到 settings.json（不是 ST data 结构？）' });
                                try {
                                    settings = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(root, 'settings.json'), 'utf8'));
                                }
                                catch { /* 坏文件 */ }
                                try {
                                    secrets = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(root, 'secrets.json'), 'utf8'));
                                }
                                catch { /* 无 secrets */ }
                            }
                            const parsed = parseStApiConfig(settings, secrets);
                            if (!parsed)
                                return send(400, { error: 'settings.json 里识别不到可用的 API 配置（无模型名）' });
                            if (ctx.settings && ctx.credentials) {
                                // RPC（进程内直调）：凭据 → provider profile → 默认模型指向导入路由
                                if (parsed.keyValue)
                                    await ctx.credentials.set(parsed.keyRef, parsed.keyValue);
                                await ctx.settings.update('llm-pi-ai', { providers: { [parsed.provider]: parsed.profile } });
                                if (ctx.agentDefaultModel?.saveSelection) {
                                    try {
                                        await ctx.agentDefaultModel.saveSelection({ provider: parsed.provider, model: parsed.model });
                                    }
                                    catch { /* 默认模型设置失败不阻塞 */ }
                                }
                                logLine(`import-api-config: ${parsed.provider}（${parsed.model}）经 settings/credentials 服务写入，live 生效`);
                                console.log(`[dsht-rp] import-api-config: provider=${parsed.provider} model=${parsed.model} key=${parsed.keyRef}${parsed.keyValue ? '' : '（无凭据）'} method=rpc`);
                                return send(200, {
                                    provider: parsed.provider, baseURL: parsed.baseURL ?? null, model: parsed.model,
                                    keyNames: [parsed.keyRef], keyConfigured: parsed.keyValue !== null,
                                    method: 'rpc', restarted: false, stRoot: root,
                                });
                            }
                            // 文件退化：settings.yaml + .credentials.yaml（重启生效）
                            const yamlStr = (s) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
                            const credPath = (0, node_path_1.join)(dshHome, '.credentials.yaml');
                            if (parsed.keyValue) {
                                let cred = '';
                                try {
                                    cred = await (0, promises_1.readFile)(credPath, 'utf8');
                                }
                                catch { /* 新建 */ }
                                const line = `${parsed.keyRef}: ${yamlStr(parsed.keyValue)}`;
                                const re = new RegExp(`^${parsed.keyRef}:.*$`, 'm');
                                cred = re.test(cred) ? cred.replace(re, line) : cred.trimEnd() + (cred.trim() ? '\n' : '') + line + '\n';
                                await (0, promises_1.writeFile)(credPath, cred, { encoding: 'utf8', mode: 0o600 });
                            }
                            const settingsPath = (0, node_path_1.join)(dshHome, 'settings.yaml');
                            let doc = '';
                            try {
                                doc = await (0, promises_1.readFile)(settingsPath, 'utf8');
                            }
                            catch { /* 新建 */ }
                            if (/^llm-pi-ai:/m.test(doc)) {
                                return send(409, { error: 'settings.yaml 已有 llm-pi-ai 段，文件退化模式无法安全合并——请经 DSH 设置 → 模型手工配置，或重启后重试（RPC 模式）' });
                            }
                            const profileYaml = Object.entries(parsed.profile)
                                .map(([k, v]) => `      ${k}: ${typeof v === 'string' ? yamlStr(v) : JSON.stringify(v)}`).join('\n');
                            const modelsYaml = Array.isArray(parsed.profile.models)
                                ? `\n      models:\n${parsed.profile.models.map(m => `        - id: ${yamlStr(m.id)}\n          name: ${yamlStr(m.name)}`).join('\n')}`
                                : '';
                            const block = `llm-pi-ai:\n  providers:\n    ${parsed.provider}:\n${Object.entries(parsed.profile).filter(([k]) => k !== 'models').map(([k, v]) => `      ${k}: ${typeof v === 'string' ? yamlStr(v) : JSON.stringify(v)}`).join('\n')}${modelsYaml}\nagent-default-model:\n  provider: ${yamlStr(parsed.provider)}\n  model: ${yamlStr(parsed.model)}\n`;
                            void profileYaml;
                            await (0, promises_1.writeFile)(settingsPath, doc.trimEnd() + (doc.trim() ? '\n' : '') + block, 'utf8');
                            logLine(`import-api-config: ${parsed.provider} 写入 settings.yaml（重启生效）`);
                            return send(200, {
                                provider: parsed.provider, baseURL: parsed.baseURL ?? null, model: parsed.model,
                                keyNames: [parsed.keyRef], keyConfigured: parsed.keyValue !== null,
                                method: 'file', restarted: true, stRoot: root,
                            });
                        }
                        // T2.11：迁移写盘（嵌入导入中心 writeDshFiles 的 node 侧实现——
                        // 替代 Android DSHTNative.writeDshFiles 桥；白名单语义同 Kotlin 原版）
                        // 2026-09-04 节流：百级文件批量落盘（迁移段）连续写大文件会把事件循环
                        // 拉满（ANR 判定窗口，手机 agent 自检实证）——每 4 个文件让出一拍，
                        // 让 pending I/O / UI 帧得到调度；单文件仍走异步 writeFile。
                        if (sub === '/write-files') {
                            const files = Array.isArray(payload.files)
                                ? payload.files
                                : [];
                            const allowPrefixes = ['skills/', '.agent-presets/', 'sessions/', 'rp/', 'rp-presets/', 'rp-import/'];
                            let written = 0;
                            const failed = [];
                            let batch = 0;
                            for (const f of files) {
                                if ((batch++ % 4) === 0 && batch > 1)
                                    await new Promise(r => { setImmediate(r); });
                                const rel = String(f?.path ?? '');
                                // T3.1b：二进制内容（{base64}），用于立绘 avatar.png 落盘
                                const binary = (f?.binary && f.binary !== false) || (typeof f?.content === 'object' && f.content !== null);
                                const content = String(f?.content ?? '');
                                const segs = rel.split('/').filter(s => s.length > 0);
                                const safe = rel.length > 0 && !rel.startsWith('/')
                                    && segs.every(s => s !== '.' && s !== '..')
                                    && allowPrefixes.some(p => segs.join('/').startsWith(p));
                                if (!safe) {
                                    failed.push(`${rel}: 非法路径`);
                                    continue;
                                }
                                try {
                                    const abs = (0, node_path_1.join)(dshHome, rel);
                                    // canonical 越界防御（.. 逃逸）
                                    if (!(0, node_path_1.resolve)(abs).startsWith((0, node_path_1.resolve)(dshHome) + node_path_1.sep)) {
                                        failed.push(`${rel}: 越界`);
                                        continue;
                                    }
                                    await (0, promises_1.mkdir)((0, node_path_1.dirname)(abs), { recursive: true });
                                    if (binary) {
                                        const b64 = String(f?.content?.base64 ?? f?.content ?? '');
                                        await (0, promises_1.writeFile)(abs, Buffer.from(b64, 'base64'));
                                    }
                                    else {
                                        await (0, promises_1.writeFile)(abs, content, 'utf8');
                                    }
                                    written++;
                                }
                                catch (e) {
                                    failed.push(`${rel}: ${e.message}`);
                                }
                            }
                            logLine(`write-files: ${written} 个文件已写, ${failed.length} 失败`);
                            return send(200, { written, failed, dshHome });
                        }
                        if (sub === '/variant/groups') {
                            const sessionId = String(payload.sessionId ?? '');
                            const session = ctx.sessions?.get(sessionId);
                            if (!session)
                                return send(404, { error: 'session not attached (open it in DSH first)' });
                            const groups = collectVariantGroups(sessionEventsSnapshot(session));
                            const seen = new Set();
                            const list = [];
                            for (const g of groups.values()) {
                                if (seen.has(g))
                                    continue;
                                seen.add(g);
                                list.push({ members: g.members, activeSeq: g.activeSeq });
                            }
                            return send(200, { groups: list });
                        }
                        if (sub === '/variant/switch') {
                            const sessionId = String(payload.sessionId ?? '');
                            const targetSeq = Number(payload.targetSeq ?? -1);
                            const session = ctx.sessions?.get(sessionId);
                            if (!session)
                                return send(404, { error: 'session not attached (open it in DSH first)' });
                            // 当前 active：surface 上的 assistant 消息中，target 所属组的 active
                            // 0.1.2 坑 #22：session.events 数组已移除——snapshotEvents() 快照替代
                            const s2 = session;
                            const eventsForGroups = (typeof s2.snapshotEvents === 'function' ? s2.snapshotEvents() : s2.events ?? []);
                            const groups = collectVariantGroups(eventsForGroups);
                            const group = groups.get(targetSeq);
                            if (!group)
                                return send(400, { error: 'target not in any variant group' });
                            if (group.activeSeq === targetSeq)
                                return send(200, { ok: true, note: 'already active' });
                            const target = group.members.find(m => m.seq === targetSeq);
                            if (!target)
                                return send(400, { error: 'target member missing' });
                            const ev = buildVariantSwitchEvent(sessionId, eventsForGroups.length, group.activeSeq, target.text);
                            if (!ev)
                                return send(400, { error: 'empty target text' });
                            session.append(ev.type, ev.data, {
                                surfaceOp: ev.surfaceOp,
                                sourceEventSeqs: ev.sourceEventSeqs,
                            });
                            group.activeSeq = targetSeq;
                            groups.set(targetSeq, group);
                            console.log(`[dsht-rp] variant switch: session=${sessionId} → seq ${targetSeq}`);
                            // I8-1：立即耐久 barrier（切变体后崩溃 = 变体切换丢失）
                            try {
                                await flushLiveSession(ctx.sessions, session);
                            }
                            catch (e) {
                                return send(500, { error: `变体切换已应用但落盘失败：${e.message}` });
                            }
                            return send(200, { ok: true });
                        }
                        // ---- /llm/classify：导入管线 AI 语义分类（§4.5 第二层，非可选项）----
                        // 入参 { system?, prompt } → 走已配置默认模型与凭据的一次性补全 → { ok, text }
                        // 分类协议（类目/输出 JSON 形状）由调用方组织——插件侧保持薄通道。
                        if (sub === '/llm/classify') {
                            if (!ctx.llm)
                                return send(503, { error: 'llm service unavailable' });
                            const sel = ctx.agentDefaultModel?.currentSelection?.();
                            if (!sel?.provider || !sel?.model) {
                                return send(503, { error: 'no default model configured (先在导入中心配置 API 连接)' });
                            }
                            const system = typeof payload.system === 'string' && payload.system.trim()
                                ? payload.system
                                : '你是 SillyTavern → DSH 迁移管线的语义分类器。严格按用户指定的 JSON 协议输出，不要输出任何 JSON 之外的文字。';
                            const prompt = String(payload.prompt ?? '');
                            if (!prompt.trim())
                                return send(400, { error: 'empty prompt' });
                            let text = '';
                            for await (const chunk of ctx.llm.stream({
                                provider: sel.provider,
                                model: sel.model,
                                system,
                                messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                            })) {
                                if (chunk.type === 'text-delta' && typeof chunk.text === 'string')
                                    text += chunk.text;
                            }
                            console.log(`[dsht-rp] llm/classify: ${sel.provider}/${sel.model} → ${text.length}ch`);
                            // D4 产物日志化（诊断面板可见）：额外解析时把模型原文尾部落 logLine
                            const extraNote = payload.extraAnalysis === true;
                            if (extraNote)
                                logLine(`MVU 额外解析产物（${text.length}ch）：${text.slice(-300)}`);
                            return send(200, { ok: true, text });
                        }
                        // ---- /trace：组装 trace（T1.5："这条消息怎么被生成的"，前端/调试消费）----
                        if (sub === '/trace') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const trace = lastTrace.get(sessionId);
                            if (!trace)
                                return send(404, { error: 'no trace yet (send a message first)' });
                            return send(200, { trace });
                        }
                        // ---- /rp/home：DSH_HOME 绝对路径（overlay 建 session 拼 cwd 用）----
                        if (sub === '/rp/home') {
                            return send(200, { dshHome });
                        }
                        // ---- §2.3 ③：/rp/chat-prefs → 聊天界面偏好（楼层号显示；前端徽章开关）----
                        if (sub === '/rp/chat-prefs') {
                            return send(200, readChatPrefs());
                        }
                        // ---- I4：/rp/identity?slug= → {user, char}（显示期核心宏的数据源；persona active 优先）----
                        // 【实机测试修复 2026-09-05】路由匹配用 subPath（剥 query）——客户端按
                        // POST+查询串消费，用 sub 全串匹配时带 ?slug= 必 404（显示期宏静默退化）。
                        if (subPath === '/rp/identity') {
                            const slugQ = String(new URL(req.url ?? '/', 'http://localhost').searchParams.get('slug') ?? '');
                            const persona = await (0, macros_ts_2.loadActivePersona)(dshHome);
                            let char = '';
                            let macrosUser = '';
                            if (slugQ) {
                                try {
                                    const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', slugQ, 'rp.json'), 'utf8'));
                                    char = typeof rp?.macros?.char === 'string' && rp.macros.char ? rp.macros.char : String(rp?.characterName ?? '');
                                    macrosUser = typeof rp?.macros?.user === 'string' ? rp.macros.user : '';
                                }
                                catch { /* 无 rp.json */ }
                            }
                            return send(200, {
                                user: persona?.name || macrosUser || '用户',
                                char: char || '角色',
                                persona: persona?.description ?? '',
                            });
                        }
                        // ---- I8-6：/rp/flush-all POST → 全部 live 会话立即耐久（诊断/手动触发用；
                        // Android 壳走 flush-request 文件通道，不依赖 HTTP）----
                        if (subPath === '/rp/flush-all' && req.method === 'POST') {
                            const n = await flushAllLiveSessions('http');
                            return send(200, { ok: true, flushed: n });
                        }
                        // ---- D4：MVU 额外模型解析——回复无有效更新块时，用默认模型的一次性补全
                        // 产出 <UpdateVariable>（ST MagVarUpdate isDuringExtraAnalysis 同语义）。
                        // POST {sessionId, reply?} → {ok, applied, patches, note?}
                        if (sub === '/rp/mvu/extra-analyze' && req.method === 'POST') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const settings = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'mvu-settings.json'), 'utf8')
                                .then(t => JSON.parse(t)).catch(() => ({}));
                            const enabled = settings.enableExtraAnalysis === true || settings.extra_analysis_enabled === true
                                || (settings.extraAnalysis && settings.extraAnalysis.enabled === true);
                            if (!enabled)
                                return send(200, { ok: false, applied: 0, note: '额外模型解析未开启（mvu-settings.enableExtraAnalysis）' });
                            const session = ctx.sessions?.get(sessionId);
                            let replyText = typeof payload.reply === 'string' ? payload.reply : '';
                            if (!replyText && session) {
                                const snap = sessionEventsSnapshot(session);
                                for (let i = snap.length - 1; i >= 0; i--) {
                                    const ev = snap[i];
                                    if (ev?.type === 'assistant/message') {
                                        replyText = messageText(ev.data.message ?? {});
                                        break;
                                    }
                                }
                            }
                            if (!replyText.trim())
                                return send(400, { error: 'no assistant reply to analyze' });
                            if ((0, mvu_ts_1.parseUpdateVariable)(replyText).length > 0 || (0, mvu_ts_1.parseJsonPatches)(replyText).length > 0) {
                                return send(200, { ok: true, applied: 0, note: '回复已含有效更新块（无需额外解析）' });
                            }
                            if (!ctx.llm)
                                return send(503, { error: 'llm service unavailable' });
                            const sel = ctx.agentDefaultModel?.currentSelection?.();
                            if (!sel?.provider || !sel?.model)
                                return send(503, { error: 'no default model configured' });
                            const stCur = await loadSessionState(sessionId);
                            // 【审查修复 2026-09-05】统一 state 主树：生成期摘要读 state ?? variables、
                            // 运行期 UpdateVariable 写 state——D4 补丁必须落 state 才对下一轮可见
                            const stateNow = (0, mvu_ts_1.renderStateSummary)((stCur.state ?? stCur.variables ?? {}));
                            const system = '你是 MVU 变量解析器。根据角色回复与当前状态，产出本轮需要的变量更新。只输出一个 <UpdateVariable> 块，块内是 <JSONPatch> 包裹的 JSON 数组（op: add/replace/remove，path 为 JSON Pointer，value 为新值），不要输出任何其他文字。形态示例：\n<UpdateVariable>\n<JSONPatch>\n[{"op":"replace","path":"/好感度","value":5},{"op":"replace","path":"/地点","value":"仓库"}]\n</JSONPatch>\n</UpdateVariable>\n没有需要更新的变量时输出空数组。';
                            const prompt = `【当前状态】\n${stateNow || '（空）'}\n\n【角色回复】\n${replyText.slice(0, 8000)}\n\n请输出 <UpdateVariable> 更新块（按系统提示的形态；本轮确实无变化就输出空数组）。`;
                            let text = '';
                            try {
                                for await (const chunk of ctx.llm.stream({
                                    provider: sel.provider, model: sel.model, system,
                                    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                                })) {
                                    if (chunk.type === 'text-delta' && typeof chunk.text === 'string')
                                        text += chunk.text;
                                }
                            }
                            catch (e) {
                                logLine(`MVU 额外解析 LLM 流失败（无降级）：${e.message}`);
                                return send(500, { error: `LLM 流调用失败：${e.message}` });
                            }
                            // 解析链：UpdateVariable 块 → 裸 JSONPatch 块 → 裸 JSON 数组（模型不守包装时兜底）
                            let patches = (0, mvu_ts_1.parseUpdateVariable)(text).length > 0 ? (0, mvu_ts_1.parseUpdateVariable)(text) : (0, mvu_ts_1.parseJsonPatches)(text);
                            if (patches.length === 0) {
                                const arrM = text.match(/\[[\s\S]*\]/);
                                if (arrM) {
                                    try {
                                        const arr = JSON.parse(arrM[0]);
                                        if (Array.isArray(arr) && arr.every(p => p && typeof p === 'object' && 'op' in p && 'path' in p)) {
                                            patches = arr;
                                        }
                                    }
                                    catch { /* 非数组 JSON */ }
                                }
                            }
                            // D4 产物日志化：模型原文尾部落 logLine（诊断面板可见，排查格式不守约定时用）
                            logLine(`MVU 额外解析产物（${text.length}ch）：${text.slice(-300)}`);
                            if (patches.length === 0)
                                return send(200, { ok: false, applied: 0, note: '额外解析未产出有效更新块' });
                            const st2 = await loadSessionState(sessionId);
                            const before = (st2.state ?? st2.variables ?? {});
                            await (0, undo_ts_1.appendUndoEntries)(dshHome, sessionId, patches.map(p => (0, undo_ts_1.makeUndoEntry)('chat', '', p.path, before)));
                            st2.state = (0, mvu_ts_1.applyStatePatches)(before, patches);
                            await saveSessionState(sessionId, st2);
                            logLine(`MVU 额外解析：${patches.length} 个补丁已应用（${sessionId}，模型 ${sel.model}）`);
                            return send(200, { ok: true, applied: patches.length, patches });
                        }
                        // ---- /rp/session-cwd {sessionId} → {cwd}（dock 席位 props 的 session 快照
                        // 不带 cwd——cwd 在宿主 useSessions().byId；前端悬浮球/开场白窗的 RP 门槛用）----
                        if (sub === '/rp/session-cwd') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const headers = await scanSessionHeaders();
                            const h = headers.find(x => x.sessionId === sessionId);
                            return send(200, { cwd: h?.cwd ?? null });
                        }
                        // ---- 任务 C：/rp/status —— 迁移验收面板的只读聚合（大白话数据源）----
                        // 最近批次（meta.json manifest 计数）+ 最新 migration-report.md 资源清单表计数
                        // + 当前 API 连接（agentDefaultModel 选择）。插件存活探测由前端各自 ping。
                        if (sub === '/rp/status') {
                            let latestBatch = null;
                            try {
                                const dirs = (await (0, promises_1.readdir)((0, node_path_1.join)(dshHome, 'rp-import'))).sort().reverse();
                                for (const d of dirs) {
                                    if (!isValidBatchId(d))
                                        continue;
                                    const dir = (0, node_path_1.join)(dshHome, 'rp-import', d);
                                    let meta = {};
                                    try {
                                        meta = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dir, 'meta.json'), 'utf8'));
                                    }
                                    catch { /* 无 meta */ }
                                    // 迁移报告的资源清单表：| 类别 | 总数 | 成功 | 失败 | 说明 |
                                    let report = null;
                                    for (const rf of ['migration-report.md', 'REPORT.md']) {
                                        try {
                                            const text = await (0, promises_1.readFile)((0, node_path_1.join)(dir, rf), 'utf8');
                                            const rows = [];
                                            for (const line of text.split('\n')) {
                                                const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
                                                if (m)
                                                    rows.push({ category: String(m[1]), total: Number(m[2]), ok: Number(m[3]), fail: Number(m[4]) });
                                            }
                                            report = rows;
                                            break;
                                        }
                                        catch { /* 无报告，试下一个文件名 */ }
                                    }
                                    latestBatch = {
                                        batchId: d,
                                        name: typeof meta.name === 'string' ? meta.name : d,
                                        stagedAt: typeof meta.stagedAt === 'string' ? meta.stagedAt : null,
                                        manifest: meta.manifest ?? null,
                                        hasReport: report !== null,
                                        report,
                                    };
                                    break; // 只取最新一批
                                }
                            }
                            catch { /* 无 rp-import 目录 */ }
                            let api = null;
                            try {
                                const sel = ctx.agentDefaultModel?.currentSelection?.();
                                if (sel?.provider && sel?.model)
                                    api = { provider: sel.provider, model: sel.model };
                            }
                            catch { /* 未配置 */ }
                            return send(200, { latestBatch, api });
                        }
                        // ---- /rp/workspaces：角色工作区清单（扫 $DSH_HOME/rp/*/rp.json）----
                        if (sub === '/rp/workspaces') {
                            const list = [];
                            try {
                                const rpDir = (0, node_path_1.join)(dshHome, 'rp');
                                const dirs = await (0, promises_1.readdir)(rpDir);
                                for (const slug of dirs.sort()) {
                                    try {
                                        const text = await (0, promises_1.readFile)((0, node_path_1.join)(rpDir, slug, 'rp.json'), 'utf8');
                                        const o = JSON.parse(text);
                                        // 备选开场白（PROJECT_PLAN 补全）：rp.json 不落盘备选——归属位是原始卡
                                        // JSON（card.json）的 data.alternate_greetings（ST V2/V3）或顶层
                                        // alternate_greetings（V1）。无 card.json 的旧工作区按无备选处理。
                                        let alternateGreetings = [];
                                        try {
                                            const card = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpDir, slug, 'card.json'), 'utf8'));
                                            const raw = Array.isArray(card.data?.alternate_greetings)
                                                ? card.data.alternate_greetings
                                                : Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [];
                                            alternateGreetings = raw.map(g => String(g ?? '').trim()).filter(g => g !== '');
                                        }
                                        catch { /* 无 card.json（旧导入/无源数据）→ 无备选 */ }
                                        list.push({
                                            slug,
                                            name: o.characterName ?? slug,
                                            bookCount: Array.isArray(o.books) ? o.books.length : 0,
                                            books: Array.isArray(o.books)
                                                ? o.books.map(b => ({ name: String(b?.name ?? ''), lorePath: String(b?.lorePath ?? '') }))
                                                : [],
                                            firstMes: o.firstMes ?? '',
                                            alternateGreetings,
                                            outputProtocol: {
                                                actionTags: o.outputProtocol?.actionTags ?? ['a', 'selection'],
                                                wrapTags: o.outputProtocol?.wrapTags ?? ['content'],
                                                statusTags: o.outputProtocol?.statusTags ?? ['status', 'statusbar', 'StatusBlock'],
                                                // T2.10 渲染补差（旧 rp.json 缺字段走默认）
                                                collapsibleTags: o.outputProtocol?.collapsibleTags ?? ['details'],
                                                stateUpdateTags: o.outputProtocol?.stateUpdateTags ?? ['UpdateVariable'],
                                                reasoningTags: o.outputProtocol?.reasoningTags ?? ['Analysis'],
                                                foreshadowingTags: o.outputProtocol?.foreshadowingTags ?? ['foreshadowings'],
                                            },
                                        });
                                    }
                                    catch { /* 坏 rp.json 跳过 */ }
                                }
                            }
                            catch { /* 无 rp 目录 */ }
                            return send(200, { workspaces: list, dshHome });
                        }
                        // ---- T2.6：世界书后期绑定（ST 允许事后换书；归属位 = RP 启动器角色详情）----
                        // /rp/books {} → 库内全部世界书 skill（skills/wb-*/references/lore.json）
                        // 增量字段（只读）：entryCount（条目数，管理界面用）+ global（R9 全局书单，rp/global-books.json）
                        if (sub === '/rp/books') {
                            const books = [];
                            try {
                                const skillsDir = (0, node_path_1.join)(dshHome, 'skills');
                                for (const dir of (await (0, promises_1.readdir)(skillsDir)).sort()) {
                                    const lorePath = `skills/${dir}/references/lore.json`;
                                    try {
                                        const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, lorePath), 'utf8');
                                        const parsed = JSON.parse(text);
                                        books.push({
                                            slug: dir, name: parsed.name ?? dir, lorePath,
                                            entryCount: Array.isArray(parsed.entries) ? parsed.entries.length : 0,
                                        });
                                    }
                                    catch { /* 无 lore.json 的目录跳过 */ }
                                }
                            }
                            catch { /* 无 skills 目录 */ }
                            let global = [];
                            try {
                                const g = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', 'global-books.json'), 'utf8'));
                                global = Array.isArray(g?.books)
                                    ? g.books.filter(b => typeof b?.lorePath === 'string').map(b => ({ name: String(b.name ?? b.lorePath), lorePath: String(b.lorePath) }))
                                    : [];
                            }
                            catch { /* 无全局书单 */ }
                            return send(200, { books, global });
                        }
                        // /rp/bind-books {slug, books: [{name, lorePath}]} → 角色工作区重绑世界书（写 rp.json.books）
                        if (sub === '/rp/bind-books') {
                            const slug = String(payload.slug ?? '');
                            if (!slug)
                                return send(400, { error: 'slug required' });
                            const rpPath = (0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json');
                            let rp;
                            try {
                                rp = JSON.parse(await (0, promises_1.readFile)(rpPath, 'utf8'));
                            }
                            catch {
                                return send(404, { error: `rp.json not found: ${slug}` });
                            }
                            const books = Array.isArray(payload.books)
                                ? payload.books
                                    .filter(b => typeof b?.lorePath === 'string')
                                    .map(b => ({ name: String(b.name ?? b.lorePath), lorePath: String(b.lorePath) }))
                                : [];
                            rp.books = books;
                            // 任务 1：写前文件快照（归属会话 = payload.sessionId ?? 该 slug 名下会话）
                            await snapshotRpFiles(String(payload.sessionId ?? '') || await sessionIdForSlug(slug), [`rp/${slug}/rp.json`]);
                            await (0, promises_1.writeFile)(rpPath, JSON.stringify(rp, null, 1), 'utf8');
                            console.log(`[dsht-rp] bind-books: ${slug} → ${books.length} books`);
                            return send(200, { ok: true, count: books.length });
                        }
                        // ---- /rp/import-card：单卡导入（node 侧解析 + 复合卡拆解 + 落盘 + 欢迎会话摘要）----
                        if (sub === '/rp/import-card') {
                            const json = String(payload.json ?? '');
                            const nameHint = typeof payload.name === 'string' && payload.name ? payload.name : 'imported';
                            const card = (0, character_card_ts_1.importCharacterJson)(json, nameHint);
                            if (!card)
                                return send(400, { error: '无法解析（不是有效的角色卡 JSON）' });
                            const files = (0, dsh_export_ts_1.exportSingleCardFiles)(card, dshHome);
                            let written = 0;
                            for (const f of files) {
                                const abs = (0, node_path_1.join)(dshHome, f.path);
                                await (0, promises_1.mkdir)((0, node_path_1.dirname)(abs), { recursive: true });
                                await (0, promises_1.writeFile)(abs, f.content, 'utf8');
                                written++;
                            }
                            // T2.6 方案 B：导入摘要写进欢迎会话（harness 工作过程在会话里可见）
                            try {
                                const skillCount = files.filter(f => f.path.startsWith('skills/')).length;
                                const hasSession = files.some(f => f.path.endsWith('/session.jsonl'));
                                const summary = `**导入完成：${card.name}**\n\n- 写入 ${written} 个文件（preset + 工作区${skillCount > 0 ? ` + 内嵌世界书 skill（${skillCount} 文件）` : ''}${hasSession ? ' + 开场白会话' : ''}）\n- 到「🎭 角色扮演」→「角色」页点开「${card.name}」即可开聊。`;
                                const welcomeSession = ctx.sessions?.get('dsht-welcome');
                                if (welcomeSession) {
                                    // surfaceOp 必须走对象形态（append(type, data, {surfaceOp})）——
                                    // 旧代码传裸字符串，第三参读取 .surfaceOp 为 undefined，消息
                                    // 不进 surface（UI 不显示、模型不可见），此为修复。
                                    welcomeSession.append('user/message', {
                                        id: `dsht-imp-req-${Date.now()}`,
                                        role: 'user',
                                        content: [{ type: 'text', text: `导入角色卡：${card.name}` }],
                                        source: { kind: 'user' },
                                    }, { surfaceOp: 'append' });
                                    welcomeSession.append('assistant/message', {
                                        turn: 1, step: 1,
                                        message: {
                                            id: `dsht-imp-res-${Date.now()}`,
                                            role: 'assistant',
                                            content: [{ type: 'text', text: summary }],
                                            source: { kind: 'model', provider: 'dsht-import', model: 'import-summary' },
                                        },
                                    }, { surfaceOp: 'append' });
                                    // I8-1：欢迎会话 append 后立即耐久（导入摘要窗口崩溃不丢）
                                    try {
                                        await flushLiveSession(ctx.sessions, welcomeSession);
                                    }
                                    catch (e) {
                                        console.log(`[dsht-rp] import-card: welcome flush 失败（内存态保留）：${e.message}`);
                                    }
                                }
                            }
                            catch { /* 摘要失败不影响导入本体 */ }
                            console.log(`[dsht-rp] import-card: ${card.name} → ${written} files`);
                            return send(200, { ok: true, written, characterName: card.name });
                        }
                        // ---- T3.1b：/rp/export-card {slug} —— 导出 ST 兼容 PNG 卡 ----
                        // 读 rp/<slug>/card.json（原样 ST JSON）+ avatar.png（立绘）；无卡 JSON 则
                        // 用 rp.json 还原；无立绘用占位 PNG 兜底。返回 base64 PNG 供前端下载。
                        if (sub === '/rp/export-card') {
                            const slug = String(payload.slug ?? '');
                            if (!slug)
                                return send(400, { error: 'slug required' });
                            const wsDir = (0, node_path_1.join)(dshHome, 'rp', slug);
                            try {
                                let json = '';
                                try {
                                    json = await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'card.json'), 'utf8'); // 原样 ST JSON
                                }
                                catch {
                                    // 无 card.json（旧导入/无源数据）→ 用 rp.json 重建 V2
                                    const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'rp.json'), 'utf8'));
                                    json = buildStV2FromRp(rp).replaceAll('{{char}}', rp.characterName).replaceAll('{{user}}', rp.macros?.user ?? '用户');
                                }
                                let avatar = null;
                                try {
                                    const b64 = await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'avatar.png'), 'base64');
                                    avatar = new Uint8Array(Buffer.from(b64, 'base64'));
                                }
                                catch { /* 无立绘：占位兜底 */ }
                                const base = avatar ?? (0, card_export_ts_1.makePlaceholderPng)(rpNameFrom(json));
                                const png = (0, card_export_ts_1.writeCardTextChunks)(base, json);
                                return send(200, {
                                    filename: `${rpNameFrom(json)}.png`,
                                    base64: (0, card_export_ts_1.bytesToBase64)(png),
                                    rawJson: json,
                                    hadAvatar: !!avatar,
                                });
                            }
                            catch (e) {
                                return send(500, { error: `导出失败：${e.message}` });
                            }
                        }
                        // ---- T3.1b：/rp/export-bundle {slug} —— 原生卡包目录格式 ----
                        // 产出 card.json + worldbook + regex + depth + avatar 的包（base64 列表），
                        // 前端打 zip 或逐文件下载。
                        if (sub === '/rp/export-bundle') {
                            const slug = String(payload.slug ?? '');
                            if (!slug)
                                return send(400, { error: 'slug required' });
                            const wsDir = (0, node_path_1.join)(dshHome, 'rp', slug);
                            try {
                                const files = [];
                                let json = '';
                                try {
                                    json = await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'card.json'), 'utf8');
                                }
                                catch {
                                    const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'rp.json'), 'utf8'));
                                    json = buildStV2FromRp(rp).replaceAll('{{char}}', rp.characterName).replaceAll('{{user}}', rp.macros?.user ?? '用户');
                                }
                                files.push({ path: 'card.json', content: json });
                                let avatar = null;
                                try {
                                    const b64 = await (0, promises_1.readFile)((0, node_path_1.join)(wsDir, 'avatar.png'), 'base64');
                                    avatar = new Uint8Array(Buffer.from(b64, 'base64'));
                                }
                                catch { /* 无 */ }
                                const fileName = rpNameFrom(json);
                                files.push({ path: 'avatar.png', content: (0, card_export_ts_1.bytesToBase64)(avatar ?? (0, card_export_ts_1.makePlaceholderPng)(fileName)), binary: true });
                                return send(200, { files, name: fileName });
                            }
                            catch (e) {
                                return send(500, { error: `导出失败：${e.message}` });
                            }
                        }
                        // ---- T2.6 补：/rp/open-chat {slug, sessionId} —— 物化开场白 ----
                        // 用户定案（ST 同款语义）：卡的工作区新开 session 必带开场白——firstMes
                        // 落成真实的 assistant 消息 turn（oneTurnLog 契约：turn/start →
                        // step/start → assistant/message(surface append) → step/end → turn/end），
                        // 气泡流可见、参与历史，而非只进 pre-step 快照（快照路径保留给旧工作区
                        // 与 DSH 原生新建的 session 兜底）。幂等：surface 已有消息则跳过。
                        if (sub === '/rp/open-chat') {
                            const slug = String(payload.slug ?? '');
                            const sessionId = String(payload.sessionId ?? '');
                            if (!slug || !sessionId)
                                return send(400, { error: 'slug and sessionId required' });
                            const session = ctx.sessions?.get(sessionId);
                            if (!session)
                                return send(404, { error: 'session not live（先经 session.create 创建）' });
                            const rp = await loadRpJson(slug, new AbortController().signal);
                            if (!rp)
                                return send(404, { error: `rp.json not found: ${slug}` });
                            const hasMessages = session.surface.nodes.some(seq => {
                                // 0.1.2 坑 #22：eventAt(seq) 替代 .events[seq]（直索引会 TypeError）
                                const ev = session.eventAt?.(seq);
                                return ev !== undefined && (ev.type === 'user/message' || ev.type === 'assistant/message');
                            });
                            if (hasMessages)
                                return send(200, { ok: true, note: 'already has messages' });
                            // 备选开场白（PROJECT_PLAN 补全）：可选 greeting 覆写——「以此开场重新开始」
                            // 复用同一路由物化选中的备选开场白；宏替换/落盘/幂等语义与 firstMes 一致
                            const greeting = typeof payload.greeting === 'string' && payload.greeting.trim() !== '' ? payload.greeting.trim() : '';
                            const firstMes = greeting || (rp.firstMes ?? '').trim();
                            if (!firstMes)
                                return send(200, { ok: true, note: 'no firstMes' });
                            // 开场白宏替换 + turn 续接（0.1.2 坑 #22：snapshotEvents() 找最后一个 turn/start，
                            // 空白新会话即 1——.events 数组已随 0.1.2 移除）
                            // 【wuwa 终验修复 2026-09-05】persona active 优先（与 pre-step/显示期一致）
                            const persona = await (0, macros_ts_2.loadActivePersona)(dshHome);
                            const userName = persona?.name || (await loadUserProfileCached(dshHome)).name || rp.macros.user || '用户';
                            const text = firstMes
                                .replaceAll('{{char}}', rp.macros.char || rp.characterName)
                                .replaceAll('{{user}}', userName);
                            const snap = session.snapshotEvents?.() ?? [];
                            const turn = (snap.findLast?.(ev => ev?.type === 'turn/start')?.data?.turn ?? 0) + 1;
                            session.append('turn/start', { turn });
                            session.append('step/start', { turn, step: 1 });
                            session.append('assistant/message', {
                                turn, step: 1,
                                message: {
                                    id: `dsht-open-${(0, node_crypto_1.randomUUID)()}`,
                                    role: 'assistant',
                                    content: [{ type: 'text', text }],
                                    source: { kind: 'model', provider: 'dsht-rp', model: 'first-mes' },
                                },
                            }, { surfaceOp: 'append' });
                            session.append('step/end', { turn, step: 1 });
                            session.append('turn/end', { turn, reason: { kind: 'completed' } });
                            // 【R49 2026-09-06】同步内核 agent 的 turn 计数：agent 构造时缓存
                            // phase.lastTurn（读自 turnBoundary 投影），此后我们直写的 turn/start
                            // 事件不会刷新这个缓存 → 内核下一条 prompt 用 turn()=lastTurn+1 重开
                            // 同一 turn → 会话日志出现重复 turn/start → 前端 ConversationNodeAssembler
                            // 「received more than one start Match」崩溃 → event feed subscriber 死亡，
                            // 折叠行/会话流停摆（实机实证，turn 序列 1,1,2..18）。idle 时推进 lastTurn
                            // 是安全同步点（无 driver 竞争）。
                            const liveAgent = ctx.agents?.get(sessionId);
                            if (liveAgent?.phase && liveAgent.phase.kind === 'idle'
                                && typeof liveAgent.phase.lastTurn === 'number' && liveAgent.phase.lastTurn < turn) {
                                liveAgent.phase.lastTurn = turn;
                            }
                            // 主动 flush：持久化是按需 checkpoint（per-request barrier / idle），
                            // 直接 append 不落盘的话进程退出即丢开场白（SessionStore.flush 契约）。
                            // I8-1：flush 失败必须显式报告（禁止空吞假成功——用户以为开场白已保存）
                            let flushFailed = null;
                            try {
                                await flushLiveSession(ctx.sessions, session);
                            }
                            catch (e) {
                                flushFailed = e.message;
                                console.log(`[dsht-rp] open-chat: flush 失败（内存态保留）：${flushFailed}`);
                            }
                            console.log(`[dsht-rp] open-chat: ${slug} session=${sessionId} opening=${text.length}ch turn=${turn}`);
                            return send(200, { ok: true, materialized: true, ...(flushFailed !== null ? { flushFailed } : {}) });
                        }
                        // ---- P3a（2026-09-07）：TH 聊天写路径桥 —— /rp/chat/append + /rp/chat/update ----
                        // ST 酒馆助手 createChatMessages / setChatMessages 的后端面（此前记名拒绝，飞讯等
                        // 卡脚本的统合记录写不进 → 手机悬浮球「发消息没反应」的根因之一）。
                        // - append：insert_before:'end' 语义。idle 时完整 turn 物化（oneTurnLog 契约 +
                        //   phase.lastTurn 同步，复刻 open-chat 防 R49 重复 turn/start）；busy 时消息并入
                        //   当前 open turn（step 续接，kernel 工具步同构——不越界开新 turn）。
                        //   system 角色 → source.thSystem 标记（facade 导出 role:'system'/is_system；前端
                        //   ST 同款系统楼层）；data 附加字段 → source.thData（getChatMessages 回读）。
                        // - update：message_id → seq 映射与 facade chatMessages 导出同构（user/assistant/
                        //   thSystem；snapshot 注入与非 thSystem 空文本跳过），单节点 compaction/prune +
                        //   replace 官方原语（模型视图与前端投影立即生效，事件留日志零丢失）。
                        if (sub === '/rp/chat/append') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const insertBefore = payload.insertBefore ?? payload.insert_before;
                            if (insertBefore !== undefined && insertBefore !== 'end') {
                                return send(400, { error: 'insert_before 仅支持 end（DSH 会话日志 append-only，历史插入会漂移）' });
                            }
                            const msgs = (Array.isArray(payload.messages) ? payload.messages : []).filter((m) => m !== null && typeof m === 'object' && !Array.isArray(m));
                            if (msgs.length === 0)
                                return send(400, { error: 'messages required' });
                            const live = ctx.sessions?.get(sessionId);
                            if (!live)
                                return send(404, { error: 'session not live（先经 session.create 创建）' });
                            const agent = ctx.agents?.get(sessionId);
                            const idle = agent?.phase?.kind === 'idle';
                            const snap = sessionEventsSnapshot(live);
                            // 最后一个 turn 编号（open-chat 同款续接规则）
                            let lastTurn = 0;
                            for (let i = snap.length - 1; i >= 0; i--) {
                                if (snap[i]?.type === 'turn/start') {
                                    lastTurn = Number(snap[i]?.data?.turn ?? 0) || 0;
                                    break;
                                }
                            }
                            // busy 时当前 open turn 的 step 续接数（自最后一个 turn/start 起的 step/start 计数）
                            let openSteps = 0;
                            if (!idle) {
                                for (let i = snap.length - 1; i >= 0; i--) {
                                    if (snap[i]?.type === 'turn/start')
                                        break;
                                    if (snap[i]?.type === 'step/start')
                                        openSteps++;
                                }
                            }
                            const appendMessage = (turn, step, role, text, data) => {
                                // 【内核校验对齐】assistant/message 强制 model source（kind:'model'+provider+model，
                                // 实证：plugin source 落盘后整会话 refused to load「message must have model source」）；
                                // thSystem/thData 作为 model source 的扩展键随行（校验只查 kind/provider/model，
                                // merge-extensible sum 允许扩展键）。user 角色走 user/message（plugin source 合法）。
                                if (role === 'user') {
                                    const source = { kind: 'plugin', plugin: 'dsht-tavern-helper' };
                                    if (data !== null)
                                        source['thData'] = data;
                                    live.append('user/message', {
                                        id: `dsht-th-${(0, node_crypto_1.randomUUID)()}`,
                                        role: 'user',
                                        content: [{ type: 'text', text }],
                                        source,
                                    }, { surfaceOp: 'append' });
                                    return;
                                }
                                const source = {
                                    kind: 'model', provider: 'dsht-tavern-helper', model: 'th-system',
                                    ...(role === 'system' ? { thSystem: true } : {}),
                                    ...(data !== null ? { thData: data } : {}),
                                };
                                live.append('assistant/message', {
                                    turn, step,
                                    message: {
                                        id: `dsht-th-${(0, node_crypto_1.randomUUID)()}`,
                                        role: 'assistant',
                                        content: [{ type: 'text', text }],
                                        source,
                                    },
                                }, { surfaceOp: 'append' });
                            };
                            if (idle) {
                                const turn = lastTurn + 1;
                                live.append('turn/start', { turn });
                                for (let i = 0; i < msgs.length; i++) {
                                    const m = msgs[i];
                                    const text = String(m.message ?? '');
                                    const data = m.data !== null && typeof m.data === 'object' ? m.data : null;
                                    live.append('step/start', { turn, step: i + 1 });
                                    appendMessage(turn, i + 1, String(m.role ?? 'system'), text, data);
                                    live.append('step/end', { turn, step: i + 1 });
                                }
                                live.append('turn/end', { turn, reason: { kind: 'completed' } });
                                // R49 同步：agent 的 phase.lastTurn 缓存不刷新会让内核重开同一 turn
                                if (agent?.phase && typeof agent.phase.lastTurn === 'number' && agent.phase.lastTurn < turn) {
                                    agent.phase.lastTurn = turn;
                                }
                                console.log(`[dsht-rp] chat/append: ${sessionId} turn=${turn} n=${msgs.length}（idle 全 turn 物化）`);
                            }
                            else {
                                const turn = Math.max(lastTurn, 1);
                                for (let i = 0; i < msgs.length; i++) {
                                    const m = msgs[i];
                                    const text = String(m.message ?? '');
                                    const data = m.data !== null && typeof m.data === 'object' ? m.data : null;
                                    const step = openSteps + i + 1;
                                    live.append('step/start', { turn, step });
                                    appendMessage(turn, step, String(m.role ?? 'system'), text, data);
                                    live.append('step/end', { turn, step });
                                }
                                console.log(`[dsht-rp] chat/append: ${sessionId} turn=${turn} n=${msgs.length}（busy 并入 open turn）`);
                            }
                            try {
                                await flushLiveSession(ctx.sessions, live);
                            }
                            catch (e) {
                                return send(500, { error: `消息已追加但落盘失败：${e.message}` });
                            }
                            return send(200, { ok: true, appended: msgs.length });
                        }
                        if (sub === '/rp/chat/update') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const targets = (Array.isArray(payload.targets) ? payload.targets : []).filter((t) => t !== null && typeof t === 'object' && !Array.isArray(t));
                            if (targets.length === 0)
                                return send(400, { error: 'targets required' });
                            const live = ctx.sessions?.get(sessionId);
                            if (!live)
                                return send(404, { error: 'session not live' });
                            const view = live.surface?.nodes;
                            if (!Array.isArray(view))
                                return send(409, { error: 'session surface unavailable' });
                            // message_id → {seq, event} 映射：与 facade chatMessages 导出同构
                            //（user/assistant/thSystem 计入；snapshot 注入与非 thSystem 空文本跳过；
                            // compaction/prune 遮蔽集同步剔除——replace 后旧事件不占编号，与 facade 双遍扫描同语义）
                            const snap = sessionEventsSnapshot(live);
                            const shadowedSeqs = new Set();
                            for (const ev0 of snap) {
                                if (ev0?.type !== 'compaction/prune')
                                    continue;
                                const d0 = ev0.data;
                                if (Array.isArray(d0?.shadowedSeqs))
                                    for (const q of d0.shadowedSeqs)
                                        if (typeof q === 'number')
                                            shadowedSeqs.add(q);
                            }
                            const exportSeqs = [];
                            for (const ev of snap) {
                                if (ev.type !== 'user/message' && ev.type !== 'assistant/message')
                                    continue;
                                if (typeof ev.seq === 'number' && shadowedSeqs.has(ev.seq))
                                    continue;
                                const d = ev.data;
                                const msg = (ev.type === 'assistant/message' ? d?.message : d);
                                if (!msg || typeof msg !== 'object')
                                    continue;
                                const source = msg.source;
                                if (source && typeof source === 'object' && source['form'] === 'snapshot')
                                    continue;
                                const content = msg.content;
                                const text = Array.isArray(content)
                                    ? content.filter((b) => b !== null && typeof b === 'object' && b.type === 'text')
                                        .map((b) => String(b.text ?? '')).join('\n')
                                    : typeof content === 'string' ? content : '';
                                const isTh = !!(source && typeof source === 'object' && source['thSystem'] === true);
                                if (!text && !isTh)
                                    continue;
                                if (typeof ev.seq === 'number')
                                    exportSeqs.push(ev.seq);
                            }
                            let updated = 0;
                            const errors = [];
                            for (const t of targets) {
                                const mid = Number(t.message_id ?? -1);
                                const seq = exportSeqs[mid];
                                if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
                                    errors.push(`message_id=${mid} 不存在`);
                                    continue;
                                }
                                if (!view.includes(seq)) {
                                    errors.push(`message_id=${mid}（seq=${seq}）不在当前视图（可能已被回退/折叠）`);
                                    continue;
                                }
                                const oldEv = sessionEventAt(live, seq);
                                const oldData = (oldEv?.data ?? {});
                                const isUser = oldEv?.type === 'user/message';
                                // user/message 的 data 就是 Message 本体；assistant/message 是 {turn, step, message} 包装
                                const oldMsg = ((isUser ? oldData : oldData.message) ?? {});
                                const oldText = Array.isArray(oldMsg.content)
                                    ? oldMsg.content.filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n')
                                    : '';
                                const text = t.message !== undefined ? String(t.message ?? '') : oldText;
                                const oldSource = (oldMsg.source && typeof oldMsg.source === 'object' ? oldMsg.source : {});
                                const oldThData = oldSource['thData'] !== undefined ? oldSource['thData'] : null;
                                const data = t.data !== undefined ? t.data : oldThData;
                                // 计量（core 估价器同款——replace 必须带紧邻 claim）。
                                // 【2026-09-08 鲁棒性】shadowedTokenCount 按**被影子化的旧事件**内容计
                                // （meter 记账对象 = 移出视图的旧事件，与 session-rollback 路由同口径）——
                                // 旧实现用替换后的新文本长度：新文本更短 → meter 少记移出量、更长 → 多记。
                                const oldBlocks = Array.isArray(oldMsg.content)
                                    ? oldMsg.content
                                    : [];
                                let shadowedTokens = oldBlocks.reduce((t2, b) => t2 + (b && (b['type'] === 'text' || b['type'] === 'reasoning') && typeof b['text'] === 'string'
                                    ? Math.ceil(b['text'].length / 4) + 4
                                    : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4;
                                live.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: shadowedTokens });
                                const turn = typeof oldData.turn === 'number' ? oldData.turn : 1;
                                const step = typeof oldData.step === 'number' ? oldData.step : 1;
                                if (isUser) {
                                    // user 楼层替换：plugin source（内核对 user/message 的 source kind 宽容）
                                    const source = { kind: 'plugin', plugin: 'dsht-tavern-helper' };
                                    if (data !== null && typeof data === 'object')
                                        source['thData'] = data;
                                    live.append('user/message', {
                                        id: `dsht-th-${(0, node_crypto_1.randomUUID)()}`,
                                        role: 'user',
                                        content: [{ type: 'text', text }],
                                        source,
                                    }, { surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq] });
                                }
                                else {
                                    // assistant 楼层替换：必须 model source（内核校验）——provider/model 换成
                                    // th-edit 身份，原 replayState 不随行（文本已改，回放态失配且跨 provider 永不命中）
                                    const source = {
                                        kind: 'model', provider: 'dsht-tavern-helper', model: 'th-edit',
                                        ...(oldSource['thSystem'] === true ? { thSystem: true } : {}),
                                        ...(data !== null && typeof data === 'object' ? { thData: data } : {}),
                                    };
                                    live.append('assistant/message', {
                                        turn, step,
                                        message: {
                                            id: `dsht-th-${(0, node_crypto_1.randomUUID)()}`,
                                            role: 'assistant',
                                            content: [{ type: 'text', text }],
                                            source,
                                        },
                                    }, { surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq] });
                                }
                                updated++;
                            }
                            if (updated > 0) {
                                try {
                                    await flushLiveSession(ctx.sessions, live);
                                }
                                catch (e) {
                                    return send(500, { error: `改写已应用但落盘失败：${e.message}` });
                                }
                            }
                            console.log(`[dsht-rp] chat/update: ${sessionId} updated=${updated} errors=${errors.length}`);
                            if (errors.length > 0 && updated === 0)
                                return send(400, { error: errors.join('; ') });
                            return send(200, { ok: true, updated, ...(errors.length > 0 ? { errors } : {}) });
                        }
                        // ---- T2.7：RP 预设体系（组装层关注点；session 内随时切换）----
                        // /preset/import-st {json, name} → ST completion 预设导入（示例预设等）：
                        // prompts/prompt_order → 表层 preset.json；extensions.regex_scripts → 预设作用域 regex.json
                        if (sub === '/preset/import-st') {
                            const json = String(payload.json ?? '');
                            const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().replace(/\.json$/i, '') : `ST 预设 ${new Date().toISOString().slice(0, 10)}`;
                            if (!json.trim())
                                return send(400, { error: 'json required' });
                            let imported;
                            try {
                                imported = (0, st_import_ts_1.importStPreset)(json, name);
                            }
                            catch (e) {
                                return send(400, { error: `无法解析（不是有效的 ST 预设 JSON）：${e.message}` });
                            }
                            const { preset, regex, skipped, skills } = imported;
                            // P2#14 受管预设（digest + owner manifest 幂等安装，参考 dsh-agent-rp
                            // preset.ts L107，MIT）：同 id 重装时比对 manifest digest——用户没动过
                            // 幂等更新（原子换目录），动过/存量无 manifest/用户已保存接管 → 保留
                            // 用户版本并在响应与日志如实报告冲突；force=true 显式接管覆盖。
                            const presetDir = (0, node_path_1.join)(dshHome, 'rp-presets', preset.id);
                            const files = [
                                { name: 'preset.json', content: JSON.stringify(preset, null, 1) },
                            ];
                            if (regex.length > 0) {
                                files.push({ name: 'regex.json', content: JSON.stringify({ scripts: regex }, null, 1) });
                            }
                            const install = await (0, managed_ts_1.installManagedPreset)(presetDir, files, 'dsht-rp:import-st', { force: payload.force === true });
                            if (install.outcome === 'conflict') {
                                const reasonText = install.reason === 'user-owned'
                                    ? '用户已在管理面板保存接管该预设'
                                    : install.reason === 'modified'
                                        ? '受管内容被本地改动过'
                                        : '存量预设无 owner manifest（未知来源，用户可能改过）';
                                console.log(`[dsht-rp] preset/import-st: 冲突保留用户版本 rp-presets/${preset.id}（${reasonText}；确认要覆盖请重发带 force:true）`);
                                return send(200, {
                                    ok: true, install: 'conflict', reason: install.reason,
                                    presetId: preset.id, displayName: preset.displayName,
                                    note: `已保留现有版本（${reasonText}）。确认要用导入内容覆盖请重发本请求并带 force:true；或先改名导入。`,
                                });
                            }
                            if (install.outcome !== 'unchanged') {
                                // 任务 3：agent 编排型预设的模块化内容块 → skills/preset-<id>/<块名>/SKILL.md
                                for (const block of skills) {
                                    await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, block.dir), { recursive: true });
                                    await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, block.dir, 'SKILL.md'), (0, st_import_ts_1.renderPresetSkillMd)(preset.displayName, block), 'utf8');
                                }
                                // T3.3 三档归位产物②：内心 OS/思维链 pendingSkills → $DSH_HOME/skills/<slug>/SKILL.md
                                // 占位落盘（正文即原 ST 条目内容；skillRef 槽只留引用提示，skill 本体由
                                // DSH skill 机制按需读取）
                                for (const ps of preset.pendingSkills ?? []) {
                                    const dir = (0, st_import_ts_1.pendingSkillDir)(ps.name);
                                    await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, dir), { recursive: true });
                                    await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, dir, 'SKILL.md'), (0, st_import_ts_1.renderPendingSkillMd)(preset.displayName, ps), 'utf8');
                                }
                                presetCache.delete(preset.id);
                                presetRegexCache.delete(preset.id);
                                activeStPresetCache = undefined; // 新预设可能正是 ST 激活预设 → 默认绑定重解析
                                await syncRpPresetToAgent(preset); // R5：导入即同步 agent preset（st- 前缀；agent 型用 agent 形态 yml）
                            }
                            console.log(`[dsht-rp] preset/import-st: ${preset.displayName} → ${preset.slots.length} slots, ${regex.length} regex scripts, ${skills.length} skills, pendingSkills ${(preset.pendingSkills ?? []).length}（configExtra ${preset.configSummaryExtra !== undefined ? 1 : 0} / subagentHints ${(preset.subagentHints ?? []).length}）${skipped > 0 ? ` (${skipped} skipped)` : ''} [install:${install.outcome}]`);
                            return send(200, {
                                ok: true, install: install.outcome, presetId: preset.id, displayName: preset.displayName,
                                slots: preset.slots.length, regex: regex.length, skipped,
                                path: preset.path, skills: skills.length, skillDirs: skills.map(b => b.dir),
                                pendingSkills: (preset.pendingSkills ?? []).length, subagentHints: (preset.subagentHints ?? []).length,
                            });
                        }
                        // /preset/list {} → 全部预设（内置示范 + 用户 rp-presets/*/preset.json）
                        // 顺带 R5 回填（幂等、存在即跳过）：rp-presets 若是旁路直写（迁移 agent
                        // write-files）而非 import-st 路由产物，.agent-presets/st-* 不会生成——
                        // 这里兜底补齐（agent preset 发现是逐次扫盘，写完 agentPreset.list 即可见）。
                        if (sub === '/preset/list') {
                            await ensureRpPresetSync();
                            const presets = await listPresets(new AbortController().signal);
                            return send(200, { presets });
                        }
                        // /preset/save {preset} → 用户预设保存（条目开关写回表层 JSON；内置预设不可改）
                        if (sub === '/preset/save') {
                            const preset = payload.preset;
                            if (!preset || preset.schemaVersion !== 1 || !preset.id)
                                return send(400, { error: 'preset required' });
                            if (builtinPresets.some(b => b.id === preset.id)) {
                                return send(400, { error: '内置预设不可覆盖（先在管理面板复制为自定义）' });
                            }
                            await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, 'rp-presets', preset.id), { recursive: true });
                            await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, 'rp-presets', preset.id, 'preset.json'), JSON.stringify(preset, null, 1), 'utf8');
                            // P2#14：用户保存 = 用户接管该预设（owner manifest 标记 user），
                            // 之后 import-st 同 id 重装会得到 conflict(user-owned) 而非静默冲掉改动
                            await (0, managed_ts_1.markPresetUserOwned)((0, node_path_1.join)(dshHome, 'rp-presets', preset.id));
                            presetCache.delete(preset.id);
                            await syncRpPresetToAgent(preset); // R5：保存即编译同步 agent preset（st- 前缀）
                            console.log(`[dsht-rp] preset/save: ${preset.id}`);
                            return send(200, { ok: true });
                        }
                        // /preset/delete {presetId} → 删除用户预设（rp-presets/<id>/ 整目录；
                        // R5：st- 前缀的同步 agent preset 一并删除；内置示范不可删）
                        if (sub === '/preset/delete') {
                            const presetId = String(payload.presetId ?? '');
                            if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(presetId))
                                return send(400, { error: 'presetId 非法' });
                            if (builtinPresets.some(b => b.id === presetId))
                                return send(400, { error: '内置预设不可删除' });
                            await (0, promises_1.rm)((0, node_path_1.join)(dshHome, 'rp-presets', presetId), { recursive: true, force: true });
                            await removeRpPresetAgent(presetId);
                            presetCache.delete(presetId);
                            presetRegexCache.delete(presetId);
                            activeStPresetCache = undefined;
                            console.log(`[dsht-rp] preset/delete: ${presetId}`);
                            return send(200, { ok: true });
                        }
                        // /preset/select {sessionId, presetId|null} → 会话内切换（写会话状态，下一轮生效）
                        if (sub === '/preset/select') {
                            const sessionId = String(payload.sessionId ?? '');
                            const presetId = typeof payload.presetId === 'string' && payload.presetId ? payload.presetId : null;
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            if (presetId !== null) {
                                const preset = await resolvePreset(presetId, new AbortController().signal);
                                if (!preset)
                                    return send(404, { error: `preset not found: ${presetId}` });
                            }
                            const st = await loadSessionState(sessionId);
                            if (presetId === null)
                                delete st.presetId;
                            else
                                st.presetId = presetId;
                            await saveSessionState(sessionId, st);
                            console.log(`[dsht-rp] preset/select: session=${sessionId} → ${presetId ?? '(none)'}`);
                            return send(200, { ok: true, presetId });
                        }
                        // /preset/state {sessionId} → 会话有效预设（显式选择 ?? ST 激活预设默认；
                        // explicit 字段区分是否用户选过——前端显示用有效值，切换语义不变）
                        if (sub === '/preset/state') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const st = await loadSessionState(sessionId);
                            const explicit = typeof st.presetId === 'string' && st.presetId ? st.presetId : null;
                            return send(200, { presetId: explicit ?? await resolveActiveStPresetId(), explicit });
                        }
                        // ---- L1b：自定义宏注册（ST MacroRegistry.registerMacro 对应物；hook 移植）----
                        // /macros/list {} → 字符串模板类自定义宏全表（客户端显示期水合用）
                        if (sub === '/macros/list') {
                            return send(200, { macros: (0, macros_ts_1.listCustomMacros)() });
                        }
                        // /macros/register {name, value} → 注册（字符串模板）+ 持久化 rp/macros.json
                        // /macros/unregister {name} → 注销 + 持久化
                        if (sub === '/macros/register' || sub === '/macros/unregister') {
                            const macroName = String(payload.name ?? '').trim().toLowerCase();
                            if (!macroName)
                                return send(400, { error: 'name required' });
                            // 读改写串行化：探针/脚本爆发式并发注册时防丢更新（配合 atomicWriteFile tmp 去重）
                            const result = await (macroWriteChain = macroWriteChain.then(async () => {
                                const macrosFile = (0, node_path_1.join)(dshHome, 'rp', 'macros.json');
                                let disk = {};
                                try {
                                    disk = JSON.parse(await (0, promises_1.readFile)(macrosFile, 'utf8'));
                                }
                                catch { /* 无文件 */ }
                                try {
                                    if (sub === '/macros/register') {
                                        const value = String(payload.value ?? '');
                                        (0, macros_ts_1.registerMacro)(macroName, value);
                                        disk[macroName] = value;
                                    }
                                    else {
                                        (0, macros_ts_1.unregisterMacro)(macroName);
                                        delete disk[macroName];
                                    }
                                }
                                catch (e) {
                                    return { status: 400, body: { error: e.message } };
                                }
                                await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, 'rp'), { recursive: true });
                                await atomicWriteFile(macrosFile, JSON.stringify(disk, null, 2));
                                console.log(`[dsht-rp] macro ${sub === '/macros/register' ? 'registered' : 'unregistered'}: {{${macroName}}}（共 ${Object.keys(disk).length} 个自定义宏）`);
                                return { status: 200, body: { ok: true, macros: (0, macros_ts_1.listCustomMacros)() } };
                            }).catch((e) => ({ status: 500, body: { error: String(e) } })));
                            return send(result.status, result.body);
                        }
                        // /state {sessionId} → T2.3 MVU 状态树（只读诊断/前端消费；写走自动提取与
                        // state_update 工具）。state 键优先，历史扁平文件/variables 键兜底。
                        if (sub === '/state') {
                            const sessionId = String(payload.sessionId ?? '');
                            if (!sessionId)
                                return send(400, { error: 'sessionId required' });
                            const st = await loadSessionState(sessionId);
                            return send(200, { state: st.state ?? st.variables ?? {} });
                        }
                        // ---- T2.8：正则管理（三层作用域；ST 正则设置界面的数据面）----
                        // /regex/list {slug?, sessionId?} → 全部作用域脚本（global + 指定角色 scoped
                        // + 会话有效预设 preset——ST 语义：激活预设的 display/prompt 正则恒生效）
                        if (sub === '/regex/list') {
                            const global = loadGlobalRegex(new AbortController().signal);
                            let scoped = [];
                            const slug = typeof payload.slug === 'string' ? payload.slug : '';
                            if (slug) {
                                const rp = await loadRpJson(slug, new AbortController().signal);
                                scoped = rp?.regex ?? [];
                            }
                            let preset = [];
                            let presetId = null;
                            const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
                            if (sessionId) {
                                presetId = await resolveSessionPresetId(sessionId);
                                if (presetId)
                                    preset = await loadPresetRegex(presetId, new AbortController().signal);
                            }
                            return send(200, { global, scoped, preset, presetId, slug: slug || null });
                        }
                        // /regex/save-global {scripts} → 全局作用域整组保存（管理面板写回）
                        if (sub === '/regex/save-global') {
                            const scripts = Array.isArray(payload.scripts) ? payload.scripts : [];
                            await (0, promises_1.mkdir)((0, node_path_1.join)(dshHome, 'rp', 'regex'), { recursive: true });
                            // 任务 1：写前文件快照（全局作用域 → 归属最近活跃的 RP 会话；无会话上下文跳过）
                            await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), ['rp/regex/global.json']);
                            await (0, promises_1.writeFile)((0, node_path_1.join)(dshHome, 'rp', 'regex', 'global.json'), JSON.stringify({ scripts }, null, 1), 'utf8');
                            globalRegexCache = null; // 缓存失效，下轮重读
                            console.log(`[dsht-rp] regex/save-global: ${scripts.length} scripts`);
                            return send(200, { ok: true, count: scripts.length });
                        }
                        // /regex/save-scoped {slug, scripts} → 角色作用域整组保存（写回 rp.json.regex）
                        if (sub === '/regex/save-scoped') {
                            const slug = String(payload.slug ?? '');
                            const scripts = Array.isArray(payload.scripts) ? payload.scripts : [];
                            if (!slug)
                                return send(400, { error: 'slug required' });
                            const rpPath = (0, node_path_1.join)(dshHome, 'rp', slug, 'rp.json');
                            let rp;
                            try {
                                rp = JSON.parse(await (0, promises_1.readFile)(rpPath, 'utf8'));
                            }
                            catch {
                                return send(404, { error: `rp.json not found: ${slug}` });
                            }
                            rp.regex = scripts;
                            // 任务 1：写前文件快照（归属会话 = payload.sessionId ?? 该 slug 名下会话）
                            await snapshotRpFiles(String(payload.sessionId ?? '') || await sessionIdForSlug(slug), [`rp/${slug}/rp.json`]);
                            await (0, promises_1.writeFile)(rpPath, JSON.stringify(rp, null, 1), 'utf8');
                            console.log(`[dsht-rp] regex/save-scoped: ${slug} → ${scripts.length} scripts`);
                            return send(200, { ok: true, count: scripts.length });
                        }
                        // ---- 批次修复 6：预设作用域正则（rp-presets/<id>/regex.json）----
                        // /regex/list-preset {presetId} → 该预设的脚本；/regex/save-preset {presetId, scripts} → 整组保存
                        if (sub === '/regex/list-preset') {
                            const presetId = String(payload.presetId ?? '');
                            if (!presetId)
                                return send(400, { error: 'presetId required' });
                            try {
                                const text = await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp-presets', presetId, 'regex.json'), 'utf8');
                                const o = JSON.parse(text);
                                return send(200, { presetId, scripts: Array.isArray(o.scripts) ? o.scripts : [] });
                            }
                            catch {
                                return send(200, { presetId, scripts: [] });
                            }
                        }
                        if (sub === '/regex/save-preset') {
                            const presetId = String(payload.presetId ?? '');
                            const scripts = Array.isArray(payload.scripts) ? payload.scripts : [];
                            if (!presetId)
                                return send(400, { error: 'presetId required' });
                            const dir = (0, node_path_1.join)(dshHome, 'rp-presets', presetId);
                            try {
                                await (0, promises_1.readdir)(dir);
                            }
                            catch {
                                return send(404, { error: `预设不存在：${presetId}` });
                            }
                            // 任务 1：写前文件快照（预设作用域 → 归属最近活跃的 RP 会话；无会话上下文跳过）
                            await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), [`rp-presets/${presetId}/regex.json`]);
                            await (0, promises_1.writeFile)((0, node_path_1.join)(dir, 'regex.json'), JSON.stringify({ scripts }, null, 1), 'utf8');
                            console.log(`[dsht-rp] regex/save-preset: ${presetId} → ${scripts.length} scripts`);
                            return send(200, { ok: true, count: scripts.length });
                        }
                        // /regex/test {script, text, placement?} → 测试器（按脚本自身声明的时机归一——
                        // markdownOnly→display / promptOnly→prompt / 其余→permanent；所见即所得）
                        if (sub === '/regex/test') {
                            const script = payload.script;
                            const text = String(payload.text ?? '');
                            if (!script || typeof script.findRegex !== 'string')
                                return send(400, { error: 'script required' });
                            const placement = typeof payload.placement === 'number' ? script.placement.includes(payload.placement) ? payload.placement : script.placement[0] : script.placement[0] ?? 2;
                            const timing = script.markdownOnly ? 'display' : script.promptOnly ? 'prompt' : 'permanent';
                            const r = (0, engine_ts_1.runRegexScripts)([script], text, timing, placement, { depth: null });
                            return send(200, { ok: true, result: r.text, hits: r.hits.length });
                        }
                        // ---- T3.2：会话长期记忆路由（存储 $DSH_HOME/rp/memory/<sessionId>.json；
                        // 核心逻辑在 ./memory.ts 纯函数层，这里只做参数校验/快照/落盘接线）----
                        // /memory/save {sessionId, text, source?} → 追加条目（写前快照 + 去抖 + 200 条淘汰）
                        if (sub === '/memory/save') {
                            const sid = String(payload.sessionId ?? '');
                            if (!(0, memory_ts_1.isValidMemorySessionId)(sid))
                                return send(400, { error: 'sessionId required（不得含路径分隔符/空白边界）' });
                            const text = typeof payload.text === 'string' ? payload.text : '';
                            if (!text.trim())
                                return send(400, { error: 'text required' });
                            const source = (0, memory_ts_1.normalizeMemorySource)(payload.source);
                            const mem = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                            const r = (0, memory_ts_1.appendMemory)(mem, text, source);
                            if (!r.ok)
                                return send(400, { error: r.error === 'too-long' ? `text 超过 ${memory_ts_1.MEMORY_TEXT_MAX} 字上限` : 'text required' });
                            // 写前文件快照（归属该会话；无 turn 锚点自动跳过，快照失败不阻塞写）
                            await snapshotRpFiles(sid, [(0, memory_ts_1.memoryRelPath)(sid)]);
                            await (0, memory_ts_1.saveMemory)(dshHome, sid, r.file);
                            logLine(`memory/save: ${sid} +1（${r.entry?.id}${r.duplicate ? ' 去抖命中' : ''}，共 ${r.file.entries.length} 条）`);
                            console.log(`[dsht-rp] memory/save: ${sid} ${r.entry?.id}${r.duplicate ? '（去抖命中）' : ''}，共 ${r.file.entries.length} 条`);
                            return send(200, { ok: true, id: r.entry?.id, duplicate: r.duplicate === true, count: r.file.entries.length });
                        }
                        // /memory/query {sessionId, query, limit?} → 关键词检索（按空白切词，命中任一词即算，命中数排序）
                        if (sub === '/memory/query') {
                            const sid = String(payload.sessionId ?? '');
                            if (!(0, memory_ts_1.isValidMemorySessionId)(sid))
                                return send(400, { error: 'sessionId required' });
                            const rawLimit = payload.limit;
                            const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 10;
                            const { entries } = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                            const hits = (0, memory_ts_1.queryMemory)(entries, String(payload.query ?? ''), limit);
                            console.log(`[dsht-rp] memory/query: "${String(payload.query ?? '')}" → ${hits.length}/${entries.length} hits (${sid})`);
                            return send(200, { query: String(payload.query ?? ''), total: entries.length, count: hits.length, entries: hits });
                        }
                        // /memory/list {sessionId} → 全量条目
                        if (sub === '/memory/list') {
                            const sid = String(payload.sessionId ?? '');
                            if (!(0, memory_ts_1.isValidMemorySessionId)(sid))
                                return send(400, { error: 'sessionId required' });
                            const { entries } = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                            return send(200, { count: entries.length, entries });
                        }
                        // /memory/delete {sessionId, id} → 删除单条（写前快照，回退可恢复）
                        if (sub === '/memory/delete') {
                            const sid = String(payload.sessionId ?? '');
                            if (!(0, memory_ts_1.isValidMemorySessionId)(sid))
                                return send(400, { error: 'sessionId required' });
                            const id = String(payload.id ?? '');
                            if (!id)
                                return send(400, { error: 'id required' });
                            const mem = await (0, memory_ts_1.loadMemory)(dshHome, sid);
                            const r = (0, memory_ts_1.deleteMemoryEntry)(mem, id);
                            if (!r.deleted)
                                return send(404, { error: `entry not found: ${id}` });
                            await snapshotRpFiles(sid, [(0, memory_ts_1.memoryRelPath)(sid)]);
                            await (0, memory_ts_1.saveMemory)(dshHome, sid, r.file);
                            console.log(`[dsht-rp] memory/delete: ${sid} -${id}（剩 ${r.file.entries.length} 条）`);
                            return send(200, { ok: true, count: r.file.entries.length });
                        }
                        return send(404, { error: 'unknown endpoint' });
                    }
                    catch (e) {
                        return send(500, { error: e.message });
                    }
                })();
            },
        });
        console.log('[dsht-rp] data plane on webServer route /dsht-rp/*');
        // 0.1.2 token 落盘（绕行 stdout 静默，2026-09-04 真机实证）：卓易通/鸿蒙上 node
        // 的 stdout 管道可能整段丢失（端口开放、进程活着、stdout 零行）——NodeService 的
        // stdout 捕获链拿不到 launch token，MainActivity 永等。本插件进程内直接把
        // launchToken 写 $DSH_HOME/dsht-token，NodeService 每秒轮询读取。launchToken 每次进程
        // 重启变化（NodeService 启动 node 前删旧文件）。无 connection（<0.1.2）不写。
        const connForToken = ctx.connection;
        const launchToken = connForToken?.browserAuth?.launchToken;
        if (typeof launchToken === 'string' && launchToken.length > 0) {
            void (async () => {
                try {
                    // 【实机复现修复 2026-09-05】启动竞态收口：重装/SIGKILL 后的 seq gap 修复
                    // （启动即修）与 token 写入并行赛跑——MainActivity/外部脚本一读到 token 就发
                    // 请求，会在 repair 完成前撞上 "corrupt session log: seq gap"。把 repair
                    // 完成作为写 token 的前置屏障（repair 自带 8MB 上限与容错，不阻塞太久）。
                    try {
                        const r = await repairAllSessionSeqs();
                        const n = Number(r.repaired ?? 0);
                        if (n > 0)
                            logLine(`启动即修（token 屏障内）：seq 断号修复 ${n} 个会话`);
                    }
                    catch { /* 修复失败不挡启动（与旧路径同语义） */ }
                    const tokenFile = (0, node_path_1.join)(dshHome, 'dsht-token');
                    const existing = await (0, promises_1.readFile)(tokenFile, 'utf8').catch(() => '');
                    if (existing.trim() !== launchToken) {
                        await (0, promises_1.mkdir)((0, node_path_1.dirname)(tokenFile), { recursive: true });
                        await (0, promises_1.writeFile)(tokenFile, launchToken, 'utf8');
                        console.log('[dsht-rp] launch token written to dsht-token (stdout-independent channel)');
                    }
                }
                catch { /* 落盘失败不影响启动（stdout 捕获链仍在） */ }
            })();
        }
        // 插件卸载时撤路由（effect disposer）
        const effectFn = ctx.effect;
        if (typeof effectFn === 'function') {
            effectFn.call(ctx, () => () => { dispose(); });
        }
    }
}
