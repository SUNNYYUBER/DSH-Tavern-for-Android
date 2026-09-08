/**
 * R21 会话管理面板（2026-09-04 用户要求）：侧边栏多余会话的定位与自动清理。
 *
 * 数据面（dsh-plugin /rp/sessions-audit|sessions-archive|sessions-autoclean）：
 * - audit：扫全部 session.jsonl header，按 0.1.2 契约分类——
 *   branch-parent（被 branch/fork 过的父会话 = 分叉后弃用的"旧会话"）/ forked
 *   （branch 产物，正在用）/ subagent（不碰）/ empty（0 事件空壳）/ normal
 * - archive：官方 workspace.archive RPC（registry-global archivedSessionIds 集，
 *   grouping surfaces 全部隐藏；数据保留可恢复——归档不是删除）
 * - autoclean：branch-parents / empty 两种模式批量归档（dryRun 预览）
 */
import { useCallback, useEffect, useState } from 'react';
import { rpApi } from './rpc.ts';
const KIND_LABEL = {
    'branch-parent': '分叉残留（旧会话）',
    forked: '分叉产物（在用）',
    subagent: '子代理',
    empty: '空壳',
    normal: '正常',
};
function fmtTime(t) {
    if (t === null || t <= 0)
        return '—';
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function SessionsPanel(props) {
    const [sessions, setSessions] = useState(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const load = useCallback(async () => {
        setSessions(null);
        try {
            const r = await rpApi('sessions-audit');
            // 分叉残留优先、其余按最后时间倒序
            const order = { 'branch-parent': 0, empty: 1, forked: 2, normal: 3, subagent: 4 };
            setSessions([...(r.sessions ?? [])].sort((a, b) => (order[a.kind] - order[b.kind]) || ((b.lastTime ?? 0) - (a.lastTime ?? 0))));
        }
        catch (e) {
            setSessions([]);
            setNote(`审计失败：${e.message}`);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const archive = useCallback(async (ids, label) => {
        if (ids.length === 0) {
            setNote('没有匹配的会话');
            return;
        }
        setBusy(true);
        setNote('');
        try {
            // 首选官方 workspaces.archiveSession（client 进程内直调）；不可用走 host 数据面
            // （host 侧带 0.1.2 cookie 链调 workspace.archive RPC）
            for (const id of ids) {
                if (props.archiveSession !== undefined)
                    await props.archiveSession(id);
                else
                    await rpApi('sessions-archive', { sessionIds: [id] });
            }
            setNote(`${label}：归档 ${ids.length} 个（归档只是侧边栏隐藏，数据保留）`);
            await load();
        }
        catch (e) {
            setNote(`${label}失败：${e.message}`);
        }
        finally {
            setBusy(false);
        }
    }, [load, props.archiveSession]);
    const autoclean = useCallback(async (mode) => {
        setBusy(true);
        setNote('');
        try {
            const pre = await rpApi('sessions-autoclean', { mode, dryRun: true });
            const targets = pre.targets ?? [];
            if (targets.length === 0) {
                setNote('没有需要清理的会话');
                setBusy(false);
                return;
            }
            const confirmText = `将归档 ${targets.length} 个会话（${mode === 'branch-parents' ? '分叉残留旧会话' : '空壳会话'}）：\n${targets.slice(0, 8).map(t => `· ${t.workspace ?? t.sessionId.slice(0, 18)}…（${t.events} 事件）`).join('\n')}${targets.length > 8 ? `\n…共 ${targets.length} 个` : ''}\n\n归档 = 侧边栏隐藏，数据保留可恢复。继续？`;
            if (!window.confirm(confirmText)) {
                setBusy(false);
                return;
            }
            const ids = targets.map(t => t.sessionId);
            for (const id of ids) {
                if (props.archiveSession !== undefined)
                    await props.archiveSession(id);
                else
                    await rpApi('sessions-archive', { sessionIds: [id] });
            }
            setNote(`自动清理：归档 ${ids.length} 个`);
            await load();
        }
        catch (e) {
            setNote(`自动清理失败：${e.message}`);
        }
        finally {
            setBusy(false);
        }
    }, [load, props.archiveSession]);
    const forkedCount = sessions?.filter(s => s.kind === 'branch-parent').length ?? 0;
    const emptyCount = sessions?.filter(s => s.kind === 'empty').length ?? 0;
    return (<div className="dsht-rp-import">
      <h3>会话管理</h3>
      <p className="pc-dim" style={{ margin: '4px 0' }}>
        侧边栏被多余会话刷屏时的定位与清理。归档 = 官方机制：侧边栏隐藏、数据保留、可恢复；
        我们的回退（原地 replace）从不产生新会话——出现「分叉残留」是 branch/fork（官方分叉
        功能）的产物。
      </p>
      <div className="dsht-rp-import-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        <button type="button" className="dsht-rp-btn" disabled={busy || forkedCount === 0} onClick={() => { void autoclean('branch-parents'); }}>
          自动清理分叉残留（{forkedCount}）
        </button>
        <button type="button" className="dsht-rp-btn" disabled={busy || emptyCount === 0} onClick={() => { void autoclean('empty'); }}>
          清理空壳会话（{emptyCount}）
        </button>
        <button type="button" className="dsht-rp-btn" disabled={busy} onClick={() => { void load(); }}>
          ⟳ 重新审计
        </button>
      </div>
      {note !== '' && <p style={{ margin: '6px 0', color: 'var(--dsw-alias-label-secondary, #9ab)' }}>{note}</p>}
      {sessions === null ? <p style={{ margin: '8px 0' }}>审计中…</p> : (<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map(s => (<div key={`${s.projectKey}/${s.sessionId}`} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    border: '1px solid var(--dsw-alias-border-l2, #333)', borderRadius: 10,
                }}>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap',
                    background: s.kind === 'branch-parent' ? '#5a3b1e' : s.kind === 'empty' ? '#333' : s.kind === 'forked' ? '#1e3a5a' : 'transparent',
                    color: '#ddd' }}>{KIND_LABEL[s.kind]}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.workspace ?? s.projectKey.slice(0, 14)} · {s.sessionId.slice(0, 20)} · {s.events} 事件 · {fmtTime(s.lastTime)}
              </span>
              <button type="button" className="dsht-rp-btn" style={{ minHeight: 30, padding: '2px 10px' }} disabled={busy} onClick={() => { void archive([s.sessionId], '归档'); }}>归档</button>
            </div>))}
          {sessions.length === 0 && <p style={{ margin: '8px 0' }}>未发现任何会话文件。</p>}
        </div>)}
    </div>);
}
