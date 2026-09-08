"use strict";
/**
 * DSHTavern 世界书条目模型（M1 / T1.6，计划文档 §4.2 + §4.5 st-worldbook-* 知识条目）
 *
 * SillyTavern 世界书 JSON → 内部条目库的导入映射（规则层，无 LLM）。
 * 语义保持（§4.2）：constant 常驻 / 关键词触发（正则关键词、大小写、全词匹配）/
 * 递归扫描 / 深度注入 / scanDepth / token 预算。
 * P2#11 补齐（对照 dsh-worldbook worldbook.ts/tools/index.ts，MIT）：
 * timed effects（sticky/cooldown/delay，消费侧见 trigger.ts）/ inclusion group（组互斥）。
 * 明确弃用（导入时记录 warning）：概率触发。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WI_POSITION = void 0;
exports.importLoreBook = importLoreBook;
/** 条目注入位置（对齐 ST world_info_position） */
exports.WI_POSITION = {
    BEFORE: 0,
    AFTER: 1,
    AN_TOP: 2,
    AN_BOTTOM: 3,
    AT_DEPTH: 4,
    EM_TOP: 5,
    EM_BOTTOM: 6,
    OUTLET: 7,
};
// ST entry 字段名兼容读取（新旧两代字段名都认）
function pick(entry, keys, fallback) {
    for (const k of keys) {
        if (entry[k] !== undefined && entry[k] !== null)
            return entry[k];
    }
    return fallback;
}
/** ST 世界书 JSON → LoreBook（st-worldbook-knowledge 知识条目规则层） */
function importLoreBook(name, raw) {
    const warnings = [];
    const obj = (raw ?? {});
    // ST 两种形态：{ entries: { "0": {...} } }（对象索引）或数组
    const rawEntries = Array.isArray(obj.entries)
        ? obj.entries
        : obj.entries && typeof obj.entries === 'object'
            ? Object.values(obj.entries)
            : [];
    const entries = rawEntries.map((e, i) => {
        const r = (e ?? {});
        // 弃用特性检测（§4.2：导入时明示；P2#11 后 timed effects / inclusion group 已支持，仅剩概率弃用）
        if (pick(r, ['probability'], 100) !== 100 && pick(r, ['probability'], 100) > 0)
            warnings.push(`#${i}「${String(r.comment ?? '')}」概率触发已弃用（按 100% 处理）`);
        const content = pick(r, ['content'], '');
        // key（旧版单数字符串）/ keys（新版数组）都认——pick 按序取第一个，字符串要包成数组
        const rawKeys = pick(r, ['key', 'keys'], []);
        const keys = (Array.isArray(rawKeys) ? rawKeys : [rawKeys]).map(String).filter(k => k !== '');
        const rawSecondary = pick(r, ['keysecondary', 'secondaryKeys'], []);
        const secondary = (Array.isArray(rawSecondary) ? rawSecondary : [rawSecondary]).map(String).filter(k => k !== '');
        return {
            id: `lore-${name}-${i}`,
            comment: pick(r, ['comment', 'name'], `条目 ${i}`),
            content,
            keys: keys.map(String).filter(k => k !== ''),
            secondaryKeys: secondary.map(String).filter(k => k !== ''),
            selectiveLogic: pick(r, ['selectiveLogic'], 0),
            constant: pick(r, ['constant'], false),
            selective: pick(r, ['selective'], false),
            position: pick(r, ['position', 'world_info_position'], exports.WI_POSITION.BEFORE),
            depth: pick(r, ['depth', 'world_info_depth'], 4),
            role: pick(r, ['role', 'world_info_role'], 'system'),
            scanDepth: r.scanDepth != null ? Number(r.scanDepth) : null,
            preventRecursion: pick(r, ['preventRecursion'], false),
            excludeRecursion: pick(r, ['excludeRecursion'], false),
            insertionOrder: pick(r, ['order', 'insertion_order'], 100),
            sticky: pick(r, ['sticky'], 0),
            cooldown: pick(r, ['cooldown'], 0),
            delay: pick(r, ['delay'], 0),
            group: pick(r, ['group'], ''),
            groupOverride: pick(r, ['groupOverride'], false),
            enabled: pick(r, ['disable', 'disabled'], false) === false,
            book: name,
        };
    });
    return { name, entries, importWarnings: [...new Set(warnings)] };
}
