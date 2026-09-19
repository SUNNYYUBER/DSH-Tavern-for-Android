# 全量版权审计报告（2026-09-14）

> **任务**：用户要求「对整个项目进行一轮全量审计，看看到底有哪些地方引用了别人的项目，
> 尤其是那些没有声称自己是 MIT 的项目」。目标 = 把所有版权风险封杀在摇篮里。
>
> **方法**：不采信任何旧文档结论（`REF_PROJECTS_COMPARISON.md` 的「全 MIT」声明已被证伪），
> 一律**现场拉取 LICENSE 原文** + 全仓代码扫描 + 依赖树全量复核。
>
> **本文不含任何推测**：每条结论都标注证据来源（文件:行号 / 命令输出 / LICENSE 原文）。

---

## 零、结论速览

| 维度 | 结果 |
|---|---|
| 第三方 **npm 依赖** | ✅ **干净**（503 包，非宽松许可 0 个） |
| **AGPL 传染风险** | 🔴 **1 个项目、5 处引用**（`flizzywine/dsh-tavern`） |
| **无许可项目引用** | 🟠 **1 个项目、4 处引用**（`agent-loop-rp`） |
| **AFPL 项目引用** | 🟡 **1 个项目、多处对照**（`JS-Slash-Runner`，本项目既有结论已评估为低风险） |
| **其他 MIT 项目** | ✅ 4 个项目，署名基本齐全 |
| **隐私项** | 🟠 3 个审计脚本硬编码本机绝对路径（非版权问题，但发布前需处理） |
| **README 致谢完整性** | 🔴 **6 个实际参考过的项目一个都没列** |

---

## 一、许可核实：逐个拉取 LICENSE 原文

### 1.1 核实结果表

| 项目 | 旧文档声称 | **实测许可** | 证据 |
|---|---|---|---|
| `hewzhew/dsh-agent-rp` | MIT | **MIT** ✅ | LICENSE 原文「MIT License Copyright (c) 2026 hewzhew」 |
| `lutrodev/dsh-roleplay` | MIT | **MIT** ✅ | LICENSE 原文「MIT License Copyright (c) 2026 dsh-roleplay contributors」 |
| `aam452/dsh-worldbook` | MIT | **MIT** ✅ | README 协议节「[MIT](LICENSE)」 |
| `Czerror/dsh-plugin-prompt-tool` | MIT | **MIT** ✅ | LICENSE 原文「MIT License Copyright (c) 2026 Czerror」 |
| `flizzywine/dsh-tavern` | MIT | 🔴 **AGPL-3.0** | LICENSE 原文「GNU AFFERO GENERAL PUBLIC LICENSE Version 3」 |
| `2428139739pregnant-web/agent-loop-rp` | MIT | 🔴 **未声明** | README 原文「本仓库目前未声明正式开源许可证，使用和再分发前请先确认项目维护者的许可安排」 |
| `N0VI028/JS-Slash-Runner` | AFPL（既有结论） | **AFPL** ✅ | LICENSE 原文「Aladdin Free Public License (AFPL) Version 9」+「This License is not an Open Source license」 |
| `chen731215-dev/dsh-tavern` | —— | **CC BY-NC-SA 4.0** | 已确认**未引用**（本次审计新增核实项） |

### 1.2 三个高风险许可的性质

**① AGPL-3.0（`flizzywine/dsh-tavern`）**
- 最强 copyleft：衍生作品**必须**以 AGPL 发布
- 与我们的 **MIT** 直接冲突（MIT 不是 AGPL 兼容许可）
- 含网络服务条款（SaaS 也触发源码开放义务）

**② 无许可（`agent-loop-rp`）**
- 按版权法默认规则：**未声明许可 = 保留所有权利**（≠ 免费使用）
- README 明确要求「使用和再分发前请先确认项目维护者的许可安排」= 需**事先取得授权**

**③ AFPL（`JS-Slash-Runner`）**
- 非 OSI 开源；**禁止商业分发**（收费/广告/打赏变现等）
- 但：**功能使用（running）不受限**，且许可明确「Activities other than copying,
  distribution and modification are outside its scope」

---

## 二、引用清单：逐文件核实（核心产出）

### 2.1 涉 `flizzywine/dsh-tavern`（AGPL-3.0）—— 🔴 5 处

| # | 文件:行 | 引用内容 | **程度判定** | 依据 |
|---|---|---|---|---|
| **A1** | `dsht-rp-ui/src/client/display-compiler.ts` 多处 | 私用区 token 隔离（注释 L304「dsh-tavern presentationToken 同款形态」）、替换串求值（L324「dsh-tavern replacementFor L39-59」）、防空白守卫（L382「dsh-tavern L136-147 思路」）、iframe 骨架（L445「移植 dsh-tavern client.js L883-941」） | 🟠 **移植级**<br>（注释自述「移植」「同款」「照抄」） | 注释 L4-14 自查表；L204 写「照抄 dsh-tavern rollbackTurn」；L288「token 隔离」 |
| **A2** | `dsht-plugin-shared/file-snapshots.ts` L4-6, L204 | `nativeCommits` 按 turn 记 before 快照、回退整批恢复 | 🟡 **思路级**<br>（我们落到**文件维度**，数据结构/API 自研） | 注释 L6 自述「此处把"内存对象快照"落到文件维度」 |
| **A3** | `dsht-plugin-mobile/client/style.ts` L4 | 移动端 CSS 五件套（100dvh / grid 轨道锁定 / left 抽屉 / safe-area / 触控 ≥38px） | 🟡 **方案级**<br>（CSS 属性组合属通用实践，但注释自述"参考 client.js"） | CSS 属性本身是标准，组合方式可主张为通用实践 |
| **A4** | `dsht-plugin-mobile/client/anchors.ts` L4, L32 | `data-sidebar-collapsed` 状态钩子、CSS 类名同源约定 | 🟢 **约定级**（仅相同的属性名约定） | 属性名是接口约定，非创作性表达 |
| **A5** | `dsh-plugin/index.ts` L2104, L5533 | 注释提及 nativeCommits 思路 | 🟢 **注释级**（仅注释） | 无代码复制 |

**另有**：`REF_PROJECTS_COMPARISON.md`（已移出仓库至 `docs/archive/`，不入库）中大量条款
把 dsh-tavern 列为「直接可抄来源」。

### 2.2 涉 `agent-loop-rp`（无许可）—— 🟠 4 处

| # | 文件:行 | 引用内容 | **程度判定** | 依据 |
|---|---|---|---|---|
| **B1** | `dsht-rp-ui/src/client/display-compiler.ts` L7, L37, L50-51 | SVG 标签白名单扩展 | 🟢 **事实级**<br>（HTML 规范的标准标签名，非创作性表达） | 标签名来自 W3C 规范，不构成受版权保护的表达 |
| **B2** | `dsht-plugin-shared/output-protocol.ts` L161, L174 | SVG 标签白名单 | 🟢 同上 | 同上 |
| **B3** | `dsht-plugin-prompt-template/sandbox.ts` L7, L20 | 列为「参考实现」 | 🟢 **注释级**<br>**且实际弃用了其方案**（选 node `vm`，非 quickjs-emscripten，未引入其代码） | 注释 L11-13 明示「结论：采用 ①」 |
| **B4** | `dsht-plugin-prompt-template/injection-store.ts` L5-13 | `createEjsTemplatePromptInjectionStore` 语义移植；上限值 256 字符 / 256KB / 512 条「与参考同款」 | 🟠 **移植级**<br>（**这是本轮新查出的待核实项，现已定性**） | 注释 L5「出处：agent-loop-rp … L70-175」+ L13「（参考实现同款上限）」 |

### 2.3 涉 `JS-Slash-Runner`（AFPL）—— 🟡 多处对照

| 文件 | 引用内容 | 程度 |
|---|---|---|
| `dsht-rp-ui/src/client/th-shim.ts` | 15 处归属注释；全文件 **288 行**对照标记（「真 TH」「基准」等） | 🟡 **API 面语义复刻**（自研 TypeScript，非逐字复制源码） |
| `dsh-plugin/index.ts` L1265-1270 | `registerVariableSchema` 存储语义对照（`JS-Slash-Runner/src/function/variables.ts:10-37`） | 🟡 语义对照 |
| `dsh-plugin-tavern-helper/facade.ts` | 多处 TH 契约对照 | 🟡 语义对照 |

**既有 E7 结论仍成立**：本项目**不含、不打包、不再分发**其任何源码；API 面为自研复刻；
第三方脚本由用户运行时经 CDN 加载（用户侧行为）。AFPL 明确「功能使用不受限」。
→ **风险等级：低**。但 README 必须保留现有的「第三方兼容声明」。

### 2.4 MIT 项目（4 个）—— ✅ 署名已标注

| 项目 | 引用位置 | 程度 |
|---|---|---|
| `dsh-agent-rp` | `display-compiler.ts`（三段编译）、`frontend-regex.ts` 语义、`session-store.ts`（六作用域）、`sandbox.ts` 注释、`tt-projection.ts` | 🟡 语义/结构参考，注释已标 MIT |
| `dsh-worldbook` | `lore/trigger.ts` L7-11（visibleMessageCursor 照抄语义、bookCandidates/dedupeGroups 对照） | 🟡 已标 MIT © aam452 |
| `dsh-plugin-prompt-tool` | `preset/st-import.ts` L12, L362（convertStToPreset 映射） | 🟡 已标 MIT © Czerror |
| `dsh-roleplay` | 主要作为**架构决策对照**（零私有事件/遮蔽/ancestry） | 🟢 思路级 |

---

## 三、无归属注释的疑似拷贝排查

**方法**：全仓扫描「参考/出处/移植自/照抄/借鉴/同款/抄自/改编自」等 327 条命中行，
逐文件回溯归属目标，检查是否存在**未标注来源**的疑似拷贝。

**结果**：✅ **未发现无归属的疑似拷贝**。

- 327 条归属注释全部指向已核实的外部项目或 ST/TH 官方参考
- 生成的 `st-event-types.gen.ts`（104 条 ST 事件名）**有生成器 + 来源行号**：
  来源 `SillyTavern-reference/public/scripts/events.js:3`，工具 `gen-st-event-types.mjs`
- **事件名常量表**属**接口契约数据**（同 SVG 标签名性质），且 ST 为 AGPL —— **需注意**：
  但事件名是 API 契约名称（不受版权保护的接口事实），且我们**未复制 ST 源码实现**

**一处需标注的既有事实**：`st-quotes.ts` L4 自述「出处对照：ST public/script.js
messageFormatting L1845-1871」——属**引号对清单**（数据表），程度为事实级。

---

## 四、依赖树全量复核

### 4.1 runtime node_modules（503 包）

```
扫描包数: 503
非宽松许可: 9
  @deepseek-ai/dsh-win32-process => NONE
  dsht-plugin-memory / mobile / mvu / prompt-template / tavern-helper / undo => NONE
  dsht-preflight => NONE
  dsht-rp-plugin => NONE
```

**判定**：✅ 干净。9 项「NONE」全部是**我们自研的包**（未在 package.json 写 license 字段），
**非第三方依赖**。真正第三方 494 包的许可全部为 MIT/ISC/Apache-2.0/BSD/Python-2.0 等宽松许可。

### 4.2 构建期 vendor（`th-vendor.gen.txt` / `th-host-vendor.gen.txt`）

| 包 | 版本 | 许可 |
|---|---|---|
| jquery | 3.7.1 | MIT |
| jquery-ui | 1.13.3 | MIT |
| zod | 4.5.4 | MIT |
| yaml | 2.9.0 | ISC |
| lodash | 4.18.1 | MIT |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) → **选 MIT** |

**判定**：✅ 无 copyleft 打包物。

### 4.3 内嵌第三方（APK 内）

| 组件 | 许可 | 来源 | 备注 |
|---|---|---|---|
| **PDF.js**（经 `dsh-client-ui-sidebar-documentpreview` 内嵌） | **Apache-2.0** | DSH 官方包 | 文件头有完整 license notice；宽松许可 |
| Node.js 二进制 / proot / busybox / ICU | MIT / GPL-2.0 / GPL-2.0 / Unicode | Termux deb | busybox 为 GPL-2.0 —— **但它是独立可执行文件（`.so` 改名），未与我们代码链接**，属「聚合」非「衍生」 |

⚠️ **一处需注意**：**busybox 是 GPL-2.0**。它作为独立二进制随 APK 分发，
在我们 `THIRD_PARTY_LICENSES.md` 里**未列出**。GPL-2.0 要求随分发提供源码或书面要约。
**建议**：在第三方清单中补充 busybox 条目，并附源码获取方式（Termux 仓库链接）。

---

## 五、非版权但需处理的隐私项

| # | 文件:行 | 内容 | 性质 |
|---|---|---|---|
| P1 | `scripts/audit-card-context-surface.mjs:27,32` | `D:/SillyTavern-1.16.0/TauriTavern-Canary/...` | 🟠 本机绝对路径 |
| P2 | `scripts/audit-card-event-surface.mjs:38` | `D:/SillyTavern-1.16.0/TauriTavern-Canary/SillyTavern-reference` | 🟠 本机绝对路径 |
| P3 | `scripts/gen-st-event-types.mjs:15,23` | 同上（缺省源路径） | 🟠 本机绝对路径 |
| P4 | `scripts/audit-publish-hygiene.mjs:262` | `C:\Users\<示例用户名>\...` | ✅ **合法**（是扫描器自身的合成样本，用于 `--selftest` 正控） |

**说明**：P1~P3 之所以未被 hygiene 闸门拦下，是因为闸门扫描的是
`git ls-files ∩ 文本文件`，而这三个脚本**在跟踪列表内**——
需复核闸门为何漏检（可能是 `D:/` 形态不在 LOCALPATH 规则内）。

---

## 六、README 致谢完整性

**事实**：`docs/archive/REF_PROJECTS_COMPARISON.md` 第四部分有一份完整六项目致谢表，
并明确写着「**必须进 README（用户定案"非常非常重要"）**」。

**当前 README 致谢**：只有 4 项 —— DeepSeek / SillyTavern / TauriTavern / JS-Slash-Runner。

**缺失**：以下 6 个**实际参考过的项目全部未列**：
`dsh-agent-rp`、`flizzywine/dsh-tavern`、`dsh-roleplay`、`agent-loop-rp`、
`dsh-worldbook`、`dsh-plugin-prompt-tool`。

---

## 七、风险分级与处置建议

### 🔴 高风险：必须处置

| 项 | 涉及 | 建议处置 |
|---|---|---|
| **H1** `display-compiler.ts` 的 dsh-tavern 移植（A1） | token 形态 / replacementFor / 防空白守卫 / iframe 骨架 | **独立重写**：保留功能，重写实现表达（换 token 分隔策略、重写替换求值逻辑、重写骨架结构） |
| **H2** `injection-store.ts` 的 agent-loop-rp 移植（B4） | 整个 store 实现 + 上限制 | **独立重写**（该实现本身简单：三个方法 + 三个上限常量） |

### 🟠 中风险：建议处置

| 项 | 涉及 | 建议处置 |
|---|---|---|
| **M1** `file-snapshots.ts`（A2） | nativeCommits 思路 | 属**思路级**（思路不受版权保护），可保留；但建议**改写注释**，把「照抄 rollbackTurn 的整批恢复语义」改为「借鉴按 turn 快照的思路」 |
| **M2** `style.ts` CSS 五件套（A3） | 通用 CSS 实践 | 可保留；建议改写注释，去除"参考 client.js"式表述，改为标注为通用移动端适配实践 |
| **M3** 三个脚本的硬编码路径（P1~P3） | 隐私 | 改为环境变量 + 缺省值，或用占位路径 |
| **M4** busybox GPL-2.0 未列 | 许可合规 | 在 `THIRD_PARTY_LICENSES.md` 补充 busybox 条目 + 源码获取方式 |
| **M5** README 致谢缺失 6 项目 | 署名义务 | 补全致谢表（MIT 4 个必列；AGPL/无许可 2 个按处置结果决定措辞） |

### 🟢 低风险：记录即可

| 项 | 说明 |
|---|---|
| AFPL（JS-Slash-Runner） | 既有 E7 结论成立：自研复刻 + 运行时 CDN 加载，低风险。README 已有声明 |
| SVG 标签白名单（B1/B2） | 事实级（HTML 规范标准名） |
| `sandbox.ts` 注释（B3） | 注释级，且实际弃用了参考方案 |
| `anchors.ts` 约定（A4） | 约定级（属性名） |
| ST 事件名常量表 | 接口契约数据 |

---

## 八、审计方法与可复跑命令

```powershell
# 1. 归属注释全量扫描（327 条命中）
Get-ChildItem -Path 'rp-workspace\packages\src','rp-workspace\scripts','rp-workspace\android' -Recurse `
  -Include '*.ts','*.tsx','*.mjs','*.js','*.kt','*.py','*.sh','*.ps1' -File |
  Where-Object { $_.FullName -notmatch '\\lib\\' -and $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern '(参考|出处|移植|照抄|借鉴|同款|抄自|改编自)'

# 2. 外部项目名频次统计
#    （同目录范围）Select-String -Pattern 'dsh-agent-rp|dsh-tavern|...'

# 3. 依赖树许可复核：见 §4.1 的 python 脚本
```

**本次审计的局限（如实说明）**：
1. 归属扫描依赖源码注释中**写了项目名**；若某处引用了但没写名字，扫不到
2. 「程度判定」是基于**注释自述 + 代码形态**的判断，非法律鉴定
3. 未逐行对比 `display-compiler.ts` 与 dsh-tavern 原码（该仓库为 AGPL，
   拉取全文比对本身不构成侵权，但本次未做；**如需精确界定 H1 的范围，可另行拉取对比**）

---

## 九、附：本次审计新增核实的事实

| 事实 | 旧认知 | 新核实 |
|---|---|---|
| `flizzywine/dsh-tavern` 许可 | MIT | **AGPL-3.0** |
| `agent-loop-rp` 许可 | MIT | **未声明** |
| `JS-Slash-Runner` 许可 | AFPL（已知） | **AFPL 确认**，且原文「not an Open Source license」 |
| `injection-store.ts` 归属 | 未定性 | **移植级**（新查出） |
| runtime 依赖树 | 旧清单称「约 170 包」 | **实际 503 包**，非宽松 0 个 |
| busybox 许可 | 未列 | **GPL-2.0**（新查出） |
