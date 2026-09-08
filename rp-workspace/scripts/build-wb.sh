#!/usr/bin/env bash
# build-wb.sh — WorkBuddy 侧一键构建（build-dsht.ps1 的 Bash 复刻 + 教训护栏版）
# 用法: ./build-wb.sh [x86_64|arm64|both]   （默认 x86_64）
# 教训编码为断言（错即停），全部来源见 ROBUSTNESS-LOOP.md 第 4 轮 / 坑#22：
#   A1 esbuild outfile 必须绝对路径（坑#22 路径双胞胎）
#   A2 产物必须含 fixTag 指纹（防写到别处/旧源码）
#   A3 NodeService.kt 必须无 BOM（坑 R35 双 BOM 编译炸）
#   A4 zip 内容必须抽验 fixTag（防旧产物进包——v185 事故）
#   A5 gradle 产物必须存在且 > 50MB（防增量打包空壳，坑#8）
#   A6 每次构建 sentinel 必须恰好 +1（覆盖安装重解压的依据）
set -euo pipefail

ARCH="${1:-x86_64}"
ROOT="D:/DSH RolePlay"
WS="$ROOT/rp-workspace"
NODE="C:/nvm4w/nodejs/node.exe"
ESB="$WS/packages/node_modules/esbuild/bin/esbuild"
PKG="$WS/packages"
DST="$WS/dsh-runtime-android"
ANDROID="$WS/android"
ADB="C:/Users/Administrator/.android/sdk/platform-tools/adb.exe"
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
PY="C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"

say() { echo "[build-wb] $*"; }
die() { echo "[build-wb][FATAL] $*" >&2; exit 1; }

build_one() {
  local ARCH="$1"
  local GRADLE_TASK BUILD_TYPE ABI_PROP APK_ARTIFACT APK_OUT LIB_SRC
  if [ "$ARCH" = "x86_64" ]; then
    GRADLE_TASK=assembleDebug; BUILD_TYPE=debug; ABI_PROP="-PtargetAbi=x86_64"
    APK_OUT="$ROOT/DSH-Tavern-0.2.0-x86_64-debug.apk"; LIB_SRC="$WS/dsh-runtime-x64/lib"
  else
    GRADLE_TASK=assembleRelease; BUILD_TYPE=release; ABI_PROP=""
    APK_OUT="$ROOT/DSH-Tavern-0.2.0-arm64-release.apk"; LIB_SRC="$WS/dsh-runtime/lib"
  fi
  local APK_ARTIFACT="$ANDROID/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"

  say "=== 构建开始: $ARCH ==="

  say "[A3] NodeService.kt 无 BOM 检查"
  [ "$("$PY" -c "print(open(r'$ANDROID/app/src/main/java/com/dshtavern/app/NodeService.kt','rb').read()[:3]==b'\xef\xbb\xbf')")" = "False" ] \
    || die "A3: NodeService.kt 有 BOM（R35 双 BOM 会让 kotlinc 炸）"

  say "[1/6] esbuild dsh-plugin（绝对 outfile, A1）"
  "$NODE" "$ESB" "$PKG/src/dsh-plugin/index.ts" --bundle --format=esm --platform=node \
    --outfile="$DST/node_modules/dsht-rp-plugin/lib/index.js" >/dev/null
  say "[A2] 产物 fixTag 抽验"
  FIX=$(grep -a -c "wb-fix-0908" "$DST/node_modules/dsht-rp-plugin/lib/index.js" || true)
  [ "$FIX" -ge 1 ] || die "A2: 产物无 fixTag——esbuild 写错位置或源码不对（坑#22）"

  say "[2/6] esbuild 导入引擎 app.js（绝对 outfile）"
  "$NODE" "$ESB" "$PKG/src/import/browser-entry.ts" --bundle --format=iife --global-name=DSHT \
    --outfile="$DST/node_modules/dsht-rp-plugin/assets/app.js" >/dev/null

  say "[3/6] lib 换架构 ($ARCH)"
  rm -rf "$DST/lib"; cp -r "$LIB_SRC" "$DST/lib"
  ls "$DST/lib" | grep -q libbusybox || die "lib 刷新异常（libbusybox 缺失）"

  say "[4/6] sentinel +1（A6, python 无 BOM 读写）"
  "$PY" -c "
import re
p=r'$ANDROID\app\src\main\java\com\dshtavern\app\NodeService.kt'
t=open(p,'rb').read().decode('utf-8')
m=re.search(r'\.installed-v(\d+)',t); old=int(m.group(1)); new=old+1
open(p,'wb').write(t.replace(f'.installed-v{old}',f'.installed-v{new}').encode('utf-8'))
print(f'  sentinel v{old} -> v{new}')"

  say "[5/6] 打 runtime.zip + A4 zip 内容抽验"
  rm -f "$ANDROID/app/src/main/assets/dsh-runtime.zip"
  (cd "$DST" && rm -rf verify-home pnpm-lock.yaml 2>/dev/null || true)
  (cd "$DST" && /c/Windows/System32/tar.exe -a -c -f "$ANDROID/app/src/main/assets/dsh-runtime.zip" node_modules lib package.json)
  "$PY" -c "
import zipfile,sys
d=zipfile.ZipFile(r'$ANDROID\app\src\main\assets\dsh-runtime.zip').read('node_modules/dsht-rp-plugin/lib/index.js')
n=d.count(b'wb-fix-0908')
print('  zip 内 fixTag =', n)
sys.exit(0 if n>=1 else 1)" || die "A4: zip 内产物无 fixTag——旧产物进包（v185 事故重演）"

  say "[6/6] gradle $GRADLE_TASK"
  (cd "$ANDROID" && "$WS/downloads/gradle/gradle-8.14/bin/gradle" $GRADLE_TASK $ABI_PROP --console=plain -q)
  [ -f "$APK_ARTIFACT" ] || die "A5: gradle 产物缺失"
  SZ=$(stat -c%s "$APK_ARTIFACT")
  [ "$SZ" -gt 52428800 ] || die "A5: APK 仅 $SZ 字节（<50MB，疑似空壳，坑#8）"
  cp -f "$APK_ARTIFACT" "$APK_OUT"
  say "交付: $APK_OUT ($((SZ/1048576)) MB, $BUILD_TYPE, ABI=$ARCH)"
  say "=== 构建完成: $ARCH ==="
}

case "$ARCH" in
  x86_64) build_one x86_64 ;;
  arm64)  build_one arm64 ;;
  both)   build_one x86_64; build_one arm64 ;;
  *) die "用法: build-wb.sh [x86_64|arm64|both]" ;;
esac
say "全部完成。部署验证: adb forward tcp:43080 tcp:3080 后 curl http://127.0.0.1:43080/dsht-rp/rp/build-info 看 fixTag 与 sentinel"
