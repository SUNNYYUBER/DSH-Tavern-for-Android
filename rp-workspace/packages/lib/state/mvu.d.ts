/**
 * T2.3 MVU 状态链路（M2 剩余核心缺口：状态写入/存储/重放此前未做）。
 *
 * 三部分纯函数（可单测）：
 * - parseUpdateVariable：从 assistant 消息提取 `<UpdateVariable>` 块内的更新指令。
 *   【实机审计修复 2026-09-05】真实 MVU 卡（ExampleGame ExampleWorld 运行日志取证）每楼更新是
 *   `<UpdateVariable>` 块，三种来源共存解析，统一返回 StatePatch[]：
 *     1) `<JSONPatch>` 数组（示例预设 V8.8 实证；op 补 move/copy/insert，兼容裸块与 op=delta）
 *     2) `<initvar>` YAML 树（初始化变量；parseYamlLite 轻量解析 → 叶子路径 set 型补丁，
 *        传入 state 时顶层键缺失 → add，否则 replace）
 *     3) `_.set(path,val)` / `_.add(path,num)` / `_.inc` / `_.dec` 指令行（点号路径 → JSONPointer，
 *        容忍全角括号/引号/空格；add/inc/dec → delta 增量）
 * - applyStatePatches：JSONPointer 路径（`/云梦璃/好感度`）逐层建对象/数组应用补丁
 *   （move=摘下再挂、copy=深拷贝复制、insert=数组按 index 插入）
 * - renderStateSummary：状态树扁平化为模型友好摘要（`云梦璃.好感度: 3`），供组装层 stateSummary 槽位注入
 */
/** JSONPatch 操作（ST 酒馆助手/MVU 常用子集 + delta 增量 + move/copy/insert） */
export type StatePatchOp = 'add' | 'replace' | 'remove' | 'delta' | 'move' | 'copy' | 'insert';
export interface StatePatch {
    op: StatePatchOp;
    /** JSONPointer 路径：/云梦璃/好感度（空段跳转） */
    path: string;
    /** move/copy 的来源路径（JSONPointer） */
    from?: string;
    value?: unknown;
}
/** 从文本提取 JSONPatch 数组（宽松解析：坏 JSON 返回 [] 不崩）。
 *  【鲁棒轮 2026-09-09】matchAll 合并全部块——原实现 match 单次匹配，单块内/块外多个
 *  <JSONPatch> 只解析第一个，其余静默丢失（MVU 变量更新不生效且无日志）。 */
export declare function parseJsonPatches(text: string): StatePatch[];
/**
 * 【实机审计修复 2026-09-05】从 assistant 消息全文提取全部 UpdateVariable 补丁
 * （多个块合并；块内三种来源共存解析：initvar YAML 树 / _.set 系指令行 / JSONPatch 子块；
 * 块外裸 JSONPatch 兜底；可选传入当前 state 供 initvar 判定顶层键 add/replace）。
 */
export declare function parseUpdateVariable(text: string, state?: Record<string, unknown>): StatePatch[];
/**
 * 【实机审计修复 2026-09-05】_.set/_.add/_.inc/_.dec 指令行解析（真实 MVU 卡运行日志实证：
 * 指令直接写在 <UpdateVariable> 内；点号路径；容忍全角括号/引号/空格/行尾分号）。
 * set → replace；add/inc/dec → delta 增量（inc 默认 +1、dec 默认 -1，第二参数可覆盖步长）。
 */
export declare function parseUnderscoreCommands(text: string): StatePatch[];
/**
 * 【实机审计修复 2026-09-05】轻量 YAML 树解析（initvar 用）：`key: value` 缩进嵌套
 * （容忍全角冒号）；值能 JSON.parse 就解析；数组支持一层 `- item` 行；# 注释行/--- 跳过。
 * 空文本返回 null；空值键无子行 → 空对象占位。
 */
export declare function parseYamlLite(src: string): Record<string, unknown> | null;
/**
 * 应用补丁（逐层建对象/数组索引）。
 * - delta：数值增量（浮点安全：先转数字，不可数则按 replace 处理）
 * - remove：删除 key（数组 + 数字尾段 = 按下标删除）
 * - add/replace：赋值
 * - 【实机审计修复 2026-09-05】move：摘下 from 子树挂到 path（JSON Patch 语义）；
 *   copy：from 子树深拷贝到 path；insert：数组按 path 尾段 index 插入（越界 = 追加表尾）；
 *   路径中间段为数字且目标缺失时建数组（否则建对象）。
 */
export declare function applyStatePatches(state: Record<string, unknown>, patches: StatePatch[]): Record<string, unknown>;
/** 状态树扁平化（递归；叶值字符串化）——模型友好摘要 */
export declare function flattenState(state: Record<string, unknown>, prefix?: string): Array<[string, string]>;
/** 渲染状态摘要（供 stateSummary 槽位 / getvar 宏上下文） */
export declare function renderStateSummary(state: Record<string, unknown>): string;
