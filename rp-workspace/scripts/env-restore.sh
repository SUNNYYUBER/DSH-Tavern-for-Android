#!/usr/bin/env bash
# env-restore.sh — 环境自愈：模拟器/DSHT/mock/代理/接收器 全部拉起并验证
# 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
ADB="${DSHT_ADB:-<path-to-adb>}"
EMULATOR="${DSHT_EMULATOR:-<path-to-emulator.exe>}"
NODE="C:/nvm4w/nodejs/node.exe"
# 【E2 脱敏 2026-09-13】项目根原为硬编码绝对路径（含盘符），改为由本脚本位置推导。
ROOT="$(cd "$(dirname "$0")/../.." && pwd -W)"
S="$(cd "$(dirname "$0")" && pwd -W)"

# 1. 模拟器
if ! $ADB devices 2>/dev/null | grep -q "emulator-5554"; then
  echo "[env] 模拟器不在，启动…"
  ("$EMULATOR" -avd dsht-x64 -no-snapshot-save -gpu auto > "$ROOT/tmp/emulator.log" 2>&1 &)
  $ADB wait-for-device 2>/dev/null
  for i in $(seq 1 40); do B=$($ADB -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r'); [ "$B" = "1" ] && { echo "[env] boot 完成"; break; }; sleep 5; done
fi
# 2. 时区（IASN）
TZ=$($ADB -s emulator-5554 shell getprop persist.sys.timezone 2>/dev/null | tr -d '\r')
if [ "$TZ" != "Asia/Shanghai" ]; then $ADB -s emulator-5554 shell "setprop persist.sys.timezone Asia/Shanghai"; echo "[env] 时区修正"; fi
# 3. DSHT app + node
$ADB -s emulator-5554 shell am force-stop com.dshtavern.app 2>/dev/null
sleep 1
$ADB -s emulator-5554 shell am start -n com.dshtavern.app/.MainActivity >/dev/null 2>&1
$ADB -s emulator-5554 forward tcp:43080 tcp:3080 >/dev/null 2>&1
for i in $(seq 1 60); do sleep 5; R=$(curl -s -m 4 --noproxy "*" "http://127.0.0.1:43080/dsht-rp/rp/build-info" 2>/dev/null); [ -n "$R" ] && { echo "[env] DSHT: $R"; break; }; done
# 4. ENABLED 开关
$ADB -s emulator-5554 shell "run-as com.dshtavern.app sh -c 'mkdir -p files/.dsh/rp/golden && touch files/.dsh/rp/golden/dsht-ENABLED'" 2>/dev/null
# 5. mock LLM（31101）
if ! curl -s -m 3 -o /dev/null --noproxy "*" "http://127.0.0.1:31101/v1/models" 2>/dev/null; then
  ($NODE "$S/golden-mock-llm.mjs" > "$ROOT/tmp/mock.log" 2>&1 &)
  sleep 2; echo "[env] mock LLM 已起"
fi
# 6. 透明代理（31102）
if ! curl -s -m 3 -o /dev/null --noproxy "*" "http://127.0.0.1:31102/" 2>/dev/null; then
  ($NODE "$S/golden-proxy.mjs" > "$ROOT/tmp/proxy.log" 2>&1 &)
  sleep 2; echo "[env] 透明代理已起"
fi
# 7. 接收器（31100）
if ! curl -s -m 3 -o /dev/null --noproxy "*" "http://127.0.0.1:31100/" 2>/dev/null; then
  ($NODE "$S/golden-receiver.mjs" > "$ROOT/tmp/receiver.log" 2>&1 &)
  sleep 2; echo "[env] 接收器已起"
fi
# 8. TT（基准，备用）
$ADB -s emulator-5554 shell "pidof com.tauritavern.client" >/dev/null 2>&1 || $ADB -s emulator-5554 shell "am start -n com.tauritavern.client/.MainActivity" >/dev/null 2>&1
# 9. TT CDP forward
TPID=$($ADB -s emulator-5554 shell "pidof com.tauritavern.client" 2>/dev/null | tr -d '\r')
[ -n "$TPID" ] && $ADB -s emulator-5554 forward tcp:9333 "localabstract:webview_devtools_remote_$TPID" >/dev/null 2>&1 && echo "[env] TT CDP forward（pid=$TPID）"
echo "[env] === 环境就绪 ==="
