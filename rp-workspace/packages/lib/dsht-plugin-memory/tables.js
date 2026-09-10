"use strict";
/**
 * E1-E8/E11 剧情表格系统（ST st-memory-enhancement 表格机制的机制级移植，纯逻辑 + 薄 IO）。
 *
 * 存储形状（rp/state/<sid>.json 新键，与 MVU variables/presetId/cursor 共存）：
 *   sheets: [{ uid, name, headers: string[], rows: string[][], enabled }]   // E1
 *   sheetHistory: [{ at, sheets 快照 JSON }]                                // E1（栈深 20，撤销用）
 * 旧键迁移：tableData/tables（ST 1.0 形态 {名称: {content:[[]], enable}}）→
 *   loadSheets 发现即一次性转 Sheet[] 写回并标 tablesMigrated（E11）。
 *
 * tableEdit 指令（E2，ST index.js handleTableEditTag/classifyParams 同语义换格式）：
 *   <tableEdit>
 *   表名; 操作; 参数...
 *   </tableEdit>
 *   操作：insertRow / updateRow / deleteRow / insertCol / deleteCol / setName / rename
 *   容错：半角/全角分号、多余空格、行号越界跳过（不中断后续指令）。
 *   行号/列号一律 1 起（数据行，表头不占行号；insertRow 省略行号 = 追加表尾）。
 *
 *   【实机审计修复 2026-09-05】函数调用式（ST st-memory-enhancement pluginSetting.js
 *   提示词模板实证的主格式，旧分号式保留为兼容回退，同一块内两式逐行共存）：
 *   <tableEdit>
 *   insertRow(0,{"0":"值","2":"值"})
 *   updateRow(0,2,{"1":"值"})
 *   deleteRow(0,3)
 *   </tableEdit>
 *   基数对齐 ST 源码 executeAction/classifyParams：表索引 = 启用表数组的 0 起下标
 *   （sheets[enable 过滤后][tableIndex]）；行号 = 0 起数据行（内部转 1 起）；列键 = headers
 *   下标（0 起，内部转 1 起列号）；insertRow 一律追加表尾（ST 忽略行参）；数据字典仅收
 *   数字键（ST formatParams 同款丢弃非数字键）；容忍单引号/全角括号/全角逗号。
 *
 * 与 ST 的对应：Sheet ≈ st-memory-enhancement core/table/sheet.js（uid/name/headers/rows/enable）；
 * renderTablePrompt ≈ getTablePromptByPiece（title/headers/rows/editRules）；
 * renderTableData ≈ isPureData=true 口径；{{tableData}}/{{tablePrompt}}/{{GET::表:行:列}} ≈
 * ST 表格宏（本移植只在 pre-step 注入点求值，不改全局宏引擎，E8）。
 *
 * 拆分原因：路由 handler 与 pre-step 接线分属两个插件，核心逻辑全部收拢为纯函数
 * （dsh-plugin/memory.ts 同款拆法），本文件只含 tables 相关，不碰剧情记忆。
 *
 * 打包：esbuild 内联（dsh-plugin bundle 时编入）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHEET_HISTORY_MAX = void 0;
exports.isValidTablesSessionId = isValidTablesSessionId;
exports.normalizeSheet = normalizeSheet;
exports.migrateLegacyTables = migrateLegacyTables;
exports.sheetsStatePath = sheetsStatePath;
exports.loadSheets = loadSheets;
exports.saveSheets = saveSheets;
exports.pushSheetHistory = pushSheetHistory;
exports.parseTableEdits = parseTableEdits;
exports.executeTableEdits = executeTableEdits;
exports.renderTableData = renderTableData;
exports.renderTablePrompt = renderTablePrompt;
exports.getTableCell = getTableCell;
exports.parseA1Address = parseA1Address;
exports.expandTableMacros = expandTableMacros;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const atomic_fs_ts_1 = require("../dsht-plugin-shared/atomic-fs.ts");
/** 历史栈深（E1：超出丢最旧） */
exports.SHEET_HISTORY_MAX = 20;
/** sessionId 安全校验（路由 payload 直落文件名，防路径越界；memory.ts 同款规则） */
function isValidTablesSessionId(sessionId) {
    return typeof sessionId === 'string'
        && sessionId.length > 0
        && sessionId.length <= 120
        && !sessionId.includes('/')
        && !sessionId.includes('\\')
        && !sessionId.includes('..')
        && sessionId !== '.'
        && sessionId.trim() === sessionId;
}
/** 宽容归一单张表（坏形状返回 null；headers/rows 全部字符串化对齐） */
function normalizeSheet(raw, index = 0) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `表${index + 1}`;
    const headers = Array.isArray(r.headers)
        ? r.headers.map(h => String(h ?? ''))
        : [];
    const rows = Array.isArray(r.rows)
        ? r.rows.filter(row => Array.isArray(row)).map(row => row.map(c => String(c ?? '')))
        : [];
    const uid = typeof r.uid === 'string' && r.uid ? r.uid : `t${index + 1}`;
    return { uid, name, headers, rows, enabled: r.enabled !== false };
}
/** 深拷贝 sheets（executeTableEdits 纯函数与历史快照共用） */
function cloneSheets(sheets) {
    return sheets.map(s => ({ ...s, headers: [...s.headers], rows: s.rows.map(row => [...row]) }));
}
// ---------------------------------------------------------------------------
// E11：旧键迁移（ST 1.0 形态）
// ---------------------------------------------------------------------------
/**
 * 识别旧键 tableData / tables（ST 1.0：{表名: {name?, content: string[][], enable?}}，
 * 也容忍数组形态）。content 首行为表头、其余为数据行（ST 三件套惯例）。
 */
function migrateLegacyTables(raw) {
    const legacy = raw.tableData ?? raw.tables;
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) === (Array.isArray(raw.tables) && raw.tables !== undefined && Array.isArray(raw.tables))) {
        // 上式难读：对象形态直接处理；数组形态也处理（见下）——此处仅排除 null/非对象
    }
    if (!legacy || typeof legacy !== 'object')
        return { sheets: [], found: false };
    const entries = Array.isArray(legacy)
        ? legacy.map((v, i) => [`表${i + 1}`, v])
        : Object.entries(legacy);
    const sheets = [];
    for (const [key, v] of entries) {
        if (!v || typeof v !== 'object')
            continue;
        const r = v;
        // ST 1.0 content：string[][]，首行表头；无 content 的单表跳过
        const content = Array.isArray(r.content) ? r.content : null;
        if (!content)
            continue;
        const list = content.map(row => (Array.isArray(row) ? row.map(c => String(c ?? '')) : [String(row ?? '')]));
        const headers = list.length > 0 ? list[0] : [];
        const rows = list.slice(1);
        sheets.push({
            uid: typeof r.uid === 'string' && r.uid ? r.uid : `t${sheets.length + 1}`,
            name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : key,
            headers,
            rows,
            enabled: r.enable !== false && r.enabled !== false,
        });
    }
    return { sheets, found: true };
}
// ---------------------------------------------------------------------------
// E1：薄 IO（loadSheets 内含 E11 一次性迁移写回）
// ---------------------------------------------------------------------------
/** tablesFilePath：状态文件即 rp/state/<sid>.json（与 MVU/cursor 共用） */
function sheetsStatePath(dshHome, sessionId) {
    return (0, node_path_1.join)(dshHome, 'rp', 'state', `${sessionId}.json`);
}
/**
 * 读会话表格（薄 IO）。文件缺失/损坏 → 空表集；
 * 无 sheets 键但发现旧键 tableData/tables → E11 一次性转换并写回（标 tablesMigrated）。
 */
async function loadSheets(dshHome, sessionId) {
    if (!isValidTablesSessionId(sessionId))
        return { whole: {}, sheets: [], history: [], migrated: false };
    let whole = {};
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(sheetsStatePath(dshHome, sessionId), 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            whole = parsed;
    }
    catch {
        return { whole: {}, sheets: [], history: [], migrated: false }; // 无文件/坏 JSON = 空
    }
    // 归一 sheets（坏条目跳过）
    let sheets = Array.isArray(whole.sheets)
        ? whole.sheets.map((s, i) => normalizeSheet(s, i)).filter((s) => s !== null)
        : [];
    let migrated = false;
    if (!Array.isArray(whole.sheets)) {
        // E11：一次性迁移旧键（ST 1.0 形态）→ Sheet[] 写回
        const legacy = migrateLegacyTables(whole);
        if (legacy.sheets.length > 0) {
            sheets = legacy.sheets;
            migrated = true;
            whole.sheets = sheets;
            whole.tablesMigrated = true;
            await saveSheets(dshHome, sessionId, whole);
        }
    }
    const history = Array.isArray(whole.sheetHistory)
        ? whole.sheetHistory.map(h => {
            const e = (h ?? {});
            return {
                at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
                sheets: Array.isArray(e.sheets)
                    ? e.sheets.map((s, i) => normalizeSheet(s, i)).filter((x) => x !== null)
                    : [],
            };
        })
        : [];
    return { whole, sheets, history, migrated };
}
/** 写会话表格（薄 IO，建目录；调用方负责历史栈）。
 *  【鲁棒轮 2026-09-09】字段级 merge 写——rp/state/<sid>.json 是多写方共享文件
 *  （MVU variables/state、dsh-plugin cursor/presetId、loreTimed…）。原实现把
 *  load 时读到的 whole 整树原样写回：/tables/step-summary 与 /tables/rebuild 在
 *  load 与 save 之间隔着秒级 LLM 调用，期间其他写方（每轮 pre-step 的 cursor/
 *  state、MVU patch）落盘的变更会被旧 whole 静默回滚（cursor 倒退/变量丢失）。
 *  现改为保存前重读最新盘面、只覆写 sheets/sheetHistory/tablesMigrated 三键，
 *  其余键保留最新值；写盘换 atomicWriteText（与项目发布口径一致）。 */
async function saveSheets(dshHome, sessionId, whole) {
    if (!isValidTablesSessionId(sessionId))
        throw new Error('invalid sessionId');
    const path = sheetsStatePath(dshHome, sessionId);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    let merged = whole;
    try {
        const latest = JSON.parse(await (0, promises_1.readFile)(path, 'utf8'));
        if (latest && typeof latest === 'object' && !Array.isArray(latest)) {
            merged = {
                ...latest,
                sheets: whole.sheets,
                sheetHistory: whole.sheetHistory,
                ...(whole.tablesMigrated === true ? { tablesMigrated: true } : {}),
            };
        }
    }
    catch { /* 盘面不可读（首写/撕裂）→ 退化为整树写 */ }
    await (0, atomic_fs_ts_1.atomicWriteText)(path, JSON.stringify(merged));
}
/** 历史栈入栈（纯函数）：深快照 sheets，栈深 20（超出丢最旧） */
function pushSheetHistory(history, sheets, now = Date.now()) {
    const next = [...history, { at: now, sheets: cloneSheets(sheets) }];
    return next.length > exports.SHEET_HISTORY_MAX ? next.slice(next.length - exports.SHEET_HISTORY_MAX) : next;
}
/** 行容错切分：半角/全角分号都是分隔符 */
const SPLIT_RE = /[;；]/;
/** 块提取：<tableEdit>…</tableEdit>（容错大小写与属性，ST getTableEditTag 同语义换宽容度） */
const BLOCK_RE = /<tableEdit[^>]*>([\s\S]*?)<\/tableEdit>/gi;
const OPS = ['insertRow', 'updateRow', 'deleteRow', 'insertCol', 'deleteCol', 'setName', 'rename'];
/** 纯数字（行号/列号 token 判定） */
function isIntToken(s) {
    return /^\d+$/.test(s);
}
/**
 * 解析消息文本里的全部 <tableEdit> 块 → 指令数组（E2）。
 * 【实机审计修复 2026-09-05】块内优先提取函数调用式（insertRow(...)/updateRow(...)/
 * deleteRow(...)/insertCol(...)/deleteCol(...)，跨行字典容忍，ST handleTableEditTag 同款
 * 全块扫描），函数调用区间之外的文本再走旧分号式逐行解析（兼容回退）。
 * 坏指令（表索引缺失/操作不识别/参数缺失）计入 skipped 并跳过，不中断后续指令。
 */
function parseTableEdits(text) {
    const edits = [];
    let skipped = 0;
    for (const m of text.matchAll(BLOCK_RE)) {
        const block = m[1] ?? '';
        // 1) 函数调用式：全块扫描（容忍跨行字典与全角括号）
        const calls = extractFnCalls(block);
        let rest = block;
        if (calls.length > 0) {
            for (const c of calls) {
                const edit = fnCallToEdit(c.op, parseFnArgs(c.argsSrc));
                if (edit)
                    edits.push(edit);
                else
                    skipped++;
            }
            // 抹掉函数调用区间后，剩余文本交给旧分号式（保换行结构）
            let out = '';
            let pos = 0;
            for (const c of calls) {
                out += block.slice(pos, c.start);
                pos = c.end;
            }
            rest = out + block.slice(pos);
        }
        // 2) 旧分号式逐行解析（兼容回退）
        for (const rawLine of rest.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('<!--') || line.startsWith('-->') || line.startsWith('#'))
                continue;
            const parts = line.split(SPLIT_RE).map(p => p.trim());
            const sheet = parts[0] ?? '';
            const opToken = (parts[1] ?? '').toLowerCase();
            const op = OPS.find(o => o.toLowerCase() === opToken);
            if (!sheet || !op) {
                skipped++;
                continue;
            }
            const restArgs = parts.slice(2);
            if (op === 'insertRow') {
                // 表名; insertRow; [行号]; 单元格…
                const row = restArgs.length > 0 && isIntToken(restArgs[0]) ? Number(restArgs[0]) : undefined;
                const values = row === undefined ? restArgs : restArgs.slice(1);
                if (values.length === 0) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, row, values });
            }
            else if (op === 'updateRow') {
                // 表名; updateRow; 行号; 列=值…（或按位置从列 1 顺填）
                if (restArgs.length < 1 || !isIntToken(restArgs[0])) {
                    skipped++;
                    continue;
                }
                const values = restArgs.slice(1);
                if (values.length === 0) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, row: Number(restArgs[0]), values });
            }
            else if (op === 'deleteRow') {
                if (restArgs.length < 1 || !isIntToken(restArgs[0])) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, row: Number(restArgs[0]), values: [] });
            }
            else if (op === 'insertCol') {
                // 表名; insertCol; [列号]; 表头名
                const col = restArgs.length > 0 && isIntToken(restArgs[0]) ? Number(restArgs[0]) : undefined;
                const values = col === undefined ? restArgs : restArgs.slice(1);
                if (values.length === 0 || !values[0]) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, col, values });
            }
            else if (op === 'deleteCol') {
                if (restArgs.length < 1 || !isIntToken(restArgs[0])) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, col: Number(restArgs[0]), values: [] });
            }
            else {
                // setName / rename：表名; setName; 新表名（新表名里的分号拼回来）
                const newName = restArgs.join(';').trim();
                if (!newName) {
                    skipped++;
                    continue;
                }
                edits.push({ sheet, op, values: [newName] });
            }
        }
    }
    return { edits, skipped };
}
// ---------------------------------------------------------------------------
// 【实机审计修复 2026-09-05】函数调用式 tableEdit（ST st-memory-enhancement 主格式）
// ---------------------------------------------------------------------------
/** 函数调用式操作 token（ST 提示词模板主五式） */
const FN_OPS = ['insertRow', 'updateRow', 'deleteRow', 'insertCol', 'deleteCol'];
/** 函数调用开括号容忍全角；开括号前可空格 */
const FN_CALL_RE = /(insertRow|updateRow|deleteRow|insertCol|deleteCol)\s*[（(]/g;
/** 引号感知的配对闭括号扫描：从 openPos 的 '(' 起找到配对 ')'（支持跨行字典） */
function findCloseParen(src, openPos) {
    let depth = 0;
    let q = null;
    for (let i = openPos; i < src.length; i++) {
        const ch = src[i];
        if (q) {
            if (ch === '\\' && i + 1 < src.length) {
                i++;
                continue;
            }
            if (ch === q)
                q = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            q = ch;
            continue;
        }
        if (ch === '“') {
            q = '”';
            continue;
        }
        if (ch === '(' || ch === '（')
            depth++;
        else if (ch === ')' || ch === '）') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
/** 提取块内全部函数调用（区间 [start,end) 供旧分号式跳过） */
function extractFnCalls(block) {
    const out = [];
    FN_CALL_RE.lastIndex = 0;
    let m;
    while ((m = FN_CALL_RE.exec(block)) !== null) {
        const op = FN_OPS.find(o => o === m[1]);
        const openPos = m.index + m[0].length - 1;
        const closePos = findCloseParen(block, openPos);
        if (closePos < 0)
            continue; // 未闭合 → 丢弃，继续找下一个
        out.push({ op, argsSrc: block.slice(openPos + 1, closePos), start: m.index, end: closePos + 1 });
        FN_CALL_RE.lastIndex = closePos + 1;
    }
    return out;
}
/** 去包裹引号（半角单双引号/全角弯引号） */
function stripArgQuotes(s) {
    const t = s.trim();
    if (t.length >= 2
        && ((t.startsWith('"') && t.endsWith('"'))
            || (t.startsWith("'") && t.endsWith("'"))
            || (t.startsWith('“') && t.endsWith('”'))))
        return t.slice(1, -1);
    return t;
}
/** 引号 + 花括号感知的顶层逗号切分（半角/全角逗号；引号内/字典内逗号不切） */
function splitFnArgs(s) {
    const out = [];
    let cur = '';
    let q = null;
    let braceDepth = 0;
    for (const ch of s) {
        if (q) {
            cur += ch;
            if (ch === q)
                q = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            q = ch;
            cur += ch;
            continue;
        }
        if (ch === '“') {
            q = '”';
            cur += ch;
            continue;
        }
        if (ch === '{' || ch === '｛') {
            braceDepth++;
            cur += ch;
            continue;
        }
        if (ch === '}' || ch === '｝') {
            braceDepth = Math.max(0, braceDepth - 1);
            cur += ch;
            continue;
        }
        if (braceDepth === 0 && (ch === ',' || ch === '，')) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur.trim() !== '' || out.length > 0)
        out.push(cur);
    return out;
}
/**
 * 宽松字典解析（ST parseLooseDict 同语义换实现）：key 容忍有/无引号，值容忍单双引号/
 * 全角引号；仅保留数字键（ST formatParams 同款丢弃非数字键）。
 */
function parseLooseDict(src) {
    const t = src.trim();
    if (!(t.startsWith('{') && t.endsWith('}')))
        return null;
    const body = t.slice(1, -1);
    const out = {};
    for (const pair of splitFnArgs(body)) {
        const seg = pair.trim();
        if (!seg)
            continue;
        const ci = seg.search(/[:：]/);
        if (ci < 0)
            continue;
        const key = stripArgQuotes(seg.slice(0, ci));
        const value = stripArgQuotes(seg.slice(ci + 1));
        if (!/^\d+$/.test(key))
            continue;
        out[key] = value;
    }
    return out;
}
/** 函数调用参数解析：数字 → number，{...} → 字典（仅数字键），其余 → 去引号字符串 */
function parseFnArgs(src) {
    return splitFnArgs(src)
        .map(a => a.trim())
        .filter(a => a !== '')
        .map(a => {
        if (/^-?\d+(\.\d+)?$/.test(a))
            return Number(a);
        if (a.startsWith('{') && a.endsWith('}')) {
            const dict = parseLooseDict(a);
            return dict ?? stripArgQuotes(a);
        }
        return stripArgQuotes(a);
    });
}
/** {0:"a",2:"c"} → ['a','','c']（列键 = headers 下标，缺位补空串） */
function dictToPositional(data) {
    const keys = Object.keys(data).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
    if (keys.length === 0)
        return [];
    const out = [];
    for (let i = 0; i <= keys[keys.length - 1]; i++)
        out.push(data[String(i)] ?? '');
    return out;
}
/**
 * 函数调用参数 → TableEdit（基数对齐 ST executeAction/classifyParams）：
 * - 表索引：args[0] 必须是数字（0 起，按启用表数组下标）；缺失 → null（skip）
 * - updateRow/deleteRow 行号：0 起数据行 → 内部 1 起（ST findCellByPosition(rowIndex+1,…)）
 * - updateRow 数据字典列键：0 起 headers 下标 → 内部 "列号=值"（1 起）
 * - insertRow：一律追加表尾（ST 忽略行参）；数据字典 → 按下标顺填
 * - insertCol/deleteCol：列号 0 起 → 内部 1 起（ST 网格列键 +1 同款）
 */
function fnCallToEdit(op, args) {
    if (args.length === 0)
        return null;
    const a0 = args[0];
    if (typeof a0 !== 'number' || !Number.isInteger(a0) || a0 < 0)
        return null;
    const sheetIndex = a0;
    if (op === 'insertRow') {
        const data = args.find(a => typeof a === 'object');
        if (!data)
            return null;
        return { sheet: '', sheetIndex, op, values: dictToPositional(data) };
    }
    if (op === 'updateRow') {
        const rowArg = args[1];
        const data = args.find((a, i) => i >= 2 && typeof a === 'object');
        if (typeof rowArg !== 'number' || !Number.isInteger(rowArg) || rowArg < 0 || !data)
            return null;
        const values = Object.entries(data).map(([k, v]) => `${Number(k) + 1}=${v}`);
        return { sheet: '', sheetIndex, op, row: rowArg + 1, values };
    }
    if (op === 'deleteRow') {
        const rowArg = args[1];
        if (typeof rowArg !== 'number' || !Number.isInteger(rowArg) || rowArg < 0)
            return null;
        return { sheet: '', sheetIndex, op, row: rowArg + 1, values: [] };
    }
    if (op === 'insertCol') {
        let col;
        let name;
        for (const a of args.slice(1)) {
            if (typeof a === 'number' && col === undefined)
                col = a + 1;
            else if (typeof a === 'string' && name === undefined)
                name = a;
        }
        if (name === undefined || !name)
            return null;
        return { sheet: '', sheetIndex, op, col, values: [name] };
    }
    // deleteCol
    const colArg = args[1];
    if (typeof colArg !== 'number' || !Number.isInteger(colArg) || colArg < 0)
        return null;
    return { sheet: '', sheetIndex, op, col: colArg + 1, values: [] };
}
/**
 * 执行指令（纯函数，不改入参）：按表名或表索引寻址，行号越界/表缺失跳过（E2 容错）。
 * 【实机审计修复 2026-09-05】函数调用式指令带 sheetIndex（0 起）时按 ST executeAction
 * 同款寻址：sheets[enable 过滤后][tableIndex]；无 sheetIndex 的旧分号式指令按表名寻址。
 * 应用顺序 = 指令顺序（ST sortActions 的 update→insert→delete 排序是行号位移补偿，
 * 本格式行号即时寻址且文档声明逐行执行，不做重排——语义可预期）。
 */
function executeTableEdits(sheets, edits) {
    const next = cloneSheets(sheets);
    let applied = 0;
    let skipped = 0;
    for (const edit of edits) {
        let sheet;
        if (edit.sheetIndex !== undefined) {
            const enabled = next.filter(s => s.enabled);
            sheet = enabled[edit.sheetIndex];
        }
        else {
            sheet = next.find(s => s.name === edit.sheet) ?? next.find(s => s.name.trim() === edit.sheet.trim());
        }
        if (!sheet) {
            skipped++;
            continue;
        }
        if (edit.op === 'insertRow') {
            // 位置合法域 [1, rows.length+1]（末尾追加 = rows.length+1）
            const pos = edit.row ?? sheet.rows.length + 1;
            if (!Number.isInteger(pos) || pos < 1 || pos > sheet.rows.length + 1) {
                skipped++;
                continue;
            }
            const cells = sheet.headers.map((_, i) => edit.values[i] ?? '');
            sheet.rows.splice(pos - 1, 0, cells);
            applied++;
        }
        else if (edit.op === 'updateRow') {
            if (!Number.isInteger(edit.row) || edit.row < 1 || edit.row > sheet.rows.length) {
                skipped++;
                continue;
            }
            const row = sheet.rows[edit.row - 1];
            let touched = 0;
            for (const v of edit.values) {
                // 列=值：列可以是列号（1 起）或列名（匹配表头，模型友好）；键既非列号也非列名
                // 时整串按字面值从列 1 顺填；列号越界 → 该对跳过
                const eq = v.indexOf('=');
                let col = null;
                if (eq > 0) {
                    const key = v.slice(0, eq).trim();
                    if (isIntToken(key))
                        col = Number(key);
                    else {
                        const idx = sheet.headers.findIndex(h => h.trim() === key);
                        if (idx >= 0)
                            col = idx + 1;
                    }
                }
                if (col !== null) {
                    if (col < 1 || col > sheet.headers.length)
                        continue;
                    row[col - 1] = v.slice(eq + 1);
                    touched++;
                }
                else {
                    const pos = touched + 1;
                    if (pos > sheet.headers.length)
                        continue;
                    row[pos - 1] = v;
                    touched++;
                }
            }
            touched > 0 ? applied++ : skipped++;
        }
        else if (edit.op === 'deleteRow') {
            if (!Number.isInteger(edit.row) || edit.row < 1 || edit.row > sheet.rows.length) {
                skipped++;
                continue;
            }
            sheet.rows.splice(edit.row - 1, 1);
            applied++;
        }
        else if (edit.op === 'insertCol') {
            const pos = edit.col ?? sheet.headers.length + 1;
            if (!Number.isInteger(pos) || pos < 1 || pos > sheet.headers.length + 1) {
                skipped++;
                continue;
            }
            sheet.headers.splice(pos - 1, 0, edit.values[0] ?? '');
            for (const row of sheet.rows)
                row.splice(pos - 1, 0, '');
            applied++;
        }
        else if (edit.op === 'deleteCol') {
            if (!Number.isInteger(edit.col) || edit.col < 1 || edit.col > sheet.headers.length) {
                skipped++;
                continue;
            }
            if (sheet.headers.length <= 1) {
                skipped++;
                continue;
            } // 至少保留 1 列
            sheet.headers.splice(edit.col - 1, 1);
            for (const row of sheet.rows)
                row.splice(edit.col - 1, 1);
            applied++;
        }
        else {
            // setName / rename：改名（寻址用旧名，改名后新名生效）
            const newName = edit.values[0]?.trim();
            if (!newName) {
                skipped++;
                continue;
            }
            sheet.name = newName;
            applied++;
        }
    }
    return { sheets: next, applied, skipped };
}
// ---------------------------------------------------------------------------
// E3：提示词渲染 / E8：表格宏
// ---------------------------------------------------------------------------
/** 单元格渲染净化：竖线/换行会破坏「一行一格」的表格文本形态（ST CSV 同问题，这里主动净化） */
function cellText(v) {
    return String(v ?? '').replace(/\|/g, '丨').replace(/\r?\n/g, ' ').trim();
}
/** 渲染启用的表（数据面：title + headers + rows；ST isPureData 口径，E8 {{tableData}} 用） */
function renderTableData(sheets) {
    const active = sheets.filter(s => s.enabled);
    if (active.length === 0)
        return '';
    return active.map(s => {
        const lines = [`## ${s.name}`];
        if (s.headers.length > 0)
            lines.push(s.headers.map(h => cellText(h)).join(' | '));
        for (const row of s.rows)
            lines.push(s.headers.map((_, i) => cellText(row[i])).join(' | '));
        return lines.join('\n');
    }).join('\n\n');
}
/**
 * 渲染「当前表格 + 可用操作规则」（E3 pre-step 注入文本；ST getTablePromptByPiece
 * 含 editRules 的完整口径）。无启用表返回空串（调用方不注入）。
 */
function renderTablePrompt(sheets) {
    const data = renderTableData(sheets);
    if (!data)
        return '';
    return [
        '【剧情表格】（当前状态跟踪表。需要增删改条目时，在回复末尾输出一个 <tableEdit> 块，块内每行一条指令，格式：表名; 操作; 参数…）',
        '可用操作（行号/列号均从 1 开始，行号只数数据行不含表头）：',
        '- 表名; insertRow; [行号]; 单元格1; 单元格2; …（插入数据行；省略行号 = 追加到表尾）',
        '- 表名; updateRow; 行号; 列=新值; …（列号从 1 开始；一次可更新多列）',
        '- 表名; deleteRow; 行号',
        '- 表名; insertCol; [列号]; 表头名',
        '- 表名; deleteCol; 列号',
        '- 表名; setName; 新表名',
        '示例：',
        '<tableEdit>',
        '状态; updateRow; 1; 位置=咖啡厅; 心情=紧张',
        '事件; insertRow; 在门口遇到旧识',
        '</tableEdit>',
        '当前表格：',
        data,
    ].join('\n');
}
/** {{GET::表名:行:列}} 取单元格（1 起行列；越界/表缺失 → null，宏替换为空串） */
function getTableCell(sheets, name, row, col) {
    const sheet = sheets.find(s => s.name === name) ?? sheets.find(s => s.name.trim() === name.trim());
    if (!sheet)
        return null;
    if (!Number.isInteger(row) || row < 1 || row > sheet.rows.length)
        return null;
    if (!Number.isInteger(col) || col < 1 || col > sheet.headers.length)
        return null;
    return sheet.rows[row - 1][col - 1] ?? '';
}
/**
 * 【实机审计修复 2026-09-05】A1 式单元格地址解析（ST {{GET::表:A1}} 宏同款形态，
 * resolveTableMacros 的 [A-Z]+\d+ 第三段）：字母 = 列（base26，A = 第 1 列），
 * 数字 = 行（1 = 第 1 数据行，与三段数字形态同口径，即 A1 ≡ 1:1）。
 * ST 源码 getCellFromAddress 的网格含行头列/表头行偏移（A→行号列、1→表头行），
 * 本移植数据网格无行号列，按 Excel 式直读。非法地址 → null。
 */
function parseA1Address(addr) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(addr.trim());
    if (!m)
        return null;
    let col = 0;
    for (const ch of m[1].toUpperCase())
        col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = Number(m[2]);
    if (row < 1 || col < 1)
        return null;
    return { row, col };
}
/**
 * E8：表格宏展开（纯函数）——{{tableData}}/{{tablePrompt}}/{{GET::表名:行:列}} →
 * 当前 sheets 渲染值。只在 pre-step 注入点调用（不改全局宏引擎）。
 * 【实机审计修复 2026-09-05】GET 第三段兼容 A1 式单元格地址（{{GET::表名:B2}}，
 * 字母列+数字行，ST resolveTableMacros 同款）与现有 行:列 两段数字两种形态。
 */
function expandTableMacros(text, sheets) {
    let out = text;
    if (/\{\{\s*tableData\s*\}\}/i.test(out))
        out = out.replace(/\{\{\s*tableData\s*\}\}/gi, renderTableData(sheets));
    if (/\{\{\s*tablePrompt\s*\}\}/i.test(out))
        out = out.replace(/\{\{\s*tablePrompt\s*\}\}/gi, renderTablePrompt(sheets));
    if (/\{\{\s*GET::/i.test(out)) {
        // 表名允许含冒号：末段是 A1 式地址 → A1 解析；否则最后两段 = 行、列（{{GET::表:行:列}}）
        out = out.replace(/\{\{\s*GET::([^}]+)\}\}/gi, (_all, body) => {
            const segs = body.split(':').map(s => s.trim());
            if (segs.length < 2)
                return '';
            const a1 = parseA1Address(segs[segs.length - 1]);
            if (a1) {
                const name = segs.slice(0, -1).join(':');
                return getTableCell(sheets, name, a1.row, a1.col) ?? '';
            }
            if (segs.length < 3)
                return '';
            const col = Number(segs.pop());
            const row = Number(segs.pop());
            const name = segs.join(':');
            return getTableCell(sheets, name, row, col) ?? '';
        });
    }
    return out;
}
