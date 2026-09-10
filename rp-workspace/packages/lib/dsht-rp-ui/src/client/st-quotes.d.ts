/**
 * ST 台词着色（SillyTavern messageFormatting 的 <q> 包裹等价物，渲染层 DOM 形态）。
 *
 * 出处对照：ST public/script.js messageFormatting L1845-1871 —— 引号文本（"…"/“…”/«…»/
 * 「…」/『…』/＂…＂）→ <q> 元素；style.css L554 `.mes_text q { color: var(--SmartThemeQuoteColor) }`。
 * 用户 ST 实测主题（settings.json power_user）：quote_text_color = rgba(225,138,36,1)（橙）。
 *
 * 为何是渲染后 DOM 包裹而不是源码注入 <q>：宿主 MarkdownText（micromark/mdast React 渲染器，
 * 宿主 bundle ic 组件）对 mdast html 节点 `case"html": return n.value` —— 原样当文本渲染，
 * 源码注入 <q> 会字面露出。inline-html 通道虽可透传元素，但散文通道是 markdown——故渲染后
 * 对 body DOM 做文本节点扫描包裹（视觉与 ST 等价；代码块/已包裹区跳过；TreeWalker 不进
 * iframe 文档，卡内样式不受影响——与 ST 的 TH iframe 语义一致）。
 */
/** 幂等性：已包裹的引号在 <q> 内（insideProtected 跳过）→ 重跑天然安全；流式新增文本重跑即补 */
export declare function wrapStQuotes(root: HTMLElement): void;
