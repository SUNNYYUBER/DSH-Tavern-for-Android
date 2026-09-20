# emu-app-up.ps1 — 模拟器里重启 DSHTavern 并重建 CDP forward（guard.restore 会 force-stop 应用，
# 任何带 session-guard 的脚本跑完后、下一个脚本开跑前，必须先跑本脚本）。
# 【2026-09-20 单源化】恢复/就绪逻辑已并入 emu-watchdog.ps1（崩溃自动恢复看门狗）——
# 本脚本 = `emu-watchdog.ps1 -Once` 的薄封装（保留既有调用面不变）。
# 用法：pwsh -NoProfile -File scripts/emu-app-up.ps1
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\emu-watchdog.ps1" -Once
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "[完成] 应用与 CDP 通道就绪" -ForegroundColor Green
