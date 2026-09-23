# DSH Tavern for Android v0.2.5 — 设备执行层接线（W-3 根因修复）

**版本**：`versionName 0.2.5` / `versionCode 7`；runtime sentinel **v379**（双架构同代次）

---

## 这一版修了什么（值得单独发版的原因）

上一版 v0.2.4 的 GOAL 文档把 **W-3 设备能力工具集**标为 ✅ 已交付。
本轮按完成定义逐条复核时，对着**当前工作区实际代码**发现这个结论**不成立**：

> `DeviceBridge.kt` 的 `exec()` **无条件返回 `NOT_IMPLEMENTED`** ——
> 只打一行 `Log.i(TAG, "would exec: …")`，**没有任何 Shizuku / UserService 执行代码**。

也就是说：**device 工具「在列表里看得到」，但调它什么都不会发生**。
更危险的是这种形态**一切静态检查都全绿** —— 编译过、单测过、门禁过、真机 boot 正常、
HTTP 桥在监听。这是本项目最警惕的 P-30 族（代理量与事实脱钩）的典型形态。

v0.2.5 把这条链路**真正接通**，并把「未接通时的诚实姿态」做成常驻门禁。

---

## 1. 设备执行层接线（根因修复）

| 新增 | 作用 |
|---|---|
| `ShizukuExecService.kt` | Shizuku **UserService 服务端**：以 shell(uid 2000) 跑本项目自己的代码。`ProcessBuilder(argv)` **数组形态** ⇒ 参数不经 shell 解析（引号/分号/反引号都是普通字符）。实现官方要求的 `destroy`（transaction 16777114）自行退进程 —— 因为 `unbindUserService` **不会杀进程** |
| `ShizukuExec.kt` | App 侧客户端：`Shizuku.bindUserService` + 显式 `tag`（官方注明：不设则用类名、**R8 后不稳定**）+ `ensureBound()` 全程 `try` 永不抛 + 带超时的同步等待（异步 bind 的真实语义） |
| `IShizukuExec.aidl` | AIDL 契约，**只 4 个方法**（`exec` / `readBase64` / `uid` / `destroy`）。头注立铁律：**永不加 `shell(String)` 这类收任意命令串的方法** —— 那会让「App 侧唯一命令构造点」这条纪律整个作废 |

**为什么是 UserService 而不是 `Shizuku.newProcess`**（W-2 调研定案，不重开）：
官方 13.1.1 changelog 原文 *"Prepare to remove `Shizuku#newProcess`, developers should
have to use `UserService` instead"*，其中一条理由是致命的 ——
**`newProcess` lacks tty support** ⇒ 与 W-1 打通的 PTY 面不兼容。

**处理细节**：
- 产物类 op（截屏）执行后**读回字节**并回报 `bytes` / `readable` —— 证明产物真的可读，而不只是「命令退出码 0」；
- 文本类 op（`dumpsys` 等）回传**截断到 16k 并带 `truncated:true`** —— 静默截断属 P-3 族（看起来完整、实际残缺）；`dumpsys notification` 真机上可达数十万字符，不截断会一次性打满上下文；
- danger 档被拒时的提示文案改写：原文案暗示「批准即可执行」，而**设备能力不可用时批准不可能成功** ⇒ 改为按「需批准」与「需 Shizuku」两件事分别说清，不让用户白点一次。

---

## 2. 补齐 W-3/W-4 的两条验收口径

**W-3 验收②「RP 插件侧至少一个真实调用样例」** —— 此前 RP 侧**零调用**（四个工具名全仓 42 处命中全是「注册声明 / 单测 mock / 文档叙述」）。本轮在 `st-migration` 技能里补上真实场景：

- 给出 `device_screenshot()` / `device_status({what:"storage"})` 的**具体调用形态**与唯一用途（迁移后核对聊天气泡的页面排版）；
- 写明**硬约束**：`device_input` 属 danger 档、调用会挂起等 60s 批准 ⇒ 迁移是无人值守批处理**不许调用**；拿到 `NOT_IMPLEMENTED` / `NEED_SHIZUKU` **照常继续、不重试、不申请提权**。
- 配 4 条回归锁（判据 9/9b/9c/9d）：9b 要求文档里出现的 `device_*` 名字**必须都是真注册的工具名**（防文档漂移 —— 文档写了 `device_click` 这种不存在的名字，agent 照着调就会失败）；9c 禁止示范调用 danger 档；9d 必须写明降级姿态。

**W-4 验收①「三档位正反控」** —— 此前**只覆盖 danger 一档**：

- 新增判据③**三档齐全**（read-only / workspace-write / danger 任一档 op 数为 0 即报红）；
- 新增判据④**反向**：闸的条件里必须含 `tier == Tier.DANGER_FULL_ACCESS` —— 若有人写成 `!dangerApproved(op)`（漏掉档位判定），read-only / workspace-write 会被**一并拦死**，功能静默失效且无报错。这是「正反控」的**反向**那一半；
- 配负控⑥⑦⑧⑨（read-only 被清空 / workspace-write 被清空 / 闸漏档位判定 / 文档缺声明），selftest **6 → 10**。

---

## 3. 诚实声明护栏（防「误标 ✅」复发）

新增常驻门禁 `audit-device-honesty.mjs`（selftest **13/13**：正控 + 11 负控 + 1 零控），
把 `DeviceBridge.EXEC_WIRED` 做成**唯一真相源**，并与三面**双向**对账：

| 受守面 | 判据 |
|---|---|
| `exec()` 分支 | 未接线：必须返 `NOT_IMPLEMENTED` 且**不得** `ok:true`（假能力）<br>已接线：必须真调 `ShizukuExec.exec` 且**不得**仍返 `NOT_IMPLEMENTED` |
| `capabilityReport()` | 必须暴露 `exec_wired` / `exec_link` / `exec_backend_uid` |
| W-7 看板 | 未接线须含「未接线」字样；已接线须展示 `exec_detail`（区分「已接线但没连上」） |
| GOAL 文档 | W-3 状态列**双向**对账：未接线却标 ✅ ⇒ 报红；已接线却标滞后 ⇒ 报红 |

> 判据自身也修过两次缺陷：① `exec()` 里的**注释**含 `EXEC_WIRED` 使负控失效（删了那行代码判据仍报绿）；
> ② 拿整个函数体判 `NOT_IMPLEMENTED` 使接线后**必然假红** ⇒ 改为按 `!EXEC_WIRED` 守卫切分、只查接线后路径。

---

## 安装包

| 文件 | 架构 | 用途 |
|---|---|---|
| `DSH-Tavern-0.2.5-arm64-release.apk` | arm64-v8a | **真机**（签名 release） |
| `DSH-Tavern-0.2.5-x86_64-debug.apk` | x86_64 | PC 模拟器自测 |

安装后侧栏 →「设置」→「能力看板」可看到新的一行：
**「设备工具执行层」** —— 它会如实告诉你当前是「已接线 + 连接实况 / uid」还是「未接线」，
以及桥端口与三档位 op 分布。

---

## 质量门

- **vitest**：86 文件 / **1839 通过** / 2 skipped / 0 失败（较上版 +4 条新测试）
- **构建门禁**：**54 条** `[gate] OK`、退出码 0（较上版 +1 条新门禁 `audit-device-honesty.mjs`）
- `compileDebugKotlin`：BUILD SUCCESSFUL
- M4 内容级核验：包标记齐全、缺失 0

---

## 验证面（诚实标注）

本轮已验：执行层全链路**编译通过** + `EXEC_WIRED=true` 与实现同源 + 全部静态门禁绿。

**尚未完成**：设备工具的**真机端到端实证**（装 Shizuku → 授权 → 四工具真跑读数，
含 `uid == 2000` 的实证）。这需要真机 + 你已装 Shizuku，按 GOAL 完成定义第 ⑥ 条「真机/鸿蒙验证按既定口径众包，不阻塞收口」处理。

**在此之前的行为保证**：设备工具**不会**静默假装成功 ——
未装 Shizuku 会如实返回 `NEED_SHIZUKU` 与启动指引；已装并经 UserService 执行时按真实退出码回报。
这条不变量已由 `audit-device-honesty.mjs` 常驻受守，不是口头承诺。
