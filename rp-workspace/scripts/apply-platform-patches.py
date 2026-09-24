#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply-platform-patches.py — 给 DSH runtime 打 Android 平台补丁
================================================================
build-dsht.ps1 的 Step 3 / 3.5 / 4.5 / 4.8 的 Python 复刻（PowerShell 沙箱禁 node，
build-dsht.ps1 在本环境跑不了，故需此 Bash/Python 可执行版本）。

用法:
    python apply-platform-patches.py [runtime_dir] [--check]

    runtime_dir  默认 dsh-runtime-android（相对 rp-workspace）
    --check      只检查命中情况，不写文件（预检模式）

设计原则（与 build-dsht.ps1 一致）：
  · 幂等 —— 带 marker 检测，已打则跳过
  · 断言 —— 命中数不符即报错（防 DSH 升级后补丁静默失效）
  · 半打检测 —— marker 数 >0 但 <expected 时报错（避免重复替换）
"""
import sys
import os
import re
import json
import hashlib
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(HERE)

# ---------------------------------------------------------------- 参数解析
args = [a for a in sys.argv[1:] if not a.startswith("--")]
CHECK_ONLY = "--check" in sys.argv
DST = args[0] if args else os.path.join(WS, "dsh-runtime-android")
if not os.path.isabs(DST):
    # 【2026-09-11 心跳 44】相对路径解析要能区分「相对仓库根」与「相对 rp-workspace」，
    # 否则 `rp-workspace/dsh-runtime-android` 会被再拼一次 WS →
    # `rp-workspace/rp-workspace/dsh-runtime-android`（与 build-plugins.sh 的 L18 同类缺陷：
    # 路径双前缀，报 FileNotFoundError 而非明确错误）。优先选「已存在」的解析结果。
    _as_is = os.path.abspath(DST)
    _under_ws = os.path.join(WS, DST)
    DST = _as_is if os.path.isdir(_as_is) else _under_ws
NM = os.path.join(DST, "node_modules", "@deepseek-ai")
STUBS = os.path.join(WS, "stubs")

# ---------------------------------------------------------------- 统计
# 【心跳 55】补 two 个计数器，让「已打补丁」与「未打但可打」不再挤在同一个数字里：
#   patched  显式放在文件里的 marker 命中（= 该补丁**确实生效**）
#   pending  锚点命中但 marker 缺失（= **尚未打**，apply 模式会自动补上）
# 背景：原先 `--check` 只报「N 项检查，0 项失败」，而 patch() 的「已打」分支只加 skipped
# 不加 checked → 汇总恒为「0 项检查」。更严重的是**锚点命中即报 ✓**：像 F2（flock，
# 决定"消息能不能发出去"）这类「锚点在补丁前后都存在」的补丁，**标记被抹掉后仍报 ✓ / exit 0**
# —— 闸门把「补丁丢了」读成「一切正常」（本项目的假绿族）。
STATS = {"applied": 0, "skipped": 0, "failed": 0, "checked": 0, "patched": 0, "pending": 0}

# ---------------------------------------------------------------- 锚点指纹（C.4）
# 【为什么需要它（附录 E.7 判据表「C.4 锚点指纹」）】
#   「命中数相同」**不等于**「改的是同一处」。官方可能：
#     · 把锚点所在的那行**语义改了**（例如换个变量名、调整参数顺序）；
#     · 或把该形态**搬到另一个函数**里（处数仍为 1，但改的东西完全不同）。
#   ⇒ 这两类漂移**命中数判据抓不到**（都会报 ✓），只有比对「命中的那段原文」才能发现。
# 口径：对**每一处命中**的原文取 SHA256 前 8 位，排序后拼成该补丁的指纹。
#   用指纹清单（而非单个）是为了区分「1 处变 2 处」这种既是数量也是形态的变化。
# ★ 本文件**只负责采集与打印**；「与上一代基线比对、漂移即报红」由
#   `audit-patch-fingerprints.mjs` 承担 —— 因为本文件跑在**没有历史基线**的构建现场
#   （P-40③：判据必须跑在它所判对象状态确定之后；基线是另一份输入，不该塞进这里）。
ANCHOR_FP = {}


def log(msg):
    print("[patch] " + msg)


def die(msg):
    print("[patch][FATAL] " + msg, file=sys.stderr)
    sys.exit(1)


def anchor_fingerprint(text, pattern):
    """给 pattern 的**每一处命中原文**取 SHA256 前 8 位；返回排序后的元组。

    空（0 处命中）⇒ 返回空元组 —— 调用方据此区分「没命中」与「命中了但内容不同」。
    """
    fps = []
    for m in re.finditer(pattern, text):
        raw = m.group(0).encode("utf-8")
        fps.append(hashlib.sha256(raw).hexdigest()[:8])
    return tuple(sorted(fps))


def patch(path, marker, pattern, repl, expected, label, expected_min=None):
    """精确补丁：marker 幂等检测 + 命中数断言 + 替换。

    path     目标文件绝对路径
    marker   幂等标记（已打补丁时文件中应存在 expected 个）
    pattern  正则（匹配目标代码）
    repl     替换文本（字面量，不走正则反向引用）
    expected 期望命中数（= 该形态在当前代的**全部**处数）
    expected_min  ★ 2026-09-23 阶段 C.3 新增：**可接受的下限**。
             当官方**合并/删除**了产生该形态的宿主方法时，处数会**合法地**变少
             （实例：`dsh-bash-local` 0.1.5 有 `run()`+`start()` 两处，
             0.1.7 合并成单个 `execute()` ⇒ 只剩 1 处）。
             传了它 ⇒ 命中数落在 `[expected_min, expected]` 内都算成功，
             且**替换全部命中**（不是只换 expected 个）—— 语义由「数个数」
             改成「**凡是这个形态的都要改**」（P-41：锚到决定结果的事实）。
             不传 ⇒ 维持原严格相等语义（既有 12 条行为不变）。
    """
    if not os.path.isfile(path):
        log("  ✗ %s：目标不存在 %s" % (label, path))
        STATS["failed"] += 1
        return False

    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()

    lo = expected if expected_min is None else expected_min
    marker_hits = text.count(marker)
    if marker_hits >= lo:
        log("  · %s：已打补丁，跳过" % label)
        STATS["skipped"] += 1
        STATS["patched"] += 1
        # ★ C.4：**已打补丁**时锚点原文已被替换掉 ⇒ 现在读 `pattern` 采不到原锚点。
        #   【设计取舍】改采「**marker 之前**固定 160 字符窗口」的指纹 ——
        #   理由：那一段**完全来自官方产物**（我方替换文本只在 marker 处），
        #   所以它变了 = 官方那一片代码变了 = 正是 C.4 要抓的「锚点漂移」。
        #   ★ 为什么不取 marker **之后**：之后紧跟的是我方注入的表达式，不是官方原文，
        #     取它会把我方模板的改动也算成"漂移"（误报）。
        #   ★ 为什么用「固定窗口」而不是「整行/整函数」：窗口长度固定 ⇒
        #     官方在别处加代码**不会**平移窗口内容（只取紧邻的 N 字符，不含行结构）。
        #
        #   实现：`patch()` 的 marker 由多个调用方拼写，这里用**首个 marker 命中**的位置
        #   往前取窗口。若无命中（理论上不该发生，因为上面刚判过 ≥lo）⇒ 记 `[]` 并出声。
        _pos = text.find(marker)
        if _pos > 0:
            _ctx = text[max(0, _pos - 160):_pos]
            ANCHOR_FP[label] = (hashlib.sha256(_ctx.encode("utf-8")).hexdigest()[:8],)
        else:
            ANCHOR_FP[label] = ()
            log("  ! %s：marker 命中但定位不到位置 ⇒ 指纹记空（C.4 对该项失效）" % label)
        # 【心跳 55 修】「已打补丁」本身就是**一次有效校验**（marker 在 = 该补丁确实生效），
        # 但原实现只加 skipped、不加 checked → `--check` 的汇总恒输出
        # 「0 项检查，0 项失败」：明细行说"检查了 21 项"，汇总说"一项没查"。
        if CHECK_ONLY:
            STATS["checked"] += 1
        return True
    if marker_hits > 0:
        log("  ✗ %s：半打状态（标记 %d/%d）" % (label, marker_hits, expected))
        STATS["failed"] += 1
        return False

    hits = len(re.findall(pattern, text))
    # ★ C.4：未打补丁 ⇒ 直接对**锚点原文**取指纹（这才是最贴近"锚点有没有漂移"的口径）。
    ANCHOR_FP[label] = anchor_fingerprint(text, pattern)
    if CHECK_ONLY:
        ok = lo <= hits <= expected
        STATS["checked"] += 1
        if ok:
            # 锚点命中≠补丁已生效：这类补丁（如 F2 flock）的锚点在补丁前后都存在，
            # 必须**显式**报成「未打」，不能与「已打」共用一个 ✓。
            log("  ⚠ %s：**未打补丁**（锚点命中 %d/%d%s，apply 模式会补上）"
                % (label, hits, expected, ("，下限 %d" % lo) if lo != expected else ""))
            STATS["pending"] += 1
            return True
        log("  ✗ %s：锚点形态不符（期望 %d~%d 处，实际 %d 处）——DSH 升级后产物形态变了？"
            % (label, lo, expected, hits))
        STATS["failed"] += 1
        return False


    if not (lo <= hits <= expected):
        log("  ✗ %s：命中数不符（期望 %d~%d，实际 %d）—— DSH 升级后产物形态变了？"
            % (label, lo, expected, hits))
        STATS["failed"] += 1
        return False

    # 用字面量替换（lambda 形式避免 \1 等反向引用被解释）
    new_text = re.sub(pattern, lambda m: repl, text)

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new_text)
    log("  ✓ %s：%d 处已打补丁" % (label, hits))
    STATS["applied"] += hits
    return True


def write_file(path, content, label):
    """写辅助资产（如 android-fallback.mjs）。"""
    if CHECK_ONLY:
        log("  ? %s：检查模式，跳过写入" % label)
        return True
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    log("  ✓ %s" % label)
    return True


print("=" * 72)
print("DSH Android 平台补丁  [%s]" % ("检查模式" if CHECK_ONLY else "应用模式"))
print("目标: %s" % DST)
print("=" * 72)

# ============================================================ Step 3
print("\n--- Step 3: 平台适配（删 win32/darwin 包 + stubs 六件套 + sim 补丁）---")

# --- 3a. 删 win32/darwin 平台专属包（Android 用不到，且部分含原生二进制）
# 【2026-09-11 心跳 47 修复】3a 原本无条件删所有名字含 win32/darwin 的目录，
# 但 3b **会把自己的 stub 落到 `@deepseek-ai/dsh-win32-process/`** —— 于是每次跑补丁都
# 「删掉自己的 stub → 再原样复制回来」，形成无意义的高频删除churn：
#   · 撞宿主安全删除守卫（`node-safe-delete-shim.cjs`，阈值 50 / scope=turn）→ 构建 FATAL；
#   · 更糟：若删成功而复制失败（或中途被杀），stub 就没了 → `dsh-subprocess-local` 静态导入
#     解析失败 → **整个 plugin tree 崩溃、DSH 起不来**（这正是当初加该 stub 要修的那个故障，
#     补丁自己把它造回来）。
# 处置：删之前先认领「这是不是我们自己落的 stub」——是则跳过（幂等），并断言删完真的不在了。
DSHT_STUB_MARKERS = ("DSHT-ANDROID-", "DSHT-")


def _is_dsht_stub(dirpath):
    """目录内容是否为我们自己落的平台 stub（读候选入口文件找 marker）。"""
    for rel in ("lib/index.js", "index.js", "lib/index.cjs", "index.cjs",
                "dist/index.cjs", "dist/index.mjs", "index.mjs", "lib/runner.js"):
        p = os.path.join(dirpath, rel)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                head = f.read(4096)
        except OSError:
            continue
        if any(m in head for m in DSHT_STUB_MARKERS):
            return True
    return False


if not CHECK_ONLY:
    _removed = 0
    _kept_stub = 0
    for _root, _dirs, _files in os.walk(os.path.join(DST, "node_modules")):
        for _d in list(_dirs):
            if re.search(r"win32|darwin", _d):
                _p = os.path.join(_root, _d)
                if _is_dsht_stub(_p):
                    _kept_stub += 1
                    continue
                shutil.rmtree(_p)
                if os.path.exists(_p):
                    # 【不用 ignore_errors】静默失败正是本项目头号缺陷类：
                    # rmtree 被守卫拦下时会抛异常，被 ignore_errors 吞掉后日志照报"删了 1 个"。
                    die("3a 删除失败（仍存在，疑似被宿主安全删除守卫拦截）：%s" % _p)
                _dirs.remove(_d)
                _removed += 1
    log("  3a 删 win32/darwin 平台包：%d 个；保留自有 stub：%d 个" % (_removed, _kept_stub))
else:
    log("  3a 删 win32/darwin 平台包（检查模式跳过）")

# --- 3b. stubs（坑 #1/#2：stub 是 Android 唯一正解——原生二进制无法在 bionic 加载）
# 【2026-09-21 W-1 变更】node-pty **不再 stub**：改为 NDK 自编译原生模块
#   （实证 bionic libc 原生提供 openpty/forkpty/ptsname，见 docs/PTY-RESEARCH-2026-09-21.md
#   附录 B）。故从 STUB_MAP 移除，改由下方的「上游 JS 恢复 + prebuilds 校验」处理。
#   两条链（ps1 / python）必须等价——audit-build-path-parity 守。
STUB_MAP = [
    ("node-addon-require-builtin/index.js", "node-addon-require-builtin/lib/index.js"),
    ("koffi/index.js", "koffi/index.js"),
    ("koffi/index.cjs", "koffi/index.cjs"),
    ("node-addon-landlock-run/index.js", "@deepseek-ai/node-addon-landlock-run/lib/index.js"),
    ("dsh-sandbox-windows-acl/index.js", "@deepseek-ai/dsh-sandbox-windows-acl/lib/index.js"),
    ("dsh-sandbox-windows-acl/runner.js", "@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js"),
    # 【2026-09-10 心跳 41 新增】0.1.5 的 dsh-subprocess-local 静态导入本包 →
    # pnpm 在非 win32 平台不安装它 → 模块解析失败 → 整个 plugin tree 崩溃（DSH 启动失败）。
    # 这是补齐 stubs 六件套的第 7 件。证据：实机 logcat "does not provide an export named
    # 'loadWin32ProcessBindings'"。
    ("dsh-win32-process/index.js", "@deepseek-ai/dsh-win32-process/lib/index.js"),
]
_stub_ok = 0
for _src_rel, _dst_rel in STUB_MAP:
    _s = os.path.join(STUBS, _src_rel)
    _d = os.path.join(DST, "node_modules", _dst_rel)
    if not os.path.isfile(_s):
        log("  ! 3b stub 源缺失：%s" % _src_rel)
        continue
    if CHECK_ONLY:
        _stub_ok += 1
        continue
    os.makedirs(os.path.dirname(_d), exist_ok=True)
    shutil.copyfile(_s, _d)
    _stub_ok += 1
log("  3b stubs 六件套：%d 项%s" % (_stub_ok, "（待复制）" if CHECK_ONLY else "已落位"))

# --- 3b-2. node-pty 自编译接入（W-1）——上游 JS 恢复 + prebuilds 就位校验
# 【路径注意】node-pty 不在 @deepseek-ai 下（NM 指错会静默判「缺失」）⇒ 用 DST\node_modules
_pty_root = os.path.join(DST, "node_modules", "node-pty")
_pty_lib = os.path.join(_pty_root, "lib", "index.js")
_pty_js_src = os.path.join(WS, "dsh-runtime-src", "node_modules", "node-pty", "lib", "index.js")
if os.path.isfile(_pty_js_src):
    if CHECK_ONLY:
        log("  ✓ 3b-2 node-pty 上游 JS 源就位（待复制）")
    else:
        os.makedirs(os.path.dirname(_pty_lib), exist_ok=True)
        shutil.copyfile(_pty_js_src, _pty_lib)
        log("  ✓ 3b-2 node-pty 上游 JS 已恢复（非 stub）")
else:
    log("  ✗ 3b-2 node-pty 上游 JS 源缺失：%s" % _pty_js_src)
    STATS["failed"] += 1

_pty_missing = []
for _pdir in ("android-arm64", "android-x64"):
    _p = os.path.join(_pty_root, "prebuilds", _pdir, "pty.node")
    if not os.path.isfile(_p):
        _pty_missing.append(_p)
if _pty_missing:
    log("  ✗ 3b-2 node-pty 原生产物缺失（先跑 node scripts/build-node-pty.mjs）：")
    for _p in _pty_missing:
        log("      %s" % _p)
    STATS["failed"] += 1
else:
    log("  ✓ 3b-2 node-pty prebuilds 双架构就位")

# --- 3b-3. sharp wasm 就位校验（W-5）——sharp 不再 stub，改用 @img/sharp-wasm32
# 【为什么】sharp 官方 prebuild 无 android（npm registry 实测缺 @img/sharp-libvips-android-*），
# 而 bionic 与 glibc 不兼容 ⇒ 直接拿 linux prebuild 必炸。
# 但 sharp 主包自带 wasm 兜底分支（dist/sharp.cjs:102-108），装上 wasm 包后自动回退
# ⇒ 图片通道真的可用（实测 19/19 判据）。wasm 与架构无关 ⇒ 单份产物覆盖双架构。
# 两条链（ps1/python）必须等价——audit-build-path-parity.py 守。
_sharp_wasm = os.path.join(DST, "node_modules", "@img", "sharp-wasm32", "package.json")
if os.path.isfile(_sharp_wasm):
    log("  ✓ 3b-3 sharp @img/sharp-wasm32 已就位（W-5 wasm 路线，非 stub）")
else:
    log("  ✗ 3b-3 sharp wasm 包缺失：%s" % _sharp_wasm)
    log("      （runtimeSrc/package.json 应声明 @img/sharp-wasm32；见 build-dsht.ps1 Step 1）")
    STATS["failed"] += 1

# --- 3c. sim 补丁（PC 上伪装 linux 做 android-sim 验证；真机 Android 不受影响）
patch(
    os.path.join(NM, "dsh-storage-json", "lib", "index.js"),
    "DSHT-SIM",
    r'if \(process\.platform === "win32"\) return;',
    'if (process.platform === "win32" || process.env.DSHT_ANDROID_SIM === "1") return; /* DSHT-SIM: Windows 真实 FS 上目录 fsync 报 EPERM，sim 态跳过 */',
    1,
    "sim-1 storage-json fsyncDirectory",
)
patch(
    os.path.join(NM, "dsh-credentials-local", "lib", "index.js"),
    "DSHT-SIM",
    r'if \(process\.platform === "win32"\) return;',
    'if (process.platform === "win32" || process.env.DSHT_ANDROID_SIM === "1") return; /* DSHT-SIM: Windows stat mode 恒 666，sim 态跳过 owner-only 检查 */',
    1,
    "sim-2 credentials-local assertOwnerOnly",
)
patch(
    os.path.join(NM, "dsh-session-persistence-jsonl", "lib", "index.js"),
    "DSHT-SIM",
    r'async syncDirPosix\(dir\) \{',
    'async syncDirPosix(dir) {\n\t\tif (process.env.DSHT_ANDROID_SIM === "1") return; /* DSHT-SIM: Windows 真实 FS 上目录 fsync 报 EPERM，sim 态跳过 */',
    1,
    "sim-3 session-persistence syncDirPosix",
)

# ============================================================ Step 3.5
print("\n--- Step 3.5: Android shell / sandbox / rg 补丁 ---")

SH_EXPR = 'process.platform === "android" ? "/system/bin/sh" : "bash"'

# --- P0-1a  dsh-bash-local run()/start() 的 bash argv（2 处）
# ★ 2026-09-23 DSH 升级轮 · 阶段 C.3：**期望处数按代次变少是合法的**。
#   0.1.5 有 `run()` + `start()` 两个宿主方法（各 1 处 ⇒ 2 命中）；
#   0.1.7 把它们**合并成单个 `execute()`**（实测 `dsh-bash-local@0.1.7-alpha.1`
#   的 `lib/index.js:140-146` 只剩 1 处；`run`/`start` 已不存在）。
#   ⇒ 传 `expected_min=1`：命中落在 [1, 2] 都算成功，且**替换全部命中**。
patch(
    os.path.join(NM, "dsh-bash-local", "lib", "index.js"),
    "DSHT-ANDROID-SH",
    r'\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tspec\.command',
    '\t\t\t' + SH_EXPR + ', /* DSHT-ANDROID-SH */\n\t\t\t"-c",\n\t\t\tspec.command',
    2,
    "P0-1a bash-local run/start argv",
    expected_min=1,
)

# --- P0-1b  dsh-bash-sandbox confine() 的内层 bash argv
# ★ 2026-09-23 DSH 升级轮 · 阶段 C.1：**锚点必须容忍可选的第三参 `signal`**。
#   0.1.7 起官方把 `confine(command, policy)` 扩成 `confine(command, policy, signal)`
#   （实测 `@deepseek-ai/dsh-bash-sandbox@0.1.7-alpha.1` 的 `lib/index.js:161-167`），
#   旧锚点尾部写死 `], policy\);` ⇒ **在 0.1.7 上一条都匹配不到**（实测命中 0，补丁静默丢失）。
#   ⇒ 尾部改为 `\], policy(?:, signal)?\);`：**新旧两代都命中**，
#     且**替换文本保留原参数列表**（用 `\1` 回填，不写死"两参"形态 ——
#     否则会把 0.1.7 的 `, signal` 吃掉，反而制造出"参数少一个"的坏代码）。
#   ★ 纪律：补丁的**替换文本**也必须代次无关，不只是锚点（只改锚点 = 把 0.1.7 改回 0.1.5 形态）。
patch(
    os.path.join(NM, "dsh-bash-sandbox", "lib", "index.js"),
    "DSHT-ANDROID-SH",
    r'\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tcommand\r?\n\t\t\], policy(, signal)?\);',
    '\t\t\t' + SH_EXPR + ', /* DSHT-ANDROID-SH */\n\t\t\t"-c",\n\t\t\tcommand\n\t\t], policy\\1);',
    1,
    "P0-1b bash-sandbox confine argv",
)

# --- P0-2  dsh-sandbox-local confine() 拒绝分支 → android 降级
patch(
    os.path.join(NM, "dsh-sandbox-local", "lib", "index.js"),
    "DSHT-ANDROID-UNSANDBOXED",
    r'\tconst selected = this\.selectRunner\(policy\.mode\);',
    "\tlet selected;\n"
    "\ttry {\n"
    "\t\tselected = this.selectRunner(policy.mode);\n"
    "\t} catch (error) {\n"
    "\t\t/* DSHT-ANDROID-UNSANDBOXED: android 无 bwrap/Landlock/sandbox-exec/ACL 后端——降级语义：不拒绝，warn + 无隔离执行（fs 层做工作区边界） */\n"
    '\t\tif (process.platform === "android" && error !== null && typeof error === "object" && error.name === "SandboxUnavailableError") {\n'
    '\t\t\tconsole.warn("[dsht] sandbox-local: no sandbox backend on android; running unconfined (fs layer enforces the workspace boundary)");\n'
    '\t\t\treturn { argv: [...argv], enforcement: "unusable", denialSignatures: [], runnerFailureRules: [] };\n'
    "\t\t}\n"
    "\t\tthrow error;\n"
    "\t}",
    1,
    "P0-2 sandbox-local android 降级",
)

# --- P0-2b  PRoot 真隔离包装（必须在 P0-2 之后：改写 P0-2 的产物文本）
PROOT_WRAP = '''\t\t\t/* DSHT-ANDROID-PROOT: PRoot 真隔离——proot 用户态 chroot 包装 argv（rootfs+bind 外不可读写）；
\t\t\t   proot 二进制缺失/探测失败时回退下方 warn + fs 边界直通（降级开关） */
\t\t\tconst dshtProotBin = process.env.DSHT_PROOT_BIN;
\t\t\tconst dshtProotRootfs = process.env.DSHT_PROOT_ROOTFS;
\t\t\tif (dshtProotBin && dshtProotRootfs && existsSync(dshtProotBin) && existsSync(join(dshtProotRootfs, "bin/busybox"))) {
\t\t\t\tconst dshtStaticBinds = [];
\t\t\t\tfor (const p of ["/proc", "/dev", "/system/bin/linker64", "/apex/com.android.runtime", "/system/lib64", "/sdcard", "/storage/emulated", process.env.DSHT_NATIVE_LIB_DIR, process.env.DSHT_RUNTIME_LIB_DIR, process.env.TMPDIR])
\t\t\t\t\tif (p && existsSync(p) && !dshtStaticBinds.includes(p)) dshtStaticBinds.push(p);
\t\t\t\tif (globalThis.__dshtProotOk === void 0) {
\t\t\t\t\tconst dshtProbe = spawnSync(dshtProotBin, ["--kill-on-exit", "-r", dshtProotRootfs, ...dshtStaticBinds.flatMap((b) => ["-b", b]), "/bin/true"], { timeout: 10000 });
\t\t\t\t\tglobalThis.__dshtProotOk = dshtProbe.status === 0;
\t\t\t\t\tif (!globalThis.__dshtProotOk) console.warn("[dsht] proot probe failed (status=" + dshtProbe.status + (dshtProbe.stderr ? ", " + String(dshtProbe.stderr).slice(0, 200) : "") + "); falling back to unconfined sh + fs boundary");
\t\t\t\t}
\t\t\t\tif (globalThis.__dshtProotOk) {
\t\t\t\t\tconst dshtArgv = [dshtProotBin, "--kill-on-exit", "-r", dshtProotRootfs];
\t\t\t\t\tfor (const b of dshtStaticBinds) dshtArgv.push("-b", b);
\t\t\t\t\tconst dshtDynBinds = [];
\t\t\t\t\tfor (const b of [process.env.DSH_HOME || join(process.env.HOME || "/", ".dsh"), policy && policy.workspaceRoot])
\t\t\t\t\t\tif (b && existsSync(b) && !dshtStaticBinds.includes(b) && !dshtDynBinds.includes(b)) dshtDynBinds.push(b);
\t\t\t\t\tfor (const b of dshtDynBinds) dshtArgv.push("-b", b);
\t\t\t\t\tif (process.env.TMPDIR) dshtArgv.push("-b", process.env.TMPDIR + ":/tmp");
\t\t\t\t\tdshtArgv.push(...argv);
\t\t\t\t\treturn { argv: dshtArgv, enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
\t\t\t\t}
\t\t\t}
\t\t\tconsole.warn("[dsht] sandbox-local: no sandbox backend on android; running unconfined (fs layer enforces the workspace boundary)");
\t\t\treturn { argv: [...argv], enforcement: "unusable", denialSignatures: [], runnerFailureRules: [] };'''

_sp_local = os.path.join(NM, "dsh-sandbox-local", "lib", "index.js")
_p02_done = False
if os.path.isfile(_sp_local):
    with open(_sp_local, "r", encoding="utf-8", newline="") as _f:
        _p02_done = "DSHT-ANDROID-UNSANDBOXED" in _f.read()

if not _p02_done:
    log("  · P0-2b sandbox-local PRoot：依赖 P0-2（本模式下未应用），跳过")
    STATS["skipped"] += 1
else:
    patch(
        _sp_local,
        "DSHT-ANDROID-PROOT",
        r'\t\t\tconsole\.warn\("\[dsht\] sandbox-local: no sandbox backend on android; running unconfined \(fs layer enforces the workspace boundary\)"\);\r?\n\t\t\treturn \{ argv: \[\.\.\.argv\], enforcement: "unusable", denialSignatures: \[\], runnerFailureRules: \[\] \};',
        PROOT_WRAP,
        1,
        "P0-2b sandbox-local PRoot 真隔离",
    )

# --- P1-3  dsh-tool-fs-search：rg 不可用 → 纯 JS 降级
_fallback_src = os.path.join(STUBS, "dsh-tool-fs-search", "android-fallback.mjs")
_fallback_dst = os.path.join(NM, "dsh-tool-fs-search", "lib", "android-fallback.mjs")
if os.path.isfile(_fallback_dst):
    log("  · P1-3a fs-search android-fallback.mjs 已存在")
elif os.path.isfile(_fallback_src):
    if CHECK_ONLY:
        log("  ✓ P1-3a fs-search android-fallback.mjs 源就位（待复制，%d 字节）" % os.path.getsize(_fallback_src))
    else:
        shutil.copyfile(_fallback_src, _fallback_dst)
        log("  ✓ P1-3a fs-search android-fallback.mjs 已落位")
else:
    log("  ✗ P1-3a fs-search android-fallback.mjs 源缺失（%s）" % _fallback_src)
    STATS["failed"] += 1

patch(
    os.path.join(NM, "dsh-tool-fs-search", "lib", "index.js"),
    "android-fallback.mjs",
    r'import \{ existsSync \} from "node:fs";',
    'import { existsSync } from "node:fs";\nimport { dshtAndroidJsSearch } from "./android-fallback.mjs";',
    1,
    "P1-3b fs-search 降级模块导入",
)

patch(
    os.path.join(NM, "dsh-tool-fs-search", "lib", "index.js"),
    "DSHT-ANDROID-JS-SEARCH",
    r'async function runRipgrep\(ctx, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes\) \{\r?\n\tif \(exec\.signal\.aborted\)',
    "async function runRipgrep(ctx, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes) {\n"
    "\t/* DSHT-ANDROID-JS-SEARCH: android 无 rg 二进制——glob/grep 走纯 JS 降级（lib/android-fallback.mjs） */\n"
    '\tif (process.platform === "android") return dshtAndroidJsSearch(exec, toolName, argv);\n'
    "\tif (exec.signal.aborted)",
    1,
    "P1-3c runRipgrep android 短路",
)

# --- P1-4  dsh-terminal-bash：默认 shell / 启动参数适配 mksh
patch(
    os.path.join(NM, "dsh-terminal-bash", "lib", "index.js"),
    "DSHT-ANDROID-TERM-SHELL",
    r'const DEFAULT_BASH_SHELL = "/bin/bash";',
    'const DEFAULT_BASH_SHELL = process.platform === "android" ? "/system/bin/sh" : "/bin/bash"; /* DSHT-ANDROID-TERM-SHELL */',
    1,
    "P1-4a terminal-bash DEFAULT_BASH_SHELL",
)

patch(
    os.path.join(NM, "dsh-terminal-bash", "lib", "index.js"),
    "DSHT-ANDROID-TERM-ARGS",
    r'const DEFAULT_BASH_ARGS = \[\r?\n\t"--noprofile",\r?\n\t"--norc",\r?\n\t"-i"\r?\n\];',
    'const DEFAULT_BASH_ARGS = process.platform === "android" ? ["-i"] /* DSHT-ANDROID-TERM-ARGS */ : [\n\t"--noprofile",\n\t"--norc",\n\t"-i"\n];',
    1,
    "P1-4b terminal-bash DEFAULT_BASH_ARGS",
)

# ============================================================ P2 / P3
print("\n--- P2 / P3: client-ui-chat 折叠行 + session-title 剥标签 ---")

# --- P2  dsh-client-ui-chat：TurnProcessNodeView 折叠行大会话不可见修复
_chat = os.path.join(NM, "dsh-client-ui-chat", "lib", "client.js")
#
# ★★ 2026-09-23 DSH 升级轮 · 阶段 E：**三条锚点全部按 0.1.7 的形态重写**。
#
# ## 0.1.5 → 0.1.7 的形态变化（实测 dsh-client-ui-chat@0.1.7 的 lib/client.js）
#   ① `ChatNodeSeat` 的**签名整个换了**：
#        0.1.5：`function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess,
#                                     historyIncomplete, compactTranscript, …`
#        0.1.7：`const ChatNodeSeat = react.memo(function ChatNodeSeat({ nodeKey, groupPart,
#                                     useChatNode, useChatNodeProcess, usePresentation, cwd,
#                                     openFile, … })`
#        ⇒ `historyIncomplete` **不再是 seat 的 prop**（该名字在 0.1.7 里 0 命中）。
#   ② `processWindowReady` 的判据也换了：0.1.5 是
#        `… && processPresentation.turnClosed && !historyIncomplete;`
#      ★ 而 0.1.7 是
#        `… && (processPresentation.turnStarted || processPresentation.turnClosed);`
#        ⇒ **0.1.7 已经不再要求 `!historyIncomplete`**（官方自己放宽了）。
#
# ## ★★ 关键判断：本补丁在 0.1.7 上**仍需存在的语义只剩"放宽 ready 判据"这一半**
#   我方原意图 =「本轮窗口完整落在**已加载**区间即可折叠，不要求全会话历史加载完」。
#   0.1.7 的 `turnStarted || turnClosed` **仍不检查**「窗口是否在已加载区间」
#   ⇒ 大会话（`hasMore === true`、`firstSeq > processStartSeq`）**仍会**被误折叠
#   ⇒ 我方那一半判据**仍然必要**。
#   ⇒ 但**传递面变了**：0.1.5 靠 `historyIncomplete` 这个 prop 传下去；
#     0.1.7 里 seat 拿不到它 ⇒ 必须**新开一条 prop**（`dshtOldestSeq` + `dshtHasMore`）
#     从 `ChatView` 内经 `ChatNodeList` 透传到 `ChatNodeSeat`。
#   ★ `firstSeq`（= 最老已加载节点 seq）与 `hasMore` **在 0.1.7 的调用点已在作用域内**
#     （`lib/client.js:5106` 与 `:5117`）⇒ 透传是纯机械改动。
_chat_017 = False
if os.path.isfile(_chat):
    with open(_chat, "r", encoding="utf-8", newline="") as _f:
        _chat_017 = "processPresentation.turnStarted || processPresentation.turnClosed" in _f.read()

if _chat_017:
    # ---- 0.1.7 形态：三条锚点全部重写 ----
    # ①（新 a）把 firstSeq / hasMore 传进 ChatNodeList（调用点的 seat props 列表里）
    patch(
        _chat,
        "DSHT-CHAT-FOLD-OLDEST",
        r'(\t\t\t\t\t\t\t\t\t\t\tfileMentions,\r?\n\t\t\t\t\t\t\t\t\t\t\trenderSlot,)',
        '\t\t\t\t\t\t\t\t\t\t\tfileMentions,\n'
        '\t\t\t\t\t\t\t\t\t\t\tdshtOldestSeq: firstSeq, /* DSHT-CHAT-FOLD-OLDEST: 最老已加载节点 seq（本轮折叠放行判定） */\n'
        '\t\t\t\t\t\t\t\t\t\t\tdshtHasMore: hasMore, /* DSHT-CHAT-FOLD-OLDEST: 是否还有更老的历史未加载 */\n'
        '\t\t\t\t\t\t\t\t\t\t\trenderSlot,',
        1,
        "P2-1a ChatNodeList 传入 firstSeq/hasMore（0.1.7 形态）",
    )
    # ②（新 b）ChatNodeSeat 接收这两个新 prop（签名尾部插入）
    patch(
        _chat,
        "DSHT-CHAT-FOLD-SEAT",
        r'(function ChatNodeSeat\(\{ nodeKey, groupPart, useChatNode, useChatNodeProcess, usePresentation, cwd, openFile, openSkill, inspectCall, forkAt, loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, t \}\) \{)',
        'function ChatNodeSeat({ nodeKey, groupPart, useChatNode, useChatNodeProcess, usePresentation, cwd, openFile, openSkill, inspectCall, forkAt, loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, dshtOldestSeq, dshtHasMore /* DSHT-CHAT-FOLD-SEAT */, t }) {',
        1,
        "P2-1b ChatNodeSeat 接收 dshtOldestSeq/dshtHasMore（0.1.7 形态）",
    )
    # ③（新 c）在 processWindowReady 里补上「窗口必须落在已加载区间」那一半
    patch(
        _chat,
        "DSHT-CHAT-FOLD-READY",
        r'processPresentation\.turn === processSpec\.turn && \(processPresentation\.turnStarted \|\| processPresentation\.turnClosed\);',
        'processPresentation.turn === processSpec.turn && (processPresentation.turnStarted || processPresentation.turnClosed) '
        '&& (!dshtHasMore || (typeof dshtOldestSeq === "number" && processSpec.processStartSeq >= dshtOldestSeq)); '
        '/* DSHT-CHAT-FOLD-READY: 0.1.7 官方已去掉 !historyIncomplete，但**仍不检查**窗口是否落在已加载区间'
        ' ⇒ 大会话仍会误折叠 → 此处补回那一半判据（历史全加载完 或 本轮起点不早于最老已加载 seq） */',
        1,
        "P2-1c processWindowReady 补回已加载区间判据（0.1.7 形态）",
    )
else:
    # ---- 0.1.5 形态：原三条锚点（保持原样，跨代兼容） ----
    patch(
        _chat,
        "DSHT-CHAT-FOLD-OLDEST",
        r'historyIncomplete: hasMore,',
        "historyIncomplete: hasMore,\n"
        "\t\t\t\t\t\tdshtOldestSeq: firstSeq, /* DSHT-CHAT-FOLD-OLDEST: 最老已加载节点 seq（本轮折叠放行判定） */",
        1,
        "P2-1a ChatNodeList 传入 firstSeq",
    )
# --- P2-1b/P2-1c 的 **0.1.5 形态**分支（0.1.7 已在上面 `if _chat_017` 里处理）---
#   背景：本补丁原先的 marker `DSHT-CHAT-FOLD-SEAT** 没有出现在替换串里 →
#   打上之后 marker 恒为 0 → 幂等检测永久失效（--check 永远报「期望 1 处、实际 0 处」，
#   而实际代码早就改好了）。这是**补丁框架自身的缺陷**，已另建
#   `audit-patch-markers.py` 做全量静态审计（AST 解析，防同类问题再犯）。
_CS_ORIG = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
            'historyIncomplete, compactTranscript,')
_CS_LEGACY = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
              'historyIncomplete, dshtOldestSeq, compactTranscript,')
_CS_DONE = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
            'historyIncomplete, dshtOldestSeq, /* DSHT-CHAT-FOLD-SEAT */ compactTranscript,')

if not _chat_017:
    def _patch_chatnode_seat():
        if not os.path.isfile(_chat):
            log("  ✗ P2-1b：目标不存在 %s" % _chat)
            STATS["failed"] += 1
            return
        with open(_chat, "r", encoding="utf-8", newline="") as f:
            t = f.read()
        if "DSHT-CHAT-FOLD-SEAT" in t:
            log("  · P2-1b：已打补丁，跳过")
            STATS["skipped"] += 1
            return
        # 三种形态：① 原始（需要 patch）② 已打但缺 marker（历史缺陷遗留，需回填 marker）
        for legacy, what in ((_CS_LEGACY, True), (_CS_ORIG, False)):
            if t.count(legacy) != 1:
                continue
            if CHECK_ONLY:
                log("  ✓ P2-1b：%s" % ("已打但缺 marker（待回填）" if what else "未打，锚点就位"))
                STATS["checked"] += 1
                return
            with open(_chat, "w", encoding="utf-8", newline="") as f:
                f.write(t.replace(legacy, _CS_DONE))
            log("  ✓ P2-1b：%s" % ("marker 回填完成" if what else "已打补丁"))
            STATS["applied"] += 1
            return
        log("  ✗ P2-1b：既非已打、锚点也不匹配（DSH 升级后产物形态变了？）")
        STATS["failed"] += 1

    _patch_chatnode_seat()
    patch(
        _chat,
        "DSHT-CHAT-FOLD-READY",
        r'processPresentation\.turn === processSpec\.turn && processPresentation\.turnClosed && !historyIncomplete;',
        'processPresentation.turn === processSpec.turn && processPresentation.turnClosed && (!historyIncomplete || (typeof dshtOldestSeq === "number" && processSpec.processStartSeq >= dshtOldestSeq)); /* DSHT-CHAT-FOLD-READY: 本轮窗口完整在已加载区间即可折叠，不要求全会话历史加载完 */',
        1,
        "P2-1c processWindowReady 放宽",
    )

# --- P3  dsh-session-title：剥 HTML/协议标签
patch(
    os.path.join(NM, "dsh-session-title", "lib", "index.js"),
    "DSHT-TITLE-DETAG",
    r'function cleanTitleText\(input\) \{\r?\n\treturn input\.replace\(OSC_SEQUENCE',
    "\tfunction cleanTitleText(input) {\n"
    "\t\t/* DSHT-TITLE-DETAG: RP 首条消息/LLM 标题常含 <status> 等协议标签——先剥成对标签与未闭合标签尾再走官方 normalize */\n"
    '\t\tinput = input.replace(/<[^<>]{0,200}>/gu, " ").replace(/<[^<>]{0,200}$/u, " ");\n'
    "\t\treturn input.replace(OSC_SEQUENCE",
    1,
    "P3-5a session-title 剥协议标签",
)

# ============================================================ Step 4.8
print("\n--- Step 4.8: session 发布 link()→rename()（坑 #14 + F1 扩展）---")
_sp = os.path.join(NM, "dsh-session-persistence-jsonl", "lib", "index.js")

# F1 扩展：v0.1.5 起 link 出现 3 个位置（import / defaultFileSystem / 两处调用）
# 1) import 加 rename
#
# ★★ 2026-09-23 DSH 升级轮 · 阶段 E：**本步与 `patch-resilient-list.mjs` 争同一条 import 行**
#   （实测踩到 ⇒ `失败 1` ⇒ 构建中止）：
#     · `patch-resilient-list.mjs`（build 的 **Step 4.85**）会给同一行补 `rename`
#       并写下 **`DSHT-RESILIENT-IMPORT`** 标记；
#     · 而本步（python 的 **Step 4.8** / ps1 的同名步）的锚点是**官方原样**那一行
#       ⇒ 当 4.85 先跑过时，本步命中 0 ⇒ 报 FAIL。
#   ★ 该交互**早已被记录**（见 build-dsht.ps1:1814-1820 与 audit-build-path-parity.py 的
#     EXEMPT 注释），但**只在 ps1 侧用「语义判据」绕开了**；**python 侧一直是裸锚点**
#     ⇒ 本轮换到 0.1.7 后就炸了（P-1：同一语义两处实现，一处改了另一处没改）。
#   ⇒ 修法（与 ps1 侧口径**完全对齐**，P-1）：**用「语义已生效」判据替代裸锚点** ——
#     与 `build-dsht.ps1` 的同名步（$hasRenameImport && !$hasLinkPublish）**同一口径**。
#     · 语义已生效（import 含 rename ）⇒ 只回填 marker（不重写、不报错）；
#     · 未生效 ⇒ 按锚点替换。
#     ★ 为什么必须用「语义」而不是放宽正则：本行的**尾部注释**会被别的步骤改写
#       （实测：`patch-resilient-list.mjs` 追加了 `/* DSHT-RESILIENT-IMPORT: … */`）
#       ⇒ 任何锚住行尾的正则都**迟早会失配**（P-41：代理量会与事实脱钩）。
def _f1_import_already_effective(text):
    """import 行是否已含 rename（语义判据，不依赖行尾注释形态）。"""
    m = re.search(r'import \{([^}]*)\} from "node:fs/promises";', text)
    if m is None:
        return None
    return "rename" in [x.strip() for x in m.group(1).split(",")]


_f1_state = _f1_import_already_effective(open(_sp, encoding="utf-8", newline="").read()) if os.path.isfile(_sp) else None
if _f1_state is None:
    log("  ✗ F1-1 import 补 rename：找不到 node:fs/promises 的 import 行")
    STATS["failed"] += 1
elif _f1_state:
    # 已生效 ⇒ 只确保 marker 在位（marker 是幂等代理量，语义才是事实）
    with open(_sp, "r", encoding="utf-8", newline="") as f:
        _t = f.read()
    if "DSHT-ANDROID-RENAME-PATCH" in _t:
        log("  · F1-1 import 补 rename：已打补丁，跳过")
        STATS["skipped"] += 1
    else:
        _m = re.search(r'(import \{[^}]*\} from "node:fs/promises";)', _t)
        with open(_sp, "w", encoding="utf-8", newline="") as f:
            f.write(_t.replace(_m.group(1), _m.group(1) + " /* DSHT-ANDROID-RENAME-PATCH */", 1))
        log("  ✓ F1-1 import 补 rename：语义已生效 ⇒ 仅回填 marker（import 已含 rename）")
        STATS["applied"] += 1
else:
    patch(
        _sp,
        "DSHT-ANDROID-RENAME-PATCH",
        r'import \{ (?:link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, )(?:rename, )?(?:rm, stat, truncate) \} from "node:fs/promises";',
        'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises"; /* DSHT-ANDROID-RENAME-PATCH */',
        1,
        "F1-1 import 补 rename",
    )
# 2) defaultFileSystem 暴露 rename（v0.1.5 新增的 internals.fs 接口）
patch(
    _sp,
    "DSHT-ANDROID-RENAME-FS",
    r'\tlstat: \(path\) => lstat\(path\),\r?\n\tlink,',
    "\tlstat: (path) => lstat(path),\n\tlink,\n\trename: (a, b) => rename(a, b), /* DSHT-ANDROID-RENAME-FS */",
    1,
    "F1-2 defaultFileSystem 暴露 rename",
)
# 3) 旧发布路径
patch(
    _sp,
    "DSHT-ANDROID-RENAME-LEGACY",
    r'await link\(tmp, finalPath\);',
    "await rename(tmp, finalPath); /* DSHT-ANDROID-RENAME-LEGACY */",
    1,
    "F1-3 旧发布路径 link→rename",
)
# 4) 【F1 核心】generation 发布路径（publishCurrentExclusive）
patch(
    _sp,
    "DSHT-ANDROID-RENAME-GEN",
    r'await internals\.fs\.link\(staged, currentPath\);',
    "await internals.fs.rename(staged, currentPath); /* DSHT-ANDROID-RENAME-GEN */",
    1,
    "F1-4 generation 发布路径 link→rename",
)

# ============================================================ Step 4.5
print("\n--- Step 4.5: composition 补丁（session 持久化改明文）---")
_base = os.path.join(NM, "dsh-base", "cordis.patch.yml")
if os.path.isfile(_base):
    with open(_base, "r", encoding="utf-8", newline="") as f:
        bp = f.read()
    if re.search(r"compression:\s*'none'", bp):
        log("  · composition 补丁已存在，跳过")
        STATS["skipped"] += 1
    elif CHECK_ONLY:
        ok = "dshHomePath('sessions')" in bp
        log("  %s composition：目标锚点%s" % ("✓" if ok else "✗", "" if ok else "缺失"))
        STATS["checked"] += 1
    else:
        bp2 = bp.replace(
            "root: !!js dshHomePath('sessions')",
            "root: !!js dshHomePath('sessions')\n        compression: 'none'",
        )
        if bp2 == bp:
            log("  ✗ composition：补丁未命中锚点")
            STATS["failed"] += 1
        else:
            with open(_base, "w", encoding="utf-8", newline="") as f:
                f.write(bp2)
            log("  ✓ composition：session-persistence → compression:'none'")
            STATS["applied"] += 1
else:
    log("  ✗ composition：%s 不存在" % _base)
    STATS["failed"] += 1

# ============================================================ Step 4.6
print("\n--- Step 4.6: flock 平台适配（0.1.5 会话写锁）---")
# 【2026-09-11 心跳 44 新增】0.1.5 的 dsh-session-persistence-jsonl 用 flock(2) 做会话写锁：
#   lib/index.js  SessionWriteLease.acquire() → open(session.lock) → await tryLockExclusive(handle.fd)
# 而 @deepseek-ai/node-addon-system/lib/flock.js 的 loadBinding() 在
#   platform !== 'linux' && platform !== 'darwin' 时直接抛 ERR_FLOCK_UNSUPPORTED_PLATFORM。
# Android 的 process.platform === 'android'，且 bionic 无 glibc（linux-x64 的 system.node 也加载不了）
# → resume 会话必然失败 → **任何消息都发不出去**。实机报错原文：
#   resume failed for session "...": Error: flock is not supported on android-x64 (gateway/internal)
# 处置依据：DSH 自己对同构场景已有先例 —— dsh-session-persistence-jsonl 的 lease 文档原文：
#   "The browser worker stubs the native flock entry to immediate success: it is
#    single-process, so the in-process write claim already excludes every writer."
# DSHTavern 运行时同样是单进程 node（NodeService 只起一个），故按同一处置：立即成功。
# 合规：仅改 Android 运行时产物，不触碰 DSH 官方源与 PC runtime。
patch(
    os.path.join(NM, "node-addon-system", "lib", "flock.js"),
    "DSHT-ANDROID-FLOCK",
    r"const \{ platform, arch \} = process;",
    "const { platform, arch } = process;\n"
    "    /* DSHT-ANDROID-FLOCK: Android 无 flock(2)；单进程运行时按 DSH 对 browser worker 的同款处置：立即成功。 */\n"
    "    if (platform === 'android') {\n"
    "        binding = { tryLock: (fd, cb) => { queueMicrotask(() => cb(0)); } };\n"
    "        return binding;\n"
    "    }",
    1,
    "F2 Android flock 单进程直通",
)

# ============================================================ Step 3.6
print("\n--- Step 3.6: Iterator Helpers 兼容补丁（P0：整页 Failed to load plugins）---")
# 现象（真机截图，2026-09-14）：App 起来后整页只显示
#   Failed to load plugins
#   failed to import loader entry 91803695 (@deepseek-ai/dsh-client-ui-sidebar-documentpreview):
#   Iterator is not defined
# ⇒ **整个 web UI 加载失败**（loader entry 抛错 = 插件表中断），App 完全不可用。
#
# 根因（已复现证实，非推测）：该包 lib/client.js:152042 有 PDF.js 自带的 Iterator Helpers
# polyfill，其守卫写法**在 Iterator 未声明时会抛**：
#     if (typeof Iterator.prototype.join !== "function") Iterator.prototype.join = …
# `typeof X.y` **只对「X 已声明但值是 undefined」安全**；对**从未声明的全局标识符**
# 会抛 ReferenceError（ECDMA-262 13.5.3：MemberExpression 先求值 IdentifierReference）。
# 复现实验（node，delete globalThis.Iterator 后逐字 eval 该表达式）：
#   ① 官方写法 → ReferenceError: Iterator is not defined   ← 与真机报错逐字一致
#   ② 加 `typeof Iterator === "undefined" ||` 前置守卫 → true（需跳过 polyfill）
#
# 为什么只有它中招：全仓 241 个官方包中，**仅 dsh-client-ui-sidebar-documentpreview**
# 使用裸 Iterator 全局（扫描 `typeof (Iterator|…).` 形态：命中 1 个包）。该文件 6.9MB
# 内嵌 PDF.js（含独立发行版），polyfill 来自 PDF.js 上游而非 DSH 自研代码。
#
# Iterator Helpers（Iterator.prototype.join 等）是 **ES2025（Chrome 122+ / 内核
# V8 12.2+）** 特性。本项目 Android WebView 版本低于此 ⇒ Iterator 未声明 ⇒ 抛错。
#
# 处置：把守卫改成「先判 Iterator 是否存在」——语义等价（Iterator 不存在时本就
# 无法给 Iterator.prototype 挂方法，跳过 polyfill 是**唯一**可行分支），
# 且让该包能在旧 WebView 上正常加载。不改任何业务逻辑、不改 PDF.js 其它代码。
#
# 合规：仅改 Android 运行时产物（$runtimeDst），不触碰 DSH 官方源与 PC runtime。
ITERATOR_NEW = (
    '/* DSHT-ANDROID-ITERATOR: 旧 WebView 无 ES2025 Iterator Helpers；'
    'typeof Iterator.prototype 对未声明全局会抛 ReferenceError（整页 Failed to load plugins）'
    '——先判存在性，语义等价（Iterator 不存在时无法挂 prototype）。 */\n'
    '\t\tif (typeof Iterator === "undefined") { /* 跳过 polyfill */ }\n'
    '\t\telse if (typeof Iterator.prototype.join !== "function")'
)
# ★★ 2026-09-23 DSH 升级轮 · 阶段 C.2：**目标文件不是常量 —— 必须自动发现**。
#   0.1.7 起官方把内嵌 PDF.js 从 `lib/client.js` **拆到了 `lib/client.pdf.js`**
#   （实测 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.7-alpha.1`：
#     `client.js` 里该形态 **0 命中**，`client.pdf.js:1668` **1 命中**）。
#   ⇒ 旧实现把文件名写死成 `client.js` ⇒ **在 0.1.7 上补丁静默丢失**
#     （而 `Dsht-Patch`/`patch` 对「锚点 0 命中」只出声不报红 ⇒ **P-30：失效与通过同貌**）。
#   ★ **实证纠正审计原文的推测**：附录 A.4 曾判「官方新产物已不用该 API ⇒ 可删补丁」——
#     **实测不成立**：该 `typeof Iterator.prototype.join` 守卫**仍在**，只是换了文件。
#   ⇒ 修法 = 在**该包的 lib/ 下自动发现**含该形态的文件（而不是猜文件名，P-41）。
INNER_ITERATOR_RE = r'if \(typeof Iterator\.prototype\.join !== "function"\)'
ITERATOR_CANDIDATES = [
    os.path.join(NM, "dsh-client-ui-sidebar-documentpreview", "lib", f)
    for f in ("client.js", "client.pdf.js")
]
# ★ 判「哪个候选文件含该形态」用**字面量子串**（不是正则）——
#   它是「文件里有没有这句话」的事实判据，用正则只是把同一个串再解释一次（P-41）。
_ITER_LITERAL = 'if (typeof Iterator.prototype.join !== "function")'
ITERATOR_TARGETS = [
    p for p in ITERATOR_CANDIDATES
    if os.path.exists(p) and _ITER_LITERAL in open(p, encoding="utf-8", errors="ignore").read()
]
if not ITERATOR_TARGETS:
    # 一个都没有 ⇒ **只出声不报红**（该版本可能真的不用该 API；不是本补丁的职责去判它是缺陷）
    print("  ⓘ P0-5 Iterator：候选文件里均无该形态（可能官方已换产物）——跳过，出声不报红（P-43）")
for _t in ITERATOR_TARGETS:
    patch(
        _t,
        "DSHT-ANDROID-ITERATOR",
        INNER_ITERATOR_RE,
        ITERATOR_NEW,
        1,
        "P0-5 Iterator Helpers 守卫（旧 WebView 整页加载失败）",
    )

# ============================================================ 锚点指纹落盘（C.4）
# 【为什么要落盘而不是只打印】判据要判的是「**跨代**是否漂移」——
#   即「同一补丁在 0.1.5 与 0.1.7 上命中的是不是同一段原文」。
#   这需要一个**可被下一代比对的持久化基线**，故写成 JSON（随 runtime 目录走）。
# 【为什么可以 `--check` 时不写】检查模式约定是只读；且 `--check` 时 `ANCHOR_FP`
#   只含「尚未打补丁」的那些项 ⇒ 不完整，不该覆盖完整基线（P-30：宁可缺，不可假全）。
# 指纹为空（某补丁那代没命中）⇒ **如实记 `[]`**，不省略键（省略会让比对方误判成「新增项」）。
if not CHECK_ONLY:
    fp_path = os.path.join(DST, ".dsht-anchor-fingerprints.json")
    try:
        with open(fp_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(
                {
                    "_comment": "DSH 平台补丁的锚点指纹基线（C.4）。由 apply-platform-patches.py 自动生成；"
                                "由 audit-patch-fingerprints.mjs 比对。指纹 = 每处命中原文的 SHA256 前 8 位（排序）。",
                    "anchors": {k: list(v) for k, v in sorted(ANCHOR_FP.items())},
                },
                f, ensure_ascii=False, indent=2,
            )
            f.write("\n")
        print("锚点指纹：%d 项已写入 %s" % (len(ANCHOR_FP), os.path.basename(fp_path)))
    except OSError as e:
        print("[patch][WARN] 锚点指纹落盘失败：%s（不阻断构建，但 C.4 判据将无基线可比）" % e)

# ============================================================ 汇总
print("\n" + "=" * 72)
if CHECK_ONLY:
    print("检查完成：%d 项检查 —— 已打补丁 %d，未打可打 %d，跳过 %d，失败 %d"
          % (STATS["checked"], STATS["patched"], STATS["pending"], STATS["skipped"], STATS["failed"]))
    if STATS["pending"] > 0:
        print("⚠ 有 %d 项补丁**尚未打到该 runtime**（apply 模式会自动补上；"
              "若本意是「检查该 runtime 的补丁是否完好」，请按上表 ⚠/✗ 逐项确认）" % STATS["pending"])
else:
    print("应用完成：%d 处已打，%d 项跳过，%d 项失败" % (STATS["applied"], STATS["skipped"], STATS["failed"]))
print("=" * 72)
sys.exit(1 if STATS["failed"] else 0)
