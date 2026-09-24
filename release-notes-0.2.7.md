# DSH Tavern for Android v0.2.7 — 底层 DSH 升级到 0.1.7-rc.1（会话格式代次 v3 → v4）

**版本**：`versionName 0.2.7` / `versionCode 9`；runtime sentinel **v390**（双架构同代次）

> **本版对用户可见行为零变化** —— 没有新按钮、没有新界面、没有改交互。
> 换掉的是**底层**：DSH 运行时从 `0.1.5-rc.3` 升到 `0.1.7-rc.1`（277 个子包全部同版），
> 会话数据格式代次从 **v3 升到 v4**。升级后**首次打开老会话会自动迁移**，并**在迁移前强制全量备份**。

---

## 为什么值得升

DSH 0.1.7 系列把此前所有 alpha 汇总，并引入了**插件版本号机制**。
对 DSHTavern 来说，本版把上层建筑重新对齐到官方最新接口面，后续功能开发不再背历史包袱。

---

## ⚠️ 最重要的一件事：自动迁移 + 迁移前强制备份

会话格式代次 `v3 → v4` 的官方迁移器有一条**硬约束**：

> `V3 catalog migration requires explicit historical child facts...`

换句话说：**迁移需要「历史子会话」的证据**。官方持久化层会自己采集（按
`origin === "subagent" && parentSession === id` 筛子会话），并带 TOCTOU 守卫
（源在采集后被改动即抛 `JsonlGenerationSourceChangedError`）—— 这部分我们无需干预。

我们要做的是**在迁移发生之前，把数据先保下来**。本版在 `MainActivity.onCreate()` 挂了
一道**前置闸门**：

1. 扫描 `$DSH_HOME` 下每个 `.jsonl` 会话文件的**首行版本号**；
2. 只要发现任何一个 `version < 4` ⇒ **强制全量备份**到交换目录（`ExchangeDir.externalSide()`）；
3. 备份产物形如 `dsht-prebak-*.zip`，**凭据类文件 0 条**（`.credentials.yaml` / `dsht-token` /
   `.dsht-alive` / `device-audit.jsonl` 一律在拒绝清单内，不落备份）。

设置面板里另有手动入口 **「升级前安全备份」**，随时可自己跑一次。

> 迁移是**原地**的：原 `.jsonl` 文件保留不删，内容逐字未丢（模拟器实证）。

---

## 本版实证（模拟器 x86_64，真机实测）

| 项 | 结果 |
|---|---|
| node 启动 | **一次成功**，boot loop 计数 **0** |
| 老会话 v0 代次打开 | 走完整迁移链 **v0 → v4** 成功；原文件保留、内容逐字未丢 |
| 备份闸门 | 生成 `dsht-prebak-*.zip`，**凭据 0 条** |
| RP 功能四项 | 导入 / 世界书 / 状态栏 / 回退 **4/4 通过** |
| 一轮完整对话 | 通过（LLM 注入链未断） |
| 出厂 APK 复核 | DSHTavern 设置 tab 在、四张插件卡全在 |

---

## 技术变更明细

### A. 插件 peerDependencies 对齐（8 个插件）
统一改为 `workspace:*` 形态 —— 插件与宿主 runtime 同代次，不再允许范围漂移。

### B. 数据层
- **v4 代次表 fail-closed**：`CURRENT_SESSION_GENERATION = 4` 与单源
  `sessionFormatKnownGenerations` 最大值做**一致性判据**（漂移即构建期报红）。
- **plugin source 代次无关识别**：v4 把 `{kind:'plugin', plugin:'<名>'}` 重写为
  `{kind:'plugin:<名>'}`（`plugin` 字段被删）。我方解析器两种形态**都能识别**。
- **子会话文件名挑选**：显式 v4 控 —— `session.v4.jsonl` 必须胜过 `session.jsonl`。

### C. 补丁层
三处平台补丁（Android 硬链接禁用、zstd 压缩、bash sandbox）的**锚点**按 0.1.7 实跑结果重新定位；
新增 **锚点指纹跨代比对判据**（C.4）：`apply-platform-patches.py` 采集 20 项锚点指纹，
`audit-patch-fingerprints.mjs` 与上一代基线逐项比对 ——
**「命中数相同」不等于「改的是同一处」**，本判据专门防这个（selftest 9/9）。

### D. 壳层 / 装配层
- 官方在 0.1.7 **删除了 `settings.plugin.item`**，改为 `settings.plugins.tab`
  （每项 = 一整页）。我方改为**无条件双 inject**（原「先探测再二选一」方案被真机证伪：
  declaration 尚未存在时探测恒为 `undefined`，两个分支都不命中）。
  cordis 的 `ctx.slots.inject` 本身就是「等声明」原语 —— declaration 已在则同步跑，
  否则在 declaring `register()` 提交后跑，无需自己探测。
- **`patchReload` 键在 0.1.7 完全消失**，已按新形态处理。
- 包改名同步：`dsh-agent-presets` → `dsh-agent-preset`（单数）+ `-registry`；
  `dsh-code-runtime` → `dsh-workflow-ptc`。

---

## 安装包

| 文件 | 架构 | 大小 | SHA256 | 用途 |
|---|---|---|---|---|
| `DSH-Tavern-0.2.7-arm64-release.apk` | arm64-v8a | 265.85 MB | `E57899A66C2FE7057ED4DFAA4BA9CC3752461BEAB3EFD62AC3C67C47F73754E7` | **真机**（签名 release） |
| `DSH-Tavern-0.2.7-x86_64-debug.apk` | x86_64 | 266.61 MB | `44AE87F0B80D04B284EBDBA89C8F168DBBBFF33625B974DC4CE2E5718EDC8318` | PC 模拟器自测 |

---

## 质量门

- **构建门禁**：**55 条** `[gate] OK`，退出码 0
- **版本一致性审计**：`audit-dsh-version.mjs` — 5 OK / 0 FAIL（267 个子包零漂移）
- **升级就绪审计**：`audit-upgrade-readiness.mjs` — 6 OK / 0 BLOCK / 0 UNKNOWN
- **锚点指纹**：20 项一致（PASS）
- **自证契约**：`audit-selftest-claims.mjs` — 受检闸门 49 个，违规 0 处
- **M4 内容级核验**：`verify-apk-payload.py` — 169 项标记，**缺失 0**
- **APK 内嵌 runtime 版本核验**：主包 / `dsh-session` 均 `0.1.7-rc.1`
- **typecheck**：0 错
- **vitest**：86 文件 / 1839 通过 / 2 skipped

---

## 版本号说明

本版**停在 `0.2.7`**，未跳 `0.3.0`。

理由：本次对用户可见行为**零变化**，但底层换了**数据格式代次**——
这属于发布策略判断，不是技术判断。`0.3.0` 留给真正的功能换代。

---

## 诚实标注

- 真机（arm64）完整启动验收需真实设备；本版 arm64 包通过的是**静态依赖闭合审计** +
  **编译/门禁全绿** + **APK 内嵌 runtime 版本核验**，尚未在 arm64 真机上跑过一次完整启动。
  按 GOAL 完成定义第 ⑥ 条由众包回填。
- 模拟器实证（v0→v4 迁移、备份闸门、RP 四项、一轮对话）均在 **x86_64** 上完成。
