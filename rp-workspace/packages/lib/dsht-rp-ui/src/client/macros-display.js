/**
 * I4 显示期宏展开（display-time macro expansion，纯函数、零依赖）。
 *
 * 语义来源（SillyTavern 宏 + MVU 变量宏的意图级移植）：
 * - 核心宏 {{user}}/{{char}}/{{persona}}：身份面（数据源 GET /dsht-rp/identity）；
 * - 时间宏 {{time}}/{{date}}/{{weekday}}/{{datetime}}：渲染当下时刻（浏览器时区）；
 * - {{random:a,b,c}}：每次渲染重掷（ST 同语义，窗口化回渲会变——按任务定案）；
 * - {{pick:a,b,c}}：稳定取一——以「宏原文 + 全文」做 FNV-1a 哈希选种子，同一楼层
 *   重渲染（窗口化/流式重排）结果不变，不同楼层各自独立；
 * - {{roll:X}} 掷 1..X；{{roll:X,N}} 掷 N 次逐个列出；
 * - 类宏 {{getvar::p}}/{{get_message_variable::p}}/{{get_chat_variable::p}}：从传入
 *   variables 树取值（/dsht-mvu/variables 单树；message/chat 双宏同源），路径点号
 *   与 JSONPointer（/a/b）双兼容；取不到返回空串（ST getvar 缺失同语义）；
 * - {{setvar::p::v}}：显示期不落盘，只透传空串（写变量归聊天/MVU 管线）。
 * - 未知宏原样保留（不吞不报）。
 *
 * 纯同步纯函数：异步数据（identity/variables）由 display-compiler.ts 的模块级缓存
 * （每 slug/session 5s TTL）加载后经 ctx 传入；ctx 为 null 时原文透传。
 */
const MACRO_RE = /\{\{([^{}]+)\}\}/gu;
/** FNV-1a 32 位（{{pick}} 的稳定种子：同一楼层文本恒定） */
function fnv1a(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
/** 变量树取值：JSONPointer（/a/b，含 ~0/~1 转义）与点号路径双兼容 */
function readVarPath(tree, path) {
    if (path === '')
        return undefined;
    const segments = path.startsWith('/')
        ? path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
        : path.split('.');
    let current = tree;
    for (const segment of segments) {
        if (current === null || typeof current !== 'object')
            return undefined;
        current = current[segment];
    }
    return current;
}
/** 宏值 → 显示串（对象/数组 JSON 化，其余 String 化；undefined/null → 空串） */
function displayValue(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value === 'object')
        return JSON.stringify(value);
    return String(value);
}
/** 逗号切分选项列表（random/pick/roll 共用；不去空——ST 允许空选项） */
function splitOptions(rest) {
    return rest.split(',').map(s => s.trim());
}
/** 时间宏统一入口（同一渲染内 time/date/datetime 取同一 now，避免跨秒漂移） */
function timeParts(now) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        date: now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    };
}
/**
 * 展开 display 期宏。ctx 为 null（identity/variables 拉取失败或未就绪）时原文透传；
 * 类宏在 ctx.variables 缺失时按空树处理（getvar 取不到 → 空串）。
 */
export function expandDisplayMacros(text, ctx) {
    if (!text.includes('{{'))
        return text; // 快路径：绝大多数正文无宏
    if (ctx === null)
        return text;
    const now = new Date();
    const { time, date, weekday } = timeParts(now);
    const variables = ctx.variables ?? {};
    return text.replace(MACRO_RE, (raw, key) => {
        const macro = key.trim();
        // ---- 核心身份宏（大小写不敏感，ST 常见 {{User}}/{{CHAR}} 写法）----
        const lower = macro.toLowerCase();
        if (lower === 'user')
            return ctx.user;
        if (lower === 'char')
            return ctx.char;
        if (lower === 'persona')
            return ctx.persona ?? '';
        // ---- 时间宏 ----
        if (lower === 'time')
            return time;
        if (lower === 'date')
            return date;
        if (lower === 'weekday')
            return weekday;
        if (lower === 'datetime')
            return `${date} ${time}`;
        // ---- random / pick / roll（带参宏，大小写不敏感）----
        const colon = macro.indexOf(':');
        if (colon > 0) {
            const name = macro.slice(0, colon).trim().toLowerCase();
            const rest = macro.slice(colon + 1);
            if (name === 'random') {
                const options = splitOptions(rest);
                return options.length > 0 ? options[Math.floor(Math.random() * options.length)] ?? '' : raw;
            }
            if (name === 'pick') {
                const options = splitOptions(rest);
                if (options.length === 0)
                    return raw;
                return options[fnv1a(`${rest}|${text}`) % options.length] ?? raw;
            }
            if (name === 'roll') {
                const params = splitOptions(rest);
                const max = Number(params[0]);
                if (!Number.isInteger(max) || max < 1)
                    return raw;
                const rollOnce = () => 1 + Math.floor(Math.random() * max);
                const times = params.length > 1 ? Number(params[1]) : 1;
                const count = Number.isInteger(times) && times >= 1 ? Math.min(times, 20) : 1;
                return Array.from({ length: count }, rollOnce).join(', ');
            }
            // ---- 类宏（MVU 变量面；双前缀同源——数据面单树）----
            if (name === 'getvar' || name === 'get_message_variable' || name === 'get_chat_variable') {
                const parts = macro.split('::');
                const path = (parts[1] ?? '').trim();
                return displayValue(readVarPath(variables, path));
            }
            if (name === 'setvar') {
                // 显示期不落盘：只透传空串（值不写 variables——写变量走聊天/MVU 管线）
                return '';
            }
        }
        // 未知宏原样保留
        return raw;
    });
}
