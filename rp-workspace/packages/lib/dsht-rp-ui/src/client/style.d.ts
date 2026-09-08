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
export declare function ensureStyle(): void;
