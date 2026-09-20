# build-dsht.ps1 — DSHTavern 版本构建固定流程（UPDATE-SOP.md 的自动化实现）
# 用法：
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.8        # 完整流程：装新版本 DSH → 平台适配 → 验证 → 打包 → APK
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.7 -SkipInstall  # runtime 已就绪，只跑后半段（打包/APK/sentinel）
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.7 -SkipInstall -Arch x86_64  # 出 PC 模拟器自测 APK（DSHTavern-m1-test-x64.apk）
# 前置：nvm use 24；JAVA_HOME 指向 JDK 21（脚本自动设）
param(
    [Parameter(Mandatory = $true)][string]$DshVersion,
    [switch]$SkipInstall,
    [ValidateSet('arm64', 'x86_64')][string]$Arch = 'arm64',
    # 【双架构一致性】同一批源码构建的两个 ABI 应共享**同一个** RUNTIME_SENTINEL
    #（sentinel 语义 = "runtime 内容代次"，与架构无关）。缺省 0 = 照旧自增；
    # 双架构构建时第二次传第一次的最终值，两包即一致（否则每包 +1，装哪个都对不上）。
    [int]$SentinelV = 0,
    # bychv/dsh-preset-enhance 的版本（MIT；预设机制外移的第一个外部包，见 docs/T-88 §五）。
    # 与 DshVersion 同参数面：升级预设插件 = 重新构建（产物内容可复现，不靠运行时拉取）。
    [string]$PresetEnhanceVersion = '0.3.2-rc.1'
)

$ErrorActionPreference = 'Stop'
# 防御：清掉终端残留的 NODE_DEBUG（会让 npm/pnpm 输出爆炸且极慢——踩过）
Remove-Item Env:\NODE_DEBUG -ErrorAction SilentlyContinue
# pnpm 经 npx 调用：nvm 切换 node 版本后全局 pnpm 不一定在 PATH（踩过）
$pnpm = @('npx', '-y', 'pnpm@10')
$root       = 'D:\DSH RolePlay'
$ws         = "$root\rp-workspace"
$runtimeSrc = "$ws\dsh-runtime-src"          # 安装用干净目录
$runtimeDst = "$ws\dsh-runtime-android"      # 平台适配后的安卓 runtime
$stubs      = "$ws\stubs"
$android    = "$ws\android"
# Arch 派生：jniLibs 目录名 / runtime lib 来源（termux deb 双架构）/ APK 产物名
# 命名（2026-09-03 更名 DSH Tavern）：arm64=release 正式签名（真机交付）/ x64=debug（模拟器自测，CDP 可调）
$archDir    = if ($Arch -eq 'x86_64') { 'x86_64' } else { 'arm64-v8a' }
$runtimeLib = if ($Arch -eq 'x86_64') { "$ws\dsh-runtime-x64\lib" } else { "$ws\dsh-runtime\lib" }
$buildType  = if ($Arch -eq 'x86_64') { 'debug' } else { 'release' }
$gradleTask = if ($Arch -eq 'x86_64') { 'assembleDebug' } else { 'assembleRelease' }
$apkOut     = "$root\DSH-Tavern-0.2.0-$Arch-$buildType.apk"
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$gradle      = "$ws\downloads\gradle\gradle-8.14\bin\gradle.bat"

function Step($n, $msg) { Write-Host "`n[步骤 $n] $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
Step 0 '前置检查'
if (-not (Test-Path $gradle)) { throw "gradle 不存在：$gradle（见 UPDATE-SOP §0）" }
$nodeVer = (& node -v) 2>$null
if (-not $nodeVer) { throw "node 不在 PATH" }
# engines 要求 ^22.19 || >=24；stripTypeScriptTypes 需要 22.13+
$major = [int]($nodeVer -replace 'v(\d+)\..*', '$1')
$minor = [int]($nodeVer -replace 'v\d+\.(\d+)\..*', '$1')
# SkipInstall 时 runtime 已有依赖（node_modules 在 dsh-runtime-android/），packages 的
# esbuild 用现有依赖（pnpm install 在 Step 0 非必须——SkipInstall 跳过）
if (-not $SkipInstall) {
if (!(($major -ge 24) -or ($major -eq 22 -and $minor -ge 19))) {
    throw "node $nodeVer 低于 DSH engines 要求（先 nvm use 24）—— 坑 #5"
}
Write-Host "  node=$nodeVer JAVA_HOME 已设 OK"
}

# ---------------------------------------------------------------------------
# Step 0.1 原生库就位检查（T-25b）—— 【为什么在这一层】
#   `jniLibs/<abi>/*.so`（14 个、约 100MB）是**第三方二进制**（Termux deb 提取，
#   含 GPLv2 的 proot/busybox）。本仓库**不再分发**它们 ⇒ 构建前必须先就位，
#   否则 gradle 会拖到**打包末期**才失败（晚失败 = 白跑整轮构建）。
#   ★ 获取脚本自带 deb 级 SHA256 校验，可**完整重建**（实测逐字节一致）。
& node (Join-Path $ws 'scripts\fetch-native-libs.mjs') --check
if ($LASTEXITCODE -ne 0) {
    throw "原生库缺失（jniLibs/*.so）—— 见上方清单。补齐：node rp-workspace/scripts/fetch-native-libs.mjs"
}

# ---------------------------------------------------------------------------
# Step 0.5 门禁前置（**十三项常驻审计**）——【2026-09-14 E-H 一致性审计修复】
#
# ## 为什么必须加在这一层（而不是只留在 build-wb.sh）
# E-H 文档一致性审计发现：`docs/MOBILE-TEST-METHODOLOGY.md` §5.1 声称七项门禁
# 「每次提交」跑，但实测——**权威构建路径（本脚本）内零 audit 调用**，只有
# `build-wb.sh`（WorkBuddy 侧复刻）接了 5 项，另有 `audit-publish-hygiene` 与
# `audit-build-path-parity.py` **全仓无任何自动触发点**。
# 即：声明是「常驻判据」，实质是「手工记得跑」——正是本项目主力缺陷族（P-1：
# 声明与实现不一致；P-11：判据不落在真实路径上）。
#
# 处置（R12 自裁：让声明成真，而非降低措辞）：把门禁接入**权威路径**的
# 前置检查。任一不过即 throw（fail-closed，不许带着违规产物继续打包）。
#
# ## W26 追加：判据的**覆盖面**也要守（否则「已接入」只是形式）
# 原第 7 项 `audit-build-path-parity.py` 只扫 ps1 一侧的补丁调用点 ⇒ python 侧
# `apply-platform-patches.py` 的 `patch()` 同类缺陷**结构上发现不了**。
# W26 已把判据三扩成 ps1 + python 双侧，并新增判据四（marker 子串碰撞）。
# `audit-patch-markers.py`（python 侧细粒度工具）保留可独立运行，不再是唯一防线。
#
# ## W28 追加：判据五（构建侧 `.ps1` 必须带 UTF-8 BOM）
# 实测事故：编辑器剥掉 `rebuild-plugins.ps1` 的 BOM ⇒ PowerShell 5.1 按 GBK 解码
# 中文注释 ⇒ 引号配对被打断 ⇒ 语法解析失败，而报错指向**第 123 行的 JSON 字面量**
# （真凶在第 1 行之前）。决定性实验：同一份字节，带 BOM ⇒ 0 处语法错误；无 BOM ⇒ 54 处。
# ⚠️ 该实验**必须用 powershell.exe（5.1）**跑 —— PS7 默认 UTF-8，两次都是 0。
# 判据五已并入本项（同一脚本内），并把扫描面改成**自动发现 scripts/*.ps1**
# （硬编码名单的漏法 = 新增脚本没人登记 ⇒ 判据沉默）。
#
# 注：`audit-build-path-parity.py` 校验两条构建路径的补丁集等价——它在**本路径**上跑
# 正是要点（若本脚本新加了补丁而 python 路径没加，此处立刻拦下）。
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Step 0.7 DSH 版本一致性闸门（**第 13 项常驻审计** · 【2026-09-16 W25/P-40 新增】）
#
# ## 为什么必须最先跑（放在 Step 0.5 之前）
# 整棵 runtime 的代次**只由 `-DshVersion` 这一个命令行参数决定**（`:191` 写进
# `dsh-runtime-src/package.json`，再 `pnpm install`）。而在本步骤存在之前，
# 仓库里**没有任何断言**把它与「单源声明的版本」「设备上正在跑的版本」比对过。
#
# ## 事故（第二十七轮 W24c，**数据安全级**）
# 收尾重建时照抄上一轮的 `-DshVersion 0.1.2-rc.1`，而设备上跑的是 `0.1.5-rc.1`：
#   · `@deepseek-ai/dsh` 对子包只做 **caret** 依赖（`"…dsh-session": "^0.1.2-rc.1"`）
#     ⇒ 整棵树按 registry 解析结果落成 **0.1.2 世代**；
#   · 0.1.2 的 `dsh-session.isReplaceOp` 要求 `op` + **`start`** + **`end`**（**严格三键**），
#     而设备上 **1747 处真实会话数据**是 `{"op":"replace","startSeq":N,"endSeq":N}`
#     ⇒ 官方 loader 直接拒绝既有日志 ⇒ **历史会话全部打不开**
#     （不是「功能不对」，是「数据读不出来」—— 后果比任何功能缺陷都重）。
# 当时是 Step 3.6 的契约探针判 BLOCK 才拦下 —— **属侥幸**（它只看字段名，且要先装完 runtime）。
#
# ## 本步骤的判据（`scripts/audit-dsh-version.mjs`，带 `--selftest` 9 项正负控）
#   ① 单源 `rp-workspace/dsh-version.json` 存在且格式合法；
#   ② `-DshVersion` 与单源的 `dshVersion` **逐字一致**（本步骤额外做，脚本内不做 —— 因为
#      「命令行实参」只有构建脚本知道）；
#   ③ 产物 `dsh-session.isReplaceOp` 的字段名 = 单源声明的 `sessionReplaceOpFields`
#      （★ **数据兼容的真正判据**：锚在「决定数据能否被读出的事实」上，不锚在版本号上）；
#   ④ 设备对照：设备版本 **新于** 本次将构建的版本 ⇒ **报错**（降级必须显式确认）+ 统计
#      设备真实数据里的字段形态（抽样优先取 RP 会话，避免抽到 import/_adapter 的空壳）。
# 退出码 0=通过；1=不一致（fail-closed）；2=单源缺失/非法；3=selftest 失败。
#
# ## 为什么「②」单独在构建脚本里做
# 判据脚本读不到「用户这次传了什么实参」（它只看仓库状态）。而**实参与单源不一致**
# 正是本轮事故的形态 ⇒ 这一条必须由构建脚本断言。⚠️ 升级 runtime 时要**同时**改
# `-DshVersion` 与 `dsh-version.json`（后者改了，前者的默认心智才会跟上）。
# ---------------------------------------------------------------------------
Step 0.7 'DSH 版本一致性闸门（第 13 项常驻审计；P-40/R21 的机器化）'
$verAudit = Join-Path $ws 'scripts\audit-dsh-version.mjs'
if (-not (Test-Path $verAudit)) { throw "门禁脚本缺失：$verAudit（常驻审计不得缺项）" }
& node $verAudit --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "门禁自检失败：audit-dsh-version.mjs --selftest（闸门本身不可信）" }
Write-Host "  [gate] OK audit-dsh-version.mjs --selftest"
# ② 实参 vs 单源（只有构建脚本能做这条断言）
$ssotPath = Join-Path $ws 'dsh-version.json'
if (-not (Test-Path $ssotPath)) { throw "单一事实来源缺失：$ssotPath（见 docs/GOAL.md §七 R21）" }
$ssotJson = Get-Content $ssotPath -Raw | ConvertFrom-Json
if ($ssotJson.dshVersion -ne $DshVersion) {
    throw ("DSH 版本不一致（fail-closed）：命令行 -DshVersion=$DshVersion，而单源 dsh-version.json 声明 $($ssotJson.dshVersion)。" +
        "若确实要换版本，请同时更新 dsh-version.json（含 sessionReplaceOpFields），否则产物可能与既有会话数据不兼容 —— 见 docs/GOAL.md §七 R21。")
}
Write-Host "  [gate] -DshVersion=$DshVersion 与单源 dsh-version.json 一致"
# ③④ 形态与设备对照（非 SkipInstall 时 runtime 还没装，③ 会自动 SKIP 并出声）
& node $verAudit
if ($LASTEXITCODE -ne 0) { throw "DSH 版本审计未通过：audit-dsh-version.mjs（详见输出；1=不一致，2=单源非法）" }
Write-Host "  [gate] OK audit-dsh-version.mjs"

# ---------------------------------------------------------------------------
# ★★ **读数行登记表（唯一实现点）** —— W62 建立（P-1 / P-60 纪律②）
#
# ## 为什么必须提升到全脚本一级（W62 实测的真缺陷）
# W57 造了「把关键读数行回显进构建日志」这个机制，W58 把它做成 `$readingGates` 表；
# 但那张表**嵌在 Step 0.5 的 foreach 循环内部** ⇒ 它的扫描面**只有那个循环里的 node 闸门**。
# 实测后果（`tmp/w62-probe-readings2.mjs` 全仓穷举 + `w61b-build-x64.log` 取证）：
#   · **21 个构建期闸门会打印读数行，而日志里只出现了 3 条**
#     （Step 0.5 的 2 条 + Step 0.55 的 1 条硬编码）；
#   · ★★ 其中一类**直接对应 `GOAL.md` §3.1 / §3.2 里写死的数字**，却**零观测面**：
#       - `audit-shim-template-literal.mjs` 的「受检目标 N 个」 ↔ §3.1「TARGETS **9 项**」
#       - `audit-build-path-parity.py` 的「marker N 个 / stub N 项 / 调用点 N 处 / BOM N 个」
#         ↔ §3.2 第 7 项「**17 marker** + **11 项**」「ps1 13 处 + python 20 处」「自动发现 **4** 个」
#       - `audit-artifact-freshness.mjs` 的「实读 N 条『产物 → entry』」 ↔ §3.2 A14 段「实读 **7** 条」
#       - `audit-session-integrity.mjs` 的「审计 N 个会话 · 违规 M 处」 ↔ §3.1「全量审计 **23** 会话」
#       - `audit-selftest-claims.mjs` 的「受检闸门 N 个 · 文档声明 N 条」
#       - `audit-rule-claims.mjs` 的「声明有机器守 N 条」
#   · 这三类形态**在报告上完全同貌**（P-30）：读数进了日志 与 读数根本没产生，都不报错。
#
# ## 与 W57/W58/W60 的关系（这是同一母题的第 4 次现身）
#   W57：读数**不在日志里** ⇒ 写死的数字可以静默脱钩（造机制）
#   W58：受守**只有一处**（Step 0.5 循环）⇒ 做成表，但**表的扫描面仍受限于它所在的位置**
#   W60：**同一行里的另一半**没有守（`slots 42 个`）
#   W62：**表本身的位置就是覆盖面** —— 它在循环里 ⇒ 循环外的闸门（Step 0.55 / `.py`）**全在表外**
#        而记账里还写着「与 `$readingGates` 表**同法**（P-1：读数机制只许一处实现形态）」
#        —— ★ 那是**声明与实现不符**（P-59 的同族）：**说是一处，实际已是三处**。
#
# ## 口径（守 P-38：只收「真读数」，不收诊断信息）
# 只登记**对应文档里写死的数字、或对应一个「变了就说明有问题」的不变式**的读数行。
# 「扫描 N 个源文件」这类**规模诊断**不登记 —— 它们不对应任何文档数字，收了只会让日志变噪。
# 键 = 闸门文件名；值 = @{ Exe = 执行器; Pattern = 只留那一行的正则; Label = 人读说明 }
$readingGates = @{
    # ---- 既有 2 条（W57/W58 建，从 Step 0.5 循环内上移到此）----
    'audit-route-contract.mjs'   = @{ Exe = 'node'; Pattern = '\[契约读数\]'; Label = '唯一路由数 / 违约数（§3.2 第 3 项）' }
    'audit-th-face-coverage.mjs' = @{ Exe = 'node'; Pattern = '\[TH 面读数\]'; Label = 'TH 三份名单条数（§3.1 TH 覆盖面 / README）' }
    # ---- ★ W62 新增：把 §3.1/§3.2 里**写死但无观测面**的数字接进日志 ----
    'audit-shim-template-literal.mjs' = @{ Exe = 'node'; Pattern = '受检目标 \d+ 个'; Label = 'A11 受检目标数（§3.1「TARGETS 9 项」）' }
    # ★ W63：`verify-apk-payload.py`（M4 读数行 `=> 核验 N 项，缺失 M 项`）**不登记** ——
    #   它在 Step 6.6 的调用**不在 `| Out-Null` 面上**（输出**本来就进日志**），
    #   无需 `Show-Reading` 额外回显。★ 这正是 **P-62 判据①** 想抓的形态：
    #   「登记 ⇒ 必须接线」—— 登记了却无接线 = **空声明**（该轮实测当场被该判据抓到）。
    #   而它作为 `audit-baseline-claims.mjs` 判据 ④ 的**真值来源**这件事，
    #   由 `readBuildLogTruth` 的抽取 + 该脚本的承重控守（W63）。
    'audit-build-path-parity.py'      = @{ Exe = 'python'; Pattern = '共同 \d+ 个|marker \d+ 个；|调用点 \d+ 处|自动发现 \d+ 个'; Label = '两路径补丁集/幂等/BOM（§3.2 第 7 项）' }
    'audit-artifact-freshness.mjs'    = @{ Exe = 'node'; Pattern = '\[A14\] 权威脚本锚点'; Label = '实读产物→entry 条数（§3.2 A14 段）' }
    # ★ 诚实边界（R7）：`audit-session-integrity.mjs` **不登记** —— 它在构建期**只跑 `--selftest`**
    #   （主流程要 adb 连设备），其主流程的「审计 N 个会话」读数**不在构建路径上产生**。
    #   与 `audit-script-semantics-parity.mjs`（构建期不传 `--corpus` ⇒ 不产生语料读数）同理。
    #   ⇒ 登记它们只会得到「已登记但永远取不到」的红字噪音（P-38 过宽）。
    'audit-selftest-claims.mjs'       = @{ Exe = 'node'; Pattern = '受检闸门 \d+ 个|头注清单|\[退出码\]|\[用法面\]'; Label = '受检闸门数 / 文档声明数 / 头注清单违规数 / 退出码对账 / 用法面对账（§3.1 第 74 行）' }
    'audit-rule-claims.mjs'           = @{ Exe = 'node'; Pattern = '声明有机器守'; Label = '§七/§九 声明有机器守条数（P-58）' }
    'audit-baseline-claims.mjs'       = @{ Exe = 'node'; Pattern = '\[基线\] §3\.1 声明|\[契约\] slot 数核对'; Label = '§3.1 三类数字的声明 vs 实测（W45/W51/W60）' }
    'audit-open-items.mjs'            = @{ Exe = 'node'; Pattern = '\[开放项\] §六 表'; Label = '§六 开放项规模（R10 动态区）' }
    'audit-doc-refs.mjs'              = @{ Exe = 'node'; Pattern = '\[文档引用\] 扫描'; Label = 'E-H 文档一致性扫描规模（§八 E-H）' }
    'audit-goal-sections.mjs'         = @{ Exe = 'node'; Pattern = '\[工作面表\]'; Label = '§十一 三表规模（P-49）' }
}

<#
.SYNOPSIS
  把一个闸门的**读数行**回显进构建日志（P-60 纪律②：关键读数必须出现在构建日志里）。
.DESCRIPTION
  ★ 唯一实现点（P-1）：Step 0.5 循环、Step 0.55 各组、Step 5.4 —— **都调本函数**，
  不得再各写一段 `Select-String -Pattern`（W62 实测：此前已有三套平行实现，
  而其中两套的覆盖面都只及自身所在的那一小段）。
  ★ 未登记 ⇒ 静默返回（**不是**缺陷：绝大多数闸门没有「对应文档数字的读数行」）。
  ★ 已登记但**取不到** ⇒ 出声警告（`P-30`：读数没进日志与读数正常，在报告上同貌）。
      ★★ 为什么**只出声不报红**（P-43）：闸门在某些参数下（如 `audit-script-semantics-parity.mjs`
      不传 `--corpus` 时）**本就不产生**该读数行，报红会变成假红；而「登记了却取不到」
      这件事本身必须**可见**（否则登记表形同虚设）。
#>
function Show-Reading {
    param(
        [Parameter(Mandatory = $true)][string]$Gate,
        [Parameter(Mandatory = $true)][string]$Path
    )
    if (-not $readingGates.ContainsKey($Gate)) { return }
    $spec = $readingGates[$Gate]
    $exe = if ($spec.Exe -eq 'python') { 'python' } else { 'node' }
    try {
        $reading = & $exe $Path 2>&1 | Select-String -Pattern $spec.Pattern
    } catch {
        Write-Host "         ⚠ 读数行**取不到**（$($spec.Label)）：$($_.Exception.Message)" -ForegroundColor Yellow
        return
    }
    if ($reading) {
        foreach ($r in $reading) { Write-Host "         $r" }
    } else {
        Write-Host "         ⚠ 未取到读数行（选 $($spec.Pattern) · $($spec.Label)）⇒ 该闸门的读数**未进日志**" -ForegroundColor Yellow
    }
}


# ---------------------------------------------------------------------------
Step 0.5 '门禁前置（十三项常驻审计；任一不过即停）'
$auditNode = @(
    'audit-publish-hygiene.mjs',
    'audit-shim-template-literal.mjs',
    'audit-route-contract.mjs',
    'audit-method-binding.mjs',
    'audit-impl-duplication.mjs',
    'audit-iframe-sandbox.mjs',
    # 【第二十轮新增 · A15】跨包 CSS 规则闸门（P-26 的机器化形态）。
    # 守：不允许一个包在 CSS 里写「另一个包自有组件的类名」规则 ——
    # 实测两种失效形态：特异性形态（mobile 的 .vb-arrow 38px 被 rp-ui 0,2,0 压死）
    # 与注入顺序形态（约 27 条同特异性规则被后注入的 rp-ui 覆盖 ⇒ .dsht-rp-back 实测 32px）。
    'audit-cross-package-css.mjs',
    # 【第二十三轮续 W8 新增 · F5b】AST 版「函数体逐字重复」扫描。
    # 守：既有 F5 判据 4 的两个口径**同时躲过**的两类复制 ——
    #   ① 只收 `function` 声明形态 ⇒ 漏掉箭头函数体（如 `useEffect(() => {…})` 内的重复）
    #   ② 只判跨包 ⇒ 漏掉**同包跨文件**复制
    # 实测价值：本轮据此抓到 5 组（4 份 Esc 关闭 / 2 份折叠头 a11y / 2 份同包判定函数），
    # 全部按 P-1 收口（共享模块 + 同义别名）。
    'audit-body-dup-ast.mjs',
    # 【第二十四轮 W3 新增】真 TH 裸全局面**覆盖面**闸门（B3「不允许静默 undefined」的机器化）。
    # 守：真 TH 在脚本 iframe 的 window 上提供的每个名字，我方必须**要么实现、要么明确拒绝**
    # —— 不许静默缺席（脚本的 `typeof X !== 'undefined'` 守卫会静默走 else，我方零感知）。
    # 本轮实测：真 TH 面 141 项、我方此前 117 项 ⇒ **25 项真缺口**（3 项本轮实现、22 项明确拒绝）。
    # 需要 `$env:TH_ROOT` 指向 JS-Slash-Runner 外部副本；**缺失时 fail-closed（exit 2）**，
    # 不会静默变绿（P-11）。
    'audit-th-face-coverage.mjs',
    # 【第二十五轮 W4 新增】「单测装置 vs 真机」脚本语义一致性闸门。
    # 守：卡脚本在真机以 <script type="module"> 注入（th-shim.ts 锚点断言）⇒ **严格模式**；
    # 而单测用 node:vm **经典脚本**语义。两者**不是同一套语义**（实证：同一段带 with 的代码
    # 在 vm 里能跑、在 ESM 里 SyntaxError）⇒ 存在「单测全绿而真机全崩」的盲区。
    # 本轮实测（54 个真实脚本）：「经典合法/严格报错」形态 **0 命中** ⇒ 当前**无实际后果**；
    # 本闸门把这条结论变成**会自己失效的** —— 一旦语料/实现出现这类形态即报红。
    # 语料目录由 --corpus 或 $env:DSH_SCRIPT_CORPUS 给出；**不可达时只跑自证并出声**
    # （不静默跳过，也不因无副本而阻断构建 —— 守 B8）。
    'audit-script-semantics-parity.mjs',
    # 【第三十轮 W29 新增】矩阵**残余标记**审计。
    # 守：`docs/MOBILE-TEST-METHODOLOGY.md` §二 的 L1~L5 表里，凡标「部分覆盖/未覆盖」
    # 且留有残余的格子，其残余描述必须**结构完整** —— 「须运行时验证/待复测」这类
    # **未收敛**措辞必须同时给出「真实存在的探针」+「登记处」；否则报红。
    # 为什么（W29 一轮内撞见 **3 格过期标记**，全靠人工看见）：结论会过期而没人回头改，
    # 后人据它**重复排查**，且让「矩阵清零」（E-B）看起来永远做不完（P-1 的口径不一致形态）。
    # ⚠️ 诚实边界：本闸门只查「残余描述的结构完整性」，**不查残余是否真的还在**
    # （后者须逐个真跑）—— 它是降低复发率的护栏，**不替代人工复核**。
    'audit-matrix-residuals.mjs'
)
foreach ($a in $auditNode) {
    $p = Join-Path $ws "scripts\$a"
    if (-not (Test-Path $p)) { throw "门禁脚本缺失：$p（常驻审计不得缺项）" }
    # 有 --selftest 的必须先自检（防「闸门本身失效却报 PASS」——A11 的教训）
    $hasSelftest = (Select-String -Path $p -Pattern '--selftest' -Quiet)
    if ($hasSelftest) {
        & node $p --selftest | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "门禁自检失败：$a --selftest（闸门本身不可信）" }
    }
    & node $p | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "门禁未通过：$a（详见 node scripts/$a 输出）" }
    Write-Host "  [gate] OK $a"
    # ★ W62：**改为调用全脚本唯一的 `Show-Reading`**（P-1：读数机制只许一处实现）。
    #   此前这里内嵌一张 `$readingGates` 表 ⇒ 它的扫描面**只及本循环**
    #   ⇒ Step 0.55 / Step 5.4 / `.py` 闸门的读数行**全在表外**（W62 实测：
    #   21 个闸门有读数行，日志里只有 3 条）。表已上移到脚本顶部，与本循环解耦。
    Show-Reading -Gate $a -Path $p
}
# 第 7 项是 python 脚本（两条构建路径「补丁集 + **stub 落盘清单**」等价性）
# 【2026-09-16 W25】本脚本新增 `--selftest`（判据自身正负控，5 例）——
#   **必须一起调用**：否则「闸门自己写错了」会静默报 PASS（A11 / P-30 的教训：
#   扫源码的闸门失效时，输出与通过**完全相同**）。
$parityScript = Join-Path $ws 'scripts\audit-build-path-parity.py'
if (-not (Test-Path $parityScript)) { throw "门禁脚本缺失：$parityScript" }
& python $parityScript --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "门禁自检失败：audit-build-path-parity.py --selftest（闸门本身不可信）" }
Write-Host "  [gate] OK audit-build-path-parity.py --selftest"
& python $parityScript | Out-Null
if ($LASTEXITCODE -ne 0) { throw "门禁未通过：audit-build-path-parity.py（两条构建路径的补丁集或 stub 落盘清单不等价）" }
Write-Host "  [gate] OK audit-build-path-parity.py"
# ★ W62：`.py` 闸门在循环外 ⇒ 此前**完全在读数回显机制之外**（实测：§3.2 第 7 项写死的
#   「17 marker / 11 项 / ps1 13 处 + python 20 处 / 自动发现 4 个」**在日志里从来没有痕迹**）。
Show-Reading -Gate 'audit-build-path-parity.py' -Path $parityScript

# ---------------------------------------------------------------------------
# Step 0.55 判据**杠杆**自检（真实仓库负控）——【2026-09-16 W28 接入】
#
# ## 为什么必须常驻（P-11：判据不得「声明为判据、实质靠人记得跑」）
# W26 建了这两个负控，但**全仓无任何自动触发点** —— 即「判据三/四 的杠杆是否还在」
# 这件事本身没有任何机器守着。而**死判据**（永远报绿的判据）的输出与通过**完全相同**：
#   判据三/四 若因重构而失效，Step 0.5 会**静默全绿**，比不装判据更坏（它给出虚假安全感）。
#
# ## 它们做什么（`finally` 保证还原；且每次都会**逐字节复核**还原是否成功）
#   · audit-marker-collision-negctl.py   把 `patch-resilient-list.mjs` 的 import 标记
#     **改回 W26 修复前的旧名**（即与主体 marker 互为子串）⇒ 判据四必须报红；
#   · audit-py-patch-idem-negctl.py       把 `apply-platform-patches.py` 某处 repl 里的
#     marker **去掉** ⇒ 判据三（python 侧）必须报红。
# 两者都遵循「正控（现状必须绿）+ 负控（破坏后必须红）+ 逐字节还原」三段，
# 任一不满足即 exit 1 ⇒ 此处 throw（fail-closed：判据无杠杆不允许继续构建）。
#
# ## 关于「临时改真实文件」的风险（诚实登记）
# 若本步骤被强杀（Ctrl+C / 断电），源文件可能停留在被破坏状态。可接受，理由：
#   ① 脚本用 `finally` + 写回**原始字符串**，正常情况下必还原；
#   ② 即使真停留，**下一条命令**（Step 0.5 的判据一/三/四）会立刻报红 ⇒ fail-closed，
#      不会产出坏 APK；且 git 可恢复。
#   ⇒ 相比之下，「杠杆悄悄失效而无人知」的代价更高。
# ---------------------------------------------------------------------------
Step 0.55 '判据杠杆自检（判据三/四/七 的真实仓库负控；任一不过即停）'
foreach ($nc in @('audit-marker-collision-negctl.py', 'audit-py-patch-idem-negctl.py')) {
    $ncp = Join-Path $ws "scripts\$nc"
    if (-not (Test-Path $ncp)) { throw "负控脚本缺失：$ncp（判据杠杆自检不得缺项）" }
    & python $ncp | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "判据杠杆自检未通过：$nc（该判据可能已成『死判据』——永远报绿的判据比没有判据更坏）"
    }
    Write-Host "  [gate] OK $nc（有杠杆：破坏后报红 + 逐字节还原）"
}

# 【2026-09-16 W31 追加 · 判据七（探针 CDP 求值单源）的真实仓库负控】
#   为什么单列：判据七在**首版口径过宽**（一次报 80 处假红，P-38）后收窄为
#   「函数体逐字重复」。收窄后跑真实仓库得 **0 处** —— 而「0 处」既可能是
#   「重复已收口」，也可能是「**收窄过头抓不到了**」（后者等于把判据改废，
#   正是 B11 禁止的「放宽判据」）。⇒ 必须用实验分辨（P-30：真实仓库 0 命中 = 0 信息量）。
#   该负控注入两份**真实同形**的 ev() ⇒ 必须报红且精确指向；删除 ⇒ 必须回绿。
$cdpNc = Join-Path $ws 'scripts\audit-cdp-eval-negctl.mjs'
if (-not (Test-Path $cdpNc)) { throw "负控脚本缺失：$cdpNc（判据杠杆自检不得缺项）" }
& node $cdpNc | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "判据杠杆自检未通过：audit-cdp-eval-negctl.mjs（判据七可能已成『死判据』或收窄过头）"
}
Write-Host "  [gate] OK audit-cdp-eval-negctl.mjs（有杠杆：注入逐字复制后报红 + 删除后回绿 + 自证清理）"

# 【2026-09-16 W32 追加 · 会话结构审计的**判据自证**（含新增判据 ④）】
#   为什么单列（且只跑 --selftest，不跑整脚本）：`audit-session-integrity.mjs` 的**审计模式
#   需要设备在线**（找不到 adb / 定位不到会话目录时 fail-closed exit 3）—— 构建期设备可能不在，
#   整脚本进 Step 0.5 会把「设备没插」误报成「门禁失败」。而它**仍然必须有常驻触发点**，
#   否则「判据自己坏了」无人知（P-19/P-30：死判据的输出与通过完全相同）。
#   ⇒ 构建期只跑自证（不需设备）；真实审计由 M7 的 J16 在设备侧跑（同一份判据，P-1 单源）。
#   ★ 本次新增的**判据 ④**（影子价格邻接契约）正是 W32 抓到「会话整份打不开」的那条：
#     它此前**不在任何判据里**（①②③ 只覆盖 surface 结构面，全部漏过），
#     而 M7 把这种卡记成「无可见楼层，可能已被回退到空」的 SKIP ⇒ 真缺陷被掩盖 6 轮（P-46）。
$integrityScript = Join-Path $ws 'scripts\audit-session-integrity.mjs'
if (-not (Test-Path $integrityScript)) { throw "判据脚本缺失：$integrityScript（会话结构审计不得缺项）" }
& node $integrityScript --selftest | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "判据自证失败：audit-session-integrity.mjs --selftest（判据自己坏了 ⇒ 它的『0 违规』无意义）"
}
Write-Host "  [gate] OK audit-session-integrity.mjs --selftest（18/18 + 与官方参考实现对账 91/91，含 W32 判据 ④ 的正控/负控/杠杆与 W36 的假红收口）"

# 【2026-09-16 W35 追加 · **P-47**（判据的读数必须按「归因层级」分类）的闸门 + 真实仓库负控】
#   为什么必须常驻（P-11 元级 + P-46 的**递归形态**）：
#   W34 实证 —— M7 的 J1 刚把「0 楼层」拆成两种含义，**当天**又混了另外两种
#   （**数据层** `failed to project session` vs **传输层** `api gateway: Remote stream
#   WebSocket closed`），一次报出 2 个假 FAIL，而同轮 J16 报「违规 0 处」⇒ **两判据自相矛盾**。
#   ⇒ 结论：**P-46 不是一次性动作，而是每条判据的持续义务**。
#   本闸门把该义务机器化：谁新写「读 UI 错误文本 ⇒ 判 FAIL」的探针而不分类，构建期即被拦下。
#   ★ 负控（audit-p47-negctl.mjs）守 **B11**：闸门在真实仓库得「0 违规」既可能是「都分类了」，
#     也可能是「**收窄过头抓不到了**」—— 两者输出完全相同 ⇒ 必须把修前形态**注入**回去看它红不红。
#     （实测有效：本闸门 v1/v2/v3 三版**全被它当场证伪**，逐版收窄才有 v4 的 9/9。）
$p47 = Join-Path $ws 'scripts\audit-error-layer-classify.mjs'
if (-not (Test-Path $p47)) { throw "判据脚本缺失：$p47（P-47 闸门不得缺项）" }
& node $p47 --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-error-layer-classify.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-error-layer-classify.mjs --selftest（9/9，含负控2b 逐行判定与杠杆）"
$p47nc = Join-Path $ws 'scripts\audit-p47-negctl.mjs'
if (-not (Test-Path $p47nc)) { throw "负控脚本缺失：$p47nc（P-47 闸门不得缺项）" }
& node $p47nc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-p47-negctl.mjs（P-47 闸门可能已成『死判据』或收窄过头）" }
Write-Host "  [gate] OK audit-p47-negctl.mjs（有杠杆：注入修前形态后报红 + 删除后回绿 + 逐字节还原）"

# 【2026-09-17 W38 追加 · **P-48**（判据装置自身的失败路径必须与它保护的副作用对齐）的闸门 + 真实仓库负控】
#   为什么必须常驻（P-11 元级）：P-48 是 W36 续从一次**真实事故**里提炼的
#   （M7 的 fail-closed 断言 `throw` **跳过了收尾还原** ⇒ 设备残留 10 个 `.efjbak`、会话停在旅程态）。
#   但它此后的发现**完全靠人工穷举**，且**三次穷举三次还在漏**：
#     · W36 只落在 M7（`ef-journey-all.mjs`）一处；
#     · W37 按 P-38 三段式穷举 ⇒ 抓到第二处 `ef-font-scale.mjs`（改设备全局**字号**）；
#     · W38 再穷举 ⇒ 又抓到**第三处 `ef-orientation.mjs`**（改设备全局**自动旋转**）。
#   ⇒ 「声明为判据、实质靠人记得」正是本仓最忌讳的形态（W26 的 A14、W32 的判据 ④ 都栽在这里）。
#   ★ 这一类里**「设备全局设置」比「用户会话数据」更该先守**（P-37② 量后果）：会话写坏了还有
#     `.efjbak` 备份可人工还原；**设备设置没有任何备份** —— 探针中止后用户的系统字号 / 自动旋转
#     停在探针改过的档位，用户看得到、却不知道原值是什么。
#   判据 = 四项能力齐备（① 幂等还原函数 ② 四类中止路径**各自**注册**且体内**调用还原
#   ③ 读回自证且**成功也出声** ④ 写盘与登记同处）。静态那一半由本闸门守；
#   **结果**那一半（中止后设备真的回到原值）由负控 + 设备实测守（P-24）。
#   ★ **W39 扩到第二受检面**：凡**执行回退类 RPC**（改**用户会话数据**）的装置同样受检 ——
#     穷举抓到 2 处真实缺陷（`ef-rollback-live.mjs` / `b2-live-rollback-test.mjs`：
#     对用户真实卡真跑不可逆回退，却**零备份/零还原/零兜底**，违反 R18）⇒
#     已抽**单源守护** `scripts/session-guard.mjs`（备份 → 停应用 → 还原 → 校验；P-1），
#     两处改为 import 复用（而非各写一份 —— 否则会被 `audit-impl-duplication.mjs` 判据 7 报红）。
#     第二类判据：① 有备份能力（自实现或 import 单源）② 有还原+校验 ③ 有中止兜底。
#     闸门 selftest 8/8 → **15/15**（新增正控 2/3、负控 4/5、杠杆 2、零控 2）。
$p48 = Join-Path $ws 'scripts\audit-p48-rollback.mjs'
if (-not (Test-Path $p48)) { throw "判据脚本缺失：$p48（P-48 闸门不得缺项）" }
& node $p48 --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-p48-rollback.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-p48-rollback.mjs --selftest（15/15，含『假兜底』『只 import 不接线』负控与两组杠杆）"
$p48nc = Join-Path $ws 'scripts\audit-p48-negctl.mjs'
if (-not (Test-Path $p48nc)) { throw "负控脚本缺失：$p48nc（P-48 闸门不得缺项）" }
& node $p48nc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-p48-negctl.mjs（P-48 闸门可能已成『死判据』或收窄过头）" }
Write-Host "  [gate] OK audit-p48-negctl.mjs（有杠杆：断线兜底→报红 · 散落裸写→报红 · 删除→回绿 · 逐字节还原）"

# 【2026-09-17 W40 追加 · **§六「开放项表」的结构一致性闸门**】
#   为什么必须常驻（P-11 元级 · 本轮真实事故）：W40 推进 goal 时撞见 ——
#   **同一个事实（T-87 判据 8）在 §六 里有两条记录**：一条写「✅ 已按 P-41 改锚收口」（W28 做的），
#   另一条仍写「⬜ 未收口（第二十一轮发现）」。两条**都是真的**（一次是判据改锚、一次是标记没跟着改），
#   但读者只能看到矛盾 ⇒ **差点跳过这块去查别的**（P-27：过期结论双向误导）。
#   ★ 这正是本仓最忌讳的形态：**「当前还欠什么」的 SSOT 没有任何机器守着**
#     （`audit-matrix-residuals.mjs` 只守 §二 的 L1~L5 表）。
#   判据 = ① §六 表可解析（切不出 ⇒ fail-closed，不许当 0 违规）
#          ② 状态列归入三态（✅/⬜/📋/⚠️/🚫；**新措辞 ⇒ 报红**，守 P-14）
#          ③ ⬜ 行必须有锚点或「已归属」措辞（悬空待办 ⇒ 报红）
#          ④ ★ **同一事实不得两处结论相反**（按「事实指纹」分组：粗体小标题里的
#             文件名 / 工单号 / P 判据号 ⇒ 同组内同时出现「已收口」与「未收口」即报红）
#   配**真实仓库负控** `audit-open-items-negctl.mjs`（守 B11：注入「同事实两处相反」⇒ 报红且指向两行；
#   删除 ⇒ 回绿；逐字节还原）。★ 该闸门首版连踩 3 处自身边界（切面过宽 267 处假红 /
#   反引号里的 `|` 切碎列 / 指纹正则 `\b` 对中文不成立 + 工单号前缀假设错），全部由 selftest 与探针证伪。
$oi = Join-Path $ws 'scripts\audit-open-items.mjs'
if (-not (Test-Path $oi)) { throw "判据脚本缺失：$oi（§六 开放项闸门不得缺项）" }
& node $oi --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-open-items.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-open-items.mjs --selftest（12/12，含『同事实两处相反』负控与杠杆）"
& node $oi | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-open-items.mjs（§六 开放项表自相矛盾或有悬空待办）" }
Write-Host "  [gate] OK audit-open-items.mjs（§六 表自洽：状态三态可解析 + 未收口有锚点 + 无同事实两处相反）"
Show-Reading -Gate 'audit-open-items.mjs' -Path $oi   # ★ W62：§六 规模读数（R10 动态区）
$oiNc = Join-Path $ws 'scripts\audit-open-items-negctl.mjs'
if (-not (Test-Path $oiNc)) { throw "负控脚本缺失：$oiNc（§六 开放项闸门不得缺项）" }
& node $oiNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-open-items-negctl.mjs（闸门可能已成『死判据』或收窄过头）" }
Write-Host "  [gate] OK audit-open-items-negctl.mjs（有杠杆：注入矛盾→报红指向两行 · 删除→回绿 · 逐字节还原）"

# ---------------------------------------------------------------------------
# Step 0.55 第九组（W42 接入）：GOAL §十一 工作面表的结构完整性闸门
#
# ## 为什么必须有（P-11 元级 · W42 真实事故）
# §十一（§11.1 立刻可做 / §11.2 须真机 / §11.3 长期持续）是「**当前在做哪几件事**」的 SSOT，
# 且是**每轮必改**的动态区 —— 改动越频繁，**结构被写坏的概率越高**，而后果是**静默的**
# （GFM 照常渲染，只是内容少了一列 / 编号指错了对象）。W42 一次编辑后同时撞见三类：
#   ① ★ **列数错位（静默丢信息）**：§11.3 表头 **3 列**，而 **6 行**按 §11.1 的 **4 列**模板写
#      ⇒ GFM **不报错、直接丢弃**多出的单元格 ⇒ 「轨道」「状态」**根本不渲染**，
#        读者会误以为该工作面还没做（P-27 过期结论误导）。
#   ② ★ **跨表编号复用（引用歧义）**：`W10` 在 §11.1 指「A15 闸门盲区排查」、在 §11.2 指
#      「L4 proot 生存性」—— **两件毫不相干的事共用一个编号** ⇒ 引用「W10」者无法判断指哪个（P-1）。
#   ③ **重复登记**：`W36 续` 在 §11.1 与 §11.3 各记一条（同一轮同一件事），两条会**各自过期**。
#   ★ 与第八组（§六 表）同族：**「当前在做哪几件事」的 SSOT 此前没有任何机器守着**。
#   判据 = ① 三表都可解析（切不出 ⇒ fail-closed，不许静默当 0 违规）
#          ② 三表数据行总数不得跌破下限（防「整段被静默删掉」；**下限 ≠ 精确值**）
#          ③ ★ **同表内每行列数必须等于该表表头列数**（实读表头，**不硬编码**；本轮事故 ①）
#          ④ 同表内 ID 唯一  ⑤ ★ **跨表 ID 不得复用**（本轮事故 ②）
#          ⑥ ⓘ 行首缩进只**提示不报红**（GFM ≤3 空格仍认表格行，**不丢信息** ⇒ 守 P-38 防过宽假红）
#          ⑦ ★ **P 判据编号一致性**（W43；**W54 补 ⑦c 实现**）—— §九 索引 / §3.1 声明 /
#             方法论 §5.4 定义三处必须一致；⑦c 此前**在头注与 GOAL §3.2 里声明已实现，
#             而实现里一条都没有**（脚本连方法论都没打开过）= **P-56 的形态**，
#             且当时 §5.4 **恰好覆盖全部编号** ⇒ **假绿与真绿同貌**（P-30 / W45 识别特征）。
#             **W54 承重实验**：把 ⑦c 短路 ⇒ selftest 7 FAIL **且负控 6 FAIL**（短路前负控 13/13 全绿）
#             ⇒ 当场抓到**负控自身的空洞**（对 ⑦c 零覆盖）⇒ 补 E1~E4 后负控 13/13 → 20/20。
#          ⑧ ★ **§十一 下的每个 `### 11.x` 必须登记**（W52；否则行被上一节切面静默吞并而报绿）
#   配**真实仓库负控** `audit-goal-sections-negctl.mjs`（守 B11：注入坏样本 ⇒ 报红且指向行号；
#   删除 ⇒ 回绿；逐字节还原）。★ **W54 新增 `--method <path>`**：判据 ⑦c 读方法论 ⇒
#   负控必须能对**方法论副本**注入坏样本（否则本条判据**无法被负控**，P-1）。
#   ★ 该闸门首版有两处自身缺陷，**全部由负控当场证伪**：⑴ 表头识别用「首列是 `#`」的启发式
#   ⇒ 表头被写坏时**静默退化**（少一行 + 整表判据错位，却照样报绿）⇒ 改按 GFM 语法
#   「表格行 + 紧跟分隔行」配对；⑵ 负控自己的注入锚点取到了**表头行**（而非数据行）、
#   且「改名」仍匹配原正则 ⇒ **假负控**（P-41 推论四：判据的输入解析也需要断言）。
$gs = Join-Path $ws 'scripts\audit-goal-sections.mjs'
if (-not (Test-Path $gs)) { throw "判据脚本缺失：$gs（§十一 工作面表闸门不得缺项）" }
& node $gs --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-goal-sections.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-goal-sections.mjs --selftest（40/40，含列数错位 / 跨表复用 / P 判据过期声明 / ★ W54 ⑦c 缺定义·索引外编号·切面失效·杠杆 的负控与杠杆）"
& node $gs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-goal-sections.mjs（§十一 工作面表结构损坏：列数错位 / ID 复用 / 项数跌破下限 / P 判据编号与声明不一致）" }
Write-Host "  [gate] OK audit-goal-sections.mjs（§十一 三表结构自洽：列数对表头 + ID 同表唯一 + 跨表无复用 + P 判据编号与声明一致）"
Show-Reading -Gate 'audit-goal-sections.mjs' -Path $gs   # ★ W62：§十一 三表规模读数（P-49）
$gsNc = Join-Path $ws 'scripts\audit-goal-sections-negctl.mjs'
if (-not (Test-Path $gsNc)) { throw "负控脚本缺失：$gsNc（§十一 工作面表闸门不得缺项）" }
& node $gsNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-goal-sections-negctl.mjs（闸门可能已成『死判据』或收窄过头）" }
Write-Host "  [gate] OK audit-goal-sections-negctl.mjs（23/23：注入坏样本→报红指向行号 · ★ W54 方法论副本注入（E1~E3）· 杠杆 E4 · 还原→回绿）"

# ---------------------------------------------------------------------------
# Step 0.55 第十组（W44 接入）：判据自证分数声明的**单源输出契约** + 一致性闸门
#
# ## 为什么必须有（P-11 元级 · W44 由 W43 的分诊带出）
# W42/W43 给「文档结构」装了闸门，但**闸门自己的分数无法被机器读出** ——
# 因为收尾输出历史上长成了**三种形态**（实测）：`24/24 PASS` / `PASS（14/14）` / `OK —— 有杠杆（…）`。
# ⇒ 后果：文档里的分数与实现**可以静默脱钩**。W44 实测抓到**两处真缺陷**：
#   · `audit-goal-sections.mjs` / `-negctl`：文档写 16/16 与 11/11，实际已 24/24 与 13/13
#     （**W42 扩判据后没同步文档**）；
#   · `audit-p48-negctl.mjs`：文档写 8/8 而脚本**根本不输出分数** ⇒ 声明**无法被证伪**。
#   ★ 这类不一致**人眼极难发现**（数字散落在 4 份文档的十几处，格式各异）。
# ## 判据
#   ① `scripts/selftest-summary.mjs` 是分数行的**唯一产出点**（P-1：不在各脚本手抄格式串）；
#   ② `scripts/audit-selftest-claims.mjs`（selftest **23/23**）逐条对照
#      「文档里的当前声明」与「脚本实测分数」：声明过期 / 未接入契约 / 悬空引用 ⇒ 报红。
#      ★ 扫描面**只含构建期闸门**（名单**实读 `build-dsht.ps1`**，不硬编码 —— P-27）；
#        设备探针（`ef-*`）**不参与比对**（构建期无 adb ⇒ 其分数无法在此证伪），只作信息项。
#   ③ 配**真实仓库负控** `audit-selftest-claims-negctl.mjs`（守 **B11**：注入「声明过期」
#      「悬空引用」⇒ 报红且指向行号；还原 ⇒ 回绿；**逐字节**自证）。
#   ★ 闸门首版**连踩两处自身缺陷**，全部由真实仓库负控当场证伪：
#     ⑴ 扫描面过宽（把 30+ 个设备探针算进来 ⇒ 一次报 20+ 处「未接入」，**P-45 识别特征**）
#        ⇒ 收窄为「实读构建脚本里的闸门」；
#     ⑵ ★★ 声明抽取的**窗口写窄**（40 字 ⇒ §3.2 的「脚本名 → 长描述 → selftest **24/24**」
#        实距 37 字但在 `**24` 处被截断）⇒ **负控注入后闸门仍报绿**（判据失效而与通过同貌，P-30）
#        ⇒ 窗口放宽到 60 字 + **不跨表格列边界 `|`**（后者防把下一列的数字读成本脚本的分数）。
$stSummary = Join-Path $ws 'scripts\selftest-summary.mjs'
if (-not (Test-Path $stSummary)) { throw "单源契约缺失：$stSummary（W44 的自证分数输出契约不得缺项）" }
$stClaims = Join-Path $ws 'scripts\audit-selftest-claims.mjs'
if (-not (Test-Path $stClaims)) { throw "判据脚本缺失：$stClaims（自证分数声明闸门不得缺项）" }
& node $stClaims --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-selftest-claims.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-selftest-claims.mjs --selftest（136/136，含声明过期 / 悬空引用 / 未接入契约负控与杠杆；W45 补：按区段语义界定扫描面 + 任意路径前缀 + 对比叙述/别的量词排除；★ W65 补：变化叙述（A → B 取右值）+ 窗口不得截断在数字中间 + ★ 第三受守面（本文件的 gate 文案）；★ W71 补：头注声明的判据条数 vs 实现条数；★ W72 补：表格行内**跨列**分数抽取（表格列边界不再切断窗口）；★ W73 补：头注「无汇总数逐条清单」vs 实现分组键；★ W74 补：闸门支持的**输入面参数**必须被其负控真的传过；★ W75 补：头注「## 退出码」段 vs 实现的 exit 实参（幽灵声明 / 未声明的码）；★ W76 补：**第二排版形态**（注释行内「退出码：0 = …」，含续行、引用编号剔除、Python 用 sys.exit/return N、括号配平）；★ W77 补：**头注用法行声明的 CLI flag vs 实现真的读它**（双向对账 + 四种读取形态 + 含反引号的行跳过 + 豁免表机器守）；★ W78 补：**读数登记的 `Pattern` 必须真的能匹配到值**（实跑核验 + 自调用链排除 + 只出声不报红两种边界 + 非法正则与「匹配 0 行」分家））"
& node $stClaims | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-selftest-claims.mjs（文档里的自证分数声明与实测不一致或无法被证伪）" }
Write-Host "  [gate] OK audit-selftest-claims.mjs（文档声明与脚本实测逐条一致，且分数行可被机器读出）"
Show-Reading -Gate 'audit-selftest-claims.mjs' -Path $stClaims   # ★ W62：受检闸门数 / 文档声明数
$stNc = Join-Path $ws 'scripts\audit-selftest-claims-negctl.mjs'
if (-not (Test-Path $stNc)) { throw "负控脚本缺失：$stNc（自证分数声明闸门不得缺项）" }
& node $stNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-selftest-claims-negctl.mjs（闸门可能已成『死判据』）" }
Write-Host "  [gate] OK audit-selftest-claims-negctl.mjs（有杠杆：注入声明过期/悬空引用→报红指向行号 · 还原→回绿）"

# ---------------------------------------------------------------------------
# Step 0.55 第十一组（W45 接入）：GOAL §3.1「基线数字」与可核对真值的一致性闸门
#
# ## 为什么必须有（P-11 元级 · W43 分诊列出的第①处「无机器守着」区）
# §3.1 是**每轮必改**的基线表（vitest 通过数 / 门禁条数 / sentinel / M4 / P 判据条数），
# 而它恰恰是「**什么算坏**」的定义 —— 读者（含未来的 AI）靠它判断「有没有回归」。
# ★ 但**没有任何机器守着它**。W43/W44 已实测出两处**同类真缺陷**：
#   · §3.1 写「P-1 ~ P-48」而 §九 索引已到 P-49（**W43**，两处相隔 400 行）；
#   · §3.2 写 selftest 16/16 而实际已 24/24（**W44**，扩判据后没同步）。
# ⇒ 若基线表里的数字错了，**整轮的「不劣化」判断都建立在错数字上**。
# ## 判据（**只核「可机器取真值」的量** —— 守 P-38 防过宽）
#   ① **门禁条数**：§3.1 声明的 `N 条 [gate] OK` == **构建日志实测条数**（真值来自日志，不重跑构建）；
#   ② **sentinel 版本**：§3.1 声明的 `vN` == 两份构建日志实测（不一致则**不判**，守 P-43）；
#   ③ **P 判据累计条数**：== §九 索引实际行数（与 `audit-goal-sections` 判据 ⑦b **同口径**，P-1）；
#   ④ **M4 项数**：== 产物核验实测。
# ## ★ 诚实边界（R7）—— 哪些**不核**及为什么
#   **vitest / typecheck / M7** 不在此核：前者耗时数分钟，后者需 adb+WebView ⇒
#   放进构建期门禁会把「设备没插」「构建太慢」变成**门禁失败**（P-40③ / P-45）。
#   ⇒ 本闸门对它们**只做形态断言**，**不假装核对了真值**，也不替代 §十二 第 2 条的人工基线回归。
# ## 配**真实仓库负控**（守 B11）
#   `audit-baseline-claims-negctl.mjs`（**40/40**（W74 扩后））注入「门禁条数过期」「P 判据条数过期」⇒ 报红且**指出两个值**；
#   改回 ⇒ 回绿。★ **与 W44 负控的关键差别**：它**只用 `--file <临时副本>`，全程不碰真实 GOAL**
#   —— 从结构上消除「注入残留」这一整类风险（**W44 实测的 R23 级事故**：负控被强杀 ⇒
#   GOAL 里残留 `23/24`，而报告里没有任何一行说还原没跑）⇒ 这是 **P-48 的更强形态：
#   能不改就不改，比「改了能还原」更安全**。
$bl = Join-Path $ws 'scripts\audit-baseline-claims.mjs'
if (-not (Test-Path $bl)) { throw "判据脚本缺失：$bl（基线数字闸门不得缺项）" }
& node $bl --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-baseline-claims.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-baseline-claims.mjs --selftest（90/90，含门禁条数/ sentinel / P 判据条数 / M4 / ★ §八 验收 / ★ W57-W60 会增长的读数不得写成硬常量（四文档面：GOAL + README + V0.3-FREEZE + TASK-LIST）+ ★ W60 契约快照面读数（slots 声明数 vs contracts/*/slots.json，含快照自动发现与自洽性）+ ★ W64 豁免依据必须点名到能跑到的通路 + ★ W66 日志读数 vs 文档数字对账 的负控与杠杆；W45 补：半截日志不得当真值 + 构建期单向口径）"
& node $bl | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-baseline-claims.mjs（§3.1 基线数字与实测不一致 ⇒ 「不劣化」判断建立在错数字上）" }
Write-Host "  [gate] OK audit-baseline-claims.mjs（§3.1 可核对数字与实测一致：门禁条数 / sentinel / P 判据条数）"
# ★ W62：**改为调用唯一的 `Show-Reading`**（此前这里是**硬编码的第三套实现** ——
#   注释还写着「与 `$readingGates` 表**同法**（P-1：读数机制只许一处实现形态）」，
#   而实际已是三处 ⇒ **声明与实现不符**，P-59 的同族）。
#   ★ 同时**覆盖面扩大**：登记表里本闸门的 pattern 是「§3.1 声明 | slot 数核对」两条
#     —— 前者（`[基线] §3.1 声明：门禁=… sentinel=… P判据=… · 真值：…`）此前**从未进过日志**。
Show-Reading -Gate 'audit-baseline-claims.mjs' -Path $bl
$blNc = Join-Path $ws 'scripts\audit-baseline-claims-negctl.mjs'
if (-not (Test-Path $blNc)) { throw "负控脚本缺失：$blNc（基线数字闸门不得缺项）" }
& node $blNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-baseline-claims-negctl.mjs（闸门可能已成『死判据』）" }
Write-Host "  [gate] OK audit-baseline-claims-negctl.mjs（40/40：注入过期→报红指出两值 · ★ W57-W60 会增长的读数写死（GOAL §3.2 + B10 + README + V0.3-FREEZE 四形态）+ ★ W60 契约快照面 slots 数与杠杆 + ★ W64 豁免依据（装置不在跑 ⇒ 不豁免）+ ★ W66 文档数字 < 日志读数 ⇒ 报红 + ★ W74 TASK-LIST 面（第四个受守文档，此前该输入面从未被负控传过）· 真实仓库全程未被触碰）"

# ---------------------------------------------------------------------------
# Step 0.55 第十二组（W46 接入）：E-H「文档一致」的**引用完整性**闸门
#
# ## 为什么必须有（P-11 元级 · §八 八条验收里**唯一完全无守卫**的一条）
# GOAL §八 E-H 要求四份文档「与代码现状一致，**无失效描述**」；
# ★ W46 按 P-11 元级排查实测：其余七项各有闸门（E-B→`audit-matrix-residuals` /
#   E-C→`audit-baseline-claims` / E-D→`audit-impl-duplication` …），**只有 E-H 全凭人眼**。
#   而「删脚本 / 改路径」是本仓**每轮高频动作**（W42~W46 五轮内删改多个装置）⇒
#   文档里的引用**悄悄悬空**是必然事件（P-27：结论会过期而没人回头改）。
#
# ## 判据（四条）
#   ① **可执行引用**：`node|python|bash <path>` 里的路径必须存在（读者会照抄 ⇒ 错了直接失败）；
#   ② **`scripts/…` 位置声明**必须真实存在；
#   ③ **`docs/…` 位置声明**必须真实存在（两基点并集）；
#   ④ ★★ **同行并列装置的「位置不一致」** —— **这条抓的是 W46 实测的真缺陷**：
#      方法论 §5.4 的 P-4 定义行把 `packages/tests/session-contract-probe.mjs`
#      与两个 `scripts/` 装置**并列陈述** ⇒ 读者默认它们同处，去找必扑空。
#      ★ 判据①②③ **都抓不到它**（它是裸名、无可执行形态、无路径前缀）。
#
# ## ★ 口径纪律（守 P-38/P-45 —— 首版口径被真实仓库当场证伪）
#   · **必须排除**「泛化示例名」（`x.mjs` 之类，正文里泛指某个脚本；
#     不排除则本仓一次报 **4 处假红**）；
#   · ★★ 否定标记**必须按「就近窗口（±40 字）」判，不能整行命中即排除**：
#     实测形态 = 行中间是**真实的位置误导**、行尾**远处**恰有「正控/**负控**/零控」字样
#     ⇒ 整行口径把真缺陷一起豁免 = **判据失效**（P-30）。
#
# ## ★ W49 扩面（扫描面 + 判据⑤）
#   ① **扫描面**：E-H 四份 **+ SSOT 自身（`docs/GOAL.md`）** —— 后者此前**不在任何引用闸门
#      的扫描面内**，而它是**每轮都被照着执行的**唯一事实来源；
#   ② **判据⑤（新）**：可执行引用的**目标必须在版本控制内**（`git check-ignore`）——
#      ①②③ 只问「在不在本机磁盘上」，而 P-53 指出还有一层：**别人克隆后拿不拿得到**。
#      实测真缺陷：§3.1「怎么跑」列原指向 `rp-workspace/tmp/*.mjs`（`tmp/` 在 `.gitignore:34` 内）
#      ⇒ 本机看着好好的，**别人克隆后根本不存在**；
#   ③ **史实区 mask**：GOAL §十一 / 方法论 §六 / 契约附录 = **逐轮记录**（写下时是真的）
#      ⇒ 必须按区段语义 mask，否则判据会**永远报红**（首版实测 70 处假红）。
#
# ## 配**真实仓库负控**（守 B11）
#   `audit-doc-refs-negctl.mjs`（**18/18**）注入「悬空位置声明」「并列装置位置不一致」
#   「可执行引用悬空」「引用目标不在版本控制内」+ **mask 杠杆**（史实区标记改名 ⇒ 立刻报红）
#   ⇒ 报红且**理由正确**；改回 ⇒ 回绿。
#   ★ **全程只用 `--file <临时副本>`，绝不碰真实文档**（P-48 更强形态：能不改就不改）。
$dr = Join-Path $ws 'scripts\audit-doc-refs.mjs'
if (-not (Test-Path $dr)) { throw "判据脚本缺失：$dr（E-H 文档引用闸门不得缺项）" }
& node $dr --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-doc-refs.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-doc-refs.mjs --selftest（83/83，含可执行引用/位置声明/并列装置位置不一致/★在版本控制内的正负控与杠杆；★ W65 补：受守面清单与 GOAL §八 E-H 单源一致性；★ W69 补：跨文档章节引用可达（点名「<文档> §x.y」而该文档无此节 ⇒ 读者必然扑空）；★ W70 补：豁免窗口紧贴（前 12/后 6）且词表不含日常高频措辞，含 4 条「豁免词在场 + 真缺陷 ⇒ 必须报红」的攻击样本控；★ W79 补：**行号式引用可达**（`<文件>:<行号>` 越界 / 区间写反 ⇒ 报红；非本仓目标 / 同名多处 / 自指 ⇒ 只出声，守 P-43/P-46））"
& node $dr | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-doc-refs.mjs（E-H + SSOT 里点名要存在的东西不存在 / 不在版本控制内 ⇒ 读者按它去找会扑空）" }
Write-Host "  [gate] OK audit-doc-refs.mjs（E-H 四份 + SSOT 的引用完整性：可执行引用 + scripts/docs 位置声明 + 并列装置位置一致 + ★可执行引用目标在版本控制内）"
Show-Reading -Gate 'audit-doc-refs.mjs' -Path $dr   # ★ W62：E-H 扫描规模读数
$drNc = Join-Path $ws 'scripts\audit-doc-refs-negctl.mjs'
if (-not (Test-Path $drNc)) { throw "负控脚本缺失：$drNc（E-H 文档引用闸门不得缺项）" }
& node $drNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-doc-refs-negctl.mjs（闸门可能已成『死判据』）" }
Write-Host "  [gate] OK audit-doc-refs-negctl.mjs（38/38：七类注入→报红且理由正确 · mask 失效→报红 · ★ W65 受守面单源的两侧（改文档 / 删清单）→报红 · ★ W69 跨文档章节引用不可达（全名 / 简称两种形态）→报红 · ★ W70 豁免词在场仍须报红（窗口 + 词表两侧）→报红 · 改回→回绿 · 真实文档全程未被触碰）"

# ---------------------------------------------------------------------------
# Step 0.55 第十三组（W50 新增）：**§七 纪律表的「机器化落点」声明闸门**
#
# ## 守什么
# `GOAL.md` §七 每条纪律（R1~R23）里凡**声明「这件事已被机器守着」**
# （「已机器化」/「已加静态护栏」/「已接入 Step X」/「由 `<装置>` 常驻守」/「判据报红」…），
# 该声明必须：① **点名装置** ② **装置真实存在** ③ ★★ **触发路径可判定**
# （在构建期门禁里 **或** 是一条会被 `npm run test` 跑到的 vitest 规格）。
#
# ## 为什么必须（W50 实测的真缺陷）
# **R19** 写「**已加静态护栏：DOM 增强模块扫出 `replaceChild` 即报红**」——
# **没点名装置**。取证：护栏真身是 `packages/tests/touch-target-audit.spec.ts` 的 P-31 家族回归锁，
# **不在构建期 45 条门禁内**（`grep vitest build-dsht.ps1` = 0 命中）——
# 读者按字面理解会以为**构建期就守着**，而构建期**一条都不查它**。
# ⇒ 这正是 **P-55 的同族**：「声明指向的东西，在**读者会走的路径**上存不存在」。
#
# ## 配**真实仓库负控**（守 B11）
# `audit-rule-claims-negctl.mjs`（**10/10**）注入三类坏样本
# （没点名装置 / 装置不存在 / ★ 装置存在但**无触发路径**）⇒ 报红且结论正确；改回 ⇒ 回绿。
#   ★ **全程只在内存里改文本，连副本都不落盘**（P-48 的最强形态）。
$rc = Join-Path $ws 'scripts\audit-rule-claims.mjs'
if (-not (Test-Path $rc)) { throw "判据脚本缺失：$rc（§七 纪律声明闸门不得缺项）" }
& node $rc --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据自证失败：audit-rule-claims.mjs --selftest（闸门自己坏了 ⇒ 它的『0 违规』无意义）" }
Write-Host "  [gate] OK audit-rule-claims.mjs --selftest（22/22，含『没点名装置』『装置不存在』『无触发路径』三类负控与杠杆 + 续行切块正控 + ★ W53 表格续行/扫描面/CLAIM_RE 收窄）"
& node $rc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据未通过：audit-rule-claims.mjs（§七 纪律 或 §九 P 判据 声明『已机器化/已加护栏』但装置缺失或无触发路径 ⇒ 空声明）" }
Write-Host "  [gate] OK audit-rule-claims.mjs（§七 纪律 + ★ §九 P 判据索引：点名 + 存在 + ★ 触发路径可判定）"
Show-Reading -Gate 'audit-rule-claims.mjs' -Path $rc   # ★ W62：§七/§九 声明有机器守条数（P-58）
$rcNc = Join-Path $ws 'scripts\audit-rule-claims-negctl.mjs'
if (-not (Test-Path $rcNc)) { throw "负控脚本缺失：$rcNc（§七/§九 声明闸门不得缺项）" }
& node $rcNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "判据杠杆自检未通过：audit-rule-claims-negctl.mjs（闸门可能已成『死判据』）" }
Write-Host "  [gate] OK audit-rule-claims-negctl.mjs（有杠杆：五类注入→报红且结论正确 · 切面失效→fail-closed · 假红零控 · 改回→回绿 · 真实仓库全程未被触碰）"

# ---------------------------------------------------------------------------
# Step 0.6 官方契约**事前探针**（E3 / P-4）——【2026-09-14 新增】【2026-09-16 P-40 修时序】
#
# ## 为什么必须独立于十二项门禁、且**不放进 Step 0.5**
# 十二项门禁全是**我方源码**的静态审计（不碰官方包）；而官方 beta 的破坏性变更
# 才是本项目最大系统性风险（历史代价：41 个会话迁移失败 / 缺 stream 致整会话打不开 /
# surfaceOp 字段名换代——全部靠**用户真机撞见**）。
# 但本探针**需要 runtime 已就绪**（读的是 `dsh-runtime-android/node_modules/@deepseek-ai`）。
#
# ## 【2026-09-16 W24c · P-40③】时序缝隙修复：本步骤只在 SkipInstall 时跑
# 原实现把它放在 Step 0.6（`SkipInstall` 判定**之前**、Step 1/3 **替换 runtime 之前**）
# ⇒ 它读的是**磁盘上残留的上一代产物**，而不是本次将要打包的那一代。
# 实测证据（本轮）：同一天两次构建
#   · arm64（磁盘上残留 0.1.5 世代）⇒ 探针读旧树 ⇒ **通过**，可它随后把树换成了 0.1.2；
#   · x86_64（磁盘上已是 0.1.2）  ⇒ 探针读新树 ⇒ **BLOCK**
# 同一份「本轮源码」因**磁盘残留代次不同**得到相反结论 —— 这就是「先检查后替换」的
# 典型症状（判据与被判对象不是同一个）。
# ⇒ 修法：**探针移到 Step 3.6（runtime 替换完成之后）**；Step 0.6 只在 `-SkipInstall`
#   时保留（那时 `$runtimeDst` 就是本次要用的产物，没有时序问题）。
#
# ## 判据分级（不是一律 fail —— 不同契约的破坏性不同）
#   · BLOCK 级破坏（无降级路径）⇒ **构建中止**（带着它打包 = 出厂的包必然坏）；
#   · WARN / UNKNOWN  ⇒ **出声**但不阻塞（有降级路径 / 需人工确认）。
# 退出码：0=无 BLOCK；2=有 BLOCK（中止）；1=锚点缺失（fail-closed）；3=selftest 失败。
# ---------------------------------------------------------------------------
Step 0.6 '官方契约事前探针（E3/P-4；仅在 SkipInstall 时于此处跑，其余见 Step 3.6）'
$ocProbe = Join-Path $ws 'scripts\audit-official-contract.mjs'
if (-not (Test-Path $ocProbe)) { throw "契约探针缺失：$ocProbe（E3 事前探针不得缺项）" }
& node $ocProbe --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "契约探针自检失败：audit-official-contract.mjs --selftest（闸门本身不可信）" }
Write-Host "  [gate] OK audit-official-contract.mjs --selftest"
if (-not $SkipInstall) {
    Write-Host "  [gate] 非 SkipInstall：本步骤推迟到 Step 3.6（runtime 替换完成之后才探测，P-40③）"
} else {
$ocRoot = Join-Path $runtimeDst 'node_modules\@deepseek-ai'
if (Test-Path $ocRoot) {
    & node $ocProbe | Out-Null
    $ocCode = $LASTEXITCODE
    if ($ocCode -eq 2) { throw "官方契约 BLOCK 级破坏（无降级路径）——详见 node scripts/audit-official-contract.mjs" }
    if ($ocCode -ne 0) { throw "官方契约探针异常退出（code=$ocCode；1=锚点缺失，属配置问题）" }
    Write-Host "  [gate] OK audit-official-contract.mjs（无 BLOCK 级破坏）"
} else {
    Write-Host "  [gate] ⚠️ runtime 未就绪（$ocRoot 不存在）——契约探针本次**未执行**（SkipInstall 首次构建属正常；已出声，不静默）" -ForegroundColor Yellow
}
}

# ---------------------------------------------------------------------------
# SkipInstall 时 runtime 已有依赖（node_modules 在 dsh-runtime-android/），packages 的
# esbuild 用现有依赖（pnpm install 在 Step 0/Step 1 非必须——SkipInstall 跳过）
if (-not $SkipInstall) {
    Step 1 "安装 @deepseek-ai/dsh@$DshVersion（干净目录，hoisted 布局）"
    if (Test-Path $runtimeSrc) { Remove-Item $runtimeSrc -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $runtimeSrc | Out-Null
    # 预写 package.json（2026-09-04 坑 #9）：pnpm 10.3x 的 project-root 解析会从 cwd 向上
    # 找最近的 package.json——空目录会让 add/install 提升到 rp-workspace 根（把我们工程
    # 根的 package.json/node_modules 当成安装目标，root 被污染成 dsh 依赖树，踩过）。
    # 先写明依赖再 install：cwd 自带 package.json 即 project root，node_modules 落本目录。
    [IO.File]::WriteAllText("$runtimeSrc\package.json", (@"
{
	"dependencies": {
		"@deepseek-ai/dsh": "$DshVersion",
		"dsh-preset-enhance": "$PresetEnhanceVersion"
	}
}
"@))
    Push-Location $runtimeSrc
    & $pnpm[0] $pnpm[1] $pnpm[2] install --node-linker=hoisted --registry=https://registry.npmmirror.com 2>&1 | Select-Object -Last 2
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pnpm install 失败" }
    Pop-Location
    $binOk = Test-Path "$runtimeSrc\node_modules\@deepseek-ai\dsh\lib\bin.js"
    if (-not $binOk) { throw "dsh lib/bin.js 不存在（安装异常）" }
    Write-Host "  安装完成，bin.js 就位"

    Step 2 '平台审计（列出全部原生/平台专属包）'
    $nm = "$runtimeSrc\node_modules"
    $nativePkgs = @()
    # .node 二进制
    Get-ChildItem $nm -Recurse -Filter *.node -ErrorAction SilentlyContinue | ForEach-Object {
        $rel = $_.FullName.Substring($nm.Length + 1)
        $pkg = ($rel -split '[\\/]')[0..1] -join '/'
        $nativePkgs += [pscustomobject]@{ pkg = $pkg; file = $rel; elf = ($_.Length -gt 0) }
    }
    $platformPkgs = @(Get-ChildItem $nm -Directory | Where-Object { $_.Name -match 'win32|darwin|linux-(x64|arm64)' })
    $platformPkgs += @(Get-ChildItem "$nm\@img", "$nm\@koromix" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'win32|darwin|linux' })
    Write-Host "  原生 .node 二进制（前 12）：" 
    $nativePkgs | Select-Object -First 12 | ForEach-Object { Write-Host "    $($_.file)" }
    Write-Host "  平台专属包："
    $platformPkgs | ForEach-Object { Write-Host "    $($_.Name)" }
    # 已知 stub 清单外的原生依赖 → 警告（坑 #1 的自动检测）
    $knownStubs = 'node-addon-require-builtin|sharp|koffi'
    $foreign = $nativePkgs | Where-Object { $_.file -notmatch $knownStubs -and $_.file -notmatch 'node-pty[\\/]prebuilds' }
    if ($foreign) {
        Write-Host "  ⚠️ 发现 stub 清单之外的原生依赖，请确认是否需要新增 stub（坑 #1）：" -ForegroundColor Yellow
        $foreign | ForEach-Object { Write-Host "    $($_.file)" -ForegroundColor Yellow }
    } else {
        Write-Host "  无未知原生依赖（全部在已知 stub/预构建范围内）OK"
    }

    Step 3 '平台适配：删 win32/darwin 包 + 应用 stubs（坑 #1/#2：stub 是 Android 唯一正解）'
    if (Test-Path $runtimeDst) { Remove-Item $runtimeDst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path "$runtimeDst\node_modules" | Out-Null
    Copy-Item "$nm\*" "$runtimeDst\node_modules\" -Recurse -Force
    Copy-Item "$runtimeSrc\package.json" $runtimeDst -Force
} else {
    # SkipInstall：runtime 已有依赖（node_modules 在 dsh-runtime-android/），用现有 runtime
    $runtimeSrc = $runtimeDst
    Write-Host "  SkipInstall：用现有 runtime（$runtimeDst）"
}
    # lib/（版本号 so，双路加载用；来源按 -Arch 选择）
    if (Test-Path "$runtimeDst\lib") { Remove-Item "$runtimeDst\lib" -Recurse -Force }
    if (Test-Path $runtimeLib) { Copy-Item $runtimeLib "$runtimeDst\lib" -Recurse -Force }
    # 3b. 删 win32/darwin 平台包
    Get-ChildItem "$runtimeDst\node_modules" -Directory | Where-Object { $_.Name -match 'win32|darwin' } | Remove-Item -Recurse -Force
    Get-ChildItem "$runtimeDst\node_modules\@img", "$runtimeDst\node_modules\@koromix" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'win32|darwin|linux' } | Remove-Item -Recurse -Force
    # 3c. 应用 stubs（六件套：require-builtin / sharp / koffi / node-pty / landlock-run / sandbox-windows-acl）
    Copy-Item "$stubs\node-addon-require-builtin\index.js" "$runtimeDst\node_modules\node-addon-require-builtin\lib\index.js" -Force
    Copy-Item "$stubs\sharp\index.js" "$runtimeDst\node_modules\sharp\dist\index.cjs" -Force
    Copy-Item "$stubs\sharp\index.mjs" "$runtimeDst\node_modules\sharp\dist\index.mjs" -Force
    Copy-Item "$stubs\koffi\index.js" "$runtimeDst\node_modules\koffi\index.js" -Force
    Copy-Item "$stubs\koffi\index.cjs" "$runtimeDst\node_modules\koffi\index.cjs" -Force
    Copy-Item "$stubs\node-pty\index.js" "$runtimeDst\node_modules\node-pty\lib\index.js" -Force
    # node-pty prebuilds 全删（linux-arm64 是 glibc 编译，Android bionic 加载必炸；体积也省）
    if (-not $SkipInstall) {
    Remove-Item "$runtimeDst\node_modules\node-pty\prebuilds" -Recurse -Force -ErrorAction SilentlyContinue
    # 沙箱双平台雷：dsh-sandbox-local 顶层静态 import 这两个包（landlock native 二进制 / koffi 顶层调用）
    # probe()='unusable' 让 DSH 走 SandboxUnavailableError 降级路径——沙箱不可用但服务可启动
    #
    # 【2026-09-16 W24c · P-27 形态】landlock 的原生包**位置随官方版本变了**：
    #   · dsh 0.1.2 世代：独立包 `@deepseek-ai/node-addon-landlock-run`（lib/index.js）
    #   · dsh 0.1.5 世代：**合并进 `@deepseek-ai/node-addon-system`**，由
    #     package.json 的 `"./landlock-run"` 子路径导出映射到 **同一个 `lib/index.js`**
    #     （`dsh-sandbox-local/lib/index.js:6` 的 import 已改为
    #      `from "@deepseek-ai/node-addon-system/landlock-run"`）。
    #   ⇒ 若只按旧路径拷贝，装 0.1.5 时会 `Copy-Item` 报 "Could not find a part of the path"
    #     ⇒ **整个构建中止**（本轮实测踩到）。故按「**哪一代存在就改哪一代**」处理：
    #     两代都覆盖（同一份 stub 内容，语义等价：probe()='unusable'），
    #     且**都不存在时出声**（不静默 —— 若将来又换位置，必须有人知道）。
    # 【注意】同包内的 `flock.js` 是**另一个文件**（`dsh-session-persistence-jsonl` 用，
    #   见下方 DSHT-ANDROID-FLOCK 补丁），本次覆盖的是 `index.js`（landlock 出口）⇒ **互不影响**。
    #   实测确认：`node-addon-system/lib/index.js` = landlock 的 JS API（导出 LAUNCHER_BIN 等）；
    #   `node-addon-system/lib/flock.js` = flock 入口（导出 loadBinding）。两者无交集。
    $landlockStub = "$stubs\node-addon-landlock-run\index.js"
    $llOld = "$runtimeDst\node_modules\@deepseek-ai\node-addon-landlock-run\lib\index.js"
    $llNew = "$runtimeDst\node_modules\@deepseek-ai\node-addon-system\lib\index.js"
    $llHit = 0
    if (Test-Path (Split-Path $llOld -Parent)) { Copy-Item $landlockStub $llOld -Force; $llHit++ }
    if (Test-Path (Split-Path $llNew -Parent)) { Copy-Item $landlockStub $llNew -Force; $llHit++ }
    if ($llHit -eq 0) {
        Write-Host "  ⚠️ F2 landlock stub 未应用：新旧两代路径都不存在（$llOld / $llNew）——官方可能又换位置，请核对 dsh-sandbox-local 的 import" -ForegroundColor Yellow
    } else {
        # 分段拼装（PS 的 $() 内嵌引号会破坏解析，实测踩到）
        $llWhere = @()
        if (Test-Path (Split-Path $llOld -Parent)) { $llWhere += '旧代独立包' }
        if (Test-Path (Split-Path $llNew -Parent)) { $llWhere += '新代 node-addon-system' }
        Write-Host ("  landlock stub 已应用（命中 {0} 处：{1}）" -f $llHit, ($llWhere -join ' + '))
    }
    Copy-Item "$stubs\dsh-sandbox-windows-acl\index.js" "$runtimeDst\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\lib\index.js" -Force
    Copy-Item "$stubs\dsh-sandbox-windows-acl\runner.js" "$runtimeDst\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\lib\runner.js" -Force
    # 【2026-09-16 W24c · P-1 两条构建路径不同步】dsh-win32-process stub 落盘。
    #
    # ## 症状（本轮设备实测，最严重的一类：**整个插件树没起来**）
    # 装 0.1.5 世代 APK 后，页面能看到宿主 UI 但**我方容器计数全为 0**
    # （`dshtAny: 0` / `floorHead: 0` / `assistant: 0`），M7 因此 5/5 卡「切卡未生效」。
    # logcat 首因（决定性）：
    #     dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
    #     failed to import loader entry subprocess (@deepseek-ai/dsh-subprocess-local):
    #     STARTUPINFOW layout mismatch: koffi computed undefined, expected 104
    #
    # ## 真因（读产物逐行确认）
    # dsh 0.1.5 的 `@deepseek-ai/dsh-win32-process` 是**真实实现**（不再是空壳），
    # 它 `lib/index.js:1` 就 `import koffi from "koffi"`，并在**模块顶层**（`:35`、`:63`）做
    # ABI 断言：
    #     const STARTUPINFOW = koffi.struct("DSH_STARTUPINFOW", { … });
    #     if (STARTUPINFOW.size !== 104) throw new Error(`STARTUPINFOW layout mismatch: …`);
    # 而我方 `stubs/koffi` 是**哑值模式**（`struct()` 返回 marker，没有真实 `size`）
    # ⇒ `.size === undefined` ⇒ 顶层抛错 ⇒ `dsh-subprocess-local` 导入失败
    # ⇒ **cordis plugin tree 整体加载失败**（不是「某个插件不生效」，是**全部**）。
    #
    # ## 为什么会漏（P-1：同一件事有两处实现，其中一处漏改）
    # 该 stub 早已存在且 `apply-platform-patches.py:210`（python 路径）**有**这一步：
    #     ("dsh-win32-process/index.js", "@deepseek-ai/dsh-win32-process/lib/index.js"),
    # 而 `build-dsht.ps1`（**我们完整安装时实际走的那条**）**从来没有**这一步。
    # ⇒ 走 python 路径时正常、走 ps1 路径时插件树全崩，且**两边都自认为自洽**。
    # 这正是两条构建路径必须保持补丁集等价（`audit-build-path-parity.py` 在守）的原因，
    # 而那支审计只比 marker 集合，**不比对"stub 落盘清单"**（本次即漏在这个缝里）。
    # ## 顺带：为什么以前不炸
    # 0.1.2 世代该包在非 win32 平台**不会被安装**（平台过滤），ps1 路径下 `pnpm install`
    # 根本不会装它；而 0.1.5 起它变成**普通依赖**（`dependencies.koffi`，无平台限制）
    # ⇒ 装上了、且真的会在顶层跑 ABI 断言 ⇒ 漏拷 stub 的后果从「无」变成「全崩」。
    # ⇒ 处置：与 python 路径**逐字同款**落盘（守 P-1：同一事实只许一处实现；此处补齐另一侧）。
    # 幂等：`Copy-Item -Force` 本身幂等；目标目录不存在时出声（不静默）。
    $w32StubDir = "$runtimeDst\node_modules\@deepseek-ai\dsh-win32-process"
    if (Test-Path $w32StubDir) {
        Copy-Item "$stubs\dsh-win32-process\index.js" "$w32StubDir\lib\index.js" -Force
        Write-Host "  dsh-win32-process stub 已应用（防 0.1.5 的 koffi ABI 断言炸掉整棵插件树）"
    } else {
        Write-Host "  ⓘ dsh-win32-process 不在 runtime 里（本代无需 stub；若后续出现导入失败请回看此处注释）" -ForegroundColor DarkGray
    }
    Write-Host "  平台包已删，stubs 六件套已应用"

    # 3d. PC 验证前置补丁：storage-json 的 fsyncDirectory 在 Windows 真实 FS 上报 EPERM
    #（android-sim 伪装 linux 走 POSIX 目录 fsync 路径，Windows 目录句柄 fsync 不允许）。
    # 真机 Android 不受影响（无 DSHT_ANDROID_SIM 环境变量；android-sim.cjs 只在 PC 设置它）。
    $storageJson = "$runtimeDst\node_modules\@deepseek-ai\dsh-storage-json\lib\index.js"
    if (Test-Path $storageJson) {
        $sj = [IO.File]::ReadAllText($storageJson)
        if ($sj -notmatch 'DSHT_ANDROID_SIM') {
            $sjOrig = $sj
            $sj = $sj.Replace('if (process.platform === "win32") return;', 'if (process.platform === "win32" || process.env.DSHT_ANDROID_SIM === "1") return; /* DSHT-SIM: Windows 真实 FS 上目录 fsync 报 EPERM，sim 态跳过 */')
            if ($sj -eq $sjOrig) { Write-Host "  ⚠️ storage-json sim 补丁未命中目标（DSH 升级后产物形态变了？）" -ForegroundColor Yellow }
            else { [IO.File]::WriteAllText($storageJson, $sj); Write-Host "  storage-json sim 补丁已应用（PC 验证用）" }
        } else { Write-Host "  storage-json sim 补丁已存在，跳过" }
    }
    # 3d-2. 同款 sim 补丁：session-persistence-jsonl 的 syncDirPosix（T2.6 开场白物化
    # 落盘时踩到：sim 态走 materializePosix，目录 fsync 在 Windows 真实 FS 上 EPERM，
    # 写盘链静默卡死——session 永不落盘）。幂等：已含补丁标记则跳过。
    $sesPersist = "$runtimeDst\node_modules\@deepseek-ai\dsh-session-persistence-jsonl\lib\index.js"
    if (Test-Path $sesPersist) {
        $sp2 = [IO.File]::ReadAllText($sesPersist)
        if ($sp2 -notmatch 'DSHT_ANDROID_SIM') {
            $marker = 'async syncDirPosix(dir) {'
            $inject = $marker + "`n`t`tif (process.env.DSHT_ANDROID_SIM === `"1`") return; /* DSHT-SIM: Windows 真实 FS 上目录 fsync 报 EPERM，sim 态跳过 */"
            $sp2New = $sp2.Replace($marker, $inject)
            if ($sp2New -eq $sp2) { Write-Host "  ⚠️ session-persistence syncDirPosix sim 补丁未命中目标（DSH 升级后产物形态变了？）" -ForegroundColor Yellow }
            else { [IO.File]::WriteAllText($sesPersist, $sp2New); Write-Host "  session-persistence syncDirPosix sim 补丁已应用（PC 验证用）" }
        } else { Write-Host "  session-persistence sim 补丁已存在，跳过" }
    }

    # 3d-3. 同款 sim 补丁：credentials-local 的 assertOwnerOnly（0.1.2 新增安全检查）——
    # win32 有豁免（L102），但 android-sim 伪装 linux 走 POSIX 检查，而 Windows stat mode
    # 恒 666（libuv 不实现 POSIX 位）→ 验证实例必炸。真机 Android 不受影响：官方写
    # .credentials.yaml 显式 mode 0600（writeFileAtomic mode:384），检查通过。
    $credLocal = "$runtimeDst\node_modules\@deepseek-ai\dsh-credentials-local\lib\index.js"
    if (Test-Path $credLocal) {
        $cl = [IO.File]::ReadAllText($credLocal)
        if ($cl -notmatch 'DSHT_ANDROID_SIM') {
            $clOrig = $cl
            $cl = $cl.Replace('if (process.platform === "win32") return;', 'if (process.platform === "win32" || process.env.DSHT_ANDROID_SIM === "1") return; /* DSHT-SIM: Windows stat mode 恒 666，sim 态跳过 owner-only 检查 */')
            if ($cl -eq $clOrig) { Write-Host "  ⚠️ credentials-local sim 补丁未命中目标（DSH 升级后产物形态变了？）" -ForegroundColor Yellow }
            else { [IO.File]::WriteAllText($credLocal, $cl); Write-Host "  credentials-local sim 补丁已应用（PC 验证用）" }
        } else { Write-Host "  credentials-local sim 补丁已存在，跳过" }
    }

    Step 4 'PC 安卓条件验证（android-sim：platform=linux + stubs = 安卓 JS 路径；3090 端口——3080 可能被用户 SillyTavern 占用，绝不碰）'
    Get-NetTCPConnection -LocalPort 3090 -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    $vh = "$runtimeDst\verify-home"; New-Item -ItemType Directory -Force -Path $vh | Out-Null
    # PS5.1：Start-Process 无 -Environment 参数——经进程环境变量继承（本 shell 会话级，脚本结束不影响用户环境）
    $env:HOME = $vh; $env:DSH_HOME = "$vh\.dsh"
    $p = Start-Process -FilePath node -ArgumentList "--expose-internals", "-r", "..\scripts\android-sim.cjs", "node_modules\@deepseek-ai\dsh\lib\bin.js", "web", "--no-open", "--port", "3090" `
        -WorkingDirectory $runtimeDst -RedirectStandardError "$env:TEMP\dsht-verify.err.log" `
        -RedirectStandardOutput "$env:TEMP\dsht-verify.out.log" -PassThru -NoNewWindow
    Remove-Item Env:\HOME -ErrorAction SilentlyContinue; Remove-Item Env:\DSH_HOME -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 25
    # 0.1.2 起 web UI 带 token 鉴权（启动 URL 含 ?token=...）——根请求返回非 2xx，
    # HTTP 探测会误判"端口未开"（踩过）。改 TCP 探测：端口可连即视为启动成功。
    $portOpen = $false
    try { $tcp = New-Object Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 3090); $portOpen = $tcp.Connected; $tcp.Close() } catch {}
    $errLog = Get-Content "$env:TEMP\dsht-verify.err.log" -Raw -ErrorAction SilentlyContinue
    $outLog = Get-Content "$env:TEMP\dsht-verify.out.log" -Raw -ErrorAction SilentlyContinue
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    if ($portOpen -or ($outLog -match 'dsh web: http')) {
        Write-Host "  ✅ web 已监听 3090（0.1.2 token 模式；TCP 探测=$portOpen）——完全通过" -ForegroundColor Green
    } elseif ($errLog -match 'Cannot find module') {
        $missing = ([regex]::Matches($errLog, "Cannot find module '([^']+)'") | ForEach-Object { $_.Groups[1].Value }) -join ', '
        throw "❌ stub 缺口（Cannot find module）：$missing —— 回步骤 3 补 stub"
    } elseif ($errLog -match 'sandbox-windows-acl|not available in the DSHTavern') {
        Write-Host "  ⚠️ 模块级通过（端口未开）：PC/win32 加载 win32 专属插件（sandbox-windows-acl，koffi 已 stub）导致退出" -ForegroundColor Yellow
        Write-Host "     这是 PC 平台限制而非 stub 缺口（Android/linux 不加载该插件）。完整运行时验证在模拟器/真机做" -ForegroundColor Yellow
    } else {
        Write-Host "  ⚠️ 未开放端口且无已知模式——输出尾部：" -ForegroundColor Yellow
        Write-Host (($errLog -split "`n") | Select-Object -Last 10)
        Write-Host "  人工判断后继续（按回车）/ 中止（Ctrl+C）"; Read-Host
    }
}
# SkipInstall：Step 2/3/4 跳过（runtimeDst 已有依赖+stubs+验证），直接进 Step 4.5
if ($SkipInstall) {
    Write-Host "  SkipInstall：Step 2/3/4 跳过（用现有 runtime）"
}

# ---------------------------------------------------------------------------
Step 3.5 'Android shell/sandbox/rg 补丁（真机实测 4 缺陷；SkipInstall 也要跑，幂等）'
# 真机报告（Xiaomi Mi 11 无 root）：① dsh-bash-local/dsh-bash-sandbox 硬编码 argv ["bash","-c",...]，
#   Android 无 bash（只有 /system/bin/sh，mksh POSIX 兼容）→ spawn EACCES；
# ② dsh-sandbox-local 依赖 bwrap/Landlock，Android 都没有 → confine() 拒绝执行；
# ③ dsh-tool-fs-search 的 glob/grep 依赖 rg 二进制 → "ripgrep launch failed"；
# ④ dsh-terminal-bash 的 DEFAULT_BASH_SHELL=/bin/bash、--noprofile/--norc 不适配 mksh。
# 全部改为 process.platform === 'android' 平台感知降级，其他平台行为不变；
# 替换前断言目标串存在（计数不符即 throw，防官方更新后补丁失效无感知）。
# 注意：$runtimeDst 只有一个（dsh-runtime-android）；dsh-runtime-x64 仅是 x64 的 lib/*.so 存放处，
# Step 5.5 按 -Arch 换 lib，两个架构 APK 共用同一份 node_modules —— 补丁打这里即双架构生效。
function Dsht-Patch([string]$Path, [string]$Marker, [string]$RegexPattern, [string]$Replacement, [int]$Expected, [string]$Label, [string]$Already = '') {
    if (-not (Test-Path $Path)) { throw "补丁目标不存在：$Path（$Label）" }
    $text = [IO.File]::ReadAllText($Path)
    $markerHits = [regex]::Matches($text, [regex]::Escape($Marker)).Count
    if ($markerHits -ge $Expected) { Write-Host "  ${Label}：已打补丁，跳过"; return }
    if ($markerHits -gt 0) { throw "${Label}：补丁处于半打状态（标记 $markerHits/$Expected 处），请检查 $Path" }
    # 【2026-09-16 W25 · P-41】幂等判据的**第二形态**：`$Already`（补丁已生效的产物形态）。
    #
    # ## 为什么不能只靠 marker 计数（本轮 `-SkipInstall` 实测踩到）
    # 有的调用点的替换文本**没有把 marker 写进去**（P2-1b `DSHT-CHAT-FOLD-SEAT` 就是）：
    #   · 第一次跑（产物是官方原版）⇒ 锚点匹配 ⇒ 替换成功，但产物里**没有 marker**
    #   · 第二次跑（产物已被替换）⇒ markerHits=0 ⇒ 不跳过 ⇒ 去匹配锚点 ⇒ **锚点已不存在**
    #     ⇒ hits=0 ≠ Expected ⇒ **throw「补丁未命中目标」**（看起来像「官方改了产物形态」，实为幂等失效）
    #   · **完整构建时被掩盖**（Step 3 重建 runtime ⇒ 产物回到官方原版）
    #   · **`-SkipInstall` 时暴露**（该模式正是「runtime 已就绪，只跑后半段」）
    #   · ⇒ 这正是本轮文档提到的「漏在缝里的差异」在**补丁层**的同类形态。
    #
    # ## 修法（P-41：判据从「代理量」改锚到「事实」）
    # marker 是**代理量**（它只在「有人记得写」时才存在）；**真正的事实**是
    # 「产物里已经是打过补丁的形态」。⇒ 额外接受一个正则 `$Already`：
    # 若它匹配 ≥ Expected 次 ⇒ 视为已打补丁（跳过）。两条判据取或。
    # 已在下面 P2-1b 处传入旧形态的 `$Already`（兼容「上一轮用旧脚本打过的 runtime」）。
    if ($Already -ne '') {
        $alreadyHits = [regex]::Matches($text, $Already).Count
        if ($alreadyHits -ge $Expected) { Write-Host "  ${Label}：已打补丁（形态匹配），跳过"; return }
        if ($alreadyHits -gt 0) { throw "${Label}：补丁处于半打状态（形态 $alreadyHits/$Expected 处），请检查 $Path" }
    }
    $hits = [regex]::Matches($text, $RegexPattern).Count
    if ($hits -ne $Expected) { throw "${Label}：补丁未命中目标（期望 $Expected 处，实际 $hits 处）：$Path —— DSH 升级后产物形态变了？" }
    $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $Replacement }
    $text = [regex]::Replace($text, $RegexPattern, $evaluator)
    [IO.File]::WriteAllText($Path, $text)
    Write-Host "  ${Label}：$Expected 处已打补丁"
}
$nmDst = "$runtimeDst\node_modules\@deepseek-ai"
$shExpr = 'process.platform === "android" ? "/system/bin/sh" : "bash"'

# P0-1a. dsh-bash-local run()/start() 的 bash argv（2 处，同构一起换）
Dsht-Patch "$nmDst\dsh-bash-local\lib\index.js" 'DSHT-ANDROID-SH' `
    '\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tspec\.command' `
    ("`t`t`t" + $shExpr + ', /* DSHT-ANDROID-SH */' + "`n`t`t`t`"-c`",`n`t`t`tspec.command") `
    2 'P0-1a bash-local run/start argv'

# P0-1b. dsh-bash-sandbox confine() 的内层 bash argv
Dsht-Patch "$nmDst\dsh-bash-sandbox\lib\index.js" 'DSHT-ANDROID-SH' `
    '\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tcommand\r?\n\t\t\], policy\);' `
    ("`t`t`t" + $shExpr + ', /* DSHT-ANDROID-SH */' + "`n`t`t`t`"-c`",`n`t`t`tcommand`n`t`t], policy);") `
    1 'P0-1b bash-sandbox confine argv'

# P0-2. dsh-sandbox-local confine() 拒绝分支 → android 降级：warn + 原 argv 直通（无进程隔离，fs 层做工作区边界）
Dsht-Patch "$nmDst\dsh-sandbox-local\lib\index.js" 'DSHT-ANDROID-UNSANDBOXED' `
    '\tconst selected = this\.selectRunner\(policy\.mode\);' `
    ("`tlet selected;`n" +
     "`ttry {`n" +
     "`t`tselected = this.selectRunner(policy.mode);`n" +
     "`t} catch (error) {`n" +
     "`t`t/* DSHT-ANDROID-UNSANDBOXED: android 无 bwrap/Landlock/sandbox-exec/ACL 后端——降级语义：不拒绝，warn + 无隔离执行（fs 层做工作区边界） */`n" +
     "`t`tif (process.platform === `"android`" && error !== null && typeof error === `"object`" && error.name === `"SandboxUnavailableError`") {`n" +
     "`t`t`tconsole.warn(`"[dsht] sandbox-local: no sandbox backend on android; running unconfined (fs layer enforces the workspace boundary)`");`n" +
     "`t`t`treturn { argv: [...argv], enforcement: `"unusable`", denialSignatures: [], runnerFailureRules: [] };`n" +
     "`t`t}`n" +
     "`t`tthrow error;`n" +
     "`t}") `
    1 'P0-2 sandbox-local android 降级'

# P0-2b. PRoot 真隔离：把 P0-2 降级分支内的 warn+直通 改为「proot 包装优先，失败才回退直通」。【顺序约束：必须在 P0-2 之后——它改写的是 P0-2 的产物文本】
# 形态：proot --kill-on-exit -r <rootfs> -b /proc -b /dev -b linker64/apex/system-lib64
#       -b $DSH_HOME -b <policy.workspaceRoot> -b nativeLibDir -b runtimeLib -b $TMPDIR(+:/tmp) <原 argv>
# —— 工作区外不可读写（真隔离，不再是 warn）。proot 缺失/probe 失败 → 回退原 warn+fs 边界（降级开关保留）。
# 依赖资产（双架构，均由本仓库 downloads\proot\ 提供，构建期落位）：
#   jniLibs/<abi>/libproot.so   = termux proot 5.1.107.92 (bin/proot)
#   jniLibs/<abi>/libbusybox.so = termux busybox 1.38.0-1 (bin/busybox 启动器)
#   runtime lib/                = libbusybox.so.1.38.0 + libtalloc.so.2(2.4.3) + libandroid-shmem.so(0.7)
#                                 + libandroid-selinux.so(14.0.0.11-1) + libpcre2-8.so(10.47) + proot-loader{,32}
#   来源 https://packages.termux.dev/apt/termux-main/ （索引 Packages-{aarch64,x86_64} 已存 downloads\proot\）
#   sha256（deb 级，Get-FileHash 已全量校验）：
#     proot_5.1.107.92_aarch64.deb    1f1c983509701f6826f568482c70673ee453a9ba38c9f5fa445a472d6b7524e9
#     proot_5.1.107.92_x86_64.deb     70236632826c30ec0245082b633bbc7ef1e9fa5531bd51bd4f20231bfcdc999b
#     busybox_1.38.0-1_aarch64.deb    1bb7f1d4c00cadd0e1117b6dd7110311b8bf749ef00b486e96cfdc11c98f8fd9
#     busybox_1.38.0-1_x86_64.deb     519b57623dd076b4d6cf6d389ed976dd222410e3a0b9b9b58c14d8535b6eef48
#     libtalloc_2.4.3_aarch64.deb     ac81ad623d74c209718b9f3acb2dd702cc8a88c431e820d212229910b4db29da
#     libtalloc_2.4.3_x86_64.deb      7ca2eaae2e53b28228a01301bc410b62845403d6317c25b8e0a7f40681de0628
#     libandroid-shmem_0.7_aarch64.deb  0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6
#     libandroid-shmem_0.7_x86_64.deb   ffa9e4c87467b158b148d0ff92dda796aa038276c2075af3269cdcdb06f25797
#     libandroid-selinux_14.0.0.11-1_aarch64.deb 00afd8c34087c2864737b51fd9d104dc5e955f6ec3c0f50c0c7ef5b4a56866b9
#     libandroid-selinux_14.0.0.11-1_x86_64.deb  99cf96556683ddb53f7d645ca1720e10523c4796ce5b41c583da9f89a47679ce
#     pcre2_10.47_aarch64.deb         51f915d22de639bfca6ec029ae613987bbe3bc73626eede13319fd2e95f50b63
#     pcre2_10.47_x86_64.deb          8e4fb14ba014f9b2d5e07b6ed9c519b31d00a6e7ddeb5804c3b076a6c841c2fb
$prootWrap = @"
			/* DSHT-ANDROID-PROOT: PRoot 真隔离——proot 用户态 chroot 包装 argv（rootfs+bind 外不可读写）；
			   proot 二进制缺失/探测失败时回退下方 warn + fs 边界直通（降级开关） */
			const dshtProotBin = process.env.DSHT_PROOT_BIN;
			const dshtProotRootfs = process.env.DSHT_PROOT_ROOTFS;
			if (dshtProotBin && dshtProotRootfs && existsSync(dshtProotBin) && existsSync(join(dshtProotRootfs, "bin/busybox"))) {
				const dshtStaticBinds = [];
                                for (const p of ["/proc", "/dev", "/system/bin/linker64", "/apex/com.android.runtime", "/system/lib64", "/sdcard", "/storage/emulated", process.env.DSHT_NATIVE_LIB_DIR, process.env.DSHT_RUNTIME_LIB_DIR, process.env.TMPDIR])
                                        if (p && existsSync(p) && !dshtStaticBinds.includes(p)) dshtStaticBinds.push(p);
				if (globalThis.__dshtProotOk === void 0) {
					const dshtProbe = spawnSync(dshtProotBin, ["--kill-on-exit", "-r", dshtProotRootfs, ...dshtStaticBinds.flatMap((b) => ["-b", b]), "/bin/true"], { timeout: 10000 });
					globalThis.__dshtProotOk = dshtProbe.status === 0;
					if (!globalThis.__dshtProotOk) console.warn("[dsht] proot probe failed (status=" + dshtProbe.status + (dshtProbe.stderr ? ", " + String(dshtProbe.stderr).slice(0, 200) : "") + "); falling back to unconfined sh + fs boundary");
				}
				if (globalThis.__dshtProotOk) {
					const dshtArgv = [dshtProotBin, "--kill-on-exit", "-r", dshtProotRootfs];
					for (const b of dshtStaticBinds) dshtArgv.push("-b", b);
					const dshtDynBinds = [];
					for (const b of [process.env.DSH_HOME || join(process.env.HOME || "/", ".dsh"), policy && policy.workspaceRoot])
						if (b && existsSync(b) && !dshtStaticBinds.includes(b) && !dshtDynBinds.includes(b)) dshtDynBinds.push(b);
					for (const b of dshtDynBinds) dshtArgv.push("-b", b);
					if (process.env.TMPDIR) dshtArgv.push("-b", process.env.TMPDIR + ":/tmp");
					dshtArgv.push(...argv);
					return { argv: dshtArgv, enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
				}
			}
			console.warn("[dsht] sandbox-local: no sandbox backend on android; running unconfined (fs layer enforces the workspace boundary)");
			return { argv: [...argv], enforcement: "unusable", denialSignatures: [], runnerFailureRules: [] };
"@
Dsht-Patch "$nmDst\dsh-sandbox-local\lib\index.js" 'DSHT-ANDROID-PROOT' `
    '\t\t\tconsole\.warn\("\[dsht\] sandbox-local: no sandbox backend on android; running unconfined \(fs layer enforces the workspace boundary\)"\);\r?\n\t\t\treturn \{ argv: \[\.\.\.argv\], enforcement: "unusable", denialSignatures: \[\], runnerFailureRules: \[\] \};' `
    $prootWrap `
    1 'P0-2b sandbox-local proot 真隔离包装'

# P1-3. dsh-tool-fs-search：rg 二进制不可用 → android 走纯 JS 降级（stubs 资产 + runRipgrep 短路）
Copy-Item "$stubs\dsh-tool-fs-search\android-fallback.mjs" "$nmDst\dsh-tool-fs-search\lib\android-fallback.mjs" -Force
Dsht-Patch "$nmDst\dsh-tool-fs-search\lib\index.js" 'android-fallback.mjs' `
    'import \{ existsSync \} from "node:fs";' `
    ("import { existsSync } from `"node:fs`";`nimport { dshtAndroidJsSearch } from `"./android-fallback.mjs`";") `
    1 'P1-3a fs-search 降级模块导入'
Dsht-Patch "$nmDst\dsh-tool-fs-search\lib\index.js" 'DSHT-ANDROID-JS-SEARCH' `
    'async function runRipgrep\(ctx, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes\) \{\r?\n\tif \(exec\.signal\.aborted\)' `
    ("async function runRipgrep(ctx, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes) {`n" +
     "`t/* DSHT-ANDROID-JS-SEARCH: android 且真 rg 缺席（DSHT_RUNTIME_BIN_DIR 未设或无文件）时 glob/grep 走纯 JS 降级（lib/android-fallback.mjs）；P1 能力包内置 rg 后走官方路径 */`n" +
     "`tif (process.platform === `"android`" && !(process.env.DSHT_RUNTIME_BIN_DIR && existsSync(process.env.DSHT_RUNTIME_BIN_DIR + `"/rg`"))) return dshtAndroidJsSearch(exec, toolName, argv);`n" +
     "`tif (exec.signal.aborted)") `
    1 'P1-3b runRipgrep android 短路'

# P1-4. dsh-terminal-bash：默认 shell / 启动参数适配——P1 能力包内置 bash 后用真 bash
# （DSHT_RUNTIME_BIN_DIR/bash → nativeLibraryDir 伪装 .so；缺席回退 /system/bin/sh + mksh 参数）
Dsht-Patch "$nmDst\dsh-terminal-bash\lib\index.js" 'DSHT-ANDROID-TERM-SHELL' `
    'const DEFAULT_BASH_SHELL = "/bin/bash";' `
    'const DEFAULT_BASH_SHELL = process.platform === "android" ? (process.env.DSHT_RUNTIME_BIN_DIR ? process.env.DSHT_RUNTIME_BIN_DIR + "/bash" : "/system/bin/sh") : "/bin/bash"; /* DSHT-ANDROID-TERM-SHELL */' `
    1 'P1-4a terminal-bash DEFAULT_BASH_SHELL'
Dsht-Patch "$nmDst\dsh-terminal-bash\lib\index.js" 'DSHT-ANDROID-TERM-ARGS' `
    'const DEFAULT_BASH_ARGS = \[\r?\n\t"--noprofile",\r?\n\t"--norc",\r?\n\t"-i"\r?\n\];' `
    ('const DEFAULT_BASH_ARGS = (process.platform === "android" && !process.env.DSHT_RUNTIME_BIN_DIR) ? ["-i"] /* DSHT-ANDROID-TERM-ARGS */ : [' + "`n`t`"--noprofile`",`n`t`"--norc`",`n`t`"-i`"`n];") `
    1 'P1-4b terminal-bash DEFAULT_BASH_ARGS'

# ---------------------------------------------------------------------------
# P2. dsh-client-ui-chat：TurnProcessNodeView 折叠行大会话不可见修复（2026-09-08 实机根因）
# 官方条件 processWindowReady 含 `&& !historyIncomplete`，而 historyIncomplete = hasMore
# （会话还有更早历史未加载）。RP 大会话（百余轮）几乎恒 hasMore=true → 所有轮次折叠行
# 永不渲染（「查无此人」）。语义修正：折叠只要求「本轮 process 窗口完整在已加载区间」，
# 不要求整个会话历史加载完。已加载区间连续 [firstSeq(=order[0].anchorSeq), 最新]，
# processStartSeq >= firstSeq 即本轮完整 → 放行折叠。firstSeq 为 null 时维持官方行为。
$chatUi = "$nmDst\dsh-client-ui-chat\lib\client.js"
Dsht-Patch "$chatUi" 'DSHT-CHAT-FOLD-OLDEST' `
    'historyIncomplete: hasMore,' `
    ("historyIncomplete: hasMore,`n" +
     "`t`t`t`t`t`tdshtOldestSeq: firstSeq, /* DSHT-CHAT-FOLD-OLDEST: 最老已加载节点 seq（本轮折叠放行判定） */") `
    1 'P2-1a ChatNodeList 传入 firstSeq'
Dsht-Patch "$chatUi" 'DSHT-CHAT-FOLD-SEAT' `
    'function ChatNodeSeat\(\{ nodeKey, useChatNode, useChatNodeProcess, historyIncomplete, compactTranscript,' `
    'function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, historyIncomplete, dshtOldestSeq /* DSHT-CHAT-FOLD-SEAT */, compactTranscript,' `
    1 'P2-1b ChatNodeSeat 接收 dshtOldestSeq' `
    'historyIncomplete, dshtOldestSeq,'
Dsht-Patch "$chatUi" 'DSHT-CHAT-FOLD-READY' `
    'processPresentation\.turn === processSpec\.turn && processPresentation\.turnClosed && !historyIncomplete;' `
    ('processPresentation.turn === processSpec.turn && processPresentation.turnClosed && (!historyIncomplete || (typeof dshtOldestSeq === "number" && processSpec.processStartSeq >= dshtOldestSeq)); /* DSHT-CHAT-FOLD-READY: 本轮窗口完整在已加载区间即可折叠，不要求全会话历史加载完 */') `
    1 'P2-1c processWindowReady 放宽'

# P3-5a. dsh-session-title：标题剥 HTML/协议标签（2026-09-09 实机截图：会话标题显示「<status> [...]」）
# 官方 normalize（cleanTitleText）只清控制字符/转义序列——RP 场景首条消息/LLM 生成的标题
# 常含 <interactive_input>/<status> 等协议标签，标题栏裸显标签名。补丁在 cleanTitleText
# 开头剥成对标签与未闭合标签尾，其余行为不变。
Dsht-Patch "$nmDst\dsh-session-title\lib\index.js" 'DSHT-TITLE-DETAG' `
    'function cleanTitleText\(input\) \{\r?\n\treturn input\.replace\(OSC_SEQUENCE' `
    ("`tfunction cleanTitleText(input) {`n" +
     "`t`t/* DSHT-TITLE-DETAG: RP 首条消息/LLM 标题常含 <status> 等协议标签——先剥成对标签与未闭合标签尾再走官方 normalize */`n" +
     "`t`tinput = input.replace(/<[^<>]{0,200}>/gu, `" `" ).replace(/<[^<>]{0,200}`$/u, `" `" );`n" +
     "`t`treturn input.replace(OSC_SEQUENCE") `
    1 'P3-5a session-title 剥协议标签'

# ---------------------------------------------------------------------------
# P1-5. F2 flock 平台适配（0.1.5 会话写锁）——【C6 修复 2026-09-13】
# 背景：0.1.5 的 dsh-session-persistence-jsonl 用 flock(2) 做会话写锁
#   （SessionWriteLease.acquire() → open(session.lock) → tryLockExclusive(fd)），
#   而 node-addon-system/lib/flock.js 的 loadBinding() 在 platform 非 linux/darwin 时
#   直接抛 ERR_FLOCK_UNSUPPORTED_PLATFORM。Android 的 process.platform === 'android'，
#   且 bionic 加载不了 linux-x64 原生模块 ⇒ resume 会话必然失败
#   ⇒ **任何消息都发不出去**（实机报错原文：`flock is not supported on android-x64`）。
#
# ⚠️ 本补丁此前**只存在于 python 路径**（build-wb.sh 调 apply-platform-patches.py Step 4.6），
#   而 build-dsht.ps1 全文无 flock —— 两条构建路径不等价：
#     · -SkipInstall（复用已有 runtime）：补丁已在，侥幸可用；
#     · 完整安装（pnpm install 重建 node_modules）：**补丁丢失** ⇒ 新机器首装即"发不出消息"。
#   本段补齐 ps1 路径，marker 与 python 侧**同串**（DSHT-ANDROID-FLOCK）以保证幂等
#   （两路各自跑、任一先跑，另一路都能识别为"已打"）。
# 处置依据（与 python 侧同）：DSH 自己对 browser worker 已有先例 —— 单进程运行时
#   的写锁立即成功即可。DSHTavern 运行时同为单进程 node。
$flockJs = "$nmDst\node-addon-system\lib\flock.js"
if (Test-Path $flockJs) {
    Dsht-Patch $flockJs 'DSHT-ANDROID-FLOCK' `
        'const \{ platform, arch \} = process;' `
        ("const { platform, arch } = process;`n" +
         "    /* DSHT-ANDROID-FLOCK: Android 无 flock(2)；单进程运行时按 DSH 对 browser worker 的同款处置：立即成功。 */`n" +
         "    if (platform === 'android') {`n" +
         "        binding = { tryLock: (fd, cb) => { queueMicrotask(() => cb(0)); } };`n" +
         "        return binding;`n" +
         "    }") `
        1 'F2 Android flock 单进程直通'
} else {
    Write-Host "  ✗ F2 flock：$flockJs 不存在（node-addon-system 包缺失？）" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 3.6 官方契约事前探针（E3/P-4）——【2026-09-16 W24c · P-40③ 新增】
#
# ## 为什么在这里（而不是 Step 0.6）
# 本探针读的是 `$runtimeDst\node_modules\@deepseek-ai`。而 Step 1/Step 3 会**整体替换**
# `$runtimeDst`（`:216 Remove-Item -Recurse -Force` + `:218 Copy-Item`）。
# 原实现把它放在 Step 0.6（替换**之前**）⇒ **探的是磁盘上残留的上一代产物**，
# 而不是本次将要打包的那一代。实测后果（本轮真实踩到）：
#   · 同一天两次构建，**同一份源码**，只因磁盘残留代次不同而结论相反——
#     arm64 那次读到残留的 0.1.5 ⇒ 通过；x86_64 那次读到已是 0.1.2 ⇒ BLOCK。
#   · 更糟的方向：arm64 那次**在「通过」之后**把 runtime 换成了 0.1.2 世代，
#     而 0.1.2 的 `dsh-session.isReplaceOp` 要求 `start/end`，与设备上 1747 处真实数据
#     （`startSeq/endSeq`）不兼容 ⇒ **装出去会让历史会话全部打不开**。
#     ⇒ 只有把它移到替换**之后**，探针才真正具备「事前」语义。
#
# ## 与 Step 0.6 的关系
# Step 0.6 保留 `--selftest`（闸门自身可信性，任何情况都要过）+ **仅 SkipInstall 时**
# 做实际探测（那时 `$runtimeDst` 就是本次产物，无时序问题）。非 SkipInstall 时本步骤接手。
#
# ## 判据分级
#   · BLOCK 级破坏（无降级路径）⇒ **构建中止**（带着它打包 = 出厂的包必然坏）；
#   · WARN / UNKNOWN ⇒ 出声不阻塞。退出码 0=无 BLOCK；2=有 BLOCK；1=锚点缺失。
# ---------------------------------------------------------------------------
Step 3.6 '官方契约事前探针（E3/P-4；**在 runtime 替换之后**探测本次真产物，P-40③）'
if (-not $SkipInstall) {
$ocRoot36 = Join-Path $runtimeDst 'node_modules\@deepseek-ai'
if (Test-Path $ocRoot36) {
    & node $ocProbe | Out-Null
    $ocCode36 = $LASTEXITCODE
    if ($ocCode36 -eq 2) { throw "官方契约 BLOCK 级破坏（无降级路径）——详见 node scripts/audit-official-contract.mjs" }
    if ($ocCode36 -ne 0) { throw "官方契约探针异常退出（code=$ocCode36；1=锚点缺失，属配置问题）" }
    Write-Host "  [gate] OK audit-official-contract.mjs（本次产物无 BLOCK 级破坏）"
} else {
    Write-Host "  [gate] ⚠️ runtime 未就绪（$ocRoot36 不存在）——契约探针本次**未执行**（已出声，不静默）" -ForegroundColor Yellow
}
} else {
    Write-Host "  [gate] SkipInstall：已在 Step 0.6 探测（该模式下 runtimeDst 即本次产物）"
}

# ---------------------------------------------------------------------------
# P0-5 Iterator Helpers 兼容补丁（2026-09-14 真机截图驱动）
#   现象：App 起来后整页只有
#     Failed to load plugins
#     failed to import loader entry 91803695 (@deepseek-ai/dsh-client-ui-sidebar-documentpreview):
#     Iterator is not defined
#   ⇒ loader entry 抛错 = **整个 web UI 加载失败**，App 完全不可用。
#   根因（已复现证实）：该包 lib/client.js 内嵌 PDF.js 的 Iterator Helpers polyfill，守卫写法为
#     if (typeof Iterator.prototype.join !== "function") …
#   `typeof X.y` 只对「X 已声明但值 undefined」安全；对**从未声明的全局标识符**会抛
#   ReferenceError（ECMA-262 13.5.3：MemberExpression 先对该 IdentifierReference 求值）。
#   复现实验（node：delete globalThis.Iterator 后逐字 eval 该表达式）→
#     ReferenceError: Iterator is not defined  ← 与真机报错逐字一致
#   Iterator Helpers 是 ES2025（Chrome 122+）特性；本项目 Android WebView 低于此 ⇒ 未声明。
#   全仓 241 个官方包中**仅此一个**使用裸 Iterator 全局（已扫描 typeof (X). 形态确认）。
#   处置：改为「先判 Iterator 是否存在」——语义等价（不存在时无法给 prototype 挂方法，
#   跳过 polyfill 是唯一可行分支）。不改业务逻辑、不改 PDF.js 其它代码。
#   ⚠️ marker 与 python 侧**同串**（DSHT-ANDROID-ITERATOR），保证两路幂等互认。
$iteratorJs = "$nmDst\dsh-client-ui-sidebar-documentpreview\lib\client.js"
if (Test-Path $iteratorJs) {
    Dsht-Patch $iteratorJs 'DSHT-ANDROID-ITERATOR' `
        'if \(typeof Iterator\.prototype\.join !== "function"\)' `
        ('/* DSHT-ANDROID-ITERATOR: 旧 WebView 无 ES2025 Iterator Helpers；' +
         'typeof Iterator.prototype 对未声明全局会抛 ReferenceError（整页 Failed to load plugins）' +
         '——先判存在性，语义等价（Iterator 不存在时无法挂 prototype）。 */' + "`n" +
         "`t`tif (typeof Iterator === `"undefined`") { /* 跳过 polyfill */ }`n" +
         "`t`telse if (typeof Iterator.prototype.join !== `"function`")") `
        1 'P0-5 Iterator Helpers 守卫（旧 WebView 整页加载失败）'
} else {
    Write-Host "  · P0-5 Iterator：$iteratorJs 不在（该 DSH 版本无此包）——跳过" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
Step 4.5 'composition 补丁：session 持久化改明文（迁移写入前置条件）'
# WebView 无 zstd 编码器，迁移管线只能写明文 session.jsonl；官方支持 compression:'none' 配置
# （dsh-session-persistence-jsonl 读写都按该配置的文件名后缀走）。幂等：已打补丁则跳过。
$basePatch = "$runtimeDst\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml"
if (Test-Path $basePatch) {
    $bp = Get-Content $basePatch -Raw
    if ($bp -notmatch "compression:\s*'none'") {
        $bp = $bp -replace "root: !!js dshHomePath\('sessions'\)", "root: !!js dshHomePath('sessions')`n        compression: 'none'"
        Set-Content -Path $basePatch -Value $bp -NoNewline -Encoding UTF8
        Write-Host "  dsh-base cordis.patch.yml：session-persistence → compression:'none' 已打补丁"
    } else { Write-Host "  composition 补丁已存在，跳过" }
} else { Write-Host "  ⚠️ 未找到 dsh-base\cordis.patch.yml（检查 runtime 结构）" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
Step 4.7 'dsht-rp-plugin 打包进 runtime node_modules（RP 世界书触发插件）'
# Cordis 插件自包含 bundle（trigger.ts 内联、零 @deepseek-ai 运行时依赖）；
# profile patch 由 NodeService 启动时幂等写入（insert dsht-rp-plugin 行）
$pluginDir = "$runtimeDst\node_modules\dsht-rp-plugin"
New-Item -ItemType Directory -Force -Path "$pluginDir\lib" | Out-Null
[IO.File]::WriteAllText("$pluginDir\package.json", '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js"}')
Push-Location "$ws\packages"
# PS5.1 坑：EAP=Stop 下原生命令（npx/gradle）stderr 经 2>&1 会被误判为终止错误——临时降级
$ErrorActionPreference = 'Continue'
& npx esbuild src/dsh-plugin/index.ts --bundle --format=esm --platform=node --outfile="$pluginDir\lib\index.js" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dsht-rp-plugin esbuild 失败" }
Pop-Location
# T2.11：嵌入导入中心资产（HTML + 引擎 bundle）——插件 GET 路由 /dsht-rp/import-center 服务。
# R0：整棵 assets 树复制（import-center.html + skills/st-migration + agent-presets/dsht-adapter，
# 后者由插件首启幂等同步到 $DSH_HOME/skills 与 .agent-presets）。
# app.js 引擎在 Step 5 由 esbuild 直出（browser-entry bundle）
Remove-Item "$pluginDir\assets" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$ws\packages\src\dsh-plugin\assets" "$pluginDir\assets" -Recurse -Force
# 【T-88】bundle 层文件随包分发（`dsh plugin add` 靠它把本包补进 dsh.profile.bundles）——
# 与 rebuild-plugins.ps1 同一来源（src/dsh-plugin/cordis.patch.yml）
Copy-Item "$ws\packages\src\dsh-plugin\cordis.patch.yml" "$pluginDir\cordis.patch.yml" -Force
$pluginKB = [math]::Round((Get-Item "$pluginDir\lib\index.js").Length / 1KB, 1)
Write-Host "  dsht-rp-plugin：$pluginKB KB 已就位（node_modules/dsht-rp-plugin）"

# ---------------------------------------------------------------------------
Step 4.72 'R10 三大插件打包进 runtime node_modules（MVU / 酒馆助手 / 提示词模板）'
# 与 dsht-rp-plugin 同款形态：Cordis 插件自包含 bundle（named exports name/inject/apply，
# 共享代码经 dsht-plugin-shared 内联，零 @deepseek-ai 运行时依赖）；
# profile patch 由 NodeService 启动时幂等写入（insert 行按包名逐个补齐）。
$r10Plugins = @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory')
# 【T-88】各包 id（cordis patch 行用）——与 rebuild-plugins.ps1 的 $r10Ids 同源同值（两侧漂移 = PC 可装性破裂）
$r10Ids = @{
    'dsht-plugin-mvu' = 'dsht-mvu'
    'dsht-plugin-tavern-helper' = 'dsht-tavern-helper'
    'dsht-plugin-prompt-template' = 'dsht-prompt-template'
    'dsht-plugin-memory' = 'dsht-memory'
}
Push-Location "$ws\packages"
foreach ($r10 in $r10Plugins) {
    $r10Dir = "$runtimeDst\node_modules\$r10"
    New-Item -ItemType Directory -Force -Path "$r10Dir\lib" | Out-Null
    # 【T-88】dsh.bundle.patch 声明 + 各自 insert 行（PC 端 `dsh plugin add` 自动进 profile 层栈）
    [IO.File]::WriteAllText("$r10Dir\package.json", "{`"name`":`"$r10`",`"version`":`"1.0.0`",`"type`":`"module`",`"main`":`"lib/index.js`",`"dsh`":{`"bundle`":{`"patch`":`"./cordis.patch.yml`"}}}")
    [IO.File]::WriteAllText("$r10Dir\cordis.patch.yml", "- insert:`n    - id: $($r10Ids[$r10])`n      name: '$r10'`n")
    $ErrorActionPreference = 'Continue'
    & npx esbuild "src/$r10/index.ts" --bundle --format=esm --platform=node --outfile="$r10Dir\lib\index.js" 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "$r10 esbuild 失败" }
    $r10KB = [math]::Round((Get-Item "$r10Dir\lib\index.js").Length / 1KB, 1)
    Write-Host "  $r10：$r10KB KB 已就位（node_modules/$r10）"
}
# B15：EJS Worker bundle（compileWorkers 开启时 /render 投给 worker_threads；6s 超时回退同步）
# EAP=Stop 下原生 stderr 重定向会抛 NativeCommandError——与 R10 循环同款先切 Continue
#
# ⚠️ 路径必须与**加载它的那个 index.js 同目录**：workerPath 由源码
#   `join(dirname(fileURLToPath(import.meta.url)), 'ejs-worker.js')` 决定。
# 本脚本走的是**独立包**形态（Step 4.72 把 prompt-template 单独编译到
# `node_modules/dsht-plugin-prompt-template/lib/index.js`）⇒ worker 也落该目录，两者自洽。
# 【T-88】rebuild-plugins.ps1 已对齐到同款独立包形态（worker 同落 prompt-template/lib/）——
# 两条路径的 outfile 自此**一致**（此前 T-87 总包形态下不可互抄的约束已解除）。
$ErrorActionPreference = 'Continue'
& npx esbuild "src/dsht-plugin-prompt-template/worker.ts" --bundle --format=esm --platform=node --outfile="$runtimeDst\node_modules\dsht-plugin-prompt-template\lib\ejs-worker.js" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "ejs-worker esbuild 失败" }
Pop-Location

# §0.6 契约快照采集（升级前 diff 用；失败不阻塞构建）
$ErrorActionPreference = 'Continue'
try { & node "$ws\scripts\capture-contracts.mjs" 2>&1 | Select-Object -Last 3 } catch { Write-Host "  契约快照采集失败（不阻塞）" }
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
Step 4.75 'dsht-rp-ui 构建 + 并入 dsht-rp-plugin（插件合并：一个包装 host+client 双面）'
# 浏览器插件面（dsh.client 声明 + lib/client.js wire 契约 CJS factory）与 node 侧面
# 合进同一个 dsht-rp-plugin 包——插件列表只占一行。
# ClientModuleRegistry 扫 dsh.client → __DSH_BOOT__ → /plugins/dsht-rp-plugin/client.js →
# 浏览器模块表 → cordis Loader 激活 → ctx.slots.register（sidebar 按钮 + RP overlay）。
& node "$ws\scripts\build-rp-ui.mjs"
if ($LASTEXITCODE -ne 0) { throw "dsht-rp-ui esbuild 失败" }
$rpPluginDir = "$runtimeDst\node_modules\dsht-rp-plugin"
Copy-Item "$ws\packages\src\dsht-rp-ui\lib\client.js" "$rpPluginDir\lib\client.js" -Force
# 合并 package.json（覆盖 Step 4.7 的纯 node 形态）：main 仍是 host 入口；client 面经 exports["./client"]
# external (0.1.2 pitfall #15): strict slot declaration checks; the external dependency edges
# force official client modules (sidebar/layout/conversation/settings-plugins) to apply FIRST,
# so our immediate slots.register calls find their slots already declared.
[IO.File]::WriteAllText("$rpPluginDir\package.json", '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings-plugins"]}}}')
# 旧布局清理：runtime 里不再产独立 dsht-rp-ui 包
if (Test-Path "$runtimeDst\node_modules\dsht-rp-ui") { Remove-Item "$runtimeDst\node_modules\dsht-rp-ui" -Recurse -Force }
$rpUiKB = [math]::Round((Get-Item "$rpPluginDir\lib\client.js").Length / 1KB, 1)
Write-Host "  dsht-rp-plugin 合并包：client.js $rpUiKB KB 已并入（node_modules/dsht-rp-plugin）"

# ---------------------------------------------------------------------------
Step 4.77 'dsht-plugin-mobile 构建 + 打包进 runtime node_modules（P2#13 宿主无关移动端适配插件）'
# 与 dsht-rp-ui 同款 wire 契约双面形态：lib/index.js（node 空壳）+ lib/client.js
# （浏览器 CJS factory，banner 模块 id 与包名一致）；dsh.client 声明进 boot graph。
# 移动端竖屏适配（CSS 五件套 + data-* 宿主锚点 + 汉堡抽屉）从 dsht-rp-ui 抽离于此——
# 不依赖 dsht-rp，任意 DSH 部署可独立生效。profile patch 由 NodeService 幂等写入。
& node "$ws\scripts\build-mobile.mjs"
if ($LASTEXITCODE -ne 0) { throw "dsht-plugin-mobile esbuild 失败" }
$mobileDir = "$runtimeDst\node_modules\dsht-plugin-mobile"
New-Item -ItemType Directory -Force -Path "$mobileDir\lib" | Out-Null
Copy-Item "$ws\packages\src\dsht-plugin-mobile\lib\index.js" "$mobileDir\lib\index.js" -Force
Copy-Item "$ws\packages\src\dsht-plugin-mobile\lib\client.js" "$mobileDir\lib\client.js" -Force
[IO.File]::WriteAllText("$mobileDir\package.json", '{"name":"dsht-plugin-mobile","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-layout"]}}}')
$mobileKB = [math]::Round((Get-Item "$mobileDir\lib\client.js").Length / 1KB, 1)
Write-Host "  dsht-plugin-mobile：client.js $mobileKB KB 已就位（node_modules/dsht-plugin-mobile）"

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
Step 4.85 'DSHT-RESILIENT-LIST：坏身份/重复id会话文件不崩 runtime（boot-loop 根修）'
# 实机实证：手机端任务卡死强杀重启后 st-w82dal 身份漂移 → listArtifacts throw →
# cordis init 崩溃 → node exit 1 → 3s 重启死循环，App 永久卡在启动屏。
# 补丁：自愈（重命名到 header 声明路径）/ 兜底（跳过+告警）。幂等：带标记跳过。
& node "$ws\scripts\patch-resilient-list.mjs"
if ($LASTEXITCODE -ne 0) { throw "resilient-list 补丁失败" }
Step 4.8 '平台补丁：session 发布 link()→rename()（坑 #14：Android SELinux 禁硬链接）'
# dsh-session-persistence-jsonl 的 materializePosix 用 link()+unlink() 原子发布日志
# （防两进程并发 clobber）；Android SELinux 拒绝 app 进程硬链接（EACCES）——
# 不打补丁则 DSH 在 Android 上无法落盘任何新 session。单 app 单 node 进程，
# rename 覆盖语义无并发风险。幂等：**按「语义是否已生效」判定**（见下）。
$sesPersistence = "$runtimeDst\node_modules\@deepseek-ai\dsh-session-persistence-jsonl\lib\index.js"
if (Test-Path $sesPersistence) {
    $sp = [IO.File]::ReadAllText($sesPersistence)
    # 【2026-09-16 W25 · P-41 第三例】幂等判据从「marker 存在」改锚到「语义已生效」。
    #
    # ## 症状（本轮 `-SkipInstall` 实测）
    # 报「坑 #14 补丁未命中目标」，看起来像「官方改了产物形态」，实际是**幂等判据失效**：
    # Step 4.85 的 `patch-resilient-list.mjs` 会**重写本文件的 import 行**
    # （它的 `ensureRenameImport` 按字母序重排并写 `/* DSHT-RESILIENT-LIST-IMPORT */`）
    # ⇒ 把 `/* DSHT-ANDROID-RENAME-PATCH */` 标记**抹掉了** ⇒ 下一轮本步骤的
    # `-notmatch 'DSHT-ANDROID-RENAME-PATCH'` 判定为「没打过」⇒ 去找锚点 ⇒ 锚点已不存在 ⇒ throw。
    # （实测产物：`DSHT-ANDROID-RENAME-PATCH` **0 处**、`DSHT-RESILIENT-LIST-IMPORT` 1 处，
    #   而 `rename` 已 import、`await rename(tmp, finalPath)` 已在 —— **语义早就生效了**。）
    #
    # ## 为什么 marker 是**代理量**
    # 它只在「没有别的步骤重写这一行」时才存在 —— 一旦有第二个步骤碰同一行，
    # 代理量就与事实脱钩。**真正的事实**是：① import 行里有 `rename`；② 发布路径已是 `rename`。
    # ⇒ 两条都按「事实」判（正则看语义），marker 仅作辅助信息。
    $hasRenameImport = [regex]::IsMatch($sp, 'import \{[^}]*\brename\b[^}]*\} from "node:fs/promises"')
    $hasLinkPublish = [regex]::IsMatch($sp, 'await link\(tmp, finalPath\);')
    if ($hasRenameImport -and -not $hasLinkPublish) {
        Write-Host "  link→rename 补丁已生效（语义匹配：import 含 rename 且无裸 link 发布），跳过"
    } else {
        $orig = $sp
        $sp = $sp -replace [regex]::Escape('import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";'),
            'import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises"; /* DSHT-ANDROID-RENAME-PATCH */'
        $sp = $sp -replace [regex]::Escape('await link(tmp, finalPath);'), 'await rename(tmp, finalPath); /* DSHT-ANDROID-RENAME-LEGACY */'
        if ($sp -eq $orig) { throw "坑 #14 补丁未命中目标（DSH 升级后产物形态变了？检查 dsh-session-persistence-jsonl/lib/index.js）" }
        [IO.File]::WriteAllText($sesPersistence, $sp)
        Write-Host "  session 发布 link→rename 已打补丁（Android SELinux 禁硬链接）"
    }

    # 【C6 修复 2026-09-13】补齐 ps1 相对 python 路径缺失的 2 处 F1 补丁。
    # 实测差异（marker 集合比对）：python apply-platform-patches.py 的 F1 组共 4 处
    # （PATCH import / FS defaultFileSystem / LEGACY 旧路径 / GEN generation 发布路径），
    # 而本 ps1 此前**只做了 import + LEGACY 两处**，漏：
    #   · F1-2 `defaultFileSystem` 暴露 rename（0.1.5 新增的 internals.fs 接口）
    #   · F1-4 generation 发布路径 `publishCurrentExclusive`（**0.1.5 的核心新路径**）
    # 后果：若只走 ps1 完整安装（pnpm install 重建 node_modules），这两处保持裸 link()
    # ⇒ Android SELinux 拒绝硬链接（EACCES）⇒ **无法落盘任何新 session**。
    # 当前 runtime 之所以完好，是因为它由 python 路径打过（巧合掩盖了缺陷）。
    $sp2 = [IO.File]::ReadAllText($sesPersistence)
    if ($sp2 -notmatch 'DSHT-ANDROID-RENAME-FS') {
        $before = $sp2
        # 0.1.5 形态：defaultFileSystem 的 lstat/link 相邻（LF）；兼容 CRLF
        $sp2 = $sp2 -replace [regex]::Escape("`tlstat: (path) => lstat(path),`n`tlink,"),
            "`tlstat: (path) => lstat(path),`n`tlink,`n`trename: (a, b) => rename(a, b), /* DSHT-ANDROID-RENAME-FS */"
        if ($sp2 -eq $before) {
            $sp2 = $sp2 -replace [regex]::Escape("`tlstat: (path) => lstat(path),`r`n`tlink,"),
                "`tlstat: (path) => lstat(path),`n`tlink,`n`trename: (a, b) => rename(a, b), /* DSHT-ANDROID-RENAME-FS */"
        }
        if ($sp2 -eq $before) { Write-Host "  ⚠️ F1-2 defaultFileSystem rename 补丁锚点未命中（形态可能已变）" -ForegroundColor Yellow }
        else { [IO.File]::WriteAllText($sesPersistence, $sp2); Write-Host "  F1-2 defaultFileSystem 暴露 rename 已打补丁" }
    } else { Write-Host "  F1-2 rename 补丁已存在，跳过" }

    $sp3 = [IO.File]::ReadAllText($sesPersistence)
    if ($sp3 -notmatch 'DSHT-ANDROID-RENAME-GEN') {
        $before = $sp3
        $sp3 = $sp3 -replace [regex]::Escape('await internals.fs.link(staged, currentPath);'),
            'await internals.fs.rename(staged, currentPath); /* DSHT-ANDROID-RENAME-GEN */'
        if ($sp3 -eq $before) { Write-Host "  ⚠️ F1-4 generation 发布路径补丁锚点未命中（0.1.5 形态可能已变）" -ForegroundColor Yellow }
        else { [IO.File]::WriteAllText($sesPersistence, $sp3); Write-Host "  F1-4 generation 发布路径 link→rename 已打补丁" }
    } else { Write-Host "  F1-4 generation 补丁已存在，跳过" }

    # 自检：打完 4 处后，文件内不应再有裸 link( 调用（import 行已移除 link）
    $spFinal = [IO.File]::ReadAllText($sesPersistence)
    $bareLink = ([regex]::Matches($spFinal, '(?<![\w.])link\(')).Count
    if ($bareLink -gt 0) { throw "坑 #14 补丁不全：打完仍有 $bareLink 处裸 link( 调用 —— Android 上会 EACCES 无法落盘 session" }
    Write-Host "  F1 自检：0 处裸 link( 调用 ✔"
} else { Write-Host "  ⚠️ 未找到 dsh-session-persistence-jsonl（检查 runtime 结构）" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
Step 5 '重构建导入引擎 bundle（坑 #11 铁律：改了 TS 源码必须重跑 esbuild）'
# data-zip/character-card 等 TS 源码改动只有经 esbuild 打进 app.js 才生效——
# T2.11 起 app.js 直出插件资产（/dsht-rp/import-center/app.js 由插件 GET 服务），
# 不再写 android assets（独立导入中心页已移除）
Push-Location "$ws\packages"
$ErrorActionPreference = 'Continue'
& npx esbuild src/import/browser-entry.ts --bundle --format=iife --global-name=DSHT --outfile="$pluginDir\assets\app.js" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "esbuild 构建失败" }
Pop-Location
$bundleKB = [math]::Round((Get-Item "$pluginDir\assets\app.js").Length / 1KB, 1)
Write-Host "  导入引擎 app.js 重建完成：$bundleKB KB（插件资产）"

# ---------------------------------------------------------------------------
# Step 5.4 产物**内容级**新鲜度闸门（A14）——【2026-09-16 W29 接入 Step 0.5/6.5 之外的第三处】
#
# ## 为什么必须在这一层（而不是 Step 0.5）
# A14 的判据是「**现场重跑一次同样的 esbuild**，与磁盘产物逐字节比对」⇒ 它要求
# **产物已经就位**。放在 Step 0.5（门禁前置）时，runtime 还没替换、产物可能尚未生成
# ⇒ 只会得到「产物不存在」的 optional 跳过，**看不出任何东西**。
# 正确的时机正是这里：Step 3/4/4.7/4.72/4.75 都已跑完、产物刚写完，**打包成 runtime.zip 之前**。
# （与 P-40③/R22② 同一条纪律：**判据必须跑在它所判对象的状态已确定之后**。）
#
# ## 【W22 → W29 的收口】此前它**没有任何自动触发点**（P-11 元级形态）
# W22 登记过：「A14 未接入 Step 0.5 门禁这一事实一并记录」，但只记了没改。
# ⇒ 本轮接入本处，使它从「声明为判据、实质靠人记得跑」变成常驻。
#
# ## 【W29 同时修掉的锚点错误】它此前把自己的 entry 锚在「T-87 目标态」上
# 证据（W29 决定性实验：两个 entry 各重编译一次再逐字节比）：按**权威路径** entry 重编译
# ⇒ **916076 B 与产物逐字节一致**（产物是新鲜的）；按它写死的 T-87 目标 entry
# ⇒ 1114303 B 不一致 ⇒ 被误判「陈旧」。⇒ 已改为**从两条权威脚本实读 entry**（见该脚本注释）。
# ---------------------------------------------------------------------------
Step 5.4 '产物内容级新鲜度闸门（A14；任一产物与现场重编译不一致即停）'
$freshAudit = Join-Path $ws 'scripts\audit-artifact-freshness.mjs'
if (-not (Test-Path $freshAudit)) { throw "门禁脚本缺失：$freshAudit（产物新鲜度闸门不得缺项）" }
& node $freshAudit --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "门禁自检失败：audit-artifact-freshness.mjs --selftest（闸门本身不可信）" }
Write-Host "  [gate] OK audit-artifact-freshness.mjs --selftest"
& node $freshAudit | Out-Null
if ($LASTEXITCODE -ne 0) { throw "产物陈旧：有产物与当前源码的编译结果不一致 —— 设备跑的是旧逻辑（详见 node scripts/audit-artifact-freshness.mjs）" }
Write-Host "  [gate] OK audit-artifact-freshness.mjs（全部产物与现场重编译逐字节一致；★ W81 补：**权威构建脚本按语义自动发现**（含 entry 声明者）+ 双向对账；★ W82 补：**PAIRS 的路径字段真实性**（entry = packages/ 相对 · source = rp-workspace/ 相对 · builtBy 点名的装置；字段失效 ⇒ 判据静默失效 P-30），selftest 32/32）"
Show-Reading -Gate 'audit-artifact-freshness.mjs' -Path $freshAudit   # ★ W62：实读产物→entry 条数（§3.2 A14 段「实读 7 条」）
# 锚点负控（W29）：证明 A14 的 entry 锚点确实**取自权威脚本**，且该判据**有区分力**
# （换一个错误 entry ⇒ 字节必然不同）。否则「解析器返回空 ⇒ 悄悄退回硬编码值」会伪装成通过。
$anchorNc = Join-Path $ws 'scripts\audit-a14-anchor-negctl.mjs'
if (-not (Test-Path $anchorNc)) { throw "负控脚本缺失：$anchorNc（A14 锚点自证不得缺项）" }
& node $anchorNc | Out-Null
if ($LASTEXITCODE -ne 0) { throw "A14 锚点负控未通过：entry 可能没从权威脚本读到（详见 node scripts/audit-a14-anchor-negctl.mjs）" }
Write-Host "  [gate] OK audit-a14-anchor-negctl.mjs（锚点来自权威脚本 + 有区分力）"

# ---------------------------------------------------------------------------
Step 5.5 '打 runtime.zip + sentinel 自动提升（坑 #3 铁律）'
# SkipInstall 重建时 runtimeDst\lib 可能还是另一架构的——强制刷新成 -Arch 对应版本
if (-not (Test-Path $runtimeLib)) { throw "runtime lib 目录不存在：$runtimeLib（termux deb 未提取？）" }
if (Test-Path "$runtimeDst\lib") { Remove-Item "$runtimeDst\lib" -Recurse -Force }
Copy-Item $runtimeLib "$runtimeDst\lib" -Recurse -Force
Write-Host "  runtime lib ← $runtimeLib（Arch=$Arch）"
# P1 能力补齐包的工具本体（bash/rg/zstd/git）走 jniLibs 伪装 .so（SELinux 实证：app_data_file
# 不可 exec）——不进 runtime.zip；runtime/lib 只带它们的私有运行库（dlopen 不受限）。
$svc = "$android\app\src\main\java\com\dshtavern\app\NodeService.kt"
# PS5.1 坑：Get-Content/Set-Content -Encoding UTF8 会在已有 BOM 上再叠一层 BOM，
# 双 BOM 直接让 kotlinc 报 "Expecting a top level declaration"（踩过）。纯 .NET IO 无 BOM 读写。
$svcText = [IO.File]::ReadAllText($svc)
$m = [regex]::Match($svcText, '\.installed-v(\d+)')
if (-not $m.Success) { throw "NodeService.kt 里找不到 RUNTIME_SENTINEL" }
$oldV = [int]$m.Groups[1].Value
# $SentinelV -gt 0 = 双架构的第二次构建：直接钉到第一次的最终值（两包一致）
$newV = if ($SentinelV -gt 0) { $SentinelV } else { $oldV + 1 }
$svcText = $svcText -replace "\.installed-v$oldV", ".installed-v$newV"
[IO.File]::WriteAllText($svc, $svcText, [System.Text.UTF8Encoding]::new($false))
Write-Host "  RUNTIME_SENTINEL: .installed-v$oldV → .installed-v$newV（覆盖安装将重新解压）"

$assets = "$android\app\src\main\assets"
Remove-Item "$assets\dsh-runtime.zip" -Force -ErrorAction SilentlyContinue
Push-Location $runtimeDst
Remove-Item verify-home -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item pnpm-lock.yaml -Force -ErrorAction SilentlyContinue
tar -a -c -f "$assets\dsh-runtime.zip" node_modules lib package.json 2>&1 | Select-Object -First 1
$zipMB = [math]::Round((Get-Item "$assets\dsh-runtime.zip").Length / 1MB, 1)
Write-Host "  runtime.zip：$zipMB MB（assets）"

# ---------------------------------------------------------------------------
Step 6 'APK 编译与交付（gradle + 正式签名/release 或 debug/x64）'
# arm64 → assembleRelease（dsht-release.keystore 正式签名，真机交付）
# x64   → assembleDebug（模拟器自测，debug 签名可覆盖安装既有自测环境，CDP 可调）
$abiProp = if ($Arch -eq 'x86_64') { '-PtargetAbi=x86_64' } else { '' }
Push-Location $android
$ErrorActionPreference = 'Continue'
& $gradle $gradleTask $abiProp --console=plain -q 2>&1 | Select-Object -Last 6
$ErrorActionPreference = 'Stop'
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "gradle $gradleTask 失败（exit=$LASTEXITCODE）" }
$apkArtifact = "$android\app\build\outputs\apk\$buildType\app-$buildType.apk"
if (-not (Test-Path $apkArtifact)) { throw "gradle 产物缺失：$apkArtifact" }
# 坑 #8：AGP 增量打包大资产残留死空间——产物异常膨胀时删 app\build 重打包
$apkMB = [math]::Round((Get-Item $apkArtifact).Length / 1MB, 1)
Copy-Item $apkArtifact $apkOut -Force
Write-Host "  APK 交付：$apkOut（$apkMB MB，$gradleTask，ABI=$archDir）"

# ---------------------------------------------------------------------------
# Step 6.5 APK 内嵌 runtime 版本核验（【2026-09-16 W25 新增】· 守 R5「产物即事实」+ R21）
#
# ## 为什么必须做（只看源码/只看配置都不够）
# `-DshVersion` 决定整棵 runtime 的代次，而从「命令行参数」到「APK 里真正嵌进去的字节」
# 中间要经过：写 package.json → `pnpm install`（**无 lock、子包 caret 解析**）→ 整树复制
# → 打 runtime.zip → gradle 打包。任一环出问题，**源码都是对的、APK 是错的**。
# ⇒ 这一条只能读产物：解开 APK → assets/dsh-runtime.zip → 各包 package.json +
#   `dsh-session.isReplaceOp` 的字段名（★ 决定既有会话能否被读出的那个事实）。
#
# ## 与 Step 0.7 / Step 3.6 的分工（P-1：各有明确边界，不重叠）
#   · Step 0.7 audit-dsh-version    —— **仓库态 + 设备对照**（事前）
#   · Step 3.6 audit-official-contract —— **官方契约面**（事前，runtime 刚装好）
#   · 本步骤 verify-apk-runtime-version —— **产物态**（事后，APK 已出）
#
# ## 为什么单架构时也跑（而不是等双架构齐了才跑）
# 单架构构建也要立刻知道自己这一包对不对（否则要等第二包出完才发现，白跑一次 gradle）。
# 双架构时第二次跑会额外核「两包同代次、同数据形态」。
# ---------------------------------------------------------------------------
Step 6.5 'APK 内嵌 runtime 版本核验（产物层；R5/R21）'
$apkVer = Join-Path $ws 'scripts\verify-apk-runtime-version.mjs'
if (-not (Test-Path $apkVer)) { throw "产物核验脚本缺失：$apkVer（R5「产物即事实」不得缺项）" }
& node $apkVer --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "产物核验脚本自检失败：verify-apk-runtime-version.mjs --selftest（判据本身不可信）" }
& node $apkVer --arch $Arch
if ($LASTEXITCODE -ne 0) { throw "APK 内嵌 runtime 版本核验未通过（详见输出）—— 该包不得交付" }
Write-Host "  [gate] OK verify-apk-runtime-version.mjs（--arch $Arch）"

# ---------------------------------------------------------------------------
# Step 6.6 M4 **内容级**产物核验（【2026-09-17 W47 接入】·守 R5/R6/E-A）
#
# ## 为什么必须有（P-11 元级 —— **M4 是四件套之一，却一直靠人手动跑**）
# **R6** 要求「宣称达成**必须**同时覆盖 ① 测试与构建 ② 门禁 ③ 产物核验 ④ M7」；
# 而其中 **M4（产物核验）此前是本仓**唯一**一项**没有任何自动触发点**的：
#   · Step 6.5 的 `verify-apk-runtime-version.mjs` 只验**版本与数据形态**（很窄）；
#   · 真正的**内容级**核验（169 项标记：F1~F5 / L1 / W3 / W8 / W21 / W24 / 跨包 / DEX /
#     相对顺序）只有一个**在 `tmp/` 下**的脚本 —— 而 `tmp/` 被 `.gitignore:34` 忽略
#     ⇒ ★★ **该核验装置不在版本控制**（克隆后不存在），而 §3.1 把它的路径写成 M4 的
#     **唯一**「怎么跑」命令 ⇒ 读者照做**必然扑空**（**P-52** 同族：
#     「文档里写了」≠「读者能按它找到」）。
# ⇒ 本轮两件事：⑴ **迁到 `scripts/`**（进版本控制）；⑵ **接入构建期**（每轮自动跑）。
#
# ## 为什么放在 **Step 6.6**（而不是更早）
# 它读的是**已交付的 APK**（`DSH-Tavern-0.2.0-<arch>-*.apk`）⇒ 按 **P-40③
# 「判据必须跑在它所判对象状态已确定之后」**，必须在 Step 6（gradle 出包）之后。
# ★ 单架构构建时也跑：只核**本架构**那一个包（另一包可能还是上一代的）。
#
# ## ★ 诚实边界（R7）
#   本步验的是「**标记是否进了产物**」，**不验**「标记本身是否还代表本轮的真实改动」
#   （后者是人工判断：每轮改了什么，就要在 MARKS 里增删对应的 needle）。
# ---------------------------------------------------------------------------
Step 6.6 'M4 内容级产物核验（R5/R6；169 项标记）'
$apkPayload = Join-Path $ws 'scripts\verify-apk-payload.py'
if (-not (Test-Path $apkPayload)) { throw "产物核验脚本缺失：$apkPayload（R5「产物即事实」不得缺项）" }
& python $apkPayload --selftest | Out-Null
if ($LASTEXITCODE -ne 0) { throw "产物核验脚本自检失败：verify-apk-payload.py --selftest（判据本身不可信）" }
# ★ `--apk-root $root`：APK 交付在**仓库根**，本脚本的 cwd 是 `$ws`（显式传参，不 cd）
# ★ `--arch $Arch`：只核**本架构**那一个包（单架构构建时另一包可能本就不存在 ⇒ 否则假红）
& python $apkPayload --apk-root $root --arch $Arch
if ($LASTEXITCODE -ne 0) { throw "M4 内容级产物核验未通过（有标记缺失 ⇒ 源码改了但产物里没有）—— 该包不得交付" }
Write-Host "  [gate] OK verify-apk-payload.py（M4 内容级：$Arch 包标记齐全，缺失 0）"

# ---------------------------------------------------------------------------
Step 7 '收尾提醒'
Write-Host @"

[完成] DSH $DshVersion → DSH Tavern APK（sentinel v$newV，versionName 0.2.0）
后续人工动作（见 UPDATE-SOP.md §1 步骤 7）：
  1. 引擎回归：cd rp-workspace\packages; npx vitest run
  2. 真机验收：安装 APK → 诊断面板看「解压→启动→端口✓」→ 截图反馈
  3. 结果回写 UPDATE-SOP.md 版本历史表
"@ -ForegroundColor Cyan
