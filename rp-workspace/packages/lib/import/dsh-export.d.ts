/**
 * DSH 适配格式导出器（M2 入库前置：ST 解析产物 → DSH 官方数据布局）
 *
 * 三条转换线（全部对齐 DSH 官方文件系统约定，见调研记录）：
 * - 世界书 → $DSH_HOME/skills/<slug>/SKILL.md + references/lore.json（Chokidar 热发现，零注册）
 * - 角色卡 → $DSH_HOME/rp/<slug>/rp.json（promptPersona 字段承载卡设定文本，运行期由
 *   dsht-rp-plugin pre-step 快照注入——第四轮起不再产出 .agent-presets/rp-* agent preset）
 * - 聊天   → $DSH_HOME/sessions/_no-cwd/<encoded-id>/session.jsonl
 *   （事件序列严格对照 dsh-session-persistence-jsonl 官方契约 oneTurnLog：
 *    turn/start → user/message → [step/start → assistant/message → step/end] → turn/end；
 *    行 shape = { type, seq, time, data, surfaceOp? }，seq 从 0 连续递增；
 *    前置条件：composition 配 session-persistence compression:'none'，否则 DSH 只认 .zstd）
 */
import type { CharacterCard } from './character-card.ts';
import type { LoreBook } from '../lore/entry.ts';
/** 一个待写入 DSH_HOME 的文件（相对 .dsh/ 的 POSIX 路径 + UTF-8 文本） */
export interface DshFile {
    path: string;
    content: string;
    /** T3.1b：content 为二进制 base64（立绘 avatar.png 落盘） */
    binary?: boolean;
}
export interface ChatConversion {
    /** session.jsonl 完整内容（header 行 + 事件行） */
    content: string;
    /** 转出的对话轮数 */
    turns: number;
    /** 跳过的行数（ST 系统注释/坏行） */
    skipped: number;
    /** 首条用户消息（做 session 标题参考） */
    firstUserText: string | null;
    /** swipes 转出的变体组数（§4.15） */
    variantGroups: number;
}
export interface ExportResult {
    skills: number;
    presets: number;
    sessions: number;
    files: DshFile[];
    warnings: string[];
    /** R1：本批产出的工作区（供调用方 workspace.create + rename(卡名)） */
    workspaces: Array<{
        slug: string;
        name: string;
        dir: string;
    }>;
}
/** DSH skill name / preset id 要求 [a-z0-9][a-z0-9-]*：ASCII 安全段 + 哈希保证唯一 */
export declare function dshSlug(prefix: 'wb' | 'rp', originalName: string): string;
/**
 * 世界书转 DSH skill 目录（SKILL.md 概览 + references/lore.json 完整结构化数据）。
 * @param book 已解析的世界书
 */
export declare function exportLoreBookSkill(book: LoreBook): DshFile[];
/**
 * 角色卡 → promptPersona 文本（卡设定快照注入文本）。
 * 宏原样保留（{{user}}/{{char}}/{{setvar::…}} 等）——运行期由 dsht-rp-plugin pre-step 的
 * 宏引擎展开（真语义），不再做写盘期中性化（中性化只用于写进 DSH persona 插件的文本）。
 * @param card 已解析的角色卡
 */
export declare function cardPromptPersona(card: CharacterCard): string;
/** 会话 id：DSH SessionId 是任意 branded string；目录名经 encodeSegment 转义后落盘 */
export declare function chatSessionId(characterName: string, chatFile: string): string;
/**
 * 迁移聊天的统一工作目录（相对 DSH_HOME）。DSH 的 session.list 只服务带 cwd 的
 * 落盘 session（"Logs without a cwd are not served"），_no-cwd 会被列表过滤——
 * 所以迁移聊天统一挂到 rp/ 工作区，DSH 启动时 WorkspaceRegistry 会按该路径自动建组。
 */
export declare const RP_WORKSPACE_DIR = "rp";
/** 目录段转义（对照 dsh-session-persistence-jsonl format.encodeSegment：注入安全，仅 [A-Za-z0-9._-] 直通） */
export declare function encodeSegment(raw: string): string;
/** 项目目录键（对照 DSH format.projectKey：分隔符折叠为 '-'、去前导、截 251、--包裹） */
export declare function projectKey(cwd: string): string;
/**
 * session 事件日志构造即验证（P1#8：参考 dsh-agent-rp src/import/sillytavern-chat-seed.ts
 * L194 的"构造后立刻 Session.create 校验再冻结返回"，MIT © hewzhew——我方拿不到 host 侧
 * 运行时的 DSH Session 类，按文档允许的替代方案用同构校验器断言）。
 *
 * 断言（不合格直接 throw，诊断含第几条/type/seq/期望与实际值）：
 * - seq 从 0 严格连续（+1）；
 * - turn/start 与 turn/end 配对：不嵌套、不悬空、编号从 1 连续、reason.kind='completed'；
 * - step/start 与 step/end 配对：不嵌套、不悬空、turn/step 编号与开括弧一致；
 * - user/message 与 assistant/message 必在 turn 内；
 * - 结尾无未闭合的 turn/step。
 */
export declare function assertSessionLogEvents(events: ReadonlyArray<{
    type: string;
    seq: number;
    data?: Record<string, unknown>;
}>): void;
/**
 * 一个 ST 聊天文件（.jsonl，逐行 {name,is_user,mes,swipes,swipe_id,send_date}）→ DSH session.jsonl 内容。
 *
 * 事件序列契约（oneTurnLog）：user 消息开 turn；assistant 消息作为该 turn 的 step；
 * 表面事件（user/message、assistant/message）必须带 surfaceOp；turn/end reason 用
 * {kind:'completed'}；is_system 行跳过。
 *
 * swipes → 变体组（§4.15）：同 anchor 的兄弟 assistant/message 事件用 replace
 * SurfaceOp 链互替（DSH compaction 同款原生机制，surface.ts 契约：replace 的
 * start/end 是被覆盖节点的 seq，sourceEventSeqs 必须含全部被 shadow 的 seq）。
 * log 全量保真（所有变体事件都在），surface 只剩 active 变体——组装语义与
 * ST"未选中 swipe 不进 prompt"一致。前端扫 replace 链即可重建变体组做左右切换。
 */
export declare function convertChatFile(jsonlText: string, opts: {
    sessionId: string;
    createdAt: number;
    cwd?: string;
    systemHandling?: 'skip' | 'auto';
}): ChatConversion;
/** session.jsonl 的落盘相对路径（按 cwd 的 projectKey 分组，对照 DSH projectDir） */
export declare function sessionFilePath(sessionId: string, cwd: string | undefined): string;
/** 单批回调：文件数达到 batchSize 或阶段切换时交付（调用方写盘后继续） */
export type ExportSink = (files: DshFile[], progress: {
    percent: number;
    desc: string;
}) => Promise<void>;
/**
 * rp.json 内容构造（工作区机器可读数据：插件与前端共同消费）。
 * outputProtocol（§4.6 输出协议组件的前端配置）：actionTags 提取为可点按钮并从气泡剥离、
 * wrapTags 剥壳显示内文。默认覆盖用户卡实测格式（<a> 行动选项）与 V8.8（selection/content）。
 */
export declare function buildRpJsonContent(card: import('./character-card.ts').CharacterCard, books: Array<{
    name: string;
    lorePath: string;
}>, opts?: {
    user?: string;
}): string;
/**
 * 单张角色卡（T1.15：PNG/JSON 单文件导入路径）→ DSH 文件集：
 * 内嵌书 skill + 工作区 rp.json（promptPersona 承载卡设定）+ README + 开场白 session（T2.9）。
 * 外部引用书在单文件路径无法配对（无 data 上下文），导入后可在管理界面补绑。
 */
/**
 * T2.9：开场白 session（角色卡导入必然产出）——firstMes 作为该 session 的
 * 首条 assistant 消息落盘（官方 oneTurnLog 契约：虚拟 turn 包裹开场白）。
 * 点开角色卡即见开场白历史会话；pre-step 快照注入保留给无 session 的旧工作区兼容。
 *
 * 多开场白（T7a）：alternateGreetings 作为 swipe 变体组写进同一条 assistant 消息
 * 位——变体链契约同 convertChatFile 的 swipes 处理（首个 append，其余依次
 * replace 前驱 + sourceEventSeqs 血缘；active = firstMes（ST 默认 swipe_id 0），
 * 追加一次切换事件把 surface 换回 firstMes）。log 全量保真，前端扫 replace 链
 * 重建变体组做开场白左右切换。
 */
export declare function buildFirstMesSession(card: import('./character-card.ts').CharacterCard, opts?: {
    cwd?: string;
    dshHome?: string;
}): DshFile | null;
export declare function exportSingleCardFiles(card: import('./character-card.ts').CharacterCard, dshHome?: string): DshFile[];
export interface ExportToDshOptions {
    worlds?: boolean;
    cards?: boolean;
    chats?: boolean;
    /** T2.11：整包迁移是否顺带导入 ST 预设（OpenAI Settings/*.json → 顶层 preset + 预设正则） */
    presets?: boolean;
}
/**
 * 把最近一次 analyzeDataZip 的会话缓存转换成 DSH 数据布局文件，经 sink 分批写盘。
 *
 * 进度分配：世界书 0-40%、角色卡 40-70%、聊天 70-100%。
 *
 * 工作区布局（§4.14 用户定案）：**一张角色卡 = 一个工作区**——
 * 有聊天且能对上卡的 → cwd = $DSH_HOME/rp/<卡slug>（DSH workspace 侧栏即角色分组）；
 * 对不上卡的孤儿聊天 → cwd = $DSH_HOME/rp/_orphan。每个工作区写 README.md
 * （角色说明 + 聊天清单 + preset/skill 指引），兼作目录占位（WorkspaceRegistry
 * realpath 校验要求目录存在）。
 *
 * @param imp analyzeDataZip 后的会话缓存（lastDataImport()）
 * @param sink 接收批次（每批 ≤ batchSize 个文件），await 后继续——调用方在这里写盘
 * @param dshHome DSH_HOME 绝对路径（聊天 session 的 cwd 基准；无则聊天下降到 _no-cwd，列表不可见）
 */
export declare function exportToDshFiles(imp: {
    zip: {
        files: Record<string, {
            async(t: 'string'): Promise<string>;
        }>;
    };
    worlds: Map<string, import('../lore/entry.ts').LoreBook>;
    characters: import('./character-card.ts').CharacterCard[];
    chatFiles: Array<{
        path: string;
        ownerDir: string;
    }>;
    report?: {
        settings?: {
            personaName?: string | null;
            personaDescription?: string | null;
            /** R8：power_user 三处提取的全部 persona（见 data-zip extractPersonas） */
            personas?: Array<{
                name?: string;
                description?: string;
                isDefault?: boolean;
                avatar?: string | null;
            }>;
        };
        relations?: {
            /** R9：settings.globalSelect 全局启用书 */
            globalSelectedBooks?: string[];
        };
    };
}, sink: ExportSink, options?: ExportToDshOptions, dshHome?: string): Promise<ExportResult>;
