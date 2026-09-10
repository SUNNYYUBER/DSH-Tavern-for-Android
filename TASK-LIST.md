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

**当前状态**：升级目标（evaluate.sh 5/5）已达成。心跳 46 已推进阶段三（T-27 可先做部分实机落地 + 两处静默缺陷修复 + 类型闸门补建）。

⚠️ **交付物状态提醒**：心跳 46 改了源码（`dsh-plugin` / `dsht-plugin-shared` / `import` / `NodeService.kt`），
**必须重打双架构 APK** 才与源码一致 —— 见 §9 末尾"每轮收尾"。

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
| T-13 | D-7 采样参数对照（TT 侧 `GENERATE_AFTER_COMBINE_PROMPTS` dump 未采） | ✅ **对照已补齐**（2026-09-11，心跳 46 + 修正） | 新建 `rp-workspace/scripts/golden-tt-sampling.mjs`（TT WebView CDP 里 monkey-patch `fetch`+`XHR` 抓**最终请求体**；采样参数不在 prompt 事件里，必须走网络层）。**修正后结论**（首版误判已作废）：① `max_tokens` **映射正常**（切真实 ST 预设 `maxTokens=65535` → 请求实测 65535；首版用无 `maxTokens` 的示范预设测到宿主默认 384000，属**测量口径错误**）② `top_p`/penalties 未发送 = **宿主限制 H-②**（非我方缺陷，预设值已持久化待宿主支持）③ `tools` TT **无** vs DSHT **32 个** = **唯一真差异**（D-6 实锤）。详见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) §D-7 |
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
- **待办（需你拍板）**：存量那 1 个 v3 文件的**实际修复**（修复器已能自愈，但落盘 = 改用户数据；
  且有 `.bak`）。见「待决策 D-9」。详见 LEARNINGS **L30**

### T-37　🟠 TH 宿主全局面缺 `Vue` / `SillyTavern`（卡脚本 ReferenceError + 每秒重跑注册循环）
- **实测**：设备 WebView 控制台每次启动抛 `Uncaught ReferenceError: Vue is not defined` 与
  `SillyTavern is not defined`；伴随 `[🦊][狐裁] 独立拦截器已注册`（每 2s）+
  `[StoryCtrl] 状态变更，更新注入…`（每 1s）的**注册循环**，把 logcat 刷成主噪音
- **判据**：脚本"反复重注册才算成功"= 上一次没真正生效 → **静默失败的一种形态**
- **方向**：把「TH 宿主全局面」当**逐项补齐的清单**，来源 = 卡脚本实际 ReferenceError 的符号名
  （已知需 `EjsTemplate`/`TavernHelper`/`YAML`/`showdown`/`toastr`/`z` + 实测的 `Vue`/`SillyTavern`），
  沿用现有 vendor iife 机制（`build-rp-ui.mjs`）。详见 LEARNINGS **L31**

### T-35　清理：4 份 deep-merge 实现收敛到 `dsht-plugin-shared`（P3）
- 现存：`tavern-helper/variables.ts:deepMergeVars`、`th-shim.ts:deepMergeAssign`、
  `dsht-plugin-mvu/index.ts:deepMerge`、`state/mvu.ts:deepMergeInitVars`（心跳 47 新增）
- 语义差异尚未逐对核对（前 3 份是否都满足「存量优先、只补不改」）。先补对照表再收敛，勿盲目合并。

---

## 7. 长尾 / 观察项（P3，不阻塞发布）

| # | 项 | 说明 |
|---|---|---|
| T-28 | Tier 2 TH 长尾 API（约 50 项记名 stub 之外） | ⏳ **未做**（设计如此）：不支持的 API 挂 stub → `console.warn` 记名 + `Promise.reject`（`th-shim.ts:392/1847`），**诚实失败而非假成功**。真 TH 长尾面（rebind 家族 / createOrReplacePreset / QuickReply 系）待「第三次冒同类问题」再升时间盒 |
| T-29 | EJS 完整语法（当前子集：无函数调用/箭头函数/模板字符串/正则字面量） | ✅ **已核验达标**（2026-09-11）：判据是「显式报错，非静默失败」而非「支持全部语法」。**实证**：subset 对 4 类不支持语法**全部显式抛错**（函数调用 `trailing tokens`、箭头 `unexpected char: =`、模板串 `unexpected char: \``、正则 `unexpected token: /`）；批次入口 `renderMessages` 单条失败**保留原文 + 打 `ejsError` 标记**（不静默清空）。**完整语法另有引擎**：`engine:'sandbox'`（node `vm`）实测支持箭头函数（`2,4,6`）、模板字符串（`v=1`）、正则字面量（`true`）、模板内定义函数（`12`）、内建 `Math`。唯一边界：**上下文经 vm 传入的函数不可克隆**（`cb(2)` → `runtime-error`）——属 vm 机制固有，非语法缺口，且**失败分类显式**（`ok:false, kind:'runtime-error'`） |
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
【待你拍板】T-08/T-12（D-6 关不关 tools：TT 请求体**完全没有** tools 字段，D-7 已实锤）
   → T-09 存量脏楼层清洗（3 会话 146 处）
【待你执行】把 arm64 包装真机，验三条基线（启动 / 打开旧聊天 / 发消息）
【待外部条件】T-25 大扫除（需先解冻 RP 数据）→ T-27 更新渠道（需提供目标 GitHub 仓库）
【随时可做】T-28~T-33 长尾（不阻塞发布）
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
| **构建期 vendor 依赖** | `node scripts/vendor-deps.mjs [--check]`（版本锚定表 = `scripts/vendor-deps.json`；缺失即自愈；构建前自动跑） |
| 插件构建 | `scripts/build-plugins.sh` |
| 一键升级 | `scripts/upgrade-runtime.sh` |
| 会话迁移验证 | `tools/verify-session-migration.py` + `scripts/stage3-migration-test.sh` |
| 自动化发送 | `rp-workspace/scripts/dsht-send.mjs` |
| 差异全文 | [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) |
| 兼容契约条款 | [rp-workspace/docs/ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| 冻结边界 | [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| 兼容审计 | [docs/COMPAT-AUDIT-2026-09-08.md](docs/COMPAT-AUDIT-2026-09-08.md) |
