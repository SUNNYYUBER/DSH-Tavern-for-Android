# SillyTavern 数据格式要点（迁移必读）

数据源实测：TauriTavern/ST 1.12+ 多用户结构（`data/<用户名>/` 为数据根）。

## 角色卡 PNG（tEXt 块）

- 卡 JSON 存在 PNG 的 `tEXt` chunk：keyword `chara`（V1/V2）或 `ccv3`（V3），value 是 base64。
- 解析：顺序读 PNG chunk（8 字节长度+类型头），找 `tEXt`，按 `\0` 分 keyword/value，base64 解码得 JSON。
- V2 结构：`{spec:"chara_card_v2", spec_version:"2.0", data:{name, description, personality, scenario,
  first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings[],
  tags[], creator, character_version, extensions{...}}}`。V1 是平铺（无 data 包装）。
- `data.extensions` 有价值子树：`world`（外部世界书引用名）、`depth_prompt{prompt,depth,role}`、
  `regex_scripts[]`（内嵌正则）、`character_book`（内嵌世界书，lorebook 结构）、`talkativeness` 等。
- 卡内 `name` **不一定等于 PNG 文件名**；chats 目录名 = PNG 文件名（去 .png）。
  归属匹配必须三键兜底：卡内 name / PNG 文件名 / 归一化 name（去空格+小写）。
- `characters/<名字>/` 子目录是表情差分图集，不是卡。

## 聊天 .jsonl

- 逐行 JSON。**首行是元数据头**：`{user_name, character_name, create_date, chat_metadata}`。
- `chat_metadata` 有价值字段：`variables`（MVU 变量树——必须迁到 dsht-mvu）、
  `last_user_persona`（该聊天用的 persona）、绑定的世界书名等。
- 后续行是消息：`{name, is_user, is_system, mes, send_date, swipes[], swipe_id, extra{}}`。
  - `is_system:true` 跳过；`mes` 为空跳过。
  - `swipes` 是该 assistant 消息的全部候选，`swipe_id` 指当前选中；`extra.is_ejs_processed`
    标记 = ST-Prompt-Template 已渲染过的产物（保持原样，不要再渲染）。
  - `send_date` 形如 `"August 19, 2025 11:23pm"`（Date.parse 可解）。

## settings.json（全局设置）

- `main_api`（如 `openai`）+ `oai_settings.chat_completion_source`（custom/openai/deepseek/claude…）
  + `oai_settings.custom_url` / `reverse_proxy` / `custom_model` / `openai_model` / `deepseek_model`…
  → API 配置迁移的输入（已由 `/dsht-rp/rp/import-api-config` 封装，不要手工解析）。
- `power_user.personas` / `power_user.persona_descriptions` / `power_user.default_persona`
  ——persona 在这三处（**不在**顶层 persona_descriptions）。
- `preset_settings_openai`：当前选中的 ST 预设名。
- `world_info_settings.world_info.globalSelect`：全局启用书单（书名数组）。
- `world_info_settings` 里的 scanDepth / budget / matchWholeWords 等 → rp.json trigger 默认值参考。
- `extension_settings` 有价值子树（40+ 键，逐个判断）：
  - `mvu_settings`（MVU 变量框架全局设置 + 状态栏渲染配置）→ dsht-mvu settings/statusbar
  - `tavern_helper`（酒馆助手：变量作用域数据、脚本仓库）→ dsht-tavern-helper variables/scripts
  - `EjsTemplate`（提示词模板的 EJS 模板文本）→ dsht-prompt-template
  - `regex`（全局正则脚本）→ `rp/regex/global.json`（`{scripts:[...]}`）
  - `quickReply`、`vectors_enhanced`、`variables` 等 → 见 st-plugins-assessment.md 分级

## secrets.json

- `{api_key_<source>: [{value, active}, ...]}`——数组形态，active=true 的是当前密钥；
  旧版可能是裸字符串。常见键：`api_key_custom`、`api_key_deepseek`、`api_key_openai`、`api_key_claude`。

## ST 预设（OpenAI Settings/*.json）

- `prompts[]`：全部提示词条目（`{name, identifier, role, content, ...}`）。
- `prompt_order[]`：按角色上下文分组的顺序表（如 character_id 100001 的 `order` 数组），
  每项 `{identifier, enabled}`——**组结构与开关态都在这里**，是 RPPreset.toggles 重建的输入。
- `extensions.regex_scripts`：预设作用域正则。
- 导入走 `dsht-rp preset/import-st {json, name}`（路由内重建开关组），不要手工转。

## 世界书（worlds/*.json）

- `{entries: [{uid, key[], keysecondary[], comment, content, constant, selective, position, depth,
  order, disable, excludeRecursion, preventRecursion, probability, ...}]}`（也可能是对象表形态）。
- position：0=顶部(before) 1=底部(after) 4=按深度注入（配 depth/role）。
- 目标形态 `skills/wb-<slug>/references/lore.json` 的结构化字段：`{name, entries:[{id, comment,
  content, keys[], secondaryKeys[], constant, position, depth, order, enabled, excludeRecursion,
  preventRecursion, probability}]}`。
