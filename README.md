# DSHTavern

> **一句话**：把你的 SillyTavern 数据（角色卡 / 世界书 / 预设 / 正则 / 聊天记录）搬进一个安卓 App，
> 用 DSH 运行时驱动，体验向 SillyTavern 对齐。

**当前版本**：`0.2.0`（内嵌 DSH `0.1.5-rc.1`）　|　**状态**：⚠️ **Alpha（早期测试版）**

---

## 设计思路与架构取舍

这一节解释**为什么是这样做的** —— 读它能明白项目的能力边界从何而来。

### 为什么自建运行时，而不是套壳浏览器？

安卓上跑 Node.js 服务有几条路，我们选了最重的一条，理由如下：

| 方案 | 为什么不选 / 为什么选 |
|---|---|
| ❌ WebView 套一个网页版 ST | ST 是 Node 服务 + 浏览器前端，套壳等于**在手机上再跑一个 ST**，性能与后台存活都不可控 |
| ❌ Termux + 用户手动配置 | 要求用户会命令行；且 Termux 自身受 phantom process killer 困扰（见下） |
| ❌ 云端容器 + 瘦客户端 | 需要服务器与账号，**与「全部本地运行、不上传数据」的承诺冲突** |
| ✅ **自建宿主：把 DSH 运行时打进 APK** | 用户装上即用；数据全在本地；后台靠前台服务保活 |

**代价（诚实说明）**：装机包 122MB（含 Node 二进制 + 运行时 + 依赖），首启需解压 2.4 万个文件。

### 为什么把 `jniLibs/*.so` 入库（约 100 MB）？

`jniLibs/` 下是 **Node 二进制 + proot + busybox + 依赖库**（14 个 `.so`，实测 100.3 MB）。
把它们入库是**有意决策**：

- ✅ **好处**：`clone` 即可构建，不需要用户自己下载 Termux deb 包并提取
- ⚠️ **代价**：仓库永久增加约 100 MB
- **为什么值得**：这些二进制的获取链路（Termux APT 仓库 → deb 提取 → 交叉校验 ABI）
  极其繁琐且易错，让每个想自己构建的人都踩一遍不现实

### 为什么需要 proot？

**背景**：DSH 的进程级沙箱在桌面用 bubblewrap / Landlock / Windows ACL。
但安卓上：无 bubblewrap、5.4 内核无 Landlock（主线 5.13 才合入）、
user namespaces 对 app 域不可用 ⇒ **任何受限模式都直接拒绝执行**。

**处置**：分两层
1. **降级层**：识别到无沙箱后端时，返回 `enforcement: "unusable"`，由文件系统边界兜底
2. **真隔离层**：用 **proot**（用户态 chroot，ptrace 拦截系统调用改写路径）包装命令，
   达到 `enforcement: "full"`

**代价（诚实说明）**：
- proot 每条系统调用要过 ptrace（I/O 密集场景开销明显）
- 在**量产 user 固件**上，proot 把 loader 拷到应用缓存目录再 exec，可能被
  SELinux neverallow 拦截 ⇒ 探测失败 ⇒ **自动回退到文件系统边界**（无进程隔离）
- ⚠️ **Android 15 起收紧 seccomp，proot 路线会被打断**（`SIGSYS`）。这是上游平台变化，
  我们已记录并评估替代方案（见 `docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md`）

### 安卓平台限制（诚实说明）

安卓不是一个「什么都能跑」的系统。以下是本项目**必须绕开**的平台约束：

| 约束 | 表现 | 我们的处置 |
|---|---|---|
| **无 `bash`** | DSH 的 bash 工具硬编码 `bash -c` ⇒ spawn EACCES | 平台感知改用 `/system/bin/sh`（mksh） |
| **无 `flock(2)`** | 会话写锁抛 `ERR_FLOCK_UNSUPPORTED_PLATFORM` ⇒ **消息发不出去** | 单进程运行时按上游对 browser worker 的同款处置：立即成功 |
| **SELinux 禁硬链接** | 会话日志用 `link()` 原子发布 ⇒ EACCES ⇒ **无法落盘任何会话** | 改 `rename()`（单进程无并发风险） |
| **SELinux 只允许从 `nativeLibraryDir` 执行** | 放在应用目录的二进制无法 exec | 所有需执行的二进制改名 `.so` 放 `jniLibs`（系统解压时保留 exec 位） |
| **phantom process killer**（Android 12+） | **全系统**后台子进程超 32 个即静默 SIGKILL | 前台服务 + 电池白名单；长任务建议开启开发者选项「停用子进程限制」 |
| **无 `zstd` 编码器**（WebView） | 默认压缩的会话日志 WebView 读不了 | 构建期补丁改 `compression: 'none'`（明文 JSONL） |
| **`ripgrep` 不可用** | linux 预编译版是 glibc，bionic 加载不了 | 纯 JS 降级实现（glob 递归枚举 + 逐行正则） |
| **原生模块不可用** | `sharp` / `koffi` / `node-pty` 等含原生二进制 | 平台 stub 替换（可加载但不可用，调用点抛受控错误） |

> 这些补丁**全部可查、幂等、带命中数断言**，集中在
> `rp-workspace/scripts/apply-platform-patches.py` 与 `build-dsht.ps1`。
> 两条路径的补丁集等价性有常驻判据守护（`scripts/audit-build-path-parity.py`）。

---

## 第三方兼容声明（重要）

为免误解，明确划清边界：

1. **本项目的「酒馆助手兼容层」是自研 API 语义复刻** ——
   不含、不打包、不再分发 [JS-Slash-Runner（酒馆助手）](https://github.com/N0VI028/JS-Slash-Runner)
   或其生态脚本的任何源码。
2. **你使用的第三方角色卡脚本**（如 MVU）由**你的浏览器在运行时从公开 CDN 加载** ——
   这是用户侧行为，其许可与分发责任归属原作者。
3. **如需离线使用某个脚本**，请自行确认该脚本的许可条款。
4. **本项目不附赠任何角色卡 / 世界书 / 预设** —— 你的数据全部由你自己导入。

上游许可清单（含逐项使用方式）见 [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)。

---

## 这是什么

一个**安卓角色扮演 App**。它不重写整套生态，而是做两层事：

| 层 | 做什么 |
|---|---|
| **兼容层**（兼容层 / compat layer） | 把 SillyTavern 的**资产格式**（角色卡 PNG/JSON、`data/` 整包、世界书、OpenAI Settings 预设、正则脚本、聊天记录）翻译成 DSH 原生形态去执行 |
| **原生宿主** | 在安卓上跑 DSH 运行时（Node.js + WebView UI），把翻译后的资产呈现给用户 |

**用户旅程**：导入 zip → 跑 `st-migration` 适配 skill → 获得与 ST 同等乃至更好的体验。

已实现的兼容面（Tier 1，坏了算 bug）：

- **数据迁移**：ST 整包 `data.zip`、角色卡（PNG/JSON）、世界书、预设、聊天记录导入导出，聊到一半接着聊
- **世界书触发**：constant / 关键词（正则、大小写、全词）/ 副关键词 / 递归 / scanDepth / timed effects / 互斥组 / token 预算
- **预设**：ST OpenAI Settings 导入（prompts + prompt_order + regex_scripts）、条目开关、随时切换
- **正则**：三时机（display/prompt/permanent）、placement、depth、substituteRegex、三源作用域
- **MVU**：`<UpdateVariable>` / `<JSONPatch>` 全操作符 / `<initvar>` / `_.set` 系 / stat_data 双树合并 / 状态栏
- **酒馆助手（JS-Slash-Runner）**：71 个 API（28 本地 + 43 桥接）、`tavern_events` 82 项全表、事件时序、脚本管理面板
- **交互闭环**：回退 / 编辑 / 重新生成 / 变体、楼层口径（1 输入 = 1 楼）、剧情记忆插件、思考耗时
- **渲染**：楼层头、reasoning 折叠、代码块美化、状态栏、台词着色

---

## 这不是什么

**请先读这一节，它能省掉你大量困惑。**

| 不是 | 说明 |
|---|---|
| ❌ **不是 SillyTavern 的移植版 / 分支** | 没有一行 ST 源码。我们做的是**读它的资产格式**，不是搬它的实现 |
| ❌ **不是 100% 兼容** | ST 自己发新版都会弄坏一批卡；**100% 兼容在地球上不存在**。我们给的是**分级承诺**（见下） |
| ❌ **不是云端服务** | 全部本地运行；不收集、不上传你的任何数据。你的 API Key 只存在本机 |
| ❌ **不是内容提供方** | 不含任何角色卡 / 世界书 / 对话内容。数据**全部由你自己导入** |
| ❌ **不是稳定版** | 见下方「Alpha 限制声明」 |

### 兼容分级（我们对你的承诺口径）

| 级别 | 承诺 | 范围 |
|---|---|---|
| **Tier 1 承诺** | 坏了**算 bug**，会修 | 上节「这是什么」列出的全部能力 |
| **Tier 2 尽力** | 坏了记 known issue，每项设时间盒 | TH 长尾 API（约 50 项记名 stub 之外的增量）、EJS 完整语法（当前是子集：不支持函数调用/箭头函数/模板字符串/正则字面量）、采样参数长尾（等上游适配器）、复杂卡脚本逐卡适配、表格记忆长尾 |
| **Tier 3 不承诺** | **明确不修**，别在这上面等 | 聊天历史改/删/轮转类 TH API（架构决策：会话日志 append-only，回退/编辑走自有机制）、extension 作用域变量、`importRaw*`、ScriptTrees、音频播放器控制面、角色卡 CRUD 长尾、depth N 精确历史锚定 |

---

## 法律边界（请务必阅读）

1. **不附带任何受版权保护的内容**。本仓库不含角色卡、世界书、对话记录。你需要自己准备这些数据。
2. **请自行确保你导入内容的合法性**。角色卡与设定文本的版权归原作者所有；请遵守其授权条款。
3. **第三方服务条款由你自己承担**。App 通过你自己配置的 API（DeepSeek 官方或任意 OpenAI 兼容端点）调用模型；请遵守相应服务商的使用条款。
4. **仅供个人学习与自用**。请勿用于任何违法用途，请勿分发你无权分发的内容。
5. **上游组件的许可**：内嵌的 DSH 运行时及其官方包为 **MIT** 许可，仅作依赖使用、**未做任何修改**（见下方「关于 DSH」）。SillyTavern、JS-Slash-Runner（酒馆助手）为其各自作者的作品，本项目与之**无隶属关系**，仅做**格式与 API 兼容**。

---

## 关于 DSH（重要）

本项目的运行时是 **DSH**（`@deepseek-ai/dsh`，MIT），运行在安卓上。

**合规红线（我们严格遵守）**：

- ✅ DSH **官方源码与本地运行时零修改**
- ✅ 所有个性化**一律通过 DSH 官方插件机制**实现（7 个自研插件）
- ⚠️ 平台适配（安卓平台无 `flock(2)`、缺 win32 专用包等）以**构建期补丁**形式注入，且全部可查、幂等、带命中数断言（`scripts/apply-platform-patches.py`）

---

## Alpha 限制声明（务必读完）

> **这是一个早期测试版。请在知情的前提下使用。**

已知限制：

| # | 限制 | 影响 |
|---|---|---|
| 1 | **升级到 DSH 0.1.5 时，历史会话需要迁移，且不可逆** | 我们已把「打不开的旧会话」修复率做到 100%（80/80 真实会话实测），但**迁移前请自行备份** |
| 2 | **旧聊天首次打开可能需等待** | 实测 151MB 会话迁移耗时 **1.7 秒**，毫秒级；超大会话（>100MB）会更久 |
| 3 | **仅提供 arm64（真机）与 x86_64（模拟器）两种构建** | 其他架构需自行构建 |
| 4 | **设备时区必须是真实 IANA 名** | 若系统时区被设为 `GMT` 等偏移式时区，表现为「发消息完全没反应」（宿主拒收 `+00:00`）。测试期请设为 `Asia/Shanghai` 等标准时区 |
| 5 | **Tier 2/3 列出的能力不完善或不做** | 见上方分级表 |
| 6 | **界面与交互仍在调整** | 可能出现布局问题、按钮失效等；欢迎通过 Issues 反馈 |

**数据安全建议**：重要会话请定期导出备份。我们做了多层回滚保险，但**任何迁移类操作前请自行留存副本**。

---

## 致谢

- **[DeepSeek](https://deepseek.com)** —— DSH 运行时（`@deepseek-ai/dsh`，MIT）
- **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** 及其社区 —— 定义了角色扮演的资产格式与交互范式，本项目的兼容目标
- **[JS-Slash-Runner（酒馆助手）](https://github.com/N0VI028/JS-Slash-Runner)** —— 脚本运行时 API 的兼容基准
- **所有角色卡 / 世界书 / 预设作者** —— 你们创作的内容是这个生态真正的价值所在

---

## 快速开始

1. 下载并安装对应架构的 APK（arm64 = 真机，x86_64 = 模拟器）
2. 打开 App，进入 **设置 → 模型**，填入你的 API Key（DeepSeek 官方，或任意 OpenAI 兼容端点）
3. 回到侧栏底部「🎭 角色扮演」→「导入」页：
   - 📦 **完整数据包**（`data/` 文件夹 zip）—— 角色卡 / 世界书 / 聊天记录 / 预设一次迁移
   - 🎴 **角色卡**（PNG/JSON）—— 生成一个工作区 + 带开场白的会话
   - 📚 **世界书**（world JSON）
4. 导入完成后回到「角色」页，点开角色卡即可开聊

---

## 项目结构（给想深挖的人）

```
DSH RolePlay/
├─ rp-workspace/
│  ├─ packages/src/         自研源码（实测 120 文件 / 44,446 行，不含 lib/ 产物）
│  │  ├─ dsh-plugin/        RP 宿主插件（会话数据面 / 注入管线 / 导入引擎）
│  │  ├─ dsht-plugin-*/     7 个自研包：MVU / 酒馆助手 / 提示词模板 / 记忆 / undo / mobile
│  │  │                     + dsht-plugin-shared（共享库，非独立插件）
│  │  ├─ import/            ST 资产导入导出
│  │  ├─ regex/ preset/ macros/ state/ lore/   兼容层各子系统
│  │  └─ dsht-rp-ui/        客户端 UI（React + TH shim）
│  ├─ android/              Android 壳（NodeService 拉起 DSH 运行时）
│  ├─ scripts/              构建 / 验证 / 诊断工具
│  └─ dsh-runtime-android/  DSH 运行时 staging（构建产物，不入库）
├─ docs/                    冻结清单 / 兼容契约 / 差异对照 / 升级方案
├─ MASTER_TODO.md           现状与背景（唯一活文档）
└─ TASK-LIST.md             任务清单（做什么、按什么顺序、做完的标志）
```

**开发文档入口**：
- 现状看 [MASTER_TODO.md](MASTER_TODO.md)，行动看 [TASK-LIST.md](TASK-LIST.md)
- 兼容契约 [ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md)
- 功能冻结与承诺分级 [V0.3-FREEZE.md](docs/V0.3-FREEZE.md)
- 上游许可清单 [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)
- 安卓 harness 工程化评估 [C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md](docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md)
- 真机验证手册（含采集命令与判读表）[B-DEVICE-VERIFY-CHECKLIST.md](docs/B-DEVICE-VERIFY-CHECKLIST.md)
- 已知欠债（8 项「实现已写好、接线未落地」的失败测试）[KNOWN-DEBT-unwired-tests-2026-09-13.md](docs/KNOWN-DEBT-unwired-tests-2026-09-13.md)
- AI 协作规则 [AI-COLLAB-RULES.md](AI-COLLAB-RULES.md)

---

## 反馈

这是 Alpha 版，**你的反馈很重要**。请通过 Issues 提交：

- 🐛 Bug（附上复现步骤；如涉及具体角色卡，请**脱敏**后再贴）
- 💡 建议
- 📋 兼容性报告（哪张卡 / 哪个预设 / 哪个脚本不工作）

提交前请先读一下上方「这不是什么」——如果落在 **Tier 3（明确不承诺）** 范围内，我们可能不会修，但依然欢迎你告诉我们。
