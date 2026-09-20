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

### P1 · 能力补齐包（bionic 工具链）——✅ 已完成（2026-09-20，sentinel v370）

- [x] `fetch-native-libs.mjs` 扩展：bash 5.3.15 / ripgrep 15.2.0 / git 2.55.0 / zstd 1.5.7
      （Termux 官方源 + SHA256 门禁照旧；含私有运行库 readline/ncursesw/iconv/android-support/zstd.1/lzma.5，
      依赖闭包用 `scripts/elf-needed.mjs` 核对）
- [x] **部署形态（模拟器 SELinux 实证钉死）**：`untrusted_app` 域对 `app_data_file` 的 execve 必拒
      （avc denied entrypoint）⇒ 工具本体**伪装 `libdsht-*.so` 进 jniLibs**（nativeLibraryDir，
      busybox/proot 同款），NodeService 幂等维护 `runtime/bin/<cmd>` 与 proot rootfs `/bin/<cmd>`
      两处 symlink 林（execve 跟随 symlink 检查最终目标）；库走 runtime/lib（dlopen 不受限）。
      **真实 app 域自测四件套 rc=0**（NodeService 启动自测写诊断面板/logcat）。
      git 裁剪：不带 libexec/git-core（helpers 不可 exec，builtin 不需要；远程 clone 如实报错）。
- [x] DSH bash 工具指向内置 bash（`DSHT_RUNTIME_BIN_DIR/bash`，缺席回退 mksh）；
      ripgrep 走官方路径（纯 JS 降级保留为 rg 缺席兜底）；git 入场；
      zstd 工具层可用——**会话日志压缩不恢复**（compression:'none' 补丁保留：
      约束根因是 WebView 迁移管线写不了 zstd，与 CLI 无关）
- [x] 验收：安卓平台限制表 3 行「已补齐」+ git 新增行（中英双语）；THIRD_PARTY_LICENSES §4/§5
      copyleft 处置扩展（bash/readline GPL-3.0、git GPL-2.0、libiconv LGPL-2.1）

### P2 · 鸿蒙生态位固化

- [ ] README「Alpha 限制」与「安卓化技术路线」表已写鸿蒙实测（done）；
      补测试环境细节（机型 / HarmonyOS 版本 / 卓易通版本）让别人可复现
      —— **待用户回填**（回归矩阵已留占位行；Agent 侧无鸿蒙设备信息）
- [x] 鸿蒙设备纳入发版回归矩阵（B-DEVICE-VERIFY-CHECKLIST.md B0 节末「发版回归矩阵」表，
      2026-09-20；含 P1 工具自测判读口径）

### P3 · bychv 预设管线切换（模拟器验证完成，切换已实施）

- [x] **模拟器四项验证全过**（2026-09-20，脚本 `scripts/emu-preset-*.mjs`，观测点 =
      golden-mock 落盘的真实出站 payload）：
  1. 普通会话 bychv 注入生效：marker 恰好 1 次、system 角色、`{{user}}` 按 binding.values 渲染
  2. 注入由绑定驱动：解绑后 0 次（对照）
  3. RP 会话双注实证（切换前基线）：我方快照与 bychv 编译各 1 条同时在场
  4. 变量划界：`setvar` 落 bychv store（含跨轮残留也只在 bychv state.json），MVU store 零污染；
     DSML/MVU 兼容性——**对照实验一锤定音**：绑定/解绑下 MVU 提取行为完全一致
     （direct 卡单轮不提取是既有行为，非 bychv 干扰）
- [x] **切换已实施**（2026-09-20）：bychv 绑定启用的会话，我方 relative（system-prompt/assemble 段）
      与 depth（withPresetLayer 段）两个注入点跳过（`bychvPresetOwned`，mtime 摊销）；
      D-3 槽位 / D-6 工具修剪 / 采样落地 / 预设正则不动（非 bychv 承担面）。
      判定纯函数 `dsht-plugin-shared/preset-ownership.ts` + 4 条单测，全套 1806 绿
- [x] 切换后模拟器复验（2026-09-20 PASS）：绑定态我方 0 次注入/bychv 1 次；解绑态我方 1 次/bychv 0 次
- [x] 真机验证清单已落（[B-DEVICE-VERIFY-CHECKLIST.md](B-DEVICE-VERIFY-CHECKLIST.md) B0 节：
      模拟器六项结论表 + 真机照做 5 条；真机执行待用户设备）

### P4 · npm 首发 —— ✅ 准备就绪（2026-09-20；实际发布待 npm login）

- [x] 发布编排 `scripts/publish-plugins.mjs`：staging（6 插件包 v0.2.0）+ 发布前门禁
      （import 闭包缺文件检查——zhipu-toolkit 案教训 / bare import 白名单 / 必备字段 /
      files 存在性 / cordis.patch.yml 入清单）+ `npm pack --dry-run` 双确认，全绿；
      `npm login` 后 `--publish` 一键发布
- [x] 版本策略：engines `{ node: ">=22.19.0", dsh: ">=0.1.5-rc.1 <0.1.6" }`（对齐 bychv 钉法；
      下沿 = 实测面 0.1.5-rc.1，上沿 <0.1.6 契约未稳）；license MIT + repository + keywords 全补
- [x] `dsht-rp-suite` 元包（仅 dependencies 声明全套 6 包 ^0.2.0）——保留「一行装齐」的 T-87 诉求
- [ ] 实际 `npm publish`（需用户 npm 账号 login；脚本与门禁已就绪）

### P5 · 模拟器验证中暴露的既有问题（2026-09-20 新发现；当日收口）

- [x] **direct（oneshot）卡 MVU 文本提取不工作** → **已修（T2.3b，详见 GOAL-PRESET-SWITCH-2026-09-20
     W-A1）**：根因 = T2.3 扫的 batch 是 inbox.claim 增量（历史 assistant 从不在其中），
     文本提取对两类卡从未命中（agent 卡靠 state_update 工具兜底）。修复 = surface 增量扫描
     （direct-only）。模拟器正控 PASS（emu_dsml_probe 落 state）。
- [x] **模拟器加速与崩溃** → **根因修正 + watchdog 收口**：AEHD 是 Intel 专用驱动，本机 AMD CPU
     从不适用（非此前推断的「崩溃残留」）；正解 = WHPX（VBS 已启用 hypervisor），
     emulator-dsht.ps1 已改 `-accel on`（boot ~40 秒）。偶发崩溃（qemu 0xc0000005，组合缺陷）
     由 `scripts/emu-watchdog.ps1` 自动恢复兜底（~90 秒闭环实证）。无需重启机器。

### 明确不做

- Shizuku / computer use 移动端适配（别人的赛道；且 DSH computer use 还在 0.1.6-alpha，契约未稳）
- 追逐 DSHA 的功能表（设备控制通道与我们用户场景无关）
- proroot 路线（Android 15 seccomp 风险；其许可状态存疑——DSHA 的 THIRD_PARTY_NOTICES 与
  我们 C3 节的判定矛盾，**留作待核查项**：`docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md` C3）
