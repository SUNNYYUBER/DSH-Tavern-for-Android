/**
 * DSH web 宿主「模块表直供」的 client 侧模块声明。
 *
 * 背景（T-34，2026-09-11）：`@deepseek-ai/dsh-client-ui-slots` 与 `...-primitives` 是
 * **浏览器运行时**由宿主的 import map 注入的模块——本仓库的 `node_modules` 里**没有**它们
 * （它们不是 npm 依赖，而是宿主页面提供的 shell 模块）。构建脚本把二者列进 esbuild
 * `external`（`scripts/build-rp-ui.mjs:196`、`build-mobile.mjs:44`、`build-undo.mjs:49`），
 * 源码里则用 `import type {} from '...'` 只为拉取官方 ambient 增强。
 *
 * 后果：本地 `tsc` 解析不到这两个模块 → TS2307 ×3，使 UI 层长期无法纳入类型闸门；
 * 而 UI 层缺闸门的代价已经实证——`PresetPanel.tsx` 的 `expandedKey`、`RpScriptHost.tsx` 的
 * `thMessageVarsReplace` 都因**未声明**而在运行时抛 ReferenceError 却无人发现。
 *
 * 本文件只声明我们**实际用到**的最小面（不是伪造完整 API）：
 *  · `ui-slots`：仅作增强载体被 `import type {}` 引入，故只要模块存在即可（shorthand）。
 *  · `ui-primitives`：`MarkdownText` 是值导入（`RpNativeChat.tsx:20`），按其真实调用点
 *    （`text` / `streaming` / `labels`）声明 props。
 * 若将来需要更多成员，**按真实调用点逐条补**，不要退回 `any` —— 那就把闸门又关上了。
 */

declare module '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { JSX } from 'react'

  /**
   * 官方同款 Markdown 渲染器（与宿主会话气泡同一实现，见 RpNativeChat.tsx 头注）。
   * 调用点：`<MarkdownText text={...} streaming={...} labels={...} />`。
   */
  export function MarkdownText(props: {
    /** Markdown 源文本 */
    text: string
    /** 是否处于流式输出中（最后一段） */
    streaming?: boolean
    /**
     * 界面文案的本地化映射。实际调用点传的是嵌套结构
     * （`{ code: { copyLabel, copiedLabel }, footnotes }`，见 RpNativeChat.tsx:1014/1419），
     * 故按真实形状声明，并留字符串索引以容忍宿主新增键。
     */
    labels?: {
      code?: { copyLabel?: string; copiedLabel?: string }
      footnotes?: string
      [key: string]: unknown
    }
  }): JSX.Element
}
