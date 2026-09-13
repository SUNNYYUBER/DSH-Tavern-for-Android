# 已知欠债：8 个失败中的测试（已于本轮全部接线完成）

> 建立日期：2026-09-13（AI 会话，依据用户 goal「发布前收口」）
> 更新日期：2026-09-14 —— **8 项全部接线完成**，`vitest` 已恢复全绿。
> 本文件保留，用于记录这批失败的**成因与处置**，避免同类问题再被误读为「不明故障」。

## 状态：已清零

```
Test Files  67 passed (67)
     Tests  1381 passed | 2 skipped (1383)
```

## 这批失败是怎么出现的

2026-09-13 做仓库净化时，把工作区里 **45 个未跟踪文件**纳入版本控制（提交 `a7283e6`）。
其中 7 个是**并发 AI 实例的进行中工作**：测试已写好，但对应接线尚未落地。
这使 `npx vitest run` 从「全绿」变为「8 文件 / 73 项失败」。

**性质**：这些是**测试先行**，不是回归。内核函数已实现且单测通过，
缺的是**调用点接线**。逐文件核实（读源码对比 spec 断言），**无一项属于「测试写错」**。

## 处置（2026-09-14 全部完成）

判据 = 把「内核已写、调用点未接」的每一处**真正接上线**，而不是移出测试。
移出测试等于用「删测试」掩盖「功能未交付 + 安全通道未关闭」，
违反本项目「诚实失败优于静默掩盖」的铁律（纪律 D3/D4）。

| spec | 缺什么 | 接法 | 后果（修复前 → 修复后） |
|---|---|---|---|
| `safe-regex` | `src/lore/trigger.ts` 未接 `RegexSafetyGuard` | `triggerWorldInfo` 开扫描会话，`keyToPattern` 改经防护器编译；`TriggerResult.degradations` 落地 | 🔴 真实 ReDoS 通道**已关闭**：`(a+)+$` 配 26×`a`+`b` 从实测 **6321ms** → 微秒级返回 |
| `card-fence` | `dsh-plugin` 一处都没接 `guardCardContent` | 新增**唯一处置漏斗** `renderGuardedCardText`（宏展开 → 越权标记消毒 + 残留宏转义 + nonce 围栏 + 命中出声），两条卡正文注入路径都走它 | 🟠 卡正文现受围栏/消毒保护（防冒充系统指令） |
| `b12-memory-master-switch` | pre-step 注入段无 `cfg.enabled` 判断；`/expand`、`/summarize` 无守卫 | pre-step 加总开关门控（含丢弃待办展开文件）；两数据面关闭态显式 409 | 🔴 总开关现能真正关闭注入；数据面不再「静默收下却不执行」 |
| `host-regex-bridge` | `__resetHostRegexBridge` / `flushHostRegexSync` 未实现 | 补写回桥：方案基准（防回流）+ 防抖 + 失败出声且不推进基准 | 🟡 卡的正则写回现真的进 node 侧引擎（不再停在 localStorage） |
| `mvu-event-namespace` | `Mvu.events` 缺 5 个 `mag_*` 常量 | 补常量（含上游拼写错误 `initiailized` **逐字照抄**）+ 注册期两种降级出声 | 🟡 卡监听 `mag_variable_*` 现注册到正确键，不再静默落 `'undefined'` |
| `ext-template-render` | 门面返回 undefined；`index.ts` 未注册脚本资产前缀 | 门面接真渲染（Handlebars + DOMPurify + 文件路由）；帧面改为转发父页唯一实现；`applyLocale` 空表出声 | 🟡 ST 扩展模板渲染可用（不再是「未移植」退化） |
| `st-modules` | `index.ts` 未注册 4 条 ST 模块路由；`build-wb.sh` 缺 `[A13]` | 注册四条路由（真 404 + JS MIME）+ 构建期 `[A13]` 资产进包断言 | 🟡 4 个 ST 标准模块资产现可达 |
| `th-host-events` | `host-vendor.ts` 缺 2 处 `settings_updated` 发射点 | 补发射点（防抖回调 + flush），紧跟落盘调用 | 🟡 设置落盘现通知帧 |

## 复现（可复跑）

```powershell
cd d:\DSH RolePlay\rp-workspace\packages
npx vitest run 2>&1 | Select-String 'Test Files|Tests  '
# 预期：Test Files  67 passed (67)
#       Tests  1381 passed | 2 skipped (1383)
```

## 附：核实方法

每个 spec 的判定过程 = 读 spec 顶部 import → 读对应源码 → 确认导出是否存在 →
跑单文件 vitest 看错误是「符号 undefined」（接线缺失）还是「值不符」（行为错误）。
本次 8 个文件全部落在「接线缺失」，唯 `b12` 兼有行为不符（源码读了 cfg 但没用于门控）。
