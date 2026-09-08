/**
 * RP 预设编译器（M1 / T1.9，计划文档 §4.3）
 *
 * 表层 preset.json（玩家/UI 编辑）→ 里层 DSH preset 目录（agent.cordis.yml + preset.yml）。
 * - toggles 编译期展开：选中项内容进 persona 槽位文本，未选中项不进 prompt（§4.3）
 * - system/skillRef 槽位 → persona 文本分节（skillRef 写引用提示，skill 本体由 DSH skill 机制注入）
 * - marker 槽位（worldBefore/charDesc/...）是组装层动态填充位，编译期不产出静态文本——
 *   角色卡路径由 rp.json.promptPersona（cardPromptPersona）填充；纯预设（无卡）场景留给工作区数据
 * - 配置摘要（configSummary）由组装层运行期生成，编译期不落文本
 * - 预算（budget）/采样（sampling）：direct 路径无 agent 循环不生效；lightAgent/heavyAgent
 *   写入 preset.yml 注释区供未来 agent 行读取（M1 挂载可跑，M2 接执行面）
 */
import type { RPPreset } from './schema.ts';
export interface CompiledPresetFile {
    path: string;
    content: string;
}
/**
 * 宏中性化（persona 文本进 DSH 严格插值器前的护栏，compilePreset 与 persona preset
 * 生成层统一调用）：
 * - {{model}}/{{cwd}} 保留（DSH 运行期插值）；
 * - {{user}}/{{char}}/{{persona}} 由调用方先行展开（expandIdentityMacros），
 *   漏网的大小写变体（{{User}} 等）与其余一切 {{…}} 形态（含 {{setvar::x::y}}
 *   分段宏、{{getvar::x}}）一律替换为全角 ｛｛…｝｝——渲染层看得到原样，插值器不碰。
 *
 * 职责分工（第四轮定案）：本函数是"写进 DSH persona 插件 config.text"的写盘期护栏，
 * 与运行期宏语义互补而非替代——运行期的 {{…}} 由 dsht-plugin-shared/macros.ts 的
 * 宏引擎真求值（dsh-plugin pre-step 快照注入与 /dsht-tavern-helper/macros/expand 共用），
 * 中性化文本永远不进宏引擎（先展开的 {{user}} 等已是具体名字，残留全角形态插值器不碰）。
 *
 * P0-4 转义路线调查结论（2026-08-27，证据：dsh-runtime 实装包源码）：
 * dsh-agent-rp 的 stringifySillyTavernPromptJson 用 \u007b/\u007d 转义 JSON 字符串
 * token 内的 {} 绕开插值器——但该技巧**只对 JSON 语境有效**（JSON.parse 会把 \u007b
 * 还原为真花括号）。本编译器的 persona 文本写进 agent.cordis.yml 的 YAML block scalar
 *（`text: |-`）：YAML 块标量不做任何转义处理，\u007b 会作为字面 6 个字符进 prompt
 *（内容错误）；而 YAML 双引号标量虽会把 \u007b 解码回真花括号，却又重新拼出 {{…}}
 * 触发插值器。插值器本身（dsh-system-prompt/lib/index.js 的 interpolate()）在 config
 * 加载完成后的纯字符串上扫描 '{{'，未知/畸形引用直接 throw（真机实测炸 turn：
 * "malformed prompt variable reference"）。因此 YAML 块内 {{}} 无转义出路，
 * 维持全角化；\u007b 转义仅适用于"JSON 字符串写盘后再被插值"的场景（本仓库不存在
 * 该路径——rp.json/persona.json 由我们自己的 JSON.parse 读取，不经 DSH 插值器）。
 */
export declare function neutralizePromptVariables(text: string): string;
/**
 * 编译 RP 预设 → DSH preset 目录文件集。
 * @param preset 表层预设
 * @param macroCtx 身份宏展开上下文（user/char）
 */
/** agent 型预设紧凑 persona 的版本标记（agent.cordis.yml 注释行；ensureRpPresetSync
 *  据此检测存量目录缺紧凑形态 → 补编译升级，幂等） */
export declare const AGENT_COMPACT_PERSONA_MARKER = "DSHT-RP-COMPACT-PERSONA-V1";
export declare function compilePreset(preset: RPPreset, macroCtx: {
    user: string;
    char: string;
}): CompiledPresetFile[];
/** 能力轴组的 loader entry id（isDshtRpAgentComposition 的源码级特征锚点） */
export declare const DSHT_RP_CAPABILITY_GROUP_ID = "preset-capability";
/**
 * RP 能力组合的源码级特征判定（对照 dsh-agent-rp isAgentRpCapabilityComposition L39，
 * MIT——本函数为按模式重写，非抄实现）。三特征齐备才算 RP 能力组合：
 * - 能力轴组行（`- id: preset-capability`，compilePreset 的 agent 形态产物）
 * - tool-skill 行（skill 对模型可调用的落点，能力轴本质）
 * - persona 行（内容轴正文；纯 coding 预设无完整 RP 形态）
 * 结构特征而非目录 id/注释匹配：用户复制派生（改名）的预设仍被识别，无关 coding
 * 预设被挡在 RP 能力轴判定外。运行时权威判定（会话实际挂载组合）由调用方先读
 * agent.session.header.agentPreset 再过本函数——对照 agentHasAgentRpRuntime L48 的
 * 双重判定（serviceFor 探测对我们不适用：能力轴挂的是宿主层按 scope 分层的 skill
 * 注册表，组内无预设私有服务可探）。
 */
export declare function isDshtRpAgentComposition(source: string): boolean;
