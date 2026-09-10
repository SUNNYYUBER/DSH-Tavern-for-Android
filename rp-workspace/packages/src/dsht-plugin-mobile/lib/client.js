window.__ModuleLoader__.load({ id: "dsht-plugin-mobile", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/src/dsht-plugin-mobile/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// packages/src/dsht-plugin-mobile/client/anchors.ts
var ANCHOR_ATTR = "data-dsht-mobile";
var ANCHOR_DEFS = [
  { anchor: "app-frame", strategy: "overlay-parent", selectors: [".pI_x6G_frame"] },
  { anchor: "sidebar-col", strategy: "first-child-of-frame", selectors: [".pI_x6G_sidebarCol"] },
  { anchor: "center-col", selectors: [".pI_x6G_centerCol"] },
  { anchor: "details-col", selectors: [".pI_x6G_detailsCol"] },
  { anchor: "drag-handle", selectors: [".pI_x6G_handle"] },
  { anchor: "settings-overlay", selectors: [".VOzbGW_overlay"] },
  { anchor: "settings-panel", selectors: [".VOzbGW_panel"] },
  { anchor: "settings-nav", selectors: [".VOzbGW_nav"] },
  { anchor: "settings-nav-title", selectors: [".VOzbGW_navTitle"] },
  { anchor: "settings-nav-list", selectors: [".VOzbGW_navList"] },
  { anchor: "settings-nav-cell", selectors: [".VOzbGW_navCell"] },
  { anchor: "settings-nav-label", selectors: [".VOzbGW_navLabel"] },
  { anchor: "settings-content", selectors: [".VOzbGW_content"] },
  { anchor: "settings-options", selectors: [".VOzbGW_options"] },
  { anchor: "sidebar-rail", selectors: [".hHd-Xa_railIn"] },
  { anchor: "rail-icon-button", selectors: [".hHd-Xa_iconButton"] },
  // 会话视图顶栏（2026-09-04 窄屏修复）：真机会话名长 → crumbs 不收缩盖住
  // headerActions（"Session log/子项计数"文字重叠，真机截图实证）；汉堡 fixed
  // 在左上又盖住 crumbs/tabs 左侧 → header 需 padding 让位 + crumbs 需可收缩。
  { anchor: "chat-header", selectors: [".wSkVaW_header"] },
  { anchor: "chat-title-row", selectors: [".wSkVaW_titleRow"] },
  { anchor: "chat-title-cluster", selectors: [".wSkVaW_titleCluster"] },
  { anchor: "chat-crumbs", selectors: [".wSkVaW_crumbs"] },
  { anchor: "chat-header-actions", selectors: [".wSkVaW_headerActions"] },
  { anchor: "chat-header-utilities", selectors: [".wSkVaW_headerUtilities"] }
];
function resolveAnchors(root) {
  let tagged = 0;
  const tag = (el, anchor) => {
    if (el === null) return;
    if (el.getAttribute(ANCHOR_ATTR) !== null) return;
    el.setAttribute(ANCHOR_ATTR, anchor);
    tagged += 1;
  };
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  let frame = null;
  for (const def of ANCHOR_DEFS) {
    if (def.strategy === "overlay-parent") {
      const overlay = all("[data-shell-overlay]")[0];
      tag(overlay?.parentElement ?? null, def.anchor);
      frame = overlay?.parentElement ?? all(`[${ANCHOR_ATTR}="${def.anchor}"]`)[0] ?? null;
    } else if (def.strategy === "first-child-of-frame") {
      const f = frame ?? all(`[${ANCHOR_ATTR}="app-frame"]`)[0] ?? null;
      tag(f?.firstElementChild ?? null, def.anchor);
    }
    for (const sel of def.selectors) for (const el of all(sel)) tag(el, def.anchor);
  }
  return tagged;
}
function installAnchors(doc) {
  resolveAnchors(doc);
  const body = doc.body;
  if (typeof MutationObserver === "undefined" || body === null) return () => {
  };
  let timer = null;
  let interval = 200;
  let lastScan = Date.now();
  const scan = () => {
    timer = null;
    lastScan = Date.now();
    const tagged = resolveAnchors(doc);
    interval = tagged > 0 ? 200 : Math.min(interval * 2, 1e3);
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(scan, Math.max(0, lastScan + interval - Date.now()));
  };
  const observer = new MutationObserver(schedule);
  observer.observe(body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

// packages/src/dsht-plugin-mobile/client/style.ts
var MOBILE_STYLE_ID = "dsht-plugin-mobile-style";
function ensureMobileStyle() {
  if (typeof document === "undefined" || document.getElementById(MOBILE_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = MOBILE_STYLE_ID;
  el.textContent = MOBILE_CSS;
  document.head.append(el);
}
var MOBILE_CSS = `
/* ===== dsht-plugin-mobile\uFF1ACSS \u4E94\u4EF6\u5957\uFF08\u53C2\u8003 dsh-client-ui-mobile-adapt v20\uFF0CMIT\uFF09===== */

/* \u6C49\u5821\u6309\u94AE\u4E0E\u906E\u7F69\u5728\u684C\u9762\u7AEF\u4E00\u5F8B\u9690\u85CF\uFF1B\u5E2D\u4F4D\u6839\u8282\u70B9\u81EA\u8EAB\u4E0D\u5403\u6307\u9488\uFF08overlay \u5E2D\u4F4D\u9ED8\u8BA4
   pointer-events:auto \u4F1A\u843D\u5230\u76F4\u63A5\u5B50\u8282\u70B9\u4E0A\u2014\u2014\u663E\u5F0F\u6536\u56DE\uFF0C\u53EA\u653E\u7ED9\u6309\u94AE/\u906E\u7F69\uFF09 */
.dsht-mobile-nav { pointer-events: none !important; }
.dsht-mobile-hamburger,
.dsht-mobile-scrim { display: none !important; }

/* \u89E6\u5C4F\u65E0 hover\uFF1A\u89D2\u8272\u5361\u8BBE\u7F6E\u89D2\u6807\u5E38\u663E\uFF08\u4ECE dsht-rp-ui/style.ts \u62BD\u79BB\u7684\u89E6\u5C4F\u89C4\u5219\uFF09 */
@media (hover: none) { .dsht-rp-card-gear { opacity: 1; } }

/* \u{1F4CE} \u9644\u4EF6\u4E0A\u4F20\u6309\u94AE\uFF08conversation.input.left \u5E2D\u4F4D\uFF09\uFF1A\u5BF9\u9F50\u539F\u751F\u56FE\u6807\u94AE\u7684\u89E6\u63A7\u5C3A\u5BF8\u4E0E\u6697\u8272\u89C2\u611F */
.dsht-mobile-attach {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 34px; height: 34px; padding: 0 6px;
  border: none; border-radius: 8px; background: transparent;
  font-size: 17px; line-height: 1; cursor: pointer; user-select: none;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsht-mobile-attach:active { background: var(--dsw-specific-bg-layer-hover, rgba(128, 128, 128, 0.18)); }

@media (max-width: 700px) {
  /* \u2460 \u52A8\u6001\u89C6\u53E3\uFF1A\u907F\u514D\u79FB\u52A8\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u906E\u6321\u5E95\u90E8\u8F93\u5165\u533A */
  html, body { height: 100dvh; }

  /* \u2461 grid \u8F68\u9053\u9501\u5B9A\uFF1A\u4E09\u680F\u7F51\u683C \u2192 \u53EA\u6709\u4E2D\u680F\u3002\u663E\u5F0F\u9501\u5B9A\u6BCF\u5217\u6240\u5C5E\u8F68\u9053\u2014\u2014
     \u4FA7\u680F\u8131\u79BB\u6587\u6863\u6D41\uFF08fixed\uFF09\u540E grid \u81EA\u52A8\u5E03\u5C40\u624D\u4E0D\u4F1A\u628A\u4E2D\u680F\u6324\u8FDB 0 \u5BBD\u8F68\u9053 */
  [data-dsht-mobile="app-frame"] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; transition: none !important; }
  [data-dsht-mobile="sidebar-col"] { grid-column: 1; }
  [data-dsht-mobile="center-col"] { grid-column: 2; }
  [data-dsht-mobile="details-col"] { grid-column: 3; display: none !important; }
  [data-dsht-mobile="drag-handle"] { display: none !important; }

  /* \u2462 \u5DE6\u4FA7\u62BD\u5C49\uFF1A\u7528 left \u4F4D\u79FB\u4E0D\u7528 transform\uFF08transform \u4F1A\u8BA9\u62BD\u5C49\u5185 fixed \u9762\u677F
     \u951A\u5B9A\u5230\u62BD\u5C49\u88AB\u88C1\u526A\uFF09\u3002\u663E\u9690\u8BFB\u5BBF\u4E3B\u81EA\u5E26\u72B6\u6001\u94A9\u5B50 [data-sidebar-collapsed] */
  [data-dsht-mobile="sidebar-col"] {
    position: fixed !important; top: 0; bottom: 0; left: -110%;
    width: min(320px, 86vw) !important; z-index: 40;
    transition: left .25s ease; box-shadow: 4px 0 24px rgb(0 0 0 / 30%);
  }
  [data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed]) [data-dsht-mobile="sidebar-col"] { left: 0; }
  /* \u4FA7\u680F\u5185\u5BB9\u7EC4\u4EF6\u586B\u6EE1\u62BD\u5C49\u5BBD\u5EA6 */
  [data-dsht-mobile="sidebar-col"] > :first-child { width: 100% !important; }

  /* \u2463 safe-area\uFF1A\u6C49\u5821\u907F\u5F00\u5218\u6D77/\u72B6\u6001\u680F */
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

  /* \u62BD\u5C49\u906E\u7F69\uFF1A\u4EC5\u62BD\u5C49\u6253\u5F00\u65F6\u663E\u793A\uFF08\u5BBF\u4E3B\u72B6\u6001\u94A9\u5B50\uFF09\uFF0C\u70B9\u6309\u5173\u95ED\u3002
     \u5B9E\u6D4B\u5751\uFF1A\u906E\u7F69\u5728 shell.overlay \u5E2D\u4F4D\u5C42\uFF0C\u4E0D\u662F app-frame \u7684\u540E\u4EE3\u2014\u2014\u540E\u4EE3\u9009\u62E9\u5668\u6C38\u8FDC
     \u4E0D\u547D\u4E2D\uFF0C\u62BD\u5C49\u6253\u5F00\u540E\u6CA1\u6709\u4EFB\u4F55\u5173\u95ED\u8DEF\u5F84\uFF08\u6C49\u5821\u4E5F\u88AB\u62BD\u5C49\u76D6\u4F4F\uFF09\u3002\u6539 :has() \u4ECE\u6839\u4E0A\u9009\u3002 */
  .dsht-mobile-scrim {
    display: none !important; position: fixed; inset: 0; z-index: 39;
    background: rgb(0 0 0 / 35%); pointer-events: auto;
  }
  body:has([data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed])) .dsht-mobile-scrim { display: block !important; }

  /* \u2464 \u89E6\u63A7\u76EE\u6807 \u226538px\uFF1A\u4FA7\u680F\u6298\u53E0 rail \u56FE\u6807\u6309\u94AE\u653E\u5927\uFF08\u62C7\u6307\u70B9\u6309\uFF09 */
  [data-dsht-mobile="sidebar-rail"] [data-dsht-mobile="rail-icon-button"] { width: 40px; height: 40px; }

  /* ---- \u8BBE\u7F6E\u9762\u677F\uFF08\u539F dsht-rp-ui/style.ts \u7684\u5BBF\u4E3B\u54C8\u5E0C\u7C7B\u540D hack\uFF0C\u951A\u70B9\u5316\u8FC1\u79FB\uFF09----
     \u5168\u5C4F + nav \u4ECE 84px \u7A84\u5217\u6539\u9876\u90E8\u6A2A\u5411\u6EDA\u52A8 tab \u6761\uFF0C\u5185\u5BB9\u533A\u5168\u5BBD\u3002
     \u684C\u9762\uFF08>700px\uFF09\u4E0D\u53D7\u672C\u5A92\u4F53\u67E5\u8BE2\u5F71\u54CD\u3002 */
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
  [data-dsht-mobile="settings-content"] { min-height: 0 !important; } /* \u5217\u5E03\u5C40\u4E0B\u8BA9 options \u533A\u53EF\u6EDA */
  [data-dsht-mobile="settings-options"] { padding: 0 14px 16px; }

  /* ---- RP \u7EC4\u4EF6\u7AD6\u5C4F\u89C4\u5219\uFF08\u4ECE dsht-rp-ui/style.ts R11 \u62BD\u79BB\uFF1B\u7EC4\u4EF6\u81EA\u6709\u7A33\u5B9A\u7C7B\u540D\uFF0C
     \u65E0 RP \u63D2\u4EF6\u65F6\u65E0\u5339\u914D\u5143\u7D20\u5373\u7A7A\u8F6C\uFF09---- */
  /* RP overlay\uFF1Asafe-area inset\uFF08\u2460\u2463 \u5BF9 RP \u9762\u7684\u843D\u5730\uFF09\u3002
     \u6CE8\u610F\uFF1Aoverlay \u6839\u662F fixed inset:0\uFF08dsht-rp-ui/style.ts L40\uFF09\u2014\u2014\u4E0D\u80FD\u518D\u8BBE height:100dvh
     \uFF08height \u4F1A\u8986\u76D6 bottom \u7EA6\u675F\uFF0C\u53E0\u52A0 safe-area padding \u540E\u603B\u9AD8 > \u89C6\u53E3\uFF1A384dp \u5B9E\u6D4B\u6EA2\u51FA
     47px\uFF0C2026-09-04 \u6392\u67E5\uFF09\u3002inset:0 \u5DF2\u5168\u5C4F\uFF0Cborder-box + padding \u8BA9\u5185\u5BB9\u907F\u5F00\u5B89\u5168\u533A\u3002 */
  .dsht-rp-overlay {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dsht-rp-topbar { flex-wrap: wrap; gap: 6px; padding: 8px 10px; }
  .dsht-rp-back { width: 44px; height: 44px; font-size: 22px; }
  /* tab \u680F\u72EC\u5360\u4E00\u884C\u5168\u5BBD\uFF0C\u89E6\u63A7\u76EE\u6807 44px */
  .dsht-rp-tabs { flex: 1 1 100%; gap: 6px; margin-left: 0; overflow-x: auto; }
  .dsht-rp-tab { flex: 1; height: 44px; border-radius: 12px; font-size: 14px; }

  /* \u89D2\u8272\u5BAB\u683C\uFF1A\u53CC\u5217\u81EA\u9002\u5E94\uFF08\u8D85\u7A84\u81EA\u52A8\u5355\u5217\uFF09\uFF0C\u5361\u7247\u5168\u5BBD */
  .dsht-rp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 12px; }
  .dsht-rp-card { padding: 14px; min-height: 44px; }
  .dsht-rp-card-gear { width: 36px; height: 36px; font-size: 16px; opacity: 1; }

  /* \u89D2\u8272\u8BE6\u60C5/\u5BFC\u51FA\u62BD\u5C49\uFF1A\u5168\u5C4F\uFF08\u4E0D\u518D\u5E95\u90E8 70%\uFF09 */
  .dsht-rp-drawer-mask { align-items: stretch; }
  .dsht-rp-drawer { max-height: none; height: 100%; border-radius: 0; border-top: none; }

  /* \u9884\u8BBE/\u6B63\u5219/\u5BFC\u5165/\u4E16\u754C\u4E66\u9762\u677F\uFF1A\u53BB max-width \u5C45\u4E2D\uFF0C\u5168\u5BBD */
  .dsht-rp-preset, .dsht-rp-regex, .dsht-rp-import, .dsht-rp-books { max-width: none; margin: 0; padding: 16px; }

  /* \u4E16\u754C\u4E66 chips \u89E6\u63A7\u76EE\u6807 44px */
  .wb-row { min-height: 44px; }
  .wb-chip { min-height: 44px; padding: 8px 16px; font-size: 14px; border-radius: 22px; }

  /* \u89E6\u63A7\u76EE\u6807\u653E\u5927\uFF08\u2464 \u5BF9 RP \u9762\u7684\u843D\u5730\uFF09 */
  .dsht-rp-btn { min-height: 44px; }
  .dsht-rp-action-btn { min-height: 44px; }
  .dsht-rp-preset-toggle .pt-opt { padding: 6px 12px; min-height: 36px; }
  .rx-toggle span { width: 40px; height: 22px; border-radius: 11px; }
  .rx-toggle span::after { width: 18px; height: 18px; }
  .rx-toggle input:checked + span::after { transform: translateX(18px); }
  .rx-del { width: 36px; height: 36px; font-size: 15px; }
  .dsht-rp-regex-row { padding: 10px 0; flex-wrap: wrap; }

  /* \u804A\u5929\u6D88\u606F\u533A 480px \u9650\u5236\u7AD6\u5C4F\u653E\u5F00 */
  .dsht-rp-statusbar, .dsht-rp-actions, .dsht-rp-reasoning, .dsht-rp-mvu-statusbar,
  .dsht-rp-collapsible, .dsht-rp-state-update, .dsht-rp-foreshadowing { max-width: 100%; }

  /* \u7AD6\u5C4F\u89E6\u63A7\u76EE\u6807\u653E\u5927\uFF08\u56DE\u9000\u6309\u94AE / \u9884\u8BBE\u6761\u76EE\u5C55\u5F00\u94AE\uFF09 */
  .dsht-rp-rollback-btn { height: 36px; font-size: 12px; }
  .pe-expand { width: 40px; height: 40px; font-size: 15px; }
  .dsht-rp-user-stack { max-width: 92%; }

  /* \u4E3B\u4F1A\u8BDD\u8FC7\u7A0B\u6298\u53E0\u6807\u9898\u884C\uFF1A\u89E6\u63A7\u76EE\u6807 44px */
  .dsht-fold-header { min-height: 44px; font-size: 13px; }

  /* \u5F00\u573A\u767D dock \u7A84\u5C4F */
  .dsht-rp-greeting-dock { margin: 0 8px 6px; }
  .dsht-rp-greeting-dock .dsht-rp-btn { min-height: 44px; }

  /* ---- \u4F1A\u8BDD\u9876\u680F\u7A84\u5C4F\u4FEE\u590D\uFF082026-09-04 \u771F\u673A\u622A\u56FE\u5B9E\u8BC1\uFF0C\u4E24\u8F6E\u8FED\u4EE3\uFF09----
     \u6C49\u5821 fixed \u5728\u5DE6\u4E0A\uFF0812px \u8D77\uFF09\u2192 header \u5185\u5BB9\u6574\u4F53\u8BA9\u4F4D\uFF1B\u591A\u7EA7\u9762\u5305\u5C51\uFF08\u5DE5\u4F5C\u533A +
     \u4F1A\u8BDD\u540D\uFF09\u5728 408dp \u653E\u4E0D\u4E0B \u2192 titleRow \u5141\u8BB8\u6362\u884C\uFF08\u9762\u5305\u5C51\u4E00\u884C\u3001actions/utilities
     \u4E00\u884C\uFF09\uFF0Ccrumb \u81EA\u5E26 max-width 220 + ellipsis\uFF0C\u4E0D\u518D\u4E0E "Session log/\u5B50\u9879\u8BA1\u6570"
     \u53E0\u5370\u3002\u539F\u751F crumbs \u672C\u5C31 min-width:0 + overflow:hidden\uFF0C\u518D\u663E\u5F0F\u8865\u5F3A\uFF08\u5353\u6613\u901A
     \u8001\u5185\u6838 flex \u6536\u7F29\u5B9E\u73B0\u6709\u5DEE\u5F02\uFF09\u3002\u5168\u90E8\u8D70 anchors.ts \u9876\u680F\u951A\u70B9\uFF08CSS \u96F6\u54C8\u5E0C\u7C7B\u540D\uFF09\u3002 */
  [data-dsht-mobile="chat-header"] { padding: 4px 8px 0 52px !important; }
  [data-dsht-mobile="chat-title-row"] {
    flex-wrap: wrap !important;
    row-gap: 2px;
  }
  [data-dsht-mobile="chat-title-cluster"] { flex: 1 1 100% !important; }
  [data-dsht-mobile="chat-crumbs"] { min-width: 0 !important; max-width: 100%; }
  [data-dsht-mobile="chat-header-actions"],
  [data-dsht-mobile="chat-header-utilities"] { margin-left: 8px !important; }
  /* \u6C49\u5821\uFF08body \u5C42 fixed\uFF09\u843D\u5728 header \u5DE6\u4FA7 padding \u8BA9\u51FA\u7684\u7A7A\u4F4D\u5185\uFF0C\u4E0E crumb \u884C\u5BF9\u9F50 */
  .dsht-mobile-hamburger { top: max(8px, env(safe-area-inset-top, 0px)); }
}

/* ---- I6 \u6587\u4EF6\u5F15\u7528\u5168\u5C4F\u9884\u89C8\u62BD\u5C49\uFF08file-preview.ts \u6253\u5F00\uFF1B\u7A84\u5C4F\u62E6\u622A tap \u624D\u4F1A\u89E6\u53D1\uFF0C
   \u684C\u9762\u65E0\u5B9E\u4F8B\u96F6\u5F71\u54CD\uFF1Bsafe-area \u907F\u8BA9\u5BF9\u9F50 \u2460\u2463\uFF09---- */
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
`;

// packages/src/dsht-plugin-mobile/client/file-preview.ts
var PREVIEW_Z = 2200;
var FETCH_CAP = 256 * 1024;
function findPreviewTarget(el) {
  if (el === null) return null;
  const mention = el.closest('button[class*="fileMention"]');
  if (mention !== null) {
    const title = mention.getAttribute("title") ?? "";
    const text = (mention.textContent ?? "").trim();
    const url = /^https?:\/\//.test(title) || title.startsWith("/") ? title : null;
    return { kind: "mention", name: text !== "" ? text : title, url };
  }
  const link = el.closest("a[href]");
  if (link !== null) {
    const href = link.getAttribute("href") ?? "";
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin) return null;
      if (!/\.[\w]+$/.test(u.pathname)) return null;
      return { kind: "link", name: decodeURIComponent(u.pathname.split("/").pop() ?? ""), url: u.href };
    } catch {
      return null;
    }
  }
  return null;
}
var TEXT_PATH_RE = /\.(md|txt|json|ya?ml|log|csv|tsv|js|ts|jsx|tsx|css|html?|xml|py|rb|go|rs|java|c|h|cpp|sh|bat|ps1|toml|ini|conf|ejs|lua)$/i;
function looksTextual(contentType, path) {
  if (TEXT_PATH_RE.test(path)) return true;
  if (/^text\//i.test(contentType) && /\.[\w]+$/.test(path)) return true;
  return /^(application\/(json|xml|javascript|yaml|x-yaml))/i.test(contentType) && path !== "/";
}
function imageLike(path) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
}
var previewHost = null;
function openPreview(name, content) {
  closePreview();
  const root = document.createElement("div");
  root.className = "dsht-mobile-file-preview";
  root.style.zIndex = String(PREVIEW_Z);
  const panel = document.createElement("div");
  panel.className = "dsht-mobile-file-preview-panel";
  const head = document.createElement("div");
  head.className = "dsht-mobile-file-preview-head";
  const title = document.createElement("span");
  title.className = "dsht-mobile-file-preview-title";
  title.textContent = name !== "" ? name : "\u6587\u4EF6";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "dsht-mobile-file-preview-close";
  close.setAttribute("aria-label", "\u5173\u95ED\u9884\u89C8");
  close.textContent = "\u2715";
  close.addEventListener("click", closePreview);
  head.append(title, close);
  const body = document.createElement("div");
  body.className = "dsht-mobile-file-preview-body";
  if (content === null) {
    const note = document.createElement("div");
    note.className = "dsht-mobile-file-preview-fallback";
    note.textContent = `\u8BE5\u6587\u4EF6\u7C7B\u578B\u8BF7\u5728\u7535\u8111\u7AEF\u67E5\u770B\uFF1A${name !== "" ? name : "\u672A\u77E5\u6587\u4EF6"}`;
    body.append(note);
  } else if (content.kind === "text") {
    const pre = document.createElement("pre");
    pre.className = "dsht-mobile-file-preview-text";
    pre.textContent = content.value;
    body.append(pre);
  } else {
    const img = document.createElement("img");
    img.className = "dsht-mobile-file-preview-img";
    img.src = content.url;
    img.alt = name;
    body.append(img);
  }
  panel.append(head, body);
  root.append(panel);
  root.addEventListener("click", (e) => {
    if (e.target === root) closePreview();
  });
  document.body.append(root);
  previewHost = root;
}
function closePreview() {
  previewHost?.remove();
  previewHost = null;
}
function installFilePreview(doc) {
  const narrow = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
  const onClick = (e) => {
    if (!narrow()) return;
    const target = e.target;
    const hit = findPreviewTarget(target);
    if (hit === null) return;
    e.preventDefault();
    e.stopPropagation();
    openPreview(hit.name, null);
    if (hit.url === null) return;
    const url = hit.url;
    const path = new URL(url, location.href).pathname;
    if (imageLike(path)) {
      openPreview(hit.name, { kind: "image", url });
      return;
    }
    void (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const type = resp.headers.get("content-type") ?? "";
        if (!looksTextual(type, path)) throw new Error("not textual");
        const text = await resp.text();
        openPreview(hit.name, {
          kind: "text",
          value: text.length > FETCH_CAP ? `${text.slice(0, FETCH_CAP)}
\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u5185\u5BB9\u8BF7\u5728\u7535\u8111\u7AEF\u67E5\u770B\uFF09` : text
        });
      } catch {
      }
    })();
  };
  doc.addEventListener("click", onClick, true);
  return () => {
    doc.removeEventListener("click", onClick, true);
    closePreview();
  };
}

// packages/src/dsht-plugin-mobile/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var booted = false;
function boot() {
  if (booted || typeof document === "undefined") return;
  booted = true;
  ensureMobileStyle();
  installAnchors(document);
  installDetailsToggleProxy();
  installFilePreview(document);
}
function installDetailsToggleProxy() {
  document.addEventListener("click", (e) => {
    const target = e.target;
    const summary = target?.closest?.("summary") ?? null;
    if (summary === null) return;
    const details = summary.parentElement;
    if (details === null || details.tagName !== "DETAILS") return;
    e.preventDefault();
    e.stopPropagation();
    details.open = !details.open;
  }, true);
}
boot();
function MobileNav({ toggle }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsht-mobile-nav", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "dsht-mobile-hamburger",
        "aria-label": "\u6253\u5F00\u4FA7\u8FB9\u680F",
        onClick: () => toggle?.(),
        children: "\u2630"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsht-mobile-scrim", onClick: () => toggle?.() })
  ] });
}
function MobileAttach() {
  const onClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      try {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      } catch {
      }
    };
    input.click();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsht-mobile-attach", "aria-label": "\u6DFB\u52A0\u56FE\u7247", onClick, children: "\u{1F4CE}" });
}
var inject = ["slots", "layout"];
function apply(ctx) {
  boot();
  ctx.effect(() => ctx.slots.inject("conversation.input.left", () => ctx.slots.register(
    { name: "conversation.input.left", id: "dsht-mobile-attach", order: 10 },
    MobileAttach
  )), "dsht-plugin-mobile: attach button");
  if (typeof ctx.layout?.toggleSidebar !== "function") return;
  const toggle = () => ctx.layout?.toggleSidebar?.();
  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
    { name: "shell.overlay", id: "dsht-mobile-nav", order: -10, inject: () => ({ toggle }) },
    MobileNav
  )), "dsht-plugin-mobile: nav overlay");
  const closeDrawerOnRpOpen = () => {
    const frame = document.querySelector('[data-dsht-mobile="app-frame"]');
    if (frame && !frame.hasAttribute("data-sidebar-collapsed")) toggle();
  };
  window.addEventListener("dsht-rp-ui:open", closeDrawerOnRpOpen);
  ctx.effect(() => () => window.removeEventListener("dsht-rp-ui:open", closeDrawerOnRpOpen), "dsht-plugin-mobile: rp-open listener");
}
return module.exports; } });
