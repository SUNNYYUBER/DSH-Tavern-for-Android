# T-81　MVU 命名空间（`Mvu.events`）事件面 —— 第 4 张表此前完全不在闸门覆盖内

> 建立：2026-09-12（心跳 73）。判据来源：**L44**「枚举器的覆盖边界就是结论边界」。
> 上游：T-80（卡注册事件「我方零发射点」静态穷举）—— 本轮发现其**枚举器漏掉了一整个命名空间**。

---

## 一、一句话结论

T-80 的闸门 `audit-card-event-surface.mjs` 只扫 **3 张 ST 表**（`tavern_events` / `iframe_events` /
`event_types`），而 MVU 框架自带**第 4 个命名空间 `Mvu`**，卡同样在它上面注册事件。
shim 的 `Mvu.events` **一个常量都没有** ⇒ 卡的
`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, cb)` 取到 `undefined`
⇒ `String(undefined) === 'undefined'` ⇒ **静默注册到 `'undefined'` 键**：
注册"成功"、零报错、零 warn、**回调永不执行**。

这正是本项目主力缺陷族（静默失败）的**最坏形态** —— 也是 T-80 报告里断言「不存在」的那一种
（原文：「我方表里没有的常量 **0** ⇒ 不存在『值恒 undefined、注册到 undefined 键』的更坏形态」）。
**该断言被本轮推翻**：漏检的原因是枚举器**只看字面形态**（`tavern_events.X`），
而 MVU 的事件表是**另一个对象**，语料里的写法是 `Mvu.events.X`。

---

## 二、取证（全部带 `文件:行号`）

### 1. 权威契约（我方 shim 的验收基准）

`tmp/tt-data/data/default-user/extensions/JS-Slash-Runner/@types/iframe/exported.mvu.d.ts`

| 行 | 内容 |
|---|---|
| `:54` | `declare const Mvu: {` |
| `:57` | `VARIABLE_INITIALIZED: 'mag_variable_initiailized';` |
| `:60` | `VARIABLE_UPDATE_STARTED: 'mag_variable_update_started';` |
| `:92` | `COMMAND_PARSED: 'mag_command_parsed';` |
| `:115` | `VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended';` |
| `:118` | `BEFORE_MESSAGE_UPDATE: 'mag_before_message_update';` |
| `:179-189` | `interface ListenerType` 逐条给出 5 个事件的**参数形状**（`VARIABLE_UPDATE_ENDED: (variables, variables_before_update)`） |

🔴 **`VARIABLE_INITIALIZED` 的值在上游是 `'mag_variable_initiailized'` —— 上游拼写错误（多一个 `i`）。**
必须**逐字照抄**。把它"修正"成 `mag_variable_initialized` = 与真 MVU 的事件值不一致 ⇒
回调**同样永不触发**，而且比现在更难查（看起来是对的）。
沉淀 **L134：基准事实优先于"看起来对"；基准里的拼写错误属于接口事实，不是缺陷。**

### 2. 修复前的我方实现

| 位置 | 事实 |
|---|---|
| `th-shim.ts:2221-2223`（HEAD 版） | `events: { on: …, emit: … }` —— **0 个常量** |
| `th-shim.ts:633-639`（HEAD 版 `eventOn`） | `evt = String(evt)` ⇒ `String(undefined) === 'undefined'`，**无条件注册**，无任何校验/出声 |
| 全仓 `String(evt)` 站点 | **12 处**（`eventOn`/`eventOnce`/`eventMakeFirst`/`eventMakeLast`/`eventRemoveListener`/`eventClearEvent`/`eventEmit`×3/`Mvu.events.on`/`Mvu.events.emit`…） |

### 3. 真实语料里的消费端（设备卡/预设脚本 54 个文件 / 7.3 MB）

| 文件 | 行 | 写法 | 性质 |
|---|---|---|---|
| `悬浮球.js`（生活模拟卡） | `:689-690` | `if (window.eventOn && window.Mvu?.events?.VARIABLE_UPDATE_ENDED) { eventOn(…, () => { if (isOpen) renderSlaves(); }); }` | 🟢 有存在性守卫（优雅降级），语义 = 变量更新后重渲染 UI |
| `剧情逻辑_0703.js`（示例游戏 MVU 卡，**活跃版本**） | `:1266` | `eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, async (vars, oldVars) => { … })` | 🔴 **无守卫**；handler **就地改 `vars.stat_data.女性角色` / `vars.stat_data.NPC漂泊者`** = **否决/回滚语义**（拒绝 AI 越权改动），依赖 `vars` 是**活对象**且改动被持久化 |
| `剧情逻辑_0605.js`（同卡**旧副本** `b7s7x3`） | `:1011` | 同上 | ⚪ 非活跃旧副本 |

语料 `Mvu.*` 成员引用总览（一轮到位）：

| 成员 | 引用文件数 | 我方 shim | 契约内 |
|---|---|---|---|
| `Mvu.getMvuData` | 4 | ✅ | ✅ |
| `Mvu.replaceMvuData` | 2 | ✅ | ✅ |
| `Mvu.setMvuVariable` | 1 | ❌ **未提供** | ❌ **不在契约**（较新 MVU 的 API；卡侧有 `typeof … !== 'function'` 守卫 ⇒ 优雅降级） |
| `Mvu.events.VARIABLE_UPDATE_ENDED` | 3 | ❌（本轮修复） | ✅ |

---

## 三、修法与判定

### 修 1（**注册侧**，本轮落地）—— `Mvu.events` 补齐契约声明的 5 个常量

`th-shim.ts:2303-2307`（逐字照抄契约，含上游拼写）。任一方改动都会让 `mvu-event-namespace.spec.ts` 第 1 组转红。

### 修 2（**加固**，本轮落地）—— 事件名转换收口为**唯一入口** `evtKey()`

`th-shim.ts:616`。12 处 `String(evt)` 全部改为 `evtKey(evt, '<api>')`：

* **语义不变**（仍按真 TH 语义注册到 `'undefined'` 键 —— L36「不能多也不能少」）；
* **但出声**（`console.warn`，按 `api|形态` 去重，不刷屏）—— **L42「降级要出声」**。
  把"静默死注册"变成"可听"是可验证的行为差异：正是它让本类缺陷下次**不再需要靠读源码发现**。

### 修 3（**降级明示**，本轮落地）—— `warnDeadRegistration()`

`th-shim.ts:634-648`。卡注册我方**结构性不会发射**的事件名（`mag_*`）时打**一次性** warn 说明原因，
同 `unsupportedStub` 的既有先例（「已出声 stub」）。表内 5 条逐项附理由。

### 判定：`VARIABLE_UPDATE_ENDED` **不做**（明示降级，登记进基线）

**不是"懒得补"，是补了更坏**（L126 的②）：

* 基准的语义是**同页同步可变回路** —— `剧情逻辑_0703.js` 的 handler **就地改 `vars` 并期望它被写回**
  （拒绝 AI 把 NPC 改成"在场"、保护 `NPC漂泊者` 的世界设定）。**同步回写是它的全部意义。**
* 我方变量更新发生在**服务端 cordis 层**（`dsh-plugin/index.ts` 的 `parseUpdateVariable`、
  `/rp/mvu/extra-analyze` 的 `applyStatePatches`），帧内只有**只读快照**（`/dsht-mvu/variables`）。
* ⇒ 投一份只读副本 = **让卡以为拦截成功而实际没有** —— 卡的自检标记与实际状态发散，
  症状还会被归因到卡身上。**比"不投"更坏。**
* 同族先例：`worldinfo_scan_done` / `world_info_activated` 的**干跑面**（心跳 68 分档 A 档）。
* 该判定**已登记**在 `scripts/card-event-surface-baseline.json` 的 `known.mag_variable_update_ended`
  （附契约行号 + 形状 + 理由），`_comment` 明令「不要静默放过」。
* 且**降级会出声**（修 3）⇒ 卡注册时能在 console 看到原因，而不是"什么都不知道"。

---

## 四、闸门扩展（防本类再退化）

`audit-card-event-surface.mjs` 由「3 张表」→ **4 张表**：

1. `parseMvuEvents()`：从 `th-shim.ts` 的 `var Mvu = { … events: { … } }` 解析常量；
2. 注册面新增 `Mvu.events.X`（含语料实测的 `Mvu?.events?.X` 可选链形态）；
3. `stripTableBlocks()` 增加剔除 MVU 常量块（否则常量值被当成"我方发射" = **假绿**）；
4. 判定口径修正：原 `stEmitCounts` 会把**所有**待判名初始化为 0 ⇒ 不能用 `undefined` 判断
   "是否属 ST 事件表"，改为按**基准事件表成员资格**判；否则会把
   「扩展命名空间，需另找权威源」误报成「基准也无 emit ⇒ 与基准一致」；
5. `--selftest` **同步扩展**（L44：枚举器自身必须先过正控）：注册面 6 形态 + 表解析
   `82·6·104·5` + MVU 常量块剔除负控。

**闸门实跑**：`注册 22 → 23 个事件值`；差集 `8 → 9`（新增的 9 = `mag_variable_update_ended`，
登记后 `基线内 9 · 表外新增 0`、**exit 0**）。
**这正说明闸门此前确实"看不见"这一类** —— 修好枚举器后它立刻现形。

---

## 五、反控（真跑，不是声称）

| 反控 | 操作 | 结果 |
|---|---|---|
| 常量承重反控 | 临时删除 `Mvu.events` 的 5 个常量 | `mvu-event-namespace.spec.ts` **7/10 转红**（第 1/2/3 组全红） |
| 恢复 | 还原源码 | **10/10 绿** |
| 注册键反控 | `eventEmit('undefined')` 不得触发经 `Mvu.events.VARIABLE_UPDATE_ENDED` 注册的回调 | ✅ 不触发（证明修复前形态已被切断） |
| 出声负控 | 正常事件（`tavern_events.GENERATION_ENDED`）注册 | ✅ **不**出声（防噪音） |
| 去重反控 | 同一坏形态注册两次 | ✅ 只 warn **一次** |

---

## 六、验收

* `npm run typecheck` **三段式 0 错**（core / ui / tests）
* 单测 **61 → 62 文件 / 1329 → 1339 项**（新增 10）
* 闸门 `--selftest` 通过 · 实跑 **exit 0**
* 设备实测：见 `stage3-device/hb73/`

---

## 七、旁登记（不改，避免"没消费者就动手"）

| 项 | 事实 | 处置 |
|---|---|---|
| `Mvu.parseMessage` 形状偏差 | 契约 `:167-176` = `(message, old_data) => Promise<MvuData>`；我方 `th-shim.ts` = `(text) => 补丁数组`（**同步**、忽略第 2 参） | **不改**：全语料 **0 个消费者**（grep `Mvu.parseMessage` = 空）⇒ 改了**无法验证**，且可能打破既有差分测试。登记待「出现第一个消费者」再对齐 |
| `Mvu.setMvuVariable` 未提供 | 语料 1 处（`示例预设 V17.1`），且**有 `typeof !== 'function'` 守卫**；权威契约里**没有**这个成员（较新 MVU 版本引入） | **不补**：不在已锚定契约内，且卡侧优雅降级。若后续出现无守卫消费者再评估 |

---

## 八、方法论沉淀

* **L134**：基准（权威契约）里的**拼写错误属于接口事实**，不是待修缺陷。「看起来对」的直觉
  在这里恰好会制造一个**更难查**的静默失败。判据 = 逐字比对契约，而不是合理重构。
* （复用 L44）**枚举器的覆盖边界就是结论边界**：T-80 的闸门给出「差集 8、表外新增 0」的**绿**，
  而它当时看不见整个 `Mvu` 命名空间。**"没有发现"不等于"不存在"** ——
  每当结论是「只剩 N 项，且都已分档」时，必须回头问一句：**我的枚举面覆盖了哪些"另一个对象"？**
