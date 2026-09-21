# DSH Tavern for Android

**中文** ｜ [English](#english)

把你的 SillyTavern 数据（角色卡 / 世界书 / 预设 / 正则 / 聊天记录）搬进一个安卓 App。
装上即用，全部本地运行，不上传你的任何数据。

**当前版本**：`0.2.1`（内嵌 DSH `0.1.5-rc.1`）　|　**状态**：v0.2.1 正式版（验证面见下表；个人业余项目，仍请视作早期软件对待）

## ⚠️ 先读这段

- **bug 会很多**，其中一部分严重到功能不可用 / 数据异常 / 需要重装。**不要拿它当主力工具，不要用在丢不起的数据上。**
- 个人业余项目，修得慢（见文末「反馈与贡献」）。

**验证面速查**（2026-09-20 起所有「已验证」标注到面；欢迎回填，见 [B-DEVICE 清单](docs/B-DEVICE-VERIFY-CHECKLIST.md)）：

| 能力 | x86_64 模拟器 | 真机（小米 11 Pro） | 鸿蒙（卓易通） |
|---|---|---|---|
| 首启 / 会话基础 | ✅ 实测 | ✅ 实测（早期版本） | ✅ 实测（2026-09-19，HarmonyOS 6） |
| 会话迁移（0.1.5） | ✅ 80/80 真实会话 | — 同模拟器面 | ⬜ 未实测 |
| 预设管线（bychv 单份注入） | ✅ 实测（v368） | ⬜ 未实测（清单已备） | ⬜ 未实测 |
| MVU direct 卡提取（T2.3b） | ✅ 实测（正控 PASS） | ⬜ 未实测 | ⬜ 未实测 |
| P1 工具链（bash/rg/git/zstd） | ✅ 实测（v370 自测 rc=0） | ⬜ 未实测（装包后看 logcat `P1 tool self-test`） | ⬜ 未实测 |

公开它是两个原因：分享「安卓上跑 DSH 运行时」的实现思路；ST 兼容面太长，一个人补不完，欢迎 fork 继续补。

**AI 协作声明**：本项目由人类主导设计，代码与文档有 AI 深度参与（Kimi K3 · DeepSeek V4 Flash 0731 · GLM 5.3 Flash · DeepSeek V4.1 Flash）。请以实际运行结果为准，不要以文档措辞为准。

---

# 第一部分：给使用者

## 快速开始

1. 下载并安装对应架构的 APK（`arm64` = 真机，`x86_64` = 模拟器）。首次启动要解压约 2.4 万个文件，等它跑完。
2. 打开 App → **设置 → 模型** → 填入你的 API Key（DeepSeek 官方，或任意 OpenAI 兼容端点）。
3. 侧栏底部「🎭 角色扮演」→「导入」页，选一种导入方式：

   | 导入方式 | 用途 |
   |---|---|
   | 📦 **完整数据包** | `data/` 文件夹打包的 zip —— 角色卡 / 世界书 / 聊天记录 / 预设一次迁移 |
   | 🎴 **角色卡** | 单个 PNG 或 JSON —— 生成一个工作区 + 带开场白的会话 |
   | 📚 **世界书** | world JSON |

4. 回到「角色」页，点开角色卡即可开聊。**建议先导入一张卡试聊一轮，确认链路通畅，再导完整数据包。**

## 能做什么

| 能力 | 说明 |
|---|---|
| **数据迁移** | ST 整包 `data.zip`、角色卡（PNG/JSON）、世界书、预设、聊天记录；聊到一半可接着聊 |
| **世界书触发** | constant / 关键词（含正则、大小写、全词）/ 副关键词 / 递归扫描 / scanDepth / 时效效果 / 互斥组 / token 预算 |
| **预设** | ST OpenAI Settings 导入（prompts + prompt_order + regex_scripts）、条目开关、随时切换 |
| **正则** | 三时机（display / prompt / permanent）、placement、depth、substituteRegex、三源作用域 |
| **MVU** | `<UpdateVariable>` / `<JSONPatch>` 全操作符 / `<initvar>` / `_.set` 系 / stat_data 双树合并 / 状态栏 |
| **酒馆助手（JS-Slash-Runner）** | TH API 分本地 / 桥接 / 记名拒绝三类（条数会随开发增长，以源码为准）；`tavern_events` 82 项全表；事件时序；脚本管理面板 |
| **提示词模板（EJS）** | ST-Prompt-Template 意图级移植（与酒馆助手是两个不同的上游扩展）：EJS 子集渲染器（默认）+ 沙箱渲染器（vm 隔离、超时硬中断）、注入 store、已处理历史消息跳过（ST 同款语义） |
| **交互闭环** | 回退 / 编辑 / 重新生成 / 变体、楼层口径（1 输入 = 1 楼）、剧情记忆、思考耗时 |
| **渲染** | 楼层头、思考折叠、代码块美化、状态栏、台词着色、卡前端 HTML（完整文档进沙箱 iframe） |

## 先说清楚

- 代码完全自研，没有一行 ST 源码——我们读的是 ST 的资产格式。
- 兼容做不到 100%（ST 自己发新版都会弄坏一批卡），我们按三级承诺推进（见下）。
- 全部本地运行，API Key 只存在本机，不收集也不上传你的数据。
- 仓库里没有角色卡、世界书或任何对话内容，全部需要你自己导入。

### 兼容分级（坏了报不报，看这里）

| 级别 | 承诺 | 范围 |
|---|---|---|
| **Tier 1** | 坏了算 bug，会修 | 上面「能做什么」的全部能力 |
| **Tier 2** | 尽力，坏了记 known issue | TH 记名 stub 名单之外的 API（当前 81 项拒收之外的增量）、EJS 完整语法（当前是子集：不支持函数调用 / 箭头函数 / 模板字符串 / 正则字面量）、采样参数长尾、复杂卡脚本逐卡适配、表格记忆长尾 |
| **Tier 3** | 明确不修 | 聊天历史改/删/轮转类 TH API（会话日志 append-only，回退/编辑走自有机制）、extension 作用域变量、`importRaw*`、ScriptTrees、音频播放器控制面、角色卡 CRUD 长尾、depth N 精确历史锚定 |

## Alpha 限制（务必读完）

| # | 限制 | 怎么办 |
|---|---|---|
| 1 | 升级到 DSH 0.1.5 时历史会话需迁移，**不可逆** | 80/80 真实会话迁移实测通过，但**迁移前请自行备份** |
| 2 | 旧聊天首次打开要等 | 151MB 会话约 1.7 秒；更大的更久 |
| 3 | 只有 arm64（真机）与 x86_64（模拟器）两种包 | 其他架构自行构建 |
| 4 | **设备时区必须是真实 IANA 名** | 若设为 `GMT` 等偏移式时区，表现为「发消息完全没反应」。测试期请设为 `Asia/Shanghai` 等标准时区 |
| 5 | Tier 2/3 的能力不完善或未实现 | 见上方分级表 |
| 6 | 界面与交互仍在调整 | 可能出现布局问题、按钮失效 |
| 7 | **在安卓端直接改 DSH 有「改到打不开」的风险** | 手机上的 DSH 是为跑起来裁剪过的（无 `bash`、无 `flock`…），改错一步 App 可能就再也打不开，而且**安卓侧没有第二个 harness 能救它**。要改 DSH，搬到 Windows / macOS 上改，改好再导回来 |

**数据安全**：重要会话请定期导出备份。任何迁移类操作前自行留存副本。

## 常见问题

**Q：发消息完全没反应？**
先查时区（限制 #4）。时区正常则查 API Key 与网络。

**Q：悬浮球拖不动 / 面板显示错位？**
移动端适配仍在打磨，属 Tier 2。

**Q：能导入 ST 的扩展吗？**
不能。但卡内脚本（酒馆助手生态）有兼容层，见「能做什么」。

**Q：我的数据会被上传吗？**
不会。网络请求只发往你自己配置的模型 API 端点。

**Q：能商用吗？**
可以（MIT 授权）。但注意生态上游的商业限制（见下方「法律边界」第 4 条）。

## 法律边界

1. 本仓库不含角色卡、世界书、对话记录——数据请自己准备，并自行确保合法性。
2. 通过你自己配置的 API 调用模型，服务商条款由你自己承担。
3. 仅供个人学习与自用，请勿分发你无权分发的内容。
4. ⚠️ 本项目自身以 MIT 授权，但兼容生态的上游 [JS-Slash-Runner（酒馆助手）](https://github.com/N0VI028/JS-Slash-Runner) 采用 AFPL、**明确禁止商业分发**。本仓库不含其任何源码，条款不传染到本项目；但如果你的使用场景会再分发 JS-Slash-Runner 本体或其生态脚本（预装、捆绑、随包分发），请自行核实并遵守其条款。
5. 本项目按「现状」提供，不附任何担保。数据丢失、账号风险、法律纠纷等后果由使用者承担。
6. 若您是权利人、认为本仓库侵权，请提 Issue（附文件与行号），核实后立即修改或移除。

---

# 第二部分：给想自己构建或改代码的人

## 安卓化技术路线（与 DSHA 的关系）

在安卓上运行 DSH 运行时，社区目前有两条已公开的技术路线。本项目是其中一条；另一条是 [DSHA](https://github.com/qiannianhuanxiang/DSHA)。两条路线的设计目标不同，结构也因此不同：

| 维度 | 本项目（bionic 原生路线） | DSHA（容器路线） |
|---|---|---|
| 运行方式 | Termux 编译的 Node 直接跑在 Android 的 bionic libc 上，少量二进制经 proot 包装 | 完整 Ubuntu 24.04 rootfs（glibc）装进容器，经 proot / proroot 运行 |
| 运行时形态 | 单个 Node 进程 + 少量子进程 | Ubuntu 完整进程树 |
| 包体 | 约 122 MB（14 个 `.so`，构建期从 Termux 官方源获取并校验 SHA256） | 约 370 MB（完整 rootfs） |
| 工具链 | bionic libc 的 API 覆盖小于 glibc：bash / ripgrep / 原生模块等需逐项适配（见「安卓平台限制」表） | 容器内是完整 glibc 环境，上游工具链直接可用 |
| phantom process killer（Android 12+，全系统后台子进程限 32 个） | 单进程形态天然在限值内 | 完整进程树需用户开启「停用子进程限制」类选项 |
| 鸿蒙 / 卓易通 | 已实测完整跑通（HarmonyOS 6 + 卓易通，实测日期 2026-09-19） | 官方标注「未验证」（截至 2026-09-19） |
| 定位 | RP 特化平台（装 APK 即用；底层同样是通用 DSH 安卓化 harness） | 通用 DSH 安卓化平台（含设备控制通道） |

两条路线**不是竞争关系**：

- 本项目的插件是**标准 DSH 插件**（零 DSH 源码改动，见「关于 DSH」），可装入任何标准 DSH 部署——包括 DSHA。拆包（[T-88](docs/T-88-PLUGIN-DECOMPOSITION.md)）完成后，每个插件都可独立安装。
- DSHA 面向「让 agent 在手机上跑起来并能操作手机」；本项目面向「把 SillyTavern 资产搬进一个 App」。两者的用户场景不重叠。
- 本项目的 RP 兼容层（世界书 / MVU / 酒馆助手 / 会话手术）在 DSHA 的能力面之外；DSHA 的设备控制通道（ADB 无线 / Shizuku）在本项目的功能面之外。

## 构建前置：原生库不入库

`jniLibs/*.so`（Node 二进制 + proot + busybox 等 14 个，约 100 MB）全部来自 Termux 官方源，其中 proot / busybox 是 GPL-2.0。本仓库不分发第三方二进制，改为**构建期获取**：

```
node rp-workspace/scripts/fetch-native-libs.mjs
```

脚本带 deb 级 SHA256 校验；首次需联网，之后幂等跳过。构建脚本 Step 0.1 会自动检查缺不缺。

## 安卓平台限制（改代码前必看）

> **这些限制不是终点。** 我们选择 bionic 原生路线时就清楚它意味着逐项适配的工作；接下来会**尽可能在这条技术路线的基础上想办法逐项解除这些限制**。✅ 2026-09-20 P1 已落地：bash / ripgrep / git / zstd 经 Termux 官方源内置（`runtime/bin/`，见 [NEXT-STEPS](docs/NEXT-STEPS-2026-09-19.md) P1）。

| 约束 | 表现 | 处置 |
|---|---|---|
| ~~无 `bash`~~ ✅ 已补齐 | DSH bash 工具 spawn EACCES | **已内置 Termux bash 5.3.15**（伪装 `libdsht-bash.so` 进 jniLibs + `runtime/bin/bash` symlink，P1 能力包）；保留 `/system/bin/sh` 兜底 |
| 无 `flock(2)` | 会话写锁抛错，**消息发不出去** | 单进程运行时按上游对 browser worker 的同款处置：立即成功 |
| SELinux 禁硬链接 | 会话日志无法 `link()` 发布 | 改 `rename()` |
| SELinux 只允许从 `nativeLibraryDir` 执行 | 应用目录的二进制无法 exec | 可执行文件改名 `.so` 放 `jniLibs`；runtime bin/ 由 NodeService 解压后补 +x |
| phantom process killer（Android 12+） | 后台子进程超 32 个即静默 SIGKILL | 前台服务 + 电池白名单；长任务建议开发者选项开「停用子进程限制」 |
| WebView 无 `zstd` 编码器 | 默认压缩的会话日志读不了 | 构建期补丁改明文 JSONL（保留：迁移管线在 WebView 侧）；✅ zstd 1.5.7 CLI 已内置（工具/agent 层可用） |
| ~~`ripgrep` 不可用~~ ✅ 已补齐 | linux 预编译版是 glibc | **已内置 Termux ripgrep 15.2.0**（伪装 `libdsht-rg.so` + `runtime/bin/rg` symlink，P1 能力包）；纯 JS 降级保留为 rg 缺席时的兜底 |
| ~~无 `git`~~ ✅ 已补齐 | 工作区快照/版本操作不可用 | **已内置 Termux git 2.55.0**（伪装 `libdsht-git.so` + `runtime/bin/git` symlink，P1 能力包）；本地版本操作可用，不带 git-core helpers（SELinux 下不可 exec，远程 clone 如实报错） |
| 原生模块不可用 | `sharp` / `koffi` / `node-pty` 等 | 平台 stub 替换，调用点抛受控错误 |

这些补丁集中在 `rp-workspace/scripts/apply-platform-patches.py` 与 `build-dsht.ps1`，幂等、带命中数断言。proot 路线的风险评估见 `docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md`（Android 15 起 seccomp 收紧会打断它）。

## 关于 DSH

运行时是 **DSH**（`@deepseek-ai/dsh`，MIT）。合规红线：

- DSH 官方源码与本地运行时**零修改**
- 所有个性化一律通过 DSH 官方插件机制实现（构建 7 个自研插件，生效 6 个；`dsht-plugin-undo` 有意不 compose 进 profile，它的 `/dsht-undo/*` 路由在 DSHTavern 下 404 属预期）
- 平台适配以构建期补丁形式注入（上面那张表）

## 代码逻辑结构

一条消息从发出到渲染的完整链路（括号里是代码位置）：

```
用户发消息
  │
  ▼
① 组装层 assemble（agent/request 瀑布）
   解析 RP 工作区 + 当前有效预设 ──────────── packages/src/dsh-plugin/
  │
  ▼
② pre-step 注入管线（agent/pre-step，按序执行）
   世界书：关键词扫描 + 预算裁剪 ──────────── packages/src/lore/
   角色卡 persona（过宏引擎）────────────── rp.json.promptPersona
   RP 预设快照（每轮从 preset.json 现值生成）─ packages/src/preset/
   正则（prompt 时机）───────────────────── packages/src/regex/
   状态树 / 剧情记忆 ─────────────────────── packages/src/state/ · dsht-plugin-memory/
  │
  ▼
③ 模型调用（llm/stream）
   规划：预设编译将迁移到这一层（bychv/dsh-preset-enhance）
  │
  ▼
④ 响应处理
   MVU 变量写（UpdateVariable / JSONPatch）─ packages/src/dsht-plugin-mvu/
   正则（display 时机）─────────────────── packages/src/regex/
  │
  ▼
⑤ 渲染与 UI
   楼层头 / 思考折叠 / 状态栏 / 沙箱 iframe ─ packages/src/dsht-rp-ui/
   酒馆助手桥接（tavern_events 82 项）────── packages/src/dsht-plugin-tavern-helper/
  │
  ▼
⑥ 会话手术（回退 / 编辑 / 重新生成 / 变体）
   逻辑回退 + 变量回滚 + 文件快照回滚 ────── dsh-plugin /rp/session-* 路由
```

## 项目结构

```
DSH RolePlay/
├─ rp-workspace/
│  ├─ packages/src/         自研源码
│  │  ├─ dsh-plugin/        RP 宿主插件（会话数据面 / 注入管线 / 导入引擎）
│  │  ├─ dsht-plugin-*/     自研插件包：MVU / 酒馆助手 / 提示词模板 / 记忆 / undo / mobile
│  │  │                     + dsht-plugin-shared（共享库）
│  │  ├─ import/            ST 资产导入导出
│  │  ├─ regex/ preset/ macros/ state/ lore/   兼容层各子系统
│  │  └─ dsht-rp-ui/        客户端 UI（React + TH shim）
│  ├─ android/              Android 壳（NodeService 拉起 DSH 运行时）
│  ├─ scripts/              构建 / 验证 / 诊断工具
│  └─ dsh-runtime-android/  DSH 运行时 staging（构建产物，不入库）
├─ docs/                    冻结清单 / 兼容契约 / 升级方案
└─ MASTER_TODO.md           现状与背景（唯一活文档）
```

**开发文档入口**：

| 想了解 | 看这里 |
|---|---|
| 现状与背景 | [MASTER_TODO.md](MASTER_TODO.md) |
| 兼容契约 | [ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| 功能冻结与承诺分级 | [V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| 上游许可清单 | [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) |
| 真机验证手册 | [B-DEVICE-VERIFY-CHECKLIST.md](docs/B-DEVICE-VERIFY-CHECKLIST.md) |
| 插件拆包方案 | [T-88-PLUGIN-DECOMPOSITION.md](docs/T-88-PLUGIN-DECOMPOSITION.md) |
| 社区插件适配指南 | [PLUGIN-COMPAT.md](docs/PLUGIN-COMPAT.md) |
| 补丁上游化评审 | [PATCH-UPSTREAM-REVIEW.md](docs/PATCH-UPSTREAM-REVIEW.md) |
| MVU 生态痛点调研 | [MVU-PAINPOINTS-2026-09-20.md](docs/MVU-PAINPOINTS-2026-09-20.md) |
| 长期目标（单源） | [GOAL.md](docs/GOAL.md) |

## 反馈与贡献

**Issue 与 Pull Request 都欢迎提。**

- **Issue**：报 bug（请附设备型号、Android 版本、复现步骤）或讨论想法
- **PR**：直接提即可。评审与合并由维护者负责，合并前可能请你改几轮
- 想当共同开发者 → 提 Issue 说明你打算做什么，由我指定后加为 collaborator（直接提交权限）

落在 Tier 3 范围的不兼容是预期行为，不算 bug。

完整口径见 [CONTRIBUTING.md](CONTRIBUTING.md)（两处措辞保持一致）。

---

# 附录

## 第三方兼容声明

1. 「酒馆助手兼容层」是**自研 API 语义复刻**——不含、不打包、不再分发 JS-Slash-Runner 或其生态脚本的任何源码。
2. 第三方角色卡脚本（如 MVU）由你的浏览器在运行时从公开 CDN 加载——其许可与分发责任归属原作者；需离线使用请自行确认许可。
3. 本项目不附赠任何角色卡 / 世界书 / 预设。

## 致谢

- **[DeepSeek](https://deepseek.com)** —— DSH 运行时（`@deepseek-ai/dsh`，MIT）
- **[dsh-preset-enhance](https://github.com/bychv/dsh-preset-enhance)**（bychv，MIT）—— ST 预设的加载 / 编辑 / 注入插件，自 v0.2.0-beta.3 起随包分发。RP 会话的预设注入已切换由它统一承担（被其绑定启用的会话，我方预设快照管线自动静默防双份，解绑即恢复）。注意：它的「预设模式」（st-preset）是给普通会话的玩法，**RP 会话请勿使用**（该模式会过滤掉 RP 注入所在的 system 消息，角色设定会整体丢失）——RP 会话保持默认模式 + 预设绑定即可
- **[Node.js](https://nodejs.org)**（MIT）、**[Termux](https://termux.dev)**（proot、busybox 二进制来源）、**[busybox](https://busybox.net)**（GPL-2.0，独立可执行文件聚合分发，源码获取方式见 [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)）
- **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** 及其社区 —— 兼容目标（资产格式与交互范式的定义者）
- **[JS-Slash-Runner（酒馆助手）](https://github.com/N0VI028/JS-Slash-Runner)**（AFPL）—— 脚本运行时 API 的兼容基准（自研复刻，不含其源码）
- **TauriTavern（Canary 分支）** —— 行为对齐基准（未复制其源码）
- 架构参考（均 MIT）：`hewzhew/dsh-agent-rp` · `aam452/dsh-worldbook` · `Czerror/dsh-plugin-prompt-tool` · `lutrodev/dsh-roleplay`
- 早期曾参考过 `flizzywine/dsh-tavern`（AGPL-3.0）与 `2428139739pregnant-web/agent-loop-rp`（未声明许可）的个别思路——**已全部以自研实现等效重写，现无任何引用**（审计见 [COPYRIGHT-AUDIT-FULL-2026-09-14.md](docs/COPYRIGHT-AUDIT-FULL-2026-09-14.md)）
- 所有角色卡 / 世界书 / 预设作者——内容生态的价值属于你们

## 许可证

本项目采用 **MIT** 许可证（见 [LICENSE](LICENSE)）。

- 内嵌的 DSH 运行时及其官方包为 MIT，仅作依赖使用、未做任何修改
- 打包物中无 copyleft 代码链接；busybox 为独立可执行文件聚合分发，其 GPL-2.0 义务见 [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)
- 生态上游的商业限制提示见「法律边界」第 4 条

---

# English

[中文](#dsh-tavern-for-android) ｜ **English**

Move your SillyTavern data (character cards / world books / presets / regexes / chat history) into one Android app.
Ready to use out of the box, fully local — nothing of yours gets uploaded.

**Current version**: `0.2.1` (bundles DSH `0.1.5-rc.1`)　|　**Status**: v0.2.1 stable (see verification matrix below; still a spare-time project — treat as early software)

## ⚠️ Read this first

- **Bugs are numerous**, some severe enough to break features, corrupt data, or require reinstall. **Don't make this your daily driver; don't use it on data you can't afford to lose.**
- A personal spare-time project; fixes come slowly (see "Feedback & Contributing" below).

**Verification matrix** (since 2026-09-20 every "verified" claim names its surface; contributions welcome — see [B-DEVICE checklist](docs/B-DEVICE-VERIFY-CHECKLIST.md)):

| Capability | x86_64 emulator | Real device (Mi 11 Pro) | HarmonyOS (EasyConnect) |
|---|---|---|---|
| First boot / session basics | ✅ tested | ✅ tested (earlier builds) | ✅ tested (2026-09-19, HarmonyOS 6) |
| Session migration (0.1.5) | ✅ 80/80 real sessions | — same as emulator | ⬜ untested |
| Preset pipeline (single injection via bychv) | ✅ tested (v368) | ⬜ untested (checklist ready) | ⬜ untested |
| MVU direct-card extraction (T2.3b) | ✅ tested (positive control PASS) | ⬜ untested | ⬜ untested |
| P1 toolchain (bash/rg/git/zstd) | ✅ tested (v370 self-test rc=0) | ⬜ untested (check logcat `P1 tool self-test` after install) | ⬜ untested |

Why is it public? Two reasons: to share a working approach for running the DSH runtime on Android, and because ST compatibility is a long tail no single person can finish — forks are welcome to keep going.

**AI collaboration disclosure**: design is human-led; code and docs were written with heavy AI involvement (Kimi K3 · DeepSeek V4 Flash 0731 · GLM 5.3 Flash · DeepSeek V4.1 Flash). Trust what the app actually does over what the docs claim.

---

# Part 1: For users

## Quick start

1. Download and install the APK for your architecture (`arm64` = real devices, `x86_64` = emulators). First launch unpacks ~24,000 files — let it finish.
2. Open the app → **Settings → Model** → enter your API key (DeepSeek official, or any OpenAI-compatible endpoint).
3. Sidebar bottom "🎭 Roleplay" → "Import" tab, pick an import mode:

   | Import mode | What it does |
   |---|---|
   | 📦 **Full data package** | A zip of your `data/` folder — cards, world books, chats, presets in one migration |
   | 🎴 **Character card** | A single PNG or JSON — creates a workspace + a session with the greeting |
   | 📚 **World book** | world JSON |

4. Back to the "Characters" tab, open a card and start chatting. **Try one card first to confirm the pipeline works, then import the full package.**

## What it can do

| Capability | Details |
|---|---|
| **Data migration** | ST full `data.zip`, character cards (PNG/JSON), world books, presets, chat history; resume mid-chat |
| **World book triggers** | constant / keywords (incl. regex, case, whole-word) / secondary keys / recursive scan / scanDepth / timed effects / mutual-exclusion groups / token budget |
| **Presets** | ST OpenAI Settings import (prompts + prompt_order + regex_scripts), per-entry toggles, switch anytime |
| **Regex** | three stages (display / prompt / permanent), placement, depth, substituteRegex, three-source scoping |
| **MVU** | `<UpdateVariable>` / `<JSONPatch>` full operators / `<initvar>` / `_.set` family / stat_data dual-tree merge / status bar |
| **Tavern Helper (JS-Slash-Runner)** | TH APIs split into local / bridged / named-refusal (counts grow with development — check the source); all 82 `tavern_events`; event ordering; script manager panel |
| **Prompt template (EJS)** | Intent-level port of ST-Prompt-Template (a *different* upstream extension from Tavern Helper): EJS-subset renderer (default) + sandboxed renderer (vm isolation, hard timeout), injection store, skip already-processed history messages (ST semantics) |
| **Interaction loop** | rollback / edit / regenerate / variants, floor numbering (1 input = 1 floor), plot memory, thinking time |
| **Rendering** | floor headers, collapsible reasoning, pretty code blocks, status bar, quote coloring, card frontend HTML (full documents in sandboxed iframes) |

## Up front

- Fully self-written code, zero lines of ST source — we read ST's asset formats.
- 100% compatibility is unreachable (ST itself breaks cards with new releases); we commit in three tiers (below).
- Fully local; your API key stays on the device; we collect and upload nothing.
- No character cards, world books, or any content in the repo — you import everything yourself.

### Compatibility tiers (whether a breakage is a bug — look here)

| Tier | Promise | Scope |
|---|---|---|
| **Tier 1** | Breakage counts as a bug and gets fixed | Everything in "What it can do" |
| **Tier 2** | Best effort, logged as known issues | TH APIs beyond the named-stub list (81 currently refused), full EJS syntax (currently a subset: no function calls / arrow functions / template literals / regex literals), sampling-parameter long tail, per-card script adaptation, table-memory long tail |
| **Tier 3** | Explicitly not supported | chat-history edit/delete/rotate TH APIs (session log is append-only; rollback/edit uses our own mechanism), extension-scope variables, `importRaw*`, ScriptTrees, audio player controls, character card CRUD long tail, depth-N exact history anchoring |

## Alpha limitations (please read all)

| # | Limitation | What to do |
|---|---|---|
| 1 | Upgrading to DSH 0.1.5 migrates old sessions, **irreversibly** | 80/80 real sessions migrated in tests, but **back up first** |
| 2 | First open of an old chat takes time | ~1.7s for a 151MB session; larger ones take longer |
| 3 | Only arm64 (devices) and x86_64 (emulators) builds | Build other architectures yourself |
| 4 | **Device timezone must be a real IANA name** | Offset-style zones like `GMT` cause "sending does nothing at all". Use `Asia/Shanghai` or similar during testing |
| 5 | Tier 2/3 capabilities are incomplete or unimplemented | See the tiers table |
| 6 | UI is still being adjusted | Expect layout glitches and dead buttons |
| 7 | **Editing DSH directly on Android risks bricking the app** | The on-device DSH is trimmed to run on phones (no `bash`, no `flock`…). One wrong edit can leave the app unable to start, and **there's no second harness on Android to rescue it**. To modify DSH, do it on Windows / macOS and import back |

**Data safety**: export important sessions regularly; keep a copy before any migration-like operation.

## FAQ

**Q: Sending does nothing at all?**
Check the timezone first (limitation #4). If it's fine, check your API key and network.

**Q: A floating ball won't drag / a panel is misaligned?**
Mobile adaptation is still being polished; Tier 2.

**Q: Can I import ST extensions?**
No. But in-card scripts (Tavern Helper ecosystem) have a compat layer — see "What it can do".

**Q: Will my data be uploaded?**
No. Network requests go only to the model API endpoint you configured.

**Q: Commercial use?**
Yes (MIT). But note the upstream commercial restriction (item 4 in "Legal boundaries").

## Legal boundaries

1. This repo contains no character cards, world books, or chat logs — bring your own data and ensure you're allowed to use it.
2. You call models through your own API configuration; the provider's terms are on you.
3. For personal study and self-use; don't distribute content you have no right to distribute.
4. ⚠️ This project is MIT-licensed, but the upstream of the compat ecosystem, [JS-Slash-Runner (Tavern Helper)](https://github.com/N0VI028/JS-Slash-Runner), is AFPL and **explicitly forbids commercial distribution**. This repo contains none of its source, so its terms don't carry over; but if your use case redistributes JS-Slash-Runner itself or its ecosystem scripts (preinstalling, bundling, shipping with your package), verify and comply with those terms yourself.
5. Provided "as is", no warranty. Data loss, account risk, and legal disputes are on the user.
6. Rights holders: if you believe this repo infringes you, open an Issue (with file paths and line numbers) — we'll fix or remove it promptly after verification.

---

# Part 2: For builders and contributors

## Android-ization approach (and how it relates to DSHA)

Two public approaches exist for running the DSH runtime on Android. This project is one of them; the other is [DSHA](https://github.com/qiannianhuanxiang/DSHA). They have different design goals, and therefore different structures:

| Dimension | This project (bionic-native approach) | DSHA (container approach) |
|---|---|---|
| How it runs | Termux-compiled Node runs directly on Android's bionic libc; a few binaries wrapped via proot | A full Ubuntu 24.04 rootfs (glibc) in a container, run via proot / proroot |
| Runtime shape | A single Node process + a few child processes | A full Ubuntu process tree |
| Package size | ~122 MB (14 `.so` files, fetched from the official Termux repo at build time with SHA256 verification) | ~370 MB (full rootfs) |
| Toolchain | bionic libc covers fewer APIs than glibc: bash / ripgrep / native modules need item-by-item adaptation (see "Android platform constraints") | Full glibc environment inside the container; upstream toolchains work directly |
| phantom process killer (Android 12+, system-wide 32 background child-process limit) | Single-process shape stays within the limit naturally | A full process tree requires the user to enable "disable child process restrictions"-type options |
| HarmonyOS / EasyConnect (卓易通) | Verified working end-to-end (HarmonyOS 6 + EasyConnect, verified on 2026-09-19) | Marked "unverified" upstream (as of 2026-09-19) |
| Positioning | An RP-specialized platform (ready to use out of the box; the underlying layer is equally a general DSH Android-ization harness) | A general DSH Android-ization platform (with a device-control channel) |

The two approaches **are not competitors**:

- This project's plugins are **standard DSH plugins** (zero modification to DSH source, see "About DSH") and can be installed into any standard DSH deployment — including DSHA. After the decomposition ([T-88](docs/T-88-PLUGIN-DECOMPOSITION.md)), each plugin is independently installable.
- DSHA targets "get an agent running on the phone and let it operate the phone"; this project targets "move SillyTavern assets into one app". The user scenarios don't overlap.
- This project's RP compat layer (world books / MVU / Tavern Helper / session surgery) is outside DSHA's capability surface; DSHA's device-control channel (wireless ADB / Shizuku) is outside this project's feature surface.

## Build prerequisite: native libs are not in the repo

`jniLibs/*.so` (Node binary + proot + busybox etc., 14 files, ~100 MB) all come from the official Termux repos; proot / busybox are GPL-2.0. This repo does not distribute third-party binaries — they're fetched at build time:

```
node rp-workspace/scripts/fetch-native-libs.mjs
```

The script verifies per-deb SHA256; the first run needs network, later runs skip idempotently. The build script's Step 0.1 checks automatically.

## Android platform constraints (read before modifying)

> **These constraints are not the end state.** We chose the bionic-native approach knowing it means item-by-item adaptation; next we'll **lift these constraints one by one on top of this same approach**. ✅ 2026-09-20 P1 landed: bash / ripgrep / git / zstd bundled from the official Termux repo (`runtime/bin/` — see P1 in [NEXT-STEPS](docs/NEXT-STEPS-2026-09-19.md)).

| Constraint | Symptom | Handling |
|---|---|---|
| ~~No `bash`~~ ✅ resolved | DSH bash tool spawn EACCES | **Termux bash 5.3.15 bundled** (disguised as `libdsht-bash.so` in jniLibs + `runtime/bin/bash` symlink, P1 capability pack); `/system/bin/sh` kept as fallback |
| No `flock(2)` | session write-lock throws — **messages can't be sent** | single-process runtime: succeed immediately (same as upstream's browser-worker handling) |
| SELinux forbids hard links | session logs can't be published via `link()` | use `rename()` |
| SELinux allows exec only from `nativeLibraryDir` | binaries in the app dir can't exec | rename executables to `.so` under `jniLibs`; NodeService chmods runtime bin/ +x after extraction |
| phantom process killer (Android 12+) | background child processes over 32 get silently SIGKILLed | foreground service + battery whitelist; for long tasks enable "Disable child process restrictions" in developer options |
| WebView lacks a `zstd` encoder | default-compressed session logs unreadable | build-time patch to plain JSONL (kept: migration pipeline runs WebView-side); ✅ zstd 1.5.7 CLI bundled (available to tools/agents) |
| ~~`ripgrep` unavailable~~ ✅ resolved | linux prebuilt is glibc | **Termux ripgrep 15.2.0 bundled** (disguised as `libdsht-rg.so` + `runtime/bin/rg` symlink, P1 capability pack); pure-JS fallback kept for when rg is absent |
| ~~No `git`~~ ✅ resolved | workspace snapshots / version ops unavailable | **Termux git 2.55.0 bundled** (disguised as `libdsht-git.so` + `runtime/bin/git` symlink, P1 capability pack); local version ops work, git-core helpers not shipped (not exec-able under SELinux; remote clone fails loudly) |
| Native modules unavailable | `sharp` / `koffi` / `node-pty` etc. | platform stubs; call sites throw controlled errors |

Patches live in `rp-workspace/scripts/apply-platform-patches.py` and `build-dsht.ps1`, idempotent with hit-count assertions. The proot route's risk assessment: `docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md` (Android 15's tightened seccomp will break it).

## About DSH

The runtime is **DSH** (`@deepseek-ai/dsh`, MIT). Compliance red lines:

- Zero modification to DSH's official source and local runtime
- All customization goes through DSH's official plugin mechanism (7 self-built plugins, 6 effective; `dsht-plugin-undo` is intentionally not composed into the profile — its `/dsht-undo/*` routes 404ing under DSHTavern is expected)
- Platform adaptation is injected as build-time patches (the table above)

## Code logic

The full pipeline of one message from send to render (with code locations):

```
User sends a message
  │
  ▼
① Assembly (agent/request waterfall)
   Resolve RP workspace + active preset ────── packages/src/dsh-plugin/
  │
  ▼
② pre-step injection pipeline (agent/pre-step, in order)
   World book: keyword scan + budget trim ──── packages/src/lore/
   Card persona (through macro engine) ─────── rp.json.promptPersona
   RP preset snapshot (regenerated per turn) ─ packages/src/preset/
   Regex (prompt stage) ────────────────────── packages/src/regex/
   State tree / plot memory ────────────────── packages/src/state/ · dsht-plugin-memory/
  │
  ▼
③ Model call (llm/stream)
   Planned: preset compilation moves here (bychv/dsh-preset-enhance)
  │
  ▼
④ Response handling
   MVU variable writes (UpdateVariable / JSONPatch) ─ packages/src/dsht-plugin-mvu/
   Regex (display stage) ───────────────────── packages/src/regex/
  │
  ▼
⑤ Rendering & UI
   Floor headers / reasoning folds / status bar / sandboxed iframes ─ packages/src/dsht-rp-ui/
   Tavern Helper bridge (82 tavern_events) ─── packages/src/dsht-plugin-tavern-helper/
  │
  ▼
⑥ Session surgery (rollback / edit / regenerate / variants)
   Logical rollback + variable restore + file snapshot restore ─ dsh-plugin /rp/session-* routes
```

## Project structure

```
DSH RolePlay/
├─ rp-workspace/
│  ├─ packages/src/         self-written source
│  │  ├─ dsh-plugin/        RP host plugin (session data plane / injection pipeline / import engine)
│  │  ├─ dsht-plugin-*/     self-built plugin packages: MVU / Tavern Helper / prompt template / memory / undo / mobile
│  │  │                     + dsht-plugin-shared (shared library)
│  │  ├─ import/            ST asset import/export
│  │  ├─ regex/ preset/ macros/ state/ lore/   compat subsystems
│  │  └─ dsht-rp-ui/        client UI (React + TH shim)
│  ├─ android/              Android shell (NodeService launches the DSH runtime)
│  ├─ scripts/              build / verify / diagnostic tools
│  └─ dsh-runtime-android/  DSH runtime staging (build artifact, not in repo)
├─ docs/                    freeze lists / compat contracts / upgrade plans
└─ MASTER_TODO.md           status & background (the only living document)
```

**Developer docs**:

| Topic | Where |
|---|---|
| Status & background | [MASTER_TODO.md](MASTER_TODO.md) |
| Compat contract | [ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| Feature freeze & tiering | [V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| Upstream licenses | [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) |
| Device verification | [B-DEVICE-VERIFY-CHECKLIST.md](docs/B-DEVICE-VERIFY-CHECKLIST.md) |
| Plugin decomposition plan | [T-88-PLUGIN-DECOMPOSITION.md](docs/T-88-PLUGIN-DECOMPOSITION.md) |
| Community plugin compat guide | [PLUGIN-COMPAT.md](docs/PLUGIN-COMPAT.md) |
| Patch upstream review | [PATCH-UPSTREAM-REVIEW.md](docs/PATCH-UPSTREAM-REVIEW.md) |
| MVU painpoints research | [MVU-PAINPOINTS-2026-09-20.md](docs/MVU-PAINPOINTS-2026-09-20.md) |
| Long-term goal (single source) | [GOAL.md](docs/GOAL.md) |

## Feedback & contributing

**Issues and Pull Requests are both welcome.**

- **Issues**: report bugs (include device model, Android version, repro steps) or discuss ideas
- **PRs**: open them directly. Maintainers review and merge; you may be asked for a few rounds of changes
- Want to be a co-developer → open an Issue describing what you plan to do; once approved I'll add you as a collaborator (direct commit access)

Tier 3 incompatibilities are expected behavior, not bugs.

Full policy: [CONTRIBUTING.md](CONTRIBUTING.md) (wording is kept consistent between the two).

---

# Appendix

## Third-party compatibility statement

1. The "Tavern Helper compat layer" is a **self-written API re-implementation** — it contains, bundles, and redistributes no source from JS-Slash-Runner or its ecosystem scripts.
2. Third-party card scripts (e.g. MVU) are loaded by your browser from public CDNs at runtime — their licenses and distribution obligations belong to their authors; check the license yourself if you need offline use.
3. This project ships no character cards, world books, or presets.

## Acknowledgements

- **[DeepSeek](https://deepseek.com)** —— the DSH runtime (`@deepseek-ai/dsh`, MIT)
- **[dsh-preset-enhance](https://github.com/bychv/dsh-preset-enhance)** (bychv, MIT) —— SillyTavern preset loading / editing / injection plugin, shipped with the app since v0.2.0-beta.3. Preset injection for RP sessions is now handled by it (for sessions with its binding enabled, our own preset snapshot pipeline stays silent to avoid double injection, and resumes once unbound). Note: its "preset mode" (st-preset) is meant for plain sessions — **do not use it for RP sessions** (that mode filters out the system message carrying all RP injections, so the character definition is lost entirely); keep RP sessions on the default mode with preset binding
- **[Node.js](https://nodejs.org)** (MIT), **[Termux](https://termux.dev)** (source of proot & busybox binaries), **[busybox](https://busybox.net)** (GPL-2.0, distributed as an independent executable; source access in [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md))
- **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** and its community — the compat target (definer of the asset formats and interaction patterns)
- **[JS-Slash-Runner (Tavern Helper)](https://github.com/N0VI028/JS-Slash-Runner)** (AFPL) — the script-runtime API compat reference (self-written re-implementation, no source included)
- **TauriTavern (Canary branch)** — the behavior-alignment reference (no source copied)
- Architecture references (all MIT): `hewzhew/dsh-agent-rp` · `aam452/dsh-worldbook` · `Czerror/dsh-plugin-prompt-tool` · `lutrodev/dsh-roleplay`
- Early versions borrowed individual ideas from `flizzywine/dsh-tavern` (AGPL-3.0) and `2428139739pregnant-web/agent-loop-rp` (no declared license) — **all since re-implemented from scratch; nothing of them remains** (audit: [COPYRIGHT-AUDIT-FULL-2026-09-14.md](docs/COPYRIGHT-AUDIT-FULL-2026-09-14.md))
- All character card / world book / preset authors — the ecosystem's value belongs to you

## License

**MIT** (see [LICENSE](LICENSE)).

- The bundled DSH runtime and its official packages are MIT, used as dependencies without modification
- No copyleft code is linked in the shipped artifacts; busybox is distributed as an independent executable (aggregation) — its GPL-2.0 obligations are in [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)
- Upstream commercial restriction: item 4 in "Legal boundaries"