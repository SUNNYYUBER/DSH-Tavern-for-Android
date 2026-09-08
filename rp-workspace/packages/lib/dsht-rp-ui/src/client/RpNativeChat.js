/**
 * T2.5 前端原生化收口：输出协议三组件 + 变体条，以渲染器身份融入原生 conversation。
 *
 * - conversation.chat.node（keyed `assistant-step`，priority -1 shadowing 官方渲染器）：
 *   applyOutputProtocol（statusTags→状态栏卡片 / actionTags→行动选项按钮 /
 *   wrapTags→剥壳 + ```statusbar 代码块→组件）移植为 assistant 消息渲染增强；
 *   剥壳后文本经官方同款 MarkdownText 渲染（ui-primitives，模块表直供）。
 *   reasoning 块以极简折叠行补差（T2.5d：原生 ReasoningRow 在 ui-conversation
 *   内部、不可经模块表 import；stats/icon actions 归 turn-tail 节点，shadowing 无损）。
 * - conversation.chat.assistant-actions（list 席位）：变体条 ‹ n/m ›（T2.5c），
 *   切换走 3081 /variant/switch（dsht-rp-plugin，session.append replace SurfaceOp）。
 * - 行动选项按钮点击 = inputActions.setDraft + submit（T2.5b：原生 composer
 *   提交通道，不自绘输入栏）。
 *
 * 可卸载性（P7）：拔掉本插件 = shadowing 消失，官方 AssistantNodeView 复位，
 * DSH 原生功能完整。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Fragment } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { dshRpc, rpApi } from './rpc.ts';
import { isMessageWindowed, messagePlaceholderHeight, registerMessageWindowing, reportWindowCommit, subscribeWindowing, findScrollAncestor, } from './chat-windowing.ts';
import { applyOutputProtocolSegments, parseJsonPatches, parseStatusBarRows, parseVariableJson, sanitizeDisplayHtml, slugFromCwd, splitStatusbarBlocks, withDefaults, } from './output-protocol.ts';
import { FRAME_HEIGHT_MESSAGE_TYPE, FRAME_MAX_HEIGHT, buildDisplayFrameDocument, clampFrameHeight, compileDisplaySegments, enhancePreBlocks, expandDisplayMacros, loadDisplayRenderCtx, loadEjsDisplaySettings, loadRenderEntries, loadThRenderSettings, reportPermanentRender, runDisplayScripts, } from './display-compiler.ts';
import { groupOf, normalizeVariantGroups } from './variant-groups.ts';
// ---------------------------------------------------------------------------
// 工作区输出协议配置（T2.5f 下发链：rp.json → 3081 /rp/workspaces → 此处消费）
// ---------------------------------------------------------------------------
/** 清单缓存（rp.json 运行时会被迁移/绑书改动——overlay 打开与导入完成时经 invalidateWsCache 失效） */
let wsCache = null;
/**
 * wsCache 失效。调用点：RP overlay 打开（loadWorkspaces）、导入完成（refreshAfterImport）、
 * 世界书绑定保存——否则绑定新书/新导入的工作区要刷新整个页面才生效（批次 3 遗留）。
 */
export function invalidateWsCache() {
    wsCache = null;
    rpSessionCache = null;
    displayRegexCache.clear();
}
function fetchWorkspaces() {
    if (wsCache === null) {
        wsCache = rpApi('rp/workspaces')
            .then(r => r.workspaces ?? [])
            .catch(() => []);
    }
    return wsCache;
}
/** 按会话 cwd 匹配工作区协议配置；非 RP 会话返回 null（渲染退化为纯官方行为） */
function useOutputProtocol(cwd) {
    const [proto, setProto] = useState(null);
    const slug = slugFromCwd(cwd);
    useEffect(() => {
        let alive = true;
        if (slug === null) {
            setProto(null);
            return;
        }
        void fetchWorkspaces().then(list => {
            if (!alive)
                return;
            const ws = list.find(w => w.slug === slug);
            setProto(ws ? withDefaults(ws.outputProtocol) : withDefaults(undefined));
        });
        return () => { alive = false; };
    }, [slug]);
    return proto;
}
// ---------------------------------------------------------------------------
// display 时机正则（批次修复 5 → P0-3 升级）：display 视图消费「通用 + 仅显示」
// 脚本（两趟执行，见 display-compiler.ts runDisplayScripts）；promptOnly 专属不跑。
// placement 过滤含 1/2/3——AI_OUTPUT(2) 仅显示脚本也跑（P0 批次修复）。
// ---------------------------------------------------------------------------
/** slug+sessionId → display 脚本清单（regex/list 全局 + 预设（会话有效预设）+ 角色
 * 作用域三源合并——ST 语义：激活预设的 display 正则恒生效；invalidateWsCache 时失效） */
const displayRegexCache = new Map();
function fetchDisplayRegexes(slug, sessionId) {
    const key = `${slug}::${sessionId}`;
    let p = displayRegexCache.get(key);
    if (p === undefined) {
        p = rpApi('regex/list', { slug, sessionId })
            .then(r => [...(r.global ?? []), ...(r.preset ?? []), ...(r.scoped ?? [])]
            .filter(s => s.disabled !== true && !(s.promptOnly === true && s.markdownOnly !== true)
            && (s.placement.includes(1) || s.placement.includes(2) || s.placement.includes(3))))
            .catch(() => []);
        displayRegexCache.set(key, p);
    }
    return p;
}
function useDisplayRegexes(slug, sessionId) {
    const [scripts, setScripts] = useState([]);
    useEffect(() => {
        let alive = true;
        if (slug === null || !sessionId) {
            setScripts([]);
            return;
        }
        void fetchDisplayRegexes(slug, sessionId).then(s => { if (alive)
            setScripts(s); });
        return () => { alive = false; };
    }, [slug, sessionId]);
    return scripts;
}
const EMPTY_PIPELINE_ENTRIES = { before: '', after: '' };
const PIPELINE_UNLOADED = { ctx: null, entries: EMPTY_PIPELINE_ENTRIES, ejs: null, th: null };
function useDisplayPipeline(slug, sessionId) {
    const [data, setData] = useState(PIPELINE_UNLOADED);
    useEffect(() => {
        let alive = true;
        void Promise.all([
            slug !== null && sessionId !== '' ? loadDisplayRenderCtx(slug, sessionId) : Promise.resolve(null),
            slug !== null && sessionId !== '' ? loadRenderEntries(slug, sessionId) : Promise.resolve(EMPTY_PIPELINE_ENTRIES),
            loadEjsDisplaySettings(),
            loadThRenderSettings(),
        ]).then(([ctx, entries, ejs, th]) => {
            if (alive)
                setData({ ctx, entries, ejs, th });
        });
        return () => { alive = false; };
    }, [slug, sessionId]);
    return data;
}
// ---------------------------------------------------------------------------
// 消息窗口化（T1.14）：每条消息外壳自注册进共享协调器（chat-windowing.ts），
// 视口外的消息渲染等高占位（卸载 display iframe 等内容 DOM——省内存关键），
// 滚回可视带时重新渲染（display 正则/变体组均有会话级缓存，不重复拉取）。
// ≤ 40 条的会话协调器不启用窗口化，行为与未窗口化完全一致。
// ---------------------------------------------------------------------------
/**
 * 消息窗口化 hook：返回外壳 ref 与 windowed 状态。
 * - 注册走 useLayoutEffect（首帧 paint 前完成注册，滚动判定不失帧）；
 * - windowed 用 useSyncExternalStore 订阅协调器（仅翻转条目重渲染）；
 * - 翻转 commit 后回执 reportWindowCommit → 协调器统一做滚动锚定补偿
 *   （占位↔实测高度差的位置还原；用户手动滚动不受干预）。
 */
function useMessageWindowing(sessionKey, nodeKey, forced) {
    const shellRef = useRef(null);
    useLayoutEffect(() => {
        const el = shellRef.current;
        if (el === null)
            return;
        return registerMessageWindowing({ sessionKey, nodeKey, el, forced });
    }, [sessionKey, nodeKey, forced]);
    const windowed = useSyncExternalStore(subscribeWindowing, () => isMessageWindowed(sessionKey, nodeKey));
    // 翻转回执：仅 windowed 变化的 commit 上报（首次挂载 prev 为 null 不上报）
    const prevWindowed = useRef(null);
    useLayoutEffect(() => {
        const prev = prevWindowed.current;
        prevWindowed.current = windowed;
        if (prev !== null && prev !== windowed)
            reportWindowCommit();
    }, [windowed, sessionKey, nodeKey]);
    // 占位渲染时读一次最新缓存（真实渲染期间 RO 持续更新，翻转瞬间定格）
    return { shellRef, windowed, placeholderHeight: messagePlaceholderHeight(sessionKey, nodeKey) };
}
/** 从快照找最新的逻辑回退标记（取最大锚：多次回退取最后一次）。
 *  标记是 dsht-rp 插件 append 的 user/message（source.kind='plugin' + rolledBackTo /
 *  editedFrom / regeneratedFrom）——**投影 kind 是 'context'**（插件注入不投影为
 *  user 行），因此不能按 kind==='user' 过滤，须全节点扫 source 字段。
 *  edit 语义 = 锚消息本身也隐藏 → hideAfter = editedFrom − 1；rollback/regenerate
 *  = 锚消息保留 → hideAfter = 锚 seq。统一规则：真实消息 seq > hideAfter 即隐藏。 */
function hideAfterOf(snapshot) {
    let hide = 0;
    const chat = snapshot.chat;
    if (!chat?.order || !chat.nodes)
        return 0;
    for (const n of chat.nodes.values()) {
        const src = n.data?.source;
        if (!src || src.kind !== 'plugin' || src.plugin !== 'dsht-rp')
            continue;
        if (typeof src.rolledBackTo === 'number')
            hide = Math.max(hide, src.rolledBackTo);
        if (typeof src.regeneratedFrom === 'number')
            hide = Math.max(hide, src.regeneratedFrom);
        if (typeof src.editedFrom === 'number')
            hide = Math.max(hide, src.editedFrom - 1);
    }
    return hide;
}
/** 会话快照 → 楼层索引（楼层号 + step/turn 耗时）。
 *  楼层判定：
 *  - user 仅当 data.source.kind === 'user'（steering/context/插件注入不算）；
 *  - assistant-step 按 data.turn 分组：同 turn 的全部 step（思考轮/工具轮）合计 1 楼；
 *    物化开场白是真实 assistant 消息 → 占第 1 楼；
 *  - compaction/manual-compaction/tool/retry/turn-tail 等非消息 kind 不占号。
 *  耗时判定（任务结束后折叠行「思考了 X」的数据源，精确口径）：settled step 用
 *  finalNode.timing（stepStartTime → completedTime = 该 step 真实起止）；timing
 *  缺失退化 data.time → 同 turn 下一 step.data.time；turn 总耗时 = 末 step
 *  completedTime − 首 step 开始；running 的 step 无定稿时间不显示。
 *  WeakMap 按快照代际缓存——useSession 选择器要求引用稳定（每代一份）。 */
const floorIndexCache = new WeakMap();
/** 掩码按 (snapshot, hideAfter) 组合缓存——同一快照在掩码变化（回退操作后）时重算 */
const floorIndexCacheKey = new WeakMap();
function floorIndexOf(snapshot, hideAfter = hideAfterOf(snapshot)) {
    const snap = snapshot;
    const cached = floorIndexCache.get(snap);
    const cachedMask = floorIndexCacheKey.get(snap) ?? 0;
    if (cached !== undefined && cachedMask === hideAfter)
        return cached;
    const floors = new Map();
    const stepMs = new Map();
    const turnMs = new Map();
    const chat = snapshot.chat;
    if (chat?.order && chat.nodes) {
        const byKey = new Map();
        for (const n of chat.nodes.values()) {
            if (typeof n.key === 'string')
                byKey.set(n.key, { kind: n.kind, data: n.data });
        }
        // 顺序扫一遍：分楼 + 收集 turn 的 step 起止（供耗时计算）。
        // 逻辑回退掩码：seq > hideAfter 的真实消息已从上下文移除（回退/编辑/重新生成
        // marker），UI 楼层号与耗时表同步跳过（视觉 = 真回退，数据零丢失）。
        let floor = 1;
        let lastTurn = null;
        const turnSteps = new Map();
        for (const key of chat.order) {
            const n = byKey.get(key);
            if (n === undefined)
                continue;
            if (n.kind === 'assistant-step') {
                const mySeq = typeof n.data?.finalNode?.seq === 'number' ? n.data.finalNode.seq : undefined;
                if (hideAfter > 0 && typeof mySeq === 'number' && mySeq > hideAfter)
                    continue;
                const turn = typeof n.data?.turn === 'number' ? n.data.turn : null;
                if (turn === null || turn !== lastTurn) {
                    floor += 1;
                    lastTurn = turn;
                }
                floors.set(key, floor);
                if (turn !== null && typeof n.data?.time === 'number') {
                    const timing = n.data?.finalNode?.timing;
                    const end = typeof timing?.completedTime === 'number' ? timing.completedTime : null;
                    const start = typeof timing?.stepStartTime === 'number' ? timing.stepStartTime : n.data.time;
                    const list = turnSteps.get(turn);
                    if (list !== undefined)
                        list.push({ key, start, end });
                    else
                        turnSteps.set(turn, [{ key, start, end }]);
                }
            }
            else if (n.kind === 'user') {
                if (n.data?.source?.kind !== 'user')
                    continue;
                if (hideAfter > 0 && typeof n.data?.seq === 'number' && n.data.seq > hideAfter)
                    continue;
                floor += 1;
                lastTurn = null;
                floors.set(key, floor);
            }
        }
        // 耗时汇总（turn 内 step 起止齐备才计；running 的 step 无 completedTime 不显示）
        for (const steps of turnSteps.values()) {
            if (steps.length === 0)
                continue;
            for (const s of steps) {
                if (s.end === null || s.end <= s.start)
                    continue;
                stepMs.set(s.key, s.end - s.start);
            }
            const first = steps[0];
            const last = steps[steps.length - 1];
            if (last.end !== null && last.end > first.start)
                turnMs.set(last.key, last.end - first.start);
        }
    }
    const index = { floors, stepMs, turnMs, hideAfter: hideAfterOf(snapshot) };
    floorIndexCache.set(snap, index);
    return index;
}
/** 兼容旧调用点：楼层表（floorIndexOf().floors） */
function floorMapOf(snapshot) {
    return floorIndexOf(snapshot).floors;
}
// ---------------------------------------------------------------------------
// 逻辑回退掩码 store（sessionId → hideAfter）：host 从 session.jsonl 解析回退/
// 编辑/重新生成 marker（/rp/rollback-mask）——客户端投影不透传 marker 的 source
// 字段（真机实证），故由前端拉取。useSyncExternalStore 订阅；回退/编辑/重新
// 生成成功后调 refreshRollbackMask 立即刷新（UI 即时隐藏 + 楼层号重排）。
// ---------------------------------------------------------------------------
const maskCache = new Map();
const maskListeners = new Map();
const maskInflight = new Set();
async function refreshRollbackMask(sessionId) {
    if (maskInflight.has(sessionId))
        return;
    maskInflight.add(sessionId);
    try {
        const r = await rpApi('rp/rollback-mask', { sessionId });
        const next = typeof r.hideAfter === 'number' && r.hideAfter > 0 ? r.hideAfter : 0;
        if (maskCache.get(sessionId) !== next) {
            maskCache.set(sessionId, next);
            maskListeners.get(sessionId)?.forEach(cb => cb());
        }
    }
    catch { /* 掩码获取失败按 0（不隐藏） */ }
    finally {
        maskInflight.delete(sessionId);
    }
}
function useRollbackMask(sessionId) {
    const value = sessionId !== undefined ? (maskCache.get(sessionId) ?? 0) : 0;
    const subscribe = useCallback((cb) => {
        if (sessionId === undefined)
            return () => undefined;
        let set = maskListeners.get(sessionId);
        if (set === undefined) {
            set = new Set();
            maskListeners.set(sessionId, set);
        }
        set.add(cb);
        void refreshRollbackMask(sessionId);
        return () => { set.delete(cb); };
    }, [sessionId]);
    const getSnapshot = useCallback(() => (sessionId !== undefined ? maskCache.get(sessionId) ?? 0 : 0), [sessionId]);
    return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
// globalThis 桥：index.tsx 的 regenerate inject（跨模块）成功后刷新掩码
;
globalThis.__dshtRpRefreshRollbackMask = refreshRollbackMask;
/** 聊天偏好（楼层号显示开关；GET /rp/chat-prefs，模块级缓存一次——设置页改后刷新生效） */
let chatPrefsCache = null;
function fetchFloorBadgePref() {
    if (chatPrefsCache === null) {
        chatPrefsCache = rpApi('rp/chat-prefs')
            .then(r => r.floorBadge !== false)
            .catch(() => true);
    }
    return chatPrefsCache;
}
function useFloorBadgePref() {
    const [on, setOn] = useState(true);
    useEffect(() => {
        let alive = true;
        void fetchFloorBadgePref().then(v => { if (alive)
            setOn(v); });
        return () => { alive = false; };
    }, []);
    return on;
}
/** 楼层号徽章 #N（1 起始；assistant 右上角 absolute / user 右对齐 inline；设置可关）。
 *  掩码联动：sessionId 在场时取逻辑回退掩码，楼层号按隐藏后视图重排。 */
const RpFloorBadge = memo(function RpFloorBadge({ useSession, nodeKey, side, sessionId }) {
    const enabled = useFloorBadgePref();
    const hideAfter = useRollbackMask(sessionId);
    const floor = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, hideAfter).floors.get(nodeKey));
    if (!enabled || floor === undefined)
        return null;
    return <span className={`dsht-rp-floor dsht-rp-floor-${side}`} data-testid="dsht-rp-floor">#{floor}</span>;
});
/** 状态栏卡片（§4.6：状态/位置信息渲染为卡片，数据不出本组件） */
export const StatusBarCard = memo(function StatusBarCard({ content }) {
    const rows = useMemo(() => parseStatusBarRows(content), [content]);
    return (<div className="dsht-rp-statusbar" data-testid="dsht-rp-statusbar">
      <div className="sb-title">◆ STATUS</div>
      {rows.length > 0
            ? rows.map(([k, v], i) => (<div className="sb-row" key={i}><span className="sb-k">{k}</span><span className="sb-v">{v}</span></div>))
            : <div className="sb-row">{content.trim().slice(0, 600)}</div>}
    </div>);
});
/**
 * MVU 状态栏组件（批次修复 4）：<StatusPlaceHolderImpl/> 占位符的替换渲染（F4）。
 * fetch GET /dsht-mvu/statusbar-render?sessionId=xxx（返回 {html}），白名单 sanitize
 * 后按 HTML 渲染；路由不可达 / 无 html / 含白名单外标签时整块隐藏（不裸文本）。
 * F4：每 session 5s 模块级缓存——同一会话多楼层占位符/窗口化回渲不重复拉取。
 */
const statusbarRenderCache = new Map();
function fetchStatusbarRender(sessionId) {
    const now = Date.now();
    const cached = statusbarRenderCache.get(sessionId);
    if (cached !== undefined && now - cached.at < 5000)
        return cached.html;
    const html = fetch(`/dsht-mvu/statusbar-render?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
        .then(async (r) => {
        if (!r.ok)
            return null;
        const j = await r.json();
        return typeof j.html === 'string' ? sanitizeDisplayHtml(j.html) : null;
    })
        .catch(() => null);
    statusbarRenderCache.set(sessionId, { at: now, html });
    return html;
}
const MvuStatusbar = memo(function MvuStatusbar({ sessionId }) {
    const [html, setHtml] = useState(null);
    useEffect(() => {
        let alive = true;
        if (sessionId === undefined)
            return;
        void fetchStatusbarRender(sessionId).then(h => {
            // sanitize 失败（null）/路由不可达 → 保持整块隐藏（不裸文本）
            if (alive && h !== null)
                setHtml(h);
        });
        return () => { alive = false; };
    }, [sessionId]);
    if (html === null)
        return null;
    return <div className="dsht-rp-mvu-statusbar" data-testid="dsht-rp-statusbar" dangerouslySetInnerHTML={{ __html: html }}/>;
});
/**
 * 完整 HTML 文档段的 iframe 渲染器（P0-2；骨架照抄 dsh-tavern client.js L903-941
 * TavernMessageFrame，MIT）：
 * - sandbox="allow-scripts"（不给 allow-same-origin）+ referrerPolicy="no-referrer"；
 * - srcdoc 由 buildDisplayFrameDocument 组装（CSP + 高度上报脚本）；C3 use_blob_url
 *   开启时改走 blob: URL（TH 同款形态；卸载/文档变更时 revoke）；
 * - 高度由 iframe 内 postMessage 上报（token + event.source 双校验），clamp [48,12000]。
 * 悬浮球这类 position:fixed 部件在 iframe 内能跑（iframe 即它的舞台）。
 */
const RpMessageFrame = memo(function RpMessageFrame({ html, useBlobUrl = false }) {
    const frameRef = useRef(null);
    const tokenRef = useRef('');
    if (tokenRef.current === '') {
        tokenRef.current = typeof window.crypto?.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `${Date.now()}:${Math.random()}`;
    }
    const [height, setHeight] = useState(80);
    const srcDoc = useMemo(() => buildDisplayFrameDocument(html, tokenRef.current), [html]);
    // C3 use_blob_url：blob: URL 与 srcdoc 二选一（blob 生命周期跟随本文档）
    const [blobUrl, setBlobUrl] = useState(null);
    useEffect(() => {
        if (!useBlobUrl) {
            setBlobUrl(null);
            return;
        }
        const url = URL.createObjectURL(new Blob([srcDoc], { type: 'text/html' }));
        setBlobUrl(url);
        return () => { URL.revokeObjectURL(url); };
    }, [srcDoc, useBlobUrl]);
    useEffect(() => {
        const receive = (event) => {
            const frame = frameRef.current;
            const data = event.data;
            if (frame === null || event.source !== frame.contentWindow || data === null || data.token !== tokenRef.current)
                return;
            if (data.type === FRAME_HEIGHT_MESSAGE_TYPE)
                setHeight(clampFrameHeight(Number(data.height)));
        };
        window.addEventListener('message', receive);
        return () => { window.removeEventListener('message', receive); };
    }, []);
    return (<iframe ref={frameRef} className="dsht-rp-message-frame" title="人物卡前端界面" sandbox="allow-scripts" referrerPolicy="no-referrer" src={blobUrl ?? undefined} srcDoc={blobUrl === null ? srcDoc : undefined} style={{ height: `${height}px`, overflow: height >= FRAME_MAX_HEIGHT ? 'auto' : 'hidden' }}/>);
});
/** 耗时格式化（思考折叠行「思考了 X」）：秒 <60，否则 分+秒 */
function formatDuration(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60)
        return `${s} 秒`;
    return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}
/** reasoning 折叠行（T2.5d 差值补齐：原生 ReasoningRow 不可 import，最小等效实现）。
 *  任务结束后折叠为一行并显示耗时（2026-09-04 用户要求）：settled 且有快照
 *  time 数据时显示「思考了 X」；turn 总耗时可得时附「本轮共 X」。 */
const ReasoningRow = memo(function ReasoningRow({ text, running, durationMs, turnTotalMs }) {
    const summary = running
        ? '思考中…'
        : durationMs === undefined
            ? (turnTotalMs === undefined ? '已深度思考' : `任务耗时 ${formatDuration(turnTotalMs)}`)
            : (turnTotalMs === undefined ? `思考了 ${formatDuration(durationMs)}` : `思考了 ${formatDuration(durationMs)} · 任务耗时 ${formatDuration(turnTotalMs)}`);
    return (<details className="dsht-rp-reasoning" data-running={running || undefined}>
      <summary>{summary}</summary>
      <div className="rp-reasoning-body">{text}</div>
    </details>);
});
/** T2.10 折叠块（collapsibleTags：<details><summary>标题</summary>内容 → 原生折叠组件） */
const CollapsibleBlock = memo(function CollapsibleBlock({ title, content }) {
    return (<details className="dsht-rp-collapsible">
      <summary><span className="cl-title">{title}</span></summary>
      <div className="cl-body">{content}</div>
    </details>);
});
/**
 * MVU 裸 JSON 变量块（VariableInsert/VariableUpdate 两代标记）：默认折叠，
 * 标题「变量更新 · N 键」，展开看美化后的 JSON。不再裸文本外露（批次修复 1）。
 */
const VariableUpdateBlock = memo(function VariableUpdateBlock({ raw }) {
    const parsed = useMemo(() => parseVariableJson(raw), [raw]);
    return (<details className="dsht-rp-state-update dsht-rp-var-update" data-testid="dsht-rp-var-update">
      <summary>⚙ 变量更新{parsed !== null ? ` · ${parsed.keys} 键` : ''}</summary>
      <div className="su-body">
        <pre className="su-raw">{parsed !== null ? parsed.pretty : raw}</pre>
      </div>
    </details>);
});
/** T2.10 状态更新块（stateUpdateTags/MVU：Analysis 思维链 + JSONPatch diff 表） */
const StateUpdateBlock = memo(function StateUpdateBlock({ analysis, patches }) {
    const patchRows = useMemo(() => (patches === null ? null : parseJsonPatches(patches)), [patches]);
    return (<details className="dsht-rp-state-update" data-testid="dsht-rp-state-update">
      <summary>⚙ 状态更新</summary>
      <div className="su-body">
        {analysis !== null && (<details className="dsht-rp-reasoning">
            <summary>分析</summary>
            <div className="rp-reasoning-body">{analysis}</div>
          </details>)}
        {patchRows !== null && patchRows.length > 0 && (<table className="su-patch-table">
            <thead><tr><th>操作</th><th>路径</th><th>值</th></tr></thead>
            <tbody>
              {patchRows.map((p, i) => (<tr key={i}><td className="su-op">{p.op}</td><td className="su-path">{p.path}</td><td>{p.value ?? '—'}</td></tr>))}
            </tbody>
          </table>)}
        {patchRows === null && patches !== null && <pre className="su-raw">{patches}</pre>}
      </div>
    </details>);
});
/** T2.10 伏笔登记册面板（foreshadowingTags：内部 details 逐条折叠） */
const ForeshadowingPanel = memo(function ForeshadowingPanel({ content }) {
    const items = useMemo(() => {
        // 内部结构：<details><summary>标题</summary>内容</details> 逐条
        const out = [];
        const re = /<details>([\s\S]*?)<\/details>/gi;
        let m;
        while ((m = re.exec(content)) !== null) {
            const sm = String(m[1]).match(/<summary>([\s\S]*?)<\/summary>/i);
            out.push({
                title: sm ? sm[1].trim() : '伏笔',
                content: sm ? String(m[1]).replace(sm[0], '').trim() : String(m[1]).trim(),
            });
        }
        return out;
    }, [content]);
    return (<details className="dsht-rp-foreshadowing" data-testid="dsht-rp-foreshadowing">
      <summary>🧭 伏笔登记册</summary>
      <div className="fs-body">
        {items.length > 0
            ? items.map((it, i) => (<details key={i} className="dsht-rp-collapsible"><summary><span className="cl-title">{it.title}</span></summary><div className="cl-body">{it.content}</div></details>))
            : <div className="cl-body">{content}</div>}
      </div>
    </details>);
});
/** assistant-step shadowing 渲染器（T2.5a） */
export const RpAssistantNodeView = memo(function RpAssistantNodeView({ node, cwd, renderMessageImages, inputActions, useSession, sessionId, }) {
    const proto = useOutputProtocol(cwd);
    const slug = slugFromCwd(cwd);
    // 批次修复 5：display 时机正则（markdownOnly + placement 含 1/3）由渲染层消费
    const displayScripts = useDisplayRegexes(proto !== null ? slug : null, sessionId ?? '');
    // I4/B6/B8/C3：显示期管线数据（identity/variables/render-entries/EJS+TH 设置；
    // display-compiler.ts 模块级 5s TTL 缓存，仅首楼层真正发请求）
    const pipeline = useDisplayPipeline(proto !== null ? slug : null, sessionId ?? '');
    const data = node.data;
    const streaming = data.status === 'running';
    const interrupted = data.status === 'interrupted';
    // T1.14 窗口化：外壳自注册进共享协调器；流式中的消息恒渲染（forced，不占位）
    const sessionKey = sessionId ?? cwd ?? 'rp-chat';
    const { shellRef, windowed, placeholderHeight } = useMessageWindowing(sessionKey, node.key, streaming);
    // ---- 变体显示覆盖（T2.5c 配套）：DSH 转录按设计只认 append-origin 事件
    //（replace 是 model-only——compaction 语义），变体切换只改模型面。这里在
    // display 层把 append-origin 文本替换为组内 active 变体文本（§4.15 swipe
    // 的用户可见语义），不写任何事件、不污染 session log。----
    const nodeCount = useSession === undefined ? 0 : useSession((snapshot) => snapshot.chat?.order?.length ?? 0);
    const groups = useVariantGroups(sessionId ?? '', nodeCount);
    // P0-3 depth 透传：消息深度 = 其后 assistant 消息数（0 = 最新），条目自身
    // minDepth/maxDepth 在 runDisplayScripts 中真实生效（此前写死 null 不过滤）
    const messageDepth = useSession === undefined ? null : useSession((snapshot) => {
        const mySeq = data.finalNode?.seq;
        if (typeof mySeq !== 'number')
            return 0;
        const chat = snapshot.chat;
        let newer = 0;
        for (const n of chat?.nodes?.values() ?? []) {
            if (n.kind !== 'assistant-step')
                continue;
            const s = n.data?.finalNode?.seq;
            if (typeof s === 'number' && s > mySeq)
                newer += 1;
        }
        return newer;
    });
    const variantOverride = useMemo(() => {
        const seq = data.finalNode?.seq;
        if (seq === undefined || streaming || groups.length === 0)
            return undefined;
        const g = groupOf(groups, seq);
        if (g === undefined || g.members.length < 2)
            return undefined;
        const active = g.members.find(m => m.seq === g.activeSeq);
        if (active === undefined || active.seq === seq)
            return undefined;
        return active.text;
    }, [data.finalNode?.seq, groups, streaming]);
    // 思考折叠行耗时（2026-09-04）：本 step 耗时 + 本轮总耗时（任务结束后显示）
    const hideAfter = useRollbackMask(sessionId);
    const stepDurationMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, hideAfter).stepMs.get(node.key));
    const turnTotalMs = useSession === undefined ? undefined : useSession((snapshot) => floorIndexOf(snapshot, hideAfter).turnMs.get(node.key));
    // C3 depth_ignore_hidden：深度计算剔除被回退掩码隐藏的更新楼层（seq > hideAfter）
    const hiddenNewerCount = useSession === undefined ? 0 : useSession((snapshot) => {
        const mySeq = data.finalNode?.seq;
        if (typeof mySeq !== 'number' || hideAfter <= 0)
            return 0;
        const chat = snapshot.chat;
        let hidden = 0;
        for (const n of chat?.nodes?.values() ?? []) {
            if (n.kind !== 'assistant-step')
                continue;
            const s = n.data?.finalNode?.seq;
            if (typeof s === 'number' && s > mySeq && s > hideAfter)
                hidden += 1;
        }
        return hidden;
    });
    // ---- I2 滚动锚定（增量贴底）：仅「新消息插入」（本楼层节点挂载）时触发——
    // 若滚动容器接近底部（阈值 120px），rAF 后 scrollTop = scrollHeight。
    // 不用 scrollIntoView（会破坏 0.1.2 原生 overflow-anchor 锚定）；旧楼层窗口化
    // 重挂载（depth > 0）与用户上滑浏览历史（距底 > 120px）都不抢滚动。----
    const bodyRef = useRef(null);
    useLayoutEffect(() => {
        if (messageDepth !== 0)
            return; // 只处理最新楼层
        const shell = shellRef.current;
        if (shell === null)
            return;
        const container = findScrollAncestor(shell);
        if (container === null)
            return;
        if (container.scrollTop + container.clientHeight < container.scrollHeight - 120)
            return;
        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        // 流式内容增长由原生锚定接管，本 effect 只在节点挂载（新楼层插入）时跑一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.key]);
    const processed = useMemo(() => {
        const units = [];
        const actions = [];
        // ---- C3 TH 渲染组门（设置不可达 = 全开/不限，不因数据面降级）----
        const thRenderOn = pipeline.th === null ? true : pipeline.th.enabled;
        const depthLimit = pipeline.th === null ? -1 : pipeline.th.depth;
        const effectiveDepth = (messageDepth ?? 0) - hiddenNewerCount;
        const depthOk = depthLimit < 0 || effectiveDepth <= depthLimit;
        // allow_streaming：关 = 流式期间不出 iframe 段（定稿后一次性渲染，TH 同语义）
        const streamingRenderOk = !streaming || (pipeline.th?.allowStreaming === true);
        const enhanced = thRenderOn && depthOk && streamingRenderOk;
        // ---- B8 素材：展开前后全文对比（确有变化才写回）----
        const rawTexts = [];
        const expandedTexts = [];
        let pureTextMessage = true; // 含 reasoning/tool 等块的楼层不写回（replace 会丢思考历史）
        for (const block of data.blocks) {
            if (block.kind === 'reasoning') {
                units.push({ kind: 'reasoning', text: block.text ?? '' });
                pureTextMessage = false;
            }
            else if (block.kind === 'image') {
                units.push({ kind: 'image', images: [block.attachment] });
                pureTextMessage = false;
            }
            else if (block.kind === 'text' && typeof block.text === 'string') {
                // 变体覆盖：整条变体文本替换 append-origin 文本（swipe 是整条回复的替代）
                let source = variantOverride !== undefined ? variantOverride : block.text;
                if (proto === null) {
                    // 非 RP 会话：纯官方行为（不过协议）
                    if (source.trim())
                        units.push({ kind: 'text', text: source });
                }
                else {
                    // P0-3：display 正则两趟执行 + 私用区 token 隔离 + 防空白守卫
                    //（display-compiler.ts runDisplayScripts；depth 透传真实消息深度）
                    if (displayScripts.length > 0) {
                        const run = runDisplayScripts(displayScripts, source, messageDepth);
                        for (const w of run.warnings)
                            console.warn('[dsht-rp] display 正则：', w);
                        source = run.text;
                    }
                    // I4 显示期宏展开（markdown 编译前；ctx 未就绪/失败 = 原文透传）
                    rawTexts.push(source);
                    if (pipeline.ctx !== null)
                        source = expandDisplayMacros(source, pipeline.ctx);
                    expandedTexts.push(source);
                    for (const seg of applyOutputProtocolSegments(source, proto, streaming)) {
                        if (seg.kind === 'text') {
                            for (const part of splitStatusbarBlocks(seg.content)) {
                                if (part.type === 'text' && part.content.trim()) {
                                    // C3：渲染关 / 深度超限 / 流式禁渲染 → 退纯文本（不切三段，整段 MarkdownText）
                                    if (!enhanced) {
                                        units.push({ kind: 'text', text: part.content });
                                        continue;
                                    }
                                    // P0-2 三段编译（display-compiler.ts compileDisplaySegments）：
                                    // 完整 HTML 文档 → iframe（悬浮球 position:fixed 部件在 iframe 舞台运行）；
                                    // 行首平衡 HTML 块 → sanitize 内联（sanitize 失败整块转 iframe，
                                    // 替代旧的「sanitize 失败就纯文本」兜底）；其余 prose → MarkdownText。
                                    for (const dseg of compileDisplaySegments(part.content)) {
                                        if (dseg.kind === 'markdown') {
                                            if (dseg.text.trim())
                                                units.push({ kind: 'text', text: dseg.text });
                                        }
                                        else if (dseg.kind === 'html') {
                                            units.push({ kind: 'frame', html: dseg.source });
                                        }
                                        else {
                                            const clean = sanitizeDisplayHtml(dseg.source);
                                            if (clean !== null)
                                                units.push({ kind: 'html', html: clean });
                                            else
                                                units.push({ kind: 'frame', html: dseg.source });
                                        }
                                    }
                                }
                                else if (part.type === 'statusbar' && part.content.trim()) {
                                    units.push({ kind: 'statusbar', text: part.content });
                                }
                            }
                        }
                        else if (seg.kind === 'action') {
                            actions.push(seg.color !== undefined ? { label: seg.text, color: seg.color } : { label: seg.text });
                        }
                        else {
                            units.push({ kind: 'protocol', seg });
                        }
                    }
                }
            }
            else {
                pureTextMessage = false;
            }
            // tool-call 块由官方 ChatView 分组成工具行，这里跳过（与官方 AssistantMarkdown 同语义）
        }
        // ---- B6 [RENDER:BEFORE/AFTER] 包裹：编译输出首尾拼 render-entries HTML
        //（ejs renderLoader 启用 + TH 渲染开/深度内；sanitize 失败转 iframe，与正则块同兜底）----
        if (proto !== null && pipeline.ejs !== null && pipeline.ejs.enabled
            && pipeline.ejs.renderLoaderEnabled && thRenderOn && depthOk) {
            if (pipeline.entries.before.trim() !== '') {
                const clean = sanitizeDisplayHtml(pipeline.entries.before);
                units.unshift(clean !== null ? { kind: 'html', html: clean } : { kind: 'frame', html: pipeline.entries.before });
            }
            if (pipeline.entries.after.trim() !== '') {
                const clean = sanitizeDisplayHtml(pipeline.entries.after);
                units.push(clean !== null ? { kind: 'html', html: clean } : { kind: 'frame', html: pipeline.entries.after });
            }
        }
        // ---- B8 客户端写回素材（settled + 纯文本楼 + 展开确有变化；调用在下方 effect）----
        // 【审查修复 2026-09-05】variantOverride 非 undefined = 正在回看历史变体——
        // 素材是变体文本，写回会把原楼层正文替换成另一 variant（数据损坏），必须跳过。
        const rawJoined = rawTexts.join('\n\n');
        const expandedJoined = expandedTexts.join('\n\n');
        const mySeq = data.finalNode?.seq;
        const permanent = proto !== null && !streaming && pureTextMessage && sessionId !== undefined
            && variantOverride === undefined
            && pipeline.ejs !== null && pipeline.ejs.enabled && pipeline.ejs.permanentEvaluation
            && pipeline.ctx !== null && typeof mySeq === 'number' && expandedJoined !== rawJoined
            ? { sessionId, seq: mySeq, text: expandedJoined }
            : undefined;
        return { actions, units, permanent };
    }, [data.blocks, proto, streaming, variantOverride, displayScripts, messageDepth, hiddenNewerCount, pipeline]);
    // ---- B8 永久写回（渲染成功 = processed 无异常落地；reportPermanentRender 幂等去重）----
    useEffect(() => {
        const p = processed.permanent;
        if (p !== undefined)
            reportPermanentRender(p.sessionId, p.seq, p.text);
    }, [processed.permanent]);
    // ---- C3 <pre> 增强（collapse_code_block + optimize_hljs）：settled 楼层 DOM 一次过 ----
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (el === null || streaming)
            return;
        const th = pipeline.th;
        if (th === null || th.enabled === false)
            return;
        const depthOk = th.depth < 0 || ((messageDepth ?? 0) - hiddenNewerCount) <= th.depth;
        if (!depthOk)
            return;
        enhancePreBlocks(el, { collapse: th.collapseCodeBlock !== 'none', hljs: th.optimizeHljs });
        // processed 变化（流式重排/窗口化回渲）时 React 可能重建 pre 节点 → 重跑补齐（幂等）
    }, [pipeline.th, streaming, processed, messageDepth, hiddenNewerCount]);
    /** T2.5b：行动选项点击 → 原生 composer 提交通道（setDraft + submit，不自绘输入栏） */
    const sendAction = useCallback((text) => {
        inputActions?.setDraft(text);
        inputActions?.submit();
    }, [inputActions]);
    const hasVisible = streaming || interrupted === true || processed.units.length > 0 || data.blocks.some(b => b.kind !== 'tool-call');
    // 逻辑回退掩码：本 step 的定稿消息 seq 已被回退/编辑/重新生成移出上下文 → 不渲染
    const mySeq = typeof data.finalNode?.seq === 'number' ? data.finalNode.seq : undefined;
    const hiddenByRollback = hideAfter > 0 && mySeq !== undefined && mySeq > hideAfter;
    if (!hasVisible || hiddenByRollback)
        return null;
    const codeLabels = { copyLabel: '复制', copiedLabel: '已复制' };
    // 耗时只挂最后一个 reasoning 单元（思考在最后一块结束时结束；多个思考块不重复显示）
    let lastReasoningIdx = -1;
    for (let i = 0; i < processed.units.length; i++) {
        const k = processed.units[i].kind;
        if (k === 'reasoning' || (k === 'protocol' && processed.units[i].seg.kind === 'reasoning'))
            lastReasoningIdx = i;
    }
    return (<div ref={shellRef} className="dsht-rp-assistant" data-windowed={windowed || undefined} style={windowed ? { height: `${placeholderHeight}px` } : undefined}>
      {!windowed && (<>
      <RpFloorBadge useSession={useSession} nodeKey={node.key} side="assistant" sessionId={sessionId}/>
      <div className="dsht-rp-assistant-body" ref={bodyRef}>
        {processed.units.map((u, i) => {
                if (u.kind === 'text') {
                    return <MarkdownText key={i} text={u.text} streaming={streaming && i === processed.units.length - 1} codeLabels={codeLabels}/>;
                }
                if (u.kind === 'html') {
                    // display 正则/B6 包裹产出的白名单 HTML（已 sanitize；sanitize 失败的整块已转 iframe）
                    return <div key={i} className="dsht-rp-html" dangerouslySetInnerHTML={{ __html: u.html }}/>;
                }
                if (u.kind === 'frame') {
                    // 完整 HTML 文档段 / sanitize 失败的平衡 HTML 块 → 沙箱 iframe（悬浮球舞台）
                    // C3 use_blob_url：TH Blob URL 渲染形态（沙箱不变，blob 加载失败可关回 srcdoc）
                    return <RpMessageFrame key={i} html={u.html} useBlobUrl={pipeline.th?.useBlobUrl === true}/>;
                }
                if (u.kind === 'statusbar') {
                    return <StatusBarCard key={i} content={u.text}/>;
                }
                if (u.kind === 'reasoning') {
                    const last = i === lastReasoningIdx;
                    return <ReasoningRow key={i} text={u.text} running={streaming} {...(last ? { durationMs: stepDurationMs, turnTotalMs } : {})}/>;
                }
                if (u.kind === 'protocol') {
                    const seg = u.seg;
                    if (seg.kind === 'status')
                        return <StatusBarCard key={i} content={seg.content}/>;
                    if (seg.kind === 'collapsible')
                        return <CollapsibleBlock key={i} title={seg.title} content={seg.content}/>;
                    if (seg.kind === 'state-update')
                        return <StateUpdateBlock key={i} analysis={seg.analysis} patches={seg.patches}/>;
                    if (seg.kind === 'foreshadowing')
                        return <ForeshadowingPanel key={i} content={seg.content}/>;
                    if (seg.kind === 'reasoning') {
                        const last = i === lastReasoningIdx;
                        return <ReasoningRow key={i} text={seg.content} running={false} {...(last ? { durationMs: stepDurationMs, turnTotalMs } : {})}/>;
                    }
                    if (seg.kind === 'statusbar-placeholder')
                        return <MvuStatusbar key={i} sessionId={sessionId}/>;
                    return null;
                }
                return (<Fragment key={i}>
              {renderMessageImages({ images: (u.images ?? []), align: 'start' })}
            </Fragment>);
            })}
        {interrupted && <span className="dsht-rp-stopped">已停止</span>}
      </div>
      {processed.actions.length > 0 && (<div className="dsht-rp-actions" data-testid="dsht-rp-actions">
          {processed.actions.map((a, i) => (<button key={i} type="button" className="dsht-rp-action-btn" disabled={streaming} onClick={() => { sendAction(a.label); }}>
              <span className="tag">▸</span>
              <span style={a.color !== undefined ? { color: a.color } : undefined}>{a.label}</span>
            </button>))}
        </div>)}
      </>)}
    </div>);
});
// ---------------------------------------------------------------------------
// 变体组（T2.5c）：共享缓存 + 订阅（变体条与 assistant-step 显示覆盖共用）
// ---------------------------------------------------------------------------
/** sessionId → 变体组清单（/dsht-rp/variant/groups；切换/新消息后刷新）。
 * 缓存归一化后的组（normalizeVariantGroups：按文本去重，计数恒定 1..N）——
 * 后端每次切换都 append 新 replace 事件并入组，不归一则左右滑数字不断叠加。 */
const groupsCache = new Map();
const groupsListeners = new Map();
async function fetchVariantGroups(sessionId) {
    try {
        const r = await rpApi('variant/groups', { sessionId });
        return normalizeVariantGroups(r.groups ?? []);
    }
    catch {
        return [];
    }
}
async function refreshVariantGroups(sessionId) {
    groupsCache.set(sessionId, await fetchVariantGroups(sessionId));
    for (const fn of groupsListeners.get(sessionId) ?? [])
        fn();
}
/**
 * 变体组订阅 hook：挂载取缓存（无则拉取）、监听切换事件刷新。
 * nodeCount 由调用方传入（useSession 的选择器读 chat.order 长度——重 roll 入组
 * 会增节点；replace 事件不增节点，靠切换通知刷新）。
 */
function useVariantGroups(sessionId, nodeCount) {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const bump = () => { setVersion(v => v + 1); };
        const listeners = groupsListeners.get(sessionId) ?? new Set();
        listeners.add(bump);
        groupsListeners.set(sessionId, listeners);
        if (!groupsCache.has(sessionId))
            void refreshVariantGroups(sessionId);
        return () => { listeners.delete(bump); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, nodeCount]);
    return groupsCache.get(sessionId) ?? EMPTY_GROUPS;
}
const EMPTY_GROUPS = [];
// ---------------------------------------------------------------------------
// 变体条（T2.5c）：conversation.chat.assistant-actions 席位
// ---------------------------------------------------------------------------
/** 会话快照里 assistant 节点的轻量投影：messageId → seq */
function seqOfMessage(snapshot, messageId) {
    const chat = snapshot.chat;
    if (!chat?.nodes)
        return undefined;
    for (const n of chat.nodes.values()) {
        const f = n.data?.finalNode;
        if (f?.messageId === messageId && typeof f.seq === 'number')
            return f.seq;
    }
    return undefined;
}
/** 变体条 ‹ n/m ›（渲染进原生 IconActions 行，位于 copy 与 branch 之间） */
export function RpVariantActions({ messageId, useSession, sessionId }) {
    const seq = useSession((snapshot) => seqOfMessage(snapshot, messageId));
    const nodeCount = useSession((snapshot) => snapshot.chat?.order?.length ?? 0);
    const groups = useVariantGroups(sessionId, nodeCount);
    const [switching, setSwitching] = useState(false);
    const group = seq === undefined ? undefined : groupOf(groups, seq);
    const idx = group ? group.members.findIndex(m => m.seq === group.activeSeq) : -1;
    const switchTo = useCallback(async (targetSeq) => {
        if (switching)
            return;
        setSwitching(true);
        try {
            await rpApi('variant/switch', { sessionId, targetSeq });
            // 【实机审计修复 2026-09-05】message_swiped：变体（swipe）切换成功 → TH 事件桥
            //（RpScriptHost 的 SessionRuntime 监听同源 CustomEvent 后按 messageId 解析楼层投递）
            window.dispatchEvent(new CustomEvent('dsht-rp-ui:th-host-event', {
                detail: { sessionId, eventType: 'message_swiped', messageId },
            }));
            // 刷新共享缓存并通知全部订阅者（变体条计数 + assistant-step 显示覆盖）
            await refreshVariantGroups(sessionId);
        }
        catch { /* 切换失败保持现状；数据面不可达时条形静默 */ }
        finally {
            setSwitching(false);
        }
    }, [sessionId, switching, messageId]);
    if (group === undefined || group.members.length < 2 || idx < 0)
        return null;
    const atLeft = idx === 0;
    const atRight = idx === group.members.length - 1;
    return (<span className="dsht-rp-variant-bar" data-testid="dsht-rp-variant-bar" title="历史变体（重 roll / swipe）">
      <button type="button" className="vb-arrow" aria-label="上一个变体" disabled={atLeft || switching} onClick={() => { void switchTo(group.members[idx - 1].seq); }}>‹</button>
      <span className="vb-count">{idx + 1}/{group.members.length}</span>
      <button type="button" className="vb-arrow" aria-label="下一个变体" disabled={atRight || switching} onClick={() => { void switchTo(group.members[idx + 1].seq); }}>›</button>
    </span>);
}
// ---------------------------------------------------------------------------
// 批次修复 6：「↻ 重新生成」按钮（conversation.chat.assistant-actions 席位，
// 与变体条共存）。与「↩ 回退到此处」的区别：回退 = 回到某条用户输入（连同其后
// 一切移除）；重新生成 = 只重来最后一轮（截断最后 assistant turn 并重发最后一条
// 用户输入，queue 模式）。仅 RP 工作区会话的最后一条 assistant 消息显示。
// ---------------------------------------------------------------------------
/** sessionId → 是否 RP 工作区会话（session.list 的 cwd 判定；invalidateWsCache 时失效） */
let rpSessionCache = null;
function fetchRpSessionMap() {
    if (rpSessionCache === null) {
        rpSessionCache = dshRpc('session.list', {})
            .then(r => new Map((r.items ?? []).map(it => [it.sessionId, slugFromCwd(it.cwd) !== null])))
            .catch(() => new Map());
    }
    return rpSessionCache;
}
export const RpRegenerateAction = memo(function RpRegenerateAction({ messageId, useSession, sessionId, regenerate, }) {
    const [busy, setBusy] = useState(false);
    const [isRp, setIsRp] = useState(false);
    useEffect(() => {
        let alive = true;
        void fetchRpSessionMap().then(m => { if (alive)
            setIsRp(m.get(sessionId) === true); });
        return () => { alive = false; };
    }, [sessionId]);
    // 仅最后一条 assistant 消息显示（重新生成语义 = 只重来最后一轮）
    const isLastAssistant = useSession((snapshot) => {
        const chat = snapshot.chat;
        let lastSeq = -1;
        let lastId;
        for (const n of chat?.nodes?.values() ?? []) {
            if (n.kind !== 'assistant-step')
                continue;
            const f = n.data?.finalNode;
            if (typeof f?.seq === 'number' && f.seq > lastSeq) {
                lastSeq = f.seq;
                lastId = f.messageId;
            }
        }
        return lastId !== undefined && lastId === messageId;
    });
    const running = useSession((snapshot) => snapshot.running === true);
    const onClick = useCallback(async () => {
        if (busy || regenerate === undefined)
            return;
        if (!window.confirm('重新生成最后一条回复？（当前回复会被移除）'))
            return;
        setBusy(true);
        try {
            await regenerate(sessionId);
        }
        catch (e) {
            window.alert(`重新生成失败：${e.message}`);
        }
        finally {
            setBusy(false);
        }
    }, [busy, regenerate, sessionId]);
    if (!isRp || !isLastAssistant || running || regenerate === undefined)
        return null;
    return (<button type="button" className="dsht-rp-regen-btn" data-testid="dsht-rp-regenerate" title="重新生成最后一条回复（只重来最后一轮；「回退到此处」才会连同之后一切移除）" disabled={busy} onClick={() => { void onClick(); }}>
      {busy ? '生成中…' : '↻ 重新生成'}
    </button>);
});
/** user 气泡的「↩ 回退到此处」+「✎ 编辑」（**所有会话**——适配 agent/普通会话同样
 *  可回退；2026-09-04 真机反馈：原先仅 RP 工作区会话显示，用户在适配会话里找不到）。
 *  回退 = 逻辑回退到这条消息（/rp/session-rollback）；编辑 = 截断到这条消息**之前**
 *  并以新文本重新发送（/rp/session-edit + session.prompt，「编辑并重发」语义）。 */
export const RpUserNodeView = memo(function RpUserNodeView({ node, cwd, renderMessageImages, sessionId, useSession, }) {
    const data = node.data;
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const seq = typeof data.seq === 'number' ? data.seq : undefined;
    // T1.14 窗口化：user 消息外壳同样自注册（静态内容，无 forced 场景）
    const sessionKey = sessionId ?? cwd ?? 'rp-chat';
    const { shellRef, windowed, placeholderHeight } = useMessageWindowing(sessionKey, node.key, false);
    const parts = useMemo(() => {
        const texts = [];
        const images = [];
        for (const b of data.content ?? []) {
            const block = b;
            if (block.type === 'text' && typeof block.text === 'string')
                texts.push(block.text);
            else if (block.type === 'image' && block.attachment !== undefined)
                images.push({ attachment: block.attachment });
        }
        return { text: texts.join(''), images };
    }, [data.content]);
    const rollback = useCallback(async () => {
        if (busy || seq === undefined || !sessionId)
            return;
        if (!window.confirm('回退到这条消息？其后的对话将从上下文移除（事件仍保留在日志；状态/变量一并回滚）。'))
            return;
        setBusy(true);
        try {
            // POST /dsht-rp/rp/session-rollback：live → 官方 replace 原语逻辑回退（投影
            // 立即生效，无需刷新）；非 live → 文件截断 + .bak（需要整页重载重建投影）
            const r = await rpApi('rp/session-rollback', { sessionId, keepThroughSeq: seq });
            if (r.logical === true) {
                // 【⑨修复 2026-09-05】live 回退后不整页重载——原生 composer 草稿不持久化，
                // reload 即清空。改为 live 同款逻辑回退（掩码更新 + 会话重开）
                void refreshRollbackMask(sessionId); // 掩码更新 → 隐藏被回退消息 + 楼层号重排
                setBusy(false);
            }
            else {
                // 非 live：文件截断 + .bak——会话重开（不整页重载，保留 composer 草稿）
                await dshRpc('session.close', { sessionId }).catch(() => undefined);
                await dshRpc('session.open', { sessionId }).catch(() => undefined);
                void refreshRollbackMask(sessionId);
                setBusy(false);
            }
        }
        catch (e) {
            window.alert(`回退失败：${e.message}`);
            setBusy(false);
        }
    }, [busy, seq, sessionId]);
    const saveEdit = useCallback(async () => {
        if (busy || seq === undefined || !sessionId)
            return;
        const text = draft.trim();
        if (!text)
            return;
        setBusy(true);
        try {
            // POST /dsht-rp/rp/session-edit：live → replace 该消息起视图 + prompt 重发
            //（新消息经事件流自动进入视图）；非 live → 文件截断后重发 + 重载
            const r = await rpApi('rp/session-edit', { sessionId, seq, text });
            if (r.logical === true) {
                // 【实机审计修复 2026-09-05】message_edited：会话编辑成功（live replace 生效）→ TH
                // 事件桥（RpScriptHost 按 nodeKey 解析楼层投递；非 live 分支整页重载后无需投递）
                window.dispatchEvent(new CustomEvent('dsht-rp-ui:th-host-event', {
                    detail: { sessionId, eventType: 'message_edited', nodeKey: node.key },
                }));
                await dshRpc('session.prompt', {
                    request: {
                        requestId: crypto.randomUUID(),
                        sessionId,
                        mode: 'queue',
                        content: [{ type: 'text', text }],
                        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                });
                void refreshRollbackMask(sessionId); // 掩码更新 → 隐藏旧消息
                setBusy(false);
                setEditing(false);
            }
            else {
                // 【⑨修复 2026-09-05】非 live 编辑后不整页重载——原生 composer 草稿不持久化，
                // reload 即清空。改为会话重开（不整页重载，保留 composer 草稿）
                try {
                    await dshRpc('session.prompt', {
                        request: {
                            requestId: crypto.randomUUID(),
                            sessionId,
                            mode: 'queue',
                            content: [{ type: 'text', text }],
                            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                    });
                }
                catch { /* 重发失败也重开：用户看得到截断结果再手动重试 */ }
                await dshRpc('session.close', { sessionId }).catch(() => undefined);
                await dshRpc('session.open', { sessionId }).catch(() => undefined);
                void refreshRollbackMask(sessionId);
                setBusy(false);
                setEditing(false);
            }
        }
        catch (e) {
            window.alert(`编辑失败：${e.message}`);
            setBusy(false);
        }
    }, [busy, draft, seq, sessionId, node.key]);
    // 逻辑回退掩码：本消息 seq 已被编辑/回退移出上下文 → 不渲染（编辑重发的新消息
    // seq 更大，正常显示）
    const maskHide = useRollbackMask(sessionId);
    const hiddenByRollback = maskHide > 0 && typeof data.seq === 'number' && data.seq > maskHide;
    if (hiddenByRollback)
        return null;
    return (<div ref={shellRef} className="dsht-rp-user-row" data-windowed={windowed || undefined} style={windowed ? { height: `${placeholderHeight}px` } : undefined}>
      {!windowed && (<>
      <RpFloorBadge useSession={useSession} nodeKey={node.key} side="user" sessionId={sessionId}/>
      <div className="dsht-rp-user-stack">
        {parts.images.length > 0 && renderMessageImages({ images: parts.images, align: 'end' })}
        {parts.text !== '' && !editing && <div className="dsht-rp-user-bubble">{parts.text}</div>}
        {editing && (<div className="dsht-rp-edit-box">
            <textarea className="dsht-rp-edit-area" value={draft} rows={Math.min(12, Math.max(2, draft.split('\n').length))} autoFocus onChange={(e) => { setDraft(e.target.value); }}/>
            <div className="dsht-rp-edit-actions">
              <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit-cancel" disabled={busy} onClick={() => { setEditing(false); }}>取消</button>
              <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit-save" disabled={busy || !draft.trim()} title="就地截断到这条消息之前，并以编辑后的文本重新发送（不开新分支；状态/变量一并回滚）" onClick={() => { void saveEdit(); }}>{busy ? '处理中…' : '保存并重发'}</button>
            </div>
          </div>)}
      </div>
      {seq !== undefined && sessionId !== undefined && !editing && (<>
          {busy && <span className="dsht-rp-note">回退完成，正在刷新会话…</span>}
          <div className="dsht-rp-user-actions">
            <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-rollback" disabled={busy} title="回退到这条消息（移除其后的对话）" onClick={() => { void rollback(); }}>
              {busy ? '回退中…' : '↩ 回退到此处'}
            </button>
            <button type="button" className="dsht-rp-rollback-btn" data-testid="dsht-rp-edit" disabled={busy} title="编辑这条已发送的消息（就地截断后以新文本重新发送）" onClick={() => { setDraft(parts.text); setEditing(true); }}>
              ✎ 编辑
            </button>
          </div>
        </>)}
      </>)}
    </div>);
});
