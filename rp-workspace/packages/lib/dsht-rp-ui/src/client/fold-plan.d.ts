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
export interface FoldRow {
    /** data-chat-flow-key（节点稳定 key） */
    key: string;
    /** data-chat-flow-kind */
    kind: string;
}
export interface FoldGroup {
    /** 折叠组身份 = 收尾 turn-tail 行 key（一轮一组，稳定） */
    id: string;
    /** 被折叠的过程行 keys（保序） */
    foldedKeys: string[];
    /** 折叠标题行插入锚点 = 首个被折叠行 key */
    anchorKey: string;
    /** 折掉的 assistant-step 数（含中间步骤，不含最终正文） */
    steps: number;
    /** 折掉的 tool-call 数 */
    toolCalls: number;
}
/** 至少折掉这么多行才值得出一行标题（单行工具行折了没收益） */
export declare const FOLD_MIN_ROWS = 2;
/**
 * 从整列行序列规划折叠分组。规则：
 * - 以 user 行切轮；只有带 turn-tail 收尾的轮（=已完成）才折叠——进行中的轮不动；
 * - 每轮保留：user 行、最后一个 assistant-step 行（最终正文）、turn-tail 行（用时/操作）；
 * - 折掉二者之间的过程行（中间 assistant-step / tool-call / model-retry）；
 * - context/steering/compaction/command/turn-error/unknown 等行保持可见（不折）。
 */
export declare function planFolds(rows: readonly FoldRow[]): FoldGroup[];
