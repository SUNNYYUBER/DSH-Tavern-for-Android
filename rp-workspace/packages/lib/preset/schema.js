"use strict";
/**
 * DSHTavern RP 预设表层 schema 与类型（M1 / T1.9，计划文档 §4.3）
 *
 * preset.json = 玩家/UI 编辑格式（表层）；编译到 DSH preset 目录（里层）由编译器负责。
 * 组装器（slots → messages）消费本 schema 的编译期展开产物。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BUDGET = void 0;
exports.emptyPreset = emptyPreset;
exports.compileSlots = compileSlots;
exports.DEFAULT_BUDGET = {
    maxToolRounds: 2,
    maxCallsPerRun: 8,
    delegationMaxPerRun: 8,
    delegationResultBudgetTokens: 8000,
    modelRetry: { maxRetries: 3, intervalMs: 3000 },
};
/** 直答型示范预设的骨架（T1.10 的基础） */
function emptyPreset(id, displayName) {
    return {
        schemaVersion: 1,
        id,
        displayName,
        model: {},
        path: 'direct',
        toggles: [],
        slots: [
            { id: 'main', type: 'system', content: '', enabled: true },
            { id: 'worldBefore', type: 'marker', enabled: true },
            { id: 'charDesc', type: 'marker', enabled: true },
            { id: 'charPersonality', type: 'marker', enabled: true },
            { id: 'scenario', type: 'marker', enabled: true },
            { id: 'persona', type: 'marker', enabled: true },
            { id: 'stateSummary', type: 'state', enabled: true },
            { id: 'configSummary', type: 'configSummary', enabled: true },
            { id: 'chatHistory', type: 'marker', enabled: true },
            { id: 'worldAfter', type: 'marker', enabled: true },
            { id: 'jb', type: 'system', content: '', enabled: true, depth: 2 },
        ],
        knowledge: { books: [], scanDepth: 2, budgetPercent: 25 },
        budget: { ...exports.DEFAULT_BUDGET },
        sampling: { temperature: 1, topP: 0.95 },
    };
}
function compileSlots(preset) {
    const out = [];
    // 【⑧修复 2026-09-05】slot/toggle 双份注入去重——同一启用条目在 slots 和 toggles
    // 都产出时，toggle 侧跳过（slots 的 depth/role/condition 语义更完整，优先保留）
    const seenContent = new Set();
    for (const slot of preset.slots) {
        if (!slot.enabled)
            continue;
        // T3.3：configSummary 槽展开时拼接配置自查补充文本（configSummaryExtra，
        // ST agent 预设三档归位产物①——组装层 buildConfigSummary 产出确定性摘要后
        // 以槽内容追加注入；无该字段的预设 content 维持空串，行为不变）
        let content = slot.content ?? '';
        if (slot.type === 'configSummary') {
            const extra = preset.configSummaryExtra?.trim();
            if (extra)
                content = content.trim() ? `${content.trim()}\n\n${extra}` : extra;
        }
        // 条件槽位：无条件时收起（运行期组装时再验——这里保留声明）
        const trimmed = content.trim();
        if (trimmed !== '' && seenContent.has(trimmed))
            continue;
        if (trimmed !== '')
            seenContent.add(trimmed);
        out.push({
            id: slot.id,
            type: slot.type,
            content,
            depth: slot.depth,
            role: slot.role ?? 'system',
            condition: slot.condition,
            source: `slot:${slot.id}`,
        });
    }
    for (const group of preset.toggles) {
        if (group.multi === true) {
            // 多选组：全部 selected 项展开
            for (const option of group.options) {
                if (!option.selected)
                    continue;
                const trimmed = option.content.trim();
                if (trimmed !== '' && seenContent.has(trimmed))
                    continue;
                if (trimmed !== '')
                    seenContent.add(trimmed);
                out.push({
                    id: `toggle-${group.group}-${option.id}`,
                    type: 'system',
                    content: option.content,
                    role: 'system',
                    source: `toggle:${group.group}/${option.id}`,
                });
            }
            continue;
        }
        // 选一组：恰好一个 selected（缺省取第一个）
        const selected = group.options.find(o => o.selected) ?? group.options[0];
        if (!selected)
            continue;
        const trimmed = selected.content.trim();
        if (trimmed !== '' && seenContent.has(trimmed))
            continue;
        if (trimmed !== '')
            seenContent.add(trimmed);
        out.push({
            id: `toggle-${group.group}`,
            type: 'system',
            content: selected.content,
            role: 'system',
            source: `toggle:${group.group}/${selected.id}`,
        });
    }
    return out;
}
