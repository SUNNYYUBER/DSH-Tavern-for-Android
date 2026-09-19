#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""w26-probe-collision-negctl.py — 判据四的**真实仓库负控**（不是合成用例）

判据四（marker 子串碰撞）的 selftest 用的是合成 marker 列表。本探针证明它对**真实文件**
有杠杆：把 `patch-resilient-list.mjs` 的 `IMPORT_MARK` 临时改回**旧名**
（`DSHT-RESILIENT-IMPORT` → `DSHT-RESILIENT-LIST-IMPORT`，即 W26 修复前的形态），
跑判据四 —— 必须报红；随后**逐字节恢复**并复核恢复成功。

判据四若无杠杆，本探针会在「改回旧名后仍报绿」处失败。
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
TARGET = os.path.join(SCRIPTS, "patch-resilient-list.mjs")
AUDIT = os.path.join(SCRIPTS, "audit-build-path-parity.py")

with io.open(TARGET, "r", encoding="utf-8", newline="") as f:
    original = f.read()

NEW = "const IMPORT_MARK = 'DSHT-RESILIENT-IMPORT'"
OLD = "const IMPORT_MARK = 'DSHT-RESILIENT-LIST-IMPORT'"
if NEW not in original:
    print("✗ 探针前提不成立：未找到 %r（脚本形态变了？）" % NEW)
    sys.exit(2)


def run_audit():
    p = subprocess.run([sys.executable, AUDIT], capture_output=True, text=True, encoding="utf-8", errors="replace")
    line = ""
    for ln in (p.stdout or "").split("\n"):
        if "子串碰撞" in ln:
            line = ln.strip()
            break
    # 【2026-09-16 W28 修 · P-19 家族：判据的判据用错了口径】
    # 首版正控条件写 `rc0 == 0`（**整条审计脚本**的退出码）。而该脚本有**五**条判据 ——
    # 任何一条**无关**判据报红（实测：判据五「.ps1 缺 BOM」因我编辑时被剥掉而报红）
    # 都会让本负控 FAIL，**而它的杠杆其实是好的**（`0 对 → 1 对` 清清楚楚）。
    # ⇒ 修法：正控只看**被检的那一条判据自己的读数**（本函数已抽出该行），
    #    不看整条脚本的退出码 —— 本负控要证明的是「这条判据有杠杆」，
    #    不是「整仓此刻全绿」（那是 Step 0.5 的职责，不是这里的）。
    count = None
    m = re.search(r"碰撞\s+(\d+)\s*对", line)
    if m:
        count = int(m.group(1))
    return count, line


def restore():
    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(original)
    with io.open(TARGET, "r", encoding="utf-8", newline="") as f:
        return f.read() == original


try:
    n0, ln0 = run_audit()
    # 改回旧名（= W26 修复前的真实形态）
    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(original.replace(NEW, OLD))
    n1, ln1 = run_audit()
finally:
    ok_restore = restore()

print("=== 判据四 真实仓库负控 ===")
print("[正控] 改名后（现状）  碰撞=%s  %s" % (n0, ln0))
print("[负控] 改回旧名后      碰撞=%s  %s" % (n1, ln1))
print("[恢复] 文件已逐字节还原 = %s" % ok_restore)
print()
# 杠杆 = 「现状 0 对」且「改回旧名后 >0 对」且「逐字节还原成功」
# （读数抽不到 ⇒ None ⇒ 判 FAIL，不许把「没读到」当成 0）
good = (n0 == 0) and (n1 is not None and n1 > 0) and ok_restore
print("结论：判据四对真实仓库有杠杆 = %s" % good)
# ★ W48：接入单源自证分数输出契约（Python 侧）。
#   本装置是「有杠杆 / 无杠杆」型负控 ⇒ 分数是 **1/1 或 0/1**（**不是**「N 项检查」）——
#   但**仍必须**接入契约，否则文档里它的分数声明**无法被机器证伪**（P-45 的覆盖盲区）。
report_selftest('marker-collision-negctl', 1 if good else 0, 1)
sys.exit(0 if good else 1)
