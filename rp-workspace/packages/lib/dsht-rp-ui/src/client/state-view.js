/**
 * PROJECT_PLAN 补全：状态查看双视图面板（RpStateView）的纯逻辑。
 *
 * 从 RpStateFloat 的 StateTree 递归渲染经验抽出——表格视图需要「按路径折叠」
 * 的行扁平化（React 拿到行数组直接 map，折叠状态 = 路径集合，组件可测可控）；
 * JSON 视图只需只读格式化文本。抽成无依赖纯函数便于 vitest 单测。
 */
/** 容器 → 键值对（数组按下标，对象按 entries） */
function entriesOf(v) {
    return Array.isArray(v)
        ? v.map((item, i) => [String(i), item])
        : Object.entries(v);
}
/** 子路径拼接（根 '' 直接用键名，之后点号连接） */
function childPath(path, key) {
    return path === '' ? key : `${path}.${key}`;
}
/** 叶子值展示：undefined → ''，字符串原样，其余 JSON 化（防 [object Object]） */
export function formatLeaf(v) {
    if (v === undefined)
        return '';
    if (typeof v === 'string')
        return v;
    if (v === null)
        return 'null';
    try {
        return JSON.stringify(v) ?? String(v);
    }
    catch {
        return String(v);
    }
}
/**
 * 状态树 → 行数组（递归键值树；collapsed 集合中的容器只出一行、子树不铺开）。
 * 根为容器时根本身不出行（直接从子级铺起）；根为标量出单行（防御 /state 返回
 * 非对象的兜底）。MVU 状态来自服务器 JSON.parse 理论无环，不做防环开销。
 */
export function flattenStateTree(value, collapsed = new Set()) {
    const rows = [];
    if (value === null || typeof value !== 'object') {
        rows.push({ path: '', key: '', depth: 0, leaf: true, valueText: formatLeaf(value) });
        return rows;
    }
    const walk = (v, path, key, depth) => {
        if (v === null || typeof v !== 'object') {
            rows.push({ path, key, depth, leaf: true, valueText: formatLeaf(v) });
            return;
        }
        const entries = entriesOf(v);
        const isCollapsed = collapsed.has(path);
        rows.push({ path, key, depth, leaf: false, valueText: '', count: entries.length, open: !isCollapsed });
        if (isCollapsed)
            return;
        for (const [k, item] of entries)
            walk(item, childPath(path, k), k, depth + 1);
    };
    for (const [k, item] of entriesOf(value))
        walk(item, k, k, 0);
    return rows;
}
/** 折叠集合翻转（纯：返回新 Set，React state 不可变更新） */
export function toggleCollapsed(collapsed, path) {
    const next = new Set(collapsed);
    if (next.has(path))
        next.delete(path);
    else
        next.add(path);
    return next;
}
/** JSON 视图文本（只读格式化；undefined 序列化为空串） */
export function formatStateJson(state) {
    try {
        return JSON.stringify(state, null, 2) ?? '';
    }
    catch {
        return String(state);
    }
}
