# GOAL：安卓化 DSH 层对 DSHA 的差距补齐（2026-09-21）

> **范围纪律**：本审计与 goal **只覆盖「安卓化 DSH」这一层**（原生壳 / 运行时部署 / 网络访问 /
> 数据安全 / 可靠性），**不含 RP 插件部分**（世界书 / MVU / 酒馆助手 / 会话手术 /
> 预设管线——那是我们的主战场，不与 DSHA 构成差距）。
>
> **对比基准**：[DSHA](https://github.com/DSH-APP/DSHA) v0.1.5-rc2 正式版
> （构建 129，2026-09 发布；功能面以其 README「能力全景」①~⑧ 与发布说明为准）。
>
> **我方基准**：v0.2.1（2026-09-21 发布，sentinel v371）。
>
> **路线前提**：我方是 **bionic 原生路线**（Termux Node 直跑 bionic libc，无容器层），
> DSHA 是**容器路线**（完整 Ubuntu 24.04 rootfs + proot/proroot）。补齐方式是
> 「在 bionic 路线上逐项解除限制」（README 已明示此路线承诺），**不是切换到容器路线**。
> 凡「只有完整 glibc 才能给」的能力，明确标注不追及理由。

---

## 一、审计方法与证据锚点

- DSHA 功能面：其仓库 README「能力全景」八个分组（①环境与装机 ②运行时与性能
  ③数据安全与迁移 ④设备能力 ⑤可靠性 ⑥网络与访问 ⑦插件生态 ⑧开发者友好）
  + v0.1.5-rc2 发布说明（多终端 PTY / 中英文分离 / DNS 模式 / 端口冲突自选等增量）。
- 我方功能面（本仓库可核对位置）：
  - 原生壳：[MainActivity.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt)
    （等待屏诊断 / SAF 文件选择 / AbortSignal.any polyfill / 加载失败自愈 / renderer 重建预算）、
    [NodeService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/NodeService.kt)
    （前台服务+通知 / 看门狗代际 / 异常退出标记 / 沙箱降级可见 / token 捕获 /
    ensureToolLinks 幂等修复 / P1 工具自测）；
  - 平台限制与已补齐项：README「安卓平台限制」表（bash/rg/git/zstd 已内置，flock/link 已补丁）；
  - 原生模块 stub 面：[stubs/](file:///d:/DSH%20RolePlay/rp-workspace/stubs)
    （node-pty / sharp / koffi / landlock / win32-process 均受控报错）；
  - LAN：信任栅栏已支持 lanMode（`dsht-plugin-shared/http.ts`），但应用层从未把
    webServer 绑到 0.0.0.0 —— **能力在栅栏层备好，产品面没接**。

---

## 二、差距清单（DSHA 有、我们没有）与补齐方案

> 优先级口径：★★★ = 用户价值高且 bionic 路线内可行；★★ = 有价值但成本/风险中；
> ★ = 低优先或先调研；✗ = 明确不追（附理由）。

### A. 终端与进程能力

| # | DSHA 能力 | 我方现状 | 补齐方案 | 优先级 |
|---|---|---|---|---|
| A1 | 交互式 PTY 多终端（标签管理、旋转/切页/语言切换保进程） | `node-pty` 是 stub（受控报错）；DSH web 的内置终端不可用 | **先调研后实施**（W-E）：① Termux 源编译 node-pty（Android NDK 有 `posix_openpt`/`forkpty`，Termux 生态已有成功先例——其终端就建立在同类机制上）；② 自研极简 pty 桥（JNI openpty + socket 转发，只满足 DSH terminal 的读写面）；③ 若两条都证明代价过高 → 如实标注「终端不可用」维持 stub。**决策点 = 调研报告**，不先承诺形态 | ★★ |
| A2 | 完整 glibc 环境（apt / Python / 原生模块随便装） | 结构性差异：bionic 路线原生模块需逐个适配 | **不追**。这是路线选择的代价面，README 已声明；替代路径 = P1 模式（按需从 Termux 官方源补具体 bionic 工具，deb 级 SHA256 校验，已实证可复制：bash/rg/git/zstd 四件套）。后续按需补单个工具走同一模式 | ✗（替代路径已在） |

### B. 数据安全与迁移（★ 本组是对 RP 用户价值最高的一组）

| # | DSHA 能力 | 我方现状 | 补齐方案 | 优先级 |
|---|---|---|---|---|
| B1 | 应用内备份/恢复（全量/分范围、10 份轮换、恢复前 gzip CRC 体检、凭据不进备份） | **零**——README 只能写「请自行备份」（RP 用户的会话/角色卡恰是最怕丢的资产，这是本审计发现的最刺眼缺口） | **做**（W-B）：导出 = 停服→zip `$DSH_HOME`（排除 `.credentials.yaml` / web token / `.dsht-alive` 等本机凭据与哨兵）到用户自选目录（SAF）；导入 = 选包→只读体检（zip 完整性 + 预览「多少会话/多大/来自哪个版本」）→停服→解压→sentinel 机制自然触发重对齐→起服。分范围（只对话/只插件）二期。我方 sentinel + 原子写体系让「恢复后自适配」比 DSHA 好做 | ★★★ |
| B2 | 数据放公共目录（Documents/dshdata，卸载不丢、文件管理器可见） | 全部数据在 filesDir 私有目录，卸载即丢 | **先评估后决策**（W-H）：Android 11+ scoped storage 下要 MANAGE_EXTERNAL_STORAGE（上架审核敏感）或 SAF 委托；卓易通/鸿蒙兼容层行为未知；shared storage IO 性能对 2.4 万文件的 runtime 是实测问题。**候选结论：B1 备份做到位后本项可能判定「不需要」**——评估报告必须给出明确判据（什么成立则迁、什么成立则不迁） | ★（评估） |
| B3 | API key 走 Android Keystore 加密 | DSH 自带 credentials 机制（私有目录），未加设备级加密 | 缓议。威胁模型：私有目录已被 SELinux 保护；Keystore 加密的增量价值主要在「备份外泄」场景，而 B1 已把凭据排除在备份外。等 B1 落地后重估 | ★ |

### C. 网络与访问

| # | DSHA 能力 | 我方现状 | 补齐方案 | 优先级 |
|---|---|---|---|---|
| C1 | 局域网访问（手机开着 dsh，电脑/平板浏览器直接用；token 鉴权 fail-closed + SameSite=Strict 防泄漏） | 栅栏层已备（lanMode 判定、同源校验全在），产品面没接：NodeService 固定 127.0.0.1:3080 | **做**（W-A）：设置开关「允许局域网访问」→ 重启服务绑 0.0.0.0 → 等待屏/设置页显示局域网地址（带 token，一键复制，随心跳刷新）。DSH 0.1.5 的 token 鉴权 + SameSite cookie 是现成的，我方栅栏已按同款语义写好。**RP 场景收益直接：大屏打字/管理卡片** | ★★★ |
| C2 | 端口冲突自动选择可用端口 | 固定 3080，冲突即启动失败 | **做**（W-C）：3080→3081→… 顺序探测，MainActivity 用实际端口加载；地址展示同步。与 W-A 同组改启动参数面，顺手做 | ★★ |
| C3 | 兼容版（内置 GeckoView 内核，Android 6+） | 系统 WebView + polyfill 路线（AbortSignal.any 已注入）；鸿蒙/卓易通已实测跑通 | **不追**。包体 +130MB；我方实测面（含鸿蒙）未出现需要换内核的个案；旧 WebView 已知缺口用 polyfill 逐项补（见 C4） | ✗ |
| C4 | 老浏览器 polyfill 补齐（AbortSignal.any/timeout、crypto.randomUUID 等——DSHA 踩过的清单是现成的） | 只有 AbortSignal.any 一条 | **做**（W-G）：按 DSHA 公开清单对齐注入面（randomUUID = 局域网 HTTP 非 secure context 必需，与 W-A 是**前置依赖关系**），逐条配「无该 API 的旧 WebView 怎么模拟测」的验证方法 | ★★（且是 C1 前置） |

### D. 可靠性与可观测

| # | DSHA 能力 | 我方现状 | 补齐方案 | 优先级 |
|---|---|---|---|---|
| D1 | 23 项自检 + 一键修补（桥/插件/会话/备份/运行时逐项体检，能修的当场修） | 零散能力各自在：诊断等待屏 / P1 工具自测（app 域 rc=0 实证）/ ensureToolLinks 幂等修复 / 沙箱降级可见 / resilient-list 会话隔离——**但没有一个统一的「自检面」把它们串起来给用户** | **做**（W-D）：收敛为自检面板——检查项：端口/token/四件套自测/sandbox 状态/磁盘余量/symlink 林完整性/会话目录健康（resilient-list 探针）；修复动作：重建 symlink 林（ensureToolLinks 就是现成修复器）/ 触发重解压（删 sentinel）/ 会话损坏隔离。**工程哲学沿用我方传统：每项检查配「怎么验证这个检查本身没坏」** | ★★ |
| D2 | 脚本增量热更新（离线验签） | 无 | **不追**。我方发版节奏快（beta.1~v0.2.1 密集），APK 更新即可；验签体系（密钥管理/轮换/泄漏处置）对单人项目是净负债 | ✗ |
| D3 | 全 CI 构建（推 tag 出签名 APK） | 本地构建（build-dsht.ps1，48 门禁 + M4 169 项） | **做**（W-F）：GitHub Actions 复现后半段（SkipInstall 不行——CI 需完整链：fetch-native-libs（下载 Termux deb，带 SHA256，天然 CI 友好）→ pnpm 构建 → 门禁 → gradle）。签名密钥走 GitHub Secrets。收益：release 可复现、贡献者可出包、真机众包者能拿到与源码严格对应的包。**风险点：构建机差异（Windows 本地 vs ubuntu CI）可能撞路径门禁，build-path-parity 恰是守这个的** | ★★ |

### E. 设备能力（agent 操作手机）

| # | DSHA 能力 | 我方现状 | 处置 |
|---|---|---|---|
| E1 | ADB 无线直连（配对/保活/重连，agent 点击/截屏/装应用） | 无 | **不追**（既定战略：用户场景不重叠，README 已声明；GOAL §六 照旧） |
| E2 | Shizuku 通道 / screen-ocr-operator 技能 | 无 | **不追**（同上） |
| E3 | 危险命令守门人（三渠道批准） | 无（DSH 自有权限档位：read-only / workspace-write / danger-full-access 由 DSH 本体提供） | **不追**（DSH 权限档位已覆盖约束面；守门人解决的是设备控制通道的风险，E1 不追则它无对象） |
| E4 | 流式悬浮条（歌词式 AI 输出贴屏） | 无 | **不追**（需要悬浮窗权限，RP 场景价值低） |
| E5 | App 桥（系统通知/设备信息/用户确认，127.0.0.1:3090） | 有 DSHTNative WebView 桥（设备能力桥到前端，路径不同） | 形态差异，非差距；按需扩 DSHTNative 面即可，不单列 |

### F. 装机与分发

| # | DSHA 能力 | 我方现状 | 处置 |
|---|---|---|---|
| F1 | 分步安装 / 断点续装 / 多源测速 | 不需要——全部内嵌 APK，无下载步骤 | **形态差异非差距**：这是他们 370MB rootfs 装机路径的配套成本，我方单包内嵌天然免疫 |
| F2 | 插件市场（浏览/安装/更新/启停/删除全在 App 内） | 官方 DSH 设置页有插件管理；社区插件安装路径已验证（B2 实测对账）；无独立市场 UI | **缓议**。市场 UI 属生态层而非安卓化层；且 dsh.so / dsh-market 等社区市场正在长，接入优于自研（生态协作优先于自研——既定原则） |
| F3 | 中英文分离（原生界面/双内核随语言切换） | 原生壳是等待屏+诊断（中文文案）；DSH web UI 自身的 i18n 由上游负责 | 低优先：等原生壳文案面变大（W-B/W-D 落地后）再统一做，现在做是空转 |

---

## 三、我方独有面（安卓化层内，DSHA 没有）

> 只列**安卓化 DSH 层**的独有项；RP 兼容层不计（那是另一个维度的碾压面，不在本审计范围）。

| # | 独有能力 | 证据 | 战略含义 |
|---|---|---|---|
| U1 | **鸿蒙/卓易通实测完整跑通**（HarmonyOS 6 + 卓易通，2026-09-19 用户实证） | README 验证面速查表；DSHA 官方标注「未验证」 | 独占生态位。华为系设备是国内 RP 用户大头，这是**分发面**的硬优势 |
| U2 | **双架构交付**（arm64 真机 release + x86_64 模拟器 debug，CDP 可调） | v0.2.1 双 APK；DSHA 仅 arm64 | 开发者/贡献者零真机门槛；我们的全部自动化（CDP 端到端）建立在 x86_64 面上 |
| U3 | **包体 135MB vs 370MB**（bionic 路线无 rootfs） | v0.2.1 实测 vs DSHA 标准版 176.69MiB/兼容版 253.23MiB（注：其 v0.1.5-rc2 已比旧版 370MB 瘦身，但仍为我们 ~1.3~1.9 倍） | 下载/安装转化率；鸿蒙卓易通的存储配额敏感 |
| U4 | **单进程形态 phantom-killer 天然免疫**（Android 12+ 后台子进程限 32 个） | README 对比表；DSHA 需用户开「停用子进程限制」 | 免折腾=留存；容器路线结构性高危项我们天生没有 |
| U5 | **无容器层开销与 seccomp 风险**（node 直跑 bionic；proot 仅用于沙箱包裹，缺席可降级） | [C-ANDROID-HARNESS-ASSESSMENT](file:///d:/DSH%20RolePlay/docs/C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md)（Android 15 seccomp 收紧对 ptrace 密集场景的打击评估）；DSHA 的 proroot 缓解了 ptrace 开销但容器层仍在 | 长期维护成本：Android 每升一版，容器路线的适配风险都比我们大 |
| U6 | **门禁/负控工程体系**（48 项常驻门禁 + 负控杠杆自证 + M4 169 项 APK 内容核验 + deb 级 SHA256 + 产物新鲜度逐字节 + BOM 守卫） | build-dsht.ps1 全程；DSHA 有 CI Fast checks（300 断言）但无负控自证形态 | 「声明与实现一致」是机器守的，这是单人项目对抗团队的**复利资产** |
| U7 | **SELinux 实证部署形态知识**（untrusted_app 域 execve 必拒的 avc 实证 → jniLibs 伪装 .so + symlink 林 → app 域 rc=0 闭环） | NodeService.kt 头注 + P1 纪实 | 任何 bionic 路线后来者都要重新踩一遍的坑，我们有完整实证记录 |
| U8 | **sentinel 覆盖安装自动重解压**（runtime 代次与 APK 解耦，覆盖安装零手工） | NodeService RUNTIME_SENTINEL v371 实证 | DSHA 用分步安装解决同问题，我们零步骤 |
| U9 | **沙箱降级可见性**（proot 缺席 → fs 边界降级，原因带到 UI 等待屏，不静默） | NodeService.sandboxFallback / L4 | DSHA 无此场景（容器必在）；我方「降级但诚实」是独特工程口径 |

---

## 四、工作面（执行分解）

> 排序按「价值/成本」比 + 依赖关系（C4 是 C1 前置；B1 独立最高值）。

| 工作面 | 内容 | 交付物 | 验收口径 |
|---|---|---|---|
| **W-A** | 局域网访问（C1）：设置开关 + 绑 0.0.0.0 + 局域网地址展示/复制 + 防泄漏核查 | 开关 + 地址面 + 测试 | 模拟器实证：宿主机浏览器经 LAN IP 访问通过 token 鉴权；关掉开关回 loopback；栅栏测试（Host 伪造/Origin 跨源）全绿 |
| **W-B** | 备份/恢复（B1）：导出（排除凭据/哨兵）+ 导入（体检→停服→解压→sentinel 自对齐） | 设置页「备份与恢复」+ 测试 | 模拟器端到端：造会话→导出→清空数据→导入→会话完整可读；坏 zip 体检报具体原因；凭据不进包（解开核验） |
| **W-C** | 端口冲突自动回退（C2）+ 启动参数化 | NodeService 端口探测链 | 占用 3080 后启动实证：自动落 3081 且 UI 正常加载 |
| **W-D** | 自检面板（D1）：收敛既有零散检查 + 一键修补 | 诊断页「自检」区 + 每项自证 | 每项检查配负控（注入故障→报红指向项 →修复→回绿） |
| **W-E** | node-pty 调研（A1 决策点）：Termux 编译 vs 自研 pty 桥 | **调研报告**（含 POC 证据）+ 决策 | 报告必须回答：两条路各自的真实成本、对包体/门禁的影响、POC 是否在模拟器 app 域 rc=0；决策后再立实施 goal |
| **W-F** | CI 出包（D3）：GitHub Actions 复现构建链 | workflow + 一包实证 | CI 出的包过 M4 169 项 + 门禁全绿；与本地包关键产物逐字节对账 |
| **W-G** | polyfill 对齐（C4）：randomUUID 等按 DSHA 公开清单补齐 | MainActivity 注入面 + 模拟旧 WebView 验证法 | 每项 polyfill 配「无该 API 环境怎么模拟」的测试 |
| **W-H** | 数据公共目录评估（B2 决策点） | **评估报告**（迁 vs 不迁的明确判据 + 结论） | 报告含：scoped storage 路径实测、卓易通行为、IO 性能数据；若结论=迁则另立实施 goal |

**依赖序**：W-G → W-A → W-C（同改启动/网络面，一波出）；W-B 独立最高值，可与前者并行；
W-D 在 W-A/B 落地后把它们纳入自检项；W-E/W-H 是调研面，随时可开；W-F 独立。

## 五、非目标（本 goal 明确不做）

- 设备控制通道全家（ADB 无线 / Shizuku / screen-ocr / 悬浮条 / 危险命令守门人）——既定战略，用户场景不重叠；
- 完整 glibc 环境（apt/Python/任意原生模块）——路线代价面，用 P1 模式按需补单个工具替代；
- GeckoView 兼容版内核——包体代价不值，polyfill 路线已够；
- 脚本热更新验签——发版节奏快，APK 更新即可，验签体系是单人项目净负债；
- 插件市场 UI——生态层非安卓化层，接入社区市场优于自研（缓议项）；
- 中英文分离——等原生壳文案面变大再做。

## 六、完成定义

1. W-A/B/C/D/G 五个实施面交付且各自验收口径过（模拟器面实证 + 测试进套件）；
2. W-E/W-H 两份调研/评估报告交付且给出明确决策；
3. W-F CI 出包实证（或报告说明为何不可行——例如某门禁强绑 Windows 本地路径）；
4. README「与 DSHA 的关系」对照表按本审计结果更新（独有面 U1~U9 入表，
   DSHA v0.1.5-rc2 的新能力面同步刷新——现有表格还是其旧版口径）；
5. 真机/鸿蒙验证按既定口径众包，不阻塞上述收口；
6. 全套 vitest 绿 + 构建门禁绿 + 发新版 APK（版本号届时再定）。
