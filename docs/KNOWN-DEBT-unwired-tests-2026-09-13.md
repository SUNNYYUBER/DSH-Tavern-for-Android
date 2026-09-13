# 已知欠债：8 个失败中的测试（实现已写好但接线未落地）

> 建立日期：2026-09-13（AI 会话，依据用户 goal「发布前收口」）
> 状态：**未修复**。本文件如实记录，避免这些失败被误读为「不明故障」。

## 这批失败是怎么出现的

2026-09-13 做仓库净化时，把工作区里 **45 个未跟踪文件**纳入版本控制（提交 `a7283e6`）。
其中 7 个是**并发 AI 实例的进行中工作**：测试已写好，但对应接线尚未落地。
这使 `npx vitest run` 从「全绿」变为「8 文件 / 73 项失败」。

**性质澄清**：这些是**测试先行**，不是回归。内核函数已实现且单测通过，
缺的是**调用点接线**。经逐文件核实（读源码对比 spec 断言），**无一项属于「测试写错」**。

## 逐项状态

| spec | 缺什么（核实结论） | 后果 | 优先级 |
|---|---|---|---|
| `b12-memory-master-switch` | `src/dsht-plugin-memory/index.ts:819-835` 注入段无 `cfg.enabled` 判断；`/expand`(:1422)、`/summarize`(:1447) 无总开关守卫 | 🔴 **总开关关不掉注入**（旧记忆仍每轮占上下文）；数据面返回 400 而应 409 | **高（用户可见）** |
| `safe-regex` | `src/lore/trigger.ts` 完全未接 `RegexSafetyGuard`：`TriggerResult`(:109-121) 缺 `degradations` 字段；`keyToPattern`(:124) 仍用旧实现 | 🔴 **真实 ReDoS 通道未关闭** —— 实测 `(a+)+$` 配 26×`a`+`b` 阻塞 **6321ms** | **高（安全）** |
| `card-fence` | `src/dsh-plugin/index.ts` 一处都没接 `guardCardContent` / `renderGuardedCardText`；`expandSnapshotMacros(personaRaw` 有 2 份重复 | 🟠 卡正文当前**未受**围栏/消毒保护（可冒充系统指令） | **高（安全）** |
| `ext-template-render` | `host-vendor.ts:640-643` 门面返回 undefined（显式出声的退化）；`index.ts` 未注册 `SCRIPT_ASSET_PREFIXES` | 🟡 ST 扩展模板渲染不可用（**显式报错，非静默**） | 中 |
| `host-regex-bridge` | `__resetHostRegexBridge` / `flushHostRegexSync` 整体未实现 | 🟡 卡的正则写回停在 localStorage，不进 node 侧 | 中 |
| `mvu-event-namespace` | `th-shim.ts:2221-2238` 的 `Mvu.events` 只有 `on/emit`，缺 5 个 `mag_*` 常量 | 🟡 卡监听 `mag_variable_*` 收不到（**注：2 条负控是假绿**，接线时需一并实现告警） | 中 |
| `st-modules` | `index.ts` 未注册 4 条 ST 模块路由；`build-wb.sh` 缺 `[A13]` 断言 | 🟡 4 个 ST 标准模块资产已就绪但不可达 | 中 |
| `th-host-events` | `host-vendor.ts` 缺 2 处 `settings_updated` 发射点（`RpPresetSwitch` 侧已就绪） | 🟡 设置落盘不通知帧 | 中 |

## 处置决定（本轮）

**不移出测试**。理由：这些 spec 指向**真实未落地的接线**，移出等于用「删测试」掩盖
「功能未交付 + 安全通道未关闭」，违反本项目「诚实失败优于静默掩盖」的铁律
（MASTER_TODO 纪律 D3/D4）。

**本轮做了什么**：如实记录本清单，使 `vitest` 的 8 项失败有明确出处，
不构成「不明故障」。

**建议的后续处置**（按优先级）：
1. 修 `safe-regex` 接线（安全，实测有 6.3s 阻塞）
2. 修 `card-fence` 接线（安全，防提示注入）
3. 修 `b12` 总开关（用户可见）
4. 其余 5 项按功能优先级排期

## 复现

```powershell
cd d:\DSH RolePlay\rp-workspace\packages
npx vitest run 2>&1 | Select-String 'Test Files|Tests  '
# 预期：Test Files  8 failed | 59 passed (67)
#       Tests  73 failed | 1308 passed | 2 skipped (1383)
```

## 附：核实方法（可复跑）

每个 spec 的判定过程 = 读 spec 顶部 import → 读对应源码 → 确认导出是否存在 →
跑单文件 vitest 看错误是「符号 undefined」（接线缺失）还是「值不符」（行为错误）。
本次 8 个文件全部落在「接线缺失」，唯 `b12` 兼有行为不符（源码读了 cfg 但没用于门控）。
