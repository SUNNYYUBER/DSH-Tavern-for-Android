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


def log(msg):
    print("[patch] " + msg)


def die(msg):
    print("[patch][FATAL] " + msg, file=sys.stderr)
    sys.exit(1)


def patch(path, marker, pattern, repl, expected, label):
    """精确补丁：marker 幂等检测 + 命中数断言 + 替换。

    path     目标文件绝对路径
    marker   幂等标记（已打补丁时文件中应存在 expected 个）
    pattern  正则（匹配目标代码）
    repl     替换文本（字面量，不走正则反向引用）
    expected 期望命中数
    """
    if not os.path.isfile(path):
        log("  ✗ %s：目标不存在 %s" % (label, path))
        STATS["failed"] += 1
        return False

    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()

    marker_hits = text.count(marker)
    if marker_hits >= expected:
        log("  · %s：已打补丁，跳过" % label)
        STATS["skipped"] += 1
        STATS["patched"] += 1
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
    if CHECK_ONLY:
        ok = hits == expected
        STATS["checked"] += 1
        if ok:
            # 锚点命中≠补丁已生效：这类补丁（如 F2 flock）的锚点在补丁前后都存在，
            # 必须**显式**报成「未打」，不能与「已打」共用一个 ✓。
            log("  ⚠ %s：**未打补丁**（锚点命中 %d/%d，apply 模式会补上）" % (label, hits, expected))
            STATS["pending"] += 1
            return True
        log("  ✗ %s：锚点形态不符（期望 %d 处，实际 %d 处）——DSH 升级后产物形态变了？" % (label, expected, hits))
        STATS["failed"] += 1
        return False

    if hits != expected:
        log("  ✗ %s：命中数不符（期望 %d，实际 %d）—— DSH 升级后产物形态变了？" % (label, expected, hits))
        STATS["failed"] += 1
        return False

    # 用字面量替换（lambda 形式避免 \1 等反向引用被解释）
    new_text = re.sub(pattern, lambda m: repl, text)

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new_text)
    log("  ✓ %s：%d 处已打补丁" % (label, expected))
    STATS["applied"] += expected
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
patch(
    os.path.join(NM, "dsh-bash-local", "lib", "index.js"),
    "DSHT-ANDROID-SH",
    r'\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tspec\.command',
    '\t\t\t' + SH_EXPR + ', /* DSHT-ANDROID-SH */\n\t\t\t"-c",\n\t\t\tspec.command',
    2,
    "P0-1a bash-local run/start argv",
)

# --- P0-1b  dsh-bash-sandbox confine() 的内层 bash argv
patch(
    os.path.join(NM, "dsh-bash-sandbox", "lib", "index.js"),
    "DSHT-ANDROID-SH",
    r'\t\t\t"bash",\r?\n\t\t\t"-c",\r?\n\t\t\tcommand\r?\n\t\t\], policy\);',
    '\t\t\t' + SH_EXPR + ', /* DSHT-ANDROID-SH */\n\t\t\t"-c",\n\t\t\tcommand\n\t\t], policy);',
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
patch(
    _chat,
    "DSHT-CHAT-FOLD-OLDEST",
    r'historyIncomplete: hasMore,',
    "historyIncomplete: hasMore,\n"
    "\t\t\t\t\t\tdshtOldestSeq: firstSeq, /* DSHT-CHAT-FOLD-OLDEST: 最老已加载节点 seq（本轮折叠放行判定） */",
    1,
    "P2-1a ChatNodeList 传入 firstSeq",
)
# --- P2-1b（自定义块：必须同时兼容「未打」与「已打但缺 marker」两种形态）
# 背景：本补丁原先的 marker `DSHT-CHAT-FOLD-SEAT** 没有出现在替换串里 →
# 打上之后 marker 恒为 0 → 幂等检测永久失效（--check 永远报「期望 1 处、实际 0 处」，
# 而实际代码早就改好了）。这是**补丁框架自身的缺陷**，已另建
# `audit-patch-markers.py` 做全量静态审计（AST 解析，防同类问题再犯）。
_CS_ORIG = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
            'historyIncomplete, compactTranscript,')
_CS_LEGACY = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
              'historyIncomplete, dshtOldestSeq, compactTranscript,')
_CS_DONE = ('function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, '
            'historyIncomplete, dshtOldestSeq, /* DSHT-CHAT-FOLD-SEAT */ compactTranscript,')


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
patch(
    _sp,
    "DSHT-ANDROID-RENAME-PATCH",
    r'import \{ link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate \} from "node:fs/promises";',
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
patch(
    os.path.join(NM, "dsh-client-ui-sidebar-documentpreview", "lib", "client.js"),
    "DSHT-ANDROID-ITERATOR",
    r'if \(typeof Iterator\.prototype\.join !== "function"\)',
    ITERATOR_NEW,
    1,
    "P0-5 Iterator Helpers 守卫（旧 WebView 整页加载失败）",
)

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
