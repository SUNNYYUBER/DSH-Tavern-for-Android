"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoDirectPreset = demoDirectPreset;
exports.demoLightAgentPreset = demoLightAgentPreset;
/**
 * 两个示范预设（M1 / T1.10，计划文档 §3.2 三条生成路径的前两条走查载体）
 *
 * - demo-direct：直答型（场景 A）——无工具预算、单次调用直出
 * - demo-light-agent：轻 agent 型（场景 B）——小工具面（lore_query 深查），软预算 2 轮封顶
 */
const schema_ts_1 = require("./schema.ts");
/** 直答型示范预设（场景 A 走查载体） */
function demoDirectPreset() {
    const p = (0, schema_ts_1.emptyPreset)('rp-demo-direct', '示范 · 直答型');
    p.description = '单次调用直出，token = ST oneshot。适合日常剧情推进。';
    p.path = 'direct';
    p.toggles = [
        {
            group: 'writingStyle',
            label: '文风',
            options: [
                { id: 'realistic', label: '真实感', content: '文风：写实细腻，五感描写充分，情绪克制而有张力。', selected: true },
                { id: 'lightnovel', label: '轻小说', content: '文风：轻快明亮的轻小说笔调，多用短句与心理独白。' },
                { id: 'cinematic', label: '电影感', content: '文风：镜头化叙事，以画面与动作推进，少直接心理描写。' },
            ],
        },
        {
            group: 'replyLength',
            label: '回复长度',
            options: [
                { id: 'short', label: '短', content: '回复长度：每轮 2-3 段以内，快节奏推进。' },
                { id: 'medium', label: '中', content: '回复长度：每轮 3-5 段，叙事与对白均衡。', selected: true },
                { id: 'long', label: '长', content: '回复长度：每轮 5 段以上，充分铺陈场景与心理。' },
            ],
        },
    ];
    const main = p.slots.find(s => s.id === 'main');
    if (main)
        main.content = '你是剧情的共同叙述者：扮演全部 NPC 与世界，绝不替用户扮演的主角做决定或代言其心理。';
    const jb = p.slots.find(s => s.id === 'jb');
    if (jb)
        jb.content = '记住：不要总结剧情，不要跳出角色，不要复述用户的话。';
    return p;
}
/** 轻 agent 型示范预设（场景 B 走查载体：lore_query 深查） */
function demoLightAgentPreset() {
    const p = demoDirectPreset();
    p.id = 'rp-demo-light-agent';
    p.displayName = '示范 · 轻 agent 型';
    p.description = '直答 + 模型按需调用 lore_query 深查世界书（软预算 2 轮封顶）。适合设定较重的世界观。';
    p.path = 'lightAgent';
    p.budget = {
        maxToolRounds: 2,
        maxCallsPerRun: 4,
        delegationMaxPerRun: 0,
        delegationResultBudgetTokens: 0,
        modelRetry: { maxRetries: 2, intervalMs: 3000 },
    };
    const main = p.slots.find(s => s.id === 'main');
    if (main) {
        main.content =
            '你是剧情的共同叙述者：扮演全部 NPC 与世界，绝不替用户扮演的主角做决定或代言其心理。\n' +
                '设定密集的世界观在上下文缺失时，先用 lore_query 工具查询世界书，再作答——不要凭空编造设定。';
    }
    return p;
}
