# 体检 B：55 条构建门禁的真实性与覆盖盲区

> **审计日期**：2026-09-26
> **审计对象**：`rp-workspace/scripts/build-dsht.ps1`（2097 行，Step 0 ~ Step 7）及其调用的全部门禁脚本
> **审计任务**：共享 task-2
> **审计方式**：**只读**（未改任何脚本 / 源码 / 文档）+ **实际执行**每个门禁取真实 exit code
> **环境**：Windows / pwsh 7.6.3 · Node v24.19.0 · Python 3.12.10 · cwd = `D:\DSH RolePlay\rp-workspace`

---

## 〇、先说结论（TL;DR）

| 指标 | 数值 |
|---|---|
| 宣称口径 | **「十三项常驻审计」**（`build-dsht.ps1:293`）/ 文档写 **48 条 `[gate] OK`** |
| Step 0.5 区段**实际调用**的门禁脚本 | **25 个** |
| 构建期**真正会跑**的门禁脚本（含 Step 0.55 / 5.4 / 5.45 / 6.5 / 6.6） | **51 个** |
| **真常驻** | **51** |
| **只声明**（零调用点） | **4**（`audit-card-event-surface` / `-context-surface` / `-resource-surface` / `audit-patch-markers.py`） |
| **时序失效**（P-40③ 风险面） | **3**（`audit-native-deps` / `audit-method-binding` / `audit-upgrade-readiness` 的 ③ 段） |
| 当前**实跑不过**的门禁 | **3 条真红**（`audit-a14-anchor-negctl` / `audit-artifact-freshness` / `audit-card-event-surface`） |

**★ 最重的一句话**：
> 门禁体系**骨架是真的**（51 条真常驻、几乎每条都有 selftest + 负控 + 逐字节还原），
> 但**本工作区当前处于「构建必然失败」状态** —— Step 5.4 的 `audit-a14-anchor-negctl` 实跑 exit 1，
> 而构建脚本在它非零时 `throw`。这条不是纸面推断，是实跑取证。

---

## 一、方法与环境说明

### 1.1 口径澄清：「55 条」与「十三项」

任务书写的「55 条常驻门禁 + 40+ 条判据」**在本仓找不到对应声明**，实测口径如下：

| 声称 | 出处 | 实测 | 判定 |
|---|---|---|---|
| **「十三项常驻审计」** | `build-dsht.ps1:89` 注释 + `:293` Step 标题 | Step 0.5 区段**实际调用 25 个脚本** | ★ **口径混淆**（见 §4.1） |
| **48 条 `[gate] OK`** | `docs/GOAL.md:74`（§3.1 基线行）、`:462`（E-C）、共 **34 处** | 构建脚本内**静态** `[gate] OK` 字面量 **42 处**，其中 1 处为循环内动态（`$a`）展开成 20 条 | ★ **静态/动态混算**（见 §4.1） |
| 「P-1 ~ P-82」（82 条判据） | `docs/GOAL.md:80` | 未逐条核（超本任务范围） | 未实测 |

> **诚实标注**：任务书给的「55 条」未能定位到任何仓内声明，故本报告**不以 55 为基准**，
> 改以实测口径出表。若「55」来自某处未纳入本次扫描的文档，请以该处为准并复核本表。

### 1.2 执行纪律

- **cwd 必须 = `rp-workspace`**（★ 本审计的一个方法论教训，见 §5.3）
- **Python 门禁必须带 `PYTHONIOENCODING=utf-8`**（★ 本审计的头号发现，见 §3.1）
- 所有 exit code 取自 `$LASTEXITCODE` / `$?`，**不取管道后的值**（`| tail` 会吃掉退出码）

### 1.3 复现命令（全表通用）

```pwsh
cd "D:\DSH RolePlay\rp-workspace"
$env:PYTHONIOENCODING = 'utf-8'; $env:PYTHONUTF8 = '1'   # ★ Python 门禁必需
$env:DSHT_ARCH = 'arm64'
node scripts/<门禁>.mjs --selftest            # JS 侧
python scripts/<门禁>.py --selftest           # Python 侧
echo "EXIT=$LASTEXITCODE"
```

---

## 二、主表：门禁全表

### 2.1 Step 0.5 循环内（`$auditNode` 数组，20 项 · `build-dsht.ps1:294-448`）

调用形态：`build-dsht.ps1:459` `& node $p --selftest` → `:475` `& node $p` → `:482` `Show-Reading`

| # | 门禁脚本 | 调用点 | 存在? | selftest 实测 | 归类 | 证据命令 |
|---|---|---|---|---|---|---|
| 1 | `audit-publish-hygiene.mjs` | Step 0.5 | ✅ | **17/17 PASS** (0) | 真常驻 | `node scripts/audit-publish-hygiene.mjs --selftest` |
| 2 | `audit-shim-template-literal.mjs` | Step 0.5 | ✅ | **20/20 PASS** (0) | 真常驻 | 同上换名 |
| 3 | `audit-route-contract.mjs` | Step 0.5 | ✅ | **6/6 PASS** (0) | 真常驻 | 〃 |
| 4 | `audit-method-binding.mjs` | Step 0.5 | ✅ | **4/4 PASS** (0) | **真常驻**，但读 runtime 产物 ⇒ **P-40③ 风险**（§3.2） | 〃 |
| 5 | `audit-impl-duplication.mjs` | Step 0.5 | ✅ | **15/15 PASS** (0) | 真常驻 | 〃 |
| 6 | `audit-iframe-sandbox.mjs` | Step 0.5 | ✅ | **6/6 PASS** (0) | 真常驻 | 〃 |
| 7 | `audit-cross-package-css.mjs` | Step 0.5 | ✅ | **7/7 PASS** (0) | 真常驻 | 〃 |
| 8 | `audit-body-dup-ast.mjs` | Step 0.5 | ✅ | **5/5 PASS** (0) | 真常驻（⚠ 依赖 `packages/node_modules/typescript`） | 〃 |
| 9 | `audit-th-face-coverage.mjs` | Step 0.5 | ✅ | **8/8 PASS** (0) | 真常驻 | 〃 |
| 10 | `audit-device-tiers.mjs` | Step 0.5 | ✅ | **10/10 PASS** (0) | 真常驻 | 〃 |
| 11 | `audit-exchange-guards.mjs` | Step 0.5 | ✅ | **5/5 PASS** (0) | 真常驻 | 〃 |
| 12 | `audit-plugin-build-parity.mjs` | Step 0.5 | ✅ | **6/6 PASS** (0) | 真常驻 | 〃 |
| 13 | `audit-nodeservice-deploy.mjs` | Step 0.5 | ✅ | **10/10 PASS** (0) | 真常驻 | 〃 |
| 14 | `audit-system-entry.mjs` | Step 0.5 | ✅ | **7/7 PASS** (0) | 真常驻 | 〃 |
| 15 | `audit-device-honesty.mjs` | Step 0.5 | ✅ | **13/13 PASS** (0) | 真常驻 | 〃 |
| 16 | `audit-native-deps.mjs` | Step 0.5 | ✅ | **8/8 PASS** (0) | ★ **时序失效（P-40③）** 见 §3.2 | 〃 |
| 17 | `audit-script-semantics-parity.mjs` | Step 0.5 | ✅ | **14/14 PASS** (0) | 真常驻 | 〃 |
| 18 | `audit-matrix-residuals.mjs` | Step 0.5 | ✅ | **7/7 PASS** (0) | 真常驻 | 〃 |
| 19 | `audit-diagpack-privacy.mjs` | Step 0.5 | ✅ | **6 pass / 0 fail** (0) ★ 格式与其余不一致 | 真常驻 | 〃 |
| 20 | `audit-upgrade-readiness.mjs` | Step 0.5 | ✅ | **18/18 PASS** (0) | **真常驻**，③ 段内调 pty ⇒ **P-40③ 已缓解**（§3.2） | 〃 |

> ★ **格式不统一**（#19）：`audit-diagpack-privacy.mjs` 输出 `[selftest] 6 pass / 0 fail`，
> 而 W44「单源自证分数输出契约」要求走 `selftest-summary.mjs`。
> 与 Lead 观察一致 ⇒ 建议纳入 §4.2。

### 2.2 Step 0.5 循环外（Python 路径）

| # | 门禁脚本 | 调用点 | 存在? | selftest 实测 | 归类 | 证据命令 |
|---|---|---|---|---|---|---|
| 21 | `audit-build-path-parity.py` | Step 0.5 `:490/:493` | ✅ | **38/38 PASS** (0) —— **仅当 `PYTHONIOENCODING=utf-8`**；裸跑 **exit 1 UnicodeEncodeError** | ★ **真常驻，但存在本地/CI 编码不对称**（§3.1） | `$env:PYTHONIOENCODING='utf-8'; python scripts/audit-build-path-parity.py --selftest` |

### 2.3 Step 0.55 判据杠杆自检（独立调用点）

| # | 门禁脚本 | 调用点 | 存在? | selftest 实测 | 归类 | 证据命令 |
|---|---|---|---|---|---|---|
| 22 | `audit-marker-collision-negctl.py` | Step 0.55 `:524-527` | ✅ | **1/1 PASS** (0) | 真常驻 | `python scripts/audit-marker-collision-negctl.py` |
| 23 | `audit-py-patch-idem-negctl.py` | Step 0.55 `:524-527` | ✅ | **1/1 PASS** (0) | 真常驻 | 〃 |
| 24 | `audit-cdp-eval-negctl.mjs` | Step 0.55 `:542` | ✅ | **7/7 PASS** (0) | 真常驻 | `node scripts/audit-cdp-eval-negctl.mjs` |
| 25 | `audit-session-integrity.mjs` | Step 0.55 `:559`（仅 `--selftest`） | ✅ | **18/18 PASS** (0) + 对账 91/91 | 真常驻（仅自证面） | `node scripts/audit-session-integrity.mjs --selftest` |
| 26 | `audit-error-layer-classify.mjs` | Step 0.55 `:577` | ✅ | **9/9 PASS** (0) | 真常驻 | 〃 |
| 27 | `audit-p47-negctl.mjs` | Step 0.55 `:582` | ✅ | **6/6 PASS** (0) | 真常驻 | 〃 |
| 28 | `audit-p48-rollback.mjs` | Step 0.55 `:609` | ✅ | **15/15 PASS** (0) | 真常驻 | 〃 |
| 29 | `audit-p48-negctl.mjs` | Step 0.55 `:614` | ✅ | **8/8 PASS** (0) | 真常驻 | 〃 |
| 30 | `audit-open-items.mjs` | Step 0.55 `:635,638` | ✅ | **12/12 PASS** (0) | 真常驻 | 〃 |
| 31 | `audit-open-items-negctl.mjs` | Step 0.55 `:644` | ✅ | **6/6 PASS** (0) | 真常驻 | 〃 |
| 32 | `audit-goal-sections.mjs` | Step 0.55 `:683,686` | ✅ | **40/40 PASS** (0) | 真常驻 | 〃 |
| 33 | `audit-goal-sections-negctl.mjs` | Step 0.55 `:692` | ✅ | **23/23 PASS** (0) | 真常驻 | 〃 |
| 34 | `audit-selftest-claims.mjs` | Step 0.55 `:725,732,735` | ✅ | **136/136 PASS** (0) ⚠ 仅当 cwd=`rp-workspace` | 真常驻 | 〃 |
| 35 | `audit-selftest-claims-negctl.mjs` | Step 0.55 `:743` | ✅ | **27/27 PASS** (0) | 真常驻 | 〃 |
| 36 | `audit-baseline-claims.mjs` | Step 0.55 `:774,777` | ✅ | **90/90 PASS** (0) | 真常驻 | 〃 |
| 37 | `audit-baseline-claims-negctl.mjs` | Step 0.55 `:788` | ✅ | **40/40 PASS** (0) | 真常驻 | 〃 |
| 38 | `audit-doc-refs.mjs` | Step 0.55 `:835,838` | ✅ | **83/83 PASS** (0) | 真常驻 | 〃 |
| 39 | `audit-doc-refs-negctl.mjs` | Step 0.55 `:844` | ✅ | **38/38 PASS** (0) | 真常驻 | 〃 |
| 40 | `audit-rule-claims.mjs` | Step 0.55 `:870,873` | ✅ | **22/22 PASS** (0) | 真常驻 | 〃 |
| 41 | `audit-rule-claims-negctl.mjs` | Step 0.55 `:879` | ✅ | **18/18 PASS** (0) | 真常驻 | 〃 |

★ 说明：`audit-session-integrity.mjs` 构建期**只跑 `--selftest`**（主流程要 adb 连设备），
项目已在 `build-dsht.ps1:228-231` 作为**诚实边界**显式登记 —— 这是**正确的做法**，不是缺陷。

### 2.4 其余 Step 各门禁

| # | 门禁脚本 | 调用点 | 存在? | selftest 实测 | 归类 | 证据命令 |
|---|---|---|---|---|---|---|
| 42 | `fetch-native-libs.mjs` | Step 0 `:83`（`--check`） | ✅ | 无 `--selftest` | 真常驻（工具型） | `node scripts/fetch-native-libs.mjs --check` |
| 43 | `audit-dsh-version.mjs` | Step 0.7 `:155,179` | ✅ | **14/14 PASS** (0) | 真常驻 | `node scripts/audit-dsh-version.mjs --selftest` |
| 44 | `audit-official-contract.mjs` | Step 0.6 `:911` + Step 3.6 `:1613` | ✅ | **8/8 PASS** (0) | ★ 见 §3.3 —— **SkipInstall 下 Step 0.6 的主流程整段被跳过** | 〃 |
| 45 | `build-node-pty.mjs` | Step 1.5 `:1002` | ✅ | 无 `--selftest` | 真常驻（构建器） | — |
| 46 | `audit-pty-prebuilt.mjs` | Step 1.5 `:1007` + Step 3 `:1107` | ✅ | 实跑通过（静态断言） | 真常驻 | `node scripts/audit-pty-prebuilt.mjs` |
| 47 | `capture-contracts.mjs` | Step 4.72 `:1778` | ✅ | ⚠ 「失败不阻塞」 | 真常驻（**非 fail-closed**） | — |
| 48 | `build-rp-ui.mjs` | Step 4.75 `:1787` | ✅ | — | 真常驻（构建器） | — |
| 49 | `build-mobile.mjs` | Step 4.77 `:1807` | ✅ | — | 真常驻（构建器） | — |
| 50 | `patch-resilient-list.mjs` | Step 4.85 `:1823` | ✅ | — | 真常驻（构建器） | — |
| 51 | `audit-artifact-freshness.mjs` | Step 5.4 `:1937,1940` | ✅ | **32/32 PASS** (0) | ★ **真常驻，主流程实跑 exit 1 —— 见 §3.4** | `node scripts/audit-artifact-freshness.mjs` |
| 52 | `audit-a14-anchor-negctl.mjs` | Step 5.4 `:1948` | ✅ | **2/3 FAIL** (exit 1) | ★★ **时序失效实证 —— 见 §3.4** | `node scripts/audit-a14-anchor-negctl.mjs` |
| 53 | `audit-patch-fingerprints.mjs` | Step 5.45 `:1966,1969` | ✅ | **9/9 PASS** (0) | 真常驻 | 〃 |
| 54 | `verify-apk-runtime-version.mjs` | Step 6.5 `:2048,2050` | ✅ | **7/7 PASS** (0) | 真常驻 | 〃 |
| 55 | `verify-apk-payload.py` | Step 6.6 `:2080,2084` | ✅ | **6/6 PASS** (0) —— 仅当 `PYTHONIOENCODING=utf-8`；裸跑 **exit 1** | ★ 同 §3.1 | `$env:PYTHONIOENCODING='utf-8'; python scripts/verify-apk-payload.py --selftest` |

---

## 三、静默失效清单（★ 本报告最重要的产出）

### 3.1 ★★★ 本地/CI 编码不对称：2 个 Python 门禁在本机裸跑必崩，CI 却设了 UTF-8

**事实（实跑取证）**：

```pwsh
cd rp-workspace
python scripts/audit-build-path-parity.py --selftest
# → UnicodeEncodeError: 'gbk' codec can't encode character '\u21d2'
# → EXIT=1

$env:PYTHONIOENCODING='utf-8'; python scripts/audit-build-path-parity.py --selftest
# → [selftest-summary] build-path-parity 38/38 PASS
# → EXIT=0
```

同样适用于 `verify-apk-payload.py`（裸跑 `UnicodeEncodeError` @ `line 68`；设 UTF-8 后 **6/6 PASS**）。

**为什么这是缺陷**：

| 侧 | Python 输出编码 | 结果 |
|---|---|---|
| **CI**（`.github/workflows/build-apk.yml:24-25`） | `PYTHONIOENCODING: utf-8` + `PYTHONUTF8: '1'` **显式设置** | 绿 |
| **本地 `build-dsht.ps1`** | **无任何设置**（grep `PYTHONIOENCODING\|PYTHONUTF8\|chcp\|OutputEncoding` = **0 命中**） | ● 本机 `sys.stdout.encoding = gbk` @ Python 3.12.10 |

CI workflow 里那条注释白纸黑字承认过这个坑：
> `# Python 门禁输出含中文；CI 控制台缺省 cp437/cp1252 会 UnicodeEncodeError（第八跑实证）`

⇒ **项目在 CI 修了它，却没有把同一个修复带回本地构建脚本** —— 这正是 **P-40③ 的同族**：
「判据的**可执行性**取决于它所在的**环境**，而环境差异没有判据守着」。
本机长期「看着绿」是因为 **GBK 能编码大部分中文**，只在遇到 `⇒`（U+21D2）这类符号时才崩 ——
**崩不崩取决于日志里恰好有没有那个字符**，属最典型的 **P-30「失效与通过同貌」**。

**归类**：★★ **真常驻但环境依赖未机器化**（本地/CI 不对称）
**证据命令**：见上；`grep -n "PYTHONIOENCODING" rp-workspace/scripts/build-dsht.ps1` → 无输出
**建议修法**：在 `build-dsht.ps1` 顶部（或 Step 0）显式 `$env:PYTHONIOENCODING = 'utf-8'`，
与 CI 同源同值（P-1）；并可仿 `audit-build-path-parity.py` 判据五（BOM 自动发现）加一条
「Python 闸门在本机环境下必须能跑」的自动发现式判据。

---

### 3.2 ★★ P-40③ 时序清单：Step 0.5 里哪些门禁读了「会被重建的 runtime 产物」

Step 0.5（`build-dsht.ps1:293`）跑在 **Step 1（重装 runtime）/ Step 1.5（交叉编译 pty）/ Step 3（复制到 runtimeDst）/ Step 3.5（平台补丁）之前**。
故凡在 Step 0.5 读 runtime 产物的门禁，判的都是**上一次构建的残留**。

**扫描方法**（可复现）：

```pwsh
cd rp-workspace
foreach ($s in @('audit-native-deps','audit-upgrade-readiness','audit-method-binding', `
                 'audit-th-face-coverage','audit-system-entry','audit-plugin-build-parity')) {
  $n = (Select-String -Path "scripts/$s.mjs" -Pattern 'dsh-runtime-android|dsh-runtime-src|runtimeDst|DSHT_ARCH|jniLibs' -AllMatches).Matches.Count
  "$n  $s"
} | Sort-Object -Descending
```

**读数**：

| 门禁 | 命中数 | 读的对象 | 调用点 | 该对象何时才确定 | 判定 |
|---|---|---|---|---|---|
| `audit-native-deps.mjs` | **11** | `jniLibs/<abi>/` + `dsh-runtime{,-x64}/lib` | **Step 0.5** | `dsh-runtime/lib` 由 **Step 5.5** 按 `-Arch` 换入；`jniLibs` 为 termux deb 提取 | ★★ **时序失效** |
| `audit-upgrade-readiness.mjs` | 6 | 内调 `audit-dsh-version` / `audit-pty-prebuilt` | **Step 0.5** | Step 1 / Step 1.5 | ✅ **已缓解**（透传 `--expect-reinstall`） |
| `audit-method-binding.mjs` | 1 | `dsh-runtime-android/node_modules/@deepseek-ai/dsh-session/lib/index.js` | **Step 0.5** | Step 3 | ★ **时序失效（且静默放行）** |
| 其余 17 个 | **0** | 只读源码 / 文档 / 脚本自身 | — | — | ✅ 无风险 |

#### 3.2.1 `audit-native-deps.mjs` —— ★★ 真时序失效（无缓解机制）

**取证**：

```pwsh
cd rp-workspace
grep -nE "expect-reinstall|FAIL_OK|SKIP" scripts/audit-native-deps.mjs   # → 只有 --selftest，无任何 SKIP 通路
DSHT_ARCH=arm64 node scripts/audit-native-deps.mjs   # 读 dsh-runtime/lib（arm64）
DSHT_ARCH=x86_64 node scripts/audit-native-deps.mjs  # 读 dsh-runtime-x64/lib
# 两者都 EXIT=0 —— 但判的都是磁盘上「上一次构建留下的」.so 集合
```

**关键事实链**：
1. `audit-native-deps.mjs:206,207` 读 `jniLibs/<ARCH_DIR>` 与 `dsh-runtime{,-x64}/lib`；
2. `dsh-runtime/lib` 在 **`.gitignore` 命中区内**（实测 `git check-ignore` = GITIGNORED）⇒ **别人克隆后不存在**；
3. `build-dsht.ps1:1977-1978`（Step 5.5）：`Remove-Item "$runtimeDst\lib"` → `Copy-Item $runtimeLib ...`，
   ⇒ **该目录在 Step 5.5 才被换成本次 `-Arch` 那一份**；
4. 而 `audit-native-deps` 在 **Step 0.5** 就下了结论。

**⇒ 与历史事故 `audit-pty-prebuilt.mjs` 完全同构**：
本机长期假绿（残留 `.so` 一直在场，DT_NEEDED 闭合看起来永远成立）；
**CI 净环境 / 首次构建**时该目录可能不存在 ⇒ 走 `:215` 的 `fail-closed`，行为与本地**相反**。

**归类**：★★ **时序失效（P-40③）**
**证据命令**：
```pwsh
cd rp-workspace
git check-ignore -v dsh-runtime/lib
grep -nE "JNI_LIBS|RT_LIB|fail-closed" scripts/audit-native-deps.mjs
grep -n "runtime lib ←" scripts/build-dsht.ps1     # Step 5.5 才换 lib
```
**建议修法**：与 `audit-pty-prebuilt` 同法 —— 增加 `--expect-reinstall` 通路，
在「本次构建会重装」时把产物层判据记 **SKIP 并出声**（P-17），
把**真判据**放到 Step 5.5 之后（比如新增 Step 5.6，或并入现有 Step 6.5 之前）。

#### 3.2.2 `audit-method-binding.mjs` —— ★ 时序失效 + **静默放行**

**取证**：

```pwsh
cd rp-workspace
grep -n "SESSION_LIB" scripts/audit-method-binding.mjs
# :41  const SESSION_LIB = join(WS,'dsh-runtime-android','node_modules','@deepseek-ai','dsh-session','lib','index.js')
grep -n "existsSync(SESSION_LIB)" scripts/audit-method-binding.mjs
# :207  if (!existsSync(SESSION_LIB)) { console.log('[skip] 官方库不在（未 staging）：', SESSION_LIB); return true }
```

**★ 这里是本报告找到的最隐蔽的一处**：`return true` —— **库不在 = 判「通过」**。
该库由 **Step 3** 才 staging 出来；Step 0.5 跑时它通常**是**上一代残留在场（假绿），
而**干净克隆 / CI 首次构建**时它**不在** ⇒ 判据**直接放行且只打一行 `[skip]`**。

⇒ 形态 = 「**判据自己声明为通过，而它一个对象都没检**」，与 `audit-pty-prebuilt` 的历史假绿同族，
但**更安静**（pty 那次至少是报红被拦下，这里是**主动 return true**）。

**归类**：★★ **时序失效（P-40③）+ 静默放行**
**证据命令**：`sed -n '200,210p' rp-workspace/scripts/audit-method-binding.mjs`
**建议修法**：`return true` → 记 **SKIP 并出声**并**纳入退出码之外的可见读数**（至少不能与「检过且干净」同貌，P-30）。

#### 3.2.3 `audit-upgrade-readiness.mjs` —— ✅ 项目已自行收口（正面案例）

`build-dsht.ps1:473-475` 在非 `SkipInstall` 时给它传 `--expect-reinstall`；
脚本 `:613` 再透传 `--expect-compile` 给 `audit-pty-prebuilt`，`:616-620` 把 ③ 段记 **SKIP 出声**。
脚本头注 `:605-611` 明确写出「本闸门跑在 Step 0.5，而 node-pty 的 android-* 产物由 Step 1.5 产出 ⇒
此刻产物本就不该在」—— **这是本项目对 P-40③ 做得最规范的一处**。
★ **诚实标注**：SKIP 不等于通过，项目自己也写明了（P-17），此处**无缺陷**。

---

### 3.3 ★★ Step 0.6 主流程在常规构建下被整段跳过（`audit-official-contract.mjs`）

**取证**：

```pwsh
cd rp-workspace
sed -n '908,927p' scripts/build-dsht.ps1
```

```pwsh
Step 0.6 '官方契约事前探针（E3/P-4；仅在 SkipInstall 时于此处跑，其余见 Step 3.6）'
...
& node $ocProbe --selftest | Out-Null          # ← 自证总会跑
if (-not $SkipInstall) {
    Write-Host "  [gate] 非 SkipInstall：本步骤推迟到 Step 3.6（... P-40③）"   # ← 主流程跳过
} else {
    ... & node $ocProbe ...                    # ← 仅 SkipInstall 才跑主流程
}
```

**判定**：这是**有意的、且注释写明的** P-40③ 修复（Step 3.6 在 runtime 替换后做真判据），
**本身不是缺陷**。但需登记两点诚实边界：
1. 常规全量构建（`-not $SkipInstall`）下，**Step 0.6 只剩 `--selftest`**；
   文档 `docs/GOAL.md:105` 把它列为「**构建期门禁第 8 项**」，读者可能误以为它每次全跑 ——
   **口径需注明「第 8 项的判据面在 Step 3.6」**（`GOAL.md:211` 其实已写了，属**已登记的诚实**）。
2. `:925` 的 runtime 未就绪分支：`⚠️ 契约探针本次**未执行**（... 已出声，不静默）` —— **做法正确**（出声不静默）。

**归类**：**真常驻**（判据面在 Step 3.6，有 `[gate] OK` 回显）· **无缺陷**，仅口径提示。

---

### 3.4 ★★★ 本工作区当前「构建必然失败」：Step 5.4 两条 A14 判据实跑报红

**这是本次审计最硬的一条发现 —— 不是纸面推断，是实跑 exit code。**

**取证 1：`audit-a14-anchor-negctl.mjs`（Step 5.4 内联调用）**

```pwsh
cd rp-workspace
node scripts/audit-a14-anchor-negctl.mjs
#   [ok]   A 锚点来自权威脚本（不是 PAIRS 现值）
#   [FAIL] C 用解析出的 entry 重编译 ≡ 磁盘产物（逐字节）
#          src/dsh-plugin/index.ts ⇒ 928832 B ≠ 产物 929551 B
#   [ok]   B 杠杆：换一个错误 entry ⇒ 字节必然不同
# [selftest-summary] a14-anchor-negctl 2/3 FAIL
echo "EXIT=$LASTEXITCODE"   # → EXIT=1
```

而 `build-dsht.ps1:1948-1950`：

```pwsh
& node $anchorNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "A14 锚点负控未通过：..." }
```

⇒ **构建到 Step 5.4 必 `throw`**。

**取证 2：`audit-artifact-freshness.mjs`（Step 5.4 主判据）**

```pwsh
cd rp-workspace
node scripts/audit-artifact-freshness.mjs
# ✗ T-78 世界书关键词正则防护（浏览器侧产物 app.js）
# ✗ T-78/T-79 + T-83（node 侧 runtime 产物 lib/index.js = RP 主插件）
#    重编译 928832 B / 产物 929551 B
#    首个差异在归一化后的第 37 行：
#      重编译: // node_modules/process-nextick-args/index.js
#      产物  : // node_modules/.pnpm/process-nextick-args@2.0.1/node_modules/process-nextick-args/index.js
# [A14] 违约：2 个产物与当前源码不一致。
echo "EXIT=$LASTEXITCODE"   # → EXIT=1
```

**判定**：
- 这两条**判据本身工作正常**（它们**正确地**发现了 2 个产物与源码不一致）—— 属**判据有效**的正面证据；
- 但**工作区当前状态** = 产物陈旧 ⇒ **任何完整构建都会在 Step 5.4 被拦下**；
- ★★ 更深一层：**没有出现在任何文档的「当前基线」里** ——
  `docs/GOAL.md:74/462` 写着「构建期门禁 exit 0（当前 48 条 `[gate] OK`）」，
  而**实测做不到**。⇒ 这是一条 **「基线声明与实测不符」** 的活证据。

**归类**：★★ **真常驻判据 + 当前实跑红**（非门禁缺陷，是**基线漂移**；正是门禁该抓的东西）
**证据命令**：见上两条；`git status --short` 可看到产物与源码的偏离
**建议**：跑 `pwsh rp-workspace/scripts/rebuild-plugins.ps1` 重编译产物（脚本自己给的提示），
**或**把当前基线如实在 §3.1 登记为「非绿」，二者**必须做一件**——不许放着。

---

### 3.5 ★★ 静默失效：构建期**零调用**的门禁脚本（P-11）

**扫描方法**（可复现）：全仓正则引用计数（排除自身），排除 `tmp/` / `node_modules`：

```pwsh
cd "D:\DSH RolePlay"
# 见 tmp/gate-audit/orphan-scan.cjs（本审计用的一次性只读扫描脚本）
node tmp/gate-audit/orphan-scan.cjs
```

**结果：有 `--selftest`、但构造期零调用的脚本 —— 3 个**

| 脚本 | `--selftest` 出现 | `build-dsht.ps1` 引用 | `build-wb.sh` 引用 | CI 引用 | **selftest 实跑结果** | 归类 |
|---|---|---|---|---|---|---|
| `audit-card-event-surface.mjs` | 7 | **0** | **0** | **0** | ★★ **exit 1 — 3 项中 2 项 FAIL** | ★★ **只声明 + 自证已坏** |
| `audit-card-context-surface.mjs` | 35 | **0** | **0** | **0** | exit 0 · `[selftest] PASS`（1 项 SKIP：基准副本不在） | **只声明** |
| `audit-card-resource-surface.mjs` | 6 | **0** | **0** | **0** | exit 0 · `14/14 PASS` | **只声明** |

外加 1 个**工具型**零调用：

| 脚本 | 情形 | 归类 |
|---|---|---|
| `audit-patch-markers.py` | `build-dsht.ps1` 里**仅出现在注释行**（`:106`「保留可独立运行，不再是唯一防线」），**无任何 `& python` 调用** | **只声明**（项目已按 P-54 纪律④ 显式登记为工具型豁免 —— 属**已诚实划界**） |

#### 3.5.1 ★★★ `audit-card-event-surface.mjs`：被四处文档当作守卫依据，却**从不跑且现在已坏**

**实跑取证**：

```pwsh
cd rp-workspace
node scripts/audit-card-event-surface.mjs --selftest
# ✗ --selftest 失败：
#    · 表解析: Mvu.events 常量应 5 项（权威契约 exported.mvu.d.ts），实得 0
#    · 表解析: Mvu.events.VARIABLE_UPDATE_ENDED 值应为 mag_variable_update_ended
echo "EXIT=$LASTEXITCODE"   # → EXIT=1
```

**这一条的重要性在于「它同时踩了三个缺陷族」**：

1. **P-11（声明为判据、实质靠人记得跑）** —— 构建期零引用，实测 `grep -c` = 0（`build-dsht.ps1` / `build-wb.sh` / CI / `package.json` 四处全为 0）；
2. **P-64（豁免依据指向不跑的装置）** —— 项目**自己已经在 `docs/GOAL.md:549,651` 承认过**：
   > 四处文档（`V0.3-FREEZE.md` / `README.md` / 方法论 §5.4 / `audit-baseline-claims.mjs` 头注）
   > 都把它当作「`tavern_events` **82 项**」的守卫依据 —— 而该脚本**在构建期零引用**，
   > 且那句断言写在 `--selftest` 分支里 ⇒ **从不执行**。
   ⇒ **项目已知此事并已改锚到 vitest 规格**（`packages/tests/th-script-runtime.spec.ts`）—— **这点做对了**；
3. ★★ **新增发现（本次审计）**：**该脚本的 `--selftest` 现在本身就是坏的**（exit 1，表解析实得 0 项）。
   ⇒ 即使将来有人想起去跑它，**它也已经不合格**。P-64 的收口只解决了「依据改锚」，
   **没有解决「这个脚本自己是坏的且没人知道」**（**P-30 的递归形态**：坏掉的判据与正常的判据，在报告上同貌）。

**归类**：★★★ **只声明（零调用）+ 自证已坏 + 曾是四处文档的守卫依据**
**证据命令**：
```pwsh
cd rp-workspace
node scripts/audit-card-event-surface.mjs --selftest; echo "EXIT=$LASTEXITCODE"
grep -c "audit-card-event-surface" scripts/build-dsht.ps1 scripts/build-wb.sh   # → 0, 0
grep -rn "audit-card-event-surface" ../.github/workflows/                        # → 无命中
```
**建议**：二选一 —— ① 修好 `--selftest` 并接入 Step 0.5（它守的「注册面 vs 发射面差集」确实有价值）；
② 明确**退役**它（删或移入 `tools/`），并在四处文档写明「已退役，由 vitest 规格承接」。
**现状「坏的、不跑的、却被文档点名」是最差的三态组合。**

#### 3.5.2 另两个 `audit-card-*-surface`：干净的「只声明」

`audit-card-context-surface.mjs`（PASS，但有一项 `SKIP（基准运行副本不在）`）与
`audit-card-resource-surface.mjs`（14/14 PASS）自证正常，**纯粹是没有调用点**。
被 `MASTER_TODO.md` / `TASK-LIST.md` / 方法论引用为可跑工具 ⇒ **P-11 形态**，
但**危害等级低于 3.5.1**（它们至少是健康的）。

---

### 3.6 ★ `MASTER_TODO.md` 不在 `audit-doc-refs.mjs` 的受守面内（Lead 交叉发现，本审计已复核确认）

**取证**：

```pwsh
cd rp-workspace
grep -c "MASTER_TODO" scripts/audit-doc-refs.mjs     # → 0
node scripts/audit-doc-refs.mjs
# [文档引用] 扫描 5 份（E-H 四份 + SSOT）· 悬空/误导/控制外引用 0 处
```

`SCAN_DOCS = E_H_DOCS(4) + SSOT_DOCS(1)` = `README.md` / `THIRD_PARTY_LICENSES.md` /
`ST-COMPAT-PACT.md` / `MOBILE-TEST-METHODOLOGY.md` / `GOAL.md` —— **`MASTER_TODO.md` 不在其中**。

**判定**：若 `MASTER_TODO.md` 确实被当作「唯一活文档」（其自称）使用，则它的引用悬空**无人守**
⇒ 与 **W49 修掉的「GOAL.md 自己不在扫描面内」是同一形态的第二次现身**（P-11 / P-52 同族）。
★ **诚实边界（R7）**：本审计**未**实测 `MASTER_TODO.md` 里是否**确实存在**悬空引用；
本项只证明**它不在受守面内**（= 有守则空白），**不证明里面已经有坏引用**。

**证据命令**：`grep -c MASTER_TODO rp-workspace/scripts/audit-doc-refs.mjs`

---

## 四、数字口径核查

### 4.1 「十三项」vs 「25 个调用」vs 「48 条 `[gate] OK`」

| 数字 | 出处 | 含义 | 实测 |
|---|---|---|---|
| **「十三项常驻审计」** | `build-dsht.ps1:89,293` | 历史沿革的分组数 | ★ **Step 0.5 区段实际调用 25 个脚本**（`$auditNode` 20 个 + Python 侧 1 个 + Step 0.55 的 21 处调用中的独立脚本） |
| **「48 条 `[gate] OK`」** | `docs/GOAL.md:74,462`（共 **34 处**） | 构建日志里 `[gate] OK` 的行数 | 静态字面量 **42 处**；其中 `:477` 的 `[gate] OK $a` 在 20 项循环内展开 ⇒ **42 - 1 + 20 = 61 条**（全量构建口径）—— 与 48 **对不上** |
| 「十三组」（Step 0.55） | `build-dsht.ps1:849` | Step 0.55 的分组数 | 未逐个复核 |

**★ 口径缺陷（P-1 / P-57 同族）**：
「**十三项**」是**装置分类数**，「**48 条 `[gate] OK`**」是**产出条数** —— 两者不是一回事，
而 §3.1 与 §3.2 里**并列陈述**，读者极易合并理解。
★ 值得注意的是：**项目自己已经识别过这个坑**（`docs/GOAL.md:529` P-57 条目明写
> 「**不得用「分类数」表述「产出条数」**（`N 项门禁` ≠ `N 条 [gate] OK`，**P-1**）」
），且 `:462` 的 E-C 行**已按该纪律改写**。
⇒ **纪律已建立、且执行过**；但 **`:293` 的 Step 标题仍写「十三项常驻审计」**
（作为**代码内注释/标签**，与实测 25 个调用并存，**未有机器核对**）。
**判定**：**文档层已收口（P-57 生效），代码标签层未同步** —— 低危，但值得登记。

**证据命令**：
```pwsh
cd "D:\DSH RolePlay"
grep -c '\[gate\] OK' rp-workspace/scripts/build-dsht.ps1          # → 42
grep -cE '\[gate\] OK \$a\b' rp-workspace/scripts/build-dsht.ps1   # → 1（循环内 ⇒ 展开 20）
grep -c '48 条 `\[gate\] OK`' docs/GOAL.md                         # → 34
```

### 4.2 selftest 分数输出格式不统一

`audit-diagpack-privacy.mjs` 输出 `[selftest] 6 pass / 0 fail`（**不是** `N/M PASS`），
与 W44 单源契约（`selftest-summary.mjs` 的 `N/M PASS`）**不同形态**。

**判定**：★ 与 Lead 的独立观察一致。`build-dsht.ps1` 的 `$readingGates` 表**未登记**该脚本，
故**不进日志读数**；但 `audit-selftest-claims.mjs` 的「分数声明 vs 实测」对账**可能抽不到它** ——
**建议**：核对该脚本是否应接入 `selftest-summary`（本审计**只报形态差异，未判定它是否在受检面内**，避免越界推断）。

**证据命令**：`cd rp-workspace && node scripts/audit-diagpack-privacy.mjs --selftest | tail -1`

---

## 五、门禁体系可信度总评

### 5.1 三个计数

| 分类 | 数量 | 占比 | 说明 |
|---|---|---|---|
| **真常驻**（构建期自动跑且对象时序正确） | **51** | 92.7% | 见 §2 全表；每条都有实测 exit code |
| **只声明**（构建期零调用） | **4** | 7.3% | 3 个 `audit-card-*-surface.mjs` + `audit-patch-markers.py`（工具型豁免，已登记） |
| **时序失效**（P-40③：调用点早于对象确定） | **3** | — | `audit-native-deps`（★★ 无缓解）· `audit-method-binding`（★★ 静默 `return true`）· `audit-upgrade-readiness` ③ 段（✅ **项目已自行缓解**） |
| 合计门禁脚本 | **55** | 100% | ★ **注意：此处的「55」是「55 个脚本行」，与任务书的「55 条门禁」巧合但口径不同** |

### 5.2 总评

**门禁体系的「骨架」是真的，而且质量高于多数项目。** 证据：

- 51 条真常驻门禁里，**绝大多数带 `--selftest`（正控 + 负控 + 杠杆三段）**，本审计**逐个实跑**取证；
- **16 条负控**（`*-negctl-*`）都做了「**注入 → 报红 → 还原 → 逐字节自证**」，
  实测全部输出 `文件已逐字节还原 = True` —— 这是**很硬**的工程纪律；
- 项目对 **P-40③ 有自我意识**：Step 0.7 / 3.6 / 5.4 / 5.45 的注释与 `--expect-reinstall` 机制
  都是**从真实事故里学出来的**，且**写进了代码注释**（可追溯）。

**但是它有 3 类结构性弱点**（按严重度排序）：

1. ★★★ **判据的「环境前提」没有判据守着**（§3.1）——
   `PYTHONIOENCODING` 在 CI 设了、本地没设，导致 2 个 Python 门禁在本机可能直接崩。
   **同一份源码在不同环境得出相反结论**，正是 P-40③ 想消灭的形态，只是换了维度（环境 vs 时间）。
2. ★★★ **「文档点名的装置」与「真的在跑的装置」之间仍有缝**（§3.5）——
   `audit-card-event-surface.mjs` 被**四处文档**当作守卫依据，却零调用、**且自证已坏**。
   项目修了「依据改锚」（P-64），**没修「那个脚本自己是坏的」**。
3. ★★ **基线声明与实测不符**（§3.4）——
   文档写「构建期门禁 exit 0（当前 48 条）」，而**本工作区实测 Step 5.4 必 throw**。

### 5.3 一条方法论教训（供后续审计复用）

本审计**第一轮**跑 `--selftest` 时得到 **6 条假红**（`audit-body-dup-ast` / `audit-script-semantics-parity` /
`audit-selftest-claims` / 2 个 Python 负控 / `audit-a14-anchor-negctl` 读数偏差），
根因是**我的 harness cwd 不对**（`D:\DSH RolePlay` 而非 `rp-workspace`）+ **未设 UTF-8**。

⇒ **纪律**：跑本仓门禁**必须复刻构建脚本的 cwd 与 env**，否则会产出**大量假红**（P-38 反面）。
**判据的「可执行性」本身依赖调用环境** —— 这条恰好与 §3.1 是同一个母题。
本报告 §2 的全表已**全部在正确 cwd + UTF-8 下重跑**，假红已剔除。

---

## 六、可复现命令汇总

```pwsh
# 0) 准备（★ cwd 与 env 都必须正确，否则假红）
cd "D:\DSH RolePlay\rp-workspace"
$env:PYTHONIOENCODING = 'utf-8'; $env:PYTHONUTF8 = '1'; $env:DSHT_ARCH = 'arm64'

# 1) 全部门禁 selftest（本报告 §2 主表的数据来源）
pwsh -NoProfile -File ..\tmp\gate-audit\run-selftests-fixed.ps1
Get-Content ..\tmp\gate-audit\selftest-results-fixed.txt

# 2) 编码不对称（§3.1）
Remove-Item Env:PYTHONIOENCODING; Remove-Item Env:PYTHONUTF8
python scripts/audit-build-path-parity.py --selftest      # → UnicodeEncodeError, EXIT=1
$env:PYTHONIOENCODING='utf-8'
python scripts/audit-build-path-parity.py --selftest      # → 38/38 PASS, EXIT=0
grep -n "PYTHONIOENCODING" scripts/build-dsht.ps1         # → 无输出（本机未设）
Select-String -Path ..\.github\workflows\build-apk.yml -Pattern 'PYTHONIOENCODING|PYTHONUTF8'

# 3) P-40③ 时序面（§3.2）
foreach ($s in @('audit-native-deps','audit-upgrade-readiness','audit-method-binding')) {
  "$((Select-String -Path "scripts/$s.mjs" -Pattern 'dsh-runtime-android|runtimeDst|DSHT_ARCH|jniLibs' -AllMatches).Matches.Count)  $s"
}
sed -n '200,210p' scripts/audit-method-binding.mjs   # → :207 return true（静默放行）
git check-ignore -v dsh-runtime/lib                  # → GITIGNORED（Step 5.5 才重建）

# 4) 当前实跑红（§3.4）
node scripts/audit-a14-anchor-negctl.mjs; echo "EXIT=$LASTEXITCODE"   # → 2/3 FAIL, EXIT=1
node scripts/audit-artifact-freshness.mjs; echo "EXIT=$LASTEXITCODE"  # → 违约 2, EXIT=1

# 5) 静默失效（§3.5）
node ..\tmp\gate-audit\orphan-scan.cjs
node scripts/audit-card-event-surface.mjs --selftest; echo "EXIT=$LASTEXITCODE"  # → EXIT=1
grep -c "audit-card-event-surface" scripts/build-dsht.ps1 scripts/build-wb.sh    # → 0, 0

# 6) 数字口径（§4.1）
grep -c '\[gate\] OK' scripts/build-dsht.ps1
grep -c '48 条 `\[gate\] OK`' ..\docs\GOAL.md

# 7) 受守面盲区（§3.6）
grep -c "MASTER_TODO" scripts/audit-doc-refs.mjs    # → 0
```

---

## 七、诚实边界（R7）

1. 本审计**未跑完整构建**（`build-dsht.ps1` 全量需 pnpm install + gradle + NDK，数十分钟）。
   §3.4 的「Step 5.4 必 throw」是**由「实跑门禁 exit 1」+「构建脚本在非零时 throw」两条事实合成**的推断 ——
   两条事实均已取证，但**未做端到端构建验证**。
2. §3.5 的「零调用」判定基于**正则文本引用计数**（排除自身），未做 AST 级调用图分析；
   已交叉核验 `build-dsht.ps1` / `build-wb.sh` / CI / `package.json` **四个面**。
3. §3.6 只证明 `MASTER_TODO.md` **不在受守面内**，**未**证明它里面已有悬空引用。
4. §4.2 只报**格式差异**，**未判定** `audit-diagpack-privacy.mjs` 是否在 `audit-selftest-claims` 受检面内。
5. 「P-1 ~ P-82」82 条判据**未逐条核**（超本任务范围）。
6. 本审计**全程只读**：未修改任何脚本、源码、文档；唯一写入是本文档与 `tmp/gate-audit/` 下的一次性只读扫描脚本
   （`tmp/` 在 `.gitignore` 内，**不影响版本控制面**）。

---

*审计员：gate-auditor · 任务：task-2 · 2026-09-26*
