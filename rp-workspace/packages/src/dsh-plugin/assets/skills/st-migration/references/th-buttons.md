# 酒馆助手按钮面适配接入指南（跨脚本按钮管理 · 通用）

适用对象：迁移/适配含「按钮管理逻辑」的酒馆助手（TH）脚本时，处理按钮 API 面的通用契约。
何时读本篇：迁移对象的 tavern-helper 脚本源码里出现
`replaceScriptButtons` / `updateScriptButtonsWith` / `appendInexistentScriptButtons` /
`getScriptButtons` 任意一个调用，或脚本自我定位是「按钮管理器 / 按钮批量开关面板 /
框架类脚本」（典型：一键显隐全部脚本按钮、按分组开关按钮的控制台）。

契约条款引用 `docs/ST-COMPAT-PACT.md`：B3（API 面 + 记名上报）、B4（事件投递）、
C1（失败必须出声）、D1/D2（通用性——本篇即 D2 要求的「落在那一类机制上」的机制文档）。

---

## 1. 真 TH 按钮模型速览

- 每个脚本自带一组按钮（脚本数据 `buttons` 数组），显示在酒馆助手脚本面板；点击产生
  脚本本地事件（`eventOnButton(name, fn)` 监听，事件名 = `getButtonEvent(name)`）。
- 「框架类脚本」可以管理**其他脚本**的按钮：`replaceScriptButtons(buttons, script_id)`
  带目标脚本 id 时写目标的按钮清单。这就是「跨脚本按钮管理」。
- 按钮数据形状：`{ name: string, visible: boolean }`（DSHT 同形状；真 TH 若有其他
  字段在 DSHT 被丢弃——照真 TH 源码只保这两个键）。

## 2. DSHT shim 支持面（API 映射表，sentinel v183+）

| 真 TH API | DSHT 支持 | 目标脚本参数 |
|---|---|---|
| `getScriptButtons(script_id?)` | ✅ 全量 | `script_id` 缺省 = 调用方自身；显式指定 = 读目标脚本按钮 |
| `replaceScriptButtons(buttons, script_id?)` | ✅ 全量 | 同上（写目标脚本按钮清单） |
| `updateScriptButtonsWith(updater, script_id?)` | ✅ 全量 | `updater` 收到**目标**脚本的按钮数组，返回新数组写回目标 |
| `appendInexistentScriptButtons(script_id, buttons)` / `(buttons)` | ✅ 双形态 | 字符串第一参 = 目标脚本；否则操作自身 |
| `getAllEnabledScriptButtons()` | ❌ 记名 stub | 调用会进 missing 记名面板（B3），适配时应改写为逐脚本 `getScriptButtons` 聚合 |
| `eventOnButton(name, fn)` / `getButtonEvent(name)` | ✅ | 仅本脚本按钮事件（无跨脚本事件面——跨脚本管理只改清单，不代听事件） |

行为矩阵（get/set 共用）：

| script_id 取值 | 行为 |
|---|---|
| 缺省 / null | 操作调用方自身（与真 TH 无参调用一致） |
| 指定 + 目标已装载 | 操作目标脚本（跨脚本管理，合法用法） |
| 指定 + 目标不存在 | **显式报错**（`目标脚本不存在: <id>`），绝不静默改写自身 |

> 「已装载」的判定 = 该脚本在当前会话已启动并完成注册（脚本管理面板里能看到它）。
> 迁移只落数据（脚本清单原样进 `tavern-helper-scripts.json` / `dsht-tavern-helper scripts`），
> 按钮面是**运行时**契约——适配 agent 不需要改脚本源码里的按钮调用，v183+ 的 shim
> 会按上表正确路由；本篇的职责是让适配者能**识别和验收**这类脚本。

## 3. 跨脚本管理的两个关键坑（适配验收重点）

### 3.1 目标 id 从哪来 & id 不稳定问题

- 自身 id：脚本内 `getScriptId()`。
- 目标脚本 id：脚本清单数据（ST 侧 `tavern_helper.scripts[].id` / TH 脚本面板）。
- **id 在 ST 导出/导入往返后会重铸**（真 TH 实证：同一正则/脚本两次导出 id 全变）。
  框架脚本若把目标 id 写死在配置里，换设备/重新导入后即失效。适配验收时：
  - 脚本带「按名字找目标」fallback（如 Kemini 的 `nameFallbacks` 模式）→ 合格；
  - 写死单一直接 id、无 fallback → 在迁移报告「遗留事项」标注「该脚本跨脚本按钮
    管理的目标 id 需要用户在脚本设置里重新指向」，不要静默放过。

### 3.2 装载时序（框架脚本比目标脚本先启动）

目标脚本未装载时跨脚本调用会显式报错（这是设计，不是 bug）。框架类脚本应在
`tavern_events.CHAT_CHANGED` / `iframe_events.RESIZE` 等就绪时机之后再执行按钮管理，
并自行做延迟重试（桥的 `buttons:set` 在非幂等清单里——**超时不自动重试**，防止
重复执行；重试节奏由脚本自己控制，建议 ≥1 次退避间隔，如 1s/3s/10s）。

## 4. 错误处理约定（适配脚本该怎么接）

- 预期内的缺失/不支持（如调了 `getAllEnabledScriptButtons`）→ 错误对象带
  `__thExpected = true`，宿主不把它当脚本失败误报；同时进入 missing 记名面板（B3）。
- 跨脚本目标不存在 → 报错消息形如 `replaceScriptButtons: 目标脚本不存在: <id>`，
  适配脚本应 catch 后提示用户（toastr）或走 3.1 的 fallback 流程，而不是吞掉。
- `buttons:set` 在非幂等桥调用清单（同 `chat:append`/`injects:*`/`mvu:replace`/
  `wb:entryPut`）：20s 超时后**拒绝**而不重发——脚本侧自行决定是否重试。

## 5. 迁移检查清单（含按钮管理脚本的批次必过）

1. 识别：扫 tavern-helper 脚本源码，命中第 0 节四个 API 任一 → 标记「按钮管理脚本」。
2. 数据落盘：脚本清单（含 buttons 数组）原样进 `tavern-helper-scripts.json`
   （卡作用域 `rp/<slug>/`、预设作用域 `rp-presets/<id>/`）或 `dsht-tavern-helper scripts`。
3. 跨脚本引用检查：grep 目标 id 是写死还是带 fallback；写死的进报告遗留事项（3.1）。
4. 时序检查：按钮管理调用是否在就绪事件回调内；裸顶层调用 + 无重试 → 报告标注
   「可能先于目标脚本启动，用户首次运行时按钮可能不动，点一次脚本重载即可」。
5. 不支持面检查：`getAllEnabledScriptButtons` 等记名 stub 调用 → 报告列出
   （首次运行后脚本面板 missing 列表应与之对得上——C1 可见性闭环）。

## 6. 排障速查（用户反馈「按钮不动/按钮改错脚本」时）

| 症状 | 排查顺序 |
|---|---|
| 脚本面板 missing 列表出现按钮 API | shim 版本过旧（sentinel < v183）→ 升级包 |
| 报错「目标脚本不存在」 | 3.1 的 id 失效或 3.2 的时序问题；确认目标脚本已启动，或让用户重新指向 |
| 改了按钮没反应但无报错 | 目标脚本管理面板 UI 是否渲染该脚本的按钮区（statuses.buttons 消费方）；确认脚本 hasUi / 按钮事件监听已挂 |
| 按钮重复出现 | 脚本把 append 逻辑挂在了会重入的事件上（每次 CHAT_CHANGED 都 concat）——适配脚本应先查重（appendInexistentScriptButtons 本身带查重） |
