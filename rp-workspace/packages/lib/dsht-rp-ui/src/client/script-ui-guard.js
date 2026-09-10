/**
 * 【审计 A 类修复 2026-09-08】脚本注入宿主的悬浮 UI 守卫 + 注册表协商（通用层）。
 *
 * 背景（loop 审计实证）：TH 脚本/扩展经 window.parent.$ 往宿主 document 注入悬浮
 * 部件，两类问题——
 * ① 纯装饰图层（fx 扩展球的 ball-ring 等）pointer-events:auto 覆盖宿主控件 →
 *    「看得到、点不动」→ 自动置触摸穿透（decorative guard）；
 * ② 功能性悬浮窗（wb-float-monitor 等）与宿主核心 chrome（对话标签栏等）重叠 →
 *    不能盲改穿透（功能 UI 要能点）→ **注册表 + 同意式协商**：登记进注册表、
 *    检测到与保护区碰撞时弹一次性 toast，用户点击「自动避让」才做最小位移
 *    （不改 z、不隐藏、可逆；脚本若自行挪回不重复打扰）。
 *
 * 扫描模型（真机排障教训）：全量扫描只做一次（安装时）；此后 MutationObserver
 * **增量扫新增子树（含根自身）**——querySelectorAll 只匹配后代，根自身必须单独
 * processElement，否则注入的悬浮窗本体永远漏登记（v1 实测踩坑）。
 */
const DECOR_RE = /ring|halo|glow|aura/i;
const FLOAT_TAGS = 'div,aside,section,nav';
/** 增量扫描的后代候选（容器标签 + 装饰类名任意标签） */
const DECOR_SOURCE_SELECTOR = '[class*="ring"],[class*="halo"],[class*="glow"],[class*="aura"]';
/** 交互语义判定（jQuery 风格 UI 兼容）：原生控件 / onclick 属性 / cursor:pointer 后代 /
 *  draggable 类（jQuery UI 可拖窗）。上限 40 个后代查 computed，防大子树卡顿。 */
function hasInteractiveSemantic(el) {
    if (el.querySelector('button,a,input,select,textarea,[role="button"],[onclick]') !== null)
        return true;
    if (/draggable|ui-handle/i.test(el.className.toString()))
        return true;
    const descendants = el.querySelectorAll('*');
    const cap = Math.min(descendants.length, 40);
    for (let i = 0; i < cap; i++) {
        try {
            if (getComputedStyle(descendants[i]).cursor === 'pointer')
                return true;
        }
        catch { /* 继续 */ }
    }
    return false;
}
// ---- ① 装饰层守卫 ----
function tryDecor(el) {
    if (el.dataset.dshtDecor === '1')
        return;
    if (!DECOR_RE.test(el.className.toString()))
        return;
    let cs;
    try {
        cs = getComputedStyle(el);
    }
    catch {
        return;
    }
    if (cs.pointerEvents === 'none')
        return;
    if (cs.position !== 'fixed' && cs.position !== 'absolute')
        return;
    if (hasInteractiveSemantic(el))
        return;
    el.style.pointerEvents = 'none';
    el.dataset.dshtDecor = '1';
    console.info('[dsht-rp-ui] 脚本装饰层已置 pointer-events:none（触摸穿透）:', el.className);
}
// ---- ② 注册表 + 同意式避让 ----
/** 保护区锚点（每轮碰撞检测时现取 rect——布局会变） */
const PROTECTED_ANCHORS = '[role="tablist"],[data-composer-input]';
/** 【2026-09-10 心跳 35】自家浮球（参与跨浮窗避让的己方锚点）。
 *  用户实证诉求：「TT 能保证悬浮窗互不遮挡」——脚本浮窗(如 fx-floating-ball z=9999)
 *  与本插件浮球（🌌 z=60 / 🧩 z=10050）几何重叠时，此前**无任何检测**（PROTECTED_ANCHORS
 *  只含宿主 chrome），两球叠在一起。这里把自家浮球一并纳入避让域。
 *  优先级：本方核心 chrome > 脚本注入的装饰性浮窗（本方让位成本更低、可控）。 */
const OWN_FLOAT_SELECTOR = '.dsht-rp-statefloat-ball,.dsht-rp-scriptball';
/** 已登记的脚本悬浮窗（弱引用随 DOM 回收） */
const floatRegistry = new WeakMap();
/** 存活登记列表（可迭代——已登记未协商的元素需要持续复检：登记时保护区可能还没挂出来） */
const liveFloats = new Set();
/** 碰撞面积（交集矩形面积；不相交为 0） */
function overlapArea(a, b) {
    const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return ix * iy;
}
/** 轻量协商 toast（可点击；不依赖 toastr——guard 必须自给自足）。返回是否真的弹了 */
function offerNudgeToast(el, zoneName, nudge) {
    if (document.getElementById('dsht-float-nudge-toast') !== null)
        return false; // 同时只一条（不消耗额度）
    const bar = document.createElement('div');
    bar.id = 'dsht-float-nudge-toast';
    bar.style.cssText = 'position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);'
        + 'z-index:10060;display:flex;align-items:center;gap:10px;max-width:92vw;box-sizing:border-box;'
        + 'background:rgba(28,28,36,.96);color:#ddd;border:1px solid rgba(255,255,255,.14);border-radius:12px;'
        + 'padding:10px 14px;font-size:13px;line-height:18px;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    const text = document.createElement('span');
    text.textContent = `脚本悬浮窗遮住了${zoneName}`;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = '自动避让';
    yes.style.cssText = 'flex-shrink:0;border:none;border-radius:8px;padding:6px 12px;background:#3b6ea5;color:#fff;font-size:13px;cursor:pointer';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = '忽略';
    no.style.cssText = 'flex-shrink:0;border:none;background:transparent;color:#999;font-size:13px;cursor:pointer';
    const dismiss = () => { bar.remove(); };
    yes.addEventListener('click', () => { try {
        nudge();
    }
    catch (e) {
        console.warn('[dsht-rp-ui] nudge failed', e);
    } dismiss(); });
    no.addEventListener('click', dismiss);
    bar.append(text, yes, no);
    document.body.appendChild(bar);
    setTimeout(dismiss, 12000);
    return true;
}
/** 最小位移避让：把候选矩形沿总位移最小的方向推出保护区（位置修正，不改 z 不隐藏）。
 *  偏移持久化：脚本切会话会自复位浮窗（审计第二轮实证）——偏移按浮窗身份存
 *  localStorage，同身份元素再登记时静默重放（不重复弹 toast）。 */
function floatIdentity(el) {
    return el.id || el.className.toString().slice(0, 80) || 'anon';
}
function saveNudgeOffset(el, dx, dy) {
    try {
        localStorage.setItem(`dsht-nudge:${floatIdentity(el)}`, JSON.stringify({ dx, dy }));
    }
    catch { /* 存储不可用静默 */ }
}
function replayNudgeOffset(el) {
    try {
        const raw = localStorage.getItem(`dsht-nudge:${floatIdentity(el)}`);
        if (raw === null)
            return false;
        const { dx, dy } = JSON.parse(raw);
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0))
            return false;
        applyNudge(el, dx, dy);
        return true;
    }
    catch {
        return false;
    }
}
function applyNudge(el, dx, dy) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') {
        if (cs.right !== 'auto')
            el.style.right = 'auto';
        if (cs.bottom !== 'auto')
            el.style.bottom = 'auto';
        const r = el.getBoundingClientRect();
        el.style.left = `${r.left + dx}px`;
        el.style.top = `${r.top + dy}px`;
    }
    else {
        el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    el.dataset.dshtNudged = '1';
}
function nudgeOutOfZones(el, zones) {
    const r = el.getBoundingClientRect();
    // 汇合所有相交保护区，算联合推出向量（逐轴最小；重叠小的轴 = 位移小的方向）
    let dx = 0;
    let dy = 0;
    for (const z of zones) {
        const ix = Math.min(r.right + dx, z.right) - Math.max(r.left + dx, z.left);
        const iy = Math.min(r.bottom + dy, z.bottom) - Math.max(r.top + dy, z.top);
        if (ix <= 0 || iy <= 0)
            continue;
        const pushLeft = (r.right + dx) - z.left; // 向左推的量
        const pushRight = z.right - (r.left + dx); // 向右推的量
        const pushUp = (r.bottom + dy) - z.top;
        const pushDown = z.bottom - (r.top + dy);
        if (ix <= iy)
            dx += Math.min(pushLeft, pushRight) * (pushLeft < pushRight ? -1 : 1);
        else
            dy += Math.min(pushUp, pushDown) * (pushUp < pushDown ? -1 : 1);
    }
    if (dx === 0 && dy === 0)
        return;
    applyNudge(el, dx, dy);
    saveNudgeOffset(el, dx, dy);
    console.info('[dsht-rp-ui] 脚本悬浮窗已避让保护区:', el.className, { dx, dy });
}
/** 单元素处理：装饰穿透 / 悬浮窗登记 + 碰撞协商。zones 传 null = 跳过协商（只登记） */
function processElement(el, zones) {
    if (el.className.toString().includes('dsht-rp-'))
        return; // 自家 chrome 不碰
    if (el.closest('#dsht-rp-frame-park') !== null)
        return;
    let cs;
    try {
        cs = getComputedStyle(el);
    }
    catch {
        return;
    }
    if (cs.position !== 'fixed' && cs.position !== 'absolute')
        return;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
        return;
    const interactive = hasInteractiveSemantic(el);
    if (!interactive) {
        tryDecor(el);
        return;
    }
    // 功能 UI → 注册表 + 协商
    if (!floatRegistry.has(el)) {
        floatRegistry.set(el, { offeredNudge: false });
        liveFloats.add(el);
        el.dataset.dshtFloatUi = '1';
        // 同身份历史避让静默重放（脚本复位浮窗后无需用户再点一次）
        if (replayNudgeOffset(el)) {
            const entry0 = floatRegistry.get(el);
            if (entry0 !== undefined)
                entry0.offeredNudge = true;
            console.info('[dsht-rp-ui] 脚本悬浮窗重放历史避让:', el.className);
        }
    }
    negotiateCollision(el, zones);
}
// ---- ③ 跨浮窗避让（脚本浮窗 ↔ 我方浮球；2026-09-10 心跳 35）----
/** 我方浮球当前是否可见（非 RP 会话不渲染 → rect 为 0） */
function visibleOwnFloats() {
    const out = [];
    for (const el of document.querySelectorAll(OWN_FLOAT_SELECTOR)) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8)
            continue;
        let cs;
        try {
            cs = getComputedStyle(el);
        }
        catch {
            continue;
        }
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
            continue;
        // 【2026-09-10 心跳 35 修复】必须真的在视口内：React 首帧渲染时 style.left 还是
        // 初始值（尚未应用 left:92vw），rect 会落在 (-16,-16)，此时若参与避让会把这个
        // 未定位坐标冻结成内联 px（实测把 🌌 球钉死在左上角 (6,6)）。
        if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight)
            continue;
        // 只处理「完整落在视口内」的球（部分出界说明正在被 CSS 定位，跳过本轮）
        if (r.left < 0 || r.top < 0)
            continue;
        out.push(el);
    }
    return out;
}
/** 我方浮球位置用内联 left/top（RpStateFloat 的 style={{left:..vw,top:..vh}}）——
 *  避让时改成 px 位移；返回是否成功施加 */
function nudgeOwnFloat(el, dx, dy) {
    const r = el.getBoundingClientRect();
    const targetLeft = Math.round(r.left + dx);
    const targetTop = Math.round(r.top + dy);
    // 【2026-09-10 心跳 35】优先走 React 回写通道：浮球位置由组件 state（vw/vh）拥有，
    // 直接写内联会被下一次渲染冲掉（实测：写 left:313px 后立刻被 vw 值覆盖回 291）。
    const resolver = ownFloatResolvers.get(el);
    if (resolver !== undefined) {
        try {
            resolver(el, targetLeft, targetTop);
        }
        catch (e) {
            console.warn('[dsht-rp-ui] resolver 失败，回退内联', e);
        }
    }
    else {
        el.style.left = `${targetLeft}px`;
        el.style.top = `${targetTop}px`;
    }
    el.dataset.dshtNudged = '1';
}
/** 我方浮球的位置回写器（组件注册；键 = 浮球元素，值 = 转比例坐标写回 state） */
const ownFloatResolvers = new WeakMap();
/** 注册某类浮球的位置回写器；返回注销函数。selector 用于把当前 DOM 元素绑到 resolver。
 *  浮球元素可能晚于本调用挂载（cwd 补取是异步的 → 球延后渲染），因此除立即绑定外，
 *  还要持续监听 DOM 新增把 resolver 绑到新出现的元素上。 */
export function registerOwnFloatResolver(selector, resolver) {
    const bind = () => {
        for (const el of document.querySelectorAll(selector))
            ownFloatResolvers.set(el, resolver);
    };
    bind();
    const t = setTimeout(bind, 0);
    // 浮球渲染时机不定（RpStateFloat 要异步补取 cwd 后才 return 非 null）→ 观察新增节点
    let obs = null;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        obs = new MutationObserver(() => { bind(); });
        obs.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
        clearTimeout(t);
        if (obs !== null)
            obs.disconnect();
    };
}
/** 【2026-09-10 心跳 35 自愈】清掉 v197 及以前版本因 bug（未定位坐标冻结）写死的
 *  内联 left/top，让 React 的 vw/vh 定位重新接管。只针对「我方浮球 + 冻结在角落」
 *  这一确凿坏形态，不动脚本浮窗。 */
function healFrozenOwnFloats() {
    for (const el of document.querySelectorAll(OWN_FLOAT_SELECTOR)) {
        if (el.dataset.dshtNudged !== '1')
            continue;
        const raw = el.getAttribute('style') ?? '';
        // 修复版写的是「保边滑动」的 px；旧 bug 版写的是 6px 级别的角落坐标
        const m = /left:\s*(\d+(?:\.\d+)?)px/i.exec(raw);
        const n = /top:\s*(\d+(?:\.\d+)?)px/i.exec(raw);
        if (m === null || n === null)
            continue;
        const x = Number(m[1]);
        const y = Number(n[1]);
        if (x <= 12 && y <= 12) { // 左上角死角 = 坏形态
            el.style.removeProperty('left');
            el.style.removeProperty('top');
            delete el.dataset.dshtNudged;
            console.info('[dsht-rp-ui] 已自愈浮球冻结坐标（左上角死角）:', el.className);
        }
    }
}
/** 【2026-09-10 心跳 35】真正的「悬浮小部件」判定——用户投诉的「到处乱窜」根因：
 *  宿主的遮罩层/侧栏容器（`pI_x6G_overlayLayer` 393×873 全屏、`pI_x6G_sidebarCol`
 *  320×873 抽屉）也会被登记进 liveFloats，它们与任何浮球都「重叠」，
 *  导致避让逻辑被反复触发、浮球被推向各处。
 *  判据：视口占比 + 绝对尺寸上限——悬浮球/悬浮窗是小的，遮罩层是全屏的。 */
function isCompactFloat(el, r) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const maxW = Math.min(360, vw * 0.72);
    const maxH = Math.min(360, vh * 0.55);
    if (r.width > maxW || r.height > maxH)
        return false;
    return true;
}
/** 跨浮窗避让主逻辑：对每个脚本浮窗，若与我方浮球重叠，则**我方浮球让位**
 *  （脚本浮窗归第三方脚本所有，主动改它会导致脚本复位抖动；我方浮球位置由
 *   组件 state 拥有，让位通过 resolver 写回，用户下次拖拽即覆盖）。 */
function resolveOwnFloatCollisions() {
    const own = visibleOwnFloats();
    if (own.length === 0)
        return;
    // 只与「紧凑悬浮小部件」协商——全屏遮罩/侧栏抽屉不算（否则永远重叠 → 浮球乱窜）
    const others = [...liveFloats].filter((el) => {
        if (!el.isConnected)
            return false;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8)
            return false;
        return isCompactFloat(el, r);
    });
    if (others.length === 0)
        return;
    // 我方浮球按 z-index 升序处理（低的先让，避免高优先级球被推）
    own.sort((a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0));
    let moved = 0;
    for (const mine of own) {
        let guard = 0;
        // 迭代推挤：一个球可能同时撞到多个脚本浮窗，最多 6 轮防死循环
        while (guard++ < 6) {
            const r = mine.getBoundingClientRect();
            if (r.width < 8 || r.height < 8)
                break;
            let hit = null;
            for (const o of others) {
                const or = o.getBoundingClientRect();
                if (or.width < 8 || or.height < 8)
                    continue;
                const area = overlapArea(r, or);
                // 阈值：重叠 > 220px² 且 > 浮球面积 18%（轻微擦边不动，避免抖动）
                if (area > 220 && area > r.width * r.height * 0.18) {
                    hit = or;
                    break;
                }
            }
            if (hit === null)
                break;
            // 【2026-09-10 心跳 35 修复】保边滑动，而非「最小位移推出」——
            // 原算法会把球推到屏幕角落死角（实测 🌌 被钉到 (6,6)），且乱窜。
            // 规则：保持球当前所在的左/右半边（用户拖拽贴边的语义），只沿**垂直**方向
            // 滑出重叠区；垂直无处可去时才沿水平方向错开（仍回到同侧边缘）。
            const preferRight = (r.left + r.width / 2) >= window.innerWidth / 2;
            const MARGIN = 8;
            const GAP = 8;
            const minX = MARGIN;
            const maxX = window.innerWidth - r.width - MARGIN;
            const minY = MARGIN;
            const maxY = window.innerHeight - r.height - MARGIN;
            const edgeX = preferRight ? Math.min(maxX, Math.max(minX, window.innerWidth - r.width - MARGIN - 10)) : minX + 10;
            // 垂直候选：滑到脚本浮窗上方 / 下方
            const candsY = [hit.top - GAP - r.height, hit.bottom + GAP];
            let best = null;
            for (const cy of candsY) {
                if (cy < minY || cy > maxY)
                    continue;
                for (const cx of [edgeX, Math.min(maxX, Math.max(minX, r.left))]) {
                    const rect = { left: cx, top: cy, right: cx + r.width, bottom: cy + r.height };
                    let worst = 0;
                    for (const o of others) {
                        const or = o.getBoundingClientRect();
                        if (or.width < 8 || or.height < 8)
                            continue;
                        worst = Math.max(worst, overlapArea(rect, or));
                    }
                    if (worst > 220)
                        continue;
                    const cost = Math.abs(cy - r.top) + Math.abs(cx - r.left) * 0.35;
                    if (best === null || cost < best.cost)
                        best = { x: cx, y: cy, cost };
                }
            }
            if (best === null)
                break; // 无合法落点（视口太小）→ 放弃本轮，不乱推
            const rdx = Math.round(best.x - r.left);
            const rdy = Math.round(best.y - r.top);
            if (rdx === 0 && rdy === 0)
                break;
            nudgeOwnFloat(mine, rdx, rdy);
            moved += 1;
            // 位置持久化由 resolver（组件侧 savePos）负责；无 resolver 时（理论不达）仍写内联。
        }
    }
    if (moved > 0)
        console.info(`[dsht-rp-ui] 自家浮球跨浮窗避让: ${moved} 次位移（脚本浮窗 ${others.length} 个）`);
}
/** 跨浮窗扫描节流：MutationObserver/轮询都会调，用时间戳防抖 */
let lastCrossScan = 0;
function maybeResolveCross(force = false) {
    const now = Date.now();
    if (!force && now - lastCrossScan < 700)
        return;
    lastCrossScan = now;
    try {
        resolveOwnFloatCollisions();
    }
    catch (e) {
        console.warn('[dsht-rp-ui] 跨浮窗避让失败', e);
    }
}
/** 供浮球组件在拖拽落定后主动触发（拖到脚本浮窗上时立即让位，不等 3s 轮询） */
export function requestFloatCollisionResolve() {
    maybeResolveCross(true);
}
/** 诊断快照（CDP 探针用）：列出当前跨浮窗避让的参与方与碰撞结果 */
export function floatCollisionSnapshot() {
    const own = visibleOwnFloats();
    const others = [...liveFloats].filter((el) => {
        if (!el.isConnected)
            return false;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8)
            return false;
        return isCompactFloat(el, r);
    });
    let overlapping = 0;
    for (const mine of own) {
        const r = mine.getBoundingClientRect();
        for (const o of others) {
            const or = o.getBoundingClientRect();
            if (overlapArea(r, or) > 1) {
                overlapping += 1;
                break;
            }
        }
    }
    let resolvers = 0;
    for (const el of document.querySelectorAll(OWN_FLOAT_SELECTOR)) {
        if (ownFloatResolvers.has(el))
            resolvers += 1;
    }
    return { own: own.length, others: others.length, overlapping, resolvers };
}
/** 对已登记未协商的元素做保护区碰撞检测；命中弹一次性 toast（同意式避让） */
function negotiateCollision(el, zones) {
    const entry = floatRegistry.get(el);
    if (zones === null || zones.length === 0 || entry === undefined || entry.offeredNudge)
        return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24)
        return;
    let hit = null;
    for (const z of zones) {
        const area = overlapArea(rect, z.rect);
        if (area > 200 && area > rect.width * rect.height * 0.12) {
            hit = z;
            break;
        }
    }
    if (hit === null)
        return;
    // 提示真的弹了才消耗「仅一次」额度（被其它 toast 占用时下轮再试）
    if (offerNudgeToast(el, hit.name, () => nudgeOutOfZones(el, zones.map(z => z.rect)))) {
        entry.offeredNudge = true;
    }
}
/** 每轮扫描。root=null = 全量（仅安装时）；传根 = 增量（根自身 + 后代都要处理） */
function guardScan(root) {
    // 保护区 rect（无锚点跳过协商；rect 现取——布局会变）
    let zones = null;
    if (root === null || document.querySelector(PROTECTED_ANCHORS) !== null) {
        zones = [];
        for (const anchor of document.querySelectorAll(PROTECTED_ANCHORS)) {
            const rect = anchor.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                continue;
            zones.push({ rect, name: anchor.getAttribute('role') === 'tablist' ? '对话标签栏' : '输入区' });
        }
    }
    if (root === null) {
        for (const el of document.querySelectorAll('div,aside,section,nav'))
            processElement(el, zones);
        // 装饰层不限标签（span/i 的 ring 也吃）——DECOR_RE 在 processElement 内兜底判定，
        // 这里补扫非容器标签的装饰候选
        for (const el of document.querySelectorAll(`span,i,b,em,label,p`)) {
            if (DECOR_RE.test(el.className.toString()))
                processElement(el, null);
        }
    }
    else {
        if (!(root instanceof HTMLElement))
            return;
        processElement(root, zones);
        for (const el of root.querySelectorAll(`${FLOAT_TAGS},${DECOR_SOURCE_SELECTOR}`))
            processElement(el, zones);
    }
    // 已登记未协商元素的持续复检（登记时保护区可能还没挂出来/还没滚到）；断链清理
    for (const el of [...liveFloats]) {
        if (!el.isConnected) {
            liveFloats.delete(el);
            floatRegistry.delete(el);
            continue;
        }
        negotiateCollision(el, zones);
    }
    // ③ 跨浮窗避让：脚本浮窗 ↔ 我方浮球（与宿主保护区无关，独立触发）
    maybeResolveCross();
}
/** 安装守卫；返回卸载函数（插件 fiber 随动） */
export function installScriptUiGuard() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined')
        return () => { };
    // 诊断探针（CDP 排障用）：window.__dshtGuard = { installed, scans, floatSnapshot() }
    const dbg = window;
    dbg['__dshtGuard'] = { installed: Date.now(), scans: 0, floatSnapshot: floatCollisionSnapshot };
    let timer = null;
    /** 待扫根（mutation 增量；安装时先全量一轮） */
    let pendingRoots = [];
    let fullDue = true;
    const run = () => {
        timer = null;
        const d = dbg['__dshtGuard'];
        d.scans += 1;
        try {
            if (fullDue) {
                guardScan(null);
                fullDue = false;
            }
            else
                for (const root of pendingRoots.splice(0))
                    guardScan(root);
        }
        catch (e) {
            console.warn('[dsht-rp-ui] script ui guard pass failed', e);
        }
    };
    const schedule = () => {
        if (timer !== null)
            return;
        timer = setTimeout(run, 400);
    };
    run();
    healFrozenOwnFloats(); // 自愈旧版冻结坐标（一次性）
    const observer = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n instanceof HTMLElement) {
                    pendingRoots.push(n);
                    schedule();
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // ③ 视口变化（转屏/软键盘弹出）→ 浮球重排后重新解重叠
    const onViewport = () => { maybeResolveCross(true); };
    window.addEventListener('resize', onViewport);
    window.addEventListener('orientationchange', onViewport);
    // 低频复检（3s）：页面静止（无 mutation）时已登记未协商的悬浮窗也要参与碰撞检测
    const recheck = setInterval(() => {
        try {
            // ③ 跨浮窗避让独立于宿主保护区：即使 liveFloats 为空也先去重（脚本浮窗
            //    可能已被 cleanup 移除但自家浮球仍在原位撞着残留层）
            maybeResolveCross();
            if (liveFloats.size === 0)
                return;
            const zones = [];
            for (const anchor of document.querySelectorAll(PROTECTED_ANCHORS)) {
                const rect = anchor.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0)
                    continue;
                zones.push({ rect, name: anchor.getAttribute('role') === 'tablist' ? '对话标签栏' : '输入区' });
            }
            for (const el of [...liveFloats]) {
                if (!el.isConnected) {
                    liveFloats.delete(el);
                    floatRegistry.delete(el);
                    continue;
                }
                negotiateCollision(el, zones);
            }
            // ③ 静止期也要解跨浮窗重叠（浮球 mout/脚本注入都可能不产生 mutation）
            maybeResolveCross();
        }
        catch { /* 复检失败不影响主流程 */ }
    }, 3000);
    return () => {
        observer.disconnect();
        clearInterval(recheck);
        window.removeEventListener('resize', onViewport);
        window.removeEventListener('orientationchange', onViewport);
        if (timer !== null)
            clearTimeout(timer);
    };
}
