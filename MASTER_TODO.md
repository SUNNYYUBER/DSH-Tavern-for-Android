# DSHTavern 总待办与现状（唯一活文档）

> **这份文档给谁看**：两个读者。① 你——看 §1~§4 的大白话部分做决策，每个问题都解释了"是什么、现状、我推荐什么"；② 未来的工程师或 AI——看"做法细节"和 §6 速查照着干活。
> 建立：2026-09-02。取代并归档了六份旧文档（位置见 §8），此后新任务、新结论一律回写本文件。
>
> 📋 **要动手做事，先看 [TASK-LIST.md](TASK-LIST.md)**（唯一任务清单：做什么、按什么顺序、做完的标志）。本文件管「现状与背景」，TASK-LIST 管「行动」。

---

# 【状态总览】只看这一页就够

> **更新规则**：本页每次工作轮次（心跳）结束时更新。**其余章节是流水账，不必读。**
> 最后更新：2026-09-12（心跳 61B —— **实机验收时挖出一个会让 app 无限 crash-loop 的「会话目录不变量」缺陷，三层缺陷链里有两层是我方自己造的**：
> ① **触发源**：`/rp/home` 交出**非规范**形态 `/data/user/0/<pkg>/files/.dsh` —— 官方 `projectKey()` 把 `/`/`\`/`:` 全折叠成 `-`，
> 而 Android 上 `/data/user/0/<pkg>` 与 `/data/data/<pkg>` 是**同一目录的两个路径形态** ⇒ 拼出**不兼容的目录名**；
> `RpOverlay.tsx:73/:330` 拿它拼 `session.create` 的 cwd ⇒ **每次 UI 新建会话都写出非规范 cwd**；
> ② **修复器半修复**：`repairSessionCwds` **先 `rename` 目录、后按硬编码 `'session.jsonl'` 读文件** ——
> 0.1.5 世代是 `session.v3.jsonl`（`session.jsonl` 作为 **v0 被冻结保留、目录里不存在**）⇒ `ENOENT` 被 catch 吞成 `errors=1`，
> 而目录**已经搬走**、header 没改 ⇒ **半修复态、永不收敛**；
> ③ **后果**：`dsh-workspace` 在**插件树加载期**（`assertStoredIdentity`）抛 `corrupt session log` ⇒
> `node exited with code 1; restart in 3s` **无限循环**；栈含 `Fiber._reload` ⇒ 首启可能侥幸通过、**一次 fiber 重载就命中**；
> ④ **修复三件**：Fix 1 抽纯函数 `relocatedSessionLogPath`（取扫描结果 basename，**绝不重拼 `session.jsonl`**）·
> Fix 2 `/rp/home` 交出 `normAndroidPath()` 规范形态（**根因修复**）· Fix 3 失败明细进 logcat（发现 `logLine` 只进内存环形缓冲）；
> ⑤ **验收（全实测）**：新建会话 `repaired=[] errors=[]` · **决断性冷启动回归**（symlink 形态）`repaired=1 errors=0` +
> **`node exited with code` 计数 0** · **全树不变量审计 85/85 / 0 违反**（新闸门 `audit-cwd-projectkey.mjs`）·
> 负控正好 4 条转红 · `stage4-regression` **21/21**；
> ⑥ 沉淀 **L87**（半修复态比不修复更危险 —— 不可逆动作最后做）/ **L88**（修复器的位置决定它能否救场）/
> **L89**（root shell 改应用文件必须改回属主）；建议新登记 **T-67**（壳侧 pre-boot 静态预检））
>
> 前一轮：2026-09-12 02:5x（心跳 61 —— **把「上下文瘦身」最后一条结构性漏网路径补上**：
> ① **活体取证在先**：纯 RPC 新建会话驱动 2 轮 → 第 2 轮请求 **79,994 字符 / 大块重复 ×2（逐字相同的 23,782 字符块）**，
> 而同轮 `pre-step` 快照 + 会话 `.v3.jsonl`（seq=11 与 seq=25 **逐字相同**、签名同为 `wi-depth:0`）
> 双重证明 = **我方注入的上一轮陈旧快照副本**（+42%）；
> ② **根因 = 触发器自指短路**（`!overThreshold && dupSigs === 0 → return ''` 恰好把"本轮重注旧副本"这条
> 本该生效的判据挡在门外 ⇒ `planShadowOps` 里那段正确逻辑是**死代码**；第 3 轮起"自愈"只因折叠 marker
> 共用同一签名让 `dupSigs` 偶然 ≥1）；
> ③ **修复**：抽出纯函数 `decideShadowTrigger`，判据补第三条 `freshStaleSigs ≥ 1`；
> **负控真跑**（改回旧触发器 → 正好 2 条新增正控转红）；
> ④ **实机闭环**：日志 `未超阈值 + 重复 0 组 + 本轮重注旧副本 1 组 → 去重启用` → 第 2 轮 **0 重复组 / 63,562 字符**；
> ⑤ **顺带**：补上**只存在于注释里**的诊断探针（全仓 grep `writeProbe` 为零）+ **第二次独立复现 T-57**（18.7s 恢复）；
> ⑥ 交付：单测 **53 文件 / 1111 全绿** · `stage4-regression` **21/21** ·
> APK `x86_64 debug v273` / `arm64 release v274`）
>
> 前一轮：2026-09-12 00:5x（心跳 60 —— **还清装机欠账 + 把两个「待定性」变成实测结论**：
> ① 设备已装 **v271**，`stage4-regression` attach 后 **21/21**，插件**三方 md5 全一致**（无第 ⑦ 类断链）；
> ② **T-57 定性翻转**：不是"运行久了失效"，是**启动后 ~3 分钟内的确定性窗口**（69 分钟时正常，
> 装包后 +2m33s/+2m43s/+2m55s 三次采样均 `gateway/service-unavailable`，+3m07s 起恢复）——
> 修复归并发实例，本轮只提供测量证据；
> ③ **T-63 新登记**：卡脚本 `importFromModule` 的 4 个 ST 内部模块**全 404**（缺口真实、**当前不可达**），
> 可修边界已划清 = `STVersionImports` 可独立修 / `SPresetImports` 需重实现 ST prompt manager，**不做空壳**）
>
> 再前一轮：2026-09-11（心跳 59 —— **发布前「一票否决项」T-25 出只读预检报告 + 把它变成可复跑闸门**：
> 受控面 609 文件扫描出 **306 项命中 / exit 1**（含 **1 条真实密钥**、16 条个人微信 ID、1.29MB 抓包正文），
> 结论 = **现在不能公开**；同轮 **T-35 完成**（4 份 deep-merge 收敛为 1 文件/2 函数，含负控 11 条转红））

## 一句话现状

**手机 APK 能跑了，数据能搬了，戏能演了** —— 现在在做「让它的行为和你熟悉的 TauriTavern 一模一样」。

## 三个阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| **一 · 地基** | 自研 37,635 行代码，把 ST 的角色卡/世界书/聊天/预设搬进安卓 APK | ✅ **完成** |
| **二 · 和 TT 逐项对齐** | 截获双方发给 AI 的完整请求，逐条对比，修差异 | 🔄 **进行中**（8 项差异，5 项已闭环；心跳 54：数据面 + UI 面的长尾回归（回退/编辑/变体/世界书/MVU）已逐项覆盖，`stage4-regression` **21/21 全过**；心跳 55：修掉「重新生成 / 回退」两条 live 写入路径恒 500 的缺陷（真机闭环）；**心跳 57 续：长尾最后一项「变体切换端到端」已闭环** —— 设备上此前**从未存在过**变体组，本轮造出 2 成员组并切换成功、写入形态经官方构造器判定合法） |
| **三 · 发布前准备** | 大扫除 / README / GitHub Releases + 更新开关 | 🔄 **进行中**（README ✅、更新开关骨架 ✅；**大扫除：心跳 59 出只读预检报告 + 可复跑闸门；心跳 61 复跑 —— 受控面 616 文件 / 合计 305 项，`SECRET` 已由 1 → 0**（⚠️ 属**并发实例**在 Plan 文档中的**未提交**改动；且**密钥仍在本地 git 历史里**，P0 历史重写未做）⇒ **仍不能公开**；更新渠道代码就绪、只差仓库地址 P-1） |

## 你投诉过的事（全部已修）

| 你说的问题 | 状态 | 轮次 |
|---|---|---|
| 悬浮窗到处乱窜 | ✅ 修好 | 心跳 35 |
| 显示成 `<interactive_input>$1` | ✅ 修好 | 心跳 36 |
| **发不出来消息** | ✅ 修好 | 心跳 37 |
| **升级 0.1.5 后发不出来消息** | ✅ 修好（两条平台级根因，见下） | 心跳 44 |
| **旧会话打开报 `Failed to load history`** | ✅ 修好（写侧漏 `stream` 字段 → 冷启动整体拒收；已自愈 + 补判据 7） | 心跳 49 |
| **点「↻ 重新生成」报 `Cannot read properties of undefined`**（「↩ 回退到此处」同病） | ✅ 修好（**心跳 47 一次"纯类型层"重构把两条写入路径整段打死，恒 500 且零写入**；已修 + 加静态闸门） | 心跳 55 |

## 和 TauriTavern 的差距（用请求体积量化）

| 指标 | TauriTavern | DSHT 修复前 | DSHT 现在 |
|---|---|---|---|
| 请求条数 | 25 | 71（2.84×） | **12 条** |
| 字符数 | 85,437 | 426,950（5.00×） | **127,794**（1.5×） |
| 大块重复 | 0 组 | 4 组 | **0 组** |

> **心跳 61 补充**：上表"DSHT 现在"列是**长会话**口径。本轮新建的**新会话第 2 轮**（此前唯一未覆盖的结构性路径）
> 也从 **79,994 字符 / 2 组重复** → **63,562 字符 / 0 组重复**（−20.5%）。
> ⚠️ `docs/DSHT-VS-TT-DIFF-2026-09-10.md` 的"大块重复 0 组"结论**在 09-10 当时是对的**
> （`dedup-after.json`：21 条 / 95,919 字符 / 0 组），但**口径未覆盖新会话第 2 轮**；该文档其余数字仍是 09-10 陈旧口径。

## 还剩什么（8 项差异里）

| 编号 | 差异 | 状态 |
|---|---|---|
| D-4 | 用户输入位置和 TT 不一样 | ⏸ **升级已完，结论不变**：需切 `llm-deepseek` 路由才可达（独立任务） |
| ~~D-6~~ ✅ | 多出 32 个工具定义（TT 没有） | ✅ **心跳 58 已按拍板关掉**（见 T-59）：`system-prompt/assemble` 按「是否 RP 会话」修剪 `tools` + 对应 `tool:<name>` section；agent 三路径保留 |
| D-7 | 采样参数对照 | ✅ **已补齐并修正**（心跳 46）：TT 侧首次抓到最终请求体。修正后真差异**只剩 D-6** —— `max_tokens` 映射正常（65535 = 预设值；首版误判系用错预设测量）、`top_p`/penalties 未发 = 宿主限制 H-②（非我方缺陷） |

## ⏳ 等你拍板（**3 项**，都不阻塞我继续干别的活）

> **心跳 52 变更**：**D-5a 已按建议 A 落地并实机闭环**；**T-49 经实测推翻，判定为非缺陷**（编辑入口本来就在）。
> **心跳 57 变更**：**T-42 根因修正后已修**（真根不是 DOM，是缺 ST 标准 `/version` 端点），**T-48 随之消解**。
> 三项都不再需要你拍板。详见下方「心跳 57 做了什么」。
>
> **心跳 57 续变更**：阶段二长尾最后一项「变体切换端到端」已闭环；新增 **T-57**（`sessionController`
> 服务运行一段时间后不可用 → RP UI「打开角色会话」会失败）—— 那是**待定性的缺陷**，不是要你做选择，
> 故不占拍板位；**T-58**（非 live 分支的破坏性截断）同理。
>
> **心跳 58 变更**：**D-6 已按拍板关掉**、**D-5b 按拍板选 B 关闭**；**T-42 被实测推翻后重开并真修**
> （见 T-60 —— 真根是宿主 `extension_settings.regex` 恒 `undefined`，**不是**心跳 57 说的 `/version`）。
> → 拍板位由 5 项降为 **3 项**。
>
> **心跳 59 变更（本轮）**：新增 **T-25 只读预检报告**（发布前**一票否决项**，此前只有定性描述）
> + **T-61 发布卫生闸门**（把「搜不到敏感信息」变成可复跑判据）；**T-35 完成**（deep-merge 收敛）。
> 拍板位**仍为 3 项**（T-46 / T-47 / P-1）—— 本轮**未新增决策**。
> ⚠️ **但新增一条发布阻断事实**：受控面扫出 **1 条真实 API 密钥** + 16 条个人微信 ID +
> 1.29MB 抓包正文 ⇒ **现在不能公开**（仓库无远端、从未推送，故非对外事故）。见 T-25 / T-61。

| # | 要你定的事 | 我的建议 | 不定会怎样 |
|---|---|---|---|
| ~~**T-42**~~ ✅ | ~~卡脚本要挂到 **ST 正则面板的 17 个 DOM 元素**（`#saved_regex_scripts` 等），我们前端是 DSH 的 UI，**一个都没有**~~ | **心跳 58 已真修，不用你拍板**——⚠️ 心跳 57 的「真根是缺 `/version` 端点」**已被实证推翻**：按卡逐字取法实测 `extensions.regex.length` **抛 TypeError**（我方 `extensionSettingsRegex` 恒 `undefined`），而卡在**无条件调用**的 `updateSTRegexes()` 里读它 → `RegexBinding()` 整段中断 → `ChatSquash`/`MacroNest`/工具注册**全不执行**（新旧版路径都会走到）。已按基准补 `extensions.regex` 真数据 seed（`host-vendor.ts:seedHostExtensionSettings`）+ iframe 侧同族副本。**实机验证**：`extensions.regex.length` = **1**（真数据，非空壳），反控同形报错。见 **T-60** | — |
| **T-46** | 脚本 iframe 里的宿主门面只有 **9 个成员**（宿主页有 37），卡在 iframe 内访问的 19 个真 ST 成员里 **16 个缺失** | 建议**补齐 15 个**（心跳 53 静态排查已证明成本从"一次重构"降到"接线"：iframe 是 `srcdoc + allow-same-origin` **同源**，`window.parent.X` 同步可达，且该文件本来就在这么用；只有一个活跃脚本运行时，无跨会话取错值风险）；**唯一例外** `renderExtensionTemplateAsync` 依赖缺失的数据模型 | **触发条件目前未成立**（设备 logcat 无 iframe 侧成员报错）→ 卡只在 iframe 内跑时才暴露；不补则相关脚本静默少功能 |
| **T-47** | 宿主门面最后 3 个成员的**数据模型**：`characters`+`characterId`（4+12 次调用）要**成对**建角色列表模型；`chatMetadata`（9 次）我方**无对应存储** | 需要你定**语义归属**（角色列表以什么为源？`chatMetadata` 存哪一层？）；拒绝"给空对象"——那会让卡的写入**静默消失**（本项目主力缺陷族） | 相关卡脚本的这几条调用**无实现**；若强行补空容器，会变成"看起来能用、写进去没反应" |
| ~~**D-6**~~ ✅ | ~~我发给 AI 的请求里多出 **32 个工具定义**（24k 字说明书），TT 的请求体**完全没有** `tools` 字段~~ | **心跳 58 已按拍板关掉**：`system-prompt/assemble` 里按「是否 RP 会话」修剪 `tools` + 对应 `tool:<name>` section；`lightAgent`/`heavyAgent`/`agent` 三路径**保留**（其预设正文要求调用工具，硬关会造出新的静默不一致）。见 **T-59** | — |
| ~~**D-5a**~~ ✅ | ~~手机时区显示为 `GMT` 时，系统给的时区名是 `+00:00`（非标准名），0.1.5 拒绝 → **发不出消息**。要不要做产品级兜底~~ | **已按建议 A 落地（心跳 52）**：注入层替换取样结果（`Intl.DateTimeFormat.prototype.resolvedOptions`），只换名字不换偏移；GMT 真机实测已能正常发消息并落盘 `clientTimeZone:"UTC"` | — |
| ~~**D-5b**~~ ✅ | ~~要不要**一次性清洗存量脏楼层**（`$1` 残留 + `<interactive_input>` 包装被写回过）~~ | **心跳 58 按拍板选 B：不清洗，本项关闭**。依据（心跳 54 只读报告）：**真脏 83 条 / 13 个会话**（`$1` 字面残留 62 / 嵌套包装 1），另 35 条属**设计用途快照**不计风险；**修复已生效**（最后一次污染 09-10 08:53 UTC → 最新消息 09-11 08:12 UTC，**23.3 小时零新增**）⇒ 残留纯属存量、只影响旧会话观感；清洗属不可逆写入，收益不成比例 | — |
| **P-1** | 更新开关要用**哪个 GitHub 仓库**（公开 or 私有？影响鉴权） | 需你定；**公开**最简单（无需 token） | 阶段三发布前必须定；代码已就绪，只差填地址 |

| ~~**T-49**~~ ❌ | ~~「改楼层」和「换变体（swipe）」在界面上根本点不到~~ | **心跳 52 实测推翻 = 非缺陷**：**编辑入口本来就在** —— user 气泡操作条里有 `✎ 编辑`（`data-testid=dsht-rp-edit`），实测点开就地编辑器（预填原文）+ 取消还原，全程零请求零数据变更；**变体条**也已接槽位，只是「只有 1 个变体时按设计返回 null」（当前 `groups=1`）。心跳 51 的「0 命中」是**窗口化 + 只采样 title/aria-label** 造成的假阴性 | — |

## 心跳 61B 做了什么（**实机验收时挖出一个会让 app 无限 crash-loop 的「会话目录不变量」缺陷**）

> 一句话：**「走 UI 新建的会话，会让 app 下次冷启永远起不来」** —— 链条上三个环节，
> **两个是我方自己造的**（一个在修复器的**写法**、一个在修复器的**位置**）。
> ⚠️ **没有用户可见症状**：触发条件 = 「走 UI 新建会话」，我是**在验证新会话快照去重时才踩到**的。

### 1. 🔴 症状链：`node exited with code 1; restart in 3s` 无限循环

装完 v275 的第一次冷启，logcat 出现**重复到刷屏**的一行：

```
[dsh-workspace] corrupt session log: ... (目录名与 header.cwd 不匹配)
node exited with code 1; restart in 3s
```

栈顶是 `assertStoredIdentity`，而它跑在 **`[cordis.init]` 的插件树加载期**
（`listStoredHeaders` → `listArtifacts` → `readGenerationHeader`）。
栈里含 `Fiber._reload` ⇒ **首启可能侥幸通过，一次 fiber 重载就命中** ——
这正是"我装了包能起来、用户重启后起不来"这类最难查的形态。

### 2. 三层缺陷链（**每一层都能独立站住**）

| # | 层 | 缺陷 | 归属 |
|---|---|---|---|
| ① | 触发源 | `/rp/home` 交出**非规范**路径形态 `/data/user/0/<pkg>/files/.dsh`；`RpOverlay.tsx:73/:330` 拿它拼 `session.create` 的 cwd | 我方 |
| ② | 修复器 | `repairSessionCwds` **先 `rename` 目录、后按硬编码 `'session.jsonl'` 读文件** | 我方 |
| ③ | 后果 | 目录名 ≠ `projectKey(header.cwd)` → 插件树加载期抛错 → **crash-loop** | 官方校验（正确行为） |

**①的机理**：官方 `projectKey(cwd)` 把所有 `/` `\` `:` 折叠成单个 `-`。
Android 上 `/data/user/0/<pkg>` 与 `/data/data/<pkg>` 是**同一目录的两个路径形态**（bind mount，`readlink -f` 不改写），
但**字符串折叠结果不同** ⇒ 目录名对不上。

**②的机理（**本轮最值得记的一条**）**：0.1.5 世代会话日志叫 `session.v3.jsonl`；
`session.jsonl` 作为 **v0 历史世代被冻结保留**、在目录里**根本不存在**。于是：

```
readFile(join(root, targetProject, h.sdir, 'session.jsonl'))   ← 必然 ENOENT
  ⇒ 被 catch 吞成 errors=1
```

而**此刻目录已经被 rename 走了**、`header.cwd` 一个字没改 ⇒
**半修复态**：`projectKey(目录名) ≠ projectKey(header.cwd)` 依旧成立，
下次扫描又会"发现"它、又搬一次、又失败 —— **永不收敛**。

### 3. ✅ 修复三件（一件是根因，两件是止血）

| # | 修复 | 位置 |
|---|---|---|
| **Fix 1** | 抽纯函数 `relocatedSessionLogPath(root, targetProject, sdir, sourceFile)` —— **从扫描结果 `SessionHeaderHit.file` 取 basename，绝不重拼 `session.jsonl`** | `dsht-plugin-shared/session-surgery.ts` |
| **Fix 2**（根因） | `/rp/home` 交出 `normAndroidPath()` **规范形态** ⇒ **消除新增来源** | `dsh-plugin/index.ts` |
| **Fix 3** | 失败明细 `console.log` 进 logcat（此前只有 `logLine`） | `dsh-plugin/index.ts` |

> **Fix 3 的由来**：排查时发现 `logLine` **只进 200 行内存环形缓冲**（走 `/rp/log` 端点），
> `console.log` 才进 logcat。而当时只有 `errors=1` 这个**计数**、没有**明细**
> ⇒ 「有计数、无明细」是排查断路，补一条 logcat 通道。

### 4. ✅ 验收（全部实测，无一条推断）

| 判据 | 结果 |
|---|---|
| `/rp/home` 形态 | `{"dshHome":"/data/data/com.dshtavern.app/files/.dsh"}` **规范** |
| 新建会话落点 | 落 `--data-data-…--` 且 `repair.repaired=[] errors=[]`（**零需修复**） |
| **决断性回归**（造 symlink 形态会话 → 冷启） | `repair-session-cwd: repaired=1 skipped=0 errors=0`、目录已搬、header 已改写、**`node exited with code` 计数 = 0** |
| **全树不变量审计**（新闸门 `audit-cwd-projectkey.mjs`，逐字照抄官方 `projectKey`） | **85/85 一致 / 0 违反** |
| 负控（把 Fix 1 改回硬编码） | **正好 4 条单测转红** |
| **阶段二「快照去重」回归**（在 v276 上复跑） | 新会话第 2 轮 **0 重复组**（`llm-232.json`，`messages=7`）⇒ 心跳 61 的修复**在新构建上仍生效** |
| `stage4-regression` | **21/21**（新建 live 会话制造 attach 态跑通，**用完已 `mv` 走**） |

### 5. 沉淀与新登记

- **L87**（**半修复态比不修复更危险 —— 多步修复要让「不可逆动作」最后做**）：
  自检问句 = 「这一步失败了，对象处于什么状态？」答案「比之前更坏」⇒ 必须重排顺序。
- **L88**（**修复器的「位置」决定它能否救场**）：我方修复器**全都在插件体内**，
  而这次损坏发生在**插件树加载期** ⇒ 插件里的「启动即修」**根本轮不到执行**。
- **L89**（设备端用 root shell 改应用文件，必须把属主**改回应用 uid**）：
  `adb root` 下 `mv`/重定向会让文件属主变 `root` ⇒ 应用 `EACCES` ⇒ **同样 crash-loop**（本轮踩过）。
- 🆕 **建议登记 T-67**：**壳侧 pre-boot 静态预检**（在 node 起插件树之前，用纯文件扫描判定
  「会话目录名 == projectKey(header.cwd)」，不符则先隔离，避免整个 app 起不来）。

## 心跳 61 做了什么（**把「上下文瘦身」最后一条结构性漏网路径补上**）

> 一句话：**新会话第 2 轮**会带着上一轮的陈旧世界书快照再发一遍（+42%），
> 而"去重"代码**早就在那儿、逻辑也是对的** —— 只是被**自己的触发条件**挡住了。

### 1. 🔴 活体取证：`llm-224.json` 两份逐字相同的 23,782 字符块

纯 RPC 新建会话（`session.create` → `_start`，**不碰任何用户数据**）驱动 2 轮：

| 轮次 | 请求 | 字符 | 大块重复 | 备注 |
|---|---|---|---|---|
| 新会话第 2 轮（**修复前**） | `messages=11` | **79,994** | **2 组**（逐字相同 23,782ch @ idx 4/9） | `llm-224.json` |
| 新会话第 2 轮（**修复后**） | — | **63,562** | **0 组** | 装 v273 后复测 |

**两条互相独立的取证**（缺一不能定性）：
1. 同轮 `agent/pre-step` 快照 `msg-057.json` → 该块 `source.kind='plugin'` ⇒ **是我方注入的，不是模型回吐**；
2. `session-0b05834c.v3.jsonl` → **seq=11 与 seq=25 逐字相同**，签名同为
   `["dsht-rp-plugin",["dsht-rp:wi-depth:0"]]` ⇒ **同一份内容被写了两遍**。

### 2. 根因：**触发器自指短路**（`planShadowOps` 那段正确逻辑是死代码）

`dsht-plugin-memory/index.ts` 里 `planShadowOps` **本来就有** `freshSigs` / `supersededByFresh`
——「本轮重注了同签名的旧副本 → 折叠那份旧的」。**语义完全正确**。但触发条件写成：

```ts
if (!overThreshold && dupSigs === 0) return ''   // ← 规划器根本没被调用（修复前 :894-901）
```

`dupSigs` 数的是「**视图上已有几份同签名快照**」，而 `freshSigs` 起作用的前提**恰好是**
「视图上只有 **1** 份旧副本」⇒ **两个条件下它都不可达**。

**为什么第 3 轮起"自愈"**：折叠 marker 共用同一签名（源码 :985 注释原文承认）⇒ marker 攒到 ≥2 份后
`dupSigs` 恒 ≥1，触发器**偶然**重新武装。实测第 4 轮日志 `重复快照签名 1 组` —— **那"1 组"就是 marker 自己**。

### 3. ✅ 修复：抽纯函数 + 补第三条判据

- 新建可测纯函数 **`decideShadowTrigger({nodes, freshSigs, estTokens, threshold, minDup})`**，
  判据从「体积超阈值 ∨ 重复签名 ≥2 组」扩为 **∨ 本轮重注的旧副本 ≥1 组**（`freshStaleSigs`，
  只对**快照节点**计数、按签名去重）。
- **正控 + 负控都真跑**：新增 `tests/memory-plugin.spec.ts` **8 条**（含"触发器放行 ⇔ 规划器产出
  `[{start:11,end:11,kind:'snapshot'}]`"的两级一致性）；**负控**（把 `need` 改回 `overThreshold || dupSigs > 0`）
  → **正好 2 条转红，就是新增的那两条正控** ⇒ 证明它在**承重**。
- **实机决定性日志**（v273）：

```
[dsht-memory] surface 影子化判定: est=11.1k tokens (阈值 80k, 未超→前缀保留)，
              重复快照签名 0 组 + 本轮重注旧副本 1 组 → 去重启用
[dsht-memory] surface shadow: ops=1，视图 3.6万→1.2万字符，折叠至第 0 楼
```

> 这一行**自带反事实证据**：「未超阈值」+「重复 0 组」**正是旧条件下的短路条件** —— 旧代码在这里必然早退。

### 4. 🔧 顺带：修掉"只存在于注释里的能力"（L86）

`:916` 注释承诺「把 `shadowSurface` 每个 early-return 落盘成探针」，但**全仓 grep `probe`/`writeProbe` 返回零个标识符**
—— 那句话没有任何实现。已补 `writeProbe` + 三处调用（`no-surface` / `skipped` / `need-but-zero-ops`）。
**后续同类问题可直接读探针，不必再截包。**

### 5. 🧪 顺带：**第二次独立复现 T-57**

`session.create` 首次被 `gateway/service-unavailable` 拒（UTC 18:51:42.875），**18.7s 后恢复**
⇒ 为并发实例的"启动竞态"定性补上**第二条测量证据**（脚本已内置预算重试）。

### 6. 交付与验收

| 项 | 结果 |
|---|---|
| `typecheck` 三段式 | **0 错** |
| 全量单测 | **53 文件 / 1111 全绿**（+8） |
| `stage4-regression` | **21/21** |
| APK | `x86_64 debug` **196,840,085 B sentinel v273** / `arm64 release` **128,366,108 B sentinel v274** |
| 构建链第 ⑦ 类断链 | ✅ 三方一致（staging = `dsh-runtime/` = `profiles/web/` = APK 内 `assets/dsh-runtime.zip`，md5 `cf288b9b9cb56cf1be7ac55218c376fb`） |
| 证据全文 | `stage3-device/hb61/HB61-SNAPSHOT-DEDUP-EVIDENCE.md` |

沉淀 LEARNINGS **L85**（触发器自指短路）/ **L86**（文档承诺的防线可能只是注释）。

## 心跳 60 做了什么（**还清装机欠账 + 把两个"待定性"变成有实测结论**）

> 一句话：把 T-57 从"运行久了会坏"**改成"启动后 ~3 分钟内会坏"**（一次性实机取证），
> 顺手把 T-63（卡脚本的 ST 内部模块 404）定性到"**缺口真实但当前不可达**"，
> 并核清构建链第 ⑦ 类断链本轮**不存在**。

### 1. ✅ 还清「装本轮 APK + 跑回归」欠账（心跳 59 让行未做）
- 设备哨兵 `files/dsh-runtime/.installed-v269` → 装 **v271** → `.installed-v271`；
  装机后 `/version` 返回 `pkgVersion: 1.18.0`（T-60 的修复在设备上生效）。
- `stage4-regression`：**20/21**（未 attach 会话，与基线同）→ 打开 RP 会话后 **21/21**。
- **构建链第 ⑦ 类断链核验（三方一致）**：APK 内载荷 = staging = 设备 `dsh-runtime/` 副本
  = 设备 `profiles/web/` 副本（`mvu` `82218190…` / `tavern-helper` `8367551b…`，逐字节相同）。
  `adb install` **这次没有**留下旧副本（boot 期会重新同步）。`undo` 只存在于 runtime 侧属设计如此。

### 2. 🔴 T-57 定性：**不是"长时退化"，是"启动竞态"**（一次性窗口，已抓）
装包后逐 8 秒轮询 13 次，同一进程内同时抓到两个方向：

| 段落 | 观测 |
|---|---|
| **装包前（已跑 69 分钟）** | `session.list` → **HTTP 200 / ok:true / items=81** ⇒ **长时运行不失效** |
| 装包后 +2m33s / +2m43s / +2m55s | 🔴 `gateway/service-unavailable` —— `active Service "sessionController" is unavailable` |
| 装包后 **+3m07s 起** | ✅ `ok:true items=81` |

关键细节：出错的三个采样点里，页面 **`readyState` 已经是 `complete`、门面已有 37 个成员** ——
即「**页面看着已就绪，宿主服务还没注册**」。⇒ 存在一个 **≥22 秒的确定性窗口**，用户在此窗口点
「打开角色会话」必失败。官方 `dsh-api-gateway/lib/index.js:747-748`：该错误在
**调用被调方法之前**抛出 ⇒ **零副作用** ⇒ 重试安全（对 `session.create` 同样成立）。
- ⚠️ **本文件不重复修复**：`rpc.ts` 已被**并发实例**占用（已落地 `DshRpcError.code` + `isServiceUnavailable`，
  根因框定为 cordis fiber 自动 `_reload`）——按并发协议**一份没碰**。
- 本轮的**测量证据**归档 `stage3-device/hb60/T57-BOOT-RACE-EVIDENCE.md`，并给出两条建议：
  ① `RpNativeChat.tsx:1637` 的 `catch(() => new Map())` 会把一次窗口内失败**缓存钉住** → 应「失败不缓存 + 出声」；
  ② 重试须**有预算**（窗口 ≥22s ⇒ 建议 ≥60s）且**只对 `gateway/service-unavailable`**。

### 3. 🆕 T-63：卡脚本 `importFromModule` 的 4 个 ST 内部模块**全 404** —— 定性为「**缺口真实、当前不可达**」
- **机制**：卡注入 `<script type="module">` 做**静态 import**（`tmp/t37-inject.js:103-127`），
  调用点在 `$(async () => { await fetch('/version') … })` 就绪块内（`:2204-2243`）。
- **判据 A（存在）✅**：基准 `SillyTavern-reference/public/` 四模块都在
  （`script.js` 507KB / `scripts/openai.js` 307KB / `preset-manager.js` / `utils.js`）；我方实机**四条全 404**。
- **判据 B（可达）❌**：7 个脚本宿主帧里 `window.versionNumber` **全 `undefined`**
  ⇒ 就绪块**从未执行** ⇒ `importFromModule` 尚未被调用 ⇒ **当前无 import 失败**（⚠️ 有时效性，
  T-42/T-60 当初正是靠 `versionNumber===11800` 验证的）。
- **一旦可达的后果（机读口径；本轮初稿手工分档被工具纠正过一次）**：
  **裸标识符 8 处**（`:1843/1847/1914/2254/2256/3025/3039/3045`）→ 理论 `ReferenceError`
  （⚠️ `:1914` 的 `SPresetImports?.promptManager` **也属此类** —— **可选链挡不住「未声明的标识符」**，
  `?.` 只对 null/undefined **值** 短路；分档只看有没有 `globalThis.`/`window.` 前缀）；
  **带前缀 + `?.` 4 处**（`:510/539/550/1347`）→ **静默降级**。
  但 8 处裸引用**全部下游于 `module_imported`**（`installSPresetMessageInjectionHook` 的调用点
  `:2303` 就在该处理器体内）⇒ **「鸡与蛋」**：导入失败 → 处理器不跑 → 不可达；
  导入成功 → 容器已定义 → 不抛 ⇒ **失败模式下结构性不可达**（比"碰巧没触发"更强），两向均无崩溃。
  净后果 = SPreset / MacroNest / ChatSquash / 结构化消息注入 / 预设重命名 sanitize **整体静默缺失**。
- **半修安全性**：只修 `STVersionImports` 时 `module_imported` 以 `id:'STVersionImports'` 发射，
  处理器里 `if (data.id === 'SPresetImports')` 分支被跳过 ⇒ **不会触碰任何 SPreset 裸引用**。
- **同轮新建可复用工具** `scripts/audit-card-resource-surface.mjs`：把 T-42/T-60/T-63 三次"逐次踩坑"
  升级为 **L43 式一次性静态穷举**（`importFromModule` 模块依赖**含裸引用点** / `fetch` 端点可 `--probe` 实测
  HTTP 码 / `globalThis`·`window` 期望全局 / 资源字面量）。`--selftest` **14/14 PASS**（含 2 条负控：
  注释掉的调用不得计入）。实跑卡：`/version → HTTP 200`（T-60 修复在设备上活着）、`toastr` 已在宿主面；
  **它当场纠正了本轮手工分档的两处错误**（裸引用 4 → **8**；`:1914` 由"静默档"改判"抛错档"）。
- **✅ 边界普查（本轮完成）**：同一工具跑**设备上全部 7 个 TH 脚本**（合计 **575,499 B**）——
  **`importFromModule` 0 处、`fetch` 端点 0 处**，仅有的 host-expected 全局（`TavernHelper`/`$`）我方都已提供。
  ⇒ **缺口被限定在「外链托管的卡注入脚本」这一个来源，不是用户脚本的系统性问题**；
  修不修 T-63 对用户当前在用的全部脚本**零影响** ⇒ 支持「登记为已知差异、不投入重实现」。
- **可修边界**：`STVersionImports` 只依赖 `./script` ⇒ **可独立修好**；
  `SPresetImports` 横跨四模块、其中 `./scripts/openai` 需重实现 ST 的 prompt manager + 消息模型
  ⇒ **在可预见成本内不可能成功** ⇒ **单独补 `utils` 是无效功**（ES 静态 import 是原子的）。
  **坚决不做空壳导出**（会把「静默缺失」换成「错误地看起来能用」，比现状更糟）。

### 4. 沉淀
LEARNINGS **L83**（缺口"存在" ≠ 缺口"可达"；静态 import 原子性）·
**L84**（给"代码执行到哪"定锚，只能用**显式写 `window`** 的那个变量 ——
顶层 `let`/`const` 不是 window 属性，`undefined` 不能当"没执行"的证据）。
新登记 **T-63**；本文件本节 + TASK-LIST §0/§7。

---

## 心跳 59 做了什么（**把「发布前一票否决项」从一句定性描述，变成一份有数字的报告 + 一台可复跑的闸门**）

> 一句话：T-25「大扫除」一直只有一句「仓库内搜不到任何真实人名/卡名/服务器地址」——
> **搜没搜过、搜了什么，没人能复现**。本轮把它变成 ①只读报告（有数字、有位置、有方案）
> ②可复跑闸门（`--selftest` 正控 + 退出码）。顺带把最后一份 deep-merge 技术债 T-35 收口。

### 1. T-25 只读预检 —— 首次给出**可复现的数字**

- **扫描口径**：只扫 `git ls-files`（**真正会被发布出去的发布面**，609 个文本文件）；
  忽略目录（`backup/` `tmp/` `stage3-device/` 等 4 万+ 文件）不进仓库即无发布风险，扫了只会淹没信号。
- **结果：306 项命中 / 退出码 1（未达标）**

| 判据 | 命中 | 严重度 | 最要紧的几条 |
|---|---|---|---|
| SECRET 真实 API 密钥 | **1** | 🔴 发布阻断 | `DSH Android Roleplay App Plan.md:3809` —— **用户真实上游密钥**被逐字记入（某轮对话粘贴） |
| WXID 个人微信 ID | 16 | 🟠 | 15 处在同一份 Plan 文档、1 处在 `golden-import.mjs:6` 的硬编码路径 |
| WORDLIST 真实卡名/人设名/预设名 | 200 | 🟠 | 集中 3 处：Plan 文档（历史对话逐字归档）、`docs/archive/*`、**`.workbuddy/memory/*`（也在受控面）** |
| PAYLOAD 抓包正文 | 8（≈1.29MB） | 🟠 | `golden/dsht/*.json` + `golden/st/dump-00{2,4,6,8}*.json`。⚠️ `golden/tt-sampling/` 已忽略、**同批内容却两种处置** |
| SERVER 外部服务器地址 | 11 | 🟡 | 真实 provider 网关 ×2 + **卡脚本托管域**（其一已嵌进产品源码注释 `host-vendor.ts:130`） |
| LOCALPATH 本机绝对路径 | 70 | 🟡 | 24 个文件，主要是构建脚本的 JDK 绝对路径与探针默认参数 |

- **紧迫度判断（关键）**：`git remote -v` **为空** —— 117 个提交**从未推送**
  ⇒ 密钥**仅在本机磁盘与本地历史**，**不是对外事故**；但**必须先清理、后推送**
  （先推再清 = 密钥永久留在远端历史）。**这一步是本轮新增的发布阻断项**。
- **方案**：报告给出 P0–P3 四阶段（含风险与回滚）；**本轮只读、未动任何文件**（数据冻结期内）。

### 2. T-61 发布卫生闸门 —— 让判据可复跑

- 工具 `scripts/audit-publish-hygiene.mjs`：六类判据 + `--selftest` / `--json` / `--verbose`，退出码 0/1。
- **词表外置**到已 gitignore 的 `scripts/publish-hygiene-words.txt` —— **自指悖论**：
  把真实卡名硬编码进脚本，扫描器自身就成了泄露源。
- **输出全掩码**，且 CJK 词只留首字（中文词仅 2~4 字，留首尾等于泄露一半）。
- **正控 17/17 PASS**，且它在开发中**当场抓出检测器自身的一个假绿**：
  首版占位符判据写成 `/^sk-(abc|test|…)/i` **前缀匹配** → 把 `sk-abcdefghijkl…`
  这种真密钥形状当掩码放过了。已改为**按分隔符切段、每段都必须是占位词或重复字符**。
- 白名单从 60 项噪声收窄到 11 项真信号（jQuery/lodash 官网、示例域、正则截断伪域名 = 误报）。

### 3. T-35 收口 —— 4 份 deep-merge 收敛（技术债清零）

- **最终形态 = 「1 文件 / 2 函数 / 3 处别名 / 1 处换参」**，而不是「合成 1 个函数」：
  实测证明存在**两个语义家族**（incoming 胜 / existing 胜），同一输入**结论相反**，强行合一必改一侧行为。
- **本轮新发现（比原任务描述更深一层）**：families-B 内部还有第二层差异 ——
  `deepMergeInitVars`（**深拷贝**补入值）与 `deepMergeInsert`（**共享** `incoming` 子树引用）
  **结果形状相同、引用语义相反** ⇒ **只写 `toEqual` 的测试发现不了**，故两者**仍不可合一**。
- **负控真跑**：把 families-B 临时接成 families-A → **11 条转红**，含**既有 `mvu.spec.ts` 用例** → 还原。
- 验收：`typecheck` 三段式 0 错 · 单测 **52 文件 / 1095 全绿**（+17）。

### 4. 交付 / 未做的事

- **双架构 APK 重打**：`x86_64 debug` **196,839,148 B sentinel v271** / `arm64 release` **128,365,172 B sentinel v272**；
  新符号已在 **staging → APK 内 `assets/dsh-runtime.zip` → 双架构**三层核验命中（4 个产物）。
- ⚠️ **本轮未装包实测**（有意）：设备上 app 已连续运行 **61 分钟**，且 CDP 通道
  `tcp:9333 → PID 29805` 正挂在它上面 —— 那是**并发实例 T-57 长时实验**所需的窗口，
  装包会强制重启 app、**摧毁一个不可复现的 61 分钟运行态**。按并发协议让行，
  装机 + `stage4-regression` **明确留给下一轮**（本轮改动为纯重构，语义已由 1095 单测 + 负控钉死）。

---

## 心跳 57 做了什么（**把「当前前线」T-42 的根因往前推一层：真根不是 DOM，是缺一个标准端点**）

> 一句话：**前面 5 个心跳把 T-42 当成"要不要补 ST 面板 DOM"的产品决策在等你拍板 —— 其实那是个伪选择。
> 真正的根是我方宿主页缺 ST 标准的 `/version` 端点，导致所有卡的版本分叉静默走错分支。**

### 发现路径（不再盯着报错，而是回到"卡为什么走这条路"）

T-37 → T-40 → T-41 → T-42 一直是"修一个、错误往前移一个"的串行链（L35）。
本轮不再等第四次报错，而是**回到卡脚本最早执行的那几行**逐行读：

```js
// tmp/t37-inject.js:2210-2218（卡的宿主注入脚本，页面加载即跑）
await fetch('/version').then(res => res.json())
  .then(data => { const v = data.pkgVersion.split('.')
    window.versionNumber = +v[0]*10000 + +v[1]*100 + +v[2] })
  .catch(() => { window.versionNumber = 10000 })          // ← 取不到 = 静默落回旧版
```

该脚本内 `versionNumber >= 11305` 出现 **20+ 处**；其中正则绑定那处原文注释写着
`11305+ has built-in regex binding; ST is source of truth, only sync FROM ST`。
**基准（TauriTavern）** `src/compat-version.js:1` 声明 `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`
→ 卡得 **11800** → **走新版路径**。

### 实机取证（决定性）

| 判据 | 修复前 | 修复后 |
|---|---|---|
| `GET /version` | **404**（空体、非 JSON） | **200** `{"agent":"SillyTavern:1.18.0:DSHTavern","pkgVersion":"1.18.0",…}` |
| 卡的取版本代码（逐字复刻） | 落 `catch` → `versionNumber = 10000` | **`versionNumber = 11800`**，分支 `NEW(builtin-regex)` |
| `ctx.chatCompletionSettings` 的键 | `prompts` / `prompt_order` / `preset_settings_openai` | 多出 **`extensions`** |
| 卡的取法 `extensions.regex_scripts` | **属性访问先抛** | **不抛**（`cardReadThrows: false`） |

⇒ 结论：**这不是产品选择，是 L36「跟基准一致既不能少也不能多」的「少了」一侧。**

### 修复（**一组三件 + 一个常驻锚点**，缺一则只是"换个坑"，见 L71）

| # | 落地 | 位置 |
|---|---|---|
| ① | `GET /version`（返回 `pkgVersion: '1.18.0'`，与基准逐字同值） | `dsh-plugin/index.ts`（`kind:'exact'`，path `/version`）；常量单源 `dsht-plugin-shared/st-compat.ts` |
| ② | `chatCompletionSettings.extensions.regex_scripts`（ST 1.13.5+ 预设内嵌正则通道，**真数据**） | `dsht-plugin-tavern-helper/facade.ts` 的 `/context`；单源 `buildStRegexScripts` / `toStRegexScript` —— **顺带补上原本漏输出的必填 `id`**（卡按 `s.id` 做增删匹配），并收敛掉 `presetExport` 里那份重复实现（L61） |
| ③ | 宿主门面保证 `extensions` **恒存在**（给空对象而非省略键） | `dsht-rp-ui/src/client/host-vendor.ts`；类型 `th-shim.ts` |
| ④ | **常驻**锚点 `#saved_regex_scripts`（`ensureStRegexAnchor()`，幂等、hidden、**故意不带 class**） | `host-vendor.ts` + `index.tsx` 启动时调用 |

**为什么锚点必须"常驻"**：卡的 observer 是**无条件**的（`inject.js:3884-3889`），
而卡脚本的执行时机（卡被激活）与我方正则面板的挂载时机（用户切到那个 tab）**不同步** ——
放在面板组件里则"用户没打开过面板"照样抛。基准侧该元素由 ST 扩展 `init()` 在**页面加载时**
渲染进扩展设置容器，不依赖用户操作。

**为什么这**不是**「只补空容器」的半吊子（T-42 的选项 C）**：选项 C 的前提是**卡走旧版路径**
（那时它要往容器里渲染自己的行，空容器 = 假挂载）；而修好 `/version` 之后卡走**新版路径**，
它**主动不渲染**（`inject.js:4196` 的 `if (versionNumber >= 11305) return;`），
所以这个版本下它的**正确内容就是空**。数据走 `extensions.regex_scripts`（真数据），
用户可见的正则管理由我方 `RegexPanel` 承担 —— 两条通道都真实存在。

### 验收

- `typecheck` 三段式 **0 错** · 单测 **51 文件 / 1062 全绿**（+25）
  - `st-compat.spec.ts`（新增）：黄金母版钉住 `1.18.0` 与阈值边界
    （`'1.13.5' → 11305` 恰好命中 / `'1.13.4' → 11304` 差一 / 解析失败 → 10000 与卡的 catch 同值）
  - `facade.spec.ts`：`/context` 的 `extensions.regex_scripts` 三种状态 + 白名单 + **确定性兜底 id** + 非 TH snake_case 形状
  - `host-st-facade.spec.ts`：空壳也必须带 `extensions`、卡的取法**不抛**、锚点幂等 + **不带 class**（承重断言）
- 实机（x86_64 v267 装机 + 热推双副本后复验）：上表四行判据全过

### 沉淀

LEARNINGS **L71**（第三方脚本「取不到就静默降级」= 版本分叉陷阱：缺一个基准端点，整批分支悄悄走错，
且**每一层都显示正常**）· **L72**（「兜底路径不可达」第三次重演；判据是"取值会不会先抛"，
不是"有没有兜底"）。

### 副作用（顺带修正的历史结论）

**T-42 / T-48 的选项 A/B 撤销** —— 它们的前提（"卡需要 ST 旧版正则面板 DOM"）是**版本分叉走错**的产物。
`renderExtensionTemplateAsync('regex','editor')` 只在卡的**旧版**面板路径里被调用，新版路径不再走。
删掉的一项决策负担；`T-46`（iframe 门面窄）与 `T-47`（角色列表模型）**不受影响，仍待拍板**。

---

## 心跳 57 续做了什么（**阶段二长尾最后一项「变体切换端到端」闭环 + 两条新经验**）

> 一句话：**"变体切换没被覆盖"不是巧合 —— 设备上从来就没存在过任何变体组。
> 本轮走产品路由造出一个 2 成员组，把「切换」这条路径第一次真正跑通，并证明写进去的事件形态合法。**

### 1. 先穷举，再动手

全设备 81 个会话逐个 `grep -l 'regeneratedFrom\|variantOf'` → **0 命中**。
⇒ 变体组在真机上**从未存在过**（心跳 54 记的"`groups=1` → 按设计隐藏"其实还高估了，
那时连 1 个组都没有）。所以「切换」这条代码路径**从未被执行过哪怕一次**。

### 2. 走产品路由全链路（不直写事件、不碰用户数据）

| 步 | 动作 | 结果 |
|---|---|---|
| ① | `session.create`（cwd = `<dshHome>/rp/_start`，**一次性会话**） | 拿到 live sessionId |
| ② | `rp/chat/append` 追加变体 A | assistant seq **5** |
| ③ | `rp/session-rollback keepThroughSeq=4` | 标记 `dsht:surgical {"rolledBackTo":0,"shadowedSeqs":[5]}` |
| ④ | `rp/chat/append` 追加变体 B | assistant seq **12** |
| ⑤ | `variant/groups` | ✅ **首次形成 2 成员组 `[A@5, B@12]`，active=12** |
| ⑥ | `variant/switch {targetSeq:5}` | ✅ **200 `{"ok":true}`** |
| ⑦ | `variant/groups` | ✅ **3 成员组 `[A@5, B@12, A@19]`，active=19** |

第 ⑦ 步与文档语义一致：**每次切换 = 追加一个新成员并成为新 active**（成员随滑动增长），
前端按**文本归一化**算 `‹n/m›` 计数。

### 3. 写入形态逐字段对质（这才是 0.1.5 重写变体写入的真正目的）

- `surfaceOp = {"op":"replace","startSeq":5,"endSeq":5}` —— **0.1.5 的 `startSeq/endSeq`**（不是旧式 `start/end`）
- 标记载荷走 `data.source.sections[dsht:surgical]`（顶层自定义键会被迁移器拒）
- `compaction/prune` **紧邻** replace，带 `shadowedRange` / `shadowedSeqs` / `shadowedTokenCount`
- `assistant/message` 四件套齐全：`turn / step / stream / message`

**判定（官方 `Session` 构造器当 oracle）**：文件 **`✓ 可加载 1/1`**；
`diag-session-settlement` **问题事件 0**（3 条 assistant 全 `streamOk:true`）。
**并跑了负控**（删掉一条 `data.stream`）→ 工具正确报
`✗ seed assistant/message at index 12 has invalid settlement fields`
⇒ **正控 + 负控都过**，这条"绿"不是假绿。

### 4. 本轮踩的两个坑（已沉淀成经验）

- **L74**：为找锚点，对**未挂载**的会话打了 `session-regenerate` → 它走**非 live 分支 = 物理截断会话文件**
  （返回体长得像成功：`{"truncated":1,"lastUserText":"…"}`），且**不产生变体标记**。
  幸有备份才精确还原（md5 回 `68ddd464…`）⇒ **写路由必须先问 liveness**，别用"发一次看看返回什么"探写路由。
- **L75**：`session.create` 被 `gateway/service-unavailable: active Service "sessionController" is unavailable` 拒。
  换假设做**最小对照实验**（同一请求在"刚重启"vs"跑一阵"各打一次）→ 证明它是**生命周期信号而非参数错误**
  （重启后立刻 `ok:true`）。⇒ 报错含 `gateway`/`typert`/`service` 时，先做活性对照，不要在参数形状上打转。

### 5. 清理与验收

- 两个一次性会话（含 projcache）用 **`mv`** 移出（不用 `rm`）；`_start` 项目归零、**设备会话数回到 81**。
- 本轮**未改产品源码** ⇒ **无需重打 APK**（沿用 **x86_64 v269 / arm64 v270**）。
- `stage4-regression` **21/21**（与基线一致 = 无回归）；实机 `/version → 200`、`#saved_regex_scripts` 锚点在位。

### 6. 本轮新登记

- ~~**T-57（待定性）**~~ ✅ **心跳 59 定性 + 顺手修掉两处我方静默降级**：
  机制（逐层查到官方源码）：报错来自 typert gateway 的 `ctx.get('sessionController')` 取不到实例
  （`dsh-api-gateway/lib/index.js:743`），根因是承载它的 **cordis fiber 离开 ACTIVE**
  （`cordis/src/reflect.ts:237-243`；该服务 inject 了 10 个依赖，任一被重载即 `_unload()`），
  **框架会在依赖恢复时自动 `_reload()`** → 属**宿主框架的生命周期行为，非我方缺陷**（也不在 TT 差异清单内）。
  **但我方确有两处真缺陷（已修）**：① `dshRpc` 丢弃 `error.code`（gateway 把业务失败包进 HTTP 200，
  `!resp.ok` 永不触发 → 调用方无从区分「可重试」与「不可重试」）→ 新增 `DshRpcError` + `isServiceUnavailable`；
  ② `fetchRpSessionMap` 把失败空 Map **永久钉住** → 一次瞬时失败 = 「↻ 重新生成」按钮**永不显示**且无报错
  → 改为失败不缓存 + 可自愈码重试一次 + `console.warn`。
  **复测**：14min / reload 后 / **45m54s** 三轮均 `ok:true`（未复现，与「依赖重载窗口的瞬时态」机制一致）。沉淀 **L80**。
- ~~**T-58（待定性）**~~ ✅ **心跳 58 收口：原描述与代码相反**。
  三处非 live 分支（rollback/edit/regenerate）**本就有 409 硬拒收守卫**；
  被拒的是 live（会话开着），能改盘的是非 live（会话关着）——后者是**设计语义**。
  真缺口是**该判据在 6 处逐字复制、单测只覆盖 1 份**（这正是误判的土壤）→
  已收敛为单源 `canSurgicallyTruncate` + 补 4 条测试 + 反控。沉淀 **L79**。

---

## 心跳 58 做了什么（**用户拍板 4 项落地：D-6 关工具 / T-42 收口 / D-5b 关闭**）

> 一句话：把「等你拍板」的四项做成决定，其中 **D-6 与 T-42 是真修**，
> 而 T-42 是**推翻上一个心跳结论**得来的 —— 上一轮说「不是缺陷」，本轮拿探针证伪。

### ① D-6（关掉 32 个工具定义）—— 见 T-59

- **判据**：基准 TT 请求体**没有 `tools` 字段**，DSHT 有 32 个（D-7 抓包实锤）。
- **DSH 没有「关 tools」开关**（静态枚举确证），官方给的两条路是自定义 preset 或
  `ctx.tools.restrict()`（需 scoped ctx）。本项目走**第三条最短路径**：
  在 `system-prompt/assemble` 里修剪 —— 官方明文标注该 `assembly` 是 **mutable**。
- **两个设计决定（都不是"更省事"的那个）**：
  | 决定 | 为什么 |
  |---|---|
  | **按 generation path 分流**（`lightAgent`/`heavyAgent`/`agent` 不修剪） | 那三条路径的**预设正文写着「先用 lore_query 工具查询世界书，再作答」** —— 硬关会让正文指向不存在的工具，是**新造的静默不一致** |
  | **`tool:<name>` section 成对摘除** | 只清 `tools` 会留下「查看 bash 结果的 `[exit code: N]`」这类指向不存在工具的系统指令 = 把污染换成自相矛盾 |
- 迁移会话天然不受影响（其 cwd 是 `rp-import/*`，不匹配 `rp/<slug>`，且它靠工具干活）。

### ② T-42 收口（宿主 `extension_settings.regex`）—— 见 T-60，**推翻了心跳 57 的结论**

心跳 57 判定 T-42「降级为非缺陷」，理由是「卡在新版路径下不往 `#saved_regex_scripts` 渲染」。
**该理由对那个锚点成立，但对 `extension_settings.regex` 不成立** —— 本轮按卡的**逐字取法**做探针：

```
OK    ccs.extensions.regex_scripts => undefined
THROW extensions.regex.length      => Cannot read properties of undefined (reading 'length')
```

卡在**无条件调用**的 `updateSTRegexes()` 里读 `extensions.regex.length` → 我方恒 undefined
→ **取值先抛** → `RegexBinding()` 整段中断 → `ChatSquash()` / `MacroNest()` / 工具注册全不执行。
（这正是 T-42 登记的原始影响面。）

**修法**：`/context` 输出全局正则 → 宿主 seed `extension_settings.regex` / `regex_presets`
（**不是数组→种；空数组有真数据→填；非空→不动**）→ iframe 侧同族副本一并兜底（否则就是 L61 的假修）。
**一个被单测当场抓住的设计缺陷**：首版「只种不覆盖」会让**真数据永远进不来**
（门面常先以空壳构建、把 `regex` 种成 `[]`）→ 改为「空数组且有真数据→填充」。

### ③ D-5b（T-09/T-53）—— 按拍板**选 B：不清洗**，本项关闭

真脏 83 条 / 13 会话，但**修复已生效（23.3 小时零新增）**，残留纯属存量、只影响旧会话观感。
清洗属不可逆写入，收益不成比例 → 关闭。

### ④ 顺手收口 T-58：**原描述与代码相反** —— 「以为缺门槛，其实门槛有 6 份、测试只有 1 份」

心跳 57 判定「`session-regenerate`/`session-rollback` 的非 live 分支是破坏性截断、缺门槛」。
心跳 58 逐行核对源码：**三处非 live 分支本就都有 409 硬拒收**（RP 侧 3 + undo 插件 3，共 6 份逐字复制）。
**方向恰好相反**——被拒的是 **live**（会话开着），能改盘的是 **非 live**（会话关着）；
`st-1w8aglg` 被截断，正因为**它当时没打开**，那是**设计语义**（内存态权威）。

**真缺口（已修）**：该判据 **6 份复制、单测只覆盖 1 份**（undo 那份），RP 侧三处零覆盖 ——
**这正是误判的土壤**（读代码时容易把「live 被拒」看成「非 live 能改盘」的漏洞）。
已收敛为单源 `canSurgicallyTruncate(isLive, action)` + 补 4 条测试（含**三动作文案互不相同**这条承重断言）+ 反控（恒放行 → 3 红）。

### ⑤ 一个新发现的**同名不同根**陷阱（本轮最值得记的一条）

同一处报错（`updateSTRegexes` 中断）背后有**两个独立的根**，且**修掉一个不会让另一个消失**：
`/version` 缺失致版本分叉走错（心跳 57 修）**与** `extension_settings.regex` 缺席（心跳 58 修）。
心跳 57 因为「修完 /version 后报错消失了」就宣布 T-42 收口 —— 那是**在只跑旧版路径的条件下**观察到的。
**教训**：宣布一条链修好之前，必须问「这条链上还有几个**独立**的前提」。

### ⑥ 验收

`typecheck` 三段式 **0 错** · 单测 **51 文件 / 1078 全绿**（+17 → 本轮末 +4 补测）·
**三处反控全部成立**（T-42 停用 seed → 6 红；D-6 恒不修剪 → 1 红；D-6 只清 tools → 2 红）。

✅ **两项均已在 `emulator-5554` 上实机验证通过**（热推 `dsht-rp-plugin` 双副本 + 重启）：

| 项 | 判据 | 实测 |
|---|---|---|
| **D-6** | 请求体无 `tools` 字段 | 新 dump `llm-224.json` → `keys = model, messages, stream, stream_options, max_tokens, temperature, thinking`，**无 `tools`**；logcat `D-6 工具修剪：移除 32 个工具定义（path=direct）`（发送前 seq=223 → 后 224，确为本次请求） |
| **T-42** | `extensions.regex.length` 可读 | 宿主帧实测 **1**（修复前该变量 `undefined`）；`Array.isArray=true`；首元素是真数据（`rp/regex/global.json` 的全局正则，ST camelCase 13 键）；反控：无键对象 → `THROW: …reading 'length'`（**与卡原报错逐字同形**），有键 → OK，跑完真实对象未被改动 |

## 心跳 56 做了什么（**继续逐条核验 ✅ 声明，并把「核验结论」落成可复跑的判据**）

> 一句话：按完成审计标准继续核验已打 ✅ 的项，把「我读过了、看着没问题」升级成
> 「有测试固化 / 有脚本可复跑 / 有正控证明判据承重」。

### 1. T-29（EJS 完整语法）—— 结论成立，但**原先没有一条测试**支撑

- **声称**：subset 对 4 类不支持语法「显式抛错而非静默失败」；`engine:'sandbox'` 支持完整 JS。
- **实测缺口**：`prompt-template.spec.ts` 只有一条笼统的「不支持的语句抛渲染错误」；
  沙箱侧 **模板字符串 / 正则字面量 / 模板内定义函数 / 内建 Math** 四类**均无断言**
  （grep 证据：spec 里只有 1 处箭头函数用例）。即**声称的行为无固化，改坏了不会红**。
- ✅ **补测试 10 条**（先核实现、再写断言，不是照抄文档）：
  - subset 4 类不支持语法各 1 条（函数调用 / 箭头 / 模板串 / 正则字面量）→ 断言**具体报错文案**
    （`trailing tokens` / `unexpected char` / `unexpected token`）；
  - `renderMessages` fail-soft 1 条：**保留原文 + `ejsError` 标记 + `rendered:1 / skipped:1`**；
  - 沙箱 5 条：模板字符串 / 正则字面量 / 模板内定义函数 / `Math.max` / **vm 函数不可克隆边界**。
- **顺带核实「不静默」在生产真的成立**：`dsh-plugin/index.ts:3982` 取 `r.messages[k]?.mes`
  → fail-soft 时拿到的是**原文**（不是空串），确认「正文被静默清空」这条旧缺陷不会以新形态回来。

### 2. 本轮核验通过（只读，未改）的 ✅ 项 —— 证据载体逐条落地核实

| 项 | 核验方式 | 结果 |
|---|---|---|
| T-32 | 读 `references/session-jsonl-contract.md` | 确实已改为「user 标记 replace + append」，`startSeq/endSeq` 字段名已写明，旧写法有明确禁令 |
| T-37 / T-40 / T-41 | `host-vendor.ts` / `st-event-types.gen.ts` / `th-event-source.ts` 均存在 | 通过 |
| T-44 | **实跑** `node scripts/audit-card-context-surface.mjs --selftest` | `PASS`（简写属性 / 嵌套括号 / 字符串与注释内逗号全覆盖） |
| T-55 | **实跑** `node scripts/audit-method-binding.mjs` | `PASS`：82 个 `.ts` / 99 条候选 / **高危 0** |
| T-23 / T-24 | `stage4-regression.mjs` 存在 | 通过（**21/21 的活设备实测已在前面心跳完成，本轮不重复跑设备**） |
| T-50 / T-51 / T-54 | 对应单测文件存在（`time-zone.spec.ts` / `session-repair.spec.ts` / `session-generation.spec.ts`） | 通过 |
| 度量 | **实跑** `evaluate.sh`（须走 Git Bash，PowerShell 直调回 0） | **5/5** |

### 3. 顺手补掉 T-54 静态闸门自己的覆盖盲区（**闸门只能照出它写得出来的形态**）

心跳 55 修的绑定缺陷配了三重防线，其中第一道是静态闸门 `audit-method-binding.mjs`。
本轮审计这条闸门**自己**时发现：它的正则要求右侧是**纯标识符链**，于是

```
const append = (session as { append?: … }).append     ← 带类型断言
const onEvt  = emitter!.on                            ← 带非空断言
const flush  = (sessions).flush                       ← 带括号包裹
```

三种包装**一条都报不出来**（正控实测 NO-MATCH）—— 而它们的 `this` 一样会丢，
**正是心跳 47 那个把两个功能打死 8 个心跳的写法**。

| 动作 | 结果 |
|---|---|
| 复查全仓 | 3 处真实提取（`dsh-plugin:294` `flush` / `prompt-template:293` `eventAt` / `:301` `append`） |
| 它们的实际行为 | **本正确**（都手动 `.call(recv, …)` 绑定了接收者）—— 属**形态风险**，非现网缺陷 |
| 修闸门 | 新增 `parseExtraction()`（宽松抓 + 剥包层），自检扩为**四控**（正/负/零/**包装控**）；候选 **99 → 135 条** |
| 修源码 | 3 处全部改为**在访问点直接调用**（按脚本自带纪律：「别往 ALLOW 里加，改写法」） |
| 终态 | 自检四控全 `[ok]` · 审计 `PASS`（83 个 `.ts` / 135 条候选 / **高危 0**） |

**一般规则（L44 家族又一例）**：闸门的覆盖面 = 它那条正则能表达的语言。
**新写一种"等价但不同形态"的代码，就可能绕过闸门**——所以闸门本身也要有正控，
且正控要覆盖**同义异形**的写法。

### 4. 验收

三闸门 `typecheck` **0 错**（core / ui / tests 三段）· 单测 **51 文件 / 1054 全绿** ·
`evaluate.sh` **5/5** · 审计自检四控全过 · 绑定审计 **高危 0**。

**纪律（本轮唯一新增）**：✅ 的含义应当能被审计 —— 只有「有断言 / 有脚本 / 有正控」的 ✅ 才算数；
「读了一遍觉得对」不是完成证据。**防线自己也要被审**：闸门的正控必须覆盖同义异形的写法。

## 心跳 55 做了什么（**一个"写法"问题，把两个功能打死了 8 个心跳 —— 而且三道既有闸门全是绿的**）

> 一句话：**「重新生成」和「回退到此处」两条写入路径，从心跳 47 起就一直报错、一个字都写不进去**，
> 而我之前的三道闸门（类型检查 / 1024 条单测 / 21 项设备回归）**全都照不出它**。

### 1. 你看到的现象

点「↻ 重新生成」→ 确认 → 弹红字 `重新生成失败：Cannot read properties of undefined (reading 'log')`。
「↩ 回退到此处」同病。**功能完全不可用，且不写任何数据**（会话文件 md5 一字未变）。

### 2. 根因：一次"纯类型层"重写，改了运行时的调用形态

- 官方 `Session` 的方法都是「实例字段 + `this`」写法（`dsh-session/lib/index.js:457 this.log = log`、
  `:1075 this.log.push(...)`）。
- **心跳 47** 为绕开两个 TypeScript 收窄告警，把 `live.append(...)` 改写成
  `const liveAppend = live.append` + `liveAppend(...)`，注释还写着「**纯类型层修正，运行时语义不变**」。
- 实际是**语义变更**：方法引用被"提取"出来后 `this` 就丢了 → 一经调用必抛「读 `this.log`」。
  **`tsc` 全绿、单测全绿、构建全绿**，但功能从那一刻起死了。

### 3. 怎么定位的（没有重建 APK，一次离线运行就锁定）

把设备报错**原文**当成"指纹"：离线用官方 `Session` 造同形对象，逐条逼近路由的调用序列，
直到打印出的报错**逐字相同**；再做一次决定性对照 —— **绑定调用 `[ok]` / 提取后调用 `[THROW]`**。
（差点走错的弯路：先 grep 自己源码里的 `.log` 读取 → 0 处 → 差点结论"不是我们的代码"。
实际是**官方代码**在读 `this.log`，因为 `this` 被我们弄丢了。）

### 4. 修法与三条防线

| 防线 | 内容 |
|---|---|
| 单源出口 | 新增 `boundAppend()` —— 凡要把官方会话方法存进变量，一律经它（带完整成因注释） |
| 静态闸门 | 新增 `scripts/audit-method-binding.mjs` —— 扫全仓 `const X = recv.member`，命中「靠 this 的成员名」即报警；**自己先过正控/负控/零控**（扫 82 个 `.ts` / 99 条候选 / 高危 0） |
| 运行时负控 | 单测断言：**裸提取必炸、报错与设备逐字相同、且零写入** |

### 5. 实机验收（**在副本上跑真写**，取证后完整还原）

| 路由 | 修复前 | 修复后 |
|---|---|---|
| `/rp/session-regenerate` | 500 + 零写入 | **200** `{"logical":true,"replaced":6,…}`，落盘 314→316 行 |
| `/rp/session-rollback` | 500 + 零写入 | **200** `{"logical":true,"replaced":6,"truncatedTo":302}`，落盘 314→316 行 |

三件物证齐（HTTP 正文 + 落盘 md5/行数/新事件 + logcat 成功日志），且 logcat 的
`anchor=302 replace[303,309] n=6` 与离线复现**逐字一致**；取证后已把会话文件**精确还原**
（md5 回到 `04eacf…` / 314 行 / 临时 `.bak` 已删 / 重启对齐内存态）。

### 6. 一条要记住的纪律（本轮代价 = 8 个心跳）

心跳 54 的 UI 面回归用「**md5 不变**」当验收判据（为了不动你的数据）——它**保护了数据**，
但同时也**掩盖了写侧已死**（当时还写了「0 异常」的绿色结论）。
**今后：读侧全绿的功能，必须再配一条"在副本上跑真写"的用例。**

### 7. 验收 / 交付

三闸门 `typecheck` **0 错** · 单测 **50 文件 / 1024 全绿**（+2）· 审计自检 PASS ·
双架构 APK **x86_64 debug（196,836,000 B）/ arm64 release（128,362,024 B）**，
两个包内 `assets/dsh-runtime.zip` 的插件均核出 `boundAppend`×3、且**负控**（旧写法）为 0 命中。
`stage4-regression` **21/21**（与基线一致 = 无回归）；路由契约 67/0 · vendor 依赖 5/5 · 补丁标记 19/19。

### 8. 顺手拆掉一处「闸门自己在说谎」

跑既有静态闸门复检时发现 `apply-platform-patches.py --check` **会把"补丁丢了"读成"一切正常"**：
它在 marker 缺失时退回「锚点正则命中数 == 期望」判定并打 ✓，而 **F2（flock 单进程直通，
它决定"消息到底能不能发出去"）** 的锚点**在补丁前后都存在** → **抹掉 marker 后仍报
「✓ 期望 1 处，实际 1 处」、汇总「0 项失败」、exit 0**（已用正控实证）。
也就是说：`npm install` 把 `flock.js` 还原成原版之后，**所有静态闸门都会是绿的**，而上线即"一条消息都发不出去"。

已改为**三态显式分账**（不让它们共用一个 ✓）：

| 状态 | 判据 | 含义 |
|---|---|---|
| 已打补丁 | marker 命中 | **确实生效** |
| 未打可打 | 锚点命中但 marker 缺失 | **尚未打**（apply 模式会补上） |
| 失败 | 锚点形态不符 | 目标不存在 / 半打 / DSH 升级后形态变了 |

汇总从「N 项检查，M 项失败」变成「**已打补丁 N，未打可打 M，跳过 K，失败 F**」，
`未打可打 > 0` 时再打一行 ⚠。顺带修掉「健康树上汇总恒为 `0 项检查`」（与明细行自相矛盾）。
**正控已验**：抹掉 F2 marker → 「已打 19 / 未打 0」变「已打 18 / 未打 1」+ ⚠ 行；还原后复原。
**一般规则**：判「某个改写是否生效」必须看「**改写引入的新东西在不在**」，
不能看「原文里的东西还在不在」——**锚点只能判"可打"，不能判"已打"**。

另外：本轮新增的绑定审计已接进构建预检（**A7 断言**：先跑自检，再跑审计），
负控实证「注入一处 detach → exit 1 且精确报出 5413 行」。

---

## 心跳 53 做了什么（**回头审「已修」标记本身 —— 7 项里 6 项标记不成立**）

> 一句话：这一轮没有去找新 bug，而是按「完成审计」的要求**回头核验已经打了 ✅ 的项**，
> 结果 §4 兼容面 7 项里 **6 项的 ✅ 与代码现状不符**。全部已真修 + 补反控。

| # | 项 | ✅ 原本声称 | 实测现状 |
|---|---|---|---|
| 1 | **T-16** | 枚举已纠正 | 枚举**一直是反的**（写 1→转义 / 2→不转义；基准 `substitute_find_regex` = `{NONE:0, RAW:1, ESCAPED:2}`）；且 `ctx.substituteRegex` 回调**从未被任何调用方注入** = 模式 1/2 全程死代码 |
| 2 | **T-17** | `$1/$<name>` 已修 | 只落了 `$1..$99` 数字组，`$<name>` **从未实现**（而头注释一直声称支持）→ 具名组字面残留 |
| 3 | **T-18** | 已改 `/gi` | 只改到 `th-shim` 同步路径，**主引擎一直是 `/g`**；同条的 R4（trimStrings 作用点）也仍是替换后整串，与基准 `filterString` 不符 |
| 4 | **T-19** | 直调 `state/mvu.ts`（同源） | `th-shim.ts` 是**构建期注入的字符串、没有 import 能力** → 实为自写简化副本（只认 JSONPatch，缺 initvar/_.set，且抄了早已修掉的 `.match()` 单块缺陷） |
| 5 | **T-22** | `setglobalvar` 宏族已修 | 只落了**斜杠形态**（`/setglobalvar`）；真卡（ExampleGame 等）用的**宏形态** `{{setglobalvar::…}}` **完全没有** → 整串当未知宏留在提示词且变量从不写入 |
| 6 | **T-21** | 三字段透传已补 | **漏两项**：① `delete_occurred` **值**补对了但**路径口径**没跟上（判存只按 `.` 切，host 用 lodash 路径 → `a.list[0]` 恒判"不存在" → 该字段永远是 `false`）；② `display_index`（LorebookEntry 契约**必填**）**从未产出** → 卡读它恒 `undefined` |

**共同成因（沉淀 LEARNINGS L61）**：六条里四条是「同一语义存在多份副本，只改了其中一份」
（`engine.ts` / `display-compiler.ts` / `th-shim.ts` / `lib/*.js` 产物）；其余是「注释声称了
机制上不可能的事」「字段补了一半（值 vs 路径口径）」「数据全为默认值掩盖了实现错误」
（实测 2 份真实 settings：`substituteRegex` 分布 `{"0":9}` / `{"0":21}`，`trimStrings` 非空 0 条
—— 所以这些字段的缺陷长期不暴露）。

**修与验**：
- 六条全部真修；新增/重写测试 **41 条**（含跨模块**差分断言**：shim 的 `Mvu.parseMessage`
  ≡ `state/mvu.ts` 的 `parseUpdateVariable`，把"两侧手工同步"的硬约束用断言锁住，而非靠注释声称）。
- **每条都做了反控**（stash 源码 → 用例必须转红）：T-16 5 红 / T-17 2 红 / T-18 5 红 /
  T-19 5 红 / T-22 5 红 / T-21 1+5 红 —— 全部成立。
- **推翻一条被固化的错期望**（L50/L58 第三例）：原测例「`{{match}}` 引用与 trimStrings」
  断言的正是缺陷行为，已按基准重写。
- 单测 **971 → 1027**；三闸门 `typecheck` **0 错**；产物已重建（含两条注入期转义错误修正，
  沉淀 **L70**：shim 模板串里的正则/反引号必须双重转义，本轮为此踩坑三次）。
- T-20 的 ✅ 核验为**真**（`th-regex-contract.spec.ts` 逐字段断言），未动。

## 心跳 54 做了什么（**阶段二长尾「UI 面」逐项走通 + 把 D-5b 从「待拍板」变成「有数字可拍板」**）

> 一句话：这一轮把「**用户真正会点的那些按钮**」逐个点了一遍（不只看数据面接口），
> 并把登记了很久的 D-5b 从一句「建议先出只读报告」变成**带精确数字、带"修复是否生效"证据**的可决策项。

### ① UI 面五项逐项走通（全程零写入）

判据：**动作前后 3 个落盘文件 md5 完全一致**（RP state / state.undo / `session.v3.jsonl`），
且全程捕获 `Runtime.exceptionThrown` + `console.error/warning` → **未捕获异常 / console 错误 = 0**。

| 项 | 结果 | 关键证据 |
|---|---|---|
| **编辑** | ✅ 入口在、可就地编辑、取消可还原 | 点 `[data-testid=dsht-rp-edit]` → `textarea` **预填原文**（`len=55`）→ 取消 → `floors` 27→27、`openError=false` |
| **回退** | ✅ 入口在、语义完整 | 点 `↩ 回退到此处` → **原生确认框**文案「…原文放回输入框（**事件仍保留在日志；状态/变量一并回滚**）」→ CANCEL → 27→27、composer 空 |
| **变体** | ⚠️ 契约通、当前无数据 | `/dsht-rp/variant/groups` **POST → 200 `{"groups":[]}`**；当前 0 组 → 界面按设计不渲染变体条（**切换的端到端需 ≥2 变体，登记未覆盖**） |
| **世界书** | ✅ 面板可开、数据在 | 三 tab（角色版本 / 剧情控制 / 梗概控制）+ `自动:ON`；`/rp/books` → `entryCount` 35 + 35 |
| **MVU** | ✅ 变量桥活、面板在 | `/dsht-tavern-helper/variables?scope=chat&sessionId=…` **200 / 21 键**（`stat_data._storyState`、`指令.{推进剧情,跳转版本,…}`） |

**同批 `stage4-regression` 首次 21/21 全过** —— 长期悬置的 20/21（唯一失败 = `variant/groups` 需 UI attach 会话）
随会话 attach 而闭合。**⚠️ 探针自身踩坑（非产品缺陷）**：点「回退」弹出的**原生** AlertDialog
会**同步阻塞 WebView JS 线程** → `Runtime.evaluate` 一并挂住（实测挂 2m32s）→ UI 自动化必须在**点开前预置自动应答**。
**另一次自纠口径**：探 `/rp/variant/groups` 得 404/405，差点判「契约违约」；实为**前缀口径错**
（真实前缀是 `/dsht-rp/*`，见 `rpc.ts:58-65` 的 `rpApi`）。

### ② D-5b「存量脏楼层」只读报告（新工具 `scripts/audit-dirty-floors.mjs`）

**关键设计**：**不数原始事件**，走**官方 0.1.5 迁移链 + `foldSurface`** 还原 surface 视图。
理由：单文件实测 **382 条 `compaction/prune`**，直接数事件会把污染面**大幅高估** → 决策依据失真。
分类**复用既有 `classify()`**（`tt-projection.ts:89`，判据全部来自 golden 取证），**不自造第二套**。

**首版口径过宽，已自纠**（L44 同型）：只按「含 `<interactive_input>`」计数得 118 条"真脏"，
其中 **35 条其实是设计用途快照**（`system-level` 23 / `runtime-ctx` 11 / `skill-list` 1）
→ 本版强制 `--selftest` **6/6**（含 3 条"设计用途"负控）才允许出数。

**最终数字**（82 会话 / **1515** 条 append-origin `user/message`，扫描 82/82 失败 0）：

| 档 | 条数 | 是否风险 |
|---|---|---|
| ① `user-input` 被 `<interactive_input>` 包装（**真脏**） | **83** | 🔴 |
| ② 其中 `$1` 字面残留 | **62** | 🔴（原输入已被字面 `$1` 顶掉） |
| ③ 其中嵌套包装（≥2 次） | **1** | 🔴（二次写回痕迹） |
| ④ 设计用途快照包裹（`.snapshot`） | 35 | ✅ 非脏 |
| ⑤ assistant 正文提及该标签（模型在"谈论"） | 192 | ✅ 非脏 |
| **受影响会话** | **13** 个 | — |

**修复生效性（时间分桶钉死）**：被包装消息时间上界 = **2026-09-10 08:53 UTC**；
全量消息时间上界 = **2026-09-11 08:12 UTC** → **间隔 23.3 小时零新增污染**
⇒ 源侧修复（`promptOnly` 正则推迟到 `llm/stream`，不落盘）**已生效，残留纯属存量**。

**顺带推翻一个"看着像新缺陷"的东西**：编辑面板预填带包装的原文 —— 对质后确认
**编辑面板忠实显示 `mes` 存储值 = 基线语义**（ST 编辑亦显示原始 `mes`），且**修复后的新消息不再带包装**
→ 属 **D-5b 的下游症状，不是独立缺陷**（不登记新条目，避免造出假待办）。

## 心跳 53 · 实例B 做了什么（**第一次拿"安装包 + 真机路径"当验收面，立刻挖出两个静默缺陷**）

> 一句话：前面几轮的验收面是「源码 → 单测 → 探针」，这轮把验收面下移到**用户真正经历的路径**
> （`adb install -r` 后连着冷启动），两个缺陷都**不抛错、不返非 200、日志要么没有要么说"一切正常"** ——
> 典型静默失败族，且**都只在"安装/重启那一下"暴露**，常规回归跑不到。

| # | 项 | 症状 | 根因（file:line） | 修与验 |
|---|---|---|---|---|
| 1 | 🔴→✅ **T-45：主框架加载失败后无自愈 → 永久停在启动屏** | `adb install -r` 后立即 `force-stop + start`，约 1/3 概率 WebView 停在 `Webpage not available`。诊断屏**每行都是绿的**（`端口 3080：已开放 ✓ / web 令牌：已捕获 ✓`）而页面是死的 | `MainActivity.diagPoller` 唯一的重载分支要求 `tok != lastTokenAttempt`；主框架加载失败（401 / `net::ERR_UNSAFE_PORT` / 启动竞态）时**令牌根本不变 → 没有任何分支匹配 → 永不重载** | 加**带预算的重载分支**（3s × 20 次，端口 0→1 或令牌变化时重置预算，重载目标取 `bootUrl` 而非 `webView.url`）+ 启动屏**进度行**（L42 扩到 UI：有意停手也要出声）。**设备实证**：日志链 `main-frame error -1 net::ERR_UNSAFE_PORT` → `main-frame load failed → reload (attempt 1/20)`，**7 秒自愈，连跑 3 次全 PASS** |
| 2 | 🔴→✅ **T-51：每次冷启动重写全部会话（2MB 无效写入 + 2MB 备份）** | 每次冷启动都写 `repair-sessions(v3): … shadowedSeqs 重排（去重+升序）… 对齐实际 surface 切片` 且 `repaired=1`；但 `session.v3.jsonl` 与它的 `.bak` **md5 完全相同**（`37562b17…`，各 2,076,005 B）→ 内容零变化的重写 | **两步互为反向归一化**：`fixPrune` 按**数值升序**排序，`fixPruneSurfaceSpans` 又把顺序**还原成 surface 切片序** → 净变化为零，但 `changed` 恒 `true`。**且这是在"验证收敛"的判据下活的**（判据只看"改完还合不合规"，不看"改动是否为零"） | `fixPrune` 改用**保序去重** `uniqueStable()`（`:320` 的引用重映射同步换掉）。**三层证明**：① 离线精确复现（`repair-chain.mjs`：修前 `changed=true` 且 `content === input`、二跑仍 true；修后完全收敛）；② 单测**正控**（回退源码 → 1 红 / 恢复 → 27 全绿，并**删掉一条把缺陷钉成期望值的旧断言** `expect(shadowedSeqs).toEqual([...].sort())`）；③ 判据 6 正控（HEAD → `每次启动会重写 1`；修复后 → `0`）。**设备闭环**：装机后**连续两次冷启动都 `repaired=0 skipped=1`**，会话文件 mtime 不动 |

**同轮最强判据（设备全树，非单点）**：`adb pull` 全量 **82 会话 / 200MB** → `verify-session-pipeline`
**七项判据全过**：可迁移 82/82 · 内容丢失 0 · 非幂等 0 · 身份漂移 0 · **每次启动会重写 0** · 运行时拒载 0。

**验收面本身也补了一格**（L30 家族第 4 例）：新增设备探针 `hb53-loadfail-recover.mjs`（把 WebView 导航到
`http://127.0.0.1:1/` 制造主框架失败，轮询 `/json` 的 `url` 是否回到 3080）—— 此前**没有任何探针**覆盖
「主框架失败后能不能回来」这条路径，所以 T-45 才能在源码里潜伏多轮。

**交付**：x86_64 debug **v263**（196,831,981 B，已装机）· arm64 release **v264**（128,358,004 B）；
两个 APK 的 dex 与 `assets/dsh-runtime.zip` 载荷标记均核验（哨兵 + `uniqueStable` ×3、旧提示语 0 命中）。
**闸门**：`typecheck` 三段式 **0 错** · 单测 **1013/1013（50 文件）** · `stage4-regression` **20/21**（与基线逐项一致）。

**顺带定性**：T-46（iframe 门面缺口）静态排查完成 —— 证明脚本 iframe 是 `srcdoc` + `allow-same-origin`
（`RpScriptHost.tsx:469-482`）即**同源**，宿主门面提供者**均为同步函数**，`runtimeFor()` 保持单活动运行时
（`:1121-1133`）→ **16 个缺口里 15 个可靠"同源同步转发"补齐**（单源，不新造第二套宏引擎）；
仅 `renderExtensionTemplateAsync` 真缺数据模型（挂到 T-42）。触发条件（iframe 内报错）当前未出现 → 仍列决策项。

## 心跳 47 做了什么（**把闸门的「覆盖范围」打开，一次抓出 5 个"从未生效"的功能**）

> 一句话：**不是又修了一个 bug，是把"能发现 bug 的能力"装到了以前没有防线的那一层。**
> 上轮把类型闸门从「2546 个错误 = 恒红 = 没有门」修成「核心逻辑层 0 错误」。这轮把闸门的 `include`
> 扩到**插件入口层**（6 个目录），立刻从 0 错变 70 错 —— 清完之后，**5 个"调用点在、定义不在"的函数**浮出水面。

| # | 结论 | 证据 |
|---|---|---|
| 1 | 🔴 **表记忆的服务端侧从未工作过** —— `loadSheets` / `renderTablePrompt` / `expandTableMacros` 三个函数被调用，但 import 早在一次重构里被删掉，**所有调用点都包在空 catch 或"非阻塞"catch 里** | 构建产物 `dsht-rp-plugin/lib/index.js` 里三个名字全是**调用点、零定义**；`git log -S` 定位到重构 `3651508` |
| 2 | 🔴 **MVU 初始变量从未工作过** —— `deepMergeInitVars` 被调用，但 `git log -S` 证明**任何 commit 里都不存在这个函数**，是 day-one 的 `ReferenceError` | 同上；表现为"MVU 初始值没生效"，不抛错、不返错 |
| 3 | 🔴 **EJS `<% %>` 楼层正文被静默清空** —— 子集引擎 `renderMessages` 返回的是 `{messages, rendered, skipped}` 对象，调用点却把它整个塞进 `messages` 字段 → 取 `messages[k].mes` 永远 `undefined` → **正文变空，还被持久化写回会话** | 类型闸门报 TS7053；已补 5 条形状契约测试钉死这个"事故判据" |
| 4 | 🟠 另有 3 处是**用类型把错误盖过去**而不是修好：`as typeof ev`（初始化式里 `typeof` 读到已窄化的 `null` → 变量流类型塌成 `never` → 后续访问全部免检）、`atomicWrite` 第三实参被静默丢弃 ×13、接口形状写错用强转绕开 ×5 | 见 LEARNINGS **L27** |
| 5 | ✅ **两道类型闸门现在都是真闸门**：`typecheck:core` **0 错**、`typecheck:ui` **0 错**，且**都跑过正控**（注入已知错误确认会 report） | `npm run typecheck` 现在 = 双 0 错；UI 层原来说"缺 `@types/react`"是**误判**，真阻塞是两个宿主 shell 模块没类型声明 |
| 6 | 🔴 **构建链第 ⑩ 类断链**：构建期 vendor 依赖（jquery 等 5 个）**不在 package.json**，靠手工 `npm --no-save` 装 → 别人跑一次 `pnpm install` 全被剪掉 → 构建报 `Could not resolve "jquery"`，**且报错行指向仓库里根本不存在的虚拟文件名** | 已建 `scripts/vendor-deps.json`（锚定表）+ `scripts/vendor-deps.mjs`（自愈预检，接入构建，正/负控均过） |
| 7 | 🔴 平台补丁 Step 3a **删自己刚落下的 stub 再重建**（非幂等 churn）→ 撞宿主安全删除守卫使构建 FATAL；且 `ignore_errors=True` 把「被拦」静默报成「已删 1 个」 | 已修：认领自有 stub 后跳过 + 删完断言真的不在了；build-wb.sh 也把「删除预算耗尽」与「产物形态变了」区分开 |
| 8 | 🔴 **最严重的一条：我们自己的"会话修复器"把可读会话改成了不可读**。用户在用的那个会话**打不开**（UI 红字 `Failed to load history: … corrupt: format v3 system/message at seq 21 requires exact replace fields op/startSeq/endSeq`）。根因：`session-repair.ts` **无条件**写 v2 字段名 `{op,start,end}`，而调用点**不看 `header.version`** → 把已经是 v3 的会话写成 v3 读不了的形状；**修复器每次启动都跑 → 修一次坏一次，会自我扩散** | 官方迁移器**会**改名（`dsh-session-format-v2-to-v3/lib/index.js:353-367`）；我们没跟上。已修（按 `header.version` 分叉 + 自愈判据 + 5 回归 + 负控）。**设备实证**：`repair-sessions(v3): … 改写为 startSeq/endSeq` → `repaired=1 errors=0` → 该文件 `startSeq=26 / v2 式 = 0` + `.bak` 已留 → **UI 报错消失、会话正常打开** |
| 9 | 🟠 上面这条**此前漏网**的原因值得单独记住：阶段 3 的判据用 `foldSurface`，它是**兼容读取器**（两代字段名都认），比运行时加载会话日志用的**严格校验器**宽松 → **验证读侧 ≠ 运行时读侧**，防线在"真读"那一步是空的 | 见 LEARNINGS **L30**（含元教训：修数据的工具必须按代次分叉；修复类改动必须断言"修完还能不能被读"） |
| 10 | 🟠 **TH 宿主全局面还缺 `Vue` / `SillyTavern`**：卡脚本抛 `Uncaught ReferenceError`，并进入**每秒重跑的注册循环**（`[🦊][狐裁] 独立拦截器已注册` 每 2s、`[StoryCtrl] 状态变更…` 每 1s），logcat 被刷成主噪音 | 已记 T-37 + LEARNINGS **L31**。判据：脚本"反复重注册才算成功" = 上一次没真正生效 = 静默失败形态 |
| 11 | ✅ **发消息端到端的真实阻塞已定位并排除**（上轮遗留的"能不能发出去"）：app 确实发出请求，`outbound fetch 失败 :: ECONNREFUSED 10.0.2.2:31101` —— 配置里的 provider 指向本地 mock，当时没起。起 mock 后请求正常落到 mock（新增 `MOCK_DUMP` 落盘真实出站 payload，31KB 实测快照存 `stage3-device/heartbeat47/`） | 设备日志 + `stage3-device/heartbeat47/outbound.sample.json` |
| 12 | 🔴 **审计发现：T-02「阶段 3 迁移验证」的原证据是循环论证** —— `.stage3-pass` 引用的判据日志写着「**修复前**可迁移 80/80 / 本次救回 0」：判据跑在**已经修好的树**上，等于什么都没测。数字指纹：该日志 198.1MB，而真·迁移前树是 151.0MB | 对真基线树重跑 → **39/80 → 80/80，救回 41**（151.0MB / 11.7s）；日志已按新口径重写 |
| 13 | 🔴 **同一次审计发现：离线验证脚本漏了运行时的一步** —— 脚本自述"逐字复刻设备三步链"，实际是**四步**；漏掉的第 4 步 `repairSessionCwds`（相对 cwd → 绝对 **+ 目录改名**）恰是 `dsht-welcome`（cwd=`rp/_start` 相对路径）唯一需要的那步 → 脚本报 **79/80**，而设备上它是好的 | 补第 4 步后 80/80；**负控**：关掉它 → 精确重现 79/80（证明该步承重、闸门非空转）。元教训见 LEARNINGS **L32**：**验证强度 = min(输入是否真·未处理, 复刻是否真·等价)**，且走样方向**总是让结果变好看** |

**交付**：双架构 APK 重打（x86_64 debug **sentinel v231** + arm64 release **sentinel v232**），**843 单测全绿**，
新增 19 条回归测试；`npm run typecheck`（core+ui）**双 0 错**；设备侧 `stage4-regression` **20/21**（唯一失败=探针未 attach）、
路由契约 **67 路由 0 违约**、损坏会话**已自愈且 UI 症状消失**。

## 心跳 48 做了什么（**把卡脚本的「宿主全局面」一道道拆开——三道墙，全是静默失败**）

> 一句话：**不是修了三个 bug，是把一个"整段脚本作废"的故障拆成了可递进的证明链。**
> 方法上最有价值的一条：**验收不看"错误是否消失"，看"错误是否往深处移"** —— 行号前移就证明
> 前一道墙真的被拆掉了（而不是脚本压根没跑到那儿）。这条已固化为 LEARNINGS **L35**。

| # | 结论 | 证据 |
|---|---|---|
| 1 | 🔴→✅ **第一道墙：宿主页没有 `SillyTavern` 全局** —— 卡的 220KB 外链注入脚本首行就 `SillyTavern.getContext()`，`ReferenceError` 让**整段作废**（脚本内取用 11 处）。真 ST 宿主页有（`script.js:292`「API OBJECT FOR EXTERNAL WIRING」） | 设备宿主帧 `sillyKeys=null` → 修后 `["libs","getContext"]`，与真 ST **逐字同形** |
| 2 | 🔴→✅ **第二道墙：`ctx.eventSource` 缺 `.on`** —— 补上第一道墙后**同一脚本推进 2190 行**，改死在 `:2245`（全篇 `eventSource` 27 处 = 它的事件挂载总入口）。这是「错误往深处移」第一次实证 | 已修；+16 测试，**负控**：去掉幂等 → 2 条立刻失败 |
| 3 | 🔴→✅ **第三道墙：`ctx.eventTypes` 缺失** —— 再补完，错误**再往前推**到 `:493`。**最关键的一条认知**：源码写着 `ctx.eventTypes.OAI_PRESET_IMPORT_READY \|\| 'oai_preset_import_ready'`，**看似有兜底，兜底路径不可达** —— 因为 `undefined` 上的**属性访问先抛 TypeError**，右侧字面量永远轮不到。→ 所以「给个空对象」也不够，**必须真给这张表** | 见下方「做法」 |
| 4 | ⚠️→❌ **`Vue is not defined` 判定为「与 TT 同等行为」，有意不改** —— 长相和 #1 一模一样，结论相反。三问核验：① 基准上有吗？**没有**（ST/TT 全仓 `grep "window.Vue="` **0 命中**）② 报错在哪一侧？**脚本帧**、栈顶是卡自带的 CDN `vue-router.global.prod.min.js:12` ③ 基准会不会同报？**会**。→ 补 Vue 反而**造出与基准的差异**。这是 L36 的实例：**验收基准是"三方一致"，不是"比它更强"** | 按 L36 三问执行，结论=不改 |
| 5 | ✅ **类型闸门补上第三层：`tests` 层此前从未被检查** —— `tsconfig.json` 的 `exclude` 里有 `tests` → **46 个 spec 文件从未进过闸门**（`core`/`ui` 都覆盖不到）。这是「验证读侧 ≠ 运行时读侧」的又一实例（与 L30 同源） | 新增 `tsconfig.tests.json` + `typecheck:tests`；首开即抓 **15 处** |
| 6 | 🔴 **闸门首开抓出的一类最隐蔽问题：一行「永远通过的假绿测试」** —— `expect(subset.ok === undefined \|\| subset.ok).toBeTruthy()`，而 `subset` 引擎的原始返回**根本没有 `ok` 字段** → 该断言恒真。**断言写的是"我以为的返回形状"，不是"实际行为"** | 同批还有 `makeDeps()` **静默少 14 个桥依赖**（改为显式抛错桩，禁止「没覆盖」伪装成「通过了」） |

| 7 | 🔴→✅ **我方自己加的校验在阻断卡脚本**（T-41）：三道墙补齐后卡再往深处走，抛 `Error: 既有变量与 schema 不匹配` —— 来源是**我方 facade 的 422**，不是基准要求。**基准对质**：真 TH `registerVariableSchema` 是**纯 setter**（`JS-Slash-Runner/src/function/variables.ts:10-37` 只做 `store.<scope> = schema`），校验只发生在**变量管理器面板渲染**时（`CHANGELOG.md:710` 原话是「**提示**错误信息」）。我把校验放在**写入层**（拒收）而不是**呈现层**（提示）→ 卡 `inject.js:2308` 的 bootstrap 中断，`ChatSquash`/`MacroNest`/工具注册**全不执行** | 已修；**实机实证三条齐备**：无新增 422、**schema 首次真正落盘**（state 文件 61,014 → 66,868 B，`properties.stat_data` 从空壳变为实际存在）、不匹配以 **24 项** `issues` 可见 |
| 8 | 🔴 **当前前线（T-42）**：卡的注入脚本要挂到 **ST 的正则面板 DOM**。第四次前移后的错误是 `TypeError: … 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'` @ `RegexBinding@inject.js:3885`（宿主帧），源码 `observer.observe($('#saved_regex_scripts')[0], …)` —— `[0]` 是 `undefined`。基准 **ST/TT 都有**该元素（`extensions/regex/dropdown.html:96/101`）→ 真缺口 | **不做半吊子修复**：只摆空容器而不把 ST 全局正则接进我方正则引擎 = 新的静默失败。**列为待你拍板** |

### 做法（第三道墙：不手抄，走生成器）

真 ST 的 `getContext()` 返回体里有 `eventSource, eventTypes: event_types,` **并列**
（`SillyTavern-reference/public/scripts/st-context.js:137-138`），事件名表本体在
`public/scripts/events.js:3 export const event_types = {`（**104 条**）。

- 新建 `scripts/gen-st-event-types.mjs`：**机械解析**基准源 → 产出 `client/st-event-types.gen.ts`
  （带 `file/line/count` 来源元数据；**解析结果为空则拒绝产出**，防止"悄悄生成一张空表"）。
- 为什么**不手抄**：将来 ST 升级，一条命令即可再同步；且「悄悄漂移」藏不住。
- **测试里踩到的坑（已固化为 L37）**：首版按「值应全小写 / 值应唯一」写断言 → **全红**。
  核验基准后确认是 **ST 自己的实情**：有 **4 个非全小写值**
  （`chatLoaded` / `GENERATION_AFTER_COMMANDS` / `characterDeleted` / `charManagementDropdown`）
  与 **1 处重复值**（`SMOOTH_STREAM_TOKEN_RECEIVED` 与 `STREAM_TOKEN_RECEIVED` 共用 `stream_token_received`，
  `events.js:72-74` 原文注释就是 `@deprecated … aliased to STREAM_TOKEN_RECEIVED`）。
  → 改为**黄金母版式**断言：钉住这 4 个例外 + 这 1 处重复，**新增/减少即报警**。
  **教训：用一个假前提写断言，会把真数据判成错。**

**交付**：双架构 APK 重打（x86_64 debug **sentinel v239** + arm64 release **sentinel v240**），**886 测试全绿**（47 文件）；
`npm run typecheck` = **三段式（core + ui + tests）全 0 错**；新增 3 个 spec / 43 条测试。
**产物新鲜度已按第 ⑪ 条铁律核到"解码后的内容"**（本轮踩过坑：esbuild 把中文输出成 `\uXXXX` 转义，
用原中文 `includes()` 查产物**恒为 false**，差点误判"产物没更新"——见 LEARNINGS **L38**）。
解码后确认：APK 内 `dsht-rp-plugin/lib/client.js` 含三道墙全部标记
（`installHostSillyTavern`×2 / `createThEventSource`×2 / `eventTypes`×3 / `OAI_PRESET_IMPORT_READY`×3），
`dsht-plugin-tavern-helper/lib/index.js` 含新提示语且**旧 422 串已消失**
—— 排除「插件存在即跳过 → 源码改动静默不进包」（构建链第 ⑦ 类断链）。
**设备实证**：卡脚本从"死在第 55 行"推进到 `RegexBinding@inject.js:3885`，**每秒重注册循环消失**（55s 窗口仅 1 条异常）。

## 心跳 49 做了什么（**写侧不校验、读侧整体拒收 —— 这次坏的是你正在用的那个会话**）

> 一句话：**不是修了一个字段，是把「验证读侧 ≠ 运行时读侧」这条元教训在第三个链位上又抓了一次。**
> 上轮（心跳 47）它在**迁移校验**那一步漏网，这轮它在**运行时加载**那一步漏网 —— 同一个盲区，
> 换了位置就再犯一次，说明防线要按"加载链的每一段"分别落，而不是补一处。

| # | 结论 | 证据 |
|---|---|---|
| 1 | 🔴 **用户会话完全打不开** —— 实机 UI 红字 `Failed to load history: stored session "session-fdfc1a28…" is corrupt: seed assistant/message at index 246 has invalid settlement fields (gateway/internal)`。不是缺一段渲染，是**整份无法加载** | 设备 UI DOM 采集 |
| 2 | 🔴 **根因：官方冷启动校验要求 `stream` 必须是数组** —— `assertAssistantSettlementShape` 要求 `turn`/`step` 为 safe int **且 `data.stream` 是 Array**；`expandAssistantStream` 就是 `for (const c of stream)`，`undefined` 直接 TypeError | `@deepseek-ai/dsh-session/lib/types/index.js:204-212` |
| 3 | 🔴 **写侧从不校验，所以完全静默** —— 官方 `validateSessionEventData` **只查 `request/header` 与 `tool/result`，不看 `stream`** → 写的时候 HTTP 200、UI 无提示；**冷启动才炸，且炸掉整个会话** | 官方校验器源码 |
| 4 | 🔴 **污染源是我们自己的 TH 写入桥** —— `th-edit` / `th-append` 追加 `assistant/message` 时只给 `turn/step/message`，**漏 `stream`**；共污染 **10 条**（turn 13-14 各 5 步） | `dsh-plugin/index.ts:6819`（th-edit）/ `:6629`（th-append）；seq 246/249/252/255/258/303/306/309/312/315 |
| 5 | ✅ **代际必需字段集查清（官方处置表，非推测）** —— **v0** = `["turn","step","message"]`，**带上 `stream` 反而是非法成员**；`stream` 由 **v1→v2 迁移器**从 `assistant/chunk` **生成**；**v2+** = 四件套必需 | `v0-to-v1/lib/index.js:42-45`；`v1-to-v2/lib/index.js:752-768` |
| 6 | ✅ **修复：单源 + 代次分叉** —— 新增 `assistantSettlement(turn, step)`（返回 `turn/step/stream:[]`），**6 个写侧**统一改用它；**v0 welcome 站点故意不写并加注释**说明为何不能写；`session-repair.ts` 增加**代次门控**回填（**仅 `srcVersion >= 2`**） | `session-write.ts` / `dsh-plugin/index.ts` ×5 / `dsht-plugin-prompt-template/index.ts` ×1 / `session-repair.ts` |
| 7 | 🔴→✅ **防线的真空洞：判据用的读取器比运行时宽松** —— `verify-session-pipeline.mjs` 原先用 `foldSurface`（**兼容读取器**，两代字段名都认）→ 这个**已经装不进去**的会话文件此前被判「可迁移」。**与前一轮 L30 同源，第三次重演** | 新增**判据 7**：用官方 `new Session(id, events, header)` 做**运行时加载**判定 |
| 8 | ✅ **回归 9 条，含一条关键负控** —— v3 回填 / v2 回填 / **v0 负控（给 v0 补 stream 必须失败）** / 真 stream 保留 / `assistant/attempt` / 幂等 + 单源形状 3 条 | `session-repair.spec.ts`（25 条）、`session-generation.spec.ts`（28 条） |
| 9 | ⚠️ **新缺口：修链跳过「live」会话** —— `/rp/repair-sessions` 返回 `scanned 80 repaired 0 skipped 2`，目标会话原因 `live（关闭会话后重跑）`；另有一份 62.3MiB 超 32MiB 上限 | 已产出可复跑工具 `scripts/diag-session-loadable.mjs` |

| 9 | ⚠️→✅ **「跳过」不可见是个真缺陷（L42）** —— 修完上面几条后去查"为什么这个坏会话一开始没被自动修掉"，遇到的是**查不到**：`repair-sessions` 返回 `skipped 2` 但**日志一行没有**（出日志条件是 `repaired>0 \|\| errors>0`，「只跳过」被排除）。第一反应"修复器没跑"是**错的** —— 实际"跑了、按设计跳过了"。**有意 ≠ 可以静默** | 已修：条件加 `skipped.length>0` + 按原因归类计数 + **逐条打印 sessionId 与原因**。设备实证 `skippedReason={"超上限":1}` → **`live` 消失**，证明「启动即修窗口」确实先于会话 live；最初记的「live 跳过是缺陷」是**误判**（探针发得太晚） |

### 验收（全部实测）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 判定工具自证（官方 `Session` 为 oracle） | FAIL | OK（**负控**：non-array → 正确报错） |
| 迷你树可迁移 | 0 / 1 | **1 / 1** |
| 全树可迁移（迁移前树） | **39 / 80** | **80 / 80**（救回 **41**，质量项全 0） |
| **设备当前真实树（最强判据）** | — | **81 / 81 本就通过**；判据7 运行时拒载 **0**；内容丢失/非幂等/身份漂移/每次重写 **全 0**；199.5MB / 15.9s |
| 设备 UI `openError` | 红字错误 | **null**（元素数 668 → **1690**，滚动区 3000px，124 个正文叶子） |
| `stage4-regression` | 20 / 21 | **21 / 21**（重装 v243 后复验） |
| 单测 | 886 | **895**（47 文件，+9） |

**交付**：双架构 APK 重打（x86_64 debug **sentinel v243**（196,815,740 B）+ arm64 release **sentinel v244**（128,339,432 B））；
`npm run typecheck` = **三段式（core + ui + tests）全 0 错**。
**产物新鲜度按第 ⑪ 条铁律解码后核验** —— 本轮新发现 esbuild 的**第三种**转义形态
（每个 CJK 字符前加反斜杠，如 `\缺`），已并入 `scripts/check-artifact-freshness.mjs` 的解码规则；
另新增 `scripts/check-apk-payload.py` 直接核验 **APK 内** `assets/dsh-runtime.zip` 的产物标记。
解码后确认 staging / **APK 内** / **设备侧**（876,089 B）三处均含
`assistantSettlement`×7 / `dd.stream = []`×1 / 新提示语×1 / `skippedReason=`×1。
**沉淀**：LEARNINGS **L39**（验证读侧 ≠ 运行时读侧，按加载链分段落防线）/ **L40**（持久化字段集按代次分叉）/
**L41**（写时不校验、读时爆炸 = 持久化层标准静默失败形态）/ **L42**（有意跳过 ≠ 可以静默；
健康系统必须能区分「做成了 / 失败了 / 有意没做」）。

## 心跳 50 做了什么（**从「逐墙试错」升级成「一次性静态穷举」—— 一轮列出 13 个缺口**）

> 一句话：前三轮都是**串行试错**（补一道墙 → 重跑 → 错误前移 → 再补下一道），
> 一轮只能推进一格，而且**下一条错在哪要等卡脚本跑到了才知道**。
> 本轮换成**静态穷举**：把卡脚本里所有 `ctx.*` 访问路径机械抽出来，和基准的 `getContext()` 面做差集
> → **13 个缺口一次全部列出**，不用再等运行时报错。

| # | 结论 | 证据 |
|---|---|---|
| 1 | ✅ **新防线：`scripts/audit-card-context-surface.mjs`** —— 抽出卡脚本 **52 条** `ctx.*` 访问路径，与真 ST `getContext()` 的 **145 个成员**做差集。**判定口径只认「基准有、我们没有」**（我们比基准多不算缺陷，符合 L36「不能少也不能多」） | CLI：`--script <card.js>` / `--selftest`，有缺口即 exit 1 |
| 2 | ⚠️→✅ **枚举器自己先翻车一次（新教训 L44）** —— 首版解析器只识别 `key:` 形式，**简写属性（`eventSource,`）全部看不见** → 测出来"只有 33 个成员"，**会给出看着干净的假结论**。重写后 `--selftest` 正控钉住 shorthand / nested / str / tpl / fn / last 六类形态 | `--selftest` 断言 `['shorthand','nested','str','tpl','fn','last']` |
| 3 | ✅ **实现 15 个宿主门面成员（缺口 13 → 6）** —— i18n 四件套（`t`/`translate`/`getCurrentLocale`/`addLocaleData`）、弹窗三件（`POPUP_TYPE`/`POPUP_RESULT`/`callGenericPopup`）、工具五件（`registerFunctionTool`/`unregisterFunctionTool`/`isToolCallingSupported`/`canPerformToolCalls`/`ToolManager`）、`isMobile`、`event_types`（legacy 别名）、`saveSettingsDebounced`。**每一条语义都带基准 `file:line` 溯源**，不靠"文档直觉" | 新建 `src/client/host-st-surface.ts`（三节：i18n / popup / tools） |
| 4 | ⚠️ **「文档直觉」被基准推翻（新教训 L46）** —— 我按常识写的默认按钮是 `OK`/`Cancel`，基准实际是 **CONFIRM = `Yes`/`No`**、**INPUT = `Save`/`Cancel`**；更关键的是**这些默认文案不在 JS 里，而在 HTML 模板的 data 属性**（`index.html:6456/6464/6473-6475`）→ 只读 JS 永远查不出来 | 依 `popup.js:454-501` 逐条校正 |
| 5 | ✅ **弹窗保真度四处校正** —— ① INPUT 的 Cancel **不该隐藏**（原实现隐藏了）② 按钮**顺序**须 OK 在 Cancel 之前（真机实测返回 `No\|Yes` = 顺序反了）③ `okButton: true` 时应保留 `'OK'` 而非套用 CONFIRM 默认 ④ 输入控件**恒为 `<textarea>`**、X 按钮解析为 **`NEGATIVE(0)`** 而非 AFFIRMATIVE | 设备行为验收 26/26 |
| 6 | 🔴→✅ **T-43 是「假差异」，不是数据缺陷（L45，L30 第三次重演）** —— 62.3MiB 会话被 `diag-session-loadable.mjs` 判 corrupt，`verify-session-pipeline.mjs` 却说 81/81 全过。**根因是口径不是数据**：该工具把文件里原样的 v0 事件直接喂 `new Session(...)`，**不做 v0→v3 迁移**；而那个文件正是一份 `version:0` / `origin:"subagent"` 的导入流水线会话 | 已给工具补⚠️前置条件警告（"判 v0~v2 请改用 `verify-session-pipeline.mjs`"）+ 给跳过日志加会话身份（`origin=… agentPreset=…`） |
| 7 | ✅ **修掉一处自己的「假绿」防线** —— `check-apk-payload.py` 原先**硬编码只看 `dsht-rp-plugin/lib/index.js`** → 本轮改的是 `dsht-rp-ui`，**这工具根本验不到**（会报"通过"）。已重写为扫描 APK 内**全部 zip 条目**、同时解两种 esbuild 转义形态 | 重写后 x86_64 / arm64 **两个** APK 均通过 |

### 验收（全部实测）

| 项 | 结果 |
|---|---|
| 类型闸门 `npm run typecheck`（三段式 core + ui + tests） | **全 0 错** |
| 单测 | **923 / 923**（48 文件，本轮 +24） |
| 设备行为验收（真机弹窗/i18n/工具面） | **26 / 26** |
| `stage4-regression` | **21 / 21** |
| 路由契约 `audit-route-contract` | 67 路由 **0 违约** |
| 补丁标记 `audit-patch-markers.py` | 19 / 19 健全 |
| `verify-session-pipeline`（七判据含运行时加载） | **81 / 81**，判据 7 拒载 **0** |
| 卡上下文面缺口 | **13 → 6**（余 4 项需宿主↔插件桥；`streamingProcessor` 属我们**多报**，脚本自身已 null-guard） |

**交付**：双架构 APK 重打（x86_64 debug **sentinel v249**（187MB）+ arm64 release **sentinel v250**（122MB）），
两个 APK 内的产物标记均已解码核验；设备侧哨兵 `.installed-v247`、`dshVersion 0.1.5-rc.1`。
**设备实证新日志**（本轮新加的会话身份）已按原样出现：
`文件 62.3MiB 超 32MiB 上限｜origin=subagent，agentPreset=dsht-adapter → 非用户聊天（subagent），跳过自动修复`。
**沉淀**：LEARNINGS **L43**（用一次性静态穷举替代运行时逐墙试错）/ **L44**（枚举器自身必须先过正控，
否则工具缺陷会伪装成数据没问题）/ **L45**（两个工具结论冲突时先查口径 —— L30 第三次重演）/
**L46**（默认值可能藏在 HTML 模板 data 属性里，别只读 JS）。

## 心跳 51 做了什么（**缺口 13 → 1；并抓到一个"只有实机能发现"的静默失败**）

> 一句话：上轮把"发现缺口"变成了静态穷举，这轮**把穷举出来的缺口逐个收口**，
> 并在实机验收时抓到一个**单测抓不到、只会在真机上出现**的静默失败。

| # | 结论 | 证据 / 说明 |
|---|---|---|
| 1 | ✅ **上轮遗留的 4 个"需要建桥"的成员全部落地** —— 关键判断是：**桥早就存在** | `src/client/rpc.ts` 的 `rpApi`/`thApi`/`dshRpc`（同源 `POST /dsht-rp/*`），且 `buildHostStContext(src: HostStContextSource)` **本来就是参数化的**。所以不是"造桥"，是"**接线**"。已实现 `chatId`/`getCurrentChatId`、`reloadCurrentChat`、`substituteParams`/`substituteParamsExtended`、`streamingProcessor`（**如实 `null`** = 基准初值 `script.js:455`，不是假装支持）。门面成员 **27 → 37** |
| 2 | 🔴 **只有实机能抓到的静默失败**：`ctx.substituteParamsExtended('{{char}}', {}, wrap)` 在真机上**不套 `postProcessFn`**，而 `ctx.substituteParams('{{char}}', { postProcessFn: wrap })` 正常 | 根因 = 我把 Extended 的实参**原样转发**给 `substituteParams` 提供者 → 第 2 参 `{}` 被当成 **options 对象** → `additionalMacro`/`postProcessFn` **双双静默丢失**。后果：卡的 `substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)` **丢掉正则消毒且无任何报错**。基准：`substituteParamsExtended` **就是** `substituteParams(content, {dynamicMacros, postProcessFn})`（`script.js:2756-2757`），两者形参位置不同（`:2756` vs `:2922`）。**已修**：拆出专用提供者 + 三段式（专用优先 / 否则显式映射 / 否则出声降级） |
| 3 | ⚠️→✅ **并且要承认：原来的单测把缺陷写成了期望值** | 原测例名就叫「`substituteParamsExtended` 与 `substituteParams` **共用同一提供者**（单实现）」，断言 `expect(seen).toHaveLength(1)` —— 它**是绿的**，还把缺陷钉成了契约。已重写为 6 条新契约测试，含**负控**（断言"**不得**原样转发"）。沉淀 **L50** |
| 4 | ✅ **审计工具三处加固**（每一处都是"防线自己在说谎"） | **(a)** 只认 `SillyTavern.getContext()` → TH 扩展用**裸** `getContext()`，导致扫描 `chat-history-backup/index.js`（16 处调用）报「访问路径 0 条 + ✅ 全部具备」**假绿** → 收纳裸形态，并把"零命中"改成 `⚠️ 不可判定` **单独计数、永不输出 ✅**（**L47**）。**(b)** `indexOf('return {')` 被门面内**内层函数**劫持 → 门面只解析出 2 个成员；`SURFACE_MIN_MEMBERS` 下界**拒绝给结论**而不是静默给假结果（救了一次）→ 改为括号配平 + 深度 1 定位（**L48**）。**(c)** 支持 `get x()` 访问器形态 + 新增 `--surface` 参数做**逐面**核对 |
| 5 | 🔴 **新口径 L49：并集口径会掩盖"单面缺失"** | 宿主页门面 **37** 成员 vs iframe 门面 **9** 成员；卡访问的 19 个真 ST 成员里 **16 个在 iframe 面缺失**。原因不是忘了写 —— `th-shim.ts` 是**构建期注入的字符串**，不能 `import` 共享模块。→ 登记 **T-46** |
| 6 | ✅ **剩余 3 个宿主缺口"有意不实现"，并写明理由**（拒绝"补空容器"式静默失败） | `characters`(4)/`characterId`(12) 必须**成对**建真实角色列表模型；`chatMetadata`(9) **我方无对应存储**，给 `{}` 只会让写入**静默消失** → **T-47**；`renderExtensionTemplateAsync`(1) 与 **T-42 同域**（卡的唯一调用就是 `renderExtensionTemplateAsync('regex','editor')`）→ **T-48**，**随 T-42 一起解决**，不单独做半吊子 |
| 7 | 🔴 **阶段二长尾「UI 面逐项回归」跑出结果（数据面已是 21/21）** | ✅ 可达：`ui-accept` PASS（`openError=null`、元素 **1526**、正文 145 叶子、滚动区 2411px）· 回退/重新生成 ✓ · 世界书 ✓ · 剧情控制台 ✓ · MVU 状态 ✓ · 导入 ✓ · 脚本帧 18 个 ✓。<br>❌ **不可达：编辑楼层（0 命中）· 变体/swipe（0 命中）** —— 全 DOM 176 个带标签元素逐一过滤；悬停 6 个消息节点后按钮数 **134 → 134 不变**；`[role=menu/listbox]` 容器 **0 个**；已确认当前就是 RP 会话视图。→ 登记 **T-49**（**有引擎无入口**：`variant/groups` 200 + `th-edit` 写桥都在）|

**验收（全实测）**：审计工具 `--selftest` PASS · 缺口 **1 个**（`renderExtensionTemplateAsync` @4555）·
iframe 窄面 **16 个**（告警不阻塞）· 三闸门 `typecheck` **0 错** · 单测 **971/971**（49 文件，+48）·
`stage4-regression` **21/21** · 设备门面成员 **37** · 设备探针 **11/11 PASS**
（修复前 `B_ext_pp`/`E_ext_dyn`/`F_ext_dyn_nofn` 三项全 FAIL；新增 `\,` 转义真机返 `a,b`）。

**交付**：双架构 APK 重打（x86_64 debug **sentinel v257**（196,828,152 B）+ arm64 release **sentinel v258**（128,351,844 B）），
两个 APK 内 `hostSubstituteParamsExtended` / `callSubstituteParamsExtended` / `宏环境作用域` 标记均已解码核验；
设备侧 `dshVersion 0.1.5-rc.1`、哨兵 `.installed-v257`（对应 x86_64 包）。

**顺带收口两处「防线之外」的退化**：① `macros.ts` 的 `\,` 哨兵以**裸 NUL 字节**落在源码里 →
git 把整个宏引擎判为**二进制**（`Bin 18333 -> 21642`）→ 该文件所有 diff 从此不可评审；已改写为等价 `\0` 转义
（**先补两条决定性用例**，该哨兵此前**零覆盖**）。② `fetchScope` 的 `if (!r.ok) return {}` 让「服务端 5xx」
与「该作用域确实没变量」在调用点等价（= 本项目主力缺陷族）→ 改为按 `scope:原因` **去重出声告警**。

**沉淀**：LEARNINGS **L47**（枚举工具的取法覆盖面就是结论的有效边界）/ **L48**（解析"函数体的返回对象"
必须定位**顶层** return）/ **L49**（并集口径会掩盖单面缺失）/ **L50**（**单测会把我们写错的行为固化成期望值**）/
**L51**（把控制字符以**裸字节**写进源码 = 让整个文件对 git/grep 变成"不可评审"）/ **L52**（并发实例下
字节级产物对照会被第三方构建污染 → 等价性要靠「决定性单测 + 产物新鲜度 + 设备探针」三重判据）。

## 心跳 52 做了什么（**一个"把名字换个写法就能解封"的整机不可用**）

> 一句话：**手机时区设成 GMT，就一条消息也发不出去** —— 而且报错一闪而过、会话里一行都不写。
> 这轮把它从「已知风险」变成「已修 + 真机闭环」，并顺手纠正了一个**修错地方**的惯性。

| # | 结论 | 证据 |
|---|---|---|
| 1 | 🔴 **故障是什么**：0.1.5 宿主对 `clientTimeZone` 有**唯一一处**强校验（`dsh-api-session-controller/lib/index.js:738-739`），接受域 = 字面量 `"UTC"` 或**带斜杠的 IANA 名**；而 Android WebView 在系统时区为 `GMT` 时把 `Intl…resolvedOptions().timeZone` 报成 **`"+00:00"`**（无斜杠）→ 必然被拒 → 表现就是「点发送毫无反应」 | 真机复现：`setprop persist.sys.timezone GMT` 后页内实测 `TZ\|+00:00` |
| 2 | ✅ **关键推论**：`clientTimeZone` **不传**是**放行**的（`:750` 该字段整个不出现在 `source` 里）→ 所以「映射不出来就干脆不带」是安全降级，不是作弊 | 非破坏性闸门对质：`+00:00`→`invalid-time-zone`；`UTC`/`Etc/GMT-8`/**省略**→`session/not-found`（= 时区闸门已过） |
| 3 | 🔴 **差点修在错的地方**：我 grep 到我方只有 3 处 `clientTimeZone`，但**主发送路径根本不在我方代码里** —— composer 是 DSH 原生 Lexical 组件、提交走**原生提交通道**（这句就在我方 `composer-enter-fix.ts` 头注里），时区由**官方客户端模块**自己采样（`…/client/time-zone.js:7` → `…/sessions/session.js:178/204`）。官方源零修改是红线 → **只补调用点等于没修** | 沉淀 **L53**（修复点 ≠ 承重点） |
| 4 | ✅ **正确落点**：**注入层替换取样结果** —— 打 `Intl.DateTimeFormat.prototype.resolvedOptions`，把 `timeZone` 换成规范名。**只换名字不换偏移 = 语义等价**，所以读它的任何代码（官方、我方、第三方）行为不变，变的只是它终于能被宿主接受 | 真机 `patched:true` / `raw:"UTC"` / `off8:"Etc/GMT-8"` / `off530:"Asia/Calcutta"` / 合规名原样 |
| 5 | ✅ **映射表是筛出来的，不是想出来的**：整点偏移 → `Etc/GMT∓N`（符号相反）；**分数偏移**用「全年 12 个月偏移完全相等」当筛子 → 保留 8 条（+3:30/+4:30/+5:30/+5:45/+6:30/+8:45/+9:30/−9:30），**排除** Lord Howe / Norfolk / Chatham / St_Johns（夏令时期间偏 1 小时 = 比"没有"更坏）。筛子本身配**反向控制**（故意塞带夏令时的区必须失败） | 沉淀 **L54**；单测 24 条含不变式 + 反控 |
| 6 | ✅ **真机闭环（before/after，走的是真实产品路径）**：**修前** GMT 下发一条 → **会话文件零变化**；**修后**同动作 → 落盘 `user/message` seq 1202 且 `source.clientTimeZone:"UTC"`，全 logcat `invalid-time-zone` **计数 0** | `stage3-device/hb52/session-after2.v3.jsonl` |
| 7 | 🟠 **排障副产品**：官方客户端走 **WebSocket** 而非 fetch —— 我给页面打 `fetch` tap 只看到我方自己的请求，差点得出「点发送根本没发出请求」的错结论。**最终判据改用服务端落盘**（结论不依赖我猜对传输层） | 沉淀 **L55** |
| 8 | ❌ **顺手推翻了一条我们自己的错误待办（T-49）**：上轮用「枚举 176 个带 `title`/`aria-label` 的元素 → `编辑\|edit` 命中 0」判定「编辑楼层在界面上点不到」。实测**编辑入口本来就在**：user 气泡操作条里的 `✎ 编辑`（`data-testid=dsht-rp-edit`，`RpNativeChat.tsx:1899`），点开就地编辑器（**预填原文**）+ 取消还原，**全程零请求零数据变更**。**变体条**也已接 `assistant-actions` 槽位（同槽位的 `dsht-rp-regen-btn` 实测在 DOM ⇒ 槽位可用），只是 `members.length < 2` 时**按设计返回 null**（当前 `groups=1`，没有第二个变体可切）。**上轮为什么错**：① 测的是 **title/aria-label 字符串**，而问题问的是 **DOM 存在性**；② 视图**窗口化**，操作条只在 user 行上，采样时 user 行未挂载 → "干净地"命中 0。**元教训**：`0 命中` 先要回答「样本里本来该有它吗」 | 非破坏性探针 `stage3-device/hb52/hb52-edit-entry-probe.js` |

**顺带**：单测里**抓到自己一次形状断言错误**（断言 `resolvedOptions().hour12 === false`，而 V8 在 false 时
**根本不返回该字段**）→ 改为行为判据（格式化结果必须落在该区的墙上时间）—— L37 又一次生效。

**交付**：双架构 APK **x86_64 debug sentinel v260** + **arm64 release sentinel v261**；三闸门（core/ui/tests）
**0 错**；**50 文件 / 1001 测试全绿**（+24）；`stage4-regression` **21/21**（与基线一致 = 无回归）；
APK 内载荷标记（含中文转义）与产物新鲜度均核验；设备侧哨兵 `.installed-v260`。

## 升级已完成：DSH 0.1.2 → 0.1.5 ✅（度量 5/5）

**为什么升**：新版本把「系统提示词」从隐式字段提升成正式数据节点，还支持"动态替换" ——
**原本可能解开 D-4**（那个我判定"无解"的问题）；实测**需再切 `llm-deepseek` 路由**才生效。

**风险（已安全度过）**：会话文件要迁移（v1→v2→v3 三段），**不可逆**。分 5 步走完，每步可回滚。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 备份设备数据 + 冻结 | ✅ **完成** |
| 1 | 静态预检（11 个补丁点） | ✅ **完成**：8 稳定 / 2 需扩展 / 1 新 stub |
| 2 | 升级运行时 + 重打补丁 | ✅ **完成**：0.1.5-rc.1 + 21 处补丁 + 7 插件 + 第 7 个 stub；**实机启动零错误** |
| 3 | 会话迁移验证 | ✅ **通过**：41/80 打不开 → **80/80 全部可迁移**，设备实测 `repaired=79 errors=0` |
| 4 | 功能回归 + D-4 重评 | ✅ **通过**：发消息端到端（123→134 行完整一轮）+ 功能面回归 **11/11**；D-4 重评维持「有条件可达」 |

> **进展度量**：`bash .goal/upgrade-0.1.5/evaluate.sh` → **5 / 5** ✅ **达成**（`.stage3-pass` + `.stage4-pass` 均已写入）
>
> **交付**：`DSH-Tavern-0.2.0-arm64-release.apk`（122.3MB，sentinel **v222**）
> 　　`DSH-Tavern-0.2.0-x86_64-debug.apk`（187.6MB，sentinel **v221**）
>
> **回滚保险（四层，全部未消耗）**：`backup/dsh-runtime-android-0.1.2-staging`
> 　　`rp-workspace/dsh-runtime-android/node_modules-0.1.2-old`
> 　　`stage3-device/backup/dsh-before-migration.tar.gz`（**设备数据 859MB，迁移前**）
> 　　`stage3-device/pre-migration/sessions-before.tar`（**会话树 178MB，取自设备真实字节**）

### ✅ 阶段 4 结案：0.1.5 下全功能回归通过（心跳 45）

| 项 | 结果 |
|---|---|
| 发消息端到端（硬门槛） | ✅ CDP Input 域真实发送 → 会话 **123 → 134 行**完整一轮（turn/start → 4 层注入 → request/header → assistant/message → step/end → turn/end） |
| 功能面回归 | ✅ **11/11**（会话审计 / attach / 世界书 / MVU / 记忆 / 回退掩码 / 变体组 / TH 变量+schema / 楼层门面 / EJS） |
| 新工具 | `rp-workspace/scripts/stage4-regression.mjs`（可复跑数据面回归） |
| **D-4 重评** | 维持「**有条件可达**」：`dsh-llm-deepseek` 有 `in-history`（:1849），`dsh-llm-pi-ai` 无；我方走 pi-ai → 解锁需切路由（**独立任务，不叠加**） |
| 本阶段修掉 | `th-shim.ts` 注释内反引号截断模板串（编译中断，2 测试套件 collect 阶段失败） |

📄 完整证据：`.goal/upgrade-0.1.5/.stage4-pass`

### ✅ 阶段 3 结案：41 个打不开的老会话已全部救回（本轮最重要结论）

**做了什么**：用官方 0.1.5 迁移链，对**设备上全部 80 个真实会话**做了一次 dry-run 体检
（151MB / 1.7 秒跑完，零副作用），定位根因后在**写入侧**根治 + 对存量做修复。

| 指标 | 修复前 | **现在** |
|---|---|---|
| 能迁移 | 39 个 | **80 个（100%）** |
| 被拒绝 | **41 个（51%）** | **0 个** |
| 迁移耗时 | 151MB → **1.7 秒**（性能完全不是问题） | 同 |
| 设备实测 | —— | `repair-sessions: repaired=79 skipped=1 errors=0` |

**离线五项判据**（对设备真实会话树，脚本 `rp-workspace/scripts/verify-session-pipeline.mjs`）：
可迁移 **80/80** ｜ 内容丢失 **0** ｜ 非幂等 **0** ｜ 回归 **0** ｜ 目录身份漂移 **0**

**怎么修的**（三个层次）：
1. **写入侧根治** —— 我方插件不再往 `source` 塞扩展键（0.1.5 是白名单，多一个键就拒）。
   新会话从此不会产生不可读日志，这是治本。
2. **存量修复器** —— `repairSessionForV3` 把 41 个历史会话按 8 类不合规逐一纠正。
3. **数据不丢** —— `source` 上摘下来的 TH 楼层数据（`thData`/`thSystem`，
   含**飞讯记录映射**）不再丢弃，改存 `$DSH_HOME/rp/th-floors/<sid>.json` 旁路存储，读侧同步对接。
   （丢弃是**静默**的，正是本项目最忌讳的失败形态。）

**五类根因**（三类是**我们自己**写进去的）：

| 类 | 次数 | 谁干的 |
|---|---|---|
| `source` 上多了 `regeneratedFrom`/`rolledBackTo`/`editedFrom` | 7 | 我方 `dsh-plugin` |
| `assistant/message` 引用了不存在的 chunk（ST 导入伪造溯源） | **21** | 我方 ST 导入 |
| `user/message` 缺 `id` | 9 | 我方 |
| model source 上多了 `plugin`/`ejsProcessed`/`thData` | 1+ | 我方 |
| 其余单例（compaction 区间、turn 编号、cwd 非绝对路径） | 4 | 待查 |

**为什么以前没发现**：0.1.2 的校验很宽松，这些多余字段照单全收；
0.1.5 换成了**白名单**（多一个键就拒）。
我方 `dsh-plugin/index.ts:6094` 的注释甚至写着「校验只查 kind/provider/model」——
这句在 0.1.2 成立、在 0.1.5 已经不成立。

**设备当前状态**：会话仍是 v0（0 个 `session.v3.jsonl`）——迁移是**开聊天时惰性触发**的，
所以修复器跑完不等于迁移已发生。目前 **80 个会话全部就绪**，随时可开。

**⚠️ 本轮踩到并修掉的一个真实事故（值得记住）**：
修复器一度把非绝对 `cwd`（相对路径 `rp/_start`）**补成绝对路径却没搬目录**，
违反官方 `assertStoredIdentity`（**目录名必须 == projectKey(cwd)**）→
`dsht-welcome` 会话在核心搬迁中**整份丢失**（设备 80 → 79）。
现已三处加固：① 纯函数不再碰 cwd；② 落盘前加身份校验闸，不符即**拒绝写入并报错**；
③ 离线判据新增第 5 条「目录身份不变」——**这正是原先漏掉、才让事故溜过的那条判据**。

**本轮还顺手挖出两个同类「静默」缺陷（都是白干活/白打包，不报错）**：

| # | 缺陷 | 实际代价 |
|---|---|---|
| 1 | 修复链的短路守卫把 **boolean** 的 `v3.changed` 与 `0` 比较 → `false === 0` 恒假 → 守卫永不成立 | **每次启动重写全部 79 个会话**（~200MB 无效写入 + 79 个 `.bak` / 136MB 堆积，抬高损坏概率） |
| 2 | 构建脚本只判「插件产物**存在**」，除主插件外的 6 个插件**一旦存在就永不重建** | 源码改动静默不进包（实测 `tavern-helper` 的改动根本没进产物，**字节数与旧版完全相同**，而 6 条构建断言全过） |

两者的共性是**「动作发生了、但没做该做的事」**——正是本项目定义的头号缺陷族。
已用「带类型的谓词（让 tsc 拦住）+ make 式新鲜度戳（让构建自己发现）」结构性堵死，
并新增第 6 条离线判据「修复链收敛」——**判据 3（内容相等）抓不到缺陷 1，只有验「谓词本身决定不再落盘」才抓得到**。

📄 完整证据（含 file:line）：`docs/DSH-0.1.5-UPGRADE-PLAN.md` 附录 E

### ✅ 阶段 4 硬门槛：发消息端到端打通（心跳 44）

**结论**：0.1.5 下「发消息没反应」**不是静默失败**，是宿主**明确拒收**，
而拒收原因有**两条平台级根因**，且都是 0.1.5 引入或收紧的。

| # | 报错 | 根因 | 处置 |
|---|---|---|---|
| ① | `resume failed for session "…": Error: flock is not supported on android-x64` | 0.1.5 用 `flock(2)` 做会话写锁（`session.lock`），Android 无 flock 且 `process.platform === 'android'` 直接抛 | 平台补丁 **Step 4.6**（`DSHT-ANDROID-FLOCK`）：按 DSH 自己对 browser worker 的同款处置——**单进程直通** |
| ② | `clientTimeZone must be UTC or a valid IANA Area/Location name (session/invalid-time-zone)` | 设备时区 = `GMT` 时，Android WebView 的 `Intl…timeZone` 返回 `"+00:00"`（非 IANA 名），0.1.5 宿主白名单校验拒收 | 测试环境设 `Asia/Shanghai` 解封；**产品级兜底待拍板（D-5）** |

> ① 是**所有 Android 设备**都会中的（不是环境问题）；② 只在设备时区为偏移式时触发，
> 但**模拟器默认就是 GMT** —— 这就是为什么整个测试链一直"发消息没反应"。

**端到端实证**（`session.v3.jsonl` 事件序列，会话 `session-fdfc1a28…`）：

```
62 step/start(turn=5) → 63 system/message → 64 user/message("Vhello")
→ 65 RP 指令注入 → 66 runtime context → 67 skill catalog → 68 剧情记忆快照
→ 69 request/header → 70 assistant/message → 71 step/end → 72 turn/end(completed)
```

- ✅ 4 层注入（RP 预设 / runtime context / skill catalog / memory-plot）按序落盘
- ✅ UI 渲染确认：聊天区出现用户消息与角色回复；页脚 `4 turns` → **`5 turns 5 steps`**
- ✅ 会话由核心物化为 `session.v3.jsonl`（v0 原文件保留，符合官方"发布新代际"语义）
- ✅ 顺带修好：时间显示（时区修复后不再显示 GMT 偏移）

**新增取证工具**（`rp-workspace/scripts/`，均为 CDP/原生输入路径）：
`dsht-ui-probe.mjs`（网络插桩）· `dsht-ui-type.mjs`（Lexical 真实状态）·
`dsht-hittest.mjs`（命中测试）· `dsht-deep.mjs`（**React fiber hook 链读组件内部状态** ★最有用）·
`dsht-netaudit.mjs`（Resource Timing 审计）· `dsht-native-send.mjs`（原生 `adb input` 真用户路径）

### 🔴 实机发现并修复的启动阻塞（上轮最大收获）

**症状**：新 APK 卡启动屏 → `端口 3080: 未监听`

**根因**：0.1.5 的 `dsh-subprocess-local` **新增静态导入** `@deepseek-ai/dsh-win32-process`
（9 个符号），而 `pnpm install` 在非 win32 平台**不装该包** →
**ESM 加载期 SyntaxError → 整个 cordis plugin tree 崩溃**

**修复**：新增**第 7 个 stub**（`stubs/dsh-win32-process/index.js`，21 个符号）
→ 已注册进 `apply-platform-patches.py`，后续构建自动带上

**✅ 实机验证（决定性）**：
| 判据 | 结果 |
|---|---|
| `loadWin32ProcessBindings` 错误 | **0 次**（原反复崩溃） |
| 其他 SyntaxError | **0 次** |
| **端口 3080** | **LISTENING** |
| 插件注册 | dsht-memory / dsht-rp / dsht-mvu / dsht-th / dsht-ejs 全部 ✅ |

### 沉淀的新铁律

> **平台过滤导致缺包 = 隐蔽的启动杀手**
> · 表现是"整个 runtime 起不来"，易误判成构建/部署问题
> · 排查捷径：`logcat | grep "does not provide an export named"`
> · 预防：升级后 `comm -23` 比对两版包名差集（本次发现 19 个新增包）

### APK 交付

| 项 | 值 |
|---|---|
| 路径 | `DSH-Tavern-0.2.0-x86_64-debug.apk` |
| 大小 | 187.6 MB |
| 内嵌 DSH | **0.1.5-rc.1** |
| 内嵌补丁 | F1 4 处 + 第 7 个 stub ✓ |
| sentinel | **v205** |

### 轮次内新增的基础设施（此前缺失）

| 工具 | 作用 | 状态 |
|---|---|---|
| `scripts/apply-platform-patches.py` | 平台补丁（21 处，`--check` 预检 + 幂等 + 断言） | ✅ 实测通过 |
| `scripts/build-plugins.sh` | 构建部署我方 7 个插件 | ✅ 实测通过 |
| `scripts/upgrade-runtime.sh` | 一键升级编排（install/patch/plugins/sync/check/all） | ✅ 建成 |
| `scripts/stage3-migration-test.sh` | 阶段 3 设备端迁移验证流程 | ✅ 建成 |
| `tools/verify-session-migration.py` | 会话迁移验证（baseline/compare/scan） | ✅ 实测通过 |
| `tools-cu/cu.py` + `computer-use` skill | Windows 桌面级 computer use | ✅ 实测通过 |

### 关键实证结论（3 条）

1. **迁移链确认**：我方 v0 → 目标 v3（`SESSION_FORMAT_VERSION = 3`），三段迁移
2. **✅ `text-chunks` 兼容性风险已排除**：它是**宿主的聚合打包格式**（非数据损坏），
   0.1.5 虽移除了 `decodeStorageRecord`，但 **v0→v1 迁移器有 `PACKED_TAGS` 展开逻辑**补偿
3. **D-4 从「不可达」升级为「有条件可达」**：`in-history` 让 system 提示词可追加到历史任意位置；
   解锁需**两步独立决策**（升级 + 切 `llm-deepseek` 路由），**建议不在升级窗口内叠加**

📄 方案全文：`docs/DSH-0.1.5-UPGRADE-PLAN.md`

## 要你拍板的事

| # | 问题 | 我的建议 |
|---|---|---|
| ~~A~~ | ~~升级时机~~ | ✅ 已执行（阶段 0–4 全部完成，度量 5/5） |
| ~~B~~ | ~~能否接受"打开旧聊天要等一会儿"~~ | ✅ **已实测：151MB / 1.7 秒，毫秒级，用户无感** |
| ~~D1~~ | ~~是否继续 0.1.5 升级~~ | ✅ **已升级完成**（两条 Android 平台级阻塞均已修复并实机验证） |
| ~~D2~~ | ~~`thData/thSystem/ejsProcessed` 迁到哪~~ | ✅ **已执行方案①**：迁入 `$DSH_HOME/rp/th-floors/<sid>.json` 旁路存储 |
| ~~D3~~ | ~~是否允许一次性 normalizer 改写既有会话~~ | ✅ **已执行**（四层回滚保险 + 副本先行验证，80/80 通过） |
| **T-42** 🔴 | **卡脚本要挂到 ST 的正则面板 DOM（`#saved_regex_scripts`），我们前端是 DSH 的 UI，没有这些元素。**<br>（A）补挂载点**并**把 ST 全局正则 `extension_settings.regex` 真接进我方正则引擎<br>（B）不补，登记为已知差异<br>（C）只补空容器 | **建议 A**。<br>理由：基准（ST/TT）**有**这些元素，不补是与基准的功能差异；但**只补空容器（C）会造成新的静默失败**（卡以为挂上了、正则却不生效），**故坚决不做 C**。<br>**心跳 49 已把代价量化**：`tmp/t37-inject.js` 实际引用 **16 个** ST DOM id（`#saved_regex_scripts` / `#bulk_*_regex` ×5 / `#import_regex*` ×3 / `#saved_spreset_scripts` / `#preset_scripts_block` / `#completion_prompt_manager` / `#open*_editor` / `#sort_regexes` / `#squash_enabled_content`…），我方源码**命中 0 个**（16/16 缺失）。<br>**降险事实（重要）**：卡的 **34 条正则（17 启用 / 17 停用）已经通过我方管线真实加载并生效**（三源合并 global→character→preset，预设 `st-[主预设] V17.1 示例预设 · 示例角色-1lnwm2`），回归已实证。故缺的**只是 ST 面板 DOM 这一层皮 + `extension_settings.regex` 这个全局引用**，不是正则引擎本身。<br>代价：A 需把 16 个 id 的面板语义搬进来（我方已有 `RegexPanel.tsx` + `/regexes/get`、`/regexes/replace` 路由可复用），工作量中等；B 的代价是卡 bootstrap 后三行（`ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()`）**永久不执行**。 |
| **D-6** | 多出的 32 个工具定义要不要处理（TT 请求体**完全没有** `tools` 字段） | **分开处理**，升级已完成，可单独评估开关 |
| **D-5a** | 设备时区为 `GMT` 时 WebView 给出 `+00:00`（非 IANA 名）被宿主拒收，产品级兜底要不要做 | 测试环境已用 `persist.sys.timezone` 解封；产品级兜底（`±HH:MM` → `Etc/GMT∓N` 注入层映射）**待你定** |
| **D-5b** | 清洗存量脏楼层（`$1` 残留 + `<interactive_input>` 包装回写）—— 一次性 migration，扫 `storages/session_projcache/sessions/*.json` | **待你定**。建议：**先出只读报告**（命中文件数/楼层数）再决定动不动手 |
| **T-25** | 大扫除（发布前 P2 硬门槛） | **需你先解冻 RP 数据**（否则扫不干净） |
| **P-1** | 更新开关要用哪个 GitHub 仓库（公开 / 私有） | 待定；阶段三发布前必须定 |
| ~~C~~ | ~~「动态替换提示词」要不要启用~~ | 升级已完成，结论：需切 `llm-deepseek` 路由才生效（独立任务 = D-4） |

## 关键数字

```
自研代码   41,164 行（src 下 .ts/.tsx，不含构建产物）
自动化测试  47 个文件 / 895 项全绿
类型闸门   3 段式全 0 错（typecheck:core / :ui / :tests）
提交次数   85 次
最新 APK   x86_64-debug 196.8MB（sentinel v243）/ arm64-release 128.3MB（sentinel v244）
内嵌 DSH   0.1.5-rc.1
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
