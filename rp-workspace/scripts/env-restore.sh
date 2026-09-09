#!/usr/bin/env bash
# env-restore.sh — 环境自愈：模拟器/DSHT/mock/代理/接收器 全部拉起并验证
ADB="C:/Users/Administrator/.android/sdk/platform-tools/adb.exe"
NODE="C:/nvm4w/nodejs/node.exe"
S="D:/DSH RolePlay/rp-workspace/scripts"

# 1. 模拟器
if ! $ADB devices 2>/dev/null | grep -q "emulator-5554"; then
  echo "[env] 模拟器不在，启动…"
  ("C:/Users/Administrator/.android/sdk/emulator/emulator.exe" -avd dsht-x64 -no-snapshot-save -gpu auto > "D:/DSH RolePlay/tmp/emulator.log" 2>&1 &)
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
  ($NODE "$S/golden-mock-llm.mjs" > "D:/DSH RolePlay/tmp/mock.log" 2>&1 &)
  sleep 2; echo "[env] mock LLM 已起"
fi
# 6. 透明代理（31102）
if ! curl -s -m 3 -o /dev/null --noproxy "*" "http://127.0.0.1:31102/" 2>/dev/null; then
  ($NODE "$S/golden-proxy.mjs" > "D:/DSH RolePlay/tmp/proxy.log" 2>&1 &)
  sleep 2; echo "[env] 透明代理已起"
fi
# 7. 接收器（31100）
if ! curl -s -m 3 -o /dev/null --noproxy "*" "http://127.0.0.1:31100/" 2>/dev/null; then
  ($NODE "$S/golden-receiver.mjs" > "D:/DSH RolePlay/tmp/receiver.log" 2>&1 &)
  sleep 2; echo "[env] 接收器已起"
fi
# 8. TT（基准，备用）
$ADB -s emulator-5554 shell "pidof com.tauritavern.client" >/dev/null 2>&1 || $ADB -s emulator-5554 shell "am start -n com.tauritavern.client/.MainActivity" >/dev/null 2>&1
# 9. TT CDP forward
TPID=$($ADB -s emulator-5554 shell "pidof com.tauritavern.client" 2>/dev/null | tr -d '\r')
[ -n "$TPID" ] && $ADB -s emulator-5554 forward tcp:9333 "localabstract:webview_devtools_remote_$TPID" >/dev/null 2>&1 && echo "[env] TT CDP forward（pid=$TPID）"
echo "[env] === 环境就绪 ==="
