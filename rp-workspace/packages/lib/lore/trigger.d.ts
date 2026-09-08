/**
 * DSHTavern 世界书触发引擎（M1 / T1.7，计划文档 §4.2 被动检索）
 *
 * SillyTavern checkWorldInfo 语义核心子集（§4.2 明确保留的部分）：
 * constant 常驻 / 关键词触发（正则关键词、大小写、全词匹配）/ 副关键词逻辑 /
 * 递归扫描（已激活条目内容作为下一轮扫描文本，最多 5 层）/ scanDepth 窗口 / token 预算。
 * P2#11 已落地（对照 dsh-worldbook src/context/worldbook.ts bookCandidates/dedupeGroups，MIT）：
 * timed effects（sticky/cooldown/delay，以可见消息游标计）/ inclusion group 组互斥（dedupeGroups）。
 * delay 语义注意：本引擎按 entry.ts 契约取「游标 < delay 不触发」（ST 聊天长度不足前 N 条不触发）；
 * dsh-worldbook 同名字段是「游标 < delay 强制注入」，两者语义相反，勿混抄。
 * 递归语义已与 dsh-worldbook bookCandidates L94 对齐确认：
 * preventRecursion=命中但内容不进递归 buffer；excludeRecursion=递归轮跳过该条目（既有实现，未改）。
 * @D 深度（position=4）由调用侧 spliceDepthInjections 实现（dsh-plugin/index.ts，
 * 深者先插语义同 dsh-worldbook inject.ts L56-77），不在本引擎。
 * AI 自写守卫（dsh-worldbook tools/index.ts 三层守卫 devGuard/scopeGuard/syncDevTool）：
 * 本仓库无 AI 侧世界书写入工具，无攻击面，不适用；未来若引入写工具需整套照抄三层守卫。
 * 已弃用（不在本引擎）：概率触发。
 *
 * P0-5：visibleMessageCursor 时间游标照抄 dsh-worldbook src/context/inject.ts 的
 * visibleMessageCursor（MIT © aam452，见 REF_PROJECTS_COMPARISON.md 领域六与致谢表）。
 */
import type { LoreEntry } from './entry.ts';
/**
 * 模型可见真实消息游标（dsh-worldbook inject.ts L99-107 同款语义）：只累计事件流里
 * 真实的 user（source.kind==='user'，排除插件注入/快照）与 assistant 消息——对齐
 * ST chat.length 的时间轴语义。decision.messages 是 inbox 取出批（长度不变），
 * 不能作时间游标；正确来源是会话事件流。游标值由 dsh-plugin pre-step 写进
 * rp/state/<sid>.json 的 cursor 键（供未来 sticky/cooldown/delay 等跨轮语义消费）。
 */
export declare function visibleMessageCursor(events: Array<{
    type: string;
    data?: unknown;
}>): number;
/**
 * 跨轮 timed effect 区间（dsh-worldbook data/worldbook.ts TimedEffect 同款，MIT）：
 * 以「模型可见消息数」（visibleMessageCursor）为时间游标，[start, end) 生效。
 * 由调用方持久化（dsh-plugin 存 rp/state/<sid>.json 的 loreTimed 键）。
 */
export interface TimedEffect {
    entryId: string;
    type: 'sticky' | 'cooldown';
    start: number;
    end: number;
}
/** 条目某类 timed effect 在游标处是否生效 */
export declare function isTimedActive(effects: TimedEffect[], entryId: string, type: TimedEffect['type'], cursor: number): boolean;
/** 触发引擎配置（ST world_info_settings 对应物，导入映射源） */
export interface TriggerConfig {
    /** 扫描最近 N 条消息（全局默认；条目可覆盖） */
    scanDepth: number;
    /** 递归最大轮数（ST/dsh-worldbook MAX_RECURSION=5） */
    maxRecursionSteps: number;
    /** 关键词大小写敏感 */
    caseSensitive: boolean;
    /** 全词匹配 */
    matchWholeWords: boolean;
    /** token 预算（百分比 0-100，乘以上下文上限） */
    budgetPercent: number;
    /** 预算封顶（token 数；0=不封顶） */
    budgetCap: number;
    /** 上下文总 token 上限（预算计算基数） */
    contextTokenLimit: number;
    /** 可见消息游标（sticky/cooldown/delay 的时间轴；缺省 0=不计时，timed effects 全部不生效） */
    cursor: number;
    /** 调用方持久化的跨轮 timed effects（本轮判定基准；本轮新写入的会合入结果返回） */
    timedEffects: TimedEffect[];
}
export declare const DEFAULT_TRIGGER_CONFIG: TriggerConfig;
/** 触发结果条目（含触发原因，trace 消费） */
export interface ActivatedEntry {
    entry: LoreEntry;
    /** 激活来源：constant / primary(主关键词) / secondary / recursion / sticky（粘性期内强制） */
    reason: 'constant' | 'primary' | 'secondary' | 'recursion' | 'sticky';
}
export interface TriggerResult {
    activated: ActivatedEntry[];
    /** 扫描轮次记录（递归可视化） */
    recursionRounds: number;
    /** 触发 trace：每轮哪些条目被什么关键词击中 */
    trace: Array<{
        round: number;
        entryId: string;
        key: string;
    }>;
    /** 估算 token 用量（字符数/4 近似） */
    estimatedTokens: number;
    /** 预算内未能注入的条目（超预算裁剪） */
    budgetDropped: LoreEntry[];
    /** 合并后的跨轮 timed effects（过期已清理 + 本轮新写入；调用方原样持久化，下轮回传） */
    timedEffects: TimedEffect[];
}
/** 组装扫描文本：最近 scanDepth 条消息（倒序拼接，ST 同语义） */
export declare function buildScanText(messages: string[], scanDepth: number, entryOverride?: number | null): string;
/**
 * 世界书触发扫描（每轮组装必跑，纯代码零 token）。
 *
 * @param entries 候选条目（scope 收集后的：全局 + 角色 bound + session 书单，§4.14）
 * @param recentMessages 最近消息文本数组（旧→新）
 * @param config 触发配置
 */
export declare function triggerWorldInfo(entries: LoreEntry[], recentMessages: string[], config?: Partial<TriggerConfig>): TriggerResult;
