#!/system/bin/sh
# ef-latency-device.sh —— W11 设备侧计时（由 ef-latency-probe.mjs 推入执行）
#
# ## 装置纪律（本轮全部踩过，逐条记下 —— P-30）
#   1. **不在设备侧用 heredoc**：toybox sh 的 `cat > f <<'EOF'` 要写
#      `/data/local/shXXXX.tmp` ⇒ run-as **无权限** ⇒ 文件没生成、后续报
#      `can't create temporary file`。⇒ JS 探针**由 PC 侧 push**，本脚本只负责跑。
#   2. **不用设备上的 libbusybox.so 当工具**：实测该文件仅 **4208 字节**（是个壳），
#      任何 applet 都返回 `applet not found`（连 `echo` 都不行）⇒ 用**系统自带** `cp`/`du`/`find`。
#   3. **libnode.so 必须带 LD_LIBRARY_PATH**（`$NLD:$RTLIB`），否则 `libz.so.1 not found`。
#   4. **cache 路径是 `/data/data/<pkg>/cache`** —— 少一层 `data` 会让所有写文件失败。
#   5. **`cmd | head` 会让 `$?` 变成 head 的退出码** ⇒ 计时段的成败另用落盘输出判断。
PKG=com.dshtavern.app
F=/data/data/$PKG/files
RT=$F/dsh-runtime
RTLIB=$RT/lib
CACHE=/data/data/$PKG/cache
SESS=$F/.dsh/sessions
NLD=$(dirname $(pm path $PKG | head -1 | sed 's/^package://'))/lib/x86_64

export LD_LIBRARY_PATH="$NLD:$RTLIB"
export PROOT_TMP_DIR="$CACHE"
export TMPDIR="$CACHE"
export HOME="$F"

echo "### SECTION:meta"
# JS 探针由 PC 侧 push 到 /data/local/tmp（见装置纪律 1），此处**拷进 cache** 再跑 ——
# run-as 下从 /data/local/tmp 直接读并不可靠（权限面不同），拷进应用私有目录最稳。
cp /data/local/tmp/ef-latency-parse.js "$CACHE/" 2>/dev/null
cp /data/local/tmp/ef-latency-regex.js "$CACHE/" 2>/dev/null
echo "probe_js_ready=$([ -f "$CACHE/ef-latency-parse.js" ] && echo yes || echo NO)"
echo "runtime_files=$(find $RT -type f 2>/dev/null | wc -l)"
echo "runtime_kb=$(du -sk $RT 2>/dev/null | cut -f1)"
echo "sessions=$(find $SESS -name 'session*.jsonl' 2>/dev/null | wc -l)"
echo "cache_writable=$([ -w "$CACHE" ] && echo yes || echo NO)"

echo "### SECTION:extract"
# ① 首启解压等价工作量：node_modules 树完整复制（同阶写文件数 + I/O）
rm -rf "$CACHE/ef-extract" 2>/dev/null
mkdir -p "$CACHE/ef-extract" 2>/dev/null
T0=$(date +%s%N)
cp -a "$RT/node_modules" "$CACHE/ef-extract/" 2>/dev/null
T1=$(date +%s%N)
echo "copy_ms=$(( (T1 - T0) / 1000000 ))"
echo "copied_files=$(find "$CACHE/ef-extract" -type f 2>/dev/null | wc -l)"
echo "copied_kb=$(du -sk "$CACHE/ef-extract" 2>/dev/null | cut -f1)"
rm -rf "$CACHE/ef-extract" 2>/dev/null

echo "### SECTION:sessionparse"
BIG=$(find "$SESS" -name 'session*.jsonl' -exec ls -S {} + 2>/dev/null | head -1)
echo "biggest=$(basename "$(dirname "$BIG")")/$(basename "$BIG")"
echo "biggest_bytes=$(wc -c < "$BIG" 2>/dev/null)"
"$NLD/libnode.so" "$CACHE/ef-latency-parse.js" "$BIG" 2>&1 | tail -2

echo "### SECTION:regexscan"
"$NLD/libnode.so" "$CACHE/ef-latency-regex.js" "$BIG" 2>&1 | tail -2

echo "### SECTION:installed"
ls -la "$RT"/.installed-v* 2>/dev/null | tail -1
echo "### END"
