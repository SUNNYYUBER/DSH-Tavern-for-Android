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

// ../packages/src/dsht-plugin-mobile/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// ../packages/src/dsht-plugin-mobile/client/anchors.ts
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

// ../packages/src/dsht-plugin-mobile/client/style.ts
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
/* \u30102026-09-14 \u7B2C\u4E8C\u5341\u8F6E \xB7 \u5DF2\u5220\u9664\u4E00\u6761\u8DE8\u5305\u89C4\u5219\u3011
 * \u539F\u4E3A\uFF1A@media (hover: none) { .dsht-rp-card-gear { opacity: 1; } }
 * \u5220\u9664\u7406\u7531\uFF08P-26\uFF09\uFF1A.dsht-rp-card-gear \u662F **dsht-rp-ui \u81EA\u6709\u7EC4\u4EF6**\uFF0C
 * \u8BE5\u89C4\u5219\u4E0E rp-ui \u7684\u684C\u9762\u57FA\u7EBF\u5C5E**\u540C\u7279\u5F02\u6027**\uFF080,1,0\uFF09\uFF0C\u800C\u672C\u6587\u4EF6\u6CE8\u5165**\u5148\u4E8E** rp-ui
 * \u21D2 \u80DC\u8D1F\u7531\u6CE8\u5165\u987A\u5E8F\u51B3\u5B9A\uFF08\u4E0D\u53EF\u9760\uFF09\u3002\u4E14\u5176\u610F\u56FE\uFF08\u89E6\u5C4F\u4E0B\u9F7F\u8F6E\u94AE\u5E38\u663E\uFF09\u5DF2\u7531
 * rp-ui \u81EA\u5DF1\u7684 (pointer: coarse) \u6BB5\u627F\u8F7D\uFF1A.dsht-rp-card-gear \u5E26 opacity: 1 !important
 * \u2014\u2014**\u540C\u5C5E\u6027\u3001\u540C\u5305\u5185\u3001\u4E14\u5E26 !important**\uFF0C\u8986\u76D6\u529B\u66F4\u5F3A \u21D2 \u672C\u6761\u5C5E\u5197\u4F59\u4E14\u4E0D\u53EF\u9760\u7684\u6B7B\u89C4\u5219\u3002
 * \u673A\u5668\u5316\u9632\u7EBF\uFF1Ascripts/audit-cross-package-css.mjs\uFF08A15\uFF09\u3002
 * \u6CE8\u610F\uFF1A\u672C\u6587\u4EF6\u662F TS \u6A21\u677F\u4E32\uFF0C\u6CE8\u91CA\u91CC**\u4E0D\u80FD\u51FA\u73B0\u53CD\u5F15\u53F7**\u3002 */

/* \u{1F4CE} \u9644\u4EF6\u4E0A\u4F20\u6309\u94AE\uFF08conversation.input.left \u5E2D\u4F4D\uFF09\uFF1A\u5BF9\u9F50\u539F\u751F\u56FE\u6807\u94AE\u7684\u89E6\u63A7\u5C3A\u5BF8\u4E0E\u6697\u8272\u89C2\u611F */
/* \u30102026-09-14 L1 \u7A77\u4E3E\u4FEE\u590D\u3011\u539F\u4E3A 34\xD734\uFF08\u4F4E\u4E8E 38 \u5E95\u7EBF \u21D2 \u62C7\u6307\u5FC5\u7136\u8BEF\u89E6\uFF0CP1\uFF09\u3002
 * \u6CE8\u610F\u8FD9\u6761**\u5728\u5A92\u4F53\u67E5\u8BE2\u4E4B\u5916**\uFF08\u5168\u5C40\u751F\u6548\uFF09\uFF0C\u6240\u4EE5\u684C\u9762\u7AEF\u4E5F\u8DDF\u7740\u653E\u5927\u2014\u2014\u8FD9\u662F\u53EF\u63A5\u53D7\u7684\uFF1A
 * 38 \u662F\u62C7\u6307\u4E0B\u9650\uFF0C\u684C\u9762\u7AEF\u591A 4px \u4E0D\u4EA7\u751F\u4EFB\u4F55\u526F\u4F5C\u7528\uFF0C\u6362\u6765\u7684\u662F\u300C\u4E0D\u4F1A\u5728\u624B\u673A\u4E0A\u51FA\u95EE\u9898\u300D\u3002
 *
 * \u30102026-09-14 \u7B2C\u5341\u4E5D/\u4E8C\u5341\u8F6E\u4E8C\u6B21\u4FEE\u6B63\u301138 \u2192 **44**\u3002
 * \u4F9D\u636E\uFF1A\u8BBE\u5907\u63A2\u9488 scripts/ef-touch-targets.mjs \u7A77\u4E3E\u6211\u65B9\u53EF\u70B9\u5143\u7D20\u65F6\u5B9E\u6D4B\u672C\u94AE **38\xD738**\uFF0C
 * \u5C5E\u300C\u8FC7\u5E95\u7EBF\u4F46\u672A\u8FBE\u76EE\u6807\u300D\u7684 P2 \u9879\u3002**\u53D6 44 \u800C\u975E\u7559 38 \u7684\u7406\u7531**\uFF1A38 \u662F\u300C\u80FD\u4E0D\u80FD\u7528\u300D\u7684\u4E0B\u9650\uFF0C
 * 38 \u610F\u5473\u7740\u96F6\u4F59\u91CF\uFF1B\u800C \xA7\u4E8C L1 \u7684\u4E24\u7EA7\u53E3\u5F84\u91CC 44 \u624D\u662F\u76EE\u6807\u503C\u3002\u65E2\u7136\u8981\u52A8\u5C31\u4E00\u6B65\u5230\u4F4D\u3002
 * \u540C\u6279\u4FEE\u6B63\u7684\u8FD8\u6709 .dsht-mobile-hamburger\uFF0840 \u2192 44\uFF0C\u89C1\u4E0B\u65B9\uFF09\u3002 */
.dsht-mobile-attach {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; height: 44px; padding: 0 6px; flex-shrink: 0;
  border: none; border-radius: 8px; background: transparent;
  font-size: 17px; line-height: 1; cursor: pointer; user-select: none;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsht-mobile-attach:active { background: var(--dsw-specific-bg-layer-hover, rgba(128, 128, 128, 0.18)); }

/* \u3010L2\u300C\u7AD6\u5C4F / \u6A2A\u5C4F\u300D\u683C \xB7 2026-09-14 \u7B2C\u5341\u4E03\u8F6E \u8BBE\u5907\u5B9E\u6D4B\u4FEE\u590D\u3011
 *
 * ## \u75C7\u72B6\uFF08\u8BBE\u5907\u5B9E\u6D4B\uFF0C'scripts/ef-orientation.mjs'\uFF09
 * \u624B\u673A**\u6A2A\u5C4F**\u65F6\uFF081080x2400 @440dpi \u8F6C\u5C4F \u21D2 CSS \u89C6\u53E3 873\xD7345\uFF09\uFF1A
 *   '(max-width: 700px)' = **false**\u3001'(pointer: coarse)' = **true**
 *   \u21D2 \u4E0B\u9762\u6574\u6BB5\u300C\u4E94\u4EF6\u5957\u300D**\u6574\u4F53\u5931\u6548**\uFF1A\u6C49\u5821 'display:none'\uFF08\u5B9E\u6D4B hamVisible=false\uFF09\u3001
 *     \u4FA7\u680F\u4ECE fixed \u62BD\u5C49**\u9000\u56DE\u9759\u6001\u4E09\u680F**\uFF08\u5B9E\u6D4B position: static\uFF09\u3001grid \u8F68\u9053\u9501\u5B9A\u5931\u6548\u3002
 *   \u51C0\u6548\u679C = **\u684C\u9762\u4E09\u680F\u5E03\u5C40\u88AB\u585E\u8FDB 345px \u9AD8\u7684\u89C6\u53E3**\u3002
 *
 * ## \u6839\u56E0\uFF08\u67B6\u6784\u5C42 / P-1\uFF09
 * \u628A\u300C**\u624B\u673A**\u300D\u8FD9\u4E2A**\u8BBE\u5907\u5C5E\u6027**\u7528\u300C**\u89C6\u53E3\u5BBD\u5EA6**\u300D\u8FD9\u4E2A**\u51E0\u4F55\u5C5E\u6027**\u8868\u8FBE\u3002\u4E8C\u8005\u53EF\u4EE5\u5206\u79BB
 * \u2014\u2014\u6700\u5178\u578B\u7684\u5C31\u662F\u624B\u673A\u6A2A\u5C4F\u3002\u800C\u672C\u4ED3**\u540C\u4E00\u8BED\u4E49\u5B58\u5728\u4E24\u5957\u5224\u636E**\uFF1A
 *   \xB7 \u672C\u6587\u4EF6\uFF08\u65E7\uFF09\uFF1A'max-width: 700px'  \u2190 \u6A2A\u5C4F\u5931\u914D
 *   \xB7 'dsht-rp-ui/client/style.ts'\uFF1A'(pointer: coarse)' \u2190 \u6B63\u786E\uFF08\u89E6\u5C4F\u5C5E\u6027\uFF09
 * \u8FD9\u6B63\u662F P-1 \u7684\u8FD0\u884C\u65F6\u5F62\u6001\uFF1A\u4FEE\u4E86\u4E00\u5904\uFF08rp-ui\uFF09\u800C\u53E6\u4E00\u5904\uFF08\u672C\u6587\u4EF6\u7684\u4E94\u4EF6\u5957\uFF09\u4ECD\u662F\u574F\u7684\u3002
 *
 * ## \u4FEE\u6CD5\uFF08\u53D6\u5E76\u96C6\uFF0C\u4E0D\u5220\u65E2\u6709\u80FD\u529B \u2014\u2014 \u5B88 B10\uFF09
 * '@media (max-width: 700px), (pointer: coarse)'\uFF1A\u5BBD\u5EA6**\u6216**\u89E6\u5C4F\u5C5E\u6027\u4EFB\u4E00\u6210\u7ACB\u5373\u751F\u6548\u3002
 *   \xB7 \u624B\u673A\u7AD6\u5C4F\uFF1A\u4E24\u8005\u90FD\u6210\u7ACB \u21D2 \u884C\u4E3A\u4E0E\u4FEE\u524D**\u5B8C\u5168\u4E00\u81F4**\uFF08\u96F6\u56DE\u5F52\uFF09
 *   \xB7 \u624B\u673A\u6A2A\u5C4F\uFF1A\u7C97\u6307\u9488\u6210\u7ACB \u21D2 \u4E94\u4EF6\u5957\u6062\u590D\u751F\u6548\uFF08\u672C\u4FEE\u7684\u76EE\u6807\uFF09
 *   \xB7 \u684C\u9762\uFF08\u9F20\u6807\uFF09\uFF1A\u4E24\u8005\u90FD\u4E0D\u6210\u7ACB \u21D2 \u684C\u9762\u5F62\u6001\u4E0D\u53D8\uFF08'pointer' \u6307\u4E3B\u6307\u9488\u8BBE\u5907\uFF0C\u89E6\u5C4F\u7B14\u8BB0\u672C
 *     \u7684\u4E3B\u6307\u9488\u4ECD\u662F\u9F20\u6807 \u21D2 \u901A\u5E38\u62A5 fine\uFF0C\u4E0D\u4F1A\u88AB\u8BEF\u5224\u4E3A\u624B\u673A\uFF09
 * \u9009\u5E76\u96C6\u800C\u975E\u76F4\u63A5\u6362\u6210 coarse\uFF1A\u7A84\u684C\u9762\u7A97\u53E3\uFF08<700px\uFF09\u5F53\u524D\u4E5F\u5728\u4EAB\u53D7\u8FD9\u5957\u9002\u914D\uFF0C
 * \u6362\u6210 coarse \u4F1A\u628A\u90A3\u6761\u80FD\u529B**\u5220\u6389**\uFF08B10 \u7981\u6B62\u5220\u80FD\u529B\uFF09\u3002
 *
 * \u6CE8\u610F\uFF1A\u672C\u6587\u4EF6\u662F TS \u6A21\u677F\u4E32\uFF0C\u6CE8\u91CA\u91CC**\u4E0D\u80FD\u51FA\u73B0\u53CD\u5F15\u53F7**\u3002 */
@media (max-width: 700px), (pointer: coarse) {
  /* \u2460 \u52A8\u6001\u89C6\u53E3\uFF1A\u907F\u514D\u79FB\u52A8\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u906E\u6321\u5E95\u90E8\u8F93\u5165\u533A */
  html, body { height: 100dvh; }

  /* \u3010L2 2026-09-14 \u5B57\u53F7\u7F29\u653E\u4FEE\u590D\u3011\u6291\u5236 Android WebView \u7684 text autosizing\u3002
   * \u672C\u63D2\u4EF6\u8986\u76D6\u7684\u6240\u6709\u7EC4\u4EF6\u5E03\u5C40\u5C3A\u5BF8\u5747\u4E3A\u786C\u7F16\u7801 px\uFF08\u89C1 L2 \u7A77\u4E3E\u6E05\u5355\uFF09\uFF0C\u5B57\u53F7\u88AB\u6309\u5BBD\u5EA6\u653E\u5927\u800C
   * \u76D2\u6A21\u578B\u4E0D\u8DDF\u968F \u21D2 \u6EA2\u51FA\u4E0E\u70B9\u51FB\u533A\u9519\u4F4D\u3002\u53D6 100% \u4FDD\u7559\u7CFB\u7EDF\u7EA7\u5B57\u4F53\u8BBE\u7F6E\u610F\u56FE\u3002
   * \u6CE8\u610F\uFF1A\u672C\u6587\u4EF6\u662F TS \u6A21\u677F\u4E32\uFF0C\u6CE8\u91CA\u91CC**\u4E0D\u80FD\u51FA\u73B0\u53CD\u5F15\u53F7**\u3002 */
  html, body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

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

  /* \u2463 safe-area\uFF1A\u6C49\u5821\u907F\u5F00\u5218\u6D77/\u72B6\u6001\u680F
   * \u30102026-09-14 \u7B2C\u4E8C\u5341\u8F6E\u301140 \u2192 **44**\uFF1A\u8BBE\u5907\u63A2\u9488 ef-touch-targets.mjs \u5B9E\u6D4B 40\xD740
   * \uFF08P2 \u672A\u8FBE\u76EE\u6807\u503C 44\uFF09\u3002\u5F52\u5C5E\u539F\u5219\uFF1A\u672C\u7EC4\u4EF6\u5C5E\u672C\u5305 \u21D2 \u653E\u5927\u89C4\u5219\u5199\u5728\u672C\u5305\u5185\uFF08R17/P-1\uFF09\u3002 */
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

  /* ---- \uFF08\u5DF2\u8FC1\u51FA\uFF09RP \u7EC4\u4EF6\u7AD6\u5C4F\u89C4\u5219 ----
   *
   * \u30102026-09-14 \u7B2C\u4E8C\u5341\u8F6E \xB7 \u67B6\u6784\u5C42\u6536\u53E3\u3011\u672C\u8282\u539F\u6709\u7EA6 27 \u6761 '.dsht-rp-*' \u89C4\u5219\uFF0C
   * \u73B0**\u5168\u90E8\u8FC1\u5230 dsht-rp-ui \u81EA\u5DF1\u7684 client/style.ts \u7684 (pointer: coarse) \u6BB5**\u3002
   *
   * ## \u4E3A\u4EC0\u4E48\u5FC5\u987B\u8FC1\u8D70\uFF08\u8BBE\u5907\u5B9E\u6D4B\uFF0CP-26 \u7684\u300C\u540C\u7279\u5F02\u6027\u9760\u6CE8\u5165\u987A\u5E8F\u300D\u5F62\u6001\uFF09
   * \u672C\u8282\u8FD9\u4E9B\u89C4\u5219\u4E0E rp-ui \u7684\u684C\u9762\u57FA\u7EBF**\u7279\u5F02\u6027\u76F8\u540C**\uFF08\u90FD\u662F 0,1,0 = 100\uFF09\uFF0C
   * \u800C\u672C\u6587\u4EF6\u6CE8\u5165\u4E3A dsht-plugin-mobile-style\u3001**\u5148\u4E8E** dsht-rp-ui-style
   * \u21D2 \u540C\u7279\u5F02\u6027\u4E0B**\u540E\u5199\u8005\u80DC** \u21D2 \u672C\u8282\u7684\u58F0\u660E**\u5168\u90E8\u88AB\u8986\u76D6**\u3002
   *
   * \u8BBE\u5907\u5B9E\u6D4B\uFF08CDP \u679A\u4E3E\u300C\u5339\u914D\u4E14 media \u751F\u6548\u300D\u7684\u5168\u90E8\u89C4\u5219 + \u5B9E\u9645\u6E32\u67D3\u503C\uFF09\uFF1A
   *   .dsht-rp-back        \u672C\u6587\u4EF6 44px  vs  rp-ui 32px  \u21D2 \u5B9E\u6D4B **32px**\uFF08\u672C\u8282\u6B7B\uFF09
   *   .dsht-rp-tab         \u672C\u6587\u4EF6 44px  vs  rp-ui 28px  \u21D2 \u5B9E\u6D4B **28px**\uFF08\u672C\u8282\u6B7B\uFF09
   *   .dsht-rp-card-gear   \u672C\u6587\u4EF6 38px  vs  rp-ui 26px  \u21D2 \u5B9E\u6D4B **26px**\uFF08\u672C\u8282\u6B7B\uFF09
   *   .dsht-rp-user-stack  \u672C\u6587\u4EF6 92%   vs  rp-ui min(525px,82%) \u21D2 \u5B9E\u6D4B **82% \u6863**\uFF08\u672C\u8282\u6B7B\uFF09
   *   .dsht-rp-grid        gap 10px     vs  rp-ui 12px  \u21D2 \u5B9E\u6D4B **12px**\uFF08\u672C\u8282\u6B7B\uFF09
   * \u5176\u4E2D '.dsht-rp-back'(32) \u4E0E '.dsht-rp-card-gear'(26) **\u4F4E\u4E8E 38px \u62C7\u6307\u5E95\u7EBF**\uFF08P1 \u7EA7\uFF09\u3002
   *
   * ## \u7ED3\u8BBA\uFF08\u5DF2\u56FA\u5316\u4E3A\u7EAA\u5F8B\uFF09
   * **\u8DE8\u5305\u5199\u5BF9\u65B9\u81EA\u6709\u7EC4\u4EF6\u7684\u7C7B\u540D\u89C4\u5219\u4E00\u5F8B\u65E0\u6548/\u4E0D\u53EF\u9760** \u2014\u2014 \u65E0\u8BBA\u7279\u5F02\u6027\u9AD8\u4F4E\uFF0C
   * \u90FD\u53D6\u51B3\u4E8E\u6CE8\u5165\u987A\u5E8F\u3002\u21D2 \u53EA\u5141\u8BB8\u8DE8\u5305\u5199**\u5BBF\u4E3B\u951A\u70B9**\uFF08'[data-dsht-mobile]'\uFF0C
   * \u7531 anchors.ts \u5355\u70B9\u7EF4\u62A4\uFF09\u3002\u672C\u8282\u7684\u5BBF\u4E3B\u951A\u70B9\u89C4\u5219\uFF08chat-header \u7B49\uFF09**\u4FDD\u7559\u5728\u672C\u6587\u4EF6**\u3002
   *
   * \u8FC1\u79FB\u53BB\u5411\uFF1Adsht-rp-ui/src/client/style.ts \u7684 (pointer: coarse) \u6BB5
   * \u2014\u2014 \u89C1\u90A3\u91CC\u6807\u9898\u4E3A\u300C\u4ECE dsht-plugin-mobile \u8FC1\u5165\u300D\u7684\u5757\u3002 */

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

// ../packages/src/dsht-plugin-mobile/client/file-preview.ts
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
  const narrow = () => {
    if (typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 700px)").matches || window.matchMedia("(pointer: coarse)").matches;
  };
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

// ../packages/src/dsht-plugin-shared/webview-api-guard.ts
function fallbackUuid(g) {
  const c = g.crypto;
  const hex = [];
  if (c !== void 0 && typeof c.getRandomValues === "function") {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    for (const b of buf) hex.push(b.toString(16).padStart(2, "0"));
  } else {
    for (let i = 0; i < 32; i++) hex.push(Math.floor(Math.random() * 16).toString(16));
  }
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
function ensureWebviewApiGuard(g = globalThis) {
  const polyfilled = [];
  const missing = [];
  const c = g.crypto;
  if (c === void 0) {
    missing.push("crypto");
  } else if (typeof c.randomUUID !== "function") {
    c.randomUUID = () => fallbackUuid(g);
    polyfilled.push("crypto.randomUUID");
  }
  if (typeof g.structuredClone !== "function") {
    g.structuredClone = (v) => JSON.parse(JSON.stringify(v));
    polyfilled.push("structuredClone");
  }
  if (typeof g.queueMicrotask !== "function") {
    const P = g.Promise;
    if (P === void 0) {
      missing.push("queueMicrotask\uFF08\u4E14\u65E0 Promise \u53EF\u515C\u5E95\uFF09");
    } else {
      g.queueMicrotask = (fn) => {
        void P.resolve().then(fn);
      };
      polyfilled.push("queueMicrotask");
    }
  }
  const O = g.Object;
  if (O === void 0) {
    missing.push("Object");
  } else if (typeof O.hasOwn !== "function") {
    O.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    polyfilled.push("Object.hasOwn");
  }
  const AP = g.Array?.prototype;
  if (AP === void 0) {
    missing.push("Array.prototype");
  } else if (typeof AP.at !== "function") {
    AP.at = function at(index) {
      const len = this.length >>> 0;
      const i = Math.trunc(index) || 0;
      const k = i < 0 ? len + i : i;
      if (k < 0 || k >= len) return void 0;
      return this[k];
    };
    polyfilled.push("Array.prototype.at");
  }
  const A = g.AbortSignal;
  if (A === void 0) {
    missing.push("AbortSignal");
  } else if (typeof A.any !== "function") {
    A.any = (signals) => {
      const controller = new AbortController();
      const onAbort = () => {
        try {
          controller.abort(controller.signal.reason);
        } catch {
          controller.abort();
        }
      };
      for (const s of signals ?? []) {
        if (s?.aborted === true) {
          try {
            controller.abort(s.reason);
          } catch {
            controller.abort();
          }
          break;
        }
        s?.addEventListener?.("abort", onAbort);
      }
      return controller.signal;
    };
    polyfilled.push("AbortSignal.any");
  }
  return { polyfilled, missing };
}

// ../packages/src/dsht-plugin-mobile/client/index.tsx
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
    const parent = summary.parentElement;
    if (parent === null || parent.tagName !== "DETAILS") return;
    e.preventDefault();
    e.stopPropagation();
    const details = parent;
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
  {
    const report = ensureWebviewApiGuard();
    if (report.polyfilled.length > 0) {
      console.warn(`[dsht-plugin-mobile] \u65E7 WebView \u80FD\u529B\u8865\u9F50\uFF1A${report.polyfilled.join(", ")}`);
    }
  }
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
