# DSH Tavern for Android v0.2.3

主题：**够了设备能力**（[GOAL-DSH-ANDROID-COMPLETE](docs/GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) 主线 W-1~W-5 + 产品面 W-6~W-11）——终端真正可用、图片通道打通、设备能力可被 agent 调用，并补齐导入链路的用户文档。

## 本版增量

- **内置终端真正可用**（W-1）：node-pty 走 NDK 交叉编译产出双架构原生模块。**关键翻案**：原方案假设「bionic 无 `openpty`/`forkpty`，需 ~50 行 shim」——实测为**错**：bionic libc 自 API 23 起原生提供全部 PTY 符号，NDK 29 的 `<pty.h>` 就在场 ⇒ **零 shim、零额外库**。模拟器端到端实证：`spawn` 出真实伪终端 `/dev/pts/0`、`write→onData` 交互闭环、`SIGKILL` 正常回收。
- **图片通道打通**（W-5）：sharp 官方 prebuild 不含 Android（bionic 与 glibc 不兼容），改用官方 WebAssembly 版 `@img/sharp-wasm32`——**不写任何转发层**，sharp 主包自带 wasm 兜底分支。实测 19/19 判据通过：metadata 契约完整、jpeg/webp 编码、raw 全解码、resize/rotate/colourspace、png-jpeg-webp-gif 四格式、libvips 8.18.6（满足 DSH `>=8.18.6`）。并修掉一处**潜伏静默失败**：原 stub 的 `toBuffer/toFile/resize` 是静默空实现，已收紧为受控报错。
- **设备能力工具集**（W-3）：新增 `device_screenshot` / `device_status` / `device_notifications` / `device_input` 四个 agent 工具，经本机 HTTP → native 设备桥执行。**命令构造固定在 native 层**（`List<String>` 数组，不经 shell）⇒ 结构上免疫命令注入；工具只传**枚举 op + 校验过的参数**。
- **危险操作守门人**（W-4）：操作其它应用的动作（点击/滑动/输入）归 **danger 档**，需用户显式批准——挂起 + 高优先级通知（拒绝/批准本次），**默认拒绝**、**单次有效**，三态决策入审计日志。
- **Shizuku 通道骨架**（W-2）：五态状态机（未安装/未运行/未授权/不支持/就绪）+ 配对引导。调研结论已定案并写入文档（含三处联网更正）。
- **共享交换目录**（W-6）：`/sdcard/Documents/dsht-exchange/` ↔ App 私有区显式双向通道，文件管理器与 App 互拷；**凭据永不参与**（清单双向拒绝，与备份排除清单同源）。
- **能力-权限矩阵看板**（W-7）：自检面板升级为能力看板——每行 = 能力 / 状态 / 原因 / 一键跳转。
- **导入适配流程补进 README**（W-11）：补上导入链路里最关键的一环——点确认后 App 自动新建「ST 数据适配」会话、替你发开工消息、由适配 agent 读 `st-migration` skill 完成迁移，**用户必须等待**；并写明该步要用的模型、耗时量级、中断可断点续跑。中英双语同步。

## 修复（发版前真机实测暴露，三层连环）

本版最常见的失败面是「插件层的一个错误 → 整个 DSH 起不来（boot loop）」。三层都已修并加常驻门禁防回归：

- **部署面漏包**：插件进了 patch 清单却没进拷贝循环 ⇒ patch 引用一个 App 从不部署的包 ⇒ 加载失败。**只在干净安装暴露**（老设备上的孤儿目录会造成「包在场」假象）。
- **依赖声明层级错**：把 agent 会话面服务写进顶层 `inject`，而插件挂在 web profile 全局层（该层没有这些服务）⇒ 父 fiber 永久等待。改用官方 `ctx.inject([...], cb)` 延迟接线（依赖就绪才注册，缺席则安静等待、**不抛**）。
- **`patchReload: "live"` 在 Android 不可满足**：它要求 Cordis HMR 服务，而 HMR 在本平台起不来 ⇒ 启动即抛。Android 定案 `"startup"`（App 内 patch 由原生层幂等维护，不存在「手编 patch 期望热生效」的场景）；并修掉老安装升级时旧值残留的路径。

## 安装包

| 文件 | 架构 | 用途 |
|---|---|---|
| `DSH-Tavern-0.2.3-arm64-release.apk` | arm64 | **真机**（小米 / 华为卓易通） |
| `DSH-Tavern-0.2.3-x86_64-debug.apk` | x86_64 | PC 模拟器自测 |

覆盖安装保留数据；runtime sentinel **v376**（双架构同代次），覆盖安装自动重解压最新 runtime。

## 质量门

- vitest **86 文件 / 1835 通过 / 0 失败**
- M4 内容级产物核验：双架构各 **169 项**标记，缺失 0
- 常驻门禁全绿（含本版新增两条：插件构建路径对账、NodeService 部署契约），且 SPA 门禁经**决定性负控**——回滚修复即被精确点名、还原即转绿
- APK 内嵌 runtime 版本与数据兼容形态核验双包通过
- **真机端到端实证**（模拟器，老用户升级路径）：单次启动零重启、HTTP 服务在线、设备桥监听正常、插件部署面含新增设备插件

## 验证面（诚实标注）

- **Shizuku 实际授权链**（`getUid()==2000`）需真机 + 用户已装 Shizuku 方可验证，按项目口径交社区众包回填。
- **设备工具的实际执行**（截屏/输入落到真机）依赖 Shizuku 执行层，当前命令构造与档位判定链路已完整可测，执行层待真机接续。
- 能力看板（W-7）与系统轻入口（W-8）的 UI 面未逐屏实测。
- W-9（敏感数据落盘）、W-10（插件安装通道）为调研面，结论见对应文档。
