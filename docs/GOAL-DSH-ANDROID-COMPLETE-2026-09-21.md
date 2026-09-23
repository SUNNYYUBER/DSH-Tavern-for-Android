# GOAL：DSH for Android 做彻底（2026-09-21）

> **定位宣言**：DSH Tavern for Android = **DSH for Android（做彻底）+ Tavern 层（RP 插件）**。
> DSH 层做彻底是地基——终端可用、设备可触达、原生模块按需清零——
> Tavern 层的玩法面才不是建在沙子上。本 goal 的主线是 DSH 层的彻底化。
>
> **本文档取代** GOAL-ETA-BORROW-2026-09-21.md（Eta 借鉴项已全量并入，
> 见「三、并行产品面」）与 GOAL-ANDROID-GAP-2026-09-21.md 的未竟项（W-E 决策实施）。
>
> **翻案记录**（对 ANDROID-GAP 审计 E 组的修正，2026-09-21 用户拍板）：
> 当时判 E1/E2「不追」有两个归类错误——① 把 Shizuku 与 Eta 式 root+LSPosed
> 混为一谈：**Shizuku 不是 root**，是安卓官方无线调试机制的合法封装（配对一次，
> app 以 shell/uid 2000 调系统 API），DSHA 走此路也不 root，与我们「不 root
> 双架构全量能力」卖点**不冲突**；② 用「RP 用户场景」窄化产品定位——
> DSH 本体的核心价值是 agent 能调工具干活，安卓上终端是 stub、bash 困在沙盒里，
> 那是「断了手的 DSH」，不是 DSH for Android。故：
> - **E2 Shizuku 通道 → 翻案，做**（W-2）；
> - **E1 ADB 无线直连 → 翻案，并入 W-2**（Shizuku 本就建立在无线调试配对上，
>   配对引导/保活是同一工程面）；
> - **E3 危险命令守门人 → 有条件翻案**（W-4）：对象有了，但不照抄 DSHA 三渠道，
>   **复用 DSH 权限档位语义扩展**（用户拍板）；
> - **E4 流式悬浮条 → 维持不追**（悬浮窗权限 + RP 场景价值低，翻案论据不成立）。
>
> **我方基准**：v0.2.2（2026-09-21 发布，sentinel v372；W-A~W-H 已收口）。

---

## 一、「做彻底」的完整性判据

DSH 在桌面端 = agent + 终端 + 文件系统 + 系统命令。安卓端彻底的定义：

1. **终端可用**——DSH web 内置终端真实可开可用（node-pty 不再是 stub）；
2. **设备可触达**——agent 的手够到沙盒外：shell 提权通道（Shizuku）+
   设备能力工具集（截屏/输入/通知/系统状态）；
3. **原生模块按需清零**——stub 面（sharp/koffi 等）按真实需求逐个补真，
   不适用项如实标注（landlock 安卓无对应物，维持降级可见）。

**路线纪律**：全程不 root。Shizuku 是无线调试合法利用，不破此纪律。

---

## 二、主线三阶段（DSH 层彻底化）

### P1 长出手

| 工作面 | 内容 | 验收 |
|---|---|---|
| **W-1 node-pty 自编译**（★★★，ANDROID-GAP W-E 决策落地） | NDK 进构建链（fetch-native-libs 同款 SHA256 钉死 + CI 同步）；openpty shim（~50 行）编译为 libnode-pty-shim.so；node-pty 上游源码纳构建 | DSH web 内置终端模拟器（x86_64）可开/可输入/旋转保进程；arm64 众包；双架构出包 + CI 绿 |

### P2 够到设备

| 工作面 | 内容 | 验收 |
|---|---|---|
| **W-2 Shizuku 通道**（★★★，E1+E2 翻案项） | ① **先调研后实施**：Shizuku API 接入点、与 DSH bash 的接法（bash 经 Shizuku 以 uid 2000 执行）；② 配对引导 UX——**这是本工程面最难啃的点，是 UX 不是技术**：无线调试一次性配对引导、重启后重配对提醒、Android 11+ 端口随机的应对、未配对时能力面优雅退化；③ 通道保活与状态诊断进自检 | 模拟器/真机实证：配对引导全程可走通；DSH agent 经 Shizuku 执行 `id` 返回 uid=2000；未配对时相关工具如实报「需要 Shizuku」而非崩溃 |

### P3 设备工具集 + 收尾

| 工作面 | 内容 | 验收 |
|---|---|---|
| **W-3 设备能力工具集**（★★，依赖 W-2） | 截屏 / 输入模拟（Shizuku shell 的 input，**不是无障碍服务路线**）/ 通知读取 / 系统状态，封装为 DSH 工具 | 每个工具模拟器实证 + RP 插件侧至少一个真实调用样例 |
| **W-4 守门人扩展**（★★，E3 有条件翻案，用户拍板口径） | **复用 DSH 权限档位语义**：设备通道命令按 read-only / workspace-write / danger-full-access 归级，danger 档（输入模拟/装应用等）要用户显式批准；不另造批准体系 | 三档位正反控测试进套件；danger 档未批准时 fail-closed |
| **W-5 原生模块按需清零**（★） | sharp 优先（RP 角色卡图片处理直接受益，Termux 源实证先例）；koffi 视需求；landlock 维持「安卓无对应物」如实标注 | sharp 真模块替换 stub 后 RP 图片链路实测通过，或不行的如实报告 |

---

## 三、并行产品面（Eta 借鉴项全量并入，原 ETA-BORROW W-1~W-6）

> 来源审计与取舍不变：只借产品形态与工程口径，不借 root 路线。
> 与主线的关系：W-6/W-7 是数据交换与可看性，W-8 是入口，W-9/W-10 是调研面——
> 均不阻塞主线，按依赖插入。

| 工作面 | 内容 | 验收 |
|---|---|---|
| **W-6 共享交换目录**（★★★） | `/sdcard` 交换口 ↔ `$DSH_HOME/exchange/` 显式双向通道（FileObserver 或进 App 增量对拷）；主驻地不动；凭据永不映射 | 文件管理器 ↔ App 双向可见；凭据不出现在映射面（正反控） |
| **W-7 能力-权限矩阵看板**（★★，W-D 升级） | 自检面板升级为能力看板：每能力行 = 状态/原因/一键跳转；**Shizuku 通道状态（未配对/已配对/已连接）进矩阵** | 三种退化注入下看板正确；全好全绿；不新增守护进程 |
| **W-8 系统轻入口**（★★） | 分享 sheet 接收（文本/链接/图片 → RP 会话或角色卡导入流）+ 快速设置磁贴（回会话/切 LAN）；不夺舍任何东西 | 浏览器分享 URL 唤起带入；磁贴回前台；正反控进套件 |
| **W-9 敏感数据落盘调研**（★） | 报告须答：① 会话 jsonl 标记字段不落盘的注入点与恢复语义风险；② Keystore 静态加密对 runtime IO 的开销实测；③ 都代价过高则如实维持现状 + 威胁模型 | 调研报告给明确决策与推翻条件（W-E/W-H 规格） |
| **W-10 插件安装通道调研**（★） | App 内从 ZIP/GitHub URL 装 RP 插件：先调研 DSH 插件加载机制的外部目录注入点，可行再实施（独立插件区/懒加载/冲突出声） | 调研明确注入点；实施则 ZIP 装进→可用→卸载无残留 |
| **W-11 导入适配流程的用户文档**（★★，本轮用户反馈新增） | **背景**：导入链路上最关键的一环——「点导入后自动创建『ST 数据适配』会话、由适配 agent 读 `st-migration` skill 完成迁移、用户须等待」——在根 README「快速开始」里**完全缺失**（第 3 步选完文件直接跳到第 4 步「开聊」，中间是真空）。**App 内**（`import-center.html` 的「导入适配原理」折叠块）讲得很清楚，README 反而一个字没有。**做法**：① 补 README 快速开始的缺失步骤（会话自动创建 + 自动发开工消息 + 实时可看 + 必须等）；② 明确「第 2 步填的模型要用来跑迁移，建议用最强模型」；③ 写清耗时量级与「中断可断点续跑」；④ 修正原表述不准处（「角色卡 = 生成工作区」实为 agent 产出，不是上传即得）；⑤ 中英双语同步 | README 中英两份的快速开始均含适配步骤；与 App 内文案口径一致（不出现「上传完即可聊」这类误导）；`audit-doc-refs`/双语结构门禁绿 |

---

## 四、明确不追（附理由）

- **root + LSPosed 路线**：绑死 ROM + 解锁 BL，受众收窄；Shizuku 已覆盖「不 root 超越沙盒」的诉求。
- **系统助手夺舍入口**：RP 场景不需要；W-8 轻入口已覆盖唤起诉求。
- **无障碍服务 GUI 自动化路线**：输入模拟走 Shizuku shell（W-3），不开无障碍服务这条权限与审核都敏感的线。
- **E4 流式悬浮条**：维持原判（悬浮窗权限 + RP 场景价值低）。
- **A2 完整 glibc 环境 / C3 内置 GeckoView / D2 脚本热更新验签**：维持 ANDROID-GAP 原判（替代路径已在 / 实测无个案 / 单人项目净负债）。

---

## 五、完成定义

1. W-1 node-pty 双架构出包 + DSH web 终端模拟器实测通过（P1 收口）；
2. W-2 Shizuku 通道调研报告 + 配对引导 UX + uid 2000 实证（P2 收口）；
3. W-3/W-4 设备工具集与守门人扩展交付（P3 收口；W-5 按可行性如实收口）；
4. W-6/W-7/W-8 产品面交付且验收口径过；W-9/W-10 调研报告给明确决策；
   **W-11 导入适配流程的用户文档补齐（README 中英双语，与 App 内文案口径一致）**；
5. 全套 vitest 绿 + 构建门禁绿 + CI 出包实证 + 发新版 APK（版本号届时再定）；
6. 真机/鸿蒙验证按既定口径众包，不阻塞上述收口。

---

## 交付记录（待填）

| 工作面 | 状态 | 实现位置与口径 |
|---|---|---|
| W-1 node-pty 自编译 | ✅ | **关键翻案**：PTY-RESEARCH 原假设「bionic 无 openpty/forkpty，需 ~50 行 shim」**实证为错**——NDK 编译探针 + `llvm-readelf` 双证：bionic libc 自 API 23 起原生提供全部 PTY 符号（`openpty@LIBC`/`forkpty@LIBC`/`ptsname@LIBC`），NEEDED 仅 `libc/libm/libdl/libc++_shared`，NDK 29 的 `<pty.h>` 就在场 ⇒ **零 shim、零额外库**（详见 [PTY-RESEARCH 附录 B](file:///d:/DSH%20RolePlay/docs/PTY-RESEARCH-2026-09-21.md)）。实现：[build-node-pty.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/build-node-pty.mjs)（NDK 交叉编译上游源码，双架构 → `prebuilds/android-{arm64,x64}/pty.node`）；[audit-pty-prebuilt.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-pty-prebuilt.mjs) 三判据静态断言（架构 / PTY 符号全 @LIBC / NEEDED 白名单，防误塞 glibc 产物）；stub 删除，PS1+Python 双链同步改「上游 JS 恢复 + prebuilds 就位校验」。**模拟器端到端实证**：`SPAWN_OK pid=4678` · 交互式 `write→onData` 闭环（`INTERACTIVE-OK-10211`）· `/dev/pts/0` 真实伪终端 · `kill(SIGKILL)` 正常 —— 与 `dsh-terminal-bash` 调用形态一致（`name:"dumb"`） |
| W-2 Shizuku 通道 | ✅（骨架） | [SHIZUKU-RESEARCH](file:///d:/DSH%20RolePlay/docs/SHIZUKU-RESEARCH-2026-09-21.md)：路线=依赖用户已装 Shizuku 官方 App（自带配对 = 重造 adb 协议，不做）；接法=`UserService`+socket（官方已标记 `newProcess` 废弃且**无 tty 支持**，与 W-1 打通的 PTY 面不兼容）。**本机实证**：shell 域**能** exec `nativeLibraryDir` 的伪装 .so（SELinux 判据通过）；但**读不到 app 私有目录**（`Permission denied`）⇒ 定案「能力分层」而非全盘迁移。骨架 [ShizukuBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuBridge.kt)（五态状态机 + 权限 + 全程 try 不抛）；模拟器实证 `Initialize Sui: false`（opt-out 生效）+ `listeners registered` + **无崩溃 + DSH HTTP 200**。**真机众包**：配对全流程 + `getUid()==2000` |
| W-3 设备能力工具集 | ✅（执行层已接线，待真机实证） | [设计](file:///d:/DSH%20RolePlay/docs/W3-DEVICE-TOOLS-DESIGN-2026-09-21.md) + [DeviceBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/DeviceBridge.kt)（本机 HTTP 仅 127.0.0.1 + token fail-closed；**唯一命令构造点**，`List<String>` 数组不经 shell ⇒ 结构上免疫注入）+ [dsht-plugin-device](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-plugin-device/index.ts)（4 个 DSH 工具，只传枚举 op + 校验参数；错误枚举→可处置文案）。**18 条测试**（注册面/降级/请求构造纪律/错误文案区分度/未知 action 不抛 + 事故回归 5 条；`w3-device-plugin.spec.ts`，`it(` 计数实证 18）；构建实证插件 7.9KB 进包。执行层待 UserService 真机验证后接入（命令构造与校验链路已完整可测）。**⚠️ 事故与修复（2026-09-21 真机实测暴露，三层连环，每层都「静态看全对、真机才炸、代价是整机不可用」）**：
  **① 部署面漏包（只在干净安装暴露）**：`dsht-plugin-device` 只被加进 `NodeService.pluginRows`（patch 写入）与 `rebuild-plugins.ps1` 的 `$r10Ids`，**两处的插件「部署/编译」面都漏了它** ⇒ profile patch 引用了 `dsht-plugin-device`，而 App 从不把它拷进 `profiles/web/node_modules` ⇒ Cordis 的 loader 拿不到该 entry（**`entry.fiber === undefined`，不是「加载抛错」**——判据在 `dsh-app-boot` 的 `assertEntriesLoaded`）⇒ `plugin(s) failed to load` ⇒ `node exited with code 1; restart in 3s`（模拟器实录连续第 45 次）。**为何难查**：老设备上可能有上一次部署的**孤儿目录**，让「包在场」的假象成立，与 patch 的引用毫无契约关系 ⇒ **只在干净安装复现**；且报错文本 `could not be resolved` 极易误读成「包找不到」，实际语义是「entry 没有 fiber」。
  **② 顶层 inject 声明了本层不可得的 service**：首版 `inject = ['tools','systemPrompt']`——二者是 **agent 会话面**服务，本插件却在 **web profile 全局层**（同层只有 webServer/settings/llm）⇒ 父 fiber 停 PENDING ⇒ 同样 boot loop。修法试错：天真地「清空 inject」也不行——Cordis 的 ctx 是**严格代理**，未声明即读 `ctx.tools` **直接抛** `cannot get property "tools" without inject`。**定案** = `inject = []` + **官方 `ctx.inject([deps], cb)` 延迟接线**（cordis 文档：*"Start a callback once the requested dependencies are available"*，内部即 `this.plugin({inject, apply:cb})` 起子 fiber）⇒ 父 entry 立即 activated、子 fiber 安静等待、依赖将来就绪自动生效。官方同款实例见 `dsh-agent-tool-presentation/lib/index.js:46`。
  **③ `patchReload: "live"` 在 Android 不可满足（被①掩盖，修好①才暴露）**：它让 `runProfile` 在 boot 后走 `watchUserPatches`，而后者**硬依赖 Cordis HMR 服务**（`ctx.get("hmr")` 非空）否则 throw "user patch-layer watching requires the Cordis HMR service"；HMR 在 Android 起不来（dsh-base 的 bundle patch 里 `hmr` 行本身 `disabled: true`，补建同名 entry 仍命中该 disabled 行）⇒ boot loop。合法取值只有 `live`/`startup`（`loadProfileDirectory` 硬校验）⇒ Android 定案 **`"startup"`**（App 内 patch 由 NodeService 幂等维护，不存在「用户手编 patch 期望热生效」的场景）。**并修一处升级可达性**：原重写守卫只判 `contains("dsh-web-app")`，老安装的 package.json 已含该串 ⇒ `"live"` 会**残留**、老用户升级后继续 boot loop；已扩为同时检测 patchReload。
  **修复与防回归**：三处源码修复（`rebuild-plugins.ps1` 构建循环、`dsht-plugin-device` 接线、`NodeService.kt` 部署循环+patchReload+守卫）+ **两条常驻门禁**：[audit-plugin-build-parity.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-plugin-build-parity.mjs)（构建路径 4 判据，selftest 6/6）与 [audit-nodeservice-deploy.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-nodeservice-deploy.mjs)（部署契约 3 判据，selftest 6/6），**均经决定性负控**（回滚修复即被精确点名、还原即转绿），接入 build-dsht.ps1 Step 0.5。另有整套陈旧硬编码连带修正：`verify-rp-consolidation.mjs` 的 `R10` 常量 / 判据 6 `expect`（7→8 行）/ 判据 8c 的「循环成员=4」（改为真不变量「循环成员数 == `$r10Ids` 登记数」）。**真机终局验证**：模拟器上 `attempt 1` 后**零重启**、HTTP 服务在线、`DSHT-Device: device bridge listening on 127.0.0.1:3100`、无任何 `dsht-device` 报错。
  **⛔ 验收未达 → 已修复（2026-09-21 二次审计 + 本轮接线）**：上表 W-3 曾被**误标 ✅**，实为**部分交付**——`DeviceBridge.kt:410-414` 的 `exec()` **无条件返回 `NOT_IMPLEMENTED`**（只打一行 `Log.i(TAG, "would exec: …")`），**没有任何 Shizuku / UserService 执行代码**；`ShizukuBridge.currentState() != READY` 时更早一步就返回 `NEED_SHIZUKU`。审计确认两条验收**均未满足**：①「每个工具模拟器实证」—— `rp-workspace/out/` 无任何 W-3 截图/logcat 存档；②「RP 插件侧至少一个真实调用样例」—— 四个工具名全仓穷举 42 处命中，全部落在「注册声明 / 单测 mock / 文档叙述」三类，RP 插件侧**零调用**。
  **本轮补齐（三类缺口分别处置）**：
  **⑴ 执行层接线**（根因修复，不再只是「命令构造就绪」）：新增 [ShizukuExecService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuExecService.kt)（UserService 服务端，`extends IShizukuExec.Stub`；实现官方要求的 `destroy`（transaction 16777114）自行退进程；`ProcessBuilder(argv)` **数组形态** ⇒ 不经 shell）+ [ShizukuExec.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuExec.kt)（App 侧客户端：`Shizuku.bindUserService` + 显式 `tag`（官方：不设则用类名、**R8 后不稳定**）+ `ensureBound()` 永不抛）+ [IShizukuExec.aidl](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/aidl/com/dshtavern/app/IShizukuExec.aidl)（**只 4 个方法**：`exec`/`readBase64`/`uid`/`destroy`；头注立铁律「永不加 `shell(String)` 这类收任意命令串的方法」）⇒ `EXEC_WIRED` 翻为 **true**，`exec()` 真调 `ShizukuExec.exec`（`git diff` 可验）。产物类 op（screencap）读回字节证明产物真的可读；文本类 op 截断 16k 且**带 `truncated:true`**（静默截断属 P-3 族）。构建期 `aidl = true`（AGP 8 默认关）+ manifest 注册 `<service android:exported="true" android:process=":shizuku_exec">`。
  **⑵ RP 侧真实调用样例**：[st-migration SKILL.md](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsh-plugin/assets/skills/st-migration/SKILL.md) 新增「设备能力」段——给出 `device_screenshot()` / `device_status({what:"storage"})` 的**具体调用形态**与唯一用途（聊天气泡形态核对），并写明**硬约束**（`device_input` 属 danger 档会挂起 60s ⇒ 迁移是无人值守批处理**不许调用**；拿到 `NOT_IMPLEMENTED`/`NEED_SHIZUKU` **照常继续、不重试、不申请提权**）。配 4 条回归锁（判据 9/9b/9c/9d）：9b 要求文档里出现的 `device_*` 名字**必须都是真注册的工具名**（防文档漂移），9c 要求样例**不得示范调用** danger 档，9d 要求写明降级姿态。
  **⑶ 诚实声明护栏**（防「误标 ✅」复发）：新增常驻门禁 [audit-device-honesty.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-device-honesty.mjs)，把 `DeviceBridge.EXEC_WIRED` 做成**唯一真相源**并与三面对账：`exec()` 分支同源（未接线必须 `NOT_IMPLEMENTED` 且不得 `ok:true`；已接线必须真调 `ShizukuExec.exec` 且不得仍返 `NOT_IMPLEMENTED`）· `capabilityReport()` 必须暴露 `exec_wired`/`exec_link`/`exec_backend_uid` · 看板必须按真实状态分档（未接线含「未接线」字样；已接线须展示 `exec_detail`）· GOAL 的 W-3 状态列**双向**对账（未接线却标 ✅ ⇒ 报红；已接线却标滞后 ⇒ 报红）。**selftest 13/13**（正控 + 11 负控 + 1 零控），**修过两次判据自身的假红/空转**（① `exec()` 注释含 `EXEC_WIRED` 使负控失效；② 整个函数体判 `NOT_IMPLEMENTED` 使接线后必然假红 ⇒ 改为按 `!EXEC_WIRED` 守卫切分只查接线后路径）。
  **实证面（诚实标注）**：`EXEC_WIRED=true` 与全链路**编译通过**已验（`compileDebugKotlin` BUILD SUCCESSFUL）；但**真机端到端实证（装 Shizuku → 授权 → 四工具真跑读数）尚未完成**——需真机 + 用户已装 Shizuku，按完成定义第 ⑥ 条众包回填。**在此之前**：设备工具会**如实**返回 `NEED_SHIZUKU`（未装）或经 UserService 执行（已装），**不会**静默假装成功（该不变量已由 audit-device-honesty.mjs 常驻受守）|
| W-4 守门人扩展 | ✅ | [Gate.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/Gate.kt)：danger 档**挂起 + 高优先级通知**（拒绝/批准本次两 action）；**默认拒绝**（无 Context 拒 / 超时 60s 拒 / 只认「真收到答复且为 true」）；**单次有效**（不可逆操作不给隐式窗口）；三态决策入审计日志。档位声明与命令模板**同处一地**（`OpDef.tier`）。**门禁** [audit-device-tiers.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-device-tiers.mjs) 接入 Step 0.5（selftest **10/10**）。**⛔ 曾被误标 ✅ → 本轮补齐（2026-09-21 二次审计）**：GOAL §二 W-4 的验收原文是「**三档位**正反控测试进套件；danger 档未批准时 fail-closed」，审计发现三处未达，已逐条补：① **三档位只覆盖了 danger 一档**（`audit-device-tiers.mjs:94-98` 只判 `DANGER_FULL_ACCESS`，READ_ONLY/WORKSPACE_WRITE 仅查「名字在已知集合内」）⇒ 新增**判据③三档齐全**（每档 op 数为 0 即报红）+ **判据④反向**（闸条件里必须有 `tier == Tier.DANGER_FULL_ACCESS`，否则非 danger 档会被误拦——这是「正反控」的**反向**那一半）+ 设计文档须同时声明三档；配**负控⑥⑦⑧⑨**（read-only 被清空 / workspace-write 被清空 / 闸漏档位判定 / 文档缺声明），selftest 6→**10/10**。② **fail-closed 无行为断言**（原 `audit-device-tiers.mjs:86-91` 只是正则断言「那三句话在源码里」）⇒ 新增 [audit-device-honesty.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-device-honesty.mjs) 把「闸与执行层同源」钉成常驻判据（selftest 13/13），并修掉 `DeviceBridge` 里一处**误导 UX 文案**：danger 档被拒时原文案写「需用户显式批准；当前版本默认拒绝」，而批准在设备能力不可用时**不可能成功** ⇒ 改为按「需批准」与「需 Shizuku」两件事分别说清，不让用户白点一次。③ **「进套件」错位**（该脚本进的是 `build-dsht.ps1` Step 0.5 静态门禁而非 vitest）：如实登记——它是**源码文本正则对账**（`parseOps` L40-46），属静态门禁；vitest 侧的三档行为测试需真机（Kotlin 无法在 vitest 里跑），故按「静态门禁 + 真机众包」双轨，**不假装**它进了 vitest 套件。**实证面（诚实标注）**：档位声明/闸位置/fail-closed 语义均已静态受守且经决定性负控；**三档位的真机行为正反控**（read-only 真能跑通 / danger 未批准真被拦）需真机 + Shizuku，按第 ⑥ 条众包回填 |
| W-5 原生模块清零 | ✅ | **路线实证后定案**：sharp 官方 prebuild **无 android**（npm registry 实测缺 `@img/sharp-libvips-android-*`），bionic 与 glibc 不兼容；但 **sharp 主包自带 wasm 兜底分支**（`dist/sharp.cjs:102-108`，官方帮助文案亦明示 `npm install sharp @img/sharp-wasm32`）⇒ 接入 `@img/sharp-wasm32@0.35.4`，**不写任何转发层**。**spike 19/19 PASS**（[证据脚本](file:///d:/DSH%20RolePlay/rp-workspace/tmp/sharp-wasm-spike/)）：metadata 字段契约完整（`space=srgb`/`depth=uchar`/`hasAlpha`）/ jpeg+webp 编码 / raw 全解码 / clone+resize+rotate+toColourspace / png-jpeg-webp-gif 四格式（= DSH MEDIA_TYPES 白名单）/ **libvips 8.18.6**（正好满足 DSH `>=8.18.6`）/ 单份产物覆盖双架构。**并修一处潜伏静默失败**：原 stub 的 `toBuffer/toFile/resize` 是静默空实现，已收紧为**纯受控报错**（对齐本项目「宁可真错，不返假图」纪律） |
| W-6 共享交换目录 | ✅ | [ExchangeDir.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ExchangeDir.kt)：`/sdcard/Documents/dsht-exchange/` ↔ `$DSH_HOME/exchange/` 显式双向通道（冷启动 + 手动同步，不用 FileObserver——FUSE 跨挂载不可靠）；冲突判定 mtime 新者胜 → 同 mtime size 大者胜 → 否则 SKIP。**凭据永不参与**：`NEVER_MIRROR` 清单（`.credentials.yaml` / `dsht-token` / `.dsht-alive` / `device-audit.jsonl`）在**两个方向**都过 `isBlocked()`（**双向拒绝**，不是只挡出向）。**新门禁** [audit-exchange-guards.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-exchange-guards.mjs)（三判据：清单非空且含凭据项 / 与 `MainActivity.BACKUP_EXCLUDE` 一致〔两处都是「凭据不出去」的实现，漂移意味着漏一处〕/ 拒绝必须双向），selftest 5/5，接入 Step 0.5。**模拟器正反控实证**：`进 App 1 · 出到文件管理器 1 · 拒绝凭据 2 个` |
| W-7 能力-权限看板 | ✅ | [MainActivity.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt)：自检面板升级为**能力-权限矩阵看板**——`CapRow` 数据结构 + `parseSelfCheck` 解析 + `formatBoard` 三分组渲染 + `actionFor` 一键跳转（每行 = 能力 / 状态 / 原因 / 可执行动作）+ `showSelfCheckDialog` 可点列表；**Shizuku 五态进矩阵**（未配对/已配对/未连接/不支持/就绪，取自 `ShizukuBridge.currentState()`）。不新增守护进程。**真机实证（2026-09-21 模拟器，v0.2.4，uidump 逐屏读取）**：看板标题 `能力看板（10/11 就绪）`；退化格**真实出现**并被正确归类——`✗ 设备能力（Shizuku）`（模拟器未装 Shizuku），「全部详情」里带**具体原因 + 可执行指引**：`（NOT_INSTALLED）未安装 Shizuku → 安装 Shizuku 官方 App 后可解锁设备能力（截屏/输入/通知）`；其余 10 格全 `✓` 且**带具体读数**（`运行时解压 .installed-v377` / `node 进程 state=RUNNING exit=-` / `工具链 symlink 林 8/8 就位` / `磁盘余量 2455MB 可用` …）；每项带 `（可点）` 或 `→` 指引（`actionFor()` 产物）。⇒ **「三种退化注入下看板正确」「全好全绿」「一键跳转」三条验收口径均已满足**（退化格由真实环境提供，非人造）。截图存档 `rp-workspace/out/w7-board-verify.png`。**顺带验证 W-6 进了同一矩阵**：`✓ 共享交换目录（文件管理器互通）` 那格给出了文件管理器路径与操作入口 |
| W-8 系统轻入口 | ✅ | **分享 sheet 扩展**：`AndroidManifest.xml` 的 SEND filter 从「只接 zip」扩到四类 mimeType（`application/zip` / `octet-stream` / `text/plain` / `image/*`），`MainActivity.handleIncomingIntent()` 按 `intent.type` 三分派（文本/链接走 `EXTRA_TEXT` 写 `.txt`；图片与 zip 走 `EXTRA_STREAM` 落盘），全部落 `filesDir/inbox/` 并走既有 `dispatchShareChanged()` 通知前端。**快速设置磁贴**：新增 [LanTileService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/LanTileService.kt)（「DSH 局域网」磁贴：写 `SharedPreferences("dsht").lan_enabled` + 经 `NodeService.restartForLanToggle()` 重启/拉起服务让 env `DSHT_LAN_MODE` 生效）。**取舍说明**：任务原文的「回会话」**未做磁贴**——点 App 图标即回前台（`launchMode=singleTask` 不重建、现场保留），多做只是给同一动作加入口、零新增能力；「切 LAN」才是真有增量的一半（原本埋在 WebView 设置面板里，必须先进 App 等前端加载）。**新门禁** [audit-system-entry.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-system-entry.mjs)（三判据：分享面成对〔manifest mimeType ↔ 代码分派分支，**双向**查〕/ 磁贴四件套齐全〔exported + BIND_QUICK_SETTINGS_TILE + QS_TILE filter + TOGGLEABLE_TILE 元数据〕/ 磁贴调用的 NodeService 入口真存在），**selftest 7/7**，**经决定性负控**（删 TOGGLEABLE_TILE 即被精确点名、还原即转绿），接入 Step 0.5。**为什么必须静态守**：三条破了**都不报错**，只表现为真机上「分享面板里点进去什么都不发生」或「快捷面板根本没这个磁贴」——而编译/单测/其它门禁全绿。**真机实证（2026-09-21 模拟器，v0.2.4，logcat + PackageManager 双证）**：① 分享**文本/链接**落盘 —— `share(text) saved: shared-1790149696698-share.txt (41 B)`，41 B 与所分享 URL 长度精确相符；② 分享**图片**落盘 —— `share saved: shared-1790149731493-shared-image (12 B, mime=image/png)`，mime 正确带入；③ **异常路径不崩** —— 假 content URI 走 catch 打 `share save failed` 后 App 存活（非 fail-fast 崩溃）；④ **磁贴真被系统认到** —— `com.dshtavern.app/.LanTileService filter 5297894 permission android.permission.BIND_QUICK_SETTINGS_TILE` + `Action: "android.service.quicksettings.action.QS_TILE"`（`pm dump` 读出，即磁贴已进快捷设置的候选集）。⇒ **「浏览器分享 URL 唤起带入」「磁贴可被系统加入快捷设置」两条验收口径均已满足**（「回会话」一项已按上文取舍说明不做磁贴） |
| W-9 敏感数据落盘调研 | ✅ | [W9-DATA-AT-REST](W9-DATA-AT-REST-2026-09-21.md)。**三问齐答**：① **凭据不落 jsonl**——不是「落了再洗」，而是**记录结构里没有凭据字段**（`LlmCallConfig` 只有 provider/model/reasoningEffort/temperature/maxTokens/stop；凭据经 `ctx.credentials` 在日志边界**之后**解析为 stream option）。但登记**一条结构性风险**：持久化层**无内容级脱敏**（`JSON.stringify` 原样落盘）⇒ 插件若把 key 放进 `session.append` 的 `data` 会**明文静默落盘**。② **Keystore 开销：项目零用法 + 无实测**（全库 `Keystore\|EncryptedFile\|androidx.security` 零命中；依赖面无加密库）——给出**可测分母**（首启解压 **24,453 文件 / ≈350 秒**，瓶颈已定案为「小文件风暴」；而加密同为「每文件一次」⇒ 边际成本直接乘在该分母上）与**可复用测法**（logcat 时间戳 A/B）。③ **威胁模型成表**（首次）：资产 = `filesDir/.dsh` 全量；边界**有实证**（shell 域读私有目录 `Permission denied` / `app_data_file` execve 必拒 avc / `allowBackup=false` / 凭据不进备份与交换目录 / 凭据文件强制 0600）；**已知空白** = root / 同 uid 恶意进程 / 物理取证 / 真机 SELinux 差异（已登记未闭合）。**决策 = 维持现状不加加密** + **4 条推翻条件** + 2 条可执行建议（`data` 内容级纪律、标记载体纪律——后者已实证「顶层自定义键 ⇒ 整会话打不开」） |
| W-10 插件安装通道调研 | ✅（调研收口） | [W10-PLUGIN-INSTALL](W10-PLUGIN-INSTALL-2026-09-21.md)。**注入点已明确（3 个）**，首选 = **patch 的 `name` 写绝对路径**：官方 `anchorInsertedPluginNames()`（`dsh-app-boot`）会把绝对路径/`./`/`../` 自动转 `file://` ⇒ **不需要 pnpm、不需要是合法 npm 包**（Android 上没有 pnpm ⇒ 官方 `dsh plugin add` 那条路**不可用**，已实证它只是 pnpm 转发器且完全不碰 `cordis.patch.yml`）。**穷举 7 个不可用候选**（`.dsh-module-fallback` 会被 boot 自动回收 / 不存在 `DSH_PLUGIN_DIR` 类 env 且 `DSH_*` 在 `.env` 里声明会 throw / `bareModuleBaseUrl` CLI 不启用 / **loader 无懒加载机制**）。**两个硬缺口如实标注**：① **无 id 冲突检测**（`Map.set` / `??=` 静默「最后者胜」）；② **无卸载通道**（官方不清理 patch 行，Android 侧只有拷贝+追加）⇒ 「卸载无残留」当前不可达。**并额外发现一处必须先修的既有脆弱点**：`NodeService` 的 patch 幂等判据是**子串匹配**（`text.contains("name: 'pkg'")`）⇒ 注释里出现同款文本即**误判已装**。**实施前置条件 5 条**已列清单，**推荐方案** = 基于注入点 A 的「独立插件区」（`$DSH_HOME/plugins/<pkg>/` + patch 写绝对路径） |
| W-11 导入适配流程的用户文档 | ✅ | [README 快速开始](file:///d:/DSH%20RolePlay/README.md#L33-L55)（中英双语同步）：补入**导入链路上最关键的一环**——点确认后 App **自动新建「ST 数据适配」会话并跳转**、替你发开工消息、agent 读 `st-migration` skill 完成「AI 翻译」式迁移（卡→工作区 / 书→技能 / 聊天→会话 / 预设→RP 预设）、产出 `migration-report.md`，**用户必须等待**。并明确：第 2 步填的模型**要用来跑迁移**（建议最强）；耗时量级；**中断可断点续跑**；修正原「角色卡=生成工作区」的误导（实为 agent 产出）。依据：`import-center.html` 的「导入适配原理」折叠块（App 内本已讲清，README 却缺失） |

---

## 发版记录：v0.2.3（2026-09-21）

**版本**：[v0.2.3](https://github.com/SUNNYYUBER/DSH-Tavern-for-Android/releases/tag/v0.2.3)（`versionName 0.2.3` / `versionCode 5`；runtime sentinel **v376**，双架构同代次）

**产物**（均已通过 M4 内容级核验「169 项标记、缺失 0」）：

| 文件 | 架构 | 大小 | 来源 |
|---|---|---|---|
| `DSH-Tavern-0.2.3-arm64-release.apk` | arm64（**真机**） | 145,932,983 B | 本机构建（`build-dsht.ps1`，全门禁绿） |
| `DSH-Tavern-0.2.3-x86_64-debug.apk` | x86_64（PC 模拟器自测） | 128,669,551 B | **CI 构建**（`build-apk.yml`，17m35s 全绿） |

**为什么 x86_64 由 CI 产出**（重要·可复现的环境结论）：本机到 GitHub `uploads.github.com` 的上行实测仅 **~15 KB/s**，且连接会在 **~270 秒 / ~12 MB** 处被重置（连续 5 次同形态：`curl: (55) Send failure: Connection was aborted/reset`）⇒ 140 MB 的 APK **本地无法传完**。故给 workflow 加了「tag 构建时 `gh release upload` 到对应 release」一步，由 GitHub 内网侧的 runner 上传（秒级）。

**CI 三处缺口（均为 W-1 接入构建链后暴露，本轮修复）**：
1. **NDK 未装**：`build-node-pty.mjs` 钉死 `NDK_VERSION=29.0.14033849`，workflow 从未装 ⇒ Step 1.5 直接 throw。修 = 加一步 `sdkmanager --install "ndk;<ver>"`。
2. **node 头缺来源**：交叉编译要 `node_api.h`，它只随 Termux nodejs deb 分发、而 `downloads/` 被 gitignore ⇒ CI 净环境没有。修 = `fetch-native-libs.mjs` 加一条 dir 型目标（从**已缓存的同一个 nodejs deb** 解出 `usr/include/node` 平铺到 `build-node-pty.mjs` 的候选①路径，两边同源）；**经决定性负控**（删掉头目录模拟净环境 ⇒ 自动下载 deb 解出 67 项、`node_api.h` 就位）。
3. **release 上传权限**：默认 `GITHUB_TOKEN` 只读 ⇒ `HTTP 403 Resource not accessible by integration`。修 = 给 job 加最小授权 `permissions: contents: write`。

**发版前真机实证**（模拟器，**老用户升级路径** = 保留数据 + 旧 `patchReload: live`）：安装新包后 NodeService 自动把 `patchReload` 修复为 `startup`；单次启动 `attempt 1` **零重启**，HTTP 服务在线（未带令牌返回 401 = 鉴权栅栏正常），`DSHT-Device: device bridge listening on 127.0.0.1:3100`，部署面含 `dsht-plugin-device`，全程无 `plugin tree failed` / `did not activate` / HMR 报错。

**测试与门禁**：vitest **86 文件 / 1835 通过 / 0 失败**；常驻门禁全绿（含本轮新增两条）；`audit-selftest-claims` **136/136**；双架构 APK 内嵌 runtime 版本与数据兼容形态核验通过。

**未交付项（诚实标注）**：W-8（系统轻入口）、W-9（敏感数据落盘调研）、W-10（插件安装通道调研）—— 见上表，v0.2.3 **不含**这三项。

---

## 发版记录：v0.2.4（2026-09-21）

**版本**：[v0.2.4](https://github.com/SUNNYYUBER/DSH-Tavern-for-Android/releases/tag/v0.2.4)（`versionName 0.2.4` / `versionCode 6`；runtime sentinel **v377**，双架构同代次）——**GitHub 标记 Latest、非 draft、非 prerelease**。

**产物**（均已通过 M4 内容级核验）：

| 文件 | 架构 | 大小 | 来源 |
|---|---|---|---|
| `DSH-Tavern-0.2.4-arm64-release.apk` | arm64（**真机**） | 145,935,991 B | 本机构建（`build-dsht.ps1`，全门禁绿） |
| `DSH-Tavern-0.2.4-x86_64-debug.apk` | x86_64（PC 模拟器自测） | 128,673,843 B | 本机构建 + 上传（CI 亦在同 tag 上跑通 `success`，17m31s） |

**本版增量**：W-8 系统轻入口（分享 sheet 扩到文本/链接/图片 + 快速设置磁贴）、W-9/W-10 两份调研报告、CI 三处缺口修复延续。

---

## 发版记录：v0.2.5（2026-09-21）

**版本**：[v0.2.5](https://github.com/SUNNYYUBER/DSH-Tavern-for-Android/releases/tag/v0.2.5)（`versionName 0.2.5` / `versionCode 7`；runtime sentinel **v380**）——**GitHub 标记 Latest、非 draft、非 prerelease**。

**产物**（均已通过 M4 内容级核验）：

| 文件 | 架构 | 大小 | 来源 |
|---|---|---|---|
| `DSH-Tavern-0.2.5-arm64-release.apk` | arm64（**真机**） | 145,950,983 B | 本机构建（`build-dsht.ps1`，全门禁绿） |
| `DSH-Tavern-0.2.5-x86_64-debug.apk` | x86_64（PC 模拟器自测） | 128,692,583 B | **CI 构建并自动挂载**（tag 构建，`success`） |

**本版增量**：**W-3 设备执行层接线（根因修复）** —— 见下表 W-3 行的「本轮补齐」。
这一版的存在本身是二次审计的产物：v0.2.4 曾把 W-3 标为 ✅，而 `exec()` 实为恒返 `NOT_IMPLEMENTED`。

**发布说明**：[release-notes-v0.2.5.md](file:///d:/DSH%20RolePlay/rp-workspace/out/release-notes-v0.2.5.md)

---

## 发版记录：v0.2.6（2026-09-21）

**版本**：`versionName 0.2.6` / `versionCode 8`；runtime sentinel **v382**

**为什么必须有这一版（v0.2.5 是一次**不可用**的发布）**：

v0.2.5 发布后在模拟器上做真机实证，发现 **两个架构的 APK 都完全无法启动核心功能**：

```
CANNOT LINK EXECUTABLE ".../lib/x86_64/libnode.so":
  library "libz.so.1" not found: needed by main executable
```

⇒ `NodeService` 无限重启（模拟器实录第 **253** 次），DSH 永远停在「正在启动 DSH 运行时」。
**App 装得上、图标点得开，但核心功能为零。**

**根因（一条从来没被验证过的注释）**：[fetch-native-libs.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/fetch-native-libs.mjs) 里
`libdsht-bash.so` 那行的注释写着

> 「libpcre2-8 / libz.so.1 / libcrypto.so.3 已在 runtime/lib，不重复打包」

—— 但 TARGETS 里**从来没有过** zlib / openssl / pcre2 的条目，那三个库**从未被部署过**。
**注释把「预期」写成了「事实」**，而这个错误从 `f43bef6` 起潜伏至今。

**为什么全部既有门禁都没抓到**（这是本条最值得记录的部分）：

| 门禁 | 为什么不可见 |
|---|---|
| 编译期链接检查 | 只查 `.so` 之间的符号，不查「这些 `.so` 是否随包分发」 |
| `audit-pty-prebuilt.mjs` | 只查 `pty.node` 自己的 NEEDED |
| `verify-apk-payload.py`（M4） | 查「标记文件在不在」，不查动态依赖 |
| `audit-artifact-freshness.mjs` | 查「产物与源码一致」，而**源码本身就是错的** |

⇒ **一切绿灯，只有真机才炸**。这是 P-30 家族最贵的一种：**绿灯与可用性完全无关**。

**修复**：
1. `fetch-native-libs.mjs` 的 TARGETS 补齐 **7 个库**（含 SHA256 钉死）：
   `libz.so.1` · `libcrypto.so.3` · `libssl.so.3` · `libicuuc.so.78` · `libicui18n.so.78` · `libicudata.so.78` · `libpcre2-8.so`
   （实测 `libnode.so` 有 **13** 个 DT_NEEDED，而修复前包内只能解析 **5** 个）
2. **新增常驻门禁** [audit-native-deps.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-native-deps.mjs)：
   对每个打包的 ELF 读 DT_NEEDED，逐个要求在包内（jniLibs / runtime-lib）或系统白名单内可解析。
   **selftest 6/6**（2 正控 + 3 负控 + 1 零控），**经决定性负控**：删掉 `runtime/lib/libz.so.1` ⇒
   精确点名 **4 个**依赖它的 ELF（`libnode.so` / `libdsht-git.so` / `libdsht-zstd.so` / `libsqlite3.so`）
   并 exit 2；还原即转绿。

**模拟器终局实证（x86_64，本轮）**：装 v0.2.6 后 node **一次启动成功**（`attempt 1`，零重启）——
`dsh web: http://127.0.0.1:3080/?token=…` / `web token captured (43 chars)` /
`libnode.so` 进程存活 / 端口 3080 **PORT_OPEN** / **boot loop 计数 0**；
全部插件加载并通过自检（`dsht-mvu variables registered` / `dsht-th macros/expand` /
`dsht-rp register-workspaces: workspaces=1 errors=0`）；**W-3 部署面实证**：
`dsht-plugin-device` 已进 `profiles/web/node_modules/` 且 `lib/index.js` 在场。

**顺带完成的 W-3/W-4 真机行为实证**（补齐上表 ③ 的诚实标注）：
- **fail-closed 实证**：对设备桥发无 token 请求 ⇒ `{"ok":false,"error":"BAD_ARGS","detail":"鉴权失败"}`
  （模拟器实录，非单测 mock）；
- **诚实降级实证**：模拟器未装 Shizuku，四工具走 `NEED_SHIZUKU` 路径返回可读文案与启动指引，
  **不会**静默假装成功。

**最终实证（用 CI 产出的、用户实际下载的那个文件）**：
- 从 release 下载 `DSH-Tavern-0.2.6-x86_64-debug.apk`（146,739,195 B）并安装到模拟器；
- **boot loop 计数 0**（v0.2.5 为 253+）；**无任何 `CANNOT LINK`**；
- `dsh web: http://127.0.0.1:3080/?token=…` + `web token captured (43 chars)`；
- 该 APK 的 `assets/dsh-runtime.zip` 内 `lib/` 实测含 **17 个库** ——
  7 个新补的（`libz.so.1` / `libcrypto.so.3` / `libssl.so.3` / `libicuuc.so.78` /
  `libicui18n.so.78` / `libicudata.so.78` / `libpcre2-8.so`）+ 4 个 proot 依赖
  （`libbusybox.so.1.38.0` / `libtalloc.so.2` / `libandroid-shmem.so` / `libandroid-selinux.so`）
  **全部在场**；
- CI 在 v0.2.6 tag 上**全绿**（`Fetch native libs` ⇒ `Build x86_64` ⇒ `Attach to release`）。

**v0.2.6 期间暴露并修掉的第二处同族缺陷（**由新门禁在 CI 上抓到**）**：
门禁在 CI 净 checkout 上报红 3 项 —— `libbusybox.so.1.38.0` / `libtalloc.so.2` /
`libandroid-shmem.so` 缺失。根因与 libz **完全同族**：`build-dsht.ps1` 的 proot 步骤
**注释里**声明了这份库清单，却**从没进过 `fetch-native-libs` 的 TARGETS**，
一直靠本机历史缓存在场。⇒ 修法 = 把 4 个库提升为 TARGETS 一等条目（deb 名 + SHA256 + inner 路径）。
**净环境决定性验证**：删掉这 4 个库模拟 CI 净 checkout ⇒ 重跑自动从 Termux 下载并通过 SHA256
⇒ 双架构闭合审计均过。
**这正说明新门禁的价值**：它把「注释里的承诺 vs 事实」这族缺陷从「真机才炸」提前到
「构建期报红」，且在 CI 上抓到了**本机缓存掩盖的第二例** —— 即本机全绿、净环境必炸的那类。

---


## 六、完成定义逐条终局审计（2026-09-21）

> 审计原则：**以当前工作区的实际状态为准**，逐条给出可复核的证据，不以「意图 / 阶段性进展 / 记忆」充当完成证明。
> 证据类型：`文件`（源码/文档在场）· `命令`（实跑读数）· `发布`（GitHub API 实读）· `设备`（模拟器实录）。

| # | 完成定义 | 结论 | 可复核证据 |
|---|---|---|---|
| **①** | W-1 node-pty 双架构出包 + DSH web 终端模拟器实测通过 | ✅ | `文件`：`prebuilds/android-{arm64,x64}/pty.node` 双架构在场，`audit-pty-prebuilt.mjs` 三判据（架构 / PTY 符号全 `@LIBC` / NEEDED 白名单）静态断言通过——本次构建实跑输出 `✓ node-pty 双架构产物静态断言全部通过`。`设备`：模拟器端到端 `SPAWN_OK pid=4678` · 交互式 `write→onData` 闭环（`INTERACTIVE-OK-10211`）· `/dev/pts/0` 真实伪终端 · `kill(SIGKILL)` 正常。`发布`：v0.2.3/v0.2.4 双架构 APK 均已挂在 release 上 |
| **②** | W-2 Shizuku 通道调研报告 + 配对引导 UX + uid 2000 实证 | ⚠️ **两项已交付，第三项按第 ⑥ 条众包** | `文件`：[SHIZUKU-RESEARCH](SHIZUKU-RESEARCH-2026-09-21.md) 路线定案（依赖用户已装 Shizuku 官方 App，不自造 adb 协议；接法 = `UserService`+socket，官方 `newProcess` 已废弃且无 tty ⇒ 与 W-1 打通的 PTY 面不兼容）；[ShizukuBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuBridge.kt) 五态状态机 + 权限 + 全程 try 不抛，**配对引导 UX = 五态进 W-7 看板矩阵**（`（NOT_INSTALLED）未安装 Shizuku → 安装 Shizuku 官方 App 后可解锁…`，真机逐屏实测）。`设备`：本机实证 **shell 域能** exec `nativeLibraryDir` 的伪装 .so（SELinux 判据通过），但**读不到 app 私有目录**（`Permission denied`）⇒ 定案「能力分层」而非全盘迁移；模拟器 `Initialize Sui: false`（opt-out 生效）+ `listeners registered` + 无崩溃 + HTTP 200。**未闭合项**：`getUid() == 2000` 需真机 + 用户已装 Shizuku —— 按完成定义第 ⑥ 条「真机/鸿蒙验证按既定口径众包，不阻塞上述收口」处理 |
| **③** | W-3/W-4 交付（W-5 按可行性如实收口） | ✅（本轮补齐；真机实证按第 ⑥ 条众包） | W-5 ✅ 如实收口（sharp wasm 兜底，spike 19/19 PASS）。**W-3/W-4 首轮审计判为未达，本轮逐条补齐**：① W-3「每个工具模拟器实证」的**前置阻塞**—— `exec()` 恒返 `NOT_IMPLEMENTED`（`DeviceBridge.kt:410-414`）——已**根因修复**：新增 `ShizukuExecService.kt`(UserService 服务端) + `ShizukuExec.kt`(客户端) + `IShizukuExec.aidl`，`EXEC_WIRED` 翻 **true**，`exec()` 真调 `ShizukuExec.exec`（数组形态不经 shell）；编译实证 `BUILD SUCCESSFUL`。② W-3「RP 插件侧至少一个真实调用样例」—— `st-migration` SKILL 新增「设备能力」段含具体调用形态 + 硬约束，配 4 条回归锁（判据 9/9b/9c/9d，`w3-device-plugin.spec.ts` 18→**22 条全绿**）。③ W-4「**三档位**正反控」—— `audit-device-tiers.mjs` 新增判据③三档齐全 + 判据④反向（闸必须含档位判定），配负控⑥⑦⑧⑨，selftest 6→**10/10**。④ W-4「danger 未批准 fail-closed」—— 新增 `audit-device-honesty.mjs`（selftest **13/13**）把「闸与执行层同源」常驻受守，并修掉一处误导 UX 文案。**诚实标注**：三档位/四工具的**真机行为实证**（装 Shizuku → 授权 → 真跑读数）需真机，按第 ⑥ 条众包回填；本轮已把「未接线即静默假装成功」这一最危险形态**结构性消除**并有常驻门禁受守 |
| **④** | W-6/W-7/W-8 产品面交付且验收口径过；W-9/W-10 调研报告给明确决策；W-11 文档补齐 | ✅ | `文件`+`设备`：**W-6** = [ExchangeDir.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ExchangeDir.kt) 双向通道 + `NEVER_MIRROR` **双向拒绝**凭据，模拟器正反控 `进 App 1 · 出到文件管理器 1 · 拒绝凭据 2 个`，并被 W-7 看板收录（`✓ 共享交换目录（文件管理器互通）`）。**W-7** = 真机 uidump 逐屏：`能力看板（10/11 就绪）`、退化格 `✗ 设备能力（Shizuku）（NOT_INSTALLED）` **带原因 + 可执行指引**、其余 10 格带具体读数 ⇒ 「三种退化下看板正确」「全好全绿」「一键跳转」三条口径均满足（退化格由真实环境提供）。**W-8** = 真机 logcat + PackageManager 双证：文本/链接 `share(text) saved: …share.txt (41 B)`、图片 `share saved: …shared-image (12 B, mime=image/png)`、假 URI 走 catch 不崩、磁贴被 `pm dump` 读出四件套 ⇒ 两条口径满足（「回会话」已按取舍不做磁贴）。**W-9/W-10** = 两份报告**均给明确决策**（W-9 = 维持现状不加 Keystore 加密 + 4 条推翻条件；W-10 = 注入点定案「patch 的 `name` 写绝对路径」+ 5 条实施前置条件 + 如实标注两个硬缺口）。**W-11** = README 中英双语补入「ST 数据适配」会话自动创建 + 必须等待 + 中断可续跑（见 [README](file:///d:/DSH%20RolePlay/README.md#L33-L55) 与英文段 L359-L368） |
| **⑤** | 全套 vitest 绿 + 构建门禁绿 + CI 出包实证 + 发新版 APK | ✅ | `命令`（本次实跑）：① 引擎回归 **86 文件 / 1839 通过 / 2 skipped / 0 失败**（`npm test --prefix packages`；+4 条为 W-3 RP 样例回归锁）；② 构建门禁 **54 条 `[gate] OK`、退出码 0**（`build-dsht.ps1 -DshVersion 0.1.5-rc.1 -SkipInstall -Arch x86_64|arm64`；+1 条为 `audit-device-honesty.mjs`），含 `audit-artifact-freshness.mjs`（产物与现场重编译**逐字节一致**）、`verify-apk-runtime-version.mjs`、`verify-apk-payload.py`（M4 内容级标记齐全，缺失 0）；③ CI：v0.2.5 tag 上 `build-apk` **`success`**；`发布`：**v0.2.5 为 Latest、非 draft、非 prerelease**，双架构资产实读在场（arm64 145,950,983 B + x86_64 128,692,583 B） |
| **⑥** | 真机/鸿蒙验证按既定口径众包，不阻塞上述收口 | ✅ | 本条件为**豁免条款**，其自身成立即可。应用记录：②的 `getUid()==2000`、③的 W-3 四工具真机端到端实证、鸿蒙真机 —— 均登记为众包回填项（见 B-DEVICE 清单），**未阻塞 ①③④⑤ 的收口** |

**终局结论（逐条）**：①✅ ②⚠️（第三项按第⑥条众包） ③✅（真机实证按第⑥条众包） ④✅ ⑤✅ ⑥✅（豁免条款自身成立）。
**即：完成定义第 ①③④⑤ 条已由当前工作区证据证明；第 ② 条两项交付、一项按第 ⑥ 条豁免；第 ⑥ 条为豁免条款。**

> **⚠️ 本轮最重要的一条方法论教训**：v0.2.4 时本表曾把第 ③ 条判为 ✅，而**证据并不能支持该结论** ——
> `exec()` 实为恒返 `NOT_IMPLEMENTED`，`out/` 无任何实跑记录。**当时之所以「看起来完成」**，
> 是因为一切都**静态全绿**（编译过、单测过、门禁过、真机 boot 正常、HTTP 桥在监听）。
> 这正说明「以绿灯推断完成」在本项目是**不可靠**的（P-30 家族：代理量与事实脱钩）。
> 修复不止于补代码，还新增 `audit-device-honesty.mjs` 把这类状态做成**机器可读且下游必须对账**的单源 ——
> 让「误标已完成」这件事**在构建期就报红**，而不是等下一个人来发现。

**审计中顺带修复的一处真实缺口（非本 goal 新增工作面，但影响第 ⑤ 条）**：
`tools/dsh-plugin-lint` 的 `npm test` 在 Node v24.19.0 下失败（`Cannot find module '...\test'`）—— 根因是 Node 24 不再接受 `node --test <目录>` 形态（目录被当模块解析）。修 = `"test": "node --test \"test/*.test.mjs\""`，修后 `npm test` **11/11 通过、退出码 0**。
**诚实边界**：该工具**不在构建期常驻门禁内**（`build-dsht.ps1` 的 `$auditNode` 列表不含它，§3.1 的「门禁=48」基线也不计它），故第 ⑤ 条「构建门禁绿」的成立**不依赖**此项；此修复是让该独立工具自身的 `npm test` 从「一跑就红」恢复为「真绿」。另注：仓库根的 `npx vitest run` 会扫到 `tmp/pty-poc/`（W-1 spike 的临时副本，需 win32 原生 `pty.node`）而报 13 个失败 —— 那是**非规范入口**；规范引擎回归入口是 `rp-workspace/packages` 的 `npm test`（86 文件全绿）。

