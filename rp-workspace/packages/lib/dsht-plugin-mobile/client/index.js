import { installAnchors } from './anchors.ts';
import { ensureMobileStyle } from './style.ts';
import { installFilePreview } from './file-preview.ts';
/** 模块顶层引导：CSS + 锚点 + details 点击代理 + 文件引用预览（幂等；无 document 环境直接跳过） */
let booted = false;
function boot() {
    if (booted || typeof document === 'undefined')
        return;
    booted = true;
    ensureMobileStyle();
    installAnchors(document);
    installDetailsToggleProxy();
    installFilePreview(document);
}
/**
 * details 原生切换代理（2026-09-04）：卓易通/部分 WebView 的 <details> 原生
 * 点击切换**失效**（裸 details 实测 open=false 内容照常渲染——影响原生 harness
 * 过程折叠行"展开后收不回"与一切 details 折叠）。代理：capture 阶段拦 summary
 * 点击，preventDefault 掉原生（失效的）切换，手动翻转 open——正常 WebView 上
 * 行为等价，失效 WebView 上被修复。
 */
function installDetailsToggleProxy() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        const summary = target?.closest?.('summary') ?? null;
        if (summary === null)
            return;
        const details = summary.parentElement;
        if (details === null || details.tagName !== 'DETAILS')
            return;
        e.preventDefault();
        e.stopPropagation();
        details.open = !details.open;
    }, true);
}
boot();
/** 汉堡按钮 + 抽屉遮罩（shell.overlay 席位；显隐由 CSS 媒体查询 + 宿主状态钩子驱动） */
function MobileNav({ toggle }) {
    return (<div className="dsht-mobile-nav">
      <button type="button" className="dsht-mobile-hamburger" aria-label="打开侧边栏" onClick={() => toggle?.()}>
        ☰
      </button>
      <div className="dsht-mobile-scrim" onClick={() => toggle?.()}/>
    </div>);
}
export const inject = ['slots', 'layout'];
export function apply(ctx) {
    boot();
    // 宿主无 layout 服务（非 DSH rc 系）：CSS/锚点已在模块顶层生效，跳过汉堡注入
    if (typeof ctx.layout?.toggleSidebar !== 'function')
        return;
    const toggle = () => ctx.layout?.toggleSidebar?.();
    ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsht-mobile-nav', order: -10, inject: () => ({ toggle }) }, MobileNav)), 'dsht-plugin-mobile: nav overlay');
    // 实测坑：抽屉开着时点抽屉里的 RP 按钮，RP overlay 开在抽屉**后面**——抽屉不关，
    // 整个 overlay 被盖住（遮罩也在 overlay 层之下，点不到）。宿主无「overlay 打开」事件，
    // RP overlay 的打开信号是它自己发的 window 事件（dsht-rp-ui RP_OPEN_EVENT，
    // 按事件名字符串监听保持宿主/插件无关）：抽屉开着就收掉。
    const closeDrawerOnRpOpen = () => {
        const frame = document.querySelector('[data-dsht-mobile="app-frame"]');
        if (frame && !frame.hasAttribute('data-sidebar-collapsed'))
            toggle();
    };
    window.addEventListener('dsht-rp-ui:open', closeDrawerOnRpOpen);
    ctx.effect(() => () => window.removeEventListener('dsht-rp-ui:open', closeDrawerOnRpOpen), 'dsht-plugin-mobile: rp-open listener');
}
