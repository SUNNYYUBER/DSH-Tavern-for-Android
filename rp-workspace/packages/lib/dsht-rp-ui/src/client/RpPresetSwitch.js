/**
 * T2.7：会话内预设切换（conversation.session.header.actions list 席位）。
 *
 * 用户定案：DSHT 必须能在 session 里随时换预设（DSH 原生 agentPreset.select
 * 对已开始会话返回 agent-preset-locked——历史在该组合下产生）。解法 = RP 预设
 * 是组装层关注点：切换写会话状态文件（/dsht-rp/preset/select），下一轮 pre-step
 * 注入新预设内容（快照消息），历史零搁浅。
 */
import { useEffect, useState } from 'react';
import { rpApi } from './rpc.ts';
import { notifyDisplayMutation } from './RpNativeChat.tsx';
export function RpPresetSwitch({ useSession, sessionId }) {
    const [presets, setPresets] = useState([]);
    const [current, setCurrent] = useState('');
    const [switching, setSwitching] = useState(false);
    // 会话切换时重读（sessionId 变化即重挂/重取）
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const [list, state] = await Promise.all([
                    rpApi('preset/list'),
                    rpApi('preset/state', { sessionId }),
                ]);
                if (!alive)
                    return;
                setPresets(list.presets ?? []);
                setCurrent(state.presetId ?? '');
            }
            catch { /* 数据面不可达时控件静默 */ }
        })();
        return () => { alive = false; };
    }, [sessionId]);
    /** 清单实时化：点开下拉时重拉（迁移/管理面板写入的新预设不等会话重开即可见） */
    const refreshList = async () => {
        try {
            const list = await rpApi('preset/list');
            setPresets(list.presets ?? []);
        }
        catch { /* 数据面不可达保持旧清单 */ }
    };
    const select = async (presetId) => {
        if (switching)
            return;
        setSwitching(true);
        try {
            await rpApi('preset/select', { sessionId, presetId: presetId || null });
            setCurrent(presetId);
            // 【2026-09-08 鲁棒性】display epoch 必须随预设切换 bump（旧代码只 invalidateWsCache
            // 清缓存——useDisplayRegexes 的 effect 依赖 [slug, sessionId, epoch]，epoch 不变则
            // 已挂载楼层永不重取预设作用域 display 正则，切换后显示面滞留旧正则直到重开会话）。
            // notifyDisplayMutation = 清缓存 + bump epoch + 订阅者重渲染（TH 脚本 preset:put 同款语义）。
            notifyDisplayMutation();
        }
        catch { /* 失败回显旧值：下次渲染纠正 */ }
        finally {
            setSwitching(false);
        }
    };
    if (presets.length === 0)
        return null;
    return (<label className="dsht-rp-preset-switch" title="RP 预设（切换即时生效于下一轮）">
      <span className="ps-ico">🎛</span>
      <select className="ps-select" value={current} disabled={switching} onFocus={() => { void refreshList(); }} onChange={e => { void select(e.target.value); }}>
        <option value="">RP 预设：未启用</option>
        {presets.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      </select>
    </label>);
}
