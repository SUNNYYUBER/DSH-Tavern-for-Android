# build-dsht.ps1 — DSHTavern 版本构建固定流程（UPDATE-SOP.md 的自动化实现）
# 用法：
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.8        # 完整流程：装新版本 DSH → 平台适配 → 验证 → 打包 → APK
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.7 -SkipInstall  # runtime 已就绪，只跑后半段（打包/APK/sentinel）
#   .\build-dsht.ps1 -DshVersion 0.1.0-rc.7 -SkipInstall -Arch x86_64  # 出 PC 模拟器自测 APK（DSHTavern-m1-test-x64.apk）
# 前置：nvm use 24；JAVA_HOME 指向 JDK 21（脚本自动设）
param(
    [Parameter(Mandatory = $true)][string]$DshVersion,
    [switch]$SkipInstall,
    [ValidateSet('arm64', 'x86_64')][string]$Arch = 'arm64'
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
		"@deepseek-ai/dsh": "$DshVersion"
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
    Copy-Item "$stubs\node-addon-landlock-run\index.js" "$runtimeDst\node_modules\@deepseek-ai\node-addon-landlock-run\lib\index.js" -Force
    Copy-Item "$stubs\dsh-sandbox-windows-acl\index.js" "$runtimeDst\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\lib\index.js" -Force
    Copy-Item "$stubs\dsh-sandbox-windows-acl\runner.js" "$runtimeDst\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\lib\runner.js" -Force
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
function Dsht-Patch([string]$Path, [string]$Marker, [string]$RegexPattern, [string]$Replacement, [int]$Expected, [string]$Label) {
    if (-not (Test-Path $Path)) { throw "补丁目标不存在：$Path（$Label）" }
    $text = [IO.File]::ReadAllText($Path)
    $markerHits = [regex]::Matches($text, [regex]::Escape($Marker)).Count
    if ($markerHits -ge $Expected) { Write-Host "  ${Label}：已打补丁，跳过"; return }
    if ($markerHits -gt 0) { throw "${Label}：补丁处于半打状态（标记 $markerHits/$Expected 处），请检查 $Path" }
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
				for (const p of ["/proc", "/dev", "/system/bin/linker64", "/apex/com.android.runtime", "/system/lib64", process.env.DSHT_NATIVE_LIB_DIR, process.env.DSHT_RUNTIME_LIB_DIR, process.env.TMPDIR])
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
     "`t/* DSHT-ANDROID-JS-SEARCH: android 无 rg 二进制——glob/grep 走纯 JS 降级（lib/android-fallback.mjs） */`n" +
     "`tif (process.platform === `"android`") return dshtAndroidJsSearch(exec, toolName, argv);`n" +
     "`tif (exec.signal.aborted)") `
    1 'P1-3b runRipgrep android 短路'

# P1-4. dsh-terminal-bash：默认 shell / 启动参数适配 mksh
Dsht-Patch "$nmDst\dsh-terminal-bash\lib\index.js" 'DSHT-ANDROID-TERM-SHELL' `
    'const DEFAULT_BASH_SHELL = "/bin/bash";' `
    'const DEFAULT_BASH_SHELL = process.platform === "android" ? "/system/bin/sh" : "/bin/bash"; /* DSHT-ANDROID-TERM-SHELL */' `
    1 'P1-4a terminal-bash DEFAULT_BASH_SHELL'
Dsht-Patch "$nmDst\dsh-terminal-bash\lib\index.js" 'DSHT-ANDROID-TERM-ARGS' `
    'const DEFAULT_BASH_ARGS = \[\r?\n\t"--noprofile",\r?\n\t"--norc",\r?\n\t"-i"\r?\n\];' `
    ('const DEFAULT_BASH_ARGS = process.platform === "android" ? ["-i"] /* DSHT-ANDROID-TERM-ARGS */ : [' + "`n`t`"--noprofile`",`n`t`"--norc`",`n`t`"-i`"`n];") `
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
    'function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, historyIncomplete, dshtOldestSeq, compactTranscript,' `
    1 'P2-1b ChatNodeSeat 接收 dshtOldestSeq'
Dsht-Patch "$chatUi" 'DSHT-CHAT-FOLD-READY' `
    'processPresentation\.turn === processSpec\.turn && processPresentation\.turnClosed && !historyIncomplete;' `
    ('processPresentation.turn === processSpec.turn && processPresentation.turnClosed && (!historyIncomplete || (typeof dshtOldestSeq === "number" && processSpec.processStartSeq >= dshtOldestSeq)); /* DSHT-CHAT-FOLD-READY: 本轮窗口完整在已加载区间即可折叠，不要求全会话历史加载完 */') `
    1 'P2-1c processWindowReady 放宽'

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
$pluginKB = [math]::Round((Get-Item "$pluginDir\lib\index.js").Length / 1KB, 1)
Write-Host "  dsht-rp-plugin：$pluginKB KB 已就位（node_modules/dsht-rp-plugin）"

# ---------------------------------------------------------------------------
Step 4.72 'R10 三大插件打包进 runtime node_modules（MVU / 酒馆助手 / 提示词模板）'
# 与 dsht-rp-plugin 同款形态：Cordis 插件自包含 bundle（named exports name/inject/apply，
# 共享代码经 dsht-plugin-shared 内联，零 @deepseek-ai 运行时依赖）；
# profile patch 由 NodeService 启动时幂等写入（insert 行按包名逐个补齐）。
$r10Plugins = @('dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-memory')
Push-Location "$ws\packages"
foreach ($r10 in $r10Plugins) {
    $r10Dir = "$runtimeDst\node_modules\$r10"
    New-Item -ItemType Directory -Force -Path "$r10Dir\lib" | Out-Null
    [IO.File]::WriteAllText("$r10Dir\package.json", "{`"name`":`"$r10`",`"version`":`"1.0.0`",`"type`":`"module`",`"main`":`"lib/index.js`"}")
    $ErrorActionPreference = 'Continue'
    & npx esbuild "src/$r10/index.ts" --bundle --format=esm --platform=node --outfile="$r10Dir\lib\index.js" 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "$r10 esbuild 失败" }
    $r10KB = [math]::Round((Get-Item "$r10Dir\lib\index.js").Length / 1KB, 1)
    Write-Host "  $r10：$r10KB KB 已就位（node_modules/$r10）"
}
# B15：EJS Worker bundle（compileWorkers 开启时 /render 投给 worker_threads；6s 超时回退同步）
# EAP=Stop 下原生 stderr 重定向会抛 NativeCommandError——与 R10 循环同款先切 Continue
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
# rename 覆盖语义无并发风险。幂等：已含补丁标记则跳过。
$sesPersistence = "$runtimeDst\node_modules\@deepseek-ai\dsh-session-persistence-jsonl\lib\index.js"
if (Test-Path $sesPersistence) {
    $sp = [IO.File]::ReadAllText($sesPersistence)
    if ($sp -notmatch 'DSHT-ANDROID-RENAME-PATCH') {
        $orig = $sp
        $sp = $sp -replace [regex]::Escape('import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";'),
            'import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises"; /* DSHT-ANDROID-RENAME-PATCH */'
        $sp = $sp -replace [regex]::Escape('await link(tmp, finalPath);'), 'await rename(tmp, finalPath);'
        if ($sp -eq $orig) { throw "坑 #14 补丁未命中目标（DSH 升级后产物形态变了？检查 dsh-session-persistence-jsonl/lib/index.js）" }
        [IO.File]::WriteAllText($sesPersistence, $sp)
        Write-Host "  session 发布 link→rename 已打补丁（Android SELinux 禁硬链接）"
    } else { Write-Host "  link→rename 补丁已存在，跳过" }
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
Step 5.5 '打 runtime.zip + sentinel 自动提升（坑 #3 铁律）'
# SkipInstall 重建时 runtimeDst\lib 可能还是另一架构的——强制刷新成 -Arch 对应版本
if (-not (Test-Path $runtimeLib)) { throw "runtime lib 目录不存在：$runtimeLib（termux deb 未提取？）" }
if (Test-Path "$runtimeDst\lib") { Remove-Item "$runtimeDst\lib" -Recurse -Force }
Copy-Item $runtimeLib "$runtimeDst\lib" -Recurse -Force
Write-Host "  runtime lib ← $runtimeLib（Arch=$Arch）"
$svc = "$android\app\src\main\java\com\dshtavern\app\NodeService.kt"
# PS5.1 坑：Get-Content/Set-Content -Encoding UTF8 会在已有 BOM 上再叠一层 BOM，
# 双 BOM 直接让 kotlinc 报 "Expecting a top level declaration"（踩过）。纯 .NET IO 无 BOM 读写。
$svcText = [IO.File]::ReadAllText($svc)
$m = [regex]::Match($svcText, '\.installed-v(\d+)')
if (-not $m.Success) { throw "NodeService.kt 里找不到 RUNTIME_SENTINEL" }
$oldV = [int]$m.Groups[1].Value; $newV = $oldV + 1
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
Step 7 '收尾提醒'
Write-Host @"

[完成] DSH $DshVersion → DSH Tavern APK（sentinel v$newV，versionName 0.2.0）
后续人工动作（见 UPDATE-SOP.md §1 步骤 7）：
  1. 引擎回归：cd rp-workspace\packages; npx vitest run
  2. 真机验收：安装 APK → 诊断面板看「解压→启动→端口✓」→ 截图反馈
  3. 结果回写 UPDATE-SOP.md 版本历史表
"@ -ForegroundColor Cyan
