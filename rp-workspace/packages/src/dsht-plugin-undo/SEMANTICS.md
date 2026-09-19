# dsht-plugin-undo 语义边界

> 建立：**2026-09-14（F5 多实现收口）**。
>
> ⚠️ **本文件在两处部署中必须逐字相同**（主仓 + 另一 DSH 部署的副本），
> 因为「划界说明本身就是事实来源（SSOT）」——两边措辞不同 = 又一处需要人工比对的漂移点。
> 同步方式：改主仓这份，然后**整文件覆盖**到副本（勿分别在两处编辑）。
>
> - 主仓：`D:\DSH RolePlay\rp-workspace\packages\src\dsht-plugin-undo\SEMANTICS.md`
> - 副本：`<另一 DSH 部署>/.dsh-home/profiles/web/node_modules/dsht-plugin-undo/SEMANTICS.md`
> - 完整裁决见主仓 `docs/F5-MULTI-IMPLEMENTATION-AUDIT.md` §2.1

---

## 一、本插件是什么（相对权威实现的定位）

`dsht-plugin-undo` 是**无 RP 宿主部署**的通用回退插件。它与 RP 宿主
（`dsh-plugin`）的回退功能**不是同一套实现**，而是**显式声明的降级实现**：

| | 本插件 `dsht-plugin-undo` | RP 宿主 `dsh-plugin`（权威） |
|---|---|---|
| 路由 | `/dsht-undo/rollback`、`/regenerate`、`/edit` | `/rp/session-rollback`、`/rp/session-regenerate`、`/rp/session-edit` |
| 机制 | **文件截断**（`session.jsonl` 截到 keepThroughSeq + `.bak` 备份） | **逻辑回退**（官方 `compaction/prune` 影子化 + `user/message` marker） |
| 事件去向 | 从日志**物理删除** | **保留在日志**，只改投影 |
| live 会话 | 409 拒绝（内存态权威，截盘会被 flush 覆盖） | 直接支持（投影即时生效） |
| 变量回滚 | ✅ | ✅ |
| 文件快照回滚 | ✅ | ✅ |
| 掩码 / 计量口径 / 前端 UI | ❌ 不涉及（无前端会话流） | ✅ 归 RP 宿主 |

**共同契约**：两者都**原 session 原地完成，绝不开新分支 / 新 session**。

**为什么不合并成一套**：文件截断路径是**唯一**能在「无 rp 插件 + 会话非 live」时
工作的方案（逻辑回退依赖 RP 宿主在内存里持有的 live session）。所以它是**能力补充**，
不是重复劳动。

---

## 二、共享层必须单源（P-1b）

以下模块由本插件与 RP 宿主**共同 import**，禁止各自复制函数体（复制即漂移）：

- `dsht-plugin-shared/session-surgery.ts` —— 截断定位、`canSurgicallyTruncate` 单源判据
- `dsht-plugin-shared/file-snapshots.ts` —— turn 快照捕获与恢复
- `dsht-plugin-shared/session-write.ts` —— 标记形态与读法（`readSurgical`）

> 背景：`session-write.ts` 的 `readSurgical` 于 2026-09-14（F2 收口）新增，
> 供 RP 宿主读取 `dsht:surgical` 标记。本插件**不读**该标记（走文件截断路径），
> 故新增它对本插件**无影响**——这正是「共享层单源 + 各自按需引用」应有的状态。

---

## 三、同步触发条件（替代「靠人记」）

需要同步另一部署副本的**唯一**情形（其余一律不同步）：

1. 上述共享模块的**函数签名或行为**变更；
2. 本副本出现用户可感知 bug；
3. 本副本升级 minor 版本。

**明确不需要同步**的（RP 宿主面修复，与本插件无关）：
掩码集合语义（`shadowedSeqs`）、token 计量口径、错误文案隔离
（`humanizeError` / turn-error shadowing）、RP 前端会话流渲染、拖拽翻译桥、移动端 CSS。

### 同步方式（避免「各自复制一份」）

共享逻辑**必须 import 同一模块**，禁止各自复制函数体。
若副本是**打包产物**形态（`lib/index.js` 内联了共享模块），
则同步 = **用主仓当前源码重新构建副本产物**，而不是手工改产物里的代码。

---

## 四、当前状态（2026-09-14）

- 副本版本：`1.1.0`（`package.json`）
- 与主仓共享层的差异：**无需同步**——本副本走文件截断路径，不写/不读 surgical 标记
- 已知边界：本副本**不支持** live 会话回退（设计如此，非缺陷）

---

## 五、共享层变更记录（按 §三 触发条件同步副本）

### 2026-09-19 回退连带面修复（`shadowedRange`）

用户实测：RP 部署里回退后，**harness 的运行过程没跟着退**——会话流残留「系统提示词」
「上下文注入 · …」「本轮运行失败 QUOTA」。根因是回退写入的 `shadowedSeqs` 只含
**surface 事件**（user/message、assistant/message、tool/result），而这三类节点的锚
**不是** surface 事件（`system-prompt` 锚在 `turn/start`，真实会话实证 seq=6 早于
用户消息 seq=9；`context` 锚在注入事件；`turn-error` 锚在失败事件）。

- `dsht-plugin-shared/session-write.ts`：`SurgicalPayload` 与 `SurgicalMarkerPayload`
  新增可选字段 `shadowedRange: { start, end }`；`readSurgicalPayload` 增加一路解析
  （缺字段 / `end < start` / 非对象一律忽略，不落值）。
- `dsht-plugin-shared/host-projection.ts`：新增单源读取器
  `readNodeAnchorSeq(node)`（读节点信封的 `anchorSeq`，与 `readNodeSeq` 读 `data.seq` 区分）。
- **对本插件（文件截断路径）无行为影响**：截断是**物理删除**，被移除那一轮的一切事件
  （含 `turn/start` / `request/header` / `turn/end`）都不在日志里，不存在"连带面残留"；
  本副本也不读 `shadowedRange`。
- **本次同步 = 保持两侧共享层逐字同源（P-1b）**：产物用主仓当前源码重新构建后整文件覆盖，
  不是手工改产物里的代码（§三「同步方式」）。
