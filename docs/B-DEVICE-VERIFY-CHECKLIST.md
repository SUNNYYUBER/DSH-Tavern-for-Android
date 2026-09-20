# 真机验证采集清单 + 判读表（B 轨道，2026-09-13）

---

## B0　预设管线切换（2026-09-20 新增；模拟器已实测，真机复核）

**背景**：RP 会话预设注入已从我方 pre-step 快照管线切换为 bychv/dsh-preset-enhance 统一承担
（绑定启用的会话我方注入点自动静默；T2.3b 修复 direct 卡 MVU 文本提取）。
目标包：`DSH-Tavern-0.2.0-arm64-release.apk`（sentinel v368 起，含切换 + T2.3b + 面板引导）。

**模拟器已实测（x86_64，判据与证据见 `docs/GOAL-PRESET-SWITCH-2026-09-20.md` 起点基线表）**：

| 项 | 模拟器结论 |
|---|---|
| 普通会话 bychv 注入 | ✅ marker 恰好 1 次、system 角色、宏按 binding.values 渲染 |
| 注入由绑定驱动 | ✅ 解绑后 0 次 |
| RP 会话双注（切换前） | ✅ 实证存在（各 1 条）；切换后我方 0 / bychv 1 |
| 解绑后我方管线恢复 | ✅ 我方 1 / bychv 0 |
| 变量划界 | ✅ setvar 只落 bychv store，MVU store 零污染 |
| DSML/MVU 兼容 | ✅ 对照实验无干扰；T2.3b 修复后 direct 卡提取 PASS |

### 真机照做项（小米 11 Pro）

```powershell
# 安装（保留数据；sentinel v368 会重解压 runtime，首启约 15-30 秒）
& $ADB install -r "D:\DSH RolePlay\DSH-Tavern-0.2.0-arm64-release.apk"
```

1. **预设工作台出现**：打开 App → RP 启动器 →「预设」页 → 点「打开预设工作台」
   → 判据：工作台页面（dsh-preset-enhance）打开可交互；返回后 RP 会话状态不丢。
2. **导入 ST 预设**：在工作台导入一份 ST 预设（.json）→ 判据：出现在工作台预设列表。
3. **普通会话注入**：新建普通会话 → 工作台对该会话启用绑定 → 发一条消息
   → 判据：回复体现预设指令（风格/规则变化可辨）；再关闭绑定发一条 → 预设痕迹消失。
4. **RP 会话不双注**：进一张 RP 卡会话 → 工作台启用绑定 → 发消息
   → 判据：回复只体现**一份**预设指令（无双份规则痕迹、无重复 system 指令口气）；
   有 RP 预设（会话头下拉）的会话同样只有工作台一份。
5. **MVU 文本提取（direct 卡）**：用一张会输出 `<UpdateVariable>`/`<JSONPatch>` 块的 direct 卡
   聊两轮 → 判据：状态栏/变量树出现更新（T2.3b 前 direct 卡永远不更新）。

**鸿蒙（卓易通）复核**：同 1/3/4 项。当前 **未实测**（依赖你的华为设备，测完请回填结果）。

### 发版回归矩阵（2026-09-20 P2 新增；每次发版逐项销）

| 环境 | 设备/版本细节 | 安装包 | 首启 | RP 会话单份注入 | P1 工具自测 | 状态 |
|---|---|---|---|---|---|---|
| 小米 11 Pro（真机） | Android 14 / HyperOS（既有实测机） | arm64-release v370 | ☐ | ☐ | logcat 五行 `P1 tool self-test` 全 rc=0 | 待用户 |
| 鸿蒙卓易通 | **机型：___ / HarmonyOS：___ / 卓易通版本：___**（待回填） | arm64-release v370 | ☐ | ☐ | ☐ 同上 | **未实测** |
| x86_64 模拟器 | API 35 镜像 / WHPX 加速 / Ryzen 5800X3D | x86_64-debug v370 | ✅ | ✅（B0 六项） | ✅ 四件套 rc=0（2026-09-20 logcat 实证） | 已通过 |

> P1 工具自测判读：`adb logcat -d | grep "P1 tool"` 应见 bash/rg/zstd/git 四行 rc=0 +
> `P1 tool links ready (8/8)`；任一 FAILED 即该环境 P1 能力包不可用（出声，不静默）。

---

> 依据用户 goal「真机验证」轨道产出。
> **本文件是给用户照做即可的操作手册** —— 每步都给出命令与判读标准。
> 说明：B 轨道的执行依赖你的两台设备，Agent 侧只能准备判据（goal 明文要求）。

---

## 前置：环境准备

```powershell
# 1. adb 就位（本机路径）
$ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
# 若不存在，改用项目内路径（脚本默认值已改为环境变量，见 E2 脱敏）
$env:DSHT_ADB = $ADB

# 2. 确认设备已连（小米 11 Pro / 华为卓易通）
& $ADB devices -l
# 期望：列出设备 + model 名
```

---

## B1　小米 11 Pro · 闪退修复复验（最高优先）

**目的**：验证「点发送闪退」的修复是否真的生效。
**背景**：权威归因 = `WebViewClient` 未实现 `onRenderProcessGone`，renderer 被 LMK 杀时
系统默认终结整个 App（TASK-LIST.md:2828-2865，已修，**未真机复验**）。

### 操作

```powershell
# 1. 安装新 APK（先卸载旧版，避免签名冲突）
& $ADB uninstall com.dshtavern.app
& $ADB install -r "D:\DSH RolePlay\DSH-Tavern-0.2.0-arm64-release.apk"

# 2. 清日志并开始抓取
& $ADB logcat -c
& $ADB logcat -v threadtime | Select-String -Pattern `
  "DSHTavern|heap out of memory|Reached heap|node exited with code|Killing|Render process|renderer gone|lowmemorykiller|lmkd|tombstone|debuggerd|ANR"
```

**3. 手工操作**：打开 App → 等首启完成 → 进入一个角色会话 → **点发送请求**（复现原闪退场景）

### 判读表

| logcat 出现 | 含义 | 结论 |
|---|---|---|
| `renderer gone` / `Render process` | 已走自愈路径 | ✅ **修复生效**（页面重载而非 App 消失） |
| `node exited ... code 137` | 被 LMK 强杀 | ⚠️ 内存压力（与堆上限相关，看 C1） |
| `FATAL ERROR: Reached heap` | V8 堆上限 | ⚠️ 需继续压低 `--max-old-space-size` |
| `ActivityManager: Killing` | 主进程被系统杀 | ⚠️ MIUI 激进管控，需加白名单 |
| **App 直接消失、日志无上述任何行** | 修复未生效 | 🔴 **新根因**，需重新归因 |

**辅助证据**：App 内等待屏会显示「上次退出：⚠️ 异常（被系统/内存回收强杀，非正常关闭）」
—— 这是 `lastAbnormalExit` 的 UI 化（修复 4）。

---

## B2　小米 11 Pro · proot 生存性实测

**目的**：`docs-archive/App Plan:14705` 明示「arm64 终包从未在你的小米上跑过 ——
PRoot 在量产 user 固件的 SELinux 下有翻车风险」。这是**未验证的风险**。

### 操作

```powershell
# 1. 看 proot 探测结果（App 启动后）
& $ADB shell "run-as com.dshtavern.app ls -la /data/data/com.dshtavern.app/files/proot-rootfs/" 2>&1

# 2. 抓 App 日志里的 proot 相关行
& $ADB logcat -d -v threadless | Select-String -Pattern "proot|PROOT|sandbox|enforcement|unusable"

# 3. 直接验证 proot 能否执行（关键判据）
& $ADB shell "run-as com.dshtavern.app sh -c 'echo proot-bin: \$DSHT_PROOT_BIN'"
```

### 判读表

| 结果 | 含义 |
|---|---|
| 日志出现 `enforcement: "full"` | ✅ proot 探测成功，**真隔离可用** |
| 日志出现 `enforcement: "unusable"` | ⚠️ 降级为 fs 边界（**记录该降级确实发生**） |
| 探测超时（10s）后静默 | 🔴 SELinux 拦住了 loader exec，符合预期风险 |

**当前实现的缺口**（C3 建议）：探测失败时**只在日志里可见，UI 不告知用户**。
建议后续在诊断面板显式显示隔离状态。

---

## B3　华为卓易通（Android 14）· 首启全流程

**目的**：该设备 Android 14（seccomp 尚未收紧到打断 proot），但存在已知坑：
**「卓易通/鸿蒙上 node stdout 管道可能整段静默」**（`NodeService.kt:107`、坑 #12）——
这正是项目做 token 双通道（stdout + 文件）的原因。

### 操作

```powershell
# 安装 x86_64 包（若卓易通是 x86 环境）或 arm64（看设备架构）
& $ADB shell getprop ro.product.cpu.abi
& $ADB install -r "D:\DSH RolePlay\DSH-Tavern-0.2.0-<对应架构>.apk"

# 抓首启全过程日志
& $ADB logcat -c
& $ADB logcat -v threadtime | Select-String -Pattern "DSHTavern|dsh web:|token|stdout|extract"
```

### 判读表（记录四项）

| 观测项 | 期望 | 记录 |
|---|---|---|
| 解压是否完成 | 日志见 `extract done: N files` | N = ? |
| node 是否就绪 | 日志见 `dsh web:` 行（**权威就绪信号**） | 有 / 无 |
| stdout 是否静默 | 若长时间无输出但 token 文件已写 ⇒ **确认静默坑复现** | 静默 / 正常 |
| token 双通道是否都工作 | 能从 `dsht-token` 文件拿到 token | 是 / 否 |
| 首启总耗时 | 从点击到能发消息 | ≈ ? 秒 |

**特别关注**：若「stdout 静默」复现，则**记录了该环境的实际表现**（这是此前只有代码推断、无实测的项）。

---

## B4　双机 perf-audit 基线

**目的**：**现有全部性能数字都来自 emulator**（`perf-audit.mjs:74` 明标「真机需先做一次反控
后再采信」）。没有真机基线，任何性能优化都无依据。

### 操作

```powershell
cd "D:\DSH RolePlay\rp-workspace"

# 1. 先跑反控（不需设备，验证判据本身能报红）
node scripts\perf-audit.mjs --selftest

# 2. 真机全量（App 需已启动）
node scripts\perf-audit.mjs --verbose

# 3. 机器可读（存档用）
node scripts\perf-audit.mjs --json > "D:\DSH_RolePlay_tmp_scan\perf-<设备名>-$(Get-Date -Format yyyyMMdd).json"
```

### 判读表（9 个度量面）

| 面 | 指标 | emulator 阈值 | device 阈值 | 你的实测 |
|---|---|---|---|---|
| 1 | 冷启动 TotalTime | ≤ 60000ms | ≤ 20000ms | |
| 2 | 帧率 janky / p50 | ≤ 92% / ≤ 95ms | ≤ 25% / ≤ 33ms | |
| 3 | 内存（PSS / node RSS / renderer） | 只登记 | 只登记 | |
| 4 | 静置空转 CPU | 只登记（三口径互相矛盾，不判红） | 同 | |
| 5 | 稳定性（ANR / FATAL） | 0 / 0 | 0 / 0 | |
| 6 | 后台轮询 | fg ≤ 6/s，bg ≤ 1/s | fg ≤ 3/s，bg ≤ 0.5/s | |
| 7 | UI 遮挡与 44px 触控目标 | **带反控** | 同 | |
| 8 | 长会话窗口化（`data-windowed`） | 前提不成立则报「未测得」 | 同 | |
| 9 | 输入回显延迟 | ≤ 400ms | ≤ 150ms | |

**退出码**：0 = 全在阈值内；1 = 有项超阈值或读数失败。

---

## 附：C1 的验证项（解压耗时实测）

```powershell
# 首次安装后计时（从点安装到能发消息）
& $ADB shell am start -W -n com.dshtavern.app/.MainActivity
# 然后看日志里的时间戳：
& $ADB logcat -d -v threadtime | Select-String -Pattern "extracting runtime|extract done|dsh web:"
# 计算：extracting runtime → extract done 的间隔 = **真实解压耗时**
#      extract done → dsh web:        = node 启动耗时
```

**这四个数字（解压 / node 启动 / HTTP 可服务 / 网关就绪）是 C1 优化前后的对照基准。**

---

## 汇总：本次真机验证要回答的 5 个问题

| # | 问题 | 关联 |
|---|---|---|
| 1 | 闪退修复是否生效？（自愈重载 vs App 消失） | B1 → R1 的验证 |
| 2 | proot 在小米量产固件上能否工作？ | B2 → C3 |
| 3 | 卓易通上 stdout 是否静默？ | B3 → 已知坑 #12 |
| 4 | 真机性能基线是多少？ | B4 → C1 的优化依据 |
| 5 | 解压真实耗时构成？（四个时间戳） | 附 → C1 |

**完成后请把 logcat 关键行 + perf-audit 输出给我，我据此做 C 轨道的量化结论。**
