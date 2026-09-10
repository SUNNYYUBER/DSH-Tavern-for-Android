# ST 插件意图评估清单（R13）

对批次 `extensions/` 下插件的意图级评估：能力、ST 依赖点、迁移价值分级、建议 DSH 落点。
三大必适配插件（MVU / 酒馆助手 / ST-Prompt-Template）已有对应 Cordis 插件
（dsht-plugin-mvu / dsht-tavern-helper / dsht-prompt-template），迁移时只需搬配置数据；
本清单覆盖其余四个。

迁移时对每个实际存在的插件：读它的 manifest.json + extension_settings 对应子树，
把「配置数据」按下表落点迁移；「代码」不搬（ST 前端 API 依赖无法机械移植）。

---

## chat-history-backup（聊天记录快速恢复 v4.0.0）

- **能力**：聊天自动备份/快速恢复——监听消息事件（AI 回复、用户发送、swipe 生成/切换）做
  防抖快照，提供备份表格抽屉 UI，可一键回滚到任意备份点；分 standard/swipe 两类备份。
- **ST 依赖点**：深度耦合 ST 前端——`script.js` 的 saveChat/updateChatMetadata/
  openCharacterChat/getPastCharacterChats、`eventSource`/`event_types`、Popup、
  extensions.js 的 extension_settings。存储走 ST 服务端 API（getRequestHeaders fetch）。
- **迁移价值：低**。理由：DSH 的 session.jsonl 本身是追加式事件日志，天然全量保真
  （连 swipe 变体链都在 log 里），且有 session.fork（从任意 turn 分叉 = 比「回滚」更强的
  原生能力）。备份插件解决的问题在 DSH 架构里不存在。
- **建议落点**：不迁移代码。其 `extension_settings`（备份开关/保留策略）无运行时意义，
  报告中注明「功能由 DSH session 持久化 + fork 原生覆盖」即可。
  若用户有存量备份数据（ST 服务端的 backup 文件），可在报告中提示用户手动导出。

## JS-Slash-Runner（酒馆助手 v4.9.1）——三大必适配之一

- **能力**：脚本/斜杠命令运行时——卡级/全局 JS 脚本（iframe 沙箱执行）、变量系统
  （global/character/chat 三级作用域 + schema）、宏（{{getvar}} 等）、EJS 模板、
  消息渲染注入、事件监听、音频/工具箱面板。ST 端大量卡的交互逻辑（按钮、状态栏、
  变量读写）由它承载。
- **ST 依赖点**：iframe 消息桥（parent jQuery / postMessage 协议）、ST 全局对象
  （getContext、eventSource、slash command registry）、Vue 面板注入。
- **迁移价值：高（已适配）**。
- **建议落点**：**已落地为 dsht-plugin-tavern-helper**（/dsht-tavern-helper/*：
  variables 三级作用域 + message 合并视图 + scripts 仓库/执行 + 正则三源 + 预设 CRUD +
  世界书读写 + 事件桥 + 聊天写桥 createChatMessages/setChatMessages + generateRaw 真装配）。
  迁移动作：`extension_settings.tavern_helper` 的变量数据按 scope 分流 PUT `/variables`；
  脚本仓库 PUT `/scripts`。卡内/聊天内的脚本引用保持原样（session.jsonl 不动）。
  ✅ **脚本执行形态与真 TH 同源**（v183+：每脚本一 iframe，allow-same-origin + 宿主注入
  $/_/z/YAML/jQuery UI/FontAwesome + TavernHelper API shim 完全体 + confirm/alert 模态桥 +
  按钮 API 四件套支持跨脚本管理——依赖 DOM 注入的悬浮球/fixed 部件类脚本可正常运行，
  见 references/th-buttons.md）。个别未覆盖 API 会在脚本面板 missing 列表记名（不静默）。

## LittleWhiteBox（小白盒 v3.0.4）

- **能力**：多功能套件——剧情总结/记忆系统（story-summary/story-outline）、变量系统、
  画图（draw，NovelAI/danbooru 标签）、电子书生成（ebook）、助手面板（assistant/agent-core，
  带 Anthropic/Google 适配器与工具）、桌宠（tavern pet）、第四面墙语音（fourth-wall）、
  调试面板等。generate_interceptor `xiaobaixGenerateInterceptor` 可在生成前改写请求。
- **ST 依赖点**：generate_interceptor 钩子、ST 服务端存储（server-storage.js）、
  iframe 桥（bridges/）、SlashCommand 注册、UI 注入（dexie/minisearch/pixi 等前端库）。
- **迁移价值：中**。理由：核心是「剧情总结/记忆」与「生成拦截」两个意图——这两类在 DSH
  有原生对应物（compaction 压缩 / pre-step 注入链），但「长期记忆总结」「大纲管理」对超长
  RP 剧情确有增量价值；画图/电子书/桌宠属独立小应用，与 RP 主链路弱相关。
- **建议落点**：
  - `extension_settings` 中小白盒的总结/大纲数据 → 可作为世界书条目或 rp.json 附属
    资料落盘（报告里列出，由用户决定是否编入世界书）；
  - 长期方向（排期 P2+）：总结/记忆 → 独立 Cordis 插件挂 pre-step + 定时压缩；
    生成拦截 → dsht-rp-plugin 的 pre-step waterfall 已有等价挂点。
  - 画图/电子书/助手/桌宠：不迁移（DSH 会话本身即更强的助手）。

## vectors-enhanced（聊天记录超级管理器 v1.3.3）

- **能力**：聊天向量化 RAG——把历史消息切块 embedding 入库，生成时按相关度检索
  重排注入上下文（generate_interceptor `vectors_rearrangeChat`）；向量任务管理、
  文件/世界书向量化、rerank、标签规则、内容选择。
- **ST 依赖点**：generate_interceptor、ST embedding 服务端 API（optional: ["embeddings"]）、
  setExtensionPrompt 注入、chat_metadata 存向量任务状态、大量 UI 组件。
- **迁移价值：中偏低**。理由：意图（超长聊天的事实召回）真实且重要，但依赖 embedding
  服务与生成拦截管线，移植成本高；DSH 侧 compaction + lore_query 工具 + WI 触发已覆盖
  大部分召回场景。批次数据里的 `vectors/` 目录（向量缓存）对 DSH 无意义。
- **建议落点**：本期不迁移代码。`extension_settings.vectors_enhanced` 中与聊天绑定的
  任务状态随报告列出即可。长期方向：DSH 原生「会话检索」能力（session.search 已有全文
  检索）+ 可能的 embedding 提供者插件，排期再评估。

---

## 分级汇总

| 插件 | 分级 | 迁移动作 |
|---|---|---|
| MVU（extension_settings.mvu_settings + chat_metadata.variables） | 高（已适配） | 配置 → dsht-mvu settings/statusbar；变量 → variables/register |
| 酒馆助手（tavern_helper） | 高（已适配） | 变量/脚本 → dsht-tavern-helper variables/scripts |
| ST-Prompt-Template（EjsTemplate） | 高（已适配） | 模板 → dsht-prompt-template render 验证 |
| LittleWhiteBox | 中 | 总结/大纲数据列出由用户决策；代码不迁 |
| vectors-enhanced | 中偏低 | 不迁；向量缓存目录跳过 |
| chat-history-backup | 低 | 不迁；功能被 DSH session 持久化 + fork 覆盖 |
