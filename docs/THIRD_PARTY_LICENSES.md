# 第三方组件许可清单（THIRD_PARTY LICENSES）

> 建立日期：2026-09-03（⑦ 许可证核对）
> 最近更新：2026-09-20（§3c 新增 dsh-preset-enhance 条目；此前 2026-09-14 全量版权审计复核，
> 审计报告见 [COPYRIGHT-AUDIT-FULL-2026-09-14.md](COPYRIGHT-AUDIT-FULL-2026-09-14.md)）
>
> 覆盖范围：**DSHTavern APK 实际打包再分发**的全部第三方组件。
> 扫描方法：遍历运行时 `node_modules` 全量 `package.json` 的 license 字段（含嵌套），
> 逐包核对；内嵌二进制逐个溯源。
>
> **结论：全部打包组件均为宽松许可（MIT / ISC / BSD-3-Clause / Apache-2.0 / Python-2.0 /
> MIT+GPL 双许可选 MIT），无 copyleft 代码与我们代码链接，可再分发。**
> 唯一的 copyleft 组件是 busybox（GPL-2.0），以**独立可执行文件**形态随包分发
> （属「聚合」而非「衍生」），其义务见 §5。

## 1. DSH 官方运行时（DeepSeek 官方程序，APK 主体）

- **@deepseek-ai/dsh 全家桶**：**MIT** —— 含 dsh/dsh-agent-loop/dsh-client-runtime/
  dsh-client-ui-*/dsh-compaction/dsh-llm-* 等全部 dsh-* 包
- **cordis / cosmokit / schemastery 及 cordis-plugin-\***：**MIT**
- **node-addon-landlock-run**（原生沙箱插件）：**BSD-3-Clause**

## 2. 运行时传递依赖（node_modules 全量扫描）

2026-09-14 全量复核：**503 个包**，非宽松许可命中数 **0**。

- 绝大多数：**MIT / ISC / Apache-2.0**（@aws-sdk 系列 / @opentelemetry 系列 = Apache-2.0，
  @mistralai/mistralai = Apache-2.0，body-parser / type-is / open = MIT，
  @earendil-works/pi-ai = MIT）
- **argparse**：**Python-2.0**（PSF 许可，BSD 风格宽松许可，允许再分发）
- 扫描结果里的 9 项「license: NONE」全部是**本项目自研包**（未在 package.json 写 license
  字段），非第三方依赖 —— 不构成许可风险

## 3. 客户端 vendor（th-vendor / host-vendor，构建期内嵌）

构建期打包进 `th-vendor.gen.txt` / `th-host-vendor.gen.txt`，运行时注入页面：

| 包 | 版本 | 许可 |
|---|---|---|
| jquery | 3.7.1 | MIT |
| jquery-ui | 1.13.3 | MIT |
| zod | 4.5.4 | MIT |
| yaml | 2.9.0 | ISC |
| lodash | 4.18.1 | MIT |

> 版本以 `scripts/vendor-deps.json` 为准（构建前由 `scripts/vendor-deps.mjs` 自愈复核）。
> **本表恰为那 5 个**——`vendor-deps.json` 的 `anchors` 即这 5 项，`th-vendor.gen.txt` /
> `th-host-vendor.gen.txt` 内不含其它包。
>
> 【2026-09-14 E-H 审计订正】原表把 **jszip** 列在此处，属**分类错误**：`vendor-deps.json`
> 无 jszip，两份 vendor 产物内 grep `jszip` 零命中。jszip 是 **node 侧**依赖
> （`packages/package.json` 的 `dependencies`，供导入引擎 `import/*.ts` 解析 zip 用），
> 见 §2。

## 3b. node 侧运行时依赖（打包进 dsh-runtime，非客户端 vendor）

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) —— **选 MIT** | 导入引擎解 zip（卡 / 聊天记录 / 预设包） |


## 3c. 第三方 DSH 插件（随包分发）

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| **dsh-preset-enhance** | 0.3.2-rc.1 | **MIT**（作者 [bychv](https://github.com/bychv)） | SillyTavern 预设的加载 / 编辑 / 注入（侧栏「预设工作台」、prompt_order 顺序表注入、ST 宏引擎、assistant_prefill 预填充、DSML 工具转换、/preset 命令） |

> 自 v0.2.0-beta.3 起随 APK 分发（`node_modules/dsh-preset-enhance`，构建期由
> `build-dsht.ps1 -PresetEnhanceVersion` 从 npm 拉取，未经任何修改）。
> 与 RP 自带的预设快照管线**并存**（它默认只承担被显式启用的会话）；
> RP 会话的预设注入切换计划见 [T-88 §五](T-88-PLUGIN-DECOMPOSITION.md)。

## 4. 内嵌第三方（APK 内）

| 组件 | 许可 | 来源 | 备注 |
|---|---|---|---|
| **Node.js** 二进制 | MIT | Termux deb | 运行时本体 |
| **proot** | GPL-2.0 | Termux deb | ⚠️ **独立可执行文件**，未与我们代码链接（聚合分发） |
| **busybox** | GPL-2.0 | Termux deb | ⚠️ **独立可执行文件**，未与我们代码链接（聚合分发）——义务见 §5 |
| **ICU**（Node 内置） | Unicode License | Node.js | 宽松 |
| **PDF.js**（经 `dsh-client-ui-sidebar-documentpreview` 内嵌） | Apache-2.0 | DSH 官方包 | 文件头保留完整 license notice |

> **★ 分发层级说明（T-25b 2026-09-19）**：上表这些二进制**曾随本仓库入库**（14 个 `.so`，约 100MB），
> 现已改为**构建期获取** —— `rp-workspace/scripts/fetch-native-libs.mjs`
> 从 Termux 官方源 deb 提取 + **逐包 SHA256 校验**（可完整重建，实测逐字节一致）
> ⇒ **Git 仓库本体不分发任何第三方二进制**。
> ★★ **但 APK 产物仍然包含它们**（技术必需：SELinux 只允许从 `nativeLibraryDir` 执行）
> ⇒ 下面 §5 的义务分析**依然适用**。两条分属**不同层级**（仓库 / 产物），不要混淆 ——
> 「仓库不分发」不等于「产物不分发」。

## 5. ⚠️ busybox（GPL-2.0）的合规处置

**事实**：`rp-workspace/android/**/jniLibs/*/libbusybox.so`（实为 busybox 二进制改名，
因 SELinux 只允许从 `nativeLibraryDir` 执行）**随 APK 分发**
（★ 该文件**不在 Git 仓库里**，构建期由 `fetch-native-libs.mjs` 从 Termux deb 提取）。
GPL-2.0 要求随分发**提供对应源码，或提供获取源码的书面要约**。

**我们的处置**：

1. **性质认定**：busybox 是**独立可执行文件**，通过进程 `exec` 调用，与我们的
   TypeScript/JavaScript 代码**不构成链接**，属 GPL 意义上的「聚合（aggregate）」
   而非「衍生作品」⇒ **其 copyleft 不传染本项目自身代码**，MIT 授权不因此改变。
2. **源码获取方式**（满足 GPL-2.0 §3）：
   - 上游：<https://busybox.net/downloads/>
   - 分发形态来源：**Termux** 的 `busybox` 包 —— <https://github.com/termux/termux-packages/tree/master/packages/busybox>
   - 构建脚本与补丁同在上面的 `termux-packages` 仓库中
3. **书面要约**：如需我们将构建 busybox 所需的完整对应源码（含 Termux 补丁）
   一并提供，请通过 Issue 提出，我们会提供下载地址或按需打包。

> **声明**：本项目不对 busybox 做任何修改；仅原样分发其二进制。

## 6. 自研代码的格式兼容声明（非许可项，法律边界备注）

- **SillyTavern 格式兼容**（正则脚本 / OpenAI Settings 预设 / 角色卡 PNG-JSON / 聊天
  jsonl）：为**自研实现**（`packages/src/regex/engine.ts`、`preset/st-import.ts`、
  `import/*.ts`），仅对齐**文件格式与字段语义**，**未复制 ST 源码**。
  SillyTavern 本体为 AGPL-3.0，本仓库不含其任何源码，其 copyleft 不传染本项目。
- **酒馆助手（JS-Slash-Runner）脚本兼容层**：API 面自研复刻（`dsht-rp-ui/th-shim.ts` +
  `dsht-plugin-tavern-helper`），**未打包、未复制其源码**；MVU 等第三方脚本由
  **运行时经 CDN 加载**（用户侧行为，其许可与分发责任归原作者）。
- **ST 事件名表**（`st-event-types.gen.ts`，104 条）：属**接口契约数据**（API 名称，
  不受版权保护的接口事实），且带生成器与来源行号，未复制 ST 源码实现。

## 7. 参考项目致谢（思路 / 语义对照来源，均已核实许可）

> 2026-09-14 全量审计后，**强 copyleft 与无许可项目的全部具体引用已用自研方式等效重写**。
> 下列项目现仅作为「思路来源」被致谢，或保留其 **MIT** 归因注释。

### 7.1 MIT 项目（保留归因注释，符合署名义务）

- **`hewzhew/dsh-agent-rp`**（MIT）：三段编译语义、宏引擎单引擎设计、EJS 沙箱形态等
- **`aam452/dsh-worldbook`**（MIT）：世界书定时效果 / group 互斥 / 时间游标语义对照
- **`Czerror/dsh-plugin-prompt-tool`**（MIT）：ST 预设字段映射对照
- **`lutrodev/dsh-roleplay`**（MIT）：架构决策对照（零私有事件 / 遮蔽 / ancestry）

### 7.2 已重写、现无引用

- **`flizzywine/dsh-tavern`**（**AGPL-3.0**）：早期曾参考其 display 编译与 iframe 骨架。
  2026-09-14 已完成自研重写——替换产物占位标记形态、替换串求值实现、iframe 骨架结构
  **全部为本项目独立实现**，代码中不再保留任何指向该项目的引用或表达复制。
- **`2428139739pregnant-web/agent-loop-rp`**（**未声明许可** = 保留所有权利）：
  早期曾参考其模板注入 store 的语义。2026-09-14 已完成自研重写——上限常量、条目结构、
  排序与覆盖逻辑**全部为本项目独立实现**，代码中不再保留任何指向该项目的引用。
- **`JS-Slash-Runner`**（**AFPL**）：从未复制其源码；API 面为自研复刻（见 §6）。

## 8. 待办（发布工程阶段）

- [x] 正式许可文件落位：仓库根 `LICENSE`（自研部分 MIT）
- [x] busybox 条目补充（§5）
- [x] AGPL / 无许可项目的具体引用重写（2026-09-14 完成）
- [ ] 若未来引入任何 GPL/AGPL **代码链接**依赖 → 回到本清单重新评估（当前为零）
