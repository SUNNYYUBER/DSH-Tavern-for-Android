# DSH Tavern for Android v0.2.2

主题：**安卓化层对 DSHA 的差距补齐**（[GOAL-ANDROID-GAP](docs/GOAL-ANDROID-GAP-2026-09-21.md) 全部八工作面收口）——只看「安卓化 DSH」这一层，不含 RP 插件增量。

## 本版增量

- **局域网访问**（新）：设置面板（右下角 ⚙）一键开启——同一 Wi-Fi 的电脑/平板可用浏览器直接访问本机的 DSH，大屏打字/管理卡片。形态是原生 TCP 反代（上游刻意拒绑 0.0.0.0，反代不动其防线）：访问必须持有 web 令牌，无令牌一律 401。
- **备份 / 恢复**（新）：设置面板导出全量数据 zip（停服备份防半行残尾；**凭据不进包**——恢复后重新填 API key，这是刻意的安全取舍）；恢复前只读体检（CRC 校验 + 「多少会话/多大/来自哪个版本」预览），确认后一键还原。
- **自检与一键修补**（新）：9 项体检（运行时 / node / 端口 / 令牌 / 工具链 symlink 林 / 沙箱 / 插件注册 / 磁盘 / 数据目录）+ 能修的当场修 + 重装运行时（删哨兵重解压）。
- **端口冲突自动回退**：3080 被占自动顺延 3081..3089，连续起不来会重探测。
- **旧 WebView polyfill 补齐**：`AbortSignal.timeout` + `crypto.randomUUID`（后者是局域网 HTTP 非安全上下文的必需面）。

## 调研与决策（同批交付）

- **终端（PTY）打通方案定案**：[PTY-RESEARCH](docs/PTY-RESEARCH-2026-09-21.md)——npm 上唯一现成的 Android node-pty prebuild 经 ELF 符号实证**不可直接用**（`openpty` 未定义）；决策 = NDK 进构建链 + 自编译 node-pty + openpty shim（x86_64 模拟器可自验是决定性论据），实施在后续版本。
- **数据不迁公共目录**：[DATA-DIR-EVAL](docs/DATA-DIR-EVAL-2026-09-21.md)——四判据（备份等效 / FUSE IO 开销 / 卓易通未知 / 机制破坏面），「不丢数据」由备份通道承担。
- **CI 出包上线**：GitHub Actions 完整复现构建链（含 48 门禁），README 的 DSHA 对照表已按双方最新版口径刷新（13 维度）。

## 安装包

| 文件 | 架构 | 用途 |
|---|---|---|
| `DSH-Tavern-0.2.2-arm64-release.apk` | arm64 | **真机**（小米 / 华为卓易通） |
| `DSH-Tavern-0.2.2-x86_64-debug.apk` | x86_64 | PC 模拟器自测 |

覆盖安装保留数据；runtime sentinel **v372**（双架构同代次），覆盖安装自动重解压最新 runtime。

## npm 插件包

6 个 RP 插件 + `dsht-rp-suite` 元包已同步 0.2.2（本轮插件侧增量：LAN 模式信任栅栏 `DSHT_LAN_MODE` 支持）：`npm i dsht-rp-suite` 一行装齐。`dsh-plugin-lint` 无改动，维持已发的 0.2.1。

## 质量门

- vitest 85 文件 / 1817 通过 / 0 失败（新增 LAN 信任栅栏测试 6 条，含 DNS rebinding 防线正反控）
- M4 内容级产物核验：双架构各 169 项标记，缺失 0
- 48 项常驻门禁全绿；构建期 APK 内嵌 runtime 版本核验双包通过
- Kotlin 编译验证通过

## 验证面（诚实标注）

本轮五个原生新能力的 UI 面（LAN 访问 / 备份恢复 / 自检 / 端口回退）**模拟器与真机端到端未实测**——原生层已过编译验证，栅栏层有单测正反控，按项目口径交给社区众包回填（[B-DEVICE 清单](docs/B-DEVICE-VERIFY-CHECKLIST.md)）。内置终端仍不可用（打通方案已定案，见上）。
