# TASK-LIST：接下来要做的所有事（唯一任务清单）

> 建立：2026-09-10。**本文件是行动清单**（做什么、按什么顺序、做完的标志）；现状背景看 [MASTER_TODO.md](MASTER_TODO.md)，冻结边界看 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md)，升级细节看 [docs/DSH-0.1.5-UPGRADE-PLAN.md](docs/DSH-0.1.5-UPGRADE-PLAN.md)。
> 状态取值：⏳ 待办 / 🔄 进行中 / 🚧 阻塞 / ✅ 完成

---

## 0. 现在的处境（30 秒读完）

| 事实 | 说明 |
|---|---|
| 源码 runtime | **0.1.5-rc.1**（sentinel v205，41 个心跳已推完阶段 0/1/2） |
| 你手机上的包 | **arm64-release，9-10 18:47 构建 = 还在 0.1.2-rc.1** ⚠️ **与源码不同源** |
| 升级进度 | **3 / 5**（阶段 3 会话迁移验证进行中；阶段 4 回归+双架构交付未做） |
| 单测 | 710 项全绿（36 文件） |
| 未提交改动 | 5 项（见 T-01） |

**核心矛盾**：源码已经跑到 0.1.5，但真机包停在 0.1.2。**你不装新包，就测不到任何新修复。**

---

## 1. 立即做（P0，阻塞其他一切）

### T-01　收拢未提交改动　✅ 已完成（2026-09-10 收口提交）
- 内容：`MASTER_TODO.md` / `NodeService.kt`(sentinel v205) / `build-dsht.ps1` / `.workbuddy/memory/2026-09-10.md` / `stage3-device/`（是否入库需定）
- 完成标志：`git status` 干净或只剩明确忽略项
- 备注：`stage3-device/backup/dsh-before-migration.tar.gz`（859MB 设备备份）**建议不入库**，加 .gitignore

### T-02　走完升级阶段 3：会话迁移验证　🔄 进行中（WorkBuddy 主责）
- 目标：确认 v0 → v1 → v2 → v3 三段迁移在**真实体量**（12MB ~ 214MB 会话）下可用
- 判据：`.goal/upgrade-0.1.5/.stage3-pass` 文件存在（evaluate.sh 的 +1）
- 风险：**迁移不可逆**；回滚保险四层已就位（见 MASTER_TODO §「正在进行」）
- 完成标志：备份副本迁移后会话可正常打开、历史完整、seq 连续

### T-03　走完升级阶段 4：功能回归 + D-4 重评　⏳ 待办
- 内容：模拟器全量回归（启动/端口/插件注册/发消息/回退/编辑/变体/世界书/MVU）
- D-4 重评：0.1.5 的 `in-history` 可能让「用户输入移到末尾」可达 —— **单独评估，不与升级叠加**
- 判据：`.goal/upgrade-0.1.5/.stage4-pass` 文件存在（evaluate.sh 的 +1）
- 完成标志：evaluate.sh 输出 **5/5**

### T-04　🔴 重打 arm64-release 包给你手机　⏳ 待办（T-02/T-03 完成后）
- 这是**唯一**能让你在真机验证 0.1.5 + 全部修复的动作
- 产物：`DSH-Tavern-0.2.0-arm64-release.apk` + `_pending-deploy/`（sentinel 递增）
- 完成标志：装机后诊断面板显示「构建 vNNN」≥ v205；三条基线通过（启动 / 打开旧聊天 / 发消息）

---

## 2. 需要你拍板的事（P0，回答后才能动）

| # | 问题 | WorkBuddy 建议 | 影响面 |
|---|---|---|---|
| T-05 | 升级时机：立即走完 vs 等正式版 | 立即（阶段 0/1 纯静态已过） | 决定 T-02~T-04 是否继续 |
| T-06 | 能否接受「打开旧聊天要等一会儿」（迁移耗时） | 等 T-02 实测数据 | 体验 vs 数据安全 |
| T-07 | 要不要启用「动态替换提示词」（可能解 D-4） | 升级完再单独评估 | D-4 可达性 |
| T-08 | 31 个工具定义（D-6）要不要关 | 分开做，别和升级叠加 | RP 会话纯净度 |
| T-09 | **存量脏楼层清洗**：`$1` 残留 + `<interactive_input>` 包装回写（3 会话 146 处） | 一次性 migration | 历史聊天外观（**不影响新消息**） |

---

## 3. 与 TauriTavern 对齐的剩余差异（P1/P2）

> 基准 = TauriTavern-Canary（用户 2026-09-09 拍板）。差异全文见 [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md)。

| # | 差异 | 状态 | 下一步 |
|---|---|---|---|
| T-10 | D-3 role 映射（系统级内容走 system） | ✅ 主体已修 | 过渡态收敛（历史 user 席快照靠影子化逐轮折叠），观察即可 |
| T-11 | D-4 用户输入绝对位置 | ⏸ 判定核心约束不可达 | 0.1.5 升级后重评（T-03 内） |
| T-12 | D-6 agent 层污染（31 tools / 24k 字说明书） | ⏳ 待拍板 | 见 T-08 |
| T-13 | D-7 采样参数对照（TT 侧 `GENERATE_AFTER_COMBINE_PROMPTS` dump 未采） | ⏳ 低优先 | 补采集脚本 |
| T-14 | golden 接收器迁入 `ctx.webServer`（摆脱宿主进程回收） | ⏳ 待办 | `dsh-plugin/index.ts` webServer 段 |
| T-15 | rp-plugin msg dump 口径修正（`raw.messages` → `decision.messages`） | ⏳ 待办 | `dsh-plugin/index.ts` |

---

## 4. 兼容面剩余缺口（P1，V0.3-FREEZE §5 列的 7 项，已核实进度）

| # | 缺口 | 状态 | 落点 |
|---|---|---|---|
| T-16 | substituteRegex 枚举 1↔2 颠倒 | ✅ 已修 | `regex/engine.ts` |
| T-17 | 正则 `$1/$<name>` 捕获组失效 | ✅ 已修（TT 对照修复 2026-09-09） | `regex/engine.ts:165+` |
| T-18 | `{{match}}` 大小写不敏感 | ✅ 已修（v181，改 `/gi`） | `th-shim.ts:1086` |
| T-19 | shim `Mvu.parseMessage` 与 `state/mvu.ts` 不对称 | ✅ 已修 | `th-shim.ts:1594` |
| T-20 | `getTavernRegexes` 未对齐真 TH **snake_case** 形状 | ✅ 已修（2026-09-10，e78e433） | 出口/入口双向映射 + 契约测试 `th-regex-contract.spec.ts` |
| T-21 | `getChatMessages` / `getWorldbook` / `deleteVariable` 字段透传 | ✅ 已修（2026-09-10，ae59380） | 逐项对真 TH 类型定义补齐 |
| T-22 | `setglobalvar` 宏族 | ✅ 已修 | `th-shim.ts:1339+` |

---

## 5. 验证债（P1，最大欠账）

### T-23　真机/模拟器回归清单（V0.3-FREEZE §5 序1）
- 开场白 / 世界书（GENERATE·@INJECT·RENDER）/ MVU（initvar·UpdateVariable）/ tableEdit /
  文件预览 / 悬浮球拖动 / A1·A2 复测 / variant groups 同锚点复测
- 完成标志：每项有 probe 脚本或截图证据，结果回写本表

### T-24　回归清单看板化
- 把上述清单落成可执行脚本（参照 `tmp/verify-fixes.mjs` 模式），避免「口头验过」

---

## 6. 发布前准备（P2，三硬门槛做完才能公开）

### T-25　仓库大扫除（**一票否决**）　🚧 阻塞中
- **当前阻塞**：用户指令「全部功能干好之前，仓库 RP 数据冻结不动」（2026-09-03）
- 解冻条件：T-04 装机验证通过 + 对齐差异收敛
- 内容：清角色卡图 / 聊天记录 / 世界书正文 / 带服务器地址日志 / 测试脚本抓的真实对话；重写 `.gitignore`
- 完成标志：仓库内**搜不到任何真实人名/卡名/服务器地址**
- 附带：`stage3-device/` 859MB 备份是否入库 → 建议忽略

### T-26　README
- 内容：这是什么 / 不是什么 / 法律边界 / 致谢 / **alpha 限制声明**
- 完成标志：新人 5 分钟看懂

### T-27　GitHub Releases 渠道 + 应用内检查更新开关
- 现状：正式签名 / 更名 / 图标 / 版本号 / 一键出包 **已完成**；**只剩**「检查更新开关 + Releases 渠道」
- 完成标志：app 内能检测到新版本并给出更新入口

---

## 7. 长尾 / 观察项（P3，不阻塞发布）

| # | 项 | 说明 |
|---|---|---|
| T-28 | Tier 2 TH 长尾 API（约 50 项记名 stub 之外） | rebind 家族 / createOrReplacePreset / QuickReply 系 |
| T-29 | EJS 完整语法（当前子集：无函数调用/箭头函数/模板字符串/正则字面量） | 显式报错，非静默失败 |
| T-30 | 采样参数长尾（topP/topK/minP/penalties/seed…） | 等宿主 LLM 适配器白名单 |
| T-31 | 表格记忆长尾（E7 自定义渲染占位符 / E9 编辑器 / E12 设置导入导出） | 每项时间盒 |
| T-32 | `st-migration` skill 契约漂移复核 + 配探测脚本 | 防文档再次滞后于实现（本次已手工对齐一轮） |
| T-33 | 复杂卡脚本逐卡适配（飞讯 / 示例游戏类） | 第三次冒同类问题即升 Tier 2 时间盒 |

---

## 8. 已知不修（明确不承诺，别再投入）

> 依据 [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) §3 Tier 3 + 审计报告 §4。

- 聊天历史改/删/轮转类 TH API（`setChatMessage`/`deleteChatMessages`/`rotateChatMessages`）——DSH 日志 append-only 是架构决策；回退/编辑走自有机制已覆盖
- extension 作用域变量 / `importRaw*` / 扩展管理 / ScriptTrees / 音频播放器控制面 / 角色卡 CRUD 长尾
- depth N 精确历史锚定（注入通道 append-only，只保证批内「尽量深」）
- 卡自带外部脚本自身的适应问题（保留观察）

---

## 9. 建议执行顺序（一条线）

```
T-05 拍板升级 → T-02 阶段3 迁移验证 → T-03 阶段4 回归(含 D-4 重评)
   → T-04 🔴 重打 arm64 包 → 【你装机验三条基线】
   → T-20/T-21 兼容缺口补完 + T-23/T-24 验证债
   → T-09 存量清洗（你拍板）→ T-25 大扫除 → T-26 README → T-27 Releases
```

**卡点提示**：T-04 之前的一切优化你都摸不到（真机包落后）；T-25 大扫除在 T-04 验通过 + 差异收敛前**不能动**（数据冻结）。

---

## 附：工具与文档索引

| 用途 | 位置 |
|---|---|
| 升级度量 | `bash .goal/upgrade-0.1.5/evaluate.sh` → 0–5 |
| 升级目标/约束 | [.goal/upgrade-0.1.5/GOAL.md](.goal/upgrade-0.1.5/GOAL.md) |
| 升级策略/阻塞 | [.goal/upgrade-0.1.5/STRATEGY.md](.goal/upgrade-0.1.5/STRATEGY.md) |
| 平台补丁 | `scripts/apply-platform-patches.py`（`--check` 预检） |
| 插件构建 | `scripts/build-plugins.sh` |
| 一键升级 | `scripts/upgrade-runtime.sh` |
| 会话迁移验证 | `tools/verify-session-migration.py` + `scripts/stage3-migration-test.sh` |
| 自动化发送 | `rp-workspace/scripts/dsht-send.mjs` |
| 差异全文 | [docs/DSHT-VS-TT-DIFF-2026-09-10.md](docs/DSHT-VS-TT-DIFF-2026-09-10.md) |
| 兼容契约条款 | [rp-workspace/docs/ST-COMPAT-PACT.md](rp-workspace/docs/ST-COMPAT-PACT.md) |
| 冻结边界 | [docs/V0.3-FREEZE.md](docs/V0.3-FREEZE.md) |
| 兼容审计 | [docs/COMPAT-AUDIT-2026-09-08.md](docs/COMPAT-AUDIT-2026-09-08.md) |
