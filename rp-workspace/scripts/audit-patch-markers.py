#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit-patch-markers.py — 审计 apply-platform-patches.py 的**幂等 marker 缺陷**
=================================================================================
规则：patch(path, marker, pattern, repl, expected, label) 中，
      **marker 必须出现在 repl 里**，否则补丁打上之后 marker_hits 恒为 0
      → 幂等检测永久失效：--check 永远报失败，重复 apply 会尝试二次替换。

用法：python audit-patch-markers.py
"""
import ast
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "apply-platform-patches.py")

with io.open(SRC, "r", encoding="utf-8") as f:
    src = f.read()
tree = ast.parse(src)

# 收集模块级常量字符串（如 SH_EXPR），供 Name 节点求值
consts = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        try:
            consts[node.targets[0].id] = ast.literal_eval(node.value)
        except Exception:
            pass


def ev(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return consts.get(node.id, "<%s>" % node.id)
    if isinstance(node, ast.JoinedStr):
        out = ""
        for v in node.values:
            if isinstance(v, ast.Constant):
                out += str(v.value)
            else:
                out += "{expr}"
        return out
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        a, b = ev(node.left), ev(node.right)
        return None if a is None or b is None else a + b
    return None


bad, total = [], 0
for node in ast.walk(tree):
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "patch"):
        continue
    if len(node.args) < 6:
        continue
    total += 1
    marker = ev(node.args[1])
    repl = ev(node.args[3])
    label = ev(node.args[5])
    if not isinstance(marker, str) or not isinstance(repl, str):
        bad.append((label, marker, "<无法静态求值>"))
        continue
    if marker not in repl:
        bad.append((label, marker, None))

print("patch() 调用总数: %d" % total)
if not bad:
    print("✓ 全部 marker 都出现在替换串中，幂等检测健全")
    sys.exit(0)
print("✗ 发现 %d 处 marker 缺陷（打补丁后无法被识别为已打）：" % len(bad))
for label, marker, note in bad:
    print("  · %-52s marker=%r %s" % (label, marker, note or "(不在 repl 中)"))
sys.exit(1)
