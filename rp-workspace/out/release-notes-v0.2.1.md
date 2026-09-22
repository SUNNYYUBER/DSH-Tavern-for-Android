# DSH Tavern for Android v0.2.1

v0.2.0 正式版后的第一个迭代：[MVU 痛点调研](docs/MVU-PAINPOINTS-2026-09-20.md)排好的三个「做」全部落地——主题是「MVU 的人机直接操作面」。

## 本版增量

- **MVU 调试模式**：RP 面板新增「调试」开关——打开后 MVU 通知全放行，并每 8 秒轮询提取打点，把「提取命中：N 条补丁（扫描 M 条）/ 提取未命中」直推 toast；开关状态持久化（`mvu-settings.json` 的 `dsht_mvu_debug`），默认仍全关（ST 兼容语义不动）。卡作者排错三连问（脚本没跑？提取没中？通知没开？）从此每一层都有答案。
- **状态栏模板编辑**：RP 面板新增「状态栏」按钮——查看/编辑状态栏模板（读写到 `mvu-settings.json` 的 statusbar 键），预览渲染**不落盘**（输出走 sanitize 白名单）。此前前端只有消费没有任何写入入口，改模板只能手写 JSON。
- **变量点值编辑**：MVU 状态树叶子值可直接改（叶子行 ✎ 按钮，Enter 提交 / Esc 取消，输入智能解析 JSON）——走与 LLM `UpdateVariable` 相同的落账管线（`target:'state'`：JSONPatch 增量 + schema 校验（合并视图）+ undo/快照照记），手动纠正好感度/物品/设定不再「改完被旧值遮蔽」。

## 安装包

| 文件 | 架构 | 用途 |
|---|---|---|
| `DSH-Tavern-0.2.1-arm64-release.apk` | arm64 | **真机**（小米 / 华为卓易通） |
| `DSH-Tavern-0.2.1-x86_64-debug.apk` | x86_64 | PC 模拟器自测 |

覆盖安装保留数据；runtime sentinel **v371**（双架构同代次），覆盖安装自动重解压最新 runtime。

## npm 插件包

6 个 RP 插件 + `dsht-rp-suite` 元包已同步 0.2.1（`dsht-plugin-mvu` 含 `target:'state'` 端点、`dsht-rp-plugin` 含提取打点等本版增量）：`npm i dsht-rp-suite` 一行装齐。`dsh-plugin-lint` 无改动，维持已发的 0.2.1。

## 质量门

- vitest 84 文件 / 1811 通过 / 0 失败（新增 `/dsht-mvu/variables/patch` `target:'state'` 端点测试 5 条）
- M4 内容级产物核验：双架构各 169 项标记，缺失 0
- 48 项常驻门禁全绿（许可卫生 / 契约快照 / 构建路径一致性）
- 构建期 APK 内嵌 runtime 版本核验双包通过（dsh 0.1.5-rc.1，数据兼容形态一致）

## 验证面（诚实标注）

模拟器面的既有验证结论见 README「验证面速查表」；本期三个新能力的真机/鸿蒙面**未实测**——按项目口径，真机验证交给感兴趣的开发者与用户（[B-DEVICE 清单](docs/B-DEVICE-VERIFY-CHECKLIST.md)），欢迎回填。
