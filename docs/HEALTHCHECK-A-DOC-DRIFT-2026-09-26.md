# 体检 A：文档声称 vs 代码/产物实际 —— 偏差清单

> 体检日期：2026-09-26
> HEAD：`b837ece`（`docs(release): v0.2.7 release notes（底层 DSH 0.1.7-rc.1 + 会话格式 v3→v4 自动迁移）`）
> 审计员：doc-auditor（共享任务 `task-1`）
> 性质：**只读审计**。本报告是唯一写入物，未修改任何源码或文档。

---

## 〇、范围、方法与铁律

### 体检范围

| 面 | 文档 |
|---|---|
| 用户入口 | `README.md`（中英双语，639 行） |
| 贡献者入口 | `CONTRIBUTING.md`、`docs/ONBOARDING-15MIN.md`、`docs/ARCHITECTURE.md` |
| 兼容承诺 | `docs/V0.3-FREEZE.md`、`rp-workspace/docs/ST-COMPAT-PACT.md` |
| 目标/完成声明 | `docs/GOAL.md`、`docs/GOAL-*.md`（4 份） |

### 方法

1. 先取**地面真值锚点**（版本号单源、实测测试条数、源码清单），再逐份文档对照。
2. 每条偏差附 **文件:行号 + 复现命令 + 原始输出**。措辞不作为判据，一律以实际运行结果为准。
3. 拿不准的**跑命令实测**，不靠推断；无法实测的**显式写「未实测」**。

### 复核命令（一键复现地面真值）

```bash
# ① 版本地面真值
grep -n "versionName\|versionCode" rp-workspace/android/app/build.gradle.kts
grep -n "dshVersion" rp-workspace/dsh-version.json

# ② 测试条数地面真值（必须先跑依赖自愈，见偏差 D-07）
cd rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile
node ../scripts/vendor-deps.mjs
npx -y pnpm@10 test
```

实测输出（2026-09-26 21:53，跑于 HEAD `b837ece`）：

```
android/app/build.gradle.kts:22:        versionCode = 9
android/app/build.gradle.kts:23:        versionName = "0.2.7"
rp-workspace/dsh-version.json:6:  "dshVersion": "0.1.7-rc.1",

Test Files  86 passed (86)
     Tests  1846 passed | 2 skipped (1848)
```

---

## 一、主偏差表

| # | 文件:行号 | 文档声称 | 实际 | 验证命令 | 严重度 |
|---|---|---|---|---|---|
| D-01 | `README.md:8` | 当前版本 `0.2.2`（内嵌 DSH `0.1.5-rc.1`） | `versionName = "0.2.7"` / versionCode 9；runtime `0.1.7-rc.1` | `grep -n "versionName" rp-workspace/android/app/build.gradle.kts; grep -n dshVersion rp-workspace/dsh-version.json` | 🔴 |
| D-02 | `README.md:329` | `Current version: 0.2.2` (bundles DSH `0.1.5-rc.1`) | 同 D-01（英文段同源错误） | 同上 | 🔴 |
| D-03 | `CONTRIBUTING.md:25` | `Tests  1839 passed \| 2 skipped (1841)` | `1846 passed \| 2 skipped (1848)` | `cd rp-workspace/packages && npx -y pnpm@10 test` | 🔴 |
| D-04 | `CONTRIBUTING.md:138` | 同上（英文段/后半重复一次） | 同上 | 同上 | 🔴 |
| D-05 | `docs/ONBOARDING-15MIN.md:45` | `Tests  1839 passed \| 2 skipped (1841)` | `1846 passed \| 2 skipped (1848)` | 同上 | 🔴 |
| D-06 | `docs/ARCHITECTURE.md:137` | `# 约 10 秒，86 文件 / 1839 项` | 86 文件对，条目数实际 **1846** | 同上 | 🟡 |
| D-07 | `CONTRIBUTING.md:15-19`、`docs/ONBOARDING-15MIN.md:23-27`、`docs/ARCHITECTURE.md:134-138` | 「装依赖 → 跑测试」两步即可得到绿色 1846/1848 | **净环境按文档两步跑会红**：`6 failed \| 80 passed (86)`。必须先跑 `node rp-workspace/scripts/vendor-deps.mjs`（CI 有这一步，三份贡献者文档全都没写） | 见 §二.2 复现 | 🔴 |
| D-08 | `docs/GOAL.md:72` | vitest `81 文件 / 1790 通过 / 2 skipped / 0 失败` | `86 文件 / 1846 通过 / 2 skipped / 0 失败` | `cd rp-workspace/packages && npx -y pnpm@10 test` | 🔴 |
| D-09 | `docs/GOAL.md:68` | 标题「§3.1 基线数字（2026-09-18 第七十一轮 **W82** 收口实测）」 | 同表内 L75/L111 已描述 `0.1.7-rc.1` / sentinel v390 等**远晚于 W82** 的状态 ⇒ 标题日期与表内容代次不自洽 | `sed -n '68p;75p' docs/GOAL.md` | 🟡 |
| D-10 | `docs/GOAL.md:246` | `audit-dsh-version.mjs`：`4 OK / 0 FAIL（dsh 0.1.5-rc.1 …）` | 单源已是 `0.1.7-rc.1`（`dsh-version.json:6`） | `grep -n dshVersion rp-workspace/dsh-version.json` | 🟡 |
| D-11 | `docs/GOAL.md:247` | `verify-apk-runtime-version.mjs`：双包均 `dsh 0.1.5-rc.1` / `dsh-session 0.1.5-rc.2` | 同 D-10；且 L75 自己写「两包 `dsh-session` 均 **0.1.7-rc.1**」⇒ 同文档两行互相矛盾 | `sed -n '75p;247p' docs/GOAL.md` | 🟡 |
| D-12 | `docs/ARCHITECTURE.md:126` | 平台补丁脚本 `rp-workspace/scripts/apply-platform-patches.py` | 文件存在，但 ARCHITECTURE 位于 `docs/`，相对读者所在位置写 `rp-workspace/scripts/…` 与实际一致（**此项经复核为正确，勘误见 §三.2**） | `ls rp-workspace/scripts/apply-platform-patches.py` | 🟢 |
| D-13 | `docs/ARCHITECTURE.md:124` | 会话手术在 `packages/src/dsh-plugin/` 的 `session-surgery.ts` / `session-repair.ts` | 两文件**实际在** `packages/src/dsht-plugin-shared/` | `find rp-workspace/packages/src -name "session-surgery*" -o -name "session-repair*"` | 🟡 |
| D-14 | `docs/GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md:283` | 「新增 `ShizukuExecService.kt`(UserService 服务端)」 | 无此独立文件；`ShizukuExecService` 类定义在 `ShizukuExec.kt:39` | `find rp-workspace -name "ShizukuExecService*" -not -path "*/node_modules/*"` | 🟢 |
| D-15 | `rp-workspace/docs/ST-COMPAT-PACT.md:115` | T2（TH 脚本运行时）状态 `🔨 进行中` | 与 `README.md:68`「tavern_events 82 项全表 / TH API 三类」及 `V0.3-FREEZE.md:23`「Tier 1 已基本达成」的完成口径不一致 | `sed -n '115p' rp-workspace/docs/ST-COMPAT-PACT.md; sed -n '23p' docs/V0.3-FREEZE.md` | 🟡 |
| D-16 | `README.md:20,341` | 「会话迁移（0.1.5）✅ 80/80 真实会话」 | 迁移代次已推进到 **v3→v4**（HEAD 提交信息、`dsh-version.json:13` `sessionFormatKnownGenerations: [3,4]`）⇒ 该行仍是 0.1.5 世代口径，未覆盖 v4 | `sed -n '20p' README.md; sed -n '13p' rp-workspace/dsh-version.json` | 🟡 |
| D-17 | `README.md:85` | Tier 2「（当前 **81 项**拒收之外的增量）」 | 数值 81 此刻**正确**（实测 `TH_UNSUPPORTED_APIS` = 81），但**把会增长的集合写成常量** —— 违反 `V0.3-FREEZE.md:36` 自立的纪律「该数会随拒收面扩大而增长，**不得写成常量**」 | `cd rp-workspace/packages && node -e "<数 TH_UNSUPPORTED_APIS>"` → 81 | 🟡 |
| D-18 | `docs/V0.3-FREEZE.md:62` | 「**明确不进 v0.3**：DSH **0.1.3 升级**（等 rc 修掉官方性能回退…）」 | runtime 已是 `0.1.7-rc.1`（`dsh-version.json:6`）⇒ 0.1.3 早已越过，该句作为决策记录未标注失效 | `grep -n dshVersion rp-workspace/dsh-version.json` → `0.1.7-rc.1` | 🟡 |

**偏差总计 18 条；🔴 高危 7 条；🟡 中危 9 条；🟢 轻微/勘误 2 条。**

---

## 二、分节详证

### §二.1 README（中英双语）

**全部版本号出现处（中英两段都查过）**：`grep -n "0\.2\.[0-9]\|0\.1\.[0-9]-rc" README.md`

```
8:**当前版本**：`0.2.2`（内嵌 DSH `0.1.5-rc.1`）…
303:- **[dsh-preset-enhance](…)**…自 v0.2.0-beta.3 起随包分发。…
329:**Current version**: `0.2.2` (bundles DSH `0.1.5-rc.1`)…
625:- **[dsh-preset-enhance](…)**…shipped with the app since v0.2.0-beta.3…
```

- **L8 / L329 = 偏差 D-01 / D-02**（🔴）。这两行是 README 的**门面版本号**，位于中英两段的第 8 行与第 329 行，是最容易被外部读者第一眼看到的位置。
- **L303 / L625**：`v0.2.0-beta.3` 是**历史事实陈述**（该插件自那版起随包分发），抽样核对 `rp-workspace/packages/package.json` 无法证伪，且措辞是「自…起」⇒ **未发现偏差**。这两行**不需要改**。

**验证面速查表（L17-23 / 英文 L338-344）**：
逐格核对了标注形态。表格自带「到面」纪律（L15：「2026-09-20 起所有『已验证』标注到面」），✅ 格均带具体依据（`80/80 真实会话` / `v368` / `正控 PASS` / `v370 自测 rc=0`），⬜ 格均写「未实测」并给出回填指引。
⇒ **该表在方法论上是诚实的**（明确区分了模拟器面 / 真机面 / 鸿蒙面，未把模拟器结论冒充真机结论）。
唯一问题是行标签「会话迁移（0.1.5）」的代次已过期 —— 见 **D-16**。

**「能做什么」表（L61-71）**：能力描述与源码面抽样一致（世界书触发 / 预设 / 正则 / MVU / 酒馆助手 / EJS / 交互闭环 / 渲染）。其中 L68 自述「条数会随开发增长，**以源码为准**」—— 这句**主动免责是正确的**，实测 `SHIM_LOCAL_APIS` 34 + `SHIM_BRIDGE_APIS` 41 = 75 项，与 `V0.3-FREEZE.md:30` 的 W59 修正值一致（见 §二.2）。

**「兼容分级」表 Tier 1/2/3（L84-86）**：
- L85 Tier 2「（当前 **81 项**拒收之外的增量）」—— 实测 `TH_UNSUPPORTED_APIS` = **81 项**（`src/dsht-plugin-shared/th-api-support.ts:20`），**数字正确**。
- ⚠️ 但措辞「当前 81 项」把**会增长的集合写成了常量**，而 `V0.3-FREEZE.md:36` 自己在 W59 修里明确写了纪律：「该数会随拒收面扩大而增长，**不得写成常量**」⇒ README L85 是**同一纪律的违反**（数值此刻对，形态不合规）。判为 🟡，登记为 **D-17**。

**「Alpha 限制」7 条（L90-98）**：逐条核对后**基本诚实**。
- L92 限制 #1「升级到 DSH 0.1.5 时历史会话需迁移，不可逆」—— 代次仍停在 0.1.5，同 D-16 口径问题（本轮已到 v4）。
- 其余 6 条（首开等待 / 架构 / 时区 IANA / Tier 2-3 / UI 调整 / 安卓改 DSH 风险）未发现与现实矛盾处。

**常见问题（L104-119）/ 法律边界（L126-）**：未发现与代码/产物矛盾之处。

### §二.2 贡献者文档（三份，数字错误集中区）

**D-03/D-04/D-05/D-06** —— 三份文档 4 处写了同一个过期数字：

```
CONTRIBUTING.md:24-25:   Test Files  86 passed (86) / Tests  1839 passed | 2 skipped (1841)
CONTRIBUTING.md:137-138: Test Files  86 passed (86) / Tests  1839 passed | 2 skipped (1841)
ONBOARDING-15MIN.md:44-45: Test Files  86 passed (86) / Tests  1839 passed | 2 skipped (1841)
ARCHITECTURE.md:137:     # 约 10 秒，86 文件 / 1839 项
```

实测（复现见 §〇 复核命令）：

```
Test Files  86 passed (86)
     Tests  1846 passed | 2 skipped (1848)
```

**文件数与通过数交叉验证**：`find tests -name "*.spec.ts" | wc -l` → `86`，与文档一致；条目数差 **7** 条（1846 − 1839）。
⇒ 这三份是**给外部贡献者照抄「预期输出」的入口文档**，数字写小会让新人误以为自己的环境坏了（`ONBOARDING-15MIN.md:48` 明写「**如果这里不是全绿**：先别往下走，开个 Issue 贴完整输出」）—— 一个正确的新环境反而会触发误导性的 Issue。故全部判 🔴。

**D-07（新增发现，此前不在核查清单内）** —— 三份文档的「最小验证路径」在净环境**跑不出绿色**：

复现（严格照 `CONTRIBUTING.md:15-19` 的两条命令）：

```bash
cd rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile
npx -y pnpm@10 test
```

实测输出：

```
FAIL  tests/ext-template-render.spec.ts [ tests/ext-template-render.spec.ts ]
FAIL  tests/host-regex-bridge.spec.ts [ tests/host-regex-bridge.spec.ts ]
FAIL  tests/host-st-facade.spec.ts [ tests/host-st-facade.spec.ts ]
FAIL  tests/host-st-surface.spec.ts [ tests/host-st-surface.spec.ts ]
FAIL  tests/st-event-types.spec.ts [ tests/st-event-types.spec.ts ]
FAIL  tests/th-event-source.spec.ts [ tests/th-event-source.spec.ts ]
 Test Files  6 failed | 80 passed (86)
      Tests  1681 passed | 2 skipped (1683)
```

根因（实测定位）：

```
Error: Failed to load url dompurify (resolved id: dompurify) in
D:/DSH RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/ext-template-render.ts
```

`ext-template-render.ts:40` 有 `import DOMPurify from 'dompurify'`，但：

```bash
node -e "try{require.resolve('dompurify');console.log('resolved')}catch(e){console.log('MISSING dompurify')}"
# → MISSING dompurify
```

且 `dompurify` **既不在** `rp-workspace/packages/package.json`，**也不在** `pnpm-lock.yaml`（`grep -c dompurify package.json pnpm-lock.yaml` = 0 命中）。

补跑 CI 的第三步后转绿：

```bash
node rp-workspace/scripts/vendor-deps.mjs   # → [vendor-deps] 自愈成功 — 7 个包已对齐
cd rp-workspace/packages && npx -y pnpm@10 test
# → Test Files  86 passed (86)
# → Tests  1846 passed | 2 skipped (1848)
```

`.github/workflows/build-apk.yml:105-110` 确实有这一步（`Vendor deps self-heal + build rp-ui`），且其注释自己就写着「**没有这两步，CI 净环境必炸**」—— 但**三份贡献者文档都没有这一步**。
⇒ 判 🔴：这不是「数字过期」，而是**入口文档的复现路径本身不完整**，外部贡献者按文档走到第 3 分钟就会看到红色。

**注**：`handlebars` 也有同样性质（`ext-template-render.ts:39` import，未在 package.json 声明），但它被传递依赖提升到 `packages/node_modules/handlebars` 而**恰好可解析**；`dompurify` 则完全没有。两者都属「未声明的直接依赖」，只是 `dompurify` 的缺失**会实际爆掉测试**。

### §二.3 架构文档

**ARCHITECTURE.md 的路径/模块表（§二 查表，L111-126）逐条核对结果**：

复现：

```bash
cd rp-workspace/packages/src
for p in lore preset regex state macros import dsh-plugin dsht-plugin-mvu \
         dsht-plugin-tavern-helper dsht-plugin-prompt-template dsht-plugin-memory \
         dsht-plugin-mobile dsht-plugin-undo dsht-plugin-shared dsht-rp-ui; do
  [ -d "$p" ] && echo "OK  dir  $p" || echo "MISS dir  $p"; done
```

输出：**15 个目录全部 OK**（无缺失）。

文件级核对（16 项）结果：**14 项 OK，2 项 MISS**。

```
MISS file dsh-plugin/session-surgery.ts
MISS file dsh-plugin/session-repair.ts
```

实际位置：

```bash
find rp-workspace/packages/src -name "session-surgery*" -o -name "session-repair*"
# → packages/src/dsht-plugin-shared/session-repair.ts
# → packages/src/dsht-plugin-shared/session-surgery.ts
```

⇒ **D-13**（🟡）。ARCHITECTURE.md:124 把「会话手术（回退/编辑/变体）」指向 `packages/src/dsh-plugin/`，而真正的实现落在 `dsht-plugin-shared/`。对一个「读完这一篇就能定位文件」的文档来说，这会让人在错误目录里空找。

其余路径复核为**正确**：

```bash
ls rp-workspace/scripts/apply-platform-patches.py   # → 存在（D-12 勘误）
ls src/dsht-plugin-shared/webview-api-guard.ts      # → 存在（ST-COMPAT-PACT E7 引用成立）
ls ../scripts/audit-impl-duplication.mjs            # → 存在（E1 引用成立）
ls ../../docs/F5-MULTI-IMPLEMENTATION-AUDIT.md      # → 存在（E1 引用成立）
```

**L40「7 个插件包（生效 6 个）」**：`src/` 下确有 7 个 `dsh-plugin*` / `dsht-plugin-*` 目录 + 1 个 shared 库，且 L50 已注明 undo「有意不 compose 进 profile」⇒ **自洽，未发现偏差**。

**L187-189「文档有双语结构测试」**：`packages/tests/docs-bilingual-structure.spec.ts` 存在，且 86 文件全绿套件中包含它 ⇒ **正确**。

### §二.4 GOAL 类

**`docs/GOAL.md` §三（基线数字）**：

- **L72 = D-08**（🔴）：`vitest | 81 文件 / 1790 通过 / 2 skipped / 0 失败`，实测 `86 / 1846 / 2 / 0`。
  ⚠️ 该行 §三 开头的纪律原文是（L66）：「当前基线（每轮开工前**必须**复核，**不许沿用旧数字**）」—— 而这一行本身就是**被沿用的旧数字**（81/1790 与 HEAD 距离约 15 个文件、56 条测试）。这是**文档自己违反自己的纪律**。
- **L75**：已更新到 `0.1.7-rc.1` / sentinel v390 ⇒ 与 L72 同表但代次差了好几轮，**表内不自洽**（D-09）。
- **L246 / L247 = D-10 / D-11**（🟡）：两行仍写 `dsh 0.1.5-rc.1` / `dsh-session 0.1.5-rc.2`，而 L75 自己写「两包 `dsh-session` 均 **0.1.7-rc.1**」⇒ **同一文档内直接矛盾**。
- **L80**：`P-1 ~ P-82`。方法论 §5.4 为单源定义，本次未逐条重数（**未实测**，避免与判据装置自身的口径打架）。此项**留白**，不登记为偏差。

**`docs/GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md` —— 这份文档值得单独肯定**：

它在 L116/L120/L186 处**主动登记了自己此前的误标**：

```
L116: **⛔ 验收未达 → 已修复**：上表 W-3 曾被**误标 ✅**，实为**部分交付** ——
      `DeviceBridge.kt:410-414` 的 `exec()` **无条件返回 `NOT_IMPLEMENTED`**…
L186: 这一版的存在本身是二次审计的产物：v0.2.4 曾把 W-3 标为 ✅，而 `exec()` 实为恒返 `NOT_IMPLEMENTED`。
```

并为此加了常驻门禁 `audit-device-honesty.mjs`，把 `EXEC_WIRED` 做成唯一真相源、与三面对账。
实测复核：

```bash
grep -n "EXEC_WIRED" rp-workspace/android/app/src/main/java/com/dshtavern/app/DeviceBridge.kt
# → 133:    const val EXEC_WIRED: Boolean = true

grep -c "  it(" rp-workspace/packages/tests/w3-device-plugin.spec.ts
# → 22        （文档 L283 声称「18→22 条全绿」，一致）
```

⇒ **该项完成声明与现实一致**。这是全仓文档里**诚实度最高的一份**。

**唯一瑕疵 = D-14**（🟢）：L283 写「新增 `ShizukuExecService.kt`(UserService 服务端)」，但该文件不存在 —— `ShizukuExecService` 类实际定义在 `ShizukuExec.kt:39`：

```bash
grep -n "class ShizukuExecService" rp-workspace/android/app/src/main/java/com/dshtavern/app/ShizukuExec.kt
# → 39:class ShizukuExecService : IShizukuExec.Stub() {
```

`AndroidManifest.xml:123` 的注释也沿用「服务端实现见 ShizukuExecService.kt」这一错误文件名。**功能已交付，只是文件名叙述错**，故判 🟢。

**其余 GOAL-\*.md**（`GOAL-ANDROID-GAP-2026-09-21.md` / `GOAL-ECO-SPRINT-2026-09-20.md` / `GOAL-PRESET-SWITCH-2026-09-20.md`）：
抽查 `GOAL-ANDROID-GAP` 的 W-G（`EXTRA_POLYFILLS`）与 W-A（`LanProxy`）：

```bash
grep -n "EXTRA_POLYFILLS" rp-workspace/android/app/src/main/java/com/dshtavern/app/MainActivity.kt
# → 67:  private const val EXTRA_POLYFILLS =
# → 1050:  view.evaluateJavascript(EXTRA_POLYFILLS, null)
```

`EXTRA_POLYFILLS` **存在且被实际调用**，声明成立。
⚠️ `LanProxy` 在 `rp-workspace/android/app/src/main/java/com/dshtavern/app/` 下**未发现同名 .kt 文件**（该目录有 `DeviceBridge/DiagPack/ExchangeDir/Gate/LanTileService/MainActivity/NodeService/ShizukuBridge/ShizukuExec` 共 9 个文件）—— 但本次**未穷举**其可能的内嵌/嵌套位置，**故登记为「未实测」**，不计入偏差表（见 §四 未实测清单）。

### §二.5 兼容契约（`rp-workspace/docs/ST-COMPAT-PACT.md`）

**契约条款抽样核对（A/B/C/E 族）**：

| 条款 | 声称 | 实测 | 结论 |
|---|---|---|---|
| B1 | sandbox 含 `allow-scripts allow-same-origin allow-modals allow-forms allow-popups` | `RpNativeChat.tsx:1160` 逐字命中该 token 串 | ✅ 成立 |
| B2 | confirm/alert/prompt 有真实模态（`MainActivity.kt` `AlertDialog`） | `MainActivity.kt:1167 onJsAlert` / `1176 onJsConfirm` / `1186 onJsPrompt` 三件套齐 | ✅ 成立 |
| E1 | 引用 `docs/F5-MULTI-IMPLEMENTATION-AUDIT.md` + `scripts/audit-impl-duplication.mjs` | 两者均在（`ls` 验证） | ✅ 成立 |
| E7 | 实现见 `dsht-plugin-shared/webview-api-guard.ts` | 文件在 | ✅ 成立 |
| E-节 | 完整表见 `docs/MOBILE-TEST-METHODOLOGY.md §5.4` | 该方法论文档 L270 确有 `### 5.4 设计哲学层判据（P 系列）` | ✅ 成立 |

**Tier 表（L111-116）= D-15**（🟡）：L115 写 T2「🔨 进行中」，而：

```
README.md:68          酒馆助手（JS-Slash-Runner）｜TH API 分本地/桥接/记名拒绝三类；tavern_events 82 项全表；…
V0.3-FREEZE.md:23     ### Tier 1 —— 承诺兼容，坏了算 bug（已基本达成，维持住）
```

三份文档对「TH 脚本运行时」的成熟度给出了**三种口径**（进行中 / Tier 1 已基本达成 / 82 项全表已覆盖）。`ST-COMPAT-PACT.md` 建立于更早（其 4.3 实证基线标注「2026-09-07 全绿；2026-09-14 更新」），此后未随 T2 推进更新状态列。

**`V0.3-FREEZE.md §3` API 条数（本次核查的重点）—— 结论：该处**经 W59 修正后**与源码一致**：

```bash
cd rp-workspace/packages && node -e "<解析 SHIM_LOCAL_APIS / SHIM_BRIDGE_APIS / TH_UNSUPPORTED_APIS 数组>"
# SHIM_LOCAL_APIS  = 34
# SHIM_BRIDGE_APIS = 41
# LOCAL+BRIDGE     = 75
# TH_UNSUPPORTED   = 81
```

对照 `V0.3-FREEZE.md:30` 的 W59 修正文字：「原写『71 个 API（28 本地 + 43 桥接）』，而实测 **本地 34 + 桥接 41 = 75**、记名拒绝 **81 项**」

⇒ **34 / 41 / 75 / 81 四个数字全部实测吻合 W59 的修正值**。该文档 §3 的 API 条数是**可信的**。
`V0.3-FREEZE.md:30` 同时点名 `tavern_events` 82 项由 vitest 规格守：

```bash
grep -n "toHaveLength(82)" rp-workspace/packages/tests/th-script-runtime.spec.ts
# → 849:      expect(Object.keys(TAVERN_EVENTS)).toHaveLength(82)
```

⇒ **该守卫生效且确实在测试套件内**（随 `pnpm test` 跑），W64 的修正也是真的。

**⚠️ 但 `V0.3-FREEZE.md` 有一处独立于 §3 的过期**：L62「**明确不进 v0.3**：DSH **0.1.3 升级**（等 rc 修掉官方性能回退…）」—— runtime 现已到 `0.1.7-rc.1`，0.1.3 早已越过。该句作为「当时决策记录」尚可读，但未标注已失效。判 🟡，登记为 **D-18**。

---

## 三、勘误与自我纠错（避免把审计自身的失误写进清单）

审计过程中有 3 处**初判为偏差、复核后推翻**，如实登记以说明判据口径：

1. **`TH_UNSUPPORTED_APIS` 条数**：首版用「按行取字符串」的粗糙脚本数出 `23`，与文档的 81 差得离谱。
   复核发现该脚本**把注释行里的引号文本也算了进去**（反之为少算）。改用**括号配对取数组体 + 正则抽标识符**后得 **81**，与 `V0.3-FREEZE.md:36` 一致。
   ⇒ **教训（对应本仓 P-41 推论四「解析出来的事实比读出来的事实多一层失效面」）**：数数的脚本自己要先被验证。

2. **`ARCHITECTURE.md:126` 的平台补丁脚本路径**：初判「相对路径写错」。复核：该文档位于 `docs/`，而它写的是 `rp-workspace/scripts/apply-platform-patches.py`——从**仓库根**看正是正确位置，且 `ls` 命中。⇒ **推翻，非偏差**（保留为 D-12 勘误行）。

3. **`pnpm exec vitest` 首跑报错**：首次尝试得到 `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR / 拒绝访问 (os error 5)`，一度怀疑是环境权限问题。
   复核：该目录 `node_modules` 处于**半残状态**（10 个条目为悬空链接：`esbuild/esbuild/jquery/jquery-ui/jsdom/jszip/lodash/typescript/vitest/yaml/zod`），`pnpm exec` 尝试修复时失败。改用文档指定的 `npx -y pnpm@10 install --frozen-lockfile` 后正常安装。
   ⇒ **非文档缺陷，是本次审计起点的工作区残态**，不登记为偏差；但它**恰好是 D-07 的成因线索**（未声明的直接依赖在净环境下暴露）。

---

## 四、未实测清单（按铁律 2 显式标注，不得当作「已验证」）

以下项本次**未实测**，如实留白，不写成结论：

1. `docs/GOAL.md:80` 的 P 判据累计条数 `P-1 ~ P-82` 与方法论 §5.4 实际定义条数的逐条比对 —— 未跑 `audit-goal-sections.mjs`。
2. `docs/GOAL.md:74` 门禁清单里**约 40 项** selftest 分数（`A11 20/20`、`A15 7/7`、`selftest-claims 136/136`、`baseline-claims 90/90`、`doc-refs 83/83` 等）—— 这些需跑完整构建链（小时级），本次**未跑**。
3. `docs/GOAL.md:75` sentinel **v390** —— 未核对当前产物 sentinel。
4. `docs/GOAL.md:76` M4 产物核验 **169 项 / 缺失 0** —— 未跑 `verify-apk-payload.py`。
5. `docs/GOAL.md:77` M7 真实卡抽样 **62 PASS / 0 FAIL / 19 SKIP** —— 需设备（adb），本机未接真机，**未跑**。
6. `README.md:93`「151MB 会话约 1.7 秒」等**设备侧性能读数** —— 未实测。
7. `README.md:35`「首次启动要解压约 2.4 万个文件」 —— 未实测（`GOAL-DSH-ANDROID-COMPLETE` 另处写 `24,453 文件 / ≈350 秒`，**两个数字量级一致**，但均未由本次复核）。
8. `GOAL-ANDROID-GAP-2026-09-21.md:157` 的 `LanProxy` 实现位置 —— 未穷举，见 §二.4。
9. `release-notes-0.2.7.md` 与 `docs/DSH-UPGRADE-AUDIT-2026-09-23.md` 的内容一致性 —— **不在本次分配范围**，未读。

---

## 五、文档可信度总评

### ✅ 可信的面（有机器守 / 抽查全部命中）

1. **`docs/V0.3-FREEZE.md` §3 的 API 条数** —— 34/41/75/81 四个数字与源码逐一吻合；且它**主动记录了 W59/W64 两次自我纠错**，包括「该数不得写成常量」这类形态纪律。**这是全仓最值得信任的量化声明。**
2. **机器守卫的声明** —— `tavern_events` 82 项确实由 `th-script-runtime.spec.ts:849` 的 `toHaveLength(82)` 守着（且该规格在 86 文件全绿套件内）。W64 自查「原以为由 `audit-card-event-surface.mjs` 守、实则该脚本构建期零引用」也属实。
3. **`docs/GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md` 的完成声明** —— 它**主动推翻了自己此前的 ✅**（W-3 `exec()` 恒返 `NOT_IMPLEMENTED`），并为防复发建了常驻门禁。抽查 `EXEC_WIRED=true`、`w3-device-plugin` 22 条 `it()` 均与声明一致。**诚实度最高的一份文档。**
4. **`ST-COMPAT-PACT.md` 的契约条款** —— B1/B2/E1/E7/§5.4 抽样的 5 处引用与代码逐一命中，未发现悬空。
5. **`ARCHITECTURE.md` 的目录级路径** —— 15 个目录全部命中；文件级 16 项中 14 项命中（2 项偏差见 D-13）。

### ❌ 已系统性背离的面

1. **🔴 版本号（README 门面）** —— 中英双语、第 8 行与第 329 行，**双双停在 0.2.2 / 0.1.5-rc.1**，落后 **5 个 patch 版本 + 2 个 runtime 代次**（0.2.2 → 0.2.7；0.1.5-rc.1 → 0.1.7-rc.1），而 HEAD 提交本身就叫「v0.2.7 release notes」。仓库根还躺着 `DSH-Tavern-0.2.7-*.apk` 与 `release-notes-0.2.7.md`。
   ⇒ **这是仓库里唯一「任何人打开首页就会看到错」的地方**，也是本次最该先修的一条。
   **为什么它会漂**：`README.md` **不在任何版本一致性门禁的扫描面内**——`dsh-version.json` 的 `_howToChange` 只说「升级 runtime 时必须同步改本文件」（指它自己），并未约束 README。**这是「单源」纪律未覆盖到文档面的结构性缺口**，与 GOAL §七 R21 想解决的问题同源，只是漏了 README 这一格。

2. **🔴 测试条数（三份贡献者文档 4 处 + GOAL §3.1）** —— `1839/1841`（×3）与 `1790/81`（×1）vs 实测 `1846/1848`、`86` 文件。
   GOAL §3.1 尤其刺眼：它的**标题行就在同页写着「不许沿用旧数字」**。
   ⇒ 与 `README.md` 同源：这些数字**没有机器守**。`GOAL.md:2779` 自己承认过「§3.1 基线数字自身无机器守」，W45 建了 `audit-baseline-claims.mjs` —— 但该脚本的**诚实划界**（同在 L2779）明写：「**vitest / typecheck / M7 不核**（耗时数分钟 / 需 adb）⇒ 只做**形态断言**」。**这正是为什么 1790→1846 一路漂了 56 条都没人发现**：守门人**被设计成不看这个数**。这是一处**已知并已登记的盲区**，不是疏漏，但后果就是本报告 D-03~D-08 这一整片。

3. **🔴 贡献者入口的可复现性（D-07，本次新增）** —— 不是数字错，是**路径断**：按 `CONTRIBUTING.md:15-19` 逐字执行得到 `6 failed | 80 passed (86)`，而同一份文档紧接着写「如果这里不是全绿：先别往下走，开个 Issue」。
   ⇒ **文档把「自己缺一步」的后果，写成了「你的环境有问题」**。这是本次体检里**对真实贡献者伤害最直接**的一条，也是唯一一条「照做就必然踩坑」的偏差。CI 的三步（install → `vendor-deps.mjs` → test）与文档的两步不一致，是本条的根因。

### 综合判断

本仓文档呈现**明显的两极分化**：

- **「有判据装置守着」的面高度可信**（兼容契约引用、机器守卫声明、API 条数、GOAL-DSH 的完成声明）—— 因为项目真的为它们建了常驻门禁和负控，而且 **W59/W64/W54 等条目记录了多次自我推翻**，说明这些守卫在**实际工作**。
- **「只靠人记得改」的面已系统性背离**（版本号、测试条数、贡献者复现步骤）—— 恰好落在**守门人明确声明「不核」或「不在扫描面内」**的格子里。
  `audit-baseline-claims.mjs` 的「vitest 不核」是一个**为了守 P-38（防假红）而刻意留的洞**；这个取舍本身合理，但**没有任何替代装置补上它**，于是 56 条测试的漂移无人发现。

**结论**：本仓文档的**可信度不是均匀的，而是可以由「该面有没有机器守」精确预测的**。
凡有门禁守着 → 可信；凡门禁声明「不核」或从未纳入扫描面 → 已经或正在漂。

**建议优先级**（供后续处置，本次只登记不修改）：

| 优先 | 条目 | 理由 |
|---|---|---|
| 1 | D-01 / D-02 | 首页门面，成本最低、可见度最高 |
| 2 | D-07 | 唯一「照做必踩坑」项，直接伤害贡献者 |
| 3 | D-03 ~ D-06、D-08 | 给上述两个数字加一条机器判据（或至少把 `vendor-deps.mjs` 写进文档） |
| 4 | D-09 ~ D-11、D-17、D-18 | GOAL/V0.3-FREEZE 内部不自洽与常量化的形态问题 |

> **本报告的自律声明**：§四 所列 9 项均为**未实测**，不得被引用为「已验证」。所有 ✅/偏差结论均附可复跑命令；§三 记录了 3 处审计自身被推翻的初判，供复核者校验判据口径。
