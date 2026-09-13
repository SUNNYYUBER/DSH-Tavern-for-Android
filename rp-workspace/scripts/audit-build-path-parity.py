#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit-build-path-parity.py — 审计「两条构建路径的补丁集是否等价」（C6 防回归判据）
=================================================================================
【为什么需要它】
  本项目有两条构建路径，各自独立给 DSH runtime 打 Android 补丁：
    · PowerShell：scripts/build-dsht.ps1（Step 3.5 / 4.5 / 4.8）
    · Bash     ：scripts/build-wb.sh → scripts/apply-platform-patches.py
  两条路径**曾经不等价过两次**，且两次都属于「缺陷静默存在、靠巧合掩盖」：
    ① F2 flock：python 有、ps1 无 —— 只走 ps1 完整安装则「任何消息都发不出去」；
    ② F1 rename：python 4 处、ps1 只 2 处 —— 漏掉 0.1.5 的核心 generation 发布路径。
  这类缺陷的共同特征：**当前 runtime 恰好由另一条路径打过补丁，于是两边都"看起来正常"**，
  只有在「换机器 / 完整安装 / 只用另一条路径」时才暴露。故必须有常驻判据。

【判据】提取两侧源码里出现的所有 DSHT-* 补丁 marker，比对集合：
  每个 marker 必须在**两侧都出现**（同串 = 幂等互认）。缺任何一侧即违约。

用法：python audit-build-path-parity.py
退出码：0 = 两侧 marker 集合等价；1 = 有单侧缺失
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PS1 = os.path.join(HERE, "build-dsht.ps1")
PY = os.path.join(HERE, "apply-platform-patches.py")

# marker 形态：DSHT-<大写/数字/->
MARKER_RE = re.compile(r"DSHT-[A-Z0-9][A-Z0-9-]*")

# 允许单侧存在的例外（必须写明理由，否则不得加入）
EXEMPT = {
    # ps1 的 Step 3d「PC 验证前置补丁」——只在 PC 端 android-sim 验证时用，真机不需要
    "DSHT-SIM": "PC 端 android-sim 验证专用，真机构建两侧都可缺（存在即正常）",
    # DSHT-RESILIENT-LIST 走独立脚本 patch-resilient-list.mjs（含硬编码 runtime 路径），
    # 由 build-dsht.ps1 Step 4.85 调用；python 侧未接。已判定：
    #   · 权威构建路径 = build-dsht.ps1（用户实际使用；build-wb.sh 是已被弃用的 WorkBuddy 侧复刻）
    #   · 若将来重新启用 build-wb.sh，必须同步接入该脚本 —— 否则 python 路径产出的 runtime
    #     在坏会话文件（身份漂移/重复 id）面前会 cordis init 崩溃 → boot-loop。
    "DSHT-RESILIENT-LIST": "走独立脚本，仅 ps1 接入；python 路径已弃用（如需复活须同步接入）",
}


def markers(path):
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    found = set()
    for m in MARKER_RE.findall(text):
        # 过滤掉正则片段误命中（如 "DSHT-ANDROID-" 后接引号/空格被截断的）
        if m.endswith("-"):
            continue
        found.add(m)
    return found


def main():
    for p in (PS1, PY):
        if not os.path.exists(p):
            print("✗ 找不到文件：%s" % p)
            return 2

    ps1 = markers(PS1)
    py = markers(PY)

    only_ps1 = sorted(ps1 - py - set(EXEMPT))
    only_py = sorted(py - ps1 - set(EXEMPT))
    both = sorted(ps1 & py)

    print("=== 构建路径补丁集等价性审计 ===")
    print("ps1  marker %d 个 | python marker %d 个 | 共同 %d 个" % (len(ps1), len(py), len(both)))
    if EXEMPT:
        print("豁免（已注明理由）：%s" % ", ".join(sorted(EXEMPT)))
    print()

    if not only_ps1 and not only_py:
        print("✓ 两条路径的补丁 marker 集合等价（%d 个共同 marker）" % len(both))
        print("  共同 marker：%s" % ", ".join(both))
        return 0

    print("✗ 发现补丁集**不等价** —— 只走缺 marker 的那条路径时该补丁会丢失：")
    if only_py:
        print("\n  【python 有、ps1 缺】（ps1 完整安装会缺这些补丁）：")
        for m in only_py:
            print("    · %s" % m)
    if only_ps1:
        print("\n  【ps1 有、python 缺】（python 路径会缺这些补丁）：")
        for m in only_ps1:
            print("    · %s" % m)
    print("\n处置：把缺失的补丁补进对应脚本，或在本脚本 EXEMPT 里写明理由后豁免。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
