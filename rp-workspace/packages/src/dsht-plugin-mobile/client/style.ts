/**
 * dsht-plugin-mobile 移动端样式：CSS 五件套 + 宿主锚点消费面。
 *
 * 五件套（把桌面形态的宿主 UI 拉进手机视口所需的最小集合）：
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
/* 【2026-09-14 第二十轮 · 已删除一条跨包规则】
 * 原为：@media (hover: none) { .dsht-rp-card-gear { opacity: 1; } }
 * 删除理由（P-26）：.dsht-rp-card-gear 是 **dsht-rp-ui 自有组件**，
 * 该规则与 rp-ui 的桌面基线属**同特异性**（0,1,0），而本文件注入**先于** rp-ui
 * ⇒ 胜负由注入顺序决定（不可靠）。且其意图（触屏下齿轮钮常显）已由
 * rp-ui 自己的 (pointer: coarse) 段承载：.dsht-rp-card-gear 带 opacity: 1 !important
 * ——**同属性、同包内、且带 !important**，覆盖力更强 ⇒ 本条属冗余且不可靠的死规则。
 * 机器化防线：scripts/audit-cross-package-css.mjs（A15）。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */

/* 📎 附件上传按钮（conversation.input.left 席位）：对齐原生图标钮的触控尺寸与暗色观感 */
/* 【2026-09-14 L1 穷举修复】原为 34×34（低于 38 底线 ⇒ 拇指必然误触，P1）。
 * 注意这条**在媒体查询之外**（全局生效），所以桌面端也跟着放大——这是可接受的：
 * 38 是拇指下限，桌面端多 4px 不产生任何副作用，换来的是「不会在手机上出问题」。
 *
 * 【2026-09-14 第十九/二十轮二次修正】38 → **44**。
 * 依据：设备探针 scripts/ef-touch-targets.mjs 穷举我方可点元素时实测本钮 **38×38**，
 * 属「过底线但未达目标」的 P2 项。**取 44 而非留 38 的理由**：38 是「能不能用」的下限，
 * 38 意味着零余量；而 §二 L1 的两级口径里 44 才是目标值。既然要动就一步到位。
 * 同批修正的还有 .dsht-mobile-hamburger（40 → 44，见下方）。 */
.dsht-mobile-attach {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; height: 44px; padding: 0 6px; flex-shrink: 0;
  border: none; border-radius: 8px; background: transparent;
  font-size: 17px; line-height: 1; cursor: pointer; user-select: none;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsht-mobile-attach:active { background: var(--dsw-specific-bg-layer-hover, rgba(128, 128, 128, 0.18)); }

/* 【L2「竖屏 / 横屏」格 · 2026-09-14 第十七轮 设备实测修复】
 *
 * ## 症状（设备实测，'scripts/ef-orientation.mjs'）
 * 手机**横屏**时（1080x2400 @440dpi 转屏 ⇒ CSS 视口 873×345）：
 *   '(max-width: 700px)' = **false**、'(pointer: coarse)' = **true**
 *   ⇒ 下面整段「五件套」**整体失效**：汉堡 'display:none'（实测 hamVisible=false）、
 *     侧栏从 fixed 抽屉**退回静态三栏**（实测 position: static）、grid 轨道锁定失效。
 *   净效果 = **桌面三栏布局被塞进 345px 高的视口**。
 *
 * ## 根因（架构层 / P-1）
 * 把「**手机**」这个**设备属性**用「**视口宽度**」这个**几何属性**表达。二者可以分离
 * ——最典型的就是手机横屏。而本仓**同一语义存在两套判据**：
 *   · 本文件（旧）：'max-width: 700px'  ← 横屏失配
 *   · 'dsht-rp-ui/client/style.ts'：'(pointer: coarse)' ← 正确（触屏属性）
 * 这正是 P-1 的运行时形态：修了一处（rp-ui）而另一处（本文件的五件套）仍是坏的。
 *
 * ## 修法（取并集，不删既有能力 —— 守 B10）
 * '@media (max-width: 700px), (pointer: coarse)'：宽度**或**触屏属性任一成立即生效。
 *   · 手机竖屏：两者都成立 ⇒ 行为与修前**完全一致**（零回归）
 *   · 手机横屏：粗指针成立 ⇒ 五件套恢复生效（本修的目标）
 *   · 桌面（鼠标）：两者都不成立 ⇒ 桌面形态不变（'pointer' 指主指针设备，触屏笔记本
 *     的主指针仍是鼠标 ⇒ 通常报 fine，不会被误判为手机）
 * 选并集而非直接换成 coarse：窄桌面窗口（<700px）当前也在享受这套适配，
 * 换成 coarse 会把那条能力**删掉**（B10 禁止删能力）。
 *
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
@media (max-width: 700px), (pointer: coarse) {
  /* ① 动态视口：避免移动浏览器工具栏遮挡底部输入区 */
  html, body { height: 100dvh; }

  /* 【L2 2026-09-14 字号缩放修复】抑制 Android WebView 的 text autosizing。
   * 本插件覆盖的所有组件布局尺寸均为硬编码 px（见 L2 穷举清单），字号被按宽度放大而
   * 盒模型不跟随 ⇒ 溢出与点击区错位。取 100% 保留系统级字体设置意图。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
  html, body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

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

  /* ④ safe-area：汉堡避开刘海/状态栏
   * 【2026-09-14 第二十轮】40 → **44**：设备探针 ef-touch-targets.mjs 实测 40×40
   * （P2 未达目标值 44）。归属原则：本组件属本包 ⇒ 放大规则写在本包内（R17/P-1）。 */
  .dsht-mobile-hamburger {
    display: grid !important; position: fixed;
    top: max(10px, env(safe-area-inset-top, 0px));
    left: max(12px, env(safe-area-inset-left, 0px));
    z-index: 41; width: 44px; height: 44px; flex-shrink: 0;
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

  /* ---- （已迁出）RP 组件竖屏规则 ----
   *
   * 【2026-09-14 第二十轮 · 架构层收口】本节原有约 27 条 '.dsht-rp-*' 规则，
   * 现**全部迁到 dsht-rp-ui 自己的 client/style.ts 的 (pointer: coarse) 段**。
   *
   * ## 为什么必须迁走（设备实测，P-26 的「同特异性靠注入顺序」形态）
   * 本节这些规则与 rp-ui 的桌面基线**特异性相同**（都是 0,1,0 = 100），
   * 而本文件注入为 dsht-plugin-mobile-style、**先于** dsht-rp-ui-style
   * ⇒ 同特异性下**后写者胜** ⇒ 本节的声明**全部被覆盖**。
   *
   * 设备实测（CDP 枚举「匹配且 media 生效」的全部规则 + 实际渲染值）：
   *   .dsht-rp-back        本文件 44px  vs  rp-ui 32px  ⇒ 实测 **32px**（本节死）
   *   .dsht-rp-tab         本文件 44px  vs  rp-ui 28px  ⇒ 实测 **28px**（本节死）
   *   .dsht-rp-card-gear   本文件 38px  vs  rp-ui 26px  ⇒ 实测 **26px**（本节死）
   *   .dsht-rp-user-stack  本文件 92%   vs  rp-ui min(525px,82%) ⇒ 实测 **82% 档**（本节死）
   *   .dsht-rp-grid        gap 10px     vs  rp-ui 12px  ⇒ 实测 **12px**（本节死）
   * 其中 '.dsht-rp-back'(32) 与 '.dsht-rp-card-gear'(26) **低于 38px 拇指底线**（P1 级）。
   *
   * ## 结论（已固化为纪律）
   * **跨包写对方自有组件的类名规则一律无效/不可靠** —— 无论特异性高低，
   * 都取决于注入顺序。⇒ 只允许跨包写**宿主锚点**（'[data-dsht-mobile]'，
   * 由 anchors.ts 单点维护）。本节的宿主锚点规则（chat-header 等）**保留在本文件**。
   *
   * 迁移去向：dsht-rp-ui/src/client/style.ts 的 (pointer: coarse) 段
   * —— 见那里标题为「从 dsht-plugin-mobile 迁入」的块。 */

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
