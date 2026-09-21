# emu-watchdog.ps1 — 模拟器可靠性看门狗（崩溃自动恢复 + 就绪保证）
# ============================================================================
# 背景（2026-09-20 实证矩阵）：本机 AMD Ryzen 5800X3D + Windows 26200 上，
# Android emulator 37.1.11（渠道最新）全部加速/镜像组合都存在偶发崩溃：
#   TCG + 35 镜像   → qemu 0xc0000005 随机崩（同一偏移，高负载触发，5+ 次实证）
#   WHPX + 35 镜像  → 同签名崩溃（1 次实证；WHPX 可用——VBS 已启用 hypervisor）
#   WHPX + 36.1 镜像 → qemu 稳但 guest system_server native 连环崩（dexopt/装包时）
# AEHD（Intel 驱动）不适用于 AMD CPU（从未能启动，0x1f/0xffffffa1 实证）。
# ⇒ 崩溃无法在本机层面根治（qemu×OS×CPU 组合缺陷），可靠性 = 「崩溃自动恢复」：
#   掉线 → 清场 → 重启（WHPX 优先）→ 装 APK → 起应用 → 建 forward → 就绪。
#
# 用法：
#   .\emu-watchdog.ps1 -Once      # 确保一次就绪（测试脚本前置调用；emu-app-up.ps1 的单源）
#   .\emu-watchdog.ps1 -Watch     # 持续监控，掉线即恢复（长测试会话侧挂）
#   .\emu-watchdog.ps1 -Once -Tcg # 强制 TCG（WHPX 被禁用时）
param(
    [switch]$Once,
    [switch]$Watch,
    [switch]$Tcg,
    [int]$WatchIntervalSec = 15
)

$ErrorActionPreference = 'Continue' # 恢复循环里单步失败不终止——下一轮再试
$sdk      = "$env:USERPROFILE\.android\sdk"
$emulator = "$sdk\emulator\emulator.exe"
$adb      = "$sdk\platform-tools\adb.exe"
$apk      = 'D:\DSH RolePlay\DSH-Tavern-0.2.2-x86_64-debug.apk'
$avd      = 'dsht-x64'

function Write-Log($msg) { Write-Host "[watchdog $(Get-Date -Format 'HH:mm:ss')] $msg" }

function Test-DeviceOnline {
    return [bool]((& $adb devices 2>$null) -match "emulator-\d+\s+device")
}

function Restore-Emulator {
    Write-Log "设备掉线/不就绪 ⇒ 开始恢复"
    # 1. 清场：杀 qemu（僵尸进程 Access denied 可忽略——已死不持资源）+ 删 AVD lock + 重启 adb
    taskkill /F /IM qemu-system-x86_64-headless.exe 2>$null | Out-Null
    Start-Sleep -Seconds 3
    Remove-Item "$env:USERPROFILE\.android\avd\$avd.avd\*.lock" -Force -Recurse -ErrorAction SilentlyContinue
    & $adb kill-server 2>$null | Out-Null
    Start-Sleep -Seconds 2
    & $adb start-server 2>$null | Out-Null

    # 2. 启动模拟器（WHPX 优先；-Tcg 强制软件渲染）
    $accel = if ($Tcg) { 'off' } else { 'on' }
    Write-Log "启动模拟器 $avd（-accel $accel，无窗口）"
    Start-Process -FilePath $emulator -WindowStyle Hidden -ArgumentList @(
        '-avd', $avd, '-accel', $accel, '-gpu', 'swiftshader_indirect',
        '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot')

    # 3. 等 boot（WHPX ~2 分钟 / TCG ~4 分钟，上限 8 分钟）
    & $adb wait-for-device 2>$null | Out-Null
    $booted = $false
    foreach ($i in 1..160) {
        $b = (& $adb -s emulator-5554 shell getprop sys.boot_completed 2>$null) -join ''
        if ($b.Trim() -eq '1') { $booted = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $booted) { Write-Log "[警告] boot_completed 8 分钟未就绪——下轮重试"; return $false }

    # 4. 装 APK（包管理器可能因 dexopt 风暴暂不可用——重试窗口）
    if (Test-Path $apk) {
        foreach ($try in 1..10) {
            $pkg = & $adb -s emulator-5554 shell 'service check package' 2>$null
            if ($pkg -notmatch 'found') { Start-Sleep -Seconds 10; continue }
            $installed = & $adb -s emulator-5554 shell 'pm path com.dshtavern.app' 2>$null
            if ($installed -match 'package:') { break }
            Write-Log "安装 APK（第 $try 次）"
            $r = & $adb -s emulator-5554 install -r $apk 2>&1 | Select-Object -Last 1
            if ($r -match 'Success') { break }
            Start-Sleep -Seconds 15
        }
    }

    # 5. 起应用 + forward（43080 DSH / 3081 RP 数据 / 9333 CDP 在 Ensure-AppUp 里建）
    & $adb -s emulator-5554 shell am start -n com.dshtavern.app/.MainActivity 2>$null | Out-Null
    & $adb -s emulator-5554 forward tcp:43080 tcp:3080 2>$null | Out-Null
    & $adb -s emulator-5554 forward tcp:3081 tcp:3081 2>$null | Out-Null
    Write-Log "模拟器恢复完成"
    return $true
}

function Ensure-AppUp {
    # 应用层就绪：DSH 服务可通 + CDP forward 建好（dshtavern webview pid 每次启动都变）
    foreach ($i in 1..30) {
        $r = $null
        try { $r = curl.exe -s -m 3 http://127.0.0.1:43080/api/health 2>$null } catch { }
        if ($r) { break }
        & $adb -s emulator-5554 shell am start -n com.dshtavern.app/.MainActivity 2>$null | Out-Null
        Start-Sleep -Seconds 3
    }
    $sock = $null
    foreach ($i in 1..10) {
        $cands = (& $adb -s emulator-5554 shell "cat /proc/net/unix | grep -i devtools" 2>$null) |
            Select-String 'webview_devtools_remote_(\d+)' | ForEach-Object { $_.Matches.Groups[0].Value }
        foreach ($s in $cands) {
            $pid_ = $s -replace 'webview_devtools_remote_',''
            $name = & $adb -s emulator-5554 shell "cat /proc/$pid_/cmdline 2>/dev/null"
            if ($name -match 'dshtavern') { $sock = $s; break }
        }
        if ($sock) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $sock) { Write-Log "[警告] 找不到 dshtavern webview devtools socket"; return $false }
    & $adb -s emulator-5554 forward tcp:9333 localabstract:$sock 2>$null | Out-Null
    Start-Sleep -Seconds 2
    $json = curl.exe -s -m 8 http://127.0.0.1:9333/json 2>$null
    if (-not ($json -match 'webSocketDebuggerUrl')) { Write-Log "[警告] CDP /json 无 page target"; return $false }
    Write-Log "就绪（DSH ✓ / CDP $sock ✓）"
    return $true
}

function Ensure-ApkInstalled {
    # APK 在场保证（设备在线但包不在也会走到——比如换 AVD/安装记录被崩溃丢掉，2026-09-20 实证）
    $installed = & $adb -s emulator-5554 shell 'pm path com.dshtavern.app' 2>$null
    if ($installed -match 'package:') { return $true }
    if (-not (Test-Path $apk)) { Write-Log "[警告] 包不在设备且本地无 APK：$apk"; return $false }
    foreach ($try in 1..10) {
        $pkg = & $adb -s emulator-5554 shell 'service check package' 2>$null
        if ($pkg -notmatch 'found') { Start-Sleep -Seconds 10; continue }
        Write-Log "安装 APK（第 $try 次）"
        $r = & $adb -s emulator-5554 install -r $apk 2>&1 | Select-Object -Last 1
        if ($r -match 'Success') { return $true }
        Start-Sleep -Seconds 15
    }
    Write-Log "[警告] APK 安装连续失败"
    return $false
}

function Ensure-Ready {
    if (-not (Test-DeviceOnline)) {
        if (-not (Restore-Emulator)) { return $false }
    }
    if (-not (Ensure-ApkInstalled)) { return $false }
    return (Ensure-AppUp)
}

if ($Watch) {
    Write-Log "进入持续监控（间隔 ${WatchIntervalSec}s；Ctrl+C 退出）"
    while ($true) {
        if (-not (Test-DeviceOnline)) { [void](Ensure-Ready) }
        Start-Sleep -Seconds $WatchIntervalSec
    }
} else {
    # 默认 = -Once（与显式 -Once 同义）
    $ok = Ensure-Ready
    if (-not $ok) { Write-Log "[失败] 本轮未能恢复到就绪态"; exit 1 }
    Write-Log "[完成] 模拟器与应用就绪"
}
