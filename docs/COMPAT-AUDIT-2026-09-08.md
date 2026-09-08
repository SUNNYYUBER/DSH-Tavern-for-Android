# 兼容面完整性审计报告：酒馆助手 / 正则 / MVU（2026-09-08）

> **起因**：用户质疑"这三个模块是 bug 重灾区，怀疑当初从 ST 搬运时没做好甚至很多没做"。
> **方法**：三路并行审计——① 自研兼容层盘点（16 个模块 + 显式缺口标记全域搜索）；② 文档欠账提取（MASTER_TODO / AUDIT_TASKLIST 全量）；③ ST 侧源码逐特性对照（ST 本体 public/ + JS-Slash-Runner 扩展源码）。
> **配套**：冻结范围见 [V0.3-FREEZE.md](V0.3-FREEZE.md)；契约条款见 [../rp-workspace/docs/ST-COMPAT-PACT.md](../rp-workspace/docs/ST-COMPAT-PACT.md)。

---

## 1. 总体判断（直接回答怀疑）

**"没做好甚至很多没做"的部分成立，但性质要区分清楚：这三个模块不是"没做"，而是按"让手头真实卡（示例游戏/示例预设/飞讯）跑通"的优先级做了选择性搬运**——每个近似实现都挂着 2026-09-05/07 的实机修复取证注释，且未覆盖的 API 全部记名上报（ScriptStatus.missing，管理面板可见），不存在静默烂尾。

真正的缺口集中在三类，危险度递增排列：

| 类别 | 例子 | 危险度 |
|---|---|---|
| ① 长尾 API 成建制缺失（约 60+ 个，全部记名拒绝） | lorebook 全族 39 个、角色卡 CRUD、脚本树、生成控制 | 低：脚本调用即报错，管理面板可见，可按卡需求逐个补 |
| ② 数据模型级语义差异（架构性） | 永久改写时机、每楼每 swipe 变量树、同步 vs 异步 API | 中：需要设计决策，不能靠打补丁 |
| ③ **字段形状偏差（最危险）** | getTavernRegexes 返回 camelCase 而真 TH 是 snake_case、substituteRegex 枚举颠倒、$1 捕获组失效 | **高：脚本不报错，静默拿到 undefined / 字面 "$1"，正是"实际使用时各种不顺手"的主要来源** |

三个模块搬运完整度粗估（按功能点加权，含置信度说明见 §8）：
- **正则：约 60%**——主干（三时机/三源/基础替换）已通，缺的是字段级保真。
- **酒馆助手 TH API：约 55%**——71 个 API（28 本地 + 43 桥接）+ 事件 82 项全表已实现，长尾约 60 个记名缺失。
- **MVU：约 50%（低置信）**——ST 侧 MVU 框架源码本机不可得，此数按"真实卡实际用到的语义面"估计。

---

## 2. 正则模块（对照 ST public/scripts/extensions/regex/engine.js）

### 2.1 实锤缺口（本轮源码裁决，可直接修）

| # | 缺口 | ST 行为 | 我方现状 | 证据 |
|---|---|---|---|---|
| R1 | **`$1..$9`/`$<name>` 捕获组引用失效** | string replacer，`$N` 由 JS 解释为组内容 | engine.ts L140 用**函数式回调**，返回值里的 `$N` 不被解释 → 卡脚本输出字面 "$1"。L143 注释"JS 原生 replace 已处理 $N"是错的（回调形态不解释）。回调还丢弃了 p1..pN 参数 | [engine.ts](../rp-workspace/packages/src/regex/engine.ts#L140-L148) vs ST engine.js L933-952 |
| R2 | **substituteRegex 枚举 1↔2 颠倒** | 0=NONE / 1=RAW / 2=ESCAPED | 我方 1→escaped、2→raw（颠倒）；接口注释"0=RAW 不替换 1=ESCAPED 2=NONE"与 ST 也不符。设 1/2 的脚本 findRegex 宏替换行为反了 | engine.ts L27-28、L111-115 vs ST engine.js L908-920 |
| R3 | `{{match}}` 大小写敏感 | `gi` 替换（大小写不敏感） | 仅 `/g`，大写 `{{MATCH}}` 漏 | engine.ts L144 vs ST engine.js L932 |
| R4 | trimStrings 作用点偏差 | 对**每个捕获组内容** filterString，且 trimString 自身过宏 | 对**替换后整串** split-join，trimString 内宏不展开 | engine.ts L146 vs ST engine.js L949/L968-976 |

### 2.2 架构性偏差（需设计决策，不是遗漏）

| # | 主题 | ST 语义 | 我方语义 | 影响 |
|---|---|---|---|---|
| A1 | **永久改写时机** | 写盘前改写：发送/接收/开场白/编辑保存时执行，**chat 文件存改后文本** | 无写盘改写；显示层 pass0 + 提示词层每轮重跑，**session log 存模型原文** | 显示与提示词结果等价；但 TH `getChatMessages` 回读的是原文而非 ST 的改后文本，导出保真度不同 |
| A2 | allowedOnly 允许清单 | character_allowed_regex / preset_allowed_regex 白名单 | 缺失（角色/预设正则恒生效；shim isCharacterTavernRegexesEnabled 恒 true 并已注释承认） | 需要存储位 + UI 决策 |

### 2.3 实现遗漏（Tier 2，按需补）

pluginOnly 字段与 isPluginPrompt 上下文；REASONING placement 的提示词层接线（display 层已有）；正则编译缓存（同文本多轮重复编译）；非字面量 findRegex 不应强加 gm 基线；ST runtime providers（registerRegexProvider，TH 脚本动态注册正则）；ReDoS 暂停/耗时记录。

### 2.4 已确认完整

三时机模型、placement 六值、min/maxDepth 过滤、三源作用域合并顺序（global→character→preset，与 ST GLOBAL→SCOPED→PRESET 一致）、`/pattern/flags` 字面量剥壳、replaceString 二次宏求值、坏正则跳过不吞文本、导入容错映射。

---

## 3. 酒馆助手 TH API（对照 JS-Slash-Runner getTavernHelper() 全集，约 140 符号）

### 3.1 实锤缺口（字段形状类，高危）

| # | 缺口 | 后果 | 证据 |
|---|---|---|---|
| T1 | **getTavernRegexes 返回 ST camelCase（scriptName/findRegex），真 TH 是 snake_case（script_name/find_regex）** | 卡脚本读 `script_name` → undefined，静默不工作 | [th-shim.ts](../rp-workspace/packages/src/dsht-rp-ui/src/client/th-shim.ts) vs TH variables/regex 源码 |
| T2 | replaceTavernRegexes 的 option 形状：我方 `{type:'scoped', scope}`，真 TH `{type:'global'\|'character', name}/{type:'preset', name}` | 脚本写入正则落错作用域或报错 | 同上 |
| T3 | getChatMessages 缺 `is_hidden`/`extra`/swipe 系字段（DSH 无 swipe 树，is_hidden/extra 可先透传） | 依赖 extra 的卡脚本拿 undefined | th-shim.ts L905-935 vs ST chat_message.ts L21-38 |
| T4 | getWorldbook 条目缺 `probability/recursion/effect/display_index/extra`（strategy/position 已由 thEnrichEntry 补齐） | 世界书控制类卡判定逻辑缺输入 | th-shim.ts L1052-1117 vs ST worldbook.ts L85-123 |
| T5 | deleteVariable 返回值缺 `delete_occurred` | 判删成功的脚本误判 | th-shim.ts L665 |

### 3.2 架构性偏差（需设计决策）

| # | 主题 | ST/真 TH | 我方 | 说明 |
|---|---|---|---|---|
| B1 | **同步 API 语义** | 变量/宏/getChatMessages 为同步函数 | 桥架构决定全部异步（仅 getAllVariables 用 Promise+属性混合体变通） | 卡脚本同步解构返回值依赖混合体 hack；根治需 iframe 同源直读数据面（同源已放开，可行但需设计） |
| B2 | **message 作用域 = 每楼每 swipe 变量树** | `chat_message.variables[swipe_id]` | MVU 合并视图（state⊕variables）顶替 | 多 swipe/分叉场景语义不同；与 §4 B2 同根 |
| B3 | swipe 树 | ChatMessageSwiped 全套 | DSH 无分叉树 | 需决策是否用 variant-groups 承载 |
| B4 | getChatMessages 内容口径 | ST 返回永久改写后文本 | 返回模型原文 | 与 §2 A1 同根，一并决策 |

### 3.3 长尾 API 成建制缺失（全部记名拒绝、面板可见，Tier 2/3）

- **lorebook 全族**（39 个）：createLorebookEntry(s)/deleteLorebookEntry(s)/setLorebookEntries/updateLorebookEntriesWith/getLorebooks/getCharLorebooks/getChatLorebook/setChatLorebook/getLorebookSettings/setLorebookSettings/setCurrentCharLorebooks 等——其中 **getLorebookSettings 优先级最高**（世界书控制类卡读扫描参数）。
- 角色卡/人设族 12+（getCharData/getCharacter 族）；扩展管理 9；import_raw 5；ScriptTrees；音频播放器控制面 8（bgm/ambient 基础播放除外）。
- 生成控制 4：getModelList/getProxyPresetNames/stopGenerationById/stopAllGeneration。
- 显示管线 API：formatAsDisplayedMessage/retrieveDisplayedMessage/refreshOneMessage（等价能力在宿主 display-compiler，但不暴露此 API 名）。
- setChatMessage（单条）/deleteChatMessages/rotateChatMessages：**Tier 3 架构性不修**（append-only 日志决策，回退/编辑已走自有机制）。

### 3.4 已确认完整 / 近似可用

tavern_events 82 项全表（名值逐项对齐）、iframe_events 6 项、变量六作用域（缺 extension，记名）、预设 CRUD 主干（getPreset 缺 settings/prompts_unused/extensions 字段）、generateRaw 真语义装配（ordered_prompts 9 种标识符+世界书激活+persona/卡/历史+预算截历史；无流式/工具调用）、waitGlobalInitialized（MVU 生态生命线）、TavernHelper Proxy 记名机制（缺失 API 必上报）、console/toastr/console 转发、ST 选择器映射（#send_textarea→composer）。

---

## 4. MVU（低置信：ST 侧 MVU 框架源码本机不可得，按真实卡实证 + 注释推断）

| 主题 | 我方状态 | 定性 |
|---|---|---|
| `<UpdateVariable>` 多块合并 + 块外裸 `<JSONPatch>` 兜底 | 已实现 | 完整 |
| `<JSONPatch>` 7 op（add/replace/remove/delta/move/copy/insert）+ JSONPointer 转义/建容器/delta 浮点安全 | 已实现（示例预设 V8.8 实证） | 完整 |
| `<initvar>` YAML 树初始化 | parseYamlLite 轻量解析（缩进嵌套/全角冒号/注释），非真 YAML | 近似——复杂 YAML 卡可能解析偏差 |
| `_.set/_.add/_.inc/_.dec` 指令行 | 已实现，容忍全角符号 | 近似可用 |
| **shim `Mvu.parseMessage` 只认 JSONPatch 子块**（不含 initvar/_.set），与 state/mvu.ts 全量解析不对称 | 内部不一致 | **实锤缺口（M1）：对齐即可** |
| 宏：{{getvar}} 系 + 顺序求值 + MVU 别名宏 | 缺 setglobalvar/addglobalvar/getglobalvar | 实现遗漏 |
| stat_data 生命周期 | rp/state 双树（variables=初始化落点、state=运行期落点），读侧深合并 state 赢 | 近似——**无每楼/swipe 变量快照（架构性，与 §3 B2 同根）** |
| **重 roll/回滚时变量恢复** | 有 undo 日志 + 文件快照数据基础，"自动恢复到该楼之前状态"的接线无证据 | **倾向缺失（M2）：需决策是否引入楼层→变量快照锚** |
| 状态栏 `<StatusPlaceHolderImpl/>` | 模板宏 + 裸 {{path}} + 默认两栏兜底；复杂卡（示例游戏）实际由卡自带 160KB 正则渲染（与 ST 同款走正则） | 近似可用 |
| Mvu 类五件套（getMvuData/replaceMvuData/parseMessage/events/isDuringExtraAnalysis） | 形状级；isDuringExtraAnalysis 恒 false | 近似 |

---

## 5. 宿主硬约束（修不了、只能等上游或绕开——不算我们的债）

| # | 约束 | 对策现状 |
|---|---|---|
| H-① | decision.messages 全落 user/message 且 restore 校验 role='user' → ST 逐条目 role 分配无法移植 | relative 条目走 request.system，depth 条目语义由签名节名承载 |
| H-② | 宿主 LLM 适配器仅透传 temperature/max_tokens/stop + reasoningEffort | topP/topK/minP/topA/penalties/seed/logitBias 存 preset.json 待宿主支持 |
| H-③ | 注入通道 append-only，无 depth N 精确历史锚定 | 批内"尽量深"（insertAt=max(0,len-depth)），实测落点符合预期 |
| H-④ | 宿主写端 seq 双轨无 lease，反复重装+SIGKILL 叠加仍可能 seq gap | 等 0.1.3-rc（I8-5 挂起项）；我方 repair 已按宿主语义对齐 |

另：DSH 0.1.3 升级整体暂缓（官方自认性能回退 + session v2 迁移风险，见 DSH-0.1.3-UPGRADE-NOTES.md）。

---

## 6. 验证债（当前最大的一类欠账——功能已做、闭环未做）

以下各项功能代码已落地（多数 🟢），但缺最终真机/模拟器回归：

1. 开场白注入（A1 已修待回归）；世界书触发扫描/prompt 正则历史读取（A2 已修待回归）。
2. 世界书 GENERATE / @INJECT / RENDER 三类条目（B3/B4/B6）。
3. MVU initvar / UpdateVariable / 额外解析（真实卡运行期格式 649/649 通过过，需回归确认未退化）。
4. tableEdit 表格编辑、文件预览、悬浮球拖动。
5. variant groups：脚本侧重发同锚点文本后复测；render-entries GET 门。
6. kickoff（适配 agent + LLM）既有流程未重跑。

---

## 7. v0.3 优先修复 backlog（按风险排序，含 Tier 与定性）

| 序 | 事项 | Tier | 定性 |
|---|---|---|---|
| 1 | R2 substituteRegex 枚举纠正（0=NONE/1=RAW/2=ESCAPED）+ 修正接口注释 + 用真实预设 39 个正则回归 | 1 | 一行级修复 + 数据审视 |
| 2 | T1/T2 getTavernRegexes/replaceTavernRegexes 对齐真 TH 形状（snake_case + option 形状） | 1 | 形状转换层 |
| 3 | R1 捕获组引用：回调内展开 `$N`（args[N]）、`$<name>`（groups）、`$$`/`$&`；或改 string replacer | 1 | 小改 + 单测 |
| 4 | M1 shim Mvu.parseMessage 对齐 state/mvu.ts 三来源解析 | 1 | 小改 |
| 5 | T3/T4/T5 字段透传：getChatMessages 补 is_hidden/extra；getWorldbook 补 probability/recursion/effect/display_index/extra；deleteVariable 补 delete_occurred | 1 | 机械补齐 |
| 6 | R3 `{{match}}` 加 `i`；R4 trimStrings 移至捕获组级 + 宏求值 | 1 | 小改 + 单测 |
| 7 | setglobalvar/addglobalvar/getglobalvar 宏族 | 1 | 小改 |
| 8 | A1/B4 永久改写口径决策（log 存原文 vs 改后文本——影响导出与 getChatMessages） | 决策项 | 先讨论再动 |
| 9 | B2/B3 每楼每 swipe 变量树 / swipe 树承载 | 决策项 | 数据模型设计 |
| 10 | getLorebookSettings 设置面（世界书控制类卡依赖） | 2 | 时间盒 |
| 11 | B1 同步 API 语义（iframe 同源直读数据面） | 2 | 专项设计 |
| 12 | A2 allowedOnly 允许清单 | 2 | 存储+UI 设计 |
| 13 | §6 验证债闭环 | 1 | 集中一轮 |
| 14 | M2 重 roll 变量恢复接线 | 2 | 基于 undo 日志设计 |

## 8. 方法与置信度说明

- 正则/TH 的 ST 侧对照基于本机真实源码（ST 1.16 public/ + JS-Slash-Runner 扩展源码），置信度高；行号均为审计时实测。
- MVU 的 ST 侧本体（MagVarUpdate dist）本机不可得，结论基于真实卡（ExampleGame ExampleWorld / 示例预设 V8.8 / 示例游戏）运行日志取证 + 我方注释推断，完整度百分数置信度低，仅作量级参考。
- 百分数口径：按功能点计数加权（完整=1、近似=0.5），并按"实跑卡脚本依赖面"上浮；不代表用户体验百分比。
- 审计过程中两路结论冲突处（$1 捕获组）已由人工源码裁决（§2.1 R1：函数式回调不解释 $N，缺口成立）。
