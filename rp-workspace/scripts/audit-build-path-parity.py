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

【判据一：补丁 marker 集合】提取两侧源码里出现的所有 DSHT-* 补丁 marker，比对集合：
  每个 marker 必须在**两侧都出现**（同串 = 幂等互认）。缺任何一侧即违约。

【判据二：stub 落盘清单】（2026-09-16 第二十七轮 W25 新增 —— 见 GOAL §11.1 W25）
  ## 为什么必须补这一条（判据一结构上发现不了的那类差异）
  第二十七轮实测：`dsh-win32-process` stub 只在 **python 路径**（STUB_MAP）落盘，
  而 ps1 路径**从来没有**这一步 ⇒ 0.1.5 世代的该包在**模块顶层**做 koffi ABI 断言
  （`if (STARTUPINFOW.size !== 104) throw`），而我方 koffi 是哑值 stub（无 `size`）
  ⇒ 顶层抛错 ⇒ `dsh-subprocess-local` 导入失败 ⇒ **整棵 cordis plugin tree 加载失败**
  （现象 = 我方容器计数全为 0、M7 五张卡全部「切卡未生效」）。
  ⇒ 判据一**为什么漏**：该差异是「**同一份 stub 文件落到哪个目标路径**」，
    两侧源码里都没有任何 `DSHT-*` marker 可对（`stubs/node-addon-landlock-run/index.js`
    全文 24 行、零 marker）⇒ 集合比对**结构上不可能**发现。
  ⇒ 判据二改为直接**解析两侧的落盘清单**（ps1 的 `Copy-Item "$stubs\…"` 与
    python 的 `STUB_MAP` + 独立落盘），比对**「源文件 → 目标路径」二元组集合**。

  ## 为什么比「源文件 → 目标路径」而不是只比「源文件」
  同一份 stub 可能落到**不同代次**的不同路径（实测：landlock 的出口在 0.1.2 是
  独立包 `@deepseek-ai/node-addon-landlock-run`，在 0.1.5 合并进
  `@deepseek-ai/node-addon-system`）⇒ 只比源文件会漏掉「路径过期」这类差异
  （python 侧落在**已废弃**的旧包目录，`os.makedirs` 还会凭空创建它 ⇒
    "看起来落位成功、实际未生效"）。故必须把目标路径一起比。

用法：python audit-build-path-parity.py
      python audit-build-path-parity.py --selftest   # 判据自身正/负控（P-30）
退出码：0 = 两条路径等价；1 = 不等价（marker 或 stub 清单任一）；2 = 文件缺失；3 = selftest 失败
"""
import io
import os
import re
import sys

# ★ W48：单源自证分数输出契约（Python 侧）—— 同目录，直接 import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selftest_summary import report_selftest  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PS1 = os.path.join(HERE, "build-dsht.ps1")
PY = os.path.join(HERE, "apply-platform-patches.py")
STUBS = os.path.join(os.path.dirname(HERE), "stubs")

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
    # 同上一条的**同一原因**（第二十七轮补）：`patch-resilient-list.mjs` 在为自愈补
    # `rename` 的 import 时写的第二个标记。它同样只在 ps1 侧出现（python 未接该脚本）。
    # ⚠️ 若复活 build-wb.sh，两条豁免**必须一起撤销**。
    #
    # 【2026-09-16 W26 改名】原值 `DSHT-RESILIENT-LIST-IMPORT` 是 `DSHT-RESILIENT-LIST`
    # 的**真前缀** ⇒ `t.includes(MARKER)` 会把「IMPORT 标记存在」读成「主体已打」⇒
    # 主体补丁被静默跳过（决定性实验证实，见 `patch-resilient-list.mjs` 头部）。
    # 已改为 `DSHT-RESILIENT-IMPORT`（不再互为前缀）；本判据四会**机器化**守住这类碰撞。
    "DSHT-RESILIENT-IMPORT": "同上：走独立脚本 patch-resilient-list.mjs 的 import 标记，仅 ps1 接入",
}

# stub 落盘清单的**单侧豁免**（同样必须写明理由）。键 = (源相对路径, 目标相对路径)。
STUB_EXEMPT = {
    # ps1 用「新旧两代都尝试」的写法覆盖 landlock（见 build-dsht.ps1 的 $llOld/$llNew），
    # 因而多出「新代路径」这一条；python 只写旧代路径。**这是真实差异、不是等价**，
    # 已判定 python 路径为弃用路径（同 DSHT-RESILIENT-LIST 的理由），故豁免 ——
    # 但**若复活 build-wb.sh，必须把 python 的 STUB_MAP 补成新旧双路径**
    # （否则 0.1.5 世代下 python 路径会把 landlock stub 落到**已废弃**的旧包目录，
    #  真正的出口 @deepseek-ai/node-addon-system/lib/index.js 不被覆盖 ⇒ 沙箱探针炸）。
    ("node-addon-landlock-run/index.js", "@deepseek-ai/node-addon-system/lib/index.js"):
        "ps1 独有的『landlock 新代出口路径』（0.1.5 起官方把它合并进 node-addon-system）；"
        "python 路径已弃用，复活时须把 STUB_MAP 补成新旧双路径",
    # 【2026-09-21 W-1】node-pty-sim 是 **PC android-sim 验证专用的临时替换**，
    # 不是常规平台 stub：ps1 的 Step 4 在起 sim 前后临时换/还原（验完即还原成上游原版）。
    # python 路径**不跑 sim 验证** ⇒ 无对应动作是**正确**的，不是漏落盘。
    # 真机路径用的是自编译 prebuilds/android-*（见 build-node-pty.mjs），与此无关。
    ("node-pty-sim/index.js", "node-pty/lib/index.js"):
        "PC android-sim 验证专用的临时替换（验完还原上游原版）；python 路径不跑 sim 验证 ⇒ 无对应动作是正确的",
}


def markers(path):
    """抽取**代码位置**（排除整行注释）的补丁 marker 集合。

    ## 【判据自身的坑（P-19）· 第十一例：判据一不过滤注释 ⇒ 被判据自己撑红】
    W26 把 `DSHT-RESILIENT-LIST-IMPORT` 改名为 `DSHT-RESILIENT-IMPORT` 后，
    旧名仍残留在 `build-dsht.ps1` 的**说明注释**里（记录当时实测的产物形态，有信息价值）。
    而本函数原先扫全文 ⇒ `DSHT-RESILIENT-LIST-IMPORT` 被判成「ps1 有、python 缺」⇒
    **假红**（实际代码里两侧都没有这个 marker 了）。
    ⇒ 修法：与判据四的 `code_markers()` 同口径（排除 `#` / `//` 开头的整行注释）——
      判据比的是**代码里的 marker 集合**，注释是历史说明、不参与幂等。
    """
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    return code_markers(text)


# ---------------------------------------------------------------------------
# 判据二：stub 落盘清单解析
# ---------------------------------------------------------------------------

def _norm_stub_src(s):
    """把 `$stubs\\sharp\\index.js` 归一成 `sharp/index.js`；非 stub 源返回 None。"""
    m = re.search(r'stubs/(.+)$', s.replace("\\", "/"))
    return m.group(1) if m else None


def _norm_stub_dst(d):
    """把 `$runtimeDst\\node_modules\\sharp\\dist\\index.cjs` 归一成
    `sharp/dist/index.cjs`；非 node_modules 目标返回 None。"""
    m = re.search(r'node_modules/(.+)$', d.replace("\\", "/"))
    return m.group(1) if m else None


def ps1_stub_pairs(text):
    """从 build-dsht.ps1 抽出 (源相对路径, 目标相对路径) 集合。

    覆盖实际出现的**三种**写法（全都要认，否则会漏报 → 假红）：
      A. 字面量直写：`Copy-Item "$stubs\\sharp\\index.js" "$runtimeDst\\node_modules\\sharp\\dist\\index.cjs" -Force`
      B. 经**一层**变量：`$llNew = "$runtimeDst\\node_modules\\…\\index.js"` +
         `Copy-Item $landlockStub $llNew -Force`
      C. 经**嵌套**变量：`$nmDst = "$runtimeDst\\node_modules\\@deepseek-ai"` 然后
         `Copy-Item "$stubs\\…" "$nmDst\\dsh-tool-fs-search\\lib\\…" -Force`
         （`$nmDst` 的值里又含 `$runtimeDst` ⇒ **必须做变量的递归展开**）

    ## 【判据自身的坑（P-19/P-30）· 首版即踩到】
    首版只做「一层变量替换」，于是 ps1 里经 `$nmDst` / `$w32StubDir` 的两条落盘
    **解析不出目标路径** ⇒ 被判成「ps1 缺这两项」⇒ **假红**（实际 ps1 两条都在）。
    识别特征：报的「缺失项」里出现了我**明知 ps1 刚写过**的条目（`dsh-win32-process`）。
    ⇒ 修法：对变量值做**最多 5 轮**的递归替换（防自引用死循环），直到没有 `$变量` 残留。
    """
    pairs = set()
    varmap = {}
    for m in re.finditer(r'^\s*(\$[\w]+)\s*=\s*"([^"]*)"', text, re.M):
        varmap[m.group(1)] = m.group(2)

    def expand(v):
        """把变量值里的 `$other` 递归展开（最多 5 轮，防自引用）。

        ## 【判据自身的坑（P-19）· 第三例：替换顺序敏感】
        首版用「按 dict 迭代顺序逐个 `str.replace`」，而变量名存在**前缀包含**关系
        （`$ws` ⊂ `$runtimeDst` 里并不成立，但 `$root` 与 `$ws`/`$runtimeDst` 的值互相包含：
         `$ws = "$root\\rp-workspace"`）。顺序错时会把 `$runtimeDst` 先替换成
         `$root\\rp-workspace\\dsh-runtime-android`，随后再替换 `$root` 时**不会**出问题；
         但若先替换 `$ws` 之后又有 `${ws}` 类形态就会出错。
        ⇒ 稳妥做法：**按变量名长度降序**替换（长的优先，避免短名吃掉长名的前缀），
          并且在每轮开始时把「已无 `$` 的串」跳过（提前收敛）。
        """
        for _ in range(5):
            if "$" not in v:
                break
            before = v
            # 长名优先：避免 `$ws` 抢先匹配掉 `$wsXxx` 的前缀
            for name in sorted(varmap, key=len, reverse=True):
                if name in v:
                    v = v.replace(name, varmap[name])
            if v == before:
                break
        return v

    # 预展开变量表
    expanded = {k: expand(v) for k, v in varmap.items()}

    def resolve(tok_literal, tok_var):
        if tok_literal:
            return expand(tok_literal)
        return expanded.get(tok_var, "")

    for m in re.finditer(r'Copy-Item\s+(?:"([^"]+)"|(\$[\w]+))\s+(?:"([^"]+)"|(\$[\w]+))', text):
        src_raw = resolve(m.group(1), m.group(2))
        dst_raw = resolve(m.group(3), m.group(4))
        if not src_raw or not dst_raw:
            continue
        s = _norm_stub_src(src_raw)
        d = _norm_stub_dst(dst_raw)
        if s and d:
            pairs.add((s, d))
    return pairs


def py_stub_pairs(text):
    """从 apply-platform-patches.py 抽出 (源相对路径, 目标相对路径) 集合。

    覆盖两种写法：
      A. `STUB_MAP = [ ("sharp/index.js", "sharp/dist/index.cjs"), … ]`
      B. 独立落盘（`dsh-tool-fs-search/android-fallback.mjs`）——
         `os.path.join(STUBS, "dsh-tool-fs-search", "android-fallback.mjs")`
         与 `os.path.join(NM, "dsh-tool-fs-search", "lib", "android-fallback.mjs")`

    ## 【判据自身的坑（P-19）· 第二例：两侧的「路径根」语义不同】
    python 侧 `NM = os.path.join(DST, "node_modules", "@deepseek-ai")`（**已含作用域目录**），
    而 ps1 侧 `$runtimeDst` + `node_modules` 的目标里**自己带** `@deepseek-ai`。
    ⇒ 若照抄 ps1 的归一化（只取 `node_modules/` 之后），python 侧会得到
      `dsh-tool-fs-search/lib/…` 而 ps1 侧得到 `@deepseek-ai/dsh-tool-fs-search/lib/…`
      ⇒ **同一件事被写成两个字符串** ⇒ 假红。
    ⇒ 修法：把两侧统一到同一个「从 node_modules 起算」的口径 —— python 侧给 `NM` 出来的
      相对路径**补回** `@deepseek-ai/` 前缀（因为 `NM` 的定义里就含它）。
    """
    pairs = set()
    m = re.search(r"STUB_MAP\s*=\s*\[(.*?)\n\]", text, re.S)
    if m:
        for a, b in re.findall(r'\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)', m.group(1)):
            pairs.add((a, b))
    # B：os.path.join(STUBS, …) / os.path.join(NM, …)，按**末尾文件名相同**配对。
    # `NM` 含 `@deepseek-ai` ⇒ 补回该前缀，与 ps1 的 `node_modules/@deepseek-ai/…` 口径对齐。
    src_list = [tuple(re.findall(r'"([^"]*)"', g))
                for g in re.findall(r'os\.path\.join\(\s*STUBS\s*,\s*((?:"[^"]*"\s*,?\s*)+)\)', text)]
    dst_list = [tuple(re.findall(r'"([^"]*)"', g))
                for g in re.findall(r'os\.path\.join\(\s*NM\s*,\s*((?:"[^"]*"\s*,?\s*)+)\)', text)]
    # NM 的定义里是否含 @deepseek-ai（决定要不要补前缀）—— 从源码读，不硬编码假设
    nm_has_scope = bool(re.search(r'^NM\s*=\s*os\.path\.join\([^)]*"@deepseek-ai"\s*\)', text, re.M))
    for s in src_list:
        for d in dst_list:
            if s and d and s[-1] == d[-1]:
                d_joined = "/".join(d)
                if nm_has_scope:
                    d_joined = "@deepseek-ai/" + d_joined
                pairs.add(("/".join(s), d_joined))
    return pairs


# ---------------------------------------------------------------------------
# 判据三：`Dsht-Patch` 调用点的**幂等口径自洽**（W26 · P-41 的机器化）
# ---------------------------------------------------------------------------
#
# ## 为什么必须单独守（第二十七轮真跑 `-SkipInstall` 实测踩到两处）
# `build-dsht.ps1` 的 `Dsht-Patch` 用 **marker 计数** 判「是否已打过」（幂等）。
# 而 marker 是**代理量**，它在两种情形下会与事实脱钩：
#   ① **替换文本里没写 marker** —— 第一次跑成功但产物无 marker ⇒ 第二次跑
#      markerCount=0 ⇒ 不跳过 ⇒ 去匹配**已被替换掉**的锚点 ⇒ 0≠Expected ⇒ throw
#      （报错说「DSH 升级后产物形态变了」，**实际是产物早就打好了**）。
#      实证：`P2-1b`（`DSHT-CHAT-FOLD-SEAT`）。**完整构建被掩盖**（Step 3 重建 runtime），
#      **`-SkipInstall` 才暴露**。
#   ② **另一个步骤重写同一行**，把 marker 抹掉 —— 实证：`Step 4.8` 的
#      `DSHT-ANDROID-RENAME-PATCH` 被 `Step 4.85` 的 `patch-resilient-list.mjs`
#      （按字母序重排 import 行）抹掉。
#
# ## 判据（静态可查的那一半）
# 对每个 `Dsht-Patch` 调用点，要求满足**至少一条**：
#   (a) **marker 出现在替换文本里**（让代理量与事实对齐 —— 首选，最简单）；或
#   (b) 该调用**显式传了 `$Already`**（已生效形态的第二判据 —— 兼容「已存在的旧产物」）。
# 两者皆无 ⇒ 报红（这就是 ① 的静态特征）。
#
# ## 诚实边界
# ② 那类（*运行期*被别的步骤抹掉）**静态查不出来** —— 它需要「谁重写了这一行」的跨步骤知识。
# 本轮已把 Step 4.8 的幂等判据改锚到「语义已生效」（其正则在下面 `KNOWN_SEMANTIC_IDEMPOTENT`
# 里登记，作为**已知已收口**的记录）。⇒ 判据三只覆盖 ①，② 靠「幂等判据改锚到语义」的写法
# 从根上避免；新出现同类时由真跑构建（或 M7）暴露。
#
# 例外登记（必须写明理由）。
PATCH_IDEMPOTENT_EXEMPT = {
    # 该调用的 marker 是「值型」断言（`android-fallback.mjs` 是**文件名**，不是补丁标记），
    # 其幂等由「import 行是否已含该模块」隐含判定；已在 Step 3.5 的重复执行中实测稳定。
    'P1-3a fs-search 降级模块导入': 'marker 是文件名（非补丁标记），幂等由 import 行隐含保证',
}

# 「幂等判据已改锚到语义」的调用点（② 那类的收口记录，供审计输出里标注）
KNOWN_SEMANTIC_IDEMPOTENT = {
    'P2-1b ChatNodeSeat 接收 dshtOldestSeq': '已加 $Already 形态判据（兼容旧产物）+ 替换文本已补 marker',
    'Step 4.8 session 发布 link→rename': '幂等判据已改锚到「语义已生效」（import 含 rename 且无裸 link 发布）',
}


def ps1_dsht_patch_calls(text):
    """抽出 `Dsht-Patch` 的调用点：返回 [(起始行号, marker, 调用片段, label, 是否有 $Already)]。

    ## 解析策略（两个坑都踩过，见下）
    从 `Dsht-Patch` 起收集续行（PowerShell 用反引号结尾续行），直到**出现 `<int> '<label>'`
    且该行不再以反引号结尾**为止 —— 因为 `$Already` 恰恰跟在 label 之后**又续了一行**。
    故终止条件必须是「label 行**且**不以反引号结尾」。

    ## 【判据自身的坑（P-19）· 第五例：终止条件写早了】
    首版把「`<int> '<label>'` 结尾」当终止条件 ⇒ 带 `$Already` 的调用（label 后还有一行）
    在 label 行就停了 ⇒ 片段里看不到 `$Already` ⇒ **误报违约**（selftest 第 8 例当场抓到）。
    ⇒ 修法：label 行若仍以反引号结尾，**继续收集下一行**。

    ## 【判据自身的坑（P-19）· 第六例：here-string 误报】
    首版只在「调用片段内」数 marker 出现次数，于是 `DSHT-ANDROID-PROOT`（marker 写在
    `$prootWrap` 的 here-string 里、作为变量传入）被**误报**。
    ⇒ 修法：在**全文**里数 marker 出现次数（≥2 = 参数本身 + 别处）。
    """
    lines = text.split("\n")
    calls = []
    i = 0
    while i < len(lines):
        if "Dsht-Patch" not in lines[i]:
            i += 1
            continue
        buf = [lines[i]]
        j = i
        # 收集续行：直到遇到「label 行**且行尾没有反引号**」（= 该调用真正结束）。
        #
        # 【判据自身的坑（P-19）· 第五例（补）】这里必须用**两个不同**的正则：
        #   · **终止**条件：`<int> '<label>'` 且**行尾无反引号**（行尾可能是 `` ` `` 或什么也没有）
        #   · **提取** label：`<int> '<label>'`，**允许行尾有反引号**（因为带 `$Already` 的调用
        #     在 label 行仍以反引号续行）
        # 首版把两者混用一个「要求行尾无任何东西」的正则 ⇒ 带反引号的 label 行**匹配不上**，
        # 于是既没终止也没提取到 label ⇒ 自证第 8 例误报。
        LABEL_ANY = re.compile(r"\d+\s+'[^']*'\s*`?\s*$")
        LABEL_END = re.compile(r"\d+\s+'[^']*'\s*$")
        while j < len(lines):
            if j > i and LABEL_END.search(lines[j]):
                break            # label 行且行尾无反引号 ⇒ 调用结束
            j += 1
            if j < len(lines):
                buf.append(lines[j])
            if j - i > 40:
                break
        blob = "\n".join(buf)
        mk = re.search(r"Dsht-Patch\s+\S+\s+'([^']+)'", blob)
        if mk:
            label_m = [ln for ln in buf if LABEL_ANY.search(ln)]
            label = LABEL_ANY.search(label_m[-1]).group(0).split("'")[1] if label_m else "(未解析出 label)"
            # 【判据自身的坑（P-19）· 第七例：把「变量名字面量」当成「传了实参」】
            # 首版写 `"$Already" in blob` —— 而**自证用例**传的是已展开的值（`'new-form'`），
            # 不含 `$Already` 这个字面量 ⇒ 自证第 8 例**误报**。
            # 更本质的是：判据要回答的是「**label 之后还有没有额外实参**」（= 传了第 7 参），
            # 而不该去认**变量名**（那是**代理量** —— 又一次 P-41 的形态）。
            # ⇒ 修法：看 label 所在行之后**是否还有非空行**（续行里多出来的实参）。
            label_idx = -1
            for k, ln in enumerate(buf):
                if LABEL_ANY.search(ln):
                    label_idx = k
            has_extra_arg = label_idx >= 0 and any(x.strip() for x in buf[label_idx + 1:])
            calls.append((i + 1, mk.group(1), blob, label, has_extra_arg))
        i = j + 1
    return calls


def _collect_ps1_string_vars(text):
    """收集 PowerShell 字符串变量的值（**有界**，供调用片段做一层展开）。

    ## 【判据自身的坑（P-19）· 第九例：无界 find 导致脚本卡死】
    上一版对「普通字符串赋值」也用 `text.find('\\n"@', start)` 找结束 ⇒ 当该赋值不是
    here-string 时，它会**一路找到文件里下一个** `\\n"@`（可能隔着几万行）⇒ 变量值巨大 ⇒
    后续对每个调用做 `str.replace` 时把整段插进去 ⇒ **判据自己跑到卡死**（实测）。
    ⇒ 修法：① **区分形态**（here-string 用 `"@` 收尾；普通字符串**限定同一行**）；
      ② 每个值**截断到 30000 字符**（防异常输入把判据拖垮 —— 判据本身必须是有界的）。
    """
    varmap = {}
    # ① here-string：$name = @" … "@
    for m in re.finditer(r'^\s*(\$[\w]+)\s*=\s*@"\r?\n', text, re.M):
        end = text.find('\n"@', m.end())
        if end > 0:
            varmap[m.group(1)] = text[m.end():end][:30000]
    # ② 单行字符串：$name = "…"（**限定同一行**，不含换行）
    for m in re.finditer(r'^\s*(\$[\w]+)\s*=\s*"([^"\r\n]*)"', text, re.M):
        varmap.setdefault(m.group(1), m.group(2))
    return varmap


def patch_idempotent_violations(text):
    """ps1 侧：返回幂等口径不自洽的 `Dsht-Patch` 调用点：[(行号, marker, label)]。

    口径：该调用的 marker 必须**在调用片段（含它引用的变量值）里出现 ≥2 次**
          —— 一次是参数本身，一次在替换文本（或其 here-string 变量）里；
          **或**该调用显式传了第 7 参（`$Already` 形态判据）。

    ## 【判据自身的坑（P-19）· 第八例：用「全文计数」当判据 ⇒ 注释把它撑起来了】
    再上一版在**全文**里数 marker 出现次数（≥2 即通过）。而本文件里 marker 还会出现在
    **解释性注释**中（如 `# …（P2-1b \\`DSHT-CHAT-FOLD-SEAT\\` 就是）`）⇒ 即使把替换文本里的
    marker 删掉，全文计数仍 ≥2 ⇒ **杠杆失效**（把 marker 删掉后判据仍报绿，自证抓不到回归）。
    ⇒ 修法：只在「**调用片段 + 它引用的变量值**」范围内数。
    """
    varmap = _collect_ps1_string_vars(text)

    bad = []
    for lineno, marker, blob, label, has_already in ps1_dsht_patch_calls(text):
        if label in PATCH_IDEMPOTENT_EXEMPT:
            continue
        if has_already:
            continue
        # 一层变量展开：把片段里出现的 $var 换成其（有界的）值
        expanded = blob
        for name, val in varmap.items():
            if name in expanded:
                expanded = expanded.replace(name, val)
        if expanded.count(marker) < 2:
            bad.append((lineno, marker, label))
    return bad


# ---------------------------------------------------------------------------
# 判据三（续）：**python 侧** `apply-platform-patches.py` 的 `patch()` 调用点
# ---------------------------------------------------------------------------
#
# ## 为什么必须补这一半（W26 待办②）
# W25/W26 修的 2 处幂等缺陷都在 ps1 的 `Dsht-Patch` 上，而 **python 侧的 `patch()`
# 是同一族**：它也「用 marker 计数判是否已打过」（`text.count(marker) >= expected`）。
# 判据三此前只扫 ps1 ⇒ python 侧同类缺陷**结构上发现不了**（P-11：判据不覆盖真实面）。
#
# ## 为什么不能只靠 `audit-patch-markers.py`
# 该脚本确实实现了同一判据（AST 求值，实测 19/19 健全），但它**全仓无任何自动触发点**
# —— 既不在 Step 0.5 门禁里，也不在 `build-wb.sh` 里。即「声明为判据、实质靠人记得跑」，
# 正是本项目主力缺陷族（P-11 家族）。故把该判据**收进常驻门禁**（本判据三续）。
# `audit-patch-markers.py` 保留为可独立运行的细粒度工具（输出更详细的逐条明细）。
#
# ## 口径差异（诚实登记）
# python 侧没有「`$Already` 形态判据」这一机制 ⇒ 只有一条路：**marker 必须写进 repl**。
# 故此处判据 = 「marker ∉ 求值后的 repl」即违约（比 ps1 侧更严格，符合事实）。
PY_PATCH_IDEMPOTENT_EXEMPT = {
    # 与 ps1 侧 PATCH_IDEMPOTENT_EXEMPT 同一理由（同名补丁点，marker 是文件名）。
    'P1-3b fs-search 降级模块导入': 'marker 是文件名（非补丁标记），幂等由 import 行隐含保证',
}


def py_patch_idempotent_violations(text):
    """python 侧：返回 `patch()` 调用点里「marker 没写进 repl」的项：[(行号, marker, label)]。

    用 AST（而非正则）求值字符串实参 —— repl 常见形态是**多行字符串拼接**
    （`"a"\n"b"`）与**模块级常量引用**（`PROOT_WRAP`），正则在两者上都会失手。
    与 `audit-patch-markers.py` 同口径（该脚本是本判据的细粒度独立版本）。
    """
    import ast
    try:
        tree = ast.parse(text)
    except SyntaxError as e:
        return [(0, "(语法错误)", "apply-platform-patches.py 解析失败：%s" % e)]

    # 收集模块级常量（Name 求值用）；只认能字面量求值的
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
            return consts.get(node.id, None)
        if isinstance(node, ast.JoinedStr):
            out = ""
            for v in node.values:
                if isinstance(v, ast.Constant):
                    out += str(v.value)
                else:
                    return None        # f-string 插值 ⇒ 无法静态求值
            return out
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            a, b = ev(node.left), ev(node.right)
            return None if a is None or b is None else a + b
        return None

    bad = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "patch"):
            continue
        if len(node.args) < 6:
            continue
        marker = ev(node.args[1])
        repl = ev(node.args[3])
        label = ev(node.args[5])
        if label in PY_PATCH_IDEMPOTENT_EXEMPT:
            continue
        if not isinstance(marker, str) or not isinstance(repl, str):
            # 求值不出 ⇒ **不许静默放过**（P-11：无法判定 ≠ 判定通过）
            bad.append((getattr(node, "lineno", 0), str(marker), "%s（实参无法静态求值，须人工确认）" % label))
            continue
        if marker not in repl:
            bad.append((getattr(node, "lineno", 0), marker, label))
    return bad


def py_patch_call_count(text):
    """单独取 python 侧 `patch()` 调用点数（供汇总行显示 —— 0 违规也可能意味着「一个都没扫到」）。"""
    import ast
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return -1
    n = 0
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "patch" and len(node.args) >= 6):
            n += 1
    return n


# ---------------------------------------------------------------------------
# 判据四：补丁 marker 之间**不得互为子串**（W26 · P-41 第四例的机器化）
# ---------------------------------------------------------------------------
#
# ## 为什么必须有这一条（第二十八轮决定性实验证实，非推测）
# 本项目所有补丁的幂等判据都是 `text.includes(marker)` / `text.count(marker)` 形态
# （`Dsht-Patch` 用 `[regex]::Matches(text, marker).Count`，python `patch()` 用
#  `text.count(marker)`，`patch-resilient-list.mjs` 用 `t.includes(MARKER)`）。
# ⇒ 只要 marker A 是 marker B 的**子串**，那么「B 存在」会被读成「A 已打过」
# ⇒ A 的主体补丁被**静默跳过**（exit 0、输出还像成功）—— 补丁消失而无人知晓。
#
# 实证（`tmp/w26-probe-resilient-idem.mjs`，正控 + 负控 + 杠杆）：
#   `patch-resilient-list.mjs` 的 `MARKER = 'DSHT-RESILIENT-LIST'` 曾是
#   `IMPORT_MARK = 'DSHT-RESILIENT-LIST-IMPORT'` 的**真前缀** ⇒
#   夹具里只要预置一行 IMPORT 标记注释，主体锚点原样保留、脚本 exit 0、输出
#   `补 import rename: …` ⇒ **boot-loop 防线消失**；删掉那行注释（杠杆）立刻回到
#   `patched: …` ⇒ 差异只来自子串关系。已改名（`DSHT-RESILIENT-IMPORT`）。
#
# ## 判据边界与口径（诚实登记）
#   · 只扫 `DSHT-*` 形态的 marker（本项目补丁 marker 均为该形态；
#     `apply-platform-patches.py` 里以文件名当 marker 的那处（`android-fallback.mjs`）
#     不参与本条 —— 它已由判据三的 PATCH_IDEMPOTENT_EXEMPT 单独登记理由）。
#   · **只取代码位置的 marker**：整行注释（`#` / `//` 开头）里的提及是历史说明，
#     不参与幂等判定 ⇒ 排除，否则「解释旧名」本身会把判据撑红（P-19 第八例同源教训：
#     判据不能被注释撑起来，也不该被注释误伤）。
#   · 参与扫描的脚本 = 三条会写 marker 的构建侧脚本（ps1 / python / resilient-list）。
MARKER_COLLISION_EXEMPT = {
    # 键 = (短, 长)。必须写明理由，否则不得加入。
}


def code_markers(text):
    """抽取**代码位置**（排除整行注释）的 `DSHT-*` marker 集合。"""
    found = set()
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("#") or s.startswith("//"):
            continue
        for m in MARKER_RE.findall(line):
            if m.endswith("-"):
                continue
            found.add(m)
    return found


# 幂等 marker 的**引号字面量**词法：`DSHT-…` 与 `DSHT_…` 两种分隔符都算。
#
# ## 【判据自身的坑（P-19）· 第十二例：词法收窄 ⇒ 漏扫下划线族 ⇒ 判据沉默】
# `MARKER_RE` 的字符类是 `[A-Z0-9-]`（**不含下划线**）⇒ `DSHT_ANDROID_SIM`
# 这类下划线 marker **扫不到**。而它恰恰是 ps1 三个 sim 补丁（`3d` / `3d-2` / `3d-3`）
# 的幂等 marker ⇒ 若将来出现 `DSHT_ANDROID_SIM_X` 之类的近名，判据四会**沉默**
# （P-41 的「判据沉默」方向：上游同号改形态 ⇒ 判据不响）。
#
# ## 为什么同时限定「引号内」
# 幂等 marker 在三个脚本里都写成带引号的字符串字面量（`'DSHT-…'` / `"DSHT-…"`）:
# 参数、`text.count(...)` 的实参、`t.includes(...)` 的实参。限定引号的好处：
#   · 排除正则片段（`'DSHT-ANDROID-'` 后接别的字符时的截断误命中）；
#   · 排除注释以外的裸词（虽然注释行已被排除，但行内注释尾部仍有裸词风险）；
#   · 排除「说明性提及」（如注释里写 `见 DSHT-SIM 处`）——那些不参与幂等判定。
MARKER_LITERAL_RE = re.compile(r"""['"](DSHT[-_][A-Z0-9_-]*)['"]""")


def marker_literals(text):
    """抽取引号内的幂等 marker 字面量（覆盖 `DSHT-` 与 `DSHT_` 两种形态）。

    与 `code_markers()`（判据一用，宽词法、宁可宽）**刻意分开**：
    判据一比的是「两条路径的补丁集」，宽口径不会假红（注释已排除）；
    判据四比的是「幂等判据之间的子串关系」，必须与 `includes` 的真实作用面
    对齐 —— 即「哪些字符串被当成了 marker」⇒ 用引号字面量口径。

    ## 【判据自身的坑（P-19）· 第十三例：口径扩宽引入「前缀族」误报】
    第十二例把词法从 `[A-Z0-9-]` 扩到含下划线、并限定引号内之后，实测报出 **32 对碰撞**
    —— 其中 32 对**全是** `'DSHT-'` / `'DSHT-ANDROID-'` 这类**前缀族探测**：
    python 的 `DSHT_STUB_MARKERS = ("DSHT-ANDROID-", "DSHT-")` 是「认领自有 stub」时
    用的 **`in`/前缀** 探测，**不是**等值幂等 marker ⇒ 它天然是别的 marker 的子串，
    且**本该如此**（它就是要匹配一族）。
    ⇒ 修法：真 marker 从**不以分隔符结尾** ⇒ 过滤掉以 `-` / `_` 结尾的字面量。
      （这与 `code_markers()` 原有的 `endswith("-")` 过滤同源，只是推广到 `_`。）
    识别特征（P-19 家族通用）：**报出的条目与已知事实矛盾** —— 报「`DSHT-SIM` 会被
    `DSHT-` 误判」显然荒谬，因为没人会用 `'DSHT-'` 判 `DSHT-SIM` 打过没有。
    """
    found = set()
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("#") or s.startswith("//"):
            continue
        for m in MARKER_LITERAL_RE.findall(line):
            if m.endswith("-") or m.endswith("_"):
                continue          # 前缀族（`in` 探测用），非等值幂等 marker
            found.add(m)
    return found


def marker_substring_collisions(markers):
    """返回互为**真子串**的 marker 对：[(短, 长)]。

    ## 【判据自身的坑（P-19）· 第十例：不得只判「前缀」】
    首版写 `b.startswith(a)`（只判前缀）。而 `text.includes(a)` 的失效条件是
    「a 出现在 b 里的**任意位置**」⇒ 中缀形态（如 `DSHT-X` 与 `DSHT-ANDROID-X`）
    会漏报。本判据取 `a in b`（真子串），与 `includes` 的实际语义对齐。
    """
    out = set()
    ms = sorted(set(markers))
    for a in ms:
        for b in ms:
            if a != b and a in b:
                out.add((a, b))
    return sorted(out)


# ---------------------------------------------------------------------------
# 判据五：构建侧 `.ps1` 必须带 **UTF-8 BOM**（W28 · 决定性实验得出的硬约束）
# ---------------------------------------------------------------------------
#
# ## 为什么这居然是缺陷（第二十八轮 W28 亲历，不是推测）
# 我用编辑器改 `rebuild-plugins.ps1` 时，**工具把文件开头的 3 字节 BOM 剥掉了**。
# 于是 `powershell -File scripts/rebuild-plugins.ps1` 立刻失败，而报错**毫不相干**：
#     At scripts\rebuild-plugins.ps1:123 char:162
#     + ... "exports":{".":"./lib/index.js",...
#     Missing argument in parameter list. / Unexpected token ':' in expression
# 它指着第 **123** 行（一个 JSON 字面量），而真凶在**第 1 行之前**。花了两轮才定位。
#
# ## 机制（决定性实验实测，非推断）
# 本机实际调用的是 **Windows PowerShell 5.1**（`powershell.exe`），它**没有 BOM 时
# 按系统 ANSI 代码页（本机 GBK）解码** UTF-8 文件 ⇒ 中文注释变乱码字节 ⇒ 乱码里
# 可能含 `'` `"` `{` `}` 等字符 ⇒ **引号配对被打断** ⇒ 后续所有 token 归属改变，
# 报错位置漂到远处（且只报前几条，说"Not all parse errors were reported"）。
#
#   实验（同一份字节，只差 BOM，用 5.1 的 Parser 测量）：
#     带 BOM   ⇒ 语法错误 **0**
#     无 BOM   ⇒ 语法错误 **54**
#   （同一实验在 PS7 终端里两次都是 0 —— PS7 默认 UTF-8。⇒ **必须用 5.1 验**，
#     否则判据会被"我这里好好的"骗过去。这是本判据**唯一**的实现要点。）
#
# ## 为什么必须常驻（而不是"我记住就行"）
# ① 触发者是**编辑器/工具链**，不是人：我这次什么都没做错，是工具顺手剥的；
# ② 后果是**构建链断在最上游**（`rebuild-plugins.ps1` 是插件部署全流程的闸门）；
# ③ 报错位置与真因**相距 122 行**，且报的是"语法"而非"编码" ⇒ 极易误诊。
#
# ## ★★ 实测频次（这是本判据最强的存在理由，不是理论担忧）
# 建判据后的**同一轮内**它在原位抓到 **4 次**真实回归 —— 每一次都是**我自己用编辑工具
# 改这个文件时被静默剥掉 BOM**（改注释、改注释、接线、改注释）。⇒ 该破坏**不是一次性事故，
# 而是每次编辑都可能发生**的系统性行为。这正是「凡构建链最上游的事实都必须机器化」的实证：
# 若只靠记性，本轮至少有 4 次会以「语法错误指向远处行号」的形式浪费时间并被误诊。
#
# ⇒ 与判据一~四同族（静默/误导型），必须机器化。
#
# ## 口径（诚实登记）
# · 只判**存在 BOM**（3 字节 `EF BB BF`），不判"是否为合法 UTF-8"（那是另一件事，
#   且一旦乱码通常会连 marker 判据一起报红）；
# · 扫描范围 = **自动发现** `scripts/*.ps1`（而不是硬编码名单）。
#   理由（P-11 家族的漏法）：硬编码名单的失败形态是「**新增了一个 .ps1，但没人想到
#   登记它**」⇒ 判据对它沉默 —— 而新增脚本恰恰是最可能带上各种编码手法的时刻。
#   自动发现的代价：若将来真有个「故意不带 BOM」的 ps1（例如纯 ASCII、无需中文），
#   它会误报 ⇒ 那时在 PS1_BOM_EXEMPT 里写明理由豁免（**必须写理由**，与其它豁免同规矩）。
# · **不修 BOM**：本判据只报红（P-40：判据不改状态，免得掩盖谁在剥 BOM）。
PS1_BOM_EXEMPT = {
    # 键 = 文件名。必须写明理由，否则不得加入。
}
PS1_BOM_SCAN_DIR = HERE          # scripts/ 目录


def ps1_bom_required_names(scan_dir):
    """自动列出待检的 .ps1（排除豁免项）。目录不存在返回 []。"""
    if not os.path.isdir(scan_dir):
        return []
    names = []
    for fn in sorted(os.listdir(scan_dir)):
        if not fn.lower().endswith(".ps1"):
            continue
        if fn in PS1_BOM_EXEMPT:
            continue
        names.append(fn)
    return names


def ps1_missing_bom(path):
    """读**字节**判断是否缺 UTF-8 BOM。文件不存在返回 None（由调用方另行处理）。"""
    if not os.path.exists(path):
        return None
    with io.open(path, "rb") as f:
        head = f.read(3)
    return head != b"\xef\xbb\xbf"


def ps1_bom_violations(names):
    """返回缺 BOM 的脚本名列表。"""
    bad = []
    for n in names:
        miss = ps1_missing_bom(os.path.join(HERE, n))
        if miss:                      # True = 缺；None = 文件不存在（不计本条）
            bad.append(n)
    return bad


# ---------------------------------------------------------------------------
# 判据五续：**被 PowerShell 读取、且含中文**的数据文件也必须带 BOM（W28 实测）
# ---------------------------------------------------------------------------
#
# ## 为什么 .ps1 之外还要管数据文件（实测踩到，构建**真的被中断**）
# 判据五首版只扫 `scripts/*.ps1`。随后真跑 `build-dsht.ps1 -SkipInstall` 时，
# **Step 0.7 直接 throw**，报的却是：
#     ConvertFrom-Json : Invalid object passed in, ':' or '}' expected. (90): {
#     t-dsh-version.mjs 澶嶆牳锛涙瀯寤烘湡 Step 0.7 浼氭柇瑷€ ...
# 后一段是**中文乱码** ⇒ 真因不是 JSON 语法错，而是 `dsh-version.json`
# **含中文却无 BOM** ⇒ PS 5.1 按 GBK 解码 ⇒ 中文变乱码 ⇒ JSON 结构被破坏。
# （注意：文件本身**是合法 UTF-8 JSON** —— node 侧 `JSON.parse` 读它一直是好的
#   ⇒ 只有 PS 侧受害 ⇒ **单看 node 侧永远发现不了**。）
#
# ## 决定性实验（同一份字节，四个组合都测了 —— 结论**不能猜**）
#   | 读取方 | 无 BOM | 带 BOM |
#   |---|---|---|
#   | PS 5.1 默认编码（`Get-Content -Raw \| ConvertFrom-Json`） | **失败** | OK |
#   | PS 5.1 + `-Encoding UTF8`                              | OK | OK |
#   | node `JSON.parse(fs.readFileSync(p,'utf8'))`            | OK | **失败**（`Unexpected token '\uFEFF'`） |
# ⇒ **两个读者的要求相反** ⇒ 唯一解 = **文件带 BOM**（保 PS 侧/构建链）+
#   **node 侧剥 BOM**（已修：`audit-dsh-version.mjs:readJsonTolerant` 与
#   `verify-apk-runtime-version.mjs` 的同款剥离）。
# ⇒ 故本条判据守**文件侧**那一半；另一半由那两个脚本的读取函数守。
#
# ## 口径
# · 键 = 相对 rp-workspace 的路径（`scripts/` 之外的文件也要能登记）；
# · 只登记**确实会被 PowerShell 读取**且**含中文**的文件 —— 不含中文的文件无此风险
#   （PS 解码错也不影响 JSON 结构），登记它只会制造假红；
# · 与判据五主项同规矩：**不修文件**，只报红（P-40：判据不改状态）。
PS1_READ_DATA_FILES = [
    # `build-dsht.ps1:130` 的 `Get-Content $ssotPath -Raw | ConvertFrom-Json` 读它。
    # 含中文注释（`_comment` / `_why` / `_howToChange` 等 6 个字段），故必须带 BOM。
    "dsh-version.json",
]


def data_bom_violations(rel_names):
    """返回缺 BOM 的数据文件路径列表（相对 rp-workspace）。"""
    wsroot = os.path.dirname(HERE)
    bad = []
    for rel in rel_names:
        p = os.path.join(wsroot, rel)
        if not os.path.exists(p):
            continue                   # 文件不存在不计（可能尚未创建）
        with io.open(p, "rb") as f:
            head = f.read(3)
        if head != b"\xef\xbb\xbf":
            bad.append(rel)
    return bad


# ---------------------------------------------------------------------------
# selftest（P-30：静态结构判据必须自带合成正负控 ——「真实仓库 0 命中」不是证据）
# ---------------------------------------------------------------------------
SELFTEST_CASES = [
    # (标签, ps1 源码, python 源码, 期望「判等价」)
    ("等价（同源同目标）",
     'Copy-Item "$stubs\\sharp\\index.js" "$runtimeDst\\node_modules\\sharp\\dist\\index.cjs" -Force',
     'STUB_MAP = [\n    ("sharp/index.js", "sharp/dist/index.cjs"),\n]\n',
     True),
    ("python 缺一条 ⇒ 应报不等价",
     'Copy-Item "$stubs\\sharp\\index.js" "$runtimeDst\\node_modules\\sharp\\dist\\index.cjs" -Force\n'
     'Copy-Item "$stubs\\koffi\\index.js" "$runtimeDst\\node_modules\\koffi\\index.js" -Force',
     'STUB_MAP = [\n    ("sharp/index.js", "sharp/dist/index.cjs"),\n]\n',
     False),
    # ★ 关键负控：模拟本轮的 landlock 形态 —— 同一源、**不同目标路径** ⇒ 必须报不等价
    ("同一源落不同目标（landlock 形态）⇒ 应报不等价",
     '$llNew = "$runtimeDst\\node_modules\\@deepseek-ai\\node-addon-system\\lib\\index.js"\n'
     'Copy-Item $landlockStub $llNew -Force',
     'STUB_MAP = [\n    ("node-addon-landlock-run/index.js", "@deepseek-ai/node-addon-landlock-run/lib/index.js"),\n]\n',
     False),
    ("python 侧 os.path.join 独立落盘也能认出（同名文件）",
     'Copy-Item "$stubs\\dsh-tool-fs-search\\android-fallback.mjs" "$runtimeDst\\node_modules\\dsh-tool-fs-search\\lib\\android-fallback.mjs" -Force',
     '_fallback_src = os.path.join(STUBS, "dsh-tool-fs-search", "android-fallback.mjs")\n'
     '_fallback_dst = os.path.join(NM, "dsh-tool-fs-search", "lib", "android-fallback.mjs")\n',
     True),
    ("两侧皆空 ⇒ 等价（不得凭空报错）", "Write-Host 'no stubs'", "log('no stubs')\n", True),
]

# 判据三（幂等口径自洽）的合成正负控 —— 与上面同一张表驱动，但判的是另一个函数
PATCH_IDEMPOTENT_CASES = [
    # (标签, ps1 源码, 期望违约数)
    ("marker 写进替换文本 ⇒ 通过",
     "Dsht-Patch \"$p\" 'DSHT-X' `\n    'old' `\n    'new /* DSHT-X */' `\n    1 'L1'",
     0),
    ("marker 只在参数里、替换文本没写 ⇒ 报 1 处",
     "Dsht-Patch \"$p\" 'DSHT-X' `\n    'old' `\n    'new' `\n    1 'L1'",
     1),
    ("marker 只在参数里，但显式传了 $Already ⇒ 通过",
     "Dsht-Patch \"$p\" 'DSHT-X' `\n    'old' `\n    'new' `\n    1 'L1' `\n    'new-form'",
     0),
    ("marker 写在 here-string 变量里（全文出现 ≥2 次）⇒ 通过（防首版误报复发）",
     "$wrap = @\"\n/* DSHT-X: 说明 */\ncode\n\"@\nDsht-Patch \"$p\" 'DSHT-X' `\n    'old' `\n    $wrap `\n    1 'L1'",
     0),
]


COLLISION_CASES = [
    # (标签, marker 列表, 期望「碰撞对数」)
    ("前缀关系（W26 实证形态：A 是 B 的真前缀）⇒ 报 1 对",
     ["DSHT-RESILIENT-LIST", "DSHT-RESILIENT-LIST-IMPORT"], 1),
    # 【用例自身的坑（P-30）】首版把「中缀」写成 `DSHT-X` ⊂ `DSHT-ANDROID-X` —— 而
    # 后者**并不含**前者这个子串（`DSHT-A…` 中间隔了 `ANDROID-`）⇒ 用例期望写错、
    # selftest 报 FAIL。真正能区分 `in` 与 `startswith` 的形态是**后缀**：
    # `DSHT-B` ⊂ `DSHT-A-DSHT-B`（`in` 为真、`startswith` 为假）。
    ("非前缀的子串形态（后缀）⇒ 必须也报（防只判前缀的漏报）",
     ["DSHT-A-DSHT-B", "DSHT-B"], 1),
    ("无子串关系 ⇒ 0（不得凭空报错）",
     ["DSHT-ANDROID-FLOCK", "DSHT-ANDROID-SH", "DSHT-SIM"], 0),
    ("完全相同不算碰撞（同一 marker 的两次出现）⇒ 0",
     ["DSHT-ANDROID-SH", "DSHT-ANDROID-SH"], 0),
    ("改名后的真实形态 ⇒ 0（W26 修复的正控）",
     ["DSHT-RESILIENT-LIST", "DSHT-RESILIENT-IMPORT"], 0),
    # ★ 词法杠杆（P-19 第十二例）：下划线族必须同样被扫到，否则判据沉默
    ("下划线族（DSHT_…）同样参与碰撞判定 ⇒ 报 1 对",
     ["DSHT_ANDROID_SIM", "DSHT_ANDROID_SIM_X"], 1),
]

# 判据四的「只取代码位置」口径负控：整行注释里的提及**不得**参与碰撞判定
COLLISION_COMMENT_CASES = [
    # 【用例自身的坑（P-30）】首版期望写成 1，但该用例的正确期望正是 **0**：
    # 注释里的 `DSHT-RESILIENT-LIST` 已被排除，代码位置只剩 `DSHT-RESILIENT-IMPORT`
    # 一个 marker ⇒ 不可能有碰撞对。写 1 等于在断言「判据该被注释撑红」—— 方向反了。
    ("整行注释里的 marker 提及 ⇒ 不参与（防判据被注释撑红）",
     "# 历史：这里曾用 DSHT-RESILIENT-LIST …\nconst M = 'DSHT-RESILIENT-IMPORT'",
     0,
     ),
    ("注释里写了旧名 + 代码里是旧名 ⇒ 仍按代码位置判（1 对）",
     "# 说明\nconst A = 'DSHT-RESILIENT-LIST'\nconst B = 'DSHT-RESILIENT-LIST-IMPORT'",
     1,
     ),
    # ★ 杠杆：同一对 marker，一次写成引号字面量（判据应认）、一次写成行内注释里的裸词
    # （判据不应认）⇒ 证明「引号字面量」口径真有区分力，而不是把所有 DSHT_ 词都收进来
    ("行内注释里的裸词不参与（引号字面量口径的区分力）⇒ 0",
     "const M = 'DSHT-RESILIENT-IMPORT'; // 旧名 DSHT-RESILIENT-LIST 已废弃",
     0,
     ),
    # ★ 词法杠杆：下划线 marker 必须被引号字面量口径收进来
    ("下划线族的引号字面量能被认出（防词法收窄）⇒ 1 对",
     "$sj -notmatch 'DSHT_ANDROID_SIM_X'\nconst M = 'DSHT_ANDROID_SIM'",
     1,
     ),
]


# 判据三（python 侧）的合成正负控
PY_PATCH_IDEMPOTENT_CASES = [
    # (标签, python 源码, 期望违约数)
    ("marker 写进 repl ⇒ 通过",
     'patch(p, "DSHT-X", r"old", "new /* DSHT-X */", 1, "L1")\n', 0),
    ("marker 没写进 repl ⇒ 报 1 处",
     'patch(p, "DSHT-X", r"old", "new", 1, "L1")\n', 1),
    ("repl 是多行字符串拼接（marker 在其中）⇒ 通过（防正则失手）",
     'patch(p, "DSHT-X", r"old", "part1\\n" "part2 /* DSHT-X */", 1, "L1")\n', 0),
    ("repl 是模块级常量（marker 在常量里）⇒ 通过（防正则失手）",
     'W = "code /* DSHT-X */"\npatch(p, "DSHT-X", r"old", W, 1, "L1")\n', 0),
    ("实参无法静态求值（f-string 插值）⇒ 报 1 处（不许静默放过）",
     'patch(p, "DSHT-X", r"old", f"new {v}", 1, "L1")\n', 1),
]


def selftest():
    print("=== audit-build-path-parity --selftest（判据自身正/负控）===")
    npass = 0
    total = 0
    for label, ps1_src, py_src, want_ok in SELFTEST_CASES:
        p = ps1_stub_pairs(ps1_src)
        y = py_stub_pairs(py_src)
        ok = (p == y)
        good = (ok == want_ok)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据二 %s（ps1=%d py=%d 判等价=%s 期望=%s）"
              % (label, len(p), len(y), ok, want_ok))
        if good:
            npass += 1
    for label, ps1_src, want_n in PATCH_IDEMPOTENT_CASES:
        got = len(patch_idempotent_violations(ps1_src))
        good = (got == want_n)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据三(ps1) %s（违约数=%d 期望=%d）" % (label, got, want_n))
        if good:
            npass += 1
    for label, py_src, want_n in PY_PATCH_IDEMPOTENT_CASES:
        got = len(py_patch_idempotent_violations(py_src))
        good = (got == want_n)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据三(py) %s（违约数=%d 期望=%d）" % (label, got, want_n))
        if good:
            npass += 1
    for label, ms, want_n in COLLISION_CASES:
        got = len(marker_substring_collisions(ms))
        good = (got == want_n)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据四 %s（碰撞对数=%d 期望=%d）" % (label, got, want_n))
        if good:
            npass += 1
    for label, src, want_n in COLLISION_COMMENT_CASES:
        got = len(marker_substring_collisions(marker_literals(src)))
        good = (got == want_n)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据四（口径）%s（碰撞对数=%d 期望=%d）" % (label, got, want_n))
        if good:
            npass += 1

    # ---- 判据五：BOM 检测（合成文件正负控 + 真实仓库负控）----
    # 【为什么不能只判真实仓库】「真实仓库 0 命中」不是证据（P-30）：
    #   若 ps1_missing_bom 写成恒 False，真实仓库也会报「0 个缺失」⇒ 输出一模一样。
    #   ⇒ 必须在**临时目录**里造出「带 BOM / 不带 BOM / 空文件 / 文件不存在」四种形态。
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix="bom-selftest-")
    cases = [
        ("带 BOM ⇒ 不算缺失", b"\xef\xbb\xbf# x\n", False),
        ("不带 BOM ⇒ 必须算缺失", b"# x\n", True),
        ("★ 空文件（0 字节）⇒ 也算缺失（不得因读不到内容而静默放过）", b"", True),
        ("★ 只有 2 字节（半个 BOM）⇒ 算缺失", b"\xef\xbb", True),
    ]
    for label, content, want_missing in cases:
        p = os.path.join(tmpdir, "t.ps1")
        with io.open(p, "wb") as f:
            f.write(content)
        got = ps1_missing_bom(p)
        good = (got == want_missing)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据五 %s（missing=%s 期望=%s）" % (label, got, want_missing))
        if good:
            npass += 1
    # 文件不存在 ⇒ None（由调用方另行处理，不得当成「缺 BOM」或「有 BOM」）
    got = ps1_missing_bom(os.path.join(tmpdir, "nope.ps1"))
    good = (got is None)
    total += 1
    print(("[ok] " if good else "[FAIL] ") + "判据五 文件不存在 ⇒ None（不得冒充有/无 BOM）（missing=%s 期望=None）" % got)
    if good:
        npass += 1

    # ★ 自动发现这一层也要有判据（P-41 推论三）：目录里造 3 个 .ps1 + 1 个 .sh ⇒
    #   必须只发现 3 个 ps1（防「把非 ps1 也扫进来」/「漏扫」两种反向失准）。
    disc = os.path.join(tmpdir, "scan")
    os.makedirs(disc, exist_ok=True)
    for fn, content in (("a.ps1", b"\xef\xbb\xbf# a\n"), ("b.ps1", b"# b\n"),
                        ("c.PS1", b"\xef\xbb\xbf# c\n"), ("d.sh", b"# d\n"),
                        ("e.txt", b"# e\n")):
        with io.open(os.path.join(disc, fn), "wb") as f:
            f.write(content)
    found = ps1_bom_required_names(disc)
    # 大小写不敏感地认 .ps1（c.PS1 也要被发现）⇒ 期望 3 个，且不含 d.sh / e.txt
    good = (len(found) == 3) and all(not n.endswith((".sh", ".txt")) for n in found)
    total += 1
    print(("[ok] " if good else "[FAIL] ") + "判据五 自动发现 .ps1（含大写扩展名；排除非 ps1）"
          "（发现=%s 期望=3 个 ps1）" % found)
    if good:
        npass += 1
    # ★ 空目录 ⇒ 返回 []（调用方据此判「没有判据力」，而不是静默通过）
    empty = os.path.join(tmpdir, "empty")
    os.makedirs(empty, exist_ok=True)
    good = (ps1_bom_required_names(empty) == [])
    total += 1
    print(("[ok] " if good else "[FAIL] ") + "判据五 空目录 ⇒ []（让调用方能判「没有判据力」）")
    if good:
        npass += 1
    # ★ 不存在的目录 ⇒ []（不得抛异常把整条门禁带崩）
    good = (ps1_bom_required_names(os.path.join(tmpdir, "no-such-dir")) == [])
    total += 1
    print(("[ok] " if good else "[FAIL] ") + "判据五 目录不存在 ⇒ []（不得抛异常）")
    if good:
        npass += 1
    try:
        import shutil
        shutil.rmtree(tmpdir)
    except OSError:
        pass

    # ★ **真实仓库负控**：临时剥掉 build-dsht.ps1 的 BOM ⇒ 必须报红；然后逐字节还原 ⇒ 回绿。
    #   （L144：负控要改真实对象才有说服力 —— 合成文件证明不了「扫的是真文件」。）
    real = os.path.join(HERE, "build-dsht.ps1")
    if os.path.exists(real):
        with io.open(real, "rb") as f:
            orig = f.read()
        try:
            with io.open(real, "wb") as f:
                f.write(orig[3:])                       # 剥掉 BOM（前半句是事实：本文件确有 BOM）
            broke = len(ps1_bom_violations(["build-dsht.ps1"]))
        finally:
            with io.open(real, "wb") as f:
                f.write(orig)                           # 逐字节还原
        with io.open(real, "rb") as f:
            byte_identical = (f.read() == orig)
        restored = len(ps1_bom_violations(["build-dsht.ps1"]))
        good = (broke == 1 and restored == 0 and byte_identical)
        total += 1
        print(("[ok] " if good else "[FAIL] ") +
              "判据五（真实仓库负控）剥 BOM ⇒ 报红；还原 ⇒ 回绿、逐字节一致"
              "（剥后违约=%d 期望=1 · 还原后=%d 期望=0 · 逐字节一致=%s）"
              % (broke, restored, byte_identical))
        if good:
            npass += 1

    # ---- 判据五续：被 PS 读取的数据文件（含中文）必须带 BOM ----
    # 【为什么不能只判真实仓库】同 P-30：若 data_bom_violations 写成恒返 []，
    #   真实仓库也会「0 命中」⇒ 失效与通过输出完全相同 ⇒ 必须造合成正负控。
    #   ★ 关键负控：**文件不存在时必须跳过**（不计违约）—— 否则「尚未创建的配置」
    #     会被当违规，而那是假红（会训练人忽略报警，P-38 同源）。
    for label, content, want_bad in (
        ("带 BOM ⇒ 不算缺失", b"\xef\xbb\xbf{\"a\":1}\n", False),
        ("★ 不带 BOM ⇒ 必须算缺失（W28 实测的受害形态）", b"{\"a\":1}\n", True),
        ("★ 空文件 ⇒ 也算缺失（不得因读不到内容而放过）", b"", True),
    ):
        rel = "tmp/_selftest_data_bom.json"
        p = os.path.join(os.path.dirname(HERE), rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "wb") as f:
            f.write(content)
        got = data_bom_violations([rel])
        good = (bool(got) == want_bad)
        total += 1
        print(("[ok] " if good else "[FAIL] ") + "判据五续 %s（违约=%s 期望=%s）" % (label, got, want_bad))
        if good:
            npass += 1
        try:
            os.remove(p)
        except OSError:
            pass
    # 不存在的文件 ⇒ 跳过（不计违约）
    got = data_bom_violations(["tmp/_definitely_not_here.json"])
    good = (got == [])
    total += 1
    print(("[ok] " if good else "[FAIL] ") + "判据五续 文件不存在 ⇒ 跳过（不计违约；防假红）"
          "（违约=%s 期望=[]）" % got)
    if good:
        npass += 1
    # ★ 真实仓库负控：剥 dsh-version.json 的 BOM ⇒ 必须报红；还原 ⇒ 回绿、逐字节一致
    #   （这正是 W28 真实踩到的形态 —— 构建 Step 0.7 被它中断过）
    dv = os.path.join(os.path.dirname(HERE), "dsh-version.json")
    if os.path.exists(dv):
        with io.open(dv, "rb") as f:
            dv_orig = f.read()
        try:
            with io.open(dv, "wb") as f:
                f.write(dv_orig[3:])
            broke = len(data_bom_violations(["dsh-version.json"]))
        finally:
            with io.open(dv, "wb") as f:
                f.write(dv_orig)
        with io.open(dv, "rb") as f:
            dv_same = (f.read() == dv_orig)
        restored = len(data_bom_violations(["dsh-version.json"]))
        good = (broke == 1 and restored == 0 and dv_same)
        total += 1
        print(("[ok] " if good else "[FAIL] ") +
              "判据五续（真实仓库负控）剥 dsh-version.json 的 BOM ⇒ 报红；还原 ⇒ 回绿、逐字节一致"
              "（剥后违约=%d 期望=1 · 还原后=%d 期望=0 · 逐字节一致=%s）"
              % (broke, restored, dv_same))
        if good:
            npass += 1

    # ★ W48：接入**单源自证分数输出契约**（`selftest_summary.py`）。
    #   为什么：W44 建立的契约只覆盖 `.mjs` 闸门 ⇒ 本脚本（以及另 4 个 `.py` 闸门）
    #   的自证分数**机器读不出** ⇒ 文档里的分数声明**无法被证伪**（P-45：
    #   扫描面与真目标错位）。接入后 `audit-selftest-claims.mjs` 可逐条比对。
    report_selftest('build-path-parity', npass, total)
    return npass == total


def main():
    for p in (PS1, PY):
        if not os.path.exists(p):
            print("✗ 找不到文件：%s" % p)
            return 2

    with io.open(PS1, "r", encoding="utf-8", errors="replace") as f:
        ps1_text = f.read()
    with io.open(PY, "r", encoding="utf-8", errors="replace") as f:
        py_text = f.read()

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

    # ---- 判据二：stub 落盘清单 ----
    p_stubs = ps1_stub_pairs(ps1_text)
    y_stubs = py_stub_pairs(py_text)
    s_only_ps1 = sorted(p_stubs - y_stubs - set(STUB_EXEMPT))
    s_only_py = sorted(y_stubs - p_stubs - set(STUB_EXEMPT))
    s_both = sorted(p_stubs & y_stubs)
    print("stub 落盘项：ps1 %d 个 | python %d 个 | 共同 %d 个" % (len(p_stubs), len(y_stubs), len(s_both)))
    if STUB_EXEMPT:
        print("stub 豁免（已注明理由）：")
        for k in sorted(STUB_EXEMPT):
            print("    · %s → %s" % (k[0], k[1]))
    # 提示：stubs/ 下有、但两侧都没落盘的源文件（**不算违约**，但值得看 —— 本轮就出现过）
    if os.path.isdir(STUBS):
        all_src = []
        for root, _dirs, files in os.walk(STUBS):
            for fn in files:
                all_src.append(os.path.relpath(os.path.join(root, fn), STUBS).replace("\\", "/"))
        covered = {s for s, _ in p_stubs} | {s for s, _ in y_stubs}
        orphans = sorted(set(all_src) - covered)
        if orphans:
            print("ⓘ stubs/ 下存在**两侧都没落盘**的源文件（提示，非违约）：")
            for o in orphans:
                print("    · %s" % o)
    print()

    ok1 = not only_ps1 and not only_py
    ok2 = not s_only_ps1 and not s_only_py

    # ---- 判据三：Dsht-Patch 调用点的幂等口径自洽（W26）----
    idem_bad = patch_idempotent_violations(ps1_text)
    py_idem_bad = py_patch_idempotent_violations(py_text)
    n_calls = len(ps1_dsht_patch_calls(ps1_text))
    print("Dsht-Patch 调用点 %d 处 | 幂等口径不自洽 %d 处" % (n_calls, len(idem_bad)))
    print("python patch() 调用点 %d 处 | 幂等口径不自洽 %d 处"
          % (py_patch_call_count(py_text), len(py_idem_bad)))
    if PATCH_IDEMPOTENT_EXEMPT:
        print("幂等豁免（已注明理由）：%s" % ", ".join(sorted(PATCH_IDEMPOTENT_EXEMPT)))
    if PY_PATCH_IDEMPOTENT_EXEMPT:
        print("python 侧幂等豁免（已注明理由）：%s" % ", ".join(sorted(PY_PATCH_IDEMPOTENT_EXEMPT)))
    if KNOWN_SEMANTIC_IDEMPOTENT:
        print("已知已收口（幂等判据改锚到语义/形态）：")
        for k, v in sorted(KNOWN_SEMANTIC_IDEMPOTENT.items()):
            print("    · %s —— %s" % (k, v))
    print()
    ok3 = not idem_bad and not py_idem_bad

    # ---- 判据四：补丁 marker 之间不得互为子串（W26）----
    RESILIENT = os.path.join(HERE, "patch-resilient-list.mjs")
    col_srcs = [("build-dsht.ps1", ps1_text), ("apply-platform-patches.py", py_text)]
    if os.path.exists(RESILIENT):
        with io.open(RESILIENT, "r", encoding="utf-8", errors="replace") as f:
            col_srcs.append(("patch-resilient-list.mjs", f.read()))
    all_markers = set()
    per_src = {}
    for name, txt in col_srcs:
        ms = marker_literals(txt)
        per_src[name] = ms
        all_markers |= ms
    collisions = [p for p in marker_substring_collisions(all_markers)
                  if p not in set(MARKER_COLLISION_EXEMPT)]
    print("补丁 marker 子串碰撞：扫描 %d 个脚本 / 引号字面量 marker %d 个 | 碰撞 %d 对"
          % (len(col_srcs), len(all_markers), len(collisions)))
    if MARKER_COLLISION_EXEMPT:
        print("碰撞豁免（已注明理由）：%s" % ", ".join("%s ⊂ %s" % p for p in sorted(MARKER_COLLISION_EXEMPT)))
    print()
    ok4 = not collisions

    # ---- 判据五：构建侧 .ps1 必须带 UTF-8 BOM（W28）----
    bom_names = ps1_bom_required_names(PS1_BOM_SCAN_DIR)
    bom_bad = ps1_bom_violations(bom_names)
    print("构建侧 .ps1 的 UTF-8 BOM：自动发现 %d 个 | 缺 BOM %d 个"
          % (len(bom_names), len(bom_bad)))
    if not bom_names:
        # 【两端设防（P-42 同族）】扫描面为 0 ⇒ 判据**没有判据力**，必须出声报红，
        # 而不是"0 个违约"（那正是「样本为 0 也要报红」的场景）。
        print("  ❌ 一个 .ps1 都没发现（扫描目录 %s）⇒ 本判据没有判据力，不是「全部通过」" % PS1_BOM_SCAN_DIR)
    if bom_bad:
        # 出声给出「为什么这是硬约束」（报错位置会漂到远处，极易误诊）
        print("  ❌ 缺 BOM 的脚本在 Windows PowerShell 5.1（powershell -File）下会**语法解析失败**，")
        print("     且报错位置漂到远处（实测：无 BOM ⇒ 54 处语法错误，报在第 123 行的 JSON 字面量上）。")
        print("     ⇒ 修法：补回 3 字节 BOM（EF BB BF）。")

    # 判据五续：被 PS 读取的**数据文件**（含中文）也必须带 BOM。
    # 为什么单列：它们的受害方式不同 —— **文件本身是合法 JSON**，node 侧读它一直是好的
    # ⇒ 只有 PS 侧报「Invalid object passed in」（且附中文乱码）⇒ 单看 node 永远发现不了。
    data_bad = data_bom_violations(PS1_READ_DATA_FILES)
    print("被 PowerShell 读取的数据文件（含中文）BOM：检查 %d 个 | 缺 BOM %d 个"
          % (len(PS1_READ_DATA_FILES), len(data_bad)))
    if data_bad:
        print("  ❌ 这些文件**含中文且无 BOM** ⇒ PS 5.1 `Get-Content -Raw | ConvertFrom-Json` 会按 GBK")
        print("     解码 ⇒ 中文乱码 ⇒ JSON 结构破坏 ⇒ 构建在该步骤**直接中断**（实测：Step 0.7）。")
        print("     ⚠️ 它们的 node 侧读取一直是好的（合法 UTF-8 JSON）—— 故**必须由本条守**。")
        print("     ⇒ 修法：文件补 3 字节 BOM **且** node 侧读取剥离 BOM（两侧要求相反，见文件内注释）。")
    print()
    ok5 = (not bom_bad) and bool(bom_names) and (not data_bad)

    if ok1 and ok2 and ok3 and ok4 and ok5:
        print("✓ 两条路径等价且幂等口径自洽：补丁 marker %d 个共同 + stub 落盘 %d 项共同 + Dsht-Patch %d 处自洽 + marker 无子串碰撞 + .ps1 均带 BOM"
              % (len(both), len(s_both), n_calls))
        print("  共同 marker：%s" % ", ".join(both))
        print("  共同 stub：%s" % ", ".join("%s→%s" % t for t in s_both))
        return 0

    if not ok1:
        print("✗ 补丁 marker 集**不等价** —— 只走缺 marker 的那条路径时该补丁会丢失：")
        if only_py:
            print("\n  【python 有、ps1 缺】（ps1 完整安装会缺这些补丁）：")
            for m in only_py:
                print("    · %s" % m)
        if only_ps1:
            print("\n  【ps1 有、python 缺】（python 路径会缺这些补丁）：")
            for m in only_ps1:
                print("    · %s" % m)
    if not ok2:
        print("✗ stub 落盘清单**不等价** —— 只走缺该项的那条路径时该 stub 不会生效")
        print("  （这类差异**没有 marker 可比**，故必须由本判据单独守 —— 见文件头「判据二」）：")
        if s_only_py:
            print("\n  【python 有、ps1 缺】：")
            for a, b in s_only_py:
                print("    · %s → %s" % (a, b))
        if s_only_ps1:
            print("\n  【ps1 有、python 缺】：")
            for a, b in s_only_ps1:
                print("    · %s → %s" % (a, b))
    if not ok3:
        print("✗ 补丁调用的**幂等口径不自洽** —— 这些调用点的 marker 没写进替换文本，"
              "也没传 $Already 形态判据：")
        print("  （后果：`-SkipInstall` 第二次运行时 markerCount=0 ⇒ 去匹配已被替换掉的锚点 ⇒")
        print("    throw「补丁未命中目标」，**报错文案会指向「官方改了产物形态」，而实际是产物早就打好了**）")
        for lineno, marker, label in idem_bad:
            print("    · [ps1] 行 %d  [%s]  %s" % (lineno, marker, label))
        for lineno, marker, label in py_idem_bad:
            print("    · [py ] 行 %d  [%s]  %s" % (lineno, marker, label))
        print("  处置：① 把 marker 写进替换文本（首选，让代理量与事实对齐）；或")
        print("        ② 给该调用传 `$Already`（已生效形态的正则）；或")
        print("        ③ 把幂等判据改锚到「语义已生效」，并在 KNOWN_SEMANTIC_IDEMPOTENT 登记理由。")
    if not ok4:
        print("✗ 补丁 marker 之间存在**子串关系** —— 短的那个会被长的那个误判成「已打过」：")
        print("  （后果：短 marker 的主体补丁**静默跳过**，exit 0、输出还像成功；")
        print("    实证：`DSHT-RESILIENT-LIST` 曾 ⊂ `DSHT-RESILIENT-LIST-IMPORT`，见 W26 决定性实验）")
        for a, b in collisions:
            print("    · %s  ⊂  %s" % (a, b))
        print("  处置：把其中一个改名，使任意两个 marker 互不为子串；")
        print("        或在本脚本 MARKER_COLLISION_EXEMPT 里写明理由后豁免。")
    if not ok5:
        print("✗ 构建侧 .ps1 **缺 UTF-8 BOM** —— 在 Windows PowerShell 5.1 下会导致语法解析失败：")
        for n in bom_bad:
            print("    · scripts/%s" % n)
        print("  （机制：5.1 **无 BOM 时按系统 ANSI 代码页解码** ⇒ 中文注释变乱码 ⇒ 引号配对被打断"
              " ⇒ 报错位置漂到远处、且文案是「Missing argument」/「Unexpected token」这类**语法**措辞。）")
        print("  （实测：同一份字节，带 BOM ⇒ 0 处语法错误；无 BOM ⇒ 54 处。⚠️ 必须用 powershell.exe（5.1）验，"
              "PS7 默认 UTF-8、两次都是 0。）")
        print("  处置：给文件开头补回 3 字节 BOM（EF BB BF）；**不要**靠「我记得」——剥离者是编辑器/工具链。")
    if not ok5 and data_bad:
        for rel in data_bad:
            print("    · %s（被 PS 读取的**数据文件**，含中文）" % rel)
        print("  （数据文件与 .ps1 的**受害方式不同**：它本身是**合法 JSON**，node 侧读它一直是好的"
              " ⇒ **单看 node 侧永远发现不了**；只有 PS 5.1 的默认编码会解成乱码 ⇒ 构建中断。）")
        print("  （实测：`Get-Content -Raw | ConvertFrom-Json` 对无 BOM 中文 JSON ⇒ `Invalid object passed in` "
              "⇒ Step 0.7 fail-closed 直接 throw。）")
        print("  处置：文件补 BOM **且** node 侧读取剥离 BOM（两侧要求相反：node `JSON.parse` 对 BOM 会抛错）。")
    print("\n处置：把缺失项补进对应脚本，或在本脚本 EXEMPT / STUB_EXEMPT / PATCH_IDEMPOTENT_EXEMPT 里写明理由后豁免。")
    return 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 3)
    sys.exit(main())
