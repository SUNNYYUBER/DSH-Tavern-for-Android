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
/**
 * 安装文件引用预览（capture 代理 + 全屏抽屉）。返回 disposer。
 * 窄屏生效（与 CSS 五件套同断点）；桌面端直接放行宿主原生行为。
 */
export declare function installFilePreview(doc: Document): () => void;
