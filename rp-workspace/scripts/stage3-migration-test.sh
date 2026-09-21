#!/usr/bin/env bash
# stage3-migration-test.sh — 阶段 3：设备端会话迁移验证
# ============================================================================
# 背景：DSH 0.1.5 首次打开 0.1.2 时代的会话时，会做 v0→v1→v2→v3 三段迁移。
#       迁移是不可逆的（就地发布新 generation），故必须：
#         ① 先备份设备和会话
#         ② 迁移前后做内容对比（用 tools/verify-session-migration.py）
#         ③ 确认无内容丢失
#
# 用法:
#   bash scripts/stage3-migration-test.sh backup     # ① 备份设备数据（迁移前）
#   bash scripts/stage3-migration-test.sh pull       # ② 拉取会话到本地
#   bash scripts/stage3-migration-test.sh install    # ③ 安装新 APK
#   bash scripts/stage3-migration-test.sh watch      # ④ 观察迁移（logcat）
#   bash scripts/stage3-migration-test.sh verify     # ⑤ 迁移后对比
#   bash scripts/stage3-migration-test.sh all        # 全流程
# ============================================================================
set -euo pipefail

# 【E2 脱敏 2026-09-13】项目根原为硬编码绝对路径（含盘符），改为由本脚本位置推导。
ROOT="$(cd "$(dirname "$0")/../.." && pwd -W)"
# 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
ADB="${DSHT_ADB:-<path-to-adb>}"
PKG="com.dshtavern.app"
PY="${DSHT_PY:-<path-to-python.exe>}"
DEV="$ROOT/stage3-device"                 # 设备数据本地镜像
APP="/data/data/$PKG/files"
APK_X64="$ROOT/DSH-Tavern-0.2.1-x86_64-debug.apk"

say() { echo "[stage3] $*"; }
die() { echo "[stage3][FATAL] $*" >&2; exit 1; }

need_dev() {
  "$ADB" get-state >/dev/null 2>&1 || die "无设备连接（先启动模拟器或连真机）"
}

# ---------------------------------------------------------------- ① 备份
cmd_backup() {
  need_dev
  say "① 备份设备数据（迁移前基线）"
  mkdir -p "$DEV/backup"
  local ts=$(date +%Y%m%d-%H%M%S)
  # 优先 tar 到 sdcard（run-as 可能无 tar，则用 adb exec-out + 本地打包）
  say "  采集 .dsh 目录清单..."
  "$ADB" shell "run-as $PKG sh -c 'find files/.dsh -maxdepth 2 -type d 2>/dev/null'" > "$DEV/backup/dirlist-$ts.txt" || true
  say "  会话文件清单："
  "$ADB" shell "run-as $PKG sh -c 'ls -la files/.dsh/sessions 2>/dev/null'" | head -20 || true
  say "  设备端未做打包（run-as 无 tar）——改用 pull 逐文件"
  cmd_pull
}

# ---------------------------------------------------------------- ② 拉取
cmd_pull() {
  need_dev
  say "② 拉取会话与 rp 数据"
  mkdir -p "$DEV/sessions-before" "$DEV/rp-before"
  # sessions 目录
  local n=0
  for f in $("$ADB" shell "run-as $PKG sh -c 'ls files/.dsh/sessions 2>/dev/null'" | tr -d '\r'); do
    "$ADB" exec-out "run-as $PKG cat files/.dsh/sessions/$f" > "$DEV/sessions-before/$f" 2>/dev/null && n=$((n+1))
  done
  say "  拉取会话文件：$n 个"
  # 关键子目录列表
  "$ADB" shell "run-as $PKG sh -c 'ls files/.dsh/ 2>/dev/null'" | tr -d '\r' > "$DEV/rp-before/_dsh-list.txt" || true
  "$ADB" shell "run-as $PKG sh -c 'ls files/.dsh/rp/ 2>/dev/null'" | tr -d '\r' > "$DEV/rp-before/_rp-list.txt" || true
  say "  已保存目录清单"
  ls -la "$DEV/sessions-before" | head -10
}

# ---------------------------------------------------------------- ③ 安装
cmd_install() {
  need_dev
  [ -f "$APK_X64" ] || die "APK 不存在：$APK_X64（先跑 build-wb.sh x86_64）"
  say "③ 安装新 APK（覆盖安装，保留数据）"
  say "  APK: $APK_X64（$(stat -c%s "$APK_X64") 字节）"
  "$ADB" install -r "$APK_X64" 2>&1 | tail -3
  say "  启动 app..."
  "$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- ④ 观察
cmd_watch() {
  need_dev
  say "④ 观察迁移行为（logcat，120 秒）"
  "$ADB" logcat -c 2>/dev/null || true
  say "  监听关键词：migration / format / v0 / v1 / v2 / v3 / SessionFormat"
  timeout 120 "$ADB" logcat 2>/dev/null | grep -i --line-buffered \
    "migration\|format v\|SessionFormat\|v0→\|v1→\|v2→\|upgrade\|migrat" | head -60 || true
  say "  监听结束"
}

# ---------------------------------------------------------------- ⑤ 验证
cmd_verify() {
  need_dev
  say "⑤ 迁移后拉取 + 对比"
  mkdir -p "$DEV/sessions-after"
  local n=0
  for f in $("$ADB" shell "run-as $PKG sh -c 'ls files/.dsh/sessions 2>/dev/null'" | tr -d '\r'); do
    "$ADB" exec-out "run-as $PKG cat files/.dsh/sessions/$f" > "$DEV/sessions-after/$f" 2>/dev/null && n=$((n+1))
  done
  say "  拉取迁移后会话：$n 个"
  say ""
  say "  批量扫描迁移后格式："
  "$PY" "$ROOT/tools/verify-session-migration.py" scan "$DEV/sessions-after" 2>&1 | head -25
  say ""
  say "  逐会话对比（需要 baseline）："
  for b in "$DEV"/../.goal/upgrade-0.1.5/baseline-*.json; do
    [ -f "$b" ] || continue
    local sid=$(basename "$b" .json | sed 's/^baseline-//')
    local after="$DEV/sessions-after/session-$sid.jsonl"
    if [ -f "$after" ]; then
      say "  --- $sid ---"
      "$PY" "$ROOT/tools/verify-session-migration.py" compare "$b" "$after" 2>&1 | tail -12
    fi
  done
}

cmd_all() {
  cmd_backup
  cmd_install
  cmd_watch
  cmd_verify
  say ""
  say "=== 阶段 3 完成，请检查上面的对比结果 ==="
}

case "${1:-}" in
  backup)  cmd_backup ;;
  pull)    cmd_pull ;;
  install) cmd_install ;;
  watch)   cmd_watch ;;
  verify)  cmd_verify ;;
  all)     cmd_all ;;
  *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
