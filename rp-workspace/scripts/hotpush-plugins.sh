#!/usr/bin/env bash
# hotpush-plugins.sh — 把本地产出的插件 lib/ 热推到设备上的**双副本**
# ============================================================================
# 为什么必须双份（血泪）：
#   ① <app>/files/dsh-runtime/node_modules/<pkg>/lib/index.js   （staging 副本，装机用）
#   ② <app>/files/.dsh/profiles/web/node_modules/<pkg>/lib/index.js ← 运行时实际 import 的路径
#   只推一处 = 改了等于没改。
#
# 【Git Bash 路径陷阱（本脚本踩过）】MSYS 只转换**以 / 开头的独立参数**：
#   · 本地绝对 POSIX 路径 /d/DSH RolePlay/... 传给 adb.exe（Windows 程序）→ No such file
#     ⇒ 统一用 `pwd -W` 得到 D:/DSH RolePlay 形态
#   · 远端 /data/... 作为独立参数会被 MSYS 改写成 C:/Program Files/Git/data/...
#     ⇒ 所有 adb 调用加 MSYS_NO_PATHCONV=1
#
# 用法：bash rp-workspace/scripts/hotpush-plugins.sh <pkg> [<pkg>...]
#   例：bash rp-workspace/scripts/hotpush-plugins.sh dsht-rp-plugin dsht-plugin-memory
# 注意：推完必须重启 app（Node 进程持有旧模块）。
set -u
ADB="${ADB:-C:/Users/Administrator/.android/sdk/platform-tools/adb.exe}"
PKG="${APPLICATION_ID:-com.dshtavern.app}"
WS="$(cd "$(dirname "$0")/../.." && pwd -W)"
SRC="$WS/rp-workspace/dsh-runtime-android/node_modules"
TMP=/data/local/tmp/dsht-hotpush
BASE1="/data/data/$PKG/files/dsh-runtime/node_modules"
BASE2="/data/data/$PKG/files/.dsh/profiles/web/node_modules"

adbsh() { MSYS_NO_PATHCONV=1 "$ADB" shell "$@"; }

[ $# -ge 1 ] || { echo "用法: $0 <pkg> [<pkg>...]"; exit 1; }

adbsh "rm -rf $TMP; mkdir -p $TMP" >/dev/null 2>&1
rc=0
for p in "$@"; do
  for f in lib/index.js lib/client.js; do
    s="$SRC/$p/$f"
    [ -f "$s" ] || continue
    r="${f//\//_}"                       # lib/index.js → lib_index.js
    t="$TMP/${p}__${r}"
    if ! MSYS_NO_PATHCONV=1 "$ADB" push "$s" "$t" >/dev/null 2>&1; then
      echo "  ✗ push $p/$f 失败（本地 $s）"; rc=1; continue
    fi
    local_md5=$(md5sum "$s" | awk '{print $1}')
    for base in "$BASE1" "$BASE2"; do
      case "$base" in
        */dsh-runtime/*) label="staging(dsh-runtime)" ;;
        *)               label="profile(.dsh/profiles/web)" ;;
      esac
      # 目录存在性用 ls 输出判定（adb shell 的退出码传播不可靠）
      if [ -z "$(adbsh "run-as $PKG ls -d $base/$p 2>/dev/null" | tr -d '\r')" ]; then
        echo "  – 跳过（设备无此包路径）: $label/$p"; continue
      fi
      adbsh "run-as $PKG cp $t $base/$p/$f"
      dev_md5=$(adbsh "run-as $PKG md5sum $base/$p/$f" 2>/dev/null | awk '{print $1}' | tr -d '\r')
      if [ "$dev_md5" = "$local_md5" ]; then
        echo "  ✓ $p/$f → $label  ($local_md5)"
      else
        echo "  ✗ $p/$f → $label  md5 不符 local=$local_md5 dev=$dev_md5"; rc=1
      fi
    done
  done
done
adbsh "rm -rf $TMP" >/dev/null 2>&1
exit $rc
