# 架构入门（给外部贡献者）

> 建立：2026-09-23。
> **这份文档给谁看**：想改代码但不知道从哪下手的人。
> **它不是**：现状流水账（那是 [MASTER_TODO.md](../MASTER_TODO.md)）、任务清单（[TASK-LIST.md](../TASK-LIST.md)）、
> 兼容承诺（[V0.3-FREEZE.md](V0.3-FREEZE.md)）、长期目标（[GOAL.md](GOAL.md)）。
>
> **目标：读完这一篇，你能定位「我想改的功能在哪个文件」。**
> 全文不要求你先读其它文档。

---

## 〇、先建立三个心智模型

**① 这是一个「安卓壳 + 未修改的 DSH 运行时 + 我们自己的插件」三层结构。**

```
┌─────────────────────────────────────────────────────────┐
│ Android 壳（Kotlin）                                     │
│   rp-workspace/android/                                  │
│   NodeService 拉起 node 进程；WebView 显示 UI             │
└───────────────────────┬─────────────────────────────────┘
                        │ 启动
┌───────────────────────▼─────────────────────────────────┐
│ DSH 运行时（@deepseek-ai/dsh，MIT，**零修改**）           │
│   上游官方代码，我们不碰；平台差异靠**构建期补丁**注入      │
└───────────────────────┬─────────────────────────────────┘
                        │ 官方插件机制
┌───────────────────────▼─────────────────────────────────┐
│ 自研插件（TypeScript）——★ 你绝大部分工作在这里            │
│   rp-workspace/packages/src/                             │
└─────────────────────────────────────────────────────────┘
```

**红线**：DSH 官方源码与本地运行时**零修改**。所有个性化一律走官方插件机制。
改 DSH 本身会被拒（且 README「Alpha 限制 #7」说明在安卓上改 DSH 有把 App 改到打不开的风险）。

**② 插件是标准 DSH 插件，可以独立安装。**

自研部分不是一个整体，而是 **7 个插件包**（生效 6 个）：

| 插件 | 职责 |
|---|---|
| `dsh-plugin/` | **RP 宿主插件**：会话数据面 / 注入管线 / 导入引擎（最大的一块） |
| `dsht-plugin-mvu/` | MVU 变量框架（`<UpdateVariable>` / `<JSONPatch>` / stat_data 双树合并） |
| `dsht-plugin-tavern-helper/` | 酒馆助手（JS-Slash-Runner）API 兼容层 |
| `dsht-plugin-prompt-template/` | EJS 提示词模板（ST-Prompt-Template 的意图级移植） |
| `dsht-plugin-memory/` | 剧情记忆 / 表格记忆 |
| `dsht-plugin-mobile/` | 移动端适配（触摸、锚点、样式） |
| `dsht-plugin-undo/` | 回退插件（**有意不 compose 进 profile**，其路由 404 属预期） |
| `dsht-plugin-shared/` | 共享库（不是独立插件，被上面几个依赖） |

**③ 兼容层是一条管线，不是一堆散装功能。**

ST 的资产（卡/世界书/预设/正则）不是「读进来就能用」，而是每轮对话前**重新组装**。
理解这一条管线，就理解了项目的一半。

---

## 一、主线：一条消息从发出到渲染（六段链路）

这是本项目的核心。括号里是代码位置。

```
用户发消息
  │
  ▼
① 组装层 assemble（agent/request 瀑布）
   解析 RP 工作区 + 当前有效预设 ──────────── packages/src/dsh-plugin/
  │
  ▼
② pre-step 注入管线（agent/pre-step，按序执行）★ 兼容层主战场
   世界书：关键词扫描 + 预算裁剪 ──────────── packages/src/lore/
   角色卡 persona（过宏引擎）────────────── rp.json.promptPersona
   RP 预设快照（每轮从 preset.json 现值生成）─ packages/src/preset/
   正则（prompt 时机）───────────────────── packages/src/regex/
   状态树 / 剧情记忆 ─────────────────────── packages/src/state/ · dsht-plugin-memory/
  │
  ▼
③ 模型调用（llm/stream）
   预设编译规划迁移到这一层（bychv/dsh-preset-enhance）
  │
  ▼
④ 响应处理
   MVU 变量写（UpdateVariable / JSONPatch）─ packages/src/dsht-plugin-mvu/
   正则（display 时机）─────────────────── packages/src/regex/
  │
  ▼
⑤ 渲染与 UI
   楼层头 / 思考折叠 / 状态栏 / 沙箱 iframe ─ packages/src/dsht-rp-ui/
   酒馆助手桥接（tavern_events 82 项）──── packages/src/dsht-plugin-tavern-helper/
  │
  ▼
⑥ 会话手术（回退 / 编辑 / 重新生成 / 变体）
   逻辑回退 + 变量回滚 + 文件快照回滚 ────── dsh-plugin /rp/session-* 路由
```

### 为什么理解这条链路重要

**同一个「正则」功能，在 ② 和 ④ 各出现一次** —— 因为它们对应 ST 的 `prompt` 时机
（发给模型前改写）与 `display` 时机（渲染前改写）。改正则时你要同时看这两处，只改一处
会出现「模型看到的和用户看到的不是同一份文本」这类难查的 bug。

**兼容层的三个阶段**：ST 的定义 → 我们的理解 → 我们的实现。绝大多数 bug 出现在第二步，
不是第三步。

---

## 二、按「我想改什么」查表

| 我想改什么 | 去哪里 | 备注 |
|---|---|---|
| **世界书触发逻辑**（关键词/正则/递归/预算） | `packages/src/lore/` | `trigger.ts` 是核心；`safe-regex.ts` 是 ReDoS 防护 |
| **MVU 变量**（`<UpdateVariable>` / JSONPatch） | `packages/src/state/mvu.ts` + `dsht-plugin-mvu/` | 纯逻辑在 `state/`，插件侧只做接线 |
| **宏引擎**（`{{getvar::x}}` 等） | `packages/src/macros/engine.ts` | |
| **正则引擎** | `packages/src/regex/engine.ts` | ⚠️ 时机接线在 `dsh-plugin/`（见 §一） |
| **预设**（ST OpenAI Settings 导入/编译） | `packages/src/preset/` | `st-import.ts` = 导入；`managed.ts` = 托管 |
| **导入/导出 ST 资产** | `packages/src/import/` | `character-card.ts` PNG/JSON 卡；`data-zip.ts` 整包 |
| **酒馆助手 API 兼容** | `packages/src/dsht-rp-ui/src/client/th-shim.ts` | ★ 第三方卡脚本调用的 API 都在这 |
| **UI 面板**（+ 新增面板） | `packages/src/dsht-rp-ui/src/client/` | 每个 `*Panel.tsx` 一个面板 |
| **楼层渲染**（楼层头/折叠/状态栏） | `packages/src/dsht-rp-ui/src/client/` | `display-compiler.ts` / `fold-plan.ts` |
| **移动端适配**（触摸/锚点/样式） | `packages/src/dsht-plugin-mobile/` | |
| **剧情记忆 / 表格记忆** | `packages/src/dsht-plugin-memory/` | 纯逻辑在 `tables.ts` |
| **会话手术**（回退/编辑/变体） | `packages/src/dsh-plugin/` 的 `/rp/session-*` 路由 | `session-surgery.ts` / `session-repair.ts` |
| **安卓壳 / 启动流程** | `rp-workspace/android/` | ⚠️ 改这里要完整构建链 |
| **平台补丁**（bash/flock/SELinux 等） | `rp-workspace/scripts/apply-platform-patches.py` | ⚠️ 同上；约束表见 README |

---

## 三、你怎么验证改动

**只有一条命令，不需要真机、不需要构建 APK：**

```powershell
cd rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile   # 首次
npx -y pnpm@10 test                        # 约 10 秒，86 文件 / 1839 项
```

类型检查：

```powershell
npx -y pnpm@10 typecheck
```

### 测试的形态（这决定了你怎么写新测试）

单测是**纯逻辑**的：不启动 Android、不启动 DSH、不联网。
所以 `packages/src/` 下的模块普遍**刻意把纯逻辑与接线分开**：

```typescript
// 纯逻辑（可单测）—— dsht-plugin-memory/index.ts 的实际注释
export function extractFloorsFromEvents(events: SessionEventLike[]) { ... }
export function nextChunk(lastFloor: number, cursor: number, everyN: number) { ... }
```

**改逻辑时**：改纯函数 + 补一条 `packages/tests/*.spec.ts`。
**改接线时**：要给「为什么这条线必须这么接」留下依据（读基准源码，不是凭感觉）——
本项目的纪律是「**复刻调用序列是假证据，把成品原样跑一遍才是真证据**」
（[MASTER_TODO.md](../MASTER_TODO.md) 心跳 69 沉淀 L132）。

### 测试文件命名

`packages/tests/` 下平铺，按功能命名：`mvu.spec.ts` / `lore.spec.ts` / `safe-regex.spec.ts` /
`th-script-runtime.spec.ts` …… 找对应功能的现有测试看它怎么写的，照抄结构最省事。

---

## 四、几条会影响你动手方式的既有约定

**① 「出声」优于「静默」。**
不支持的 API 走**记名拒绝**（照抄基准的拒绝语义），不静默返回假值。
新写降级路径时也要出声（一次性 `console.warn` 说明为什么降级）。

**② 注释里的字面量会被门禁误判为「已发射」。**
这是踩过的坑（[MASTER_TODO.md](../MASTER_TODO.md) 心跳 74：修完别名后某项从「缺口」变「已覆盖」，
而实际没写任何发射 —— 因为注释里的字面量同样命中文本判据）。
**注解里不要写看起来像代码的字面量。**

**③ `th-shim.ts` 的 shim 源码在模板串内。**
**注释里绝不能用反引号**（会截断模板串，项目历史上有同类事故，`build-wb.sh` 的 A11 闸门兜底）。

**④ 上游拼写错误要逐字照抄。**
如 MVU 的 `VARIABLE_INITIALIZED` 值在上游是 `'mag_variable_initiailized'`（拼错的）。
「修正」它 = 与真 MVU 不一致 ⇒ 同样永不触发，且更难查。

**⑤ 文档有双语结构测试。**
改 `README.md` / `CONTRIBUTING.md` 时中英两份都要改 ——
`packages/tests/docs-bilingual-structure.spec.ts` 会检查。

---

## 五、下一步

- **想找活干** → [CONTRIBUTING.md](../CONTRIBUTING.md)「五类可以认领的活」
- **想知道兼容承诺边界**（哪些是 bug、哪些是明确不做）→ [V0.3-FREEZE.md](V0.3-FREEZE.md)
- **想懂某个兼容面的契约细节** → [ST-COMPAT-PACT.md](../rp-workspace/docs/ST-COMPAT-PACT.md)
- **想装社区插件** → [PLUGIN-COMPAT.md](PLUGIN-COMPAT.md)
- **想看项目的思考过程**（含大量「为什么这样做」的教训）→ [MASTER_TODO.md](../MASTER_TODO.md)
  ⚠️ 461KB，**不是入门材料**，按需检索使用
