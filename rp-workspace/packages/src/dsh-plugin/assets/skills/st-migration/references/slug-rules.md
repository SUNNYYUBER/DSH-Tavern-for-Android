# slug / projectKey / sessionId 规则（必须与运行时逐字节一致）

以下算法抄自 `packages/src/import/dsh-export.ts`（运行时 dsht-rp-plugin 按同一套算法找文件，
算错一个字符文件就「落盘了但找不到」）。不确定时宁可直接调 `dsht_bridge` 的现成路由
（preset/import-st 等内部已算好），不要自己拼路径。

## hash36（FNV-1a 32bit → base36）

```
h = 0x811c9dc5
对每个 UTF-16 code unit c：h = Math.imul(h ^ c, 0x01000193)
输出 (h >>> 0).toString(36)
```

## dshSlug(prefix, originalName) → 世界书/角色卡 id

DSH skill name / preset id 要求 `[a-z0-9][a-z0-9-]*`：

```
safe = originalName.toLowerCase()
       .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
       .slice(0, 24).replace(/^-+|-+$/g, '')
h = hash36(originalName)
slug = safe ? `${prefix}-${safe}-${h}` : `${prefix}-${h}`
```

- 世界书：`dshSlug('wb', 书名)` → `skills/wb-<slug>/`
- 角色卡：`dshSlug('rp', 卡名)` → `rp/<slug>/`（第四轮起不再产 `.agent-presets/rp-<slug>/`——卡设定文本进 rp.json 的 `promptPersona` 字段）
- 同一个名字永远得到同一个 slug（幂等覆盖更新靠这个）。

## chatSessionId(characterName, chatFile)

`st-${hash36(characterName + '/' + chatFile)}`——characterName 用归属卡的卡内 name，
chatFile 是聊天文件名（含 .jsonl）。

开场白 session：`st-${hash36('firstmes/' + card.name)}`。

## encodeSegment(raw) → 目录段转义

对照 dsh-session-persistence-jsonl 的 format.encodeSegment（注入安全）：

- `.` → `~002E`；`..` → `~002E~002E`
- 其余逐字符：`[A-Za-z0-9._-]` 直通；任何其它字符 → `~` + charCode 的 4 位大写十六进制
  （如 `中` → `~4E2D`，`~` 自身也转义为 `~007E`）

## projectKey(cwd) → sessions 下的项目目录键

对照 DSH format.projectKey：

- 逐字符处理 cwd（**绝对路径**，正斜杠）：
  - `/`、`\`、`:` → 折叠为单个 `-`（连续分隔符只出一个）
  - `[A-Za-z0-9._-]` 直通
  - 其它（含 `~` 与全部非 ASCII）→ `~` + 4 位大写十六进制
- 去掉前导 `-`（空则 `root`），截 251 字符，最后 `--` 包裹：`--<结果>--`

最终落盘：`sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.jsonl`。
Windows 上 cwd 分隔符先归一为 `/` 再算（Android/PC 路径形态差异）。

**cwd 必须用 realpath 规范形态**：Android 上 `/data/user/0/<pkg>` 是 `/data/data/<pkg>`
的 symlink，DSH 侧（WorkspaceRegistry / session.create 认领 / 持久层
assertStoredIdentity）一律按 realpath 后的形态比对。header cwd 与 projectKey 必须
用同一个规范 cwd 计算；写成 symlink 形态的存量由 `dsht-rp rp/repair-session-cwd`
修复（改 header 首行并把会话目录搬到新 projectKey 下，幂等）。
