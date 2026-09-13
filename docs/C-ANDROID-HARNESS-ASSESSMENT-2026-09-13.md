# 安卓端 harness 工程化评估（C 轨道，2026-09-13）

> 依据用户 goal「平台 harness 工程化」轨道产出。
> 纪律：每条结论附证据（文件:行号 / 实测数据）；未验证的写「未找到证据」。
> **B7 边界**：C3/C4/C5 只出评估与建议，不擅自替换内核级组件、不改默认权限档位。

---

## C1　解压 ≈350 秒的构成拆解

### 实测数据（读 zip 目录，未解压）

```
runtime.zip           65.3 MB（压缩后）
解压后总量            211.3 MB
文件数                24453
目录条目              3185
中位数文件大小        908 B
< 1KB 的文件          14357 个（占 58.7%）
> 100KB 的文件        206 个
最大单文件            32.3 MB  lib/libicudata.so.78
```

### 根因定位

解压实现在 [NodeService.kt:456-476](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/NodeService.kt#L456-L476)：

```kotlin
while (entry != null) {
    val out = File(runtimeDir, entry.name)
    out.parentFile?.mkdirs()              // ← 每条 entry 一次（即使父目录已存在）
    FileOutputStream(out).use { fos ->    // ← 每文件 open/close
        while (true) { ... fos.write(buf, 0, n) }
    }
    if (entry.time > 0) out.setLastModified(entry.time)   // ← 每文件一次 utimes
    ...
    count++
    if (count % 2000 == 0) recordLine("extracted $count files…")  // ← 每 2000 文件一次写盘
}
```

**性能归因——瓶颈不是"解压算法"，而是"小文件风暴"**：

| 因素 | 量化 | 说明 |
|---|---|---|
| 24453 次文件创建 | ×4 syscall/文件（open/write/close/utimes） | 近 10 万次系统调用 |
| 每条 entry 调 `mkdirs()` | 24453 次 | **父目录已存在也要走 stat**，纯冗余 |
| 每文件 `setLastModified` | 24453 次 `utimes` | 运行时**不需要** mtime |
| `recordLine` 写盘 | 12 次 | 次要 |

### 为何从 rc.7 的 15 秒退化到 ≈350 秒

记录载 rc.7 期 **32261 文件**却只要 15 秒（[DSH Android Roleplay App Plan.md:2626](file:///d:/DSH%20RolePlay/docs-archive/DSH%20Android%20Roleplay%20App%20Plan.md)），
而 0.1.5 期 24453 文件却要 ≈350 秒（LEARNINGS.md:2526）。**文件数更少、耗时更长**
⇒ 主因不是文件数，而是 **0.1.5 的 `compression: 'none'` 改动**（见 build-dsht.ps1 Step 4.5）：
session 日志从 zstd 改明文，带来更多更大文件 + 上游包结构变化。
**确切构成需真机计时验证**（本次仅静态分析，未实测）。

### 优化建议（按收益/风险排序）

| # | 改动 | 预期收益 | 风险 |
|---|---|---|---|
| 1 | **父目录 mkdirs 去重**（缓存已建目录路径集合） | 省约 2.4 万次冗余 stat | 极低（纯优化） |
| 2 | **去掉 `setLastModified`** | 省 2.4 万次 utimes | 极低（运行时不用 mtime） |
| 3 | `recordLine` 改内存缓冲、结束再落盘 | 省 12 次写盘 | 极低 |
| 4 | 改用 NIO / 批量写入 | 待真机实测 | 中（需 API 级别支持） |

> **建议实施 1+2+3**（合计改动约 15 行，不改变任何功能语义）。
> 预计可削减显著比例的解压耗时，但**具体数字必须真机实测**（B 轨道）。

---

## C2　phantom process killer（Android 12+ 全局 32 子进程上限）

### 机制（外部调研结论）

Android 12 引入「幽灵进程」监控：**全系统**（非每应用）后台子进程数超过 `DEFAULT_MAX_PHANTOM_PROCESSES = 32`
即静默 SIGKILL，且会额外杀死后台高 CPU 进程。Termux 社区为此长期困扰（termux-app issue #2366）。

**各版本处置方式**：
- **Android 14+**：开发者选项有官方开关「停用子进程限制」（Disable child process restrictions）——**无需 PC**
- **Android 12 / 12L / 13**：需 ADB：`settings put global settings_enable_monitor_phantom_procs false`；
  Android 12 还需先 `device_config set_sync_disabled_for_tests persistent` 再
  `put activity_manager max_phantom_processes <大值>`（顺序不能反，否则设置被 GMS 同步覆盖）
- **root**：同命令加 `su -c`

### 对本项目的实际影响（评估）

**受影响面**：Agent 的 bash 工具（`dsh-bash-local`）每次执行都会 fork 子进程；
proot 包装（P0-2b）会额外产生 loader 进程。长会话中若频繁调用 bash 工具，
**子进程计数可能触顶** ⇒ 表现为「工具调用无声失败 / 进程消失」。

**当前缓解现状**（有证据）：
- 前台服务已就位（`foregroundServiceType="dataSync|specialUse"`，[AndroidManifest.xml:57](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/AndroidManifest.xml#L57)）
- 电池优化白名单已请求（`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，Kotlin 侧 2 处调用）
- 但**没有任何针对 phantom process 的检测或引导**

### 建议（文案，可放入 App 内帮助页）

> **若长会话中工具调用莫名失败**：Android 12 及以上会对「后台子进程」设全局上限
>（默认 32 个），超出会被系统静默终止。这是 Android 的省电机制，不是 App 缺陷。
> - **Android 14 及以上**：设置 → 开发者选项 → 打开「停用子进程限制」，重启
> - **Android 12/13**：需用电脑执行 ADB 命令（详见项目文档）
> - 日常使用前，建议把本 App 加入「电池优化白名单」与厂商「受保护应用」

**本项为评估与文案产出，未修改代码**（按 B7）。

---

## C3　proroot 替代性评估（只出建议）

### 问题

Android 15 收紧 seccomp 后，**proot 会被打断**：glibc 启动即 `SIGSYS` /
`set_robust_list: Function not implemented`。这是内核层封锁，非配置问题。

### 两条路线对比

| | proot（当前） | proroot（候选） |
|---|---|---|
| 隔离机制 | `ptrace` 拦截 syscall | `LD_PRELOAD` + 二进制补丁（PLT wrapper + SIGSYS/SIGTRAP/SIGILL handler） |
| 开销 | **每 syscall 2 次上下文切换** | **0 次**（进程内路径翻译） |
| Android 15+ | ❌ 被 seccomp 打断 | ✅ 不依赖 ptrace |
| 成熟度 | 高（Termux 生态十年） | 低（2026-04 才发布，**专有许可，禁止再分发**） |
| 许可 | GPL-ish（Termux 包） | **专有，限制再分发** ← 与本项目 MIT 冲突 |

### 建议

**短期（不换）**：保留 proot，但**必须加降级可见性** ——
当前 proot 探测失败会静默回退到 fs 边界（[App Plan:14705](file:///d:/DSH%20RolePlay/docs-archive/DSH%20Android%20Roleplay%20App%20Plan.md) 已指出「从未在你的小米上跑过」）。
建议：探测失败时在诊断面板**显式告知用户「进程隔离不可用，已降级为工作区边界」**。

**长期（观察）**：proroot 技术方向正确，但**专有许可禁止再分发** ⇒ 与本项目 MIT 不兼容，
**不能直接打包**。可等其转为宽松许可，或关注 Termux 官方的 LD_PRELOAD 方案进展。

> **本项只出建议，未替换任何组件**（按 B7/B6）。

---

## C4　权限档位设计（对标 AGENTCODI，只出建议）

### 现状

默认 `danger-full-access` + `approval: never`
（[App Plan:12701](file:///d:/DSH%20RolePlay/docs-archive/DSH%20Android%20Roleplay%20App%20Plan.md) 自评「DSH 的权限模型在 Android 上形同虚设」）。
根因：Android 无 bwrap / 无 Landlock（5.13+ 才有）/ user namespace 对 app 域不可用 ⇒ 无沙箱后端。

### 对标 AGENTCODI（2026-09 开源，同为「harness 直接跑在设备上」）

其安全模型：
- 默认运作在**私有应用 workspace** 内
- 受影响的文件/命令操作**需要显式批准**
- 另有实验性 full-access 兼容模式（近期也补上了批准控制）
- 导入导出走 Android document picker，**保持访问显式**

### 对本项目的建议（RPG 场景适配）

注意差异：本项目用户主要跑**角色卡脚本**（RP），不是通用编码。故档位设计应偏向「低打扰」：

| 档位 | 适用 | 建议行为 |
|---|---|---|
| **默认（建议新增）** | 日常 RP | 工作区写**免批准**（卡脚本高频写 persona/lore/mvu，逐次批准不可用）；**工作区外**（尤其 `/sdcard`、系统目录）**需显式批准** |
| 高权限 | 迁移/导入 | 需要访问用户选定的 zip / 目录，走 SAF 授权（已是现设计） |
| full-access | 兼容模式 | 保留，但 UI 明示风险 |

**关键改进点**：当前 `approval: never` 让工作区外访问也无需批准 ⇒
建议至少让 **`workspaceRoot` 之外**的写操作走批准。**落地需用户拍板**（按 B7）。

---

## C5　WAKE_LOCK 接线评估（只出建议）

### 现状（实测）

```
AndroidManifest.xml:11  <uses-permission android:name="android.permission.WAKE_LOCK" />   ← 已声明
Kotlin 源码中 newWakeLock / WakeLock / PARTIAL_WAKE_LOCK 命中数 = 0                        ← 未使用
```

⇒ **权限声明了但代码从未获取唤醒锁**。

### 影响分析

- **前台服务**已就位（`specialUse`，避开 Android 15 的 6 小时 dataSync 超时）
- 但前台服务**不阻止 CPU 休眠**（这是设计上的区别：FGS 只保证不被杀，不保证 CPU 运行）
- 屏幕关闭后 CPU 休眠 ⇒ **长生成可能被挂起**（用户切后台等回复时）

### 建议

**该接线，但范围要窄**（Google Play 自 2026-03 起对「过度部分唤醒锁」有质量管控：
28 天内 >5% 会话在息屏时持有非豁免 partial wake lock 平均 ≥2 小时，会被商店降权）。

建议做法：
- **仅在「正在生成回复」期间获取** partial wake lock，生成结束立即释放
- 用 `acquire(timeout)` 带超时（防泄漏）
- 不要常驻持有

> **本项只出建议，未改代码**（按 B7）。

---

## C6　构建路径等价性（✅ 已修复）

见提交 `f61653d`：
- `build-dsht.ps1` 补齐 F2 flock + F1 的 RENAME-FS / RENAME-GEN + 裸 link 自检
- 判据 `scripts/audit-build-path-parity.py` **exit 0**（ps1 17 marker / python 16 / 共同 16）

---

## 附：B 轨道（真机验证）待办

C1/C2/C3 的量化结论**都需要真机数据**才能定论。B 轨道交付物（采集命令清单 + 判读表）
见 `docs/B-DEVICE-VERIFY-CHECKLIST.md`。
