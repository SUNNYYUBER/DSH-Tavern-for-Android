# AGENTS.md — DSH RolePlay（DSH Tavern for Android）

> 本文件由 Trae 导出会话《DSH Android Roleplay App Plan.md》（101036 行）蒸馏沉淀而来，
> 整合报告：`trae-migration/docs/sessions-integration-report.md` 第 3 节。

## 项目是什么

DSH Tavern：把 DSH 完整移植进安卓 APK（Kotlin 壳 + termux Node 二进制伪装 libnode.so +
WebView 加载本地 DSH Web UI），叠加自研 RP 特化 Cordis 插件集，做成
"能在安卓上跑的 DSH + 兼容 SillyTavern 生态的 roleplay 整合包"。

- 当前版本：**v0.2.8 已发布**（arm64 release，versionCode 10，内嵌 runtime 0.1.7-rc.1；体检修复轮：API 三态诚实 + 发送哨兵 + 门禁补强）
- 权威活文档：`docs/MASTER_TODO.md`（计划与进度以它为准，本文件只写不变的约束）
- 构建链：`rp-workspace/scripts/build-dsht.ps1`（55 条构建门禁）
- 仓库：GitHub `SUNNYYUBER/DSH-Tavern-for-Android` + CI `build-apk.yml`

## 铁律（来自会话原约束，不可协商）

1. **DSH 源码零改动**：一切功能以 `rp-workspace/packages` 下 Cordis 插件实现；
   认为"必须改 DSH 才能做"时先停下，报用户裁决。
2. **版本单源**：DSH 版本以 `dsh-version.json` 为唯一事实来源；升级前必跑契约 diff +
   audit-upgrade-readiness。**"编译过+门禁绿"不等于"设备上历史会话打得开"**，模拟器/真机实测不可省。
3. **确定性数据变换用 TS 导入器代码，不用 LLM**；LLM 只处理规则覆盖不了的语义长尾，且必须明示用户。
4. **不可逆数据操作前强制全量备份**到用户可见目录；备份失败则明令阻止，不静默通过。
5. **终端只用 PowerShell 7 或 Git Bash，绝对禁止 PowerShell 5**；
   编辑 `build-dsht.ps1` 后必须核查 BOM（历史上 BOM 被剥掉 6+ 次导致构建卡死）。

## 架构要点（三层）

前端单视图＋折叠栏（聊天流与 harness 运行详情＝同一 session 事件流的两个投影）／
Harness 层（Cordis 插件实现 prompt 组装、世界书引擎、正则）／ST 数据方言兼容层。
oneshot 为默认、harness 按需介入；世界书只保留检索语义（constant/关键词/递归/深度）；
预设＝cordis.yml 组合配置＋skill 文档；重 roll 用原生 replace SurfaceOp 变体链，真分支才 session.fork；一卡一工作区。

## 版权红线

SillyTavern 为 **AGPL-3.0**、JS-Slash-Runner 为 **AFPL**——任何代码移植/分发动作前
先核对 `docs/THIRD_PARTY_LICENSES.md` 与既有的合规处置记录，不确定就报用户。

## 当前断点（2026-09 会话结束时）

v0.3.0 功能换代规划；①`dsh-plugin-lint` 工具；②补丁上游化 PR；③MVU 深耕调研；
待用户配合：npm publish 首发、小米 11 Pro 真机 B0 五条验证、鸿蒙卓易通回填。
