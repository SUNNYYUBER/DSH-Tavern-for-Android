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
| W-3 设备能力工具集 | ✅ | [设计](file:///d:/DSH%20RolePlay/docs/W3-DEVICE-TOOLS-DESIGN-2026-09-21.md) + [DeviceBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/DeviceBridge.kt)（本机 HTTP 仅 127.0.0.1 + token fail-closed；**唯一命令构造点**，`List<String>` 数组不经 shell ⇒ 结构上免疫注入）+ [dsht-plugin-device](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-plugin-device/index.ts)（4 个 DSH 工具，只传枚举 op + 校验参数；错误枚举→可处置文案）。**13 条测试**（注册面/降级/请求构造纪律/错误文案区分度/未知 action 不抛）；构建实证插件 7.9KB 进包。执行层待 UserService 真机验证后接入（命令构造与校验链路已完整可测）。**⚠️ 事故与修复（2026-09-21 真机实测暴露，三层连环，每层都「静态看全对、真机才炸、代价是整机不可用」）**：
  **① 部署面漏包（只在干净安装暴露）**：`dsht-plugin-device` 只被加进 `NodeService.pluginRows`（patch 写入）与 `rebuild-plugins.ps1` 的 `$r10Ids`，**两处的插件「部署/编译」面都漏了它** ⇒ profile patch 引用了 `dsht-plugin-device`，而 App 从不把它拷进 `profiles/web/node_modules` ⇒ Cordis 的 loader 拿不到该 entry（**`entry.fiber === undefined`，不是「加载抛错」**——判据在 `dsh-app-boot` 的 `assertEntriesLoaded`）⇒ `plugin(s) failed to load` ⇒ `node exited with code 1; restart in 3s`（模拟器实录连续第 45 次）。**为何难查**：老设备上可能有上一次部署的**孤儿目录**，让「包在场」的假象成立，与 patch 的引用毫无契约关系 ⇒ **只在干净安装复现**；且报错文本 `could not be resolved` 极易误读成「包找不到」，实际语义是「entry 没有 fiber」。
  **② 顶层 inject 声明了本层不可得的 service**：首版 `inject = ['tools','systemPrompt']`——二者是 **agent 会话面**服务，本插件却在 **web profile 全局层**（同层只有 webServer/settings/llm）⇒ 父 fiber 停 PENDING ⇒ 同样 boot loop。修法试错：天真地「清空 inject」也不行——Cordis 的 ctx 是**严格代理**，未声明即读 `ctx.tools` **直接抛** `cannot get property "tools" without inject`。**定案** = `inject = []` + **官方 `ctx.inject([deps], cb)` 延迟接线**（cordis 文档：*"Start a callback once the requested dependencies are available"*，内部即 `this.plugin({inject, apply:cb})` 起子 fiber）⇒ 父 entry 立即 activated、子 fiber 安静等待、依赖将来就绪自动生效。官方同款实例见 `dsh-agent-tool-presentation/lib/index.js:46`。
  **③ `patchReload: "live"` 在 Android 不可满足（被①掩盖，修好①才暴露）**：它让 `runProfile` 在 boot 后走 `watchUserPatches`，而后者**硬依赖 Cordis HMR 服务**（`ctx.get("hmr")` 非空）否则 throw "user patch-layer watching requires the Cordis HMR service"；HMR 在 Android 起不来（dsh-base 的 bundle patch 里 `hmr` 行本身 `disabled: true`，补建同名 entry 仍命中该 disabled 行）⇒ boot loop。合法取值只有 `live`/`startup`（`loadProfileDirectory` 硬校验）⇒ Android 定案 **`"startup"`**（App 内 patch 由 NodeService 幂等维护，不存在「用户手编 patch 期望热生效」的场景）。**并修一处升级可达性**：原重写守卫只判 `contains("dsh-web-app")`，老安装的 package.json 已含该串 ⇒ `"live"` 会**残留**、老用户升级后继续 boot loop；已扩为同时检测 patchReload。
  **修复与防回归**：三处源码修复（`rebuild-plugins.ps1` 构建循环、`dsht-plugin-device` 接线、`NodeService.kt` 部署循环+patchReload+守卫）+ **两条常驻门禁**：[audit-plugin-build-parity.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-plugin-build-parity.mjs)（构建路径 4 判据，selftest 6/6）与 [audit-nodeservice-deploy.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-nodeservice-deploy.mjs)（部署契约 3 判据，selftest 6/6），**均经决定性负控**（回滚修复即被精确点名、还原即转绿），接入 build-dsht.ps1 Step 0.5。另有整套陈旧硬编码连带修正：`verify-rp-consolidation.mjs` 的 `R10` 常量 / 判据 6 `expect`（7→8 行）/ 判据 8c 的「循环成员=4」（改为真不变量「循环成员数 == `$r10Ids` 登记数」）。**真机终局验证**：模拟器上 `attempt 1` 后**零重启**、HTTP 服务在线、`DSHT-Device: device bridge listening on 127.0.0.1:3100`、无任何 `dsht-device` 报错 |
| W-4 守门人扩展 | ✅ | [Gate.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/Gate.kt)：danger 档**挂起 + 高优先级通知**（拒绝/批准本次两 action）；**默认拒绝**（无 Context 拒 / 超时 60s 拒 / 只认「真收到答复且为 true」）；**单次有效**（不可逆操作不给隐式窗口）；三态决策入审计日志。档位声明与命令模板**同处一地**（`OpDef.tier`）。**新门禁** [audit-device-tiers.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-device-tiers.mjs) 接入 Step 0.5：三判据（声明齐全 / danger 真被拦〔走 Gate 而非恒 false 死代码 / 判定早于命令构造 / Gate 默认拒绝语义在场〕/ 与文档一致），**selftest 6/6**（正控 + 5 条负控） |
| W-5 原生模块清零 | ✅ | **路线实证后定案**：sharp 官方 prebuild **无 android**（npm registry 实测缺 `@img/sharp-libvips-android-*`），bionic 与 glibc 不兼容；但 **sharp 主包自带 wasm 兜底分支**（`dist/sharp.cjs:102-108`，官方帮助文案亦明示 `npm install sharp @img/sharp-wasm32`）⇒ 接入 `@img/sharp-wasm32@0.35.4`，**不写任何转发层**。**spike 19/19 PASS**（[证据脚本](file:///d:/DSH%20RolePlay/rp-workspace/tmp/sharp-wasm-spike/)）：metadata 字段契约完整（`space=srgb`/`depth=uchar`/`hasAlpha`）/ jpeg+webp 编码 / raw 全解码 / clone+resize+rotate+toColourspace / png-jpeg-webp-gif 四格式（= DSH MEDIA_TYPES 白名单）/ **libvips 8.18.6**（正好满足 DSH `>=8.18.6`）/ 单份产物覆盖双架构。**并修一处潜伏静默失败**：原 stub 的 `toBuffer/toFile/resize` 是静默空实现，已收紧为**纯受控报错**（对齐本项目「宁可真错，不返假图」纪律） |
| W-6 共享交换目录 | ✅ | [ExchangeDir.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ExchangeDir.kt)：`/sdcard/Documents/dsht-exchange/` ↔ `$DSH_HOME/exchange/` 显式双向通道（冷启动 + 手动同步，不用 FileObserver——FUSE 跨挂载不可靠）；冲突判定 mtime 新者胜 → 同 mtime size 大者胜 → 否则 SKIP。**凭据永不参与**：`NEVER_MIRROR` 清单（`.credentials.yaml` / `dsht-token` / `.dsht-alive` / `device-audit.jsonl`）在**两个方向**都过 `isBlocked()`（**双向拒绝**，不是只挡出向）。**新门禁** [audit-exchange-guards.mjs](file:///d:/DSH%20RolePlay/rp-workspace/scripts/audit-exchange-guards.mjs)（三判据：清单非空且含凭据项 / 与 `MainActivity.BACKUP_EXCLUDE` 一致〔两处都是「凭据不出去」的实现，漂移意味着漏一处〕/ 拒绝必须双向），selftest 5/5，接入 Step 0.5。**模拟器正反控实证**：`进 App 1 · 出到文件管理器 1 · 拒绝凭据 2 个` |
| W-7 能力-权限看板 | ✅（代码）/ ⚠️（UI 未逐屏实测） | [MainActivity.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt)：自检面板升级为**能力-权限矩阵看板**——`CapRow` 数据结构 + `parseSelfCheck` 解析 + `formatBoard` 三分组渲染 + `actionFor` 一键跳转（每行 = 能力 / 状态 / 原因 / 可执行动作）+ `showSelfCheckDialog` 可点列表；**Shizuku 五态进矩阵**（未配对/已配对/未连接/不支持/就绪，取自 `ShizukuBridge.currentState()`）。不新增守护进程。**实证面（诚实标注）**：Kotlin 编译通过 + 全门禁绿；看板 UI 的逐屏视觉与一键跳转的落点**未在设备上逐项实测**（按项目口径交社区众包回填，见 B-DEVICE 清单） |
| W-8 系统轻入口 | ⬜ 未交付 | 分享 sheet 接收（文本/链接/图片）+ 快速设置磁贴 —— **本轮未做**。如实记录：v0.2.3 已随包发出（不含该项） |
| W-9 敏感数据落盘调研 | ⬜ 未交付 | 三问（jsonl 标记字段不落盘的注入点 / Keystore 静态加密开销实测 / 维持现状的威胁模型）—— **本轮未做** |
| W-10 插件安装通道调研 | ⬜ 未交付 | App 内从 ZIP/GitHub URL 装 RP 插件的注入点调研 —— **本轮未做**（相关机制部分已在 W-3 事故诊断中摸清：loader 的包名解析基准是 profile 目录，见下方「事故与修复」） |
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
