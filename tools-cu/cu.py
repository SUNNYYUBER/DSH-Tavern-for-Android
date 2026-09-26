#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cu.py —— Windows 桌面级 computer-use CLI（重建版，体检 2026-09-26 · P1-4）
================================================================================

【重建背景（D-01 资产流失）】原版建于 2026-09-10（.workbuddy/memory/2026-09-10.md:379），
13 个子命令实测可用；后被「搬到仓库外」清单移出仓库 —— 当时判据是
「无脚本引用 ⇒ 可搬离」，漏判了文档引用；且**从未进过 git 对象库**
（`git rev-list --all --objects | grep tools-cu` 无输出），`git checkout` 无法找回。
本轮按 D 组报告（docs/HEALTHCHECK-D-ASSET-DRIFT-2026-09-26.md P1-1 建议）重建并入库。

【用途】DSHT×TT 全自动实机测试的「桌面级兜底」：任意窗口的鼠标/键盘操作 +
截图取证。与 adb（安卓模拟器面）、playwright（Web 面）互补。

【依赖】pyautogui（实测 0.9.54 可用）+ Pillow。安装：`pip install pyautogui pillow`

【安全设计（沿原版）】
  · FAILSAFE=True：鼠标推到屏幕左上角 (0,0) 立即抛 FailSafeException 急停 ——
    脚本失控时的物理逃生通道，**不许关**。
  · `--dry-run`：只打印将执行的动作，不真正动鼠标键盘（供流程演练/CI 校验）。
  · 每条命令只做一件事（组合编排在调用方脚本层，不在本 CLI 内）。

【13 个子命令】（与原版清单逐字对齐）
  screenshot [PATH]            截全屏（默认 tmp/cu-shot.png）
  size                         输出屏幕分辨率 WxH
  pos                          输出当前鼠标位置 X,Y
  move X Y                     移动鼠标（无过渡，瞬时）
  click [X Y] [--button r|m]   单击（默认左键；可先移动）
  dblclick [X Y]               双击（左键）
  drag X Y [--duration S]      按住左键拖拽到 (X,Y)（默认 0.5s）
  scroll AMOUNT                滚动（正=上，负=下；pyautogui「格」单位）
  type TEXT [--interval S]     输入文本（打字间隔默认 0s；只支持 ASCII ——
                               中文经剪贴板另行编排，不属本 CLI）
  key NAME                     单击一个键名（enter/esc/tab/f1…pyautogui 键名表）
  hotkey K1 K2 [...]           组合键（如 ctrl shift t）
  locate IMAGE [--confidence F] 在屏幕上找模板图，输出中心坐标（找不到 exit 1）

用法示例：
  python tools-cu/cu.py --dry-run click 400 300
  python tools-cu/cu.py screenshot tmp/desk.png
  python tools-cu/cu.py locate tmp/btn.png --confidence 0.8
"""

import argparse
import io
import os
import sys

# GBK 控制台的中文输出保护（体检同款环境前置；Windows 控制台默认 cp936）
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import pyautogui

# 安全闸：鼠标推到左上角立即急停（原版同款，不许关）
pyautogui.FAILSAFE = True
# move/click 之间的默认停顿归零（编排层自己控制节奏；原版同款）
pyautogui.PAUSE = 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cu.py",
        description="Windows 桌面级 computer-use CLI（13 子命令；FAILSAFE 急停常开）",
    )
    p.add_argument("--dry-run", action="store_true", help="只打印将执行的动作，不真正执行")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("screenshot", help="截全屏")
    sp.add_argument("path", nargs="?", default="tmp/cu-shot.png")

    sub.add_parser("size", help="屏幕分辨率")
    sub.add_parser("pos", help="当前鼠标位置")

    mp = sub.add_parser("move", help="移动鼠标")
    mp.add_argument("x", type=int)
    mp.add_argument("y", type=int)

    cp = sub.add_parser("click", help="单击（可选先移动）")
    cp.add_argument("xy", nargs="*", type=int)
    cp.add_argument("--button", choices=["left", "right", "middle"], default="left")

    dp = sub.add_parser("dblclick", help="双击（可选先移动）")
    dp.add_argument("xy", nargs="*", type=int)

    gp = sub.add_parser("drag", help="按住左键拖拽到目标点")
    gp.add_argument("x", type=int)
    gp.add_argument("y", type=int)
    gp.add_argument("--duration", type=float, default=0.5)

    sc = sub.add_parser("scroll", help="滚动（正=上/负=下）")
    sc.add_argument("amount", type=int)

    tp = sub.add_parser("type", help="输入 ASCII 文本")
    tp.add_argument("text")
    tp.add_argument("--interval", type=float, default=0.0)

    kp = sub.add_parser("key", help="单击一个键名")
    kp.add_argument("name")

    hp = sub.add_parser("hotkey", help="组合键（2+ 个键名）")
    hp.add_argument("names", nargs="+")

    lp = sub.add_parser("locate", help="屏幕上找模板图")
    lp.add_argument("image")
    lp.add_argument("--confidence", type=float, default=0.9)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    dry = args.dry_run
    tag = "[dry-run] " if dry else ""

    if args.cmd == "screenshot":
        print(f"{tag}screenshot → {args.path}")
        if not dry:
            pyautogui.screenshot(args.path)
        return 0

    if args.cmd == "size":
        w, h = pyautogui.size()
        print(f"{w}x{h}")
        return 0

    if args.cmd == "pos":
        x, y = pyautogui.position()
        print(f"{x},{y}")
        return 0

    if args.cmd == "move":
        print(f"{tag}move → ({args.x},{args.y})")
        if not dry:
            pyautogui.moveTo(args.x, args.y)
        return 0

    if args.cmd in ("click", "dblclick"):
        where = f" @ ({args.xy[0]},{args.xy[1]})" if len(args.xy) == 2 else "（当前位置）"
        action = "dblclick" if args.cmd == "dblclick" else f"click({args.button})"
        print(f"{tag}{action}{where}")
        if dry:
            return 0
        if len(args.xy) == 2:
            pyautogui.moveTo(args.xy[0], args.xy[1])
        (pyautogui.doubleClick if args.cmd == "dblclick" else pyautogui.click)(button=args.button)
        return 0

    if args.cmd == "drag":
        print(f"{tag}drag → ({args.x},{args.y}) duration={args.duration}s")
        if not dry:
            pyautogui.dragTo(args.x, args.y, duration=args.duration, button="left")
        return 0

    if args.cmd == "scroll":
        print(f"{tag}scroll {args.amount}")
        if not dry:
            pyautogui.scroll(args.amount)
        return 0

    if args.cmd == "type":
        print(f"{tag}type {args.text!r} interval={args.interval}")
        if not dry:
            pyautogui.write(args.text, interval=args.interval)
        return 0

    if args.cmd == "key":
        print(f"{tag}key {args.name}")
        if not dry:
            pyautogui.press(args.name)
        return 0

    if args.cmd == "hotkey":
        print(f"{tag}hotkey {'+'.join(args.names)}")
        if not dry:
            pyautogui.hotkey(*args.names)
        return 0

    if args.cmd == "locate":
        print(f"{tag}locate {args.image} confidence={args.confidence}")
        if dry:
            return 0
        box = pyautogui.locateOnScreen(args.image, confidence=args.confidence)
        if box is None:
            print("NOT FOUND", file=sys.stderr)
            return 1
        cx, cy = pyautogui.center(box)
        print(f"{cx},{cy}")
        return 0

    return 2  # 不可达（argparse 已拦）


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[中断]", file=sys.stderr)
        sys.exit(130)
    except pyautogui.FailSafeException:
        print("\n[FAILSAFE] 鼠标在左上角急停 —— 这是你要求的逃生通道", file=sys.stderr)
        sys.exit(131)
