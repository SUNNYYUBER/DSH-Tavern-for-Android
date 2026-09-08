/**
 * 悬浮球原生移植（用户定案：原生移植，不让别的功能失效）。
 *
 * 意图来源：示例预设系预设 tavern_helper.scripts（示例卡二脚本）的 pw-state-float——
 * 「🌌 当前平行世界状态」悬浮窗：可拖拽浮球 → 点开当前 MVU 变量状态面板，可拖、可关。
 * 原实现深度钩 ST 内部组件（PromptManager/topDoc），不可直接执行；这里按意图原生重写：
 * - 挂载：conversation.input.dock 席位（position:fixed 视口定位，不随滚动荡走）；
 *   仅 RP 工作区会话（cwd 含 /rp/<slug>）且已有消息时显示——非 RP 会话/空白会话零影响。
 * - 浮球：pointer 拖拽（< 6px 视为点按），位置 localStorage 持久化（跨会话共用位置偏好）。
 * - 面板：点开拉 /dsht-rp/state {sessionId} 的 MVU 状态树，递归渲染；打开时自动拉取
 *   + 每 4s 轮询（生成中状态变化即见）；「刷新」手动重拉。数据只读（写走聊天/变量面板）。
 */
import { useEffect, useRef, useState } from 'react';
import { rpApi } from './rpc.ts';
import { slugFromCwd } from './output-protocol.ts';
import { RpStateView } from './RpStateView.tsx';
import { RpSearchPanel } from './RpSearchPanel.tsx';
import { RpTablesView } from './RpTablesView.tsx';
const POS_KEY = 'dsht.rp.statefloat.pos.v1'; // 旧版全局键（迁移兜底读一次）
const POS_KEY_GLOBAL = 'dsht-float-global'; // F3：无会话上下文时的落点
/** F3：位置键 = dsht-float-<sessionId|global>（按会话记忆位置；无会话回退 global） */
function posKeyOf(sessionId) {
    return sessionId !== '' ? `dsht-float-${sessionId}` : POS_KEY_GLOBAL;
}
/** 视口界内 clamp（拖出视口/换设备视口变小 → 拉回界内；与拖拽中的 clamp 同口径） */
function clampPos(p) {
    return {
        x: Math.min(0.98, Math.max(0.02, p.x)),
        y: Math.min(0.95, Math.max(0.05, p.y)),
    };
}
/** dock 席位 props 的 session 快照不带 cwd（cwd 在宿主 useSessions().byId）——
 * 按 sessionId 向 host 补取（/rp/session-cwd），会话级缓存。RpGreetingDock 同款门槛复用。 */
const cwdCache = new Map();
function fetchSessionCwd(sessionId) {
    let p = cwdCache.get(sessionId);
    if (p === undefined) {
        p = rpApi('rp/session-cwd', { sessionId })
            .then(r => r.cwd ?? null)
            .catch(() => null);
        cwdCache.set(sessionId, p);
    }
    return p;
}
/** props.cwd 缺失时回退 host 补取的 cwd 解析 hook；resolved = 补取已落定（区分加载中与真非 RP） */
export function useRpSlug(cwdFromProps, sessionId) {
    const [cwd, setCwd] = useState(cwdFromProps ?? null);
    const [resolved, setResolved] = useState(cwdFromProps !== undefined && cwdFromProps !== '');
    useEffect(() => {
        if (cwdFromProps) {
            setCwd(cwdFromProps);
            setResolved(true);
            return;
        }
        if (!sessionId) {
            setCwd(null);
            setResolved(true);
            return;
        }
        let alive = true;
        setResolved(false);
        void fetchSessionCwd(sessionId).then(c => { if (alive) {
            setCwd(c);
            setResolved(true);
        } });
        return () => { alive = false; };
    }, [cwdFromProps, sessionId]);
    return { slug: slugFromCwd(cwd ?? undefined), resolved };
}
/** F3：读取位置——会话键 → global 键 → 旧版键 → 默认右上；每级读出后 clamp 回界内 */
function loadPos(key) {
    for (const k of [key, POS_KEY_GLOBAL, POS_KEY]) {
        try {
            const raw = localStorage.getItem(k);
            if (raw) {
                const p = JSON.parse(raw);
                if (typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
                    return clampPos(p);
                }
            }
        }
        catch { /* 坏数据试下一级 */ }
    }
    return { x: 0.92, y: 0.3 }; // 示例卡二默认 bubbleTop 30vh 右侧
}
/** F3：保存位置（会话键 + global 兜底键同写——新会话/无会话上下文都能继承最近位置） */
function savePos(key, pos) {
    try {
        localStorage.setItem(key, JSON.stringify(pos));
        localStorage.setItem(POS_KEY_GLOBAL, JSON.stringify(pos));
    }
    catch { /* 存储不可达 */ }
}
/** MVU 状态树递归渲染（只读） */
function StateTree({ value, depth }) {
    if (value === null || typeof value !== 'object') {
        return <span className="sf-leaf">{String(value ?? '')}</span>;
    }
    const entries = Array.isArray(value)
        ? value.map((v, i) => [String(i), v])
        : Object.entries(value);
    if (entries.length === 0)
        return <span className="sf-leaf sf-empty">（空）</span>;
    return (<div className="sf-level" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {entries.map(([k, v]) => (<div key={k} className="sf-row">
          <span className="sf-key">{k}</span>
          {v !== null && typeof v === 'object'
                ? <StateTree value={v} depth={depth + 1}/>
                : <span className="sf-leaf">{String(v)}</span>}
        </div>))}
    </div>);
}
export function RpStateFloat(props) {
    const s = (props.session ?? {});
    const sessionId = s.sessionId ?? s.id ?? '';
    const cwd = s.header?.cwd ?? s.cwd;
    const { slug } = useRpSlug(cwd, sessionId);
    const msgCount = s.chat?.order?.length ?? s.surface?.nodes?.length ?? 0;
    const [pos, setPos] = useState(() => loadPos(posKeyOf(sessionId)));
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    // PROJECT_PLAN 补全：「查看状态」双视图大面板（RpStateView）由本面板头部按钮拉起
    const [viewOpen, setViewOpen] = useState(false);
    // PROJECT_PLAN §4.15：「消息搜索」面板由本面板头部按钮拉起（与「查看状态」同款式）
    const [searchOpen, setSearchOpen] = useState(false);
    // E6：「剧情表格」只读面板由本面板头部按钮拉起（与「查看状态」同款式）
    const [tablesOpen, setTablesOpen] = useState(false);
    const dragRef = useRef(null);
    // 面板打开时拉取 + 4s 轮询（生成中变量变化即见）
    useEffect(() => {
        if (!open || !sessionId)
            return;
        let alive = true;
        const fetchState = async () => {
            try {
                const r = await rpApi('state', { sessionId });
                if (!alive)
                    return;
                setState(r.state ?? {});
                setError('');
            }
            catch (e) {
                if (alive)
                    setError(e.message);
            }
        };
        void fetchState();
        const timer = setInterval(() => { void fetchState(); }, 4000);
        return () => { alive = false; clearInterval(timer); };
    }, [open, sessionId]);
    // F3：视口变化（转屏/窗口缩放）→ 浮球 clamp 回界内（比例坐标重新校准）
    useEffect(() => {
        const onResize = () => { setPos(p => clampPos(p)); };
        window.addEventListener('resize', onResize);
        return () => { window.removeEventListener('resize', onResize); };
    }, []);
    if (!slug || !sessionId || msgCount === 0)
        return null; // 非 RP / 空白会话不显示
    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false };
    };
    const onPointerMove = (e) => {
        const d = dragRef.current;
        if (d === null)
            return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < 6)
            return; // 点按阈值
        d.moved = true;
        // F3：拖出视口 clamp 回界内（指针捕获下事件照收，出界坐标被拉回）
        setPos(clampPos({ x: d.baseX + dx / window.innerWidth, y: d.baseY + dy / window.innerHeight }));
    };
    const onPointerUp = (e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d === null)
            return;
        if (d.moved) {
            // 松手贴边（左/右吸附，与 ST 浮球行为一致）；F3：写 dsht-float-<sessionId|global>
            const snapped = clampPos({ x: pos.x < 0.5 ? 0.06 : 0.92, y: pos.y });
            setPos(snapped);
            savePos(posKeyOf(sessionId), snapped);
        }
        else {
            setOpen(o => !o);
        }
        e.currentTarget.releasePointerCapture(e.pointerId);
    };
    return (<>
      <button type="button" className="dsht-rp-statefloat-ball" style={{ left: `${pos.x * 100}vw`, top: `${pos.y * 100}vh` }} title="当前状态（MVU 变量）" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>🌌</button>
      {open && (<div className="dsht-rp-statefloat-panel" role="dialog" aria-label="当前状态">
          <div className="sf-head">
            <span>🌌 当前状态</span>
            <span className="sf-head-actions">
              <button type="button" className="sf-btn" onClick={() => { setViewOpen(true); }}>查看状态</button>
              <button type="button" className="sf-btn" onClick={() => { setSearchOpen(true); }}>🔍 搜索</button>
              <button type="button" className="sf-btn" onClick={() => {
                setState(null);
                void rpApi('state', { sessionId })
                    .then(r => { setState(r.state ?? {}); setError(''); })
                    .catch(e => setError(e.message));
            }}>刷新</button>
              <button type="button" className="sf-btn" onClick={() => { setOpen(false); setViewOpen(false); setSearchOpen(false); }}>✕</button>
            </span>
          </div>
          <div className="sf-body">
            {error && <div className="sf-error">状态拉取失败：{error}</div>}
            {state === null && !error && <div className="sf-empty">加载中…</div>}
            {state !== null && Object.keys(state).length === 0 && !error && (<div className="sf-empty">（暂无 MVU 状态——这张卡可能不用变量，或还没产生变量更新）</div>)}
            {state !== null && Object.keys(state).length > 0 && <StateTree value={state} depth={0}/>}
          </div>
        </div>)}
      {/* PROJECT_PLAN 补全：双视图状态大面板（表格可折叠 / JSON 只读），z-index 高于悬浮面板 */}
      {open && viewOpen && <RpStateView sessionId={sessionId} onClose={() => { setViewOpen(false); }}/>}
      {/* PROJECT_PLAN §4.15：消息搜索面板（同款式 overlay；点击结果项在面板内展开全文，
            不做滚动定位——官方 ChatView 滚动容器不受控，见 RpSearchPanel 头注） */}
      {open && searchOpen && <RpSearchPanel sessionId={sessionId} onClose={() => { setSearchOpen(false); }}/>}
      {/* E6：剧情表格只读面板（GET /dsht-memory/tables?sessionId=；每表顶部折叠行） */}
      {open && tablesOpen && <RpTablesView sessionId={sessionId} onClose={() => { setTablesOpen(false); }}/>}
    </>);
}
