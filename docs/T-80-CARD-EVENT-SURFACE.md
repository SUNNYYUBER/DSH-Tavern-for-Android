# T-80 卡事件面缺口报告（10 项「注册了但永不触发」）

> 建立：2026-09-12（心跳 67）
> 判据工具：`rp-workspace/scripts/audit-card-event-surface.mjs`（正控 `--selftest` 通过）
> 基线：`rp-workspace/scripts/card-event-surface-baseline.json`
> 语料：设备上全部真实 TH 脚本（54 个 / 7.3 MB，12 卡 + 7 预设；由 `stage3-device/hb63/extract-corpus.mjs` 导出）
> 基准：TauriTavern-Canary 内置的 `SillyTavern-reference`

---

## 1. 一句话结论

**卡脚本注册的 22 个事件里，有 10 个我方零发射点** —— `eventOn()` 注册成功、零报错、零 warn，
但回调**永不执行**。经基准对照，这 10 项**全部**在真 ST 里都有 `emit`，
即属 **L36 意义上的「真缺口」**（跟基准比少了），不是"我方多报"。

这是本项目主力缺陷族（**静默失败**）的又一整类实例：**功能死了，日志干净**。

---

## 2. 发现方法：一次性静态穷举（L43）

此前 20+ 个心跳里，这类问题只能靠「卡报错」或「逐墙试错」发现 —— 而它**恰恰不报错**，
所以从未被发现。本轮改用**静态穷举**：

```
注册面 = 扫语料里所有
         tavern_events.X / iframe_events.X / event_types.X / eventTypes.X
         eventOn('字面量') / eventSource.on|once|makeFirst|makeLast('字面量')
发射面 = 扫我方源码里出现的「事件值字面量」（**剔除三张常量表自身的定义块**）
差集   = 卡注册了 ∧ 我方从不发  ⇒  候选静默失败项
```

**为什么必须剔除表定义块**：`th-shim.ts` 的 `TAVERN_EVENTS` 表里逐字写着 `'message_updated'`。
若不剔除，表自己就会"自证已发射" ⇒ **整表 82 项永远全绿**（假绿）。
`--selftest` 为此专门有一条负控断言（"表定义块未被剔除 = 假绿"）。

**枚举器先过正控（L44）**：`--selftest` 覆盖六个维度 ——
注册面 6 类形态 · 三张表条目数（82 / 6 / 104）· 表定义剔除 · 发射面负控 · 差集口径 · 基线白名单正负控。
**首版正控当场抓出两个实现缺陷**（`eventTypes`（camelCase）形态未支持；白名单测试入参写错），
若不跑正控，工具会给出"看着干净"的假结论。

---

## 3. 数据

| 量 | 值 |
|---|---|
| 语料 | 54 个脚本文件 / 7.3 MB |
| 卡注册到的事件值 | **22** |
| 我方发射面 | **17**（含本轮新补 1） |
| **差集（零发射点）** | **9**（原 10，已收口 1） |
| 我方表里没有的常量 | **0**（`tavern_events` 82 项 / `iframe_events` 6 项 / `event_types` 104 项皆完整） |

> 「表里没有的常量 = 0」这条本身是个**正面结论**：卡用到的每个常量键都在表里
> ⇒ 不存在"值恒 `undefined`、注册到 `undefined` 键"的更坏形态。

---

## 4. 逐项基准取证（判「该不该补」的依据 → L36）

| # | 事件值 | 基准 emit 处（file:line） | 基准次数 | 参数形状 | 分档 |
|---|---|---|---|---|---|
| 1 | `message_updated` | `script.js:8277` / `:8371`；`slash-commands.js:5856/5922` | 4 | `messageId:number` | ✅ **本轮已修** |
| 2 | `world_info_activated` | `scripts/world-info.js:902` | 1 | 激活条目数组 | 🟡 跨层（数据已在服务端） |
| 3 | `worldinfo_entries_loaded` | `scripts/world-info.js:4492` | 1 | `{globalLore, characterLore, chatLore, personaLore}` | 🟡 跨层 |
| 4 | `worldinfo_scan_done` | `scripts/world-info.js:5056` | 1 | `args`（扫描产物） | 🟡 跨层（**须与 2/3 同批**） |
| 5 | `character_message_rendered` | `script.js:3741` / `:6634` / `:6659` / `:6681` | 12 | `(messageId, type)` | 🔴 呈现层（无真实渲染时机） |
| 6 | `GENERATION_AFTER_COMMANDS` | `script.js:4262` | 1 | `(type, options, dryRun)` | 🔴 生成栈 |
| 7 | `chat_completion_settings_ready` | `scripts/openai.js:3052` | 1 | `generate_data` | 🔴 生成栈 |
| 8 | `generate_after_data` | `script.js:5259` | 1 | `(generate_data, dryRun)` | 🔴 生成栈 |
| 9 | `preset_changed` | `openai.js:4957` 等 4 处 | 4 | `{apiId, name}` | 🟠 数据模型（`apiId` 取值未定） |
| 10 | `generation_stopped` | `script.js:5559` | 1 | **无参** | 🟠 时序（缺"被停止"判据） |

**卡侧证据**：上表每项都能在语料里找到 `eventOn(tavern_events.<NAME>, cb)` 的实际注册点
（工具输出逐项列出文件名）；其中卡 1 类（预设助手型）的回调体内可见实质逻辑
（如 `if (!should_enable || !enabled || dryRun === true) ...` 的条件启用分支）
⇒ 不是"注册了没用"，而是**功能被静默关掉**。

---

## 5. 分档处置（为什么不一次全补）

**核心纪律：不做"为了发而发"**。补一个事件有**两种失败方式**，第二种比第一种更坏：

1. 不补 → 回调永不执行（当前状态，至少是"干净的缺失"）
2. **补了但参数形状/时机不对** → 回调**执行了，拿到错数据** ⇒ 从"不生效"变成"**静默做错事**"

所以只有**形状与时机都能逐字对齐基准**的项才在本轮实施。

| 分档 | 项 | 处置 |
|---|---|---|
| ✅ 已修 | `message_updated` | 见 §6 |
| 🟡 可低成本补（**建议下轮同批做**） | 3 个 worldinfo 事件 | 数据**已存在**于服务端（下方 §7）；缺的只是一条「服务端结果 → UI → eventSource」通道 |
| 🟠 需先定语义 | `preset_changed` / `generation_stopped` | 前者的 `apiId` 取值、后者的"被停止"判据都需先确定，否则会走失败方式 2 |
| 🔴 生成栈（同 D-4/D-6 族约束） | 4 项 | 参数是 DSH 宿主侧的请求体对象（`generate_data` 等），插件拿不到；属宿主编排层，需与 D-4 一并评估 |
| 🔴 呈现层 | `character_message_rendered` | 基准语义是"**渲染完成后**"；我方脚本帧内**恒无聊天 DOM**（T-77 已证）⇒ 没有真实渲染时机 |

---

## 6. 本轮实施（已修 1 项）

**`message_updated`**（`packages/src/dsht-rp-ui/src/client/RpScriptHost.tsx`，`emitNativeChatEvent()`）：

```
if (eventType === 'message_edited') this.emitSessionEvent('message_updated', [floor])
```

**为什么只选它**：
- 语义包含关系明确：**编辑 ⊂ 更新**（基准 `MESSAGE_UPDATED` 覆盖编辑与命令改消息两类时机）
- 载荷形状**完全同形**：我方 `[floor]`（楼层号）≡ 基准的 `messageId`
- 时机已有现成路径：我方 `message_edited` 桥早已存在，只是**没同时发**这个更宽的名字
- 纯增量：不改变任何既有事件的行为（不碰 `message_edited` 本身）

**为什么 swipe 不发**：基准 swipe 只发 `MESSAGE_SWIPED`，不发 `MESSAGE_UPDATED`
⇒ 多发即违反 L36。

**收敛证据**：差集 **10 → 9**（`audit-card-event-surface.mjs` 复跑）。

---

## 7. 顺手挖出的第二条链（跨层断裂）

服务端**已经**在发事件，只是 UI 侧听不见：

```
dsh-plugin/index.ts:4331   ctx.emit(null, 'dsht-rp/wi-activated', { sessionId, slug, turn, entries })
                           ↑ 存在，且数据完整（激活条目 comment + reason）
UI 侧 grep 'dsht-rp/wi-activated'  → 0 命中   ↑ 没有任何监听者
```

**原因**：`dsh-plugin`（cordis runner 层）与 `dsht-rp-ui`（WebView UI 层）**不是同一个 JS 上下文**，
cordis 广播**不跨层**。⇒ 服务端"发了个没人听的事件"，UI 侧"从没收到过"。

这解释了为什么 3 个 worldinfo 事件的分档是"跨层可低成本补"：
**数据源已经就绪**（`traceRuntime.activatedEntries` 也在），缺的只是**一条拉取通道**。

---

## 8. 闸门与判据（可复跑）

```bash
# 正控（含负控）
node rp-workspace/scripts/audit-card-event-surface.mjs --selftest

# 真实语料审计（缺集 ⊆ 基线 ⇒ exit 0；出现表外新缺口 ⇒ exit 1）
node rp-workspace/scripts/audit-card-event-surface.mjs
```

**基线白名单机制**（避免"恒红闸门 = 没有门"，项目历史教训：`tsc -b` 2546 错 = 恒红 = 没有门）：
- `scripts/card-event-surface-baseline.json` 逐项登记**已知未修**项 + 基准取证 + 原因
- 缺集 ⊆ 基线 ⇒ **exit 0**（闸门立即可用，防**新增**缺口）
- 出现表外新缺口 ⇒ **exit 1**（红线）
- 修掉某项 ⇒ 工具提示"已收敛，请从基线删除"（**收敛机制**）

**负控实证**（真实数据，非构造）：临时从基线删除 `generation_stopped` →
复跑得 `差集 9 项（基线内 8 · 表外新增 1）`、**exit 1**；还原基线 → **exit 0**。

---

## 9. 实机验收（7/7 PASS · 含负控 · 零副作用）

探针：`stage3-device/hb67/t80-event-probe.mjs`（CDP → 设备上**正在运行的真实产物**）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 帧内 `tavern_events.MESSAGE_UPDATED` 常量**有值**（不是 `undefined` ⇒ 卡注册不会落到 `undefined` 键） | ✓ 实得 `"message_updated"` |
| 2 | 帧内 `eventOn(tavern_events.MESSAGE_UPDATED, cb)` 注册成功 | ✓ `{ok:true}` |
| **3a** | 触发 `message_edited` ⇒ **原事件仍发出**（无回归） | ✓ `[["message_edited",[3]],["message_updated",[3]]]` |
| **3b** | **新增**同投 `message_updated`（本轮改动生效） | ✓ 同上 |
| 3c | 两条载荷**同形**（messageId 一致） | ✓ `[[3],[3]]` |
| 4a | 负控：`message_swiped` 正常发出 | ✓ `[["message_swiped",[3]]]` |
| **4b** | 负控：**swipe 不得多发 `message_updated`**（L36「不能多」） | ✓ 未出现 |

**零副作用是怎么保证的**（本例的做法可复用）：
1. 把 `rt.emitSessionEvent` 换成**拦截器**（记录且**不转发**）⇒ 帧内 `eventSource` 收不到
   ⇒ 卡的任何事件回调都不执行 ⇒ **对会话零写入**。
2. `chat/messages` 在**内存里**被替成一条伪造记录（`{message_id:3, seq:42}`）
   ⇒ 只为让 `floor` 解析成功以**走到待测分支**，**零网络、零落盘**，页面刷新即消失。
3. 收场恢复 `fetch` 与 `emitSessionEvent` 两个 monkey-patch。

**顺带诊断（对后续有用）**：当前 live 会话的 `POST /dsht-tavern-helper/chat/messages`
返回 **`200 {"messages":[]}`**（`n=0`）⇒ `emitNativeChatEvent` 的 `floor` 解析**恒为 -1**
⇒ **`message_swiped` / `message_edited` / `message_deleted` 的楼层解析在"消息投影为空"的会话上全部退化**。
本轮已用内存替身绕开以隔离待测分支；但**该退化本身另属一条待查项**（不是本报告结论）。

---

## 10. 诚实边界

1. **只覆盖静态可判定形态**。语料里另有 `eventOn(event, cb)` / `eventOn(${event}, …)` /
   `eventOn(getButtonEvent(...))` 等**动态实参**注册点，本工具不产出具体事件名（不猜）。
   ⇒ 本报告的 "22 个事件值" 是**下界**，不是全量。
2. **"零发射点"是静态结论**。我方发射面允许**变量实参**
   （`emitSessionEvent(eventType, …)` 接受任意名字），本工具按"源码里是否出现该事件值字面量"判定。
   若某事件只经动态通道发射而字面量从未出现，会被**误报**为缺口。
   本轮 10 项已逐项人工复核（全仓 grep 该字面量 = 仅命中常量表定义行）⇒ 无误报。
3. **实机验收的边界**：判据 3 走的是「**注入式数据面** + 拦截器」，
   证明的是**分支逻辑与载荷形状**（= 卡能收到正确名字与正确 messageId）；
   **未**走「用户真实点『编辑』」的端到端 UI 路径。
4. **只修了 1/10**。剩余 9 项全部登记在基线里（附原因），**没有静默放过**。

