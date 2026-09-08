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

- user 消息开 turn：`turn/start {turn}` → `user/message`（必须带 `surfaceOp:"append"`）
- assistant 消息是该 turn 的 step：`step/start {turn,step}` → `assistant/message {turn,step,message}`（带 surfaceOp）→ `step/end`
- turn 收尾：`turn/end {turn, reason:{kind:"completed"}}`
- ST 的 `is_system` 行跳过；空 mes 行跳过。

消息体形：

```json
{"id":"st-<sessionId>-<seq>","role":"user|assistant","content":[{"type":"text","text":"..."}],"source":{"kind":"user"}}
```

assistant 的 source 用 `{"kind":"model","provider":"sillytavern-import","model":"imported"}`。

## swipes → 变体组（replace 链）

ST 一条消息的多个 swipe = 同一 surface 位置的变体组：

- 第一个 swipe：`assistant/message` + `surfaceOp:"append"`
- 后续 swipe：`assistant/message` + `surfaceOp:{"op":"replace","start":<被替换seq>,"end":<被替换seq>}`
  + `sourceEventSeqs:[<被替换seq>]`
- `swipe_id` 指向的那个是 active（其余 swipe 仍全量写进 log，但只 active 留在 surface）；
  若 swipe_id 不是最后一个，需要以它为链尾（它之后的 swipe 依次 replace 下 surface）。

log 全量保真（所有变体事件都在），surface 只剩 active——与 ST「未选中 swipe 不进 prompt」一致。
前端扫 replace 链重建变体组做左右切换。

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
