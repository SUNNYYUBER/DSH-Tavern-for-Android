/**
 * 批次修复 5：「我的」persona 面板（RpOverlay 新 tab）。
 *
 * 存储契约（给后端/组装层对接用，勿随意改）：
 * - 文件：$DSH_HOME/rp/persona.json
 * - 结构：{ schemaVersion: 1, active: string | null, list: Array<{ name, description }> }
 *   active = 默认 persona 的名字（list 中某条 name）；null = 未选择。
 * - 写：优先 POST /dsht-rp/rp/persona {active, list}（后端轻量路由，并行任务可提供）；
 *   路由缺失（404）时回退既有 /dsht-rp/write-files 写 rp/persona.json（白名单含 rp/）。
 * - 读：POST /dsht-rp/rp/persona（空 body → 返回 {active, list}）；路由缺失回退空表。
 * - 消费（组装层，另一任务）：rp.json 的 macros.user 从 active persona 取 name 作
 *   {{user}}，description 作 {{persona}}/personaDescription 注入 persona 槽位。
 *   迁移的 ST persona（如 示例人设甲/示例人设乙/示例人设丙）由迁移 agent 写入本文件。
 */
import { useCallback, useEffect, useState } from 'react';
import { rpApi } from './rpc.ts';
const EMPTY = { schemaVersion: 1, active: null, list: [] };
async function loadPersona() {
    try {
        const r = await rpApi('rp/persona');
        return { schemaVersion: 1, active: r.active ?? null, list: Array.isArray(r.list) ? r.list : [] };
    }
    catch { /* 路由未建/读取失败 → 空表起步 */ }
    return EMPTY;
}
async function savePersona(file) {
    try {
        await rpApi('rp/persona', { active: file.active, list: file.list });
    }
    catch {
        // 回退：write-files 白名单直写（路由由后端任务提供前的保底通道）
        await rpApi('write-files', { files: [{ path: 'rp/persona.json', content: JSON.stringify(file, null, 2) }] });
    }
}
export function PersonaPanel() {
    const [file, setFile] = useState(EMPTY);
    const [loaded, setLoaded] = useState(false);
    const [status, setStatus] = useState('');
    const [expanded, setExpanded] = useState(null);
    useEffect(() => {
        void loadPersona().then(f => { setFile(f); setLoaded(true); });
    }, []);
    const patchEntry = (i, next) => {
        setFile(prev => {
            const list = [...prev.list];
            list[i] = next;
            // 改名时同步 active 引用（active 按 name 索引）
            const active = prev.active === prev.list[i]?.name ? next.name : prev.active;
            return { ...prev, list, active };
        });
    };
    const addEntry = () => {
        setFile(prev => ({ ...prev, list: [...prev.list, { name: `新人设 ${prev.list.length + 1}`, description: '' }] }));
        setExpanded(file.list.length);
    };
    const removeEntry = (i) => {
        setFile(prev => {
            const removed = prev.list[i];
            const list = prev.list.filter((_, j) => j !== i);
            return { ...prev, list, active: prev.active === removed?.name ? null : prev.active };
        });
        setExpanded(null);
    };
    const save = useCallback(async () => {
        setStatus('保存中…');
        try {
            await savePersona(file);
            setStatus('✓ 已保存（下一轮对话生效）');
        }
        catch (e) {
            setStatus(`保存失败：${e.message}`);
        }
    }, [file]);
    return (<div className="dsht-rp-preset">
      <div className="dsht-rp-section">
        <h3>👤 我的设定（persona）</h3>
        <p className="desc">
          你在角色扮演里的身份：默认人设的名字填进 {'{{user}}'}，描述填进 {'{{persona}}'}。
          迁移来的 SillyTavern 人设会出现在下面的列表里。
        </p>
        {!loaded && <p className="dsht-rp-note">读取中…</p>}
        {loaded && file.list.length === 0 && (<p className="dsht-rp-note">还没有人设——点下方「＋ 新增人设」创建一个，或先做数据迁移。</p>)}
        {file.list.map((p, i) => (<div key={i} className="dsht-rp-persona-row" data-open={expanded === i || undefined}>
            <div className="pr-head">
              <label className="rx-check" title="设为默认人设">
                <input type="radio" name="dsht-persona-active" checked={file.active === p.name} onChange={() => { setFile(prev => ({ ...prev, active: p.name })); }}/>
                <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{p.name || '（未命名）'}</span>
              </label>
              {file.active === p.name && <span className="rx-badge rx-timing">默认</span>}
              <button type="button" className="dsht-rp-back" style={{ width: 28, height: 28, fontSize: 14 }} aria-label={expanded === i ? '收起' : '编辑'} onClick={() => { setExpanded(expanded === i ? null : i); }}>{expanded === i ? '▴' : '✎'}</button>
            </div>
            {expanded === i && (<div className="pr-edit">
                <input className="dsht-rp-field" value={p.name} placeholder="名字（显示名）" onChange={e => { patchEntry(i, { ...p, name: e.target.value }); }}/>
                <textarea className="dsht-rp-field" rows={4} value={p.description} placeholder="人设描述（外貌/身份/口癖……会注入提示词）" onChange={e => { patchEntry(i, { ...p, description: e.target.value }); }}/>
                <button type="button" className="dsht-rp-btn" style={{ height: 30, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => { removeEntry(i); }}>删除此人设</button>
              </div>)}
          </div>))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="dsht-rp-btn" style={{ background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)' }} onClick={() => { addEntry(); }}>＋ 新增人设</button>
          <button type="button" className="dsht-rp-btn" disabled={!loaded} onClick={() => { void save(); }}>保存</button>
        </div>
        {status && <p className="dsht-rp-note" style={{ marginTop: 8 }}>{status}</p>}
      </div>
    </div>);
}
