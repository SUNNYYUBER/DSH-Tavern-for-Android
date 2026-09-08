# DSH 0.1.3-alpha.1 升级评估（侦察报告，2026-09-04）

> **结论先行：暂不升级。** 建议 0.1.3 出 rc（修掉已知性能回退 + v2 迁移稳定）后再升。
> 当前 DSHT 基线 = 0.1.2-rc.1（v114 包，已适配稳定）。本文档是升级时的作战地图。
>
> **npm 状态**：0.1.3-alpha.1 尚未发布到 npm（GitHub release 先行，tag `dsh-v0.1.3-alpha.1`，
> commit d347e70）。升级时先查 `npm view @deepseek-ai/dsh versions`，npm 有了才能走
> build-dsht.ps1 流程；等不到就需先解决源码构建路径（工作量大，见 §5）。

---

## 1. 三大变化的实测分析（源码级，基于 GitHub tag 克隆）

### 1.1 Session format v2（最大风险点）

**v2 物理格式变化**（`packages/session/session-format-v1-to-v2/`，README.zh.md + 源码实证）：

| 变化 | 内容 | 对 DSHT 的影响 |
|---|---|---|
| chunk 嵌入 | 顶层 `assistant/chunk` 流式事件被**消费掉**，stream 嵌入对应 `assistant/message`（settlement） | **事件行数减少 → 存活事件 seq 密集重映射** |
| seq 重映射 | 迁移"计算密集的旧序号到新序号映射"，重写全部已声明引用（surfaceOp sourceEventSeqs、compaction range、command source event、title message list） | 回退/变体/undo 的 seq 语义在迁移后**整体平移**；迁移时点前后写入的引用必须重新对齐 |
| 物理编码 | 每行一个事件；header 要求 `isSeeded`；切点从 `session/end-seed {inherited}` 推导；`sourceEventSeqs` 范围编码 | 我们任何**直接按行解析 session.jsonl 的代码**都要过 v2 编解码器口径 |
| 新事件 | `assistant/attempt`（失败/放弃 attempt，仅日志可见，不进 deriveMessages） | 楼层/回退解析要跳过它 |
| header | `version: 2` | 我们的头部校验（repair-sessions、convert-chat 直写）需兼容 |

**封闭清单（迁移失败条件）**：未知 v1 事件 type 会使迁移失败（**连 ignorable:true 也炸**）。
实测我方事件面：所有 append 的事件 type 均为标准五个（user/message、assistant/message、
compaction/prune、turn/start、turn/end），source 走 `plugin` 标记——**大概率能过清单**，
但 `source.plugin: 'dsht-rp'` 等自定义 plugin 值是否在 v2 payload 校验白名单内**必须实测**
（dispositions.ts 冻结了"事件与 payload 成员清单"）。

**我方数据面的 seq 重映射冲击清单**（升级后第一次打开旧会话时发生）：
1. **rollback-mask**：host 从 session.jsonl 解析 marker 的 seq——迁移后 marker seq 全变。
   解析器读的是"迁移后文件"则自洽 ✓；但**旧 .bak / 迁移前的 undo 记录**里的 seq 不再对得上。
2. **变体组**：collectVariantGroups 按 seq 分组——后端从（迁移后）事件重算 + 前端从快照重算，
   双向自洽 ✓；但变体切换（variant/switch targetSeq）的**在途请求**若横跨迁移时刻会错位。
3. **memory 楼层提取**：v2 的 assistant/message payload 成员 = `['turn','step','message','stream']`
   ——**turn/step 保留** ✓，且我们解析器本就兼容 `data.message` 嵌套形状 → 大概率直接兼容。
4. **rp/state cursor**：visibleMessageCursor 是 surface 消息条数——chunk 不进 surface，
   条数不变 → cursor 语义幸存 ✓。
5. **非 live 回退的 .bak**：迁移是"不可变相邻 generation"（旧 v1 文件保留）——.bak 链与
   generation 链并存，但 .bak 里的 seq 是旧世界的。

### 1.2 SessionHandle + session 锁（破坏性 API）

`packages/session/session-persistence/src/handle.ts` 实证：
- write handle = **单持有者**（所有权可被夺走：`SessionOwnershipLostError`）；read handle 并发无碍
- `append` 首事件 seq 必须等于 stored next-seq（连续性契约不变）
- `flush` = 持久化屏障；`close()` 唯一 teardown（AsyncDisposable）

**对 DSHT**：
- live 回退/编辑（replace 原语）在 DSH 进程内同一 write handle 上操作 → **不受影响** ✓
- 非 live 回退（文件手术截断）在会话未打开时执行（无 write handle）→ 安全 ✓；
  但 agent 会话后台运行中 = 打开中，文件手术路径风险不变（本就被 409 拒，非新增风险）
- NodeService node 崩溃自动重启（3s）：旧进程死 → OS 级锁随进程消失；需实测
  session-persistence-jsonl 的锁落盘形态（锁文件残留是否会卡新进程）——**升级后首验项**

### 1.3 已知性能回退（官方自述）

"可能影响部分历史 session 加载的响应速度；下个版本修复"——机制未在 release notes 说明，
结合 v2 推测与**打开旧会话时的同步 v1→v2 迁移**相关（迁移"在内存中物化源、目标和序号
映射；不会流式改写"——README 明言全产物转换）。我们的会话体量（12-214MB jsonl）下，
首次打开 = 全量迁移 + 重映射 + 校验，**可能以分钟计**且占内存峰值——正是我们最痛的场景。

**缓解猜想（升级时验证）**：迁移是一次性成本（generation 发布后走 v2）——痛一次还是每次
打开都痛，决定这个回退能不能忍。

### 1.4 有价值的修复（升级动机）

- **DeepSeek 流式工具调用续传分片空值覆盖**修复——避免"工具以空名称失败并写入无法重新
  打开的会话记录"。我们的适配 agent 会话跑 70+ 步工具链，这个 bug 我们可能已经踩过
  （会话打不开的损坏记录）——**这是升级的最强理由**。
- Web 文件上传混排/手动暂停立即终止模型轮次/会话搜索定位修复。

## 2. 契约面验证（源码级，2026-09-04）

| 契约 | 0.1.3 状态 | 影响 |
|---|---|---|
| `conversation.chat.node` slot | ✅ 保留（ui-chat slots.ts，新增 turnData hook factory） | RpAssistantNodeView/RpUserNodeView shadowing 不受影响 |
| `conversation.chat.assistant-actions` | ✅（ui-tool/ui-workflow-run 消费） | 变体条/重新生成不受影响 |
| `data-chat-flow-key/kind` DOM 属性 | ✅ 保留（ChatNodeSeat L130-131） | ProcessFolder 过程折叠不受影响 |
| token 鉴权（authorizeIndex/authenticatedUrl） | ✅ 同款契约（packages/client/connection/src/rpc.ts L192-199） | NodeService stdout 解析 token + MainActivity 带 token loadUrl **继续有效** |
| credentials owner-only | ✅ 仍在（credentials-local） | 3d-3 sim 补丁继续有效 |
| session-persistence-jsonl（link→rename 补丁） | 包还在（packages/session/session-persistence-jsonl） | 4.8 平台补丁需实测命中（产物形态可能变） |
| cordis | 待查（0.1.3 package.json） | 大版本跳变才需担心 |

## 3. 升级时的适配清单（预估工作量）

按依赖顺序：
1. **build-dsht.ps1**：Step 1 版本号；Step 3 stubs 路径核对（session 包目录重组后
   `node_modules\@deepseek-ai\dsh-session-persistence-jsonl` 等包名是否保留——npm 装完
   看实际包名）；4.8 link→rename 补丁目标重定位（Dsht-Patch 断言会提醒）
2. **v2 兼容**：
   - 我们的会话写入路径：convert-chat 直写 / repair-sessions 截断——产出必须过 v2 校验
     （header isSeeded/每行一事件/范围编码 sourceEventSeqs）→ **大概率必须改走官方 API
     而非手写文件**（convert-chat 文件模式产出 v1 形态 jsonl 会直接被拒）——这是最大的
     适配项，可能要把"确定性转换"改成"官方 import API 调用"
   - rollback-mask / extractFloors / collectVariantGroups 三个解析器对 v2 文件跑一遍
   - 实测私有 source.plugin 值过不过迁移清单（拿真机会话副本跑迁移）
3. **锁**：node 重启后锁清理时序实测；非 live 回退加"锁持有检测"防御
4. **性能回退**：实测打开 12MB+ 会话的迁移耗时/内存峰值；不可忍则等下一版
5. **回归**：623 单测 + 模拟器 CDP 全链路（会话迁移/回退/变体/memory 注入）+ 真机

## 4. 建议时机

- **0.1.3-rc 发布且性能回退修复后**升级（官方明言下个版本修复）
- 升级窗口选在**无重要进行中会话**时（迁移有失败可能性：封闭清单 + chunk 切点校验）
- 升级前**全量备份** `.dsh-home`（sessions/ + rp/ + profiles/）——迁移不可逆（旧 generation
  虽保留但语义上已是新世界）
- 流式工具调用修复若在 0.1.2 后续 rc 回移，也可以只等那个版本

## 5. 若 npm 迟迟不发 0.1.3

build-dsht.ps1 依赖 npm 包（Step 1 pnpm add）。备选路径：GitHub 源码构建
（pnpm install + pnpm run build 整仓）→ 把产物 dist 对齐 npm 包布局——**工作量大**，
非必要不走。源码已克隆在 `D:\DSH RolePlay\tmp\dsh-013-src`（tag dsh-v0.1.3-alpha.1）。
