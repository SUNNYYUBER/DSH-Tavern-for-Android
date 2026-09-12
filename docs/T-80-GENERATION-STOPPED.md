# T-80 · `generation_stopped` 修复 + 余项重新分档（心跳 68）

> 建立：2026-09-12（心跳 68）。上游报告：`docs/T-80-CARD-EVENT-SURFACE.md`（心跳 67，缺陷族发现与闸门化）。
> 被测改动：`rp-workspace/packages/src/dsht-rp-ui/src/client/RpScriptHost.tsx` 的 `advance()`。

---

## 一句话结论

T-80 登记的 10 个「卡注册、我方零发射」事件中，**本轮修掉第 2 个**（`generation_stopped`，差集 10 → 9 → **8**）；
同时把余下 8 项从「模糊的待补清单」升级为**逐项有终局判定的分档表** —— 其中 **2 项属结构性不可实现**
（不是"还没做"，而是"在当前架构下做不对"），**1 项的"低成本"标注被本轮取证推翻**。

---

## 一、为什么这一项能修，而其余 8 项不能

判据来自项目铁律 **L126**：补事件有两种失败方式，**②比①更坏**。

| 失败方式 | 症状 | 可发现性 |
|---|---|---|
| ① 不补 | 卡的回调**永不执行** | 干净的缺失；审计可静态穷举（L43） |
| ② 补了但**形状/时机不对** | 回调**执行了**，却拿到错数据 / 在错误时刻被叫醒 | 症状会被归因到卡身上；**零报错** |

`generation_stopped` 是唯一同时满足以下三点的余项：

1. **零形状风险** —— 基准 `SillyTavern-reference/public/script.js:5559` 是 `eventSource.emit(event_types.GENERATION_STOPPED);`
   **无参数**。没有形状可以填错。
2. **时机判据在 DSH 侧已存在且语义同构**（下节取证），无需新造标志位。
3. **无跨层需求** —— 判据取自快照，落在 UI 侧，不碰 cordis 层。

余 8 项至少违反其中一条（分档见 §六）。

---

## 二、基准取证（"真 ST 会不会发、怎么发"）

| 事实 | 出处 |
|---|---|
| 事件名常量 | `public/scripts/events.js:24` → `GENERATION_STOPPED: 'generation_stopped'` |
| **唯一**发射点 | `public/script.js:5559`，在 `stopGeneration()` 函数体内 |
| 发射条件 | **无条件发**（`stopGeneration()` 即使 `stopped` 为 false 也照发） |
| 载荷 | **无参数** |
| 触发场景 | 用户点停止按钮 / 主动 abort |
| 与 `GENERATION_ENDED` 的顺序 | **ENDED 先、STOPPED 后**：`stopGeneration()` 内 `abortController.abort()` 之后调 `hideStopButton()`，后者（`public/script.js:3477`）在按钮可见时发 `GENERATION_ENDED`；回到函数体末尾才发 `GENERATION_STOPPED` |
| TH 常量表 | `tmp/tt-data/.../JS-Slash-Runner/@types/iframe/event.d.ts:207` → 该名只在 **`tavern_events`** 枚举（188 起）；**`iframe_events`（172–183）不含** ⇒ **单命名空间**，不得造 `js_generation_stopped` |

---

## 三、DSH 侧契机取证（"我方凭什么知道这一轮是被停止的"）

| 事实 | 出处 |
|---|---|
| 节点终态枚举 | `deepseek-harness/packages/client/ui-conversation/src/client/contract/chat-nodes.ts:22` → `status: 'running' \| 'settled' \| 'interrupted'` |
| `interrupted` 的产生条件 | `deepseek-harness/packages/core/agent-loop/src/agent.ts:355` —— **仅在 `signal.aborted` 的 catch 分支**里给 `assistant/message` 写 `interrupted: true` |
| 语义的权威明文 | `deepseek-harness/packages/core/session/src/types.ts:273` —— "A turn **cancelled mid-stream** finalizes its delivered text/reasoning prefix as this event with `interrupted: true` … **The marker distinguishes that prefix**" |
| 正常结束 | 写 `settled` |

⇒ `running → interrupted` 跃迁 **⟺** 「这一轮被取消」 **⟺** ST `stopGeneration()`。
不需要新造状态位，也不需要拉取额外数据。

---

## 四、本轮实施（3 处，全在 `RpScriptHost.tsx`）

### 4.1 新增逐节点状态记录

```ts
/** 【T-80】各节点上一轮 status（`generation_stopped` 判据 = running → interrupted 跃迁） */
private readonly prevNodeStatus = new Map<string, string>()
```

### 4.2 `advance()` 内做「跃迁侦查」（只认跃迁，不认既存态）

```ts
const stoppedKeys: string[] = []
if (chat?.nodes) {
  for (const n of chat.nodes.values()) {
    const key = typeof n.key === 'string' ? n.key : ''
    if (!key) continue
    const status = typeof n.data?.status === 'string' ? n.data.status : ''
    if (this.prevNodeStatus.get(key) === 'running' && status === 'interrupted') stoppedKeys.push(key)
    this.prevNodeStatus.set(key, status)
  }
}
```

**为什么必须「只认跃迁」**：若改成"扫到 `interrupted` 就发"，则**冷加载 / 重连 / 切会话**时，
快照里既存的历史 interrupted 节点会被误报成"刚刚被停止"（ST 不会）。`prevNodeStatus` 用
"未见过的 key ⇒ 无跃迁"天然挡住了这一类，**不需要额外的"首轮跳过"标志**。

### 4.3 在既有「running → !running」块内投递

```ts
if (this.prevRunning && !running) {
  this.emitSessionEvent('generation_ended', [order])
  this.emitSessionEvent('js_generation_ended', [order])
  this.emitSessionEvent('js_stream_token_received_fully', [])
  // ← 本行之后：generation_stopped
  for (let i = 0; i < stoppedKeys.length; i++) this.emitSessionEvent('generation_stopped', [])
  this.loadContextSnapshot()
}
```

- **顺序**：排在 `generation_ended` **之后**，对齐基准（§二）。
- **单命名空间**：只投 `generation_stopped`，不投 `js_` 变体（§二最后一行）。
- 复用 `prevRunning` 守卫而非独立触发点，与其现有 `generation_started/ended` 语义同源。

---

## 五、闸门与收敛

`scripts/audit-card-event-surface.mjs` 复跑（**真实语料 54 脚本 / 7.3 MB**）：

```
我方表：tavern_events 82 · iframe_events 6 · event_types 104
语料：54 个脚本文件 · 注册到 22 个事件值（另有 0 个我方表里没有的常量）
我方发射面：18 个事件值
差集 8 项（基线内 8 · 表外新增 0）        [exit 0]
✓ --selftest 通过（注册面 6 形态 / 表解析 82·6·104 / 表定义剔除 / 发射面负控 / 差集口径 / 基线白名单正负控）
```

**发射面 17 → 18，差集 10 → 9（心跳 67 修 `message_updated`）→ 8（本轮）**。
基线 `scripts/card-event-surface-baseline.json` 已把 `generation_stopped` 从 `known` 移入
**`_converged`**（保留"为什么不再缺"的取证，并防它被当成"又缺了"重新登记）。

---

## 六、余 8 项的重新分档（本轮取证后）

> ⚠️ 心跳 67 把 3 个 worldinfo 项标为「跨层（**可低成本补**）」。**本轮取证推翻了该标注**。

### A 档 · 结构性不可实现（应判「不做 + 明示降级」，而非半吊子补发）

| 事件 | 基准 | 为什么做不了 |
|---|---|---|
| `worldinfo_scan_done` | `world-info.js:5056`（**在 `while` 扫描循环内**） | 🔴 **不是纯通知**：发射后紧接 `if (args.state.next !== scanState) { scanState = args.state.next }`，原注释明文 "Some fields are allowed to be changed by listeners"（同批被回读的还有 `budget.current/overflowed`、`recursionDelay.currentLevel`、`activated.text`）。这是**同页同步可变回路**，驱动 ST 的**递归世界书**。我方扫描在服务端 cordis 层、卡在 WebView 帧，**结构上无法同步回写**。只投只读快照 = 卡以为安排了递归而实际没有 ⇒ L126 的「②静默做错事」，**比不投更坏**。 |
| `world_info_activated`（消费面之一） | `world-info.js:902` | 语料 `世界书控制_0708.js:4140-4159` 是**干跑同步收集**：调 `getWorldInfoPrompt(mock,…)`，在**该调用期间**同步收事件并取 `detail[i].uid` 判断哪些条目会触发。同步回路同样不可达。 |

### B 档 · 可做但**必须先定形状**（否则就是 L126 的「②」）

| 事件 | 卡住的点 |
|---|---|
| `world_info_activated`（观测面） | 基准载荷 = `Array.from(allActivatedEntries.values())` = **完整 WI 条目对象**（`world/uid/comment/key/content/constant/position/depth…`）。我方 `/dsht-rp/trace`（`index.ts:6334`）**已暴露**且 UI 侧 `rpApi`（`rpc.ts:104`）**可直接拉**，但 `:4338` 把 `traceRuntime.activatedEntries` 收成了 `{comment,reason,position}` **三字段**。观测型消费者（`示例预设 V17.1:55449` 的 `ssLogNativeWorldInfoEntries`）实际要读 `world`/`uid`/`comment` + `constant` 判蓝绿灯 ⇒ 精简形**不够**。⇒ 需先把 trace 载荷扩到完整条目，改动落在 `dsh-plugin/index.ts`。 |
| `preset_changed` | 基准 `{ apiId, name }`，`apiId ∈ {openai,kobold,novel,textgenerationwebui}`。我方非这四个后端之一 ⇒ 乱填 = 从「不回调」变成「回调里分支不命中」。**需先读卡的消费端再定值**（已见语料 `示例预设:30981` 只做 `syncSmoothStreamState('preset_changed')`，**不读载荷** —— 但样本不足，须全语料普查后才可定）。 |
| `character_message_rendered` | 载荷 `(messageId, type)`，`type = 'normal' \| 'swipe' \| …`。语义是「渲染完成后」；我方脚本帧内**恒无聊天 DOM**（T-77 已证）⇒ 无真实渲染时机。补发 = 语义近似，且 `type` 取值未定。 |

### C 档 · 通道已存在，缺的是「时机」定义

| 事件 | 卡住的点 |
|---|---|
| `worldinfo_entries_loaded` | 载荷 `{ globalLore, characterLore, chatLore, personaLore }`。**读取面已就绪**：facade 已有 `/worldbook/list`·`/worldbook/get`（`dsht-plugin-tavern-helper/index.ts:647-654`），UI 侧 `rpApi`/`thApi` 可直接拉 ⇒ **不需要新通道**。缺的是「这四组的等价来源」与「何时算加载完成」——基准在**生成期**（`checkWorldInfo()` 内）发射，我方若挪到开局期即违反 L36 的「时机也要对」。 |

### D 档 · 需宿主侧对象（同 D-4/D-6 族约束，短期内不做）

| 事件 | 原因 |
|---|---|
| `chat_completion_settings_ready` | 参数是完整请求体 `generate_data`；该对象在 DSH 宿主侧组装，插件拿不到 |
| `generate_after_data` | 同上，需 `generate_data` 句柄 |
| `GENERATION_AFTER_COMMANDS` | 需「指令解析之后、生成之前」的钩子面，我方无该钩子（同 D-4 族核心约束） |

---

## 七、实机验收

探针：`stage3-device/hb68/t80g-generation-stopped-probe.mjs`（**零副作用**设计）。
用例：帧内常量面 3 项 + 宿主页合成快照 3 案（1 正控 + 2 负控）。

| # | 判据 | 期望 |
|---|---|---|
| 1 | 帧内 `tavern_events.GENERATION_STOPPED` 有值 | `'generation_stopped'` |
| 2 | 帧内 `iframe_events` 不含 STOPPED 变体 | `[]`（⇒ 单命名空间） |
| 3 | 帧内 `eventOn(tavern_events.GENERATION_STOPPED, cb)` 注册成功 | 返回带 `.stop()` 的句柄 |
| 4a | 正控 `running → interrupted` | 投 `generation_stopped` |
| 4b | 正控顺序 | `generation_stopped` 在 `generation_ended` **之后** |
| 4c | 正控次数 | 恰好 1 次 |
| 5 | 负控1 `running → settled` | **不投**（L36 不能多） |
| 6 | 负控2 首见即 `interrupted` | **不投**（冷加载/重连不误报） |

**零副作用怎么保证**：
- `rt.emitSessionEvent` 换成**记录且不转发**的拦截器 ⇒ 帧内 `eventSource` 收不到 ⇒ 卡回调不执行 ⇒ 会话零写入；
- `rt.loadContextSnapshot` 在探针期替成空函数 ⇒ **零网络**；
- 三案在**同一个同步表达式**内跑完（JS 单线程）⇒ React 重渲染**无法插入**到 `advance()` 之间，测试态不被真快照污染；
- 收场全部恢复原方法。

**实跑结果**：见 `stage3-device/hb68/RESULT.md`（与产物 md5 一并记录）。

---

## 八、诚实边界（4 条）

1. **「拦截时零内容」场景投不出**：DSH 契约明文（`session/types.ts:273`）"An aborted turn with **no such event** streamed no visible content" ——
   即在**首个 token 之前**就被停止时，**不写** `assistant/message` 事件 ⇒ 无节点 ⇒ 无跃迁 ⇒ 投不出。
   而 ST 的 `stopGeneration()` 是**无条件发**（§二）⇒ 此为**已知且有意保留的保真缺口**（要补需在 DSH 内核侧改，属上游）。
   影响：卡在"瞬停"场景收不到停止通知 —— 比"正常结束被误报成停止"轻得多（后者会污染卡的状态机）。
2. **`stopGeneration()` 在"未在生成"时也发**（ST 无条件发）。我方要求真跃迁 ⇒ 空闲时点停止**不发**。
   判为**更优**行为，但确实与基准字面不同，故记录在案。
3. **`interrupted` 不完全等于"用户点了停止"**：`signal.aborted` 的任何来源（含宿主内部 abort）都会置位。
   与 ST 的 `abortController.abort()` 覆盖面基本一致，但非严格等价。
4. **合成快照 ≠ 真停止**：本轮实机验收走的是「喂合成快照到**真产物内的真 `advance()`**」，
   证明了**逻辑与产物内改动生效**；而「真实点停止按钮 → DSH 写出 `interrupted: true`」这一段
   是**源码级取证**（`agent.ts:355`），**未做端到端真机停止实测**（需接真实模型 API 发一轮再中断）。

---

## 九、可复跑命令

```bash
# 1) 静态闸门（含正控）
node rp-workspace/scripts/audit-card-event-surface.mjs
node rp-workspace/scripts/audit-card-event-surface.mjs --selftest

# 2) 类型闸门（三段式）
cd rp-workspace/packages && npm run typecheck

# 3) 实机探针（前置：adb forward tcp:9333 …，且 App 内已打开一个 RP 会话）
node stage3-device/hb68/t80g-generation-stopped-probe.mjs
```
