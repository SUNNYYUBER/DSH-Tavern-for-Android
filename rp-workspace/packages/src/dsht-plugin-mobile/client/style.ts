/**
 * dsht-plugin-mobile 移动端样式：CSS 五件套 + 宿主锚点消费面。
 *
 * 参考 dsh-tavern android/dsh-client-ui-mobile-adapt/client.js（MIT）的移动端五件套：
 *   ① 100dvh 动态视口（移动浏览器工具栏伸缩不遮输入区）
 *   ② grid 轨道锁定（侧栏脱文档流后中栏不被挤进 0 宽轨道）
 *   ③ left 抽屉（不用 transform——抽屉内 fixed 面板会被锚定裁剪）
 *   ④ safe-area inset（刘海/手势条避让）
 *   ⑤ 触控目标 ≥38px（拇指点按）
 *
 * 锚点约定：本文件只消费 [data-dsht-mobile="<anchor>"]（anchors.ts 运行时打标）
 * 与宿主自带状态钩子（[data-sidebar-collapsed]/[data-shell-overlay]），
 * 绝不硬编码宿主编译后的哈希类名（单点维护在 anchors.ts）。
 *
 * RP 组件竖屏规则（.dsht-rp-* / .wb-* / .dsht-fold-header 等组件自有稳定类名）
 * 从 dsht-rp-ui/style.ts 抽离于此集中管理；类名无匹配元素即空转——
 * 本插件不依赖 dsht-rp 也能独立生效（宿主无关）。
 */

export const MOBILE_STYLE_ID = 'dsht-plugin-mobile-style'

export function ensureMobileStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(MOBILE_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = MOBILE_STYLE_ID
  el.textContent = MOBILE_CSS
  document.head.append(el)
}

export const MOBILE_CSS = `
/* ===== dsht-plugin-mobile：CSS 五件套（参考 dsh-client-ui-mobile-adapt v20，MIT）===== */

/* 汉堡按钮与遮罩在桌面端一律隐藏；席位根节点自身不吃指针（overlay 席位默认
   pointer-events:auto 会落到直接子节点上——显式收回，只放给按钮/遮罩） */
.dsht-mobile-nav { pointer-events: none !important; }
.dsht-mobile-hamburger,
.dsht-mobile-scrim { display: none !important; }

/* 触屏无 hover：角色卡设置角标常显（从 dsht-rp-ui/style.ts 抽离的触屏规则） */
@media (hover: none) { .dsht-rp-card-gear { opacity: 1; } }

@media (max-width: 700px) {
  /* ① 动态视口：避免移动浏览器工具栏遮挡底部输入区 */
  html, body { height: 100dvh; }

  /* ② grid 轨道锁定：三栏网格 → 只有中栏。显式锁定每列所属轨道——
     侧栏脱离文档流（fixed）后 grid 自动布局才不会把中栏挤进 0 宽轨道 */
  [data-dsht-mobile="app-frame"] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; transition: none !important; }
  [data-dsht-mobile="sidebar-col"] { grid-column: 1; }
  [data-dsht-mobile="center-col"] { grid-column: 2; }
  [data-dsht-mobile="details-col"] { grid-column: 3; display: none !important; }
  [data-dsht-mobile="drag-handle"] { display: none !important; }

  /* ③ 左侧抽屉：用 left 位移不用 transform（transform 会让抽屉内 fixed 面板
     锚定到抽屉被裁剪）。显隐读宿主自带状态钩子 [data-sidebar-collapsed] */
  [data-dsht-mobile="sidebar-col"] {
    position: fixed !important; top: 0; bottom: 0; left: -110%;
    width: min(320px, 86vw) !important; z-index: 40;
    transition: left .25s ease; box-shadow: 4px 0 24px rgb(0 0 0 / 30%);
  }
  [data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed]) [data-dsht-mobile="sidebar-col"] { left: 0; }
  /* 侧栏内容组件填满抽屉宽度 */
  [data-dsht-mobile="sidebar-col"] > :first-child { width: 100% !important; }

  /* ④ safe-area：汉堡避开刘海/状态栏 */
  .dsht-mobile-hamburger {
    display: grid !important; position: fixed;
    top: max(10px, env(safe-area-inset-top, 0px));
    left: max(12px, env(safe-area-inset-left, 0px));
    z-index: 41; width: 40px; height: 40px;
    border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
    background: var(--dsw-alias-button-floating-fill); color: var(--dsw-alias-label-primary);
    box-shadow: var(--dsw-shadow-lv2); place-items: center; cursor: pointer;
    pointer-events: auto; -webkit-tap-highlight-color: transparent;
  }
  .dsht-mobile-hamburger:active { background: var(--dsw-alias-button-floating-hover); }

  /* 抽屉遮罩：仅抽屉打开时显示（宿主状态钩子），点按关闭。
     实测坑：遮罩在 shell.overlay 席位层，不是 app-frame 的后代——后代选择器永远
     不命中，抽屉打开后没有任何关闭路径（汉堡也被抽屉盖住）。改 :has() 从根上选。 */
  .dsht-mobile-scrim {
    display: none !important; position: fixed; inset: 0; z-index: 39;
    background: rgb(0 0 0 / 35%); pointer-events: auto;
  }
  body:has([data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed])) .dsht-mobile-scrim { display: block !important; }

  /* ⑤ 触控目标 ≥38px：侧栏折叠 rail 图标按钮放大（拇指点按） */
  [data-dsht-mobile="sidebar-rail"] [data-dsht-mobile="rail-icon-button"] { width: 40px; height: 40px; }

  /* ---- 设置面板（原 dsht-rp-ui/style.ts 的宿主哈希类名 hack，锚点化迁移）----
     全屏 + nav 从 84px 窄列改顶部横向滚动 tab 条，内容区全宽。
     桌面（>700px）不受本媒体查询影响。 */
  [data-dsht-mobile="settings-overlay"] { padding: 0; }
  [data-dsht-mobile="settings-panel"] {
    position: fixed !important; inset: 0 !important;
    width: 100vw !important; max-width: 100vw;
    height: 100dvh !important; max-height: 100dvh;
    border-radius: 0; flex-direction: column !important;
  }
  [data-dsht-mobile="settings-nav"] {
    width: 100% !important; flex-direction: row !important; align-items: center !important;
    gap: 8px !important; padding: 10px 12px 6px !important; box-sizing: border-box;
    overflow-x: auto !important; flex-shrink: 0;
  }
  [data-dsht-mobile="settings-nav-title"] { padding: 0 4px !important; font-size: 15px !important; flex-shrink: 0; }
  [data-dsht-mobile="settings-nav-list"] { flex-direction: row !important; gap: 6px !important; overflow-x: auto !important; }
  [data-dsht-mobile="settings-nav-cell"] {
    height: 48px !important; flex-shrink: 0; white-space: nowrap !important;
    padding: 0 14px !important; border-radius: 12px !important;
  }
  [data-dsht-mobile="settings-nav-label"] { overflow: visible !important; text-overflow: unset !important; }
  [data-dsht-mobile="settings-content"] { min-height: 0 !important; } /* 列布局下让 options 区可滚 */
  [data-dsht-mobile="settings-options"] { padding: 0 14px 16px; }

  /* ---- RP 组件竖屏规则（从 dsht-rp-ui/style.ts R11 抽离；组件自有稳定类名，
     无 RP 插件时无匹配元素即空转）---- */
  /* RP overlay：safe-area inset（①④ 对 RP 面的落地）。
     注意：overlay 根是 fixed inset:0（dsht-rp-ui/style.ts L40）——不能再设 height:100dvh
     （height 会覆盖 bottom 约束，叠加 safe-area padding 后总高 > 视口：384dp 实测溢出
     47px，2026-09-04 排查）。inset:0 已全屏，border-box + padding 让内容避开安全区。 */
  .dsht-rp-overlay {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dsht-rp-topbar { flex-wrap: wrap; gap: 6px; padding: 8px 10px; }
  .dsht-rp-back { width: 44px; height: 44px; font-size: 22px; }
  /* tab 栏独占一行全宽，触控目标 44px */
  .dsht-rp-tabs { flex: 1 1 100%; gap: 6px; margin-left: 0; overflow-x: auto; }
  .dsht-rp-tab { flex: 1; height: 44px; border-radius: 12px; font-size: 14px; }

  /* 角色宫格：双列自适应（超窄自动单列），卡片全宽 */
  .dsht-rp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 12px; }
  .dsht-rp-card { padding: 14px; min-height: 44px; }
  .dsht-rp-card-gear { width: 36px; height: 36px; font-size: 16px; opacity: 1; }

  /* 角色详情/导出抽屉：全屏（不再底部 70%） */
  .dsht-rp-drawer-mask { align-items: stretch; }
  .dsht-rp-drawer { max-height: none; height: 100%; border-radius: 0; border-top: none; }

  /* 预设/正则/导入/世界书面板：去 max-width 居中，全宽 */
  .dsht-rp-preset, .dsht-rp-regex, .dsht-rp-import, .dsht-rp-books { max-width: none; margin: 0; padding: 16px; }

  /* 世界书 chips 触控目标 44px */
  .wb-row { min-height: 44px; }
  .wb-chip { min-height: 44px; padding: 8px 16px; font-size: 14px; border-radius: 22px; }

  /* 触控目标放大（⑤ 对 RP 面的落地） */
  .dsht-rp-btn { min-height: 44px; }
  .dsht-rp-action-btn { min-height: 44px; }
  .dsht-rp-preset-toggle .pt-opt { padding: 6px 12px; min-height: 36px; }
  .rx-toggle span { width: 40px; height: 22px; border-radius: 11px; }
  .rx-toggle span::after { width: 18px; height: 18px; }
  .rx-toggle input:checked + span::after { transform: translateX(18px); }
  .rx-del { width: 36px; height: 36px; font-size: 15px; }
  .dsht-rp-regex-row { padding: 10px 0; flex-wrap: wrap; }

  /* 聊天消息区 480px 限制竖屏放开 */
  .dsht-rp-statusbar, .dsht-rp-actions, .dsht-rp-reasoning, .dsht-rp-mvu-statusbar,
  .dsht-rp-collapsible, .dsht-rp-state-update, .dsht-rp-foreshadowing { max-width: 100%; }

  /* 竖屏触控目标放大（回退按钮 / 预设条目展开钮） */
  .dsht-rp-rollback-btn { height: 36px; font-size: 12px; }
  .pe-expand { width: 40px; height: 40px; font-size: 15px; }
  .dsht-rp-user-stack { max-width: 92%; }

  /* 主会话过程折叠标题行：触控目标 44px */
  .dsht-fold-header { min-height: 44px; font-size: 13px; }

  /* 开场白 dock 窄屏 */
  .dsht-rp-greeting-dock { margin: 0 8px 6px; }
  .dsht-rp-greeting-dock .dsht-rp-btn { min-height: 44px; }

  /* ---- 会话顶栏窄屏修复（2026-09-04 真机截图实证，两轮迭代）----
     汉堡 fixed 在左上（12px 起）→ header 内容整体让位；多级面包屑（工作区 +
     会话名）在 408dp 放不下 → titleRow 允许换行（面包屑一行、actions/utilities
     一行），crumb 自带 max-width 220 + ellipsis，不再与 "Session log/子项计数"
     叠印。原生 crumbs 本就 min-width:0 + overflow:hidden，再显式补强（卓易通
     老内核 flex 收缩实现有差异）。全部走 anchors.ts 顶栏锚点（CSS 零哈希类名）。 */
  [data-dsht-mobile="chat-header"] { padding: 4px 8px 0 52px !important; }
  [data-dsht-mobile="chat-title-row"] {
    flex-wrap: wrap !important;
    row-gap: 2px;
  }
  [data-dsht-mobile="chat-title-cluster"] { flex: 1 1 100% !important; }
  [data-dsht-mobile="chat-crumbs"] { min-width: 0 !important; max-width: 100%; }
  [data-dsht-mobile="chat-header-actions"],
  [data-dsht-mobile="chat-header-utilities"] { margin-left: 8px !important; }
  /* 汉堡（body 层 fixed）落在 header 左侧 padding 让出的空位内，与 crumb 行对齐 */
  .dsht-mobile-hamburger { top: max(8px, env(safe-area-inset-top, 0px)); }
}

/* ---- I6 文件引用全屏预览抽屉（file-preview.ts 打开；窄屏拦截 tap 才会触发，
   桌面无实例零影响；safe-area 避让对齐 ①④）---- */
.dsht-mobile-file-preview {
  position: fixed; inset: 0; background: rgb(0 0 0 / 55%);
  padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}
.dsht-mobile-file-preview-panel {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border-radius: 16px 16px 0 0; overflow: hidden;
}
.dsht-mobile-file-preview-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex-shrink: 0;
}
.dsht-mobile-file-preview-title {
  font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; overflow-wrap: anywhere;
}
.dsht-mobile-file-preview-close {
  flex: none; width: 40px; height: 40px; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px; background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 15px; cursor: pointer;
}
.dsht-mobile-file-preview-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; }
.dsht-mobile-file-preview-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--dsw-font-family-code, monospace); font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-primary);
}
.dsht-mobile-file-preview-img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 8px; }
.dsht-mobile-file-preview-fallback {
  padding: 24px 8px; text-align: center; font-size: 13px; line-height: 1.7;
  color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere;
}
`
