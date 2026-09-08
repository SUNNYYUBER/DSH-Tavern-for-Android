/**
 * DSHTavern 剧情记忆插件（Cordis 插件，挂 DSH web profile 全局层）——楼层总结记忆。
 *
 * vector-enhanced 楼层总结机制的独立插件化（用户拍板 2026-09-02，与
 * dsht-plugin-mvu / dsht-plugin-tavern-helper / dsht-plugin-prompt-template 并列，
 * 设置进 DSH 自带 设置→插件「可配置」tab）。与 dsh-plugin 内置的 memory_save/
 * memory_query 工具（模型主动存事实，规则层）互补：本插件**自动、周期性**地
 * 把剧情原文浓缩成 markdown 摘要。
 *
 * 数据流：
 * 1. dsh-plugin 每轮 pre-step 把可见消息计数写进 rp/state/<sid>.json 的 cursor 键
 *    （visibleMessageCursor 口径：真实 user/assistant 消息，快照/插件注入不算）。
 * 2. 本插件轮询（20s）对比进度 rp/memory-progress/<sid>.json 的 lastFloor——
 *    跨过 N 楼触发总结。
 * 3. 总结：读 session.jsonl 提取 (lastFloor, cursor] 楼层原文 → ctx.llm.stream
 *    （agentDefaultModel 当前选择，与 /llm/classify 同通道）→ markdown 摘要。
 * 4. 落盘：$DSH_HOME/skills/wb-memory-<slug>/references/lore.json（角色工作区专属
 *    记忆本，constant 常驻条目，comment = 记忆#<起>-<止> 幂等锚）；并把该书登记进
 *    工作区 rp.json.books（缺失时补）。
 * 5. 注入：自有 pre-step 钩子每轮注入独立快照消息（constant 条目进触发引擎会被
 *    budgetCap 挤掉——独立注入与世界书预算解耦）。注入按核心契约持久化进 surface，
 *    下一轮请求由 surface 重组时自动带上。
 * 6. 上下文瘦身（§2.2）：注入快照按契约每轮持久化 → surface 每轮膨胀 ~20 万字符，
 *    请求从 surface 重组时全量带上（实测 114 楼会话单请求 770k/873k tokens，上游
 *    必炸）。本插件用官方 replace 原语（surfaceOp: {op:'replace'}，compaction 同款）
 *    把「记忆本已覆盖的老历史前缀 + 陈旧快照副本」折叠出模型视图——**日志保留全部
 *    数据**（聊天记录零丢失），只是请求不再投影它们。触发阈值：视图 est > 80k
 *    tokens（est = 字符 × 0.31，DeepSeek 中文口径实测校准）。
 * 7. 回退安全：cursor < lastFloor（会话回退）→ 删除覆盖区间的记忆条目 + lastFloor
 *    回退到幸存区间尾；进度与记忆本永远一致。
 * 8. 展开回显（§2.3 ⑤/④，2026-09-03）：折叠只改模型视图、日志与界面回看零丢失——
 *    把折叠区间的原文「临时还给 AI」：
 *    - 单次（⑤）：UI「展开给 AI」→ POST /dsht-memory/expand 落待办文件 → 下一轮
 *      pre-step 从会话事件流提取区间原文 → 宏中性化 + 按近窗字符预算截尾 → one-shot
 *      快照注入（source.oneshot=true，影子化无条件收回——单次生效）；
 *    - 窗口（④）：AI 可见楼层数调大后，期望窗口 [cursor-M+1, foldedUpTo] 露出的折叠
 *      原文以稳定签名快照注回（source.windowRange 记录实际覆盖；预算所限 capped 时
 *      视为已满足——重注入同一段无意义），常驻到窗口收缩/再扩张事件。
 *
 * 路由前缀 /dsht-memory（health / settings / status / summarize / reset）。
 * 设置：settings 命名空间 dsht-plugin-memory（真实 Schema：总开关 / 每 N 楼 /
 * 保留近 M 楼原文 / 近窗字符预算 / 折叠老楼层）。
 */
import { type LoreEntry } from '../lore/entry.ts';
import { type LikePluginContext } from '../dsht-plugin-shared/http.ts';
export declare const name = "dsht-plugin-memory";
export declare const inject: string[];
interface LikeSettingsSvc {
    register?: (ns: string, schema: unknown, options?: {
        base?: unknown;
    }) => unknown;
    update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown>;
    get?: (ns: string) => unknown;
}
interface LikeLlm {
    stream: (req: {
        provider: string;
        model: string;
        system?: string;
        messages: Array<{
            role: string;
            content: Array<{
                type: string;
                text: string;
            }>;
        }>;
    }) => AsyncIterable<{
        type: string;
        text?: string;
    }>;
}
interface LikeAgentDefaultModel {
    currentSelection?: () => {
        provider?: string;
        model?: string;
    } | null;
}
interface Ctx extends LikePluginContext {
    settings?: LikeSettingsSvc;
    llm?: LikeLlm;
    agentDefaultModel?: LikeAgentDefaultModel;
    on?: (event: string, handler: (raw: unknown, next: () => Promise<unknown>) => Promise<unknown>) => unknown;
}
export interface MemoryConfig {
    enabled: boolean;
    everyN: number;
    keepNearFloors: number;
    charBudget: number;
    foldOldFloors: boolean;
    summaryMaxChars: number;
}
export declare const CONFIG_NS = "dsht-plugin-memory";
/** Schema 值（中文键）→ 内部字段映射 */
export declare function configFromSchemaValue(v: unknown): MemoryConfig;
/** 读生效配置（settings 服务缺席/坏值 → 默认值；schema 调用补默认并校验） */
export declare function readConfig(raw: unknown): MemoryConfig;
export interface SessionEventLike {
    type?: unknown;
    seq?: unknown;
    data?: unknown;
}
export interface FloorText {
    floor: number;
    role: 'user' | 'assistant';
    text: string;
}
/**
 * 从 session.jsonl 事件流提取楼层文本（纯函数）。
 * 楼层口径 = 用户口径（2026-09-04 拍板）：**一轮用户输入 = 1 楼，一轮 AI 回答
 * （同 turn 的全部思考/工具 step）= 1 楼**——与 UI 楼层徽章（RpNativeChat
 * floorIndexOf）同口径；与世界书 visibleMessageCursor（消息条数技术游标）解耦。
 * - user/message 仅当 data.source.kind === 'user'（快照/插件注入不算）计 1 楼；
 * - assistant/message 按 data.turn（迁移格式 data.message.turn）分组：同 turn 的
 *   后续消息并入当前楼（文本 '\n\n' 拼接）；turn 缺失时每条计 1 楼（旧口径退化）。
 * 楼层从 1 起。返回全量楼层文本 + 楼层总数 cursor（turn 口径，作为总结进度游标）。
 */
export declare function extractFloorsFromEvents(events: SessionEventLike[]): {
    floors: FloorText[];
    cursor: number;
};
/** 下一个待总结区间：跨过 N 楼才触发；单次只吐一个 N 楼块（长跨度分多轮消化） */
export declare function nextChunk(lastFloor: number, cursor: number, everyN: number): {
    from: number;
    to: number;
} | null;
/** comment = 记忆#<起>-<止> → 楼层区间（非记忆条目/格式不符返回 null） */
export declare function parseMemoryRange(comment: string): {
    start: number;
    end: number;
} | null;
/** pre-step decision.messages 里只有 claimed 新消息 + 钩子注入（核心契约：
 * agent-loop preStep 的 messages = inbox.claim() 结果，历史在 systemPrompt.assemble
 * 的 assembly 里从 surface 重组）——所以**批次级折叠够不到请求的大头**（turn 44
 * 873k tokens 实证）。真正的瘦身对象是 surface：注入快照按契约每轮持久化进
 * surface（每轮 +20 万字符），请求从 surface 重组时全量带上。
 * 影子化 = session.append('user/message', marker, { surfaceOp: { op: 'replace',
 * start, end } })——官方原语（types.d.ts："any surface-replacing producer may
 * use it"，compaction 同款）：被影子化的事件**留在日志里**（聊天数据零丢失），
 * 只是模型视图不再投影它们。 */
/** surface 节点信息（钩子从 session.surface.nodes + session.events[seq] 派生） */
export interface SurfaceNodeInfo {
    seq: number;
    /** 真实楼层消息：assistant 或 source.kind==='user' 的 user（口径 = turn 楼层） */
    isFloor: boolean;
    /** assistant 消息的 turn 号（同 turn 连续 assistant 合并为一楼；user/未知 = null） */
    turn: number | null;
    /** 插件注入快照：source.form==='snapshot'（每轮重注的持久化副本） */
    isSnapshot: boolean;
    /** 快照签名（plugin + sections 名单）——同签名只留最新一份 */
    sig: string;
    /** 消息 text 块总字数 */
    chars: number;
}
export interface ShadowOp {
    start: number;
    end: number;
    /** history = 老楼层前缀（大段剧情，已由记忆本承载）；snapshot = 陈旧快照副本（纯冗余） */
    kind: 'history' | 'snapshot';
}
export interface ShadowPlan {
    ops: ShadowOp[];
    /** 影子化前后的模型视图字数（不含本轮新注入） */
    charsBefore: number;
    charsAfter: number;
    /** 影子化的楼层区间（绝对楼层号，用于日志） */
    flooredUpTo: number;
}
/**
 * 影子化规划（纯函数）：
 * 1) 老历史前缀——从末尾数楼层，保留 min(近 M 楼, 字符预算) 的窗口，窗口之前的全部
 *    节点（含夹在其中的旧快照）合成**一个** replace op（marker = 一条说明消息）。
 *    零信息丢失：只折叠记忆本已覆盖的楼层（boundary = min(记忆覆盖, 已保留窗口起点)），
 *    记忆滞后时窗口自动收缩。
 * 2) 陈旧快照去重——每个签名只保留最后一份副本：**本轮新注入的副本视为最新**（签名
 *    命中 freshSigs 的 surface 副本全部影子化——应用重启后 retained 表清空会全量重注，
 *    不豁免 surface 旧副本就会双份进请求），否则保留视图里最后一份（retained 跳过依赖
 *    它承载内容）；其余副本影子化，同 turn 的连续副本合并成一个 op。
 *    前一轮的影子 marker 落在本轮 prefix 区间内时随前缀一并折叠（自清洁）。
 */
export declare function planShadowOps(nodes: SurfaceNodeInfo[], opts: {
    keepNearFloors: number;
    charBudget: number;
    memoryMaxFloor: number;
    foldFloors: boolean;
    cursor: number;
    freshSigs?: ReadonlySet<string>;
    windowKeepSeq?: number | null;
}): ShadowPlan;
/** 记忆条目工厂（constant 常驻——注入复用 dsh-plugin pre-step 的触发引擎） */
export declare function buildMemoryEntry(bookName: string, from: number, to: number, summary: string): LoreEntry;
/**
 * 回退裁剪（纯函数）：楼层回退到 cursor 后，覆盖区间超出 cursor 的记忆条目作废；
 * lastFloor = 幸存条目的最大区间尾（无幸存 → 0）。进度与记忆本由此保持一致。
 */
export declare function rollbackMemoryBook(entries: LoreEntry[], cursor: number): {
    entries: LoreEntry[];
    lastFloor: number;
    dropped: number;
};
/** 总结 prompt（纯函数）：system 定输出协议，user 带楼层原文。
 *  summaryMaxChars = 用户可自定义的摘要字数上限（软指令——写进 prompt 供模型参考，
 *  不做硬截断；DSH 原生压缩同样无字数强制，口径一致）。 */
export declare function buildSummarizePrompt(from: number, to: number, floors: FloorText[], summaryMaxChars?: number): {
    system: string;
    user: string;
};
/** 残留 ASCII 宏中性化（dsh-plugin neutralizeResidualMacros 同款）：插值器连
 *  source.sections[].text 一起扫，楼层原文可能含 {{...}}（ST 脚本输出）——不中性化
 *  会炸 turn（"malformed prompt variable reference"）。 */
export declare function neutralizeMacros(text: string): string;
/** 期望注回窗口：AI 可见楼层数 M 下，折叠边界 foldedUpTo 之内露出的区间
 *  [max(1, cursor-M+1), foldedUpTo]；无需注回（无折叠 / 窗口未触及折叠边界）→ null */
export declare function desiredWindow(cursor: number, keepNearFloors: number, foldedUpTo: number): {
    from: number;
    to: number;
} | null;
/** 展开快照文本（纯函数）：区间楼层从尾部（最近）往回装配，超预算整楼丢弃
 *  （至少保留一楼）；effectiveFrom > from 即预算截尾（capped）。宏中性化。 */
export declare function buildExpandSnapshot(kind: 'oneshot' | 'window', from: number, to: number, floors: readonly FloorText[], budget: number): {
    text: string;
    effectiveFrom: number;
    effectiveTo: number;
    capped: boolean;
} | null;
/** 历史折叠 marker 文本 → 折叠边界（旧会话无持久化 fold 态时的回退解析） */
export declare function parseFoldedFromMarker(text: string): number;
/** 窗口副本覆盖判定：尾部对齐 + 头部覆盖；预算截尾副本（capped）在预算未再放大时
 *  视为已满足——同一段 capped 文本重注入无意义 */
export declare function rangeCovers(copy: {
    from: number;
    to: number;
    capped?: boolean;
    budget?: number;
}, want: {
    from: number;
    to: number;
}, budget: number): boolean;
export declare function apply(ctx: Ctx, _config: unknown): void;
export {};
