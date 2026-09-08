# ST-COMPAT-PACT：SillyTavern 兼容层范式契约（唯一范式文档）

> 建立：2026-09-07。回答一个根本问题：**「把 ST 的前后端使用体验以插件形式搬到 DSHT」这个方向错了吗？**
> 答案：方向没有错，错的是做法——过去把「兼容」当成一处处临时补丁，而不是一份明确的契约。
> 补丁会互相打架（修 A 坏 B），契约不会。本文档就是那份契约，此后的兼容工作一律引用本文的条款编号。

---

## 1. 项目范式定位（一句话）

**DSHT 不是「移植的 SillyTavern」，而是「ST 生态资产的宿主无关兼容层 + 一个原生宿主」。**
角色卡、世界书、预设、正则、TH 脚本都是「资产」；我们把它们翻译成 DSH 原生形态去执行。
翻译层（compat layer）的每一项行为都是**契约条款**——条款可以升级，但不允许漂移。

用户价值主张（对 ST 玩家的承诺）：
**导入 zip → 跑 st-migration 适配 skill → 获得 ST 同等乃至更好的体验。**
这句话就是验收标准，本文所有条款都为兑现这句话服务。

## 2. 为什么过去「越修越多」（结构性病因，不是人的问题）

| # | 病因 | 后果 | 范式解法 |
|---|------|------|----------|
| P1 | **迭代回路太长**：每个前端修复都要 构建→打APK→装机（30min+） | 手机永远跑旧代码：修复「不存在」于用户设备；新 bug 与旧 bug 混在一起，用户与 AI 都在对着幻影调试 | §4 验证回路：模拟器热推（3 秒）+ probe 套件；APK 只作交付不作调试 |
| P2 | **无兼容契约**：sandbox 形态、reasoning 折叠、标签解析等语义散落在代码里 | 改一处动全身（如折叠行、楼层头多次回归）；每个 bug 都像新大陆 | 本文 §3 条款化；改动必须引用条款号 |
| P3 | **无回归样例**：ST 行为没有 fixture，回归靠人眼 | 同一 bug 反复出现（折叠行消失至少 2 次） | §4.2 合成会话 fixture + DOM 断言 probe，前端每次推送后自动跑 |
| P4 | **失败静默**：sandbox 吞 confirm、shim 缺 API 只记名不告警、脚本初始化抛错无感 | 「看起来能点但没反应」「无任何错误」类 bug 占比极高 | §3-C 条款：兼容层失败必须可见（状态面板/控制台/console 转发） |

## 3. 兼容契约条款（改动引用这里）

### A. 渲染管线条款
- **A1 消息渲染**：assistant/user 文本 = ST `messageFormatting` 等效语义：markdown 段 + 行内 HTML 白名单段 + 完整 HTML 文档段（iframe）+ 未知标签解包隐藏 + 游离闭合标签丢弃。ST 上能渲染的，这里不允许裸显源码。
- **A2 reasoning 折叠**：`reasoningTags` = 并集语义：ST 原生四标签（think/thinking/reasoning/thought）∪ 卡显式配置。折叠行文案对齐 ST（「思考了一会」/「思考了 X · 任务耗时 Y」）。
- **A3 楼层结构**：assistant 楼层 = 顶部横排楼层头（头像+名字+#N+耗时+时间，sticky 钉视口顶）+ 全宽正文。**禁止**常驻左列布局（文字右偏，2026-09-07 用户拍板废除）。
- **A4 正则/世界书/预设**：作用于文本管线的位置与 ST 等效（display/prompt 时机），由 st-migration 翻译，不允许卡特异性硬编码。

### B. 脚本运行时条款（TH shim）
- **B1 iframe 形态**：每脚本一 iframe，`sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"`（真 TH 同源形态 + 对话框/表单/弹窗全开——2026-09-07 实证缺 allow-modals 时 confirm() 被 Chromium 静默丢弃，是「飞讯 openChat 无响应」与 MVU 大量「点了没反应」的根因）。消息帧（RpMessageFrame）同条款。
- **B2 对话框三件套**：confirm/alert/prompt 必须有真实模态实现（Android WebChromeClient AlertDialog）。语义 = 浏览器同款：阻塞等用户操作，回填结果。
- **B3 API 面**：TavernHelper/SillyTavern.getContext/Mvu/$/_/z 按真 TH 面提供；未覆盖的 API 调用必须**记名上报**（ScriptStatus.missing）并在脚本管理面板可见——不允许静默 undefined。
- **B4 事件投递**：MESSAGE_*/GENERATION_*/按钮事件按真 TH 时序投递给 enabled 脚本。

### C. 可见性条款（失败必须出声）
- **C1** 兼容层任何降级/跳过/缺失必须留下可见痕迹（console.warn + 状态面板 + C15 日志抽屉三者至少其一）。
- **C2** runtime 容错：单个坏资产（会话文件身份漂移等）不得崩整个 runtime（DSHT-RESILIENT-LIST 补丁语义：自愈→兜底跳过+告警）。

### D. 通用性条款（回应用户「不要只适配一张卡」）
- **D1** 禁止卡特异性逻辑出现在通用层（th-shim/display-compiler/RpNativeChat/style）。卡差异只允许来自**数据**（卡自带的 outputProtocol 配置、正则、脚本），不允许来自**代码分支**。
- **D2** 修复一个卡的交互问题时，必须把修复落在「那一类机制」上（§2-P4 的根因分组），并在 PR/提交说明里引用本文条款号。修复完示例游戏卡 ≠ 任务完成；跑通 fixture 库 ≠ 才算完成。
- **D3** st-migration 适配 skill 是唯一的「卡→DSH」翻译点；翻译产生的差异要回流到 skill，而不是散落到前端代码。

## 4. 验证回路（工程动作，已实证）

### 4.1 前端热推（秒级迭代；P1 的解法）
```powershell
# 1) 构建（esbuild，毫秒级）
node rp-workspace\scripts\build-rp-ui.mjs
# 2) 热推模拟器（设备需 adb root；debug APK）
adb -s emulator-5554 push rp-workspace\packages\src\dsht-rp-ui\lib\client.js `
  /data/data/com.dshtavern.app/files/dsh-runtime/node_modules/dsht-rp-plugin/lib/client.js
adb -s emulator-5554 shell "chmod 600 <目标>; chown u0_a209:u0_a209 <目标>"
# 3) CDP reload（pid 变了要重建 forward）
```
真机（release，无 root）走 USB 安装 debug 变体或等待 Sentinel 机制；**原则：调试永远在模拟器，APK 只做交付**。

### 4.2 回归 fixtures（P3 的解法，种子已建）
- `tmp/append-foldtest.mjs`：向会话注入合成轮（thinking 标签 + details 折叠 + MVU 交互框）。
- `tmp/verify-fixes.mjs`：DOM 断言（折叠行存在/楼层头 sticky 横排/iframe sandbox token/帧可点击）。
- `tmp/test-scroll.mjs`：20s 滚动漂移采样（断言 scrollTop 不变）。
- `tmp/test-enter.mjs`：换行键拦截断言（defaultPrevented=true）。
**规则：每修一个用户可见 bug，必须新增对应 probe；每次热推后 probe 全绿才算修复。**

### 4.3 实证基线（2026-09-07 全绿）
折叠行渲染 ✅ / 楼层头横排 sticky ✅ / sandbox token ✅ / 帧内按钮 DOM 更新 ✅ / 滚动 20s 零漂移 ✅ / 换行拦截 ✅ / confirm 模态 ⏳（等新 APK）

## 5. 迁移分层路线（范围控制）

| 层 | 内容 | 验收标准 | 状态 |
|----|------|----------|------|
| T0 | 聊天渲染（markdown/HTML/reasoning/正则/楼层） | 与 ST 截图基准逐项对照 | ✅ 基本达成 |
| T1 | 世界书/预设/变量三级作用域 | 数据面 probe + 卡脚本实测 | ✅ 大部分达成 |
| T2 | TH 脚本运行时 | B3 API 面逐项标记 支持/部分/缺失；missing 记名面板 | 🔨 进行中（本次 confirm/sandbox 修复属于此层） |
| T3 | 长尾 API（静音角落） | missing 记名驱动，按使用频率排序补 | 📋 按 B3 面板数据决定 |

**纪律：一次只深一层。T2 没全绿之前，不开 T3 的新战线。**

## 6. 给项目未来的一句话

这个项目不是「一个满是 bug 的屎山」，而是**「一个已经跑通核心价值、但缺契约和验证回路的早期系统」**。
前者没有未来，后者有明确的路：把今天做的这些（契约文档、热推回路、fixture 种子、根因分组修复）
变成习惯，每个循环 bug 单调递减。发 GitHub 的时机 = T2 全绿 + 本契约文档进仓库——
届时 README 讲的故事是「ST 资产的原生 Android 宿主，导入即用」，这在生态里是独一无二的位置。

---

## 附录：交互元素审计登记（2026-09-08 loop 实测，182 元素/115 点击）

审计结论：**帧内 JS handler 全部在位、数据面健康**（sandbox/modals 修复后）；
「点了没反应」集中在真实触摸层，按机制分六类登记。六类全部落地（A 含注册表协商；
唯一让步：协商为同意式——用户点「自动避让」才动脚本窗口位置，不破坏作者布局意图）。

## 附录二：第二轮深度审计（2026-09-08 专项 loop，95✅/8❌/10⚠️/12SKIP）

修复验证：confirm 双路径（OK/CANCEL 原生弹窗→返回值回传）✅、遮挡 lint ✅、装饰守卫 ✅、
触屏揭示 ✅、协商触发 ✅。第二轮抓出并已修复：

| # | 问题 | 修复 |
|---|------|------|
| R2-A | 帧池跨会话复用 + LRU 8 帧 4 会话轮换不够 → 驱逐重执行（状态清零） | frameKey 无条件带 sessionId（消灭跨会话身份漂移）；LRU 8→16 |
| R2-B | 协商避让不持久：脚本切会话自复位浮窗、协商一次性不重弹 | 避让偏移按浮窗身份存 localStorage；同身份再登记静默重放（实测刷新后重叠 2137→0，savedOffset {dx:0,dy:15}） |
| R2-C | 遮挡 lint 一次性快照滞留误标（7/2/4/5 波动） | lint v2 可重跑：先清全部旧标记再重算，帧内 MutationObserver 防抖 800ms 增量刷新 |

登记待办收口（2026-09-08 第三轮前完成两项）：

| # | 问题 | 修复 |
|---|------|------|
| R2-E | shim 异步 API 偶发无回包 → 卡脚本 await 永久挂起（示例游戏「正在读取全局剧情数据」） | shim `call()` 加 20s 超时守卫 + 一次自动重试；再超时 reject（错误进 script-error 信标可见），卡自身 catch 路径可走。注意测试 VM 可能缺 clearTimeout——防御性引用 |
| R2-F | `$('#send_textarea').val()` 类 ST 同步内联依赖读不到 DSH 输入区（**推翻旧结论「同步语义无法桥接」**——同源 iframe 可同步访问 parent.document） | 脚本 iframe 的 parent jQuery 合并层加 **ST 选择器映射**：`#send_textarea` → `[data-composer-input]` + contenteditable 的 val() 桥（读 textContent 同步等价；写 execCommand insertText）。只拦映射命中的选择器，其余行为不变。实测 iframe 内读值与宿主输入区一致 |

仍登记（卡作者侧/低频）：G 卡脚本 CDN 依赖顺序错（Vue undefined）；示例游戏 NPC 性别卡的 CSS 自重叠（lint 已标记暴露，守卫层不强改卡布局）。

## 附录三：第三轮专项审计（2026-09-08 深夜，3 会话 14 帧位，34✅/3⚠️/2❌/61SKIP）

新修复实战验证：**R2-E 超时守卫在真实环境完整走通**（自然捕获 `wb:get 桥接超时（宿主 20s 未回包，已重试 1 次）`→轮询零冲击）；**R2-F 读路径 ✅**（6/6 脚本 iframe 读到宿主输入区一致文本）。第三轮发现并修复：

| # | 问题 | 修复 |
|---|------|------|
| R3-A | **shim 帧 park 往返后桥接死亡**：iframe 重插入重载文档 → shim 重执行后与宿主握手/序号失配 → 首个桥调用永无回包（start 按钮点出 callId 后永挂） | **shim 帧退出停车场**：卸载走完整释放（release+revoke+销毁），切会话重渲染消息 iframe 本就是 ST 原生行为（状态重置属预期）；纯 DOM 帧（无 shim）继续 park 保活（无桥可死） |
| R3-B | R2-F 的 `.val(v)` 写语义是追加、`.val('')` no-op | 改为全选+整值替换（空串走 delete），读路径不变 |
| R3-C | lint 刷屏（~2.5 条/秒，自触发循环）+ 占位符日志不填充 | observer 去掉 attributes 触发（只剩 childList）；日志改为可读的标签/类名文本 |

仍开放：shim 帧跨会话状态重置（= ST 原生行为，忠实对齐而非缺陷）；card CSS 自重叠（卡作者侧）。

| 类 | 机制 | 修复方案（通用层） | 状态 |
|----|------|--------------------|------|
| A | 脚本注入宿主的悬浮 UI 与宿主 chrome 层叠冲突 | **三件全落地**（script-ui-guard.ts v2）：①装饰层守卫（DECOR_RE 类名 + fixed/absolute + 无交互语义 → pe:none + 记名）；②核心 chrome z 仲裁（scriptball 60→10050）；③**注册表 + 同意式协商**：功能悬浮窗（z≥500 + 交互语义）登记 liveFloats，与保护区（[role=tablist] 标签栏 / composer 输入区）碰撞 >200px² 且 >12% 面积 → 一次性 toast「自动避让/忽略」→ 点击做最小位移推出保护区（实测：2137px²→0）。扫描模型：安装时全量 + MutationObserver 增量（**根自身必须单独 processElement**——querySelectorAll 只配后代，v1 漏登记根因）+ 3s 低频复检。交互判定兼容 jQuery 风格（cursor:pointer 后代 / draggable 类） | ✅ |
| B | hover-only 楼层动作（Good/Bad 等）触屏无揭示路径 | 真相：按钮载体 = turn-tail 行，被我方 `turn-tail{display:none}` 连人带藏。修复：coarse 指针下显示该行、藏文本 span（用时/时间戳与楼层头重复）、保留按钮（实测 28×28 可点） | ✅ style.ts |
| C | 卡自建 HTML 自重叠（帧内静态文本盖住控件中心） | 帧引导注入**遮挡自检 lint**（display-compiler.ts occlusionLintScript：elementFromPoint 中心校验 → data-dsht-occluder/occluded 标记 + console.info 记名，实测抓到 2 处）。只标记不改布局 | ✅ |
| D | 激活事件只绑 pointer 不绑 click（合成点击/无障碍死） | 统一 click 双绑（pointerup 标记抑制双翻） | ✅ RpStateFloat |
| E | 宿主重渲染连带重建消息 iframe → 旧节点上的委托/监听全灭 | **帧停车场**（RpNativeChat.tsx 2026-09-08）：卸载时 iframe 移入 display:none 停车容器（同文档节点移动不重载，卡脚本状态/桥/事件路由全保留），重挂载按 frameKey（html 哈希+shim 形态）认领原帧移回；LRU 8 帧封顶、同 key 并存 2 上限，驱逐才 release guest + revoke blob。杀手测试：点按钮改状态→切会话→切回，状态保留（未重执行） | ✅ |
| F | 宿主抽屉搜索框 pe:none；编辑器不响应 Escape | 搜索框：RP 活跃作用域 pe 覆盖（✅）；Escape 退出编辑器属宿主 bundle，登记待上游化 | ✅/📋 |

审计原始数据：tmp/mvuaudit-*.mjs（可重跑）；清单与证据见审计报告（2026-09-08 会话记录）。
