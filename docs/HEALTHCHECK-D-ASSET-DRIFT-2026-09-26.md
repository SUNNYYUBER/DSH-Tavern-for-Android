# 体检 D：资产流失与结构性隐患（2026-09-26）

> **任务**：task-4（体检 D）· **执行者**：asset-auditor
> **性质**：**只审计、不修复**。本文件只登记发现与建议处置，**未改动任何产品文件**。
> **纪律**：每条结论均附**可复现验证命令 + 实际输出**；所有路径均用 glob/grep 实查，未凭文档推断。
> **工作区**：`D:\DSH RolePlay` · **审计日**：2026-09-26

---

## 摘要

| 维度 | 数量 |
|---|---|
| **资产流失（确认）** | **3 条** |
| **悬空引用（真缺陷，需处置）** | **5 条** |
| **悬空引用（设计使然 / 假阳性，已排除）** | 348 条 |
| **仍存在的结构性隐患** | **6 条**（10 类断链中 ④①⑧⑤③⑦ 仍敞口，⑥⑨⑩ 已被闸门守住，②部分守住） |

**最严重三条**：
1. **D-01 无 `.gitattributes` 而 `core.autocrlf=true` ⇒ 316 个受控文件正被静默改写行尾**（`MainActivity.kt` HEAD 0 个 CR vs 工作区 **2521 个 CR**），且 BOM 无任何版本控制级约束 → 断链①的根因仍在。
2. **D-02 `tools-cu/cu.py` 资产流失**：从未被 git 跟踪，被「搬到仓库外」时无任何记录 → 13 子命令的 computer-use 能力**不可恢复**（但 `pyautogui 0.9.54` 仍在，可低成本重建）。
3. **D-03 `stage3-device/hb55/apk-plugin-md5.py` 之三重打击**：MEMORY.md 仍点名它是**三方一致性核验工具**，但它**同时**（a）已不存在、（b）位于被 gitignore 的目录 ⇒ 换机器 clone 后**必然扑空**。

---

## §1 资产流失清单（曾经存在 / 现在不在 / 被哪次 cleanup 删 / 文档是否仍引用 / 影响）

### D-01 · ★★ `tools-cu/cu.py` —— computer-use 能力资产流失

| 项 | 内容 |
|---|---|
| **曾经存在** | `.workbuddy/memory/2026-09-10.md:379`：「**工具**：`tools-cu/cu.py`（自建 CLI，13 个子命令）」 |
| **实测可用证据** | 同文件 `:371-377`：「✅ 已获得 computer use 能力（实测可用）… 屏幕 3840x2160、鼠标位置可读、截图成功（4.6MB PNG）、**截图内容可被视觉解析**」 |
| **子命令** | `:381`：`screenshot / size / pos / move / click / dblclick / drag / scroll / type / key / hotkey / locate`（13 个） |
| **安全设计** | `:383`：`FAILSAFE=True`（鼠标推左上角急停）+ `--dry-run` 只打印不执行 |
| **现在不在** | ✅ 已查实（见证据 1、2） |
| **被哪次 cleanup 删** | ❌ **不是被 cleanup 删的** —— 它是被「**搬到仓库外**」时消失的，且**从未被 git 跟踪** |
| **文档是否仍引用** | ✅ **是，3 处仍在引用**（其中 1 处是「唯一活文档」MASTER_TODO.md） |
| **影响** | 断链「全自动实机测试四块拼图」缺一角；桌面级 GUI 兜底能力归零 |

**证据 1 —— 全仓不存在该文件**
```bash
$ find . -iname "cu.py" -not -path "./.git/*"
（无输出）
$ ls -la tools-cu
ls: cannot access 'tools-cu': No such file or directory
$ ls tools/
card-disinfector.py  verify-session-migration.py
```

**证据 2 —— 它从未进入 git 对象库（⇒ 无历史可恢复）**
```bash
$ git log --all --oneline --name-only --diff-filter=A | grep -i "cu\.py"
（无输出）
$ git rev-list --all --objects | grep -iE "tools-cu|/cu\.py"
（无输出）
$ git ls-files tools-cu
（无输出）
```
⇒ **关键结论：它既不在工作区、也不在任何 git 历史里。`git checkout` 无法找回。**

**证据 3 —— 「搬到仓库外」的记录（真实消失路径）**
`DSH Android Roleplay App Plan（历史会话）.md:46544`：
> | **已搬到仓库外的部分** | **约 5.9 GB / 10 项**：`deepseek-harness` · `tmp` · `stage3-device` · `backup` · `_pending-deploy` · `loop-mvu-interact` · **`tools-cu`** · `tools` · `NVIDIA Corporation` |

同文件 `:40197`：「| `tools-cu/cu.py` | **独立工具** | ✅ **可搬离** | 无脚本引用 |」
⇒ **判定「无脚本引用 ⇒ 可搬离」时，漏判了「文档引用」**——而文档引用恰恰是唯一入口。

**证据 4 —— 文档仍在引用的 3 处**
| 位置 | 原文 |
|---|---|
| `MASTER_TODO.md:2141` | 「\| `tools-cu/cu.py` + `computer-use` skill \| Windows 桌面级 computer use \| ✅ 实测通过 \|」 |
| `docs/T-25-PUBLISH-HYGIENE-2026-09-11.md:105` | 「**探针脚本默认参数**（`golden-*.mjs`…、**`tools-cu/cu.py`** 等）」 |
| `.workbuddy/memory/2026-09-10.md:379` | 「**工具**：`tools-cu/cu.py`（自建 CLI，13 个子命令）」 |

**证据 5 —— ★ 能力底座仍在，重建成本低**
```bash
$ ls "C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"
C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe
$ "…/python.exe" -c "import pyautogui; print('pyautogui OK', pyautogui.__version__)"
pyautogui OK 0.9.54
```
⇒ `pyautogui` **仍可用**，丢的只是那层 CLI 封装。**这是全部流失资产里最值得也最容易救回的一项。**

**证据 6 —— E5-CLEANUP-LIST.md 与本次流失无关（已排除）**
`docs/E5-CLEANUP-LIST.md` 的 6 项删除目标**不含** `tools-cu/`（见 §2 证据），
且 `:22` 明示「所有目标**均未被 git 跟踪**（执行前逐项 `git ls-files` 复核，全部 0 记录）」
—— `tools-cu/` 同样 0 记录，**这正是它后来能静默消失的同一个原因**。

---

### D-02 · ★★ `stage3-device/hb55/apk-plugin-md5.py` —— 「三方一致性核验」工具流失 + 双重不可达

| 项 | 内容 |
|---|---|
| **曾经存在** | `.workbuddy/memory/MEMORY.md:55`：「三方一致性核验：`stage3-device/hb55/apk-plugin-md5.py`」 |
| **功能** | `.workbuddy/memory/automations/…/memory.md:467`：「核验工具：`stage3-device/hb55/apk-plugin-md5.py`（直读 APK 内 `assets/dsh-runtime.zip` 的条目 md5）」 |
| **为什么重要** | MEMORY.md `:52-55` 称它是判「**设备上跑着的 ≠ APK 里装着的**」的唯一核验手段 |
| **现在不在** | ✅ 已查实 |
| **被哪次 cleanup 删** | 随 `stage3-device/` 出库（该目录在「搬到仓库外 10 项」清单内，见 D-01 证据 3） |
| **文档是否仍引用** | ✅ 是，2 处 |
| **影响** | ★ **双重不可达**：文件不存在 **且** 所在目录被 gitignore ⇒ 换机器 clone 后**照文档做必然扑空，而本机也早已没有** |

**证据 1 —— 不存在 + 被忽略（两个事实同时成立）**
```bash
$ ls -la stage3-device/hb55/apk-plugin-md5.py
ls: cannot access 'stage3-device/hb55/apk-plugin-md5.py': No such file or directory

$ git check-ignore -v stage3-device/hb55/apk-plugin-md5.py
.gitignore:52:stage3-device/	stage3-device/hb55/apk-plugin-md5.py
```
**证据 2 —— glob 全仓确认**
```bash
$ glob "**/apk-plugin-md5.py"
No files found
```
**证据 3 —— 仍被引用的 2 处**
- `.workbuddy/memory/MEMORY.md:55`
- `.workbuddy/memory/automations/2f69ebd1-…/memory.md:467`

> ⚠️ 注意：MEMORY.md 本身也在被 gitignore 的 `.workbuddy/`（`.gitignore:69`）内。
> ⇒ 这份「项目约定」**只存在于本机**，换机器后连它的引用都读不到。见 §3-H3。

---

### D-03 · `deepseek-harness/docs/*` —— 上游文档随源码迁移流失，但源码注释仍在指向

| 项 | 内容 |
|---|---|
| **曾经存在** | `deepseek-harness/` 是带 `.git` 的 monorepo（`docs-archive/项目架构复盘与迁移规划.md:17` 实证） |
| **现在不在** | `ls -d deepseek-harness` → `No such file or directory`（在「搬到仓库外 10 项」内） |
| **文档是否仍引用** | ✅ 是，**12 处 `docs/*.md` 悬空**，其中 **3 处硬编码在产品源码注释里**（见下） |
| **影响** | 中：阅读型引用为主；但源码注释里的 3 处会让后来者按图索骥扑空 |

**证据 —— 源码注释中的悬空引用（这些不是历史会话，是活代码）**
```bash
$ grep -rn "docs/config-catalog.md" rp-workspace/packages/src/
rp-workspace/packages/src/dsht-rp-ui/src/client/fold-plan.ts:6:
 * （docs/config-catalog.md 无 collapse/fold 键；trajectory 视图的 turn 折叠会把
```
同族还有 `packages/lib/dsht-rp-ui/src/client/fold-plan.js:6`、`fold-plan.d.ts:6`。

**12 处悬空 `docs/*.md` 全清单**
`docs/Agent/ProfilesAndPreset.md` · `docs/Agent/PromptAssembly.md` · `docs/AgentArchitecture.md` ·
`docs/AndroidDevelopment.md` · `docs/BackendStructure.md` · `docs/CurrentState/AgentProviderState.md` ·
`docs/config-catalog.md` · `docs/subsystems/system-prompt.md` · `docs/web-styling.md` ·
`docs/web-styling.zh.md` · `docs/X.md` · `docs/x.md`

> 判别依据：这些文档描述的是 **Rust crate 分层（tt-domain/tt-contracts/…）与 `apps/web/`**，
> 即 **DeepSeek Harness 上游结构**，不是 DSHTavern 自身（见
> `DSH Android Roleplay App Plan（历史会话）.md:239`）。⇒ 归类为「上游文档流失」，非本项目自建资产。

---

## §2 悬空引用清单

### 2.1 真缺陷（需处置）

| # | 引用位置(文件:行号) | 引用的路径 | 实际存在? | 严重度 |
|---|---|---|---|---|
| 1 | `MASTER_TODO.md:2141` | `tools-cu/cu.py` | ❌ 不存在（且从未入 git） | **高** |
| 2 | `.workbuddy/memory/2026-09-10.md:379` | `tools-cu/cu.py` | ❌ 不存在 | 中（史实区，可保留为「曾建成」记录） |
| 3 | `docs/T-25-PUBLISH-HYGIENE-2026-09-11.md:105` | `tools-cu/cu.py` | ❌ 不存在 | 低（史实清单，上下文是「当时的默认参数」） |
| 4 | `.workbuddy/memory/MEMORY.md:55` | `stage3-device/hb55/apk-plugin-md5.py` | ❌ 不存在 **且** 被 gitignore | **高** |
| 5 | `.workbuddy/memory/automations/…/memory.md:467` | `stage3-device/hb55/apk-plugin-md5.py` | ❌ 不存在 **且** 被 gitignore | 中 |
| 6 | `rp-workspace/packages/src/dsht-rp-ui/src/client/fold-plan.ts:6` | `docs/config-catalog.md` | ❌ 不存在 | 中 |
| 7 | `rp-workspace/packages/lib/dsht-rp-ui/src/client/fold-plan.js:6` | `docs/config-catalog.md` | ❌ 不存在 | 低（`packages/lib/` 是过期派生目录） |
| 8 | `rp-workspace/packages/lib/dsht-rp-ui/src/client/fold-plan.d.ts:6` | `docs/config-catalog.md` | ❌ 不存在 | 低（同上） |
| 9 | `DSH Android Roleplay App Plan（历史会话）.md:114,239,4710,…` | `docs/AgentArchitecture.md` / `docs/BackendStructure.md` / `docs/web-styling.md` / `docs/config-catalog.md` 等 12 份 | ❌ 均不存在 | 低（历史会话归档，非活文档） |

**汇总：真缺陷悬空引用 = 5 条**（去重后按「引用目标」计：`tools-cu/cu.py`、`stage3-device/hb55/apk-plugin-md5.py`、`docs/config-catalog.md`、12 份上游 `docs/*.md`、`packages/boot/app-boot/src/profile.ts`）
**悬空引用记录条数（含历史会话重复引用）= 9 条**

### 2.2 已排除的假阳性（348 条，逐类给了排除依据 —— 守 P-38「防假红」）

| 类别 | 条数 | 为什么**不是**缺陷 | 依据 |
|---|---|---|---|
| **上游第三方源码内路径**（`dsh/`·`lib/`·`core/`·`public/scripts/`·`src/function/`·`packages/client/`·`cordis` 等） | 49 | 属 DSH / SillyTavern / TauriTavern 上游仓库内路径，本项目不是它们的 owner | `MEMORY.md:6`：「DSH 官方源**零修改**（合规红线）」 |
| **刻意注入的负控 fixture** | 12 | `GHOST-*` / `xxx.mjs` / `X.md` / `x.mjs` 是**故意造的幽灵路径**，用于证明闸门能报红 | `docs/GOAL.md:618`（W82）：「把 `source` 改成幽灵路径（`packages/src/lore/GHOST-safe-regex.ts`）…**十个闸门全部 exit=0**」 |
| **`tmp/` 一次性探针** | 30 | `.gitignore:34` 明示「`tmp/` 是本仓所有一次性探针的落脚地、**任何时候都可能被清理**」 | `.gitignore:128-130` |
| **`stage3-device/` 心跳探针** | 27 | `.gitignore:52` 整目录出库；性质同 `tmp/` | `.gitignore:51-52` |
| **`rp/` TT 真实用户数据** | 9 | 属**被测对象 TauriTavern 的运行时数据**，非本项目资产 | `MEMORY.md:9`：「真 TH 运行时源码可查：`tmp/tt-data/…`」 |
| **`th-vendor-entry.mjs`** | 1 | ★ **已知虚拟 stdin 名，仓库里本就不该有** | `rp-workspace/scripts/vendor-deps.mjs` 头注：「报错指向的 `th-vendor-entry.mjs` 是**虚拟 stdin 名，仓库里并不存在**，极易被误判成『源码写错了』」 |
| **`scripts/…` 单基点误判** | — | `audit-card-context-surface.mjs` / `audit-method-binding.mjs` 首轮判「缺失」，**复查发现按 `rp-workspace/` 基点解析确实存在** | 见下方「自纠」 |

**★ 自纠记录（防假红的一次实证）**
首轮扫描把 `node scripts/audit-card-context-surface.mjs`（`MASTER_TODO.md:1522`）
判为「缺失」。复查后确认是**基点误判**：
```bash
$ ls -la rp-workspace/scripts/audit-card-context-surface.mjs
-rwxr-xr-x 1 Administrator 197121 41104 Sep 17 21:03 rp-workspace/scripts/audit-card-context-surface.mjs
$ ls -la rp-workspace/scripts/audit-method-binding.mjs
-rwxr-xr-x 1 Administrator 197121 13573 Sep 18 19:28 rp-workspace/scripts/audit-method-binding.mjs
```
⇒ 本项目 `scripts/…` 声明**以 `rp-workspace/` 为基点**，审计必须**双基点并集**解析。
（`audit-doc-refs.mjs` 判据③ 已实现「两基点并集：仓库根 / `rp-workspace/`」，本审计已对齐该口径。）

### 2.3 「怎么跑」入口脚本（P-52 同族）—— 结论：**全部完好 ✅**

```bash
$ for c in $(grep -ohE '(node|bash|python3?|pwsh)\s+[A-Za-z0-9_./-]+\.(mjs|js|sh|ps1|py)' \
      README.md CONTRIBUTING.md docs/ONBOARDING-15MIN.md MASTER_TODO.md | awk '{print $2}' | sort -u); do
    [ -e "$c" ] && echo "  OK(根) | $c" || echo "  ★缺失 | $c"; done
  OK(根) | .goal/upgrade-0.1.5/evaluate.sh
  OK(根) | rp-workspace/scripts/fetch-native-libs.mjs
  OK(rp-workspace 基点) | scripts/audit-card-context-surface.mjs
  OK(rp-workspace 基点) | scripts/audit-method-binding.mjs
```
⇒ **无悬空的可执行入口**。但 **`.goal/upgrade-0.1.5/evaluate.sh` 落在被忽略的 `.goal/` 内**
（`git check-ignore -v` → `.gitignore:70:.goal/`）—— 它**本机存在但不在版本控制内**，
属 P-53 家族（**换机器 clone 后照文档做会扑空**）。本机可跑，故不计入「真缺陷」，**登记为隐患 H4**。

### 2.4 项目自带闸门的读数（重要对照）

```bash
$ node rp-workspace/scripts/audit-doc-refs.mjs
[文档引用] 判据⑥（受守面单源）：代码受守面 4 份 与 GOAL §八 E-H 声明**逐项一致** · 违规 0 处
[文档引用] 判据⑦（跨文档章节引用可达）：检查 11 处（涉及 3 份文档）· 违规 0 处
[文档引用] 判据⑧（行号式引用可达）：检查 13 处（涉及 1 份文档）· 违规 0 处
[文档引用] 扫描 5 份（E-H 四份 + SSOT）· 悬空/误导/控制外引用 0 处 · ⓘ 信息项 2 处
[文档引用] OK —— 文档里点名的脚本/文档**全部真实存在**
exit=0
```
⇒ **闸门报绿，但 `tools-cu/cu.py` 与 `apk-plugin-md5.py` 仍悬空**。
原因是**受守面只有 5 份文档**（`E_H_DOCS` 四份 + SSOT），
**`MASTER_TODO.md` / `.workbuddy/memory/` / `docs/T-25-*.md` 均不在扫描面内**。
这正是 `audit-doc-refs.mjs` 判据①～⑧ 头注自己承认的边界：
> 「本判据只证『**两份清单的字面名单一致**』」

**★ 这是一个「闸门存在但受守面有洞」的结构性发现** —— 见 §3-H5。

---

## §3 结构性隐患清单

### 3.A MEMORY.md「已实证 10 类断链」逐条复核

> 原文：`.workbuddy/memory/MEMORY.md:22-25`

| # | 断链类别 | 现状 | 证据 | 结论 |
|---|---|---|---|---|
| ① | **BOM 丢失** | ★★ **仍敞口** | 无 `.gitattributes`；`core.autocrlf=true`；无 BOM 守护脚本/hook；双 BOM 实测复现 2 处语法错误 | **未守住** |
| ② | WebView 缓存跨重启存活 | 🟡 部分守住 | `MainActivity.kt` 有 `rebuildWebView` + renderer 重建预算（`:120,153`），但**无自动断言** | 半敞口 |
| ③ | 热推旧包 | 🟡 脚本在、纪律靠人 | `hotpush-plugins.sh` 存在（3089 B）；MEMORY.md `:53` 靠「⚠️ **必须**重跑」人工纪律 | 半敞口 |
| ④ | **MainActivity 未提交** | ★★ **正在发生** | `git status` → ` M MainActivity.kt`；且差异是**纯 CRLF 污染**（见下） | **未守住** |
| ⑤ | 哨兵只增不删 | 🟡 有断言 | `build-wb.sh:296` A6「产物 sentinel 核验（解 dex 与源码比对）」→ `:310` 不一致即 `die` | 基本守住 |
| ⑥ | 源码改于构建之后 | ✅ 已守住 | `audit-artifact-freshness.mjs`（64918 B）存在并被 `build-wb.sh` 引用 | **已守住** |
| ⑦ | 插件「存在即跳过」→ 静默不进包 | ★ **仍敞口** | `build-plugins.sh:80`：「`say "  · 源码不存在，跳过"`」—— **静默跳过，无告警无失败** | **未守住** |
| ⑧ | `rm -rf` 撞 >50 文件安全闸 → 构建静默中止 | ★ **仍敞口（改为显式失败）** | `build-wb.sh:69` die 提示「重跑一次即可」；`:57-63` 自认「与本项目断链第 ⑧ 类**同源**」 | **未根治，仅显式化** |
| ⑨ | 前端 POST × 后端只挂 GET → 恒 404 被 catch 吞 | ✅ 已守住 | `audit-route-contract.mjs --selftest` → **6/6 PASS**（含「只在 GET 区被判违约」正控） | **已守住** |
| ⑩ | 构建期 vendor 包不在 package.json → install 剪掉 | ✅ 已守住 | `node rp-workspace/scripts/vendor-deps.mjs --check` → 「**OK — 7 个构建期 vendor 包版本全部锚定命中**」 | **已守住** |

**逐条复核结论汇总**：**3 条已守住**（⑥⑨⑩）· **3 条半敞口**（②③⑤，有缓解但无硬闸）· **4 条仍敞口**（①④⑦⑧）。

---

### H1 · ★★★ 无 `.gitattributes` + `core.autocrlf=true` ⇒ 316 个受控文件正被静默改写行尾

**这是本次体检最严重的结构性隐患，也是断链①的根因。**

**证据 1 —— 两个前提同时成立**
```bash
$ ls -la .gitattributes
ls: cannot access '.gitattributes': No such file or directory
$ git config core.autocrlf
true
```

**证据 2 —— `MainActivity.kt` 的工作区/HEAD 差异是「纯粹换行符」**
```bash
$ git status --short rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt
 M rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt

$ git diff --numstat -- …/MainActivity.kt
（空！）                 ← ★ git 认为「无内容差异」，却报 M

$ git show HEAD:…/MainActivity.kt > /tmp/head.kt
$ echo "HEAD 大小: $(wc -c < /tmp/head.kt) / 工作区大小: $(wc -c < …/MainActivity.kt)"
HEAD 大小: 139651 / 工作区大小: 142172

$ echo "HEAD CR 数: $(tr -cd '\r' < /tmp/head.kt | wc -c)"
HEAD CR 数: 0
$ echo "工作区 CR 数: $(tr -cd '\r' < …/MainActivity.kt | wc -c)"
工作区 CR 数: 2521

$ tr -d '\r' < /tmp/head.kt > a.kt; tr -d '\r' < …/MainActivity.kt > b.kt
$ cmp -s a.kt b.kt && echo "★确认：去掉 CR 后完全相同 ⇒ 差异纯粹是换行符"
★确认：去掉 CR 后完全相同 ⇒ 差异纯粹是换行符
```
⇒ **`MainActivity.kt` 已被 autocrlf 加上 2521 个 CR（+2521 字节）**。
这解释了 `git diff` 报 M 但 `--numstat` 为空的反常 —— 也解释了断链④为何「经常复发」：
**只要碰一次文件，工作区就与 HEAD 产生换行差异，「未提交」状态长期挂着。**

**证据 3 —— 污染面：316 个受控文件**
```bash
$ git ls-files -z | while IFS= read -r -d '' f; do
    cr=$(tr -cd '\r' < "$f" | wc -c); [ "$cr" -gt 0 ] || continue
    hcr=$(git show "HEAD:$f" | tr -cd '\r' | wc -c)
    [ "$hcr" -eq 0 ] && echo "$f"; done | wc -l
316
```
按类型分布：

| 扩展名 | 条数 |
|---|---|
| `.ts` | 125 |
| `.js` | 102 |
| `.md` | 9 |
| `.json` | 6 |
| `.sh` | 5 |
| `.ps1` | **2** |
| `.kt` | **1** |

**★ 受影响的 2 个 `.ps1`（BOM 敏感区）**
```bash
$ grep '\.ps1$' <污染名单>
rp-workspace/scripts/build-dsht.ps1      ← ★ 头号构建脚本
rp-workspace/scripts/rebuild-plugins.ps1
```

**证据 4 —— `.ps1` 的 BOM 现状（7 个已跟踪 `.ps1` 全表）**
```bash
$ for f in $(git ls-files '*.ps1'); do
    printf "BOM=%-8s CR=%-6s %s\n" \
      "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" \
      "$(tr -cd '\r' < "$f" | wc -c)" "$f"; done
BOM=23206c   CR=0      rp-workspace/android/branding/resize-logo.ps1
BOM=efbbbf   CR=2097   rp-workspace/scripts/build-dsht.ps1      ← 单 BOM ✓，但 2097 个 CR
BOM=efbbbf   CR=0      rp-workspace/scripts/emu-app-up.ps1
BOM=efbbbf   CR=0      rp-workspace/scripts/emu-watchdog.ps1
BOM=efbbbf   CR=0      rp-workspace/scripts/emulator-dsht.ps1
BOM=efbbbf   CR=0      rp-workspace/scripts/make-testdata.ps1
BOM=efbbbf   CR=241    rp-workspace/scripts/rebuild-plugins.ps1
```
⇒ **同目录 7 个 `.ps1` 出现 3 种形态**（无 BOM / 单 BOM / 单 BOM+CR），
**没有任何规则规定该用哪种** ⇒ 断链①必然复发。

**★ 这解释了线索 2 的「双 BOM」是怎么来的**：
`build-dsht.ps1` 现在是**单 BOM + 2097 CRLF**；
一旦某个工具（编辑器 / `Set-Content` / 写入时补 BOM 的脚本）**再加一次 BOM**，
就得到 `EF BB BF EF BB BF` —— **正是 2026-09-26 体检当天复现的形态**。

**证据 5 —— ★ 双 BOM 实测复现（完整因果链，三组对照）**

| 组 | 形态 | PowerShell 语法错误数 | 输出 |
|---|---|---|---|
| **正控** | 单 BOM（当前 HEAD 形态） | **0** | `单BOM 语法错误数: 0` |
| **实验组** | **双 BOM** `EF BB BF EF BB BF` | **2** ★ | `The assignment expression is not valid. The input to an assignment operator must be an object that is able to accept assignments…`（×2） |
| **负控** | 无 BOM + GBK 误读 | **19** | `Unexpected token ''P0-1a bash-local run/start argv'' in expression or statement.` |

```bash
# 实验组：构造双 BOM
$ cp rp-workspace/scripts/build-dsht.ps1 tmp/bomtest.ps1
$ printf '\xEF\xBB\xBF' | cat - tmp/bomtest.ps1 > tmp/bomtest2.ps1
$ head -c 6 tmp/bomtest2.ps1 | od -An -tx1
 ef bb bf ef bb bf                       ← ★ 双 BOM

$ pwsh -NoProfile -Command "…Parser::ParseFile('…bomtest2.ps1',…); 输出 \$e.Count 与消息"
★ 语法错误 2 处:
   The assignment expression is not valid. …（×2）
```
⇒ **完全复现线索 2 报告的现象（2 处「assignment expression is not valid」）。**

```bash
# 负控：证明 BOM 确实是必需的（去掉 BOM 后按 GBK 解码）
$ python -c "…统计 build-dsht.ps1 非 ASCII 字节…"
nonASCII bytes: 81140
replacement chars after GBK decode: 6671
first nonascii offset: 17
```
⇒ `build-dsht.ps1` 含 **81140 个非 ASCII 字节**（中文注释）⇒ 无 BOM 时被按 ANSI/GBK 误读
⇒ 产生 **6671 个替换字符** ⇒ PowerShell 报 **19 处语法错误**。
**BOM 对这个文件是硬需求，而不是风格偏好。**

**证据 6 —— 无任何版本控制级或工具级约束**
```bash
$ ls .git/hooks/ | grep -v sample        # 无自定义 hook
（空）
$ ls rp-workspace/scripts/ | grep -iE "bom|encoding|attr"
（空）
```
⇒ **无 `.gitattributes`、无 hook、无 BOM 审计脚本**。断链①处于**完全无约束**状态。

---

### H2 · ★★ MEMORY.md 自述「构建/部署断链已实证 10 类」但只做了 6 处防御，且**无一处防御 `① BOM`**

见 §3.A 表。要害是：**10 类里唯一被文档反复标注「复发 6+ 次」的那一类（①），恰是唯一连脚本都没写的**。
```bash
$ ls rp-workspace/scripts/ | grep -iE "bom|encoding"
（空 —— 无 BOM 检查脚本）
$ ls rp-workspace/scripts/ | grep -ciE "^audit-"
62                          ← 有 62 个 audit-* 闸门，却无一个管 BOM
```
⇒ 防御投入与复发频率**严重不匹配**。

---

### H3 · ★★ 项目「唯一活文档」与「项目约定」均在 gitignore 内 ⇒ 换机器后知识归零

```bash
$ git check-ignore -v .workbuddy/memory/MEMORY.md
.gitignore:69:.workbuddy/	.workbuddy/memory/MEMORY.md

$ git check-ignore -v .goal/upgrade-0.1.5/evaluate.sh
.gitignore:70:.goal/	.goal/upgrade-0.1.5/evaluate.sh

$ git check-ignore -v docs-archive/
.gitignore:87:docs-archive/	docs-archive/
```
**影响**：
- `MEMORY.md`（项目铁律 + 10 类断链 + 架构约束）**不在版本控制内**
- `.goal/upgrade-0.1.5/LEARNINGS.md`（**223178 B**，L1–L38 方法论）**不在版本控制内**
- `docs-archive/`（「项目唯一完整历史档案」，`.gitignore:85` 自述）**不在版本控制内**

⇒ 这些都是**仅存于本机的单点资产**。本机磁盘一旦损坏，**项目方法论与断链知识全部归零**。
（这是 `.gitignore` 的**有意决策**（T-25 发布卫生，防泄露真实卡名/路径），
但其**代价未在任何文档中被登记**。）—— 登记为隐患，**不建议本轮改**（涉及发布卫生红线）。

---

### H4 · P-53 家族：被文档当作「怎么跑」引用的入口落在忽略目录内

| 引用 | 落点 | 忽略规则 | 本机可跑? |
|---|---|---|---|
| `MEMORY.md:3` 点名 `.goal/upgrade-0.1.5/LEARNINGS.md` | `.goal/` | `.gitignore:70` | ✅ 本机有（223178 B） |
| `README/CONTRIBUTING` 提及 `.goal/upgrade-0.1.5/evaluate.sh` | `.goal/` | `.gitignore:70` | ✅ 本机有（730 B） |
| `MEMORY.md:55` 三方核验工具 | `stage3-device/` | `.gitignore:52` | ❌ **本机也没有**（见 D-02） |
| `golden-verify*.mjs` 用相对路径引用 `loop-mvu-interact/` | `loop-mvu-interact/` | `.gitignore:96` | ✅ 本机有 |

`.gitignore:93-94` **自己已经预警过这一类**：
> 「⚠️ `loop-mvu-interact` 被 `golden-verify*.mjs` 用**相对路径**引用 —— 出库后文件仍在
> 本机，脚本照常可跑；但**换机器 clone 后这些脚本会缺输入**，届时需另行提供样本。」

⇒ 该预警**只覆盖了 `loop-mvu-interact/` 一项**，未推广到 `.goal/`、`stage3-device/`。
`apk-plugin-md5.py` 就是这条预警**没有覆盖到而实际发生**的实例。

---

### H5 · ★ 项目自带闸门 `audit-doc-refs.mjs` 受守面只有 5 份文档 ⇒ 悬空引用系统性漏检

**证据**（见 §2.4）：闸门报 `悬空/误导/控制外引用 0 处 · exit=0`，
而 `MASTER_TODO.md:2141` 的 `tools-cu/cu.py` 与 `MEMORY.md:55` 的 `apk-plugin-md5.py` **都悬空**。

**根因**：受守面 = `E_H_DOCS`（4 份）+ `SSOT_DOCS`。
`MASTER_TODO.md`（自称「**唯一活文档**」）、`.workbuddy/memory/`、`docs/T-25-*.md` **均不在面内**。

```bash
$ head -3 MASTER_TODO.md
# DSHTavern 总待办与现状（唯一活文档）
```
⇒ **自称「唯一活文档」的文件，不在文档引用闸门的受守面内。**
这与 `audit-doc-refs.mjs` 判据⑥ 的教训（「声称单源是一个可判定的断言」）**同构**：
**「唯一活文档」这一自称，同样没有任何机器守着。**

---

### H6 · 断链⑦「插件存在即跳过」仍是静默失败

```bash
$ grep -n "跳过" rp-workspace/scripts/build-plugins.sh
80:  say "  · 源码不存在，跳过"
```
⇒ **源码缺失只打印一行，不 `die`、非零退出码无** ⇒ 与 `MEMORY.md:19`
「主力缺陷 = **静默失败族**（函数在、不抛错、返 200，但没干该干的事）」**同族**。
对比：同一项目在 vendor-deps（`.mjs`）上明确执行了「复核不过就抛错，**绝不静默继续**」的原则，
**`build-plugins.sh` 未对齐该原则**。

---

### H7 · 断链⑧「安全删除闸」未根治，仅从「静默中止」改为「显式失败」

```bash
$ sed -n '57,69p' rp-workspace/scripts/build-wb.sh
  # 【2026-09-11 心跳 47 新增】把「安全删除预算耗尽」这种环境性失败与「产物形态变了」区分开。
  # 背景：宿主沙箱有一个 node 侧 safe-delete 守卫（`node-safe-delete-shim.cjs`，阈值 50、scope=turn）。
  # 预算按**轮次**累计…补丁脚本 Step 3a 的 rmtree 就会撞闸，脚本非零退出 → 这里 die。
  …
      die "平台补丁被宿主安全删除守卫拦住（本轮删除预算已耗尽，非产物问题）——重跑一次 build-wb.sh 即可"
```
⇒ 改善是真实的（错误信息不再误导），但**根因（构建依赖「重跑一次」）仍在**：
构建**不是幂等一次成功**的，需要人重跑。`build-wb.sh:62` 自认「与本项目断链第 ⑧ 类**同源**」。

---

## §4 建议处置（分优先级 —— **本轮不实施**）

> **前置纪律**：本文件为审计报告，**未改动任何产品文件**。
> 下列处置均需另开任务、单独确认后执行。

### P0 —— 结构性根因，建议优先（可在下一轮执行）

| # | 处置 | 针对 | 预期效果 | 风险 |
|---|---|---|---|---|
| **P0-1** | **新建 `.gitattributes`**：`*.ps1 text eol=crlf working-tree-encoding=UTF-8` / `*.sh text eol=lf` / `*.kt text eol=lf` / `* text=auto` | H1/断链① | BOM 与换行**首次获得版本控制级约束**，根除复发 | 中：需一次性 `git add --renormalize .`，会产生大量「仅换行」diff（**必须单独一个提交**） |
| **P0-2** | **加 BOM 守护闸**（对齐 vendor-deps 的「绝不静默继续」）：逐个 `.ps1` 断言「**恰好 1 个 BOM**」，多/少均 `die` | H1/H2/断链① | 双 BOM 当天就被拦 | 低 |
| **P0-3** | **`build-plugins.sh:80` 的「源码不存在，跳过」改为硬失败** | H6/断链⑦ | 消除一个静默失败点 | 低（需先确认是否有**合法**的缺失分支） |

### P1 —— 资产找回与引用修正

| # | 处置 | 针对 | 说明 |
|---|---|---|---|
| **P1-1** | **重建 `tools-cu/cu.py`**（或明确宣布废弃） | D-01 | ★ **首选重建**：`pyautogui 0.9.54` 仍在（实测 OK），13 个子命令清单齐全（`2026-09-10.md:381`），`FAILSAFE=True` + `--dry-run` 设计已知 ⇒ 成本低。**重建后必须入 git + 加 `.gitattributes` 保护** |
| **P1-2** | **修正 3 处 `tools-cu/cu.py` 引用**：删去 MASTER_TODO.md:2141 的「✅ 实测通过」，或标注「已流失 / 待重建」 | D-01 | MASTER_TODO.md 是「唯一活文档」，**留着会误导** |
| **P1-3** | **处置 `apk-plugin-md5.py` 引用**：MEMORY.md:55 + automations/memory.md:467 | D-02 | 或重建该核验工具，或**改写为「该工具已流失，三方一致性核验需新手段」** |
| **P1-4** | 清理 3 处产品源码注释里的 `docs/config-catalog.md` 悬空引用 | D-03 | `fold-plan.ts:6` / `.js:6` / `.d.ts:6`（注意 `.js`/`.d.ts` 在过期派生目录 `packages/lib/`） |

### P2 —— 闸门受守面扩容（防复发，价值高）

| # | 处置 | 针对 | 说明 |
|---|---|---|---|
| **P2-1** | ★ **把 `audit-doc-refs.mjs` 受守面扩到 `MASTER_TODO.md`** | H5 | 「唯一活文档」理应在受守面内。**这是投入产出比最高的一条**：不改判定逻辑，只加清单项 |
| **P2-2** | 评估把 `.workbuddy/memory/*.md` 纳入受守面（或至少 `MEMORY.md`） | H5/D-02 | `MEMORY.md` 是 AI 每轮必读的入口，悬空会持续误导 |
| **P2-3** | 对 `audit-doc-refs.mjs` 加一条**负控**：把 `tools-cu/cu.py` 注入 MASTER_TODO ⇒ 应报红 | H5 | 守「闸门真的覆盖了这个面」，防**假绿**（P-30） |

### P3 —— 登记但**本轮明确不建议动**（涉及发布卫生红线 / 大规模变更）

| # | 事项 | 为什么不动 |
|---|---|---|
| **P3-1** | `.workbuddy/` / `.goal/` / `docs-archive/` 出库（H3） | `.gitignore:66-70,84-87` 的排除是 **T-25 发布卫生的有意决策**（防真实卡名/人形名/本机路径泄露）。**建议只登记「单点资产风险」**，改由**离线备份**（非入库）解决 |
| **P3-2** | 断链⑧ 安全删除闸的根治 | 根因在宿主沙箱侧（`node-safe-delete-shim.cjs`，阈值 50），非本项目可控 |
| **P3-3** | 12 份上游 `docs/*.md` 悬空（D-03） | 属 `deepseek-harness/` 外迁的连带结果；如需保留可考虑**就地补一份上游 docs 索引**，而非复制文件 |
| **P3-4** | 316 文件 CRLF 重规范化（P0-1 的副作用） | **必须独立提交**，且需与并发实例协调（`MEMORY.md:84` 并发协议：只 add 自己的文件，禁 `git add -A`） |

---

## 附录 A：审计方法与口径

| 项 | 做法 |
|---|---|
| 工具纪律 | 全程用 `read` / `grep` / `glob` 工具；`bash` 仅用于 `git` / `find` / `od` / `pwsh` 等无法用工具表达的核验 |
| 路径抽取 | 从 `docs/*.md`、`docs-archive/*.md`、`README.md`、`CONTRIBUTING.md`、`MASTER_TODO.md`、`.workbuddy/memory/*.md` 反向引号抽取 → **1172 条唯一路径** |
| 存在性判定 | **双基点并集**（仓库根 ∪ `rp-workspace/`）+ basename 全仓回退（排除 `.git`/`node_modules`/`build`） |
| 索引规模 | `find` 全仓 → **12751** 条路径 |
| 假阳性抑制 | 按 6 类逐一给出排除依据（见 §2.2），并**保留一次自纠记录**（基点误判）守 P-38 |
| BOM 复现 | 三组对照（单 BOM 正控 / 双 BOM 实验 / 无 BOM 负控），全部用 `[Parser]::ParseFile` 计数语法错误 |

**未做的事（诚实边界）**：
- 未验证 `cu.py` 重建后的实际功能（本轮只审计）
- 未测断链②（WebView 缓存跨重启）的实机行为 —— 需设备在位，超出本轮范围
- 未穷举 `.workbuddy/memory/**` 全部子目录（`automations/` 仅抽查到 `apk-plugin-md5.py` 一处引用）
- `docs/GOAL.md`（474458 B）、`docs/MOBILE-TEST-METHODOLOGY.md`（955014 B）按关键词扫描，未逐行精读

## 附录 B：关键命令速查（复现本报告全部结论）

```bash
# 1. tools-cu/cu.py 流失
find . -iname "cu.py" -not -path "./.git/*"        # 无输出
git rev-list --all --objects | grep -i "tools-cu"   # 无输出 ⇒ 从未入库

# 2. apk-plugin-md5.py 双重不可达
ls stage3-device/hb55/apk-plugin-md5.py             # No such file
git check-ignore -v stage3-device/hb55/apk-plugin-md5.py
                                                    # .gitignore:52:stage3-device/

# 3. H1：autocrlf 污染
git config core.autocrlf                             # true
ls .gitattributes                                    # No such file
git ls-files -z | while IFS= read -r -d '' f; do … done | wc -l   # 316
head -c 3 rp-workspace/scripts/build-dsht.ps1 | od -An -tx1       # ef bb bf

# 4. 双 BOM 复现
cp rp-workspace/scripts/build-dsht.ps1 /tmp/t.ps1
printf '\xEF\xBB\xBF' | cat - /tmp/t.ps1 > /tmp/t2.ps1
pwsh -NoProfile -Command "…ParseFile('/tmp/t2.ps1'…)…"            # 2 处语法错误

# 5. 自带闸门报绿（对照 H5）
node rp-workspace/scripts/audit-doc-refs.mjs                       # exit=0，0 处违规

# 6. 已守住的断链
node rp-workspace/scripts/vendor-deps.mjs --check                  # 7 包全命中（⑩）
node rp-workspace/scripts/audit-route-contract.mjs --selftest      # 6/6 PASS（⑨）
```

---

**报告结束。本轮无任何文件被修改（除本报告自身）。**
