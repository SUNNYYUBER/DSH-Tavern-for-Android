# DSH 底层版本升级审计（2026-09-23）

> **本文档回答三件事**：① 官方 DSH 现在出到什么版本；② 我方锚在哪里、差多远；
> ③ 升级到底要动哪些东西、按什么顺序做、怎么验、怎么回滚。
> **顺带收录**：本项目全部 goal 文档清单与当前状态（§7）。
>
> **建立**：2026-09-23　**状态**：调研完成，**未执行升级**（本文档是作战地图，不是执行记录）
> **实测来源**：`npm view @deepseek-ai/dsh`（本机实跑，非记忆）

---

## 0. 结论先行

**一句话：我们离官方最新只差一个顶层版本号，但那个版本号背后藏着一个真实的版本分裂，必须先修掉。**

三个判断：

1. **官方最新稳定线 = `0.1.5-rc.3`**（`dist-tags.latest` 与 `next` 都是它）；
   最前沿是 `0.1.7-alpha.2`（`alpha` tag），**不建议跟**（见 §3.3）。
2. **我方名义 pin = `0.1.5-rc.1`，但所有子包已实际解析到 `0.1.5-rc.3`**
   —— 即「顶层旧、子包新」的**版本分裂**。这是个真实风险，也是本轮**最该先动的地方**（见 §2.2）。
3. **升级动作本身不复杂，复杂的是它牵动的补丁面**：**12 组补丁、18 个唯一 marker、
   11 个源文件里 79 处事件字符串**（均为本机实测，见 §4 阶段 2）。所以升级必须
   **分组验证、逐组可回滚**，不能一把梭。

---

## 1. 官方版本现状（本机实测）

### 1.1 dist-tags

| tag | 版本 | 含义 |
|---|---|---|
| `latest` | **0.1.5-rc.3** | 官方推荐稳定线 ← **我方目标** |
| `next` | **0.1.5-rc.3** | 与 latest 同值（预发布候选即当前推荐） |
| `alpha` | **0.1.7-alpha.2** | 前沿线，跨了两个小版本 |

### 1.2 全部已发布版本（时间序）

```
0.0.1-rc.1  →  0.0.1-rc.2  →  0.0.1-rc.5
0.1.0-rc.2  →  0.1.0-rc.3  →  0.1.0-rc.6  →  0.1.0-rc.7  →  0.1.0-rc.8
0.1.1-rc.1  →  0.1.1-rc.2
0.1.2-alpha.2 → alpha.3 → alpha.4 → alpha.5
0.1.2-rc.1
0.1.3-alpha.2
0.1.5-alpha.1 → alpha.2
0.1.5-rc.1  →  0.1.5-rc.2  →  0.1.5-rc.3      ← 我方在此区间
0.1.6-alpha.1 → alpha.2
0.1.7-alpha.1 → alpha.2                        ← 最前沿
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

---

## 4. 升级怎么做（分阶段，每阶段独立可验可回滚）

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

> **为什么先做这一步**：`GOAL.md` §七 R21 的纪律 —— **契约探针在构建期 BLOCK 是最后防线**，
> 但它的输入面来自当前 runtime；**升级前必须先看清新版本的契约**，否则是拿旧判据验新世界。

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

```
阶段 0  修版本分裂（不升级，可立即做）        ← 收益明确、风险最低
   ↓
阶段 1  探针目标版本契约（临时目录，不动仓库）
   ↓
阶段 2  补丁面逐条对账 → 产出「失效清单」
   ↓
阶段 3  pin 改 0.1.5-rc.3 → 重装 → 重跑补丁 → 门禁 + vitest + 模拟器（含老会话）
   ↓
阶段 4  出双架构包 → 发 release
```

**若只能做一件事**：做**阶段 0**。它不碰功能、不改数据、能消除版本分裂、
并把判据盲区补上 —— 性价比最高，且**完全无风险**。

---

## 附录 A：→ 0.1.7-alpha.2 的破坏性变更逐项审计

> **本附录是应要求补做的**：§3.3 此前只给了「不建议跟 alpha」的结论，
> **没有给出破坏性变更的逐项证据** —— 那是结论，不是审计。本附录补上。
>
> **方法**：在临时目录完整安装 `@deepseek-ai/dsh@0.1.7-alpha.2`（510 个包），
> 与我方 runtime（`dsh-runtime-src/node_modules`）做**逐项实机比对**。
> 所有数字与代码片段均为实跑产出，可复现。

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
| 补丁 | 0 条失效（预期） | **2 条失效**（实测）+ 1 条疑似推翻（HMR） |
| 判据 | 补 1 条盲区 | **补 3 面**（含格式代次、工具结果表示、子包一致性） |
| 包结构 | 不变 | **6 个包消失、41 个新增** |
| 真机验证 | 跑一次启动 | **必须**跑迁移 + 打开老会话 |
| 风险 | 低 | **高** |

**建议**：
1. **先做 §4 阶段 0**（无风险，且是后续任何升级的前置）；
2. **等 0.1.7 进 `latest`**（转 rc）再评估 —— 届时官方 API 已收紧完毕、迁移边也稳定；
3. 若因某个特性**必须**上 0.1.7，则按 **A.6 的 ①→④ 顺序**做，且**①（判据扩面）绝不能省** ——
   否则会重演 v0.2.5 那类「绿灯但不可用」的事故（见 §7.4 的教训）。

---

### A.8 本附录的可复现性

```bash
# 1. 装 0.1.7 到临时目录
cd %TEMP% && mkdir dsh17 && cd dsh17 && npm init -y
npm install @deepseek-ai/dsh@0.1.7-alpha.2

# 2. 我方的包集 / 版本（对照用）
ls rp-workspace/dsh-runtime-src/node_modules/@deepseek-ai

# 3. 补丁锚点逐条对账（本次用的脚本，在 rp-workspace/tmp/probe-017-anchors.mjs）
node rp-workspace/tmp/probe-017-anchors.mjs
```

关键事实的出处：
- 版本与 dist-tags → `npm view @deepseek-ai/dsh`
- v4 规范 → `node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/README.zh.md`
- 格式代次 → `dsh-session-format-catalog/lib/index.js` 的 `currentVersion`
- 硬校验 → 同文件 `header.version !== SESSION_FORMAT_VERSION`
- 补丁失效 → `tmp/probe-017-anchors.mjs` 实跑输出
