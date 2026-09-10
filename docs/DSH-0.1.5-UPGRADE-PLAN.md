# DSH 0.1.5-rc.1 升级作战方案

> **建立**：2026-09-10（心跳 39）　**状态**：待执行（已调研完毕，未动手）
> **基线**：DSHT 当前 = `0.1.2-rc.1`　**目标** = `0.1.5-rc.1`（npm `latest`，2026-09-10 实测）
> **本文档是升级时的唯一作战地图**，执行中的新发现回写此处 + `MASTER_TODO.md`。

---

## 0. 结论先行

**建议升级，但必须分五阶段执行、每阶段可独立验证与回滚。**

三个判断：

1. **收益真实且对我方关键**：0.1.5 把 system prompt 从只记日志的 header 快照**提升为 surface 事件**
   （`system/message`），并新增 `in-history` 替换能力 —— 这**正是 `D-4`（用户输入位置）被判"不可达"的那个约束的解法方向**。
2. **风险集中在数据层**：跨了 `0.1.3 → 0.1.5` 两个版本线，会话格式要连续过 **v1→v2→v3 三段迁移**，
   迁移**不可逆**且官方自述"可能影响历史 session 加载速度"。
3. **我方适配面可枚举**：11 个 cordis patch 点 + 12 个源文件（175 处事件字符串）+ 3 个会话解析器。
   全部有据可查，没有"未知的未知"。

---

## 1. 升级动机（按强度排序，全部有源码证据）

### 动机 1 ★★★★★　system prompt 成为 surface 第 0 号节点

**变更**：`system/message` 成为第 4 种 surface 事件类型。

```
0.1.2-rc.1:  SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'          ← 3 种
0.1.5-rc.1:  SurfaceEventType = 'system/message' | 'user/message' | 'assistant/message' | 'tool/result'  ← 4 种
```
> 证据：`packages/core/session/src/types.ts:373`(v0.1.2) vs `:412`(v0.1.5)

**为什么对我方关键**：当前 system prompt 住在 `request/header.system`，模型可见的事实有**两个归属**
（surface 拥有消息、header 拥有排在最前的那条）。0.1.5 让它**单一归属**：

| 维度 | 0.1.2（现状） | 0.1.5 |
|---|---|---|
| 存储位置 | `request/header.system` 字段 | surface `system/message` 事件 |
| 持久化 | 仅记日志的快照 | **真 surface 节点，进会话日志** |
| 变更表达 | `headerEquals` 逐字节比较 | `surfaceOp: replace` + `sourceEventSeqs` |
| 可见性 | 需读 header | **Web 卡片刻折叠展示，可检视** |

**对我方 `D-3` 修复的直接意义**：我们当前通过 `system-prompt/assemble` 的 `assembly.sections` 注入
（这是 0.1.2 下唯一合法通道）。0.1.5 中 `systemPrompt.assemble()` **仍在循环步骤顺序里**：

```
领取收件箱 → systemPrompt.assemble() → 投影运行时上下文 → agent/pre-step waterfall
→ 投影系统提示词 → step/start → 提交 system/message（有变化时）→ 提交 user/message
→ agent/request waterfall → request/header → request/context → 流式请求
```

→ **我方 `assembly.sections` 注入路径在 0.1.5 下继续有效**，且产物从"header 里的隐式文本"
变成"可见的 surface 节点"。**升级后 D-3 的验证方式会更直观**（Web 上能看到系统提示词卡片）。

### 动机 2 ★★★★★　`in-history` 系统提示词替换 —— 可能解锁 D-4

**变更**：新增 `SystemPromptUpdate = 'in-history'` 能力。声明该能力的模型路由，
在提示词变化时**把新提示词追加到已缓存历史之后，而不是重写消息 0**。

> 设计原文：「一个 DeepSeek 模型接受对话任意位置的 `system` 消息，并把最新一条视为完整的有效系统提示词，
> 替换最前面那条。」

**对我方 `D-4` 的意义**：D-4 的结论是"用户输入绝对位置由 `deriveMessages()` 决定，TT 结构无法复现"。
`in-history` 提供了**在历史任意位置插入 system 消息**的官方机制 —— 若 TT 的组装形态是
"系统内容 cluster + 末尾用户输入"，现在 DSHT 有了表达它的原语。

**⚠️ 关键约束（必须先决策）**：

| 事实 | 证据 |
|---|---|
| `in-history` **只声明在 `deepseek-flash` 条目**，其他模型需**显式声明** | `packages/llm/llm-deepseek/src/index.ts:100` |
| 显式声明方式 | `models: [{ id: 'deepseek-v4-flash', systemPromptUpdate: 'in-history' }]` |
| **`llm-pi-ai` 路由全部保持替换行为**（不追加） | `llm-deepseek/README.zh.md:163` |
| **我方当前走 `llm-pi-ai`**（provider = `deepseek`，非 `deepseek-official`） | `settings.yaml` providers.deepseek |

→ **结论：即使升级，`in-history` 对我方默认不生效。** 要启用需**切换到 `llm-deepseek` adapter**
（provider 改 `deepseek-official`）。这是一个**独立的架构决策**，不应与升级绑定。

**建议**：升级先取动机 1/3/4；`in-history` 解禁作为**升级后的独立评估项**（P1）。

### 动机 3 ★★★★　前缀缓存保持（长会话性能）

system prompt 变更不再使整个 provider 前缀缓存失效。对长时间 RP 会话（几十上百楼）是实质改善。
**但我方 RP 场景的提示词变更频率低于 agent 场景**，故列第三。

### 动机 4 ★★★★　流式工具调用损坏修复（0.1.3 起）

0.1.3 修复"工具以空名称失败并写入无法重新打开的会话记录"。
我方适配 agent 会话跑 70+ 步工具链 —— **很可能已踩过**（历史上有过"会话打不开"的损坏记录）。

### 动机 5 ★★★　与用户诉求同构

用户原话：「DSH 支持了动态加载系统提示词，这个或许和我们的预设相关的各种系统提示词的组装机制是异曲同工的」。
**判断成立** —— `assembly.sections`（我方预设/世界书/角色卡注入点）与 `system/message` surface 节点
是同一机制的两端。升级让这条链路从"半隐式"变成"显式一等公民"。

---

## 2. 破坏性变更全清单

### 2.1 版本跨度与改动规模

```
0.1.2-rc.1 → 0.1.5-rc.1
6766 files changed, 208222 insertions(+), 58150 deletions(-)
```
中间跨过：`0.1.3-alpha.2`、`0.1.5-alpha.1`、`0.1.5-alpha.2`。

### 2.2 会话格式：三段迁移（最高风险）

| | 迁移器 |
|---|---|
| **0.1.2-rc.1** | **完全没有 `session-format*` 体系**（无 catalog、无 format 包、无任何迁移器） |
| **0.1.5-rc.1** | `session-format-catalog` + `session-format` + **`v0-to-v1`** + **`v1-to-v2`** + **`v2-to-v3`** |

> 证据：`git ls-tree dsh-v0.1.2-rc.1 packages/session/` vs `dsh-v0.1.5-rc.1` 同路径

**这意味着**：设备的会话文件要连续过 `v1→v2→v3`（或 `v0→v1→v2→v3`）三段迁移。

**v2→v3 的结构转换包含「system head 节点转换与消息身份」**：
- v3 规范信封（canonical envelopes）定义了严格准入
- 系统头节点要插入到 surface 第 0 位
- 引用规则（sequence references）与源审计（source audit）定义保留内容与**不支持的输入**

**⚠️ 迁移的不可逆性与失败条件**（引自 0.1.3 侦察，条款在 0.1.5 下依然适用，需复核）：
- 未知事件 type 使迁移失败（**连 `ignorable: true` 也炸**）
- 我方自定义 `source.plugin: 'dsht-rp'` 是否在 v3 payload 校验白名单内 —— **必须实测**
- 官方自述"可能影响部分历史 session 加载的响应速度"

**我方会话体量**：实测 12MB ~ 214MB jsonl。首次打开 = 全量迁移 + seq 重映射 + 校验。

### 2.3 `SurfaceEventType` 扩容（影响面最广的语义变更）

新增 `system/message` → **所有枚举 surface 事件类型的地方都要复核**。

我方命中：**175 处 / 12 个文件**

| 文件 | 角色 |
|---|---|
| `dsh-plugin/index.ts` | 事件适配器（`sessionEventAt` / `sessionEventsSnapshot`）+ 楼层解析 |
| `dsht-plugin-memory/index.ts` | 上下文瘦身（阴影化/折叠） |
| `dsht-plugin-undo/index.ts` | 回退/重新生成 |
| `dsht-plugin-shared/session-surgery.ts` | 会话手术（截断/替换） |
| `dsht-plugin-shared/tt-projection.ts` | TT 投影槽位 |
| `dsht-plugin-shared/file-snapshots.ts` | turn 锚点文件快照 |
| `dsht-plugin-tavern-helper/facade.ts` | TH API 桥接（`getChatMessages` 等） |
| `dsht-plugin-prompt-template/index.ts` | 提示词模板 |
| `dsht-rp-ui/src/client/RpNativeChat.tsx` | 原生聊天渲染 |
| `dsht-rp-ui/src/client/th-shim.ts` | TH 卡脚本 shim |
| `import/dsh-export.ts` | 导出 |
| `lore/trigger.ts` | 世界书触发 |

### 2.4 核心包改动量（按对我方影响排序）

| 包目录 | 改动 | 对我方影响 |
|---|---|---|
| `session/session-persistence-jsonl` | **9440+ / 1647-** | **极高** —— 我方 2 个补丁目标（sim 补丁 + link→rename） |
| `core/agent-loop` | **3644+ / 861-** | **极高** —— 我方 assemble/pre-step 监听器契约 |
| `core/session` | 1161+ / 1196- | **极高** —— 事件类型与 Session API |
| `llm/llm` | 1469+ / 30- | 高 —— 新增 `SystemPromptUpdate` 字段 |
| `fs/tool-fs-search` | 95+ / 30- | 中 —— 我方 rg 补丁 |
| `shell/bash-local` | 109+ / 38- | 中 —— 我方 Android sh 补丁 |
| `shell/bash-sandbox` | 49+ / 39- | 中 —— 我方 Android sh 补丁 |
| `sandbox/sandbox-local` | 33+ / 20- | 中 —— 我方降级补丁 |
| `terminal/terminal-bash` | 42+ / 26- | 中 —— 我方 mksh 补丁 |
| `storage/storage-json` | 33+ / 18- | 低 —— 我方 sim 补丁 |
| `credentials/credentials-local` | 5+ / 5- | 低 —— 我方 sim 补丁 |
| `shell/tool-bash` + `tool-bash-persistent` | 45+ / 99- | 中 —— **新目录结构，需核对补丁目标是否改名** |

---

## 3. 我方适配面（精确清单）

### 3.1 cordis patch 补丁点（11 个，全部需重新验证命中）

| # | 目标包 | 补丁内容 | 标记 |
|---|---|---|---|
| 1 | `dsh-bash-local` | run()/start() 的 bash argv → Android `/system/bin/sh` | `DSHT-ANDROID-SH` |
| 2 | `dsh-bash-sandbox` | confine() 内层 argv | `DSHT-ANDROID-SH` |
| 3 | `dsh-sandbox-local` | 沙箱不可用降级（warn + 原 argv 直通） | `DSHT-ANDROID-UNSANDBOXED` |
| 4 | `dsh-tool-fs-search` | rg 二进制 → 平台感知降级 | 见 build 脚本 |
| 5 | `dsh-terminal-bash` | DEFAULT_BASH_SHELL / --noprofile 适配 mksh | 见 build 脚本 |
| 6 | `dsh-session-title` | （见 build 脚本 Step 3.5） | 见 build 脚本 |
| 7 | `dsh-storage-json` | `fsyncDirectory` sim 态跳过 | `DSHT-SIM` |
| 8 | `dsh-session-persistence-jsonl` | `syncDirPosix` sim 态跳过 | `DSHT-SIM` |
| 9 | `dsh-session-persistence-jsonl` | **`link()` → `rename()`**（Android SELinux 禁硬链接） | `DSHT-ANDROID-RENAME-PATCH` |
| 10 | `dsh-credentials-local` | `assertOwnerOnly` sim 态跳过 | `DSHT-SIM` |
| 11 | `dsh-base/cordis.patch.yml` | composition 补丁 | 见 build 脚本 |

**⚠️ 补丁失效的失败形态是"构建期 throw"**（`Dsht-Patch` 断言"期望 N 处、实际 M 处"即抛），
**不是静默**。这是好消息 —— 升级时漏打补丁会立刻暴露。但需**逐个复核正则**。

**另一处需重定位**：`scripts/patch-resilient-list.mjs`（坏身份/重复 id 会话自愈）+ Step 4.5 明文持久化补丁。

### 3.2 会话解析器（3 个，v2→v3 后必须回归）

1. **rollback-mask 解析器** —— host 从 session.jsonl 解析 marker 的 seq
2. **extractFloors（楼层提取）** —— memory 与 UI 共用
3. **collectVariantGroups（变体组）** —— 按 seq 分组

**风险点**：v2→v3 会做 seq 重映射，旧 `.bak` / 迁移前的 undo 记录里的 seq 不再对得上。
迁移后的文件自洽 ✓，但**跨迁移时刻的在途操作**需防御。

### 3.3 我方直写会话文件的路径（最可能必须改造）

| 路径 | 现状 | v3 下风险 |
|---|---|---|
| `convert-chat`（迁移转换） | 直写 jsonl | **产出的 v1 形态会直接被 v3 校验拒** → 大概率必须改走官方 API |
| `repair-sessions`（损坏修复/截断） | 文件手术 | 需产出合法 v3 信封 |
| `session-surgery.ts`（截断/替换） | 文件手术 | 同上 |

**判断**：这是**最大的单项适配工作**。可能要把"确定性文件转换"改成"调用官方 import/迁移 API"。

### 3.4 需实测确认的三项（无法静态判定）

1. 我方自定义 `source.plugin: 'dsht-rp'` 是否通过 v3 的 payload 校验白名单
2. `session-persistence-jsonl` 的**锁落盘形态**在 node 崩溃重启（我方 3s 自动重启）后是否残留卡新进程
3. 打开 12MB+ 会话的**迁移耗时与内存峰值**

---

## 3.5 阶段 1 静态预检结果（2026-09-10 执行）

**方法**：`git archive` 提取两版相关包的源码到 `tmp/upgrade-scan/{v012,v015}`，
对每个补丁目标模式做「编译前形态存活检查」+ 源码结构 diff。

### 3.5.1 补丁命中复核表

| # | 目标包 | 目标模式 | v0.1.2 | v0.1.5 | 判定 |
|---|---|---|---|---|---|
| 1 | `bash-local` | `['bash','-c',spec.command]` | 2 处 | **2 处** | ✅ **形态稳定** |
| 2 | `bash-sandbox` | 同上 | 1 处 | 1 处 | ✅ 稳定 |
| 3 | `sandbox-local` | `selectRunner` | 2 | 2 | ✅ 稳定 |
| 4 | `tool-fs-search` | rg 调用 | 43 | 43 | ✅ 稳定 |
| 5 | `terminal-bash` | `DEFAULT_BASH_SHELL` / `/bin/bash` | 3 | 3 | ✅ 稳定 |
| 6 | `storage-json` | `fsyncDirectory` | 2 | 2 | ✅ 稳定 |
| 7 | `credentials-local` | `assertOwnerOnly` | 3 | 3 | ✅ 稳定 |
| 8 | `session-persistence-jsonl` | `syncDirPosix` | 5 | 5 | ✅ 稳定 |
| 9 | `session-persistence-jsonl` | `link()` 发布 | 3 | **5** | ⚠️ **需扩展**（见 F1） |
| 10 | `session-persistence-jsonl` | `win32` helper | 155 行 | **208 行** | ⚠️ 需复核（见 F3） |

**结论**：**8 个补丁形态稳定，2 个需要扩展。** 无一个补丁目标"消失"——
失败形态仍是构建期断言 throw（非静默），风险可控。

### 3.5.2 三个关键发现

#### F1 ⚠️ `link→rename` 补丁需扩展到新增的 `generation.ts`

`session-persistence-jsonl` 的源文件从 **6 个扩到 12 个**：

```
v0.1.2:  format.ts  index.ts  win32.ts  zstd*.ts
v0.1.5:  format.ts  index.ts  win32.ts  zstd*.ts
         + generation.ts        ← 新增：generation 发布机制
         + lease.ts             ← 新增：跨进程写所有权锁
         + migration-verifier.ts← 新增：迁移校验器
         + storage.ts  worker.ts  testing/
```

我方补丁只替换 `index.ts:1137` 的 `await link(tmp, finalPath);`，
但 v0.1.5 **新增了第二条发布路径**：`generation.ts:829` `await internals.fs.link(staged, currentPath)`。

**风险**：若 generation 是主发布路径，我方补丁会漏掉它 →
**Android SELinux 禁硬链接（EACCES）→ 无法落盘任何新会话**（与坑 #14 同款故障）。

**处理**：补丁必须**同时覆盖两处**，并在构建脚本中把断言数从 1 改为 2。

#### ✅ F1 实证补全（2026-09-10 心跳 40，基于真实 npm 产物）

安装 `0.1.5-rc.1` 后对**编译产物** `dsh-session-persistence-jsonl/lib/index.js` 逐行核对：

| 行 | 真实产物 | 我方旧补丁覆盖 |
|---|---|---|
| **4** | `import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";` | 目标字符串**仍在** ✓（但**不含 `rename`**） |
| **1602-1610** | `const defaultFileSystem = { ... lstat: ..., link, rm: ... };` ← **`link` 简写** | ❌ 未覆盖 |
| **2032** | `await internals.fs.link(staged, currentPath);` ← `publishCurrentExclusive()` 内 | ❌ **未覆盖（F1 真凶）** |
| **2973** | `await link(tmp, finalPath);` | ✅ 旧补丁命中（1 次） |

**`publishCurrentExclusive()` 的分支逻辑**（L2021-2040）：
```js
if (internals.platform === "win32") { await internals.publishNewWin32(...); }   // Windows 专用
try { await internals.fs.link(staged, currentPath); }                            // ← Android 走这里
catch (error) { if (isEEXIST(error)) return false; throw error; }
```
→ **Android（非 win32）必然走 `internals.fs.link`** → SELinux EACCES → 抛错。

**精确补丁方案（4 处，必须全改）**：

| # | 位置 | 改动 |
|---|---|---|
| 1 | L4 import | 加入 `rename`：`..., realpath, rename, rm, ...` |
| 2 | L1608 `defaultFileSystem` | `link,` → `link, rename,`（暴露给 `internals.fs`） |
| 3 | L2973 | `await link(tmp, finalPath);` → `await rename(tmp, finalPath);` |
| 4 | **L2032（新增）** | `await internals.fs.link(...)` → `await internals.fs.rename(...)` |

**构建脚本断言数**：`1 → 4`（原断言只查 `await link(tmp, finalPath);`，现需覆盖 4 个标记点）。

> **v0.1.2 对照**：旧版只有 L2973 一处 link 调用，故单点补丁够用；
> v0.1.5 引入 generation 机制后 link 出现 **3 个位置**（import / defaultFileSystem / 两处调用）。

#### F2 🆕 新增 `lease` 锁机制 —— 但设计上对我方友好

`lease.ts` 定义跨进程写所有权锁：

| 平台 | 机制 |
|---|---|
| POSIX | `flock(2)` on `session.lock`（**原生系统支持**） |
| Windows | 命名内核信号量（无锁文件） |

**正面**：源码明文「内核在 holder 的 descriptor 或最后一个 object handle 关闭时释放锁，**包括任何进程死亡**，
所以崩溃的持有者永远不会阻塞后继者」→ **我方 NodeService 3s 崩溃自动重启不会被残留锁卡住**（阶段 4 验证项降级）。

**新增待验**：`flock(2)` 是**原生系统支持**，Android bionic 是否提供？
README 提到「browser worker stubs the native flock entry」→ 说明存在 stub 机制。
我方已有同类先例（landlock-run / koffi stub）。**列为阶段 2 的 stub 清单新增候选。**

#### F3 ⚠️ win32 已内建原生 helper —— sim 补丁必要性待复核

`win32.ts` 从 155 → 208 行，`generation.ts:818` 调用 `internals.publishNewWin32(staged, currentPath)`。
说明官方已内建 Windows durable namespace helper。

我方现有 3 个 `DSHT-ANDROID-SIM` 补丁（storage-json / session-persistence / credentials-local）
是为「PC 上伪装 linux 做 android-sim 验证」而打。**升级后需复核这些补丁是否仍必要**——
若官方已修 win32 路径，部分 sim 补丁可以撤销（减少维护面）。

### 3.5.3 阶段 1 结论

- ✅ **升级可行性正面**：无补丁目标消失，8/10 形态稳定
- ⚠️ **2 个补丁需要扩展**（F1 必修、F3 待复核）
- 🆕 **1 个新 stub 候选**（F2 的 `flock` 原生入口）
- 📌 **阶段 2 新增必做项**：补丁数断言 `1 → 2`（F1）

**此阶段未产生任何设备改动，零风险。**

---

## 4. 五阶段执行计划

**核心原则：每阶段结束都有可验证产物，且可独立回滚。**

### 阶段 0 · 备份与冻结（前置，不可跳过）

```bash
# 设备全量数据备份（迁移不可逆）
adb shell "run-as com.dshtavern.app tar -czf /data/local/tmp/dsht-backup.tar.gz files/.dsh"
adb pull /data/local/tmp/dsht-backup.tar.gz "D:/DSH RolePlay/backup/dsht-0.1.2-pre-upgrade.tar.gz"
```
- [ ] 设备 `.dsh` 全量备份（sessions / rp / profiles / skills）
- [ ] 工作区 git 提交干净（当前 ✓）
- [ ] 记录当前 APK 指纹（x86_64 `198400887f68` / arm64 `fcb9f649f4cc`）
- [ ] **选定无重要进行中会话的窗口**

### 阶段 1 · 源码侧对齐与静态预检（不动设备，零风险）

- [ ] 源码仓库切到 `dsh-v0.1.5-rc.1` tag
- [ ] **逐个复核 11 个补丁点的正则命中**（对 0.1.5 源码跑断言，不实际打包）
- [ ] 复核 `patch-resilient-list.mjs` / Step 4.5 的目标文件形态
- [ ] 复核 `Session API` 变更对我方 `sessionEventAt`/`sessionEventsSnapshot` 适配器的影响
- [ ] 产出《补丁命中复核表》

**产物**：一份"哪些补丁会断、怎么修"的清单。**此阶段不产生任何设备改动。**

### 阶段 2 · 运行时升级（设备可回滚）

- [ ] `pnpm add @deepseek-ai/dsh@0.1.5-rc.1`（npm 已发布，`latest` 即此版本）
- [ ] 重新应用全部补丁（按阶段 1 的修正）
- [ ] 复核 stubs 六件套（包目录重组后路径可能变）
- [ ] PC android-sim 冒烟（`DSHT_ANDROID_SIM=1`，验证 runtime 能启动）
- [ ] **构建 APK 但先在模拟器用副本数据试**（不碰真机会话）

**产物**：能在模拟器启动、能打开新会话的 v0.1.5 运行时。

### 阶段 3 · 会话迁移验证（最高风险，单独隔离）

- [ ] 用**备份的会话副本**在模拟器上验证 v1→v2→v3 迁移
- [ ] 实测迁移耗时（12MB / 50MB / 214MB 三档）
- [ ] 验证迁移后：楼层数 / 变体组 / 回退 / 记忆注入 全部正常
- [ ] 验证自定义 `source.plugin` 通过校验
- [ ] **确认迁移失败的可恢复路径**

**产物**：迁移可行性结论 + 耗时数据。**若此阶段失败，回到 0.1.2-rc.1。**

### 阶段 4 · 功能回归与 D-4 重评

- [ ] 710 项单测（可能有断言需按新契约调整）
- [ ] 模拟器 CDP 全链路：会话 / 回退 / 变体 / 记忆 / 世界书 / 悬浮窗
- [ ] **重新评估 D-4**：`in-history` 是否解锁用户输入位置对齐
- [ ] 评估 `in-history` 启用路径（切成 `llm-deepseek` provider 的收益/成本）
- [ ] 真机 arm64 验证
- [ ] 双架构 APK 交付

---

## 5. 风险登记与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 会话迁移失败（封闭清单） | 中 | **高**（历史会话打不开） | 阶段 0 全量备份；阶段 3 用副本先验 |
| 迁移耗时不可接受（分钟级） | 中 | 中 | 阶段 3 实测；不可忍则暂缓或分批迁移 |
| 补丁正则失效 | **高** | 中 | 构建期 throw（非静默）；阶段 1 静态预检 |
| `convert-chat` 产出被 v3 拒 | **高** | 中 | 阶段 3 专项；可能改走官方 API |
| 我方解析器漏 `system/message` | 中 | 中 | 175 处逐个复核；单测覆盖 |
| `session-persistence-jsonl` 锁残留 | 低 | 中 | 阶段 4 实测 node 崩溃重启 |
| 性能回退（官方自述） | 中 | 中 | 阶段 3 实测；等下一版修复 |

**回滚路径**：阶段 1 无改动；阶段 2/3/4 回滚 = 恢复备份数据 + 重装 0.1.2 APK
（旧 APK 指纹已记录，`_pending-deploy` 保留）。

---

## 6. 待用户决策点

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| **A** | 升级时机 | ① 立即开始阶段 0-1（零风险）② 等 0.1.5 出正式版（非 rc） | **①** —— 阶段 0/1 纯静态、零风险，先跑 |
| **B** | 是否接受一次性会话迁移耗时 | ① 接受 ② 先只迁新会话，旧的留 v1 存档 | 待阶段 3 实测数据后再定 |
| **C** | `in-history` 是否启用 | ① 升级后独立评估 ② 现在就规划切 `llm-deepseek` | **①** —— 不与升级绑定，避免变量叠加 |
| **D** | D-6（31 个工具）是否随升级一并处理 | ① 一并 ② 分开 | **②** —— 升级已够大，一次只动一个变量 |

---

## 7. 与 MASTER_TODO 的对应

- 本方案覆盖 `MASTER_TODO.md` 中「DSH 0.1.3-alpha.1 侦察（用户裁决：暂不升级）」条目的**解冻**
- 升级完成后，`§2.2b D-3` 的验证方式应更新为"Web 上可直接检视 system 提示词卡片"
- `D-4` 状态从「核心约束不可达」改为「待 `in-history` 评估」

---

## 附录 A：会话格式迁移链实证（2026-09-10 心跳 41）

### 版本事实
| 项 | 值 | 证据 |
|---|---|---|
| **0.1.5 目标格式** | **v3** | `dsh-session/lib/index.js:56` `const SESSION_FORMAT_VERSION = 3;`<br>`dsh-session/lib/types/types.d.ts:54` |
| **我方现役会话** | **v0** | `tmp/active-session.jsonl` 首行 `{"type":"session","version":0,...}`<br>（`session-7973a03e` / `session-5f4414a8` 两个真实会话均为 v0） |
| 官方测试快照 | v0 | `deepseek-harness/apps/web/tests/snapshots/*/session.jsonl` 17 个全为 v0（旧格式样本，用于测试迁移器） |

### 迁移链
```
我方 v0  ──sessionFormatV0ToV1──▶  v1  ──sessionFormatV1ToV2──▶  v2  ──sessionFormatV2ToV3──▶  v3
```
三个迁移器包均已就位（`dsh-session-format-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3`），
由 `dsh-session-format-catalog` 统一编排：

```js
// dsh-session-format-catalog/lib/index.js
import { releasedV0SessionFormatCodec, sessionFormatV0ToV1 } from "@deepseek-ai/dsh-session-format-v0-to-v1";
import { releasedV2SessionFormatCodec, sessionFormatV1ToV2 } from "@deepseek-ai/dsh-session-format-v1-to-v2";
import { assertReleasedV3Header, sessionFormatV2ToV3 } from "@deepseek-ai/dsh-session-format-v2-to-v3";
```

### 严格校验（准入失败即拒绝，不静默降级）
```js
// catalog 内的两处断言
`installed Session format is v${SESSION_FORMAT_VERSION}, got v${header.version}`
`installed Session format is v${SESSION_FORMAT_VERSION}, got v${artifact.header.version}`
```
→ 若迁移产物版本不等于 3，**直接 throw**（不会带病运行）。这是我方必须实测的第一判据。

### 对我方的影响（阶段 3 验证项）
1. **迁移是一次性还是每次**：取决于是否就地发布 v3 generation（走 `publishCurrentExclusive`）
2. **耗时**：三段串行迁移，需实测 12MB / 50MB / 214MB 三档
3. **自定义 source.plugin 是否过 v3 校验**：`source.plugin: 'dsht-rp'` 等值须实测
4. **我方 3 个解析器**（rollback-mask / extractFloors / collectVariantGroups）在 v3 文件上的行为

---

## 附录 B：`text-chunks` 兼容性实证（2026-09-10 心跳 41）—— ✅ 风险解除

### 背景
我方会话事件类型分布（`session-7973a03e`，472 行 / 20 种类型）显示存在两个"非白名单"类型：
| 类型 | 数量 |
|---|---|
| `assistant/chunk` | 104 |
| `text-chunks` | 5（`session-test` 里 273 个） |

`text-chunks` 行的字段是 `seq0` / `time0`（而正常事件是 `seq` / `time`），初看像数据损坏。

### 追查结论：**不是损坏，是宿主的聚合打包格式**

**证据链**：
1. **来源**：`packages/src/dsh-plugin/index.ts:650-676`
   > 宿主网关（dsh-session-persistence-jsonl）的加载语义：每行先 JSON.parse → decodeStorageRecord——
   > 只认 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 三种聚合 tag 展开
   > （子事件 `seq = seq0 + k`、type 统一 `assistant/chunk`、data 仅 `{turn, step, chunk}`）

   我方 `decodeStorageLine` / `packEventRows` 是**宿主语义的复刻**（用于修复产物）。

2. **0.1.2 的宿主确实有**：`dsh-session-persistence-jsonl/lib/index.js:322`
   ```js
   decoded = decodeStorageRecord(expandProvenanceFromStorage(JSON.parse(line)))
   ```
   其 API 从 `dsh-session` 导入 `packChunkRuns`（写入聚合）+ `decodeStorageRecord`（读取展开）。

3. **0.1.5 已移除该机制**：
   - `dsh-session` 0.1.5 的导出清单里**没有** `packChunkRuns` / `decodeStorageRecord`
   - `session-persistence-jsonl` 改为 `decoded = JSON.parse(line)` + `assertV3RowAdmission(decoded)`

   → 表面看 `text-chunks` 行会变成 opaque 事件、文本内容丢失。

4. **✅ 但迁移器有补偿**：`dsh-session-format-v0-to-v1/lib/index.js`
   ```js
   const PACKED_TAGS = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);   // L1611-1613
   // L1817-1824：展开为逐事件 chunk
   const chunk = stream["type"] === "text-chunks"
       ? { type: "text-delta", index: stream["index"], text: member } : ...
   ```

**完整链路**：
```
0.1.2 写入 text-chunks 聚合行
   ↓
0.1.5 加载 → 迁移器 v0→v1 先展开 PACKED_TAGS → 逐事件 assistant/chunk
   ↓
v1→v2→v3 规范化
   ↓
assertV3RowAdmission 校验（此时已是合法事件）✓
```

### 附带确认：v3 准入校验的宽容度
```js
// dsh-session-format-v2-to-v3/lib/index.js
function assertV3EventAdmission(event) {
  if ((event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch")
      && event.ignorable !== true) throw new SessionFormatUnsupportedMigrationError(...)
}
function assertV3StructuralRow(value) {
  if (row.type === "request/header") { /* 拒绝退役的 header.system */ }
  else if (row.type === "system/message") { /* 校验结构 */ }
}
```
→ **只拒绝 2 个特定类型** + `request/header` 的退役字段，其余类型走 "opaque" 路径。

**结论：`text-chunks` 兼容性问题不存在，迁移链可通行。** 该类型无需我方做任何适配。

---

## 附录 C：`in-history` 机制实证与 D-4 重评（2026-09-10 心跳 41）

### 机制（源码级）
```js
// dsh-agent-loop/lib/index.js
var SystemPromptProjection = class {
  systemNodes() {                      // 扫描 surface 上存活的 system/message 节点
    for (const seq of this.session.surface.nodes) {
      const event = this.session.eventAt(seq);
      if (event?.type !== "system/message") continue;
      ...
    }
  }
  project(rendered, input) {
    const nodes = this.systemNodes();
    const head = nodes[0];
    if (head === void 0) return [{ message: createSystemMessage(rendered, SOURCE),
                                   intent: { surfaceOp: "append" } }];
    const latest = nodes.findLast((node) => node.text !== "") ?? head;
    if (!input.inHistory || input.startsSeries || rendered.length === 0) {
      // 替换模式：清空后续节点 + 重写头节点
    }
    // 否则（inHistory && 延续序列）：追加新节点
  }
};

// L1020：能力来源
inHistory: preparedCall?.systemPromptUpdate === "in-history"
```

| 模式 | 条件 | 行为 | 前缀缓存 |
|---|---|---|---|
| **替换** | `!inHistory` 或 `startsSeries` 或 渲染为空 | 清空后续 system 节点 + 重写头节点 | 从首 token 失效 |
| **追加** | `inHistory && 序列延续` | 在该步骤 user/message 之前追加新 `system/message` 节点 | **保持热态** |

### 对我方 D-4 的重新评估

**D-4 原判**：「用户输入绝对位置由 `deriveMessages()` 决定，TT 结构无法复现 → **核心约束不可达**」

**0.1.5 改变了什么**：
1. system prompt 从「header 里的隐式文本」→「surface 上的 `system/message` 节点」
2. 节点可被**追加在历史的任意位置**（in-history 模式）
3. → 理论上可以让「系统内容 cluster + 末尾用户输入」这种 TT 结构**成为可表达的形式**

**但两点限制必须先说清**：
| 限制 | 说明 |
|---|---|
| **仅在 `llm-deepseek` 路由生效** | `llm-pi-ai` 路由全部保持替换行为（`llm-deepseek/README.zh.md:163`）；我方当前走 pi-ai |
| **`deepseek-v4-flash` 需显式声明** | 只有默认 `deepseek-flash` 条目声明了 `in-history`（`llm-deepseek/src/index.ts:100`），其他模型须显式配置 |

**结论**：D-4 **从「不可达」升级为「有条件可达」**。解锁路径是**两步独立决策**：
1. 升级到 0.1.5（本方案）
2. 切换到 `llm-deepseek` 路由 + 显式声明 `models: [{ id: "deepseek-v4-flash", systemPromptUpdate: "in-history" }]`

**建议**：不在升级窗口内做第 2 步（变量叠加会导致无法归因）。升级稳定后单独评估。
