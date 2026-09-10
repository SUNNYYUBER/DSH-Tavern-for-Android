# TASK-LIST：接下来要做的所有事（唯一任务清单）

> 建立：2026-09-10。**本文件是行动清单**（做什么、按什么顺序、做完的标志）；现状背景看 [MASTER_TODO.md](MASTER_TODO.md)，冻结边界看 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md)，升级细节看 [docs/DSH-0.1.5-UPGRADE-PLAN.md](docs/DSH-0.1.5-UPGRADE-PLAN.md)。
> 状态取值：⏳ 待办 / 🔄 进行中 / 🚧 阻塞 / ✅ 完成

---

## 0. 现在的处境（30 秒读完）

| 事实 | 说明 |
|---|---|
| 源码 runtime | **0.1.5-rc.1**（sentinel v222，45 个心跳已推完阶段 0/1/2/3/4） |
| 你手机上的包 | **arm64-release，9-11 04:5x 构建 = 0.1.5-rc.1**（sentinel v222） |
| 升级进度 | **5 / 5** ✅ **达成**（阶段 4 已判定通过） |
| 单测 | 796 项全绿（41 文件） |
| 未提交改动 | 无（工作树干净） |

**当前状态**：升级目标（evaluate.sh 5/5）已达成。可继续做发布前准备与对齐长尾。

---

## 1. 立即做（P0，阻塞其他一切）

### T-01　收拢未提交改动　✅ 已完成（2026-09-10 收口提交）
- 内容：`MASTER_TODO.md` / `NodeService.kt`(sentinel v205) / `build-dsht.ps1` / `.workbuddy/memory/2026-09-10.md` / `stage3-device/`（是否入库需定）
- 完成标志：`git status` 干净或只剩明确忽略项
- 备注：`stage3-device/backup/dsh-before-migration.tar.gz`（859MB 设备备份）**建议不入库**，加 .gitignore

### T-02　走完升级阶段 3：会话迁移验证　✅ 完成（2026-09-11 心跳 43）
- 目标：确认 v0 → v1 → v2 → v3 三段迁移在**真实体量**（12MB ~ 214MB 会话）下可用
- 判据：`.goal/upgrade-0.1.5/.stage3-pass` 文件存在（evaluate.sh 的 +1）　→ ✅ 已写入
- 结果：六项判据对设备真实会话树 **80/80 全过**（可迁移 / 零内容丢失 / 幂等 / 无回归 /
  目录身份不漂移 / 修复链收敛）；修复器实机 `repaired=79 skipped=1 errors=0`
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
| T-08 | 31 个工具定义（D-6）要不要关 | ⏳ **仍等你拍板**（建议：分开做，别和升级叠加） | RP 会话纯净度 |
| T-09 | **存量脏楼层清洗**：`$1` 残留 + `<interactive_input>` 包装回写（3 会话 146 处） | ⏳ **仍等你拍板**（一次性 migration） | 历史聊天外观（**不影响新消息**） |

---

## 3. 与 TauriTavern 对齐的剩余差异（P1/P2）

> 基准 = TauriTavern-Canary（用户 2026-09-09 拍板）。差异全文见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md)。

| # | 差异 | 状态 | 下一步 |
|---|---|---|---|
| T-10 | D-3 role 映射（系统级内容走 system） | ✅ 主体已修 | 过渡态收敛（历史 user 席快照靠影子化逐轮折叠），观察即可 |
| T-11 | D-4 用户输入绝对位置 | ✅ **重评完成**（2026-09-11，心跳 45） | 结论维持「**有条件可达**」（非当前可达）：`dsh-llm-deepseek/lib/index.js:1849` 声明 `systemPromptUpdate:"in-history"`，`dsh-llm-pi-ai` **无**该能力；我方走 pi-ai → 默认不生效。解锁 = 独立任务（切 `llm-deepseek` 路由 + 显式声明 models），**不叠加在升级窗口** |
| T-12 | D-6 agent 层污染（31 tools / 24k 字说明书） | ⏳ 待拍板 | 见 T-08 |
| T-13 | D-7 采样参数对照（TT 侧 `GENERATE_AFTER_COMBINE_PROMPTS` dump 未采） | ⏳ 低优先 | 补采集脚本 |
| T-14 | golden 接收器迁入 `ctx.webServer`（摆脱宿主进程回收） | ✅ 评估后**决定不改**（2026-09-11，心跳 45） | 现为独立 `golden-receiver.mjs`:31100，**仅在手动采集 Golden Master 对照时启用**，不进产品链路；迁入 `ctx.webServer` 会让生产代码多背一个纯测试设施（且需处理路由命名空间冲突），**无功能收益**。若将来需要常驻采集再迁 |
| T-15 | rp-plugin msg dump 口径修正（`raw.messages` → `decision.messages`） | ✅ 已修（2026-09-11，心跳 45） | 原落 `raw.messages`（RP 注入**前**的原始批）→ 与 TT 侧 `chat_completion_prompt_ready`（最终组装态）一比，差异全是假的。现改为在各出口落**最终态**（组装 + `dsht-rp/assemble` 钩子后）；`viaAssembleHook` 统一收口 |

---

## 4. 兼容面剩余缺口（P1，V0.3-FREEZE §5 列的 7 项，已核实进度）

| # | 缺口 | 状态 | 落点 |
|---|---|---|---|
| T-16 | substituteRegex 枚举 1↔2 颠倒 | ✅ 已修 | `regex/engine.ts` |
| T-17 | 正则 `$1/$<name>` 捕获组失效 | ✅ 已修（TT 对照修复 2026-09-09） | `regex/engine.ts:165+` |
| T-18 | `{{match}}` 大小写不敏感 | ✅ 已修（v181，改 `/gi`） | `th-shim.ts:1086` |
| T-19 | shim `Mvu.parseMessage` 与 `state/mvu.ts` 不对称 | ✅ 已修 | `th-shim.ts:1594` |
| T-20 | `getTavernRegexes` 未对齐真 TH **snake_case** 形状 | ✅ 已修（2026-09-10，e78e433） | 出口/入口双向映射 + 契约测试 `th-regex-contract.spec.ts` |
| T-21 | `getChatMessages` / `getWorldbook` / `deleteVariable` 字段透传 | ✅ 已修（2026-09-10，ae59380） | 逐项对真 TH 类型定义补齐 |
| T-22 | `setglobalvar` 宏族 | ✅ 已修 | `th-shim.ts:1339+` |

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

### T-27　GitHub Releases 渠道 + 应用内检查更新开关　🚧 阻塞（缺外部前提）
- 现状：正式签名 / 更名 / 图标 / 版本号 / 一键出包 **已完成**；**只剩**「检查更新开关 + Releases 渠道」
- 完成标志：app 内能检测到新版本并给出更新入口
- **阻塞原因（需你先决定）**：
  1. **仓库还没有远端**（`git remote -v` 为空）→ 没有 GitHub 仓库就没有 Releases 渠道可对接
  2. 需要你提供：目标 GitHub 仓库（**公开 or 私有**？影响检查更新的鉴权方式）
  3. 应用内「检查更新」需确定**更新源**（GitHub Releases API / 自建静态 JSON）
- **可先做的部分**（不依赖上述决定）：本地「当前版本」展示 + 手动检查入口的 UI 骨架 + 版本比较逻辑

---

## 7. 长尾 / 观察项（P3，不阻塞发布）

| # | 项 | 说明 |
|---|---|---|
| T-28 | Tier 2 TH 长尾 API（约 50 项记名 stub 之外） | rebind 家族 / createOrReplacePreset / QuickReply 系 |
| T-29 | EJS 完整语法（当前子集：无函数调用/箭头函数/模板字符串/正则字面量） | 显式报错，非静默失败 |
| T-30 | 采样参数长尾（topP/topK/minP/penalties/seed…） | 等宿主 LLM 适配器白名单 |
| T-31 | 表格记忆长尾（E7 自定义渲染占位符 / E9 编辑器 / E12 设置导入导出） | 每项时间盒 |
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
   → T-04 双架构 APK 交付 → 【待你装机验三条基线（arm64 v220）】
   → T-20/T-21 兼容缺口补完 ✅
【接下来】T-23/T-24 验证债（回归清单可执行化）
   → T-14/T-15 宿主面收口 → T-12/T-13（D-6/D-7，需你拍板）
   → T-09 存量清洗（你拍板）→ T-25 大扫除 → T-26 README → T-27 Releases
   → T-28~T-33 长尾
```

**卡点提示**：T-25 大扫除在「T-04 装机验证通过 + 差异收敛」前**不能动**（数据冻结）。

---

## 附：工具与文档索引

| 用途 | 位置 |
|---|---|
| 升级度量 | `bash .goal/upgrade-0.1.5/evaluate.sh` → 0–5 |
| 升级目标/约束 | [.goal/upgrade-0.1.5/GOAL.md](.goal/upgrade-0.1.5/GOAL.md) |
| 升级策略/阻塞 | [.goal/upgrade-0.1.5/STRATEGY.md](.goal/upgrade-0.1.5/STRATEGY.md) |
| 平台补丁 | `scripts/apply-platform-patches.py`（`--check` 预检） |
| 插件构建 | `scripts/build-plugins.sh` |
| 一键升级 | `scripts/upgrade-runtime.sh` |
| 会话迁移验证 | `tools/verify-session-migration.py` + `scripts/stage3-migration-test.sh` |
| 自动化发送 | `rp-workspace/scripts/dsht-send.mjs` |
| 差异全文 | [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) |
| 兼容契约条款 | [rp-workspace/docs/ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| 冻结边界 | [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| 兼容审计 | [docs/COMPAT-AUDIT-2026-09-08.md](docs/COMPAT-AUDIT-2026-09-08.md) |
