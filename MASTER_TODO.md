# DSHTavern 总待办与现状（唯一活文档）

> **这份文档给谁看**：两个读者。① 你——看 §1~§4 的大白话部分做决策，每个问题都解释了"是什么、现状、我推荐什么"；② 未来的工程师或 AI——看"做法细节"和 §6 速查照着干活。
> 建立：2026-09-02。取代并归档了六份旧文档（位置见 §8），此后新任务、新结论一律回写本文件。

---

# 【状态总览】只看这一页就够

> **更新规则**：本页每次工作轮次（心跳）结束时更新。**其余章节是流水账，不必读。**
> 最后更新：2026-09-10（心跳 39）

## 一句话现状

**手机 APK 能跑了，数据能搬了，戏能演了** —— 现在在做「让它的行为和你熟悉的 TauriTavern 一模一样」。

## 三个阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| **一 · 地基** | 自研 37,635 行代码，把 ST 的角色卡/世界书/聊天/预设搬进安卓 APK | ✅ **完成** |
| **二 · 和 TT 逐项对齐** | 截获双方发给 AI 的完整请求，逐条对比，修差异 | 🔄 **进行中**（8 项差异，5 项已闭环） |
| **三 · 发布前准备** | 大扫除 / README / GitHub Releases + 更新开关 | ⏳ **未开始**（3 件事） |

## 你投诉过的事（全部已修）

| 你说的问题 | 状态 | 轮次 |
|---|---|---|
| 悬浮窗到处乱窜 | ✅ 修好 | 心跳 35 |
| 显示成 `<interactive_input>$1` | ✅ 修好 | 心跳 36 |
| **发不出来消息** | ✅ 修好 | 心跳 37 |

## 和 TauriTavern 的差距（用请求体积量化）

| 指标 | TauriTavern | DSHT 修复前 | DSHT 现在 |
|---|---|---|---|
| 请求条数 | 25 | 71（2.84×） | **12 条** |
| 字符数 | 85,437 | 426,950（5.00×） | **127,794**（1.5×） |
| 大块重复 | 0 组 | 4 组 | **0 组** |

## 还剩什么（8 项差异里）

| 编号 | 差异 | 状态 |
|---|---|---|
| D-4 | 用户输入位置和 TT 不一样 | ⏸ **等升级**（见下，可能有解） |
| D-6 | 多出 31 个工具定义（TT 没有） | ⏸ **等你拍板** |
| D-7 | 采样参数缺对照 | ⏳ 优先级低 |

## 正在进行：把 DSH 从 0.1.2 升到 0.1.5

**为什么升**：新版本把「系统提示词」从隐式字段提升成正式数据节点，还支持"动态替换" ——
**这正好可能解开 D-4**（那个我原本判定"无解"的问题）。

**风险**：会话文件要迁移（v1→v2→v3 三段），**不可逆**。所以分 5 步走，每步可回滚。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 备份设备数据 + 冻结 | ✅ **完成**：runtime staging 已备份（259MB，含 0.1.2-rc.1 实证） |
| 1 | 静态预检（复核 11 个补丁点） | ✅ **完成**：8 稳定 / 2 需扩展 / 1 新 stub |
| 2 | 升级运行时 + 重打补丁 | 🔄 **进行中**：0.1.5-rc.1 已装入 `dsh-runtime-src`（499 包）；**F1 补丁方案已实证**（link 有 3 处，补丁需 4 点），待实施 |
| 3 | 会话迁移验证（最高风险） | ⏳ 待设备上线 |
| 4 | 功能回归 + D-4 重评 | ⏳ |

> **进展度量**：`bash .goal/upgrade-0.1.5/evaluate.sh` → 当前 **2 / 5**（目标 5）
> 工作区：`.goal/upgrade-0.1.5/`（GOAL / STRATEGY / LEARNINGS / HEARTBEAT）
> **回滚保险**：`backup/dsh-runtime-android-0.1.2-staging`（已 gitignore）

📄 方案全文：`docs/DSH-0.1.5-UPGRADE-PLAN.md`

## 要你拍板的事

| # | 问题 | 我的建议 |
|---|---|---|
| A | 升级时机：立即开始（前两步零风险）还是等正式版？ | **立即开始**，阶段 0/1 纯静态不碰数据 |
| B | 能不能接受升级时"打开旧聊天要等一会儿"？ | 等实测数据出来再定 |
| C | 「动态替换提示词」要不要启用？ | 升级完再单独评估，别一次动两个变量 |
| D | 那 31 个工具要不要一并处理？ | **分开**，升级已经够大了 |

## 关键数字

```
自研代码   95 个文件 / 37,635 行
自动化测试  36 个文件 / 710 项全绿
提交次数   43 次
工作轮次   39 个心跳
文档       29 份（唯一活文档 = 本文件）
最新 APK   x86_64-debug 187.7MB / arm64-release 122.4MB
```

---

## 1. 项目现在是什么状态（大白话）

一句话：**手机 APK 里跑起来了一个完整的"AI 角色扮演游戏"**——把你 SillyTavern 里的全部家当（角色卡、世界书设定、聊天记录、预设）搬进来，AI 能查设定、能演戏、能记住变量状态，你换手机也能装。

具体能干什么（都经过实机或自动化测试验证）：

| 能力 | 大白话解释 |
|---|---|
| 一键打包 APK | 一条命令把整个系统打成手机能装的安装包（官方程序 + 我们的全部改造） |
| 数据搬家 | 374MB 的 ST 数据包整包搬进来：21 张角色卡、38 本设定书、21 个聊天、6 套预设，聊到一半的也能接着聊 |
| AI 角色扮演 | AI 回复前会自动查角色设定；支持变体（一句话的 5 个版本左右切换）、回退（后悔了能倒回去）、状态栏（好感度/位置这些数字） |
| 酒馆脚本兼容 | ST 社区脚本（酒馆助手写的自动化脚本）基本都能跑——包括最复杂的 MVU 变量框架（9 月 2 日刚修通） |
| 质量保障 | 621 项自动化测试全绿；构建过程踩过的坑全部记录在案 |

**一句话总结差距**：能玩，但"重度玩家聊很多楼"会撞上性能墙（见 §2.2），离"敢公开给别人用"还差发布前的准备工作（见 §3）。

> **2026-09-10 最新状态（心跳 37）**：用户三项直接投诉**全部闭环** ——
> ① 悬浮窗乱窜（§2.2c ✅）② `$1` 包装显示（§2.2d ✅）③ **发不出来消息**（§2.2e ✅）。
> **goal 的前置阻塞已解除**：实机全链验证通过（mock 收到 `messages=45/48`、`turn/end completed`、
> UI 裸文本渲染、错误计数不增长），全量单测 **710/710 绿**。
> 当前验收基准已由用户重新定义为 **TauriTavern-Canary**（见 §1.5）。

## 1.5 验收基准重定义（2026-09-09 用户拍板，最高优先级）

**基准 = TauriTavern-Canary**（`D:\SillyTavern-1.16.0\TauriTavern-Canary`，ST 社区 fork，用户判定"写得更好"）。

- **判据**：DSHT 的移植机制在 **功能 / 显示效果 / 使用体验** 三方与 TauriTavern **完全一致** = 初步移植完成。
- 此前「和 ST 一致」的表述统一精化为「**和 TauriTavern 一致**」。
- Golden Master 对照的**基准侧 = TT**（ST 侧数据仍可采集作参考）。
- 用户明确指令：「别再用 luker 了，给我用 tauritavern」；「我让你对比同步的是 DSHT 和 TT 的使用体验，
  你非要去弄 ST 不是浪费时间吗？」→ **一切差异追查以 TT 源码/data 为第一取证源。**

---

## 1.6 战略收口决定（2026-09-08，用户拍板执行）

- **git 版本控制建立**：本仓库首次基线提交 `947d8f9`（v0.2.0 收口点；vitest 实测 656/656 全绿）。此后每完成一个条目即提交一次；vendor runtime / 构建产物 / 签名文件 / 大体积测试输入经 .gitignore 排除。提交身份暂用内联 `DSH <dsh@local>`（未改全局配置，可随时 `git config --global user.name` 自定）。
- **工作区清场**：`.audit`（约 9.8k 文件）与根 `tmp`（约 32k 文件）的一次性探针/截图归档至 `D:\DSH-RolePlay-archive\`，工作区只留活代码。历史文档引用的 tmp 脚本（verify-fixes.mjs、audit2-*.mjs、parse-check.ps1 等）以归档目录为准。
- **v0.3 功能冻结**：冻结范围、兼容分级（Tier 1 承诺 / Tier 2 尽力+时间盒 / Tier 3 明确不承诺）与「收口/探索」双模式，见 **docs/V0.3-FREEZE.md**。v0.3 只做四类事：验证债闭环、发布三硬门槛（大扫除/README/Releases+更新开关）、Tier 1 缺陷、审计报告抓到的两个疑似缺口。
- **兼容面完整性审计**：TH/正则/MVU 三模块对 ST 源码逐特性对比，报告见 **docs/COMPAT-AUDIT-2026-09-08.md**。结论先行：缺口几乎全部是「记名登记过的设计决策」，不是当初搬运没做——"修了又冒"的根因是兼容面长尾 + 修复未沉淀回归，对策已写进冻结清单 §2。
- **仓库边界澄清（2026-09-08 用户澄清，勘正同日早前「PC 线冻结」误读）**：本仓库（DSHTavern 安卓版）是唯一在研项目；BitFun / agenthub 是另一个完全独立的项目，与本仓库无代码互通，不纳入本档管辖。PC 副本（.a Agent RolePlay Project）唯一关联 = 回退插件 dsht-plugin-undo 两侧同步（铁律不变，仅限此插件；其余插件在 PC 无副本、无需同步）。

---

## 2. 接下来要做的事（按优先级）

> 建议开工顺序：**2.1 记忆插件 ✅ → 2.2 上下文瘦身 ✅ → 2.3 ② 两套规则单向生成 ✅ → ③ 楼层号显示 ✅ → ④⑤ AI 可见范围手动控制 ✅ → ① 人设迁移 ✅（2026-09-03 已完成，见 §2.3①；本行原为陈旧标记，2026-09-08 勘正）**。

### 2.0 楼层口径修正 + 回退/编辑/重新生成 + 思考耗时【2026-09-04 用户拍板新增；2026-09-04 完成 ✅】

三项用户明确要求，全部真机端到端验证（st-asm3yf）：

**① 楼层口径修正（turn 口径）**：旧实现每个思考 step 占一楼（assistant-step 恒计楼）
→ 改为**一轮用户输入 = 1 楼，一轮 AI 回答（同 turn 全部思考/工具 step）= 1 楼**：
- UI：`RpNativeChat.tsx floorIndexOf` 按 assistant-step 的 `data.turn` 分组（同 turn 合并）；
- 记忆：`dsht-plugin-memory extractFloorsFromEvents` 同口径（`data.turn ?? data.message.turn`，
  turn 缺失退化旧口径）；进度游标 = 事件流自算楼层总数（turn 口径），rp/state cursor
  （消息条数）仅作 20s 轮询的变化信号——**记忆锚「记忆#N」与 UI #N 现在同口径**；
- 世界书 `visibleMessageCursor`（消息条数技术游标）**不动**（上游 MIT 语义，与 UI 楼层解耦）。

**② 回退/编辑/重新生成（原 dsht-plugin-undo 收编 + 真机实证改造）**：
- **真机实证 409 死锁**：DSH 的 session 实例进程级常驻（客户端断开不解除），
  文件手术式截断对"会话打开中"（RP 常态）必然 409——undo 插件部署后等于废；
- **live 逻辑回退**（/rp/session-rollback、/rp/session-edit、/rp/session-regenerate
  双路径）：live 走官方 `append + surfaceOp replace` 原语（memory 影子化同款）——
  compaction/prune 计量 + marker 顶替 [锚, 视图末]，**模型视图立即回退、事件留在日志
  （聊天数据零丢失）、变量回滚（undo 日志）生效**；非 live 保持文件截断 + .bak + 文件快照；
- **UI 掩码**：客户端投影不透传 marker 的 source（真机实证）→ 新增 /rp/rollback-mask
  （host 从日志解析最大锚）+ rp-ui `useRollbackMask` store（useSyncExternalStore）——
  被回退/编辑的消息行隐藏、楼层号重排；回退/编辑/重新生成成功后立即刷新掩码；
- **槽位冲突修复**：undo 插件原注册 conversation.chat.node keyed `user`（priority -1）
  与 rp-plugin 的 RpUserNodeView 同 key 同 priority **互斥**——双方同注册会打挂 rp
  loader entry（RP 界面全失，真机实证）→ undo 收敛为纯 host 数据面（/dsht-undo/*），
  UI 全部由 rp 提供（回退+编辑在 user 气泡、重新生成在 assistant-actions）；
- **部署路径实证**：设备上插件运行位置 = `files/dsh-runtime/node_modules/`（非
  profiles/web/node_modules）；web 服务对 /plugins/* 的 bundle **启动时读入内存**，
  运行中替换文件无效，必须重启 app。

**③ 思考/任务耗时**：`ReasoningRow` settled 后显示「思考了 X · 任务耗时 X」——
数据源 = `finalNode.timing`（stepStartTime → completedTime，官方精确口径）；
turn 总耗时 = 末 step completedTime − 首 step 开始，只挂每楼最后一个思考行；
running/中断（turn-error）无完整 timing → 退化「已深度思考」（不显示不准的数字）。

单测：memory 插件 37/37 绿（新增 turn 合并/迁移格式/退化用例）。
**已知限制**：逻辑回退后 UI 楼层号与事件流楼层（memory 锚）在回退点之后会错位
（事件流楼层持续增长，UI 视图重排）——如需对齐需 memory 提取按视图过滤，待用户反馈。

### 2.0b PC 副本同步 + 导入面板折叠 + 安卓闪退/发烫治理【2026-09-04 用户反馈；2026-09-04 完成 ✅】

**① PC 副本（.a Agent RolePlay Project）undo 同步**：`.dsh-home/profiles/web/node_modules/
dsht-plugin-undo` 是 8/28 旧版（平铺布局 + user 槽位冲突缺陷），且 cordis.patch.yml 已注册它
（config：maxFiles=100000 / excludePrefixes=['_pipeline/']，与新 undo 的 WorkspaceSnapshotConfig
兼容）→ 已覆盖为新版（lib/index.js + lib/client.js + package.json），PC 端重启 DSH 生效。

**② 导入状态面板折叠**：MigrationStatusPanel 默认收起为一行摘要（「导入与运行状态 API ✓ ·
插件 4/4 正常」），点开看四块详情。**实现教训**：卓易通真机 WebView 的 `<details>` 原生
折叠失效（裸 details 实测 open=false 内容照常渲染，模拟器复现同款）→ 用 React 受控状态
+ 条件渲染（expanded && <body/>）保证收起即不占位。

**③ 安卓闪退/发烫根因与修复**（nova 12 pro / 麒麟8000 / 鸿蒙6 卓易通）：
- **根因 1（闪退主嫌）**：NodeService 前台服务用的 `dataSync` 类型——**Android 15+（鸿蒙 6
  对标）对 dataSync FGS 有 6 小时强制超时**，超时系统停服务 → node 失去前台庇护被 LMK 杀
  → 长会话必断。修复：API 34+ 改 `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`（无超时，manifest
  补 FOREGROUND_SERVICE_SPECIAL_USE 权限 + PROPERTY_SPECIAL_USE_FGS_SUBTYPE 说明；
  <34 保持 dataSync）。
- **根因 2（白屏/"闪退"感）**：WebView renderer 是独立进程且 oom_adj 偏高，内存吃紧时
  最先被杀 → 页面白屏/重载。修复：`setRendererPriorityPolicy(IMPORTANT)`（API 29+）。
- **根因 3（发烫 + 被杀）**：node 默认按物理内存扩 V8 堆（手机可达数 GB）→ 膨胀到 LMK
  阈值被整进程杀。修复：`NODE_OPTIONS=--max-old-space-size=512`（node 子进程隔离，限堆
  不限功能）。
- 卓易通 hismart perf 是厂商私有机制，app 无法编程调用；用户侧操作建议：卓易通/鸿蒙
  设置里把 DSHTavern 加入省电白名单/受保护应用 + 关闭对它的智能省电，性能模式前台自动
  生效。
- 交付：`DSH-Tavern-0.2.0-arm64-release.apk`（真机安装，sentinel 递增自动重解压最新插件
  + profile 自动同步）；模拟器 x86_64 debug 全量回归（楼层/按钮/掩码/折叠/FGS）通过。

### 2.0c 性能热点治理（合规边界内）+ 移动端窄屏全面排查【2026-09-04 用户要求；2026-09-04 完成 ✅】

**① 性能热点（全部合规：只改自研插件，零 DSH 源码改动）**：
- **TH 变量 PUT 心跳风暴（最大头）**：酒馆脚本宿主的脚本每 2s 整树 PUT chat 变量，
  TH 插件每次都走「整树 diff + undo 日志 + 文件快照 + 写盘」全链路（真机 logcat 实证
  `[dsht-th] set chat:/` 每 2s 一条）→ 加**内容短路**：序列化相等直接返回
  （`unchanged: true`），心跳写零 I/O；
- **memory tick 全量解析**：大会话（数 MB/上万事件）每次 cursor 变化全量
  JSON.parse → `floorStatCache`（size+mtime 失效；append-only 文件未变即楼层不变），
  命中时每次 20s tick 只花一次 stat；
- **rollback-mask 重复全量扫**：前端每个消息行挂载都触发 → host 内存缓存（mtime
  失效）+ 逻辑回退/编辑/重新生成成功后 clear（marker 落盘滞后免疫）；
- 三插件重打包部署（TH/memory/rp-host），模拟器回归无错误。

**② 移动端窄屏全面排查（CDP 模拟 384dp 宽逐界面实测）**：
- 检测面：聊天主界面 / RP overlay 各 tab（import/lore/preset/regex）/ 侧栏抽屉 /
  悬浮球 / 楼层徽章 / 回退编辑按钮 / DSH 原生设置面板（mobile 锚点适配）；
- 结果：**横向溢出 0**（全部界面）；侧栏抽屉 left 位移正常；悬浮球/汉堡 44px 触控
  目标在视口内；最新楼层徽章/回退/编辑按钮 384dp 全可见；
- **修复 1 个真问题**：RP overlay 高度 887 > 视口 840（溢出 47px）——mobile 五件套给
  `fixed inset:0` 的 overlay 加 `height:100dvh`（覆盖 bottom 约束）+ safe-area padding
  （content-box 双计）→ 去掉 height + `box-sizing: border-box`；复测 overlay 840=视口 ✅；
- **环境教训**：卓易通/模拟器 WebView 的 `<details>` 原生折叠失效（裸 details
  open=false 内容照常渲染）——需要折叠的面板一律用 React 受控条件渲染。

### 2.0d 真机回归修复：会话历史加载失败 + 顶栏重叠【2026-09-04 真机截图反馈；2026-09-04 完成 ✅】

**① 会话历史加载失败（"Failed to fetch (internal)"）——上轮 512 堆上限的回归**：
`--max-old-space-size=512` 太紧：大会话 session.history 全量事件进内存撞 V8 上限 →
RPC 抛 OOM → 前端 "历史加载失败"（截图实证：会话统计条正常显示=轻量 stats 文件读通，
history 全量加载失败=重路径挂）。修复：**512 → 1024MB**（兜住大会话加载，仍防无限
膨胀触发 LMK 的平衡点）。

**② 会话顶栏重叠（真机截图实证）**：两个独立缺陷叠加——
- 汉堡按钮（mobile 插件 fixed @12px）盖住原生顶栏的面包屑/"对话"tab；
- 原生 header 的会话名 crumbs（`nav.wSkVaW_crumbs`）不可收缩，长会话名盖住
  headerActions（"Session log ↓ / 0 个子项"）——408dp 探针实测 9 组文字两两重叠。
修复（mobile 插件锚点化，零哈希类外溢）：ANCHOR_DEFS 新增 chat-header / chat-crumbs /
chat-header-actions 三锚（候选选择器 `.wSkVaW_header/_crumbs/_headerActions` 单点维护）；
CSS：header padding-left 52px 给汉堡让位 + crumbs `min-width:0 + overflow:hidden +
mask 渐隐` 收缩 + actions flex-shrink:0 保全。408dp 复测：**重叠 0、汉堡与
crumb/tabs 零相交**（修复前 9 组重叠）。

**③ 双设备真实分辨率适配复测（CDP 模拟）**：nova 12 Pro（1224/3=408dp）与
Y700 五代（1904/2.75≈692dp，8.8" 3040×1904 @408ppi）——聊天 + overlay 三 tab
全部无横向溢出、关键元素可见、overlay=视口高。交付 APK 15:00 arm64 release。

### 2.0e 新数据包（505MB）真机导入验证 + JSZip 卡死修复【2026-09-04 用户供包实测；2026-09-04 完成 ✅】

用户供包 `tauritavern-data-20260903-162517.zip`（505MB / 14460 文件 / 解压 914MB：
52 卡 42 聊 40 书 + agent-workspaces 17489 文件；最大会话 jsonl 12.38MB）真跑导入验证：

- **发现并修复真缺陷：JSZip 全量解压卡死**——`unpackZipTo` 原实现 `readFile` 整包
  Buffer + `JSZip.loadAsync` 逐 entry V8 堆解压，505MB 包在 4GB 内存模拟器上
  **11087/14460 停滞 15 分钟**（sys CPU 175% = swap 风暴）。修复：Android 上优先
  **busybox unzip 流式解压**（`spawn(libbusybox.so, ['unzip','-o','-q',src,'-d',dst])`，
  子进程直接读文件、node 零大内存占用；BUSYBOX_APPLETS 增补 unzip applet），PC/无
  busybox 环境回退 JSZip。修复后 14460 文件约 5 分钟完成（模拟器 I/O 上限）。
- **staging→manifest→preview 全链路通过**：`kind=st-data` ✓；preview 语义分类
  22 卡（顶层真卡）/39 书/21 聊/8 预设/123 EJS 模板/1 丢弃项（backups 目录，设计内
  ——源 zip 本身就是备份）；manifest 计数 52 卡含表情差分子目录 PNG（口径差异非漏识别，
  `default_Seraphina` 为 ST 示例卡）；chats 归属匹配三键外的目录走 rp/_orphan 待认领
  （数据不丢）。
- inbox 识别（DSHTShare.readSharedInbox）验证 ✓；kickoff（适配 agent + LLM）为既有
  流程未重跑。堆上限 512→1024→**2048**（12.38MB jsonl 会话 history 对象树实测锚定：
  512 必挂、1024 临界；撞上限=单请求报错可控，无上限=后台挂机膨胀被 LMK 整杀）。
- 交付：`DSH-Tavern-0.2.0-arm64-release.apk`（含流式解压 + 2048 堆）。

### 2.0j 会话管理面板 + 0.1.2 /api cookie 链修复【2026-09-04 晚，v116 包】

**① 侧边栏多余会话来源定位（用户诉求：自动清理回退产生的旧会话）**：
- **事实澄清**：我们的回退（↩ 回退到此处 / ✎ 编辑 / 重新生成 / 变体条）全部是**同会话
  原地操作**（官方 replace 原语）——**不开新会话**，侧边栏不应变化；比 Trae 的
  "新会话+隐藏旧会话"方案更优（Trae 开分支是它的架构限制）。
- **真来源**：DSH 原生消息操作菜单自带 **branch / fork**（0.1.2 实证存在）——官方"分叉"
  语义 = 开新会话复制历史，旧会话按官方设计保留在侧边栏。
- **识别链（0.1.2 header 契约）**：fork 产物 header 带 `parentSession`（父会话）+
  `isSeeded:true`；`origin:'subagent'` 是子代理（永不触碰）。

**② 新增会话管理能力（R21）**：
- 数据面：`/rp/sessions-audit`（全量审计+分类：branch-parent/forked/subagent/empty/
  normal）、`/rp/sessions-archive`（归档）、`/rp/sessions-autoclean`（mode=branch-parents/
  empty，dryRun 预览）
- 前端：RP overlay 新增**「会话」tab**（SessionsPanel）——审计列表（类型徽章/事件数/
  末时间）+ 单会话归档 + 一键自动清理（分叉残留/空壳，确认后执行）
- 归档 = 官方 workspaces.archiveSession（registry-global archivedSessionIds 集）——
  **侧边栏全隐藏、数据保留、可恢复**（不是删除）
- **归档实现（v117 修正）**：`workspaceRegistry.archiveSession` **进程内直调**——
  /api 平坦 method 空间没有 workspace.archiveSession（实测 404，cookie 链通了也 404），
  HTTP 路径不可行；registry 走 ctx.get('workspaceRegistry') 进程内直取（PC 实测
  archived=[dsht-welcome] 全通）

**③ 0.1.2 /api cookie 链（升级适配第 4 项，重大）**：
- PC 实测：/api RPC 全部要求 30 天签名 cookie（浏览器 index ?token= 交换才有）——
  **node 进程内 loopback hostRpc（kickoff/续跑/编辑重发）无 cookie → 401 全挂**；
  query token 无效（token 只在 index 交换有效）
- 修复：dsh-plugin inject 加 'connection' → `ctx.connection.browserAuth.launchToken` →
  自走 token 交换（GET /?token= redirect manual）收 set-cookie 缓存 → hostRpc 全部带
  Cookie 头，401 清缓存重交换一次（PC 实测：token present(43) → 303 → cookie 315ch ✓）；
  hostRpc 非 JSON 响应错误可读化

### 2.0i 真机"等待 web 认证令牌"卡死修复【2026-09-04 晚，v115 包】

**现象**：真机装 v114 后诊断面板显示"端口已开放 ✓"但"等待 web 认证令牌"数分钟无动静。

**PC 复刻实证两轮**：
- 纯净 home（0.1.2 自初始化）+ 全部 dsht 插件 profile → **装载全绿**（六插件 namespace/
  data plane 注册 + announce token 行正常打印）——插件契约与装载无问题；
- **0.1.2 profile 元数据机制**：`dsh.profile.bundles`（dsh-base + dsh-web-app）三件套
  （cordis.yml/package.json/pnpm-workspace.yaml）；官方首启自写三件套 + 我们 patch 不被
  动（重写安全实证）。

**真机根因（判定）**：真机 profile 是 rc.8 时期形态——旧元数据 + 0.1.2 loader = loader
挂起且 **announce 静默**（dsh-web-app 的 loader reject 分支为空函数）→ token 永不打印 →
MainActivity 永等；且原实现的 401 降级后 onReceivedError 重置 tokenWaits → 无限循环。

**修复（v115）**：
1. NodeService `ensureProfileMetadata`：profile 三件套对齐 0.1.2 标准形态（内容为 0.1.2
   首启实证固定值；诊断日志留痕 "profile xxx aligned"）；
2. TOKEN_REGEX 放宽（行首 "dsh web:" 锚定 + URL 任意位置 token 参数——host 形态泛匹配）
   + 捕获成功写诊断日志 "web token captured"；
3. MainActivity 401↔等待死循环修复：降级只做一次（tokenDegraded），token 到达即带 token
   重载；诊断面板显示「web 令牌：已捕获 ✓/未捕获」。

### 2.0j HARNESS"Failed to load plugins"真因修复（模拟器实机验证通过）【2026-09-04 深夜，sentinel v125/v126 包】

**现象**：真机/模拟器端口 3080 开放后 WebView 显示「HARNESS / Failed to load plugins / dsht-rp-plugin /
slot "sidebar.footer.action" is not declared (a parent entry's children table must declare it)」。

**验证路径（本轮教训：必须真机复现，PC 推断不可信）**：x86_64 debug 包装 dsht-x64 模拟器
（AVD 在 `%USERPROFILE%\.android\avd\dsht-x64.ini`，SDK 在 `%USERPROFILE%\.android\sdk`，
adb 非 PATH 需全路径），debug 包 `run-as` 可直查沙箱文件 + 截图看 UI——一次复现拿到全部证据。

**三个叠加真因（全部修复）**：
1. **0.1.2 slot 声明严格校验（坑 #15）**：cordis Loader 用 `Promise.allSettled` **并行 apply**
   各 loader entry——插件 client 面 `ctx.effect(() => slots.register(...))` 立即注册进
   `sidebar.footer.action`/`shell.overlay`，而声明方（dsh-client-ui-sidebar/layout）apply
   先后是竞态，慢设备上插件先跑 → slot 未声明 → HARNESS 报错页。**修复**：改官方姿势
   `ctx.slots.inject(目标slot, () => slots.register(...))`（声明出现才注册；ui-workspace
   2713 行同款）——dsht-rp-ui client 两处立即注册全部改 inject。
2. **dsh.client external 依赖边（坑 #15 补强）**：合并 package.json 增加
   `external:[ui-sidebar, ui-layout, ui-conversation, ui-settings-plugins]`——保证官方
   client 模块 bundle 先加载（加载序≠apply 序，所以 #1 的 inject 仍是必须的）。
3. **NodeService.copyPackage 声明耦合 bug（坑 #16）**：package.json 只在产物字节变化时
   才写入——esbuild 确定性输出下产物不变 → 声明变更（external）永不落 profile →
   boot graph 不更新。**修复**：package.json 内容比对独立进行（不同即写 + 诊断留痕）。
4. **MainActivity 轮询死亡（坑 #17）**：`diagPoller.run()` 开头 `if (dshLoaded) return`
   不重排自己——loadUrl 发出后轮询死亡；WebView 主框架一旦错误（陈旧 token 401 等）→
   showBoot 后无人重载 → 等待屏永久冻结在「已捕获 ✓」。**修复**：无条件 postDelayed
   （轮询永生）+ `lastTokenAttempt` 仅在 webToken 变化时重载（node 每次启动重生成
   launchToken，插件 1s 内重写 token 文件 → 陈旧 token 401 后自动收敛，不进死循环）。

**模拟器端到端验证（截图实证）**：解压→node 启动→端口✓→token 已捕获✓→303 种 cookie→
DSH 首启引导页→主界面「Into the Unknown」完整渲染→侧栏展开可见 **「🎭 角色扮演」footer
按钮（插件 slot 注册成功）**+ Workspaces/Settings 原生 UI 完好。

**其他教训**：① build-dsht.ps1 无 BOM + Windows PowerShell 5.1 = UTF-8 中文注释按 GBK
误读 → 解析崩溃（已补 BOM；或用 pwsh 跑）；② 同一文件多处并行 Edit 会互相覆盖（后写赢）——
必须串行编辑 + 编辑后 rg 复核。

### 2.0k dsht-adapter 预设 mode 卡会话恢复（坑 #18，模拟器验证通过）+ 插件设置 UI 完整复刻立项【2026-09-05】

**① 会话 resume 炸弹（已修复+实机验证）**：真机报「preset "dsht-adapter" failed to mount:
tool-presentation invalid config: $.mode expected "native"|"ptc"|"both" but got "code"」——
0.1.1 的 code 预设 mode 名在 0.1.2 更名 **ptc**。修复 `assets/agent-presets/dsht-adapter/
agent.cordis.yml` `mode: code → ptc`；全 yml 逐行对照 0.1.2 官方 ptc 预设核验（config 字段
全部有官方对应，无其他坏点）；同步链 syncAssetTree 为内容比对式，新包启动即覆盖设备旧文件
（模拟器 run-as tail 实证 mode: ptc 落盘）。**教训重演并加重**：同一文件两个 Edit 并行批次
互相覆盖，把救命修改吃掉——已写进教训清单，**此后同一文件编辑一律串行+rg 复核**。

**② 插件设置 UI 完整复刻（用户拍板的硬要求，进行中）**：现状被用户驳回——酒馆助手只有
1 个开关、提示词模板只有 1 个开关，远低于 ST 时期设置面。ST 侧盘点（源码级，来自
`.Luker-现在在用的版本\data\default-user\extensions`）：
- **JS-Slash-Runner（酒馆助手）** = Script（全局/角色/预设三脚本库容器 + script.enabled.global）
  + Render（enabled/depth/depth_ignore_hidden/collapse_code_block 全部|仅前端|禁用/
  use_blob_url/optimize_hljs/allow_streaming）+ Optimize 8 开关（disable_incompatible_option/
  better_message_to_load/better_character_update/better_character_export/
  better_character_deletion/force_recommended_worldbook_global_settings/
  save_preset_when_saving_preset_entries/maximize_preset_context_length）+ macro.enabled
  + listener（enabled/enable_echo/url/duration，PC 联动特性）
- **ST-Prompt-Template（提示词模板）** = 19 项：enabled/generate_enabled/generate_loader
  (GENERATE)/inject_loader(@INJECT)/render_enabled/render_loader(RENDER)/code_blocks/
  permanent_evaluation/filter_chat_message/chat_depth(-1~100 滑条)/autosave_enabled/
  preload_worldinfo/with_context_disabled/debug_enabled/invert_enabled/compile_workers/
  sandbox/code_editor/cache(enabled 0|1|2 + size 0~512 + hasher h32|h64)
- **MVU**：mvu_settings.json 变量面（现 raw 键值表保留）+ 经酒馆助手的脚本启用
- **剧情记忆**：我方原创 6 项已全（对齐原生卡样式即可）

**实施原则（用户规矩）**：全部选项搬进 DSH 原生折叠卡样式（同「网页搜索」卡）；
**每个控件必须真实读写存储**（禁摆设）；我们原生实现已有对应机制的项立即接线生效；
确实无对应机制的项不悄悄砍——UI 呈现 + 明确标注「当前版本不适用/后续接线」。

**② 实施+验证 ✅（2026-09-05 凌晨，sentinel v133 包全路径实测）**：
- **风格统一（用户验收项）**：解剖原生 PluginCard（settings-plugins 包）结构与 CSS，
  dsht-rp-ui/style.ts 新增 dsht-npc-* 类（原生 CSS 逐字复制+稳定前缀）；PluginCards.tsx
  全量重写为原生结构（li.card>header(name/description/chevron)>body+footer(放弃/保存)+
  未保存 pill+原生开关/下拉/滑条）。模拟器截图实证：与 Shell/Web search 卡并排无风格差异。
- **全量设置面**：酒馆助手=脚本总开关+宏+渲染 7 项+优化 8 开关+监听器 4 项（PC 项标注
  不适用）；提示词模板=19 项全量；MVU=变量键值面；剧情记忆=6 项。数据面 GET/PUT 全量
  schema（defaults-merge+校验）。
- **接线生效**：TH 脚本总开关（既有）+宏开关（/macros/expand 关闭=原文透传）；EJS
  enabled/generateEnabled(phase=generate)/renderEnabled/chatDepth(深度过滤+原位回填)/
  sandbox(缺省沙箱引擎)/debugEnabled。暂无管线的项（GENERATE/@INJECT/RENDER 注入、
  优化 8 开关、缓存、编译 Worker 等）存盘+UI 标注。
- **实测**：TH 宏开关 UI 切换→保存→`rp/th-settings.json` 落盘 false ✓；恢复 true ✓；
  EJS debugEnabled 切换→保存→`rp/ejs-settings.json` 19 项全量落盘 ✓；恢复 false ✓。
- **坑 #19（本轮实测踩）**：卡片 pick 写成 `d.settings ?? {}` 但服务端 GET 返回设置对象
  本身 → 表单从空 draft 渲染假值、保存发稀疏对象。修=透传。教训：**新数据面先 curl GET
  看真实形状再写前端 pick**。
- **附带发现（已修复，坑 #21）**：RP 启动器角色列表报 `workspace.list: HTTP 404`——**0.1.2
  wire 契约三重变更**：① method 必须斜杠式 `namespace/method`（点式被 claimsEndpoint 拒，
  两段式校验 `segments.length!==2` → 404 not found）；② payload 必须包 `{args:{...}}`；
  ③ **workspace.list 端点整个删除**（改 `workspace/follow` 流式订阅，无一次性 list）。
  排障路径：CDP Network 域抓原生前端请求（斜杠 method + args 包裹，全 200）→ 对照
  workspace-controller 的 typert.remote-client.js 端点目录（确认 list 没了）→ PC 3090
  复现（裸探针 401/404 干扰排查，换正确信封才定位）。
  **修复（全路径实测 ✅）**：rpc.ts dshRpc 点→斜杠+args 包裹（响应信封不变）；客户端
  session.create→{request:{cwd}}、session.prompt→{request:{requestId,sessionId,mode,
  content,clientTimeZone}}（0.1.2 新增必填 requestId）、session.list→{_request:{}}、
  workspace.create/rename→{request:{...}}；插件侧 hostRpc 同步转换；workspace.list 的
  两处消费（RpOverlay 角色列表 + register-workspaces 回退）改走新增
  `/dsht-rp/workspace-views`（getWorkspaceRegistry 进程内直取，免网关免 cookie）。
  实测：session/list 200 带真实数据 ✓、workspace/create 200 ✓、workspace-views 列出 ✓。
  **教训：升级后必须把客户端全部 /api 调用对着 typert.remote-client.js 端点目录逐一
  核对**（端点会删会改名，参数会加必填），不能只测编译。

### 2.0h DSH 升级（0.1.3 侦察 → **2026-09-10 解冻，目标改为 0.1.5-rc.1**）

> **2026-09-10 状态更新（心跳 39，用户拍板）**：
> 用户裁决「**更新是必须的**，但必须先考虑明白要适配什么再下手，谨慎全面地做」。
> - **目标版本**：`0.1.5-rc.1`（npm `latest`，实测确认；原 0.1.3 已跳过）
> - **作战地图**：`docs/DSH-0.1.5-UPGRADE-PLAN.md`（含动机 5 条 / 破坏性变更全清单 /
>   五阶段执行计划 / 风险登记 / 4 个待用户决策点）
> - **阶段 1 静态预检已完成** ✅ —— 11 个补丁点逐个复核：8 个形态稳定、2 个需扩展、
>   1 个新增 stub 候选。**零设备改动**。
> - **核心动机**：0.1.5 把 system prompt 提升为 surface `system/message` 事件（第 4 种 surface 类型），
>   并新增 `in-history` 动态替换能力 —— **可能解开 D-4**（原本判定"核心约束不可达"）。
> - **待用户决策**：A 升级时机（建议立即）· B 是否接受迁移耗时 · C `in-history` 是否启用 · D 是否并做 D-6
>
> 以下为原 0.1.3 侦察内容，**其中的迁移条款在 0.1.5 下依然适用**，保留作为参考。

### 2.0h 原稿：DSH 0.1.3-alpha.1 侦察（2026-09-04，已于 09-10 解冻）

**升级评估文档 = `docs/DSH-0.1.3-UPGRADE-NOTES.md`**（侦察报告：三大变化源码级分析 +
契约面验证 + 适配清单 + 建议时机）。核心结论：
- **npm 未发布** 0.1.3-alpha.1（GitHub release 先行）——build-dsht.ps1 走不了；源码克隆在
  `tmp\dsh-013-src`（tag dsh-v0.1.3-alpha.1）
- Session format v2 = chunk 嵌入 message + **seq 密集重映射** + 封闭事件清单（未知 type
  连 ignorable 也炸）；我方事件 type 全标准五个大概率能过，convert-chat 直写 v1 形态
  jsonl 会过不了 v2 校验（最大适配项）
- SessionHandle 单 write 持有者 + 锁：live 回退不受影响；node 重启锁清理需实测
- **官方自认性能回退**（历史会话加载变慢，下版本修复）——正打在我们长会话主痛点
- 建议：等 **0.1.3-rc 修掉性能回退**后升级（升级前全量备份 .dsh-home）；升级最强动机 =
  DeepSeek 流式工具调用续传修复

### 2.0g 二轮反馈（PC 副本同步铁律 / 闪退归因 / 会话自动上滑 / 手机端自改 / 时间线澄清）【2026-09-04】

**① PC 副本同步铁律（用户要求持久化）**：已写入项目记忆 + `docs/SYNC-PC-COPY-RULE.md`。
PC 副本（`.a Agent RolePlay Project`）实查：无 rp-workspace 源码副本，回退插件 =
`.dsh-home\profiles\web\node_modules\dsht-plugin-undo\`（旧版部署产物 2026-08-28）；
`DeepSeek Harness-active` 为 DSH 官方源码副本（**0.1.1-rc.1**）；`dsh-plugins` 是 BitFun
侧插件与 RP 无关。**本轮同步结论**：convert-chat/write-files/skill 改动在 PC 无对应
副本（PC 未部署 dsh-plugin/rp-plugin）→ 无需复制文件；PC 侧 undo 旧产物升级 =
独立任务（先确认 PC DSH 0.1.1 契约兼容性）。

**② 闪退归因（用户手机 agent 自检截图）**：自检结论（ANR/内存峰值被杀，非保活优先级）
与我方代码结构证据一致——`/rp/convert-chat` 全量 jsonl 一次 POST（12.9MB 字符串双份驻留：
原文+转换结果）、`/write-files` 全量 files 数组驻留、13MB PNG base64(~17MB)、settings.json
728KB 解析。「deep diving→渲染十几秒」= pre-step 固定注入（RP 预设 86k+MVU 61k+卡 36k）
+ 官方 API 首 token 延迟，非 bug（§2.2 已瘦 6-7 倍）。
**改进四条已落地（2026-09-04 二轮，v113 包）**：
- 数据面瘦身：`/rp/convert-chat` 新增**文件直读直写模式** `{filePath, sessionId, cwd}`——
  先 write-files 把 jsonl 放 `rp-import/_chats/`，服务端直读→转换→直接落盘目标 session
  （已存在备份 .bak2），响应只回统计（`written:true/path/turns/...`）——12.9MB 不再进
  HTTP body；jsonlText 旧模式保留（<1MB 小会话兼容）；
- 迁移段节流：`/write-files` 每 4 个文件 `setImmediate` 让出事件循环一拍（百级文件
  批量落盘不再拉满事件循环 → ANR 判定窗口收窄）；
- 同步 fs 排查：dsh-plugin 全部 3 处 readFileSync 均在一次性/缓存路径（assets 安装、
  全局正则首读有缓存），无请求热路径风险——不改；
- NodeService watchdog 可见性：`.dsht-alive` 标记文件（启动写/onDestroy 删）——
  残留 = 上次进程级被杀（LMK/ANR 无回调）→ `lastAbnormalExit=true` + 诊断日志
  "RECOVERED: 上次异常退出…checkpoint 续跑"（node 层 3s 自动重启本就存在，本项补
  事后归因可见性）；
- **skill 指导同步更新**：SKILL.md ×3 处 + session-jsonl-contract.md——聊天迁移一律
  文件模式（真机/大文件必用），<1MB 才允许 jsonlText。
**升级 DSH ✅ 已完成（2026-09-04 晚，rc.8 → 0.1.2-rc.1，sentinel v114 包）**：
- 破坏性变更实测三处，全部适配：
  1. **credentials owner-only 检查**（dsh-credentials-local assertOwnerOnly，0.1.2 新增）：
     win32 有豁免但 android-sim 伪装 linux → Windows stat mode 恒 666 → PC 验证必炸。
     补丁 3d-3（DSHT_ANDROID_SIM 跳过，同 fsync 模式）；真机不受影响（官方写
     .credentials.yaml 显式 mode 0600）；
  2. **web UI token 鉴权**（dsh-client-connection，0.1.2 新增）：index.html 首次请求必须带
     `?token=`（进程 launch token）否则 401——APK WebView 固定 URL 会被挡（阻断级）。
     适配：NodeService 从 stdout 解析 `dsh web: ...?token=` → companion webToken →
     MainActivity 首次 loadUrl 带 token（最多等 30 轮后降级干净 URL 兼容旧版）；
     cookie 30 天 + secret 持久（.credentials.yaml）→ 种下后跨重启有效；/api RPC 与
     静态资源不走 fence（仅 index 认证）；
  3. **pnpm 10.34 安装语义**：`pnpm install <pkg>` 位置参数被移除（静默空转）+ project-root
     向上解析（空目录提升到 rp-workspace 根污染工程）——Step 1 重写为预写 package.json +
     `pnpm install`；Step 4 探测改 TCP（token 鉴权下 HTTP 根请求非 2xx 误判）。
- **契约兼容性验证（静态全绿）**：conversation.chat.node / assistant-actions /
  header.actions / shell.overlay / settings.plugin.item 五 slot + data-chat-flow-kind/key
  + data-shell-overlay 全保留；webServer（dsh-host-webserver）/surfaceOp replace/
  cordis.patch.yml 全兼容；官方包零删除零改名（新增 webhook/ACP/SDK 无影响）；
  623 项测试全绿。
- 剩余验证路径：真机装 v114 → 诊断面板看「解压→启动→端口✓ + token 获取」→ 页面加载。

**升级 DSH（rc.8 → 官方最新 0.1.2-rc.1，npm dist-tags 实证；用户指正正确）**：可缓解
不可根治（闪退主因在我方数据面），独立任务排期（平台补丁重打 + 插件契约回归）。

**③ 会话缓慢自动上滑（根因定位 + 修复）**：窗口化翻转（占位↔渲染）高度变化时，
浏览器原生 scroll-anchoring 与我方锚点补偿**双重修正叠加**，且我方补偿写 scrollTop
不进 DSH 的 observed-top ledger → DSH 误判读者滚动保存错锚 → 缓慢漂移；强滑到底后
官方吸底逻辑（FOLLOW_THRESHOLD=24）掩盖漂移 = "消失"假象。修复：滚动容器
`overflow-anchor: none`（翻转高度差由窗口化补偿独占）+ 锚点被占位化时选视口内
次级锚点（旧实现放弃补偿 → 快速滚动漂移）。已进 18:35 最终包。

**④ 手机端自改 RP 配置**：数据/规则层（正则/世界书/预设/记忆/rp.json）已可行
（热加载 + 导出导入基础设施）；代码层建议"补丁清单"机制（会话产 JSON 补丁 → 导出 →
PC 合并源码构建），待用户拍板后实现。

**⑤ 时间线澄清（用户指正 12 小时制）**：截图 17:17-17:46 均早于 17:49 正式包构建；
当时最新可用 = 14:59 debug 包（解包验证：回退按钮为 isRp 旧版只挂 RP 会话、插件
折叠卡不在）。18:35 最终包 = 全部修复的完整验证基线；旧会话历史消息在窗口化下
滚到附近才渲染按钮（离屏为占位）。

### 2.0f 真机反馈五项（重叠复发/按钮缺失/折叠收不回/性能/插件设置重做）【2026-09-04 真机截图反馈；2026-09-04 完成 ✅】

**① 顶栏重叠复发（真机截图：会话名与 Session log 叠印）**：真机截图是**多级面包屑**
（工作区 crumb + 会话 crumb）+ 长会话名场景——上轮 mask 收缩方案在多级 crumb 下把会话名
遮没且 actions 仍叠。重做：titleRow `flex-wrap: wrap`（面包屑一行 / actions+utilities 一
行）+ titleCluster `flex:1 1 100%` + 去 mask（crumb 自带 max-width 220 + ellipsis）。
408dp 复测零重叠。

**② 回退/编辑按钮缺失**：根因 = 按钮原先仅 RP 工作区会话显示（`isRp` 判断），用户看的
是适配 agent 会话（非 RP）→ 去掉 isRp 限制，**所有会话**的 user 气泡都有「↩ 回退到此处
+ ✎ 编辑」（session-rollback/edit 路由本就通用）。

**③ harness 过程折叠行"展开后收不回"（两轮修复，真因在此轮）**：
- 上轮误诊为 `<details>` 原生切换失效（details 点击代理仍保留，修一切原生 details 折叠）；
- **真因（本轮定位）**：我们自建的过程折叠行（ProcessFolder.ts）是 button 实现，点击
  处理器展开即 `header.remove()` **永久删除标题行**——根本没有"再折叠"路径；
- 本轮重做：header 常驻双态切换（▸ 展开 ↔ ▾ 收起），点击在折叠/展开间翻转；
  行查找全部改实时 querySelector（React 重渲染会替换行元素，闭包引用会过期）；
  展开态 header 失联（React 挤掉外来节点）自动退回折叠态重建，不再出现"展开后
  既收不回也没有标题行"的死态。

**④ 性能（本轮新抓到一个真元凶 + 时序说明）**：
- **anchors.ts MutationObserver 零节流**（本轮修复）：mobile 插件锚点解析的 observer
  回调原本每个 mutation 批次**同步**跑 resolveAnchors——全文档 17 个候选选择器扫描；
  流式会话每个 token 都有 DOM mutation ≈ 每帧全文档扫 17 遍，麒麟级 SoC 持续满载
  发热的直接来源之一。改为节流 + 收敛降频（新锚点 → 200ms；连续扫不到 → 翻倍至
  1s 上限；空闲后懒挂载面板的 mutation 到达时立即扫，无可感延迟）；
- ProcessFolder observer 保持 300ms 节流（本来就有）；服务端唯一 interval 是 memory
  20s tick（可忽略）；
- **时序澄清**：用户 05:07-05:16 的截图全部来自**旧包**（17:49 release 包构建于截图
  之后）——顶栏重叠修复、回退/编辑按钮、插件折叠配置卡当时已在包内但用户未安装；
  本轮 v110 包覆盖安装后（sentinel 自动重解压）才是完整验证基线；
- 剩余性能上界 = termux node 转译层 + WebView 全功能桌面 UI 的架构现实 + 适配 agent
  会话本身的重负载（70 步 LLM 19 分钟）。详见 2.0c。

**⑤ 插件设置卡重做**：原信息卡（"运行中，无需配置"）不可配置 → 重做为**可展开配置卡**
（对齐原生"终端/Agent 循环/网页搜索"折叠卡形态；React 受控展开——details 失效环境）：
- memory：六项完整表单（总开关/每N楼/保留M楼/近窗预算/折叠/摘要上限，/dsht-memory/settings）
- MVU：mvu-settings.json 顶层键值编辑器（/dsht-mvu/settings，类型自动识别）
- TH：新增 /dsht-tavern-helper/settings（scriptEnabled 开关，前端 RpScriptHost 消费）
- EJS：新增 /dsht-prompt-template/settings（renderEnabled 开关，/render 关闭时原样透传）
identity 文案保留；四卡均可展开配置。

### 2.1 剧情记忆插件【✅ 已完成（2026-09-02 实机全链路验证）】

**落地形态**（用户拍板：独立插件，与酒馆助手/MVU/提示词模板并列）：`dsht-plugin-memory`
（源码 `packages/src/dsht-plugin-memory/index.ts`，单测 35 项，全量 621/621 绿）。
**默认值对齐用户 vectors-enhanced 原始配置**（2026-09-04 zip 实证：autoSummarize.interval=11、
hideFloorsAfterSummary=true → 每N楼总结默认 11、折叠老楼层=true）。

**工作方式**：
- dsh-plugin 每轮 pre-step 把可见消息数写进 `rp/state/<sid>.json` 的 cursor——本插件每 20s 轮询对比进度
  `rp/memory-progress/<sid>.json` 的 lastFloor，每跨 N 楼（默认 11，可配）触发一次总结；
- 总结：从 session.jsonl 提取该区间楼层原文（兼容新旧两种事件形状）→ `ctx.llm.stream`
  （agentDefaultModel 当前模型）→ markdown 摘要（时间地点/人物状态/关系/事件伏笔/关键词）；
- 记忆本：`skills/wb-memory-<工作区>/references/lore.json`（标准世界书文件，constant 常驻条目，
  comment = `记忆#<起>-<止>` 幂等锚；不进 rp.json.books——注入走自己的快照，与世界书预算解耦）；
- **注入**：插件自己的 `agent/pre-step` 钩子，把全部记忆条目拼成独立快照消息（`dsht-plugin-memory`
  来源，去重后注入）——不与世界书触发预算竞争（实测走触发预算会被 budgetCap 挤掉）；
- 回退安全：cursor 落回 lastFloor 之前 → 自动裁掉覆盖已消失楼层的记忆条目 + 进度回退；
- 设置：settings 命名空间真实 Schema（中文键：总开关 / 每N楼总结 / 保留近M楼原文）——
  设置→插件「可配置」tab 可调；另有 /dsht-memory 路由（health/settings/status/summarize/reset）。

**实机验证记录**（模拟器）：
- 迁移真实会话 st-asm3yf（114 楼）自动总结：记忆本逐块生成（#1-5 → #60 各条 700-1200 字，
  内容含精确时间地点/人物着装/状态细节），游标持续推进；瞬态空返回自动重试 ✓；
- 真实对话 turn：日志确认 `pre-step 注入剧情记忆 12 条（10912ch，覆盖到第 60 楼）`，
  聊天界面出现「上下文注入 · dsht-plugin-memory」独立条目，会话日志持久化记忆快照 ✓；
- 配置回路：中文键写入→读回（每N楼总结 5→20）✓。

**遗留微调（✅ 已完成 2026-09-03）**：摘要字数上限改为**用户可自定义设置**（"摘要字数上限"，默认
600、下限 100，软指令进 prompt 不硬截断——DSH 原生压缩同样无字数强制，口径一致）；
注入裁剪已由 §2.2 消化（keepNearFloors 窗口）。

### 2.2 上下文瘦身（历史折叠）【⚠️ 曾静默失效 → 2026-09-10 修复并实机复验 ✅】

> **2026-09-10 重大勘误（心跳 32）**：本节原标"✅ 已完成（2026-09-03 实机全链路验证）"，
> 但 **DSH 升级到 0.1.2-rc.1 后该机制已静默失效** —— 9/3 的验证是在旧版 SAM 下做的，之后未复验。
>
> **根因**：0.1.2-rc.1 移除了 `Session.events` getter（设备产物 `get events` = 0 次），
> 插件三处直读 `(session as {events}).events` → `undefined` → `nodes` 恒空 → `estTokens=0`
> < 80k 阈值 → 提前 `return ''`，**零 `replace` / 零 `compaction/prune`**，
> 于是快照每轮重复固化进历史（这就是 `docs/DSHT-VS-TT-DIFF-2026-09-10.md` D-1/D-2 的头号差异真凶）。
>
> **修复**：新增 `sessionEventAt(seq)` / `sessionEventsSnapshot()` 适配器
> （`dsht-plugin-memory/index.ts` L288/L302，与 `dsh-plugin` L246/L254 同语义），替换 4 处直读点。
>
> **修复后实机实测（同一 wuwa 会话）**：messages **71 → 12**（5.92×↓）、
> 总字符 **463,320 → 127,794**（3.63×↓）；角色卡 ×6→×1、世界书 ×6→×2、剧情记忆 ×6→×1、状态树 ×5→×1。
>
> **教训**：DSH 版本升级后，**"影子化是否真的发出 replace"必须作为回归项实测**
> （判据：会话 jsonl 里出现 `compaction/prune` 与 `replace` 事件）。
> 本节原有的单测 24 项全绿 —— 单测断言的正是"不抛错"，测不出这一族静默失败。
> 另新增两条铁律（详见 `.workbuddy/memory/MEMORY.md`）：
> ① 插件打包一律 `--format=esm`（CJS 会让整个 plugin tree 崩，Node 崩溃重启 39 次）；
> ② 插件有两份等价副本（`dsh-runtime` 与 `.dsh/profiles/web`），热推必须同时更新。

**这是什么问题（大白话）**：
AI 回复前要"读"的内容有上限（就像人一次只能捧着一摞纸说话）。实测现在每轮对话要塞 **77 万 token**（token ≈ AI 的字块，一个汉字约 1~2 个 token）——把整个聊天历史+全部设定一股脑塞进去。结果：留给 AI"写回复"的空间被挤没了，实测它写出 1 个字就被掐断。界面上显示的估算字数（28.7 万）也严重低估，要改成读服务器真实数字。

**和 2.1 的关系（为什么先做记忆再做瘦身）**：
瘦身的做法是"近处的楼层给原文，久远的楼层只给摘要"。**前提是摘要得先存在**——所以先做记忆插件，瘦身才有东西可给。顺序：2.1 → 2.2。

**最终落地形态**（`dsht-plugin-memory` 内置，纯函数 `planShadowOps` 24 项单测，全量 608/608 绿）：
- **瘦身对象是 surface，不是批次**（关键认知，turn 43/44 事故换来的）：pre-step 的
  `decision.messages` 只有新消息+注入（核心契约：历史在 assembly 里从 surface 重组）——
  批次级折叠够不到请求的大头；
- **机制**：官方 replace 原语（`session.append('user/message', marker, { surfaceOp:
  { op:'replace', start, end } })`，types.d.ts 明文"any surface-replacing producer may
  use it"，compaction 同款）把两类内容折叠出**模型视图**：① 记忆本已覆盖的老历史前缀
  （一次性大 op）；② 陈旧快照副本（每轮持久化的 preset/MVU/卡设定副本，连续段合并）；
  **日志保留全部数据**（聊天记录零丢失，界面回看不受影响）；
- **shadow-price 协议**：replace 前必须紧邻 append 一条 `compaction/prune` 计量事件
  （shadowedRange + shadowedSeqs + shadowedTokenCount，tokenMeter 估价器 4 字符/token
  精确复刻）——不带 claim 的 replace 对投影/meter 是零增量（turn 47 实测请求纹丝不动 514k）；
- **楼层号绝对锚定**：末楼层 = cursor（不能数视图内序数——影子化后视图楼层数 < cursor，
  turn 43 曾把新用户消息当"第 1 楼"折掉、请求被清空、turn 静默 completed）；
- **零信息丢失**：前缀绝不越过记忆覆盖线（boundaryJ = 最后一个 abs ≤ memoryMaxFloor 的
  楼层），记忆滞后时前缀部分覆盖；保留窗口 = min(近 M 楼, 近窗字符预算 60k)；
- **注入快照带 id**（`dsht-memory-plot-<uuid>`）：无 id 消息持久化后重启 resume 校验整会话
  拒载（"lacks an identified message"，turn 42→43 实证事故，已修复 3 个受影响会话的日志）；
- **dsh-plugin 5 处 retained 跳过改为每轮必注**（state/persona/memory/preset/WI）：
  retained 跳过依赖"上轮副本仍在批次"，compaction 影子化后副本会静默消失；
- **contextWindow 配置修正【2026-09-04 再修正】**：st-custom/deepseek-v4-flash 的
  contextWindow 500000 → **1000000**（与 llm-deepseek 官方条目对齐——V4-Flash 官方规格
  1M，用户指认；500k 为 turn-45 时代保守值，当时 770k 被钳的根因是 ② 未修时的畸形
  组装而非上游上限）。溢出保护现按 1M 判——st-asm3yf 会话 499k 的请求不再贴线。

**实机验证**（模拟器，st-asm3yf 114 楼会话）：
- 影子化执行：`视图 160.2万→19.3万字符，折叠至第 89 楼`（est 5169k→2060k tokens）；
- turn 50/51/52/54/55 连续 `stop` 正常完成：请求从 770k/873k 降到 **~44 万 tokens**（缓存命中
  后 UI 观感成本更低），示例预设口吻、think_fox~ 格式、状态栏 HTML 全部正常；
- §2.3 ② 落地后 system 从 95,426 字符 → **344 字符**（紧凑指针，实测 request/header）；
- 重启后日志回放保持折叠效果（surface 视图持久生效）✓。

**已知剩余（2026-09-03 复核更新）**：
- ~~快照清场滞后一轮~~ → **实测已不存在**（2026-09-03）：core 的 `deriveMessages()` 在
  buildRequest 时现算（晚于 pre-step 钩子），影子化 replace 对历史当轮生效；实测请求
  tokens 与影子化视图一致（505k tokens / 73.1万字符 ≈ CJK 实际密度，无翻倍痕迹）——
  turn-47 shadow-price 协议已根治。core 的 systemPrompt.assemble 确实在 pre-step 之前
  跑（不改内核无法更早），但 system 部分本就不含楼层快照，无清场需求；
- 固定注入（RP 预设 + MVU + 卡设定）为**单副本正本**，是用户自装内容本身——机械瘦身已到头，
  进一步压缩 = 内容取舍（需用户拍板，如精简 MVU 卡）；
- 模型会看到少量"[旧快照副本已折叠]"标记（已做合并收敛，数量有界）；
- ~~token 计量改真实 usage 口径~~ → **✅ 已完成（2026-09-03）**：输入框计量条优先显示
  provider 真实 usage（快照最后一条 assistant 的 inputTokens+cacheRead+cacheWrite，
  实测 499k 与会话日志逐位一致，标签"真实值"），首轮回复前回落字符估算（"估算值"）。


### 2.2b D-3 system 槽位路由（TT 对照）

> **2026-09-10 心跳 34 新增并实机验证 ✅**。对应 `docs/DSHT-VS-TT-DIFF-2026-09-10.md` 的 D-3。

**问题（大白话）**：TT 把角色卡/世界书/记忆/状态树全塞进 `system` 槽位（25 条里 22 条是 system），
而 DSHT 把它们全塞进 `user` 槽位（40 条 user、只有 1 条 system）。同一份内容挂在 `user` 名下，
模型对它的服从度就和系统指令不一样——这是**语义层级错位**，直接影响 AI 演得像不像。

**为什么以前没修**：DSH 核心把两扇门都焊死了 ——
① `agent.ts:505` 把 loop 请求 `deepFreeze`（mutation throws），官方明文
"listeners read it, never rewrite it" → **`llm/stream` 改写请求的路走不通**；
② `session/index.ts:315` 把 `user/message` 的 role 钉死为 `user` → 注入层造不出 system 消息。

**合法通道（四条证据链定位）**：`system-prompt/assemble` 瀑布返回的 `assembly.sections` ——
`agent.ts:230` assemble → `:337` `renderPrompt(assembly)` 拼成 `system` 字符串 → `:339` 进请求；
且 `dispatch.ts:173` `assembleContextFor` 把 **live Agent 放进 `context.agent`**，
所以监听器能现场读会话态、返回动态 sections。

**实现**：
- `dsht-plugin-shared/tt-projection.ts`：`SlotSection` / `SLOT_ORDERS`（角色卡 20 → 世界书 25 →
  记忆 30 → 剧情记忆 35 → 状态树 40 → 表格 45 → 预设 50，对齐 TT dump-008 的语义拼接序）/
  `planSlotSections`（排序 + 残余宏中性化 + 丢空段）；新增 8 项单测。
- `dsh-plugin/index.ts`：`gatherSlotSections(agent)` 在 assemble 内**现算**角色卡/状态树/记忆/表格；
  世界书（需 pre-step 的关键词扫描管线）由 pre-step `publishSlots` 发布，assemble 按 `name` 合并。
- **回滚开关**：`$DSH_HOME/rp/slot-routing-OFF` 存在即回退旧行为（pre-step 的 `with*Snapshot`
  路径一字未动），不改代码即可 A/B。

**实机实测（同 wuwa 会话）**：`system` **24,773 → 86,877 字符**；
首轮 `[self=2 published=0]`（角色卡+状态树，**首轮即生效**），
次轮 `3 段 / 62,098ch (character, worldbook, state) [self=2 published=1]`；
`pre-step decision.messages` 从「用户输入 + 4 组快照」降为 **1 条纯用户输入（13 字）**。
全量单测 **700/700 绿**。

**两条新铁律（实机探针抓到的自身缺陷）**：
1. **时序**：turn 内恒为 `assemble(:230) → pre-step(:233) → 渲染(:337)`，且无工具调用时
   **一 turn 仅一步** → pre-step 的发布对本 turn 不可见（只对下一 turn 可见）。
   首版只靠发布 → 首 turn system 恒空（探针 `slotPublished=none` 抓到）。内容必须 assemble 内现算。
2. **合并**：多来源发布必须按 `name` 合并而非覆盖。首版覆盖式 → 世界书 24,221ch 被
   withPresetLayer 的发布吃掉（`slot=2` 实机抓到）。

**D-4（用户输入绝对位置）判定为不可达**：用户输入顺序由 `session.deriveMessages()`（耐久日志）决定，
而 `assembly.sections` 只能拼进单一 `system` 字符串、无法插进 messages 中间。
TT 的「用户输入夹在 system 块中 + system 收尾」结构在当前 DSH 核心约束下无法复现，
除非核心开放 messages 投影点。**已停止对其继续投入**（避免无底洞）。


### 2.2c 悬浮窗互不遮挡（用户直接投诉项，2026-09-10 心跳 35 修复 ✅）

**用户原话**：「你做的脚本悬浮窗自动避让的弹出窗口到处乱窜…TT 也没有这个东西也不碍着人家
能保证悬浮窗互不遮挡」。

**CDP 实机取证（真凶是几何重叠，不是"乱窜"的观感）**：

| z | 位置 | 元素 | 归属 |
|---|---|---|---|
| 10050 | `[351,109,36,36]` | `.dsht-rp-scriptball` 🧩 | 我方 |
| **9999** | `[313,100,52,52]` | **`#fx-floating-ball`** | **卡脚本注入** |
| 60 | 用户可拖（默认 92vw） | `.dsht-rp-statefloat-ball` 🌌 | 我方 |

🧩 球与 `fx-floating-ball` **矩形重叠 18×36 px**。根因：`script-ui-guard.ts` 的
`PROTECTED_ANCHORS` 只含**宿主 chrome**（`[role="tablist"]` / `[data-composer-input]`），
**从不检测「脚本浮窗 ↔ 我方浮球」之间的碰撞** —— 于是两球长期叠在一起。

**修复（`dsht-rp-ui/src/client/script-ui-guard.ts` + `RpStateFloat.tsx`）**：
- 新增 `OWN_FLOAT_SELECTOR` = `.dsht-rp-statefloat-ball,.dsht-rp-scriptball`；
- 新增 `resolveOwnFloatCollisions()`：**我方浮球主动让位**（脚本浮窗归第三方所有，
  改它会被脚本复位抖动），规则 = **保边滑动** —— 保持球当前所在左/右半边，
  优先沿垂直方向滑出重叠区，垂直无处可去才水平错开；
- `requestFloatCollisionResolve()` 供拖拽落定后立即触发（不等 3s 轮询）；
- resize / orientationchange 也触发；诊断探针 `floatCollisionSnapshot()`。

**两个自身缺陷（实机抓到并修复）**：
1. **未定位坐标冻结**：React 首帧 `style.left` 还是初始值（`left:92vw` 尚未应用），
   `getBoundingClientRect()` 返回 `(-16,-16)`；旧逻辑把它当合法位置参与避让，
   结果把这个坏坐标**冻成内联 px** → 🌌 球被钉死在左上角 `(6,6)`（实机 `data-dsht-nudged="1"
   style="left: 6px; top: 6px"` 铁证）。修：`visibleOwnFloats` 增加「必须完整落在视口内」判据。
2. **推出方向会落到死角**：原「最小位移推出」会把球推进屏幕角落。
   改为「保边滑动 + 候选落点碰撞预检 + 视口边界约束」。
   另加 `healFrozenOwnFloats()` 自愈旧版冻结坐标（识别 `left<=12 && top<=12` 的坏形态）。

**回滚**：`requestFloatCollisionResolve` 是纯增量调用；移除 `OWN_FLOAT_SELECTOR` 相关
代码即回到原行为。全量单测 **700/700 绿**；实机 `window.__dshtGuard.scans` 持续递增（守卫在跑）。

**v200 最终交付与实机复验（2026-09-10 心跳 35 收尾）**：

| 项 | 值 |
|---|---|
| `client.js` md5 | `e7dc784abe7b98e28191428e6931cad6`（源 / `dsh-runtime-android` / `pc-verify-home` 三方一致 + zip 内一致） |
| `index.js` md5 | `84593004cad79dbe37da2fcaa1e2487d`（D-3 版本） |
| sentinel | `.installed-v200`（实机 `run-as ... ls files/dsh-runtime/` 已确认） |
| x86_64 debug APK | `D:/DSH RolePlay/DSH-Tavern-0.2.0-x86_64-debug.apk`（196,970,708 B，md5 `e05f43f422b2cdcabcf4f080b13517bd`） |
| arm64 release APK | `D:/DSH RolePlay/DSH-Tavern-0.2.0-arm64-release.apk`（127,506,599 B，md5 `4b7b9ff7cbb96d6d53ab793cf0e21a47`） |

**装到模拟器后的 CDP 探针（决定性证据）**：

```
{ installed: true, scans: 152,
  snap: { own: 2, others: 1, overlapping: 0, resolvers: 2 },
  balls: [ 🧩 dsht-rp-scriptball  nudged:"1"  rect:[347,160,36,36],
           🌌 dsht-rp-statefloat-ball nudged:"" rect:[ 2,284,44,44] ],
  others: [ #fx-floating-ball rect:[313,100,52,52] ],   // 真浮窗只剩 1 个
  floatingTabs: 5 }
稳定性 3 次采样：🧩:347,160 🌌:2,284 —— 位置去重数 = 1（零漂移），overlapping 恒 0，resolvers 恒 2
```

关键判据三项全绿：**① 🌌 `nudged:""`** —— 自愈生效，不再被钉在 `(6,6)`；
**② `others: 1`** —— 全屏宿主层 `pI_x6G_overlayLayer` / `sidebarCol` 已被 `isCompactFloat()` 正确排除；
**③ 三次采样位置完全一致** —— 「到处乱窜」已消除。

截图复核：**左侧坚条（✕⬅😊☰ 压正文）消失、正文完整、🌌 在左中 / 🧩 在右上各就各位**。


### 2.2d `promptOnly` 正则污染耐久日志（用户直接投诉项②，2026-09-10 心跳 36 修复 ✅）

**用户原话**：「它显示的我发送的内容也不是"（金标对照测试）…"而是"`<interactive_input>\n$1\n</interactive_input>`"」

**全链取证（四层排除，每层有据）**：

| 排查层 | 结果 |
|---|---|
| TT 源码 / TT data | 零命中 |
| TT 聊天记录（153 用户楼层） | **0 个含包装** |
| 卡本体 PNG（`chara` base64 解码） | 零命中 |
| 卡 `rp.json`（10 个字段） | 零命中 |
| 卡变量（chat snapshot） | `zhuanshu` / `meizhu1` 2 处（只描述标签语义） |
| **预设 `Kemini Dramatron` `extensions.regex_scripts[3]`** | ✅ **真凶** |

**真凶 = 预设自带正则**（TT/ST 侧就靠它包装 —— **包装行为本身正确**）：

```json
{ "scriptName": "aether opus正则一", "findRegex": "^([\\s\\S]*)$",
  "replaceString": "<interactive_input>\n$1\n</interactive_input>",
  "placement": [1], "maxDepth": 1, "promptOnly": true, "markdownOnly": false }
```

TT 聊天记录看不到包装，是因为 `promptOnly: true` **只在生成期改 prompt、从不回写 chat**。

**DSHT 侧三个缺陷（全部已修）**：

| # | 缺陷 | 后果 |
|---|---|---|
| ① | `promptOnly` 结果**被回写耐久日志**（`{...decision, messages: batch}` → 宿主落 `user/message`） | 聊天记录被写成包装文本，UI 气泡直接显示标签 |
| ② | `depth` 恒传 `null` → `minDepth/maxDepth` **全失效** | `maxDepth:1` 本该只改最新一条，实际改了全部历史 |
| ③ | `activeScripts('prompt')` **只收 promptOnly 脚本** | 通用脚本在 prompt 时机被漏（与 ST/TT 不符） |

**TT 正确实现对照**（`TauriTavern-Canary/src/script.js:5282-5312`）：`getRegexedStringBatchAsync(..., { isPrompt: true, depth: coreChat.length-index-1 })` 的结果**只写局部 `coreChat`**，`chat` 数组原样不动。

**修复（四处）**：
1. `applyPromptRegexes` 加 `mode: 'persist' | 'prompt'` —— `'persist'`（pre-step，会落盘）排除 `promptOnly`；`'prompt'`（llm/stream 投影）全收且**不落盘**。
2. 新增 `messageDepth()`，在 `applyPromptRegexes` 内真实计算深度（末尾 = 0）。
3. `activeScripts` 三时机过滤按 TT `engine.js:354-357` 三分支重写。
4. `llm/stream` 是 **generator 型 waterfall**（`next: () => AsyncIterable<StreamChunk>`，`dsh-llm/lib/types/index.d.ts:43`）→ handler **不能 async**；改 pre-step 预热 `preparedPromptProjections`，钩子内同步应用。

**新增测试 3 项 + 修正 1 项**；**全量单测 703/703 绿**。

**存量脏数据**（修复前写入，不影响新消息）：`session-7973a03e` 37 处 / `session-5f4414a8` 35 处 / `session-wuwa-migrated-01` 74 处。


### 2.2e 「发不出来消息」全链闭环（用户直接投诉项③，2026-09-10 心跳 37 修复 ✅）

**用户原话**：「你只是立案了有什么用？**发不出来消息**就是因为这两个还没解决的问题啊！」

→ 逐层剥开是**三个独立缺陷叠加**，本项是 goal 的**前置阻塞**。

#### 缺陷 A：`llm/stream` 的 `Cannot assign to read only property 'messages'`（架构性，非笔误）

| 层 | 取证 |
|---|---|
| 现象 | 实机 logcat 反复 `TypeError: Cannot assign to read only property 'messages' of object '#<Object>'` |
| 根因 | `dsh-llm/lib/types/index.d.ts:33-36`：loop 组装的 request 带 `markAgentLoopRequest` 身份，到瀑布时 **deep-frozen（mutation throws）**，内容是「会话日志的**纯函数**」，**listeners read it, never rewrite it** |
| freeze 点 | `dsh-agent-loop/lib/index.js:747` `markAgentLoopRequest(deepFreeze({...}))` |

**结论：`o.messages = projected` 被宿主故意封死**（浅拷贝后 `next()` 同样无效，冻结在深层对象上）。

**修复**：改走 `system-prompt/assemble`（宿主明文 `dsh-system-prompt/lib/types/index.d.ts:23` **"the mutable assembly"**）：
- `dsh-plugin/index.ts`：删 `o.messages = projected`，改为只读诊断（`projectedPromptHits`）。
- `tt-projection.ts`：新增槽位 `projectedPrompt = 60`（对应 TT `GENERATE_AFTER_COMBINE_PROMPTS`）。
- `gatherSlotSections` 内**自己预热** `preparedPromptProjections`（时序：`assemble(:497) → pre-step(:502)`，pre-step 发布对本 turn 不可见），命中推 `dsht-rp:slot:prompt-projection`。

**实机验证**：只读报错消失 → `promptOnly 正则投影: 2 条命中（aether opus正则一）—— 经 system 槽位生效，未落盘`。

#### 缺陷 B：出站请求根本没离开 app

加出站观测（golden fetch patch 打点）后拿到真凶：`outbound fetch 失败 :: TypeError: fetch failed | cause=UND_ERR_SOCKET other side closed`。

| 陷阱 | 事实 | 判定 |
|---|---|---|
| **环境代理** | 本机 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:1303`（WorkBuddy 沙箱代理），**Node/undici 会读** | 请求被导向代理 → `upstream connect failed (10061)`；直连正常 |
| **`adb reverse` 失效** | `adb reverse tcp:31101 tcp:31101` 显示建立成功，设备侧 `nc` **打不通** | **本环境不可用，弃用** |

**修复**：改用 **`10.0.2.2:31101`**（模拟器内置宿主别名）。

#### 缺陷 C：mock 进程被沙箱回收

`nohup ... &` / `> /tmp/x.log &` 起的进程在 bash tool call 返回时即被回收；`/tmp` 每次调用独立。
**修复**：`run_in_background: true` 常驻，日志用 `TaskOutput` 读。

#### 决定性验证（全链）

| 判据 | 实测值 |
|---|---|
| mock 收到请求 | `POST /v1/chat/completions (179209B) messages=45`、`(204538B) messages=48` |
| 请求完成 | `turn/end {kind:"completed"}` |
| 用量 | `usage {input:100, output:20}` → UI `276 tok/s · Input 304 tok · Output 64 tok` |
| UI 渲染 | 气泡显示**裸文本** |
| 错误计数 | `errCount: 10` 发送前后**不变**（全陈旧），不再增长 |

**全量单测 710/710 绿（36 文件）**（`facade.spec.ts` entry-put 与 `undo.spec.ts` 各一次 flaky，隔离重跑全绿，非回归）。

#### 本轮固化三条铁律

1. **`llm/stream` 是只读瀑布** —— loop-built request 深冻结，任何 messages 改写必 throw；要影响最终 payload 只走 `system-prompt/assemble` 的 `sections`。
2. **mock 必须 `run_in_background` 常驻**；`adb reverse` 在本环境**不可用**，走 `10.0.2.2`。
3. **环境代理会劫持 Node 出站** —— 排障先查 `HTTP_PROXY`。


### 2.3 已拍板的五件事（②收益最大先做，其余互相独立可穿插）

**① 角色卡人设迁回工作区【✅ 已完成并验证（2026-09-03，选 B）】**
- 问题：预设列表里的"陌路人""双子"其实是各角色卡的人设说明书，混在系统预设里。
- 实现状态（代码早已就位 + 数据已清 + 2026-09-03 验证）：
  - 导入管线第四轮起不再产出卡说明书 agent preset（卡设定 → rp.json.promptPersona，
    dsh-export.ts L798）；dsh-plugin 启动时自愈迁移（promptPersona 回填 + 冗余 preset 删除，
    index.ts L1185-1236）；
  - 接线：pre-step 对 RP 会话把 rp.json.promptPersona（过宏引擎）作为 system 快照注入 ✓；
  - 数据验证：全 DSH home 搜"陌路人/双子"零命中（存量已清）✓；预设列表只剩真预设
    （RP 预设 7 个 + agent 用户档案/风格预设）✓。
- 做完的标志（已达成）：预设列表只剩真正的预设；每张卡的角色扮演行为不变（人设经
  工作区快照注入）。

**② 两套规则单向生成【✅ 已完成（2026-09-03 实机验证，system 95,426 → 344 字符）】**
- 问题："AI 怎么说话"（扮演风格，RP 预设 V17.1，86k 字符/轮）和"AI 底层指令"（agent 预设
  V14.7，编译进 system 95k 字符）是两份独立文件且**两份全文每轮都发**——实测 V14.7 还是
  旧版本，规则互相打架且白烧 ~7 万 token/轮。
- 做法（比拍板时更彻底）：agent 预设编译器（preset/compiler.ts）persona 改为**紧凑指针**——
  不含规则正文，只声明"规则全文以每轮注入的「RP 预设」快照为准，冲突以快照为准"。
  正本 = 激活的 RP 预设：dsh-plugin 每轮从 preset.json 现值生成快照注入，正本一改下一轮
  即生效（单向：底层指令只是指针，无内容可分歧——比"开会话时生成"更强）。存量 7 个
  st-* agent 预设目录由 ensureRpPresetSync 按 `DSHT-RP-COMPACT-PERSONA-V1` 标记自动
  补编译升级（幂等，启动时跑）。
- 边界：direct 路径同样紧凑化（快照管线无 path 过滤——实测 V14.7 就是 path=direct、
  207 槽位）；能力轴结构行（preset-capability 组）不受影响，isDshtRpAgentComposition
  判定不变；宏护栏（半角 {{ 禁入）保持。
- 做完的标志（已达成）：system 降到 344 字符；改扮演风格后无需重开会话，下一轮生效；
  单测 610/610 绿。

**③ 聊天楼层号显示【2026-09-02 新增；2026-09-03 完成 ✅】**

ST 原版怎么做的（已翻源码实证，酒馆（暂时停用）/public）：
- 每条消息的 DOM 块上带 `mesid` 属性（楼层号，**0 起始**——开场白是 #0）
- 头像旁一个专用小元素 `.mesIDDisplay` 显示 `#N`（script.js:3772 新建时填、4798 编辑时更新、15068 插入/删除后批量改号）
- 用户可在设置里关掉（CSS 类 `no-mesIDDisplay` 控制，默认显示）

我们怎么挪（比 ST 还简单）：
- 我们的聊天是原生 conversation，**节点装饰机制现成**——变体切换条 ‹1/5› 就是这么挂上去的，楼层号 #N 走同一机制加一个徽章
- 窗口化滚动时天然重新渲染，不需要 ST 那种手动批量改号
- 默认显示，插件设置（dsht-rp-chat 命名空间"楼层号显示"）可关，POST /dsht-rp/rp/chat-prefs 下发

**最终口径（与初案不同，实测裁决）：1 起始，不用 ST 的 0 起始**——楼层号必须与
`visibleMessageCursor` / 记忆锚「记忆#N」/ 影子化 marker「第 N 楼」三方同源：
- 物化开场白是真实 assistant 消息（agent-loop 每 step 恰落一条 assistant/message）→ 占第 1 楼；
  快照路径开场白两侧都不占；user 仅 data.source.kind==='user' 计号（steering/context/插件注入不算）
- 实测：15 楼会话 #1（开场白）→#15，user 占偶数楼、assistant 占奇数楼，与游标逐楼一致
- 做完的标志（已达成）：原生聊天每条消息能看到 #N 且与"记忆#几楼到几楼"逐楼互证；
  vector-enhanced 式的"第几楼"概念有了直观锚点

**④ AI 可见楼层数即调控件【2026-09-03 用户拍板新增；2026-09-03 完成 ✅】**
- 问题：AI 能看到过去多少楼，目前是全局设置（插件设置页的"保留近M楼原文/近窗字符预算"）——想临时让 AI"忘掉/记起"几轮，得退出聊天进设置页改数字
- 落地形态（用户拍板 2026-09-03：token 计量条弹出面板方案，替代"折叠标记旁"初案——折叠标记行是原生 context 渲染行，接管需复刻官方 UI、风险高）：输入框上方 token 计量条可点击 → 「上下文与记忆」面板（RpContextPanel）——AI 可见楼层数步进器（写 dsht-plugin-memory 的"保留近M楼原文"）+ 近窗字符预算步进器 + 折叠区间展示 + ⑤ 展开按钮
- 语义：**调小** = 下一轮窗口内多余楼层折掉（规划器自动）；**调大** = 期望窗口 [cursor-M+1, foldedUpTo] 露出的折叠原文由 pre-step 窗口核对自动注回（稳定签名快照 source.windowRange 常驻；预算截尾 capped 时视为已满足——同段重注入无意义；**扩张后不主动收回，调小才重整**——用户拍板）
- 折叠边界可靠性（实测教训）：history marker 与「旧快照副本已折叠」marker 同签名，签名去重后幸存的可能是不带楼层区间的那个 → foldedUpToOf 兜底链 = fold 文件（shadowSurface 落盘 st-asm3yf.fold.json）→ surface marker 扫描 → session.jsonl 扫描（自愈并回写 fold 文件）
- 实测（st-asm3yf，132→137 楼）：面板 6/6 断言通过（弹出/步进器/服务端读回/展开排队/关闭）；M 调 60 → 下一轮 `窗口注回 第84-89 楼`（预算 60k 字符截尾）✓；服务端 settings 读回 ✓

**⑤ 折叠区间"展开给 AI"【2026-09-03 用户拍板新增；2026-09-03 完成 ✅】**
- 问题：影子化把老楼层折出模型视图后，没有"把某段原文临时还给 AI"的手段（比如"把那段的走向变体重演一遍"）
- 落地形态（用户拍板 2026-09-03：一键展开整段，按近窗字符预算从最近楼层往回截）：面板按钮 → POST /dsht-memory/expand 落待办（rp/memory-expand/<sid>.json）→ 下一轮 pre-step 从活会话事件流提取区间原文 → 宏中性化（残留 {{ 全角化，防插值器炸 turn）+ 预算截尾（保尾）→ one-shot 快照注入（source.oneshot=true）→ 下一轮影子化无条件收回（**单次生效**）
- 与 ② 的关系：无依赖；与 vector-enhanced 的差异——ST 的 unhide 只改标志位即能让楼层回到提示词，我们的折叠没有"反向原语"，所以靠重新注入实现（成本 = 临时变胖，故设计为单次生效）
- **重要澄清（用户关切）**：折叠只改模型视图，**界面回看零丢失**——聊天渲染走 append-origin 事件流（内核明文：模型视图的 replace 对人类回看是错误数据源）
- 实测（st-asm3yf）：expand 排队 → 下一轮 `单次展开 第84-89 楼`（请求 1-89、预算截尾至 84-89）→ 再下一轮自动收回（无再次注入）✓；待办文件消费后删除 ✓
- 做完的标志（已达成）：点"展开给 AI"后，下一轮 AI 的请求里能看到该区间原文；不点则维持瘦身状态

---

## 2.9 2026-09-05 全量整改轮（AUDIT_TASKLIST.md 一轮落地）

> 用户拍板「一轮执行完，不留尾巴」。全量状态表与逐项细节见 `AUDIT_TASKLIST.md`（本轮已回写）。

| 块 | 落地内容 | 产物 |
|---|---|---|
| 鲁棒性 I8 | welcome 补 flush；I8-6 Android flush 通道（onPause/onStop/onTrimMemory→flush-request 文件→插件 1s 轮询全量 flush + 5s 周期兜底 + 信号钩子）；I8-7 coordinator 告警镜像进插件日志环 | MainActivity.kt / dsh-plugin/index.ts |
| 提示词模板 B2-B19 | B2 生成期求值、B3/B4/B6 三类 loader 条目注入、B7 pre 保护、B8 永久写回（/permanent）、B9 模板语句过滤、B12 initvar 预载、B15 worker_threads、B17 轻量编辑器、B18 invert、B19 编译缓存 | dsh-plugin / dsht-plugin-prompt-template（+worker.ts）/ display-compiler |
| MVU D1-D8 | D1 initvar 解析落盘、D3 JSONPatch 兜底、D4 额外模型解析（/rp/mvu/extra-analyze）、D6 window.Mvu、D7 schema 校验 422、D8 toast | state/mvu + dsh-plugin / th-shim / dsht-plugin-mvu |
| 酒馆助手 C2-C18 | C2 类宏全集（scopeGet 四档）、C7 merge/schema、C8 injectPrompts 双端、C9 /generate、C15 Toolbox 基础、C17 音频、C18 杂项；C4/C16 存盘标注 | dsht-plugin-tavern-helper / th-shim / RpScriptHost |
| 记忆表格 E1-E8,E11 | Sheet 模型+历史栈、tableEdit 解析执行、pre-step 注入、分步填表/重整理（llm 通道）、RpTablesView 只读渲染、旧数据自动迁移、表格宏 | dsht-plugin-memory/tables.ts + RpTablesView |
| 渲染层 F/I | I4 显示期宏（identity 数据源）、I2 贴底锚定、I6 手机文件预览抽屉、F2 iframe 主题、F3 悬浮球拖拽、F4 状态栏缓存 | display-compiler / RpStateFloat / mobile client |
| 范式准备 §0.6 | 契约快照/适配点提取/diff/升级清单/版本探测 五脚本 + 首份快照 0.1.0-rc.7 + 19 处 @adapt 标记 + 构建挂钩 | rp-workspace/scripts + contracts/ |
| 验证 | 全部改动文件 esbuild 逐个过；宏/桥/表格单测+冒烟 113 项过；build-dsht.ps1 全量构建闭环 | tmp/build-20260905.log |

**剩余尾巴（真机实测后回写）**：模拟器/真机回归清单（AUDIT_TASKLIST 文末）；C6 全事件名表、C10-C14 长尾函数、E7/E9/E12、I8-5（等 0.1.3-rc）。

---

## 3. 发布到 GitHub 前的准备工作（5 件，做完才能公开）

| # | 事项 | 大白话 | 做完的标志 |
|---|---|---|---|
| 1 | ~~示例角色库~~ | **【用户裁决 2026-09-03：取消】**——APK 出厂本就不该带任何 Roleplay 个性化数据（现在的版本已满足：零角色卡/世界书/预设），用户自己导入适配才是对的 | 已取消，无需再做 |
| 2 | **仓库大扫除（最关键，一票否决）** | **【用户指令 2026-09-03：全部功能干好之前，仓库里的 RP 数据冻结不动】**——做的时候要清：角色卡图片、聊天记录、世界书正文、带服务器地址的日志、测试脚本抓的真实对话 + 重写 .gitignore | 在仓库里搜不到任何真实人名/卡名/服务器地址（冻结至功能全部完工） |
| 3 | **许可证核对【✅ 已完成（2026-09-03）】** | 全量扫描 APK 打包的第三方组件：DSH 官方运行时全家桶 MIT + 传递依赖 MIT/ISC/BSD/Apache/PSF（argparse）+ vendor（jquery/jquery-ui/zod/lodash MIT、yaml ISC、jszip 选 MIT）——**零 copyleft 打包物**；ST 格式兼容为自研实现未复制源码；清单落位 `docs/THIRD_PARTY_LICENSES.md` | 法律上挑不出毛病（已达成，扫描可复跑） |
| 4 | **正式发布工程【2026-09-03 大部分完成 ✅】** | 已完成：**应用更名 "DSH Tavern"**（strings.xml app_name）+ **版本 0.2.0 (versionCode 2)** + **自绘鲸鱼抱酒杯图标**（GDI+ 扁平设计，legacy 5 密度 + 自适应 bg/fg 5 密度 + anydpi-v26）+ **正式签名**（dsht-release.keystore，30 年有效期，gradle signingConfigs；arm64 走 assembleRelease、x64 自测走 assembleDebug）+ **构建脚本一键出包**（build-dsht.ps1 Step 6，产物名 DSH-Tavern-0.2.0-\<arch\>-\<type\>.apk）+ 离线构建（release lintVital 关闭）。实测 arm64 release 签名/标签/ABI 全对、零用户数据；x64 模拟器升级安装启动正常。剩余：应用内检查更新的开关、GitHub Releases 渠道 | ✅ 可给出正式签名安装包（真机可装） |
| 5 | **README** | 项目门面：这是什么/不是什么/法律边界/致谢/**alpha（早期测试版）限制声明** | 新人 5 分钟看懂 |

---

## 4. 不着急的小问题（2026-09-03 复核：3 项已了结）

1. ~~外部脚本报错~~：某张卡自带的脚本往"游戏主页面"注入外部脚本，外部脚本自身适应问题（保留观察，不修）。
2. ~~"找不到预设"报错~~ → **✅ 已修复（2026-09-03）**：根因是预设自带 TH 脚本用 ST 哨兵名
   `getPreset('in_use')`（= 当前加载预设），facade 只按 displayName 匹配查不到。已让
   `preset/get`、`preset/put` 支持 'in_use'（按会话解析 presetId，实测返回真名
   "V17.1 示例预设 · 示例角色" 367 槽位）。
3. ~~待复测~~ → **✅ 已销（2026-09-03）**：模拟器 LLM 已连通（DNS 修复生效），真实对话
   连续跑通 4 轮（游标 132→137、usage 正常回报 505k tokens、turn 正常完成）。

---

## 5. 查账表：旧文档说"没做"的事，实际做没做（供核对，可跳过）

> 这两张表是"对账"用的：旧规划文档很多格子没打勾，但实际早做完了。每行有"拿什么证明"。**你不用逐行看**——真正没做的事已全部汇总在 §2/§3。

**旧 PROJECT_PLAN 的任务**（✔代码=在代码里找到了；✔实机=模拟器实测过；⚠文档=只有文字记载，动工时顺手核）：

| 旧条目 | 旧文档状态 | 实际情况 | 证明 |
|---|---|---|---|
| T0.1-T0.8 最早的底层验证（8 项） | 全部未勾 | 全部完成（v4-v7 就实测过：程序能起、AI 能对话） | ✔实机 |
| T1.14 聊天长列表不卡 | 未勾 | 已完成（聊天窗口化技术，只渲染看得见的部分） | ✔代码 |
| T1.16 导入中心+管理界面 | 未勾 | 已完成（旧版独立导入页已由 T2.11 决策收编为 overlay 内嵌 iframe——同源 /dsht-rp/import-center 即嵌入源，无独立入口，2026-09-03 复核实证） | ✔代码 |
| T1.17 M1 验收 | 未勾 | 被持续自动化测试替代（584 项），没单独走形式 | ✔文档 |
| T2.1-T2.4 整合/语义分类/状态链/验收 | 全部未勾 | 全部完成（v41-v52 + 十一轮数据回炉） | ✔实机 |
| T3.5 酒馆脚本兼容层"评估" | 未勾 | 超额完成——直接做成了完整兼容层（9 月 2 日 MVU 框架跑通） | ✔代码+实机 |
| T3.1 正则管理+预设分享 | 未勾 | 完成（2026-09-03 补齐预设分享：预设面板"导出"按钮 → ST「OpenAI Settings」兼容 JSON，内嵌正则一并还原，可经「导入 ST 预设」回灌，实测 367 槽位 + 33 正则导出成功） | ✔代码+实机 |
| T3.1b 卡包导出 | 已勾 | 完成 | ✔代码 |
| T3.2 剧情记忆 | 未勾 | **没做** = 本文件 §2.1 | ✔代码 |
| T3.3 重 agent 预设适配 | 未勾 | 完成（2026-09-03 核毕：TT 数据在 data-zip.ts L301 显式跳过+用户告知，属既定 M2 延期而非缺陷；TT 预设本体不走 st-import 适配路径） | ✔代码 |
| T3.4 通知/发布渠道 | 未勾 | 通知权限已补；**发布渠道/正式签名没做** = 本文件 §3.4 | ✔文档 |
| T3.6 示例角色库 | 未勾 | **没做**（只有 2 个示范预设，没有示例卡） = 本文件 §3.1 | ✔代码 |

**参考项目改进清单的消化情况**（14 项全部落地，全部有代码坐标，详见 git 归档的对比文档）：P0 全部 5 项 ✅、P1 四项 ✅（双轴分离 = 决策①）、P2 全部 ✅（"AI 自写世界书守卫"核毕：本仓库无 AI 侧世界书写工具，无攻击面不适用——lore/trigger.ts 头注明文，2026-09-03 复核）。

---

## 6. 工程速查（给工程师/AI 用，你不用看）

```powershell
# ---- 构建 ----
rp-workspace\scripts\build-dsht.ps1 -DshVersion <版本> [-SkipInstall] [-Arch x86_64]   # 全流程 APK
node rp-workspace\scripts\build-rp-ui.mjs        # TH shim/vendor/client.js（NODE_PATH=rp-workspace\packages\node_modules）
# 改 packages/src/import/* 后重出导入中心引擎（在 rp-workspace\packages 下执行）：
npx esbuild src/import/browser-entry.ts --bundle --format=iife --global-name=DSHT --outfile=src/dsh-plugin/assets/app.js

# ---- 部署（模拟器热推，双写铁律）----
adb -s emulator-5554 push <本地 client.js> /data/local/tmp/dsht-client.js
adb shell "run-as com.dshtavern.app sh -c 'cp /data/local/tmp/dsht-client.js files/dsh-runtime/node_modules/dsht-rp-plugin/lib/client.js && cp /data/local/tmp/dsht-client.js files/.dsh/profiles/web/node_modules/dsht-rp-plugin/lib/client.js'"
adb -s emulator-5554 shell am force-stop com.dshtavern.app; adb shell am start -n com.dshtavern.app/.MainActivity
# 只推 profiles 会被 NodeService 启动时从 dsh-runtime 重拷覆盖（静默回滚）——必须双写 + 重启 + md5 核对

# ---- 验证 ----
adb -s emulator-5554 forward tcp:43080 tcp:3080; adb forward tcp:3081 tcp:3081
Playwright 连 http://127.0.0.1:43080 + CDP Runtime.exceptionThrown 抓 iframe 异常堆栈
cd rp-workspace\packages; npx vitest run    # 621/621 基线
adb -s emulator-5554 logcat -s DSHTavern.Node

# ---- APK 出包（2026-09-03 起一步到位，签名/改名/图标已内置）----
rp-workspace\scripts\build-dsht.ps1 -DshVersion 0.1.0-rc.8 -SkipInstall -Arch arm64   # 真机：release 正式签名 → DSH-Tavern-0.2.0-arm64-release.apk
rp-workspace\scripts\build-dsht.ps1 -DshVersion 0.1.0-rc.8 -SkipInstall -Arch x86_64  # 模拟器：debug（CDP 可调）→ DSH-Tavern-0.2.0-x86_64-debug.apk
# 正式签名：android\dsht-release.keystore（30 年）+ keystore.properties（口令，勿进 git）
# 注意：release 构建已关 lintVital（离线构建拉不到 lint-gradle）；WebView CDP 仅 debug 构建开启

# ---- 免浏览器发 turn（RPC 直调，实测用）----
# POST http://127.0.0.1:43080/api/session.list | session.history | session.prompt
# body: {"type":"client-request","rpcId":"<uuid>","method":"session.prompt",
#        "payload":{"sessionId":"st-xxx","mode":"queue","content":[{"type":"text","text":"..."}]}}
# 轮询 session.list 的 items[].running / projections.values.sessionStats.turns 判完成；
# usage 在 session.history 的 assistant/chunk(chunk.type=usage) 事件里（inputTokens=总请求 token）
```

关键路径：$DSH_HOME=`files/.dsh`（rp/sessions/skills/settings.yaml）；插件库=`files/.dsh/profiles/web/node_modules`；
runtime 源=`files/dsh-runtime/node_modules`；插件源码=`rp-workspace/packages/src/`（dsh-plugin/dsht-plugin-* /dsht-rp-ui）。

---

## 7. 已定死的架构规矩（改动需要你重新拍板）

| # | 规矩 | 大白话 |
|---|---|---|
| 1 | 前端能用原生就用原生（P7 定案） | 聊天界面用官方原生的，我们只做插件，不自己造聊天界面 |
| 2 | 产物映射铁律 | 角色卡→工作区；世界书→工作区里的 markdown；聊天→session；导入卡必带开场白 |
| 3 | 一卡一工作区 | 每张卡一个独立文件夹，孤儿聊天进"待认领"区 |
| 4 | 脚本沙箱同源放开 | 酒馆脚本跑在放开的沙箱里，内嵌 zod v4/jQuery/YAML |
| 5 | 插件单包双面 | 一个插件同时含后台+界面两面；清单里必须有主入口（坑 #21） |
| 6 | 会话明文存储 + rename 补丁 | 聊天记录不压缩（手机网页不支持压缩格式）；安卓禁硬链接用改名代替（坑 #14） |
| 7 | **zod 原型禁止探测** | 9 月 2 日地雷：探测代码本身会把库函数绑坏——永远别写"看看有没有这函数，没有就补"这种代码 |
| 8 | 界面规范 | 运维面板同类选项用统一的展开样式；模型池界面 1 秒刷新 |
| 9 | **合规边界（2026-09-04 审计定案）** | 全部个性化功能以官方插件机制存在（cordis patch layer + 官方加载器）；DSH 官方源与 PC runtime 零修改；唯一例外 = 安卓打包副本的 9 处平台适配补丁 + 6 类原生包 stub（既定方案，哨兵/幂等/断言三重纪律）。完整报告：`docs/CODE_AUDIT_2026-09-04.md`；DSH 升级时补丁经 build-dsht.ps1 自动重打（带命中断言） |

---

## 8. 归档索引（docs/archive/，只读）

| 文件 | 内容 | 价值 |
|---|---|---|
| PROJECT_PLAN.md | 全量任务规划 T0-T3 + §4.x 设计细节 | §4 设计章节仍是最完整的方案依据 |
| IMPORT_REWORK_PLAN.md | 十一轮导入回炉实录（含全部根因分析） | 排障方法论 + 根因档案 |
| REF_PROJECTS_COMPARISON.md | 六大参考项目源码级对照 + 改进清单 | 后续"抄作业"索引（消化状态见 §5） |
| UPDATE-SOP.md | 版本升级七步 SOP + 21 坑清单 | 构建排障手册 |
| DSHTavern-m0-测试说明.md | M0 里程碑测试说明 | 历史 |
| DSHTavern-m1-测试说明.md | M1 早期测试说明 | 历史 |
