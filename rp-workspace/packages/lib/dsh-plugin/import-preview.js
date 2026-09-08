"use strict";
/**
 * §4.16.1 / §4.6 导入 diff 预览 + 断点续跑（checkpoint）—— 纯逻辑层（index.ts 只做路由薄接线）
 *
 * 预览（只读不改）：扫 rp-import/<batchId>/unpacked 的 ST 数据目录，产出分类预览
 * （卡/书/聊天/预设/明确丢弃项/EJS 模板计数），对应 PROJECT_PLAN §4.6 行 495-500 的
 * diff 预览屏（✓ 新增 / ⚠ 转换·覆盖 / ○ 跳过）——用户确认后才 kickoff（前端门禁）。
 *
 * 断点续跑：迁移 agent 逐类目完成后 POST /rp/import-checkpoint 落
 * rp-import/<batchId>/checkpoint.json（{stages:{<类目>:{done,updatedAt}}, updatedAt}）；
 * 中断重开后先 GET 读 checkpoint，done 类目直接跳过、只补缺失类目
 * （契约见 SKILL.md「断点续跑（必做）」；消费执行者是迁移 agent）。
 *
 * findStDataRoot 从 index.ts 移入本文件（index.ts re-export 保持既有公开面不变）——
 * 避免 import-preview ↔ index 循环依赖（esbuild 循环引用初始化顺序脆）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKPOINT_STAGES = void 0;
exports.findStDataRoot = findStDataRoot;
exports.normalizeName = normalizeName;
exports.classifyDropped = classifyDropped;
exports.isEjsTemplate = isEjsTemplate;
exports.cardJsonName = cardJsonName;
exports.lorebookEntryCount = lorebookEntryCount;
exports.stPresetPromptCount = stPresetPromptCount;
exports.loadExistingState = loadExistingState;
exports.findExistingCardSlug = findExistingCardSlug;
exports.findBookBoundBy = findBookBoundBy;
exports.countChatMessages = countChatMessages;
exports.scanImportPreview = scanImportPreview;
exports.sanitizeDoneList = sanitizeDoneList;
exports.parseCheckpointFile = parseCheckpointFile;
exports.normalizeCheckpointWrite = normalizeCheckpointWrite;
exports.summarizeCheckpoint = summarizeCheckpoint;
exports.claimHint = claimHint;
exports.parseDoneEntry = parseDoneEntry;
exports.countDoneByStage = countDoneByStage;
exports.progressTotalsFromManifest = progressTotalsFromManifest;
exports.estimateRemainingMinutes = estimateRemainingMinutes;
exports.collectPreviewClaims = collectPreviewClaims;
exports.buildBatchProgress = buildBatchProgress;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const dsh_export_ts_1 = require("../import/dsh-export.ts");
const character_card_ts_1 = require("../import/character-card.ts");
const session_surgery_ts_1 = require("../dsht-plugin-shared/session-surgery.ts");
// ---------------------------------------------------------------------------
// ST 数据根定位（自 index.ts 原样移入：标志打分 + 隐藏目录排除）
// ---------------------------------------------------------------------------
/**
 * 在 unpacked/ 下定位 ST data 根：找含 settings.json 的最深目录
 * （多用户结构 data/<user>/settings.json 最深者优先）。
 */
async function findStDataRoot(unpackedDir) {
    const hits = [];
    const walk = async (dir, depth) => {
        if (depth > 5 || hits.length > 32)
            return;
        let names;
        try {
            names = await (0, promises_1.readdir)(dir);
        }
        catch {
            return;
        }
        if (names.includes('settings.json'))
            hits.push(dir);
        for (const n of names) {
            if (n.startsWith('.'))
                continue; // .vscode/.git 等隐藏目录不参与（实测 JS-Slash-Runner/.vscode/settings.json 抢根）
            if (hits.length > 32)
                return;
            try {
                const sub = (0, node_path_1.join)(dir, n);
                const subNames = await (0, promises_1.readdir)(sub);
                if (subNames !== undefined)
                    await walk(sub, depth + 1);
            }
            catch { /* 不是目录 */ }
        }
    };
    await walk(unpackedDir, 0);
    if (hits.length === 0)
        return null;
    // 选 ST 标志目录最多的候选；同分取更浅（短）的——真根（data/default-user）标志齐全，
    // 深层目录（插件 .vscode 等）即使也有 settings.json 也没有 worlds/characters/chats
    const ST_MARKERS = ['worlds', 'characters', 'chats', 'OpenAI Settings', 'QuickReplies'];
    const scored = [];
    for (const h of hits) {
        let names = [];
        try {
            names = await (0, promises_1.readdir)(h);
        }
        catch { /* 读不到按 0 分 */ }
        scored.push({ dir: h, score: ST_MARKERS.filter(m => names.includes(m)).length });
    }
    scored.sort((a, b) => b.score - a.score || a.dir.length - b.dir.length);
    return scored[0].dir;
}
// ---------------------------------------------------------------------------
// 预览：纯判定函数
// ---------------------------------------------------------------------------
/** 卡/书/聊天归属匹配用归一化（与 rebuild-chats 同口径：去空白 + 小写） */
function normalizeName(s) {
    return s.replace(/\s+/g, '').toLowerCase();
}
/**
 * 明确丢弃项判定（§4.16.1 设计决策：这些是设计上不导入的，要在预览里写明去向）。
 * 返回丢弃原因；null = 不是丢弃项。relPath 为 unpacked 内 posix 相对路径。
 */
function classifyDropped(relPath) {
    const p = relPath.replaceAll('\\', '/');
    const segs = p.split('/').filter(s => s.length > 0);
    const name = segs[segs.length - 1] ?? p;
    // vectors/：ST 向量库（vectors-enhanced 等的数据缓存）——DSH 用世界书触发引擎检索，向量库不导入
    if (segs.some(s => s.toLowerCase() === 'vectors')) {
        return '向量库数据（ST vectors-enhanced 检索缓存）——DSH 用世界书触发引擎做检索，向量库不迁移';
    }
    // backups/：ST 自动备份目录——历史备份不导入
    if (segs.some(s => s.toLowerCase() === 'backups')) {
        return 'ST 自动备份目录——历史备份不迁移（源 zip 本身就是完整备份）';
    }
    // .luker-state.*.json：chats/<角色>/ 下的插件私有状态（IMPORT_REWORK_PLAN §1 事实基础）
    if (name.includes('.luker-state.')) {
        return 'Luker 插件私有状态文件——插件数据不迁移（插件适配见 st-plugins-assessment）';
    }
    // .before_clean*：插件清洗前备份——临时文件不导入
    if (name.startsWith('.before_clean')) {
        return '插件清洗前备份（.before_clean）——临时文件不迁移';
    }
    // chats/ 下的其他隐藏文件：插件附属数据（st 聊天导入器同款排除逻辑）
    if (segs[0] === 'chats' && name.startsWith('.')) {
        return 'chats 目录下的插件附属隐藏文件——插件私有数据不迁移';
    }
    return null;
}
/** EJS 模板语法检测（<% … %>）——命中即提示「将转条件槽位」 */
function isEjsTemplate(text) {
    return typeof text === 'string' && text.includes('<%') && text.includes('%>');
}
/** 卡 JSON 里的卡名（V2 data.name / V1 顶层 name） */
function cardJsonName(root) {
    if (!root || typeof root !== 'object')
        return null;
    const r = root;
    const n = r.data?.name ?? r.name;
    return typeof n === 'string' && n.trim() ? n.trim() : null;
}
/** 世界书 JSON 的条目数（entries 可能是对象映射或数组两种 ST 形态） */
function lorebookEntryCount(root) {
    if (!root || typeof root !== 'object')
        return 0;
    const entries = root.entries;
    if (Array.isArray(entries))
        return entries.length;
    if (entries && typeof entries === 'object')
        return Object.keys(entries).length;
    return 0;
}
/** ST 预设 JSON 的 prompts 数（无 prompts 字段按 0 计） */
function stPresetPromptCount(root) {
    if (!root || typeof root !== 'object')
        return 0;
    const prompts = root.prompts;
    return Array.isArray(prompts) ? prompts.length : 0;
}
async function loadExistingState(dshHome) {
    const workspaces = [];
    const rpDir = (0, node_path_1.join)(dshHome, 'rp');
    for (const dir of await (0, promises_1.readdir)(rpDir).catch(() => [])) {
        try {
            const rp = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(rpDir, dir, 'rp.json'), 'utf8'));
            workspaces.push({
                dir,
                characterName: typeof rp.characterName === 'string' ? rp.characterName : undefined,
                books: Array.isArray(rp.books) ? rp.books : [],
            });
        }
        catch { /* 无 rp.json 的目录不是工作区 */ }
    }
    const presets = [];
    const presetDir = (0, node_path_1.join)(dshHome, 'rp-presets');
    for (const id of await (0, promises_1.readdir)(presetDir).catch(() => [])) {
        try {
            const p = JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(presetDir, id, 'preset.json'), 'utf8'));
            presets.push({
                id: typeof p.id === 'string' ? p.id : id,
                displayName: typeof p.displayName === 'string' ? p.displayName : id,
            });
        }
        catch { /* 非预设目录 */ }
    }
    const sessions = (await (0, session_surgery_ts_1.scanSessionHeaders)(dshHome).catch(() => [])).map(h => ({
        sessionId: h.sessionId, project: h.project, sdir: h.sdir,
    }));
    return { workspaces, presets, sessions };
}
/** 卡名 → 库内是否已有同名工作区（rp/<slug> 目录名按卡名 dshSlug 匹配；rp.json characterName 归一化兜底） */
function findExistingCardSlug(name, state) {
    const slug = (0, dsh_export_ts_1.dshSlug)('rp', name);
    if (state.workspaces.some(w => w.dir === slug))
        return slug;
    const norm = normalizeName(name);
    const hit = state.workspaces.find(w => w.characterName && normalizeName(w.characterName) === norm);
    return hit ? hit.dir : null;
}
/** 书名 → 库内是否已被某工作区绑定（books[].name 归一化匹配或 lorePath slug 匹配）；返回绑定它的工作区列表 */
function findBookBoundBy(name, state) {
    const slug = (0, dsh_export_ts_1.dshSlug)('wb', name);
    const lorePathSuffix = `skills/${slug}/references/lore.json`;
    const norm = normalizeName(name);
    const out = [];
    for (const w of state.workspaces) {
        const bound = (w.books ?? []).some(b => (typeof b?.name === 'string' && normalizeName(b.name) === norm)
            || (typeof b?.lorePath === 'string' && b.lorePath.replaceAll('\\', '/') === lorePathSuffix));
        if (bound)
            out.push(w.characterName || w.dir);
    }
    return out;
}
/** 单卡/单书 JSON 头判型（与 index.ts scanImportManifest 同口径） */
function kindFromJsonHead(head) {
    if (/"spec"\s*:\s*"chara_card|"mes_example"\s*:|"first_mes"\s*:/.test(head))
        return 'single-card';
    if (/"entries"\s*:/.test(head))
        return 'single-book';
    return 'unknown';
}
/** 聊天 .jsonl 消息数（首行 header 之后的非空行；8MiB 上限护栏——第五轮 OOM 教训） */
const CHAT_READ_CAP = 8 * 1024 * 1024;
async function countChatMessages(path) {
    let handle = null;
    try {
        handle = await (0, promises_1.open)(path, 'r');
        const { size } = await handle.stat();
        const cap = Math.min(size, CHAT_READ_CAP);
        const buf = Buffer.alloc(cap);
        await handle.read(buf, 0, cap, 0);
        const lines = buf.toString('utf8').split('\n');
        let count = 0;
        for (let i = 1; i < lines.length; i++) { // 首行 header 不计
            if (lines[i].trim())
                count++;
        }
        // 尾行可能被截断在 8MiB 边界——最坏把最后半行也算 1 条，下界语义成立
        return { count, approx: size > CHAT_READ_CAP };
    }
    catch {
        return { count: 0, approx: false };
    }
    finally {
        await handle?.close().catch(() => { });
    }
}
/** 丢弃项扫描（unpacked 全树；深度/条目数双重护栏） */
async function scanDropped(unpackedDir) {
    const out = [];
    const walk = async (dir, depth) => {
        if (depth > 4 || out.length > 400)
            return;
        let entries;
        try {
            entries = await (0, promises_1.readdir)(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (out.length > 400)
                return;
            const abs = (0, node_path_1.join)(dir, e.name);
            const rel = (0, node_path_1.relative)(unpackedDir, abs).replaceAll(node_path_1.sep, '/');
            if (e.isDirectory()) {
                const reason = classifyDropped(rel + '/');
                if (reason) {
                    out.push({ path: rel + '/', reason });
                    continue;
                } // 命中丢弃的整目录不再下钻
                await walk(abs, depth + 1);
            }
            else {
                const reason = classifyDropped(rel);
                if (reason)
                    out.push({ path: rel, reason });
            }
        }
    };
    await walk(unpackedDir, 0);
    return out;
}
/**
 * 逐文件解析角色卡 → 预览（st-data 的 characters/ 与单文件 inbox 复用同一实现）。
 * @param files 文件清单（name = 带扩展名文件名；abs = 绝对路径）
 * @param relPrefix 落在 sourceFile 前的目录段（characters / inbox）
 * @param pngStems 同目录已有的 PNG 主名集合（JSON 卡的配对立绘判定；inbox 场景传空集）
 */
async function scanCardFiles(files, relPrefix, pngStems, state) {
    const out = [];
    for (const f of files) {
        const stem = f.name.replace(/\.(png|json)$/i, '');
        let cardRoot = null;
        let avatar = false;
        if (/\.png$/i.test(f.name)) {
            // PNG 卡：tEXt char/ccv3 chunk 解出完整卡 JSON（失败按文件主名兜底）
            try {
                const json = (0, character_card_ts_1.extractCardJsonFromPng)(await (0, promises_1.readFile)(f.abs));
                if (json)
                    cardRoot = JSON.parse(json);
            }
            catch {
                cardRoot = null;
            }
            avatar = true; // PNG 卡本身即立绘
        }
        else {
            try {
                cardRoot = JSON.parse(await (0, promises_1.readFile)(f.abs, 'utf8'));
            }
            catch {
                cardRoot = null;
            }
            avatar = pngStems.has(stem); // JSON 卡看同名配对 png
        }
        const data = (cardRoot && typeof cardRoot === 'object'
            ? cardRoot.data ?? cardRoot
            : {});
        const cardName = cardJsonName(cardRoot) ?? stem; // 卡名解析失败按文件主名兜底（迁移 agent 再做语义判断）
        const regexCount = Array.isArray(data.extensions?.regex_scripts)
            ? data.extensions.regex_scripts.length : 0;
        const bookEntries = data.character_book?.entries;
        const hasEmbeddedWorldInfo = Array.isArray(bookEntries) ? bookEntries.length > 0
            : bookEntries && typeof bookEntries === 'object' ? Object.keys(bookEntries).length > 0 : false;
        const alternateGreetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings.length : 0;
        const existing = state ? findExistingCardSlug(cardName, state) : null;
        out.push({
            name: cardName,
            avatar,
            regexCount,
            hasEmbeddedWorldInfo,
            alternateGreetings,
            target: existing ? '已存在(同名)' : '新工作区',
            slug: existing ?? (0, dsh_export_ts_1.dshSlug)('rp', cardName),
            sourceFile: `${relPrefix}/${f.name}`,
            ejs: isEjsTemplate(JSON.stringify(cardRoot ?? {})),
        });
    }
    return out;
}
/** 扫 characters/ 产出卡预览（PNG tEXt 卡名 + JSON 卡；只读顶层——子目录是表情差分图） */
async function scanPreviewCards(stRoot, state) {
    const charsDir = (0, node_path_1.join)(stRoot, 'characters');
    let names = [];
    try {
        names = await (0, promises_1.readdir)(charsDir);
    }
    catch {
        return [];
    }
    const pngStems = new Set(names.filter(n => /\.png$/i.test(n)).map(n => n.replace(/\.png$/i, '')));
    const files = names
        .filter(n => /\.(png|json)$/i.test(n))
        .map(n => ({ name: n, abs: (0, node_path_1.join)(charsDir, n) }));
    return scanCardFiles(files, 'characters', pngStems, state);
}
/** 扫 worlds/ 产出书预览（条目数轻解析；已绑定判定） */
async function scanPreviewBooks(stRoot, state) {
    const worldsDir = (0, node_path_1.join)(stRoot, 'worlds');
    let names = [];
    try {
        names = await (0, promises_1.readdir)(worldsDir);
    }
    catch {
        return [];
    }
    const books = [];
    for (const name of names.filter(n => /\.json$/i.test(n))) {
        const abs = (0, node_path_1.join)(worldsDir, name);
        const bookName = name.replace(/\.json$/i, '');
        let entryCount = 0;
        let ejsEntries = 0;
        try {
            const text = await (0, promises_1.readFile)(abs, 'utf8');
            const root = JSON.parse(text);
            entryCount = lorebookEntryCount(root);
            const entries = Array.isArray(root.entries) ? root.entries
                : root.entries && typeof root.entries === 'object' ? Object.values(root.entries) : [];
            for (const e of entries) {
                if (isEjsTemplate(JSON.stringify(e ?? {})))
                    ejsEntries++;
            }
        }
        catch { /* 坏 JSON：0 条目照列（agent 迁移时再报错） */ }
        const boundBy = state ? findBookBoundBy(bookName, state) : [];
        books.push({
            name: bookName,
            entryCount,
            target: boundBy.length > 0 ? '已绑定' : '新 skill',
            ...(boundBy.length > 0 ? { boundBy } : {}),
            sourceFile: `worlds/${name}`,
            ejsEntries,
        });
    }
    return books;
}
/** 扫 chats/ 产出聊天预览（消息数 + 已存在 session 匹配） */
async function scanPreviewChats(stRoot, cards, state, dshHome) {
    const chatsDir = (0, node_path_1.join)(stRoot, 'chats');
    let owners = [];
    try {
        owners = await (0, promises_1.readdir)(chatsDir);
    }
    catch {
        return [];
    }
    // 归属匹配三键：卡内 name / PNG 文件名 / chats 目录名（与迁移 agent 的三键兜底同口径）
    const normMap = new Map();
    for (const c of cards) {
        normMap.set(normalizeName(c.name), c);
        const stem = c.sourceFile.replace(/^characters\//, '').replace(/\.(png|json)$/i, '');
        normMap.set(normalizeName(stem), c);
    }
    // realpath 缓存：工作区目录 → sessions 的 projectKey（session 落盘键）
    const projectBySlug = new Map();
    if (state && dshHome) {
        for (const w of state.workspaces) {
            try {
                const real = await (0, promises_1.realpath)((0, node_path_1.join)(dshHome, 'rp', w.dir));
                projectBySlug.set(w.dir, (0, dsh_export_ts_1.projectKey)(real.replaceAll(node_path_1.sep, '/')));
            }
            catch { /* 目录没了 */ }
        }
    }
    const sessionKeys = new Set((state?.sessions ?? []).map(s => `${s.project}/${s.sdir}`));
    const chats = [];
    for (const owner of owners.sort()) {
        const ownerDir = (0, node_path_1.join)(chatsDir, owner);
        let files = [];
        try {
            files = await (0, promises_1.readdir)(ownerDir);
        }
        catch {
            continue;
        }
        const card = normMap.get(normalizeName(owner));
        const wsSlug = card?.slug ?? (state ? findExistingCardSlug(owner, state) : null);
        for (const file of files.filter(f => f.endsWith('.jsonl')).sort()) {
            const { count, approx } = await countChatMessages((0, node_path_1.join)(ownerDir, file));
            // targetSessionId：workspace 存在时按 chatSessionId(characterName, chatFile) 推导，
            // 再对 sessions/<projectKey>/<encodeSegment(id)> 是否落盘做精确匹配
            let targetSessionId;
            if (wsSlug && projectBySlug.has(wsSlug)) {
                const charName = card?.name ?? owner;
                const sid = (0, dsh_export_ts_1.chatSessionId)(charName, file);
                if (sessionKeys.has(`${projectBySlug.get(wsSlug)}/${(0, dsh_export_ts_1.encodeSegment)(sid)}`))
                    targetSessionId = sid;
            }
            chats.push({
                name: `${owner}/${file}`,
                messageCount: count,
                approx,
                ...(targetSessionId ? { targetSessionId } : {}),
                orphan: !card && !wsSlug,
                sourceFile: `chats/${owner}/${file}`,
            });
        }
    }
    return chats;
}
/** 扫 OpenAI Settings/ 产出预设预览（displayName + prompts 数 + 同名覆盖检测） */
async function scanPreviewPresets(stRoot, state) {
    const dir = (0, node_path_1.join)(stRoot, 'OpenAI Settings');
    let names = [];
    try {
        names = await (0, promises_1.readdir)(dir);
    }
    catch {
        return [];
    }
    const presets = [];
    for (const name of names.filter(n => /\.json$/i.test(n) && !/\.luker-state\./i.test(n))) {
        const abs = (0, node_path_1.join)(dir, name);
        let displayName = name.replace(/\.json$/i, '');
        let promptCount = 0;
        let ejs = false;
        try {
            const text = await (0, promises_1.readFile)(abs, 'utf8');
            const root = JSON.parse(text);
            if (typeof root.name === 'string' && root.name.trim())
                displayName = root.name.trim();
            promptCount = stPresetPromptCount(root);
            ejs = isEjsTemplate(text);
        }
        catch { /* 坏 JSON：按文件名照列 */ }
        const norm = normalizeName(displayName);
        const existing = state?.presets.find(p => normalizeName(p.displayName) === norm);
        presets.push({
            displayName,
            promptCount,
            ...(existing ? { targetPresetId: existing.id } : {}),
            sourceFile: `OpenAI Settings/${name}`,
            ejs,
        });
    }
    return presets;
}
/** 单文件批次（unpacked/inbox/<file>）的最小预览 */
async function scanInboxPreview(unpackedDir, state) {
    const inbox = (0, node_path_1.join)(unpackedDir, 'inbox');
    let names = [];
    try {
        names = await (0, promises_1.readdir)(inbox);
    }
    catch {
        return { kind: 'unknown' };
    }
    const file = names.find(n => /\.(png|json)$/i.test(n));
    if (!file)
        return { kind: 'unknown' };
    const abs = (0, node_path_1.join)(inbox, file);
    if (/\.png$/i.test(file)) {
        const cards = await scanCardFiles([{ name: file, abs }], 'inbox', new Set(), state);
        return { kind: 'single-card', cards };
    }
    try {
        const text = await (0, promises_1.readFile)(abs, 'utf8');
        const kind = kindFromJsonHead(text.slice(0, 4096));
        if (kind === 'single-card') {
            const cards = await scanCardFiles([{ name: file, abs }], 'inbox', new Set(), state);
            return { kind, cards };
        }
        if (kind === 'single-book') {
            const root = JSON.parse(text);
            const bookName = file.replace(/\.json$/i, '');
            let ejsEntries = 0;
            const entries = Array.isArray(root.entries) ? root.entries
                : root.entries && typeof root.entries === 'object' ? Object.values(root.entries) : [];
            for (const e of entries)
                if (isEjsTemplate(JSON.stringify(e ?? {})))
                    ejsEntries++;
            const boundBy = state ? findBookBoundBy(bookName, state) : [];
            return {
                kind,
                books: [{
                        name: bookName,
                        entryCount: lorebookEntryCount(root),
                        target: boundBy.length > 0 ? '已绑定' : '新 skill',
                        ...(boundBy.length > 0 ? { boundBy } : {}),
                        sourceFile: `inbox/${file}`,
                        ejsEntries,
                    }],
            };
        }
        return { kind: 'unknown' };
    }
    catch {
        return { kind: 'unknown' };
    }
}
/**
 * 预览主入口：扫 unpacked/ 产出分类清单（只读不改——不写任何文件）。
 * @param unpackedDir rp-import/<batchId>/unpacked
 * @param opts.dshHome 提供时做同名/已绑定/已有 session 匹配；缺省全部按「新」处理
 */
async function scanImportPreview(unpackedDir, opts = {}) {
    const state = opts.dshHome ? await loadExistingState(opts.dshHome).catch(() => null) : null;
    const stRoot = await findStDataRoot(unpackedDir);
    const preview = {
        kind: 'unknown', stRoot: null,
        cards: [], books: [], chats: [], presets: [], dropped: [], ejsTemplates: 0,
    };
    if (stRoot) {
        preview.kind = 'st-data';
        preview.stRoot = (0, node_path_1.relative)(unpackedDir, stRoot).replaceAll(node_path_1.sep, '/') || '.';
        preview.cards = await scanPreviewCards(stRoot, state);
        preview.books = await scanPreviewBooks(stRoot, state);
        preview.chats = await scanPreviewChats(stRoot, preview.cards, state, opts.dshHome);
        preview.presets = await scanPreviewPresets(stRoot, state);
    }
    else {
        const inbox = await scanInboxPreview(unpackedDir, state);
        preview.kind = inbox.kind;
        preview.cards = inbox.cards ?? [];
        preview.books = inbox.books ?? [];
    }
    preview.dropped = await scanDropped(unpackedDir);
    preview.ejsTemplates = preview.presets.filter(p => p.ejs).length
        + preview.books.reduce((n, b) => n + b.ejsEntries, 0)
        + preview.cards.filter(c => c.ejs).length;
    return preview;
}
// ---------------------------------------------------------------------------
// 断点续跑（checkpoint）：读写与归并（纯函数；IO 在 index.ts 路由层）
// ---------------------------------------------------------------------------
/** 迁移类目（顺序即 SKILL.md 建议处理顺序） */
exports.CHECKPOINT_STAGES = ['api', 'books', 'cards', 'chats', 'presets', 'persona', 'misc'];
/** done 列表清洗：字符串化、去空白、去重、条数/长度上限（防 agent 写爆） */
function sanitizeDoneList(raw) {
    const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const out = [];
    for (const v of arr) {
        const s = String(v ?? '').trim().slice(0, 200);
        if (s && !out.includes(s))
            out.push(s);
        if (out.length >= 500)
            break;
    }
    return out;
}
/** 解析 checkpoint.json 文本（坏 JSON/形态不对/空 stages → null） */
function parseCheckpointFile(text) {
    try {
        const root = JSON.parse(text);
        if (!root || typeof root !== 'object' || typeof root.batchId !== 'string')
            return null;
        if (!root.stages || typeof root.stages !== 'object')
            return null;
        const stages = {};
        for (const [k, v] of Object.entries(root.stages)) {
            if (!exports.CHECKPOINT_STAGES.includes(k))
                continue;
            const entry = v;
            if (!entry || typeof entry !== 'object' || !Array.isArray(entry.done))
                continue;
            stages[k] = {
                done: sanitizeDoneList(entry.done),
                updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
                // startedAt：外推剩余时间的类目起点（旧文件没有就缺省——外推层退 stagedAt）
                ...(typeof entry.startedAt === 'string' && entry.startedAt ? { startedAt: entry.startedAt } : {}),
            };
        }
        return {
            batchId: root.batchId,
            stages,
            updatedAt: typeof root.updatedAt === 'string' ? root.updatedAt : '',
        };
    }
    catch {
        return null;
    }
}
/**
 * 归并一次类目写入：覆盖该 stage 的 done，保留其他 stage（updatedAt 刷新）。
 * startedAt 首现补、续写保留——它是「该类目实际开工时刻」，剩余时间外推的类目速率
 * = done /（startedAt → updatedAt）的分母起点（§4.16.1 屏5 预估剩余）。
 */
function normalizeCheckpointWrite(batchId, existing, input) {
    const now = new Date().toISOString();
    const stages = { ...(existing?.stages ?? {}) };
    const prev = existing?.stages[input.stage];
    stages[input.stage] = {
        done: sanitizeDoneList(input.done),
        updatedAt: now,
        startedAt: prev?.startedAt || now, // 首次出现补 startedAt；续写保留首次时刻
    };
    return { batchId, stages, updatedAt: now };
}
/** checkpoint 摘要（批次列表徽章 / kickoff 续跑消息用） */
function summarizeCheckpoint(cp) {
    if (!cp)
        return { hasCheckpoint: false, stages: [], doneCount: 0, updatedAt: '' };
    const stages = exports.CHECKPOINT_STAGES.filter(s => (cp.stages[s]?.done.length ?? 0) > 0);
    const doneCount = stages.reduce((n, s) => n + (cp.stages[s]?.done.length ?? 0), 0);
    return { hasCheckpoint: doneCount > 0, stages: [...stages], doneCount, updatedAt: cp.updatedAt };
}
/** 待认领项的下一步指引文案（kind 决定话术路径：聊天→角色 tab 重新绑定；卡→角色详情看版本） */
function claimHint(kind, name) {
    if (kind === 'chat') {
        return `聊天 ${name} 导入成功但对不上角色（落在 rp/_orphan 工作区）。下一步：打开 RP 启动器「角色」tab，在正确角色下重新绑定该聊天。`;
    }
    if (kind === 'card') {
        return `角色「${name}」库内已有同名卡，zip 内为更新版本（迁移会覆盖更新）。下一步：打开 RP 启动器「角色」tab → 该角色详情查看/比对版本。`;
    }
    return `${name} 被迁移 agent 标记为待认领。下一步：查看本批次 migration-report.md 的「遗留事项 / 需要用户决策」。`;
}
/**
 * 解析一条 checkpoint done 元素。三种形态都认（agent 手写宽松对齐）：
 * 1. `claim:<类目>:<标识>` → 待认领产物（如 `claim:chats:陌路人/chat-2.jsonl`）；
 * 2. `<类目>:<标识>` / 裸`<类目>` → 显式归属该类目（agent 摘要式混写时跨桶归属）；
 * 3. 其他裸标识 → 归属写入时的 stage 桶（SKILL.md 契约的标准写法）。
 */
function parseDoneEntry(entry) {
    const isStage = (s) => exports.CHECKPOINT_STAGES.includes(s);
    if (entry.startsWith('claim:')) {
        const rest = entry.slice('claim:'.length);
        const i = rest.indexOf(':');
        const head = i === -1 ? rest : rest.slice(0, i);
        if (isStage(head))
            return { stage: head, ident: i === -1 ? '' : rest.slice(i + 1), claim: true };
        return { stage: null, ident: rest, claim: true }; // claim:<标识>（无类目前缀）→ 归属写入桶
    }
    const i = entry.indexOf(':');
    if (i > 0) {
        const head = entry.slice(0, i);
        if (isStage(head))
            return { stage: head, ident: entry.slice(i + 1), claim: false };
    }
    else if (isStage(entry)) {
        return { stage: entry, ident: '', claim: false }; // 裸类目名：agent 摘要式写法，一项 = 该类目整体
    }
    return { stage: null, ident: entry, claim: false };
}
/**
 * checkpoint.done 逐类目计数 + claim 标记收集。
 * done 元素三种形态都认（parseDoneEntry）；claim 项同样计入 done（已导入成功，只是归属不明）。
 */
function countDoneByStage(cp) {
    const counts = { api: 0, books: 0, cards: 0, chats: 0, presets: 0, persona: 0, misc: 0 };
    const claims = [];
    if (!cp)
        return { counts, claims };
    for (const stage of exports.CHECKPOINT_STAGES) {
        for (const raw of cp.stages[stage]?.done ?? []) {
            const p = parseDoneEntry(raw);
            const target = p.stage ?? stage; // 无显式类目前缀 → 归属写入时的桶
            counts[target]++;
            if (p.claim) {
                const name = p.ident || raw;
                const kind = target === 'chats' ? 'chat' : target === 'cards' ? 'card' : 'checkpoint';
                claims.push({ kind, name, detail: claimHint(kind, name) });
            }
        }
    }
    return { counts, claims };
}
/** manifest 计数 → 逐类目 total：books 按书数 / cards 按卡数 / chats 按聊天数 / presets 按预设数；
 * st-data 批次 api/persona/misc 恒计 1（settings.json 必在，三类必做）；单文件批次只涉及其一类，
 * 其余类目 total=0（UI 显示「不涉及」，不计入 overall）。 */
function progressTotalsFromManifest(manifest) {
    const zero = () => ({ api: 0, books: 0, cards: 0, chats: 0, presets: 0, persona: 0, misc: 0 });
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const kind = typeof manifest?.kind === 'string' ? manifest.kind : '';
    if (kind === 'st-data') {
        return {
            api: 1, books: num(manifest?.books), cards: num(manifest?.cards),
            chats: num(manifest?.chats), presets: num(manifest?.presets), persona: 1, misc: 1,
        };
    }
    if (kind === 'single-card')
        return { ...zero(), cards: 1 };
    if (kind === 'single-book')
        return { ...zero(), books: 1 };
    return zero();
}
/**
 * 预估剩余时间（分钟）：已完成类目实际耗时速率 × 剩余量。
 * 类目速率 = 该类目 done /（startedAt → updatedAt 的实际耗时）——startedAt 由 checkpoint
 * 写入时首现补齐（normalizeCheckpointWrite），是「该类目真实开工时刻」；旧 checkpoint 没有
 * startedAt / 数据不足退全局速率（全部 done /（stagedAt → 最新类目 updatedAt））。
 * 无 checkpoint、无有效时间戳、时钟倒挂返回 null——前端显示「—」不编数字。
 */
function estimateRemainingMinutes(totals, counts, cp, stagedAtMs) {
    if (!cp || !Number.isFinite(stagedAtMs) || stagedAtMs <= 0)
        return null;
    const ts = (s) => {
        const v = Date.parse(cp.stages[s]?.updatedAt ?? '');
        return Number.isFinite(v) ? v : NaN;
    };
    // 类目起点：首现 startedAt；旧 checkpoint 没有（或解析失败）退 meta.stagedAt
    const startTs = (s) => {
        const v = Date.parse(cp.stages[s]?.startedAt ?? '');
        return Number.isFinite(v) && v > 0 ? v : stagedAtMs;
    };
    // 全局兜底速率：全部 done 项 /（stagedAt → 最新类目 updatedAt）
    let latestMs = NaN;
    let globalDone = 0;
    for (const s of exports.CHECKPOINT_STAGES) {
        globalDone += counts[s];
        const t = ts(s);
        if (counts[s] > 0 && Number.isFinite(t) && (Number.isNaN(latestMs) || t > latestMs))
            latestMs = t;
    }
    const globalPerItem = Number.isFinite(latestMs) && latestMs > stagedAtMs ? (latestMs - stagedAtMs) / globalDone : NaN;
    if (!(globalPerItem > 0))
        return null;
    let remainingMs = 0;
    for (const s of exports.CHECKPOINT_STAGES) {
        const remaining = Math.max(0, totals[s] - counts[s]);
        if (remaining === 0)
            continue;
        // 类目速率优先（startedAt→updatedAt 的实际耗时 / 该类目 done），缺数据退全局速率
        let perItem = globalPerItem;
        const t = ts(s);
        const st = startTs(s);
        if (counts[s] > 0 && Number.isFinite(t) && t > st)
            perItem = (t - st) / counts[s];
        remainingMs += remaining * perItem;
    }
    return remainingMs > 0 ? Math.max(1, Math.round(remainingMs / 60000)) : 0;
}
/** 递归排序 key 的 JSON 序列化（内容相等判断用；数组保序）——卡版本比对与 key 顺序无关 */
function stableJson(v) {
    if (Array.isArray(v))
        return `[${v.map(stableJson).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v;
        return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}
/**
 * 库内 rp/<slug>/card.json 与 zip 内卡 JSON 归一化比对（zip 版本是否更新）。
 * 任一侧缺失/解析失败按「无法比对」返回 false——不猜（宁可漏一条待认领，不假报版本差异）。
 */
async function isZipCardNewer(dshHome, unpackedDir, card) {
    try {
        const existing = stableJson(JSON.parse(await (0, promises_1.readFile)((0, node_path_1.join)(dshHome, 'rp', card.slug, 'card.json'), 'utf8')));
        const abs = (0, node_path_1.join)(unpackedDir, card.sourceFile);
        const zipText = /\.png$/i.test(card.sourceFile)
            ? (0, character_card_ts_1.extractCardJsonFromPng)(await (0, promises_1.readFile)(abs)) ?? ''
            : await (0, promises_1.readFile)(abs, 'utf8');
        if (!zipText.trim())
            return false;
        return existing !== stableJson(JSON.parse(zipText));
    }
    catch {
        return false;
    }
}
/**
 * 预览扫描 → 待认领项（与预览屏同源判定，只收清单给文案，不做实际认领写操作）：
 * 1. chats 预览 orphan: true（三键归属对不上任何卡，迁移时进 rp/_orphan）；
 * 2. cards 已存在(同名) 且 zip 内版本有更新（与库内 card.json 归一化比对）。
 */
async function collectPreviewClaims(dshHome, unpackedDir, preview) {
    const claims = [];
    for (const ch of preview.chats) {
        if (!ch.orphan)
            continue;
        claims.push({ kind: 'chat', name: ch.name, detail: claimHint('chat', ch.name) });
    }
    if (!dshHome)
        return claims;
    // 卡 sourceFile 相对 stRoot（data/default-user 多层结构是常态）而非 unpacked 根——
    // inbox 单文件批次 stRoot=null、平铺批次 stRoot='.'，用 '.' 拼接都等价于 unpacked 本身
    const baseDir = (0, node_path_1.join)(unpackedDir, preview.stRoot || '.');
    for (const card of preview.cards) {
        if (card.target !== '已存在(同名)')
            continue;
        if (await isZipCardNewer(dshHome, baseDir, card)) {
            claims.push({ kind: 'card', name: card.name, detail: claimHint('card', card.name) });
        }
    }
    return claims;
}
/**
 * 进度汇总主入口：meta.json（manifest total + stagedAt + kickoff）× checkpoint.json
 * （逐类目 done）× 预览来源 claims → BatchProgress。纯函数（FS 读取在路由层）。
 */
function buildBatchProgress(meta, cp, extraClaims = []) {
    const manifest = (meta?.manifest && typeof meta.manifest === 'object' ? meta.manifest : null);
    const totals = progressTotalsFromManifest(manifest);
    const { counts, claims: cpClaims } = countDoneByStage(cp);
    const categories = exports.CHECKPOINT_STAGES.map(name => {
        const total = totals[name];
        const done = counts[name];
        return { name, total, done, ratio: total > 0 ? Math.min(1, done / total) : done > 0 ? 1 : 0 };
    });
    const total = categories.reduce((n, c) => n + c.total, 0);
    const done = categories.reduce((n, c) => n + c.done, 0);
    const overall = { total, done, ratio: total > 0 ? Math.min(1, done / total) : done > 0 ? 1 : 0 };
    // uncertain：批次已开工（kickoff 记录在 meta.json）且 agent 尚未回写任何 done
    const kickedOff = !!meta?.kickoff && typeof meta.kickoff === 'object'
        && typeof meta.kickoff.sessionId === 'string';
    const uncertain = kickedOff && done === 0;
    // 当前类目：适用类目（total>0 或 agent 已报 done）里第一个未完成的
    const applicable = categories.filter(c => c.total > 0 || c.done > 0);
    const firstIncomplete = applicable.find(c => c.ratio < 1);
    const stage = (total > 0 || done > 0)
        ? (firstIncomplete ? firstIncomplete.name : 'done')
        : 'pending';
    const startedAt = typeof meta?.stagedAt === 'string' ? meta.stagedAt : '';
    const stagedMs = Date.parse(startedAt);
    // claims 去重（预览来源与 agent checkpoint 标记可能撞同一项；kind+name 为键）
    const seen = new Set();
    const claims = [];
    for (const c of [...extraClaims, ...cpClaims]) {
        const key = `${c.kind}/${c.name}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        claims.push(c);
    }
    return {
        stage,
        kind: typeof manifest?.kind === 'string' ? manifest.kind : 'unknown',
        categories,
        overall,
        uncertain,
        etaMinutes: estimateRemainingMinutes(totals, counts, cp, stagedMs),
        startedAt,
        updatedAt: cp?.updatedAt || startedAt,
        claims,
    };
}
