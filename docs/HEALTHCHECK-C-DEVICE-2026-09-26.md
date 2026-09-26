# 体检 C：模拟器真机面实证 — DSHTavern v0.2.7

- **日期**：2026-09-26
- **执行人**：teammate `device-verifier`（task-3）
- **设备**：`emulator-5554` / x86_64 / Android 15 (API 35) / google_apis / `-no-window`
- **被测**：`com.dshtavern.app` versionName=`0.2.7` versionCode=`9`（primaryCpuAbi=x86_64，targetSdk=36）
- **adb**：`C:\Users\Administrator\.android\sdk\platform-tools\adb.exe`
- **截图证据**：`tmp/healthcheck/*.png`
- **纪律**：本报告只写**在设备上真实跑过**的结论；没跑过的一律写「未实测」。无 API Key ⇒ 真实 LLM 对话**未验（缺凭据）**，不计入通过。

> **结论速览：实测通过 10 项 / 未通过 2 项 / 未验 6 项 / 已撤回 3 项（其中 2 项经 Lead 复验推翻）。未出现 boot loop。**
>
> 📌 **本报告含 3 条撤回条目**：§3.3.1「备份不含会话」与 §3.3.2「备份漏 mig-test v4」**均为我误判，已由 Lead 复验推翻并经我独立复核确认**（错因是从被截断的 zip 列表过度外推）；§4.3「启动页端口显示不准」为我自查撤回。撤回内容一律**保留原文并标注**，以便最终报告不沿用。

---

## 0. ★ 前置：时区修复（不做则「发消息」结论全部无效）

### 0.1 任务书给出的一行命令**在本机不足以生效**（新发现）

任务书给的修法是：
```
adb -s emulator-5554 shell setprop persist.sys.timezone Asia/Shanghai
```

实测在**非 root** 下被拒绝：

```
$ adb -s emulator-5554 shell setprop persist.sys.timezone Asia/Shanghai
Failed to set property 'persist.sys.timezone' to 'Asia/Shanghai'.
See dmesg for error reason.
$ adb -s emulator-5554 shell getprop persist.sys.timezone
GMT                       # ← 未生效
$ adb -s emulator-5554 shell date
Sat Sep 26 13:48:18 GMT 2026
```

**必须先进 root**，再 setprop：

```
$ adb -s emulator-5554 root
restarting adbd as root
$ adb -s emulator-5554 shell id
uid=0(root) gid=0(root) ...
$ adb -s emulator-5554 shell setprop persist.sys.timezone Asia/Shanghai
$ adb -s emulator-5554 shell getprop persist.sys.timezone
Asia/Shanghai             # ← 生效
$ adb -s emulator-5554 shell date
Sat Sep 26 21:48:34 CST 2026   # ← CST
$ adb -s emulator-5554 shell 'date +%Z'
CST
```

| 项 | 命令 | 原始输出摘要 | 结论 | 截图 |
|---|---|---|---|---|
| 时区修复 | `adb root` → `setprop persist.sys.timezone Asia/Shanghai` → `getprop`/`date` | `Asia/Shanghai` / `CST` | ✅ **实测通过（需 root 前置）** | — |

> **⚠️ 写进报告的硬约束**：`setprop` 在 API 35 镜像上**非 root 会被拒**。任何「照着任务书写一行 setprop 就以为修好了」的流程都会静默失败，进而让后续所有「发消息」结论变成假 bug。**本报告所有会话/发消息相关测试，均在 `getprop` 回显 `Asia/Shanghai` 且 `date` 回显 `CST` 之后进行。**

### 0.2 时区生效后的反证：`invalid-time-zone` 全程 0 次

```
$ adb -s emulator-5554 logcat -d | grep -c "invalid-time-zone"
0
```

整个会话（含一次真实发送尝试）**没有出现任何 `invalid-time-zone`**。即：任务书担心的那个已知缺陷在本轮被前置修复正确规避了。

---

## 1. 冷启动实证 + ★ boot loop 验证

### 1.1 启动流程

```
$ adb -s emulator-5554 shell cmd package resolve-activity --brief com.dshtavern.app
com.dshtavern.app/.MainActivity                       # Activity 名与任务书一致

$ adb -s emulator-5554 shell am force-stop com.dshtavern.app
$ adb -s emulator-5554 shell pidof com.dshtavern.app
                                                      # 空 = 已确实停止
$ adb -s emulator-5554 logcat -c                       # cleared
$ adb -s emulator-5554 shell am start -n com.dshtavern.app/.MainActivity
Starting: Intent { cmp=com.dshtavern.app/.MainActivity }
```

### 1.2 ★ boot loop 判定（历史事故：v0.2.5 `libz.so.1 not found` → node 重启 253 次）

这是本轮**最重要**的判据。三层证据互相印证：

**证据 A — node 启动次数 = 1（决定性）**

```
$ adb -s emulator-5554 logcat -d | grep -c "starting node (attempt"
1
$ adb -s emulator-5554 logcat -d | grep "starting node (attempt"
09-26 21:48:58.242  4005  4111 D DSHTavern.Node: starting node (attempt 1, port 3080, lan=false)…
```

**只有 `attempt 1`，没有 attempt 2/3/…/253。** 这与 v0.2.5 事故（253 次）形成直接对照。

**证据 B — 进程长时间稳定存活**

```
# 启动于 21:48:58，查询于 21:57:04（存活约 8 分钟，同 pid 未变）
$ adb -s emulator-5554 shell pidof com.dshtavern.app
4005
$ adb -s emulator-5554 shell "ps -A -o PID,ETIME,NAME | grep -E 'dshtavern|libnode'"
 4005       08:12 com.dshtavern.app
 4112       08:05 libnode.so
```

node 进程 pid=4112 是 app pid=4005 的**子进程**，父子关系稳定：
```
 4005   405 com.dshtavern.app           com.dshtavern.app
 4112  4005 libnode.so                  libnode.so --expose-internals .../bin.js web --no-open --port 3080
```

**证据 C — 无任何崩溃/重启标志**

```
FATAL EXCEPTION                0
cannot link executable         0
SIGSEGV                        0
ANR in com.dshtavern            0
Force finishing                 0
Process com.dshtavern.app.*died 0
```

`grep -c "libz.so"` = **1**，但经原文核对，该行是 WebView 进程（pid 4289）的 `nativeloader InitDefaultPublicLibraries` 白名单枚举，**包含 libz.so 属正常**，与 v0.2.5 的 `libz.so.1 not found` 崩溃无关：

```
09-26 21:50:45.496  4289  4289 D nativeloader: InitDefaultPublicLibraries for_preload=1: libandroid.so:...:libz.so
```

另有一条**正常的**非干净退出恢复（force-stop 导致，非崩溃）：
```
09-26 21:50:45.590  4005  4086 D DSHTavern.Node: RECOVERED: 上次异常退出（标记 1790220471876），会话数据完好，checkpoint 续跑
09-26 21:50:45.590  4005  4086 W DSHTavern.Node: previous run did not exit cleanly (marker=1790220471876)
```

**旁证 — P1 工具链自检通过（与 README 声称一致）**
```
09-26 21:48:57.945  DSHTavern.Node: P1 tool self-test: bash rc=0 GNU bash, version 5.3.15(1)-release
09-26 21:48:58.065  DSHTavern.Node: P1 tool self-test: rg rc=0 ripgrep 15.2.0
09-26 21:48:58.135  DSHTavern.Node: P1 tool self-test: zstd rc=0 Zstandard CLI (64-bit) v1.5.7
09-26 21:48:58.229  DSHTavern.Node: P1 tool self-test: git rc=0 git version 2.55.0
09-26 21:48:58.230  DSHTavern.Node: P1 tool links ready (8/8)
```

### 1.3 Web 服务确实起来了（不只看界面文字）

```
$ adb -s emulator-5554 shell "cat /proc/net/tcp | grep -i ':0C08'"     # 3080 = 0x0C08
   0: 0100007F:0C08 00000000:0000 0A ...        # LISTEN (st=0A)
   1: 0100007F:C610 0100007F:0C08 01 ...        # ESTABLISHED
   ...

$ adb -s emulator-5554 shell "echo -e 'GET / HTTP/1.0\r\n\r\n' | toybox nc 127.0.0.1 3080"
HTTP/1.1 401 Unauthorized
dsh web authentication required; reopen the URL printed by dsh web.

$ adb -s emulator-5554 shell "echo -e 'GET /version HTTP/1.0\r\n\r\n' | toybox nc 127.0.0.1 3080"
HTTP/1.1 200 OK
{"agent":"SillyTavern:1.18.0:DSHTavern","pkgVersion":"1.18.0","gitRevision":null,"gitBranch":null,"defaultUpdateChannel":"stable"}
```

token 由 node 打印并被 App 落盘（stdout-independent 通道）：
```
$ adb -s emulator-5554 logcat -d | grep -o 'token=[A-Za-z0-9_-]*' | tail -1
token=kATdadfByLupWIlaNXDCD-eOGWQSp6prhvhUk_yQ8Cg
$ adb -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/dsht-token"
kATdadfByLupWIlaNXDCD-eOGWQSp6prhvhUk_yQ8Cg      # 一致
```

| 项 | 命令 | 原始输出摘要 | 结论 | 截图 |
|---|---|---|---|---|
| 冷启动 | `am force-stop` → `am start -n .MainActivity` | `Starting: Intent {...}`，`Displayed .MainActivity +4s903ms` | ✅ 实测通过 | `01-coldstart-t90s.png` |
| **★ 0 boot loop** | `logcat \| grep -c "starting node (attempt"` | **`1`**（非 253） | ✅ **实测通过** | `01`/`02` |
| 进程稳定性 | `pidof` / `ps -o ETIME` | pid 4005 稳定 ~8min | ✅ 实测通过 | — |
| Web 服务 | `/proc/net/tcp` + `nc 3080` | LISTEN + `HTTP/1.1 200 OK` | ✅ 实测通过 | — |
| P1 工具链 | `logcat \| grep "P1 tool self-test"` | bash/rg/zstd/git 全 `rc=0`，`links ready (8/8)` | ✅ 实测通过（与 README 一致） | `01` |

---

## 2. 首启可用性 / 界面渲染 / RP 入口

首启无「正在启动」卡死——约 60 秒内 WebView 已加载完对话界面。

`uiautomator dump` 只捞到 1 个原生节点（`⚙`），**WebView 内容不暴露**，因此界面判定**全部依赖截图目视**：
```
$ adb -s emulator-5554 shell uiautomator dump /sdcard/ui.xml
# 解析结果仅： [960,2196][1068,2304] | android.widget.TextView | ⚙
```
（这是方法学限制，已如实记录：`uiautomator` 在本 App 上对 WebView 不可用，不能作为断言依据。）

界面链路（均为 `input tap` 驱动，`-no-window` 下无法用 pyautogui）：

| 截图 | 内容 | 判定 |
|---|---|---|
| `01-coldstart-t90s.png` | 启动页，node 运行中 | 渲染正常 |
| `02-coldstart-t150s.png` | **对话界面完整渲染**：Chat/Trajectory/预设 三标签、消息气泡、「导入」按钮、输入框、`3 turns 4 steps` | ✅ |
| `03-sidebar.png` | 侧栏：New Session / Plugins / 预设工作台 / Workspaces / 会话列表 / **🎭 角色扮演**（底部）/ Settings | ✅ RP 入口在 |
| `06-rp-panel.png` | RP 面板：`角色 \| 我的 \| 导入 \| 世界书 \| 正则 \| 预设 \| 会话` 七标签 | ✅ |
| `07-rp-import.png` | 导入页：导入与运行状态 / 版本与更新 / 数据迁移 / 三步引导 | ✅ |
| `09-import-status.png` | 状态展开：数据源批次=还没有导入过数据包，预适配插件 4/4 ✅ | ✅ |
| `11-rp-sessions-tab.png` | 会话管理：`mig-test · 37 事件`、`session-1474e80f ·`、`dsht-welcome · 5 事件` | ✅ |

**导航方法学记录（供复现）**：截图是 1080×2400 全屏（含状态栏），`input tap` 坐标即图像像素坐标。侧栏「🎭 角色扮演」在 **(337, 2113)**；汉堡菜单在 **(88, 277)**；RP 标签栏 `导入` ≈(378,341)、`会话` ≈(980,341)。首次误按 (88,197) 未命中（点到了状态栏区域）。

**一个真实干扰项**：点「🎭 角色扮演」时弹出 `Add an API key to get started` 模态（`04-rp-entry.png`），需先点 `Configure later` 才能进 RP 页——这本身**是正确行为**（无凭据时的凭据闸门）。

| 项 | 命令 | 原始输出摘要 | 结论 | 截图 |
|---|---|---|---|---|
| 首启界面渲染 | `exec-out screencap -p` | 对话界面完整 | ✅ 实测通过 | `02` |
| RP 入口存在 | `input tap 88 277` → 截图 | 侧栏底部有「🎭 角色扮演」 | ✅ 实测通过 | `03` |
| RP 面板可打开 | `input tap 337 2113` → 截图 | 七标签面板渲染 | ✅ 实测通过 | `06` |
| 凭据闸门 | 同上，弹模态 | 「Add an API key…」+ Configure later | ✅ 实测通过 | `04`/`05` |

---

## 3. 会话面 / v3→v4 迁移 / 备份闸门

### 3.1 ★ 重要澄清：本机会话**不是干净环境，也不是真实用户数据**

任务书假设「体检环境是干净的、可能没有老会话」。**实测不成立**——本机有会话，但它们**不是使用者产生的数据，而是上一轮验证留下的测试产物**。原文：

```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app find files/.dsh/sessions -type f"
files/.dsh/sessions/--data-data-com.dshtavern.app-files-.dsh-rp-_start--/dsht-welcome/session.jsonl
.../session-1474e80f-bb46-4b3f-87b8-2fcf9995d060/session.lock
.../session-1474e80f-bb46-4b3f-87b8-2fcf9995d060/session.v4.jsonl
.../mig-test/session.jsonl
.../mig-test/session.lock
.../mig-test/session.v4.jsonl
```

- `mig-test` 的 v3 原文里直接带了构造痕迹：`{"data":{"id":"u1",...,"text":"【迁移测试】请回复一句问候"}}`
- 对话界面里也留着测试串：`【F.3 注入链验证】只回复两个字：收到`
- `mig-test/` 目录权限是 `drwxrwxrwx`，与其它会话的 `drwx------` **明显不同**，属人为放置

⇒ **`mig-test` 是上一轮验证者故意造的 v3→v4 迁移 fixture，不是真实用户会话。** 因此：

> **「迁移链在真实用户数据上是否安全」这一项，本轮仍为「未验」。** 但**迁移机制本身**（v3 文件 → v4 文件、原文件保留、备份闸门产物）可以在这个 fixture 上实证 —— 见下。这两者必须分开陈述，不能混淆。

### 3.2 迁移产物实证

```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app head -c 200 .../mig-test/session.jsonl"
{"type":"session","version":0,"id":"mig-test","createdAt":1790200000000,...}   # v3 原始，仍在

$ adb -s emulator-5554 shell "run-as com.dshtavern.app head -c 300 .../mig-test/session.v4.jsonl"
{"type":"session","version":4,"id":"mig-test","createdAt":1790200000000,"cwd":"...","isSeeded":false,"delegationDepth":0}
```

- **v3 原文件未被删除**（`wc -l` = 9 行仍在） ✅
- **生成了 `version:4` 的新文件** ✅
- 迁移后事件结构（拉回本地统计 38 行）：
```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app cat .../mig-test/session.v4.jsonl" > tmp/healthcheck/migv4.jsonl
   5  user/message        4  step/start        4  step/end      4  agent/inbox/spliced
   3  turn/start          3  system/message    3  turn/end      2  session/end-seed
   2  assistant/attempt   1  session          1  assistant/message
   1  permission/preset   1  sandbox/mode      1  approval/policy
   1  request/header      1  request/context   1  session/title
```
其中 `system/message` 带 v2→v3 迁入锚点，证明是逐级迁移而非重写：
```
{"type":"system/message",...,"message":{"id":"v2-to-v3-system-4621d9a1cbdd0dc75a276dad81ea64dc4250833f7335b1c72e01c5372e1378bb",...}}
```
界面侧也确认该会话可读：会话管理页显示 **`mig-test · 37 事件`**（`11-rp-sessions-tab.png`）。

### 3.3 备份闸门 `dsht-prebak-*.zip` — **存在，2 份**

```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app find files/.dsh -name 'dsht-prebak*'"
files/.dsh/exchange/dsht-prebak-20260924-000335.zip
files/.dsh/exchange/dsht-prebak-20260924-002329.zip
```
已拉回本地（`tmp/healthcheck/prebak-*.zip`）并开包核对：

| 文件 | 大小 | 条目数 | 备份时点（文件名内嵌） |
|---|---|---|---|
| `dsht-prebak-20260924-000335.zip` | 1,268,914 B | **80** | 09-24 00:03 |
| `dsht-prebak-20260924-002329.zip` | 2,530,050 B | **85** | 09-24 00:23 |

**★ 这个「80」正好对上 README 的「会话迁移（0.1.5）✅ 80/80 真实会话」** —— 即 README 那格的 80 是**包内条目数**，不是会话数。README 措辞「80/80 真实会话」**有误导**（本机根本没有 80 个会话，只有 3 个）。建议澄清为「80 项配置/资源条目」。

#### 3.3.1 包内实际覆盖范围（**已由 Lead 复验纠正**）

> ⚠️ **本节曾出错，现更正。** 我初版报告称「备份只含 `profiles/web/**`，不含 `sessions/**`、`rp/state/**`」——**该结论错误**，已由 Lead 复验推翻，我随后独立开包复核确认 Lead 正确。

**错因（方法学）**：我当时**只看了包列表的前 40 条**，而那 40 条恰好全在 `profiles/` 下，**看到列表"截断在 profiles"就外推成"包内只有 profiles"**。这是典型的**从被截断的样本过度外推**——正是我自己在报告里警告别人的那类错误。

**正确的 top-level 统计**（我独立 `zipfile` 全量重算，与 Lead 数字一致）：

`prebak-000335.zip`（80 条目）：
```
 59  profiles          8  skills        5  rp        4  .agent-presets
  1  .anonymous-user-id  1  storages    1  sessions  1  dsht-backup.json
```
`prebak-002329.zip`（85 条目）：
```
 59  profiles          8  skills        5  rp        4  .agent-presets
  4  sessions          2  storages      1  exchange
  1  .anonymous-user-id  1  dsht-backup.json
```

**包内确实包含会话与状态面**（非 `profiles/**` 条目全文）：
```
sessions/--data-data-com.dshtavern.app-files-.dsh-rp-_start--/dsht-welcome/session.jsonl
sessions/.../session-1474e80f-bb46-4b3f-87b8-2fcf9995d060/session.v4.jsonl     # 仅 002329
sessions/.../session-1474e80f-bb46-4b3f-87b8-2fcf9995d060/session.lock         # 仅 002329
sessions/.../mig-test/session.jsonl                                            # 仅 002329
rp/_start/rp.json
rp/_start/README.md
rp/state/__selftest__.json
rp/state/__selftest__.undo.jsonl
rp/variables/global.json
storages/workspace.json
storages/session_projcache/sessions/session-1474e80f-...json                    # 仅 002329
.agent-presets/st-preset/preset.yml
.agent-presets/st-preset/agent.cordis.yml
.agent-presets/dsht-adapter/agent.cordis.yml
.agent-presets/dsht-adapter/preset.yml
skills/st-migration/SKILL.md  (+ references/ 7 份)
.anonymous-user-id
dsht-backup.json
exchange/dsht-prebak-20260924-000335.zip                                        # 仅 002329（增量嵌套）
```

⇒ **结论改为：备份闸门覆盖 `profiles`、`skills`、`rp`（含 state/variables）、`.agent-presets`、`storages`、`sessions`、`dsht-backup.json`**，覆盖面**明显大于**我初版所述。**「备份漏会话」不成立，撤回。**

#### 3.3.2 「备份漏了 mig-test 的 v4」也不成立（**已由 Lead 复验推翻**）

设备 mtime 实读：
```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app ls -l .../mig-test/"
-rw-rw-rw- 1 u0_a216 u0_a216  1136 2026-09-24 08:20 session.jsonl      # v3 源
-rw------- 1 u0_a216 u0_a216 19158 2026-09-24 11:31 session.v4.jsonl   # v4 产物
```
- 备份时点 = **09-24 00:03 / 00:23**（文件名内嵌时间戳）
- `mig-test/session.jsonl`（v3）mtime = **09-24 08:20**
- `mig-test/session.v4.jsonl` mtime = **09-24 11:31**

**两次备份都比 `mig-test` 会话的创建早了约 8 小时**，因此包内不含 v4 产物**是正确行为**，不构成缺口。`prebak-002329` 内含的是 `mig-test/session.jsonl`——那是**已存在的 v3 源**（08:20），但请注意它仍**晚于**备份时点（00:23）……

> ✅ **该「矛盾」已由 Lead 收口，结论：虚警，矛盾不存在。** 我独立复核 Lead 的决定性判据 —— **读 zip 内条目自身的 mtime**：
> ```
> $ python -c "zipfile...infolist() 统计 date_time"
> prebak-000335.zip  不同条目 mtime 取值 = 2 个：(2026,9,24,0,3,34) x6 / (2026,9,24,0,3,36) x74
> prebak-002329.zip  不同条目 mtime 取值 = 2 个：(2026,9,24,0,23,28) x1 / (2026,9,24,0,23,30) x84
> ```
> ⇒ **zip 内每个条目的 mtime 都被重写为「备份写入时刻」**，并非原文件 mtime。
> - `08:20 / 11:31` 是**设备上原文件**的 mtime；
> - 包内条目 mtime 是**备份写入时刻**（00:03 / 00:23）；
> - **两者本就不该相等** ⇒ 我所说的「包内文件 mtime 晚于命名时点」纯属**观察口径错配**，不构成矛盾。

★ **我当时的假设 (a) 已被 Lead 拿到直接物证**：两包内均有的 `dsht-backup.json`：
```
prebak-000335.zip → {"createdAt":"2026-09-24T00:03:36+0000","kind":"pre-upgrade","appVersion":"0.2.7","abi":"x86_64","entries":79,"uncompressedBytes":4931930,"sessionLogs":2}
prebak-002329.zip → {"createdAt":"2026-09-24T00:23:31+0000","kind":"pre-upgrade","appVersion":"0.2.7","abi":"x86_64","entries":84,"uncompressedBytes":6206502,"sessionLogs":4}
```
`createdAt` 的 **`+0000` 正是当时设备的 GMT 时区**；换算北京时间即 `08:23`，与设备侧文件 mtime 完全自洽。**「文件名时区口径 ≠ mtime 时区口径」成立。**

> **留存的价值**：这是我本轮**第二次**在同一类陷阱边缘（时点/口径未对齐）——但这次**没有**把它写成缺陷，而是标为「待澄清」并说明倾向性假设。**该判断方式被证明是对的。**

#### 3.3.2.1 两条「口径未声明」小偏差（已登记，**不定性为 bug**）

经 Lead 提示并由我独立复算确认，属项目 P-9「可观测性 / 口径未声明」同族：

| # | manifest 字段 | 自报值 | 实际值 | 差异来源（我已定位） |
|---|---|---|---|---|
| 1 | `entries` | 79 / 84 | `namelist()` = **80 / 85** | 差 **1** = manifest **未计入自身**（`dsht-backup.json`）。行为合理，但**未声明** |
| 2 | `sessionLogs` | 2 / 4 | 按 `startswith('sessions/')` 数 = **1 / 3**；按 `'/sessions/' in n and endswith('.jsonl')` 数 = **0 / 0** | 见下，口径**可定位**但命名有误导 |

**★ `sessionLogs` 的真实口径（我复算定位到唯一匹配）**：= **全路径下 `.jsonl` 结尾的条目数**（**不限于 `sessions/` 目录**）：
```
prebak-000335.zip  endswith('.jsonl') = 2  ← MATCH manifest sessionLogs=2
    rp/state/__selftest__.undo.jsonl                                    ← 不在 sessions/ 下
    sessions/.../dsht-welcome/session.jsonl
prebak-002329.zip  endswith('.jsonl') = 4  ← MATCH manifest sessionLogs=4
    rp/state/__selftest__.undo.jsonl                                    ← 不在 sessions/ 下
    sessions/.../dsht-welcome/session.jsonl
    sessions/.../session-1474e80f-.../session.v4.jsonl
    sessions/.../mig-test/session.jsonl
```
⇒ 该字段**并非「会话日志数」**，而是「包内所有 `.jsonl` 文件数」，其中**混入了 `rp/state/` 下的状态文件**。字段名 `sessionLogs` 会让人误以为是会话维度统计。
**仅记录为口径/命名歧义，有待作者确认设计意图，本轮不定性为缺陷、不计入未通过项。**

#### 3.3.3 仍然成立的部分

- **`.credentials.yaml` 不在任何 prebak 包内**（两包非 `profiles/**` 清单里均无）。
  这可能**恰恰是正确设计**——凭据不应进可导出的备份包（安全考量），且任务书本身要求「凭据条目 0 条」作为迁移闸门前置条件。
  ⇒ 我**不再将其列为缺口**，仅作中性事实记录，交由 Lead/A 组按设计意图定级。
- **README 「80/80 真实会话」措辞失实**：此结论**不受本次更正影响，仍然成立**（80 = 条目数，本机仅 3 个会话，且均为 fixture）。

### 3.4 凭据条目 = 0 条（迁移闸门的前置条件）

```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/.credentials.yaml"
version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: uMCf1U4xJmmZe4N0pdYremLOG3VsnmMbOZXr0Ni4KWM
```
**只有 1 条 `client-connection/browser-session` 浏览器会话授权，API 凭据 0 条。** 与任务书要求的「凭据条目为 0 条」一致。（`.credentials.yaml` 的 `530` 权限正确。）

| 项 | 命令 | 原始输出摘要 | 结论 | 截图 |
|---|---|---|---|---|
| 设备有会话 | `find sessions -type f` | 3 个会话目录 | ✅ 实测（但为**测试 fixture**，非真实数据） | `11` |
| v3→v4 迁移产物 | `head session.jsonl` / `session.v4.jsonl` | v3 保留 + 新 `version:4` | ✅ 实测通过（**在构造 fixture 上**） | — |
| 迁移后可读 | 会话管理页 | `mig-test · 37 事件` | ✅ 实测通过 | `11` |
| `dsht-prebak-*.zip` 生成 | `find -name 'dsht-prebak*'` | 2 份 zip | ✅ 实测通过 | — |
| 凭据条目 0 条 | `cat .credentials.yaml` | 仅 browser-session，0 条 API 凭据 | ✅ 实测通过 | — |
| **真实用户数据迁移安全性** | — | 本机**无真实用户会话** | ⬜ **未实测** | — |

---

## 4. ★★ 未通过项

### 4.1 【未通过】发消息被静默吞掉（时区已修好之后仍然发生）

**这是本轮最严重的发现**，且**不能归因于时区**（时区已确认为 `Asia/Shanghai`/`CST`，`invalid-time-zone` 全程 0 次）。

复现步骤（全部为设备实跑）：
1. `input tap 400 1523` 聚焦输入框
2. `adb shell input text "TZprobe-reply-ok"`
3. `input tap 959 1353` 点发送按钮（↑）

**结果：输入框被清空（消息已被前端消费），但对话区没有任何新气泡，界面无任何报错，服务端无任何记录。**

```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app grep -rl 'TZprobe' files/.dsh/sessions"
                                    # ← 空，设备上根本不存在这条内容

$ adb -s emulator-5554 shell "run-as com.dshtavern.app find .../sessions -newermt '2026-09-26 21:50'"
.../session-1474e80f-bb46-4b3f-87b8-2fcf9995d060/session.lock   # 只有 lock 被 touch，无内容写入
```

`logcat` 在同一时段**没有任何相关错误**（只有毫无信息量的 `TrafficStats: tagSocket` 心跳）：
```
09-26 21:56:37.518  4005  4085 D TrafficStats: tagSocket(6) with statsTag=0xffffffff, statsUid=-1
09-26 21:56:38.523  4005  4085 D TrafficStats: tagSocket(6) with statsTag=0xffffffff, statsUid=-1
... (持续到 21:56:56，全部同类)
```

**判据链条**：
- 消息内容 `TZprobe` 在设备全局不存在 ⇒ **请求没有落盘**
- 前端输入框被清空 ⇒ **前端认为发送成功了**
- 没有 toast / 红框 / 控制台错误 ⇒ **失败被完全静默**
- `invalid-time-zone` = 0 ⇒ **不是时区缺陷**，是**另一条独立缺陷**

**最可能的解释（需其他组确认，本轮不下定论）**：`InputBar` 清空输入后调用发送 RPC，而缺少 API 凭据导致该 RPC 在真正建 turn 之前就失败；失败路径**没有把错误冒泡到 UI**。注意：已有的旧会话里那条失败消息**是显示了** `MISSING_CREDENTIAL` 卡片的（见 `02-coldstart-t150s.png`），说明**「历史回显」有错误呈现，而「即时发送」没有**——两者的错误处理不一致。

**截图**：`15b-typed.png`（文字已进输入框）→ `16-sent.png`（点击后输入框清空、对话区无新消息、无报错）。

> 诚实边界：本轮**无法排除**「发送需要更长时间才开始渲染」的可能，但已等待 8 秒且服务端零写入，足以判定为**静默失败**。且**无法在无凭据下验到成功路径**——见 §5。

### 4.2 【未通过】RP 面板的「API 连接 ✅ 已连接」是假阳性

`09-import-status.png` 中 RP 面板明确显示：
```
API 连接     ✅ 已连接 deepseek-official（deepseek-flash）
导入与运行状态   API ✓
```

**但设备上根本不存在任何 API 凭据**（§3.4 已证：`.credentials.yaml` 只有 1 条 browser-session）。同一台设备上，实际发起对话时返回的是：
```
● 本轮运行失败   MISSING_CREDENTIAL
llm-deepseek: no API key for provider route "deepseek-official";
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),
or export DEEPSEEK_API_KEY in the launching environment
```

**同一设备、同一时刻，RP 面板说「已连接」，真实调用说「no API key」。二者矛盾，RP 面板的状态指示为假阳性。**

进一步佐证：全盘搜索也无任何 API key 痕迹：
```
$ adb -s emulator-5554 shell "run-as com.dshtavern.app grep -rl 'apikey\|apiKey\|api_key' files/.dsh --include='*.yaml' --include='*.json'"
                                    # ← 空
```

**影响**：这个绿灯会让用户误以为配好了、然后在「发消息没反应」时彻底摸不着头脑 —— 它与 §4.1 的静默失败叠加，构成**极难自查的故障组合**。

**截图**：`09-import-status.png`（假绿灯）vs `02-coldstart-t150s.png`（真实 MISSING_CREDENTIAL）。

### 4.3 【已撤回，改为「不成立」】启动页「端口 3080: 未监听」

**初判**：`01-coldstart-t90s.png`（21:49:19 拍摄）显示 `端口 3080：未监听`，而我随后 `nc` 探测能拿到 `HTTP/1.1 401`，一度怀疑是假阴性显示。

**复核后撤回该判断。** 时间线对齐证明启动页**当时说的是实话**：

```
21:48:58.242  starting node (attempt 1, port 3080, lan=false)…      # node 进程刚起
21:49:19      ← 截图 01 拍摄时点（node 仅存活 21 秒）
21:49:24.012  [dsht-mvu] data plane on webServer route /dsht-mvu/*  # 路由此时才注册
21:49:24.024  [dsht-th]  data plane on webServer route /dsht-tavern-helper/*
21:49:26.537  dsh web: http://127.0.0.1:3080/?token=…               # 此时才真正就绪
```

截图时点（21:49:19）**早于**路由注册（21:49:24）与 URL 打印（21:49:26）**7 秒**，因此当时 3080 **确实尚未就绪**，`未监听` 是准确状态而非 bug。我后来的 `nc` 探测发生在服务就绪之后。

⇒ **本项不构成缺陷，撤回。** 保留此条目是为了记录一次**差点误报的教训**：`-no-window` 下截图的时点与服务就绪时点不同步，**跨时点比较会造出假 bug**；任何「界面说 X、我测到 Y」的结论都必须先对齐时间戳。这也正是任务书开篇警告的「不做前置会撞假 bug」的同类陷阱，只不过这次发生在**我自己的测量方法**上。

---

## 5. 未验项（诚实边界）

| 项 | 原因 | 状态 |
|---|---|---|
| **真实 LLM 对话（收/发/流式）** | **无 API Key** | ⬜ **未验（缺凭据）** —— **绝不算通过** |
| 迁移链在**真实用户数据**上的安全性 | 本机只有人为构造的 `mig-test` fixture，无真实用户会话 | ⬜ 未实测 |
| 预设管线（bychv 单份注入） | 需真实模型 + 真实预设数据 | ⬜ 未验（本次未触发该路径） |
| MVU direct 卡提取（T2.3b） | 需真实角色卡 + 模型 | ⬜ 未验 |
| 导入 ST 数据（真实数据包） | 面板明确显示「数据源批次：还没有导入过数据包」 | ⬜ 未验 |
| ARM64 真机 / 鸿蒙面 | 无对应设备 | ⬜ 未实测 |

`09-import-status.png` 中 `预适配插件 4/4 ✅ 功能正常`（MVU / 酒馆助手 / EJS 提示词模板 / 剧情记忆）是**插件加载态自检**，**不等于**这些插件的功能已被验证——两者不可混为一谈。

---

## 6. README.md:17-23「验证面速查」回填建议（**未实施，仅建议**）

按要求：**只回填实际验过的**，没验的保持 ⬜。**本轮不修改 README**，交由 Lead 统一实施。

当前 README.md 第 17-23 行（原文）：
```
| 能力 | x86_64 模拟器 | 真机（小米 11 Pro） | 鸿蒙（卓易通） |
|---|---|---|---|
| 首启 / 会话基础 | ✅ 实测 | ✅ 实测（早期版本） | ✅ 实测（2026-09-19，HarmonyOS 6） |
| 会话迁移（0.1.5） | ✅ 80/80 真实会话 | — 同模拟器面 | ⬜ 未实测 |
| 预设管线（bychv 单份注入） | ✅ 实测（v368） | ⬜ 未实测（清单已备） | ⬜ 未实测 |
| MVU direct 卡提取（T2.3b） | ✅ 实测（正控 PASS） | ⬜ 未实测 | ⬜ 未实测 |
| P1 工具链（bash/rg/git/zstd） | ✅ 实测（v370 自测 rc=0） | ⬜ 未实测 | ⬜ 未实测 |
```

**v0.2.7 复验状态（本轮实测）**：

| 能力 | x86_64 模拟器 @ v0.2.7 | 依据 |
|---|---|---|
| 首启 / 会话基础 | ✅ 实测（**但发消息静默失败**，见 §4.1） | §1, §2, §4.1 |
| 会话迁移（0.1.5） | ⚠️ 建议改注：机制实测通过，**但仅在构造 fixture 上**；「80/80 真实会话」措辞失实 | §3.1, §3.3 |
| 预设管线（bychv 单份注入） | ⬜ 本轮未实测 → **保持 ⬜** | §5 |
| MVU direct 卡提取（T2.3b） | ⬜ 本轮未实测 → **保持 ⬜** | §5 |
| P1 工具链（bash/rg/git/zstd） | ✅ 实测（v0.2.7 冷启动自检全 `rc=0`，8/8 links） | §1.2 |

**建议新增行（本轮新发现）**：
| 能力 | x86_64 模拟器 @ v0.2.7 | 依据 |
|---|---|---|
| 发消息（时区已修） | ❌ **静默失败**（输入清空、无落盘、无报错） | §4.1 |
| RP 面板 API 状态指示 | ❌ **假阳性**（显示已连接，实为无凭据） | §4.2 |

⚠️ **不建议**把「首启 / 会话基础」直接标成干净的 ✅ —— 它**启动**是好的，但**发消息**是坏的；建议拆成两行，否则会重蹈「验证面标注过宽」的覆辙。

---

## 7. 方法论限制（供后续复现者）

1. **`-no-window` ⇒ 不能用 pyautogui**，全部走 `adb shell input tap/swipe/text/keyevent`。坐标即 1080×2400 截图像素坐标（含状态栏）。
2. **`uiautomator dump` 对本 App 基本无效**（WebView 内容不暴露，只捞到 1 个原生节点 `⚙`）。界面断言**只能靠截图目视**。
3. **`adb pull` 需绕开 Git Bash 路径改写**：写 `//data/data/...`（双斜杠），否则被改写成 `C:/Program Files/Git/data/...`。
4. **`run-as` 读文件在本会话稳定可用**；`adb root` 后 `pull` 亦可用。
5. **WebView 文本框必须用 `input tap` 命中文本行本身**（如 y≈1523）才会弹 IME；误点按钮行会打开系统相册（已发生并记录，见 `14-typed2.png`）。
6. **模拟器时区在冷启动后可能回落**（persist 属性）；每次测试前应重新 `getprop` 确认，不要假设上次修过就还在。

---

## 8. 交付物清单

- 本报告：`docs/HEALTHCHECK-C-DEVICE-2026-09-26.md`
- 截图证据（18 张）：`tmp/healthcheck/01..16*.png`
- 迁移会话样本：`tmp/healthcheck/migv4.jsonl`
- 备份闸门样本：`tmp/healthcheck/prebak-000335.zip`、`prebak-002329.zip`
- UI 层级转储（反例证据）：`tmp/healthcheck/ui-chat.xml`

### 统计

| 类别 | 数量 | 明细 |
|---|---|---|
| ✅ 实测通过 | **10** | 时区修复(需root) / 冷启动 / **0 boot loop** / 进程稳定 / Web服务就绪 / P1工具链 / 界面+RP入口 / 迁移机制 / 备份闸门 / 凭据0条 |
| ❌ 未通过 | **2** | 发消息静默失败 / RP API 状态假阳性 |
| ⬜ 未验 | **6** | 真实LLM对话(缺凭据) / 真实数据迁移 / 预设管线 / MVU / ST导入 / ARM64·鸿蒙 |
| ↩️ 已撤回 | **3** | ①「备份不含 sessions/rp/state」（**Lead 复验推翻**，实际含）②「备份漏 mig-test v4」（**Lead 复验推翻**，备份早于会话 8h）③「启动页端口显示不准」（自查撤回，界面当时准确） |
| **★ 是否 boot loop** | **否** | `starting node (attempt` 计数 = **1**（历史事故为 253） |

### 撤回/更正记录（保留以供审计）

| # | 初版结论 | 现状 | 错因 |
|---|---|---|---|
| 1 | §3.3.1 备份只含 `profiles/web/**`，不含 `sessions/**`、`rp/state/**` ⇒ 疑似缺口 | ❌ **撤回**（Lead 复验 + 我独立复核推翻）。实际含 sessions 1~4 条、rp 5 条、skills 8 条、storages、.agent-presets 等 | **只看 zip 列表前 40 条**（恰好全在 profiles/ 下）就外推全包内容 —— 从被截断样本过度外推 |
| 2 | §3.3.2 备份漏了 `mig-test` 的 v4 产物 | ❌ **撤回**（Lead 复验推翻）。备份时点 00:03/00:23 **早于** 该会话创建（08:20/11:31）约 8h ⇒ 不含是正确的 | 未先比时间戳就判「漏数据」，P-40③ 同族陷阱 |
| 3 | §4.3 启动页「端口 3080 未监听」与事实相反 | ❌ **自查撤回**。截图 21:49:19 早于服务就绪（21:49:24~26）⇒ 界面当时**准确** | 跨时点比较（`-no-window` 截图时点 ≠ 服务就绪时点） |
| 4 | §3.3.2 末尾「包内文件 mtime 晚于备份命名时点」矛盾 | ✅ **虚警，已收口**。zip 内条目 mtime 被统一改写为备份写入时刻，与原文件 mtime 本就不同口径 ⇒ 无矛盾。Lead 以 `dsht-backup.json` 的 `+0000` 提供物证，证实我当时的假设 (a) | 观察口径错配（未区分「原文件 mtime」与「包内条目 mtime」） |

**§3.3.2.1 两条「口径未声明」（不定性为 bug，仅供最终报告参考）**：manifest `entries` 少计自身 1；`sessionLogs` 实为「全包 `.jsonl` 计数」而非会话维度统计（混入 `rp/state/*.jsonl`）。

> **元教训（比结论本身更值得留存）**：本轮 3 次误判**全部**属于「证据取样不完整 / 时点未对齐」这一类，而**不是**证据本身造假。我曾在报告 §7 警告复现者注意 `-no-window` 的时点问题，却在 §3.3 自己踩了同族陷阱（样本截断），并在更深一层时区口径上再次接近它（§3.3.2 末尾「待澄清」）。
> ⇒ **凡「X 里没有 Y」型否定结论，必须做全量枚举 + 时间戳对齐，不能靠样本片段外推。** 建议纳入项目 R7 的配套检查项。
> **本次能拦下前两条，靠的是 Lead 按 P-40③ 复验而非采信我的措辞** —— 这条流程价值已被实证。
