/**
 * PROJECT_PLAN 补全：世界书条目管理面板（RpLorePanel）的纯逻辑。
 *
 * 条目为 ST World Info 形状（/dsht-tavern-helper/worldbook/get 产出，见
 * dsht-plugin-tavern-helper/facade.ts loreEntryToSt）：
 * {uid, comment, content, key[], keysecondary[], constant, selective, disabled, ...}。
 * 抽成无依赖纯函数便于 vitest 单测（搜索过滤 / keys 归一 / 启停语义）。
 */
/** keys 归一：ST 允许数组或逗号串（中英文逗号都认）——统一为去空白非空字符串数组 */
export function entryKeys(v) {
    if (Array.isArray(v))
        return v.map(k => String(k ?? '').trim()).filter(k => k !== '');
    if (typeof v === 'string')
        return v.split(/[,，]/).map(k => k.trim()).filter(k => k !== '');
    return [];
}
/** keys 数组 → 编辑框可读串（逗号分隔；entryKeys 的逆操作展示面） */
export function keysToText(v) {
    return entryKeys(v).join(', ');
}
/** 条目是否启用（ST 语义：disabled !== true 即启用） */
export function entryEnabled(entry) {
    return entry.disabled !== true;
}
/**
 * 条目过滤（搜索框）：comment / content / 主键+次键 任一命中即保留，
 * 大小写不敏感；query 去空白后为空 → 原样返回（浅拷贝，不动入参）。
 */
export function filterLoreEntries(entries, query) {
    const q = query.trim().toLowerCase();
    if (q === '')
        return [...entries];
    return entries.filter(e => [
        String(e.comment ?? ''),
        String(e.content ?? ''),
        ...entryKeys(e.key),
        ...entryKeys(e.keysecondary),
    ].join('\n').toLowerCase().includes(q));
}
