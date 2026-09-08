/**
 * T1.14 消息窗口化（windowing）协调器：千条消息长会话的前端减负。
 *
 * 背景：RpNativeChat 的席位组件（assistant-step / user shadowing）由官方
 * ui-conversation 的 ChatView 逐条调用，滚动容器与消息列表归官方所有、不可改。
 * 故窗口化采用「每条消息自注册 + 共享协调器」形态，而非集中式虚拟滚动列表：
 *
 * - 每条消息组件（useMessageWindowing，见 RpNativeChat.tsx）把自己的外壳 DOM
 *   注册进来；协调器用 scroll 事件（capture 捕获任意滚动容器 + passive +
 *   rAF 节流）批量测 rect，判定各条是否落在「可视带」（视口 ± 像素缓冲）内。
 * - 视口外 → 组件渲染等高占位 div（卸载全部内容 DOM，display iframe 随之
 *   卸载——这是省内存的关键）；滚回可视带 → 重新渲染（display 正则有会话级
 *   缓存，编译结果不重复拉取）。
 * - 占位高度 = 该条最近一次实测高度（ResizeObserver 维护，跨挂载 memo）；
 *   无实测数据用默认估算值。
 * - 滚动锚定：一批翻转发生时，记录「视口内最顶可见条目」的文档坐标锚点；
 *   翻转 commit 后（microtask）重测锚点，按文档坐标差补偿 scrollTop——用户
 *   视觉位置不因占位/实测高度差而漂移，也不抢滚动（只做位置还原，不做寻址滚动）。
 * - 缓冲语义：任务要求的「上下各 10 条」以像素带等价实现（1.5 屏且 ≥2000px，
 *   按 RP 消息典型高度约合 5~10 条）；进入带小于退出带（滞回），边界不振荡。
 * - 会话消息条数 ≤ WINDOWING_THRESHOLD（40）时不启用：全部照常渲染，
 *   行为与未窗口化完全一致。
 *
 * 纯函数（nearBand / enterOverscanPx / exitOverscanPx / anchorDelta /
 * estimatePlaceholderHeight）零 DOM 依赖，单测见 tests/rp-windowing.spec.ts；
 * 协调器为浏览器单例，模块顶层不做任何 window 访问（node 测试可安全 import）。
 */
/** 会话消息条数阈值：≤ 该值不启用窗口化（全渲染，行为与现在完全一致） */
export declare const WINDOWING_THRESHOLD = 40;
/** 可视带缓冲下限（px）：约等于上下各 5~10 条 RP 消息的高度 */
export declare const MIN_OVERSCAN_PX = 2000;
/** 可视带缓冲随视口的放大系数：1.5 屏（长屏设备按比例扩大缓冲） */
export declare const OVERSCAN_VIEWPORT_RATIO = 1.5;
/** 滞回系数：退出带 = 进入带 × 该值。已渲染的条目更晚被占位化，边界不振荡 */
export declare const OVERSCAN_HYSTERESIS = 1.6;
/** 无实测数据时的占位高度默认估算值（px） */
export declare const DEFAULT_PLACEHOLDER_HEIGHT = 160;
/** 最小 rect 面（getBoundingClientRect 的判定所需字段） */
export interface RectLike {
    top: number;
    bottom: number;
}
/**
 * 可视带判定（窗口区间计算的原子操作）：rect 是否落在
 * [-overscanPx, viewportHeight + overscanPx] 开区间带内。
 */
export declare function nearBand(rect: RectLike, viewportHeight: number, overscanPx: number): boolean;
/** 进入带缓冲（px）：未渲染条目滚到距视口该距离内即恢复渲染 */
export declare function enterOverscanPx(viewportHeight: number): number;
/** 退出带缓冲（px）：已渲染条目滚出该距离才占位化（> 进入带，滞回防振荡） */
export declare function exitOverscanPx(viewportHeight: number): number;
/**
 * 滚动锚定补偿差值：锚点「文档坐标」不变量。
 * anchorDocTop = 翻转前 (锚点视口 top + scrollTop)；翻转 commit 后重测 top 与
 * scrollTop，差值即锚点上方内容的净高度变化——scrollTop += delta 后锚点回到
 * 原视口位置。delta === 0 时无需补偿；用户自行滚动的场景下文档坐标守恒、
 * delta 恒为 0（绝不抢滚动）。
 */
export declare function anchorDelta(anchorTopNow: number, scrollTopNow: number, anchorDocTop: number): number;
/**
 * 窗口化翻转语义（recompute 步骤 3 的纯函数提炼，回归锁）：
 * 在可视带（near=true）→ 真实渲染（false）；滚出带 → 占位（true）；
 * forced（流式中）恒渲染。曾在此处写反（windowed=near）导致视口内消息
 * 全部占位、离屏消息全量渲染——实测截图空白后修复，测试锁死语义。
 */
export declare function nextWindowedState(currentWindowed: boolean, forced: boolean, near: boolean): boolean;
/** 占位高度估算：最近实测优先（>0 的有限数），否则默认估算值 */
export declare function estimatePlaceholderHeight(cached: number | null | undefined, fallback?: number): number;
/**
 * 最近滚动祖先（DOM 薄壳）：向上找 overflow-y 可滚动的元素；兜底文档滚动根。
 * 仅浏览器环境调用（补偿执行路径），node 测试不触及。
 */
export declare function findScrollAncestor(el: Element): HTMLElement | null;
/** windowed 状态订阅（供 useSyncExternalStore） */
export declare function subscribeWindowing(listener: () => void): () => void;
/** 该条消息当前是否窗口化（占位中）。未注册 → false（全渲染兜底） */
export declare function isMessageWindowed(sessionKey: string, nodeKey: string): boolean;
/** 该条消息的占位高度：最近实测（含跨挂载 memo）优先，否则默认估算值 */
export declare function messagePlaceholderHeight(sessionKey: string, nodeKey: string): number;
/**
 * 注册一条消息外壳。重复调用（forced 等依赖变化触发的重注册）更新既有 entry。
 * 返回注销函数（组件卸载时调用：实测高度存 memo，registry 空则整体断电）。
 */
export declare function registerMessageWindowing(reg: {
    sessionKey: string;
    nodeKey: string;
    el: HTMLElement;
    forced?: boolean;
}): () => void;
/**
 * 翻转 commit 回执（组件在 useLayoutEffect 中调用，仅 windowed 变化时）：
 * 所有翻转条目 commit 完成后统一执行锚点补偿（microtask，paint 前生效）。
 */
export declare function reportWindowCommit(): void;
