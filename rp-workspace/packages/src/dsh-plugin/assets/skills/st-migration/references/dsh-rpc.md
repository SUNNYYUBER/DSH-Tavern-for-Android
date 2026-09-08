# DSH 原生 RPC 参考（workspace / session / settings / credentials）

宿主 HTTP 端点：`POST http://127.0.0.1:<端口>/api/<method>`（端口通常 3080）。
信封：

```json
{"type":"client-request","rpcId":"<任意唯一串>","method":"workspace.create","payload":{...}}
```

响应信封：`{"result":{"ok":true,"value":{...}}}`；业务错误 `{"result":{"ok":false,"error":{"code","message"}}}`。

**迁移 agent 侧没有直接发 /api 的通道**——适配工作区自身的 workspace.create/rename 与开工
会话已由 `/dsht-rp/rp/import-kickoff` 在 host 进程内完成；你产出的角色工作区与聊天会话的
注册由收尾路由 `/dsht-rp/rp/register-workspaces`（经 dsht_bridge 可调）在 host 进程内
一次性完成。迁移中你只需要：

- `dsht_bridge` 能到 `/dsht-*` 数据面（write-files / mvu / tavern-helper / prompt-template /
  import-api-config / register-workspaces / repair-session-cwd）。
- 校验 `session.list` 不可达时，改为直接查文件系统：`sessions/<projectKey>/` 目录存在且
  session.jsonl 落盘即算文件层通过，最终可见性以 register-workspaces 响应清单为准。

## DSHT 数据面注册路由（dsht_bridge 可达）

| 路由 | payload | 返回 |
|---|---|---|
| `dsht-rp rp/register-workspaces` | `{}` | `{mode:"registry"\|"loopback", workspaces:[{slug,name,workspaceId,created,renamed?,adopted[],adoptFailed?[],error?}], repair:{...}, seqRepair:{...}}`——扫 `rp/` 全量：**seq 断号修复** → 存量 cwd 修复 → workspace.create + rename(卡名) → 迁移会话归组（attach）→ st-* 预设同步 agent preset。幂等，迁移收尾必调 |
| `dsht-rp rp/repair-session-cwd` | `{}` | `{scanned, repaired:[{sessionId,from,to,moved}], skipped, errors}`——session.jsonl header cwd 的 /data/user/0 形态 → realpath 规范形态（含 projectKey 目录搬迁；live 会话跳过） |
| `dsht-rp rp/convert-chat` | `{jsonlText, sessionId, cwd, createdAt?}` | `{content, turns, skipped, variantGroups, firstUserText}`——聊天转换唯一合法通道（确定性：seq 严格连续、swipes 变体链内建）。禁止手写 session 事件 |
| `dsht-rp rp/repair-sessions` | `{}` | `{scanned, repaired:[{sessionId,events}], skipped, errors}`——存量 session.jsonl seq 断号重编号（replace 链 start/end/sourceEventSeqs 同步重写；修复前备份 .bak；幂等；live 会话跳过） |
| `dsht-rp rp/session-rollback` | `{sessionId, keepThroughSeq}` | `{kept, dropped}`——会话回退：截断到 keepThroughSeq（含），header 保留、先备份 .bak；live 会话 409 拒绝 |

## 方法签名（抄自 deepseek-harness packages/host/apiproxy/src/api/）

| 方法 | payload | 返回 |
|---|---|---|
| `workspace.create` | `{path}`（目录必须已存在；幂等——同一路径已注册返回 `created:false` 与原 workspace） | `{workspace:{workspaceId,path,title,sessionIds,createdAt,updatedAt}, created}` |
| `workspace.rename` | `{workspaceId, title}`（trim 后非空；重名 → `workspace-name-conflict`；同名 no-op 成功） | `{workspace}` |
| `workspace.list` | `{}` | `{items: WorkspaceView[], archivedSessionIds}` |
| `workspace.delete` | `{workspaceId}`（只删注册，目录与 session 日志不动） | `{deleted:true}` |
| `session.create` | `{workspaceId?, cwd?, sessionId?, agentPreset?}`（workspaceId/cwd 至多给其一；agentPreset 未知 → `agent-preset-not-found`，组合挂不上 → `agent-preset-invalid`） | `{sessionId, agentPreset?}` |
| `session.prompt` | `{sessionId, mode:"queue"\|"steer", content:[{type:"text",text}], clientTimeZone?}` | `{accepted:true}` |
| `session.list` | `{}` | `{items:[{sessionId, cwd, updatedAt, blank, ...}]}` |
| `session.rename` | `{sessionId, title}` | `{title, seq}` |
| `session.history` | `{sessionId, beforeSeq?, maxMessages?}` | `{events, hasMore, projections?}` |
| `agentPreset.list` | `{}` | `{presets:[{id, trust, isDefault, name?, description?, broken?}], authorable, hasDocument}` |
| `agentPreset.select` | `{sessionId, agentPreset}`（仅空白会话可换） | `{agentPreset}` |
| `settings.describe` | `{}` | `{writable, hasDocument, namespaces:[{ns, schema, value, applies, secrets, revision}]}` |
| `settings.update` | `{ns, patch, expectedRevision?}`（merge 进用户层；secret 字段可含在 patch 里，write-only） | 命名空间视图 |
| `settings.mutate` | `{ns, ops:[{op:"set",path,value}|{op:"unset",path}], expectedRevision?}` | 命名空间视图 |
| `credentials.describe` | `{refs:[...]}` | `{credentials:{<ref>:{configured, source?, writable}}}`（永不返回值） |
| `credentials.set` | `{ref, value}`（ref 须为 POSIX 标识符；被环境变量 shadow 时拒绝 `credential-rejected`） | `{}` |
| `credentials.unset` | `{ref}` | `{}` |

`settings.update` / `credentials.set` 已被 `/dsht-rp/rp/import-api-config` 封装——
迁移 API 配置一律走那个路由，不要手工拼 settings.yaml。

## llm-pi-ai provider profile 字段（import-api-config 内部使用）

- `apiKeyEnv`：凭据引用名（POSIX 标识符），按请求从 credentials seam 解析
- `baseURL`：端点（缺省 = 目录内置端点）
- `api`：线路协议，`openai-completions` | `openai-responses` | `anthropic-messages`
  （非目录路由必须显式声明，且必须给 `models: [{id, name}]`，否则校验拒绝写入）
- 目录路由（openai/deepseek/anthropic 等 30+）只需 apiKeyEnv（+可选 baseURL 覆盖）
- settings.yaml 形态：`llm-pi-ai: { providers: { <route>: <profile> } }`；
  凭据文件 `$DSH_HOME/.credentials.yaml`（`<REF>: "<value>"`，mode 0600）
