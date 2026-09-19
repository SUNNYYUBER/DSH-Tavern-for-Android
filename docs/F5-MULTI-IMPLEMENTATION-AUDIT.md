# F5 多实现清单与单源化裁决（2026-09-14）

> 触发：用户指出「回退插件是纯自研的，在另一台 DSH 上也有一个副本，要改的话两边都要改」。
> 这句话点出一个**结构性风险**：同一功能存在多份实现、语义还不一致，
> 靠「记得两边都改」这种人工纪律来维持 —— **靠人记，必然漏**。
>
> 本文是 F5 的产出：盘清所有「同一功能多实现」，逐项定权威单源，
> 并给出副本侧的处置方式（同步 / 显式划界），同时建立**结构性重复的审计判据**。

---

## 一、为什么「多实现」是架构级问题（P-1 单一事实来源）

同一语义有多份实现时，会产生三种必然后果：

1. **修一处漏一处**：修了 A 实现，B 实现仍带旧 bug，用户在不同入口遇到不同行为。
2. **语义漂移**：两份实现在演进中各自「更合理」一点，最终对同一操作给出不同结果。
3. **判据失效**：任何测试/审计只覆盖其中一份时，另一份的回归无人发现。

判断标准（本项目的口径）：
**同一「用户可感知的操作语义」只允许一个权威实现；其余要么是它的实现细节，要么必须显式声明为不同语义并写清边界。**

---

## 二、清单（逐项裁决）

### 2.1 回退 / 重新生成 / 编辑（用户实测触发，最高优先）

| # | 载体 | 路由 | 机制 | 使用者 | 裁决 |
|---|---|---|---|---|---|
| 1 | `dsh-plugin` | `/rp/session-rollback`<br>`/rp/session-edit`<br>`/rp/session-regenerate` | **live 逻辑回退**：官方 `compaction/prune` 影子化 + `user/message` marker replace；事件留日志，投影立即生效 | DSHTavern 实际形态（前端 `RpUserNodeView` / `RpRegenerateAction` 全走这里） | ✅ **权威单源** |
| 2 | `dsht-plugin-undo` | `/dsht-undo/rollback`<br>`/dsht-undo/edit`<br>`/dsht-undo/regenerate` | **文件截断**：`session.jsonl` 截到 keepThroughSeq + `.bak` 备份；live session 409 拒绝 | 无 rp 的通用 DSH 部署（HTTP 直调 / 自接 UI） | ⚠️ **降级实现**（见下） |
| 3 | 另一 DSH 部署的副本 | 同 #2 | 同 #2（v1.1.0，client 半边为空壳） | 那边独立使用 | ⚠️ **需同步或划界**（见下） |

**裁决**：

- #1 是**权威语义**：不新开 session、不丢日志、投影即时生效。这也是 `B13`（回退绝不新开分支）的唯一满足者。
- #2 保留但**明确为「文件级降级路径」**：它的存在理由是「无 rp 插件的部署也要能用回退」，
  不是「另一种回退语义」。它的边界必须写清：
  - 只适用于**非 live** 会话（live 一律 409，因为内存态权威、截盘会被 flush 覆盖）；
  - 事件从日志**物理删除**（与 #1 的「留日志只改投影」相反）——这是**能力差异**不是 bug；
  - 不做变量回滚 / 文件快照回滚以外的语义扩展（那些归 #1）。
- #2 与 #1 的共享部分必须**同源**：
  - `dsht-plugin-shared/session-surgery.ts`（截断定位、`canSurgicallyTruncate` 单源判据）
  - `dsht-plugin-shared/file-snapshots.ts`（turn 快照捕获与恢复）
  - `dsht-plugin-shared/session-write.ts`（标记形态、`readSurgical`）
  → 这三处已是共享模块，**两侧都 import 同一份**，符合单源要求（✅ 已达成）。

**副本（#3）处置**：见 §三。

### 2.2 其它「疑似多实现」盘点结果

| 功能 | 是否存在多实现 | 裁决 |
|---|---|---|
| **重新生成** | 是（#1 与 #2 各有一条） | 同 §2.1：`/rp/session-regenerate` 权威，`/dsht-undo/regenerate` 为无 rp 部署的降级 |
| **编辑** | 是（同上） | 同 §2.1 |
| **变体 / swipe** | 否（只有 `dsh-plugin` 的 `variantOf` + `dsht-rp-ui` 的 `variant-groups.ts` 归一化，前后端分工明确） | ✅ 单源 |
| **导入** | 否（`import/*.ts` 为唯一实现；`st-migration` skill 是它的调用方不是副本） | ✅ 单源 |
| **记忆 / 摘要** | 否（`dsht-plugin-memory` 单实现） | ✅ 单源 |
| **世界书触发** | 否（`lore/trigger.ts` 单实现；`dsh-plugin` 与 skill 都调它） | ✅ 单源 |
| **display 正则链** | 否（`display-compiler.ts` 单实现；主引擎 `regex/engine.ts` 是不同语义面——prompt/display 时机不同，非重复） | ✅ 单源（语义面不同） |
| **会话截断定位** | 否（`session-surgery.ts` 单实现，被 #1 #2 共用） | ✅ 单源 |
| **标记读写（surgical）** | **是（2026-09-14 本轮 M7 实测查出第 3 处）** | ✅ **本轮收口**：`session-write.ts` 是唯一读法；**三个消费方**统一到它——`dsh-plugin`（掩码路由）、`dsht-plugin-tavern-helper`（聊天导出，**本轮修**，此前自扫 `compaction/prune` 在真机恒空 ⇒ 被回退消息照旧计占用）、`dsht-plugin-memory`（楼层提取，**本轮修**，此前只算锚点区间、漏 `shadowedSeqs` ⇒ 只带集合的回退会漏跳）。⇒ **P-18** |
| **拖拽事件翻译** | 否（`touch-mouse-bridge.ts` 单实现，注入两份 vendor 的是同一份源码） | ✅ 单源 |
| **原子写** | 是（判据 4 发现：`dsh-plugin:atomicWriteFile` ≡ `atomic-fs:atomicWriteText`） | ✅ **本轮收口**（委托 `atomic-fs.ts`；tmp 去重序号随之统一） |
| **引号剥离** | 是（判据 4 发现：`mvu:stripQuotes` ≡ `tables:stripArgQuotes`） | ✅ **本轮收口**（新建 `text-normalize.ts`） |
| **可合并对象判定** | 是（判据 4 发现：`tavern-helper` 三处 `isTree` ≡ `deep-merge:isMergeableObject`） | ✅ **本轮收口**（委托 `deep-merge.ts`） |
| **sessionId 安全校验** | 是（判据 4 发现：`memory:isValidMemorySessionId` ≡ `tables:isValidTablesSessionId`） | ✅ **本轮收口**（委托 `session-surgery.ts:isSafeSessionId`） |
| **残留宏转义** | 是（`dsht-plugin-memory:neutralizeMacros` ≡ `card-fence:escapeResidualMacros`） | ✅ **本轮收口**（委托 `card-fence.ts`） |
| **JSONPointer 段编码** | 是（`mvu:encodeSeg` ≡ `json-pointer:encodePointerSeg`） | ✅ **本轮收口**（委托 `json-pointer.ts`） |

**结论**：真正意义上的「操作语义多实现」只有回退/重生成/编辑这一组，且已按「权威 + 降级」划清。
其余功能均为单源（F2 把 surgical 标记读法收口成单源——**但 2026-09-14 本轮 M7 实测发现当时
只统一了两处、漏了第 3 处**（`dsht-plugin-memory`），已在本轮补上；**轨道 D 又用判据 4 查出并收口了
6 组「改名复制」的工具函数**——它们此前全部不可见）。

> **教训（P-18 / P-19）**：F2 当时的「三处消费方统一」是**未经验证即声称**——
> 它只检查了两个已知消费点，没有（a）全仓枚举同名语义的读取点，也没有（b）用
> **对账两端输出**的方式验证（掩码路由读到 25 项 vs 聊天导出读 0 项，一对账就露）。
> 静态的结构审计（判据 2/4）抓的是「函数体重复」，抓不住「**同名语义、不同实现、各自都对**」
> 这类漂移；必须补**运行时口径一致性判据**（本轮已落 `rollback-mask-semantics.spec.ts`
> 的 F4-C3/P-1 一节 + `memory-plugin.spec.ts` 的 P-18 一节）。

---

## 三、副本侧处置（另一台 DSH 部署）

**位置**：
```
D:\SillyTavern-1.16.0\SillyTavern（now using）\SillyTavern-1.16.0\
  .a Agent RolePlay Project\.dsh-home\profiles\web\node_modules\dsht-plugin-undo\
```

**现状**：`dsht-plugin-undo` **v1.1.0**（主仓为 v1.1.0 同版本号，但主仓源码此后经历了
`session-write.ts` 统一读法、`file-snapshots` 共享化等多轮演进——副本的 `lib/index.js`
是**旧构建产物**）。

**处置（本轮执行的）**：

1. **读侧共享模块同步**：副本 `lib/index.js` 是打包产物，其依赖的
   `dsht-plugin-shared/*` 已被内联进产物。主仓本轮对共享模块的改动（新增
   `readSurgical`）**不影响副本**——副本不用 surgical 标记（它走文件截断路径，不写 marker）。
   → 判定：**无需同步**（两侧语义不同且副本不依赖被改的读法）。
2. **显式划界**：在副本目录写 `SEMANTICS.md` 说明它的语义边界与「何时需要与主仓同步」。
   **不**把主仓的 F2/F4/F1 改动硬塞过去——那些是 RP 宿主面的修复，副本是无 rp 的通用插件。
3. **同步触发条件**（写进副本说明，避免「靠人记」）：
   只有下列情况之一发生时才需要同步副本：
   - `dsht-plugin-shared/session-surgery.ts` 或 `file-snapshots.ts` 的**函数签名/行为**变更；
   - 副本自身出现用户可感知 bug；
   - 副本升级到新的 minor 版本。
   其它情况（RP 面 UI / 掩码 / 计量口径 / 错误文案）**一律不同步**。

---

## 四、建立审计判据（D4：结构性重复的检测）

多实现靠人记不可靠，必须**机器可查**。`scripts/audit-impl-duplication.mjs` 现有**四条判据**
（selftest 15/15，锚点缺失 fail-closed）：

| 判据 | 查什么 | 白名单 |
|---|---|---|
| 1 | 同一「动作语义」路由名出现在多个插件 | `DECIDED`（须写明谁是权威谁是降级） |
| 2 | 同一**函数名**跨包以 `function <name>(` 出现 | `FN_ALLOW`（须写明为何「语义面不同」） |
| 3 | 跨部署划界文档（`SEMANTICS.md`）两侧是否逐字同源 | 无（漂移即 fail） |
| 4 | **不同名**但**函数体逐字相同**（判据 2 的盲区） | `BODY_ALLOW`（当前为空） |

### 4.1 判据 4 的上线理由（2026-09-14 实测）

判据 2 只比名字。本轮上线判据 4 后**立刻抓到 3 组此前完全不可见的复制**——
它们的函数名都不同，判据 2 永远不报，**「改一处漏一处」的风险完全不可见**：

| 复制体 A | 复制体 B | 漂移后果 | 单源落点 |
|---|---|---|---|
| `dsh-plugin/index.ts:atomicWriteFile` | `atomic-fs.ts:atomicWriteText` | 两侧各有独立 tmp 去重序号 ⇒ 同毫秒同路径并发写仍撞名（EEXIST）；fsync 策略一处改了另一处不改 ⇒ 进程被杀时一处留半写文件 | `dsht-plugin-shared/atomic-fs.ts` |
| `state/mvu.ts:stripQuotes` | `dsht-plugin-memory/tables.ts:stripArgQuotes` | 引号口径属**文本解析判据**：一处补了全角 `“”` 另一处没补 ⇒ 两张卡对同一指令解读不一致 | `dsht-plugin-shared/text-normalize.ts`（新建） |
| `tavern-helper/{facade,for-session,session-store}.ts:isTree` | `deep-merge.ts:isMergeableObject` | 「可合并对象」判据一处收紧（如排除 Date/Map）另一处不收 ⇒ 同一数据两处判得不一样 | `dsht-plugin-shared/deep-merge.ts` |

另有 3 组在**更早**的单源化中已收口（本轮补齐结构性护栏测试）：
`isValidMemorySessionId` ≡ `isValidTablesSessionId`（安全判据 → `session-surgery.ts:isSafeSessionId`）、
`neutralizeMacros` ≡ `escapeResidualMacros`（→ `card-fence.ts`）、
`encodeSeg` ≡ `encodePointerSeg`（→ `json-pointer.ts`）。

**收口形态**统一为 `const 本地名 = 共享实现`（保留本地名，调用点零改动，破坏面最小），
并由 `tests/shared-single-source.spec.ts` 的「结构性护栏」逐条钉住
（含 `not.toMatch(/function\s+<本地名>\s*\(/)` —— 防「删了函数体却忘了 import」）。

### 4.2 判据 4 的已知盲区（诚实标注）

- 箭头函数 / 内联表达式形态（`const f = (a) => …`）未覆盖；
- 局部变量改名、语句重排的**近似**复制无法判定（需 AST + 近似匹配，会引入大量误报，刻意不做——宁缺毋滥）；
- 只判**跨包**重复（与判据 2 同口径）。

> 真实发现的三组复制都是 `function` 声明形态。若将来出现箭头形态的复制，本判据会漏——
> 届时应扩到 AST 而非继续加正则。

### 4.3 判据能抓什么、抓不住什么

机器判据能抓住「**新增了重复实现**」与「**改名复制**」，但抓不住「**语义漂移**」
（两份实现各自演进得更像自己那一版）。故仍需 §二的人工裁决表配合：
**机器负责发现，人负责定性**。

---

## 五、设计哲学层判据（P-1 单一事实来源）

**P-1**：同一「用户可感知的操作语义」只允许一个权威实现。

推论：
- **P-1a**：允许存在降级实现，但必须**显式声明**为降级，并写清与权威实现的差异
  （如「本实现从日志物理删除事件，权威实现只改投影」）。
- **P-1b**：多实现之间**共享的底层逻辑必须同源**（import 同一模块），
  禁止各自复制函数体（复制即必然漂移）。
- **P-1c**：跨部署的副本，同步条件必须**写成触发条件清单**，而不是「记得就同步」。
- **P-1d**：任何「两边都要改」的说法，都是架构缺陷的自白——应改为「共享同一模块」。

**本轮应用**：回退/重生成/编辑 → 权威（`dsh-plugin`）+ 降级（`dsht-plugin-undo`）+ 副本划界；
共享层（`session-surgery` / `file-snapshots` / `session-write`）单源已达成。
