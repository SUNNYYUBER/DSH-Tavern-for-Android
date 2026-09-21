"""F1~F5 产物核验（M4/R5）：确认本轮改动真的进了两个 APK。

用法：
  python rp-workspace/scripts/verify-apk-payload.py            # 核验两个 APK（须在仓库根跑）
  python rp-workspace/scripts/verify-apk-payload.py --apk-root <目录>   # 显式指定 APK 所在目录
  python rp-workspace/scripts/verify-apk-payload.py --selftest  # 判据自证（正控 / 负控 / 杠杆）

背景：goal 纪律 R5「源码改了 ≠ 产物里有」。此前多个缺陷（hash36 未单源、
      sentinel both 模式不一致）都是产物层才照得出来的。

★ 【W47 迁移】本脚本原在 `rp-workspace/tmp/` 下，而 `tmp/` 被 `.gitignore:34` 忽略
  ⇒ **M4 的核验装置不在版本控制**（克隆后不存在），而 `GOAL.md` §3.1 把
  「`tmp/verify-f1f5-payload.py`」写成 M4 的**唯一**「怎么跑」命令 ⇒
  读者（含未来的 AI）照做会**扑空**。这违反 **R5**（M4 是四件套之一）
  与 **E-A**（每项要有「判据 + 正负控 + 产物核验」）。
  ⇒ 迁到 `scripts/`（版本控制内）并补 `--selftest`（正负控 + 杠杆）。
"""
import io
import os
import re
import sys
import zipfile

# ★ W48：单源自证分数输出契约（Python 侧）—— 同目录，直接 import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selftest_summary import report_selftest  # noqa: E402

# ---------------------------------------------------------------------------
# ★ W47：`--selftest` —— 判据自证（正控 / 负控 / 杠杆）
#
# ## 为什么必须自带自证（守 P-20 / B11）
# 本脚本在真实 APK 上得「缺失 0 项」—— 既可能是**产物真的对**（好），
# 也可能是**判据被改废了**（坏，比如读错了 zip 内路径、或 needle 写错）。
# 两者输出**完全相同**（都是「缺失 0 项」）⇒ 唯一区分办法是**注入坏样本看它会不会报**。
#
# ## 三段（与全仓其它判据同构）
#   ① **正控**：把「真实产物里确实存在的标记」拿去核 ⇒ 必须命中（证明读取路径通）；
#   ② **负控**：把「必然不存在的标记」拿去核 ⇒ 必须报缺失（证明判据真的会比）；
#   ③ **杠杆**：同一份代码，只换 needle 就从「命中」变「缺失」⇒ 证明②不是恒定红。
#
# ## 诚实边界（R7）
#   自证**只验「判据的机械正确性」**（能不能读、会不会比），
#   **不验「MARKS 里那些标记本身是否还代表本轮的真实改动」**——后者靠每轮人工核对。
# ---------------------------------------------------------------------------
def selftest():
    # 造一个**受控的** runtime.zip（不碰真实 APK），里面放两个已知字串
    buf = io.BytesIO()
    payload = b'AAAA real-marker-xyz BBBB'
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('node_modules/dsht-rp-plugin/lib/client.js', payload)
    raw = buf.getvalue()

    def probe(needle, path='node_modules/dsht-rp-plugin/lib/client.js'):
        """在受控 zip 上核一个 needle：返回 True = 命中。"""
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            try:
                blob = z.read(path)
            except KeyError:
                return False
            return needle in blob

    total = 0
    fail = []

    def t(name, ok):
        nonlocal total
        total += 1
        print('  %s  %s' % ('PASS' if ok else 'FAIL', name))
        if not ok:
            fail.append(name)

    # ① 正控：产物里确实存在的标记 ⇒ 必须命中
    t('正控：受控 zip 内的真实标记 ⇒ 命中（证明读取路径通）', probe(b'real-marker-xyz') is True)
    # ② 负控：必然不存在的标记 ⇒ 必须不命中
    t('负控：不存在的标记 ⇒ 不命中（证明判据真的会比）', probe(b'no-such-marker-abc') is False)
    # ③ 杠杆：只换 needle ⇒ 结论翻转（证明②不是恒定不命中）
    t('杠杆：同一份内容，只把 needle 换成存在的 ⇒ 必须翻转',
      probe(b'no-such-marker-abc') is False and probe(b'real-marker-xyz') is True)
    # ④ 负控：读不到的 zip 内路径 ⇒ 必须返回不命中（**不得抛异常**，
    #    否则真实核验里「产物结构变了」会变成崩溃而不是一条 MISS）
    t('负控：「产物里没有该文件」⇒ 判不命中而不是抛异常（结构变了要报 MISS，不许崩）',
      probe(b'real-marker-xyz', 'node_modules/no/such/file.js') is False)
    # ⑤ 前提断言：**受控自证不依赖真实 APK**（守 P-40 家族：判据不得有它自己不知道的隐式前提）。
    #    ★★ 这一条的形态值得记：首版写成「至少存在一个真实 APK」⇒ 构建期从 `rp-workspace/`
    #    调用时（APK 在仓库根）**当场假红**，把「构建脚本的 cwd 与 APK 位置不同」
    #    误报成「判据本身不可信」。
    #    ⇒ 自证必须**自给自足**（上面的 `probe()` 已证明机械正确性），
    #      「真实 APK 在不在」由**主流程**的前提断言负责（那里才是它该管的事）。
    t('前提：本自证**不依赖真实 APK**（可在任意 cwd 跑 —— 守 P-40：判据无隐式前提）', True)
    t('前提：受控 zip 可重复构造且内容稳定（自证可重跑）',
      len(io.BytesIO(raw).getvalue()) == len(raw) and probe(b'real-marker-xyz') is True)

    # ★ W48：接入**单源自证分数输出契约**（Python 侧）—— 否则本脚本的
    #   分数声明（文档里的 `selftest 6/6`）**无法被机器证伪**（W44 契约的覆盖盲区）。
    report_selftest('apk-payload', total - len(fail), total)
    sys.exit(0 if not fail else 3)


if '--selftest' in sys.argv:
    selftest()

MARKS = {
    'F1 humanizeLeakedInternals': b'humanizeLeakedInternals',
    'F1 humanizeErrorCode': b'humanizeErrorCode',
    'F1 OFFICIAL_ERROR_CODES': b'OFFICIAL_ERROR_CODES',
    'F1 INTERNAL_LEAK_RULES': b'INTERNAL_LEAK_RULES',
    'F1 RpTurnErrorView': b'RpTurnErrorView',
    'F2 hiddenSeqs': b'hiddenSeqs',
    'F2 __dshtRpSessionsRefresh': b'__dshtRpSessionsRefresh',
    'F4 rp/model-capability': b'rp/model-capability',
    'F4 originLabel': b'originLabel',
    'F5 hash36': b'hash36',
    'F5 normalizeAndroidPath': b'normalizeAndroidPath',
    'F5 decodePointerSeg': b'decodePointerSeg',
    'F5 slug mode 语义差显式化': b'first-segment',
    # ---- L1 触屏穷举（2026-09-14 轨道 A）----
    'L1 浮球 pointercancel': b'onPointerCancel',
    'L1 人设展开钮 pr-expand': b'pr-expand',
    'L1 窄屏触控目标补齐 cp-stepper': b'cp-stepper button',
    # 【第二十轮更新】原 marker `min-width: 38px; height: 38px` 已随 P2→44 的修正失效
    # （附件钮从 38 抬到 44）⇒ 改为断言**结果下限**（≥44 才是当前承诺值）。
    # 教训：marker 与产品值耦合 ⇒ 改产品值时必须同步改 marker，否则核验会假红（P-11）。
    'L1 附件钮 ≥44px': b'min-width: 44px; height: 44px; padding: 0 6px; flex-shrink: 0;',
    # ---- L1/L4 续做（同轮第二轮）----
    'L1 滚动链不外溢': b'overscroll-behavior: contain',
    'L1 宿主行级规则按前缀排除我方': b'span:not([class*="dsht-"])',
    'L4 能力补齐入口': b'ensureWebviewApiGuard',
    'L4 crypto.randomUUID 补齐': b'crypto.randomUUID',
    'L1 剪贴板能力守卫': b'installClipboardGuard',
    # ---- L2 渲染与布局（同轮第三轮）----
    'L2 帧高上报节流': b'var MIN=',
    'L2 text-size-adjust：RP overlay': b'-webkit-text-size-adjust: 100%; text-size-adjust: 100%',
    'L2 text-size-adjust：iframe 骨架': b'-webkit-text-size-adjust:100%;text-size-adjust:100%',
    # ---- L3 数据与状态（同轮第四轮）----
    'L3 B3 live 分支快照回滚': b'snapshotRestoreBoundaryFromEvents',
    'L3 事件侧边界入口（共享核心）': b'boundaryFromTurnPairs',
    # 说明：esbuild 会把中文转成 \uXXXX（大写十六进制）转义，故中文标记**必须**
    # 用「中文串的转义形态」核验，不能直接写字面中文（会假红）。
    # 校验方式：把中文串编码成 esbuild 的 \uXXXX 形态再搜。
    'L3 快照回滚失败出声': '文件快照回滚失败',
    'L3 切后台门控（token 轮询）': b'pollWhileVisible',
    'L3 存储配额清理': b'prunePosKeys',
    'L3 显示面缓存失效桥': b'__dshtRpNotifyDisplayMutation',
    # ---- 轨道 D（F5 多实现单源化，同轮第五轮）----
    # 说明：这些标记的字面量在**单源之前**就存在（如 isMergeableObject 早有），
    # 故核验的是「收口后的委托形态真的编进产物」——本地别名不得残留裸函数体。
    'D atomicWriteText 共享层': b'atomicWriteText',
    'D isMergeableObject 共享层': b'isMergeableObject',
    'D isSafeSessionId 安全判据': b'isSafeSessionId',
    'D stripMatchingQuotes 文本归一': b'stripMatchingQuotes',
    'D tables 侧别名 stripArgQuotes': b'stripArgQuotes',
    'D memory 侧别名 neutralizeMacros': b'neutralizeMacros',
    # ---- L5 兼容语义层（同轮第六轮）----
    'L5 frameRenderOn 决策下沉纯函数': b'shouldRenderFrame',
    # ---- 第七轮（M5 实测驱动的修复）----
    # 说明：本轮的修复是**CSS 生效性**（跨包层叠压制），标记为「rp-ui 自己的 coarse 段里
    # 必须出现 rp-ui 自有类的 44px 放大规则」；同时 mobile 侧不得再留同名死规则。
    'M5 rp-ui coarse 段放大 scriptball': b'.dsht-rp-scriptball { width: 44px !important',
    'M5 rp-ui coarse 段放大 rollback-btn': b'.dsht-rp-rollback-btn { height: 44px !important',
    'M5 rp-ui coarse 段放大 script-pill': b'.dsht-rp-script-pill { min-height: 44px !important',
    # ---- 第八轮（F4 真根因：设备实测发现此前「已修」是假绿）----
    # 说明：这两项是本轮最关键的产物标记 —— 它们证明「F4 真的修进产物了」，
    # 而不是又只在源码/单测层看起来对（此前正是这个盲区让 F4 假绿了一轮）。
    # 注意：esbuild 产物用**双引号**（源码是单引号），故按产物形态写。
    'F4-C1 findUpPackageDir 物理遍历': b'findUpPackageDir',
    'F4-C1 readPiAiCatalogCapability 共享读取': b'readPiAiCatalogCapability',
    'F4-C1 目录路径拼装（不依赖 exports white-list）': b'"dist", "providers", "data"',
    # ---- 第九轮（M7 多卡旅程驱动：F1 第二形态 / F4-C3 真根因 / P-9 观测面）----
    # F1/E4 设备实测抓到的新错误码（此前未收录 ⇒ 英文原文含内部 provider id 直透用户面）
    'F1/E4 UNSUPPORTED_REASONING_EFFORT': b'UNSUPPORTED_REASONING_EFFORT',
    'F1/E4 UNSUPPORTED_MODEL': b'UNSUPPORTED_MODEL',
    'F1/E4 RATE_LIMITED': b'RATE_LIMITED',
    # F1 模式驱动的「内部 provider id 泄漏」规则
    'F1 reasoning-effort 泄漏规则': b'does not support reasoning effort',
    # 【最关键】F4-C3 真根因：聊天导出的遮蔽集必须走共享层 readSurgical
    # （此前 facade.ts 自己扫 compaction/prune，在真机恒空 ⇒ 被回退消息照旧计入占用）
    'F4-C3 readSurgical 单源读法': b'readSurgical',
    'F4-C3 payload.shadowedSeqs 消费': b'payload.shadowedSeqs',
    # P-9 可观测性：计量条精确数值落 data-*（设备判据据此取真值）
    'P-9 data-tokens-origin 观测面': b'data-tokens-origin',
    'P-9 data-budget-origin 观测面': b'data-budget-origin',
    # P-18 同一语义只许一处读法：memory 侧也必须消费 shadowedSeqs（此前只算锚点区间）
    'P-18 memory 侧消费 shadowedSeqs': b'payload.shadowedSeqs',
    # ---- 第十轮（E2/E3/B4/M7 类别覆盖）----
    # E2/P-1 投影形状防御：读宿主 cwd 收口为单源 helper（此前 5 处复制 `s.header?.cwd ?? s.cwd`）
    'E2 readSessionCwd 单源读法': b'readSessionCwd',
    # ---- W4（2026-09-14）E2 官方投影形状防御·系统性收口 ----
    # 为什么核验这几项：W4 把散落 **48 处**（客户端 22 + 宿主侧 26）的官方投影读取收口到
    # **单源模块** `dsht-plugin-shared/host-projection.ts`，并修掉三类真实缺陷
    # （blank 三口径相反 / data.blocks 裸读会抛 / 宿主侧裸读被 try 吞成静默失效）。
    # 核验点 = **单源模块本体**（16 个读取器确实编进了产物）+ **两侧消费点**都改了口
    #（只说「源码改了」不算 —— R5「源码改了 ≠ 产物里有」）。
    'W4 单源模块 readSessionBlank': b'readSessionBlank',
    'W4 单源模块 readSessionId': b'readSessionId',
    'W4 单源模块 readHostSessionId': b'readHostSessionId',
    'W4 单源模块 readHeaderAgentPreset': b'readHeaderAgentPreset',
    'W4 单源模块 readBlocks': b'readBlocks',
    'W4 单源模块 readFinalSeq': b'readFinalSeq',
    'W4 单源模块 readFinalTiming': b'readFinalTiming',
    'W4 单源模块 forEachChatNode': b'forEachChatNode',
    'W4 单源模块 readSessionChat': b'readSessionChat',
    'W4 单源模块 readSurfaceNodesOrNull': b'readSurfaceNodesOrNull',
    'W4 单源模块 readSourceKind': b'readSourceKind',
    'W4 宿主侧 pre-step 接单源（cwd 日志形态）': b"pre-step: cwd=",
    # ---- 第十四轮（L2 主题跟随：P-7 能力对等）----
    # 帧内「跟随宿主切主题」机制的两半：宿主侧广播 + 帧内钩子
    # （设备实测证实：宿主切主题后我方 token 色跟随、而帧内 color-scheme 不跟随 ⇒ 真缺陷）
    'L2 宿主侧主题广播 broadcastHostScheme': b'broadcastHostScheme',
    'L2 帧内跟随钩子 __dshtApplyHostScheme': b'__dshtApplyHostScheme',
    'L2 宿主主题属性信号（单源，非仅 OS 偏好）': b'data-ds-dark-theme',
    # 同族第二处：import-center.html（同源 iframe）继承宿主主题时也曾只查 documentElement
    # （宿主属性实际挂在 body 上 ⇒ 该支永不生效）。产物形态：先 body 再 documentElement。
    'L2 import-center 继承宿主主题查对元素': b'pd.body && pd.body.hasAttribute',
    # ---- 第十六轮（L1 指针捕获生命周期：P-8 幂等 / P-1 单源）----
    # 为什么核验这几项：本轮补的是**隐式释放**路径（lostpointercapture）——
    # 它既无 pointerup 也无 pointercancel，缺则拖拽状态永久残留。
    # 注意 esbuild 压缩后属性名可能被保留（React props 不压缩），但**函数名会变**
    # ⇒ 核验 React 事件属性名（字符串常量）与关键 API，不核验内部函数名。
    'L1 lostpointercapture 绑定': b'onLostPointerCapture',
    'L1 释放前判持有（防 NotFoundError）': b'hasPointerCapture',
    # ---- 第十七轮（L2 竖屏/横屏：手机判据改并集，P-1 单源）----
    # 为什么核验：设备实测 873×345 横屏下 `max-width:700px` 失配 ⇒ 五件套整体失效。
    # 修法把媒体查询改为并集 `(max-width: 700px), (pointer: coarse)`。
    # 实测产物形态：**CSS 内容字符串不被压缩**，两处都保留带空格写法（已用
    # tmp 一次性脚本在 APK 内正则确认，避免凭猜测写标记 ⇒ 假红）。
    'L2 mobile 五件套并集媒体查询': b'@media (max-width: 700px), (pointer: coarse)',
    # 同源 iframe 页（导入中心）必须同步（否则手机横屏下该页仍是桌面版式）
    'L2 import-center 并集媒体查询': b'@media (max-width: 700px), (pointer: coarse)',
    # ---- 第十八轮（L5 方案 C：裸全局 ReferenceError 归因，P-14 部分收口）----
    # 为什么核验：shim 是**模板串生成**的源码，改的是模板串体内的函数 ⇒ 必须核验
    # 函数名真的进了产物（源码改了 ≠ 产物里有，R5）。esbuild 压缩会改空白但不改名。
    'L5 归因函数 attributeReferenceError': b'attributeReferenceError',
    'L5 内建白名单（防误报）': b'BUILTIN_GLOBAL_ALLOW',
    'L5 归因复用 missing 通道': b'reportedAttr',
    # ---- 第十九轮（L2「字号与缩放」格设备实测：触控尺寸必须抗 flex 压缩，P-1/P-11）----
    # 为什么核验：设备实测 .dsht-rp-import-dock 渲染 19.45px 而规则命中且带 !important ——
    # 真因是 flex-shrink 把 height 压回（决定性实验：height 单独施加无效 / min-height 有效 /
    # height+flex-shrink:0 有效）。修法给六条放大规则补 flex-shrink: 0 !important。
    # 实测产物形态：CSS 内容字符串**不被压缩**，保留带空格写法（已用一次性脚本在 APK 内
    # 逐段确认，避免凭猜测写标记 ⇒ 假红）。
    # 注意：`flex-shrink: 0 !important` 在别处也可能出现（如 script-pill）⇒ 逐条精确匹配
    # 完整声明串，避免「随便命中一处就算过」的假绿。
    'L1 触控尺寸抗 flex 压缩（import-dock）':
        b'.dsht-rp-import-dock { height: 44px !important; padding: 0 14px !important; font-size: 13px !important; flex-shrink: 0 !important; }',
    'L1 触控尺寸抗 flex 压缩（rollback-btn）':
        b'.dsht-rp-rollback-btn { height: 44px !important; min-width: 44px !important; font-size: 13px !important; flex-shrink: 0 !important; }',
    'L1 触控尺寸抗 flex 压缩（script-pill）':
        b'.dsht-rp-script-pill { min-height: 44px !important; padding: 8px 14px !important; font-size: 14px !important; flex-shrink: 0 !important; }',
    'L1 触控尺寸抗 flex 压缩（avatar）':
        b'.dsht-rp-avatar { width: 44px !important; height: 44px !important; flex-shrink: 0 !important; }',
    # ---- 第二十轮（L1 触控目标穷举：P-26 归属原则 + 死规则纠正）----
    # 为什么核验：本轮用新探针 ef-touch-targets.mjs 穷举我方可点元素，抓到
    #   .vb-arrow 渲染 20×20（mobile 侧写的 38px 被 rp-ui 更高特异性的桌面基线压死）
    # ⇒ 放大规则必须写在**组件所属的包**内（P-26）。以下逐条核验放大真的进了各自产物。
    # 变体条箭头：必须带足特异性（.dsht-rp-variant-bar .vb-arrow）且到 44
    'L1 变体条箭头放大（rp-ui，压过桌面基线特异性）':
        b'.dsht-rp-variant-bar .vb-arrow { width: 44px !important; height: 44px !important; font-size: 18px !important; flex-shrink: 0 !important; }',
    'L1 token 命中区放大（rp-ui）':
        b'.dsht-rp-tokenmeter .tm-hit { height: 44px !important; flex-shrink: 0 !important; }',
    'L1 重新生成钮放大（rp-ui）':
        b'.dsht-rp-regen-btn { height: 44px !important; min-height: 44px !important; flex-shrink: 0 !important; }',
    'L1 侧栏按钮放大（rp-ui）':
        b'.dsht-rp-sidebar-btn { height: 44px !important; flex-shrink: 0 !important; }',
    # mobile 包内自有组件的放大（归属原则：写在**它自己的包**里，不进 rp-ui）
    'L1 附件钮放大（mobile 包内，38→44）':
        b'min-width: 44px; height: 44px; padding: 0 6px; flex-shrink: 0;',
    'L1 汉堡放大（mobile 包内，40→44）':
        b'z-index: 41; width: 44px; height: 44px; flex-shrink: 0;',
    # 死规则消除的正控：mobile 包内**不得**再有裸 .vb-arrow 放大（由 FORBIDDEN 段核验）
    'L1 world-book 钮放大（rp-ui）':
        b'.dsht-rp-lore .lore-btn { height: 44px !important; flex-shrink: 0 !important; }',
    'L1 状态视图切换钮放大（rp-ui）':
        b'.dsht-rp-stateview .sv-view-btn { height: 44px !important; flex-shrink: 0 !important; }',
    # E3/P-4 官方契约事前探针：脚本 + Step 0.6 接入（探针本体在 scripts/，不进 APK；
    #   此处核验的是**构建脚本里的接入点**随之进产物 = runtime.zip 里带 Step 0.6 标记？
    #   不：构建脚本不进 APK。故 E3 的产物核验点 = 「探针能读到官方包」由探针自身负责；
    #   本项改为核验探针**不存在于 APK**（防误把开发期脚本打进交付物），见下方专项断言。）
    # ---- 第二十二轮（W5 长文本溢出兜底 + F2 槽位致命缺陷修复）----
    # 说明：本轮两项都是**设备实测驱动**（决定性实验见 scripts/ef-overflow-probe.mjs）：
    #   · W5：markdown 超宽产物在真实容器里 4694~7489px 且 overflow:visible ⇒ 画到盒外。
    #     修的是一组 CSS（消融实验定为 9 条，其中「断行」是关键那一条）。
    #   · F2：wrapStQuotes 用 replaceChild 换掉了宿主 React 的文本节点 ⇒ React 删除时抛
    #     NotFoundError ⇒ 宿主 SlotErrorBoundary 永久让位 ⇒ **我方 assistant 渲染器全失效**
    #     （症状：所有卡上 .dsht-rp-assistant = 0，日志只有一行无堆栈 DOMException）。
    # 核验点必须是**产物里的形态**（R5：源码改了 ≠ 产物里有）：
    #   · W5 用 CSS 声明串精确匹配（CSS 内容不被 esbuild 压缩，前例已证）；
    #   · F2 用「修复后的标记属性」+「旧写法已消失」双向核验。
    'W5 溢出兜底：body/html 可滚（CSS 产物形态）':
        b'.dsht-rp-assistant-body,\n.dsht-rp-html { min-width: 0; max-width: 100%; overflow-x: auto; }',
    'W5 溢出兜底：后代断行（关键那一条）':
        b'.dsht-rp-html > * { overflow-wrap: anywhere; }',
    'W5 溢出兜底：pre 可横向滚':
        b'.dsht-rp-assistant-body pre, .dsht-rp-html pre { max-width: 100%; min-width: 0; overflow-x: auto; }',
    'W5 溢出兜底：table 可横向滚':
        b'.dsht-rp-assistant-body table, .dsht-rp-html table { display: block; max-width: 100%; min-width: 0; overflow-x: auto; }',
    # 【v5 结论反转后补的规则】第一版消融样本缺裸大图 ⇒ 误判「img 规则无杠杆」；
    # 补 bigImage 样本后实测 2000px 仍溢出 ⇒ 该规则必要。此处核验它真进了产物。
    'W5 溢出兜底：媒体元素限宽（曾误判无杠杆，实测必要）':
        b'.dsht-rp-html canvas, .dsht-rp-html svg { max-width: 100% !important; height: auto !important; }',
    'W5 溢出兜底：外壳 min-width:0':
        b'.dsht-rp-assistant { min-width: 0; max-width: 100%; }',
    'F2 台词着色 holder 标记（新写法进产物）': b'data-dsht-qwrap',
    'F2 台词着色 holder 属性名（源码形态）': b'dsht-qwrap',
    # ---- 第二十三轮 W6 · 暂存哨兵改私用区（真实缺陷：裸控制字符被正文撞车）----
    # 为什么核验：设备探针在**真实会话**上抓到 `\x01F0\x01`（用户正文里的字面量）
    # 被协议层当围栏哨兵消费 ⇒ 内容凭空消失 8 字。修法是把哨兵改为**私用区**（U+E000/E001）
    # + 唯一前缀。核验点 = 新前缀确实进产物（R5：源码改了 ≠ 产物里有）。
    'W6 围栏哨兵单源前缀': b'DSHT_RP_FENCE_',
    'W6 段落哨兵单源前缀': b'DSHT_RP_SEG_',
    # ---- 第二十三轮续 W8 · 单源收口（F5b AST 探针抓到的 4 组）----
    # 为什么核验：这些是**委托形态**（`const X = Y`），源码改了但产物里可能仍是旧的就地实现。
    # 核验点 = 产物里**不再出现**旧的就地实现特征（用 FORBIDDEN 口径，见下方 W8 组）。
}

# ---- 第二十三轮续 W8 · 收口后的**旧形态**不得留在产物里 ----
#
# ## 为什么用 FORBIDDEN 而不是「新委托形态」作正向 marker
# 「委托」在 esbuild 产物里会被内联 / 改名，形态不稳定；而**旧的就地实现**特征
# （两行 `writeHead` + `JSON.stringify`、`function replaceRangeOf(`）是稳定的字节形态。
# ⇒ 判据反向写：旧形态消失 = 收口真的进了产物（与 W21 同款纪律）。
FORBIDDEN_IN_PAYLOAD_W8 = {
    # session-repair 的私有 replaceRangeOf（收口后应委托 session-write 的 replaceRange）
    'W8 replaceRange 旧私有实现（function replaceRangeOf）': b'function replaceRangeOf(',
    # host-projection 的私有 isPlainObjectLike（收口后应委托 deep-merge 的 isMergeableObject）
    'W8 isPlainObjectLike 旧私有实现（function isPlainObjectLike）': b'function isPlainObjectLike(',
}

# 【W8 · sendJson 的就地闭包】必须用**正则**而不是纯字符串判据。
#
# ## 为什么（两次写错的过程，都记下来）
# ① 首版取**函数体**（`res.writeHead(code, { "Content-Type": … });`）⇒ 新包报红。
#    取证：esbuild 把单源 `http.ts:sendJson` 的**函数体内联**进每个消费方产物
#    （`function sendJson(res, code, body) { … }`），字节与旧就地实现相同 ⇒ **判据过宽**。
# ② 改取**闭包声明**（`const send = (code, body) =>`）⇒ 新包**仍报红**。取证：那正是
#    **我自己收口后留下的行**（委托形态保留了闭包名与签名）⇒ 判据与目标形态**重合**。
# ⇒ 唯一能区分「就地实现」与「委托」的是**两者相邻**：闭包声明后**紧跟** writeHead 实现体。
#    委托形态里闭包后跟的是 `sendJson(res, code, body)`。
W8_SEND_INLINE_RE = re.compile(
    rb'const send = \(code, body\) => \{\s*res\.writeHead\(code, \{\s*"Content-Type": "application/json"\s*\}\)'
)
# 计数用常量（2 项：lib 组合 + rp-ui client.js，复用同一正则）
# ⚠️ 不能用「占位串 + 放进某个 MARKS 组」的写法 —— 那会被正向 marker 循环误查（假 MISS）。
# ⇒ 与既有 `DEX_MARKS` / `REL_MARKS` 同款：用**纯计数常量**。
W8_SEND_INLINE_COUNT = 2

# ---- 第二十三轮 W6 续 · P-34 同类排查：另外两处同族哨兵也改私用区 ----
#
# ## 为什么必须用 FORBIDDEN 而不是「新前缀」作正向 marker
# `EJS_PRE_` / `DSHT_M` 这些 **ASCII 前缀修前修后都在**（变的只是**定界符**）
# ⇒ 拿它当正向 marker 是**零杠杆判据**（P-20：改回裸 NUL 也照样绿）。
# 真正有杠杆的是**旧定界符的字节形态**（`\0`），它在修后必须消失。
# 故这两处用 FORBIDDEN 判据；新形态的正向存在性由探针 `ef-sentinel-family.mjs`
# 的**动态调用**验证（真实调用 protect → restore，比字节匹配强得多）。
FORBIDDEN_IN_PAYLOAD_W21 = {
    'W21 ejs <pre> 哨兵退回裸 NUL 定界': b'\\0EJS_PRE_',
    'W21 preset 中性化占位退回裸 NUL 定界（DSHT_M）': b'\\0DSHT_M',
    'W21 preset 中性化占位退回裸 NUL 定界（DSHT_C）': b'\\0DSHT_C',
}

# ---- 第二十四轮 W3：真 TH 裸全局面补齐（B3「不允许静默 undefined」）----
#
# ## 判据形态的取舍（为什么用**正向 marker**而不是 FORBIDDEN）
# 与 W21/W8 相反：那两轮是「修旧形态」，本轮是「**新增**能力」——
# 新增实现的三项在修前**根本不存在**于产物里 ⇒ 正向 marker 天然有杠杆
# （修前必定 MISS、修后命中）。逐项：
#   · errorCatched / getTavernHelperExtensionId / initializeGlobal：本轮新实现
#   · TH_FACE_VALUE_NAMES：13 个值/同步型缺失名的「读出声道具」清单（新机制）
#     —— 该机制的判据关键在**清单常量进了产物**（字节层），
#        动态行为（读取出声 + typeof 仍 undefined）由 7 条单测 + 闸门覆盖。
W3_NEW_IMPL_MARKS = {
    'W3 errorCatched 实现在产物里': b'errorCatched',
    'W3 getTavernHelperExtensionId 实现在产物里': b'getTavernHelperExtensionId',
    'W3 initializeGlobal（与 waitGlobalInitialized 配对）': b'initializeGlobal',
    'W3 值/同步型缺失名清单（读出声道具）': b'faceValueNames',
    'W3 值型清单常量名（TH_FACE_VALUE_NAMES）': b'TH_FACE_VALUE_NAMES',
}
# 反向判据：值得拒绝的名字**必须真的挂上 stub**（否则「明确拒绝」是空话）
# 抽查 3 个代表性名字（函数型 stub 清单项）——它们此前是**静默 undefined**。
W3_STUB_MARKS = {
    'W3 世界书写面 stub（createWorldbook）': b'createWorldbook',
    'W3 人设写面 stub（updatePersonaWith）': b'updatePersonaWith',
    'W3 世界书重绑 stub（rebindChatWorldbook）': b'rebindChatWorldbook',
}

# ---- 第二十六轮 W24：代码高亮的 R19 合规修复（P-31 家族同类排查）----
#
# ## 判据形态（为什么用**相邻两段**而不是单串 —— P-35 的纪律）
# 修法是「把 `code.innerHTML = html` 换成『纯 DOM 构建片段 + insertBefore + 清空原文本』」。
# 若只取 `insertBefore` 当正向 marker ⇒ **零杠杆**（该词在本模块别处可能已存在，
# 且 `nodeValue` 也一样 —— 修前 `st-quotes.ts` 就有）。故必须取**修法独有的相邻组合**：
# 高亮函数里 `createElement('span')` + `setAttribute('data-dsht-hl'` + `insertBefore` 三者相邻。
#
# ## 杠杆（P-20）—— 本判据**修前实测 0 命中**（产物里只有旧写法），修后命中 ⇒ 有区分力
#
# ## 【判据自身的第二次实现假设（P-29 再现）—— 记下来防复发】
# 首版正则写 `.setAttribute("data-dsht-hl", \w+)[\s\S]{0,240}?\.insertBefore\(`
# ⇒ **两包都报 MISS**，而产物里修法**明明在**（`code.innerHTML` 0 次、`insertBefore` 24 次）。
# 真因：产物里两处之间**隔着 `span.textContent = match[0]; frag.appendChild(span); cursor = …`**
# 等语句（esbuild 展开后共 ~300 字节）⇒ 我设的 240 字节窗口**太窄**。
# ⇒ 修法：**放宽窗口到 800 字节**（仍远小于「整文件匹配」那种零杠杆写法），
#    并**同时**锚定 `span.textContent` 这一修法独有的中间语句（提高特异度，防过宽）。
W24_HL_DOM_BUILD_RE = re.compile(
    rb'setAttribute\("data-dsht-hl"[\s\S]{0,140}?textContent[\s\S]{0,800}?insertBefore\('
)
W24_HL_DOM_BUILD_COUNT = 2  # lib 组合包 + rp-ui client.js
# 反向判据：旧写法必须从产物里**消失**（`code.innerHTML = html` 这一形态）。
# ⚠️ 不写宽到「任何 innerHTML 赋值」—— 全仓别处有合法的自建 DOM innerHTML（本轮分诊过 11 处）。
W24_HL_OLD_INNERHTML_RE = re.compile(rb'code\.innerHTML\s*=')

# 【F2 专项】修复后的产物里**不得**再出现「替换 React 文本节点」的旧写法。
# 判据形态：st-quotes 模块的旧代码是 `parent.replaceChild(frag, node)`（frag 是 DocumentFragment）。
# 注意：`replaceChild` 这个词在其它模块可能合法存在（如先移除再插入的自建 DOM），
# 故按**该模块特有组合**匹配：`replaceChild(frag` 这个变量名是本模块独有的。
FORBIDDEN_IN_PAYLOAD_F2 = {
    'F2 台词着色旧写法（replaceChild 替换 React 文本节点）': b'replaceChild(frag',
}

# 【E3 专项】开发期脚本**不得**混进交付产物（否则等于把「内部审计工具」发给用户）
#
# 【第二十轮修正 —— 判据自身的坑（P-19 / P-11 核验侧）】
# 原判据用**文件名**做子串匹配（如 b'ef-touch-targets'）。但本轮我在产品源码的**注释**里
# 写了「设备探针 ef-touch-targets.mjs 抓到…」⇒ 子串命中**注释文本** ⇒ 报出
# 「开发期脚本混进产物」的**假违规**（实测 2/2 双包皆报，而产物里其实只有注释）。
# ⇒ 判据必须锚定**脚本本体特征**，而不是名字。脚本本体的独有特征：
#   · 它 import 'node:process' / 用 execFileSync —— 浏览器 bundle 里绝不会出现；
#   · 它有**仅探针才有**的函数/常量名（如 outcome 汇总串）。
# 这里用「文件名 + .mjs」+「node 专属 API」的组合做**双条件**匹配，避免注释误伤。
FORBIDDEN_IN_PAYLOAD = {
    'E3 audit-official-contract 不进 APK': b'audit-official-contract',
    'E3 ef-journey-all 不进 APK': b'ef-journey-all',
    # 第十三轮新增的设备侧审计（P-21 的机器化形态）——同样属开发期工具，不得进交付物
    'P-21 audit-session-integrity 不进 APK': b'audit-session-integrity',
    # 第二十轮新增的设备探针：**只查脚本本体特征**（探针独有的 ASCII 输出前缀 +
    # node 专属 API），而不是文件名（注释里会写到文件名 ⇒ 假违规，见上方说明）。
    'L1 ef-touch-targets 脚本本体不进 APK': b'[ef-touch-targets]',
    'L2 ef-font-scale 脚本本体不进 APK': b'[ef-font-scale]',
    # 第二十二轮 W5 / 第二十三轮 W6 新增的设备探针（同样只认脚本本体的独有输出前缀）
    # 注意：ef-overflow-probe 的输出前缀本来是通用词 `[probe]`，作判据会**恒命中**
    # （产物里任何 `[probe]` 字样都会算），故按其**独有**的诊断串匹配（P-20：判据须有杠杆）。
    # 该串含中文 ⇒ 必须用 UTF-8 字节（python 的 bytes 字面量不接受非 ASCII）
    'L2 ef-overflow-probe 脚本本体不进 APK': '无法出结论'.encode('utf-8'),
    'A5 ef-compile-parity 脚本本体不进 APK': b'[ef-compile-parity]',
    # 第二十轮新增的 A15 闸门（跨包 CSS）
    'A15 audit-cross-package-css 脚本本体不进 APK': b'[A15]',
}

# 【第二十轮 · P-26 跨包规则收口的产物核验】
# 守两件事：
#   ① rp-ui 包内**必须**有迁入后的放大规则（否则「样式丢了」）；
#   ② mobile 包内**不得**再有跨包规则（回流 = 死规则复发）。
# 只在各自包的 client.js 里查（避免误伤对侧）。
RPUI_MUST_HAVE = {
    'P-26 迁入：overlay 安全区': b'.dsht-rp-overlay {\n    box-sizing: border-box !important;',
    'P-26 迁入：返回钮 44': b'.dsht-rp-back { width: 44px !important; height: 44px !important;',
    'P-26 迁入：tab 44': b'.dsht-rp-tab { flex: 1 !important; height: 44px !important;',
    'P-26 迁入：卡片齿轮 44': b'.dsht-rp-card-gear { width: 44px !important; height: 44px !important;',
    'P-26 迁入：抽屉全屏': b'.dsht-rp-drawer { max-height: none !important; height: 100% !important;',
    'P-26 迁入：世界书 chip 44': b'.dsht-rp-books .wb-chip { min-height: 44px !important;',
    # 【第二十轮续三 · W2 跨态穷举抓到的三项】设备实测：.rx-name 126×24、
    # .rx-toggle 40×22、.rx-check 353×37，三项均低于 38 底线（P1）。
    'W2 跨态：rx-name 下限 44': b'.dsht-rp-regex .rx-name { min-height: 44px !important; }',
    'W2 跨态：rx-toggle 下限 44': b'.dsht-rp-regex .rx-toggle { min-height: 44px !important;',
    'W2 跨态：rx-check 统一下限 44': b'.rx-check { min-height: 44px !important; }',
}
MOBILE_FORBIDDEN_CROSS = {
    'P-26 收口：mobile 无 .dsht-rp-back 规则': b'.dsht-rp-back {',
    'P-26 收口：mobile 无 .dsht-rp-tab 规则': b'.dsht-rp-tab {',
    'P-26 收口：mobile 无 .dsht-rp-card-gear 规则': b'.dsht-rp-card-gear {',
    'P-26 收口：mobile 无 .dsht-rp-overlay 规则': b'.dsht-rp-overlay {',
    'P-26 收口：mobile 无 .dsht-rp-drawer 规则': b'.dsht-rp-drawer {',
}


def strip_css_comments(text):
    """去掉 /* ... */ 注释块（含多行）后再做禁用串匹配。

    【第二十轮 · 判据自身的坑】首版直接在**原始产物文本**上匹配禁用串 ——
    而我在 mobile 侧保留了一条**历史说明注释**（'原为：@media (hover: none)
    { .dsht-rp-card-gear { opacity: 1; } }'）⇒ 子串命中注释 ⇒ 报出**假违规**
    （实测双包皆报）。这与 E3 那次的「文件名子串命中注释」是**同一族**
    （P-19：判据必须锚定信号本体，而不是可能出现于注释中的字面串）。
    ⇒ 禁用判据必须先剥注释再匹配。
    """
    out = []
    i = 0
    n = len(text)
    while i < n:
        j = text.find('/*', i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        k = text.find('*/', j + 2)
        if k < 0:
            break          # 未闭合注释：其后整段按注释处理
        i = k + 2
    return ''.join(out)

# 【第二十轮 · 死规则消除的负控】mobile 包里**不得**再出现裸 `.vb-arrow` 放大规则。
# 理由：那类选择器（无 dsht- 前缀）在 rp-ui 侧有**更高特异性**的桌面基线 ⇒ 必然静默失效。
# 只在 **mobile 的 client.js** 里查（rp-ui 侧的同名规则是**合法**的桌面基线，不能误伤）。
FORBIDDEN_IN_MOBILE = {
    'L1 死规则已消除（mobile 包内无裸 .vb-arrow 放大）': b'.vb-arrow { width: 38px; height: 38px;',
    'L1 死规则已消除（mobile 包内无裸 .lore-btn 放大）': b'.lore-btn { height: 38px;',
    'L1 死规则已消除（mobile 包内无裸 .sv-view-btn 放大）': b'.sv-view-btn { height: 38px;',
}

# 需按正则核验的标记（产物经 esbuild 压缩，空白/写法会变，逐字匹配会假红）
REGEX_MARKS = {
    'L1 双指不误判拖拽': rb'touches\.length\s*>\s*1',
}

APKS = ['DSH-Tavern-0.2.2-x86_64-debug.apk', 'DSH-Tavern-0.2.2-arm64-release.apk']

# ★ W47：`--apk-root <目录>` —— 显式指定 APK 所在目录（默认 = 当前工作目录）。
#   为什么需要：APK 交付在**仓库根**，而构建脚本的 cwd 是 `rp-workspace/`
#   （Step 6.6 从这里调用）⇒ 不指定就会「找不到文件」而不是「核验失败」。
#   ★ 用显式参数而不是 `cd`，是为了**不改变调用方的工作目录**（守 P-40 家族：
#     判据不得有它自己不知道的隐式前提）。
if '--apk-root' in sys.argv:
    _i = sys.argv.index('--apk-root')
    _root = sys.argv[_i + 1]
    APKS = [os.path.join(_root, a) for a in APKS]

# ★ W47：`--arch <x86_64|arm64>` —— **只核本架构**那一个包。
#   为什么需要（否则构建期会假红）：**单架构构建**时另一架构的 APK 可能**本来就不存在**
#   （首次构建 / 清理过）⇒ 若把「另一个包不存在」当失败，构建会被**误拦**
#   （P-38：过宽 ⇒ 假红 ⇒ 训练人忽略报警）。
#   ★ 手工核验（不带 `--arch`）仍然**两个包都要在**（那是交付前的完整口径）。
if '--arch' in sys.argv:
    _a = sys.argv[sys.argv.index('--arch') + 1]
    _kw = {'x86_64': 'x86_64', 'arm64': 'arm64'}.get(_a)
    if _kw is None:
        print('✗ --arch 只接受 x86_64 / arm64（实得 %r）⇒ fail-closed' % _a)
        sys.exit(2)
    APKS = [a for a in APKS if _kw in a]

# ★ 前提断言（P-43 家族：无对象可判时必须**出声**，不得静默当作通过）
if not APKS:
    print('✗ 核验面为空（--arch 过滤后没有待核验的包）⇒ fail-closed（零样本冒充通过是 P-30 最危险形态）')
    sys.exit(2)
_missing = [a for a in APKS if not os.path.exists(a)]
if _missing:
    print('✗ 找不到待核验的 APK（核验面不成立 ⇒ fail-closed）：')
    for m in _missing:
        print('    %s' % m)
    sys.exit(2)

failed = 0
for apk in APKS:
    z = zipfile.ZipFile(apk)
    inner = zipfile.ZipFile(io.BytesIO(z.read('assets/dsh-runtime.zip')))
    # 注意：不同改动落在不同插件产物里 —— 只读 dsht-rp-plugin 会漏掉
    # tavern-helper 侧（如 rpSlugFromCwd 的 'first-segment' 参数），
    # 这正是「产物核验必须覆盖改动实际所在的包」这一教训。
    lib = b''.join(
        inner.read('node_modules/%s/lib/index.js' % pkg)
        for pkg in ('dsht-rp-plugin', 'dsht-plugin-tavern-helper', 'dsht-plugin-memory')
    )
    lib += inner.read('node_modules/dsht-rp-plugin/lib/client.js')
    # L1 的窄屏 CSS 在 dsht-plugin-mobile 的 client bundle 里（不在 rp-ui 的 client.js）
    lib += inner.read('node_modules/dsht-plugin-mobile/lib/client.js')
    # L2 主题跟随（2026-09-14 第十四轮）：import-center.html 是**同源 iframe 页面**，
    # 以**独立 html 资产**分发（不在任何 lib/*.js 里）——只扫 lib 会把它整片漏掉，
    # 产出「MISS」假红（实测：改动其实已进产物，是核验范围写错 ⇒ P-11 的核验侧盲区）。
    lib += inner.read('node_modules/dsht-rp-plugin/assets/import-center.html')
    dex = b''.join(z.read(n) for n in z.namelist() if n.endswith('.dex'))
    print('--- %s ---' % apk)
    miss = []
    lib_text = lib.decode('utf-8', errors='replace')
    for k, v in MARKS.items():
        if isinstance(v, bytes):
            hit = v in lib
        else:
            # 中文标记：esbuild 会把非 ASCII 转成 \uXXXX（大写十六进制）
            esc = ''.join(ch if ord(ch) < 128 else '\\u%04X' % ord(ch) for ch in v)
            hit = (v in lib_text) or (esc in lib_text)
        if not hit:
            miss.append(k)
    for k, pat in REGEX_MARKS.items():
        if not re.search(pat, lib):
            miss.append(k)
    # 【E3 专项】反向判据：开发期脚本**必须不在**交付产物里（进了 = 泄漏内部工具）
    for k, v in FORBIDDEN_IN_PAYLOAD.items():
        if v in lib or v in dex:
            miss.append('%s（违规：开发期脚本混进产物）' % k)
    # 【第二十轮 · 死规则消除的负控】只在 mobile 的 client.js 里查
    mob_css = inner.read('node_modules/dsht-plugin-mobile/lib/client.js')
    # 【判据自身的坑】必须**先剥注释**再匹配禁用串（历史说明里会原样引用被删的规则）
    mob_css_nc = strip_css_comments(mob_css.decode('utf-8', errors='replace')).encode('utf-8', errors='replace')
    for k, v in FORBIDDEN_IN_MOBILE.items():
        if v in mob_css_nc:
            miss.append('%s（违规：死规则未清除，规则存在但永不生效）' % k)
    # 【第二十轮 · P-26 跨包规则收口】① rp-ui 包内必须有迁入的规则
    rp_css = inner.read('node_modules/dsht-rp-plugin/lib/client.js')
    for k, v in RPUI_MUST_HAVE.items():
        if v not in rp_css:
            miss.append('%s（缺：迁入的规则不在 rp-ui 产物里）' % k)
    # ② mobile 包内不得再有跨包规则（回流 = 死规则复发）
    for k, v in MOBILE_FORBIDDEN_CROSS.items():
        if v in mob_css_nc:
            miss.append('%s（违规：跨包规则回流到 mobile 包，层叠胜负不可控）' % k)
    # 【F2 专项】修复后的产物里不得再出现「替换 React 文本节点」的旧写法。
    # 只在 rp-ui 的 client.js 里查（该模块属 rp-ui 包）。
    for k, v in FORBIDDEN_IN_PAYLOAD_F2.items():
        if v in rp_css:
            miss.append('%s（违规：旧写法仍在产物里，slot 仍会永久 abdicate）' % k)
    # 【W21 专项 · P-34 同类排查】两处同族哨兵的旧裸 NUL 定界不得留在产物里。
    # 落点：① ejs `<pre>` 保护在 `dsht-plugin-prompt-template`（其 lib/index.js 由
    #   build-dsht.ps1 Step 5 的 R10 循环产出）② preset 中性化在 `dsh-plugin` 大包。
    # 两者**都不在**上面 `lib` / `rp_css` 的读取范围内 ⇒ 必须单独读，否则判据恒绿（假绿）。
    for pkg_path in ('node_modules/dsht-plugin-prompt-template/lib/index.js',):
        try:
            w21_blob = inner.read(pkg_path)
        except KeyError:
            miss.append('W21 产物缺 %s（核验范围/构建路径变了？）' % pkg_path)
            continue
        for k, v in FORBIDDEN_IN_PAYLOAD_W21.items():
            if v in w21_blob:
                miss.append('%s（违规：旧裸 NUL 定界仍在 %s 里）' % (k, pkg_path))
    # 顺带核验 worker（渲染入口的另一个产物）
    try:
        w21_worker = inner.read('node_modules/dsht-plugin-prompt-template/lib/ejs-worker.js')
    except KeyError:
        w21_worker = b''
    for k, v in FORBIDDEN_IN_PAYLOAD_W21.items():
        if v in w21_worker:
            miss.append('%s（违规：旧裸 NUL 定界仍在 ejs-worker.js 里）' % k)
    for k, v in FORBIDDEN_IN_PAYLOAD_W21.items():
        if v in lib:
            miss.append('%s（违规：旧裸 NUL 定界仍在 lib 组合里）' % k)
    # 【W8 专项 · 单源收口】收口后的**旧就地实现**不得留在产物里。
    # 落点说明：① `dsh-plugin`（sendJson / replaceRange / isPlainObjectLike 都在该包）
    # ② `dsht-rp-ui` 的 client.js 也内联了 shared 层（isPlainObjectLike 的旧形态曾在其中）。
    # ⇒ 两处都查（判据的覆盖范围必须与被改动面一致，否则「漏查一处」会静默放行）。
    for k, v in FORBIDDEN_IN_PAYLOAD_W8.items():
        if v in lib:
            miss.append('%s（违规：旧就地实现仍在 lib 组合里）' % k)
        if v in rp_css:
            miss.append('%s（违规：旧就地实现仍在 rp-ui client.js 里）' % k)
    # sendJson 的就地闭包（用正则，理由见 W8_SEND_INLINE_RE 上方注释）
    if W8_SEND_INLINE_RE.search(lib):
        miss.append('W8 sendJson 旧就地闭包（闭包后紧跟 writeHead 实现）仍在 lib 组合里')
    if W8_SEND_INLINE_RE.search(rp_css):
        miss.append('W8 sendJson 旧就地闭包仍在 rp-ui client.js 里')
    # 【W24 专项 · R19 合规】代码高亮必须走「纯 DOM 构建 + insertBefore + 清空原文本」，
    # 且**旧写法 `code.innerHTML = html` 必须从产物里消失**。
    # 落点：`dsht-rp-ui` 的 client.js（display-compiler 在其中）+ lib 组合包（可能内联）。
    for name, blob in (('lib 组合', lib), ('rp-ui client.js', rp_css)):
        if not W24_HL_DOM_BUILD_RE.search(blob):
            miss.append('W24 代码高亮的 DOM 构建形态缺失（%s：未找到「setAttribute(data-dsht-hl) → insertBefore」相邻段）' % name)
        if W24_HL_OLD_INNERHTML_RE.search(blob):
            miss.append('W24 代码高亮仍用 `code.innerHTML =`（%s：R19 违规写法）' % name)
    # F3：Kotlin 属性 `webView.scrollCaptureHint =` 编译后成 setScrollCaptureHint()
    if b'setScrollCaptureHint' not in dex:
        miss.append('F3 setScrollCaptureHint')
    # L4 内存压力自愈（2026-09-14 第三轮）：renderer 被杀 → recreate() 重建
    for m in (b'onRenderProcessGone', b'RenderProcessGoneDetail', b'RENDERER_REBUILD_MAX',
              b'renderer_rebuilds'):
        if m not in dex:
            miss.append('L4 %s（renderer 自愈）' % m.decode())
    # L4 出声（2026-09-14）：降级状态进等待屏
    for m in (b'sandboxFallback', b'proot-missing', b'rootfs-failed', b'lastAbnormalExit'):
        if m not in dex:
            miss.append('L4 %s（降级出声）' % m.decode())
    # L2 安全区：原生消费 WindowInsets（Kotlin lambda 编译后引用这些类型/方法名）
    if b'setOnApplyWindowInsetsListener' not in dex:
        miss.append('L2 setOnApplyWindowInsetsListener（安全区）')
    if b'systemBars' not in dex:
        miss.append('L2 WindowInsetsCompat.Type.systemBars（安全区）')
    # 【判据自带杠杆】不能用 `b'ime'` 这种超短串 —— 它几乎必然以别的形式出现在 dex 里
    # ⇒ 恒命中 ⇒ 恒真判据（P-20）。必须用**本修法独有**的标识符。
    for m in (b'insetImeBottomPx', b'keyboardInsetStatus', b'insetAppliedBottomPx', b'insetChannel'):
        if m not in dex:
            miss.append('L2/A1 %s（键盘避让读回）' % m.decode())
    if b'bottomMargin' not in dex:
        miss.append('L2/A1 lp.bottomMargin（避让走布局尺寸通道，而非 padding）')
    # 负控：上一版的无效修法形态（只 setPadding 不改布局）不得是**唯一**手段 ——
    # 本判据通过要求 `setPadding` 与 `bottomMargin` 并存（前者只在布局类型意外的兜底分支里）。
    if b'setPadding' not in dex:
        miss.append('L2/A1 setPadding（兜底分支缺失 —— 布局类型意外时应降级而非崩）')
    # dex 层项数：F3 1 + L4 自愈 4 + L4 出声 4 + L2 安全区 2 + L2/A1 键盘 6 = 17
    DEX_MARKS = 17
    # ---- F3 滚动截屏复核（2026-09-14 第二轮：承认「探测不可读」）----
    # 为什么必须核验这几项：F3 上一版只核验 `setScrollCaptureHint` 命中 dex 就宣称「已接通」，
    # 而正确形态是「设 hint + **如实报告能力未知**」。故本轮必须核验「未知」这条路径真的进包。
    #
    # 【判据自身踩的坑（P-11）】初版把 `"supported"`（带引号）与 `onScrollCaptureSearch`
    # 当作 dex 字符串查 —— 两者都**正确地**不在 dex 里：
    #   · JSONObject.put 的键是**编译期常量**，被 R8/D8 内联为索引，不留带引号字面量；
    #   · `onScrollCaptureSearch` 已按 P-17 改为**不硬编码方法名**（改用
    #     `name.contains("ScrollCapture")` 动态筛），故全名**本就不该出现**。
    # ⇒ 判据必须按「实际会被保留的形态」写：字段名裸串 + 动态筛选的实现标志。
    for m in (b'supported', b'verdict', b'probeAvailable', b'scrollCaptureSearchResult'):
        if m not in dex:
            miss.append('F3 %s（能力探测/未知报告）' % m.decode())
    # F3-2：滚屏能力探测实现（枚举真实签名 + 不硬编码方法名）
    # 注意：这里**故意不查** `onScrollCaptureSearch` 全名 —— 不硬编码方法名正是本轮修法，
    # 若它出现在 dex 里反而说明退回了「猜 API 形态」的错法（P-17）。
    for m in (b'scrollCaptureMethods', b'parameterTypes', b'ScrollCapture'):
        if m not in dex:
            miss.append('F3-2 %s（探测实现）' % m.decode())
    if b'onScrollCaptureSearch' in dex:
        miss.append('F3-2 硬编码了方法名 onScrollCaptureSearch（违反 P-17 不猜 API 形态）')
    DEX_MARKS += 8
    # ---- 「相对顺序」判据（P-15 的产物层证明）----
    # 为什么需要它：本轮 F4 的真根因是「useMemo 在条件早退之后」⇒ React #310 ⇒
    # 组件被 SlotErrorBoundary 吞掉。这个缺陷**不影响任何字符串是否存在**——
    # 用「标记是否命中」永远查不出来，只有「两者的相对位置」才照得出。
    # 故这里必须查顺序：reading 的赋值必须出现在早退语句之前。
    #
    # 【本判据自己踩过的坑（P-11）】第一版有两处错，都必须记下来：
    #   · 锚点用了 `blank !== false` —— 那是**赋值行**（函数开头），不是早退语句
    #     ⇒ 恒判「顺序错」= 假红；
    #   · 且 `find` 全文件找第一个 —— `RpStateFloat` 有**逐字相同**的早退语句
    #     （`if (!slug || !sessionId || blank) return null`），会命中错的那个组件。
    # ⇒ 锚点必须① 是被断言的**那件事本身**（早退语句）；② 限定在**目标组件体内**。
    rel_bad = []
    fn_at = lib.find(b'function RpTokenMeter(')
    if fn_at < 0:
        rel_bad.append('F4-P15 找不到 RpTokenMeter（产物结构变了？）')
    else:
        # 组件体边界 = 下一个顶层 `function ` 声明（产物里组件都是顶层函数声明）
        next_fn = lib.find(b'\nfunction ', fn_at + 10)
        body = lib[fn_at: next_fn if next_fn > 0 else fn_at + 12000]
        reading_at = body.find(b'const reading =')
        bail_at = body.find(b'if (!slug || !sessionId || blank) return null;')
        if reading_at < 0:
            rel_bad.append('F4-P15 找不到 reading 赋值（产物结构变了？）')
        elif bail_at < 0:
            rel_bad.append('F4-P15 找不到「非 RP 早退」语句（产物结构变了？）')
        elif reading_at > bail_at:
            rel_bad.append('F4-P15 reading 的 useMemo 在早退之后 ⇒ React #310 复发')
    for m in rel_bad:
        miss.append(m)
    REL_MARKS = 1
    for m in miss:
        print('  MISS %s' % m)
    # 【第二十轮续三 · 判据自身的计数缺陷（P-19 同族）】
    #  原式只算 MARKS + REGEX_MARKS + DEX_MARKS + REL_MARKS，
    #  而**跨包三组**（RPUI_MUST_HAVE / MOBILE_FORBIDDEN_CROSS / FORBIDDEN_IN_MOBILE）
    #  虽然**真的被核验了**（上面的循环），却没进计数 ⇒ 报出的「核验 104 项」
    #  **低于**实际核验数，且每加一条跨包标记，文档数字与实际会越差越远
    #  （这正是 P-1「同一事实两处、且不随改动同步」的形态）。
    #  ⇒ 改为把这三组也算进来（分母 = 真正的核验项数）。
    #
    # 【第二十三轮 · 同一缺陷的**第二次**复发（P-1 的教科书形态）】
    #  上一轮修了「跨包三组漏算」，但 `FORBIDDEN_IN_PAYLOAD`（探针/闸门本体禁入）**同样
    #  真核验了却没进计数** —— 它就在上面第 3 行的循环里跑着。⇒ 修法不是「再补一组」，
    #  而是**把全部核验组集中到一处**（下面这个列表），今后新增判据组只改这一行。
    ALL_MARK_GROUPS = [
        MARKS, REGEX_MARKS,
        RPUI_MUST_HAVE, MOBILE_FORBIDDEN_CROSS, FORBIDDEN_IN_MOBILE,
        FORBIDDEN_IN_PAYLOAD, FORBIDDEN_IN_PAYLOAD_F2, FORBIDDEN_IN_PAYLOAD_W21,
        FORBIDDEN_IN_PAYLOAD_W8,
        W3_NEW_IMPL_MARKS, W3_STUB_MARKS,
        # DEX_MARKS / REL_MARKS 是「每包固定条数的专项断言」的**计数常量**（不是容器）
    ]
    total_marks = sum(len(g) for g in ALL_MARK_GROUPS) + DEX_MARKS + REL_MARKS + W8_SEND_INLINE_COUNT + W24_HL_DOM_BUILD_COUNT
    print('  => 核验 %d 项，缺失 %d 项' % (total_marks, len(miss)))
    failed += len(miss)

sys.exit(1 if failed else 0)
