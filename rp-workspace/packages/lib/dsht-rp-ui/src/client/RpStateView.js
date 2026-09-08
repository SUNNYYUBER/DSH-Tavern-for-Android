/**
 * PROJECT_PLAN 补全：状态查看双视图面板（表格 / JSON）。
 *
 * - 数据面：POST /dsht-rp/state {sessionId} → {state}（MVU 状态树，只读；
 *   与 RpStateFloat 同一路由，写侧走聊天/变量面板）。
 * - 表格视图：递归键值树（state-view.ts 的 flattenStateTree 铺平成行），
 *   嵌套容器可点击折叠/展开（折叠集合记忆本次打开的选择，打开时默认全展开）；
 * - JSON 视图：只读格式化文本（JSON.stringify 2 空格缩进）；
 * - 挂载：RpStateFloat 悬浮球面板头部「查看状态」按钮拉起（侵入最小的独立
 *   overlay）——本组件不判 slug/会话有效性，由挂载方保证 sessionId 是 RP 会话。
 */
import { useCallback, useEffect, useState } from 'react';
import { rpApi } from './rpc.ts';
import { flattenStateTree, formatStateJson, toggleCollapsed } from './state-view.ts';
export function RpStateView(props) {
    const { sessionId, onClose } = props;
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [view, setView] = useState('table');
    const [collapsed, setCollapsed] = useState(new Set());
    // 打开时拉一次 + 「刷新」手动重拉（悬浮球面板已有 4s 轮询，这里一次快照够用）
    const fetchState = useCallback(async () => {
        if (!sessionId)
            return;
        try {
            const r = await rpApi('state', { sessionId });
            setState(r.state ?? {});
            setError('');
        }
        catch (e) {
            setError(e.message);
        }
    }, [sessionId]);
    useEffect(() => { void fetchState(); }, [fetchState]);
    const rows = state === null ? [] : flattenStateTree(state, collapsed);
    const hasState = state !== null && Object.keys(state).length > 0;
    return (<div className="dsht-rp-stateview-mask" role="dialog" aria-label="状态查看" onClick={onClose}>
      <div className="dsht-rp-stateview" onClick={e => { e.stopPropagation(); }}>
        <div className="sv-head">
          <span>📊 状态查看（MVU 变量）</span>
          <span className="sv-head-actions">
            <button type="button" className={`sv-view-btn${view === 'table' ? ' on' : ''}`} onClick={() => { setView('table'); }}>表格</button>
            <button type="button" className={`sv-view-btn${view === 'json' ? ' on' : ''}`} onClick={() => { setView('json'); }}>JSON</button>
            <button type="button" className="sf-btn" onClick={() => { void fetchState(); }}>刷新</button>
            <button type="button" className="sf-btn" aria-label="关闭" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="sv-body">
          {error && <div className="sv-error">状态拉取失败：{error}</div>}
          {!error && state === null && <div className="sv-empty">加载中…</div>}
          {!error && !hasState && (<div className="sv-empty">（暂无 MVU 状态——这张卡可能不用变量，或还没产生变量更新）</div>)}
          {view === 'table' && hasState && (<div className="sv-table">
              {rows.map(row => row.leaf ? (<div key={row.path === '' ? '(root)' : row.path} className="sv-row" style={{ paddingLeft: row.depth * 14 }}>
                  <span className="sv-key">{row.key}</span>
                  <span className="sv-leaf">{row.valueText}</span>
                </div>) : (<button key={row.path} type="button" className="sv-row sv-node" aria-expanded={row.open === true} style={{ paddingLeft: row.depth * 14 }} onClick={() => { setCollapsed(prev => toggleCollapsed(prev, row.path)); }}>
                  <span className="sv-arrow">{row.open ? '▾' : '▸'}</span>
                  <span className="sv-key">{row.key}</span>
                  <span className="sv-count">{row.count} 项</span>
                </button>))}
            </div>)}
          {view === 'json' && hasState && (<pre className="sv-json">{formatStateJson(state)}</pre>)}
        </div>
      </div>
    </div>);
}
