/**
 * 三个预适配插件的探活 + 功能自检端点（纯数据面，零 React 依赖——
 * 单测直接 import；MigrationStatusPanel 与 PluginCards 复用同一份清单）。
 *
 * 自检升级史：批次修复 11（ping → 真实写读/渲染断言）→ 本批次（修复 8：
 * 宏展开实测 + 状态栏实测，后端路由并行在建，按路由名消费）。
 */
async function postJson(url, body) {
    const resp = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ok: resp.ok, json: await resp.json().catch(() => ({})) };
}
/** MVU 自检：专用 __selftest__ 会话写入 canary 变量再读回（写读闭环）
 * + 批次修复 8：状态栏实测（/dsht-mvu/statusbar 返回 html 即活） */
async function selftestMvu() {
    const w = await postJson('/dsht-mvu/variables/register', { sessionId: '__selftest__', variables: { __dsht_selftest__: 1, 好感度: 1 } });
    if (!w.ok)
        return false;
    const r = await fetch('/dsht-mvu/variables?sessionId=__selftest__', { method: 'GET' });
    if (!r.ok)
        return false;
    const j = await r.json();
    if (j.variables?.__dsht_selftest__ !== 1)
        return false;
    const sb = await fetch('/dsht-mvu/statusbar-render?sessionId=__selftest__', { method: 'GET' });
    if (!sb.ok)
        return false;
    const sj = await sb.json().catch(() => ({}));
    return typeof sj.html === 'string' && sj.html.length > 0;
}
/** 酒馆助手自检：global 作用域 canary 变量写入 → 读回 → 删除清理
 * + 批次修复 8：宏展开实测（expand "{{time}}" 返回非原文即活） */
async function selftestTavernHelper() {
    const w = await postJson('/dsht-tavern-helper/variables', { scope: 'global', path: '__dsht_selftest__', value: 1 });
    if (!w.ok)
        return false;
    const r = await fetch('/dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__', { method: 'GET' });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    // 清理 canary（失败不影响结论）
    void fetch('/dsht-tavern-helper/variables?scope=global&path=__dsht_selftest__', { method: 'DELETE' }).catch(() => undefined);
    if (j.value !== 1)
        return false;
    const ex = await postJson('/dsht-tavern-helper/macros/expand', { text: '{{time}}' });
    if (!ex.ok)
        return false;
    const expanded = ex.json.result ?? ex.json.expanded ?? ex.json.text;
    return typeof expanded === 'string' && expanded !== '{{time}}';
}
/** 提示词模板自检：固定模板渲染断言输出（EJS 子集真实求值） */
async function selftestPromptTemplate() {
    const r = await postJson('/dsht-prompt-template/render', { template: '你好，{{user}}！', context: { user: '自检' } });
    return r.ok && r.json.result === '你好，自检！';
}
/** 三个预适配插件的探活 + 功能自检端点（同源 fetch）。
 * PluginCards.tsx（设置→插件「可配置」辨识卡）复用同一份清单（只用 ping）。 */
export const PROBES = [
    {
        label: '变量 / 状态栏（MVU）',
        listName: 'dsht-plugin-mvu',
        ping: async () => (await fetch('/dsht-mvu/settings', { method: 'GET' })).ok,
        selftest: selftestMvu,
    },
    {
        label: '酒馆助手（变量与脚本）',
        listName: 'dsht-plugin-tavern-helper',
        ping: async () => (await fetch('/dsht-tavern-helper/variables?scope=global', { method: 'GET' })).ok,
        selftest: selftestTavernHelper,
    },
    {
        label: '提示词模板（EJS）',
        listName: 'dsht-plugin-prompt-template',
        ping: async () => (await fetch('/dsht-prompt-template/check', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[]}',
        })).ok,
        selftest: selftestPromptTemplate,
    },
    {
        label: '剧情记忆（楼层总结）',
        listName: 'dsht-plugin-memory',
        ping: async () => (await fetch('/dsht-memory/health', { method: 'GET' })).ok,
        selftest: async () => {
            const r = await fetch('/dsht-memory/status?sessionId=__selftest__', { method: 'GET' });
            if (!r.ok)
                return false;
            const j = await r.json().catch(() => ({}));
            // 功能断言：状态端点返回数值型 cursor/lastFloor（路由读 state/进度文件闭环）
            return typeof j.cursor === 'number' && typeof j.lastFloor === 'number';
        },
    },
];
