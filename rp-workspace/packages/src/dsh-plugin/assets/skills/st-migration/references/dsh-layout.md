# DSH_HOME 布局契约（迁移产物的目标形态）

所有路径相对 `$DSH_HOME`。写盘一律走 `dsht_bridge → dsht-rp write-files`
（白名单前缀：`skills/`、`.agent-presets/`、`sessions/`、`rp/`、`rp-presets/`、`rp-import/`）。

## 世界书 → skill

```
skills/wb-<slug>/
  SKILL.md              # frontmatter（name/description/whenToUse）+ 条目速览（≤60 条摘要）
  references/lore.json  # 完整结构化条目（JSON.stringify(book, null, 1)）
```

lore.json 形状：`{name, entries:[{id, comment, content, keys[], secondaryKeys[], constant,
position, depth, order, enabled, excludeRecursion, preventRecursion, probability}]}`。
运行时由 dsht-rp-plugin pre-step 触发引擎消费（constant/关键词/递归/预算）。

## 角色卡 → 工作区（第四轮起：不再产 agent preset，卡设定进 rp.json.promptPersona）

```
rp/rp-<slug>/
  rp.json               # 见下（promptPersona = 卡设定快照文本，运行期 pre-step 注入并过宏引擎）
  card.json             # 原样 ST 卡 JSON（导出对称/无损重打包用）
  avatar.png            # 立绘（原 PNG；write-files binary 形态）
  README.md             # 角色说明 + 聊天清单 + skill 指引
```

存量 `.agent-presets/rp-*` 由插件启动时（幂等）与 `rp/register-workspaces` 顺带迁移：
persona 正文抽进 rp.json.promptPersona 后删除目录；**有会话引用的保留**（DSH 冷恢复
按 session log 里的 preset id 重挂，删了会报 agent-preset-not-found 打不开会话）——
迁移结果在响应的 `cardPresetMigration.{migrated, removed, keptInUse, errors}` 里如实列出。

rp.json（schemaVersion 1）：

```json
{
  "schemaVersion": 1,
  "characterName": "<卡内 name>",
  "books": [{"name": "...", "lorePath": "skills/wb-<slug>/references/lore.json"}],
  "trigger": {"scanDepth": 2, "matchWholeWords": false, "budgetPercent": 25, "budgetCap": 6000},
  "macros": {"char": "<卡名>", "user": "<persona 名或空>"},
  "firstMes": "<开场白（截 4000 字符）>",
  "promptPersona": "<卡设定快照文本（角色设定/性格/场景/行为准则分节；宏原样保留，运行期展开）>",
  "regex": [/* 卡 extensions.regex_scripts 原样搬运（RegexScript 字段对齐）。
               实测真实卡 21 张中 14 张带内嵌正则（思维链美化/状态栏等）——
               卡里有就必须写进来，留空等于丢功能 */],
  "cardSource": {"rawJson": true, "hasAvatar": true},
  "outputProtocol": {
    "actionTags": ["a", "selection"], "wrapTags": ["content"],
    "statusTags": ["status", "statusbar", "StatusBlock"],
    "collapsibleTags": ["details"], "stateUpdateTags": ["UpdateVariable"],
    "reasoningTags": ["Analysis"], "foreshadowingTags": ["foreshadowings"]
  }
}
```

books 归并顺序：外部引用书（配对成功）→ 内嵌书 skill → 全局书单（globalSelect）→
聊天 chat_metadata 绑定书（lorePath 去重）。

## 聊天 → session

```
sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.jsonl
```

- cwd = 工作区绝对路径（`$DSH_HOME/rp/rp-<slug>`；孤儿聊天 `$DSH_HOME/rp/_orphan`）。
- 事件序列与 swipe 变体链契约见 session-jsonl-contract.md。
- 无聊天的卡也要建工作区（rp.json + README），开场白非空则补一个 firstMes session。

## 会话/全局状态

```
rp/state/<sessionId>.json   # {presetId?, state?, variables?}——MVU 变量树（chat_metadata.variables
                            # 的归宿，经 dsht-mvu variables/register 写入）
rp/state/<sessionId>.undo.jsonl # 变量写撤销日志（每次写路由写前记旧值；rp/session-rollback
                                # 截断聊天后回放恢复；会话删除/重置时清除）
rp/state/global.json        # 全局作用域变量
rp/global-books.json        # {books:[{name, lorePath}]}——globalSelect 全局书单
rp/regex/global.json        # {scripts:[...]}——全局正则（extension_settings.regex）
```

## ST 预设 → RP 预设

```
rp-presets/<presetId>/
  preset.json   # RPPreset（schemaVersion 1，slots[] + toggles[] 开关组）
  regex.json    # {scripts:[...]} 预设作用域正则（有才写）
```

由 `dsht-rp preset/import-st` 路由产出（prompt_order 分组 → toggles 在路由内重建）。

## 适配工作区与批次数据目录（R20：cwd 与数据目录分离）

```
rp-import/_adapter/     # 固定适配工作区（全部批次共用；会话 cwd；title「ST 数据适配」）
rp-import/<batchId>/    # 批次数据目录（每批次一个）
  source.zip            # 原始包（raw 批次无此文件）
  unpacked/             # 解压数据（raw 批次为 unpacked/inbox/<文件>）
  meta.json             # {batchId, name, format, stagedAt, fileCount, manifest, kickoff?}
  migration-report.md   # 你的产出（必交；写进批次数据目录）
```

同批次重复 kickoff 幂等复用会话；新批次在 _adapter 工作区里开新会话。

## API 配置（不经文件，经服务）

`settings.update('llm-pi-ai', {providers:{...}})` + `credentials.set(ref, value)`，
由 `/dsht-rp/rp/import-api-config` 封装（live 生效）。文件形态兜底：
`settings.yaml` 的 `llm-pi-ai.providers` 段 + `.credentials.yaml`（0600，重启生效）。
