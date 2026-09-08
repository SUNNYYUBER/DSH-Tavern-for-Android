# DSHTavern 个性化改动合规审计报告（2026-09-04）

> 审计问题：**我们的所有个性化改动是否符合「不动 DSH 源代码、以插件形式存在」等既定要求？**
> 审计方法：全量扫描 DSH 官方产物的修改痕迹（DSHT 补丁哨兵标记）+ 枚举自研代码落位 +
> 核对加载机制（官方 loader/patch layer vs 私改）。
> 结论先行：**✅ 整体合规。** 全部功能以官方插件机制存在；DSH 官方源（安装源 + PC 本地
> runtime）零修改；唯一的例外是 **Android 打包副本的 9 处平台适配补丁 + 6 类原生包 stub**——
> 属既定方案（M0/M1 真机调试期确立、UPDATE-SOP 坑清单在案），本轮逐条复核无行为越界。

## 1. 修改痕迹扫描（DSHT-ANDROID 哨兵标记）

| 目录 | 定位 | DSHT 修改命中 | 判定 |
|---|---|---|---|
| `dsh-runtime-src/`（DSH 官方包安装源） | 干净参考 | **0** | ✅ 官方源未动 |
| `dsh-runtime/`（PC 本地开发 runtime） | 开发环境 | **0** | ✅ 官方源未动 |
| `dsh-runtime-android/`（安卓打包副本） | 打包产物 | 9 个文件 | ⚠️ 见 §3（平台适配，既定方案） |

## 2. 合规面：全部功能以官方插件机制存在

**Cordis 插件（6 个，经官方 cordis.patch.yml patch layer 注入 profile）**：

| 插件 | 功能 | 加载机制 |
|---|---|---|
| dsht-rp-plugin | RP 世界书触发/宏/正则/变体/导入数据面 + 浏览器 RP UI（单包双面） | patch layer `insert` + 官方 ModuleLoader wire（`window.__ModuleLoader__.load`） |
| dsht-plugin-memory | 剧情记忆总结 + 上下文影子化瘦身 + 展开回显 | 同上 |
| dsht-plugin-tavern-helper | 酒馆助手脚本兼容层（含 preset in_use 哨兵/导出） | 同上 |
| dsht-plugin-mvu | MVU 变量框架桥 | 同上 |
| dsht-plugin-prompt-template | 提示词模板 | 同上 |
| dsht-plugin-mobile | 移动端适配 | 同上 |

- 插件与 DSH 内核的**全部交互**走官方契约：`agent/pre-step` waterfall 事件、
  `session.append`（含官方 surfaceOp replace 原语）、`ctx.settings` 命名空间、
  `ctx.webServer` 前缀路由、`ctx.llm`/`ctx.agentDefaultModel` 服务、
  UI 侧官方 slots（conversation.chat.node / input.dock / shell.overlay 等）与
  `useSession` 快照。
- **runtime 类型仅 type-only import（构建期擦除）**——插件 bundle 不 require 任何
  @deepseek-ai 内部模块（构建产物可证：esbuild externals 零 @deepseek-ai）。
- 自研共享库（lore/preset/regex/import/state/macros/dsht-plugin-shared）全部内联进
  插件 bundle，不落 DSH 目录。

**配置面（数据，非代码）**：settings.yaml 的 contextWindow 对齐（st-custom 500k → **1M，
与 llm-deepseek 官方条目一致**，2026-09-04 修正——此前保守值造成"500k 上限"误判）、
记忆插件设置命名空间、agent-presets.default。均为官方配置项。

## 3. 例外清单（Android 打包副本，既定方案，逐条复核）

以下修改**只存在于安卓打包副本**（`dsh-runtime-android/`），全部带 `DSHT-ANDROID-*`
哨兵标记、幂等（重复构建跳过）、带期望命中数断言（DSH 升级后形态变化会显式报错），
由 build-dsht.ps1 构建期自动重打：

| # | 文件 | 补丁 | 原因（Android 平台约束） | 哨兵 |
|---|---|---|---|---|
| 1 | dsh-session-persistence-jsonl | link()+unlink() 原子发布 → rename() | SELinux 禁 app 进程硬链接（坑 #14），不打则无法落盘任何 session | l-RENAME-PATCH |
| 2 | dsh-terminal-bash | 默认 shell /bin/bash → /system/bin/sh | Android 无 bash | l-TERM-SHELL/ARGS |
| 3 | dsh-bash-sandbox / dsh-bash-local（×2 处） | 同上 shell 路径 | 同上 | l-SH |
| 4 | dsh-tool-fs-search | rg 二进制缺失 → 纯 JS glob/grep 降级 | Android 无 rg 可执行 | l-JS-SEARCH |
| 5 | dsh-sandbox-local | 无 bwrap/Landlock/ACL 后端 → 不拒绝 + warn（fs 层工作区边界）+ **PRoot 用户态真隔离包装** | Android 无沙箱后端 | l-UNSANDBOXED / l-PROOT |

**Stubs（六件套，原生二进制包的 Android 空实现）**：sharp / koffi / node-pty /
node-addon-landlock-run / node-addon-require-builtin / dsh-sandbox-windows-acl——
均含 **native 二进制**（.node/.so）在 Android 上根本无法加载，stub 保持官方模块导出面
（DSH 自身 require 不断链）。构建期覆盖打包副本。

**Android 壳工程（rp-workspace/android）**：DSHTavern 本身就是我们自己的 APK 壳
（MainActivity/NodeService/清单），**不属于 DSH 源码**——DSH 官方无 Android 端，
本壳是项目主体之一。

## 4. 行为边界复核（本轮新增改动逐条过堂）

| 本轮改动 | 形式 | 合规 |
|---|---|---|
| 楼层号徽章 | 插件 UI 席位组件（useSession 快照只读） | ✅ |
| ④⑤ 展开/窗口（含影子化扩展） | 插件 pre-step + 官方 replace 原语 + compaction/prune 官方计量事件 | ✅ |
| in_use 哨兵 / 预设导出 | 插件 facade 路由 | ✅ |
| token 计量真实口径 | 插件 dock 席位组件（快照只读） | ✅ |
| 摘要字数上限 | 插件 settings 命名空间 | ✅ |
| contextWindow 1M 对齐 | settings.yaml 配置值 | ✅（配置非代码） |

## 5. 残余风险与建议

1. **DSH 升级风险（已有 SOP）**：升级后安卓副本补丁会被新包覆盖——build-dsht.ps1 的
   Dsht-Patch 带期望命中断言会显式报错提醒重打（UPDATE-SOP 流程已覆盖）。
2. **平台补丁的行为面**：9 处补丁均为"让 DSH 在 Android 上能跑/不崩"的平台适配，
   未引入 DSH 之外的语义（PRoot 隔离增强反而是安全增益）。
3. **建议**：若未来 DSH 官方提供 Android 官方支持或补丁点上游化（如 shell 可配置），
   应优先回收补丁（每个补丁的替换前后形态都在 build-dsht.ps1 内联注释）。

## 6. 结论

- **「不动 DSH 源代码」**：官方安装源与 PC runtime 零修改（扫描 0 命中）✅；
  安卓打包副本的 9 处补丁 + 6 类 stub 为 Android 平台适配的既定方案（哨兵/幂等/断言
  三重纪律），非功能私改 ✅。
- **「以插件形式存在」**：全部个性化功能（RP/记忆/TH 兼容/MVU/模板/移动端）经官方
  cordis patch layer 与官方插件加载器存在，可随 profile 卸载拔除 ✅。
- **「前端原生优先」**：RP UI 全部走官方 slots/席位（无自建聊天界面）✅。
