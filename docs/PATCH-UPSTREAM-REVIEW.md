# 补丁上游化评审（GOAL-ECO-SPRINT W-C，2026-09-20）

> 目的：把对 DSH 官方的构建期补丁分两栏——「平台无关、可提 PR 回上游」vs
> 「Android 特有、留在本地」。上游化每成功一条，DSH 升级时的逐条复核负担就轻一分。
>
> **盘点对账口径**：`apply-platform-patches.py` 的 `patch()` 调用 **20 处**
> （audit-patch-markers.py 机器核验，marker 幂等健全）+ P2-1b 自定义回填块 1 处
> + composition yml 配置补丁 1 处；`build-dsht.ps1` 的 `Dsht-Patch` 14 处全部与
> py 侧语义条目重叠（同一补丁的两条构建路径登记）。语义归并 = **12 组**。

## 一、可上游候选（5 组）

### U-1 ★★★ P2 会话折叠行大会话不可见修复（DSHT-CHAT-FOLD-OLDEST/SEAT/READY）

- **问题**：官方 `processWindowReady` 含 `&& !historyIncomplete`，而
  `historyIncomplete = hasMore`——大会话（百余轮）几乎恒 `hasMore=true` ⇒
  所有轮次折叠行**永不渲染**。与平台无关，任何长会话用户都中招。
- **我方修法**：折叠只要求「本轮 process 窗口完整在已加载区间」
  （`processStartSeq >= firstSeq`），不要求整个会话历史加载完。
- **上游化论证**：纯逻辑修正，无平台分支；可向官方提「折叠窗口判据语义修正」PR。
- **PR 草案骨架**：
  - 标题：`fix(chat): turn fold row never renders for long sessions (hasMore always true)`
  - 问题：`historyIncomplete` 用 `hasMore` 判定，长会话恒真 ⇒ `processWindowReady` 恒假；
  - 方案：引入「最老已加载节点 seq」，本轮窗口完整落在已加载区间即放行；
  - 兼容性：`firstSeq` 为 null 时维持官方原行为（零回归面）。

### U-2 ★★★ P3-5a 会话标题剥协议标签（DSHT-TITLE-DETAG）

- **问题**：官方 `cleanTitleText` 只清控制字符/转义序列——RP 场景首条消息/LLM 生成
  的标题常含 `<interactive_input>`/`<status>` 等协议标签，标题栏裸显标签名。
  与平台无关（任何 agent/RP 用法都会遇到）。
- **我方修法**：normalize 前剥成对标签与未闭合标签尾，其余行为不变。
- **PR 草案骨架**：
  - 标题：`fix(session-title): strip protocol-ish markup from generated titles`
  - 问题：LLM 生成标题常带成对/未闭合标签，现 normalize 不处理；
  - 方案：前置一次保守剥标签（限 200 字符窗口防灾难性回溯）；
  - 兼容性：只削不增，纯文本标题零变化。

### U-3 ★★☆ F2 flock 单进程直通（DSHT-ANDROID-FLOCK）

- **问题**：bionic 无 `flock(2)`，会话写锁抛错（消息发不出去）。
- **我方修法**：单进程运行时直接成功——与上游对 **browser worker** 的既有处置同款。
- **上游化论证**：官方已经为「无线程/无进程并发的宿主」（browser worker）做了直通；
  把判据从「browser worker」泛化为「单进程运行时」（android 同属）是顺水推舟。
  **建议 PR 形态：环境/能力探测声明，而非 platform 分支**——官方接受度更高。
- **兼容性**：多进程桌面 Linux/macOS 行为不变（判据只在单进程宿主命中）。

### U-4 ★★☆ F1 会话发布 link → rename 回退（4 处）

- **问题**：SELinux 禁硬链接，会话日志无法 `link()` 发布。
- **我方修法**：直接改 `rename()`。
- **上游化论证**：官方选 `link()` 是原子发布语义（旧版本不丢）；直接改 rename 有行为差异
  ⇒ **PR 形态应为「link 失败（EPERM/EXDEV）时回退 rename」**而非替换——这对
  Windows 跨盘、受限 FS（部分企业加密盘）同样受益，不只为 Android。
- **兼容性**：link 可用的环境零变化（只在 throw 路径加回退）。

### U-5 ★☆☆ P0-5 Iterator Helpers 守卫（DSHT-ANDROID-ITERATOR）

- **问题**：旧 WebView（无 Iterator helpers）整页加载失败。
- **上游化论证**：旧浏览器通用问题，但官方可能有意抬基线（DSH 是新项目）——
  上游化优先级最低；先探官方对最低 WebView/浏览器基线的态度再提。
- **PR 形态**：守卫/提示性 polyfill 或明确的「不支持」报错文案（比现在白屏好）。

## 二、留在本地（Android/PC 模拟特有，7 组）

| 组 | marker/形态 | 不上游的理由 |
|---|---|---|
| P0-1a/P0-1b bash argv → `/system/bin/sh` | DSHT-ANDROID-SH ×2 | Android 无 bash 的绕法（P1 已内置真 bash，降级链保留兜底）；官方桌面语义下 bash 正确 |
| P0-2 sandbox-local 降级 warn 直通 | DSHT-ANDROID-UNSANDBOXED | Android 无 bwrap/Landlock 后端的降级；官方桌面四后端可用 |
| P0-2b PRoot 真隔离包装 | DSHT-ANDROID-PROOT | DSHTavern 的 proot 路线本体（rootfs symlink 林 + bind 集），深度耦合我方部署 |
| P1-3 fs-search 降级（资产 + 条件短路） | DSHT-ANDROID-JS-SEARCH | P1 后 = 「rg 缺席才降级」的兜底逻辑，平台探测分支 |
| P1-4 terminal-bash shell/args | DSHT-ANDROID-TERM-SHELL/ARGS | 指向 DSHT_RUNTIME_BIN_DIR 内置 bash（我方 P1 设施），缺省回退 mksh |
| composition compression:'none' | cordis.patch.yml 配置补丁 | WebView 迁移管线写不了 zstd 的我方约束；官方默认压缩对桌面正确 |
| SIM 组 ×3（fsync/owner-only/syncDir） | DSHT-SIM | PC 侧 Windows 模拟 Android 的探针态，非 Android 产物，更非上游问题 |

> 另：P1 能力补齐包（bash/rg/git/zstd 内置、jniLibs 伪装 .so、symlink 林）整体是
> **部署形态**而非 DSH 补丁，不在上游化视野（NEXT-STEPS P1 已收口）。

## 三、行动建议

1. **先提 U-1 / U-2**（纯逻辑修正、零平台分支、官方接受成本最低）；
2. U-3 / U-4 以「能力探测/失败回退」形态提（避免 platform 分支印象）；
3. U-5 缓议（先探官方基线态度）；
4. 每条 PR 被接受后，本地补丁改为「DSH >= 接受版本时跳过」（判据机器化进现有幂等面）。
