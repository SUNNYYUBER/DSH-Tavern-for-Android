# TASK-LIST：接下来要做的所有事（唯一任务清单）

> 建立：2026-09-10。**本文件是行动清单**（做什么、按什么顺序、做完的标志）；现状背景看 [MASTER_TODO.md](MASTER_TODO.md)，冻结边界看 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md)，升级细节看 [docs/DSH-0.1.5-UPGRADE-PLAN.md](docs/DSH-0.1.5-UPGRADE-PLAN.md)。
> 状态取值：⏳ 待办 / 🔄 进行中 / 🚧 阻塞 / ✅ 完成

---

## 0. 现在的处境（30 秒读完）

| 事实 | 说明 |
|---|---|
| 源码 runtime | **0.1.5-rc.1**（源码 sentinel **v266**，阶段 0/1/2/3/4 已全部推完） |
| 仓库最新产物 | **x86_64 debug sentinel v265（196,836,000 B）/ arm64 release sentinel v266（128,362,024 B）**，9-11 19:11 构建，载荷标记已解码核验 |
| 升级进度 | **5 / 5** ✅ **达成**（阶段 4 已判定通过） |
| 单测 | **1074 项全绿（51 文件）** · `typecheck` 三段式 **0 错**（心跳 58 复跑确认） |
| 未提交改动 | 心跳 53–58 的源码/文档/工具（待提交） |

**当前状态**：升级目标（evaluate.sh 5/5）已达成。
- **心跳 55 · 实例B** = **修掉一个"死了 8 个心跳"的功能级缺陷**：
  `/rp/session-regenerate`（↻ 重新生成）与 `/rp/session-rollback`（↩ 回退到此处）两条 **live 写入路径**
  **恒 500 且零事件写入**。根因 = **心跳 47** 为绕开 TS 收窄告警把 `live.append(...)` 写成
  `const liveAppend = live.append`（**方法引用被提取 → `this` 丢失 → 官方读 `this.log` 抛错**），
  注释还写着「纯类型层修正，运行时语义不变」。**`tsc` / 1024 单测 / 21 项设备回归三处全绿**，
  只有"在副本上跑一次真写"才照得出来。
  已修（单源 `boundAppend()`）+ **三重防线**（静态闸门 `scripts/audit-method-binding.mjs` /
  单测负控 / 设备闭环），真机两条路由同时转 **200** 并落盘，取证后已**精确还原**用户会话。
  沉淀 LEARNINGS **L65–L68**。双架构 APK 重打。详见 **T-54**。
  ② 顺手拆掉一处**闸门自己在说谎**：`apply-platform-patches.py --check` 会把「补丁丢了」读成
  「一切正常」（正控实证：抹掉 F2/flock 的 marker 仍报 ✓ / exit 0）→ 已改为三态显式分账，
  详见 **T-55** 与 **L69**；③ 新增绑定审计接进构建预检（**A7 断言**，负控已验）。
- **心跳 54 · 实例B** = **阶段二长尾「UI 面」逐项走通 + 把 D-5b 从「待拍板」变成「有数字可拍板」**：
  ① UI 面五项（**编辑 / 回退 / 变体 / 世界书 / MVU**）逐项实测，**全程零写入**（动作前后 3 个落盘文件
  md5 完全一致）、**未捕获异常 / console 错误 = 0**；**`stage4-regression` 首次 21/21 全过**
  （长期悬置的 20/21 唯一失败项 = `variant/groups` 需 UI attach 会话，随 attach 闭合）。
  仅剩**未覆盖**一处：变体**切换**的端到端（需构造 ≥2 变体才能触发 UI 变体条）。
  → **心跳 57 续已闭环**：设备上此前**从未存在过**任何变体组（81 会话 `grep` **0 命中**）；
  本轮走产品路由（`session.create` → `chat/append` A → `session-rollback` → `chat/append` B →
  `variant/groups` 得 **2 成员组** → `variant/switch` **200**）第一次真正跑通，
  写入形态经官方 `Session` 构造器判定**可加载**（含负控）。详见 **T-56 附录 / T-57**。
  ② **D-5b 只读报告产出**（新工具 `scripts/audit-dirty-floors.mjs`）→ 见 **T-53**。
  沉淀 LEARNINGS **L62–L64**。**本心跳未改产品源码（唯一"缺陷"在探针自身），故无需重打 APK。**
- **心跳 53** = **回头审「已修」标记本身**：§4 兼容面 7 项里 **5 项的 ✅ 与代码现状不符**
  （T-16 / T-17 / T-18 / T-19 / T-22），全部真修 + 补反控（每条 stash 源码后用例必转红）。
  沉淀 LEARNINGS **L61**：同一语义存在多份副本时，「改了一处」不等于「修好一个功能」。
- **心跳 53 · 实例B**（并发实例，工作区不同） = **实机验收挖出两个缺陷**：
  **① T-45**「WebView 主框架加载失败后没有任何自愈路径」→ 整机永久停在启动屏，屏上却写着
  「端口 3080：已开放 ✓ / web 令牌：已捕获 ✓」（**每一行都在说正常，流程已经死了**）；
  补带预算的重载分支后 **7s 自愈**（修复前 40s / 40 次轮询零次重载）。
  **② T-51**「修复器两步互抵」→ **每次冷启动对同一会话做一次内容零变化的 2MB 全量重写 + 2MB 备份**
  （文件与 `.bak` md5 完全相同）；改为保序去重（`uniqueStable`）后**两次冷启动均 `repaired=0`**，
  设备全树 82 会话**七项判据全过、每次启动会重写 0**。详见 **T-45 / T-51** 与 GOAL 第 32 行。
  沉淀 LEARNINGS **L57–L60**。
- **心跳 52** = **修掉一个"整机不可用"**：系统时区为 `GMT` 的设备（**模拟器默认**）因 WebView
  把时区报成 `+00:00` 而被 0.1.5 宿主拒收 → **一条消息都发不出去**；已在**注入层**替换取样结果
  （官方源零修改），真机 before/after 闭环。详见 **T-50** 与 MASTER_TODO「心跳 52 做了什么」。

⚠️ **交付物状态提醒**：心跳 53 · 实例B 改了 `MainActivity.kt` 与 `session-repair.ts`，
**已重打双架构 APK**（x86_64 **v263** / arm64 **v264**）并已装机实测 —— 见下方"每轮收尾"。

---

## 1. 立即做（P0，阻塞其他一切）

### T-01　收拢未提交改动　✅ 已完成（2026-09-10 收口提交）
- 内容：`MASTER_TODO.md` / `NodeService.kt`(sentinel v205) / `build-dsht.ps1` / `.workbuddy/memory/2026-09-10.md` / `stage3-device/`（是否入库需定）
- 完成标志：`git status` 干净或只剩明确忽略项
- 备注：`stage3-device/backup/dsh-before-migration.tar.gz`（859MB 设备备份）**建议不入库**，加 .gitignore

### T-02　走完升级阶段 3：会话迁移验证　✅ 完成（2026-09-11 心跳 43；证据口径心跳 47 复核修正）
- 目标：确认 v0 → v1 → v2 → v3 三段迁移在**真实体量**（12MB ~ 214MB 会话）下可用
- 判据：`.goal/upgrade-0.1.5/.stage3-pass` 文件存在（evaluate.sh 的 +1）　→ ✅ 已写入
- 结果：六项判据对**真·迁移前树**（`stage3-device/pre-migration`，151MB）**80/80 全过**
  （可迁移 / 零内容丢失 / 幂等 / 无回归 / 目录身份不漂移 / 修复链收敛）；
  **39 → 80（救回 41）**；修复器实机 `repaired=79 skipped=1 errors=0`
- ⚠️ **证据口径修正（心跳 47）**：
  ① 原判据日志是**在已修好的树上跑的**（"修复前"就已 80/80，198MB）→ **循环论证**，证明力为零；
  现改为对真·迁移前树（151MB）重跑，得到真实前后对比，日志已按新口径重写
  ② 验证脚本原只复刻运行时**3 步**，漏了第 4 步 `repairSessionCwds`（相对 cwd → 绝对 +
  **目录改名**）→ `dsht-welcome`（cwd = 相对 `rp/_start`）恒判「不可迁移」，脚本报 79/80
  而设备上它是好的。**离线链少了哪一步，就会在那一维度上给出与设备相反的结论**。
  已补第 4 步（`cwdRepairStep`，语义等价推演）→ 复跑 80/80；
  **负控**：关掉第 4 步立刻重现 79/80 → 证明该步是承重的，闸门非空转
- 事故与修复：cwd 改写致 `dsht-welcome` 会话丢失 → 已修复+恢复+加闸+加判据（`c49646b`）
- 详见 [.goal/upgrade-0.1.5/.stage3-pass](.goal/upgrade-0.1.5/.stage3-pass)

### T-03　走完升级阶段 4：功能回归 + D-4 重评　✅ 完成（2026-09-11 心跳 45）
- 判据：`.goal/upgrade-0.1.5/.stage4-pass` 文件存在（evaluate.sh 的 +1）　→ ✅ 已写入
- 硬门槛（发消息端到端）：CDP Input 域真实发送 → `session.v3.jsonl` **123 → 134 行**完整一轮
- 功能面回归：**11/11 通过**（新工具 `rp-workspace/scripts/stage4-regression.mjs`）
  会话审计 / attach / 世界书 / MVU / 记忆 / 回退掩码 / 变体组 / TH 变量+schema / 楼层门面 / EJS
- **D-4 重评**：维持「有条件可达」——`dsh-llm-deepseek` 有 `in-history`（:1849），
  `dsh-llm-pi-ai` 无；我方当前走 pi-ai → 解锁需切路由（**独立任务，不在升级窗口叠加**）
- 本阶段修掉的缺陷：`th-shim.ts` 注释内反引号截断模板串（编译中断，2 测试套件 collect 失败）
- 详见 [.goal/upgrade-0.1.5/.stage4-pass](.goal/upgrade-0.1.5/.stage4-pass)

### T-04　🔴 重打 arm64-release 包给你手机　✅ 完成（2026-09-11 心跳 44/45）
- 产物：`DSH-Tavern-0.2.0-arm64-release.apk`（122.3MB，sentinel **v220**）
  　　+ `DSH-Tavern-0.2.0-x86_64-debug.apk`（187.6MB，sentinel **v219**）
- 装机验证：x86_64 v219 已装模拟器，实测启动 / 端口 / 插件注册 / 打开旧聊天 /
  发消息 / 回退·编辑·变体·世界书·MVU 全过
- **待你执行**：把 arm64 包装到真机，验三条基线（启动 / 打开旧聊天 / 发消息）

---

## 2. 需要你拍板的事（P0，回答后才能动）

| # | 问题 | 状态 / 结论 | 影响面 |
|---|---|---|---|
| ~~T-05~~ | ~~升级时机：立即走完 vs 等正式版~~ | ✅ **已按建议执行**：立即走完，阶段 0~4 全部通过（度量 5/5） | — |
| ~~T-06~~ | ~~能否接受「打开旧聊天要等一会儿」（迁移耗时）~~ | ✅ **已实测解答**：151MB / **1.7 秒**，毫秒级，用户无感；**不构成体验问题** | — |
| ~~T-07~~ | ~~要不要启用「动态替换提示词」（可能解 D-4）~~ | ✅ **已评估**（T-03 内）：需切 `llm-deepseek` 路由 + 显式声明 models 才生效，**属独立任务**（见 T-11） | D-4 可达性 |
| ~~T-08~~ | ~~工具定义（D-6）要不要关~~ | ✅ **已按拍板落地（2026-09-11 心跳 58）**：<br>▸ **实测口径**（T-13/D-7）：TT 请求体**完全没有** `tools` 字段；DSHT 侧实测 **32 个**（早期记录写 31 —— 工具数随当时注册的插件集浮动，故两个数字都出现过；以最近一次抓包 32 为准）<br>▸ **修法**：`system-prompt/assemble` 按「是否 RP 会话」修剪 —— 见 **T-59**<br>▸ **保留面**：`lightAgent`/`heavyAgent`/`agent` 三路径**不修剪**（其预设正文明确要求调用 `lore_query` 等工具，硬关会让正文指向不存在的工具 = 新的静默不一致） | RP 会话纯净度 |
| ~~T-09~~ | ~~**存量脏楼层清洗**：`<interactive_input>` 包装 + `$1` 占位残留~~ | ✅ **按拍板选 B：不清洗，关闭本项**（2026-09-11 心跳 58）<br>▸ **实测口径**（心跳 47 复核设备真值）：含 `<interactive_input>` 的文件 **20 个 / 共 965 处**；其中 **`$1` 真未替换**的 **12 个文件 / 共 73 处**；影响面集中在 3 个会话<br>▸ **只读报告**（心跳 54，`scripts/audit-dirty-floors.mjs`，零写入）：**真脏 83 条**（`$1` 字面残留 62 / 嵌套包装 1），**受影响会话 13 个**；另有 35 条属**设计用途快照**（system-level / runtime-ctx / skill-list）不计风险；assistant 提及该标签 192 条属「模型在谈论」<br>▸ **修复已生效**：最后一次污染 09-10 08:53 UTC → 最新消息 09-11 08:12 UTC = **23.3 小时零新增** ⇒ **行为已正确，残留纯属存量**<br>▸ **拍板结论**：**不清洗** —— 只影响旧会话观感，与新版行为无关；零成本、零风险（清洗属不可逆写入，收益不成比例） | 历史聊天外观（**不影响新消息**） |

---

## 3. 与 TauriTavern 对齐的剩余差异（P1/P2）

> 基准 = TauriTavern-Canary（用户 2026-09-09 拍板）。差异全文见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md)。

| # | 差异 | 状态 | 下一步 |
|---|---|---|---|
| T-10 | D-3 role 映射（系统级内容走 system） | ✅ 主体已修 | 过渡态收敛（历史 user 席快照靠影子化逐轮折叠），观察即可 |
| T-11 | D-4 用户输入绝对位置 | ✅ **重评完成**（2026-09-11，心跳 45） | 结论维持「**有条件可达**」（非当前可达）：`dsh-llm-deepseek/lib/index.js:1849` 声明 `systemPromptUpdate:"in-history"`，`dsh-llm-pi-ai` **无**该能力；我方走 pi-ai → 默认不生效。解锁 = 独立任务（切 `llm-deepseek` 路由 + 显式声明 models），**不叠加在升级窗口** |
| T-12 | D-6 agent 层污染（32 tools / 24k 字说明书） | ⏳ 待拍板 | 见 T-08 |
| T-13 | D-7 采样参数对照（TT 侧 `GENERATE_AFTER_COMBINE_PROMPTS` dump 未采） | ✅ **对照已补齐**（2026-09-11，心跳 46 + 修正） | 新建 `rp-workspace/scripts/golden-tt-sampling.mjs`（TT WebView CDP 里 monkey-patch `fetch`+`XHR` 抓**最终请求体**；采样参数不在 prompt 事件里，必须走网络层）。**修正后结论**（首版误判已作废）：① `max_tokens` **映射正常**（切真实 ST 预设 `maxTokens=65535` → 请求实测 65535；首版用无 `maxTokens` 的示范预设测到宿主默认 384000，属**测量口径错误**）② `top_p`/penalties 未发送 = **宿主限制 H-②**（非我方缺陷，预设值已持久化待宿主支持）③ `tools` TT **无** vs DSHT **32 个** = **唯一真差异**（D-6 实锤）。详见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) §D-7 |
| T-14 | golden 接收器迁入 `ctx.webServer`（摆脱宿主进程回收） | ✅ 评估后**决定不改**（2026-09-11，心跳 45） | 现为独立 `golden-receiver.mjs`:31100，**仅在手动采集 Golden Master 对照时启用**，不进产品链路；迁入 `ctx.webServer` 会让生产代码多背一个纯测试设施（且需处理路由命名空间冲突），**无功能收益**。若将来需要常驻采集再迁 |
| T-15 | rp-plugin msg dump 口径修正（`raw.messages` → `decision.messages`） | ✅ 已修（2026-09-11，心跳 45） | 原落 `raw.messages`（RP 注入**前**的原始批）→ 与 TT 侧 `chat_completion_prompt_ready`（最终组装态）一比，差异全是假的。现改为在各出口落**最终态**（组装 + `dsht-rp/assemble` 钩子后）；`viaAssembleHook` 统一收口 |

---

## 4. 兼容面剩余缺口（P1，V0.3-FREEZE §5 列的 7 项，已核实进度）

| # | 缺口 | 状态 | 落点 |
|---|---|---|---|
| T-16 | substituteRegex 枚举 1↔2 颠倒 | ✅ 已修（2026-09-11 真修） | **原声明不成立**：枚举**一直是反的**（写 1→转义、2→不转义），基准 `substitute_find_regex` 是 `{NONE:0, RAW:1, ESCAPED:2}`（TT `extensions/regex/engine.js:303-307`）；且 `ctx.substituteRegex` 回调**从未被任何调用方注入** = 模式 1/2 全程死代码（真实数据里 substituteRegex 全为 0，故长期未暴露——实测 2 份真实 settings：9 条 + 21 条，`{"0":9}` / `{"0":21}`）。本次：[engine.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/regex/engine.ts#L126-L140) 纠正方向 + 新增基准同款 `sanitizeRegexMacro` 转义；[dsh-plugin/index.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsh-plugin/index.ts#L1131-L1151) 把回调接上（RAW=只替换，ESCAPED=每个已解析宏值过转义，对齐 TT `resolveRegexString`）。测试 6 例，反控 5 例红 |
| T-17 | 正则 `$1/$<name>` 捕获组失效 | ✅ 已修（2026-09-11 补齐 `$<name>`） | **原声明不成立**：2026-09-09 只落了 `$1..$99` 数字组，`$<name>` 具名组从未实现（头注释却一直声称支持）→ 具名组字面残留。本次在 [engine.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/regex/engine.ts#L158-L195) 与 [display-compiler.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/display-compiler.ts#L323-L352) 两处补齐（含「组未命中给空串」ST 语义），正控 3 例 + 反控（stash 后 2 例红） |
| T-18 | `{{match}}` 大小写不敏感 | ✅ 已修（2026-09-11 补齐主引擎） | **原声明不成立**：原写「v181 改 `/gi`」，但那次只改到 `th-shim.ts:1270` 的**同步路径**；主链路的 [engine.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/regex/engine.ts#L202) 一直是 `/g` → 大写 `{{MATCH}}` 在 prompt/display 主链路漏替换成字面量（display-compiler 已是 `/giu`，同一语义两处不一致）。<br>**并同批修 R4（trimStrings 作用点，属 T-18 同条审计项）**：基准 `filterString`（TT engine.js:613-621）只对**每个捕获组内容**过滤且 trimString 自身过宏；我们原实现对**替换后整串** split-join → 会把替换串里用户字面写的标记一并削掉。两处引擎均改为基准语义。<br>**顺带推翻一条被固化的错期望**：原测例名「`{{match}}` 引用与 trimStrings」断言 `'a foo b'`（即缺陷行为）——已按基准重写为 5 条。反控 5 例红 |
| T-19 | shim `Mvu.parseMessage` 与 `state/mvu.ts` 不对称 | ✅ 已修（2026-09-11 真修） | **原声明不成立**：原写「直调 `state/mvu.ts` 的 `parseUpdateVariable`（同源，非各写一份）」——**不成立**。`th-shim.ts` 是**构建期注入的字符串**（`buildShimSource` 的模板串），**没有 import 能力**，实际是自写的一份简化版：只认 `<JSONPatch>` 子块，缺 `<initvar>` YAML 树与 `_.set/_.inc` 指令行；且用 `.match()` 单次匹配（多块只解析第一个）+ 无 op 白名单 + 无 `insert` 的 index 并入 + 无 `from`。本次按 `state/mvu.ts` 四来源逐条镜像为 [th-shim.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/th-shim.ts#L1780-L2010)，并加**差分测试**（同输入下 `Mvu.parseMessage` ≡ `parseUpdateVariable`，含 matchAll/白名单/insert/from 回归）6 例；反控 5 例红。<br>⚠️ 硬约束：两侧无法共享模块，改任一侧**必须同步另一侧**（已写进两侧注释） |
| T-20 | `getTavernRegexes` 未对齐真 TH **snake_case** 形状 | ✅ 已修（2026-09-10，e78e433） | 出口/入口双向映射 + 契约测试 `th-regex-contract.spec.ts` |
| T-21 | `getChatMessages` / `getWorldbook` / `deleteVariable` 字段透传 | ✅ 已修（2026-09-11 补两处漏项） | 逐项对真 TH 类型定义补齐。核出**两处漏项**：<br>① **`delete_occurred` 路径口径**：值本身补上了（2026-09-10），但路径判存 [dshtPathExists](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/th-shim.ts#L699-L733) 只按 `.` 切分，而 host 用 **lodash 路径**（`a.list[0]`）→ 下标路径被当成单个键名、恒判"不存在" → **`delete_occurred` 对下标路径永远是 `false`**（脚本据此误判"没删掉"）。已镜像 host 的 `lodashPathToPointer` 分词。<br>② **`display_index` 完全缺失**：LorebookEntry 契约的**必填**字段（`lorebook_entry.d.ts:4`），基准由 `getLorebookEntries` 读面提供（`lorebook_entry.ts:136`），取值链 `extensions.display_index ?? 数组下标`（`compatibility.ts:63`）——我们从未产出 → 卡脚本读该字段恒 `undefined`（排序/去重类逻辑静默落空）。已补 `thDisplayIndex` + 两个调用点传下标。<br>两处共 6 例断言，反控 1 + 5 例红 |
| T-22 | `setglobalvar` 宏族 | ✅ 已修（2026-09-11 补宏形态） | **原声明不成立**：落点写 `th-shim.ts:1339+` 是**斜杠形态**（`/setglobalvar`，triggerSlash），而真卡（ExampleGame 等）用的是**宏形态** `{{setglobalvar::…}}`——该形态此前完全没有，整串被当未知宏原样留在提示词且**变量从不写入**。本次在 [macros.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-plugin-shared/macros.ts#L396-L416) 补齐 `set/add/inc/dec/getglobalvar` 五宏（TT `variables.js:250-259` 对照），写侧带 `scope:'global'` 并由两处落盘方分流到 `rp/variables/global.json`；测试 6 例，反控 5 例红 |

---

## 5. 验证债（P1，最大欠账）

### T-23　真机/模拟器回归清单（V0.3-FREEZE §5 序1）　✅ 完成（2026-09-11 心跳 45）
- 开场白 / 世界书（GENERATE·@INJECT·RENDER）/ MVU（initvar·UpdateVariable）/ tableEdit /
  文件预览 / 悬浮球拖动 / A1·A2 复测 / variant groups 同锚点复测
- 完成标志：每项有 probe 脚本或截图证据，结果回写本表
- **结果**：脚本化覆盖 **21/21 全过**（`rp-workspace/scripts/stage4-regression.mjs`）：
  会话审计 / attach / 世界书（双门面）/ MVU（variables 读 + initvar + patch + statusbar）/
  记忆 / 回退掩码 / 变体组 / TH 变量+schema+楼层门面+正则门面 / EJS / rp/home /
  rp/books / rp/chat-prefs / rp/status
- 未脚本化的 UI 交互项（悬浮球拖动 / 文件预览）保留人工复核，非阻塞

### T-24　回归清单看板化　✅ 完成（2026-09-11 心跳 45）
- 把上述清单落成可执行脚本（参照 `tmp/verify-fixes.mjs` 模式），避免「口头验过」
- **结果**：`rp-workspace/scripts/stage4-regression.mjs`——同源直连数据面、退出码 0/1、
  可重复跑；**探针自净**（MVU 写操作走一次性 sessionId + 跑完删文件，真实会话零污染）

---

## 6. 发布前准备（P2，三硬门槛做完才能公开）

### T-25　仓库大扫除（**一票否决**）　🚧 阻塞中
- **当前阻塞**：用户指令「全部功能干好之前，仓库 RP 数据冻结不动」（2026-09-03）
- 解冻条件：T-04 装机验证通过（**待你在真机验三条基线**）+ 对齐差异收敛
- 内容：清角色卡图 / 聊天记录 / 世界书正文 / 带服务器地址日志 / 测试脚本抓的真实对话；重写 `.gitignore`
- 完成标志：仓库内**搜不到任何真实人名/卡名/服务器地址**
- 附带：`stage3-device/` 859MB 备份是否入库 → 建议忽略（`.gitignore` 已含 `stage3-device/`、`backup/`、`*.apk`）

> **注**：`.gitignore` 已覆盖三级敏感面（`*.apk` / `backup/` / `stage3-device/`），
> 大扫除的剩余工作 = 全库扫描真实卡名/人名/服务器地址并清理 —— 属冻结解除后的动作。

### T-26　README　✅ 完成（2026-09-11 心跳 45）
- 内容：这是什么 / 不是什么 / 法律边界 / 致谢 / **alpha 限制声明**
- 完成标志：新人 5 分钟看懂
- **结果**：新建 `README.md`（109 行），含：
  ① 「这是什么」（两层架构 + Tier 1 能力清单）
  ② 「这不是什么」（5 条否定 + **Tier 1/2/3 分级承诺表**）
  ③ 法律边界（5 条 + 上游许可说明）
  ④ 「关于 DSH」（合规红线：官方源码零修改、个性化走插件、平台补丁可查）
  ⑤ Alpha 限制声明（6 条已知限制 + 数据安全建议）
  ⑥ 致谢 / 快速开始 / 项目结构 / 反馈
- 数字核实：源码 37,380 行 / 98 文件；7 个自研插件；内嵌 DSH `0.1.5-rc.1`（MIT）

### T-27　GitHub Releases 渠道 + 应用内检查更新开关　🔄 **部分完成**（2026-09-11 心跳 46）
- 现状：正式签名 / 更名 / 图标 / 版本号 / 一键出包 **已完成**
- ✅ **不依赖外部决定的部分已落地并实机验证**（心跳 46）：
  - **版本可见性**：`/rp/build-info` 增返回 `appVersion` / `appVersionCode` / `appAbi`
    （Android 侧 `NodeService` 注入 `BuildConfig.VERSION_NAME`，与 `build.gradle.kts` **同源**，不手抄）
  - **「版本与更新」面板**（RP 界面 →「导入」页）：显示本机版本 / DSH 运行时版本 / 构建标记；
    更新源可配置（自动识别 GitHub Releases 或静态 JSON 两种形态）；一键「检查更新」
  - **版本比较内核**：`dsht-plugin-shared/version-compare.ts`（纯函数，零依赖，宽松 semver：
    容忍 `v` 前缀 / 缺位补 0 / 预发布 < 正式版）；**失败一律显式**，绝不静默当"已是最新"
  - **更新源形状适配**：`dsht-plugin-shared/update-feed.ts`（两种形态归一 + **按本机 ABI 挑下载包**）
  - 新增路由：`/rp/update-config`（读/写）、`/rp/check-update`
  - **实机判据 8/8**：未配置 / GitHub 形态 / 静态 JSON 形态 / 同版本 / 更旧 / 版本号看不懂 /
    网络失败 / 非法协议；含 ABI 挑选正确性（x86_64 机器选中 x86_64 包、忽略 arm64 包与校验和文件）
  - 单测 +28（`version-compare.spec.ts` 14 + `update-feed.spec.ts` 14）
- 🚧 **仍阻塞（需你先决定）**：更新源**填什么**——即目标 GitHub 仓库（公开 or 私有？影响鉴权）。
  代码已就绪，填上地址即可用；**当前留空**（面板会明说"还没配置更新源"）
- 旁：`/rp/check-update` 只做检查，不自动下载安装（避免在未定渠道前引入自动更新风险）

### T-34　类型闸门：UI 层无 `tsc` 覆盖　✅ **完成**（2026-09-11 心跳 47）
- **背景**：`npm run typecheck` 原为 `tsc -b tsconfig.json`，**产出 2546 个错误 → 恒红 = 没有门**
  （缺 `allowImportingTsExtensions` + 缺 `jsx`/`@types/react`）。L14 的"让 tsc 拦"对策当时并不生效
- ✅ **core 层**：`tsconfig.core.json` + `typecheck:core` → **0 错误**（心跳 46 建；心跳 47 把 include
  扩到**插件端源码**：`dsh-plugin` / `dsht-plugin-memory` / `-prompt-template` / `-tavern-helper` /
  `-undo` / `-mvu`——此前只覆盖纯逻辑层，**插件入口不在闸门内**）
- ✅ **UI 层**：装 `@types/react`(+dom) 并**写进 `devDependencies` + 锁文件**（此前靠临时
  `npm install --no-save`，换台机器即失效）；新建 `src/types/dsh-host-externals.d.ts` 声明宿主
  模块表直供的 `dsh-client-ui-slots` / `-primitives`（本仓库不安装，故长期 TS2307）；
  `tsconfig.check.json` 补 `ES2023.Array`；`typecheck` 改为 `core && ui`
- ✅ **正控（两配置各一次，L23 要求）**：注入未定义标识符 → **TS2304**；`boolean === 0` →
  **TS2367**；`number + boolean` → **TS2365**。证明闸门真的会 report，不是摆设
- ✅ **闸门覆盖已核实到"当初出事的那两个文件"**（2026-09-11 复核）：
  `tsc -p tsconfig.core.json --listFiles` 确认含 `src/dsh-plugin/index.ts`（曾漏 import
  `loadSheets`/`renderTablePrompt`/`expandTableMacros` 与 `deepMergeInitVars` 的文件）
  与 `src/dsht-plugin-memory/tables.ts`（被漏导入的定义方）→ 同类回归会被**编译期**直接拦死。
  **再跑一次现场正控**：往 `src/dsh-plugin/` 注入未声明标识符 → `typecheck:core` 立刻报
  **TS2304**（清理后复归 0 错）
- **闸门一开就抓出 5 个「函数在、不抛错、但从未生效」（静默失败族）**：
  1. 🔴 **表格记忆（E1–E12）在 `dsh-plugin` 侧全是自由变量**：`loadSheets`/`renderTablePrompt`/
     `expandTableMacros` 定义在 `dsht-plugin-memory/tables.ts`，调用处**只调用不导入** →
     ReferenceError 被空 catch 吞掉。产物实证：三名字引用 3/2/1 次、**定义 0 次**。「表格宏展开」
     与「E3 表格快照注入」自基线起从未生效
  2. 🔴 **`deepMergeInitVars` 在整个 git 历史中从未存在过** → D1 MVU initvar 开局变量初始化
     一直走 `catch { 不阻塞 }`，世界书的 `<initvar>`/`[InitialVariables]` 从未落地
  3. 🔴 **EJS subset 引擎返回值被当数组用**：`renderMessages` 返回对象却被当数组 →
     `r.messages[k]` 恒 undefined → **含 `<% %>` 的楼层正文被静默清空并落盘**
  4. 🟠 `events: r.events + norm.changed + v3.changed`：number+number+**boolean**（L14 同型）
  5. 🟠 UI 层：`PresetPanel` 的 `expandedKey` 缺 state（点展开即 ReferenceError 整屏崩）、
     `PluginCards` 的 `TextRow.na` / `usePluginSettings.alive` 未暴露（不可用提示永不显示）、
     `RpScriptHost.tsx:174` 依赖 Iterator Helpers（**Android WebView 无 → 删变量全废**）、
     `RpNativeChat` 恒假分支、`TimedCache` 泛型双重 Promise
- **顺带修掉构建不可复现**：vendor 5 包（jquery/jquery-ui/lodash/yaml/zod）此前靠
  `npm install --no-save` 装、**未在任何清单声明** → 一次 `pnpm install` 全部消失、构建挂
  11 条 `Could not resolve`（且报错行指向仓库里根本不存在的虚拟文件名 `th-vendor-entry.mjs`，
  极易误判成源码写错）。现三处对齐：
  · `scripts/vendor-deps.json` = **版本权威表**（版本 + 逐包理由，唯一事实来源）
  · `scripts/vendor-deps.mjs` = 构建前**自愈 + 复核**（`build-rp-ui.mjs` 顶部调用）；
    `--check` 只报告。缺包/漂移即按锚定表整批重装并复核，复核不过直接抛错
  · `package.json` devDependencies = 同版本**显式声明**（+ 锁文件同步）
  ▸ **为什么两处都要**：只放锚定表 → `pnpm install --frozen-lockfile` 装不到、干净克隆仍崩
  （这正是原缺陷的复现路径）；只放 package.json → 版本理由无处安放、且与自愈脚本可能漂移。
  故声明版本**必须与 `vendor-deps.json` 逐字一致**（当前 3.7.1 / 1.13.3 / 4.18.1 / 2.9.0 / 4.5.4），
  否则会出现「pnpm 装 A 版 → 自愈改回 B 版」的振荡。
  这 5 包只服务构建、**不进 APK 依赖图**（esbuild 按 import 打包，不按 package.json）
- **验收**：`npm run typecheck`（core+ui）**全绿**；单测 **838/838**；`build-plugins.sh`
  **构建通过**（vendor 锚定命中）；`pnpm install` 退出码 **0**（此前恒 1，见下）
- **另修**：`pnpm install` 此前恒以 `ERR_PNPM_IGNORED_BUILDS` 退出 1（esbuild postinstall 被
  供应链策略拦下，依赖其实装好了但非零退出会打断任何把 install 串在前的脚本/CI）→
  新增 `packages/pnpm-workspace.yaml` 显式放行 esbuild
- 详见 [.goal/upgrade-0.1.5/LEARNINGS.md](.goal/upgrade-0.1.5/LEARNINGS.md) L26–L29

### T-36　🔴 **修复器把可读会话改成不可读**（自己的迁移补丁污染 v3 文件）　✅ **已修**（2026-09-11 心跳 47）
- **实机现象**：会话打不开。UI 红字
  `Failed to load history: stored session "session-fdfc1a28-…" is corrupt: invalid committed event
   at line 22: format v3 system/message at seq 21 requires exact replace fields op/startSeq/endSeq`
- **根因**：`dsht-plugin-shared/session-repair.ts` 在 :198 / :248 **无条件**写 v2 形状
  `{op,start,end}`，而调用点（`dsh-plugin` 的 `scanSessionHeaders()` 循环）**不看 `header.version`**，
  把修复器施加到**全部存量会话**（含已是 v3 的）→ v3 严格校验器
  （`dsh-session-format-v2-to-v3/lib/index.js:323`）拒收。
  **修复器每次启动都跑 → 会自我扩散**：修一次、坏一次。
- **为什么此前没抓到**：阶段 3 的判据用 `foldSurface`，它读 surfaceOp 走**兼容读取器**
  （两代字段名都认），比**真正加载会话日志的严格校验器**宽松 → **验证读侧 ≠ 运行时读侧**
- ✅ **修复**：`repairSessionForV3` 按被修文件的 `header.version` 分叉（v3→`startSeq/endSeq`，
  v0–v2→`start/end`）；并补**自愈判据**（v3 文件里出现 v2 形状 replace 本身即记 `changed`，
  否则"除字段名外全合法"的污染文件会早退、永远修不好）
- ✅ **回归**：+5 测试（v3 出 startSeq / v0 保 start / assistant-replace 拆出的标记也用 startSeq /
  幂等 / 自愈不早退），**负控实证**：退回旧行为 → 3 条立刻失败
- ✅ **存量文件的实际修复：已完成**（2026-09-11 心跳 47，设备实证）。
  原先记为「待你拍板（落盘=改用户数据）」，但**修复器自愈逻辑已在设备启动时自动执行完毕**：
  | 文件 | 行数 | replaceOp v3 形状(`startSeq`) | v2 形状(`start/end`) |
  |---|---|---|---|
  | `session.v3.jsonl.bak`（修复前快照） | 204 | **0** | **26** |
  | `session.v3.jsonl`（修复后） | 319 | **66** | **0** |
  即：26 处 v2 形状 → 全部改写为 v3 形状，`.bak` 已按原子写规范留底；该会话 UI 报错消失、
  可正常打开（`startSeq` 计数与 v3 契约一致）。**无需再拍板**——数据已修好且可回滚（`.bak` 在）。
  详见 LEARNINGS **L30**

### T-37　🟠→✅ 宿主全局面缺口：`SillyTavern`（已修）／`eventSource`（已修）／`Vue`（**判定为 TT 同等行为，不改**）
**结论先行：拆成三件事，各自有独立证据，其中两件是真缺口、一件是误判。**

#### (a) `SillyTavern is not defined` —— ✅ **真缺口，已修（设备 A/B 实证）**
- **证据链（三条独立）**：
  1. **基准源**：真 ST 宿主页有 `globalThis.SillyTavern = { libs, getContext }`
     （`SillyTavern-reference/public/script.js:292`「API OBJECT FOR EXTERNAL WIRING」），TT 同。
  2. **触发源**：设备 CDP `Runtime.exceptionThrown` → `ReferenceError: SillyTavern is not defined`
     @ `https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js:55`（**宿主帧**，非 iframe）。
     抓下该脚本（220KB）逐条枚举取用面：`SillyTavern.getContext` **11 处**，首行即
     `const ctx = SillyTavern.getContext(); for (const p of ctx.chatCompletionSettings.prompts)`；
     另有 `ctx.chat?.[…]`（取 `.mes/.is_user/.is_system/.swipe_id`）、`const { uuidv4 } = …`。
  3. **缺面**：设备实测宿主帧 `sillyKeys = null`（无该全局）；脚本帧有、宿主帧无。
- ✅ **修复**：`host-vendor.ts` 新增 `installHostSillyTavern()` + 纯函数 `buildHostStContext()`
  （`??=` 语义，宿主已有则一字不改；`libs` 只暴露真有的 lodash）。
  `index.tsx` 启动时以 `RpScriptHost` 的会话快照为源装上。
- ✅ **实机判据**（新包 v233/234）：宿主帧 `sillyKeys = ["libs","getContext"]` —— 与真 ST **逐字同形**。

#### (b) `ctx.eventSource` 缺失 —— ✅ **真缺口（补齐 (a) 后才暴露的第二道墙），已修**
- **证据（A/B 的「错误往深处移」）**：补 `SillyTavern` 前 → 脚本死在 `:55`（整段作废）；
  补齐后 → **同一脚本推进 2190 行**，改死在
  `ctx.eventSource.on('module_imported', …)` → `TypeError: … reading 'on'`（`inject.js:2245`）。
  全篇 `eventSource` **27 处** = 它的事件挂载总入口。
- 真 ST `getContext()` 返回体含 `eventSource`；我方**宿主与 iframe 两侧都没有**
  （iframe 只有函数式 `eventOn/eventEmit`，从未包成 `eventSource` 对象 → 实测脚本帧 `eventSource=undefined`）。
- ✅ **修复**：新建**单源**发射器 `client/th-event-source.ts`（逐条对齐真 TH 语义：
  `on/once` 对同一函数引用**幂等**、`makeFirst/makeLast` 是**移动**不是新增、
  `emit` 顺序串行且 await、单监听器抛错**不扩散**、返回 `{stop}` 句柄）；
  `getContext().eventSource` 接**进程级单例**（否则脚本的 `off` 摘不掉自己挂的监听）。
- ✅ **回归**：+16 测试；**负控**：去掉幂等 → 2 条立刻失败。
- ⚠️ **残留（记 T-39）**：iframe 侧 `SillyTavern.getContext().eventSource` 仍缺，
  卡在架构上（shim 是构建期拼进 iframe 的整段字符串，无法 import TS 模块）。

#### (c) `Vue is not defined` —— ❌ **不是移植缺口，判定为「与 TT 同等行为」，**有意不改**
- **实测定位**：异常发生在**脚本帧**内、栈顶为
  `vue-router/dist/vue-router.global.prod.min.js:12` —— 即**卡自己**用
  `<script src="https://testingcf.jsdelivr.net/npm/vue/…">` 从 CDN 拉 Vue 与 vue-router，
  Vue 未就绪/拉取失败时 vue-router 先执行 → 报错。
- **基准对照**：真 ST 首页 `public/lib/` 与 `index.html` **均无 Vue**（只有 jquery 家族/toastr/select2…），
  `grep -rn "window\.Vue\s*="` 在 ST 与 TT 全仓 **0 命中** → **TT 上同样会报这个错**。
- → 按验收基准（与 TT 三方一致），**主动提供 Vue 反而构成偏离**，故不改；
  仅记录该卡存在 CDN 依赖（离线时其前端自渲染会失效，属卡侧问题）。

#### (d) 顺带核对：`showdown` 仍缺，但**无 ReferenceError 证据** → 不猜着补
真 TH `predefine.js` 的合并清单含 `showdown`（文档 `DSH Android Roleplay App Plan.md:15603/20664`），
当前 9 个脚本帧实测 `showdown=undefined`。但没有任何卡脚本抛 `showdown is not defined` ——
按 L31 纪律（面名从**实际报错**枚举，不凭文档猜），**只登记不实施**。
同时确认真 ST 的 `showdown` 是 `import` 进来的模块变量（`script.js:2`），**不是**宿主全局，
所以「宿主缺 showdown」本身也未必构成与 TT 的差异。→ 等第三次冒同类现象再升时间盒。

### T-39　🟠 iframe 侧 `SillyTavern.getContext().eventSource` 仍缺（宿主侧已修）
- 现状：宿主页已有可用 `eventSource`（T-37(b)）；脚本 iframe 内 `getContext().eventSource` 仍是 undefined。
- **阻塞在架构**：`th-shim.ts` 整段是构建期拼进 iframe 的**字符串**（`buildShimSource`），
  无法 `import` `th-event-source.ts`。要么改成「注入式装配」（把共享模块源码作为参数传进去），
  要么在字符串里再抄一份（**违反单源纪律，不做**）。
- 触发条件：出现**卡脚本在 iframe 内**用 `ctx.eventSource` 的实测报错时再升。

### T-42　🔴 **当前前线**：卡的注入脚本要挂到 ST 的正则面板 DOM（`#saved_regex_scripts`），我们没有
- **暴露方式**：T-40 / T-41 修完后**再跑同一个采集器**，错误**第四次前移**（L35 又一次生效）：
  `TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'`
  @ `RegexBinding@inject.js:3885 ← (anon)@inject.js:2311`（**宿主帧**）。
- **源码定位**（`tmp/t37-inject.js:3885`）：
  ```js
  const observerTarget = $('#saved_regex_scripts');
  observer.observe(observerTarget[0], { childList: true, subtree: true });   // [0] === undefined → 抛
  ```
- **基准对照（L36 三问）**：① 基准有吗？**有** —— ST
  `SillyTavern-reference/public/scripts/extensions/regex/dropdown.html:96` 与 TT
  `src/scripts/extensions/regex/dropdown.html:101` 都是
  `<div id="saved_regex_scripts" no-scripts-text="No scripts found" …>`；
  ② 报错在哪一侧？**宿主帧**，卡自己的脚本（`inject.js` 被注入到 **DSH 宿主页**，非 iframe）；
  ③ 基准会不会同报？**不会**（元素存在）→ 判定为**真缺口**。
- **为何不是"补个空 div 就完事"**：卡的 `inject.js` 是**ST 前端增强脚本**（`injectSPresetMenu`、
  正则面板绑定、往 `#saved_regex_scripts` 渲染脚本行、`updateSTRegexes()` 同步到
  `extension_settings.regex`）。它的功能**假设宿主是 ST 的前端 DOM**；DSHT 的前端是 DSH 的 UI。
  只摆一个空容器而不把 ST 全局正则接进我方渲染/引擎 → **造出新的静默失败**
  （卡以为挂上了、用户看不到、正则也不生效）。**故不先做半吊子修复。**
- **影响面**：该抛错会**中断卡 bootstrap 的后续三行** ——
  `ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` 均不再执行。
- 🔴 **心跳 57 根因修正（决定性，前面 5 个心跳的"选项 A/B"是个伪选择）**：
  这条缺陷**真正的根不在 DOM，而在更早的一层** —— 我方宿主页**没有 ST 标准的 `/version` 端点**
  （实机 `GET /version → 404`）。卡的宿主脚本 `inject.js:2210-2218` 用
  `fetch('/version').then(d => window.versionNumber = +v[0]*10000 + +v[1]*100 + +v[2]).catch(() => 10000)`
  取版本，**取不到就静默落回 10000** → 该脚本内 **20+ 处** `versionNumber >= 11305` 分叉
  **全部走旧版分支** → 才去找 ST **旧版**正则面板的 DOM（`#saved_regex_scripts` 等 17 个 id）。
  **基准（TauriTavern）**：`src/compat-version.js:1` `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`
  → 卡得 11800 → **走新版路径**（原文注释「11305+ has built-in regex binding; ST is source of truth,
  only sync FROM ST」）。→ 属 L36「跟基准一致**既不能少也不能多**」的「少了」一侧，
  **不是产品决策，是缺陷**。详见 **T-56** 与 LEARNINGS **L71/L72**。
- **✅ 心跳 58 收口（推翻心跳 57 的「降级为非缺陷」）**：心跳 57 的理由是「ST 1.13.5+ 下卡
  主动**不往这个锚点渲染**（`inject.js:4196` 的 `if (versionNumber >= 11305) return;`）」——
  **这个理由对 `#saved_regex_scripts` 成立，但对 `extension_settings.regex` 不成立**。
  本轮用**按卡逐字取法**的探针实测：卡在**无条件调用**的 `updateSTRegexes()`（`:3892`）里读
  `extensions.regex.length`（`:3997`）→ 我方该键恒 `undefined` → **取值先抛 TypeError**
  → `RegexBinding()` 整段中断（影响面正是本条登记的「后续三行不执行」）。
  详见 **T-60**（含修法与反控）。
- **选项（原口径，已被上条修正取代；保留以便回溯）**：
  - **A**：提供 ST 拓展面板挂载点（`#saved_regex_scripts` 等）**并**把 ST 全局正则
    （`extension_settings.regex`）真接进我方正则引擎 → 真修，工作量中等偏大。
  - **B**：不补，登记为已知差异 → 卡的上述核心功能保持缺失。
  - **C**：只补容器 → **不做**（半吊子 = 静默失败，违反项目纪律）。
- **心跳 49 代价量化（决策材料，非新结论）**：
  - `tmp/t37-inject.js` 实际引用 **16 个** ST DOM id：
    `#saved_regex_scripts` / `#bulk_select_all_toggle` / `#bulk_enable_regex` / `#bulk_disable_regex`
    / `#bulk_delete_regex` / `#bulk_export_regex` / `#import_regex` / `#import_regex_preset`
    / `#import_regex_preset_file` / `#open_regex_editor` / `#open_preset_editor`
    / `#openai_preset_import_file` / `#saved_spreset_scripts` / `#preset_scripts_block`
    / `#completion_prompt_manager` / `#sort_regexes` / `#squash_enabled_content`（含 `#squash_enabled_content` 共 17 个表面 id）。
  - 我方源码对这 17 个 id **命中 0 个**（逐一 `grep -rl` 于 `packages/src`，全为 0）。
  - ✅ **降险事实**：卡的 **34 条正则（17 启用 / 17 停用）已经通过我方管线真实加载并生效**
    （三源合并 global→character→preset），回归已实证 → 缺的**只是「ST 面板 DOM 这一层皮」
    + `extension_settings.regex` 这个全局引用**，**不是正则引擎本身**。
  - 复用面：我方已有 `dsht-rp-ui/src/client/RegexPanel.tsx` + `/regexes/get`、`/regexes/replace`
    等路由，A 方案可在此之上做挂载适配，不必从零造面板。

### T-43　🟠→✅ 会话修复链的「跳过」不可见（心跳 49 新暴露，**同日收口**）
- **现象**：设备侧 `POST /rp/repair-sessions` 返回 `scanned 80  repaired 0  skipped 2`，
  目标会话的 skip 原因 = **`live（关闭会话后重跑）`**；另一份 = `文件 62.3MiB 超 32MiB 上限`。
- **第一步归因（错的那一步）**：以为"修复器没跑"。**实为"跑了、但按设计跳过了"** ——
  因为出日志的条件写的是 `repaired > 0 || errors > 0`，**「只跳过」这种组合被排除在外**，
  于是日志里一行都没有，排查时线索为零。
- 🔴 **真缺陷 = 静默的有意行为**（→ 固化为 LEARNINGS **L42**）：跳过/短路/降级同样是"事件"，
  必须留痕，且要留到能定位**具体对象**（哪个 sessionId、什么原因），不能只给计数。
- ✅ **已修**：`repairAllSessionSeqs` 出日志条件加入 `skipped.length > 0`；按原因归类计数
  （`live×N` / `超上限×N`）；并**逐条**打印被跳过的 sessionId 与原因。
- ✅ **设备实证（重装 v243 后冷启动）**：
  ```
  [dsht-rp] repair-sessions: repaired=0 skipped=1 errors=0 skippedReason={"超上限":1}
  ```
  —— **`live` 跳过消失了**，只剩那条 62.3MiB 超限的。说明：
  ① 「启动即修窗口」（`dsh-plugin/index.ts:3015`）**确实在会话变 live 之前跑**，设计成立；
  ② 之前观测到的 `live` 是因为**探针在会话已打开之后才发**，不是修复链的缺陷；
  ③ 现在日志能一眼看出"谁被跳过、为什么"。
- **残留（低优先）**：`超上限 32MiB` 那条（62.3MiB）—— **已定性为非缺陷，见下**。
- **已产出工具**：`scripts/diag-session-loadable.mjs`（官方 `new Session(...)` 为 oracle，含 `--selftest` 负控）
  + `scripts/ui-accept.mjs`（设备 UI 验收探针）+ `scripts/check-apk-payload.py`（APK 内产物标记核验）。

#### T-43 结论（2026-09-11 心跳 50）：**非缺陷 —— 之前是我方的测量口径错了**

| 判据 | 证据 |
|---|---|
| 它是什么 | `sessions/--…rp-import-_adapter--/64e580f0-…/session.jsonl`（62.3MiB，header `"version":0`），首行写着 `origin:"subagent"`、`agentPreset:"dsht-adapter"`、`parentSession:session-5a1b4508` → **一次性 ST 预设导入管线的子代理会话**，**从未在聊天 UI 打开** |
| 它需要修吗 | **不需要**。`verify-session-pipeline.mjs` 对设备整树（含该文件）判 **81/81 可迁移 / 运行时拒载 0**；官方 v0→v1 迁移器**本就会**展开 packed 聚合行（`PACKED_TAGS`），我方修复器的同一动作是冗余的 |
| 那 62.3MiB 为什么会"坏" | **它不坏** —— 是我用 `diag-session-loadable.mjs` 把**原始 v0 事件**直接喂 `new Session(...)` 得到的假阳性：该口径**不做 v0→v3 迁移**，对 v0 文件根本不成立（详见 LEARNINGS **L45**）。同一份数据被两个工具判出相反结论 = 口径 bug |
| 处置 | ① 跳过的日志**加身份**（`｜origin=subagent，agentPreset=dsht-adapter → **非用户聊天**（subagent）`）——L42 的"有意跳过也要能定位到具体对象"，设备实证已生效；② 32MiB 上限**保持不变**（它保护的是 OOM crash-loop，不是这个文件） |

### T-44　🆕 **把「运行期逐个撞墙」改成「静态一次性枚举」**（心跳 50，新防线）
- **动机**：T-37 → T-40 → T-41 → T-42 是**串行**证明链（每轮只暴露一个缺口，因为卡脚本「首个异常即整段作废」），
  四轮才走到 `inject.js:3885`。
- ✅ **新建** `scripts/audit-card-context-surface.mjs`：静态解析卡脚本对 `SillyTavern.getContext()` 的
  **全部**成员访问路径（别名绑定 / 解构 / 内联链 / 可选链），与**真 ST 权威面**
  （`st-context.js` 的 getContext 返回体，**145** 个顶层成员）对质，一次列出「真 ST 有、我方宿主面没有」的
  **全部**成员 —— **首跑即得 13 个缺口**（分类：真 ST 有 19 个、真 ST 也无 0 个）。
- ✅ **解析器跑了正控**（`--selftest`）：覆盖**简写属性** / 嵌套括号 / 字符串内逗号 / 注释内逗号。
  ⚠️ 首版解析器只按 `key:` 取键 → 145 个成员**只认出 33 个**（简写属性全漏）→ 差点产出一条**虚假防线**（LEARNINGS **L44**）。
- ✅ **落地缺口里"不依赖桥"的 15 个成员** → **缺口 13 → 6**：
  | 组 | 成员 | 基准出处 |
  |---|---|---|
  | i18n | `t` / `translate` / `getCurrentLocale` / `addLocaleData` | `i18n.js:6-113` |
  | 弹窗 | `POPUP_TYPE` / `POPUP_RESULT` / `callGenericPopup` | `popup.js:9-37` + `:739-757` 返回契约 + `index.html:6456` 模板文案 |
  | 工具注册 | `registerFunctionTool` / `unregisterFunctionTool` / `isToolCallingSupported` / `canPerformToolCalls` / `ToolManager` | `tool-calling.js` 能力查询语义 |
  | 其他 | `isMobile` / `event_types`（旧蛇形别名）/ `saveSettingsDebounced` | `st-context.js` |
- **诚实边界（不假装成功）**：`CROP` 弹窗**显式 reject**（无裁剪器）；函数工具**能力查询返 false**
  （卡注册的工具到不了模型）+ 注册**留痕**（同名只提示一次）；未支持的长尾选项**记台账**。
- **验收（全实测）**：单测 **+24**；三闸门 0 错；`typecheck` 三段式 0 错；全量 **923/923**；
  **设备行为验收 26/26**（真渲染、真点击、真解析值：CONFIRM `Yes/No`→1/0、INPUT `Save`→输入串 / `Cancel`→false、
  DISPLAY `X`→**0**、ESC→`null`、CROP→reject、注册留痕 warned=1、`saveSettingsDebounced` 真落盘且引用稳定）；
  `stage4-regression` **21/21**。
- **剩余 6 个缺口（登记，非本轮范围）**：`reloadCurrentChat`(7 次) / `substituteParams`(4) + `substituteParamsExtended`(2)
  / `getCurrentChatId`(2) / `renderExtensionTemplateAsync`(1) —— 四项都需要**宿主页 ↔ 插件桥**（当前宿主门面无法访问桥）；
  `streamingProcessor`(1) **不是缺口**（卡脚本写的是 `|| null` 兜底，`undefined` 即正确语义，属枚举器**过度报告**）。
- **📌 心跳 50 补记（把"需要建桥"降级为"接现成桥"）**：复核后确认**桥早就存在**，缺的只是**接线**——
  ① 通道：`src/client/rpc.ts` 已导出 `rpApi`（同源 `POST /dsht-rp/*`）/ `thApi` / `dshRpc`，
  且**宿主页就在这条通道上**（`installHostSillyTavern` 由 `src/client/index.tsx:123` 调用，
  该文件本身就在能 `fetch('/dsht-rp/…')` 的 DSH 原生前端上下文里）；
  ② 挂点：`buildHostStContext(src: HostStContextSource)`（`host-vendor.ts:305`）**本来就是参数化的**，
  已有 `getSnapshot` / `uuid` 两个可选注入项 → 按同一模式再加 `bridge` 提供者即可，**不需新架构**；
  ③ 因此下轮的做法是：在 `index.tsx` 的 `installHostSillyTavern({…})` 调用点注入四个提供者
  （`getCurrentChatId` 同步取值 / `reloadCurrentChat` 走既有会话重载 / `substituteParams(Extended)` 路由到
  **我方既有宏引擎**（**禁止另写一份**，否则就是与基准的第 N 份漂移实现）/ `renderExtensionTemplateAsync` 走扩展模板文件读+替换），
  每项**逐条对质基准 `st-context.js` / `script.js`** 后再落，配套单测 + `--selftest` 式正控。
- ✅ **心跳 51 收口（缺口 13 → 6 → 1，宿主门面 27 → 37 个成员）**：
  - `getCurrentChatId` / `chatId` —— 新增 `getActiveRpSessionId()`（`RpScriptHost`），
    会话 destroy 时清空（不报一个已关掉的会话）。基准两者**并存且同值**（`st-context.js:122-125`）。
  - `reloadCurrentChat` —— `reloadActiveRpContext()`（重取 `/context` + `/chat/messages` 并推全部帧）
    + `notifyDisplayMutation()`（失效显示缓存 + bump epoch 重渲染；其注释自述 = 真 TH
    `builtin.reloadAndRenderChatWithoutEvents` 的等价通道）。**无提供者时出声降级**（不静默 no-op）。
  - `substituteParams` / `substituteParamsExtended` —— 新建 `host-macro-bridge.ts`：
    **单源复用既有宏引擎** `dsht-plugin-shared/macros.ts:expandTavernMacros`（零依赖纯函数，
    可直接打进客户端 bundle），数据面复用 `display-compiler:loadDisplayRenderCtx`（身份/变量/自定义宏）
    + 补三个作用域树（`/dsht-tavern-helper/variables?scope=…`）→ 落进**同步槽位**。
    **双签名**都支持（options 对象 与 ST legacy 位置参数，卡实际用 `substituteParams(t, undefined, name2)`）。
    环境未就绪 → **原文透传 + `console.warn` 一次**（不伪造身份）。
  - `streamingProcessor` —— 如实 `null`（= 基准初值 `script.js:455`；卡已 null-guard）。
  - 为支持 `dynamicMacros` / `postProcessFn`，**扩展共享引擎**（非另写一份）：
    `TavernMacroContext` 加 `dynamicMacros`（键小写归一，命中即覆盖注册宏，`MacroEngine.js:178-220`）
    与 `postProcess`（**只作用于已解析宏**——未知宏在基准里 `executeMacro` 之前就 return raw，
    加工它会把 `{{未知}}` 也转义掉；钩子抛错返回未加工结果）。
  - 剩余 **1 个**：`renderExtensionTemplateAsync` = **T-48**（与 T-42 同域）。
- **📌 心跳 51 审计工具扩域（两次修工具，都是"防假绿"）**：
  ① 只认 `SillyTavern.getContext()` → TH 扩展的**裸 `getContext()`** 取法一条都提不出来，
  却打印 `✅ 全部具备`（**假绿**：`chat-history-backup/index.js` 有 16 处 getContext 报 0 条）→
  补裸取法 + 零访问输出 **「⚠️ 不可判定」**（并在结论行分离计数），立刻量出 7 个真缺口；
  ② `indexOf('return {')` 被**内层函数**的返回体劫持（加了 `readNames` 之后门面只解析出 2 个成员）→
  改为**按括号深度定位函数体 + 深度 1 处找 return**。**这次没酿成假绿靠 `SURFACE_MIN_MEMBERS` floor**
  （低于阈值 FATAL 而不给结论）。沉淀 **L47 / L48 / L49**。
  并新增**分面差额**输出（宿主面 37 vs iframe 面 9），**不进退出码**（否则恒红 = 没有门，L14）。
- 🔴 **📌 心跳 51 实机验收抓到的缺陷（单测抓不到，只有设备探针能抓）**：
  `ctx.substituteParamsExtended('{{char}}', {}, wrap)` 在真机上**不套 `postProcessFn`**。
  根因 = 实现把 Extended 的实参**原样转发**给 `substituteParams` 提供者 → 第 2 参 `{}` 被当成
  **options 对象**解析 → `additionalMacro` 与 `postProcessFn` **双双静默丢失且无报错**
  （卡的 `substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)` 会丢掉正则消毒）。
  基准事实（`script.js:2756-2757`）：`substituteParamsExtended` **就是**
  `substituteParams(content, {dynamicMacros: additionalMacro, postProcessFn})`，**两者形参位置不同**
  （`:2756` vs `:2922`），故**不能共用同一个提供者签名**。
  ✅ 已修：`HostStContextSource` 拆出**专用** `substituteParamsExtended?` 提供者；门面三段式
  （① 专用提供者存在 → 直接用；② 只有 `substituteParams` → **显式映射成 options**；③ 都没有 → 出声降级 + 原文透传）。
  `hostSubstituteParamsExtended` 形参改为 `unknown` 并在边界做运行时归一（非对象 `additionalMacro` 忽略且留痕）。
  ⚠️ **同时修正了原单测** —— 它原本断言「Extended 与 substituteParams **共用同一提供者**、实参原样转发」
  （`expect(seen).toHaveLength(1)`），**把缺陷钉成了契约**。已重写为 6 条契约测试，含**负控**（断言**不得**原样转发）。
  沉淀 **L50**。
- **心跳 51 验收**：三闸门 **0 错**；**971 测试 / 49 文件全绿**（+48）；`stage4-regression` **21/21**；
  设备探针 **11/11 PASS**（修复前 `B_ext_pp`/`E_ext_dyn`/`F_ext_dyn_nofn` 全 FAIL；新增 `\,` 转义真机返 `a,b`）。
- **📌 心跳 51 顺带收口两处「防线之外」的退化**：
  ① 🔴 **`macros.ts` 整个文件对 git 变成"二进制"** —— `\,` 转义用的哨兵以**裸 NUL 字节**落在源码里
  （`git diff --stat` 回 `Bin 18333 -> 21642`、`grep -n` 只回 `Binary file`）→ **该文件此后所有改动都无法进 review**，
  而它偏偏是全项目最核心的纯函数（宏引擎）。已改写为等价 `\0` 转义（运行时值不变），
  **且先补两条决定性用例**（该哨兵此前**零覆盖**：单元素含逗号必须原样返回 `a,b`）。沉淀 **L51**。
  ② 🔴 **`fetchScope` 的 `if (!r.ok) return {}` 是新造的静默失败**（服务端 5xx 与"确实没变量"在调用点等价）
  → 改为按 `scope:原因` **去重出声告警**（L42）；设备包内核验新文案已进包。
  ③ **注意 L52**：本轮 md5 产物对照被**并发实例的构建**污染（`lib/client.js` 13:40:25 vs 基线 13:40:20）
  → 等价性结论改由「决定性单测 + 产物晚于源码 + 设备探针」支撑，**不可只看 md5**。

### T-46　🆕 **iframe 门面显著窄于宿主门面**（心跳 51 量出，未定性为缺陷）
- **量出的数**：卡脚本访问的 19 个真 ST 成员里，`th-shim.ts:buildStContextFacade()` **缺 16 个**
  （`eventSource` / `eventTypes` / `t` / `callGenericPopup` / `POPUP_TYPE` / `isMobile` /
  `substituteParams(Extended)` / `getCurrentChatId` / `reloadCurrentChat` / `streamingProcessor` / 工具注册三件 / …）；
  iframe 面 9 个成员 vs 宿主面 37 个。
- **为什么现在不修**：`th-shim.ts` 整段是**构建期拼进 iframe 的字符串**（`buildShimSource`），
  **无法 `import`** 共享模块（T-41 已记录同一约束：要么改成「注入式装配」，要么在字符串里再抄一份 =
  **违反单源纪律，不做**）。这是一次独立重构（与 T-41 同一课题）。
- **触发条件**：出现**卡脚本在 iframe 内**用这些成员（尤其 `ctx.eventSource` / `ctx.substituteParams`）
  的**实测报错**时再升。当前所有已知报错都在**宿主帧**，故不阻塞。
- **下一步判据**：把 iframe 面的这些成员按「可经 postMessage 桥」/「必须同步」/「需要注入式装配」三类
  先做一次可行性分档（**零风险静态工作**），再决定是否升。

### T-47　🆕 **宿主门面仍缺的 3 个成员**（心跳 51 量出，属"需要数据模型决策"而非接线）
- `characters`（4 次）/ `characterId`（12 次）/ `chatMetadata`（9 次）—— 来源是 TH 扩展形态脚本
  `chat-history-backup/index.js` 的实测用法（`:647/666/671/1194/2545`）。
- **为什么没顺手补**：
  - `characters` + `characterId` 是**一对**，且基准语义是「角色数组 + 数组下标」，
    而我们的模型是「一会话一角色，以 slug 标识」——**不能只补一个**（否则 `characters[characterId]` 落空，
    这恰是"只补空容器 = 静默失败"的变体）。要么建一致的角色列表模型，要么显式登记为差异。
  - `chatMetadata` 基准是**会被持久化的每聊天元数据对象**；我们**没有**这个存储
    → 给 `{}` 会让脚本的写入**静默丢失**（比 `undefined` 更危险，脚本的 `if (ctx.chatMetadata)` 守卫会失效）。
- **状态**：⏳ 登记，**不做**（需先定数据模型；且当前无实测触发——DSHT 目前只跑 TH **脚本**，
  未跑扩展文件系统）。

### T-48　🆕 `renderExtensionTemplateAsync`（最后一个宿主面缺口，**与 T-42 同域**）
- **契约**：`renderExtensionTemplateAsync(extName, templateId, data, sanitize, localize)`
  → 读 `scripts/extensions/<extName>/<templateId>.html` + 模板替换 + 消毒 + 本地化（`extensions.js:137`）。
- **为什么它与 T-42 绑在一起**：卡里唯一的调用是 `renderExtensionTemplateAsync('regex', 'editor')`
  （`inject.js:4555`）—— 要的是 **ST 正则扩展的 `editor.html`**，而"把 ST 正则面板搬进来"正是
  **T-42 的 A 选项**。宿主换不出这个模板。
- **降险事实**：该契约另有**独立消费者**——已装扩展 `chat-history-backup` 调
  `renderExtensionTemplateAsync('third-party/chat-history-backup', 'settings')`，模板就是**它自己目录里的
  `settings.html`**（已核实存在）。所以一旦 T-42 决定引入扩展文件存储，这个 API 应**通用实现**
  （读文件 + 模板替换 + 缺文件即抛错，**不假装成功**）。
- **状态**：⏳ 随 T-42 一并决策。

### T-49　🟠→❌ **「编辑楼层」与「变体（swipe）切换」零入口** —— 心跳 52 实测**推翻**，判定为**非缺陷**

> **结论**：心跳 51 的「0 命中」是**测量口径的假阴性**，不是产品缺口。两项都**存在且已接槽位**。

| 半边 | 心跳 51 的判定 | 心跳 52 的实测取证 | 最终判定 |
|---|---|---|---|
| **编辑楼层** | 「`编辑\|edit` **0 命中**」 | user 行的操作条里**就在**：`<button class="dsht-rp-rollback-btn" data-testid="dsht-rp-edit" title="编辑这条已发送的消息（就近截断后以新文本重新发送）">✎ 编辑</button>`（`RpNativeChat.tsx:1899-1903`）。**实测闭环 PASS**：点它 → 就地编辑器出现（`dsht-rp-edit-area` 预填原文 11 字 `hb52 GMT 实证` + `保存并重发` / `取消`）→ 点取消 → 还原；**全程零请求、零数据变更** | **存在且可用** |
| **变体（swipe）** | 「`变体\|variant\|swipe` **0 命中**」 | 组件 `RpVariantActions` **已注册**到 `conversation.chat.assistant-actions` 席位（`index.tsx:300-306`，同席位的 `dsht-rp-regen-btn` 实测**在 DOM 里** ⇒ 槽位可用）。`RpNativeChat.tsx:1594`：`group === undefined \|\| group.members.length < 2 \|\| idx < 0` → 返回 `null`。设备当前 `variant/groups` = **`groups=1`** → **按设计隐藏**（只有 1 个变体时没有"切"这件事） | **按设计隐藏，非缺陷** |

- **为什么心跳 51 会误判**：① 探针只枚举**带 `title`/`aria-label`** 的元素，而"是否存在入口"是**DOM 存在性**问题，两者不等价；② 聊天视图是**窗口化**的（`chat-windowing.ts`，实测 DOM 里只有 **1** 个 `.dsht-rp-user-row`），操作条**只在 user 行上**——采样时刻若 user 行未挂载，就得到干净但不成立的"0 命中"（与 **L44**「枚举器的取法覆盖面就是结论的有效边界」同源，**L53 家族**）。
- **残留（低优先，非阻塞）**：变体条在 **≥2 个变体**时的渲染**尚未实机验证过**（需要先在会话里造出第二个变体 = 会动数据，故本轮**没做**）。判据：造 ≥2 变体后，设备 DOM 应出现 `.dsht-rp-variant-bar`（`title="历史变体（重 roll / swipe）"`、`aria-label="上一个变体"`），点击后真走到 `variant/switch`。
  - **心跳 57 续进展（半闭环）**：**数据面已完全闭环** —— 用**一次性会话**（`session.create`，不碰用户数据）造出 2 成员组后 `variant/switch` 返 **200**，写入形态经官方构造器判定可加载（见 **T-57** 旁注）。**仅"UI 变体条 DOM 是否出现"这一半仍未直测**（需把变体条渲染与一个 live 会话的 `groups` 状态对齐观察，属低优先观感项）。
- **探针留档**：`stage3-device/hb52/hb52-edit-entry-probe.js`（可复跑，非破坏性）。

- **历史口径（心跳 51，已被上表推翻，保留以便回溯）**：曾用「枚举 176 个带 `title`/`aria-label` 的元素 →
  `/编辑|edit/i` 命中 0、`/变体|variant|swipe/i` 命中 0」判定"零入口"，并据此认为"引擎在、入口不在"
  （`variant/groups` 数据面可用、`th-edit`/`th-append` 写桥已实现）。**该推理链本身没错，错在测量前提**：
  ① 它测的是 **title/aria-label 字符串**，而问题问的是 **DOM 存在性**；② 视图**窗口化**（实测当前 DOM 只有
  **1** 个 `.dsht-rp-user-row`），操作条只在 user 行上 → user 行未挂载时必然"干净地"命中 0。
  **元教训**：`0 命中` 必须先回答"**样本里本来该有它吗**"，否则得到的是"没找到"而不是"不存在"（L44 家族）。

### T-50　✅ **设备时区偏移式命名（`GMT` → `+00:00`）致「一条消息都发不出去」**（心跳 52 已修 + 实机闭环）

对应作战地图 **D-5a**（此前标为"待用户拍板"，**已按建议 A 落地**，该项可关闭）。

- **症状**：系统时区为 `GMT` 的手机（**模拟器默认**）→ `Intl.DateTimeFormat().resolvedOptions().timeZone`
  返回 `"+00:00"` → 宿主 `session/invalid-time-zone` 拒收 → **点发送毫无反应**（toast 一闪而过、
  会话文件零写入、logcat 无红字线索）。
- **宿主契约（唯一拒绝点）**：`@deepseek-ai/dsh-api-session-controller/lib/index.js:738-739`
  → `@deepseek-ai/dsh-util-time/lib/index.js:19-29` `canonicalClientTimeZone()`；
  接受域 = `"UTC"` 字面量 或 匹配 `^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$`
  （**必须带 `/`**）且 ICU 规范化后仍合规。**`undefined` 放行**（`:750` 字段不出现在 `source` 里）。
- 🔴 **修法落点（关键）**：主发送路径（composer 原生提交）的 `clientTimeZone` 由**官方客户端模块**
  自己采样（`…/client/time-zone.js:7` → `…/sessions/session.js:178/204`），官方源零修改 →
  只补我方 3 个调用点**等于没修**，必须**在注入层替换取样结果**。
- ✅ **实现**：`src/client/time-zone.ts` —— `canonicalizeLikeHost()`（逐字复刻宿主判定）+
  `normalizeClientTimeZone()`（`+00:00`/`GMT`/`Z`→`UTC`；整点偏移→`Etc/GMT∓N`；
  分数偏移→「全年偏移恒定」等价表 8 条；不可映射→`undefined` + 去重出声）+
  `clientTimeZoneFields()`（三处调用点统一出口）+ `installClientTimeZonePatch()`
  （替换 `Intl.DateTimeFormat.prototype.resolvedOptions` 的 `timeZone`，**只换名字不换偏移**，幂等）；
  在 `index.tsx:apply()` **最先**安装。
- ✅ **实测闭环（GMT 环境）**：① 前提复现 `TZ=+00:00`；② 非破坏性闸门对质（不存在的 sessionId，
  零写入）：`+00:00`→拒 / `UTC`·`Etc/GMT-8`·省略→过；③ 装包后页内 `patched:true`、`raw:"UTC"`；
  ④ **真实产品路径 before/after**：修前发一条 → 会话文件零变化；修后同动作 → 落盘
  `user/message seq 1202` 且 `source.clientTimeZone:"UTC"`，全 logcat `invalid-time-zone` **= 0**。
- **验收**：三闸门 0 错 · 50 文件 / **1001 测试**全绿 · `stage4-regression` **21/21**（基线一致 = 无回归）·
  双架构 APK **x86_64 v260 / arm64 v261** · APK 内载荷标记与新鲜度核验通过。
- **沉淀**：LEARNINGS **L53**（修复点 ≠ 承重点：先问"这条路径归谁"）· **L54**（映射表要用可执行的
  等价判据筛，配正控+反控；给不出精确等价就降级为"不带"）· **L55**（抓包要抓对传输层；优先选
  不依赖"我猜对实现细节"的判据，如**服务端落盘**）。

### T-51　🔴→✅ **修复器「不收敛」：两步互抵 → 每次冷启动全量重写会话**（心跳 53 实机发现并修复）

- **暴露方式**（不是找 bug，是**看日志**）：设备冷启动日志**每次**都对同一会话报
  ```
  repair-sessions(v3): session-fdfc1a28-cb0d-46ab-895a-1032a971245c
    compaction/prune 的 shadowedSeqs 重排（去重 + 升序，对齐 shadowedRange 端点）；
    compaction/prune 的 shadowedSeqs 对齐实际 surface 切片（失效 prune 已移除）
  repair-sessions: repaired=1 skipped=1 errors=0
  ```
  而该会话的 `session.v3.jsonl` 与其 `.bak` **md5 完全相同**
  （`37562b17…`，同为 2,076,005 B，mtime 同秒）→ **内容零变化**。
- **代价**：每个受影响的会话、**每次冷启动** = 一次 2MB 全量重写 + 一次 2MB `.bak` 拷贝
  （且会在磁盘上持续堆积 `.bak`）。这与心跳 49 修掉的"每次启动重写全部 79 个会话"是**同一族**，
  只是数量级从 79 个降到 1 个，**所以更容易被漏掉**。
- **根因 = 两个步骤对同一字段持互斥的规范化目标**：
  | 步骤 | 目标 | 效果 |
  |---|---|---|
  | `session-repair.ts:fixPrune` | `uniqueSorted` → **数值升序** | 把 `[57,1134,1150,1136,…]` 排成 `[57,105,114,…]` → `changed=true` |
  | `session-repair.ts:fixPruneSurfaceSpans` | **surface 切片序**（官方 `validateShadowedSeqs` 的真实要求） | 又改回 `[57,1134,1150,1136,…]` → `changed=true` |
  一个"排好"、一个"排回去"，**产物回到原样而 `changed` 永真** → 调用方（`dsh-plugin/index.ts:2194`
  的 `sessionRepairNeedsWrite`）每次启动都判"需要落盘"。
  设备真值证实数据本就是 surface 序（`seq=1196` 19 元素 / `seq=1198` 18 元素，
  **数值升序 = false**）—— surface 在多次 replace 交错后**本来就不单调**。
  `fixPruneSurfaceSpans` 自己的头注就写着「官方 validateShadowedSeqs：**surface 序而非数值升序**」
  —— **两个步骤里有一个把自己的头注写对了，却没发现另一个把顺序又改了回去**。
- ✅ **修复**：新增 **`uniqueStable`（保序去重）**，`fixPrune` 与引用重映射处（`:320`）的 `uniqueSorted`
  全部改用它 → **顺序权威唯一归 `fixPruneSurfaceSpans`**；note 文案同步改为如实的
  「去重（保持 surface 序，不按数值重排）」（原文案还声称"对齐 shadowedRange 端点"，而它并不做这件事）。
- ✅ **三层验证（每一层都带正控）**：
  1. **离线精确复现** `stage3-device/hb53/repair-chain.mjs`（esbuild 打包两个纯函数模块，
     对设备真实 1.38MB / 1258 事件文件跑三段链）：修复前 `v3.changed=true` 而**产物 === 输入**、
     第二遍**仍** `changed=true`；修复后 `changed=false`、无 note、第二遍干净。
  2. **单测正控**：新用例（surface 序但非数值升序 ⇒ 必须零改动）在**旧实现下实测 FAIL**，
     恢复修复即 **27 passed**。顺带发现原文一条断言**把缺陷写成了期望值**
     （`expect(d.shadowedSeqs).toEqual([...d.shadowedSeqs].sort())` 断言必须数值升序）—— 已按基准重写。
  3. **判据 6 正控**（`scripts/verify-session-pipeline.mjs`，用运行时谓词判"是否还会写"）：
     还原 HEAD 源码 → 报 `每次启动会重写 1`（`v3.changed=true(boolean)`）；装上修复 → `0`。
- ✅ **设备闭环 + 全树判据**：装 v263 后**两次冷启动均 `repaired=0 skipped=1`**，会话文件 mtime
  **纹丝不动**（保持 18:26）；`adb pull` 全树 82 会话 / 200MB → **七项判据全过**，
  含 **每次启动会重写 0**、内容丢失 0、非幂等 0、目录身份漂移 0、判据 7 运行时拒载 0。
- **残留观察（低优先）**：会话树里见 6 个 `session.jsonl.bak.<ts>.<pid>.<rand>.tmp`
  —— 原子写的临时文件残留，**与本次 force-stop 压测吻合**（写盘途中被杀），非独立缺陷；
  若后续在不频繁强制停止的正常使用下再现，再查 `atomicWriteFile` 的清理路径。

### T-53　🆕 **存量「脏楼层」清洗**（= D-5b；**只读报告已出，等你拍板**）　⏸ 待决策
- **背景**：Kemini 预设的「aether opus正则一」是 `promptOnly: true` 的 ST 卡正则，
  语义上**只该变换发往 LLM 的文本、绝不回写 chat 数组**（TT `script.js:5282-5312`）。
  修复前它在 `pre-step` 就跑并被宿主落成 `user/message` 耐久事件 → 聊天记录被写成
  `<interactive_input>\n…\n</interactive_input>`，UI 气泡显示包装标签 / `$1` 残留。
  **源侧已修**（`dsh-plugin/index.ts:3610-3620`：promptOnly 推迟到 `llm/stream`，不落盘），
  **但存量数据已被污染**。
- ✅ **心跳 54 只读报告已产出**（`scripts/audit-dirty-floors.mjs`，**零写入**）：
  - **扫描**：82 会话 / **1515** 条 `append-origin user/message`，**82/82 成功、0 失败**；
  - **真脏 83 条**（`$1` 字面残留 **62**、嵌套包装 **1**），**受影响会话 13 个**；
  - **设计用途快照 35 条**（`system-level` 23 / `runtime-ctx` 11 / `skill-list` 1）→ **非风险**；
  - **assistant 提及该标签 192 条**（模型在"谈论"）→ **非风险**；
  - **修复生效性**：最后一次污染 = **09-10 08:53 UTC**，最新消息 = **09-11 08:12 UTC**
    → **23.3 小时零新增** ⇒ **行为已正确，残留纯属存量**。
- **关键技术决定（写在这里，避免下一轮走弯路）**：
  1. **不数原始事件**，走官方 0.1.5 迁移链 + `foldSurface` 还原 **surface 视图**
     （单文件实测 **382 条 `compaction/prune`**；直接数事件会把污染面**大幅高估**）。
  2. 分档**复用既有 `classify()`**（`tt-projection.ts:89`），**不自造第二套判据**
     —— 首版自造口径把 **35 条设计用途**误判为脏（**L44/L62**），故脚本内置 `--selftest` **6/6**。
- **拍板选项**：**A** 清洗（须写带 `.bak` + 幂等 + 收敛断言的写入器，**不可逆 → 先备份再在副本验证**）；
  **B** 不清洗（旧会话保留可见残留，零成本）。
- **推荐**：若你不在意旧会话观感 → **选 B**（该项可直接关闭）；若要干净的历史 → 选 A（按本项目铁律先出迁移方案）。
- **注意（避免造出假待办）**：编辑面板会**忠实预填存储原文**（含包装），这是**基线语义**
  （ST 编辑亦显示原始 `mes`），且**修复后的新消息不再带包装** → 属本条的下游症状，**不是独立缺陷**。

### T-54　🔴→✅ **「重新生成 / 回退」两条 live 写入路径恒 500（死了 8 个心跳）**（心跳 55 修 + 真机闭环）
- **现象**：点「↻ 重新生成」→ 确认 → 弹 `重新生成失败：Cannot read properties of undefined (reading 'log')`；
  「↩ 回退到此处」同病。直接 POST 得 **HTTP 500 `{"error":"Cannot read properties of undefined (reading 'log')"}`**，
  且**会话文件 md5 一字未变** ⇒ **零事件写入，功能完全不可用**。
- **根因（file:line）**：官方 `Session` 的方法都是「实例字段 + `this`」写法
  —— `dsh-session/lib/index.js:457 this.log = log`、`:1075 this.log.push(...)`。
  **心跳 47**（提交 `801d47d`）为绕开 TS2722/TS18048，把两处 `live.append(...)` 改成
  `const liveAppend = live.append` + `liveAppend(...)`（`dsh-plugin/index.ts:5222` 回退 / `:5402` 重新生成），
  注释写着「**纯类型层修正，运行时语义不变**」——**实际是语义变更**：方法引用被提取后 `this === undefined`
  → 任何调用都抛「读 `this.log`」。**从心跳 47 到心跳 55 共 8 个心跳恒 500**，
  而 `tsc` / 单测 / `stage4-regression` 21/21 **三处全绿**（L59 又一实例）。
- ✅ **定位（零重建成本，L66）**：把设备报错原文当**可判等指纹**，离线用官方 `Session` 造同形对象
  逐条逼近路由调用序列 → 一次运行得到**逐字相同**的报错，并给出决定性对照
  **绑定调用 `[ok]` / 提取后调用 `[THROW]`**（`stage3-device/hb55/hb55-detach-probe.mjs`）。
  弯路警示：先 grep 自己源码的 `.log` 属性读取（0 处）会得出"不是我们的代码"——
  实际是**官方代码**在读 `this.log`，因为 `this` 被我们弄丢了。
- ✅ **修复**：新增单源 `boundAppend()`（`dsht-plugin-shared/session-write.ts`，带完整成因注释）
  作为「提取官方会话方法」的**唯一合法出口**；两处 detach 改为 `boundAppend(liveWritable)`
  （并把 `liveWritable` 声明上移以避开 TDZ）。
- ✅ **三重防线**：
  1. **静态闸门** `scripts/audit-method-binding.mjs` —— 扫全仓 `const X = recv.member`，
     命中「this 依赖成员白名单」（`append`/`flush`/`eventAt`/`snapshotEvents`/`emit`/`on`/…）即违约；
     自身先过**正控/负控/零控**（L44），并带 `--verify-lib` 用官方库反向核对白名单未过期。
     实跑：**82 个 `.ts` / 99 条候选 / 高危 0**。
     ⚠️ **心跳 56 补记（闸门自己的覆盖盲区）**：原正则要求右侧是**纯标识符链**，
     于是 `const append = (session as {…}).append` 这类**带类型断言**的提取（L70 同族包装）
     全部判为 NO-MATCH —— 而它们与心跳 47 的缺陷**同形**（`this` 一样会丢）。
     **正控实证**：用三种包装（`as` / `!` / 括号）各写一条坏样例，旧版闸门**一条都不报**（实测 NO-MATCH）。
     ✅ 已修：新增 `parseExtraction()`（宽松抓 + **剥包层**看接收者是否为标识符链），
     自检扩为**四控**（正控 / 负控 / 零控 / **包装控**），候选 **99 → 135 条**（多抓出 36 条此前漏掉的）。
     并**消掉了仓库里那 3 处真实提取**（`dsh-plugin:294` 的 `flush`、`prompt-template:293` 的 `eventAt`、
     `:301` 的 `append`）—— 它们靠手动 `.call(recv, …)` 而**行为本正确**，但形态本身即风险面，
     按脚本自带纪律（「不要往 ALLOW 里加，改写法」）改为**在访问点直接调用**。
  2. **单测负控**：断言裸提取必炸、报错与设备报错**逐字相同**、且**零写入**（+2 条）。
  3. **设备闭环**（L68：备份 → 真写 → 三件取证 → 还原 → 重启）。
- ✅ **实机验收（两条路由同时转绿）**：

  | 路由 | 修复前 | 修复后 |
  |---|---|---|
  | `/rp/session-regenerate` | 500 + 零写入 | **200** `{"logical":true,"replaced":6,"lastUserText":"…"}` |
  | `/rp/session-rollback` | 500 + 零写入 | **200** `{"logical":true,"replaced":6,"truncatedTo":302}` |

  落盘物证 314→316 行、md5 变更、新增 `compaction/prune seq 313 shadowedSeqs [303,304,305,306,307,309]`
  + 合法形态标记；logcat `session-regenerate … anchor=302 replace[303,309] n=6` 与**离线复现逐字一致**。
  取证后**已精确还原**（md5 回到 `04eacf…` / 314 行 / `.bak` 已删 / 重启对齐内存态）。
- **纪律（L67，本轮代价 = 8 个心跳）**：UI 面回归若以「零写入 / md5 不变」为验收判据，
  **必须再配一条在副本上跑真写的用例**；否则「读侧全绿」会掩盖写侧已死。
- **交付**：三闸门 `typecheck` 0 错 · 单测 **50 文件 / 1024 全绿** ·
  双架构 APK `x86_64 debug 196,836,000 B` / `arm64 release 128,362,024 B`，
  两包内插件均核出 `boundAppend`×3、负控（旧写法）0 命中。沉淀 **L65–L68**。

### T-55　🟠→✅ **平台补丁闸门把「补丁丢了」读成「一切正常」**（心跳 55 顺手发现并修 + 正控）
- **现象**：复检既有闸门时，把 **F2（flock 单进程直通，决定"消息能不能发出去"）** 的 marker 抹掉，
  `apply-platform-patches.py --check` 仍报「✓ 期望 1 处，实际 1 处」、汇总「0 项失败」**exit 0**。
- **根因**：marker 缺失时退回「**锚点正则命中数 == 期望**」判定，而 F2 的锚点
  （`const { platform, arch } = process;`）**在补丁前后都存在**（repl = 原行 + 新块）
  → 「锚点还在」被当成了「补丁已生效」。**危害**：`npm install` / 重装 runtime 会把 `flock.js`
  还原成抛 `ERR_FLOCK_UNSUPPORTED_PLATFORM` 的原版，而**所有静态闸门都是绿的**，上线即"一条消息都发不出去"。
- ✅ **修复**：三态**显式分账**（不再共用一个 ✓）——`已打补丁`（marker 命中）/`未打可打`
  （锚点命中但 marker 缺失）/`失败`（锚点形态不符）；汇总改为
  「已打补丁 N，未打可打 M，跳过 K，失败 F」，`pending>0` 再打一行 ⚠。
  顺带修掉「健康树上汇总恒为 `0 项检查`」（`checked` 只在锚点分支自增，与明细行自相矛盾）。
- ✅ **正控**：抹掉 F2 marker → 「已打 19 / 未打 0」变「**已打 18 / 未打 1**」+ ⚠ 行；
  还原后复原；apply 模式（幂等）与 `--check` 双模式均复跑通过。
- **一般规则（L69）**：判「某个改写是否生效」必须看「**改写引入的新东西在不在**」，
  **不能**看「原文里的东西还在不在」——**锚点只能判"可打"，不能判"已打"**。

### T-56　🔴→✅ **宿主页缺 ST 标准 `/version` 端点 → 所有卡的版本分叉静默走错**（心跳 57 发现并修）

- **发现方式**：审 T-42 的"前线"时不再盯着报错本身，而是**回到卡脚本取版本的那一行** ——
  静态读到 `inject.js:2210-2218` 的 `fetch('/version')`，随即实机验证该端点。
- **实机取证**：`GET /version → 404`（空体、非 JSON）→ 卡落 `.catch(() => 10000)`
  → `window.versionNumber = 10000` → 脚本内 **20+ 处** `versionNumber >= 11305` 分叉**全部走旧版**。
- **基准对照（L36 三问）**：① 基准有吗？**有** —— TT `src/compat-version.js:1`
  `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`，由 `src/tauri-bridge.js:162-171` 的 `/version` 返回；
  ② 差异在哪一侧？**我方**（缺端点）；③ 基准会不会同报？**不会**（卡在基准上得 11800 走新版）
  → 判定为**真缺陷**，且**不需要产品决策**（前面 T-42 的 A/B 选项是个伪选择）。
- **为什么这条比 T-42 的报错更根本**：这条链上每一层都"正常" —— fetch 没报错（catch 吞了）、
  版本号是合法数字、分叉是合法布尔。**没有任何一处日志说"我降级了"**。T-42 的 DOM 报错只是**症状**。
- ✅ **修复（一组三件，缺一则只是"换个坑"，见 L71）**：
  | # | 落地 | 位置 |
  |---|---|---|
  | ① | `GET /version` 路由（返回 `pkgVersion: '1.18.0'`，与基准逐字同值） | `dsh-plugin/index.ts`（`kind:'exact'`, path `/version`）；常量单源 `dsht-plugin-shared/st-compat.ts` |
  | ② | `chatCompletionSettings.extensions.regex_scripts`（ST 1.13.5+ 预设内嵌正则通道，真数据） | `dsht-plugin-tavern-helper/facade.ts` 的 `/context`；单源 `buildStRegexScripts` + `toStRegexScript`（**顺带补上原本漏输出的必填 `id`**，并收敛掉 `presetExport` 里那份重复实现） |
  | ③ | 宿主门面保证 `extensions` **恒存在**（给空对象而非省略键） | `dsht-rp-ui/src/client/host-vendor.ts`；类型 `th-shim.ts` |
  | ④ | `#saved_regex_scripts` 锚点（**故意不挂 `.regex_settings` 祖先**，以免触发卡往我方行注入它自己的按钮） | `dsht-rp-ui/src/client/RegexPanel.tsx` |
- **判据**：`typecheck` 三段式 0 错 · 单测 **51 文件 / 1057 全绿**（+20，其中 `st-compat.spec.ts` 用
  黄金母版钉住 `1.18.0` 与阈值 11305 的边界 11304/11305）· 实机 `/version → 200 pkgVersion 1.18.0`。
- **沉淀**：LEARNINGS **L71**（缺基准端点 = 版本分叉陷阱）/ **L72**（「兜底路径不可达」第三次重演）。
- **残留**：卡的 `#saved_regex_scripts` 后续消费（`injectBindButtons` 往行里注入"绑定到预设"按钮）
  **不实现** —— 因为 ST 1.13.5+ 下卡自身不做这件事，基准同样不做（L36「不能多」）。
  T-42/T-48 的其余部分据此**降级为非缺陷**（`renderExtensionTemplateAsync('regex','editor')`
  只在卡的旧版面板路径里被调用，新版路径不再走）。

### T-57　🆕 **`sessionController` 服务运行一段时间后不可用 → RP UI「打开角色会话」必然失败**（心跳 57 续发现，待定性）

**证据（最小对照实验）**：同一份请求、同一页面、同一份源码，只改应用状态：

| 应用状态 | `POST /api/session/list` | `POST /api/session/create` |
|---|---|---|
| 已运行约 30+ 分钟（期间页面 reload 过） | `200 {ok:false, error:{code:'gateway/service-unavailable', message:'typert gateway: session/list: active Service "sessionController" is unavailable'}}` | 同款错误 |
| `am force-stop` + 重启后 75~90 秒 | `200 {ok:true, value:{items:[…82]}}` | `200 {ok:true, value:{sessionId:'…', agentPreset:'standard'}}` |

**影响面**：RP UI 的「打开角色会话」是**唯一**依赖 `session.list` / `session.create` 的产品路径
（`RpOverlay.tsx:334` 取最近会话续聊、`:345` 建新会话 + `open-chat`）。
⇒ 在该状态下点角色卡**必然失败**。注意 `chatId` 仍可能有值（插件侧会话注册表还在），
所以"界面看上去正常"与"这个入口能开新会话"是两件事。

**待定性**：触发条件（时间？页面导航？原生对话视图 unmount？），以及是否应补"服务不可用 → 自动重载页面/重启服务"的自愈路径
（可复用 **T-45** 已落地的带预算重载机制）。

**探针**：`stage3-device/hb57/hb57-svc-liveness.js`（只读，不建会话）。

---

### T-58　🆕 **`session-regenerate` / `session-rollback` 的「非 live 分支」是破坏性文件截断**（心跳 57 续发现，待定性）

**证据**：对**未挂载**的会话 `st-1w8aglg` 打 `/dsht-rp/rp/session-regenerate` →
`200 {"truncated":1,"lastUserText":"…","variablesRestored":0,"fileSnapshots":{…}}`
→ 该会话 `session.jsonl` 立刻被**截断重写**（md5 `68ddd464…` → `0c32e035…`、3779B 级变化），
且**不产生变体标记**（后续 `variant/groups` 仍为 0）。
live 分支返回的是**完全不同**的形状：`200 {"logical":true,"replaced":1,"truncatedTo":0}`（事件留在日志）。

⇒ **同一端点、同一入参、同一 200，语义从"逻辑回退"变成"物理截断"**，判据只有会话是否挂载。
本次因**先做了备份**（`stage3-device/hb57/variant-backup/hb57-variant-bak.tar`）才精确还原。

**建议**：非 live 路径加显式门槛（未声明 `allowFileTruncation:true` 即拒收，或改为"返回 409 + 指引先 `open-chat`"）。
**需先确认**产品路径是否会碰到它（前端是否可能在会话未 attach 时调这两个端点）——若会，则这是产品缺陷而非仅是探针风险。

**沉淀**：LEARNINGS **L74**（写路由必须先问 liveness，别用"发一次看看返回什么"探写路由）。

---

### T-59　✅ **D-6 落地：RP 会话的 agent 层工具修剪**（心跳 58，按用户拍板）

- **背景（D-7 抓包实证）**：基准 TT 发给 LLM 的请求体**完全没有 `tools` 字段**，
  而 DSHT 带 **32 个**工具定义 + 24k 字 agent 说明书 —— 这是与基准的**唯一真差异**。
  危害不只是体积：RP 消息要跟 agent 工具链抢注意力（历史样本 `[29]-[35]` 正是模型在
  **查 worldbook 工具**而不是直接推进剧情）。
- **DSH 侧无「关 tools」开关**（`disableTools`/`noTools`/`toolChoice` 全仓零命中，
  静态枚举已确证）—— 官方给的两条路是 ①自定义无工具 agent preset ②`ctx.tools.restrict()`
  （需 scoped ctx）。**本项目采用 ③：在 `system-prompt/assemble` 里修剪** ——
  该钩子的 `assembly` 官方明文标注为 **mutable**（`dsh-system-prompt/lib/types/index.d.ts:23`），
  是最短路径且无需新建 preset/改会话创建链。
- ✅ **实现（两个纯函数 + 一处接线）**：
  | 件 | 位置 | 语义 |
  |---|---|---|
  | `shouldStripRpTools(path)` | `dsh-plugin/index.ts` | 默认/`direct` → 修剪；`lightAgent`/`heavyAgent`/`agent` → **保留** |
  | `stripAssemblyTools(assembly)` | 同上 | 清 `tools` **并摘除对应 `tool:<name>` section**；不改入参；无工具时原样返回 |
  | 接线 | `system-prompt/assemble` 钩子 | 判据 = `rpSlugFromCwd(cwd)` 命中（**是 RP 会话**） |
- 🔴 **为什么不是一刀切（关键设计决定）**：`lightAgent`/`heavyAgent`/`agent` 三条路径的
  **预设正文明确要求调用工具**（`preset/demo.ts` 的 lightAgent 正文：「设定密集的世界观在上下文
  缺失时，**先用 lore_query 工具查询世界书**，再作答」）。把这三种也关掉 =
  **让正文指向不存在的工具** = 造出新的静默不一致（L42 家族）。故按 path 分流。
- 🔴 **为什么 section 要成对摘（而不是只清 tools）**：官方每个工具插件都注册一段
  `tool:<name>` 使用说明（`dsh-tool-bash/lib/index.js:254-258` 等）。只清 tools 会留下
  「查看 bash 结果的 `[exit code: N]`」这类**指向不存在工具**的系统指令 ——
  那是把「多出来的污染」换成「自相矛盾的残留」，不比原来好（与 T-56「一组三件」同理）。
  匹配规则保守：`name.startsWith('tool:')` **且** 该 name 确在被移除的工具里（不误伤同名前缀）。
- **迁移会话天然不受影响**：它们的 cwd 是 `rp-import/<batchId>` —— `rpSlugFromCwd` 要求
  前缀 `$DSH_HOME/rp/` 且 slug 不含 `/`，故**不匹配**；且它们靠工具干活。
- **验收**：`typecheck` 三段式 0 错 · 单测 **51 文件 / 1074 全绿**（+5）·
  **两轮反控**：①`shouldStripRpTools` 恒 false → 1 条红；②只清 tools 不清 section → 2 条红。
- **实机效果未验**（诚实边界）：需在真机发一轮消息后核 `rp/golden/dsht/llm-*.json`
  的请求体**无 `tools` 字段** + logcat 出现 `D-6 工具修剪：移除 N 个工具定义`。
  **注**：golden fetch 拦截需 `rp/golden/dsht-ENABLED` 开关文件才启用（见 `index.ts` 内注释）。

---

### T-60　✅ **T-42 收口：宿主 `extension_settings.regex` 的种子**（心跳 58，实证推翻心跳 57 结论）

- **心跳 57 曾把 T-42 判定为「降级为非缺陷」**（理由是「ST 1.13.5+ 下卡不做面板这件事」）。
  **该判定不成立** —— 本轮用**按卡逐字取法**的探针实测：
  ```
  OK    ccs.extensions.regex_scripts => undefined
  THROW extensions.regex.length      => Cannot read properties of undefined (reading 'length')
  ```
- **为什么这一行致命**：卡 `inject.js:3538` 取 `const extensions = ctx.extensionSettings;`，
  随后在**无条件调用**的 `updateSTRegexes()`（`:3892`）里读 `extensions.regex.length`（`:3997`）
  → `undefined.length` **取值先抛** TypeError → `RegexBinding()` 整段中断 →
  紧随其后的 `ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` **全不执行**。
  **注意该行新旧版路径都会走到** —— 与 `#saved_regex_scripts` 锚点不同（那处只在旧版路径被消费），
  所以心跳 57 补的「`/version` + 锚点 + `regex_scripts`」三件**并不足以**让这段不抛。
- **基准事实（TauriTavern / ST 1.16 源码逐条核实）**：`extension_settings.regex` 是
  `RegexScriptData[]`（camelCase）—— `extensions.js:178` 默认 `regex: []`，
  `extensions/regex/index.js:1713` 的 `init()` 再兜底 `if (!Array.isArray(...)) … = []`；
  且它只装 **GLOBAL** 作用域（`engine.js:110`），与角色内嵌 / 预设内嵌是**三棵独立的树**。
- ✅ **修复（三处，含同族副本）**：
  | 件 | 位置 | 内容 |
  |---|---|---|
  | ① 数据源 | `dsht-plugin-tavern-helper/facade.ts` 的 `/context` | 输出 `extensionSettingsRegex`（= `rp/regex/global.json` 经 `toStRegexScript` 白名单转换） |
  | ② 宿主 seed | `host-vendor.ts` 的 `seedHostExtensionSettings` | 种 `regex` / `regex_presets`；**不是数组→种**、**空数组有真数据→填**、**非空→不动**（卡改过的不回滚）；改动时落盘（iframe 与宿主共用同一 localStorage 键） |
  | ③ 同族副本 | `th-shim.ts`（iframe 侧） | 同样的 `!Array.isArray` 兜底 —— 只改一侧 = L61 的"假修" |
- **一个被单测当场抓住的设计缺陷**：首版写「只种不覆盖」，但门面**常常先以空壳构建**
  （RP 未打开时快照为 null）把 `regex` 种成 `[]` → 此后真数据**永远进不来**。
  改为「空数组且有真数据 → 填充」并补了专门的时序用例。
- **验收**：`typecheck` 三段式 0 错 · 单测 **+6**（含「按卡的取法读 `.length` 不抛」这条承重断言）·
  **反控**：停用 seed → **6 条立刻转红**，恢复即 52 passed。
- **实机效果未验**（诚实边界）：需真机开卡后核宿主页 `SillyTavern.getContext().extensionSettings.regex`
  是数组、且 bootstrap 后续三行（ChatSquash / MacroNest / 工具注册）确实执行。

---

### T-45　🆕→✅ **主框架加载失败后无自愈路径 → 永久停在启动屏**（心跳 50 登记 / **心跳 53 定性并修复**）
- **现象**：`adb install -r` 后立即 `force-stop + start`，约 1/3 概率 WebView 停在
  `Webpage not available`（`chrome-error://chromewebdata/`），**此后不再重试**，`SillyTavern`/UI 全无。
  重启应用（`force-stop` + `start` + 等 70s）即恢复。
- ✅ **心跳 53 定性（源码级 + 设备实证）**：`MainActivity.diagPoller` 里 `portOpen && !dshLoaded` 时
  **只有三条分支**，第一条是 `if (tok != null && tok != lastTokenAttempt)` ——
  **重载只在 token 变化时发生**；主框架加载失败（401 / 启动竞态 / `net::ERR_*`）时 token 并未改变
  → **三条分支全不命中** → 永久停摆。用户看到的是等待屏，且屏上写着
  「状态：node 运行中／端口 3080：已开放 ✓／web 令牌：已捕获 ✓」
  —— **每一行都在说"正常"，而流程已经死了**（设备截图 `stage3-device/hb53/before-fix-screen.png`）。
  **最小复现探针**（非破坏性，零数据写入）：`stage3-device/hb53/hb53-loadfail-recover.mjs`
  —— 把页面导航到 loopback 上不可达端口（host 仍为 `127.0.0.1` → `shouldOverrideUrlLoading` 放行
  → 进入 `onReceivedError(isForMainFrame=true)` 分支），然后轮询 `/json` 的 `url`。
  **修复前：40s / 40 次轮询，零次重载（FAIL）**。
- ✅ **修复**：补一条**带预算**的重载分支（`RELOAD_INTERVAL_MS = 3000` × `RELOAD_MAX = 20`；
  端口 0→1 跳变或 token 变化时预算归零；**重载目标用 `bootUrl`**（上次"本该加载"的地址），
  而不是 `webView.url` —— 失败时后者是 `chrome-error://`，拿它重载等于再失败一次）。
  同时给等待屏加**进展行**（L42 从「日志」扩到「UI」）：
  `页面加载：失败，3 秒后自动重试（第 N/20 次）` / 达上限 → `已停止自动重试 —— 请重启应用`。
- ✅ **设备实证（同一探针前后对照）**：**修复后 7s 内自愈**，连跑 3 轮 PASS；
  logcat 链路完整：`main-frame error -1 net::ERR_UNSAFE_PORT @ http://127.0.0.1:1/`
  → `main-frame load failed → reload (attempt 1/20): http://127.0.0.1:3080/?token=…` → 页面恢复。
- **为何以前判不出**：心跳 50 只能观察到现象，且怀疑是"我短时间内反复安装/重启"造成的自造条件。
  本轮改用**可复现的最小动作**触发同一分支（而不是等竞态自己出现），
  于是缺陷从"偶发观察"变成"可证伪的判据"——**偶发问题的定性方法 = 找到能稳定进入同一分支的最简动作**。

### T-41　🟠→✅ 注册端点不再「比基准更严」：`registerVariableSchema` 拒收既有值不匹配（已修）
- **暴露方式**：T-40 修完后重跑采集器，卡脚本的 bootstrap **再往深处走**，在 iframe 侧抛出
  `Error: 既有变量与 schema 不匹配`（我方面向 `about:srcdoc` 的桥回包）。
- 🔴 **这是"我方比基准更严"，不是基准要求**（L36 的「不能多」）：
  真 TH `registerVariableSchema` 是**纯 setter** —— `JS-Slash-Runner/src/function/variables.ts:10-37`
  只做 `store.<scope> = schema`，**不校验既有值、不抛错、不改 HTTP 状态**；
  schema 的消费点全在**变量管理器面板渲染**时
  （`src/panel/toolbox/variable_manager/{Global,Preset,Character,Chat,MessageItem}.vue`）。
  `CHANGELOG.md:710` 亦印证：注册后若实际变量不满足，是「变量管理器**提示**错误信息」，不是拒收。
- 🔴 **实测危害（不是理论洁癖）**：卡 `inject.js:2308` 的 bootstrap 在 register 处抛错 →
  紧随其后的 `ChatSquash()` / `MacroNest()` / `syncSPresetToolRegistrations()` **全部不再执行**
  → 卡的核心功能直接缺失。
- ✅ **修复**：注册端点改为**一律落下 schema**，既有值不匹配只回 `issues` 咨询信息 + `console.warn`
  （**不拒收、不改状态码**）—— 对齐基准纯存储语义。
  ⚠️ **没有改成静默失败**：写路径 `/variables/merge` 的 `variableSchema 校验失败` **仍保持 422**
  （基准确实在写入时校验），且那条有 D8 通知链路；此处只把「注册」还原成基准语义。
- ✅ **回归 3 条**：① 不匹配仍 200 且 schema 确实落下、既有值不动 ② **前提自检**
  （`validateSchemaSubset` 对该数据确实报错，防"上一条空转"）③ 匹配时 `issues` 不出现
  （防退化成"永远报警"的无信息通道）。
- ✅ **负控**：临时改回 422 → 该测试**立刻失败**（1 failed / 26 passed），证明断言承重；已移除临时代码。
- ✅ **实机取证（三条齐备，与单测判据同构）**：
  | 判据 | 实证 |
  |---|---|
  | ① 不再拒收 | logcat：修前 `[dsht-th] 变量结构校验失败（422）: variables/schema`（05:55 / 06:02，旧 PID 16001/16231）→ 修后**无新增 422**（残余 3 条经时间戳+PID 比对确认均为修前旧日志） |
  | ② **schema 确实落下** | 设备 `rp/state/session-fdfc1a28-….json`：**61,014 B → 66,868 B**，`variableSchema.type="object"` 且 **`properties.stat_data` 存在**（修前恒为 `{"type":"object","properties":{}}` 空壳） |
  | ③ 不匹配可见 | `[dsht-th] variables/schema: sid=session-fdfc1a28-… 既有值与 schema 不匹配 **24 项**（按基准仍落下 schema，仅提示，不拒收）` |
  - 🔴 **这条修复的真实价值比"少一个报错"大得多**：该卡**从来没能注册成功过**（每次都被 422 挡回）
    → `variableSchema` 永远是空壳 → **D7 校验对它从未激活**。修复后 schema 才第一次真正落盘。
  - 顺带确认：历史垃圾键 `[object Object]` 已不在 properties 中。

### T-40　✅ 宿主 `getContext().eventTypes` 缺失（**第三道墙**，已修）
- **发现方式**：补齐 (a)(b) 后重跑同一采集器，错误**再往前推**——
  `TypeError: Cannot read properties of undefined (reading 'OAI_PRESET_IMPORT_READY')`
  @ `installSPresetFixedPresetNameImportHook@inject.js:493 <- (anon)@inject.js:2308`（宿主帧）。
  源行：`const importReadyEvent = ctx.eventTypes.OAI_PRESET_IMPORT_READY || 'oai_preset_import_ready';`
- 🔴 **为什么 `||` 兜底救不了**：`ctx.eventTypes === undefined` 时**属性访问先抛 TypeError**，
  右侧字面量永远轮不到。→ 「给了个空对象就行」也不够，必须**真给这张表**。
  （这是静默失败族的一个变体：看似有兜底的代码，兜底路径不可达。）
- **基准**：真 ST `st-context.js:137-138` → `eventSource, eventTypes: event_types,` 与 `eventSource` **并列**。
- ✅ **修复**：新建**生成器** `scripts/gen-st-event-types.mjs`
  → 机械解析 `public/scripts/events.js:3 export const event_types = {`，产出
  `client/st-event-types.gen.ts`（**104 条**，带 `file/line/count` 来源元数据；**解析为空则拒绝产出**）。
  `buildHostStContext()` 接 `eventTypes: ST_EVENT_TYPES`。
  → **不用手抄**的理由：ST 升级后重跑一条命令即可再同步，且"悄悄漂移"藏不住。
- ✅ **测试 8 条**，其中两条**故意钉真实数据而非书写约定**（详见 L37）：
  真 ST 自身就有 **4 个非全小写值**（`chatLoaded` / `GENERATION_AFTER_COMMANDS` / `characterDeleted` /
  `charManagementDropdown`，`events.js:21/22/68/87`）与 **1 处重复值**
  （`SMOOTH_STREAM_TOKEN_RECEIVED` 与 `STREAM_TOKEN_RECEIVED` 共用 `stream_token_received`，
  `events.js:72-74` 原文注释 `@deprecated … aliased to STREAM_TOKEN_RECEIVED`）。
  首版按"值应全小写 / 应唯一"写断言 → 全红；核验基准后改为**黄金母版式**（钉住这 4 个例外 + 这 1 处重复，
  新增/减少即报警）。教训：**用一个假前提会把真数据判成错**。
- 判据：`st-event-types.spec.ts` 8/8 绿；三闸门 0 错。

### T-38　✅ tests 纳入类型闸门（`typecheck:tests`）
- **已存在的洞**：`tsconfig.json` 的 `exclude` 含 `tests` → **46 个 spec 文件从未被类型检查**
  （`typecheck:core`/`:ui` 都覆盖不到）。这是「验证读侧 ≠ 运行时读侧」的又一实例。
- ✅ 新增 `tsconfig.tests.json` + `typecheck:tests`（已并入 `npm run typecheck` 三段式）。
- **首次开启即抓到 15 处**，全部为**测试侧**问题（无生产缺陷），逐条修掉而非放宽：
  | 类别 | 处数 | 例 |
  |---|---|---|
  | fixture 缺必填字段 | 1 | `LoreEntry` 漏 `sticky/cooldown/delay/group/groupOverride` |
  | **断言了不存在的字段** | 2 | `subset.ok`（subset 引擎原始返回**没有** `ok`）——断言对象是输入而非行为 |
  | mock 桩**静默缺 14 个 deps** | 14→1 | `makeDeps()` 从未提供 `chatAppend/injectsPut/generate/…`；改为**显式抛错桩**（禁止静默假成功） |
  | 窄化/形状标注缺失 | 8 | union 未按判别式窄化就取 `messages`；字面量当接口用 |
- 判据：三闸门全 0 错（`core` / `ui` / `tests`），全量 **47 文件 / 883 测试全绿**。

### T-35　清理：4 份 deep-merge 实现收敛到 `dsht-plugin-shared`（P3）
- 现存：`tavern-helper/variables.ts:deepMergeVars`、`th-shim.ts:deepMergeAssign`、
  `dsht-plugin-mvu/index.ts:deepMerge`、`state/mvu.ts:deepMergeInitVars`（心跳 47 新增）
- **对照表已补**（2026-09-11 心跳 47，**判别性用例实测**，不靠读注释 —— 用
  `LOW={x:1,nested:{a:1,b:2},arr:[1,2]}` vs `HIGH={x:99,nested:{b:88,c:3},arr:[9]}`）：

  | 实现 | `x`（叶冲突） | `nested`（深合并） | `arr` | **语义家族** |
  |---|---|---|---|---|
  | `tavern-helper/deepMergeVars` | **99** | `{a:1,b:88,c:3}` | `[9]` | **incoming 获胜**（high 覆盖 low） |
  | `th-shim/deepMergeAssign` | **99** | `{a:1,b:88,c:3}` | `[9]` | **incoming 获胜** |
  | `dsht-plugin-mvu/deepMerge` | **99** | `{a:1,b:88,c:3}` | `[9]` | **incoming 获胜** |
  | `state/mvu/deepMergeInitVars` | **1** | `{a:1,b:2,c:3}` | `[1,2]` | **existing 获胜**（只补缺口） |
  | `th-shim/deepMergeInsert(low,high)` | **1** | `{b:2,c:3,a:1}` | `[1,2]` | **existing 获胜** |

- ⚠️ **原假设被推翻**：T-35 原写「前 3 份是否都满足『存量优先、只补不改』」——
  实测**恰好相反**：前 3 份**都是 incoming 获胜**，第 4 份（`deepMergeInitVars`）
  与 `deepMergeInsert` 才是 existing 获胜。且 `deepMergeInitVars` 的代码注释
  （「与 th-shim 的 `deepMergeInsert` 同义」）**是对的**，原任务描述的猜测才是错的。
- **结论**：收敛前必须先**按语义家族分组**（families-A incoming 3 份 / families-B existing 2 份），
  不能四份合成一个函数——否则任一侧调用方行为会变。**属需专门一轮的重构，本轮不动**
  （P3，不阻塞发布；且当前四份各自正确、无缺陷）。

---

## 7. 长尾 / 观察项（P3，不阻塞发布）

| # | 项 | 说明 |
|---|---|---|
| T-28 | Tier 2 TH 长尾 API（约 50 项记名 stub 之外） | ⏳ **未做**（设计如此）：不支持的 API 挂 stub → `console.warn` 记名 + `Promise.reject`（`th-shim.ts:392/1847`），**诚实失败而非假成功**。真 TH 长尾面（rebind 家族 / createOrReplacePreset / QuickReply 系）待「第三次冒同类问题」再升时间盒 |
| T-29 | EJS 完整语法（当前子集：无函数调用/箭头函数/模板字符串/正则字面量） | ✅ **已核验达标 + 已补测试固化**（2026-09-11）：判据是「显式报错，非静默失败」而非「支持全部语法」。**实证（`prompt-template.spec.ts` 新增 5 条）**：subset 对 4 类不支持语法**全部显式抛错**——函数调用 `trailing tokens`、箭头函数 `unexpected char`、模板串 `unexpected char`、正则字面量 `unexpected token`；批次入口 `renderMessages` 单条失败**保留原文 + 打 `ejsError` 标记**（实测 `rendered:1 / skipped:1`，生产路径 `dsh-plugin/index.ts:3982` 取 `r.messages[k]?.mes` 故不静默清空）。**完整语法另有引擎**：`engine:'sandbox'`（node `vm`）**新增 5 条测试**固化——模板字符串（`v=1`）、正则字面量（`true`）、模板内定义函数（`12`）、内建 `Math.max`（`2`）、箭头函数（既有测例 `messages.map(m => m.role).join("/")` → `user/assistant`）。唯一边界：**上下文经 vm 传入的函数不可克隆**（`cb(2)` → `ok:false, kind:'runtime-error'`）——属 vm 机制固有，非语法缺口，且失败分类显式 |
| T-30 | 采样参数长尾（topP/topK/minP/penalties/seed…） | 🚧 **宿主阻塞**：`dsh-llm-*` 适配器只透传 `temperature/max_tokens/stop` + `reasoningEffort`（H-②，`AUDIT_TASKLIST.md:257`）。**预设值已正确持久化**（`sampling.topP: 0.88` 实证），等宿主开放白名单即可生效 |
| T-31 | 表格记忆长尾（E7 自定义渲染占位符 / E9 编辑器 / E12 设置导入导出） | ⏳ **未做**（V0.3-FREEZE §5 明列的冻结长尾） |
| T-32 | `st-migration` skill 契约漂移复核 + 配探测脚本 | ✅ **契约漂移已复核并修正**（2026-09-11，心跳 45）：`references/session-jsonl-contract.md` 仍在教**已被 0.1.5 禁止**的 `assistant/message` replace 链（21/80 会话因此打不开的根源），已改为 user 标记 + append；补 `startSeq/endSeq` 字段名、source 白名单、user/message 必须包 step、官方不变量、**会话世代读法**、存量修复三重链。探针脚本暂缺（改由 `verify-session-pipeline.mjs` + 契约测试覆盖） |
| T-33 | 复杂卡脚本逐卡适配（飞讯 / 示例游戏类） | 第三次冒同类问题即升 Tier 2 时间盒 |

---

## 8. 已知不修（明确不承诺，别再投入）

> 依据 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) §3 Tier 3 + 审计报告 §4。

- 聊天历史改/删/轮转类 TH API（`setChatMessage`/`deleteChatMessages`/`rotateChatMessages`）——DSH 日志 append-only 是架构决策；回退/编辑走自有机制已覆盖
- extension 作用域变量 / `importRaw*` / 扩展管理 / ScriptTrees / 音频播放器控制面 / 角色卡 CRUD 长尾
- depth N 精确历史锚定（注入通道 append-only，只保证批内「尽量深」）
- 卡自带外部脚本自身的适应问题（保留观察）

---

## 9. 建议执行顺序（一条线）

```
【已完成】T-01 收口 → T-02 阶段3 迁移验证 → T-03 阶段4 回归(含 D-4 重评)
   → T-04 双架构 APK 交付 → T-11 D-4 重评 → T-13 D-7 对照 → T-14/T-15 宿主面收口
   → T-20/T-21 兼容缺口补完 → T-23/T-24 验证债 → T-26 README → T-32 契约漂移
   → T-34 类型闸门（core+UI 双绿，抓出 5 个从未生效的功能）
【待你拍板】~~T-08/T-12（D-6 关不关 tools）~~ ✅ 已落地（见 T-59）
   → ~~T-09 存量脏楼层清洗~~ ✅ 已按拍板选 B「不清洗」关闭
【待你执行】把 arm64 包装真机，验三条基线（启动 / 打开旧聊天 / 发消息）
【待外部条件】T-25 大扫除（需先解冻 RP 数据）→ T-27 更新渠道（需提供目标 GitHub 仓库）
【随时可做】T-28~T-33 长尾（不阻塞发布）
【实机待验】T-59（D-6 工具修剪）/ T-60（T-42 extension_settings.regex）——
   两者单测+反控已绿，**真机效果未验**（需发一轮消息核请求体 / 核宿主 globals）
```

**卡点提示**：T-25 大扫除在「T-04 装机验证通过 + 差异收敛」前**不能动**（数据冻结）；
T-27 代码已就绪，只差更新源地址（需你决定公开/私有仓库）。

---

## 附：工具与文档索引

| 用途 | 位置 |
|---|---|
| 升级度量 | `bash .goal/upgrade-0.1.5/evaluate.sh` → 0–5 |
| 升级目标/约束 | [.goal/upgrade-0.1.5/GOAL.md](.goal/upgrade-0.1.5/GOAL.md) |
| 升级策略/阻塞 | [.goal/upgrade-0.1.5/STRATEGY.md](.goal/upgrade-0.1.5/STRATEGY.md) |
| 平台补丁 | `scripts/apply-platform-patches.py`（`--check` 预检） |
| **补丁标记静态审计** | `node scripts/audit-patch-markers.py`（AST 解析；查"marker 有没有写进替换串"这类幂等检测失效） |
| **前后端路由契约审计** | `node scripts/audit-route-contract.mjs`（前端 POST × 服务端挂载区；`-v` 列全部；`DSHT_AUDIT_SRC=` 可做负向对照） |
| **类型闸门（core + UI）** | `npm run typecheck`（= `typecheck:core && typecheck:ui`，**双绿**）；两次正控已验闸门会 report |
| **方法绑定审计** | `node scripts/audit-method-binding.mjs`（查 `const X = recv.method` 这类**提取后丢接收者**的写法；`--selftest` 正/负/零控，`--verify-lib` 反向核对白名单；`-v` 列全部候选） |
| **构建期 vendor 依赖** | `node scripts/vendor-deps.mjs [--check]`（版本锚定表 = `scripts/vendor-deps.json`；缺失即自愈；构建前自动跑） |
| 插件构建 | `scripts/build-plugins.sh` |
| 一键升级 | `scripts/upgrade-runtime.sh` |
| 会话迁移验证 | `tools/verify-session-migration.py` + `scripts/stage3-migration-test.sh` |
| 自动化发送 | `rp-workspace/scripts/dsht-send.mjs` |
| 差异全文 | [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) |
| 兼容契约条款 | [rp-workspace/docs/ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| 冻结边界 | [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| 兼容审计 | [docs/COMPAT-AUDIT-2026-09-08.md](docs/COMPAT-AUDIT-2026-09-08.md) |
