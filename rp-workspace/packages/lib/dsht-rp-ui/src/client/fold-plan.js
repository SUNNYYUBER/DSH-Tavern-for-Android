/**
 * 任务 A 纯逻辑：主会话「过程折叠」的分组规划（可单测，零 DOM）。
 *
 * 背景（调研结论）：DSH 主会话 ChatView 只有单条工具调用的默认折叠（ToolRow
 * 收起为一行），没有「整轮 harness 过程折成一行」的现成能力或配置项
 * （docs/config-catalog.md 无 collapse/fold 键；trajectory 视图的 turn 折叠会把
 * 最终正文一起折掉，不符合「只保留最终正文」）。因此在 DOM 层做增强，本文件
 * 只负责从行序列算出折叠分组，DOM 操作在 ProcessFolder.ts。
 *
 * 行序列来自 ChatView 的行容器语义属性 [data-chat-flow-kind]（稳定属性，非哈希
 * 类名）：user / steering / context / assistant-step / tool-call / model-retry /
 * turn-error / turn-max-tokens / compaction / manual-compaction / command /
 * turn-tail / unknown。一轮完整对话的收尾标记是 turn-tail 行（含「用时 xx」）。
 */
/** 参与折叠的过程行种类（思考/中间步骤/工具调用/重试链） */
const FOLD_KINDS = new Set(['assistant-step', 'tool-call', 'model-retry']);
/** 至少折掉这么多行才值得出一行标题（单行工具行折了没收益） */
export const FOLD_MIN_ROWS = 2;
/**
 * 从整列行序列规划折叠分组。规则：
 * - 以 user 行切轮；只有带 turn-tail 收尾的轮（=已完成）才折叠——进行中的轮不动；
 * - 每轮保留：user 行、最后一个 assistant-step 行（最终正文）、turn-tail 行（用时/操作）；
 * - 折掉二者之间的过程行（中间 assistant-step / tool-call / model-retry）；
 * - context/steering/compaction/command/turn-error/unknown 等行保持可见（不折）。
 */
export function planFolds(rows) {
    const groups = [];
    let turnStart = -1; // 当前轮 user 行下标；-1 = 不在轮内
    for (let i = 0; i <= rows.length; i++) {
        const row = rows[i];
        const isBoundary = i === rows.length || row.kind === 'user';
        if (isBoundary) {
            if (turnStart >= 0)
                closeTurn(turnStart, i);
            turnStart = row?.kind === 'user' ? i : -1;
        }
    }
    function closeTurn(start, end) {
        const slice = rows.slice(start, end); // [user, ..., 收尾?]
        if (slice.length === 0 || slice[slice.length - 1]?.kind !== 'turn-tail')
            return; // 未完成轮
        const tail = slice[slice.length - 1];
        // 最终正文 = 轮内最后一个 assistant-step（不含 turn-tail 自身）
        let lastAssistant = -1;
        for (let j = slice.length - 2; j >= 1; j--) {
            if (slice[j]?.kind === 'assistant-step') {
                lastAssistant = j;
                break;
            }
        }
        if (lastAssistant === -1)
            return; // 无正文（失败轮等）不折，保留全部可见
        const folded = slice.slice(1, lastAssistant).filter(r => FOLD_KINDS.has(r.kind));
        if (folded.length < FOLD_MIN_ROWS)
            return;
        groups.push({
            id: tail.key,
            foldedKeys: folded.map(r => r.key),
            anchorKey: folded[0]?.key ?? tail.key,
            steps: folded.filter(r => r.kind === 'assistant-step').length,
            toolCalls: folded.filter(r => r.kind === 'tool-call').length,
        });
    }
    return groups;
}
