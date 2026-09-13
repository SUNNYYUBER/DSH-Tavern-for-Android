#!/usr/bin/env bash
# upgrade-runtime.sh — DSH runtime 一键升级（安装 → 平台补丁 → 我方插件）
# ============================================================================
# 背景：DSH 升级涉及三个独立步骤，此前散落在不同脚本里且部分跑不了：
#   ① 安装新版本 DSH 到 dsh-runtime-src（干净目录，hoisted 布局）
#   ② 打平台补丁（Android 适配，build-dsht.ps1 Step 3~4.8 的复刻）
#   ③ 构建并部署我方 7 个插件（src → staging/node_modules）
# 本脚本把它们串起来，并把「同步到 staging」也自动化。
#
# 用法:
#   bash scripts/upgrade-runtime.sh install   <version>   # ① 仅安装（~30min）
#   bash scripts/upgrade-runtime.sh patch     [runtime]   # ② 打补丁（幂等）
#   bash scripts/upgrade-runtime.sh plugins   [runtime]   # ③ 构建插件
#   bash scripts/upgrade-runtime.sh sync                  # ④ src → staging 同步
#   bash scripts/upgrade-runtime.sh all       <version>   # 全流程
#   bash scripts/upgrade-runtime.sh check     [runtime]   # 只预检补丁命中
#
# 安全：所有大批量文件操作使用 mv（不用 rm——安全护栏会拦截）
# ============================================================================
set -euo pipefail

# 【E2 脱敏 2026-09-13】项目根原为硬编码绝对路径（含盘符），改为由本脚本位置推导。
WS="$(cd "$(dirname "$0")/.." && pwd -W)"
ROOT="$(cd "$WS/.." && pwd -W)"
NODE="C:/nvm4w/nodejs/node.exe"
NPM="C:/nvm4w/nodejs/npx"
# 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
PY="${DSHT_PY:-<path-to-python.exe>}"
SRC="$WS/dsh-runtime-src"
DST="$WS/dsh-runtime-android"

say() { echo "[upgrade] $*"; }
die() { echo "[upgrade][FATAL] $*" >&2; exit 1; }

cmd_install() {
  local ver="${1:?用法: upgrade-runtime.sh install <version>}"
  say "① 安装 @deepseek-ai/dsh@$ver → $SRC"
  [ -d "$SRC" ] || mkdir -p "$SRC"
  # 备份现有 package.json
  [ -f "$SRC/package.json" ] && cp "$SRC/package.json" "$SRC/package.json.bak" || true
  printf '{\n\t"dependencies": {\n\t\t"@deepseek-ai/dsh": "%s"\n\t}\n}\n' "$ver" > "$SRC/package.json"
  ( cd "$SRC" && "$NPM" -y pnpm@10 install --node-linker=hoisted \
      --registry=https://registry.npmmirror.com 2>&1 | tail -5 )
  [ -f "$SRC/node_modules/@deepseek-ai/dsh/lib/bin.js" ] || die "安装异常：bin.js 不存在"
  say "  ✓ 安装完成：$ver"
}

cmd_check() {
  local dst="${1:-$DST}"
  say "② 预检补丁命中（$dst）"
  "$PY" "$WS/scripts/apply-platform-patches.py" "$dst" --check
}

cmd_patch() {
  local dst="${1:-$DST}"
  say "② 应用平台补丁（$dst）"
  "$PY" "$WS/scripts/apply-platform-patches.py" "$dst"
}

cmd_plugins() {
  local dst="${1:-$DST}"
  say "③ 构建我方插件（$dst）"
  bash "$WS/scripts/build-plugins.sh" "$dst"
}

cmd_sync() {
  say "④ 同步 src → staging"
  [ -d "$SRC/node_modules" ] || die "src/node_modules 不存在（先跑 install）"
  # 安全护栏：mv 不会触发批量删除（rm 会）
  if [ -d "$DST/node_modules" ]; then
    local bak="$DST/node_modules-prev"
    [ -e "$bak" ] && { say "  旧备份已存在，先移走"; mv "$bak" "$bak.$$"; }
    mv "$DST/node_modules" "$bak"
    say "  ✓ 旧 node_modules → node_modules-prev（回滚保险）"
  fi
  cp -r "$SRC/node_modules" "$DST/node_modules"
  say "  ✓ 复制完成"
  say "  版本：$(grep -m1 '"version"' "$DST/node_modules/@deepseek-ai/dsh/package.json")"
}

cmd_all() {
  local ver="${1:?用法: upgrade-runtime.sh all <version>}"
  cmd_install "$ver"
  cmd_check  "$SRC"
  cmd_patch  "$SRC"
  cmd_plugins "$DST"
  cmd_sync
  say ""
  say "=== 升级完成 ==="
  say "下一步：bash scripts/build-wb.sh x86_64    # 打 APK"
}

case "${1:-}" in
  install) shift; cmd_install "$@" ;;
  patch)   shift; cmd_patch   "$@" ;;
  check)   shift; cmd_check   "$@" ;;
  plugins) shift; cmd_plugins "$@" ;;
  sync)    shift; cmd_sync ;;
  all)     shift; cmd_all     "$@" ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
