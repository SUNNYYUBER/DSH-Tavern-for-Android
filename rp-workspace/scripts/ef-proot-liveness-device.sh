#!/system/bin/sh
# ef-proot-liveness-device.sh —— L4 proot 生存性：设备侧取证（由 ef-proot-liveness.mjs 推入执行）
#
# 【为什么把命令构造固定在设备侧脚本里】（承 §6.23 装置坑⑤）
# 经 `adb shell → run-as → sh -c "…"` 转发多层引号时，`for` 循环/`$(…)`/`export` 会被
# 逐层吞掉（实测：`syntax error: unexpected 'do'`、env 未生效导致 `libtalloc.so.2 not found`）。
# ⇒ 本脚本在**设备侧**构造命令（只经一层 sh 解析），上层只读它的输出。
PKG=com.dshtavern.app
PKG_DIR=/data/data/$PKG
F=$PKG_DIR/files
RT=$F/dsh-runtime
RTLIB=$RT/lib
ROOTFS=$F/proot-rootfs
CACHE=$PKG_DIR/cache
NLD=$(dirname $(pm path $PKG | head -1 | sed 's/^package://'))/lib/x86_64
PROBE_JS=$CACHE/ef-proot-probe.js

export LD_LIBRARY_PATH="$NLD:$RTLIB"
export PROOT_LOADER="$RTLIB/proot-loader"
export PROOT_TMP_DIR="$CACHE"
export DSHT_PROOT_BIN="$NLD/libproot.so"
export DSHT_PROOT_ROOTFS="$ROOTFS"
export DSHT_NATIVE_LIB_DIR="$NLD"
export DSHT_RUNTIME_LIB_DIR="$RTLIB"
export TMPDIR="$CACHE"
export HOME="$F"

echo "### SECTION:premise"
for f in libproot.so libbusybox.so libnode.so; do
  if [ -f "$NLD/$f" ]; then echo "OK $f"; else echo "MISS $f"; fi
done
if [ -f "$RTLIB/proot-loader" ]; then echo "OK proot-loader"; else echo "MISS proot-loader"; fi
echo "NLD=$NLD"

echo "### SECTION:probe"
cat > "$PROBE_JS" <<'JSEOF'
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const bin = process.env.DSHT_PROOT_BIN, rootfs = process.env.DSHT_PROOT_ROOTFS;
const binds = [];
for (const p of ["/proc","/dev","/system/bin/linker64","/apex/com.android.runtime","/system/lib64","/sdcard","/storage/emulated",
                 process.env.DSHT_NATIVE_LIB_DIR, process.env.DSHT_RUNTIME_LIB_DIR, process.env.TMPDIR])
  if (p && existsSync(p) && !binds.includes(p)) binds.push(p);
const dropped = ["/proc","/dev","/system/bin/linker64","/apex/com.android.runtime","/system/lib64","/sdcard","/storage/emulated"].filter(p => !existsSync(p));
const probe = spawnSync(bin, ["--kill-on-exit","-r",rootfs,...binds.flatMap(b=>["-b",b]),"/bin/true"], { timeout: 10000 });
console.log("BINDS=" + binds.length + " DROPPED=" + JSON.stringify(dropped) + " STATUS=" + probe.status);
JSEOF
"$NLD/libnode.so" "$PROBE_JS" 2>&1 | tail -3

echo "### SECTION:guest"
"$NLD/libproot.so" --kill-on-exit -r "$ROOTFS" \
  -b /proc -b /dev -b /system/bin/linker64 -b /apex/com.android.runtime -b /system/lib64 \
  -b "$NLD" -b "$RTLIB" -b "$CACHE" \
  /bin/busybox echo PROOT-GUEST-OK 2>&1 | tail -2
echo "GUEST_EXIT=$?"

echo "### SECTION:logcat"
logcat -d -t 3000 2>/dev/null | grep -c "proot probe failed" | sed 's/^/probe_failed_warns=/'
echo "### END"
