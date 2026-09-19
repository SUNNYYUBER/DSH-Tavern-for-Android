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
/* 【L2 2026-09-14 字号缩放修复】-webkit-text-size-adjust: 100% 抑制 Android WebView 的
 * text autosizing（按容器宽度自动放大字号）。本子树布局尺寸全是硬编码 px（L2 穷举统计：
 * style.ts 内约 200 处布局 px、全仓 rem 使用数 = 0），一旦被 autosizing 放大字号而
 * padding/height 不跟随 ⇒ 文字溢出容器、点击区错位。
 * 取 100%（而非 none）：保留用户系统级字体设置的可访问性意图，只禁掉「按宽度自动放大」
 * 这种与布局 px 不匹配的机制。判据见 docs/MOBILE-TEST-METHODOLOGY.md §二 L2 第 7 项。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
.dsht-rp-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  pointer-events: auto; /* overlay 席位默认 click-through，显式接管 */
  font-family: var(--dsw-font-family);
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
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
/* 【2026-09-14 L1 穷举修复·手势冲突面】主滚动容器补 overscroll-behavior: contain。
 * 背景：L1 必测项「手势冲突（帧内滚动 vs 拖拽、双指、passive 默认值）」的静态穷举结论——
 * 全仓 overscroll-behavior 原先只有 1 处（.dsht-rp-ctx-panel），**主滚动区没有**。
 * 后果（Android WebView 常见形态）：滚到顶/底时滚动链外溢到宿主外层容器
 * ⇒ 触发宿主的整页滚动或下拉刷新，观感是「内容滚着滚着整页跳了」。
 * contain = 「滚到头就停住，不外溢」，正是滚动容器应有的默认语义。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
.dsht-rp-main { flex: 1; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }

/* 【2026-09-14 L1 穷举修复·手势冲突面（二）】所有**子滚动容器**统一不外溢滚动链。
 * 为什么要一条聚合规则而不是逐个加：这些容器（面板 body / 抽屉 body / 状态视图 /
 * 搜索结果 / 长文本块）分散在本文件十余处，逐个加必然漏（本项目反复出现的「改一处漏两处」，
 * 见 P-1）。此处按**结构特征**（我方命名空间下的滚动区）统一收口。
 * 语义：滚到自己的顶/底就停住，不再把滚动传给宿主外层 ⇒ 不触发宿主整页滚动/下拉刷新。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
.dsht-rp-main,
.dsht-rp-statefloat-panel .sf-body,
.dsht-rp-script-panel .sf-body,
.dsht-rp-drawer-body,
.dsht-rp-stateview .sv-body,
.dsht-rp-searchview .se-body { overscroll-behavior: contain; }

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
/* 【2026-09-13 修复·键盘不可达（F-4）】导入区由 label 改为 button（label+隐藏 file
 * input 键盘不可达）——button 自带 UA 底色/边框/字体，需显式覆盖回原观感。 */
.dsht-rp-drop { background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit; }
.dsht-rp-drop:disabled { opacity: .6; cursor: default; }
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

/* 【2026-09-15 W5 长文本/宽元素横向溢出兜底 · 设备决定性实验驱动】
 *
 * ## 为什么必须加（实测复现，不是推测）
 * 设备实测（scripts/ef-overflow-probe.mjs，真机页面内挂探针，基线 = .dsht-rp-main 的
 * clientWidth = 393px）：把 markdown 典型超宽产物注入**真实** .dsht-rp-assistant-body 后，
 * 内容 scrollWidth 远超可用宽，且是 overflow:visible ⇒ **画到盒外**、被祖先滚动容器接住：
 *   longUrl   4694px（11.9 倍）· preBlock 7489px（19 倍）· longWord 3131px（8 倍）
 * 用户可见症状 = 长楼层横向可拖、正文被推出屏幕。宿主侧无任何 overflow-x 兜底
 * （实测宿主 assistant-step 容器 overflow-x: visible / min-width: 0px），故必须由我方加。
 *
 * ## 为什么是这几条（阶梯消融，P-20 判据必须自带杠杆）
 * 逐级加规则实测（同一次实验，仅差规则集）：
 *   S1 只给 body/html 加 overflow-x:auto（2 条） ⇒ **无效**，内容仍 4694px
 *   S2 再给直接子级加 max/min-width（4 条）     ⇒ **无效**，内容仍 4694px
 *   S3 再加「断行 + pre/table」共 9 条          ⇒ 长串/代码块/宽表格全治住
 *   S4 再加 img/video/canvas/svg 限宽 + 外壳    ⇒ 裸大图也治住（2000px → 319px）
 *
 * 为什么光 overflow-x:auto 治不住（这是本条的机理，不是经验）：
 * 真正撑破页面的是**内容驱动的 min-content 传递**——不可断长串（URL/长词）的 min-content
 * 等于整串宽度，flex 链上各级 min-width:auto 会把它一路传到外层。overflow 只让**盒子**
 * 可滚，盒子本身仍被 min-content 撑成 4694px。⇒ 必须同时「给后代允许断行」。
 *
 * ## 【重要】一次**结论反转**必须记下来（P-27 / P-20 的教训）
 * 第一版消融只用了 4 个样本（longUrl / wideTable / preBlock / longWord），据此判定
 * 「img/svg 那 3 条无杠杆 ⇒ 不加」。但补上两个**真会溢出**的样本后结论反转：
 *   · wideTable 的单元格很窄 ⇒ 表格自适应 319px，**测不出** table 规则是否需要；
 *   · 没有裸大图样本 ⇒ **测不出** img 规则是否需要（实测 img 元素 width=2000 时达 2000px）。
 * ⇒ 少一个样本就会把**必要规则**当成**死规则**删掉。纪律：消融样本必须覆盖
 *   **每一类待删规则各自的真实触发场景**，否则消融结论无效（不是「无杠杆」，是「没测到」）。
 * 本组规则即按补全样本后的 S4 落地（12 条）。
 *
 * 语义选择：overflow-x: auto（可滚，不裁切）。实测已确认内容未被裁掉（clipped=no），
 * 用户仍能看到全部内容——只是改为在楼层内横向滚动，而不是把整页撑破。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
.dsht-rp-assistant { min-width: 0; max-width: 100%; }
.dsht-rp-assistant-body,
.dsht-rp-html { min-width: 0; max-width: 100%; overflow-x: auto; }
.dsht-rp-assistant-body > *,
.dsht-rp-html > * { max-width: 100%; min-width: 0; }
/* 不可断长串（URL / 超长单词 / 连续符号）允许任意位置断行 */
.dsht-rp-assistant-body a, .dsht-rp-assistant-body p, .dsht-rp-assistant-body li,
.dsht-rp-assistant-body h1, .dsht-rp-assistant-body h2, .dsht-rp-assistant-body h3,
.dsht-rp-html > * { overflow-wrap: anywhere; }
/* 代码块 / 表格：自身可横向滚，不撑破父级 */
.dsht-rp-assistant-body pre, .dsht-rp-html pre { max-width: 100%; min-width: 0; overflow-x: auto; }
.dsht-rp-assistant-body table, .dsht-rp-html table { display: block; max-width: 100%; min-width: 0; overflow-x: auto; }
/* 媒体元素：卡内正文常写 img width=2000 这类硬尺寸 ⇒ 必须限宽（实测 2000px 溢出） */
.dsht-rp-assistant-body img, .dsht-rp-assistant-body video,
.dsht-rp-assistant-body canvas, .dsht-rp-assistant-body svg,
.dsht-rp-html img, .dsht-rp-html video,
.dsht-rp-html canvas, .dsht-rp-html svg { max-width: 100% !important; height: auto !important; }

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
/* 【2026-09-13 修复·长名省略（E-3/E-5）】楼层头容器不吃剩余宽度、名字无省略，
 * 长角色名/长模型名会把楼层头（含时间戳）撑出视口。meta 吃剩余宽度，
 * name/sub 均走省略号单行截断。 */
.dsht-rp-floor-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.dsht-rp-floor-head-user .dsht-rp-floor-meta { align-items: flex-end; }
/* 【2026-09-13 修复·硬编码色（E-3）】原 color 写死 rgba(220,220,210,.95)，浅色主题
 * 下白字白底不可读 ⇒ 改语义 token 随主题翻转；并补省略号三件套防长名溢出。 */
.dsht-rp-floor-name {
  font-size: 13px; line-height: 17px; font-weight: 600; color: var(--dsw-alias-label-primary);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-floor-sub {
  font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, monospace;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

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
 * 保留动作按钮（ST 移动端动作常驻同语义）。桌面（fine pointer）维持原隐藏。
 *
 * 【2026-09-14 L1 穷举修复】原 span { display: none !important } **误伤我方注入组件**：
 * 变体条（span.dsht-rp-variant-bar）与时间戳同为 span，被一并隐藏 ⇒
 * 触屏用户永远看不到「‹ 1/3 ›」变体切换（功能存在但不可见 = L1 必测项
 * 「不存在『功能存在但永远出不来』」的违反）。
 * 修法：按**命名空间前缀**排除我方组件（宿主的时间戳 span 无 dsht- 前缀，照旧隐藏），
 * 不依赖宿主 hash 类名（那会随版本漂移）。
 * 判据：我方注入的任何组件都不得被宿主行级规则连带隐藏（P-5 边界隔离）。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
@media (pointer: coarse) {
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] { display: flex !important; }
  /* 排除我方组件（dsht- 前缀命名空间）；宿主的时间戳 span 无 dsht- 前缀，照旧隐藏 */
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] span:not([class*="dsht-"]) { display: none !important; }
  /* 我方注入的动作容器必须常显（重申，防被更具体的选择器压回） */
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] span[class*="dsht-"] { display: inline-flex !important; }
  /* 【2026-09-14 L1 穷举修复】宿主在 turn-tail 行内渲染的**动作钮**（复制 / 分支 /
   * 我方「重新生成」）是 28×28（宿主 CSS .xzv4MW_action 用 calc(28px + 字号增量)），
   * 低于 38 拇指下限 ⇒ 手机上易误触。与 .bhn1Oq_searchInput 同法做**作用域覆盖**
   * （宿主 hash 类名，随版本可能漂移——失效即无害，回落到 28px 而非报错）。
   * 说明：宿主已内置「复制」按钮（MessageIconActions.onCopy → writeClipboard），
   * 故 L1「长按/复制」项在**消息文本**这一面上不是缺口；缺的只是触屏尺寸与失败反馈。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] button[class*="action"] {
    width: 38px !important; height: 38px !important; border-radius: 10px !important;
  }
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] button[class*="action"] svg {
    width: 18px !important; height: 18px !important;
  }
  /* 我方「重新生成」钮（button，不受上面的 span 规则影响）触屏放大 */
  body[data-dsht-rp-active] [data-chat-flow-kind="turn-tail"] .dsht-rp-regen-btn {
    height: 38px !important; font-size: 13px !important;
  }

  /* ===========================================================================
   * 【L1 2026-09-14 设备实测修复】我方自有组件的触控目标放大，**必须放在本文件**。
   *
   * ## 根因（设备 CDP 实测，架构层）
   * 这些放大规则原本只写在 dsht-plugin-mobile 的 client/style.ts 的
   * 窄屏媒体查询（max-width 700px）段里。设备实测（1080x2400 @440dpi = 393dp 宽）
   * innerWidth=393、matchMedia('(max-width:700px)')=true —— 媒体查询**匹配**，
   * 但 getComputedStyle(.dsht-rp-scriptball).width 仍是 **36px**（规则未生效）。
   *
   * 原因 = **层叠顺序**：两条同名规则，谁后写谁赢。实测样式表注入顺序为
   *   dsht-plugin-mobile-style → dsht-rp-ui-style
   * ⇒ mobile 插件写的 44px 被本文件后写的 36px **覆盖回去**，且**零报错**。
   * 即「跨包覆盖靠层叠顺序」= 脆弱的隐式依赖：注入顺序一变（或插件加载顺序变），
   * 放大规则就**静默失效**，而所有静态护栏（检查规则文本存在）都是绿的。
   * 这正是 P-11「产物即事实 / 规则存在 ≠ 规则生效」的又一实例。
   *
   * ## 修法（R4：在架构层收口，不修单点）
   * 我方自有组件（dsht-rp-*）的触控尺寸**由本文件自己负责**——同包同文件，
   * 层叠顺序天然确定，不依赖任何外部插件的注入时机。
   * 判据用 (pointer: coarse) 而非 max-width：拇指误触是**触屏属性**，
   * 不是宽度属性（平板 / 横屏 / 大屏手机同样需要）。
   *
   * 尺寸取 44（P2 目标）而非 38（P1 底线）：这几个都是**高频或高误触代价**的控件
   * （脚本球、回退、重新生成），取目标值。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。
   * =========================================================================== */
  /* 【L2 2026-09-14「字号与缩放」格设备实测修复】触控尺寸**必须抗 flex 压缩**。
   *
   * ## 根因（设备实测，架构层 —— P-11 的布局层形态）
   * 上面这批规则原本只写 height:44px !important。设备实测（ef-font-scale.mjs）
   * 发现 .dsht-rp-import-dock 渲染高度 **19.45px** —— 而它命中规则、且带 !important。
   * 决定性实验（逐条单独施加 inline !important）：
   *   height:44px !important 单独施加          → 仍 19.45px（**无效**）
   *   min-height:44px 单独施加                 → 44px（有效）
   *   height:44px + flex-shrink:0 同时施加     → 44px（有效）
   * ⇒ 该元素是 flex item（祖先为 composerStack 的 column flex），
   *   **flex-shrink 把 height 压回去**。height 是「建议主尺寸」，flex-shrink 是「下限之外可压」，
   *   二者不在同一层，important 救不了。
   *
   * ## 修法（架构层收口，不修单点 —— R4）
   * 凡「在 flex 容器内靠 height 撑触控尺寸」的规则，一律补 flex-shrink: 0。
   * 对非 flex item 无害（flex-shrink 在非 flex 容器里被忽略）。
   * 先例：dsht-plugin-mobile/client/style.ts 的 settings-nav-cell 早已写
   * 「height: 48px !important; flex-shrink: 0」—— **同一坑一处已修一处未修**，
   * 正是 P-1（同一语义两处不同实现）的又一实例。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
  .dsht-rp-scriptball { width: 44px !important; height: 44px !important; font-size: 20px !important; }
  .dsht-rp-script-pill { min-height: 44px !important; padding: 8px 14px !important; font-size: 14px !important; flex-shrink: 0 !important; }
  .dsht-rp-rollback-btn { height: 44px !important; min-width: 44px !important; font-size: 13px !important; flex-shrink: 0 !important; }
  .dsht-rp-import-dock { height: 44px !important; padding: 0 14px !important; font-size: 13px !important; flex-shrink: 0 !important; }
  .dsht-rp-preset-switch .ps-select { height: 44px !important; font-size: 13px !important; flex-shrink: 0 !important; }
  /* 头像既是展示也是详情入口（36 -> 44）；row flex 里同样会被压宽 */
  .dsht-rp-avatar { width: 44px !important; height: 44px !important; flex-shrink: 0 !important; }

  /* ===========================================================================
   * 【L1 2026-09-14 触控目标穷举修复】第二批：设备探针 ef-touch-targets.mjs 抓到的项。
   *
   * ## 为什么这一批必须放在**本文件**（架构层收口 —— R4 / P-1）
   * 下面这些元素在同一份探针里被测出 <38px（P1 阻塞级），而
   * dsht-plugin-mobile/client/style.ts **已经**为它们写了放大规则：
   *     .vb-arrow { width: 38px; height: 38px; }
   * 但**永不生效** —— 因为本文件有特异性更高的桌面基线规则：
   *     .dsht-rp-variant-bar .vb-arrow { width: 20px; height: 20px; }   （0,2,0 > 0,1,0）
   * 于是产生**死规则**：mobile 侧那条「看起来有防护、实则静默失效」，
   * 而 mobile 侧注释当时还写着「保留的 vb-arrow 不属 rp-ui 自有类（层叠无冲突）」
   * —— **那句判断是错的**（P-1 实例：同一语义两处判据不一致）。
   *
   * ## 判据依据（设备实测，非推测）
   * ef-touch-targets.mjs 穷举我方可点元素（按 dsht- 类名前缀判定归属）：
   *   .vb-arrow 20×20 · .dsht-rp-sidebar-btn 31×36 · .tm-hit 355×20（P1 阻塞）
   *   .dsht-rp-regen-btn 84×38（P2 未达 44）
   * 归因（决定性实验）：全部 height-effective ⇒ 无 flex 压制，**纯粹是基线值不够**。
   *
   * ## 修法
   * 一律在本文件的 (pointer: coarse) 段给出**高于桌面基线特异性**的放大规则
   * （用 !important 并带足选择器层级），使「手机放大」与「桌面基线」在同一包内可控。
   * 同时把 mobile 侧的对应死规则**显式标注**（见该文件注释），避免下次又有人去改那边。
   *
   * ## 归属原则（R17 / P-1 的推论，本条已固化为纪律）
   * **放大规则必须写在「该组件所属的那个包」里**，不得跨包写。
   * 故 dsht-mobile-* 的两个控件（attach 38 / hamburger 40）**不在本文件修**，
   * 而是修在 dsht-plugin-mobile 自己的 (pointer: coarse) 段（与它俩同包）。
   *
   * ## 尺寸取值
   * 一律取 **44**（目标值）—— 不为「刚好过 38 底线」而留余量不足的隐患。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。
   * =========================================================================== */
  /* 变体条箭头（桌面基线 20×20）：必须压过 .dsht-rp-variant-bar .vb-arrow（0,2,0） */
  .dsht-rp-variant-bar .vb-arrow { width: 44px !important; height: 44px !important; font-size: 18px !important; flex-shrink: 0 !important; }
  /* 侧栏 footer 按钮（桌面基线 height:36px / width:100%）：只抬高度，宽度保持整行 */
  .dsht-rp-sidebar-btn { height: 44px !important; flex-shrink: 0 !important; }
  /* token 进度条命中区（桌面基线 height 由内容决定，实测 20px）：整行可点，抬到 44 */
  .dsht-rp-tokenmeter .tm-hit { height: 44px !important; flex-shrink: 0 !important; }
  /* 重新生成钮（桌面基线 38）→ 44 */
  .dsht-rp-regen-btn { height: 44px !important; min-height: 44px !important; flex-shrink: 0 !important; }
  /* 世界书钮（桌面基线 height:30px）→ 44。注意：mobile 侧那条 .lore-btn 规则是
   * **死规则**（无 .dsht- 前缀、且 rp-ui 的 .dsht-rp-lore .lore-btn 特异性更高）。 */
  .dsht-rp-lore .lore-btn { height: 44px !important; flex-shrink: 0 !important; }
  /* 状态视图切换钮（桌面基线见 .dsht-rp-stateview .sv-view-btn）→ 44 */
  .dsht-rp-stateview .sv-view-btn { height: 44px !important; flex-shrink: 0 !important; }
  /* 【2026-09-14 定标 · 2026-09-16 W26 补齐】状态查看 / 节点表里的**树节点行**。
   *
   * ## 为什么此前漏了（W14 取证）
   * GOAL §11.2 W14 记的是「上一轮该页未渲染这两个控件」——本轮实测**并非渲染问题**：
   * 探针 ef-touch-targets.mjs 的 stateview 态**已能进态**（进态=ok、扫到 11 个元素），
   * 只是这 6 个节点行在**该态下才可见**，而当时没有把它们纳入修复批。
   * ⇒ 教训：把「没测到」写成「没渲染」会**掩盖真实缺陷**（P-17：测不出来 ≠ 事实否定；
   *   反之亦然 —— 这次是「测出来了，但被当成没渲染而搁置」）。
   *
   * ## 实测数据（设备 393×803，CDP）
   *   button.sv-row.sv-node **312×25**（6 个：stat_data / 世界信息 / time / location /
   *   节点倒计时 / media），computedH=24.5455px、minH=0px、**flexShrink=1**。
   *   归因（决定性实验，逐条单独施加 inline !important）：
   *     onlyHeight=312×44 · onlyMinH=312×44 · heightNoShrink=312×44 · minHNoShrink=312×44
   *   ⇒ 判为 **height-effective**（无 flex 压制）——即**纯粹是基线高度不够**。
   *   但 computed flex-shrink:1 说明它**确实处在 flex 容器里**（.sv-row 是
   *   display: flex，本按钮 width:100% 是 flex item）⇒ 按既有纪律③**必须一并给
   *   flex-shrink:0**：否则一旦行内出现更宽的内容（长 key / 长 summary），
   *   按钮会被压回。这是 P-25 的**预防性**形态：**当次的归因不足以证明未来安全**。
   *
   * ## 选择器与取值
   * 特异性 0,3,0（与桌面基线 .dsht-rp-stateview .sv-row.sv-node 同值，靠**注入顺序 +
   * !important** 取胜 —— 同包内两条规则，本段在后）。高度取 **44**（目标值，见纪律②）；
   * 不改宽度（宽度就该整行）。注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
  .dsht-rp-stateview .sv-row.sv-node { min-height: 44px !important; flex-shrink: 0 !important; align-items: center !important; }
  /* 剧情控制台的 NPC 切换条（mobile 侧写 38，此处给足特异性并抬到 44） */
  /* 【W30 补齐宽度】原先只给了 height: 44px —— 而设备实测该按钮是 **36×44**：
   * 宽度仍是桌面基线的 36px，低于 38 底线 ⇒ **宽度这一维从来没被修过**。
   *
   * ## 为什么此前没发现（P-20 覆盖空洞）
   * 这个按钮位于**宿主设置页的「插件」tab 下、展开的设置卡里**，
   * 而 W2 的跨态穷举**没有设置面板态** ⇒ 该控件从未真正被扫到过。
   * W30 补了 host-settings-plugins / host-settings-card-open 两个态后，
   * 又发现探针只扫**当前视口**，而设置卡挂在 2613px 的滚动面
   * （宿主的设置内容列，overflow-y:auto）里 ⇒ 首版只报 2 个元素、17 个 switch 全在视口外。
   * 补**滚动扫描**后一次暴露 **17 个 P1**（全部 36×44）。
   *
   * ## 归因（决定性实验，逐条单独施加 inline !important）
   *   onlyWidth=44×44 · onlyMinWidth=44×44 · width44+noShrink=44×44
   * ⇒ **width-effective**（只给宽度就够，无 flex 压制）；
   *   但 computed flex-shrink 值得留意，故按纪律③一并写 0（预防性，同 W14 处置）。
   *
   * ## 取值
   * 宽度取 **44**（目标值，非仅 38 底线）：这是**拇指高频切换**控件，
   * 且与既有 height: 44px 对齐成正方形，视觉与命中率同时改善。 */
  .dsht-npc-switch { width: 44px !important; height: 44px !important; flex-shrink: 0 !important; }

  /* ===========================================================================
   * 【2026-09-14 第二十轮 · 从 dsht-plugin-mobile 迁入】
   *
   * ## 为什么迁进来（设备实测，P-26「同特异性靠注入顺序」形态）
   * 这批规则原来写在 'dsht-plugin-mobile/client/style.ts' 的窄屏媒体查询里，
   * 与**本文件**的桌面基线规则**特异性相同**（都是 0,1,0）。
   * 而 mobile 文件注入为 'dsht-plugin-mobile-style'、**先于** 'dsht-rp-ui-style'
   * ⇒ 同特异性下**后写者胜** ⇒ 那批规则**全部被本文件覆盖**（死规则）。
   *
   * CDP 实测证据（枚举「匹配且 media 生效」的全部规则 + 实际渲染值）：
   *   .dsht-rp-back        迁出前 44px vs 本文件 32px ⇒ 实测 **32px**（低于 38 底线，P1）
   *   .dsht-rp-tab         迁出前 44px vs 本文件 28px ⇒ 实测 **28px**（P1）
   *   .dsht-rp-card-gear   迁出前 38px vs 本文件 26px ⇒ 实测 **26px**（P1）
   *   .dsht-rp-user-stack  迁出前 92%  vs 本文件 min(525px,82%) ⇒ 实测 82% 档（静默失效）
   *   .dsht-rp-grid        gap 10px    vs 本文件 12px ⇒ 实测 12px（静默失效）
   *
   * ## 迁入后的写法原则
   * ① 用**与桌面基线同等或更高特异性**的选择器 + '!important'（同包内确定性可控）；
   * ② 触控尺寸一律取 **44**（目标值；低于 38 即 P1 阻塞）；
   * ③ 凡「靠尺寸属性撑触控目标」的，**必须**带 'flex-shrink: 0'（P-25）；
   * ④ 本文件**不写** mobile 自有组件（'dsht-mobile-*'）——归属原则（P-26）。
   * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。
   * =========================================================================== */
  /* RP overlay：safe-area inset。注意 overlay 根是 fixed inset:0（本文件 L40）——
   * 不能再设 height:100dvh（会覆盖 bottom 约束，叠加 padding 后总高 > 视口）。 */
  .dsht-rp-overlay {
    box-sizing: border-box !important;
    padding-top: env(safe-area-inset-top) !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
  }
  .dsht-rp-topbar { flex-wrap: wrap !important; gap: 6px !important; padding: 8px 10px !important; }
  .dsht-rp-back { width: 44px !important; height: 44px !important; font-size: 22px !important; flex-shrink: 0 !important; }
  /* tab 栏独占一行全宽，触控目标 44px */
  .dsht-rp-tabs { flex: 1 1 100% !important; gap: 6px !important; margin-left: 0 !important; overflow-x: auto !important; }
  .dsht-rp-tab { flex: 1 !important; height: 44px !important; border-radius: 12px !important; font-size: 14px !important; }
  /* 角色宫格：双列自适应（超窄自动单列），卡片全宽 */
  .dsht-rp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important; gap: 10px !important; padding: 12px !important; }
  .dsht-rp-card { padding: 14px !important; min-height: 44px !important; }
  /* 齿轮钮 26 → 44（原 mobile 侧写 38，但那是死规则；且 38 也仅够底线） */
  .dsht-rp-card-gear { width: 44px !important; height: 44px !important; font-size: 16px !important; opacity: 1 !important; flex-shrink: 0 !important; }
  /* 角色详情/导出抽屉：全屏（不再底部 70%） */
  .dsht-rp-drawer-mask { align-items: stretch !important; }
  .dsht-rp-drawer { max-height: none !important; height: 100% !important; border-radius: 0 !important; border-top: none !important; }
  /* 预设/正则/导入/世界书面板：去 max-width 居中，全宽 */
  .dsht-rp-preset, .dsht-rp-regex, .dsht-rp-import, .dsht-rp-books { max-width: none !important; margin: 0 !important; padding: 16px !important; }
  /* 世界书 chips 触控目标 44px */
  .dsht-rp-books .wb-row { min-height: 44px !important; }
  .dsht-rp-books .wb-chip { min-height: 44px !important; padding: 8px 16px !important; font-size: 14px !important; border-radius: 22px !important; }
  /* 触控目标放大 */
  .dsht-rp-btn { min-height: 44px !important; }
  .dsht-rp-action-btn { min-height: 44px !important; }
  .dsht-rp-preset-toggle .pt-opt { padding: 6px 12px !important; min-height: 44px !important; flex-shrink: 0 !important; }
  .dsht-rp-regex .rx-toggle span { width: 40px !important; height: 22px !important; border-radius: 11px !important; }
  .dsht-rp-regex .rx-toggle span::after { width: 18px !important; height: 18px !important; }
  .dsht-rp-regex .rx-toggle input:checked + span::after { transform: translateX(18px) !important; }
  .dsht-rp-regex .rx-del { width: 44px !important; height: 44px !important; font-size: 15px !important; flex-shrink: 0 !important; }
  /* 【2026-09-14 第二十轮续三 · 跨态穷举抓到】两处正则面板的触控目标不达标：
   *   · .rx-name（点击进入编辑）实测 **126×24** —— 低于 38 底线（P1 阻塞）；
   *   · .rx-toggle（label 包住 checkbox 的**隐式** label）实测仅 40×22。
   * 归因（决定性实验）：.rx-name 单独施加 height:44px 即变 44 ⇒ **无压制**，
   * 纯粹是「桌面基线没给下限」（不是 P-25 的 flex-shrink 形态）。
   * ⇒ 用 min-height 给下限（比 height 稳：内容再多也能撑开，且不受 flex-shrink 影响）。 */
  .dsht-rp-regex .rx-name { min-height: 44px !important; }
  .dsht-rp-regex .rx-toggle { min-height: 44px !important; min-width: 44px !important; justify-content: center !important; }
  /* 【2026-09-14 第二十轮续三 · 抽屉态】复选框行 .rx-check（label 包住 checkbox）
   * 是最早漏扫的一类：探针原先只查 'label[for]'（**显式** label），
   * 而本仓全部是 **implicit label**（无 for）⇒ 整类可点元素从未被测过（P-19 同族）。
   * 补上口径后立刻抓到：抽屉内「世界书勾选」行实测 **353×37** —— 差 1px 低于 38 底线（P1）。
   * 该行 <label> 内联写了 display:flex; padding:7px 0，桌面基线 .rx-check 是
   * inline-flex + line-height:18px ⇒ 高度由内容撑出 37px。
   * 归因（决定性实验）：单独施加 height:44px 即变 44 ⇒ 无压制，纯粹缺下限。
   * ⇒ 按 P-1（同类一处修须全仓收口）**统一**给 .rx-check 下限，而不是只修抽屉那一处
   *   （RegexPanel / PersonaPanel 也用同一个类，同样是触控目标）。 */
  .rx-check { min-height: 44px !important; }
  .dsht-rp-regex-row { padding: 10px 0 !important; flex-wrap: wrap !important; }
  /* 聊天消息区 480px 限制竖屏放开 */
  .dsht-rp-statusbar, .dsht-rp-actions, .dsht-rp-reasoning, .dsht-rp-mvu-statusbar,
  .dsht-rp-collapsible, .dsht-rp-state-update, .dsht-rp-foreshadowing { max-width: 100% !important; }
  /* 回退按钮 / 预设条目展开钮 */
  .dsht-rp-rollback-btn { height: 44px !important; font-size: 12px !important; flex-shrink: 0 !important; }
  .dsht-rp-preset-entry .pe-expand { width: 44px !important; height: 44px !important; font-size: 15px !important; flex-shrink: 0 !important; }
  /* 人设行展开钮：窄屏放大到 44（不能再依赖内联尺寸——见 PersonaPanel.tsx 处注释） */
  .dsht-rp-persona-row .pr-expand { width: 44px !important; height: 44px !important; font-size: 16px !important; flex-shrink: 0 !important; }
  .dsht-rp-user-stack { max-width: 92% !important; }
  /* 主会话过程折叠标题行：触控目标 44px */
  .dsht-fold-header { min-height: 44px !important; font-size: 13px !important; }
  /* 上下文参数面板（剧情控制台）：关闭 / 步进器 / 展开 */
  .dsht-rp-ctx-panel .cp-close { width: 44px !important; height: 44px !important; font-size: 18px !important; flex-shrink: 0 !important; }
  .dsht-rp-ctx-panel .cp-stepper button { width: 44px !important; height: 44px !important; font-size: 16px !important; flex-shrink: 0 !important; }
  .dsht-rp-ctx-panel .cp-stepper input { height: 44px !important; font-size: 14px !important; }
  .dsht-rp-ctx-panel .cp-expand-btn { height: 44px !important; padding: 0 14px !important; font-size: 13px !important; flex-shrink: 0 !important; }
  .dsht-rp-ctx-panel .cp-row { min-height: 44px !important; }
  /* 状态浮球面板 / 脚本面板 / 状态视图：底部按钮行 */
  .dsht-rp-statefloat-panel .sf-btn,
  .dsht-rp-script-panel .sf-btn,
  .dsht-rp-stateview .sf-btn { min-width: 44px !important; min-height: 44px !important; font-size: 13px !important; flex-shrink: 0 !important; }
  /* 开场白 dock 窄屏 */
  .dsht-rp-greeting-dock { margin: 0 8px 6px !important; }
  .dsht-rp-greeting-dock .dsht-rp-btn { min-height: 44px !important; }
}

.dsht-rp-stopped {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  font-style: italic;
}

/* 【F1 2026-09-14】turn-error 节点（我方 shadowing 版）：人话为主 + 技术详情折叠。
 * 与官方 turnErrorRow 视觉对齐（错误点 + 标题 + 正文 + 错误码），
 * 但正文是隔离过内部细节的用户可懂表述。 */
.dsht-rp-turn-error {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 12px; margin: 6px 0;
  border-left: 3px solid var(--dsw-alias-state-error-primary, #d9534f);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 6px;
}
.dsht-rp-turn-error .te-dot {
  color: var(--dsw-alias-state-error-primary, #d9534f);
  font-size: 10px; line-height: 20px; flex-shrink: 0;
}
.dsht-rp-turn-error .te-copy {
  display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;
}
.dsht-rp-turn-error .te-title {
  font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-state-error-primary, #d9534f);
}
.dsht-rp-turn-error .te-message {
  font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-primary); word-break: break-word;
}
.dsht-rp-turn-error .te-detail { margin-top: 4px; }
.dsht-rp-turn-error .te-detail > summary {
  font-size: 11px; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.dsht-rp-turn-error .te-raw {
  margin: 4px 0 0; padding: 6px 8px; max-height: 160px; overflow: auto;
  font-size: 11px; line-height: 16px; white-space: pre-wrap; word-break: break-all;
  background: var(--dsw-alias-bg-layer-2, rgb(128 128 128 / .12));
  border-radius: 4px; color: var(--dsw-alias-label-secondary);
}
.dsht-rp-turn-error .te-code {
  font-size: 11px; flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
}

/* 【2026-09-19 回退连带面修复】harness 运行过程行（系统提示词 / 上下文注入）
 * —— shadowing 官方 SystemPromptRow / ContextInjectionRow 后的重绘形态：
 * 默认折叠成一行（图标 + 标题 + 「·」+ producer 名），展开看正文。
 * 视觉参数对照官方（14px 图标位 / 次级字色 / 2px 圆点分隔 / 24px 行高）。 */
.dsht-rp-harness-row { max-width: 100%; }
.dsht-rp-harness-row > summary {
  cursor: pointer; user-select: none; list-style: none;
  display: flex; align-items: center;
  font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 24px;
  color: var(--dsw-alias-label-secondary);
  padding: 0 2px; padding-right: calc(0.7em + 14px); position: relative;
}
.dsht-rp-harness-row > summary::-webkit-details-marker { display: none; }
.dsht-rp-harness-row > summary::after {
  content: '▾'; position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
  font-size: 12px; color: var(--dsw-alias-label-tertiary);
  transition: transform var(--ds-transition-duration-fast, 0.15s) var(--ds-ease-in-out, ease);
}
.dsht-rp-harness-row[open] > summary::after { transform: translateY(-50%) rotate(180deg); }
.dsht-rp-harness-row .hr-icon { flex: none; font-size: 13px; opacity: 0.9; margin-right: 8px; }
.dsht-rp-harness-row .hr-title { flex: none; }
.dsht-rp-harness-row .hr-sep {
  flex: none; width: 2px; height: 2px; border-radius: 1px;
  background: var(--dsw-alias-label-caption, rgba(145, 145, 145, 0.8)); margin: 0 8px;
}
.dsht-rp-harness-row .hr-meta {
  min-width: 0; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsht-rp-harness-row .hr-body {
  margin: 2px 2px 8px 2px; padding: 6px 8px 6px 14px;
  border-left: 2px solid rgba(145, 145, 145, 0.55); border-radius: 2px;
}
.dsht-rp-harness-row .hr-pre {
  margin: 0; font-size: 12px; line-height: 18px; color: rgba(145, 145, 145, 1);
  white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto;
}
.dsht-rp-harness-row .hr-empty { font-size: 12px; color: rgba(145, 145, 145, 0.8); }

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

/* 悬浮球（RpStateFloat，示例卡乙 pw-state-float 意图原生移植）：fixed 浮球 + 底部状态面板 */
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
  /* 【2026-09-13 修复·手势条遮挡（A-2）】贴底面板内容压在系统手势条/Home 指示条下，
   * 底部按钮点不到 ⇒ 让出 safe-area。z-index 保持 61 不动。 */
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
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
  /* 【2026-09-13 修复·手势条遮挡（A-2）】底部操作条被系统手势条盖住 ⇒ 让出 safe-area。 */
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
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
/* 人设行的「展开/收起」钮（PersonaPanel）。
 * 【2026-09-14 L1 穷举修复】该按钮原先借用 dsht-rp-back 类 + 内联 28×28：
 * 内联值压制了窄屏 44px 规则 ⇒ 手机上只有 28px（远低于 38 拇指下限，P1）。
 * 现独立成类，尺寸交给 CSS（桌面 32，窄屏见 dsht-plugin-mobile 的 44 放大规则）。
 * 注意：本文件是 TS 模板串，注释里**不能出现反引号**。 */
.pr-expand {
  width: 32px; height: 32px; border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; flex-shrink: 0; font-size: 14px;
}
.pr-expand:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
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

/* ---- R21 会话管理面板：kind 徽章（E-4 会话徽章 token 化）----
 * 【2026-09-13 修复·硬编码色（E-4）】原徽章色写死在 JSX 内联样式里（#5a3b1e/#333/#1e3a5a
 * + 文字 #ddd），浅色主题下深底浅字同深底同浅字已经不可读，且完全不走主题 token。
 * 改为类名 + 语义 token（含字面量兜底，与既有组件口径一致）。 */
.dsht-rp-kind {
  font-size: 12px; padding: 2px 8px; border-radius: 8px; white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.18));
}
.dsht-rp-kind-branch-parent {
  background: var(--dsw-alias-state-warning, #d29922);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsht-rp-kind-empty { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsht-rp-kind-forked { background: transparent; color: var(--dsw-alias-label-secondary); }

/* ---- 批次修复 9：配置文件路径弹层 ---- */
.dsht-cfgdoc-mask {
  /* 【2026-09-13 修复·模态被压住（A-1）】2000 < 脚本球 10050 ⇒ 配置路径弹层被球压住。10052。 */
  position: fixed; inset: 0; z-index: 10052; display: flex; align-items: center; justify-content: center;
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
  /* 【2026-09-13 修复·模态被压住（A-1/A-5）】原 z-index 70 < 脚本球 10050 /
   * 脚本面板 10051 ⇒ 状态面板里能看到脚本球压在弹层上并抢走触摸。提到 10052。 */
  position: fixed; inset: 0; z-index: 10052; display: flex;
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
  /* 【2026-09-13 修复·模态被压住（A-1/A-5）】同 stateview：70 → 10052（脚本球/面板之上）。 */
  position: fixed; inset: 0; z-index: 10052; display: flex;
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
/* 【2026-09-13 修复·搜索面板无头无滚动（E-1）】搜索面板头部/头部操作/body 原只在
 * .dsht-rp-stateview 作用域下定义，而本面板根类是 .dsht-rp-searchview（不共用）
 * ⇒ 头部挤压、结果列表不滚动（整页被撑长，头部随内容滚走）。此处补齐三件套：
 * head 保持固定高、head-actions 横排、se-body 独占剩余高度并自身滚动。 */
.dsht-rp-searchview .sv-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.dsht-rp-searchview .sv-head-actions { display: flex; gap: 6px; align-items: center; }
.dsht-rp-searchview .se-input { flex: 1; min-width: 0; }
.dsht-rp-searchview .se-count {
  flex-shrink: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.dsht-rp-searchview .se-body { padding-top: 8px; flex: 1; min-height: 0; overflow-y: auto; }
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
  /* 【2026-09-13 修复·键盘溢出（B-1）】面板从输入区向上弹出，内容多时向上溢出错出
   * 视口顶部，键盘弹起后更盛（展开项与步进器被推出屏幕）⇒ 限高 50vh（dvh 兼容键盘
   * 缩放）+ 自身滚动 + 滚动链不外溢（overscroll-behavior）。 */
  max-height: 50vh; max-height: 50dvh; overflow-y: auto; overscroll-behavior: contain;
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

/* ---- 【2026-09-13 修复·焦点不可见（F-5）】RP 各面板内的按钮/输入此前无可见焦点环
 * （宿主默认 outline 被各组件自己的 outline:none / border 覆盖）⇒ 键盘 Tab 走过界面
 * 完全看不出焦点在哪。此处补一套统一焦点环（非 media query 块，末尾独立追加）。
 * 注意：本文件整体是模板字符串，注释内禁止出现反引号。 */
.dsht-rp-overlay button:focus-visible,
.dsht-rp-overlay input:focus-visible,
.dsht-rp-overlay select:focus-visible,
.dsht-rp-overlay textarea:focus-visible,
.dsht-rp-overlay [tabindex]:focus-visible,
.dsht-rp-stateview button:focus-visible,
.dsht-rp-searchview button:focus-visible,
.dsht-rp-statefloat-panel button:focus-visible,
.dsht-rp-script-panel button:focus-visible,
.dsht-rp-ctx-panel button:focus-visible,
.dsht-cfgdoc button:focus-visible,
.dsht-rp-tokenmeter button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 6px;
}
`
