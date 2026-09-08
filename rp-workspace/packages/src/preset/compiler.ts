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

import type { RPPreset } from './schema.ts'

export interface CompiledPresetFile {
  path: string
  content: string
}

/** 身份宏导入期展开（DSH persona text 严格插值——未注册变量直接抛错，运行期宏由组装层接管） */
function expandIdentityMacros(text: string, ctx: { user: string; char: string }): string {
  return text
    .replaceAll('{{user}}', ctx.user)
    .replaceAll('{{persona}}', ctx.user)
    .replaceAll('{{char}}', ctx.char)
}

/**
 * DSH system-prompt 已注册的 prompt 变量（dsh-system-prompt：agent loop 注册
 * model/cwd；README 明示无转义语法，未知/畸形 {{…}} 引用渲染期直接抛错——
 * 真机实测 {{setvar::think1::}} 炸 turn："malformed prompt variable reference"）。
 */
const DSH_KNOWN_VARS = new Set(['model', 'cwd'])

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
export function neutralizePromptVariables(text: string): string {
  // 字面全量中性化（不再用 \{\{([^{}]*)\}\} 扁平正则——嵌套花括号宏会漏：
  // 真机实测 V17.1 的 {{setvar::mvu::<正文含 {{getvar::x}}>}} 原样进 yml，
  // DSH 插值器炸 turn "malformed prompt variable reference"）。
  // 已知变量（{{model}}/{{cwd}}）用占位符保护后，逐字替换所有剩余花括号对。
  const PROTECT: Array<[string, string]> = [
    ['{{model}}', '\u0000DSHT_M\u0000'],
    ['{{cwd}}', '\u0000DSHT_C\u0000'],
  ]
  let out = text
  for (const [find, ph] of PROTECT) out = out.split(find).join(ph)
  out = out.split('{{').join('｛｛').split('}}').join('｝｝')
  for (const [find, ph] of PROTECT) out = out.split(ph).join(find)
  return out
}

/**
 * 编译 RP 预设 → DSH preset 目录文件集。
 * @param preset 表层预设
 * @param macroCtx 身份宏展开上下文（user/char）
 */
/** agent 型预设紧凑 persona 的版本标记（agent.cordis.yml 注释行；ensureRpPresetSync
 *  据此检测存量目录缺紧凑形态 → 补编译升级，幂等） */
export const AGENT_COMPACT_PERSONA_MARKER = 'DSHT-RP-COMPACT-PERSONA-V1'

export function compilePreset(preset: RPPreset, macroCtx: { user: string; char: string }): CompiledPresetFile[] {
  // §2.3 ② 两套规则单向生成（2026-09-03 用户拍板）：persona 一律紧凑指针——
  // 规则正文不再编译进 system（旧形态把 ST 预设全文编进 persona，与每轮注入的 RP 预设
  // 快照构成两份重复规则，实测单请求 ~25 万 token 固定开销；实机 V14.7 是 path=direct
  // 且 207 槽位——紧凑化必须覆盖所有路径，不能只看 path='agent'）。正本 = 激活的 RP 预设：
  // dsh-plugin pre-step 每轮 renderPresetPrompt(preset) 从 preset.json 现值生成快照注入
  // （withPresetLayer 无 path 过滤，任何路径的预设都走快照管线），正本一改下一轮即生效
  // （单向：底层指令只是指针，无内容可分歧）。结构行（能力轴组 vs 平铺 skill）仍按 path 区分。
  const sections: string[] = []

  sections.push(`你正在进行角色扮演（预设「${preset.displayName}」）。`)
  if (preset.description) sections.push(`# 预设说明\n${preset.description}`)

  sections.push(
    `# 规则正文位置（重要）\n` +
    `扮演规则的完整正文不在本文件——每轮对话会以「RP 预设」快照消息注入全文\n` +
    `（含配置开关、思考协议、输出格式、世界书指引等）。你必须严格遵守该快照中的全部规则；\n` +
    `若快照与本文件的任何叙述冲突，一律以快照为准。`,
  )

  sections.push(
    `# 行为准则\n` +
    `- 全程保持角色，以小说化的叙述推进剧情：动作、神态、对白交织。\n` +
    `- 回复长度与当前文风保持一致；用户推进剧情时跟随，不替用户做决定。\n` +
    `- 需要世界观设定而上下文没有时，用技能/文件工具查询，不要编造与设定冲突的内容。`,
  )

  const personaText = neutralizePromptVariables(expandIdentityMacros(sections.join('\n\n'), macroCtx))
  // 任务 3 / P1#6：agent 编排型预设（path='agent'，如 ST「[Agent] …」迁移产物）用双轴分离
  // 形态 agent.cordis.yml（编排骨架对照 dsh-agent-rp preset/agent.cordis.yml，MIT）：
  // - 内容轴：persona 正文（编排指令）+ agent-instructions 行（AGENTS.md/指令文件读取），
  //   与 RP 预设侧 pre-step 快照注入是同一内容的两个落点，各自独立生效；
  // - 能力轴：preset-capability cordis 组挂 skill-filesystem + tool-skill。skill 注册表是
  //   宿主层按 scope 分层的服务（deepseek-harness code 预设 §skills 注释："registries live
  //   in the host composition, layered per scope"），组内两行注册进本预设的层——
  //   skills/preset-*/ 技能块（导入期 extractSkillBlocks 提取）由此进目录且对模型可调用；
  // - 显式降权：不挂 shell/文件系统/子代理/工作流行（对照 dsh-agent-rp 的 tool-web
  //   fetch:false 降权组），RP 运行时不继承 coding 预设的工作区权限。
  const agentRows = preset.path === 'agent'
    ? [
      ``,
      `# agent 形态：指令文件读取（ST agent 编排预设的"操作手册"语义落点）`,
      `- id: agent-instructions`,
      `  name: '@deepseek-ai/dsh-agent-instructions'`,
      `  config:`,
      `    maxBytes: 65536`,
      ``,
      `# 能力轴（P1#6 双轴分离）：skill 走 DSH preset 侧。内容编排轴在 RP 预设侧`,
      `#（pre-step 快照注入），两轴独立选择、组合生效；isDshtRpAgentComposition`,
      `# 以本组结构为源码级特征锚点（改名派生预设仍被识别）。`,
      `- id: ${DSHT_RP_CAPABILITY_GROUP_ID}`,
      `  name: cordis:group`,
      `  config:`,
      `    - id: skill-filesystem`,
      `      name: '@deepseek-ai/dsh-skill-filesystem'`,
      ``,
      `    - id: tool-skill`,
      `      name: '@deepseek-ai/dsh-tool-skill'`,
    ]
    : []
  // direct 路径保持平铺旧形态（无 agent 循环，tool-skill 无意义；世界书 skill 读取 =
  // knowledge.books 关联书以 skill 形式挂载）；agent 路径的 skill 挂载在能力轴组内。
  const directSkillRows = preset.path === 'agent'
    ? []
    : [
      ``,
      `# 世界书 skill 读取（knowledge.books 关联书以 skill 形式挂载）`,
      `- id: skill-filesystem`,
      `  name: '@deepseek-ai/dsh-skill-filesystem'`,
      ``,
    ]
  const agentYml = [
    `# DSHTavern RP 预设（编译产物，源自 preset.json「${preset.id}」——勿手改，改表层后重新编译）`,
    `# ${AGENT_COMPACT_PERSONA_MARKER}`,
    `- id: persona`,
    `  name: '@deepseek-ai/dsh-persona'`,
    `  config:`,
    `    text: |-`,
    ...personaText.split('\n').map(l => (l === '' ? '' : '      ' + l)),
    `    complete: true`,
    `    includeRuntimeContext: false`,
    ...agentRows,
    ...directSkillRows,
  ].join('\n')

  const presetYml = [
    `name: ${preset.displayName}`,
    `description: RP 预设 · ${preset.path} 路径 · ${preset.toggles.length} 开关组${preset.knowledge.books.length ? ` · 关联书 ${preset.knowledge.books.join('/')}` : ''}`,
    `order: 100`,
    ``,
  ].join('\n')

  return [
    { path: `.agent-presets/${preset.id}/agent.cordis.yml`, content: agentYml },
    { path: `.agent-presets/${preset.id}/preset.yml`, content: presetYml },
  ]
}

// ---------------------------------------------------------------------------
// P1#6 双轴分离：RP 能力组合的识别（对照 dsh-agent-rp agent-capability-preset.ts）
// ---------------------------------------------------------------------------

/** 能力轴组的 loader entry id（isDshtRpAgentComposition 的源码级特征锚点） */
export const DSHT_RP_CAPABILITY_GROUP_ID = 'preset-capability'

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
export function isDshtRpAgentComposition(source: string): boolean {
  const normalized = source.replace(/\r\n?|\n/gu, '\n')
  const groupRow = new RegExp(`(?:^|\\n)[ \\t]*-[ \\t]*id:[ \\t]*${DSHT_RP_CAPABILITY_GROUP_ID}[ \\t]*(?:#.*)?(?:\\n|$)`, 'u')
  const pluginRow = (pkg: string): RegExp =>
    new RegExp(`(?:^|\\n)[ \\t]*name:[ \\t]*(?:['"])?@deepseek-ai/${pkg}(?:['"])?[ \\t]*(?:#.*)?(?:\\n|$)`, 'u')
  return groupRow.test(normalized)
    && pluginRow('dsh-tool-skill').test(normalized)
    && pluginRow('dsh-persona').test(normalized)
}
