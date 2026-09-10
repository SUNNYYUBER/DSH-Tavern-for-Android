/**
 * session-write.ts — DSH 会话写入的「合法形态」共享层
 * ============================================================
 * 为什么需要这一层（2026-09-10 阶段 3 实证，80 个真实会话跑官方 v0→v3 迁移链）：
 *
 *   41 / 80 会话无法迁移打开。根因**全部**是我方写入的事件不合官方 released-v0 契约。
 *   更深一层：0.1.5 引入了两处**破坏性契约收紧**，正命中我方核心写入路径。
 *
 * ## 收紧 1 —— surfaceOp 字段名 start/end → startSeq/endSeq
 *   0.1.2（dsh-session/lib/types/surface.js:117 `isReplaceOp`）要求 exactly {op,start,end}
 *   0.1.5（同文件:165）要求 exactly {op,startSeq,endSeq}
 *   我方全部 replace 写入用 start/end → 0.1.5 上**每一次回退/编辑/变体切换都会抛**
 *   `carries an invalid replace surfaceOp`。
 *
 * ## 收紧 2 —— assistant/message 禁止做表面替换节点
 *   0.1.5 `assertProvenance`（surface.js:205）：
 *     `assistant/message embeds its source stream and cannot carry sourceEventSeqs`
 *   而同函数同时要求「replace 必须列全被遮蔽节点」，于是 assistant 做 replace 时
 *   **带 ses 报错、不带也报错**（missing N）——官方设计死锁，不是可绕过的校验顺序。
 *   0.1.2 无此限制（0.1.2 surface.js:161 明确写 `except on assistant/message`）。
 *   官方同时要求 assistant/message 必须落在打开的 step 内（invariant.js:56），
 *   所以「改写一条已关闭 turn 里的历史助手回复」在原语层面本就不可表达。
 *
 * ## 官方能力边界（已全库核实）
 *   · 官方**没有**「消息变体 / swipe / 多候选回复」概念
 *   · 官方**没有**「修改历史消息」RPC；唯一近似是 session.fork（新会话）
 *   · 官方合法的 replace 组合只有三种：tool/result（仅 content 单节点）、
 *     system/message（仅 system 节点）、user/message（compaction 摘要带）
 *
 * ## 本模块的合法载体（官方 compaction 同款形态）
 *   变体切换 / 助手楼层改写 / EJS 写回 —— 统一走
 *   「user/message 标记把旧内容移出上下文 + 新内容合法追加到新 step」。
 *
 * ## 元数据放哪
 *   实验证明自定义事件类型（`dsht/rollback` 等）在 v0 阶段就被迁移器拒绝
 *   （`format v0 contains unknown historical event type`，即使 ignorable:true）。
 *   故扩展元数据只能放进**已知事件的合法字段**：
 *   · `source.form` 枚举 instructions/catalog/snapshot/notice/relay/recall
 *   · `source.sections` 仅 form:'snapshot' 合法，元素 exactly {name,text}
 *   · `source.summary` 仅 form:'notice' 合法
 *   · `content` 文本本身
 *   本模块统一用 `snapshot` 形态承载结构化标记（sections[0].name = 标记键，
 *   sections[0].text = JSON 载荷），人类可读文案放 content。
 *
 * @module dsht-plugin-shared/session-write
 */
/** 一次 append 的最小会话接口（结构化，避免依赖官方类型） */
export interface AppendableSession {
    append: (type: string, data: unknown, opts?: {
        surfaceOp?: unknown;
        sourceEventSeqs?: number[];
    }) => unknown;
    readonly surface?: {
        nodes?: number[];
    };
    readonly seq?: number;
    readonly lastSeq?: number;
}
/** replace 目标区间 */
export interface ReplaceRange {
    start: number;
    end: number;
}
/** 从 surfaceOp 里读区间（兼容两代字段名） */
export declare function replaceRange(op: unknown): ReplaceRange | null;
/** 是否为一个 replace surfaceOp（兼容两代字段名） */
export declare function isReplaceOp(op: unknown): boolean;
/**
 * 版本自适应的 surface replace 写入。
 *
 * 为什么用 try/catch 而不是探测模块：
 *   esbuild 打包后 `require('@deepseek-ai/dsh-session/surface')` 不可靠（ESM 产物），
 *   而官方 `append` 的校验发生在 **写入日志之前**（dsh-session/lib/index.js:1189-1200：
 *   `validateSurfaceEventData` → `surfaceManager.validateNext` → 才 `log.push`），
 *   所以一次被拒的 append **无副作用**，可以安全地「先试新字段名，被拒再退回旧字段名」。
 *   首次成功即缓存代次，后续零开销。
 */
export declare function appendReplace(session: AppendableSession, type: string, data: unknown, range: ReplaceRange, sourceEventSeqs: number[]): unknown;
/** 供测试重置缓存 */
export declare function __resetSurfaceOpStyleForTest(): void;
/**
 * 助手楼层改写的落点规划（纯函数）：决定新 assistant/message 落在哪个 turn/step。
 *
 * 0.1.5 起 assistant/message 只能 append 且必须落在**打开的 step** 内
 * （dsh-session/lib/invariant.js:56 `requireOpenStep`），所以任何「改写助手楼层」
 * 都必须开/续一个 step：
 *   · idle → 开新 turn（turn+1 / step 1）
 *   · busy → 并入当前 open turn 的下一个 step（不越界开新 turn，同 chat/append 语义）
 */
export declare function planAssistantRewrite(events: readonly {
    type?: unknown;
    data?: {
        turn?: unknown;
    };
}[], idle: boolean): {
    turn: number;
    step: number;
    openTurn: boolean;
};
/**
 * 合法 plugin source 的形态（官方 `pluginSourceValue` 白名单）：
 *   { kind:'plugin', plugin:string, form?, sections?, summary? }
 * 其它任何键（rolledBackTo / regeneratedFrom / editedFrom / thData / oneshot…）
 * 都会被 v0→v1 迁移器判 `source has unexpected member "X"`，整会话打不开。
 */
export interface MarkerSource {
    kind: 'plugin';
    plugin: string;
    form: 'snapshot';
    sections: Array<{
        name: string;
        text: string;
    }>;
}
/**
 * 构造承载结构化标记的合法 plugin source。
 *
 * 用 `form:'snapshot'` + `sections`——官方白名单里唯一能携带任意结构化文本的形态，
 * 语义上也贴合（「一段由插件注入的上下文快照段落」）。
 */
export declare function markerSource(plugin: string, kind: string, payload: Record<string, unknown>): MarkerSource;
/**
 * 从事件 source 里解出结构化标记（读侧）。非法/缺失返回 null。
 */
export declare function readMarker<T = Record<string, unknown>>(source: unknown, kind: string): T | null;
/**
 * 读存量（0.1.2 时代）写在 source 顶层的标记键。
 * 老会话里 `source.rolledBackTo` / `source.regeneratedFrom` / `source.editedFrom`
 * 就是这些值，迁移/修复前必须先读出来（否则整会话打不开）。
 */
export interface LegacySourceKeys {
    rolledBackTo?: number;
    regeneratedFrom?: number;
    editedFrom?: number;
    thSystem?: true;
    thData?: unknown;
}
export declare function readLegacySourceKeys(source: unknown): LegacySourceKeys;
/**
 * 读历史标记锚点（新形态 + 存量形态统一读法）。
 * 返回「需要隐藏到哪一 seq」的锚点与标记自身 seq（UI 掩码用）。
 */
export declare function readSurgicalAnchor(ev: {
    seq?: unknown;
    type?: unknown;
    data?: unknown;
}): {
    anchor: number | null;
};
/**
 * 事件信封允许的键（官方白名单，dsh-session/lib/index.js `assertSessionEventEnvelope`）：
 *   type / seq / time / data / surfaceOp / sourceEventSeqs / ignorable
 * **没有 `source`**。0.1.2 时代我方在 turn/end 信封上写过 source（seqRepair 标记），
 * 0.1.5 加载即 `has unexpected field source`。
 */
export declare const ENVELOPE_KEYS: readonly ["type", "seq", "time", "data", "surfaceOp", "sourceEventSeqs", "ignorable"];
/** 剥掉信封上的非法键（返回新对象，不改原值） */
export declare function sanitizeEnvelope<T extends Record<string, unknown>>(event: T): T;
/**
 * 手术类标记（回退/编辑/重生成）的载荷形状（写进 sections[0].text 的 JSON）。
 * 字段名与存量兼容，便于读侧统一。
 */
export interface SurgicalMarkerPayload {
    /** 回退：该 seq 及其后的内容已移出模型上下文 */
    rolledBackTo?: number;
    /** 重生成：该用户消息的回复已移出，正在重生成 */
    regeneratedFrom?: number;
    /** 编辑：该消息本身及其后的内容已移出 */
    editedFrom?: number;
    /** 变体切换：目标变体所属楼层的主 seq */
    variantOf?: number;
    /** 被本标记移出模型上下文的 surface 节点（供 UI/统计复原） */
    shadowedSeqs?: number[];
}
