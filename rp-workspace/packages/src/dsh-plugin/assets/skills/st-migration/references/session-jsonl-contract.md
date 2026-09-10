# session.jsonl 契约（oneTurnLog）

ST 聊天 .jsonl → DSH session.jsonl 的转换契约。落盘路径：
`sessions/<projectKey>/<encodeSegment(sessionId)>/session.jsonl`（算法见 slug-rules.md）。

> **禁止手写本文件的事件行**（真机实测手写 seq 断号会被 DSH 以
> "corrupt session log: seq gap in committed region" 拒绝打开）。一律调
> `dsht-rp rp/convert-chat`——**首选文件模式** `{filePath, sessionId, cwd}`（先 write-files
> 把 .jsonl 原文放到 `rp-import/_chats/`，服务端直读直写落盘，零大 payload 往返）；
> 仅 <1MB 小会话用文本模式 `{jsonlText, sessionId, cwd}` 拿 `content` 再经 write-files
> 落盘——该路由内部走确定性转换（seq 严格连续、swipes 变体链、
> 时间戳规则全部内建且有单测覆盖）。本文档是**理解/校验**产物的参考，不是手写指南。
> 存量断号文件由 `dsht-rp rp/repair-sessions` 重编号修复（幂等，修复前自动备份 .bak；
> register-workspaces 收尾时会先自动跑一遍）。

## 文件骨架

每行一个 JSON 事件。首行是 header：

```json
{"type":"session","version":0,"id":"<sessionId>","createdAt":<ms>,"cwd":"<工作区绝对路径>","delegationDepth":0}
```

`cwd` 必带（DSH session.list 不服务无 cwd 的落盘 session），用工作区绝对路径
（`$DSH_HOME/rp/<slug>`），且必须是 **realpath 规范形态**：Android 上
`$DSH_HOME` 常取 `/data/user/0/<pkg>/...`（`/data/data/<pkg>/...` 的 symlink），
而 DSH WorkspaceRegistry 一律 realpath 规范化（`/data/data/...`）。header cwd 写
symlink 形态会导致 `session.create(workspaceId, sessionId)` 认领时字符串比对
`session-conflict`、工作区会话归组失败。projectKey 也以规范 cwd 计算
（jsonl 持久层校验物理路径 == logPath(root, header.cwd, id)，两者必须同源）。
存量写错的由 `dsht-rp rp/repair-session-cwd` 修复（改 header 首行 + 搬目录，幂等），
收尾的 `rp/register-workspaces` 会先自动跑这一步。

## 事件序列

- `turn/start {turn}` 开 turn
- **每条 `user/message` 也必须落在已开的 step 内**（0.1.5 硬约束：v2→v3 迁移器报
  `format v2 surface before first step cannot acquire a system head`）：
  `step/start {turn,step}` → `user/message`（带 `surfaceOp:"append"`）→ `step/end`
- assistant 消息同样各自成 step：`step/start {turn,step}` → `assistant/message {turn,step,message}`（带 surfaceOp）→ `step/end`
- turn 收尾：`turn/end {turn, reason:{kind:"completed"}}`
- ST 的 `is_system` 行跳过；空 mes 行跳过。

**官方不变量**（`dsh-session/lib/invariant.js`）：

- `turn/start` 的编号必须是 nextTurn（不能跳号/重复）
- `step/start` 的编号必须是 nextStep
- `assistant/message` / `assistant/attempt` / `system/message` / `tool/call` / `tool/result`(append)
  必须落在**已开 turn + 已开 step** 内

消息体形：

```json
{"id":"st-<sessionId>-<seq>","role":"user|assistant","content":[{"type":"text","text":"..."}],"source":{"kind":"user"}}
```

> `id` **必填**（0.1.5 冷读硬要求 `lacks an identified message`）；`user/message` 的
> `role` 必须是 `user`。

assistant 的 source 用 `{"kind":"model","provider":"sillytavern-import","model":"imported"}`。

## swipes → 变体组（user 标记 replace + append）

ST 一条消息的多个 swipe = 同一 surface 位置的变体组。

> ⚠️ **0.1.5 起 `assistant/message` 禁止做 surface 替换节点**（迁移器直接拒绝：
> `assistant/message N chunk provenance is not one complete ordered attempt`）。
> 变体互替必须走 **user 标记 replace**（官方 compaction 摘要同款合法通道）+
> 新变体作为 `assistant/message` **append**。实测：21/80 个真实会话曾因旧写法在
> 0.1.5 下整会话打不开。

每个 swipe 的写法（**全 append**，用 user 标记把上一个移出）：

- 第一个 swipe：`step/start` → `assistant/message` + `surfaceOp:"append"` → `step/end`
- 后续 swipe：
  1. `step/start`
  2. `compaction/prune {shadowedRange:{start,end}, shadowedSeqs:[<上一个activeSeq>], shadowedTokenCount:0}`（紧邻下一步，影子化）
  3. `user/message` + `surfaceOp:{"op":"replace","startSeq":<上一个>,"endSeq":<上一个>}`
     + `sourceEventSeqs:[<上一个>]`，`source` 用 **plugin 白名单形态**携带语义：
     `{"kind":"plugin","plugin":"sillytavern-import","form":"snapshot","sections":[{"name":"dsht:surgical","text":"{\"variantOf\":<上一个>,\"shadowedSeqs\":[<上一个>]}"}]}`
  4. `assistant/message` + `surfaceOp:"append"`（新变体）
  5. `step/end`

`swipe_id` 指向的那个是 active（其余 swipe 仍全量写进 log，但只 active 留在 surface）；
若 swipe_id 不是最后一个，需要以它为链尾（它之后的 swipe 依次把前一个移出）。
开场白变体（alternate_greetings）走同款（`emitGreetingMarker`）。

log 全量保真（所有变体事件都在），surface 只剩 active——与 ST「未选中 swipe 不进 prompt」一致。
前端扫变体组重建做左右切换（`variant/groups` 路由）。

> **source 只允许官方白名单键**（0.1.5 起）。任何自定义键（`rolledBackTo` / `editedFrom` /
> `thData` 等）必须搬进 `form:'snapshot'` 的 `sections[{name,text}]`，
> 否则迁移器报 `source has unexpected member` 整会话打不开。
> `surfaceOp` 的字段名是 **`startSeq`/`endSeq`**（0.1.2 时代的 `start`/`end` 已不被接受）。

## seq / time

- seq 从 0 连续递增（header 不占 seq）。**断号/跳号 = DSH 拒开**（"corrupt session log:
  seq gap in committed region"）——这也是禁止手写、一律走 `rp/convert-chat` 的原因。
- time 用 ST `send_date`（`Date.parse` 可解的字符串）≥ 前值时采用，否则前值 +1000ms。

## 开场白 session（firstMes）

角色卡的 firstMes session 同样不许手写：把 firstMes 构造成单行 ST 聊天
`{"name":"<卡名>","is_user":false,"mes":"<firstMes>"}` 喂给 `rp/convert-chat`
（sessionId 用 `st-<hash36("firstmes/"+卡名)>`），产物即是合规的虚拟 turn 包裹形态。
多开场白（alternate_greetings）由导入管线（buildFirstMesSession）作为 swipe 变体组
写进该 session——agent 旁路落盘时无需自行处理备选开场白（保留在 card.json 即可）。

## 落盘后必做

1. `chat_metadata`（聊天首行的 `chat_metadata` 字段）里的 `variables` →
   `dsht_bridge: dsht-mvu variables/register {sessionId, variables}`（MVU 续命）。
2. 绑定书/persona 信息并进该工作区 `rp.json`（books/macros.user）。
3. 旁路写盘无变更事件——收尾统一调 `dsht-rp rp/register-workspaces` 完成
   工作区注册 + 会话归组（见 SKILL.md 处理顺序第 7 步）；该校验也可走
   `session.list` RPC 按 cwd 过滤确认可见，不可见时检查 projectKey/encodeSegment
   是否算对（最常见错误）。

## 会话世代（0.1.5 起，读侧必读）

> **0.1.5 起核心把会话迁到新世代** `session.vN.jsonl`（当前 N=3），旧的
> `session.jsonl` 作为**历史世代保留但冻结**（官方
> `dsh-session-persistence-jsonl:753-760`）。会话被打开/续写一次后，新事件只进
> `session.v3.jsonl`。

**影响**：任何按固定名 `session.jsonl` 读会话的代码，在会话被迁移后会读到
「迁移那一刻的死数据」。设备实测 80 个会话中先有 1 个迁移（正是用户当下在用的那个）。

**正确做法**：按世代优先级解析——`session.v3.jsonl` → `session.v2.jsonl` →
`session.v1.jsonl` → `session.jsonl`，取存在的最高代。

## 存量会话修复（0.1.2 → 0.1.5 升级时）

`dsht-rp rp/repair-sessions` 现在做**三重修复**（幂等，写前自动备份 `.bak`）：

1. 快照消息角色归一化（`user/message` 的 `role` 必须 `user`）
2. **v0→v3 迁移合法性修复**（本次新增）——把 0.1.2 时代的 8 类不合规重写为合法形态：
   缺 `id` / `source` 自定义键搬进 `sections` / 信封上的 `source` 剥离 /
   `assistant/message` 的 replace 链拆成「user 标记 + append」/ prune 端点对齐 /
   turn-step 状态机归一 / 聚合行就地展开 / 重编号所有引用
3. seq 断号重编号

**实测**：设备 80 个真实会话里 **41 个（51%）**因上述不合规在 0.1.5 下打不开，
本步把它们**全部救回**且内容无损（80/80 可迁移、0 丢失、0 非幂等、0 回归、
目录身份零漂移）。

> `header.cwd` 必须是**绝对**路径且与所在目录名同源（目录名 == `projectKey(cwd)`，
> 官方 `assertStoredIdentity` 强不变量）。相对 cwd（如 `rp/_start`）由
> `rp/repair-session-cwd` 修复（改首行 + 搬目录，两者同做，少了任一步都会让会话丢失）。
