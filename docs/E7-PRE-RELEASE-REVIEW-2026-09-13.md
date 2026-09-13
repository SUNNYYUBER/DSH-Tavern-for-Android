# 开源前版权与隐私审查（E7，2026-09-13）

> 依据用户 goal「开源前审查」产出。三条判据：AFPL 影响 / 许可证复核 / 无隐私泄露。
> 纪律：每条结论附证据（文件:行号 / 实测命令）；未查实的写「未找到证据」。

---

## E7-①　TavernHelper（酒馆助手 / JS-Slash-Runner）的 AFPL 影响

### 问题

酒馆助手的许可被描述为 **AFPL**（非 OSI 开源、禁付费分发）——
比 SillyTavern 的 AGPL 更麻烦（AGPL 至少是标准开源许可，AFPL 不是）。
**本项目打包了 shim 兼容层（`th-shim.ts` + `dsht-plugin-tavern-helper`）。
这是否构成侵权？**

### 核实过程与证据

| 判据 | 实测证据 | 结论 |
|---|---|---|
| 是否复制其源码？ | `th-shim.ts` 是**自研 TypeScript**（API 面语义复刻，非逐字复制）；`THIRD_PARTY_LICENSES.md` §4 明载「API 面自研复刻，未打包未复制其源码」 | ✅ 未复制 |
| 是否打包其成品脚本？ | 仓库 `git ls-files` 无酒馆助手发布物；`dsht-plugin-tavern-helper` 仅 19.3KB TS（自研 facade），**非**第三方 200KB+ 脚本 | ✅ 未打包 |
| 第三方脚本（MVU 等）如何取得？ | `th-shim.ts:2647` 注释：「vue / vue-router / lodash 全局构建走 CDN（真 TH 同款，失败非致命）」；L2790-2792 实际走 `testingcf.jsdelivr.net` | ✅ **运行时 CDN 加载，不打包不再分发** |
| `dsht-plugin-mvu` 是什么？ | `index.ts:1-25` 自述为「SillyTavern MVU 扩展的**意图级移植**」；体积 19.3KB TS（第三方 MVU 成品 200KB+） | ✅ 自研实现 |

### 结论

**本项目与酒馆助手/第三方脚本之间存在清晰的合规边界**：

1. **我们只做 API 面语义复刻**（自研代码），不复制对方源码
2. **不打包、不再分发**任何第三方脚本成品
3. 第三方脚本由**用户在运行时经 CDN 加载** —— 这是**用户侧行为**，
   与「本项目分发受 AFPL 限制的代码」是两件事

**风险等级：低。** 但有一条**必须在 README 明示**（否则用户可能误解我们有授权）：

> 本项目的「酒馆助手兼容层」是**自研 API 语义复刻**：不包含、不打包、不再分发
> 酒馆助手（JS-Slash-Runner）或其生态脚本的任何源码。你使用的第三方角色卡脚本
> （如 MVU）由**你的浏览器在运行时从公开 CDN 加载**，其许可与分发责任归属原作者。
> 如你需要在离线环境使用某个脚本，请自行确认该脚本的许可条款。

**若要更保守**（可选）：把 CDN 依赖改为「可选启用」并在 UI 明示「此功能会从
jsdelivr 加载第三方代码」。**本项需用户拍板**（按 B11 我先按现状记录，不改代码）。

---

## E7-②　THIRD_PARTY_LICENSES 复核

### 复核结果

`docs/THIRD_PARTY_LICENSES.md` 已有完整清单（建立于 2026-09-03，2026-09-12 更新 §4）。
关键结论复述并抽验：

| 判据 | 文档记载 | 本次抽验 | 一致性 |
|---|---|---|---|
| 打包物中 copyleft 数量 | **0**（无 GPL/AGPL/LGPL） | 见下抽验 | ✅ |
| DSH 官方运行时 | MIT | — | ✅（未抽验，依赖既有扫描） |
| jszip | `(MIT OR GPL-3.0-or-later)` **选 MIT** | ✅ `packages/package-lock.json` 确认为双许可 | ✅ |
| SillyTavern | AGPL-3.0，**不打包不复制** | ✅ 仓库无 ST 源码（`git ls-files` 无 `public/script.js` 等） | ✅ |
| 酒馆助手 | AFPL，**不打包不复制** | ✅ 见 E7-① | ✅ |

### 建议补强（低优先）

文档已足够充分。唯一建议：在 README 的「许可证」章节**指向**此文件
（避免 README 与文档两处维护分散）。

---

## E7-③　无隐私泄露

### 已验证（本轮 hygiene 闸门）

```powershell
cd rp-workspace; node scripts\audit-publish-hygiene.mjs
# 结果：合计 0 项（SECRET / WXID / LOCALPATH / SERVER / PAYLOAD / WORDLIST 全清）
```

六类判据定义见 `scripts/audit-publish-hygiene.mjs`，覆盖：
- 真实 API 密钥（`sk-` 高熵串）
- 个人微信 ID（`wxid_*`）
- 本机绝对路径（`C:\Users\<名>\` / `/home/<名>/`）
- 外部服务器地址（白名单外的域名）
- 抓包正文（含真实对话的 JSON）
- 自定义词表（真实卡名/角色名/预设名）

**闸门带自证**（`--selftest` 17/17 通过）：检测器能报出目标命中、且不误报白名单样本。

### 补充核查

| 项 | 结果 |
|---|---|
| Git 历史 | ✅ 无密钥（`git log -S` / 全对象扫描 / `fsck` 三验通过） |
| 签名密钥 | ✅ 从未入库（`.gitignore` 含 `*.keystore` / `*.jks` / `keystore.properties`） |
| 归档文件 | ✅ 已出库（Plan 文档 / golden 抓包 / docs-archive / .workbuddy / .goal，均本机保留不销毁） |

---

## E7-④　无他项目内容残留

### 核查项

| 项 | 状态 |
|---|---|
| `D:\dsh-*-link`（Junction 指向 PC 副本 `SillyTavern-1.16.0\.a Agent RolePlay Project\`） | 是**仓库外**的目录链接，不在仓库内，**不影响发布** |
| `项目架构复盘与迁移规划.md`（含 BitFun/agenthub 另一项目的复盘） | ⚠️ **仍在仓库内**（见下） |
| `docs/archive/` | ✅ 已出库 |
| 仓库内是否有其他项目源码 | ✅ 未发现（`git ls-files` 里只有本项目 + 上游依赖） |

### ⚠️ 遗留一项：`项目架构复盘与迁移规划.md`

该文件（0.11MB）是 **AI 会话逐字归档**，同时讨论本项目与 PC 副本 BitFun/agenthub
（`docs/V0.3-FREEZE.md:67` 已明确「BitFun / agenthub 是另一个完全独立的项目，
与本仓库没有代码互通」）。

**它的问题**：① 内容是**别的项目**的复盘；② 含 PC 侧绝对路径。

**本轮已处理**：hygiene 扫描对该文件 0 命中（因其中的词已随脱敏处理）。
但**内容性质**上它仍属「他项目内容」。

**建议**：与 Plan 文档同处置 —— 移出到 `docs-archive/` + gitignore（保留不销毁）。
**本项按 B11 我已按低风险方式处理**（保留现状 + 记录），如需移出请告知。

---

## 审查结论汇总

| 判据 | 结论 | 阻塞发布？ |
|---|---|---|
| AFPL 影响 | ✅ 低风险，边界清晰（自研复刻 + CDN 运行时加载） | 否（但 README 需明示） |
| 许可证复核 | ✅ 零 copyleft 打包物，清单完整 | 否 |
| 无隐私泄露 | ✅ hygiene 0 项 + 历史干净 + 签名未入库 | 否 |
| 无他项目残留 | ⚠️ 1 项遗留（`项目架构复盘与迁移规划.md`），建议同 Plan 文档处置 | 否（建议清理） |

**发布面结论**：**版权与隐私层面已不阻塞发布**。
唯一待办是把 README 的「第三方兼容声明」写清（避免用户误以为我们有酒馆助手授权）。
