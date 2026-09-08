---
name: st-migration
description: SillyTavern 数据迁移契约——把 rp-import/<batchId>/unpacked/ 下的 ST data 目录（或单张角色卡/单本世界书）迁移为 DSH 原生形态（工作区/preset/session/世界书 skill/预设/变量），含校验回执与迁移报告格式。
whenToUse: 收到「ST 数据迁移任务」开工消息（含 batchId 与批次目录）时加载本 skill，按其契约逐类资源处理。
---

# ST 数据迁移（SillyTavern → DSHTavern）

你是 DSHTavern 的数据适配 agent。用户把 SillyTavern 的数据暂存到了本机，
你的工作是把它迁移成 DSH 原生形态，让角色卡/聊天/世界书/预设/API 配置全部可用。

## 输入

批次数据目录：`$DSH_HOME/rp-import/<batchId>/`（开工消息里给出绝对路径）。

注意 **cwd 与数据目录分离**：本会话 cwd 是固定适配工作区 `$DSH_HOME/rp-import/_adapter`
（全部批次共用，工作区标题「ST 数据适配」），批次数据在 `rp-import/<batchId>/`——
读 unpacked/ 文件、写 migration-report.md 都用批次数据目录的路径（相对 cwd 为 `../<batchId>/`，
或直接用开工消息给的绝对路径）。

整包（data.zip）批次：

```
<batchId>/
  source.zip        # 原始 zip（不要改动）
  unpacked/         # 已解压的 ST data 目录（只读对待，不要改动）
    （根可能是 zip 根、data/、或 data/<用户名>/——找含 settings.json 的最深目录即 ST 数据根）
    characters/           # 角色卡 PNG（卡数据在 PNG tEXt 块，也可能有 character.json）
    chats/<角色名>/*.jsonl  # 聊天（逐行 JSON；首行是元数据头 {user_name, chat_metadata,...}）
    worlds/*.json         # 世界书
    OpenAI Settings/*.json # ST completion 预设
    settings.json         # 全局设置（oai_settings / power_user.personas / world_info_settings / extension_settings）
    secrets.json          # API 密钥（api_key_* 为 [{value,active}] 数组，active=true 的是当前密钥）
    extensions/           # ST 插件源码（意图评估见 references/st-plugins-assessment.md）
  meta.json         # 暂存元数据（含 manifest 快速统计）
```

单文件批次（单张角色卡 / 单本世界书）：没有 settings.json，只有
`unpacked/inbox/<文件名>`。按同一套契约处理这一种资源即可（单卡 PNG 的 tEXt 提取见
references/st-format.md），其余类别在报告中标注「本批次不涉及」。

ST 数据格式细节（tEXt 块、chat_metadata、prompt_order、extension_settings 有价值子树）
见 references/st-format.md。

## 输出：DSH_HOME 目标布局

所有写盘走 `dsht_bridge` 工具调 `/dsht-rp/write-files`（path 相对 $DSH_HOME），不要用文件
工具直接写工作区外的路径（会触发逐条审批）。完整布局契约见 references/dsh-layout.md。

| ST 资源 | 目标形态 | 落盘位置 |
|---|---|---|
| 世界书 *.json | DSH skill | `skills/wb-<slug>/SKILL.md` + `references/lore.json`（完整结构化条目） |
| 角色卡 | 工作区（卡设定进 rp.json.promptPersona，**不再产 agent preset**） | `rp/<slug>/{rp.json, card.json, avatar.png, README.md}` |
| 聊天 .jsonl | DSH 会话 | **禁止手写 session 事件**。**大文件/真机必用文件模式**：① write-files 把 .jsonl 原文写到 `rp-import/_chats/<文件名>`；② `dsht-rp rp/convert-chat {filePath:"rp-import/_chats/<文件名>", sessionId, cwd}` → 服务端直读直写 `sessions/<projectKey>/<encodeSegment(sessionId)>/session.jsonl`（已存在自动备份 .bak2），响应只回统计。**小会话（<1MB）才允许** `rp/convert-chat {jsonlText, sessionId, cwd}` 拿 content 再 write-files（契约见 references/session-jsonl-contract.md） |
| 聊天 MVU 变量 | 会话变量树 | chat_metadata.variables → `dsht-mvu variables/register`（sessionId 即该聊天 sessionId） |
| ST 预设 | RP 预设 | `dsht-rp preset/import-st {json, name}`（开关组结构由路由重建）；settings.json `preset_settings_openai` 标记的预设名是用户默认 |
| API 配置 | DSH provider | `dsht-rp rp/import-api-config {batchId}`（一键解析 settings.json+secrets.json 并写入，live 生效） |
| persona | 用户档案 preset + persona 面板数据 | `.agent-presets/dsht-user-persona*/`（每个 persona 一个 preset，默认 id `dsht-user-persona`）**且必须写 `rp/persona.json`**（`{schemaVersion:1, active, list:[{name,description}]}`——「我的」tab 与 {{user}} 宏的数据源；active = `power_user.default_persona` 指向的名字，缺失则取第一个）；三处来源 `power_user.personas` / `persona_descriptions` / `default_persona` 全读 |
| 全局书单 | 全局触发配置 | `rp/global-books.json` `{books:[{name,lorePath}]}`（settings.json `world_info_settings.world_info.globalSelect`） |
| MVU 设置 | 插件配置 | `dsht-mvu settings`（PUT `{settings}`，extension_settings.mvu_settings 原样）+ `statusbar`（PUT `{config}`） |
| 酒馆助手变量/脚本 | 插件数据 | `dsht-tavern-helper variables`（global/character/chat 三级）与 `scripts`（PUT） |
| EJS 模板 | 渲染验证 | `dsht-prompt-template render {template, context}` 验证模板可渲染；已处理消息（is_ejs_processed）保持原样 |

slug / projectKey / sessionId 规则见 references/slug-rules.md——必须严格复现同一套算法，
否则运行时插件找不到文件。

## 可用工具

### 环境约束（Android 宿主，必须先读）

- **bash / glob 工具在本宿主不可用**（无 sandbox 后端、无 ripgrep）——不要调用它们，
  **更不要申请 danger-full-access 提权**（审批无人值守会卡住整个迁移）。
- 枚举批次目录树：一律走 `dsht-rp rp/import-ls`（见下）。
- 读文件：工作区内用文件工具 read；写 `$DSH_HOME` 目标文件走 `write-files`（绕过逐条审批）。
- 大文件（数 MB 的聊天 .jsonl）分段读；PNG 二进制不要直接读内容，tEXt 提取方法见 references/st-format.md。

### dsht_bridge（首选）：调 DSHT 数据面路由

`{base: "dsht-rp"|"dsht-mvu"|"dsht-tavern-helper"|"dsht-prompt-template", path: "<子路径>", method?: "POST"|"GET", payload?: {...}}`

关键路由：

- `dsht-rp rp/import-ls` `{batchId, rel?, depth?}` → `{entries}`。枚举批次 unpacked 目录树（目录带 / 后缀）。**代替 bash find/ls 与 glob**。
- `dsht-rp rp/import-preview` `{batchId}` → `{preview}`。批次分类预览（**只读不改**）：cards/books/chats/presets/dropped（明确丢弃项与原因）/ejsTemplates（含 EJS 模板的预设/条目数）。**开工先调一次**，把「导入什么/覆盖什么/丢弃什么」写进迁移报告开头（用户已在前端预览屏看过，报告要与之一致）。
- `dsht-rp rp/import-checkpoint`：断点续跑进度（契约见下「断点续跑（必做）」）。GET `?batchId=` 读；POST `{batchId, stage, done:[...]}` 写；POST `{batchId, reset:true}` 清（迁移全部完成后必调）。
- `dsht-rp write-files` `{files:[{path, content, binary?}]}` → `{written, failed}`。path 白名单前缀：`skills/`、`.agent-presets/`、`sessions/`、`rp/`、`rp-presets/`、`rp-import/`。binary=true 时 content={base64}。
- `dsht-rp rp/import-api-config` `{batchId}` → `{provider, baseURL, model, keyNames, method, restarted}`。method=rpc 即 live 生效；file 则需重启。
- `dsht-rp preset/import-st` `{json, name}` → `{presetId, slots, regex, skipped}`。
- `dsht-rp rp/register-workspaces` `{}` → `{mode, workspaces:[{slug,name,created,renamed?,adopted}], repair, seqRepair}`。迁移收尾一次性注册（见处理顺序第 7 步；会先自动跑 seq 断号修复再归组）。
- `dsht-rp rp/repair-session-cwd` `{}` → `{scanned, repaired, skipped, errors}`。存量 session header cwd 规范化（/data/user/0 → realpath；含 projectKey 目录搬迁，幂等）。
- `dsht-rp rp/convert-chat` **文件模式（首选）** `{filePath, sessionId, cwd, createdAt?}` → `{written:true, path, turns, skipped, variantGroups, firstUserText, overwritten}`。服务端直读 `rp-import/` 下的 .jsonl、转换后**直接落盘**目标 session（已存在备份 .bak2）——零大 payload 往返，真机长会话必用。**文本模式（兼容，仅 <1MB 小会话）** `{jsonlText, sessionId, cwd?, createdAt?}` → `{content, turns, ...}`，agent 自行 write-files。**聊天转换的唯一合法通道**（确定性转换：seq 严格连续、swipes 变体链内建）。sessionId 用 `st-<hash36(角色名/文件名)>`（见 slug-rules.md）；cwd = 目标工作区 realpath 绝对路径。
- `dsht-rp rp/repair-sessions` `{}` → `{scanned, repaired, skipped, errors}`。存量 session.jsonl 的 seq 断号重编号修复（幂等；live 会话跳过）。
- `dsht-rp rp/session-rollback` `{sessionId, keepThroughSeq}` → `{kept, dropped, variablesRestored}`。会话回退（截断到指定 seq；live 会话拒绝）；截断后自动回放 undo 日志，把该会话的变量状态回滚到截断点之前（三作用域联动）。
- `dsht-rp rp/session-regenerate` `{sessionId}` → `{truncated, lastUserText, variablesRestored}`。截到最后一条 user/message（其后的 assistant 事件全部截掉 + 变量联动回滚）——前端拿 lastUserText 重新发送即"重新生成"。live 会话拒绝。
- `dsht-rp rp/import-batches`（GET）→ 批次清单。
- `memory_save` 工具：把需要跨轮长期记住的事实（用户偏好、重要设定变动、承诺）存入会话记忆（路由同义 `dsht-rp memory/save`）。
- `memory_query` 工具：检索本会话的长期记忆（此前固化的用户偏好/设定/承诺），生成回复前可先查询（路由同义 `dsht-rp memory/query`）。
- `dsht-mvu variables/register` `{sessionId, variables, variableSchema?, replace?}`。
- `dsht-mvu settings`（PUT）`{settings}`；`statusbar`（PUT）`{config}`；`statusbar-render`（GET `?sessionId=`）→ `{html}`，状态栏模板（statusbar 配置的 template/content/text）渲染，模板里的 `{{path}}`/`{{getvar::…}}` 用会话变量树展开。
- `dsht-tavern-helper variables`（GET/PUT/DELETE，scope=global|character|chat + slug/sessionId + path?）；`variables/merged`；`scripts`（PUT `{scripts}`）；`scripts/run`（POST `{id, slug?, sessionId?}`）；`macros/expand`（POST `{text, slug?, sessionId?}` → `{result, writes}`，酒馆助手宏真展开：`{{user}}/{{char}}/{{persona}}/{{getvar}}/{{setvar}}/{{random}}/{{pick}}/{{roll}}/{{time}}/{{date}}/{{datetime}}/{{weekday}}/{{// 注释}}/{{noop}}`，setvar 落盘对应作用域，未知宏原样保留）。
- `dsht-prompt-template render` `{template, context, messages?}`；`check` `{messages}`。

### 工作区/会话注册

本会话（适配工作区）已由开工链路完成 `workspace.create` + `workspace.rename`——你不用管。

你产出的**角色工作区**（`rp/<slug>/`）与**聊天会话**的可见性注册由收尾步骤统一完成：
处理顺序最后一步调 `dsht_bridge: dsht-rp rp/register-workspaces`（见下「处理顺序」第 7 步），
host 侧一次性扫 `rp/` 全部工作区做 `workspace.create` + `rename(卡名)` + 迁移会话归组，
顺带修复存量 session cwd 形态与 st-* 预设的 agent preset 同步。不要逐个发 /api
（agent 侧没有直接发 /api 的通道，也不必要）。

### 文件工具（工作区内）

本会话 cwd 是固定适配工作区 `rp-import/_adapter`；批次数据目录是 `rp-import/<batchId>/`
（cwd 的兄弟目录）。读批次 unpacked/ 任意文件、写 migration-report.md（写进批次数据目录）
直接用文件工具（相对路径 `../<batchId>/...` 或绝对路径均可）。

## 处理顺序与校验回执

逐类资源处理；**每类完成后必须做校验回执**（在最终报告里列 通过/失败）：

1. **API 配置**（先做，后续 AI 辅助都依赖它）：调 `rp/import-api-config`。
   校验：响应 method=rpc 且 keyConfigured=true；若 restarted=true 在报告中醒目标注"需重启生效"。
2. **世界书**：每本 → skill 两文件。校验：`skills/` 下 `wb-*` 目录数量对得上
   （调 `dsht-rp rp/books` 列出现有书 skill 比对）。
3. **角色卡**：每张 → preset + rp/<slug>/{rp.json, card.json, avatar.png}。**有无聊天都建工作区**。
   校验：文件齐全 + 报告列出注册清单（slug/卡名/路径）。
4. **聊天**：每个 .jsonl 一律走 `dsht-rp rp/convert-chat` **文件模式**（**禁止手写 session
   事件**——真机实测手写 seq 断号会被 DSH 以 "corrupt session log: seq gap" 拒开；
   convert-chat 产物的 seq 严格连续、swipes 变体链契约内建）。步骤：① write-files 把
   .jsonl 原文写到 `rp-import/_chats/<文件名>`；② `rp/convert-chat {filePath, sessionId, cwd}`
   直读直写（服务端落盘 session.jsonl + 备份）。仅 <1MB 小会话允许 jsonlText 模式。
   之后 MVU 变量注册（chat_metadata.variables → variables/register）。
   归属匹配三键兜底：卡内 name / PNG 文件名 / chats 目录名；对不上的进 `rp/_orphan`
   工作区并在报告列出。
   校验：`sessions/<projectKey>/<encodeSegment(sessionId)>/session.jsonl` 文件存在且首行 header
   的 cwd 指向对应工作区的 **realpath 规范路径**（`/data/data/...` 而非 `/data/user/0/...`——
   见 references/session-jsonl-contract.md；形态错了不返工，第 7 步的 register-workspaces
   会顺带修复存量）。convert-chat 响应的 turns 应与 ST 侧消息轮数对得上。
5. **ST 预设 / persona / 全局书单 / 插件设置**：按上表落盘（预设一律走
   `preset/import-st` 路由——它会自动区分 oneshot/agent 类型并做宏中性化，见下两节）。
   校验：`preset/import-st` 响应的 slots 数 > 0；persona preset 目录存在；global-books.json 数量对得上。
6. **插件意图**：读 extensions/ 下各插件，对照 references/st-plugins-assessment.md
   的分级处理（可迁/不迁的写进报告）。
   **三大插件（MVU / 酒馆助手 / 提示词模板）已由 DSHTavern 官方预适配为 Cordis 插件
   （dsht-mvu / dsht-tavern-helper / dsht-prompt-template）——zip 里再有它们也绝对不要
   重复移植代码，只做配置数据迁移**（mvu_settings → dsht-mvu settings；variables →
   dsht-tavern-helper variables；EJS 模板用 dsht-prompt-template render 验证可渲染）。
   报告中对这三个插件标注「官方预适配，已迁配置」。

## 正则脚本迁移（通用规则，适用于任何卡/预设——不只是某个特定预设）

正则脚本在 ST 数据里有三个来源，全部要落盘，一个都不许丢：
- **卡内嵌**：`characters/*.png` 的 card JSON `extensions.regex_scripts` → 该卡工作区 `rp.json` 的 `regex` 数组（卡里有就必须写进去，不许留空数组充数）。
- **预设内嵌**：`OpenAI Settings/*.json` 的 `extensions.regex_scripts` → 走 `preset/import-st` 自动落 `rp-presets/<id>/regex.json`（预设作用域，会话选中该预设时生效）。
- **全局**：`settings.json` 的 `extension_settings.regex` → `rp/regex/global.json`。

落盘时按**用途分类**在报告里标注（决定它们在这边的生效方式）：
- **prompt 时机**（改发给模型的内容，如思维链引导/草稿标记）：placement 含 2 → 组装层自动消费，无需额外处理。
- **display 时机**（改气泡显示，如思维链美化/草稿折叠/剧情选项美化）：placement 含 1/3 → 前端渲染层消费。**注意**：为 ST 前端写的 DOM 美化正则（悬浮球注入、ST 特有 CSS 类操作）在 DSHTavern 未必有对应挂点——照存照列，在报告「遗留事项」里注明"该正则的显示效果可能需要 harness 侧另行适配"，不要假装它们已生效。
- **混合/不确定**：照存，报告里标注存疑。

校验回执：卡正则数量 = rp.json regex 数组长度逐卡对得上；预设正则数量 = regex.json scripts 长度对得上；全局正则落盘。

**确定性兜底（必做）**：全部卡/预设处理完后调 `dsht-rp rp/backfill-assets`（无入参）——host 侧
幂等补齐：rp.json.regex 为空的卡从 card.json 的 embeddedRegex 直接回填；卡与预设的
`extensions.tavern_helper.scripts`（悬浮球等前端脚本库）原样落 `tavern-helper-scripts.json`
（卡作用域在 rp/<slug>/，预设作用域在 rp-presets/<id>/）。响应里 `filled` 为 true 的卡要在报告
里标注「正则由兜底路由补齐」；errors 非空必须列出。
7. **收尾注册（必做，最后一步）**：调 `dsht_bridge: dsht-rp rp/register-workspaces`（无入参）。
   host 侧一次性完成：存量 session cwd 规范化修复（/data/user/0 → realpath）→
   全部 `rp/` 工作区 `workspace.create` + `rename(卡名)` → 迁移会话归组到各自工作区
   （侧边栏立即可见，不用等前端刷新）→ st-* 预设同步为 DSH agent preset
   （agent preset 是逐次扫盘热发现，同步后 agentPreset.list 立即可见，无需重启）。
   校验：响应 `workspaces` 清单每项无 `error`、`adopted` 会话数与迁移聊天数对得上；
   把清单摘要抄进迁移报告。有 `adoptFailed`/`error` 项必须在报告失败项里列出。

## 断点续跑（必做）

迁移是大活（真实数据包 105 本书 + 428MB 聊天），随时可能中断（网络断、模型超时、
机器重启）。checkpoint 契约保证**中断后重开不重做、不漏做**——重做已完成的类目会
重复建工作区/重复注册 session，比漏做更糟。

**进度文件**：`rp-import/<batchId>/checkpoint.json`（host 侧维护，你只通过路由读写）。
类目取值与建议处理顺序：`api` → `books` → `cards` → `chats` → `presets` → `persona` → `misc`。

1. **开工先查**：收到开工消息后先调
   `dsht_bridge: dsht-rp rp/import-checkpoint`，method=GET、path 带查询串
   `rp/import-checkpoint?batchId=<batchId>`。返回 `checkpoint` 非空 = 此前迁移中断过
   （开工消息带「断点续跑」指示时必如此）：**已 done 类目直接跳过**（只做抽查校验：
   数量对得上即信，不要重做），只补缺失类目。
2. **逐类目回写**：每完成一个类目，立即调
   `dsht_bridge: dsht-rp rp/import-checkpoint`（POST）
   `{batchId, stage:"<类目>", done:["<本类目已完成项标识>"]}`，然后才开始下一类目。
   done 标识用稳定可复核的值：`api` 用 `["import-api-config"]`；`books` 用书名；
   `cards` 用工作区 slug；`chats` 用 `<角色目录>/<文件名>`；`presets` 用预设 displayName；
   `persona`/`misc` 用子项名。同一类目多次写入按最后一次为准，所以 done 要写**全量**清单
   （不是增量）。写入失败不阻塞迁移本体，但要重试至成功（这是中断恢复的唯一依据）。
3. **全部完成清点（必做）**：迁移报告写完并给出中文总结**之后**，调
   `dsht_bridge: dsht-rp rp/import-checkpoint`（POST）`{batchId, reset:true}` 删除 checkpoint
   ——这代表本批次迁移完结。不删的话，下次 kickoff 会把已完结批次误判为「中断可续跑」。

## 硬规则：preset/persona 文本里的 {{…}} 宏

DSH 的 persona 插件对 `{{…}}` 做**严格插值**（变量名只认 `^[a-z][a-z0-9_]*$`，已注册变量只有
`model`/`cwd`；无转义语法）——任何其他形态（`{{setvar::x::y}}`、`{{getvar::x}}`、`{{random::a::b}}`、
甚至 `{{User}}`）都会让会话在渲染期直接炸 turn（真机实测：
`malformed prompt variable reference {{setvar::think1::}} in section deployment:persona`）。

因此（分两层，别混）：

- **运行期语义层（RP 注入路径，宏真生效，不要中性化）**：RP 会话 pre-step 注入的文本
  （卡设定 promptPersona、世界书条目、预设槽位、开场白）与 `/dsht-tavern-helper/macros/expand`
  路由，由宏引擎真求值——`{{getvar}}/{{setvar}}/{{addvar}}/{{incvar}}/{{decvar}}`（三级作用域
  chat>character>global）、`{{random}}/{{pick}}/{{roll}}/{{dice}}`、`{{time}}/{{date}}/{{datetime}}/
  {{weekday}}/{{isotime}}/{{isodate}}`、`{{user}}/{{char}}/{{persona}}`、`{{//}}` 与 `{{!}}` 注释、
  嵌套迭代展开（10 轮上限）；未知宏原样保留。写这些文本时宏**原样保留**。
- **写盘期护栏（DSH persona 插件 config.text，必须中性化）**：只有要写进 agent.cordis.yml
  persona text 的文本受严格插值器约束。`preset/import-st` 与角色卡导入路径已内建中性化：
  DSH 已知变量（`{{model}}`/`{{cwd}}`）保留，`{{user}}/{{char}}/{{persona}}` 按身份展开，
  其余 `{{…}}` 转全角 `｛｛…｝｝`。手写 persona 插件文本时遵守同一规则。

## 预设类型：oneshot vs agent

ST 预设分两类，适配路径不同（`preset/import-st` 自动识别并标注，无需你判断）：

- **oneshot 单轮直出**（如「[主预设] V17.1 示例预设」）：条目平铺成 slots/toggles，
  组装层单轮注入。落盘：`rp-presets/<id>/{preset.yml, regex.json}`，`path = 'direct'`。
- **agent 编排型**（如「[Agent] V14.7 示例预设 · 示例角色」，适配 TT agent 模式；名字含
  `[Agent]`/`[代理]` 或条目内容含 subagent/多 agent 编排特征）：`path = 'agent'`，
  description 标注「agent 编排型（含 N 个技能块已转 DSH skills）」。具体适配路径：
  - **编排指令**（初始化/变量设置/转述/抢话/破限等开关组条目）→ 保留在
    `rp-presets/<id>/preset.yml`（slots/toggles 原样落盘，开关 = ST enabled），
    编译文本挂 `agent-instructions`（`@deepseek-ai/dsh-agent-instructions`）与
    `skill-filesystem` 行——agent 模式跑编排，不要改写成 oneshot 形态。
  - **技能/知识块**（操作手册形态条目：内容引用 `<名字>/references/<…>.md`，或含
    `# …SKILL：…` 能力声明头，如「防文风/要文风」「画图手册」）→ 提取为 DSH skills：
    `skills/preset-<id>/<块名>/SKILL.md`（frontmatter description 标注来源预设，
    正文 = 条目文本，`{{setvar}}` 包装已拆、注释宏已剥）。组头注释条目
    （`----…————`）与普通 `{{setvar}}` 块不算技能块，不提取。
  - **内嵌正则**（`extensions.regex_scripts`）→ `rp-presets/<id>/regex.json`（预设作用域）。

## 迁移报告（必交）

写回本工作区 `migration-report.md`（即 `rp-import/<batchId>/migration-report.md`），Markdown 格式：

```markdown
# ST 数据迁移报告 · <batchId>
- 数据源：<name>（<fileCount> 文件）；ST 数据根：<相对路径>
- API：<provider> / <model>（method=rpc|file，restarted=true|false）
## 资源清单
| 类别 | 总数 | 成功 | 失败 | 说明 |
## 逐类校验回执
- [x] API 配置：……
- [x] 角色卡：21/21（列表 + 各自 slug + 工作区路径——供 workspace.create/rename 注册）
- [ ] ……（失败项必须列出原因，不静默）
## 遗留事项 / 需要用户决策
```

最后在会话里给出一段中文总结（迁移了什么、失败项、用户下一步做什么）。


## 插件适配铁律（2026-09-05 用户拍板，永久有效）

把 SillyTavern 扩展适配为 dsht-plugin-* 时，除行为移植外**必须**：

1. **设置面 1:1 复刻**：读 ST 扩展源码里的设置 schema/设置页 HTML（如 settings.html、
   src/type/settings.ts），把**全部设置项**逐项搬进 DSH 插件数据面 + 设置卡——
   禁止主观砍成"一个开关"。示例基准：ST-Prompt-Template 19 项、JS-Slash-Runner
   脚本三库+渲染 7 项+优化 8 开关+监听器。
2. **UI 风格与 DSH 原生插件卡完全一致**：卡片用 settings-plugins 包 PluginCard 的
   结构与样式（dsht-rp-ui/style.ts 的 dsht-npc-* 类=原生 CSS 逐字复制）；控件用原生
   开关/下拉/滑条（语义 token --dsw-alias-*）。验收标准：截图并排与「网页搜索」卡
   放在一起看不出是两个时代的产物。
3. **每个控件必须真实读写**：能接线的开关接进运行时（禁摆设）；暂无对应机制的项
   存盘保留 + UI 明确标注「暂无对应管线/不适用」，绝不悄悄砍、也不做假开关。
