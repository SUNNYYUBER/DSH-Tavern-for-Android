/**
 * display 三段编译 + 两趟 display 正则 + iframe 文档骨架（P0-2 / P0-3，REF_PROJECTS_COMPARISON.md 领域二）。
 *
 * 出处（均为 MIT 许可参考源码，引用处已对照移植）：
 * - 三段编译：dsh-agent-rp `src/card-display-compiler.ts`（compileCharacterDisplay L264、
 *   sourceLines/isFrontendDocument/splitLeadingHtmlBlock/htmlTagsOutsideCode）；
 *   HTML_DISPLAY_TAGS 含 agent-loop-rp 同文件 L35-49 的 SVG 扩展。
 * - 两趟执行：dsh-agent-rp `src/frontend-regex.ts` runScripts L285（先通用
 *   !markdownOnly&&!promptOnly，再 display→markdownOnly 专属）。
 * - 私用区 token 隔离 + 防空白守卫：dsh-tavern `lib/domain/tavern-regex-display.js`
 *   renderTavernRegexDisplay L96-160（presentationParts[] + DSH_TAVERN_REGEX_i token
 *   + 整轮覆盖回退原文 L136-147）。
 * - iframe 文档骨架：dsh-tavern `lib/client.js` buildTavernFrameDocument/clampTavernFrameHeight/
 *   TavernMessageFrame L883-941（高度上报 postMessage + clamp [48,12000]）。
 *
 * 与参考的有意偏差：markdown 段不做未知标签剥离——未知/自定义标签（tip 等）的折叠
 * 兜底归 output-protocol 层单点负责，避免两处语义分叉。
 *
 * 用户痛点根因：悬浮球/剧情按钮/tip 的 display 产出是完整 HTML 片段或文档，
 * 旧链路的 sanitize 白名单直接整体丢弃。三段编译把「完整文档」切进 iframe 舞台
 * （sandbox="allow-scripts"，position:fixed 部件在 iframe 内正常运行）。
 */
import type { RegexScript } from '../../../regex/engine.ts';
import { expandDisplayMacros, type DisplayMacroCtx } from './macros-display.ts';
/** display 文本的一个有序段 */
export type DisplaySegment = {
    readonly kind: 'markdown';
    readonly text: string;
} | {
    readonly kind: 'html';
    readonly source: string;
} | {
    readonly kind: 'inline-html';
    readonly source: string;
};
/**
 * 把 display 正则替换后的文本切成有序三段（参考源码 compileCharacterDisplay）：
 * - ```html 围栏 / 含 doctype·html·head·body 的完整文档 → {kind:'html'}（进 iframe）；
 * - 行首平衡 HTML 块（<div>…</div> 等）→ {kind:'inline-html'}（sanitize 内联）；
 * - 其余散文 → {kind:'markdown'}（MarkdownText）。
 */
export declare function compileDisplaySegments(value: string): DisplaySegment[];
/** 编译产物是否需要 iframe 渲染（含完整文档段） */
export declare function hasFrameSegment(segments: readonly DisplaySegment[]): boolean;
export interface DisplayScriptHit {
    readonly id: string;
    readonly name: string;
    readonly matches: number;
}
export interface DisplayRunResult {
    /** 全部替换完成、token 统一还原后的文本 */
    readonly text: string;
    readonly applied: readonly DisplayScriptHit[];
    readonly warnings: readonly string[];
}
/**
 * display 视图的两趟执行（P0-3）：
 * 1. 先跑通用脚本（!markdownOnly && !promptOnly）；
 * 2. 再跑 markdownOnly（仅显示）专属脚本——两趟内脚本各自保持数组顺序。
 *
 * 每个替换产物存入 presentationParts[]，正文只留 DSH_RP_REGEX_i token，
 * 全部替换完成后统一还原——后续正则不会把前一个正则产出的 HTML 标记当正文二次污染。
 * 防空白守卫：替换后整轮为空则回退原文（dsh-tavern L136-147 思路）。
 */
export declare function runDisplayScripts(scripts: readonly RegexScript[], source: string, depth: number | null): DisplayRunResult;
export declare const FRAME_MAX_HEIGHT = 12000;
export declare const FRAME_MIN_HEIGHT = 48;
/** 参考源码 clampTavernFrameHeight */
export declare function clampFrameHeight(value: number): number;
/** iframe 消息类型常量（宿主侧 message 校验用） */
export declare const FRAME_HEIGHT_MESSAGE_TYPE = "dsht-rp-frame-height";
/**
 * 组装 iframe srcdoc（参考源码 buildTavernFrameDocument）：
 * - 完整文档段（含 doctype/html）：高度上报脚本注入 </body> 前，保留文档自身结构；
 * - HTML 片段：包进带 CSP/基础样式的文档骨架。
 * sandbox="allow-scripts" 由组件侧声明（不给 allow-same-origin）。
 */
export declare function buildDisplayFrameDocument(source: string, token: string): string;
export { expandDisplayMacros };
export type { DisplayMacroCtx };
/** 加载显示期宏上下文（identity + variables 并行；任一失败 → null = 原文透传） */
export declare function loadDisplayRenderCtx(slug: string, sessionId: string): Promise<DisplayMacroCtx | null>;
export interface RenderEntries {
    before: string;
    after: string;
}
/** 加载 [RENDER] 包裹（失败透传空 = 不包裹；是否启用由 ejs renderLoaderEnabled 在消费端裁决） */
export declare function loadRenderEntries(slug: string, sessionId: string): Promise<RenderEntries>;
export interface EjsDisplaySettings {
    /** 扩展总开关（enabled=false 时 B6/B8 都不生效） */
    enabled: boolean;
    /** [RENDER] 特性（B6 包裹） */
    renderLoaderEnabled: boolean;
    /** 处理原始消息内容（B8 客户端写回） */
    permanentEvaluation: boolean;
    /** 世界书代码编辑器（B17 RpLorePanel 轻量编辑器） */
    codeEditor: boolean;
}
/** 加载 EJS 设置（GET /dsht-prompt-template/settings；失败 → null = 调用方按关闭处理） */
export declare function loadEjsDisplaySettings(): Promise<EjsDisplaySettings | null>;
export interface ThRenderSettings {
    /** 启用渲染（false = 前端 HTML/B6 包裹退纯文本；正则/宏各自独立不受它管） */
    enabled: boolean;
    /** 渲染深度：仅处理楼层深度 ≤ 此值的楼层（0 = 仅最新楼层；数据面不可达按 -1 不降级） */
    depth: number;
    /** 深度计算忽略隐藏楼层（回退掩码剔除） */
    depthIgnoreHidden: boolean;
    /** 折叠代码块：all/frontend_only 折叠（本管线前端围栏走 iframe，两者 DOM 面一致），none 不折叠 */
    collapseCodeBlock: 'all' | 'frontend_only' | 'none';
    /** 允许流式渲染（false = 流式期间不出 iframe 段，定稿后再渲染） */
    allowStreaming: boolean;
    /** Blob URL 渲染（iframe 用 blob: 而非 srcdoc） */
    useBlobUrl: boolean;
    /** 优化代码高亮（对 <pre> 做轻量关键字高亮；宿主 MarkdownText 无 hljs，由本管线补） */
    optimizeHljs: boolean;
}
/** 加载 TH 渲染组设置（GET /dsht-tavern-helper/settings；失败 → null = 调用方按全开/不限处理） */
export declare function loadThRenderSettings(): Promise<ThRenderSettings | null>;
/**
 * B8 写回：渲染成功且宏展开确有变化的 assistant 楼层，把展开结果写回会话
 * （POST /dsht-prompt-template/permanent {sessionId, seq, text}；服务端 replace
 * 原语 + ejsProcessed 标记）。按 sessionId::seq 幂等去重——重渲染不重发；
 * 失败 console.warn 一次（Set 已占位，不重试不刷屏）。
 */
export declare function reportPermanentRender(sessionId: string, seq: number, text: string): void;
export interface PreEnhanceOptions {
    collapse: boolean;
    hljs: boolean;
}
/** 对 root 内全部 <pre> 做一次增强（幂等：highlight 查 span 标记 / collapse 查 class，
 *  不落 dataset——React 重写 children 后高亮标记丢失时能自然补齐） */
export declare function enhancePreBlocks(root: HTMLElement, opts: PreEnhanceOptions): void;
