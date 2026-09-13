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

# 通用：node 侧 esm 插件（cwd 固定 $pkg）
function Build-NodePlugin($name, $entry) {
    $dir = "$nm\$name"
    New-Item -ItemType Directory -Force -Path "$dir\lib" | Out-Null
    [IO.File]::WriteAllText("$dir\package.json", "{`"name`":`"$name`",`"version`":`"1.0.0`",`"type`":`"module`",`"main`":`"lib/index.js`"}")
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

# 1. dsht-rp-plugin（**RP 总包** + 资产树）
Say "[1/7] dsht-rp-plugin（**RP 总包**：主包 + 4 个 R10 子模块 + 导入中心资产）"
$rp = "$nm\dsht-rp-plugin"
New-Item -ItemType Directory -Force -Path "$rp\lib", "$rp\assets" | Out-Null
Push-Location $pkg
$ErrorActionPreference = 'Continue'
# 【T-87】entry 由 src/dsh-plugin/index.ts 改为总包 src/dsht-rp/index.ts（含 5 个子模块）
& $node $esb 'src/dsht-rp/index.ts' --bundle --format=esm --platform=node --outfile="$rp\lib\index.js" --log-level=warning 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'dsht-rp 总包 esbuild 失败' }
# 【T-87 契约断言】总包必须真的含子模块（只看体积会漏）
$rpText = [IO.File]::ReadAllText("$rp\lib\index.js")
foreach ($sm in @('dsht-plugin-mvu','dsht-plugin-tavern-helper','dsht-plugin-prompt-template','dsht-plugin-memory')) {
    if ($rpText -notmatch [regex]::Escape($sm)) { throw "T-87: 总包缺子模块 '$sm'" }
}
$srcAssets = "$pkg\src\dsh-plugin\assets"
if (Test-Path $srcAssets) {
    Copy-Item "$srcAssets\*" "$rp\assets\" -Recurse -Force
    Say "  资产树已复制（$((Get-ChildItem "$rp\assets" -Recurse -File).Count) 文件）"
}
Say ("  OK dsht-rp-plugin  {0} KB（含 5 个子模块）" -f [math]::Round((Get-Item "$rp\lib\index.js").Length / 1KB, 1))

# 2. 【T-87】原「R10 四插件独立构建」已删除 —— 代码现由总包内联（见上一步）。
Say "[2/7] R10 四插件 —— 已并入总包，跳过（见 docs/T-87-RP-PLUGIN-CONSOLIDATION.md）"

# 3. EJS worker（【T-87】路径改为总包 lib/ 下）
Say "[3/7] EJS worker bundle（并入总包 lib/ejs-worker.js）"
Push-Location $pkg
$ErrorActionPreference = 'Continue'
& $node $esb 'src/dsht-plugin-prompt-template/worker.ts' --bundle --format=esm --platform=node --outfile="$rp\lib\ejs-worker.js" --log-level=warning 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($rc -ne 0) { throw 'ejs-worker esbuild 失败' }
if (-not (Test-Path "$rp\lib\ejs-worker.js")) { throw 'T-87: ejs-worker.js 未生成（worker 会静默退化为同步渲染）' }
Say '  OK ejs-worker.js（总包 lib/）'

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
[IO.File]::WriteAllText("$rp\package.json", '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"bundle":{"patch":"./cordis.patch.yml"},"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings-plugins"]}}}')
Say ("  OK client.js {0} KB 已并入" -f [math]::Round((Get-Item "$rp\lib\client.js").Length / 1KB, 1))
# 【T-87 第 2 步】bundle 层文件随包分发（`dsh plugin add` 靠它把本包补进 dsh.profile.bundles）
Copy-Item "$pkg\src\dsht-rp\cordis.patch.yml" "$rp\cordis.patch.yml" -Force
if (-not (Test-Path "$rp\cordis.patch.yml")) { throw 'T-87: cordis.patch.yml 未随包分发（PC 端 dsh plugin add 不会生效）' }

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
[IO.File]::WriteAllText("$mb\package.json", '{"name":"dsht-plugin-mobile","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-layout"]}}}')
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
# 【T-87】R10 四包已并入总包（不再单独构建）⇒ 列表同步剔除。
foreach ($p in @('dsht-rp-plugin','dsht-plugin-mobile','dsht-plugin-undo','dsht-preflight')) {
    $f = "$nm\$p\lib\index.js"
    if (Test-Path $f) { Say ("  {0,-32} {1,10} B" -f $p, (Get-Item $f).Length) }
    else { Say ("  {0,-32} （未部署）" -f $p) }
}
foreach ($f in @('lib\ejs-worker.js','lib\client.js','assets\app.js')) {
    $p2 = "$nm\dsht-rp-plugin\$f"
    if (Test-Path $p2) { Say ("  {0,-32} {1,10} B" -f "dsht-rp-plugin/$f", (Get-Item $p2).Length) }
}
Say ''
# 【T-87 等价性闸门（心跳 77 接入）】与 build-dsht.ps1 / build-plugins.sh / build-wb.sh 同款：
# 「总包加载 ≡ 5 个独立包加载」（13 判据 + 反控）。A15 类文本断言证明不了「行为等价」——
# 注册顺序（B5）/ 服务声明（B1）/ 命名空间与路由（B3/B4）出问题都不会让构建失败。
$verifyRp = "$ws\scripts\verify-rp-consolidation.mjs"
if (-not (Test-Path $verifyRp)) { throw "T-87: 等价性验证脚本缺失（$verifyRp）" }
$ErrorActionPreference = 'Continue'
& $node $verifyRp --negative-control 2>&1 | Select-String -Pattern 'negctl' | Select-Object -Last 2
$rcNeg = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rcNeg -ne 0) { throw 'T-87: 等价性验证的反控未通过（判据抓不到不一致 ⇒ 该门不可信）' }
$ErrorActionPreference = 'Continue'
& $node $verifyRp 2>&1 | Select-String -Pattern 'PASS|✗' | Select-Object -Last 3
$rcVerify = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rcVerify -ne 0) { throw 'T-87: 总包与 5 个独立包**不等价**（注册顺序/路由/命名空间/服务声明有差异）—— 勿发货' }
Say '  T-87 等价性（13 判据 + 反控）OK'
Say '插件构建完成。'
