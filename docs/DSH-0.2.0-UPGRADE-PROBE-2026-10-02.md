# 0.2.0-rc.2 升级勘察报告（U0 · 附录 F）

> 建立：2026-10-02。执行依据：`docs/DSH-UPGRADE-AUDIT-2026-09-23.md` 附录 E 方法论。
> 实测工具：`rp-workspace/tmp/probe-020rc.mjs`（原始输出 `probe-020rc.out.txt`）。
> 基线 = 我方 `dsh-runtime-src`（0.1.7-rc.1，277 包）。

## 一句话结论

**0.2.0-rc.2 是 0.1.7-rc.1 的增量演进，无结构性破坏：会话格式 4→4 未换代、
isReplaceOp 三键（op/startSeq/endSeq）未变、12/12 补丁锚点全命中、
宿主 4 组哈希锚点全在、59 事件类型零增删。可以升级。**

## 逐面实测

| 面 | rc.2 实测 | 判定 |
|---|---|---|
| 包集 | 277 → **288**（+11 / −0，无消失） | ✅ 纯增量 |
| 新增包 | `dsh-client-product-analytics` `dsh-client-shortcuts` `dsh-client-ui-settings-session-log` `dsh-client-ui-shortcuts` `dsh-experimental-auto-review` `dsh-experimental-schedule-bundle` `dsh-host-product-telemetry-otel` `dsh-llm-deepseek-account` `dsh-llm-deepseek-api-key` `dsh-otel` `dsh-util-code-language` | ✅ 无我方依赖面冲突 |
| SESSION_FORMAT_VERSION | **4 → 4**（迁移边 v0→v1…v3→v4 四条齐全） | ✅ 未换代 ⇒ U2 大幅收窄 |
| isReplaceOp 三键 | `[op,startSeq,endSeq]` 未变 | ✅ 数据兼容生命线成立 |
| 事件类型 | 59 → 59，零增删 | ✅ |
| 补丁锚点 | **12/12 命中**（首轮探针报 ITERATOR 失效为**探针假阳性**：该补丁自 0.1.7 轮起已是候选自动发现，rc.2 中守卫在 `client.pdf.js` ×2 命中；探针判据已修） | ✅ U3 收窄为「直接跑 apply + 复跑指纹比对」 |
| 壳面 | `dsh web:` ✓ `--no-open` ✓ `--port` ✓ `--trusted-host` ✓；`--expose-internals` 仍无（0.1.7 已撤销，NodeService 注释已更新过） | ✅ |
| 装配 external | 6 个 external 包全在 | ✅ |
| 宿主 DOM 锚点 | pI_x6G ×46 / VOzbGW ×49 / hHd-Xa ×190 / wSkVaW ×108 | ✅ 全在 |
| slot 面 | 我方 6 个核心 slot 全在；`settings.plugin.item` 仍无（0.1.7 已删，我方已有 `settings.plugins.tab` 整页双路径，rc.2 的 `PluginsSettingsSection.d.ts:18` 确认 tab 声明在） | ✅ 无需动作 |
| 插件版本机制 | `evaluatePluginCompatibility` 在 dsh-app-boot 未变（workspace:* 替换为 runtime 版本语义相同；豁免文件 compatibility.json 相同） | ✅ |
| 我方 peer | 7/8 无 peer（放行）；`dsht-preflight` 有 peer（形态需在 U1 复核一次 satisfies 语义） | ✅ |

## 对后续阶段的修订

1. **U2（数据层）收窄**：代次未换代 ⇒ 只需跑 `verify-session-pipeline.mjs` 会话六判据 +
   设备真实数据 resume 探针，不写新解析器代码。
2. **U3（补丁层）收窄**：锚点全命中 ⇒ 直接 `apply-platform-patches.py` +
   `audit-patch-markers.py` / `audit-patch-fingerprints.mjs` 复跑，预期零手工重锚。
3. **U1（版本单源）不变**：`dsh-version.json` 更新 + `sessionFormatKnownGenerations` 维持 `[3,4]`。
4. **U4 风险点更新**：新增 11 包含 `dsh-llm-deepseek-account` / `dsh-llm-deepseek-api-key`
   （provider 目录可能影响 `agentDefaultModel` 通道归属排查经验——LEARNINGS ① 的 route 集合可能新增成员），
   实测阶段留意 RP 面板 provider 路由行为。

## UNKNOWN 清单（P-17）

无。全部面有实测读数，无「测不出」项。
