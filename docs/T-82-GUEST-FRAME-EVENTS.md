# T-82　楼层帧（`.dsht-rp-message-frame`）事件投递 —— 静默失败族的新一员

> 心跳 74（2026-09-12）发现并修复。**由实机验收中的一次"假 FAIL"顺带挖出。**
> 相关：**T-80H**（本轮同时收口的三条事件投递）/ **T-80**（卡事件面静态穷举）/ **T-81**（MVU 命名空间）。

---

## 1. 一句话

`SessionRuntime.emitSessionEvent()` 只把事件投给**脚本帧**（`this.frames`），
而**楼层 guest 帧**在**另一张表**（`guestFrames`）里 ⇒
卡在楼层 iframe 内写 `eventOn(...)` **注册成功、零报错、回调永不执行**。
基准（TauriTavern / JS-Slash-Runner）**两处都投**，故这是确凿的「少」（L36），且属项目主力缺陷族（静默失败）。

---

## 2. 怎么发现的（一次假 FAIL 的完整解剖）

心跳 74 的 T-80H 探针**首轮 11/16**，5 项 FAIL 全部指向"事件没到帧"：

| 行 | 读数 | 说明 |
|---|---|---|
| B3 | `n=0` | 防抖窗口后 `settings_updated` 没到 |
| B4 | `28568B` **PASS** | 但 localStorage **确实写进去了** ⇒ 落盘发生了 |
| C1–C4 | `[]` | 预设两条事件一条都没到 |

**B4 PASS 与 B3 FAIL 并存** ⇒ 第一嫌疑是「装包没热推，设备在跑旧副本」（构建链断链 ⑦）。

**判别探针** `stage3-device/hb74/diag-host-emitter.js` 给出决定性读数：

```
verdict: PATH_OK
rtCount: 1        chatId: session-de4dce80-…    sessionIdMatch: true
listenerN: 8      (在 8 个 iframe 内各注册一个监听)
directSent: 1     directGot: [1,2,3,4,5,6,7]     ← 直投 rt.emitSessionEvent
pathGot:   [1,2,3,4,5,6,7]                       ← 真实产品路径 saveSettingsDebounced()
```

**通道与接线全好；唯独 `frames[0]` 没收到。**

而 `frames[0]` 的 `cls = dsht-rp-message-frame` —— 它是**楼层 guest 帧**，
之所以通过了探针的"有 shim"过滤，是因为**它确实注入了 shim、确实有 `eventOn`**。

⇒ **真因是探针选错帧，不是产品缺陷**（L136）。

**同时排除"陈旧副本"这条解释（用字节证据，不用"看起来不像"）**：

| 项 | staging | 设备 | 结论 |
|---|---|---|---|
| `lib/index.js` | 916,025 B | 916,025 B | **逐字节相同** |
| `lib/client.js` 新符号计数 | `emitThEventToFrames` 4 · `registerFrameEmitter` 5 · `unregisterFrameEmitter` 3 · `__dshtThRt` 1 · `emitSessionEvent` 19 | **逐项相同** | 同一份代码 |

---

## 3. 基准取证（三条，非推断）

| # | 证据 | 位置 |
|---|---|---|
| ① | 承载 `eventOn` 的 `_eventOn` 在 `TavernHelper._bind` 里 | `src/function/index.ts:221` |
| ② | 把 `_bind` 逐项 **bind 到该 iframe 的 window**（`key.replace('_','')`）的 predefine **两处都注入** | `src/iframe/predefine.js:14-24` · 注入点 `src/panel/script/iframe.ts:12`（脚本帧）**与** `src/panel/render/iframe.ts:94`（**消息渲染帧**） |
| ③ | `_eventOn` 直接 `eventSource.on(...)`，共用**同一实例** ⇒ 与帧类型无关 | `src/function/event.ts:44`（wrapper 注册）/ `:16` |

⇒ **基准里楼层渲染帧是一等事件消费者**，我方缺它。

**旁证（我方自身的不一致）**：同文件 `pushContextSnapshotToFrames()`（`RpScriptHost.tsx:907`）
的注释**明文写着**「只推脚本帧会让楼层帧永远停在 `__dshtContextPending` 空壳（实机实证）」，
并把快照**同时**推给脚本帧与楼层帧 —— **事件面却只推脚本帧**。

---

## 4. 修复（与脚本帧完全对称，刻意不用重试梯子）

```
emitSessionEvent(eventType, args)
  ├─ for [scriptId, frame] of this.frames        既有逻辑不动
  └─ for scriptId of this.guestFrames.keys()     ← 新增
       未就绪 ⇒ push 进 pendingGuestEvents（上限 50，与脚本帧同口径）
       已就绪 ⇒ postMessage th:'event'

handleMessage 的 guest 分支（既有 guest running 握手点，:540）
  ├─ guestReady.add(scriptId)                    ← 新增
  └─ flushPendingGuestEvents(scriptId)           ← 新增
```

**为什么就绪门用「guest 发 `{th:'status',phase:'running'}`」这一刻**：
它是 shim **尾模块** `__dshtThReady()` 发的（`th-shim.ts:2693` / 注入模板 `:2931`），
**此刻卡脚本已执行完、`eventOn` 监听器必然已注册** ⇒ 零竞态。该握手点原本就存在（用于补推快照）。

**⚠️ 为什么不照抄 `pushContextToGuest` 的 4 次重试梯子（`[0,400,1200,2800]`）** —— **L138**：

| | 快照（context） | 事件（event） |
|---|---|---|
| 幂等性 | **幂等覆盖**（后到覆盖先到，语义等价） | **不幂等**（卡按 `MESSAGE_RECEIVED` 计数会 **×4**） |
| 能否共用梯子 | ✅ | ❌ **违反 L36「不能多」** |

⇒ 事件路径**不出现任何 `setTimeout`**，由单测**承重反控**钉死（见 §6 R3）。

---

## 5. 实机验收

探针 `stage3-device/hb74/t82-guest-event-probe.js`（宿主页 CDP 上下文求值，落到**楼层帧内**真产物）。

**改前 / 改后对照**（同一探针家族的同一类断言，同一台设备）：

| 读数 | 改前（v312 包） | 改后（v314 包） |
|---|---|---|
| 楼层帧收到 `settings_updated` | **`n=0`** | **`n=1`** |
| 楼层帧收到预设两条 | **`[]`** | **`["AFTER","PRESET:{apiId,name}"]`** |
| 脚本帧 | `n=1`（未翻倍） | `n=1`（未翻倍） |

> "改前"读数取自同一会话内的首轮 `t80h` 探针（它当时恰好把监听挂在楼层帧上）——
> 即**同一断言、同一设备、同一会话**的前后对照，不是另一条推理链。

**最终裁决（各连跑 2 次，稳定）**：

| 探针 | 结果 |
|---|---|
| `t82-guest-event-probe.js` | **10/10 PASS** ×2（G1a/G1b/G1c/**G1d 负控**/G2/**G3 恰 1 次**/**G4 脚本帧未翻倍**/**G5 负控 0 次**/G6 顺序/G7 收场） |
| `t80h-preset-settings-probe.js` | **16/16 PASS** ×2 |
| `stage4-regression.mjs` | **21/21** |
| 闸门 `audit-card-event-surface.mjs --selftest` | 通过 / 实跑 **exit 0** |

**产物级核验**（防断链 ⑦）：`lib/client.js` mtime **23:57:44 晚于**源码 **23:56:38**；
含 `pendingGuestEvents`×7 · `flushPendingGuestEvents`×2 · `guestReady`×5；
**staging == 设备 `profiles/web` 同 md5 `f968e44d115116317a5e40da64e58f3b`**；
双架构 APK 内嵌载荷双向命中（`check-apk-payload.py`）。

**APK**：`DSH-Tavern-0.2.0-x86_64-debug.apk` **196,947,819 B**（sentinel **v314**，已装机）
/ `DSH-Tavern-0.2.0-arm64-release.apk` **128,475,680 B**（**v315**）。

---

## 6. 单测与反控（`tests/th-guest-event-delivery.spec.ts`，13 项）

四组：**A** guest 分支存在 + 就绪门 + 入队 + 上限 50（与脚本帧同口径）；
**B** 握手点标记就绪 + 补投 + 不顶掉既有快照补推 + 投后清队列；
**C** **承重反控**（正控：context 梯子确实存在 / 事件路径**无** `setTimeout`）；
**D** `releaseGuestFrame` 与 `destroy` 不留悬挂队列。

**反控真跑 5/5 全红**（`stage3-device/hb74/reverse-guest-tests.mjs`）：

| 变体 | 结果 |
|---|---|
| R1 删除 guest 投递循环 | **RED**（2 项转红） |
| R2 去掉就绪门（未就绪也直接投） | **RED** |
| R3 改用 4 次重试梯子 | **RED** |
| R4 握手点不再标记就绪（队列只进不出） | **RED** |
| R5 未就绪时丢弃而非入队 | **RED** |

**⚠️ 反控自身踩的坑（→ L137）**：R1 首版用 `String.replace('for (const scriptId of this.guestFrames.keys()) {', …)`
—— **该字符串在 `pushContextSnapshotToFrames`（`:911`）与 `emitSessionEvent` 里逐字相同**，
`replace` 换掉了**第一处**（context 路径）⇒ `emitSessionEvent` 没被碰过 ⇒ **反控空转还报绿（exit 0）**。
修法：按**方法体作用域**打补丁 + 补丁未命中时报 `applied:false`。**"防线自己假绿"比没有防线更危险。**

---

## 7. 诚实边界

1. **本轮只覆盖 `message` 楼层帧**。`guestFrames` 目前只由 `RpNativeChat` 的
   `.dsht-rp-message-frame` 预约（`reserveMessageFrame`）；若将来出现**其他** guest 帧来源，
   本机制自动覆盖（按 `guestFrames` 表遍历，不按类名/前缀硬编码）。
2. **未做的**：`handleMessage` 的 guest 分支保留了既有的 `startsWith('msgframe-')` 判断（原逻辑），
   而我的新增分支只用 `guestFrames.has()` 作权威判据 —— 即**新增路径比原路径更宽**，
   这是有意的（前缀字符串是历史约定，表成员身份才是事实）。**未顺手改既有行**，避免扩大本轮改动面。
3. **`guestReady` 不回退**：guest 若在运行期崩溃（shim 死掉）但帧元素仍在，则仍被视作"就绪"、事件直接投、
   静默丢弃。基准同样没有"消费者死亡"检测 ⇒ **按 L36 不引入基准没有的机制**，如实登记为已知边界。
4. **探针仍属"注入式数据面"**：G3/G6 走的是 `saveSettingsDebounced()` 与
   React 受控 `<select>` 的 `change` 事件（产品自身路径），但**未**走"用户手点 preset 下拉框"的完整 UI 路径。

---

## 8. 沉淀

- **L136**　探针的「帧选择」是**前提**而不是细节 —— 有 `eventOn` ≠ 是事件的投递目标。
- **L137**　同一段结构在两个地方逐字相同时，**反控补丁必须限定作用域**（否则防线空转还报绿）。
- **L138**　**事件 ≠ 快照：幂等性决定能否共用重试梯子**（不幂等的通知绝不能套"重试 N 次"）。
