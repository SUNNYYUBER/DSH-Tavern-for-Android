# 生态冲刺（狂飙突进）—— 专项 Goal（2026-09-20 晚）

> **本文件是本阶段工作的唯一事实来源（SSOT）。**
> 判据哲学与纪律沿用 `docs/GOAL.md` §二（四件套缺一不可 / 未验证标未实测 / 失败必须出声 /
> 报告口径硬性）与 `docs/GOAL-PRESET-SWITCH-2026-09-20.md` 的全部边界；冲突时以 GOAL.md 为准。
>
> - 用户裁定（2026-09-20 晚，原话）：
>   「真机测试可以先放一边，但是别的理论上的东西我觉得不能因为等实机测试而停滞。
>   既然我们这个项目更多的是一个思路分析的性质，那么实机测试就更多的交给感兴趣的
>   开发者和用户吧，我们就我一个人，要想和 DSHA 那种有团队有专业人士的项目竞争，
>   就只能**狂飙突进**。」
> - 方向裁定（同日，四选全选）：插件生态基础设施 + MVU 生态深耕 + 补丁上游化 + 收眼前的尾。

---

## 一句话目标

**把上一轮攒下的知识资产（冲突类型学 / 门禁体系 / 验证方法论）转化为生态位基础设施，
以思路与工具的速度对冲团队型竞品的人力优势——实机验证全面众包，理论工作永不停滞。**

---

## 起点基线（2026-09-20 晚实测，不许沿用旧数字）

| 项 | 值 | 证据 |
|---|---|---|
| 最新发布 | **v0.2.0-beta.5**（pre-release，双架构 APK 资产齐） | GitHub releases |
| runtime sentinel | **v370**（含 P1 能力包 + 管线切换 + T2.3b） | NodeService.kt |
| vitest | 83 文件 / **1806 通过** / 2 skipped / 0 失败 | `cd rp-workspace/packages; npx vitest run` |
| 常驻门禁 | 48 项全绿 | build-dsht.ps1 Step 0.5 |
| npm 首发 | 脚本 + 门禁 + 元包就绪，dry-run 7 包全绿；**实际发布待 npm login** | scripts/publish-plugins.mjs |
| 社区插件实测 | 5 包金标准：session-pin ✅ / better-stats ✅ / turn-index ⚠ / outline ⚠ / zhipu-toolkit ❌ | PLUGIN-COMPAT §5.2 |
| 冲突类型学 | 9 类实测案例（含 ⑧ client face 投影 ×2、⑨ npm 发布缺陷） | PLUGIN-COMPAT §5.3 |

---

## 工作面 W-A：收眼前的尾（唯一阻塞面，等用户一个动作）

- [x] **A-1 npm 首发闭环（2026-09-20 晚 ✅）**：8 包全部发布——
  dsht-rp-plugin / dsht-plugin-mvu / dsht-plugin-tavern-helper / dsht-plugin-prompt-template /
  dsht-plugin-mobile / dsht-plugin-memory / dsht-rp-suite @0.2.0 + dsh-plugin-lint
  @0.2.1（0.2.0 首发时 bin 被 npm auto-fix 移除——新版 npm 要求 bin 不带 `./` 前缀，
  0.2.1 修复；npm pkg fix 实证）。过程纪实：web login → 发布 403（npm 新政策
  publish 强制 2FA/bypass token）→ Security Key 型 2FA 无 TOTP 码可走 →
  computer-use 操作创建 Granular Access Token（勾 Bypass 2FA + publish + 90 天）→
  写入 .npmrc → 7 包连发全过。
- [x] **A-2 正式版口径显式化（2026-09-20 晚 ✅）**：README 中英各加「验证面速查」表
  （能力 × 模拟器/小米真机/鸿蒙三列，每项标注实测/未实测/判读方式）；
  v0.2.0 正式版门槛已改为「npm 闭环 + 口径诚实」
  （NEXT-STEPS「正式版门槛」节，真机/稳定期已降级为社区众包项）。

## 工作面 W-B：dsh-plugin-lint（插件生态基础设施，主攻）——✅ 完成（2026-09-20 晚）

**定位**：把「DSH 插件在 Android/各 DSH 版本上能不能活」的判定从人肉实测变成
`npx dsh-plugin-lint <pkg>` 一条命令。生态里还没人占这个位置（bychv 之外无质量工具）。

**产物**：`rp-workspace/tools/dsh-plugin-lint/`（cli.mjs / lint.mjs / rules.mjs SSOT /
README），9 条规则（S1-S6 静态 + N1 嗅探⑧ + A1/A2 安卓预判），分面结论
（host / android / stability——分面是金标准回放逼出来的：session-pin 主功能走契约面 ✅
但增强面带防御地用了非契约投影，总档语义必须拆开才不与人工实测打架）。

**判据（四件套）——全部落实**：

- **正控（金标准回放）5/5**：session-pin/better-stats host+android=pass、
  turn-index/outline 命中 N1(⑧)、zhipu host=fail 命中 S1(⑨)——与 PLUGIN-COMPAT §5.2
  人工实测一致（`test/golden-replay.mjs`）。**回放过程抓到并修了 3 个工具缺陷**
  （S6 误报 ESM exports 形态 / S5 不支持 glob / N1 泛匹配误伤防御性使用）——
  金标准的价值实证；
- **负控**：我方 6 包 staging 零误报（`test/negative-own.mjs`；顺带抓到
  dsht-plugin-mobile 缺 cordis.patch.yml 的**真实发布缺陷**——publish staging 已补生成）；
- **产物核验**：`cli.mjs --selftest` 规则表 ↔ PLUGIN-COMPAT §5.3 编号机器对账（⑨⑧ 一致）；
  合成 fixtures 测试 11/11 绿（node --test）；
- **记账**：PLUGIN-COMPAT §四加「已机器化」注 + 第 0 条机器面；工具列入
  publish-plugins.mjs 包表（第 8 包，dry-run 全绿，pack 5 文件 / 8 KB）。

**边界**：本期只做**静态 + 嗅探**，不做动态加载实测（那需要设备/模拟器环境，
属安装器范畴——未来 UI 化插件安装器再议）。

## 工作面 W-C：补丁上游化清单（降维护成本 + 上游话语权）——✅ 完成（2026-09-20 晚）

**产出**：[PATCH-UPSTREAM-REVIEW.md](PATCH-UPSTREAM-REVIEW.md)——12 组语义条目的两栏分类。

- [x] **C-1 全量盘点**：对账口径 = `apply-platform-patches.py` `patch()` 20 处
  （audit-patch-markers.py 机器核验 marker 幂等健全）+ P2-1b 自定义块 + composition yml；
  build-dsht.ps1 的 14 处 Dsht-Patch 与 py 侧语义条目全重叠（两条构建路径的登记面）；
- [x] **C-2 两栏分类**：可上游 5 组（U-1 折叠行修复 ★★★ / U-2 标题剥标签 ★★★ /
  U-3 flock 单进程直通 ★★☆ / U-4 link→rename 回退 ★★☆ / U-5 Iterator 守卫 ★☆☆）；
  留本地 7 组（proot 包装 / sandbox 降级 / bash argv / fs-search 兜底 / term shell /
  compression 配置 / SIM 组），逐条带「为什么不可上游」一句论证；
- [x] **C-3 PR 草案**：U-1~U-5 每条带标题/问题/方案/兼容性骨架；行动建议
  （先提 U-1/U-2 零平台分支项；U-3/U-4 以能力探测/失败回退形态提）。

**判据**：盘点 = 门禁登记面对账 ✓；每条有论证 ✓；README 文档索引已登记（中英双行）✓。
实际提 PR 的时机由用户定（涉及对外沟通节奏）。

## 工作面 W-D：MVU 生态痛点调研（先调研后动手）——✅ 完成（2026-09-20 晚）

**产出**：[MVU-PAINPOINTS-2026-09-20.md](MVU-PAINPOINTS-2026-09-20.md)——三面调研，
全部痛点带代码证据（行级引用 + grep 零命中证明）：

1. **状态栏模板**：渲染链完整但**前端对 PUT /dsht-mvu/statusbar 零调用**——
   模板编辑 UI 缺失，高频定制面断在「会手写 JSON」门槛 ⇒ **建议做（下轮首选）**；
2. **变量树编辑**：RpStateView/RpTablesView 头注双只读声明，写路径只有 LLM 一条——
   三真实场景（纠错/改设定/调卡）⇒ **建议做「变量点值编辑」**（走 LLM 同款落账管线）；
   「回滚/快照」**缓议**（dsht-plugin-undo 取舍先评估，不重复造）；
3. **卡内脚本调试**：MVU 通知**缺省全关**（ST 兼容语义）+ loadError 无可达 UI——
   D8 toasts 基础设施已建只是默认黑 ⇒ **建议做「调试模式」开关**（零新管线）。

**判据**：每痛点有证据 ✓（无一处「我觉得」）；「做什么/不做什么」表 ✓；
排期建议（调试模式 → 模板编辑 → 点值编辑，按基础设施已备程度从易到难）✓。
动代码是下一个 goal 的事（本面只交付调研）。

---

## 边界（明确不做）

- **B-1**　实机验证全面众包：真机/鸿蒙执行项永不阻塞本 goal 任何工作面；
  Agent 侧只维护判据与手册（B-DEVICE 清单保持开放回填）。
- **B-2**　不追 DSHA 功能表 / 不做 Shizuku / computer use（GOAL.md §六 照旧）。
- **B-3**　不押注原生鸿蒙 NEXT（无 AOSP 形态）；卓易通叙事维持现状即可。
- **B-4**　dsh-plugin-lint 本期不做动态实测面（见 W-B 边界）。
- **B-5**　MVU 深耕本期只调研不写功能代码（见 W-D 判据）。

---

## 纪律（沿用，摘最相关的四条）

1. **四件套缺一不可**：判据（含正负控）/ 产物核验 / 设备实测（本期=模拟器或 PC 侧）/ 记账。
2. **金标准回放即测试**：W-B 的正控设计——人工实测结论就是测试集，工具必须与之一致。
3. **防两份真相漂移**：lint 规则 ↔ 冲突类型学编号必须机器对账（一处新增，另一处必同步）。
4. **失败必须出声**：lint 误报/漏报、上游化被官方拒、调研发现「痛点不成立」——都如实记录，
  不写「进展顺利」式水文。
