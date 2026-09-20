# emulator-dsht.ps1 — DSHTavern 安卓模拟器自测工具（x86_64 AVD）
# 用法：
#   .\emulator-dsht.ps1              # 完整流程：启动模拟器（带窗口）→ 装最新 x64 APK → 打开 app
#   .\emulator-dsht.ps1 -Headless    # 无窗口模式（后台跑，adb/screencap 验证用）
#   .\emulator-dsht.ps1 -NoInstall   # 只启动模拟器，不装 APK
# 前置：镜像 system-images;android-35;google_apis;x86_64。
# 加速：AEHD（sc query aehd = RUNNING）可用则用；不可用则 TCG 无加速硬撑——
#   慢且高负载下 qemu 可能崩（崩溃丢 guest 页缓存未落盘写入，2026-09-20 实证），
#   本脚本启动时检测并明确警告（R8：失败/降级必须出声，不许静默降级）。
param(
    [switch]$Headless,
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
$sdk      = "$env:USERPROFILE\.android\sdk"
$emulator = "$sdk\emulator\emulator.exe"
$adb      = "$sdk\platform-tools\adb.exe"
$apk      = 'D:\DSH RolePlay\DSH-Tavern-0.2.0-x86_64-debug.apk'
$avd      = 'dsht-x64'

if (-not (Test-Path $emulator)) { throw "emulator 不存在：$emulator" }

# 加速路径（2026-09-20 实证钉死）：本机 AMD Ryzen → AEHD（Intel 专用驱动）永不适用；
# WHPX 可用（VBS 已启用 hypervisor，WHvGetCapability 实测 "installed and usable"）——
# 显式 -accel on 走 WHPX（默认 auto 会优先试注册态的 AEHD 失败后落 TCG，慢 4 倍）。
# 偶发崩溃（qemu 0xc0000005，TCG/WHPX 同签名）无法本机根治 ⇒ emu-watchdog.ps1 自动恢复兜底。
Write-Host "[加速] -accel on（WHPX 优先；AEHD 不适用 AMD，已弃用该路径）" -ForegroundColor DarkCyan

# 模拟器已在跑则复用，不重复启动
$running = (& $adb devices) -match "emulator-\d+\s+device"
if (-not $running) {
    Write-Host "[1/3] 启动模拟器 $avd（$(if($Headless){'无窗口'}else{'带窗口'})，WHPX 加速）…" -ForegroundColor Cyan
    $gpu = if ($Headless) { 'swiftshader_indirect' } else { 'auto' }
    $winArgs = if ($Headless) { @('-no-window', '-no-audio', '-no-boot-anim') } else { @() }
    if ($Headless) {
        Start-Process -FilePath $emulator -ArgumentList (@('-avd', $avd, '-accel', 'on', '-gpu', $gpu, '-no-snapshot') + $winArgs) -WindowStyle Hidden
    } else {
        Start-Process -FilePath $emulator -ArgumentList (@('-avd', $avd, '-accel', 'on', '-gpu', $gpu, '-no-snapshot') + $winArgs)
    }
    & $adb wait-for-device
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        $b = (& $adb -s emulator-5554 shell getprop sys.boot_completed 2>$null) -join ''
        if ($b.Trim() -eq '1') { break }
        Start-Sleep -Seconds 3
    }
    Write-Host "  模拟器已就绪"
} else {
    Write-Host "[1/3] 模拟器已在运行，复用" -ForegroundColor Green
}

if (-not $NoInstall) {
    if (-not (Test-Path $apk)) { throw "APK 不存在：$apk（先跑 build-dsht.ps1 -Arch x86_64）" }
    Write-Host "[2/3] 安装 APK…" -ForegroundColor Cyan
    & $adb -s emulator-5554 install -r $apk | Out-Null
    Write-Host "  已安装 $(Split-Path $apk -Leaf)"
} else {
    Write-Host "[2/3] 跳过安装（-NoInstall）"
}

Write-Host "[3/3] 启动 DSHTavern…" -ForegroundColor Cyan
& $adb -s emulator-5554 shell am start -n com.dshtavern.app/.MainActivity | Out-Null
& $adb -s emulator-5554 forward tcp:43080 tcp:3080 | Out-Null
# 3081 = dsht-rp-plugin 数据服务（rp/workspaces 等，CORS 已开）——宿主机浏览器直连 DSH 页面时
# 前端 fetch 127.0.0.1:3081，没有这条 forward 宫格必空（坑 #24 实录）
& $adb -s emulator-5554 forward tcp:3081 tcp:3081 | Out-Null

Write-Host @"

[完成] DSHTavern 已在模拟器运行
  - 首次启动需解压 3 万个文件（约 15-30 秒），之后 node 约 3 秒就绪
  - 宿主机直接访问 DSH（含 RP 插件界面）：http://127.0.0.1:43080
  - 查看运行日志：adb -s emulator-5554 logcat -s DSHTavern.Node
  - 截图：adb -s emulator-5554 exec-out screencap -p > screen.png
  - 关闭模拟器：adb -s emulator-5554 emu kill
"@ -ForegroundColor Cyan
