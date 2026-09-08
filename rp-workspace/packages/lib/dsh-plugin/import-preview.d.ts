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
/**
 * 在 unpacked/ 下定位 ST data 根：找含 settings.json 的最深目录
 * （多用户结构 data/<user>/settings.json 最深者优先）。
 */
export declare function findStDataRoot(unpackedDir: string): Promise<string | null>;
/** 卡/书/聊天归属匹配用归一化（与 rebuild-chats 同口径：去空白 + 小写） */
export declare function normalizeName(s: string): string;
/**
 * 明确丢弃项判定（§4.16.1 设计决策：这些是设计上不导入的，要在预览里写明去向）。
 * 返回丢弃原因；null = 不是丢弃项。relPath 为 unpacked 内 posix 相对路径。
 */
export declare function classifyDropped(relPath: string): string | null;
/** EJS 模板语法检测（<% … %>）——命中即提示「将转条件槽位」 */
export declare function isEjsTemplate(text: string): boolean;
/** 卡 JSON 里的卡名（V2 data.name / V1 顶层 name） */
export declare function cardJsonName(root: unknown): string | null;
/** 世界书 JSON 的条目数（entries 可能是对象映射或数组两种 ST 形态） */
export declare function lorebookEntryCount(root: unknown): number;
/** ST 预设 JSON 的 prompts 数（无 prompts 字段按 0 计） */
export declare function stPresetPromptCount(root: unknown): number;
/** 库内既有工作区（同名检测与「已绑定」判定用） */
export interface ExistingWorkspace {
    dir: string;
    characterName?: string;
    books?: Array<{
        name?: unknown;
        lorePath?: unknown;
    }>;
}
/** 库内既有状态快照（dshHome 缺省时全部按「新」处理——单测可省） */
export interface ExistingState {
    workspaces: ExistingWorkspace[];
    presets: Array<{
        id: string;
        displayName: string;
    }>;
    /** 已落盘 session（project/sdir 键 + sessionId） */
    sessions: Array<{
        sessionId: string;
        project: string;
        sdir: string;
    }>;
}
export declare function loadExistingState(dshHome: string): Promise<ExistingState>;
/** 卡名 → 库内是否已有同名工作区（rp/<slug> 目录名按卡名 dshSlug 匹配；rp.json characterName 归一化兜底） */
export declare function findExistingCardSlug(name: string, state: ExistingState): string | null;
/** 书名 → 库内是否已被某工作区绑定（books[].name 归一化匹配或 lorePath slug 匹配）；返回绑定它的工作区列表 */
export declare function findBookBoundBy(name: string, state: ExistingState): string[];
export interface PreviewCard {
    name: string;
    /** 有立绘（PNG 卡本身即立绘；JSON 卡看同名 png） */
    avatar: boolean;
    regexCount: number;
    hasEmbeddedWorldInfo: boolean;
    alternateGreetings: number;
    target: '新工作区' | '已存在(同名)';
    /** 目标工作区 slug（新 = 将创建的；已存在 = 库内目录名） */
    slug: string;
    /** characters/ 下的相对路径 */
    sourceFile: string;
    /** 卡文本（描述/开场白等）含 EJS 模板 */
    ejs: boolean;
}
export interface PreviewBook {
    name: string;
    entryCount: number;
    target: '新 skill' | '已绑定';
    /** 已绑定时：绑定它的工作区名列表 */
    boundBy?: string[];
    sourceFile: string;
    /** 含 EJS 语法的条目数（→ 转 DSH 条件槽位提示） */
    ejsEntries: number;
}
export interface PreviewChat {
    /** chats/<角色>/<文件名>（posix） */
    name: string;
    messageCount: number;
    /** 大文件只统计了前 8MiB（OOM 护栏），计数为下界 */
    approx: boolean;
    /** 已落盘的同 id session（能匹配到才标注） */
    targetSessionId?: string;
    /** chats 目录名对不上任何卡 → 迁移时会进待认领（rp/_orphan） */
    orphan: boolean;
    sourceFile: string;
}
export interface PreviewPreset {
    displayName: string;
    promptCount: number;
    /** 库内已有同名预设的 rp-presets/<id>（覆盖语义） */
    targetPresetId?: string;
    sourceFile: string;
    ejs: boolean;
}
export interface DroppedItem {
    /** unpacked 内 posix 相对路径 */
    path: string;
    reason: string;
}
export interface ImportPreview {
    kind: 'st-data' | 'single-card' | 'single-book' | 'unknown';
    /** ST 数据根（相对 unpacked/；raw 单文件批次为 null） */
    stRoot: string | null;
    cards: PreviewCard[];
    books: PreviewBook[];
    chats: PreviewChat[];
    presets: PreviewPreset[];
    dropped: DroppedItem[];
    /** 含 EJS <%%> 语法的预设/条目总数（→ 提示将转条件槽位） */
    ejsTemplates: number;
}
export declare function countChatMessages(path: string): Promise<{
    count: number;
    approx: boolean;
}>;
/**
 * 预览主入口：扫 unpacked/ 产出分类清单（只读不改——不写任何文件）。
 * @param unpackedDir rp-import/<batchId>/unpacked
 * @param opts.dshHome 提供时做同名/已绑定/已有 session 匹配；缺省全部按「新」处理
 */
export declare function scanImportPreview(unpackedDir: string, opts?: {
    dshHome?: string;
}): Promise<ImportPreview>;
/** 迁移类目（顺序即 SKILL.md 建议处理顺序） */
export declare const CHECKPOINT_STAGES: readonly ["api", "books", "cards", "chats", "presets", "persona", "misc"];
export type CheckpointStage = typeof CHECKPOINT_STAGES[number];
export interface CheckpointStageEntry {
    /** 本类目已完成的资源项标识（书名/卡 slug/聊天文件名/预设名…） */
    done: string[];
    updatedAt: string;
    /** 本类目首次写入时刻（剩余时间外推的类目起点：速率 = done /（startedAt → updatedAt））。
     * normalizeCheckpointWrite 首现补、续写保留；旧 checkpoint 没有该字段 → 外推退 meta.stagedAt 兜底 */
    startedAt?: string;
}
/** checkpoint.json 落盘形态 */
export interface CheckpointFile {
    batchId: string;
    stages: Partial<Record<CheckpointStage, CheckpointStageEntry>>;
    updatedAt: string;
}
/** done 列表清洗：字符串化、去空白、去重、条数/长度上限（防 agent 写爆） */
export declare function sanitizeDoneList(raw: unknown): string[];
/** 解析 checkpoint.json 文本（坏 JSON/形态不对/空 stages → null） */
export declare function parseCheckpointFile(text: string): CheckpointFile | null;
/**
 * 归并一次类目写入：覆盖该 stage 的 done，保留其他 stage（updatedAt 刷新）。
 * startedAt 首现补、续写保留——它是「该类目实际开工时刻」，剩余时间外推的类目速率
 * = done /（startedAt → updatedAt）的分母起点（§4.16.1 屏5 预估剩余）。
 */
export declare function normalizeCheckpointWrite(batchId: string, existing: CheckpointFile | null, input: {
    stage: CheckpointStage;
    done: unknown;
}): CheckpointFile;
/** checkpoint 摘要（批次列表徽章 / kickoff 续跑消息用） */
export declare function summarizeCheckpoint(cp: CheckpointFile | null): {
    hasCheckpoint: boolean;
    stages: CheckpointStage[];
    doneCount: number;
    updatedAt: string;
};
/** meta.json.manifest 的最小消费面（结构与 index.ts 的 ImportManifest 对齐；
 * 这里不直接 import 避免与 index.ts 循环依赖——esbuild 循环引用初始化顺序脆） */
export interface ManifestCountsLike {
    kind?: unknown;
    cards?: unknown;
    books?: unknown;
    chats?: unknown;
    presets?: unknown;
}
/** meta.json.kickoff 的最小消费面（import-kickoff 幂等记录：批次已开工） */
export interface KickoffRecordLike {
    sessionId?: unknown;
}
/** 待认领项（屏6「待认领」清单）：导入成功但归属不明，第一版纯指引型（无写操作） */
export interface ImportClaim {
    kind: 'chat' | 'card' | 'checkpoint';
    name: string;
    detail: string;
}
/** 待认领项的下一步指引文案（kind 决定话术路径：聊天→角色 tab 重新绑定；卡→角色详情看版本） */
export declare function claimHint(kind: ImportClaim['kind'], name: string): string;
/** done 元素解析结果：前缀显式声明的类目 / claim 标记 / 标识本体 */
export interface DoneEntryParsed {
    /** done 元素前缀显式声明的类目（`<类目>:<标识>` / `claim:<类目>:<标识>` 形态）；裸标识为 null——归属回写入时的 stage 桶 */
    stage: CheckpointStage | null;
    /** 标识本体（claim: 与类目前缀剥掉；裸类目名形态为空串——一项代表该类目整体） */
    ident: string;
    /** claim: 前缀 = 迁移 agent 标记的无法归属产物（契约见 SKILL.md「断点续跑」） */
    claim: boolean;
}
/**
 * 解析一条 checkpoint done 元素。三种形态都认（agent 手写宽松对齐）：
 * 1. `claim:<类目>:<标识>` → 待认领产物（如 `claim:chats:陌路人/chat-2.jsonl`）；
 * 2. `<类目>:<标识>` / 裸`<类目>` → 显式归属该类目（agent 摘要式混写时跨桶归属）；
 * 3. 其他裸标识 → 归属写入时的 stage 桶（SKILL.md 契约的标准写法）。
 */
export declare function parseDoneEntry(entry: string): DoneEntryParsed;
/**
 * checkpoint.done 逐类目计数 + claim 标记收集。
 * done 元素三种形态都认（parseDoneEntry）；claim 项同样计入 done（已导入成功，只是归属不明）。
 */
export declare function countDoneByStage(cp: CheckpointFile | null): {
    counts: Record<CheckpointStage, number>;
    claims: ImportClaim[];
};
/** manifest 计数 → 逐类目 total：books 按书数 / cards 按卡数 / chats 按聊天数 / presets 按预设数；
 * st-data 批次 api/persona/misc 恒计 1（settings.json 必在，三类必做）；单文件批次只涉及其一类，
 * 其余类目 total=0（UI 显示「不涉及」，不计入 overall）。 */
export declare function progressTotalsFromManifest(manifest: ManifestCountsLike | null | undefined): Record<CheckpointStage, number>;
/**
 * 预估剩余时间（分钟）：已完成类目实际耗时速率 × 剩余量。
 * 类目速率 = 该类目 done /（startedAt → updatedAt 的实际耗时）——startedAt 由 checkpoint
 * 写入时首现补齐（normalizeCheckpointWrite），是「该类目真实开工时刻」；旧 checkpoint 没有
 * startedAt / 数据不足退全局速率（全部 done /（stagedAt → 最新类目 updatedAt））。
 * 无 checkpoint、无有效时间戳、时钟倒挂返回 null——前端显示「—」不编数字。
 */
export declare function estimateRemainingMinutes(totals: Record<CheckpointStage, number>, counts: Record<CheckpointStage, number>, cp: CheckpointFile | null, stagedAtMs: number): number | null;
/**
 * 预览扫描 → 待认领项（与预览屏同源判定，只收清单给文案，不做实际认领写操作）：
 * 1. chats 预览 orphan: true（三键归属对不上任何卡，迁移时进 rp/_orphan）；
 * 2. cards 已存在(同名) 且 zip 内版本有更新（与库内 card.json 归一化比对）。
 */
export declare function collectPreviewClaims(dshHome: string | undefined, unpackedDir: string, preview: ImportPreview): Promise<ImportClaim[]>;
/** 进度类目（前端逐类目进度条渲染用） */
export interface ProgressCategory {
    name: CheckpointStage;
    total: number;
    done: number;
    /** 0..1；total=0 → done>0 视为 1（agent 报了 manifest 没数的项），否则 0 */
    ratio: number;
}
/** 批次进度汇总（GET /rp/import-progress 响应的 progress 字段） */
export interface BatchProgress {
    /** 当前类目 = CHECKPOINT_STAGES 顺序第一个未完成的适用类目；全部完成 = 'done'；批次无适用类目 = 'pending' */
    stage: string;
    kind: string;
    categories: ProgressCategory[];
    overall: {
        total: number;
        done: number;
        ratio: number;
    };
    /** 已 kickoff 但 agent 还没回写任何进度——诚实标注（有进度数据才有意义，别拿 0% 假装精确） */
    uncertain: boolean;
    /** 预估剩余分钟（null = 数据不足，前端显示「—」不编数字） */
    etaMinutes: number | null;
    startedAt: string;
    updatedAt: string;
    claims: ImportClaim[];
}
/**
 * 进度汇总主入口：meta.json（manifest total + stagedAt + kickoff）× checkpoint.json
 * （逐类目 done）× 预览来源 claims → BatchProgress。纯函数（FS 读取在路由层）。
 */
export declare function buildBatchProgress(meta: {
    stagedAt?: unknown;
    manifest?: unknown;
    kickoff?: unknown;
} | null | undefined, cp: CheckpointFile | null, extraClaims?: ImportClaim[]): BatchProgress;
