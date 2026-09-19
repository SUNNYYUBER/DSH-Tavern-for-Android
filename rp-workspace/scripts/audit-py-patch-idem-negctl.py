#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""w26-probe-py-idem-negctl.py — 判据三（python 侧）的**真实仓库负控**

把 `apply-platform-patches.py` 里某个 `patch()` 调用的 repl 临时去掉 marker
（`P1-4a terminal-bash DEFAULT_BASH_SHell` 那条，repl 里带 `/* DSHT-ANDROID-TERM-SHELL */`），
跑判据 —— 必须报红；随后**逐字节恢复**并复核。

若判据三（python 侧）无杠杆，本探针会在「去掉 marker 后仍报绿」处失败。
"""
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(HERE)
SCRIPTS = os.path.join(WS, "scripts")
# ★ W48：单源自证分数输出契约（Python 侧）
sys.path.insert(0, SCRIPTS)
from selftest_summary import report_selftest  # noqa: E402
TARGET = os.path.join(SCRIPTS, "apply-platform-patches.py")
AUDIT = os.path.join(SCRIPTS, "audit-build-path-parity.py")

with io.open(TARGET, "r", encoding="utf-8", newline="") as f:
    original = f.read()

KEEP = 'const DEFAULT_BASH_SHELL = process.platform === "android" ? "/system/bin/sh" : "/bin/bash"; /* DSHT-ANDROID-TERM-SHELL */'
STRIP = 'const DEFAULT_BASH_SHELL = process.platform === "android" ? "/system/bin/sh" : "/bin/bash";'
if KEEP not in original:
    print("✗ 探针前提不成立：未找到待改动行（脚本形态变了？）")
    sys.exit(2)


def run_audit():
    p = subprocess.run([sys.executable, AUDIT], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    line = ""
    for ln in (p.stdout or "").split("\n"):
        if "python patch()" in ln:
            line = ln.strip()
            break
    # 【2026-09-16 W28 修 · 同 audit-marker-collision-negctl.py 的坑】
    # 首版正控用**整条审计脚本**的退出码 ⇒ 任何一条**无关**判据报红（实测：判据五
    # 「.ps1 缺 BOM」）都会让本负控 FAIL，**而它的杠杆是好的**（`0 处 → 1 处`）。
    # ⇒ 正控只看**被检判据自己的读数**（本函数已抽该行）。
    # 读数抽不到 ⇒ None ⇒ 判 FAIL（不许把「没读到」当成 0）。
    n = None
    m = re.search(r"不自洽\s+(\d+)\s*处", line)
    if m:
        n = int(m.group(1))
    return n, line


def restore():
    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(original)
    with io.open(TARGET, "r", encoding="utf-8", newline="") as f:
        return f.read() == original


try:
    n0, ln0 = run_audit()
    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(original.replace(KEEP, STRIP))
    n1, ln1 = run_audit()
finally:
    ok_restore = restore()

print("=== 判据三(python 侧) 真实仓库负控 ===")
print("[正控] 现状          不自洽=%s  %s" % (n0, ln0))
print("[负控] 去掉 marker   不自洽=%s  %s" % (n1, ln1))
print("[恢复] 文件已逐字节还原 = %s" % ok_restore)
print()
# 杠杆 = 「现状 0 处」且「去掉 marker 后 >0 处」且「逐字节还原成功」
# （读数抽不到 ⇒ None ⇒ 判 FAIL，不许把「没读到」当成 0）
good = (n0 == 0) and (n1 is not None and n1 > 0) and ok_restore
print("结论：判据三(python 侧) 对真实仓库有杠杆 = %s" % good)
# ★ W48：接入单源自证分数输出契约（Python 侧）—— 结论型负控 ⇒ 1/1 或 0/1。
report_selftest('py-patch-idem-negctl', 1 if good else 0, 1)
sys.exit(0 if good else 1)
