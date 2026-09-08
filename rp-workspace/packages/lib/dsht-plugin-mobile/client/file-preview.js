/**
 * I6 移动端文件引用预览：点按聊天里的文件引用（fileMention 部件 / 文件链接）时
 * 打开全屏抽屉 overlay 预览文件内容；拿不到内容就显示「该文件类型请在电脑端查看」
 * + 文件名（任务定案的兜底面）。
 *
 * 触控锚点吞 tap 排查结论（audit，2026-09-05）：
 * - anchors.ts 只给宿主壳层元素打 data-dsht-mobile 标记（不碰 chat 消息内容，
 *   不改 pointer-events）——不会吞文件引用的 tap；
 * - installDetailsToggleProxy 的 capture 代理只拦 `summary` 元素并 stopPropagation，
 *   与文件引用（button/code/a）无交集——也不吞。
 * - 真正的问题：宿主把文件引用渲染成 `<code><button class="…fileMention…"
 *   title="…" aria-label="…">路径</button></code>`（宿主 bundle 实测 DOM 形状），
 *   其 onClick 走宿主桌面文件查看器——移动端要么没反应要么跳出会话。本模块在
 *   capture 阶段拦下 tap、打开移动端自己的预览抽屉。
 *
 * 选择器约定：CSS-modules 哈希类名不可靠，用 [class*="fileMention"] 局部名子串匹配
 * （anchors.ts 同款思路：局部名跨宿主升级稳定，哈希段会变）。
 *
 * 拦截只在窄屏（max-width:700px，与 style.ts 五件套同断点）生效——桌面端宿主
 * 原生 open 行为不动。内容抓取：文件链接直接 fetch 自身 href；fileMention 按钮的
 * title 若是路由/URL 也试一次；其余走兜底文案。
 */
const PREVIEW_Z = 2200; // 高于 dsht-rp overlay(1000) 与悬浮球(60)
const FETCH_CAP = 256 * 1024; // 文本预览上限（超出截断）
/** 宿主 fileMention 部件（button）与文件链接（a[href]）的最小面 */
function findPreviewTarget(el) {
    if (el === null)
        return null;
    const mention = el.closest('button[class*="fileMention"]');
    if (mention !== null) {
        const title = mention.getAttribute('title') ?? '';
        const text = (mention.textContent ?? '').trim();
        const url = /^https?:\/\//.test(title) || title.startsWith('/') ? title : null;
        return { kind: 'mention', name: text !== '' ? text : title, url };
    }
    const link = el.closest('a[href]');
    if (link !== null) {
        const href = link.getAttribute('href') ?? '';
        // 只拦同源 http(s) 且路径带文件扩展名的链接（无扩展名的应用内路由链接
        // 放行宿主原生导航——绝不能把站内跳转吞成预览）
        try {
            const u = new URL(href, location.href);
            if (u.origin !== location.origin)
                return null;
            if (!/\.[\w]+$/.test(u.pathname))
                return null;
            return { kind: 'link', name: decodeURIComponent(u.pathname.split('/').pop() ?? ''), url: u.href };
        }
        catch {
            return null;
        }
    }
    return null;
}
/** 文本类扩展名（含 .html——排除 SPA 首页兜底后按路径豁免） */
const TEXT_PATH_RE = /\.(md|txt|json|ya?ml|log|csv|tsv|js|ts|jsx|tsx|css|html?|xml|py|rb|go|rs|java|c|h|cpp|sh|bat|ps1|toml|ini|conf|ejs|lua)$/i;
/**
 * 文本类嗅探：路径扩展名优先（fileMention 的 title 路由同样适用）；
 * content-type text/* 只有在路径带文件扩展名时才信（纯 text/html = SPA 首页
 * fallback，直接展示整页 HTML 是噪音——回退「请在电脑端查看」）。
 */
function looksTextual(contentType, path) {
    if (TEXT_PATH_RE.test(path))
        return true;
    if (/^text\//i.test(contentType) && /\.[\w]+$/.test(path))
        return true;
    return /^(application\/(json|xml|javascript|yaml|x-yaml))/i.test(contentType) && path !== '/';
}
function imageLike(path) {
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
}
let previewHost = null;
/** 打开全屏抽屉（幂等：先关再开）；content 为 null = 兜底文案面 */
function openPreview(name, content) {
    closePreview();
    const root = document.createElement('div');
    root.className = 'dsht-mobile-file-preview';
    root.style.zIndex = String(PREVIEW_Z);
    const panel = document.createElement('div');
    panel.className = 'dsht-mobile-file-preview-panel';
    const head = document.createElement('div');
    head.className = 'dsht-mobile-file-preview-head';
    const title = document.createElement('span');
    title.className = 'dsht-mobile-file-preview-title';
    title.textContent = name !== '' ? name : '文件';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dsht-mobile-file-preview-close';
    close.setAttribute('aria-label', '关闭预览');
    close.textContent = '✕';
    close.addEventListener('click', closePreview);
    head.append(title, close);
    const body = document.createElement('div');
    body.className = 'dsht-mobile-file-preview-body';
    if (content === null) {
        // 兜底：该文件类型请在电脑端查看（+ 文件名，任务定案）
        const note = document.createElement('div');
        note.className = 'dsht-mobile-file-preview-fallback';
        note.textContent = `该文件类型请在电脑端查看：${name !== '' ? name : '未知文件'}`;
        body.append(note);
    }
    else if (content.kind === 'text') {
        const pre = document.createElement('pre');
        pre.className = 'dsht-mobile-file-preview-text';
        pre.textContent = content.value;
        body.append(pre);
    }
    else {
        const img = document.createElement('img');
        img.className = 'dsht-mobile-file-preview-img';
        img.src = content.url;
        img.alt = name;
        body.append(img);
    }
    panel.append(head, body);
    root.append(panel);
    // 点遮罩关闭（点面板本身不关）
    root.addEventListener('click', e => { if (e.target === root)
        closePreview(); });
    document.body.append(root);
    previewHost = root;
}
function closePreview() {
    previewHost?.remove();
    previewHost = null;
}
/**
 * 安装文件引用预览（capture 代理 + 全屏抽屉）。返回 disposer。
 * 窄屏生效（与 CSS 五件套同断点）；桌面端直接放行宿主原生行为。
 */
export function installFilePreview(doc) {
    const narrow = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches;
    const onClick = (e) => {
        if (!narrow())
            return;
        const target = e.target;
        const hit = findPreviewTarget(target);
        if (hit === null)
            return;
        // 宿主 details 代理在先注册（同为 document capture）——summary 无交集，互不影响
        e.preventDefault();
        e.stopPropagation();
        // 打开抽屉（先兜底面），再异步抓内容替换——点按零等待感
        openPreview(hit.name, null);
        if (hit.url === null)
            return;
        const url = hit.url;
        const path = new URL(url, location.href).pathname;
        // 图片类：直接 <img> 展示（无需 fetch 抓文本）
        if (imageLike(path)) {
            openPreview(hit.name, { kind: 'image', url });
            return;
        }
        void (async () => {
            try {
                const resp = await fetch(url);
                if (!resp.ok)
                    throw new Error(`HTTP ${resp.status}`);
                const type = resp.headers.get('content-type') ?? '';
                if (!looksTextual(type, path))
                    throw new Error('not textual');
                const text = await resp.text();
                openPreview(hit.name, {
                    kind: 'text',
                    value: text.length > FETCH_CAP ? `${text.slice(0, FETCH_CAP)}\n…（已截断，完整内容请在电脑端查看）` : text,
                });
            }
            catch {
                // 抓不到内容：停在兜底面（「该文件类型请在电脑端查看」）
            }
        })();
    };
    doc.addEventListener('click', onClick, true);
    return () => { doc.removeEventListener('click', onClick, true); closePreview(); };
}
