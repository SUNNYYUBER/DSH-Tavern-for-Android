# ST Hook 体系 → DSH 移植的范式研究（2026-09-06）

> 缘起：贴吧评论「酒馆结构并没有过时，超多的钩子允许大范围的魔改才构造了现在的生态。
> 反倒是 dsh 插件式结构用来做 rp 过于工程化了。不要被"万物皆插件"给糊弄了，
> 魔改自由度上 ST 还要更胜一筹。」
>
> 方法：对本机 ST 源码（Luker 2.2.2 fork，= 用户实际在用的版本）做源码级全量盘点，
> 与 DSH rc.7 cordis 原语逐一对照，再映射我们已有的移植工作。
> 所有 ST 侧结论带 `文件:行号` 证据（根目录 = `旧sillytavern/Luker-现在在用的版本/`）。

---

## 1. 对这条评论的工程师解读

评论说对了一半，也说错了一半。

**对的一半**：ST 的生态壁垒确实是 hook 密度。ST 的 generate() 主管线（script.js:6861 的 `Generate()`）
从头到尾开了十几个可改写挂点，任何一个扩展都能拦在「WI 扫描前/后」「prompt 拼接前/后」
「请求体发出前」改写数据，甚至经 GENERATE_TAKEOVER_DISPATCH（script.js:8264）整轮接管生成。
魔改自由度 = 挂点数量 × 挂点的可写性。这正是我们移植工作的实质——**我们移植的每一个插件
机制，底层都是在回答"这个 ST hook 在 DSH 里对应什么"**。

**错的一半**：「DSH 万物皆插件 = 不够魔改」是误读。cordis 本身就是 hook 系统——
waterfall 事件（可改写）、emit 事件（只读通知）、service/slot 注册（提供者注册）三类原语
与 ST 完全同构，而且比 ST 多了两件 ST 没有的东西：**scoped dispatch**（事件按 agent/session
作用域路由 + 不变量校验）和 **typed wire**（typert 契约，跨进程/跨端类型安全）。
ST 的 hook 是"前端单进程全局 EventEmitter + 全局可变对象"，自由但零隔离——酒馆助手脚本
写崩了全端陪葬；DSH 的 hook 是有作用域和契约的。所谓"过于工程化"，代价是心智门槛，
换来的是可恢复性（我们的 rc.7 会话被写坏都能 repair 回来，ST 端 JSONL 写坏就是写坏）。

**结论**：两边 hook 体系同构，差距不在"有没有"，在"RP 域的挂点密度"。DSH 宿主给的是
通用 agent 挂点（pre-step/request/assemble/tools），RP 域特有的挂点（WI 扫描三段、
楼层事件、变体/回退事件、宏注册）宿主没有——**这层"RP hook 面"只能由我们的适配层自己提供**。
这就是下面的范式建议。

---

## 2. ST hook 体系四层分类（源码证据）

### 2.1 waterfall 型（可改写数据）——魔改的主力

| ST 挂点 | 证据 | 可改写内容 |
|---|---|---|
| GENERATION_CONTEXT_READY | script.js:7282（:7283-7288 读回） | coreChat / maxContext |
| GENERATION_BEFORE/AFTER_WORLD_INFO_SCAN | script.js:7343 / :7387 | WI 扫描输入、可强制重扫/覆盖结果 |
| GENERATION_WORLD_INFO_FINALIZED | script.js:7456 | WI 最终产物（before/after/depth/outlet 条目） |
| GENERATE_BEFORE_COMBINE_PROMPTS | script.js:8097（:8099 设 combinedPrompt 即接管拼接） | 全部组装件（storyString/main/jailbreak/WI…） |
| GENERATE_AFTER_COMBINE_PROMPTS | script.js:8106（:8107 读回 prompt） | 最终 prompt 文本 |
| GENERATE_AFTER_DATA | script.js:8181 | 请求体 generate_data |
| CHAT_COMPLETION_PROMPT_READY | openai.js:2004 | OAI 消息数组（引用改写） |
| GENERATION_AFTER_COMMANDS 的 textarea 桥 | script.js:6915-6926 | 用户输入文本 |
| getRegexedString 全管线 | regex/engine.js:825（placement 枚举 :772-783） | 输入/输出/prompt/显示/思维链各时机文本 |
| evaluateMacros / substituteParams | macros.js:610 / script.js:5222 | 一切过宏字段（消息/卡字段/WI/注入/模板…） |

### 2.2 接管/拦截型（夺取控制权）

| ST 挂点 | 证据 | 语义 |
|---|---|---|
| GENERATE_TAKEOVER_DISPATCH | script.js:8264 + message-takeover.js:17 | 塞 takeoverHandle 即整轮接管生成（setText/setReasoning/commit/discard），内核管落盘/回滚。EJS 提示词模板的"生成期自求值"、orchestrator 都走这类 |
| Generate 内 processCommands | script.js:6903 | 输入是 slash 命令则拦截生成改走命令 |
| abortController.abort() | script.js:1702/:8700 | 中止生成 |

### 2.3 只读通知型（emit）

117 个事件（events.js:3-120）。RP 相关的核心：MESSAGE_SENT/RECEIVED/EDITED/DELETED/SWIPED、
*_MESSAGE_RENDERED、CHAT_CHANGED/CHAT_LOADED、GENERATION_STARTED/STOPPED/ENDED、
STREAM_TOKEN_RECEIVED（:6293 流式逐 token）、SETTINGS_*、WORLDINFO_* 系、PERSONA_* 系。
Luker 增强：监听器按 pluginOrder/priority/注册序排序（eventemitter.js:141），
Hook Order 扩展用 `eventSource.setOrderConfig()`（:163）管理执行顺序。

### 2.4 registry 型（注册提供者）

| ST 挂点 | 证据 | 语义 |
|---|---|---|
| setExtensionPrompt | script.js:15271（存储 extension_prompts :1699） | position(NONE/IN_PROMPT/IN_CHAT/BEFORE_PROMPT) + depth(0=末条，上限10000) + role(SYSTEM/USER/ASSISTANT) + scan(是否参与WI扫描) + filter(每轮动态决定)——**这是所有"往 prompt 里塞东西"的扩展的统一入口**（作者注释/向量库/记忆扩展全走它） |
| MacroRegistry.registerMacro | macro-system.js:57 / engine/MacroRegistry.js:198 | 第三方注册新宏（自动识别来源扩展 :204） |
| SlashCommandParser.addCommandObject | SlashCommandParser.js:68 | 注册斜杠命令（:86-96 自动标记扩展来源） |
| extension_settings 键空间 | extensions.js:166-260 + :1740 | 扩展设置持久化 |
| renderExtensionTemplateAsync | extensions.js:162 | 设置 UI 模板挂载 |
| SillyTavern.getContext() | st-context.js:2185 | 把以上全部聚合暴露给第三方（酒馆助手就经这个拿 eventSource/triggerSlash/setExtensionPrompt） |

---

## 3. DSH cordis 同构原语对照

| ST 层 | DSH cordis 对应 | 证据（rc.7 宿主源码） |
|---|---|---|
| waterfall 改写 | waterfall 事件：`agent/pre-step`（decision.messages）、`agent/request`（请求 config）、`system-prompt/assemble`（assembly.sections）、`tools/pre-execute`、`agent/request-error` | dsh-agent-loop/lib/index.js:506/:716；dsh-system-prompt:342 |
| 接管/拦截 | pre-step `kind:'reject'` 否决 step；agent 模式本身就是"接管生成"（工具循环 = ST takeover 的超集）；`session/cancel` | agent-loop:515；dsh-agent README:136 |
| 只读通知 | emit 事件：`session/event`、`agent/status`、`session/flush`、`tools/result`、`agent/inbox/*`、`subagent/*`；scoped 路由（dsh-scope invariant 表 36 个事件） | dsh-scope/lib/invariant.js:9-37 |
| registry 注册 | `ctx.tools.register`、`ctx.systemPrompt.section/context/variable`、`settings.register`、skills、wire RPC 路由、client `ctx.slots.register` | dsh-system-prompt:229/:252/:286 |
| ST 没有、DSH 多出来的 | scoped dispatch（作用域路由+不变量）、typert wire 契约（跨端类型安全）、surfaceOp 投影（append/replace 视图原语——回退/变体的结构基础） | dsh-session/lib/index.js |

---

## 4. 我们的移植 = 逐 hook 映射（现状对照表）

| ST hook | 我们的落点 | 状态 |
|---|---|---|
| GENERATE_AFTER_COMBINE_PROMPTS（改最终 prompt） | `agent/pre-step` 里对 decision.messages 全批跑正则（三源合并）+ EJS filter/generate | ✅ |
| GENERATION_CONTEXT_READY（coreChat/maxContext） | pre-step 的批 + I7 重载荷截断 | ✅（预算裁剪由宿主 compaction 承担） |
| WI 三段 waterfall | pre-step 内嵌 triggerWorldInfo（扫描→正则→宏→分桶→深度 splice/快照） | ✅ 机制全，但**是单体闭包，不开放**（见 §5 差距①） |
| GENERATE_AFTER_DATA（改请求体） | `agent/request` 瀑布（⑧ 采样四键落地） | ✅ 本轮 |
| setExtensionPrompt（IN_CHAT depth/role） | WI atDepth + B4 @Inject + C8 th-injections + ⑧ 预设 depth 槽（全部真 splice + 签名快照） | ✅（role 受宿主 H-① 约束以节名承载） |
| setExtensionPrompt（IN_PROMPT/BEFORE_PROMPT 顶部） | `system-prompt/assemble` 瀑布（⑧ 预设 relative 条目进 request.system） | ✅ 本轮 |
| setExtensionPrompt 的 scan/filter 语义 | scan=WI 扫描文本含注入（scanSurfaceHistory 拼批）✅；filter=条件槽运行期求值 ✅ 本轮 | ✅ |
| GENERATE_TAKEOVER_DISPATCH（接管整轮） | DSH agent 模式（工具循环/subagent）——比 takeover 更强 | ✅ 原生 |
| 宏系统（evaluateMacros 全字段） | 生成期 expandCoreMacros/expandSnapshotMacros + 显示期 expandDisplayMacros + EJS 楼层自求值 | ✅ |
| MacroRegistry.registerMacro（第三方注册宏） | **无**——我们的宏引擎是固定表（dsht-plugin-shared/macros.ts 无注册 API） | ❌ 差距② |
| SlashCommandParser | 酒馆助手 triggerSlash 经 TH shim → 我们的斜杠执行面 | ✅（QuickReply 系未实现，R27 立项） |
| 只读事件（MESSAGE_*/CHAT_CHANGED/STREAM_TOKEN…） | TH host 事件桥（message_swiped/message_edited 已投递）+ RpScriptHost emitSessionEvent | 🟡 部分（ST 117 事件 vs 我们投了少量，C6 已补 82 项常量表但 host 投递未全覆盖）——差距③ |
| extension_settings | settings.register（schemastery z.object） | ✅ |
| Hook 顺序（Luker setOrderConfig） | cordis 监听序 = 注册序（无运行时重排） | 🟡 未移植（需求未出现） |

---

## 5. 三个结构性差距（范式级，非工作量级）

### 差距①：我们的 RP 管线是单体闭包，ST 是分段开放挂点

ST 的 generate() 每一段都是公共事件，**任何扩展**都能拦 WI 扫描、改组装件、改请求体
（hook-order 扩展甚至专门管这些挂点的执行顺序）。我们的 pre-step 是一个 700 行的大 handler：
正则→EJS→MVU→WI→注入→预设全在里面，**别的插件（包括未来的第三方 DSHT 插件）无法拦在中间**。
今天这不是问题（所有机制都是我们写的），但它正是"ST 生态"之所以是生态的原因。

**范式建议（hook 总线化）**：把 pre-step 大 handler 拆成自定义 cordis 事件链——

```
dsht-rp/before-regex (waterfall: messages)      → 正则三源合并挂点
dsht-rp/after-regex  (waterfall: messages)
dsht-rp/wi-scan      (waterfall: {history, entries} → 可改扫描输入/强制重扫)
dsht-rp/wi-finalize  (waterfall: buckets)        → WI 产物可改
dsht-rp/assemble     (waterfall: decision)       → 组装末期总改
dsht-rp/after-turn   (emit: {sessionId, turn})   → 只读通知
```

我们自己的正则/MVU/WI/预设模块全部降级为这些事件的**内置监听器**，TH 脚本和第三方插件
经同一总线挂入。这就是"从机制移植升级到生态移植"——也是让"DSH 做 RP 过于工程化"这个
批评失效的正解：工程化的是底座（cordis/scoped/wire），RP 域的 hook 面我们自己开。

### 差距②：宏引擎不可扩展

ST 的 MacroRegistry 允许任何扩展注册新宏（Luker 还自动识别来源）。我们的宏表是硬编码。
建议：宏引擎加 `registerMacro(name, handler)`，并经 cordis 暴露成服务（`ctx.dshtRpMacros`），
TH 脚本/其他插件可注册。这是 setExtensionPrompt 之外 ST 扩展最常用的第二个 registry 挂点。

### 差距③：事件桥覆盖度

ST 117 个事件 vs 我们桥给脚本沙箱的寥寥几个。C6 已把 82 项事件名常量补进 th-shim，
但 **host 侧实际投递**只覆盖 message_swiped/message_edited 等少数。建议按使用频率分批补：
P0 = MESSAGE_SENT/RECEIVED/DELETED/EDITED/SWIPED + CHAT_CHANGED + GENERATION_STARTED/ENDED
+ STREAM_TOKEN_RECEIVED（经宿主 session/event + agent/status 映射）；其余随真实卡需求补。

---

## 6. 落地优先级建议

| 序 | 项 | 价值 | 风险 |
|---|---|---|---|
| 1 | 差距③ P0 事件投递（7 个核心事件） | 酒馆助手脚本兼容性立竿见影 | 低（纯增量） |
| 2 | 差距② 宏注册 API | 重前端卡（自定义宏）解锁 | 低 |
| 3 | 差距① hook 总线化 | 生态位（第三方 DSHT 插件的前提） | 中（拆 700 行 handler，需回归全套实机验证） |

1、2 是增量小改动，可以随手做掉；3 是范式级重构，建议单独立项、在 APK 稳定后做。

---

## 8. 落地记录（2026-09-06，用户拍板「三层全做」）

**L1a 事件桥补全**（RpScriptHost.advance，dsht-rp-ui）：逐楼层投递（一次 advance 落多条逐条发）、
order 收缩 → `message_deleted`、running 期流式 token（`stream_token_received` 载荷 = 累计文本，
ST script.js:6293 同语义）、generation_started/ended 双命名空间同投（tavern + iframe js_* 变体）。
`chat_id_changed` 前轮已在（runtime 启动时投递）。

**L1b 宏注册 API**（ST MacroRegistry.registerMacro 对应物）：
- 引擎（dsht-plugin-shared/macros.ts）：`registerMacro/unregisterMacro/listCustomMacros/hydrateCustomMacros`
  ——字符串模板（内层 {{…}} 迭代展开接着求值）+ 同进程函数 handler 双形态；内置名拒绝覆盖；
  大小写不敏感。6 项单测（tests/macros-custom.spec.ts）。
- 宿主路由：`POST /dsht-rp/macros/register|unregister|list`（dsh-plugin），持久化 rp/macros.json
  （atomicWriteFile），启动水合。
- 多端一致性：dsh-plugin（生成期，启动水合）/ tavern-helper facade（预览，展开前水合）/
  dsht-plugin-mvu（状态栏，启动水合）/ 客户端显示期（loadDisplayRenderCtx 拉 /macros/list 水合
  DisplayMacroCtx.customMacros）——四处引擎副本同源。
- TH 脚本面：`TavernHelper.registerMacro(name, value)` / `unregisterMacro(name)`（桥 → 宿主路由）。

**L2+L3 pre-step 事件链化**（dsh-plugin）：设计决策 = **内置逻辑作 waterfall fallback**
（cordis 官方惯用法，与 agent/pre-step 默认 enter 决策同款）——第三方插件
`ctx.on('dsht-rp/xxx', (payload, next) => ...)` 可包裹/改写/否决（不调 next 即接管）。
事件链：`dsht-rp/turn`（emit）→ `dsht-rp/regex`（waterfall，ST getRegexedString prompt 时机）
→ `dsht-rp/wi-scan`（waterfall，ST WI 扫描三段）→ `dsht-rp/wi-activated`（emit，ST WORLD_INFO_ACTIVATED）
→ `dsht-rp/wi-finalize`（waterfall，ST WORLD_INFO_FINALIZED）→ `dsht-rp/assemble`（waterfall，
ST GENERATE_AFTER_COMBINE_PROMPTS/AFTER_DATA）。
工程细节：cordis dispatch 会把首个 object 参数误当 scope thisArg（cordis/lib/index.js:259），
所有自定义事件调用首参显式传 null。

**实机验证（emulator-5554 热更包）**：宏注册/预览展开/生成期一致/内置名保护/注销持久化 5 项 ✅；
完整对话轮回归（预设 system 注入 + depth 注入经事件链 fallback 无损）✅；vitest 655/655 ✅。

---

## 7. 附：研究附带发现（已回写 AUDIT_TASKLIST.md 本节）

- 本机"SillyTavern-1.16.0"实为 **Luker 2.2.2 fork**（package.json:127/134）：事件定义在
  `public/scripts/events.js`（非 vanilla 的 script.js），宏系统是 chevrotain 重写版
  （`public/scripts/macros/`），且有 vanilla 没有的挂点（GENERATION_CONTEXT_READY、
  WI 三段 waterfall、GENERATE_TAKEOVER_DISPATCH、Hook Order）。**我们对照移植的基准
  应该锚定这个 fork**——用户实际跑的 ST 就是它。
- 酒馆助手与 EJS 提示词模板在本机树里不存在（third-party 只有 .gitkeep）——它们的
  hook 证据来自其公开架构（getContext → eventSource / executeSlashCommandsWithOptions /
  setExtensionPrompt），如需行号级证据需把扩展实体放进 third-party 再盘。
