/**
 * RP 启动器全局样式：挂载时注入一次。
 *
 * 风格规则（对齐 DSH web-styling）：只消费 --dsw-alias-* / --dsw-specific-* 语义
 * token，不写色值字面量——深浅主题由原生 body[data-ds-dark-theme] 自动翻转，
 * 与 DSH 前端完全同肤。聊天视图由原生 conversation 主视图承担（用户架构定案：
 * 本插件不自建聊天 UI），此处只有启动器/导入/配置面板 + T2.5 原生席位组件
 * （输出协议三组件/变体条/reasoning 折叠行）的样式。
 *
 * 移动端竖屏适配（P2#13）已抽离到独立插件 dsht-plugin-mobile
 * （packages/src/dsht-plugin-mobile/client/style.ts：CSS 五件套 + data-* 宿主锚点，
 * 含 .dsht-rp-* 竖屏规则）；本文件只保留桌面基线样式。
 */

let injected = false

export function ensureStyle(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.id = 'dsht-rp-ui-style'
  style.textContent = css
  document.head.append(style)
}

const css = `
/* ---- 侧栏 footer 按钮（融入原生 New Session 按钮的样式模式）---- */
.dsht-rp-sidebar-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 36px; border: none; border-radius: 12px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 22px; font-weight: 500; font-family: inherit;
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-sidebar-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsht-rp-sidebar-btn .ico { font-size: 15px; line-height: 1; }

/* ---- 全屏 RP 启动器（shell.overlay 席位；原生主题 token 直供）---- */
.dsht-rp-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  pointer-events: auto; /* overlay 席位默认 click-through，显式接管 */
  font-family: var(--dsw-font-family);
}
.dsht-rp-topbar {
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  padding: 10px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dsht-rp-back {
  width: 32px; height: 32px; border: none; border-radius: 50%; background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 18px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-back:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-tabs { display: flex; gap: 4px; margin-left: 4px; }
.dsht-rp-tab {
  height: 28px; padding: 0 14px; border-radius: 14px; border: 1px solid transparent;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 18px; font-family: inherit; cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-tab.active {
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
}
.dsht-rp-main { flex: 1; overflow-y: auto; min-height: 0; }

/* ---- T2.11：嵌入导入中心 iframe（导入页全功能；同源 /dsht-rp/import-center）---- */
.dsht-rp-import-frame {
  display: block; width: 100%; height: 100%; border: none;
  background: var(--dsw-alias-bg-base);
}

/* ---- 角色宫格 ---- */
.dsht-rp-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px; padding: 16px; align-content: start;
}
.dsht-rp-card {
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px; padding: 16px; cursor: pointer; text-align: left;
  box-shadow: var(--dsw-shadow-lv1); font-family: inherit;
  transition: border-color var(--ds-transition-duration) var(--ds-ease-in-out),
    background var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsht-rp-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-card:active { border-color: var(--dsw-alias-state-business-primary); }
.dsht-rp-card:disabled { opacity: 0.5; cursor: default; }
.dsht-rp-card .name { font-size: 15px; font-weight: 600; line-height: 22px; margin-bottom: 6px; word-break: break-all; }
.dsht-rp-card .meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsht-rp-empty {
  grid-column: 1/-1; text-align: center; color: var(--dsw-alias-label-tertiary);
  padding: 48px 20px; font-size: 13px; line-height: 20px;
}

/* ---- 导入页 ---- */
.dsht-rp-import { max-width: 560px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.dsht-rp-section {
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px; padding: 16px; box-shadow: var(--dsw-shadow-lv1);
}
.dsht-rp-section h3 { font-size: 15px; font-weight: 600; line-height: 22px; margin-bottom: 4px; }
.dsht-rp-section .desc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; margin-bottom: 12px; }
.dsht-rp-field {
  width: 100%; background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; color: var(--dsw-alias-label-primary); padding: 8px 10px;
  font-size: 13px; line-height: 20px; font-family: inherit; outline: none;
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-field:focus { border-color: var(--dsw-alias-brand-primary); }
.dsht-rp-drop {
  /* display:block 铁律：label 默认 inline，行内盒不撑占位——顶部压进上方描述、
     底部被后续块上提（实测重叠 10-24px 且拦截点击）。block 让拖拽区独立成块 */
  display: block; width: 100%;
  border: 1.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; padding: 20px 16px;
  text-align: center; color: var(--dsw-alias-label-secondary); cursor: pointer;
  font-size: 13px; line-height: 20px;
  box-sizing: border-box;
  transition: border-color var(--ds-transition-duration) var(--ds-ease-in-out),
    background var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsht-rp-drop:hover { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
  border: none; border-radius: 18px; height: 36px; padding: 0 16px;
  font-size: 14px; line-height: 22px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-btn:active { opacity: 0.8; }
.dsht-rp-btn:disabled { opacity: 0.4; }
.dsht-rp-kv { display: flex; gap: 8px; padding: 3px 0; font-size: 13px; line-height: 20px; }
.dsht-rp-kv .k { color: var(--dsw-alias-label-secondary); min-width: 90px; flex-shrink: 0; }
.dsht-rp-kv .v { flex: 1; min-width: 0; word-break: break-all; }
.dsht-rp-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }

/* ---- T2.5a 输出协议三组件（原生会话流内，assistant-step shadowing 渲染器）---- */
/* 【2026-09-07 楼层头二次对齐（用户拍板，对照 ST 基准）】assistant 楼层改为纵向：
 * 楼层头（头像+名字+#N+耗时+时间）横排在楼层顶部一行，正文全宽在其下。
 * 弃用 88px 左列——左列在整个楼层高度常驻，长楼层滚动阅读时文字被整体挤右（真机反馈）。
 * sticky top 保留：长楼层下滑时楼层头钉在滚动视口顶（「往下滑它留在上面」），
 * 实底背景防止正文从头部下方穿透。 */
.dsht-rp-assistant { display: flex; flex-direction: column; gap: 6px; position: relative; }
/* actions 行在纵向布局下天然独占整行（column 不存在 wrap 挤压问题） */
.dsht-rp-actions { flex: 0 0 auto; }
.dsht-rp-floor-head-assistant {
  position: sticky; top: 0; z-index: 3; align-self: stretch;
  min-height: 40px; padding: 4px 0;
  background: var(--dsw-alias-bg-base);
}
.dsht-rp-floor-head-assistant .dsht-rp-floor-meta { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.dsht-rp-assistant-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* ---- §2.3 ③ 楼层号徽章（#N 0 起始，与 ST 观感一致；插件设置「楼层号显示」可关）---- */
.dsht-rp-floor {
  font-size: 10px; line-height: 14px; font-family: ui-monospace, monospace;
  color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px;
  padding: 0 4px; pointer-events: none; user-select: none; opacity: .75;
}
.dsht-rp-floor-assistant { position: absolute; top: -2px; right: 0; z-index: 2; }
.dsht-rp-floor-user { align-self: flex-end; }

/* ---- ST 同款楼层头（2026-09-06 视觉验收，对照基准 316）----
 * assistant：头像圆 36px + 名字（白粗）+ 元信息灰行（#N · 耗时 · 时间）；
 * user：整行右对齐（ST 用户楼靠右）。头像缺失时 img onError 自隐。 */
.dsht-rp-floor-head { display: flex; align-items: center; gap: 8px; min-height: 36px; }
.dsht-rp-floor-head-user { flex-direction: row-reverse; }
.dsht-rp-avatar {
  width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
  background: var(--dsw-alias-bg-layer-2);
}
.dsht-rp-floor-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsht-rp-floor-head-user .dsht-rp-floor-meta { align-items: flex-end; }
.dsht-rp-floor-name { font-size: 13px; line-height: 17px; font-weight: 600; color: rgba(220, 220, 210, 0.95); }
.dsht-rp-floor-sub { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, monospace; }

/* ---- RP 会话隐藏宿主 turn-process「Thought for a while」行（纯思考折叠）----
 * 宿主行是英文 UI 且与 RP 楼层内的思考胶囊双份（真机实拍）；RP 活跃时由
 * body[data-dsht-rp-active] 标记（RpFloorHeader 挂载计数），仅限
 * 0 消息/0 工具调用的纯思考行——带内容的 turn-process（工具折叠行）保留。 */
body[data-dsht-rp-active] [data-chat-flow-kind="turn-process"]:has(button[data-turn-process-messages="0"][data-turn-process-tool-calls="0"][data-turn-process-subagents="0"]) { display: none; }
/* turn-tail「Ran for 0s + 时间戳」行：与楼层头元信息（#N · 耗时 · 时间）重复，
 * ST 基准无此行 → RP 会话隐藏（楼层头已带同款信息）。 */
body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] { display: none; }
/* 【审计 F 类 2026-09-08】宿主抽屉搜索框 computed pointer-events:none（宿主 bundle
 * 自身缺陷）→ 触摸无法聚焦。作用域覆盖（hash 类名随宿主升级可能漂移——失效即无害，
 * 修复机制见 docs/ST-COMPAT-PACT.md 附录 A 类/F 类登记）。 */
body[data-dsht-rp-active] .bhn1Oq_searchInput { pointer-events: auto !important; }
/* 【审计 B 类 2026-09-08】hover-only 楼层动作（Good/Bad response 等）触屏揭示：
 * 这些按钮的载体就是 turn-tail 行（真机 probe 实证：按钮在 flowItem[data-chat-flow-kind=
 * turn-tail] 内，宿主自己把按钮定为 28×28）——上面那条 display:none 把按钮连人带藏。
 * 触屏没有 hover：coarse 指针下显示该行，只藏与楼层头重复的文本 span（用时/时间戳），
 * 保留动作按钮（ST 移动端动作常驻同语义）。桌面（fine pointer）维持原隐藏。 */
@media (pointer: coarse) {
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] { display: flex !important; }
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] span { display: none !important; }
}

.dsht-rp-stopped {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  font-style: italic;
}

/* 状态栏卡片（statusTags / statusbar 代码块 → 组件） */
.dsht-rp-statusbar {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); padding: 8px 12px; max-width: 480px;
}
.dsht-rp-statusbar .sb-title {
  font-size: 10px; line-height: 14px; letter-spacing: 0.08em;
  color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; font-weight: 600;
}
.dsht-rp-statusbar .sb-row {
  display: flex; gap: 10px; font-size: 12px; line-height: 18px;
  align-items: baseline; word-break: break-all;
}
.dsht-rp-statusbar .sb-k { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dsht-rp-statusbar .sb-v { color: var(--dsw-alias-label-primary); }

/* 行动选项按钮（actionTags → 可点按钮；点击经原生 composer 发送） */
.dsht-rp-actions {
  display: flex; flex-direction: column; gap: 6px; max-width: 480px; margin-top: 4px;
}
.dsht-rp-action-btn {
  display: flex; align-items: center; gap: 8px; text-align: left;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  padding: 8px 12px; font-size: 13px; line-height: 20px; font-family: inherit;
  cursor: pointer;
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-action-btn:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-state-business-primary); }
.dsht-rp-action-btn:disabled { opacity: 0.5; cursor: default; }
.dsht-rp-action-btn .tag { color: var(--dsw-alias-state-business-primary); flex-shrink: 0; font-size: 11px; }

/* ---- ST 文本色对齐（用户 ST settings.json power_user 实测值，2026-09-06）----
 * .mes_text q  { color: var(--SmartThemeQuoteColor) }   quote_text_color = rgba(225,138,36,1)
 * .mes_text em { color: var(--SmartThemeEmColor) }      italics_text_color = rgba(145,145,145,1)
 * 台词 <q> 由渲染层 st-quotes.ts DOM 包裹产出（MarkdownText 不透传 raw HTML） */
.dsht-rp-assistant-body q { color: rgba(225, 138, 36, 1); font-style: inherit; }
.dsht-rp-assistant-body q em, .dsht-rp-assistant-body q i { color: inherit; }
.dsht-rp-assistant-body em, .dsht-rp-assistant-body i { color: rgba(145, 145, 145, 1); }

/* reasoning 折叠行（T2.5d；2026-09-06 视觉对齐 ST .mes_reasoning_header 胶囊：
 * bg rgb(75,75,75) 圆角5、右置箭头、正文 border-left 2px 灰（style.css L424-466/L508-520）） */
.dsht-rp-reasoning { max-width: 480px; }
.dsht-rp-reasoning summary {
  cursor: pointer; user-select: none; font-size: 13px; line-height: 18px;
  color: rgba(220, 220, 210, 0.92); list-style: none;
  display: flex; align-items: center; position: relative;
  margin: 6px 2px; padding: 7px 14px; padding-right: calc(0.7em + 14px);
  border-radius: 5px; background-color: rgb(75, 75, 75);
}
.dsht-rp-reasoning summary::after {
  content: '▾'; position: absolute; top: 50%; right: 7px; transform: translateY(-50%);
  font-size: 13px; transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-reasoning[open] summary::after { transform: translateY(-50%) rotate(180deg); }
.dsht-rp-reasoning[data-running] summary { color: var(--dsw-alias-label-primary); }
.dsht-rp-reasoning .rp-reasoning-body {
  margin: 4px 2px 6px 2px; padding: 5px 5px 5px 14px;
  border-left: 2px solid rgba(145, 145, 145, 0.55); border-radius: 2px;
  font-size: 13px; line-height: 19px; color: rgba(145, 145, 145, 1);
  white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto;
}

/* ---- T2.10 渲染补差：折叠块 / 状态更新 / 伏笔登记册 ---- */
.dsht-rp-collapsible, .dsht-rp-state-update, .dsht-rp-foreshadowing {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); max-width: 520px; padding: 6px 12px;
}
.dsht-rp-collapsible summary, .dsht-rp-state-update summary, .dsht-rp-foreshadowing summary {
  cursor: pointer; user-select: none; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); list-style: none;
  display: flex; align-items: center; gap: 6px; padding: 2px 0;
}
.dsht-rp-collapsible summary::before, .dsht-rp-state-update summary::before, .dsht-rp-foreshadowing summary::before {
  content: '▸'; font-size: 10px; transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-collapsible[open] summary::before, .dsht-rp-state-update[open] summary::before, .dsht-rp-foreshadowing[open] summary::before { transform: rotate(90deg); }
.dsht-rp-collapsible .cl-title, .dsht-rp-state-update .cl-title { font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsht-rp-collapsible .cl-body {
  margin: 6px 0 4px; font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word;
}
.dsht-rp-state-update .su-body, .dsht-rp-foreshadowing .fs-body { margin: 6px 0 4px; display: flex; flex-direction: column; gap: 6px; }
/* JSONPatch diff 表 */
.dsht-rp-state-update .su-patch-table {
  border-collapse: collapse; width: 100%; font-size: 11px; line-height: 17px;
}
.dsht-rp-state-update .su-patch-table th {
  text-align: left; color: var(--dsw-alias-label-tertiary); font-weight: 500;
  border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 2px 8px 2px 0;
}
.dsht-rp-state-update .su-patch-table td { padding: 2px 8px 2px 0; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dsht-rp-state-update .su-op { color: var(--dsw-alias-state-business-primary); font-family: var(--dsw-font-family-code, monospace); }
.dsht-rp-state-update .su-path { font-family: var(--dsw-font-family-code, monospace); color: var(--dsw-alias-label-primary); }
.dsht-rp-state-update .su-raw {
  margin: 0; padding: 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover);
  font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word; overflow-x: auto;
}

/* ---- T2.8 正则管理面板（ST extensions/regex 界面复刻）---- */
.dsht-rp-regex { max-width: 640px; margin: 0 auto; padding: 16px; }
.dsht-rp-regex-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsht-rp-regex-row[data-disabled] .rx-name, .dsht-rp-regex-row[data-disabled] .rx-badges { opacity: 0.45; }
.dsht-rp-regex-row .rx-name {
  flex: 1; min-width: 0; text-align: left; border: none; background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px;
  font-family: inherit; cursor: pointer; padding: 2px 4px; border-radius: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-regex-row .rx-name:hover { background: var(--dsw-alias-interactive-bg-hover); }
.rx-badges { display: inline-flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.rx-badge {
  font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.rx-badge.rx-timing { color: var(--dsw-alias-state-business-primary); }
.rx-del {
  width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; flex-shrink: 0; font-size: 12px;
}
.rx-del:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-state-error, #E65A6A); }
/* 开关（原生 checkbox 美化：DSH token） */
.rx-toggle { display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.rx-toggle input { position: absolute; opacity: 0; }
.rx-toggle span {
  width: 32px; height: 18px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover);
  position: relative; transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.rx-toggle span::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--dsw-alias-label-secondary); transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.rx-toggle input:checked + span { background: var(--dsw-alias-state-business-primary); }
.rx-toggle input:checked + span::after { transform: translateX(14px); background: var(--dsw-alias-label-primary-foreground, #fff); }
.rx-check {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap;
}
.dsht-rp-field-code { font-family: var(--dsw-font-family-code, monospace); font-size: 12px; }
.rx-test-out {
  margin: 8px 0 0; padding: 10px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover);
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;
  font-family: var(--dsw-font-family-code, monospace);
}

/* ---- T2.7 RP 预设管理面板 + 会话头切换 ---- */
.dsht-rp-preset { max-width: 640px; margin: 0 auto; padding: 16px; }
.dsht-rp-preset-row {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  border: none; background: transparent; padding: 10px 8px; border-radius: 8px;
  cursor: pointer; font-family: inherit;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsht-rp-preset-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-preset-row .pr-name { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsht-rp-preset-row .pr-meta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.dsht-rp-preset-entry {
  display: flex; align-items: center; gap: 8px; padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1); cursor: pointer;
}
.dsht-rp-preset-entry .pe-id { font-size: 12px; color: var(--dsw-alias-label-primary); min-width: 110px; font-family: var(--dsw-font-family-code, monospace); }
.dsht-rp-preset-entry .pe-type { font-size: 10px; color: var(--dsw-alias-state-business-primary); flex-shrink: 0; }
.dsht-rp-preset-entry .pe-preview { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dsht-rp-preset-toggle { margin: 8px 0; }
.dsht-rp-preset-toggle .pt-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.dsht-rp-preset-toggle .pt-options { display: flex; flex-wrap: wrap; gap: 6px; }
.dsht-rp-preset-toggle .pt-opt {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 18px;
  padding: 3px 10px; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary); cursor: pointer; background: transparent;
}
.dsht-rp-preset-toggle .pt-opt.on {
  border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-module-platform);
}
/* 会话头预设切换（原生 header actions 行内） */
.dsht-rp-preset-switch { display: inline-flex; align-items: center; gap: 4px; }
.dsht-rp-preset-switch .ps-ico { font-size: 13px; }
.dsht-rp-preset-switch .ps-select {
  height: 26px; border-radius: 13px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 18px; padding: 0 8px; font-family: inherit;
  outline: none; max-width: 160px; cursor: pointer;
}
.dsht-rp-preset-switch .ps-select:focus { border-color: var(--dsw-alias-brand-primary); }

/* ---- T2.6：角色卡设置角标 + 世界书绑定抽屉 + 导入 dock 入口 ---- */
.dsht-rp-card-wrap { position: relative; }
.dsht-rp-card-gear {
  position: absolute; top: 8px; right: 8px; width: 26px; height: 26px;
  border: none; border-radius: 50%; background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; opacity: 0;
  transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-card-wrap:hover .dsht-rp-card-gear, .dsht-rp-card-gear:focus-visible { opacity: 1; }
.dsht-rp-card-gear:hover { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground, #fff); }
/* 触屏无 hover 常显规则已迁至 dsht-plugin-mobile */

/* 悬浮球（RpStateFloat，示例卡二 pw-state-float 意图原生移植）：fixed 浮球 + 底部状态面板 */
.dsht-rp-statefloat-ball {
  position: fixed; z-index: 60; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 50%; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-elevated, rgba(30,30,40,.85));
  color: var(--dsw-alias-label-primary); font-size: 20px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 10px rgba(0,0,0,.35); cursor: grab; touch-action: none;
  opacity: .85; transition: opacity .15s;
}
.dsht-rp-statefloat-ball:active { cursor: grabbing; opacity: 1; }
.dsht-rp-statefloat-panel {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 61;
  max-height: 62vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); border-radius: 16px 16px 0 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 -6px 24px rgba(0,0,0,.4);
}
.dsht-rp-statefloat-panel .sf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.dsht-rp-statefloat-panel .sf-head-actions { display: flex; gap: 8px; }
.dsht-rp-statefloat-panel .sf-btn {
  min-width: 36px; min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
}
.dsht-rp-statefloat-panel .sf-body { padding: 12px 16px; overflow-y: auto; min-height: 0; font-size: 13px; }
.dsht-rp-statefloat-panel .sf-row { display: flex; gap: 8px; padding: 2px 0; align-items: baseline; }
.dsht-rp-statefloat-panel .sf-key { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dsht-rp-statefloat-panel .sf-key::after { content: '：'; }
.dsht-rp-statefloat-panel .sf-leaf { overflow-wrap: anywhere; }
.dsht-rp-statefloat-panel .sf-empty { opacity: .6; }
.dsht-rp-statefloat-panel .sf-error { color: var(--dsw-alias-state-error, #e5534b); }

/* 酒馆助手脚本运行时（RpScriptHost）：🧩 浮球 + 脚本管理面板（按钮 / 状态 / 缺 API 清单） */
/* ---- P4（2026-09-07）酒馆助手入口改 ST 原生形态：悬浮球 → 顶栏右上扩展图标 ----
 * ST 里酒馆助手是顶栏扩展菜单里的拼图图标（点击展开下拉：脚本按钮 + 管理），
 * 不是悬浮球。图标锚定会话顶栏正下方右上角，下拉面板同源锚定。 */
.dsht-rp-scriptball {
  position: fixed; right: 10px; top: calc(env(safe-area-inset-top, 0px) + 62px);
  /* 【审计 A 类 2026-09-08】z 60 → 10050：脚本注入悬浮 UI 惯用 10000+（wb-float-monitor
   * z=10001、fx 球装饰环等曾盖住本球中心 55% 触摸区）。核心 chrome 仲裁在脚本层之上。
   * 脚本功能 UI 与本球重叠时球优先（36px 角落锚定，冲突面积极小）。 */
  z-index: 10050;
  width: 36px; height: 36px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-elevated, rgba(30,30,40,.85));
  color: var(--dsw-alias-label-primary); font-size: 18px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 6px rgba(0,0,0,.3); cursor: pointer;
  opacity: .9; transition: opacity .15s;
}
.dsht-rp-scriptball:hover { opacity: 1; }
/* 【2026-09-07 ST 按钮条对齐（基准 1/316）】脚本按钮常驻胶囊条（输入框上方，ST 同位） */
.dsht-rp-script-pillbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 10px 6px; }
.dsht-rp-script-pill {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-elevated, rgba(40, 40, 48, .92));
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 18px;
  padding: 5px 12px; cursor: pointer; max-width: 60vw;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-script-pill:active { opacity: .65; }
.dsht-rp-script-panel {
  position: fixed; z-index: 61; width: min(420px, 92vw);
  max-height: 60vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); border-radius: 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 6px 24px rgba(0,0,0,.4);
}
.dsht-rp-script-panel .sf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.dsht-rp-script-panel .sf-head-actions { display: flex; gap: 8px; }
.dsht-rp-script-panel .sf-btn {
  min-width: 36px; min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
}
.dsht-rp-script-panel .sf-body { padding: 12px 16px; overflow-y: auto; min-height: 0; font-size: 13px; }
.dsht-rp-script-panel .sf-error { color: var(--dsw-alias-state-error, #e5534b); }
.dsht-rp-script-panel .th-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dsht-rp-script-panel .th-btn { color: var(--dsw-alias-label-primary); }
.dsht-rp-script-panel .th-row { padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsht-rp-script-panel .th-row:last-child { border-bottom: none; }
.dsht-rp-script-panel .th-badge {
  display: inline-block; padding: 1px 8px; margin-right: 8px; border-radius: 8px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary);
}
.dsht-rp-script-panel .th-running { color: var(--dsw-alias-state-success, #3fb950); }
.dsht-rp-script-panel .th-failed { color: var(--dsw-alias-state-error, #e5534b); }
.dsht-rp-script-panel .th-src { margin-left: 6px; font-size: 12px; opacity: .55; }
.dsht-rp-script-panel .th-detail { margin-top: 3px; font-size: 12px; opacity: .85; overflow-wrap: anywhere; }
.dsht-rp-script-panel .th-missing { color: var(--dsw-alias-state-warning, #d29922); }
.dsht-rp-script-panel .th-toasts { opacity: .6; }

/* 批次修复 1b：空白 RP 会话的开场白选择窗 */
.dsht-rp-greeting-dock {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; margin: 0 12px 6px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.12));
  font-size: 13px;
}
.dsht-rp-greeting-dock .txt { opacity: .85; }
/* 竖屏窄屏规则已迁至 dsht-plugin-mobile */
.dsht-rp-drawer-mask {
  position: absolute; inset: 0; z-index: 10; display: flex; align-items: flex-end;
  background: rgba(0, 0, 0, 0.45);
}
.dsht-rp-drawer {
  width: 100%; max-height: 70%; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); border-radius: 16px 16px 0 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsht-rp-drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex-shrink: 0;
}
.dsht-rp-drawer-body { padding: 12px 16px; overflow-y: auto; min-height: 0; }
.dsht-rp-drawer-foot { padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1); flex-shrink: 0; }
/* 导入 dock 入口（composer 卡上方整行） */
.dsht-rp-import-dock {
  align-self: flex-start; height: 26px; padding: 0 12px; border-radius: 13px;
  border: 1px dashed var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px;
  font-family: inherit; cursor: pointer;
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-import-dock:hover { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); }

/* ---- 批次修复 4：user 气泡 shadowing + 回退按钮（对齐官方 userRow/bubble 形态）---- */
.dsht-rp-user-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.dsht-rp-user-stack {
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  min-width: 0; max-width: min(525px, 82%);
}
.dsht-rp-user-bubble {
  max-width: 100%; background: var(--dsw-specific-bubble, var(--dsw-alias-bg-layer-1));
  border-radius: 22px; padding: 10px 16px;
  font-size: 16px; line-height: 24px; color: var(--dsw-alias-label-primary);
  white-space: pre-wrap; word-break: break-word;
}
.dsht-rp-rollback-btn {
  align-self: flex-end; height: 24px; padding: 0 10px; border-radius: 12px;
  border: 1px dashed var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px;
  font-family: inherit; cursor: pointer;
  transition: color var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-rollback-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-state-business-primary); }
.dsht-rp-rollback-btn:disabled { opacity: 0.5; cursor: default; }
.dsht-rp-user-actions { display: flex; gap: 6px; justify-content: flex-end; }
.dsht-rp-edit-box { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.dsht-rp-edit-area {
  width: 100%; box-sizing: border-box; background: var(--dsw-specific-bubble, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  padding: 8px 12px; font: inherit; font-size: 15px; line-height: 22px; resize: vertical;
}
.dsht-rp-edit-area:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsht-rp-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }

/* ---- 设置→插件页的可展开配置卡（2026-09-04 重做：信息卡 → 可配置）---- */
.dsht-plugin-fold-row { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.dsht-plugin-set-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.dsht-plugin-set-label { font-size: 13px; color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dsht-plugin-set-num {
  width: 110px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px;
}
.dsht-plugin-set-num:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsht-plugin-set-body { padding: 8px 12px 4px; border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 10px; }
.dsht-plugin-set-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; }

/* ---- 导入状态面板折叠（2026-09-04：默认收起一行摘要，展开看详情）----
 * 用 React 受控折叠（条件渲染）而非 <details>——卓易通真机 WebView 的 details
 * 原生折叠失效（裸 details 实测 open=false 内容照常渲染）。 */
.dsht-rp-fold-summary-row {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 2px 0; user-select: none;
}
.dsht-rp-fold-arrow {
  color: var(--dsw-alias-label-tertiary); font-size: 12px; flex-shrink: 0;
  transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-fold-arrow.open { transform: rotate(90deg); }
.dsht-rp-fold-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); margin: 0; }
.dsht-rp-fold-summary { flex: 1; font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.dsht-rp-fold-body { padding-top: 4px; }

/* ---- 批次修复 2：预设条目展开编辑器 ---- */
.dsht-rp-preset-entry-wrap { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsht-rp-preset-entry-wrap .dsht-rp-preset-entry { border-bottom: none; }
.pe-expand {
  width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; flex-shrink: 0; font-size: 12px;
}
.pe-expand:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.pe-editor {
  display: flex; flex-direction: column; gap: 8px; padding: 8px 0 12px 30px;
}
.pe-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.pe-field > span { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.pe-field-row { display: flex; gap: 8px; }
.pt-opt-wrap { display: flex; flex-direction: column; }
.pt-opt-wrap .pt-opt { cursor: default; }
.pt-opt-label {
  border: none; background: transparent; padding: 0; margin-left: 2px;
  color: inherit; font: inherit; cursor: pointer;
}
.pt-opt-label:hover:not(:disabled) { text-decoration: underline; }
.pt-opt-wrap .pe-editor { padding: 8px 0 10px 4px; }

/* ---- 批次修复 5：persona 行 ---- */
.dsht-rp-persona-row { border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 8px 0; }
.dsht-rp-persona-row .pr-head { display: flex; align-items: center; gap: 8px; }
.dsht-rp-persona-row .pr-head .rx-check { flex: 1; min-width: 0; }
.dsht-rp-persona-row .pr-edit { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 4px 26px; }

/* ---- 批次修复 9：配置文件路径弹层 ---- */
.dsht-cfgdoc-mask {
  position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); padding: 20px; box-sizing: border-box;
}
.dsht-cfgdoc {
  width: 100%; max-width: 420px; border-radius: 16px; padding: 18px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 30px rgba(0, 0, 0, 0.25));
  display: flex; flex-direction: column; gap: 10px; font-family: inherit;
}
.dsht-cfgdoc .cd-title { font-size: 15px; font-weight: 600; }
.dsht-cfgdoc .cd-path {
  font-size: 12px; line-height: 18px; word-break: break-all;
  font-family: var(--dsw-font-family-code, monospace);
  background: var(--dsw-alias-interactive-bg-hover); border-radius: 8px; padding: 8px 10px;
}
.dsht-cfgdoc .cd-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsht-cfgdoc .cd-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dsht-cfgdoc .cd-btn {
  height: 32px; padding: 0 14px; border-radius: 16px; font-size: 13px; font-family: inherit;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-primary); cursor: pointer;
}
.dsht-cfgdoc .cd-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-cfgdoc .cd-btn:disabled { opacity: 0.4; }

/* ---- 批次修复 4/5/6：MVU 状态栏组件 / display HTML 产出 / 重新生成按钮 ---- */
.dsht-rp-mvu-statusbar {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); padding: 8px 12px; max-width: 480px;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary);
}
.dsht-rp-html { font-size: inherit; line-height: inherit; }
/* P0-2：完整 HTML 文档段的沙箱 iframe（高度由 iframe 内 postMessage 上报驱动） */
.dsht-rp-message-frame { width: 100%; border: 0; display: block; background: transparent; }
/* 【审计 E 类 2026-09-08】帧停车场改造：iframe 由命令式创建、宿主 div 只负责占高。
 * 卸载时 iframe 移入隐藏停车场保活（文档不重执行、卡状态不丢），重挂载原样移回。 */
.dsht-rp-message-frame-mount { width: 100%; }
.dsht-rp-regen-btn {
  height: 22px; padding: 0 8px; border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px;
  font-family: inherit; cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-regen-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsht-rp-regen-btn:disabled { opacity: 0.5; cursor: default; }

/* ---- T2.5c 变体条（IconActions 行内席位）---- */
.dsht-rp-variant-bar {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary);
}
.dsht-rp-variant-bar .vb-arrow {
  width: 20px; height: 20px; border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-family: inherit;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-variant-bar .vb-arrow:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsht-rp-variant-bar .vb-arrow:disabled { opacity: 0.35; cursor: default; }
.dsht-rp-variant-bar .vb-count { min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; }

/* ---- 任务 C2：设置→插件「可配置」tab 的预适配插件辨识卡 ---- */
.dsht-plugin-card {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); padding: 12px 16px; margin-bottom: 10px;
  box-shadow: var(--dsw-shadow-lv1);
}
.dsht-plugin-card .pc-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 4px; }
.dsht-plugin-card .pc-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsht-plugin-card .pc-meta.pc-dim { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 4px; }

/* ---- 任务 C1：导入 tab 顶部迁移验收面板 ---- */
.dsht-rp-import-wrap { display: flex; flex-direction: column; height: 100%; }
.dsht-rp-import-wrap .dsht-rp-import-frame { flex: 1; min-height: 0; }
.dsht-rp-verification { margin: 12px 16px 0; flex-shrink: 0; }
.dsht-rp-verification .k { min-width: 76px; }

/* ---- 任务 B：世界书管理总览（书 → 绑定卡 chips，竖屏单列）---- */
.dsht-rp-books { max-width: 640px; margin: 0 auto; padding: 16px; }
.wb-book { margin-bottom: 10px; padding: 0; overflow: hidden; }
.wb-row {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  border: none; background: transparent; padding: 12px 16px; cursor: pointer; font-family: inherit;
}
.wb-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-book[data-open] .wb-row { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.wb-row .wb-name { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); word-break: break-all; }
.wb-row .wb-meta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.wb-detail { padding: 10px 16px 14px; }
.wb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.wb-chip {
  display: inline-flex; align-items: center; min-height: 32px; padding: 4px 12px;
  border-radius: 16px; border: 1px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; font-family: inherit; cursor: pointer;
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.wb-chip:hover:not(:disabled) { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); }
.wb-chip:disabled { opacity: 0.5; cursor: default; }
.wb-chip-bound { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
.wb-chip-global { border-style: dashed; cursor: default; color: var(--dsw-alias-state-business-primary); }

/* ---- 任务 A：主会话过程折叠标题行（插在原生会话流内的外来节点）---- */
.dsht-fold-header {
  display: flex; align-items: center; width: 100%; min-height: 32px;
  margin: 2px 0; padding: 4px 12px; box-sizing: border-box;
  border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 18px; font-family: inherit; text-align: left;
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-fold-header:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }

/* ---- PROJECT_PLAN 补全 1：备选开场白区块（CardDetailDrawer 内）---- */
.dsht-rp-altgreet {
  display: flex; flex-direction: column; gap: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 8px 0;
}
.dsht-rp-altgreet:last-of-type { border-bottom: none; }
.dsht-rp-altgreet .ag-text {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word;
  max-height: 96px; overflow-y: auto;
}

/* ---- PROJECT_PLAN 补全 2：状态查看双视图面板（RpStateView，表格/JSON）---- */
.dsht-rp-stateview-mask {
  position: fixed; inset: 0; z-index: 70; display: flex;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); padding: 20px; box-sizing: border-box;
}
.dsht-rp-stateview {
  width: 100%; max-width: 560px; max-height: 78vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); overflow: hidden;
  font-family: var(--dsw-font-family);
}
.dsht-rp-stateview .sv-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.dsht-rp-stateview .sv-head-actions { display: flex; gap: 6px; align-items: center; }
.dsht-rp-stateview .sv-view-btn {
  height: 28px; padding: 0 12px; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; font-family: inherit; cursor: pointer;
}
.dsht-rp-stateview .sv-view-btn.on {
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.dsht-rp-stateview .sf-btn {
  min-width: 36px; min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
}
.dsht-rp-stateview .sv-body { padding: 12px 16px; overflow-y: auto; min-height: 0; font-size: 13px; }
.dsht-rp-stateview .sv-row { display: flex; gap: 8px; padding: 2px 0; align-items: baseline; }
.dsht-rp-stateview .sv-row.sv-node {
  width: 100%; text-align: left; border: none; background: transparent; color: inherit;
  font: inherit; font-family: inherit; cursor: pointer; border-radius: 6px;
  padding-top: 3px; padding-bottom: 3px;
}
.dsht-rp-stateview .sv-row.sv-node:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-stateview .sv-arrow { flex-shrink: 0; width: 10px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dsht-rp-stateview .sv-key { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dsht-rp-stateview .sv-key:not(:empty)::after { content: '：'; }
.dsht-rp-stateview .sv-count { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsht-rp-stateview .sv-leaf { overflow-wrap: anywhere; white-space: pre-wrap; }
.dsht-rp-stateview .sv-json {
  margin: 0; padding: 10px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover);
  font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word; overflow-x: auto;
  font-family: var(--dsw-font-family-code, monospace);
}
.dsht-rp-stateview .sv-empty { opacity: .6; }
.dsht-rp-stateview .sv-error { color: var(--dsw-alias-state-error, #e5534b); }

/* ---- PROJECT_PLAN 补全 3：世界书条目管理面板（RpLorePanel）---- */
.dsht-rp-lore { max-width: 640px; margin: 0 auto; padding: 16px; }
.dsht-rp-lore .lore-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.dsht-rp-lore .lore-btn { height: 30px; padding: 0 12px; font-size: 13px; flex-shrink: 0; }
.dsht-rp-lore .lore-title { font-size: 14px; font-weight: 600; word-break: break-all; }
.dsht-rp-lore .lore-search { flex: 1; min-width: 160px; max-width: 260px; }
.dsht-rp-lore .lore-entry { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsht-rp-lore .lore-entry[data-disabled] .lore-name,
.dsht-rp-lore .lore-entry[data-disabled] .wb-meta { opacity: 0.45; }
.dsht-rp-lore .lore-entry-head { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.dsht-rp-lore .lore-entry-head .wb-meta { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsht-rp-lore .lore-name {
  flex: 1; min-width: 0; text-align: left; border: none; background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px;
  font-family: inherit; cursor: pointer; padding: 2px 4px; border-radius: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-lore .lore-name:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-lore .lore-editor { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 12px 40px; }
.dsht-rp-lore .lore-content { resize: vertical; min-height: 88px; }

/* ---- PROJECT_PLAN §4.15 补全 4：消息搜索面板（RpSearchPanel，悬浮球入口拉起）---- */
.dsht-rp-searchview-mask {
  position: fixed; inset: 0; z-index: 70; display: flex;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); padding: 20px; box-sizing: border-box;
}
.dsht-rp-searchview {
  width: 100%; max-width: 560px; max-height: 78vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); overflow: hidden;
  font-family: var(--dsw-font-family);
}
.dsht-rp-searchview .se-searchbar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px 0; flex-shrink: 0;
}
.dsht-rp-searchview .se-input { flex: 1; min-width: 0; }
.dsht-rp-searchview .se-count {
  flex-shrink: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.dsht-rp-searchview .se-body { padding-top: 8px; }
.dsht-rp-searchview .se-hit {
  display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left;
  border: none; background: transparent; padding: 8px 6px; border-radius: 8px;
  cursor: pointer; font-family: inherit; color: inherit;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsht-rp-searchview .se-hit:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-searchview .se-hit-head { display: flex; align-items: center; gap: 8px; }
.dsht-rp-searchview .se-floor {
  font-family: var(--dsw-font-family-code, monospace); font-size: 11px;
  color: var(--dsw-alias-label-tertiary); flex-shrink: 0;
}
.dsht-rp-searchview .se-name {
  font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-searchview .se-role {
  flex-shrink: 0; font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.dsht-rp-searchview .se-snippet {
  font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-secondary);
  word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.dsht-rp-searchview .se-ellipsis { opacity: .5; }
.dsht-rp-searchview .se-mark {
  background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground, #fff);
  border-radius: 3px; padding: 0 2px;
}
/* 展开的完整消息文本（不做滚动定位的替代能力：面板内看全文） */
.dsht-rp-searchview .se-full {
  margin-top: 2px; padding: 8px 10px; border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 13px; line-height: 21px; color: var(--dsw-alias-label-primary);
  white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto;
}

/* ---- PROJECT_PLAN §7 措施 8 补全 5：token 上下文进度条（RpTokenMeter，输入区上方常驻细条）---- */
.dsht-rp-tokenmeter {
  display: flex; flex-direction: column; gap: 3px;
  margin: 0 12px 4px; padding: 4px 2px 0;
}
.dsht-rp-tokenmeter .tm-bar {
  height: 3px; border-radius: 2px; overflow: hidden;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsht-rp-tokenmeter .tm-fill {
  height: 100%; border-radius: 2px; min-width: 0;
  background: var(--dsw-alias-state-business-primary);
  transition: width var(--ds-transition-duration) var(--ds-ease-in-out);
}
/* 颜色分级：<70% 正常 / 70-90% 黄 / >90% 红（data-level 驱动，随主题 token 翻转） */
.dsht-rp-tokenmeter[data-level='warn'] .tm-fill { background: var(--dsw-alias-state-warning, #d29922); }
.dsht-rp-tokenmeter[data-level='danger'] .tm-fill { background: var(--dsw-alias-state-error, #e5534b); }
.dsht-rp-tokenmeter .tm-label {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.dsht-rp-tokenmeter .tm-num {
  font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsht-rp-tokenmeter .tm-tag {
  flex-shrink: 0; font-size: 9px; line-height: 12px; padding: 0 5px; border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
/* 计量条整体可点（§2.3 ④⑤ 面板入口） */
.dsht-rp-tokenmeter .tm-hit {
  display: flex; flex-direction: column; gap: 3px; width: 100%;
  border: none; background: transparent; padding: 0; cursor: pointer;
  font-family: inherit; text-align: left; color: inherit;
}
.dsht-rp-tokenmeter { position: relative; }
.dsht-rp-tokenmeter .tm-hit:hover .tm-num { color: var(--dsw-alias-label-primary); }

/* ---- §2.3 ④⑤：「上下文与记忆」弹出面板（RpContextPanel）---- */
.dsht-rp-ctx-backdrop {
  position: fixed; inset: 0; z-index: 60; background: transparent;
  cursor: default;
}
.dsht-rp-ctx-panel {
  position: absolute; right: 12px; bottom: calc(100% + 6px); z-index: 61;
  width: 320px; max-width: calc(100vw - 32px);
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 18px;
}
.dsht-rp-ctx-panel .cp-head {
  display: flex; align-items: center; justify-content: space-between;
}
.dsht-rp-ctx-panel .cp-title { font-size: 13px; font-weight: 600; }
.dsht-rp-ctx-panel .cp-close {
  width: 22px; height: 22px; border: none; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1;
}
.dsht-rp-ctx-panel .cp-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-ctx-panel .cp-row { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.dsht-rp-ctx-panel .cp-row.cp-status,
.dsht-rp-ctx-panel .cp-row.cp-hint,
.dsht-rp-ctx-panel .cp-row.cp-note,
.dsht-rp-ctx-panel .cp-row.cp-err {
  display: block; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px;
}
.dsht-rp-ctx-panel .cp-row.cp-note { color: var(--dsw-alias-label-secondary); }
.dsht-rp-ctx-panel .cp-row.cp-err { color: var(--dsw-alias-state-error, #e5534b); }
.dsht-rp-ctx-panel .cp-label { flex: 1; color: var(--dsw-alias-label-secondary); }
.dsht-rp-ctx-panel .cp-stepper { display: flex; align-items: center; gap: 4px; }
.dsht-rp-ctx-panel .cp-stepper button {
  width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1;
}
.dsht-rp-ctx-panel .cp-stepper button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-ctx-panel .cp-stepper button:disabled { opacity: .5; cursor: default; }
.dsht-rp-ctx-panel .cp-stepper input {
  width: 64px; height: 24px; text-align: center; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-size: 12px; font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.dsht-rp-ctx-panel .cp-stepper input:focus { outline: 1px solid var(--dsw-alias-border-l2); }
.dsht-rp-ctx-panel .cp-expand { flex-wrap: wrap; }
.dsht-rp-ctx-panel .cp-expand-btn {
  height: 26px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit;
}
.dsht-rp-ctx-panel .cp-expand-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsht-rp-ctx-panel .cp-expand-btn:disabled { opacity: .5; cursor: default; }
.dsht-rp-ctx-panel .cp-expand .cp-hint { width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .dsht-rp-overlay *, .dsht-rp-overlay *::before, .dsht-rp-overlay *::after,
  .dsht-rp-assistant *, .dsht-rp-action-btn, .dsht-rp-variant-bar .vb-arrow,
  .dsht-rp-reasoning summary::before {
    transition: none !important; animation: none !important;
  }
}

/* ---- T2.11/R11 手机竖屏适配已抽离（P2#13）----
 * 全部竖屏媒体查询规则（设置面板 nav 横滚 tab 条、侧栏 rail 图标放大、
 * RP overlay 全屏 safe-area、触控目标放大、面板全宽等）迁至独立宿主无关插件
 * dsht-plugin-mobile（packages/src/dsht-plugin-mobile/client/style.ts）：
 * CSS 五件套 + data-* 宿主锚点（宿主哈希类名单点维护在其 anchors.ts
 * 候选选择器，本文件不再出现）。本文件只保留桌面基线样式。
 */

/* ---- 原生插件设置卡复刻（dsht-npc-*）----
 * 2026-09-05 用户拍板：dsht 插件在 设置→插件 的卡片必须与原生「网页搜索」卡
 * 风格一致。下列规则逐字复制自 @deepseek-ai/dsh-client-ui-settings-plugins 的
 * PluginCard.module.css（YyYd_a_*）与 SubagentModelSelectionCard.module.css
 * 开关样式（vCGm7G_*），类名换成本文件稳定前缀——宿主升级哈希变化不影响我们，
 * 样式值漂移时对照原 CSS 同步。只消费 --dsw-alias-* 语义 token（与宿主同肤）。
 */
.dsht-npc-card {
  border: .5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 16px;
  list-style: none;
  transition: border-color .16s, background .16s;
}
.dsht-npc-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.dsht-npc-cardOpen { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.dsht-npc-header {
  appearance: none; width: 100%; font: inherit; color: inherit;
  text-align: left; cursor: pointer; background: 0 0; border: 0;
  border-radius: 12px; align-items: center; gap: 12px; padding: 14px 16px; display: flex;
}
.dsht-npc-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsht-npc-headText { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }
.dsht-npc-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
.dsht-npc-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
.dsht-npc-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; display: inline-flex; }
.dsht-npc-chevronOpen { transform: rotate(180deg); }
.dsht-npc-body { border-top: .5px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.dsht-npc-readonly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }
.dsht-npc-footer { border-top: .5px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; display: flex; }
.dsht-npc-failed { min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }
.dsht-npc-discard, .dsht-npc-save {
  appearance: none; font: inherit; cursor: pointer; border: 1px solid #0000;
  border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5;
}
.dsht-npc-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: 0 0; }
.dsht-npc-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.dsht-npc-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dsht-npc-discard:disabled, .dsht-npc-save:disabled { opacity: .4; cursor: default; }
.dsht-npc-discard:focus-visible, .dsht-npc-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

/* 表单行（对齐原生 toggleRow：标签左、控件右） */
.dsht-npc-rows { gap: 2px; padding: 10px 0 0; display: grid; }
.dsht-npc-row { color: var(--dsw-alias-label-primary); justify-content: space-between; align-items: center; gap: 16px; font-size: 13px; line-height: 1.5; display: flex; min-height: 32px; }
.dsht-npc-rowLabel { flex: 1; min-width: 0; }
.dsht-npc-rowLabel .dsht-npc-hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 2px; }
.dsht-npc-rowLabel .dsht-npc-na { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 2px; font-style: italic; }
.dsht-npc-rowNote { color: var(--dsw-alias-label-tertiary); margin: 6px 0 0; font-size: 12px; line-height: 1.5; }
.dsht-npc-groupTitle { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; margin: 14px 0 2px; }
.dsht-npc-select, .dsht-npc-input {
  appearance: none; font: inherit; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-4); border: .5px solid var(--dsw-alias-border-l3);
  border-radius: 8px; padding: 5px 10px; font-size: 13px; min-width: 0;
}
.dsht-npc-inputNum { width: 84px; text-align: right; }
.dsht-npc-inputText { width: 220px; }
.dsht-npc-range { accent-color: var(--dsw-alias-brand-primary); width: 150px; }
.dsht-npc-select { padding-right: 26px; }

/* 原生开关（逐字复制 vCGm7G_switch/switchOn/thumb） */
.dsht-npc-switch {
  box-sizing: border-box; background: var(--dsw-alias-border-l3); cursor: pointer;
  border: 0; border-radius: 10px; flex: none; width: 36px; height: 20px;
  padding: 2px; position: relative;
}
.dsht-npc-switchOn { background: var(--dsw-alias-brand-primary); }
.dsht-npc-switch:disabled { cursor: default; opacity: .5; }
.dsht-npc-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsht-npc-thumb {
  background: var(--dsw-alias-label-primary-foreground); border-radius: 50%;
  width: 16px; height: 16px; transition: transform .12s; display: block;
}
.dsht-npc-switchOn .dsht-npc-thumb { transform: translate(16px); }

/* ---- B17 轻量代码编辑器（CodeTextarea，世界书条目内容；EJS codeEditor 开关）---- */
.dsht-code-ta { min-width: 0; }
.dsht-code-ta .dct-note {
  font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; font-style: italic;
}
.dsht-code-ta .dct-body {
  display: flex; overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-4);
}
.dsht-code-ta .dct-gutter {
  flex: none; width: 40px; overflow: hidden; padding: 6px 0;
  background: var(--dsw-alias-bg-layer-2, transparent);
  border-right: .5px solid var(--dsw-alias-border-l3);
  font-family: var(--dsw-font-family-code, monospace); font-size: 11px; line-height: 20px;
  text-align: right; color: var(--dsw-alias-label-tertiary); user-select: none;
}
.dsht-code-ta .dct-ln { padding-right: 8px; }
/* EJS 标签提示行：<%/%> 所在行的行号高亮 + 左侧玻璃条 */
.dsht-code-ta .dct-ln-ejs {
  color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 3px 0 0 var(--dsw-alias-state-business-primary);
  font-weight: 600;
}
.dsht-code-ta .dct-input {
  flex: 1; min-width: 0; resize: none; border: none; outline: none;
  padding: 6px 10px; line-height: 20px; overflow: auto;
  font-family: var(--dsw-font-family-code, monospace); font-size: 12px;
  color: var(--dsw-alias-label-primary); background: transparent;
  white-space: pre; /* wrap=off 横向滚动（EJS/代码块不折行） */
}

/* ---- C3 代码块增强（collapse_code_block 折叠 + optimize_hljs 轻量高亮）----
   增强面 = 楼层 MarkdownText 的 <pre>（display-compiler.ts enhancePreBlocks 打 class/标记） */
.dsht-rp-assistant-body pre.dsht-pre-collapsible { position: relative; cursor: zoom-in; }
.dsht-rp-assistant-body pre.dsht-pre-collapsed { max-height: 200px; overflow: hidden; cursor: zoom-in; }
.dsht-rp-assistant-body pre.dsht-pre-collapsed::after {
  content: '▼ 点击展开代码块';
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 22px 12px 6px; text-align: center;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  background: linear-gradient(transparent, var(--dsw-alias-bg-base));
  pointer-events: none;
}
/* 轻量高亮四组着色（语义 token 优先，字面量兜底与既有组件一致） */
.dsht-rp-assistant-body pre span[data-dsht-hl='str'] { color: var(--dsw-alias-state-success, #3fb950); }
.dsht-rp-assistant-body pre span[data-dsht-hl='com'] { color: var(--dsw-alias-label-tertiary); font-style: italic; }
.dsht-rp-assistant-body pre span[data-dsht-hl='num'] { color: var(--dsw-alias-state-warning, #d29922); }
.dsht-rp-assistant-body pre span[data-dsht-hl='kw'] { color: var(--dsw-alias-state-business-primary); font-weight: 600; }
`
