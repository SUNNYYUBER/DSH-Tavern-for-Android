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

### E. 设计哲学条款（2026-09-14 新增；F1~F5 的理论根因，完整表见
`docs/MOBILE-TEST-METHODOLOGY.md §5.4`）
- **E1 单一事实来源（P-1）**：同一语义只能有一处权威实现。多实现 = 修一处漏两处。
  已裁决的「权威 + 降级」/「语义面不同」必须登记（`docs/F5-MULTI-IMPLEMENTATION-AUDIT.md`）
  并在 `scripts/audit-impl-duplication.mjs` 白名单里写明 why；该闸门已进构建（A12）。
  **共享逻辑必须 import 同一模块，禁止复制函数体**；若两处**宽严度确实不同**，
  把差异暴露成**显式参数**（如 `rpSlugFromCwd` 的 `mode`），而不是各写一份函数体。
- **E2 集合 vs 阈值（P-2）**：凡**会随时间增长**的事物（被隐藏的消息集合、已处理事件集）
  不得用阈值表达。阈值会被后续新事件必然顶掉，正确性依赖一个不成立的假设。
- **E3 静默失败禁止（P-3）**（本文 C1 的设计层表述）：**禁止用合法返回值表达「我不知道」**
  ——降级/失效必须用 `null` 或显式 flag，不许用 `0` / 空数组这类「看起来正常」的值。
  返回 `0` 的下场是：系统看起来正常工作，防线其实已空，只在用户肉眼可见处暴露。
- **E4 边界隔离（P-5）**：官方未定型的内部细节（第三方 SDK 包名、内部类名、上游错误原文）
  必须挡在用户可见面之外，走**模式驱动的归一化层**（非逐串替换），原文折叠进「详情」。
- **E5 计量可信度（P-6）**：展示给用户的数字必须带**来源**（真实模型能力 / 预设 / 缺省），
  拉不到真实值时显式标注为缺省值——**错的口径比没有更糟**；被隐藏的内容必须从计数中扣除。
- **E6 产物即事实（P-11）**：一切「已修复」的判据必须落在**产物层**。源码改了、tsc 过了、
  单测绿了，都**不等于**用户拿到的是修好的版本（本项目第 ⑦ 类断链的母题）。
  每个修复必须配产物层断言（解 APK/zip 里的实际字节核验标记串），
  且核验范围必须覆盖改动**实际所在的那个包**（漏范围 = 假绿）。
- **E7 能力契约集中在入口（P-12）**：环境能力（WebView API 存在性 / 平台特性）的补齐或
  降级**必须在一个安装入口完成**，调用点一律直接调用、不写守卫。守卫散落在调用点
  ⇒ 新增代码是否加守卫全凭记性，必然漏（实测漏 8 处，含显示渲染主路径）。
  实现见 `dsht-plugin-shared/webview-api-guard.ts`（幂等 + 出声报告）；
  两个 client bundle 都必须安装（顺序不定，不能假设对方先跑）。
- **E8 宿主行级规则不得误伤我方组件（P-13）**：我方注入宿主容器内的组件，
  必须能抵抗宿主对该容器的**宽泛选择器**（如 `container span { display:none }`）。
  我方组件统一用 `dsht-` 命名空间前缀；宿主行级规则必须按前缀排除我方，
  否则会出现「**功能存在但永远出不来**」——比功能缺失更糟，且**只在触屏规则生效时暴露**。

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
- `scripts/dsht-ui-probe.mjs`：网络出口插桩 + 真实提交（取代早期 `tmp/append-foldtest.mjs`，后者已随 `tmp/` 清理移除）。
- `scripts/dsht-dom-check.mjs`：DOM 断言（折叠行存在/楼层头 sticky 横排/iframe sandbox token/帧可点击）。
- `scripts/dsht-hit.mjs`：命中测试（元素中心点命中的是不是它自己——触屏可点性判据）。
- `scripts/eg-mobile-actions.mjs`：E-G 六项核心动作（拖拽/可点/流式不裸露/回退集合语义/切后台/滚动截屏）。
**规则：每修一个用户可见 bug，必须新增对应 probe；每次热推后 probe 全绿才算修复。**

> 【2026-09-14 E-H 审计】原列的四件 `tmp/*.mjs` 已不存在（`tmp/` 不入库、已清理），
> 且 `tmp/` 已被 `.gitignore` 忽略 ⇒ 挂在那里的 fixture 天然不可复现。
> 现全部指向 `scripts/` 下入库的常驻探针（这才是「可重跑」的形态）。

### 4.3 实证基线（2026-09-07 全绿；2026-09-14 更新）
折叠行渲染 ✅ / 楼层头横排 sticky ✅ / sandbox token ✅ / 帧内按钮 DOM 更新 ✅ / 滚动 20s 零漂移 ✅ / 换行拦截 ✅ / confirm 模态 ✅（`MainActivity.kt` 的 `onJsConfirm` + `AlertDialog` 已实现；原「⏳ 等新 APK」已过时）

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
「点了没反应」集中在真实触摸层，按机制分六类登记。六类全部落地。
唯一让步：协商为同意式——用户点「自动避让」才动脚本窗口位置，不破坏作者布局意图）。

> ⚠️ **2026-09-14 修订：A 类与 E 类已按用户拍板撤销**，见下方修订说明。

### 附录修订（2026-09-14）

**A 类（脚本悬浮 UI 与宿主 chrome 层叠冲突）—— 守卫已整体移除。**

原 `script-ui-guard.ts`（装饰层穿透 + z 仲裁 + 注册表协商避让）实测有四个副作用，
用户拍板整体撤除：

1. 检测到脚本浮窗与输入区重叠时弹「自动避让／忽略」——**打扰用户**，且把「我方 UI 与
   脚本浮窗同层」的问题转嫁成用户决策；
2. 主动改脚本浮窗位置（nudge）——卡作者布局被改，脚本下次自检又复位，来回打架；
3. 给装饰类浮层无条件置 `pointer-events:none`——**脚本浮窗点不动**；
4. 真正的病根是**jQuery UI 拖拽在触摸屏上不工作**（jQuery UI 只绑 mouse 事件，触摸屏
   不产生 mousedown 系列），该守卫只是掩盖症状。

**现行处置**：脚本浮窗**完全由卡脚本自己管**，宿主不做任何位移/穿透干预。
病根改由 `dsht-rp-ui/src/client/touch-mouse-bridge.ts` 从根上解决——把触摸序列翻译成
原生 mouse 序列（自研，非 Touch Punch），安装点在两份 vendor iife 里（iframe + 宿主页）。
判据与回归护栏见 `packages/tests/touch-mouse-bridge.spec.ts`（**24 项**）。

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
| A | 脚本注入宿主的悬浮 UI 与宿主 chrome 层叠冲突 | ~~三件全落地（script-ui-guard.ts v2）~~ → **2026-09-14 全部撤除**：守卫的穿透/避让副作用比问题本身更严重（浮窗点不动、卡布局被改、弹窗打扰）。改为不动宿主层叠（脚本浮窗由卡自己管）+ 从根上修 jQuery UI 触屏拖拽（touch-mouse-bridge.ts）。详见「附录修订（2026-09-14）」 | 🔄 已改方案 |
| B | hover-only 楼层动作（Good/Bad 等）触屏无揭示路径 | 真相：按钮载体 = turn-tail 行，被我方 `turn-tail{display:none}` 连人带藏。修复：coarse 指针下显示该行、藏文本 span（用时/时间戳与楼层头重复）、保留按钮（实测 28×28 可点） | ✅ style.ts |
| C | 卡自建 HTML 自重叠（帧内静态文本盖住控件中心） | 帧引导注入**遮挡自检 lint**（display-compiler.ts occlusionLintScript：elementFromPoint 中心校验 → data-dsht-occluder/occluded 标记 + console.info 记名，实测抓到 2 处）。只标记不改布局 | ✅ |
| D | 激活事件只绑 pointer 不绑 click（合成点击/无障碍死） | 统一 click 双绑（pointerup 标记抑制双翻） | ✅ RpStateFloat |
| E | 宿主重渲染连带重建消息 iframe → 旧节点上的委托/监听全灭 | **帧停车场**（RpNativeChat.tsx 2026-09-08）：卸载时 iframe 移入 display:none 停车容器（同文档节点移动不重载，卡脚本状态/桥/事件路由全保留），重挂载按 frameKey（html 哈希+shim 形态）认领原帧移回；**LRU 16 帧封顶**（`FRAME_PARK_LIMIT = 16`）、同 key 并存 2 上限，驱逐才 release guest + revoke blob。杀手测试：点按钮改状态→切会话→切回，状态保留（未重执行） | ✅ |
| G | **jQuery UI 拖拽在触摸屏完全失效**（PC harness 迁移的通病） | **touch → mouse 翻译桥**（touch-mouse-bridge.ts 自研，2026-09-14）：包 `$.ui.mouse.prototype._mouseInit` 一个钩子打标记；触摸起点在标记元素内且越 4px 阈值才接管手势（合成原生 mousedown/mousemove/mouseup）；未越阈值全程零干预（保原生 click）；尊重 `options.cancel`。这两处挂载：iframe vendor + 宿主 vendor | ✅ 新增（**24 项单测**） |
| F | 宿主抽屉搜索框 pe:none；编辑器不响应 Escape | 搜索框：RP 活跃作用域 pe 覆盖（✅）；Escape 退出编辑器属宿主 bundle，登记待上游化 | ✅/📋 |

审计原始数据：**已归档**（原 `tmp/mvuaudit-*.mjs` 随 `tmp/` 清理移除，`tmp/` 不入库 ⇒ 无法「可重跑」；
可重跑的常驻探针见 §4.2 的 `scripts/*.mjs`）；清单与证据见审计报告（2026-09-08 会话记录）。

---

## 附录四：E-H 文档一致性审计修订（2026-09-14）

goal §七 E-H 要求「四份文档与代码现状一致，无失效描述」。本轮对
`README.md` / `docs/THIRD_PARTY_LICENSES.md` / 本文件 / `docs/MOBILE-TEST-METHODOLOGY.md`
做了逐条可证伪断言核对，处置如下：

| 类 | 处置 | 说明 |
|---|---|---|
| **声明与机制不符** | **改代码**（让声明成真） | MOBILE-TEST-METHODOLOGY §5.1 声称七项门禁「每次提交」跑，但**权威构建路径 `build-dsht.ps1` 内零 audit 调用**、`audit-publish-hygiene` 与 `audit-build-path-parity.py` 全仓无触发点，且仓库无提交钩子。⇒ 已在 `build-dsht.ps1` 新增 **Step 0.5「门禁前置」**（七项逐一跑，含 `--selftest`，任一不过即 throw）。 |
| **同一事实两处不一致（P-1）** | **改代码** | `RpScriptHost.tsx` 头注写「不给 same-origin」，实现给 `allow-same-origin`（同文件内自相矛盾）。⇒ 按实现订正头注，并写明这是**有意的权衡**（卡脚本依赖 parent.$，真 TH 同源形态，已在 B1 登记）。 |
| **计数失效** | 改文档 | `touch-mouse-bridge.spec.ts` 21→**24 项**（两处）；帧停车场「LRU 8 帧」→**16 帧**（`FRAME_PARK_LIMIT`）；`display-compiler.spec.ts` 46→**55 项**。 |
| **引用的文件已不存在** | 改文档 | 原文 §4.2 的四件 `tmp/*.mjs` 与附录「`tmp/mvuaudit-*.mjs`（可重跑）」——`tmp/` 不入库且已清理。⇒ 全部改指向 `scripts/` 下入库的常驻探针。 |
| **过时的「未完成」表述** | 改文档 | §4.3「confirm 模态 ⏳（等新 APK）」→ **✅**（`onJsConfirm` + `AlertDialog` 已实现）。 |
| **分类错误** | 改文档 | `THIRD_PARTY_LICENSES` 把 `jszip` 列在「客户端 vendor（构建期内嵌）」，实际 `vendor-deps.json` 的 anchors 只有 5 个（jquery/jquery-ui/zod/yaml/lodash），jszip 是 **node 侧**依赖。 |
| **计数失效（README）** | 改文档 | API 面 71（28+43）→ 实测 **73（32 本地 + 41 桥接）**；「约 50 项 stub」→ **71 项**；自研源码 120 → 实测 **128 个 .ts/.tsx**；「7 个自研插件」需区分「构建 7 个 / **生效 6 个**」（`dsht-plugin-undo` 有意不 compose）。 |

> 说明：本文档中出现的**行号**类引用（`file:line`）具有天然时效性——代码一改即漂移。
> 故本轮的订正口径是：**行号只在「该行本身就是判据」时保留**（如 `FRAME_PARK_LIMIT = 16`
> 这类常量值），其余一律改为「函数名/常量名 + 文件」的可检索定位（改代码不会失效）。

### 附录四续：第十/十一轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **新增机制未同步到本文档与 README** | 改文档 | 第十轮在 `build-dsht.ps1` 新增 **Step 0.6「官方契约事前探针」**（`scripts/audit-official-contract.mjs`，6 个官方包契约面，分级 BLOCK/WARN/INFO，`BLOCK` 即中止构建；`--selftest` 8 项）。本文档与 `README.md` 均只提 Step 0.5 ⇒ 两处已补（P-1：同一事实须同源）。 |
| **R7 违规：未验证写成已验证** | 改文档 + **补判据** | `MOBILE-TEST-METHODOLOGY.md` 曾声称「**真重新生成已覆盖**」并给出证据串，但全仓**无任何脚本**点击过 `.dsht-rp-regen-btn` 或调用过 `/rp/session-regenerate`（`ef-card-sampling.mjs` 自陈「真『重新生成』尚未跑」）⇒ 该证据**不可复跑**，属 R7 违规。⇒ ① 文档如实改注；② `ef-journey-all.mjs` 新增 **J14 真重新生成**（点按钮 → confirm → 校验掩码集合增长/结构变化 + 收敛），**设备实测 5/5 PASS**。 |
| **`SESSION_FORMAT_VERSION` 口径不一致（B12）** | 改文档 + 加对照 | 本仓多处文档写 **0**，真机 runtime（`@deepseek-ai/dsh-session@0.1.5-rc.1`）实测为 **3**。⇒ 契约探针把它做成**可对照数字**（`DOC_SESSION_FORMAT_VERSION = 3`），不一致即出声（P-1/P-4）。 |
| **本文档的替换性计数需随轮次更新** | 改文档 | `touch-mouse-bridge.spec.ts` 等文件项数已改由「实跑 vitest 输出」为准，本文档不再写死易漂移的项数（改指向 `MOBILE-TEST-METHODOLOGY.md` §5.1 的实测口径）。 |

### 附录四续二：第十二轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **C3 判据两轮自我推翻（判据自身缺陷，非产品缺陷）** | 修判据 + **新增带正控的判据** | `ef-journey-all.mjs` 的 J6（占用下降 / C3）在 5 张抽样卡上**恒 SKIP**，两轮查证均为**判据自己写错**：① 读的是 `session.jsonl`（v0 冻结世代），而 `hiddenSeqs` 来自当前世代（`session.v3.jsonl`）⇒ 两套 seq 空间、交集恒 0（**P-18 运行时违例**）；② 快照取在**回退之后**，而 live 回退把被移出消息就地替换成 23 字符的 snapshot 占位行（被导出排除）⇒ 交集必然空。**修法**：J6 降级为「前提诚实」判据；新增 **J15 = C3 专职正控**（回退 **J7 刚重发的新消息** ⇒ 必然影响导出；读数走产品同源 RPC，不自己扫文件）⇒ **设备实测 5/5 PASS，导出字符量一致 ↓ 5530 ≈ 2212 token**。详见 `MOBILE-TEST-METHODOLOGY.md` §6.5h。 |
| **J7 判据把「卡作者侧浮层遮挡」误判为产品缺陷** | 修判据（守边界 B2/B3） | 2 张卡的 J7 报 FAIL「composer 仍留有本轮文本」。`document.elementFromPoint` 查证：发送按钮坐标上压着**卡脚本自建的模态对话框**（`div.kmc-root > div.kmc-modal > … > button.kmc-btn`，文案「下一步」）⇒ 坐标点击打到了**卡的按钮**，宿主发送从未触发。按边界 B2/B3（卡作者侧 UI 重叠只标记不修）**不是宿主缺陷**。**修法**：点击前做命中校验（`elementFromPoint` 是否命中发送按钮自身/后代）；被遮挡改走合成点击（不放弃覆盖）+ 证据里如实标注遮挡元素。J8/J9 同步加判据力前提（`j7grew` 为假时两者恒真 = 假 PASS）。 |
| **新增设计哲学判据 P-20** | 改文档 | `MOBILE-TEST-METHODOLOGY.md` §5.4 新增 **P-20「判据必须自带杠杆」**：若一条判据的正控依赖被测系统处于特定状态，则它在真实数据上大概率**永远 SKIP**（SKIP 诚实，但长期无正控 = 覆盖空洞）。正确做法是**在同一次旅程里主动构造会产生杠杆的事件**。P 判据累计 **21 条**（含本轮新增 P-21）。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 保持 75 项（新增标记 `readSessionCwd` 已在其中；E3 开发期脚本的反向判据 `audit-official-contract` / `ef-journey-all` **不得进 APK** 继续生效）。双架构 APK sentinel **v333**，两包核验各 **75 项 / 缺失 0**。 |
| **【最严重】M7 夹具损坏了用户真实会话（R9 安全前提失效）** | 修夹具 + 数据恢复 + **新增 P-21** | `ef-journey-all.mjs` 的 J12 用 `cp` 在**应用存活时**还原会话文件，而产品有「live 会话 append 后立即耐久 barrier」（`flushLiveSession` → `/rp/flush-all`，设计目的写明是「手机端进程被杀不丢回退标记」）⇒ 内存日志把**按旅程后 seq 计算**的 `surfaceOp.replace` 写进**已被倒退的文件** ⇒ `startSeq` 指向不存在的 surface 成员 ⇒ 官方 loader 判 `invalid seed event at index N: surface replace: start seq M not found in surface` ⇒ **整会话打不开**（实测 `session-4849a2b6` / `st-4sut7v` UI 渲染 0 楼层）。跨轮次症状：掩码单调增长（25→32→43）、楼层单调下降（27→3→0）——**此前被误读为「卡被旅程回退干净了」**。<br>**修**：① 还原改为「旅程内只登记 → 末尾先 `am force-stop` → 统一还原」（且 `force-stop` 必须走**非 run-as** 的 adb shell，run-as 下抛 `SecurityException`）；② 还原后**校验文件大小与备份逐一致**，不一致即 fail-closed 出声并**保留备份**；③ 停应用失败 ⇒ **一张都不还原**（宁可报错也不写文件）。<br>**数据恢复**：`session.jsonl` 是**冻结的 v0 世代**、始终自洽且含原始消息；据此把悬空的 `replace` 降级为 `append`（事件本体与 `shadowedSeqs` 掩码全保留 ⇒ 用户可见结果不变），实测 `session-4849a2b6` **0 → 7 层**、`st-4sut7v` **0 → 21 层**，会话恢复正常打开。原文件留证为 `.corrupt-j31`。<br>**新判据 P-21**：夹具的写操作必须与被测系统的内存态互斥；发现读数跨轮次**单调漂移**时，**首先怀疑夹具**。详见 `MOBILE-TEST-METHODOLOGY.md` §5.4 与 §6.5h。 |

### 附录四续三：第十五轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L2 视口单位 + A1 软键盘交叉格：键盘遮挡输入区（真缺口）** | 修原生层 + **修正无效修法形态** | 设备实测：键盘弹出时 composer 底边 **785css** 而 IME 顶边 **594css** ⇒ **被盖 191css**。根因两层：① `targetSdk=36` 强制 edge-to-edge（window 属性含 `EDGE_TO_EDGE_ENFORCED`）⇒ `adjustResize` 对**窗口尺寸**失效；② 原生 insets 监听只消费 `systemBars()`（不含 `ime()`）。<br>**修法**：消费 `Type.ime()` 取 `max(ime,bottom)` 并写入 WebView **`LayoutParams.bottomMargin`**（**不是 padding**）。修复后实测视口 **803→548**（收缩 255px）、composer 距键盘顶边仍有 134px 余量、收起后完全回落。判据 `scripts/ef-keyboard-inset.mjs`（K0/K1/K4/K5/K6/K7，退出码 fail-closed）+ `android-runtime-harness.spec.ts` 新增 7 项静态护栏。 |
| **【新判据 P-22】「写进视图」≠「改变语义」** | 改文档 + 连带修「安全区避让」 | `WebView.setPadding(0,0,0,767)` 后 `paddingBottom==767`（视图**接受了**）、原生自记的 `appliedBottomPx` 也是 767（**双来源互证，看似铁证**），但 `documentElement.clientHeight` **恒 873**（页面**毫无感知**）⇒ **上一版的「安全区避让」与「键盘避让」都是无效修法**。改用 `LayoutParams.bottomMargin` 后视口 803→548（真的生效）。<br>**P-22**：平台 API 的**接受**与**生效**是两件事；凡「改平台容器属性以影响另一层（页面/子进程/远端）」的修法，判据**必须落在被影响的那一层**。这是 P-11 的更细形态（P-11：源码改了 ≠ 产物里有；P-22：产物里有了 ≠ 目标层变了）。P 判据累计 **22 条**。详见 `MOBILE-TEST-METHODOLOGY.md` §5.4 与 §6.5k。 |
| **M7 楼层读数长期是「不确定量」** | 修判据 | `dsht-rp-floor-head` 是**已渲染**楼层数，不是楼层总数：窗口化（`WINDOWING_THRESHOLD=40`）把视口外楼层换成占位 div（`data-windowed`），空闲渐进物化让已渲染数在切卡后 10+ 秒持续增长 ⇒ 同一张卡三跑读得 **43 / 34 / 21**。**修法**：主计数改 `已渲染 + 占位`（实测恒为 43），单独暴露诊断字段。修复后同卡连续三跑读数**一致**（J5 43→41、J7 41→42、J13 42→41）。证据探针 `tmp/probe-floor-vs-windowed.mjs` 留仓。 |
| **A11 闸门覆盖盲区（只查产品源码）** | 扩容闸门 | 同一「模板串内注释含反引号」的坑在 `scripts/ef-journey-all.mjs` 里**第 6 次复现**，而 A11 当时只查产品源码 ⇒ 静默放行。**修法**：A11 `TARGETS` 扩容到 **4 项**（新增 M7 注入模板串），selftest **7/7 PASS**。**新纪律**：闸门的**覆盖范围本身也是一条判据**。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 79 → **85 项**（新增 6 项键盘避让 dex 标记；**不用 `b'ime'` 超短串**以免恒命中 = P-20 违规）。双架构 APK sentinel **v337**，两包核验各 **85 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1689 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 + 会话完整性 selftest **全 exit 0**；M7 真实卡抽样 **80 PASS / 0 FAIL / 1 SKIP**（5 张卡，含「导入 → 开聊 → 脚本 UI 交互 → 回退 → 重新生成 → 再回退」全序列）。 |

### 附录四续四：第十六轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L1「指针捕获生命周期」补齐（goal §四 A1 第 8 项）** | 修产品源码 + 补矩阵行 | goal 列了 8 个 L1 必测项，而 §二 L1 表**只有 7 行** ⇒ 矩阵定义缺口。补行后穷举发现**真缺陷**：`RpStateFloat` 浮球缺 `lostpointercapture` —— 它是**隐式释放**（元素在捕获期间被移除 / 同 pointerId 被他人抢占）时的**唯一通知**，这两种情况**既无 `pointerup` 也无 `pointercancel`** ⇒ `dragRef` 永久残留。**修法（架构层收口）**：「结束一次拖拽」抽成唯一入口 `endDrag()`，三条路径共用（P-1）；`releasePointerCapture` 改为**先判 `hasPointerCapture` 再释放**（隐式释放后强释放抛 `NotFoundError`，会打断同批事件）。判据 `touch-target-audit.spec.ts` **10 项**。 |
| **【新判据 P-23】集合元素必须是「标识」而非「内容」** | 改文档 + 修判据 | J8「旧楼层不复活」连出两次假红：① 差集端点用 DOM（`.dsht-rp-user-bubble`，**已渲染**口径，实测 2↔10 波动，RPC 报 52 条）⇒ 改走**产品同源 RPC**（P-18）；② 换了口径**仍假红** —— 因为元素是**文本**，而 DSH 每轮注入的**系统提醒内容固定、seq 每轮新分配** ⇒ 回退移走旧 seq、重发注入同文本新 seq = **误判复活**。**修法**：差集一律按 **seq**，文本只作证据展示；并加 `seqUsable` 判据力前提（无 seq ⇒ SKIP，**绝不用内容兜底**）。P 判据累计 **23 条**。详见 `MOBILE-TEST-METHODOLOGY.md` §5.4 与 §6.7c。 |
| **M7 的 J3 假红**（切卡时子树重挂载窗口内瞬时采样 ⇒ 报「我方浮球=无」，而同一运行的 J1 读 `状态浮球=true`） | 修判据 | 设备实测（`tmp/probe-ball-j3.mjs`）：切卡后存在 **2~5s 的重挂载窗口**，其中某时刻 `floor-head=0`、浮球与 🧩 球**同时消失**（随后稳定 15s+）。J3 的 `ball` 是**单次瞬时采样** ⇒ 落窗口即假红。**修法**：`ball` 改**短轮询**（8s / 500ms）+ 与 J1 的 `statefloat` **交叉校验**（矛盾 ⇒ SKIP 而非 FAIL，P-17）。 |
| **A11 闸门本轮实时拦下两次同款事故** | 防线价值实证 | 在 `ef-journey-all.mjs` 的**注入模板串内注释**里两次写了带反引号的标识符 ⇒ `node --check` 报与真因隔 40+ 行的语法错；**两次都被 A11 闸门逐字定位**（含肇事行号）。这是上一轮把该文件加进 `TARGETS` 的直接收益（R4 闭环）。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 85 → **87 项**（新增 `onLostPointerCapture` 绑定 / `hasPointerCapture` 释放前判持有）。双架构 APK sentinel **v339**，两包核验各 **87 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1689 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 **全 exit 0**；M7 真实卡抽样 **81 PASS / 0 FAIL / 0 SKIP**（5 张卡）。 |

### 附录四续五：第十七轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L2「竖屏 / 横屏」：手机判据存在两套口径（P-1 违例）** | 修产品源码（三处同步）+ 设备实测 | 设备实测（`scripts/ef-orientation.mjs`，真转屏）：手机横屏 CSS 视口 **873×345** ⇒ `(max-width:700px)`=**false** 而 `(pointer: coarse)`=**true** ⇒ **五件套整体失效**（汉堡 `display:none`、侧栏从 fixed 抽屉**退回 static 三栏** = 桌面三栏塞进 345px 视口）。根因：全仓同一语义（「这是手机」）**两套判据** —— `dsht-plugin-mobile`（五件套 / file-preview / import-center）用**宽度**、`dsht-rp-ui` 用**触屏属性**；**修了一处而另一处仍坏**，且两者之间没有护栏。**修法**：媒体查询改**并集** `(max-width: 700px), (pointer: coarse)`（三处同步）；取并集而非只换 coarse ⇒ 保留「窄桌面窗口」既有能力（守 B10 不删能力）。**修复后设备实测全 PASS**（横屏汉堡可见=true / 侧栏=fixed / 无横向溢出 / 转回竖屏幂等）。 |
| **【新判据 P-24】判据必须落在「结果」而非「机制」** | 改文档 + 修判据 | 横屏探针首版 O2 断言「`(max-width:700px)` 在横屏下**必须匹配**」—— 那是**机制**；而修复正是换掉该机制 ⇒ 横屏时 `narrow` 单独仍为 false 是**正确的**（由 `coarse` 分支满足并集）⇒ 首版判据**恒 FAIL**、把已修好的报成坏。**修法**：判据改断言**五件套的可见效果**（汉堡可见 + 侧栏 fixed）；**防回归另立结构护栏**（`mobile-adapt.spec.ts` 断言并集写法）。P 判据累计 **24 条**。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 87 → **89 项**（新增 mobile 五件套并集媒体查询 / import-center 并集媒体查询）。**标记形态经 APK 内正则实测确认**（CSS 内容字符串不被压缩，保留带空格写法）⇒ 避免凭猜测写标记造成假红。**本轮 M4 实测抓到 arm64 仍是上轮产物（缺失 2 项）** ⇒ 重建后双包各 **89 项 / 缺失 0**，sentinel **v340** 一致。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1691 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 **全 exit 0**；M7 真实卡抽样 **81 PASS / 0 FAIL / 0 SKIP**（5 张卡）。 |

### 附录四续六：第十八轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L5「裸全局 TH API 静默」—— 方案 C 落地（`docs/L5-BARE-GLOBAL-TH-API-GAP.md` §八）** | 修产品源码 + 补单测 + 更新评估文档 | 该类缺口原有三种形态，本轮收口第一种：**无守卫的裸全局调用**（`getVariables(...)` 不带前缀）失败时只抛 `ReferenceError`，名字**不进** 🧩「缺 API」面板 ⇒ 用户观感「这卡某功能没反应，但面板里什么都没有」。修法（`th-shim.ts`）：新增 `attributeReferenceError(msgText)` 从 `ReferenceError: X is not defined` **反解名字**，经三重排除（① 已在 `bareGlobals` 内 ② 在 `TH_UNSUPPORTED_APIS` 内 ③ 在 `BUILTIN_GLOBAL_ALLOW` 约 90 项内建/宿主白名单内）+ 形态判据（驼峰或下划线式才当 API）后，**追加**一条归因到既有 missing 通道（原 `script-error` 事件照发，**不吞原错误、不改执行语义**）；`reportedAttr` 保证同名只报一次。判据 `tests/th-script-runtime.spec.ts` **9 项**（正控 / 4 负控 / 2 边界 / 幂等 / 结构护栏），该文件现 **85 项通过**。 |
| **缺口状态如实记为「部分收口」（R7）** | 改文档（不写成已解决） | 第三形态「**有 `typeof X !== 'undefined'` 守卫的静默形态**」**仍未覆盖** —— 脚本静默走 else 分支，**不产生任何错误事件**，我方**零感知**。覆盖它需要评估文档 §五的**方案 B**（脚本作用域 Proxy 包装），其代价与风险已在该节写明 ⇒ 归 **B5**「需专门一轮」。故 §六表与 §6.9g 均如实登记，**不冒充已达成**。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 89 → **92 项**（新增 `attributeReferenceError` 归因函数 / `BUILTIN_GLOBAL_ALLOW` 白名单 / `reportedAttr` 去重表）。核验范围仍是三个 lib + `client.js` + `dsht-plugin-mobile/lib/client.js` + `import-center.html` + dex（P-11 的核验侧盲区教训沿用）。双包各 **92 项 / 缺失 0**。 |
| **双架构 sentinel 一致** | 产物核验 | 两包均 `.installed-v341`（**一致**）。构建期遇 `mergeDexRelease` 文件锁（`classes.dex: 另一个程序正在使用此文件`）= **环境问题**（R2 归位），`gradle --stop` 后重建通过。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1700 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 **全 exit 0**（含 A11 `--selftest` 7/7、`session-integrity --selftest` 11/11）；M7 真实卡抽样 **81 PASS / 0 FAIL / 0 SKIP**（5 张卡，含 J16 结构自洽 5/5）。 |
| **A11 闸门本轮再次实时拦下同款事故** | 防线价值实证 | 在 `th-shim.ts` 模板串的**新注释**里写了带反引号的 `ReferenceError: X is not defined` ⇒ vitest 完全无法收集（报错指向模板串起始行、与真因隔 40 行）。A11 闸门**逐字定位**肇事行。这是本项目第 3 次同款 ⇒ 已在 §5.4 记为常驻纪律。 |
| **M7 的 J3 判据力诚实标注（R7）** | 改文档 | 本轮 J3 读数「已标记可拖元素 = 0」（5 卡中 4 卡为 0）—— 即**这几张卡本身没写 jQuery UI 拖拽**。故 J3 本轮**不得**当作「拖拽可用」的正控（它证明的是**桥已装** + 卡脚本帧装桥齐全，5/5）；真正的拖拽正控仍是 `touch-mouse-bridge.ts` 21 项单测。「真机上拖一张带拖拽的卡」列为**待实测**，并注明属**抽样池限制**而非产品缺口。 |

### 附录四续七：第十九轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L2「字号与缩放」格：从「待实测」到抓到真缺陷（触控尺寸被 flex 压缩静默压回）** | 修产品源码 + 补单测 + 设备实测 | §六该格原记「三处 `text-size-adjust` 已加，**设备实测仍待做**」。本轮先解两个**前置问题**（否则判据必落 P-17 陷阱）：① 系统 `font_scale` 是否**真的传导**到 WebView（若不传导则「不错位」是**测不出来**而非**事实否定**）—— 经验测量：`1.0→1.5` 时根字号 **16px→24px**，确实传导；② `text-size-adjust:100%` 的设计意图是「只禁按宽度自动放大、**保留**系统级设置」⇒ 字号**就该变大**，判据不能写成「字号不变」。随后正式探针 `scripts/ef-font-scale.mjs`（S0 杠杆 / S1 溢出 / S2 可达 / S3 五件套 / S4 裁切 / S5 浮球 / **S6 缩小档触控目标** / S7 幂等 / S8 夹具安全）**首跑即抓到**：`.dsht-rp-import-dock` 渲染 **19.45px**（远低于 §二 L1 的 **38px P1 底线**），且**基线档就是 19px**，与缩放无关。 |
| **【新判据 P-25】「规则命中且带 !important」不等于「生效」** | 改文档 + 修代码 | 归因走**决定性实验**（`tmp/probe-importdock-shrink.mjs`）：CDP `CSS.getMatchedStylesForNode` 确证该元素**命中** `height: 44px !important`，但逐条单独施加 inline `!important` 的对照结果 —— `height:44px` 单独 → **仍 19.45px（无效）**；`min-height:44px` 单独 → **44px**；`height:44px` + `flex-shrink:0` → **44px**。⇒ 根因：该元素是 **flex item**（祖先 column flex），**`flex-shrink`（默认 1）把 height 压回**；二者**不在同一层，`!important` 救不了**。这是 **P-11「规则存在 ≠ 规则生效」的布局层形态**（静态护栏全绿、功能照旧失效）。**修法**（R4 架构层收口）：六条触控放大规则一律补 `flex-shrink: 0 !important`。**同坑一处已修一处未修**（`dsht-plugin-mobile` 的 `settings-nav-cell` 早已写 `flex-shrink: 0`）⇒ P-1 的实例。判据 `tests/touch-target-audit.spec.ts` 新增 1 项（**负控已验证**：临时删掉 `import-dock` 的 flex-shrink ⇒ 该项 FAIL；并同时断言先例未被改坏）。P 判据累计 **25 条**。 |
| **修复后设备实测（R5/R7）** | 重建 + 重装 + 复跑 | 双架构重建（sentinel **v342** 一致）→ 装 x86_64 → 复跑 `ef-font-scale.mjs`：**9/9 PASS**，`import-dock` **19px → 44px**（基线 `75×44`）。**诚实标注**：`rollback-btn` / `ps-select` 在本页未渲染（`null`，不计入），故只确证了实际在场的四类（`hamburger` / `scriptball` / `script-pill` / `import-dock`）；那两个控件的**设备取证待补**，不写成已验证。 |
| **探针自身的三个坑（第 39~42 次）** | 修判据 | ① `font_scale` 变更会让 **WebView 目标重建、CDP 瞬断**，而测具假设了连接身份稳定 ⇒ 第 2 档起永久挂住；修法：每次求值**新建连接**。② 只 `sleep` 就采样，恰好落在**重建空档**（整页空）⇒ S2/S5 假 FAIL；修法：**轮询等就绪**（连续两次签名一致 + 输入区在场），未就绪 ⇒ **SKIP 不记 FAIL**（P-17）。③ `.dsht-rp-*` **不是合法 CSS 选择器**，写在字符串里编译期不报错、运行期抛 DOMException ⇒ 探针自身崩（不是判据失败）。④ 刚 `adb install` 后 runtime 仍在**首次解压**，基线档采样未就绪 ⇒ S3/S7 假 FAIL；修法：循环前先做一次就绪等待 + S7 拆成「快照幂等（需就绪）」与「S8 夹具安全（永不豁免）」两件独立的事。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 92 → **96 项**（新增 4 条 flex-shrink **精确完整声明串** —— 刻意逐条匹配而非只查 `flex-shrink` 关键字，避免「随便命中一处就算过」的假绿；且标记形态经 APK 内逐段实测确认「CSS 内容字符串不被压缩」）。双包各 **96 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1701 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 **全 exit 0**（构建日志逐项 `[gate] OK`）；双架构 APK sentinel **v342** 一致；设备：`ef-font-scale.mjs` **9/9 PASS**；M7 真实卡抽样 **81 PASS / 0 FAIL / 0 SKIP**（5 卡，含 J16 结构自洽 5/5）。 |

### 附录四续八：第二十轮 E-H 复核（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **L1 触控目标：从「修探针报出来的几条」升级为「穷举」** | 新建设备探针 + 修产品源码 | 上一轮（§6.10）只修了探针恰好报出的 6 条规则，而结论是「**P-25 是一个类**」。既有 `perf-audit.mjs` 面 7 有三个覆盖盲区（只查三种 button 选择器 / 无成因诊断 / 是整脚本的一个面、不便单独跑）⇒ 新建专用探针 `scripts/ef-touch-targets.mjs`（穷举我方可点元素 + **自动归因**）。 |
| **【新判据 P-26】放大规则必须写在「组件所属的那个包」内** | 改文档 + 修代码（两包） | **判决性证据 `.vb-arrow`**：`dsht-plugin-mobile` 早已写 `.vb-arrow { width:38px; height:38px }`（0,1,0），设备实测渲染 **20×20** —— 因 rp-ui 有**特异性更高**的桌面基线 `.dsht-rp-variant-bar .vb-arrow { 20px }`（0,2,0）⇒ mobile 那条是**死规则**，而两侧注释都写着「不属 rp-ui 自有类（层叠无冲突）」，**判断是错的**。这是 **P-25 的「选择器形态」**（P-25 是 flex-shrink 压 height，本条是特异性压 width/height）。修法：`.vb-arrow`/`.tm-hit`/`.regen-btn`/`.lore-btn`/`.sv-view-btn` 的放大迁进 **rp-ui 自己的 coarse 段**；`.dsht-mobile-*` 的放大写在 **mobile 包内**；mobile 侧死规则**显式标注**并纠正错误注释。穷举修前 **23 P1 + 15 P2** ⇒ 修后 **0 + 0**（设备实测）。判据 `touch-target-audit.spec.ts` **+3 项**（含负控已验）。 |
| **探针自身的 3 个坑（第 43~45 次）** | 修判据 | ① 用 `[data-dsht-rp-active]` + `contains` 判归属 ⇒ 该属性挂在 **body** 上 ⇒ 宿主的 44 个按钮全被算成我方；② 改用「带 `data-dsht-*` 属性」**仍错**（`anchors.ts` 给我方选中的**宿主元素**打 `data-dsht-mobile` 标）⇒ 唯一准确判据是**类名前缀**；③ 报出 `.dsht-rp-sidebar-btn` 31px 的假告警 —— 它 `rect.left=-288`（被**折叠侧栏**推到视口外、祖先已裁掉），根本点不到 ⇒ 加 **`elementFromPoint` 反查「真实可点」**。 |
| **A11 闸门覆盖仍不足（R4）** | 扩防线 | 本轮在**新建探针**里一次性踩了 **4 次**「模板串内注释写反引号」⇒ 说明上一轮只补 `ef-journey-all.mjs` 是**只补了一个文件**，而「探针里的注入模板串」是**一整类**入口。A11 `TARGETS` 4 → **6 项**，selftest **10/10**，并把**手写计数改为动态输出**（防「文档写的 N/N 与实际不符」= P-1）。 |
| **既有护栏把「已改好」的报成坏（P-24 同族）** | 修判据 | `mobile-adapt.spec.ts` 的 ⑤ 断言写死 `width: 40px; height: 40px`，而本轮把汉堡 40 → 44 ⇒ **判据锁死实现**、把修复报成回归。改为断言**结果**（尺寸 ≥ 38 底线，用 `Number()` 解析后比较）。 |
| **M4 核验脚本自身两处写错（P-11 核验侧）** | 修核验脚本 | ① 旧 marker `min-width: 38px; height: 38px` 未随 P2→44 的修正同步 ⇒ 假红（marker 与产品值耦合）；② 用**文件名**子串匹配 `ef-touch-targets` ⇒ 命中**产品注释里提到的探针名** ⇒ 报「开发期脚本混进产物」的**假违规**。修法：marker 改断言结果下限；禁入判据改锚定**脚本本体特征**（`[ef-touch-targets]` 输出前缀），并对两者做了**独立正负控验证**（负控：死规则串确实不在 mobile 包内；正控：`[ef-touch-targets]` 不在产物、注释名在产物）。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py` 由 96 → **104 项**（新增 8 条放大规则精确串 + 2 条探针本体禁入 + 3 条死规则消除负控）。双包各 **104 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1704 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；八项门禁 **全 exit 0**；双架构 APK sentinel **v343** 一致；设备 `ef-touch-targets.mjs` **0 P1 / 0 P2**。 |

### 附录四续九：第二十轮（续）E-H 复核 —— P-26 第二形态与 A15/A11 防线（2026-09-14）

| 类 | 处置 | 说明 |
|---|---|---|
| **P-26 第二形态：跨包规则「同特异性 + 注入顺序」整片死掉** | 修产品源码（两包）+ 设备实测 | §6.11 修的是**特异性形态**；按 R4 追问「还有多少跨包规则」⇒ 一次性扫描量化：rp-ui 写 mobile **0 条**，mobile 写 rp-ui **27 条**。设备实测（CDP 枚举「匹配且 media 生效」的**全部**规则 + 实际渲染值）：**几乎全为死规则** —— `.dsht-rp-back` 实测 **32px**（mobile 写 44）、`.dsht-rp-tab` **28**（写 44）、`.dsht-rp-card-gear` **26**（写 38），**三项均低于 38px 拇指底线**。真因：两侧选择器**特异性相同**（都 0,1,0），而 mobile 注入**先于** rp-ui ⇒ **后写者胜**。⚠️ 比特异性形态更隐蔽：**胜负取决于插件加载顺序**，顺序一变一批样式集体翻转。 |
| **修法：整片迁到组件所属的包** | 架构层收口 | 27 条整体迁入 rp-ui 自己的 `(pointer: coarse)` 段（同等/更高特异性 + `!important`），mobile 侧原位替换为**显式划界注释**（说明不可留的理由）。另删一条冗余跨包 hover 规则（`.dsht-rp-card-gear` 的 `opacity`，意图已由 rp-ui 的 `opacity: 1 !important` 承载 —— 同属性、同包内、覆盖力更强）。**修复后设备实测**：32→**44** / 28→**44** / 26→**44**。 |
| **新防线 A15：跨包 CSS 规则闸门** | 新增常驻审计 + 接入两条构建路径 | `scripts/audit-cross-package-css.mjs` —— **禁止一个包在 CSS 里写「另一个包自有组件的类名」规则**（注释里提到允许）。唯一允许的跨包写法：**宿主锚点**（`[data-dsht-*]`，由 `anchors.ts` 单点维护）。selftest **7/7**（正控 2 / 负控 2 / 零控 2 + 锚点缺失 fail-closed）。接入 `build-dsht.ps1` Step 0.5（七项→**八项**）与 `build-wb.sh`（含自指断言）。 |
| **A11 闸门盲区：`afterOk` 过宽 ⇒「成对反引号」静默放行** | 修判据（收紧 + 加正控） | 真实事故：我在 mobile 的迁移注释里写了**成对**反引号（`.dsht-rp-card-gear 的 opacity: 1 !important`），A11 报 OK，直到 esbuild 报 `Expected ";" but found "{"` 才暴露。根因：两条 CSS 模板串的 `afterOk` 是 `/^\s*(?:$\|\n\|…)/` —— **`\n` 分支**使「终止符后紧跟任意换行」即通过 ⇒ 提前终止被放行（实测 `closeLine=2` 仍判 ok）。修法：实测确认这两个模板串**终止后只有换行到文件尾** ⇒ 收紧为 `/^\s*$/`；新增**正控4**（成对反引号必须报错）。selftest **10→11**。**收紧有效性经反证确认**（同语料：旧口径放行 → 新口径报 `early-terminate`）。 |
| **M4 核验脚本自身再次「字面串命中注释」** | 修核验脚本 | 新增的「mobile 无 `.dsht-rp-card-gear` 规则」判据命中了我保留的**历史说明注释**（`原为：@media (hover: none) { .dsht-rp-card-gear … }`）⇒ **假违规**（双包皆报）。这与 E3 那次「文件名子串命中注释」是**同一族** ⇒ 加 `strip_css_comments()` 先剥注释再匹配（禁用类判据统一适用）。 |
| **既有护栏随架构收口同步更新（P-24）** | 修判据 ×3 | ① `touch-target-audit.spec.ts` 的「窄屏必须有放大规则」原**只查 mobile 包** ⇒ 迁移后必然假红；改查**两包并集** + 追加「必须落在 rp-ui」的归属断言。② `mobile-adapt.spec.ts` ⑤ 断言 `MOBILE_CSS` 含 `'min-height: 44px'`（来自已迁走的规则）⇒ 改为断言**结果**（mobile 包内仍存在 ≥44px 声明）。③ 同文件「抽离的 RP 竖屏规则保留」原断言它们在 **mobile** 里 ⇒ 改为断言在 **rp-ui 的 coarse 段**里，并加「不得回流 mobile」负控（**排除注释**后判定）。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py`：新增 6 条「迁入的规则在 rp-ui 产物里」正控 + 5 条「mobile 无跨包规则」负控 + 2 条探针/闸门本体禁入 + `strip_css_comments`。双包各 **104 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **81 文件 / 1704 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；**九项**门禁全 exit 0（A11 selftest **11/11**、**A15 新增 7/7**）；双架构 APK sentinel **v345** 一致；核验 104 项 / 缺失 0。 |

### 附录四续十一：第二十二轮 E-H 复核 —— W5 溢出兜底 + **F2 槽位致命缺陷**（2026-09-15）

| 类 | 处置 | 说明 |
|---|---|---|
| **【新判据 P-31】宿主插槽「条目崩溃」是永久性的 —— 我方 assistant 能力在真机上从未存在** | 修产品源码 + 设备实测 | 本轮最严重发现（症状远超 W5 本身）：**全部抽样卡**上 `.dsht-rp-assistant` 恒为 **0** —— T2.5a 输出协议三组件 / 显示正则 / HTML 渲染 / 代码增强 / 台词着色**全线失效**，正文由**官方渲染器**呈现（`.dsht-rp-user-row` 正常）。logcat 只有一行**无堆栈**的 `slot entry crashed in 'conversation.chat.node': [object DOMException]`。真因链：`st-quotes.ts` 的 `parent.replaceChild(frag, node)` 换掉了**宿主 React 持有的文本节点** ⇒ React 后续按引用删它时抛 `NotFoundError: removeChild`（commit 阶段）⇒ 宿主 `SlotErrorBoundary` 捕获 ⇒ 按官方语义 **abdicate 该条目（永久，不重试）**。控制变量实验（同卡同构建）：`replaceChild` ⇒ `assistant=0 / 崩溃 1`；「插入 + 清空（保留 React 节点）」⇒ `assistant=3 / q=14 / 崩溃 0`。**修法**：改为插入 + 清空 + holder 幂等标记 `data-dsht-qwrap`。设备复验 `0 → 18`；M7 各卡 `asst` 由 0 变 `50/15/18/3`。 |
| **【新判据 P-32】W5 长文本 / 宽元素横向溢出兜底** | 修产品源码（CSS）+ 决定性实验 | 按 P-29/P-24 先做**决定性实验**再改：新探针 `scripts/ef-overflow-probe.mjs` 在**真实**容器内注入 6 类超宽产物（可用宽 393px）。修前实测 `longUrl 4694px` / `preBlock 7489px` / `longWord 3131px` / `bigImage 2000px`，且 `overflow:visible` ⇒ **画到盒外**。**消融定规则集**：S1（2 条 `overflow-x`）/ S2（4 条 +后代宽限）**均无效**（盒子仍被 min-content 撑到 4694px —— 机理是**内容驱动的 min-content 传递**，`overflow` 只让盒子可滚）；S3（9 条 +断行 +pre/table）治住长串/代码块/表格；S4（12 条 +媒体限宽 +外壳）治住裸大图 ⇒ **落地 12 条**。**过程中的结论反转**：首版仅 4 个样本 ⇒ 误判「img 规则无杠杆」并写进注释；补 `wideTableHard`（固定宽单元格）与 `bigImage`（硬尺寸媒体）后**反转**（该规则必要）⇒ 产出新判据 P-32。设备复验 **6/6 样本 0 溢出 / 0 裁切**。 |
| **判据自身的实现假设（P-29 家族 · 本轮又 3 处，同一组 CSS 护栏）** | 修判据 | 新增护栏第一版连续**假 FAIL 三次**（均属「证据串与结论矛盾」）：① 解析器只认**单选择器**，而真实规则是**多选择器分组**；② `replaceChild` 检测命中**注释里的历史说明**；③ 只取**第一条**同名规则，而 CSS 层叠允许同一选择器多条规则。修法：解析器**先剥注释 → 逗号拆分 → 合并同名全部规则**（取层叠末值），并把三种形态都做成**负控样本**。 |
| **A11 闸门第三次抓到我自己** | 修注释 | 在 `style.ts` 的 CSS 模板串注释里写了**两处裸反引号**（`<img width=2000>` 与 `img width=2000` 的写法说明）⇒ `--selftest` 报 `early-terminate`，构建在 Step 0.5 即被拦停。**这正是 A11 存在的意义**（拦在构建前，而不是等 esbuild 报错）。改单引号后 selftest **16/16**。 |
| **产物核验基线随本轮改动更新** | 改核验脚本 | `tmp/verify-f1f5-payload.py`：新增 7 条（W5 CSS 规则精确串 ×4 + F2 holder 标记 ×2 + 外壳 ×1）+ 1 条 F2 **反向核验**（`replaceChild(frag` 不得在产物里）。双包各 **142 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **80 文件 / 1715 通过 / 2 skipped / 0 失败**（另 1 文件 forks worker 起不来 = 环境性问题，非本轮引入）；typecheck 三段 **0 错**；**九项**门禁全 exit 0（A11 selftest **16/16** / TARGETS **9 项**）；双架构 APK sentinel **v349** 一致 + 设备已提升；核验 **142 项 / 缺失 0**；设备 `ef-overflow-probe.mjs` **6/6 治住**；M7 **48 PASS / 0 FAIL / 21 SKIP**（6 条 FAIL 全部取证为判据自身缺陷，产品无缺陷）。 |

### 附录四续十二：第二十三轮 E-H 复核 —— A5 三段编译四条路径一致性（W6）+ 暂存哨兵真缺陷（2026-09-15）

| 类 | 处置 | 说明 |
|---|---|---|
| **A5 三段编译「四条路径是否同源」核对（GOAL §11.1 W6）** | 只读勘察 + 新增探针 | 用**真实卡输出**（5 张抽样卡 16.9MB 会话 / 2069 条消息）而非合成样本：① **流式 ≡ 定稿**：8 类语义样本的渲染单元序列**全一致**（0/8 差异）② **多帧**：`shouldRenderFrame` 18 组合真值表 + 独立复算全符合定义 ③ **窗口化回渲**：`processed` 是同一 `useMemo`，`windowed` **不在**编译 deps ④ **折叠体内文**：与主楼层共用同一 `CompiledBody`。⇒ **四条路径已同源**。新增常驻探针 `scripts/ef-compile-parity.mjs`（判据自证 9 项 + J1/J2/J3，支持 `--file` 与设备全量模式）。 |
| **【新判据 P-34】暂存哨兵改私用区 —— 用户正文撞车导致内容凭空消失** | 修产品源码（单源收口） | 收尾时**设备全量探针**抓到：`<skill_content>` 折叠块 `13867 → 13859`（丢 8 字）。取证（落盘原文 + 逐字符 diff）：丢失的是**字面量** `\u0001F0\u0001` / `\u0001F1\u0001` —— **协议层的暂存哨兵原为裸控制字符**（围栏 `\x01F<n>\x01`、段落 `\x00<n>\x00`），而控制字符**可以出现在用户/模型文本里** ⇒ 被围栏还原逻辑消费。修法（**P-1 单源收口**）：改用**私用区**（U+E000/U+E001）+ 唯一前缀（`DSHT_RP_FENCE_` / `DSHT_RP_SEG_`），与同文件既有的 `HANDOFF_MARK` 同族；哨兵收成单源 API 供 `output-protocol.ts` 复用。**决定性验证**：同一份设备数据**修前 FAIL（丢字 1）→ 修后 PASS（丢字 0，2914 个折叠块）**。 |
| **同处第二形态：还原越界被静默删内容** | 修产品源码 | 首版还原写 `fences[i] ?? ''` ⇒ 正文里若恰好出现同形串，**下标越界时被替换成空串**（= 静默删内容）。测试用例当场抓到（`'前后'`）。⇒ 三处还原（围栏 / 段落 / 段落回填）统一改为「**越界原样保留**」（P-17：默认必须选「保内容」那一侧）。 |
| **【新判据 P-33】8 次判据自造缺陷（P-29/P-30 家族集中爆发）** | 修判据 + 固化纪律 | 本轮勘察连续 8 次踩自己写的判据（整条原文喂折叠体 / 对比口径多跑一次协议层 / `hasFrameSegment` 正控选错 / 字符串顺序 diff 把重复当丢失 / 前缀匹配过宽 / **`/<[^<>]*>/g` 抽纯文本吃掉中文标签名**）。最有价值的一条固化为 **P-33**：真实卡文本里 `<音乐>` / `<\|SYSTEM\|>` 这类**非 ASCII 标签名 327 处**被当标签剥掉 ⇒ 报「内容丢失」的假象（我据此白查 6 轮）。**负控当场抓到样本选错**：首版拿 `/(>д<)/` 当负控，而旧正则对它不生效 ⇒ 印证「负控样本必须取自真实失效形态」。 |
| **M4 核验计数口径** | 修核验脚本 | 上一轮只修了「跨包三组漏算」，本轮发现 `FORBIDDEN_IN_PAYLOAD`（探针/闸门本体禁入）**同样真核验却没进计数**（同一缺陷**第二次**复发 = P-1）。修法不是再补一组，而是把**全部核验组集中到一个列表**（`ALL_MARK_GROUPS`），今后新增判据组只改那一行。双包由 142 → **152 项 / 缺失 0**。 |
| **本轮回归基线** | 全绿 | vitest **80 文件 / 1721 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；**九项**门禁全 exit 0（A11 selftest **16/16**）；双架构 APK sentinel **v351** 一致 + 设备已提升；核验 **152 项 / 缺失 0**；设备 `ef-compile-parity.mjs` **J1/J2/J3 全 PASS（丢字 0）**；M7 见 §3.3。 |

### 附录四续十三：第二十三轮（续）E-H 复核 —— P-34 同类排查收口（W21）+ A14 半迁移取证（W22）（2026-09-15）

| 类 | 处置 | 说明 |
|---|---|---|
| **P-34 同类排查（GOAL §11.1 W21）—— 又 2 处同族真缺陷** | 修产品源码 | W6 只修了围栏 / 段落两类哨兵，而「不可见字符 + 短 ASCII 前缀当占位」是**可复制写法**。本轮穷举全仓（新常驻探针 `scripts/ef-sentinel-family.mjs`），抓到：① `dsht-plugin-prompt-template/ejs.ts` 的 `<pre>` 保护用**裸 NUL**（`\u0000EJS_PRE_<n>\u0000`）——正文含同形串 ⇒ 被替换成**别的** `<pre>` 内容（**篡改**）；越界还原 `?? ''` ⇒ **静默删内容** ② `preset/compiler.ts` 的宏中性化占位用**裸 NUL**（`\u0000DSHT_M\u0000` / `\u0000DSHT_C\u0000`），而输入是**卡作者可控的预设文本** ⇒ 同形串被换成 `{{model}}`（**篡改**）。两处均按 P-34 改**私用区**定界 + 越界**原样保留**。 |
| **探针本身的三个坑（写错三次，全被自证/负控抓住）** | 固化判据纪律 | ① `new URL(...).pathname` 在 Windows 上**百分号未解码**（仓库路径含空格 ⇒ `%20`）⇒ 全部 `readFileSync` ENOENT，自证 8 条里 4 条假红；② 回归锁对整文件匹配 ⇒ 命中**注释里的历史说明**，4 条假红；③ 扫描面定成「行内有裸控制字符」⇒ 报出 **2 处假红**（`lore/safe-regex.ts` 的**缓存键分隔符**、`dsh-plugin/ext-asset.ts` 的**路径校验** —— 两者都**没有还原步骤**）。③ 最有价值：**判据过宽会报假红，与过窄会假绿同样有害**（P-20 的反面）；修法不是加白名单，而是**锚定缺陷成立的必要条件**（存在「按哨兵还原」的正则）。 |
| **M4 核验：差点写出零杠杆判据** | 修核验脚本 | 最初把 `EJS_PRE_` 当正向 marker —— 但它 **ASCII 前缀修前修后都在**（变的只是**定界符**）⇒ 零杠杆（改回裸 NUL 也照样绿）。改为 **FORBIDDEN 旧定界符字节**（`\0EJS_PRE_` / `\0DSHT_M` / `\0DSHT_C`）+ 新增 `FORBIDDEN_IN_PAYLOAD_W21` 进 `ALL_MARK_GROUPS`；新形态的正向存在性改由探针的**动态调用**验证（真实 `protect → restore`，比字节匹配强得多）。**该判据当场证明有杠杆**：x86_64 新包 0 缺失，而 arm64 旧包正确报出 5 项。 |
| **【W22】A14 报「产物与源码不一致」= T-87 半迁移，**非本轮缺陷**** | 取证 + 登记（不改范围） | `audit-artifact-freshness.mjs`（**注意它不在 `build-dsht.ps1` Step 0.5 的九项门禁里** —— 门禁覆盖盲区，一并登记）报 2 条：① RP 总包按**新 entry**（`src/dsht-rp/index.ts` = 1112371 B）比对，而活动路径 `build-dsht.ps1:565` 编译**旧 entry**（`src/dsh-plugin/index.ts` = 913879 B，与 staging/设备逐字节同尺寸）② EJS worker 按**新路径**比对，而活动路径写**旧路径**（与加载它的 index.js 同目录 ⇒ 自洽）。**取证链**：现场重编译两 entry 取体积 → 读 `NodeService.kt` 的 `pluginRows`（**6 行 insert** ⇒ 设备走旧架构）→ 读 `T-87-RP-PLUGIN-CONSOLIDATION.md` §D-9a（结论「**倾向做**」= 未拍板实施）→ 读 `rebuild-plugins.ps1`（已按新架构写）⇒ **两代架构并存、各自自洽**，与哨兵修复无关。**处置**：不扩大范围推进 T-87；在 `build-dsht.ps1` 的 worker 行写清「路径必须与加载它的 index.js 同目录，**两条构建路径的 outfile 不可互抄**」+ 抄错的后果（worker 不存在 ⇒ Worker 构造失败 ⇒ **静默退化为同步渲染**）。**次生发现**：`-SkipInstall` 复用 runtime 目录 ⇒ 上一次新架构构建写的 `dsht-rp-plugin/lib/ejs-worker.js` 会**残留**（旧哨兵死副本，当前架构不解析该路径）。 |
| **本轮回归基线（W21/W22 收口后）** | 全绿 | vitest **80 文件 / 1726 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；**九项**门禁全 exit 0（A11 selftest **16/16**）；双架构 APK sentinel **v352** 一致 + 设备已提升（`dsht-plugin-prompt-template/lib/index.js` 旧 NUL 形态实测 **0 处**）；核验 **155 项 / 缺失 0**；`ef-sentinel-family.mjs` **全 PASS**（自证 10/10 + 扫描 130 文件/1388 个正则字面量 + 动态 6 项）；`ef-compile-parity.mjs` J1/J2/J3 全 PASS；**M7 48 PASS / 0 FAIL / 21 SKIP**。 |

### 附录四续十四：第二十四轮 E-H 复核 —— L5 裸全局 TH API 的「有守卫的静默形态」收口（W3）（2026-09-15）

| 类 | 处置 | 说明 |
|---|---|---|
| B3「不允许静默 undefined」的**机器化**（GOAL §11.1 W3） | 修产品源码 + 新常驻门禁 | 真 TH 的裸全局机制（`JS-Slash-Runner/src/iframe/predefine.js:11-19`）把**父页 `TavernHelper` 对象的全部键**合并进脚本 iframe 的 window ⇒ **真 TH 的面是有限可枚举的**。我方是**手写静态清单** ⇒ 两边不同步就会出现「真 TH 有、我方 `undefined`」的名字，而脚本几乎总写 `typeof X !== 'undefined'` 守卫 ⇒ **静默走 else、零留痕**（违反 B3）。**权威判据**（真跑 `buildShimSource` + 枚举沙箱 window）实测：真 TH 面 **144** 项 / 我方 **117** / 缺 **27**（到产物核实剔除 2 项仅声明面 ⇒ **25 项真缺口**）。 |
| **修法按真值形态三类分流**（产出新判据 **P-36**） | 修产品源码 | ① **真实现 3 项**：`errorCatched`（**重抛**语义从产物逐字取证 —— 首版我以为「包装器不重抛」，取证后按实现订正：同步抛 ⇒ 报错后**重抛**；返回 thenable ⇒ 挂 `.then(void 0, …)`）、`getTavernHelperExtensionId`、`initializeGlobal`（补齐与 `waitGlobalInitialized` 的**配对** —— 此前只实现等待侧 ⇒ **所有消费方**必然超时）② **异步函数 stub 9 项**（真 TH 返回 **Promise** ⇒ `typeof` 形态与基准一致）③ **值・同步型 getter 13 项**（新常量 `TH_FACE_VALUE_NAMES`；真 TH 是**值**（`default_preset`）或**同步函数**（`getPersonaIds(): string[]`）⇒ 挂函数 stub 会让 `typeof` 从 `undefined` 变 `function` ⇒ 守卫**通过** ⇒ 拿到 Promise 后 `.map()` ⇒ **TypeError 抛错，比原状更坏**）。getter 做到「**保持 undefined 语义 + 首次读取即出声**」，同时满足 B3 两半。 |
| **方案 B（`with` + Proxy）被决定性实验证否** | 修正评估文档 | 卡脚本以 **`<script type="module">`** 注入（`th-shim.ts:3011`）⇒ ESM = 严格模式 ⇒ **`with` 是语法错误**（四组实验：经典 ✅ / ESM ❌ `Strict mode code may not include a with statement` / ESM 无 with ✅ 负控 / **`node:vm` 经典语义 ✅ ← 现有单测装置的「假绿面」**）。故评估文档 §五「可行但需专门一轮」判定**已失效**；§四「第三类名字不可能穷举」只对**卡作者自造桥名**成立。 |
| **一处「差点写坏」的自纠** | 撤回过早实现 | `getGlobalWorldbookNames` 一度按「读上下文快照的 `globalWorldbooks` 字段」实现 —— 取证发现 ① 快照契约里**没有**该字段（我凭空假设了形状）② 真 TH 读的是 ST `settings.world_info.globalSelect`，我方**无对应数据面**（`rp/global-books.json` 是另一套语义且无读端点）⇒ 按 **P-17** 撤回，改记名拒绝。 |
| **A11 模板串闸门当场拦下一次违约** | 无（未出厂） | 新写的注释里用了反引号（`th-shim.ts` 的 shim 模板串体内禁用反引号）⇒ `audit-shim-template-literal.mjs` 立刻报 `early-terminate` + 肇事位置行号，当场修复。**这次是闸门先于构建拦下的**。 |
| **本轮回归基线（W3 收口后）** | 全绿 | vitest **81 文件 / 1776 通过 / 2 skipped / 0 失败**（`th-script-runtime.spec.ts` 85 → 92，+7 条 W3 护栏）；typecheck 三段 **0 错**；门禁 **十一项**全 exit 0（新第 11 项 `audit-th-face-coverage.mjs` selftest **8/8**，自证含「值型被误挂成函数必报」这一最关键正控）；双架构 APK sentinel **v354** 一致 + 设备已提升；产物核验 **167 项 / 缺失 0**（W3 新增 8 项 marker，**修前实测 0 命中 ⇒ 有杠杆**）；真 TH 面覆盖率 **141/141 / 静默缺口 0**；M7 **46 PASS / 0 FAIL / 23 SKIP**（首跑那条 FAIL 取证为**判据自身缺陷**（第五十四次）后收紧判据复跑归零）。 |

### 附录四续十五：第二十六/二十七轮 E-H 复核 —— P-31 家族穷举（W24）+ 渲染热路径全量重算（W24b）+ 三个「构建装置」问题（W24c）（2026-09-16）

| 类 | 处置 | 说明 |
|---|---|---|
| **P-31 家族同类横向排查**（W24，收口挂了四轮的 §六 未收口项） | 修产品源码 + 护栏升级 | `th-shim.ts` / `host-vendor.ts` 等含 `innerHTML` 的大文件此前**未逐一核对**。按**语义不变量**（「销毁宿主 React 持有的节点」）枚举得 **5 类手法**（`replaceChild` / `removeChild`·`.remove()` / `textContent=` / `innerHTML=`），全仓 **131 个 `.ts/.tsx`** 普查 ⇒ 命中 **11 文件**；**逐条分诊「被操作节点归谁」**：**10 个是我方自建 DOM**（toast / overlay / iframe / 预览抽屉 / `<style>`，React 从未持有）⇒ 安全；**1 处真风险**（`display-compiler.ts` 的 `code.innerHTML` 就在宿主 `<pre><code>` 上）⇒ **已改为纯 DOM 构建**（`createTextNode` / `createElement` + `insertBefore` + `nodeValue = ''`，与 `st-quotes` 同款，见 R19）。护栏从「1 手法 + 3 硬编码文件」升级为「**5 类手法 + 目标白名单 + 杠杆自证**」（36 项）。产出 **P-38**。 |
| **W24b 高亮首版不幂等**（本轮引入，**离线决定性实验抓到**） | 修产品源码 | 删掉 `escapePreHtml` 后改纯 DOM 构建，但首版**丢了幂等**：唯一守卫是「已存在 `span[data-dsht-hl]` 就跳过」，而**当 `<pre>` 里没有任何可高亮 token 时**（纯中文说明），片段里**一个 span 都没有** ⇒ 守卫恒不命中 ⇒ 每调用一次就多插一个文本节点（**节点单调累积**）。离线四组对照：无 token 块 `1 次→2 节点、10 次→11`；同族 `wrapStQuotes`（**同一批次上线、M7 上轮无异常**）无引号时 `1→1`（它有 `if (!wrapped) continue`）。⇒ 补 `matched` 守卫（无 token ⇒ **零 DOM 变更**）。**诚实边界**：设备取证时 `preCodeCount = 0` ⇒ 它与 M7 挂起**无关**，是**另一条**真缺陷，两者证据/修法均不同。 |
| **渲染热路径全量重算**（W24b 真根因） | 修产品源码 + 新护栏 | M7 收尾跑到首卡 J4 后**永久挂起**（日志 10 分钟不涨 / 进程 CPU 0.55s / 无报错无退出码）。真因：`host-projection.ts` 的 `readBlocks` 用 `v.filter(...)` ⇒ **每次调用返回新数组**，而它进了 `RpNativeChat.tsx` 的 `processed` useMemo 依赖数组 ⇒ **memo 每次渲染都失效** ⇒ 每个 assistant 楼层每次渲染都重跑 `runDisplayScripts`（该卡 **14 条 display 正则**，含 `([\s\S]*)\[OS\]([\s\S]*)` 两头贪婪形态）× 50 楼层 ⇒ WebView 渲染进程 CPU 持续 **100%**。**修法**：改在读取器内保证引用稳定（元素全合法 ⇒ 直返原数组引用 / 需过滤 ⇒ `WeakMap` 按底层数组缓存 / 缺失 ⇒ 共享 `Object.freeze([])`），**零调用点改动**。**新增 8 项护栏**（正控 4 + 负控 2 + **P-20 杠杆**）。**同类横向排查**（P-38 三段式）：24 个导出里 6 个机制同类，逐个分诊全部消费点 ⇒ **只有 `readBlocks` 真进了依赖数组**。产出 **P-39**。 |
| **runtime 被静默降级**（W24c，**数据安全级**） | 修构建脚本 + 新纪律 | 收尾重建照抄上一轮 `-DshVersion 0.1.2-rc.1`，而**设备上跑的是 0.1.5-rc.1**。`dsh@0.1.2-rc.1` 对子包只做 **caret** 依赖（`"@deepseek-ai/dsh-session": "^0.1.2-rc.1"`）⇒ 整棵树落成 **0.1.2 世代**，其 `isReplaceOp` 要求 `op` + **`start`** + **`end`**（**严格三键**）；而设备上 **1747 处真实会话数据**是 `{"op":"replace","startSeq":N,"endSeq":N}` ⇒ **装出去历史会话全部打不开**。是 `audit-official-contract.mjs` 的 `surfaceop-field-names` 面判 **BLOCK** 才拦下（**E3 事前探针落地以来第一次真正发挥「事前」作用**）。⇒ 改用 `-DshVersion 0.1.5-rc.1` 重建 ⇒ 产出 `dsh-session 0.1.5-rc.2`、`isReplaceOp` = `startSeq/endSeq` ⇒ **与设备数据同形态**。产出 **R21**。 |
| **官方契约探针的时序缝隙**（W24c） | 修构建脚本 | 探针读 `$runtimeDst`，却被放在 **Step 0.6**（`SkipInstall` 判定之前、Step 1/3 **替换 runtime 之前**）⇒ **判据与被判对象不是同一个**。实测：**同一天两次构建、同一份源码**，arm64（磁盘残留 0.1.5）**通过**、x86_64（刚换成 0.1.2）**BLOCK**。⇒ 实际探测移到 **Step 3.6（替换之后）**，Step 0.6 只留 `--selftest` + `SkipInstall` 分支。修完自证：第三次构建 Step 3.6 打印「本次产物无 BLOCK 级破坏」。产出 **P-40**。 |
| **两条构建路径「stub 落盘清单」不同步**（W24c） | 修构建脚本 | 装新 APK 后页面有宿主 UI 但**我方容器计数全为 0**（`dshtAny: 0`），M7 **5/5 卡切卡未生效**。logcat 首因：`plugin tree failed to load … (@deepseek-ai/dsh-subprocess-local): STARTUPINFOW layout mismatch: koffi computed undefined, expected 104`。真因：0.1.5 的 `dsh-win32-process` 变成**真实实现**，顶层就 `import koffi` 并做 ABI 断言 `if (STARTUPINFOW.size !== 104) throw`；我方 `stubs/koffi` 是**哑值模式**（`struct()` 返回 marker，无 `size`）⇒ 顶层抛错 ⇒ `dsh-subprocess-local` 导入失败 ⇒ **cordis plugin tree 整体加载失败**（不是「某个插件不生效」，是**全部**）。**为何漏**：该 stub 早在 `apply-platform-patches.py:210` 有落盘，而 `build-dsht.ps1`（**完整安装实际走的那条**）**从来没有**；`audit-build-path-parity.py` 只比 **marker 集合**、不比「stub 落盘清单」⇒ 漏在缝里。**0.1.2 为何不炸**：该包在非 win32 平台**不会被安装**（平台过滤）；0.1.5 起变成普通依赖 ⇒ 后果从「无」变「全崩」。⇒ 补齐（与 python 路径逐字同款），**并在设备上最小验证**：手工落该文件后 `dshtAny` **0 → 556**、`floorHead` **0 → 50`、`assistant` **0 → 50**。 |
| **M7 装置「静默挂死」**（W24c 前置） | 修测具 | `ef-journey-all.mjs` 的 CDP `send()` **没有超时** ⇒ 页面一卡（主线程长期不让出 / `awaitPromise` 的 Promise 永不 settle）整个旅程**永久挂起**：不报错、不退出、日志不涨。⇒ 加 **120s 超时** + `evalJs` 就地转 `{__err}`（与既有异常走**同一条通道**，否则会丢掉后续所有卡的覆盖）+ 出声。修完立刻见效：挂起变成可读的 `[warn] CDP 超时/失败：…`。产出 **R22**。 |
| **本轮回归基线（W24/W24b/W24c 收口后）** | 全绿 | vitest **81 文件 / 1786 通过 / 2 skipped / 0 失败**（`projection-shape-defense.spec.ts` 33 → **41**）；typecheck 三段 **0 错**；门禁 **十二项**全 exit 0（`audit-official-contract` 在 **Step 3.6** 新时序下探测本次真产物）；双架构 APK sentinel **v357** 一致 + 设备已提升（`.installed-v357`）；两包 `dsh-session` 均 **0.1.5-rc.2**、`isReplaceOp` = `startSeq/endSeq`（**与设备 1747 处真实数据同形态**）；产物核验 **169 项 / 缺失 0**；**M7 39 PASS / 0 FAIL / 18 SKIP**（修前**挂死跑不完**）+ J16 结构自洽 0 违规。 |

### 附录四续十六：第二十八轮 W25 —— DSH 版本建单源 + 判据从**代理量**改锚到**事实**（2026-09-16）

> **本轮主题**：W24c 抓到的「runtime 被静默降级」此前只做了**纪律化**（R21）。本轮把它**机器化**，
> 并在过程中产出 **P-41**（判据锚点选择）与三处「补丁幂等判据」的同类修复。

| 类 | 处置 | 说明 |
|---|---|---|
| **「当前锁定版本」缺机器可读单源** | 建单源 + 三层观测面 | 取证：三处 `package.json`（其中 `rp-workspace/package.json:3` 写 `0.1.2-rc.1` **过期**、`pnpm-lock.yaml:12-13` 同步过期）与四份叙述文档（README/TASK-LIST/MASTER_TODO 写 `0.1.5-rc.1`）**早已分叉**，而唯一的代码级判据 `.goal/upgrade-0.1.5/evaluate.sh:10` **已变红且无触发点**。⇒ 新建 `rp-workspace/dsh-version.json`：`dshVersion` + **`sessionReplaceOpFields`**（★ 后者才是「数据能否被读出」的判据）。修 `rp-workspace/package.json` 的过期值。 |
| **判据锚在代理量（版本号）⇒ 改锚到事实（字段名契约）** | 新常驻门禁 **第 13 项** | 版本号是**代理量**：上游**同号改形态**⇒判据沉默、**跨号形态不变**⇒判据误报。**真正的事实**是官方 loader 的 `isReplaceOp` 严格三键（`op`+`startSeq`+`endSeq`）。⇒ `audit-dsh-version.mjs` 从**产物**抽该字段名并与单源比对（`parseReplaceOpFields`：先定位函数体，再**只抽键位置的字面量**）。四条判据 + selftest **9/9**（含「两代形态必须判为不同」的 P-20 杠杆）。跑在 **Step 0.7**（`-DshVersion` 与单源一致性由构建脚本断言，fail-closed）。 |
| **产物层无人核**（源码对 ≠ APK 对） | 新产物探针 | `verify-apk-runtime-version.mjs`：解 APK → `assets/dsh-runtime.zip` → 各包 `package.json` + `dsh-session.isReplaceOp` 字段名，并核**双架构一致性**。selftest **7/7**（含 zip 读写自证）。跑在 **Step 6.5**。**为什么独立于第 13 项**：两者观测面不同（仓库态 vs 产物态），且从「命令行参数」到「APK 字节」中间要过 `pnpm install`（**无 lock、子包 caret 解析**）等环节 —— 任一环错都是「源码对、APK 错」。 |
| **构建路径等价性判据的结构性盲区** | 加**判据二** | W24c 的 `dsh-win32-process` stub 缺失**没有 marker 可比**（`stubs/node-addon-landlock-run/index.js` 全文 24 行、零 marker）⇒ 原有的「`DSHT-*` marker 集合比对」**结构上不可能**发现。⇒ 新增「**stub 落盘清单**」比对（**源文件 → 目标路径**二元组；必须带目标路径，因为同一份 stub 在不同代次落不同路径）+ `--selftest` **5/5**。真跑即抓到 **3 处判据自身的实现假设**（变量未递归展开 / 两侧路径根语义不同 / 替换顺序敏感）并**如实提示** `stubs/dsh-win32-process/package.json` 两侧都没落盘。构建脚本同步接入其 `--selftest`。 |
| **补丁幂等判据锚在 marker（代理量）** | 修构建脚本 2 处 | 真跑 `-SkipInstall` 抓到：① **P2-1b** 的**替换文本里根本没写 marker** ⇒ 第二次跑 markerCount=0 ⇒ 去匹配已被替换掉的锚点 ⇒ throw（**完整构建被掩盖**，Step 3 重建 runtime；**`-SkipInstall` 才暴露**）；② **Step 4.8** 的 marker 被 **Step 4.85 的 `patch-resilient-list.mjs` 重写同一 import 行时抹掉**（实测 `RENAME-PATCH` **0 处**、`RESILIENT-LIST-IMPORT` 1 处，而 `rename` 已 import、`await rename(tmp, finalPath)` 已在 ⇒ **语义早就生效**）。⇒ ① 给替换文本补 marker + 给 `Dsht-Patch` 加**第二判据 `$Already`**（已生效的产物形态）；② 幂等判据改锚到**语义已生效**（import 含 `rename` **且** 无裸 `await link(tmp, finalPath);`）。 |
| **GOAL.md 引用已删除的探针**（P-11 违规） | 常驻化 | `docs/GOAL.md` 两处引用 `rp-workspace/tmp/diag-apk-runtime-version.mjs`，而该文件上一轮被当临时探针清理；且 `rp-workspace/tmp/` 被 `.gitignore:34` 排除 ⇒ **文档承诺了、文件不存在、路径天然不可追踪**。⇒ 能力常驻化为 `scripts/verify-apk-runtime-version.mjs`，文档改指该路径。 |
| **真跑构建验证（含负控）** | 全绿 | 正控：`-DshVersion 0.1.5-rc.1 -SkipInstall -Arch x86_64 -SentinelV 357` ⇒ **exit 0**，Step 0.7（4 OK/0 FAIL，设备真实数据 **1969 处 `startSeq`**）→ 十三门禁 → Step 4.8「已生效（语义匹配），跳过」+「F1 自检 0 处裸 `link(`」→ **Step 6.5 产物核验通过**。负控：`-DshVersion 0.1.2-rc.1`（W24c 事故原命令）⇒ **Step 0.7 当场拦下**（fail-closed + 可读指引）。 |
| **本轮回归基线（W25 收口后）** | 全绿 | vitest **81 文件 / 1786 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项**全 exit 0（新增第 13 项；第 7 项增判据二 + `--selftest`）；双架构 APK sentinel **v357** 一致；`verify-apk-runtime-version` 双包 `dsh 0.1.5-rc.1` / `dsh-session 0.1.5-rc.2` / `isReplaceOp=op/startSeq/endSeq` 一致；产物核验 **169 项 / 缺失 0**；M7 **39 PASS / 0 FAIL / 18 SKIP**。 |

### 附录四续十七：第二十八轮 W26 —— 把「补丁幂等判据」整族查清并机器化（2026-09-16）

> **本轮主题**：W25 修了 2 处幂等判据失效就收工了。本轮把它当**一族**查 —— 结果抓到
> **P-41 第四例真缺陷**（marker 互为子串 ⇒ 主体补丁**静默跳过**），并把整族**双侧机器化**。

| 类 | 处置 | 说明 |
|---|---|---|
| **★ 补丁 marker 互为子串 ⇒ 主体补丁静默跳过**（P-41 第四例） | 修 + 机器化 | `patch-resilient-list.mjs` 的 `MARKER = 'DSHT-RESILIENT-LIST'` 是 `IMPORT_MARK = 'DSHT-RESILIENT-LIST-IMPORT'` 的**真前缀**，而幂等判据是 `t.includes(MARKER)` ⇒ 只要文件里有 IMPORT 标记就判「主体已打」。**决定性实验**（`scripts/audit-resilient-idem-probe.mjs`，合成夹具 + 真跑被测脚本；**已随修复常驻化为回归判据**）：B 场景（预置一行 IMPORT 注释、**锚点原样保留**）⇒ 脚本 **exit 0**、输出 `补 import rename:`（**看起来成功**）而**主体补丁根本没打** ⇒ **boot-loop 防线消失而无人知晓**；C 杠杆（只删那一行注释）⇒ 立刻 `patched: …` ⇒ 根因锁定。**修法**：① 幂等判据改锚到**「主体语义已生效」**（两代 REPL 共有的语义片段，不依赖 marker）；② import 标记**改名** `DSHT-RESILIENT-IMPORT`（子串通道消失）；③ 加半打状态**出声告警**。修复后 B 场景**不再复现**「静默跳过」 |
| **判据三只扫 ps1 侧**（P-11 元级形态） | 扩到**双侧** | python 的 `apply-platform-patches.py` 的 `patch()`（20 处）与 ps1 的 `Dsht-Patch`（13 处）是**同一族**（都 `count(marker)` 判幂等），而判据三此前只扫 ps1 ⇒ python 侧同类缺陷**结构上发现不了**。`audit-patch-markers.py` 虽实现同一判据，但**全仓无任何自动触发点**（不在 Step 0.5、不在 `build-wb.sh`）⇒ **判据本身在犯 P-11**。⇒ 用 AST 求值收进常驻门禁（**实参求值不出 ⇒ 报红要求人工确认**，不许静默放过）。 |
| **新增判据四：marker 不得互为子串** | 新判据 | 口径：只扫**脚本源码**、只取**引号字面量**、**排除整行注释**（注释是历史说明，不该撑红判据）、覆盖 `DSHT-` / `DSHT_` 两族、**过滤「前缀族探测」**（`'DSHT-'` 这类 `in` 用法本就该匹配一族）。判据一同时改用同一「只取代码位置」口径（防改名后旧名残留在注释里造成**假红**）。 |
| **真实仓库负控（不只自证）** | 2 组 | ① 把 `IMPORT_MARK` 改回旧名 ⇒ 判据四**当场报红**（exit 1「碰撞 1 对」）；② 去掉 python 侧某 `repl` 的 marker ⇒ 判据三**当场报红**（「python 幂等口径不自洽 1 处」）。**两组均逐字节还原并复核一致**。 |
| **P-41 推论补全** | 文档 | **推论二**：**marker 是最容易误当事实的代理量**，三种脱钩方式（没写进 repl / 被别的步骤抹掉 / 互为子串），收口方式一致 = 改锚到「语义已生效」。**推论三**：**判据的覆盖面本身也要有判据** —— 「已接入常驻门禁」≠「覆盖了真实面」；落地手法是把「**扫到了几个**」与「**违约几个**」一起打印。 |
| **判据自身的 5 个坑**（第十~十四例） | 全被自证/实跑抓到 | ① 只判前缀漏后缀（改判真子串）② 用例期望写反 ③ 词法收窄漏 `DSHT_` 族（扩到 `[-_]`）④ 口径扩宽误收「前缀族探测」（报 32 对假红 ⇒ 过滤分隔符结尾）⑤ 判据一不过滤注释 ⇒ 旧名假红。 |
| **本轮回归基线（W26 收口后）** | 全绿 | vitest **81 文件 / 1786 通过 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项**全 exit 0（第 7 项 selftest **19 → 24/24**）；`-SkipInstall` 真跑构建 **exit 0**（Step 0.5 十三项 + Step 6.5 全绿）；产物核验 **169 项 / 缺失 0**；M7 **48 PASS / 0 FAIL / 21 SKIP**（优于上轮 39/0/18）。 |

### 附录四续十八：第二十八轮 W26 续 —— 设备取证三项（W13/W18 抽样池前提 · W14 控件取证 + 真缺陷 · R22③ 设备一致性）

| 类 | 处置 | 说明 |
|---|---|---|
| **E-F「含拖拽」口径的抽样池前提只有推测**（W13/W18） | 举证 + 机器化 | 此前只写「属抽样池限制」，**无判据** ⇒「拖拽没测」无法与「池子里本来就没有」区分。新探针 `scripts/ef-drag-pool.mjs`（`--selftest` 6/6）扫设备**全部 29 会话 / 34.9MB**（取回 29/29、正控全过）⇒ **0 张**带 jQuery UI **可执行**拖拽用法。**判据收窄的关键**：`jquery`/`jQuery UI` 字样各命中 1 处，逐条取证全是「**提及**」（脚本的事件名探测数组 / 我方项目文档被导入成会话正文）⇒ 若按「字样」判会给**错误建议**（假绿建议）。 |
| **W14「该页未渲染」是误判** | 纠正 | `rollback-btn` / `ps-select` 实测**本来就在且达标**（96×44 / 160×44，`flex-shrink:0`）⇒ 上轮把「那次没测到」写成了「页面上没有」，导致该工作面**被错误搁置若干轮**（P-17 的反向形态）。 |
| **`sv-row.sv-node` 25px（6 个 P1）** | 修 + 常驻判据 | 状态查看树节点行实测 **312×25**（归因 `height-effective`；但 computed `flex-shrink:1` ⇒ 按 P-25 纪律**预防性**一并给 0）。修 `dsht-rp-ui/src/client/style.ts` 的 `(pointer: coarse)` 段。设备复验 **264 个节点行全部 312×44**、12 态穷举 **0 P1 / 0 P2**。新探针 `scripts/ef-stateview-rows.mjs`（`--selftest` 5/5，含 ★**空样本必须判不通过**）。 |
| **★ 改前端 client 未抬 `RUNTIME_SENTINEL`**（新纪律 R22③） | 固化为纪律 + 配套判据 | 覆盖安装靠 sentinel 比对决定**是否重新解压**。本轮改了 `style.ts` 却沿用 v357 ⇒ 装了新 APK 而设备跑**旧 client** ⇒ 探针如实报「修复未生效」，**把装置失误误读成产品修复失败**。⇒ 固化 **R22③**（并在 §3.1 的命令行里写明 `-SentinelV 358`）+ 配套判据 `verify-apk-runtime-version.mjs --device --expect-str …`（核设备侧字节数 + 特征串；负控 `audit-device-runtime-negctl.mjs` **3/3**）。**边界**：该判据**不接构建期**（构建时设备装的还是上一个 APK ⇒ 必然假红），正确时机是「装完 APK、跑设备探针之前」。 |
| **本轮回归基线（W26 续收口后）** | 全绿 | vitest **81 / 1786 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项** + 新增 3 支判据自证全 exit 0；双架构 APK sentinel **v358**；产物核验 **169 项 / 缺失 0**；M7 **48 PASS / 0 FAIL / 21 SKIP**；设备侧 runtime 一致性 ✓（**2680713 B** 与产物相同 + 特征串命中 1）。 |

### 附录四续十九：第二十九轮 W27 —— 把两个「须真机」标注实测掉（proot 生存性 / 时延敏感路径）

| 类 | 处置 | 说明 |
|---|---|---|
| **W10「L4 proot 生存性」标「须真机」** | **实测掉**（前提本就成立） | 原文要求「真机 SELinux / **Android 15+** seccomp 下 probe 是否 `status===0`」，而**本机 AVD 实测 = Android 15 / SDK 35** ⇒ 前提在本机就满足。**关键手法**：不「跑一遍看看」，而是**用设备上的真实 node + `NodeService` 注入的真实 env 逐字复算 JS 层那一行判定** ⇒ `BINDS=8 DROPPED=["/sdcard","/storage/emulated"] STATUS=0` ⇒ `globalThis.__dshtProotOk=true` ⇒ **`enforcement="full"`（真隔离生效）**；再以 guest 内**真执行** `/bin/busybox echo PROOT-GUEST-OK` 做结果面、logcat `proot probe failed` **0 条**做交叉证据；消融确认 **5 项 bind 全是必需项**。新探针 `scripts/ef-proot-liveness.mjs`（selftest 5/5，含 ★「探针过但 guest 实执行失败」负控）。 |
| **W11「L4 时延敏感路径」标「须真机」** | **实测掉 + 量化** | 三条路径在设备侧直接计时：解压等价工作量（**24483 文件 / 413MB** 复制）**552ms** · 13.4MB 会话逐行 `JSON.parse` **282ms** · **真实产品正则 22 条 × 937 条正文 / 4.5MB** **4541ms**。新探针 `scripts/ef-latency-probe.mjs`（selftest 7/7）。 |
| **★ 首版时延探针「自造」了一个重大缺陷** | **三步推翻 + 产出 P-42** | 首版用**按印象手写的 10 条正则**（含 `([\s\S]*)\[OS\]([\s\S]*)` 两头贪婪）跑出「**28 分 52 秒仍未结束**」，**看起来是灾难性回溯的重大产品缺陷**。三步取证推翻：① 全仓 `grep '\[OS\]'` **0 命中**；② 扫设备**全部 29 会话**提取不出该正则；③ 逐条限时二分 ⇒ 元凶就是**那条我自己写的**（其余 9 条各 ~170ms）⇒ **自编输入 = 无效证据**。⇒ 改为**从产品源码抽真实正则**（并收紧「注释/路径误报」），产出 **P-42**。 |
| **W9「滚动截屏」标「须真机」** | **标注成立**（经验证） | 探针实测 `sdkInt=35 · hint=2（INCLUDE 已生效）· probe=available · callback=absent`，五条探测路径中唯一成功的那条对「有无 callback」无区分力 ⇒ 系统是否提供捕获实现**本机测不出** ⇒ 探针按 R7 **不写 PASS 也不写 FAIL**，报「未知 + 最终判据 = 真机系统截屏操作」。**这是正确用法**（不是误标）。 |
| **本轮回归基线（W27 收口后）** | 全绿 | vitest **81 / 1786 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项** + **6 支新增判据自证**（parity 24/24 · drag-pool 6/6 · stateview-rows 5/5 · proot-liveness 5/5 · latency 7/7 · device-runtime 3/3）全 exit 0；双架构 APK sentinel **v358**；产物核验 **169 项 / 缺失 0**；M7 **48 PASS / 0 FAIL / 21 SKIP**；E-G **5 PASS / 0 FAIL / 1 SKIP**（⑥ 滚动截屏按 R7 记「未知」，非缺陷）。 |

---

### 附录四续二十：第二十九轮 W28 —— T-87 判据 8 的架构冲突收口 + 判据输入自身的可靠性

| 类 | 处置 | 说明 |
|---|---|---|
| **`rebuild-plugins.ps1` 长期 exit 1** | **根因不是它自己** | 报错文案是「T-87: 等价性验证的**反控**未通过」，但取证发现反控是好的 —— 真因是 `verify-rp-consolidation.mjs` 的**判据 8 不过**（12/13），于是反控的「还原后回绿」拿不到全绿。⇒ **报错文案会把方向带错**（与 P-41 推论二① 同族）。 |
| **判据 8 报「5 个包仍 `export const name/inject`」（10 条）** | **经取证：架构约束，非缺陷** | `docs/T-87-RP-PLUGIN-CONSOLIDATION.md:106` 确有此要求，但**两条构建路径对同一份源码要求相反**：**权威路径** `build-dsht.ps1` Step 4.7/4.72 把 5 个包**各自独立编译为包入口**，cordis loader 从**包 exports** 取 `name`（E2：`import()` 得 `name="dsht-plugin-mvu" inject=["webServer","settings"]`）；E3 反证：降级后 esbuild 产物 `导出 name=false` ⇒ **权威路径直接坏**。⇒ 我曾按文档把 4 个包降级，取证后**全部回滚**。**同一份源码不可同时满足两条路径**。 |
| **判据 8 的修法** | **按 P-41 改锚到「两条路径是否已归一」** | 未归一 ⇒ ②③ 出声说明「**条件未成立** + 解除条件（T-87 落地步骤第 4 步）」**不计违约**；已归一 ⇒ **自动收紧**（P-37：判据自己会失效）。判定依据**读脚本**而非硬编码状态（P-27）。**解除条件**属 B5 大改（`build-dsht.ps1` 的 Step 4.7/4.72/4.75 合并为一个 Step），待拍板。 |
| **★ 我自己刚写的检出就漏了 4 项** | **自证发现 → 修正** | 报表打印「仍独立编译 **1** 个」而我预期 **5**。根因：`Step 4.72` 用**循环 + 变量插值**（`foreach ($r10 in $r10Plugins) { esbuild "src/$r10/index.ts" }`）⇒ 那 4 个 entry **从不以字面量出现**。**后果比报错更坏**：若将来只归一了主包，判据会**误判为已归一**并对仍需 export 的 4 个包**开始误报**。修法：解析**两种形态** + **交叉验证**（循环体在、成员展开为空 ⇒ 报红）+ 「插值入口未被覆盖」登记 `unresolved` ⇒ 报红 + 「解析面为 0」也报红。落地 `--selftest-parser`（**8/8**，含「只匹配字面量 ⇒ 只认 1 个」这一**复现首版缺陷**的负控）、真实仓库负控 `audit-rp-parser-negctl.mjs`（**4/4**：三种漏形态各「报红 + 逐字节还原回绿」），并**前置**到 `rebuild-plugins.ps1`。**产出 P-41 推论四**。 |
| **★ 编辑工具静默剥掉 `.ps1` 的 UTF-8 BOM** | **决定性实验 + 落地判据五** | `powershell -File` 立刻失败，报错却指向**第 123 行的 JSON 字面量**（真凶在第 **1 行之前**，相距 122 行）⇒ 极易误诊（花两轮定位）。机制：**PowerShell 5.1 无 BOM 时按系统 ANSI 代码页（GBK）解码** ⇒ 中文注释变乱码 ⇒ **引号配对被打断**。**实验**（同一份字节）：带 BOM **0** 处语法错误 / 无 BOM **54** 处；⚠️ **必须用 `powershell.exe`（5.1）跑**（PS7 默认 UTF-8，两次都是 0 —— 「我这里好好的」会让判据形同虚设）。落地 `audit-build-path-parity.py` **判据五**（**自动发现** `scripts/*.ps1`；硬编码名单的漏法 = 新增脚本没人登记 ⇒ 判据沉默；「0 个待检文件」也判红）。selftest 24 → **33/33**；★ **在原位抓到两次真实回归**（本轮两次编辑各剥一次）。**产出 P-41 推论五 + R22④**。 |
| **判据数与端到端** | 全绿 | `verify-rp-consolidation.mjs` 判据数 **13 → 15**（新增 8c 解析器自证），**15/15 PASS** + 反控 PASS ⇒ `rebuild-plugins.ps1` **exit 0**（并前置跑 `--selftest-parser`）。`audit-build-path-parity.py` **33/33**（实跑：`自动发现 4 个 .ps1 / 缺 BOM 0 个`）。 |
| **本轮回归基线（W28 收口后）** | 全绿 | vitest **81 / 1786 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项** exit 0（第 7 项现为**五判据** selftest **33/33**）；双架构 APK sentinel **v358**；产物核验 **169 项 / 缺失 0**；M7 **48 PASS / 0 FAIL / 21 SKIP**。 |

---

### 附录四续二十一：第三十轮 W29 —— A14 的锚点修正 + 常驻化（同一个 T-87 事实的第二个观测面）

| 类 | 处置 | 说明 |
|---|---|---|
| **A14（产物新鲜度）报「RP 总包陈旧」** | **经取证：闸门自己锚错了，产物是新鲜的** | 决定性实验（两个 entry 各重编译一次再逐字节比）：按**权威路径** `build-dsht.ps1` Step 4.7 的 entry（`src/dsh-plugin/index.ts`）⇒ **916076 B 与磁盘产物逐字节一致**；按 A14 写死的 T-87 目标 entry（`src/dsht-rp/index.ts`）⇒ 1114303 B 不一致 ⇒ 假红。**它锚在「架构应该长成什么样」（代理量）而非「权威路径实际编译哪个 entry」（事实）**。 |
| **与 W28 的关系（重要）** | **同一个 T-87 半迁移事实的第二个观测面** | W28 在 `verify-rp-consolidation.mjs` 判据 8② 撞到同一事实；W22 早已**登记**该状态，但当时只「记下来 + 写注释」⇒ 它在另一个观测面继续报假红。**教训：登记 ≠ 自洽** —— 凡为兼容半成品状态而写的判据，都必须把该状态变成**读出来的**（P-27）。 |
| **修法** | **按 P-41 改锚：从两条权威脚本实读 entry** | 新增 `parseArtifactEntries()` 从 `build-dsht.ps1` + `rebuild-plugins.ps1` 解析「产物 → entry」。T-87 第 4 步落地后 entry 自动跟上；改了脚本 entry 而没同步产物 ⇒ 立刻报红。**两条路径对同一产物声明不同 entry** 这一关键事实**首次被机器读出并出声**（`dsht-rp-plugin/lib/index.js` 有 2 条声明）⇒ 口径 = 「逐条试编译，任一逐字节一致即判新鲜」（**不静默选一个** —— 选错正是本轮的缺陷形态）。 |
| **★ 改锚中连踩 5 个自身缺陷** | **全部由自测/实跑当场抓到** | ① 只读一条脚本（另一条独有的产物被判「读不到 entry」⇒ 又退回硬编码）② 锚在 `"esbuild"` 这个**字面词**上（真实脚本写的是 `& $node $esb <entry>`）③ 函数体用**非贪婪正则**圈 ⇒ 停在**别的函数**上（诊断显示 `FN=Say … body has $entry: true`）④ 漏**函数内局部变量**（模板 `"$dir\lib\index.js"`）⑤ 形参与局部变量**分两步展开** ⇒ 同一函数两次调用**互相覆盖**。 |
| **★ 判据自己也要守（两件，都由实跑暴露）** | 加守卫 + 加负控 | **(a)** 新负控复用 A14 的解析器时 `import` 了它 ⇒ A14 的判定代码在**模块顶层** ⇒ 把整套判定跑了一遍（输出混入 + 白花几十秒）⇒ 加 `IS_MAIN` 守卫。**(b)** 解析器若静默返回空 ⇒ A14 会**悄悄退回硬编码 entry**（正是本轮修的缺陷）而输出仍像通过 ⇒ 新负控 `audit-a14-anchor-negctl.mjs`（**3/3 PASS**：锚点来自权威脚本 / 用解析出的 entry 重编译 ≡ 产物 / **杠杆**：换错误 entry ⇒ 字节必然不同）。 |
| **常驻化**（收口 W22 登记的 P-11 元级违规） | **接入 Step 5.4** | A14 此前**全仓无任何自动触发点**。⇒ 接入 **Step 5.4**（产物就位后、打 `runtime.zip` **之前**）。**为什么不是 Step 0.5**：A14 要「现场重编译再逐字节比」⇒ 要求产物已就位，放前置只会 optional 跳过。守 **R22② / P-40③**：**判据必须跑在它所判对象的状态已确定之后**。 |
| **★ 判据五在原位第 3~4 次抓到真实回归** | 机器化生效的实证 | 本轮编辑 `build-dsht.ps1` 时工具**又两次**静默剥掉 BOM（累计已 4 次）。已在判据源码里**如实登记该频次** —— 「不是一次性事故，而是每次编辑都可能发生的系统性行为」，这正是必须机器化的最强理由。 |
| **本轮回归基线（W29 收口后）** | 全绿 | vitest **81 / 1786 / 2 skipped / 0 失败**；typecheck 三段 **0 错**；门禁 **十三项** exit 0（第 7 项 selftest **38/38**；**Step 0.55** 2 组负控；**Step 5.4** A14 selftest **12 项** + 锚点负控 **3/3**）；`build-dsht.ps1 -SkipInstall` **exit 0**；`rebuild-plugins.ps1` **exit 0**；产物核验 **169 项 / 缺失 0**；R22③ 设备一致性 ✓；M7 **53 PASS / 0 FAIL / 16 SKIP**（优于上轮 49/0/20）。 |

---

### 附录四续二十二：第三十轮 W29 续 —— 由「3 格过期标记」反查出**成体系的无判据缺陷**

| 类 | 处置 | 说明 |
|---|---|---|
| **矩阵残余标记会过期，且当时无任何判据守它** | **新增常驻闸门** | 矩阵（`MOBILE-TEST-METHODOLOGY.md` §二 L1~L5 表）是「要测什么」的 **SSOT**，但**结论会过期**：某格标「部分覆盖 / 须运行时验证」，而后续轮次早已做完并设备复验，**却没人回头改**。W29 **一轮内撞见 3 格**（L5 `display 正则链` / L2 `长文本宽元素` / L1 `触控目标尺寸`），全靠人工看见。后果不是「不好看」，而是**后人据它重复排查**（P-1 口径不一致）+ 让 **E-B「矩阵清零」看起来永远做不完**。 |
| **新闸门** | `scripts/audit-matrix-residuals.mjs` | 接入 **Step 0.5**（selftest **7/7**）。判据：凡标「部分覆盖/未覆盖」的格子，其残余描述必须**结构完整** —— 「须运行时验证/待复测/待判定」这类**未收敛**措辞**必须**同时给出 ① **真实存在的**探针 ② **登记处**（`docs/…` 或 `§6.x`）；否则报红（**悬空待办**）。 |
| **两条设计要点（P-19 家族教训）** | 探针须真实存在 + 「已归属」即收敛 | ① 只判「有没有写探针名」会放过**引用了不存在的探针**这种更坏形态 —— 那是**假证据**（比没有更误导）⇒ selftest 专设负控。② 残余若指向「属宿主 / 属卡页面 / 待上游化」，那**不是我们的活** ⇒ 不阻塞（否则会制造无意义的红）。 |
| **★ 诚实边界（R7）** | **不夸大战果** | 本闸门只查「残余描述的**结构完整性**」，**不查残余是否真的还在** —— 后者须**逐个真跑**（正是本轮人工做的部分）。⇒ 它是**降低复发率的护栏**，**不替代人工复核**。 |
| **同轮另修 3 格过期标记** | 文档与实现对齐 | L5 `display 正则链`（N1~N5 早在 T-20 收口，`th-regex-contract.spec.ts` **13 例全过**）· L2 `长文本宽元素`（W5 早已设备复验 6/6）· L1 `触控目标尺寸`（W1/W2 早已 12 态穷举 0 P1/0 P2）。另给 `docs/TH-REGEX-SOURCE-DIFF-2026-09-08.md` 补**状态标记**（此前**只有问题清单**、会让后人重复排查）。 |
| **最终矩阵状态** | 无「未开始」格，残余全部可追踪 | 本轮人工逐格真跑后的中间态：L1 **6/2**（8 项）· L2 **5/2** · L3 **5/0** · L4 **6 项均已覆盖或已实测**（仅剩真机复核）· L5 **3/2**。⇒ **随后（同轮续二）已全部收口为 L1 8/8 / L2 7/7 / L3 5/5 / L4 6/6 / L5 5/5**（E-B 达成，见 GOAL §3.1 与 §11.3 W15）。 |
| **判据五在同轮累计第 5 次抓到真实回归** | 机器化生效的实证 | 编辑 `build-dsht.ps1` 时工具又静默剥掉 BOM ⇒ 判据五当场报红（`syntax errors=57`）。已在判据源码里**如实登记该频次**。 |

---

### 附录四续二十三：第三十轮 W29 续三 —— M7 一次复跑抓到**两例同族判据缺陷**（产出 P-43）

| 类 | 处置 | 说明 |
|---|---|---|
| **「无判据力」被误判为 FAIL** | **P-43（新判据）** | 判据的三态是 **PASS / SKIP / FAIL**。当**该场景在这张卡上根本不存在**时（按钮不存在、可回退内容为空），**没有对象可判** ⇒ 属 **SKIP**，**不是 FAIL**。判 FAIL 等于**用「测不出来」指控产品**。 |
| **实证一（`J7 真重发`）** | 改为 SKIP 并出声 | 证据串「注入留痕=composer 仍留有本轮文本」看着像真缺陷。**决定性取证**：读 `st-1q84arh/session.v3.jsonl`（2115715 B）⇒ 含本轮身份串的 user 消息 **0** 条、文件末事件停在前一天（`session/end-seed`）⇒ 本轮**零新事件落盘**。判据**无法区分**「宿主真没接住」与「装置没测到」，而同批另 4 卡 `J7` **全 PASS** ⇒ 无证据支持「产品坏了」。按 R7/P-17 记 **SKIP**。 |
| **实证二（`J13 再回退`）** | 改为 SKIP 并出声 | 证据串「点击=`no-btn`」—— 该卡 **`user=0`（无用户楼层）** ⇒ `.dsht-rp-rollback-btn` **本就不存在**（没有可回退的东西）。**这不是「回退坏了」，而是这张卡没有「回退」这个概念。** ⇒ 补 `j13notApplicable` 分支记 SKIP，证据里写清原因。 |
| **★ 判据力不减（防后人误松）** | 写进源码注释 | `acted && (grew \|\| floorDropped)` ⇒ 仍 **PASS**；`acted && !grew && !floorDropped`（**真点了却无变化**）⇒ 仍 **SKIP 并出声**；**只有**「确实生效了却与预期相反」才判 FAIL。 |
| **识别特征** | 优先怀疑判据 | **FAIL 的证据串里写着「什么都没发生」或「元素不存在」** ⇒ 产品没做错任何事，只是这一格没有它的戏。危险性在于它**看起来最像真缺陷**（「回退点了没反应」），会把人引去改一个没有问题的功能。 |
| **复跑验证** | 0 FAIL | M7 **46 PASS / 0 FAIL / 23 SKIP**（5 张卡）；本轮 `J13` 在 `st-n0gnfp` 上拿到**真判据力**（`点击=clicked · 集合 823→827（↑） 且 楼层 51→50（↓）`）⇒ **PASS**。 |

---

### 附录四续二十四：第三十轮 W30 —— W2 残余「设置面板态」收口，连抓**两层覆盖空洞**（产出 P-44）

| 类 | 处置 | 说明 |
|---|---|---|
| **L1 跨态穷举长期缺「宿主设置面板态」** | **已纳入** | 此前的 12 态**全是我方自建浮层**；宿主设置页是**宿主原生 UI**，没人进过（§6.14h 登记为「仍未收口」）。 |
| **P-19 先取证再写代码** | 选择器全部设备实测 | 实测：入口 `.VOzbGW_trigger`（`aria-label="Settings"`）· 「插件」tab 文案**是英文 `Plugins`**（★我原本按中文「插件」匹配 ⇒ **一个都匹配不到**）· 关闭按钮 `.VOzbGW_close`（`.VOzbGW_trigger` 二次点击**不管用**）· 我方 4 张设置卡都在。 |
| **★ 第一层空洞：只扫当前视口** | 加**滚动扫描** | 新态首版只报 **2 个**元素；而设置卡挂在 **2613px 滚动列**里，实际有 **25 个**。18 个 `.dsht-npc-switch` 因 `top > 视口 803` 被 `elementFromPoint` 判出视口 ⇒ **整张卡的交互面从未被测**（P-20 覆盖空洞，**无任何症状**）。修法：自动发现「含我方元素的可滚动面」→ 按 `clientHeight×0.6` 走完 → 还原 `scrollTop` 不留副作用 → 按 `Set<Element>` 身份去重。 |
| **★ 第二层空洞：归因只覆盖一维** | 加**宽度维度** | 补滚动后 17 个 P1 全部 `36×44`，而归因输出「`真因=height-effective`、`onlyHeight=36×44`」——**读数写着 36 却判「高度有效」**（P-29 招牌）。真因是**宽度**。修法：`needsFix: {width, height}` 先判哪个维度不足，再在那一维做试验。 |
| **真缺陷：`.dsht-npc-switch` 宽度从未被修过** | 已修 | 桌面 `width: 36px`，coarse 段**只写了 `height: 44px`** ⇒ 宽度恒 36（< 38 底线）。修为 **44×44**（决定性实验：`onlyWidth=44×44` ⇒ **width-effective**）。 |
| **新判据 P-44** | 「修一半」型缺陷 | **二维判据只覆盖一维**。静态护栏：coarse 段凡**只给 height 不给 width**、且桌面基线有**固定像素 width** 的即报红；★ 必须排除**流式宽度**（`100%`/`auto`）—— 首版正是在这里给出假阳性（`.dsht-rp-sidebar-btn`）。 |
| **三条护栏各抓到一次** | 机器化有效 | **A11**：我在 `style.ts` 注释里写了裸反引号 + 探针 SNAP 锚点变异步 ⇒ 两处报红；**`mobile-adapt.spec.ts`**：注释里写了宿主 hash 类名（违反「rp-ui 不得依赖宿主 hash」）；**新护栏**：`.dsht-rp-sidebar-btn` 假阳性（判据收窄 + 补负控）。 |
| **修复后设备复验** | 0 P1 | `host-settings-card-open` **20 个元素 / P1=0**（修前 2 个元素 / 17 P1）；**全量 16 态全生效 / 0 P1 / 0 P2 / 累计去重 224 个**（修前 111 个，**翻倍**）；M7 **50 PASS / 0 FAIL / 19 SKIP**。 |
| **★ 同轮把 W2 最后一项残余也补掉** | 12 → **16 态** | 新增「卡脚本面板内部 tab 态」（`script-panel-logs` / `script-panel-vars`，抽屉是**条件渲染** ⇒ 只测基本态会漏掉两个抽屉的全部可点元素）。 |
| **★ 第三层判据缺陷：就绪竞态** | 改为**轮询到就绪** | 全量跑时 `host-settings-card-open` 偶发报「态未生效」，而单跑稳定 ok、逐步留痕显示每步都对 ⇒ 真因在**判据自身**：`ev(expr, tries, gap)` 的 `tries/gap` **只在抛异常时**重试 ⇒ `expect` 返回 `false` 时**等于只查一次**，撞上懒挂载面板的首次渲染慢。⇒ 按 R16 改为轮询（上限 30s），仍不成立才记 `not-entered`。**这正是 R16 的两半只写了一半**。 |
| **★ 同类横向排查（R4）** | 17 个探针逐脚本过筛 | 缺陷①「只扫视口」**新增 0 处**、缺陷②「归因只覆盖一维」**新增 0 处**、缺陷③「就绪检查只查一次」**★ 4 处**。**同域两处当场收口**：**S1 `ef-stateview-rows.mjs`**（无重试 `ev` + 固定 `sleep(1600)` 进态 + 采集只查一次 ⇒ 会把慢渲染判成产品 FAIL，而它是全仓**唯一**的节点行判据 ⇒ 无法证伪；改为页面内轮询 + Node 侧 `pollUntil` + **0 行改记 SKIP 并出声**，selftest 5/5 保留空样本负控；设备复验 264 行全部 ≥44px）；**S2 `perf-audit.mjs` 面 7**（`judgeTargets([])` 返回 `ok:true` ⇒ 打印「共检 **0** 个不达标 · 全部达标」= **零覆盖冒充通过**；★ **它的 selftest 里那条「空集合 ⇒ 期望绿」把该假绿固化成了期望值**，两者一并改成反控）。**剩余 2 处按纪律不夹带**（S3 `eg-mobile-actions.mjs` 零轮询 / S4 `ef-font-scale.mjs` 的 `ev()` 复制品，属 P-1 单源违例）⇒ 登记 GOAL §11.1 **W31**。 |
| **★ S2 收口时抓到两处「口径冲突」** | 判据间同口径（P-1 形态） | ① `perf-audit` 面 7 报 `.dsht-rp-sidebar-btn` **31×44**，而 `ef-touch-targets.mjs` 对**同一元素**因「视口外点不到」而**跳过** = **相反结论**。**决定性实验**（`tmp/w30-sidebar-btn.mjs`）：侧栏**展开**时该按钮 **256×44**（桌面 `width:100%` 撑满容器）⇒ **完全达标**；折叠时 31×44 但在视口外、`elementFromPoint` 命不中 ⇒ **用户点不到**。⇒ 给面 7 补同款「可点性」前置判定 + 把排除项**出声**。② 修完复查（`tmp/w30-reachability.mjs`）：候选 **9** / 可达 **6** / 判不可点 **3**，那 3 个**全部 `inViewport:false`**（`left=-288` / `top=-1028`）⇒ **无假阳性**。 |

---

### 附录四续二十五：第三十轮 W31 —— E-G 六项核心动作的**判据力补强**（产出 P-44 第 ⑧ 条）

| 类 | 处置 | 说明 |
|---|---|---|
| **起点** | §6.30⑧ 横向排查的第三处 | 「就绪检查只查一次」这一族在 17 个探针里共 **4 处**；S1/S2 已于 §6.30 当场收口，**S3 `eg-mobile-actions.mjs`** 因分属「E-G 移动端核心动作」这一不同工作面而登记 W31。 |
| **★ ① 悬浮窗可拖拽：注释与实现不一致** | 升级为**真拖拽实验** | 文件头注释与 goal E-G 都写着「派发真实 pointer 事件序列，**断言位置真的变了**」，而实现**只读两条 CSS 属性**（`pointer-events !== 'none'` + `position !== 'static'`）= **机制不是结果**（P-24）。**危害**：拖拽逻辑即使因 pointer capture 生命周期缺陷彻底失效（本仓 W7 修过 `lostpointercapture`），本项**照样 PASS**。⇒ 真派发 `pointerdown→pointermove×5→pointerup`（`pointerType:'touch'`）+ 断言 rect 真变 ⇒ 设备实测 **`340,219 → 340,279`（Δ=0,60）**。 |
| **★ ⑤ 切后台回前台不丢会话：判据本身无判据力** | 改为真验三面保持 | 原读 `document.body.children.length` 前后比较 —— 而 body 子节点是**外壳结构**（`#root`/toast/iframe），切后台**根本不会变** ⇒ **即使真丢会话也恒 PASS**（P-20 覆盖空洞的教科书形态）。⇒ 改验「回前台后 **我方 UI 计数 / 消息节点计数 / 数据面 RPC** 三者同时保持」⇒ 实测 UI `113→113→113` · 消息 `6→6→6` · 数据面可达=true；无消息节点时记 **SKIP 出声**。 |
| **② 浮窗可点：单次采样 + 假红** | 轮询 + FAIL 改 SKIP | 加 `pollUntil`（R16）；「轮询 20s 后仍未命中自身」从 **FAIL** 改 **SKIP 并出声**（无法区分「被遮挡」与「采样落在透明边角」，R7/P-17）。 |
| **结果** | 5 PASS / 0 FAIL / 1 SKIP | ⑥ 滚动截屏仍为**真机项**（模拟器不提供系统截屏 UI）—— 不写成 PASS 也不写成 FAIL（R7）。 |
| **新判据** | **P-44 第 ⑧ 条** | 「判据的注释/设计意图」与「判据的实现」必须一致；不一致处**优先怀疑代码**（注释常是设计意图、更接近正确）。★ 复核判据时**不要问「它现在绿吗」，要问「如果我把它所测的东西弄坏，它会红吗」**（P-20 原话）。 |
| **W31 状态** | S1/S2/S3 **全部收口** | 遗留仅 **S4**（`ef-font-scale.mjs` 的 `ev()` 复制品，属 P-1 单源违例；风险已被其 `waitReady()` 挡住）。 |

---

### 附录四续二十六：第三十轮 W31 续 —— 探针 CDP 求值**收成单源**，并抓到判据**口径过宽**（产出 P-45）

| 类 | 处置 | 说明 |
|---|---|---|
| **S4 收口：P-1 单源违例** | 新建 `scripts/cdp-eval.mjs` | `ef-touch-targets.mjs` 与 `ef-font-scale.mjs` 的 `ev()` 是**逐字同构的两份拷贝**（连「`tries/gap` 只在 catch 重试 ⇒ 返回 false 等于只查一次」这个缺陷都一模一样）⇒ 修一处**不会**传导到另一处。现单源导出 `makeEv`（**连接级**重试，每次新建连接守 R15）/ `pollUntil`（**业务级**轮询到就绪守 R16）。 |
| **门禁此前看不见它（P-11 元级）** | 补扫描面 | `audit-impl-duplication.mjs` 原先**只扫 `packages/src`** ⇒ 对 `scripts/` 下的重复**结构性看不见**。给 `walk()` 加 `exts` 参数（**默认口径不变**），新判据 7 显式传 `.mjs`。 |
| **★ 判据 7 首版口径过宽** | 收窄到真目标 | 首版＝「**任何**同时出现 `webSocketDebuggerUrl` + `Runtime.evaluate` 的文件」⇒ 一次报出 **80 处**假红，把 `cdp-boot` / `dsht-*` / `hb*` 这些**各自独立的一次性调试脚本**全算成违规。按 **P-38**：「过宽 ⇒ 大量假红，而**假红会训练人忽略报警**（比漏报更危险）」。⇒ 收到「**函数级 + 归一化指纹 + 跨文件 ≥2 处**」：判据问的是「**同一个语义有没有第二份实现**」，不是「有没有用同一套 API」。 |
| **★★ 收窄之后：「0 处」的两种相反含义** | **真实仓库负控**（B11 的机器化） | 收窄后真实仓库得 **0 处** —— 既可能是「重复已收口」（好），也可能是「**收窄过头抓不到了**」（坏，等于**把判据改废**，正是 **B11** 禁止的放宽判据）。**两者输出完全相同**（都是「0 命中」）⇒ 按 **P-30**「真实仓库 0 命中对静态判据是 0 信息量」，必须**用实验分辨**。新建 `scripts/audit-cdp-eval-negctl.mjs`（**7/7 PASS**，接入 **Step 0.55**）：起点基线 exit 0 → **注入**两份真实同形 `ev()` ⇒ 报红 + **精确指向** + **恰好 1 组** → **删除** ⇒ 回绿 → **清理自证**。⇒ 判据有杠杆、收窄没改废。 |
| **顺带：判据五第 6 次抓到 BOM 回归** | 机器化有效 | 编辑 `build-dsht.ps1` 时工具又静默剥 BOM ⇒ 判据五当场报红；补回 3 字节 BOM 后 `38/38 PASS`，另用 `[Parser]::ParseFile` 复核 **PS 5.1 解析 0 错**。★ 我为此写的**临时校验脚本自己也没带 BOM**，于是它也报 same error —— **同一个坑的第 7 次**（这次受害的是临时文件）；改用纯 ASCII 即通过。 |

### 附录四续二十七：第三十二轮 W32 —— **会话「整份打不开」**的真缺陷收口（产出 P-46）

> 这一条**直接改变数据兼容契约的执行方式**：契约 ① 与契约 ② 必须**同时**成立，
> 而此前的修复器**只守契约 ①** —— 于是它对违约 ② 的会话完全无感。

| 项 | 内容 |
|---|---|
| **官方两条契约（须同时成立）** | ① `dsh-compaction/lib/invariant.js:58`：`shadowedRange` 必须 == `shadowedSeqs` 的**首尾**（且 seqs 是当前 surface 的连续切片）。② `dsh-token-meter/lib/types/surface-projection.js:62`：紧邻 surface `replace` 的计量事件（`compaction/prune` / `compaction/summary`），其 claim `[start,end]` 必须**恰好等于**该 replace 的 `[startSeq,endSeq]`；否则**抛错**（不是降级为漂移）。★ **「紧邻」的精确含义见续二十八**（中间夹**任何非计量事件**即让 claim 过期 ⇒ 不受 ② 约束）—— 本行的「紧邻」不得按字面「相邻两行」理解。 |
| **违约 ② 的用户可见后果** | 宿主拒绝对该会话做 token 投影 ⇒ UI 红字 `Failed to load history: failed to project session "…": token surface: replace at seq N over range A-B has no adjacent shadow price (armed claim covers X-Y)` ⇒ **整份会话打不开**（不是「少一段」，是什么都看不到）。 |
| **设备实测（修复前）** | 全设备 **23** 个 `session.v3.jsonl` 中 **2 个**违约 ②：`st-clk9pd`（17 对，claim `[837,830]` 倒序 vs replace `[38,851]`）、`st-vr2jg2`（1 对：claim `[6,140]` vs replace `[6,142]`）。两者**都满足**契约 ① ⇒ 旧修复器 `changed=false`（**盲区**）。 |
| **决定性实验** | `tmp/w32-projection-exp.mjs`：用**官方 `foldSurfaceProjection`** 逐事件 fold ⇒ 原文件 ✗@1457（**逐字复现 UI 红字**）；把 claim 重锚到后继 replace 区间 ⇒ ✓ 通过；**负控**（故意改错一条 range）⇒ ✅ 正确抛错 ⇒ 实验承重。 |
| **修法** | `dsht-plugin-shared/session-repair.ts` 的 `fixPruneSurfaceSpans`：以**后继 replace 的区间**为权威锚（它才是 surface 的真实变更声明，prune 只是**给它定价**），取该区间在**当时 surface** 上的连续切片，同步重写 `shadowedSeqs` + `shadowedRange` ⇒ 两条契约同时成立。锚不在 surface 上 ⇒ 该 prune 已失效，整条删除。**内容零丢失**（prune 不携带正文，只携带计量）—— 实测行数 1638→1638 / 309→309。 |
| **验证（三层）** | **单测** 3 条（正控 / 负控 / 杠杆，vitest 1790 全绿）· **端到端**（真实文件 + 修补后修复器 + 官方投影）两卡 ✗ → ✓ 且二次跑 `changed=false`（幂等）· **设备实测** 全设备投影失败 **2 → 0**（含 M7 旅程后还原态复验仍 0），UI 上 `st-clk9pd` 从红字变为正常渲染（`head=17 · asst=44`），tokenmeter `≈ 0 / 1M` → `≈ 150k / 1M`。 |
| **★ 为什么此前 6 轮没被发现（P-46）** | M7 把 `floors=0` 一律记成「该会话无可见楼层（**可能已被回退到空**）」的 **SKIP** —— 而 `floors=0` 有**两种相反含义**：① 确实没内容（正常事实）② **整份打不开**（硬缺陷）。判据只用了一个读数 ⇒ 硬缺陷被报告成「正常、只是没内容」。**假绿比假红危险**（假红会被看见）。历史日志证实它**连续 6 轮**（w4/w4-r2/w4-r3/w5a/w24d/w29/w30/w32）都是同一句 SKIP。 |
| **判据侧收口** | `ef-journey-all.mjs`：① `waitRendered` 不再把「一次瞬时求值失败」当事实 `floors:0`（改为重试）② 快照新增 `loadError` 观测面（**打不开 = 确定性终态**）③ **J1 分三种终态**（读出内容 PASS / 切卡成功但报加载失败 **FAIL 并出声带原文案** / 切卡本身失败 ⇒ 大会话 SKIP）。另修 J5 取按钮**不主动物化**（按钮所在楼层还在 `data-windowed` 占位里 ⇒ 假 `no-btn`；改为轮询时主动滚到底促使物化）。 |
| **收官数字** | M7 rec 行数 **45 → 81**（同一份 5 卡清单）· M7 结论 **33 PASS/0 FAIL/12 SKIP → 62 PASS/0 FAIL/19 SKIP**。★ **「项数变少」本身就是判据**：修前看着全绿，项数却比上轮少 24。 |

### 附录四续二十八：第三十二轮 W36 续 —— 契约 ② 的**判据实现**曾漏掉官方 claim 生命周期的一半；并给「世代口径」立契约

> 续二十七确立的**契约 ②**（claim 必须恰好等于紧邻 replace 的区间）**方向是对的**，
> 但本轮发现**它的判据实现与官方语义漂移** —— 以及**一个更容易踩的口径陷阱**：
> 「磁盘上的原文」与「宿主加载后的形态」**不是同一个面**。

| 项 | 内容 |
|---|---|
| **契约 ② 的完整语义（官方权威）** | claim 的生命周期有**两条**清除分支，**任一成立即作废**：① `!isSurfaceEvent(event)`（`surface-projection.js:49-50`）—— **非 surface 事件**（`step/start` / `step/end` / `turn/start` / `turn/end` / `request/header` / `assistant/attempt` / `agent/inbox/spliced` / `assistant/chunk` 等）**同样让 claim 过期**；② `op === 'append'`（`:54-55`）。`isSurfaceEvent` = 「type ∈ `{system/message, user/message, assistant/message, tool/result}`」**且** `surfaceOp !== undefined`（`dsh-session/lib/types/surface.js:12-18,32-37`）。**只有**「紧邻且夹任何非计量事件都不行」的 replace 才受 ② 约束；其余 replace 走「无 claim ⇒ 零增量、不抛错」路径。 |
| **漂移的后果（假红）** | 判据 ④ 修前**只实现了分支 ②** ⇒ 把「claim 本该已过期」的 replace 误报为违约。M7 的 **J16** 因此报 `st-n0gnfp` **1 处违规**（`seq 7399` replace `[7153,7153]` vs 隔壁 prune claim `[7145,7147]`，中间夹着 `seq 7398 = step/start`）⇒ 一度被误判为「产品写侧真缺陷」。 |
| **决定性翻案** | 直调**官方 `foldSurfaceProjection`** 逐事件 fold 该文件 ⇒ **全程不抛错**（`tmp/w36-official-fold.mjs`）⇒ 假红。修法：判据补上分支 ①（白名单逐条同源于官方）。 |
| **★ 世代口径契约（本轮新增，最易踩）** | 同一份会话数据有两个**不同形态的面**：<br>· **磁盘原文**：v0 世代（`session.jsonl`）的 replace 写作 `{op, start, end}`；v1+ 写作 `{op, startSeq, endSeq}`（**改名发生在 v2→v3 迁移**，v0→v1 是恒等边、v1→v2 只重映射 seq 且**保留旧名**）。<br>· **加载后形态**：官方**按文件名版本号**决定是否迁移（`session.jsonl` ⇒ v0 ⇒ `sourceVersion < SESSION_FORMAT_VERSION(3)` ⇒ 跑 v0→v1→v2→v3），**宿主拿到的永远是 v3 形态**（`{op, startSeq, endSeq}`）。<br>⇒ **铁律**：判据/探针读**哪一层**，就必须按**那一层**的口径解读；**不得**把「官方对未迁移原文抛错」当作文件损坏的证据。 |
| **实测（口径陷阱）** | 全设备 **11 个**「只有 v0 世代」的会话，其**磁盘原文**直喂新版 fold **全部抛错**（错误文本即 `over range **undefined-undefined**`，因为新版只读 `startSeq`）。而用**官方 catalog** 跑完整迁移链（`sessionFormatCatalog.createRestore` → `decodeRow` → `finish`）后，事件已是 v3 形态 ⇒ **迁移失败 0 个 · 迁移后 fold 抛错 0 个（11/11 通过）**。⇒ 它们是**合法的历史制品**，不是损坏。★ 若无此实验，会把**整批历史会话误判为损坏**。 |
| **判据侧机器化** | `scripts/audit-session-integrity.mjs --selftest` 新增**与官方参考实现对账**：91 条组合语料（`mid ∈ {none, append, step/start, step/end, turn/start, turn/end, request/header, assistant/attempt, agent/inbox/spliced, assistant/chunk}` × `claim ∈ {[1,2],[1,1],[2,2]}` × `replace ∈ {[1,2],[1,1],[2,2]}` + 「两个 prune 连排」），逐条断言「**判据 ④ 报红 ⟺ 官方抛影子价格邻接错**」；**官方包找不到 ⇒ fail-closed exit 2**。⇒ 判据语义不再靠**人工转写**，而是**让官方实现当裁判**。 |
| **承重验证（B11：不许放宽）** | ① **对账有杠杆**：退回修前语义 ⇒ 对账报 **48 处语义漂移**（差异全落在 `mid=step/start`）；② **真实历史坏样本仍检出**：`st-clk9pd`（17 处）/ `st-vr2jg2`（1 处）仍报红，且**首处 seq 与官方 fold 抛错位置精确一致**（1457 / 236）；③ 设备 `--all` ⇒ **23 会话 / 违规 0 处**；④ M7 ⇒ **56 PASS / 0 FAIL / 13 SKIP**（J16 转 PASS）。 |
| **门禁** | Step 0.55 第二组文案 `15/15` → **`18/18 + 与官方参考实现对账 91/91`**（W36 续后再补一条负控 9 ⇒ 18 项）。 |

### 附录四续二十九：第三十三轮 W37 —— 夹具安全（**改设备全局设置**）与**判据扫描面**的两处收口

> 续二十八把「判据语义忠实性」机器化了；本轮做的是**同一纪律的横向穷举**
>（P-48：**写型装置的任何 fail-closed 中止都必须先回滚**），
>并顺手修掉 `ef-font-scale.mjs` 里两处**长期静默**的判据缺陷。

| 项 | 内容 |
|---|---|
| **为什么这与「兼容契约」有关** | 该探针的职责是验证「**系统字号变化时我方布局是否仍可用**」（L2「字号与缩放」格）。它**必须**改设备的 `system font_scale` 才能测 —— 因此**它自己就是一个会污染用户设备状态的装置**。它的**回滚失败**会直接表现为「**用户的系统字号被改坏**」，属数据/状态兼容面。 |
| **本轮修的三件事** | ① **回滚兜底缺失**（P-48 同类第二处，比 M7 那处更严重 —— 用户**直接看得见**）：还原只在脚本末尾 ⇒ 循环内异常（`font_scale` 变更触发 WebView 重建、CDP 连接失败）⇒ **永不执行** ⇒ 修法：幂等 `restoreFontScale()` + `process.on('exit'/'SIGINT'/'SIGTERM'/'uncaughtException'/'unhandledRejection')` 兜底 + 「写盘与登记同一处」+ 还原后**读回校验并打印触发路径**。<br>② **S4 恒 FAIL = R17 越界**：裁切扫描在无我方容器时**退化为扫全页** ⇒ 把**宿主**的无障碍隐藏元素（`visuallyHidden`，`1px×1px position:absolute`）算成「我方文字被裁」⇒ 修法：扫描面**只限我方**，扫不到时记 **SKIP**（P-43 无判据力）。<br>③ **S7「快照不一致」= 就绪竞态**：`JSON.stringify` **逐字比整个快照** ⇒ 含**会随页面重挂载抖动的量**（`hasBall`/`ballRect`/`targets`）⇒ 修法：只比**不受重挂载影响的量**（`rootFs` + 五件套 + 就绪面）。 |
| **决定性读数（三件都有设备证据）** | ① 负控注入「1.5 档写入后抛异常」⇒ 设备**先偏离到 1.5**、跑完**回到 1.0**、日志含 `触发路径：uncaughtException`（★ 首版负控注入在**基线档** ⇒ 「跑后无残留」**无信息量**，被自己的杠杆断言证伪）；② `tmp/w36-s4-clip-forensics.mjs` ⇒ 2 个 `visuallyHidden` **均不在我方容器内**（父链在宿主 `ztWv_q_callRow` 下，同前缀 7 个元素全在宿主侧）；③ `tmp/w36-s7-ball-forensics.mjs`（**不改设置、只等**）⇒ 浮球 **t=6s 自行出现** ⇒ 是就绪竞态，不是产品缺陷。 |
| **结果** | `ef-font-scale.mjs` **S0~S8 全 PASS**（修前 S4/S7 FAIL）· 设备 `font_scale` 读回 **1.0**（无污染）· 门禁 **27 条 `[gate] OK`** · 双架构 sentinel **v360** 一致 · M7 **56 PASS / 0 FAIL / 13 SKIP**。 |

### 附录四续三十：第三十四轮 W38 —— **「改设备全局设置」的第三处**（自动旋转），以及 P-48 的**机器化**

> 续二十九修完「改设备全局**字号**」那一处，并把「修完一个装置必须做一次同类穷举」写进结论。
> 本轮照做 —— **穷举又抓到一处**，而且这次**穷举的手法本身也写窄了**。
> ⇒ 结论升级为：**同族纪律必须机器化，不能靠「记得穷举」**（P-11 元级）。

| 项 | 内容 |
|---|---|
| **为什么这与「兼容契约」有关** | 装置职责是验证「**转屏后布局不崩、浮窗 clamp 回界内**」（L2「竖屏 / 横屏」格）。它**必须**关掉设备自动旋转并改 `system.user_rotation` 才能测 —— 与续二十九同一性质：**它自己就是一个会污染用户设备状态的装置**。回滚失败直接表现为「**用户的系统自动旋转被永久关闭**」。 |
| **★ 穷举手法本身写窄了（P-45 的新形态）** | 续二十九用的 `grep 'settings put'` 是**命令行空格形态**，而真实代码是**参数数组** `['shell','settings','put',…]` ⇒ **结构上漏掉了这一类写法**。这与 W31（`ev()` 只扫 `packages/src`）、W26（判据三只扫 ps1 一侧）是**同一个坑的第三次现身**：**「排查过了」≠「排查面覆盖了真实形态」**（P-41 推论三）。按 API 语义加宽后才抓到 `ef-orientation.mjs`。 |
| **第三处的两处错** | ① 还原只有 `restoreAutoRotate()` 且**只在脚本末尾**调用 ⇒ 中途异常（★ 最现实的正是**改设置本身触发的 WebView 目标重建**期 `fetch` reject）⇒ **自动旋转被永久关闭**。<br>② ★ **还原把值写死成默认 `1`**，而不是**恢复原值** ⇒ 若设备本来**关着**自动旋转，探针在**正常路径**上也会**替用户打开**（P-41：锚在「默认值」这个**代理量**上，而非「原值」这个**事实**）。 |
| **★ 为什么这一类排在最前（P-37② 量后果）** | 会话数据有 `.efjbak` 可人工还原、字号用户手动改回一次即可；而**自动旋转用户往往根本不知道是探针动的**（只会觉得「手机突然不能转屏了」）⇒ 同族中「**不可恢复且用户看得见**」者最先失守，也最先要机器化。 |
| **修法** | 幂等 `restoreOrientation()` + 五类 `process.on` 兜底（`exit`/`SIGINT`/`SIGTERM`/`uncaughtException`/`unhandledRejection`）· `setSetting()` **先登记 `orientDirtied` 再写**（P-1：无「已改未登记」窗口）· 还原后 `getSetting()` **读回校验**且**成功也打印**（含**触发路径**）· ★ 还原改**写回原值**（`writeBack`；原值为空时 `settings delete`，而非写入字符串 `"null"`）· ★ 新判据 **O6 夹具安全：系统设置已还原** 纳入退出码。 |
| **机器化（本轮主要产出）** | 常驻闸门 `audit-p48-rollback.mjs`（selftest **8/8**）对每个「会改设备设置」的装置断言**四项能力齐备**：① 幂等还原函数 ② **四类中止路径各自注册且处理器体内调用还原** ③ **读回校验 + 成功也出声** ④ 「写盘」与「登记」不得分开。配**真实仓库负控** `audit-p48-negctl.mjs`（**8/8**）：注入「**保留 `process.on` 注册、只在处理器体内断线**」这一**最阴险**的假兜底形态 ⇒ 必须报红；注入「散落裸写」⇒ 必须报红；删除 ⇒ 回绿；逐字节还原自证。**接入 Step 0.55（扩到七组）**。 |
| **结果面承重验证（P-24）** | 静态闸门只证「有**能力**」，「中止后设备真回原值」必须实测 ⇒ `tmp/w38-negctl-orient.mjs`：跑前 `accel=1 / rot=0` → ★ **注入点读到** `accel=0（基线 1）· rot=1（基线 0）`（**可观测偏离**）→ 异常命中 → 兜底自证 `触发路径：uncaughtException` → 跑后 `accel=1 / rot=0`（**无残留**）。★ 杠杆断言本身也必须是**读出来的事实**（首版写成「日志里出现过某一段」= 推断，已改）。 |
| **结果** | `ef-orientation.mjs` **O0~O6 全 PASS**（新增 O6）· 设备设置读回 **`1 / 0`**（无污染）· 闸门 selftest 8/8 + 负控 8/8 + 真实仓库 0 违规 · 门禁 **29 条 `[gate] OK`**（Step 0.55 **七组**）· 双架构 sentinel **v361** 一致 · M4 双包 **169 / 0**。★ 期间 `audit-build-path-parity.py` **判据五当场抓到编辑 `.ps1` 剥掉了 BOM**（R22④ 护栏正常工作，补回后 38/38）。 |
| **诚实边界（R7）** | 本闸门**只覆盖「改设备全局设置」这一类**（识别面：`adb shell settings put\|delete`）。另一类「**写用户会话数据**」（M7）**尚无常驻闸门** —— 其失效形态是「残留 `.efjbak` 备份」（**可人工恢复**），目前由 M7 自己的紧急还原钩子 + 一轮一跑的负控守着；该缺口已登记（GOAL §11.3）。**不**用一个过宽的判据去假守（P-38：过宽 ⇒ 假红 ⇒ 训练人忽略报警）。 |

> ★ **上表的诚实边界已在 W39 补上**（见续三十一）。

### 附录四续三十一：第三十四轮 W39 —— **补上续三十的诚实边界**：会改「用户会话数据」的装置也纳入闸门

> 续三十把「改**设备全局设置**」这一类机器化了，并**诚实地留下缺口**：
> 「另一类『写用户会话数据』尚无常驻闸门」。本轮按 §十二 第 7 条把它补上 ——
> 而**穷举又抓到 2 处真实缺陷**（都是**对用户真实卡真跑不可逆回退、却零备份**）。

| 项 | 内容 |
|---|---|
| **为什么这也属「兼容契约」面** | 契约保护的对象是**用户数据能读能写**。而这两个探针会在**没有备份**的情况下对真实会话真跑回退类 RPC（非 live **截断文件** / live 写 replace + 掩码）⇒ 跑一半出错就**把用户的聊天记录永久留在被回退的状态**。⇒ 这是**数据完整性**问题，不是「测试脚本的小毛病」。 |
| **★ 穷举（P-38 三段式）** | 不变量 =「凡**不可逆地改用户会话数据**的装置，必须按 **R18** 先备份、并能回滚」。**按语义枚举手法**（不是按已知 API）= 行内含 `rp/session-(rollback\|edit\|regenerate)` **且**含请求发起动词 ⇒ 抓 **2 个装置**。★ 口径**两次修正**：v1「整文件含路由名」⇒ **1 处假红**（`audit-impl-duplication.mjs` 把路由名写进**合成夹具的字符串字面量**，它**不执行**回退）；v2 加「请求动词」⇒ 收敛。 |
| **★ 2 处真缺陷** | `ef-rollback-live.mjs`（M5 真回退实测）与 `b2-live-rollback-test.mjs`（B 轨 live 路径实测）：**零备份、零还原、零中止兜底**。★ `ef-rollback-live.mjs` 的文件头**自己写着**「安全前提（不改用户真实数据）」—— 而实现对真实卡真写（**P-44 第⑧条**：注释/设计意图与实现不一致；方向上更危险，因为注释让人以为不必再检查）。 |
| **修法：抽单源守护（P-1）** | 新建 `scripts/session-guard.mjs`：`install()`（注册全部中止路径）+ `backup()`（**写型动作之前**，失败即中止）+ `restore(reason)`（**停应用 → 还原 → 校验大小 → 清理备份**；幂等；成功也出声并**带触发路径**）。两处 import 复用 —— ★ **不各写一份**（两份逐字拷贝会被 `audit-impl-duplication.mjs` 判据 7 报红；W38 的 `ev()` 双拷贝正是这么被抓的）。 |
| **★ 守护接法要「同源」** | `ef-rollback-live.mjs` 的「是否真写」条件 = `--yes` **且** 传了 `--seq`（注入脚本内还会二次判定）⇒ 备份必须与**同一条件**挂钩，否则 dry-run 白备份 / 真写时没备份。 |
| **机器化** | 闸门 `audit-p48-rollback.mjs` 扩**第二受检面**（三项能力：① 备份 ② 还原 + 校验 ③ 中止兜底）。★ 首版要求「每处**自己**实现」⇒ 把**合规的复用单源**判成违规（**2 处假红**）—— 又一次 **P-38 过宽**：语义不变量是「**这个装置具备备份与还原能力**」，不是「代码写在它自己文件里」。★ 另修 **P-41 推论四**（解析器漏形态）：`fnBodyOf` 只认 `function name()`，而 M7 用**箭头函数赋值** ⇒ 正控被判假红。**selftest 8/8 → 15/15**。 |
| **结果面承重（P-24）** | 静态闸门只证「有**能力**」；「中止后会话真回原状」必须实测。`tmp/w39-negctl-guard.mjs`：在**备份之后、真回退之前**注入 `throw` ⇒ 跑前 `.sgardbak`=**0** → 备份 `session.jsonl✓ · session.v3.jsonl✓` → ★ **注入点读设备 `.sgardbak`=2**（**可观测偏离**）→ 异常命中 → 兜底自证 `触发路径：uncaughtException` → 跑后 **0 残留**。 |
| **结果** | `ef-rollback-live.mjs` dry-run **PASS**（未写 ⇒ 出声「无需还原」）· 设备我方夹具残留 **0**（`*sgardbak` / `*.efjbak`）· 设置全还原 `font=1.0 / accel=1 / rot=0` · 全量会话审计 **23 会话 / 违规 0 处** · 判据 7 **0 组** · 门禁 **29 条 `[gate] OK`** · 双架构 sentinel **v362** 一致 · M4 双包 **169 / 0** · M7 **63 PASS / 0 FAIL / 18 SKIP**。 |
| **★ 同一族纪律的强度差异（本轮新增的观察）** | 第一类（设备设置）**没有备份可言**，只能「还原到原值」；第二类（会话数据）**能备份** ⇒ **R18「先备份」在这里是硬要求**（不备份就永久丢）。⇒ 同一族纪律在不同副作用上**强度不同**，判据也应不同（第一类判「有没有回滚」，第二类判「有没有**先备份再回滚**」）。 |

### 附录四续三十二：第三十五轮 W40/W41 —— 判据**装置自身**的三处失效（A11 形态盲区 · `__efj` 生命周期 · `floors=0` 第三种含义）

> 本轮起点是「按 §十二 推进」时**读 §六 表**撞见它**自相矛盾**（同一事实两处结论相反）。
> 修完那处并把 §六 表机器化之后，复跑 M7 又连续暴露**判据装置自身**的三处失效 ——
> 三处都属同一母题：**「装置坏了」被读成了「产品坏了」**（P-46 / P-47）。

| 项 | 内容 |
|---|---|
| **① §六 开放项表无机器守护（文档一致性面）** | `audit-matrix-residuals.mjs` 只守 §二 的 L1~L5 表，而**「当前还欠什么」的 SSOT（§六）没有任何机器守着**。**修法**：新建 `audit-open-items.mjs`（四条判据：表可解析 / 状态三态可归类 / ⬜ 行有锚点或「已归属」/ ★ **同一事实不得两处结论相反**）+ 负控 `audit-open-items-negctl.mjs`，接入 **Step 0.55 第八组**。**结果**：selftest **12/12** · 负控 **6/6** · 真实仓库 **0 违规**。 |
| **② A11 的形态覆盖面盲区（构建门禁面）** | 为「注入随页面重载自动重装」把注入体抽成常量 `EFJ_SOURCE` 后，A11 认的「`await <helper>(\``」形态**一个都不匹配** ⇒ 该模板串**整体逃出守护**（我在其注释里写了 **6 处裸反引号**，闸门一次没出声）。★ 更隐蔽：改锚点前 A11 **转而匹配到第 1347 行的另一个模板串**（报「终止于 1359」）⇒ 我以为它在守、实际守的是别处（**P-41 推论二**）。**修法**：扫面扩到**形态 ②**（`const X = \`` 且 X 作注入载荷）+ M7 登记锚点改指常量定义处 + selftest **16/16 → 20/20** + 常量上移到文件顶部（原落在 selftest 之后 ⇒ TDZ `ReferenceError`）。 |
| **③ M7 的 `__efj` 一次性注入在页面重载后丢失（设备判据面）** | 3 张卡报「快照稳定但楼层为 0」，**而同一条证据串里写着会话文件有 380/201 条消息**（读数与事实严重不符）。**决定性实验**：`Page.reload` 后哨兵丢失 · 重载后 `window.__efj` 不存在 · 重载后页面真实读数 `floorHead=21 / myAssistant=15` ⇒ **页面有内容，是装置自己丢了注入**。**修法**：`Page.addScriptToEvaluateOnNewDocument` 自动重装 + `ensureEfj()` 自愈 + **`probeErr` 分层**（装置故障报 FAIL 出声，不再退化成 SKIP）。 |
| **④ `floors=0` 的第三种含义（P-46 推论三）** | 决定性实验实测「切卡后 **t=0..18s** `rpActive=null` 且 0 楼层，**t=21s** 才挂出 39 个楼层头」⇒ 仅等 `floors>0` 会把「**RP 容器还没挂载**」误读成「稳定地 0 楼层」。**修法**：把产品自己的就绪标记 `body[data-dsht-rp-active]` 纳入就绪面；就绪预算 25s → **40s**；J1 证据串与 J2~J11 的 SKIP 依据里**如实写出** `rpActive` 与 `budgetExhausted`（P-46 推论一）。 |
| **★ 数据完整性面（R18/R23 相关）** | 本轮所有改动**不动产品源码、不写用户数据**；M7 每次运行仍走「J0 备份 → 旅程 → 停应用 → 统一还原 → 校验」，实测**设备我方夹具残留 0**（`*sgardbak` / `*.efjbak`）· 设备设置全还原 `font=1.0 / accel=1 / rot=0` · 全量审计 **23 会话 / 违规 0 处**。★ 途中装置自检**一次 fail-closed 中止**（我改三元时漏了 `basis`）⇒ **紧急还原正确执行**（该卡会话「已还原并校验一致、清理备份」）—— 这是 R23 的又一次实战验证。 |
| **结果** | A11 selftest **20/20** · `audit-open-items` selftest **12/12** + 负控 **6/6** · M7 **33 PASS / 0 FAIL / 12 SKIP**（J7 假红消除）· 设备残留 **0** · 23 会话 0 违规。 |

### 附录四续三十三：第三十六轮 W42 —— 给 **GOAL §十一 当前工作面**三张表装闸门（结构坏了是**静默**的）

> 本轮起点是「接着 W40 的**文档一致性面**继续推进」（W40 给方法论 §六 装了闸门）。
> 读 **GOAL §十一** 时撞见**三类结构损坏同时存在**，且**全都没有机器守着** ——
> `audit-matrix-residuals.mjs` 只守方法论 §二、`audit-open-items.mjs` 只守方法论 §六，
> 而 **GOAL 自己的动态区（§11.1 / §11.2 / §11.3）才是「当前在做哪几件事」的 SSOT**。
> ★ 母题：**「结构坏了」比「内容错了」更安静** —— 内容错有人看得出来，
> 而 **GFM 对多出的列不报错、直接丢弃**，对**编号复用**也不出声。

| 项 | 内容 |
|---|---|
| **① 列数错位（静默丢信息）** | §11.3 表头 **3 列**（`\| # \| 工作面 \| 说明 \|`），而表内 **6 行**按 §11.1 的 **4 列**模板写（`\| # \| 工作面 \| 轨道 \| 状态 \|`）⇒ GFM **不报错、直接丢弃**多出的单元格 ⇒ 「轨道」「状态」**根本不渲染**，`✅` 收口标记读者看不到 ⇒ **误判该工作面还没做**（**P-27** 过期结论误导）。 |
| **② 跨表编号复用（引用歧义）** | `W10` 在 §11.1 指「A15 闸门盲区排查」、在 §11.2 指「L4 proot 生存性」= **两件毫不相干的事共用一个编号** ⇒ 引用「W10」者**无法判断指哪一个**（**P-1**）。根因：§11.2 那一行用的是**矩阵残余格编号**、§11.1/§11.3 用**工作面序号**，两套体系撞车。 |
| **③ 重复登记** | `W36 续` 在 §11.1（4746 字符完整记录）与 §11.3（1042 字符摘要）**各记一条** —— 两条都**是真的**，但读者要读两遍才能确认是同一件事，且两条会**各自过期**（P-27 双向误导）。 |
| **修法（取证式，不靠读文档猜）** | ① **列数**：探针逐行读列数 —— ★ **必须先剥反引号再切列**（正文里 `` `rp/session-(rollback\|edit\|regenerate)` `` 含竖线会把列切碎，W40 首版正栽在这里）⇒ 精确定位 6 行；② **内容守恒自证**：「列内容序列」指纹 **7/7 PASS**（证「除重排分隔符外什么都没改」，**这是 P-30 的用法**：先证明没动内容，才敢脚本批量改文档）；③ `W10` 改为真实身份 **`A15`**（与 §3.2 第 9 项**同名**，P-1）；④ `W36 续` 的**独有信息**先机器断言「已在单源文档（§6.38 / 附录四续二十八）」**7/7 PASS** ⇒ 再按 **GOAL 附录 A**（逐轮技术结论一律外链、不在此复制）并入 §11.1 并删除 §11.3 的重复行。 |
| **机器化** | 新建 `scripts/audit-goal-sections.mjs`（selftest **16/16**）**六条判据**：① 三表都可解析（切不出 ⇒ **fail-closed**，不许当 0 违规 —— P-30）② 数据行总数不得跌破下限（**P-46 推论二**；**下限 ≠ 精确值**，守 **P-38**）③ ★ **同表每行列数 = 该表表头列数**（**实读表头、不硬编码** —— P-27）④ 同表 ID 唯一 ⑤ ★ **跨表 ID 不得复用** ⑥ ⓘ 行首缩进**只提示不报红**（GFM ≤3 空格仍认表格行、**不丢信息** ⇒ 报红即过宽假红）。配 `audit-goal-sections-negctl.mjs`（**11/11**，守 **B11**）接入 **Step 0.55 第九组**。 |
| **★ 判据与负控各自被当场证伪的缺陷** | ⑴ 判据 ③ 首版**写死「本仓只有 3 列形态」** ⇒ **真实仓库当场证伪**：§11.1/§11.2 的表头**就是 4 列** ⇒ 改为「与**实读表头**一致」（**P-27**：别把当前状态写死成常量）。⑵ ★★ **表头识别用「首列是 `#`」的启发式** ⇒ **表头被写坏时静默退化**（`headerCols` 退化成第一个数据行的列数，而那一行又被当成表头**跳过** ⇒ **少一行 + 整表判据错位，却照样报绿**）⇒ 改按 **GFM 语法**「表格行 + **紧跟分隔行**」配对（**P-41 推论四**：判据的**输入解析**也需要判据）。⑶ ★ **负控自己失杠杆**（P-20 在负控身上的形态）：首版注入锚点取到**表头行**（非数据行），且负控 C 的「改名」**仍匹配原正则** `^###\s*11\.3` ⇒ **三段负控里两段报绿 = 假负控** ⇒ 加 `dataRowIdx()` 按语法定位数据行（**负控没杠杆时，它的「全绿」是零信息量**）。 |
| **★ 本闸门**首次真实拦截** | 记账时我给 §11.3（3 列表）新写的 **W42 行**误写成了 **4 列**（`\| F / 文档一致性 \| ✅ \|`）—— **闸门当场报红**并精确指向该行（「列数 4 ≠ 表头 3」）。修好后回绿。⇒ 这正是它存在的意义：**这类错误人眼几乎看不出来**（渲染出来只是少两列）。 |
| **结果** | 门禁 **32 → 35 条 `[gate] OK`**（x86_64 与 arm64 **各 35**）· 双架构 sentinel **v363 一致** · M4 双包 **169 / 缺失 0** · M7 **60 PASS / 0 FAIL / 21 SKIP** · vitest **81 / 1790 / 2 skipped / 0 失败** · typecheck **三段 0 错** · 设备我方夹具残留 **0**（`*sgardbak` / `*.efjbak`）· 设备设置全还原 `font=1.0 / accel=1 / rot=0` · 全量审计 **23 会话 / 违规 0 处**。★ 期间 `audit-build-path-parity.py` **判据五再次当场抓到编辑 `.ps1` 剥掉 BOM**（**R22④** 护栏正常工作，补回后 38/38）。 |
| **★ 数据完整性面（R18/R23 相关）** | 本轮**不改产品源码**（只改文档 + 新增两个闸门 + 构建脚本加一组检查）⇒ 对**兼容契约零影响**；M7 仍走「J0 备份 → 旅程 → 停应用 → 统一还原 → 校验」，实测设备残留 0 · 设置全还原 · 23 会话 0 违规。 |
| **★ 契约条款：新增（GOAL §十一 结构契约）** | **凡「每轮必改」的动态区表格，其结构（列数 / 编号唯一性 / 跨表不复用）必须有常驻机器判据**；判据口径必须**从实读表头来**（不得硬编码当前形态），**识别要按语法**（不得用启发式），**切不出即 fail-closed**。见 **P-49**。 |

### 附录四续三十四：第三十六轮 W43 —— 把 W42 的结构判据**再排查一次**（P-38 三段式），抓到「P 判据累计条数」过期声明

> 起点不是「又一个 bug」，而是**对 W42 本身做同类排查**：
> W42 修的是「GOAL §十一 三张表」，但**母题是「每轮必改的文档区没有机器守着」**（**P-11 元级**）
> ⇒ 按 **P-38 三段式**再走一遍。★ **不把上次的 grep 原样重放** ——
> W38 的教训是「**排查过了**」≠「**排查面覆盖了真实形态**」（**P-41 推论三**）。

| 项 | 内容 |
|---|---|
| **① 枚举手法（按语义不变量）** | 不变量 =「文档里含**会随轮次变化的量化声明**的区」⇒ 4 类模式穷举（P 判据编号 / 门禁条数 / 工作面编号 / selftest 分数）⇒ GOAL **293 / 3 / 236 / 46** 处、方法论 **1124 / 7 / 387 / 59** 处。 |
| **② 逐条分诊** | **有机器守着 10 处**（§十一 三表 / §六 开放项 / §二 L1~L5 / P-48 / P-47 / P-40-P-41 / F5b / A11 / 两条构建路径 / B3）。**★ 无机器守着 4 处**：① §三 基线数字 ② ★ **§九 P 判据索引一致性** ③ §3.2 门禁清单 ④ 方法论 §5.4 定义与索引的一一对应。 |
| **③ ★ 真缺陷（探针当场读到）** | `§九` 索引实到 **P-49**（共 49 条），而 `§3.1` 的对外声明仍写「**P-1 ~ P-48**（累计 48 条）」—— 这正是**上一轮（W42）新增 P-49 时没同步**留下的：**P-27**（结论会过期而没人回头改）+ **P-1** 在「**判据体系自身**」上的违例。★ **若靠人眼复核，几乎不可能被发现**（两个数字分别在 §3.1 第 80 行与 §九 第 424 行起，**相隔 400 行**）。 |
| **④ 修法** | `§3.1` 改为 **P-1 ~ P-49（累计 49 条）**，并把 P-48 / P-49 各自的**机器化落点**写进该行（引用者一眼能追到判据实现）。 |
| **⑤ 机器化（扩判据 ⑦，selftest 16 → 24/24）** | **⑦a** §九 索引 P-n 无重复、无缺号（**编号是主键**）· **⑦b** §3.1 声明的「累计 N 条 / P-1 ~ P-N」**必须等于** §九 索引实际条数（**同时**校「末项编号」与「累计条数」两个口径，**P-1**）· **⑦c** §5.4 定义里的 P-n 不得超出索引范围。★ 口径守 **P-27 / P-38**：**只读结构、不硬编码当前数字**；§九 缺失时**只出声不报红**（职责是「三处一致」而非「必须有 §九」）。 |
| **⑥ 负控（13/13，守 B11）** | 新增 **负控 D**：把 §3.1 声明**改小 1**（= **精确复现本真缺陷形态**）⇒ 报红且**指向该行**；并纳入真实仓库注入段（**四类同时注入**：列数错位 / 跨表 ID 复用 / 小节标题被改名 / P 判据过期声明）⇒ 报红 **21 项** ⇒ **逐字节还原** ⇒ 回绿。 |
| **★ 同一轮内本闸门两次当场抓到我** | W42 与 W43 记账时，我**两次**把新行写进 §11.3（**3 列表**）时写成 **4 列** ⇒ **都被当场报红并精确指向行号**。⇒ 这类错误**人眼几乎看不出来**（渲染出来只是少两列），是本闸门存在的最好证明。 |
| **结果** | 门禁双架构**各 35 条 `[gate] OK`** · sentinel **v363 一致** · M4 双包 **169 / 缺失 0** · M7 **33 PASS / 0 FAIL / 12 SKIP** · vitest **81 / 1790 / 2 skipped / 0 失败** · typecheck **三段 0 错** · 设备我方夹具残留 **0** · 设备设置全还原 `font=1.0 / accel=1 / rot=0` · 全量审计 **23 会话 / 违规 0 处**。 |
| **★ 契约条款：新增（判据体系编号契约）** | **P 判据的编号是主键**：`§九` 索引（清单）、`§5.4`（定义）、`§3.1`（累计条数声明）**三处必须一致**，且由 `audit-goal-sections.mjs` 判据 ⑦ 常驻守（**不得硬编码当前数字**）。**新增一条判据时，必须同步这三处** —— 否则出现「引用者以为 P-N 不存在」的过期声明（W43 实测）。 |

### 附录四续三十五：第三十七~三十八轮 W44/W45 —— 给「判据自己的分数」与「基线表」装闸门（**这两样此前都无机器守**）

> 起点仍是 W43 的 **P-38 三段式分诊**：它列出 4 处「每轮必改区无机器守着」，本轮把**余下三处**收口
> （②§九 P 判据索引 → W43 判据 ⑦；③§3.2 分数声明 → **W44**；①§3.1 基线数字 → **W45**；④与 ② 同源）。
> ★ 母题：**「声明」若没有可机器读出的接口，就一定会过期** —— 而人眼在多份文档的十几处数字里**必然漏**。

| 项 | 内容 |
|---|---|
| **W44 · 根因（为什么分数声明此前守不了）** | 闸门收尾输出历史上长成**三种形态**：① `24/24 PASS`（分在前）② `PASS（14/14）`（分在后）③ `OK —— 有杠杆（…）`**根本不含分数** ⇒ 机器**读不出分数** ⇒ 文档里的数字与实现**可以静默脱钩**。 |
| **W44 · 真缺陷（探针当场读到 3 处）** | ① `audit-goal-sections` / `-negctl` 文档写 **16/16 / 11/11** 而实际已 **24/24 / 13/13**（W42 扩判据后没同步）；② `audit-p48-negctl` 文档写 **8/8** 而脚本**不输出分数**（声明**无法被证伪**）；③ GOAL L482（P-49 定义行）同类过期。 |
| **W44 · 修法（P-1 单源）** | `scripts/selftest-summary.mjs` = 分数行**唯一产出点**（`reportSelftest(name, pass, total)`），**格式串不在各脚本手抄**；**16 个构建期闸门全部接入**。 |
| **W44 · 机器化 + 负控** | `audit-selftest-claims.mjs`（selftest **23/23**）四条判据：分数行可读 / 行内自洽 / ★ **声明 == 实测** / 悬空引用报红。负控 `audit-selftest-claims-negctl.mjs`（**9/9**）。接入 **Step 0.55 第十组**。 |
| **W44 · ★ 闸门首版两处自身缺陷（由负控当场证伪）** | ⑴ **扫描面过宽**（把 30+ 设备探针算进来 ⇒ 一次报 **20+ 处**，**P-45 识别特征**）⇒ 收窄为「实读构建脚本里的闸门」；⑵ ★★ **声明抽取窗口写窄**（40 字 ⇒ 实距 37 字但在 `**24` 处截断）⇒ **负控注入后闸门仍报绿**（判据失效而与通过同貌，**P-30**）⇒ 放宽 60 字 + **不跨表格列边界 `|`**。 |
| **W44 · 顺手修掉 P-41 形态 + 构建门禁当场抓错** | ①两个闸门把通过数**写死字面量**（`'15/15 PASS'`/`'6/6 PASS'`）⇒ 改为**返回计数对象**；②批量注入把 `reportSelftest` **误插到主流程收尾**（`--selftest` 分支早退 ⇒ 不可达）⇒ 真跑构建报 `ReferenceError` ⇒ 逐处移入 `selftest()`。 |
| **W45 · 为什么基线表最要紧** | §3.1 是「**不劣化**」的判据基准，读者靠它判断「有没有回归」⇒ 里面的数字过期，**整轮「有没有变坏」的结论都建立在错数字上**。★ 已实测两处（**相隔 400 行 / 人眼几乎不可能发现**）：§3.1 写「P-1 ~ P-48」而索引到 P-49、§3.2 写 16/16 而实际 24/24。 |
| **W45 · 机器化（四条判据）** | `audit-baseline-claims.mjs`（selftest **24/24**）：① 门禁条数 == **构建日志实测** ② sentinel == 双日志实测一致 ③ P 判据条数 == §九 索引行数（与判据 ⑦b **同口径**，P-1）④ M4 == 产物核验实测。 |
| **W45 · ★ 诚实划界（R7）** | **vitest / typecheck / M7 不核**：前者数分钟、后者需 adb+WebView ⇒ 放进构建期会把「设备没插」「构建太慢」变成**门禁失败**（P-40③ / P-45）⇒ 只做**形态断言**，**不假装核对了真值**，也不替代 §十二 第 2 条的人工基线回归。**「不假装覆盖」比「多核几项」更重要**。 |
| **W45 · 负控（守 B11）+ ★ 更强形态** | `audit-baseline-claims-negctl.mjs`（**7/7**）★ **只用 `--file <临时副本>`，全程不碰真实 GOAL** —— 从**结构上**消除「注入残留」这一整类风险 ⇒ **P-48 的更强形态：能不改就不改，比「改了能还原」更安全**。 |
| **W45 · ★ 顺手修掉 W44 遗留的两处真缺陷** | ① **自调用递归**（负控的自证方式就是跑闸门，闸门又探测它 ⇒ **指数递归**，实测 5 分钟不返回、`node` 进程堆积）⇒ 闸门显式排除**自调用链**；② **负控被强杀时注入未还原**（`try/finally` 只覆盖正常异常；实测被 `kill` ⇒ GOAL 残留 `23/24`，★ 而**下一次闸门报出的「缺陷」其实是我自己的残留** —— 判据装置的污染被读成产品缺陷）⇒ 五类信号兜底 + **启动自检**。 |
| **W45 · ★★ R6 四件套阶段又连抓三处真缺陷（共同形态 =「判据造好了，但守的不是真目标」P-45）** | ① **新装置自己没接入契约**：新建的 `audit-baseline-claims.mjs` 收尾仍是旧形态 `[selftest] PASS（16/16）` ⇒ 闸门**读不出分数行** ⇒ 报「声明无法被证伪」★ **W44 契约当场抓到它的第一个「新用户」**；② ★★ **扫描面按「写法」而非「语义」界定**：首版只认 `` `scripts/x.mjs` `` 前缀，而 W44 实测出的**真缺陷形态**（§九 的 `selftest 16/16`）**恰恰是裸名** ⇒ §三/§九 的 **13 条当前状态声明全在盲区**（现在恰好都对 = **运气，不是判据力**）⇒ 改为**按区段语义**（§三/§七/§九 = 当前；排除 §十一/§6.x 的史实），受守声明 **17 → 32 条**，当场又抓出 **3 处真过期**；③ ★★ **基线闸门把「半截日志」当真值**（自指）：构建期按**文件名字典序**取「最近两份」⇒ 取到「上次失败」+「**本次正在写入**」（30/31 条）⇒ 报「声明 41 实为 31」= **假红** ⇒ 只认**已跑完**的日志（`[完成] DSH …`）+ 按 **mtime** 排序；并按 **P-43/P-40③** 把「声明 > 实测」在构建期改为**只出声不报红**（本轮新增闸门致声明变大是正常事），复核用 `--strict-two-way`。 |
| **W45 · ★ 两次被自己的判据当场证伪（诚实留痕）** | ⑴ **假负控**：负控锚点用**裸名**注入，而闸门当时只认 `scripts/` 前缀 ⇒ **注入到闸门不看的地方**（**P-1** 违例：负控与闸门各一套口径）；⑵ **假绿（P-30）**：放宽扫描面时首版只用「窗口内 ≥2 个不同 N/M」判「对比叙述」⇒ 把**真缺陷行**（`16/16` + 负控 `7/7`，两值属**不同脚本**）误判成对照而**静默放过** ⇒ 改为**双条件**（**对比措辞** 且 两值）。 |
| **W46 · 为什么 E-H 必然出问题（P-11 元级）** | GOAL **§八 八条验收项逐个对「有没有机器守着」**实测：E-B/E-C/E-D/E-E **各有闸门**，★ **唯独 E-H「四份文档与代码现状一致」全凭人眼**。而**删脚本 / 改路径是本仓每轮高频动作**（W42~W46 五轮内新增/删除/改名十余个装置）⇒ 引用**悄悄悬空**是**必然事件**、**零症状**（P-27）。 |
| **W46 · ★ 真缺陷（探针当场读到，并被新闸门复现）** | 方法论 **§5.4 的 P-4 定义行**（第 286 行）**并列陈述三个装置** —— `` `scripts/capture-contracts.mjs` `` / `` `scripts/diff-contracts.mjs` ``（真身都在 `scripts/`）与 `` `packages/tests/session-contract-probe.mjs` ``（真身**在 `packages/tests/`**）⇒ 读者默认三者同处，去 `scripts/` 找第三个**必然扑空**。★ **前三条判据都抓不到它**（非可执行引用 / 无 `scripts/` 前缀 / 无 `docs/` 前缀）⇒ **必须新开一条按「同行并列关系」判的判据**。 |
| **W46 · 机器化（四条判据）** | `audit-doc-refs.mjs`（selftest **16/16**）：① **可执行引用**（`node <path>` 读者会照抄 ⇒ 错了直接失败）② `scripts/…` 位置声明 ③ `docs/…` 位置声明（两基点并集）④ ★★ **同行并列装置位置不一致**。接入 **Step 0.55 第十二组**（门禁 **41 → 44 条**）。 |
| **W46 · ★★ 口径被真实仓库当场证伪两次（守 P-38/P-45）** | ⑴ **泛化示例名**（`x.mjs` / `xxx.mjs`，正文里泛指某个脚本）不排除 ⇒ **一次 4 处假红**；⑵ ★★ **否定标记必须按「就近窗口（±40 字）」判**：实测「**行中间是真缺陷**、行尾远处恰有『负控』字样」被**整行口径一起豁免** = **判据失效而输出与通过同貌**（**P-30**）⇒ 修复后**固化成 selftest 的杠杆断言**。 |
| **W46 · 负控（守 B11）** | `audit-doc-refs-negctl.mjs`（**9/9**）注入三类坏样本（悬空位置声明 / ★ 并列装置位置不一致 / 可执行引用悬空）⇒ 报红且**理由正确**；改回 ⇒ 回绿；★ **全程只用 `--file <临时副本>`，绝不碰真实文档**（P-48 更强形态）。 |
| **W46 · ★ 装置自证当场抓到我两次** | ⑴ **凭印象写锚点**：负控 C 锚点写成 `node rp-workspace/scripts/ef-journey-all.mjs`（我以为文档里有）⇒ 实测**锚点未命中**（**P-19**）⇒ 改为实读文档里真实存在的 `node scripts/verify-rp-consolidation.mjs`；⑵ **注释内容破坏语法**：头注里「星号紧跟斜杠」**提前终止了块注释** ⇒ 文件语法错，且**我第一次修复时又踩了同一个坑**（**P-41 推论四**）。 |
| **W46 · ★ 闭环：新闸门反被已有闸门抓到一处真过期** | 新增第十二组后跑构建，`audit-selftest-claims.mjs` **当场报红**（§3.1 写 41 条而实际 44 条）⇒ **W45 建那条闸门的价值当场兑现**：新增闸门时它会立刻提醒同步基线。★ 判据体系开始有**互相咬合**的性质。 |
| **结果** | 门禁 **35 → 38 → 41 → 44 条 `[gate] OK`**（双架构各 44）· sentinel **v363 一致** · M7 **61 PASS / 0 FAIL / 20 SKIP**（v363 设备复跑）· M4 双包 **169 / 缺失 0** · vitest **81 / 1790 / 0 失败（2 skipped）** · typecheck **三段 0 错** · 设备残留 **0** · 设置全还原（`font_scale=1.0 / accel=1 / rot=0`）· 23 会话 0 违规 · ★ **四个结构闸门互相自洽**（含 P 判据 52 = 索引 52）。 |
| **★ 契约条款：新增（自证分数与基线数字契约）** | **① 判据的自证分数必须由单源产出且可被机器读出**（`selftest-summary.mjs`），**文档声明的分数必须等于实测**（`audit-selftest-claims.mjs` 常驻守）。**② `§3.1` 基线表里「可机器取真值」的数字（门禁条数 / sentinel / P 判据条数 / M4）必须等于实测**，由 `audit-baseline-claims.mjs` 常驻守；**vitest / typecheck / M7 明确不核**（理由见上「诚实划界」）。**③ 负控若必须写真实文档，优先改用 `--file <临时副本>`**（能不改就不改）。**④ 文档里点名的脚本/文档必须真实存在，且「同行并列陈述的装置」必须同处**（`audit-doc-refs.mjs` 常驻守，守 §八 E-H）；★ 排除口径**必须按「就近窗口」**判，不得整行豁免。**⑤ 文档里点名的脚本必须「在版本控制内」**（`git check-ignore` 不命中）—— 「本机存在」与「别人克隆后拿得到」**是两层**，只判前者会**结构上看不见** `tmp/` 这一类（**P-55**）；**⑥ 本 goal 的 SSOT（`docs/GOAL.md`）必须在引用闸门的扫描面内**（它是**每轮被照着执行**的文件）。 |

### 附录四续三十六：第四十一轮 W49 —— 把 SSOT 自己纳入引用闸门 + 判据⑤「引用目标必须在版本控制内」

> 起点：W46/W47/W48 连续三轮都在做「**换一个语义不变量，找无机器守的区**」。
> 本轮换的问题是 ——「**文档里被点名要存在的东西，是否在『旁人克隆得到』的范围里？**」
> ★ 实测答案：**没有任何闸门在守这件事** —— `audit-doc-refs.mjs` 的四条判据 ①②③
> **只问「本机磁盘上存不存在」**、④ 问「并列装置是否同处」。
> ★ 而这条**结构上不可见**：`tmp/` 里有大量**真实存在**的历史探针，
> 本机跑起来一切正常，**只有别人克隆后才暴露**。

| 项 | 内容 |
|---|---|
| **W49 · ★★ 真缺陷（P-53 的第二次现身，落在 SSOT 自己身上）** | `GOAL.md` **§3.1「怎么跑」列**有**两条可执行引用**指向 `rp-workspace/tmp/w32-all-projectable.mjs` / `w36-v0-migrate-fold.mjs`，而 **`tmp/` 在 `.gitignore:34` 内**（实测 `git check-ignore` 命中、`git ls-files rp-workspace/tmp` = **0**）⇒ **本机跑得通、别人克隆后那两个文件根本不存在**，而它们是那两行**唯一的**指令。★ **更根本的一层**：**`GOAL.md` 自己此前不在任何引用完整性闸门的扫描面内**（E-H 只点名四份文档）—— 而它是**本 goal 的唯一事实来源**、**每轮都被照着执行** = **最该守的地方反而没人守**。 |
| **W49 · 修法①（扫描面扩到 SSOT）** | `SCAN_DOCS = E_H_DOCS + SSOT_DOCS`（**4 → 5 份**）。 |
| **W49 · 修法②（判据⑤）** | 可执行引用的目标必须**在版本控制内** —— 锚在 **`git check-ignore`** 而**不是**「有没有被 `git ls-files` 收录」：后者会把**新增未提交**（`??`，正常开发态）误报（本仓实测 **58 个** `??` 脚本）⇒ **假红**（守 **P-38**）；非 git 环境 ⇒ 返回 `null` 并**只出声不报红**（守 **P-43**）。 |
| **W49 · 修法③（史实区 mask，单源声明）** | GOAL §十一 / 方法论 §六 / 契约附录 = **逐轮记录**（「当时是 16/16」**在写下时是真的**）⇒ 必须先 mask 再判，否则**永远报红**。首版不 mask 实测 **70 处**、其中 **68 处在史实区** ⇒ 量级与真缺陷（2 处）**严重不符**（**P-45 识别特征**）。★ 与 `audit-selftest-claims.mjs` 的 `isCurrentStateSection` **同口径**（**P-1**）。 |
| **W49 · ★★ 口径连被证伪四次（全部由探针 / selftest 当场量出）** | ⑴ **不 mask** ⇒ 70 处假红（见上）；⑵ ★★ **mask 的退出条件锚错了**：首版「任意 `^##` 都重置开关」⇒ 史实区**内部也有 `##` 级标题**（方法论 §6.x = `## 6.18 …`）⇒ 下一个 `## 6.x` **立刻把 mask 关掉** ⇒ **整个史实区根本没被 mask** ⇒ 改锚「**主章节标题**」（`## 十二、` = 中文数字 + 顿号）；⑶ ★★ **豁免必须「分家」且不能写成 `continue`**：判据① 的豁免词表含「不存在」⇒ ① 的 `continue` **连带跳过判据⑤** ⇒ 行内只要有「不存在」，判据⑤ **永久静默**（**P-30 与通过同貌**）⇒ 豁免**只作用于它自己那条判据**，且判据⑤ 用**独立词表**（`NEG_RE_VCS`，**去掉**「不存在 / 已删」—— 因为**能走到判据⑤ 的前提就是该路径确实存在**，那个词**必然在讲别的东西**）；⑷ ★ **`--file <临时副本>` 会把文档身份变成 `(临时副本)`** ⇒ **区段语义失效**（副本不再被 mask）⇒ 负控「基线必须绿」当场失败 ⇒ 新增 **`--as <文档名>`**（并按文件名兜底推断）—— 这正是 **P-45**：**判据的口径依赖文档身份，脱开身份就没法判**。 |
| **W49 · ★ 负控自身也踩三次（诚实留痕）** | ⑴ 注入锚点选在**含「不存在」的行**（§3.1 那行有 W49 自己写的说明）⇒ 落进**就近豁免窗口** ⇒ **假负控**；⑵ 注入文本里写「**本行由负控注入**」⇒ 被**自己的豁免词表**豁免（±40 字窗口）⇒ 又假负控 ⇒ **纪律：注入文本一律写成中性句子**；★★ ⑶ **补上 `--as` 之后负控 A~D 全部由「报红」变「报绿」** —— mask 一生效，**原先的注入锚点全落进了史实区**（A 锚在 §6.48 以内、B 锚 `## 十、` 不存在而退化取中间行、C/D 锚在 §6.x）⇒ **注入被 mask ⇒ 假负控**（测的不是判据，是 mask）⇒ **纪律：负控的注入锚点必须落在「闸门真正会看的区域」**（P-1 + 区段语义）；★ 且实测**方法论里「非史实区的可执行引用 = 0 处」**（全在 §六 及之后）⇒ C/D **结构上**只能在 GOAL 底本上测。 |
| **W49 · 机器化 + 负控** | `audit-doc-refs.mjs` selftest **16/16 → 41/41**（新增：判据⑤ 正/负控/两组杠杆/两个零控、`NEG_RE_VCS` 分家两条零控 + 一条杠杆、史实区 mask 三组正控 + 两组零控、扫描面与真实仓库前提断言）；`audit-doc-refs-negctl.mjs` **9/9 → 18/18**（新增 **D** 引用目标不在版本控制内 / **E** GOAL 底本注入 / **F** mask 杠杆 + GOAL 逐字节未触碰自证）。 |
| **结果** | 实跑 E-H 四份 + SSOT **报红 0 处 · ⓘ 信息项 2 处**（方法论 §5.4 的两处「`tmp/xxx.mjs`」是**叙述性引用**（读者不会照抄）⇒ 只出声不判 FAIL，守 P-38）· 门禁 **45 条 `[gate] OK`**（双架构各 45）· sentinel **v363 一致** · M4 双包 **169 / 缺失 0** · vitest **81 / 1790 / 0 失败（2 skipped）** · typecheck **三段 0 错** · 设备残留 **0**。★ 期间 `audit-build-path-parity.py` 判据五**第三次当场抓到编辑 `.ps1` 剥掉 BOM**（R22④ 护栏正常工作，补回后 **38/38**）。 |
| **★ 契约条款：新增（引用目标的「存在性」分两层）** | **⑦ 判定「文档引用的目标存在」必须分两层**：⑴ **本机磁盘存在** ⑵ **在版本控制内**（`git check-ignore` 不命中）。只判 ⑴ ⇒ **结构上看不见**「本机有、别人克隆后没有」这一类（**P-55**）。**⑧ 文档身份必须随副本传递**（`--file` 需配 `--as`）—— 否则**区段语义失效**、判据口径与真目标错位（**P-45**）。**⑨ 逐轮记录区（史实区）必须先 mask 再判**，且 **mask 的退出条件锚到「主章节标题」**（区段内可能有同名级标题）。 |

### 附录四续三十七：第四十二轮 W50 —— 「已加护栏」为什么可能是空声明（纪律声明闸门）

> 起点：W46→W49 连续四轮都在「**换一个语义不变量，找无机器守的区**」。本轮换的是第五个问题 ——
> 「**§七 纪律表里凡声明『已机器化 / 已加护栏 / 由 X 常驻守』的，那个装置真的会被跑到吗？**」
> ★ 实测：**整套纪律体系里没有任何机器在守这些声明本身**。

| 项 | 内容 |
|---|---|
| **W50 · ★★ 真缺陷** | **R19** 原文只有一句「见 P-31。**已加静态护栏**：DOM 增强模块扫出 `replaceChild` 即报红。」⇒ ★ **没点名装置**。取证三步：① 护栏真身 = `packages/tests/touch-target-audit.spec.ts` 的 **P-31 家族回归锁**（4 类销毁型手法 + **剥离注释与字符串**后扫 + 作用域由 `bodyRef` **调用点机器化推导**，非硬编码文件名）；② `grep vitest scripts/build-dsht.ps1` = **0 命中** ⇒ **不在构建期 45 条门禁内**；③ 而**读者按字面理解「已加护栏」＝总在守**，实际上**只有跑 `npm run test` 才跑到它**。 |
| **W50 · ★★ 这是同一个母题的第四层** | P-52 = 文档里**写了**某个装置吗 · P-53 = 装置**在版本控制内**吗 · P-55 = 装置**本机存在**吗（+ 引用目标是版本控制内吗）· **P-56 = 装置会被真的跑到吗**（在**哪条通路**上）。 |
| **W50 · 修法（三项判据，新建 `audit-rule-claims.mjs`）** | ① **声明有机器守 ⇒ 必须点名装置**；② **点名的装置必须真实存在**；③ ★★ **触发路径必须可判定** —— 只认**两条真实通路**：**在构建期门禁里**（`build-dsht.ps1`）**或**是一条会被 `npm run test` 跑到的 **vitest 规格**；两条都不是 ⇒ 报红。★ 刻意**只认两条**：将来出现第三条通路（如 CI 专用脚本）必须**显式登记** —— 「它真的会被跑到」这件事**需要有人确认过**。接入 **Step 0.55 第十三组**（门禁 **45 → 48 条**）。★ R19 已补上**装置路径 + 触发方式 + 「不在构建期门禁内，由 R1 基线回归承接」**。 |
| **W50 · ★★ 解析口径由实测逼出两条（全部由 selftest 当场证伪）** | ⑴ **纪律块必须收「续行」**：R19 的声明写在**引用块续行**（`>`）里 ⇒ **只读条目行会整个漏掉**（首版实测：**漏掉 R19 = 漏掉本轮的真缺陷**，而报告显示「违规 0 处」= **P-30 判据失效与通过同貌**）；⑵ **装置名必须覆盖 `spec.ts` 形态**：首版只认 `mjs\|py\|ps1\|sh` ⇒ 把 R19 已点名的 `touch-target-audit.spec.ts` **整个漏掉** ⇒ 「已点名」被误判成「没点名」= **假红**（**P-45**）。 |
| **W50 · ★ 闸门自己踩的两个 `isMain` 坑（第二个表现为 P-46）** | 负控要 `import` 闸门的纯函数（守 P-1）⇒ ⑴ **主流程没有 `isMain` 守卫** ⇒ import 时把闸门跑了一遍且 `process.exit()` **杀掉负控进程**；⑵ ★★ **`--selftest` 分支也没有守卫** ⇒ 而**负控自己正是用 `--selftest` 跑的** ⇒ 顶层 `process.argv.includes('--selftest')` **无条件成立** ⇒ import 时把**闸门的 selftest** 跑了一遍 ⇒ **负控真分数 `10/10` 被闸门 `14/14` 顶掉**。★★ 识别特征：**同一脚本两次跑出不同分数**（直接跑 10/10、被探测 14/14），而**两个数看起来都合理** = **P-46** 的变体；★ 由 **W45 建的「自证分数契约」当场抓到**。⇒ **纪律：可被 import 的模块，所有顶层副作用（含 selftest 分支）都必须收进 `isMain` 守卫**。 |
| **W50 · 负控（守 B11）** | `audit-rule-claims-negctl.mjs`（**10/10**）注入三类坏样本（**A** 没点名装置 / **B** 装置不存在 / **C** ★ 装置存在但**无触发路径**）⇒ 报红且**结论正确**；改回 ⇒ 回绿；★ **全程只在内存里改文本、连副本都不落盘** —— **P-48 的最强形态**（比 W45 的 `--file <临时副本>` 又进一步：**连副本这个副作用都不产生**）。★ **负控 C 的前置断言是必需的**：所选「孤儿装置」样本必须**真的存在且真的无触发**（首版选了 `tmp/verify-sentinel.py` —— 它**不存在**，负控 C 会退化成负控 B，**测不到本条判据**）。 |
| **结果** | `audit-rule-claims.mjs` selftest **14/14** · 负控 **10/10** · §七 实跑 **23 条纪律 / 声明有机器守 3 条 / 违规 0 处** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0**。★ 期间 `audit-build-path-parity.py` 判据五**第四次当场抓到编辑 `.ps1` 剥掉 BOM**（R22④ 护栏正常工作）。 |
| **★ 契约条款：新增（纪律声明的可验证三要素）** | **⑩ 凡在 `GOAL.md` §七 声明「已机器化 / 已加护栏 / 由 X 常驻守」，必须同时给出**：**装置名** + **它真实存在** + ★★ **它在哪条通路上会被跑到**（构建期门禁 或 会被 `npm run test` 跑到的 vitest 规格）。三条缺一 ⇒ 由 `audit-rule-claims.mjs` 常驻报红。★ 理由：**「已加护栏」四个字省略的正是「谁跑它 / 什么时候跑 / 跑不跑得到」这三个可验证信息**，而读者会**自动补全为「总在守」**。 |

### 附录四续三十八：第四十三轮 W51 —— 「验收标准」本身也没人守（§八 E-C 两处过期）

> 起点：W46→W50 连续五轮都在「**换一个语义不变量，找无机器守的区**」。本轮换第六个问题 ——
> 「**GOAL 的每一个章节，有没有被任何常驻闸门扫？**」
> ★ 探测手法（**按语义不变量，不按已知 API**）：枚举**全部 29 个常驻闸门**，
> 逐个解析「它读哪些文件 / 切哪一段」⇒ 再对 GOAL 的 13 个章节逐个问「有无闸门提及」。

| 项 | 内容 |
|---|---|
| **W51 · 实测结论** | `§一/§二/§四` 是**纯定义**（无量化声明）⇒ **合理无守**；`§三/§五/§六/§七/§九/§十/§十一/§十二` ✅ 有闸门；★★ **`§八 验收（E-A~E-H）` 完全无闸门提及** —— 可它**是最像「判据」的一节**（「什么叫达成」的定义）。 |
| **W51 · ★★ 真缺陷（E-C 是 §八 唯一含可核对数字的一条，两处都过期）** | ① **`vitest ≥ 1786 通过 0 失败`** = **代理阈值**：既不随轮次更新（实测已 **1790**）⇒ **P-27**，也不表达真正的不变式（真正的不劣化事实是「**0 失败**」）⇒ **P-41**；② **`十三项门禁 exit 0`** = **口径混用**：「十三项」是 **§3.2 第一层分组数**（装置分类数），而**产出条数**实为 **48 条 `[gate] OK`** ⇒ 读者会当成同一件事（**P-1**）。 |
| **W51 · 修法（扩闸门，**不新建脚本**）** | 扩 **`audit-baseline-claims.mjs`** 新增 §八 **三条判据**：① 不得用「代理阈值」表达不变式；② 不得用「分类数」表述「产出条数」；③ 若声明条数则必须与 §3.1 **同源**。★ **为什么不新建脚本**：E-C 的门禁条数与 §3.1 的核对**共用同一真值来源**（构建日志）⇒ 分家会产生**两份真值** ⇒ 正是 **P-1** 要消灭的形态。E-C 按 **P-41** 改锚为「**0 失败**（当前 1790 通过 / 2 skipped，见 §3.1）」+「**48 条 `[gate] OK`**」。 |
| **W51 · ★★ 口径被负控连证伪三次** | ⑴ **中文数字漏匹配**（首版 `\d+\s*项门禁` ⇒ 漏掉原文的「**十三**项门禁」⇒ 负控报绿 = **P-30**）；⑵ **说明性引用被误判**（我在 E-C 行内写「原文写死『十三项门禁』…」是在讲「不要这样做」⇒ **假红**，**P-38**）；⑶ ★★ **窗口跨句读边界 ⇒ 反而把真违规豁免**（±80 字窗口跨到了**同一行上一句**的「改锚」⇒ 负控报绿 ⇒ **P-30 再现**）⇒ **窗口必须在最近的句读边界（`；`/`。`/`|`）截断**（与 W44「不跨表格列边界」同源）。 |
| **W51 · 负控（守 B11）** | `audit-baseline-claims-negctl.mjs`（**7/7 → 11/11**）新增两条（**C** E-C 用代理阈值 / **D** E-C 用「N 项门禁」）。 |
| **结果** | `audit-baseline-claims.mjs` selftest **24/24 → 36/36** · 负控 **7/7 → 11/11** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0**。 |
| **★ 契约条款：新增（验收条款的可核性）** | **⑪ 凡「验收/达成」类条款（`GOAL.md` §八）里的数字，必须是「可机器取真值 + 与其它区段同源」的**：**不得用代理阈值**（`≥ N 通过` ⇒ 改写成「**0 失败**（当前 N）」，P-41）；**不得用分类数表述产出条数**（`N 项门禁` ≠ `N 条 [gate] OK`，P-1）；若声明条数则**必须与 §3.1 同源**。由 `audit-baseline-claims.mjs` 的三条 §八 判据常驻守。 |

### 附录四续三十九：第四十四轮 W53 —— **同一类声明写在两个区段，只有一个区段有守**（P-58）

> 起点：W46→W52 连续在「**换一个语义不变量，找无机器守的区**」。本轮换的是第七个问题 ——
> 「**除 §七 之外，还有哪些区写『已机器化 / 已加护栏』？**」
> ★ 探针实测：`GOAL.md` **§九「已产出的设计哲学资产」的 P 判据索引**里有**同一类声明 9 条**
> （形如「W38 已机器化为 `audit-p48-rollback.mjs`」/「W44 已机器化为 `selftest-summary.mjs`」），
> 而 W50 建的 `audit-rule-claims.mjs` **只扫 §七**（覆盖 3 条）。

| 项 | 内容 |
|---|---|
| **W53 · ★★ 真缺陷（且是教科书级识别特征）** | **§九 的同类声明从未被守**。★ 关键在于：探针实测这 9 条**当前全部合规（0 问题）** —— 但 **「恰好都对」= 运气不是判据力**（**W45 的教科书识别特征**：**假绿与真绿在输出上完全同貌**）。★★ 这是 **P-52/P-53/P-55/P-56 之后、同一母题的第五层**：P-52 写了装置吗 · P-53 在版本控制内吗 · P-55 本机存在吗 · P-56 会被跑到吗 · **P-58 除了我手边这一处，别处有没有同类声明没守**（**契约覆盖面** —— 与 **P-54** 同源，但对象是**文档区段**而非**脚本扩展名**）。 |
| **W53 · 修法（按 P-1 扩既有闸门，不新建脚本）** | ① **扫描面做成显式区段表** `SCAN_SECTIONS`（`§七 纪律` + `§九 P 判据索引`），每区声明「怎么定位条目 / 怎么切块 / 怎么取 ID」；② ★★ **切面失效 fail-closed** —— 任一区标题缺失 / 顺序不对 ⇒ `ok=false` 并点明是哪个区（否则该区**完全不被检查**却照样报绿 = **P-30**）。★ **为什么不新建脚本**：两份「机器化落点」真值 = **P-1** 要消灭的形态。 |
| **W53 · ★ 由闸门体系咬合抓修的三处自身缺陷** | ⑴ **P-37 假红**：`CLAIM_RE` 的 `[^已]机器化` 会匹配 P-37 定义行的「把**结论机器化**」—— 那是**动作/祈使语境**（「去把它机器化」，指向**待办**），而**状态声明**的判定特征是**「已」或「周次」** ⇒ 收窄为「**已**机器化 / `W\d+` 机器化」（**P-38** 过宽 ⇒ 假红）；⑵ **表格续行吞掉表格后的正文**（**P-45**）：§九 是**单行长表**，沿用 §七 的「缩进/空行算续行」会把 §九 末尾的顶格正文并进最后一条判据 ⇒ 改为**按「本条目是否表格行」分流**（表格条目只收表格行）；⑶ **selftest 空转断言**（**P-30**）：自造字符串喂正则 = 空转 ⇒ 改为**实调 `scanRuleClaims` 读真文档**断言。 |
| **W53 · 负控（守 B11）** | `scripts/audit-rule-claims-negctl.mjs`（**10/10 → 18/18**）新增：**D** §九 声明有机器守但没点名装置 / **E** §九 点名的装置不存在 / **F** 切面失效必须 fail-closed（改 §九 标题 ⇒ `ok=false` 且报错点明哪个区）/ **G** 假红零控（「把结论机器化」不得被判违规）+ **杠杆**（改「W38 机器化」⇒ 必须判为声明）。 |
| **结果** | `audit-rule-claims.mjs` selftest **14/14 → 22/22** · 负控 **10/10 → 18/18** · 实跑 **§七 23 条（声明有机器守 3 条）· §九 58 条（声明有机器守 8 条）· 违规 0 处** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · vitest **1790/0** · typecheck 三段 0 错。★ 收尾时 `audit-selftest-claims.mjs` **当场报出 6 处**未同步的分数声明（GOAL 3 处 + 方法论 2 处 + §11.3 W16 行 1 处）⇒ 同步后回绿（**这正是 W44/W45 建那两道闸门的价值**：改判据必然触发文档同步）。 |
| **★ 契约条款：新增（同类声明的跨区段单源守）** | **⑫ 凡在 `GOAL.md` 任一区段声明「已机器化 / 已加护栏 / 由 X 常驻守」，都必须点名真实存在且触发路径可判定的装置 —— 且受守区必须「按语义**枚举**」，不得「按我写过的那个区」**。★ 实现纪律：⑴ **同一语义的声明只许一个闸门守**（P-1，扩既有闸门 ⇒ 只有一份真值）；⑵ **受守区做成显式区段表**（新增区段 = 显式登记 ⇒ 未登记的新区段会被判据⑧ 同族手段发现）；⑶ ★★ **切面失效必须 fail-closed**（区标题缺失 ⇒ 报红，否则「该区不被检查」与「该区检查通过」在输出上同貌 = P-30）。由 `audit-rule-claims.mjs`（Step 0.55 第十三组）常驻守。 |

### 附录四续四十：第四十五轮 W54 —— **判据「声明已实现」而实现里一条都没有**（P-59）

> 起点：W46→W53 连续在「**换一个语义不变量，找无机器守的区**」。本轮换的是第八个问题 ——
> 「**闸门头注里声明的那几条判据，实现里真的都有吗？**」
> ★ 探测手法：**读闸门自己的头注，逐条对其实现**（按「声明 vs 实现」这组语义不变量，不按已知 API）。

| 项 | 内容 |
|---|---|
| **W54 · ★★ 真缺陷** | `audit-goal-sections.mjs` 的**头注**与 **`GOAL.md` §3.2 的闸门清单**都写着判据 **⑦c**「§5.4 定义不得超出索引范围」—— 而**实现里一条都没有**：该脚本**连方法论文件都没打开过**（`grep METHODOLOGY` = 0 命中）。⇒ 读者（含未来的 AI）会以为「判据体系三处一致」有机器守着，**而那条通路根本不存在**。★ 这是 **P-56 的教科书形态**，也是 **P-58 的同族**（同一份声明写在**两个区段**里，两处都「看起来有守」）。★ **为什么藏得住**：**假绿与真绿同貌**（**P-30 / W45 识别特征**）—— 当时 §5.4 **恰好覆盖全部编号** ⇒ 「没守」与「守了」在报告上**完全一样**。 |
| **W54 · 修法（按 P-1 扩既有闸门，不新建脚本）** | ⑦c 补成**双向**：① **缺定义 ⇒ 报红**（索引是「已发布判据清单」，只有编号而无定义 ⇒ 那条判据**只是一句编号**）；② **出现索引外编号 ⇒ 报红**（漏登记）；③ ★★ **切不出 §5.4 ⇒ fail-closed**（否则「该区未被检查」与「该区通过」同貌 = **P-30**）；④ 读不到方法论 ⇒ **只出声不报红**（**P-43**）。★ 同时把 `checkDoc(text, { methodText })` 做成**可注入**（合成样本与负控副本必须**自给自足**，否则样本 §九 只 12 条而真实 §5.4 有 58 条 ⇒ 「正向」分支报 46 条**假红**，**P-40 家族**的隐式前提）。★ 配套新增闸门参数 **`--method <path>`**：判据 ⑦c 读方法论 ⇒ 负控必须能对**方法论副本**注入坏样本（否则本条判据**无法被负控**，**P-1**：注入点必须落在判据的扫描面上）。 |
| **W54 · ★★ 承重实验当场抓到「负控自己的空洞」（本轮最重要的副产物）** | 按 **P-20/B11** 把 ⑦c 的反向分支**短路掉**后重跑两道控 ⇒ **selftest 报 7 FAIL**（有杠杆 ✓）**且负控报 6 FAIL** —— 而**短路之前负控是 13/13 全绿** ⇒ **原负控对 ⑦c 零覆盖**（**P-20「长期无正控 = 覆盖空洞」的负控版本**）。⇒ 补 **E1 缺定义 / E2 索引外编号 / E3 切面失效 / E4 杠杆** 四条控后 **13/13 → 20/20**，再跑承重实验**双双失败**（有杠杆）。★ **教训**：**「新判据有 selftest、有杠杆」不等于「负控也覆盖了它」** —— 负控的覆盖面必须由「**把实现短路掉，看负控会不会红**」**独立证明**。 |
| **W54 · ★ 两处口径由实测逼出（都是假红 / 假负控）** | ⑴ **§5.4 的条目有两种形态**（表格行 `\| **P-1** \|` 与段落行 `**P-58 第…`），首版只认表格行 ⇒ 把 **20+ 条真实存在的定义**判成「缺定义」（量级与已知事实严重不符 = **P-45** 识别特征）；⑵ ★ **「让锚点失效」的注入文本必须实测真的不再匹配** —— 负控 E3 首版写 `### 5.40 标题被改坏`，而闸门正则是 `/^###\s*5\.4/`（**无词边界**），`5.40` **仍然匹配** ⇒ 切面根本没失效 ⇒ **假负控**（与 W42 负控 C 的坑**第二次现身**）。 |
| **结果** | `audit-goal-sections.mjs` selftest **28/28 → 35/35** · 负控 **13/13 → 20/20** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。★ 收尾时 `audit-selftest-claims.mjs` **当场报出 5 处**未同步的分数声明 ⇒ 同步后回绿。★ 期间 `audit-build-path-parity.py` 判据五**第六次当场抓到编辑 `.ps1` 剥掉 BOM**（R22④ 护栏正常工作）。 |
| **★ 契约条款：新增（声明与实现的逐条对账）** | **⑬ 闸门头注里声明的每一条判据，必须在实现里可被指认** —— 且**受守面覆盖判据真正要读的文件**（如 ⑦c 读方法论，则该文件必须进闸门的输入面，并**可被负控注入副本**）。★★ 配套纪律：**「新判据有 selftest、有杠杆」不等于「负控也覆盖了它」** —— 负控的覆盖面必须由「**把实现短路掉，看负控会不会红**」**独立证明**（承重实验），不能由「selftest 里有它的控」推断。由 `audit-goal-sections.mjs`（Step 0.55 第九组）常驻守。 |

### 附录四续四十一：第四十六轮 W56 —— **临时探针才是 P-45 最高频的现身处**（三个语义不变量排查 · 五度踩 P-45）

> 起点：`GOAL.md` §11.1 已无 ⬜/🔄 工作面 ⇒ 按 §十二 第 3 条转「换语义不变量找无机器守的区」。
> 本轮一次做**三个**横向排查。★ **三面都没有缺陷**，但**每一个的首版探针都口径错**。

| 项 | 内容 |
|---|---|
| **W56 · ① §七 纪律的「机器落点覆盖率」** | 探针**首版只认表格条目形态**（`\| **R1** \|`）⇒ 只切到 **12 条**，而真实 **23 条**（R13~R23 是**列表形态** `- **R13（…）**：`）。★ **识破依据是外部对账**：读数与既有闸门（`audit-rule-claims.mjs` 报 **23 条**）**严重不符** = **P-45 的识别特征**。⇒ 修法按 **P-1**：改 `import { scanRuleClaims }` **复用单源解析**（而非重写切块规则）。复核结论：**① 声明+点名装置 11 条 · ② 声明但没点名 0 条 · 其余为「靠人」纪律** ⇒ **无缺陷**（纪律本身是每轮执行的行为准则，不都需要闸门 —— 给 R2「发现即归位」这类认知纪律做闸门只会产出假红）。 |
| **W56 · ② 文档命令的「参数有效性」** | 语义不变量：「脚本存在」≠「这条命令能跑通」（`audit-doc-refs.mjs` 判据① **只查路径存在**，不查 flag）。⇒ 实测 4 条带 flag 的命令**全部有效** ⇒ **无缺陷**。★ 附带发现：判据编号有**三族写法并存**（阿拉伯 `判据 4` / 中文圈号 `判据⑤` / 中文大写 `判据二`）—— 已登记为 **N8** 负结论。 |
| **W56 · ③ §八 E-E 的「被后续工作引用」** | E-E 声明「持续产出可复用判据，写入文档**并被后续工作引用**」—— 「写入文档」**有守**（§九 索引 / §3.1 条数 = W43 判据⑦），**「被引用」无守**。探针**首版只扫 4 份 md** ⇒ 把 **P-35** 误报成「零域外引用」；**取证当场证伪**：`scripts/verify-apk-payload.py:387` 的头注**明确写着「P-35 的纪律」** ⇒ **假红**（**P-45 第四次**）。⇒ 修口径为**代码 + 文档双侧扫描**后：**59 条判据全部有域外引用**，连「域外引用仅 1 次的弱引用」都是 **0 条** ⇒ **无缺陷**。 |
| **W56 · ★★ 结论：探针才是 P-45 最高频的现身处** | 常驻闸门有 **selftest / 负控 / 承重实验**三重护栏（**P-30 / P-59**），而**临时探针一条都没有** —— 写出来就跑、跑完就删，**没有任何东西会反驳它**。⇒ 本轮五度触发 P-45，**五次全部由「读数与已知事实严重不符」当场识破**（一次都不是「想」出来的）。**纪律（两条）**：⑴ **只要一个排查能被已有闸门覆盖，就绝不另写探针**（**P-1**）；⑵ 确需新探针时**必须复用既有单源解析函数**，且**在把读数写进结论之前先与已知事实对账**（问「这个量级对得上吗？」）。 |
| **结果** | 三面排查 **0 缺陷** ⇒ 登记 **N9**（含五度 P-45 的识别过程，避免后人重做）· 补强 **P-45 第三形态** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 六道结构闸门全绿。 |
| **★ 契约条款：新增（探针读数必须先对账）** | **⑭ 临时探针的读数在被「与已知事实对账」之前，不得写进结论** —— 探针没有 selftest / 负控 / 承重三重护栏，**它是 P-45 最高频的现身处**；识别特征是 **「报出量级与已知事实严重不符」**。★★ 配套：**能被既有闸门覆盖的排查，绝不另写探针**（**P-1**）；确需新探针时**必须复用既有单源解析函数**。 |

### 附录四续四十二：第四十七轮 W57 —— **契约条数长期写死，而它从未被任何机器核过**（P-60）

> 起点：`GOAL.md` §11.1 已无 ⬜/🔄 ⇒ 按 §十二 第 3 条换第九个语义不变量 ——
> 「**§六 承诺边界 B1~B13 里的数字，有没有机器守着**」。
> ★ 这个问题的价值：**边界表是最像「契约」的一节**（承诺不做什么），
> 而它里面的数字（路由 67 条 / slots 42 个）**看起来像冻结的常量**。

| 项 | 内容 |
|---|---|
| **W57 · ★★ 真缺陷** | `GOAL.md` §3.2 第 3 项与 **§六 B10** 都写「路由 **67 条**」，而 `audit-route-contract.mjs` 实测**稳定输出 68 个唯一路由**（0 违约）。★ 取证：`git log -S "67 条"` **查不到任何提交**、脚本输出在最近数轮构建里**一致为 68** ⇒ 结论是「**声明过期**」而非「能力被删」。★ **若不做这步取证**，「67 → 68」很自然会被读成「**能力被删了 1 条**」，从而去找一个**从来不存在的回归**（**P-17**）。 |
| **W57 · ★★ 为什么藏得住（本轮真正的教训）** | **构建期 Step 0.5 的循环把闸门 stdout 全部 `\| Out-Null` 丢掉**（只留一句 `[gate] OK`）⇒ **读数在日志里根本不存在** ⇒ 写死的数字与真实读数可以**静默脱钩**（**P-27** + **P-11 元级**）。★ 这回答的正是「为什么此前没人发现」：**没有观测面 = 无法发现**，与判据写得对不对无关。 |
| **W57 · 修法 ①（按 P-41 改锚到事实）** | 「路由 67 条」⇒「**0 违约**（当前实测 **68 个唯一路由**，以脚本输出为准）」。★ 对外契约真正的不变式是「**0 违约**」；条数**会随新增能力正常增长**，写死成常量后每加一条就让文档过期，而**没有人会回头改它**。 |
| **W57 · 修法 ②（按 P-50/P-27 造观测面）** | 给闸门加**可机器读的读数行** `[契约读数] routes=N violations=M`，并在 `build-dsht.ps1` Step 0.5 循环里**对声明了读数行的闸门单独回显**。⇒ 实测日志已出现 `[契约读数] routes=68 violations=0`（**此前该读数在日志里完全不存在**）。 |
| **W57 · 机器化（按 P-1 扩既有闸门）** | 扩 `audit-baseline-claims.mjs` 新增纯函数 `routeCountHardcodeProblems`：**写「路由 N 条」时必须同时给出「以脚本输出为准 / 当前实测」**。★ 不新建脚本 —— 与 §3.1/§八 的数字核对**共用同一层职责**，分家会产出两份数字真值（**P-1**）。selftest **36/36 → 41/41** · 负控 **11/11 → 16/16**（**E** §3.2 形态 / **F** B10 形态 = **P-58** 同源 / **杠杆E**）。 |
| **W57 · ★ 承重实验（P-59 纪律③）** | 把该判据**短路** ⇒ **selftest 报 4 FAIL 且负控报 5 FAIL** ⇒ 两处控都**真的测到了它**（不是空转）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· 构建日志**首次出现契约读数行** · sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。★ 收尾时 `audit-selftest-claims.mjs` **当场报出 5 处**未同步的分数声明 ⇒ 同步后回绿。★ 期间 `audit-build-path-parity.py` 判据五**第八次当场抓到编辑 `.ps1` 剥掉 BOM**（R22④ 护栏正常工作）。 |
| **★ 契约条款：新增（会增长的量不得写成常量）** | **⑮ 凡「会随能力/时间增长」的量（路由数 / slots 数 / 判据条数 / 门禁条数），在文档里不得写成硬常量** —— 正确形态是「**不变式 + 读数 + 口径说明**」（如「**0 违约**（当前实测 **N 个唯一路由**，以脚本输出为准）」）。★★ 配套两条：⑴ **关键读数必须出现在构建日志里**（闸门输出可机器读的读数行，且**构建脚本不得把它丢进 `Out-Null`**）—— **没有观测面 = 无法发现脱钩**；⑵ 判据形态：写「N 条」时必须**同时给出读法**，否则由 `audit-baseline-claims.mjs` 报红。 |

### 附录四续四十三：第四十八轮 W58 —— **同一族的读数在另一份文档里也过期了**（P-60 补强）

> 起点：W57 修完 `GOAL.md` 的「路由 67 条」后，按 §十二 第 3 条换第十个语义不变量 ——
> 「**§六 承诺边界 B1~B13 里的数字，有没有机器守着**」。

| 项 | 内容 |
|---|---|
| **W58 · ★★ 真缺陷（两个数）** | `README.md`「能做什么」表写死「**73 个 API（32 本地 + 41 桥接）**」、Tier 2 写死「**71 项**记名 stub」，而实测 **`SHIM_LOCAL_APIS` 34 + `SHIM_BRIDGE_APIS` 41 = 75**、`TH_UNSUPPORTED_APIS` **81 项** ⇒ **两个数都过期**（**P-27**）。★ **为什么藏得住**：与 W57 同形 —— `audit-th-face-coverage.mjs` **只做「名字是否已实现或已拒绝」的面比对、不断言条数** ⇒ **条数没有观测面**。 |
| **W58 · ★ 逐条分诊（P-38 三段式的第二段 —— 这一步决定了结论）** | 先按语义不变量枚举候选：Tier 3「明确不修」清单里的 `ScriptTrees` / `importRaw*` / 音频控制面 / extension 作用域变量在源码里**确有命中**。★★ **但逐条取证后判定「口径自洽、不是缺陷」**：命中的是 **`TH_UNSUPPORTED_APIS` 名单本身**（= **明确拒绝**，**正是 README 承诺的那个口径**）。⇒ **真缺陷只在条数上**。★ 若不做这一步，就会把「**已按承诺拒绝**」误报成「**说好不做却做了**」（方向完全相反）。 |
| **W58 · 修法（三条）** | ① README 两处改为**读数形态**（「三份名单，条数以源码为准」/「记名 stub 名单之外的增量」）；② ★ **造观测面**：`audit-th-face-coverage.mjs` 加读数行 `[TH 面读数] local=N bridge=N total=N unsupported=N`（★ 实测首版**锚点用错对象** —— 对 `buildShimSource()` 生成的**运行期源码**抽名单 ⇒ 字面量不在其中 ⇒ **fail-closed 抛错、闸门直接崩** ⇒ 改锚**源文件** `th-shim.ts`，**P-45**）；③ ★★ **机制收口（P-1）**：「读数行回显」由 W57 的 `if ($a -eq '...')` 改为**一张表** `$readingGates`（新增闸门只需加一行，且**取不到读数行会出声**）⇒ 现在**两条读数行都进构建日志**。 |
| **W58 · 机器化（扩面 + 合并同义实现）** | `growthReadingHardcodeProblems` 扩到 **README 面**，并**删除** W57 的 `routeCountHardcodeProblems`（两份同义实现 = **P-1** 违例 —— **在修 P-1 的过程中不能制造 P-1**）。selftest **41/41 → 46/46** · 负控 **16/16 → 19/19**（新增 **G** README 形态 / **杠杆G**）。★ **`--readme <path>`**（与 W54 的 `--method` 同法）：README 与 GOAL 是**两份文档** ⇒ 按 **P-58** 两处都要守，负控必须能对 **README 副本**注入。 |
| **W58 · ★★ 两处口径由实测逼出（都是「把对的报成错的」）** | ⑴ **「有机器守的读数」允许写死** —— `tavern_events` **82 项**由 `audit-card-event-surface.mjs` 断言 `=== 82`，**写死反而是对的**（有意冻结的兼容面，变了必须报红）⇒ 判据按**是否声明了守它的装置**分流，否则**假红**（**P-38**）；⑵ **说明性引用被误判** —— README 里「★ W57 修：原文写死『路由 **67 条**』而实测 68」**是在讲「不要这样做」**却被命中（与 **W51** 同源坑）⇒ 加**说明语境**排除 + 补零控。 |
| **W58 · ★ 承重实验（P-59 纪律③）** | 短路该判据 ⇒ **selftest 报 6 FAIL 且负控报 7 FAIL** ⇒ 两处控都**真的测到了它**（不是空转）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· ★ **两条读数行双双进日志**（`routes=68 violations=0` + `local=34 bridge=41 total=75 unsupported=81`）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。★ 收尾时 `audit-selftest-claims.mjs` **当场报出 5 处**未同步的分数声明 ⇒ 同步后回绿。★ 期间 `audit-build-path-parity.py` 判据五**第九次当场抓到编辑 `.ps1` 剥掉 BOM**（R22④ 护栏正常工作）。 |
| **★ 契约条款：补充（P-60 的两条推论）** | **⒃ 「会增长的读数」必须按语义枚举受守面，且豁免要按语义分流**。★★ 两条推论：⑴ **同一族的读数几乎不会只出现在一处** —— W57 在 `GOAL.md` 找到，W58 在 `README.md` 又找到两个 ⇒ **修完一处必须问「同一语义还写在别处吗」**（**P-58** 从「区段」推广到「文档」）；⑵ **豁免不能一刀切** —— 「写死数字=坏」若一刀切，会把 `tavern_events` 82 项这种**有机器守的冻结面**报成错的 ⇒ 判据要问「**这个数字有没有人在守**」，而不是「**它是不是具体数字**」。 |

### 附录四续四十四：第四十九轮 W59 —— **同一族的读数在第 3、4 份文档里也过期了**（P-60 推论一）

> 起点：接 W58 结语「**同一族的读数几乎不会只出现在一处**」，做**全仓穷举**
> （**P-38 第二段**：`docs/` 全量 + 根目录 md，共 **97 个文件**）。

| 项 | 内容 |
|---|---|
| **W59 · ★★ 真缺陷（两处，落在最该准的地方）** | `docs/V0.3-FREEZE.md`（**对外承诺口径的冻结文档**）写「**71 个 API（28 本地 + 43 桥接）**」与「**约 50 项已记名 stub**」，而实测 **本地 34 + 桥接 41 = 75**、`TH_UNSUPPORTED_APIS` **81 项** ⇒ **两处都过期**；另在 `TASK-LIST.md` T-28 抓到同族第 3 处。★ **为什么这一段最要紧**：README 是「介绍」，而 **V0.3-FREEZE 是「承诺」** —— 读者按它判断「**哪些算 bug / 哪些不算**」。 |
| **W59 · ★ 逐条分诊（P-38 第三段）** | 全仓命中 **11 处**：**2 处真缺陷** + **1 处工单描述**；其余 **8 处是正当历史记录**（审计报告当时读数 / 记账行的说明语境 / 历史对照表）⇒ **不报红**（过宽 ⇒ 训练人忽略报警）。 |
| **W59 · 修法（P-58 纪律②：受守面按语义枚举成表）** | 受守面从「GOAL + README」做成**显式文档表 `READING_DOCS`**（新增 `docs/V0.3-FREEZE.md` + `TASK-LIST.md`）—— 与 W53 的 `SCAN_SECTIONS` **同法**；配套加 **`--freeze` / `--tasklist`** 让**负控覆盖新面**（**P-1**）。 |
| **W59 · ★ 判据形态的漏网（P-45）** | 原判据只认 `N 项记名 stub`，而实际写法是「**约 50 项已记名 stub**」⇒ 结构上漏掉 ⇒ 收窄口径覆盖三种写法。 |
| **W59 · 机器化与承重** | selftest **46/46 → 52/52** · 负控 **19/19 → 22/22**（新增 **H** / **杠杆H**）；★★ **承重实验** ⇒ **selftest 8 FAIL 且负控 9 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· 两条读数行双双进日志 · sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（受守面与负控面必须同步扩）** | **⒄ 凡扩一个「受守文档面」，必须同时扩对应的「负控注入面」**。★★ 理由：**没有负控的受守面 = 永远测不到的死判据**（**P-59 纪律②**）—— 它会在报告里显示「0 违规」，而那与「根本没检查」**输出完全相同**（**P-30**）。★ 配套：**受守面按语义枚举成显式表**（如 `READING_DOCS` / `SCAN_SECTIONS`），新增一项**只需加一行**。 |

---

### 附录四续四十五：第五十轮 W60 —— **「正确但无人守」的读数：B10 里与「路由 N 条」并列的 `slots 42 个`**（P-60 推论二）

> 起点：接 W59 结语「受守面每扩一次都要同时扩负控面」。
> ★ 本轮问的是 **`§六 B10` 那一行里的另一半** —— W57 守住了「路由 N 条」，
> 而**同一行里并列的 `slots 42 个`** 从来没被任何机器核过。

| 项 | 内容 |
|---|---|
| **W60 · 取证** | 权威来源 = `rp-workspace/contracts/<ver>/slots.json`（`total` 字段 + `slots` 数组），实测 **`total=42` / 数组 42 项** ⇒ 与文档声明**一致**（42 = 42）⇒ **数是对的**。★ 但它**从未被任何常驻机器核过** —— 全仓只有**手工 CLI**（`capture-contracts.mjs` / `diff-contracts.mjs`）读这份快照 ⇒ **P-11 元级**（声明为契约、实质无人核）。 |
| **W60 · ★★ 核心分辨（P-60 推论二）** | W57~W59 抓的是「**数错了**」；本轮抓到的是「**数是对的、但没有人守着它**」。**这是两种不同的缺陷**：前者的修法是「改成读数形态」，**后者的修法恰恰相反 —— 保留具体数字，给它装机器守**（一不符即报红）。★ **识别特征**：「读数与已知事实一致」**不能**证明「它有判据力」—— 没有本轮排查，这 42 会一直「看起来对」直到某天官方改了 slot 数（**P-30**）。 |
| **W60 · 修法（按 P-1 扩既有闸门，不新建脚本）** | 扩 `audit-baseline-claims.mjs` 新增 `slotCountProblems(text, slotsJsonPath)`：抽快照权威读数（先 `total`，缺失则退回数组长度）→ 与文档声明比对。三条纪律：① **快照缺失 ⇒ 只出声不报红**（**P-43**）；② ★ **快照自身 `total` ≠ 数组长度 ⇒ 报红**（快照的自洽问题，属真缺陷）；③ ★★ **快照目录名必须自动发现**（`findSlotsSnapshot`，按 `manifest.json.capturedAt` 降序）—— 目录名是**官方包版本号**（`0.1.0-rc.7`），**写死会在下一次官方升级后静默失效**（**P-30**）。 |
| **W60 · ★★ 实测逼出的口径缺陷（P-45）** | 首版按**整行**排除说明语境，而 **B10 是长表格行**：行内**前半句**讲的是**路由**的历史（`…原文写死「路由 67 条」…`）⇒ **整行被豁免** ⇒ `slots 42 个` 根本没被抽到 ⇒ 闸门自己报「本判据**未生效**」。★ 这与 **W51** 的「窗口跨句读边界 ⇒ 反而把真违规豁免」**同源**，是它**换了个方向**的第二次现身 ⇒ 改为**紧贴命中片段前后各 12 字**判说明语境，且**同一行内继续找后续匹配**。 |
| **W60 · 机器化与承重** | selftest **52/52 → 63/63** · 负控 **22/22 → 25/25**（新增 **I** / **杠杆I**）；★★ **承重实验**（短路主比对分支）⇒ **selftest 报 4 FAIL 且负控报 2 FAIL**（**P-59 纪律③**）。 |
| **W60 · ★ P-60 纪律②落地** | 把本闸门的**契约面读数行**（`[契约] slot 数核对：声明=42 实测=42 …`）**回显进构建日志** —— 该闸门跑在 **Step 0.55 组**（调用是 `| Out-Null`），**不在** Step 0.5 的 `$readingGates` 循环扫描面上 ⇒ 不回显的话，一旦脱钩**日志里没有任何痕迹**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· 读数行 `[契约] slot 数核对：声明=42 实测=42` 进日志 · sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（对外契约里的读数必须逐个装守）** | **⒅ 「同一个区段里的两个读数」必须逐个清点是否都有守** —— **B10 的「路由 N 条」（W57 已守）与「slots 42 个」（W60 才守）同处一行**，只按行排查会**漏掉一半**。★★ 且：**数对了不等于有判据力**（**P-30**）—— 「正确但无人守」与「过期」**是两种缺陷、修法相反**（前者的修法**不是**改成模糊表述，那会**削弱对外契约**；而是**保留具体数字 + 装机器守**）。★ 配套：**守别人的装置，指向外部世界的路径不得写死**（快照目录名 = 官方版本号，必须**自动发现**）；**被守对象的自洽性也要一起守**（快照 `total` ≠ 数组长度时先报快照的错，**P-46**）。 |

---

### 附录四续四十六：第五十二轮 W62 —— **「读数进日志」长成了三套平行实现，而记账里还写着「只许一处」**（P-62）

> 起点：接 W60/W61 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**闸门输出了读数行，而构建脚本真的把它回显进日志吗？**」
> （W57 造了机制、W58 做成表、W60 加了第二处，**从没人问过「覆盖面到底有多大」**。）

| 项 | 内容 |
|---|---|
| **W62 · ★★ 真缺陷（系统性，非单点）** | `build-dsht.ps1` 里「把关键读数行回显进构建日志」有**三套互不相通的实现**：① Step 0.5 循环**内嵌**的 `$readingGates` 表（覆盖面**只及该循环**）；② Step 0.55 第十一组**硬编码的一段** —— 而它的注释白纸黑字写着「与 `$readingGates` 表**同法**（**P-1**：读数机制只许一处实现形态）」⇒ **声明与实现不符**；③ 干脆不处理、靠「不过滤 stdout」。★ 取证（全仓穷举 + 日志对账）：**21 个构建期闸门会打印读数行，而 `w61b-build-x64.log` 里只出现了 3 条**。 |
| **W62 · ★★ 后果（与 W57 同形）** | 其中一类**直接对应 §3.1/§3.2 里写死的数字**却**零观测面**：`TARGETS 9 项`（A11）· `17 marker / 11 项 / ps1 13 处 + python 20 处 / 自动发现 4 个`（构建路径等价性）· `实读 7 条「产物→entry」`（A14）· `审计 23 个会话`（会话完整性）· `受检闸门 38 个`（自证分数）· `声明有机器守 N 条`（P-58）—— **P-30**：读数进日志与根本没产生，在报告上完全同貌。 |
| **W62 · 修法（按 P-1：提升为唯一实现点）** | `$readingGates` 从「循环内局部表」提升为**全脚本一级登记表**（`@{ Exe; Pattern; Label }`，支持 `node` / `python`）+ 新函数 **`Show-Reading -Gate <名> -Path <路径>`**；Step 0.5 循环、Step 0.5 的 `.py` 闸门、Step 0.55 各组、Step 5.4 **全部改调该函数**。★ 登记口径（守 P-38）**只收「对应文档里的数字」的关键读数**；并**显式登记两条诚实边界**（R7）：`audit-session-integrity.mjs` / `audit-script-semantics-parity.mjs` **不登记**（构建期读数**根本不产生**）。 |
| **W62 · ★★ 决定性证据** | **3 条 → 17 条读数行**（同一构建命令，`w61b` vs `w62` 日志）。新增含 `[A11] 受检目标 9 个` · `ps1 marker 18 / python 17 / 共同 17` · `Dsht-Patch 13 处` · `python patch() 20 处` · `自动发现 4 个` · `[开放项] 142 行` · `[工作面表] 合计 66 行` · `[自证分数] 受检闸门 38 个 / 文档声明 67 条` · `[基线] §3.1 声明：门禁=48 sentinel=v363 P判据=61 · 真值：…` · `[文档引用] 扫描 5 份` · `[纪律声明] §七 23 条 / §九 61 条` · `[A14] 实读 7 条`。 |
| **W62 · ★ 新机制当场带来真发现** | 日志首次暴露 `ps1 marker **18** / python **17** / 共同 **17**` —— 逐条核对 `EXEMPT` 后确认是 3 条**已注明理由的单侧豁免**（`DSHT-SIM` / `DSHT-RESILIENT-LIST` / `DSHT-RESILIENT-IMPORT`，均因「python 路径已弃用」）⇒ **文档写「17 marker」指的是共同数，正确**。★ **读数行的价值正是「把 18/17/17 完整摆出来」**，读者不必再猜「17 是哪个口径」。 |
| **W62 · 机器化（守「登记 ≠ 接线」）** | `audit-selftest-claims.mjs` 新增 `readingWiringProblems`：**判据①登记即须接线**（表里登记 X ⇒ 构建脚本里必须真有 `Show-Reading -Gate 'X'`）· **判据②接线即须在受检面**（`-Gate` 指向的不是构建期闸门 ⇒ 报红）。selftest **28/28 → 36/36**（+8 条控）。 |
| **W62 · ★ 三处口径由实测逼出（全是假红/假绿）** | ① **循环内的变量实参**（`foreach ($a in $auditNode) { … Show-Reading -Gate $a }`）—— 字面量正则看不到 `$a` ⇒ 首版把 3 个**真的已接线**的闸门判成空声明（**假红**）⇒ 改为**展开循环变量**（括号配平抽数组 + 只收顶格条目）；② **登记表行本身含 `)` 与单引号** ⇒ 非贪婪 `\)` 在**注释里**提前收尾 ⇒ 漏掉该闸门 ⇒ 误报（**P-29 的第二次现身**）；③ **`existsFn` 不可省**（只查「名字像 `audit-*.mjs`」⇒ 幽灵名照样匹配 ⇒ **假绿**）。 |
| **W62 · 承重实验（P-59 纪律③）** | 短路 `readingWiringProblems` ⇒ **selftest 报 2 FAIL**（登记表 11 条全被判空声明）⇒ 新判据有杠杆。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· ★ **17 条读数行进日志**（修前 3 条）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（机制形态的自我声明也要有守）** | **⒆ 凡在注释/文档里声明「本机制已收成一处（P-1）」，必须同时有一条判据守「它现在仍是一处」**。★★ 理由：「**同一语义只许一处实现**」是**动作**，而「它**现在**确实是一处」是**状态**；**动作做完了 ≠ 状态一直成立** —— 后续改动会**悄悄把一处变回两处**，而**两者在报告上完全同貌**（**P-30**）。★ 配套三条：⑴ 判据须同时守「**登记 ⇒ 已接线**」与「**接线 ⇒ 在受检面**」（只守一半会让另一半静默失效）；⑵ **收窄登记面必须写出「为什么不登记」**（R7 诚实边界：构建期根本不产生的读数，登记了只会得到「永远取不到」的噪音）；⑶ **凡「按写法」写的判据，其正则必须实测真实仓库的排版形态**（本轮连踩三处：变量实参 / 表行含 `)` / 幽灵名）。 |

---

### 附录四续四十七：第五十三轮 W63 —— **头注声明的「诚实边界」里有两条是空的**（P-63）

> 起点：接 W62 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**闸门头注里声明的『诚实边界』，实现里真的是那样吗？**」

| 项 | 内容 |
|---|---|
| **W63 · ★★ 真缺陷 ⑴（判据从不被喂输入）** | `audit-baseline-claims.mjs` 的**判据 ④（M4 项数）从不生效** —— `compareClaims` 里**一直有**这条实现（传坏值会报红、selftest 也有 M4 正负控），而**主流程硬编码传 `{ pCount, m4: null }`** ⇒ 该判据**从未被喂过输入**。★★ **决定性实验**（`tmp/w63-decisive.mjs`）：① **正控**（门禁条数 48→45）⇒ **exit=1 报红**；② **实验组**（§3.1 的 M4 `169 → 142`）⇒ **exit=0 不报红** ⇒ **该数字没有任何机器守着**。★ 而真值**本来就在构建日志里**（Step 6.6 的 `=> 核验 N 项，缺失 M 项`，W62 起该脚本输出直接进日志）—— **不是查不到，是没人去读**。 |
| **W63 · ★★ 真缺陷 ⑵（断言根本不存在）** | 头注写「对 vitest / typecheck / M7 **只做「形态断言」**（数字存在且量级合理）」—— 而**实现里没有任何一行**在做该断言（`grep 形态断言` = 0 命中）⇒ **声明与实现不符**（**P-59 纪律①**）。★ 修法选择**如实改写为「完全不看」**：那种断言在「**0 失败**」这类事实面前**毫无判据力**（**P-43**），补一个空壳断言**比不写更坏**（制造「纳入了核验」的假象）。 |
| **W63 · 修法** | ① `readBuildLogTruth` 新增抽 M4 读数行（**与 gates/sentinel 同源同法**，守 P-1）；② 主流程把 `m4` 真值接进 `compareClaims`，并**统一为单向口径**（与 gates **同纪律**：构建期「声明 > 实测」只出声 —— 本轮新增标记是正常事，报红即假红，正是 W45 在 gates 上踩过的坑）；③ 头注如实改写（附 **P-61** 的「收窄必须留下记录」）。 |
| **W63 · ★★ 承重实验（最重要的副产物）** | 短路接线（`m4Truth` → `null`）⇒ **负控 J 报 2 FAIL，而纯函数层 selftest 仍 73/73 全绿** ⇒ ★★ **纯函数层的正负控测不到「主流程没接线」**（**这正是本条缺陷能长期存在的原因**）⇒ 补一条「**接线存在性**」控（断言源码里真的传了该真值）后才闭合（短路该控 ⇒ selftest 报 1 FAIL）。 |
| **W63 · 机器化** | selftest **65/65 → 75/75**（新增：M4 真值抽取正控 / 无读数行零控 / 多包取保守值 / M4 过期负控 / M4 一致正控 / 单向零控 + 反证 / 双向反证 + ★★ **2 条承重控**）；负控 **25/25 → 28/28**（新增 **J** M4 过期 / **杠杆J**）。 |
| **W63 · ★ 新机制当场再抓一处** | `Show-Reading` 登记表里我一度把 `verify-apk-payload.py`（M4 读数行）也登记进去 —— **P-62 判据①「登记即须接线」当场报红**（该脚本输出本就进日志、无需回显）⇒ 按 **P-61**（收窄要留记录）**改写为「不登记」并写明理由**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· 读数行进日志（含新纳入的 `M4=169/0 · 真值 … M4=169/0`）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。★ 收尾时判据体系多次咬合（`audit-goal-sections` 报「§九 缺 P-63 定义/索引」、`audit-selftest-claims` 报 12 处分数过期、`audit-build-path-parity.py` 判据五**当场抓到编辑 `.ps1` 剥掉 BOM**）⇒ 逐处同步后回绿。 |
| **★ 契约条款：补充（「不生效的判据」也是一种缺陷）** | **⒇ 判据的「实现存在」与「实现被喂了输入」是两件事** —— **「函数里写了这条分支」≠「那条分支会被跑到」**。★★ 识别特征：实现**完全正确**（传坏值会报红、有正负控），而**调用方传 `null` / 常量 / 空集合** ⇒ 那条分支**永远不执行**，报告上与「全都核过」**完全同貌**（**P-30**）。★ 配套三条：⑴ **排查「判据不生效」必须问「它被喂了什么输入」**，而不只是「它有没有实现」—— 「有分支」是**静态事实**，「分支会跑到」是**动态事实**，后者只能由「**改坏输入看会不会红**」证明；⑵ ★★ **纯函数层的正负控测不到「主流程没接线」** ⇒ 必须补「**接线存在性**」控（断言源码里真的传了该真值），与负控**互补**；⑶ ★★ **「诚实地不核」必须写成「完全不看」**，不得写成「只做形态断言」（后者让读者以为有一层轻薄但存在的检验，而实际一行都没有 —— **P-43**）。 |

---

### 附录四续四十八：第五十四轮 W64 —— **豁免的依据指向了一个「从不运行的装置」**（P-64）

> 起点：接 W63 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**判据里那些『允许写死』的豁免，它的依据真的成立吗？**」

| 项 | 内容 |
|---|---|
| **W64 · 分诊（P-38 三段式）** | 全仓 **14 个** `*negctl*` 脚本（构建期只调用 10 个）逐个分诊 ⇒ `audit-device-runtime-negctl.mjs`（需 adb）与 `audit-rp-parser-negctl.mjs` **均非缺陷**（已登记 §11.4 **N10**）；换方向穷举「**有 `--selftest` 但构建期零引用**」⇒ 命中 **3 个** `audit-card-*-surface.mjs`。 |
| **W64 · ★★ 真缺陷（四处同源声明）** | `docs/V0.3-FREEZE.md` / `README.md` / 方法论 §5.4 / `audit-baseline-claims.mjs` **头注**都写着「`tavern_events` **82 项** ★ **有机器守**：**`audit-card-event-surface.mjs` 断言 `=== 82`**」—— ★★ 而该脚本**在构建期零引用**（`build-dsht.ps1` 里 `grep` = **0 命中**），且那句断言写在它的 **`--selftest` 分支**里 ⇒ **从不执行**。**真正守 82 的是 vitest 规格** `packages/tests/th-script-runtime.spec.ts`（`expect(Object.keys(TAVERN_EVENTS)).toHaveLength(82)`，随 `npm run test` 跑）。 |
| **W64 · 后果（为什么这是真缺陷，不是笔误）** | 判据 `growthReadingHardcodeProblems` 的 `READ_OK` 把「**由 X 断言**」当作**豁免依据** ⇒ 「**写死数字**」这一违规形态**被一个假前提放行**：只要在行内点一个**装置名**，不论它跑不跑，都能过。⇒ 与 W57「路由 67 条」**同形**（**P-30**：豁免成功与被有效守卫，在报告上完全同貌）。 |
| **W64 · 修法（P-56 / P-63 的落地）** | ① 豁免**拆两类、判法不同**：**自足读数词**（「以脚本输出为准 / 当前实测 / 见 §3.2」）**自身就够**；**装置声明词**（「有机器守 / 由 X 断言」）**必须**点名到**能跑到的通路**（构建期闸门 —— 且**名字真的出现在构建脚本里** —— **或**显式点名 vitest / 规格）；② 新增 `hasRunnableGuard(line, gateNames)`，`gateNames` 由**每次运行实读** `build-dsht.ps1` 得出（**P-27**）；③ 四处文档的守卫依据**改为 vitest 规格**。 |
| **W64 · 机器化与承重** | selftest **75/75 → 79/79**（新增 5 条控：规格通路零控 / 构建期闸门通路零控 / **装置不在跑 ⇒ 不豁免** 负控 / 杠杆 / 自足读数词正控 —— ★ **改写**了 W58 那条把「假绿」写成期望值的零控）+ 负控 **28/28 → 31/31**（新增 **K** / **杠杆K**）；★★ **承重实验**：短路 `SPEC_HINT` ⇒ **selftest 报 2 FAIL**。 |
| **W64 · ★ 负控首版空转（当场被自己抓到，P-30）** | 注入文本写成「`tavern_events` **82 项**全表」—— 而判据的 forms 是 `N 个 API` / `N 项 stub`（`项` 后须跟 `stub`）⇒ **不命中** ⇒ 负控 `[]` 恒真、**空转**；改用 `71 个 API` 注入才真正报红。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（豁免依据必须能被判定成立）** | **㉑ 凡判据要把某条声明「豁免」掉，豁免的**理由**本身必须可判定「它成立吗」**；而**最容易出错的理由形态**是「**有机器守：由 X 断言**」—— 它**只给装置名、不给通路**。★★ 识别特征：文档/头注写着「★ 有机器守：由 `` `audit-xxx.mjs` `` 断言 `=== N`」，而那个脚本**在构建期零引用**（`grep` = 0 命中）、那句断言写在 `--selftest` 分支里 ⇒ **从不执行** ⇒ 豁免**建立在假前提上**，报告上**与「数字真被守着」完全同貌**（**P-30**）。★ 配套三条：⑴ ★★ **豁免必须分两类处置** —— **自足读数词**「自身就够」，**装置声明词**「必须点名到能跑到的通路」（构建期闸门且**名字真的在构建脚本里**，**或**显式点名 vitest / 规格）；⑵ ★★ **「装置在不在跑」必须实读构建脚本判，不能靠装置名判**（写死名单会**过期**，**P-27**；点名了却在名单外 ⇒ **不豁免**，守 **P-56 / P-63**）；⑶ ★★ **判据松紧的每一次变化，都必须补「变化点」的负控**（**P-59 纪律③**）。★ 与 **P-56** 的关系：P-56 管**文档里的声明**，本条管**判据代码里的豁免分支** —— 同一纪律在「判据自身」上的落地（**P-61~P-64 是同一母题的连续四次现身**：「**声明有守** ≠ **真的有守**」）。 |

---

### 附录四续四十九：第五十五轮 W65 —— **受守面清单声称是「单源」，而那句声称没有任何机器守**（P-65）

> 起点：接 W64 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**判据的『扫描面清单』自身有守吗？新增文档/区段后会被自动纳入吗？**」

| 项 | 内容 |
|---|---|
| **W65 · 手法（P-38 三段式）** | ① 不变量 = 「代码里有**硬编码清单**（受守面/扫描面/白名单），而注释**声称**它是与某处同源的**单源**」；② 全仓穷举（`scripts/*.mjs\|py`，「单源/同名单/同源/SSOT」声称附近 ±12 行内有硬编码数组且含 ≥2 个字面量条目）⇒ **5 处候选**；③ 逐条分诊。★ 结果：**只有 1 处是真缺陷**（其余 4 处：「单源」二字出现在**字符串内容**里 / 抽样偏好表**不是**同源声称 / 同一数组被重复扫到）⇒ 按 **P-38** 逐一排除。 |
| **W65 · ★★ 真缺陷** | `audit-doc-refs.mjs` 的 `E_H_DOCS` 注释写着「**单源：与 GOAL §八 E-H 同名单**」，而**这句声称没有任何机器守着**；实现里它是**手写字面量数组** ⇒ 与 GOAL 的名单**可以静默分叉**。 |
| **W65 · ★★ 决定性实验（两侧都是 exit=0，即全不报红）** | ⑴ **GOAL 侧改名单**（把 §八 E-H 里的 `docs/MOBILE-TEST-METHODOLOGY.md` 换成**另一份真实存在**的文档）⇒ `audit-doc-refs` / `audit-baseline-claims` / `audit-goal-sections` / `audit-rule-claims` **四个闸门全部 exit=0**。★ **方法学陷阱（当场踩到）**：首版换成**不存在**的文档 ⇒ exit=1，但那是**「悬空位置声明」判据**接住的 ⇒ **测到的是别的判据**（**P-45**），必须换成**真实存在**的文档才能隔离出「名单分叉」这一条。⑵ **代码侧删一份** ⇒ 仍报 `扫描 4 份（E-H 四份 + SSOT）` 且输出 `OK` —— ★★ **读数行自己当场自相矛盾而闸门报绿**（**P-30**）。 |
| **W65 · 修法（P-1：扩既有闸门，不新建脚本）** | `audit-doc-refs.mjs` 新增纯函数 `scanFaceSotProblems(goalText, eHDocIds)` + 判据 **⑥**（接入主流程，在「扫描面为 0」的 fail-closed 之后）。★ GOAL 文本来源与主循环**同源**：`--file` 传的是 GOAL 副本就用它（**这样负控才能对 GOAL 侧注入**）。 |
| **W65 · 机器化与承重** | selftest **41/41 → 49/49**（正控 1 / 负控 2 / 零控 4 / 真实仓库 1）+ 负控 **18/18 → 23/23**（新增 **G** GOAL 侧改名单 / **G2** 代码侧删一份 / **杠杆G2**）。★★ **承重验证**：两侧注入 ⇒ **都报红且理由正确**，改回 ⇒ **都回绿**；★ **G2 的杠杆**特别重要 —— 它证明「代码侧删一份」的报红**不是恒定红**。 |
| **W65 · ★ 两条口径由实测逼出（都是防假红，P-38）** | ⑴ **SSOT 不参与 E-H 比对** —— GOAL §八 E-H 原文只点名「四份」，而 `SSOT_DOCS`（`GOAL.md` 自己）是 **W49 主动多守** ⇒ 若把「代码有而 GOAL 无」一律报红，会**把「主动多守」判成缺陷**；⑵ **路径必须归一化** —— `docs/X.md` 与 `X.md` 是**同一份文档** ⇒ 不做归一化会**陪跑一堆假红**。★ **切面失效必须 fail-closed**：读不到 §八 E-H 行 / 任一侧名单为空 ⇒ **报红**，不许当 0 违规（**P-30**）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（「声称单源」必须被机器守）** | **㉒ 凡代码里的硬编码清单在注释中声称「单源：与 X 同名单」，必须有一条判据问「它现在真的同源吗」。** ★★ 理由：「声称单源」是一句**可判定的断言**，而**它自己不会被任何判据守** ⇒ 两份清单**可以静默分叉**（一边加项、另一边没加），而**报告上完全同貌**（**P-30**）；该声称**在写下的一刻就开始过期**（**P-27**）。★ 配套三条：⑴ ★★ **比对必须双向** —— 「A 有而 B 无」（漏守）与「B 有而 A 无」（超守未声明）是**两类不同的分叉**，只守一侧留下半个盲区；⑵ ★★ **新增判据必须同步两侧负控**（**P-59 纪律③**）—— 两侧**注入方向相反**，只做一侧等于半个判据没有杠杆；⑶ ★★ **切面失效必须 fail-closed**（读不到声称源头 / 任一侧名单为空 ⇒ 报红，不许当 0 违规）。★ 与 **P-58** 的差别（**结论相反**）：P-58 是「同一语义写在两个区段 ⇒ **多处都要守**」；本条是「同一清单被声明为单源、而它其实有两份 ⇒ **只许一处，且要守它确实是一处**」。★ 与 **P-62** 同族：P-62 管「我已把**机制**收成一处」，本条管「我已把**清单**收成一处」。 |

---

### 附录四续五十一：第五十六轮 W66 —— **读数有观测面 ≠ 有人在读它**（P-66）

> 起点：接 W65 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W62 把读数接进日志之后，有人拿它与文档里写死的那个数字对账吗？**」

| 项 | 内容 |
|---|---|
| **W66 · 由头（顺着上轮的机制往下问）** | W62 把「读数回显」收成唯一实现点（`Show-Reading`），读数行 **3 → 12 条** —— **接线确实做完了**。★ 正因机制「看起来完善」，才更易误以为「这件事已守住」⇒ 本轮问**它的下游**：「**有人读它吗？**」 |
| **W66 · ★★ 真缺陷（一个都没有）** | ★★ **决定性实验**：把 §3.1 的 `TARGETS **9 项**` 改成 `99 项` · A14 行的「实读 **7** 条」改成「实读 3 条」·「扫描 **5** 份」改成 2 份 ·「受检闸门 **38** 个」改成 12 个 ⇒ 逐个跑 **5 个闸门** ⇒ **一个都不报红**。★ **取证**：`audit-doc-refs` 有一次报红，但传 `--as GOAL.md` 后 **exit=0** ⇒ 那是**负控未传身份**的副作用，**不是**这条判据在守（**P-45**：别把「别的判据接住」当成「本条判据有效」）。 |
| **W66 · 为什么藏得住（P-30）** | 日志里**明明有**读数行（`grep` 得到 12 条）⇒ 读者扫日志会认为「这些数字有人在守」。而实际上：**读数是观测面，不是判据** —— 两者**报告形态完全同貌**。★ 与 **W57**（读数**根本没进日志**）相比，本条**更隐蔽**。 |
| **W66 · 修法（P-1：扩既有闸门，不新建脚本）** | `audit-baseline-claims.mjs` 新增 `readReadingValues`（从日志抽 4 条关键读数）+ `readingVsDocProblems`（与文档写死数字对账），做成**显式配对表** `READING_PAIRS` / `DOC_PAIRS`（**不靠猜**，**P-45**）；真值来源与既有 gates/sentinel/M4 **同源**（`picked` 的完整日志文本）。 |
| **W66 · 机器化与承重** | selftest **79/79 → 88/88**（新增 9 条控：读数抽取正控 / 无读数零控 / 文档过期负控 / 一致正控 / 单向零控 / 无读数零控 / **说明语境零控** / **史实区零控** / **接线存在性承重控**）+ 负控 **31/31 → 34/34**（新增 **L** / **杠杆L**）。★★ **承重验证**：文档 3 项（< 实测 9）⇒ **报红**；文档 99 项（> 实测 9）⇒ **回绿**；真实仓库 ⇒ **0 违规**。 |
| **W66 · ★ 三条口径由实测逼出（都是防假红）** | ⑴ **只比对「两侧都取到」的项**（日志没这条读数 ⇒ 只出声；文档没写 ⇒ 不比对）；⑵ ★★ **必须遍历全文找合格声明，不能只取首个匹配** —— 实测 `/扫描\s*(\d+)\s*份/` 的**首个**匹配落在「仍报 `扫描 4 份…`」这句**引述修前状态**的叙述里 ⇒ 拿旧值比对 ⇒ **永远报红**（**P-41**）⇒ 逐个匹配分诊 + **说明语境按紧贴 ±30 字排除**（**不整行判** —— 整行判会把同一长行里的真缺陷一起豁免，W51/W60 同形坑，**P-45**）；⑶ **史实区不参与**（§十一 里的 `TARGETS 9 项` 是记账）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。★ 收尾时 `audit-selftest-claims.mjs` **当场报出 9 处**未同步的分数声明（含 **`build-dsht.ps1` 的 gate 文案** —— **W65 新建的第三受守面当场发挥作用**）⇒ 逐处同步后回绿。 |
| **★ 契约条款：补充（观测面 ≠ 判据）** | **㉓ 凡「把 X 摆出来」的机制（读数行进日志 / 指标落盘 / 中间产物留痕），必须配一条「读 X 的判据」。** ★★ 理由：**「接线做完了」与「消费做完了」是两件事** —— 摆出来只**造出观测面**；若**没有任何判据去读它**，它与被守对象之间**照样可以静默脱钩**（**P-30**），而**报告上完全同貌**（都「有」，都「绿」）。★ **检验手法**：**把被守数字改坏，看有没有任何闸门报红** —— 若没有，说明「摆了但没人读」。★ 配套三条：⑴ ★★ **配对必须显式登记**（做成 `READING_PAIRS` / `DOC_PAIRS` 表；近似匹配会在措辞变化时**静默失效**，**P-45**）；⑵ ★★ **只比对「两侧都取到」的项**（日志没这条读数 ⇒ 只出声，**P-43**；文档没写 ⇒ 不比对）；⑶ ★★ **方向与既有纪律一致（单向）**：文档 > 实测 **只出声**、文档 < 实测 **报红**（**P-27**）。★ 与 **P-62** 配成一对：**P-62 管生产侧（机制声称一处）、本条管消费侧（接线 ≠ 消费）**。 |

---

### 附录四续五十二：第五十七轮 W67 —— **豁免词表里的「常见字」比宽窗口更危险**（P-67）

> 起点：接 W66 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W66 新加的那条『说明语境排除』，它的豁免面有多宽？改坏真缺陷它吞不吞？**」

| 项 | 内容 |
|---|---|
| **W67 · 由头（顺着上轮新增的分支往下问）** | W66 给 `readingVsDocProblems` 加了「说明语境排除」，把 `曾 / 旧 / 当时 / W\d+修` 等词收进 **±30 字窗口**。★ 本轮问的是**这条排除分支的误伤面**：「**豁免词在场时，真缺陷还报得出来吗？**」 |
| **W67 · ★★ 真缺陷（4 个攻击样本全部静默放过）** | ★★ **决定性实验**：把 `TARGETS **9 项**` 改小成 `3 项`（**真缺陷**），**同一行**塞入豁免词 ⇒ ①「曾按 12 项统计」②「旧版为 12 项」③「（当时为 12 项）」④「★ W57 修：原文写死 12 项」 ⇒ ★★ **4 个样本 `problems=0`**（全部静默放过），而闸门照样报 `OK`（**P-30**）。 |
| **W67 · ★ 为什么它最危险（与 P-38 方向相反）** | **纯说明语境**（「仍报 `扫描 4 份…`」+ 下一行「当前：扫描 **5** 份」）返回 0 是**对的**；而**真缺陷**返回 0 是**错的** —— ★★ **两种语义完全不同的输入给出同一个读数** ⇒ 判据**事实上已失效**而报告全绿。★ **P-38** 是「把对的报成错的」（假红，会被人发现）；**本条是「把错的放成对的」**（静默放过，**不会**被发现）。 |
| **W67 · 根因：不是「窗口宽」，是「词表含高频字」** | **收窄窗口（±80 → ±30）完全不能缓解** —— `曾 / 旧 / 当时` 这类**日常高频字**本来就常出现在**紧贴位置**。★ 与 W60/W51 的关系：那两轮讲「窗口必须紧贴命中片段、不得整行判」；**本条指出紧贴还不够**（**同一纪律第三次现身，换了成因**）。 |
| **W67 · 修法（两条一起改，缺一不可）** | ⑴ **窗口改为「紧贴被豁免的那个数字」**（**前 12 / 后 6 字**，只够容纳「仍报 `扫描 」这种直接修饰）；⑵ **词表收窄为六个「引述旧值」专用措辞**（`仍报 / 修前 / 原文写死 / 原本写 / 引述 / 据称`），**删掉所有日常高频字**。 |
| **W67 · 机器化与承重** | selftest **88/88 → 90/90**（新增 2 条**成对**控：4 个攻击样本必须报红 / 真说明语境必须豁免）+ 负控 **34/34 → 37/37**（新增 **M** / **杠杆M**）。★★ **承重实验**：短路修法（改回 ±30 宽窗口 + 宽词表）⇒ **selftest 报 1 FAIL**（攻击样本 4/4 未被报红）。★ 实测发现：**「豁免词在场 + 真缺陷」这一格此前完全没有控**（判据有正控也有负控，但没有「两者叠加」那一格）。 |
| **W67 · ★ 三条纪律由实测逼出** | ⑴ **豁免词表只许收「与判据结论直接相关的措辞」**，不得收日常行文高频字；⑵ ★★ **豁免窗口必须紧贴「被豁免的那个数字」**（不得是「命中片段附近 ±N 字」—— 那是**整行判**的变体）；⑶ ★★ **凡判据含「排除/豁免/跳过」分支，必须补一组「豁免词在场 + 真缺陷 ⇒ 必须报红」的攻击样本控**（**P-20 的机器化形态**）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（豁免面必须被攻击）** | **㉔ 凡判据含「排除 / 豁免 / 跳过」分支，必须补一组「豁免词在场 + 真缺陷」的攻击样本控。** ★★ 理由：豁免分支的**误伤面**（把真缺陷一起放过）在**默认控**下**整片无人测** —— 判据通常有「说明语境 ⇒ 豁免」的正控、也有「真缺陷 ⇒ 报红」的负控，**却没有「两者叠加」那一格**（**P-20 的机器化形态**）。★★ 与 **P-38** 方向相反：P-38 是「把对的报成错的」（**假红**，会被人发现）；**本条是「把错的放成对的」**（**静默放过**，不会被人发现）⇒ **更危险**。★ 配套三条：⑴ ★★ **豁免词表只许收「与判据结论直接相关的措辞」**（`曾/旧/当时/原` 这类**日常高频字**必须剔除 —— 它们**本来就常出现在紧贴位置**，收窄窗口**完全不能缓解**）；⑵ ★★ **豁免窗口必须紧贴「被豁免的那个对象」**，不得是「命中片段附近 ±N 字」（后者是**整行判**的变体）；⑶ ★★ **控必须成对**（攻击样本 ⇄ 正当豁免），**只做一侧留下半个盲区**（**P-58 的两侧纪律**）。 |

---

### 附录四续五十三：第五十八轮 W68 —— **引用完整性必须扩展到「文档内部编号」**（P-68）

> 起点：接 W67 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮换的是**引用**这一面 ——「**文档里的『编号引用』，读者都能找到它的定义吗？**」

| 项 | 内容 |
|---|---|
| **W68 · 由头（P-11 元级 · 换语义不变量）** | W66/W67 两轮都在守「文档里**写死的数字**」；本轮问的是**另一种可判定性** —— **编号引用**（`Wnn` / `Nn` / `P-nn`）：**读者按它去找，找得到吗？** ★ 能被既有闸门覆盖的方向**不另写探针**（W56 纪律）。 |
| **W68 · ★★ 真缺陷定型** | 把 `§11.1~§11.3`（工作面表）与 `§11.4`（负结论表）切成两块，拿 §11.4 里出现的**全部 `W` 编号**逐个回 §11.1~§11.3 找 ⇒ ★★ **`W55` 既无独立行、也未被提及** ⇒ 读者按 §11.4 去查「W55 是什么」**必然扑空**。★ 与 **P-52**（引用完整性按「读者能否按它找到」判）**同族**，对象从「脚本/文档路径」换成「**文档内部的工作面编号**」。 |
| **W68 · 排除干扰项（逐条取证，P-38 第三段）** | `W3/W4/W5/W6/W8/W24/W27` 逐个核对：均为**子编号形态**（`W24b`/`W24c`）或**已并入其它表** ⇒ **不是缺口**；另确认「**第 N 轮 ↔ W nn**」是**两套独立编号体系**（历史上就有偏差，非缺陷）⇒ **只有 W55 是真缺口**。★ 不逐条分诊会把 7 个子编号判成 7 处缺陷（**P-38 过宽形态**）。 |
| **W68 · ★ 为什么藏得住（P-30）** | §11.4 的 **N8** 行**内容完整、结论正确**（那轮**确实只做了排查**）—— **缺陷不在内容，而在「读者无法按它回溯」**；而**任何闸门都只查内容，不查可达性**。★ 「**没守**」与「**守住了**」的搜索结果是**同一个 0 命中**。 |
| **W68 · 修法（★ 不是硬造工作面行）** | **承认「行内就地说明」为合法可达形态** —— 「只做排查、无工作面编号行」的轮次**不该为了对齐索引而硬造一行**；故 §11.4 的 N8 行**就地写明**其身份。★ 这是本条与 **P-52** 的**关键差别**：跨文件引用写错只能**改路径**；内部编号引用写错**可以改引用侧的表述**，**不必动被引用的那一侧**。 |
| **W68 · 机器化与承重** | `audit-goal-sections.mjs` 新增**判据 ⑨**（§11.4 引用可达性 + 切面失效 fail-closed），selftest **35/35 → 40/40**（5 条**成对**控）+ 负控 **20/20 → 23/23**（新增 **F** / **杠杆F**）；★★ **承重实验**：短路判据 ⑨ ⇒ **selftest 报 1 FAIL**。★ **一处口径（P-1/P-45）**：负控 **F 必须用 GOAL 副本**（§11.1~§11.4 都在 GOAL 里）—— **注入点必须落在判据真正的扫描面上**，否则测到的是别的判据（W65 踩过同坑）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（引用必须可达）** | **㉕ 文档内部的「编号式引用」必须可达，且「可达」允许多种形态。** ★★ 理由：**「文档里写了某个编号」≠「读者能按它找到」** —— **P-52** 只覆盖了**跨文件/跨路径**的引用（写错时 `fs.existsSync` 能判），而**文件内部的编号引用没有任何东西兜底**（编号写错**只有读文档的人才会撞上**），且「**没守**」与「**守住了**」的搜索结果是**同一个 0 命中**（**P-30**）。★ 配套三条：⑴ ★★ **可达形态至少三种** —— ① 在正式索引表里有**独立行**；② **在别处被提及**；③ ★ **在引用处行内就地说明其身份**（**推荐** —— 「只做排查、无工作面编号行」的轮次**不该为了对齐索引而硬造一行**；**不得强迫作者硬造结构**）。★★ 这是本条与 **P-52** 的关键差别：跨文件引用写错**只能改路径**，内部编号引用写错**可以改引用侧的表述**（**不必动被引用的那一侧**）。⑵ ★★ **判据必须对三种形态各设正控、对「不可达」设负控**（**控必须成对**，**P-58 的两侧纪律** + **P-59 纪律③**）。⑶ ★★ **注入点必须落在判据真正的扫描面上** —— 本条的受检面（§11.1~§11.4）**全在 GOAL 里**，故负控**必须用 GOAL 副本**，**不能**沿用方法论副本（否则测到的是**别的判据**，**P-45**）。 |

---

### 附录四续六十七：第七十一轮 W82 —— **数据表的路径字段必须指向真实存在的对象**（P-82）

> 起点：接 W81 结语。**W81** 给「权威构建脚本清单」装了双向对账；
> ★ 本轮按 **P-70 纪律①** 继续穷举 ⇒ 本仓 `audit-artifact-freshness.mjs` 的 `PAIRS`
> 是**数据表**，它的 `entry` / `source` / `artifact` / `builtBy` **全是手写路径** ——
> ★★ 而「**它们现在还有效吗**」**没有任何机器问**。

| 项 | 内容 |
|---|---|
| **W82 · ★★ 决定性实验（该面整类无守）** | 把 `source` 改成幽灵路径（`packages/src/lore/GHOST-safe-regex.ts`）、把 `entry` 改成幽灵路径（`src/import/GHOST-browser-entry.ts`）⇒ `audit-artifact-freshness` / `audit-selftest-claims` / `audit-baseline-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-publish-hygiene` / `audit-impl-duplication` / `audit-a14-anchor-negctl` / `audit-matrix-residuals` / `audit-rule-claims` **十个闸门全部 exit=0**（逐字节还原自证）。 |
| **W82 · ★★ 危害（不是「填错了不好看」，而是判据静默失效 —— P-30）** | ① `entry` 是 `checkPair` 的**编译输入**（`esbuild <entry> …`）⇒ 路径错了 ⇒ 编译失败 ⇒ 报「产物陈旧」**假红**（**P-38**：假红会训练人忽略报警）；② ★★ `source` 在 `skipByteCompare` 分支里**真的被读**（`srcText.includes(m) && !artText.includes(m)`）⇒ 路径错了 ⇒ `read()` 返回 `null` ⇒ 拼出**空串** ⇒ `markers` 一个都找不到 ⇒ **该分支从不报红**（**P-30**：失效与通过同貌）。 |
| **W82 · ★ 一条实测逼出的口径（P-45）** | ★ 该数据表里**两个字段两套基准** —— `entry` = **`packages/` 相对**；`source` = **`rp-workspace/` 相对**。★★ 我探针**首版按仓库根解析 `source`** ⇒ **7/7 项全部假红**（量级与真缺陷严重不符 = **P-45 识别特征**）⇒ 判据**必须各自按自己的基准解析**，★ 且**不许静默换基准**。 |
| **W82 · 修法（按 P-1 扩既有闸门）** | 新增纯函数 `pairFieldProblems(pairs, existsFn, wsRoot, repoRoot)` + 主流程**判据⑩** —— ① `entry` 必须存在（**假红形态**）；② `source` 必须存在（**静默失效形态**）；③ `builtBy` **点名的装置必须存在**（**P-62**：声明必须能被指认）；④ ★★ **`artifact` 不判存在性**（runtime 未构建时**整体缺失**，那是 `checkPair` 的职责 —— **P-45 职责边界**）。 |
| **W82 · ★★ 承重实验（三组，全部通过）** | 真仓库注入 —— `source` 幽灵 ⇒ **报 2 处 + 精确点名**；`entry` 幽灵 ⇒ **报 1 处 + 点名**；`builtBy` 点名 `GHOST-build.sh` ⇒ **报 1 处 + 点名**（**P-62**）；还原 ⇒ **回绿**（逐字节自证）。 |
| **W82 · ★ 诚实边界（R7）** | 本判据**只证「字段指向的对象存在」**，**不证**「那个对象就是该产物的真正来源」（后者是 `checkPair` **逐字节判据**的职责）。 |
| **结果** | 判据⑩ 读数行 `核对 30 个路径字段（entry = packages/ 相对 · source = rp-workspace/ 相对 · builtBy 点名的装置）· 违规 0 处` · selftest **22/22 → 32/32**（10 条 W82 控：**3 负控 + 2 正控 + 2 杠杆 + 1 口径 + 2 零控**，含真实仓库 2 条）· 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（数据表字段也是声明）** | **㊴ 数据表（如 `PAIRS`）里的每个路径字段都是一条「对象存在」的声明 ⇒ 必须有一条判据问「它现在还有效吗」；且每个字段的「解析基准」必须显式写进判据、不许静默换基准。** ★★ 理由：**P-62** 管「我已把机制收成一处」这句**声明**，★ 而**数据表里的字段**也是一种**声明**（`entry: 'src/…'` 就是在说「这个文件存在」）—— **而它同样没有任何机器守**（**P-27**：声明在写下的一刻就开始过期）。★★ 更危险的是**失效的后果**：**不是报错，而是判据静默失效** —— W82 实测 `source` 字段幽灵化后，`read()` 返回 `null` ⇒ 源文本拼成**空串** ⇒ `markers` **恒找不到** ⇒ **该分支从不报红**（**P-30**：失效与通过同貌）；而 `entry` 幽灵化则报「产物陈旧」**假红**（**P-38**）。★ 配套三条：⑴ ★★ **「基准」必须显式写进判据** —— W82 实测该表**两个字段两套基准**（`entry` = `packages/` 相对 / `source` = `rp-workspace/` 相对），★ 探针**首版按仓库根解析** ⇒ **7/7 全假红**（**P-45**：扫描面与真目标错位）；⑵ ★★ **职责边界要写进诚实边界**（**R7**）—— 与 `checkPair` 的**逐字节**判据分工：本条只证「对象存在」，**不替**它证「对象就是该产物的来源」；⑶ ★★ **对「结构上总是缺失」的字段（如 `artifact`）不得判存在性**（那是**别的判据的职责**，判了就是**假红**，**P-45 / P-38**）。 |

---

### 附录四续六十六：第七十轮 W81 —— **权威构建脚本必须按语义自动发现**（P-81）

> 起点：接 W80 结语。**P-80** 确立了「受检面必须按语义自动发现」，★ 但它**只在一处落地**
> ⇒ 本轮按 **P-70 纪律①** 做**同族分支穷举**。
> ★ 本轮换的不变量 =「判据里出现**手写文件清单**」。

| 项 | 内容 |
|---|---|
| **W81 · 穷举（38 处逐条分诊）** | 全仓（`scripts/*.{mjs,py}`）穷举得 **38 处**手写清单 ⇒ ★★ **只有 1 处该改**：**17 处**是测试样本 · **3 处**依赖定位 · **4 处**豁免表/语义词表（**P-64 已守**）· **2 处**锚定历史事实（**手写正当**，**P-41**）· **1 处**已有单源判据（**W65 判据⑥**）· 其余为结构性映射（**每对两侧都要逐个声明**）⇒ 只有 `audit-artifact-freshness.mjs` + `audit-a14-anchor-negctl.mjs` 的「权威构建脚本」该改（**且两处清单重复 ⇒ P-1 违例**）。 |
| **W81 · ★★ 决定性实验（该面整类无守）** | 新建第三个**含 entry 声明**（`& npx esbuild <entry> … --outfile=`）的 `.ps1` ⇒ `audit-artifact-freshness` / `audit-a14-anchor-negctl` / `audit-selftest-claims` / `audit-baseline-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-publish-hygiene` / `audit-impl-duplication` / `audit-matrix-residuals` / `audit-build-path-parity.py` **十个闸门全部 exit=0** ⇒ ★★ 新构建路径产出的产物**不会被 A14 核验**，而报告**看不出差别**（**P-30**）。 |
| **W81 · ★★ 归因（P-45：别把「别的判据接住」当成「本条判据有效」）** | ★ 首轮实验里 `audit-build-path-parity.py` **报过一次红** —— ★★ **逐条归因后确认它抓的是「探针文件缺 UTF-8 BOM」**，**不是**「清单漏项」⇒ 补 BOM 后它回绿，其余九个始终是 0 ⇒ 结论不变。★★ **元教训**：实验里出现的第一个红**未必是你要测的那条**判据 —— 必须**读它的报错理由**。 |
| **W81 · ★ 语义从代码事实读出（P-41）** | 该函数原头注写着「两条权威构建路径 —— **它们的产出集合不同**」⇒ 语义 =「**含 entry 声明的构建脚本**」，**不是**「本仓全部 `.ps1`」（实测另有 `emulator-dsht.ps1` / `make-testdata.ps1` **都不含 entry**）⇒ 手写 2 项**恰好等于**语义集，★ 但**「为什么是这 2 个」没有任何机器守**（**P-27**）。 |
| **W81 · 修法（按 P-1）** | 抽**单源判定** `hasEntryDecl`（**文件级两个必要条件**：含 esbuild 可执行体 + 含 `--outfile`）+ **单源发现器** `discoverAuthoritativeScripts`；两处调用点改为调它；新增**判据⑨** `authoritativeScriptProblems`（**双向**报红）。 |
| **W81 · ★★ 判据自己的口径缺陷（诚实留痕 —— P-38/P-45/P-72）** | ★ **首版口径** = **同行正则**（要求 esbuild 与 `--outfile` 必须同行）。★★ **实测后果**：**真实仓库只发现 1 个** —— `rebuild-plugins.ps1` 写作 **`$esb` 变量体**（`$esb = "…esbuild…bin…"` + 后续 `& $node $esb … --outfile=`），**同行内没有 `esbuild` 字样** ⇒ **整类漏掉**。★ selftest 的「两侧一致」与「发现数 ≥2」**当场 FAIL**（**判据自己坏了，不是仓库坏了**）⇒ 改**文件级两个必要条件** + **补一条正控钉住形态 B**（否则下次又会漏）。 |
| **W81 · ★★ 承重实验（两组，全部通过）** | 真仓库注入第三个含 entry 的脚本：**形态 A（同行）⇒ 报红 + 精确点名**；**形态 B（`$esb` 变量体）⇒ 同样报红 + 点名**；还原 ⇒ **回绿**（逐字节自证）。 |
| **结果** | 判据⑨ 读数行 `发现 2 个含 entry 声明的脚本（build-dsht.ps1 + rebuild-plugins.ps1）· 与手写清单两侧一致 · 违规 0 处` · selftest **12/12 → 22/22**（10 条 W81 控）· 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **61 PASS / 0 FAIL / 20 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（受检面的发现器必须收全形态）** | **㊳ 凡「按语义自动发现」的受检面，其发现器必须收全该语义的**全部真实形态**，且必须补一条控钉住每一种形态。** ★★ 理由：**P-80** 只说「要按语义枚举」，★ 而**枚举的口径本身**也会漏（**P-45 / P-72**）。★ W81 实测：首版**同行正则** ⇒ **真实仓库只发现 1/2**（`$esb` 变量体整类漏掉），而**「漏了」与「守住了」在报告上完全同貌**（**P-30**）。★ 配套三条：⑴ ★★ **语义必须从代码事实读出**（**P-41**），不得凭印象定义；⑵ ★★ **两处调用点必须同源**（**P-1**）—— 否则「口径改了只改一处」⇒ 对同一仓库给出**相反结论**（**P-46**）；⑶ ★★ **双向对账**（发现 > 声明 / 声明 > 发现 都报红）。 |

---

### 附录四续六十五：第六十九轮 W80 —— **判据的受检面必须按语义自动发现，不得手写文件清单**（P-80）

> 起点：§11.1 已无 ⬜/🔄 ⇒ 按 §十二 第 3 条**换语义不变量**。
> ★ 本轮换的不变量 =「**判据的受检面是「手写清单」还是「按语义枚举」**」。

| 项 | 内容 |
|---|---|
| **W80 · 由头（P-1 的元级形态）** | **P-1** 说「同一语义只许一处权威」—— 本条把它推到**判据自身**：**判据「守什么」也必须由语义条件枚举，不是我写判据时手抄一份名单**。★ 取证：`audit-selftest-claims.mjs` 有 **3 处** `for (const f of [...])` 手写清单；而全仓有 **14 个 `-negctl`** / **45 个 `audit-*`**。 |
| **W80 · ★ 判别标准（P-41）** | ⑵⑶ 两处**锚定历史事实**（「**本轮**修掉的那 N 个」）⇒ **手写正当**；⑴ 处近似的是**语义条件**（「所有带逐条清单写法的 negctl」）⇒ **必须枚举**。 |
| **W80 · ★★ 决定性实验（诚实：先证「今天没有真缺陷」）** | 用探针逐个跑 14 个 `-negctl` 的 `headNoteListProblems` ⇒ **当前 0 处漏记** ⇒ 「今天就存在真缺陷」**不成立**。 |
| **W80 · ★★ 承重实验（首版空转 —— 诚实留痕）** | ★ **首版**：把「自动发现」**短路回手写清单** ⇒ **selftest 仍全绿** —— ★ 原因：**手写清单恰好等于当前受检集**（5 = 5）⇒ 短路前后**结果相同** ⇒ **测不出差别**（**P-30**）。★★ **元教训：承重实验必须制造「一条新的受检对象」**。★ 改法（真仓库注入）：给 `audit-a14-anchor-negctl.mjs` 加实现分组键 `D` ⇒ **自动发现开启：受检数 5→6 且报红点名**；短路 ⇒ 回落 5。 |
| **W80 · ★★ 归因（P-45：查清「短路后为何仍报红」）** | 逐文件核对「**接入契约 × 有该写法 × 在原手写清单内**」三维表 ⇒ `audit-a14-anchor-negctl.mjs` **已接入契约** ⇒ 它本就在 `actual.keys()` 里。★★ **差集统计**：「有该写法 且 不在手写清单 且 不接入契约」= **0 个**。 |
| **W80 · ★★ 诚实定性（R7）** | **今天手写清单与自动发现等价** ⇒ 本轮**不是修今天已有的漏洞**，而是**堵住「下一个新增的 negctl」**（**P-27**：手写清单**在写下的一刻就开始过期**）。★ 不做这步归因，就会把「预防性收口」记成「修了真缺陷」（**P-47**）。 |
| **W80 · 修法（按 P-1）** | `audit-selftest-claims.mjs` 两处：⑴ **主流程 `[头注清单]` 受检面** 从 `actual.keys()`（**只含接入契约的闸门**）→ **`actual.keys() ∪ 全部 `*-negctl.*``** ★ 为什么必要：**14 个 `-negctl` 里大多数不接入契约**（收尾是结论型）⇒ **整片在扫描面外**（**P-45**），而 W73 判据**主要就是冲它们来的**；⑵ **selftest 的 W73 真实仓库控**同样改自动发现。 |
| **W80 · ★ 两条口径（防假红）** | ⑴ **两侧任一为空 ⇒ 不判**（该脚本不用这种写法 ⇒ **P-43**）；⑵ **无该写法的 negctl 不计入受检数**（只出声 —— 否则「受检数」读数虚高）。 |
| **结果** | 受检面 **5 → 全仓 14 个 `-negctl` 枚举**（当前仍是 **5 个**有该写法，其余 9 个只出声）· selftest **133/133 → 136/136** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（受检面按语义枚举）** | **㊲ 判据的「受检面」必须由语义条件（可机器判定：目录枚举 + 正则）枚举，不得手写文件名单。** ★★ 理由：手写名单**在写下的一刻就开始过期**（**P-27**）—— 新增的对象**不会被想起**，而「漏在外面」与「已守住」在报告上**完全同貌**（**P-30**）。★ 例外（**P-41**）：名单**锚定的是历史事实**（如「本轮修掉的那 N 个」）时，手写才正当。★ 配套三条：⑴ ★★ **承重实验必须制造「一条新的受检对象」**（否则「清单内容」与「清单来源」两种改动同貌 —— W80 实测首版空转）；⑵ ★★ **必须诚实归因「这次改动修没修真缺陷」**（W80 差集 = 0 ⇒ 是**预防性收口**，不是修漏洞）；⑶ ★★ **无该写法的对象只出声**（**P-43**）。 |
| **★ 同轮负结论（N23）** | 「**代码文件里的行号引用**」**不**纳入 W79 判据⑧：全仓 **611 处**命中 ⇒ 「唯一解析且越界」**72 处**，逐条归因 ⇒ **0 处真缺陷**（53/72 是**外部基准**的行号，本仓只有 49 行 stub；其余是**判据自己的合成样本**）⇒ 按 **P-38**「收 72 处噪音换 0 处真缺陷」是**负收益**。★ 与 W79 的关键差别：**代码里写的是裸 basename** ⇒ 「带前缀不回退」那条规则**无从下手**。 |

---

### 附录四续六十四：第六十八轮 W79 —— **行号式引用必须「目标存在」且「行号在范围内」**（P-79）

> 起点：§11.1 已无 ⬜/🔄 ⇒ 按 §十二 第 3 条**换语义不变量**找无机器守的区。
> ★ 本轮换的不变量 =「**代码 / 文档里手写了某个文件的行号或行号锚点**」。

| 项 | 内容 |
|---|---|
| **W79 · 由头（P-52 家族的第四格）** | **P-52** 判「**文件在不在**」· **P-69** 判「**跨文档章节在不在**」· **P-68** 判「**文件内编号有没有定义**」，★ 而**行号**这一粒度**从未被守** —— 它是**最易腐烂**的引用（任何编辑都会移位）。 |
| **W79 · ★★ 决定性实验** | 三处独立注入「行号越界」（`build-dsht.ps1:228` → `:9999` · `build-dsht.ps1:211-230` → `:9998-9999` · `build-dsht.ps1` 里登记的 `（§3.1 第 74 行）` → `第 9999 行`），另做三个子面注入（**目标文件名不存在** ×2 · **`:N` 形态越界**）⇒ `audit-selftest-claims` / `audit-baseline-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-artifact-freshness` / `audit-rule-claims` **六个闸门全部 exit=0** ⇒ ★★ **该面整类无守**（逐字节还原自证）。 |
| **W79 · ★ 为什么藏得住** | **行号引用的「目标还在」与「行号还对」是两件事** —— 文件在、章节在，读者**不会怀疑行号**；而「越界」与「准确」在报告上**完全同貌**（**P-30**）。★ 全仓穷举（mask 史实区后）实测**只有 7 处命中**，其中 **5 处可解析**、**全部当前准确** —— ★ 但这是**运气，不是判据力**（**W45 的识别特征**）。★★ **数量少恰恰说明本判据的价值是「防未来的腐烂」**：行号**每次编辑都会移位**，而一旦移位**没有任何东西会提醒**（**P-27**）。 |
| **W79 · 修法（按 P-1 扩既有闸门）** | `audit-doc-refs.mjs` 新增纯函数 `scanLineRefProblems` + 主流程判据⑧ —— ① 抽 `<path>:<N>`（可带 `-M` 区间）；② 解析到**本仓唯一文件** ⇒ 比对行号范围；③ **越界 / 区间写反** ⇒ **报红**。★ 解析器抽成**单源** `makeLineRefResolver`（**P-1**）：主流程与 selftest 的真实仓库控**共用同一份口径**。 |
| **W79 · ★★ 四条口径（防假红，守 P-38/P-45）** | ⑴ ★★ **只认「本仓可解析」的目标** —— 本仓**大量**行号引用指向**第三方基准实现**（`dsh-session/lib/types/surface.js:12-18` · `JS-Slash-Runner/src/function/variables.ts:211-223`），那些文件**不在本仓** ⇒ **只出声**（**P-43**）；⑵ ★★ **同名多处 ⇒ 不判**（解析不唯一时「越界」取决于解析到哪一个，**P-46**）；⑶ ★★ **自指 ⇒ 不判**；⑷ ★★ **必须要求路径含扩展名**，否则正文里的普通冒号（`时间:2026`）会被当成行号引用 ⇒ **大量假红**（**P-38**）。 |
| **W79 · ★★ 承重实验（两组）** | ① **短路越界分支** ⇒ selftest **3 条控 FAIL**；**短路区间写反分支** ⇒ **1 条控 FAIL**（均已还原、逐字节自证）；② ★★ **真仓库注入**（方法论 `build-dsht.ps1:211-230` → `:11111-22222`）⇒ 主流程**报 2 处且精确点名**（含「该文件实测只有 1630 行」）；还原 ⇒ 回绿。 |
| **W79 · ★★ 判据当场抓到我自己的两处（诚实留痕）** | ⑴ ★★ **假红**：我在方法论 §6.80 里写了 `JS-Slash-Runner/src/function/variables.ts:211-223`（**外部基准**），而解析器**回退到裸 basename** ⇒ 命中本仓同名 `variables.ts`（107 行）⇒ **越界假红** ⇒ 修法 =「**带目录前缀而后缀匹配失败 ⇒ 判非本仓**」（**P-45**：扫描面与真目标错位）；⑵ ★★ **单源口径分叉**：该修法**只改了主流程**，而 selftest 里那份**另写的索引**没改 ⇒ 对**同一条引用**给出**相反结论**（**P-46**）⇒ 抽成单源 `makeLineRefResolver` + 补「外部带前缀不回退」与「带前缀确属本仓仍能解析」的**成对控**。 |
| **W79 · ★ 一条纪律（分数同步）** | **分数同步必须按「唯一子串 / 行号」精确改** —— `33/33` 在本仓**同时**属 `audit-build-path-parity.py`、`perf-audit.mjs` 与 **W69/W70 的史实记账** ⇒ **全局替换会篡改历史**（**N7 的第二次现身**）⇒ 本轮改用唯一子串逐处替换，替换前后逐处核对归属。 |
| **结果** | 判据⑧ 读数行 `检查 13 处（涉及 1 份文档）· 违规 0 处 · 另有 5 处指向第三方基准实现未判定（P-43）` · selftest **68/68 → 83/83**（15 条控）· 负控 **33/33 → 38/38** · 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（行号引用必须可达）** | **㊱ 凡以 `<文件>:<行号>`（含 `a-b` 区间）形式点名位置的引用，其目标必须是本仓可唯一解析的文件、且行号必须在该文件的行数范围内。** ★★ 理由：**行号是最易腐烂的引用** —— 任何一次编辑都会让它移位，★ 而「移位」与「准确」在报告上**完全同貌**（**P-30**）。★★ **决定性实验（W79）**：三处「行号越界」+ 三个子面注入 ⇒ **六个闸门全部 exit=0**（该面**整类无守**）。★ 配套四条：⑴ ★★ **非本仓目标只出声**（**P-43**：第三方基准实现无法也不该验证）；⑵ ★★ **解析不唯一时不判**（**P-46**）；⑶ ★★ **自指不判**；⑷ ★★ **必须要求路径含扩展名**（否则普通冒号会被当成行号 ⇒ 假红，**P-38**）。★ 与 **P-52 / P-69 / P-68** 的关系：**文件在不在 · 跨文档章节在不在 · 文件内编号有没有定义 · ★ 行号对不对** —— ★★ **四格合起来，引用完整性这一面才闭合**。★ 诚实边界（R7）：本判据**只证「读者按行号翻得到那一行」**，**不证「那一行讲的就是他要找的东西」**（后者是语义判断；★ 报错信息里已给出出路 —— 「改成可定位的锚点（如函数名 / 章节号）」）。 |

---

### 附录四续六十三：第六十七轮 W78 —— **读数登记的 `Pattern` 必须真的能匹配到值**（P-78）

> 起点：接 W77 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W62 机器化了「登记 ≠ 接线」，那接线之后呢？登记的那条读数，真的取得到值吗？**」

| 项 | 内容 |
|---|---|
| **W78 · 由头（P-62 的补集）** | **W62** 把「读数回显」收成 `build-dsht.ps1` 里的**全脚本唯一实现点** `Show-Reading`，并机器化了「**登记 ≠ 接线**」（登记表里的闸门必须真有 `Show-Reading -Gate` 调用）。★ 但它**只问「有没有接线」，不问「接了线之后取不取得**值」**。 |
| **W78 · ★★ 决定性实验** | 把 `audit-rule-claims.mjs` 那条登记里的 `Pattern` 改成一个**永不匹配**的串（`绝不存在的读数行XYZ`）⇒ `audit-selftest-claims` / `audit-rule-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-baseline-claims` **五个闸门全部 exit=0** ⇒ ★★ **该面整类无守**（逐字节还原自证）。 |
| **W78 · ★ 前提取证（为什么藏得住）** | `Show-Reading`（`build-dsht.ps1:211-230`）的兜底**只打一句黄字警告**（`⚠ 未取到读数行`）**不 fail**（L228）⇒ 读者只会看到「**少了一行读数**」，**不会知道那是登记失效** —— 而「读数没进日志」与「读数进了日志」在报告上**几乎同貌**（**P-30**）。 |
| **W78 · 修法（按 P-1 扩既有闸门）** | `audit-selftest-claims.mjs` 新增纯函数 `readingValueProblems` —— ① 从 `$readingGates` 抽 `{Gate, Exe, Pattern}`（**与 W62 同一抽取口径**）；② **实跑该闸门**，用该 `Pattern` 过滤输出 ⇒ 必须匹配 ≥ 1 行；③ 0 行 ⇒ **报红**；④ **非法正则**与「匹配 0 行」**理由分家**（守 **P-46**）。 |
| **W78 · ★★ 三类边界（只出声不报红）** | ⑴ ★★ **自调用链** —— 本判据**实跑**受检闸门，而 `audit-selftest-claims.mjs` 自己那条**就是它自己** ⇒ 首版实测 `spawnSync … ETIMEDOUT`（**递归超时**）⇒ 显式排除（**P-50 推论一**），该条读数由构建期 `Show-Reading` 自己核验；⑵ **脚本不存在** ⇒ 只出声（该条由 W62 判据② 承接）；⑶ **构建期跑不起来**（需设备/语料）⇒ 只出声（由**设备侧**承接）。三类都守 **P-43**。 |
| **W78 · 机器化与承重** | 新增纯函数 `readingValueProblems` + 主流程第 ⑩ 步 + 读数行 `[读数取值] 实跑核验了 10 条登记的 Pattern · 违规 0 处`；selftest **121/121 → 128/128**（2 条负控 + 1 条正控 + 4 条零控，含真实仓库收口控）；★★ **承重实验**：把 `Pattern` 写坏 ⇒ `违规 1 处` + 主流程报红且**精确点名该闸门与其 `Pattern`**；还原 ⇒ 回绿。 |
| **W78 · ★ 收尾时判据体系当场咬合（两处）** | ⑴ 改判据后共 **9 处**分数声明（`121/121`）过期 ⇒ 逐处同步（`128/128`）后回绿；⑵ ★ **并发跑两个 `-negctl` ⇒ 互相干扰**（两个负控都要改同一份受守文档）⇒ `doc-refs-negctl` 分数从 33 波动到 25~30 ⇒ **串行复跑后 33/33 回绿** —— 纪律：**负控必须串行跑**（同一份受守文档是共享资源）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（读数登记必须能取到值）** | **㉟ 凡在 `$readingGates` 登记表里写下的读数项，其 `Pattern` 必须在构建期能真的从该闸门的输出里匹配到 ≥ 1 行。** ★★ 理由：**登记一条读数**是我们对「这一行会进构建日志」的**承诺** —— ★ 而 `Show-Reading` 的兜底**只打黄字警告不 fail** ⇒ **承诺落空与承诺兑现，在报告上几乎同貌**（**P-30**）。★★ **决定性实验（W78）**：把某条 `Pattern` 改成永不匹配的串 ⇒ **五个闸门全部 exit=0**（该面**整类无守**）。★ 配套三条：⑴ ★★ **「0 行」必须报红**（否则登记的是**永远取不到值的空声明**）；⑵ ★★ **「非法正则」与「匹配 0 行」必须理由分家**（守 **P-46**）；⑶ ★★ **无判据力的三类必须只出声**（**P-43**：脚本不存在 / 构建期跑不起来 / **自调用链**——后者见 **P-50 推论一**，实测会**递归超时**）。★ 与 **P-66** 的分工：**P-66 管消费侧**（读数有观测面 ≠ 有人在读它），**本条管生产侧**（登记了读数 ≠ 取得到值）—— ★★ 两者合起来，读数从**产出**到**消费**这一条链才闭合。 |

---

### 附录四续六十二：第六十六轮 W77 —— **头注「用法」行声明的 CLI flag 必须被实现真的读**（P-77）

> 起点：接 W76 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W74 机器化了「负控传过这个输入面吗」，那相反的那一侧有人管吗？**」

| 项 | 内容 |
|---|---|
| **W77 · 由头（P-59 家族 · 相反的那一侧）** | **W74** 机器化了「**负控**有没有传过这个输入面」；★ 但**没人问相反的那一侧** —— 「**头注用法行写着的 flag，实现里读不读它**」。★ 与 **P-63**（实现存在 vs 被喂输入）同族，本条问的是**第三种**：**文档声明了 vs 实现真的读它**。 |
| **W77 · ★★ 决定性实验** | 故意在马一个闸门（`audit-cross-package-css.mjs`）的**头注用法行**里加 `--ghost-flag <x>`（实现里**从不读**）⇒ `audit-selftest-claims` / `audit-rule-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-baseline-claims` / `audit-open-items` **六个闸门全部 exit=0** ⇒ ★★ **该面整类无守**：读者照头注抄命令**必扑空**，而报告全绿（**P-30**）。 |
| **W77 · 真缺陷（4 处）** | 全是「**实现支持但用法行没写**」：`audit-baseline-claims.mjs`（`--file/--readme/--freeze/--tasklist/--strict-two-way`）· `audit-doc-refs.mjs`（`--as`）· `audit-goal-sections.mjs`（`--method`）· `audit-selftest-claims.mjs`（`--file`）。★ 藏得住的原因：**能力都在、判据都对**，只是**读者发现不了**它们 ⇒ 与「不能用」在报告上**完全同貌**（**P-30**）。 |
| **W77 · 修法** | 4 处**如实补齐用法行**（能力真的存在，缺的只是声明）。 |
| **W77 · ★★ 判据的七版口径（诚实留痕）** | 要问「实现面有没有读这个 flag」，而**样本恰恰总写在模板串里** ⇒ 必须把模板串从实现面剥掉。★ **七版全部被真实语料当场证伪**：v1 不跨行正则（剥不到跨行串）· v2 可跨行正则（**贪婪跨过大量真代码**）· v3 逐字符 + `${…}` 配平（同串多 `${}` 提前归零）· v4 逐字符 + 外层跳引号串（未闭合撇号吞到文件尾，31493 → 10020）· v5 逐行奇偶（★ 本仓**反引号总数常为奇数** —— 引号串里含单个反引号，如 `anchor: 'return `(function'`）· v6 掩码引号串内反引号（仍受多行样本干扰）· v7 再掩码正则字面量内反引号（**反向吃掉真代码**）· **★ v8（最终）「凡含反引号的行一律不参与扫描」**。 |
| **W77 · ★★ 元教训（P-41 的极端现身处）** | 反引号在 JS 词法里有**三种角色**（模板串定界符 · 正则字面量内部字符 · **引号串内部字符**）；★ 连续七版都在「用规则近似 JS 词法」，**每一版都在真实语料的某个形态上失真** ⇒ ★★ **判据的实现面口径，宁可选「更粗但绝不跨界」的局部算术，也不要选「看起来更精确」的词法模拟**（前者只会**漏**，后者会**误报**，而误报训练人忽略报警，**P-38**）。 |
| **W77 · 诚实边界 + 豁免机器化** | v8 **看不到**「写在多行模板串**续行**上」的读取形态；★ 本仓实测**唯一实例**是 `audit-p48-rollback.mjs` 的 selftest **样本**（讲的是 W39 修前形态本身，**不是真读**）⇒ 做成**显式豁免表** `READ_FLAG_EXEMPTIONS`（每条必带 `why`），配**两条控**：⑴ 豁免项必须**真实存在**；⑵ 豁免**只作用于 `undeclared` 面**，**不得**掩盖 `missing` 面。 |
| **W77 · 机器化与承重** | 新增纯函数 `usageFaceProblems` + `stripTemplateSpans` + 主流程第 ⑨ 步 + 读数行 `[用法面] …`；selftest **101/101 → 121/121**；★★ **承重三组**：短路判据 ⇒ **6 条控 FAIL**；清空豁免表 ⇒ 报 1 处 + 整类收口控 FAIL；**真仓库注入 `--ghost-flag` ⇒ 主流程报红且点名**（逐字节还原自证）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（用法行与实现必须双向对账）** | **㉞ 凡头注「用法」行里写出的 CLI flag，实现里必须真的读它；反之，实现真的读的每个 flag 都必须写进用法行。** ★★ 理由：**读者照头注抄命令**是我们对该命令的**承诺** —— 承诺了却读不到（或能读却没人知道）**两种事实在报告上完全同貌**（**P-30**）。★★ **决定性实验（W77）**：故意在用法行加一个实现从不读的 `--ghost-flag` ⇒ **六个闸门全部 exit=0**（该面**整类无守**）。★ 配套三条：⑴ ★★ **双向**（守 **P-46**）；⑵ ★★ **「实现面」口径宁粗勿越界** —— ★ 本条的实现面口径**改了七版**，每一版都在真实语料的某个形态上失真；最终取「**凡含反引号的行一律不参与扫描**」。★ 理由（**P-38**）：粗口径只会**漏**，词法模拟会**误报**；⑶ ★★ **豁免必须点名到能跑到的通路，且有机器守**（**P-64**）—— 且豁免**不得**掩盖 `missing` 面（**读者会扑空**是硬缺陷）。★ 与 **P-59 家族**的关系：**W44 自证分数 · W71 汇总条数 · W73 清单键集合 · W75/W76 退出码 · W74 输入面（负控侧）· 本条用法行（实现侧）** —— ★★ **第六处仍不是「有人违规」，而是「那一侧从来没人对账」**。 |

---

### 附录四续六十一：第六十五轮 W76 —— **同一份声明的「排版形态」不止一种**（P-76）

> 起点：接 W75 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W75 刚给「退出码」装了守，那份声明还有别的合法写法吗？扫描面收全了吗？**」

| 项 | 内容 |
|---|---|
| **W76 · 由头（P-72 · P-59 纪律①）** | **P-72**（W72）确立「同一份声明的**合法写法不止一种** ⇒ 按写法界定的扫描面会漏掉整类」。★ 本轮把它用在**同一个字段**上：**P-75** 只认 `## 退出码` **段**（判据里 `if (!m) return` 直接放行）。 |
| **W76 · ★★ 真缺陷（整类无守）** | 本仓还有**第二种等效写法**：把声明写在**注释行内**（`* 退出码：0 = 全部可加载；1 = 有不可加载`）。⇒ **受检面 33 个闸门里 29 个声明了退出码，其中 10 个用行内写法，整类落在 W75 的扫描面之外**，而其中 **6 处已过期**：**幽灵声明 2 处**（`audit-publish-hygiene.mjs` 声明 `2 = 环境失败` 而实现从不返回 2；`audit-build-path-parity.py` 的 1/2/3）+ **未声明的码 4 处**（`audit-cdp-eval-negctl.mjs` / `audit-iframe-sandbox.mjs` / `audit-impl-duplication.mjs` / `audit-method-binding.mjs` 漏「检出违规 = 1」；`audit-route-contract.mjs` 只写 `0 = 无违约`）。 |
| **W76 · ★★ 为什么藏得住** | 这 6 处的**主流程判据都是对的**（`exit 0/1` 语义正确）⇒ 日常跑门禁**从不出症状**；而修前 `[退出码] …违规 0 处` 与修后**读数一模一样**（**P-30**：失效与通过同貌）。★ 与 **P-72** 的分工：P-72 的对象是「**文档排版**」（表格行跨列），**本条的对象是「注释排版」**（段 vs 行内）。 |
| **W76 · 修法（按「谁是对的」分两种）** | ① **如实补齐头注的缺失码**（4 处）；② ★★ **让实现兑现头注承诺** —— `audit-publish-hygiene.mjs` 的 `git` 不可用时显式 `exit 2`：此前它抛异常 ⇒ 未捕获 ⇒ 退出码 **1**，**与「检出命中」同码**（**真的修掉一个数据风险**：谁也无法从退出码分辨「扫描器没跑起来」与「六类全清」）。 |
| **W76 · ★ 判据自己的六条口径（诚实留痕）** | ⑴ **跨文档引用编号必须剔除**（`（正常，T-46 待拍板）` 的 `46` / `（结论不可信，P-30）` 的 `30` 是**引用**不是码 ⇒ 首版探针报出**两条纯自造的幽灵声明**）；⑵ **行内形态要连带它的续行**（**P-41 推论四**：换行即失守）；⑶ **`0` 豁免幽灵面**（正常跑完即隐含 `exit 0`）；⑷ **首个码前的分隔符含 `：`**（首版漏了 ⇒ **3 个闸门报「0 未声明」的假红**）；⑸ ★★ **实现面口径按语言分派**（`.mjs` 认 `process.exit`；`.py` 认 `sys.exit(N)` / `return N`；**P-45**）；⑹ ★★ **实参必须括号配平地取**（`sys.exit(0 if selftest() else 3)` 的内层 `()` 会把 `[^)]*` 的捕获**提前截断**）。 |
| **W76 · 机器化与承重** | `exitCodeProblems(src, ext)` 扩为**两种排版形态的并集** + 六条口径；selftest **84/84 → 101/101**（9 条成对控 + 6 条真实仓库控 + 1 条**整类收口控**）；★★ **承重实验两组**：短路「行内形态」⇒ **6 条控 FAIL**；短路「`.py` 口径分派」⇒ **4 条控 FAIL**（均已还原）。★ 副产品：判据当场报出 `audit-rule-claims-negctl.mjs` 的**头注清单漏记 G**（W73 判据在工作）⇒ 顺手补齐。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（声明的排版形态必须枚举）** | **㉝ 凡「要按头注判」的字段（自证分数 / 判据条数 / 逐条清单 / 退出码 / 输入面…），其扫描面必须枚举该字段的「全部合法排版形态」，不得只认我写下的那一种。** ★★ 理由：**同一份声明的合法写法不止一种** —— 而按「写法」界定的扫描面会**整类漏掉**别种写法（**P-72**），且漏掉时**报告与「全都守住了」完全同貌**（**P-30**）。★★ **决定性实验（W76 全仓穷举）**：**受检面 33 个闸门 / 29 个声明了退出码 / 10 个用行内写法整类不在扫描面内 / 6 处已过期**，★ 而日常跑门禁**从不出症状**。★ 配套三条：⑴ ★★ **判据扩展后必须补「该形态的成对控」**（负控 + 正控 + 杠杆），否则新形态的判据**自己无法被证伪**（**P-67 纪律③**）；⑵ ★★ **六条解析口径**（引用编号剔除 / 续行 / `0` 豁免 / 冒号分隔符 / 按语言分派实现面 / 括号配平）**全部由实测假红逼出** —— **宁可先造出一条假红再去认识它，也不要让整类静默漏守**；⑶ ★★ **修法按「谁是对的」分两种**（**㉜ 同纪律**）。★ 与 **P-59 家族**的关系：**W44 自证分数 · W71 汇总条数 · W73 清单键集合 · W75 退出码段 · 本条退出码行内形态** —— ★★ **第五处仍不是「有人违规」，而是「那个形态从来没人对账」**。 |

---

### 附录四续六十：第六十五轮 W75 —— **头注声明的「退出码契约」必须与实现一致**（P-75）

> 起点：接 W74 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**P-59 家族已守了「自证分数」「判据条数」「逐条清单」三处，还有第四处吗？**」

| 项 | 内容 |
|---|---|
| **W75 · 由头（P-59 纪律① · 同族分支穷举）** | W44/W71/W73 分别把「头注声明 vs 实现」落在**三个字段**上。★ 本轮穷举**第四类** —— **`## 退出码` 段**：它是**给读者与 CI 用的接口契约**（本仓 **13 个**闸门都写着 `0 = 通过  1 = 检出违规（fail-closed）  2 = selftest 失败`）。 |
| **W75 · ★★ 真缺陷（3 处）** | `audit-error-layer-classify.mjs` / `audit-open-items.mjs` 头注声明「**2 = selftest 失败**」，而 selftest 分支实际是 `fail === 0 ? 0 : 1` ⇒ ★★ **「闸门自己坏了」与「闸门检出违规」返回同一个码** —— 头注承诺的**区分根本不存在**（读者/CI 拿到 `exit=1` 无法分辨该重跑还是该修代码）；`audit-rule-claims.mjs` 声明 `2 = selftest 失败` 而实现是 `okAll ? 0 : **3**`（且 `2` 用于「输入缺失」）⇒ **声明与实际两处都错**。 |
| **W75 · ★★ 为什么藏得住** | 三处的**主流程**判据都是对的 ⇒ 日常跑门禁**从不出症状**；而**幽灵码与真实码在报告上完全同貌**（**P-46 的反面**：两种不同的事实必须有**两个不同**的读数）。★ 与 **P-65**（「声称自己是某处的单源」无机器守）同族：**声明本身没人对账**。 |
| **W75 · ★★ 决定性实验** | 全仓对账「头注声明的码」×「`process.exit` 实参集合」⇒ 报出 3 处；★ **修复后受检面 13 个闸门 0 违规**。★ 承重实验：短路 `ghost`/`undeclared` ⇒ **selftest 报 5 FAIL**。 |
| **W75 · 修法（分两种，不是一刀切）** | ⑴ ★★ **让实现兑现头注承诺**（前三者之二）：`? 0 : 1` → `? 0 : 2`；⑵ ★★ **如实改写头注**（`audit-rule-claims`）：补 `2 = 输入缺失` 与 `3 = selftest 失败` —— 因为它的 `3` **已被负控与构建脚本当「selftest 失败」用**，改码会破坏既有约定（**P-61**）。★ 两种修法**按「谁是对的」选**，不按「哪个改起来省事」选。 |
| **W75 · ★★ 判据自己的三处口径（诚实留痕）** | ⑴ **必须认表达式**（首版只认字面量 ⇒ **7 个闸门假红**）；⑵ **必须剥字符串字面量**（`audit-p48-negctl.mjs` 的 selftest **样本数组**里含 `"...process.exit(130)..."`）；⑶ ★★ **剥字符串必须限定「不跨行」** —— 首版字符类能匹配换行 ⇒ 贪婪吃到很远的另一个 `'`，**把中间真实代码一起剥掉** ⇒ 报出**纯自造的幽灵声明**。 |
| **W75 · 机器化与承重** | `audit-selftest-claims.mjs` 新增纯函数 `exitCodeProblems` + 主流程第 ⑧ 步 + 读数行 `[退出码] …`；selftest **72/72 → 84/84**（8 条成对控 + 3 条真实仓库控）；★★ **承重实验**：短路 `ghost`/`undeclared` ⇒ **selftest 报 5 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（退出码契约必须双向对账）** | **㉜ 头注里声明的「退出码 ↔ 含义」是**接口契约**；凡写了「N = 某含义」，实现里必须真的存在返回 N 的通路；反之实现返回的每个码都必须被声明。** ★★ 理由：**「闸门自己坏了」与「闸门检出违规」若返回同一个码，读者/CI 就**无法分辨该重跑还是该修代码** —— 而两者在报告上**完全同貌**（**P-30 / P-46 的反面**）。★★ **决定性实验（W75 全仓对账）**：**3 处真缺陷**（`audit-error-layer-classify.mjs` / `audit-open-items.mjs` 声明 `2 = selftest 失败` 而实现是 `? 0 : 1`；`audit-rule-claims.mjs` 声明 `2` 而实现是 `3`），★ 而**日常跑门禁从不出症状**（主流程判据都是对的）。★ 配套三条：⑴ ★★ **判据必须双向**（只守一侧会让另一侧静默失效）；⑵ ★★ **修法按「谁是对的」分两种** —— 让实现兑现承诺，或如实改写声明；★ **若该码已被其它装置依赖，就改声明而不是改实现**（**P-61**）；⑶ ★★ **豁免必须成对且锚到真实形态** —— 标准信号码 `130`/`143`（POSIX `128+signal`）豁免，**非标准码（如 `137`）不得被一起豁免**（**P-38**）；且**豁免的识别也要看通路**（写在 `process.on('SIGINT')` 兜底里才是信号码）。★ 与 **P-59 家族**的关系：★ **W44 自证分数 · W71 汇总条数 · W73 清单键集合 · 本条退出码** —— **四者都是同一母题（头注声明 vs 实现）在不同字段上的现身**，而**每次都不是「有人违规」，而是「那个字段从来没人对账」**。 |

---

### 附录四续五十九：第六十四轮 W74 —— **判据的「输入面」必须有负控去用它**（P-74）

> 起点：接 W73 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**P-59 纪律②（新判据必须同步它的输入面）只在 W54 那一处落地，别处呢？**」

| 项 | 内容 |
|---|---|
| **W74 · 由头（P-70 纪律① · 同族分支穷举）** | W54 给 `audit-goal-sections.mjs` 补 `--method` 时写下了 **P-59 纪律②**。★ 本轮按 **P-70 纪律①** 做**横向穷举**：不变量 =「**闸门支持某输入面 flag**（`--file`/`--method`/`--readme`/`--freeze`/`--tasklist`/`--as`）」，★ **按语义找、不按已知的那个 flag 名找**。 |
| **W74 · ★★ 真缺陷（一整类结构性缺口）** | `audit-baseline-claims.mjs` 支持 **4 个**输入面，而 `audit-baseline-claims-negctl.mjs` **只传了前三个**（缺 `--tasklist`）⇒ ★★ **`TASK-LIST.md` 这一整面的判据从头到尾无法被负控**（注入点在扫描面上**存在**，但**没有任何控去用它**，**P-1**）。★ 该面是 W59 扩进来的（受守名单 `READING_DOCS` 里**确实列了**它）⇒ **看起来有守** —— 与「真的有人守」在报告上**完全同貌**（**P-30**）。★ 与 **P-63**（实现存在 vs 被喂输入）同族，只是这次在**负控侧**；与 **P-20**（长期无正控 = 覆盖空洞）**形态相同**。 |
| **W74 · ★★ 决定性实验** | 全仓对账「闸门支持的输入面」×「负控传过的输入面」⇒ 报出该缺口；★ **修复后实测**：负控里用 `--tasklist` 传副本 + 注入 W59 的修前形态（「约 50 项记名 stub」）⇒ **该闸门报红且理由正确**（`[验收] ✗ TASK-LIST.md 第 2729 行写死「约 50 项记名 stub」…`）⇒ 证明**该判据真的在读那一面**，只是此前**没人控过它**。 |
| **W74 · 修法（扩既有闸门 + 补负控）** | ⑴ 负控新增 **I 组**（`--tasklist` 传 TASK-LIST 副本 + **杠杆 I**）⇒ **37/37 → 40/40**；⑵ `audit-selftest-claims.mjs` 新增纯函数 **`inputFaceProblems`** —— **把这条纪律本身机器化**（否则它在下一处还会漏，**P-70**）+ 主流程第 ⑦ 步 + 读数行 `[输入面] …`。 |
| **W74 · ★★ 判据自己的两次自指污染（诚实留痕）** | ⑴ 白名单常量行 `INPUT_FACE_FLAGS = [...]` 里**同时含全部六个 flag 字面量** ⇒ 判据把自己读成受检对象（**假红**）；⑵ 收窄后**仍报红** —— 判据自己的**注释与 selftest 样本**里也出现了 `process.argv.indexOf('--tasklist')` 这类**字面量**（讲的就是这件事本身）。⇒ 修法 = **先剥注释行 + 只认真读 argv 的形态 + 样本用 `String.fromCharCode(39)` 转义拼接构造**（**P-41** / **P-45**）。 |
| **W74 · 机器化与承重** | selftest **65/65 → 72/72**（6 条成对控：缺传 / 传全 / 无负控 / 运行模式不算输入面 / 自指剔除 / **杠杆** + 1 条真实仓库控）；★★ **承重实验**：短路 `missing` ⇒ **selftest 报 2 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（判据的输入面必须有负控覆盖）** | **㉛ 凡闸门声明了某个「输入面参数」（`--file` / `--method` / `--readme` / `--freeze` / `--tasklist` / `--as`），它的负控必须至少传一次那个参数。** ★★ 理由：**「注入点在判据的扫描面上存在」≠「有控去用它」** —— 前者是**静态事实**，后者才决定**该面能否被证伪**。★★ **决定性实验（W74 全仓对账）**：`audit-baseline-claims.mjs` 支持 **4 个**输入面而 `-negctl` **只传了 3 个**（缺 `--tasklist`）⇒ **`TASK-LIST.md` 这一整面从头到尾无法被负控**，而受守名单里**确实列了它**（**看起来有守**，**P-30**）。★ 配套三条：⑴ ★★ **对账口径必须锚到「真的读了 argv」**（`process.argv.(indexOf\|includes)('<flag>')`），**不能锚到「文本里出现过这个字符串」** —— ★ **W74 实测连踩两次自指污染**（白名单常量行 + 注释/selftest 样本 ⇒ 判据把自己读成受检对象，**假红**）⇒ 还须**先剥注释行**，且 selftest 样本用**转义拼接**构造；⑵ ★★ **无同名负控 ⇒ 只出声不报红**（**P-43**：很多闸门天然不需要负控）；⑶ ★★ **未覆盖者的名单必须出声**（**P-30**：不在名单里与「已接入」必须能分辨）—— ★ 但**不得为了名单归零而硬凑空壳控**（**P-43**：无判据力不得制造判据）。★ 与 **P-59 纪律②** 的关系：★ **P-59 纪律② 写下了这条纪律并在一处落地；本条把它做成横向穷举并机器化** —— 而穷举**果然在别处漏了**（**W67 → W70** 的同一形态：一条纪律的第二次现身几乎总在另一个地方）。 |

---

### 附录四续五十八：第六十三轮 W73 —— **「无汇总数的逐条清单」比「带汇总数的清单」更容易过期**（P-73）

> 起点：接 W72 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W71 守住了「带汇总数」的清单，那『没有汇总数』的清单有人守吗？**」

| 项 | 内容 |
|---|---|
| **W73 · 由头（P-11 元级）** | **P-71** 给「清单 + 汇总数」装了机器守（判据 = 「声明数 ≤ 实现条数」）；★ 本轮问**它的补集**：「**只有逐条清单、完全没有汇总数**的那一类，有人守吗？」 |
| **W73 · ★★ 真缺陷（5 处，全部落在 W71 判据的扫描面之外）** | `audit-baseline-claims-negctl.mjs`（清单 A~**B** / 实现 A~**M**，漏 **11** 组）· `audit-rule-claims-negctl.mjs`（A~**C** / A~**G**）· `audit-selftest-claims-negctl.mjs`（A~**C** / A~**G**）· `audit-doc-refs-negctl.mjs`（A~**F** / A~**I**）· `audit-goal-sections-negctl.mjs`（A~**C** / A~**F**）。★★ **五个闸门全 exit=0**（**P-30**）。★ 其中一个是**自调用链**（受检面之外，**P-50 推论一**）⇒ 本轮**人工补**并写明诚实边界。 |
| **W73 · ★ 为什么这一类比 W71 那类**更危险 | W71 守的那类至少**还有个数字可对**（改清单时会看到「（五条）」）；★★ 本条这一类**连可对的东西都没有** ⇒ 扩一组时**永远不会被想起**。★ 三者分工：**P-59 管内容（逐条判据）· P-71 管元数据（汇总数）· 本条管结构（清单键集合）**。 |
| **W73 · ★★ 决定性实验** | 全仓穷举 + 逐处核对（上列 5 处）；★ 修复后受检面 4 个闸门 **0 违规**（`[头注清单] …违规 0 处`）。★ 承重实验：短路 `missing` ⇒ **selftest 报 2 FAIL**。 |
| **W73 · 修法（扩既有闸门，不新建脚本）** | 扩 `audit-selftest-claims.mjs` 新增纯函数 `headNoteListProblems` + 主流程第 ⑥ 步（受检面 = **接入契约的闸门**，与「自证分数」「头注条数」**同一受检面**）+ 读数行 `[头注清单] …`；★ 口径**必须「漏记报红 / 多写不报」**（与 **P-71** 的「≤」同向，**P-1**）；★ **两侧任一为空 ⇒ 不判**（**P-43**）。 |
| **W73 · ★ 过程踩到的三处（诚实留痕）** | ⑴ ★★ **块注释被 `*/` 提前闭合**（我在头注里写了 `contracts/*/slots.json` ⇒ 那个 `*/` **直接终结了块注释** ⇒ `SyntaxError`；**P-41 推论四**的同族）⇒ 改成 `contracts/<ver>/slots.json`；⑵ ★ **「多写」判据首版写反** ⇒ 按 **P-38** 改成「多写不报」；⑶ ★★ **首轮把受检面外的脚本也算进来**（自调用链）⇒ **声明与受检面必须一致**。 |
| **W73 · 机器化与承重** | selftest **56/56 → 65/65**（6 条成对控 + 4 条真实仓库控）+ 负控 **23/23 → 27/27**（**H** 头注清单漏记 / **杠杆H** / 逐字节还原自证）；★★ **承重实验**：短路 `missing` ⇒ **selftest 报 2 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（清单与实现必须按「键集合」对账）** | **㉚ 「逐条清单」与「它对应的实现分组」必须按「键集合」对账，而不能只按「汇总数」对账。** ★★ 理由：**同一份清单有两种合法写法** —— **带汇总数**（`判据（N 条）`，由 **P-71** 守）与**不带汇总数**（只有 `A./B./C.`）★ ★ 而**后者更危险**：**连「该改哪个数字」都不存在** ⇒ 扩一组时**永远不会被想起**，而两类在报告上**完全同貌**（都是「0 违规」，**P-30**）。★★ **决定性实验**：全仓穷举 ⇒ **5 处漏记**（`-baseline-claims-negctl` A~B vs A~M 等），★ 而**五个闸门全 exit=0**。★ 配套三条：⑴ ★★ **凡头注里给了分组键标题，它就必须出现在头注清单里** —— 若某组**确实不该进**那份清单，就**别给它加分组键**（改成不带字母的形态）⇒ 对账**永远是干净的**（**P-61**：收窄要**可判定**）；⑵ ★★ **判据口径必须「漏记报红 / 多写不报」**（与 **P-71** 的「声明 ≤ 实现」**同向** —— **P-1**：同一族口径不得两处各写一套；多写=预留位是合法的，报红即假红，**P-38**）；⑶ ★★ **两侧任一为空 ⇒ 不判**（**P-43**：该脚本不用这种写法 ⇒ 无判据力）。★ 与 **P-71** 的关系：★ **同一份「清单」在两个方向上被守** —— **P-71 守它的汇总数（元数据）· 本条守它的键集合（结构）**。 |

---

### 附录四续五十七：第六十二轮 W72 —— **同一份声明的合法写法不止一种**（P-72）

> 起点：接 W71 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**§3.2 门禁清单里的那些分数声明，真的被抽到了吗？**」

| 项 | 内容 |
|---|---|
| **W72 · 由头（P-11 元级）** | **P-54** 确立「契约的覆盖面本身就是判据」；★ 本轮问**它的第二次现身** ——「**同一族声明（闸门自证分数）在 §3.2 门禁清单里的那种排版，被扫到了吗？**」 |
| **W72 · ★★ 真缺陷（两处子缺陷）** | **⑴ 抽取窗口卡在表格列边界 `|`**：§3.2 写 `\| 8 \| \`scripts/audit-official-contract.mjs\` \| **E3 官方契约事前探针**（…，selftest 8/8） \|` —— 脚本名在**第 2 列**、分数在**第 3 列** ⇒ `after` 开头就是 `` ` `` + ` \| ` ⇒ `nextPipe = 2` ⇒ **窗口只有 2 字** ⇒ 永远抽不到；★ 实测 §3.2 里**共 11 处**同形态，其中 **4 处已过期**（`audit-shim-template-literal` 16→**20** · `audit-build-path-parity` 33→**38** · `audit-body-dup-ast` 6→**5** · `audit-official-contract` **跑不出分数行**）；**⑵ 8 个闸门未接入单源自证分数契约**（收尾长成 **5 种自造形态**：`3/3 PASS` / `PASS —— …` / `PASS 负控2·…` / 空行 / `8/8 PASS`）⇒ **机器一个都读不出**（**P-11 元级** / **P-50**）。 |
| **W72 · ★★ 决定性实验** | 把 §3.2 这些分数**改坏** ⇒ `audit-selftest-claims` / `audit-baseline-claims` **都 exit=0** ⇒ 该面**没有任何机器守着**（**P-30**）。 |
| **W72 · 修法（两边一起补）** | **抽取口径**认「**表格行跨列**」+ **装置侧**接入契约。★ 抽取侧是**收窄**而非放开（守 **P-38**）：⑴ **只对「真正的表格行」放开**（行首 `|`），散文行维持旧口径；⑵ ★★ **必须 `selftest` 字样在场**（它是「这一列在讲自证分数」的**语义标记**，旧口径卡 `|` 原本就是为防「把 `**16 态全生效**` 读成 `16/16`」）；⑶ 跨列时**取到本行最后一个 `|`** 为止；⑷ ★★ **§九 P 判据定义行（`| P-nn |`）不适用跨列**（那里写的是「**W51 已落地**：… selftest **24/24 → 36/36**」= **落地时的记账**）⇒ 新增**可判定的行级判据** `isPDefRow`（**P-61**）。★ 装置侧：**未接入 8 → 1**（仅剩 `audit-patch-markers.py`，属 **P-54 纪律④** 的工具型豁免，登记 **N15**）；且**「未接入」不是缺陷但必须可见**（**P-30**）—— 主流程逐条打印其名单。 |
| **W72 · ★ 首版踩到的假红** | 首版把「**整行含 `selftest`**」当作跨列依据 ⇒ 把**散文行**也放开，`audit-baseline-claims` 等 **5 处 P 判据定义行**被误报（L529/532/533/536/538）⇒ 收窄为 `isTableRow && !isPDefRow && …`。★ **识别特征**：报出量级与已知事实严重不符（**P-45**）。 |
| **W72 · 机器化与承重** | selftest **52/52 → 56/56**（**4 条成对控**：跨列正控 / 无 `selftest` 字样零控 / P 判据定义行零控 / **杠杆**）；**7 个装置接入契约**（`official-contract` / `body-dup-ast` / `artifact-freshness` / `method-binding` / `publish-hygiene` / `route-contract` / `a14-anchor-negctl`）；★★ **承重实验**：短路 `allowCrossCell` ⇒ **selftest 报 2 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（契约覆盖面按语义清点）** | **㉙ 契约的覆盖面必须按「语义」清点，不能按「写法」界定；且未覆盖者的名单必须出声。** ★★ 理由：**同一份声明在文档里有多种合法排版** —— 散文行内嵌（被抽到）与**表格行跨列**（`after` 开头即 `|` ⇒ 窗口只有 2 字 ⇒ **整类抽不到**）在报告上**完全同貌**（都是「0 违规」，**P-30**）。★★ **决定性实验**：把 §3.2 门禁清单里的自证分数改坏 ⇒ `audit-selftest-claims` / `audit-baseline-claims` **都 exit=0**。★ 配套三条：⑴ ★★ **凡「按写法」界定的扫描面，必须对真实仓库穷举「同一语义的其它合法写法」**（表格行跨列与散文行内嵌是**同一个声明**的两种合法排版；**P-45 第五次现身**）；⑵ ★★ **「什么时候不放开」必须写成可判定的行级判据**（本轮落为 `isPDefRow`），而不是靠人记得（**P-61**：收窄必须留下机器可判的记录）；⑶ ★★ **未接入契约者必须逐条出声** —— ★ **但「未接入」本身不是缺陷**（工具型脚本按 **P-54 纪律④** 正当豁免，**不得为了名单归零而硬凑 `--selftest`**，那会造出假自证）。★ 与 **P-54** 的关系：**P-54 的对象是「脚本扩展名」（`.mjs` vs `.py`），本条的对象是「文档排版形态」** —— ★★ **同一纪律在不同维度上的两次现身**。 |

---

### 附录四续五十六：第六十一轮 W71 —— **闸门头注的「汇总条数」过期了两处**（P-71）

> 起点：接 W70 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**扩判据是每轮高频动作 —— 那么『头注声明的东西』都跟着改了吗？**」

| 项 | 内容 |
|---|---|
| **W71 · 由头（P-11 元级）** | **P-59**（W54）确立「头注逐条声明的判据，实现里必须指认得出来」。★ 本轮问**它的补集**：「**头注标题那一行的「汇总条数」有人守吗？**」 |
| **W71 · 分诊（P-38 三段式）** | 不变量 =「头注里出现『判据（… N 条/项 …）』」⇒ **全仓穷举 184 个脚本** ⇒ **27 个**有此形态 ⇒ 逐个核对「声明数 vs 实现里标出的圈号数」。 |
| **W71 · ★★ 真缺陷（2 处）** | ⑴ `audit-doc-refs.mjs`：头注写「判据（**五条**）」而实现已是 **七条**（W65 加 ⑥、W69 加 ⑦ 时**只改了正文清单**）；⑵ `audit-goal-sections.mjs`：写「**五项**」而实现已是 **⑧ 条**（W43 加 ⑦、W52 加 ⑧）。★ **不是「完全没维护」，而是「维护了清单、漏了汇总数」**。 |
| **W71 · ★★ 决定性实验** | 把 `audit-doc-refs.mjs` 的头注改成「**一条**」⇒ **七个闸门全部 exit=0**。 |
| **W71 · ★ 为什么是结构性必然** | **「逐条写」是加法**（扩判据时顺手加）；**「汇总数」是元数据**（要人**回头**改）⇒ **扩一次判据，汇总数就过期一次，且没有任何信号**。★ 这是 **P-1** 在**元数据**上的现身：**同一份事实在文档里存在两份表述**。 |
| **W71 · ★★ 判据自己的两处口径缺陷** | ⑴ ★★ **「条」与「项」是同义写法** —— 首版正则只认「条」，而 `audit-goal-sections` 写「**五项**」⇒ **静默落进「无声明」分支** ⇒ **判据对它零覆盖**（**P-45/P-19**）；⑵ ★★ **负控注入方向选错** —— 首版注入「一条」（**小于**实现），而口径是「**≥**」⇒ **不报红、负控空转**（**P-30**）⇒ 改成注入「九十九条」。 |
| **W71 · 机器化与承重** | 扩 `audit-selftest-claims.mjs` 新增 `headNoteCountProblems`（判据 = 「声明 ≤ 实现条数」），selftest **41/41 → 52/52**（11 条控）+ 负控 **12/12 → 16/16**（**E** / **杠杆E**，并新增 `restoreSrc` 源码还原兜底 —— **P-48 三条纪律**）；★★ **承重实验**：短路判据 ⇒ **selftest 报 4 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（汇总数与清单必须同源）** | **㉘ 凡「逐条清单」与「它的汇总数」并存的地方，汇总数必须有机器守。** ★★ 理由：**「逐条写」是加法**（改一处就改一处）、**「汇总数」是元数据**（要人回头改）⇒ ★★ **汇总数的过期是结构性必然**，而它与「它恰好是对的」在报告上**完全同貌**（**P-30**）。★★ **决定性实验**：把某闸门头注的汇总数改坏 ⇒ **七个闸门全部 exit=0**。★ 配套三条：⑴ ★★ **判据口径 = 「声明数 ≤ 实现里标出的条数」**（**≥ 而非 =** —— 圈号可作**子编号** `⑦a`，实现多于声明是合法的；**声明 > 实现**才是真缺陷）；⑵ ★★ **零样本不得冒充通过**（有声明而全文无圈号 ⇒ **fail-closed**）；⑶ ★★ **同义写法必须都认**（「**条**」/「**项**」—— 只认一种会让整个闸门**静默落进「无声明」分支**，判据对它**零覆盖**）。★ 与 **P-59** 的分工：**P-59 管「内容」（逐条）· 本条管「元数据」（汇总）** —— ★★ **两者合起来才闭合**：只守逐条 ⇒ 汇总数过期；只守汇总 ⇒ 内容对不上。 |

---

### 附录四续五十五：第六十轮 W70 —— **同一纪律的「第二次现身」几乎总在另一个闸门里**（P-70）

> 起点：接 W69 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**W67 那条纪律（豁免分支必须补攻击样本控），只在它被发现的那一处应用了吗？**」

| 项 | 内容 |
|---|---|
| **W70 · 由头（P-11 元级）** | W67 在 `audit-baseline-claims.mjs` 上确立了「豁免词表不得含日常高频字 + 窗口必须紧贴」（**P-67 三条纪律**）。★ 本轮问**这条纪律的横向覆盖面**。★ 全仓 **14 个 `audit-*.mjs`** 逐个分诊（不变量 =「凡**有排除/豁免/跳过分支**的判据」，**不是**按已知函数名找）。 |
| **W70 · ★★ 真缺陷** | `audit-doc-refs.mjs` 的 `isNegatedNear` **一直是 ±40 字 + 更宽的词表**（含 `示例/举例/如：/例：/泛指`）—— ★ 比 W67 修的版本（±30 + 含 3 个高频字）**更宽**，且**从未有过攻击样本控**。 |
| **W70 · ★ 为什么藏得住** | 那 5 个高频词在**真实仓库 153 处受检引用里一次都没用到**（靠词表豁免的 10 处**全靠 `负控` 7 / `假红` 1 / 泛化名 2**）⇒ **纯风险、零收益**，且**永远不会自己暴露**（**「恰好没被触发」≠「它是对的」**）。 |
| **W70 · ★★ 决定性实验** | **6 个攻击样本，4 个被静默放过**：③ 豁免词修饰**别的东西**、真缺陷在同行 40 字内 ⇒ **放过**；⑤「举例」在真缺陷**前 35 字** ⇒ **放过**；⑥ 豁免词在前 **40 字**（窗口边缘）⇒ **放过**；★ 第 7 处：**「泛化名在前 + 真缺陷在后」** ⇒ 前者的「泛指」把后者一起豁免（**同行串扰**）。 |
| **W70 · 修法** | ⑴ 窗口 **±40 → 前 12 / 后 6**（新增 `NEG_WINDOW_AFTER`，后窗口从引用**末尾**起算 ⇒ 增 `len` 形参）；⑵ 两张词表各删 5 个高频词；⑶ **「泛化名」与「否定语境」语义分工**。★ 第 ⑵ 条后「正当豁免」由**紧贴**承接 ⇒ **真实仓库 0 假红**。 |
| **W70 · ★★ 过程中被自己证伪的两处** | ⑴ **旧控期望值过期**（W46 零控样本隔了 17 字 ⇒ 按新口径**应当报红**；判别：**这不是假红**，那句的「假证据」修饰的**不是这个引用**）；⑵ ★ **「紧贴的否定词 + 真缺陷」这条控与紧贴口径直接矛盾** ⇒ **不加**，并在代码注释里**写明为什么不加**（**P-61**）。 |
| **W70 · 机器化与承重** | selftest **59/59 → 68/68**（9 条控）+ 负控 **28/28 → 33/33**（**I** 窗口 / **I2** 词表 / **杠杆I**）；★★ **承重实验**：短路修法（窗口还原 ±40）⇒ **selftest 报 6 FAIL**（含 **W46 那条历史杠杆** —— **证明这条口径早在 W46 就该被守住**）。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（同族分支必须横向穷举）** | **㉗ 一条纪律收口后，必须立刻做一次「同族分支穷举」，且每处豁免分支都必须有「豁免词在场 + 真缺陷 ⇒ 必须报红」的攻击样本控。** ★★ 理由：**修好一处 ≠ 修好这类** —— 某条纪律已在 **A 处**收口（有 selftest 控、有负控、有承重实验），而 **B 处的同族分支连一条控都没有**，两者在报告上**完全同貌**（都绿）；★ 更隐蔽的是：**「B 处恰好没被真实语料触发」≠「B 处是对的」**（本仓实测：那 5 个高频词在 153 处引用里**零命中** ⇒ **纯风险、零收益**，且**永远不会自己暴露**）。★ 配套三条：⑴ ★★ **穷举必须按「语义不变量」找**（凡有 `continue` / 排除词表 / `isXxxNear` 判定的判据），**不得按已知的那个函数名找** —— 那只会找到同一处；⑵ ★★ **攻击样本控必须成对**（豁免词在场 + 真缺陷 **必须报红** ⇄ 正当豁免 **必须豁免**），只做一侧留下半个盲区（**P-58 的两侧纪律**）；⑶ ★★ **收紧口径时，「正当豁免」必须用「紧贴」承接，而不是用「更长的词表」** —— 词表越长**风险越大**（高频词会误伤），而紧贴窗口**自身就表达了「修饰关系」**这一语义。★ 与 **P-58**（同类声明跨**文档区段**）互为镜像：本条管**代码里同族判据的兄弟实例**；与 **P-67** 的分工：**P-67 讲「怎么修」，本条讲「去哪找下一处」**。 |

---

### 附录四续五十四：第五十九轮 W69 —— **跨文档的「章节号」引用必须可达**（P-69）

> 起点：接 W68 结语，按 §十二 第 3 条继续穷举。
> ★ 本轮问的是 ——「**点名了某份文档、又给了章节号**的引用，读者跨过去**那里真有这一节吗**？」

| 项 | 内容 |
|---|---|
| **W69 · 由头（P-11 元级 · 换语义不变量）** | W68 把「引用完整性」推到**文件内部编号**；本轮问**它的相邻格** —— 跨文档章节引用。★ 能被既有闸门覆盖的方向**不另写探针**（W56 纪律）。 |
| **W69 · 三段式穷举** | ① 按语义不变量枚举「<别名> §x.y」形态；② **全仓穷举 62 份 md**（抽全部 `§x.y` 引用 + 各文档**标题行**编号作「定义面」）；③ 逐条分诊。★ 穷举口径**两次被自己证伪**：首版把「正文里提到过该编号」也算可达（**同一段文字自己给自己作证** ⇒ 判据失去判据力，**P-30**）⇒ 只认**标题**；次版把「别的文档里有」也算可达（过松）⇒ 必须落在**被点名的那份文档里**。 |
| **W69 · ★ 第一轮读数** | 严格口径下全仓 **61 处**紧贴形态跨文档章节引用 ⇒ **0 处不可达**。★ **这一步很容易就此收工** —— 但**「恰好都对」不是判据力**（**W45 的教科书识别特征**）。 |
| **W69 · ★★ 决定性实验（真缺陷定型）** | 把 `GOAL.md` §九 那句 ``docs/MOBILE-TEST-METHODOLOGY.md`` §5.4 改成 **§5.99**（方法论**无此节**）⇒ ★★ **五个闸门全部 exit=0**（`audit-doc-refs` / `audit-goal-sections` / `audit-baseline-claims` / `audit-rule-claims` / `audit-selftest-claims`）。★ **方法学陷阱（当场踩到）**：首版注入点选在 **§十一 史实区**（被 mask）⇒ 测的是**别的判据**（**P-45**）⇒ 必须重做在**非史实区**（§九）。 |
| **W69 · ★★ 真缺陷的性质（与 W68 不同）** | W68 是「**引用确实不可达**」（内容错）；★ 本轮**引用全部可达** —— 真缺陷是「**这一面根本没有机器守**」（判据缺）；后者报告形态**更隐蔽**（什么都绿）。 |
| **W69 · ★★ 判据自己第一版就踩的坑** | 首版把**目标文档也 mask** ⇒ 真实仓库当场报 **4 处假红**（把真实存在的 §6.38 / §6.24 / §6.26 / §6.37 全判成「没有这一节」）。★ 根因：方法论 §6.x 的**逐轮结论小节全落在它自己的史实区（`## 六、`）内**。★★ **纪律**：**「引用侧」按区段语义 mask，「定义面」必须读全文** —— 两件事的扫描面**本就不同**（**P-45**）。 |
| **W69 · 机器化与承重** | `audit-doc-refs.mjs` 新增**判据 ⑦**（`scanXDocSectionProblems` + `sectionIdsOf` + 显式别名表 `XREF_DOC_ALIAS`），selftest **49/49 → 59/59**（10 条控）+ 负控 **23/23 → 28/28**（**H** 全名 / **H2** 简称 / **杠杆H**）；★★ **承重实验**：短路判据 ⑦ ⇒ **selftest 报 2 FAIL**。 |
| **结果** | 门禁 **48 条 `[gate] OK`**（双架构各 48）· sentinel **v363 一致** · M4 **169/0** · M7 **62 PASS / 0 FAIL / 19 SKIP** · vitest **1790/0** · typecheck 三段 0 错 · 设备残留 **0** · 23 会话 0 违规。 |
| **★ 契约条款：补充（引用的粒度必须守全）** | **㉖ 引用的完整性必须按「引用的粒度」分三格守全：跨文件路径 · 跨文档章节号 · 文件内编号。** ★★ 理由：三格对应**三种「读者能否按它找到」**，而**每一格的兜底机制完全不同** —— **跨文件路径**有 `fs.existsSync`（机器一查就知）；**文件内编号**（`§11.4` 引 `W55`）**没有任何东西兜底**；**跨文档章节号**（「方法论 §6.38」）**更隐蔽**：它**看起来**有兜底（文档存在、路径没错）而实际没有 ⇒ ★★ **改坏它，五个闸门全部 exit=0**（**P-30**）。★ 配套三条：⑴ ★★ **口径必须「紧贴 + 自指排除 + 无判据力只出声」** —— 别名后**紧接** `§x.y` 才算它的目标（否则行内别处的编号会被错认，**P-38**）；本文件里**也有**该编号 ⇒ **自指**（不属跨文档）；目标文档**读不到** ⇒ **只出声不报红**（**P-43**）。⑵ ★★ **「引用侧」与「定义面」的扫描面本就不同**（**P-45**）—— 引用侧按**区段语义 mask**（只判当前状态区），**定义面必须读全文**；本仓实测：方法论 §6.x 的逐轮结论小节**全落在它自己的史实区内** ⇒ 若把定义面也 mask，会把 **4 处真实存在**的章节判成「没有这一节」⇒ **假红**。⑶ ★★ **别名表必须显式登记**（不得靠近似匹配 —— 它会在措辞变化时**静默失效**，与 W66 的 `READING_PAIRS` 同纪律）。 |

---

### 附录四续五十三：第五十八轮 W68 —— **引用完整性必须扩展到「文档内部编号」**（P-68）

