/**
 * session-repair.ts — 把存量 v0 会话重写为「可通过官方 v0→v3 迁移」的合法形态
 * ============================================================================
 * 背景（2026-09-10 阶段 3 实证）：设备备份的 80 个真实会话里，**41 个（51%）**
 * 在 DSH 0.1.5 下打不开——官方迁移器直接拒绝。8 类根因（按出现数）：

 *   ① 21 个：`assistant/message N chunk provenance is not one complete ordered attempt`
 *      导入管线/变体切换把「兄弟变体」写成 assistant/message 的 replace 链 +
 *      sourceEventSeqs 血缘。0.1.2 合法，0.1.5 双重禁止（见 session-write.ts）。
 *   ②  9 个：`user/message N data lacks required member "id"`（快照注入缺 id）
 *   ③  6 个：`user/message N source has unexpected member "regeneratedFrom"/"rolledBackTo"`
 *   ④  2 个：`turn/end has unexpected field source` / `assistant/message ... source has
 *      unexpected member "plugin"`（信封/source 上的自定义键）
 *   ⑤  1 个：`compaction/prune N shadowedRange must match shadowedSeqs endpoints`
 *   ⑥  1 个：`turn/start N does not open expected turn`（seq 修复留下的 turn 回绕）
 *   ⑦  1 个：`format v0 header cwd must be absolute`
 *   ⑧  （附带）`source` 上的 `thData`/`thSystem`/`oneshot`/`windowRange` 等自定义键

 * 本模块是**纯函数**重写器：读入 v0 会话文本 → 输出合法 v0 会话文本（seq 重编号 +
 * 引用重映射）。不碰磁盘；写盘/备份/验证由调用方负责。
 *
 * 与 session-write.ts 的分工：那个模块管「新写入怎么写合法」；本模块管
 * 「已经写坏的历史文件怎么救回来」。
 *
 * @module dsht-plugin-shared/session-repair
 */
export interface SessionRepairResult {
    /** 重写后的会话文本（含尾换行）；未改动时与入参等值 */
    content: string;
    /** 是否有任何改动 */
    changed: boolean;
    /** 人类可读的修复清单（每项一类，便于日志与回执） */
    notes: string[];
    /** 事件总数（展开聚合行后） */
    events: number;
    /** 无法修复的硬错误（非空时 content 为原样） */
    error?: string;
    /**
     * 从 `source` 上摘下的非法自定义键（0.1.5 白名单不允许），按楼层归集。
     * 键 = message id（无 id 时 `seq:<最终 seq>`）；值 = 原始键值对。
     *
     * **调用方必须把它落进 sidecar**（`th-floors.ts` 的 `mergeSalvagedThFloors`）——
     * 本模块是纯函数不碰磁盘；不落盘就等于静默丢数据（阶段 3 曾踩）。
     * model source 没有 sections 位，sidecar 是唯一的合法归宿。
     */
    salvaged: Array<{
        key: string;
        payload: Record<string, unknown>;
    }>;
}
/**
 * 把一个 v0 会话重写为合法形态。
 *
 * 变换顺序（关键 —— 先修语义再重编号，否则引用会错位）：
 *  1. header：cwd 必须绝对路径
 *  2. 逐事件：
 *     · 信封剥非法键
 *     · user/message：补 id；source 非法键搬进 sections；去 replace 的 assistant 化
 *     · assistant/message：source 非法键剔除；replace+ses 拆成「标记 replace + 本消息 append」
 *     · compaction/prune：shadowedSeqs 对齐 shadowedRange 端点、去重、保持 surface 序
 *  3. seq 重编号 + 所有引用（surfaceOp / sourceEventSeqs / shadowedSeqs / shadowedRange）重映射
 *  4. turn 编号续接修复（重复 turn/start 重编号）
 */
export declare function repairSessionForV3(content: string): SessionRepairResult;
