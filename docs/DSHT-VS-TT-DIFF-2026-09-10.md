# DSHT vs TT 逐条对照报告

> 生成时间：2026-09-10（心跳 31）
> 基准侧：TauriTavern-Canary（`golden/st/dump-006-1788962482643.json`，env=tauritavern）
> 对照侧：DSHT（`tmp/llm-029.json`，provider 层 fetch patch 截获，env=dshtavern）
> 采集方式：两侧同一张卡（ExampleGame ExampleWorld MVU Edition 0607）+ 同一预设（Kemini）+ 同一输入语义

---

## 0. 本报告的前提突破（心跳 31 成果）

前 30 个心跳一直卡在「拿不到 DSHT 主聊天 payload」。本轮定位到**真实读取链**：

```
settings.yaml
  └─ llm-pi-ai.providers.<route>.baseURL   ← 运行时生效位置
       ↑
  agent-default-model.provider = 'deepseek'  → 命中 llm-pi-ai 的 built-in catalog route 'deepseek'
       ↑
  ❌ 错误认知（前 30 心跳）：以为 providers 段整体是模板
  ❌ 错误尝试：只配了 st-custom 一条 route 的 baseURL，而真实发送走的是 deepseek route
```

**证据链（文件:行号）**：

| 断言 | 证据 |
|---|---|
| `llm-deepseek` 原生适配器注册的 route 是 `deepseek-official`，不是 `deepseek` | `packages/llm/llm-deepseek/src/index.ts:49` `const PROVIDER = 'deepseek-official'` |
| `llm-deepseek` 的 settings 命名空间是 `llm-deepseek`，path 平铺 | 同上 `:46` `NS = settingsNamespace('llm-deepseek')`；`:283` `settingsPath: []` |
| `deepseek` 这个名字属于 `llm-pi-ai` 的内置 catalog route | `packages/llm/llm-pi-ai/src/catalog.ts:100` `'deepseek': true`（THINKING_FORMAT_GATE） |
| pi-ai 的 baseURL 确实流入请求 | `packages/llm/llm-pi-ai/src/config.ts:429` `...source.baseURL === undefined ? {} : { baseURL: source.baseURL }` → `buildProvider` |
| 修改后实测生效 | 设备 `settings.yaml` 加 `llm-pi-ai.providers.deepseek.baseURL` 后，`llm-029.json` 的 `url` = `http://10.0.2.2:31102/v1/chat/completions` |

→ **心跳 31 完成**。DSHT 最终 payload 到手。

---

## 1. 总体差异（量化）

| 维度 | TT（基准） | DSHT | 比值 |
|---|---|---|---|
| 消息条数 | **25** | **71** | **2.84×** |
| 总字符数 | **85,437** | **426,950** | **5.00×** |
| role 分布 | system 22 / user 2 / assistant 1 | system 1 / user 53 / assistant 10 / tool 7 | 结构性不同 |
| 大块（>200字）重复组 | **0 组** | **4 组**（×6 / ×6 / ×5 / ×5） | **DSHT 独有缺陷** |
| `$1` 字面残留 | **0 条** | **7 条** | **存量脏数据** |

> 数据来源：DSHT 侧 = `llm-055.json`（mock 实际收到的 493KB 请求体，`messages=71`）；
> TT 侧 = `golden/st/dump-006-1788962482643.json`。

**DSHT 采样参数**：`model=deepseek-v4-flash`、`stream=true`、`max_tokens=22144`、
`temperature=1`、`thinking={"type":"disabled"}`、`tools=31`。

---

## 2. 逐项差异清单

### D-1　消息条数膨胀 2.84×，字符膨胀 5.00×　【严重】

- **TT**：25 条 / 85,437 字符。
- **DSHT**：71 条 / 426,950 字符。
- **原因**：DSHT 把同一批上下文（世界书 24221 字、角色卡 36185 字、记忆 2232 字、MVU 变量树 2573 字）在**每一轮对话历史里重复固化**，而非在最终组装时去重合并。
- **证据**：DSHT messages 索引 `[6][7][8]`、`[16][17][18][19]`、`[25][26][27][28]`、`[39][40][41][42]`、`[54][55][56][57]`、`[63][64][65][66]` —— **同一组内容出现 6 次**。
- **影响**：5× token 消耗；极易触发上下文截断；模型在重复上下文中注意力稀释（表现为回复质量下降/自我复读）。

### D-2　重复注入 4 组　【严重，DSHT 独有】—— ✅ **2026-09-10 已修复**

自动检测结果（>200 字分块按前 120 字聚类）：

| 重复次数 | 内容首行 |
|---|---|
| **×6** | `你正在进行角色扮演。你扮演「ExampleGame ExampleWorld MVU Edition 0607」…`（36185 字角色卡） |
| **×6** | `【剧情记忆（第 1-33 楼摘要；更早原文已折叠进本快照）】…`（2232 字） |
| **×5** | `Current active worldbook entries for this roleplay scene…`（24221 字世界书） |
| **×5** | `【角色状态（MVU 变量树，最新优先）】…`（2573 字） |

- **TT**：同类检测 **0 组** —— TT 的组装在最终阶段合并去重，每个上下文源只出现一次。
- **定性**：这是**静默失败族**的新成员 —— 注入 API 每次调用都成功返回，但调用方按「楼层」而非「会话最新态」重复调用，导致历史里堆叠。

#### 根因（2026-09-10 实机取证闭环）

**`dsht-plugin-memory` 的 `shadowSurface`（上下文瘦身）从未生效**，导致快照永不折叠。

- **直接原因**：DSH `0.1.2-rc.1` 中 `Session.events` getter **已从公开面移除**
  （设备拉取 `dsh-session` 产物：`get events` 出现 **0 次**）。
  memory 插件三处 call site 直读 `(session as {events}).events` → 得 `undefined`
  → `nodes` 恒空 → `estTokens = 0` → 小于 80k 阈值 → **提前 `return ''`**，
  一个 `replace` / `compaction/prune` 都不发。
- **取证链**：① 离线复刻 `planShadowOps` 对真实会话产出 13 个 op（389,066 → 67,935 字符），排除算法问题；
  ② 落盘探针捕到 `TypeError ... at index.js:1899`（`session.events` 为 undefined）；
  ③ 拉设备 `dsh-session` 产物确认 `get events` 已删、替代物为 `snapshotEvents(from,to)` + `eventAt(seq)`。
- **修复**：新增 `sessionEventAt(session, seq)` / `sessionEventsSnapshot(session)` 适配器
  （`packages/src/dsht-plugin-memory/index.ts` L288/L302，与 `dsh-plugin` 同语义），
  替换全部 4 处直读点（`floorsOfSession` / `shadowSurface` / `foldedUpToOf` / `scanWindowCopies`）。

#### 修复后实测（同一 wuwa 会话，实机）

| 指标 | 修复前 | 修复后 | 改善 |
|---|---|---|---|
| messages 条数 | **71** | **12** | **5.92×** ↓ |
| 总字符 | **463,320** | **127,794** | **3.63×** ↓ |
| 角色卡 | ×6（217,101 字） | **×1**（36,185 字） | 6× ↓ |
| 世界书 | ×6（145,365 字） | **×2**（48,498 字） | 3× ↓ |
| 剧情记忆 | ×6（11,176 字） | **×1**（2,348 字） | 6× ↓ |
| 状态树 | ×5（12,865 字） | **×1**（1,692 字） | 5× ↓ |
| 用户输入 | ×16（11,089 字） | **×2**（135 字） | 8× ↓ |

残留 ×2 项（世界书 / 运行时上下文）为**设计内行为**：`retained` 去重只抑制同 turn 的重复新增，
历史中已固化的旧副本由影子化在下一轮收敛；且世界书本轮发生真实变更（24277 → 24221 字），
新旧两份并存一轮属正常过渡态。

> **踩坑记录（本轮自身引入并已修复）**：改用 `esbuild --format=cjs` 打包导致
> `ReferenceError: module is not defined in ES module scope`
> —— profile 的 `package.json` 声明 `"type":"module"`，CJS 产物被当 ESM 加载，
> **整个 plugin tree 加载失败、Node 崩溃重启 39 次**（"No sessions yet" + "Disconnected" 的真凶）。
> **铁律**：本仓库所有插件一律 `--format=esm`（`build-dsht.ps1` L413/L438 即此约定）。
> 另：插件有**两份等价副本**，热推必须**同时**更新——
> `files/dsh-runtime/node_modules/<pkg>/lib/index.js` 与
> `files/.dsh/profiles/web/node_modules/<pkg>/lib/index.js`；后者才是运行时实际 import 的路径。

### D-3　role 映射策略完全不同　【结构性】—— ✅ **2026-09-10 主体已修复（system 槽位路由）**

- **TT**：22/25 条都是 `system`，只有 2 条 `user` + 1 条 `assistant`。
  - 所有世界书/角色卡/文风要求/大纲/记忆 → **全部折叠进 system 消息**。
  - 只有 `[13]` 用户实际输入（21 字）和 `[23]` `<User_latest_request>` 包装（106 字）是 user。
  - `[24]` 是 assistant 收尾（75 字，表单指令）。
- **DSHT（修复前）**：40 条 `user`、仅 1 条 `system`（24,773 字，是 DSH 自身的 agent 说明书）。
  - 角色卡/世界书/记忆全部以 **user 角色** 注入。
- **影响**：`user` 角色承载系统级指令，模型对 `user` 消息的服从度与 `system` 不同。这是**语义层级错位**，会直接改变模型的指令跟随行为。

#### 修复：`system-prompt/assemble` 的 `assembly.sections`（唯一合法通道）

四条证据链定死了「在哪里能改」：

1. `agent-loop/src/agent.ts:505` `markAgentLoopRequest(deepFreeze({...messages, system, tools}))`
   → loop 请求**深度冻结**，mutation throws。
2. 核心 API catalog 明文：`... so listeners read it, never rewrite it.`
   → **`llm/stream` 改写请求的方案被证伪**（原设计假设，已废弃）。
3. `session/src/index.ts:315` `expectedRole = type === "assistant/message" ? "assistant" : "user"`
   → **`user/message` 的 role 被核心钉死**，注入层无法产出 `system` 角色消息。
4. ✅ `agent-loop/src/agent.ts:230` `assemble(assembleContextFor(this, signal))`
   → `:337` `const system = renderPrompt(assembly)`（sections 按 order 升序，以 \n\n 拼接）
   → `:339` `buildRequest(..., system, session.deriveMessages(), ...)`
   → `agent/src/dispatch.ts:173` `assembleContextFor` 把 **live Agent 放进 `context.agent`**。

**故唯一合法通道 = `system-prompt/assemble` 瀑布返回的 `assembly.sections`。**

实现（`packages/src/dsh-plugin/index.ts` + `dsht-plugin-shared/tt-projection.ts`）：

- `gatherSlotSections(agent)`：assemble 内**现算**角色卡/状态树/记忆/表格 → `SlotSection[]`。
- 世界书（需 pre-step 的关键词扫描管线）由 pre-step `publishSlots` 发布，assemble 按 `name` 合并。
- `planSlotSections`：按 `SLOT_ORDERS` 排序 + 残余宏中性化 + 丢空段。
- `SLOT_ROUTING` 开关：`$DSH_HOME/rp/slot-routing-OFF` 存在即回滚旧行为（不改代码可 A/B）。
- 关闭时 pre-step 的 `with*Snapshot` 路径一字未动（行为与修复前完全一致）。

#### 实测（同 wuwa 会话，实机 logcat）

| 时点 | `system` | 说明 |
|---|---|---|
| 修复前 | **24,773 ch** | 仅 DSH agent 说明书；角色卡/世界书/状态树全在 user 席 |
| D-3 首轮 | **62,654 ch** | `[self=2 published=0]` — 角色卡 + 状态树，**首轮即生效** |
| D-3 次轮 | **86,877 ch** | `3 段 / 62,098ch (character, worldbook, state) [self=2 published=1]` |

`pre-step decision.messages` 从「用户输入 + 4 组快照」降为 **1 条 = 纯用户输入（13 字）**（turn 10 实测）。
→ user 席位污染消失，系统级内容全部归位 system。

#### 两个关键踩坑（已固化为铁律）

- **时序铁律**：turn 内顺序恒为 `assemble(:230) → pre-step(:233) → 渲染(:337)`，
  且无工具调用时**一 turn 仅一步**。故 pre-step 的发布对本 turn **不可见**（只对下一 turn 可见）。
  → 内容必须在 assemble 内现算，pre-step 发布只能作为**补充**来源。
  （首版只靠发布 → 首 turn system 恒空，实机探针 `slotPublished=none` 抓到。）
- **合并铁律**：多来源发布必须按 `name` **合并**而非覆盖。
  （首版覆盖式 → 世界书 24,221ch 被 withPresetLayer 的发布吃掉，`slot=2` 实机抓到。）

#### 残留（下一步）

历史楼层里 D-3 **之前**注入的 user 席快照（llm dump idx 14/15/16/30）仍会被 `deriveMessages`
带进请求，直到影子化把它们折叠掉。属过渡态，随轮次收敛。

### D-4　组装顺序不一致　【中】—— ⏳ 部分解决（绝对位置受核心约束不可达）

### D-4　组装顺序不一致　【中】—— ⏳ 部分解决（绝对位置受核心约束不可达）

- **TT 顺序**：`[0] 空 system → [1] 系统人设 → [2] 小说格式 → [3] stage_1 → [4] All_Context 开标签 → [5] 用户人设 → [6][7] 世界书 → [8][9] User_Prefs → [10] 小说原文 → [11] 过往记忆 → [12] 剧情大纲 → [13] 用户输入 → [14] 变量状态 → [15] 字体颜色 → [16] All_Context 闭标签 → [17] fox_extra 开 → [18][19][20] 文风/情节/人物 → [21] fox_extra 闭 → [22] stage_2 输出前检查 → [23] User_latest_request → [24] assistant 收尾`
- **DSHT 顺序**：`[0] DSH agent 说明 → [1..2] 历史 → [3] 注入标记 → [4] 运行时上下文 → [5] skill 提醒 → [6] 世界书 → [7] 角色卡 → [8] 记忆 → …（重复）… → [52] 本轮用户输入 → [53] 用户名（漂泊者）`
- **关键**：DSHT 把**用户最新输入放在第 52 条**（倒数第 7），而 TT 把它放在 `[23]`（倒数第 2，紧贴 assistant 收尾）。**末尾位置原则**在 DSHT 侧已被破坏。


- **D-3 已解决的部分**：系统级内容的**相对语义序**现在由 `SLOT_ORDERS` 统一裁定并与 TT 对齐
  （角色卡 20 → 世界书 25 → 记忆 30 → 剧情记忆 35 → 状态树 40 → 表格 45 → 预设 50）。
- **未解决**：用户输入的**绝对位置**仍由 `session.deriveMessages()`（耐久日志顺序）决定，即恒定在历史之后。
  TT 的「[13] 用户输入夹在 system 块中间 + [23] system 收尾 + [24] assistant 收尾」结构无法用合法通道复现 ——
  因为 `deriveMessages` 的顺序是核心对耐久日志的纯函数，而 `assembly.sections` 只能拼进 `system` 字符串
  （单一槽位，无法插进 messages 中间）。
  → **结论：D-4 的绝对位置对齐在当前 DSH 核心约束下不可达**，除非 DSH 核心开放 messages 投影点。

### D-5　`<interactive_input>` 包装行为　【已修 + 存量脏数据】

- **TT 基准**：`[13]` 用户输入是裸的 `（金标对照测试）请用一两句话简单打个招呼。` —— **TT 侧没有 `<interactive_input>` 包装**（TT 走的是不同预设链路）。
- **DSHT**：
  - 本轮新消息 `[68]` → `<interactive_input>\n（流式 mock 验证）请回一个字。\n</interactive_input>`、`[70]` → `<interactive_input>\n（单命令端到端验证）回一个字。\n</interactive_input>` —— **`$1` 修复已生效，内容正确** ✅
  - 自动检测：**7 条 `$1` 字面残留**（`[13][14][20][23][37]` 等）—— **存量脏数据**（这些楼层在 v196 修复前已写死进聊天记录）❌
- **待判定**：DSHT 的 `<interactive_input>` 包装本身是否应保留。TT 无此包装 → 若要「体验一致」，需确认该包装是 DSHT 预设作者显式添加的（那应保留），还是迁移导入引入的（那应移除）。

### D-6　工具/agent 层污染　【结构性】

- **DSHT 独有**：`[0]` 24,773 字的 DSH agent 说明书、7 条 `tool` 消息、10 条 `assistant` 思考链、`[4]` 运行时上下文、`[5]` skill 提醒、**31 个 `tools` 定义**。
- **TT**：完全没有这些 —— TT 是纯 RP 对话，无 agent 工具层。
- **影响**：DSHT 的 RP 消息要跟 agent 工具链抢注意力；`tools: 31` 会让模型在 RP 场景下产生工具调用倾向（历史样本 `[29]-[35]` 正是模型在查 worldbook 工具而非直接 RP）。

### D-7　采样参数差异　【低】

| 参数 | TT | DSHT |
|---|---|---|
| `model` | （TT 侧为 imported，未在 chat 内） | `deepseek-v4-flash` |
| `stream` | - | `true` |
| `max_tokens` | - | `22144` |
| `temperature` | - | `1` |
| `thinking` | - | `{"type":"disabled"}` |
| `tools` | 无 | **31 个** |

（TT 的采样参数在 `GENERATE_AFTER_COMBINE_PROMPTS` 的另一份 dump 里，需补齐对照。）

---

## 3. 结论

1. **心跳 31 目标达成**：DSHT 主聊天 payload 已可稳定截获（`baseURL` 写入 `llm-pi-ai.providers.deepseek`），
   且**端到端链路已实测打通** —— mock LLM 收到 DSHT 的完整 RP 请求（493,791B / `messages=71` / `stream=true`），
   DSHT 前端成功渲染 mock 回复（楼层 #14 前后截图取证）。
2. **发送自动化攻克**：CDP `Input.insertText` 可写入 Lexical 编辑器（旧「全灭」结论作废），
   工具化为 `rp-workspace/scripts/dsht-send.mjs`。
3. ~~**头号差异 = 重复注入（D-2）+ 条数膨胀（D-1）**：5.00× 字符膨胀、4 组大块重复（最高 ×6），且 TT 侧为 0。~~
   **→ 2026-09-10 已修复闭环**：根因是 `session.events` 在 DSH 0.1.2-rc.1 被移除导致 memory 插件影子化静默失效。
   修复后实机实测 **71 → 12 条 / 463,320 → 127,794 字符（3.63× ↓）**，角色卡 ×6→×1、剧情记忆 ×6→×1、状态树 ×5→×1。
4. **第二差异 = role 映射（D-3）与末尾位置（D-4）**：DSHT 把系统级指令塞进 `user` 角色（53 条 user vs TT 的 2 条）、
   把用户输入放在倒数第 3 位 —— 属**组装语义**错误，非 API 缺失。**（修复后仍存在：12 条里 10 条 user / 1 条 system，列为 P1）**
5. **`$1` 修复已确认生效**（新楼层内容正确）；历史 7 条 `$1` 为存量脏数据，需一次性清洗。
6. **agent 层污染（D-6）** 是 DSHT 架构固有 —— 需评估 RP 会话是否应关闭 tools（31 个）。

---

## 4. 下一步（优先级排序）

| 优先级 | 项 | 落点 |
|---|---|---|
| ~~P0~~ ✅ | ~~修重复注入（D-2）+ 条数膨胀（D-1）~~ **已修复**（`sessionEventAt`/`sessionEventsSnapshot` 适配器，实机 3.63× ↓） | `dsht-plugin-memory/index.ts` |
| P0 | 清洗 7 条存量 `$1` 脏楼层（D-5） | 一次性 migration：扫 `storages/session_projcache/sessions/*.json` |
| P1 | role 映射对齐 TT（D-3：系统级注入走 system） | RP 插件注入层 |
| P1 | 用户输入移到末尾（D-4） | prompt 组装顺序 |
| P2 | 评估 RP 会话关闭 tools（D-6） | 会话/预设配置 |
| P2 | 补 TT 的 `GENERATE_AFTER_COMBINE_PROMPTS` 采样参数对照（D-7） | 采集脚本 |
| P2 | golden 接收器迁入 `ctx.webServer` 前缀路由（摆脱宿主进程回收） | `dsh-plugin/index.ts` webServer 段 |

---

## 附录：验证链路取证

| 环节 | 证据 |
|---|---|
| baseURL 生效 | `llm-029.json.url = http://10.0.2.2:31102/v1/chat/completions` |
| 请求真实到达 mock | `mock.log: POST /v1/chat/completions (493791B) messages=71 stream=true` |
| DSHT 渲染回复 | 截图 `tmp/dsht-n6.png` 楼层 #14 显示 mock 固定回复 |
| `$1` 修复生效 | 截图楼层 #14 `<interactive_input>（单命令端到端验证）回一个字。</interactive_input>` |
| 自动化发送 | `dsht-send.mjs` 输出「✓ 文本注入成功 / ✓ 已发送（编辑器已清空）」 |

**环境约束记录**：WorkBuddy 沙箱会在每个 tool call 边界回收后台 node 进程
（nohup / spawn(detached) / cmd start 均失效）。因此「起服务 → 发送 → 采集」必须压在
**同一个 tool call** 内完成，或把服务迁进 app 进程（`ctx.webServer`）。
