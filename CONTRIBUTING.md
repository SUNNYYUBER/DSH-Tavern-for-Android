# 贡献说明

**中文** ｜ [English](#english)

**Issue 与 Pull Request 都欢迎提。**

- **Issue**：报 bug（附设备型号、Android 版本、复现步骤）或讨论想法
- **PR**：直接提。维护者评审与合并，合并前可能请你改几轮

## 先看这个：最小验证路径（10 秒，不需要真机、不需要构建 APK）

**改 `rp-workspace/packages/src/` 下的逻辑（兼容层 / 导入 / 正则 / 预设 / 宏 / MVU / UI 逻辑），
用这一条命令就能验证：**

```powershell
cd rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile   # 首次，约 1 分钟
npx -y pnpm@10 test                        # 约 10 秒
```

预期输出：

```
Test Files  86 passed (86)
     Tests  1839 passed | 2 skipped (1841)
```

改逻辑不需要模拟器、不需要 Android SDK、不需要 `jniLibs` 第三方二进制（那 100MB 只在
**构建 APK** 时才需要）。类型检查同理：

```powershell
npx -y pnpm@10 typecheck        # 三段式 core / ui / tests
```

**什么时候才需要完整构建链**（`node rp-workspace/scripts/fetch-native-libs.mjs` +
`build-dsht.ps1` + gradle，耗时以小时计）：只有当你改的是 **Android 壳**
（`rp-workspace/android/`）、**构建脚本**、或**平台补丁**时才需要。绝大多数 RP 兼容层的
改动不属于这一类。

> 提 PR 时请在描述里贴上你跑的那条命令与结果。只贴结论（「已测试」）不算证据——
> 这是本项目的既有纪律（见 [ROBUSTNESS-LOOP.md](ROBUSTNESS-LOOP.md)）。

## 想认领的活：这五类不需要先读完整套文档

下面五类都是**边界清晰、可独立完成、不影响主线**的活。**不必先读 `MASTER_TODO.md`
（461KB）** —— 每类都标了「从哪下手」，你只需要读对应的那个文件。

### ① 真机验证回填（最缺人手，零代码门槛）

README 的「验证面速查」表里有大量 `⬜ 未实测` 格子。只要你手上有一台安卓真机或模拟器，
装上 APK 跑一遍、把结果回填进 Issue 就是有效贡献。
清单：[B-DEVICE-VERIFY-CHECKLIST.md](docs/B-DEVICE-VERIFY-CHECKLIST.md)（逐项怎么测、预期看到什么）。

> 这一项单独列出来，是因为它是当前**最大的验证债**——作者只有一台小米 11 Pro 和模拟器，
> arm64 真机面基本是空的。

### ② 新设备适配：把「徽章墙」补上

安卓机型碎片化极严重。你的手机能跑通、别人的不能，往往是 `phantom process killer`
（Android 12+ 的后台子进程上限）或 SELinux 策略差异。
提 Issue 附上：机型 / Android 版本 / 是否鸿蒙 / 复现步骤 / `logcat` 关键行。

### ③ TH API 记名 stub 名单里的长尾

`V0.3-FREEZE.md` §3 Tier 2 里记着一批「尚未实现但已记名」的酒馆助手 API。
每一个都是独立小任务：读基准语义 → 在 shim 里实现 → 补一条 vitest。
从哪下手：[ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) + `packages/src/dsht-rp-ui/src/client/th-shim.ts`。

### ④ 复杂卡脚本逐卡适配

某张卡的脚本在真 ST 能跑、在这里不行 —— 这一类**每次都是独立案子**，非常适合外部贡献。
≥81 项记名拒绝之外的增量、EJS 子集外的语法都属这里。

### ⑤ 表格记忆长尾

`V0.3-FREEZE.md` §3 Tier 2 列的 E7 自定义渲染占位符、E9 表格编辑器、E12 设置导入导出。
从哪下手：`packages/src/dsht-plugin-memory/`。

### 不要接的活

**Tier 3 是明确不支持的**（架构性决策，不是没做）——见
[V0.3-FREEZE.md](docs/V0.3-FREEZE.md) §3。接了会被拒，不是因为你做得不好。
另外 Tier 2 深水区默认不进主线（`V0.3-FREEZE.md` §2 的「收口模式」），
想动请先在 Issue 里说明，由维护者当轮授权。

## 你可以做什么

以下都不用问我（MIT 许可，见 [LICENSE](LICENSE)）：

| 你想做的 | 怎么做 |
|---|---|
| 改代码自己用 | Fork 一份随便改，不必知会 |
| 打包给朋友 | 可以。MIT 只要求保留版权声明与许可文本 |
| 学实现思路 | 随便看，代码里注释解释了不少「为什么这样做」 |
| 自己构建 | 见 README「快速开始」与构建脚本。⚠️ `jniLibs/*.so`（约 100MB 第三方二进制）不入库，首次构建先跑 `node rp-workspace/scripts/fetch-native-libs.mjs` |
| 报 bug | 提 Issue，附设备型号、Android 版本、复现步骤。先看 README 的「兼容分级」——Tier 3 的不兼容是预期行为，不算 bug |
| 想当共同开发者 | 提 Issue 说你打算做什么。我同意后把你加为 collaborator，你的改动可直接进主干 |

## 请不要做

- 发邮件或私信催修（没有响应时限）
- 在别处替我承诺支持

## 改出了有价值的东西

提 PR 贡献回来，或者 Fork 自行发布（MIT 允许，不必回馈上游）。

## 规则会变吗

可能会。以后有精力做社区协作了，会更新本文件并同步 README。

---

# English

[中文](#贡献说明) ｜ **English**

**Issues and Pull Requests are both welcome.**

- **Issues**: report bugs (include device model, Android version, repro steps) or discuss ideas
- **PRs**: open them directly. Maintainers review and merge; you may be asked for a few rounds of changes

## First, the minimum verification path (10 seconds — no device, no APK build)

**If you're changing logic under `rp-workspace/packages/src/`** (compat layer / import /
regex / preset / macros / MVU / UI logic), one command verifies it:

```powershell
cd rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile   # first time only, ~1 min
npx -y pnpm@10 test                        # ~10 seconds
```

Expected:

```
Test Files  86 passed (86)
     Tests  1839 passed | 2 skipped (1841)
```

No emulator, no Android SDK, no `jniLibs` third-party binaries needed (that 100MB is
only required when you **build the APK**). Type checking works the same way:

```powershell
npx -y pnpm@10 typecheck        # three-part: core / ui / tests
```

**When you *do* need the full chain** (`node rp-workspace/scripts/fetch-native-libs.mjs`
+ `build-dsht.ps1` + gradle, measured in hours): only if you touch the **Android shell**
(`rp-workspace/android/`), **build scripts**, or **platform patches**. Most RP
compat-layer changes are not in that category.

> In your PR description, paste the command you ran and its result. A bare conclusion
> ("tested") is not evidence — that's this project's existing discipline (see
> [ROBUSTNESS-LOOP.md](ROBUSTNESS-LOOP.md)).

## Work you can claim: five kinds that don't require reading the whole doc set

These five are **well-bounded, independently completable, and off the critical path**.
You do **not** need to read `MASTER_TODO.md` (461KB) first — each one says where to start.

### ① Device verification backfill (most needed, zero coding)

README's verification matrix has plenty of `⬜ untested` cells. If you have an Android
device or emulator, installing the APK, running it, and reporting the result in an Issue
is a valid contribution.
Checklist: [B-DEVICE-VERIFY-CHECKLIST.md](docs/B-DEVICE-VERIFY-CHECKLIST.md).

> This is called out separately because it's the **largest verification debt** right now —
> the author has one Mi 11 Pro plus an emulator, so the arm64 real-device surface is
> largely empty.

### ② New-device adaptation

Android device fragmentation is severe. Your phone working while someone else's doesn't
is usually `phantom process killer` (Android 12+'s background child-process cap) or a
SELinux policy difference. Open an Issue with: model / Android version / HarmonyOS or not
/ repro steps / relevant `logcat` lines.

### ③ The long tail of named-stub TH APIs

`V0.3-FREEZE.md` §3 Tier 2 lists Tavern Helper APIs that are "recognized but not yet
implemented". Each is an independent small task: read the reference semantics →
implement in the shim → add a vitest case.
Start here: [ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) +
`packages/src/dsht-rp-ui/src/client/th-shim.ts`.

### ④ Per-card adaptation for complex card scripts

A card's script works in real ST but not here — each one is an **independent case**, ideal
for outside contributors. This covers the increment beyond the 81 named refusals, plus
syntax outside our EJS subset.

### ⑤ Table-memory long tail

E7 custom render placeholders, E9 table editor, E12 settings import/export — listed in
`V0.3-FREEZE.md` §3 Tier 2.
Start here: `packages/src/dsht-plugin-memory/`.

### What not to claim

**Tier 3 is explicitly unsupported** (an architectural decision, not an omission) — see
[V0.3-FREEZE.md](docs/V0.3-FREEZE.md) §3. A PR there will be declined, and not because it's
bad work. Also, the Tier 2 deep end is off the mainline by default (`V0.3-FREEZE.md` §2,
"closing mode") — open an Issue first and get per-round authorization.

## What you can do

None of the following needs my permission (MIT license, see [LICENSE](LICENSE)):

| You want to | How |
|---|---|
| Modify the code for yourself | Fork and change anything, no need to notify |
| Share builds with friends | Fine. MIT only requires keeping the copyright and license text |
| Study the implementation | Read freely; many comments explain the "why" |
| Build it yourself | See "Quick start" in README and the build scripts. ⚠️ `jniLibs/*.so` (~100MB third-party binaries) are not in the repo — run `node rp-workspace/scripts/fetch-native-libs.mjs` before your first build |
| Report a bug | Open an Issue with device model, Android version, and repro steps. Check README's compatibility tiers first — Tier 3 incompatibilities are expected, not bugs |
| Become a co-developer | Open an Issue describing what you plan to do. Once approved, I'll add you as a collaborator with direct commit access |

## Please don't

- Email or DM to hurry fixes (no response-time guarantee)
- Promise support on my behalf elsewhere

## If you built something valuable

Contribute it back as a PR, or publish your own fork (MIT allows it; no need to give back).

## Will this change?

Possibly. If I get the bandwidth for community collaboration, I'll update this file and README accordingly.