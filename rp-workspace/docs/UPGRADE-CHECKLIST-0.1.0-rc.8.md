# DSH 升级检查单：→ 0.1.0-rc.8

> 由 upgrade-checklist.mjs 生成（AUDIT_TASKLIST §0.6）。生成时间 2026-09-05 10:01:53

## 一、npm 发布探测

- ⚠️ `@deepseek-ai/dsh@0.1.0-rc.8` npm 探测失败（未发布 / 网络不可达 / 私有源未登录）。按未发布处理，勿盲升。

## 二、契约快照 diff（最近两份）

- 跳过：contracts/ 下可用快照不足两份（现有 1 份）。先跑 capture-contracts.mjs。

## 三、运行时 stub 清单

- dsh-runtime-android @deepseek-ai 包（223 项）：cordis、cordis-plugin-group、cordis-plugin-hmr、cordis-plugin-include、cordis-plugin-loader、cordis-plugin-timer、cosmokit、dsh、dsh-acp、dsh-acp-app、dsh-agent、dsh-agent-default-model、dsh-agent-instructions、dsh-agent-loop、dsh-agent-presets、dsh-agent-tool-presentation、dsh-anonymous-user-id、dsh-api-gateway、dsh-api-remotes、dsh-api-session-controller、dsh-api-settings-controller、dsh-api-workspace-controller、dsh-app-boot、dsh-atomic-write、dsh-attachment、dsh-attachment-local、dsh-authorization、dsh-base、dsh-bash-local、dsh-bash-sandbox、dsh-brand、dsh-client-connection、dsh-client-hmr、dsh-client-locale、dsh-client-modules、dsh-client-ui-agent-preset、dsh-client-ui-approval、dsh-client-ui-attachment、dsh-client-ui-brand-official、dsh-client-ui-chat、dsh-client-ui-commands、dsh-client-ui-conversation、dsh-client-ui-cordis、dsh-client-ui-deliverables、dsh-client-ui-directory-picker-browse、dsh-client-ui-directory-picker-native、dsh-client-ui-goal、dsh-client-ui-input-trigger、dsh-client-ui-jobs、dsh-client-ui-layout、dsh-client-ui-message-feedback、dsh-client-ui-model-selection、dsh-client-ui-permission-presets、dsh-client-ui-plan、dsh-client-ui-reference、dsh-client-ui-renderer、dsh-client-ui-schedule、dsh-client-ui-session、dsh-client-ui-settings、dsh-client-ui-settings-general、dsh-client-ui-settings-models、dsh-client-ui-settings-plugin-inventory、dsh-client-ui-settings-plugins、dsh-client-ui-sidebar、dsh-client-ui-skill、dsh-client-ui-subagent、dsh-client-ui-theme、dsh-client-ui-tool、dsh-client-ui-trajectory、dsh-client-ui-user-questions、dsh-client-ui-workflow-run、dsh-client-ui-workspace、dsh-cmdline、dsh-code-runtime、dsh-code-runtime-worker-thread、dsh-command-compact、dsh-command-feedback、dsh-command-goal、dsh-commands、dsh-compaction、dsh-compaction-basic、dsh-compaction-tool-result-pruner、dsh-cordis-client-runner、dsh-cordis-host-runner、dsh-credentials、dsh-credentials-local、dsh-deepseek-llm-api-extensions、dsh-deque、dsh-file-reference、dsh-file-reference-local、dsh-fs、dsh-fs-local、dsh-fs-observation-policy、dsh-fs-sandbox、dsh-goal、dsh-goal-round-driver、dsh-headless、dsh-home-paths、dsh-hook-protocol、dsh-hooks-claude-code、dsh-hooks-codex、dsh-host-directory-picker、dsh-host-directory-picker-auto、dsh-host-directory-picker-browse、dsh-host-directory-picker-native、dsh-host-frontend-static、dsh-host-plugin-inventory、dsh-host-webserver、dsh-invariants、dsh-jobs、dsh-jobs-local、dsh-launch-environment、dsh-llm、dsh-llm-deepseek、dsh-llm-pi-ai、dsh-llm-retry、dsh-mcp-client、dsh-message-feedback、dsh-native-command、dsh-output-retention、dsh-permission-presets、dsh-persona、dsh-plan-mode、dsh-plugin-package-inventory-deepseek、dsh-pwsh-local、dsh-pwsh-sandbox、dsh-repeat-tool-reminder、dsh-sandbox、dsh-sandbox-local、dsh-sandbox-policy、dsh-sandbox-windows-acl、dsh-schedule、dsh-scope、dsh-sdk-app、dsh-sdk-jsonrpc-server、dsh-sdk-minimal、dsh-sdk-protocol、dsh-session、dsh-session-checkpoint-policy、dsh-session-log-deepseek、dsh-session-log-export、dsh-session-persistence、dsh-session-persistence-jsonl、dsh-session-projection、dsh-session-projection-cache、dsh-session-query、dsh-session-query-sqlite、dsh-session-reference、dsh-session-stats、dsh-session-telemetry、dsh-session-telemetry-otel、dsh-session-title、dsh-session-title-first-prompt-llm、dsh-session-title-llm、dsh-session-turn-outline、dsh-settings、dsh-settings-file、dsh-shell、dsh-shell-env、dsh-skill、dsh-skill-badge、dsh-skill-filesystem、dsh-spill、dsh-spill-local、dsh-spill-policy、dsh-storage、dsh-storage-domain、dsh-storage-json、dsh-subagent、dsh-subagent-fork-in-process、dsh-subagent-in-process-driver、dsh-subagent-spawn-in-process、dsh-subprocess、dsh-subprocess-local、dsh-system-prompt、dsh-terminal、dsh-terminal-bash、dsh-time-context、dsh-timeout、dsh-tmux-context、dsh-token-meter、dsh-tool-ask-user、dsh-tool-bash、dsh-tool-bash-persistent、dsh-tool-call-timeout-policy、dsh-tool-cordis、dsh-tool-fs、dsh-tool-fs-search、dsh-tool-goal、dsh-tool-jobs、dsh-tool-pwsh、dsh-tool-pwsh-persistent、dsh-tool-ralph、dsh-tool-skill、dsh-tool-str-replace-editor、dsh-tool-subagent、dsh-tool-subagent-control、dsh-tool-todo、dsh-tool-web、dsh-tool-workflow、dsh-tools、dsh-typert-loader、dsh-typert-protocol、dsh-typert-registry、dsh-user-approval、dsh-user-questions、dsh-util-crypto、dsh-util-time、dsh-util-values、dsh-util-workspace-path、dsh-web、dsh-web-app、dsh-web-fetch-http、dsh-web-frontend、dsh-web-search-deepseek、dsh-webhook、dsh-webhook-github、dsh-win32-process、dsh-workflow、dsh-workflow-worker-thread、dsh-workspace、node-addon-landlock-run、schemastery
- stubs/ 本地 stub（7 项）：dsh-sandbox-windows-acl/、dsh-tool-fs-search/、koffi/、node-addon-landlock-run/、node-addon-require-builtin/、node-pty/、sharp/

## 四、AUDIT_TASKLIST 🔴/🟡 未闭合风险行

- > 状态标记：🔴 未做（壳子/缺失）　🟡 部分做（数据面有/机制未接线）　🟢 已完成（已实测）
- 4. **必须重验的机制**（对照 `AUDIT_TASKLIST.md` 的 🔴/🟡 项，哪些在升级后需要重新实测）。
- **状态**：🔴 未做（0.1-0.6 全部）
- | B2 | 生成处理（generate_enabled，生成期模板求值） | 壳子（存盘未接线） | 生成期管线（`phase=generate` 门控已加，但调用方未传 phase） | 🟡 |
- | B3 | [GENERATE:BEFORE/AFTER] 世界书条目注入（generate_loader） | 壳子 | 世界书条目扫描+注入机制（ST `handleGenerateBefore/After`） | 🔴 |
- | B4 | @INJECT 世界书条目注入（inject_loader） | 壳子 | @INJECT 条目解析+定位注入（ST `inject-prompt.ts`） | 🔴 |
- | B6 | [RENDER:BEFORE/AFTER] 世界书条目注入（render_loader，状态栏挂载核心） | 壳子 | 渲染期世界书条目前后包裹（ST `handleMessageRender` 的 RENDER 注入） | 🔴 |
- | B7 | 处理 `<pre>` 代码块（code_blocks） | 壳子 | 渲染期代码块 escape/清理+模板处理 | 🔴 |
- | B8 | 处理原始消息内容（permanent_evaluation，render_permanent 写回） | 壳子 | 渲染结果永久写回消息原文 + `is_ejs_processed` 标记 | 🔴 |
- | B9 | 生成时忽略楼层模板语句（filter_chat_message） | 壳子 | 生成前注入 `<% %>` 过滤正则（ST `handleFilterInstall`） | 🔴 |
- | B11 | 自动保存（autosave_enabled） | 壳子（DSH 自动落盘，项保留标注） | 求值后 `saveChatConditional` 触发 | 🟡 |
- | B12 | 预载世界书（preload_worldinfo） | 壳子 | 开聊天时 InitialVariables/define 预执行（ST `handlePreloadWorldInfo`） | 🔴 |
- | B13 | 禁用 with 语句块（with_context_disabled） | 壳子 | EJS 编译 `with(){}` 开关（sandbox 引擎消费） | 🔴 |
- | B15 | Web Worker 编译（compile_workers） | 壳子 | Worker 编译模板（浏览器端） | 🔴 |
- | B17 | 世界书代码编辑器（code_editor） | 壳子 | Monaco 编辑器替换世界书内容框 | 🔴 |
- | B18 | 旧特性兼容（invert_enabled，条目禁用视为启用） | 壳子 | GENERATE/RENDER/INJECT 条目反义处理 | 🔴 |
- | B19 | 编译缓存（cache_enabled 0/1/2 + cache_size + cache_hasher） | 壳子 | ejs.cache 容量+hash 算法接线 | 🔴 |
- | C2 | 宏替换（macro.enabled，类宏系统） | 已接线（/macros/expand 关闭=透传） | 类宏全集：`getvar/setvar/incvar/decvar/get_message_variable/get_chat_variable/get_character_variable/get_preset_variable/get_global_variable/format_*_variable`（当前只有基础 getvar/setvar 等，`get_message_variable::stat_data` 被报 unknown） | 🔴 |
- | C3 | 渲染组 7 项（render.enabled/depth/depth_ignore_hidden/collapse_code_block/allow_streaming/use_blob_url/optimize_hljs） | 壳子（存盘+标注） | 前端渲染管线：`<pre>` 代码块→iframe（ST `store/iframe_runtimes/message.ts`）、流式渲染、代码块折叠、hljs 优化 | 🔴 |
- | C4 | 优化 8 开关（optimize.*：世界书/角色卡管线优化） | 壳子（存盘+标注） | disable_incompatible_option/better_message_to_load/better_character_update/export/deletion/force_recommended_worldbook/save_preset/maximize_preset_context_length（ST `panel/optimize/*`，强制改写核心设置） | 🔴 |
- | C5 | 脚本 iframe 沙箱（predefine.js 桥接，三级脚本库） | 未做 | 独立隐藏 iframe + `window.TavernHelper`/`YAML`/`z`/`showdown`/`EjsTemplate` 注入 + `SillyTavern.getContext()` 伪造 + `window.Mvu` 桥接 | 🔴 |
- | C6 | 事件系统封装（eventOn/eventEmit/eventMakeFirst/eventMakeLast，80+ 核心事件 + iframe_events） | 未做 | 事件名表 + 按 iframe 隔离的监听器注册/摘除 | 🔴 |
- | C7 | 六作用域变量域（message/chat/character/preset/global/script） | 数据面有（/variables GET/PUT/DELETE） | `insertOrAssignVariables`（深合并）、`registerVariableSchema`（zod 校验）、swipe 变量槽维护 | 🟡 |
- | C8 | injectPrompts（注入提示词，position/depth/role/filter/should_scan/once） | 未做 | 包装核心 `setExtensionPrompt`，支持注入/一次性注入 | 🔴 |
- | C9 | generate/generateRaw（脚本内 LLM 生成，流式/tool call/json_schema） | 未做 | `prepareOpenAIMessages` 调核心 + 流式 token 回推 + 独立配置 | 🔴 |
- | C10 | 世界书 API（worldbook*/lorebook*，条目 CRUD+绑定+全局设置） | 数据面有（/lorebooks） | `getLorebookEntries/replaceLorebookEntries/createLorebook/deleteLorebook/rebindGlobalWorldbooks/rebindCharWorldbooks/getOrCreateChatWorldbook/getLorebookSettings/setLorebookSettings` | 🟡 |
- | C11 | 预设 API（getPresetNames/getPreset/createOrReplacePreset/loadPreset/setPreset/updatePresetWith） | 数据面有（/presets） | `getPreset`（按 id 取单个）、`createOrReplacePreset`、`loadPreset`、`setPreset` | 🟡 |
- | C12 | 角色卡 API（CRUD + importRawCharacter + getChatHistoryBrief/Detail） | 数据面有（/characters） | `importRawCharacter`（JSON/PNG/charx 导入）、`getChatHistoryBrief/Detail` | 🟡 |
- | C13 | 聊天消息 API（getChatMessages/setChatMessages/createChatMessages/deleteChatMessages/rotateChatMessages） | 数据面有（/chat） | `setChatMessages`（批量写回）、`createChatMessages`（插入）、`deleteChatMessages`（删除）、`rotateChatMessages`（轮换） | 🟡 |
- | C14 | 正则 API（getTavernRegexes/replaceTavernRegexes/updateTavernRegexesWith/formatAsTavernRegexedString/isCharacterTavernRegexesEnabled） | 数据面有（/regexes） | `updateTavernRegexesWith`（合并更新）、`formatAsTavernRegexedString`（应用正则到文本） | 🟡 |
- | C15 | Toolbox（变量管理器/提示词查看器/音频播放器/日志查看器） | 未做 | 五作用域 JSON 编辑器 + 干跑生成看 prompt + BGM/ambient 播放列表 + iframe console 捕获 | 🔴 |
- | C16 | Developer listener（socket.io 连接，VS Code 热更新） | 未做 | `listener.url` socket.io 连接 + iframe 刷新 + echo toast | 🔴 |
- | C17 | 音频 API（BGM/ambient 双播放器，播放列表存 chat_metadata） | 未做 | `audio.*` 设置消费 + 播放列表读写 | 🔴 |
- | C18 | triggerSlash/substitudeMacros/getLastMessageId/getTavernVersion 等杂项 API | 未做 | 执行 STScript 斜杠命令、宏求值、消息 id 查询 | 🔴 |
- | D1 | initvar 变量初始化（扫描绑定世界书 `<initvar>`/`[initvar]`/`[InitialVariables]`，JSON/YAML 解析合并） | 未做 | 开局自动初始化 `stat_data`，写入消息 0/聊天变量，触发 `mag_variable_initiailized` | 🔴 |
- | D2 | `<UpdateVariable>` 更新命令解析（`_.set/add/insert/delete/move`，JSON→Function→YAML 值解析） | 未做 | 从 AI 回复提取更新块→解析→应用到 `stat_data`→写回消息楼层变量 | 🔴 |
- | D3 | `<JSONPatch>` 更新格式（新卡，op: replace/delta/insert/add/remove/move） | 未做 | JSONPatch 解析与应用 | 🔴 |
- | D4 | 额外模型解析（回复无有效更新块时，generateRaw 发起专用 LLM 调用产出 `<UpdateVariable>`） | 未做 | `isDuringExtraAnalysis()` 期间的独立配置+提示词+温度 | 🔴 |
- | D5 | 状态栏显示（display_data/delta_data 经类宏 `{{get_message_variable::stat_data}}` 渲染到楼层前端） | 未做 | 类宏系统支持 + 角色卡脚本 iframe 渲染 | 🔴 |
- | D6 | `window.Mvu` API（events/getMvuData/replaceMvuData/parseMessage/isDuringExtraAnalysis） | 未做 | 全局对象挂载 + iframe 桥接 | 🔴 |
- | D7 | zod 校验配套（registerMvuSchema，初始化/命令应用前 safeParse，失败回滚） | 未做 | `mag_*` 事件钩子 + schema 校验 + toast 提醒 | 🔴 |
- | D8 | 设置 UI（mvu_notification_* 复选框） | 数据面有（mvu-settings.json） | 失败/初始化提醒 toast | 🟡 |
- | E1 | 表格数据模型（Sheet/SheetTemplate/Cell，uid 网格+历史栈） | 未做 | 二维 uid 网格 + `cellHistory` 撤销栈 | 🔴 |
- | E2 | `<tableEdit>` 指令解析（insertRow/updateRow/deleteRow，参数分类+排序+容错） | 未做 | 从消息提取→`classifyParams`→`sortActions`→`executeAction` 落表 | 🔴 |
- | E3 | 提示词注入（`{{tableData}}` 占位+完整操作规则，deep/injection_mode 控制） | 未做 | `initTableData` 渲染+`CHAT_COMPLETION_PROMPT_READY` 注入 | 🔴 |
- | E4 | 分步填表（step_by_step，两步总结：undoSheets→独立 API 产出 `<tableEdit>`→解析执行） | 未做 | `TableTwoStepSummary` + `executeIncrementalUpdateFromSummary` + 自定义 API | 🔴 |
- | E5 | 重整理（rebuildSheets，clear_up_stairs/token_limit 截取+JSON5 容错+validateActions） | 未做 | `rebuildSheets` + `absoluteRefresh.js` 提示词模板 | 🔴 |
- | E6 | 前端表格渲染（isTableToChat/table_to_chat_mode/table_to_chat_can_edit/to_chat_container/alternate_switch） | 未做 | `tablePushToChat.js` + 穿插模式 + 前端编辑 | 🔴 |
- | E7 | 自定义渲染（`$A1`/`S[表名][A1]` 占位符，divideCumstomReplace，compositeTableRenderer） | 未做 | `parseSheetRender` + `placeholderManager` | 🔴 |
- | E8 | 宏（`{{tablePrompt}}`/`{{tableData}}`/`{{GET_ALL_TABLES_JSON}}`/`{{GET::表名:单元格}}`） | 未做 | 核心 `registerMacro` + `resolveTableMacros` 扫楼层替换 | 🔴 |
- | E9 | 表格编辑器（appHeaderTableDrawer/drawer，数据视图/模板编辑/样式编辑/统计/历史） | 未做 | 拖拽+右键菜单+单元格历史+调试日志弹窗 | 🔴 |
- | E10 | 自定义 API（custom_api_url/key/model_name/temperature/max_tokens/top_p/table_proxy） | 未做 | `standaloneAPI.js` + 代理支持 + 模型列表更新 | 🔴 |
- | E11 | 数据迁移（1.0→2.0 表格转换，`convertOldTablesToNewSheets`） | 未做 | 旧数据自动迁移 | 🔴 |
- | E12 | 设置导入/导出/分项重置（六类：基础/注入/重整理/独立填表/前端表格/表格结构） | 未做 | `filterTableDataPopup` + 分项重置 | 🔴 |
- | F1 | 原始 `<UpdateVariable>` 块被显示（未解析/未隐藏） | 未做 | MVU 渲染器：解析 UpdateVariable 块→应用→从显示文本移除/折叠 | 🔴 |
- | F2 | 通讯终端 iframe 发灰、样式残缺 | 未做 | 酒馆助手脚本 iframe 的深色主题/CSS 注入（ST `createSrcContent` 的 `--TH-viewport-height`/头像 CSS/predefine） | 🔴 |
- | F3 | 悬浮窗不可拖动（实时监控/剧情控制台/世界书控制） | 未做 | 悬浮窗拖拽（ST `appHeaderTableDrawer` 的 dragManager + 位置记忆） | 🔴 |
- | F4 | MVU 状态栏卡未渲染（正常模样里的"漂泊者 状态/剧情/牵绊/行动"卡） | 未做 | 角色卡脚本 iframe 读取 `Mvu.getMvuData({type:'message'})` 渲染状态栏 | 🔴 |
- | F5 | 消息操作按钮（变体/回退/编辑）未对齐正常模样 | 部分做 | `RpAssistantNodeView`/`RpRegenerateAction` 等槽位组件的样式与功能对齐 | 🟡 |
- | G2 | 设置面 1:1 复刻 ST 时期全部选项 | 部分做（酒馆助手 1 项→全量 22 项、提示词模板 1 项→19 项、MVU 保留 raw 键值、记忆 6 项） | 无对应机制的项明确标注（不悄悄砍） | 🟡 |
- | G4 | 能接线的开关立即接线生效 | 部分做（TH：脚本/宏；EJS：enabled/generate/render/chatDepth/sandbox/debug） | 暂无对应管线的项（GENERATE/@INJECT/RENDER 注入、优化 8 开关、缓存、编译 Worker 等）存盘+标注 | 🟡 |
- | H3 | PC 副本回退插件同步 | 待办（`.a Agent RolePlay Project` 的 undo 旧产物升级，需确认 PC DSH 0.1.1 契约兼容） | 独立任务 | 🔴 |
- | H4 | 安卓性能优化（"重度玩家聊很多楼"性能墙） | 待办（§2.2 上下文瘦身+记忆插件） | 独立任务 | 🔴 |
- **修复项**：①`scanSurfaceHistory` 已换 `eventAt(seq)` 适配器（A2 同修，待实测）；②`session.prompt` 补 `requestId`（A4 已修）；③楼层计数逻辑对照 0.1.2 `SessionSurface.nodes` 重新校准（确保 user 输入 + assistant 回复 = 1 楼）。| 🔴 待实测
- **修复项**：①`RpAssistantNodeView` 挂载后主动 `scrollIntoView({behavior:'auto',block:'end'})`；②排查 0.1.2 原生 conversation 的滚动锚定机制（`dsh-client-ui-conversation` 的 `useScrollAnchor`），确保我们的组件不破坏锚点。| 🔴 未做
- **修复项**：用户已拍板**只保留上面原生折叠行**——把我们的 `RpReasoningFold` 从 `conversation.chat.node` 的 shadowing 中移除（或改为 `priority: 1` 让原生 0 胜出），保留原生「126 次工具调用·105 条消息」样式。| 🔴 未做
- **修复项**：①在 `dsht-rp-plugin` 客户端注册核心宏（`MacrosParser.registerMacro` 等价物——查 0.1.2 的宏注册机制，可能是 `ctx.macros` 或 `dsh-client-ui-conversation` 的宏槽位）；②`{{user}}`/`{{char}}`/`{{time}}`/`{{date}}`/`{{random}}`/`{{pick}}`/`{{roll}}` 等基础宏全集；③类宏系统补齐（`getvar/setvar/incvar/decvar/get_message_variable/get_chat_variable/get_character_variable/get_preset_variable/get_global_variable/format_*_variable`，C2 同款）。| 🔴 未做
- **修复项**：①在 `dsht-rp-ui` 的 `sidebar.footer.action` 旁新增「👤 用户设定」入口（或并入 RP overlay 顶部 tab）；②首启引导（`maybeOpenFirstLaunchImport`）增加 user 名字/设定的必填步骤；③`{{user}}` 宏的值从该配置读取（当前默认「用户」，需可配置）。| 🔴 未做
- **修复项**：①排查 `dsht-plugin-mobile` 的触控锚点是否覆盖文件引用组件的点击区域；②文件预览弹窗在竖屏下改为全屏抽屉（`dsht-plugin-mobile` 的 `data-*` 宿主锚点适配）；③确保 `dsh-file-reference` 的点击事件在 WebView 下正常触发。| 🔴 未做
- **修复项**：①在 `dsht-rp-plugin` 的 pre-step 钩子里对工具调用的 `arguments.content` 做截断（>100KB 时替换为 `[base64 truncated: <size> bytes]`）；②对 `writeFile`/`writeFiles` 的 `content` 参数做 base64 检测+截断；③`dsh-spill` 的配置补 `truncateArguments: true`（查 0.1.2 是否支持）；④会话落盘前对超大参数做压缩（`dsh-session-persistence` 的 `beforeSave` 钩子）。| 🔴 未做
- **状态**：🔴 未做（I8-1~I8-7 全部）

## 五、升级后必做动作

1. 替换/更新 dsh-runtime（Android 侧同步 dsh-runtime-android）
2. `node scripts/capture-contracts.mjs` 采集新版本快照
3. `node scripts/extract-adaptations.mjs` 刷新 @adapt 标记清单
4. `node scripts/diff-contracts.mjs contracts/<旧版本> contracts/0.1.0-rc.8` 出 diff 报告
5. 按报告「受影响适配点」逐个核对 `// @adapt` 行是否仍成立
6. 真机回归：kickoff / 续跑 / 回退 / 重生成 / 变体条 / token 鉴权 401 路径
