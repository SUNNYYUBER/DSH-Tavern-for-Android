# ROBUSTNESS-LOOP — 鲁棒性专项修复日志（8h loop 第 1 轮，2026-09-08）

基线：vitest 656/656 全绿。工作方式：找边缘 bug → 最小修复 → 单测回绿 + 模拟器实证。

---

## [BUG-001] rp/state/<sid>.json 与 undo 日志裸 writeFile 撕裂风险
- **症状**：`rp/state/<sessionId>.json` 是 MVU 变量树唯一权威落点；undo 回放（saveScopeTree）、MVU register、TH 脚本变量写三方并发时用裸 `writeFile` 直写——并发半写 = 「新文档+旧文档尾部」拼接恒 parse 失败（项目既有实锤教训：世界书 lore.json 被撕过两次）；undo 日志截断同理（撕裂尾 → readUndoLog 坏行跳过 → 静默丢撤销条目，回退变量恢复不完整）。
- **根因**：I8-2 原子写只在 dsh-plugin/index.ts 内部实现，shared 模块（undo.ts）与 dsht-plugin-mvu 未采纳。
- **修复**：新增 `packages/src/dsht-plugin-shared/atomic-fs.ts`（temp 独占创建+fsync+rename+父目录 fsync）；undo.ts `saveScopeTree`（三作用域）+ undo 日志截断、dsht-plugin-mvu `saveSettings`/`saveStateFile` 全部换 `atomicWriteText`。
- **验证**：vitest 656/656 回绿（先跑出 1 例 facade.spec 时序脆弱失败，单跑过、复跑全量绿，确认负载相关非回归）。

## [BUG-002] live 回退/编辑/重新生成：claim 与 marker replace 之间被 await 打断
- **症状**：live 路径顺序为 `append(compaction/prune claim)` → `await replayUndoLog(...)`（文件 IO，几十 ms~百 ms 级）→ `append(marker, surfaceOp replace)`。影子化协议铁律「claim 必须紧邻 replace」被 await 打破——若 turn 正在运行，agent-loop 的 append 可插进两者之间，投影/meter 漂移。
- **根因**：undo 回放排在 claim 之后。
- **修复**：dsh-plugin/index.ts 三处（session-rollback/edit live、session-regenerate live）把 `replayUndoLog` 挪到 claim 之前，claim → marker 变成相邻同步调用。
- **配套（前端）**：RpUserNodeView 回退/编辑按钮 + 回调加 `running` 守卫（与 RpRegenerateAction 同款）——turn 运行中禁回退/编辑入口，消除并发窗口的人为触发面。
- **验证**：vitest 656/656 回绿；模拟器回归见 BUG-007。

## [BUG-003] 非 live session-rollback 分支漏清 rollbackMaskCache
- **症状**：非 live 回退（脚本化 API 场景）后 mask 缓存不 clear；同 mtime 粒度内对同一会话先回退再查询，前端拿到旧掩码（编辑/重新生成分支都有 clear，唯独 rollback 非 live 分支漏）。
- **修复**：dsh-plugin/index.ts 非 live rollback 分支补 `rollbackMaskCache.clear()`。
- **验证**：vitest 656/656 回绿。

## [BUG-004] 模拟器 bundle 陈旧（今日主线修复未上设备）
- **症状**：设备上 `/rp/build-info` 404、`dsh-client-ui-chat` 无 DSHT-CHAT-FOLD-READY 标记——今日主线 agent 的 8 项修复全部不在模拟器上。
- **修复**：esbuild 产物（staging 16:41 版，比源码新）热推双写（dsh-runtime + profiles/web 两处）+ dsh-client-ui-chat/client.js（fold-ready）推 dsh-runtime；force-stop 重启；md5 + marker 双验（build-info=1、fold-ready=1）。
- **验证**：重启后 `/dsht-rp/rp/build-info` → 200 `{sentinel:".installed-v123", dshVersion:"0.1.2-rc.1"}`。

## [BUG-005] 窗口化锚点补偿：丢失回执的陈旧任务挂到后续批次（「画面跳动」候选向量）
- **症状（静态审查 + 定位）**：chat-windowing.ts 的 `pendingCompensation` 单槽无过期、无存活性校验。翻转批的回执依赖翻转条目 useLayoutEffect 调 reportWindowCommit；若条目在同一 commit 中被卸载/掩码隐藏（return null），回执丢失——陈旧任务（含旧会话的 container/anchorEl）会在之后**任意一次**翻转批被应用。跨会话切换后 anchorEl 已 detach（rect 全 0）→ delta = 0 + 当前 scrollTop − 旧 anchorDocTop → 视口随机跳。
- **修复**：pendingCompensation 加 `expiresAt`（350ms——翻转批回执恒在同帧落地，正常路径零影响）+ 执行前校验 `anchorEl.isConnected && container.isConnected`，过期/失联即丢弃。
- **验证**：模拟器大会话（session-wuwa-migrated-01，138k px 文档）三场景探针：吸底静止 25s（漂移 0）、中部静止 25s（文档增高 333px = scrollTop +333px，补偿精准、视觉零漂移）、8 次甩动+15s 观察（maxStep=0、reversals=0）。vitest 656/656。

## [BUG-006] TH 写桥 chat/update：shadowedTokenCount 用新文本计量（meter 漂移）
- **症状**：setChatMessages 改写楼层时，`compaction/prune` claim 的 shadowedTokenCount 按替换后的**新文本**长度计——meter 记账对象是**被移出视图的旧事件**：新文本更短 → meter 少记移出量；更长 → 多记（影子化协议「必须用核心估价器口径」铁律的计量对象错误）。
- **修复**：dsh-plugin/index.ts chat/update 改为按被影子化旧事件的 blocks 计（与 session-rollback 路由同口径：text/reasoning 按 len/4+4，其余 4+JSON/4，每事件 +4）。
- **验证**：vitest 656/656。

## [BUG-007] RpPresetSwitch 切换预设后 display 正则不刷新（「切了没反应」同类残留）
- **症状**：UI 切换 RP 预设成功后只调 invalidateWsCache()（清缓存）——useDisplayRegexes 的 effect 依赖 [slug, sessionId, **epoch**]，displayEpoch 不 bump → 已挂载楼层永不重取预设作用域 display 正则，显示面滞留旧预设正则直到重开会话。主线 agent 已给 TH 脚本的 preset:put/preset:load 加了 notifyDisplayMutation，但 UI 自身的 preset/select 路径漏了同款处理。
- **修复**：RpPresetSwitch.select() 成功路径改调 notifyDisplayMutation()（= 清缓存 + bump epoch + 订阅楼层重渲染）。
- **验证**：vitest 656/656；bundle 计数探针（notifyDisplayMutation 4 处 = 定义+ScriptHost 2+PresetSwitch 1）+ md5 双写核验。

## [BUG-009] build-info 恒报最旧哨兵版本（NodeService 哨兵残留 + find() 目录序）
- **症状**：模拟器装 v178 新 APK 后 `/rp/build-info` 仍报 `.installed-v123`——NodeService 每次升级只写新哨兵文件不删旧（实机 `files/dsh-runtime/` 残留 28 个 .installed-v123..177），路由 `entries.find(startsWith('.installed-v'))` 按目录序取到最旧的 → 「我装的到底是不是最新包」的显示面恒错。
- **修复（双层）**：① dsh-plugin build-info 路由改为解析 vNNN 数值取最大（最近一次成功解压）——插件侧，热推即生效；② NodeService.kt `ensureRuntime` 解压成功发布新哨兵后清理其余 .installed-v*（源码，下个 APK 固化）。
- **验证**：模拟器 build-info 由 v123 → **v178**（与实际安装的 APK sentinel 一致）；vitest 659/659。

## [BUG-010] 记忆插件不感知回退掩码：被回退的内容被重新摘要进记忆本（数据污染）
- **症状**：`extractFloorsFromEvents` 从 session.jsonl 全量日志数楼层——回退（live replace）后的日志保留被回退事件，后续 summarize chunk 会把这些楼层重新摘要进记忆本（用户明确撤回的内容经记忆注入「复活」进上下文）；且楼层号与 UI（掩码后重排）错位，记忆锚「记忆#N」漂移。
- **修复**：dsht-plugin-memory extractFloorsFromEvents 增加回退 marker 预扫（rolledBackTo/regeneratedFrom/editedFrom-1 + marker 自身 seq 构造跳过区间），真实消息 seq 落在 (hideAfter, markerSeq) 内整条跳过（不计数、不进摘要）；无 seq 的老数据退化为旧口径。**与 UI 掩码失效语义有意不同**：UI 在 marker 后出现新真用户消息时整体失效（回看全量），记忆侧区间永久跳过（回退的内容永远不该经记忆回流）。
- **验证**：新增 3 个回归测试（区间跳过 / includeAnchor+editedFrom 锚点语义 / 无 seq 退化不误伤），memory-plugin.spec 40/40，全量 659/659。

## [BUG-008] dsht-plugin-undo 会话截断裸 writeFile（PC 线，撕裂=数据丢失）
- **症状**：undo 插件三处手术写（rollback/regenerate/edit 的 .bak + 正件）与快照清单写全用裸 writeFile——进程被杀/断电在写中途 = session.jsonl 尾部撕裂或快照索引失效。dsh-plugin 同款手术 2026-09-04 已修（I8-2），独立插件脱漏。
- **修复**：undo/index.ts 三处截断写 + workspace-snapshots.ts 快照清单写换 atomicWriteText（blob 池 'wx' 内容寻址写天然幂等保留）。注：该插件不在 Android 构建清单（NodeService 写死名单），修复待 PC 线/下次构建采纳。

## [e2e-1] 「回退到此处」→ inputActions 通道定案：**通**（任务遗留疑问点闭环）
模拟器弃用分支会话（session-fdfc1a28）全链路实测：点回退按钮 → 原生 confirm 弹窗（allow-modals 桥）→ adb 点确定 → composer 文本变为原文「（冒烟）一句话即可。」（inputActions.setDraft 生效——宿主 runner 对 session 域席位确实传 inputActions，runner bundle 静态审查 + 实测双证）→ floors 7→2（掩码隐藏生效）→ /rp/rollback-mask 返回 hideAfter=12（marker 落盘正确）。
另：runner 对 session 席位的 standardProps 清单静态确认含 useChat + inputActions（dsh-cordis-client-runner bundle）。

## [e2e-2] 折叠行（DSHT-CHAT-FOLD-READY）大会话验证
fold-ready 补丁热推后，迁移大会话（319 turn）渲染 27 条 turn-process 折叠行（旧 bundle 被 historyIncomplete 全阻断=0 条）；其中 16 条带按钮。迁移会话无工具数据（data-turn-process-messages=0）的行高 0 不可见 = 正常态，与带真实工具数据的 live 轮（早轮已验）互补。

## [e2e-3] 📎 上传按钮全链路 e2e（新 APK v178 上闭环）
①宿主监听对齐：dsh-client-ui-attachment 的 onDrop 绑 **document**（MobileAttach 的 document.dispatchEvent(drop) 可达）；②CDP 页内合成 File+DataTransfer 派发 drop → 原生附件预览出现（imgsFound=1，探针附件已清除）；③新 APK（含 MainActivity onShowFileChooser）真实触摸 📎 → **PhotoPickerGetContentActivity 弹出**（dumpsys mCurrentFocus 实证）。
**测试教训**：`adb input tap` 用物理像素（1080×2400），CDP rect 是 CSS 像素（393×873，DPR 2.75）——不乘 DPR 的 tap 全部点偏（此前三轮「按钮无响应」假象皆此因）；大会话空闲物化期布局持续漂移，合成点击测坐标不可靠，必须等 windowed=0 布局稳定后再测。

## [e2e-4] 今日主线修复复验汇总（模拟器 v178 包）
- 折叠行（DSHT-CHAT-FOLD-READY）：319 turn 大会话 27 条 turn-process 行渲染（旧包 0 条）✓
- 回退语义（includeAnchor + 原文回输入框 + 掩码 hideAfter=12）：e2e-1 全链路 ✓
- build-info 路由：200 + sentinel 正确（BUG-009 修复后）✓
- 📎 上传：e2e-3 ✓
- 存储权限：新 APK manifest 含 MANAGE_EXTERNAL_STORAGE + onShowFileChooser（PhotoPicker 实弹）✓
- builtin 门面/提示词模板预种：TH 桥 vars/preset/wb 调用日志持续 ok=true（脚本心跳实测）✓
- 「画面跳来跳去」：当前包三场景探针（吸底/中部/甩动）零漂移零振荡；「待查-1」陈旧补偿向量已加熔断（BUG-005）。历史报告对应旧包的已修缺陷（双重补偿/翻转振荡），本轮无复现。

## [热推陷阱备忘]
- **build-rp-ui.mjs 不自动拷贝 client.js 到 staging**（dsh-runtime-android/node_modules/dsht-rp-plugin/lib/）——构建后必须手动 Copy-Item 再 push，否则推的是旧 bundle（本轮实测抓到：推完字节数与旧包一致暴露）。与 esbuild「报成功但产物旧」同族坑。
- 模拟器冷启动后主线程被会话物化占满（CDP evaluate 超时 ~1 分钟）——探针超时需放宽到 60s。

---

## 待用户决策
（暂无）

## 构建状态备注（交棒主线）
- **模拟器（x64 debug）**：v178 APK（17:44 产出，已安装）+ 三组热推补丁（memory 掩码感知 / build-info 最大哨兵 / client 预设切换 epoch）——当前设备 = 全部修复生效态。**重装 APK 会 re-extract runtime.zip 覆盖热推**，打新包前源码已全就绪，直接跑 build-dsht.ps1 即可固化。
- **arm64 真机包**：当前根目录的 arm64 APK 不含本轮修复；固化为交付包时重跑 `build-dsht.ps1 -Arch arm64`（NodeService 哨兵清理 / BUG-010 记忆掩码 / BUG-009 双层修复都会自动编入）。
- 本轮改动文件清单：packages/src/dsht-plugin-shared/atomic-fs.ts（新增）、undo.ts、dsht-plugin-mvu/index.ts、dsht-plugin-tavern-helper（无改动，tree-shake 验证）、dsh-plugin/index.ts、dsht-rp-ui RpNativeChat.tsx / chat-windowing.ts / RpPresetSwitch.tsx、dsht-plugin-memory/index.ts、dsht-plugin-undo/index.ts + workspace-snapshots.ts、android NodeService.kt、tests/memory-plugin.spec.ts。git 由并行 agent 管理，本轮零 git 写操作。

## 时序脆弱用例备忘
- tests/facade.spec.ts「entry-put：uid 锚定原位替换」——全量负载下 350ms 等待偶尔不够（单跑恒绿）。非本次引入。

---

# 第 4 轮（2026-09-08 晚，WorkBuddy 接手）：build-info 死代码修复（真机实证）

基线：v184 staging 产物热推至模拟器后逐路由实测发现。修复者：WorkBuddy（接手后首个实机闭环）。

## [BUG-011] /rp/build-info 是死代码——GET 恒 404，用户痛点自查工具自身失效
- **症状**：GET `/dsht-rp/rp/build-info` 恒 404 text/plain；POST + 合法 body 反而 200 返回哨兵数据。诊断面板「构建 vNNN」永远无法工作——**「我装的到底是不是最新包」（用户 2026-09-08 痛点，BUG-009 立项动机）的自查通道本身是断的**。
- **根因**：同文件并行编辑竞态又一例（与 R6/R17-27/R35 同族）。build-info 分支被错位粘贴到 POST-only 区（`if (req.method !== 'POST') return send(405)` 守卫之后、`/rp/status` 块之后）——GET 块在 L3650 的 `return sendText(404,'not found')` 兜底先命中，该分支对 GET **不可达**；esbuild 不管可达性、670 单测未覆盖 HTTP 分发、静态扫描看不出异常——**三层验证全部放行，只有真机逐路由实测能抓到**。
- **修复**：分支迁回 GET 块兜底之前（源码 L3657）；响应新增 `fixTag` 字段（`wb-fix-0908`）作为**部署指纹**——此后热推/装包后 curl 一次即可验证「设备跑的是哪份产物」，接手方案第 1 层（构建-部署可验证链）的第一个落地物。
- **实机验证（emulator-5554）**：GET 200 `{sentinel:".installed-v178", dshVersion:"0.1.2-rc.1", fixTag:"wb-fix-0908"}` ✅；POST 无 body 400（payload 守卫正常）✅。
- **环境教训（与主史 L2320「冒烟被残留进程骗过」同族）**：模拟器 force-stop 是异步的、启动慢（本次 node 注册耗时 10-120 秒不等），**重启后必须以 logcat 的 `[dsht-rp] data plane on webServer route` 标记为同步点再发请求**，`sleep N` 不可靠——本次前两轮"改了没生效"的假象即此因（curl 打到垂死旧进程）。
- **顺手实证**：设备哨兵 28 个残留（v123-v178，BUG-009 的 Kotlin 侧清理因热推无法更新仍在）——arm64 v184 APK 内已固化，模拟器需下次出 x86_64 包才吸收。

---

# 第 3 轮（2026-09-09 晚，v179→v181）：Kemini 适配根修 + 4-agent 并行扫描 34 bug

基线：665 测试 → 670 测试全绿。工作方式：4 个并行 Explore agent（后端路由/前端组件/th-shim/MVU+模板+memory）逐行扫描 → 确认 bug 按严重度排序 → 分两批修复 → 全量回归。

## A. Kemini 适配三根因（用户截图「思维链变形 + 逐字竖排 + 画面跳动」）

| # | 根因 | 修复 |
|---|------|------|
| A1 | sanitizeDisplayHtml 属性值只认双引号——单引号/无引号 class/style 全丢 → 布局崩坏 | 三形态匹配（`"…"`/`'…'`/裸值）；SANITIZE_STYLE_PROPS 从 8 个扩到 50+（flex/width/padding/border/gap/writing-mode…），position 族仍排除（悬浮球 iframe 舞台 P0-2 不受影响） |
| A2 | details/summary 不在 SANITIZE_TAGS → Kemini 思维链折叠产物（`<details>`）整块 sanitize null → 强制转 iframe → 帧内 100vh 布局随 iframe 高度反馈循环 | details/summary 入白名单（结构标签与 div 同级安全），思维链折叠内联原生渲染 |
| A3 | FRAME_MAX_HEIGHT=12000（手机 ≈14 屏）放大 vh 反馈循环 | 降到 3000；循环快速收敛到 mount 容器顶格内部滚动（height≥MAX 时 overflow:auto 已有） |

## B. 会话标题裸显协议标签（`<status> [...]`）

dsh-session-title 的 cleanTitleText 只清控制字符。平台补丁 **P3-5a（DSHT-TITLE-DETAG）**：剥成对标签 + 未闭合标签尾。已同步 build-dsht.ps1 挂链 + 手动打当前 runtime。实测：`<status> [...]`→`[...]`、`<interactive_input>\n$1`→`$1`。

## C. 4-agent 并行扫描 → 24 项修复

**前端（RpNativeChat.tsx）**
1. floorIndexOf 漏写 floorIndexCacheKey → rollbackMask 异步到达后恒 miss（O(N²) 每帧重算 + mask 回退陈旧命中）
2. windowed 未入 3 个 DOM 后处理 effect deps → 窗口化往返后台词着色/代码块增强永久丢失
3. useVariantGroups：nodeCount 依赖是死代码（重 roll 后变体条 ‹n/m› 永不出现）+ 失败写 [] 缓存永不再重试
4. useDisplayPipeline 订阅 display epoch + invalidateWsCache 补清 ctx/entries TTL 缓存（Kemini 开关后宏展开用旧变量树）

**th-shim**
5. eventOn/eventOnce 幂等 + MakeFirst/Last 移动语义（重复注册 = N 次执行副作用放大）
6. 补真 TH 公开 API eventClearListener
7. getChatMessages 补 option{role,hide_state}（原第二参数整个丢弃）
8. dshtMessageView 补 extra/swipe_id/swipes（卡读 msg.extra.token_count 不再 TypeError）
9. {{match}} → /gi（全局大小写不敏感，对齐 ST 引擎）
10. EjsTemplate evalTemplate fetch 加 20s AbortSignal.timeout（原裸 fetch 永久 pending）
11. call() 非幂等写（chat:append/injects:*/mvu:replace/buttons:set/wb:entryPut）超时不重试——防 createChatMessages 重复追加整组消息

**MVU（state/mvu.ts）**
12. parseJsonPatches 改 matchAll——多 <JSONPatch> 块原只解析第一个（变量更新静默丢）
13. op 白名单——未知 op（test/apend）原落兜底赋值分支（"test" 把好感度真实置 null）
14. 数组越界：add 尾追 / replace 跳过（原 arr[5]='x' 稀疏 null 槽污染状态树）

**prompt-template**
15. worker messages 分支补 ok 字段（原恒 400——compileWorkers 开启时整个批渲染失效）
16. renderMessages per-message try/catch（单条未闭合 {{/<% 的脏消息不再炸整批）
17. render-entries evalOne subset 分支 fail-soft（单条坏世界书条目不再 500 全端点）

**memory**
18. saveSheets 字段级 merge + atomicWriteText——LLM 秒级窗口期旧整树覆写回滚 cursor/变量/presetId
19. 摘要失败指数退避 20s→2min→10min（原无限 20s 重烧 LLM API，内容过滤触发时必现）

**dsh-plugin 后端**
20. shadowedTokenCount 解包 data.message——assistant 消息原每条只计 4 token（meter 严重少记；chat/update 已修而 rollback/regenerate 漏同步）
21. payload 为 JSON null/数组 → 400（原 TypeError 统一 500）
22. findLastUserMessage 排除 source.kind==='plugin'——回退/重新生成 marker（「[已回退]…」）被当锚 → marker 文案被当用户输入重发垃圾楼层（kind 缺失视为真用户，旧数据兼容）
23. session-edit 非 live 补 409 live 守卫（漏防文件手术 vs 内存 flush 竞态）
24. live rollback/edit/regenerate 加 withLiveSurgery per-session 串行链（await replayUndoLog 窗口内并发请求捕获过期视图 → 错位 replace + meter 双记）
25. flushEntryPuts 并发洞：flush 期队列保留（新 put 入同一内存权威副本）+ 完成后重入队 + per-book flush 串行链（原先 delete 后异步落盘 = 已确认 put 静默丢写 + GET read-your-writes 失效）

**RpScriptHost**
26. mountGen 代数计数器（reloadAll/destroy 递增）——fetchFrameVars await 窗口内点重载 → 同脚本双 iframe 双执行，旧帧不在 frames 里永远摘不掉

## D. 未修（记录在案）
- collectSessionsAudit 全量读入每个 session.jsonl（254MB 会话 OOM 风险）——建议超阈值文件流式/首末行读取，留第 4 轮
- replaceScriptButtons 忽略 script_id（跨脚本按钮管理错写对象）——需桥协议扩展，留第 4 轮
- setChatMessages 静默丢 is_hidden——诚实失败改造留第 4 轮
- memory /reset 与进行中总结的竞态（reset 代数计数器）——留第 4 轮

## E. 交付
- v180 = A/B + C1-C19；v181 = C20-C26（并发一致性批）
- 均交付 D:\DSH RolePlay\DSH-Tavern-0.2.0-arm64-release.apk（固定路径）+ _pending-deploy
- 测试：659 → 670（新增 sanitize 6 + mvu 4 + marker 锚 1 回归）

## F. 第 4 轮清尾（2026-09-09，v182）——D 节 4 项全部落地

| # | 项 | 修复 |
|---|-----|------|
| F1 | collectSessionsAudit 全量读入 OOM | 改 createReadStream + readline 流式逐行（内存恒定），只取 header（首非空行）+ 行数 + 末行 time；254MB 会话审计/自动清理不再崩 node 进程 |
| F2 | replaceScriptButtons 忽略 script_id | shim 透传第二参（buttons:set args[1]）；host handleBridgeCall 校验目标脚本存在（不存在显式报错，不再静默改写调用方自己的按钮）；ThBridgeDeps + buttonsExists |
| F3 | setChatMessages 静默丢 is_hidden | 诚实失败：检测 is_hidden/swipe_id/swipes → reportMissing + __thExpected reject（错误消息指引用移除字段重试；文本/data 照常可写） |
| F4 | memory /reset 与进行中总结竞态 | per-sid resetGens 代数：/reset 先递增再清数据；summarizeSession 加 isStale 守卫（LLM 完成后与落盘前两次校验），tick 的 saveProgress 前再校验——旧区间条目不再复活 |

交付：v182（D:\DSH RolePlay\DSH-Tavern-0.2.0-arm64-release.apk + _pending-deploy，仅留此包）。测试 670 全绿。**鲁棒性 loop 全部 30 项修复闭环，零尾巴。**

## G. 按钮面收口 + 适配 Skill 指南（2026-09-09，v183）
- **按钮四件套全量支持目标脚本**（补 F2 的缝）：getScriptButtons(script_id?)、updateScriptButtonsWith(updater, script_id?)（updater 收**目标**脚本按钮）、appendInexistentScriptButtons 双形态（(script_id, buttons)/(buttons)）——host 侧 buttons:get/set 都带目标解析 + buttonsExists 校验（目标不存在显式报错）。此前 updateScriptButtonsWith 带 script_id 仍会改写调用方自身（getScriptButtons 无目标参数的缝）。
- **适配 Skill 接入指南**：st-migration skill 新增 `references/th-buttons.md`（跨脚本按钮管理通用契约：识别→数据落盘→id 重铸 fallback 检查→装载时序坑→非幂等重试约定→迁移检查清单→排障速查）+ SKILL.md 挂「酒馆助手脚本与按钮面」节。skill 源头 = packages/src/dsh-plugin/assets/skills/st-migration/（构建期进 assets，运行时 syncAssetTree 同步 $DSH_HOME；pc-verify-home 副本已同步）。
- 交付：v183（_pending-deploy 仅留此包）。670 测试全绿。

## H. skill 内容对齐更新 + 原子写彻底收尾（2026-09-09，v184）
- **st-migration skill 过时内容修正**（多轮修 bug 后契约已变，skill 文档滞后会误导适配 agent）：
  - SKILL.md：rollback/regenerate 路由描述改双路径新语义（includeAnchor、logical 响应、锚排除 plugin marker——旧「live 会话拒绝」已废）；display 正则说明更新（details/summary 折叠类 + 布局样式类正则 v183 已内联渲染，遗留事项只剩 position 类悬浮部件）；EJS render 批渲染可用（fail-soft）；POST body 必须 JSON 对象约定。
  - st-plugins-assessment.md：修正酒馆助手评估的**过时结论**——旧「脚本沙箱无 DOM、DOM 注入脚本不生效」已不成立（v183+ 真 TH 同源 iframe 形态），悬浮球/fixed 部件类脚本可正常运行；能力概览同步为当前完全体（写桥/正则三源/预设 CRUD/按钮四件套等）。
- **原子写彻底收尾**（第一轮扫描的最后一批残留，全部 session.jsonl 关键路径）：repairSessionCwds（.bak + 原子发布）、convert-chat 文件模式、rebuild-chats（.bak2 备份原子化 + 主文件原子发布）、欢迎会话首建。裸 writeFile 写 session.jsonl 清零——撕裂 = 会话打不开的风险面归零。
- 交付：v184（_pending-deploy 仅留此包）。670 测试全绿。
