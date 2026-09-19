#!/system/bin/sh
# list-device-sessions.sh —— 把「设备会话文件清单」写到已知路径（供 PC 侧探针读取）
# ============================================================================
# ## 为什么要「设备侧生成清单、PC 侧只读结果」
# 若在 PC 侧拼 `adb shell run-as <pkg> sh -c "cd … && find …"`，命令要过
# **PowerShell → adb → 设备 sh → run-as → sh -c** 多层转发。实测（第二十八轮 W26）：
#   · 同一命令在「设备脚本内执行」得 **29** 条（正确）；
#   · 经 node→adb 传入选 **87** 条，且混入 `data_mirror/data_ce/null/0/<pkg>/…`
#     （CE 存储 bind mount 的**镜像路径**）⇒ 镜像路径 `cat` 失败 ⇒ 正控通过 0
#     ⇒ 上层探针照样打印「命中 0 张」，**看起来完全正常**；
#   · `-maxdepth` 在转发后还会整体失效（静默返回 0 条，同样「看起来正常」）。
# ⇒ 结论（通用纪律）：**判据不得自己构造被转发多层的命令** —— 把命令构造固定在
#   **只经一层解析**的载体里（本脚本），判据只读结果。
#
# 用法（PC 侧）：
#   adb push scripts/list-device-sessions.sh /data/local/tmp/
#   adb shell "run-as com.dshtavern.app sh /data/local/tmp/list-device-sessions.sh"
#   adb exec-out run-as com.dshtavern.app cat files/dsht-session-list.txt
# 输出：绝对路径清单，末行 `COUNT=<n>`（供上层做「清单未被截断」的自证）
PKG_DIR=/data/data/com.dshtavern.app/files
OUT=$PKG_DIR/dsht-session-list.txt
cd "$PKG_DIR/.dsh/sessions" 2>/dev/null || { echo "FATAL cd" > "$OUT"; exit 1; }
# -maxdepth 3：真实结构是 ./<workspace>/<sessionId>/session*.jsonl
# grep -v data_mirror：双保险（防镜像目录被递归进来）
find . -maxdepth 3 -name 'session*.jsonl' 2>/dev/null \
  | grep -v data_mirror \
  | sed "s|^\./|$PKG_DIR/.dsh/sessions/|" > "$OUT"
echo "COUNT=$(wc -l < "$OUT")" >> "$OUT"
