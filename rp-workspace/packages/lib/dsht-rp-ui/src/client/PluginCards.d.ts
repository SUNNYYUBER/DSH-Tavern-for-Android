/**
 * 任务 C2 + 2026-09-05 全量重做（用户拍板）：dsht 插件在 设置→插件→「可配置」tab 的
 * 卡片必须与原生「网页搜索」等插件卡 **结构+风格完全一致**，且设置面 1:1 复刻
 * SillyTavern 扩展时期的全部选项。
 *
 * 结构复刻（@deepseek-ai/dsh-client-ui-settings-plugins PluginCard）：
 *   li.card(cardOpen) > button.header(name+description+chevron) > body(fields+footer)
 * 样式：dsht-npc-*（style.ts 内逐字复制原生 CSS 值，类名换稳定前缀）。
 * 数据：分相位草稿（draft）+ 脏检查（dirty）+ 保存（PUT 全对象）/放弃（回滚）——
 *   与原生卡「未保存 pill + 放弃/保存 footer」同交互。
 *
 * 设置面盘点（源码级，MASTER_TODO §2.0k）：
 * - 酒馆助手（JS-Slash-Runner GlobalSettings）：脚本总开关+宏开关+渲染 7 项+优化 8 开关+监听器 4 项
 * - 提示词模板（ST-Prompt-Template settings.html）：19 项全量
 * - MVU：变量键值面（经酒馆助手脚本的启用走脚本总开关）
 * - 剧情记忆：我方原创 6 项
 * 接线原则：已有机制的开关已接线生效（TH：脚本/宏；EJS：总开关/生成/楼层/深度/沙箱/调试）；
 * 暂无对应管线的项**存盘但不悄悄砍**，UI 明确标注「暂无对应管线/不适用」。
 */
import { type JSX } from 'react';
/** 卡片组件工厂（按 listName 找到对应卡） */
export declare function makePluginCard(listName: string): () => JSX.Element;
/** 四个插件的命名空间 key（与 host 侧 registerSettingsNamespace 同名） */
export declare const PLUGIN_CARD_KEYS: readonly ["dsht-plugin-mvu", "dsht-plugin-tavern-helper", "dsht-plugin-prompt-template", "dsht-plugin-memory"];
