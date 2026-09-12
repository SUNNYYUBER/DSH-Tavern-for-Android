# TASK-LIST：接下来要做的所有事（唯一任务清单）

> 建立：2026-09-10。**本文件是行动清单**（做什么、按什么顺序、做完的标志）；现状背景看 [MASTER_TODO.md](MASTER_TODO.md)，冻结边界看 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md)，升级细节看 [docs/DSH-0.1.5-UPGRADE-PLAN.md](docs/DSH-0.1.5-UPGRADE-PLAN.md)。
> 状态取值：⏳ 待办 / 🔄 进行中 / 🚧 阻塞 / ✅ 完成

---

## 0. 现在的处境（30 秒读完）

| 事实 | 说明 |
|---|---|
| 源码 runtime | **0.1.5-rc.1**（源码 sentinel **v303**，阶段 0/1/2/3/4 已全部推完） |
| 仓库最新产物 | **x86_64 debug sentinel v302（196,853,392 B）/ arm64 release sentinel v303（128,381,252 B）**，9-12 18:2x / 18:3x 构建（**心跳 66 的 T-76 因子 B 修复**：token 就绪门控）；**四路 md5 一致** `593a1d4a48ad8963e4aaf40e11063bb2`（staging = 设备 `dsh-runtime` = 设备 `profiles/web` = APK 内 `assets/dsh-runtime.zip`） |
| 设备侧 | **已装 v302**（x86_64 debug）；实机取证：**7 个 TH 脚本帧** · **T-74/T-75 验收 7/7 PASS × 11 判据**（帧面签名 `[26,16,41,false]`）· **T-76 因子 A 验收通过** · **T-76 因子 B 验收：负控 `held` ×1 / 文件通道放行 0 次 / 哨兵 loadUrl 0 次 / node 退出 0；正控就绪行出现、token 经 stdout 捕获** · 冷启对照工作区 26 项正常加载 |
| 升级进度 | **5 / 5** ✅ **达成**（阶段 4 已判定通过） |
| 单测 | **1329 项全绿（61 文件）** · `typecheck` 三段式 **0 错**（心跳 69 复跑确认） |
| 设备回归 | `stage4-regression` **21/21**（**21/21 已确认**；脚本「按磁盘 `lastTime` 选会话」的**形状假设**已于心跳 65 修掉，心跳 66 又修掉其「CDP 空响应时报错指向自己」的问题） |
| **本轮主线** | **心跳 69 = §6.5 核心判据「真跑完整卡脚本」达成** —— 抓出并修掉一个**上一轮复刻探针永远抓不到**的真缺陷（`eventSource.events` 缺席 ⇒ 卡 bootstrap 在 `RegexBinding()` 前中断）。四段核心功能**逐段取证全部执行、零异常**。见下方「当前状态」 |
| 未提交改动 | 心跳 62 的**新增** `packages/src/dsht-preflight/` + `tests/preflight.spec.ts` + `NodeService.kt` 注入 + 两个构建脚本 + 心跳 62B 的 T-48 + 心跳 63 的导入守卫 + 文档回写；**心跳 64 的 T-72（5 文件）**；**心跳 65 的 T-74/T-75 + T-76（`NodeService.kt`）+ `stage4-regression.mjs`**；**心跳 66 的 T-76 因子 B（`NodeService.kt` 就绪门控 / `MainActivity.kt` 等待屏 / `build-wb.sh` A12 / `stage4-regression.mjs`）**；**并发实例的** `DSH Android Roleplay App Plan.md` 等**一份没碰** |
| 本轮性质 | **心跳 66 = ① T-76「因子 B」闭环（可复现对照 → 否掉 v1 实现 → 最终修复 → 闸门 A12 → 设备验收）② T-47 C 档「问死」执行完毕（只读，零风险，不依赖 T-46 决策）③ 阶段三发布卫生闸门复跑刷新 ④ 回归脚本报错指向自己修复**（详见下方「当前状态」） |
| 发布闸门 | 🔴 **未达标**（**心跳 66 复跑**：受控面 **626 文件 / 合计 296 项 / exit 1**；心跳 61 为 616 / 305）⇒ **现在不能公开**；<br>✅ **`SECRET` 已由 1 → 0**（🔴 发布阻断项清除，但⚠️ 属**并发实例**在 `DSH Android Roleplay App Plan.md` 的**未提交**改动）<br>⚠️ **且密钥仍在本地 git 历史里**（仓库无远端、117 个提交从未推送 ⇒ 非对外事故）—— **P0 历史重写未做**；剩余 `WORDLIST 217 / LOCALPATH 47 / WXID 15 / SERVER 9 / PAYLOAD 8`（⚠️ **WXID 15 条全部来自并发实例的 `Plan 文档`**，非我方产物） |

**当前状态**：升级目标（evaluate.sh 5/5）已达成。
- **🟢 心跳 71 = 补上 goal 的两个「未验环节」**（此前都是间接证据，本轮补成直接证据）。
  ① **真实加载路径**（此前全部验证都是"手工把 `t37-inject.js` 注入宿主页"= 模拟"它已经在跑了"）：
  本轮按**加载器原文**（`SoliUmbra_预设内置正则_v2.js:1-23`：`window.frameElement` → `parentElement`
  爬到宿主 `body` → `appendChild(<script src="…/regex_bind/inject.js">)`）在设备上实跑：
  | 环节 | 实测 |
  |---|---|
  | 同源链可走（`frameElement` → 宿主 `body`） | **7/7 个 TH 帧全部 `true`** |
  | 宿主门面在帧内可见 | **`true`** |
  | 按加载器原文执行 | `ok: true`（`getScriptId`/jQuery/`SillyTavern` 帧内齐备） |
  | 宿主页真的出现外链标签 | **1 个**（`…/regex_bind/inject.js`） |
  | 卡脚本真的加载并执行 | `topVersionNumber: 11800` + `hasSPresetToolBinding: true` |
  ⇒ **从真实链路（TH 脚本帧 → 宿主页 → 外链卡脚本）到四段功能执行，全程打通**。
  ② **T-78 的前置实测（goal 明确要求：先验安卓 node 的 `worker_threads`）**：
  此前只在**本机** node 验过 API —— 本轮在**设备**上跑（用 `nativeLibraryDir/libnode.so` + `LD_LIBRARY_PATH` 补依赖 so）：
  ```
  RESULT: {"version":"v26.4.0","platform":"android","arch":"x64",
           "workerThreadsAvailable":true,"workerMessage":"pong","workerMs":133}
  ```
  ⇒ **安卓 node 支持 worker_threads**；但 T-78 的实现是**同步防护组合**，
  理由**不是"不可用"**而是**契约约束**：`triggerWorldInfo` 是同步函数且被 browser bundle 消费
  （`import/browser-entry.ts` → `app.js`，WebView 内无 `node:worker_threads`）⇒ 改 async 会破坏既有契约。
  ⇒ **选型依据已如实记录**（是"选了同步路线"，不是"退而求其次"）。
- **🟢 心跳 70 = 对心跳 69 的结论做「逐条反查」——两个可疑读数查清，均**不是缺陷**（判据修正，非改代码）**。
  ① **`regexBinding_onSortableStart === false` 的定性**：
  心跳 69 用它当 `RegexBinding()` 的"已完成"证据，读出 false ⇒ 一度怀疑"执行了但没做完整"。
  **逐里程碑打点查清**：`RegexBinding` 本体内 `if (versionNumber >= 11305) { … return; }`（`:3567`→**`:3721`**），
  而 `:3877` 的 `regexBinding_onSortableStart` **位于该分支之外** ⇒ **新版路径下永不执行 = 设计语义**
  （卡原文注释：`11305+ has built-in regex binding; ST is source of truth, only sync FROM ST`）。
  **实测证据**（4 处打点 + 零异常）：
  ```
  ['11305分支:进入(:3567)', '清理legacy前(:3596) regexLen=1',
   '注入执行顺序按钮(:3605)', '到达return(:3721)']
  页面异常: (无)
  ```
  ⇒ 该分支**从进入逐行走到末尾 return，一步不缺**。**我上一轮选错了特征副作用**（选中的正是新版路径故意不做的那段）。
  沉淀 **L133**（判"执行了"时，特征副作用必须落在"该分支真的会走的那一支"；取证法 = **逐里程碑打点**，无需预判分支结构）。
  ② **`ReferenceError: Vue is not defined` 的归属**：
  心跳 69 实测出现过一次。本轮带**帧归属**采集 12 秒 ⇒ **异常 `(无)`**；
  帧普查显示每个 TH 脚本帧**自己**从 `testingcf.jsdelivr.net` 拉 `vue` + `vue-router`，
  且当前**全部帧 `innerVue: "object"`**（已就绪）⇒ 该异常是 **CDN 瞬时未就绪**的竞态，
  属**卡侧 CDN 依赖**（与 T-37(c) 既有结论一致：真 ST/TT 同样如此，**非我方缺陷**）。
  ⇒ goal 的「零 ReferenceError」判据在**我方可控范围内成立**（我方不引入任何 ReferenceError；
  卡侧 CDN 竞态不归我方）。
- **🔴 心跳 69 = §6.5 的「核心判据」真正达成**（方法：**把那张卡 220,854 B 的脚本原样注入宿主页跑**，而非复刻部分链路）。
  ① 🔴 **抓出一个真缺陷（上一轮复刻探针永远抓不到）**：
  `TypeError: Cannot read properties of undefined (reading 'chat_completion_settings_ready')`
  —— 卡在 `inject.js:2966`（与 `:3110`）直接读 `ctx.eventSource.events[ctx.eventTypes.X]`，
  **按裸函数数组操作并就地替换元素**；而我方 `ThEventSource` 用内部 `Map` + 包装对象 ⇒
  `events` 属性缺席 ⇒ **bootstrap 在 `RegexBinding()` 之前整段中断**（四段功能一段都没跑）。
  ② **基准对照（逐字）**：`eventSource = new EventEmitter([...])`（`events.js:113`），实现明文
  `this.events = {}`（`lib/eventemitter.js:32`）、数组放**裸函数**（`:54`）⇒ 是**公开属性**且形状是裸数组。
  ③ **修法（两件缺一不可，否则"抛错变静默失效"= 更坏）**：
  (a) 暴露 `events`（键=事件名，值=**裸函数数组**）；
  (b) **以 `events` 为权威存储**（内部只旁路存 `once` 元数据），`emit` 从它取快照
  ⇒ 第三方**就地替换元素 / 直接 push** 均生效。
  ④ **设备实测（冷启后注入整脚本）**：
  ```
  四段已执行: ['RegexBinding','ChatSquash','MacroNest','syncSPresetToolRegistrations']
  四段执行中的异常: []
  页面异常: (无)          ← 修复前是 TypeError 中断
  SPresetImports: 8 个符号 · versionNumber: 11800 · eventSource有events: true
  ```
  ⑤ **单测 +8**（含**承重反控**：就地在 `events` 数组里替换元素/追加函数，`emit` 必须调用新函数 ——
  反控注入后 **14 条转红**，恢复即 24/24 绿）。
  ⑥ **沉淀 L132**：验第三方脚本兼容性时，「我复刻了它的调用序列」是**假证据**；
  「把它的成品原样跑一遍」才是真证据 —— 复刻部分链路 = 按自己的理解出题再自己答对。
- **🔴 心跳 67 = §6.5「ST 资产兼容族」四件全部落地 + 设备实测通过**（用户明确要求「彻底解决，不接受『基准也不做』作为不修的理由」）。
  ① **T-63 四个 ST 标准模块面**：新增 `assets/st-modules/{script.js, scripts/utils.js, scripts/preset-manager.js, scripts/openai.js}`
  + `index.ts` 注册四条 exact 路由（**资产缺失返真 404，绝不空壳**）。
  设备实测：四个端点 **全 200**（修复前全 404）、MIME `text/javascript`、
  **卡的 4 条静态 import 全部解析成功（missing=[]）**、`displayVersion='SillyTavern 1.18.0'`、
  `utils` 语义正确（`café`→`cafe`）、`presetManager` 同实例且六方法齐、`sendOpenAIRequest` **真 reject**（不返回假值）。
  ② **T-42 真接引擎**：卡的 `extension_settings.regex` 写入 → 复用既有 `/dsht-rp/rp/regex/save-global` 落到 node 侧 `rp/regex/global.json`。
  设备端到端：卡式写回后宿主 `1→2` 条 ⇒ **node 侧文件真变化**（27186→27574 B，13 字段逐字完整）⇒ 取证后**精确还原**。
  ③ **T-48 扩展文件路由 + 真渲染**：`/scripts/extensions/**` + `/scripts/templates/**` 路由（**路径穿越被拒**）、
  Handlebars 4.7.9 + DOMPurify 3.4.2（与基准 `package.json` 同锚定）进 UI bundle、退役心跳 62 的退化实现。
  设备实测：无文件→**真 404**；有文件→200 + `text/html`；**真渲染**出 HTML（变量已代入）；
  sanitize=true 清掉 `onerror` / false 保留（**证明消毒真在起作用**）。
  ④ **核心判据（§6.5 共同验收口径）**：把卡的 loader 逐字复刻到宿主页执行 ——
  `versionNumber=11800` · **两个 `module_imported` 容器都建立** · `SPresetImports` 八符号全拿到 · **页内异常 0 条**。
  ⑤ **T-78 世界书正则安全防护**（单源 `lore/safe-regex.ts`）：四道闸门（pattern 长/flags 白名单/危险模式静态拒绝/文本截断）。
  **实测反控**：防护停用时同一恶意输入 **8804 ms**，生效时整个测试文件 **16 ms**。
  ⑥ **T-79 卡正文防冒充**（单源 `dsht-plugin-shared/card-fence.ts`）：nonce 围栏 + 越权标记消毒；
  **残余 `{{` 实测 55 处**（非罕见，故必须处理）；两处卡正文注入点收敛到唯一漏斗。
  ⑦ **顺带修掉一个静默缺陷**：`build-wb.sh` **从不复制 assets 树**（`build-plugins.sh` 会），
  于是"源码新增的 assets 资产"在 build-wb 这条路**永远进不了包** ⇒ 新增断言 **A13**。
  **验收**：`typecheck` 三段式 0 错 · 单测 **61 文件 / 1321 全绿**（+126）· 四处反控全部真跑并转红 · 设备四项实测通过。
- **心跳 66** = **T-76「因子 B」全闭环（可复现对照 → 否掉 v1 实现 → 最终修复 → 闸门 A12 → 设备验收）+ 回归脚本报错指向自己修复**。
  ① **先建可复现对照（改代码之前）**：冷启 **+25 s** 往设备 `files/.dsh/dsht-token` 植入哨兵串 ⇒ **+26 s** 即
  `web token captured from dsht-token file (34 chars)` ⇒ **+42 s** `main-frame http 404 @ …?token=PLANTED_FACTORB_CONTROL_1234567890`，
  而官方 `dsh web:` 就绪行在 **+107 s** ⇒ **早 65 s 放行**（修复前必现）。定性缺陷 → **可判据化缺陷**。
  ② **机理**：垃圾 token → 404 → T-45 有界重载自愈；**合法 token + 网关未挂载** → 页面 200 但 RPC generation **一次性失败且不再重臂**
  ⇒ `phase` 恒 `'pending'` ⇒ **永久 loading**。生产端数据依赖：`dsh-plugin/index.ts:7466-7487` 只在 `await repairAllSessionSeqs()`
  （实测 38 s ~ >200 s）之后写 token ⇒ **文件合法地早于 `announceReady()` 落盘**。
  ③ 🔴 **否掉自己的 v1 实现（L119）**：v1 用「我方网关路由非 404」当就绪代理。实测 **TCP / `/` / 我方路由 / DSH 自己的 `/api` 前缀
  四条面一起在 +77.0 s 转"非 404"，权威就绪行在 +117.1 s** ⇒ **代理早 40 s**，负控里照样提前放行 ⇒ **整段删除**。
  ④ **最终修复（`NodeService.kt` 单点收口）**：`@Volatile readySignalSeen`；文件通道放行条件 = `readySignalSeen || stdoutSilent(≥90 s 零行) || failopen(≥300 s)`；
  未就绪只记一行 **held（可听）**不发布；`MainActivity` 等待屏分别显示「端口」「就绪信号」。
  ⑤ **闸门 A12**（`build-wb.sh`）：断言四处接线（`readySignalSeen` / `STDOUT_SILENT_MS` / 放行条件包裹 / MainActivity 显示），
  **正控 4/4、负控 3/3**；APK dex 语义核验 x86_64 `classes3.dex` / arm64 `classes.dex` 各 **3 命中**。
  ⑥ **设备验收全过**：负控 `held` ×1 / **文件通道放行 0 次**（修复前 1 次且早 65 s）/ 哨兵 loadUrl 0 / node 退出 0；
  正控就绪行出现、token 经 stdout 捕获、node 退出 0；`stage4-regression` **21/21**。
  ⑦ **交付**：`typecheck` 三段式 **0 错** · 单测 **56 文件 / 1195 全绿** · 四路 md5 **1 个值** `593a1d4a48ad8963e4aaf40e11063bb2`
  · 双架构 APK **x86_64 debug v302（196,853,392 B）/ arm64 release v303（128,381,252 B）**，**已装机 v302**。
  ⑧ 顺带修 `stage4-regression.mjs` 一处**报错指向自己**（CDP 空响应报 `SyntaxError: Unexpected end of JSON input`）→ 改为分别提示「不可达 / 空 / 非 JSON」。
  证据全文 `stage3-device/hb66/T76-FACTOR-B-EVIDENCE.md`。沉淀 **L119–L122**。
- **心跳 66 · 追加（同一心跳内继续推进不依赖决策的零风险项）**：
  ⑨ **T-47 C 档「问死」执行完毕**（只读）：8 个成员 **3 已实现**（`generate`/`generateRaw`/`mainApi`，
  心跳 63C 表误记为"缺口"—— grep 两包目录会把无关词计入）· **1 已出声 stub**（`stopGenerationById`/`stopAllGeneration`）·
  **4 判「不做」**（`getTokenCountAsync` 补了=制造假精度·`generateQuietPrompt`+`executeSlashCommandsWithOptions` 同一守卫链且只在
  **非活跃旧卡副本 `b7s7x3`**·`getPresetManager` 无消费者）⇒ **C 档对决策贡献 = 0**。
  证据 `stage3-device/hb66/C-BUCKET-WENSI.md`。
  ⑩ 🔴 **副产物（比 C 档本身更值钱）**：**`window.parent.SillyTavern.getContext()` 是卡的真实可达路径**
  （`梦鲸思客预设助手_1_7.js` 的 `L()` 逐字这么写）⇒ 证明**宿主面 40 成员确实是被卡读到的面**、T-46 投影无机制障碍；
  且 **帧面已存在 `characters: []` / `characterId: -1` 空占位**（`th-shim.ts:2480`）而宿主面反而"缺"
  ⇒ 口径由**「缺失」改为「空占位（已存在）」**（不改行为——那正是 T-47 B 档待决项）。
  ⑪ **阶段三发布卫生闸门复跑刷新**：受控文件 **626** 个 / 合计 **296 项** / **exit 1**（仍不能公开）；
  `SECRET` **0**（阻断项已清）；剩余 `WORDLIST 217 · LOCALPATH 47 · WXID 15 · SERVER 9 · PAYLOAD 8`。
  ⚠️ **WXID 15 条集中在 `DSH Android Roleplay App Plan.md`**（**并发实例的未提交文件**，非我方产物）。
- **心跳 65** = **T-74/T-75 实机闭环 + 推翻 T-73 判定、修掉 T-76（首启启动竞态）+ 回归脚本形状假设修复**。
  ① **T-74/T-75 实机闭环**（上一轮改的 3 个成员）：装 build#3（**v296**）后 `t74-chatid-probe` **7/7 PASS × 11 判据**
  —— `chatId` 两面同值且 == `getCurrentChatId()`；`uuidv4` 两面皆函数、两次取值互异；`mainApi` 两面 `'openai'`；
  **把卡的闸门逐字搬进探针跑，结果 `PROCEED`**；负控 `onlineStatus` / `chat_id` / `chatIdXxx` 两面皆 absent。
  `frame-surface-diff` 形态签名 **`[23,13,40,false] → [26,16,41,false]`** = **+3/+3/+1/0**，与改动面**逐项对上**；
  四路 md5 一致；`stage4-regression` 21/21。
  ② 🔴 **T-73 判定被推翻**：心跳 64 判「慢、非缺陷（服务 1.2–6.0 s vs 观察窗 3 s；reload 未复现）」。
  本轮**直接复现**：菜单 `Loading workspaces…` **连续 60 s 不变**（20 次 × 3 s 轮询），reload 后**立刻**恢复 26 个工作区。
  **旧测量为什么无意义**：它测的是**连接已健康**页面上的服务耗时；真出问题的页面上 `workspace.list` / `session.list`
  **根本没发出去**（`phase` 恒 `'pending'`）—— 服务快慢与症状无关（L116）。
  **根因（官方源 + 实机双向确证）**：DSH 自己在 `deepseek-harness/packages/bundle/web-app/src/index.ts:249-256` 写着
  「**`dsh web:` URL 行就是就绪信号；兄弟行（`/api` 属主）仍在挂载时不得触发**」，而 `FrontendStatic` 挂载早于
  `announceReady()` ⇒ **页面可服务 ≠ 网关就绪**，实测存在 **20 s** 窗口（14:50:58 前端启动 → 14:51:18 网关就绪）。
  窗口内启动的前端，连接 generation **一次性失败且不再重臂**
  （`typert gateway: session/control: active Service "sessionController" is unavailable`）
  ⇒ `WorkspaceListState.phase` 永远 `'pending'`（`workspaces/service.ts:38-42` + `WorkspacePicker.tsx:197`）⇒ **永久 loading**。
  **触发因子 A（我方代码 · 已修）**：`NodeService.onStartCommand` 里 `startPortProbe()`
  （主线程立即启动、每秒读 `dsht-token`）**先于**后台线程里的「清旧 token」⇒ 探活线程读到**上一进程遗留**的 token 并发布
  ⇒ MainActivity 立刻 `loadUrl`。**两次实机实证**：发布值与上一进程 launchToken **逐字符相同**
  （`14:45:03` 捕获 → `14:50:18 main-frame 404 @ …?token=61h9F09G7VlD5yqB…`；冷启 `14:58:42` 捕获 → `14:59:27 …?token=-sULV_…`）。
  **修复（一处）**：清旧**上移到 `onStartCommand` 同步执行且早于 `startPortProbe()`** + `coldStart` 守卫
  （仅本次真要拉起 node 时清，避免重复 `onStartCommand` 误删当次有效回退通道）。
  **验收（刻意用 install 触发哨兵 +1 = 重建首装宽窗口）**：`token file not found yet (miss #15, port open)` →
  `15:08:47.700 dsh web: …?token=p6zD8q…` → `15:08:47.746 web token captured`（**+46 ms**）；
  ① 用 `T_old` 加载主框架 **0 次**（修复前必现且逐字符相同）② 就绪前零发布 ③ `sessionController is unavailable` **0 次**。
  **端到端且优于预期**：应用**直接恢复上次 RP 会话**，卡死态**完全未出现**。
  ⚠️ **诚实边界**：因子 B（`MainActivity` 门控只认主框架 HTTP 状态 / 网络错误、**不感知后端就绪**）**本轮未修**，
  已单独登记；若将来出现「插件把 token 写在就绪之前」的新路径，缺陷会复发。**不假装它已经好了。**
  ③ **顺带修掉回归脚本的形状假设（L113 同族）**：`stage4-regression.mjs` 用「磁盘 `lastTime` 最近」当 live 判据、
  且把 `open-chat` 的 **404 也算通过** ⇒ 在「用户开着空会话、磁盘另有更近旧会话」时把 21/21 **误报成 20/21**。
  已改为**行为探测**（先试页面记录的当前会话，再按 `lastTime` 降序逐个 `open-chat`，**第一个返回 200 的即 live**），
  判据收严为**必须 200**。修复后不带参数即 **21/21**。
  ④ **交付**：`typecheck` 三段式 **0 错** · 单测 **56 文件 / 1195 全绿** · 四路 md5 **1 个值** `9004dfbc848d07f84204dd787afee87e`
  · 双架构 APK **x86_64 debug v298（196,853,392 B）/ arm64 release v299（128,379,624 B）**，**已装机 v298**
  · 哨兵（APK 内 Kotlin ⇔ 设备 `build-info`）同为 **v298** ⇒ 证明**修好的 Kotlin 确实进了这个 APK**。
  证据全文 `stage3-device/hb65/HB65-T76-BOOT-RACE-EVIDENCE.md`（T-74/T-75 另见 `HB65-T74-T75-EVIDENCE.md`）。
  沉淀 **L116 / L117 / L118**；新增可复用工具 `stage3-device/hb65/card-surface-census.mjs`（四形态静态普查，`--selftest` 9/9）
  与 `rp-workspace/scripts/audit-shim-template-literal.mjs`（L70 闸门化，接进 `build-wb.sh` 作 **A11**，`--selftest` 5/5）。
- **心跳 64** = **T-46 live 帧读数闭合 + T-71 高频轮询定性（追到底判定为非缺陷）**。
  ① **T-46 最后一处诚实边界首次闭合**：新工具 `stage3-device/hb64/frame-surface-diff.mjs`（纯只读）经 CDP 取到
  **7 个 `about:srcdoc` 脚本帧 + 1 个宿主页**，**7 帧形态签名完全一致** `[顶层 22 / getContext 11 / 父页 40 / identitySame=false]`
  ⇒ 心跳 63 的四口径静态结论（22 / 11 / 40）**被 live 逐项确认**，且 **`identitySame=false` 实证"帧内 ST 是自建对象、不是父页投影"**。
  **首次拿到名单级证据** ⇒ **投影得失精确算出**：相对顶层 **得到 27 / 丢 9**；相对 getContext **得到 29 / 丢 0**。
  ⚠️ **口径修正**：丢的 9 个里含 `getContext` 自身，而投影定义**显式补回它** ⇒ **实际丢 8 个**
  （`characterId · characters · getCharacterCardFields · getChatCompletionModel · getRequestHeaders · loadWorldInfo · registerMacro · unregisterMacro`）。
  ⇒ **T-46 判定条件由静态推断升级为实测结论**：投影必须与「宿主面补齐这 8 个」配对，其中两个正是 T-47 待决成员
  ⇒ **T-46 与 T-47 必须合并拍板**。
  **另得两条新观察**：**帧内"两面互不包含"** —— getContext(11) 有 **7 个成员**（`characterName · chatLength · nameOverride · presetName ·
  promptManager · renderExtensionTemplate · renderExtensionTemplateAsync`）**在顶层(22)里不存在**，而基准形态是"顶层 ≡ getContext 展开"
  （我方并集仅 29）⇒ 卡在顶层直取这 7 个会得 `undefined`（**不依赖 T-46 决策即可低成本单独修**，登记）；
  **宿主页顶层仅 3 个 key**（`getContext, i18n, libs`）⇒ 但与卡脚本**无直接可达路径**（卡跑在帧内）、投影读的是
  `parent.SillyTavern.getContext()` ⇒ **判为不修**（无效功，L36）。
  ② **T-71 定性（第一反应是"我方 API 性能缺陷"，追到底推翻）**：logcat 显示某帧 642.3 s 内 `vars:get` **6209 次**（9.67/s）·
  `vars:put` **643 次**（1.00/s，**含写**）。
  🔴 **先踩语料陷阱（本轮最重要方法学产出 → L109）**：设备上有**两个卡副本**（`b7s7x3`=0605 / `18l9cbg`=0703-0708），
  **同名脚本 id 相同、内容不同**（「世界书控制」84,866 B vs **157,718 B**）⇒ 按 id 取语料**不确定取到哪一个**；
  首轮取到旧版（零处 `replaceVariables`），与现象**对不上**，一度记为"真实矛盾"。
  **纠错判据**：`c1ec74d0`（剧情逻辑 0703）**只在 `18l9cbg` 而它在页面上有帧** ⇒ 活动副本 = `18l9cbg`，换语料后一次自洽（15 处 `updateVariablesWith`）。
  **根因链**：卡自带 `setInterval(masterLoop, 1000)` + 每轮约 9 次 `getVariables` + 1 次 `updateVariablesWith`
  ⇒ 我方 `th-shim.ts:771-775` 的 `updateVariablesWith = 1×vars:get + 1×vars:put` ⇒ **与 `643 : 643` 精确吻合**。
  **基准对照（判"非缺陷"的判据 → L110）**：基准 `variables.ts:211-223` 的 `updateVariablesWith` **同为 get + replaceVariables**，
  且基准 `insertOrAssignVariables`（`:241-246`）**本身就走它** ⇒ **"每秒 1 次写"不是我方引入**。
  **落盘判据**：`rp/variables/global.json` 仅 **182 B** 且 **31 h 未变**、活动会话 state 文件 2.2 h 未变 ⇒ **写未落盘**。
  ⇒ **判定：非缺陷**；仅「`vars:get` 每次 `readFile`（基准内存）」登记为**观察**。
  ③ **顺带登记两条真实差异（不阻塞、当前路径不触发）**：我方 `insertOrAssignVariables` 对**非 chat 作用域**走服务端 `vars:merge`，
  而**基准一律走 `updateVariablesWith`** ⇒ 基准 replace 语义**全量写回（副作用：能删键）**，merge 不能（当前活跃脚本不触发）；
  `deepMergeIncoming` 与 lodash `_.mergeWith` 在 **`undefined` 源值**上分叉（**数组替换一侧一致** ✅；lodash 跳过、我方覆盖）⇒ **低优先不改**。
  ④ 🆕 **T-72 —— 从"量缺口"里挖出的真实用户可见缺陷（已修）**：帧内 `window.SillyTavern` **顶层与 `getContext()` 两面都没有 `name1`**（用户名），
  而**当前活跃卡两种取法都在用**：`世界书控制_0708.js:4130` **顶层直取且只有对象级守卫**
  （`typeof SillyTavern !== "undefined" ? SillyTavern.name1 : "User"` —— `SillyTavern` 在帧内确实存在 ⇒ 守卫通过 ⇒ `undefined`
  ⇒ 拼出 **`"undefined: 内容"`**）；`飞讯_0703.js:36` 经 `getContext().name1` 但兜底是**未展开的宏字面量** `'{{user}}'`。
  **基准两面都有**（我方 `name2` 在列而 `name1` 缺 —— 同一对成员只挂了一半）。宿主侧**确有真值**（CDP 实测 `{"name1":"示例人设乙"}`）。
  **修复 5 处**（`th-shim.ts` 快照加 `userName` + 两面各补 `name1`；`host-macro-bridge.ts` 加**可选就绪回调**
  `refreshHostMacroEnv(slug,sid,onReady?)`；`RpScriptHost.tsx` 快照并入 `hostUserName()` + 抽出 `pushContextSnapshotToFrames()`
  单实现 + 宏环境就绪时**原地补字段并重推**）+ **2 条单测**。**两处设计取舍（有意为之）**：① 就绪重推用**原地改字段**而非换新对象
  （`T-37` 依赖快照**引用稳定**）；② `hostUserName()` 缺省返回 `undefined`、**绝不返回 `''`**。⚠️ 过程中**再踩 L70（第三次）**：
  在**模板串内部**的注释里写了反引号 ⇒ 终止模板串 ⇒ `tsc` 报 20+ 条 `TS1443/TS1005`。
  ⑤ **T-46 决策的新增量化**：语料顶层直取 **21 种 / 254 次**，帧内顶层**缺席 10 种**，其中**仅 `name1`/`uuidv4` 在宿主面有**
  ⇒ **投影只能补回 2 种**，其余 8 种（含 6 个生成栈成员）投影也补不上 ⇒ **T-46 与 T-47 必须合并拍板**（第三次确认）。
  ⑥ **实机验收（v290 装机）**：**T-72 判据 7/7 PASS**（`t72-name1-probe.mjs`，7 个 `about:srcdoc` 帧；两面取值 `"示例人设乙"` 一致；**负控 `name3` 两面缺席** ⇒ 探针能区分存在/缺席）·
  帧面签名由 `[22,11,40,false]` → **`[23,13,40,false]`**（**+1/+2** 与「顶层只补 `name1`、getContext 面补 `name1`+`name2`」逐项对上，`pCtx`/`identitySame` 未动）；
  `stage4-regression` **21/21**（首次全绿，会话已 attach）。
  ⚠️ **前置条件**：`srcdoc` 帧**只在打开 RP 会话后才存在**（冷启 iframe 数 = 0）⇒ 直接跑探针会得到与"探针坏了"同形的**假空结果**。
  ⚠️ **诚实登记**：为取 live 帧打开了用户的真实 RP 会话；核对后产生的写入**全部附加/派生**（1 条 `session/end-seed` 元数据事件 + turn 锚点文件快照 + 卡自身变量轮询 + projcache），**会话总数 81 不变**，**不做还原**。
  ⑦ **交付**：**已改产品源码** ⇒ 双架构 APK 重打 **x86_64 debug v290（196,851,409 B）/ arm64 release v291（128,377,632 B）**，
  载荷新符号双向核验（`pushContextSnapshotToFrames`×3 · `hostUserName`×3 · `name1: ctx.name1`×1，两个 APK 都命中）；
  证据 `stage3-device/hb64/{T46-LIVE-FRAME-EVIDENCE,T71-POLLING-CENSUS,T72-NAME1-TOPFACE-FIX}.md`；
  新工具 `frame-surface-diff.mjs` / `cross-topface-gap.mjs` / `extract-script.mjs`；沉淀 **L109 / L110 / L111**。
- **心跳 63D** = **T-70 收口（性能根因彻查 + 修复 + 实机验收）+ T-47 A 档落地**。
  🔴 **原登记把根因写错了**：写的是「I/O = O(全部会话字节) 且一次只有一个流在跑」，实测证明是 **CPU**。
  **两张判决性测量**：设备**裸磁盘**读 65 MB 仅 **65 ms**（≈1 GB/s）⇒ **I/O 带宽不是瓶颈**；
  宿主同一文件 `readline` 逐行 **442 ms** vs 字节扫描 **21 ms**（62.3 MB，**20.9×**）。
  ⇒ 由此反推「加并发」是错方向（单线程 JS 里并发不产生 CPU 并行）—— **实测印证**：
  只加并发时暖态 7.58 → 5.3 s，**仅 1.4×**（那 1.4× 恰是被重叠掉的那部分 I/O 等待）。
  ① **还有第二个独立的 CPU 成本**（第一版 profile 的语料恰好没覆盖）：`handleRow` 写成 `async` ⇒ **每行一次 Promise**；
  设备语料 **311,484 行**，而宿主同量级语料（79.3 MB / 314,383 行）上真实实现 **119 ms** vs 同步版 **72 ms**。
  ⇒ **两件事都要做**（换 readline 治"把全部字节变成字符串"，同步化治"每行一个 Promise"）。
  ② **修复**：新增 `dsht-plugin-shared/jsonl-scan.ts`（字节扫描 + **主循环全同步**，只有"行首字节不是 JSON 起始符"的行进慢路径队列）
  + `collectSessionsAudit` 切换，**`readline` 在产物里归零**；`mapBounded` 保留（现在是**叠加**收益而非主修复）。
  ③ **等价性判据（本轮最强的一条）**：`sha` 覆盖 `JSON.stringify(sessions)`（**顺序敏感**）——
  设备实测与改造前基线**逐字相同** `db58cb474c424239`（`count` 81 · `first3` 逐字一致）。
  ④ **单测 20 条对拍**（**19 条是"新 ≡ 旧"逐字相等** + 每条自带正控），语料按**口径边界**设计
  （空文件 / 末行无换行 / 中间空行 / CRLF / **U+00A0 · U+3000** / 单行 > 1 MiB 跨块 / `time` 为 0 / 非法 JSON）
  —— **当场抓住两个会静默产出错值的 bug**：**末行 off-by-one**（⇒ `lastTime` 恒 `null`）与
  **行数口径**（旧实现是「**非空行数** - 1」而非「`'\n'` 个数」，含空行文件上不等价）。
  ⑤ **UI 侧同族修复**：刷新期间**不清零** + 「刷新中…」提示；并**纠正一条判据自身的缺陷** ——
  新加的第 4 条判据 `noAuditingFlash` 用 `txt.includes('审计中…')` 探测"清零闪烁"，而新实现的按钮文案
  **本来就是**「⟳ 审计中…」⇒ 该判据**恒假**，输出与"缺陷仍在"完全同形。改为语义自明的双向表述 + **负控**
  （人为改 1 个「归档」按钮文案 ⇒ 计数 81→80→还原 81）⇒ **5/5 PASS**。
  ⑥ **T-47 A 档落地**：`saveChat` 宿主面镜像 ⇒ 宿主门面 **39 → 40** 成员，语料缺口 **18 → 17**。
  ⑦ **沉淀 L105–L108**（优化前先量瓶颈在哪类资源 / 换算法必须真实数据逐字对拍 /
  判据要双向推演·恒假判据与真缺陷同形 / **被推翻的归因要当场回改文档**）。
- **心跳 63C 续** = **T-69 修复 + 实机三级验收 + 新发现 T-70**。
  🔴 **一个「上线起从未可用」的功能被实机抓到**：设备「会话」页显示 `审计失败：unknown endpoint` +「未发现任何会话文件。」
  （而设备实有 **81 个会话**）。**端点对质**：同页 `rp/home` / `rp/workspaces` / `rp/books` 全 **200**，唯
  `/dsht-rp/sessions-audit` **404** ⇒ 不是插件没挂，是路径不存在。**根因**：`SessionsPanel.tsx` **4 处调用 / 3 个路径**
  少了 `rp/` 前缀（全仓 15 个唯一 `rpApi` 路径里**正好这 3 个**），被 `catch { setNote(...) }` 吞成一句提示。
  ① 🔴 **防线自己有整类盲区**：`audit-route-contract.mjs`（**心跳 46 正为此类缺陷而建**）把「服务端找不到该路径」
  降级为"说明"**不计违约**（L44 同族，**同一文件第二次**）⇒ 已升级为**违约**。
  ② **修复只改一侧**（前端对齐后端，不留后端别名）+ 防线加 `--selftest`（**6/6 PASS**，含反控）+ **接入构建 A10**。
  ③ **最佳正控**：升级后在**修复前**跑真实源码 ⇒ **精确报出 3 处、零误报**。
  ④ **实机三级验收全 PASS**：端点 200 / 400（vs 负控 404）· 产物**三方 md5 一致**（staging = 设备 = APK 内）
  · **UI 面板首次可用**（「分叉残留（1）」+ 会话列表 + 归档按钮解禁）。
  ⑤ 🆕 **T-70（性能，登记不开工）**：`/rp/sessions-audit` 暖 **6.4 s** / 冷 **48 s**（服务端为拿 `events` 逐行读完 81 个会话全文）。
  ⑥ 🆕 **额外推进（零风险只读）：T-47 的「需定语义」查成可执行清单** —— 7 个成员照 L101 三处齐取证 ⇒
  **1 个可直接做**（`saveChat`）· **1 个应判「不补」**（`chatMetadata.file_name/chat_id` 在基准里本就不是 `chat_metadata` 的属性，
  真 ST 也是 `undefined`）· **4 个语义已定待实施**（`onlineStatus` / `powerUserSettings` / `extensionPrompts` / 生成栈）·
  **1 组必须成对建模型**（`characters`+`characterId`）。并**校正计数口径**：「23 次」是上界（含同名本地对象）。
  ⑦ **沉淀 L102 / L103 / L104**；证据 `stage3-device/hb63/SESSIONS-PANEL-404-FIX.md`。
- **心跳 63C** = **审计器第三次扩域：把「不可判定」当线索而不是结论** ⇒ 又挖出**三个整类漏检**，
  宿主面缺口 **15 → 18 个成员**、覆盖率 **13/54 → 50/54**。
  ① 三个漏检（全有语料实证 + 正控 + 反控）：**A 可选调用 `getContext?.()`**（`酒馆思维链清洗.js:14`，该文件 6 处 getContext 一条都提不出来）·
  **B 字符串下标 `globalThis["SillyTavern"]`**（`傻瓜版导入脚本2_0.js:591`）·
  **C 同文件自定义转发方法 `this.getContext()`**（`:587-596`，同文件 6 处成员访问此前全不可见；**自证式判据** = 无参 `getContext()` 且其**配平函数体内出现 `SillyTavern`**，配新反控 `class Painter{…getContext('2d')}` 必须为空）。
  ② **覆盖率口径两态 → 三态**：`已核验 18 · 已判定不取 ctx 32 · 不可判定 4`（「不取 ctx」是**可判定**的：任何取法必然提 `SillyTavern`/`getContext` 两个名字之一）。
  ③ **新增「存在性守卫」维度**（决定"会崩"还是"静默降级"）：生成栈 4/6 成员有守卫，而 B 档 6 个成员**零守卫**。
  ④ 🔴 **纠一处档位误判**：`onlineStatus` **不是连接状态**而是**AI 后端在线标识/模型名**（`script.js:600` + `:7093-7097`）⇒ 移入 B 档；
  `powerUserSettings` 也移入 B 档（子路径不止 `persona_description` 还有 `reasoning`，且脚本会**写**它而我方无消费者）⇒ **A 档收缩到只剩 `saveChat`**。
  ⑤ 报告 `stage3-device/hb63/T46-CORPUS-CENSUS-2.md`；沉淀 **L99 / L100**。
- **心跳 63B** = **全语料普查：把 T-46/T-47 的决策输入从「1 张卡 / 3 个成员」换成「设备上全部真实脚本 / 15 个成员」**。
  设备实测拉取 **19 个 `tavern-helper-scripts.json`**（12 卡 + 7 预设）→ 抽取 **54 个脚本 / 6.5 MB / 启用 45**。
  ⚠️ **先修了审计器自己的两个整类漏检**（不改就没有分辨力）：**A 顶层直取 `SillyTavern.x`**（不经 `getContext`）·
  **B 间接 `X.SillyTavern.getContext()`** ⇒ 修后已核验 **9 → 13 文件**、缺口 **16 → 26**；
  闸门 **4 正控 + 1 反控全 PASS**、原卡结论**逐字不变**。
  **结果：宿主面缺口 15 个成员**（不是 3 个，且为下界）：`characterId`(31 次) / `characters`(23) / `chatMetadata`(13) /
  `generateRaw`(6) / `getTokenCountAsync`(5) / **`powerUserSettings`**(2，全新) / `stopGeneration` / `updateMessageBlock` /
  `generate` / `executeSlashCommandsWithOptions` / `messageFormatting` / `generateQuietPrompt` / `saveChat` / `mainApi` / `onlineStatus`。
  触发者**不是扩展**（推翻 T-47 原判）而是 **DSHT 自己启用中的预设脚本 `🦊示例卡二~`**（主预设 V17.1 / Agent V14.7 各一份，`enabled=true`）。
  ⇒ **T-46 的投影方案需重新计价**（投影不会自动补上宿主面缺的那 15 个），且其中 6 个属**生成栈**，是 T-42/T-48 同型「完整实现=无效功」候选
  ⇒ 已在 **T-47** 出**四档处置**（可低成本补 / 需数据模型决策 / 生成栈先问死 / 相邻域）。
- **心跳 63** = **T-46「可行性分档」收口 —— 结论是原判据本身错了**：T-46 长期挂着的理由是**假两难**
  （「补 iframe 成员 = 要么在模板串里**再抄一份**（违反单源纪律）要么**注入式装配**」）。
  回基准一读就解开了：真 TH `src/iframe/predefine.js:26-35` 用 `Object.defineProperty(window,'SillyTavern',
  { get: () => ({ ...parent.SillyTavern.getContext(), getContext }) })` —— **就是父页投影**，
  既不抄写、也不装配、**更没有桥**（基准 0 处 postMessage）。
  ⇒ 原三分法逐档坍缩：`可经 postMessage 桥` = **空集** · `必须同步` = **不存在**（同源 + getter 直取）·
  `需要注入式装配` = **空集**（→ 沉淀 **L96**）。
  **四口径实测**（新工具 `rp-workspace/scripts/audit-iframe-surface-gap.mjs`，纯只读）：真 ST **145** / 宿主面 **39** /
  **iframe 顶层 22** / iframe `getContext()` **11**；卡样本 19 个成员里 **iframe 顶层缺 12 / getContext 缺 15 /
  宿主面 0 缺**（终于解释了并集口径为何一直报「缺口 0」）。
  **本轮新量出的关键代价**：投影会丢 **10 个自建独有成员**（`characters` / `characterId` 也在其中）
  ⇒ **投影必须与「宿主面补齐这 9 个」配对，否则倒退**；而 `characters`/`characterId` 恰是 **T-47 的待决成员**
  ⇒ **T-46 与 T-47 合并为一个决策**（两方案规模对比见 T-46 正文）。
  顺带查出 62B 遗留：`renderExtensionTemplateAsync` **只落 getContext 面、没落 iframe 顶层**。
  **源码未改动**（纯静态分档 + 文档）⇒ APK 沿用 v280/v281、单测沿用 1149 全绿。
- **心跳 62 续（62B）** = **T-48 部分收口：把「未移植」（`TypeError: … is not a function`）变成
  「已移植但环境不支持」（基准同形错误路径 + 具名记名）**。设备只读探针先把缺口钉死：宿主门面 **37** 成员、
  `renderExtensionTemplateAsync` **连 stub 都没有**；`Handlebars` / `DOMPurify` / `/scripts/extensions/**` 路由 /
  扩展文件存储**四者全缺**（实测全 404）⇒ **完整实现判定为不做**（三件缺一都渲染不出来，且唯一消费者
  要么是 T-42 已否决的路线、要么根本没装在 DSHT）。
  交付 = 两个门面（宿主 + iframe，同语义镜像）给出**与基准 catch 分支一致**的退化实现
  （记名 + `console.error` 带路径 + `toastr.error` + 返回 `undefined`，**不 reject**）。
  单测 **1149 全绿（+8，含 1 条反控）** · 实机 `facadeMembers 37→39`、`typeof = 'function'`、
  `await` 得 `undefined`、`console.error` 逐字含 `scripts/extensions/regex/editor.html` ·
  双架构 APK **v280/v281** · `stage4-regression` **20/21**（与基线同）。
- **心跳 62** = **把 T-65 的「建议」变成上线**：T-65 的损坏发生在 `[cordis.init]` **插件树加载期**，而我方修复器
  **全在插件体内**（L88：位置不对，再正确也救不了场）⇒ 换位置：把预检塞进 **node 启动参数**
  （`NODE_OPTIONS=--import file://<abs>/dsht-preflight/lib/index.js`，官方源**零修改**）。
  新交付 `dsht-preflight`（纯文件扫描 + `rename` 搬正 + 目标冲突则**隔离到 `sessions/` 之外** + 一切异常 fail-open），
  带**入口闸**（`argv[1]` 必须是 DSH 主入口，因 `NODE_OPTIONS` 会被子进程继承）与**反控闸** `DSHT_PREFLIGHT_DISABLE=1`。
  **设备四段闭环**：基线（预检真跑了 `81 个 → ok=80 搬迁=1`）→ 反控（`node exited=2 / corrupt=10`）→
  正控（`node exited=0 / corrupt=0 / repaired=1`）→ 收场（全树 0 待修、顶层回 26）。
  单测 **1141 全绿（+25）** · 双架构 APK **v278/v279** · 新增构建断言 **A8/A9**（防「产物进包但没人加载它」这种空防线）。
  沉淀 **L94/L95**。详见 **T-67**（已做）与 **T-68**（新登记：运行期动 `sessions/` 顶层会打死 node）。
- **心跳 61B** = **实机验收时挖出一个会让 app 无限 crash-loop 的「会话目录不变量」缺陷（三层链，其中两层是我方自造）**：
  `/rp/home` 交出非规范路径形态 `/data/user/0/<pkg>/…`（触发源）+ `repairSessionCwds` **先 rename 目录、后按硬编码
  `session.jsonl` 读文件**（0.1.5 世代不存在该文件 ⇒ `ENOENT` 被吞 ⇒ **半修复态、永不收敛**）+ 插件树**加载期**
  `assertStoredIdentity` 抛错 ⇒ `node exited with code 1` 无限循环。已修三件（纯度取 basename / 路径规范化 / 失败进 logcat）
  + 新增不变量审计闸门（**85/85 / 0 违反**）+ 冷启动决断性回归（**node 退出计数 0**）+ 负控 4 条转红。
  沉淀 **L87/L88/L89**。详见 **T-65**（已修）与 **T-67**（建议：壳侧 pre-boot 预检）。
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
| **T-46**<br>**+T-47**<br>（心跳 63 已合并） | **① iframe 门面要不要升、怎么升；② 宿主门面缺的 **18 个**成员怎么办**（`characters` / `characterId` / `chatMetadata` / `onlineStatus` / `powerUserSettings` / `extensionPrompts` / `variables` 等）<br>—— 两者**是同一个决定的两半**：投影（T-46 推荐方案）会丢 10 个自建独有成员，其中 `characters` / `characterId` 恰是 T-47 的待决项。 | **推荐方案 A（照抄基准：父页投影 + 宿主面补齐 9 个）**：逐字同形、约 **5 行**改动、宿主面将来补齐多少 iframe **自动跟随**；<br>**方案 B（保持自建 + 顶层逐条转发）**：22 条转发且**长期漂移**（T-19/T-41 同型约束）。<br>⚠️ 无论哪案，`characters` + `characterId` 必须**成对**建真实角色列表模型、`chatMetadata` 需定**语义归属**（拒绝"给空对象"——那会让卡的写入**静默消失**）。<br>📌 **63C 更新**：缺口 **15 → 18** 个成员，且**优先级排序变了** —— B 档 6 个成员 **零 `typeof` 守卫（撞上就抛）**，而 C 档生成栈 4/6 **有守卫（只静默降级）** ⇒ **B 档 > C 档**（此前把 C 档列为最重）。<br>✅ **A 档只剩 `saveChat`**，且**先补宿主面在"投影"与"不投影"两条路线下都是净收益** ⇒ 可不依赖本决策先行。<br>📌 **63C 续取证（7 个成员三处齐查完）**：`saveChat` **可直接做**（宿主面镜像 `th-shim.ts:2347` 已有实现）· **`chatMetadata.file_name/chat_id` 应判「不补」**（基准里本就不是 `chat_metadata` 的属性 ⇒ 真 ST 也读到 `undefined`，补了违反 L36 且零收益）· `onlineStatus` / `powerUserSettings` / `extensionPrompts` 语义已定、待实施（后两者**不可给可写容器**）· `characters`+`characterId` **必须成对建真实卡片模型**（给空数组只是把一处崩换成另一处崩）。<br>⚠️ 计数口径校正：「23 次」这类数字**是上界**（含脚本同名本地对象，如 `FEIXUN_DB.characters`）—— **不要当影响面权重用**。 | **触发条件目前未成立**（设备 logcat 无 iframe 侧成员报错，已知报错**全在宿主帧**）⇒ **不阻塞发布**；<br>不升则 iframe 侧脚本静默少功能；只投影不补齐 ⇒ **倒退**。 |
| **P-1** | 更新开关要用**哪个 GitHub 仓库**（公开 or 私有？影响鉴权） | 需你定；**公开**最简单（无需 token） | 阶段三发布前必须定；代码已就绪，只差填地址 |

---

## 3. 与 TauriTavern 对齐的剩余差异（P1/P2）

> 基准 = TauriTavern-Canary（用户 2026-09-09 拍板）。差异全文见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md)。

| # | 差异 | 状态 | 下一步 |
|---|---|---|---|
| T-10 | D-3 role 映射（系统级内容走 system） | ✅ 主体已修 | 过渡态收敛（历史 user 席快照靠影子化逐轮折叠），观察即可 |
| T-11 | D-4 用户输入绝对位置 | ✅ **重评完成**（2026-09-11，心跳 45） | 结论维持「**有条件可达**」（非当前可达）：`dsh-llm-deepseek/lib/index.js:1849` 声明 `systemPromptUpdate:"in-history"`，`dsh-llm-pi-ai` **无**该能力；我方走 pi-ai → 默认不生效。解锁 = 独立任务（切 `llm-deepseek` 路由 + 显式声明 models），**不叠加在升级窗口** |
| ~~T-12~~ | ~~D-6 agent 层污染（32 tools / 24k 字说明书）~~ | ✅ **已落地**（2026-09-11 心跳 58，按拍板关掉） | 见 T-08 与 **T-59**（`system-prompt/assemble` 按「是否 RP 会话」修剪 tools + 对应 `tool:<name>` section；agent 三路径保留） |
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

#### ✅ 只读预检已完成（2026-09-11 心跳 59，**未动任何文件**）

- **新闸门 = T-61**（见下）：`rp-workspace/scripts/audit-publish-hygiene.mjs`
  —— 把「搜不到任何真实人名/卡名/服务器地址」从**不可复现的断言**变成**可复跑、带退出码的判据**。
- **报告**：`docs/T-25-PUBLISH-HYGIENE-2026-09-11.md`（全文掩码书写，自身 0 命中）。
- **扫描结果（受控面 609 个文本文件 / `git ls-files`）**：退出码 **1**（未达标），合计 **306 项**

  | 判据 | 命中 | 严重度 | 要点 |
  |---|---|---|---|
  | SECRET 真实 API 密钥 | **1** | 🔴 发布阻断 | 用户真实上游密钥被逐字记入 `DSH Android Roleplay App Plan.md:3809`（由某轮对话粘贴） |
  | WXID 个人微信 ID | 16 | 🟠 | 15 处在同一份 Plan 文档 + `golden-import.mjs:6` 硬编码路径 |
  | WORDLIST 真实卡名/人设名/预设名 | 200 | 🟠 | 集中在 `DSH Android Roleplay App Plan.md` / `docs/archive/*` / `.workbuddy/memory/*` |
  | PAYLOAD 抓包正文 | 8（≈1.29 MB） | 🟠 | `golden/dsht/*.json`、`golden/st/dump-00{2,4,6,8}*.json`（`golden/tt-sampling/` 已忽略，**同批却两种处置**） |
  | SERVER 外部服务器地址 | 11 | 🟡 | `api.comm***.ai`(5) / `api.silic***.com`(4) / **卡脚本托管域** `jnai2d9k***.com`(2，其一已嵌入产品源码注释 `host-vendor.ts:130`) |
  | LOCALPATH 本机绝对路径 | 70 | 🟡 | 24 个文件，主要为构建脚本的 JDK 路径与探针默认参数 |

- **曝光范围（决定紧迫度）**：`git remote -v` **为空** —— 117 个提交**从未推送**
  ⇒ 密钥**仅本地**，非对外事故；但**必须先清理、后推送**（否则远端历史永久留密）。
- **清理方案（分 P0–P3 四阶段，含风险与回滚）**见报告 §3；执行前仍需一次确认（数据冻结期内）。

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
     @ `〈该卡外链托管域〉/regex_bind/inject.js:55`（**宿主帧**，非 iframe；域名按 T-25 脱敏）。
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

### §6.5　✅ **ST 资产兼容族：T-42 / T-48 / T-63 统一实施**（2026-09-12 拍板全部彻底解决；**心跳 67–71 逐件落地并设备实测，族内全部完成**）

> **这一族为什么合在一起**：三件事同根 —— **卡把 DSHT 误当成 ST 前端**。
> 它们各自单独修都只是"换个坑"（T-56 的教训），必须**一起做**才算修好。

**共同判据（唯一验收口径）**：**一张真实卡的宿主注入脚本能在 DSHT 里完整跑完，零 `ReferenceError` / 零 `TypeError`**，
且卡的四段核心功能全部执行（`RegexBinding` / `ChatSquash` / `MacroNest` / `syncSPresetToolRegistrations`）。

| 件 | 内容 | 归属 |
|---|---|---|
| **① 版本与模块面** | `GET /version` ✅ 已有（T-56）· `GET /script.js` + `/scripts/{utils,preset-manager,openai}.js` | **T-63** |
| **② 正则面板与全局正则** | `#saved_regex_scripts` 锚点 ✅ 已有（T-56 ④）· `extension_settings.regex` ✅ 已有（T-60）· **面板 DOM 本体 + 我方正则引擎接线** | **T-42** |
| **③ 扩展模板渲染** | Handlebars + DOMPurify + `/scripts/extensions/**` 文件路由与存储 + 接线 | **T-48** |

**实施顺序（按依赖，不按编号）**：
1. **T-48 的 ③ 文件路由与存储** —— 它是 T-42/T-63 的公共基础设施（`/scripts/**` 同一注册面）。
2. **T-63** —— 版本/模块面，让卡走**新版分支**（否则后面全在旧版路径上打补丁）。
3. **T-42** —— 正则面板本体 + 引擎接线（**必须真接线**，不做"空容器"；见 T-42 的 C 方案禁令）。
4. **T-48 的 ④ 接线** —— 把退化实现换成真渲染（依赖 1 已就绪）。

**纪律（三条沿用，不得放宽）**：
- ❌ **不塞空壳**：给不存在的实现塞空壳 = 把「静默缺失」换成「错误地看起来能用」，**比不修更糟**。
- ❌ **不做半吊子**：只摆 DOM 容器而不接引擎（T-42 的 C 方案）= 造出新的静默失败。
- ❌ **不另写一份**：`sendOpenAIRequest` / 模板引擎 / 正则引擎都必须**复用我方既有实现**，
  不允许为了"让 import 成功"而另起一套（L61：同一语义多副本 = 假修）。

**与 NT 的对照（记录，但不作为"不修"的依据）**：开源项目 dsh-NextTavern（`github.com/a86582751/dsh-nexttavern`）
**明确不实现**这三件事（不跑卡注入脚本、无模板引擎、无 TH 兼容）。**我们不走这条路** ——
它的用户是"没有历史包袱的新用户"，我们的用户是"要把 ST 资产搬过来"。
⇒ 这三件是我们的**差异化承诺**，不是可以对齐掉的负担。

---

### T-42　✅ **卡的注入脚本已能完整跑完（含正则真接引擎）**　（曾标「当前前线」；**心跳 67 收口 + 设备端到端实测**）
- **心跳 67 结论（三条，均有设备实证）**：
  ① **「补面板 DOM 本体」是多余的** —— 卡在 `versionNumber >= 11305` 下 `renderPresetRegexes()` **直接 return**
    （`inject.js:4196-4198`），它**主动不往我方渲染**（L36「不能多」）。故面板 DOM 不需要我方伪造。
  ② **真缺口 = 卡写进 `extension_settings.regex` 的正则没进 node 侧引擎**（此前只停在 localStorage）
    ⇒ 已接：复用既有 `/dsht-rp/rp/regex/save-global` 落到 `rp/regex/global.json`，
    **防回流**（seed 引起的变更不触发写回，有单测钉住）。
  ③ **端到端实证**：卡式写回（改 `extensionSettings.regex` + `saveSettingsDebounced`）→ 宿主 `1→2` 条
    ⇒ node 侧文件 **27186→27574 B / md5 变更 / scripts 1→2**，落盘条目 **13 字段逐字完整** ⇒ 取证后精确还原。
- **共同验收判据（§6.5）已达成**：卡的 loader 逐字复刻执行 → `versionNumber=11800`、
  **两个 `module_imported` 容器都建立**、`SPresetImports` 八符号全拿到、**页内异常 0 条**。
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
- 🔴 **拍板（2026-09-12）**：**选 A，且必须彻底解决**（T-42 与 T-48 / T-63 同属一族，统一见 **§6.5**）。
  明确**不接受**「基准（TT）也不做 ⇒ 我们可以不修」这一理由 —— 我们的验收基准是「与 TT 一致」，
  但我们的**产品承诺**是「把 ST 资产搬过来还能跑」。已实测有真实卡（Kemini 系列）走这条路径，
  且该卡 bootstrap 会因此整段中断。判据 = **卡的宿主注入脚本能在 DSHT 里完整跑完**
  （`RegexBinding` / `ChatSquash` / `MacroNest` / `syncSPresetToolRegistrations` 四段全执行）。

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

### T-46　🔷 **iframe 门面窄于宿主门面 —— 「可行性分档」已完成，结论：原三分法不成立**（心跳 51 量出 · **心跳 63 分档收口**）

**量出的数（心跳 63 · 四口径实测**，工具 `rp-workspace/scripts/audit-iframe-surface-gap.mjs`，**纯只读**）：

| 口径 | 成员数 | 相对真 ST 的缺口 |
|---|---|---|
| ① 真 ST `st-context.js:getContext()` | **145** | —（权威面） |
| ② 宿主页 `host-vendor.ts:buildHostStContext()` | **39** | 112 |
| ③ iframe 顶层 `th-shim.ts:window.SillyTavern` | **22** | **125** |
| ④ iframe `th-shim.ts:buildStContextFacade()` | **11** | **140** |

**卡样本（`packages/tmp/recon-g/card.js`，19 个真 ST 成员）**：iframe **顶层缺 12** / **getContext 缺 15** / **宿主面 0 缺**。

> ⚠️ 这解释了为什么此前一直报「缺口 0」：`audit-card-context-surface.mjs` 用**并集**口径（宿主面 ∪ iframe 面），
> 宿主面全中即判无缺口 —— 对「卡到底在哪个帧取 ctx 尚未定性」是**保守正确**的，但它**遮住了 T-46 的真问题**。

#### 分档结论：原判据的「三档」逐档坍缩（**零风险静态工作，本轮已完成**）

**基准形态（第一取证源，非推断）**：真 TH `src/iframe/predefine.js:26-35` 逐字 ——

```js
Object.defineProperty(window, 'SillyTavern', {
  get: () => {
    const SillyTavern = _.get(window.parent, 'SillyTavern');   // ← 同源直取父页
    const getContext = () => ({ ...SillyTavern.getContext(), writeExtensionField: _th_impl.writeExtensionField });
    return { ...getContext(), getContext };                    // ← 顶层 ≡ 父页 getContext() 展开
  },
});
```

同文件还逐字做了：`window._ = window.parent._` · `$ / jQuery / toastr / z / Zod / YAML / EjsTemplate / TavernHelper / showdown` 的父子合并 · `TavernHelper._bind` 去下划线后 `bind(window)` 挂载 · `Mvu` 投影。
→ **我方 `buildIframeDocument` 只复刻了前半（全局合并，`th-shim.ts:2616+`）；后半（`SillyTavern` 投影）被改成了自建 —— 这就是 15 个缺口的根因。**

| 原判据分档 | 实测结论 | 依据 |
|---|---|---|
| 可经 postMessage 桥 | **空集** | 基准 `predefine.js` **0 处** postMessage —— 桥是**想象出来**的机制，引入即违反 **L36「不能多」** |
| **必须同步** | **不存在**（投影天然同步） | iframe 已放开 `sandbox allow-same-origin`（`RpScriptHost.tsx:482`）⇒ 同源 + getter 直取，同步语义自动成立 |
| 需要注入式装配 | **空集** | 一个 `Object.defineProperty` 就够了 |

⇒ **正确解法是「第四种」：父页投影**。先前认为的「再抄一份 / 注入式装配」二选一，是**被自造机制框住的假两难**（→ **LEARNINGS L96**）。

#### ⚠️ 投影不是零代价：会丢 10 个自建独有成员（**这是「是否升」的关键数据**）

投影后 iframe 顶层 = 「宿主面 + `getContext`」⇒ 自建有、宿主面没有的成员会**消失**：

`getContext`（基准顶层也有 ⇒ 不算丢）· `saveChat` · `registerMacro` · `unregisterMacro` · `getChatCompletionModel` · `getRequestHeaders` · `loadWorldInfo` · `getCharacterCardFields` · **`characters`** · **`characterId`**

⇒ **投影必须与「宿主面补齐这 9 个」配对，否则是倒退**。
而 `characters` / `characterId` 恰是 **T-47 的待决成员**，现状是**「iframe 面已有、宿主面全无」**（与 T-47 原文「宿主门面仍缺」互为镜像）
⇒ **T-46 与 T-47 是同一个决定的两半，不能分开拍板**（决策池已合并为一项）。

#### 设备侧实证（心跳 63 · 把分档的承重前提钉到真机）

分档此前**全是静态源码解析**。按项目纪律补了设备侧取证（全文 `stage3-device/hb63/T46-DEVICE-EVIDENCE.md`）：

| # | 断言 | 性质 | 实测读数 | 判 |
|---|---|---|---|---|
| A1 | 帧内可**同步**读到 `window.parent.SillyTavern`（同源 = 投影前提） | **运行期实测**<br>（沙箱串**逐字抄** `RpScriptHost.tsx:482` 造同属性 srcdoc 帧，帧内向 `parent` 取全局后 `postMessage` 回传） | `parentST='object'` · `parentGetContext='function'` · `getContext()` 返回 **39** 成员 · `substituteParams`/`t`/`getCurrentChatId` 在帧内**均为 `function`**（即"必须同步"那批**同源直取即可同步拿到**） | **PASS** |
| A2 | 宿主面成员数运行时 == 静态解析 | **运行期 × 静态 交叉** | 静态 **39** / 运行时 **39** / 帧内读 `parent` **39** —— 三方一致 | **PASS** |
| A3 | 设备**产物**里 iframe 面确实是"自建、零投影" | **产物级事实** | 设备 `client.js`（2,254,519 B，mtime 06:09 = 62B 构建，**新鲜**）：sandbox 串命中 **2** 处 · `parent.SillyTavern` 命中 **0** 处 | **PASS** |

**A1 的一个副产品**：那个测试帧里没有注入 shim，于是帧内 `ownST = "undefined"`
⇒ 证明「帧内 `SillyTavern` **不是浏览器自动继承的**，必须显式注入」——
`predefine.js` 的投影与我方的自建**都是在填这个空**（我方填法偏离了基准）。

**A3 的方法学**：要证明"某个帧的配置"，**不必真的把它跑起来** ——
机制烟雾测试（浏览器级语义）+ 产物 grep（字节级事实）两件加起来就闭合了，成本是 UI 触发路径的百分之一
（本项目 UI 自动化是已知时间黑洞）。⚠️ grep 串必须**逐字抄源码**，否则搜的是自己编的串。

**顺带复核的两条运行期读数**：① T-48 的降级告警**已在真实运行中出现**（logcat 可观测，62B 交付生效）；
② **iframe 侧成员缺失报错 = 0 条** ⇒ 本文档「触发条件目前未成立」这句断言**成立**（但缓冲会滚，
只能给"当前未观测到"，**不能给"不会发生"**）。

**仍未被覆盖**（不许读成"已具备"）：真实脚本帧的现场读数（iframe 顶层 22 / `getContext()` 11）
—— 需 live 会话触发 `RpScriptHost`，UI 触达成本高于边际价值；**影响有限**，因为这两个数是
**我方源码里的固定对象字面量**，A3 已证明设备产物与之同源。另外分档只跑了 `recon-g/card.js` **一个样本**。
#### 两个候选方案（供拍板）

| | 方案 A · 照抄基准（投影 + 宿主补齐） | 方案 B · 保持自建（顶层逐条转发） |
|---|---|---|
| 改动量 | iframe getter 体 ≈ **5 行** + 宿主面补 **9 个**成员（其中 2 个 = T-47 决策） | iframe 顶层 ≈ **22 条**逐成员转发，且**宿主面每新增一个都要再同步一次** |
| 与基准一致性 | **逐字同形**（L36 正面用法） | 形态不同（基准没有这种写法）；差异会**双向**出现 |
| 风险 | 需核对 9 个成员不丢；需保留 `reportMissing` 记名拒绝 + **身份稳定性记忆化** | 无行为回归风险；但**长期漂移**（两份实现，T-19/T-41 同型约束） |
| 一次性收益 | 宿主面将来补齐多少，iframe **自动跟随** | 无 |

**本轮已完成**（零风险静态工作）：四口径量化 · 分档 · 基准形态取证 · 自建独有清单 · 两方案规模对比 · **设备侧实证（A1/A2/A3 全 PASS）**。
**未做**：**不改源码** —— 「是否升」是拍板项，不是本轮能自决的。

**触发条件（仍有效）**：出现**卡脚本在 iframe 内**用这些成员（尤其 `ctx.eventSource` / `ctx.substituteParams`）的**实测报错**时优先升。
当前所有已知报错都在**宿主帧**（宿主面 0 缺），故不阻塞。

**顺带查出的一处不一致**：`renderExtensionTemplateAsync`（心跳 62B 交付）只落在 `buildStContextFacade()` 面（getContext 口径），**没落 iframe 顶层** —— 与基准形态（顶层 ≡ `...getContext()`）和宿主面都不一致。采纳方案 A 则自动消解；采纳方案 B 需一并补上。

**工具与纪律**：`rp-workspace/scripts/audit-iframe-surface-gap.mjs` **复用** `audit-card-context-surface.mjs` 的解析器（**不写第二份实现**）；为此给后者加了**导入守卫**（此前 `import` 即 `main()` + `process.exit` ⇒ 复用其解析器只能**复制一份实现** = 违反单源纪律）；加守卫后正控 `--selftest` **PASS**、反控 `--script` 输出与改动前**逐字相同**。

#### ⚠️ 心跳 63B 追加：全语料普查 ⇒ **「升不升」的代价被重新计价**

分档此前只跑了 **1 张卡**。按 skill §6「接新卡第一件事 = 跑穷举」把**设备上全部真实 TH 脚本**拉下来跑了一遍
（19 个文件 → **54 个脚本 / 6.5 MB**），过程与结果两件都要看：

1. **审计器自己有两个整类漏检**（先修，否则普查没有分辨力）：
   **A 顶层直取 `SillyTavern.x`**（不经 `getContext`；实例 `格式肘击大师v1_3.js:72-73`）·
   **B 间接 `X.SillyTavern.getContext()`**（实例 `对话渲染系统 v7.1:134-135`）。
   修后**已核验文件 9 → 13**（+44%）、缺口 **16 → 26**；闸门 = **4 正控 + 1 反控全 PASS**、
   原卡结论**逐字不变**。
2. **普查结果：宿主面缺口是 15 个成员，不是 T-47 登记的 3 个**（且只是下界）。
   ⇒ **投影（方案 A）不会自动补上这 15 个** —— 因为投影的上游就是宿主面本身。
   ⇒ 「投影 + 宿主补齐」的真实工作量**大于**此前按"3 个"估的规模；其中 6 个属**生成管线/斜杠命令体系**
   （`generate` / `generateRaw` / `generateQuietPrompt` / `stopGeneration` / `mainApi` /
   `executeSlashCommandsWithOptions`），是 **T-42/T-48 同型的「完整实现 = 无效功」候选**，不能笼统"补齐"。
   ⇒ 分档与四档处置见 **T-47**；证据全文 `stage3-device/hb63/T46-CORPUS-CENSUS.md`。

#### ⚠️ 心跳 63C 追加：审计器**第三次扩域** ⇒ 18 个成员 + 覆盖率 50/54

63B 把「不可判定 41 个」写成结论。63C 把它当**线索**，逐个回看原文 ⇒ 又三个整类漏检：

| 漏检 | 实证 | 判据 |
|---|---|---|
| **A 可选调用** `getContext?.()` | `酒馆思维链清洗.js:14` `const context = getST()?.getContext?.()`（该文件 6 处 getContext 一条都提不出来） | GT 夹不住 `?.`；别名绑定改**本行前缀回看** |
| **B 字符串下标** `globalThis["SillyTavern"]` | `傻瓜版导入脚本2_0.js:591` | 旧 GT 要求 `SillyTavern` 是**标识符** |
| **C 自定义转发方法** `this.getContext()` | `傻瓜版导入脚本2_0.js:587-596`（体内 `globalThis["SillyTavern"]`）；同文件 **6 处** `this.getContext()?.xxx` | **自证式**：无参 `getContext()` 方法**且其配平函数体内出现 `SillyTavern`** —— canvas 带参、体内也不可能有 ⇒ 新反控 `class Painter{getContext(){return this.el.getContext('2d')}}` 必须为空（PASS） |

**覆盖率口径从两态改三态**（`paths.size===0` 不再一律"不可判定"）：

```
已核验 18 · 已判定不取 ctx 32 · 不可判定 4     ⇒ 覆盖率 13/54 → 50/54
```

- 「**不取 ctx**」是**可判定**的（任何 ctx 取法必然提 `SillyTavern` 或 `getContext` 这两个名字之一）；
  典型 `_自动刷新楼层.js:66-75` 只用 `typeof SillyTavern !== 'undefined'` 做**宿主存在性探测**。
- 判据**不剥注释**（保守方向）；`canvas.getContext('2d')` 带实体参数 ⇒ 正确落「不取」。
- 剩 4 个真「不可判定」= 成员访问在**调用方**（`对话渲染系统_v7_1.js` 转发整个 ctx、`变量结构.js` 三元绑定）。

**新增「存在性守卫」维度**（决定"会崩"还是"静默降级"）：`getTokenCountAsync` 6 文件里 **5 个有 `typeof` 守卫**；
而 `characterId`/`characters`/`chatMetadata`/`onlineStatus`/`powerUserSettings`/`extensionPrompts` **零守卫 ⇒ 撞上就抛**。

**对「升不升」的净影响**：缺口 **15 → 18**（🆕 `extensionPrompts` / `getPresetManager` / `variables`），
但其中 **4 个生成栈成员有守卫 ⇒ 缺失只静默降级** ⇒ 「投影 + 宿主补齐」里**真正会崩的那批反而集中在 B 档**
（`characters`/`characterId`/`chatMetadata`/`onlineStatus`/`powerUserSettings`/`extensionPrompts`）。
⇒ **两个候选方案的成本对比不变，但优先级排序变了**：B 档 > C 档（此前 C 档被列为最重）。
证据全文 `stage3-device/hb63/T46-CORPUS-CENSUS-2.md`。

---
### T-47　🔴 **宿主门面缺口：是 18 个成员，不是 3 个**（心跳 51 量出 · 心跳 63B 首次普查 · **心跳 63C 二次扩域后定稿**）

**心跳 51 的原始登记（已作废）**：`characters`(4) / `characterId`(12) / `chatMetadata`(9)，
来源是 TH 扩展 `chat-history-backup/index.js`；理由写「当前无实测触发 —— DSHT 目前只跑 TH **脚本**，未跑扩展文件系统」。

> ⚠️ **上面这段的两处都被推翻了**（心跳 63B）：
> ① 缺的**不是 3 个**，是 **15 个**（且只是下界）；② 触发它的**不是扩展**，是 **DSHT 自己启用中的预设脚本**。

#### 全语料普查（设备实测拉取，非抽样）

```
find files/.dsh -name tavern-helper-scripts.json  →  19 个文件（12 角色卡 + 7 预设）
抽取 → 54 个脚本 / 6,664,607 B ≈ 6.5 MB / 启用 45 · 禁用 9
```

> **心跳 63C 二次扩域后的覆盖口径**（把"不可判定"再拆一刀）：
> `已核验 18 · 已判定不取 ctx 32 · 不可判定 4` ⇒ **覆盖率 50/54**（63B 是 13/54）。
> 三个整类漏检已修（可选调用 `getContext?.()` / 字符串下标 `globalThis["SillyTavern"]` /
> 同文件自定义转发方法 `this.getContext()`），详见 `stage3-device/hb63/T46-CORPUS-CENSUS-2.md`。

**宿主面缺口（18 个成员 · 按「启用中文件数」排序）**：

| # | 成员 | 文件 | 次数 | 启用中 | **typeof 守卫** | 判定提示 |
|---|---|---|---|---|---|---|
| 1 | `getTokenCountAsync` | 6 | **13** | 4 | **5/6** | C 档·生成栈；**大多有守卫 ⇒ 缺失只静默降级** |
| 2 | `onlineStatus` | 5 | 5 | 3 | **0/5** | ⚠️ **不是**"连接状态"（见下） |
| 3 | `powerUserSettings` | 4 | 6 | 3 | **0/4** | 子路径 `persona_description` **与** `reasoning` |
| 4 | 🆕 `extensionPrompts` | 4 | 4 | 2 | **0/4** | 与 `setExtensionPrompt` **成对** |
| 5 | `characterId` | 3 | **31** | 2 | **0/3** | B 档·须与 `characters` **成对** |
| 6 | `characters` | 3 | **23** | 2 | **0/3** | 同上 |
| 7 | `chatMetadata` | 2 | **13** | 2 | **0/2** | B 档·需定存储层 |
| 8 | `generateRaw` | 2 | 6 | 2 | **2/2** | C 档·全守卫 |
| 9 | `stopGeneration` | 2 | 2 | 2 | 0/2 | C 档 |
| 10 | `updateMessageBlock` | 2 | 2 | 2 | 0/2 | D 档·需 ST 消息 DOM |
| 11 | `generate` | 2 | 2 | 2 | 0/2 | C 档 |
| 12 | `executeSlashCommandsWithOptions` | 1 | 4 | 1 | **1/1** | C 档·全守卫 |
| 13 | `messageFormatting` | 1 | 3 | 1 | 0/1 | D 档·与 T-42 正则域相邻 |
| 14 | 🆕 `getPresetManager` | 1 | 2 | 1 | 0/1 | **函数**（`preset-manager.js`），子路径 `reasoning` |
| 15 | `generateQuietPrompt` | 1 | 2 | 1 | **1/1** | C 档·全守卫 |
| 16 | `saveChat` | 1 | 1 | 1 | 0/1 | 我方持久化自管 ⇒ **出声 no-op** |
| 17 | `mainApi` | 1 | 1 | 1 | 0/1 | C 档 |
| 18 | 🆕 `variables` | 1 | 1 | 1 | 0/1 | 真 ST **新变量系统**（`variables.js` 13 函数挂在其下） |

**🆕 心跳 63C 新增 3 个**（均经真 ST 权威面核对 `st-context.js:151 / :286 / :256`）。
**交叉验证：缺口不是禁用脚本制造的** —— 启用中 14 个已核验脚本里 **18 个成员全部有访问**，
剔掉 9 个禁用脚本后**一个不少**（工具 `stage3-device/hb63/aggregate-enabled.mjs`）。

**关键实例（*启用中*的脚本，不是边角料）**：`🦊示例卡二~` 在**主预设 V17.1 / Agent 预设 V14.7 各一份且 `enabled=true`**：

```
· characterId       （16 次）
· characters        （11 次）
· chatMetadata      （ 9 次）子路径：file_name, chat_id
· powerUserSettings （ 1 次，行 6115）
```

iframe 面在同一批语料上缺 **25** 个成员（`name1` 5 文件 · `callGenericPopup`/`POPUP_TYPE`/`POPUP_RESULT` 各 4 · …）。

#### 因此本项**不能笼统"补齐"**，须先分档（**心跳 63C 按新证据重排**）

| 档 | 成员 | 处置建议 |
|---|---|---|
| **A · 可低成本补**（**只剩 1 个**） | ✅ **`saveChat`（心跳 63D 已完成）** | 基准 `saveChat: saveChatConditional`（`script.js:9352`，**无参 async**）；我方持久化自管 ⇒ **出声 no-op + resolve** |
| **B · 需定语义**（**6 个**） | `characters` + `characterId`（**必须成对**：基准是「角色数组 + 数组下标」，我方是「一会话一角色、以 slug 标识」）· `chatMetadata`（基准是**会被持久化的每聊天元数据**，我方无此存储）· **`onlineStatus`**（**不是连接状态**，见下）· **`powerUserSettings`**（子路径 `persona_description` **与** `reasoning`；脚本还会**写** `reasoning.auto_parse/prefix/suffix` —— 若给只读/临时对象 = 写入静默消失）· **`extensionPrompts`**（与 `setExtensionPrompt` **成对**，单独给一个恒空 map 会让脚本的写入落空）· **`variables`**（真 ST **新变量系统**；我方已有 TH 变量体系 ⇒ 需定**映射**而非新建） | **需拍板语义归属**；⚠️ 拒绝"给空容器"——会让卡的写入**静默消失**（本项目主力缺陷族） |
| **C · 体系型（同 T-42/T-48 型）** | `generate` · `generateRaw` · `generateQuietPrompt` · `stopGeneration` · `mainApi` · `executeSlashCommandsWithOptions` · `getTokenCountAsync` · `getPresetManager` | 移植 = 移植 ST 生成栈 / 斜杠命令体系 / preset 体系 ⇒ **先按 T-48 的办法用只读探针问死"完整实现是否无效功"**，再决定；不自造迷你实现。<br>✅ **紧张度已下降**：其中 **4 个有 `typeof` 守卫**（`getTokenCountAsync` 5/6 · `generateRaw` 2/2 · `executeSlashCommandsWithOptions` 1/1 · `generateQuietPrompt` 1/1）⇒ 缺失只**静默降级**不抛<br>✅✅ **心跳 66 已"问死"（只读，零风险）—— 结论：C 档不构成决策**：<br>&nbsp;&nbsp;· **已实现（真桥）3 个**：`generate` / `generateRaw`（`th-shim.ts:1844` · `:3040-3042` → `/generate-raw`）· `mainApi`（`:1699`，T-75）；**心跳 63C 的普查表把它们记成"缺口"是口径差**（grep 两个包目录会把无关词计入）。<br>&nbsp;&nbsp;· **已出声 stub 1 个**：语料实际调的是 `stopGenerationById` / `stopAllGeneration`，二者已在 `UNSUPPORTED_APIS`（`:438-440`）。<br>&nbsp;&nbsp;· **判「不做」4 个**（全部有卡侧守卫）：`getTokenCountAsync`（卡注释自述"猜出来的比没有更糟"⇒ 补估算器 = 制造假精度）· `generateQuietPrompt` + `executeSlashCommandsWithOptions`（**同一处守卫链**，两者缺席则分支整体跳过；且只出现在 **`b7s7x3` 0605 旧卡副本**，**非活跃卡**）· `getPresetManager`（reasoning preset 体系，我方无消费者）。<br>📄 证据全文 `stage3-device/hb66/C-BUCKET-WENSI.md` |
| **D · 相邻域** | `updateMessageBlock`（✅ **心跳 66 已实现 = T-77**）· `messageFormatting`（仍待评） | 与 T-42（正则/DOM）/ 显示管线相邻；**T-42 已于心跳 58 收口 ⇒ D 档不再"随该域一起评"，可独立判定**。<br>✅ **`updateMessageBlock`（心跳 66）**：基准 `script.js:2587` 是**同步 · 返回 undefined · 纯 DOM 重渲染**且**未找到元素即 early-return**；我方脚本帧内**恒无聊天 DOM** ⇒ **永久命中该早退分支** ⇒ **忠实实现 = 照抄那个分支**（不提供 ⇒ 卡侧 TypeError，基准绝不会发生；造替代 ⇒ 违反 L36）。两处调用**此前无 `typeof` 守卫**。见 **T-77**、经验 **L123**。<br>⏳ **`messageFormatting`**（1 文件 3 次）：返回 HTML 字符串，用在卡自己的总结层弹窗渲染；我方已有正则/格式化管线与 `formatAsTavernRegexedString` 桥 ⇒ **需单独问死「复用管线是否等价」**，不与上一项同批做 |

#### ⚠️ 心跳 63C 纠一处**档位误判**：`onlineStatus` **不是**"连接状态"

63B 把它记为「可能是单字段（连接状态字符串）低成本项」。**回基准源码后这个判断是错的**：

```js
// script.js:600        —— 声明与初值
export let online_status = 'no_connection';
// script.js:7093-7097  —— 全仓唯一写入点
const previousStatus = online_status;
online_status = value;
… eventSource.emitAndWait(event_types.ONLINE_STATUS_CHANGED, online_status);
// script.js:6995 / 7004 → model = online_status;
// chat-templates.js:189 → if (!online_status.startsWith('koboldcpp/ggml-model-'))
```

⇒ 它的真实语义 = **当前 AI 后端的"在线标识" / 模型名**（值域含 `'no_connection'` 与 `'koboldcpp/ggml-model-…'` 这类），
**不是** `'online'` / `'offline'`。**编一个 `'online'` 就是制造假信息** ⇒ 移入 **B 档**。

同理 `powerUserSettings` 也从 A 档移入 B 档（只读字段能补，**可写语义不能**：`酒馆思维链清洗.js:15-19`
会写 `reasoning.auto_parse/prefix/suffix`，而"写进去谁读"在我方**没有消费者**）。

**状态**：⏳ **登记 + 分档已出**；**A 档已于心跳 63D 完成**（`saveChat` 宿主面镜像 —— 宿主门面 **39 → 40** 成员，
语料缺口 **18 → 17**）· **B 档 6 个 / C 档 8 个 / D 档 2 个** —— **等 T-46 的投影决策一并拍板**（宿主门面是 iframe 投影的**数据源**，补齐两者是同一件事的两半；A 档已完成正是因为它**在"投影"与"不投影"两条路线下都是净收益**）。
**✅ 心跳 63C 续：7 个成员的基准取证已完成**（见上方新节）⇒ 结论从"需定语义"细化成
**1 个可直接做 · 1 个应判「不补」· 4 个语义已定待实施 · 1 组必须成对建模型**；
顺带校正计数口径（「23 次」是上界，含同名本地对象）。
**决策池保持 2 项**（T-46+T-47 合并 · P-1）。

#### 🆕 心跳 63C 续：**七个成员的基准取证**（只读，零风险 —— 把"需定语义"变成"已定位"）

方法照 L101 的三处齐：**① 权威面绑定行**（`SillyTavern-reference/public/scripts/st-context.js`）
→ **② 基准声明 / 初值**（`script.js`）→ **③ 我们语料里的真实用法**。三处齐了才写"已定"。

| 成员 | 权威面绑定 | 基准声明 / 初值 | 我们语料里的真实用法 | 结论 |
|---|---|---|---|---|
| `saveChat`（A 档） | `st-context.js:154  saveChat: saveChatConditional` | `script.js:10666  export async function saveChatConditional(commitReason = CHAT_COMMIT_REASON.MUTATION)` —— **无必填参 · async · 真的落盘** | `梦鲸思客消息处理 2.4` 调用 1 次 | ✅ **语义已定，可直接做**：DSHT 会话由核心持续落盘 ⇒ 正确语义 = **resolve 且无需额外动作**。`th-shim.ts:2347` **已经是这个实现**（`saveChat: function () { return Promise.resolve(); }`，注释"宿主自管"）⇒ **只缺宿主面那一份**（镜像即可，L36） |
| `characters` | `st-context.js:118  characters,` | `script.js:426  export let characters = []` | `ctx.characters[ctx.characterId]`（示例卡二预设，**成对使用**；一处带 `ctx.characters &&` 守卫、416 行后的另一处**没有**） | ⚠️ **形态已定，内容未定**：ST 语义 = 「角色对象数组，**按下标 `characterId` 取**」。要补就得建**真实卡片列表模型**（ST 角色对象字段很多）；**给空数组 = `characters[i]` 恒 `undefined` ⇒ 下游 `.name` 照样抛** —— 等于把一处崩换成另一处崩 |
| `characterId` | `st-context.js:122  characterId: this_chid,` | `script.js:431  export let this_chid;`（**无初值**） | 同上，**只作 `characters[]` 的下标** | ⚠️ **必须与 `characters` 同批落地**（T-47 原文即如此）：单独给 `characterId` 反而制造 `characters[undefined]` 的**静默取错** |
| `chatMetadata` | `st-context.js:134  chatMetadata: chat_metadata,` | `script.js:453  export let chat_metadata = {}`（随聊天重置） | 只读两个子路径：`chatMetadata.file_name`(3) · `chatMetadata.chat_id`(3) | 🔴 **应判定为「不补」（重要负面发现）**：`file_name` / `chat_id` **在基准里根本不是 `chat_metadata` 的属性** —— 全树只有 `chat_metadata.chat_id_hash`（`macros.js:316/323`），`file_name` 只出现在**备份 UI**（`chat-backups.js:175-203`）与 `chats.js:376` 的 DOM 表单上。⇒ 卡脚本在**真 ST 里读到的也是 `undefined`**，走的是同一个「未命中」分支 ⇒ **补一个 `{file_name, chat_id}` 空壳 = 补出基准没有的东西（违反 L36），零收益** |
| `onlineStatus` | `st-context.js:132  onlineStatus: online_status,` | `script.js:600  export let online_status = 'no_connection'` | 1 文件 1 次 | ⚠️ 语义已定（**AI 后端在线标识 / 模型名**，见上文 63C 纠错），但**值必须真实可得**（当前模型 id），**不能编 `'online'`** |
| `powerUserSettings` | `st-context.js:228  powerUserSettings: power_user,` | 真 ST 的 `power_user`（全量设置对象） | 只读 `persona_description`；另有 `酒馆思维链清洗.js:15-19` **写** `reasoning.*` | ⚠️ **可读不可写**：写侧在我方**无消费者** ⇒ 补一个可写对象 = **写入静默消失**（主力缺陷族）⇒ 正确处置是**出声降级**，不是给空容器 |
| `extensionPrompts` | `st-context.js:151  extensionPrompts: extension_prompts,` | `script.js:625  export let extension_prompts = {}`（**由扩展注册填充**；`script.js:1588` 每次重置） | 4 文件 4 次 | ⚠️ 语义已定但**归属未定**：其内容**全部来自扩展**，而 DSHT **没有扩展运行环境**（T-48 已判）⇒ "为空"是**诚实**的；但 `{}` 与 `[]` 都会让下游 `.find(...).content` 抛 ⇒ 必须与"扩展面恒为空"这个既定事实**一并**说明 |

#### ⚠️ 顺带校正一处**计数口径**（诚实标注，**不推翻**结论）

`characters` 报的是「3 文件 / 23 次」，但抽查发现**其中一部分不是 ctx 上的 `characters`** ——
例如 `飞讯_0703.js:560/639` 用的是脚本**自己的** `FEIXUN_DB.characters[k]`（本地 map）。
⇒ **「23 次」这类计数是上界，不是精确次数**；成员**确实缺失**这一点不变（示例卡二预设的
`ctx.characters[ctx.characterId]` 是逐字实证），但**不要把次数当影响面权重**。
（这是"解析器按名字匹配、无法区分同名不同宿主"的**已知能力边界**，与 L99 的三态口径同族。）

**本节的净收益**：把一个含糊的"需定语义"档位，变成**可执行清单** ——
**1 个可直接做**（`saveChat`，宿主面镜像）· **1 个应判「不补」**（`chatMetadata.file_name/chat_id`）·
**4 个语义已定待实施**（`onlineStatus` / `powerUserSettings` / `extensionPrompts` / 生成栈）·
**1 组必须成对建模型**（`characters` + `characterId`）。

**证据全文**：`stage3-device/hb63/T46-CORPUS-CENSUS.md`（63B）· `stage3-device/hb63/T46-CORPUS-CENSUS-2.md`（**63C，含 18 成员表 + 守卫列 + 覆盖率三态**）

#### 🆕 心跳 66：**C 档「问死」执行完毕**（只读 · 零风险 · **不依赖 T-46 决策**）

> 依据 = T-47 C 档原文那句「**先按 T-48 的办法用只读探针问死"完整实现是否无效功"**」。
> 证据全文 `stage3-device/hb66/C-BUCKET-WENSI.md`。**未改动任何产品源码。**

**结论：C 档对决策的贡献 = 0**（8 个成员里 **3 已实现 · 1 已出声 stub · 4 判不做**）：

| 成员 | 现状（`文件:行号`） | 判定 |
|---|---|---|
| `generate` | `th-shim.ts:2275`（→ `/dsht-rp/llm/classify`，注释标 C9） | ✅ **已实现** |
| `generateRaw` | `th-shim.ts:1844` 定义 · `:3040-3042` 宿主装配 | ✅ **已实现** |
| `mainApi` | `th-shim.ts:1699`（值单源 `DSHT_MAIN_API`）· `host-vendor.ts:539` | ✅ **已实现**（T-75 已实机验收） |
| `stopGeneration` | 语料实际调 `stopGenerationById` / `stopAllGeneration`，二者在 `UNSUPPORTED_APIS`（`th-shim.ts:438-440`） | ✅ **已出声 stub** |
| `getTokenCountAsync` | 无 | ❌ **不做**：卡自己注释写「猜出来的比没有更糟 / 不该显示 fabricated figure」⇒ 补估算器 = **制造假精度** |
| `generateQuietPrompt` | 无 | ❌ **不做**：与 `generateRaw` **语义不等价**（需复刻"当前预设 → ordered_prompts"装配 = 移植体系）；且只在 **`b7s7x3` 0605 旧卡副本**（**非活跃卡**） |
| `executeSlashCommandsWithOptions` | 无 | ❌ **不做**：与上一项**同一处守卫链**（`飞讯_0525.js:990-996`），两者缺席 ⇒ 分支整体跳过、`aiResponse=""`，**非崩溃路径** |
| `getPresetManager` | 无 | ❌ **不做**：`('reasoning')` 属真 ST `preset-manager.js` 体系，我方无消费者 |

**口径修正（重要，防止将来误补）**：
- 🔴 **心跳 63C 表把 `generate` / `generateRaw` / `mainApi` 记成"缺口"** —— 实际早有真实现。
  原因：`grep` 遍历 `dsht-plugin-shared/` + `dsht-rp-ui/src/` 会把**无关词**计入（`generate` 命中的多是普通词）。
  **正确判据 = `th-shim.ts` 里 `Object.defineProperty(window,'SillyTavern')` 返回体（`:2417-2481`）的键。**
- 普查器漏检一种守卫写法：`'function' == typeof e.getPresetManager`（**字符串在左**）⇒ `getPresetManager` 的
  「守卫 0/1」应更正为**有守卫**。下次扩域须同时收 `'function'==typeof X` / `typeof X === 'function'` / `!== 'function'` 三形态。

**🔴 同轮副产物（比 C 档本身更值钱）—— 两处长期靠推断的结论被代码实证：**
1. **`window.parent.SillyTavern.getContext()` 是卡的真实可达路径。** `梦鲸思客预设助手_1_7.js` 的
   `L()` 逐字写了这条回退链（`SillyTavern` 直取 → `parent.SillyTavern.getContext()`）。⇒
   **T-46「父页投影」没有机制障碍**；且**证明宿主面（40 成员）确实是"卡会读到的面"** ⇒ 63B/63C 缺口普查口径无误。
2. 🔴 **帧面已存在 `characters: []` / `characterId: -1` 空占位，而宿主面反而"缺"这两个成员**
   （`th-shim.ts:2480`）⇒ 这正是 T-47 明文拒绝的形态，**却已经在帧面落地**。语料里示例卡二主预设
   `ctx.characters[ctx.characterId]` 有一处**无守卫** ⇒ `[][-1]` → `undefined` → `.name` → **TypeError**。
   **本轮不改行为**（"要不要给真实卡片模型"正是 T-47 B 档待决项，擅动 = 替用户拍板），
   但**口径从"缺失"改为「空占位（已存在）」** —— 否则将来按"缺口"去补，会**叠成两层空容器**。
### T-48　✅ **`renderExtensionTemplateAsync` 已真渲染**（心跳 62 判「不做」；**2026-09-12 拍板推翻 → 心跳 67 落地并设备实测**）

**契约（逐字对质基准）**：
`renderExtensionTemplateAsync(ext, id, data, sanitize, localize)`
= `renderTemplateAsync('scripts/extensions/' + ext + '/' + id + '.html', data, sanitize, localize, true)`
（`SillyTavern-reference/public/scripts/extensions.js:137`）。而 `renderTemplateAsync`
（`templates.js:60`）的链条是：**XHR 取文件 → Handlebars 编译（按路径缓存）→ 渲染 → DOMPurify 消毒 → applyLocale**；
任何一步失败走它自己的 `catch`：`console.error('Error rendering template', …)`
+ `toastr.error('Check the DevTools console for more information.', 'Error rendering template')`
+ **返回 `undefined`**（⚠️ 基准**不 reject** —— 返回形状必须照抄，不能自作主张改成 reject）。

**设备实测的缺口（心跳 62 探针，`stage3-device/hb62/hb62-t48-probe.js`，只读）**：

| 判据 | 修复前实测 |
|---|---|
| 宿主门面成员数 | **37**；`typeof ctx.renderExtensionTemplateAsync === 'undefined'`（**连 stub 都没有**） |
| 同族 | `renderTemplateAsync` / `renderTemplate` / `applyLocale` **全 undefined** |
| 引擎依赖 | `typeof window.Handlebars = 'undefined'`；`typeof window.DOMPurify = 'undefined'`（全仓亦无） |
| 文件路由 | `/script.js` **404** · `/scripts/templates/x.html` **404** · `/scripts/extensions/regex/editor.html` **404** · `/api/extensions` **404**（`/version` 200） |
| 扩展文件存储 | 设备上**无** `third-party` 扩展目录、**无** `chat-history-backup`（那份只在 **TT** 的 `tmp/tt-data/…` 里，属对照源，不在 DSHT 运行） |

**结论：完整实现 = 必须做**（🔴 2026-09-12 拍板**推翻**心跳 62 的"不做"判定）。理由重述：心跳 62 的三条
理由（依赖三件缺一渲染不出来 / 不自造迷你模板引擎 / 两个消费者都不在）**都是"现状描述"，不是"可以不做"的
论据**。我们的产品承诺是「ST 资产搬过来还能跑」，卡明确调用了这个 API 且**它决定 ST 正则面板内容能否渲染**
⇒ 属 Tier 1 缺陷，不是长尾。依赖三件（Handlebars / DOMPurify / `/scripts/extensions/**` 文件路由与存储）
**本就必须一起建**，不能因为"要建三件"就降级为不修。

**实施方案（三件一起上，缺一则不算修好；与 T-42 合为一族，见 §6.5）**：
| # | 件 | 做法 | 反控 |
|---|---|---|---|
| ① | **模板引擎** | 引入 **Handlebars**（与基准同款，含 `{{#if}}`/`{{#each}}`/helper/转义），**不自造** | 用基准 `templates.js` 的语义用例对照；HTML 转义 / `{{{ }}}` 三花括号 / helper 各 1 例 |
| ② | **消毒** | **DOMPurify**（与基准同款），失败路径照抄基准 | 含 `<script>`/`on*` 的模板 → 消毒后不含 |
| ③ | **文件路由 + 存储** | `GET /scripts/extensions/<ext>/<id>.html` 读我方扩展目录（含 `third-party/`）；缺文件 → 走基准同形错误路径 | 存在→200 且内容逐字等于磁盘文件；不存在→基准同形（`console.error` + `toastr.error` + 返回 `undefined`，**不 reject**） |
| ④ | **接线** | 把心跳 62 的**退化实现**（返回 `undefined` + 记名）换成真渲染；`renderTemplate`/`renderTemplateAsync`/`applyLocale` 同族一起补 | 反控：拿掉 Handlebars → 该组用例必须转红 |

**判据（可复跑）**：`await ctx.renderExtensionTemplateAsync('regex','editor')` 返回**真 HTML 串**（非 `undefined`）；
且 `chat-history-backup` 的 `('third-party/chat-history-backup','settings')` 同判。设备实测两例。

**本轮实际交付（把"未移植"变成"已移植但环境不支持"）**：

修复前卡脚本拿到的是 `TypeError: ctx.renderExtensionTemplateAsync is not a function` ——
这是**未移植**；而"有 API 但环境不支持"是另一回事。两者在排查上完全不同（同族 L42：有意降级也必须出声）。
故补上**与基准同一条错误路径**的退化实现：

| 落点 | 位置 | 说明 |
|---|---|---|
| **宿主门面**（卡走的就是这个） | `host-vendor.ts:buildHostStContext` 的 `renderExtensionTemplateAsync` / `renderExtensionTemplate` | 记名 + `console.error`（带 `scripts/extensions/<ext>/<id>.html` 路径）+ `toastr.error` + 返回 `undefined`（async 版 `Promise.resolve(undefined)`） |
| **iframe 门面**（同语义必须同步 —— T-19 硬约束） | `th-shim.ts:buildStContextFacade` 内的 `dshtRenderExtensionTemplateFailure` | 同上（该文件主体是**构建期模板串**，无法共享模块；两侧用**镜像测试**钉住同一组可观测行为） |

**验收**：
- `typecheck` 三段式 **0 错** · 全量单测 **54 文件 / 1149 全绿**（+8：宿主侧 4 + iframe 侧 4，含 1 条反控）
- **反控**：把成员从门面拿掉 → 卡脚本重新拿到 `is not a function`（用例真跑，证明这条在承重）
- **实机（`emulator-5554`，装 v280 后 CDP 读宿主帧真实门面）**：
  `facadeMembers` 由 **37 → 39** · `typeof renderExtensionTemplateAsync = 'function'` ·
  `await ctx.renderExtensionTemplateAsync('regex','editor')` → thenable → `'undefined'` ·
  同步版返回 `'undefined'` · `console.error` 两行，**逐字含 `scripts/extensions/regex/editor.html`**
- 双架构 APK `x86_64 debug **v280**（196,847,509 B）` / `arm64 release **v281**（128,373,732 B）`；
  `check-apk-payload.py` 双架构均命中（`client.js × 7`）
- 设备两侧副本一致（`dsh-runtime/…` 与 `.dsh/profiles/web/…` 各 ×7）⇒ 无第 ⑦ 类断链

⚠️ **诚实边界**：本轮交付的是**接口形状**，不是"用户会看到新功能"。
触发可达性仍取决于卡的 UI 入口是否渲染（另见 T-42/T-60 的锚点设计）；若入口可达，
点击失败会从"毫无反应、零线索"变成"弹出 Error rendering template + 日志具名记录"。
一旦将来要**真渲染**，前置条件是三件一起上（Handlebars + DOMPurify + `/scripts/extensions/**` 文件路由与存储）。

---

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

### T-53　✅ **存量「脏楼层」清洗**（= D-5b）—— **按拍板选 B：不清洗，本项关闭**（2026-09-11 心跳 58）
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
- **拍板结果（2026-09-11 心跳 58）**：**选 B —— 不清洗，本项关闭**。理由：
  ① 只影响旧会话观感，**与新版行为无关**（修复已生效，23.3h 零新增）；
  ② 清洗属**不可逆写入**（须写带 `.bak` + 幂等 + 收敛断言的迁移器），收益不成比例。
  → 旧会话正文保留可见残留，**零成本、零风险**。若日后你改了主意，上面的只读报告与
  分档口径（`--selftest 6/6`）可直接复用为迁移方案的基础。
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

### T-57　🟠→✅ **`sessionController` 不可用**：机制查清（**不是我方缺陷**）+ 顺手修掉两处**我方静默降级**（心跳 59）

**心跳 57 现象**：应用运行 30+ 分钟后 `session/list` → `service-unavailable`，重启即恢复。

**心跳 59 定性（逐层查到达成机制，含官方源码 file:line）**：
| 层 | 事实 | 证据 |
|---|---|---|
| 报错构造点 | `TypertGatewayError('gateway/service-unavailable', …)` | `dsh-api-gateway/lib/index.js:743` |
| **判定条件** | `receiver = ctx.get(服务名)`；取不到（或非对象）即抛 | 同上 `:743` |
| 取不到的原因 | cordis `_getImpl`：作用域无实现 **或 `impl.fiber.state !== ACTIVE`** | `cordis/src/reflect.ts:237-243` |
| 谁的生命周期 | `SessionController` 由 cordis **fiber** 承载，`inject` 了 **10 个**服务（`agents`/`sessions`/`sessionQuery`/`workspaceRegistry`/`typert`/…） | `dsh-api-session-controller/lib/index.js:2698-2709` |
| **为什么会不可用** | 那 10 个 inject 中**任一**被重载/短暂不可用 → fiber `_unload()` 离开 ACTIVE | `cordis/src/fiber.ts:625-639` |
| **能否自愈** | **能** —— 依赖重新提供时框架自动 `_reload()`；**除非** fiber 已 DISPOSED（那只能重启） | `cordis/src/fiber.ts:688-695`（自愈）/ `:267-268`（DISPOSED 不可逆） |

⇒ **结论**：这是**宿主框架的服务生命周期行为**（非我方代码缺陷），且**属「稍等自愈」类**。
与验收基准（TT）无关 —— 不在差异清单内，也不该由我方向官方提「改源码」。

**我方确实有两处真缺陷（本轮已修）**：
1. 🔴 **`dshRpc` 丢弃 `error.code`**（[rpc.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/rpc.ts#L36-L48)）
   —— gateway 把业务失败包进 **HTTP 200**（`!resp.ok` 分支永不触发），原实现只取 `error.message`
   → 调用方**无从区分**「服务暂不可用（等一下就好）」与「会话不存在（重试无用）」。
   ✅ 修：新增 `DshRpcError extends Error`（带 `code`/`method`）+ `isServiceUnavailable()` 判别；
   `extends Error` ⇒ 既有 `(e as Error).message` 调用点**零改动**仍工作。
2. 🔴 **`fetchRpSessionMap` 把失败空 Map 永久钉住**（[RpNativeChat.tsx:1631-1642](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpNativeChat.tsx#L1631-L1642)）
   —— `rpSessionCache` 模块级、非 null 不重取 → **一次瞬时失败 = 该会话周期内
   `isRp` 恒 false → 「↻ 重新生成」按钮永不显示**，且用户看不到任何报错（L42 家族：静默降级）。
   ✅ 修：失败时回清 `null`（允许下次重取）+ 对 `service-unavailable` **自动短延迟重试一次**
   + `console.warn` 出声（不再静默）。
3. 顺带：RP Overlay 两处 catch 对可自愈错误给**可操作中文提示**（原先把英文诊断原样糊到用户脸上）。

**验收**：`typecheck` 三段式 0 错 · 单测 **53 文件 / 1103 全绿**（+25，含新 `rpc-error.spec.ts` 8 条）·
**反控**：还原旧 `dshRpc`（丢 code）→ 3 条立刻转红。
**实机验证**（同设备，热推 client bundle 后）：真实业务错误信封 `http:200 / ok:false / hasCode:true /
code:"gateway/arguments-invalid"` → `isServiceUnavailable 判别 = false`（**正确区分**，未把不可自愈的当可重试）。
**复测**：应用运行 14min / reload 后 / **45m54s** 三轮均 `ok:true, itemCount=81` —— **长时运行不复现**。

**📌 触发窗口已由并发实例（心跳 60）抓到（本条与上表互补，不冲突）**：
| 观测 | 结果 |
|---|---|
| 装包**前**（app 已跑 **69 分钟**） | `session.list` → `200 ok / 81` ⇒ **确证「长时运行不失效」** |
| 装包**后** +2m33s / +2m43s / +2m55s | **三次采样均 `gateway/service-unavailable`** |
| 装包后 **+3m07s** 起 | **自动恢复** |
| 出错时的页面状态 | `readyState=complete`、宿主门面已 37 成员 ⇒ **「页面看着已就绪、宿主服务还没注册」** |

⇒ **定性收敛为「启动/重载竞态窗口」**（不是长时退化）；与本文上面查到的机制一致：
装包触发依赖服务重载 → `SessionController` 的 fiber 短暂离开 ACTIVE → 窗口内 `ctx.get` 空
→ 依赖恢复后框架自动 `_reload()` → **+3m07s 自愈**。
**关键佐证（零副作用 ⇒ 重试安全）**：`dsh-api-gateway/lib/index.js:747-748` 证明该错
**在被调方法之前抛出**（方法体从未执行）⇒ 我方「短延迟重试一次」的修法**不会造成重复副作用**。
**沉淀**：LEARNINGS **L80**。

---

### T-58　🟠→✅ **「非 live 分支是破坏性截断」的描述经审计不成立；真缺口 = 判据 6 份复制且只有 1 份有测试**（心跳 58 收口）

**心跳 57 的原描述**：对**未挂载**的会话 `st-1w8aglg` 打 `/dsht-rp/rp/session-regenerate` →
`200 {"truncated":1,…}` → 该会话 `session.jsonl` 被截断重写，
⇒ 结论「同一端点语义从『逻辑回退』变成『物理截断』，判据只有会话是否挂载」，
并建议「加显式门槛（未声明 `allowFileTruncation:true` 即拒收）」。

🔴 **心跳 58 逐行核对源码后：该描述**与代码相反** —— 门槛**本来就有**，而且是 409 硬拒收：
| 动作 | 位置 | 守卫 |
|---|---|---|
| rollback | `dsh-plugin/index.ts:5375` | `ctx.sessions?.get(id) !== undefined` → **409** |
| edit | `:5416` | 同上 → **409** |
| regenerate | `:5553` | 同上 → **409** |

即：**已 attach 的会话（live）才是被拒的那个**；`st-1w8aglg` 之所以被截断，
正是因为**它当时没打开**（非 live）—— 那恰恰是这条路径的**设计语义**
（会话关着 = 内存态不存在 = 落盘文件是唯一权威 = 允许原地截断 + `.bak`）。
心跳 57 把「设计语义」误读成了「缺少门槛」。

**但审计确实挖出一个真缺口（本次已修）**：
1. 🔴 **同一判据 6 份逐字复制**：RP 侧 3 处 + `dsht-plugin-undo/index.ts` 3 处，
   文案逐字相同（`session live（内存态权威）：先在 DSH 里关闭该会话再{回退|编辑|重新生成}`）。
2. 🔴 **单测只覆盖 undo 那一份**（`undo.spec.ts:135/183`）；RP 侧三处**零覆盖** ——
   **这正是心跳 57 误判的土壤**：没有测试与单源把这条不变量钉住，读代码时容易把
   「live 被拒」看成「非 live 能改盘」的漏洞（L61 同族：同一语义多副本）。
- ✅ **修法（收敛为单源纯函数）**：`dsht-plugin-shared/session-surgery.ts` 新增
  `canSurgicallyTruncate(isLive, action)`，两侧 6 处调用点全部改为调它；
  文案用 `ACTION_LABEL` 保持**逐字不变**（用户可见文案不漂移）。
- ✅ **回归 4 条 + 反控**：非 live→允许 / live→拒绝且文案逐字 /
  **三动作文案互不相同**（防「统一成一个」丢动作信息）/ 两态结论必相反；
  **反控**：把判据改成恒放行 → **3 条立刻转红**。
- **不改行为，只收敛 + 补测**（原 409 行为经逐行核对是正确的，与 `dsht-plugin-undo` 一致）。
- **沉淀**：**L79**（「看起来缺门槛」有两种可能：真缺 / 有门槛但没被钉住 —— 先逐行核对再动手）。

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
- ✅ **实机验证通过**（2026-09-11 心跳 58，`emulator-5554`；热推 `dsht-rp-plugin` 双副本 + 重启）：
  | 判据 | 实测证据 |
  |---|---|
  | 修剪确实发生 | logcat `[dsht-rp] D-6 工具修剪：移除 32 个工具定义（对齐 TT 无 tools 字段；path=direct）` |
  | **请求体真的没有 tools** | 新 dump `rp/golden/dsht/llm-224.json` → `keys = model, messages, stream, stream_options, max_tokens, temperature, thinking`，**`tools` 键不存在**（发送前 seq=223 → 发送后 224，确为本次请求） |
  | 与基准一致 | 修复前抓包口径 32 个 → 现在 **0 个**（基线 TT 亦无该字段） |

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
- ✅ **实机验证通过**（2026-09-11 心跳 58，`emulator-5554`；热推 `dsht-rp-plugin` 双副本 + 重启）：
  | 判据 | 实测证据（CDP 探针读**宿主帧**真实 globals） |
  |---|---|
  | **卡的那行不再抛** | `extensions.regex.length` = **1**（修复前该变量是 `undefined`） |
  | 键的形状对 | `Array.isArray(regex) = true`；`regex_presets` 亦为数组 |
  | **是真数据不是空壳** | 首元素 = `{id: 'bf2c3652-…', scriptName: '花里胡哨状态栏美化衣服 适配手机版…', findRegex: '<StatusPlaceHolderImpl/>'}` —— 与 `rp/regex/global.json` 的全局正则一致；字段为 ST camelCase 13 键全集 |
  | 引用稳定 | `getContext().extensionSettings === getContext().extension_settings` = true |
  | **反控（同一台设备上跑）** | 无 `regex` 键的对象 → `THROW: Cannot read properties of undefined (reading 'length')`（**与卡原报错逐字同形**）；有键 → `OK 未抛`；跑完真实对象未被改动（`length` 仍为 1） |
  | 卡 bootstrap 的失败点 | 复刻 `updateSTRegexes` 的读写序列 → `OK 未抛（修复前此处必抛 TypeError）` |

---

### T-61　🆕 **发布卫生闸门：把 T-25 的「搜不到敏感信息」变成可复跑判据**（2026-09-11 心跳 59）

- **动机（T-24 同族教训）**：T-25 的完成标志是「仓库内搜不到任何真实人名/卡名/服务器地址」——
  这是**不可复现的断言**：下次有人改文档、加抓包文件，没有任何东西会拦住他。
- **工具**：`rp-workspace/scripts/audit-publish-hygiene.mjs`（六类判据 + `--selftest` + `--json` + `--verbose`）
  - **扫描口径**：只扫 `git ls-files`（**真正会被发布出去的发布面**，609 个文本文件），
    不扫工作区（`backup/` / `tmp/` / `stage3-device/` 等 4 万+ 已忽略文件）——忽略目录不进仓库即无发布风险。
  - **六类**：`SECRET` / `WXID` / `LOCALPATH` / `SERVER` / `PAYLOAD` / `WORDLIST`(自定义词表)。
  - **词表外置**：`scripts/publish-hygiene-words.txt`（**已 gitignore**）。
    理由 = **自指悖论**：若把真实卡名/人设名硬编码进脚本，扫描器自身就成了泄露源。
  - **掩码输出**：报告只给「首字 + ＊」或「前缀 + `***` + 后缀」，且 CJK 词只留**首字**
    （中文词仅 2~4 字，留首尾等于泄露一半）——避免「为清理敏感信息而新增敏感信息」。
  - **退出码**：0 = 六类全清（T-25 达标判据）；1 = 有命中。
- **正控（L44）**：`--selftest` **17/17 PASS**。开发中它**当场抓出检测器自身的一个假绿**：
  首版把占位符判据写成 `/^sk-(abc|test|…)/i` **前缀匹配** → 把 `sk-abcdefghijkl…`
  这种真密钥形状当成掩码放过。已改为**按分隔符切段、每段都必须是占位词或重复字符**。
- **首扫结果**：**306 项 / exit 1**（明细见 T-25 与
  [docs/T-25-PUBLISH-HYGIENE-2026-09-11.md](docs/T-25-PUBLISH-HYGIENE-2026-09-11.md)）。
  白名单从 60 项噪声收窄到 11 项真信号（jQuery/lodash 官网、示例域、正则截断的伪域名属误报）。
- **未做**：数据冻结期内**只读**——未改/未删/未 `git rm` 任何文件，报告全文掩码且**自身 0 命中**（已验证）。

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

### T-35　清理：4 份 deep-merge 实现收敛到 `dsht-plugin-shared`　✅ **完成**（2026-09-11 心跳 59）
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
  不能四份合成一个函数——否则任一侧调用方行为会变。

#### ✅ 落地结果（2026-09-11 心跳 59）

**新建单实现源** `packages/src/dsht-plugin-shared/deep-merge.ts`（零 import / 零依赖，UI 与插件两层共用）：

| 导出 | 语义 | 吸收的副本 |
|---|---|---|
| `deepMergeIncoming(low, high)` | **families-A**：incoming 获胜 | 3 份（逐字相同） |
| `deepMergeExistingClone(existing, incoming)` | **families-B**：existing 获胜 + 补入值**深拷贝** | 1 份 |
| `isMergeableObject` / `clonePlainTree` | 谓词与深拷贝（原先也在 `state/mvu.ts` 各存一份） | 2 份 |

**5 个调用点全部改为别名/换参**（对外 API 名**一个没变**，调用方零改动）：

| 原位置 | 现在 |
|---|---|
| `tavern-helper/variables.ts:deepMergeVars` | `export const deepMergeVars = deepMergeIncoming` |
| `dsht-plugin-mvu/index.ts:deepMerge` | `export const deepMerge = deepMergeIncoming` |
| `th-shim.ts:deepMergeAssign` | `export const deepMergeAssign = deepMergeIncoming` |
| `th-shim.ts:deepMergeInsert` | 保留为 `deepMergeIncoming(vars, existing)`（**换参写法**，非第 5 份实现） |
| `state/mvu.ts:deepMergeInitVars` | `export const deepMergeInitVars = deepMergeExistingClone` |

**新增 `tests/deep-merge.spec.ts`（17 条）**，钉住三件事：
① **等价性**（3 个历史名 × 5 组用例逐例等于 `deepMergeIncoming`）；
② **家族方向**（同一输入下 families-A 与 families-B **结论必须相反**——「不可合一」的机器判据）；
③ **引用语义差异**（`deepMergeInitVars` 深拷贝 vs `deepMergeInsert` 共享 `incoming` 子树）。

**负控（真跑，非口头）**：把 `deepMergeExistingClone` 临时改成 `deepMergeIncoming` →
**11 条转红**，其中包含**既有的 `mvu.spec.ts` 用例**（老测试也能抓住家族接错）→ 还原。

**验收**：`typecheck` 三段式 **0 错**（顺带被 `typecheck:tests` 抓出我自己测试里 1 处
`unknown` 收窄）；全量单测 **52 文件 / 1095 全绿**（+17）；产物已重建。

**本次新发现（已写进代码注释与测试）**：families-B 内部还有**第二层差异**——
`deepMergeInitVars` 与 `deepMergeInsert` **结果形状相同、引用语义相反**
（前者深拷贝，后者共享 `vars` 子树引用）。**只写 `toEqual` 的测试发现不了这个差异**，
故两者**仍不可合一**：`deepMergeInsert` 保留换参写法。
⇒ T-35 的最终形态是 **「1 个文件 / 2 个函数 / 3 处别名 / 1 处换参」**，而不是「1 个函数」。

---

### T-63　✅ **卡脚本 `importFromModule` 的 4 个 ST 内部模块已全部提供**（心跳 60 登记；**心跳 67 已修 + 设备实测**）
- **背景**：卡用 `importFromModule(container, [{items, from}])`（`tmp/t37-inject.js:103-127`）注入
  `<script type="module">`，内含**静态 import**；调用点在 `$(async () => { await fetch('/version') … })`
  就绪块内（`:2204-2243`）。
- **判据 A（缺口存在）** ✅ **成立**：基准 `SillyTavern-reference/public/` 四个模块**都在**
  （`script.js` 507,531 B / `scripts/openai.js` 306,691 B / `scripts/preset-manager.js` / `scripts/utils.js`）；
  我方实机 `GET /script.js`、`/scripts/{openai,utils,preset-manager}.js` → **全部 404**。
- 🔴 **判据 B 已修正（2026-09-12 心跳 67，原判定作废）**：原写「`window.versionNumber` 全 `undefined` ⇒
  就绪块从未执行 ⇒ 当前无 import 失败」——**该读数的口径错了**：
  ① `versionNumber` 由卡的 `inject.js` 写在**宿主页**（`:47` 顶层初值 `10000`、`:2214` 就绪块内改写），
  而 hb60 的三个探针读的是 **iframe 帧**的 `contentWindow`（`hb60-frame-anchor-probe.js:9` 等）⇒
  帧内 `undefined` 是**必然结果**，与"就绪块是否执行"**无关**；
  ② **反证（更硬，同仓库内）**：`TASK-LIST:626` 的设备栈帧
  `RegexBinding@inject.js:3885 ← (anon)@inject.js:2311` —— `:2311` 位于 `$(async () => {…})` **体内**
  （块起于 `:2209`），而两次 `importFromModule`（`:2219` / `:2238`）在该体**更早处**
  ⇒ **就绪块执行过、`importFromModule` 已被调用过** ⇒ 四条 404 是**正在发生**的失败，不是潜伏缺口。
  ③ **心跳 67 实机复核**（只读探针 `scripts/hb67-t63-reachability.mjs`，宿主页 context）：
  `topVersionNumber=undefined`、`importScriptCount=0`、`/version=200`、四个模块端点全 **404**
  ⇒ 该脚本**当前未被注入**（当前会话跑的是 Wuwa 系 7 个 TH 脚本，**不含** SoliUmbra 加载器）
  ⇒ 准确定性 = **条件可达**（仅在示例预设系预设启用时注入；栈帧证据证明彼时可达），
  **不是"未可达"**。⇒ 该缺口**会真实打断卡的 bootstrap**，故必须修（下方拍板）。
- **一旦可达的后果**（工具 `audit-card-resource-surface.mjs` 机读口径；**本节已被该工具纠正过一次**）：
  **裸标识符 8 处**（`:1843/1847/1914/2254/2256/3025/3039/3045`）→ 理论 `ReferenceError`
  （⚠️ `:1914` 的 `SPresetImports?.promptManager` **也属此类** —— **可选链挡不住「未声明的标识符」**，
  `?.` 只对 null/undefined **值** 短路；分档只看有没有 `globalThis.`/`window.` 前缀）；
  **带前缀 + `?.` 4 处**（`:510/539/550/1347`）→ **静默降级**。
  **但 8 处裸引用全部下游于 `module_imported`**（`installSPresetMessageInjectionHook` 的调用点
  `:2303` 就在该处理器体内）⇒ **「鸡与蛋」**：导入失败 → 处理器不跑 → 代码不可达；
  导入成功 → 容器已定义 → 裸引用有值 ⇒ **在失败模式下结构性不可达**（比"碰巧没触发"更强），两向均无崩溃。
  净后果 = **SPreset / MacroNest / ChatSquash / 结构化消息注入 / 预设重命名 sanitize 等卡侧功能整体静默缺失**。
- **安全推论**：只修 `STVersionImports` 时，`module_imported` 以 `id:'STVersionImports'` 发射，
  处理器里 `if (data.id === 'SPresetImports')` 分支被跳过 ⇒ **不会触碰任何 SPreset 裸引用** ⇒ **半修安全**。
- **可修边界（关键：ES 静态 import 是原子的）**：

| 模块 | 可忠实实现 | 依据 |
|---|---|---|
| `./script` → `displayVersion` | ✅ | 基准即 `'SillyTavern ' + pkgVersion`（`script.js:506`）；我方 `/version` 已返 `pkgVersion` |
| `./script` → `streamingProcessor` | ✅（初值语义） | 基准初值就是 `null`（`script.js:455`），live binding |
| `./scripts/utils` → 2 个纯函数 | ✅ | 纯函数，可逐字移植 |
| `./scripts/preset-manager` → `getPresetManager` | ⚠️ 需真实现 | 需 ST PromptManager 契约的预设管理器 |
| `./scripts/openai` → `promptManager`/`Message`/`MessageCollection`/`sendOpenAIRequest` | ❌ **不可**（预可见成本内） | 需重实现 ST 前端 prompt manager + 消息模型 + 生成入口 |

  ⇒ **`STVersionImports` 只依赖 `./script`** ⇒ **可独立修好**（成本小、语义忠实）；
  **`SPresetImports` 横跨四模块** ⇒ 只要 `openai`/`preset-manager` 不能真实现，它**永远不可能成功**
  ⇒ **单独补 `utils` 是无效功**（还制造"我修过了"的假象）。
- **明确不做**：给 `./scripts/openai` 塞**空壳导出** —— 那会让 import 成功、`module_imported` 发射、
  卡随后 patch 一个**我们伪造的** `promptManager` ⇒ 把「静默缺失」换成「错误地看起来能用」，
  **比现状更糟**（与 T-42 拒绝的 C 方案同型）。
- **落点（若日后修 `STVersionImports` 这一半）**：`dsht-plugin/index.ts:7378` 已有同机制范例
  （`ctx.webServer.register({ kind:'exact', path:'/version' })`），新增 `/script.js` 走同一注册面。
- **定性证据**：`stage3-device/hb60/T63-ST-MODULE-GAP.md`（全判据 + 实机输出）
- **新增可复用工具**：`rp-workspace/scripts/audit-card-resource-surface.mjs` —— 把 T-42/T-60/T-63
  三次"逐次踩坑"升级为 **L43 式一次性静态穷举**：机械抽取卡的 `importFromModule` 模块依赖
  （**含裸标识符引用点数**，这是分"静默降级 vs ReferenceError"的唯一依据）、`fetch` 端点
  （`--probe <base>` 实测 HTTP 码）、`globalThis`/`window` 期望全局、资源字面量。
  **`--selftest` 14/14 PASS**（含 2 条负控：注释掉的调用不得计入）。
  实跑卡输出：`/version → HTTP 200`（T-60 修复在设备上活着）；`SPresetImports` 裸引用 **8 处**、
  `STVersionImports` 裸引用 **2 处**；`toastr ×4 ?.`（我方 `host-vendor.ts:87` 已提供等效实现）。
  ⚠️ **它当场纠正了本轮手工分档的两处错误**（裸引用 4 → **8**；`:1914` 由"静默档"改判"抛错档"）。
- **✅ 边界普查（本轮完成，关键正面结论）**：用同一工具对**设备上全部 7 个 TH 脚本**
  （`thApi('scripts/for-session')` 取回，合计 **575,499 B**）做了一次穷举 ——
  **`importFromModule` 0 处、`fetch` 端点 0 处**；仅有的两个 host-expected 全局
  （`TavernHelper`、`$`）我方**都已提供**。
  ⇒ **缺口被限定在「外链托管的卡注入脚本」这一个来源，不是用户脚本的系统性问题**。
  修不修 T-63 对**用户当前在用的脚本零影响**，只影响该卡自身的 SPreset 系列功能。
  ⚠️ 但**"影响面小"不等于"可以不修"** —— 2026-09-12 拍板已推翻"登记为已知差异"的处置，
  **必须修**（见下方「拍板」与 **§6.5**）。
- 🔴 **拍板（2026-09-12）：必须修，且两个模块组都要修**。
  - **不接受**「单独补 `utils` 是无效功」⇒ 那只是说"要修就修全"，**不是"可以不修"**。
  - **也不接受**「当前不可达」⇒ 可达性是**卡的加载时机**问题（`$(async () => …)` 就绪块），
    而 T-42/T-60 已实证该块**执行过**（`versionNumber === 11800`）。可达性会随卡的版本漂移。
  - **实施顺序（先易后难，但都要做）**：
    | # | 件 | 做法 | 说明 |
    |---|---|---|---|
    | ① | `GET /script.js` | 走 `ctx.webServer.register({kind:'exact', path:'/script.js'})`，导出 `displayVersion`（`'SillyTavern ' + pkgVersion`）与 `streamingProcessor`（初值 `null`，live binding） | 与 T-56 的 `/version` 同机制（`index.ts:7378` 有范例） |
    | ② | `GET /scripts/utils.js` | 移植基准两个纯函数（逐字） | 纯函数，零风险 |
    | ③ | `GET /scripts/preset-manager.js` | 真实现 `getPresetManager`（ST PromptManager 契约） | 依赖我方既有预设面板数据面 |
    | ④ | `GET /scripts/openai.js` | 真实现 `promptManager` / `Message` / `MessageCollection` / `sendOpenAIRequest` | **最重**，需接我方既有生成链路（**禁止另写一份生成入口**——必须复用） |
  - 🔴 **架构级发现（心跳 67，决定"忠实实现"的真实边界）**：四个端点**必须**实现（否则
  `module_imported` 不发射、卡的 patch 段整段不执行），**但仅补端点会落进"空壳"**——
  因为卡的 patch 目标是**浏览器侧对象**，而我方 prompt 装配在 **node 侧**：
  | 事实 | 证据 |
  |---|---|
  | UI 侧 `hostEventSource` 与 node 侧装配是**两套互不相通**的运行时（无共享内存、无 IPC 除 HTTP 数据面） | `host-vendor.ts:209-219`（单例）/`:526`（注入 `getContext().eventSource`）；`th-shim.ts` 全文 `eventSource` **0 命中**（iframe 侧是另一套 `listeners`） |
  | **`hostEventSource` 从未被任何生产代码 emit** —— 卡挂的 `GENERATE_AFTER_DATA` / `APP_READY` / `SETTINGS_UPDATED` 处理器**永远不触发** | 全仓 `getHostEventSource()` 仅 3 处：定义 `:216` / 注入 `:526` / **测试**；`.emit(` 在 `dsht-rp-ui/src` 零命中 |
  | node 侧主动事件全是 **cordis 进程内**（浏览器无法订阅） | `index.ts:3997` `dsht-rp/assemble` / `:4033` `dsht-rp/turn` / `:4245` `dsht-rp/wi-scan` 等 |
  | node 侧**无** websocket / SSE / postMessage 推送通道 | 全仓 `text/event-stream` / `EventSource` / `WebSocket` 零命中；三处 `webServer.register` 全是请求-响应式 |
  | 卡的 patch 目标对象**身份不持久**（快照变即重建，patch 丢失） | `host-vendor.ts:512-519`（每次 `buildHostStContext` 新建字面量）+ `:754-765`（按快照引用 memo） |
  ⇒ **准确定性**：本条的**可达部分 = 接口面 + 读侧数据真值**（`displayVersion` / `Message` / `MessageCollection` /
  `getPresetManager` / `getSanitizedFilename` / `promptManager` 读侧 / `streamingProcessor` 初值）；
  **需产品取舍部分 = 「浏览器侧第三方脚本改写最终 LLM 请求」的通道**（见下方待决项 D-67-1）。
- ⏳ **待决项 D-67-1（登记，不阻塞其余实施）**：要不要建「node ↔ UI prompt 改写通道」？
  - **选项 A（不建）**：模块面 + 读侧忠实实现；卡的 **写侧 patch**（`preparePrompt` / `setChatCompletion` /
    `streamingProcessor.generate` / `GENERATE_AFTER_DATA` 处理器）**明确不出声声明为已知差异**
    （出声 + 可定位，不静默）。代价 = 卡的 ChatSquash / 结构化消息注入等功能**不生效**。
  - **选项 B（建）**：node 在 `agent/pre-step`（async 面）把「最终批」投影暴露给 UI、短时等待回写。
    代价 = 每轮生成引入一次 **node→UI→node 往返**（延迟 + 失败模式），且需解决"UI 不在场"的降级；
    与 `tt-projection.ts:14-22` 已记录的「在 `llm/stream` 改写请求**已被证伪**」同源约束
    （`llm/stream` 的 `options` **deep-frozen**，`index.ts:3750-3759`）—— 只能走 `agent/pre-step` 的可变面。
  - **影响面**：选项 A = 卡的部分功能缺失但**透明**；选项 B = 功能齐但引入生成路径的新失败模式。
- ⚠️ **明确不做**：给四个模块塞**空壳导出**（让 import 成功但 patch 落在死对象上）——
  那正是 §6.5 纪律禁止的「把静默缺失换成错误地看起来能用」。**要么真做，要么出声声明边界。**
  - **判据（可复跑）**：四个 URL 全 **200** + 内容为合法 ES module；卡的就绪块里
    `window.versionNumber = 11800`；`STVersionImports` / `SPresetImports` 两个 `module_imported`
    都被发射；卡 bootstrap 四段（`RegexBinding`/`ChatSquash`/`MacroNest`/`syncSPresetToolRegistrations`）
    全执行且**零 `ReferenceError`**（设备实测）。
- **沉淀**：LEARNINGS **L83**（缺口"存在"≠缺口"可达"；静态 import 原子性）· **L84**（定锚须用显式 `window` 变量）

---

### T-64　✅ **新会话第 2 轮携带陈旧世界书快照副本（去重触发器自指短路）**（心跳 61 已修 + 实机闭环）

**症状（活体取证）**：纯 RPC 新建会话驱动 2 轮 → 第 2 轮请求 `llm-224.json` = `messages=11` /
**总字符 79,994** / **大块重复 ×2**（逐字相同的 **23,782 字符**块，索引 4 与 9）。

**双重独立取证**（缺一不能定性为"我方注入"）：
1. 同轮 `agent/pre-step` 快照 `msg-057.json` → 该块 `source.kind='plugin'`；
2. `session-0b05834c.v3.jsonl` → **seq=11 与 seq=25 逐字相同**，签名同为
   `["dsht-rp-plugin",["dsht-rp:wi-depth:0"]]`。

**根因（不可达分支，L84 同族）**：`dsht-plugin-memory/index.ts` 的 `planShadowOps`
**语义正确** —— 它已有 `freshSigs` / `supersededByFresh`（"本轮重注同签名旧副本 → 折叠旧的"），
但**触发条件**写成 `if (!overThreshold && dupSigs === 0) return ''`（修复前 `:894-901`）：
`dupSigs` 数的是"视图上已有几份"，而 `freshSigs` 生效的前提恰是"视图上只有 **1** 份"
⇒ **规划器永不被调用，那段正确逻辑是死代码**。
**第 3 轮起"自愈"是巧合**：折叠 marker 共用同一签名（源码 `:985` 注释自认）⇒ marker ≥2 后
`dupSigs` 恒 ≥1 偶然重新武装（实测第 4 轮日志"重复签名 1 组"就是 marker 自己）。

**修复**：
- 抽出纯函数 **`decideShadowTrigger({nodes, freshSigs, estTokens, threshold, minDup})`**；
- 判据补第三条 **`freshStaleSigs ≥ 1`**（视图上存在本轮被重注的同签名旧副本，**1 份即够**；
  只对快照节点计数、按签名去重）；
- `if (!trig.need)` 早退。

**验收**：
| 项 | 结果 |
|---|---|
| 新增单测 | `tests/memory-plugin.spec.ts` **8 条**（含"触发器放行 ⇔ 规划器产出 `[{start:11,end:11,kind:'snapshot'}]`"两级一致性） |
| **负控**（改回 `overThreshold \|\| dupSigs > 0`） | **正好 2 条转红**（= 新增的两条正控），其余 50 条不动 ⇒ 新判据在承重 |
| 全量单测 | **53 文件 / 1111 全绿**（+8） |
| 实机日志（v273） | `未超阈值 + 重复快照签名 0 组 + 本轮重注旧副本 1 组 → 去重启用` → `ops=1，视图 3.6万→1.2万字符` |
| 实机结果 | 新会话第 2 轮 **0 重复组 / 63,562 字符**（旧构建 79,994，−20.5%） |
| `stage4-regression` | **21/21** |

**顺带修掉（L86）**：`:916` 注释承诺"把每个 early-return 落盘成探针"，但全仓 grep
`probe`/`writeProbe` **返回零个标识符** ⇒ 补实现 + 三处调用（`no-surface`/`skipped`/`need-but-zero-ops`）。

**交付**：APK `x86_64 debug` **196,840,085 B sentinel v273** / `arm64 release` **128,366,108 B sentinel v274**；
三方一致性 md5 `cf288b9b9cb56cf1be7ac55218c376fb`。
证据全文 `stage3-device/hb61/HB61-SNAPSHOT-DEDUP-EVIDENCE.md`。
**沉淀**：LEARNINGS **L85**（触发器自指短路）· **L86**（文档承诺的防线可能只是注释）。

---

### T-65　🔴→✅ **「走 UI 新建的会话」会让 app 下次冷启无限 crash-loop**（心跳 61B 实机发现并修复）

**症状**：装 v275 后冷启，logcat **刷屏** `node exited with code 1; restart in 3s`；
栈顶 = `dsh-workspace` → `assertStoredIdentity` 抛 `corrupt session log`。
栈里含 `Fiber._reload` ⇒ **首启可能侥幸通过、一次 fiber 重载就命中**
（"我装了包能起来、你重启后起不来"这类最难查的形态）。

**三层缺陷链**（每一层都能独立站住）：

| # | 层 | 缺陷 | 归属 |
|---|---|---|---|
| ① | 触发源 | `/rp/home` 交出**非规范**路径形态 `/data/user/0/<pkg>/files/.dsh`；`RpOverlay.tsx:73/:330` 拿它拼 `session.create` 的 cwd | 我方 |
| ② | 修复器 | `repairSessionCwds` **先 `rename` 目录、后按硬编码 `'session.jsonl'` 读文件** —— 0.1.5 世代是 `session.v3.jsonl`（`session.jsonl` 作为 **v0 被冻结保留、目录里不存在**）⇒ `ENOENT` 被 catch 吞成 `errors=1`，而**目录已搬走、header 未改** ⇒ **半修复态、永不收敛** | 我方 |
| ③ | 后果 | 目录名 ≠ `projectKey(header.cwd)` ⇒ 插件树**加载期**抛错 ⇒ **crash-loop** | 官方校验（行为正确） |

**根因佐证**：官方 `projectKey()` 把 `/` `\` `:` 折叠成 `-`；而 Android 上 `/data/user/0/<pkg>`
与 `/data/data/<pkg>` 是**同一目录的两个路径形态**（bind mount，`readlink -f` 不改写），
**字符串折叠结果却不同** ⇒ 目录名对不上。

**取证**：`/rp/repair-session-cwd` 返
`{"scanned":82,"repaired":[],"errors":["session-16e10fc9-…: ENOENT: … --data-data-…--/session-…/session.jsonl"]}`
—— **目标路径已是规范形态**，反证目录确实已被搬走（= ②的现场指纹）。

**修复三件**：

1. **Fix 1（止血）** 抽纯函数 `relocatedSessionLogPath(root, targetProject, sdir, sourceFile)` ——
   **从扫描结果 `SessionHeaderHit.file` 取 basename，绝不重拼 `session.jsonl`**
   （`dsht-plugin-shared/session-surgery.ts`）
2. **Fix 2（根因）** `/rp/home` 交出 `normAndroidPath()` **规范形态** ⇒ **消除新增来源**
3. **Fix 3（可观测）** 失败明细 `console.log` 进 logcat（此前只有 `logLine`，**只进 200 行内存环形缓冲**）

**验收（全实测）**：见 MASTER_TODO「心跳 61B 做了什么」。要点 ——
symlink 形态冷启动回归 `repaired=1 skipped=0 errors=0` + **`node exited with code` 计数 0** ·
全树不变量审计 **85/85 / 0 违反** · 负控 **正好 4 条转红** · 新增 **5 条单测** ·
`stage4-regression` **21/21**。

**新闸门**：`stage3-device/hb61b/audit-cwd-projectkey.mjs` —— 逐字照抄官方 `projectKey`，
把「目录名必须 == `projectKey(header.cwd)`」变成**可复跑判据**（本轮最有复用价值的产出）。

**沉淀**：LEARNINGS **L87**（半修复态比不修复更危险 —— 不可逆动作最后做）·
**L88**（修复器的**位置/阶段**决定它能否救场）· **L89**（root shell 改应用文件必须改回应用 uid）。
证据全文 `stage3-device/hb61b/HB61-CWD-REPAIR-EVIDENCE.md`。

**残留（如实标注）**：Fix 2 只消除**新增**来源；**存量 / 意外非法态仍不可自愈**。

---

### T-67　✅ **壳侧 pre-boot 静态预检**（心跳 61B 提出 → **心跳 62 落地并设备闭环**）

**动因（L88）**：我方所有会话修复器都在**插件体内**（`dsh-plugin/index.ts` 启动即修），
而 T-65 的损坏发生在 **`[cordis.init]` 插件树加载期** ⇒ **修复器根本轮不到执行**，
整个 app 起不来，连一个能打日志的插件都没有。

**最终做法（与"建议"的三处偏离，都有实测理由）**：

| 建议 | 最终 | 为什么改 |
|---|---|---|
| 隔离（而非修复） | **搬正（`rename`）+ 冲突才隔离** | 搬正是**唯一的 rename**、不写文件内容 ⇒ 与前一轮 L87「不可逆动作最后做」不冲突；实测能让用户**恢复访问自己的会话**，而隔离会让会话"消失"，代价更大 |
| 落在"壳侧 pre-boot 阶段" | 落在 **node 启动参数**（`--import`） | 壳侧只能注入参数、做不了文件系统动作；`--import` 在主入口求值**之前**跑且会等其**顶层 await** ⇒ 正好卡在插件树之前（顺序已用假下游消费者验证） |
| 写"app 起不来时也能读到"的文件 | 落地为 `dsht-preflight-status.json`（**覆盖式、定长三态**）+ 追加式 `.log` | 覆盖式保证"最后一次运行的状态"永远可读；日志只在**真动过手**时追加，不产生噪声 |

**实现**：`rp-workspace/packages/src/dsht-preflight/index.ts`（17.6 KB）—— 逐字照抄官方
`projectKey` / `encodeSegment`（**只按 `header.cwd` 字面值，绝不 realpath**）；运行时显式 `path.posix`；
目标已存在 → 隔离到 `sessions/` **之外**的 `sessions-quarantine/<stamp>/`；rename 失败 → 目录**原封不动**；
一切异常 **fail-open**（顶层 await，绝不许拦住启动）。
注入点：`NodeService.kt` 的 `preflightOption()`（产物不存在则**不注入**）。

**两道闸（L92）**：入口闸 `process.argv[1]` 必须以 `/@deepseek-ai/dsh/lib/bin.js` 结尾
（因 `NODE_OPTIONS` 会被**子进程继承**）+ **反控闸 `DSHT_PREFLIGHT_DISABLE=1`**。

**验收（全实测）**：
- **宿主机制烟雾测试**三组对照全过（带/不带 `--import`、`DISABLE=1`）—— 见 L93
- **单测 25 条**（`tests/preflight.spec.ts`）：方向 / 失败模式 / 反控 + `FakeFs` 故障注入 +
  真 fs 端到端 + **与官方实现逐输入等价性对质**
- **设备四段**：① 基线 `扫描 81 个会话目录：ok=80 搬迁=1 隔离=0 不可读=0 失败=0`；
  ② 反控（挪走产物 + 造违反态）`node exited=2 / corrupt session log=10`，原文
  `failed to apply loader entry workspace: corrupt session log "…/--hb62-wrong--/dsht-welcome/session.jsonl"`；
  ③ 正控（放回产物）`node exited=0 / corrupt=0` · `repaired --hb62-wrong--/… → --data-data-…-_start--/…` · 端口 3080 起；
  ④ 收场 `{"scanned":81,"repaired":[],"skipped":[],"errors":[]}` · 顶层回 26（= 基线）
- **构建断言**：新增 **A8**（产物存在 + 含 `sessions-quarantine` + 含 `DSHT_PREFLIGHT_DISABLE`）与
  **A9**（`NodeService.kt` 必须引用 `dsht-preflight` 且含 `--import` —— 防"产物进包但没人加载它"这种**空防线**）；
  正控各 2 命中、负控双双 0
- **交付**：`typecheck` 三段式 0 错 · 单测 **54 文件 / 1141 全绿** ·
  APK `x86_64 debug v278` / `arm64 release v279` · `stage4-regression` **20/21**（与基线同）

**证据**：`stage3-device/hb62/`（`preflight-smoke.sh` / `hb62-device-verify.sh` / `hb62-repair-audit.js` + 两份日志）

---

### T-68　🆕 **运行期移动 `sessions/` 顶层 project 目录 ⇒ 下一次 reload 打死 node**（心跳 62 顺带定性）

**症状**：心跳 62 收场把测试造出的空壳 project 目录 `mv` 出 `sessions/`，**59 秒后** node 崩：

```
Error: dsh: plugin tree failed to load: … failed to apply loader entry workspace
       (@deepseek-ai/dsh-workspace): ENOENT: no such file or directory,
       scandir '…/files/.dsh/sessions/--hb62-wrong--'
  at async Proxy.listSessionDirs (dsh-session-persistence-jsonl/lib/index.js:3272:19)
  at async Proxy.listArtifacts   (…:2867:22)
  at async WorkspaceRegistry.listStoredHeaders (dsh-workspace/lib/index.js:730:11)
  at async [cordis.init] (dsh-workspace/lib/index.js:348:65)
  at async Fiber._reload (cordis/lib/index.js:1355:5)
```

**根因（官方源码，读出来的不是猜的）**：`dsh-session-persistence-jsonl` 的**两段式枚举不对称** ——

```js
async listProjectDirs(signal) {
  try { … return readdir(this.root) … }
  catch (error) { if (isENOENT(error)) return []; throw error }   // ← 有守卫
}
async listSessionDirs(project, signal) {
  const entries = await readdir(project, …)                       // ← 无守卫
}
```

⇒ 枚举两趟之间发生删除时，第二趟必然 ENOENT 上抛；`Fiber._reload` 路径上**没有任何 catch**
⇒ 未捕获 ⇒ `node exit 1`。**启动时不会命中**（要么 root 都不在 → 被吞；要么都在），
**只有运行期会命中** —— 也就是唯一危险的那种。

**处置**：① **不改官方源**（合规红线）⇒ 登记为**上游缺陷候选**，可上行反馈；
② **我方纪律（已写进验收脚本与 LEARNINGS L94）**：`sessions/` 顶层 project 目录**运行期只读**，
要改必须 ① 先 `am force-stop`，或 ② 改在 **pre-boot 预检**里做（那只在插件树加载**之前**跑，天然安全），
或 ③ 改到 `sessions/` **之外**（预检的 `sessions-quarantine/` 正是这么设计的）；
③ 已核查我方产品代码：`repairSessionCwds` 只 `rename`**会话目录**（不是 project 目录），空壳 project 目录
仍存在 ⇒ `readdir` 可成功，**不触发**本条。

---

### T-69　🔴→✅ **「会话管理」面板自上线起从未可用 —— 3 个路由恒 404**（心跳 63C 实机发现并修复）

**症状**：设备 UI 「会话」页显示 `审计失败：unknown endpoint` + 「未发现任何会话文件。」
（设备上明明有 81 个会话）；`forkedCount` / `emptyCount` 恒 0 ⇒ **两个清理按钮 `disabled` 恒真**，
列表恒「审计中…」⇒ **整个面板零可用**，只剩一段说明文字（该功能是 2026-09-04 用户专门要求的）。

**实机对质（决定性，CDP 同源 POST）**：

| 端点 | 结果 |
|---|---|
| `/dsht-rp/rp/home` | **200** |
| `/dsht-rp/rp/workspaces` | **200** |
| `/dsht-rp/rp/books` | **200** |
| **`/dsht-rp/sessions-audit`** | 🔴 **404 `{"error":"unknown endpoint"}`** |

⇒ 不是"插件没挂"（其它路由全通），是**这个路径不存在**。

**根因**：`SessionsPanel.tsx` 的 4 处调用（3 个路径）**少了 `rp/` 前缀**：

```ts
await rpApi('sessions-audit')                             // → /dsht-rp/sessions-audit   ❌
await rpApi('sessions-archive', { sessionIds: [id] })     // → /dsht-rp/sessions-archive ❌（2 处）
await rpApi('sessions-autoclean', { mode, dryRun: true }) // → /dsht-rp/sessions-autoclean ❌
// 服务端挂的是 /rp/sessions-audit | /rp/sessions-archive | /rp/sessions-autoclean
```

**全仓对质**：前端 15 个唯一 `rpApi` 路径里，**正好这 3 个**缺前缀，其余全对。
错误被 `catch { setNote('审计失败：…') }` 吞成一句提示（静默失败族）。

**🔴 为什么既有防线没抓到 —— 防线自己有整类盲区**：`scripts/audit-route-contract.mjs`
（心跳 46 正是为此类缺陷而建）把「服务端**完全找不到该路径**」写成
`checked.push({verdict:'未在服务端找到该路径（可能是别的前缀/动态拼接）'}); continue` —— **不计违约**。
⇒ 恰好在最该报警的一类上放行。（L44 同族：防线必须能抓到自己该抓的东西 —— **同一文件里的第二次**。）

**修复（只改一侧）**：
1. **前端** 4 处加 `rp/` 前缀对齐后端；**不给后端加无前缀别名**（两套路径 = 新的静默分歧源，L36）。
2. **防线升级**：判据扩为 `挂错 method` **∪** `路径根本不存在`（后者从"说明"升级为**违约**）。
3. **第一次给该防线加了可复跑正控**：新增 `scripts/fixtures/route-contract/`（1 个 OK + **3 个应报违约**）
   + `--selftest`（子进程跑自己）**6 断言全 PASS**（含"POST 区可用的样本**不**被误报"这条反控）。
4. **接入构建 = A10**（`build-wb.sh`）：先跑 `--selftest` 再跑真实审计，不过则中止构建。

**验收**：升级后在**修复前**跑真实源码 ⇒ **精确报出这 3 处、零误报**（最佳正控）·
防线自检 **6/6 PASS** · 修复后真实审计 **0 违约** · `typecheck` 三段式 **0 错** ·
单测 **54 文件 / 1149 全绿** · 双架构 APK 重打 · 实机复测端点返 200。

**证据全文**：`stage3-device/hb63/SESSIONS-PANEL-404-FIX.md`

**同轮另发现两条（未修，如实登记）**：
- `Choose workspace` 后卡在 `Loading workspaces…`（3 秒后仍未出结果）⇒ 疑与 **T-57**
  （`gateway/service-unavailable`，本轮 logcat **第三次独立复现**）同源，**登记待查**。
- `E/chromium: Unable to create cache`（1 次，未见后果）—— **只记录，不推断**。

---

### T-70　✅ **`/rp/sessions-audit` 慢（暖态 6.4 s / 冷态 48 s）—— 已收口**（心跳 63C 续发现 · **心跳 63D 修复 + 实机验收**）

> **本节的形态：先保留"登记时怎么判的"，再写"实测怎么推翻的"** —— 因为这次的**归因本身错了**，
> 而错误的归因比错误的结果更危险（它会让人沿错方向继续优化，见 LEARNINGS **L105 / L108**）。

#### 1. 登记时的判断（**已被本轮实测推翻**，保留以便回溯）

原判词：「根因在服务端 `collectSessionsAudit`（`dsh-plugin/index.ts`）为拿 `events` 行数而**逐行流式读完全部
81 个 `session.jsonl`**（内存恒定，但 **I/O = O(全部会话字节)**）；唯一有效优化是行数索引/缓存，
而缓存必须同时交付失效策略 ⇒ 现在上就是把"慢"换成**静默陈旧** ⇒ **登记不开工**」。

**其中「I/O 是瓶颈」与「唯一有效优化是缓存」两句都不成立**（见 §2）。

#### 2. 真根因：**CPU，不是 I/O**（心跳 63D 实测，两张判决性测量）

| 测什么 | 结果 | 说明 |
|---|---|---|
| 设备**裸磁盘**读 65 MB（`cat … > /dev/null`） | **65 ms**（≈1 GB/s） | **I/O 带宽完全不是瓶颈** |
| 宿主同一文件：`readline` 逐行 vs 字节扫描 | 62.3 MB **442 ms** vs **21 ms**（**20.9×**）<br>26.4 MB **142 ms** vs **17 ms**（**8.4×**） | 瓶颈是**单线程 CPU**：为拿行数把全部字节逐行字符串化 |

⇒ 由此推出「加并发」是错方向：**单线程 JS 里并发不产生 CPU 并行**，只重叠 I/O 等待。
实测印证 —— 只加并发（`mapBounded` 8 路）时暖态 **7.58 → 5.3 s**，仅 **1.4×**。

**并且还有第二个独立的 CPU 成本**（只有在"行数密集"语料上才暴露，第一次 profile 的语料恰好没覆盖）：

| 语料 | `readline`（原实现） | async 字节扫描（第一版） | **同步**字节扫描（最终） |
|---|---|---|---|
| big1 · 62.3 MB / **249 行**（行长 ~250 KB） | 442 ms | 20 ms | 20 ms |
| big2 · 26.4 MB / 104,795 行 | 151 ms | 47 ms | **32 ms** |
| **big3 · 79.3 MB / 314,383 行（≈设备形态）** | 451 ms | 119 ms | **72 ms**（**6.26×**） |

⇒ 两个**互不替代**的 CPU 成本：**① 把全部字节变成字符串**（`readline` 的 `for await`）·
**② 每行一次 Promise**（把 `handleRow` 写成 `async`）。
**设备真实语料（311,484 行 / 242 MB）恰好命中②** ⇒ 只做①时端到端只快 1.8× ——
**"换算法"必须同时把"每行一个 async"也去掉**，否则海量行语料上收效减半。

#### 3. 修复（两处，都是**纯等价替换**）

1. **新增 `dsht-plugin-shared/jsonl-scan.ts`**：`scanJsonlEdges(path)` 用**字节扫描**取三样东西
   （首非空行 header / 非空行数 / 末非空行 `time`）——`CHUNK` 预读 + `indexOf(0x0a)` 计数 +
   **主循环全同步**（只有"行首字节不是 JSON 起始符"的行才进慢路径队列做精确 `trim()`）。
2. **`collectSessionsAudit` 切换到它**，并**保留** `mapBounded` 并发（现在是叠加收益，不是主修复）。
   `createInterface` / `createReadStream` 两个 import 随之删除（`readline` 在产物里归零）。

#### 4. 等价性判据（**这道题的风险不是"跑不起来"，而是"跑起来了但某个角落的值变了"**）

`tests/jsonl-scan.spec.ts` **20 条**，其中 **19 条是"新实现 ≡ 参考实现"逐字对拍**
（参考实现 = 改造前那条 `readline` 路径，**保留在源码里**供对拍），1 条断言具体数值。语料按**口径边界**设计：

> 空文件 · 只有 header（带/不带末换行）· 中间空行 · 只含空格/制表 · **只含 U+00A0 / U+3000**（戳穿 ASCII 快速路径）·
> CRLF · 首行为空行 · 首行/末行非法 JSON · `time` 为 0 · 缺 `time` · **单行 > 1 MiB**（跨块）· 3000 行批量 · 尾部空行

每条对拍**自带正控**（断言参考实现确实读到了非空内容 —— 否则"两者相等"会退化成"两者都空"，L44）。

**过程中被对拍当场抓住的两个真 bug**（否则会静默产出错值）：**① 末行 off-by-one**
（文件以 `\n` 结尾时末行区间应是 `[倒数第二个\n+1, 最后一个\n)`，写成 `[最后一个\n+1, EOF)` ⇒
`lastTime` 恒为 `null`）；**② 行数口径**（旧实现是「**非空行数** - 1」而非「`'\n'` 个数」，
含空行文件上不等价）。⇒ 沉淀 **L106**。

#### 5. UI 侧同族问题（一并修掉）

`SessionsPanel.tsx` 的 `load()` 起始即 `setSessions(null)` ⇒ 刷新期间**计数回落 0、列表清空**，
与"真的没有可清理项"在视觉上**不可区分**（L103 同族）。已改为：**保留上一次结果** + `refreshing` 状态 +
按钮文案切换「⟳ 审计中…」+ 显式提示「刷新中…（下面显示的是**上一次**审计结果，未清零）」。

**同轮还纠正了一条判据自身的缺陷**：新加的第 4 条判据 `noAuditingFlash` 用
`txt.includes('审计中…')` 探测"清零闪烁"，而**新实现的按钮文案本来就是「⟳ 审计中…」**（这是期望行为）
⇒ 该判据**恒假**，输出与"缺陷仍在"完全同形。已改为语义自明的双向表述
（`listNotCleared` / `hintShown` / `buttonLabelLive`）+ 补**负控**（人为改 1 个「归档」按钮文案 ⇒ 计数 81→80→还原 81）。⇒ 沉淀 **L107**。

#### 6. 验收

| 级 | 判据 | 结果 |
|---|---|---|
| **等价性（最强）** | `sessions-audit` 返回的 `sha`（覆盖 `JSON.stringify(sessions)`，**顺序敏感**）与改造前基线**逐字相同** | ✅ `db58cb474c424239`（`count` 81 · `first3` 逐字一致） |
| **端点级（设备）** | 冷/暖态耗时 | ✅ 冷 **31654 ms**（原 47931）· 暖 **2.8–4.3 s**（原 6.4–7.6 s） |
| **UI 级（设备）** | 「刷新期间列表不清零」5 条判据（含负控） | ✅ **5/5 PASS** |
| **单元/类型** | `jsonl-scan.spec.ts` 20 条 · 全量单测 · `typecheck` 三段式 | ✅ 20/20 · **56 文件 / 1184 全绿** · **0 错** |
| **防线路由契约** | `audit-route-contract --selftest` · `vendor-deps` · `audit-patch-markers` · `apply-platform-patches --check` | ✅ 6/6 · 5/5 · 19/19 · 19 已打 0 失败 |
| **产物** | 双架构 APK 内符号 + **三方 md5** | ✅ `scanJsonlEdges`×2 · `startsJsonValue`×2 · `刷新中`×1（两个 APK 都命中）；三方 md5 **`554542d7f09bf22ac14ef59fa9951e40`**（staging = 设备 `profiles/web` = 首启解压产物，设备侧 mtime 09:31 ⇒ 无第 ⑦ 类断链） |

**设备实测耗时**（`stage3-device/hb63d/{audit-after,audit-trend}.js`，x86_64 / 81 会话 / 311,484 行 / 242 MB）：

| 版本 | 冷态（装包后首调） | 暖态（稳态） | 相对原始 |
|---|---|---|---|
| v282（`readline` 串行） | **47931 ms** | **6.4–7.6 s** | 1.0× |
| v285（`readline` + 8 路并发） | 43302 ms | 5.3–5.9 s | 1.4× |
| **v286/v287（字节扫描 + 8 路）** | 31654 ms | 2.8–4.3 s | **≈2.1×** |
| **v288/v289（再叠加"主循环同步化"）** | **31654 ms** | **2.8–4.3 s**（min 2829） | **≈2.1×** |

#### 7. 剩余差额的归属（**本轮把这条查到底了，不留给下一轮猜**）

设备上**用设备自己的 node（`libnode.so`）跑同源基准**（`hb63d/{device-bench,bench2,bench3}.cjs`），
语料 = 设备上真实的 83 个会话文件（203 MB / 317,460 行）：

| 测什么 | 设备耗时 | 与宿主对比 |
|---|---|---|
| `cat` 全部会话（原生 shell） | **222 ms** | — |
| `readline` 串行（**原实现形态**） | **6845 ms** | 宿主 1288 ms（5.3×） |
| 字节扫描 串行 | **1611 ms** | 宿主 222 ms（7.3×） |
| 字节扫描 8 路并发 | **1125 ms** | 宿主 148 ms（7.6×） |
| **完整复刻 `collectSessionsAudit`**（nameByKey+realpath+readdir×83+8 路扫描） | **1355 ms** | — |
| 纯 CPU 标定（3e7 迭代） | 979 ms | — |

> 🔑 **`readline` 的 6845 ms ≈ 原版 API 的暖态 6.4 s** ⇒ **原登记里那句根因（逐行读全部会话）是对的**，
> 只是把它归给 "I/O" 归错了 —— 它其实是**这条路径的 CPU 成本**。三种口径的行数汇总**都是 317,460**，
> 且复刻版的 `eventsSum = 311,484` 与 API 返回值**逐字一致** ⇒ 实验保真。

| 端到端端点（同页面、同一 HTTP 通路，各 5 次取 min） | min |
|---|---|
| `rp/home`（极轻） | **54 ms** |
| `rp/build-info`（极轻） | **117 ms** |
| `rp/sessions-audit`（本轮） | **2848 ms** |

⇒ **540 ms 的固定开销可以忽略**（不是差额来源）。而：
**API 2848 ms − 复刻版 1355 ms ≈ 1.5 s 的差额，在「插件源码之外」** ——
即 DSH 框架侧 / app 运行时的开销（最可能是 **app 内 node 的 CPU 供给**：基准是在 root shell 里**独占**跑的，
而 API 处理时 app 内 node 同时承担 WebView 桥、插件树、看门狗）。
⚠️ 这一层**不在我方源码内**（DSH 官方源零修改是合规红线），**本轮到此为止、如实登记**，
不再用"继续优化插件"来假装能吃掉它。

**结论：插件侧已接近其可达下限**（1355 ms 是设备上这条读路径的最小实测值，其中还含 242 MB 的物理读取）。
端到端从 6.4 s → 2.8 s，**算法侧 5.05×、端到端 2.1×** ——
两个倍数的差距**已被上面这张表逐项解释清楚**，不是"优化没生效"。

**同轮新增探针**：`stage3-device/hb63/cdp-file.mjs`（CDP 表达式从**文件**读，避开 shell 抢解释 `${}`/反引号）
· `hb63d/{audit-baseline,audit-after,audit-trend}.js`（基线 / 等价性+耗时 / 连续采样看稳态）
· `hb63d/t70-ui-probe.js`（UI 级 5 判据 + 负控）· `hb63d/t70-profile.mjs` / `t70-real.mjs`（宿主 A/B 对拍与真实实现测速）
· `hb63d/verify-freshness.py`（产物新鲜度，按 `\uXXXX` 解码后判）。

---

### T-71　✅ **脚本高频轮询「看着像我方 API 被打」，追到底判定为「非缺陷」**（心跳 64）

**症状**：实机 logcat 显示某帧 642.3 s 内 `vars:get` **6209 次**（9.67/s）· `vars:put` **643 次**（1.00/s，**含写**）· `wb:get` 428 次。

**结论：非缺陷。** 依据三条，**顺序不可颠倒**（→ LEARNINGS **L110**）：

1. **调用方是卡自己的设计**：卡源码（`世界书控制`）自带 `setInterval(masterLoop, 1000)`，
   每轮约 9 次 `getVariables` + 1 次 `updateVariablesWith`。
2. **语义与基准一致**：我方 `th-shim.ts:771-775` 的 `updateVariablesWith` = `vars:get` + `vars:put`
   （**1:1，与实测 643:643 精确吻合**）；基准 `JS-Slash-Runner/src/function/variables.ts:211-223`
   **同样是 get + `replaceVariables`（读改写）**，且基准的 `insertOrAssignVariables`（`:241-246`）**本身就走它**
   ⇒ **"每秒 1 次写"不是我方引入的额外行为**。
3. **落盘判据（排除最坏情形）**：`rp/variables/global.json` 仅 **182 B** 且 **31 小时未变**；
   活动会话 state 文件 2.2 h 未变 ⇒ **写没有落到磁盘**。

**仅登记为观察**：我方 `vars:get` 每次 `readFile`（基准为内存读取），目标文件仅 182 B，量级不构成负担。

🔴 **过程中的语料陷阱（本轮最重要方法学产出 → L109）**：设备上存在**两个卡副本**
（`b7s7x3` = 0605 版 / `18l9cbg` = 0703-0708 版），**同名脚本 id 相同、内容不同**
（「世界书控制」84,866 B vs **157,718 B**）⇒ 按 id 取语料会**不确定地取到哪一个**。
首轮取到旧版（零处 `replaceVariables`），与现象**对不上**，一度记为"真实矛盾"。
**纠错判据（廉价且决定性）**：找一个**只在一个副本里存在**的 id —— `c1ec74d0`（剧情逻辑 0703）
只出现在 `18l9cbg` **而它在页面上有帧** ⇒ 活动副本 = `18l9cbg`；换语料后一次自洽。

**另登记两条真实差异（不阻塞、当前路径不触发）**：
① 我方 `insertOrAssignVariables` 对**非 chat 作用域**走服务端 `vars:merge`，**基准一律走 `updateVariablesWith`**
⇒ 基准 `replace` 语义**全量写回（副作用：能删键）**、merge 不能（当前活跃脚本走 `updateVariablesWith` ⇒ 不触发）；
② `deepMergeIncoming` 与 lodash `_.mergeWith` 在 **`undefined` 源值**上分叉（**数组整体替换一侧一致** ✅；
lodash **跳过** `undefined` 源、我方**覆盖成 `undefined`**）—— JSON 序列化路径不产生 `undefined`，仅内存直传可达 ⇒ **低优先不改**。

**证据**：`stage3-device/hb64/T71-POLLING-CENSUS.md`

---

### T-72　🔴→✅ **`name1`（用户名）在帧内【顶层】与【getContext】两面都缺 ⇒ 用户侧消息渲染成 `"undefined: 内容"`**（心跳 64 发现并修复）

**发现路径（每一步都可复跑）** → 见 `stage3-device/hb64/T72-NAME1-TOPFACE-FIX.md`：

```
live 帧读数 → 发现「帧内 getContext(11) 有 7 个成员顶层(22) 没有」
   → 先量后做：check-topface-gap.mjs ⇒ 那 7 个**零处顶层直取** ⇒ 判定无效功 ✅
        → 顺手做正控：语料里到底有没有「顶层直取」形态？⇒ **有，21 种 / 254 次**
             → 换正确的问题：**顶层直取的成员里哪些在帧内顶层缺席？** ⇒ **10 种**
                  → `name1` 出现在**当前活跃卡**，且用法**无属性级守卫** ⇒ 真缺陷
```

**方法学要点**：第一次量的是**错误集合**。真正的缺口是另一个交集（顶层直取 ∩ 帧内顶层缺席）。
**"量了" ≠ "量对了集合"**。

**定量**（语料 = 设备上 75 个真实脚本）：顶层直取 21 种 / 254 次；帧内顶层**已有 11 种 / 缺席 10 种**
（`getTokenCountAsync`(10) `messageFormatting`(6) **`name1`(6)** `stopGeneration`(4) `updateMessageBlock`(4)
`generate`(4) `generating`(2) `mainApi`(2) `onlineStatus`(2) `uuidv4`(2)）。
⚠️ **`name2` 在列而 `name1` 缺** —— 同一对成员只挂了一半。

**三条缺陷证据**：① live 帧读数（帧内顶层 22 / getContext 11 均无 `name1`，宿主 40 有）；
② 宿主侧**确有真值**（CDP 同源求值 `{"name1":"示例人设乙",…}`）⇒ 不是"修了也是 undefined"；
③ **卡的用法**（两例都在**当前活跃卡**）：
`世界书控制_0708.js:4130` `(typeof SillyTavern !== "undefined") ? SillyTavern.name1 : "User"`
—— **只有对象级守卫** ⇒ 守卫通过但取到 `undefined` ⇒ 渲染 `"undefined: 内容"`；
`飞讯_0703.js:36` 走 `getContext().name1` + 兜底 `'{{user}}'` ⇒ 落到**未展开的宏字面量**。
**对照**：同文件的 `getTokenCountAsync` **有属性级守卫** ⇒ 缺席只静默降级 —— **这正是 `name1` 成为缺陷的原因**。

**修复（三处源码 + 2 条单测，全部单源）**：
`th-shim.ts` 快照类型加 `userName` · 帧内 `getContext()` 面加 `name1/name2` · 帧内**顶层**加 `name1` ·
`host-macro-bridge.ts` 的 `refreshHostMacroEnv` 加**可选就绪回调**（宏环境**异步水合** ⇒ 首帧拿不到用户名）·
`RpScriptHost` 快照并入 `userName` 并抽出 `pushContextSnapshotToFrames()` 单实现、就绪时**原地补字段 + 重推**。

**两处有意取舍（勿"顺手改"）**：① 就绪重推用**原地改字段**而非换新对象 —— `T-37` 依赖快照**引用稳定**
（卡对 `preset_settings_openai` 做 `!==` 身份比较）；② `hostUserName()` 缺省返回 **`undefined`，绝不返回 `''`**
（卡会把 `''` 当"用户名是空串"直接拼进文本）—— 负控用例钉住。

**验收**：`typecheck` 三段式 **0 错** · 新增单测 **2 条**（正控两面各断 / 负控严格 undefined）·
全量单测 **56 文件 / 1186 全绿** · 双架构 APK 重打 **v290 / v291** ·
**实机验收 7/7 PASS × 两组独立帧样本**（新增探针 `stage3-device/hb64/t72-name1-probe.mjs`：逐帧断言
① 顶层 `SillyTavern.name1` ② `getContext().name1` ③ 两面取值一致，三判据全 `"示例人设乙"`；**外加负控 `name3`**
必须两面缺席 ⇒ 证明探针能区分存在/缺席；探针还**逐字复读卡的两种取法**）；
**帧面签名差分** `[22,11,40,false]` → **`[23,13,40,false]`**（**+1/+2** 与改动面逐项精确对上）·
`stage4-regression` **21/21**。

⚠️ **过程中的坑（L70 第三次）**：在**模板串内**的注释写了反引号 ⇒ 终止模板串、`tsc` 报 20+ 条 `TS1443/TS1005`。
**模板串内一律用单引号。**（T-73 的实验脚本里**第四次**复现同一坑）

**顺带产出（T-46 决策的新量化）**：这 10 种缺席成员里**只有 `name1` / `uuidv4` 在宿主面有**
⇒ **投影（T-46）只能补回 2 种**，其余 8 种（含 6 个生成栈成员）**投影也补不上**，须宿主面补齐。

---

### T-73　🟡→🔴→✅ **`Choose workspace` 卡在 `Loading workspaces…` —— 心跳 64 判「慢/非缺陷」，**心跳 65 推翻**：实为可复现的启动竞态（已修为 T-76）**（心跳 64 定性，心跳 65 纠正）

**一句话**：这个文案与状态机**都在官方组件里**（`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:2660`
的 `picker.loading`，渲染条件 `:1166` 的 `workspaceSnapshot.phase === "pending"`，数据来自**订阅/流**）；
我方源码 **零命中**。历史观察窗口只有 **3 s**，而底层服务实测 **1.2–6.0 s** ⇒ **窗口短于耗时**，
"3 秒没出结果"**不能**推出"坏了"。

**定量**：我方 `POST /dsht-rp/rp/workspaces` = **978 / 995 / 924 ms**、**575,512 B**
（轻端点对照 `rp/home` 125 ms · `rp/build-info` 100 ms ⇒ 重端点差一个数量级属预期，**功能正常**）；
官方 `session/list`（页面内同源）= 首次 **6048 ms**，随后 1188–3629 ms。

**决定性实验**（`stage3-device/hb64/t73-boot-race.mjs`，`Page.reload` + 启动窗口内每 500 ms 采样，零写入）：
**未能复现** —— `Loading workspaces…` 在整段 150 s 窗口里**从未渲染**；按钮于 **+10.3 s** 出现、点击后立即出结果；
官方 `session/list` 从 **+3.4 s** 起即 `ok:true`，**全程 28 次采样零失败**（比 `skill §4.2` 记的冷启竞态好得多，
因为本轮是 **reload 不是冷启**）。

**判定**：**慢**（非坏）· **非我方缺陷** · **本轮未能复现"一直卡住"** ·
**不属 T-57 竞态族**（证据不足，本轮没覆盖真正冷启窗口）。

⚠️ 按 **L104**（无时序证据不得判"真的没发生"）：只能说"**在这一条时间轴上未复现**"，
不能反推"现象不存在"。

**留给下一轮定死它的判据**（详见 `stage3-device/hb64/T73-WORKSPACE-PICKER-TRIAGE.md` §5）：
① 必须**冷启**（`force-stop` + `monkey`）而非 reload；② 采样对象应是 **store 的 `phase` 本身**而非 DOM 文案
（文案是 `phase==="pending"` 的**派生显示**，两者可能同形 —— L103 同族）；③ 同时抓 `adb logcat` 官方侧错误；
④ 若确为竞态则**不在我方源码修**（合规红线），若为渲染性能才考虑我方 `rp/workspaces` 载荷瘦身。

---


**⬇️ 心跳 65 的纠正（推翻上面的判定）**


**心跳 64 的原判**（保留备查）：文案与状态机都在官方组件（`picker.loading`，渲染条件 `workspaceSnapshot.phase === "pending"`），
数据来自**订阅我方源码**；历史观察窗仅 **3 s** 而底层服务实测 **1.2–6.0 s** ⇒ 判「慢（非坏）· 非我方缺陷 · 本轮未能复现」。

**心跳 65 的纠正**：**T-73 自己在末尾登记了「留给下一轮的定性判据」，本轮照它执行，结论反转。**

⚠️ **旧判据为什么无效（L116）**：那 1.2–6.0 s 是在**连接已健康**的页面上测的服务耗时。
真出问题的页面上，`workspace.list` / `session.list` **根本没发出去**（`phase` 恒 `'pending'`）——
**服务快慢与症状无关**。测量对象错了。同理，「reload 未能复现」也不行：**必须冷启**（这恰是 T-73 自己写下的第 ① 条判据）。

**复现（照 T-73 判据 ①「必须冷启」）**：`poll-workspace-menu.js` 轮询 **20 次 × 3 s = 60 s**，
`role=status` 恒为 `Loading workspaces…`，菜单里除「Add workspace…」外**零工作区**；手动 reload 后**立刻**恢复 26 项。
**根因与修复** ⇒ 见 **T-76**。

**结论修订**：**不是「慢」，是一条可复现的启动竞态；触发因子在我方 `NodeService` 内，已修。**

---

### T-74　✅ **帧内两面都缺 `chatId` ⇒ 卡的角色绑定校验恒失败；补单一来源**（心跳 65）

**一句话**：基准里 `chatId` 与 `getCurrentChatId()` **本就是同一个表达式**（`st-context.js:131-133` ≡ `script.js:869`），
而帧内**顶层与 `getContext()` 两面都没有它** ⇒ 取到 `undefined`。**语料实证**：8 处用法 / 6 个文件，
**无属性级守卫**；当前启用的「示例卡二」预设用它做 `boundChatId` 绑定校验 ⇒ **恒失败**。`uuidv4` 同组（A 档：宿主面早有、帧面缺 ⇒ 同一门面两面不一致）。

**修复（单源）**：`th-shim.ts` 加 `dshtCurrentChatId()`（唯一来源，取快照 slug）与 `dshtUuidv4()`（`crypto.randomUUID` + Math.random 兜底）；
`buildStContextFacade()` 与顶层门面各挂一项；`getCurrentChatId()` 改调同一函数。

**验收**：`t74-chatid-probe` **7/7 PASS × 11 判据**（含负控 `chat_id` / `chatIdXxx` 两面必须 absent —— 基准全树 0 命中，**补它=制造假信息，L36**）；
签名差分 **`[23,13,40,false] → [26,16,41,false]`** = **+3/+3/+1** 与改动面逐项对上。

---

### T-75　✅ **`mainApi` 缺席 ⇒ 卡的闸门恒拒（功能完全不可用）**（心跳 65）

**一句话**：语料里卡的闸门写作
`'openai' !== SillyTavern.mainApi ? reject('当前 API 不是聊天补全…') : 'no_connection' === SillyTavern.onlineStatus ? reject(...) : <真实工作>`。
`mainApi` 原为 `undefined` ⇒ 第一道闸门 `'openai' !== undefined` = **true** ⇒ **立即 reject** ⇒ **该功能整段不可用**（不是降级）。

**判定与修复**：值域来自基准 `script.js:9106-9119`（`'kobold' | 'openai' | 'novel' | 'textgenerationwebui'`）；
本项目 RP 出站**就是** chat-completions ⇒ `'openai'` 是**唯一如实值**。单源常量 `DSHT_MAIN_API`（`dsht-plugin-shared/st-compat.ts`），
帧内两面 + 宿主面共 3 处引用。

⚠️ **有意不加** `onlineStatus`（L101：语义不能从名字推；其闸门方向是**反向**的 —— 缺席恰好**放行**，加了反而可能挡死）。**负控单测**钉住它必须缺席。

---

### T-76　🔴→✅ **首启「工作区选择器永久卡 `Loading workspaces…`」= 启动竞态（陈旧 token + 门控不感知就绪）**（心跳 65 发现并修复）

**一句话**：DSH 自己声明「`dsh web:` URL 行就是就绪信号；兄弟行（`/api` 属主）仍在挂载时不得触发」
（`deepseek-harness/packages/bundle/web-app/src/index.ts:249-256`）——**页面可服务 ≠ 网关就绪**，实测窗口 **20 s**。
落在窗口内启动的前端，连接 generation **一次性失败且不再重臂** ⇒ `phase` 永远 `'pending'` ⇒ 永久 loading。

**触发因子 A（我方 · 已修）**：`NodeService.onStartCommand` 里 `startPortProbe()`（主线程立即启动、每秒读 `dsht-token`）
**先于**后台线程里的「清旧 token」⇒ 探活线程读到**上一进程遗留**的 token 并发布 ⇒ MainActivity 立刻 `loadUrl`。
**两次实机实证**：发布值与上一进程 launchToken **逐字符相同**。

**修复（一处）**：清旧**上移到 `onStartCommand` 同步执行且早于 `startPortProbe()`** + `coldStart` 守卫。

**验收**（刻意用 install 触发哨兵 +1 = 重建首装宽窗口）：① 用 `T_old` 加载主框架 **0 次**（修复前必现）
② 就绪前零发布 ③ token 捕获晚于 URL 行 **46 ms** ④ `sessionController is unavailable` **0 次**；
端到端：应用**直接恢复上次 RP 会话**，卡死态**完全未出现**。

⚠️ **诚实边界（已于心跳 66 关闭）**：**因子 B** —— `MainActivity` 门控只认主框架 HTTP 状态与网络错误
（`:201-222` / `:745-761`），**不感知后端就绪**；页面一旦 200 即 `dshLoaded = true` 并停止重载 ⇒ 官方注释明说这是误用。
**✅ 心跳 66 已修完并实机验收**：文件通道放行条件改为
`readySignalSeen || stdoutSilent(≥90 s 零行) || failopen(≥300 s)`；未就绪只记 **held（可听）**不发布；
并**整段删除**了 v1 的 HTTP 就绪代理（实测比权威信号**早 40 s**，等于"看了一个错的就绪"）。
**验收**：负控 `held` ×1 / **文件通道放行 0 次**（修复前 1 次且早 65 s）/ 哨兵 loadUrl 0 / node 退出 0；
正控通过；构建期闸门 **A12**（正控 4/4 · 负控 3/3）。

证据全文：`stage3-device/hb65/HB65-T76-BOOT-RACE-EVIDENCE.md`（T-74/T-75 见 `HB65-T74-T75-EVIDENCE.md`）。沉淀 **L116 / L117 / L118**。
**因子 B 单独证据**：`stage3-device/hb66/T76-FACTOR-B-EVIDENCE.md`；沉淀 **L119–L122**。

---
### T-77　✅ **`updateMessageBlock` 缺席 ⇒ 卡的「流式预览/就地改写」路径抛 TypeError**（心跳 66 实现）

**一句话**：基准 `script.js:2587` 的 `updateMessageBlock(messageId, message, {rerenderMessage=true})`
是**同步 · 返回 `undefined` · 纯 DOM 重渲染** —— 找 `[mesid="N"]`，**未找到即 early-return**，
找到才改 `.mes_text` 并更新 reasoning/media，**完全不写状态**。成员绑定见 `st-context.js:237`。

**为什么是真缺陷（不是"可选增强"）**：语料里 **两处直接调用都没有 `typeof` 守卫** ——
- `梦鲸思客消息处理 2.4`：`n.mes = …` → `updateMessageBlock` → `await saveChat()`
- `格式补全 1.2`：150 ms 防抖的**流式预览**路径（其**最终提交**另走已桥接的 `setChatMessages`）

我方两处门面此前**都没有这个成员** ⇒ 卡直接 `TypeError` —— 而**基准绝不会抛**。

**修复（T-47 D 档 · 忠实实现 = 照抄那个恒为真的早退分支）**：
TH 脚本跑在 `about:srcdoc` 沙箱帧里，**帧内不存在任何聊天 DOM**（聊天 UI 在宿主页 React 侧）
⇒ `[mesid="N"]` **恒不存在** ⇒ 永久命中基准自己的 early-return 分支 ⇒
**正确实现 = 什么都不做并返回 `undefined`**（不提供 ⇒ TypeError；造替代 ⇒ 违反 L36 且流式路径会写放大）。
按 **L42** 出声，但**按名去重**（`warnFacadeDegraded` / `__dshtWarnDegraded`）—— 150 ms 一次，
逐条喊会淹掉日志。

**改动面（三处，必须同步 —— T-19）**：
`host-vendor.ts` `buildHostStContext` · `th-shim.ts` `buildStContextFacade` · `th-shim.ts` 顶层门面（`ctx.updateMessageBlock`）。
**单测 5 条**（宿主面存在/返回 undefined · 去重只喊一次 · 帧面两面各断 · 帧面去重 · **反控：不返回 true/Promise**）。
**沉淀 L123**（"恒为真的早退分支就是忠实实现"）+ **L124**（判有无实现要看门面对象字面量的键，不能 grep 计包）。

**同类未评（≠ 已做）**：`messageFormatting`（1 文件 3 次，返回 HTML 字符串用于卡自己的总结层弹窗）——
需单独问死「复用我方正则/格式化管线是否等价」，**本轮未动**。

---

### T-78　✅ **世界书关键词正则已加安全防护**（2026-09-12 借鉴 dsh-NextTavern 发现；**同日落地 + 实测反控**）

- **来源**：审开源项目 **dsh-NextTavern**（`github.com/a86582751/dsh-nexttavern`）时发现的**我们自己的缺口**。
  它有一个 39 行的 `preset/lib/bounded-regex.js`，专治用户提供正则的 ReDoS；**我们没有任何对应物**。
- **我方现状（已核实，是真缺口）**：[trigger.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/lore/trigger.ts#L124-L137)
  的 `keyToPattern` 直接 `new RegExp(...).test(text)` —— **无超时 / 无线程隔离 / 无长度上限 / 无 flags 白名单**。
  `matchPrimary` 的 `catch` 只挡「非法正则」，**挡不住指数回溯**（`/(a+)+$/` 对长输入）。
- **危害**：世界书条目来自**用户导入的卡/世界书**（不可信输入）。一条写坏或恶意的 `use_regex` 关键词
  会让每轮触发的关键词匹配**在事件循环里死循环** ⇒ 整机卡死，且**零日志线索**（L42 家族）。
- **借鉴的做法（其 `bounded-regex.js` 全部要点）**：
  | 维度 | 它的取值 |
  |---|---|
  | 执行环境 | `worker_threads`，编译 + 匹配都在 worker 内 |
  | 超时 | **250 ms 硬超时**（夹紧 10–500），超时即 `worker.terminate()` |
  | 限额 | 规则 ≤128 · 文本 ≤32768 · 单 pattern ≤512 |
  | **flags 白名单** | `/^[imsu]*$/` —— **从根上排除 `g`/`y`/`d`/`v`** |
  | 并发 | ≤4，超了返回 `busy` |
  | 资源上限 | `resourceLimits: { maxOldGenerationSizeMb: 24, stackSizeMb: 2 }` |
  | **失败可观测** | 返回 `{ok, reason}`，向上暴露成 `regexStatus: regex.ok ? 'ready' : regex.reason` |
- **我方实施要求（不只照抄，要接进我方语境）**：
  1. 落点 = `lore/trigger.ts` 的 `keyToPattern` 调用链（世界书主/副关键词 + 递归触发）。
  2. **失败必须出声**（L42）：降级为"该关键词不匹配"时**留痕**（按 `条目id:reason` 去重，不逐条刷屏）。
  3. ⚠️ **平台差异（心跳 71 已实测，goal 明确要求的前置）**：在**设备**上跑 `libnode.so` 实测 ——
     ```
     RESULT: {"version":"v26.4.0","platform":"android","arch":"x64",
              "workerThreadsAvailable":true,"workerMessage":"pong","workerMs":133}
     ```
     ⇒ **安卓 node 支持 `worker_threads`**。但我方最终选**同步防护组合**，
     理由**不是"不可用"**而是**契约约束**：`triggerWorldInfo` 是**同步函数**且被
     **browser bundle** 消费（`import/browser-entry.ts` → `assets/app.js`，WebView 内**无** `node:worker_threads`）
     ⇒ 改 async 会破坏既有契约（`verify-bundle.cjs` 以同步方式消费返回值）。
     **选型依据如实记录**：这是「选了同步路线」，不是「退而求其次」。
  4. **反控（必须真跑）**：构造 `/(a+)+$/` + 长 `aaaa…b` 输入 → 防护停用时**实测 8804 ms**；
     防护生效时整个测试文件 **16 ms**（差三个数量级）。
- **验收**：单测（正常正则仍正确匹配 + 恶意正则被挡 + 失败可见）+ **设备侧 `worker_threads` 实测**（见上）。

---

### T-79　✅ **卡正文防冒充处置已落地**（2026-09-12 借鉴 dsh-NextTavern 发现；**同日落地 + 三轮反控**）

- **来源**：同上。它有 `fenceCardContent`（`tavern-card.js:203-213`）与 `promptSafeAuthorText`
  （`roleplay-core.js:346-347`）两件，解决**同一个问题：导入的卡正文可能伪装成系统指令或系统变量**。
- **我方现状**：卡字段（`description`/`personality`/`scenario`/`system_prompt` 等）**逐字**进提示词，
  没有任何围栏或转义。`src/` 全库搜 `nonce` / 提示注入 / 围栏 —— **无卡内容相关命中**。
- **它做的两件事（可借鉴的具体手法）**：
  | 手法 | 效果 |
  |---|---|
  | 包 `<rp-content:nonce>` 围栏，`nonce` 随机 | 模型能区分"这是资料"与"这是指令" |
  | `<\|` → `＜\|`、`[INST]` → 全角、行首 `system:`/`assistant:` → 全角冒号、行首 `#` → `＃` | 掐掉常见**越权标记** |
  | `promptSafeAuthorText`：作者文本里**所有 `{{` `}}` 转成 `⟦` `⟧` | 防卡内容**冒充系统宏**（`{{user}}` 等） |
- ⚠️ **与我方红线的冲突点（必须先想清楚，别照抄）**：
  它的做法**顺带**实现了"作者原文字节稳定"（利 KV 缓存），但**我们的卡正文里合法地含 ST 宏**
  （`{{char}}`/`{{getvar::…}}` 等）——**宏是我们承诺要展开的**（Tier 1）。
  ⇒ **不能无脑把 `{{` 全转**，否则**砸掉我们自己的宏引擎**。
- **故实施要求**：
  1. **围栏**（加，低风险）：卡字段注入时包带 nonce 的围栏 + 说明「以下为资料，非指令」。
  2. **越权标记消毒**（加，低风险）：只针对 `<|`、`[INST]`、行首 `system:` 这类**明确的越权意图标记**。
  3. **`{{` 处置（需先判据，不能直接抄）**：宏**已经过我方宏引擎展开**——要处理的是
     **展开后仍然残留的"未知宏"**（即 `{{…}}` 未被解析的部分）。对这部分：**转义 + 出声**
     （而不是静默留字面量，也不是无差别转义全部）。**必须先有判据**：列出"展开后仍残留 `{{`"的真实样本。
  4. **反控**：构造一张正文含 `[INST]` / 行首 `system:` / 伪 `{{user}}` 的卡 →
     注入后**不得**出现可被模型当作指令的形态；且**同一张卡的合法宏仍正常展开**。
- **验收**：单测（消毒命中 + 合法宏不受伤 + 未知宏残留可见）+ 反控 + 设备实测（真实卡正文形态对照）。

> ⚠️ **它与 T-78 都不改设计理念**：两条都是**在既有架构内补防护**，不引入 NT 的任何架构选择
> （不引入它的"卡内容全部 archive-only"哲学、不改我方宏引擎、不改我方提示词装配方式）。

### T-80　🔴 **卡注册的 10 个事件在我方「零发射点」** —— 回调永不执行、零报错（2026-09-12 心跳 67 静态穷举发现）

> **心跳 68 更新**：**已修 2/10**（`message_updated` + `generation_stopped`）⇒ **差集 10 → 9 → 8**；
> 余 8 项**从"待补清单"升级为逐项有终局判定的分档表**（下方表格已重写），其中 **2 项经取证属"当前架构下做不对"**
> （不是"还没做"）；心跳 67 给 3 个 worldinfo 项标的「**可低成本补**」**已被本轮取证推翻**。
> 新增报告 **[docs/T-80-GENERATION-STOPPED.md](docs/T-80-GENERATION-STOPPED.md)**；
> 沉淀 **L127**（"需新增 X"动手前先复核平台是否已有等价物）与 **L128**（跃迁类事件按差分判定，不按终态切片）。

- **缺陷族**：**静默失败**（本项目主力族）。卡写 `eventOn(tavern_events.X, cb)` ——
  我方 `tavern_events` 表**有**这个键（82 项完整）⇒ **注册成功、零报错、零 warn**；
  但我方**从不 emit 这个名字** ⇒ `cb` **永不执行**。功能死了，日志干净。
- **发现方法（新，可复用到其他"面完整性"问题上）**：不再"等卡报错 / 逐墙试错"（这类问题**不报错**，所以 20+ 心跳从未发现），
  改为 **L43 式一次性静态穷举** —— 新闸门 `scripts/audit-card-event-surface.mjs`：
  ① 注册面 = 扫设备真实语料（54 脚本 / 7.3 MB）的 `tavern_events.X` / `iframe_events.X` /
  `event_types.X` / `eventTypes.X` / `eventOn('字面量')` / `eventSource.on|once|makeFirst|makeLast('字面量')`；
  ② 发射面 = 扫我方源码的事件值字面量，**剔除三张常量表自身的定义块**（否则表会"自证已发射" ⇒ 82 项永远全绿 = **假绿**）；
  ③ 差集 = 候选缺口；④ 每项回**基准**取证「真 ST 会不会 emit」以判该不该补（**L36**）。
- **结果**：注册 **22** / 发射 **17** / **差集 10**（**全部经基准对照 = 基准有 emit ⇒ 真缺口**，非"我方多报"）；
  ~~我方表里没有的常量 **0**（⇒ 不存在"值恒 `undefined`、注册到 `undefined` 键"的更坏形态）~~。
  🔴 **心跳 73 推翻此断言** —— 它只对**三张 ST 表**成立；MVU 框架的第 4 个命名空间 `Mvu.events`
  shim **一个常量都没有**，卡却照常注册 ⇒ 正是该"更坏形态"。见 **T-81**。
- **逐项基准取证（`file:line` + 参数形状）与分档**见 **[docs/T-80-CARD-EVENT-SURFACE.md](docs/T-80-CARD-EVENT-SURFACE.md)**（心跳 67）
  与 **[docs/T-80-GENERATION-STOPPED.md](docs/T-80-GENERATION-STOPPED.md)**（心跳 68，含余 8 项重新分档）。**四档（心跳 68 版）**：
  | 档 | 项 | 处置 |
  |---|---|---|
  | ✅ 已修（2/10） | `message_updated` | 载荷 `messageId` 与基准同形（`script.js:8277/8371`）；语义**编辑 ⊂ 更新**；在既有 `message_edited` 桥上同投（**swipe 不发** —— 基准 swipe 只走 `MESSAGE_SWIPED`，多发违反 L36）。差集 10 → 9。 |
  | ✅ 已修（2/10） | `generation_stopped` | 基准 `script.js:5559` **无参**（零形状风险）；判据 = 节点态 `running → interrupted` **跃迁**（DSH `core/agent-loop/src/agent.ts:355` 只在 `signal.aborted` 写 `interrupted:true`；`core/session/src/types.ts:273` 明文 = 回合被取消）。**单命名空间**（TH `iframe_events` 不含该项）。**实机 8/8 PASS（含 2 负控）**：`stage3-device/hb68/`。差集 9 → 8。 |
  | 🔴 **A 档 · 结构性不可实现**（须判「不做 + 明示降级」） | `worldinfo_scan_done`；`world_info_activated` 的**干跑消费面** | ⚠️ **心跳 67 的"可低成本补"标注已推翻**。`worldinfo_scan_done` **不是纯通知**：基准 `world-info.js:5056` 在 `while` 扫描循环内发射，紧接 `if (args.state.next !== scanState) scanState = args.state.next`，原注释明文 "fields are allowed to be changed by listeners"（同批被回读的还有 `budget`/`recursionDelay`/`activated.text`）⇒ 这是**同页同步可变回路**，驱动 ST 的**递归世界书**。我方扫描在服务端 cordis 层、卡在 WebView 帧，**结构上无法同步回写** ⇒ 只投只读快照 = 卡以为安排了递归而实际没有（L126 的②，**比不投更坏**）。语料 `世界书控制_0708.js:4140-4159` 同样是**干跑同步收集**（调 `getWorldInfoPrompt(mock,…)` 期间同步收事件取 `uid`）。 |
  | 🟠 **B 档 · 可做但必须先定形状** | `world_info_activated`（观测面）· `preset_changed` · `character_message_rendered` | ① `world_info_activated`：基准载荷 = `Array.from(allActivatedEntries.values())` = **完整 WI 条目**（`world/uid/comment/key/content/constant/position/depth…`）；我方 `/dsht-rp/trace`（`index.ts:6334`）**已暴露**且 UI `rpApi`（`rpc.ts:104`）**可直接拉**，但 `:4338` 把 `activatedEntries` 收成 `{comment,reason,position}` **三字段**，观测型消费者（`示例预设 V17.1:55449` 的 `ssLogNativeWorldInfoEntries`）实际要读 `world`/`uid`/`comment` + `constant` 判蓝绿灯 ⇒ **精简形不够**，须先把 trace 载荷扩到完整条目（改动落 `dsh-plugin/index.ts`）。② `preset_changed`：`apiId ∈ {openai,kobold,novel,textgenerationwebui}` 我方非其一 ⇒ 乱填 = 从"不回调"变成"回调里分支不命中"；**须先全语料普查卡的消费端再定值**（已知样本 `示例预设:30981` **不读载荷**，但样本不足）。③ `character_message_rendered`：语义"渲染后"而我方脚本帧**恒无聊天 DOM**（T-77 已证）⇒ 无真实时机，且 `type` 取值未定。 |
  | 🟢 **C 档 · 通道已存在，缺的是"时机"定义** | `worldinfo_entries_loaded` | 载荷 `{globalLore, characterLore, chatLore, personaLore}`。**读取面已就绪**：facade 已有 `/worldbook/list`·`/worldbook/get`（`dsht-plugin-tavern-helper/index.ts:647-654`）⇒ **不需要新通道**。缺的是"这四组的等价来源"与"何时算加载完成"—— 基准在**生成期**（`checkWorldInfo()` 内）发射，挪到开局期即违反 L36 的"时机也要对"。 |
  | 🔴 **D 档 · 需宿主侧对象** | `chat_completion_settings_ready` · `generate_after_data` · `GENERATION_AFTER_COMMANDS` | 同 **D-4/D-6 族**约束（参数是宿主侧 `generate_data` 句柄 / 无该钩子面）。 |
- **核心纪律（为什么不是一次全补）**：补事件有**两种失败方式**，第二种更坏 ——
  ① 不补 = 回调不执行（当前状态，干净的缺失）；② **补了但形状/时机不对 = 回调执行了却拿到错数据**（静默做错事）。
  故只实施**形状与时机都能逐字对齐基准**的项。
- **闸门与基线**：`scripts/card-event-surface-baseline.json` 逐项登记已知未修项 + 基准取证 + 原因。
  缺集 ⊆ 基线 ⇒ **exit 0**（防**新增**缺口）；表外新缺口 ⇒ **exit 1**（红线）；修掉 ⇒ 提示"已收敛，请从基线删除"。
  **避免恒红闸门**（项目历史教训：`tsc -b` 2546 错 = 恒红 = 没有门）。
  **正控 `--selftest` 覆盖六维**（注册面 6 形态 / 三表条目数 82·6·104 / 表定义剔除 / 发射面负控 / 差集口径 / 白名单正负控）；
  **首版正控当场抓出两个实现缺陷**（`eventTypes` camelCase 形态未支持；白名单测试入参写错）⇒ 不跑正控会给出"看着干净"的假结论（**L44**）。
  **真实数据负控**：临时从基线删 `generation_stopped` ⇒ `表外新增 1` / **exit 1**；还原 ⇒ **exit 0**。
- **诚实边界**：① 语料里另有 `eventOn(event, cb)` / `eventOn(${…})` / `getButtonEvent(...)` 等**动态实参**注册点，
  本工具不产出具体事件名（不猜）⇒ 「22 个」是**下界**；② "零发射点"是静态结论，我方发射面允许变量实参
  ⇒ 若某事件只经动态通道发射会被误报（本轮 10 项已逐项人工复核，全仓 grep 该字面量仅命中常量表定义行 ⇒ 无误报）；
  ③ 已修的两项**均已实机验收**（`message_updated` 心跳 67 探针 7/7；`generation_stopped` 心跳 68 探针 **8/8 含 2 负控**）；
  ④ `generation_stopped` 另有三条**有意保留的保真缺口**：DSH 在「拦截时零内容」下不写 `assistant/message` ⇒ 无节点 ⇒ 投不出
  （ST 是无条件发）· 空闲时点停止我方不发（ST 也发）· `interrupted` 覆盖 `signal.aborted` 的**全部来源**而非仅用户点停止。
  三条均记录在 `docs/T-80-GENERATION-STOPPED.md` §八，**未静默**。


### T-81　🔴 **MVU 命名空间（`Mvu.events`）此前完全不在闸门覆盖内 + shim 缺 5 个事件名常量** —— 卡回调静默死注册（2026-09-12 心跳 73 发现并修复注册侧）

> 报告 **[docs/T-81-MVU-EVENT-NAMESPACE.md](docs/T-81-MVU-EVENT-NAMESPACE.md)**；
> 上游 = T-80（本轮发现其**枚举器漏掉一整个命名空间**，判据 = **L44**）；沉淀 **L134**。

- **是什么**：T-80 的闸门只扫 **3 张 ST 表**（`tavern_events`/`iframe_events`/`event_types`），
  而 MVU 框架自带**第 4 个命名空间 `Mvu`**（权威契约 = JS-Slash-Runner `@types/iframe/exported.mvu.d.ts:54-118`），
  卡同样在它上面注册：`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)`。shim 的 `Mvu.events` **0 个常量**
  ⇒ `evt === undefined` ⇒ `String(undefined)` 注册到 **`'undefined'` 键** ⇒ 注册"成功"、零报错、**回调永不执行**。
  这正是 T-80 报告断言"不存在"的那种更坏形态（**已推翻该断言**）。
- **语料取证**：`悬浮球.js:689-690`（有存在性守卫，语义 = 变量更新后重渲染）·
  `剧情逻辑_0703.js:1266`（**无守卫**，handler **就地改 `vars`** = 否决/回滚语义）· `剧情逻辑_0605.js:1011`（旧副本 `b7s7x3`）。
- **修 1（注册侧，已落地）**：`th-shim.ts:2303-2307` 补齐契约声明的 5 个常量，**逐字照抄** ——
  ⚠️ `VARIABLE_INITIALIZED` 的值在上游是 `'mag_variable_initiailized'`（**上游拼写错误**），
  必须照抄；"修正"它 = 与真 MVU 不一致 ⇒ 同样永不触发且更难查（**L134**）。
- **修 2（加固，已落地）**：`evtKey()` 收口原 **12 处** `String(evt)` —— 语义**不变**（仍注册到 `'undefined'` 键，L36），
  但**出声**（一次性 `console.warn`，L42）。把"静默死注册"变成**可听**。
- **修 3（降级明示，已落地）**：`warnDeadRegistration()` —— 注册我方**结构性不发射**的 `mag_*` 时打一次性 warn 说明原因
  （同 `unsupportedStub` 的"已出声 stub"先例）。
- **判定：`VARIABLE_UPDATE_ENDED` 本体**不做**（明示降级，已登记进基线）** —— **不是懒得补，是补了更坏**（L126②）：
  基准语义是**同页同步可变回路**（handler 就地改 `vars` 并期望写回 = 全部意义）；我方变量更新在**服务端 cordis 层**，
  帧内只有只读快照 ⇒ 投副本 = 让卡以为拦截成功而实际没有。同族 = `worldinfo_scan_done` / `world_info_activated` 干跑面（T-80 A 档）。
- **闸门扩展（防再退化）**：`audit-card-event-surface.mjs` 3 张表 → **4 张**（新增 `parseMvuEvents`、
  `Mvu.events.X` 注册面、MVU 常量块剔除、判定口径按**基准事件表成员资格**修正、`--selftest` 同步扩展）。
  实跑：注册 **22 → 23**、差集 **8 → 9**（新增即该项，登记后 `基线内 9 · 表外新增 0` / **exit 0**）
  —— **修好枚举器后该类立刻现形**，反证它此前确实"看不见"。
- **反控（真跑）**：临时删常量 ⇒ 新单测 **7/10 转红**；还原 ⇒ **10/10 绿**。
- **旁登记（不改）**：`Mvu.parseMessage` 形状偏差（契约 `(message, old_data) => Promise<MvuData>`，我方 `(text) => 补丁数组`）
  —— 全语料 **0 消费者** ⇒ 改了无法验证，登记待首个消费者；
  `Mvu.setMvuVariable`（语料 1 处、**不在已锚定契约内**、卡侧有 `typeof` 守卫）⇒ **不补**。
- **验收**：`typecheck` 三段式 **0 错** · 单测 **62 文件 / 1339 项**（+10）· 闸门 `--selftest` 通过 / 实跑 exit 0 · 设备实测见 `stage3-device/hb73/`。


### T-82　🔴 **楼层帧（`.dsht-rp-message-frame`）内 `eventOn(...)` 注册成功但永不回调** —— 事件只投脚本帧（2026-09-12 心跳 74 实机验收中挖出并修复）

> 报告 **[docs/T-82-GUEST-FRAME-EVENTS.md](docs/T-82-GUEST-FRAME-EVENTS.md)**；
> 触发场景 = **T-80H 探针首轮 11/16 的一次「假 FAIL」**（判据 = **L136**）；沉淀 **L136 / L137 / L138**。

- **是什么**：`SessionRuntime.emitSessionEvent()`（`RpScriptHost.tsx:923`）只遍历 `this.frames`（**脚本帧**），
  而**楼层 guest 帧**在**另一张表** `this.guestFrames` 里 ⇒ 楼层 iframe 内写 `eventOn(tavern_events.X, cb)`
  **注册成功、零报错、回调永不执行**（项目主力缺陷族「静默失败」的新一员）。
- **我方自身的不一致（旁证）**：同文件 `pushContextSnapshotToFrames()`（`:901-913`）的注释**明文写着**
  「只推脚本帧会让楼层帧永远停在 `__dshtContextPending` 空壳（**实机实证**）」，
  并把**快照**同时推给脚本帧与楼层帧 —— **事件面却只推脚本帧**。
- **基准取证（三条，非推断）**：① `_eventOn` 在 `TavernHelper._bind` 内（`src/function/index.ts:221`）；
  ② 把 `_bind` 逐项 **bind 到该 iframe 的 window**（`key.replace('_','')`）的 `src/iframe/predefine.js`
  **两处都注入** —— `src/panel/script/iframe.ts:12`（脚本帧）**与** `src/panel/render/iframe.ts:94`（**消息渲染帧**）；
  ③ `_eventOn` 直接 `eventSource.on(...)`（`src/function/event.ts:44`），**共用同一实例** ⇒ **与帧类型无关**。
  ⇒ 基准里楼层渲染帧是**一等事件消费者**，我方缺它（违反 **L36「不能少」**）。
- **修法（刻意与脚本帧完全对称）**：`guestReady` 就绪门 + `pendingGuestEvents` **有界队列（上限 50，与脚本帧同口径）**
  + 在**既有**的 guest `{th:'status',phase:'running'}` 握手点（`:540`）标记就绪并补投。
  该握手点由 shim **尾模块** `__dshtThReady()` 发出（`th-shim.ts:2693` / 注入模板 `:2931`）
  ⇒ **此刻卡脚本已执行完、监听器必然已注册** ⇒ 零竞态。
- **⚠️ 刻意不用 `pushContextToGuest` 的 4 次重试梯子 `[0,400,1200,2800]`（判据 = L138）**：
  快照**幂等覆盖**、**事件不幂等**（卡按 `MESSAGE_RECEIVED` 计数会 **×4** = 违反 L36「不能多」）。
  故事件路径**不出现任何 `setTimeout`**，由单测**承重反控**钉死。
- **单测**（`tests/th-guest-event-delivery.spec.ts`，**13 项**）：A 分支存在 / 就绪门 / 入队 / 上限 50；
  B 握手点标记 + 补投 + 不顶掉既有快照补推 + 投后清队列；C **承重反控**（正控：context 梯子确实存在 /
  事件路径**无** `setTimeout`）；D `releaseGuestFrame` 与 `destroy` 不留悬挂队列。
- **反控真跑 5/5 全红**（`stage3-device/hb74/reverse-guest-tests.mjs`）：R1 删投递循环 · R2 去掉就绪门 ·
  R3 改用重试梯子 · R4 握手点不标记 · R5 未就绪丢弃。
  ⚠️ **反控自身踩坑（→ L137）**：R1 首版用 `String.replace` 改到了 `pushContextSnapshotToFrames`（`:911`）里
  **逐字相同**的那一行 ⇒ 被测函数一个字没动、**空转还报绿（exit 0）**；修法 = 按**方法体作用域**打补丁。
- **实机验收**：`stage3-device/hb74/t82-guest-event-probe.js` **10/10 PASS ×2**
  （含 3 负控：楼层帧内不存在的成员必须缺席 / 脚本帧不得翻倍 / 监听非恒真）；
  **改前 / 改后同断言对照**（同设备同会话）：楼层帧收 `settings_updated` **`n=0` → `n=1`**、
  预设两条 **`[]` → `["AFTER","PRESET:{apiId,name}"]`**。闸门 `audit-card-event-surface.mjs` `--selftest` 通过 / 实跑 exit 0。
- **产物核验**：`lib/client.js` mtime **23:57:44 > 源码 23:56:38**；含 `pendingGuestEvents`×7 ·
  `flushPendingGuestEvents`×2 · `guestReady`×5；**staging == 设备 `profiles/web` 同 md5 `f968e44d…`**；
  双架构 APK 内嵌载荷双向命中。APK **x86_64 v314（196,947,819 B，已装机）/ arm64 v315（128,475,680 B）**。
- **诚实边界**：① 本轮只覆盖 `.dsht-rp-message-frame`（`guestFrames` 现仅此一来源；机制按表遍历、
  不硬编码类名 ⇒ 将来其他 guest 来源自动覆盖）；② `guestReady` **不回退**（guest 运行期崩溃但帧元素仍在 ⇒
  仍被视作就绪、事件静默丢弃）—— 基准同样无"消费者死亡"检测 ⇒ **按 L36 不引入基准没有的机制**，如实登记；
  ③ 未走"用户手点预设下拉框"的完整 UI 路径（走的是 React 受控 `<select>` 的 `change`，属产品自身路径）。

---
## 7. 长尾 / 观察项（P3，不阻塞发布）

| # | 项 | 说明 |
|---|---|---|
| T-64 | ✅ **新会话第 2 轮陈旧快照副本**（心跳 61 已修） | 见上方完整条目。根因 = 去重**触发器自指短路**（`dupSigs === 0` 早退，恰好挡掉 `freshSigs` 这条本该生效的判据）。已抽纯函数 `decideShadowTrigger` + 补第三条判据 `freshStaleSigs`，负控 2 条转红，实机第 2 轮 **0 重复组** |---|---|---|
| T-65 | ✅ **「UI 新建的会话」致 app 冷启无限 crash-loop**（心跳 61B 已修） | 见上方完整条目。三层链 = `/rp/home` 非规范路径形态（触发源）+ 修复器硬编码 `session.jsonl` 致**半修复态**（②）+ 插件树加载期抛错（后果）。已修 + 新闸门 `audit-cwd-projectkey.mjs`（不变量审计 85/85） |
| T-67 | ✅ **壳侧 pre-boot 静态预检**（心跳 61B 提出，**心跳 62 落地 + 设备四段闭环**） | 见上方完整条目。做法 = `NODE_OPTIONS=--import file://…/dsht-preflight/lib/index.js`（官方源零修改）+ 纯文件扫描 + `rename` 搬正（目标冲突则隔离到 `sessions/` 之外）+ 反控闸 `DSHT_PREFLIGHT_DISABLE=1`；新增构建断言 **A8/A9** |
| T-68 | 🆕 **运行期移动 `sessions/` 顶层 project 目录 ⇒ 下一次 reload 打死 node**（心跳 62 顺带定性） | 见上方完整条目。根因 = 官方 `listProjectDirs` 有 ENOENT 守卫、`listSessionDirs` **没有**，而 `Fiber._reload` 路径无 catch。**不改官方源**（合规红线）⇒ 登记为**上游缺陷候选** + 我方纪律「`sessions/` 顶层运行期只读」。**已核查不影响出货**（`repairSessionCwds` 只动会话目录，project 目录仍存在） |
| T-63 | ✅ **卡脚本的 4 个 ST 内部模块已全部提供**（心跳 67 落地+实测） | 四个端点全 200（修复前全 404）；卡的 4 条静态 import 全部解析成功；设备实测 `displayVersion`/`utils`/`presetManager`/`sendOpenAIRequest` 四组语义全对；页内异常 0。归入 **§6.5** |
| T-78 | ✅ **世界书关键词正则安全防护**（2026-09-12 落地） | 单源 `lore/safe-regex.ts`（pattern 长/flags 白名单/危险模式静态拒绝/文本截断四道闸门 + 降级出声）。**实测反控**：停用时恶意输入 **8804 ms** vs 生效时 **16 ms**。⚠️ 静态启发式是保守子集（拦不住多项式回溯），已在代码头注写明边界 |
| T-79 | ✅ **卡正文防冒充处置**（2026-09-12 落地） | 单源 `dsht-plugin-shared/card-fence.ts`：nonce 围栏（抗伪造闭合）+ 越权标记消毒；**残余 `{{` 实测 55 处**（非罕见）；两处注入点收敛唯一漏斗；三轮反控（1/8/2 条转红）。⚠️ 未做 `#` 标题消毒（会打散正常 Markdown，理由已写进代码） |
| T-80 | 🔴 **卡注册的 10 个事件在我方「零发射点」**（心跳 67 静态穷举发现；**心跳 68 已修 2/10**） | 见上方完整条目。`eventOn(tavern_events.X)` **注册成功但永不触发**（零报错 = 静默失败族）。新闸门 `audit-card-event-surface.mjs`（正控六维 + 真实负控 + 基线白名单防恒红）。**差集 10 → 9 → 8**（已修 `message_updated` / `generation_stopped`，后者实机 **8/8 PASS**）；余 8 项**全部有终局分档**（A 结构性不可实现 2 · B 需先定形状 3 · C 需定义时机 1 · D 宿主侧对象 3），逐项登记在 `card-event-surface-baseline.json`（附基准 `file:line` + 原因），**未静默放过**。报告 `docs/T-80-CARD-EVENT-SURFACE.md` + `docs/T-80-GENERATION-STOPPED.md`。**心跳 74 续**：闸门枚举面**三处扩展**（① 动态别名绑定形态 `const te = getFn('tavern_events') \|\| tavern_events` —— 语料 `_示例卡二_ V17.1:55366` 整批原来看不见；② 🔴 **剔除注释**：`extractEmissions` 原先用 `text.includes(...)` 判发射，**注释里的字面量同样命中** ⇒ 假绿；修完当场暴露被掩盖的真缺口 `chat_completion_prompt_ready`；③ 可被其它工具 import 复用 + `--selftest` 扩到 14 项断言）。**注册面 23 → 27**（新现形 4 项真缺口），**又修 3 项**（`preset_changed` + `oai_preset_changed_after`（`openai.js:6825-6826` 顺序逐字对齐）· `settings_updated`（只在**卡发起**的两条落盘路径投递，**不**在 seed 分支 ⇒ L36 时机）），**再登记 6 项**「不做 + 明示降级」。**当前闸门态：注册 27 / 发射 19 / 差集 11（基线内 11 · 表外新增 0）/ exit 0**；T-80H 实机探针 **16/16 PASS ×2** |
| T-81 | 🔴 **MVU 命名空间（`Mvu.events`）不在闸门覆盖内 + shim 缺 5 个事件名常量**（心跳 73 发现并修复注册侧） | 见上方完整条目。T-80 的枚举器只扫 3 张 ST 表，**漏掉整个 `Mvu` 命名空间**（L44）；shim 的 `Mvu.events` **0 常量** ⇒ `eventOn(Mvu.events.X, cb)` 注册到 **`'undefined'` 键** = 静默死注册（T-80 断言"不存在"的更坏形态，**已推翻**）。**已修**：补齐契约 5 常量（含上游拼写错误 `mag_variable_initiailized`，逐字照抄 · **L134**）+ `evtKey()` 收口 12 处转换并**出声**（L42）+ `warnDeadRegistration()` 明示降级。**判定 `VARIABLE_UPDATE_ENDED` 本体不发射**（消费端 = 同页同步可变回路，跨层无同步回写 ⇒ 补了更坏，L126②），已登记基线。**闸门 3 表 → 4 表**（含正控扩展）；实跑注册 22→23 / 差集 8→9→基线内 9 / exit 0。反控：删常量 ⇒ 新单测 7/10 转红。报告 `docs/T-81-MVU-EVENT-NAMESPACE.md` |
| T-82 | 🔴 **楼层帧（`.dsht-rp-message-frame`）内 `eventOn(...)` 注册成功但永不回调**（心跳 74 实机验收中挖出并修复） | 见上方完整条目。`SessionRuntime.emitSessionEvent()`（`:923`）只遍历 `this.frames`（脚本帧），**楼层 guest 帧在另一张表 `guestFrames`** ⇒ 静默失败（`pushContextSnapshotToFrames` 早已"脚本帧+楼层帧一起推"，**事件面却只推脚本帧**，自相矛盾）。**基准取证**：`predefine.js` 把 `TavernHelper._bind`（含 `_eventOn`）bind 到该 iframe window 并注入**脚本帧（`script/iframe.ts:12`）+ 消息渲染帧（`render/iframe.ts:94`）两处**；`_eventOn` 直接 `eventSource.on(...)` ⇒ **与帧类型无关**。**修法刻意与脚本帧对称**：`guestReady` 就绪门 + 有界队列（50）+ 在既有 guest `running` 握手点补投；**刻意不用** context 的 4 次重试梯子（事件**不幂等**，会 ×4 ⇒ L36「不能多」，沉淀 **L138**）。单测 13 项 + **反控 5/5 全红**（其中 R1 首版空转还报绿 ⇒ 沉淀 **L137**）。实机 **10/10 PASS ×2**；**改前/改后同断言对照：楼层帧 `n=0 → n=1`**。报告 `docs/T-82-GUEST-FRAME-EVENTS.md` · 沉淀 **L136/L137/L138** |
| T-62 | 🆕 **`src/*/lib/*.js` 是「孤儿派生产物」**（心跳 59 发现） | `src/<plugin>/lib/index.js` 受版本控制、且历史提交里**与源码成对更新**（如 `3ffc1f9` 同时改 `src/dsh-plugin/index.ts` 与 `lib/index.js`），但**逐行核查所有构建脚本后确认：无任何路径消费它们** —— `build-plugins.sh:build_node_plugin` 是**直接从 `src/<pkg>/index.ts` 编译到 staging**（`$NM/<pkg>/lib/index.js`），`build-wb.sh` 同理；唯一例外是 `src/dsht-plugin-mobile/lib/index.js`（被 `build-plugins.sh:96` 拷贝）与 `src/dsht-rp-ui/lib/client.js`（由 `build-rp-ui.mjs` 生成并下游消费）。<br>⇒ 现状是**第三种状态**：既没被 `.gitignore`，也没被生成流程维护 —— `src/dsht-plugin-mvu/lib/index.js` 自 09-08 起陈旧至今。**且不可逐字节复现**（同源码两次构建字节数不同：882,361 vs 884,675 B，L52）。<br>**故本轮有意不重建**（重建只制造无意义 churn、且无收益）；**建议**：要么全部 `.gitignore` 掉，要么明确纳入构建。属 T-25 大扫除范畴。**已核验：不影响出货** —— APK 内插件取自 staging，本轮已三层核验新鲜。 |
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
- 卡自带外部脚本自身的**适应问题**（保留观察）
  ⚠️ **边界（2026-09-12 澄清，别误读）**：本条**不覆盖** §6.5 的三族。**平台侧该做的基础设施必须做** ——
  即"让卡的脚本能跑起来所依赖的 ST 标准面"（`/version`、`/script.js`、`/scripts/**`、
  `#saved_regex_scripts` 锚点、`extension_settings.regex`、`renderExtensionTemplateAsync`）**属 Tier 1，必须实现**。
  本条仅指**卡脚本自身写的业务逻辑有问题**（如从 CDN 拉 Vue 未就绪就执行、注销了已废弃 API）——
  那属卡侧问题，不追着卡跑。

---

## 9. 建议执行顺序（一条线）

```
【已完成】T-01 收口 → T-02 阶段3 迁移验证 → T-03 阶段4 回归(含 D-4 重评)
   → T-04 双架构 APK 交付 → T-11 D-4 重评 → T-13 D-7 对照 → T-14/T-15 宿主面收口
   → T-20/T-21 兼容缺口补完 → T-23/T-24 验证债 → T-26 README → T-32 契约漂移
   → T-34 类型闸门（core+UI 双绿，抓出 5 个从未生效的功能）
【待你拍板】~~T-08/T-12（D-6 关不关 tools）~~ ✅ 已落地（见 T-59）
   → ~~T-09 存量脏楼层清洗~~ ✅ 已按拍板选 B「不清洗」关闭
【🔴 当前主线 · 必须彻底解决】**§6.5 ST 资产兼容族**（2026-09-12 拍板，按依赖顺序）：
   ① T-48 的 ③「`/scripts/extensions/**` 文件路由 + 扩展存储」（公共基础设施）
   → ② T-63（`/script.js` + `/scripts/{utils,preset-manager,openai}.js` 四个模块面）
   → ③ T-42（正则面板 DOM 本体 + **真接引擎**，不做空容器）
   → ④ T-48 的 ④（Handlebars + DOMPurify 接线，把退化实现换真渲染）
   共同判据 = 真实卡宿主注入脚本完整跑完、零 ReferenceError、四段功能全执行
【🔴 主线并行 · 安全面】T-78（世界书正则超时保护，先实测安卓 node 的 worker_threads）
   → T-79（卡正文防冒充处置；⚠️ 不可照抄 NT 的 `{{` 全转，会砸掉我方宏引擎）
【待你执行】把 arm64 包装真机，验三条基线（启动 / 打开旧聊天 / 发消息）
【待外部条件】T-25 大扫除（需先解冻 RP 数据）→ T-27 更新渠道（需提供目标 GitHub 仓库）
【随时可做】T-28~T-33 长尾（不阻塞发布）
【实机已验】T-59（D-6 工具修剪）/ T-60（T-42 extension_settings.regex）/ **T-67（壳侧 pre-boot 静态预检，
四段闭环：反控复现 → 正控自愈）** —— 单测+反控+**设备实测**三重齐备（见各自段落）
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
