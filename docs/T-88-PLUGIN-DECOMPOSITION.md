# 插件全量拆包方案（T-88 · 已实施）

> **状态**：✅ **构建层已实施（2026-09-19）**。本方案的方案部分保留作决策记录；
> 实施结果与两处方案修订见 §八。
> **触发**：外部评审建议「把插件按功能拆分成不同的包来维护（继续用 monorepo）」，用户 2026-09-19 拍板「全量拆包」。
> **与 T-87 的关系**：T-87（2026-09-13）把 R10 四插件并入总包 `dsht-rp-plugin`，本方案是它的**有条件反转** —— 前提变化记录于 §1，不是推翻当时的判断。
> **联动**：预设机制将在适配 DSH 新版本（≥ 0.1.5-rc.2）时切换为外部包 [bychv/dsh-preset-enhance](https://github.com/bychv/dsh-preset-enhance)（用户 2026-09-19 拍板「长期肯定引入，先把两边 DSH 版本同步」）。

---

## 一、为什么现在拆（前提变化）

T-87 合并的三个前提，两个已经变化：

| T-87 时（2026-09-13） | 现在（2026-09-19） |
|---|---|
| 纯个人项目，无协作者 | bychv 已成为 collaborator，主攻预设；他的插件（dsh-preset-enhance）就是独立包形态 —— **协作界面天然是「包」** |
| DSHTavern 是唯一消费方（APK 单体分发） | 预设机制将外移给独立包；其余功能（MVU / 酒馆助手 / 世界书 / 记忆）对 PC 端 DSH 部署同样有独立价值 |
| 维护面最小化优先 | 生态化与分工优先（但维护成本仍是约束，见 §6） |

保留不变的 T-87 正确判断：官方 ~135 条插件行不可动；手机端插件管理界面条目数主要由官方贡献（拆包后我方从 1 行回到 6-7 行，可接受）。

## 二、包划分

monorepo 留在 `rp-workspace/packages/src/`，每个包独立构建产物、可独立 compose、可独立发布 npm。

| 包名 | 内容 | 现状 |
|---|---|---|
| `dsht-rp-plugin` | RP 宿主：会话数据面（/rp/session-* 路由）、注入管线（assemble/pre-step 组装）、导入引擎、资产树 | 现总包拆分后的主包 |
| `dsht-plugin-mvu` | MVU 变量体系（UpdateVariable / JSONPatch / initvar / stat_data 双树） | T-87 前有独立构建，恢复 |
| `dsht-plugin-tavern-helper` | 酒馆助手桥接（TH API 面 / tavern_events 82 项 / 脚本管理） | 同上 |
| `dsht-plugin-prompt-template` | 提示词模板（EJS 沙箱 / 注入 store） | 同上 |
| `dsht-plugin-memory` | 剧情记忆 | 同上 |
| `dsht-plugin-mobile` | 移动端适配（node 空壳 + client） | 已独立构建 |
| `dsht-plugin-undo` | 通用回退（文件截断路径） | **已是独立包**（dist/ 产物 + 独立发布形态），作为拆包参照样板 |
| `dsht-rp-ui` | 客户端 UI（React bundle，`dsh.client` 声明） | 现内联在总包 lib/client.js，拆为独立包 |
| `dsht-plugin-shared` | 共享库（session-write / host-projection / file-snapshots / macros 等） | **不发布**，构建期 esbuild bundle 内联进各包产物（源单源、产物内联，无漂移面） |

依赖方向（禁止反向）：`shared` ← 各功能包；`dsht-rp-plugin`（宿主）不依赖功能包，功能包也不依赖宿主（经共享层与官方事件面通信）。UI 包依赖共享层的 host-projection 读取器。

## 三、构建改造

现状（T-87）：`rebuild-plugins.ps1` / `build-dsht.ps1` 把 `src/dsht-rp/index.ts`（总包入口）bundle 成一个 `dsht-rp-plugin/lib/index.js`（1090 KB，含 4 个子模块内联）。

改为：

1. **每包一个 bundle**：`packages/src/<pkg>/index.ts` → `dsh-runtime-android/node_modules/<pkg>/lib/index.js`（esbuild bundle，shared 内联）。cwd 不变量沿用（`$ws\packages`，产物哈希可复现）。
2. **每个包一个 package.json**：`name / version / type: module / main / exports['./client']（有 client 的包）/ dsh.client（UI 包）/ engines.dsh`。
3. **cordis.patch.yml**：`NodeService.pluginRows` 从 1 行（dsht-rp-plugin）回到 6 行（各包一行）。`dsht-plugin-undo` 维持不 compose（现行为）。
4. **T-87 的 verify-rp-consolidation 测试**（15 判据，断言总包含 4 个子模块）**反转**：改为断言各包**独立产物存在**且**互不内联其他功能包**（防「名义拆包、实际还是一个 bundle」的形式主义拆分）。等价性判据（产物与现场重编译逐字节一致）保留。
5. **EJS worker / app.js 资产**：跟随其归属包（prompt-template / rp-plugin）的产物目录。

## 四、npm 发布形态（照 bychv/dsh-preset-enhance 的成熟做法）

- **版本策略**：各包独立版本号，但 **DSH 兼容窗一致** —— `engines.dsh: ">=0.1.5-rc.2 <0.1.6"`（对齐 bychv 的钉法；适配新版 DSH 时统一升窗）。
- **发布内容**：`files: ["index.mjs"|"lib", "client.js"?, "cordis.patch.yml", "README.md"]`；不含 monorepo 内部测试与源码（产物自包含）。
- **安装形态**：`dsh plugin --profile web add dsht-plugin-mvu@<ver>` 单包可装；另出一个 **`dsht-rp-suite` 元包**（仅 dependencies 声明全套）保留 T-87「PC 端一行装齐」的诉求。
- **发布权限**：在适配新版 DSH、包产物稳定之后再发首个 npm 版本；之前只保证「可独立 compose」（本地 file: 安装可用）。

## 五、预设机制外移（联动项；**第一步已于 2026-09-19 完成**）

> **状态更新（2026-09-19）**：bychv 证实 rc.1 → rc.2 无破坏性更新（依赖集 72=72 完全一致，
> 已用 npm 依赖对账实证），版本阻塞解除。`dsh-preset-enhance@0.3.2-rc.1` **已接入构建与部署**：
> `build-dsht.ps1` 的 `-PresetEnhanceVersion` 参数（Step 1 依赖声明）+
> `NodeService.copyPackageTree`（整包幂等同步）+ patch 新增 `preset-enhance` 行。
> **默认配置下与 RP 的 pre-step 快照管线不冲突**（它只在会话被显式启用或命中自动启用
> 模式时编译；RP 会话走我方快照）。以下第 2-4 步待真机验证后执行。

1. ~~runtime 升级到 ≥ 0.1.5-rc.2~~（已解除：rc.1/rc.2 依赖集完全一致，bychv 包已在 rc.1 接入）
2. **待真机验证后**：DSHTavern profile 的 RP 会话**关掉** dsh-plugin 的预设快照管线（`withPresetLayer`），保留世界书 / 角色卡 persona / 正则 / 状态树分支。
3. **必须实测的兼容面**（调研结论，2026-09-19）：
   - 注入冲突：同一预设不得被两条管线各注一遍（RP 会话里手动 /preset on 后的行为要实测）
   - 模式选择：RP 场景用「普通模式 + 预设注入叠加」，**不用**其独占「预设模式」（它会移除身份 prompt，角色 persona 会丢）
   - 变量划界：预设宏 `setvar` 归其 store，MVU `UpdateVariable` 归 stat_data，实测互不干扰
   - DSML 工具转换 vs 酒馆助手桥接的 tool_calls 兼容性
4. 切换后，预设相关的 UI（PresetPanel）改为对接其 `/preset-enhance/*` 数据面（或引导至其工作台），导入管线（st-import）保留作为其导入源。

## 六、成本与节奏（诚实评估）

- **版本矩阵**：N 个包 × DSH rc 节奏。DSH 每发 rc，所有包要跟发（bychv 当前也是这个节奏）。缓解：engines 窗口统一、发布脚本统一（`scripts/publish-plugins.mjs`，新建）。
- **T-87 诉求兜底**：手机端插件行 1 → 6-7（官方 ~135 不变）；「PC 一行装齐」由元包 `dsht-rp-suite` 兜住。
- **执行顺序**（建议，每步独立可验收）：
  1. 本方案拍板
  2. 构建脚本改造（每包一 bundle + 各 package.json）+ T-87 测试反转 —— **纯构建层，不改任何功能代码**
  3. cordis.patch.yml 6 行化 + 模拟器验证（插件列表出现 6 个 dsht 条目，功能回归）
  4. 适配 DSH ≥ rc.2：runtime 升级 + bychv 包集成（§五）
  5. 首个 npm 版本发布（含元包）
- **明确不做**：shared 不发布；功能代码不因拆包而改写（拆包只动构建与部署形态）；undo 维持现状（已是独立包，不 compose）。

## 七、验收标准

- 每个包在干净 DSH 部署（PC web profile）可单独 `dsh plugin add <path>` 并生效
- DSHTavern 全量回归：`packages/` 下 `npm run test` 全绿 + 模拟器 M4 旅程通过
- 产物等价性：各包产物与现场重编译逐字节一致（沿用 A14 新鲜度闸门）
- 名义拆包防线：任一功能包的产物中不得出现其他功能包的模块标记（T-87 测试反转后的新判据）

---

## 八、实施结果（2026-09-19，构建层完成）

### 8.1 关键发现（实施时才查明，改变了工作量）

**权威构建路径一直都是独立包形态。** `build-dsht.ps1` 的 Step 4.7（`src/dsh-plugin/index.ts` → 主插件）
与 Step 4.72（R10 四插件各自 esbuild）从未走过总包；`build-plugins.sh` / `build-wb.sh` 同。
**T-87 总包只存在于 `rebuild-plugins.ps1` 一条路径**（`src/dsht-rp/index.ts` 薄壳聚合）。
⇒ 上一轮任务中「R10 四插件旧产物 + patch 6 行 = 疑似双重注册」的判断**是误报**：
APK 里从来没有总包，六个插件各自加载、各 apply 一次，无重复。

⇒ 「全量拆包」的实际工作 = 把 rebuild-plugins.ps1 对齐到与其他三条路径一致的独立包形态，
而不是「把总包拆开」。`src/dsht-rp/index.ts`（总包入口）已删除。

### 8.2 两处方案修订（与原 §二/§三 的差异）

1. **`dsht-rp-ui` 不拆，保持并入 `dsht-rp-plugin`**（原方案 §二 列为独立包）。
   理由：UI 的全部面板依赖 RP 数据面路由，与主插件是「host + client 双面一体」
   （bychv/dsh-preset-enhance 同款形态）；三条构建路径的现共识也是并入；
   拆出要反转 boot graph 与 NodeService 的 legacy 清理，风险大收益小。
2. **「不含子模块」判据收窄到「不含 R10 插件入口 `index.ts`」**（原 §三.4 的「模块标记」过粗）。
   主插件对 R10 各包**共享模块**有正当 import（`prompt-template/ejs.ts`、`sandbox.ts`、
   `memory/tables.ts`、`tavern-helper/macros.ts`——与 dsht-plugin-shared 同性质的源码级复用），
   esbuild 内联它们不等于「总包」。首跑误报后收窄口径。

### 8.3 实施清单（全部落地）

- `rebuild-plugins.ps1`：entry 回到 `src/dsh-plugin/index.ts`；R10 四包恢复独立构建；
  ejs-worker 落 `dsht-plugin-prompt-template/lib/`（与权威路径一致）；
  R10 各包写入 `dsh.bundle.patch` 声明 + 各自 `cordis.patch.yml`（PC 可 `dsh plugin add`）
- `build-dsht.ps1`：R10 各包同步 dsh.bundle.patch + patch 文件；Step 4.7 补 cordis.patch.yml 拷贝
- `src/dsht-rp/index.ts` 删除；`cordis.patch.yml` 迁移至 `src/dsh-plugin/`
- `verify-rp-consolidation.mjs` 重写为 **T-88 拆包完整性 9 判据**（总包退役 / 主插件独立 /
  R10 在场且不交叉 / worker 自洽 / 双面形态 / pluginRows 顺序齐全 / 动态行为 /
  PC 可装性 / 权威路径形态可解析）+ 解析器自证 + 反控（注入子模块入口注释 ⇒ 判据 2 报红 ⇒ 还原）
- **顺带修了一个两种形态下都存在的漏拷**：`NodeService` 此前不拷 `ejs-worker.js`
  （worker 缺失时 EJS **静默**退化同步渲染），现已补上
- `NodeService` 的 R10 package.json 与构建脚本同字段（防两侧漂移）

### 8.4 验证

`verify-rp-consolidation` 9/9 + parser 自证 8/8 + 反控成立；
typecheck 三档绿；vitest 82 文件 1802 通过。

### 8.5 执行顺序（§六）状态

1. ✅ 方案拍板（2026-09-19）
2. ✅ 构建层改造 + T-87 测试反转（2026-09-19）
3. ⏳ cordis.patch.yml 行化 + 模拟器/真机验证（随 beta.3 出包验证）
4. ⏳ 适配 DSH ≥ rc.2：bychv 包管线切换（§五，已部分前置完成——包已接入构建）
5. ⏳ 首个 npm 版本发布（含 `dsht-rp-suite` 元包）
