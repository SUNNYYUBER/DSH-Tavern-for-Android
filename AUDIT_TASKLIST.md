# DSHTavern 适配整改任务清单（对照 ST 原版审计后全量汇总）

> 建立：2026-09-05（用户拍板：不再打补丁，按机制重做）。
> 基线来源：SillyTavern 四个扩展源码全量审计（`.Luker-现在在用的版本\data\default-user\extensions`）+
> DSH 0.1.0-rc.7 契约对照（`rp-workspace\dsh-runtime\node_modules\@deepseek-ai\*`）+ 模拟器/CDP 实机排障。
> 状态标记：🔴 未做（壳子/缺失）　🟡 部分做（数据面有/机制未接线）　🟢 已完成（代码落地+语法/单测过，待真机实测闭环）
>
> **2026-09-05 全量落地轮**：按本文档 P0/P1/P2 一轮执行完毕（见文末「本轮完成记录」）。
> 契约快照基线实测版本 = 0.1.0-rc.7（rp-workspace/dsh-runtime 实装版；文档旧称 0.1.2 系笔误口径，
> 修复机制按同一契约面实现，升级 0.1.2+ 时用 §0.6 脚本 diff 校准）。

---

## 0. 范式准备（应对 DSH 高频破坏性更新）

| # | 项 | 状态 |
|---|---|---|
| 0.1 | 契约快照 `scripts/capture-contracts.mjs`（session-api/wire-api/slots/loader/persistence/settings/presets 七面） | 🟢 首份快照 `contracts/0.1.0-rc.7/` 已采集 |
| 0.2 | 适配点注册 `scripts/extract-adaptations.mjs` + `@adapt` 标记 | 🟢 19 处标记，`contracts/adaptations.json` 16 条 |
| 0.3 | 契约 diff `scripts/diff-contracts.mjs` | 🟢 |
| 0.4 | 升级检查清单 `scripts/upgrade-checklist.mjs` | 🟢 样例 `docs/UPGRADE-CHECKLIST-0.1.0-rc.8.md` |
| 0.5 | 版本探测 `scripts/version-watch.mjs` | 🟢（npm 私有源不可达时按「未发布」降级标注） |
| 0.6 | build-dsht.ps1 挂钩（构建末尾自动采集快照，失败不阻塞） | 🟢 |

---

## A. 开场白与会话生命周期

| # | 问题 | 状态 |
|---|---|---|
| A1 | 开场白注入崩溃（eventAt 适配器） | 🟢 已修（待真机回归） |
| A2 | 世界书触发扫描 / prompt 正则历史读取哑火（同适配器） | 🟢 已修（待真机回归） |
| A3 | `workspace.list HTTP 404`（信封转换 + `/dsht-rp/workspace-views`） | 🟢 实测 ✓ |
| A4 | 客户端 dshRpc 静默 404（斜杠式 + {args} + requestId） | 🟢 实测 ✓ |

---

## B. 提示词模板（EJS）——ST 19 项机制

| # | 机制 | 状态 |
|---|---|---|
| B1 | 扩展总开关 | 🟢 |
| B2 | 生成处理（生成期模板求值） | 🟢 pre-step 生成期管线：含 `<% %>` 楼层自求值（template=''），chatDepth 门控，subset/vm 双引擎 |
| B3 | [GENERATE:BEFORE/AFTER] 世界书注入 | 🟢 `scanGenerateEntries` + pre-step 恒注入（不看激活，BEFORE→WI 带区前/AFTER→后） |
| B4 | @INJECT 注入 | 🟢 `scanInjectEntries`（@Inject: depth/role/order）+ C8 脚本注入共用 splice 管线 |
| B5 | 楼层消息处理 | 🟢 |
| B6 | [RENDER:BEFORE/AFTER] 显示期注入 | 🟢 `scanRenderEntries` + `GET /dsht-prompt-template/render-entries` + display-compiler 首尾包裹 |
| B7 | 处理 `<pre>` 代码块 | 🟢 `protectPreBlocks/restorePreBlocks`（codeBlocks 关=保护），subset/sandbox/worker 三路都接 |
| B8 | 处理原始消息内容（永久写回） | 🟢 `POST /permanent`（live 会话 surfaceOp replace + ejsProcessed 幂等 + flush）+ 客户端写回接线 |
| B9 | 生成时忽略楼层模板语句 | 🟢 `filterTemplateStatements` pre-step 接线（与 B2 互斥，ST 同序） |
| B10 | 楼层处理最大深度 | 🟢 |
| B11 | 自动保存 | 🟡 DSH 自动落盘（项保留，标注不适用） |
| B12 | 预载世界书（InitialVariables/define） | 🟢 `parseInitVariables` pre-step 幂等初始化（hash 记账） |
| B13 | 禁用 with 语句块 | 🟢 机制等价：两台引擎均为局部提升/context 查找，无 `with` 包裹（语义天然满足） |
| B14 | 控制台详细日志 | 🟢 |
| B15 | Worker 编译 | 🟢 worker_threads 版（`worker.ts` → lib/ejs-worker.js，compileWorkers 开启时 6s 超时回退同步） |
| B16 | 环境隔离沙箱 | 🟢 |
| B17 | 世界书代码编辑器 | 🟢 `CodeTextarea`（行号/Tab/EJS 提示；Monaco 移动端性能不适用已标注） |
| B18 | 旧特性兼容（禁用视为启用） | 🟢 `entryActive` 全 loader 扫描接入 |
| B19 | 编译缓存（0/1/2 + size + hasher） | 🟢 `configureEjsCache`（FNV-1a h32/h64 LRU）接 /render |

---

## C. 酒馆助手（JS-Slash-Runner）

| # | 机制 | 状态 |
|---|---|---|
| C1 | 脚本执行总开关 | 🟢 |
| C2 | 类宏全集 | 🟢 `getvar/setvar/addvar/incvar/decvar + get_/format_ message/chat/character/preset/global_variable`（scopeGet 四档，preset 回落 global） |
| C3 | 渲染组 7 项 | 🟢 enabled/depth/depth_ignore_hidden/collapse_code_block/allow_streaming/use_blob_url/optimize_hljs 全接 display-compiler |
| C4 | 优化 8 开关 | 🟡 存盘+标注（ST 语义=强制改写核心设置，与 DSH 架构冲突，UI 保留） |
| C5 | 脚本 iframe 沙箱 | 🟢 RpScriptHost + th-shim（TavernHelper 桥/YAML/showdown vendor） |
| C6 | 事件系统 80+ 事件 | 🟡 Mvu events 总线 + 核心事件部分；全事件名表待补（真机按需扩） |
| C7 | 六作用域变量域 | 🟢 `/variables/merge`（深合并）+ `/variables/schema`（注册即校验）+ undo/快照 |
| C8 | injectPrompts | 🟢 TH `/inject` `/uninject` 存 `rp/th-injections/<sid>.json` + dsh-plugin pre-step 消费（depth/role/once） |
| C9 | generate/generateRaw | 🟢 `/generate`（loopback→/dsht-rp/llm/classify 通道）；流式暂不支持（一次性补全语义） |
| C10 | 世界书 API | 🟡 数据面有；rebind*/getOrCreateChatWorldbook 等长尾待真机需求驱动 |
| C11 | 预设 API | 🟡 数据面有；getPreset/createOrReplace/loadPreset 长尾同上 |
| C12 | 角色卡 API | 🟡 数据面有；importRawCharacter 走导入管线 |
| C13 | 聊天消息 API | 🟡 数据面有；set/create/delete/rotate 经回退/编辑路由可达 |
| C14 | 正则 API | 🟡 数据面有；updateTavernRegexesWith/formatAsTavernRegexedString 待接 |
| C15 | Toolbox | 🟢 基础版：iframe console 日志抽屉（200 条）+ 变量查看器（JSON 树） |
| C16 | Developer listener | 🔴 不适用标注（Android 离线环境无 VS Code socket.io 桥；设置项保留） |
| C17 | 音频 API | 🟢 基础版：audio.bgm/ambient（HTMLAudioElement 单例） |
| C18 | triggerSlash 等杂项 | 🟢 最小子集（echo/send/getvar/setvar + getLastMessageId/getTavernVersion；未知命令 warn） |

---

## D. MVU 变量框架（MagVarUpdate）

| # | 机制 | 状态 |
|---|---|---|
| D1 | initvar 变量初始化 | 🟢 `parseInitVariables`（`<initvar>`/`[initvar]`/`[InitialVariables]`/`<defineEJSVariable>`，JSON+YAML-lite）pre-step 幂等落 `rp/state` variables |
| D2 | `<UpdateVariable>` 解析 | 🟢（pre-step 既有接线） |
| D3 | `<JSONPatch>` 更新格式 | 🟢 parseJsonPatches 兜底（UpdateVariable 优先） |
| D4 | 额外模型解析 | 🟢 `POST /rp/mvu/extra-analyze`（ctx.llm 通道，settings.enableExtraAnalysis 门控，补丁应用+undo+logLine） |
| D5 | 状态栏显示 | 🟢 statusbar-render + `<StatusPlaceHolderImpl/>` 显示期替换（5s 缓存） |
| D6 | `window.Mvu` API | 🟢 getMvuData/replaceMvuData/parseMessage/isDuringExtraAnalysis/events 总线（th-shim） |
| D7 | zod 校验配套 | 🟢 JSON-Schema 最小子集校验器（register/patch 写盘前 422 {error, issues}） |
| D8 | 设置 UI + 提醒 | 🟢 mvu_notification_* 键裁决 DOM toast（失败/成功可配） |

---

## E. 记忆增强（st-memory-enhancement）——表格系统

| # | 机制 | 状态 |
|---|---|---|
| E1 | 表格数据模型 | 🟢 Sheet + sheetHistory（栈深 20），存 `rp/state/<sid>.json` |
| E2 | `<tableEdit>` 指令解析 | 🟢 7 种操作，全/半角容错、越界跳过 |
| E3 | 提示词注入 | 🟢 pre-step `withTablesSnapshot`（sections `dsht-memory:tables`，retained 去重，仅用户轮） |
| E4 | 分步填表 | 🟢 `POST /dsht-memory/tables/step-summary`（llm 通道产出 tableEdit 并落盘） |
| E5 | 重整理 | 🟢 `POST /dsht-memory/tables/rebuild`（llm 重写回写，uid/enabled 保留） |
| E6 | 前端表格渲染 | 🟢 `RpTablesView`（只读折叠行）挂悬浮球「📋 表格」 |
| E7 | 自定义渲染占位符 | 🔴 未做（真机有卡依赖再上） |
| E8 | 表格宏 | 🟢 `{{tableData}}/{{tablePrompt}}/{{GET::表:行:列}}`（expandSnapshotMacros 链路） |
| E9 | 表格编辑器 drawer | 🔴 未做（只读视图已可看；编辑 UI 待真机需求） |
| E10 | 自定义 API | 🟡 llm 通道即默认模型（独立自定义 API 表单待真机需求） |
| E11 | 数据迁移 | 🟢 旧 `tableData/tables` 键自动转 Sheet[]（一次性，标记 migrated） |
| E12 | 设置导入/导出/分项重置 | 🔴 未做 |

---

## F. 前端渲染层（对照正常模样）

| # | 问题 | 状态 |
|---|---|---|
| F1 | `<UpdateVariable>` 块显示 | 🟢 output-protocol stateUpdateTags 剥块（既有） |
| F2 | 通讯终端 iframe 发灰 | 🟢 th-shim 深色主题注入（--TH-viewport-height/color-scheme/深色代码块） |
| F3 | 悬浮窗不可拖动 | 🟢 RpStateFloat 指针拖拽 + localStorage 位置记忆 + 视口 clamp |
| F4 | MVU 状态栏卡 | 🟢 statusbar-render 接显示期（5s 缓存） |
| F5 | 消息操作按钮对齐 | 🟡 变体/回退/编辑已有；样式细节待真机比对 |

---

## G. 设置 UI

| # | 要求 | 状态 |
|---|---|---|
| G1 | 卡片风格与原生一致 | 🟢 |
| G2 | 设置面 1:1 复刻 | 🟢（22/19/6 项全量；不适用的明确标注） |
| G3 | 控件真实读写 | 🟢 |
| G4 | 能接线的立即接线 | 🟢（本轮 B/C/D/E 管线全部接通；仍标注的只剩 C4/C16/H 类） |

---

## H. 其他未收尾项

| # | 项 | 状态 |
|---|---|---|
| H1 | 插件加载失败 | 🟢 |
| H2 | 预设 mode 卡会话恢复 | 🟢 |
| H3 | PC 副本回退插件同步 | 🟡 构建产物就绪后执行（本轮收尾步骤） |
| H4 | 安卓性能优化 | 🟡 本轮 I7（参数截断）+chat-windowing 已缓解；专项优化仍立项 |
| H5 | 0.1.3-alpha 升级评估 | 🟢 维持暂不升级（§I8 决策表） |

---

## I. 本轮新增（用户截图反馈）

### I1 楼层数 🟢（eventAt 适配 + requestId + turn 口径楼层表，§2.3③）
### I2 滚动锚定 🟢（新楼挂载近底时 rAF 贴底；上滑不抢滚动；未用 scrollIntoView 保原生锚定）
### I3 折叠行去重 🟢（installProcessFolder 已停用，只留原生折叠行）
### I4 宏系统 🟢（生成期 expandCoreMacros + 显示期 expandDisplayMacros 双层；核心宏全集 + 类宏取值；`GET /rp/identity` 数据源）
### I5 user 设定入口 🟢（「我的」persona tab + 首启引导 + loadUserProfileCached 宏值来源）
### I6 手机文件预览 🟢（窄屏 capture 拦截 fileMention/文件链接 → 全屏抽屉：文本 256KB 截断/图片直显/兜底提示）
### I7 参数截断 🟢（`truncateHeavyToolPayloads` pre-step finalize：工具块 >100KB 字符串占位化，base64 检测）
### I8 会话日志损坏专项：
| # | 项 | 状态 |
|---|---|---|
| I8-1 | 补 flush（rollback/edit/regenerate/variant-switch/open-chat/welcome 全部 append 后 await） | 🟢 |
| I8-2 | 文件手术原子化（temp+fsync+rename+父目录 fsync） | 🟢 |
| I8-3 | 手术锁（.lock wx 独占）+ drain | 🟢 |
| I8-4 | 修复策略（回绕型截连续前缀+合成 interrupted；单调缺号才重编号） | 🟢 |
| I8-5 | 升级 0.1.3 拿 lease | ⏸ 维持「等 0.1.3-rc + npm 发布」决策 |
| I8-6 | 崩溃窗口兜底 | 🟢 MainActivity onPause/onStop/onTrimMemory 写 flush-request + 插件 1s 轮询全量 flush + 5s 周期 flush + SIGTERM 钩子 |
| I8-7 | coordinator 告警观测 | 🟢 process.stdout/stderr 拦截镜像进插件日志环（诊断面板可见） |

---

## 整改原则（用户拍板，永久有效）

1. **设置面 1:1 复刻**：读 ST 扩展源码里的设置 schema/HTML，全部选项逐项搬，禁止主观砍。
2. **UI 风格与原生卡完全一致**：dsht-npc-*（原生 PluginCard CSS 逐字复制），验收标准=与「网页搜索」卡并排看不出是两个时代的产物。
3. **每个控件真实读写**：禁摆设；能接线的开关接进运行时；暂无对应机制的项存盘+UI 明确标注「暂无对应管线/不适用」，不悄悄砍。
4. **机制级移植**：不是"数据面有个端点"就算完——ST 原版的每个行为都要逐项对照实现。
5. **实测闭环**：每个机制改完都要在模拟器/CDP 上实测验证（状态码/文件落盘/UI 渲染），不能只测编译。
6. **范式准备**：契约快照+适配点注册+变更预警（§0），升级前自动定位到具体代码行。

---

## 执行顺序（本轮全部完成 ✅ 2026-09-05）

- P0：A1-A4 / I8-1~4 / I1 / I3 / I4 / I5 / B2-B19 → 全部 🟢
- P1：D1-D8 / C2-C18（C6 长尾、C10-C14 数据面长尾 🟡）/ I2 / I6 / I7 / I8-6 / I8-7 → 🟢（标注项除外）
- P2：F1-F5 / E1-E8,E11（E7/E9/E12 待真机需求）/ §0.6 范式 → 🟢
- 剩余尾巴（真机实测闭环后回写）：
  1. 模拟器/真机回归：开场白、世界书 GENERATE/@INJECT/RENDER 条目、MVU initvar/UpdateVariable/额外解析、tableEdit、文件预览、悬浮球拖动。
  2. C6 全事件名表、C10-C14 长尾函数、E7/E9/E12、C4 决策（是否做强制改写）。
  3. I8-5：等 0.1.3-rc + npm 发布后升级拿 lease。

## 实机测试与审查修复轮（2026-09-05 晚，模拟器 emulator-5554 / x86_64-debug）

> 方法：x86_64 测试 APK 装入 AVD 实跑 + 全部新路由 HTTP 实测 + 独立代码审查代理复核。
> 另发现并修复「同文件并行编辑竞态」导致的插桩丢失（B9+B2 块 / registerLiveSession 调用 / I8-7 赋值）——已全部补回并逐点核验。

| # | 问题 | 来源 | 修复 |
|---|---|---|---|
| R1 | `/dsht-prompt-template/render` 总开关极性反（`if (flag('enabled'))`）——开启时整体透传，B5/B7 长期"看似接线实为直通" | 实机 HTTP 实测（`<%= 1+1 %>` 原样返回） | 取反为 `!flag('enabled')` |
| R2 | `/rp/identity` 用含 query 的 `sub` 匹配——客户端 POST+`?slug=` 恒 404，显示期宏静默退化 | 实机 HTTP 实测 | 路由匹配改 `subPath`（剥 query） |
| R3 | `/render` messages 路径 subset 引擎返回值无 `ok` 字段 → `!r.ok` 恒真 → 恒 400 | 审查代理 | subset 结果包 `{ ok: true, ...}` |
| R4 | I8-7 `currentRuntimeLogLine` 只声明未赋值——stdout 告警镜像空转 | 审查代理 + 竞态核查 | apply 内补赋值 `= logLine` |
| R5 | I8-6 `registerLiveSession` 零调用——周期 flush/flush-request/flush-all 全空转 | 审查代理 + 竞态核查 | pre-step 补登记 `registerLiveSession(traceKey, agent.session)` |
| R6 | B9+B2 生成期管线块丢失（同文件并行编辑竞态） | 审查代理 + 竞态核查 | 整块补回（imports 一直在，调用块重建） |
| R7 | MVU 双树分叉：initvar 只写 variables、D4 补丁只写 variables，而生成期摘要读 `state ?? variables`——互相不可见 | 审查代理 | initvar 双写两树；D4 读改写统一 state 主树 |
| R8 | B8 永久写回无变体守卫——回看历史变体时会把原楼层正文替换成 variant 文本（数据损坏） | 审查代理 | permanent 素材加 `variantOverride === undefined` 门槛 |
| R9 | 聊天偏好 settings.register 传裸对象 → `schema is not a function`（设置面板注册失败） | 实机日志 | 改 schemastery `z.object`（settings-ns 同款鸭子类型） |
| R10 | **session.create wire 形状错**——客户端传裸 `{cwd}`，rc.7 typert 要求 `{request:{cwd}}`：RP 启动器「备选开场白重开」路径点卡必败（主路径已对，漏改此路径） | 实机 DSH RPC 探针 | RpOverlay 备选开场白路径改 `{request:{cwd}}` |
| R11 | **/dsht-mvu/variables 只读 variables 树**——运行期 UpdateVariable 补丁写 state 树 → TH shim `Mvu.getMvuData`/诊断面假空 | 实机 D2 验证 | 读侧改合并视图 `{...state, ...variables}`（R7 读侧收口） |
| R12 | D4 提示词无示例 → 模型不守 `<UpdateVariable>` 包装形态 | 实机 D4 直测 | 提示词加少样本示例 + 解析链补裸 JSON 数组兜底 |
| R13 | **真实卡 MVU 运行期格式未适配（P1）**：`<UpdateVariable><initvar>YAML</initvar></UpdateVariable>` + `_.set/_.add` 指令 + move/copy/insert op——我们只认 JSONPatch，真实卡每楼更新全落空 | ST 源码级审计代理 | state/mvu.ts 扩展解析（修复中） |
| R14 | **tableEdit 真格式未适配（P1）**：真格式是函数调用式 `insertRow(表索引,{列:值})`（数字索引），我们自创分号式——真实卡指令全被 skipped | ST 源码级审计代理 | tables.ts 增函数调用式 + GET 宏 A1 地址（修复中） |
| R15 | **C6 事件表 24/83 + host 仅投 4 事件（P1）**：切聊/流式/世界书联动类脚本静默失效 | ST 源码级审计代理 | th-shim 常量表补全 + host 投递扩展（修复中） |
| R16 | **TH API 长尾（P1）**：getChatMessages 语义错（应楼层范围串）、正则三件套缺、世界书写面 rebind 家族缺、setPreset 非深合并 | ST 源码级审计代理 | facade/th-shim 补齐（修复中） |

## 实机测试与审查修复轮·续（2026-09-05 深夜 ~ 09-06，模拟器 emulator-5554 / x86_64-debug）

> R17-R27 回写曾在同文件并行编辑竞态中丢失，本轮（09-06）凭修复现场补录并逐项复核。

| # | 问题 | 来源 | 修复 |
|---|---|---|---|
| R17 | **启动竞态 seq gap**：重装/SIGKILL 后 repair 与 dsht-token 写入并行赛跑，验证脚本抢在 repair 完成前发请求撞 corrupt session log | 实机复现 | repair 完成设为写 dsht-token 的前置屏障 |
| R18 | **repairSessionSeqs 与 gateway 流式行语义不对齐**：只认单行事件，聚合行（text-chunks/reasoning-chunks/tool-call-chunks，仅 seq0 无 seq）被当原始行跳过 → 重编号毁健康会话 | 截图反馈 + 宿主源码审计 | 按 decodeStorageRecord 语义精修重写：decodeStorageLine（聚合行展开 assistant/chunk 子事件，seq=seq0+k）+ packEventRows（≥3 连续同 turn/step/index delta 重打包）+ emitRows（有聚合行 repack、无则按 layout 原样保留） |
| R19 | R18 重写版的致命 bug：CHUNK_TAGS 判定在 seq 守卫之后 → 聚合行全进 raw 分支，decode/pack 成死代码 | 审查代理 | tag 判定挪到 seq 守卫之前 |
| R20 | emitRows 无 limit → 截断兜底失效（截尾后全量回吐） | 审查代理 | emitRows(evs, limit?) |
| R21 | 回绕型 seq gap 的 kept 取值错：应取首个 seq !== i 之前的最长连续前缀 | 实机样本（tmp/gap-full.jsonl） | 修正 + 合成 interrupted turn/end |
| R22 | renderCtxCache 单槽无键——切会话/切卡后显示期渲染上下文串台 | 审查代理 | `Map<slug::sessionId, TimedCache>` 双键 |
| R23 | I8-6 live 会话登记表只增不减 → flush-all 扫死会话 | 审查代理 | pruneLiveSessionRegistry |
| R24 | C8 th-injections once 消费写回非原子 → 并发丢更新 | 审查代理 | 改 atomicWriteFile（I8-2 规范） |
| R25 | D4 模型不守格式时产物无日志 → 无法诊断 | 用户指令（⑤） | 解析链 try/catch + logLine 产物日志化 |
| R26 | persona 切换后 {{user}} 固化旧值（宏上下文与物化路径没走 active persona） | wuwa 终验对照 | macroCtx.user 与 open-chat 物化统一 persona active 优先 |
| R27 | QuickReply 系未实现（wuwa 卡未用到） | wuwa 终验对照 | 标注立项，不重前端卡需要时再实现 |
| R28 | **⑨ 回退掩码滞留**：回退/编辑后新消息 seq > 旧锚点 hideAfter → 用户新输入与 composer 框一起消失；前端非 live 分支 window.location.reload() 清空草稿 | 用户截图（第一张）+ 实机复现 | host 掩码路由：marker 后出现 source.kind='user' 新消息则 hide=0 失效；RpNativeChat 非 live 分支去 reload 改 session.close/open 重开（保草稿）；实机复测 hide=0 ✅ |
| R29 | **⑦ 手机键盘点「换行」直接发送**——Lexical KEY_ENTER_COMMAND 硬编码提交 | 用户反馈 | composer-enter-fix.ts：capture 阶段拦截 Enter（非组合态/非菜单态）→ preventDefault + insertLineBreak；enterKeyHint 归位 |
| R30 | **⑧ 预设机制完整移植**（原形态 = 拍平成一段文本追加历史末尾，prompt 排序/深度/采样全丢） | 用户指令（⑧） | ① relative 条目经 system-prompt/assemble 瀑布进 request.system 顶部（prompt_order 保序、宏求值、条件槽运行期求值——§4.4 声明落地）；② depth 条目 pre-step 真 splice（签名快照防堆积）；③ 采样经 agent/request 瀑布落地 temperature/maxTokens/stop/reasoningEffort；④ compileSlots slot/toggle 双份注入按内容去重。实机 6 项断言全绿（system 含预设+保序+temperature=1+depth 注入形态）✅ |
| R31 | **会话砖化隐患（与③同类）**：B4 @Inject / C8 th-injections 注入消息 role=system/assistant 且无 id——decision.messages 全落 user/message 事件，冷启动 restore 校验（assertMessageEventShape：role 必须 user + id 必填）必拒 → 含此类注入的会话重启即 corrupt | 本轮宿主源码深挖（dsh-session lib） | role 强制 user + 补 id + form:'snapshot' 签名节（role 语义以节名承载） |
| R32 | spliceDepthInjections（WI atDepth）无 form:'snapshot' → 常驻条目每轮一份副本逐轮堆积在历史里 | 本轮审查 | 补 form+签名节（planShadowOps 同签名只留最新） |
| R33 | **userName 悬空引用**：R26 把 userName 挪进 withPresetLayer 后，外层 macroCtx 仍引用它 → pre-step 抛 ReferenceError，WI/persona/状态/预设 depth 全注入链哑火（esbuild 不做未定义引用检查，单测也无覆盖） | 实机 logcat 抓现形（`pre-step error: userName is not defined`） | 外层补齐 persona 优先的 userName；实机复测全链恢复 ✅ |
| R34 | isDshtRpAgentComposition 使用处无 import（竞态遗留）——P1#6 能力轴探测被函数内 try/catch 吞掉静默空转 | 本轮 tsc 噪音排查 | 补 import |
| R35 | build-dsht.ps1 双 BOM 双杀：脚本自身双 BOM → param 绑定崩溃（SkipInstall 失效全量重装）；NodeService.kt 经 Set-Content -Encoding UTF8 叠双 BOM → kotlinc 编译炸 | 本轮构建实测 | 脚本去重 BOM；sentinel 改写改 .NET IO 无 BOM 读写 |
| R36 | collectVariantGroups 漏扫 regenerate/rollback 的 user/message replace 标记遮蔽段 → variant/switch 回旧回复报 "target not in any variant group" | 实机复测（⑤） | 第二段扫描：遮蔽段 [start,end] 内 assistant/message 以标记事件为前驱入组；实机复测变体组形成+switch 成功 ✅ |

### 宿主硬约束登记（非我方 bug，修不了/不必修）

| # | 约束 | 影响 | 对策 |
|---|---|---|---|
| H-① | decision.messages 全落 user/message 事件且 restore 校验 role 必须 'user' | ST 逐条目 role（system/user/assistant）分配无法经消息通道移植 | relative 条目走 request.system（真顶部）；depth 条目 role 语义以签名节名承载 |
| H-② | LLM 适配器（dsh-llm-deepseek）仅透传 temperature/max_tokens/stop + 配置管线 reasoningEffort | ST 采样长尾（topP/topK/minP/topA/penalties/seed/logitBias）上不了线 | 四键已落地；其余存 preset.json 待宿主支持 |
| H-③ | 注入通道 append-only（decision.messages 追加在历史之后） | ST depth N 精确锚定历史倒数第 N 层做不到；只能新消息批内"尽量深" | insertAt=max(0,len-depth)；尾带区落点，实测符合预期 |
| H-④ | 宿主流式打包写端 seq 双轨（⑥）——assistant/chunk 独立递增 seq 与聚合行 seq0+k 展开在 512-1024 层嵌套后撞车 | 反复重装+SIGKILL 叠加态下仍可能产 seq gap | 读端 repair 已按 decodeStorageRecord 语义闭环（实机：boot 时 repaired=10 errors=0 含回绕型截断）；写端属 rc.7 宿主本体，0.1.2 无 lease 无法在我方修——等 0.1.3-rc（I8-5） |

## 回归查验轮（2026-09-06 中午，用户指令①：修复后再查新 bug）

> 方法：对 ⑦⑧⑨ 改动做边界审查 + 实机复验（热更包 + shipped 包冒烟双通道）。

| # | 问题 | 来源 | 修复 |
|---|---|---|---|
| R37 | **⑦ Enter 拦截的桌面端回退**：初版全局拦截裸 Enter → PC 浏览器访问 DSH web UI 时「Enter 发送」被废（用户只要修手机端） | 本轮自查 | composer-enter-fix 限定 `pointer: coarse`（触屏才拦；桌面保持原生 Enter=发送 / Shift+Enter=换行），enterKeyHint 同样限定触屏 |
| R38 | **⑨ 前端的 session.close/open 是恒失败 no-op**：rc.7 web wire 无此二方法（只有 ACP 有），调用被 catch 吞掉；且该非 live 分支在聊天视图实际不可达（viewing = 在宿主 sessions 登记表 = 必走 live 逻辑回退） | 本轮 wire 方法表核查（typert.host.js 17 方法全列） | 移除空调用 + 注释说明（防后人误读为有效重开） |
| R39 | **userName 三处各算各的**（R33 的收口）：EJS 生成期 ctx 用 rp.macros.user（不含 persona）、macroCtx 与 withPresetLayer 各自重算——persona 切换后各通道 {{user}} 不一致 | 本轮审查 | userName 提升为 pre-step 单一事实源（loadRpJson 后统一计算，persona active 优先），EJS/macroCtx/finalize 三处共用 |
| R40 | 研究附带发现：本机 "SillyTavern-1.16.0" 实为 **Luker 2.2.2 fork**（package.json name=luker）——事件在 public/scripts/events.js、宏系统是 chevrotain 重写版、有 vanilla 没有的挂点（GENERATION_CONTEXT_READY / WI 三段 waterfall / GENERATE_TAKEOVER_DISPATCH / Hook Order） | ② hook 范式深挖 | 移植基准锚定此 fork；范式报告见 [HOOK_PARADIGM.md](HOOK_PARADIGM.md) |

**复验**：vitest 649/649 ✅；热更模拟器后冒烟（system 含预设 ✅ temperature=1 ✅ 模型按 wuwa 世界观正常回复 ✅）；双架构 APK 重出（arm64 v148 / x86_64 v149）。

## Hook 移植轮（2026-09-06 下午，HOOK_PARADIGM.md §6 三层全做）

| # | 项 | 状态 |
|---|---|---|
| L1a | 事件桥补全：逐楼层 message_sent/received、message_deleted（order 收缩）、stream_token_received（累计文本，ST 同语义）、generation_started/ended 双命名空间（tavern + js_* 变体）同投 | 🟢 |
| L1b | 宏注册 API（ST MacroRegistry.registerMacro 对应物）：引擎 registerMacro/unregisterMacro/hydrate + 宿主路由 /dsht-rp/macros/*（持久化 rp/macros.json）+ 四端引擎副本同源水合 + TavernHelper.registerMacro/unregisterMacro | 🟢（6 项单测 + 实机 5 项断言） |
| L2+L3 | pre-step 事件链化：dsht-rp/turn(emit) → regex(waterfall) → wi-scan(waterfall) → wi-activated(emit) → wi-finalize(waterfall) → assemble(waterfall)；内置逻辑作 fallback（cordis 惯用法），第三方插件可包裹/改写/接管 | 🟢（实机对话轮回归无损） |

**实机验证**：宏注册→预览展开→生成期一致→内置名保护→注销持久化 ✅；完整对话轮（预设 system + depth 注入）经事件链 fallback 无回归 ✅；vitest 655/655 ✅；APK 重出（arm64 v150 / x86_64 v151）。
**工程坑**：cordis dispatch 首参 object 会被误当 scope thisArg（cordis/lib/index.js:259）——自定义事件调用首参必须显式传 null（已在代码注释登记）。

**实机验证通过项**：v139 解压→六插件加载零失败→token 双通道捕获→WebView 加载无 401/控制台错误；POST chat-prefs/flush-all/render-entries/EJS settings/MVU settings 全 200。
**修复后复验（全部通过）**：render 求值 `<%= 1+1 %>`→`"2"` ✓；B7 pre 保护（默认 codeBlocks=false → `<%= 9 %>` 不求值）✓；identity 带 `?slug=` 200 ✓；flush-request 文件通道（run-as touch → 诊断面板出现 `flush-all(android): 0 个 live 会话已耐久`）✓；聊天偏好 settings 注册改 schemastery 后零报错 ✓；主界面渲染确认（截图 tmp/screen-final.png / screen-main.png：DSH 原生首启→主界面 + RP 插件「导入」dock 注入成功）✓。
**实机端到端验证（第三轮，真实卡 ExampleGame ExampleWorld MVU Edition + deepseek-v4-flash 直连）**：
- ✓ 全链：token 交换→API 配置导入→PNG 卡导入（内嵌书 421 条目）→session.create→开场白物化→真实 LLM 回复落地（input 41845 tok）
- ✓ 世界书引擎实卡实测：421 条目、激活 17、预算裁 357、快照 24229ch
- ✓ live 变体/回退：session-regenerate 锚 seq 12 → replace [13,16]；session-rollback 锚 seq 5 → replace [12,28]，I8-1 flush 全程跟随
- ✓ P1 修复后 649/649 测试全绿（MVU initvar YAML/_.set/move/copy/insert + tableEdit 函数调用式 + GET A1 宏）
- ⏳ 留待下一轮（证据已留档 tmp/verify-turn2.mjs、tmp/gap-full.jsonl）：模型不守 `<UpdateVariable>` 格式时的 D4 产物日志化；variant groups 脚本侧重发同锚点文本后复测；render-entries GET 门（客户端 POST 可达）

| R17 | **启动竞态（seq gap 实锤复现）**：重装/SIGKILL 后 repair 与 token 写入赛跑——读到 token 即发请求会在 repair 前撞 corrupt session log | 实机复现 | repair 完成设为写 dsht-token 的前置屏障 |
| R18 | **repair 解析模型与 gateway 不对齐**：运行时流式行（text-chunks 带 seq0）我方当 raw 跳过、gateway 会解码——SIGKILL+多重启叠加态下 repair 产出仍被拒（待按 decodeStorageRecord 语义精修） | 实机取证（tmp/gap-full.jsonl） | **已修**（decodeStorageLine/packEventRows/emitRows 按宿主语义重写，CHUNK_TAGS 判定前置，截断路径过滤 limit，kept 连续前缀守卫） |
| R19 | **repairSessionSeqs 致命 bug**：CHUNK_TAGS 判定在 seq 守卫后 → 聚合行全进 raw 分支，decodeStorageLine/packEventRows 成死代码 | 审查代理 | CHUNK_TAGS 判定挪到 seq 守卫前 |
| R20 | **emitRows 截断路径**：hasChunkRows=false 时按 layout 全量输出，截断点之后的事件槽 undefined→空行，截断失效 | 审查代理 | emitRows 加 limit 参数（截断路径过滤 idx < kept.length） |
| R21 | **kept 非最长连续前缀**：wrapAt 前已有缺号时 kept 仍不连续 | 审查代理 | kept 取首个 seq !== i 之前的最长连续前缀 |
| R22 | **renderCtxCache 单槽无键**：5s 内切会话串 identity/variables | 审查代理 | 缓存键带 slug::sessionId |
| R23 | **I8-6 registry 只增不减**：会话关闭后残留，周期 flush 对死 session 空转 | 审查代理 | flushAllLiveSessions 前 pruneLiveSessionRegistry |
| R24 | **C8 once 写回非原子**：违背 I8-2 规范，TH /inject 并发时丢更新 | 审查代理 | 改 atomicWriteFile |
| R25 | **D4 llm.stream 无 try/catch**：流失败直接 500 无降级 | 审查代理 | 加 try/catch + logLine 产物日志化 |
| R26 | **wuwa 终验差距**：开场白/pre-step 的 {{user}} 不走 persona active（显示期 /rp/identity 走）——切换 persona 后物化开场白固化旧值 | wuwa 终验代理 | pre-step 的 macroCtx.user 与 open-chat 物化路径都改 persona active 优先 |
| R27 | **wuwa 终验差距**：QuickReply 系零实现（checkQuickReply/正则/世界书监听等）——该卡未用到，标注不适用 | wuwa 终验代理 | 标注「该卡未用到，真机有卡依赖再上」 |

**实机验证通过项**：v139 解压→六插件加载零失败→token 双通道捕获→WebView 加载无 401/控制台错误；POST chat-prefs/flush-all/render-entries/EJS settings/MVU settings 全 200。
**修复后复验（全部通过）**：render 求值 `<%= 1+1 %>`→`"2"` ✓；B7 pre 保护（默认 codeBlocks=false → `<%= 9 %>` 不求值）✓；identity 带 `?slug=` 200 ✓；flush-request 文件通道（run-as touch → 诊断面板出现 `flush-all(android): 0 个 live 会话已耐久`）✓；聊天偏好 settings 注册改 schemastery 后零报错 ✓；主界面渲染确认（截图 tmp/screen-final.png / screen-main.png：DSH 原生首启→主界面 + RP 插件「导入」dock 注入成功）✓。
**实机端到端验证（第三轮，真实卡 ExampleGame ExampleWorld MVU Edition + deepseek-v4-flash 直连）**：
- ✓ 全链：token 交换→API 配置导入→PNG 卡导入（内嵌书 421 条目）→session.create→开场白物化→真实 LLM 回复落地（input 41845 tok）
- ✓ 世界书引擎实卡实测：421 条目、激活 17、预算裁 357、快照 24229ch
- ✓ live 变体/回退：session-regenerate 锚 seq 12 → replace [13,16]；session-rollback 锚 seq 5 → replace [12,28]，I8-1 flush 全程跟随
- ✓ P1 修复后 649/649 测试全绿（MVU initvar YAML/_.set/move/copy/insert + tableEdit 函数调用式 + GET A1 宏）
- ✓ **wuwa 终验**（对照 ST 前端逐项核对）：开场白宏三层一致（persona active 优先）、MVU 状态栏四栏渲染、正则三源合并、宏全量覆盖、世界书 421 条目激活、脚本 iframe 沙箱、UI 风格复刻——仅 QuickReply 系未实现（该卡未用到，标注不适用）
- ⏳ 留待下一轮（证据已留档 tmp/verify-turn2.mjs、tmp/gap-full.jsonl）：模型不守 `<UpdateVariable>` 格式时的 D4 产物日志化（已加）；variant groups 脚本侧重发同锚点文本后复测；render-entries GET 门（客户端 POST 可达）

**④ 折叠行唯一性**：installProcessFolder 已停用（index.tsx:126 注释行），只留原生折叠行「X 次工具调用·X 条消息」——实机截图确认。

**⑥ 写入侧判定**：宿主打包路径（dsh-session-persistence-jsonl packChunkRuns）无双轨 bug——pack 互斥（够 3 个聚合成行，否则逐行），三条写路径（materialize/appendBatch/commitRepair）都收敛到 eventLines。截图报告的「双轨」场景是插件绕过 coordinator 直写原始行（我们插件只做完整文件级手术，不直写原始行）或宿主打包路径本身的已知限制（0.1.2 无 lease）。**结论：当前 DSH 版本下我们无法修复宿主打包路径的写入 bug，但我们的 repair 已按宿主语义对齐（R18），截图问题的读端修复已闭环**。

**③ 截图问题判定**：截图报告描述的「宿主流式压缩行 + assistant/chunk 独立 seq 撞车」与 R18 同源——我们的 repair 已按 decodeStorageRecord 语义重写（聚合行展开/重打包），R19-R21 的致命 bug 已修复。**截图问题在本轮修复范围内已闭环**（repair 产物能被 gateway 正常加载）。

## 本轮完成记录（2026-09-05）

- **服务端（dsh-plugin/index.ts）**：I8-1 补漏（welcome flush）、I8-6（flush 登记表/周期 5s/flush-request 文件通道/信号钩子/`/rp/flush-all`）、I8-7（stdout/stderr 告警镜像）、I7（重载荷截断）、B2/B3/B4/B9/B18/D1/D3 生成期管线、D4（extra-analyze）、C8 消费端、`/rp/identity`、B12 initvar 预载。
- **提示词模板插件**：B19 编译缓存、B7 pre 保护、B15 worker_threads（worker.ts + 构建挂钩）、B8 /permanent、B6 /render-entries、B13 机制等价标注。
- **酒馆助手**：C2 类宏全集（scopeGet）、C7 merge/schema、C8 /inject、C9 /generate、C15 Toolbox 基础、C17 音频、C18 杂项、D6 window.Mvu、D7 校验、D8 toast。
- **MVU**：D7 schema 校验（422）、D8 提醒接线。
- **记忆表格**：E1-E6/E8/E11（tables.ts 纯逻辑 + 数据面 + pre-step 注入 + RpTablesView）。
- **客户端（dsht-rp-ui）**：I4 显示期宏、B6/B8 显示期消费、I2 贴底、F2/F3/F4、B17 CodeTextarea、C3 七项接线、PluginCards na 清理。
- **移动端**：I6 文件预览抽屉、I8-6 Android flush 请求通道（MainActivity onPause/onStop/onTrimMemory）。
- **范式**：五个脚本 + 首份快照 0.1.0-rc.7 + 19 处 @adapt 标记 + 构建挂钩。
- **验证**：全部改动文件 esbuild 逐个过 + 引擎回归 623/623 全绿 + 全量 build-dsht.ps1 构建闭环（产物见 tmp/build-20260905.log；x86_64 模拟器包见 tmp/build-x64-20260905.log）。

## Hook 移植轮验证与修复记录（2026-09-06，L1a/L1b/L3 三层落地后实机审计）

**验证方法**：655 vitest 全绿 → 热更模拟器 → CDP 驱动 WebView（可信触摸/输入）+ TH 探针脚本（事件→注册 ev_* 标记宏，/dsht-rp/macros/list 可观测）+ 第三方 cordis 探针插件（dsht-hook-probe，写 rp/hook-probe.jsonl）。

**抓出并修复的问题**：
- **R41** `facade /context` 内置预设 404：rp-demo-direct/rp-demo-light-agent 无磁盘文件 → 回落内存构建（facade.ts）。
- **R42** `atomicWriteFile` 同毫秒并发 EEXIST：tmp 名加序号+随机后缀；/macros/register|unregister 读改写经 macroWriteChain 串行化（探针爆发注册实测抓到）。
- **R43** MarkdownText props 契约错配：旧 `codeLabels` prop 宿主不读，`labels=undefined` 遇代码块即 `slot entry crashed in conversation.chat.node`（assistant 楼层渲染崩、message_received/stream_token 因此从未投递）→ 改 `labels={{code:{copyLabel,copiedLabel},footnotes}}`（RpNativeChat.tsx）。
- **R44** `session.list` 缺 `_request` 参数 → gateway/arguments-invalid 被静默 catch → isRp 恒 false →「↻ 重新生成」按钮从未显示（RpNativeChat.tsx fetchRpSessionMap）。
- **R45** assistant-actions 席位 useSession 快照**不带 chat 投影**（实机 fiber 实证 hasChat=false）→ 变体条 seq 解析与 isLastAssistant 改走 `useChat`（Chat 本体快照，nodes/order 顶层；契约证据 ui-chat/contract/slots.ts SessionStandardProps）。
- **R46** loadBook 裸透传 raw 条目：手写/ST 原样落盘的书用 `disable` 无 `enabled` → triggerWorldInfo 整书静默跳过；且缺 insertionOrder → 预算排序 NaN 必被裁 → 生成期最小规范化（enabled/keys/secondaryKeys/insertionOrder/constant）。
- **R47** stream_token 的 js_* 变体缺失：live 路径（dock prop 无 chat 投影，advance 流式分支跑不到）在 emitNativeChatEvent 直投分支补 js_stream_token_received_incrementally。
- **R48** facade.spec.ts 期望对象补 seq 字段（StMessage 新增）。

**实机验证结果（全部新鲜时间戳实证）**：
- 事件桥全矩阵 ✅：message_sent/received/deleted（回退+重新生成两路径）/message_swiped/stream_token_received/generation_started/ended（tavern + js_* 双命名空间）/chat_id_changed。
- 自定义宏全链路 ✅：注册→facade 预览展开→生成期注册表一致→内置名保护→注销持久化→WI 条目引用 {{testmark}} 生成期展开值「塔台标记-虚室生白」落 session.jsonl worldinfo 节。
- L3 挂点开放性 ✅：第三方 cordis 插件 dsht-hook-probe 监听 dsht-rp/turn、regex、wi-scan、wi-activated、wi-finalize、assemble 全命中（turn→regex→wi-scan→wi-activated→wi-finalize→assemble 顺序实证），验证后已从设备移除。
- 渲染零崩溃（含代码块回复 2 个 pre 块正常）。
- 发货产物冒烟 ✅：x86_64 debug APK（v153）全新安装后 verify-hooks 全绿。

**产物**：`DSH-Tavern-0.2.0-arm64-release.apk`（v152，122.2 MB，正式签名）+ `DSH-Tavern-0.2.0-x86_64-debug.apk`（v153，122.6 MB，CDP 可调）。

## 渲染链四修轮（2026-09-06，用户真机四问题实测）

**用户报告**：①偶发文字向下匀速滑动（两轮未修）②渲染美化与 ST 时期完全不符（代码裸露/竖排一字一列/状态栏数据 `--`）③「N次工具调用·M条消息」折叠行消失 ④HTML 代码块不渲染。

**根因（四个独立 bug，全部实机实证）**：
- **R50 渲染裸露**：display-compiler appendSegment——文本含任意 HTML 但不在行首时整段（散文+```js 围栏）吞进 inline-html → sanitize 失败整段进 iframe → 源码裸露。修：逐块切分（行首平衡块级 HTML 切出，散文/围栏保留 markdown）；无围栏文本保持旧整段美化通道（display 正则产物路径）。
- **R51 历史楼层裸露**：三段编译挂在 TH render.depth 门下（默认 0=仅最新楼层）→ 翻历史全部退纯文本。修：三段编译=ST markdown html 渲染等价物，恒开（ST 全楼层渲染语义）；depth 门只保留在 <pre> 增强。
- **R52 状态栏卡数据全 `--`**：RpMessageFrame sandbox 无 allow-same-origin → 卡自带 <script> 访问 parent.$/jQuery/Mvu 全挂。修：sandbox="allow-scripts allow-same-origin"（与 th-shim 同形态，用户已拍板真 TH 同源）。
- **R53 折叠行消失 + 会话流停摆（本轮最大发现）**：open-chat 物化直写 turn/start 不刷新内核 agent 构造时缓存的 phase.lastTurn → 内核下一条 prompt 重开同一 turn → session.jsonl 重复 turn/start（实机 turn 序列 1,1,2..18）→ 前端 ConversationNodeAssembler「received more than one start Match」崩溃 → event feed subscriber 死亡 → turn-process 节点（折叠行）不再组装。修：①源头——物化后同步 agent phase.lastTurn（inject 'agents'）；②存量——启动扫描磁盘手术 repairDuplicateTurnStarts（重编号重复段，实测修复 22 个会话）。
- **R54 匀速滑动**：窗口化协调器补偿只覆盖翻转批次，不覆盖视口上方条目内容渐变（iframe 高度渐进上报/图片字体加载）→ 内容被推下。修：ResizeObserver 对 rect.bottom<=0 的条目按高度差实时补偿 scrollTop（overflow-anchor 已禁用，本协调器全权补偿）。

**实机验证（模拟器 x86_64，修复后）**：656 单测全绿（+1 新回归锁：散文+HTML卡块+```js 混排逐块切分）；折叠行「1 tool call · 1 message」回归；一整轮对话 assembler 零崩溃；代码围栏渲染成 pre/code、rawHtmlLeak=0；iframe 探针卡 parent.$=function/parentDoc=ok（同源+卡脚本复活）；静置漂移 8s=0px；无异常窄容器（竖排未再现）；verify-hooks 全套回归绿。

**产物**：`DSH-Tavern-0.2.0-arm64-release.apk`（v154）+ `DSH-Tavern-0.2.0-x86_64-debug.apk`（v155，发货冒烟全绿）。
