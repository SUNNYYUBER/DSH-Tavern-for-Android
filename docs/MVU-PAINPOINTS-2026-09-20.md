# MVU 生态痛点调研（GOAL-ECO-SPRINT W-D，2026-09-20）

> 判据：每个痛点必须有真实案例或代码证据，不写「我觉得用户可能需要」。
> 本文是**调研交付物**——动代码是下一个 goal 的事。证据全部指向仓库内可核对位置。

## 背景：MVU 在 DSHTavern 的现状（一句话）

提取链已完整（T2.3b 后 direct 卡也工作），消费链已通（状态栏渲染/变量注入/表格渲染），
**缺口集中在「人对变量的直接操作」与「出问题时的可见性」**——三面的共同主题。

---

## 面一：状态栏模板（template 的编辑面缺失）

**现状（证据）**：

- 渲染链完整：`dsht-plugin-mvu/index.ts` 的 `renderStatusbarHtml`（宏引擎 + HTML 转义 +
  换行 → `<br>`），配置存取 API 已存在（`GET/PUT /dsht-mvu/statusbar`，
  mvu-settings.json 的 statusbar 键，模板键 template/content/text 取首个字符串）；
- 前端**只有消费**：[RpNativeChat.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpNativeChat.tsx)
  与 output-protocol.ts 只调 `GET /dsht-mvu/statusbar-render`——**全前端无一处 PUT 调用**
  （grep `PUT.*statusbar` 零命中）。

**痛点**：用户想改状态栏模板（换布局/加字段/调样式）只能手写 mvu-settings.json——
MVU 生态里状态栏模板是卡作者与玩家的**高频定制面**（ST 生态里模板随卡分发、玩家常改），
没有编辑 UI = 这条高频路径断在「会编辑 JSON 的人」门槛上。

**证据强度**：API 在前端零调用（机器可核）+ MVU 卡普遍自带模板（社区共识形态）。

**建议**：**做**——状态栏模板编辑面板（读 PUT /dsht-mvu/statusbar 已有 API），
预览用现有 statusbar-render 即得。工作量小（API 全在，只差 UI）、收益高频。

## 面二：变量树编辑（人对变量的写路径只有 LLM 一条）

**现状（证据）**：

- [RpStateView.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpStateView.tsx)
  头注明文「MVU 状态树，**只读**；JSON 视图：只读格式化文本」；
- [RpTablesView.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpTablesView.tsx)
  头注明文「只读，不提供编辑——写侧走 tableEdit 指令/step-summary 路由」；
- 写路径现状：全部经 LLM 输出 `<UpdateVariable>`/`<JSONPatch>` 或 tableEdit 指令——
  **人没有直接改变量的入口**。

**痛点**：三个真实场景（RP 玩家高频）——
① LLM 写错变量（记错角色好感度/物品），玩家想手动纠正；
② 回档/改设定（「我不想要这个状态了」），现在只能求 LLM 改；
③ 调试自己的卡（作者验证变量流），改一个值要看效果得走一轮对话。

**证据强度**：两处只读声明（代码头注）+ 写路径唯一（LLM 指令）。

**建议**：**做，但分两级**——
  ① 先做「变量点值编辑」（路径定位 → 改值 → 走与 LLM 相同的 state_update 落账管线，
  保证游标/去重语义一致）；② 「回滚/快照」**缓议**——dsht-plugin-undo 已存在
  （有意不 compose，README「关于 DSH」节），激活它 vs 新做的取舍要先评估，不在本期。

## 面三：卡内脚本调试（报错可见性默认全黑）

**现状（证据）**：

- MVU 通知开关**缺省全关**：[RpScriptHost.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpScriptHost.tsx)
  `notifySwitchesLoaded`——设置读取失败/键缺省 = `{failure:false, success:false}`，
  `notifyUser` 不放行即静默（这是 ST 兼容语义，MVU 官方默认也关）；
- 通知基础设施**已存在**：`toasts` 环形缓冲（50 条）+ `showDomToast` + 面板最近提示
  （D8 已建），只是默认不亮；
- 脚本清单拉取失败仅 `console.warn('[dsht-th] scripts/for-session 拉取失败')` +
  存 `loadError` 字段——**无可达 UI 面**（grep 无 toast 关联）；
- 旁证（本 goal W-B 实测）：outline 插件 client 崩了被 slot 隔离后**整机无任何可见信号**，
  靠 CDP console 才抓到——「崩了用户不知道」是生态级现象，不只卡内脚本。

**痛点**：卡作者排错靠猜——变量没更新是「脚本没跑？提取没中？通知没开？」三连问，
现在没有任何一层给出答案。

**建议**：**做两级**——
  ① 「MVU 调试模式」开关（设置面）：打开后 notifyUser 全放行 + 提取命中/未中各出一条
  （现有 toasts 基础设施直接复用，零新管线）；② 脚本加载失败（loadError）进同一
  toasts 面。默认仍全关（ST 兼容不动）。

---

## 汇总：做什么 / 不做什么

| 项 | 建议 | 理由一句话 |
|---|---|---|
| 状态栏模板编辑 UI | **做（下轮首选）** | API 全在前端零调用，只差 UI；高频定制面 |
| 变量点值编辑 | **做** | 三真实场景；走 LLM 同款落账管线语义一致 |
| 变量回滚/快照 | **缓议** | dsht-plugin-undo 取舍先评估，不重复造 |
| MVU 调试模式 + loadError 进 toasts | **做** | 基础设施已在（D8），只是默认黑；排错三连问终结 |
| 状态栏渲染管线本身 | **不做** | 已完整（renderStatusbarHtml + sanitize 白名单） |
| 变量树只读视图的增强（折叠/搜索） | **不做（本期）** | 现有视图可用，非痛点主线 |

**排期建议**：三个「做」共享一个主题——「MVU 的人机直接操作面」，
适合打包成下一个 goal（估各自独立可交付，顺序：调试模式 → 模板编辑 → 点值编辑，
按「基础设施已备程度」从易到难）。

---

## 交付记录（2026-09-21，三个「做」全部落地 ✅）

| 项 | 状态 | 实现位置 |
|---|---|---|
| MVU 调试模式 + 提取打点 | ✅ | dsh-plugin `lastExtract` 打点（T2.3b 落盘 rp/state/<sid>.json）；`GET /dsht-mvu/last-extract` 端点；[RpScriptHost.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpScriptHost.tsx) 「调试」toggle（read-modify-write 持久化 `dsht_mvu_debug`，开后通知全放行 + `pollWhileVisible` 8s 轮询推「提取命中/未中」toast，直推不走开关） |
| 状态栏模板编辑 UI | ✅ | [RpStatusbarEditor.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpStatusbarEditor.tsx) 新建（GET/PUT `/dsht-mvu/statusbar` read-modify-write；预览走 `statusbar-render?template=<override>` **不落盘**，`sanitizeDisplayHtml` 白名单）；端点侧 `statusbar-render` 加 template override；挂 [RpStateFloat.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpStateFloat.tsx) 头部「状态栏」按钮（互斥面板族第五个） |
| 变量点值编辑 | ✅ | `/dsht-mvu/variables/patch` 加 `target:'state'`（关键：读侧深合并 state 赢，写 variables 会被旧值遮蔽；schema 校验改走合并视图）；[RpStateView.tsx](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client/RpStateView.tsx) 叶子行 ✎ 编辑（JSONPointer 转义 + JSON 智能解析 + Enter/Esc）；端点测试 [mvu-patch-target-state.spec.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/tests/mvu-patch-target-state.spec.ts)（5 条：落 state/不遮蔽/缺省回归/合并视图 422 不落盘/未知 target 容错） |
| 变量回滚/快照 | 缓议（维持） | dsht-plugin-undo 取舍评估未做，不在本期 |

验证：typecheck 全绿；vitest 84 文件 1811 通过（含新增 5 条）。
