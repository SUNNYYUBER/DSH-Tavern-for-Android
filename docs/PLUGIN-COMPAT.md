# DSHTavern 社区插件适配指南（PLUGIN-COMPAT）

> 建立：2026-09-20（[NEXT-STEPS](NEXT-STEPS-2026-09-19.md) P0 首个交付物）。
> 目的：回答「社区为 DSH 写的插件，在 DSHTavern 里装得上吗？会撞什么？撞了怎么办？」
> 数据源：GitHub 生态调研（2026-09-20）+ [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar)
> （2.1 万+ 候选插件、k8s 运行级实测 1.3 万+、分类目录自动生成）。

---

## 一、社区生态现状（2026-09-20 调研）

- **规模**：radar 跟踪 2.1 万+ 候选仓库；精选目录（awesome-dsh-plugin ★16k、radar PLUGINS.md、
  kejixiaoliang/awesome-dsh-plugins 14 类 280+）收录数百个经人工复核的插件。
- **分类体系**（radar catalog）：Agent 能力 / Web UI 增强 / 主题皮肤 / 基建部署 / 娱乐生活 /
  学习研究 / 市场与管理 / 技能包 / 文件数据 / 消息通讯 / 编码开发 / 记忆增强。
- **运行级验证**：radar 对部分插件给出 ✅「可用」判定（k8s 运行级实测）——这是**标准 DSH**
  （glibc Linux）的先验；DSHTavern 的适配评估 = 在此之上的**增量评估**（bionic 约束面）。
- **命名约定**：scope 用 `@dsh-external/*`（勿占用 `@deepseek-ai/*` 保留命名空间）；
  repo 打 `dsh-plugin` topic；`dsh plugin --profile web add <pkg>` 安装。

## 二、插件形态 × Android 适配预判

按「插件对运行时的依赖形态」分五档（★ = 适配信心）：

| 形态 | 代表插件 | Android 约束敏感度 | 预判 |
|---|---|---|---|
| **纯客户端**（零网络零持久化） | dsh-session-tabs / dsh-turn-index / dsh-outline | 无 | ★★★ 直接可用 |
| **host + client 双面**（本地 HTTP + Web UI） | dsh-session-pin / dsh-tokstat / dsh-better-stats / **dsh-preset-enhance（已接入）** | webServer 路由、settings 命名空间 | ★★★ 可用（webServer 契约已验证） |
| **纯 Node 网络工具**（官方 subprocess / fetch） | dsh-email / dsh-rss / dsh-cite / dsh-dingtalk / dsh-slack / dsh-im | 网络（前台服务保活已解决） | ★★☆ 大概率可用，需实测后台存活 |
| **LLM provider / OAuth** | dsh-zhipu-toolkit / dsh-plugin-subscriptions / dsh-vercel-mcp | OAuth 浏览器跳转、凭证库存储 | ★★☆ 需验证 WebView 里 OAuth 流程 |
| **系统工具链**（bash / PTY / ffmpeg / docker / tray） | dsh-bash-terminal / dsh-win32 / dsh-tray / dsh-ffmpeg / dsh-docker / dsh-TUI | **8 项安卓约束正面撞击**（无 bash、无 PTY、原生模块不可用） | ★☆☆ 多数不可用或需补齐（见 P1 能力补齐包） |

**高价值优先评估清单**（★★★ + 与 RP 用户场景相关）：

1. **dsh-session-pin**（会话置顶/分组/标签）—— RP 会话管理增强，纯本地
2. **dsh-turn-index / dsh-outline**（会话导航/大纲）—— 长 RP 会话的体验增强，纯客户端
3. **dsh-tokstat / dsh-better-stats**（token 用量/费用统计）—— 与我们的 RpTokenMeter 有**功能重叠**（见 §三 冲突）
4. **dsh-annotation / dsh-ui-quote-selection / CiteCiter**（选中批注/引用）—— RP 阅读体验
5. **dsh-zhipu-toolkit**（GLM 模型目录）—— 扩模型渠道，LLM provider 类样本

## 三、冲突类型学（每类附真实案例与处置模式）

### ① UI 槽位冲突（最高发）

- **形态**：两个插件注册同一槽位（sidebar 页面 / `conversation.chat.node` 的 keyed 渲染器 /
  assistant-actions / 会话头 actions）。cordis 规则：**同名 key 高 priority 者胜**
  （我们用 priority -1 shadowing 官方渲染器——第三方插件若也用 -1 抢同一 key，顺序未定）
- **真实案例**：`DSH-better-sidebar`（侧边栏底座，三方注册页面）与 `dsht-rp-ui` 的 RP overlay；
  `DSH-Transparent-UI-Plugin`（全局玻璃主题）与我们的 RP 楼层样式（CSS 选择器撞车）
- **处置**：(a) 文档明示互斥（「装 X 前请关闭 Y」）；(b) 我们的 keyed 渲染器**让路**
  （检测到第三方占用时降级，保留回退掩码判定的本地隐藏逻辑）；(c) 主题类用 CSS 前缀隔离
  （我们的样式全部带 `.dsht-rp-` 前缀，已是现状）

### ② 注入点共享冲突

- **形态**：多个插件都改写「发给模型的消息」——`llm/stream` waterfall（bychv preset-enhance、
  dsh-purge、dsh-routing-suite）或 `agent/pre-step`（我们的快照管线）。**waterfall 顺序 =
  注册顺序**，后注册者看到的是前者的输出
- **真实案例**：RP 会话里手动 `/preset on`（bychv 编译）+ 我们的 `withPresetLayer` 快照 =
  同一预设注两遍
- **处置**：(a) T-88 §五 的管线切换（RP 会话预设注入统一归 bychv 包）；(b) 切换前的过渡规则
  = 「bychv 绑定启用的会话，我方快照管线跳过」（需要我方管线读它的 bindings——跨插件
  数据读取走 DSH_HOME 的 state.json，路径已知）

### ③ 路由前缀冲突

- **形态**：两个插件注册同一 HTTP 前缀（如都注册 `/preset/*`）
- **现状**：cordis webServer 的路由表按注册顺序匹配，**先注册者优先**；我们的路由前缀
  全部带 `dsht-` 或 `rp-` 限定（`/dsht-rp`、`/dsht-mvu`…），与社区插件撞名概率低
- **处置**：保持前缀命名纪律（新插件一律 `dsht-*` 前缀）；冲突时文档说明

### ④ inject 服务缺失（激活门）

- **形态**：插件声明的 `inject` 服务在 DSHTavern profile 不存在 ⇒ **整插件不激活**（静默！
  插件列表里出现但什么都不干）
- **真实案例**：bychv 包 inject `['llm','sessions','webServer','commands','tools','agentPresets','agents']`
  ——我们接入前逐个核对过在 profile 里都存在。**每个新插件接入前必须做同样的核对**
- **处置**：接入检查清单（§四）；考虑做一个 profile 服务清单探针（`scripts/audit-profile-services.mjs`，
  扫描 cordis.patch.yml 两官方 bundle + 我方插件的服务提供面）

### ⑤ 数据目录约定

- **形态**：插件读写 `$DSH_HOME` 的相对路径假设（`~/.dsh` 在 PC 是用户目录，Android 是
  `filesDir/.dsh`——进程内 `process.env.DSH_HOME` 已正确设置，但**写死 `os.homedir()` 的插件会写错位置**）
- **真实案例**：bychv 包的 `process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')` ——
  有环境变量回退，Android 安全；但 dsh-plugin-subscriptions 等若直接用 homedir 会出问题
- **处置**：适配评估时 grep 插件源码的 `homedir()` / 绝对路径字面量

### ⑥ 变量/状态隔离

- **形态**：两个插件各自维护变量存储，语义交叠（bychv preset store 的 setvar vs 我们的
  MVU stat_data）——**同名变量两边各存一份，模型读到哪份取决于注入顺序**
- **处置**：划界规则（预设宏变量归 bychv store；MVU 变量归 stat_data）；实测验证（P3）

## 四、新插件接入检查清单（每接入一个走一遍）

1. **依赖面扫描**：`package.json` 有没有运行时 dependencies？有没有原生模块（.node / node-gyp）？
   有没有 `child_process.spawn('bash'|'sh')` / `node-pty` / `ffmpeg` / `docker` 字面量？
2. **inject 核对**：插件声明的 inject 服务在我们的 profile 是否全部存在？（缺 ⇒ 激活门静默不激活）
3. **路径假设**：grep `homedir()` / `/data/` / `C:\\` / `/tmp` 字面量
4. **UI 面**：它注册哪些槽位？与 `dsht-rp-ui` 的 keyed 渲染器/overlay/sidebar 是否撞 key？
5. **注入面**：是否挂 `llm/stream` / `agent/pre-step`？与我们的快照管线/bychv 编译的执行顺序？
6. **实测**：装上 → 插件列表出现 → 功能路径走一遍 → 看 logcat 有无 `without inject` / EACCES

## 五、当前已接入的第三方插件

| 插件 | 版本 | 接入方式 | 状态 |
|---|---|---|---|
| [dsh-preset-enhance](https://github.com/bychv/dsh-preset-enhance) | 0.3.2-rc.1 | 构建期 npm 拉取（`-PresetEnhanceVersion`）+ NodeService 整包同步 | ✅ 已随 v0.2.0-beta.3 分发；管线切换待真机验证（T-88 §五） |

## 六、生态资源（调研用）

- [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) —— 运行级验证目录（catalog/all/*.md 分类清单；catalog/plugins/*.json 逐插件元数据）
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— ★16k 精选列表
- [kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins) —— 14 类 280+
- [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) —— 会话内插件搜索（topic:dsh-plugin 实时检索）
