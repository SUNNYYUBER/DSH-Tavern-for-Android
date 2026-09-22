# W-3 设计：设备能力工具集（2026-09-21）

> GOAL-DSH-ANDROID-COMPLETE-2026-09-21 的 W-3 设计交付物。
> 前置：[SHIZUKU-RESEARCH](SHIZUKU-RESEARCH-2026-09-21.md)（路线与硬边界）、
> W-1（node-pty 已打通，终端可用）。
>
> 本设计已按用户拍板确定范围：**四个工具全做**（截屏 / 输入模拟 / 通知读取 / 系统状态），
> **桥接形态 = native 侧小服务 + node 侧注册 DSH 工具**。

---

## 一、架构：三层，命令构造固定在中间层

```
┌─ agent（DSH 运行时）──────────────────────────────┐
│  调 tool: device_screenshot / device_input / ...   │
└────────────────┬───────────────────────────────────┘
                 │ ① node 侧：工具注册 + 参数校验（schema 约束）
                 ▼
┌─ dsht-device（新插件，node 侧）────────────────────┐
│  把工具调用翻译成**固定命令模板**的 JSON 请求        │
│  ★ 只做「参数 → 请求体」，**不构造 shell 字符串**     │
└────────────────┬───────────────────────────────────┘
                 │ ② 本机 HTTP（仅 127.0.0.1 + token 鉴权）
                 ▼
┌─ DeviceBridge（Java 侧，新）───────────────────────┐
│  · 鉴权 → 档位判定（W-4 守门人）→ 审计日志           │
│  · **命令模板表**：参数只经 `String[]` 数组传递       │
│    （永不拼字符串 ⇒ 免疫注入）                       │
│  · Shizuku UserService 执行（uid 2000）             │
│  · 输出经 /sdcard 中转（uid 2000 读不到 app 私有目录）│
└────────────────────────────────────────────────────┘
```

### 1.1 为什么命令构造必须固定在中层（本设计的核心纪律）

W-2 调研 §6.3 记录了本项目的实证教训：`list-device-sessions.sh` 里同一命令
**经多层转发得 87 条、直接执行得 29 条**——「看起来完全正常」的假结论。

⇒ 本设计**从结构上消除这条风险**：

- **node 侧不产生 shell 字符串**：工具参数经 JSON 传给 native，`command` 字段
  只能是**枚举值**（如 `"screencap"` / `"input_tap"`），**不接受任意命令**；
- **native 侧用 `String[]` 数组 + `ProcessBuilder`/`Shizuku.newProcess` 语义**：
  参数是数组元素，**不经 shell 解析** ⇒ 引号/分号/反引号全部是普通字符；
- **唯一需要字符串拼接的是「参数值」**，且逐项做**白名单校验**
  （如坐标必须是 `^-?\d{1,5}$`）。

### 1.2 桥接协议（node ↔ native）

- **传输**：本机 HTTP，`127.0.0.1:<nativePort>`（native 侧起 `ServerSocket`，
  端口由 NodeService 在 3080..3089 之外另取一段，如 3100..3109）。
- **鉴权**：复用 DSH 的 token 机制语义但**独立一枚**（`dsht-device-token`，
  由 NodeService 生成、仅本进程与 node 子进程可见——经 env 传递，不落盘到可备份区）。
  **无 token = 401，fail-closed**。
- **为什么不用 unix socket**：Android 上 `LocalSocket` 可行，但 HTTP 便于复用
  现有调试工具（curl / CDP），且本项目的诊断体系已围绕 HTTP 建立。**代价**：
  需防「本机其它 app 也能连 127.0.0.1」——用 token 解决（且 Android 的
  `127.0.0.1` 不隔离，故 token 是**必需**而非可选）。

**请求形态**（示例）：
```json
{ "op": "screencap", "args": { "display": 0 } }
{ "op": "input_tap", "args": { "x": 540, "y": 1200 } }
{ "op": "notifications", "args": { "limit": 20 } }
{ "op": "system_status", "args": { "what": "battery" } }
```
- `op` 是**枚举**（native 侧查表，未知 op = 400）；
- `args` 逐项按 op 的 schema 校验（类型 + 范围 + 白名单）。

**响应形态**：
```json
{ "ok": true, "data": { ... }, "via": "shizuku" }
{ "ok": false, "error": "NEED_SHIZUKU", "detail": "Shizuku 未启动，见设置面板" }
```
- `error` 是**枚举**（`NEED_SHIZUKU` / `NOT_AUTHORIZED` / `DENIED_BY_POLICY` /
  `BAD_ARGS` / `EXEC_FAILED`）——node 侧据它给出**可处置**的提示，
  而不是把异常糊成一团文本（W-2 验收口径：如实报「需要 Shizuku」而非崩溃）。

---

## 二、四个工具的设计

### 2.1 通用约定

| 项 | 约定 |
|---|---|
| 命名 | DSH 工具名统一前缀 `device_`（`device_screenshot` 等）⇒ 与 RP 工具区分，便于 W-4 按前缀归级 |
| 输出 | 统一返回**文本摘要**（含产物路径），不把二进制塞进工具返回值 |
| 产物落点 | `/sdcard/Android/data/com.dshtavern.app/files/device-out/`（**外部私有目录**：uid 2000 可写、app 可读、用户文件管理器可见、卸载即清） |
| 失败 | 永远返回**可读的失败原因**，不抛异常给 agent |
| 并发 | `isConcurrencySafe: () => false`（设备操作有副作用，且 native 侧串行更安全） |

**为什么产物落 `/sdcard/Android/data/<pkg>/`**（而不是 `/data/local/tmp`）：
- uid 2000 对**两者**都可写（W-2 实测）；
- 但 `/sdcard` 那份**用户可见**（文件管理器能打开截图看效果），且随 App 卸载自动清理；
- `/data/local/tmp` 更适合「临时脚本载体」（W-4 守门人可用），不适合产物。

### 2.2 device_screenshot（截屏）

| 项 | 设计 |
|---|---|
| op | `screencap` |
| 命令模板 | `["screencap", "-p", "<outPath>"]`（数组，无 shell） |
| 参数 | `display`（int，默认 0，白名单 0~9） |
| 产物 | `/sdcard/…/device-out/screenshot-<ts>.png` |
| 返回 | 路径 + 尺寸（从 PNG 头解析，不依赖额外工具） |
| 档位（W-4） | **read-only**（只读屏幕内容，不改状态） |
| 风险 | 低（但截图可能含敏感信息 ⇒ UI 侧需提示） |

### 2.3 device_input（输入模拟）

| 项 | 设计 |
|---|---|
| op | `input_tap` / `input_swipe` / `input_text` / `input_key` |
| 命令模板 | `["input", "tap", "<x>", "<y>"]` 等（**每个 op 一个固定模板**） |
| 参数校验 | `x`/`y`：`^-?\d{1,5}$`；`duration`：int 0~10000；`key`：**枚举**（HOME/BACK/ENTER 等，不接受任意 keycode）；`text`：**长度上限 + 字符白名单**（仅可打印 ASCII + 中文，**拒绝 `\n` 与控制字符**——防「输入换行 = 提交」这类意外副作用） |
| 档位（W-4） | **danger-full-access**（能操作别的 App，含转账按钮这类不可逆动作） |
| 风险 | **最高**。W-4 文档要求「danger 档要用户显式批准」⇒ 每次调用都要过批准闸 |
| 附加防护 | ① 单次调用只做**一个**动作（不许 tap+swipe 连做）；② 同会话内**同类动作频率上限**（如 30 次/分钟，防 agent 卡在循环里乱点）；③ 全部调用写审计日志 |

### 2.4 device_notifications（通知读取）

| 项 | 设计 |
|---|---|
| op | `notifications` |
| 命令模板 | `["dumpsys", "notification", "--noredact"]`（**不加 `--noredact`** 时系统会隐去敏感字段——**默认不加**，见下） |
| 参数 | `limit`（int 1~50，默认 20） |
| 输出 | 解析后的**结构化摘要**：`{package, title, text, time}` 列表 |
| 档位（W-4） | **workspace-write**（读系统状态但含隐私面，比 read-only 高一档） |
| 隐私边界（重要） | **默认不加 `--noredact`**（系统会遮蔽验证码等敏感字段）；若将来要提供「完整模式」，必须**单独一档 + 显式确认**，且文档明示风险 |
| 风险 | 高（通知含验证码/私聊预览）⇒ 返回给 agent 的文本需**二次过滤**：识别并遮蔽常见验证码形态（4-8 位纯数字 + 「验证码」上下文） |

### 2.5 device_status（系统状态）

| 项 | 设计 |
|---|---|
| op | `system_status` |
| 参数 | `what`：**枚举** `battery` / `wifi` / `display` / `storage` / `all` |
| 命令模板 | 每个 `what` 一个固定 `dumpsys` 调用（如 `["dumpsys", "battery"]`） |
| 输出 | 解析后的键值摘要（如电量/充电状态/网络名/分辨率/可用空间） |
| 档位（W-4） | **read-only** |
| 风险 | 最低（只读系统状态） |

---

## 三、与 W-4 守门人的接口（本设计为 W-4 预留）

W-4 要求「复用 DSH 权限档位语义扩展（read-only / workspace-write /
danger-full-access），danger 档要用户显式批准」。

**本设计提供的接缝**：
1. **每个 op 声明自己的档位**（见上表的「档位」行）——native 侧命令模板表里
   带 `tier` 字段，**声明与实现在同一处**（防止文档与代码漂移）；
2. **批准闸的位置在 native 侧**（DSH 看不穿的层）——node 只能「请求」，
   **能否执行由 native 决定**。这比在 node 侧拦更安全（node 是 agent 可影响的）；
3. **批准闸的形态**（W-4 定）：danger 档 op 到达时，native 挂起请求 +
   发通知/弹窗请用户确认（默认拒绝，fail-closed）；
4. **审计日志**：native 侧记录 `{ts, op, args, tier, decision, result}` 到
   `filesDir/.dsh/device-audit.jsonl`（**不进备份**——含操作轨迹，属敏感面）。

**本设计不替 W-4 做决定**：批准的具体交互（通知 / 悬浮 / 记时窗口）由 W-4 定；
本设计只保证「档位声明齐全 + 闸的位置正确 + 默认 fail-closed」。

---

## 四、node 侧插件（dsht-device）

- **形态**：新包 `packages/src/dsht-plugin-device`（与现有 dsht-plugin-* 同构）；
- **内容**：4 个 `ctx.tools.register`（对齐 `dsh-plugin/index.ts:3570` 的既有形态）
  + 一个 `deviceRequest(op, args)` 内部函数（HTTP 调 native）+ 降级文案；
- **systemPrompt 段**：按现有惯例加 `tool:device_*` 段，说明适用场景；
- **打包**：进 runtime node_modules（同 `build-dsht.ps1` Step 4.72 的三大插件做法）。

**降级文案（W-2 验收口径）**：
```
设备能力不可用（Shizuku 未启动）。请在 App 设置面板 → 设备能力 中完成启动与授权。
本功能不影响对话与终端。
```

---

## 五、验收口径

| # | 判据 | 可验证性 |
|---|---|---|
| 1 | 四个工具在 DSH 工具列表可见（`ctx.tools.register` 生效） | 构建期 + 运行期 |
| 2 | 未装/未启动 Shizuku 时，四工具**全部**返回可读的「需要 Shizuku」而非崩溃/超时 | **模拟器可验**（本机无 Shizuku） |
| 3 | 参数校验：非法坐标 / 超长 text / 未知 op / 未知 key 全部 400 且**不执行** | 单测可验 |
| 4 | 命令构造**不含字符串拼接**：`String[]` 逐项断言（含注入样本 `; rm -rf` 作为坐标值 ⇒ 不执行） | 单测可验 |
| 5 | 无 token / 错 token 的请求 = 401 | 单测可验 |
| 6 | 真机：装 Shizuku + 授权后，`device_screenshot` 产出可打开的 PNG | **真机众包** |
| 7 | 真机：`device_status` 返回真实电量 | **真机众包** |
| 8 | danger 档（input）在 W-4 未就绪前**默认拒绝**（fail-closed） | 单测可验 |

**首期交付**：判据 1~5 + 8 本机全验；6/7 留真机众包（同 W-2 口径）。

---

## 六、明确不做（首期）

- **不做**：`device_shell`（任意命令）——工具面**永远不收任意命令**，
  这是本设计最重要的边界（agent 要跑命令用 bash 工具，那是 app uid 面）；
- **不做**：屏幕录制 / 实时投屏（超出「让 agent 有能力」的必要范围）；
- **不做**：`--noredact` 完整通知模式（隐私面，需单独决策）；
- **不做**：跨用户 / 多显示器切换（`display` 参数保留但不做 UI）。

---

## 七、实施顺序（确认本设计后）

1. `DeviceBridge.kt`（native HTTP 服务 + 命令模板表 + token 鉴权 + 档位声明）；
2. `dsht-plugin-device`（node 侧 4 工具 + 降级）；
3. 单测（判据 3/4/5/8）；
4. 模拟器验证（判据 2）；
5. 打包进 runtime + 构建链（对齐既有两个链路的等价性门禁）；
6. 真机众包项登记（判据 6/7）。
