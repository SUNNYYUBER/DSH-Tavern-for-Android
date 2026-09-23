# DSH Tavern for Android v0.2.6 — 修复「App 装得上但核心功能为零」

**版本**：`versionName 0.2.6` / `versionCode 8`；runtime sentinel **v382**（双架构同代次）

> ⚠️ **如果你装了 v0.2.5，请立即升级到本版。**
> v0.2.5 的**两个架构**都无法启动 core —— App 能装、能开、图标能点，
> 但 DSH 运行时永远停在「正在启动」。

---

## v0.2.5 出了什么问题

在模拟器上做真机实证时发现，v0.2.5 的 node 进程**完全无法启动**：

```
CANNOT LINK EXECUTABLE ".../lib/x86_64/libnode.so":
  library "libz.so.1" not found: needed by main executable
```

⇒ `NodeService` 无限重启（实录第 **253** 次），DSH 永远停在「正在启动 DSH 运行时」。
**App 装得上、界面打得开，但核心功能为零。**

---

## 根因：一条从来没被验证过的注释

`scripts/fetch-native-libs.mjs` 里，`libdsht-bash.so` 那行的注释写着：

> 「libpcre2-8 / libz.so.1 / libcrypto.so.3 已在 runtime/lib，**不重复打包**」

—— 但 TARGETS 清单里**从来没有过** zlib / openssl / pcre2 的条目。
换句话说：**那三个库从未被部署过**。注释把「预期」写成了「事实」。

实测差距：`libnode.so` 有 **13** 个 `DT_NEEDED`，而修复前包内只能解析 **5** 个。

---

## 为什么所有既有检查都没抓到（值得记录）

| 检查 | 为什么不可见 |
|---|---|
| 编译期链接检查 | 只查 `.so` 之间的符号，不查「这些 `.so` 是否随包分发」 |
| `audit-pty-prebuilt.mjs` | 只查 `pty.node` 自己的 NEEDED |
| `verify-apk-payload.py`（M4 内容级核验） | 查「标记文件在不在」，不查动态依赖 |
| `audit-artifact-freshness.mjs` | 查「产物与源码一致」——而**源码本身就是错的** |

⇒ **一切绿灯，只有真机才炸。** 这是最贵的一种缺陷形态：绿灯与可用性完全无关。

---

## 修复内容

### 1. 补齐 7 个缺失的原生库（含 SHA256 钉死）

| 库 | 谁需要它 |
|---|---|
| `libz.so.1` | `libnode.so` / `libdsht-git.so` / `libdsht-zstd.so` / `libsqlite3.so` |
| `libcrypto.so.3` · `libssl.so.3` | `libnode.so`（TLS）+ `libdsht-git.so` |
| `libicuuc.so.78` · `libicui18n.so.78` · `libicudata.so.78` | `libnode.so`（Intl；三角缺一即链接失败） |
| `libpcre2-8.so` | `libdsht-git.so` |

### 2. 新增常驻门禁 `audit-native-deps.mjs`（防复发）

对**每个**打包的 ELF 读取它的 `DT_NEEDED`，逐个要求在包内（jniLibs 或 runtime/lib）
或系统库白名单内**可解析**；解析不到即报红，并点名「哪个 .so 需要哪个库」。

- **selftest 6/6**（2 正控 + 3 负控 + 1 零控）
- **经决定性负控**：删掉 `runtime/lib/libz.so.1` ⇒ 精确点名 **4 个**依赖它的 ELF
  （`libnode.so` / `libdsht-git.so` / `libdsht-zstd.so` / `libsqlite3.so`）并退出码 2；
  还原即转绿。
- 按构建架构自动切面（x86_64 / arm64），接入构建 Step 0.5。

---

## 本版实证（模拟器，x86_64）

- node **一次启动成功**（`attempt 1`，**零重启**）
- `dsh web: http://127.0.0.1:3080/?token=…`
- `web token captured (43 chars)`
- `libnode.so` 进程存活，端口 3080 `PORT_OPEN`
- **boot loop 计数 0**（v0.2.5 是 253+）
- 全部插件加载并通过自检：`dsht-mvu variables registered` / `dsht-th macros/expand` /
  `dsht-rp register-workspaces: workspaces=1 errors=0`
- 双架构依赖闭合审计均通过（各 29 个 ELF，全部 `DT_NEEDED` 可解析）

## 顺带完成的设备能力实证

- **鉴权 fail-closed**：对设备桥发无 token 请求 ⇒ `{"ok":false,"error":"BAD_ARGS","detail":"鉴权失败"}`（实机实录）
- **诚实降级**：本机未装 Shizuku 时，四个设备工具走 `NEED_SHIZUKU` 返回可读文案与启动指引，**不会**静默假装成功
- **W-3 部署面**：`dsht-plugin-device` 已进 `profiles/web/node_modules/`，`lib/index.js` 在场

---

## 安装包

| 文件 | 架构 | 用途 |
|---|---|---|
| `DSH-Tavern-0.2.6-arm64-release.apk` | arm64-v8a | **真机**（签名 release） |
| `DSH-Tavern-0.2.6-x86_64-debug.apk` | x86_64 | PC 模拟器自测 |

---

## 质量门

- **vitest**：86 文件 / 1839 通过 / 2 skipped / 0 失败
- **构建门禁**：**55 条** `[gate] OK`、退出码 0（较上版 +1：`audit-native-deps.mjs`）
- `verify-apk-payload.py`：M4 内容级标记齐全、缺失 0

---

## 诚实标注

- 真机（arm64）实证需真实设备 + 已装 Shizuku，按 GOAL 完成定义第 ⑥ 条众包回填；
  本版的 arm64 通过的是**静态依赖闭合审计**与编译/门禁全绿，尚未在 arm64 真机上跑过一次完整启动。
- 本次事故的教训已固化为常驻门禁，不是「下次注意」——
  「依赖不闭合」这一类缺陷此后会在**构建期**报红。
