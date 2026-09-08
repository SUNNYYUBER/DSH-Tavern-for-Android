/**
 * 宿主锚点解析器：把宿主 shell 的关键元素打成 data-* 锚点，CSS 只消费锚点。
 *
 * 约定（对照 dsh-tavern dsh-client-ui-mobile-adapt 的 data-sidebar-collapsed 状态钩子
 * 思路，MIT）：CSS 里绝不硬编码宿主编译后的哈希类名（.pI_x6G_* / .VOzbGW_* /
 * .hHd-Xa_*）——哈希类名只允许出现在本文件的候选选择器里（单点维护，DSH 升级
 * 只改这一个文件）；样式侧一律写 [data-dsht-mobile="<anchor>"]。
 *
 * 结构性解析优先于类名：app-frame 直接取宿主自带 [data-shell-overlay] 的父元素
 * （零类名依赖），sidebar-col 取 app-frame 的首个子元素；只有设置面板/侧栏 rail
 * 这类无宿主 data 钩子的区域才回退到候选类名选择器。
 */
/** 锚点属性名（CSS 唯一消费面） */
export declare const ANCHOR_ATTR = "data-dsht-mobile";
export type AnchorStrategy = 
/** [data-shell-overlay] 的父元素（宿主自带钩子，结构性，零类名依赖） */
'overlay-parent'
/** app-frame 锚点元素的首个子元素（rc 系 AppFrame 首子即 sidebarCol） */
 | 'first-child-of-frame';
export interface AnchorDef {
    anchor: string;
    /** 候选类名选择器（哈希类名唯一允许出现的位置；按序尝试，命中即打标） */
    selectors: string[];
    strategy?: AnchorStrategy;
}
/**
 * 锚点表。rc.7 基线（dsh-client-ui-layout / ui-settings-general / ui-sidebar）：
 * 布局 frame 类名与 dsh-tavern 参考实现同源（.pI_x6G_*），设置面板 .VOzbGW_*、
 * 侧栏 rail .hHd-Xa_* 为本仓 style.ts 既有 hack 的迁移——全部锚点化。
 */
export declare const ANCHOR_DEFS: AnchorDef[];
/** 解析器操作的最小元素面（真实 DOM Element 结构性满足；测试可注入假 DOM） */
export interface AnchorElementLike {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    readonly parentElement: AnchorElementLike | null;
    readonly firstElementChild: AnchorElementLike | null;
}
export interface AnchorRootLike {
    querySelectorAll(selectors: string): ArrayLike<AnchorElementLike>;
}
/**
 * 全量扫一遍并把未打标的宿主元素打上锚点（幂等：已带 data-dsht-mobile 的元素跳过）。
 * 返回本轮新打标的元素数。
 */
export declare function resolveAnchors(root: AnchorRootLike): number;
/**
 * 安装锚点解析：立即全量扫一次 + MutationObserver 盯后续挂载（设置面板/详情列
 * 等懒挂载区域）。返回 disposer。SSR/无 body 环境退化为单次扫描。
 *
 * 移动端性能（2026-09-04 用户反馈 DSHT 发烫）：observer 回调原本每个 mutation
 * 批次同步跑 resolveAnchors——全文档 17 个候选选择器扫描；流式会话期间每个
 * token 都有 DOM mutation，等于每帧全文档扫 17 遍（麒麟级 SoC 上持续满载）。
 * 改为节流 + 收敛降频：到点即扫；扫到新锚点 → 间隔回到 200ms；连续扫不到
 * （壳层锚点早已打完，DOM 只在流式重排）→ 间隔翻倍至 1s 上限。空闲后新面板
 * 挂载的 mutation 到达时 due 已过期，setTimeout(0) 立即扫描——懒挂载打标
 * 无可感延迟。
 */
export declare function installAnchors(doc: Document): () => void;
