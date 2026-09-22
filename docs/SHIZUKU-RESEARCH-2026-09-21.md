# W-2 调研：Shizuku 通道接入方案（2026-09-21）

> GOAL-DSH-ANDROID-COMPLETE-2026-09-21 的 W-2 调研交付物。
> 结论先行：**接法选定「方案 c′：Shizuku 常驻 shell server + socket 转发」**；
> 路线必须是**「依赖用户已装 Shizuku 官方 App」**（自带配对 = 重造 Shizuku，不做）；
> **实证发现一个真实的能力矛盾**（uid 2000 读不到 app 私有目录），本报告给出处置。
>
> 本报告的实证均在 x86_64 模拟器 + 真机 adb 上跑过，标注【实测】的是本机跑出来的，
> 标注【需真机】的是模拟器无法覆盖、留给众包的。

---

## 一、先纠正三个预设（调研推翻的）

### 1.1 ~~「Shizuku 不需要装官方 App」~~ —— 不成立

**事实**：Shizuku 官方 App 自己实现了完整 adb 协议（TLS 1.2 双向认证 + adb key 生成 +
`CNXN`/`AUTH`/`OPEN` 包协议），配对码与随机端口**只能用户手输**（那 6 位码显示在系统
配对对话框里，**无公开 API 可读**）。

⇒ 我们要么复用官方 App 已建立的通道（成本低），要么重造 Shizuku 核心——**而后者
还有一层死结**：自己拉起的 shell-uid server，app uid 要访问它**同样需要 Shizuku 式的
provider/binder 机制**，即**重新发明 Shizuku**。

**决策：走「依赖用户已装 Shizuku 官方 App」路线。** 「配对引导 UX」的定义相应调整——
不是「我们实现配对」，而是「**引导用户完成：装 Shizuku → 开无线调试 → 在 Shizuku 里
启动 → 回来授权我们**」。这也正符合 GOAL 原话「是 UX 不是技术」。

### 1.2 ~~「重启后要重新配对」~~ —— 半对

**配对只需一次**（凭据持久化在 `/data/user_de/0/com.android.shell/`）。
**需要重做的是「启动 Shizuku server」**——它不是系统服务，重启即消失，且无线调试默认关闭、
端口每次随机。**不 root 无法自动复活**（这是 Android 平台硬约束，官方 App 也一样）。

⇒ UX 应表达为「**重启后需重新激活**」而非「重新配对」，并给出一键跳转开发者选项的引导。

### 1.3 ~~「通道打通就等于 bash 能干活」~~ —— 不成立（最重要的一条）

见下文 §三，这是本调研发现的核心矛盾。

---

## 二、实证记录

### 2.1 依赖可用性【实测】

- `dev.rikka.shizuku:api` Maven Central 可达，**最新 `13.1.5`**（2023-09-21 发布）：
  ```
  HTTP 200 · latest=13.1.5 · release=13.1.5
  版本序列：11.0.2 / 11.0.3 / 12.0.0 / 12.1.0 / 12.2.0 / 13.0.0 / 13.1.0…13.1.5
  ```
- 项目 `settings.gradle.kts` **已有 `mavenCentral()`** ⇒ 无需新增仓库。
- **注意**：本项目当前**零非 AndroidX 依赖**（deps 仅 core-ktx / appcompat / webkit），
  接 Shizuku 会是**第一个第三方依赖**——需决策是否接受（本报告建议接受，理由见 §五）。
- **无 version catalog**（`gradle/libs.versions.toml` 不存在）⇒ 版本号按现有风格硬编码。

### 2.2 shell 域能否 exec 我们的伪装 .so【实测 — 关键判据通过】

以 shell（uid 2000）身份执行 `nativeLibraryDir/libdsht-bash.so`：

```
CANNOT LINK EXECUTABLE ".../lib/x86_64/libdsht-bash.so":
  library "libandroid-support.so" not found: needed by main executable
```

**这是「通过」而非「失败」**——错误在**动态链接阶段**（找不到依赖库），
不是 `Permission denied`。⇒ **SELinux 允许 shell 域对 `nativeLibraryDir` 的伪装 .so 做
execve**。这解除了调研前最大的未知风险。

### 2.3 shell 域能否读 app 私有目录【实测 — 矛盾实证】

```
$ adb shell ls /data/data/com.dshtavern.app/files/dsh-runtime/lib/
ls: .../dsh-runtime/lib/: Permission denied
```

**shell 域无法访问 app 私有目录。** 这直接引出 §三。

### 2.4 shell 可用的中转位置【实测】

| 位置 | 写 | exec | 备注 |
|---|---|---|---|
| `/data/local/tmp` | ✓（`-rw-rw-rw- shell shell`） | ✓（`cp toybox` 后 exec 成功） | **首选中转区** |
| `/sdcard/Download` 等 | ✓（shell 有 `sdcard_rw`） | 视挂载 noexec 而定 | 用户可见，适合放交换文件 |

### 2.5 shell 身份参考【实测】

```
uid=2000(shell) gid=2000(shell) groups=... context=u:r:shell:s0
```
与 app 域（`u:r:untrusted_app:s0`）是**完全不同的 SELinux 域**——权限面差异即由此而来。

---

## 三、核心矛盾与处置（本调研最重要的一节）

### 3.1 矛盾陈述

| | app uid（现状） | shell uid（Shizuku） |
|---|---|---|
| 读 `filesDir/.dsh`（会话/RP 数据/工作区） | ✅ | **❌ Permission denied**（2.3 实证） |
| 读 `runtime/lib`（bash 的依赖库） | ✅ | **❌ 同上** |
| 调 `input` / `screencap` / `pm` | ❌ | ✅ |
| 读 `/sdcard` | 需 MANAGE_EXTERNAL_STORAGE | ✅ 天然 |

⇒ **Shizuku 给的「更高权限」同时夺走了「对 app 私有数据的访问」**。
若把 bash 整个搬到 uid 2000，agent 会发现「命令能跑，但看不到自己的工作区」——
这比现状更糟。

### 3.2 处置：能力分层，而非全盘迁移

**不把 bash 整体 Shizuku 化**，而是**按「这个命令需不需要超越沙盒」分流**：

```
agent 发起 bash 命令
  ├─ 默认：走现状（app uid + proot）——工作区/会话/依赖库全都可达
  └─ 需设备能力时（用户/插件显式声明，或 W-4 守门人按档位放行）
        → 走 Shizuku 通道（uid 2000）——能调 input/screencap/pm，
          但**只能操作 /sdcard 与 /data/local/tmp**（工作区不可达，如实告知）
```

**判据是「命令要碰什么」而非「命令是什么」**——这决定了 W-3 设备工具集的形态：
**它们是「设备能力工具」（截屏/输入/通知），不是「bash 的替代品」**。

### 3.3 对 W-3 的直接影响

W-3 的工具应设计成**独立工具**（不走 bash），每个工具在 Java 侧直接调 `Shizuku.newProcess`
执行一行固定命令（如 `screencap -p /sdcard/xxx.png`），**不经过 agent 的任意命令构造面**：

- 好处 1：**命令面极小**（固定模板 + 参数转义），守门人的授权粒度清晰；
- 好处 2：**输出经 /sdcard 中转**，绕开「uid 2000 读不到 app 私有目录」；
- 好处 3：不引入「bash 该用哪个 uid」这个无解的判断题。

---

## 四、与 DSH 的接法（方案选型）

### 4.1 三个候选

| 方案 | 形态 | 判定 |
|---|---|---|
| (a) NodeService 侧拦截 bash 启动改 newProcess | 在 Kotlin 侧接 spawn | **❌ 不可行**：DSH 的 bash 是 **node 进程内部 spawn** 的（`dsh-bash-local`），Java 侧够不着；硬接要改官方源码——触碰本项目「零修改官方源」红线 |
| (b) `Shizuku.newProcess` 每次起进程 | 官方旧 API | **❌ 不选（含官方废弃信号）**：官方 13.1.1 changelog 原文「**Prepare to remove `Shizuku#newProcess`**, developers should have to use `UserService` instead」；且明确指出 **`newProcess` lacks tty support, it is not possible to implement an interactive shell with it** ⇒ 与 W-1 刚打通的 PTY 面不兼容 |
| (c) **`UserService` + socket（PTY 转发）** | 官方推荐路径：以 shell uid 跑我们自己的服务进程，暴露 socket | ✅ **选定** |

### 4.2 为什么选 (c)

**官方废弃 `newProcess` 的三条理由（逐字）**：

1. `UserService` 让你以 root/shell 身份**跑自己的代码**——比「执行命令」强得多；
2. `newProcess` **uses texts to communicate, which is not efficient and unreliable**；
3. `newProcess` **lacks tty support** ⇒ **无法实现交互式 shell**。

⇒ 第 3 条对我们**决定性**：W-1 刚把 PTY 打通（DSH 内置终端），若设备通道用
`newProcess`，则「终端走 PTY / 设备命令走 newProcess」两套并存且后者无 tty；
而 `UserService` 可以**在服务端进程里直接开 PTY**，与 W-1 的能力面天然一致。

**DSH 侧有两种形态并存**（读补丁与源码确认）：

| DSH 面 | 进程模型 | 证据 |
|---|---|---|
| bash 工具（agent 调） | **每次一次性**（`-c command` 起一个进程） | `apply-platform-patches.py` P0-1a/1b 改的是 `["bash","-c",spec.command]` |
| 内置终端（terminal-bash） | **长驻 PTY 会话** | P1-4a/1b 改 `DEFAULT_BASH_ARGS` 含 `-i`；W-1 已实证 PTY 可用 |

⇒ **UserService 常驻进程 + socket 协议**能同时服务两种形态（一次性命令 = 一次
socket 请求；会话 = 长连接转发 PTY 字节流）。

**UserService 的官方注意事项（实施时必须处理）**：

- **服务类必须实现 `IBinder`**（通常 `extends IYourAidlInterface.Stub`）；
- 可用两个构造器（默认 / 带 `Context`，v13 起优先用带 Context 的）——**但该 Context
  不是正常的 app Context**：`registerReceiver` / `getContentResolver` 等**不可用**；
- **`unbindUserService` 不会杀进程** ⇒ 必须实现 **`destroy` 方法**（transaction code
  **16777115**，aidl 里用 **16777114**）在里做清理并 `System.exit()`；
- `UserServiceArgs` 的 `tag` 用于判定「是否同一个服务」（不设则用类名，**R8 后不稳定**）
  ⇒ **必须显式设 tag**；`version` 不匹配会启新服务并 destroy 旧的。

### 4.3 注入点在补丁层的哪一处

现有补丁已在 `dsh-sandbox-local` 的 `confine()` 处交出完整 argv
（`apply-platform-patches.py` P0-2b）——这是**唯一把 argv 整体交出去的薄层**。建议：

```
confine(argv):
  if (Shizuku 通道可用 && 该命令被判定需设备能力)
      → argv = [shim, "--via-shizuku", ...]        // 新分支（优先）
  else if (proot 可用)
      → argv = [proot, ...]                        // 现状
  else
      → argv = ["/system/bin/sh", "-c", command]   // 现状降级
```

- 符合既有纪律：补丁层、幂等（marker + 期望命中数）、降级可见；
- `enforcement` 字段新增取值 `"shizuku"`（现有 `"full"` / `"unusable"`）；
- **但按 §3.2 的分层结论，W-2/W-3 首期不必真的接 DSH 的 bash 工具**——
  先让**独立设备工具**走 Shizuku（§3.3），bash 分流二期再说。

### 4.4 环境变量与工作目录的坑

`Shizuku.newProcess(cmd, env, dir)` 的 `env`/`dir` **不会自动继承**：
- 必须**显式构造**（参考 NodeService 现有 16 个 env，`NodeService.kt:833-876`）；
- **但 uid 2000 读不到 `runtimeDir/bin` 与 `runtimeDir/lib`** ⇒ 这些 env 对它无意义；
- ⇒ Shizuku 侧只传**最小必要 env**（`PATH` 取系统默认 + `/data/local/tmp`），
  **不假装能复用 app uid 那套环境**。

---

## 五、依赖决策

**建议接受引入 `dev.rikka.shizuku:api:13.1.5` + `:provider:13.1.5`**（2 个 artifact）：

- 这是本项目第一个非 AndroidX 依赖。**破例的理由**：Shizuku 是「不 root 超越沙盒」的
  **标准通道**，自己实现 adb 协议（~数千行 + TLS + 密钥管理）是单人项目的净负债；
- 版本**钉死 13.1.5**（Maven Central 实测最新），并在构建期校验（同 fetch-native-libs 纪律）；
- **许可**：Shizuku 是 Apache-2.0，与项目兼容；
- **包体增量**：api + provider 均为纯 Kotlin/Java 库，预计 < 500KB（**需构建后实测**）。

**Manifest 需新增**（据官方 README 与 Shizuku-API guide 核实）：
```xml
<provider android:name="rikka.shizuku.ShizukuProvider"
          android:authorities="${applicationId}.shizuku"
          android:multiprocess="false"
          android:enabled="true"
          android:exported="true"
          android:permission="android.permission.INTERACT_ACROSS_USERS_FULL" />
```
`android:permission` 的作用是**保护 provider 不被普通 app 访问**（官方注释原文）。

**★ 更正（联网核实后推翻本报告初稿）**：
初稿写的 `<uses-permission android:name="moe.shizuku.manager.permission.API_V23" />`
**是错的，必须删除**。Shizuku 的 Apache-2.0 §6 明确**禁止**第三方声明
`moe.shizuku.manager.permission.*`：

> You are **FORBIDDEN** to use `Shizuku` as app name or use `moe.shizuku.privileged.api`
> as application id or declare `moe.shizuku.manager.permission.*` permission.

v11+ 的权限模型是**自实现权限**（API 与运行时权限同形：`checkSelfPermission` /
`requestPermission`），**不需要任何 `<uses-permission>`**。

**其他核实到的要点**：
- v12.1.0 起 `ShizukuProvider` **自动初始化 Sui**（opt-out 需在 onCreate 前调
  `disableAutomaticSuiInitialization()`）——本项目同时支持 root 用户的 Sui 通道是**免费**的，
  但**本项目明确不做 root 路线**，故显式 opt-out（避免「检测到 Magisk 就启用」的歧义）。
- `Shizuku.getUid()` 可判后端：**root=0 / ADB=2000**——W-7 看板可用它区分并如实展示。
- **13.1.0 breaking change**：minSdk 23 需开 desugaring。我们 minSdk 28 ⇒ **不受影响**。
- **`Shizuku.isPreV11()`** 需判（本项目 minSdk 28 > API 30 以下可能有 pre-v11 的
  Shizuku 安装，故仍需判并显示「不支持」）。

---

## 六、配对引导 UX 设计（本工程面最难的一环）

### 6.1 状态机

```
未安装 Shizuku         → [去安装] 跳应用商店/GitHub release 页
已安装·未启动          → [如何启动] 图文引导：开发者选项 → 无线调试 → 打开 → 回 Shizuku 点启动
已启动·未授权          → [授权] 调 Shizuku.requestPermission(1020)（避开已占用的 1001-1011）
已授权·可用            → 显示可用能力（截屏/输入/通知…）
服务已死（binder dead）→ 回到「未启动」，并提示「重启后需重新激活」
```

### 6.2 硬边界（必须写进 UI 文案，不能假装能做到）

- **配对码必须用户手输**（无 API）——我们不实现配对，引导用户在 Shizuku 里做；
- **重启后无法自动复活**——只能提示 + 一键跳转；
- **uid 2000 看不到 app 私有数据**——能力页明示「设备工具只能操作 /sdcard」；
- **Android 11 以下无无线调试通道** ⇒ **minSdk 28 的机型上本能力不可用**，
  看板如实显示「本机系统版本不支持」（这正是 W-7 三态之外要加的一态）。

### 6.3 验收判据（按项目纪律：避免多层转发）

W-2 验收＝「DSH agent 经 Shizuku 执行 `id` 返回 uid=2000」。
**判据实施纪律**（源自 `list-device-sessions.sh` 的教训：同一命令多层转发得到 87 条
vs 直接执行 29 条，结论完全假）：

> 判据**不得自己构造被转发多层的命令**——把命令构造固定在**只经一层解析**的载体里，
> 判据只读结果。

⇒ 实施时：**Java 侧生成脚本文件 → shell 侧只执行文件**，不要在 `node → Java → binder → shell`
的链上拼命令字符串。

---

## 七、需真机/需联网才能定的清单（交给众包）

| # | 事项 | 类型 |
|---|---|---|
| 1 | Shizuku provider 声明跑通（含 `INTERACT_ACROSS_USERS_FULL` 保护是否影响自身） | 需真机实测 |
| 2 | `UserServiceArgs` 的 `tag`/`version`/`processName` 实际取值与生命周期 | 需真机实测 |
| 3 | UserService 的 `destroy`（transaction 16777115）在 unbind 后真的被调到 | 需真机实测 |
| 4 | `Shizuku.pingBinder()` / `addBinderReceivedListener` 的安全调用时序 | 需真机实测 |
| 5 | 真机（小米/华为卓易通）上无线调试 + Shizuku 启动全流程 | 需真机实测 |
| 6 | api+provider 引入后的 APK 增量 | 构建后实测 |
| 7 | UserService 进程内能否访问 `/sdcard`（shell uid 应可，但需实测确认 SELinux） | 需真机实测 |

**已在本机核实、无需再查**（联网已完成）：api 版本 13.1.5 · Manifest provider 形态 ·
权限模型（自实现，无 uses-permission）· `newProcess` 废弃与无 tty · getUid 语义 ·
Sui 自动初始化 · desugaring 影响面。

---

## 八、决策汇总

1. **路线**：依赖用户已装 Shizuku 官方 App（不重造 adb 协议 / 不自带配对）；
2. **接法**：**`UserService` + socket**（官方推荐路径；`newProcess` 已被官方标记废弃且无 tty）；
3. **范围**：首期**只做独立设备工具**（W-3），**不动 DSH 的 bash 工具**——
   因 §3 的矛盾，bash 整体 Shizuku 化会更糟；
4. **依赖**：引入 `dev.rikka.shizuku:api/provider:13.1.5`（钉死 + 构建期校验）；
   **不声明任何 `moe.shizuku.manager.permission.*`**（Apache-2.0 §6 禁止）；
   **显式 opt-out Sui 自动初始化**（本项目不做 root 路线）；
5. **UX**：五态状态机 + 四条硬边界如实标注 + 一键跳转引导；
6. **验收**：`Shizuku.getUid()` == 2000（ADB 后端），判据遵守「只经一层解析」纪律；
7. **不做**：自带配对（重造 Shizuku）、无障碍服务路线、root/Sui 路线。

**推翻条件**（若将来出现以下情况，本决策应重估）：
- Shizuku 官方 App 停止维护或下架 ⇒ 需评估自实现 adb 协议；
- 发现「uid 2000 可通过某种方式访问 app 私有目录」的合法手段（如 UserService 内
  以 app uid 代理文件 IO）⇒ §3 的矛盾可解，bash 分流可简化。
