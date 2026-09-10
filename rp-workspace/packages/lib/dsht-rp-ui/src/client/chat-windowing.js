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
/** 待执行的锚点补偿任务（一批翻转最多一份，执行即清）。
 *  【2026-09-08 鲁棒性】过期熔断 + 存活性校验：回执（reportWindowCommit）依赖翻转条目
 *  的 useLayoutEffect；条目在同一 commit 中被卸载/掩码隐藏（return null）时回执丢失，
 *  旧实现下该任务会挂到之后**任意一次**翻转批上应用——跨会话切换后锚点元素已 detach
 *  （rect 全 0），delta = 0 + 当前scrollTop − 旧 anchorDocTop → 视口随机跳（「画面跳来
 *  跳去」的候选向量之一）。翻转批的 commit 恒在同帧落地（useSyncExternalStore 同步
 *  lane），350ms 过期窗口对正常路径零影响，只熔断丢失回执的陈旧任务。 */
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
        entry = { sessionKey, nodeKey, el, forced, windowed: false, height: heightMemo.get(memoKey) ?? null, flipAt: 0 };
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
    // 【2026-09-07】新条目注册即视为活动：重置扩张带并布防空闲计时（首屏加载后
    // 无滚动事件也要能渐进物化全页——不然历史区永远 160px 占位虚空）
    markScrollActivity();
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
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // 过期/元素已失联 → 丢弃（陈旧补偿绝不应用；见 pendingCompensation 注记）
        if (now > task.expiresAt || !task.anchorEl.isConnected || !task.container.isConnected) {
            scheduleRecompute();
            return;
        }
        const top = task.anchorEl.getBoundingClientRect().top;
        const delta = anchorDelta(top, task.container.scrollTop, task.anchorDocTop);
        if (delta !== 0) {
            // 只做位置还原（占位↔实测高度差的抵消），不做任何寻址滚动
            suppressNextScrollActivity();
            task.container.scrollTop += delta;
        }
        // 补偿改变了滚动位置 → 下一帧重新评估可视带
        scheduleRecompute();
    });
}
// ---- 内部：滚动监听 / ResizeObserver / recompute ---------------------------
function onScrollCaptured() {
    markScrollActivity();
    scheduleRecompute();
}
// ---------------------------------------------------------------------------
// 【2026-09-07 空白虚空根修】空闲渐进物化（idle progressive materialization）
// ---------------------------------------------------------------------------
// 上滑浏览历史时，可视带外的楼层全是占位——未实测的楼层占 160px 默认高、曾实测的
// 占真实高度（巨型状态栏楼层可达 1 万 px）。用户停在历史区时视口若落在占位带里，
// 看到的是几千~上万 px 的「空白虚空」+ 滚动条长度反复跳变（ST 全量渲染无此问题）。
// 对策：滚动停止 ~700ms 后进入空闲态，可视带每 400ms 向外扩张一档（渐进渲染，
// 不一次性全量挂载卡帧），直到整页渲染完（≈ST 静态观感）或用户再次滚动（立即
// 归零回正常的窗口化带宽，保住滚动期的内存/帧率收益）。
const IDLE_SETTLE_MS = 700;
const IDLE_STEP_MS = 400;
/** 空闲扩张上限：实测（示例游戏迁移会话）底部真实楼层单层可达 4k~10k px（B8 渲染
 * 后的巨型状态栏），13 层就占 52k 文档高，占位区被推到 45k+ px 外——上限必须
 * 足够大才能把整页收进扩张带（真机实测 40000 不够用）。120000 ≈ 137 屏。 */
const IDLE_BOOST_MAX_PX = 120000;
/** 每个滚动事件对扩张量的扣减（见 markScrollActivity 衰减式收缩注记） */
const IDLE_BOOST_SCROLL_DECAY_PX = 1500;
let idleBoostPx = 0;
let lastActivityAt = 0;
let idleTimer = null;
/** 程序化 scrollTop 写入（补偿）会触发 scroll 事件——该事件不算用户活动，
 * 否则空闲扩张被「翻转→补偿→归零」振荡杀死（真机实测 real 恒 3 不增长）。
 * 用计数器配对（写 N 次 → 抵消 N 个 scroll 事件）；慢设备上事件派发可延迟
 * 超过任意固定时间窗，仅加 1s 过期兜底防泄漏。 */
let suppressScrollCount = 0;
let lastSuppressAt = 0;
function markScrollActivity() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (suppressScrollCount > 0) {
        if (now - lastSuppressAt < 1000) {
            suppressScrollCount--;
            return;
        } // 补偿写入的 scroll，非用户活动
        suppressScrollCount = 0; // 过期计数清零（coalesce 丢事件时不永久抑制）
    }
    lastActivityAt = now;
    // 【衰减式收缩】滚动事件按次扣减扩张量（不硬清零）：DSH 宿主自身的滚动锚定
    // 会随布局变化周期性写 scrollTop（非我方补偿、无法抑制）——硬清零会让空闲扩张
    // 永远到不了位（真机实测 b 反复 0↔6000）。用户真实连滑时事件密集（~10/s），
    // 扣减速率远超扩张速率（+5000/s），boost 仍在秒级归零 → 滚动期窗口化保住。
    idleBoostPx = Math.max(0, idleBoostPx - IDLE_BOOST_SCROLL_DECAY_PX);
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    // 空闲计时只在有注册条目时延续（registry 空时 teardown，无需空转）
    if (registry.size > 0)
        idleTimer = setTimeout(idleExpandTick, IDLE_SETTLE_MS);
}
/** 程序化 scrollTop 写入前调用（补偿路径），抵消紧随的 scroll 活动标记 */
function suppressNextScrollActivity() {
    suppressScrollCount++;
    lastSuppressAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function idleExpandTick() {
    idleTimer = null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastActivityAt < IDLE_SETTLE_MS)
        return; // 期间有滚动 → 不扩张
    if (registry.size === 0)
        return;
    const vh = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 800;
    idleBoostPx = Math.min(idleBoostPx + Math.max(vh * OVERSCAN_VIEWPORT_RATIO, MIN_OVERSCAN_PX), IDLE_BOOST_MAX_PX);
    scheduleRecompute();
    // 已达上限且无新翻转 → 不再排程（恒渲染页）；否则继续下一档
    if (idleBoostPx < IDLE_BOOST_MAX_PX)
        idleTimer = setTimeout(idleExpandTick, IDLE_STEP_MS);
}
/** 【临时调试钩子】验证后移除：暴露空闲扩张内部状态 */
if (typeof window !== 'undefined') {
    window.__dshtWinDebug = {
        get boostPx() { return idleBoostPx; },
        get lastActivityAgo() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastActivityAt; },
        get registered() { let n = 0; for (const m of registry.values())
            n += m.size; return n; },
        get suppressMs() { return Math.max(0, 1000 - ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastSuppressAt)); },
        forceTick() { idleExpandTick(); },
    };
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
    // 【2026-09-07】空闲物化计时一并熄灭（registry 清空后无扩张对象）
    idleBoostPx = 0;
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}
/** 共享 ResizeObserver：实测外壳高度 → entry.height（不通知 React，零重渲染）。
 * 【2026-09-06 匀速滑动修复】视口上方条目高度变化（iframe 渐进上报增高、图片/字体
 * 加载、占位估算校准）会把视口内容往下推——原生 overflow-anchor 已禁用（本协调器
 * 全权补偿），但旧补偿只覆盖「翻转批次」（占位↔实测切换），不覆盖已渲染条目的
 * 内容渐变 → 表现为文字向下匀速滑动露出上方内容（真机两轮报告）。此处对完全在
 * 视口上方（rect.bottom <= 0）的条目按高度差实时补偿 scrollTop，视觉位置静止。
 * 【2026-09-07 双重补偿根除（真机取证）】probe 实测 30s 内 42 次 scrollTop 写入、
 * 视口在相邻大楼层（~5900px）间震荡 ±3000~5900px：占位翻转时「翻转批次锚点补偿」
 * 和本 RO 回调（rect.bottom<=0 分支）对同一次 5900→160 的高度变化各补偿一次 →
 * 过冲 5740px → 视口跳进上一楼层 → 重新翻转 → 循环。本回调现跳过 windowed 条目
 * （翻转高度差由 reportWindowCommit 锚点补偿独家负责），只补真实内容（windowed=
 * false）的渐进增高/收缩。 */
const aboveDeltaByContainer = new Map();
let aboveFlushQueued = false;
function flushAboveDeltas() {
    aboveFlushQueued = false;
    for (const [container, delta] of aboveDeltaByContainer) {
        aboveDeltaByContainer.delete(container);
        if (delta === 0)
            continue;
        suppressNextScrollActivity();
        container.scrollTop += delta;
    }
    scheduleRecompute();
}
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
            if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
                continue;
            const prev = entry.height;
            entry.height = size;
            if (prev !== null && Math.abs(size - prev) >= 1 && item.target.isConnected) {
                // 【双重补偿根除】翻转（占位↔实测）的高度变化由翻转批次锚点补偿独家负责：
                // 跳过 windowed 条目 + 翻转后 250ms 内的 RO 事件（RO 回调异步到达，
                // 两条路径同帧叠加 ±5740px 曾造成视口在大楼层间震荡——真机取证）。
                if (entry.windowed)
                    continue;
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                if (now - entry.flipAt < 250)
                    continue;
                const rect = item.target.getBoundingClientRect();
                // 【2026-09-07 匀速滑动根除（残段）】补偿条件放宽到 top<0：部分可见楼层
                // （rect.top<0 且 bottom>0）渐进增高时，其 top 边不动、bottom 向下生长——
                // 视口下半的内容被持续往下推，正是「文字向下匀速滑动」的残余形态（旧条件
                // rect.bottom<=0 只覆盖完全离场条目）。top<0 的任何增高都等价于「锚点上方的
                // 内容长了 delta」→ scrollTop += delta 后该条目 top 边以下全部视觉静止；
                // 条目自身新长出的内容在其底部自然展开（ST 浏览器滚动锚定同语义）。
                if (rect.top < 0) {
                    // 视口上方（含部分可见）：高度变化纯推挤，不做锚点判别，直接按差补偿
                    const container = findScrollAncestor(item.target);
                    if (container !== null) {
                        aboveDeltaByContainer.set(container, (aboveDeltaByContainer.get(container) ?? 0) + (size - prev));
                        if (!aboveFlushQueued) {
                            aboveFlushQueued = true;
                            queueMicrotask(flushAboveDeltas);
                        }
                    }
                }
            }
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
    // 【2026-09-07 空闲渐进物化】两带同时加 boost：占位→实测恢复判定用的是 exitPx
    // （滞回带，恒 1.6×enterPx——不扩张则占位永不物化，真机实测 boost 只涨 real 不涨）；
    // 实测→占位判定用 enterPx。两带同加同量 → 滞回差 0.6×enterPx 恒保持，无振荡带。
    const enterPx = enterOverscanPx(vh) + idleBoostPx;
    const exitPx = exitOverscanPx(vh) + idleBoostPx;
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
                // RO 补偿的翻转守卫时间戳（见 WindowEntry.flipAt 注记）
                entry.flipAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
                flipped = true;
                changed = true;
            }
        }
        // 4) 有翻转 → 布置锚点补偿任务（锚点本批未翻转时才有效）
        if (flipped && anchor !== null) {
            // 锚点本批被翻转：优先换视口内未翻转的次级可见条目当锚；没有也**仍用已翻转
            // 锚**——外壳元素跨翻转持续存在（ref 同一 div），其 top 只受「上方内容净高度
            // 变化」影响、与自身高度无关（占位↔实测互换不动 top）→ 补偿公式依然成立。
            // 旧实现在「视口内全是翻转条目」（空闲物化/快速滚动落点）时直接放弃补偿 →
            // 上方内容暴涨后视口内容被整体推走（空白虚空期的视觉漂移根因之一）。
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
            {
                const container = findScrollAncestor(anchor.entry.el);
                if (container !== null) {
                    // 禁用浏览器原生滚动锚定（2026-09-04 用户报告"会话缓慢自动上滑"）：
                    // 占位↔实测的高度变化会同时触发原生 overflow-anchor 与本协调器的
                    // 锚点补偿——双重修正叠加（卓易通老内核上误差不被 DSH 的 observed-top
                    // ledger 记账）表现为会话缓慢自动上漂、强滑到底后因官方吸底逻辑掩盖
                    // 而"消失"。二者只能留一个：翻转高度差由本协调器全权补偿。
                    if (container.style.overflowAnchor !== 'none')
                        container.style.overflowAnchor = 'none';
                    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    pendingCompensation = {
                        container,
                        anchorEl: anchor.entry.el,
                        anchorDocTop: anchor.top + container.scrollTop,
                        expiresAt: nowMs + 350, // 回执窗口（同帧落地恒命中；丢失回执的陈旧任务熔断）
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
