/**
 * 输出协议纯逻辑（T1.12 → T2.5a 迁移；T2.10 扩展为有序段落模型）。
 *
 * 标签类别（rp.json outputProtocol，全部可配）：
 * - statusTags → 状态栏卡片；actionTags → 行动选项按钮；wrapTags → 剥壳显示内文
 * - collapsibleTags（默认 details）→ 原生折叠块（ST 高频：实时总结/当前伏笔）
 * - stateUpdateTags（默认 UpdateVariable + MVU 两代标记 VariableInsert/VariableUpdate）
 *   → 状态更新块（内含 Analysis/JSONPatch 分体渲染，MVU §4.4.1）；块内容是裸 JSON
 *   （VariableInsert/VariableUpdate 形态）时渲染为「变量更新 · N 键」折叠块
 * - reasoningTags（默认 Analysis）→ 独立思维链标签 → 折叠行
 * - foreshadowingTags（默认 foreshadowings）→ 伏笔登记册面板
 * - statusbar/status 代码块 → 状态栏卡片（不显示原始代码）
 * 纯函数零依赖（UI 挂载见 RpNativeChat.tsx；单测见 tests/output-protocol.spec.ts）。
 */
export const PROTO_DEFAULT = {
    actionTags: ['a', 'selection'],
    wrapTags: ['content'],
    statusTags: ['status', 'statusbar', 'StatusBlock'],
    // draft：草稿/自检内容折叠块（批次修复：真机实测 <draft> 裸文本外露）
    collapsibleTags: ['details', 'draft'],
    // MVU 两代标记：UpdateVariable（Analysis+JSONPatch）与 VariableInsert/VariableUpdate（裸 JSON）
    stateUpdateTags: ['UpdateVariable', 'VariableInsert', 'VariableUpdate'],
    reasoningTags: ['Analysis'],
    foreshadowingTags: ['foreshadowings'],
};
/** 转义正则元字符（协议标签名是用户数据，不能直接进 RegExp） */
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * 输出协议处理（兼容形态：actions/status 全局收集、其余块从正文剥离）。
 * 分段形态用 applyOutputProtocolSegments（T2.10 有序段落模型）。
 * streaming 态额外剥离尾部悬空开标签（闭合前不闪原始标签）。
 */
export function applyOutputProtocol(text, proto, streaming = false) {
    const segs = applyOutputProtocolSegments(text, proto, streaming);
    return {
        display: segs.filter(s => s.kind === 'text').map(s => s.content).join('').trim(),
        actions: segs.filter(s => s.kind === 'action').map(s => s.text),
        status: segs.filter(s => s.kind === 'status').map(s => s.content),
    };
}
/** UpdateVariable 块内部结构解析：Analysis 子块 + JSONPatch 子块 */
export function parseStateUpdateBlock(inner) {
    const analysisMatch = inner.match(/<Analysis>([\s\S]*?)<\/Analysis>/i);
    const patchMatch = inner.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/i);
    return {
        analysis: analysisMatch ? analysisMatch[1].trim() : null,
        patches: patchMatch ? patchMatch[1].trim() : null,
    };
}
/** JSONPatch 数组解析（RFC 6902：op/path/value 行）——失败返回 null（原文兜底显示） */
export function parseJsonPatches(jsonText) {
    try {
        const arr = JSON.parse(jsonText.trim());
        if (!Array.isArray(arr))
            return null;
        return arr.map(p => {
            const o = p;
            return {
                op: String(o.op ?? ''),
                path: String(o.path ?? ''),
                ...(o.value !== undefined ? { value: typeof o.value === 'object' ? JSON.stringify(o.value) : String(o.value) } : {}),
            };
        });
    }
    catch {
        return null;
    }
}
/**
 * 剧情选项拆分 + font 颜色剥壳（批次修复：真机翻车形态——一个按钮里塞了
 * 4 个选项、<font color="#xxx"> 原样裸露）。
 * - 块内多行各自以【…】/（…）/(…) 开头的 → 每行（组）一个独立按钮；
 *   非标记续行并入上一组；前导非标记行并入首个标记组（不产出杂物按钮）
 * - <font color="#hex">文字</font> → 颜色提到 color（渲染层 inline style），标签不裸露
 */
export function splitActionOptions(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0)
        return [];
    const groups = [];
    for (const line of lines) {
        if (/^[【（(]/.test(line) || groups.length === 0)
            groups.push(line);
        else
            groups[groups.length - 1] += `\n${line}`;
    }
    // 前导非标记行并入首个标记组（多块分组时孤立的标题行不单独成按钮）
    if (groups.length > 1 && !/^[【（(]/.test(groups[0])) {
        groups[1] = `${groups[0]}\n${groups[1]}`;
        groups.shift();
    }
    return groups.map(g => {
        let color;
        const label = g
            .replace(/<font\s+color\s*=\s*"(#[0-9a-fA-F]{3,8})"[^>]*>([\s\S]*?)<\/font>/gi, (_m, c, inner) => { color = c; return inner; })
            .replace(/<\/?font[^>]*>/gi, '');
        return color !== undefined ? { label, color } : { label };
    }).filter(o => o.label !== '');
}
// ---------------------------------------------------------------------------
// 批次修复：通用未知标签兜底 + display HTML 白名单
// ---------------------------------------------------------------------------
/**
 * display 正则产出 / 消息内联允许按 HTML 渲染的标签白名单。
 * SVG 系列照抄 agent-loop-rp card-display-compiler.ts HTML_DISPLAY_TAGS L35-49（MIT），
 * 另补 text/tspan（SVG 文本）。
 * 注意：含 position 等布局属性的产出在 sanitizeDisplayHtml 返回 null，
 * 渲染层（RpNativeChat）把整块转进沙箱 iframe（P0-2 三段编译），不再回退纯文本。
 */
export const HTML_DISPLAY_TAGS = new Set([
    'div', 'span', 'font', 'b', 'i', 'em', 'strong', 'small', 'mark',
    'br', 'p', 'sub', 'sup', 'u', 's', 'del', 'code', 'pre', 'a', 'hr',
    'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // SVG（agent-loop-rp L35-49 + text/tspan）
    'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
    'defs', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'view', 'text', 'tspan',
]);
/** 危险/功能性标签：不折叠、不内联渲染——留在文本里由渲染层三段编译转 iframe。
 * html/head/body/title 同列：完整 HTML 文档段（display 正则的 ``` 围栏文档，如思维链
 * 美化）若被未知标签兜底折叠，文档会被整个吃掉只剩残壳（实测 58KB 文档变 20 字）。 */
const DANGEROUS_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'input', 'button', 'select', 'textarea', 'img', 'video', 'audio', 'canvas',
    'html', 'head', 'body', 'title',
]);
/** sanitizeDisplayHtml 允许按 HTML 渲染的标签（含 SVG 系列） */
const SANITIZE_TAGS = new Set([
    'div', 'span', 'font', 'b', 'i', 'em', 'strong', 'small', 'mark',
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse',
    'text', 'tspan', 'defs', 'use',
]);
/** SVG 标签（属性走 SVG_ATTRS 白名单） */
const SVG_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse',
    'text', 'tspan', 'defs', 'use',
]);
/** sanitizeDisplayHtml 允许的 SVG 呈现属性（小写 → 规范名） */
const SVG_ATTRS = new Map([
    ['viewbox', 'viewBox'], ['d', 'd'], ['cx', 'cx'], ['cy', 'cy'], ['r', 'r'],
    ['x', 'x'], ['y', 'y'], ['x1', 'x1'], ['y1', 'y1'], ['x2', 'x2'], ['y2', 'y2'],
    ['points', 'points'], ['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'stroke-width'],
]);
/** sanitizeDisplayHtml 允许的 style 属性（外观类；布局类如 position 一律整体回退） */
const SANITIZE_STYLE_PROPS = new Set([
    'color', 'background', 'background-color', 'font-weight', 'font-size',
    'font-style', 'text-decoration', 'text-align',
]);
/** 文本里是否存在成对的白名单 HTML 标签（决定是否走 HTML 渲染分支） */
export function containsPairedHtml(text) {
    return /<(div|span|font|b|i|em|strong|small|mark)\b[^<>]*>[\s\S]*?<\/\1>/i.test(text);
}
/**
 * 零依赖白名单 sanitize（约 20 行，不引依赖）：
 * - 白名单外标签（script/style/iframe 等）→ 返回 null（调用方转沙箱 iframe 渲染）
 * - 属性仅保留 class（去引号/尖括号）与 font 的 color（#hex）与 style；
 *   style 逐声明过滤，白名单外属性（position:fixed 等）→ 返回 null；
 *   值含 url(/expression( 的声明丢弃。事件处理器等其它属性全部丢弃。
 * - SVG 标签（svg/g/path/circle 等）：呈现属性走 SVG_ATTRS 白名单
 *   （viewBox/d/cx/cy/r/x/y/x1/y1/x2/y2/points/fill/stroke/stroke-width）。
 */
export function sanitizeDisplayHtml(html) {
    const tagRe = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*\/?>/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
        const tag = m[1].toLowerCase();
        if (!SANITIZE_TAGS.has(tag))
            return null;
        out += html.slice(last, m.index);
        if (m[0][1] === '/') {
            out += `</${tag}>`;
            last = tagRe.lastIndex;
            continue;
        }
        const attrs = m[2] ?? '';
        let keep = '';
        if (SVG_TAGS.has(tag)) {
            for (const am of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
                const canonical = SVG_ATTRS.get(am[1].toLowerCase());
                if (canonical === undefined)
                    continue;
                const value = am[2].replace(/[<>"'&]/g, '');
                if (/url\s*\(|expression\s*\(/i.test(value))
                    continue;
                keep += ` ${canonical}="${value}"`;
            }
            out += `<${tag}${keep}>`;
            last = tagRe.lastIndex;
            continue;
        }
        const cls = attrs.match(/\bclass\s*=\s*"([^"]*)"/i);
        if (cls)
            keep += ` class="${cls[1].replace(/[<>"'&]/g, '')}"`;
        if (tag === 'font') {
            const col = attrs.match(/\bcolor\s*=\s*"(#[0-9a-fA-F]{3,8})"/i);
            if (col)
                keep += ` color="${col[1]}"`;
        }
        const sty = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
        if (sty) {
            const safe = [];
            for (const decl of sty[1].split(';')) {
                const i = decl.indexOf(':');
                if (i < 0)
                    continue;
                const prop = decl.slice(0, i).trim().toLowerCase();
                const val = decl.slice(i + 1).trim();
                if (prop === '' || val === '')
                    continue;
                if (!SANITIZE_STYLE_PROPS.has(prop))
                    return null;
                if (/[<>]|url\s*\(|expression\s*\(/i.test(val))
                    continue;
                safe.push(`${prop}: ${val}`);
            }
            if (safe.length > 0)
                keep += ` style="${safe.join('; ')}"`;
        }
        out += `<${tag}${keep}>`;
        last = tagRe.lastIndex;
    }
    out += html.slice(last);
    return out;
}
/**
 * 有序段落切分（T2.10 核心）：按协议标签逐块提取，正文按位置保留。
 * 处理顺序（每类标签全串扫描，嵌套块内容不再二次切分——由渲染层递归消费）：
 * statusbar-placeholder → stateUpdate → foreshadowing → collapsible → reasoning
 * → status → action → wrap（剥壳）→ 未知标签兜底（批次修复）
 */
export function applyOutputProtocolSegments(text, proto, streaming = false) {
    let work = text;
    const segments = [];
    /** 带占位标记的提取：块替换为 \x00N\x00，扫描完成后按占位符回填段落 */
    const placeholders = [];
    const stash = (seg) => {
        placeholders.push(seg);
        return `\x00${placeholders.length - 1}\x00`;
    };
    // 防御：旧调用方/旧配置可能缺新字段（Partial 协议对象直接传入）
    const tags = (xs) => xs ?? [];
    // MVU 状态栏占位符（<StatusPlaceHolderImpl/> 或成对形态）→ 专用段落，
    // 渲染层替换为 MVU 状态栏组件（fetch /dsht-mvu/statusbar），路由不可达时整块隐藏（不裸文本）
    work = work.replace(/<StatusPlaceHolderImpl\s*(?:\/>|>[\s\S]*?<\/StatusPlaceHolderImpl>)/g, () => stash({ kind: 'statusbar-placeholder' }));
    // 状态更新块（整块提取——MVU 协议，位于消息尾部）
    for (const tag of tags(proto.stateUpdateTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => stash({ kind: 'state-update', raw: String(inner).trim(), ...parseStateUpdateBlock(String(inner)) }));
    }
    // 伏笔登记册（面板）
    for (const tag of tags(proto.foreshadowingTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => stash({ kind: 'foreshadowing', content: String(inner).trim() }));
    }
    // 折叠块（details：解析 <summary> 标题；无 summary 时按标签给默认标题——draft →「草稿」）
    const COLLAPSIBLE_DEFAULT_TITLES = { details: '详情', draft: '草稿' };
    for (const tag of tags(proto.collapsibleTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => {
            const m = String(inner).match(/<summary>([\s\S]*?)<\/summary>/i);
            const title = m ? m[1].trim() : (COLLAPSIBLE_DEFAULT_TITLES[tag] ?? '详情');
            const content = m ? String(inner).replace(m[0], '') : String(inner);
            return stash({ kind: 'collapsible', title, content: content.trim() });
        });
    }
    // 独立思维链标签
    for (const tag of tags(proto.reasoningTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => stash({ kind: 'reasoning', content: String(inner).trim() }));
    }
    // 状态栏卡片
    for (const tag of tags(proto.statusTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => {
            const t = String(inner).trim();
            return t ? stash({ kind: 'status', content: t }) : '';
        });
    }
    // 行动选项（渲染于尾部：占位符移到文本末——ST 形态）。
    // 批次修复：块内多行【…】/（…）开头拆成独立按钮；<font color="#hex"> 剥壳为按钮文字颜色
    for (const tag of tags(proto.actionTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), (_m, inner) => {
            const opts = splitActionOptions(String(inner).trim());
            return opts.map(o => stash(o.color !== undefined
                ? { kind: 'action', text: o.label, color: o.color }
                : { kind: 'action', text: o.label })).join('');
        });
    }
    // 剥壳（wrap：内容保留原位）
    for (const tag of tags(proto.wrapTags)) {
        work = work.replace(new RegExp(`<${escapeRe(tag)}>([\\s\\S]*?)</${escapeRe(tag)}>`, 'g'), '$1');
    }
    // ---- 批次修复：通用未知标签兜底 ----
    // ST 生态的卡自定义标签极多（tip/tip/note/think…），不可能穷举。任何不在
    // 已知清单（协议各类标签 + DSH 原生 summary + HTML 白名单）的成对标签块渲染为
    // 「带标签名的折叠块」（collapsible 段落，summary 显示 <tag名>），不再裸露转义文本；
    // 未知自闭合标签（<xxx/>）视为占位符直接隐藏。危险标签（script/iframe 等）不动，
    // 留在文本里由渲染层按纯文本 + warn 兜底。
    const knownTags = new Set([
        ...tags(proto.stateUpdateTags), ...tags(proto.foreshadowingTags), ...tags(proto.collapsibleTags),
        ...tags(proto.reasoningTags), ...tags(proto.statusTags), ...tags(proto.actionTags), ...tags(proto.wrapTags),
        'summary', 'StatusPlaceHolderImpl',
    ]);
    const isUnknownTag = (tag) => {
        if (knownTags.has(tag))
            return false;
        const lower = tag.toLowerCase();
        return !knownTags.has(lower) && !HTML_DISPLAY_TAGS.has(lower) && !DANGEROUS_TAGS.has(lower);
    };
    /** 段落 → 纯文本（未知块内容里的占位符还原用） */
    const segAsText = (seg) => {
        if (seg === undefined)
            return '';
        switch (seg.kind) {
            case 'text': return seg.content;
            case 'action': return seg.text;
            case 'status': return seg.content;
            case 'collapsible': return seg.content;
            case 'state-update': return seg.raw;
            case 'reasoning': return seg.content;
            case 'foreshadowing': return seg.content;
            case 'statusbar-placeholder': return '';
        }
    };
    const restorePh = (s) => s.replace(/\x00(\d+)\x00/g, (_m, i) => segAsText(placeholders[Number(i)]));
    // 多趟扫描：内层未知块先折叠成占位符，外层再折时把占位符还原为纯文本
    for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        work = work.replace(/<([A-Za-z][\w-]*)(?:\s[^<>]*)?>([\s\S]*?)<\/\1>/g, (m, tag, inner) => {
            if (!isUnknownTag(tag))
                return m;
            changed = true;
            return stash({ kind: 'collapsible', title: `<${tag}>`, content: restorePh(String(inner)).trim() });
        });
        if (!changed)
            break;
    }
    work = work.replace(/<([A-Za-z][\w-]*)(?:\s[^<>]*)?\/>/g, (m, tag) => (isUnknownTag(tag) ? '' : m));
    // 孤儿闭标签（</xxx>：配对被 display 正则/剥壳/折叠消费后残留）——渲染层不裸显
    // 原始标签文本。覆盖未知标签 + 全部协议已知标签（实测：wrap 剥壳非贪婪匹配提前
    // 闭合后，真正的 </content> 漏在正文）。HTML 显示白名单标签保留（浏览器自己处理）。
    work = work.replace(/<\/([A-Za-z][\w-]*)>/g, (m, tag) => isUnknownTag(tag) || knownTags.has(tag) || knownTags.has(tag.toLowerCase()) ? '' : m);
    if (streaming) {
        // 尾部悬空开标签（流式未闭合）：循环剥离——嵌套未闭合（<A>…<B>半截）从最内层
        // 逐层剥掉，闭合后走上面的完整提取
        const all = [...tags(proto.stateUpdateTags), ...tags(proto.foreshadowingTags), ...tags(proto.collapsibleTags),
            ...tags(proto.reasoningTags), ...tags(proto.statusTags), ...tags(proto.actionTags), ...tags(proto.wrapTags),
            'StatusPlaceHolderImpl'];
        for (let i = 0; i < 12; i++) { // 嵌套深度上限防御
            let changed = false;
            for (const tag of all) {
                const next = work.replace(new RegExp(`<${escapeRe(tag)}>([^<]*)$`), '$1');
                if (next !== work) {
                    work = next;
                    changed = true;
                }
            }
            const nextSummary = work.replace(/<summary>([^<]*)$/, '$1');
            if (nextSummary !== work) {
                work = nextSummary;
                changed = true;
            }
            // 未知标签的悬空开标签同样剥离（闭合前不闪原始标签）
            const nextUnknown = work.replace(/<([A-Za-z][\w-]*)(?:\s[^<>]*)?>([^<>]*)$/, (m, tag, inner) => (isUnknownTag(tag) ? String(inner) : m));
            if (nextUnknown !== work) {
                work = nextUnknown;
                changed = true;
            }
            if (!changed)
                break;
        }
    }
    // 占位符回填：正文段落与提取块按原位置交织；action 段落统一移到末尾
    const actions = [];
    const parts = [];
    const re = /\x00(\d+)\x00/g;
    let last = 0;
    let m;
    while ((m = re.exec(work)) !== null) {
        if (m.index > last)
            parts.push({ kind: 'text', content: work.slice(last, m.index) });
        const seg = placeholders[Number(m[1])];
        if (seg === undefined) {
            last = re.lastIndex;
            continue;
        }
        if (seg.kind === 'action')
            actions.push(seg);
        else
            parts.push(seg);
        last = re.lastIndex;
    }
    if (last < work.length)
        parts.push({ kind: 'text', content: work.slice(last) });
    // 相邻文本段合并
    const merged = [];
    for (const p of parts) {
        const prev = merged[merged.length - 1];
        if (p.kind === 'text' && prev?.kind === 'text')
            prev.content += p.content;
        else
            merged.push({ ...p });
    }
    // 去掉首尾空白文本段
    while (merged.length > 0 && merged[0].kind === 'text' && !merged[0].content.trim())
        merged.shift();
    while (merged.length > 0 && merged[merged.length - 1].kind === 'text' && !merged[merged.length - 1].content.trim())
        merged.pop();
    return [...merged, ...actions];
}
/**
 * statusbar / status 代码块切分（渲染为组件，不显示原始代码）。
 * 其余文本段交给 MarkdownText；普通代码块留在文本段内正常渲染。
 */
export function splitStatusbarBlocks(text) {
    const parts = [];
    const re = /```([\w-]*)[ \t]*\n?([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        const lang = (m[1] || '').toLowerCase();
        if (lang !== 'statusbar' && lang !== 'status')
            continue;
        if (m.index > last)
            parts.push({ type: 'text', content: text.slice(last, m.index) });
        parts.push({ type: 'statusbar', content: m[2] });
        last = re.lastIndex;
    }
    if (last < text.length)
        parts.push({ type: 'text', content: text.slice(last) });
    return parts;
}
/**
 * status-bar 内容三档解析：JSON 对象 → 键值行；冒号/全角冒号分隔行 → 键值行；原文。
 */
export function parseStatusBarRows(content) {
    const t = String(content).trim();
    try {
        const o = JSON.parse(t);
        if (o && typeof o === 'object' && !Array.isArray(o)) {
            return Object.entries(o).slice(0, 12).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
        }
    }
    catch { /* 非 JSON，走行解析 */ }
    const rows = t.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12).map(l => {
        const i = l.search(/[:：]/);
        return i > 0 ? [l.slice(0, i), l.slice(i + 1).trim()] : null;
    }).filter((r) => r !== null);
    return rows;
}
/** cwd（会话工作区根，如 …/.dsh/rp/<slug>，Windows 反斜杠兼容）→ 工作区 slug */
export function slugFromCwd(cwd) {
    if (!cwd)
        return null;
    const normalized = cwd.replace(/\\/g, '/');
    const i = normalized.lastIndexOf('/rp/');
    if (i < 0)
        return null;
    const slug = normalized.slice(i + 4);
    return slug && !slug.includes('/') ? slug : null;
}
/** 旧 rp.json 协议配置缺字段时默认值补齐（T2.10 新字段对旧工作区向后兼容） */
export function withDefaults(p) {
    return {
        actionTags: p?.actionTags?.length ? p.actionTags : PROTO_DEFAULT.actionTags,
        wrapTags: p?.wrapTags?.length ? p.wrapTags : PROTO_DEFAULT.wrapTags,
        statusTags: p?.statusTags?.length ? p.statusTags : PROTO_DEFAULT.statusTags,
        // collapsibleTags 同样取并集：存量显式配置的工作区也要识别 draft 折叠（批次修复 2）
        collapsibleTags: [...new Set([...(p?.collapsibleTags ?? []), ...PROTO_DEFAULT.collapsibleTags])],
        // stateUpdateTags 取并集而非整体替换：存量 rp.json 显式写了 ['UpdateVariable'] 的工作区
        // 也要识别 MVU 两代标记 VariableInsert/VariableUpdate（否则块内容裸文本外露）
        stateUpdateTags: [...new Set([...(p?.stateUpdateTags ?? []), ...PROTO_DEFAULT.stateUpdateTags])],
        reasoningTags: p?.reasoningTags?.length ? p.reasoningTags : PROTO_DEFAULT.reasoningTags,
        foreshadowingTags: p?.foreshadowingTags?.length ? p.foreshadowingTags : PROTO_DEFAULT.foreshadowingTags,
    };
}
/**
 * MVU 裸 JSON 变量块（VariableInsert/VariableUpdate）前端解析：
 * 顶层键计数 + 美化打印（渲染「变量更新 · N 键」折叠块用）。
 * 注意：这只是显示层解析——引擎侧 parseUpdateVariable（state/mvu.ts）是否消费
 * 这两个标记由引擎任务负责，本函数不影响状态写入链路。
 * @returns 解析失败（非 JSON / 非对象）返回 null，调用方回退原文展示
 */
export function parseVariableJson(raw) {
    try {
        const o = JSON.parse(raw.trim());
        if (o === null || typeof o !== 'object' || Array.isArray(o))
            return null;
        return { keys: Object.keys(o).length, pretty: JSON.stringify(o, null, 2) };
    }
    catch {
        return null;
    }
}
