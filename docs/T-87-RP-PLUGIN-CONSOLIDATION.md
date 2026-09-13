# RP 插件整合方案（T-87 · 只出方案，未动代码）

> **状态**：📋 **方案待拍板**。本文档只做分析与规划，**未修改任何插件代码**（用户 2026-09-13 明确选择"暂不动代码，只出方案"）。
> **触发**：用户提出「把 roleplay 部分整合成一个插件是很有必要的」，并核查「DSH 安卓化 + RP 插件化」是否成立。
> **心跳 76 修订（重要）**：用户澄清了真实诉求 ——
> ① **termux/安卓化那部分不进 RP 整合插件**（"DSH 封装 termux 实现安卓化的这一部分不用做进我们的那个 roleplay 整合插件里面"）；
> ② 要的是**一个总的 RP 插件** —— "所有和 roleplay 相关的个性化改动都是插件化的" ⇒ 应汇总为一个；
> ③ 目的是**两端都受益**：PC 端导入一个插件就能用；手机端插件管理界面不至于"上百个插件"。
> ⇒ 本轮**推翻并重做**了原方案（原方案只并 4 个 R10 插件、且判定"界面条目数几乎不变"）。
> **建立**：2026-09-13（心跳 76）。

---

## 一、先纠正一个此前的**关键误判**

原方案（本文件上一版）声称：「合并只减少 4~5 个条目，界面依旧上百 ⇒ 用户诉求不被满足」。
**该结论建立在错误的前提上** —— 它把「插件列表条目数」当成了官方 135 行 + 我方 6 行 = 141 的算术。
但**用户看到的是「我方插件」那一组**，而不是整个官方 141 行。实测数据如下。

### 1.1 插件管理界面的**真实构成**（实测）

「设置 → 插件」的数据源是 **cordis Loader 的 entries**（`host/plugin-inventory/src/index.ts:57-69`：
`for (const entry of this.ctx.loader.entries())`，跳过 `group` 行，**1 row = 1 条目**）。

| 来源 | 行数 | 说明 |
|---|---|---|
| 官方 `@deepseek-ai/dsh-base` 的 `cordis.patch.yml` | **84**（设备实测 `grep -c "id:"`） | 官方基础层，**不可动**（合规红线：官方源零修改） |
| 官方 `@deepseek-ai/dsh-web-app` 的 `cordis.patch.yml` | **94**（设备实测） | 官方 web 层，**不可动** |
| 我方 `cordis.patch.yml`（`NodeService.pluginRows`） | **6** | `dsht-rp` / `dsht-mvu` / `dsht-tavern-helper` / `dsht-prompt-template` / `dsht-mobile` / `dsht-memory` |

> ⚠️ 官方两层的 84 + 94 中，大部分是 **id-targeted 覆盖行**（`- id: xxx` 改配置）而非新增；真正的新增 insert 在归档源码里数得 **78 + 57 ≈ 135**。设备上 `grep "id:"` 数到 84/94 是含覆盖行的粗数。
> **但这对本方案不重要** —— 关键事实是：**那 ~135 行是官方的，我们不能碰**（碰了就违合规红线）。

### 1.2 那么用户说的"上百个插件"是什么？

我方 UI 自己写下了这个数字（`dsht-rp-ui/src/client/MigrationStatusPanel.tsx:154`）：
> 「系统「设置 → 插件」的全部插件列表里有 **170+ 个插件**，搜索 dsht 即可找到上面三个」

⇒ 用户看到的就是**整个 Loader entries 列表**（官方 + 我方混在一起）。**"上百个"里 ~135 个是官方自己的**，我方只占 6 个。

### 1.3 由此得出的**诚实的边界**

| 目标 | 能否通过"合并我方插件"达成 |
|---|---|
| PC 端导入**一个**插件就能用 RP 功能 | ✅ **能**（我方 6 包 → 1 包 + 1 行 patch） |
| 手机端**插件管理界面不再上百个** | ❌ **不能**（那 ~135 行是官方的，我方从 6 降到 1 只减少 5 个条目） |
| 但：**我方插件在列表里从 6 行变 1 行** | ✅ 能（"搜 dsht 只找到 1 个"） |

> **必须如实告知**：用户的第三个诉求（界面不至于上百）**不可能靠合并我方插件实现**，因为那上百个条目绝大多数来自官方。若真要"界面清爽"，可选的是：
> (a) 给我方不关心的**官方行**加 `disabled: true` —— **但这会改变官方行为，风险高且违"官方源零修改"精神**（虽然 patch 层允许，但禁用官方功能不属于我们的职责）；
> (b) 接受现状（官方行是官方功能，用户需要时还得用）；
> (c) 我方**自建一个"RP 插件"专属面板**（已部分存在：`PluginCards.tsx` 的 4 张设置卡），让用户不必去官方列表里找。
> 这一条**需要用户拍板**（见 §7）。

---

## 二、用户澄清后的**正确目标定义**

| # | 目标 | 判定 |
|---|---|---|
| **G1** | **安卓化部分（termux/proot/平台补丁/preflight）不进 RP 整合插件** | ✅ 同意且本来就是这么设计的 —— 它们不在 `packages/src/dsh-plugin*` 里，而在 `android/`（Kotlin 壳）+ `scripts/apply-platform-patches.py` + `dsht-preflight`。**它们不会被并进任何插件包** |
| **G2** | **所有 RP 相关插件汇总成一个总插件** | ✅ 应做。当前 RP 相关 = `dsht-rp-plugin`（主包）+ 4 个 R10 插件 = **5 个包** |
| **G3** | PC 端"导入一个插件就能用" | ✅ 应做。需 ① 合并成 1 个包；② 补 `dsh.bundle.patch` 声明（这样 `dsh plugin add` 自动进 profile 层栈） |
| **G4** | 手机端插件管理界面少一些我方条目 | ⚠️ **部分可达**：我方 6 → 1（"搜 dsht 只有 1 个"）；但整体"上百"无法消除（官方占绝大多数） |

### 关于 `dsht-plugin-mobile` 的归属（用户澄清后需重判）

按用户"**安卓化那部分不进 RP 整合插件**"的原则，`dsht-plugin-mobile` 是**移动端适配**（`build-dsht.ps1:486-487` 明写"不依赖 dsht-rp，任意 DSH 部署可独立生效"）⇒ **属"安卓化"而非"RP"** ⇒ **应保持独立**，不并进总插件。
（连带影响：PC 用户拿不到它 —— 但 PC 本来就不需要竖屏适配。）

---

## 三、方案（修订版）

### 推荐：**新建一个总包 `dsht-rp`，把 5 个 RP 包合并进去**

| 项 | 内容 |
|---|---|
| **并入的包** | `dsht-rp-plugin`（主包，含 host + client 双面）+ `dsht-plugin-mvu` + `dsht-plugin-tavern-helper` + `dsht-plugin-prompt-template` + `dsht-plugin-memory` |
| **不并入的包** | `dsht-plugin-mobile`（属安卓化/移动端适配）· `dsht-preflight`（壳侧预加载，非 cordis 插件）· `dsht-plugin-undo`（已被主包取代） |
| **结果** | 我方 `cordis.patch.yml` 从 **6 行 → 2 行**（`dsht-rp` 总包 + `dsht-mobile`） |
| **为什么新建而非并入主包** | `dsh-plugin/index.ts` 已 **7851 行**；再并 4 个插件（+约 3000 行）会破万行，维护性更差。新建总包 = 一个 `index.ts` 薄壳，内部 import 5 个子模块的 `apply` |
| **包名** | 建议 `dsht-rp`（id 已是 `dsht-rp`，包名沿用便于对照）；或用户指定 |

### 合并的**技术障碍清单**（逐项已取证，均**可解**）

| # | 障碍 | 判定与解法 | 证据 |
|---|---|---|---|
| B1 | **`inject` 并集** ⇒ 缺 `llm`/`agentDefaultModel` 会让 MVU/TH/EJS 一起 PENDING | **可解**：Cordis 的 `inject` 是**必需**服务；可选服务改用 `ctx.get(name)`（官方惯例）。现状 memory 已用 `ctx.settings?.get?.` 与鸭子接口 | `dsh-plugin/index.ts:241` 注释「未 inject 的服务属性读取直接 throw」；`deepseek-harness/packages/AGENTS.md:6`「Optional services use ctx.get(name)」 |
| B2 | HTTP 路由前缀冲突 | **不存在**：`/dsht-rp`、`/dsht-mvu`、`/dsht-tavern-helper`、`/dsht-prompt-template`、`/dsht-memory` 互不为前缀；webserver 只在**同 (kind,path)** 重复时抛错 | `host/webserver/src/index.ts:94-100`；`dsht-plugin-shared/http.ts:86-114`（`registerPrefix` 可多次调用） |
| B3 | **设置命名空间**重复注册会抛 | **可解且必须保留原 4 个 ns 字符串**（`'dsht-plugin-mvu'` 等）⇒ 不触发重复抛错、旧用户 `settings.yaml` 键不丢、UI 无需改 | `dsh-settings/lib/index.js:281-297`（同 ns 二次注册抛）；`NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/` |
| B4 | UI 按包名硬编码 | **可解且无需改 UI** —— `PluginCards.tsx`/`probes.ts` 用的是**字符串常量 + HTTP 路由**，与**包边界无关**（只要保留 ns 字符串与路由） | `PluginCards.tsx:446-459`、`:469-474`；`probes.ts:71-104`；`dsht-rp-ui/src/client/index.tsx:408-418` |
| B5 | **`agent/pre-step` 双监听器**的 waterfall 嵌套顺序会改变 messages 组合 | **可解，但必须显式固定注册顺序并回归验证**。现状顺序由 patch 行顺序决定（`dsht-rp` 先 ⇒ 主包在外层） | `vendor/cordis/src/events.ts:225-243`（`:238` 先注册者先执行、包在外层）；主包 `:3958`、memory `:721` |
| B6 | `tools.register` / `systemPrompt.section` 冲突 | **不存在**：全仓仅主包有（各 5 处），4 个 R10 插件零命中 | `dsh-plugin/index.ts:3464-3642`（section）、`:3469-3642`（tools） |
| B7 | 浏览器侧 / boot graph | **无影响**：4 个 R10 插件无 client 面；只有主包与 mobile 是双面 | `NodeService.kt:376-378`（主包双面）、`:392-394`（mobile） |
| B8 | **模块级单例语义变化**：`shared/macros.ts` 的 `hydrateCustomMacros` 全局表由"两份"变"一份" | **可解，需行为回归验证**。现在 mvu 与主包各持一份独立 bundle；合并后只有一份 | `dsht-plugin-mvu/index.ts:24,155-161` 与 `dsh-plugin/index.ts:50` 同时 import 该模块 |
| B9 | **`ejs-worker.js` 路径耦合**（合并后路径变为 `<总包>/lib/ejs-worker.js`） | **可解**：构建脚本 + `NodeService.copyPackage` 同步（**本轮已修后者**，见 T-89） | `prompt-template/index.ts:42-43`；`build-dsht.ps1:452` |
| B10 | 主包 7851 行继续膨胀 | **可解**：新建独立总包，不并入主包 | — |
| B11 | **6~9 处构建/部署/验证锚点需同步** | **可解，工作量大**：`NodeService.kt`（pluginRows / prune 名单 / copyPackage 循环）、`build-dsht.ps1`（R10 循环 + ejs-worker）、`build-plugins.sh`、`build-wb.sh`（A8 存在性 + A14）、`rebuild-plugins.ps1`、`setup-pc-verify.mjs`、`audit-artifact-freshness.mjs` | 各文件行号见 §5 |
| B12 | **丧失单插件灰度**（无法单独注释掉剧情记忆） | **机制上不可解**（除非总包内做运行时开关）。⚠️ 剧情记忆是**用户点名要的功能**（`memory/index.ts:4-5`） | — |

### 落地步骤（建议分两步，每步独立可验）

**第 1 步：合并 5 个 RP 包 → `dsht-rp`（单包双面）**
1. 新建 `packages/src/dsht-rp/index.ts`：`export const name = 'dsht-rp'`；`inject` 取并集（**可选服务用 `ctx.get`**）；`apply(ctx)` 内**按固定顺序**调用 5 个子模块的 apply（**顺序必须与现 patch 行顺序一致**，见 B5）。
2. 子模块改造：把各自的 `export const name/inject` 降为内部使用；`apply` 改为可被外部调用（保留原函数，仅不再作为包入口导出）——**最小改动**，避免触碰子模块内部逻辑。
3. 浏览器侧：`dsht-rp-ui` 的 `client.js` 照旧并入总包（`build-rp-ui.mjs:211` 的 banner id 改为 `dsht-rp`）。
4. 构建脚本：`build-dsht.ps1` 的 Step 4.7/4.72/4.75 合并为一个 Step；`ejs-worker.js` 打到总包 `lib/` 下。
5. `NodeService.kt`：`pluginRows` 6 → 2 行；`pruneRuntimePluginCopies` 名单更新。
6. **验收**：① A14 闸门新增总包配对；② 实机：5 个功能域端点全通（`/dsht-rp/*`、`/dsht-mvu/*`、`/dsht-th/*`、`/dsht-ejs/*`、`/dsht-memory/*`）；③ `agent/pre-step` 顺序回归；④ 4 张设置卡仍在。

**第 2 步：补 `dsh.bundle.patch` 声明（PC 一键安装的前置条件）**
- 给总包加 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` + 一个自带 `cordis.patch.yml`（含 `- insert:` 行）。
- 这样 `dsh plugin --profile web add <包>` 会**自动**把该行加进 `dsh.profile.bundles` 层栈（官方机制，先例：`packages/subagent/subagent-codex/package.json:35-39`）。
- **验收**：PC 干净环境执行 `dsh plugin add` ⇒ 插件列表出现且功能可用，**无需手改 cordis.patch.yml**。

---

## 四、`dsht-preflight` 缺陷的**核查结论（本轮已完成）**

> 用户在本次提问中要求「验证一下到底是不是缺陷，是的话该怎么修」。

**结论：是真实缺陷，已修复。**

| 项 | 内容 |
|---|---|
| **是不是缺陷** | ✅ **是**。`build-dsht.ps1` 全文 grep `dsht-preflight` **零命中** —— 它**从不构建 preflight**；而 `dsht-preflight` 只在 `build-plugins.sh`（`[4b/7]`）里构建，那条路径**只有 `build-wb.sh` 会调**。 |
| **为什么危险** | `build-dsht.ps1` 的非 `-SkipInstall` 分支会 `Remove-Item $runtimeDst -Recurse -Force`（:`105`）⇒ **整份 runtime 重建后 preflight 不存在** ⇒ `NodeService` 的 `preflightOption()` 返回空串 ⇒ **预检防线静默失效**（fail-open 设计：app 照起，但 crash-loop 防线为空）。 |
| **为什么长期没被发现** | ① `build-wb.sh` 的 A8/A9 断言**只覆盖 build-wb 路径**，ps1 路径零断言；② `-SkipInstall` 时若 staging 里已由 build-wb 留下该包，则侥幸可用 ⇒ 只在"完整重装"时才暴露。 |
| **实证** | 把 `dsht-runtime-android/node_modules/dsht-preflight` 移走（模拟完整重建后的状态）⇒ `A8 判据 [ -f .../dsht-preflight/lib/index.js ]` **= false** ⇒ 确证。 |
| **修复** | ① `build-dsht.ps1` 新增 preflight 构建步骤（形态与 `build-plugins.sh` 的 `build_node_plugin` 一致）+ 产物抽验（`sessions-quarantine` / `DSHT_PREFLIGHT_DISABLE` 两个标识符）；② 新增 **A8ps1 / A9ps1** 断言（产物存在 + `NodeService.kt` 有 `dsht-preflight` 与 `--import`）。 |
| **验证** | 按脚本内命令手工执行 ⇒ 产物 10511 B、两个标识符齐备。 |

### 连带修复的第二个缺陷：`ejs-worker.js` 不在拷贝清单里（T-89②）

| 项 | 内容 |
|---|---|
| **症状** | `prompt-template` 的 EJS worker 是**独立 bundle**（`lib/ejs-worker.js`），由 `prompt-template/index.ts:42-43` 用 `join(dirname(import.meta.url), 'ejs-worker.js')` 定位；而 `NodeService.copyPackage` **只拷 `lib/index.js`** ⇒ **代码里没有任何一步会拷它**。 |
| **实证（两条，别混淆）** | · **代码层**：`git log -S'ejs-worker' -- NodeService.kt` **零命中** ⇒ 从未被本代码拷贝过；<br>· **设备层**：设备上**有** `lib/ejs-worker.js`（27024 B、**09-08**），而 staging 是 **27122 B（09-13）** ⇒ 那是**来源不明的历史残留**（推测早期手工 `adb push`），**版本落后 5 天**。 |
| **性质** | 我方主力缺陷族（**静默降级**）：机理是"**装不上新的**"而非"从来没有" —— 新装机/升级后 profile 侧那份陈旧副本**永远不会被更新**。worker 与 `index.js` 协议一旦不匹配，`new Worker(...)` 抛错被 catch 吞掉、`done(null)` ⇒ **静默退化为同步渲染**（失去 6s 超时与"不阻塞主线程"）。 |
| **修复** | ① `NodeService` 增加 `ejs-worker.js` 拷贝（纳入幂等比对 ⇒ 27024 → 27122 的更新会被自动推上去）；② `copyPackage` 增加"源产物不存在 ⇒ 显式跳过并出声"分支 —— **必须**：否则 `srcFile.length()` 为 0 会触发 copy 抛异常，而该异常被 `ensureRpPluginPatch` 的整体 catch 吞掉 ⇒ **后续所有插件都装不上**（静默）。 |
| **验证状态** | ⚠️ **设备端验证未做**（需装新 APK 或手工推一份才体现）；当前仅代码修复 + Kotlin 编译通过。 |

---

## 五、需同步的锚点清单（实施时的检查单）

| 文件 | 位置 | 改什么 |
|---|---|---|
| `android/.../NodeService.kt` | `:411-418` `pluginRows` | 6 行 → 2 行 |
| 同上 | `:563-567` `pruneRuntimePluginCopies` 候选名单 | 去掉已并入的包名 |
| 同上 | `:386-397` `copyPackage` 循环 | 改为总包 |
| `scripts/build-dsht.ps1` | `:404-480` Step 4.7/4.72/4.75 | 合并为一个 Step |
| `scripts/build-dsht.ps1` | `:452` ejs-worker | outfile 改到总包 `lib/` |
| `scripts/build-plugins.sh` | `:50-114` | 同上 |
| `scripts/build-wb.sh` | `:81-84`（产物存在性）、`:228-242`（A14） | 包名列表 |
| `scripts/rebuild-plugins.ps1` | `:63-65`、`:133` | 同 上 |
| `scripts/setup-pc-verify.mjs` | `:16`、`:26-31`、`:44-56` | PC patch 行 |
| `scripts/audit-artifact-freshness.mjs` | `PAIRS` | 新增总包配对、移除已并入项 |

---

## 六、与「PC 端只导入一个插件」相关的两条**独立事实**（与是否合并无关）

1. **官方没有插件市场**：唯一入口是 `dsh plugin --profile <n> add <pkg>`（pnpm 转发，`apps/cli/src/plugin.ts:120-141`）。
2. **要"装一个就自动生效"，包必须声明 `dsh.bundle.patch`**（先例：`packages/subagent/subagent-codex/package.json:35-39` + `apps/cli/src/plugin.ts:36-45,:59-91`）。我方包目前都没有该声明 ⇒ 这是「PC 一键安装」的**前置技术条件**。

---

## 七、待你拍板的点（修订版）

| # | 问题 | 我的建议 | 不定会怎样 |
|---|---|---|---|
| **D-9a** | **是否实施第 1 步**（合并 5 个 RP 包 → 一个总包 `dsht-rp`）？ | **倾向做**。这是你 G2/G3 的直接落地；技术障碍 12 项**均有解**（§3 表），最需注意的是 B5（`agent/pre-step` 顺序）与 B12（丧失单插件灰度）。工作量集中在构建脚本与 NodeService 的锚点同步 | 维持现状（功能正常），但"PC 导入一个插件"无法达成 |
| **D-9b** | **`dsht-plugin-undo` 的去留**：(a) 删除源码 / (b) 保留供 PC 副本与其他 DSH 部署用 / (c) 维持现状 | 倾向 **(c)**：它已被主包取代（client 面退役为空壳），但 `docs/SYNC-PC-COPY-RULE.md:3` 记录它是 PC 副本唯一同步对象。若实施第 1 步，它**不在**并入名单 | 不产生故障（该包不 compose，`/dsht-undo/*` 404 属预期） |
| **D-9c** | 是否**同时**做第 2 步（补 `dsh.bundle.patch`）？ | **倾向做**。这是"PC 一键安装"的关键 | PC 用户必须手改 `cordis.patch.yml`（对非技术用户不可行） |
| **D-9d** | **"手机端界面不至于上百"这个诉求怎么处理**（我实测确认：那 ~135 行是官方的，合并我方插件只减少 5 个条目） | **需你选**：(a) 接受现状（官方行是官方功能）；(b) 我方提供一个**专属 RP 面板**（已有 4 张设置卡的基础），引导用户不必去官方列表；(c) 给我方不关心的官方行加 `disabled: true`（**我不建议** —— 改官方行为、风险高） | 若目标是"界面清爽"，仅合并我方插件**无法达成**，需明确采用 (a)/(b)/(c) 之一 |
| **D-9e** | **总包的包名**（建议 `dsht-rp`）与 **id**（建议 `dsht-rp`） | 建议沿用 `dsht-rp`，便于与现有 id 对照 | 无 |
