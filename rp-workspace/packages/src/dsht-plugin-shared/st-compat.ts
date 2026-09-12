/**
 * ST 兼容版本声明（单源）—— 宿主页 `/version` 端点的唯一事实来源。
 *
 * ## 为什么需要它（真实缺陷，心跳 57 实机取证）
 *
 * 卡/扩展的**宿主注入脚本**普遍用「取 ST 版本号 → 按版本分叉」决定走新版还是旧版代码路径。
 * 真 TH 卡 `inject.js` 的写法（`tmp/t37-inject.js:2210-2218`）就是标准形态：
 *
 * ```js
 * await fetch('/version')                      // ← 相对宿主 origin
 *   .then(res => res.json())
 *   .then(data => { const v = data.pkgVersion.split('.')
 *     window.versionNumber = +v[0]*10000 + +v[1]*100 + +v[2] })
 *   .catch(() => { window.versionNumber = 10000 })   // ← 取不到就**静默**落回旧版
 * ```
 *
 * 卡随后用 `versionNumber >= 11305` 分叉（该脚本内 **20+ 处**），其中最关键的一处是正则绑定
 * （`:3565-3566` 原文注释：`11305+ has built-in regex binding; ST is source of truth, only sync FROM ST`）。
 *
 * **基准值（TauriTavern）**：`src/compat-version.js:1` → `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`，
 * 由 `/version` 返回（`src/tauri-bridge.js:162-171`）→ 卡得 `11800`，**走新版路径**。
 *
 * **我方缺陷**：宿主页**没有 `/version` 端点**（实机 `GET /version → 404`）→ 卡 `catch` 分支
 * → `versionNumber = 10000` → **恒走旧版路径** —— 于是去找 ST 旧版正则面板的 DOM
 *（`#saved_regex_scripts` 等 17 个 id），而 DSH 宿主页里一个都没有 → 首个异常即中断整个 bootstrap
 *（`ChatSquash()` / `MacroNest()` / 工具注册全不执行）。
 *
 * 这是 L36「跟基准一致**既不能少也不能多**」的「少了」一侧：基准有的端点我们没有，
 * 于是**第三方代码走了基准不会走的分支**。修法与值都应与基准逐字对齐。
 *
 * ## 硬约束
 * - 本合同**只声明版本**，不复制 ST 代码；值必须与基准 `compat-version.js` 逐字一致。
 * - `'/version'` 是 **ST 的标准端点**（非我方命名空间），改值等于改兼容面 → 任何改动都要重跑
 *   `st-compat.spec.ts` 的黄金母版断言（新增/减少即报警）。
 */

/** 与基准 `TauriTavern/src/compat-version.js` 逐字一致的 ST 兼容版本 */
export const SILLYTAVERN_COMPAT_VERSION = '1.18.0'

/**
 * `getContext().mainApi` 的取值（单源）—— 心跳 65 · T-75。
 *
 * ## 为什么必须有（实测缺陷，不是"语义待定"）
 * 基准 `st-context.js:206` 是 `mainApi: main_api`，值来自持久化设置
 * （`script.js:9106-9119` 的迁移分支给出值域：`'kobold' | 'openai' | 'novel' | 'textgenerationwebui'`；
 * 聊天补全模式即 `'openai'`）。该字段在第三方脚本里被当作**后端分类标签**用，而且是**硬闸门**：
 *
 * ```js
 * // 梦鲸思客预设「格式补全 1.2」（**设备上 enabled**，语料实测）
 * function k() {
 *   return 'openai' !== SillyTavern.mainApi
 *     ? Promise.reject(new Error('当前 API 不是聊天补全，无法使用提示词查看器方式提取提示词。'))
 *     : 'no_connection' === SillyTavern.onlineStatus
 *       ? Promise.reject(new Error('未连接到 API，无法提取提示词。'))
 *       : new Promise(/* 真正干活 *\/)
 * }
 * ```
 *
 * **我方缺陷**：帧内两面都没有 `mainApi`（`undefined`）⇒ `'openai' !== undefined` 恒 **true**
 * ⇒ 直接 reject ⇒「提示词查看器 / 格式补全」**整条功能不可用**（静默失败族，且是闸门式 fatal）。
 *
 * ## 为什么值是 `'openai'`（而不是"随便填一个"）
 * 该标签回答的问题是「后端是不是聊天补全通道」。本项目的 RP 出站请求**就是** chat-completions
 * 语义（`llm/stream` 收 messages 数组、`golden/` 抓包逐字为 messages+可选 tools），
 * 且 ST 在聊天补全模式下给的正是 `'openai'`。⇒ 这是**唯一如实值**，不是占位符。
 * 值域里其余三项（kobold / novel / textgenerationwebui）描述的都是本项目**不存在**的后端类型。
 *
 * ## 刻意**不**一起补的相邻字段
 * `onlineStatus`（基准 `st-context.js:139: onlineStatus: online_status`）**判「不补」**：
 *  · **它的语义不是"在线/离线开关"，而是当前 AI 后端的在线标识 / 模型名** —— 值域含
 *    `'no_connection'`（初值）与 `'koboldcpp/ggml-model-…'` 之类，且**有生命周期**
 *    （写入点唯一，改完 `emitAndWait(event_types.ONLINE_STATUS_CHANGED)`）。
 *    详见 **LEARNINGS L101**（该条正是为纠正"从名字推语义"而写）。
 *  · 我方**没有** ST 式连通性检查 ⇒ 任何常量（含 `'no_connection'`）都是**编造连通性结论**，
 *    且会让 `if (online_status === 'no_connection') return;` 这类分支走向**错误的一侧**。
 *  · 卡里那道闸门写成 `'no_connection' === onlineStatus` ⇒ 我方缺省 `undefined` 使比较为 **false**
 *    ⇒ **不阻塞**（与 `mainApi` 的 `!== 'openai'` 方向相反，故不构成缺陷）。
 *  ⇒ 登记为**已知差异**；将来我方有真实连通态（或真实后端标识）再补。
 */
export const DSHT_MAIN_API = 'openai'

/** 卡脚本 `:2214` 同式的版本编码：major*10000 + minor*100 + patch（解析失败 → 旧版基线 10000） */
export function stVersionNumber(version: string = SILLYTAVERN_COMPAT_VERSION): number {
  const parts = String(version).split('.').map(p => Number.parseInt(p, 10))
  if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return 10000
  return parts[0] * 10000 + parts[1] * 100 + parts[2]
}

/**
 * `/version` 响应体（形状对照基准 `tauri-bridge.js:162-171`）。
 *
 * 卡只消费 `pkgVersion`，其余字段是基准同形（`agent` 是 ST 的客户端标识串；
 * `gitRevision`/`gitBranch`/`defaultUpdateChannel` 为 null/缺省，与基准一致）。
 * `dshVersion` / `appVersion` 是我方附加的诊断字段（基准无此二键，**只增不改**，
 * 不影响任何按字段取值的消费方）。
 */
export function stVersionPayload(extra: { dshVersion?: string | null; appVersion?: string | null } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    agent: `SillyTavern:${SILLYTAVERN_COMPAT_VERSION}:DSHTavern`,
    pkgVersion: SILLYTAVERN_COMPAT_VERSION,
    gitRevision: null,
    gitBranch: null,
    defaultUpdateChannel: 'stable',
  }
  if (extra.appVersion != null) body.tauriVersion = extra.appVersion
  if (extra.dshVersion != null) body.dshVersion = extra.dshVersion
  return body
}
