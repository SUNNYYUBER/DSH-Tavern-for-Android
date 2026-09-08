/**
 * PROJECT_PLAN 补全：世界书条目管理面板（RpLorePanel）的纯逻辑。
 *
 * 条目为 ST World Info 形状（/dsht-tavern-helper/worldbook/get 产出，见
 * dsht-plugin-tavern-helper/facade.ts loreEntryToSt）：
 * {uid, comment, content, key[], keysecondary[], constant, selective, disabled, ...}。
 * 抽成无依赖纯函数便于 vitest 单测（搜索过滤 / keys 归一 / 启停语义）。
 */
/** ST World Info 条目的最小消费面（其余高级字段 entry-put 原样回传保留） */
export interface LoreEntryLike {
    uid: number;
    comment: string;
    content: string;
    key?: string[] | string;
    keysecondary?: string[] | string;
    disabled?: boolean;
    [extra: string]: unknown;
}
/** keys 归一：ST 允许数组或逗号串（中英文逗号都认）——统一为去空白非空字符串数组 */
export declare function entryKeys(v: unknown): string[];
/** keys 数组 → 编辑框可读串（逗号分隔；entryKeys 的逆操作展示面） */
export declare function keysToText(v: unknown): string;
/** 条目是否启用（ST 语义：disabled !== true 即启用） */
export declare function entryEnabled(entry: LoreEntryLike): boolean;
/**
 * 条目过滤（搜索框）：comment / content / 主键+次键 任一命中即保留，
 * 大小写不敏感；query 去空白后为空 → 原样返回（浅拷贝，不动入参）。
 */
export declare function filterLoreEntries(entries: readonly LoreEntryLike[], query: string): LoreEntryLike[];
