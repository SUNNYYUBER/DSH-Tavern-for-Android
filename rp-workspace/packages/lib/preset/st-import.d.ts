/**
 * T2.7 补丁：SillyTavern completion 预设导入器（示例预设/可待等 → RP 预设表层）。
 *
 * ST 预设 JSON（OpenAI Settings/*.json）结构：
 * - prompts[]：全部条目（identifier/name/role/content/marker/injection_position/
 *   injection_depth/enabled…；enabled 以 prompt_order 内的为准）
 * - prompt_order[]：[{character_id, order: [{identifier, enabled}]}]——取通用档
 *   （character_id 最小者，ST 的 100001 档）作为生效顺序
 * - 采样参数全量映射（P1#7）：temperature/top_p/top_k/top_a/min_p/penalties/seed/
 *   openai_max_tokens/openai_max_context/stream_openai/custom_stopping_strings/
 *   logit_bias/reasoning_effort；宏变量（setvar 初值 + getvar/裸宏占位）登记进
 *   RPPreset.macros（对照 dsh-plugin-prompt-tool sillytavern.ts，MIT © Czerror）
 * - extensions.regex_scripts[]：预设内嵌正则（思维链美化等）→ 预设作用域正则文件
 *
 * 产物（用户定案「预设 = 行为指令包」的导入路径）：
 * - RPPreset：条目按 prompt_order 顺序平铺为 slots（开关语义 = ST 条目开关）；
 *   marker 槽位映射组装层动态位；injection_position=1 的条目带 depth。
 *   R3：ST 注释条目（〖…〗/【…】/===…=== 等组头）→ RPPreset.toggles 开关组，
 *   组内条目 = option（selected = ST enabled）；识别不到组头时按 enabled 分两组兜底。
 * - RegexScript[]：内嵌正则（写入 rp-presets/<id>/regex.json，mergedRegex 第三源）
 * - T3.3 重 agent 场景适配：path 判定为 agent 的 ST 预设（detectAgentComposition：
 *   名字标注 + 显式/subagent 编排关键词特征，对齐既有 isAgentPreset 契约）做三档归位——
 *   配置自查类条目折叠进 configSummary 槽补充文本（configSummaryExtra）、内心 OS/思维链
 *   类条目转 skillRef 槽 + pendingSkills（调用方落盘 $DSH_HOME/skills/<slug>/SKILL.md）、
 *   subagent 编排类条目登记 subagentHints（仅重 agent 路径消费，编译期忽略）；oneshot 预设零影响
 */
import type { RPPreset } from './schema.ts';
import type { RegexScript } from '../regex/engine.ts';
interface StPromptEntry {
    identifier?: string;
    name?: string;
    role?: string;
    content?: string;
    marker?: boolean;
    system_prompt?: boolean;
    injection_position?: number;
    injection_depth?: number;
    injection_order?: number;
}
export interface StPresetImport {
    preset: RPPreset;
    regex: RegexScript[];
    /** 跳过的条目数（无对应 marker 槽的 marker 条目等） */
    skipped: number;
    /**
     * 任务 3：agent 编排型预设里提取出的独立模块化内容块（标题即能力名、内容是
     * 操作手册形态——通用规则见 extractSkillBlocks 头注）。仅 path='agent' 时非空。
     * dir 相对 $DSH_HOME（skills/preset-<id>/<块名>/）；调用方写 <dir>/SKILL.md。
     */
    skills: PresetSkillBlock[];
}
/** 提取出的预设技能块 */
export interface PresetSkillBlock {
    /** skill 目录（相对 $DSH_HOME）：skills/preset-<dirId>/<blockSlug> */
    dir: string;
    /** SKILL.md frontmatter name（= 目录末段） */
    name: string;
    /** 块显示名（ST 条目原名） */
    label: string;
    /** SKILL.md 正文（操作手册内容，宏包装已拆） */
    content: string;
}
/** 拆宏包装：{{// …}} 注释剥离；{{setvar::k::body}} → body（手册正文在 setvar 值里） */
export declare function unwrapMacroWrappers(content: string): string;
/**
 * 提取 agent 预设里的独立模块化内容块 → DSH skill 文件集。
 * 范围：全部内容条目（非 marker、非组头注释条目；不看 enabled——开关只控制引用，
 * 手册本体必须在库里，开关打开时模型才读得到）。
 */
export declare function extractSkillBlocks(presetId: string, prompts: StPromptEntry[]): PresetSkillBlock[];
/** skill 块 → SKILL.md 文本（frontmatter + 操作手册正文） */
export declare function renderPresetSkillMd(presetDisplayName: string, block: PresetSkillBlock): string;
/**
 * 判定 ST 预设是否为 agent 编排型：名字标注或任一条目内容命中编排特征。
 * agent 型 → RPPreset.path = 'agent'（编排结构保留，供 T3.3 重 agent 适配器消费）；
 * 其余 → 'direct'（oneshot 单轮直出组装）。
 */
export declare function isAgentPreset(displayName: string, prompts: Array<{
    content?: unknown;
}>): boolean;
/** 三档归位档位（classifyStAgentEntry 产物） */
export type StAgentEntryTier = 'config' | 'innerOs' | 'subagent';
/**
 * 三档归位判定（规则层，可单测）：agent 型 ST 预设的单个内容条目归入哪一档。
 * 返回 null = 常规条目（平铺 slots/toggles，导入行为与 T2.7/R3 一致）。
 * 优先级：配置自查 > subagent 编排 > 内心 OS（自查语义最具体；编排次之；思维链最泛）。
 * 判定基准：名称/identifier 关键词为主、内容关键词为辅——真实样本实证：正文里
 * 「内心」「think」等词大量出现在文风/人称/画图等无关条目中，只有名称是可靠语义标签。
 */
export declare function classifyStAgentEntry(p: {
    name?: unknown;
    identifier?: unknown;
    content?: unknown;
}): StAgentEntryTier | null;
/**
 * T3.3：ST 预设 agent 编排型判定（关键词密度/特征 → path 判 agent；导入入口用）。
 * 与既有判定对齐（isAgentPreset：名字标注 + 显式编排内容特征原样保留——既有的
 * 真实裁剪件契约是同一份内容按 [Agent]/[主预设] 名字分走两条路径，内容特征密度
 * 不单独翻 path，防止误伤 ST oneshot 主预设），另加一类特征：
 * - subagent 编排关键词（planner/writer/reviewer/子代理/角色分工）：名称命中即认；
 *   内容命中需同一长文 ≥2 次（真实样本实证：破限伪代码里偶现的 writer 单词不算编排）。
 */
export declare function detectAgentComposition(displayName: string, prompts: Array<{
    name?: unknown;
    identifier?: unknown;
    content?: unknown;
}>): boolean;
/**
 * pendingSkill 名净化（"skill 名 = 槽 id 净化"：去换行、压空白、限长——
 * 名字进 SKILL.md frontmatter 与 skillRef 槽引用，须单行 YAML 安全）。
 */
export declare function sanitizeSkillName(raw: string): string;
/** pendingSkill → $DSH_HOME 相对目录（skills/<slug>；dirSafe 产出 ASCII 安全段 + 短哈希） */
export declare function pendingSkillDir(skillName: string): string;
/**
 * pendingSkill → SKILL.md 占位落盘文本（frontmatter + 条目正文）。
 * "占位"：正文即原 ST 条目内容（内心 OS/思维链规则本体），DSH skill 机制按需读取；
 * 名字带引号写 frontmatter（中文名/冒号安全，双引号 YAML 标量）。
 */
export declare function renderPendingSkillMd(presetDisplayName: string, skill: {
    name: string;
    content: string;
}): string;
/**
 * 宏变量登记：扫全部条目原文——
 * - {{setvar::k::v}} → k=v（ST 顺序求值，后者覆盖前者）；
 * - {{getvar::k}}/{{getvar::k::default}} → k 无 setvar 初值时登记 default ?? ''；
 * - 裸 {{key}}（非已知/运行时宏）→ 空值占位（未定义自定义宏登记，插值替换为空不留字面）。
 * 返回 null 表示无宏（不带 macros 字段）。
 */
export declare function registerStMacros(contents: string[]): Record<string, string> | null;
/**
 * 解析一个 ST 预设 JSON → RP 预设表层 + 内嵌正则。
 * @param json ST 预设文件内容
 * @param displayName 预设显示名（默认取文件名）
 */
export declare function importStPreset(json: string, displayName: string): StPresetImport;
export {};
