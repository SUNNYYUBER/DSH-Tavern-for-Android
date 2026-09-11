#!/usr/bin/env bash
# build-plugins.sh — 构建我方全部插件并部署到 runtime staging
# ============================================================================
# 背景（2026-09-10 心跳 41 发现）：dsh-runtime-src 是**干净安装目录**（只含 @deepseek-ai 官方包），
# 我方 7 个插件（dsht-rp-plugin / dsht-plugin-mvu / -tavern-helper / -prompt-template /
# -memory / -mobile / -undo）必须**单独构建后复制进去**。build-dsht.ps1 的 Step 4.7~4.77 做这件事，
# 但该脚本在当前沙箱跑不了 → 本脚本是其 Bash 复刻。
#
# 用法: bash scripts/build-plugins.sh [runtime_dir]
#       runtime_dir 默认 dsh-runtime-android
# ============================================================================
set -euo pipefail

WS="D:/DSH RolePlay/rp-workspace"
NODE="C:/nvm4w/nodejs/node.exe"
ESB="$WS/packages/node_modules/esbuild/bin/esbuild"
PKG="$WS/packages"
DST="${1:-dsh-runtime-android}"
# 绝对路径判定必须含 Windows 盘符：`D:/...` 以 `D` 开头而非 `/`，
# 原判据 `${DST:0:1} != "/"` 会把 Windows 绝对路径再拼一次 $WS →
# `D:/.../rp-workspace/D:/.../rp-workspace/dsh-runtime-android`（实机构建直接失败）。
# 该分支此前一直走不到（build-wb.sh 老版本永远「跳过构建」），修新鲜度戳后才暴露。
case "$DST" in
  /*|[A-Za-z]:[/\\]*) : ;;                # 已是绝对路径（POSIX 或 Windows 盘符）
  *) DST="$WS/$DST" ;;
esac
NM="$DST/node_modules"

say() { echo "[plugins] $*"; }
die() { echo "[plugins][FATAL] $*" >&2; exit 1; }

[ -f "$ESB" ] || die "esbuild 不存在: $ESB"
[ -d "$NM" ] || die "runtime node_modules 不存在: $NM"

# ---------------------------------------------------------------- 通用：node 侧 esm 插件
build_node_plugin() {
  local pkg="$1" entry="$2"
  local dir="$NM/$pkg"
  mkdir -p "$dir/lib"
  printf '{"name":"%s","version":"1.0.0","type":"module","main":"lib/index.js"}' "$pkg" > "$dir/package.json"
  "$NODE" "$ESB" "$PKG/$entry" --bundle --format=esm --platform=node \
    --outfile="$dir/lib/index.js" --log-level=warning >/dev/null
  local kb=$(( $(stat -c%s "$dir/lib/index.js") / 1024 ))
  say "  ✓ $pkg  ${kb} KB"
}

say "=== 构建我方插件 → $DST ==="

# ---------------------------------------------------------------- 1. dsht-rp-plugin（RP 宿主插件 + 资产）
say "[1/7] dsht-rp-plugin（宿主插件 + 导入中心资产）"
RP="$NM/dsht-rp-plugin"
mkdir -p "$RP/lib" "$RP/assets"
"$NODE" "$ESB" "$PKG/src/dsh-plugin/index.ts" --bundle --format=esm --platform=node \
  --outfile="$RP/lib/index.js" --log-level=warning >/dev/null
# 资产树（import-center.html + skills/st-migration + agent-presets/dsht-adapter）
if [ -d "$PKG/src/dsh-plugin/assets" ]; then
  cp -r "$PKG/src/dsh-plugin/assets/." "$RP/assets/"
  say "  ✓ 资产树已复制（$(find "$RP/assets" -type f | wc -l) 文件）"
fi
say "  ✓ dsht-rp-plugin  $(( $(stat -c%s "$RP/lib/index.js") / 1024 )) KB"

# ---------------------------------------------------------------- 2~5. R10 四插件
say "[2/7] R10 插件（MVU / 酒馆助手 / 提示词模板 / 记忆）"
build_node_plugin "dsht-plugin-mvu"             "src/dsht-plugin-mvu/index.ts"
build_node_plugin "dsht-plugin-tavern-helper"   "src/dsht-plugin-tavern-helper/index.ts"
build_node_plugin "dsht-plugin-prompt-template" "src/dsht-plugin-prompt-template/index.ts"
build_node_plugin "dsht-plugin-memory"          "src/dsht-plugin-memory/index.ts"

# ---------------------------------------------------------------- 2b. EJS worker
say "[3/7] EJS worker bundle"
"$NODE" "$ESB" "$PKG/src/dsht-plugin-prompt-template/worker.ts" --bundle --format=esm --platform=node \
  --outfile="$NM/dsht-plugin-prompt-template/lib/ejs-worker.js" --log-level=warning >/dev/null
say "  ✓ ejs-worker.js"

# ---------------------------------------------------------------- 6. dsht-plugin-undo
say "[4/7] dsht-plugin-undo"
if [ -f "$PKG/src/dsht-plugin-undo/index.ts" ]; then
  build_node_plugin "dsht-plugin-undo" "src/dsht-plugin-undo/index.ts"
else
  say "  · 源码不存在，跳过"
fi

# ---------------------------------------------------------------- 4b. dsht-preflight（T-67）
# **不是 cordis 插件**：不进 profile 的 insert 列表，由 NodeService 通过
# `NODE_OPTIONS=--import <runtime>/node_modules/dsht-preflight/lib/index.js` 在 DSH 主入口
# (`@deepseek-ai/dsh/lib/bin.js`) **之前**预加载 —— 用来在「插件树加载期」之前修掉
# 「会话目录名 ≠ projectKey(header.cwd)」这种会把 app 打成无限 crash-loop 的存量损坏（L88）。
# 用 doc 侧已有机制（`extractFn` 等价性对质）保证它引用的 projectKey/encodeSegment 与官方一致。
say "[4b/7] dsht-preflight（壳侧 pre-boot 静态预检，走 NODE_OPTIONS --import）"
build_node_plugin "dsht-preflight" "src/dsht-preflight/index.ts"

# ---------------------------------------------------------------- 7. dsht-rp-ui client → 并入 rp-plugin
say "[5/7] dsht-rp-ui client bundle（并入 dsht-rp-plugin）"
( cd "$PKG" && "$NODE" "$WS/scripts/build-rp-ui.mjs" ) || die "build-rp-ui.mjs 失败"
cp "$PKG/src/dsht-rp-ui/lib/client.js" "$RP/lib/client.js"
say "  ✓ client.js $(( $(stat -c%s "$RP/lib/client.js") / 1024 )) KB 已并入"
# package.json（host + client 双面形态）
printf '%s' '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings-plugins"]}}}' > "$RP/package.json"

# ---------------------------------------------------------------- 8. dsht-plugin-mobile
say "[6/7] dsht-plugin-mobile（node 空壳 + client）"
( cd "$PKG" && "$NODE" "$WS/scripts/build-mobile.mjs" ) || die "build-mobile.mjs 失败"
MB="$NM/dsht-plugin-mobile"
mkdir -p "$MB/lib"
cp "$PKG/src/dsht-plugin-mobile/lib/index.js"  "$MB/lib/index.js"
cp "$PKG/src/dsht-plugin-mobile/lib/client.js" "$MB/lib/client.js"
printf '%s' '{"name":"dsht-plugin-mobile","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-layout"]}}}' > "$MB/package.json"
say "  ✓ dsht-plugin-mobile（client $(( $(stat -c%s "$MB/lib/client.js") / 1024 )) KB）"

# ---------------------------------------------------------------- 9. app.js（导入引擎）
say "[7/7] 导入引擎 app.js"
"$NODE" "$ESB" "$PKG/src/import/browser-entry.ts" --bundle --format=iife --global-name=DSHT \
  --outfile="$RP/assets/app.js" --log-level=warning >/dev/null
say "  ✓ app.js $(( $(stat -c%s "$RP/assets/app.js") / 1024 )) KB"

# ---------------------------------------------------------------- 汇总
say ""
say "=== 部署结果 ==="
for p in dsht-rp-plugin dsht-plugin-mvu dsht-plugin-tavern-helper dsht-plugin-prompt-template dsht-plugin-memory dsht-plugin-mobile dsht-plugin-undo dsht-preflight; do
  if [ -f "$NM/$p/lib/index.js" ]; then
    printf "  %-32s %8s B\n" "$p" "$(stat -c%s "$NM/$p/lib/index.js")"
  else
    printf "  %-32s %s\n" "$p" "（未部署）"
  fi
done
say ""
say "插件构建完成。"
