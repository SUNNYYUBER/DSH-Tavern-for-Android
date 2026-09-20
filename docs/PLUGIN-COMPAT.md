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
- **处置落地（2026-09-20）**：管线切换已实施并模拟器复验（GOAL-PRESET-SWITCH-2026-09-20）——
  bychv 绑定启用的会话我方 relative+depth 注入点静默，解绑自动恢复

### ②b 预设模式（st-preset）与 RP 会话互斥（2026-09-20 机制确认）

- **bychv 的「预设模式」**（agent preset `st-preset`）是给**普通会话**的「预设即人格」玩法：
  它把官方 persona 组成换成 `complete: true / includeRuntimeContext: false`，
  且其 `presetModeHistory` 会从发给模型的消息里**过滤掉 source.plugin 为
  `@deepseek-ai/dsh-system-prompt` 的 system 消息**
- **RP 会话为什么不可用**：RP 的全部注入（角色卡 persona / 世界书 / MVU 状态 / 记忆 /
  预设槽位）都经 `system-prompt/assemble` 汇进**同一条** source.plugin = dsh-system-prompt
  的 system 消息——预设模式下**整条被过滤**，角色 persona 全丢（T-88 调研结论的机制确认）
- **现状（安全默认）**：RP 会话的 agentPreset 是空（默认 standard），bychv 的
  `autoEnableModes` 默认只含 `st-preset`——**默认不会误启用**；
  风险只来自用户手动在工作台给 RP 会话选「预设模式」
- **规则**：RP 会话 = 默认模式 + 预设绑定；预设模式只用于普通会话
- **护栏**：我方 pre-step 检测 RP 会话 agentPreset 被切到 `st-preset` 时 logcat 出声警告
  （不 fork bychv 包改其工作台 UI）

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
| [dsh-preset-enhance](https://github.com/bychv/dsh-preset-enhance) | 0.3.2-rc.1 | 构建期 npm 拉取（`-PresetEnhanceVersion`）+ NodeService 整包同步 | ✅ 已随 v0.2.0-beta.3 分发；管线切换已实施并模拟器复验（GOAL-PRESET-SWITCH-2026-09-20） |

### 5.1 运行时安装路径实证（2026-09-20，W-C）

社区插件**不重新打包 APK 也能装**（等价 `dsh plugin add`，模拟器实证）：

1. npm 包解开 → `adb push` → `run-as` 解进 `files/.dsh/profiles/web/node_modules/<pkg>`
2. `files/.dsh/profiles/web/cordis.patch.yml` 追加该包自带 `cordis.patch.yml` 的 insert 行
3. 重启应用（loader 重读 patch 栈）

注意：run-as 的 shell 不能用 heredoc（/data/local 无写权限），要 push 文件后 `cat >>`。
**这就是未来 UI 化插件安装器的原型路径。**

### 5.2 优先清单实测对账（2026-09-20，x86_64 模拟器）

| 插件 | 预判 | 实测结论 | 错在哪/备注 |
|---|---|---|---|
| dsh-session-pin 0.7.11 | ★★★ host+client 可用 | ✅ **全功能正常**：pin/unpin 循环、pinned 面板（UNGROUPED 列出被 pin 会话）、settings 持久化；与 RpPresetSwitch **同槽位共存**（`conversation.session.header.actions`，order 50 并存不互斥） | 预判成立。探针教训：选错探测面（localStorage/类名猜错）曾误报「无持久化」——行为级证据（面板列表）才是金标准 |
| dsh-better-stats 0.1.16 | ★★★ 可用（与 RpTokenMeter 重叠） | ✅ **激活正常**：`conversation.composer.dock` 注册成功，strip 显示 `Balance / Off-peak / Turn ¥ / Session ¥`；与 RP 会话、卡脚本（ERA 框架）共存未见异常 | 预判成立。重叠面 = 与 RpTokenMeter 费用显示双份，用户可选一，不冲突 |
| dsh-turn-index 0.1.1 | ★★★ 纯客户端直接可用 | ⚠ **部分失效**：激活正常（root/折叠交互/样式注入），官方会话流锚点面兼容（`data-chat-anchor-key` 85 行在）；但**轮次条目恒为空**（`.dsh_ti_item`=0，RP 会话实测；数据面 `sessions.binding(current)` 或 `snap.chat` 投影未通，根因未钉死）。**更重要：官方 DSH 已内置等效功能**（会话流 turn marks，`Jump to turn N` × 19 按钮实测在） | 预判错在「功能价值」评估：官方原生已覆盖 ⇒ **建议不装**（功能重叠）。条目为空的根因留作与作者对接项 |
| dsh-tokstat | 清单在列 | ❌ **npm 不存在**（E404） | 调研清单错误，销项 |
| dsh-annotation | 清单在列 | ❌ **npm 不存在**（E404） | 调研清单错误，销项 |
| dsh-outline 0.1.6 | ★★★ 纯客户端 | ⚠ **激活但 UI 不现身**（2026-09-20 实测）：client bundle 加载链完整（`dsh-outline/client.js` 在 plugins bundle）、`shell.overlay` 注册成功；但 client 执行即崩 `TypeError: snapshot.nodes is not iterable at buildOutlineItems`，DSH slot 机制隔离崩溃条目（`slot entry crashed in 'shell.overlay'`）→ 触发钮不渲染（186 按钮无「大纲面板」） | 第⑧类（数据面依赖 client face 投影形态）又一例：它读的 `snapshot.nodes` 在 DSH 0.1.5-rc.1 的投影里不是可迭代形态。数据源虽是 DOM 扫描（与 turn-index 的 chat 投影不同路径），但快照获取同样踩 client face 内部形态。**建议不装**，待作者适配；崩溃被 slot 隔离、不影响宿主 |
| dsh-zhipu-toolkit 0.2.1 | ★★☆ LLM provider 类 | ❌ **npm 上架包不完整**（2026-09-20 实测）：`lib/index.js` 引用的 `lib/usage-stats.js` 不在 tgz 内（20 文件清单无）→ `ERR_MODULE_NOT_FOUND` → **node exit 1 crash-loop**（整机不可用）；已从模拟器 patch 摘除恢复 | 第⑨类新冲突：npm 发布缺陷（files 字段漏配）——装社区插件前应先 `npm pack` 核对 import 闭包。待作者修复后再评 |

### 5.3 冲突类型学新增实测案例（2026-09-20）

- **① UI 槽位共存（正例）**：session-pin 的 `conversation.session.header.actions`（order 50）与
  RpPresetSwitch **同槽位并存**——官方 slots 机制支持同槽位多注册按 order 排列，不互斥
- **⑦ 功能重叠新类型（turn-index 案）**：插件功能与**官方新版本内置功能**重叠时，
  适配结论不是「装不装得上」而是「**有没有必要装**」——评估清单要先查官方更新日志
- **⑧ 插件数据面依赖 client face 内部形态（turn-index 案 + outline 案）**：纯客户端插件读
  `sessions.binding(id).session.getSnapshot().chat` / `snapshot.nodes` 这类 client face 投影——
  该形态不在 cordis 契约面内，**不同 profile/版本下可能静默为空或直接抛异常**（激活正常但功能哑火；
  outline 案是抛 `snapshot.nodes is not iterable`，被 slot 崩溃隔离机制吞掉 → UI 不现身）。
  检查清单 §四.6 补一条：纯客户端插件也要验证**功能路径**，不能只看「页面出现」；
  判据补一条：CDP console 抓 `slot entry crashed` 是这类哑火的**直接可见信号**
- **⑨ npm 上架包自身缺陷（zhipu-toolkit 案）**：插件入口引用的文件不在发布 tgz 内
  （`files` 字段漏配）→ host 侧 import 即 `ERR_MODULE_NOT_FOUND` → **cordis 插件树加载失败
  连带 node crash-loop**（DSH 的 fail-fast 对第三方包缺陷零容忍）。检查清单 §四.1 前置一步：
  `npm pack` 解开核对 import 闭包完整性，再进设备

## 六、生态资源（调研用）

- [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) —— 运行级验证目录（catalog/all/*.md 分类清单；catalog/plugins/*.json 逐插件元数据）
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— ★16k 精选列表
- [kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins) —— 14 类 280+
- [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) —— 会话内插件搜索（topic:dsh-plugin 实时检索）
