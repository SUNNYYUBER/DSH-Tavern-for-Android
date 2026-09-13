/**
 * dsht-rp —— DSHTavern 的 **RP 总包**（用户 2026-09-13 拍板："把 roleplay 相关插件汇总成一个"）
 *
 * ============================================================================
 * ## 这个包为什么存在
 *
 * 此前 RP 功能由 **5 个独立 cordis 包** 提供（patch 里 5 行 insert）：
 *   1. `dsht-rp-plugin`（主包：世界书触发 / 卡导入 / 组装管线 / 变体 / 回退 / RP UI 浏览器半边）
 *   2. `dsht-plugin-mvu`（MVU 变量 / 状态栏）
 *   3. `dsht-plugin-tavern-helper`（酒馆助手兼容面）
 *   4. `dsht-plugin-prompt-template`（EJS 提示词模板）
 *   5. `dsht-plugin-memory`（剧情记忆 / 楼层总结）
 *
 * 两份收益：
 *   · **PC 端**：导入一个包即可用（配合 `dsh.bundle.patch` 声明 ⇒ `dsh plugin add` 自动进 profile 层栈）；
 *   · **插件列表**：我方条目从 6 行降为 2 行（本包 + `dsht-plugin-mobile`）。
 *
 * ## 合并形态：**薄壳聚合**，不是代码搬迁
 *
 * 本文件**不搬运任何业务逻辑**：它只 import 5 个子模块已导出的 `apply` 并按固定顺序调用。
 * 这是刻意的设计选择（2026-09-13 实施）：
 *   · 5 个子模块的 `apply` **本来就已 export**（供单测直接 import），无需改造内部；
 *   · 子模块的 `export const name` **不能被改成同一个值** —— 见下条。
 *
 * ## ⚠️ 为什么子模块的 `name` 必须保持原样（这是本方案最关键的约束）
 *
 * 子模块的 `name` 会被**写进会话数据**（`source.plugin = name`），且**被反读用于识别自己的产物**：
 *   · `dsh-plugin/index.ts:1059/1271/2682/4144/4510/4539` —— 快照消息的 `plugin: name`；
 *   · `dsht-plugin-memory/index.ts:770/804/832/1030` —— 记忆快照 + marker；
 *   · `dsht-plugin-memory/index.ts:959` —— **用 `src.plugin === name` 判断"这是不是我写的 marker"**。
 *
 * ⇒ 若把它们的 `name` 统一改成 `'dsht-rp'`：
 *   · 已存会话里那些 `plugin: 'dsht-plugin-memory'` 的旧 marker 会被**认不出来**
 *     （`isSnapshot` 判据失效 ⇒ 影子化/折叠行为改变 ⇒ 重复上下文重新出现）；
 *   · `.agent-presets` / 导入管线等按 plugin 名做归属判断的地方全部错位。
 * ⇒ 故：**子模块保留各自的 `name` 与 `inject`（作为内部常量）**，本包只聚合 `apply`。
 *   副作用：设置命名空间（`'dsht-plugin-mvu'` 等）与 HTTP 路由前缀（`/dsht-mvu` 等）
 *   **全部保持不变** ⇒ 4 张设置卡与老用户 `settings.yaml` 均不受影响，UI 一行都不用改。
 *
 * ## 顺序不变量（B5 —— 最容易出静默错误的地方）
 *
 * `cordis` 的 waterfall 语义是「**先注册者包在外层**」（`vendor/cordis/src/events.ts:238`
 * `const cb = cbs.shift() ?? inner`）。主包与 memory **各有一个 `agent/pre-step` 监听器**，
 * 且两者都是「`await next()` 之后再改 `decision.messages`」——**注册顺序会改变 messages 的最终组合**。
 *
 * 现状（5 个包时）的顺序由 patch 行顺序决定，主包在前、memory 在后。故本文件的
 * `SUB_PLUGINS` **必须保持同一顺序**，且**不得重排**（重排 = 静默改变 RP 组装与记忆注入的相互覆盖关系）。
 * 若将来确需调整顺序，必须作为**显式变更**并做回归验证（对照 messages 组合）。
 *
 * ⚠️ 这也意味着：本包的价值是「**分发单元合并**」，而**不是**「行为合并」——
 * 行为必须与合并前**逐项一致**。
 */

import { apply as applyRp } from '../dsh-plugin/index.ts'
import { apply as applyMvu } from '../dsht-plugin-mvu/index.ts'
import { apply as applyTavernHelper } from '../dsht-plugin-tavern-helper/index.ts'
import { apply as applyPromptTemplate } from '../dsht-plugin-prompt-template/index.ts'
import { apply as applyMemory } from '../dsht-plugin-memory/index.ts'

/**
 * 总包名（= 包名 = patch 里的 `name:` = loader row 标识）。
 *
 * ⚠️ **沿用 `dsht-rp-plugin` 而非新名 `dsht-rp`**（用户定案"包名与 patch id 继续沿用"）。
 * 这是**最小改动**的选择，理由（改动会波及的硬编码清单）：
 *   · 浏览器侧模块 id：`scripts/build-rp-ui.mjs:211` 的 `__ModuleLoader__.load({ id: "dsht-rp-plugin" })`；
 *   · boot graph 检测：`scripts/cdp-*-test.mjs` 的 `inBoot` 判据按该字符串匹配；
 *   · 壳侧拷贝路径：`NodeService.kt` 的 `copyPackage(webProfile, "dsht-rp-plugin", …)`；
 *   · 新鲜度闸门：`scripts/audit-artifact-freshness.mjs` 的 PAIRS 里 3 处产物路径；
 *   · 构建脚本：`build-dsht.ps1` / `build-plugins.sh` / `build-wb.sh` 的 outfile 路径。
 * ⇒ 沿用旧包名，上述**全部无需改动**；本包只把"内容"从"主包单独"扩为"主包 + 4 个 R10 子模块"。
 *
 * ⚠️ 与子模块的 `name` 是两件事：本值只用于**包标识**；子模块仍以各自原 `name`
 * 写入会话数据（见文件头「为什么子模块的 name 必须保持原样」）。
 * 注：本值与主包 `dsh-plugin/index.ts` 的 `name` 恰好同值 —— 这是**有意的**
 * （主包的 `name` 会被写进 `source.plugin`，必须保持不变；本包沿用同一字符串不产生冲突：
 *  loader 用 row 的 `name` 解析**包**，再取该包 exports 的 `name` 作为插件名，两者一致即正常）。
 */
export const name = 'dsht-rp-plugin'

/**
 * 服务声明（B1）。
 *
 * ## 为什么这里**不是** 5 个子模块 `inject` 的简单并集
 *
 * 5 个子模块的 `inject` 并集是 10 项：
 *   `tools, systemPrompt, sessions, llm, agentDefaultModel, webServer, settings, credentials, connection, agents`
 *
 * 若照搬这个并集，会引入 T-87 文档 **B1** 明确要消除的故障：
 * **`inject` 是「激活门」** —— 缺任意一个服务，整个 entry **不激活**，
 * 于是「只缺 `llm`」会连带让 MVU / 酒馆助手 / EJS 模板**一起失效**。
 *
 * 该结论为**实测所得**（不是读源码推断）—— 实测记录已固化进
 * `rp-workspace/scripts/verify-rp-consolidation.mjs` 的文件头「附：本脚本依赖的 cordis 语义」
 * 与判据 10 / 11（后者是行为侧的常驻回归）：
 *   · Q1：`inject` 列了不存在的服务 ⇒ 该插件的 `apply` **一次都不被调用**；
 *   · Q2b：`apply` 内访问**未 inject 且未提供**的服务属性 ⇒ 抛
 *     `cannot get property "llm" without inject`；
 *   · A：**即使服务已由上层提供**，未写进 `inject` 也照样抛同一个错；
 *   · C：`ctx.get('x')` 对不存在的服务**静默返回 `undefined`**（不抛）—— 这正是"可选"所需的语义。
 *
 * （原始探针为一次性脚本，已按本项目惯例删除；其结论由上述常驻判据持续守护。）
 *
 * ⇒ 结论：**必需服务留在 `inject`（缺了就该整体不激活，这是正确的失败）**，
 *   **可选服务移出 `inject`、改走 `ctx.get`**（缺了只让对应功能降级，不牵连其它子模块）。
 */
const REQUIRED_SERVICES = ['webServer', 'settings', 'sessions', 'tools', 'systemPrompt'] as const

/**
 * 可选服务：**缺失不影响其它子模块**，只是依赖它的那条功能路径降级。
 *
 * 逐个说明「为什么它是可选」：
 *   · `llm` / `agentDefaultModel` —— 只被「导入管线 AI 语义分类」「剧情记忆的楼层总结」
 *     「MVU 额外分析」用到；未配置模型时本就走 503 降级分支（见 `dsh-plugin:6486`、
 *     `memory:1227` 的 `if (!ctx.llm) return ...503` / `throw 'llm service unavailable'`）。
 *     即**调用点早已按"可能没有"写**，只是 `inject` 声明与这个假设不一致。
 *   · `credentials` —— 仅导入中心写 API key 时用（`dsh-plugin:6292` 已写 `ctx.settings && ctx.credentials` 双守卫）。
 *   · `connection` —— 仅 0.1.2+ 的 token 鉴权 cookie 交换用；
 *     `dsh-plugin:2055` 已按 `conn?.browserAuth?.launchToken` 可选读取，旧版 DSH 无此服务也能跑。
 *   · `agents` —— 仅 open-chat 后同步内核 agent 的 turn 计数用；
 *     `dsh-plugin:6433` 等处已写 `ctx.agents?.get(...)` 可选链。
 */
const OPTIONAL_SERVICES = ['llm', 'agentDefaultModel', 'credentials', 'connection', 'agents'] as const

/**
 * 总包 `inject`：**只声明必需服务**（B1）。
 *
 * ⚠️ 这是**真正生效**的 services 声明（子模块的 `inject` 已降为内部常量/注释）。
 */
// @adapt contract:loader.services
export const inject = [...REQUIRED_SERVICES]

// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）

/**
 * 为子模块构造一个「可选服务降级」的 ctx 视图（B1 的落地手法）。
 *
 * ## 为什么需要它
 *
 * 可选服务移出 `inject` 后，子模块内部那些**直接属性访问**（`ctx.llm`、
 * `ctx.agentDefaultModel` …，5 个子模块共 60+ 处）会因「未 inject」而抛错。
 * 两种修法：
 *   (a) 逐个把 60+ 处改成 `ctx.get('llm')` —— 改动面大，且容易漏改出静默缺陷；
 *   (b) **在总包层包一层 Proxy 视图**：读「可选服务」自动走 `ctx.get(name)`。
 * 本实现选 (b)：**子模块源码零改动**，统一在入口处收口，语义等价于 (a)。
 *
 * ## 语义保证（由 `scripts/verify-rp-consolidation.mjs` 判据 11 常驻守护）
 *   · 必需服务：**原样透传**（保持 cordis 的注入保护 —— 缺必需服务仍应在别处正确失败）；
 *   · 可选服务：走 `ctx.get(name)`，缺则 `undefined`，**不抛**；
 *   · 方法（`ctx.on` / `ctx.effect` / `ctx.waterfall` / `ctx.emit` …）：
 *     **绑定到原 ctx**（cordis 的 mixin 已 bind，但 Proxy 取值后仍需保 `this`）。
 */
function makeOptionalServiceView<T extends object>(ctx: T, optional: readonly string[]): T {
  const optSet = new Set(optional)
  return new Proxy(ctx, {
    get (target, prop, receiver) {
      // 可选服务：改走 ctx.get（缺 ⇒ undefined，不抛）
      if (typeof prop === 'string' && optSet.has(prop)) {
        const get = (target as unknown as { get?: (n: string) => unknown }).get
        return typeof get === 'function' ? get.call(target, prop) : undefined
      }
      const value = Reflect.get(target, prop, receiver)
      // 方法必须绑定原 ctx：子模块会 `ctx.on(...)` / `ctx.effect(...)`，脱离 receiver 会丢 this
      return typeof value === 'function' ? value.bind(target) : value
    },
    has (target, prop) { return Reflect.has(target, prop) },
  })
}

/** 子插件注册表（**顺序即语义**，详见文件头「顺序不变量」；不得重排） */
const SUB_PLUGINS: Array<{ label: string; apply: (ctx: never, config: unknown) => void }> = [
  { label: 'dsh-plugin(RP 主干)', apply: applyRp as (ctx: never, config: unknown) => void },
  { label: 'dsht-plugin-mvu', apply: applyMvu as (ctx: never, config: unknown) => void },
  { label: 'dsht-plugin-tavern-helper', apply: applyTavernHelper as (ctx: never, config: unknown) => void },
  { label: 'dsht-plugin-prompt-template', apply: applyPromptTemplate as (ctx: never, config: unknown) => void },
  { label: 'dsht-plugin-memory', apply: applyMemory as (ctx: never, config: unknown) => void },
]

/**
 * 总包入口：按固定顺序调用 5 个子模块的 `apply`。
 *
 * 子模块 `apply` 内部各自完成：注册 HTTP 路由前缀、注册设置命名空间、挂 `agent/pre-step` 等钩子。
 * 本包**不做任何包装或改写**——传同一个 ctx 视图、同一个 `config`，
 * 保持与"5 个独立包"时**逐字一致的调用形态**（只多了一层可选服务降级）。
 */
export function apply(ctx: never, config: unknown): void {
  const view = makeOptionalServiceView(ctx as unknown as object, OPTIONAL_SERVICES) as never
  for (const sub of SUB_PLUGINS) {
    // 出声：合并把"5 个包各自加载"变成"1 个包内顺序加载"，出问题时要能一眼看出死在哪一个。
    // 不用 console.log（避免每轮噪声）：仅在加载期打印一次。
    console.log(`[dsht-rp] 装载子模块：${sub.label}`)
    sub.apply(view, config)
  }
  console.log(`[dsht-rp] 总包装载完成（${SUB_PLUGINS.length} 个子模块，顺序不变）`)
}
