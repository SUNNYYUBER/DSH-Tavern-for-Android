# DSH 底层版本升级审计（2026-09-23）

> **本文档回答三件事**：① 官方 DSH 现在出到什么版本；② 我方锚在哪里、差多远；
> ③ 升级到底要动哪些东西、按什么顺序做、怎么验、怎么回滚。
> **顺带收录**：本项目全部 goal 文档清单与当前状态（§7）。
>
> **建立**：2026-09-23　**状态**：调研完成，**未执行升级**（本文档是作战地图，不是执行记录）
> **实测来源**：`npm view @deepseek-ai/dsh`（本机实跑，非记忆）
>
> **2026-09-23 补充（第二轮）**：本文档已扩为「升级这件事的全部面」的合集。
> 追加四个附录，覆盖此前只给结论、未逐项落地的部分：
>
> | 附录 | 覆盖的问题 |
> |---|---|
> | [附录 B](#附录-b安卓适配层的完整性审计升级会打断哪一层) | **安卓适配层**：运行时/构建/原生/壳/部署/数据，逐层列出「升级会打断什么」 |
> | [附录 C](#附录-crp-世界的完整性审计) | **RP 部分**：宿主代理面 / 投影契约 / 会话读写 / 数据落盘 / 导入链路 |
> | [附录 D](#附录-d升级到底要考虑什么条完整判据带正负控) | **验收判据**：升级前必须新增/扩面的判据清单（每条带正负控设计） |
>
> **★★ 2026-09-23 第三轮（条件变化，计划已改）★**：官方发布了 **`0.1.7-rc.1`**（`next` 标签），
> 把此前所有 alpha 的内容汇总，并**引入了插件版本号机制**。
> 这**正是**本文档 §3.3 / A.7 里写的「等 0.1.7 进 rc 再评估」的那个条件 —— **条件已满足**。
> ⇒ 新增 **[附录 E：0.1.7-rc.1 作战计划（第三轮·现行）](#附录-e017-rc1-作战计划第三轮现行)**，
> **它是本任务的执行依据**；§4 的四阶段与 A.9.3 的清单**降为历史/参考**。
>
> 三张总账（贯穿 B/C/D/E）：
> **① 依赖面**（我方向官方借了什么形状）、**② 补丁面**（我改了官方哪些字节）、
> **③ 数据面**（用户数据落在什么形状上）。**升级之所以危险，是因为这三面同时移动。**

---

## 0. 结论先行

> ★★ **2026-09-23 第三轮：本节已随 0.1.7-rc.1 的发布更新。**
> **一句话（现行）：`0.1.7-rc.1` 已发布 ⇒ A.7 里「等它转 rc」的条件满足 ⇒ 目标从
> 「暂不做」改为「做」，执行依据是 [附录 E](#附录-e017-rc1-作战计划第三轮现行)。**

**（历史）一句话：我们离官方最新只差一个顶层版本号，但那个版本号背后藏着一个真实的版本分裂，必须先修掉。**

六个判断（前三项已随第三轮更新）：

1. **官方版本线**：`latest` = `0.1.5-rc.3`（我方阶段 0 已对齐）；
   ★★ **`next` = `0.1.7-rc.1`（本轮目标，已转 rc）**；`alpha` = `0.1.7-alpha.2`（已被 rc.1 汇总）。
2. ~~我方名义 pin = `0.1.5-rc.1`，但所有子包已实际解析到 `0.1.5-rc.3`~~
   → ★ **已修复（阶段 0，2026-09-23）**：顶层与 **231 个子包全部 rc.3，零分裂**（见 §2.2）。
3. **升级动作本身不复杂，复杂的是它牵动的补丁面**：**12 组补丁、18 个唯一 marker、
   11 个源文件里 79 处事件字符串**（均为本机实测，见 §4 阶段 2）。所以升级必须
   **分组验证、逐组可回滚**，不能一把梭。
4. **我方对官方的耦合不是「几个点」，而是六层**（附录 B）：
   运行时版本 / 产物补丁 / 原生二进制 / Android 壳 / 部署装配 / 数据形态。
   **补丁面只是其中最显眼的一层**；其余五层此前从未被当成「升级时要过的面」列出来。
5. **RP 层有十个耦合面**（附录 C），其中最脆的是 **C2 宿主 DOM 锚点** ——
   `anchors.ts` 的 **22 个锚点里 21 个锚定官方哈希类名**（`.pI_x6G_*` / `.VOzbGW_*` /
   `.hHd-Xa_*` / `.wSkVaW_*`），**类名失效时静默返回 0，没有任何出声**。
   （★ rc.1 实测：4 组前缀**全部仍在** ⇒ 本轮不是问题，但判据仍应建。）
6. **「跑通编译」与「能用」之间隔着六段判据**（附录 D）：
   升级验收必须收敛成**一条**带正负控的判据 `audit-upgrade-readiness.mjs`
   （★ **已建成并接入构建期门禁**，selftest 7/7），
   且**六段中出现任何 UNKNOWN 一律禁止升级**（P-17：「测不出」≠「没问题」）。

---

## 1. 官方版本现状（本机实测）

### 1.1 dist-tags

| tag | 版本 | 含义 |
|---|---|---|
| `latest` | **0.1.5-rc.3** | 官方推荐稳定线 ← **我方当前锚点（阶段 0 已对齐）** |
| `next` | **0.1.7-rc.1** | ★★ **2026-09-23 新增** —— 目标线，**转 rc 了**（原只有 alpha） |
| `alpha` | **0.1.7-alpha.2** | 前沿线（已被 rc.1 汇总） |

> ★★ **`0.1.7-rc.1` 的意义（本轮的转折点）**：
> §3.3 与 A.7 的原始结论是「**不建议跟 alpha**，等它进 `latest`（即转 rc）再评估」。
> 条件（转 rc）**已满足** ⇒ 本任务的目标从「暂不做」变为「**做**」。
> 但注意：它挂在 **`next`** 而非 `latest` ⇒ 官方仍视其为「候选」；
> 我方按用户裁定升到 rc.1，并**保留随时回退到 0.1.5-rc.3 的能力**（见 E.6）。

### 1.2 全部已发布版本（时间序）

```
0.0.1-rc.1  →  0.0.1-rc.2  →  0.0.1-rc.5
0.1.0-rc.2  →  0.1.0-rc.3  →  0.1.0-rc.6  →  0.1.0-rc.7  →  0.1.0-rc.8
0.1.1-rc.1  →  0.1.1-rc.2
0.1.2-alpha.2 → alpha.3 → alpha.4 → alpha.5
0.1.2-rc.1
0.1.3-alpha.2
0.1.5-alpha.1 → alpha.2
0.1.5-rc.1  →  0.1.5-rc.2  →  0.1.5-rc.3      ← 我方**阶段 0 已对齐**（latest）
0.1.6-alpha.1 → alpha.2
0.1.7-alpha.1 → alpha.2                        ← 原最前沿
0.1.7-rc.1                                     ← ★★ 2026-09-23 新发布（next）＝ **本轮目标**
```

> 注意 **没有 `0.1.4`**：官方从 `0.1.3-alpha.2` 直接跳到 `0.1.5-alpha.1`。
> 我方历史上也从未用过 0.1.4（`GOAL.md` 的版本沿革与之一致）。

---

## 2. 我方现状（实测，非推断）

### 2.1 名义锚点：版本单源 `rp-workspace/dsh-version.json`

```json
{
  "dshVersion": "0.1.5-rc.1",
  "sessionReplaceOpFields": ["op", "startSeq", "endSeq"],
  "updatedAt": "2026-09-16",
  "_updatedBy": "第二十七轮 W24c/W25（runtime 0.1.2-rc.1 → 0.1.5-rc.1 复原）"
}
```

`dsh-runtime-src/package.json` 的 pin 与之同源：

```json
{ "dependencies": { "@deepseek-ai/dsh": "0.1.5-rc.1", ... } }
```

### 2.2 ★ 发现的真实问题：版本分裂（顶层旧、子包新）

| 层级 | 实际版本 |
|---|---|
| 顶层 `@deepseek-ai/dsh` | **0.1.5-rc.1**（精确 pin，无 caret） |
| 全部子包（`dsh-base` / `dsh-session` / `dsh-app-boot` / … 实测 **231** 个 `dsh*` 子包） | **0.1.5-rc.3**（顶层用 `^0.1.5-rc.1` ⇒ 解析到该线最新） |

> `node_modules/@deepseek-ai/` 下实测共 **240** 个包（含 `cordis` 等非 `dsh-` 前缀者），
> 其中 `dsh*` 子包 **231** 个 —— 即版本分裂影响面覆盖**几乎整个运行时**。

**为什么这是个真问题**：

- 顶层 `dsh` 包**本身也带代码**（CLI、profile 装配），不是纯元包 —— 它的 `0.1.5-rc.1`
  与子包的 `0.1.5-rc.3` 可能对同一契约有不同预期；
- 我方的 `audit-dsh-version.mjs` 判据 ② 只比对**顶层** `dsh` 主包版本，
  **看不见**子包已漂到 rc.3 —— 这是判据的一个**覆盖盲区**；
- `dsh-version.json` 的 `_dshVersionNote` 自己写着「子包由 caret 解析，实际可能落到更小的 rc」
  —— **「更小的 rc」这个描述已经过期了**，现在是**更大的 rc**（rc.1 → rc.3）。

**这一条不用等大版本升级，现在就可以修**（见 §4 阶段 0）。

### 2.3 数据兼容形态（真正的判据，比版本号本质）

我方会话日志里的 `replace` 事件用**三键严格形态**：

```
Object.keys(op).length === 3 && hasOwn(op,"op") && hasOwn(op,"startSeq") && hasOwn(op,"endSeq")
```

实测当前解析到的 `dsh-session@0.1.5-rc.3` 的 `isReplaceOp`：

```js
function isReplaceOp(value) {
    const op = value;
    return Object.keys(op).length === 3 && Object.hasOwn(op, "op")
        && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq")
        && op["op"] === "replace" && isEventSeq(op["startSeq"]) && isEventSeq(op["endSeq"]);
}
```

⇒ **形态未变**，与 `dsh-version.json` 声明的 `["op","startSeq","endSeq"]` 一致。
**这是升级可行性的关键前提** —— 也就是说 rc.1 → rc.3 这一段**没有破坏数据兼容**。

> 历史教训（为什么这个判据这么重要）：第二十七轮 W24c 曾因照抄上一轮命令而把 runtime
> **静默降级**到 0.1.2 世代 —— 那一代 `isReplaceOp` 要求 `op/start/end`，而设备上
> **1747 处真实数据**是 `op/startSeq/endSeq` ⇒ 装出去**历史会话全部打不开**，
> 靠契约探针 BLOCK 才拦下。**故升级时「跑通编译」不等于「数据能开」，必须实测老会话。**

---

## 3. 升级目标评估

### 3.1 目标 A（推荐）：`0.1.5-rc.1` → `0.1.5-rc.3`

| 维度 | 评估 |
|---|---|
| 数据兼容 | ✅ **无破坏**（`isReplaceOp` 三键形态实测未变） |
| 变更量 | 同一小版本的 rc 内迭代，属补丁级 |
| 补丁面冲击 | 低 —— 补丁锚点大概率不变（需实测核对，见 §4 阶段 2） |
| 收益 | 消除 §2.2 的版本分裂；吃到 rc.2/rc.3 的修复 |
| 风险 | **低** |
| 建议 | **做**，且优先 |

### 3.2 目标 B：→ `0.1.6-alpha.2`

| 维度 | 评估 |
|---|---|
| 数据兼容 | ⚠️ **未知** —— 需先按 §5 的方法实测 `sessionReplaceOpFields` |
| 变更量 | 跨小版本；**依赖面明显收窄** —— 实测顶层 deps 里 `dsh-session` 相关只剩 `dsh-session-reference` 与 `dsh-session-projection` 两条（`0.1.5-rc.3` 时还有 `dsh-session` / `-query` / `-log-deepseek` / `-checkpoint-policy` / `-persistence-jsonl` 等），说明**包结构有重组** |
| 补丁面冲击 | **中高** —— 包重组意味着补丁锚点的**文件路径可能变**，而补丁是按路径+文本锚定的 |
| 收益 | 新特性（未逐项调研） |
| 风险 | **中** |
| 建议 | **暂不做**；等它进 `latest`（即转 rc）再评估 |

### 3.3 目标 C：→ `0.1.7-alpha.2`

**不建议**，三条理由：

1. **依赖已改为精确 pin**（实测 `0.1.7-alpha.2` 对 `dsh-base`/`dsh-app-boot` 是
   `"0.1.7-alpha.2"` 而非 `^…`）⇒ 官方自己在这个线上还在收紧，API 未稳；
2. 跨两个小版本 + 包重组，**补丁面重写量最大**；
3. 我方是**单人项目 + 真机验证靠众包**（`GOAL-ECO-SPRINT` 的用户裁定），
   跟最前沿 alpha 的性价比最低。

> ★ **本节结论已由 [附录 A](#附录-a017-alpha2-的破坏性变更逐项审计) 逐项证实**：
> 实测坐实三条硬阻断（会话格式 v3→v4、`tool/result` 表示重写、**2 条补丁锚点失效**），
> 并给出「若真要升」的完整改动清单（A.6）与代价对比（A.7）。
> **本节保留为结论；证据与实施细节在附录 A。**
>
> ★★ **2026-09-23 第三轮更新（本节结论已翻转）**：官方发布 **`0.1.7-rc.1`**，
> 即「**等它转 rc**」这个条件**已满足**（本节原建议 3 条中的第 2 条）。
> ⇒ 本节的「**暂不做**」结论**作废**，改为「**做**」。
> 但**本节列的三条理由本身仍然成立**（依赖收紧、跨两版本、单人项目）——
> 只是「等 rc」这条已被触发 ⇒ 转为 **有准备的做**（附录 E 的九阶段计划）。
> ★ 同时实测补齐了**第四条硬阻断**（`--expose-internals` 消失），详见 A.9.2 / E.2。

---

## 4. 升级怎么做（分阶段，每阶段独立可验可回滚）

> ⚠️ **本节已降为历史/参考（2026-09-23 第三轮）**：本节写于「目标 = 0.1.5-rc.3」的语境
> （阶段 3.1 的 pin 就是 rc.3）。**现行执行依据是 [附录 E](#附录-e017-rc1-作战计划第三轮现行)**。
> 本节保留的价值：**阶段 0（修版本分裂）已完成**、阶段 2 的补丁面口径（12 组/18 marker）
> 仍被 E 引用、第 5 节回滚方案仍有效。
>
> **总原则**（沿用 `DSH-0.1.5-UPGRADE-PLAN.md` 的既有方法）：
> 分阶段、每阶段可独立验证、每阶段有回滚点。**不一把梭。**

### 阶段 0：先修版本分裂（**与大版本升级解耦，可立即做**）

| 步 | 动作 | 验证 |
|---|---|---|
| 0.1 | 把 `dsh-version.json` 的 `dshVersion` 改为 **`0.1.5-rc.3`** | `node scripts/audit-dsh-version.mjs` |
| 0.2 | 把 `dsh-runtime-src/package.json` 的 pin 改为 **精确 `0.1.5-rc.3`**（去掉隐式 caret 漂移面） | 同上（判据 ② 比对顶层主包版本） |
| 0.3 | **补判据盲区**：让 `audit-dsh-version.mjs` 增加一条「子包版本一致性」判据 —— 至少断言 `dsh-session` 等**关键子包**的版本 ∈ 单源声明的主版本线内 | `--selftest` 加正负控 |
| 0.4 | 修正 `dsh-version.json` 里已过期的 `_dshVersionNote`（「可能落到更小的 rc」→ 事实描述） | 人工复核 |

**收益**：不改任何功能，先把「名义 pin 与实际解析」对齐，并把盲区补成判据。

### 阶段 1：实测目标版本的契约形态（**先探针，后升级**）

| 步 | 动作 | 判据 |
|---|---|---|
| 1.1 | 在**临时目录**（不进仓库）安装 `@deepseek-ai/dsh@0.1.5-rc.3` | 装得上 |
| 1.2 | 读它的 `dsh-session` 的 `isReplaceOp` 函数体 | 三键形态 == `["op","startSeq","endSeq"]` |
| 1.3 | 跑我方官方契约探针 `audit-official-contract.mjs` 指向新版本 | 无 BLOCK |
| 1.4 | 比对新旧版本的**事件类型全集**（surface 事件类型、`KNOWN_SESSION_EVENT_TYPES`） | 有无增删 |
| 1.5 | **★ 按 [附录 B](#附录-b安卓适配层的完整性审计升级会打断哪一层) 的六层清单逐层过** | 每层给出「仍成立 / 已变 / 需重写」 |
| 1.6 | **★ 按 [附录 C](#附录-crp-世界的完整性审计) 的 RP 面清单逐面过** | 同上 |
| 1.7 | **★ 按 [附录 D](#附录-d升级到底要考虑什么条完整判据带正负控) 先补判据** | 每条判据带正负控且能自证 |

> **为什么先做这一步**：`GOAL.md` §七 R21 的纪律 —— **契约探针在构建期 BLOCK 是最后防线**，
> 但它的输入面来自当前 runtime；**升级前必须先看清新版本的契约**，否则是拿旧判据验新世界。
>
> ⚠️ **1.5/1.6/1.7 是 2026-09-23 补充的**：只有 1.1~1.4 时，本阶段实际只覆盖了
> 「会话数据形态」一个面，而**安卓适配层（六层）与 RP 面（十个面）根本不在覆盖内**。
> 这正是本轮用户指出的缺口 —— 结论先行不算审计。

### 阶段 2：核对补丁面（**升级成本的主要来源**）

| 步 | 动作 |
|---|---|
| 2.1 | 逐条核对 `apply-platform-patches.py` 的 **12 组补丁**，对每个锚点（文件路径 + 文本正则）确认在新版本里**仍存在** |
| 2.2 | 特别关注**包重组**：若某补丁的锚点文件在新版里被移动/合并，必须重新定位 |
| 2.3 | 核对 **11 个源文件里的 79 处事件字符串**（`'user/message'` / `'assistant/message'` / `'system/message'` / `'tool/result'`）是否仍成立 |
| 2.4 | 核对 3 个会话解析器 |

**实测基线（本机跑出的对账起点）**：

```
补丁组（12）：P0-1a bash-local run/start argv · P0-1b bash-sandbox confine argv
             P0-2 sandbox-local android 降级 · P0-2b sandbox-local PRoot 真隔离
             P1-3b fs-search 降级模块导入 · P1-3c runRipgrep android 短路
             P1-4a terminal-bash DEFAULT_BASH_SHELL · P1-4b terminal-bash DEFAULT_BASH_ARGS
             P2-1a ChatNodeList 传入 firstSeq · P2-1c processWindowReady 放宽
             P3-5a session-title 剥协议标签 · P0-5 Iterator Helpers 守卫

唯一 marker（18）：DSHT-ANDROID-{FLOOK→FLOCK, ITERATOR, JS-SEARCH, PROOT,
                 RENAME-FS, RENAME-GEN, RENAME-LEGACY, RENAME-PATCH, SH,
                 TERM-ARGS, TERM-SHELL, UNSANDBOXED}
                 DSHT-{CHAT-FOLD-OLDEST, CHAT-FOLD-READY, CHAT-FOLD-SEAT,
                 TITLE-DETAG, SIM}

事件字符串：11 个源文件 / 79 处命中（`packages/src/**`，排除 node_modules，共 149 个源文件）
```

**产出**：一份「补丁点 × 新版本仍成立 / 已失效 / 需重写」的对账表。

### 阶段 3：正式升级 + 分层验证

| 步 | 动作 | 验证方式 |
|---|---|---|
| 3.1 | 改 `dsh-runtime-src/package.json` 的 pin → `0.1.5-rc.3`，重装 | `node scripts/fetch-native-libs.mjs` + 依赖树无 dedupe 冲突 |
| 3.2 | 重跑补丁 | `apply-platform-patches.py` 幂等（marker 命中数符合期望） |
| 3.3 | 构建期门禁全绿 | `build-dsht.ps1` 全门禁 + 契约探针不 BLOCK |
| 3.4 | vitest 全绿 | `npm test --prefix packages`（当前基线 1839 通过） |
| 3.5 | **模拟器实测（关键，不可跳）** | 装 APK → node 起来（0 boot loop）→ **打开一条老会话**（验数据兼容）→ 跑一轮对话 |
| 3.6 | 出双架构包 + 发 release | 与 v0.2.6 同流程 |

> **3.5 是本次升级唯一不能省的一步**：W24c 的教训证明「编译过 + 门禁绿」**不等于**
> 「设备上历史会话打得开」。

### 阶段 4（可选）：`dsh-version.json` 的形态判据加代

若阶段 1 实测发现形态有变，则：
- 更新 `sessionReplaceOpFields` 与 `sessionReplaceOpKnownGenerations`；
- 并**同步写一份数据迁移/兼容说明**（老会话是否需要转换）。

---

## 5. 回滚方案

| 层级 | 回滚动作 |
|---|---|
| 版本单源 | `git checkout` `dsh-version.json` + `dsh-runtime-src/package.json` |
| runtime | 重装（`fetch-native-libs.mjs` 按旧 pin 重拉） |
| 补丁 | 补丁脚本幂等可重跑；`apply-platform-patches.py` 有 marker 计数校验 |
| 产物 | 已发布的 v0.2.6 双架构 APK 是已知良好基线，可随时回退发布 |

**回滚触发条件（任一即回）**：契约探针 BLOCK / 模拟器打不开老会话 /
node boot loop / vitest 出现与升级相关的失败。

---

## 6. 风险清单

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | 旧会话打不开（`isReplaceOp` 形态换代） | **高** | 阶段 1.2 先探针；阶段 3.5 实测老会话 |
| R2 | 补丁锚点失效（包重组 / 文件移动） | 中 | 阶段 2 逐条对账，产出失效清单 |
| R3 | 顶层与子包版本分裂继续扩大 | 中 | **阶段 0** 立即修 + 补判据 |
| R4 | 判据盲区（`audit-dsh-version` 看不见子包） | 中 | 阶段 0.3 补判据 |
| R5 | alpha 线 API 未稳（依赖改精确 pin） | 中 | **不跟 alpha**（§3.3） |
| R6 | 真机验证靠众包 ⇒ 升级后问题暴露慢 | 中 | 模拟器上把「老会话可打开」跑成必过项 |

---

## 7. 本项目全部 goal 文档清单（用户要求「把所有 goal 都写进去」）

### 7.1 Goal 文档（SSOT 类）

| 文档 | 建立 | 定位 | 当前状态 |
|---|---|---|---|
| [GOAL.md](GOAL.md) | 2026-09-18（W82） | **本仓唯一长期 goal SSOT**（740 行）。判据哲学 §二、纪律 §七、P 判据全集见 `MOBILE-TEST-METHODOLOGY.md` §5.4 | 活跃（每轮必改 §3.1 基线表） |
| [GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md](GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) | 2026-09-21 | **DSH 层彻底化**专项：W-1~W-11 工作面 + 完成定义六条 + 逐条终局审计 | ✅ **本次已完成**（v0.2.6 双架构已发布） |
| [GOAL-ANDROID-GAP-2026-09-21.md](GOAL-ANDROID-GAP-2026-09-21.md) | 2026-09-21 | 安卓化 DSH 层**对 DSHA 的差距**补齐（只覆盖原生壳/运行时/网络/数据安全，不含 RP） | 已归档（E1/E2 翻案并入 COMPLETE，E4 维持不追） |
| [GOAL-ECO-SPRINT-2026-09-20.md](GOAL-ECO-SPRINT-2026-09-20.md) | 2026-09-20 晚 | **生态冲刺**：插件生态基础设施 + MVU 深耕 + 补丁上游化 + 收尾 | 已执行（用户裁定「真机测试先放一边，狂飙突进」） |
| [GOAL-PRESET-SWITCH-2026-09-20.md](GOAL-PRESET-SWITCH-2026-09-20.md) | 2026-09-20 | **预设管线切换收口** + 社区插件适配（W-A/W-B/W-C，边界 B-1） | 已执行 |
| [V0.3-FREEZE.md](V0.3-FREEZE.md) | 2026-09-08 | V0.3 **功能冻结清单**：承诺/尽力/明确不承诺的边界切分 | 生效中（约束新功能） |

### 7.2 配套单源（被 goal 引用，不复制其内容）

| 文档 | 作用 |
|---|---|
| [MOBILE-TEST-METHODOLOGY.md](MOBILE-TEST-METHODOLOGY.md) | 范围矩阵 L1~L5、方法 M1~M7、**P 判据全集（§5.4）**、开放项表（§六） |
| [ST-COMPAT-PACT.md](../rp-workspace/docs/ST-COMPAT-PACT.md) | 兼容契约条款 A/B/C/D + 逐轮 E-H 复核附录 |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) / [COPYRIGHT-AUDIT-FULL-2026-09-14.md](COPYRIGHT-AUDIT-FULL-2026-09-14.md) | 第三方引用清单与处置 |
| [B-DEVICE-VERIFY-CHECKLIST.md](B-DEVICE-VERIFY-CHECKLIST.md) | **真机众包验证清单**（本文档 §4 阶段 3.5 可直接挂靠） |

### 7.3 本次 DSH 层彻底化的交付记录（W-1 ~ W-11）

| 工作面 | 交付 | 状态 |
|---|---|---|
| W-1 node-pty 自编译 | NDK 交叉编译，**bionic 原生有 PTY**（推翻「需 50 行 shim」的假设） | ✅ 双架构产物 + 模拟器端到端 |
| W-2 Shizuku 通道 | 调研报告 + 配对引导 UX（五态进 W-7 看板） | ✅ 骨架（`uid 2000` 众包） |
| W-3 设备能力工具集 | 4 个 DSH 工具 + **UserService 执行层**（本轮接线） | ✅ 真机实证众包 |
| W-4 守门人扩展 | danger 档挂起 + 默认拒绝 + 单次有效；**三档位正反控** | ✅ |
| W-5 原生模块清零 | sharp → `@img/sharp-wasm32`（spike 19/19） | ✅ |
| W-6 共享交换目录 | 双向通道 + 凭据**双向拒绝** | ✅ 正反控实证 |
| W-7 能力-权限矩阵看板 | 每行 = 状态/原因/一键跳转 + Shizuku 五态 | ✅ 真机逐屏实证 |
| W-8 系统轻入口 | 分享 sheet（文本/链接/图片）+ 快速设置磁贴 | ✅ 真机实证 |
| W-9 敏感数据落盘调研 | 明确决策（维持现状）+ 4 条推翻条件 | ✅ |
| W-10 插件安装通道调研 | 注入点定案 + 5 条前置条件 | ✅ |
| W-11 导入适配流程文档 | README 中英双语补「ST 数据适配」会话环节 | ✅ |

### 7.4 发版沿革（本轮）

| 版本 | 主题 | 备注 |
|---|---|---|
| v0.2.3 | 设备能力（终端可用 / 图片通道 / 设备工具集） | 双架构 |
| v0.2.4 | 系统轻入口 + 调研面收口 | 双架构 |
| v0.2.5 | W-3 设备执行层接线 | ⚠️ **双架构无法启动**（`libz.so.1` 缺失） |
| **v0.2.6** | **修复 libnode DT_NEEDED 闭合** | ✅ Latest，双架构，CI 绿 |

> **v0.2.5 事故的一条教训**（与本升级直接相关）：根因是
> `fetch-native-libs.mjs` 的**一条从未被验证的注释**声称「这些库已在 runtime/lib」，
> 而它们从未被部署。**升级 DSH 版本时同样会产生这类「注释里的承诺」** ——
> 故阶段 2 的补丁面核对必须**逐条实测锚点**，不能凭注释。

---

## 8. 建议的执行顺序（一页纸）

> ⚠️ **2026-09-23 第三轮：本节已由 [附录 E](#附录-e017-rc1-作战计划第三轮现行) 取代**
> （0.1.7-rc.1 发布 ⇒ 目标改为「升到 rc.1」，九阶段计划 A~G）。
> 以下保留为**历史**（当时的语境是「目标 = 0.1.5-rc.3」）。

```
阶段 0  修版本分裂（不升级，可立即做）        ← 收益明确、风险最低　✅ 已完成 2026-09-23
   ↓
阶段 1  探针目标版本契约（临时目录，不动仓库）
        **含附录 B（安卓六层）+ 附录 C（RP 十面）的逐层/逐面对账**
   ↓
阶段 2  补丁面逐条对账 → 产出「失效清单」
        （★ 含锚点**指纹**，不只命中数 —— 见 B.2）
   ↓
阶段 3  pin 改 0.1.5-rc.3 → 重装 → 重跑补丁 → 门禁 + vitest + 模拟器（含老会话）
        **入口：[附录 D](#附录-d升级到底要考虑什么条完整判据带正负控) 的六段判据**
   ↓
阶段 4  出双架构包 → 发 release
```

**若只能做一件事**：做**阶段 0**。它不碰功能、不改数据、能消除版本分裂、
并把判据盲区补上 —— 性价比最高，且**完全无风险**。

**若要做升级**：先按 [D.3 的「不可省略清单」](#d3-升级前的不可省略清单缺一不可) 走，
**九项缺一不可**（第 0 项 = 先修门禁自身）；其中第 4 项（备份设备真实数据）
是唯一一条「不做就没有退路」的。

---

## 附录 A：→ 0.1.7-alpha.2 的破坏性变更逐项审计

> **本附录是应要求补做的**：§3.3 此前只给了「不建议跟 alpha」的结论，
> **没有给出破坏性变更的逐项证据** —— 那是结论，不是审计。本附录补上。
>
> **方法**：在临时目录完整安装 `@deepseek-ai/dsh@0.1.7-alpha.2`（510 个包），
> 与我方 runtime（`dsh-runtime-src/node_modules`）做**逐项实机比对**。
> 所有数字与代码片段均为实跑产出，可复现。
>
> **★ 本附录的覆盖边界（诚实声明 R7）**：A 只审「**官方变了什么**」——
> 它是**世界侧**的审计。**我方侧的耦合面**在 [附录 B](#附录-b安卓适配层的完整性审计升级会打断哪一层)（安卓六层）
> 与 [附录 C](#附录-crp-世界的完整性审计)（RP 十面），**验收判据**在
> [附录 D](#附录-d升级到底要考虑什么条完整判据带正负控)。**四者合起来才是完整审计。**

### A.0 结论

**0.1.7 对我方是「破坏性升级」，不是「补丁升级」。** 三条硬阻断：

| # | 阻断项 | 性质 |
|---|---|---|
| **B1** | **会话格式 v3 → v4**（`currentVersion: 3 → 4`） | **数据层**，迁移后不可逆 |
| **B2** | **`tool/result` 消息表示重写**（`role:'user'` → `role:'tool'`） | **数据层 + 我方解析器** |
| **B3** | **2 条补丁锚点已失效**（实测） | **构建层**，补丁打不上 |

⇒ **建议维持 §3.3 的「不跟」结论，但现在有了逐项证据与代价估算。**

---

### A.1 包集差异（实测）

```
我方（dsh-runtime-src）      240 个 @deepseek-ai/* 包
0.1.7-alpha.2              277 个
```

**新增 41 个**（择要，完整体现方向）：

| 类别 | 新增包 |
|---|---|
| **格式迁移** | **`dsh-session-format-v3-to-v4`** ← ★ 见 A.2 |
| 语音/实验 | `dsh-experimental-speech-to-text`（+`-sensevoice`）、`dsh-experimental-voice-input-bundle`、`dsh-experimental-client-ui-voice-input` |
| Agent 团队 | `dsh-experimental-agent-team`（+profile/+client-ui/+tool）、`dsh-agent-preset-registry` |
| 插件管理 | `dsh-plugin-manager`、`dsh-client-ui-plugin-manager`、`dsh-host-plugin-inventory` 系 |
| PTC 运行时 | `dsh-ptc-runtime`、`dsh-ptc-runtime-node`、`dsh-workflow-ptc` ← 取代 `dsh-code-runtime` |
| 终端 UI | `dsh-client-ui-sidebar-terminal`、`dsh-api-terminal-controller` |
| 办公 | `dsh-office-to-pdf`、`dsh-skill-office`、`libreoffice-kit(-win32-x64)` |
| 其他 | `dsh-hmr`、`dsh-lazy-require`、`dsh-compaction-image-offload`、`dsh-mcp-resources`、`dsh-workspace-changes` |

**消失 6 个**（★ = 我方直接受影响）：

| 消失的包 | 影响 |
|---|---|
| **`dsh-agent-presets`** | ★ 被 `dsh-agent-preset` + `-registry` 取代 —— **改名**，我方若有引用需同步 |
| **`dsh-code-runtime`** / `dsh-code-runtime-worker-thread` | ★ 被 `dsh-ptc-runtime*` 取代 —— **整块能力换实现** |
| `dsh-workflow-worker-thread` | 被 `dsh-workflow` 系重组吸收 |
| `dsh-settings-file` | 设置持久化改由 `dsh-storage*` 承担 |
| `cordis-plugin-hmr` | 由 `dsh-hmr` 取代（**注意：这直接影响我们的 `patchReload` 定案** —— 见 A.5） |

---

### A.2 ★ B1：会话格式 v3 → v4（最高风险，数据层）

**实测证据**：

```
我方   dsh-session-format-catalog/lib/index.js : currentVersion: 3
0.1.7  dsh-session-format-catalog/lib/index.js : currentVersion: 4
       + 新增迁移边包 dsh-session-format-v3-to-v4
```

**硬校验（官方源码原文）**：

```js
if (header.version !== SESSION_FORMAT_VERSION)
  throw new Error(`installed Session format is v${SESSION_FORMAT_VERSION}, got v${header.version}`);
```

⇒ **v3 的会话日志在 0.1.7 下会被直接拒绝**，除非先跑 v3→v4 迁移。

**v4 到底改了什么**（取自官方 `README.zh.md` 规范原文）：

| 变更 | v3 | v4 |
|---|---|---|
| **工具结果角色** | `data.message.role: 'user'` + 嵌在 content[0] 的 wrapper | **`role: 'tool'`**，`toolCallId` 提到 `data.message.toolCallId`，`isError` 提到顶层 |
| **wrapper** | 有 `type: 'tool-result'` wrapper | **wrapper 移除** |
| 丢弃字段 | — | wrapper 其余字段 → `plugin:result:<原字段名>`；消息其余字段 → `plugin:message:<原字段名>` |
| **插件来源名** | `plugin` 属性 | 移除 `plugin`，改 `kind`，且**4 组改名**：<br>`compact`→`compact-checkpoint`<br>`tools-code-mode`/`tools-ptc`→`ptc-mode`<br>`dsh-compaction-basic`→`compact-basic`<br>`@deepseek-ai/dsh-system-prompt`→（system 角色）`system-prompt` /（其他角色）`runtime-context` |
| 未知内容标签 | 原样 | `plugin:<原类型>` |
| 父目录事实 | — | **需收集直属 subagent 子会话证据**（`childId`/`childCreatedAt`/`descriptorCount`/`descriptor`），缺失则追加 `subagent/catalog` |

**迁移的硬约束（官方明示，实施时必须处理）**：

1. **需要子级证据**：`sessionFormatV3ToV4.createStage()` 在**没有子级绑定时会拒绝**；
   空数组才表示「确无子级」。⇒ 我方迁移时必须**收集完整直属子会话集合**。
2. **部分输出不算成功**：后续行或 `finish()` 仍可拒绝整份产物。
3. **不修复矛盾数据**：转换器**不会**修复矛盾的 `data.error`；原生目标校验要求它与
   wrapper 的 `isError: true` **同时出现**。
4. **拒绝不改源**：任何拒绝都**不授权**修改源、发布部分后继或回退代际。
5. **`deferLoading` 陷阱**：若工具定义拥有顶层 `deferLoading` 字段，**拒绝迁移**
   （该字段仅在 v4 定义，迁移边不为它赋予历史含义）。
6. **嵌套工具结果不支持**：遇到即拒绝且不发布 successor。

**对我方的直接影响**：

- 我方会话解析器（`rp-convert-chat`、`session-rollback`、`session-regenerate` 等）
  **都要认 v4 的 `role:'tool'` 形态**；
- `replace` 事件本身**形态未变**（实测 `isReplaceOp` 仍是 `op/startSeq/endSeq` 三键）
  —— 这是我方 `dsh-version.json` 判据 ③ 的**好消息**，但**不足以**覆盖 v4 的其他改动。

> ⚠️ **注意判据 ③ 的盲区**：它只盯 `isReplaceOp` 的三键形态，而 v4 改的是
> **`tool/result` 的消息表示**与**来源命名**——这两处**不在判据 ③ 的覆盖范围内**。
> ⇒ 升级到 0.1.7 前，判据必须**扩面**（见 A.6）。

---

### A.3 ★ B2：`tool/result` 表示重写的连带面

实测 v4 规范给出**受检位置清单**（官方明确「只检查以下位置，不遍历任意后代」）：

| 所有者 | 检查的内容位置 |
|---|---|
| `user/message` | `data.content[]` |
| `system/message`、`developer/message`、`assistant/message`、`tool/result` | `data.message.content[]` |
| `agent/inbox/spliced`、`session/title-llm-request` | `data.inserted[].content[]` / `data.messages[].content[]` |
| `team/message/queued` | `data.message.content[]` |
| `compaction/summary`、`tool/ptc-dispatch` | `data.summary[]`、`data.rawOutput[]`、`data.content[]` |
| 内嵌 assistant 流 | `assistant/message.data.stream[]` / `assistant/attempt.data.stream[]` 的 `chunk.block.type` 与 `chunk.blockType` |

⇒ **我方只要碰这些位置的代码，都要按 v4 语义复核。**

---

### A.4 ★ B3：补丁锚点失效（实测 13 条中的 2 条）

用脚本从 `apply-platform-patches.py` **精确提取 13 条** `(目标文件, 锚点正则)`，
逐条在我方与 0.1.7 上实测命中数：

| 结果 | 条数 | 明细 |
|---|---|---|
| ✅ 仍匹配 | **11** | `DSHT-SIM`（3 文件）、`DSHT-ANDROID-SH`(bash-local)、`DSHT-ANDROID-UNSANDBOXED`、`android-fallback.mjs`、`DSHT-ANDROID-JS-SEARCH`、`DSHT-ANDROID-TERM-SHELL`、`DSHT-ANDROID-TERM-ARGS`、`DSHT-TITLE-DETAG`、`DSHT-ANDROID-FLOCK` |
| ⚠️ **锚点失效** | **2** | 见下 |

**失效 ① `dsh-bash-sandbox`（`DSHT-ANDROID-SH`）**

```
我方锚点：r'"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tcommand\r?\n\t\t\], policy\);'
                                                              ↑ 两参数
0.1.7 实际：confine([
                "bash",
                "-c",
                command
        ], policy, signal);
              ↑ 官方新增了第三个参数 signal
```

⇒ **成因：官方给 `confine()` 加了 `signal` 参数**。修法 = 锚点正则改为容忍可选第三参
（或改用更稳的锚定方式，避免再被参数增删打穿）。

**失效 ② `dsh-client-ui-sidebar-documentpreview`（`DSHT-ANDROID-ITERATOR`）**

```
我方锚点：r'if \(typeof Iterator\.prototype\.join !== "function"\)'
0.1.7：该文件里已无此形态（实测 grep 无命中）
```

⇒ **成因：官方换/升级了 PDF.js 构建产物，该处代码不再存在**。
修法 = 需先确认「旧 WebView 的 ES2025 Iterator Helpers 问题在 0.1.7 里是否仍存在」——
**若官方新产物已不用该 API，则这条补丁可以直接删除**（是净简化，不是负债）。

---

### A.5 其他需注意的连带变更

> ★ **2026-09-23 执行阶段实测补充（本轮的完整逐面结果）**：
> 用 `rp-workspace/tmp/probe-017-full.mjs` 跑了附录 B/C 的**全部六层 + 十面**，
> 逐条实机对账。**结论比初版更完整**，且**更正了初版的一处误判**：

| 面 | 实测结果 | 三态 |
|---|---|---|
| **B.1 版本** | 我方 `0.1.5-rc.1`（顶层）→ 0.1.7 `0.1.7-alpha.2`；0.1.7 的 deps：**80 个总依赖中 72 个精确 pin**（只有 3 个 caret） | 已变（官方收紧） |
| **B.1 包集** | 240 → **277**（+43 / −6） | 已变 |
| **B.2 补丁锚点** | **10/13 仍匹配，3 条失效** | ★ 见下 |
| **B.4 壳面** | ★★ **CLI 面全部仍存在**，但**从 `dsh` 包搬到了 `dsh-web-app` 包**：`--no-open`/`--port` → `dsh-web-app/lib/startup.js`；`--trusted-host`/`dsh web:` → `dsh-web-app/lib/index.js`；`dsh web` 子命令 → `dsh/lib/bin.js` | **仍成立（位置已变）** |
| **B.5 external 包** | 我方 4 个 external（`dsh-client-ui-{sidebar,layout,conversation,settings-plugins}`）**全部仍在** | 仍成立 |
| **B.5 bundles** | `dsh-base` / `dsh-web-app` **都仍在** | 仍成立 |
| **B.5 slot** | ★ **7 个里有 1 个消失**：`settings.plugin.item` **已不存在**（官方改 `settings.pluginInventory` / `settings.plugins.tab`） | ★ **已变（静默失效）** |
| **B.6 数据** | `SESSION_FORMAT_VERSION` **3 → 4**；`isReplaceOp` 三键形态**未变**（`op/startSeq/endSeq`） | ★ 半变 |
| **B.6 事件类型** | 56 → 59（+3：`developer/message`、`image/offload`、`workspace/changes`；**无消失**） | 增量 |
| **C.2 锚点** | ★★ **4 组哈希前缀全部仍在**（`pI_x6G` ×50 · `VOzbGW` ×49 · `hHd-Xa` ×177 · `wSkVaW` ×108）+ `data-shell-overlay` 在 1 个包里 | **仍成立**（意外的好消息） |
| **C.8 ST 面** | 官方 0.1.7 **未引入**任何 tavern/sillytavern 包 ⇒ 我方 ST 兼容层仍独占 | 仍成立 |

**★ 更正初版的一处误判**：初版 A.5 写「`cordis-plugin-hmr` → `dsh-hmr`，需重新核实 HMR」
—— 实测确认**该包确实消失了**（在 6 个消失包之列），但**更重要的是**：
`--expose-internals` 参数在 0.1.7 里**也消失了**（我方 NodeService 当前**硬编码**传它）。
⇒ 这构成**第 4 条阻断**（初版漏了）：见 A.9。

**★ 3 条失效锚点的精确清单**（初版说 2 条，实测 3 条）：

| # | 补丁 | 目标 | 失效原因 |
|---|---|---|---|
| 1 | `DSHT-ANDROID-SH` | `dsh-bash-sandbox/lib/index.js` | 官方给 `confine()` 加第三参 `signal` |
| 2 | `DSHT-ANDROID-ITERATOR` | `dsh-client-ui-sidebar-documentpreview/lib/client.js` | PDF.js 产物换代，该行不存在 |
| 3 | `DSHT-ANDROID-ITERATOR` | 同上（**第二轮对账**） | 同上 —— 初版重复计为 1 条，实为同一处 |

> ⇒ 净计：**2 处失效**（`DSHT-ANDROID-SH` 与 `DSHT-ANDROID-ITERATOR`），
> 初版 A.4 的结论正确；本轮的 `probe` 因把 `client.js` 单列补测而显示 3，
> 是**探针的计数口径**问题，已在脚本注释里标明。

**★ 其他需注意的连带变更（初版表格保留）**：

| 项 | 实测/推断 | 我方动作 |
|---|---|---|
| **`cordis-plugin-hmr` → `dsh-hmr`** | 包改名 | ★ 我方 `patchReload` 的定案是「Android 上 HMR 起不来 ⇒ 用 `"startup"`」。0.1.7 换实现后**需重新核实 HMR 在 Android 是否仍不可用** —— 若新 `dsh-hmr` 可用，`startup` 的取舍理由需重写 |
| **事件类型 +3** | `developer/message`、`image/offload`、`workspace/changes`（**无消失**） | 增量式，好消息；但 `developer/message` 进入了 v4 的**受检位置清单**，我方解析器若要认它需新增分支 |
| **`dsh-agent-presets` → `dsh-agent-preset(+registry)`** | 改名 + 拆分 | 我方 `rp/import-api-config`、agent preset 同步逻辑需核对 |
| **`dsh-code-runtime` → `dsh-ptc-runtime*`** | 整块换实现 | 我方若有引用（含补丁）需重写 |
| **依赖改为精确 pin** | 0.1.7 对 `dsh-base`/`dsh-app-boot` 用 `"0.1.7-alpha.2"` 而非 `^…` | 官方自己在收紧 ⇒ **API 未稳**，进一步支持「不跟 alpha」 |

---

### A.6 若真要升到 0.1.7：需要补的改动清单

> 按依赖顺序；**每项都要有判据**，不能只靠人工核对。

**① 判据扩面（先做，否则后面全靠肉眼）**

| 判据 | 现状 | 0.1.7 需要 |
|---|---|---|
| `audit-dsh-version.mjs` ③ 会话形态 | 只查 `isReplaceOp` 三键 | **扩为多面**：`tool/result` 的角色表示 + `kind` 命名表 + header version |
| 新增 · 会话格式代次 | 无 | 断言 `SESSION_FORMAT_VERSION` == 单源声明值（3 或 4） |
| 新增 · 子包版本一致性 | **无（本轮发现的盲区）** | 断言关键子包 ∈ 单源主版本线 |

**② 数据层**

| 项 | 动作 |
|---|---|
| v3→v4 迁移 | 接入 `dsh-session-format-v3-to-v4`；**必须**收集直属 subagent 子会话证据 |
| 迁移不可逆 | 迁移前**强制备份**；写清「拒绝不改源」的语义 |
| 我方解析器 | `rp-convert-chat` / `session-rollback` / `session-regenerate` 等按 v4 的 `role:'tool'` 与 `kind` 表复核 |
| 老会话实测 | 用**真实批次数据**跑迁移 + 打开（这是唯一能证明数据的判据） |

**③ 补丁层**

| 项 | 动作 |
|---|---|
| `dsh-bash-sandbox` | 锚点正则容忍 `signal` 第三参 |
| `dsh-client-ui-sidebar-documentpreview` | 先判定「ES2025 守卫是否仍需要」；不需要则**删补丁** |
| 其余 11 条 | 锚点仍匹配，但**需逐条确认语义未变**（匹配 ≠ 行为正确） |
| `cordis-plugin-hmr` 系 | 重新核实 HMR 可用性，可能推翻 `patchReload: "startup"` 的定案 |

**④ 构建层**

| 项 | 动作 |
|---|---|
| 包结构调整 | `dsh-agent-presets` / `dsh-code-runtime` 引用同步改名 |
| 新增原生依赖 | `libreoffice-kit-win32-x64`（Windows 专用）—— 确认 Android 侧是否需要/能否裁掉 |
| 体积 | 新增 41 个包（含 speech-to-text、office-to-pdf、PTC）⇒ **APK 会显著变大**，需实测并决定裁剪面 |

---

### A.7 代价估算与建议

| 维度 | 0.1.5-rc.1 → rc.3（§3.1） | → 0.1.7-alpha.2（本附录） |
|---|---|---|
| 数据兼容 | ✅ 无破坏 | ❌ **v3→v4 迁移，不可逆** |
| 我方解析器 | 不动 | **需按 `role:'tool'` + `kind` 表复核** |
| 补丁 | 0 条失效（**已实测证实**） | **2 条失效**（实测） |
| 判据 | 补 1 条盲区（**已完成**） | 补 3 面（格式代次 / 工具结果表示 / 子包一致性） |
| 包结构 | 不变 | **6 个包消失、43 个新增** |
| 真机验证 | 跑一次启动 | **必须**跑迁移 + 打开老会话 |
| 风险 | 低 | **高** |

**建议**：
1. **先做 §4 阶段 0**（无风险，且是后续任何升级的前置）—— ★ **2026-09-23 已完成**（见 A.9）；
2. **等 0.1.7 进 `latest`**（转 rc）再评估 —— 届时官方 API 已收紧完毕、迁移边也稳定；
3. 若因某个特性**必须**上 0.1.7，则按 **A.9 的清单**做，且**①（判据扩面）绝不能省** ——
   否则会重演 v0.2.5 那类「绿灯但不可用」的事故（见 §7.4 的教训）。

---

### A.8 本附录的可复现性

```bash
# 1. 装 0.1.7 到临时目录
cd %TEMP% && mkdir dsh17 && cd dsh17 && npm init -y
npm install @deepseek-ai/dsh@0.1.7-alpha.2

# 2. 我方 vs 0.1.7 的**全六层 + 十面**逐条对账（本轮新增，只读）
node rp-workspace/tmp/probe-017-full.mjs

# 3. 升级验收六段判据（对当前 runtime；也是 0.1.7 的最后验收门）
node rp-workspace/scripts/audit-upgrade-readiness.mjs --selftest
node rp-workspace/scripts/audit-upgrade-readiness.mjs
```

---

### A.9 ★ 执行记录：0.1.5-rc.3 已完成，0.1.7 的完整作战清单（2026-09-23）

> **本节是「执行到哪了」的唯一事实来源**（前几节是调研结论，本节是执行状态）。

#### A.9.1 已完成（本轮实际改动）

| # | 动作 | 证据 |
|---|---|---|
| 1 | 修 `audit-build-path-parity.py` 长期 37/38 FAIL | 根因是 `dsh-version.json` **真实缺 BOM**（会让构建 Step 0.7 直接 throw），而被负控的假 FAIL 掩盖。补 BOM + 负控加**前提断言** ⇒ **38/38 PASS + 主判据全绿** |
| 2 | **阶段 0**：修版本分裂 | `dsh-version.json` 与 `dsh-runtime-src/package.json` 同步改 `0.1.5-rc.3`；重装后 **231 个子包 + 顶层全部 rc.3，零分裂** |
| 3 | 新增 `audit-dsh-version.mjs` **判据⑤**「子包版本一致性」 | 带 **5 项正负控**（跨代 FAIL / 同线 rc 漂移放行但出声 / 全一致 / 扫不到 / 杠杆）；selftest **9→14/14** |
| 4 | 新增 **`audit-upgrade-readiness.mjs`**（附录 D.0 的机器化） | **六段**：版本 / 补丁 / 原生 / 壳 / 装配 / 数据；selftest **7/7**；**已接入 `build-dsht.ps1` 门禁循环 + 读数表** |
| 5 | 六段判据在真实 runtime 上**六段全过**（6 OK / 0 BLOCK / 0 UNKNOWN） | 补丁 **23 处全部打完、0 失败**；就绪信号 / slot / 格式代次全部命中 |
| 6 | 全六层 + 十面 0.1.7 实测（`probe-017-full.mjs`） | 见 A.5 表 |

**★ 本轮判据自身抓到的 4 个缺陷（全部当场修掉，这是最有价值的部分）**：

| # | 缺陷 | 性质 |
|---|---|---|
| 1 | 两个「真实仓库负控」**不做前提断言**就 `orig[3:]` | 假 FAIL **掩盖**真缺陷（P-30） |
| 2 | 新判据把 `readFile` 做成可注入但**目录遍历仍用真实 fs** | 判据**无法自证**（正负控双向被污染） |
| 3 | 假 FS 用正斜杠键、探针用 `path.join`（Windows 反斜杠） | **跨平台假绿**（Windows 测不出 / Linux 通过） |
| 4 | 判据⑥ 在「未声明格式代次」时**默认放行** | **假绿**（永远说 OK 的判据 ≡ 没有判据，P-11） |

> 这 4 个全部是**负控实测**抓出来的 —— 印证了本仓的纪律：**没有正负控的判据不算判据**。

#### A.9.2 ★ 0.1.7 的**四条硬阻断**（初版说三条，实测补第四条）

| # | 阻断 | 性质 | 证据 |
|---|---|---|---|
| **B1** | **会话格式 v3 → v4**（`currentVersion: 3 → 4`） | **数据层，不可逆** | `dsh-session-format-catalog` 实测 |
| **B2** | **`tool/result` 表示重写**（`role:'user'` → `role:'tool'`） | 数据层 + 我方解析器 | v4 规范 |
| **B3** | **2 条补丁锚点失效** | 构建层 | `probe-017-full.mjs` 实测 |
| **B4** | ★ **`--expose-internals` 参数消失**（初版漏） | **壳层** | 实测 `dsh` + `dsh-web-app` 全包 **0 命中**；而 NodeService **硬编码**传它 |

> **B4 为什么危险**：它不是「功能不对」，而是**node 启动参数被拒** ⇒ 可能直接
> `node exited with code 1` → watchdog 3 秒重启 → **boot loop**（与 W-3 事故同形态）。
> 而它**只在传了非法参数时**才炸，`--selftest` 与编译期都看不见。

#### A.9.3 0.1.7 作战清单（按依赖顺序，每项都要判据）

**阶段 1：判据扩面（**先做，否则后面全靠肉眼**）**

| # | 动作 | 判据 |
|---|---|---|
| 1.1 | `audit-dsh-version.mjs` 判据③ **扩为多面** | 现有：`isReplaceOp` 三键。需加：v4 的 `tool/result` 角色表示 |
| 1.2 | 单源加 `sessionFormatKnownGenerations: [3, 4]` | 判据⑥ 已有（**本轮已建好，升级时改数字即可**） |
| 1.3 | 新增「事件信封白名单」对账 | `ENVELOPE_KEYS` 硬编码 vs 官方（防「修一次丢一次数据」） |

**阶段 2：数据层（最高风险）**

| # | 动作 | 要点 |
|---|---|---|
| 2.1 | 接入 `dsh-session-format-v3-to-v4` 迁移 | **必须**收集直属 subagent 子会话证据（缺失则拒绝，官方明示） |
| 2.2 | **迁移前强制全量备份**（用户已裁定） | 备份落**共享交换目录**（`/sdcard`，**不入库**）＋ 加 `.gitignore` 规则把「备份被误拷进仓库」也堵死 |
| 2.3 | 我方解析器按 v4 复核 | `session-repair.ts` 的 `ENVELOPE_KEYS` / `STEP_SCOPED`（含 `tool/result`）/ `srcVersion >= 3` 的**巧合正确性**改为**按代次查表** |
| 2.4 | `pickCurrentSessionFilename` 取最大 N | v4 文件到来时会自动挑中 ⇒ 必须确保解析器认它 |

**阶段 3：补丁层**

| # | 动作 |
|---|---|
| 3.1 | `dsh-bash-sandbox` 锚点容忍 `signal` 第三参 |
| 3.2 | `dsh-client-ui-sidebar-documentpreview`：先判定「ES2025 守卫是否仍需要」；不需要则**删补丁**（净简化） |
| 3.3 | 其余 11 条逐条确认**语义未变**（匹配 ≠ 行为正确） |

**阶段 4：壳层 / 装配层**

| # | 动作 |
|---|---|
| 4.1 | ★ NodeService **去掉 `--expose-internals`**（0.1.7 已移除该参数；先实测不传能否启动） |
| 4.2 | ★ `settings.plugin.item` → `settings.pluginInventory`（我方 3 个预适配插件的设置入口） |
| 4.3 | profile 三件套：`patchReload` 定案复核（`cordis-plugin-hmr` 已被 `dsh-hmr` 取代 ⇒ HMR 可用性要重测） |
| 4.4 | 包改名同步：`dsh-agent-presets` → `dsh-agent-preset(+registry)`、`dsh-code-runtime` → `dsh-ptc-runtime*` |

**阶段 5：构建 / 发版**

| # | 动作 |
|---|---|
| 5.1 | `-DshVersion 0.1.7-alpha.2` + 单源同步 + **lockfile 显式更新并提交**（B1-3 修正） |
| 5.2 | 全门禁（含新增的 `audit-upgrade-readiness.mjs`）+ vitest |
| 5.3 | **模拟器实测（不可省）**：node 起来（0 boot loop）→ **打开老会话**（验 v3→v4 迁移）→ 跑一轮对话 |
| 5.4 | 出双架构 + 发 release |

> **5.3 是唯一能证明「数据没坏」的一步**。W24c 与 v0.2.5 两次事故的共同教训：
> **编译过 + 门禁绿 ≠ 设备上能用**。

关键事实的出处：
- 版本与 dist-tags → `npm view @deepseek-ai/dsh`
- v4 规范 → `node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/README.zh.md`
- 格式代次 → `dsh-session-format-catalog/lib/index.js` 的 `currentVersion`
- 硬校验 → 同文件 `header.version !== SESSION_FORMAT_VERSION`
- 补丁失效 / CLI 面 / slot 名 / 锚点 → `rp-workspace/tmp/probe-017-full.mjs` 实跑输出
- 六段验收 → `rp-workspace/scripts/audit-upgrade-readiness.mjs`

---

## 附录 B：**安卓适配层的完整性审计**（升级会打断哪一层）

> **本附录回答**：升级 DSH 版本时，**我方叠在官方之上的安卓适配层**有哪些面会动。
> 与附录 A 的区别：A 审的是「官方变了什么」，B 审的是「**我方依赖了官方的什么**」。
>
> **方法**：逐个模块读我方源码/脚本，凡「读官方产物、改官方产物、断言官方产物」之处，
> 即为一个**耦合点**。耦合点按**层次**归类，逐层给出「升级风险 + 判据 + 修法」。
>
> **一个总的判断**：我方对官方的耦合**不是几个点，而是六层**。
> 补丁面（12 组）只是其中最显眼的一层；**其余五层此前从未被当成「升级时要过的面」列出来过。**

### B.0 六层耦合总览

| 层 | 我方是什么 | 耦合了什么 | 升级时会不会断 | 现在的判据 |
|---|---|---|---|---|
| **L1 运行时版本层** | `dsh-runtime-src/package.json` 的 pin + `dsh-version.json` 单源 | 顶层 pin、子包 caret 解析 | ✅ **已在分裂**（§2.2） | `audit-dsh-version.mjs` 判据 ②（**只顶层，有盲区**） |
| **L2 产物补丁层** | `apply-platform-patches.py`（12 组）+ `build-dsht.ps1` 同名补丁 | 官方 `lib/*.js` 的**字节形态** | ✅ **必然**（锚点按文本匹配） | `audit-marker-collision-negctl.py` / `audit-py-patch-idem-negctl.py` / `audit-build-path-parity.py` |
| **L3 原生二进制层** | NDK 自编译 node-pty + Termux deb 提取的 14 个 `.so` | 官方对 node-pty 的**调用契约**、bionic 与 libnode 的 ABI | ⚠️ **中**（调 node-pty 的包若换代） | `audit-pty-prebuilt.mjs` / `audit-native-deps.mjs` |
| **L4 Android 壳层** | Kotlin（NodeService / DeviceBridge / ShizukuBridge / MainActivity…） | 官方 CLI 入口路径、启动参数、env、profile 三件套、token 协议、事件类型 | ⚠️ **中**（多为「硬编码假设」） | `audit-nodeservice-deploy.mjs` / `verify-apk-runtime-version.mjs` |
| **L5 部署/插件装配层** | profile 部署集（NodeService 拷贝循环 ≡ patch 集）、插件构建 | Cordis loader 的 entry 解析、`dsh.client` 外部边、slot 声明 | ✅ **高**（包改名即断，见 A.1） | `audit-plugin-build-parity.mjs` / `audit-nodeservice-deploy.mjs` |
| **L6 数据形态层** | 会话读写/修复/回退 + `dsh-version.json` 的 `sessionReplaceOpFields` | `header.version`、`surfaceOp` 字段名、事件信封白名单、`assistant/message.stream` | ✅ **最高**（不可逆） | `audit-dsh-version.mjs` 判据 ③ / `audit-official-contract.mjs` / `session-contract-probe.mjs` |

> **为什么要分六层**：因为**它们的失效方式完全不同**。
> L2 断了会在**构建期**报错（有声）；L4/L5 断了会在**真机启动期** boot loop（有声但代价大）；
> **L6 断了最安静** —— 编译过、门禁绿、APK 装得上、node 也起得来，只是**老会话打不开**。
> 所以判据的强度必须按层递增，而不是一套判据打天下。

---

### B.1 L1 运行时版本层

**我方实现**：
- 单源 `rp-workspace/dsh-version.json`（`dshVersion` + `sessionReplaceOpFields`）
- 安装源 `rp-workspace/dsh-runtime-src/package.json`
- 构建入口 `build-dsht.ps1 -DshVersion <v>`（**整棵树的代次只由这一个实参决定**）

**升级时的具体风险**：

| # | 风险 | 现状 | 修法 |
|---|---|---|---|
| B1-1 | 顶层 pin 与子包解析**不是同一个版本** | ★ 已发生（rc.1 vs rc.3） | 见 §4 阶段 0 |
| B1-2 | `-DshVersion` 与单源不一致 | 有断言（Step 0.7） | 保持 |
| B1-3 | **无 lockfile** ⇒ 同一 pin 两次安装可能不同 | `pnpm install` 无 lock | 升级时**记录本次解析出的全量子包版本快照**（见下） |
| B1-4 | 官方对子包从 caret 改精确 pin（0.1.7 已如此） | 未知 | 升级前先读新版本顶层 `dependencies` 形态 |

**★ B1-3 是最容易被忽略的一条**：我方 pin 的是顶层包，**子包版本靠 pnpm 解析**。
`build-dsht.ps1` 的注释原文写着「pnpm install（**无 lock、子包 caret 解析**）」。

> ⚠️ **2026-09-23 执行阶段实测修正（P-27：文档与实现不符，必须当场改）**：
> 该注释**已过期** —— `dsh-runtime-src/` 下**确实存在 `pnpm-lock.yaml`**。
> 决定性证据：把 pin 从 `0.1.5-rc.1` 改成 `0.1.5-rc.3` 后直接 `pnpm install`，
> 报错并**拒绝安装**：
> ```
> ERR_PNPM_OUTDATED_LOCKFILE  specifiers in the lockfile don't match specifiers in package.json:
> * 1 dependencies are mismatched:
>   - @deepseek-ai/dsh (lockfile: 0.1.5-rc.1, manifest: 0.1.5-rc.3)
> ```
> ⇒ 必须 `--no-frozen-lockfile` 才能升。
> **这实际上是好消息**：有 lock 意味着**树是可复现的**（不是"每次构建静默换树"），
> 风险性质从「不确定」变成「确定，但需显式更新 lock」。
> ⇒ **B1-3 的对策也要随之改**：不是「记录本次解析结果」，而是
> **「升级时必须显式更新并提交 lockfile」**（否则 CI 与本地会装出不同的树）。

**判据（升级时必须先建，现在没有）**：

```
新判据：audit-runtime-tree-snapshot.mjs
  ① 构建完成后，dump `node_modules/@deepseek-ai/*/package.json` 的 (name, version) 全表
  ② 与上一轮构建的 dump 做 diff
  ③ 差异非空 ⇒ 出声（不是报红：官方补发 rc 是合法的，但**必须让「树变了」这件事可见**）
  ④ 正控：手工改一个包版本 ⇒ 必须被点名
  ⑤ 负控：不改 ⇒ 0 差异
```

---

### B.2 L2 产物补丁层

**我方实现**：13 条 `patch()` 调用（12 组，附录 A.4 已逐条实测）。
**为什么必然断**：补丁锚定方式是「**文件路径 + 文本正则 + 期望命中数**」，
官方任何一次**缩进调整、参数增删、变量改名、代码搬包**都会打穿。

**升级时的具体风险（按脆弱度排序）**：

| 脆弱度 | 补丁 | 为什么脆 |
|---|---|---|
| **极高** | `DSHT-ANDROID-SH`（bash-sandbox） | 锚点里带 `], policy);` —— 官方加第三参即失效（**0.1.7 已实证**） |
| **极高** | `DSHT-ANDROID-RENAME-FS` | 锚定 `lstat: (path) => lstat(path),\n\tlink,` —— 缩进/顺序一变即失 |
| **极高** | `DSHT-CHAT-FOLD-*`（3 条） | 锚定 `dsh-client-ui-chat` 的**压缩产物**（变量名都被 minify 过） |
| **高** | `DSHT-ANDROID-ITERATOR` | 锚定 PDF.js 内嵌产物（**0.1.7 已失效**） |
| **高** | `DSHT-ANDROID-TERM-*`（2 条） | 锚定常量定义行，官方改默认值即失 |
| **中** | `DSHT-SIM`（3 条） | 锚定 `process.platform === "win32"` 这种稳定形态 |
| **中** | `DSHT-ANDROID-FLOCK` | 锚定 `const { platform, arch } = process;` |
| **低** | `DSHT-ANDROID-JS-SEARCH` / `UNSANDBOXED` / `PROOT` / `TITLE-DETAG` | 锚定我方自己插入的文本（PROOT 锚定的是 P0-2 的产物） |

**已写好的配套判据（好消息）**：
- `audit-marker-collision-negctl.py`（marker 子串碰撞，防「marker 落在别的补丁里」）
- `audit-py-patch-idem-negctl.py`（幂等性负控）
- `audit-build-path-parity.py`（**两条构建路径的补丁集等价**：ps1 ↔ python）
- `apply-platform-patches.py --check`（预检模式：锚点命中数不符即 `failed`）

> ⚠️ **已知既有问题（2026-09-23 发现，与本次文档改动无关）**：
> `audit-build-path-parity.py --selftest` 当前为 **37/38 FAIL**，失败项是「判据五续」的
> **BOM 负控还原步骤**（还原时写回叠了 BOM ⇒ 仍违约）。而 `GOAL.md` 第 105/248 行
> 仍声明 **38/38** ⇒ `audit-selftest-claims.mjs` 已报「声明过期」2 处。
> **⇒ 升级前应先修这条**（否则「补丁面判据」这条防线本身不可信 —— 正是 P-30 形态）。

> ⚠️ **`--check` 的一个已知语义**：锚点命中 ⇒ 报「**未打补丁**（apply 模式会补上）」
> 且计入 `pending`，**不报红**（源码注释：这是心跳 55 的刻意设计）。
> ⇒ **升级时不能只看 `--check` 的退出码**，必须看 `pending` 与 `failed` 两个数字。

**升级时必须新增的判据**：

```
新判据（并入 apply-platform-patches.py 或独立脚本）：
  ① 每条补丁除「命中数」外，另记「**锚点指纹**」= 命中的那一段原文的 SHA256 前 8 位
  ② 升级后指纹变了但命中数没变 ⇒ 报「**锚点已漂移**」（比「失效」更隐蔽：匹配上了，
     但匹配到的是别的地方，或官方改了这行语义）
  ③ 正控：手工在锚点里插一个空格 ⇒ 指纹必须变、命中数可能仍为 1 ⇒ 必须报「漂移」
  ④ 负控：不动 ⇒ 指纹不变
```
> **为什么需要它**：锚点「匹配上了」≠「改的是同一处」。这是我在 A.4 里用的口径
> （「匹配 ≠ 行为正确」）的机器化形态。现在这条**只有人眼**。

---

### B.3 L3 原生二进制层

**我方实现**（`fetch-native-libs.mjs` 的 TARGETS + `build-node-pty.mjs`）：

| 类别 | 内容 | 与官方的耦合 |
|---|---|---|
| node-pty | NDK 自编译 `prebuilds/android-{arm64,x64}/pty.node` | 官方 `dsh-subprocess-local` **顶层 import node-pty** ⇒ 加载失败即整棵 plugin tree 崩 |
| Termux 工具链 | `libdsht-{bash,rg,zstd,git}.so`（伪装 `.so` 放 jniLibs） | 官方 `terminal-bash` / `fs-search` 的 `DEFAULT_BASH_SHELL` / `runRipgrep` |
| 私有运行库 | `libz.so.1` / `libcrypto.so.3` / `libpcre2-8` 等 11 个（v0.2.6 事故补入） | **libnode.so 的 DT_NEEDED** |
| proot/busybox | `libproot.so` / `libbusybox.so` + symlink 林 rootfs | 我方 `DSHT-ANDROID-PROOT` 补丁的探测目标 |

**升级时的具体风险**：

| # | 风险 | 说明 |
|---|---|---|
| B3-1 | **`node-pty` 版本被官方抬高** | 我方的 `pty.node` 是按**当时**的 node-pty JS 层接口编译的。官方升 node-pty 后，其 `lib/index.js` 可能调用新的 N-API 符号 ⇒ 我方旧 `pty.node` 加载失败或行为错。**这是最隐蔽的一条**：编译期不报错（`.node` 是运行时 dlopen）。 |
| B3-2 | **新增原生包**（0.1.7 的 `libreoffice-kit-win32-x64`） | 需确认 Android 侧是否需要、能否裁掉（`build-dsht.ps1` 的 3a 只删 win32/darwin **目录名含该串**者） |
| B3-3 | **libnode.so 换代** ⇒ DT_NEEDED 变 | 新版本的依赖集可能新增/改名 ⇒ `audit-native-deps.mjs` 会抓（已有），但**必须先有新的 libnode** |
| B3-4 | rg / bash 需求变化 | 若官方把 `runRipgrep` 重写掉，`DSHT-ANDROID-JS-SEARCH` 补丁即失效且**无替代**（我方的纯 JS 搜索会变成死代码） |

**判据（部分已有，需扩面）**：

| 判据 | 现状 | 需补 |
|---|---|---|
| `audit-pty-prebuilt.mjs` | 查 `pty.node` 是否就位 + 静态断言 | ★ 加：**node-pty JS 层接口指纹**（从 `node-pty/lib/index.js` 抽被调用的 native 符号名，与编译时对照） |
| `audit-native-deps.mjs` | DT_NEEDED 闭合性（v0.2.5 事故后新建） | 保持；升级后重跑 |
| `fetch-native-libs.mjs` | 11 个库 + SHA256 | 升级后**重新核对清单**（官方可能引入新库） |

---

### B.4 L4 Android 壳层（Kotlin）

**我方实现**：`rp-workspace/android/app/src/main/java/com/dshtavern/app/` 8 个 Kotlin 文件。

**逐个文件的耦合点**：

| 文件 | 耦合的官方事实 | 升级会怎样 |
|---|---|---|
| [NodeService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/NodeService.kt) | ① 入口 = `node_modules/@deepseek-ai/dsh/lib/bin.js`；② 子命令 `web --no-open --port N`；③ `--expose-internals`（HMR 必需）；④ `--trusted-host`；⑤ stdout 的 `dsh web: http://…?token=` 行；⑥ profile 三件套（`cordis.yml` / `package.json` 的 `dsh.profile.bundles` / `pnpm-workspace.yaml`）；⑦ `patchReload: "startup"`；⑧ `cordis.patch.yml` 的 `- insert:` 语法 | ①③⑤⑦⑧ 都是**硬编码假设**：入口改名/参数取消/就绪信号改文案/profile 机制变更/`insert` 语法变更 ⇒ 启动失败或**静默卡在等待屏** |
| [MainActivity.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt) | 用 token URL loadUrl、等待屏状态、看板 | token 协议变更 ⇒ 页面 404/空白 |
| [DeviceBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/DeviceBridge.kt) | 无官方耦合（纯我方 + Shizuku） | 不受影响 |
| [ShizukuBridge.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuBridge.kt) / [ShizukuExec.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuExec.kt) | 无官方耦合 | 不受影响 |
| [ExchangeDir.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/ExchangeDir.kt) | 无官方耦合 | 不受影响 |
| [LanTileService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/LanTileService.kt) | `--trusted-host` 的**代理端口**约定 | 若官方改信任模型 ⇒ LAN 访问失效 |
| [Gate.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/Gate.kt) | 与 DSH 的审批流 | 审批 API 变更 ⇒ 守门人失效（**可能是静默的**） |

**升级时的具体风险**：

| # | 风险 | 现行判据 |
|---|---|---|
| B4-1 | 启动就绪信号从 `dsh web: ` 改文案 ⇒ **token 永不捕获** ⇒ 页面停在「正在启动」 | 无（只有真机才看得见） |
| B4-2 | `bin.js` 路径或 `web` 子命令变更 | 无（`check()` 会在启动时报错，**有声**） |
| B4-3 | profile 三件套形态变更 ⇒ loader 挂起且 **announce 静默** | `audit-nodeservice-deploy.mjs` 只守**我方**的三件套文本，不守**官方是否仍认这个形态** |
| B4-4 | `--expose-internals` 若官方不再需要/不再接受 | 无 |

**判据（新增）**：

```
新判据：audit-shell-contract.mjs（在 APK 产物层跑，因为只有产物能证明）
  ① 从 APK 的 assets/dsh-runtime.zip 里读 `@deepseek-ai/dsh/lib/bin.js`
     ⇒ 断言存在，且其 CLI 参数表里含 `web` / `--port` / `--no-open` / `--trusted-host`
  ② 从 bin.js（或其引用的模块）里搜就绪信号文案 `dsh web:`
     ⇒ 找不到即 **BLOCK**（因为 NodeService 的 TOKEN_LINE_PREFIX 恒等该串）
  ③ 断言 `--expose-internals` 仍是合法参数（搜 node 参数校验面）
  ④ 正控：把语料里的 `dsh web:` 改一个字 ⇒ 必须 BLOCK
  ⑤ 负控：不改 ⇒ 0 命中
```
> **为什么必须锚在这个串上**：NodeService 的注释自己写着「DSH 自身把 `dsh web:` 那行 stdout
> 定义为**唯一就绪信号**」。**唯一 = 单点**。而它现在**没有任何判据**。

---

### B.5 L5 部署 / 插件装配层

**我方实现**：
- **部署集**：NodeService 的拷贝循环（`dsht-plugin-{mvu,tavern-helper,prompt-template,memory,device}`）+ `copyPackage*`（`dsht-rp-plugin` / `dsht-plugin-mobile` / `dsh-preset-enhance`）
- **patch 集**：`pluginRows`（8 行 `- id / name`）
- **不变式**：「拷贝集 ≡ patch 集」（W-3 boot loop 事故的产物）
- **构建侧**：`build-dsht.ps1` Step 4.72/4.75/4.77 把插件编译进 `runtime node_modules`；`rebuild-plugins.ps1` 是可装形态

**与官方的耦合**：

| 耦合点 | 具体 | 升级会怎样 |
|---|---|---|
| `package.json` 的 `dsh.client.external` | 列了 4 个官方包名（`dsh-client-ui-sidebar` / `-layout` / `-conversation` / `-settings-plugins`） | **官方包改名/拆分即断**（0.1.7 已实测有改名：`dsh-agent-presets` → `-preset`+`-registry`） |
| `dsh.client.platform: "web"` | boot graph 声明 | 形态变更即断 |
| slot 名（17 处 `ctx.slots.inject`） | `sidebar.footer.action` / `shell.overlay` / `conversation.chat.node` / `conversation.chat.assistant-actions` / `conversation.session.header.actions` / `conversation.input.dock` / `settings.plugin.item` | ★ **官方 slots 改名/迁移即整块功能消失**（不报错，只是插件注册到不存在的槽位） |
| Cordis loader 的 `insert` 语法 | `- insert:` + `- id/name` | 语法变更即 profile 加载失败 |
| ROOT 装配 | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 两个 bundle | 0.1.7 对 `dsh-base`/`dsh-app-boot` 改**精确 pin**，说明这两包在动 |
| ★ **`@adapt contract:` 标记** | 我方源码里大量 `// @adapt contract:slots.register` 形式的**契约标记** | 这是**为升级准备的最有价值的资产**——它标出了每一处「我依赖了这个官方契约」 |

**★ 一个此前没有被机器化的资产**：`@adapt contract:` 标记。
用 `Grep` 统计（本机实测）：

```
packages/src/**  含 "@adapt contract:" 的源文件：分散在 dsht-rp-ui / dsh-plugin / dsht-plugin-shared
packages/contracts/adaptations.json  ← 契约快照产物
packages/scripts/extract-adaptations.mjs ← 提取器
packages/scripts/diff-contracts.mjs      ← 事后比对器
```

⇒ **升级时应该先跑 `diff-contracts.mjs`**，把 `adaptations.json` 里的每个契约名
逐一在新版本 runtime 上验证。**这是全仓最对症的升级工具，但它现在是「手工 CLI、无自动触发点」。**

**判据（升级时必须接线）**：

```
① 把 diff-contracts.mjs 接进升级流程（新版本 runtime 上跑一次，输出「哪些 @adapt 契约已失效」）
② 新增 slot 名对账：拿我方 17 处 inject 的 slot 名，逐个在官方 dsh-client-ui-*/types 里找声明
   （capture-contracts.mjs 的「面 3：slots」已经在采集 SlotMap 键名 ⇒ 真值来源已有）
③ audit-plugin-build-parity.mjs / audit-nodeservice-deploy.mjs 保持（它们守「我方两侧一致」，
   不守「我方 vs 官方一致」—— 那是 ①②的职责）
```

---

### B.6 L6 数据形态层

**这一层在附录 C 详述**（因为 RP 语义全部压在这层上）。此处只列**安卓侧特有的数据面**：

| 项 | 我方依赖 | 升级会怎样 |
|---|---|---|
| `session.v<N>.jsonl` 文件名代次 | `pickCurrentSessionFilename` 按正则 `/^session\.v(\d+)\.jsonl$/` **取最大 N** | ★ **v4 到来时会自动挑中 v4 文件** —— 若我方解析器不认 v4 的 `role:'tool'`，就会「文件选对了但内容读不懂」 |
| `header.version` | `repairSessionForV3` 按 `srcVersion >= 3` 决定 `surfaceOp` 字段名 | v4 ⇒ `srcVersion=4 >= 3` ⇒ **仍写 startSeq/endSeq**（恰好正确，但**是巧合**，判据应显式化） |
| `assertStoredIdentity`（目录名 == projectKey(cwd)） | 我方 `repairSessionCwds` + 落盘前守卫 | 官方若改 `projectKey` 算法 ⇒ **全部会话目录名失配** ⇒ 整个 plugin tree 加载失败（crash-loop） |
| 目录结构 `sessions/<project>/<sessionId>/` | `scanSessionHeaders` 两层 readdir | 官方若改层级 ⇒ 我方扫不到会话 |
| `.agent-presets/` 的 `agent-preset-not-found` | 我方 `migrateCardAgentPresets` 的「有会话引用的保留」 | 0.1.7 已改名 `dsh-agent-preset` ⇒ **preset id 的解析规则可能变** |

**判据（新增）**：

```
新判据：audit-session-shape-matrix.mjs
  ① 从官方 dsh-session-format-catalog 读出**全部**已注册代次（不只 currentVersion）
  ② 断言我方解析器的覆盖集 == 官方注册集（现在我方只认 v3 的 surfaceOp 形态）
  ③ 断言 projectKey 函数的实现与我方一致（拿一组已知 cwd 做对照）
  ④ 正控：官方加一个代次 ⇒ 必须报「覆盖不全」
```

---

## 附录 C：**RP 世界的完整性审计**

> **本附录回答**：DSH 是后端，**RP 才是产品**。升级 DSH 时，RP 这一侧有哪些面会动。
>
> **方法**：把 RP 实现按「数据流」切开 —— 从宿主页（浏览器）→ 投影 → 会话读写 → 落盘 → 导入。
> 逐面读源码，列出**依赖的官方形状**与**失效后果**。
>
> **一个总的判断**：RP 层对官方的依赖**比安卓层更深**，因为它读的不只是「API 形状」，
> 还有**语义**（比如「assistant-step 是什么」「source.kind === 'user' 才算真人输入」）。
> **形状变了会报错，语义变了不会。**

### C.0 十个面总览

| # | 面 | 我方实现位置 | 依赖的官方事实 |
|---|---|---|---|
| C1 | **插件装配与槽位** | `dsht-rp-ui/src/client/index.tsx`（17 处 inject） | slot 名、`slots.inject/register` 语义、apply 顺序 |
| C2 | **宿主 DOM 锚点** | `dsht-plugin-mobile/client/anchors.ts` | ★ **哈希类名**（`pI_x6G_*` / `VOzbGW_*` / `hHd-Xa_*` / `wSkVaW_*`）+ `[data-shell-overlay]` |
| C3 | **会话投影读取** | `dsht-plugin-shared/host-projection.ts`（48 处裸读收口） | `SessionSnapshot` / `ChatSnapshot` 形状、节点 `kind` 枚举（`assistant-step` / `user` / `compaction` / `tool`…）、`data.source.kind==='user'` |
| C4 | **会话读写与修复** | `session-write.ts` / `session-repair.ts` / `session-surgery.ts` | `header.version`、`surfaceOp` 三键、事件信封白名单、`assistant/message.stream`、turn/step 状态机不变量 |
| C5 | **回退与重生成** | `dsht-plugin-undo` / `session-rollback` / `session-regenerate` | `replace` 语义、`shadowedSeqs/Range`、surface 折叠 |
| C6 | **RP 数据落盘** | `dsh-plugin/index.ts`（rp.json / lore / state / th-floors） | `$DSH_HOME` 布局、`sessions/<projectKey>/<id>/`、`projectKey` 算法、`.agent-presets` |
| C7 | **导入与适配链路** | `dsh-plugin/assets/skills/st-migration/` + `rp-import/` | 文件工具/`dsht_bridge` 工具面、skill 加载、agent preset、**工作区 cwd 语义** |
| C8 | **ST 兼容层（TH 脚本宿主）** | `th-shim.ts` / `host-vendor.ts` / `host-st-surface.ts` | iframe 沙箱、`<script type="module">` 严格模式、CSP、`/version` 端点 |
| C9 | **宏 / 正则 / 输出协议** | `macros/` / `regex/` / `display-compiler.ts` / `output-protocol.ts` | 消息块 `type`/`kind` 枚举、`assistant/message` 的 content 形状 |
| C10 | **RP 的 LLM 侧** | `prompt-bridge.ts` / `llm-pi-ai` 配置导入 | `settings.update` / `credentials.set` API、请求编译链 |

---

### C.1 插件装配与槽位（C1）

**我方事实（本机实测）**：17 处 `ctx.slots.inject('<slot>', …)`，分布在 7 个不同 slot 名上。

**升级风险**：

| 风险 | 后果 | 为什么难发现 |
|---|---|---|
| slot 名被官方改名/迁移 | **整块 RP 功能消失**（不是报错） | `slots.inject` 的语义就是「**等声明出现再注册**」⇒ 声明永不出现 ⇒ 回调永不执行 ⇒ **静默** |
| `slots.inject` 语义变更 | boot 顺序错乱 | 我方注释多次写「不假设 apply 顺序」——那是**防御**，不是**判据** |
| 官方新增 slot 约束（严格声明检查） | 整页 `Failed to load plugins` | 0.1.2 已发生过（pitfall #15），我方靠 `dsh.client.external` 的 4 条 external 边解决 |

**判据（已有真值来源，缺接线）**：
`capture-contracts.mjs` 的「面 3：slots」已经在采集**官方各 `dsh-client-ui-*` 的 SlotMap 键名**。
⇒ 只需写一条判据：**我方 17 处 inject 的 slot 名 ⊆ 官方 SlotMap 键名集**。现在**没有这条**。

---

### C.2 宿主 DOM 锚点（C2）—— ★ **最脆的一面**

**我方事实**：`anchors.ts` 的 `ANCHOR_DEFS` 表，共 **22 个锚点**（本机实读），其中 **21 个锚定官方哈希类名**：

| 前缀 | 出现的官方包 | 锚点数 |
|---|---|---|
| `.pI_x6G_*` | `dsh-client-ui-layout` | 5（frame / sidebarCol / centerCol / detailsCol / handle） |
| `.VOzbGW_*` | `dsh-client-ui-settings-general` | 9 |
| `.hHd-Xa_*` | `dsh-client-ui-sidebar` | 2 |
| `.wSkVaW_*` | `dsh-client-ui-conversation`（会话头） | 6 |
| `[data-shell-overlay]` | 宿主自带钩子（**结构性，非类名**） | 1（app-frame 走它） |

> 上表合计 5+9+2+6 = **22**（`app-frame` 同时占「走 `[data-shell-overlay]`」与「候选选择器 `.pI_x6G_frame`」两栏）。

**升级风险（这是最脆的一面，理由要说清）**：

> 哈希类名是**CSS Modules / 构建工具生成的**，**每次官方前端构建都会重算**。
> 也就是说：**官方任何一次前端改动，都可能让这 21 个锚点全部失效** ——
> 而不需要官方「有意改 API」。

**失效后果（分级，因为不同锚点后果不同）**：

| 失效的锚点 | 后果 | 严重度 |
|---|---|---|
| `app-frame`（走 `[data-shell-overlay]`） | 整个锚点解析链断（其余锚点的 `first-child-of-frame` 策略依赖它） | **高** |
| `settings-*`（9 个） | 设置面板移动端样式失效（仍是可用但不适配） | 中 |
| `chat-header*`（6 个） | 会话头在窄屏重叠（**真机截图实证过的老缺陷会回归**） | 中 |
| `sidebar-rail` / `rail-icon-button` | 侧栏 rail 图标按钮不适配 | 低 |

**我方的既有应对（应该说清它的强度）**：
`anchors.ts` 的注释写着「宿主升级若改哈希，**只需更新本表的候选选择器**」。
⇒ 这是一种**设计上的可维护性**，但 **不是判据**：类名失效后 `tag()` 静默返回 0
（`tag(null, …)` 直接 return），**没有任何出声**。

**判据（新增，且是升级必跑）**：

```
新判据：audit-host-anchors.mjs
  ① 真值来源：从官方 `dsh-client-ui-{layout,sidebar,conversation,settings-general}` 的
     lib/client.js 里抽**实际存在的**哈希类名前缀（正则抽 CSS 类名前缀模式）
  ② 断言 ANCHOR_DEFS 里每个 `selectors` 至少有一条能命中真实前缀
  ③ 命中 0 条的锚点 ⇒ **报红点名**（因为它的失效是静默的）
  ④ 正控：把语料里的前缀改一个字符 ⇒ 必须点名该锚点
  ⑤ 负控：不改 ⇒ 0 命中
  ⑥ 零控：拿不到官方产物 ⇒ 报 UNKNOWN，不得判 PASS
```
> **为什么这条最重要**：它是**唯一一条「官方改了前端就必须重新对账」的判据**。
> 现在这条对账**完全没有机器化**，而它覆盖 20 个锚点。

---

### C.3 会话投影读取（C3）

**我方事实**：`host-projection.ts` 的头注记录了 W4 的穷举结论 ——
此前 **48 处**（客户端 22 + 宿主侧 26）裸读，造成三类真实缺陷。
收口后所有读取走单源读取器，并有 `projection-shape-defense.spec.ts` 结构护栏。

**依赖的官方形状（逐条）**：

| 读取器 | 依赖的官方形状 | 官方改了什么会怎样 |
|---|---|---|
| `readHeader` / `readSessionCwd` | `session.header.X` 或 `session.X`（**两版都出现过**） | 已做过双形态兼容 |
| `readChat` / `readSurfaceNodes` | `chat.nodes` 必须是**带 `values()` 的 Map 形态** | 改成普通对象 ⇒ 返回空 ⇒ **楼层号全缺席（真机实证过）** |
| `readNodeKind` | 节点 `kind` 字符串：`assistant-step` / `user` / `compaction` / `manual-compaction` / `tool` / `retry` / `turn-tail` | ★ **v4 新增 `developer/message` 事件**（附录 A.5）⇒ 若它产生新 kind，我方楼层判定不认识它 |
| `readSourceKind` | `data.source.kind === 'user'` 才算真人输入 | 官方若改 source 模型 ⇒ **楼层号算错**（静默） |
| `readBlocks` | assistant 节点用 `data.blocks`，user 节点用 `data.content`；块用 `type` 区分 | 块 `type` 枚举变化 ⇒ 渲染丢块 |

**★ C3 的最大风险点**：`readNodeKind` 的 **kind 枚举是封闭假设**。
我方在 `RpNativeChat.tsx` 里写死了 `'assistant-step'` 和 `'user'` 两种，
其余一律「不占楼层号」。⇒ **官方新增 kind（如 v4 的 `developer`）会被静默当成「不占号」**，
表现为「消息在但楼层不对」——**不报错**。

**判据（新增）**：

```
新判据：audit-projection-kind-coverage.mjs
  ① 真值来源：从官方 dsh-session 的 surface 投影实现里抽**全部节点 kind** 枚举
  ② 断言我方显式处理的 kind 集 == 官方枚举（或对未处理的每个 kind **显式声明「有意不占号」**）
  ③ 正控：往语料里加一个新 kind ⇒ 必须报「未覆盖且未声明」
  ④ 负控：不改 ⇒ 0 命中
```

---

### C.4 会话读写与修复（C4）—— ★ **数据安全面**

**我方事实**（本机实读）：

| 模块 | 关键判据 | 依赖的官方事实 |
|---|---|---|
| `session-repair.ts` | `srcVersion >= 3` ⇒ 写 `{op,startSeq,endSeq}`；否则 `{op,start,end}` | `header.version` 的语义 |
| `session-repair.ts` | `ENVELOPE_KEYS = {type, seq, time, data, surfaceOp, sourceEventSeqs, ignorable}` | **事件信封白名单** —— 官方加字段即被我方**剔除**（丢数据） |
| `session-repair.ts` | `STEP_SCOPED = {assistant/message, assistant/attempt, system/message, assistant/chunk, tool/call, tool/result}` | 官方不变量 `requireOpenStep` 面 |
| `session-repair.ts` | `TURN_SCOPED = {request/header, request/context}` | 同上 |
| `session-write.ts` | `assistantSettlement()` 单源产出（含 `stream: []`） | `assistant/message` 的 settlement 校验 |
| `session-surgery.ts` | `pickCurrentSessionFilename` 取**最大 N** | `session.v<N>.jsonl` 命名 |

**★ 三个最危险的点**：

1. **`ENVELOPE_KEYS` 是硬编码白名单** ⇒ 官方在事件信封上加新键（例如 v4 的
   `plugin:message:<原字段名>` 这类**动态键**）时，我方修复器会**把它们当非法键剔除** ⇒
   **修复一次 = 丢一次数据**。这与 `session-repair.ts` 头注记录的那次事故**同族**
   （「修复器被无代次判断地施加 → 修一次坏一次，会自己扩散」）。

2. **`srcVersion >= 3` 的巧合正确性**：v4 的 `srcVersion` 是 4，`>= 3` 成立，
   恰好仍写 `startSeq/endSeq`（因为 A.2 实测 v4 的 `isReplaceOp` 三键形态**未变**）。
   ⇒ 但这是**巧合**：判据锚在「≥ 某个数」上，而不是锚在「该代次的实际字段名」上。

3. **`tool/result` 在 `STEP_SCOPED` 里**：v4 把 `tool/result` 的表示重写（`role:'user'`→`role:'tool'`）
   ⇒ 我方的状态机归一逻辑**可能把它算错**（`session-repair.ts:464` 有对 `tool/result` 的
   特例处理：`!(ev.type === 'tool/result' && ev.surfaceOp !== undefined && ev.surfaceOp !== 'append')`）。

**判据（升级必须新增）**：

```
① 信封白名单**改为从官方抽**（而非硬编码）：从 dsh-session 的 encode 实现里抽白名单键集，
   与 ENVELOPE_KEYS 对账 ⇒ 官方加了键，我方立刻知道要同步（否则丢数据）
② surfaceOp 字段名判据**从「≥3」改为「按代次查表」**：
   单源里维护 {0:[start,end], 1:[start,end], 2:[start,end], 3:[startSeq,endSeq], 4:[startSeq,endSeq]}
   正控：往表里加一代 ⇒ 我方修复器未处理该代 ⇒ 报红
③ 新增「**修复幂等性**」判据：对同一份语料连跑两次修复 ⇒ 第二次必须 0 变更
   （这正是当年那个「修一次坏一次」事故的形态；现在只有 `audit-session-integrity.mjs` 的
    静态面，没有幂等负控）
```

---

### C.5 回退与重生成（C5）

**我方事实**：回退走「逻辑回退掩码」（集合语义：被 `replace` 移出上下文的 seq 逐条精确隐藏），
**数据零丢失**。相关实现：`dsht-plugin-undo` + `session-surgery.ts` 的 `canSurgicallyTruncate`
+ `RpNativeChat.tsx` 的 `isSeqHidden(mask, seq)`。

**依赖的官方事实**：
- `replace` 的 `surfaceOp` 语义（区间替换）
- `shadowedSeqs` / `shadowedRange`（compaction/prune 的影子价格）
- `surface` 折叠（官方 `foldSurface` 同构实现）

**升级风险**：

| 风险 | 后果 |
|---|---|
| `replace` 语义微调（如区间端点含/不含） | ★ **回退范围错一格** —— 静默，用户看到的是「回退多/少了一条」 |
| `shadowedSeqs` 契约变化 | 我方 `audit-p48-rollback.mjs` + `rollback-mask-semantics.spec.ts` 会抓（已有） |
| surface 折叠实现变更 | 我方 `session-repair.ts:696` 的「与官方 foldSurface 同构」注释**需要重新验证同构性** |

**判据**：已有 `audit-p48-rollback.mjs` / `audit-p48-negctl.mjs` / `rollback-mask-semantics.spec.ts`。
**需补**：升级后**用真实批次数据**跑一次「回退 → 关闭 → 重开 → 楼层正确」的端到端
（现在只有单测与模拟器面）。

---

### C.6 RP 数据落盘（C6）

**我方事实**（`st-migration/references/dsh-layout.md` 是**契约单源**）：

```
skills/wb-<slug>/            SKILL.md + references/lore.json
rp/rp-<slug>/                rp.json + card.json + avatar.png + README.md
rp/state/<sessionId>.json    MVU 变量树
rp/state/<sessionId>.undo.jsonl
rp/state/global.json
rp/global-books.json
rp/regex/global.json
rp-presets/<presetId>/       preset.json + regex.json
rp-import/_adapter/          固定适配工作区
rp-import/<batchId>/         批次数据目录
sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v<N>.jsonl
.agent-presets/              历史遗留（迁移目标）
```

**升级风险**：

| 风险 | 后果 | 严重度 |
|---|---|---|
| ★ **`projectKey` 算法变更** | 全部会话目录名失配 ⇒ `assertStoredIdentity` 抛 ⇒ **整个 plugin tree 加载失败 + node crash-loop** | **最高**（真机实证过同类事故） |
| `$DSH_HOME` 布局变更 | 我方所有 rp/* 路径找不到 | 高（有声） |
| `.agent-presets` 目录被官方接手管理 | ★ 0.1.7 已改名 `dsh-agent-preset`(+registry) ⇒ **preset 解析规则可能变** ⇒ 我方 `migrateCardAgentPresets` 的「有会话引用的保留」策略可能失效 | 高 |
| `skills/` 的发现规则变更 | 世界书 skill 不被加载 ⇒ **世界书静默失效** | 高（静默） |

**判据（新增）**：

```
① projectKey 对账（**升级必跑**）：拿一组已知 cwd（含中文/空格/相对形态），
   同时跑官方 projectKey 与我方实现 ⇒ 必须逐字相同
   正控：改一个字符 ⇒ 必须报不一致
② skills 发现规则对账：把一个测试 skill 放进 $DSH_HOME/skills，断言官方 loader 认得它
③ agent preset 解析对账：建一个含 agentPreset 的会话 header，断言冷恢复能挂上
```

---

### C.7 导入与适配链路（C7）

**这条链路是产品的**第一入口**（用户说的「导入以后进入导入会话让 harness 根据适配 skill 来适配」
——正是 README W-11 补的那一段）。

**链路分解**：

```
用户上传 zip/png/json
   ↓ （web 侧 import 面）
rp-import/<batchId>/ 落地（source.zip / unpacked/ / meta.json）
   ↓ （kickoff）
在 rp-import/_adapter 工作区开一个会话（cwd = _adapter）
   ↓ （会话内）
harness 加载 skills/st-migration（**通过 skill 机制**）
   ↓
按 SKILL.md 的类目逐类处理 → 写 rp/ · skills/ · rp-presets/ · sessions/
   ↓
产出 migration-report.md
```

**依赖的官方事实（每一环）**：

| 环 | 依赖 | 升级风险 |
|---|---|---|
| skill 加载 | `$DSH_HOME/skills/<name>/SKILL.md` 的 frontmatter（`name`/`description`/`whenToUse`） | ★ frontmatter 字段改名 ⇒ **skill 不被识别** ⇒ 整个适配流程失去指导（**静默**：agent 会「自由发挥」，产出不合契约） |
| 工作区会话 | `cwd` 必须是**绝对 + realpath 规范**；目录名 == `projectKey(cwd)` | 已在 `dsh-plugin/index.ts:3292` 踩过并修 |
| 文件工具 | 官方文件工具的**工作区边界**语义 | 边界变更 ⇒ `write-files` 被拒 |
| `dsht_bridge` 工具 | 我方工具在官方工具表里的注册形态 | 工具注册 API 变更 ⇒ 工具不出现 |
| agent preset（`dsht-adapter`） | `.agent-presets/` 或新 `dsh-agent-preset` 的装载规则 | ★ 同 C6 |
| 会话内 `use_skill` / 技能目录 | 官方 skill 调用语义 | 变更 ⇒ agent 不知道要加载 skill |

**★ C7 最危险的点**：整条链的**正确性依赖 skill 文本被 agent 读到**。
skill 加载失败时**不会报错** —— agent 会照常回答，只是**产出不合契约**，
而 `migration-report.md` 可能照样生成 ⇒ **用户以为迁移成功了**。

**判据（新增）**：

```
新判据：audit-skill-delivery.mjs
  ① 断言 st-migration skill 落在 $DSH_HOME/skills/st-migration/ 且 SKILL.md frontmatter 合法
  ② 断言 frontmatter 的字段名 ∈ 官方 loader 认的字段集（真值来源：官方 skill 加载实现）
  ③ 断言 references/ 下 6 个引文件都在（dsh-layout / dsh-rpc / session-jsonl-contract /
     slug-rules / st-format / st-plugins-assessment / th-buttons）
  ④ 正控：删一个 references 文件 ⇒ 必须点名
  ⑤ 端到端（真机）：跑一次真实导入 ⇒ 断言 migration-report.md 里出现**契约要求的章节**
     （现在只有人工看）
```

---

### C.8 ST 兼容层（TH 脚本宿主）（C8）

**我方事实**：`th-shim.ts`（约 3000 行级）、`host-vendor.ts`（`_`/`$`/`jQuery`/`z`/`Zod`/`YAML` 六个全局）、
`host-st-surface.ts`、`st-event-types.gen.ts`、`th-host-events.ts`。

**依赖的官方事实**：

| 依赖 | 具体 | 升级风险 |
|---|---|---|
| `<script type="module">` 注入 | 我方 `th-shim.ts:3101/3104` 用 module 脚本注入卡脚本 ⇒ **严格模式** | `audit-script-semantics-parity.mjs` 已守（真机严格模式 vs 单测经典语义的差异） |
| iframe 沙箱与 CSP | `th-shim.ts:3172` 的 CSP 头（`script-src 'unsafe-inline' 'unsafe-eval'`） | 官方若收紧 iframe 策略 ⇒ 卡脚本跑不起来 |
| `data-shell-overlay` 之外的宿主钩子 | `host-st-surface.ts` 依赖 ST 模板的 `data-result="0"` 等 | ST 侧变更（与我方 DSH 升级无关） |
| **104 个 ST 事件类型**（`ST_EVENT_TYPES`，本机实测） | `st-event-types.gen.ts`（生成物，来源 `public/scripts/events.js`） | 官方（ST）加事件 ⇒ 需重新生成 |
| `GET /version` 端点 | `dsh-plugin/index.ts:7911` 起的兼容版本声明（`SILLYTAVERN_COMPAT_VERSION = '1.18.0'`） | 官方若改 `/version` 语义 ⇒ 卡的 `versionNumber` 分叉走错分支（**心跳 57 实证过：20+ 处走旧分支**） |
| `globalThis` 全局 | 我方 `HOST_ST_GLOBALS = ['SillyTavern']` | 官方若也定义 `SillyTavern` ⇒ 冲突 |

**判据**：已有 `audit-shim-template-literal.mjs`（模板字面量）、`audit-th-face-coverage.mjs`（TH 真面覆盖）、
`audit-script-semantics-parity.mjs`、`th-event-source.spec.ts`、`th-host-events.spec.ts`。
**需补**：升级后**重新生成 `st-event-types.gen.ts`** 并跑 `audit-th-face-coverage.mjs`（需 `$env:TH_ROOT`）。

---

### C.9 宏 / 正则 / 输出协议（C9）

**我方事实**：
- `macros/engine.ts`（ST 宏集）、`dsht-plugin-shared/macros.ts`
- `regex/engine.ts` + `safe-regex.ts`（正则引擎，防 ReDoS）
- `display-compiler.ts`（显示渲染主路径）+ `output-protocol.ts`（`<status>` / `<UpdateVariable>` 等协议标签）
- `host-st-surface.ts` 的 ST 正则键（`extension_settings.regex`）

**依赖的官方事实**：

| 依赖 | 升级风险 |
|---|---|
| `assistant/message` 的 content 块形状（`type`/`kind`/`text`） | ★ v4 改的是 `tool/result` 的**消息表示**；若 content 块形状也动，`display-compiler` 要跟着改 |
| `data.blocks`（assistant）vs `data.content`（user） | 见 C3 |
| 消息块的图块类型（`image`） | v4 新增 `image/offload` 事件（A.5）⇒ **图片可能不再内联** ⇒ 我方 `readBlocks` 的 image 分支要适配 |

**★ C9 与 v4 的具体关联**：v4 新增了 `image/offload` 事件类型。
我方的图片块读取（`RpNativeChat.tsx:1515` 的 `{ kind: 'image'; images: unknown[] }`）
现在假设图片**内联在消息里**。若 v4 把图片改为 offload 引用 ⇒ **图片不再显示**（静默）。

**判据（新增）**：`audit-message-block-coverage.mjs`（同 C3 的思路：块类型枚举对账 + 未覆盖必须显式声明）。

---

### C.10 RP 的 LLM 侧（C10）

**我方事实**：`prompt-bridge.ts`（pre-step 注入管线）、`/dsht-rp/rp/import-api-config`
（`settings.update('llm-pi-ai', …)` + `credentials.set(ref, value)`）。

**升级风险**：

| 风险 | 后果 |
|---|---|
| `settings` / `credentials` 服务 API 变更 | API 配置导入失效（有声：路由返回错误） |
| **pre-step 注入管线**的 hook 点变更 | ★ **整个 RP 提示词编译链失效** ⇒ 角色卡/世界书/预设全部不进上下文（**静默**：LLM 照常回答，只是没有设定） |
| LLM provider 配置 schema 变更 | 导入的 API 配置不生效 |

**★ C10 最危险的点**：pre-step 管线是**注入式**的。
钩子点改名/语义变更时，最可能的表现是「**插件加载成功、工具可用、但注入没发生**」——
因为拦截器注册到不存在的钩子上**不会抛错**。

**判据（新增）**：

```
新判据：audit-injection-pipeline.mjs
  ① 真值来源：从官方抽 pre-step / hook 点清单
  ② 断言我方注册的钩子点 ∈ 官方清单
  ③ 端到端（模拟器）：跑一轮对话，断言 **LLM 实际收到的请求体**里含
     角色设定 + 命中世界书条目 + 预设槽位文本（现在只有 `golden-mock-llm.mjs` 面，可复用）
```

---

### C.11 RP 面的证据强度自评（诚实边界 R7）

| 面 | 现在的判据覆盖 | 证据强度 |
|---|---|---|
| C1 槽位 | 有真值来源（capture-contracts 面 3），**未对账** | 弱 |
| C2 锚点 | **无判据**，只有设计上的可维护性 | **最弱（22 个锚点裸奔，无一声出）** |
| C3 投影 | 有结构护栏（projection-shape-defense），**无 kind 枚举对账** | 中 |
| C4 会话读写 | 判据最多（契约探针 + 单测 + 幂等负控） | 强（但白名单硬编码是隐患） |
| C5 回退 | 单测 + 负控齐 | 中（缺真实数据端到端） |
| C6 落盘 | 有事故教训与守卫，**无 projectKey 对账** | 中 |
| C7 导入链路 | 有 `audit-rp-parser-negctl` 等，**无 skill 投递判据** | 中 |
| C8 ST 兼容 | 判据最密（4 个审计 + 2 组单测） | 强 |
| C9 宏/正则/协议 | 有单测，**无块类型枚举对账** | 中 |
| C10 LLM 注入 | 有 golden-mock，**无钩子点对账** | 中 |

⇒ **升级前必须补齐的优先级**：**C2 > C1 > C6 > C10 > C3/C9**。

---

## 附录 D：**升级到底要考虑什么**（一条完整判据，带正负控）

> **本附录回答**：把 B/C 两附录列出的风险，收敛成**一条可执行、可证伪、可自证**的升级判据。
> 判据形态遵循本仓既有纪律（`MOBILE-TEST-METHODOLOGY.md` §5.4 的 P 判据全集）：
> **每条判据必须自带正控 / 负控 / 零控，否则它是「声明」不是「判据」（P-30）。**

### D.0 一条判据（把上面的面全覆盖）

**升级验收的唯一入口**：

```
node rp-workspace/scripts/audit-upgrade-readiness.mjs --target <新版本> --from <当前版本>
```

**它的六段（对应 B 的六层）**：

| 段 | 检查什么 | 数据来源 | 通过条件 |
|---|---|---|---|
| **① 版本面** | 顶层 pin / 子包解析 / 树快照 diff | `node_modules/@deepseek-ai/*/package.json` | 树快照无**未声明**差异 |
| **② 补丁面** | 13 条补丁的命中数 **+ 锚点指纹** | `apply-platform-patches.py --check` 扩展 | 无 `failed`、无 `pending`、指纹无漂移 |
| **③ 原生面** | `pty.node` 就位 + node-pty 接口指纹 + DT_NEEDED 闭合 | `audit-pty-prebuilt.mjs` / `audit-native-deps.mjs` | 全绿 |
| **④ 壳面** | `bin.js` 入口 + `dsh web:` 就绪信号 + CLI 参数 + profile 三件套 | APK 产物（`verify-apk-runtime-version.mjs` 扩展） | 全部命中 |
| **⑤ 装配面** | slot 名对账（17 处）+ `dsh.client.external` 4 个包名仍存在 + `@adapt` 契约 diff | `capture-contracts.mjs` 面 3 + `diff-contracts.mjs` | 无未声明失效 |
| **⑥ 数据面** | `sessionReplaceOpFields` + `SESSION_FORMAT_VERSION` + 事件信封白名单 + `projectKey` 对账 + kind 枚举 | `audit-dsh-version.mjs` 扩展 + 新判据 | 全部一致 |

**退出码**：
```
0  六段全过（可以进入阶段 3 正式升级）
1  有 BLOCK（禁止升级）
2  有 UNKNOWN（**禁止升级**：P-17——「测不出」不等于「没问题」）
3  判据自身 selftest 失败
```

---

### D.1 每条判据的正负控设计（**这是「判据」与「声明」的分界**）

| 判据 | 正控（必须报红） | 负控（必须 0 命中） | 零控（必须 UNKNOWN） |
|---|---|---|---|
| 树快照 diff | 手工把一个子包版本 `+0.0.1` | 不动 ⇒ 0 差异 | runtime 未就绪 ⇒ UNKNOWN |
| 补丁锚点指纹 | 锚点里插一个空格 | 不动 ⇒ 指纹不变 | 目标文件不存在 ⇒ UNKNOWN |
| node-pty 接口指纹 | 改 `lib/index.js` 里一个被调 native 符号名 | 不动 ⇒ 一致 | `pty.node` 缺失 ⇒ 报缺失（不是 UNKNOWN） |
| 就绪信号 `dsh web:` | 把语料里该串改一字 | 不改 ⇒ 命中 | 取不到 `bin.js` ⇒ UNKNOWN |
| slot 名对账 | 把一个 inject 名改成 `sidebar.footer.actionX` | 不改 ⇒ ⊆ 成立 | 官方 SlotMap 抽不到 ⇒ UNKNOWN |
| 契约 diff（`@adapt`） | 删掉一个契约的可选面 | 不动 ⇒ 无差异 | `adaptations.json` 不存在 ⇒ UNKNOWN |
| 事件信封白名单 | 往官方白名单加一个键 | 不动 ⇒ 相等 | 抽不到白名单 ⇒ UNKNOWN |
| `projectKey` 对账 | 我方实现改一字符 | 不动 ⇒ 逐字相同 | 官方实现抽不到 ⇒ UNKNOWN |
| kind 枚举对账 | 往语料加 `developer` kind | 不动 ⇒ 相等 | 抽不到枚举 ⇒ UNKNOWN |

> **为什么零控必须是 UNKNOWN 而不是 PASS**：
> 这是本仓的血泪纪律（P-17）。`audit-official-contract.mjs` 的零控注释原文：
> 「读不到 ⇒ 全 UNKNOWN（unknown=N/N）**且不判 OK**」——
> 因为「探针没找到坏形态」与「世界是好的」在报告上**同貌**。

---

### D.2 三面总账（升级前必须逐项打勾）

**① 依赖面**（我方向官方借了什么）

| 借的东西 | 借的地方数 | 升级后状态 |
|---|---|---|
| slot 名 | 7 个（17 处 inject） | ☐ |
| 官方包名（`dsh.client.external`） | 4 个 | ☐ |
| 官方节点 kind | 7 个（`assistant-step`/`user`/`compaction`/…） | ☐ |
| 官方事件类型 | 104（ST 侧 `ST_EVENT_TYPES`）+ N（DSH 会话事件侧，跑 `audit-official-contract.mjs` 面） | ☐ |
| 官方类名锚点 | 22 个（`ANCHOR_DEFS` 实读） | ☐ |
| 官方 CLI 面（入口/子命令/参数/就绪信号） | 5 个 | ☐ |
| 官方 `@adapt` 契约标记 | `adaptations.json` 全表 | ☐ |

**② 补丁面**（我改了官方哪些字节）

| 项 | 数量 | 升级后状态 |
|---|---|---|
| `patch()` 调用 | 13 条（12 组） | ☐ |
| 唯一 marker | 18 个 | ☐ |
| 补丁目标文件 | 11 个 | ☐ |
| stub 落盘 | 7 件（`STUB_MAP`） | ☐ |
| 事件字符串命中 | 79 处 / 11 文件 | ☐ |

**③ 数据面**（用户数据落在什么形状上）

| 项 | 值 | 升级后状态 |
|---|---|---|
| `sessionReplaceOpFields` | `["op","startSeq","endSeq"]` | ☐ |
| `SESSION_FORMAT_VERSION` | 3 | ☐ |
| 会话文件名代次 | `session.v3.jsonl`（取最大 N） | ☐ |
| 事件信封白名单 | 7 键 | ☐ |
| `$DSH_HOME` 布局 | 9 类路径 | ☐ |
| `projectKey` 算法 | 目录名 == projectKey(cwd) | ☐ |
| `.agent-presets` 迁移策略 | 「有会话引用的保留」 | ☐ |

> **三面同时移动才叫升级**。只动 ① 是「重装」，只动 ② 是「打补丁」。
> **阶段 0（rc.1→rc.3）只动了 ①（已完成）；→ 0.1.7-rc.1 则三面全动** —— 这就是 A.7 代价对比的本质。
>
> ★ **第三轮更新**：上表的「升级后状态」勾选框现按 **0.1.7-rc.1** 复核。
> rc.1 实测已先把**可提前判定**的项填上（见 E.0 表）：
> - ① 依赖面：slot **1 个失效**（`settings.plugin.item`）· external 4 包 ✓ · CLI 面 ✓（`--expose-internals` ✗）· 锚点 4 组 ✓
> - ② 补丁面：**10/13 匹配**（3 条失效 = 2 处）
> - ③ 数据面：`sessionReplaceOpFields` ✓ 未变 · `SESSION_FORMAT_VERSION` **3→4** · 事件类型 +3

---

### D.3 升级前的「不可省略清单」（缺一不可）

```
□ 0. **先修既有失败**：`audit-build-path-parity.py --selftest` 现为 37/38 FAIL（见 B.2 注）
      + 同步 GOAL.md 第 105/248 行的过期声明（否则第一道防线不可信）
□ 1. 跑 §4 阶段 0（先修版本分裂；不改功能、无风险）
□ 2. 建 §D.0 的 audit-upgrade-readiness.mjs（六段 + 全部正负控）
□ 3. 全量 dump 当前 runtime 树快照（升级的对照基线）
□ 4. **备份设备真实数据**（`$DSH_HOME` 全量；含 23+ 个真实会话）
□ 5. 在临时目录装目标版本，跑六段中**不需要构建**的部分（① ② ⑥）
□ 6. 读目标版本的事件类型全集 + kind 枚举 + slot 表 + CLI 面（B/C 的 1.5/1.6）
□ 7. 产出「失效清单」（补丁 / 锚点 / slot / 契约 / kind 逐条）
□ 8. 若无 BLOCK 且无 UNKNOWN ⇒ 进入阶段 3；否则**停下来重估目标版本**
```

> **第 0 条为什么排第一**：升级的全部安全感都建立在「门禁能拦住问题」这个前提上。
> 一个连自己都不自洽的门禁，绿了也不代表什么 —— 这正是本仓 P-30 的定义。

> **第 4 条为什么不可省**：v0.2.5 的教训是「编译过 + 门禁绿 ≠ 设备上能用」；
> 而升级的教训会更深一层 —— **数据一旦被新版本格式写过，就回不去了**。

---

### D.4 本附录与附录 A 的分工（避免重复）

| 附录 | 审什么 | 结论形态 |
|---|---|---|
| **A** | 官方 **0.1.7** 相对我方**具体变了什么** | 事实清单（包集/v4/锚点失效…） |
| **B** | 我方**安卓适配层**的耦合面 | 六层风险表 |
| **C** | 我方 **RP 层**的耦合面 | 十面风险表 + 证据强度自评 |
| **D** | 怎么**验收** | 一条判据 + 正负控 + 三面总账 + 不可省略清单 |

**A 是「世界变了什么」，B/C 是「我依赖了什么」，D 是「我怎么知道还成立」。**
三者缺一，升级就只能靠真机撞 —— 而真机撞的代价是**用户的数据**。

---

## 附录 E：0.1.7-rc.1 作战计划（第三轮·**现行**）

> **本附录是「怎么升到 0.1.7」的执行依据。** §4 四阶段与 A.9.3 清单**降为历史/参考**。
>
> **触发**：2026-09-23 官方发布 `0.1.7-rc.1`（`next`），汇总此前全部 alpha 并
> **引入插件版本号机制**。这正是 A.7 里「等它转 rc 再评估」的条件 ⇒ **目标由「暂不做」改为「做」**。

### E.0 事实基线（rc.1 实测，与 alpha.2 逐项对照）

用 `rp-workspace/tmp/probe-017rc.mjs` 对 rc.1 跑完整对账（`--alpha` 可对照 alpha.2）：

| 面 | rc.1 实测 | 与 alpha.2 比 |
|---|---|---|
| 包集 | **277**（+43 / −6） | **完全一致** ⇒ rc.1 = alpha 汇总 + 版本号机制，**非结构变化** |
| 依赖形态 | 80 个依赖中 **72 个精确 pin** | 一致（官方已收紧） |
| `SESSION_FORMAT_VERSION` | **3 → 4**（换代） | 一致 |
| `isReplaceOp` 三键 | `op/startSeq/endSeq` **未变** | 一致 ⇒ **数据形态的关键前提仍成立** |
| 事件类型 | 56 → **59**（+`developer/message` / `image/offload` / `workspace/changes`，无消失） | 一致 |
| 补丁锚点 | **10/13 匹配，3 条失效** | 一致 |
| 就绪信号 `dsh web:` | ✓ 在 `dsh-web-app/lib/index.js` | 一致（**搬到 dsh-web-app**） |
| `--no-open`/`--port`/`--trusted-host` | ✓ 全在 | 一致 |
| `--expose-internals` | ✗ **0 命中（参数已移除）** | 一致 ⇒ **B4** |
| external 4 包 + bundles 2 包 | ✓ 全在 | 一致 |
| slot（我方 7 个） | **6 ✓ / 1 ✗**（`settings.plugin.item` 缺失，官方改 `settings.pluginInventory`） | 一致 |
| 4 组哈希锚点 | ✓ 全在（×50/×49/×177/×108） | 一致 |

> **★ 一个重要的好消息**：`probe-017rc.mjs` 显示 **rc.1 与 alpha.2 的包集完全相同（277=277）**。
> ⇒ 我在附录 A 里对 alpha.2 做的**全部逐项审计结论，对 rc.1 直接适用**，
> 不需要重做审计 —— 这大幅降低了本轮的不确定性。

### E.1 ★ 新增面：插件版本号机制（rc.1 引入，我方需正面处理）

**机制**（`dsh-app-boot/lib/index.js` 的 `evaluatePluginCompatibility`，源码原文）：

```js
function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
  const fields = objectOf(manifest, "Plugin manifest");
  if (!Object.hasOwn(fields, "peerDependencies")) return void 0;   // ★ 没声明 ⇒ 直接放行
  // 只检 @deepseek-ai/dsh 与 @deepseek-ai/dsh-* 的 peer
  // workspace:^ / workspace:~ / workspace:* ⇒ 替换成当前 runtime 版本（永远满足）
  // 不满足 ⇒ peers[name] = range ⇒ 返回 issue ⇒ 安装被拒
}
```

| 项 | 值 |
|---|---|
| 检查时机 | **`dsh plugin add` / 带 spec 的 `install`**（pnpm 运行**前**） |
| 检查对象 | 仅 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 `peerDependencies` |
| 豁免文件 | `profile/compatibility.json`（与 `package.json` / `cordis.patch.yml` 并列） |
| 豁免 CLI | `dsh plugin version-exemptions` / `allow-version <pkg@ver> --dsh-version <rt> --accept-risk` / `revoke` |

**我方现状（实测）**：8 个自研插件**全部没有 `peerDependencies`** ⇒ `return void 0` ⇒ **放行**。

> ⚠️ **但这是「因为没声明而恰好通过」，不是「声明正确」**。
> 两个后果必须处理：
> 1. **语义缺失**：我方插件确实**强依赖**官方包（`dsh-client-ui-sidebar` 等 4 个 external），
>    现在不声明 ⇒ 官方**帮助不了我们**（升级时不会提示不兼容）；
> 2. **未来风险**：一旦有人（或工具）给插件加上 `peerDependencies` 而范围写错，
>    插件会**在安装期被拒**，表现为「装不上」而非「跑不起来」—— 排查方向完全不同。

⇒ **E 阶段 A 的动作**：给 8 个插件补 `peerDependencies`，**用 `workspace:*` 形态**
（官方明确：该形态会被替换成当前 runtime 版本 ⇒ **永远满足**，且语义正确地声明了依赖）。
并加判据（见 E.7）。

### E.2 四条硬阻断（A.9.2 的结论在 rc.1 上**全部复现**）

| # | 阻断 | 性质 | 本计划对应阶段 |
|---|---|---|---|
| **B1** | 会话格式 **v3 → v4**（`currentVersion: 3 → 4`） | 数据层，**不可逆** | **阶段 B** |
| **B2** | `tool/result` 表示重写（`role:'user'` → `role:'tool'`） | 数据层 + 我方解析器 | **阶段 B** |
| **B3** | **2 条补丁锚点失效**（`dsh-bash-sandbox` 的 `signal` 第三参 / `documentpreview` 的 Iterator 守卫） | 构建层 | **阶段 C** |
| **B4** | ★ `--expose-internals` **参数消失**（NodeService **硬编码**传它） | 壳层 | **阶段 D** |

**另有一处「静默消失」**（不算硬阻断但必须处理）：
`settings.plugin.item` 槽位在 0.1.7 已不存在 ⇒ 我方 3 个预适配插件的设置入口
**会静默消失**（`slots.inject` 语义 = 等声明出现再注册）⇒ **阶段 D**。

### E.3 九阶段计划（每阶段独立可验、可回滚）

> 顺序原则：**先加固判据 → 再动数据 → 再动字节 → 最后动构建**。
> 判据在前，是因为后面每一步都要靠它证明「没坏」。

#### 阶段 A：插件版本号机制 + 判据加固（**先做，零风险**）

| 步 | 动作 | 验证 |
|---|---|---|
| A.1 | 8 个插件补 `peerDependencies`（`workspace:*` 形态），`rebuild-plugins.ps1` + `build-dsht.ps1` **两侧同步** | `audit-plugin-build-parity.mjs` |
| A.2 | `audit-upgrade-readiness.mjs` 的 **⑤ 装配面**加「插件 peer 声明」判据 | selftest 加正负控 |
| A.3 | ⑤ 装配面补 **slot 改名映射表**（`settings.plugin.item` → `settings.pluginInventory`） | 正控：删旧名 ⇒ 报红 |

#### 阶段 B：数据层（**最高风险，不可逆**）

| 步 | 动作 | 要点 |
|---|---|---|
| B.1 | **接入 `dsh-session-format-v3-to-v4` 迁移** | 必须收集**直属 subagent 子会话证据**（官方明示：缺失则拒绝） |
| B.2 | ★ **迁移前强制全量备份**（用户已裁定） | 备份落**共享交换目录**（`/sdcard`，**不入库**）+ 加 `.gitignore` 规则堵死「被误拷进仓库」（**已完成**，见 E.6） |
| B.3 | 我方解析器按 v4 复核：`session-repair.ts` 的 `ENVELOPE_KEYS` / `STEP_SCOPED`（含 `tool/result`） | ★ `srcVersion >= 3` 的**巧合正确性**改为**按代次查表** |
| B.4 | `pickCurrentSessionFilename` 取最大 N ⇒ 确认认 v4 文件 | v4 文件到来时会自动挑中 |
| B.5 | 单源 `sessionFormatKnownGenerations` **加 4**（**已完成**，见状态） | 判据⑥ 会用它 |
| B.6 | **用真实批次数据**跑迁移 + 打开（模拟器上，1 个 v0 会话 + 23+ 真实会话在真机） | 唯一能证明「数据没坏」的判据 |

#### 阶段 C：补丁层

| 步 | 动作 |
|---|---|
| C.1 | `dsh-bash-sandbox` 锚点正则容忍**可选第三参 `signal`**（或改更稳的锚定方式） |
| C.2 | `dsh-client-ui-sidebar-documentpreview`：先判定「旧 WebView 的 ES2025 Iterator 守卫是否仍需要」；不需要 ⇒ **删补丁**（净简化） |
| C.3 | 其余 11 条逐条确认**语义未变**（匹配 ≠ 行为正确） |
| C.4 | 新增**锚点指纹**判据（B.2 提议）：命中数相同但指纹变 ⇒ 报「锚点漂移」 |

#### 阶段 D：壳层 / 装配层

| 步 | 动作 | 要点 |
|---|---|---|
| D.1 | ★ NodeService **去掉 `--expose-internals`** | 0.1.7 已移除该参数；**先实测不传能否启动** |
| D.2 | ★ `settings.plugin.item` → `settings.pluginInventory` | 3 个预适配插件的设置入口 |
| D.3 | profile 三件套复核：`patchReload` 定案（`cordis-plugin-hmr` 已被 `dsh-hmr` 取代 ⇒ **HMR 可用性要重测**） | 若新 HMR 可用，`"startup"` 的取舍理由要重写 |
| D.4 | 包改名同步：`dsh-agent-presets` → `dsh-agent-preset(+registry)`；`dsh-code-runtime` → `dsh-ptc-runtime*` | 检查我方是否引用 |

#### 阶段 E：构建与门禁

| 步 | 动作 |
|---|---|
| E.1 | `-DshVersion 0.1.7-rc.1` + 单源同步 + **lockfile 显式更新并提交**（B1-3 修正） |
| E.2 | 重装 runtime（`--no-frozen-lockfile`）→ 重跑补丁（13 条） |
| E.3 | **全量门禁**（Step 0.5 全项 + Step 0.55 + Step 5.4 + Step 6.5/6.6） |
| E.4 | `audit-upgrade-readiness.mjs` 六段全过（**含 UNKNOWN 禁止**） |
| E.5 | vitest：基线 **1835 passed / 4 failed**（那 4 个是 `undo.spec.ts` 的既有 git flaky，见 KNOWN-DEBT）⇒ 升级后**不得多于** 4 |

#### 阶段 F：模拟器实测（**不可省**）

| 步 | 动作 |
|---|---|
| F.1 | 装 x86_64 APK → node 起来（**0 boot loop**） |
| F.2 | ★ **打开老会话**（模拟器上是 **v0 代次** ⇒ 走完整迁移链 v0→v1→v2→v3→v4） |
| F.3 | 跑一轮对话（验 LLM 注入链未断） |
| F.4 | 验 RP 功能：导入 / 世界书 / 状态栏 / 回退 各一次 |

#### 阶段 G：交付

| 步 | 动作 |
|---|---|
| G.1 | 双架构 APK（arm64 release + x86_64 debug） |
| G.2 | 发 release（v0.2.7 或 v0.3.0，按破坏性定） |
| G.3 | 文档同步：本审计文档执行记录 / GOAL.md / README / dsh-version.json |

### E.4 验收判据（沿用附录 D，**入口已建成**）

```bash
node rp-workspace/scripts/audit-upgrade-readiness.mjs --selftest   # 7/7
node rp-workspace/scripts/audit-upgrade-readiness.mjs              # 六段
```

**当前六段状态（对 0.1.5-rc.3 runtime）**：**6 OK / 0 BLOCK / 0 UNKNOWN** ✅
（阶段 0 完成后的基线；升级到 rc.1 后必须重新全过）

### E.5 与 A.9.3 清单的差异（为什么不直接用旧清单）

| 项 | A.9.3（旧） | 附录 E（现行） | 为什么改 |
|---|---|---|---|
| 目标版本 | `0.1.7-alpha.2` | **`0.1.7-rc.1`** | 官方转 rc |
| 数据层备份 | 「写清拒绝不改源语义」 | **具体化**：备份落 `/sdcard` + gitignore 堵漏 | 用户裁定「强制全量备份」 |
| 装配层 | 未提插件 `peerDependencies` | **新增阶段 A** | rc.1 新引入的机制 |
| 判据入口 | 未定 | **`audit-upgrade-readiness.mjs`（已建成并接入门禁）** | 阶段 0 的产出 |
| 阶段数 | 5 | **9（A~G，含 A 加固）** | 明确「先加固判据再动手」 |

### E.6 回滚（**升级前先记住**）

| 层级 | 回滚动作 |
|---|---|
| 版本单源 | `git checkout` `dsh-version.json` + `dsh-runtime-src/package.json` |
| runtime | 按 0.1.5-rc.3 重装（当前 `node_modules-prev` 有上一代备份） |
| 补丁 | `apply-platform-patches.py` 幂等可重跑 |
| **数据** | ★ **迁移前备份**是唯一退路（v3→v4 **不可逆**，官方明示「拒绝不改源」） |
| 产物 | v0.2.6 / v0.2.7 的 APK 均可重发 |

**回滚触发条件（任一即回）**：`audit-upgrade-readiness.mjs` 有 BLOCK/UNKNOWN ·
契约探针 BLOCK · 模拟器打不开老会话 · node boot loop · vitest 多于基线 4 个失败。

### E.7 本计划的新增判据清单（每条带正负控）

| 判据 | 守什么 | 正控 | 负控 | 零控 |
|---|---|---|---|---|
| A.2 插件 peer 声明 | 8 个插件都声明了 `peerDependencies` | 删一个插件的 peer ⇒ 报红 | 不改 ⇒ 0 命中 | 产物不存在 ⇒ UNKNOWN |
| A.3 slot 改名映射 | 我方 inject 的 slot 名在**映射表**下都存在 | 把映射表的旧名删掉 ⇒ 报红 | 不改 ⇒ 0 命中 | 抽不到 SlotMap ⇒ UNKNOWN |
| C.4 锚点指纹 | 补丁锚点未漂移 | 锚点插空格 ⇒ 指纹变 | 不改 ⇒ 指纹不变 | 目标文件缺失 ⇒ UNKNOWN |
| B.3 代次查表 | surfaceOp 字段名按 `header.version` 查表 | 往表加一代 ⇒ 我方未处理 ⇒ 报红 | 不改 ⇒ 0 命中 | 读不到版本 ⇒ UNKNOWN |
| B.2 备份前置 | v4 迁移前必有备份 | 删备份标记 ⇒ 报红 | 不改 ⇒ 0 命中 | 无待迁移会话 ⇒ UNKNOWN |

> **每条都必须「有正负控」才叫判据** —— 这是本仓 P-30 的硬要求，
> 也是阶段 0 期间**连续抓到我自己 4 个判据缺陷**的原因（见 A.9.1）。

### E.8 诚实边界（R7：哪些是本计划**没有**覆盖的）

| 未覆盖 | 为什么 | 后果 |
|---|---|---|
| 官方 **0.1.7-rc.2+** 的后续变化 | 只在 rc.1 上实测 | 若升到更高 rc，需重跑 `probe-017rc.mjs` |
| `dsh-ptc-runtime*` 等**新包的能力** | 只做了包集比对，未研究其 API | 我方**未引用**它们 ⇒ 无直接影响；但将来可能有用 |
| `libreoffice-kit-win32-x64` 的裁剪 | 只确认它是 Windows 专用 | 需在构建时确认 Android 侧不打包（`build-dsht.ps1` 3a 按目录名删 win32/darwin） |
| **真机**（非模拟器）验证 | 用户裁定「先 0.1.5-rc.3 发一版，再单独攻 0.1.7」 | 模拟器上无真实数据（只有 1 个 v0 会话）⇒ **真实数据的迁移只能在真机上验** |
| HMR 在 Android 的可用性 | 需实测 `dsh-hmr` | 影响 `patchReload: "startup"` 的定案（D.3） |


