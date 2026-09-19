# 下一步任务计划（2026-09-19）

> 本文档总结 2026-09-19 前后几轮的发现与决策，排出下一步任务。
> 状态：当前版本 v0.2.0-beta.3（拆包 + bychv 预设插件 + PR 开放）。

---

## 一、最近几轮的关键发现

### 1. 生态位：不是重复造轮子（DSHA 对比调研）

- [DSHA](https://github.com/qiannianhuanxiang/DSHA)（容器派：完整 Ubuntu rootfs + proot）与本项目
  （bionic 派：Termux 编译的 Node 直接跑在 Android bionic libc 上）是**两条并存的技术路线**，
  能力面不重叠：DSHA 是通用 DSH 安卓化平台（设备控制通道），本项目是 RP 垂直应用
  （世界书 / MVU / 酒馆助手 / 会话手术——DSHA 一项都没有）。
- 「bionic 派实现 DSH 完整能力注定更麻烦」**不成立**。逐项分解后：
  Termux 官方源有 bionic 编译版的 bash（~1MB）/ ripgrep（~1.3MB）/ git（~4.5MB）/ zstd（~0.4MB），
  补齐成本约 8MB + fetch 清单四行；真正持续麻烦的只有原生模块编译（DSH 对它们是可�选依赖）。
- 容器派的隐性成本（对方分析未计入）：phantom process killer（Android 12+ 后台子进程限 32 个，
  完整 Ubuntu 进程树结构性高危）、ptrace 全量开销、370MB 包体、Android 15 seccomp 收紧
  对 ptrace 密集场景的更大打击。
- **鸿蒙/卓易通实测完整跑通**（用户实证）是本项目独占的生态位证据；DSHA 官方标注「未验证」。

### 2. 拆包：权威路径从来都是拆包形态

- T-87 总包只存在于 rebuild-plugins.ps1 一条路径；APK 权威构建路径（build-dsht.ps1
  Step 4.7/4.72）一直是「主插件 + R10 四独立包」。「疑似双重注册」是误报。
- T-88 实施完成：四条构建路径统一为独立包形态；9 判据 + 解析器自证 + 反控全绿；
  顺带修复 ejs-worker 两种形态下都漏拷的存量 bug（EJS 静默退化同步渲染）。
- 每个插件现在是标准可安装包（dsh.bundle.patch 声明），可 `dsh plugin add` 进任何 DSH 部署——
  **包括 DSHA**。「我们的 APK 服务 RP 玩家」与「我们的插件集进入所有 DSH 部署」是并行的
  两个分发渠道，不是二选一。

### 3. 协作形态确立

- bychv 成为 collaborator（主攻预设）；其 `dsh-preset-enhance@0.3.2-rc.1` 已接入构建与部署
  （`-PresetEnhanceVersion` 参数 + NodeService.copyPackageTree + patch 行）。
  rc.1 → rc.2 依赖集 72=72 完全一致（npm 对账实证），版本阻塞解除。
- PR 口径开放（README/CONTRIBUTING 中英四段同步）。
- 他的预设注入走 `llm/stream` 消息编译（不落会话日志），比我们 pre-step 快照注入
  （落日志、要参与回退/压缩运算）架构上更干净——「harness 轨迹残留」那类 bug 在他的
  注入面上不存在。**管线切换（RP 会话关 `withPresetLayer`）待真机验证后执行**。

### 4. 工程体系自证有效

门禁两次拦截真实破坏：build-dsht.ps1 的 BOM 被编辑工具弄丢（audit-build-path-parity 判据五）、
手动 pnpm 12 装包毁掉 hoisted 布局（audit-official-contract 探针）。这套自证体系值回票价。

---

## 二、战略判断（接下来投入的三条原则）

1. **harness 层转为防守**：维护现有 8 项平台补丁（成本已被门禁机器化压到很低）+
   鸿蒙兼容性纳入回归，**不再追加新能力**（不追 Shizuku / computer use / DSHA 的功能表）。
2. **插件层是主战场**：RP 兼容层是整个生态里独一份的资产；拆包让它能进入一切 DSH 部署。
3. **生态协作优先于自研**：bychv 模式（各自维护独立包、互相 compose）是扩能力的最低成本路径。
   遇到「别人已经做得好」的模块，接入而非重写。

---

## 三、任务计划（按优先级）

### P0 · DSHT 装社区 DSH 插件的适配性研究（本轮新重点）

目标：让「社区为 DSH 写的用户自制插件」能在 DSHTavern 里装得上、跑得通、冲突可解。
bychv/dsh-preset-enhance 是第一个样本（已接入），把这一过程沉淀为**可复用的适配框架**。

- [ ] **社区插件清单调研**：收集公开的用户自制 DSH 插件（GitHub 搜 dsh-plugin / DSH 社区），
      建一张「插件 → 能力 → 8 项安卓约束敏感度」的矩阵
- [ ] **冲突类型学**（每个类型要有一个真实案例 + 处置模式）：
  - UI 槽位冲突：sidebar / overlay / 会话流渲染器（keyed node）重复注册——
    cordis 的 priority 规则是什么、两个插件抢同一个 key 谁赢、实测确认
  - 路由前缀冲突：两个插件注册同一个 HTTP 前缀时的行为（后注册覆盖？报错？）
  - inject 服务缺失：插件声明的服务在 DSHTavern profile 不存在时
    （激活门整插件不激活 vs 降级）——我们的 profile 缺哪些官方服务，列清单
  - 数据目录约定：插件写 DSH_HOME 的布局假设（Android 上 filesDir/.dsh 的路径差异、
    存储空间、proot 内路径翻译）
  - 变量/状态隔离：两个插件各自维护变量存储（如 bychv 的 preset store vs 我们的 MVU stat_data）
    的划界规则
- [ ] **已知实例的实测清单**：
  - bychv 包的「预设工作台」与 RP overlay 的 UI 共存（真机）
  - 「预设模式」与 RP persona 的互斥需求（RP 会话**不可**用其独占模式，要文档明示 + 可能的话 UI 互斥）
  - RP 会话里手动 `/preset on` 的双注入行为（两条管线各注一遍）——实测后决定互斥策略
- [ ] **产出**：`docs/PLUGIN-COMPAT.md`（适配指南：社区插件作者/使用者在 DSHTavern 装插件时
  的注意事项与冲突速查表）+ 必要的运行时护栏（如冲突检测日志）

### P1 · 能力补齐包（bionic 工具链）

- [ ] `fetch-native-libs.mjs` 扩展四行：bash（~1MB）/ ripgrep（~1.3MB）/ git（~4.5MB）/ zstd（~0.4MB）
      （Termux 官方源 + SHA256 门禁照旧，体积预算 +~8MB）
- [ ] DSH bash 工具指向内置 bash（不再降级 mksh）；ripgrep 替换纯 JS 降级；
      zstd 恢复会话日志压缩（省存储）；git 入场（工作区快照/版本操作可用）
- [ ] 验收：8 项安卓平台限制表里对应行更新（「已补齐」标注）

### P2 · 鸿蒙生态位固化

- [ ] README「Alpha 限制」与「安卓化技术路线」表已写鸿蒙实测（done）；
      补测试环境细节（机型 / HarmonyOS 版本 / 卓易通版本）让别人可复现
- [ ] 鸿蒙设备纳入发版回归矩阵（B-DEVICE-VERIFY-CHECKLIST.md 加一节）

### P3 · bychv 预设管线切换（待真机验证）

- [ ] 真机验证清单：预设工作台出现 / 导入预设 / 普通会话注入生效 / RP 会话不双注
- [ ] 通过后：RP 会话关 `withPresetLayer` 预设快照管线（保留世界书/角色卡/正则/状态树）；
      预设 UI 对接其 `/preset-enhance/*` 数据面
- [ ] 变量划界实测：预设宏 setvar（其 store） vs MVU UpdateVariable（stat_data） 互不干扰
- [ ] DSML 工具转换 vs 酒馆助手桥接 tool_calls 兼容性实测

### P4 · npm 首发

- [ ] 各插件包稳定后首发 npm（版本策略：engines.dsh 统一窗口，对齐 bychv 钉法）
- [ ] `dsht-rp-suite` 元包（仅 dependencies 声明全套）——保留「一行装齐」的 T-87 诉求

### 明确不做

- Shizuku / computer use 移动端适配（别人的赛道；且 DSH computer use 还在 0.1.6-alpha，契约未稳）
- 追逐 DSHA 的功能表（设备控制通道与我们用户场景无关）
- proroot 路线（Android 15 seccomp 风险；其许可状态存疑——DSHA 的 THIRD_PARTY_NOTICES 与
  我们 C3 节的判定矛盾，**留作待核查项**：`docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md` C3）
