#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify-session-migration.py — DSH 会话格式迁移验证（阶段 3 核心工具）
=====================================================================
用途：在 DSH 0.1.5 下验证我方 v0 会话能否正确迁移到 v3，并保证内容不丢失。

背景（2026-09-10 实证）：
  · 我方会话 = v0（0.1.2 写入），含 text-chunks 聚合行
  · 0.1.5 目标 = v3（SESSION_FORMAT_VERSION = 3）
  · 迁移链 = v0→v1→v2→v3，由 dsh-session-format-catalog 编排
  · v0→v1 迁移器的 PACKED_TAGS 会展开 text-chunks → 逐事件 assistant/chunk

本工具做两件事：
  A) 静态分析（不需要 DSH）：解析会话文件，统计事件/内容/聚合行，产出"迁移前基线"
  B) 迁移后对比（需要迁移产物）：与基线逐项 diff，确认内容零丢失

用法：
    # 静态基线（迁移前）
    python verify-session-migration.py baseline <session.jsonl> [-o baseline.json]

    # 迁移后对比
    python verify-session-migration.py compare <baseline.json> <migrated.jsonl>

    # 批量（对整个会话目录）
    python verify-session-migration.py scan <sessions_dir>

判定标准（compare）：
    ① 文本总字符数：迁移后 >= 迁移前（迁移只展开不截断）
    ② assistant 消息条数：相等
    ③ user 消息条数：相等
    ④ 版本号：迁移后 == 3
    ⑤ 无 text-chunks 残留（应已展开）
"""
import sys
import os
import json
import re
import glob

PACKED_TAGS = {"text-chunks", "reasoning-chunks", "tool-call-chunks"}


def load_session(path):
    """解析 jsonl 会话文件，返回 (header, events)。聚合行按宿主语义展开。"""
    header = None
    events = []
    packed_rows = 0
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if isinstance(row, dict) and row.get("type") == "session" and header is None:
                header = row
                continue
            # 聚合行展开（复刻 decodeStorageRecord 语义）
            if isinstance(row, dict) and row.get("type") in PACKED_TAGS:
                packed_rows += 1
                events.extend(expand_packed(row))
            else:
                events.append(row)
    return header, events, packed_rows


def expand_packed(row):
    """text-chunks / reasoning-chunks / tool-call-chunks → 逐事件 assistant/chunk。"""
    tag = row.get("type")
    data = row.get("data") or {}
    payload = data.get("args") if tag == "tool-call-chunks" else data.get("texts")
    seq0 = row.get("seq0")
    time0 = row.get("time0")
    if not isinstance(seq0, int) or not isinstance(time0, int) or not isinstance(payload, list):
        return [row]
    dt = data.get("dt") or []
    out = []
    t = time0
    for k, member in enumerate(payload):
        if tag == "tool-call-chunks":
            chunk = {"type": "tool-call-delta", "index": data.get("index"),
                     "id": data.get("id"), "name": data.get("name"), "argumentsDelta": member}
        elif tag == "reasoning-chunks":
            chunk = {"type": "reasoning-delta", "index": data.get("index"), "text": member}
        else:
            chunk = {"type": "text-delta", "index": data.get("index"), "text": member}
        out.append({"type": "assistant/chunk", "seq": seq0 + k, "time": t,
                    "data": {"turn": data.get("turn"), "step": data.get("step"), "chunk": chunk}})
        if k < len(dt):
            try:
                t += int(dt[k]) or 0
            except Exception:
                pass
    return out


def extract_text(ev):
    """从事件中抽取可见文本（尽力而为，覆盖多种形状）。"""
    if not isinstance(ev, dict):
        return ""
    d = ev.get("data")
    if not isinstance(d, dict):
        return ""
    # assistant/message：data.message.content[] 里的 text block
    msg = d.get("message")
    if isinstance(msg, dict):
        blocks = msg.get("content")
        if isinstance(blocks, list):
            return "".join(b.get("text", "") for b in blocks
                           if isinstance(b, dict) and b.get("type") == "text")
    # user/message：data.content[]
    blocks = d.get("content")
    if isinstance(blocks, list):
        return "".join(b.get("text", "") for b in blocks
                       if isinstance(b, dict) and b.get("type") == "text")
    # assistant/chunk：chunk.text
    c = d.get("chunk")
    if isinstance(c, dict):
        return c.get("text", "") or ""
    return ""


def analyze(path):
    """产出一个会话的统计画像。"""
    header, events, packed = load_session(path)
    types = {}
    text_total = 0
    assistant_msgs = 0
    user_msgs = 0
    for ev in events:
        t = ev.get("type") if isinstance(ev, dict) else None
        if t:
            types[t] = types.get(t, 0) + 1
        text_total += len(extract_text(ev))
    assistant_msgs = types.get("assistant/message", 0)
    user_msgs = types.get("user/message", 0)
    # seq 连续性
    seqs = [ev.get("seq") for ev in events if isinstance(ev, dict) and isinstance(ev.get("seq"), int)]
    contiguous = all(seqs[i] == seqs[0] + i for i in range(len(seqs))) if seqs else True
    return {
        "path": path,
        "size": os.path.getsize(path),
        "version": (header or {}).get("version"),
        "sessionId": (header or {}).get("id"),
        "lines": len(events),
        "packedRows": packed,
        "eventTypes": types,
        "textChars": text_total,
        "assistantMessages": assistant_msgs,
        "userMessages": user_msgs,
        "seqContiguous": contiguous,
        "seqFirst": seqs[0] if seqs else None,
        "seqLast": seqs[-1] if seqs else None,
        "unexpandedPacked": packed,
    }


def cmd_baseline(args):
    path = args[0]
    out = None
    if "-o" in args:
        out = args[args.index("-o") + 1]
    prof = analyze(path)
    print("=" * 68)
    print("会话基线：%s" % path)
    print("=" * 68)
    print("  版本       : v%s" % prof["version"])
    print("  会话 ID    : %s" % prof["sessionId"])
    print("  文件大小   : %d 字节" % prof["size"])
    print("  事件数     : %d" % prof["lines"])
    print("  聚合行数   : %d（已展开计入事件数）" % prof["packedRows"])
    print("  文本字符   : %d" % prof["textChars"])
    print("  assistant  : %d 条消息" % prof["assistantMessages"])
    print("  user       : %d 条消息" % prof["userMessages"])
    print("  seq 连续   : %s（%s..%s）" % (prof["seqContiguous"], prof["seqFirst"], prof["seqLast"]))
    print()
    print("  事件类型分布：")
    for k, v in sorted(prof["eventTypes"].items(), key=lambda x: -x[1]):
        mark = "  ← 聚合格式（迁移时应展开）" if k in PACKED_TAGS else ""
        print("    %-28s %d%s" % (k, v, mark))
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, indent=2)
        print()
        print("  基线已保存：%s" % out)
    return prof


def cmd_compare(args):
    base_path, migrated_path = args[0], args[1]
    base = json.load(open(base_path, encoding="utf-8"))
    mig = analyze(migrated_path)
    print("=" * 68)
    print("迁移对比")
    print("=" * 68)
    print("  基线   : %s" % base["path"])
    print("  迁移后 : %s" % mig["path"])
    print()
    checks = []

    def chk(name, ok, detail):
        checks.append((name, ok, detail))
        print("  %s %-34s %s" % ("✓" if ok else "✗", name, detail))

    chk("版本 = 3", mig["version"] == 3, "v%s" % mig["version"])
    chk("文本未丢失", mig["textChars"] >= base["textChars"],
        "%d → %d (Δ%+d)" % (base["textChars"], mig["textChars"], mig["textChars"] - base["textChars"]))
    chk("assistant 消息数一致", mig["assistantMessages"] == base["assistantMessages"],
        "%d → %d" % (base["assistantMessages"], mig["assistantMessages"]))
    chk("user 消息数一致", mig["userMessages"] == base["userMessages"],
        "%d → %d" % (base["userMessages"], mig["userMessages"]))
    chk("聚合行已展开", mig["unexpandedPacked"] == 0,
        "残留 %d 行" % mig["unexpandedPacked"])
    chk("seq 连续", mig["seqContiguous"], "%s..%s" % (mig["seqFirst"], mig["seqLast"]))

    print()
    failed = [c for c in checks if not c[1]]
    if failed:
        print("  ⚠️  %d 项未通过 —— 迁移有问题，需排查" % len(failed))
        return 1
    print("  ✓ 全部通过 —— 迁移正确，内容零丢失")
    return 0


def cmd_scan(args):
    d = args[0]
    files = sorted(glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True))
    print("=" * 68)
    print("批量扫描：%s（%d 个会话）" % (d, len(files)))
    print("=" * 68)
    rows = []
    for p in files:
        try:
            prof = analyze(p)
            rows.append(prof)
        except Exception as e:
            print("  ✗ %s：%s" % (p, e))
    rows.sort(key=lambda r: -r["size"])
    print("  %-46s %6s %8s %8s" % ("会话", "ver", "事件", "字符"))
    for r in rows:
        print("  %-46s %6s %8d %8d" % (os.path.basename(os.path.dirname(r["path"]))[:46],
                                       "v%s" % r["version"], r["lines"], r["textChars"]))
    print()
    print("  合计：%d 个会话，%d 事件，%d 字符" %
          (len(rows), sum(r["lines"] for r in rows), sum(r["textChars"] for r in rows)))
    packed_total = sum(r["packedRows"] for r in rows)
    print("  聚合行合计：%d（迁移时会被展开）" % packed_total)
    return 0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    args = sys.argv[2:]
    if cmd == "baseline":
        cmd_baseline(args)
        return 0
    if cmd == "compare":
        return cmd_compare(args)
    if cmd == "scan":
        return cmd_scan(args)
    print("未知命令：%s" % cmd)
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
