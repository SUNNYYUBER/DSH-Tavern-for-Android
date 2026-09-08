/**
 * 三个预适配插件的探活 + 功能自检端点（纯数据面，零 React 依赖——
 * 单测直接 import；MigrationStatusPanel 与 PluginCards 复用同一份清单）。
 *
 * 自检升级史：批次修复 11（ping → 真实写读/渲染断言）→ 本批次（修复 8：
 * 宏展开实测 + 状态栏实测，后端路由并行在建，按路由名消费）。
 */
/** 三态自检结果：ok=功能正常 / degraded=在线但功能异常 / down=未响应 */
export type ProbeState = 'ok' | 'degraded' | 'down';
export interface PluginProbe {
    /** 中文名（大白话） */
    label: string;
    /** 系统插件列表里的名字（170+ 插件里按这个找） */
    listName: string;
    ping: () => Promise<boolean>;
    /**
     * 功能级自检（ping 只证明路由活着，这里验证真实读写/渲染链路）。
     * true=功能断言通过；false=在线但功能异常；抛异常=未响应。
     */
    selftest: () => Promise<boolean>;
}
/** 三个预适配插件的探活 + 功能自检端点（同源 fetch）。
 * PluginCards.tsx（设置→插件「可配置」辨识卡）复用同一份清单（只用 ping）。 */
export declare const PROBES: PluginProbe[];
