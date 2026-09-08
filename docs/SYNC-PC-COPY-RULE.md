# 回退插件改动同步 PC 副本（仅限 dsht-plugin-undo）

> **范围澄清（2026-09-08，用户澄清）**：本规则的适用范围**仅限回退/编辑插件 dsht-plugin-undo**——它是唯一在本仓库（DSHTavern）与 PC 副本两侧都存在的插件（PC 侧部署于 `.a Agent RolePlay Project\.dsh-home`），所以改它时两侧都改，铁律不变。
> **除回退插件外，两侧没有任何其它互通任务**：dsht-rp-ui / dsh-plugin / 其它 dsht-plugin-* 在 PC 副本没有部署副本，改动无需同步；PC 副本目录里的 BitFun / agenthub 是**另一个完全独立的项目**，与本仓库无代码互通。此前「一切 RP 链路上的插件均需同步」的表述系误读，特此勘正。

## 规则
每一次改动回退/编辑插件（dsht-plugin-undo）源码后，**必须同步 PC 副本项目**的部署产物：

```
D:\SillyTavern-1.16.0\SillyTavern（now using）\SillyTavern-1.16.0\.a Agent RolePlay Project
```

## PC 副本结构事实（2026-09-04 实查）
- PC 副本 **没有** rp-workspace 源码副本；它部署的是**构建产物**：
  - `\.dsh-home\profiles\web\node_modules\dsht-plugin-undo\`（旧版回退插件部署产物，2026-08-28）
  - `\DeepSeek Harness-active\`（DSH 官方源码副本，**版本 0.1.1-rc.1**，与我们 APK 的 rc.8 不同线）
  - `\dsh-plugins\`（另一组插件：agent-monitor / mcp-manager / rules——BitFun/管理前端侧，与 RP 插件无关）
  - PC 插件库里另有社区插件（dsh-message-edit / dsh-better-sidebar / dsh-llm-fallbacks / dsh-notification 等）
- 新架构下回退功能 = dsht-plugin-undo 纯 host 数据面（/dsht-undo/*）+ UI 在 dsht-rp-plugin。
  同步 = 重新构建对应插件产物并部署到 PC 副本的 .dsh-home profile（node_modules 双写同款规则）。

## 同步状态（2026-09-04 本轮）
- 本轮改动：`dsh-plugin/index.ts`（convert-chat 文件直读直写 + write-files 分批节流）、
  `assets/skills/st-migration/SKILL.md`、`references/session-jsonl-contract.md`。
- **结论：本轮无需向 PC 复制文件**——PC 副本没有 dsh-plugin / dsht-rp-plugin / skill 的
  任何副本（改的不是 PC 上存在的文件）。
- PC 侧 dsht-plugin-undo 旧产物升级 = 独立任务（需先确认 PC DSH 0.1.1-rc.1 与 DSHT
  插件契约的兼容性：slot 名、web profile patch、cordis 版本）。

## 同步检查清单
1. 改完源码 → 构建产物（esbuild）。
2. 确认 PC 副本 .dsh-home 里受影响插件的部署产物是否需要更新（对比文件内容/版本）。
3. 在回复与 MASTER_TODO 中明确标注「已同步 PC 副本」或「PC 副本待同步（原因）」。
