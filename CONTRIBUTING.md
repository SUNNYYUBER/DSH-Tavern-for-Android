# 贡献说明

**中文** ｜ [English](#english)

**Issue 与 Pull Request 都欢迎提。**

- **Issue**：报 bug（附设备型号、Android 版本、复现步骤）或讨论想法
- **PR**：直接提。维护者评审与合并，合并前可能请你改几轮

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