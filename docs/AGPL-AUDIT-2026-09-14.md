# AGPL / 无许可参考代码核查清单（2026-09-14）

> **背景**：`docs/archive/REF_PROJECTS_COMPARISON.md` L4 声称「六参考项目（**全 MIT**）」。
> 2026-09-14 逐个核实 LICENSE 原文，发现**该声明有两处错误**，其中一处涉及 copyleft 传染。
>
> **本清单是事实陈述，未做任何代码改动。等用户决定处置方式。**

---

## 一、许可核实结果（逐个拉取 LICENSE 原文）

| 项目 | 旧文档声称 | **实测许可** | 判定 |
|---|---|---|---|
| `hewzhew/dsh-agent-rp` | MIT | **MIT** | ✅ 一致 |
| `lutrodev/dsh-roleplay` | MIT | **MIT** | ✅ 一致 |
| `aam452/dsh-worldbook` | MIT | **MIT**（README 协议节亦标 MIT） | ✅ 一致 |
| `Czerror/dsh-plugin-prompt-tool` | MIT | **MIT** | ✅ 一致 |
| `flizzywine/dsh-tavern` | MIT | **AGPL-3.0** | 🔴 **文档写错** |
| `2428139739pregnant-web/agent-loop-rp` | MIT | **未声明任何许可** | 🔴 **文档写错** |

**agent-loop-rp README 原文（相关段落逐字）**：

> 本仓库目前未声明正式开源许可证，使用和再分发前请先确认项目维护者的许可安排。

按版权法默认规则，**未声明许可 = 保留所有权利**（并非"免费使用"）。

---

## 二、受影响代码清单（逐文件核实，标注实际引用程度）

### A. 涉 `dsh-tavern`（AGPL-3.0）

| # | 文件 | 引用内容（源码注释自述） | **实际程度** | 风险 |
|---|---|---|---|---|
| A1 | `dsht-rp-ui/src/client/display-compiler.ts` | 私用区 token 隔离（`presentationToken` 形态）、`replacementFor` 替换串求值、防空白守卫、iframe 文档骨架（注释写"移植 L883-941"） | 🟠 **移植级**：token 形态 `\uE000...\uE001` 与 `clamp [48,12000]`（我们改成 3000）等具体数值/结构一致 | 高 |
| A2 | `dsht-plugin-shared/file-snapshots.ts` | `nativeCommits` 按 turn 记 before 快照、回退整批恢复 | 🟡 **思路级**：落到**文件维度**（他们是内存对象），API 与数据结构均为自研 | 中 |
| A3 | `dsht-plugin-mobile/client/style.ts` | 移动端 CSS 五件套（100dvh / grid 轨道锁定 / left 抽屉 / safe-area / 触控 ≥38px） | 🟡 **方案级**：CSS 属性组合属通用实践，但注释自述"参考 client.js" | 中 |
| A4 | `dsht-plugin-mobile/client/anchors.ts` | `data-sidebar-collapsed` 状态钩子、CSS 类名同源约定 | 🟢 **约定级**：仅使用相同的属性名/类名约定 | 低 |
| A5 | `dsh-plugin/index.ts:2104,5533` | 注释提及 nativeCommits 思路 | 🟢 **注释级**：仅注释 | 极低 |

### B. 涉 `agent-loop-rp`（无许可）

| # | 文件 | 引用内容 | **实际程度** | 风险 |
|---|---|---|---|---|
| B1 | `dsht-rp-ui/src/client/display-compiler.ts` | SVG 标签白名单扩展 | 🟢 **事实级**：SVG 标签名是 HTML 规范的标准名称，非创作性表达 | 低 |
| B2 | `dsht-plugin-shared/output-protocol.ts:161,174` | SVG 标签白名单 | 🟢 同上 | 低 |
| B3 | `dsht-plugin-prompt-template/sandbox.ts:7,20` | 注释列为"参考实现" | 🟢 **注释级**：且**实际弃用**了它的方案（选 node vm 而非 quickjs-emscripten），未引入其代码 | 极低 |
| B4 | `dsht-plugin-prompt-template/injection-store.ts:5` | 注释标"出处：agent-loop-rp src/ejs-template.ts" | 🟡 **需进一步核实**：见下方"待核实项" | 待定 |

---

## 三、待核实项（本清单未完成的部分）

1. **B4 `injection-store.ts`** —— 该文件注释写着「出处：agent-loop-rp」，
   但未说明是"照搬实现"还是"借鉴思路"。需逐行对比后才能定性。
2. **A1 `display-compiler.ts` 的完整范围** —— 已确认 token/替换串求值/iframe 骨架三处，
   但文件 500+ 行，需完整核对其余部分（三段编译来自 dsh-agent-rp，属 MIT，需拆分清楚）。
3. **是否还有其他文件间接引用** —— 本次用项目名关键字扫描（含 `flizzywine` /
   `2428139739pregnant` / `agent-loop-rp` / `dsh-tavern`），若原引用未写项目名
   则扫不到。**存在漏检可能**。

---

## 四、法律层面的判断（供决策参考，非法律意见）

### AGPL-3.0 的传染性

- AGPL 属**最强 copyleft**：衍生作品（derivative work）必须以 AGPL 发布
- 与我们当前 **MIT** 目标**直接冲突**：MIT 不是 AGPL 兼容许可
- **关键判断点**：引用程度是否构成"衍生作品"

| 情形 | 通常认定 |
|---|---|
| 逐字复制代码（含改改变量名） | 衍生作品，受 AGPL 约束 |
| 复制具体实现细节（如特定的 token 分隔符、魔数、注释结构） | 倾向认定为衍生作品 |
| 仅借鉴**思路/算法/架构**（思想不受版权保护） | **不**构成衍生作品 |
| 使用通用实践（如 CSS `100dvh`） | **不**构成 |

### 无许可项目（agent-loop-rp）

- 无许可 ≠ 免费。**保留所有权利**是默认状态
- B1/B2（SVG 标签名）属**事实性内容**（HTML 规范的标准标签名），通常不受版权保护
- B3 已弃用其方案，风险极低
- **B4 需核实后才能定性**

---

## 五、处置选项（等用户决定）

| 选项 | 做法 | 代价 | 风险残留 |
|---|---|---|---|
| **① 先核查再定点重写**（用户已倾向） | 完成第三节的待核实项；对"移植级"的 A1 做独立重写，其余保留 | 中（重写 A1 约 500 行） | 低 |
| ② 全部重写 | A1~A3 全部独立重写，与 AGPL 彻底脱钩 | 高（可能引入回归） | 极低 |
| ③ 只改标注 | 不重写，把注释/文档的"MIT"改对，并声明关系 | 低 | 🔴 高（AGPL 传染未解） |
| ④ 移除引用 | 删除 A1/A2/A3 相关功能（display iframe 渲染 / 文件快照回退 / 移动端五件套） | 极高（功能倒退） | 极低 |

---

## 六、附带发现：README 致谢缺失

`REF_PROJECTS_COMPARISON.md` 第四部分有一份**完整六项目致谢表**，并明确写着
「**必须进 README（用户定案"非常非常重要"）**」。

**当前 README 致谢只有 4 项**（DeepSeek / SillyTavern / TauriTavern / 酒馆助手），
**这 6 个实际参考过的项目一个都没有**。无论许可如何处置，致谢都应当补全。
