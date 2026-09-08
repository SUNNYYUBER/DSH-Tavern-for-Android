/**
 * display 三段编译 + 两趟 display 正则 + iframe 文档骨架（P0-2 / P0-3，REF_PROJECTS_COMPARISON.md 领域二）。
 *
 * 出处（均为 MIT 许可参考源码，引用处已对照移植）：
 * - 三段编译：dsh-agent-rp `src/card-display-compiler.ts`（compileCharacterDisplay L264、
 *   sourceLines/isFrontendDocument/splitLeadingHtmlBlock/htmlTagsOutsideCode）；
 *   HTML_DISPLAY_TAGS 含 agent-loop-rp 同文件 L35-49 的 SVG 扩展。
 * - 两趟执行：dsh-agent-rp `src/frontend-regex.ts` runScripts L285（先通用
 *   !markdownOnly&&!promptOnly，再 display→markdownOnly 专属）。
 * - 私用区 token 隔离 + 防空白守卫：dsh-tavern `lib/domain/tavern-regex-display.js`
 *   renderTavernRegexDisplay L96-160（presentationParts[] + DSH_TAVERN_REGEX_i token
 *   + 整轮覆盖回退原文 L136-147）。
 * - iframe 文档骨架：dsh-tavern `lib/client.js` buildTavernFrameDocument/clampTavernFrameHeight/
 *   TavernMessageFrame L883-941（高度上报 postMessage + clamp [48,12000]）。
 *
 * 与参考的有意偏差：markdown 段不做未知标签剥离——未知/自定义标签（tip 等）的折叠
 * 兜底归 output-protocol 层单点负责，避免两处语义分叉。
 *
 * 用户痛点根因：悬浮球/剧情按钮/tip 的 display 产出是完整 HTML 片段或文档，
 * 旧链路的 sanitize 白名单直接整体丢弃。三段编译把「完整文档」切进 iframe 舞台
 * （sandbox="allow-scripts"，position:fixed 部件在 iframe 内正常运行）。
 */
import { expandDisplayMacros } from './macros-display.ts';
/** 可按 HTML 渲染的标签全集（dsh-agent-rp 清单 + agent-loop-rp L35-49 SVG 扩展） */
const HTML_DISPLAY_TAGS = new Set([
    'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
    'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
    'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em',
    'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input',
    'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta',
    'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture',
    'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search', 'section',
    'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title',
    'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
    'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
    'defs', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'view', 'text', 'tspan',
]);
/** 可与后随 Markdown 散文切分的行首平衡块级标签（参考源码 HTML_BLOCK_TAGS） */
const HTML_BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'center', 'details', 'dialog', 'div',
    'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'head', 'header', 'hgroup', 'html', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search',
    'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
/** 代码围栏/行内代码之外的 HTML 标签扫描（参考源码 htmlTagsOutsideCode） */
function htmlTagsOutsideCode(value) {
    const tags = [];
    let cursor = 0;
    let codeTicks = 0;
    while (cursor < value.length) {
        if (value[cursor] === '`') {
            let end = cursor + 1;
            while (value[end] === '`')
                end += 1;
            const ticks = end - cursor;
            if (codeTicks === 0)
                codeTicks = ticks;
            else if (ticks === codeTicks)
                codeTicks = 0;
            cursor = end;
            continue;
        }
        if (codeTicks === 0 && value[cursor] === '<') {
            const tag = value.slice(cursor).match(/^<(\/)?([A-Za-z][A-Za-z0-9:_-]*)(?:\s[^<>]*?)?\s*(\/?)>/u);
            const name = tag?.[2]?.toLowerCase();
            if (tag?.[0] !== undefined && name !== undefined) {
                tags.push({
                    start: cursor,
                    end: cursor + tag[0].length,
                    name,
                    closing: tag[1] === '/',
                    selfClosing: tag[3] === '/',
                });
                cursor += tag[0].length;
                continue;
            }
        }
        cursor += 1;
    }
    return tags;
}
function hasDisplayHtmlOutsideCode(value) {
    return htmlTagsOutsideCode(value).some(tag => HTML_DISPLAY_TAGS.has(tag.name));
}
/** 切出一个行首平衡块级 HTML 块，后续散文逐字节保留（参考源码 splitLeadingHtmlBlock） */
function splitLeadingHtmlBlock(value) {
    const start = value.search(/\S/u);
    if (start < 0)
        return undefined;
    const tags = htmlTagsOutsideCode(value);
    const first = tags.find(tag => tag.start >= start);
    if (first?.start !== start || first.closing || first.selfClosing || !HTML_BLOCK_TAGS.has(first.name)) {
        return undefined;
    }
    let depth = 0;
    for (const tag of tags) {
        if (tag.start < first.start || tag.name !== first.name || tag.selfClosing)
            continue;
        if (tag.closing)
            depth -= 1;
        else
            depth += 1;
        if (depth === 0)
            return { html: value.slice(0, tag.end), rest: value.slice(tag.end) };
        if (depth < 0)
            return undefined;
    }
    return undefined;
}
/** 参考源码 sourceLines */
function sourceLines(value) {
    const lines = [];
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu;
    for (const match of value.matchAll(pattern)) {
        const text = match[0];
        const start = match.index;
        if (text === '' && start === value.length)
            break;
        lines.push({ start, end: start + text.length, text });
    }
    return lines;
}
/** 围栏块是否为完整前端文档（参考源码 isFrontendDocument） */
function isFrontendDocument(info, source) {
    const completeDocument = /<!doctype\s+html\b|<html(?:\s|>)/iu.test(source)
        && /<\/html\s*>/iu.test(source);
    if (completeDocument)
        return true;
    const language = info.trim().split(/\s+/u)[0]?.toLowerCase();
    if (language !== undefined && language !== '')
        return language === 'html';
    return /<!doctype\s+html\b|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)/iu.test(source);
}
function appendSegment(segments, text) {
    if (text === '')
        return;
    if (hasDisplayHtmlOutsideCode(text)) {
        const split = splitLeadingHtmlBlock(text);
        if (split !== undefined && split.rest.trim() !== '') {
            segments.push({ kind: 'inline-html', source: split.html });
            appendSegment(segments, split.rest);
            return;
        }
        segments.push({ kind: 'inline-html', source: text });
        return;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'markdown') {
        segments[segments.length - 1] = { kind: 'markdown', text: previous.text + text };
        return;
    }
    segments.push({ kind: 'markdown', text });
}
/**
 * 把 display 正则替换后的文本切成有序三段（参考源码 compileCharacterDisplay）：
 * - ```html 围栏 / 含 doctype·html·head·body 的完整文档 → {kind:'html'}（进 iframe）；
 * - 行首平衡 HTML 块（<div>…</div> 等）→ {kind:'inline-html'}（sanitize 内联）；
 * - 其余散文 → {kind:'markdown'}（MarkdownText）。
 */
export function compileDisplaySegments(value) {
    const lines = sourceLines(value);
    const segments = [];
    let cursor = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === undefined)
            continue;
        const opening = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*?)[ \t]*(?:\r\n|\r|\n|$)$/u);
        if (opening === null)
            continue;
        const marker = opening[1];
        if (marker === undefined)
            continue;
        let closingIndex;
        for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
            const closing = lines[candidate]?.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r\n|\r|\n|$)$/u);
            const closingMarker = closing?.[1];
            if (closingMarker !== undefined && closingMarker[0] === marker[0] && closingMarker.length >= marker.length) {
                closingIndex = candidate;
                break;
            }
        }
        if (closingIndex === undefined)
            break;
        const closing = lines[closingIndex];
        if (closing === undefined)
            break;
        const source = value.slice(line.end, closing.start);
        if (isFrontendDocument(opening[2] ?? '', source)) {
            appendSegment(segments, value.slice(cursor, line.start));
            segments.push({ kind: 'html', source });
            cursor = closing.end;
        }
        index = closingIndex;
    }
    appendSegment(segments, value.slice(cursor));
    return segments;
}
/** 编译产物是否需要 iframe 渲染（含完整文档段） */
export function hasFrameSegment(segments) {
    return segments.some(segment => segment.kind === 'html');
}
/** 私用区 token（dsh-tavern presentationToken 同款形态）：U+E000/U+E001 包裹，替换产物暂存，正文只留 token */
const PRESENTATION_TOKEN_RE = /\uE000DSH_RP_REGEX_(\d+)\uE001/gu;
/** 与 regex/engine.ts 同款 ST 字面量剥壳（/pattern/flags；flags 并入，g/m 为基线） */
function compileScriptRegex(findRegex) {
    let source = findRegex;
    let flags = 'gm';
    const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(source);
    if (literal !== null && literal[1].length > 0) {
        source = literal[1];
        const extra = literal[2].replace(/[^gimsuy]/g, '');
        flags = Array.from(new Set('gm' + extra)).join('');
    }
    try {
        return new RegExp(source, flags);
    }
    catch {
        return null;
    }
}
/** 替换串求值（dsh-tavern replacementFor L39-59）：{{match}} + $1..$99 捕获组 + trimStrings */
function buildReplacement(script, match, captures) {
    let replacement = script.replaceString.replace(/\{\{match\}\}/giu, match);
    replacement = replacement.replace(/\$(\d{1,2})/gu, (token, digits) => {
        const index = Number(digits);
        if (index >= 1 && index <= captures.length)
            return captures[index - 1];
        if (digits.length === 2) {
            const fallback = Number(digits[0]);
            if (fallback >= 1 && fallback <= captures.length)
                return captures[fallback - 1] + digits[1];
        }
        return token;
    });
    for (const trim of script.trimStrings)
        replacement = replacement.split(trim).join('');
    return replacement;
}
/** depth 过滤（现在透传真实消息深度，条目自身 minDepth/maxDepth 生效；null = 不过滤） */
function inDepth(script, depth) {
    if (depth === null)
        return true;
    if (script.minDepth != null && depth < script.minDepth)
        return false;
    if (script.maxDepth != null && depth > script.maxDepth)
        return false;
    return true;
}
/**
 * display 视图的两趟执行（P0-3）：
 * 1. 先跑通用脚本（!markdownOnly && !promptOnly）；
 * 2. 再跑 markdownOnly（仅显示）专属脚本——两趟内脚本各自保持数组顺序。
 *
 * 每个替换产物存入 presentationParts[]，正文只留 DSH_RP_REGEX_i token，
 * 全部替换完成后统一还原——后续正则不会把前一个正则产出的 HTML 标记当正文二次污染。
 * 防空白守卫：替换后整轮为空则回退原文（dsh-tavern L136-147 思路）。
 */
export function runDisplayScripts(scripts, source, depth) {
    const presentationParts = [];
    const applied = [];
    const warnings = [];
    const presentationToken = (index) => `\uE000DSH_RP_REGEX_${index}\uE001`;
    let text = source;
    // 两趟（dsh-agent-rp runScripts L285）：pass 0 = 通用，pass 1 = markdownOnly 专属
    const passes = [
        script => !script.markdownOnly && !script.promptOnly,
        script => script.markdownOnly,
    ];
    for (const inPass of passes) {
        for (const [index, script] of scripts.entries()) {
            if (script.disabled || !inPass(script))
                continue;
            // display 渲染消费 placement 1/2/3（AI_OUTPUT 仅显示脚本也跑）
            if (!script.placement.some(p => p === 1 || p === 2 || p === 3))
                continue;
            if (!inDepth(script, depth))
                continue;
            const regex = compileScriptRegex(script.findRegex);
            const label = script.scriptName || script.id || `正则 ${index + 1}`;
            if (regex === null) {
                warnings.push(`${label}：无效正则，已跳过`);
                continue;
            }
            let matches = 0;
            const next = text.replace(regex, (match, ...args) => {
                const tail = typeof args.at(-1) === 'object' && args.at(-1) !== null ? 3 : 2;
                const captures = args.slice(0, args.length - tail)
                    .map(value => (typeof value === 'string' ? value : ''));
                matches += 1;
                const replacement = buildReplacement(script, match, captures);
                const token = presentationToken(presentationParts.length);
                presentationParts.push(replacement);
                return token;
            });
            if (matches === 0)
                continue;
            text = next;
            applied.push({ id: script.id, name: label, matches });
        }
    }
    const restoreTokens = (value) => value.replace(PRESENTATION_TOKEN_RE, (_token, digits) => presentationParts[Number(digits)] ?? '');
    const restored = restoreTokens(text);
    // 防空白守卫：整轮正文被替换清空 → 回退原文（不报 applied）
    if (applied.length > 0 && source.trim() !== '' && restored.trim() === '') {
        warnings.push('display 正则覆盖了整轮正文，已回退原文');
        return { text: source, applied: [], warnings };
    }
    return { text: restored, applied, warnings };
}
// ---------------------------------------------------------------------------
// iframe 文档骨架（移植 dsh-tavern client.js L883-941，MIT）
// ---------------------------------------------------------------------------
export const FRAME_MAX_HEIGHT = 12000;
export const FRAME_MIN_HEIGHT = 48;
/** 参考源码 clampTavernFrameHeight */
export function clampFrameHeight(value) {
    return Math.max(FRAME_MIN_HEIGHT, Math.min(FRAME_MAX_HEIGHT, Math.ceil(Number(value) || FRAME_MIN_HEIGHT)));
}
/** iframe 内高度上报脚本（参考源码 reporter：ResizeObserver/load/MutationObserver，fixed 部件不计入高度） */
function heightReporterScript(tokenJson) {
    return '<script data-dsht-rp-frame>(function(){var token=' + tokenJson + ';var last=0;var queued=false;'
        + 'function nodeBottom(node){if(!node||typeof node.getBoundingClientRect!=="function")return 0;var style;'
        + 'try{style=getComputedStyle(node);}catch(e){return 0;}'
        + 'if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed")return 0;'
        + 'var rect=node.getBoundingClientRect();if(rect.width===0&&rect.height===0)return 0;'
        + 'var top=rect.top,bottom=rect.bottom;var ancestor=node.parentElement;'
        + 'while(ancestor&&ancestor!==document.documentElement){var ancestorStyle;'
        + 'try{ancestorStyle=getComputedStyle(ancestor);}catch(e){ancestorStyle=null;}'
        + 'var overflow=String(ancestorStyle&&(ancestorStyle.overflowY||ancestorStyle.overflow)||"visible");'
        + 'if(overflow!=="visible"){var ancestorRect=ancestor.getBoundingClientRect();'
        + 'top=Math.max(top,ancestorRect.top);bottom=Math.min(bottom,ancestorRect.bottom);if(bottom<=top)return 0;}'
        + 'ancestor=ancestor.parentElement;}return Math.ceil(bottom+(window.scrollY||0));}'
        + 'function measure(){var body=document.body;if(!body)return 48;'
        + 'var bodyRect=body.getBoundingClientRect();'
        + 'var height=Math.max(body.scrollHeight||0,Math.ceil(bodyRect.bottom+(window.scrollY||0)),48);'
        + 'var nodes=[body].concat(Array.prototype.slice.call(body.querySelectorAll("*")));'
        + 'for(var i=0;i<nodes.length;i+=1)height=Math.max(height,nodeBottom(nodes[i]));return height;}'
        + 'function report(){queued=false;var height=measure();if(height===last)return;last=height;'
        + 'parent.postMessage({type:"dsht-rp-frame-height",token:token,height:height},"*");}'
        + 'function schedule(){if(queued)return;queued=true;'
        + 'if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else setTimeout(report,0);}'
        + 'if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(schedule);'
        + 'observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}'
        + 'addEventListener("load",schedule);'
        + 'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);'
        + 'new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});'
        + 'schedule();})();<\/script>';
}
/** iframe 消息类型常量（宿主侧 message 校验用） */
export const FRAME_HEIGHT_MESSAGE_TYPE = 'dsht-rp-frame-height';
/**
 * 组装 iframe srcdoc（参考源码 buildTavernFrameDocument）：
 * - 完整文档段（含 doctype/html）：高度上报脚本注入 </body> 前，保留文档自身结构；
 * - HTML 片段：包进带 CSP/基础样式的文档骨架。
 * sandbox="allow-scripts" 由组件侧声明（不给 allow-same-origin）。
 */
export function buildDisplayFrameDocument(source, token) {
    const tokenJson = JSON.stringify(String(token)).replace(/</gu, '\\u003c');
    const reporter = heightReporterScript(tokenJson);
    if (/<!doctype\s+html\b|<html(?:\s|>)/iu.test(source)) {
        return /<\/body\s*>/iu.test(source)
            ? source.replace(/<\/body\s*>/iu, `${reporter}</body>`)
            : source + reporter;
    }
    return '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="referrer" content="no-referrer">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src https: data: blob:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; style-src \'unsafe-inline\' https:; script-src \'unsafe-inline\' \'unsafe-eval\' https: data: blob:; connect-src https: wss: data: blob:; frame-src https: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
        + '<style>:root{color-scheme:light dark}html,body{box-sizing:border-box;margin:0;min-height:0;background:transparent;color:CanvasText;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.75}body{padding:0 1px;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,video,svg,canvas{max-width:100%;height:auto}pre{max-width:100%;overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}a{color:LinkText}</style>'
        + `</head><body>${source}${reporter}</body></html>`;
}
// ---------------------------------------------------------------------------
// 显示期数据面（I4 宏上下文 / B6 render-entries / B8 永久写回 / C3 TH 渲染组设置）
// 全部模块级 5s TTL 缓存——窗口化滚动回渲/流式重排不重复拉取；失败静默透传
// （宏不展开、包裹不拼、写回不发——数据面不可达只降级，不阻塞渲染）。
// ---------------------------------------------------------------------------
export { expandDisplayMacros };
/** 缓存 TTL（任务定案：5s——渲染期高频重入，长 TTL 会拖住设置改动生效） */
const DISPLAY_DATA_TTL = 5000;
/** GET 数据面（/dsht-mvu、/dsht-prompt-template 的查询串路由；失败抛错由调用方兜底） */
async function getJson(url) {
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok)
        throw new Error(`GET ${url}: HTTP ${resp.status}`);
    return await resp.json();
}
/** POST 数据面（/dsht-rp 前缀在 GET 分支后有 POST-only 门——带查询串 POST 同样可路由，
 *  服务端从 req.url 读 query 与方法无关；body 恒 {} 满足 JSON 解析门） */
async function postJson(url) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!resp.ok)
        throw new Error(`POST ${url}: HTTP ${resp.status}`);
    return await resp.json();
}
// ---- I4：身份 + 变量（宏展开数据源；每 slug::session 5s TTL）----
/** 【审查修复 2026-09-05】缓存键带 slug::sessionId——单槽无键会 5s 内切会话串数据 */
const renderCtxCacheMap = new Map();
/** 加载显示期宏上下文（identity + variables 并行；任一失败 → null = 原文透传） */
export function loadDisplayRenderCtx(slug, sessionId) {
    const now = Date.now();
    const key = `${slug}::${sessionId}`;
    const cached = renderCtxCacheMap.get(key);
    if (cached !== undefined && now - cached.at < DISPLAY_DATA_TTL)
        return cached.value;
    const value = (async () => {
        try {
            const [identity, vars] = await Promise.all([
                postJson(`/dsht-rp/rp/identity?slug=${encodeURIComponent(slug)}`),
                getJson(`/dsht-mvu/variables?sessionId=${encodeURIComponent(sessionId)}`),
            ]);
            return {
                user: typeof identity.user === 'string' && identity.user ? identity.user : '用户',
                char: typeof identity.char === 'string' && identity.char ? identity.char : '角色',
                persona: typeof identity.persona === 'string' ? identity.persona : '',
                variables: vars.variables ?? {},
            };
        }
        catch {
            return null; // 拉取失败静默透传（宏保持原文）
        }
    })();
    renderCtxCacheMap.set(key, { at: now, value });
    return value;
}
const EMPTY_ENTRIES = { before: '', after: '' };
const renderEntriesCache = new Map();
/** 加载 [RENDER] 包裹（失败透传空 = 不包裹；是否启用由 ejs renderLoaderEnabled 在消费端裁决） */
export function loadRenderEntries(slug, sessionId) {
    const key = `${slug}::${sessionId}`;
    const now = Date.now();
    const cached = renderEntriesCache.get(key);
    if (cached !== undefined && now - cached.at < DISPLAY_DATA_TTL)
        return cached.value;
    const value = postJson(`/dsht-prompt-template/render-entries?slug=${encodeURIComponent(slug)}&sessionId=${encodeURIComponent(sessionId)}`)
        .then(r => ({
        before: typeof r.before === 'string' ? r.before : '',
        after: typeof r.after === 'string' ? r.after : '',
    }))
        .catch(() => EMPTY_ENTRIES);
    if (renderEntriesCache.size > 4)
        renderEntriesCache.clear(); // 渲染期单会话，双槽即够；防爆涨
    renderEntriesCache.set(key, { at: now, value });
    return value;
}
let ejsSettingsCache = null;
/** 加载 EJS 设置（GET /dsht-prompt-template/settings；失败 → null = 调用方按关闭处理） */
export function loadEjsDisplaySettings() {
    const now = Date.now();
    if (ejsSettingsCache !== null && now - ejsSettingsCache.at < DISPLAY_DATA_TTL)
        return ejsSettingsCache.value;
    const value = getJson('/dsht-prompt-template/settings')
        .then(raw => ({
        enabled: raw.enabled !== false,
        renderLoaderEnabled: raw.renderLoaderEnabled === true,
        permanentEvaluation: raw.permanentEvaluation === true,
        codeEditor: raw.codeEditor === true,
    }))
        .catch(() => null);
    ejsSettingsCache = { at: now, value };
    return value;
}
let thRenderCache = null;
/** 加载 TH 渲染组设置（GET /dsht-tavern-helper/settings；失败 → null = 调用方按全开/不限处理） */
export function loadThRenderSettings() {
    const now = Date.now();
    if (thRenderCache !== null && now - thRenderCache.at < DISPLAY_DATA_TTL)
        return thRenderCache.value;
    const value = getJson('/dsht-tavern-helper/settings')
        .then(raw => {
        const r = raw.render ?? {};
        const collapse = r.collapseCodeBlock;
        return {
            enabled: r.enabled !== false,
            depth: typeof r.depth === 'number' && Number.isFinite(r.depth) ? r.depth : 0,
            depthIgnoreHidden: r.depthIgnoreHidden === true,
            collapseCodeBlock: collapse === 'all' || collapse === 'none' ? collapse : 'frontend_only',
            allowStreaming: r.allowStreaming === true,
            useBlobUrl: r.useBlobUrl === true,
            optimizeHljs: r.optimizeHljs !== false,
        };
    })
        .catch(() => null);
    thRenderCache = { at: now, value };
    return value;
}
// ---- B8：客户端永久写回（模块级去重 Set；失败 warn 一次不重试）----
const permanentWritten = new Set();
/**
 * B8 写回：渲染成功且宏展开确有变化的 assistant 楼层，把展开结果写回会话
 * （POST /dsht-prompt-template/permanent {sessionId, seq, text}；服务端 replace
 * 原语 + ejsProcessed 标记）。按 sessionId::seq 幂等去重——重渲染不重发；
 * 失败 console.warn 一次（Set 已占位，不重试不刷屏）。
 */
export function reportPermanentRender(sessionId, seq, text) {
    const key = `${sessionId}::${seq}`;
    if (permanentWritten.has(key))
        return;
    permanentWritten.add(key);
    if (permanentWritten.size > 512)
        permanentWritten.clear(); // 防泄漏（丢位最多多发一次；幂等由服务端 ejsProcessed 兜底）
    void fetch('/dsht-prompt-template/permanent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, seq, text }),
    }).then(async (r) => {
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
    }).catch(e => {
        console.warn(`[dsht-rp] B8 永久写回失败（seq=${seq}）:`, e.message);
    });
}
// ---------------------------------------------------------------------------
// C3：<pre> DOM 增强（collapse_code_block 折叠 + optimize_hljs 轻量高亮）
// 宿主 MarkdownText 产物（React 管 DOM）：只加 class/data 标记与一次性 innerHTML，
// 节点被 React 重建时 dataset 丢失 → 消费端 effect 重跑自然补齐（幂等）。
// ---------------------------------------------------------------------------
/** 高亮词表（轻量面：字符串/注释/数字/常用关键字——不做逐语言文法，移动端性能优先） */
const PRE_HL_RE = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(function|return|if|else|for|while|const|let|var|class|new|await|async|import|export|from|of|in|try|catch|finally|throw|switch|case|break|continue|true|false|null|undefined|def|end|do|then|elif|fi|local|nil|echo|fn|pub|use|match)\b/g;
function escapePreHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** 轻量关键字高亮（textContent → 逃逸 → 分组着色；空块/>50KB/已高亮跳过） */
function highlightPreCode(pre) {
    const code = pre.querySelector('code') ?? pre;
    if (code.querySelector('span[data-dsht-hl]') !== null)
        return;
    const raw = code.textContent ?? '';
    if (raw.length === 0 || raw.length > 50_000)
        return;
    const html = escapePreHtml(raw).replace(PRE_HL_RE, (m, str, com, num) => {
        const kind = str !== undefined ? 'str' : com !== undefined ? 'com' : num !== undefined ? 'num' : 'kw';
        return `<span data-dsht-hl="${kind}">${m}</span>`;
    });
    code.innerHTML = html;
}
/** 折叠 Armed：<pre> 默认收起（>200px 才值得），点击展开（一次性监听）。
 *  双标记防重入：dsht-pre-collapsible = 已武装（不再重复挂监听）；
 *  dsht-pre-expanded = 用户已展开（增强重跑时不再收回——用户意愿优先）。 */
function armPreCollapse(pre) {
    if (pre.classList.contains('dsht-pre-collapsible') || pre.classList.contains('dsht-pre-expanded'))
        return;
    if (pre.scrollHeight <= 200)
        return;
    pre.classList.add('dsht-pre-collapsible', 'dsht-pre-collapsed');
    pre.addEventListener('click', () => {
        pre.classList.remove('dsht-pre-collapsed');
        pre.classList.add('dsht-pre-expanded');
    }, { once: true });
}
/** 对 root 内全部 <pre> 做一次增强（幂等：highlight 查 span 标记 / collapse 查 class，
 *  不落 dataset——React 重写 children 后高亮标记丢失时能自然补齐） */
export function enhancePreBlocks(root, opts) {
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
        if (!(pre instanceof HTMLElement))
            continue;
        if (opts.hljs)
            highlightPreCode(pre);
        if (opts.collapse)
            armPreCollapse(pre);
    }
}
