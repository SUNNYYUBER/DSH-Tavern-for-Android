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
/** 条目注入位置（对齐 ST world_info_position） */
export declare const WI_POSITION: {
    readonly BEFORE: 0;
    readonly AFTER: 1;
    readonly AN_TOP: 2;
    readonly AN_BOTTOM: 3;
    readonly AT_DEPTH: 4;
    readonly EM_TOP: 5;
    readonly EM_BOTTOM: 6;
    readonly OUTLET: 7;
};
/** 深度注入的角色 */
export type WIRole = 'system' | 'user' | 'assistant';
/** 内部世界书条目（ST 字段语义保留，字段名转我们的形态） */
export interface LoreEntry {
    id: string;
    /** 条目名（ST comment） */
    comment: string;
    content: string;
    /** 关键词列表（可为 /regex/ 形式） */
    keys: string[];
    secondaryKeys: string[];
    /** 副关键词逻辑：0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL */
    selectiveLogic: number;
    /** 常驻条目（蓝灯）：无条件激活 */
    constant: boolean;
    /** 触发时激活（绿灯互斥组） */
    selective: boolean;
    /** 注入位置 */
    position: number;
    /** 深度注入的 depth */
    depth: number;
    /** 深度注入的 role */
    role: WIRole;
    /** 条目级扫描深度覆盖 */
    scanDepth: number | null;
    /** 递归控制 */
    preventRecursion: boolean;
    excludeRecursion: boolean;
    /** 插入顺序（同位置内排序，大者优先——ST 语义） */
    insertionOrder: number;
    /** 粘性：命中后持续 N 条消息强制注入（以可见消息游标计，0=关闭） */
    sticky: number;
    /** 冷却：命中后 N 条消息内不再触发（sticky 生效优先于 cooldown，0=关闭） */
    cooldown: number;
    /** 延迟：可见消息游标 < delay 时不触发（ST 语义：聊天长度不足前 N 条不触发，0=关闭） */
    delay: number;
    /**  inclusion group：同组（逗号分隔多组）只保留 insertionOrder 最高的一条 */
    group: string;
    /** 组内强制覆盖（true=不参与组互斥，命中即注入） */
    groupOverride: boolean;
    /** 启用 */
    enabled: boolean;
    /** 归属：书名（scope 由库层管理：global / bound:<角色> / session 书单） */
    book: string;
}
/** 一本世界书（ST world JSON 导入形态） */
export interface LoreBook {
    name: string;
    entries: LoreEntry[];
    /** 导入时发现但弃用的特性（diff 报告用） */
    importWarnings: string[];
}
/** ST 世界书 JSON → LoreBook（st-worldbook-knowledge 知识条目规则层） */
export declare function importLoreBook(name: string, raw: unknown): LoreBook;
