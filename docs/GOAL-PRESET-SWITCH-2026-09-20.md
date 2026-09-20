# 预设管线切换收口 + 社区插件适配 —— 专项 Goal（2026-09-20）

> **本文件是下一阶段工作的唯一事实来源（SSOT）。**
> 判据哲学与纪律沿用 `docs/GOAL.md` §二（四件套缺一不可 / 未验证标未实测 / 失败必须出声 /
> 报告口径硬性），不再复制；与之冲突时以 GOAL.md 为准。
>
> - 用户裁定（2026-09-20，原话）：
>   ① 「开始执行任务清单和适配 DSH 社区插件的深度调研」→ 工作面 W-C；
>   ② 「把附带发现研究明白修好」→ 工作面 W-A；
>   ③ 「PC 暂时不用装 bychv 插件」（= PC 侧**不做**管线切换同步，边界 B-1）；
>   ④ 「真机验证清单需要你做」→ 工作面 W-B。

---

## 一句话目标

**把预设管线切换收进「真机可用」的终点（W-B），把切换验证中暴露的两个附带发现修到根因（W-A），
并把社区 DSH 插件适配从调研推进到实测登记（W-C）。**

---

## 起点基线（2026-09-20 实测，不许沿用旧数字）

| 项 | 值 | 证据 |
|---|---|---|
| vitest | **83 文件 / 1806 通过 / 2 skipped / 0 失败**（含新增 preset-ownership 4 条） | `cd rp-workspace/packages; pnpm test` |
| 拆包判据 | verify-rp-consolidation **9/9**；audit-impl-duplication PASS | `node scripts/verify-rp-consolidation.mjs` |
| 管线切换（代码） | bychv 绑定启用的会话：relative（assemble 段）+ depth（withPresetLayer 段）两注入点跳过；判定纯函数 `dsht-plugin-shared/preset-ownership.ts`；D-3 槽位 / D-6 工具修剪 / 采样 / 正则**不动** | [dsh-plugin/index.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsh-plugin/index.ts) `bychvPresetOwned` |
| 切换（模拟器复验） | bychv 绑定 + 我方预设绑定 → 我方 **0** / bychv **1**（双注消除）；解绑 bychv → 我方 **1** / bychv **0**（向后兼容恢复） | `EMU_EXPECT_SWITCHED=1 node scripts/emu-preset-rp-verify.mjs`（sentinel **v367** x86_64 debug APK） |
| 切换前四项验证 | ① 普通会话注入生效（marker 1 次/system 角色/宏渲染）② 解绑 0 次 ③ 双注实证（各 1 条）④ 变量划界 + DSML 对照实验 | `scripts/emu-preset-verify.mjs` / `emu-preset-var-dsml-verify.mjs` |
| x86_64 debug APK | `DSH-Tavern-0.2.0-x86_64-debug.apk`（190.2 MB，sentinel v367，M4 169 项缺失 0） | build-dsht.ps1 Step 6.6 |
| arm64 release APK | **未构建**（仍是 beta.4，**不含切换代码**）→ W-B 第一件事 | — |

---

## 工作面 W-A：附带发现修到根因

### W-A1　direct（oneshot）卡单轮场景 MVU 运行期提取不工作

**既有证据链**（2026-09-20 模拟器实证）：

- mock 回复含合法 `<JSONPatch>` 块，**完整进入会话历史与下一轮上下文**（出站 payload i=12 实证）；
- 下一轮 pre-step 正常执行（logcat turn=3/4 均在），但 `MVU state updated` 日志从未出现；
- **对照实验**：解绑 bychv 后行为完全一致（⇒ 与 bychv 无关，DSHT 既有问题）；
- st-87rfra（direct 卡）真实 state 文件历来只有 `{cursor, presetId}`，state/variables 均空；
- agent 卡（st-n0gnfp，7410 events）有丰富运行期 MVU 数据 ⇒ 提取链在 agent 卡工作；
- PC 侧已排除解析器嫌疑：`parseJsonPatches` 对该文本解析正确（`packages/tests/mvu.spec.ts` 绿）。

**排查假设**（按嫌疑排序）：

1. pre-step 提取循环（dsh-plugin/index.ts T2.3 段）遍历的 `batch`（= enter decision.messages）里，
   direct 单轮的 assistant 历史消息**缺事件 id**（`!mid → continue`）或 `source.form === 'snapshot'`
   被跳过；agent 卡多 step turn 的批次「从 surface 重建」带事件 id 故命中——两形态数据源不同。
2. direct 单轮的 decision.messages 是**增量形态**（只有新输入，无历史 assistant）——
   若如此，提取循环对该形态结构性扫不到上一轮回复。

**排查方法**：先在 PC 侧 harness 复现两种形态的 batch 内容（读真实会话事件 + 官方 derive 路径），
定位过滤点；不许靠猜改代码。

**修复方向**（按排查结果二选一）：

- A. 提取数据源从「batch 消息」改为「surface 事件流扫描」（与 agent 卡同数据源，消形态差）；
- B. 放宽过滤：无 id 消息按内容 hash 去重（保留 stateSeen 的「delta 不重复累加」语义）。

**判据（四件套）**：

- 正控：mock 场景（`emu-preset-var-dsml-verify.mjs` 形态）direct 卡单轮 →
  下一轮 pre-step 后 `rp/state/<sid>.json` 出现 `emu_dsml_probe=dsml-ok`；
- 负控①：agent 卡 MVU 不回归（现有 1806 测试全绿 + 模拟器 agent 卡复跑一轮）；
- 负控②：同一 assistant 消息不重复提取（delta 类补丁不重复累加——stateSeen 或替代机制语义保留）；
- 产物核验：修复进 APK（M4 169 项）；设备实测：模拟器复跑正控；
- 记账：README 的 MVU 宣称按修复结果校准；NEXT-STEPS P5 第一条销项。

**边界**：不得改变 agent 卡现有提取行为；不动 `parseUpdateVariable` / `parseJsonPatches`（已证正确）。

**状态（2026-09-20 收口）**：✅ 四件套齐全。
根因钉死（官方 dsh-agent-loop `preStep` 实证）：T2.3 扫的 `batch` = enter decision.messages
= `inbox.claim`（增量输入），历史 assistant 消息从不在其中——文本提取**对两类卡都从未命中**，
agent 卡靠 `state_update` 工具兜底未暴露，direct 卡结构性全哑。
修复 = T2.3b：surface 事件流增量扫描（游标 `mvuExtractSeq` 持久化，首见锚到末尾不补扫历史；
无 id 消息按内容 hash 去重），**只对 direct 形态启用**（agent 卡零行为变化）。
正控：模拟器 direct 卡单轮 mock → `state.emu_dsml_probe="dsml-ok"`（emu-preset-var-dsml-verify ④b PASS）；
负控：1806 测试全绿 + 形态判定隔离 + stateSeen/游标双防重；
产物：x86_64 + arm64 v367 双包 M4 169 项缺失 0。

### W-A2　模拟器 AEHD 加速驱动失效

**诊断**（2026-09-20 实证）：`sc query aehd` = STOPPED / 0x1f ERROR_GEN_FAILURE；
`C:\Windows\system32\DRIVERS\aehd.sys` 为 2024-03 版；SDK extras 目录无安装器；
WHPX/Hyper-V 均 Disabled；qemu 无加速硬撑 → 高负载随机崩，崩溃丢 guest 页缓存未落盘写入
（已实证：guard 备份文件变空壳）。

**任务**（按序尝试，任一成即收口）：

1. 找 SDK emulator 包内自带的 gvm/AEHD 安装器（`sdk\emulator` 下）→ 静默重装 → `sc start aehd`；
2. 找不到/装不上 → 从 Intel 官方 AEHD 发布渠道获取新版安装（注意签名与 HVCI 兼容）；
3. 都失败（或需重启机器）→ **文档改口 + 脚本出声**：
   - `emulator-dsht.ps1` 启动时检测 `sc query aehd` 非 RUNNING 即**明确警告**
     （无加速 = 慢且高负载可能崩；R8 失败出声，不许静默降级）；
   - `emu-app-up.ps1` / guard 类脚本维持 `adb shell sync` 兜底并注释原因。

**判据**：`sc query aehd` RUNNING 且模拟器连续 30 分钟高负载不崩（修好）；
或头注/文档如实改口 + 启动警告生效（兜底收口）。

**状态（2026-09-20 收口，根因修正 + watchdog 兜底）**：
根因钉死（与之前推断的「崩溃残留需重启」**不同**）：本机 **AMD Ryzen 5800X3D**——AEHD 是
Intel 专用驱动，**从不适用**（句柄扫描无占用；官方 2.2.0 重装同失败 0xffffffa1）。
正解 = **WHPX**（VBS 已启用 hypervisor，`WHvGetCapability` 实测 "installed and usable"）：
emulator-dsht.ps1 已改显式 `-accel on`（boot 从 TCG ~4 分钟 → WHPX ~40 秒）。
偶发崩溃矩阵（全部实证）：TCG/WHPX + 35 镜像 = qemu 0xc0000005 同签名随机崩；
WHPX + 36.1 镜像 = guest system_server native 连环崩——qemu×OS×CPU 组合缺陷无法本机根治。
**可靠性 = 崩溃自动恢复**：`scripts/emu-watchdog.ps1`（-Once 就绪保证 / -Watch 持续监控；
设备掉线 → 清场 → WHPX 重启 → 装 APK → 起应用 → CDP forward，全程 ~90 秒自动）。
闭环实证：验证脚本中途 device offline → watchdog -Once 82 秒恢复 → 测试续跑全过。
emu-app-up.ps1 已单源化为 watchdog -Once 薄封装。

---

## 工作面 W-B：真机验证清单（把切换收进「真机可用」）

- [x] **B-1 arm64 release APK 构建**：✅ **v368 双架构已出**（含切换 + T2.3b + PresetPanel
  引导；UI client 变更按纪律抬 sentinel 367→368）。`DSH-Tavern-0.2.0-arm64-release.apk`
  （真机包）+ `DSH-Tavern-0.2.0-x86_64-debug.apk`（模拟器包），M4 各 169 项缺失 0。
- [x] **B-2 模拟器已完成项登记**：B-DEVICE-VERIFY-CHECKLIST.md 已新增 **B0 节**
  （模拟器六项实测结论表 + 真机照做项 5 条 + 鸿蒙待回填标注）。
- [x] **B-3 真机照做手册**：同 B0 节「真机照做项（小米 11 Pro）」五条
  （工作台出现 / 导入预设 / 普通会话注入 / RP 不双注 / direct 卡 MVU 提取）。
- [x] **B-4 预设 UI 引导（最小版已落地，2026-09-20）**：PresetPanel 顶部新增
  「绑定后本面板内容预设自动静默（防双份）」说明 + 「打开预设工作台」入口；
  另实测官方 shell 顶部栏已有「预设工作台」按钮（bychv web UI 官方入口）。
  v368 双包含。数据面对接版（PresetPanel 直读 /preset-enhance/*）评估后另行决定。
- [ ] **B-5 鸿蒙回归**（依赖用户卓易通设备）：装新 arm64 包 → 开 RP 会话发一轮 →
  确认预设注入单份。登记为「待用户配合」项（Agent 侧无法触达鸿蒙设备，如实标注未实测）。

---

## 工作面 W-C：P0 社区插件适配（调研 → 实测登记）

**状态（2026-09-20 当日收口主要项）**：

- [x] **运行时安装路径实证**（等价 `dsh plugin add`）：profile node_modules + cordis.patch.yml
  追加 insert 行 + 重启——三包全激活。已登记 PLUGIN-COMPAT §5.1（未来 UI 化安装器的原型路径）
- [x] **C-1 dsh-session-pin 0.7.11**：✅ 全功能正常（pin/unpin 循环 + pinned 面板 + 与
  RpPresetSwitch 同槽位共存）——§5.2 对账
- [x] **C-3 dsh-better-stats 0.1.16**：✅ 激活正常（composer dock strip），与 RpTokenMeter
  共存未见异常；**dsh-tokstat / dsh-annotation 销项**（npm E404，调研清单错误）
- [x] **C-2 dsh-turn-index 0.1.1**：⚠ 激活正常但轮次条目恒为空（数据面未通，根因留作与作者
  对接项）；**关键发现：官方 DSH 已内置等效 turn marks（19 个 Jump-to-turn 按钮实测）**——
  对账结论「建议不装（功能重叠）」，已从模拟器 patch 摘除。dsh-outline 缓测（同形态排后）
- [x] **C-4（实质已验）**：官方 shell 顶部栏已出现「预设工作台」按钮（bychv web UI 官方入口）+
  RP PresetPanel 引导入口（v368 双包）——工作台与 RP overlay 共存成立
- [x] **C-6 产出**：PLUGIN-COMPAT §5.2 对账表 + §5.3 冲突类型学新增三案例
  （槽位共存正例 / 官方内置功能重叠型 / client face 数据面依赖哑火型）
- [x] **C-5 「预设模式」（st-preset）与 RP persona 互斥**：✅ 机制确认（bychv presetModeHistory
  过滤 system-prompt 插件来源的 system 消息，RP 全部注入汇在同一条会被整体滤掉）+
  文档明示（PLUGIN-COMPAT §二b / README 中英）+ 运行时护栏（registerLiveSession 检测
  st-preset 头每会话一次 logcat 警告）；UI 互斥（bychv 侧隐藏入口）经评估不改第三方包，
  以护栏+文档收口
- [x] **dsh-outline / dsh-zhipu-toolkit 实测**（2026-09-20，均建议不装，已摘除）：
  outline ⚠ 激活链完整但 client 崩 `snapshot.nodes is not iterable`（slot 崩溃隔离 → UI 不现身，
  第⑧类又一例）；zhipu-toolkit ❌ npm 0.2.1 上架包不完整（lib/usage-stats.js 缺失 →
  ERR_MODULE_NOT_FOUND crash-loop，第⑨类新冲突：发布缺陷）。PLUGIN-COMPAT §5.2/§5.3 已登记

### C-7 预设 UI 数据面对接版（NEXT-STEPS P3 残留）评估记录（2026-09-20）

**目标形态**：PresetPanel 直读 bychv `/preset-enhance/*` 数据面——绑定会话在 RP 面板直接
显示/编辑 bychv 预设，而非现在的「静默说明 + 跳转工作台」。

**工作面拆解**：
1. API 客户端：`/preset-enhance/api`（GET 读全量 + revision；POST action: save/bind/import——
   形态已实测，见 emu-preset-verify.mjs 绑定驱动段）；
2. PresetPanel 状态分流：`bychvPresetOwned(sid)` 判定已上线，绑定态改渲染 bychv 数据面
   （values/markers 双向编辑 + revision 乐观锁冲突处理）；
3. 双写冲突面：RP 面板与 bychv 工作台可同时改同一绑定——需要轮询/失效策略。

**风险**：bychv 的 `/preset-enhance/*` 是**插件内部路由、无版本契约**（rc 阶段随时可变）；
对接即耦合其内部实现，升级 bychv 时需逐版本回归。

**结论**：维持最小版（静默说明 + 「打开预设工作台」入口，v368 已落地）。对接版**暂缓**——
等 bychv API 出稳定契约或有真实用户需求驱动再立项；评估记录于此，不建代码。

---

## 工作面 W-D：P1 能力补齐包（2026-09-20 追加，NEXT-STEPS P1）——✅ 完成

- **四件套内置**：bash 5.3.15 / ripgrep 15.2.0 / git 2.55.0 / zstd 1.5.7（Termux 官方源 deb +
  SHA256 门禁；依赖闭包 elf-needed.mjs 核对）。
- **部署形态（SELinux 实证钉死）**：`untrusted_app` 域对 `app_data_file` 的 execve 必拒
  （avc denied entrypoint；run-as 的 `runas_app` 域 granted 不能代表 node 进程；root runcon
  模拟不等价——对已知可执行的 libbusybox.so 同组合也拒）⇒ 工具本体**伪装 `libdsht-*.so` 进
  jniLibs**（nativeLibraryDir，busybox/proot 同款），NodeService `ensureToolLinks()` 幂等维护
  `runtime/bin/<cmd>` 与 proot rootfs `/bin/<cmd>` 两处 symlink 林（execve 跟随 symlink 检查
  最终目标——symlink 绕过实证成立）；运行库走 runtime/lib（dlopen 不受限，libcrypto 先例）。
- **实证（模拟器 v370）**：NodeService 启动自测（真实 app 域 fork+exec）四件套全 rc=0——
  `bash 5.3.15 / rg 15.2.0 / zstd 1.5.7 / git 2.55.0`（logcat `P1 tool self-test`）。
- **DSH 侧接入**：terminal-bash 默认 shell → `DSHT_RUNTIME_BIN_DIR/bash`（缺席回退 mksh）；
  fs-search rg 在场走官方路径（纯 JS 降级保留兜底）；git builtin 本地操作可用
  （不带 git-core：helpers 在 app_data_file 必被拒，远程 clone 如实报错）；
  zstd 工具层可用（会话日志 compression:'none' 补丁**保留**——约束根因是 WebView 迁移管线）。
- **文档**：README 限制表 3 行销项 + git 新增行（中英）；THIRD_PARTY_LICENSES §4 表 + §5
  copyleft 处置扩展（bash/readline GPL-3.0、git GPL-2.0、libiconv LGPL-2.1——独立程序聚合 +
  源码要约）；NEXT-STEPS P1 整节销项。
- **产物**：v370 双架构 APK（arm64 release + x86_64 debug，M4 各 169 项缺失 0，vitest 1806 绿）。

**实测环境**：x86_64 模拟器（TCG 无加速——W-A2 兜底状态下进行，sync 已护住全部写型操作）。

---

## 边界（明确不做）

- **B-1**　PC 侧（`.a Agent RolePlay Project`）**不做**管线切换同步（用户裁定 2026-09-20：
  「PC 暂时不用装 bychv 插件」）；PC 侧若日后接入 bychv 插件，须先补同样的双注处置再启用。
- **B-2**　Shizuku / computer use 移动端适配（GOAL.md §六 既有边界照旧）。
- **B-3**　W-A1 修复不得改变 agent 卡提取行为（负控①是硬闸门）。
- **B-4**　真机（小米 11 Pro / 华为卓易通）执行项依赖用户设备，Agent 侧只准备判据与手册
  （B-DEVICE 既有约定）；模拟器可覆盖的项不许推脱给真机。

---

## 纪律（沿用 GOAL.md，摘最相关的三条）

1. **四件套缺一不可**：判据（含正负控）/ 产物核验 / 设备实测 / 记账——
   「测试绿」不是「做完了」。
2. **未验证标未实测**：鸿蒙、真机项如实标注；不写成「已验证」。
3. **失败必须出声**：AEHD 降级、插件激活失败、UI 互斥不可行——都留可见痕迹，不静默。
