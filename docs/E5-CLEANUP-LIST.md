# E5 文件级清理清单（已执行）

> 依据用户 goal 轨道 E5：「只删未跟踪的」。生成时间：2026-09-13。
> **执行时间：2026-09-14**（第 1/2/3/5/6 项已删；第 4 项按 E-G 需要保留）。

## 执行结果

| # | 路径 | 体积 | 状态 |
|---|---|---|---|
| 1 | `DSHTavern-m1-test.apk` | 122.9 MB | ✅ 已删 |
| 2 | `DSHTavern-m1-test-x64.apk` | 185.5 MB | ✅ 已删 |
| 3 | `rp-workspace\dsh-runtime-android\node_modules-0.1.2-old\` | 171.5 MB | ✅ 已删 |
| 4 | `rp-workspace\android\app\build\` | 1206.8 MB | ✅ 已删（E-G 双架构重建完成后清理） |
| 5 | `rp-workspace\tmp\` | 4.0 MB | ✅ 已删 |
| 6 | `rp-workspace\pc-verify-home\` | 4.0 MB | ✅ 已删 |
| | **累计释放** | **约 1.69 GB** | 全部执行完毕 |

第 4 项在 E-G 双架构 APK 重建完成后清理（重建期间需复用中间产物加速，先删后建属无效功）。

## 判据与安全保证

- 所有目标**均未被 git 跟踪**（执行前逐项 `git ls-files` 复核，全部 0 记录）⇒ 删除不影响任何提交历史
- 所有目标**均可再生**（构建产物 / 测试暂存 / 旧版本备份）

## 清单

| # | 路径 | 体积 | 性质 | 可再生方式 | 风险 |
|---|---|---|---|---|---|
| 1 | `DSHTavern-m1-test.apk` | 122.9 MB | 8 月底旧测试包（M1 里程碑） | 已废弃，被 0.2.0 取代 | 零 |
| 2 | `DSHTavern-m1-test-x64.apk` | 185.5 MB | 同上（x64 版） | 同上 | 零 |
| 3 | `rp-workspace\dsh-runtime-android\node_modules-0.1.2-old\` | 171.5 MB | DSH 0.1.2 旧依赖树备份（当前已升 0.1.5） | `pnpm install` 或保留新版 | 零（构建不引用，见下） |
| 4 | `rp-workspace\android\app\build\` | **1206.8 MB** | Gradle 构建中间产物 | `gradle assembleRelease` 立即重建 | 零 |
| 5 | `rp-workspace\tmp\` | 4.0 MB | 测试暂存（pc-bundle-e2e / resilient-behavior） | 跑对应测试时自动生成 | 零 |
| 6 | `rp-workspace\pc-verify-home\` | 4.0 MB | PC 等价验证的伪 `$DSH_HOME` | `scripts/setup-pc-verify.mjs` 重建 | 零 |
| | **合计** | **约 1.69 GB** | | | |

## 逐项核实证据

**#3 `node_modules-0.1.2-old` 是否被构建引用？**
```
build-dsht.ps1 的路径变量：
  $runtimeDst = "$ws\dsh-runtime-android"           ← 不含 -old 后缀
跳过安装时用：$runtimeDst\node_modules              ← 同样不含后缀
```
⇒ 构建脚本**不引用**该目录；它是历史遗留备份。当前 runtime 为 0.1.5-rc.1。

**#4 `android/app/build` 体积异常大（1.2GB）的说明**
含 `intermediates/`（dex / jar / merged assets / 各 ABI 中间产物）+ `outputs/`。
每次 gradle 构建自动重建。

## 附：不在本清单内但值得注意的项

以下项**保留**（有用途或属交付物）：

| 路径 | 体积 | 为什么保留 |
|---|---|---|
| `DSH-Tavern-0.2.0-arm64-release.apk` | 122.5 MB | **当前交付物**（真机正式签名） |
| `DSH-Tavern-0.2.0-x86_64-debug.apk` | 187.8 MB | 当前模拟器自测包 |
| `rp-workspace\downloads\` | 较大 | 构建必需（gradle 发行版 + Termux deb 源包） |
| `rp-workspace\android\app\src\main\jniLibs\` | 100.3 MB | **入库**（用户决策，见 README） |
| `rp-workspace\android\app\src\main\assets\dsh-runtime.zip` | 65.3 MB | 构建必需（虽然 gitignore 忽略） |

## 执行方式（确认后）

```powershell
# 逐项删除（保留此命令供审计）
Remove-Item 'DSHTavern-m1-test.apk','DSHTavern-m1-test-x64.apk' -Force
Remove-Item 'rp-workspace\dsh-runtime-android\node_modules-0.1.2-old' -Recurse -Force
Remove-Item 'rp-workspace\android\app\build' -Recurse -Force
Remove-Item 'rp-workspace\tmp' -Recurse -Force
Remove-Item 'rp-workspace\pc-verify-home' -Recurse -Force
```

**回退方法**：
- #1/#2：从 `D:\DSH-RolePlay-archive` 或重新构建找回
- #3：`pnpm install`（若需回到 0.1.2）
- #4：`cd rp-workspace\android; gradle assembleRelease`
- #5：跑 `pc-bundle-e2e` 相关测试
- #6：`node rp-workspace/scripts/setup-pc-verify.mjs`

---

**请确认是否执行。** 如确认，我将按上述命令删除并报告释放空间。
