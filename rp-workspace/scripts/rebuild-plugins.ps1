# rebuild-plugins.ps1 — 重建我方全部插件产物（build-plugins.sh 的 PowerShell 等价物）
# ============================================================================
# 为什么需要：本机 `bash` 指向 WSL，`D:/...` 盘符路径在 WSL 里解析失败，
# `build-plugins.sh` 直接跑不起来（实机验证：esbuild 路径判定为"不存在"）。
# 本脚本用**与 build-dsht.ps1 / build-wb.sh 完全相同的 cwd 口径**（`$ws\packages`）
# 重建同样的产物，供 PC 侧快速迭代与 PC 验证环境使用。
#
# ⚠️ cwd 不变量：esbuild 把模块路径注释按 **cwd 相对路径**写进产物。
#    cwd 必须固定在 `$ws\packages`，否则同一份源码产出不同字节（无法哈希判新鲜度）。
#
# 用法: pwsh scripts/rebuild-plugins.ps1 [-RuntimeDir <name>]
#       -RuntimeDir 默认 dsh-runtime-android
# ============================================================================
param([string]$RuntimeDir = 'dsh-runtime-android')

$ErrorActionPreference = 'Stop'
$ws   = 'D:\DSH RolePlay\rp-workspace'
$pkg  = "$ws\packages"
$node = 'C:\nvm4w\nodejs\node.exe'
$esb  = "$pkg\node_modules\esbuild\bin\esbuild"
$nm   = "$ws\$RuntimeDir\node_modules"

if (-not (Test-Path $esb)) { throw "esbuild 不存在: $esb" }
if (-not (Test-Path $nm))  { throw "runtime node_modules 不存在: $nm" }

function Say($m) { Write-Host "[plugins] $m" }

# ============================================================================
# 【2026-09-23 DSH 升级轮 · 阶段 A】插件 `peerDependencies` 声明（**单源，唯一实现点**）
#
# ## 为什么必须声明（0.1.7-rc.1 新引入的「插件版本号机制」）
# `dsh-app-boot` 的 `evaluatePluginCompatibility(manifest)` 会在
# **`dsh plugin add` / 带 spec 的 `install`**（pnpm 运行**前**）检查插件 manifest：
#   · 只检 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peer；
#   · **未声明 `peerDependencies` ⇒ 直接放行**（我方此前就是这种「恰好通过」）；
#   · `workspace:*` / `workspace:^` / `workspace:~` ⇒ **替换成当前 runtime 版本**⇒ 永远满足；
#   · 其余 range 参与 semver 匹配 ⇒ 不满足即 **`incompatible-version` 拒绝安装**。
#
# ## ★ 实测（`rp-workspace/tmp/probe-peer-effect.mjs`，喂真函数看返回）
#   不声明            ⇒ ✅ 放行
#   `workspace:*`     ⇒ ✅ 放行（且语义正确：声明了「我依赖当前 runtime」）
#   `^0.1.5`          ⇒ ✅ 放行（0.1.7 ≥ 0.1.5，同主版本）
#   `^0.1.7`          ⇒ ⛔ **拒绝**（`0.1.7-rc.1` 是**预发布**，不满足 `^` 正式版语义）
#   `^0.2.0`          ⇒ ⛔ 拒绝
#   ⇒ 结论：**任何写死的 range 都有风险**（尤以「看起来最对的 `^0.1.7`」最危险），
#     `workspace:*` 是唯一稳妥写法。
#
# ## 为什么不是「不声明就完了」
# 不声明确实放行，但：① 语义缺失（我方插件**确实**强依赖官方 client-ui 包，
# 现在官方**帮助不了我们**——升级时不会提示不兼容）；② 一旦有人「顺手」补个
# `^0.1.7`（最自然的写法）⇒ 插件**在安装期被拒**，表现为「装不上」而非「跑不起来」，
# 排查方向完全不同。⇒ 主动用正确形态声明。
#
# ## ★ 单源纪律（P-1）
# 本表是**唯一实现点**：本脚本 4 处 package.json 写入点全部引用它。
# `build-dsht.ps1` 与 `NodeService.kt` 的对应硬编码必须**同字段同值**——
# 由 `audit-plugin-build-parity.mjs` / `audit-nodeservice-deploy.mjs` 守。
# ============================================================================
# 我方插件共同依赖的官方包（= `dsh.client.external` 那 4 个 client-ui 包 +
# 顶层 dsh 本体）。用 `workspace:*` ⇒ 官方会替换成当前 runtime 版本。
$DSHT_PEER = '{"@deepseek-ai/dsh":"workspace:*","@deepseek-ai/dsh-client-ui-layout":"workspace:*","@deepseek-ai/dsh-client-ui-sidebar":"workspace:*","@deepseek-ai/dsh-client-ui-conversation":"workspace:*","@deepseek-ai/dsh-client-ui-settings-plugins":"workspace:*"}'

# 通用：node 侧 esm 插件（cwd 固定 $pkg）
function Build-NodePlugin($name, $entry) {
    $dir = "$nm\$name"
    New-Item -ItemType Directory -Force -Path "$dir\lib" | Out-Null
    [IO.File]::WriteAllText("$dir\package.json", "{`"name`":`"$name`",`"version`":`"1.0.0`",`"type`":`"module`",`"main`":`"lib/index.js`",`"peerDependencies`":$DSHT_PEER}")
    Push-Location $pkg
    $ErrorActionPreference = 'Continue'
    & $node $esb $entry --bundle --format=esm --platform=node --outfile="$dir\lib\index.js" --log-level=warning 2>&1 | Out-Null
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Pop-Location
    if ($rc -ne 0) { throw "$name esbuild 失败" }
    Say ("  OK {0}  {1} KB" -f $name, [math]::Round((Get-Item "$dir\lib\index.js").Length / 1KB, 1))
}

Say "=== 重建我方插件 -> $RuntimeDir ==="

# 1. dsht-rp-plugin（RP 主插件：dsh-plugin 本体 + 资产树；T-88 起**不再内联 R10 子模块**）
Say "[1/7] dsht-rp-plugin（RP 主插件 + 导入中心资产）"
$rp = "$nm\dsht-rp-plugin"
New-Item -ItemType Directory -Force -Path "$rp\lib", "$rp\assets" | Out-Null
Push-Location $pkg
$ErrorActionPreference = 'Continue'
# 【T-88】entry 回到 src/dsh-plugin/index.ts（主插件本体）——与 build-dsht.ps1 Step 4.7 同形态
& $node $esb 'src/dsh-plugin/index.ts' --bundle --format=esm --platform=node --outfile="$rp\lib\index.js" --log-level=warning 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'dsht-rp-plugin esbuild 失败' }
# 【T-88 契约断言】主插件**不得**内联 R10 子模块的**插件入口**（防「名义拆包、实际还是总包」）。
# 口径：只禁 `src/<pkg>/index.ts`（apply 本体）；主插件对 R10 各包**共享模块**的正当 import
# （ejs.ts / sandbox.ts / tables.ts / macros.ts —— 与 dsht-plugin-shared 同性质）不在禁止面。
$rpText = [IO.File]::ReadAllText("$rp\lib\index.js")
foreach ($sm in @('src/dsht-plugin-mvu/index.ts','src/dsht-plugin-tavern-helper/index.ts','src/dsht-plugin-prompt-template/index.ts','src/dsht-plugin-memory/index.ts')) {
    if ($rpText.Contains($sm)) { throw "T-88: 主插件仍内联子模块入口 '$sm'（拆包不干净）" }
}
$srcAssets = "$pkg\src\dsh-plugin\assets"
if (Test-Path $srcAssets) {
    Copy-Item "$srcAssets\*" "$rp\assets\" -Recurse -Force
    Say "  资产树已复制（$((Get-ChildItem "$rp\assets" -Recurse -File).Count) 文件）"
}
Say ("  OK dsht-rp-plugin  {0} KB" -f [math]::Round((Get-Item "$rp\lib\index.js").Length / 1KB, 1))

# 2. 【T-88】R10 四插件恢复独立构建（与 build-dsht.ps1 Step 4.72 同形态）
Say "[2/7] R10 五插件独立构建（MVU / 酒馆助手 / 提示词模板 / 剧情记忆 / 设备能力）"
# ⚠️ 本列表必须与 build-dsht.ps1 的 $r10Plugins **逐字一致**。历史上这里漏过
#    dsht-plugin-device（只在下方 $r10Ids 里登记了 id、没进本循环）⇒ 产物只写
#    package.json（main: lib/index.js）却不生成 lib/index.js ⇒ 真机 Cordis
#    加载该包失败 ⇒ **整棵插件树起不来 / DSH boot loop**（第 45 次重启实录）。
#    该漂移现由 scripts/audit-plugin-build-parity.mjs 常驻守（W-3 事故防回归）。
foreach ($r10 in @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory', 'dsht-plugin-device')) {
    Build-NodePlugin $r10 "src/$r10/index.ts"
}

# 3. EJS worker（T-88 起随 dsht-plugin-prompt-template 独立包——workerPath 与加载它的 index.js 同目录）
Say "[3/7] EJS worker bundle（随 dsht-plugin-prompt-template/lib/）"
$ptLib = "$nm\dsht-plugin-prompt-template\lib"
Push-Location $pkg
$ErrorActionPreference = 'Continue'
& $node $esb 'src/dsht-plugin-prompt-template/worker.ts' --bundle --format=esm --platform=node --outfile="$ptLib\ejs-worker.js" --log-level=warning 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'ejs-worker esbuild 失败' }
if (-not (Test-Path "$ptLib\ejs-worker.js")) { throw 'T-88: ejs-worker.js 未生成（worker 会静默退化为同步渲染）' }
Say '  OK ejs-worker.js（dsht-plugin-prompt-template/lib/）'

# 4. dsht-plugin-undo
Say "[4/7] dsht-plugin-undo"
if (Test-Path "$pkg\src\dsht-plugin-undo\index.ts") {
    Build-NodePlugin 'dsht-plugin-undo' 'src/dsht-plugin-undo/index.ts'
} else { Say '  · 源码不存在，跳过' }

# 5. dsht-preflight（非 cordis 插件，走 NODE_OPTIONS --import）
Say "[5/7] dsht-preflight（壳侧 pre-boot 静态预检）"
Build-NodePlugin 'dsht-preflight' 'src/dsht-preflight/index.ts'

# 6. dsht-rp-ui client（并入 dsht-rp-plugin）
Say "[6/7] dsht-rp-ui client bundle（并入 dsht-rp-plugin）"
Push-Location $pkg
$ErrorActionPreference = 'Continue'
& $node "$ws\scripts\build-rp-ui.mjs" 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'build-rp-ui.mjs 失败' }
Copy-Item "$pkg\src\dsht-rp-ui\lib\client.js" "$rp\lib\client.js" -Force
[IO.File]::WriteAllText("$rp\package.json", '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"peerDependencies":' + $DSHT_PEER + ',"dsh":{"bundle":{"patch":"./cordis.patch.yml"},"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings-plugins"]}}}')
Say ("  OK client.js {0} KB 已并入" -f [math]::Round((Get-Item "$rp\lib\client.js").Length / 1KB, 1))
# 【T-88】bundle 层文件随包分发（`dsh plugin add` 靠它把本包补进 dsh.profile.bundles）
# patch 源文件随主插件源码（src/dsh-plugin/cordis.patch.yml；T-87 的 src/dsht-rp/ 已退役）
Copy-Item "$pkg\src\dsh-plugin\cordis.patch.yml" "$rp\cordis.patch.yml" -Force
if (-not (Test-Path "$rp\cordis.patch.yml")) { throw 'T-88: cordis.patch.yml 未随包分发（PC 端 dsh plugin add 不会生效）' }
# 【T-88】R10 四包的 PC 可装性：各包补 dsh.bundle.patch 声明 + 各自的 insert 行
# （NodeService 的 Android 部署不读 dsh.bundle.patch——profile patch 由它手写；
#   本处与 NodeService 的 package.json 硬编码保持**同字段**（防两侧漂移）。
$r10Ids = @{
    'dsht-plugin-mvu' = 'dsht-mvu'
    'dsht-plugin-tavern-helper' = 'dsht-tavern-helper'
    'dsht-plugin-prompt-template' = 'dsht-prompt-template'
    'dsht-plugin-memory' = 'dsht-memory'
    # 【W-3】设备能力插件（与 build-dsht.ps1 的 $r10Ids 同源同值）
    'dsht-plugin-device' = 'dsht-device'
}
foreach ($r10 in $r10Ids.Keys) {
    $dir = "$nm\$r10"
    $id = $r10Ids[$r10]
    [IO.File]::WriteAllText("$dir\package.json", "{`"name`":`"$r10`",`"version`":`"1.0.0`",`"type`":`"module`",`"main`":`"lib/index.js`",`"peerDependencies`":$DSHT_PEER,`"dsh`":{`"bundle`":{`"patch`":`"./cordis.patch.yml`"}}}")
    [IO.File]::WriteAllText("$dir\cordis.patch.yml", "- insert:`n    - id: $id`n      name: '$r10'`n")
}

# 7. dsht-plugin-mobile（双面）
Say "[7/7] dsht-plugin-mobile（node 空壳 + client）"
Push-Location $pkg
$ErrorActionPreference = 'Continue'
& $node "$ws\scripts\build-mobile.mjs" 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'build-mobile.mjs 失败' }
$mb = "$nm\dsht-plugin-mobile"
New-Item -ItemType Directory -Force -Path "$mb\lib" | Out-Null
Copy-Item "$pkg\src\dsht-plugin-mobile\lib\index.js"  "$mb\lib\index.js" -Force
Copy-Item "$pkg\src\dsht-plugin-mobile\lib\client.js" "$mb\lib\client.js" -Force
[IO.File]::WriteAllText("$mb\package.json", '{"name":"dsht-plugin-mobile","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"peerDependencies":' + $DSHT_PEER + ',"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-layout"]}}}')
Say ("  OK dsht-plugin-mobile（client {0} KB）" -f [math]::Round((Get-Item "$mb\lib\client.js").Length / 1KB, 1))

# 8. app.js（导入引擎）—— 必须在 assets 同步之后
Say "[8/8] 导入引擎 app.js"
Push-Location $pkg
$ErrorActionPreference = 'Continue'
& $node $esb 'src/import/browser-entry.ts' --bundle --format=iife --global-name=DSHT --outfile="$rp\assets\app.js" --log-level=warning 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'app.js esbuild 失败' }
Say ("  OK app.js {0} KB" -f [math]::Round((Get-Item "$rp\assets\app.js").Length / 1KB, 1))

Say ''
Say '=== 部署结果 ==='
# 【T-88】R10 五包恢复独立构建 ⇒ 列表同步恢复。
foreach ($p in @('dsht-rp-plugin','dsht-plugin-mvu','dsht-plugin-tavern-helper','dsht-plugin-prompt-template','dsht-plugin-memory','dsht-plugin-device','dsht-plugin-mobile','dsht-plugin-undo','dsht-preflight')) {
    $f = "$nm\$p\lib\index.js"
    if (Test-Path $f) { Say ("  {0,-32} {1,10} B" -f $p, (Get-Item $f).Length) }
    else { Say ("  {0,-32} （未部署）" -f $p) }
}
foreach ($f in @('lib\client.js','assets\app.js')) {
    $p2 = "$nm\dsht-rp-plugin\$f"
    if (Test-Path $p2) { Say ("  {0,-32} {1,10} B" -f "dsht-rp-plugin/$f", (Get-Item $p2).Length) }
}
$ptw = "$nm\dsht-plugin-prompt-template\lib\ejs-worker.js"
if (Test-Path $ptw) { Say ("  {0,-32} {1,10} B" -f 'dsht-plugin-prompt-template/lib/ejs-worker.js', (Get-Item $ptw).Length) }
Say ''
# 【T-88 拆包完整性闸门】与 build-dsht.ps1 / build-plugins.sh / build-wb.sh 同形态后的验收：
# 「主插件不含 R10 子模块 + 四独立包在场 + patch 顺序不变量 + 动态行为一致」
# （9 判据 + 解析器自证 + 反控）。A15 类文本断言证明不了「拆干净」——
# 名义拆包（总包还在）/ 拆丢（某包缺失）/ 顺序漂移（B5）都不会让构建失败。
# ⚠️ 本文件是 PowerShell：注释里**不要用反引号**（PS 的行内转义符，会吞掉后一个字符、
#    破坏后续引号配对 ⇒ 报错位置会漂到一个毫不相干的远处行号）。
$verifyRp = "$ws\scripts\verify-rp-consolidation.mjs"
if (-not (Test-Path $verifyRp)) { throw "T-88: 拆包验证脚本缺失（$verifyRp）" }
# 先跑**解析器自证**（合成输入，秒级）：清单解析错了，后面的 8c 结论就不必看了
$ErrorActionPreference = 'Continue'
& $node $verifyRp --selftest-parser 2>&1 | Select-String -Pattern 'selftest-parser' | Select-Object -Last 1
$rcParser = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rcParser -ne 0) { throw 'T-88: 构建路径解析器自证未通过（清单可能残缺 ⇒ 判据8c 的结论不可采信）' }
$ErrorActionPreference = 'Continue'
& $node $verifyRp --negative-control 2>&1 | Select-String -Pattern 'negctl' | Select-Object -Last 2
$rcNeg = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rcNeg -ne 0) { throw 'T-88: 拆包验证的反控未通过（判据抓不到「拆不干净」 ⇒ 该门不可信）' }
$ErrorActionPreference = 'Continue'
& $node $verifyRp 2>&1 | Select-String -Pattern 'PASS|✗' | Select-Object -Last 3
$rcVerify = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rcVerify -ne 0) { throw 'T-88: 拆包不完整（总包未退役 / 主插件内联子模块 / 独立包缺失 / patch 顺序漂移）—— 勿发货' }
Say '  T-88 拆包完整性（9 判据 + 解析器自证 + 反控）OK'
Say '插件构建完成。'
