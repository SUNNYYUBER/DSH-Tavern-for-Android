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
// ---------------------------------------------------------------------------
// 常量与纯函数（单测覆盖：窗口区间计算 / 高度补偿 / 占位高度估算）
// ---------------------------------------------------------------------------
/** 会话消息条数阈值：≤ 该值不启用窗口化（全渲染，行为与现在完全一致） */
export const WINDOWING_THRESHOLD = 40;
/** 可视带缓冲下限（px）：约等于上下各 5~10 条 RP 消息的高度 */
export const MIN_OVERSCAN_PX = 2000;
/** 可视带缓冲随视口的放大系数：1.5 屏（长屏设备按比例扩大缓冲） */
export const OVERSCAN_VIEWPORT_RATIO = 1.5;
/** 滞回系数：退出带 = 进入带 × 该值。已渲染的条目更晚被占位化，边界不振荡 */
export const OVERSCAN_HYSTERESIS = 1.6;
/** 无实测数据时的占位高度默认估算值（px） */
export const DEFAULT_PLACEHOLDER_HEIGHT = 160;
/**
 * 可视带判定（窗口区间计算的原子操作）：rect 是否落在
 * [-overscanPx, viewportHeight + overscanPx] 开区间带内。
 */
export function nearBand(rect, viewportHeight, overscanPx) {
    return rect.bottom > -overscanPx && rect.top < viewportHeight + overscanPx;
}
/** 进入带缓冲（px）：未渲染条目滚到距视口该距离内即恢复渲染 */
export function enterOverscanPx(viewportHeight) {
    return Math.max(viewportHeight * OVERSCAN_VIEWPORT_RATIO, MIN_OVERSCAN_PX);
}
/** 退出带缓冲（px）：已渲染条目滚出该距离才占位化（> 进入带，滞回防振荡） */
export function exitOverscanPx(viewportHeight) {
    return enterOverscanPx(viewportHeight) * OVERSCAN_HYSTERESIS;
}
/**
 * 滚动锚定补偿差值：锚点「文档坐标」不变量。
 * anchorDocTop = 翻转前 (锚点视口 top + scrollTop)；翻转 commit 后重测 top 与
 * scrollTop，差值即锚点上方内容的净高度变化——scrollTop += delta 后锚点回到
 * 原视口位置。delta === 0 时无需补偿；用户自行滚动的场景下文档坐标守恒、
 * delta 恒为 0（绝不抢滚动）。
 */
export function anchorDelta(anchorTopNow, scrollTopNow, anchorDocTop) {
    return anchorTopNow + scrollTopNow - anchorDocTop;
}
/**
 * 窗口化翻转语义（recompute 步骤 3 的纯函数提炼，回归锁）：
 * 在可视带（near=true）→ 真实渲染（false）；滚出带 → 占位（true）；
 * forced（流式中）恒渲染。曾在此处写反（windowed=near）导致视口内消息
 * 全部占位、离屏消息全量渲染——实测截图空白后修复，测试锁死语义。
 */
export function nextWindowedState(currentWindowed, forced, near) {
    const next = forced ? false : !near;
    return next === currentWindowed ? currentWindowed : next;
}
/** 占位高度估算：最近实测优先（>0 的有限数），否则默认估算值 */
export function estimatePlaceholderHeight(cached, fallback = DEFAULT_PLACEHOLDER_HEIGHT) {
    return cached !== null && cached !== undefined && Number.isFinite(cached) && cached > 0 ? cached : fallback;
}
/**
 * 最近滚动祖先（DOM 薄壳）：向上找 overflow-y 可滚动的元素；兜底文档滚动根。
 * 仅浏览器环境调用（补偿执行路径），node 测试不触及。
 */
export function findScrollAncestor(el) {
    let node = el.parentElement;
    while (node !== null) {
        const oy = window.getComputedStyle(node).overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
            return node;
        node = node.parentElement;
    }
    const doc = el.ownerDocument;
    const scroller = doc?.scrollingElement ?? null;
    return scroller instanceof HTMLElement ? scroller : null;
}
/** sessionKey → (nodeKey → entry)。占位 div 同样注册（滚回判定需要它的 rect） */
const registry = new Map();
/** 外壳元素 → entry（ResizeObserver 回调反查） */
const elToEntry = new Map();
/** 跨挂载高度 memo：注销时写入最近实测高度，重挂载时读回（滚回来/切回会话占位更准） */
const heightMemo = new Map();
const HEIGHT_MEMO_LIMIT = 5000;
/** React useSyncExternalStore 订阅面（windowed 状态翻转时通知） */
const listeners = new Set();
/** 待执行的锚点补偿任务（一批翻转最多一份，执行即清） */
let pendingCompensation = null;
let rafId = null;
let listening = false;
let resizeObserver = null;
let compensationQueued = false;
/** windowed 状态订阅（供 useSyncExternalStore） */
export function subscribeWindowing(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
/** 该条消息当前是否窗口化（占位中）。未注册 → false（全渲染兜底） */
export function isMessageWindowed(sessionKey, nodeKey) {
    return registry.get(sessionKey)?.get(nodeKey)?.windowed === true;
}
/** 该条消息的占位高度：最近实测（含跨挂载 memo）优先，否则默认估算值 */
export function messagePlaceholderHeight(sessionKey, nodeKey) {
    const cached = registry.get(sessionKey)?.get(nodeKey)?.height
        ?? heightMemo.get(`${sessionKey}::${nodeKey}`)
        ?? null;
    return estimatePlaceholderHeight(cached);
}
/**
 * 注册一条消息外壳。重复调用（forced 等依赖变化触发的重注册）更新既有 entry。
 * 返回注销函数（组件卸载时调用：实测高度存 memo，registry 空则整体断电）。
 */
export function registerMessageWindowing(reg) {
    const { sessionKey, nodeKey, el } = reg;
    const forced = reg.forced === true;
    const memoKey = `${sessionKey}::${nodeKey}`;
    ensureListening();
    let entries = registry.get(sessionKey);
    if (entries === undefined) {
        entries = new Map();
        registry.set(sessionKey, entries);
    }
    let entry = entries.get(nodeKey);
    if (entry === undefined) {
        entry = { sessionKey, nodeKey, el, forced, windowed: false, height: heightMemo.get(memoKey) ?? null };
        entries.set(nodeKey, entry);
    }
    else {
        // 重注册（el 可能因重挂载变化）：DOM 引用与 forced 取最新，windowed 保持
        entry.el = el;
        entry.forced = forced;
    }
    elToEntry.set(el, entry);
    const ro = ensureResizeObserver();
    ro?.observe(el);
    scheduleRecompute();
    return () => {
        if (entry.height !== null && entry.height > 0) {
            if (heightMemo.size >= HEIGHT_MEMO_LIMIT)
                heightMemo.clear();
            heightMemo.set(memoKey, entry.height);
        }
        elToEntry.delete(el);
        ro?.unobserve(el);
        entries.delete(nodeKey);
        if (entries.size === 0)
            registry.delete(sessionKey);
        if (registry.size === 0)
            teardown();
        scheduleRecompute();
    };
}
/**
 * 翻转 commit 回执（组件在 useLayoutEffect 中调用，仅 windowed 变化时）：
 * 所有翻转条目 commit 完成后统一执行锚点补偿（microtask，paint 前生效）。
 */
export function reportWindowCommit() {
    if (pendingCompensation === null || compensationQueued)
        return;
    compensationQueued = true;
    queueMicrotask(() => {
        compensationQueued = false;
        const task = pendingCompensation;
        pendingCompensation = null;
        if (task === null)
            return;
        const top = task.anchorEl.getBoundingClientRect().top;
        const delta = anchorDelta(top, task.container.scrollTop, task.anchorDocTop);
        if (delta !== 0) {
            // 只做位置还原（占位↔实测高度差的抵消），不做任何寻址滚动
            task.container.scrollTop += delta;
        }
        // 补偿改变了滚动位置 → 下一帧重新评估可视带
        scheduleRecompute();
    });
}
// ---- 内部：滚动监听 / ResizeObserver / recompute ---------------------------
function onScrollCaptured() {
    scheduleRecompute();
}
/** 惰性安装：scroll 用 capture 捕获任意滚动容器（scroll 不冒泡）+ passive + resize */
function ensureListening() {
    if (listening)
        return;
    listening = true;
    window.addEventListener('scroll', onScrollCaptured, { capture: true, passive: true });
    window.addEventListener('resize', onScrollCaptured);
}
function teardown() {
    if (!listening)
        return;
    listening = false;
    window.removeEventListener('scroll', onScrollCaptured, true);
    window.removeEventListener('resize', onScrollCaptured);
    resizeObserver?.disconnect();
    resizeObserver = null;
}
/** 共享 ResizeObserver：实测外壳高度 → entry.height（不通知 React，零重渲染） */
function ensureResizeObserver() {
    if (resizeObserver !== null)
        return resizeObserver;
    if (typeof ResizeObserver !== 'function')
        return null;
    resizeObserver = new ResizeObserver(items => {
        for (const item of items) {
            const entry = elToEntry.get(item.target);
            if (entry === undefined)
                continue;
            const box = item.borderBoxSize?.[0];
            const size = box?.blockSize;
            if (typeof size === 'number' && Number.isFinite(size) && size > 0)
                entry.height = size;
        }
    });
    return resizeObserver;
}
function scheduleRecompute() {
    if (rafId !== null)
        return;
    if (typeof requestAnimationFrame !== 'function') {
        // 非 DOM 环境（如 node 单测 import 本模块）永不触达；兜底同步执行
        recompute();
        return;
    }
    rafId = requestAnimationFrame(() => { recompute(); });
}
/** 核心：批量测 rect → 判定可视带 → 翻转窗口化状态 → 布置锚点补偿 */
function recompute() {
    rafId = null;
    if (registry.size === 0)
        return;
    const vh = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0
        ? window.innerHeight
        : 800;
    const enterPx = enterOverscanPx(vh);
    const exitPx = exitOverscanPx(vh);
    let changed = false;
    for (const entries of registry.values()) {
        // ≤ 阈值：该会话不启用窗口化，全部复位为真实渲染
        if (entries.size <= WINDOWING_THRESHOLD) {
            for (const entry of entries.values()) {
                if (entry.windowed) {
                    entry.windowed = false;
                    changed = true;
                }
            }
            continue;
        }
        // 1) 同一帧内一次性批读所有 rect（滚动不脏布局，读的是干净布局值）
        const rects = new Map();
        for (const entry of entries.values()) {
            const r = entry.el.getBoundingClientRect();
            rects.set(entry, { top: r.top, bottom: r.bottom });
        }
        // 2) 滚动锚点 = 视口内最顶可见条目（非 forced；视口内条目恒渲染、必不翻转，
        //    故其文档坐标在翻转前后只受「上方内容净高度变化」影响）
        let anchor = null;
        for (const [entry, rect] of rects) {
            if (entry.forced)
                continue;
            if (rect.bottom > 0 && rect.top < vh && (anchor === null || rect.top < anchor.top)) {
                anchor = { entry, top: rect.top };
            }
        }
        // 3) 翻转窗口化状态（滞回：进入带窄、退出带宽，边界条目不振荡）。
        //    语义：在带内 = 真实渲染（windowed=false）；滚出带 = 占位（windowed=true）。
        let flipped = false;
        for (const [entry, rect] of rects) {
            const near = entry.forced
                ? true
                : entry.windowed
                    ? nearBand(rect, vh, exitPx)
                    : nearBand(rect, vh, enterPx);
            const nextWindowed = nextWindowedState(entry.windowed, entry.forced, near);
            if (nextWindowed !== entry.windowed) {
                entry.windowed = nextWindowed;
                flipped = true;
                changed = true;
            }
        }
        // 4) 有翻转 → 布置锚点补偿任务（锚点本批未翻转时才有效）
        if (flipped && anchor !== null) {
            // 锚点本批被占位化：换视口内未翻转的次级可见条目当锚（旧实现直接放弃
            // 补偿 → 快速滚动时视觉位置漂移）
            if (anchor.entry.windowed) {
                let alt = null;
                for (const [entry, rect] of rects) {
                    if (entry.forced || entry.windowed)
                        continue;
                    if (rect.bottom > 0 && rect.top < vh && (alt === null || rect.top < alt.top))
                        alt = { entry, top: rect.top };
                }
                if (alt !== null)
                    anchor = alt;
            }
            if (!anchor.entry.windowed) {
                const container = findScrollAncestor(anchor.entry.el);
                if (container !== null) {
                    // 禁用浏览器原生滚动锚定（2026-09-04 用户报告"会话缓慢自动上滑"）：
                    // 占位↔实测的高度变化会同时触发原生 overflow-anchor 与本协调器的
                    // 锚点补偿——双重修正叠加（卓易通老内核上误差不被 DSH 的 observed-top
                    // ledger 记账）表现为会话缓慢自动上漂、强滑到底后因官方吸底逻辑掩盖
                    // 而"消失"。二者只能留一个：翻转高度差由本协调器全权补偿。
                    if (container.style.overflowAnchor !== 'none')
                        container.style.overflowAnchor = 'none';
                    pendingCompensation = {
                        container,
                        anchorEl: anchor.entry.el,
                        anchorDocTop: anchor.top + container.scrollTop,
                    };
                }
            }
        }
    }
    if (changed) {
        // useSyncExternalStore 订阅者同步重渲染翻转条目 → 其 layoutEffect 回执
        // reportWindowCommit → microtask 补偿（paint 前生效，无闪烁）
        for (const fn of listeners)
            fn();
    }
}
