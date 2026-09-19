#!/usr/bin/env python3
"""selftest_summary.py —— **判据装置自证分数的「单源输出契约」（Python 侧）**（P-1 / W44 / W48）

## 为什么需要它（W48 暴露的 W44 覆盖盲区）
W44 建立了「自证分数行的唯一产出点」契约（`scripts/selftest-summary.mjs`），
但**只覆盖了 `.mjs` 闸门** —— 实测本仓 **5 个构建期 Python 闸门**全部在契约外：
    `audit-build-path-parity.py` / `audit-patch-markers.py` /
    `audit-marker-collision-negctl.py` / `audit-py-patch-idem-negctl.py` /
    `verify-apk-payload.py`
⇒ 它们的自证分数**机器读不出** ⇒ 文档里写的分数声明**无法被证伪**
（正是 W44 要消灭的那类失效）。★ 这是 **P-45** 的又一形态：
「扫描面（`.mjs`）与真目标（**所有**闸门）错位」。

## 契约（与 JS 侧**逐字一致** —— 守 P-1：同一语义一处读法）
    [selftest-summary] <name> <pass>/<total> PASS|FAIL
★ 格式串在本文件是**唯一**产出点（Python 侧），各 `.py` 闸门不得手抄。
★ `pass == total` ⟺ `PASS`（不许错位）。

## 诚实边界（R7）
  只管**输出格式**，不管「判据内容是否有效」（后者靠正负控与杠杆，P-30）。

用法：
    from selftest_summary import report_selftest
    ok = report_selftest('build-path-parity', passed, total)
    sys.exit(0 if ok else 3)
"""
import os
import sys

# ★ 与 `selftest-summary.mjs` 的 `SELFTEST_LINE_RE` **同构**（守 P-1）。
#   任何一边改格式，另一边必须同改 —— 故两边都注明「这是契约的一部分」。
SELFTEST_LINE = '[selftest-summary] {name} {pass_}/{total} {verdict}'


def report_selftest(name, pass_, total, extra=None):
    """打印统一的自证收尾行，返回 `pass_ == total`（调用方据此定退出码）。

    `extra` 会**另起一行**打印（人读的补充，绝不能塞进分数行 —— 否则机器正则要跟着长）。
    """
    ok = int(pass_) == int(total)
    if extra:
        print(extra)
    # ★ 分数行必须是**最后一行**（让「取最后一行」的朴素读法也能用）
    print('\n' + SELFTEST_LINE.format(name=name, pass_=pass_, total=total,
                                      verdict='PASS' if ok else 'FAIL'))
    return ok


if __name__ == '__main__':
    # 允许直接跑 `python selftest_summary.py --selftest` 做**自身的**前提断言
    if '--selftest' in sys.argv:
        _t, _f = 0, []

        def _t_(nm, cond):
            global _t
            _t += 1
            print('  %s  %s' % ('PASS' if cond else 'FAIL', nm))
            if not cond:
                _f.append(nm)

        _t_('格式串与 JS 侧同构（含 [selftest-summary] 前缀与 N/M 形态）',
            SELFTEST_LINE.startswith('[selftest-summary] ') and '{pass_}/{total}' in SELFTEST_LINE)
        _t_('pass==total ⇒ 返回 True', report_selftest('probe-ok', 3, 3) is True)
        _t_('pass<total ⇒ 返回 False', report_selftest('probe-bad', 2, 3) is False)
        sys.exit(0 if not _f else 3)
